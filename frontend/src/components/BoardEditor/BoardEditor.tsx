import React, { useCallback, useState } from 'react';
import type { Board, PieceChar, Side } from '../../lib/fen';
import { STARTING_FEN, parseFen, toFen, isRedPiece } from '../../lib/fen';
import type { BoardTheme } from '../../lib/boardThemes';
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
  /** 当前棋盘主题：编辑器棋盘与主棋盘视觉一致 */
  theme: BoardTheme;
}

export default function BoardEditor({ onConfirm, onCancel, theme }: Props) {
  const [board, setBoard] = useState<Board>(() => parseFen(STARTING_FEN).board);
  const [turn, setTurn] = useState<Side>('w');
  const [selectedPiece, setSelectedPiece] = useState<PieceChar | 'erase' | null>(null);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

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
      setFenError(null);
    } catch {
      setFenError('FEN 无效，请检查后重试');
    }
  };

  const handleConfirm = () => {
    const pos = { board, turn };
    onConfirm(toFen(pos));
  };

  const currentFen = toFen({ board, turn });

  // 年轮弧线：与主棋盘一致的木纹细节
  const renderWoodRings = () => {
    const specs = [
      [0.3, 4], [0.55, 7], [0.8, 5], [1.05, 9], [1.3, 6], [1.55, 8],
    ];
    const top = PAD - CELL / 2;
    const h = BOARD_H + CELL;
    return (
      <g>
        {specs.map(([k, amp], i) => {
          const y = top + k * h;
          return (
            <path key={`ring${i}`}
              d={`M ${toX(0)} ${y} C ${toX(2)} ${y - amp} ${toX(6)} ${y + amp} ${toX(8)} ${y}`}
              className="wood-ring"
              style={{ stroke: theme.line, opacity: theme.ringOpacity * (1 - (i % 2) * 0.5) }}
            />
          );
        })}
      </g>
    );
  };

  const renderRiver = () => (
    <text
      x={SVG_W / 2}
      y={toY(4.5)}
      className="river-text"
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ fill: theme.line }}
    >
      <tspan>楚 河</tspan>
      <tspan dx={CELL * 2.75}>漢 界</tspan>
    </text>
  );

  const renderGrid = () => {
    const lines: React.JSX.Element[] = [];
    const stroke = { stroke: theme.line };
    for (let r = 0; r < 10; r++) {
      lines.push(
        <line key={`h${r}`} x1={toX(0)} y1={toY(r)} x2={toX(8)} y2={toY(r)} className="board-line" style={stroke} />,
      );
    }
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        lines.push(<line key={`v${c}`} x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(9)} className="board-line" style={stroke} />);
      } else {
        lines.push(<line key={`vt${c}`} x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(4)} className="board-line" style={stroke} />);
        lines.push(<line key={`vb${c}`} x1={toX(c)} y1={toY(5)} x2={toX(c)} y2={toY(9)} className="board-line" style={stroke} />);
      }
    }
    lines.push(
      <line key="pd1" x1={toX(3)} y1={toY(0)} x2={toX(5)} y2={toY(2)} className="board-line" style={stroke} />,
      <line key="pd2" x1={toX(5)} y1={toY(0)} x2={toX(3)} y2={toY(2)} className="board-line" style={stroke} />,
      <line key="pd3" x1={toX(3)} y1={toY(7)} x2={toX(5)} y2={toY(9)} className="board-line" style={stroke} />,
      <line key="pd4" x1={toX(5)} y1={toY(7)} x2={toX(3)} y2={toY(9)} className="board-line" style={stroke} />,
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
          <defs>
            <linearGradient id="editor-wood-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={theme.surface[0]} />
              <stop offset="50%" stopColor={theme.surface[1]} />
              <stop offset="100%" stopColor={theme.surface[2]} />
            </linearGradient>
            <filter id="editor-wood-stripe" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency={theme.stripeFreq.join(' ')} numOctaves="4" seed="5" />
              <feColorMatrix
                type="matrix"
                values={`0 0 0 0 ${theme.noiseRgb[0]}  0 0 0 0 ${theme.noiseRgb[1]}  0 0 0 0 ${theme.noiseRgb[2]}  0 0 0 ${theme.stripeAlpha} 0`}
              />
            </filter>
            <filter id="editor-wood-grain" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency={theme.grainFreq.join(' ')} numOctaves="3" seed="9" />
              <feColorMatrix
                type="matrix"
                values={`0 0 0 0 ${theme.noiseRgb[0]}  0 0 0 0 ${theme.noiseRgb[1]}  0 0 0 0 ${theme.noiseRgb[2]}  0 0 0 ${theme.grainAlpha} 0`}
              />
            </filter>
          </defs>
          <rect x="0" y="0" width={SVG_W} height={SVG_H} className="board-bg" rx="10" fill={theme.bg} stroke={theme.bgStroke} />
          <rect
            x={PAD - CELL / 2} y={PAD - CELL / 2}
            width={BOARD_W + CELL} height={BOARD_H + CELL}
            className="board-surface" rx="6"
            fill="url(#editor-wood-grad)" stroke={theme.line}
          />
          <rect x={PAD - CELL / 2} y={PAD - CELL / 2} width={BOARD_W + CELL} height={BOARD_H + CELL} rx="6" filter="url(#editor-wood-stripe)" />
          <rect x={PAD - CELL / 2} y={PAD - CELL / 2} width={BOARD_W + CELL} height={BOARD_H + CELL} rx="6" filter="url(#editor-wood-grain)" />
          {renderWoodRings()}
          {renderGrid()}
          {renderRiver()}
          {renderPieces()}
        </svg>
      </div>

      <div className="editor-sidebar">
        <h3>编辑棋局</h3>
        <p className="editor-hint">选择下方棋子，点击棋盘放置；再次点击已选棋子取消选择。</p>

        <div className="editor-section">
          {renderPiecePicker(RED_PIECES, '红方')}
          {renderPiecePicker(BLACK_PIECES, '黑方')}
        </div>

        <div className="editor-section">
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
        </div>

        <div className="editor-section fen-wrap">
          <div className="fen-section">
            <label className="fen-label">当前 FEN（点击复制）</label>
            <input className="fen-display" value={currentFen} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
          </div>

          <div className="fen-section">
            <label className="fen-label">导入 FEN</label>
            <div className="fen-import-row">
              <input
                className="fen-input"
                value={fenInput}
                onChange={e => { setFenInput(e.target.value); setFenError(null); }}
                placeholder="粘贴 FEN 字符串..."
              />
              <button className="fen-load-btn" onClick={handleLoadFen} disabled={!fenInput.trim()}>导入</button>
            </div>
            {fenError && <p className="fen-error">{fenError}</p>}
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
