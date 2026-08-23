import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Board as BoardType, PieceChar, Square } from '../../lib/fen';
import { isRedPiece } from '../../lib/fen';
import { BOARD_THEMES, type BoardTheme } from '../../lib/boardThemes';
import './Board.css';

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

interface Props {
  board: BoardType;
  onMove?: (from: Square, to: Square) => void;
  legalTargets?: (sq: Square) => Square[];
  bestMoveArrow?: { from: Square; to: Square } | null;
  lastMove?: { from: Square; to: Square } | null;
  flipped?: boolean;
  /** 全部走子动画播放完毕时回调（用于外部等待动画结束） */
  onAnimDone?: () => void;
  /** 推演画线（拖动）与正常走棋（单击）共存，无需模式开关 */
  theme?: BoardTheme;
  /** 当前轮走方：下子的一方只能抬起自己的棋子 */
  turn?: 'w' | 'b';
}

function toX(col: number) { return PAD + col * CELL; }
function toY(row: number) { return PAD + row * CELL; }

export default function Board({
  board,
  onMove,
  legalTargets,
  bestMoveArrow,
  lastMove,
  flipped = false,
  onAnimDone,
  theme = BOARD_THEMES[0],
  turn,
}: Props) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Square[]>([]);
  // 推演：棋盘上"画箭头"的编号步（from→to），双击箭头回撤
  const [analysisMoves, setAnalysisMoves] = useState<{ from: Square; to: Square }[]>([]);
  // 画线状态：按下起点格 + 当前指针位置（预览）
  const [analysisLine, setAnalysisLine] = useState<{ from: Square; x: number; y: number } | null>(null);
  // 按下记录：超过拖拽阈值才进入画线，与单击走棋区分
  const [dragStart, setDragStart] = useState<{ sq: Square; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // 走子滑动动画：rAF 逐帧插值
  const [anim, setAnim] = useState<{
    piece: PieceChar;
    from: Square;
    to: Square;
    t: number;
  } | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const animQueueRef = useRef<{ piece: PieceChar; from: Square; to: Square }[]>([]);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  // 最近一次动画是否已完成：完成后停止"渲染期派生初始动画"（lastMove 保留给上一步标记）
  const animFinishedRef = useRef(true);
  // 渲染期同步：识别"新的动画请求"（lastMove 变化）并立即置 animFinished=false，
  // 避免首帧（useLayoutEffect 运行前）派生动画不生效导致棋子瞬移
  const lastMoveRef = useRef(lastMove);
  if (lastMove !== lastMoveRef.current) {
    animFinishedRef.current = false;
    lastMoveRef.current = lastMove;
  }
  const onAnimDoneRef = useRef(onAnimDone);
  onAnimDoneRef.current = onAnimDone;

  const playNext = useCallback(() => {
    if (playingRef.current) return;
    const next = animQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    const { piece, from, to } = next;
    const start = performance.now();
    // 按走子距离定速（每格约 140ms，视觉速度恒定，避免长短距离看起来快慢不一）
    const dist = Math.hypot(to.row - from.row, to.col - from.col);
    const dur = Math.min(600, Math.max(200, dist * 140));
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setAnim({ piece, from, to, t });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setAnim(null);
        animFinishedRef.current = true; // 动画完成
        playingRef.current = false;
        playNext();
        if (animQueueRef.current.length === 0) {
          onAnimDoneRef.current?.();
        }
      }
    };
    // 同步设置初始帧（t=0）：局面已更新（目标格有子），若等 rAF 下一帧
    // 会有一整帧渲染 anim 为空 → 目标格棋子闪现一帧
    tick(start);
  }, []);

  // 动画在绘制前同步启动（useLayoutEffect）：避免"局面已更新但 anim 未设置"的闪现帧
  useLayoutEffect(() => {
    if (!lastMove) return;
    const { from, to } = lastMove;
    const piece = boardRef.current[to.row][to.col];
    if (!piece) return;
    animFinishedRef.current = false; // 新走棋：动画未完成
    animQueueRef.current.push({ piece, from, to });
    playNext();
  }, [lastMove, playNext]);

  // 组件卸载时取消未完成的动画
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const displayRow = (r: number) => flipped ? 9 - r : r;
  const displayCol = (c: number) => flipped ? 8 - c : c;

  // 推演：撤掉第 index 步及之后的所有步（按编号顺序回撤）
  const undoAnalysisFrom = useCallback((index: number) => {
    setAnalysisMoves(prev => prev.slice(0, index));
  }, []);

  // 拖拽坐标：client 像素 → SVG viewBox 坐标
  const toSvgPoint = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) * (SVG_W / rect.width),
      y: (e.clientY - rect.top) * (SVG_H / rect.height),
    };
  };

  // 最近的棋盘格
  const squareAt = (x: number, y: number): Square | null => {
    let bestSq: Square | null = null;
    let bestDist = Infinity;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const sx = toX(displayCol(c));
        const sy = toY(displayRow(r));
        const d = Math.hypot(x - sx, y - sy);
        if (d < bestDist) { bestDist = d; bestSq = { row: r, col: c }; }
      }
    }
    return bestDist < CELL * 0.7 ? bestSq : null;
  };

  // 画线推演：按住拖动（任意格起，超过阈值）进入画线；未拖动则走单击走棋
  const handleBoardPointerDown = (e: React.PointerEvent) => {
    const p = toSvgPoint(e);
    const sq = squareAt(p.x, p.y);
    if (!sq) return;
    setDragStart({ sq, x: p.x, y: p.y });
  };

  const handleBoardPointerMove = (e: React.PointerEvent) => {
    if (analysisLine) {
      const p = toSvgPoint(e);
      setAnalysisLine({ ...analysisLine, x: p.x, y: p.y });
      return;
    }
    if (dragStart) {
      const p = toSvgPoint(e);
      if (Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 6) {
        setAnalysisLine({ from: dragStart.sq, x: p.x, y: p.y });
      }
    }
  };

  const handleBoardPointerUp = (e: React.PointerEvent) => {
    setDragStart(null);
    if (!analysisLine) return;
    const p = toSvgPoint(e);
    const end = squareAt(p.x, p.y);
    if (end && !(end.row === analysisLine.from.row && end.col === analysisLine.from.col)) {
      // 拖动到另一格 → 推演一步（编号箭头），棋子不动
      setAnalysisMoves(prev => [...prev, { from: analysisLine.from, to: end }]);
    }
    setAnalysisLine(null);
  };

  const handleClick = useCallback(
    (row: number, col: number) => {
      const piece = board[row][col];
      if (selected) {
        if (row === selected.row && col === selected.col) {
          setSelected(null);
          setTargets([]);
          return;
        }
        // 点另一个我方棋子：切换选中（原棋子落下、新棋子抬起，同时动画）
        const selectedPiece = board[selected.row][selected.col];
        if (piece && selectedPiece && isRedPiece(piece) === isRedPiece(selectedPiece)) {
          setSelected({ row, col });
          if (legalTargets) setTargets(legalTargets({ row, col }));
          return;
        }
        if (onMove) onMove(selected, { row, col });
        setSelected(null);
        setTargets([]);
        setAnalysisMoves([]); // 真实走棋：推演箭头失去意义，清除
      } else if (piece && (!turn || isRedPiece(piece) === (turn === 'w'))) {
        // 只能抬起当前轮走方自己的棋子
        setSelected({ row, col });
        if (legalTargets) setTargets(legalTargets({ row, col }));
      }
    },
    [board, selected, onMove, legalTargets, turn],
  );

  const renderGrid = () => {
    const lines: React.JSX.Element[] = [];
    const stroke = { stroke: theme.line };
    for (let r = 0; r < 10; r++) {
      lines.push(
        <line key={`h${r}`}
          x1={toX(0)} y1={toY(r)} x2={toX(8)} y2={toY(r)}
          className="board-line" style={stroke}
        />,
      );
    }
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        lines.push(
          <line key={`v${c}`}
            x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(9)}
            className="board-line" style={stroke}
          />,
        );
      } else {
        lines.push(
          <line key={`vt${c}`}
            x1={toX(c)} y1={toY(0)} x2={toX(c)} y2={toY(4)}
            className="board-line" style={stroke}
          />,
        );
        lines.push(
          <line key={`vb${c}`}
            x1={toX(c)} y1={toY(5)} x2={toX(c)} y2={toY(9)}
            className="board-line" style={stroke}
          />,
        );
      }
    }
    // Palace diagonals
    lines.push(
      <line key="pd1" x1={toX(3)} y1={toY(0)} x2={toX(5)} y2={toY(2)} className="board-line" style={stroke} />,
      <line key="pd2" x1={toX(5)} y1={toY(0)} x2={toX(3)} y2={toY(2)} className="board-line" style={stroke} />,
      <line key="pd3" x1={toX(3)} y1={toY(7)} x2={toX(5)} y2={toY(9)} className="board-line" style={stroke} />,
      <line key="pd4" x1={toX(5)} y1={toY(7)} x2={toX(3)} y2={toY(9)} className="board-line" style={stroke} />,
    );
    return lines;
  };

  // 拟真木纹：木色渐变 + 纤维条纹/细颗粒 feTurbulence + 疏密不一的年轮弧线
  const renderWoodRings = () => {
    // 年轮位置系数 + 起伏幅度：手工排布出疏密不均、深浅交替的整板年轮
    const specs: Array<[number, number]> = [
      [0.10, 5], [0.34, 9], [0.44, 6], [0.72, 12], [0.83, 7], [1.06, 10],
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

  const renderHighlights = () => {
    const elems: React.JSX.Element[] = [];
    if (lastMove) {
      // 起子格：小实心白点 + 外层细圆环
      const fx = toX(displayCol(lastMove.from.col));
      const fy = toY(displayRow(lastMove.from.row));
      elems.push(
        <circle key="lm-from-dot" cx={fx} cy={fy} r={CELL * 0.12} className="lm-from-dot" />,
        <circle key="lm-from-ring" cx={fx} cy={fy} r={CELL * 0.24} className="lm-from-ring" />,
      );
      // 落子格白环：仅在走子动画播放完毕后显示，与落子瞬间同步亮起
      if (!anim) {
        const tx = toX(displayCol(lastMove.to.col));
        const ty = toY(displayRow(lastMove.to.row));
        elems.push(
          <circle key="lm-to-ring" cx={tx} cy={ty} r={CELL * 0.46} className="lm-to-ring" />,
        );
      }
    }
    // 推荐箭头的起点棋子：绿色细环（与落子白环同款，画在棋子下层紧贴棋子）
    if (bestMoveArrow) {
      const fx = toX(displayCol(bestMoveArrow.from.col));
      const fy = toY(displayRow(bestMoveArrow.from.row));
      elems.push(
        <circle key="arrow-from-ring" cx={fx} cy={fy} r={CELL * 0.46} className="arrow-from-ring" />,
      );
    }
    for (const t of targets) {
      const occupied = board[t.row][t.col] !== null;
      elems.push(
        <circle key={`t${t.row}${t.col}`}
          cx={toX(displayCol(t.col))}
          cy={toY(displayRow(t.row))}
          r={occupied ? CELL * 0.4 : 8}
          className={occupied ? 'target-capture' : 'target-dot'}
        />,
      );
    }
    return elems;
  };

  const renderArrow = () => {
    if (!bestMoveArrow) return null;
    const { from, to } = bestMoveArrow;
    const x1 = toX(displayCol(from.col));
    const y1 = toY(displayRow(from.row));
    const x2 = toX(displayCol(to.col));
    const y2 = toY(displayRow(to.row));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    const ux = dx / len;
    const uy = dy / len;
    // 线从起点棋子边缘外出发，终点前收住给箭头头留空间
    const startOff = CELL * 0.52;
    const endOff = CELL * 0.36;
    const sx = x1 + ux * startOff;
    const sy = y1 + uy * startOff;
    const ex = x2 - ux * endOff;
    const ey = y2 - uy * endOff;
    // 箭头头：尖端落在终点中心，底边略缩回
    const headLen = CELL * 0.38;
    const headHalf = CELL * 0.18;
    const px = -uy;
    const py = ux;
    const tip = `${x2},${y2}`;
    const bx = x2 - ux * headLen;
    const by = y2 - uy * headLen;
    const b1 = `${bx + px * headHalf},${by + py * headHalf}`;
    const b2 = `${bx - px * headHalf},${by - py * headHalf}`;
    return (
      <g className="best-move-arrow" key={`${from.col}${from.row}-${to.col}${to.row}`}>
        <defs>
          <linearGradient id="bm-arrow-grad" gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        {/* 柔光层：粗半透明，营造光晕 */}
        <line
          x1={sx} y1={sy} x2={ex} y2={ey}
          stroke="url(#bm-arrow-grad)" strokeWidth="9" opacity="0.16"
          strokeLinecap="round"
        />
        {/* 主线：起点淡绿 → 终点亮绿 */}
        <line
          x1={sx} y1={sy} x2={ex} y2={ey}
          stroke="url(#bm-arrow-grad)" strokeWidth="4"
          strokeLinecap="round"
        />
        <polygon points={`${tip} ${b1} ${b2}`} fill="url(#bm-arrow-grad)" />
      </g>
    );
  };

  // 动画棋子（含"渲染期派生"的初始帧）：
  // anim 未设置但刚走棋（lastMove 存在、动画未完成）时，从 lastMove 派生 t=0 的动画，
  // 保证落点棋子从不闪现（不依赖 useEffect/useLayoutEffect 的时序）
  let effectiveAnim: { piece: PieceChar; from: Square; to: Square; t: number } | null = anim;
  if (!effectiveAnim && lastMove && !animFinishedRef.current) {
    const p = board[lastMove.to.row]?.[lastMove.to.col];
    if (p) {
      effectiveAnim = { piece: p, from: lastMove.from, to: lastMove.to, t: 0 };
    }
  }

  const renderPieces = () => {
    const pieces: React.JSX.Element[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        // 走棋动画期间（lastMove 存在、动画未完成）：落点静止棋子永不渲染
        // （直接按 lastMove 判定，不依赖 anim/派生 的时序）——动画完成后落点正常显示
        if (lastMove && !animFinishedRef.current && lastMove.to.row === r && lastMove.to.col === c) continue;

        const x = toX(displayCol(c));
        const y = toY(displayRow(r));
        const isRed = isRedPiece(piece);
        const lifted = selected && selected.row === r && selected.col === c;

        pieces.push(
          <g key={`p${r}${c}`}
            className={`piece-group${lifted ? ' lifted' : ''}`}
            onClick={() => handleClick(r, c)}
            style={{ cursor: 'pointer' }}
          >
            {lifted && (
              <ellipse
                cx={x} cy={y + CELL * 0.5}
                rx={CELL * 0.34} ry={CELL * 0.09}
                className="piece-shadow"
              />
            )}
            <circle cx={x} cy={y} r={CELL * 0.42}
              className={isRed ? 'piece-bg-red' : 'piece-bg-black'}
            />
            <circle cx={x} cy={y} r={CELL * 0.38}
              className="piece-inner-ring"
            />
            <text x={x} y={y}
              className={isRed ? 'piece-text-red' : 'piece-text-black'}
              textAnchor="middle" dominantBaseline="central"
              fontSize={CELL * 0.44} fontWeight="bold"
            >
              {PIECE_NAMES[piece]}
            </text>
            {lifted && (
              <circle
                cx={x} cy={y} r={CELL * 0.52}
                className="piece-glow-ring"
              />
            )}
          </g>,
        );
      }
    }
    return pieces;
  };

  // 滑动动画中的棋子：插值位置渲染，动画结束由静态棋子接管
  const renderAnimPiece = () => {
    if (!effectiveAnim) return null;
    const { piece, from, to, t } = effectiveAnim;
    // easeOutCubic：加速启动、平稳落地
    const e = 1 - Math.pow(1 - t, 3);
    const x = toX(displayCol(from.col)) + (toX(displayCol(to.col)) - toX(displayCol(from.col))) * e;
    const y = toY(displayRow(from.row)) + (toY(displayRow(to.row)) - toY(displayRow(from.row))) * e;
    const isRed = isRedPiece(piece);
    return (
      <g className="piece-group anim-piece" style={{ pointerEvents: 'none' }}>
        <circle cx={x} cy={y} r={CELL * 0.42}
          className={isRed ? 'piece-bg-red' : 'piece-bg-black'}
        />
        <circle cx={x} cy={y} r={CELL * 0.38}
          className="piece-inner-ring"
        />
        <text x={x} y={y}
          className={isRed ? 'piece-text-red' : 'piece-text-black'}
          textAnchor="middle" dominantBaseline="central"
          fontSize={CELL * 0.44} fontWeight="bold"
        >
          {PIECE_NAMES[piece]}
        </text>
      </g>
    );
  };

  const renderClickTargets = () => {
    const rects: React.JSX.Element[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c]) continue;
        rects.push(
          <rect key={`ct${r}${c}`}
            x={toX(displayCol(c)) - CELL / 2}
            y={toY(displayRow(r)) - CELL / 2}
            width={CELL} height={CELL}
            fill="transparent"
            onClick={() => handleClick(r, c)}
          />,
        );
      }
    }
    return rects;
  };

  // 推演编号箭头：橙色箭头 + 落点数字，双击箭头回撤该步及后续（按顺序）
  const renderAnalysisArrows = () => {
    if (analysisMoves.length === 0) return null;
    return analysisMoves.map((m, i) => {
      const x1 = toX(displayCol(m.from.col));
      const y1 = toY(displayRow(m.from.row));
      const x2 = toX(displayCol(m.to.col));
      const y2 = toY(displayRow(m.to.row));
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len === 0) return null;
      const ux = dx / len;
      const uy = dy / len;
      const startHasPiece = board[m.from.row][m.from.col] !== null;
      // 空格起点：线从起始圆球中心出发（圆球后画盖住线头）；棋子起点：线从棋子边缘出发
      const startOff = startHasPiece ? CELL * 0.52 : 0;
      const endOff = CELL * 0.4;
      const sx = x1 + ux * startOff;
      const sy = y1 + uy * startOff;
      const ex = x2 - ux * endOff;
      const ey = y2 - uy * endOff;
      const headLen = CELL * 0.34;
      const headHalf = CELL * 0.22;
      const px = -uy;
      const py = ux;
      const tip = `${x2},${y2}`;
      const bx = x2 - ux * headLen;
      const by = y2 - uy * headLen;
      const b1 = `${bx + px * headHalf},${by + py * headHalf}`;
      const b2 = `${bx - px * headHalf},${by - py * headHalf}`;
      // 编号圆底在箭头“菱形”中心（底边中点）：落点正中心留给“空格起点”的起始圆球
      const mx = bx;
      const my = by;
      return (
        <g key={`an${i}`} className="analysis-arrow" onDoubleClick={() => undoAnalysisFrom(i)}>
          <line
            x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="#f97316" strokeWidth="3.5" opacity="0.85"
            strokeLinecap="round"
          />
          <polygon points={`${tip} ${b1} ${b2}`} fill="#f97316" opacity="0.9" />
          <circle cx={mx} cy={my} r={10} className="analysis-num-bg" />
          <text x={mx} y={my}
            className="analysis-num"
            textAnchor="middle" dominantBaseline="central"
            fontSize={12} fontWeight="bold"
          >
            {i + 1}
          </text>
          {!startHasPiece && (
            <circle
              cx={x1} cy={y1} r={CELL * 0.12}
              fill="#f97316" opacity="0.85" stroke="#ffffff" strokeWidth="1.5"
            />
          )}
        </g>
      );
    });
  };

  // 推演画线中的预览线（起点 → 当前指针，虚线；空格起点时带小圆球锚点）
  const renderAnalysisPreview = () => {
    if (!analysisLine) return null;
    const x1 = toX(displayCol(analysisLine.from.col));
    const y1 = toY(displayRow(analysisLine.from.row));
    const hasPiece = board[analysisLine.from.row][analysisLine.from.col] !== null;
    return (
      <g style={{ pointerEvents: 'none' }}>
        <line
          x1={x1} y1={y1} x2={analysisLine.x} y2={analysisLine.y}
          stroke="#f97316" strokeWidth="3" opacity="0.55"
          strokeLinecap="round" strokeDasharray="6 4"
        />
        {!hasPiece && (
          <circle
            cx={x1} cy={y1} r={CELL * 0.12}
            fill="#f97316" opacity="0.85" stroke="#ffffff" strokeWidth="1.5"
          />
        )}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="xiangqi-board"
      onPointerDown={handleBoardPointerDown}
      onPointerMove={handleBoardPointerMove}
      onPointerUp={handleBoardPointerUp}
    >
      <defs>
        <linearGradient id="wood-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.surface[0]} />
          <stop offset="50%" stopColor={theme.surface[1]} />
          <stop offset="100%" stopColor={theme.surface[2]} />
        </linearGradient>
        {/* 纤维条纹层：各向异性噪声（x 低频 y 高频）→ 横向拉丝木纹 */}
        <filter id="wood-stripe" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={theme.stripeFreq.join(' ')} numOctaves="4" seed="5" />
          <feColorMatrix
            type="matrix"
            values={`0 0 0 0 ${theme.noiseRgb[0]}  0 0 0 0 ${theme.noiseRgb[1]}  0 0 0 0 ${theme.noiseRgb[2]}  0 0 0 ${theme.stripeAlpha} 0`}
          />
        </filter>
        {/* 细颗粒层：均匀细噪声 → 木质毛孔细节 */}
        <filter id="wood-grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency={theme.grainFreq.join(' ')} numOctaves="3" seed="9" />
          <feColorMatrix
            type="matrix"
            values={`0 0 0 0 ${theme.noiseRgb[0]}  0 0 0 0 ${theme.noiseRgb[1]}  0 0 0 0 ${theme.noiseRgb[2]}  0 0 0 ${theme.grainAlpha} 0`}
          />
        </filter>
      </defs>
      <rect
        x="0" y="0" width={SVG_W} height={SVG_H}
        className="board-bg" rx="10"
        fill={theme.bg} stroke={theme.bgStroke}
      />
      <rect
        x={PAD - CELL / 2} y={PAD - CELL / 2}
        width={BOARD_W + CELL} height={BOARD_H + CELL}
        className="board-surface" rx="6"
        fill="url(#wood-grad)" stroke={theme.line}
      />
      {/* 纤维条纹木纹层 */}
      <rect
        x={PAD - CELL / 2} y={PAD - CELL / 2}
        width={BOARD_W + CELL} height={BOARD_H + CELL}
        rx="6"
        filter="url(#wood-stripe)"
      />
      {/* 细颗粒层 */}
      <rect
        x={PAD - CELL / 2} y={PAD - CELL / 2}
        width={BOARD_W + CELL} height={BOARD_H + CELL}
        rx="6"
        filter="url(#wood-grain)"
      />
      {renderWoodRings()}
      {renderGrid()}
      {renderRiver()}
      {renderHighlights()}
      {renderClickTargets()}
      {renderPieces()}
      {renderArrow()}
      {renderAnalysisArrows()}
      {renderAnalysisPreview()}
      {renderAnimPiece()}
    </svg>
  );
}
