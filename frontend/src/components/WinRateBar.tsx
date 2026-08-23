import { AnimatedNumber } from './AnalysisPanel/AnimatedNumber';

/** 胜率条组件（compact 模式供移动端棋盘上方条使用） */
export function WinRateBar({ red, draw, black, compact = false }: {
  red: number;
  draw: number;
  black: number;
  compact?: boolean;
}) {
  const total = red + draw + black;
  if (total === 0) return null;
  // 领先方：百分比最大的一侧金色高亮
  const lead = red >= draw && red >= black ? 'red' : black >= draw ? 'black' : 'draw';
  return (
    <div className={`winrate${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="winrate-labels">
          <span className={`wr-item red ${lead === 'red' ? 'lead' : ''}`}>
            <span className="wr-name">红方</span>
            <AnimatedNumber className="wr-num" value={red} suffix="%" />
          </span>
          <span className={`wr-item draw ${lead === 'draw' ? 'lead' : ''}`}>
            <span className="wr-name">和棋</span>
            <AnimatedNumber className="wr-num" value={draw} suffix="%" />
          </span>
          <span className={`wr-item black ${lead === 'black' ? 'lead' : ''}`}>
            <span className="wr-name">黑方</span>
            <AnimatedNumber className="wr-num" value={black} suffix="%" />
          </span>
        </div>
      )}
      {compact && (
        <div className="winrate-labels compact">
          <span className={`wr-mini red ${lead === 'red' ? 'lead' : ''}`}>
            红 <AnimatedNumber className="wr-num-mini" value={red} decimals={0} suffix="%" />
          </span>
          <span className={`wr-mini draw ${lead === 'draw' ? 'lead' : ''}`}>
            和 <AnimatedNumber className="wr-num-mini" value={draw} decimals={0} suffix="%" />
          </span>
          <span className={`wr-mini black ${lead === 'black' ? 'lead' : ''}`}>
            黑 <AnimatedNumber className="wr-num-mini" value={black} decimals={0} suffix="%" />
          </span>
        </div>
      )}
      <div className="eval-bar">
        <div className="eval-red" style={{ width: `${red.toFixed(1)}%` }} />
        <div className="eval-draw" style={{ width: `${draw.toFixed(1)}%` }} />
        <div className="eval-black" style={{ width: `${black.toFixed(1)}%` }} />
      </div>
    </div>
  );
}
