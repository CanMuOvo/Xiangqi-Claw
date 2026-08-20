"""UCI 走法 → 中文记谱转换（后端权威转换）。

由后端基于自己分析时的权威局面转换，前端直接显示，
避免前端局面不同步导致显示原始坐标。
"""

from __future__ import annotations

import re
from typing import Optional

RED_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
BLACK_DIGITS = ["", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
PIECE_NAMES = {
    "R": "车", "N": "马", "B": "相", "A": "仕", "K": "帅", "C": "炮", "P": "兵",
    "r": "车", "n": "马", "b": "象", "a": "士", "k": "将", "c": "炮", "p": "卒",
}
_UCI_RE = re.compile(r"^[a-i][0-9][a-i][0-9]$")


def _parse_board(fen: str) -> list[list[Optional[str]]]:
    board: list[list[Optional[str]]] = []
    for rank in fen.split()[0].split("/"):
        row: list[Optional[str]] = []
        for ch in rank:
            if ch.isdigit():
                row.extend([None] * int(ch))
            else:
                row.append(ch)
        board.append(row)
    return board


def fen_to_description(fen: str) -> str:
    """把 FEN 转成 LLM 能理解的棋子位置文本（AI 教练用它"看懂"棋盘）。"""
    board = _parse_board(fen)
    red: list[str] = []
    black: list[str] = []
    red_count: dict[str, int] = {}
    black_count: dict[str, int] = {}
    for row in range(10):
        for col in range(9):
            p = board[row][col]
            if not p:
                continue
            sq = f"{chr(97 + col)}{9 - row}"
            name = PIECE_NAMES.get(p, "?")
            if p.isupper():
                red.append(f"{name}{sq}")
                red_count[name] = red_count.get(name, 0) + 1
            else:
                black.append(f"{name}{sq}")
                black_count[name] = black_count.get(name, 0) + 1
    turn = "红" if fen.split()[1] == "w" else "黑"
    red_summary = "、".join(
        f"{name}{n}"
        for name, n in [
            ("车", red_count.get("车", 0)), ("马", red_count.get("马", 0)),
            ("炮", red_count.get("炮", 0)), ("兵", red_count.get("兵", 0)),
            ("相", red_count.get("相", 0)), ("仕", red_count.get("仕", 0)),
        ]
        if n > 0
    )
    black_summary = "、".join(
        f"{name}{n}"
        for name, n in [
            ("车", black_count.get("车", 0)), ("马", black_count.get("马", 0)),
            ("炮", black_count.get("炮", 0)), ("卒", black_count.get("卒", 0)),
            ("象", black_count.get("象", 0)), ("士", black_count.get("士", 0)),
        ]
        if n > 0
    )
    return (
        f"红方棋子位置：{'、'.join(red) or '无'}。红方子力：{red_summary or '无'}。"
        f"黑方棋子位置：{'、'.join(black) or '无'}。黑方子力：{black_summary or '无'}。"
        f"当前轮到{turn}方走。"
    )


def apply_uci(fen: str, uci: str) -> Optional[str]:
    """应用一步 UCI 走法到 fen，返回新 fen；走法非法时返回 None。"""
    if not _UCI_RE.match(uci):
        return None
    board = _parse_board(fen)
    from_col = ord(uci[0]) - 97
    from_rank = int(uci[1])
    to_col = ord(uci[2]) - 97
    to_rank = int(uci[3])
    from_row, to_row = 9 - from_rank, 9 - to_rank
    if not (0 <= from_row < 10 and 0 <= from_col < 9 and 0 <= to_row < 10 and 0 <= to_col < 9):
        return None
    piece = board[from_row][from_col]
    if not piece:
        return None
    board[from_row][from_col] = None
    board[to_row][to_col] = piece
    ranks = []
    for row in board:
        rank = ""
        empty = 0
        for cell in row:
            if cell is None:
                empty += 1
            else:
                if empty:
                    rank += str(empty)
                    empty = 0
                rank += cell
        if empty:
            rank += str(empty)
        ranks.append(rank)
    turn = "b" if fen.split()[1] == "w" else "w"
    return f"{'/'.join(ranks)} {turn} - - 0 1"


def uci_to_chinese(uci: str, fen: str) -> str:
    """单步 UCI → 中文记谱；无法解析时原样返回。"""
    if not _UCI_RE.match(uci):
        return uci
    board = _parse_board(fen)
    from_col = ord(uci[0]) - 97
    from_rank = int(uci[1])
    to_col = ord(uci[2]) - 97
    to_rank = int(uci[3])
    from_row, to_row = 9 - from_rank, 9 - to_rank
    try:
        piece = board[from_row][from_col]
    except IndexError:
        return uci
    if not piece:
        return uci
    is_red = piece.isupper()
    digits = RED_DIGITS if is_red else BLACK_DIGITS
    pname = PIECE_NAMES.get(piece, "?")
    col_disp = 9 - from_col if is_red else from_col + 1
    ptype = piece.lower()
    if from_row == to_row:
        action = "平"
        dest = (9 - to_col) if is_red else (to_col + 1)
        target = digits[dest]
    else:
        fwd = (to_row < from_row) if is_red else (to_row > from_row)
        action = "进" if fwd else "退"
        if ptype in ("r", "c", "p", "k"):
            target = digits[abs(to_row - from_row)]
        else:
            dest = (9 - to_col) if is_red else (to_col + 1)
            target = digits[dest]
    return f"{pname}{digits[col_disp]}{action}{target}"


def pv_to_chinese(pv: list[str], fen: str, max_moves: int = 6) -> list[str]:
    """把一条变化线逐手转中文（每手基于前一手之后的局面）。"""
    result: list[str] = []
    current = fen
    for uci in pv[:max_moves]:
        if not _UCI_RE.match(uci):
            result.append(uci)
            continue
        result.append(uci_to_chinese(uci, current))
        # 应用走法推进局面，供下一手转换
        board = _parse_board(current)
        from_col = ord(uci[0]) - 97
        from_rank = int(uci[1])
        to_col = ord(uci[2]) - 97
        to_rank = int(uci[3])
        from_row, to_row = 9 - from_rank, 9 - to_rank
        if not (0 <= from_row < 10 and 0 <= from_col < 9 and 0 <= to_row < 10 and 0 <= to_col < 9):
            continue
        piece = board[from_row][from_col]
        board[from_row][from_col] = None
        board[to_row][to_col] = piece
        ranks = []
        for row in board:
            rank = ""
            empty = 0
            for cell in row:
                if cell is None:
                    empty += 1
                else:
                    if empty:
                        rank += str(empty)
                        empty = 0
                    rank += cell
            if empty:
                rank += str(empty)
            ranks.append(rank)
        turn = "b" if current.split()[1] == "w" else "w"
        current = f"{'/'.join(ranks)} {turn} - - 0 1"
    return result
