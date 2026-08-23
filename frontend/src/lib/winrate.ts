import type { ShallowScore } from '../hooks/useEngine';

/* ---------- 实时胜率计算：纯函数（分析面板 / 移动端棋盘上方条共用） ---------- */

// 终局胜率：绝杀 = 对应方 100%，和棋 = 100% 和（不依赖引擎，即时显示）
export function terminalRates(gameOver: string): { red: number; draw: number; black: number } | null {
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
export function winRates(s: ShallowScore | null): { red: number; draw: number; black: number } | null {
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
