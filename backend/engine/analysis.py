"""Parse UCI info and bestmove output into structured analysis results."""

from __future__ import annotations

import re
from typing import Optional

from backend.models.schemas import AnalysisResult, PVLine


def parse_info_line(line: str) -> Optional[PVLine]:
    """Parse a UCI 'info' line into a PVLine, or None if not a search info line."""
    if not line.startswith("info") or "depth" not in line:
        return None

    depth = _extract_int(line, "depth")
    if depth is None:
        return None

    score_cp = _extract_int(line, "score cp") or 0
    score_mate = _extract_int(line, "score mate")
    nodes = _extract_int(line, "nodes") or 0
    nps = _extract_int(line, "nps") or 0

    wdl = _extract_wdl(line)
    pv = _extract_pv(line)

    return PVLine(
        depth=depth,
        score_cp=score_cp,
        score_mate=score_mate,
        wdl=wdl,
        pv=pv,
        nodes=nodes,
        nps=nps,
    )


def parse_bestmove(line: str) -> tuple[str, Optional[str]]:
    """Parse a 'bestmove' line. Returns (best_move, ponder_move)."""
    parts = line.split()
    best = parts[1] if len(parts) > 1 else ""
    ponder = None
    if "ponder" in parts:
        idx = parts.index("ponder")
        if idx + 1 < len(parts):
            ponder = parts[idx + 1]
    return best, ponder


def _extract_int(line: str, key: str) -> Optional[int]:
    m = re.search(rf"\b{key}\s+(-?\d+)", line)
    return int(m.group(1)) if m else None


def _extract_wdl(line: str) -> Optional[tuple[int, int, int]]:
    m = re.search(r"\bwdl\s+(\d+)\s+(\d+)\s+(\d+)", line)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _extract_pv(line: str) -> list[str]:
    m = re.search(r"\bpv\s+(.+)$", line)
    if m:
        return m.group(1).strip().split()
    return []
