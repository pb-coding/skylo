import { JsonValue, VERSION } from "@typesafe-ai/sdk";
import { GameAction, GameEvent, PlayerObservation } from "../../protocol/gameProtocol";
import { assertRunning, BotContext, BotDecision, BotStrategy } from "./types";
import { buildJevCandidates, buildJevState, jevContextHash, JEV_PROMPT_VERSION } from "./jevState";
import { JevProvider } from "./jevProvider";

export class JevBot implements BotStrategy {
  readonly id = "typesafe-jev-choice";
  readonly version = "1";
  readonly decisionTimeoutMs: number;
  readonly decisionMetadata;
  private disposed = false;
  private history: JsonValue[] = [];
  constructor(private readonly provider: JevProvider) {
    this.decisionTimeoutMs = provider.settings.timeoutMs;
    this.decisionMetadata = { requestedModel: provider.settings.model, sdkVersion: VERSION, promptVersion: JEV_PROMPT_VERSION };
  }

  onEvent(event: GameEvent, observation?: PlayerObservation) {
    if (event.type === "round-started") this.history = [];
    if (!observation) return;
    const seat = observation.players.findIndex(player => player.id === event.playerId);
    // Never forward arbitrary event.data (or names, player IDs, seeds, provider errors).
    const data: { [key: string]: JsonValue } = {};
    for (const key of ["card", "replaced", "round", "turn"]) {
      const value = event.data?.[key];
      if (typeof value === "number" && Number.isFinite(value)) data[key] = value;
    }
    const types = ["card-revealed", "card-drawn", "discard-taken", "card-discarded", "card-placed", "column-removed", "round-closed", "turn-started", "round-ended", "round-started", "stack-refilled"];
    if (types.includes(event.type)) this.history.push({ type: event.type, seat: seat === -1 ? null : seat, ...data });
    if (this.history.length > 32) this.history.splice(0, this.history.length - 32);
  }

  async decide(observation: PlayerObservation, actions: readonly GameAction[], context: BotContext): Promise<BotDecision> {
    assertRunning(context.signal, this.disposed);
    const candidates = buildJevCandidates(observation, actions);
    if (candidates.length === 1) return { action: actions[0], explanation: `Automatische Aktion: ${actionLabel(actions[0])}`,
      diagnostics: { strategyId: this.id, strategyVersion: this.version, source: "automatic", promptVersion: JEV_PROMPT_VERSION } };
    if (!context.publicRules) throw new Error("Jev needs public rules");
    const state = buildJevState(observation, context.publicRules, candidates, this.history);
    const criteria = Object.fromEntries(candidates.map(candidate => [candidate.id, candidate.description]));
    const result = await this.provider.choose(state, criteria, jevContextHash(state, criteria), context);
    assertRunning(context.signal, this.disposed);
    const selected = candidates.find(candidate => candidate.id === result.choice)!;
    // Facts about the selected action; Jev does not generate a reasoning explanation.
    return { action: selected.action, explanation: actionLabel(selected.action, selected.consequences), diagnostics: result.diagnostics };
  }
  dispose() { this.disposed = true; this.history = []; }
}

function actionLabel(action: GameAction, facts?: { [key: string]: JsonValue }): string {
  switch (action.type) {
    case "draw": return "Jev zieht vom Nachziehstapel.";
    case "take-discard": return "Jev nimmt die offene Ablage.";
    case "discard": return "Jev wirft die gezogene Karte ab.";
    case "next-round": return "Nächste Runde.";
    case "reveal": return `Jev deckt Spalte ${facts?.column ?? ""}, Reihe ${facts?.row ?? ""} auf.${facts?.closesRound ? " Löst den Rundenschluss aus." : ""}`;
    case "place": return `Jev setzt ${facts?.placedCard ?? "die Karte"} in Spalte ${facts?.column ?? ""}, Reihe ${facts?.row ?? ""} ein; ersetzt ${facts?.previousCard === null ? "eine verdeckte Karte" : facts?.previousCard ?? "die bisherige Karte"}.${facts?.removedColumn ? " Entfernt eine Dreierspalte." : ""}${facts?.closesRound ? " Löst den Rundenschluss aus." : ""}`;
  }
}
