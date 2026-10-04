import { GameCore, CoreConfig } from "../core/GameCore";
import { EndReason, GameAction, GameEvent, PlaybackCommand, RULE_VERSION } from "../../protocol/gameProtocol";

export const RECORD_SCHEMA_VERSION = 1;
export const MAX_RECORD_ACTIONS = 100_000;
export const MAX_CONTROL_RECORDS = 100_000;

export type RecordedAction = {
  sequence: number;
  timestamp: string;
  playerId: string;
  action: GameAction;
  /** Revision, round and turn AFTER applying the accepted action. */
  revision: number;
  round: number;
  turn: number;
  decisionMs: number;
  explanation?: string;
  fallback: boolean;
  events: GameEvent[];
  fingerprint: string;
};
export type RecordedControl = { timestamp: string; afterAction: number; command: PlaybackCommand };
export type RecordedCompletion = {
  timestamp: string;
  endReason: EndReason;
  revision: number;
  round: number;
  turn: number;
  scores: { playerId: string; roundPoints: number; totalPoints: number; place: number | null }[];
  fingerprint: string;
};
export type MatchRecord = {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  ruleVersion: string;
  recordedAt: string;
  config: CoreConfig;
  initialFingerprint: string;
  actions: RecordedAction[];
  controls: RecordedControl[];
  completion: RecordedCompletion;
};
export type RecordActionInput = Omit<RecordedAction, "sequence" | "timestamp" | "fallback"> & { fallback?: boolean };

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** In-memory recording. Full seeds and hidden-card events are exportable only after the match ends. */
export class MatchRecorder {
  private readonly config: CoreConfig;
  private readonly recordedAt = new Date().toISOString();
  private readonly initialFingerprint: string;
  private readonly actions: RecordedAction[] = [];
  private readonly controls: RecordedControl[] = [];
  private completion: RecordedCompletion | null = null;
  private expired = false;
  readonly maxActions: number;

  constructor(config: CoreConfig, initialFingerprint?: string) {
    this.maxActions = config.maxActions ?? MAX_RECORD_ACTIONS;
    if (!Number.isSafeInteger(this.maxActions) || this.maxActions < 1 || this.maxActions > MAX_RECORD_ACTIONS) {
      throw new RangeError(`Recording action limit must be between 1 and ${MAX_RECORD_ACTIONS}`);
    }
    this.config = copy(config);
    this.initialFingerprint = initialFingerprint ?? new GameCore(this.config).fingerprint();
  }

  recordAction(input: RecordActionInput): void {
    if (this.completion) throw new Error("Cannot append actions to a completed recording");
    if (this.actions.length >= this.maxActions) throw new RangeError("Recording action limit reached; stop the match before recording another action");
    this.actions.push(copy({ ...input, sequence: this.actions.length + 1, timestamp: new Date().toISOString(), fallback: input.fallback ?? false }));
  }

  recordControl(command: PlaybackCommand): void {
    if (this.completion) throw new Error("Cannot append controls to a completed recording");
    if (this.controls.length >= MAX_CONTROL_RECORDS) throw new RangeError("Recording control limit reached");
    this.controls.push(copy({ timestamp: new Date().toISOString(), afterAction: this.actions.length, command }));
  }

  finish(core: GameCore): void {
    if (this.completion) return;
    const view = core.view();
    if (view.phase !== "game ended" || !view.endReason) throw new Error("Only completed matches can be exported");
    if (view.matchId !== this.config.matchId) throw new Error("Completion belongs to another match");
    this.completion = {
      timestamp: new Date().toISOString(),
      endReason: view.endReason,
      revision: view.revision,
      round: view.round,
      turn: view.turn,
      scores: view.players.map((player) => ({ playerId: player.id, roundPoints: player.roundPoints, totalPoints: player.totalPoints, place: player.place })),
      fingerprint: core.fingerprint(),
    };
  }

  get available(): boolean {
    return this.completion !== null && !this.expired;
  }

  /** Releases the large log after its retention period; completed gameplay remains in the core. */
  expire(): void {
    if (!this.completion) throw new Error("Cannot expire an active recording");
    this.expired = true;
    this.actions.length = 0;
    this.controls.length = 0;
  }

  export(): MatchRecord | null {
    if (!this.completion || this.expired) return null;
    return copy({ schemaVersion: RECORD_SCHEMA_VERSION, ruleVersion: RULE_VERSION, recordedAt: this.recordedAt,
      config: this.config, initialFingerprint: this.initialFingerprint, actions: this.actions, controls: this.controls, completion: this.completion });
  }
}
