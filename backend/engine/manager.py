"""Async manager for the Pikafish UCI engine subprocess."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import AsyncIterator, Optional

from backend.engine import uci
from backend.engine.analysis import parse_bestmove, parse_info_line
from backend.models.schemas import AnalysisResult, PVLine

logger = logging.getLogger(__name__)

_DEFAULT_ENGINE_PATH = str(
    Path(__file__).resolve().parent.parent.parent / "Pikafish" / "src" / "pikafish"
)

ENGINE_PATH = os.environ.get("PIKAFISH_PATH", _DEFAULT_ENGINE_PATH)

ENGINE_NAME = os.environ.get("ENGINE_NAME", "Pikafish引擎")


class EngineDiedError(RuntimeError):
    """Pikafish 进程意外退出（崩溃或被外部杀死）。"""


class EngineManager:
    """Wraps a single Pikafish process, providing async analysis methods.

    引擎进程意外退出时会自动重启（_ensure_alive），
    REST 分析在崩溃后自动重试一次，保证服务可用性。
    """

    def __init__(self, path: str = ENGINE_PATH):
        self._path = path
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._ready = False

    async def start(self) -> None:
        if self._proc is not None:
            return
        self._proc = await asyncio.create_subprocess_exec(
            self._path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await self._send(uci.cmd_uci())
        await self._read_until("uciok")
        await self._send(uci.cmd_setoption("UCI_ShowWDL", "true"))
        # Threads=4：8 vCPU 环境下性价比最优档。
        # 注意：不再使用 REST 打断 WS 机制——对照实验证实引擎在「搜索早期被 stop」时
        # 会确定性卡死（与线程数无关），因此所有分析一律排队，靠引擎锁串行化。
        await self._send(uci.cmd_setoption("Threads", "4"))
        await self._send(uci.cmd_setoption("Hash", "64"))
        await self._send(uci.cmd_isready())
        await self._read_until("readyok")
        self._ready = True
        logger.info("Pikafish engine started: %s", self._path)

    async def stop(self) -> None:
        if self._proc is None:
            return
        try:
            await self._send(uci.cmd_quit())
            await asyncio.wait_for(self._proc.wait(), timeout=3)
        except (EngineDiedError, asyncio.TimeoutError, ProcessLookupError):
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass
        self._proc = None
        self._ready = False
        logger.info("Pikafish engine stopped")

    async def _flush_pending(self) -> None:
        """中止可能仍在进行的搜索并丢弃残留输出，保证引擎空闲后再开始新分析。

        若上一次分析被中断（WebSocket 断开/超时等），引擎可能仍在搜索，
        其残留的 bestmove 会被下一次调用误读为本次结果（导致返回错误方走法）。
        """
        await self._send(uci.cmd_stop())
        await self._send(uci.cmd_isready())
        try:
            await self._read_until("readyok")
        except asyncio.TimeoutError:
            # 引擎对 stop/isready 也无响应：强制重启，避免后续调用连环卡死
            logger.warning("engine unresponsive to isready, force restarting")
            await self._restart()

    async def analyse(
        self, fen: str, depth: int = 20, multipv: int = 1, moves: Optional[list[str]] = None
    ) -> AnalysisResult:
        """Run a full analysis up to given depth and return the final result.

        moves: 预设走法序列（分支推演），引擎从序列结束后的局面继续搜索。
        所有分析一律排队（不再打断 WS）：引擎在搜索早期被 stop 会确定性卡死，
        串行化是稳定性的前提。
        """
        async with self._lock:
            for attempt in range(2):
                await self._ensure_alive()
                try:
                    return await self._analyse_once(fen, depth, multipv, moves)
                except EngineDiedError:
                    if attempt == 0:
                        logger.warning("engine died during analysis, restarting and retrying once")
                        continue
                    raise

    async def _probe_alive(self) -> bool:
        """假死探测：stop + isready，引擎回 readyok 说明进程活着（搜索假死可重试）。"""
        try:
            await self._send(uci.cmd_stop())
            await self._send(uci.cmd_isready())
            await asyncio.wait_for(self._read_until("readyok"), timeout=5)
            return True
        except (asyncio.TimeoutError, EngineDiedError):
            return False

    async def _run_search(self, depth: int) -> tuple[dict[int, PVLine], str, Optional[str]]:
        """发 go 并读取搜索输出；引擎假死（go 后超时无输出）时探测-重试，最多 3 次。

        引擎 Lazy SMP 竞态会导致 go 被吞（所有线程挂起 idle、bestmove 永不发出、
        进程仍活着）——探测到进程存活就重新发 go；探测失败（真死）抛 EngineDiedError。
        """
        for attempt in range(3):
            await self._send(uci.cmd_go(depth=depth))
            lines: dict[int, PVLine] = {}
            best_move = ""
            ponder = None
            try:
                async for raw in self._read_lines():
                    if raw.startswith("bestmove"):
                        best_move, ponder = parse_bestmove(raw)
                        break
                    pv = parse_info_line(raw)
                    if pv and pv.pv:
                        lines[_extract_multipv(raw)] = pv
                return lines, best_move, ponder
            except asyncio.TimeoutError:
                if not await self._probe_alive():
                    raise EngineDiedError("engine unresponsive after hang probe")
                logger.warning("engine false-hang (go no output), retrying search attempt %d/3", attempt + 1)
        raise EngineDiedError("engine search failed after 3 attempts")

    async def _analyse_once(
        self, fen: str, depth: int, multipv: int, moves: Optional[list[str]] = None
    ) -> AnalysisResult:
        await self._flush_pending()
        if multipv > 1:
            await self._send(uci.cmd_setoption("MultiPV", str(multipv)))
        await self._send(uci.cmd_position(fen, moves))
        lines, best_move, ponder = await self._run_search(depth)
        if multipv > 1:
            await self._send(uci.cmd_setoption("MultiPV", "1"))

        sorted_lines = [lines[k] for k in sorted(lines.keys())]
        return AnalysisResult(
            fen=fen,
            best_move=best_move,
            ponder=ponder,
            lines=sorted_lines,
            depth=sorted_lines[0].depth if sorted_lines else depth,
            preset_moves=moves or [],
        )

    async def fen_after_moves(self, fen: str, moves: list[str]) -> str:
        """按预设走法序列走完后，返回引擎内部真实局面 FEN（通过 d 命令解析）。

        引擎对 position moves 的处理（忽略/应用非法走法）不可靠，用 d 命令
        获取权威局面，供分支推演的吃子/将军标注与中文记谱转换使用。
        """
        async with self._lock:
            await self._flush_pending()
            await self._send(uci.cmd_position(fen, moves))
            await self._send("d")
            async for raw in self._read_lines():
                if raw.startswith("Fen:"):
                    return raw.split("Fen:", 1)[1].strip()
            return fen

    async def analyse_stream(
        self, fen: str, depth: int = 20, multipv: int = 1
    ) -> AsyncIterator[PVLine | AnalysisResult]:
        """Stream intermediate analysis info lines, then yield final result.

        multipv>1 时跟踪前 N 条候选线（info 消息需带 multipv 索引识别）。
        引擎假死（go 被吞）时探测-重试：进程活着则重新 go 继续流式，最多 3 次。
        """
        async with self._lock:
            await self._ensure_alive()
            await self._flush_pending()
            if multipv > 1:
                await self._send(uci.cmd_setoption("MultiPV", str(multipv)))
            await self._send(uci.cmd_position(fen))

            for attempt in range(3):
                await self._send(uci.cmd_go(depth=depth))
                latest: dict[int, PVLine] = {}
                try:
                    async for raw in self._read_lines():
                        if raw.startswith("bestmove"):
                            if multipv > 1:
                                await self._send(uci.cmd_setoption("MultiPV", "1"))
                            best_move, ponder = parse_bestmove(raw)
                            lines = [latest[k] for k in sorted(latest.keys())]
                            yield AnalysisResult(
                                fen=fen,
                                best_move=best_move,
                                ponder=ponder,
                                lines=lines,
                                depth=lines[0].depth if lines else depth,
                            )
                            return
                        pv = parse_info_line(raw)
                        if pv and pv.pv:
                            mipv = _extract_multipv(raw) or 1
                            latest[mipv] = pv
                            yield pv
                except asyncio.TimeoutError:
                    # 假死探测：先复位 MultiPV，进程活则重新 go
                    if multipv > 1:
                        await self._send(uci.cmd_setoption("MultiPV", "1"))
                    if not await self._probe_alive():
                        raise EngineDiedError("engine unresponsive during stream")
                    logger.warning("engine false-hang during stream, retrying attempt %d/3", attempt + 1)
                    if multipv > 1:
                        await self._send(uci.cmd_setoption("MultiPV", str(multipv)))
            raise EngineDiedError("engine stream search failed after 3 attempts")

    async def _ensure_alive(self) -> None:
        """引擎进程已退出时自动重启，保证后续调用可用。"""
        if self._proc is not None and self._proc.returncode is None:
            return
        rc = self._proc.returncode if self._proc is not None else "never-started"
        self._proc = None
        self._ready = False
        logger.warning("Pikafish engine died (rc=%s), restarting...", rc)
        await self.start()

    async def _send(self, command: str) -> None:
        assert self._proc and self._proc.stdin
        try:
            self._proc.stdin.write((command + "\n").encode())
            await self._proc.stdin.drain()
        except (RuntimeError, BrokenPipeError) as e:
            raise EngineDiedError(f"engine pipe closed: {e}") from e

    async def _read_lines(self, timeout: float = 10.0) -> AsyncIterator[str]:
        """读取引擎输出行；长时间无输出时主动中止搜索并抛超时错误。

        timeout 从 30s 降到 10s：引擎卡死（stop 后无输出）时能更快恢复，
        减少用户感知的"引擎卡住"时长。
        """
        assert self._proc and self._proc.stdout
        while True:
            try:
                raw = await asyncio.wait_for(self._proc.stdout.readline(), timeout=timeout)
            except asyncio.TimeoutError:
                # 引擎超时无输出：先 stop 中止可能卡住的搜索，避免残留深搜阻塞后续调用
                await self._hang_recovery()
                raise
            if not raw:
                raise EngineDiedError("engine process exited unexpectedly")
            line = raw.decode().strip()
            if line:
                yield line

    async def _hang_recovery(self) -> None:
        """引擎超时无响应：先 stop 中止搜索；5 秒内仍无响应则强制重启进程。"""
        logger.warning("engine unresponsive (timeout), sending stop...")
        try:
            await self._send(uci.cmd_stop())
            await asyncio.wait_for(self._drain_until_idle(), timeout=5)
            logger.info("engine search aborted after timeout")
        except (EngineDiedError, asyncio.TimeoutError, RuntimeError):
            logger.warning("engine still unresponsive, force restarting")
            await self._restart()

    async def _drain_until_idle(self) -> None:
        """读引擎输出直到空闲标记（bestmove/readyok/uciok），丢弃中间行。"""
        assert self._proc and self._proc.stdout
        while True:
            raw = await self._proc.stdout.readline()
            if not raw:
                raise EngineDiedError("engine exited")
            line = raw.decode().strip()
            if line.startswith(("bestmove", "readyok", "uciok")):
                return

    async def _restart(self) -> None:
        """强制重启引擎进程。"""
        self._proc = None
        self._ready = False
        await self.start()

    async def _read_until(self, token: str) -> list[str]:
        collected: list[str] = []
        async for line in self._read_lines():
            collected.append(line)
            if line.startswith(token):
                return collected
        return collected


def _extract_multipv(line: str) -> int:
    import re
    m = re.search(r"\bmultipv\s+(\d+)", line)
    return int(m.group(1)) if m else 1


engine: Optional[EngineManager] = None


async def get_engine() -> EngineManager:
    global engine
    if engine is None:
        engine = EngineManager()
        await engine.start()
    return engine
