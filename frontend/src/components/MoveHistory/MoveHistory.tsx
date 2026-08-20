import type { MoveRecord } from '../../hooks/useGame';
import { uciToChineseNotation } from '../../lib/notation';
import './MoveHistory.css';

interface Props {
  moves: MoveRecord[];
  currentIndex: number;
  startFen: string;
  onGoTo: (index: number) => void;
  /** 人机对战：上一步/下一步按整回合步进（撤掉我的棋 + 电脑应手） */
  stepByTurn?: boolean;
  humanIsRed?: boolean;
}

/** 第 index 手之后的局面是否轮到人类走棋（index=-1 为开局） */
function isHumanTurn(index: number, humanIsRed: boolean): boolean {
  if (index === -1) return humanIsRed; // 开局轮到红方
  return (index % 2 === 1) === humanIsRed; // 偶数手后轮到黑方，奇数手后轮到红方
}

/** 把目标索引吸附到最近的「轮到人类」位置 */
function snapToHumanTurn(index: number, humanIsRed: boolean, maxIndex: number): number {
  if (isHumanTurn(index, humanIsRed)) return index;
  for (let i = 1; i <= maxIndex + 2; i++) {
    const back = index - i;
    const fwd = index + i;
    if (back >= -1 && isHumanTurn(back, humanIsRed)) return back;
    if (fwd <= maxIndex && isHumanTurn(fwd, humanIsRed)) return fwd;
  }
  return index;
}

export default function MoveHistory({ moves, currentIndex, startFen, onGoTo, stepByTurn = false, humanIsRed = true }: Props) {
  const pairs: { index: number; red: MoveRecord; black?: MoveRecord }[] = [];

  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      index: i,
      red: moves[i],
      black: moves[i + 1],
    });
  }

  const getFenBefore = (i: number) => {
    return i === 0 ? startFen : moves[i - 1].fen;
  };

  return (
    <div className="move-history">
      <div className="move-history-header">
        <h3>走棋记录</h3>
        <button
          className="nav-btn"
          onClick={() => onGoTo(-1)}
          title="回到开局"
        >
          ⏮
        </button>
        <button
          className="nav-btn"
          onClick={() => {
            if (!stepByTurn) {
              onGoTo(Math.max(-1, currentIndex - 1));
            } else {
              const target = snapToHumanTurn(
                Math.max(-1, currentIndex - 2),
                humanIsRed,
                moves.length - 1,
              );
              onGoTo(target);
            }
          }}
          disabled={currentIndex < 0}
          title="上一步"
        >
          ◀
        </button>
        <button
          className="nav-btn"
          onClick={() => {
            if (!stepByTurn) {
              onGoTo(Math.min(moves.length - 1, currentIndex + 1));
            } else {
              const target = snapToHumanTurn(
                Math.min(moves.length - 1, currentIndex + 2),
                humanIsRed,
                moves.length - 1,
              );
              onGoTo(target);
            }
          }}
          disabled={currentIndex >= moves.length - 1}
          title="下一步"
        >
          ▶
        </button>
        <button
          className="nav-btn"
          onClick={() => onGoTo(moves.length - 1)}
          title="最新"
        >
          ⏭
        </button>
      </div>

      <div className="move-list">
        {pairs.length === 0 && (
          <p className="no-moves">尚未走棋</p>
        )}
        {[...pairs].reverse().map(({ index, red, black }) => (
          <div key={index} className="move-pair">
            <span className="move-number">{Math.floor(index / 2) + 1}.</span>
            <span
              className={`move-item red-move ${currentIndex === index ? 'active' : ''}`}
              onClick={() => onGoTo(index)}
            >
              {uciToChineseNotation(red.uci, getFenBefore(index))}
            </span>
            {black && (
              <span
                className={`move-item black-move ${currentIndex === index + 1 ? 'active' : ''}`}
                onClick={() => onGoTo(index + 1)}
              >
                {uciToChineseNotation(black.uci, getFenBefore(index + 1))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
