export const STARTING_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export const FILES = 'abcdefghi';
export const RANKS = 10;
export const COLS = 9;

export type PieceChar =
  | 'r' | 'n' | 'b' | 'a' | 'k' | 'c' | 'p'
  | 'R' | 'N' | 'B' | 'A' | 'K' | 'C' | 'P';

export type Side = 'w' | 'b';

export interface Square {
  row: number; // 0 = top (rank 9, black back rank)
  col: number; // 0 = file a (left)
}

export type Board = (PieceChar | null)[][];

export interface Position {
  board: Board;
  turn: Side;
}

export function parseFen(fen: string): Position {
  const parts = fen.split(' ');
  const ranks = parts[0].split('/');
  const board: Board = [];

  for (const rank of ranks) {
    const row: (PieceChar | null)[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '9') {
        for (let i = 0; i < parseInt(ch); i++) row.push(null);
      } else {
        row.push(ch as PieceChar);
      }
    }
    board.push(row);
  }

  return { board, turn: (parts[1] as Side) || 'w' };
}

export function toFen(pos: Position): string {
  const ranks: string[] = [];
  for (const row of pos.board) {
    let rank = '';
    let empty = 0;
    for (const cell of row) {
      if (cell === null) {
        empty++;
      } else {
        if (empty > 0) { rank += empty; empty = 0; }
        rank += cell;
      }
    }
    if (empty > 0) rank += empty;
    ranks.push(rank);
  }
  return `${ranks.join('/')} ${pos.turn} - - 0 1`;
}

export function squareToUci(sq: Square): string {
  return FILES[sq.col] + (9 - sq.row);
}

export function uciToSquare(uci: string): Square {
  return {
    col: FILES.indexOf(uci[0]),
    row: 9 - parseInt(uci[1]),
  };
}

export function uciMove(from: Square, to: Square): string {
  return squareToUci(from) + squareToUci(to);
}

export function parseUciMove(move: string): { from: Square; to: Square } {
  return {
    from: uciToSquare(move.substring(0, 2)),
    to: uciToSquare(move.substring(2, 4)),
  };
}

export function isRedPiece(piece: PieceChar): boolean {
  return piece === piece.toUpperCase();
}

export function applyMove(pos: Position, from: Square, to: Square): Position {
  const newBoard = pos.board.map(row => [...row]);
  newBoard[to.row][to.col] = newBoard[from.row][from.col];
  newBoard[from.row][from.col] = null;
  return {
    board: newBoard,
    turn: pos.turn === 'w' ? 'b' : 'w',
  };
}
