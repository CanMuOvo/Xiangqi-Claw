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
import { useEngine, type ShallowScore } from './hooks/useEngine';
import { applyMove, parseUciMove, toFen } from './lib/fen';
import type { Position, Square } from './lib/fen';
import { uciToChineseNotation } from './lib/notation';
import { isCheckmate, isInCheck, isStalemate } from './lib/xiangqi';
import { terminalRates, winRates } from './lib/winrate';
import { WinRateBar } from './components/WinRateBar';
import './App.css';

type Difficulty = 'easy' | 'normal' | 'hard' | 'master';

const DIFFICULTY_CONFIG: Record<Difficulty, { depth: number; multipv: number }> = {
  easy: { depth: 4, multipv: 3 },
  normal: { depth: 8, multipv: 3 },
  hard: { depth: 10, multipv: 3 },
  master: { depth: 14, multipv: 1 },
};

const DIFF_LABELS: Record<Difficulty, string> = {
  easy: '入门',
  normal: '普通',
  hard: '困难',
  master: '大师',
};

// 按难度从引擎返回的多个候选走法里挑一步：
// 入门：浅思考（depth 4）+ 60/30/10 概率选招
// 普通/困难/大师：50/30/20 概率在可行候选里选（差异只在搜索深度）
// 候选与最佳差距超过阈值（≈1.5 兵）视为夸张失误，不作为备选；
// 若连次佳都差距过大，则只走最优解
const MAX_VIABLE_GAP = 150;

function pickMove(
  data: { best_move?: string; lines?: { pv?: string[]; score_cp?: number }[] },
  level: Difficulty,
): string | undefined {
  const candidates = (data.lines ?? [])
    .map((l) => ({ move: l.pv?.[0], score: l.score_cp ?? 0 }))
    .filter((c): c is { move: string; score: number } =>
      typeof c.move === 'string' && /^[a-i][0-9][a-i][0-9]$/.test(c.move),
    );
  if (candidates.length === 0) return data.best_move;

  // 剔除与最佳差距过大的候选（>1.5 兵）；最优解始终保留（差距 0），
  // 若次佳也差距过大（viable 只剩最优）则概率选招自然只走最优
  const bestScore = candidates[0].score;
  const viable = candidates.filter((c) => bestScore - c.score <= MAX_VIABLE_GAP);
  const moves = (viable.length > 0 ? viable : [candidates[0]]).map((c) => c.move);

  if (level === 'easy') {
    // 入门：浅思考（depth 4）+ 60/30/10
    const r = Math.random();
    return r < 0.6 ? moves[0] : r < 0.9 ? (moves[1] ?? moves[0]) : (moves[2] ?? moves[0]);
  }

  const r = Math.random();
  return r < 0.5 ? moves[0] : r < 0.8 ? (moves[1] ?? moves[0]) : (moves[2] ?? moves[0]);
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
  // 移动端：棋盘首屏 + 底部 Tab 切换面板
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  // 走棋提醒：每步与最优解差距超阈值时提示（学习辅助）
  const [moveCheck, setMoveCheck] = useState(false);
  const [moveCheckMsg, setMoveCheckMsg] = useState<string | null>(null);
  const bestRef = useRef<{ fen: string; turn: 'w' | 'b'; score: number } | null>(null);
  const moveCheckTimerRef = useRef<number | null>(null);
  const [mobileTab, setMobileTab] = useState<'menu' | 'coach' | 'analysis' | 'history'>('menu');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // 沙盘推演：自由控制双方模拟走棋，退出时恢复原对局
  const [sandbox, setSandbox] = useState(false);
  const sandboxSnapshotRef = useRef<{ moves: string[]; startFen: string; index: number } | null>(null);
  // 沙盘自动演示：教练推演的走法序列，进入沙盘后定时逐步走出
  const [demoMoves, setDemoMoves] = useState<string[] | null>(null);
  // 演示开始时的局面：演示期间固定传给教练，避免触发"局面已变化"分隔提示
  const demoFenRef = useRef('');
  // 沙盘自动推演：引擎替双方走棋直到终局
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayStopRef = useRef(false);
  const autoPlayStepsRef = useRef(0);
  const gameRef = useRef(game);
  gameRef.current = game;
  const autoPlayStepRef = useRef<() => void>(() => {});
  const autoPlayTimerRef = useRef<number | null>(null);

  // 自动推演一步：引擎分析当前局面 → 走最佳 → 递归下一步
  const autoPlayStep = () => {
    if (autoPlayStopRef.current) return;
    const g = gameRef.current;
    if (g.gameOver) {
      setAutoPlay(false);
      return;
    }
    if (autoPlayStepsRef.current >= 60) {
      setAutoPlay(false); // 步数上限防死循环
      return;
    }
    autoPlayStepsRef.current += 1;
    fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: g.currentFen(), depth: 14, multipv: 1 }),
    })
      .then((r) => r.json())
      .then((data: { best_move?: string }) => {
        if (autoPlayStopRef.current) return;
        const best = data.best_move;
        if (!best || !/^[a-i][0-9][a-i][0-9]$/.test(best)) {
          setAutoPlay(false);
          return;
        }
        const mv = parseUciMove(best);
        const ok = handleBoardMoveRef.current?.(mv.from, mv.to);
        if (!ok) {
          setAutoPlay(false);
          return;
        }
        // 等待走子动画完成后进入下一步（间隔放缓，留出思考时间）
        autoPlayTimerRef.current = window.setTimeout(() => autoPlayStepRef.current(), 1400);
      })
      .catch(() => setAutoPlay(false));
  };
  autoPlayStepRef.current = autoPlayStep;

  const startAutoPlay = () => {
    if (!sandbox) return;
    stopDemo();
    autoPlayStopRef.current = false;
    autoPlayStepsRef.current = 0;
    setAutoPlay(true);
    autoPlayStep();
  };

  const stopAutoPlay = () => {
    autoPlayStopRef.current = true;
    if (autoPlayTimerRef.current !== null) {
      window.clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    setAutoPlay(false);
  };
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
    if (demoMoves) return; // 沙盘自动演示中暂停浅层分析
    if (showAnalysis) return; // 主分析（depth 18）已覆盖浅层数据
    if (!showRates) return;
    const side = computerSideRef.current;
    if (side && game.position.turn === side) return; // 电脑回合不做
    if (!engine.connected) return;
    const fen = game.currentFen();
    // 防抖 400ms：快速回退时只分析最新局面
    const timer = window.setTimeout(() => {
      if (fen !== shallowFenRef.current) {
        engine.analyseShallow(fen);
        shallowFenRef.current = fen;
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [editing, game.gameOver, showAnalysis, showRates, game.position, engine.connected, demoMoves]);

  // 走棋提醒：玩家回合开始时缓存最优解（供走棋后对比；500ms 防抖避免频繁触发）
  useEffect(() => {
    if (!moveCheck || editing || game.gameOver || sandbox) return;
    const side = computerSideRef.current;
    if (side && game.position.turn === side) return; // 电脑回合不缓存
    const fen = game.currentFen();
    const turn = game.position.turn;
    const timer = window.setTimeout(() => {
      fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth: 10, multipv: 1 }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d?.lines?.[0]) return;
          bestRef.current = {
            fen,
            turn,
            score: d.lines[0].score_cp ?? 0,
          };
        })
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [moveCheck, editing, game.gameOver, sandbox, game.position, engine.connected]);

  // 走棋后检测吃子/将军/绝杀，触发棋盘特效（绝杀 > 将军 > 吃子）
  const triggerMoveEffects = useCallback(
    (before: Position, from: Square, to: Square) => {
      const captured = before.board[to.row][to.col] !== null;
      const newPos = applyMove(before, from, to);
      // 将死或困毙（无合法走法）均判负 → 触发"绝杀"特效
      if (isCheckmate(newPos) || isStalemate(newPos)) {
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
  // 沙盘起点索引：上一步最多回退到沙盘开始，不能退回实际对局历史
  const sandboxMinIndex = sandboxSnapshotRef.current?.index ?? -1;

  useEffect(() => {
    if (engine.connected) {
      prevFenRef.current = '';
    }
  }, [engine.connected]);

  useEffect(() => {
    if (editing || game.gameOver) return;
    if (demoMoves) return; // 沙盘自动演示中暂停引擎分析
    if (computerSide && game.position.turn === computerSide) return; // 电脑回合不做分析
    if (!showAnalysis || !engine.connected) return;
    const fen = game.currentFen();
    // 防抖 400ms：快速回退/走棋时只分析停稳后的最新局面，避免引擎排队卡死
    const timer = window.setTimeout(() => {
      if (fen !== prevFenRef.current) {
        engine.analyse(fen);
        prevFenRef.current = fen;
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [game.position, game.gameOver, showAnalysis, engine.connected, editing, computerSide, demoMoves]);

  useEffect(() => {
    const res = engine.result;
    if (res?.best_move && res.fen === toFen(game.position) && !demoMoves) {
      setBestMoveArrow(parseUciMove(res.best_move));
    } else {
      setBestMoveArrow(null);
    }
  }, [engine.result, game.position, demoMoves]);

  useEffect(() => {
    if (editing) return;
    if (sandbox) return; // 沙盘推演：电脑不自动走棋
    const side = computerSideRef.current;
    if (!side || game.gameOver) return;
    if (game.position.turn !== side) return;
    if (animBusyRef.current) return; // 等上一方走子动画播完再走
    if (computerBusy.current) return;
    if (computerRetry >= 3) {
      setComputerError('电脑走棋失败，请手动走一步或点「新局」重试');
      return;
    }

    // 电脑走棋立即响应（回退时的重复请求由 computerBusy 保护 + 返回时局面校验放弃）
    computerBusy.current = true;
    setComputerThinking(true);
    const fen = toFen(positionRef.current);
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
        }, 600);
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
    (from: Square, to: Square): boolean => {
      const before = game.position;
      const ok = game.tryMove(from, to);
      if (ok) {
        setAnimBusy(true);
        triggerMoveEffects(before, from, to);
        setLastMove({ from, to });
        setBestMoveArrow(null);
        // 走棋提醒：走棋后延迟分析该步质量，与最优解差距 >150 分时提示（沙盘推演不检测）
        if (moveCheck && !sandbox) {
          const fenBefore = toFen(before);
          const fenAfter = toFen(applyMove(before, from, to));
          const moverSide = before.turn;
          const cached = bestRef.current;
          moveCheckTimerRef.current = window.setTimeout(() => {
            void (async () => {
              try {
                // 最优解：缓存命中（同局面同走棋方）直接用，否则现场分析
                let bestScore: number | null =
                  cached && cached.fen === fenBefore && cached.turn === moverSide ? cached.score : null;
                if (bestScore === null) {
                  const bRes = await fetch('/api/analysis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fen: fenBefore, depth: 10, multipv: 1 }),
                  }).then((r) => r.json());
                  if (bRes?.lines?.[0]?.score_cp === undefined) return; // 分析失败，跳过本次检测
                  bestScore = bRes.lines[0].score_cp;
                }
                const aRes = await fetch('/api/analysis', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fen: fenAfter, depth: 10, multipv: 1 }),
                }).then((r) => r.json());
                const afterCp = aRes?.lines?.[0]?.score_cp;
                if (afterCp === undefined) return; // 分析失败，跳过本次检测
                const myScore = -afterCp; // 走棋方视角（走棋后轮到对方）
                const gap = (bestScore as number) - myScore;
                if (gap > 150) {
                  const verdict = gap > 300 ? '大漏招' : '漏招';
                  setMoveCheckMsg(`⚠️ ${verdict}！与最佳相差 ${gap} 分`);
                  window.setTimeout(() => setMoveCheckMsg(null), 2500);
                }
              } catch {
                /* 分析失败静默，不打断对局 */
              }
            })();
          }, 600);
        }
      }
      return ok;
    },
    [game, triggerMoveEffects, moveCheck, sandbox],
  );

  const clearState = () => {
    setLastMove(null);
    setBestMoveArrow(null);
    prevFenRef.current = '';
    if (effectTimerRef.current !== null) window.clearTimeout(effectTimerRef.current);
    if (moveCheckTimerRef.current !== null) window.clearTimeout(moveCheckTimerRef.current);
    setBoardEffect(null);
  };

  const handleNewGame = () => {
    game.reset();
    clearState();
    setComputerRetry(0);
    setComputerError(null);
    bestRef.current = null;
    setMoveCheckMsg(null);
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

  // 沙盘推演：进入时保存局面快照，退出时恢复原对局
  const enterSandbox = () => {
    sandboxSnapshotRef.current = {
      moves: game.moveHistory.map((m) => m.uci),
      startFen: game.baseFen,
      index: game.currentIndex,
    };
    setLastMove(null);
    setSandbox(true);
  };

  const exitSandbox = () => {
    const snap = sandboxSnapshotRef.current;
    stopAutoPlay();
    stopDemo();
    if (snap) {
      // 精确恢复到进入沙盘时的局面与回看位置（loadMoves 支持 targetIndex，无异步竞态）
      game.loadMoves(snap.moves, snap.startFen, snap.index);
    }
    sandboxSnapshotRef.current = null;
    setLastMove(null);
    setSandbox(false);
  };

  // ---- 沙盘自动演示：ref + 递归 setTimeout 实现（消除 effect 闭包/时序隐患）----
  const demoMovesRef = useRef<string[]>([]);
  const demoStepRef = useRef(0);
  const demoStepTimerRef = useRef<number | null>(null);
  // 始终持有最新 handleBoardMove（带滑动动画；useCallback 随局面更新，渲染期同步到 ref）
  const handleBoardMoveRef = useRef<((from: Square, to: Square) => boolean) | null>(null);
  handleBoardMoveRef.current = handleBoardMove;

  const stopDemo = () => {
    if (demoStepTimerRef.current !== null) {
      window.clearTimeout(demoStepTimerRef.current);
      demoStepTimerRef.current = null;
    }
    demoMovesRef.current = [];
    demoStepRef.current = 0;
    setDemoMoves(null);
  };

  const stepDemo = (i: number) => {
    const moves = demoMovesRef.current;
    if (i >= moves.length) {
      stopDemo();
      return;
    }
    const uci = moves[i];
    const mv = parseUciMove(uci);
    if (!handleBoardMoveRef.current?.(mv.from, mv.to)) {
      // 走法非法（局面与推演时不一致）→ 停止
      stopDemo();
      return;
    }
    demoStepRef.current = i + 1;
    demoStepTimerRef.current = window.setTimeout(() => stepDemo(i + 1), 1500);
  };

  // 教练推演 → 一键进入沙盘并定时逐步演示；演示中再次点击则清除之前模拟重新开始
  const handleDemoMoves = (moves: string[]) => {
    if (moves.length === 0) return;
    stopAutoPlay(); // 演示与自动推演互斥
    if (sandboxSnapshotRef.current) {
      // 已在沙盘/演示中：精确恢复到沙盘起点局面与回看位置，清除之前模拟
      const snap = sandboxSnapshotRef.current;
      game.loadMoves(snap.moves, snap.startFen, snap.index);
    } else {
      sandboxSnapshotRef.current = {
        moves: game.moveHistory.map((m) => m.uci),
        startFen: game.baseFen,
        index: game.currentIndex,
      };
    }
    demoMovesRef.current = moves;
    demoStepRef.current = 0;
    demoFenRef.current = game.currentFen();
    setLastMove(null);
    setSandbox(true);
    setDemoMoves(moves);
    // 首次进入 300ms 后走第一步，之后每 1.5s 一步
    demoStepTimerRef.current = window.setTimeout(() => stepDemo(0), 300);
  };

  // 沙盘上一步/下一步：带滑动动画（按被回退/前进的走法触发反向/正向动画）
  const stepSandbox = (dir: 1 | -1) => {
    stopAutoPlay(); // 手动接管时停止自动推演
    if (dir < 0) {
      if (game.currentIndex <= sandboxMinIndex) return;
      const move = game.moveHistory[game.currentIndex];
      if (!move) return;
      game.goToMove(game.currentIndex - 1);
      const mv = parseUciMove(move.uci);
      setLastMove({ from: mv.to, to: mv.from }); // 棋子从落点滑回起点
    } else {
      const target = game.currentIndex + 1;
      const move = game.moveHistory[target];
      if (!move) return;
      game.goToMove(target);
      const mv = parseUciMove(move.uci);
      setLastMove({ from: mv.from, to: mv.to }); // 棋子从起点滑向落点
    }
  };

  const handleEditorConfirm = (fen: string) => {
    game.reset(fen);
    clearState();
    setEditing(false);
    setNewGameNonce((n) => n + 1); // 新局面开始，清空 AI 教练对话
  };

  // ---- 可复用面板（桌面双栏 / 移动端 Tab 共用） ----
  const boardArea = (
    <>
      {sandbox && (
        <div className="sandbox-bar">
          <span className="sandbox-title">🏖 沙盘<span className="sandbox-title-sub">推演</span></span>
          {demoMoves ? (
            <span className="sandbox-hint demoing">
              ▶ 自动演示中…（{demoStepRef.current}/{demoMoves.length}）
            </span>
          ) : (
            <span className="sandbox-hint">可自由控制红黑双方走棋</span>
          )}
          <div className="sandbox-actions">
            <button className="sandbox-btn exit" onClick={exitSandbox}>退出</button>
            <button
              className={`sandbox-btn autoplay${autoPlay ? ' on' : ''}`}
              onClick={autoPlay ? stopAutoPlay : startAutoPlay}
              title="引擎替双方自动推演到终局"
            >
              {autoPlay ? '停止' : '自动推演'}
            </button>
            <button
              className="sandbox-btn"
              onClick={() => stepSandbox(-1)}
              disabled={game.currentIndex <= sandboxMinIndex}
              title="上一步"
            >
              ◀ <span className="sb-step-label">上一步</span>
            </button>
            <button
              className="sandbox-btn"
              onClick={() => stepSandbox(1)}
              disabled={game.currentIndex >= game.moveHistory.length - 1}
              title="下一步"
            >
              <span className="sb-step-label">下一步</span> ▶
            </button>
          </div>
        </div>
      )}
      <div className={`board-wrap${sandbox ? ' sandbox-on' : ''}`}>
        <Board
          board={game.position.board}
          onMove={handleBoardMove}
          legalTargets={game.legalTargets}
          bestMoveArrow={showAnalysis ? bestMoveArrow : null}
          lastMove={lastMove}
          flipped={flipped}
          onAnimDone={() => setAnimBusy(false)}
          theme={boardTheme}
          turn={sandbox ? undefined : game.position.turn}
        />
        {boardEffect && (
          <BoardEffect key={boardEffect.key} kind={boardEffect.kind} />
        )}
        {moveCheckMsg && (
          <div className="move-check-toast">{moveCheckMsg}</div>
        )}
      </div>
    </>
  );

  const infoPanel = (
    <div className="vs-card">
      <div className="vs-status">
        <span className="turn-indicator">
          <span className={`turn-dot ${game.position.turn === 'w' ? 'red' : 'black'}`} />
          <span className={`turn-text ${game.position.turn === 'w' ? 'red' : 'black'}`}>
            {game.position.turn === 'w' ? '红方' : '黑方'}轮走
          </span>
          {isInCheck(game.position) && (
            <span className="status-badge check">将军！</span>
          )}
          {(isCheckmate(game.position) || isStalemate(game.position)) && (
            <span className="status-badge mate">绝杀</span>
          )}
        </span>
        <span className="round-badge">
          第 {Math.floor(game.moveHistory.length / 2) + 1} 回合
        </span>
      </div>
      <button
        className="toolbar-btn vs-row"
        onClick={() => setSetupOpen(true)}
        title="设置人机对战"
        disabled={sandbox}
      >
        <span className="vs-title">人机对战</span>
        {computerSide && (
          <span className="vs-sub">
            电脑{computerSide === 'w' ? '执红' : '执黑'} · {DIFF_LABELS[difficulty]}
          </span>
        )}
      </button>
      <div className="vs-actions">
        <button
          className="toolbar-btn primary"
          onClick={handleNewGame}
          title="开始新对局"
          disabled={sandbox}
        >
          新局
        </button>
        <button
          className="toolbar-btn"
          onClick={() => setEditing(true)}
          title="编辑局面"
          disabled={sandbox}
        >
          编辑局面
        </button>
        <button
          className={`toolbar-btn sandbox${sandbox ? ' active' : ''}`}
          onClick={sandbox ? exitSandbox : enterSandbox}
          title="沙盘推演"
        >
          🏖 沙盘
        </button>
        <button
          className="toolbar-btn"
          onClick={() => setStyleOpen(true)}
          title="棋盘样式"
        >
          🎨 棋盘样式
        </button>
        <button
          className={`toolbar-btn move-check${moveCheck ? ' active' : ''}`}
          onClick={() => setMoveCheck((v) => !v)}
          title="走棋提醒：每步与最优解差距超过 150 分时给出提示"
        >
          💡 走棋提醒
        </button>
        <button
          className="toolbar-btn"
          onClick={() => setFlipped(f => !f)}
          title="翻转棋盘"
        >
          ↻ 翻转棋盘
        </button>
      </div>
      {computerError && (
        <div className="computer-error">{computerError}</div>
      )}
    </div>
  );

  const coachPanel = (
    <CoachPanel
      key={newGameNonce}
      fen={demoMoves ? demoFenRef.current : game.currentFen()}
      historyCn={game.moveHistory
        .map((m, i) => {
          const before = i === 0 ? game.baseFen : game.moveHistory[i - 1].fen;
          return uciToChineseNotation(m.uci, before);
        })
        .join(' ')}
      playerAtBottom={playerAtBottom}
      onDemoMoves={handleDemoMoves}
    />
  );

  const analysisPanel = (
    <AnalysisPanel
      info={engine.info}
      lines={engine.lines}
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
  );

  // 走棋记录回退/前进：逐手回放（每一步都带滑动动画），含人机吸附的跨步，
  // 所有移动的棋子逐手平滑过渡，不再瞬移
  const historyTimerRef = useRef<number | null>(null);
  const historyGoTo = (index: number) => {
    const cur = game.currentIndex;
    if (index === cur) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    if (index < cur) {
      // 回退：从当前最后一手开始，逐手反向动画回放
      const step = (fromIdx: number) => {
        if (fromIdx <= index) return; // 回放完毕，保留最后一手标记
        const move = game.moveHistory[fromIdx];
        if (!move) return;
        game.goToMove(fromIdx - 1);
        const mv = parseUciMove(move.uci);
        setLastMove({ from: mv.to, to: mv.from });
        historyTimerRef.current = window.setTimeout(() => step(fromIdx - 1), 500);
      };
      step(cur);
    } else {
      // 前进：从下一手开始，逐手正向动画回放
      const step = (toIdx: number) => {
        if (toIdx > index) return; // 回放完毕
        const move = game.moveHistory[toIdx];
        if (!move) return;
        game.goToMove(toIdx);
        const mv = parseUciMove(move.uci);
        setLastMove({ from: mv.from, to: mv.to });
        historyTimerRef.current = window.setTimeout(() => step(toIdx + 1), 500);
      };
      step(cur + 1);
    }
  };

  const historyPanel = (
    <MoveHistory
      moves={game.moveHistory}
      currentIndex={game.currentIndex}
      startFen={game.baseFen}
      onGoTo={historyGoTo}
      stepByTurn={!!computerSide}
      humanIsRed={computerSide !== 'w'}
      disabled={!!demoMoves || sandbox}
    />
  );

  const dialogs = (
    <>
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
    </>
  );

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

      <main className={`app-main${isMobile ? ' mobile' : ''}`}>
        {editing ? (
          <BoardEditor
            onConfirm={handleEditorConfirm}
            onCancel={() => setEditing(false)}
          />
        ) : isMobile ? (
          <>
            <div className="board-column">
              <div className="mobile-topbar">
                <span className="turn-indicator">
                  <span className={`turn-dot ${game.position.turn === 'w' ? 'red' : 'black'}`} />
                  <span className={`turn-text ${game.position.turn === 'w' ? 'red' : 'black'}`}>
                    {game.position.turn === 'w' ? '红方' : '黑方'}轮走
                  </span>
                  {isInCheck(game.position) && (
                    <span className="status-badge check">将军！</span>
                  )}
                </span>
                <span className="round-badge">
                  第 {Math.floor(game.moveHistory.length / 2) + 1} 回合
                </span>
                {showRates && (
                  <MobileWinRate
                    fen={game.currentFen()}
                    gameOver={game.gameOver}
                    shallow={engine.shallow}
                  />
                )}
              </div>
              {boardArea}
              {game.gameOver && (
                <div className="game-over">{game.gameOver}</div>
              )}
            </div>
            <div className="mobile-panel">
              {mobileTab === 'menu' && infoPanel}
              {mobileTab === 'coach' && coachPanel}
              {mobileTab === 'analysis' && analysisPanel}
              {mobileTab === 'history' && historyPanel}
            </div>
            <div className="mobile-tabs">
              <button
                className={`mobile-tab${mobileTab === 'menu' ? ' active' : ''}`}
                onClick={() => setMobileTab('menu')}
              >
                <span className="mobile-tab-icon">📋</span>菜单
              </button>
              <button
                className={`mobile-tab${mobileTab === 'coach' ? ' active' : ''}`}
                onClick={() => setMobileTab('coach')}
              >
                <span className="mobile-tab-icon">🤖</span>教练
              </button>
              <button
                className={`mobile-tab${mobileTab === 'analysis' ? ' active' : ''}`}
                onClick={() => setMobileTab('analysis')}
              >
                <span className="mobile-tab-icon">⚡</span>分析
              </button>
              <button
                className={`mobile-tab${mobileTab === 'history' ? ' active' : ''}`}
                onClick={() => setMobileTab('history')}
              >
                <span className="mobile-tab-icon">📜</span>棋谱
              </button>
            </div>
            {dialogs}
          </>
        ) : (
          <div className="play-layout">
            <div className="board-column">
              {boardArea}
              {coachPanel}
              {game.gameOver && (
                <div className="game-over">{game.gameOver}</div>
              )}
            </div>
            <div className="side-column">
              {infoPanel}
              {analysisPanel}
              {historyPanel}
            </div>
            {dialogs}
          </div>
        )}
      </main>
    </div>
  );
}

/** 移动端棋盘上方的实时胜率（紧凑条） */
function MobileWinRate({ fen, gameOver, shallow }: {
  fen: string;
  gameOver: string | null;
  shallow: ShallowScore | null;
}) {
  const rates = gameOver
    ? terminalRates(gameOver)
    : shallow && shallow.fen === fen
      ? winRates(shallow)
      : null;
  return (
    <div className="mobile-winrate">
      {rates ? (
        <WinRateBar red={rates.red} draw={rates.draw} black={rates.black} compact />
      ) : (
        <span className="mobile-winrate-empty">胜率分析中…</span>
      )}
    </div>
  );
}
