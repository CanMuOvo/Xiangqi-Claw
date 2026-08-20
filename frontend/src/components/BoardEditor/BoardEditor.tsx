import React, { useCallback, useState } from 'react';
import type { Board, PieceChar, Side } from '../../lib/fen';
import { STARTING_FEN, parseFen, toFen, isRedPiece } from '../../lib/fen';
import './BoardEditor.css';

const CELL = 64;
const PAD = 40;
const BOARD_W = CELL * 8;
const BOARD_H = CELL * 9;
const SVG_W = BOARD_W + PAD * 2;
const SVG_H = BOARD_H + PAD * 2;

const PIECE_NAMES: Record<string, string> = {
  R: '車', N: '馬', B: '相', A: '仕', K: '帥', C: '炮', P: '兵',
  r: '車', n: '馬', b: '象', a: '士', k: '將', c: '砲', p: '卒',
};

const RED_PIECES: PieceChar[] = ['K', 'R', 'N', 'B', 'A', 'C', 'P'];
const BLACK_PIECES: PieceChar[] = ['k', 'r', 'n', 'b', 'a', 'c', 'p'];

function toX(col: number) { return PAD + col * CELL; }
function toY(row: number) { return PAD + row * CELL; }

interface Props {
  onConfirm: (fen: string) => void;
  onCancel: () => void;
}

export default function BoardEditor({ onConfirm, onCancel }: Props) {
  const [board, setBoard] = useState<Board>(() => parseFen(STARTING_FEN).board);
  const [turn, setTurn] = useState<Side>('w');
  const [selectedPiece, setSelectedPiece] = useState<PieceChar | 'erase' | null>(null);
  const [fenInput, setFenInput] = useState('');

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!selectedPiece) return;
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      if (selectedPiece === 'erase') {
        next[row][col] = null;
      } else {
        next[row][col] = selectedPiece;
      }
      return next;
    });
  }, [selectedPiece]);

  const handleClear = () => {
    setBoard(Array.from({ length: 10 }, () => Array(9).fill(null)));
  };

  const handleReset = () => {
    setBoard(parseFen(STARTING_FEN).board);
    setTurn('w');
  };

  const handleLoadFen = () => {
    const trimmed = fenInput.trim();
    if (!trimmed) return;
    try {
      const pos = parseFen(trimmed);
      setBoard(pos.board);
      setTurn(pos.turn);
      setFenInput('');
    } catch {
      // invalid FEN, ignore
    }
  };

  const handleConfirm = () => {
    const pos = { board, turn };
    onConfirm(toFen(pos));
  };

  const currentFen = toFen({ board, turn });

  const renderGrid = () => {
    const lines: React.JSX.Element[] = [];
    for (let r = 0; r < 10; r++) {
      lines.push(
        <line key={`h${r}`} x1={toX(0)} y1={toY(r)} x2={toX(8)} y2={toY(r)} className="board-line" />,
      );
    }
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        lines.push(<line key={`v${c}`} x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(9)} className="board-line" />);
      } else {
        lines.push(<line key={`vt${c}`} x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(4)} className="board-line" />);
        lines.push(<line key={`vb${c}`} x1={toX(c)} y1={toY(5)} x2={toX(c)} y2={toY(9)} className="board-line" />);
      }
    }
    lines.push(
      <line key="pd1" x1={toX(3)} y1={toY(0)} x2={toX(5)} y2={toY(2)} className="board-line" />,
      <line key="pd2" x1={toX(5)} y1={toY(0)} x2={toX(3)} y2={toY(2)} className="board-line" />,
      <line key="pd3" x1={toX(3)} y1={toY(7)} x2={toX(5)} y2={toY(9)} className="board-line" />,
      <line key="pd4" x1={toX(5)} y1={toY(7)} x2={toX(3)} y2={toY(9)} className="board-line" />,
    );
    return lines;
  };

  const renderPieces = () => {
    const pieces: React.JSX.Element[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = board[r][c];
        const x = toX(c);
        const y = toY(r);

        pieces.push(
          <rect key={`bg${r}${c}`}
            x={x - CELL / 2} y={y - CELL / 2}
            width={CELL} height={CELL}
            fill="transparent"
            onClick={() => handleCellClick(r, c)}
            style={{ cursor: selectedPiece ? 'pointer' : 'default' }}
          />,
        );

        if (!piece) continue;
        const isRed = isRedPiece(piece);
        pieces.push(
          <g key={`p${r}${c}`} onClick={() => handleCellClick(r, c)} style={{ cursor: selectedPiece ? 'pointer' : 'default' }}>
            <circle cx={x} cy={y} r={CELL * 0.42} className={isRed ? 'piece-bg-red' : 'piece-bg-black'} />
            <circle cx={x} cy={y} r={CELL * 0.38} className="piece-inner-ring" />
            <text x={x} y={y}
              className={isRed ? 'piece-text-red' : 'piece-text-black'}
              textAnchor="middle" dominantBaseline="central"
              fontSize={CELL * 0.44} fontWeight="bold"
              style={{ pointerEvents: 'none' }}
            >
              {PIECE_NAMES[piece]}
            </text>
          </g>,
        );
      }
    }
    return pieces;
  };

  const renderPiecePicker = (pieces: PieceChar[], label: string) => (
    <div className="piece-picker-group">
      <span className="picker-label">{label}</span>
      <div className="picker-pieces">
        {pieces.map(p => (
          <button
            key={p}
            className={`picker-btn ${selectedPiece === p ? 'selected' : ''} ${isRedPiece(p) ? 'red' : 'black'}`}
            onClick={() => setSelectedPiece(selectedPiece === p ? null : p)}
          >
            {PIECE_NAMES[p]}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="board-editor">
      <div className="editor-board-area">
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="xiangqi-board">
          <rect x="0" y="0" width={SVG_W} height={SVG_H} className="board-bg" rx="8" />
          <rect
            x={PAD - CELL / 2} y={PAD - CELL / 2}
            width={BOARD_W + CELL} height={BOARD_H + CELL}
            className="board-surface" rx="4"
          />
          {renderGrid()}
          {renderPieces()}
        </svg>
      </div>

      <div className="editor-sidebar">
        <h3>编辑棋局</h3>
        <p className="editor-hint">选择下方棋子，然后点击棋盘放置。再次点击已选棋子可取消选择。</p>

        {renderPiecePicker(RED_PIECES, '红方')}
        {renderPiecePicker(BLACK_PIECES, '黑方')}

        <div className="piece-picker-group">
          <span className="picker-label">工具</span>
          <div className="picker-pieces">
            <button
              className={`picker-btn erase ${selectedPiece === 'erase' ? 'selected' : ''}`}
              onClick={() => setSelectedPiece(selectedPiece === 'erase' ? null : 'erase')}
            >
              擦除
            </button>
          </div>
        </div>

        <div className="turn-select">
          <span>走棋方:</span>
          <button className={`turn-btn ${turn === 'w' ? 'active' : ''}`} onClick={() => setTurn('w')}>红方</button>
          <button className={`turn-btn ${turn === 'b' ? 'active' : ''}`} onClick={() => setTurn('b')}>黑方</button>
        </div>

        <div className="fen-section">
          <label className="fen-label">FEN:</label>
          <input className="fen-display" value={currentFen} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
        </div>

        <div className="fen-section">
          <label className="fen-label">导入 FEN:</label>
          <div className="fen-import-row">
            <input
              className="fen-input"
              value={fenInput}
              onChange={e => setFenInput(e.target.value)}
              placeholder="粘贴 FEN 字符串..."
            />
            <button className="fen-load-btn" onClick={handleLoadFen} disabled={!fenInput.trim()}>导入</button>
          </div>
        </div>

        <div className="editor-actions">
          <button className="editor-btn secondary" onClick={handleReset}>初始局面</button>
          <button className="editor-btn secondary" onClick={handleClear}>清空棋盘</button>
        </div>
        <div className="editor-actions">
          <button className="editor-btn primary" onClick={handleConfirm}>确认开始</button>
          <button className="editor-btn secondary" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
