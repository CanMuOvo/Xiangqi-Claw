import type { MoveRecord } from '../../hooks/useGame';
import { uciToChineseNotation } from '../../lib/notation';
import { parseFen, applyMove, uciToSquare } from '../../lib/fen';
import { isInCheck, isCheckmate } from '../../lib/xiangqi';
import './MoveHistory.css';

/** 单步战术标记：吃子（具体子名）/ 将军 / 绝杀 */
interface MoveFlags {
  captured: string | null;
  check: boolean;
  mate: boolean;
}

const PIECE_CN: Record<string, string> = {
  r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒',
  R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵',
};

function analyzeMove(prevFen: string, uci: string): MoveFlags {
  try {
    const pos = parseFen(prevFen);
    const from = uciToSquare(uci.slice(0, 2));
    const to = uciToSquare(uci.slice(2, 4));
    const target = pos.board[to.row][to.col];
    const next = applyMove(pos, from, to);
    return {
      captured: target ? PIECE_CN[target] ?? target : null,
      check: next ? isInCheck(next) : false,
      mate: next ? isCheckmate(next) : false,
    };
  } catch {
    return { captured: null, check: false, mate: false };
  }
}

interface Props {
  moves: MoveRecord[];
  currentIndex: number;
  startFen: string;
  onGoTo: (index: number) => void;
  /** 人机对战：上一步/下一步按整回合步进（撤掉我的棋 + 电脑应手） */
  stepByTurn?: boolean;
  humanIsRed?: boolean;
  /** 禁用交互（如沙盘演示中，避免点击干扰自动推演） */
  disabled?: boolean;
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

export default function MoveHistory({ moves, currentIndex, startFen, onGoTo, stepByTurn = false, humanIsRed = true, disabled = false }: Props) {
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
          disabled={disabled}
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
          disabled={disabled || currentIndex < 0}
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
          disabled={disabled || currentIndex >= moves.length - 1}
          title="下一步"
        >
          ▶
        </button>
        <button
          className="nav-btn"
          onClick={() => onGoTo(moves.length - 1)}
          title="最新"
          disabled={disabled}
        >
          ⏭
        </button>
      </div>

      <div className={`move-list${disabled ? ' disabled' : ''}`}>
        {pairs.length === 0 && (
          <p className="no-moves">尚未走棋</p>
        )}
        {[...pairs].reverse().map(({ index, red, black }) => (
          <div key={index} className="move-pair">
            <span className="move-number">{Math.floor(index / 2) + 1}.</span>
            <span
              className={`move-item red-move ${currentIndex === index ? 'active' : ''}${disabled ? ' off' : ''}`}
              onClick={() => !disabled && onGoTo(index)}
            >
              {uciToChineseNotation(red.uci, getFenBefore(index))}
              <MoveFlags marks={analyzeMove(getFenBefore(index), red.uci)} />
            </span>
            {black && (
              <span
                className={`move-item black-move ${currentIndex === index + 1 ? 'active' : ''}${disabled ? ' off' : ''}`}
                onClick={() => !disabled && onGoTo(index + 1)}
              >
                {uciToChineseNotation(black.uci, getFenBefore(index + 1))}
                <MoveFlags marks={analyzeMove(getFenBefore(index + 1), black.uci)} />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 战术标记渲染：绝杀 / 将军 / 吃子（显示子名） */
function MoveFlags({ marks }: { marks: MoveFlags }) {
  if (marks.mate) return <span className="mv-flag mate">绝杀</span>;
  if (marks.check) return <span className="mv-flag check">将军</span>;
  if (marks.captured) return <span className="mv-flag cap">吃{marks.captured}</span>;
  return null;
}
