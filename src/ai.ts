// Chess AI: negamax with alpha-beta pruning, material + piece-square evaluation,
// and MVV-LVA capture ordering. Pure functions so it can run in a worker.

import {
  State,
  Move,
  Color,
  PieceType,
  legalMoves,
  applyMove,
  inCheck,
  fileOf,
  rankOf,
} from "./chess";

const VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables (from white's perspective, a1 = index 0).
// Encourage central control, knight/bishop development, king safety.
const PST: Record<PieceType, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0,
    -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10,
    20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0,
    0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15,
    20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0,
    -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10,
    10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10,
    10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0,
    -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5,
    5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10,
    0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5,
    -10, -10, -20,
  ],
  k: [
    20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20,
    -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40,
    -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30,
    -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

function mirror(i: number): number {
  // flip rank for black
  const f = fileOf(i);
  const r = rankOf(i);
  return (7 - r) * 8 + f;
}

function evaluate(s: State): number {
  // Positive = good for side to move.
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p) continue;
    const base = VALUE[p.type];
    const pst = p.color === "w" ? PST[p.type][i] : PST[p.type][mirror(i)];
    const v = base + pst;
    score += p.color === "w" ? v : -v;
  }
  const persp = s.turn === "w" ? 1 : -1;
  return score * persp;
}

function orderMoves(s: State, moves: Move[]): Move[] {
  return moves
    .map((m) => {
      let s2 = 0;
      if (m.capture) {
        const victim = s.board[m.to];
        const attacker = s.board[m.from]!;
        const vv = victim ? VALUE[victim.type] : VALUE.p; // ep
        s2 = 10 * vv - VALUE[attacker.type];
      }
      if (m.promotion) s2 += VALUE[m.promotion];
      return { m, s2 };
    })
    .sort((a, b) => b.s2 - a.s2)
    .map((x) => x.m);
}

function negamax(
  s: State,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) return evaluate(s);
  const moves = legalMoves(s);
  if (moves.length === 0) {
    // checkmate (bad) or stalemate (neutral)
    if (inCheck(s, s.turn)) return -100000 - depth;
    return 0;
  }
  let best = -Infinity;
  for (const m of orderMoves(s, moves)) {
    const ns = applyMove(s, m);
    const score = -negamax(ns, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export type Difficulty = "chill" | "smart" | "ruthless";

const DEPTH: Record<Difficulty, number> = {
  chill: 2,
  smart: 3,
  ruthless: 4,
};

export function bestMove(
  s: State,
  side: Color,
  difficulty: Difficulty,
): Move | null {
  if (s.turn !== side) return null;
  const moves = legalMoves(s);
  if (moves.length === 0) return null;

  const depth = DEPTH[difficulty];
  let best: Move = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  // small randomness among near-equal best moves for variety, but never on ruthless
  const candidates: { m: Move; score: number }[] = [];
  for (const m of orderMoves(s, moves)) {
    const ns = applyMove(s, m);
    const score = -negamax(ns, depth - 1, -beta, -alpha);
    candidates.push({ m, score });
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
    if (bestScore > alpha) alpha = bestScore;
  }

  if (difficulty !== "ruthless") {
    const wiggle = difficulty === "chill" ? 40 : 15;
    const near = candidates.filter((c) => c.score >= bestScore - wiggle);
    if (near.length > 0) best = near[Math.floor(Math.random() * near.length)].m;
  }

  return best;
}
