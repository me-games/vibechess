// Runs the chess AI off the main thread so the game stays smooth while it thinks.
import { bestMove, Difficulty } from "./ai";
import { State, Color, Move } from "./chess";

interface Req {
  state: State;
  side: Color;
  difficulty: Difficulty;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { state, side, difficulty } = e.data;
  const move: Move | null = bestMove(state, side, difficulty);
  (self as unknown as Worker).postMessage(move);
};
