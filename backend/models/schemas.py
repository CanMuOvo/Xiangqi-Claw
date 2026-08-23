from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

STARTING_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"


class Side(str, Enum):
    RED = "w"
    BLACK = "b"


class MoveRequest(BaseModel):
    fen: str
    move: str  # UCI format e.g. "b0c2"


class TextMoveRequest(BaseModel):
    fen: str
    text: str  # natural language e.g. "马八进七"
    legal_moves: list[str] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    fen: str
    depth: int = 20
    multipv: int = 1


class PVLine(BaseModel):
    depth: int
    score_cp: int
    score_mate: Optional[int] = None
    wdl: Optional[tuple[int, int, int]] = None
    pv: list[str]
    nodes: int = 0
    nps: int = 0
    multipv: int = 1


class AnalysisResult(BaseModel):
    fen: str
    best_move: str
    ponder: Optional[str] = None
    lines: list[PVLine] = Field(default_factory=list)
    depth: int = 0
    # 分支推演：预设走法序列（从 fen 局面开始依次走完，引擎从序列结束后的局面继续搜索）
    preset_moves: list[str] = Field(default_factory=list)


class ExplanationRequest(BaseModel):
    fen: str
    user_move: str
    best_move: str
    user_move_cn: str = ""
    best_move_cn: str = ""
    user_score_cp: int
    best_score_cp: int
    prev_score_cp: Optional[int] = None
    pv_after_user: list[str] = Field(default_factory=list)
    pv_after_best: list[str] = Field(default_factory=list)
    move_number: int = 1
    side: Side = Side.RED
    player_at_bottom: str = "w"


class ExplanationResponse(BaseModel):
    explanation: str
    quality: str  # "brilliant", "good", "inaccuracy", "mistake", "blunder"
    score_loss: int


class CoachMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class CoachRequest(BaseModel):
    fen: str
    question: str  # 学生对当前局面的想法/提问
    history_cn: str = ""  # 走棋历史（中文记谱）
    player_at_bottom: str = "w"
    engine_score_cp: int = 0  # 走棋方视角
    engine_best_move_cn: str = ""
    engine_pv_cn: list[str] = Field(default_factory=list)
    messages: list[CoachMessage] = Field(default_factory=list)  # 多轮对话历史


class CoachResponse(BaseModel):
    reply: str
    # 沙盘演示：可逐步走出的走法序列（UCI），前端可一键进入沙盘自动演示
    sandbox_moves: list[str] = Field(default_factory=list)


class PuzzleOut(BaseModel):
    id: int
    fen: str
    solution: list[str]
    difficulty: str
    theme: str
    description: str


class GameRecord(BaseModel):
    fen: str = STARTING_FEN
    moves: list[str] = Field(default_factory=list)
    red_player: str = ""
    black_player: str = ""


class ReviewMove(BaseModel):
    move: str
    fen_before: str
    fen_after: str
    score_cp: int
    best_move: str
    best_score_cp: int
    quality: str
    explanation: str


class GameReview(BaseModel):
    moves: list[ReviewMove]
    summary: str
    red_accuracy: float
    black_accuracy: float
