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
import { isLegalMove, getLegalTargets, isCheckmate, isStalemate, getLegalMovesUci } from '../lib/xiangqi';

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

  const legalTargets = useCallback(
    (sq: Square) => getLegalTargets(position, sq),
    [position],
  );

  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (gameOver) return false;
      if (!isLegalMove(position, from, to)) return false;

      const newPos = applyMove(position, from, to);
      const move = uciMove(from, to);
      const fen = toFen(newPos);

      const newHistory = [...moveHistory.slice(0, currentIndex + 1), { uci: move, fen }];
      setPosition(newPos);
      setMoveHistory(newHistory);
      setCurrentIndex(newHistory.length - 1);

      if (isCheckmate(newPos)) {
        setGameOver(newPos.turn === 'w' ? '黑方胜' : '红方胜');
      } else if (isStalemate(newPos)) {
        setGameOver('和棋');
      }

      return true;
    },
    [position, moveHistory, currentIndex, gameOver],
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
      if (index === -1) {
        setPosition(parseFen(baseFen));
      } else {
        setPosition(parseFen(moveHistory[index].fen));
      }
      setCurrentIndex(index);
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
    (moves: string[], startFen?: string) => {
      const fen = startFen || baseFen;
      let pos = parseFen(fen);
      const history: MoveRecord[] = [];

      for (const m of moves) {
        const { from, to } = parseUciMove(m);
        pos = applyMove(pos, from, to);
        history.push({ uci: m, fen: toFen(pos) });
      }

      setBaseFen(fen);
      setPosition(pos);
      setMoveHistory(history);
      setCurrentIndex(history.length - 1);
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
