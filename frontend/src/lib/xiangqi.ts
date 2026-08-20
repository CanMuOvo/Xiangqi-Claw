/**
 * Xiangqi move generation and validation.
 *
 * Board coordinate system: row 0 = top (rank 9), col 0 = file a.
 * Red pieces are uppercase, black pieces are lowercase.
 * Red starts at the bottom (rows 7-9), black at the top (rows 0-2).
 */

import {
  type Board,
  type PieceChar,
  type Position,
  type Side,
  type Square,
  isRedPiece,
  uciMove,
} from './fen';

function pieceColor(p: PieceChar): Side {
  return isRedPiece(p) ? 'w' : 'b';
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 10 && c >= 0 && c < 9;
}

function inPalace(r: number, c: number, side: Side): boolean {
  if (c < 3 || c > 5) return false;
  if (side === 'w') return r >= 7 && r <= 9;
  return r >= 0 && r <= 2;
}

function ownHalf(r: number, side: Side): boolean {
  return side === 'w' ? r >= 5 : r <= 4;
}

function generatePieceMoves(
  board: Board,
  row: number,
  col: number,
  piece: PieceChar,
): Square[] {
  const side = pieceColor(piece);
  const type = piece.toLowerCase();
  const targets: Square[] = [];

  const canMoveTo = (r: number, c: number): boolean => {
    if (!inBounds(r, c)) return false;
    const target = board[r][c];
    if (target !== null && pieceColor(target) === side) return false;
    return true;
  };

  if (type === 'r') {
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (let i = 1; i < 10; i++) {
        const nr = row + dr * i;
        const nc = col + dc * i;
        if (!inBounds(nr, nc)) break;
        if (board[nr][nc] === null) {
          targets.push({ row: nr, col: nc });
        } else {
          if (pieceColor(board[nr][nc]!) !== side) targets.push({ row: nr, col: nc });
          break;
        }
      }
    }
  } else if (type === 'c') {
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      let jumped = false;
      for (let i = 1; i < 10; i++) {
        const nr = row + dr * i;
        const nc = col + dc * i;
        if (!inBounds(nr, nc)) break;
        if (!jumped) {
          if (board[nr][nc] === null) {
            targets.push({ row: nr, col: nc });
          } else {
            jumped = true;
          }
        } else {
          if (board[nr][nc] !== null) {
            if (pieceColor(board[nr][nc]!) !== side) targets.push({ row: nr, col: nc });
            break;
          }
        }
      }
    }
  } else if (type === 'n') {
    const knightMoves: [number, number, number, number][] = [
      [-2, -1, -1, 0], [-2, 1, -1, 0],
      [2, -1, 1, 0], [2, 1, 1, 0],
      [-1, -2, 0, -1], [-1, 2, 0, 1],
      [1, -2, 0, -1], [1, 2, 0, 1],
    ];
    for (const [dr, dc, blockR, blockC] of knightMoves) {
      const br = row + blockR;
      const bc = col + blockC;
      if (!inBounds(br, bc) || board[br][bc] !== null) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (canMoveTo(nr, nc)) targets.push({ row: nr, col: nc });
    }
  } else if (type === 'b') {
    const elephantMoves: [number, number, number, number][] = [
      [-2, -2, -1, -1], [-2, 2, -1, 1],
      [2, -2, 1, -1], [2, 2, 1, 1],
    ];
    for (const [dr, dc, blockR, blockC] of elephantMoves) {
      const br = row + blockR;
      const bc = col + blockC;
      if (!inBounds(br, bc) || board[br][bc] !== null) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) continue;
      if (!ownHalf(nr, side)) continue;
      if (canMoveTo(nr, nc)) targets.push({ row: nr, col: nc });
    }
  } else if (type === 'a') {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (!inPalace(nr, nc, side)) continue;
      if (canMoveTo(nr, nc)) targets.push({ row: nr, col: nc });
    }
  } else if (type === 'k') {
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nr = row + dr;
      const nc = col + dc;
      if (!inPalace(nr, nc, side)) continue;
      if (canMoveTo(nr, nc)) targets.push({ row: nr, col: nc });
    }
    // Flying general: if two kings face each other on the same file with nothing between
    const opponentKing = side === 'w' ? 'k' : 'K';
    for (const dir of [-1, 1]) {
      for (let r = row + dir; r >= 0 && r < 10; r += dir) {
        if (board[r][col] !== null) {
          if (board[r][col] === opponentKing) targets.push({ row: r, col });
          break;
        }
      }
    }
  } else if (type === 'p') {
    if (side === 'w') {
      if (canMoveTo(row - 1, col)) targets.push({ row: row - 1, col });
      if (!ownHalf(row, side)) {
        if (canMoveTo(row, col - 1)) targets.push({ row, col: col - 1 });
        if (canMoveTo(row, col + 1)) targets.push({ row, col: col + 1 });
      }
    } else {
      if (canMoveTo(row + 1, col)) targets.push({ row: row + 1, col });
      if (!ownHalf(row, side)) {
        if (canMoveTo(row, col - 1)) targets.push({ row, col: col - 1 });
        if (canMoveTo(row, col + 1)) targets.push({ row, col: col + 1 });
      }
    }
  }

  return targets;
}

function findKing(board: Board, side: Side): Square | null {
  const king = side === 'w' ? 'K' : 'k';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === king) return { row: r, col: c };
    }
  }
  return null;
}

function isUnderAttack(board: Board, sq: Square, byWhom: Side): boolean {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === null || pieceColor(p) !== byWhom) continue;
      const moves = generatePieceMoves(board, r, c, p);
      if (moves.some(m => m.row === sq.row && m.col === sq.col)) return true;
    }
  }
  return false;
}

export function isInCheck(pos: Position): boolean {
  const kingSq = findKing(pos.board, pos.turn);
  if (!kingSq) return false;
  const opponent: Side = pos.turn === 'w' ? 'b' : 'w';
  return isUnderAttack(pos.board, kingSq, opponent);
}

export function generateLegalMoves(pos: Position): { from: Square; to: Square }[] {
  const moves: { from: Square; to: Square }[] = [];
  const { board, turn } = pos;

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === null || pieceColor(p) !== turn) continue;
      const targets = generatePieceMoves(board, r, c, p);
      for (const to of targets) {
        // 将不能作为目标被吃（只能被将军/将死）；仅"将"的飞将特例可吃对方将
        const targetPiece = board[to.row][to.col];
        const isKingMove = p === 'K' || p === 'k';
        if ((targetPiece === 'k' || targetPiece === 'K') && !isKingMove) continue;
        const newBoard = board.map(row => [...row]);
        newBoard[to.row][to.col] = newBoard[r][c];
        newBoard[r][c] = null;
        const kingSq = findKing(newBoard, turn);
        if (!kingSq) continue;
        const opponent: Side = turn === 'w' ? 'b' : 'w';
        if (!isUnderAttack(newBoard, kingSq, opponent)) {
          moves.push({ from: { row: r, col: c }, to });
        }
      }
    }
  }

  return moves;
}

export function isLegalMove(pos: Position, from: Square, to: Square): boolean {
  const legal = generateLegalMoves(pos);
  return legal.some(
    m => m.from.row === from.row && m.from.col === from.col &&
         m.to.row === to.row && m.to.col === to.col,
  );
}

export function isCheckmate(pos: Position): boolean {
  // 对方无将（被飞将吃掉）视为将死
  const opponent: Side = pos.turn === 'w' ? 'b' : 'w';
  if (!findKing(pos.board, opponent)) return true;
  if (!isInCheck(pos)) return false;
  return generateLegalMoves(pos).length === 0;
}

export function isStalemate(pos: Position): boolean {
  if (isInCheck(pos)) return false;
  return generateLegalMoves(pos).length === 0;
}

export function getLegalMovesUci(pos: Position): string[] {
  return generateLegalMoves(pos).map(m => uciMove(m.from, m.to));
}

export function getLegalTargets(pos: Position, from: Square): Square[] {
  return generateLegalMoves(pos)
    .filter(m => m.from.row === from.row && m.from.col === from.col)
    .map(m => m.to);
}
