import type { EngineInfo } from '../../hooks/useEngine';
import { uciToChineseNotation } from '../../lib/notation';
import { parseFen, applyMove, toFen, uciToSquare } from '../../lib/fen';
import { terminalRates, winRates } from '../../lib/winrate';
import { WinRateBar } from '../WinRateBar';
import './AnalysisPanel.css';

interface Props {
  info: EngineInfo | null;
  analysing: boolean;
  connected: boolean;
  fen: string;
  computerTurn: boolean;
  gameOver: string | null;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  /** 实时胜率：浅层独立数据源 */
  shallow: import('../../hooks/useEngine').ShallowScore | null;
  /** Top N 候选线（0 = 最佳） */
  lines: import('../../hooks/useEngine').EngineInfo[];
  ratesEnabled: boolean;
  onToggleRates: (v: boolean) => void;
}

const RANK_BADGES = ['①', '②', '③'];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
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

function lineScore(line: import('../../hooks/useEngine').EngineInfo): string {
  if (line.score_mate !== null) {
    return line.score_mate > 0 ? `杀${line.score_mate}` : `被杀${Math.abs(line.score_mate)}`;
  }
  return `${line.score_cp >= 0 ? '+' : ''}${(line.score_cp / 100).toFixed(1)}`;
}

export default function AnalysisPanel({ info, lines, analysing, connected, fen, computerTurn, gameOver, enabled, onToggleEnabled, shallow, ratesEnabled, onToggleRates }: Props) {
  // Top 候选线：优先当前局面的数据，无则用最近一次（stale 降透明度）
  const currentLines = lines.length > 0 ? lines.filter((l) => l.fen === fen) : [];
  const displayLines = currentLines.length > 0 ? currentLines : lines;
  const stale = displayLines.length > 0 && currentLines.length === 0;

  const bestLine = displayLines[0] ?? info;
  const startTurn = bestLine?.fen ? bestLine.fen.split(' ')[1] : 'w';

  // 变化线第一步的走棋方（决定红黑着色顺序）
  const pvList: string[] = bestLine
    ? (bestLine.pv_cn && bestLine.pv_cn.length > 0
        ? bestLine.pv_cn
        : (bestLine.pv ? pvToChineseSequence(bestLine.pv, bestLine.fen || fen, 6).split(' ') : []))
    : [];

  // 实时胜率：有浅层数据就持续展示（新数据到达后条宽平滑过渡），过期的降透明度
  const rates = gameOver
    ? terminalRates(gameOver)
    : winRates(shallow);
  const ratesStale = !gameOver && !!shallow && shallow.fen !== fen;

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

      {enabled && !gameOver && !bestLine && (
        <p className="analysis-status">
          {computerTurn ? '电脑走棋中，暂不分析' : analysing ? (
            <>分析中<span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span></>
          ) : '等待分析'}
        </p>
      )}

      {enabled && !gameOver && bestLine && (
        <div className={`analysis-info${stale ? ' stale' : ''}`}>
          <div className="top-lines">
            {displayLines.slice(0, 3).map((line, i) => (
              <div key={i} className={`top-line${i === 0 ? ' best' : ''}`}>
                <span className="rank-badge">{RANK_BADGES[i]}</span>
                <span className={`tl-move ${startTurn === 'w' ? 'tl-red' : 'tl-black'}`}>
                  {line.pv_cn?.[0]
                    ?? (line.pv?.[0] ? uciToChineseNotation(line.pv[0], line.fen || fen) : '—')}
                </span>
                <span className="tl-score">{lineScore(line)}</span>
                <span className="tl-depth">深度 {line.depth}</span>
              </div>
            ))}
          </div>

          {pvList.length > 0 && (
            <div className="pv-line">
              <span className="pv-label">最佳变化:</span>
              <span className="pv-moves">
                {pvList.map((m, i) => {
                  const red = startTurn === 'w' ? i % 2 === 0 : i % 2 === 1;
                  return (
                    <span key={`${bestLine.fen}-${i}`} className={red ? 'pv-red' : 'pv-black'}>{m} </span>
                  );
                })}
              </span>
            </div>
          )}

          <div className="engine-stats">
            <span>节点 <span key={bestLine.nodes} className="stat-num">{formatCount(bestLine.nodes)}</span></span>
            <span>速度 <span key={bestLine.nps} className="stat-num">{formatCount(bestLine.nps)}/s</span></span>
          </div>
        </div>
      )}

      {/* 实时胜率区：旧数据持续展示（电脑走棋期间也不清空，保持面板高度），新数据到达后平滑过渡 */}
      {ratesEnabled && (
        <div className={`rates-section${ratesStale ? ' stale' : ''}`}>
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
