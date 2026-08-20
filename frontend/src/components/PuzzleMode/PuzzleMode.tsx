import { useCallback, useState } from 'react';
import { Board } from '../Board';
import type { Square } from '../../lib/fen';
import { parseFen, applyMove } from '../../lib/fen';
import { isLegalMove, getLegalTargets } from '../../lib/xiangqi';
import './PuzzleMode.css';

interface Puzzle {
  id: number;
  fen: string;
  solution: string[];
  difficulty: string;
  theme: string;
  description: string;
}

const DIFF_LABELS: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export default function PuzzleMode() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [position, setPosition] = useState(parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'));
  const [solveIndex, setSolveIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'solving' | 'correct' | 'wrong'>('idle');
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<string | null>(null);

  const loadPuzzle = useCallback(async () => {
    setLoading(true);
    try {
      const url = difficulty
        ? `/api/puzzle/random?difficulty=${difficulty}`
        : '/api/puzzle/random';
      const resp = await fetch(url);
      if (resp.ok) {
        const data: Puzzle = await resp.json();
        setPuzzle(data);
        setPosition(parseFen(data.fen));
        setSolveIndex(0);
        setStatus('solving');
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [difficulty]);

  const handleMove = useCallback(
    (from: Square, to: Square) => {
      if (status !== 'solving' || !puzzle) return;
      if (!isLegalMove(position, from, to)) return;

      const uci = `${String.fromCharCode(97 + from.col)}${9 - from.row}${String.fromCharCode(97 + to.col)}${9 - to.row}`;
      const expected = puzzle.solution[solveIndex];

      if (uci === expected) {
        const newPos = applyMove(position, from, to);
        setPosition(newPos);

        if (solveIndex + 1 >= puzzle.solution.length) {
          setStatus('correct');
        } else {
          setSolveIndex(solveIndex + 1);
        }
      } else {
        setStatus('wrong');
      }
    },
    [position, puzzle, solveIndex, status],
  );

  const legalTargets = useCallback(
    (sq: Square) => getLegalTargets(position, sq),
    [position],
  );

  return (
    <div className="puzzle-mode">
      <div className="puzzle-controls">
        <h2>练习题</h2>
        <div className="diff-buttons">
          {['easy', 'medium', 'hard'].map(d => (
            <button
              key={d}
              className={`diff-btn ${difficulty === d ? 'active' : ''}`}
              onClick={() => setDifficulty(difficulty === d ? null : d)}
            >
              {DIFF_LABELS[d]}
            </button>
          ))}
        </div>
        <button
          className="new-puzzle-btn"
          onClick={loadPuzzle}
          disabled={loading}
        >
          {loading ? '加载中...' : '新题目'}
        </button>
      </div>

      {puzzle && (
        <div className="puzzle-info">
          <span className={`diff-badge ${puzzle.difficulty}`}>
            {DIFF_LABELS[puzzle.difficulty] || puzzle.difficulty}
          </span>
          <span className="puzzle-desc">{puzzle.description}</span>
        </div>
      )}

      <Board
        board={position.board}
        onMove={status === 'solving' ? handleMove : undefined}
        legalTargets={status === 'solving' ? legalTargets : undefined}
      />

      {status === 'correct' && (
        <div className="puzzle-result correct">
          正确！做得好！
          <button className="next-btn" onClick={loadPuzzle}>下一题</button>
        </div>
      )}
      {status === 'wrong' && (
        <div className="puzzle-result wrong">
          不对哦，再想想！
          <button className="retry-btn" onClick={() => {
            if (puzzle) {
              setPosition(parseFen(puzzle.fen));
              setSolveIndex(0);
              setStatus('solving');
            }
          }}>
            重试
          </button>
        </div>
      )}
      {status === 'idle' && (
        <div className="puzzle-hint">
          点击 "新题目" 开始练习
        </div>
      )}
    </div>
  );
}
