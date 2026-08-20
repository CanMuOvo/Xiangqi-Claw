import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from './components/Board';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CoachPanel } from './components/CoachPanel';
import { MoveHistory } from './components/MoveHistory';
import { BoardEditor } from './components/BoardEditor';
import { VsComputerDialog } from './components/VsComputerDialog';
import type { VsSide } from './components/VsComputerDialog';
import { BoardEffect } from './components/BoardEffect';
import { BoardThemeDialog } from './components/BoardThemeDialog';
import { BOARD_THEMES } from './lib/boardThemes';
import { useGame } from './hooks/useGame';
import { useEngine } from './hooks/useEngine';
import { applyMove, parseUciMove, toFen } from './lib/fen';
import type { Position, Square } from './lib/fen';
import { uciToChineseNotation } from './lib/notation';
import { isCheckmate, isInCheck } from './lib/xiangqi';
import './App.css';

type Difficulty = 'easy' | 'normal' | 'hard' | 'master';

const DIFFICULTY_CONFIG: Record<Difficulty, { depth: number; multipv: number }> = {
  easy: { depth: 6, multipv: 3 },
  normal: { depth: 10, multipv: 3 },
  hard: { depth: 12, multipv: 3 },
  master: { depth: 18, multipv: 1 },
};

const DIFF_LABELS: Record<Difficulty, string> = {
  easy: '入门',
  normal: '普通',
  hard: '困难',
  master: '大师',
};

// 按难度从引擎返回的多个候选走法里挑一步：
// 入门 40/35/25，普通 70/25/5，困难 90/10/0，大师 100% 最佳
function pickMove(
  data: { best_move?: string; lines?: { pv?: string[] }[] },
  level: Difficulty,
): string | undefined {
  const moves = (data.lines ?? [])
    .map((l) => l.pv?.[0])
    .filter((m): m is string => typeof m === 'string' && /^[a-i][0-9][a-i][0-9]$/.test(m));
  if (moves.length === 0) return data.best_move;

  const r = Math.random();
  if (level === 'easy') {
    return r < 0.4 ? moves[0] : r < 0.75 ? (moves[1] ?? moves[0]) : (moves[2] ?? moves[0]);
  }
  if (level === 'normal') {
    return r < 0.7 ? moves[0] : r < 0.95 ? (moves[1] ?? moves[0]) : (moves[2] ?? moves[0]);
  }
  if (level === 'hard') {
    return r < 0.9 ? moves[0] : (moves[1] ?? moves[0]);
  }
  return moves[0]; // master
}

const SAVE_KEY = 'xiangqi-claw-save';

interface SavedGameState {
  moves: string[];
  startFen: string;
  computerSide: 'w' | 'b' | null;
  difficulty: Difficulty;
  flipped: boolean;
}

export default function App() {
  const game = useGame();
  const engine = useEngine();

  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [bestMoveArrow, setBestMoveArrow] = useState<{ from: Square; to: Square } | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  // 实时胜率栏的独立开关
  const [showRates, setShowRates] = useState(true);
  // 棋盘样式
  const [boardThemeId, setBoardThemeId] = useState(
    () => localStorage.getItem('boardTheme') || 'classic',
  );
  const [styleOpen, setStyleOpen] = useState(false);
  const boardTheme = BOARD_THEMES.find((t) => t.id === boardThemeId) ?? BOARD_THEMES[0];
  useEffect(() => {
    localStorage.setItem('boardTheme', boardThemeId);
  }, [boardThemeId]);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const prevFenRef = useRef<string>('');

  const [computerSide, setComputerSide] = useState<'w' | 'b' | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('master');
  const [computerThinking, setComputerThinking] = useState(false);
  const [computerRetry, setComputerRetry] = useState(0);
  const [computerError, setComputerError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // 棋盘走子动画是否仍在播放（播放期间电脑不走棋，保证"一方下完另一方再走"）
  const [animBusy, setAnimBusy] = useState(false);
  // 新开局计数器：变化时重挂载 CoachPanel 清空对话
  const [newGameNonce, setNewGameNonce] = useState(0);
  // 棋盘中央文字特效（吃子/将军/绝杀）
  const [boardEffect, setBoardEffect] = useState<{
    text: string;
    kind: 'check' | 'capture' | 'mate';
    key: number;
  } | null>(null);
  const effectKeyRef = useRef(0);
  const effectTimerRef = useRef<number | null>(null);
  const computerBusy = useRef(false);
  const animBusyRef = useRef(animBusy);
  const computerSideRef = useRef(computerSide);
  const positionRef = useRef(game.position);

  const showBoardEffect = useCallback((kind: 'check' | 'capture' | 'mate') => {
    effectKeyRef.current += 1;
    const map = {
      check: { text: '将军！', kind: 'check' },
      capture: { text: '吃！', kind: 'capture' },
      mate: { text: '绝杀！', kind: 'mate' },
    } as const;
    const e = map[kind];
    setBoardEffect({ text: e.text, kind: e.kind, key: effectKeyRef.current });
    if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
    effectTimerRef.current = window.setTimeout(() => setBoardEffect(null), 1200);
  }, []);

  // 实时胜率的独立数据源：引擎分析关闭时，仅当胜率栏开启才发浅层分析（depth 6）
  const shallowFenRef = useRef('');
  useEffect(() => {
    if (editing || game.gameOver) return;
    if (showAnalysis) return; // 主分析（depth 18）已覆盖浅层数据
    if (!showRates) return;
    const side = computerSideRef.current;
    if (side && game.position.turn === side) return; // 电脑回合不做
    const fen = game.currentFen();
    if (fen !== shallowFenRef.current && engine.connected) {
      engine.analyseShallow(fen);
      shallowFenRef.current = fen;
    }
  }, [editing, game.gameOver, showAnalysis, showRates, game.position, engine.connected]);

  // 走棋后检测吃子/将军/绝杀，触发棋盘特效（绝杀 > 将军 > 吃子）
  const triggerMoveEffects = useCallback(
    (before: Position, from: Square, to: Square) => {
      const captured = before.board[to.row][to.col] !== null;
      const newPos = applyMove(before, from, to);
      if (isCheckmate(newPos)) {
        showBoardEffect('mate');
      } else if (isInCheck(newPos)) {
        showBoardEffect('check');
      } else if (captured) {
        showBoardEffect('capture');
      }
    },
    [showBoardEffect],
  );

  useEffect(() => {
    animBusyRef.current = animBusy;
  }, [animBusy]);

  useEffect(() => {
    computerSideRef.current = computerSide;
  }, [computerSide]);

  useEffect(() => {
    positionRef.current = game.position;
  });

  // 页面加载时恢复上次棋局
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as SavedGameState;
        if (s.moves && s.moves.length > 0) {
          game.loadMoves(s.moves, s.startFen);
        }
        setComputerSide(s.computerSide ?? null);
        setDifficulty(s.difficulty ?? 'master');
        setFlipped(s.flipped ?? false);
      }
    } catch {
      // 存档损坏则忽略
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每走一步自动存档（恢复完成前不写，避免覆盖存档）
  useEffect(() => {
    if (!restored) return;
    try {
      if (game.moveHistory.length === 0) {
        localStorage.removeItem(SAVE_KEY);
        return;
      }
      const s: SavedGameState = {
        moves: game.moveHistory.map((m) => m.uci),
        startFen: game.baseFen,
        computerSide,
        difficulty,
        flipped,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      // localStorage 不可用时忽略
    }
  }, [restored, game.moveHistory, game.baseFen, computerSide, difficulty, flipped]);

  const playerAtBottom: 'w' | 'b' = flipped ? 'b' : 'w';

  useEffect(() => {
    if (engine.connected) {
      prevFenRef.current = '';
    }
  }, [engine.connected]);

  useEffect(() => {
    if (editing || game.gameOver) return;
    if (computerSide && game.position.turn === computerSide) return; // 电脑回合不做分析
    const fen = game.currentFen();
    if (fen !== prevFenRef.current && showAnalysis && engine.connected) {
      engine.analyse(fen);
      prevFenRef.current = fen;
    }
  }, [game.position, game.gameOver, showAnalysis, engine.connected, editing, computerSide]);

  useEffect(() => {
    const res = engine.result;
    if (res?.best_move && res.fen === toFen(game.position)) {
      setBestMoveArrow(parseUciMove(res.best_move));
    } else {
      setBestMoveArrow(null);
    }
  }, [engine.result, game.position]);

  useEffect(() => {
    if (editing) return;
    const side = computerSideRef.current;
    if (!side || game.gameOver) return;
    if (game.position.turn !== side) return;
    if (animBusyRef.current) return; // 等上一方走子动画播完再走
    if (computerBusy.current) return;
    if (computerRetry >= 3) {
      setComputerError('电脑走棋失败，请手动走一步或点「新局」重试');
      return;
    }

    computerBusy.current = true;
    setComputerThinking(true);
    const fen = toFen(game.position);
    const conf = DIFFICULTY_CONFIG[difficulty];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth: conf.depth, multipv: conf.multipv }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        let best = pickMove(data, difficulty);
        if (best && !/^[a-i][0-9][a-i][0-9]$/.test(best)) best = undefined;
        // 像人类一样：思考完成后停顿一下再落子
        setTimeout(() => {
          setComputerThinking(false);
          if (toFen(positionRef.current) !== fen) return; // 停顿期间局面已变，放弃
          const before = positionRef.current;
          if (best && !game.tryMoveUci(best)) {
            // 引擎走法被前端规则判为非法时，从前端合法走法里随机挑一步兜底，保证不卡死
            const fallback = game.legalMoves();
            best = fallback.length > 0 ? fallback[Math.floor(Math.random() * fallback.length)] : undefined;
            if (best) game.tryMoveUci(best);
          }
          if (best) {
            const mv = parseUciMove(best);
            triggerMoveEffects(before, mv.from, mv.to);
            setComputerRetry(0);
            setComputerError(null);
            setLastMove(mv);
            return;
          }
          // 无棋可走 → 终局（将死/困毙），按规则判无棋方负
          if (game.legalMoves().length === 0) {
            game.endGame(game.position.turn === 'w' ? '黑方胜' : '红方胜');
            setComputerRetry(0);
            setComputerError(null);
            return;
          }
          if (computerRetry < 3) setComputerRetry((n) => n + 1);
        }, 1200);
      })
      .catch(() => {
        setComputerThinking(false);
        // 请求失败时若也是无棋可走，同样按终局处理
        if (game.legalMoves().length === 0) {
          game.endGame(game.position.turn === 'w' ? '黑方胜' : '红方胜');
          setComputerRetry(0);
          setComputerError(null);
          return;
        }
        if (computerRetry < 3) setComputerRetry((n) => n + 1);
      })
      .finally(() => {
        clearTimeout(timer);
        computerBusy.current = false;
      });
  }, [editing, computerSide, difficulty, computerRetry, game.position, game.gameOver, animBusy, triggerMoveEffects]);

  const handleBoardMove = useCallback(
    (from: Square, to: Square) => {
      const before = game.position;
      const ok = game.tryMove(from, to);
      if (ok) {
        setAnimBusy(true);
        triggerMoveEffects(before, from, to);
        setLastMove({ from, to });
        setBestMoveArrow(null);
      }
    },
    [game, triggerMoveEffects],
  );

  const clearState = () => {
    setLastMove(null);
    setBestMoveArrow(null);
    prevFenRef.current = '';
    if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
    setBoardEffect(null);
  };

  const handleNewGame = () => {
    game.reset();
    clearState();
    setComputerRetry(0);
    setComputerError(null);
    setNewGameNonce((n) => n + 1); // 新开局清空 AI 教练对话
  };

  // 弹窗确认：执方未变（仅调难度）不重开；变化则应用并重新开局
  const handleVsConfirm = (side: VsSide, newDifficulty: Difficulty) => {
    setSetupOpen(false);
    setDifficulty(newDifficulty);
    if (side === computerSide) return;
    setComputerSide(side);
    handleNewGame();
    setFlipped(side === 'w');
  };

  const handleEditorConfirm = (fen: string) => {
    game.reset(fen);
    clearState();
    setEditing(false);
    setNewGameNonce((n) => n + 1); // 新局面开始，清空 AI 教练对话
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-seal">弈</span>
          <div className="brand-text">
            <h1 className="app-title">象棋智教</h1>
            <span className="brand-sub">Xiangqi Academy</span>
          </div>
        </div>
        <div className="header-status">
          <span className={`engine-pill${engine.connected ? ' on' : ''}`} title="棋力引擎">
            <i className="engine-dot" />
            {engine.connected
              ? `${engine.engineName ?? '引擎'} 在线`
              : '引擎连接中'}
          </span>
        </div>
      </header>

      <main className="app-main">
        {editing ? (
          <BoardEditor
            onConfirm={handleEditorConfirm}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="play-layout">
            <div className="board-column">
              <div className="board-wrap">
                <Board
                  board={game.position.board}
                  onMove={handleBoardMove}
                  legalTargets={game.legalTargets}
                  bestMoveArrow={showAnalysis ? bestMoveArrow : null}
                  lastMove={lastMove}
                  flipped={flipped}
                  onAnimDone={() => setAnimBusy(false)}
                  theme={boardTheme}
                />
                {boardEffect && (
                  <BoardEffect key={boardEffect.key} kind={boardEffect.kind} />
                )}
              </div>

              <CoachPanel
                key={newGameNonce}
                fen={game.currentFen()}
                historyCn={game.moveHistory
                  .map((m, i) => {
                    const before = i === 0 ? game.baseFen : game.moveHistory[i - 1].fen;
                    return uciToChineseNotation(m.uci, before);
                  })
                  .join(' ')}
                playerAtBottom={playerAtBottom}
              />

              {game.gameOver && (
                <div className="game-over">{game.gameOver}</div>
              )}
            </div>

            <div className="side-column">
              <div className="board-toolbar">
                <div className="toolbar-group">
                  <button
                    className="toolbar-btn primary"
                    onClick={handleNewGame}
                    title="开始新对局"
                  >
                    新局
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => setEditing(true)}
                    title="编辑局面"
                  >
                    编辑局面
                  </button>
                  <button
                    className="toolbar-btn vs"
                    onClick={() => setSetupOpen(true)}
                    title="设置人机对战"
                  >
                    人机对战
                    <span className="toolbar-vs-value">
                      {computerSide === 'w' ? '电脑执红' : computerSide === 'b' ? '电脑执黑' : '关闭'}
                      {computerSide ? ` · ${DIFF_LABELS[difficulty]}` : ''}
                    </span>
                  </button>
                </div>
                <div className="toolbar-group">
                  <button
                    className="toolbar-btn"
                    onClick={() => setStyleOpen(true)}
                    title="棋盘样式"
                  >
                    🎨 棋盘样式
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => setFlipped(f => !f)}
                    title="翻转棋盘"
                  >
                    ↻ 翻转棋盘
                  </button>
                </div>
              </div>

              {computerError && (
                <div className="computer-error">{computerError}</div>
              )}

              <div className="status-card">
                <div className="status-main">
                  <span className="status-label">轮走</span>
                  <span className={`status-side ${game.position.turn === 'w' ? 'red' : 'black'}`}>
                    {game.position.turn === 'w' ? '红方' : '黑方'}
                  </span>
                  {isInCheck(game.position) && (
                    <span className="status-badge check">将军！</span>
                  )}
                  {isCheckmate(game.position) && (
                    <span className="status-badge mate">绝杀</span>
                  )}
                </div>
                <span className="status-divider" />
                <div className="status-item">
                  <span className="status-label">回合</span>
                  <span className="status-value">
                    {Math.floor(game.moveHistory.length / 2) + 1}
                  </span>
                </div>
                <span className="status-divider" />
                <div className="status-item">
                  <span className="status-label">电脑</span>
                  <span className="status-value">
                    {computerSide === 'w' ? '执红' : computerSide === 'b' ? '执黑' : '未开启'}
                    {computerSide ? ` · ${DIFF_LABELS[difficulty]}` : ''}
                    {computerThinking ? ' · 思考中…' : ''}
                  </span>
                </div>
              </div>

              <AnalysisPanel
                info={engine.info}
                result={engine.result}
                analysing={engine.analysing}
                connected={engine.connected}
                fen={game.currentFen()}
                computerTurn={computerThinking && !computerError}
                gameOver={game.gameOver}
                enabled={showAnalysis}
                onToggleEnabled={setShowAnalysis}
                shallow={engine.shallow}
                ratesEnabled={showRates}
                onToggleRates={setShowRates}
              />

              <MoveHistory
                moves={game.moveHistory}
                currentIndex={game.currentIndex}
                startFen={game.baseFen}
                onGoTo={game.goToMove}
                stepByTurn={!!computerSide}
                humanIsRed={computerSide !== 'w'}
              />
            </div>

            {setupOpen && (
              <VsComputerDialog
                currentSide={computerSide}
                currentDifficulty={difficulty}
                onConfirm={handleVsConfirm}
                onClose={() => setSetupOpen(false)}
              />
            )}

            {styleOpen && (
              <BoardThemeDialog
                currentId={boardThemeId}
                onSelect={(id) => { setBoardThemeId(id); setStyleOpen(false); }}
                onClose={() => setStyleOpen(false)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
