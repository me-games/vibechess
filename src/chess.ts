// A compact but complete chess engine: legal move generation (incl. castling,
// en passant, promotion), check / checkmate / stalemate detection.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Move {
  from: number; // 0..63
  to: number;
  promotion?: PieceType;
  // flags
  capture?: boolean;
  enPassant?: boolean;
  castle?: "k" | "q";
  double?: boolean; // pawn double push
}

export interface State {
  board: (Piece | null)[]; // index = rank*8 + file, rank 0 = a1..h1 (white home)
  turn: Color;
  castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean };
  ep: number | null; // en passant target square index
  halfmove: number;
  fullmove: number;
}

export const FILES = "abcdefgh";

export function sq(file: number, rank: number): number {
  return rank * 8 + file;
}
export function fileOf(i: number): number {
  return i % 8;
}
export function rankOf(i: number): number {
  return Math.floor(i / 8);
}
export function squareName(i: number): string {
  return FILES[fileOf(i)] + (rankOf(i) + 1);
}

export function initialState(): State {
  const board: (Piece | null)[] = new Array(64).fill(null);
  const back: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let f = 0; f < 8; f++) {
    board[sq(f, 0)] = { type: back[f], color: "w" };
    board[sq(f, 1)] = { type: "p", color: "w" };
    board[sq(f, 6)] = { type: "p", color: "b" };
    board[sq(f, 7)] = { type: back[f], color: "b" };
  }
  return {
    board,
    turn: "w",
    castling: { wk: true, wq: true, bk: true, bq: true },
    ep: null,
    halfmove: 0,
    fullmove: 1,
  };
}

export function cloneState(s: State): State {
  return {
    board: s.board.slice(),
    turn: s.turn,
    castling: { ...s.castling },
    ep: s.ep,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
  };
}

const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_DELTAS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

// Is square `target` attacked by side `by`?
export function isAttacked(s: State, target: number, by: Color): boolean {
  const tf = fileOf(target);
  const tr = rankOf(target);

  // pawn attacks: a pawn of color `by` attacks diagonally forward
  const dir = by === "w" ? 1 : -1;
  for (const df of [-1, 1]) {
    const f = tf + df;
    const r = tr - dir; // square the attacking pawn would sit on
    if (onBoard(f, r)) {
      const p = s.board[sq(f, r)];
      if (p && p.color === by && p.type === "p") return true;
    }
  }
  // knights
  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r)) {
      const p = s.board[sq(f, r)];
      if (p && p.color === by && p.type === "n") return true;
    }
  }
  // king
  for (const [df, dr] of KING_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r)) {
      const p = s.board[sq(f, r)];
      if (p && p.color === by && p.type === "k") return true;
    }
  }
  // sliders: bishop/queen
  for (const [df, dr] of BISHOP_DIRS) {
    let f = tf + df;
    let r = tr + dr;
    while (onBoard(f, r)) {
      const p = s.board[sq(f, r)];
      if (p) {
        if (p.color === by && (p.type === "b" || p.type === "q")) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  // sliders: rook/queen
  for (const [df, dr] of ROOK_DIRS) {
    let f = tf + df;
    let r = tr + dr;
    while (onBoard(f, r)) {
      const p = s.board[sq(f, r)];
      if (p) {
        if (p.color === by && (p.type === "r" || p.type === "q")) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return false;
}

export function findKing(s: State, color: Color): number {
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p && p.type === "k" && p.color === color) return i;
  }
  return -1;
}

export function inCheck(s: State, color: Color): boolean {
  const k = findKing(s, color);
  if (k < 0) return false;
  return isAttacked(s, k, color === "w" ? "b" : "w");
}

// Pseudo-legal moves for the side to move (does not check king safety).
function pseudoMoves(s: State): Move[] {
  const moves: Move[] = [];
  const me = s.turn;
  const opp: Color = me === "w" ? "b" : "w";

  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.color !== me) continue;
    const f = fileOf(i);
    const r = rankOf(i);

    if (p.type === "p") {
      const dir = me === "w" ? 1 : -1;
      const startRank = me === "w" ? 1 : 6;
      const promoRank = me === "w" ? 7 : 0;
      const oneR = r + dir;
      // forward one
      if (onBoard(f, oneR) && !s.board[sq(f, oneR)]) {
        if (oneR === promoRank) {
          for (const pr of ["q", "r", "b", "n"] as PieceType[])
            moves.push({ from: i, to: sq(f, oneR), promotion: pr });
        } else {
          moves.push({ from: i, to: sq(f, oneR) });
          // forward two
          if (r === startRank && !s.board[sq(f, r + 2 * dir)]) {
            moves.push({ from: i, to: sq(f, r + 2 * dir), double: true });
          }
        }
      }
      // captures
      for (const df of [-1, 1]) {
        const cf = f + df;
        const cr = r + dir;
        if (!onBoard(cf, cr)) continue;
        const t = sq(cf, cr);
        const tp = s.board[t];
        if (tp && tp.color === opp) {
          if (cr === promoRank) {
            for (const pr of ["q", "r", "b", "n"] as PieceType[])
              moves.push({ from: i, to: t, promotion: pr, capture: true });
          } else {
            moves.push({ from: i, to: t, capture: true });
          }
        } else if (s.ep !== null && t === s.ep) {
          moves.push({ from: i, to: t, capture: true, enPassant: true });
        }
      }
    } else if (p.type === "n") {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const nf = f + df;
        const nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const t = sq(nf, nr);
        const tp = s.board[t];
        if (!tp) moves.push({ from: i, to: t });
        else if (tp.color === opp) moves.push({ from: i, to: t, capture: true });
      }
    } else if (p.type === "k") {
      for (const [df, dr] of KING_DELTAS) {
        const nf = f + df;
        const nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const t = sq(nf, nr);
        const tp = s.board[t];
        if (!tp) moves.push({ from: i, to: t });
        else if (tp.color === opp) moves.push({ from: i, to: t, capture: true });
      }
      // castling
      const rights = s.castling;
      const homeRank = me === "w" ? 0 : 7;
      if (r === homeRank && f === 4 && !inCheck(s, me)) {
        const kSide = me === "w" ? rights.wk : rights.bk;
        const qSide = me === "w" ? rights.wq : rights.bq;
        if (
          kSide &&
          !s.board[sq(5, homeRank)] &&
          !s.board[sq(6, homeRank)] &&
          s.board[sq(7, homeRank)]?.type === "r" &&
          !isAttacked(s, sq(5, homeRank), opp) &&
          !isAttacked(s, sq(6, homeRank), opp)
        ) {
          moves.push({ from: i, to: sq(6, homeRank), castle: "k" });
        }
        if (
          qSide &&
          !s.board[sq(3, homeRank)] &&
          !s.board[sq(2, homeRank)] &&
          !s.board[sq(1, homeRank)] &&
          s.board[sq(0, homeRank)]?.type === "r" &&
          !isAttacked(s, sq(3, homeRank), opp) &&
          !isAttacked(s, sq(2, homeRank), opp)
        ) {
          moves.push({ from: i, to: sq(2, homeRank), castle: "q" });
        }
      }
    } else {
      // sliders
      const dirs =
        p.type === "b"
          ? BISHOP_DIRS
          : p.type === "r"
            ? ROOK_DIRS
            : [...BISHOP_DIRS, ...ROOK_DIRS];
      for (const [df, dr] of dirs) {
        let nf = f + df;
        let nr = r + dr;
        while (onBoard(nf, nr)) {
          const t = sq(nf, nr);
          const tp = s.board[t];
          if (!tp) moves.push({ from: i, to: t });
          else {
            if (tp.color === opp) moves.push({ from: i, to: t, capture: true });
            break;
          }
          nf += df;
          nr += dr;
        }
      }
    }
  }
  return moves;
}

// Apply a move to a state, returning a new state (assumes the move is legal).
export function applyMove(prev: State, m: Move): State {
  const s = cloneState(prev);
  const piece = s.board[m.from]!;
  const me = piece.color;
  const opp: Color = me === "w" ? "b" : "w";

  s.ep = null;

  // move piece
  s.board[m.from] = null;

  if (m.enPassant) {
    // captured pawn sits behind the target square
    const capRank = me === "w" ? rankOf(m.to) - 1 : rankOf(m.to) + 1;
    s.board[sq(fileOf(m.to), capRank)] = null;
  }

  s.board[m.to] = m.promotion ? { type: m.promotion, color: me } : piece;

  if (m.double) {
    s.ep = sq(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2);
  }

  if (m.castle) {
    const homeRank = rankOf(m.from);
    if (m.castle === "k") {
      s.board[sq(5, homeRank)] = s.board[sq(7, homeRank)];
      s.board[sq(7, homeRank)] = null;
    } else {
      s.board[sq(3, homeRank)] = s.board[sq(0, homeRank)];
      s.board[sq(0, homeRank)] = null;
    }
  }

  // update castling rights
  if (piece.type === "k") {
    if (me === "w") {
      s.castling.wk = false;
      s.castling.wq = false;
    } else {
      s.castling.bk = false;
      s.castling.bq = false;
    }
  }
  // rook moved or captured
  const touch = (i: number) => {
    if (i === sq(0, 0)) s.castling.wq = false;
    if (i === sq(7, 0)) s.castling.wk = false;
    if (i === sq(0, 7)) s.castling.bq = false;
    if (i === sq(7, 7)) s.castling.bk = false;
  };
  touch(m.from);
  touch(m.to);

  // halfmove clock
  if (piece.type === "p" || m.capture) s.halfmove = 0;
  else s.halfmove++;
  if (me === "b") s.fullmove++;

  s.turn = opp;
  return s;
}

// All fully-legal moves for the side to move.
export function legalMoves(s: State): Move[] {
  const me = s.turn;
  const out: Move[] = [];
  for (const m of pseudoMoves(s)) {
    const ns = applyMove(s, m);
    if (!inCheck(ns, me)) out.push(m);
  }
  return out;
}

export function legalMovesFrom(s: State, from: number): Move[] {
  return legalMoves(s).filter((m) => m.from === from);
}

export type Result = "playing" | "checkmate" | "stalemate" | "draw";

export function gameResult(s: State): Result {
  const moves = legalMoves(s);
  if (moves.length === 0) {
    return inCheck(s, s.turn) ? "checkmate" : "stalemate";
  }
  if (s.halfmove >= 100) return "draw";
  return "playing";
}
