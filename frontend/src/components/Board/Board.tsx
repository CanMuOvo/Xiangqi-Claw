import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function Board({
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
  // 动画看门狗定时器（rAF 中断时强制完成动画，防 playingRef 卡死）
  const watchdogRef = useRef<number | null>(null);

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
    // 动画看门狗：rAF 被系统节流/中断（手机切后台、低功耗模式）时，
    // playingRef 会一直卡 true，导致后续动画永远无法启动（表现为棋子瞬移）。
    // 每帧续命，rAF 停止后超时强制完成并复位。
    const armWatchdog = () => {
      if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        if (playingRef.current) {
          playingRef.current = false;
          animFinishedRef.current = true;
          setAnim(null);
          animQueueRef.current = [];
          onAnimDoneRef.current?.();
        }
      }, 500);
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setAnim({ piece, from, to, t });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
        armWatchdog();
      } else {
        if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
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
    armWatchdog();
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

  // 组件卸载时取消未完成的动画与看门狗
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
  }, []);

  const displayRow = (r: number) => flipped ? 9 - r : r;
  const displayCol = (c: number) => flipped ? 8 - c : c;

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
        // 走棋动画期间：当前动画的落点静止棋子不渲染（避免"静止棋子+插值棋子"重叠闪现）。
        // 用 effectiveAnim.to（实际播放中的动画落点）而非 lastMove.to——
        // 动画排队时（逐手回放/连续走子）lastMove 已指向新一步，旧动画落点会提前显形
        if (!animFinishedRef.current) {
          const hideTo = effectiveAnim?.to ?? lastMove?.to;
          if (hideTo && hideTo.row === r && hideTo.col === c) continue;
        }

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

  // 推演编号箭头：已移除（沙盘推演替代）
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="xiangqi-board"
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
      {renderAnimPiece()}
    </svg>
  );
}

// memo：动画播放期间父组件重渲染（如 WS 分析消息）时，棋盘 props 未变则跳过重渲染，
// 保住动画帧率（手机端尤其关键——XqpView 与走棋记录/分析面板同屏）
export default memo(Board);
