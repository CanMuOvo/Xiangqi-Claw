"""Low-level helpers for building UCI command strings."""

from __future__ import annotations

from typing import List, Optional


def cmd_uci() -> str:
    return "uci"


def cmd_isready() -> str:
    return "isready"


def cmd_position(fen: str, moves: Optional[List[str]] = None) -> str:
    cmd = f"position fen {fen}"
    if moves:
        cmd += " moves " + " ".join(moves)
    return cmd


def cmd_go(
    depth: Optional[int] = None,
    movetime: Optional[int] = None,
    nodes: Optional[int] = None,
    infinite: bool = False,
) -> str:
    parts = ["go"]
    if infinite:
        parts.append("infinite")
    elif depth is not None:
        parts.append(f"depth {depth}")
    elif movetime is not None:
        parts.append(f"movetime {movetime}")
    elif nodes is not None:
        parts.append(f"nodes {nodes}")
    return " ".join(parts)


def cmd_stop() -> str:
    return "stop"


def cmd_quit() -> str:
    return "quit"


def cmd_setoption(name: str, value: Optional[str] = None) -> str:
    cmd = f"setoption name {name}"
    if value is not None:
        cmd += f" value {value}"
    return cmd
