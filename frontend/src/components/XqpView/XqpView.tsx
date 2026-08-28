import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from '../../lib/fen';
import { parseUciMove } from '../../lib/fen';
import type { BoardTheme } from '../../lib/boardThemes';
import { useGame } from '../../hooks/useGame';
import { useEngine } from '../../hooks/useEngine';
import { Board } from '../Board';
import { MoveHistory } from '../MoveHistory';
import { AnalysisPanel } from '../AnalysisPanel';
import './XqpView.css';

export interface Book {
  title: string;
  result: string;
  fen: string;
  moves: string[];
}

export interface Category {
  name: string;
  subs?: Category[];
  books?: Book[];
}

interface XqpData {
  version: number;
  categories: Category[];
}

const RESULT_CN: Record<string, string> = {
  '1-0': '红胜',
  '0-1': '黑胜',
  '1/2-1/2': '和棋',
};

interface Props {
  onClose: () => void;
  theme: BoardTheme;
}

export default function XqpView({ onClose, theme }: Props) {
  const [data, setData] = useState<XqpData | null>(null);
  const [catPath, setCatPath] = useState<Category[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [search, setSearch] = useState('');
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [view, setView] = useState<'browse' | 'review'>('browse');
  // 复盘模式：引擎分析开关（默认开启）
  const [analysisOn, setAnalysisOn] = useState(true);
  const [ratesOn, setRatesOn] = useState(true);
  // 动画进行中：步进/跳转忽略点击，等位移播完再响应。
  // 完全对齐主棋盘沙盘：animBusy 用 ref 同步（点击拦截立即生效，无 useState 异步延迟）
  const animBusyRef = useRef(false);
  const setAnimBusyNow = useCallback((v: boolean) => {
    animBusyRef.current = v;
  }, []);
  // 复盘棋盘不可交互（点选/走棋返回 false）；稳定引用避免打破 Board 的 memo
  const noopMove = useCallback(() => false, []);
  // 动画完成解锁：稳定引用（内联箭头会打破 Board memo，
  // 导致手机端动画期间被父组件重渲染拖累而掉帧）
  const handleAnimDone = useCallback(() => setAnimBusyNow(false), [setAnimBusyNow]);
  const game = useGame();
  const engine = useEngine();

  useEffect(() => {
    fetch('/data/xqp.json')
      .then((r) => r.json())
      .then((d: XqpData) => setData(d))
      .catch(() => {});
  }, []);

  // 复盘分析：局面变化时延迟分析当前局面
  useEffect(() => {
    if (!book || !analysisOn) return;
    if (!engine.connected) return;
    const fen = game.currentFen();
    const t = window.setTimeout(() => {
      engine.analyse(fen);
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, book, analysisOn, engine.connected]);

  // 载入棋谱：重置到起始局面
  const loadBook = (b: Book) => {
    setBook(b);
    setIndex(0);
    setAuto(false);
    setAnimBusyNow(false);
    setLastMove(null);
    setView('review');
    game.loadMoves(b.moves, b.fen, 0);
  };

  // 复盘步进（带滑动动画；动画播放中忽略点击，播完再响应）。
  // 完全对齐主棋盘沙盘 stepSandbox：动画手从 game.moveHistory 取（与局面严格一致）
  const step = (dir: 1 | -1) => {
    if (!book) return;
    if (animBusyRef.current) return;
    const cur = game.currentIndex;
    const target = cur + dir;
    if (target < 0 || target >= book.moves.length) return;
    if (dir < 0) {
      // 后退：动画「被撤的一手」(cur) to→from
      const move = game.moveHistory[cur];
      if (!move) return;
      setAnimBusyNow(true);
      game.goToMove(target);
      const mv = parseUciMove(move.uci);
      setLastMove({ from: mv.to, to: mv.from });
    } else {
      // 前进：动画「目标手」from→to
      const move = game.moveHistory[target];
      if (!move) return;
      setAnimBusyNow(true);
      game.goToMove(target);
      const mv = parseUciMove(move.uci);
      setLastMove({ from: mv.from, to: mv.to });
    }
    setIndex(target);
  };

  // 跳转到指定步（进度条）：前进动画目标手、后退动画被撤手
  const jump = (target: number) => {
    if (!book) return;
    if (animBusyRef.current) return;
    const cur = game.currentIndex;
    const t = Math.max(0, Math.min(book.moves.length - 1, target));
    if (t === 0) {
      setAnimBusyNow(false);
      game.goToMove(0);
      setLastMove(null);
      setIndex(t);
      return;
    }
    // 前进动画目标手、后退动画被撤手（从 moveHistory 取，与局面严格一致）
    const animIdx = t > cur ? t : cur;
    const move = game.moveHistory[animIdx];
    if (!move) return;
    setAnimBusyNow(true);
    game.goToMove(t);
    const mv = parseUciMove(move.uci);
    setLastMove(t > cur ? { from: mv.from, to: mv.to } : { from: mv.to, to: mv.from });
    setIndex(t);
  };

  // 自动播放
  useEffect(() => {
    if (!auto || !book) return;
    const t = window.setTimeout(() => {
      if (game.currentIndex >= book.moves.length - 1) {
        setAuto(false);
        return;
      }
      step(1);
    }, 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, book, index]);

  // 当前节点与子层：支持任意层级（大类 → 书籍 → 子力类 → 棋谱）
  const currentNode = catPath.length > 0 ? catPath[catPath.length - 1] : null;
  const currentSubs = catPath.length === 0 ? (data?.categories ?? []) : (currentNode?.subs ?? []);
  const isLeaf =
    !!currentNode &&
    currentNode.books !== undefined &&
    (currentNode.subs?.length ?? 0) === 0;
  const currentBooks = useMemo(() => {
    if (!isLeaf || !currentNode?.books) return [];
    const q = search.trim();
    if (!q) return currentNode.books;
    return currentNode.books.filter((b) => b.title.includes(q));
  }, [isLeaf, currentNode, search]);

  return (
    <div className="xqp-view">
      <header className="xqp-header">
        <button className="xqp-back" onClick={onClose}>← 返回对局</button>
        <h2 className="xqp-title">
          📖 棋谱库
          {book && <span className="xqp-current">{book.title}</span>}
        </h2>
        <span className="xqp-header-spacer" />
      </header>

      <div className="xqp-layout">
        {/* 左：棋盘 + 复盘控制 */}
        <div className="xqp-board-col">
          <div className="board-wrap">
            <Board
              board={game.position.board}
              onMove={noopMove}
              legalTargets={undefined}
              bestMoveArrow={null}
              lastMove={lastMove}
              flipped={false}
              onAnimDone={handleAnimDone}
              theme={theme}
              turn={undefined}
            />
          </div>
          {book && (
            <div className="xqp-controls">
              <button
                className="xqp-btn"
                onClick={() => step(-1)}
                disabled={index <= 0}
                title="上一步"
              >
                ◀ 上一步
              </button>
              <button
                className={`xqp-btn auto${auto ? ' on' : ''}`}
                onClick={() => setAuto((v) => !v)}
                disabled={index >= book.moves.length - 1}
                title="自动播放"
              >
                {auto ? '⏸ 暂停' : '▶ 自动'}
              </button>
              <button
                className="xqp-btn"
                onClick={() => step(1)}
                disabled={index >= book.moves.length - 1}
                title="下一步"
              >
                下一步 ▶
              </button>
              <div className="xqp-progress">
                <input
                  type="range"
                  min={0}
                  max={book.moves.length - 1}
                  value={index}
                  onChange={(e) => jump(Number(e.target.value))}
                />
                <span className="xqp-progress-text">{index} / {book.moves.length}</span>
              </div>
            </div>
          )}
          {!book && (
            <p className="xqp-empty">从右侧选择一局棋谱开始复盘</p>
          )}
        </div>

        {/* 右：browse=分类导航+棋谱列表 / review=棋谱信息+走棋记录+引擎分析 */}
        <div className="xqp-side">
          {view === 'review' && book ? (
            <>
              <button className="xqp-crumb-up" onClick={() => setView('browse')}>
                ↖ 返回棋谱列表
              </button>
              <div className="xqp-book-head">
                <span className="xqp-book-title">{book.title}</span>
                <span className={`xqp-book-result r-${book.result === '1-0' ? 'red' : book.result === '0-1' ? 'black' : 'draw'}`}>
                  {RESULT_CN[book.result] ?? ''}
                </span>
              </div>
              <div className="xqp-records">
                <MoveHistory
                  moves={game.moveHistory}
                  currentIndex={game.currentIndex}
                  startFen={game.baseFen}
                  onGoTo={(i) => jump(i)}
                  stepByTurn={false}
                  humanIsRed
                  disabled={false}
                />
              </div>
              <AnalysisPanel
                info={engine.info}
                lines={engine.lines}
                analysing={engine.analysing}
                connected={engine.connected}
                fen={game.currentFen()}
                computerTurn={false}
                gameOver={null}
                enabled={analysisOn}
                onToggleEnabled={setAnalysisOn}
                shallow={engine.shallow}
                ratesEnabled={ratesOn}
                onToggleRates={setRatesOn}
              />
            </>
          ) : (
            <>
              {catPath.length > 0 && (
                <button className="xqp-crumb-up" onClick={() => setCatPath(catPath.slice(0, -1))}>
                  ↖ 返回上一级
                </button>
              )}
              <input
                className="xqp-search"
                placeholder="搜索棋谱标题…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="xqp-list">
                {!isLeaf &&
                  currentSubs.map((s, i) => (
                    <button key={i} className="xqp-cat" onClick={() => setCatPath([...catPath, s])}>
                      <span className="xqp-cat-name">{s.name}</span>
                      <span className="xqp-cat-count">{countCat(s)} 局</span>
                    </button>
                  ))}
                {isLeaf &&
                  currentBooks.map((b, i) => (
                    <button
                      key={i}
                      className="xqp-book"
                      onClick={() => loadBook(b)}
                    >
                      <span className="xqp-book-title">{b.title}</span>
                      <span className={`xqp-book-result r-${b.result === '1-0' ? 'red' : b.result === '0-1' ? 'black' : 'draw'}`}>
                        {RESULT_CN[b.result] ?? ''}
                      </span>
                    </button>
                  ))}
                {isLeaf && currentBooks.length === 0 && (
                  <p className="xqp-empty">没有匹配的棋谱</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function countCat(c: Category): number {
  let n = c.books?.length ?? 0;
  for (const s of c.subs ?? []) n += countCat(s);
  return n;
}
