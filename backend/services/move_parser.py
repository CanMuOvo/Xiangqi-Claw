"""Parse Chinese xiangqi notation into UCI moves.

Supports:
  - Standard notation: "炮二平五", "马八进七", "车一进一"
  - Casual / ambiguous input falls back to OpenAI
"""

from __future__ import annotations

import re
from typing import Optional

from openai import AsyncOpenAI

PIECE_MAP = {
    "车": "r", "車": "r",
    "马": "n", "馬": "n",
    "象": "b", "相": "b",
    "士": "a", "仕": "a",
    "将": "k", "帅": "k", "帥": "k",
    "炮": "c", "砲": "c",
    "兵": "p", "卒": "p",
}

CN_DIGITS = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9,
    "１": 1, "２": 2, "３": 3, "４": 4, "５": 5,
    "６": 6, "７": 7, "８": 8, "９": 9,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5,
    "6": 6, "7": 7, "8": 8, "9": 9,
}

ACTIONS = {"进": "forward", "退": "backward", "平": "horizontal"}

PIECE_CHARS = "".join(PIECE_MAP.keys())
DIGIT_CHARS = "".join(CN_DIGITS.keys())
ACTION_CHARS = "".join(ACTIONS.keys())

STANDARD_RE = re.compile(
    rf"([{PIECE_CHARS}])([{DIGIT_CHARS}])([{ACTION_CHARS}])([{DIGIT_CHARS}])"
)

FEN_PIECE_ORDER = {
    "r": "车", "n": "马", "b": "象", "a": "士", "k": "将", "c": "炮", "p": "卒",
    "R": "车", "N": "马", "B": "相", "A": "仕", "K": "帅", "C": "炮", "P": "兵",
}

COLUMN_FILES = list("abcdefghi")


def _is_red_turn(fen: str) -> bool:
    parts = fen.split()
    return len(parts) < 2 or parts[1] == "w"


def _parse_board(fen: str) -> list[list[str]]:
    """Return 10x9 board[row][col], row 0 = rank 9 (top/black side)."""
    ranks = fen.split()[0].split("/")
    board: list[list[str]] = []
    for rank_str in ranks:
        row: list[str] = []
        for ch in rank_str:
            if ch.isdigit():
                row.extend([""] * int(ch))
            else:
                row.append(ch)
        board.append(row)
    return board


def _find_pieces(board: list[list[str]], piece_fen: str, col: int) -> list[tuple[int, int]]:
    """Find all positions of a given FEN piece char in a specific column."""
    results = []
    for r in range(10):
        if board[r][col] == piece_fen:
            results.append((r, col))
    return results


def parse_standard_notation(text: str, fen: str) -> Optional[str]:
    """Try to parse standard Chinese notation into a UCI move string.

    Returns None if the notation cannot be parsed.
    """
    m = STANDARD_RE.search(text)
    if not m:
        return None

    piece_cn, col_cn, action_cn, target_cn = m.groups()
    is_red = _is_red_turn(fen)
    board = _parse_board(fen)

    col_num = CN_DIGITS[col_cn]
    target_num = CN_DIGITS[target_cn]
    action = ACTIONS[action_cn]

    if is_red:
        from_col = 9 - col_num  # red counts right to left
    else:
        from_col = col_num - 1  # black counts left to right

    piece_lower = PIECE_MAP[piece_cn]
    piece_fen = piece_lower.upper() if is_red else piece_lower

    candidates = _find_pieces(board, piece_fen, from_col)
    if not candidates:
        return None

    # Pick the piece (for simplicity, take the first match; "前/后" disambiguation is TODO)
    from_row, from_col = candidates[0]

    if action == "horizontal":
        if is_red:
            to_col = 9 - target_num
        else:
            to_col = target_num - 1
        to_row = from_row
    elif action in ("forward", "backward"):
        is_straight = piece_lower in ("r", "c", "p", "k")

        if is_straight:
            delta = target_num
            if action == "forward":
                to_row = from_row - delta if is_red else from_row + delta
            else:
                to_row = from_row + delta if is_red else from_row - delta
            to_col = from_col
        else:
            # Knight, elephant, advisor: target_num is the destination column
            if is_red:
                to_col = 9 - target_num
            else:
                to_col = target_num - 1

            col_diff = abs(to_col - from_col)
            if piece_lower == "n":
                row_diff = 3 - col_diff  # knight: col_diff=1 -> row_diff=2, col_diff=2 -> row_diff=1
            elif piece_lower == "b":
                row_diff = 2  # elephant always moves 2 rows
            elif piece_lower == "a":
                row_diff = 1  # advisor always moves 1 row
            else:
                row_diff = 1

            if action == "forward":
                to_row = from_row - row_diff if is_red else from_row + row_diff
            else:
                to_row = from_row + row_diff if is_red else from_row - row_diff
    else:
        return None

    if not (0 <= to_row < 10 and 0 <= to_col < 9):
        return None

    from_file = COLUMN_FILES[from_col]
    to_file = COLUMN_FILES[to_col]
    from_rank = 9 - from_row
    to_rank = 9 - to_row

    return f"{from_file}{from_rank}{to_file}{to_rank}"


async def parse_with_llm(
    text: str, fen: str, legal_moves: list[str], client: AsyncOpenAI
) -> Optional[str]:
    """Use OpenAI to interpret casual/ambiguous Chinese text into a UCI move."""
    moves_str = ", ".join(legal_moves) if legal_moves else "(not provided)"
    prompt = f"""You are a Chinese chess (Xiangqi) move interpreter.
Given the current board position (FEN) and the user's description of a move in Chinese,
return EXACTLY one UCI-format move (e.g. "b0c2") from the legal moves list.

FEN: {fen}
User input: {text}
Legal moves: {moves_str}

IMPORTANT: respond with ONLY the UCI move string, nothing else. If you cannot determine the move, respond with "none"."""

    from backend.services.openai_client import LLM_MODEL
    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=10,
        temperature=0,
    )
    result = resp.choices[0].message.content.strip().lower()
    if result in legal_moves:
        return result
    return None
