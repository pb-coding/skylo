import { GameAction, PlayerObservation } from "../../protocol/gameProtocol";
import { assertRunning, BotContext, BotDecision, BotStrategy, sample } from "./types";

export class RandomBot implements BotStrategy {
  readonly id = "random";
  readonly version = "1";
  private disposed = false;

  async decide(_observation: PlayerObservation, legalActions: readonly GameAction[], context: BotContext): Promise<BotDecision> {
    assertRunning(context.signal, this.disposed);
    if (legalActions.length === 0) throw new Error("No legal action available");
    return {
      action: legalActions[Math.floor(sample(context.random) * legalActions.length)],
      explanation: "Wählt zufällig eine erlaubte Aktion.",
    };
  }

  dispose(): void { this.disposed = true; }
}
