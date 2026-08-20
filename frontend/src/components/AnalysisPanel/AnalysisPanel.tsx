import type { EngineInfo, EngineResult, ShallowScore } from '../../hooks/useEngine';
import { uciToChineseNotation } from '../../lib/notation';
import { parseFen, applyMove, toFen, uciToSquare } from '../../lib/fen';
import './AnalysisPanel.css';

interface Props {
  info: EngineInfo | null;
  result: EngineResult | null;
  analysing: boolean;
  connected: boolean;
  fen: string;
  computerTurn: boolean;
  gameOver: string | null;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  /** 实时胜率：浅层独立数据源 */
  shallow: ShallowScore | null;
  ratesEnabled: boolean;
  onToggleRates: (v: boolean) => void;
}

function formatScore(cp: number, mate: number | null): string {
  if (mate !== null) {
    return mate > 0 ? `杀棋 ${mate} 步` : `被杀 ${Math.abs(mate)} 步`;
  }
  const pawns = (cp / 100).toFixed(1);
  return cp >= 0 ? `+${pawns}` : `${pawns}`;
}

function formatNodes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function pvToChineseSequence(pv: string[], startFen: string, maxMoves: number): string {
  const moves: string[] = [];
  let currentFen = startFen;
  for (let i = 0; i < Math.min(pv.length, maxMoves); i++) {
    const uci = pv[i];
    try {
      const cn = uciToChineseNotation(uci, currentFen);
      moves.push(cn);
      const pos = parseFen(currentFen);
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      const newPos = applyMove(pos, from, to);
      currentFen = toFen(newPos);
    } catch {
      moves.push(uci);
      break;
    }
  }
  return moves.join(' ');
}

/* ---------- 实时胜率（原 WinRatePanel 逻辑迁移） ---------- */

// 终局胜率：绝杀 = 对应方 100%，和棋 = 100% 和（不依赖引擎，即时显示）
function terminalRates(gameOver: string): { red: number; draw: number; black: number } | null {
  if (gameOver.includes('红方胜')) return { red: 100, draw: 0, black: 0 };
  if (gameOver.includes('黑方胜')) return { red: 0, draw: 0, black: 100 };
  if (gameOver.includes('和')) return { red: 0, draw: 100, black: 0 };
  return null;
}

// lichess 标准 sigmoid：引擎分数 → 单方胜率（业界通用做法）
function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// 用浅层分数（depth <=6，未收敛到残局"例和"）计算三方胜率：
// 胜/负用 sigmoid，和棋用钟形（均势最高、随优势增大递减），归一化
function winRates(s: ShallowScore | null): { red: number; draw: number; black: number } | null {
  if (!s || !s.fen) return null;
  const turn = s.fen.split(' ')[1];
  let sideWin: number;
  let sideDraw: number;
  if (s.mate !== null) {
    sideWin = s.mate > 0 ? 100 : 0;
    sideDraw = 0;
  } else {
    sideWin = winPercent(s.cp);
    sideDraw = 50 / (1 + Math.pow(s.cp / 250, 2));
  }
  const sideLoss = 100 - sideWin;
  const total = sideWin + sideDraw + sideLoss;
  const w = sideWin / total * 100;
  const d = sideDraw / total * 100;
  const l = sideLoss / total * 100;
  const red = turn === 'w' ? w : l;
  const black = turn === 'w' ? l : w;
  return { red, draw: d, black };
}

function WinRateBar({ red, draw, black }: { red: number; draw: number; black: number }) {
  const total = red + draw + black;
  if (total === 0) return null;
  const redPct = red.toFixed(1);
  const drawPct = draw.toFixed(1);
  const blackPct = black.toFixed(1);
  return (
    <div className="winrate">
      <div className="winrate-labels">
        <span className="winrate-red">红方 {redPct}%</span>
        <span className="winrate-draw">和 {drawPct}%</span>
        <span className="winrate-black">黑方 {blackPct}%</span>
      </div>
      <div className="eval-bar">
        <div className="eval-red" style={{ width: `${redPct}%` }} />
        <div className="eval-draw" style={{ width: `${drawPct}%` }} />
        <div className="eval-black" style={{ width: `${blackPct}%` }} />
      </div>
    </div>
  );
}

export default function AnalysisPanel({ info, result, analysing, connected, fen, computerTurn, gameOver, enabled, onToggleEnabled, shallow, ratesEnabled, onToggleRates }: Props) {
  // 只显示与分析请求局面（fen）一致的数据，避免棋盘已变时挂着旧局面的分析
  const infoCurrent = !!info && info.fen === fen;
  const resultCurrent = !!result && result.fen === fen;

  const bestMoveCn = resultCurrent
    ? (result?.best_move_cn
        ?? (result?.best_move && /^[a-i][0-9][a-i][0-9]$/.test(result.best_move)
          ? uciToChineseNotation(result.best_move, result.fen || fen)
          : null))
    : null;

  const pvList: string[] = infoCurrent
    ? (info?.pv_cn && info.pv_cn.length > 0
        ? info.pv_cn
        : (info?.pv ? pvToChineseSequence(info.pv, info.fen || fen, 6).split(' ') : []))
    : [];
  // 变化线第一步的走棋方（决定红黑着色顺序）
  const startTurn = infoCurrent && info.fen ? info.fen.split(' ')[1] : 'w';

  // 实时胜率：终局直接用结果；对局中只显示与当前局面一致的胜率
  const rates = gameOver
    ? terminalRates(gameOver)
    : shallow && shallow.fen === fen
      ? winRates(shallow)
      : null;

  return (
    <div className={`analysis-panel${enabled ? '' : ' collapsed'}`}>
      <div className="analysis-header">
        <h3>引擎分析</h3>
        <label className="analysis-toggle" title="显示/隐藏引擎分析">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          分析
        </label>
        <label className="analysis-toggle" title="显示/隐藏实时胜率">
          <input
            type="checkbox"
            checked={ratesEnabled}
            onChange={(e) => onToggleRates(e.target.checked)}
          />
          胜率
        </label>
        <span className={`status-dot ${connected ? 'connected' : ''} ${analysing ? 'pulsing' : ''} ${!enabled ? 'disabled' : ''}`} />
      </div>

      {enabled && !connected && (
        <p className="analysis-status">引擎未连接</p>
      )}

      {enabled && gameOver && connected && (
        <p className="analysis-status">对局结束</p>
      )}

      {enabled && !gameOver && computerTurn && connected && (
        <p className="analysis-status">电脑走棋中，暂不分析</p>
      )}

      {enabled && !gameOver && !computerTurn && analysing && !info && (
        <p className="analysis-status thinking">
          分析中<span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
        </p>
      )}

      {enabled && !gameOver && !computerTurn && infoCurrent && (
        <div key={info.fen} className="analysis-info">
          <div className="score-display">
            <span className="score-value">
              {formatScore(info.score_cp, info.score_mate)}
            </span>
            <span className="depth-badge">深度 {info.depth}</span>
          </div>

          {pvList.length > 0 && (
            <div className="pv-line">
              <span className="pv-label">最佳变化:</span>
              <span className="pv-moves">
                {pvList.map((m, i) => {
                  const red = startTurn === 'w' ? i % 2 === 0 : i % 2 === 1;
                  return (
                    <span key={i} className={red ? 'pv-red' : 'pv-black'}>{m} </span>
                  );
                })}
              </span>
            </div>
          )}

          <div className="engine-stats">
            <span>节点: {formatNodes(info.nodes)}</span>
            <span>速度: {formatNodes(info.nps)}/s</span>
          </div>
        </div>
      )}

      {enabled && !gameOver && !computerTurn && resultCurrent && !analysing && bestMoveCn && (
        <div className="best-move-display">
          <span className="best-label">最佳着法:</span>
          <span className={`best-move ${startTurn === 'w' ? 'best-red' : 'best-black'}`}>
            {bestMoveCn}
          </span>
        </div>
      )}

      {/* 实时胜率区 */}
      {ratesEnabled && (
        <div className="rates-section">
          {!rates && connected && (
            <p className="analysis-status">局势分析中…</p>
          )}
          {rates && (
            <WinRateBar red={rates.red} draw={rates.draw} black={rates.black} />
          )}
        </div>
      )}
    </div>
  );
}
