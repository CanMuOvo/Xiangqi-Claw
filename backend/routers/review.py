"""Game review endpoint."""

from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from backend.engine.manager import get_engine
from backend.models.schemas import GameRecord, GameReview, ReviewMove
from backend.services.llm import classify_quality_simple, generate_game_summary
from backend.services.openai_client import get_openai_client

router = APIRouter(prefix="/api/review", tags=["review"])


def _apply_move_to_fen(fen: str, move: str) -> str:
    """Minimal FEN update: just flip the side to move.

    Full FEN update requires a rule engine; the frontend handles accurate
    board state. This gives us a rough FEN for sequential engine queries.
    """
    parts = fen.split()
    board = parts[0]

    from_file = ord(move[0]) - ord("a")
    from_rank = int(move[1])
    to_file = ord(move[2]) - ord("a")
    to_rank = int(move[3])

    rows = board.split("/")
    rows.reverse()  # index 0 = rank 0

    def expand(row: str) -> list[str]:
        out: list[str] = []
        for ch in row:
            if ch.isdigit():
                out.extend(["1"] * int(ch))
            else:
                out.append(ch)
        return out

    def compress(cells: list[str]) -> str:
        result = []
        empty = 0
        for c in cells:
            if c == "1":
                empty += 1
            else:
                if empty:
                    result.append(str(empty))
                    empty = 0
                result.append(c)
        if empty:
            result.append(str(empty))
        return "".join(result)

    expanded = [expand(r) for r in rows]
    piece = expanded[from_rank][from_file]
    expanded[from_rank][from_file] = "1"
    expanded[to_rank][to_file] = piece

    rows_out = [compress(r) for r in expanded]
    rows_out.reverse()
    new_board = "/".join(rows_out)

    side = "b" if parts[1] == "w" else "w"
    rest = parts[2:] if len(parts) > 2 else ["- -", "0", "1"]
    return f"{new_board} {side} {' '.join(rest)}"


@router.post("/analyse", response_model=GameReview)
async def review_game(record: GameRecord):
    engine = await get_engine()
    review_moves: list[ReviewMove] = []
    current_fen = record.fen
    moves_data: list[dict] = []

    red_losses: list[int] = []
    black_losses: list[int] = []

    for i, move in enumerate(record.moves):
        fen_before = current_fen
        result = await engine.analyse(current_fen, depth=16, multipv=1)
        best_move = result.best_move
        best_score = result.lines[0].score_cp if result.lines else 0

        # Get score after user's actual move
        fen_after = _apply_move_to_fen(current_fen, move)
        user_result = await engine.analyse(fen_after, depth=14, multipv=1)
        user_score = -(user_result.lines[0].score_cp if user_result.lines else 0)

        score_loss = max(0, best_score - user_score)
        quality = classify_quality_simple(score_loss)

        review_move = ReviewMove(
            move=move,
            fen_before=fen_before,
            fen_after=fen_after,
            score_cp=user_score,
            best_move=best_move,
            best_score_cp=best_score,
            quality=quality,
            explanation="",
        )
        review_moves.append(review_move)
        moves_data.append({"move": move, "quality": quality, "score_loss": score_loss})

        if i % 2 == 0:
            red_losses.append(score_loss)
        else:
            black_losses.append(score_loss)

        current_fen = fen_after

    def accuracy(losses: list[int]) -> float:
        if not losses:
            return 100.0
        avg_loss = sum(losses) / len(losses)
        return max(0.0, min(100.0, 100.0 - avg_loss / 3.0))

    summary = ""
    if os.environ.get("OPENAI_API_KEY"):
        try:
            summary = await generate_game_summary(moves_data, get_openai_client())
        except Exception:
            summary = "无法生成总结"

    return GameReview(
        moves=review_moves,
        summary=summary,
        red_accuracy=round(accuracy(red_losses), 1),
        black_accuracy=round(accuracy(black_losses), 1),
    )
