"""Game state and move endpoints."""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from backend.models.schemas import STARTING_FEN, TextMoveRequest
from backend.services.move_parser import (parse_standard_notation,
                                          parse_with_llm)
from backend.services.openai_client import get_openai_client

router = APIRouter(prefix="/api/game", tags=["game"])


@router.get("/starting-fen")
async def get_starting_fen():
    return {"fen": STARTING_FEN}


@router.post("/parse-move")
async def parse_move(req: TextMoveRequest):
    """Parse Chinese notation text into a UCI move string."""
    uci_move = parse_standard_notation(req.text, req.fen)
    if uci_move:
        return {"move": uci_move, "method": "standard"}

    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=400,
            detail="无法解析该走法，且未配置 OpenAI API Key 以使用智能解析",
        )

    uci_move = await parse_with_llm(
        req.text, req.fen, req.legal_moves, get_openai_client()
    )
    if uci_move:
        return {"move": uci_move, "method": "llm"}

    raise HTTPException(status_code=400, detail="无法理解这步棋，请重新描述")
