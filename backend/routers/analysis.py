"""Engine analysis endpoints (REST and WebSocket)."""

from __future__ import annotations

import json
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from openai import APIStatusError

from backend.engine.manager import get_engine
from backend.models.schemas import (AnalysisRequest, AnalysisResult,
                                    CoachRequest, CoachResponse,
                                    ExplanationRequest, ExplanationResponse,
                                    PVLine)
from backend.services.llm import (
    explain_engine_verdict,
    extract_move_candidates,
    generate_coach_reply,
    generate_explanation,
)
from backend.services.move_parser import parse_standard_notation
from backend.services.openai_client import get_openai_client
from backend.services.notation import apply_uci, pv_to_chinese, uci_to_chinese

router = APIRouter(tags=["analysis"])


def judge_score_loss(loss: int) -> str:
    if loss <= 15:
        return "接近最佳"
    if loss <= 60:
        return "好棋"
    if loss <= 150:
        return "可以更好"
    if loss <= 300:
        return "略亏"
    return "漏招"


async def _analyse_best(fen: str):
    """分析当前局面，返回 (最佳走法, 最佳分数, 最佳变化线中文)。"""
    engine = await get_engine()
    cur = await engine.analyse(fen, depth=14, multipv=1)
    best_move = cur.best_move
    best_score = cur.lines[0].score_cp if cur.lines else 0
    best_cn = uci_to_chinese(best_move, fen) if best_move else ""
    best_pv = " ".join(pv_to_chinese(cur.lines[0].pv, fen)) if cur.lines and cur.lines[0].pv else ""
    return best_cn, best_score, best_pv


async def _check_mate(fen: str, depth: int = 18):
    """引擎算杀：返回 (mate, 最佳走法中文, 最佳变化线中文, 是否有合法走法)。
    mate>0 走棋方有杀，<0 走棋方被将死；无合法走法（已被将死/困毙）时 has_legal=False。"""
    engine = await get_engine()
    result = await engine.analyse(fen, depth=depth, multipv=1)
    if not result.lines:
        return None, "", "", False
    line = result.lines[0]
    best_move = result.best_move
    best_cn = uci_to_chinese(best_move, fen) if best_move and best_move != "(none)" else ""
    pv_cn = " ".join(pv_to_chinese(line.pv, fen)) if line.pv else ""
    return line.score_mate, best_cn, pv_cn, True


async def _analyse_after_move(fen: str, uci: str) -> Optional[int]:
    """走一步 UCI 后分析新局面，返回走棋方视角分数；非法走法返回 None。"""
    new_fen = apply_uci(fen, uci)
    if not new_fen:
        return None
    engine = await get_engine()
    after = await engine.analyse(new_fen, depth=14, multipv=1)
    after_score_side = after.lines[0].score_cp if after.lines else 0
    return -after_score_side  # 转成走棋方视角（走法后轮到对方）


async def verify_move_with_engine(fen: str, uci: str, question: str = "") -> Optional[str]:
    """引擎验证单个具体走法：分数对比 + 走法后的真实推演变化线 + 担心的子力追踪。"""
    best_cn, best_score, best_pv = await _analyse_best(fen)
    new_fen = apply_uci(fen, uci)
    if not new_fen:
        return None
    engine = await get_engine()
    after = await engine.analyse(new_fen, depth=14, multipv=1)
    after_score_side = after.lines[0].score_cp if after.lines else 0
    user_score = -after_score_side  # 转成走棋方视角（走法后轮到对方）
    user_cn = uci_to_chinese(uci, fen)
    # 走法后的真实推演：引擎对后续局面的最优变化（含对方最佳应对，如吃马）
    user_pv = (
        " ".join(pv_to_chinese(after.lines[0].pv, new_fen))
        if after.lines and after.lines[0].pv
        else ""
    )
    loss = max(0, best_score - user_score)
    reply = (
        f"【引擎验证】你提到「{user_cn}」：这步走后走棋方约 {user_score:+d} 分，"
        f"最佳着法「{best_cn or '未知'}」走后约 {best_score:+d} 分，"
        f"差距 {loss} 分，判定：{judge_score_loss(loss)}。"
    )
    if user_pv:
        reply += f"\n【引擎推演后续】{user_cn} {user_pv}"
    # 子力追踪：学生担心某子被吃时，引擎沿推演数棋子确定吃没吃
    if question:
        worried_char, worried_cn = _extract_worried_piece(question)
        if worried_char and after.lines and after.lines[0].pv:
            is_red = fen.split()[1] == "w"
            survival = _track_piece_survival(
                fen, [uci] + after.lines[0].pv, worried_char, is_red
            )
            reply += f"\n【子力追踪】你担心的{worried_cn}：{survival}。"
    reply += f"\n最佳变化线：{best_pv or '暂无'}。"
    return reply


async def verify_moves_with_engine(fen: str, cn_moves: list[str]) -> Optional[str]:
    """引擎验证 LLM 生成的多个候选走法，返回汇总回答；全部验证失败返回 None。"""
    best_cn, best_score, best_pv = await _analyse_best(fen)
    details: list[str] = []
    for cn in cn_moves:
        uci = parse_standard_notation(cn, fen)
        if not uci:
            continue
        user_score = await _analyse_after_move(fen, uci)
        if user_score is None:
            continue
        loss = max(0, best_score - user_score)
        details.append(
            f"- {cn}：走后约 {user_score:+d} 分（最佳 {best_cn or '未知'} 约 {best_score:+d} 分，"
            f"差距 {loss}，{judge_score_loss(loss)}）"
        )
    if not details:
        return None
    return (
        "【引擎验证】你的想法，我理解为以下候选走法：\n"
        + "\n".join(details)
        + (f"\n建议：当前最佳着法是「{best_cn}」，比上面这些选择更稳妥。" if best_cn else "")
        + f"\n最佳变化线：{best_pv or '暂无'}。"
    )


PIECE_CN = {"N": "马", "R": "车", "C": "炮", "P": "兵", "B": "相", "A": "仕"}


def _extract_worried_piece(question: str):
    """从学生话里提取担心的棋子（如「丢马」「马被吃」「马不要了」）。"""
    for cn, char in [("马", "N"), ("车", "R"), ("炮", "C"), ("兵", "P"), ("相", "B"), ("仕", "A")]:
        if (
            f"丢{cn}" in question or f"{cn}被吃" in question
            or f"{cn}不要" in question or f"{cn}没了" in question
            or f"{cn}丢" in question
        ):
            return char, cn
    return None, None


def _track_piece_survival(fen: str, pv: list[str], piece_char: str, is_red: bool) -> str:
    """沿推演变化线追踪某棋子是否被吃：数 FEN 中该棋子字符数量变化（确定性引擎数据）。"""
    piece = piece_char.upper() if is_red else piece_char.lower()
    count = fen.split()[0].count(piece)
    if count == 0:
        return "当前局面已无此子"
    current = fen
    for i, uci in enumerate(pv, 1):
        new_fen = apply_uci(current, uci)
        if not new_fen:
            break
        new_count = new_fen.split()[0].count(piece)
        if new_count < count:
            cn = uci_to_chinese(uci, current)
            return f"第 {i} 步「{cn}」被吃（数量 {count}→{new_count}）"
        current = new_fen
    return "推演结束时仍在棋盘上（安全）"


def build_quick_reply(
    fen: str, question: str, score: int, best_cn: str, best_pv: str
) -> str:
    """快捷问题（谁优势/怎么走/局面评估）：基于引擎分析结果生成模板回答。"""
    turn = fen.split()[1]
    # 优势方：score 是走棋方视角（正=走棋方优）
    side = "红方" if (score > 0 and turn == "w") or (score <= 0 and turn == "b") else "黑方"
    abs_score = abs(score)
    if abs_score < 50:
        desc = "双方基本均势"
    elif abs_score < 200:
        desc = f"{side}略占优势（{abs_score} 分）"
    elif abs_score < 500:
        desc = f"{side}优势明显（{abs_score} 分）"
    else:
        desc = f"{side}大幅领先（{abs_score} 分）"

    # 最佳走法属于轮到走的一方
    best_side = "红方" if turn == "w" else "黑方"
    if "怎么走" in question:
        return (
            f"引擎建议走（{best_side}）：{best_cn or '分析中'}。后续变化：{best_pv or '分析中'}。"
            f"这是当前局面的最优选择，按这条线走可保持主动。"
        )
    return (
        f"引擎评估：{desc}。最佳走法（{best_side}）：{best_cn or '分析中'}。"
        f"后续变化：{best_pv or '分析中'}。"
    )


async def _with_verdict_explanation(
    question: str, verdict: str, history_cn: str, fen: str, client
) -> CoachResponse:
    """引擎验证结果 + LLM 解读（带棋盘子力信息）；解读失败时回落纯数据回答。"""
    try:
        explained = await explain_engine_verdict(question, verdict, history_cn, fen, client)
        return CoachResponse(reply=f"{verdict}\n\n【教练解读】{explained}")
    except Exception:
        return CoachResponse(reply=verdict)


@router.post("/api/analysis", response_model=AnalysisResult)
async def analyse_position(req: AnalysisRequest):
    engine = await get_engine()
    result = await engine.analyse(req.fen, depth=req.depth, multipv=req.multipv)
    return result


@router.post("/api/explain", response_model=ExplanationResponse)
async def explain_move(req: ExplanationRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=400, detail="未配置 OpenAI API Key")
    try:
        return await generate_explanation(req, get_openai_client())
    except APIStatusError as e:
        msg = ""
        try:
            body = e.body if isinstance(e.body, dict) else {}
            msg = body.get("error", {}).get("message", "")
        except Exception:
            msg = ""
        if "Insufficient Balance" in msg:
            raise HTTPException(
                status_code=502,
                detail="DeepSeek 账户余额不足，请前往 platform.deepseek.com 充值后重试",
            )
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败：{msg or e.status_code}")


@router.post("/api/coach", response_model=CoachResponse)
async def coach(req: CoachRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=400, detail="未配置 OpenAI API Key")
    client = get_openai_client()

    # 快捷问题（谁优势/怎么走/局面评估）：后端实时引擎分析 + 模板回答，不依赖前端缓存
    if any(k in req.question for k in ("优势", "怎么走", "局面", "形势", "谁优", "哪边好")):
        try:
            best_cn, best_score, best_pv = await _analyse_best(req.fen)
            return CoachResponse(
                reply=build_quick_reply(req.fen, req.question, best_score, best_cn, best_pv)
            )
        except Exception:
            pass

    # 杀棋检测问题（绝杀/有杀/能杀/将死等）：引擎算杀，不走候选走法流程
    if any(k in req.question for k in ("绝杀", "杀棋", "有杀", "能杀", "杀法", "连杀", "将死", "必杀", "无解", "算杀")):
        try:
            mate, best_cn, pv_cn, has_legal = await _check_mate(req.fen)
            turn = "红方" if req.fen.split()[1] == "w" else "黑方"
            if not has_legal:
                # 引擎无变化线输出 → 当前走棋方无合法着法（已被将死/困毙），对局已结束
                reply = f"【引擎算杀】当前局面 {turn} 已经无棋可走（被将死或困毙），对局已结束。"
            elif mate is not None and mate > 0:
                reply = (
                    f"【引擎算杀】当前局面 {turn} 有杀！引擎找到强制连杀（mate {mate}）。\n"
                    f"杀法路线：{pv_cn if pv_cn else best_cn or '分析中'}。"
                )
            elif mate is not None and mate < 0:
                reply = (
                    f"【引擎算杀】当前局面 {turn} 已无解：对方存在强制杀棋（mate {-mate}）。\n"
                    f"最佳应对：{pv_cn if pv_cn else best_cn or '分析中'}。"
                )
            else:
                reply = (
                    f"【引擎算杀】当前局面暂无直接杀棋（引擎深度 18 未发现强制连杀）。\n"
                    f"当前最佳着法：{best_cn or '分析中'}。"
                )
            return CoachResponse(reply=reply)
        except Exception:
            pass

    # 第一层：规则解析成功（标准记谱，如「马七进八」）→ 单走法引擎验证 + LLM 解读（带棋盘子力）
    uci = parse_standard_notation(req.question, req.fen)
    if uci:
        try:
            reply = await verify_move_with_engine(req.fen, uci, req.question)
            if reply:
                return await _with_verdict_explanation(
                    req.question, reply, req.history_cn, req.fen, client
                )
        except Exception:
            pass
    else:
        # 第二层：规则失败 → LLM 生成候选走法 → 引擎逐个验证 + LLM 解读
        try:
            cn_moves = await extract_move_candidates(req.question, req.fen, client)
            if cn_moves:
                reply = await verify_moves_with_engine(req.fen, cn_moves)
                if reply:
                    return await _with_verdict_explanation(
                        req.question, reply, req.history_cn, req.fen, client
                    )
        except Exception:
            pass

    # 第三层：最终回落 → LLM 直接回答（被引擎数据约束）
    # 先强制用后端引擎刷新当前局面的数据，防止前端关闭分析面板导致旧数据
    try:
        best_cn, best_score, best_pv = await _analyse_best(req.fen)
        req.engine_score_cp = best_score
        req.engine_best_move_cn = best_cn
        req.engine_pv_cn = best_pv.split(" ") if best_pv else []
    except Exception:
        pass
    try:
        return await generate_coach_reply(req, client)
    except APIStatusError as e:
        msg = ""
        try:
            body = e.body if isinstance(e.body, dict) else {}
            msg = body.get("error", {}).get("message", "")
        except Exception:
            msg = ""
        if "Insufficient Balance" in msg:
            raise HTTPException(
                status_code=502,
                detail="DeepSeek 账户余额不足，请前往 platform.deepseek.com 充值后重试",
            )
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败：{msg or e.status_code}")


@router.websocket("/ws/analysis")
async def ws_analysis(websocket: WebSocket):
    await websocket.accept()
    engine = await get_engine()
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            fen = msg.get("fen", "")
            depth = msg.get("depth", 18)

            async for item in engine.analyse_stream(fen, depth=depth):
                if isinstance(item, PVLine):
                    await websocket.send_json({
                        "type": "info",
                        "fen": fen,
                        "depth": item.depth,
                        "score_cp": item.score_cp,
                        "score_mate": item.score_mate,
                        "wdl": item.wdl,
                        "pv": item.pv,
                        "pv_cn": pv_to_chinese(item.pv, fen),
                        "nodes": item.nodes,
                        "nps": item.nps,
                    })
                elif isinstance(item, AnalysisResult):
                    await websocket.send_json({
                        "type": "bestmove",
                        "fen": fen,
                        "best_move": item.best_move,
                        "best_move_cn": uci_to_chinese(item.best_move, fen),
                        "ponder": item.ponder,
                        "depth": item.depth,
                        "lines": [
                            {
                                "depth": l.depth,
                                "score_cp": l.score_cp,
                                "pv": l.pv,
                            }
                            for l in item.lines
                        ],
                    })
    except WebSocketDisconnect:
        pass
