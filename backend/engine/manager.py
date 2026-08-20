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
        await self._send(uci.cmd_setoption("Threads", "2"))
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
        await self._read_until("readyok")

    async def analyse(
        self, fen: str, depth: int = 20, multipv: int = 1
    ) -> AnalysisResult:
        """Run a full analysis up to given depth and return the final result."""
        async with self._lock:
            for attempt in range(2):
                await self._ensure_alive()
                try:
                    return await self._analyse_once(fen, depth, multipv)
                except EngineDiedError:
                    if attempt == 0:
                        logger.warning("engine died during analysis, restarting and retrying once")
                        continue
                    raise

    async def _analyse_once(
        self, fen: str, depth: int, multipv: int
    ) -> AnalysisResult:
        await self._flush_pending()
        if multipv > 1:
            await self._send(uci.cmd_setoption("MultiPV", str(multipv)))
        await self._send(uci.cmd_position(fen))
        await self._send(uci.cmd_go(depth=depth))

        lines: dict[int, PVLine] = {}
        best_move = ""
        ponder = None

        async for raw in self._read_lines():
            if raw.startswith("bestmove"):
                best_move, ponder = parse_bestmove(raw)
                break
            pv = parse_info_line(raw)
            if pv and pv.pv:
                multipv_idx = _extract_multipv(raw)
                lines[multipv_idx] = pv

        if multipv > 1:
            await self._send(uci.cmd_setoption("MultiPV", "1"))

        sorted_lines = [lines[k] for k in sorted(lines.keys())]
        return AnalysisResult(
            fen=fen,
            best_move=best_move,
            ponder=ponder,
            lines=sorted_lines,
            depth=sorted_lines[0].depth if sorted_lines else depth,
        )

    async def analyse_stream(
        self, fen: str, depth: int = 20
    ) -> AsyncIterator[PVLine | AnalysisResult]:
        """Stream intermediate analysis info lines, then yield final result."""
        async with self._lock:
            await self._ensure_alive()
            await self._flush_pending()
            await self._send(uci.cmd_position(fen))
            await self._send(uci.cmd_go(depth=depth))

            latest: Optional[PVLine] = None
            async for raw in self._read_lines():
                if raw.startswith("bestmove"):
                    best_move, ponder = parse_bestmove(raw)
                    yield AnalysisResult(
                        fen=fen,
                        best_move=best_move,
                        ponder=ponder,
                        lines=[latest] if latest else [],
                        depth=latest.depth if latest else depth,
                    )
                    break
                pv = parse_info_line(raw)
                if pv and pv.pv:
                    latest = pv
                    yield pv

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

    async def _read_lines(self) -> AsyncIterator[str]:
        assert self._proc and self._proc.stdout
        while True:
            raw = await asyncio.wait_for(
                self._proc.stdout.readline(), timeout=30
            )
            if not raw:
                raise EngineDiedError("engine process exited unexpectedly")
            line = raw.decode().strip()
            if line:
                yield line

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
