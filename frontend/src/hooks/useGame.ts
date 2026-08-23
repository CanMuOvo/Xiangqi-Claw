import { useCallback, useState } from 'react';
import {
  type Position,
  type Square,
  STARTING_FEN,
  applyMove,
  parseFen,
  toFen,
  uciMove,
  parseUciMove,
} from '../lib/fen';
import { isLegalMove, getLegalTargets, isCheckmate, isStalemate, isInCheck, getLegalMovesUci } from '../lib/xiangqi';

export interface MoveRecord {
  uci: string;
  fen: string; // FEN after the move
}

export function useGame(defaultFen: string = STARTING_FEN) {
  const [baseFen, setBaseFen] = useState(defaultFen);
  const [position, setPosition] = useState<Position>(() => parseFen(defaultFen));
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [gameOver, setGameOver] = useState<string | null>(null);

  const currentFen = useCallback(() => toFen(position), [position]);

  const legalMoves = useCallback(() => getLegalMovesUci(position), [position]);

  // 长将判定：走 (from,to) 若将军且已是连续第 5 次将军 → 该着法不允许（中国象棋禁长将）
  const isFifthLongCheck = useCallback(
    (from: Square, to: Square): boolean => {
      if (gameOver) return false;
      const newPos = applyMove(position, from, to);
      if (!newPos || !isInCheck(newPos)) return false; // 这步不将军
      let consecutive = 1; // 含这步
      for (let i = moveHistory.length - 1; i >= 0; i--) {
        if (isInCheck(parseFen(moveHistory[i].fen))) {
          consecutive++;
        } else {
          break;
        }
      }
      return consecutive >= 5;
    },
    [position, moveHistory, gameOver],
  );

  const legalTargets = useCallback(
    (sq: Square) => getLegalTargets(position, sq).filter((t) => !isFifthLongCheck(sq, t)),
    [position, isFifthLongCheck],
  );

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (gameOver) return false;
      if (!isLegalMove(position, from, to)) return false;
      if (isFifthLongCheck(from, to)) return false; // 第 5 次连续长将：不允许

      const newPos = applyMove(position, from, to);
      const move = uciMove(from, to);
      const fen = toFen(newPos);

      const newHistory = [...moveHistory.slice(0, currentIndex + 1), { uci: move, fen }];
      setPosition(newPos);
      setMoveHistory(newHistory);
      setCurrentIndex(newHistory.length - 1);

      // 重复局面：同一局面第 3 次出现 → 双方不变作和
      const repeatCount = newHistory.filter((m) => m.fen === fen).length;
      if (repeatCount >= 3) {
        setGameOver('和棋（重复局面）');
        return true;
      }

      // 中国象棋：将死或困毙（无合法走法）均为判负，不是和棋
      if (isCheckmate(newPos) || isStalemate(newPos)) {
        setGameOver(newPos.turn === 'w' ? '黑方胜' : '红方胜');
      }

      return true;
    },
    [position, moveHistory, currentIndex, gameOver, isFifthLongCheck],
  );

  const tryMoveUci = useCallback(
    (uci: string): boolean => {
      const { from, to } = parseUciMove(uci);
      return tryMove(from, to);
    },
    [tryMove],
  );

  const goToMove = useCallback(
    (index: number) => {
      if (index < -1 || index >= moveHistory.length) return;
      const newPos = index === -1 ? parseFen(baseFen) : parseFen(moveHistory[index].fen);
      setPosition(newPos);
      setCurrentIndex(index);
      // 回退/前进到历史局面时重算终局状态：将死/困毙（判负）保留结果，正常局面解除限制
      if (isCheckmate(newPos) || isStalemate(newPos)) {
        setGameOver(newPos.turn === 'w' ? '黑方胜' : '红方胜');
      } else {
        setGameOver(null);
      }
    },
    [moveHistory, baseFen],
  );

  const reset = useCallback(
    (fen?: string) => {
      const f = fen || defaultFen;
      setBaseFen(f);
      setPosition(parseFen(f));
      setMoveHistory([]);
      setCurrentIndex(-1);
      setGameOver(null);
    },
    [defaultFen],
  );

  const endGame = useCallback((reason: string) => {
    setGameOver(reason);
  }, []);

  const loadMoves = useCallback(
    (moves: string[], startFen?: string, targetIndex?: number) => {
      const fen = startFen || baseFen;
      let pos = parseFen(fen);
      const history: MoveRecord[] = [];

      for (const m of moves) {
        const { from, to } = parseUciMove(m);
        pos = applyMove(pos, from, to);
        history.push({ uci: m, fen: toFen(pos) });
      }

      // 目标位置：缺省为最新；指定时精确恢复（含回看中间的局面）
      const idx = targetIndex === undefined ? history.length - 1 : Math.min(targetIndex, history.length - 1);
      let targetPos = parseFen(fen);
      for (let i = 0; i <= idx; i++) {
        const { from, to } = parseUciMove(history[i].uci);
        targetPos = applyMove(targetPos, from, to);
      }

      setBaseFen(fen);
      setPosition(targetPos);
      setMoveHistory(history);
      setCurrentIndex(idx);
      setGameOver(null);
    },
    [baseFen],
  );

  return {
    position,
    currentFen,
    moveHistory,
    currentIndex,
    gameOver,
    legalMoves,
    legalTargets,
    tryMove,
    tryMoveUci,
    goToMove,
    reset,
    loadMoves,
    endGame,
    baseFen,
  };
}
