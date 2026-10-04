import { BotConfig, GameAction, GameEvent, PlayerObservation } from "../../protocol/gameProtocol";

export type DecisionBudget = { maxMs: number; maxIterations: number };
export type BotContext = {
  signal: AbortSignal;
  random: () => number;
  budget: DecisionBudget;
};
export type BotDecision = { action: GameAction; explanation?: string };

/** Strategies see a player's observation only; never pass a GameCore here. */
export interface BotStrategy {
  readonly id: string;
  readonly version: string;
  decide(observation: PlayerObservation, legalActions: readonly GameAction[], context: BotContext): Promise<BotDecision>;
  onStart?(observation: PlayerObservation): void | Promise<void>;
  onEvent?(event: GameEvent, observation?: PlayerObservation): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export type BotFactory = (config: Readonly<BotConfig>) => BotStrategy;
export type BotRegistration = { id: string; version: string; name: string; factory: BotFactory };

export function assertRunning(signal: AbortSignal, disposed = false): void {
  if (signal.aborted || disposed) {
    const error = new Error(disposed ? "Bot has been disposed" : "Bot decision aborted");
    error.name = "AbortError";
    throw error;
  }
}

/** A malformed random source cannot produce an out-of-range action index. */
export function sample(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.5;
}
