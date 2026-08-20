/**
 * Convert UCI moves to human-readable Chinese notation for display.
 */

import { isRedPiece, parseFen } from './fen';

const PIECE_NAMES: Record<string, string> = {
  R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵',
  r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒',
};

const RED_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const BLACK_DIGITS = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function uciToChineseNotation(uciMove: string, fen: string): string {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uciMove)) return uciMove;
  const pos = parseFen(fen);
  const fromCol = uciMove.charCodeAt(0) - 97;
  const fromRank = parseInt(uciMove[1]);
  const toCol = uciMove.charCodeAt(2) - 97;
  const toRank = parseInt(uciMove[3]);

  const fromRow = 9 - fromRank;
  const toRow = 9 - toRank;

  const piece = pos.board[fromRow][fromCol];
  if (!piece) return uciMove;

  const isRed = isRedPiece(piece);
  const digits = isRed ? RED_DIGITS : BLACK_DIGITS;
  const pieceName = PIECE_NAMES[piece] || '?';

  const colDisplay = isRed ? 9 - fromCol : fromCol + 1;

  let action: string;
  let target: string;

  const pType = piece.toLowerCase();

  if (fromRow === toRow) {
    action = '平';
    const destCol = isRed ? 9 - toCol : toCol + 1;
    target = digits[destCol];
  } else {
    const forward = isRed ? toRow < fromRow : toRow > fromRow;
    action = forward ? '进' : '退';

    if (pType === 'r' || pType === 'c' || pType === 'p' || pType === 'k') {
      target = digits[Math.abs(toRow - fromRow)];
    } else {
      const destCol = isRed ? 9 - toCol : toCol + 1;
      target = digits[destCol];
    }
  }

  return `${pieceName}${digits[colDisplay]}${action}${target}`;
}
