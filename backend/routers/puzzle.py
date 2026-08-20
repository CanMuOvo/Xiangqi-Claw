"""Puzzle endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.models.schemas import PuzzleOut
from backend.services.puzzle import get_puzzle_by_id, get_random_puzzle

router = APIRouter(prefix="/api/puzzle", tags=["puzzle"])


@router.get("/random", response_model=PuzzleOut)
async def random_puzzle(difficulty: Optional[str] = Query(None)):
    p = await get_random_puzzle(difficulty)
    if not p:
        raise HTTPException(status_code=404, detail="暂无题目")
    return p


@router.get("/{puzzle_id}", response_model=PuzzleOut)
async def get_puzzle(puzzle_id: int):
    p = await get_puzzle_by_id(puzzle_id)
    if not p:
        raise HTTPException(status_code=404, detail="题目不存在")
    return p
