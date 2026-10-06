import { GameCore, CoreConfig } from "../core";
import { createRandom } from "../core/random";
import { BotDecision, BotDecisionError, BotStrategy, createBot, validateBotConfig } from "../bots";
import { validDecisionDiagnostics } from "../recording/decisionDiagnostics";
import { MatchRecorder } from "../recording/recorder";
import { ActionRequest, DecisionDiagnostics, DecisionSummary, EndReason, GameAction, GameEvent, GameView, ParticipantRole, PlaybackCommand, PlaybackState, PlayerObservation, ResponseCode, RULE_VERSION } from "../../protocol/gameProtocol";

export interface RunnerClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realClock: RunnerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
type Decision = BotDecision;
type Pending = {
  playerId: string;
  revision: number;
  startedAt: number;
  controller: AbortController;
  ready: Decision | null;
  decisionMs: number;
  fallback: boolean;
  cancel?: () => void;
};
export type RunnerOptions = {
  onUpdate?: (runner: GameRunner) => void;
  onEnd?: (runner: GameRunner) => void;
  clock?: RunnerClock;
  delayMs?: number;
  decisionTimeoutMs?: number;
  strategyFactory?: (config: NonNullable<CoreConfig["players"][number]["botConfig"]>) => BotStrategy;
};

/** Owns scheduling and strategy lifetimes; the rules remain in the synchronous core. */
export class GameRunner {
  readonly core: GameCore;
  readonly recorder: MatchRecorder;
  readonly sessionId: string;
  readonly matchId: string;
  private readonly clock: RunnerClock;
  private readonly bots = new Map<string, BotStrategy>();
  private readonly initialization = new Map<string, Promise<void>>();
  private readonly botEvents = new Map<string, GameEvent[]>();
  private readonly requests = new Map<string, string>();
  private readonly remoteUsage = { requests: 0 };
  private pending: Pending | null = null;
  private timer: unknown;
  private publicationTimer: unknown;
  private lastPublication = -Infinity;
  private started = false;
  private ended = false;
  private steppingTurn: { turn: number; round: number } | null = null;
  private roundWaitStartedAt: number | null = null;
  private lastDecision: DecisionSummary | null = null;
  private playback: PlaybackState;

  constructor(private readonly config: CoreConfig, private readonly options: RunnerOptions = {}) {
    this.config = JSON.parse(JSON.stringify(config)) as CoreConfig;
    for (const player of this.config.players) {
      if (player.kind !== "bot" || options.strategyFactory) continue;
      const validated = validateBotConfig(player.botConfig);
      if (!validated) throw new Error("Invalid bot configuration");
      player.botConfig = validated;
    }
    this.core = new GameCore(this.config);
    this.sessionId = this.config.sessionId;
    this.matchId = this.config.matchId;
    this.clock = options.clock ?? realClock;
    this.playback = { delayMs: options.delayMs ?? 1000, paused: false, stepping: null, thinking: false };
    this.recorder = new MatchRecorder(this.config, this.core.fingerprint());
    try {
      for (const player of this.config.players) {
        if (player.kind !== "bot") continue;
        const strategy = (options.strategyFactory ?? createBot)(player.botConfig!);
        this.bots.set(player.id, strategy);
        this.botEvents.set(player.id, []);
      }
    } catch (error) {
      this.disposeStrategies();
      throw error;
    }
  }

  get disposed() { return this.ended; }
  get phase() { return this.core.state.phase; }
  start() {
    if (this.started || this.ended) return;
    this.started = true;
    this.emit(true);
    this.advance();
  }

  private token(playerId: string) {
    return `${this.matchId}:${playerId}:${this.core.state.revision}`;
  }
  private observation(playerId: string): PlayerObservation {
    return { ...this.core.view(), ownPlayerId: playerId, legalActions: this.core.legalActions(playerId) };
  }
  view(playerId: string | null, role: ParticipantRole): GameView {
    const legalActions = playerId && role === "player" ? this.core.legalActions(playerId) : [];
    return {
      ...this.core.view(), ownPlayerId: playerId, role, legalActions,
      decisionId: playerId && legalActions.length ? this.token(playerId) : null,
      playback: { ...this.playback }, lastDecision: this.lastDecision ? { ...this.lastDecision } : null,
    };
  }

  submit(playerId: string, request: ActionRequest): ResponseCode {
    if (!request || request.matchId !== this.matchId || request.sessionId !== this.sessionId ||
        typeof request.requestId !== "string" || request.requestId.length < 1 || request.requestId.length > 80 ||
        typeof request.decisionId !== "string") return "error:invalid";
    if (!this.config.players.some(player => player.id === playerId && player.kind === "human")) return "error:membership";
    const key = `${playerId}:${request.requestId}`;
    const signature = JSON.stringify({ decisionId: request.decisionId, action: request.action });
    const previous = this.requests.get(key);
    if (previous !== undefined) return previous === signature ? "success" : "error:invalid";
    if (this.ended) return "error:finished";
    if (request.decisionId !== this.token(playerId)) return "error:stale";
    if (!this.accept(playerId, request.action, 0, undefined, false, true)) return "error:invalid";
    this.requests.set(key, signature);
    if (this.requests.size > 512) this.requests.delete(this.requests.keys().next().value!);
    this.advance();
    return "success";
  }

  control(command: PlaybackCommand): ResponseCode {
    if (this.ended) return "error:finished";
    if (!command || typeof command !== "object") return "error:invalid";
    const previousPlayback = { ...this.playback };
    const previousStep = this.steppingTurn;
    if (command.type === "delay") {
      if (!Number.isInteger(command.delayMs) || command.delayMs < 0 || command.delayMs > 5000) return "error:invalid";
      this.playback.delayMs = command.delayMs;
    } else if (command.type === "pause") {
      this.playback.paused = true;
      this.playback.stepping = null;
      this.steppingTurn = null;
    } else if (command.type === "resume") {
      this.playback.paused = false;
      this.playback.stepping = null;
      this.steppingTurn = null;
    } else if (command.type === "step-action" || command.type === "step-turn") {
      if (!this.playback.paused || this.playback.stepping) return "error:invalid";
      this.playback.stepping = command.type === "step-action" ? "action" : "turn";
      this.steppingTurn = { turn: this.core.state.turn, round: this.core.state.round };
    } else return "error:invalid";
    try {
      this.recorder.recordControl(command.type === "delay" ? { type: "delay", delayMs: command.delayMs } : { type: command.type });
    } catch {
      this.playback = previousPlayback;
      this.steppingTurn = previousStep;
      return "error:rate-limited";
    }
    this.clearTimer();
    this.emit(true);
    this.advance();
    return "success";
  }

  private clearTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private cancelPending() {
    this.clearTimer();
    const pending = this.pending;
    this.pending = null;
    pending?.controller.abort();
    pending?.cancel?.();
    this.playback.thinking = false;
    this.playback.thinkingPlayerId = null;
    this.playback.thinkingStrategyId = null;
  }
  private emit(force = false) {
    if (!force && this.clock.now() - this.lastPublication < 75 && this.playback.delayMs === 0 && !this.playback.paused) {
      if (this.publicationTimer === undefined) this.publicationTimer = this.clock.setTimeout(() => {
        this.publicationTimer = undefined;
        this.emit(true);
      }, 75);
      return;
    }
    if (this.publicationTimer !== undefined) this.clock.clearTimeout(this.publicationTimer);
    this.publicationTimer = undefined;
    this.lastPublication = this.clock.now();
    this.options.onUpdate?.(this);
  }

  private accept(playerId: string, action: GameAction, decisionMs: number, explanation?: string, fallback = false, force = false, diagnostics?: DecisionDiagnostics) {
    const result = this.core.apply(playerId, action);
    if (!result.accepted) return false;
    this.cancelPending();
    const view = this.core.view();
    this.recorder.recordAction({ playerId, action, revision: view.revision, round: view.round, turn: view.turn,
      decisionMs, explanation, fallback, diagnostics, events: result.events, fingerprint: this.core.fingerprint() });
    if (this.bots.has(playerId)) this.lastDecision = { playerId, explanation: explanation ?? "Erlaubte Aktion gewählt.", decisionMs, fallback, diagnostics };
    for (const queue of this.botEvents.values()) {
      for (const event of result.events) queue.push(publicEvent(event));
      if (queue.length > 1000) queue.splice(0, queue.length - 1000);
    }
    if (view.phase !== "new round") this.roundWaitStartedAt = null;
    if (this.playback.stepping === "action" || this.playback.stepping === "turn" && this.steppingTurn &&
      (view.turn !== this.steppingTurn.turn || view.round !== this.steppingTurn.round || view.phase === "new round" || view.phase === "game ended")) {
      this.playback.stepping = null;
      this.steppingTurn = null;
    }
    if (view.phase === "game ended") this.finish();
    else this.emit(force || view.phase === "new round");
    return true;
  }

  private advance() {
    if (!this.started || this.ended) return;
    if (this.pending && this.pending.revision !== this.core.state.revision) this.cancelPending();
    if (this.playback.paused && !this.playback.stepping) { this.clearTimer(); return; }
    if (this.core.state.phase === "new round") {
      if (this.config.players.some(player => player.kind === "human")) return;
      this.roundWaitStartedAt ??= this.clock.now();
      if (this.timer === undefined) this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        if (this.playback.paused && !this.playback.stepping || this.ended) return;
        this.accept(this.config.players[0].id, { type: "next-round" }, 0, "Nächste Runde", false);
        this.advance();
      }, this.playback.stepping ? 0 : Math.max(0, this.roundWaitStartedAt + this.playback.delayMs - this.clock.now()));
      return;
    }
    if (!this.pending) {
      const playerId = this.core.eligiblePlayerIds().find(id => this.bots.has(id));
      if (!playerId) return;
      const pending: Pending = { playerId, revision: this.core.state.revision, startedAt: this.clock.now(),
        controller: new AbortController(), ready: null, decisionMs: 0, fallback: false };
      this.pending = pending;
      this.playback.thinking = true;
      this.playback.thinkingPlayerId = playerId;
      this.playback.thinkingStrategyId = this.bots.get(playerId)!.id;
      this.emit();
      void this.decide(pending);
    } else if (this.pending.ready) this.schedule(this.pending);
  }

  private async decide(pending: Pending) {
    const strategy = this.bots.get(pending.playerId)!;
    const observation = deepFreeze(this.observation(pending.playerId));
    const legalActions = observation.legalActions;
    const seat = this.config.players.findIndex(player => player.id === pending.playerId);
    const context = { signal: pending.controller.signal, random: createRandom(`${this.config.seed}:bot:seat${seat}:${pending.revision}`),
      budget: { maxMs: this.options.decisionTimeoutMs ?? strategy.decisionTimeoutMs ?? 1000, maxIterations: 1000 },
      publicRules: Object.freeze({ ruleVersion: RULE_VERSION, pointLimit: this.config.pointLimit ?? 100,
        maxRounds: this.config.maxRounds ?? 100, maxActions: this.config.maxActions ?? 100_000 }),
      remoteUsage: this.remoteUsage };
    let deadline: unknown;
    try {
      pending.ready = await new Promise<Decision>((resolve, reject) => {
        pending.cancel = () => {
          if (deadline !== undefined) this.clock.clearTimeout(deadline);
          reject(new Error("Decision cancelled"));
        };
        deadline = this.clock.setTimeout(() => {
          const error = new BotDecisionError("timeout"); pending.controller.abort(error); reject(error);
        }, context.budget.maxMs);
        void Promise.resolve().then(async () => {
          let initialization = this.initialization.get(pending.playerId);
          if (!initialization) {
            initialization = Promise.resolve().then(() => strategy.onStart?.(observation)).then(() => undefined);
            this.initialization.set(pending.playerId, initialization);
          }
          await initialization;
          if (this.pending !== pending || pending.controller.signal.aborted) throw new Error("Decision cancelled");
          const events = this.botEvents.get(pending.playerId)!.splice(0);
          for (const event of events) {
            await strategy.onEvent?.(event, observation);
            if (this.pending !== pending || pending.controller.signal.aborted) throw new Error("Decision cancelled");
          }
          return strategy.decide(observation, legalActions, context);
        }).then(resolve, reject);
      });
      const legalAction = pending.ready && legalActions.find(action => sameAction(action, pending.ready!.action));
      if (!legalAction) throw new BotDecisionError("illegal-action");
      if (pending.ready!.diagnostics !== undefined && !validDecisionDiagnostics(pending.ready!.diagnostics)) throw new BotDecisionError("invalid-response");
      const diagnostics = pending.ready!.diagnostics ? JSON.parse(JSON.stringify(pending.ready!.diagnostics)) as DecisionDiagnostics
        : { strategyId: strategy.id, strategyVersion: strategy.version, source: "strategy" as const };
      pending.ready = { action: legalAction, explanation: typeof pending.ready!.explanation === "string" ? pending.ready!.explanation.slice(0, 500) : undefined, diagnostics };
    } catch (error) {
      if (this.pending !== pending || this.ended) return;
      pending.fallback = true;
      const diagnostics: DecisionDiagnostics = error instanceof BotDecisionError && error.diagnostics && validDecisionDiagnostics(error.diagnostics)
        ? error.diagnostics : { ...(strategy.decisionMetadata ?? {}), strategyId: strategy.id, strategyVersion: strategy.version,
          source: "fallback", failure: error instanceof BotDecisionError ? error.reason : "strategy-error" };
      const fallback = createBot({ strategyId: "rules", difficulty: "medium" });
      try {
        pending.ready = await fallback.decide(observation, legalActions, { ...context, signal: new AbortController().signal });
        pending.ready.explanation = `Ersatzentscheidung (${failureLabel(diagnostics.failure)}): ${pending.ready.explanation ?? "Regel-KI"}`;
      } catch { pending.ready = { action: legalActions[0], explanation: "Erlaubte Ersatzaktion" }; }
      finally { void Promise.resolve(fallback.dispose?.()).catch(() => undefined); }
      pending.ready!.diagnostics = diagnostics;
    } finally {
      if (deadline !== undefined) this.clock.clearTimeout(deadline);
      pending.cancel = undefined;
    }
    if (this.pending !== pending || this.ended) return;
    pending.decisionMs = Math.max(0, this.clock.now() - pending.startedAt);
    this.playback.thinking = false;
    this.emit();
    this.schedule(pending);
  }

  private schedule(pending: Pending) {
    this.clearTimer();
    if (this.playback.paused && !this.playback.stepping || !pending.ready) return;
    const remaining = this.playback.stepping ? 0 : Math.max(0, pending.startedAt + this.playback.delayMs - this.clock.now());
    // Even maximum speed yields to the event loop between every action.
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      if (this.pending !== pending || pending.revision !== this.core.state.revision || this.ended || this.playback.paused && !this.playback.stepping) return;
      const accepted = this.accept(pending.playerId, pending.ready!.action, pending.decisionMs, pending.ready!.explanation, pending.fallback, false, pending.ready!.diagnostics);
      if (!accepted) this.stop("aborted");
      else this.advance();
    }, remaining);
  }

  stop(reason: EndReason = "aborted") {
    if (this.ended) return;
    this.core.stop(reason);
    this.finish();
  }
  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.cancelPending();
    this.recorder.finish(this.core);
    this.disposeStrategies();
    this.botEvents.clear();
    this.emit(true);
    this.options.onEnd?.(this);
  }
  exportRecord() { return this.recorder.export(); }
  get hasExport() { return this.recorder.available; }
  expireRecord() { if (this.ended) this.recorder.expire(); }
  private disposeStrategies() {
    for (const strategy of this.bots.values()) {
      try { void Promise.resolve(strategy.dispose?.()).catch(() => undefined); } catch { /* cleanup is best effort */ }
    }
  }
}

function sameAction(left: GameAction, right: GameAction) {
  if (!right || typeof right !== "object" || left.type !== right.type) return false;
  return "slotId" in left ? "slotId" in right && left.slotId === right.slotId : !("slotId" in right);
}
function failureLabel(failure: DecisionDiagnostics["failure"]): string {
  switch (failure) {
    case "timeout": return "Antwortzeit überschritten";
    case "budget-exhausted": return "Anfragebudget ausgeschöpft";
    case "rate-limit": return "Anfragelimit des Anbieters";
    case "authentication": return "Zugang nicht verfügbar";
    case "circuit-open": return "Anbieter vorübergehend pausiert";
    case "invalid-response": case "illegal-action": return "Ungültige Antwort";
    default: return "Entscheidung nicht verfügbar";
  }
}
const publicEventTypes = new Set(["action", "round-started", "card-revealed", "stack-refilled", "card-drawn", "discard-taken", "card-discarded", "card-placed", "column-removed", "round-closed", "turn-started", "round-ended", "game-ended"]);
function publicEvent(event: GameEvent): GameEvent {
  return publicEventTypes.has(event.type) ? JSON.parse(JSON.stringify(event)) as GameEvent : { type: event.type, playerId: event.playerId };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
