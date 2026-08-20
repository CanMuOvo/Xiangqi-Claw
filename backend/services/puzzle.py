"""Puzzle management backed by SQLite."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import aiosqlite

from backend.models.schemas import PuzzleOut

DB_PATH = os.environ.get(
    "PUZZLE_DB",
    str(Path(__file__).resolve().parent.parent / "data" / "puzzles.db"),
)

SEED_PUZZLES = [
    {
        "fen": "3aka3/9/4b4/9/9/3R5/9/4B4/4A4/2BAK4 w - - 0 1",
        "solution": "d4d9",
        "difficulty": "easy",
        "theme": "checkmate",
        "description": "车杀底线",
    },
    {
        "fen": "2baka3/9/4b4/2p1C1p1p/9/2P6/4P1P1P/4C4/4A4/2BAK2R1 w - - 0 1",
        "solution": "e6e9",
        "difficulty": "easy",
        "theme": "checkmate",
        "description": "沉底炮将军",
    },
    {
        "fen": "4ka3/4a4/4b4/9/9/9/4n4/2n1B4/4A4/3AK3R w - - 0 1",
        "solution": "i0i9",
        "difficulty": "easy",
        "theme": "checkmate",
        "description": "车杀底线",
    },
    {
        "fen": "3k1a3/9/4ba3/9/4N4/3N5/9/4B4/4A4/2BAK4 w - - 0 1",
        "solution": "d4e6",
        "difficulty": "medium",
        "theme": "checkmate",
        "description": "双马饮泉",
    },
    {
        "fen": "2b1ka3/4a4/4b4/4C4/9/9/9/4B4/4A4/2BAK3R w - - 0 1",
        "solution": "e6e9",
        "difficulty": "medium",
        "theme": "sacrifice",
        "description": "弃炮引离，车杀底线",
    },
    {
        "fen": "4ka3/4a4/4b4/9/2b6/6R2/9/4B4/4A4/3AK4 w - - 0 1",
        "solution": "g4g9",
        "difficulty": "easy",
        "theme": "checkmate",
        "description": "车杀底线将军",
    },
    {
        "fen": "2baka3/9/4b4/p1C5p/6p2/9/P3P3P/4B4/4A4/2BAK4 w - - 0 1",
        "solution": "c6c9",
        "difficulty": "medium",
        "theme": "attack",
        "description": "炮轰底象，抢攻",
    },
    {
        "fen": "2bakab2/9/4c4/p3p1p1p/9/9/P3P1P1P/3CB4/4A4/2BAK4 w - - 0 1",
        "solution": "d2e4",
        "difficulty": "medium",
        "theme": "positional",
        "description": "出炮巡河，控制中路",
    },
    {
        "fen": "1rbakab1r/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/1RBAKAB1R w - - 0 1",
        "solution": "b0b4",
        "difficulty": "hard",
        "theme": "opening",
        "description": "飞相局，车四路出击",
    },
    {
        "fen": "3aka3/9/9/9/2b1R4/9/4r4/4B4/4A4/2BAK4 w - - 0 1",
        "solution": "e5e9",
        "difficulty": "hard",
        "theme": "checkmate",
        "description": "弃子强杀",
    },
]


async def init_db() -> None:
    """Create puzzle table and seed it if empty."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS puzzles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fen TEXT NOT NULL,
                solution TEXT NOT NULL,
                difficulty TEXT NOT NULL DEFAULT 'medium',
                theme TEXT NOT NULL DEFAULT 'checkmate',
                description TEXT NOT NULL DEFAULT ''
            )
        """)
        await db.commit()

        cursor = await db.execute("SELECT COUNT(*) FROM puzzles")
        row = await cursor.fetchone()
        if row[0] == 0:
            for p in SEED_PUZZLES:
                await db.execute(
                    "INSERT INTO puzzles (fen, solution, difficulty, theme, description) VALUES (?, ?, ?, ?, ?)",
                    (p["fen"], p["solution"], p["difficulty"], p["theme"], p["description"]),
                )
            await db.commit()


async def get_random_puzzle(difficulty: Optional[str] = None) -> Optional[PuzzleOut]:
    async with aiosqlite.connect(DB_PATH) as db:
        if difficulty:
            cursor = await db.execute(
                "SELECT id, fen, solution, difficulty, theme, description FROM puzzles WHERE difficulty = ? ORDER BY RANDOM() LIMIT 1",
                (difficulty,),
            )
        else:
            cursor = await db.execute(
                "SELECT id, fen, solution, difficulty, theme, description FROM puzzles ORDER BY RANDOM() LIMIT 1"
            )
        row = await cursor.fetchone()
        if not row:
            return None
        return PuzzleOut(
            id=row[0],
            fen=row[1],
            solution=row[2].split(",") if "," in row[2] else [row[2]],
            difficulty=row[3],
            theme=row[4],
            description=row[5],
        )


async def get_puzzle_by_id(puzzle_id: int) -> Optional[PuzzleOut]:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT id, fen, solution, difficulty, theme, description FROM puzzles WHERE id = ?",
            (puzzle_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        return PuzzleOut(
            id=row[0],
            fen=row[1],
            solution=row[2].split(",") if "," in row[2] else [row[2]],
            difficulty=row[3],
            theme=row[4],
            description=row[5],
        )
