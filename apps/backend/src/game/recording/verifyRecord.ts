import { GameCore } from "../core/GameCore";
import { EndReason, RULE_VERSION } from "../../protocol/gameProtocol";
import { MatchRecord, MAX_CONTROL_RECORDS, MAX_RECORD_ACTIONS, RECORD_SCHEMA_VERSION } from "./MatchRecorder";
import { validDecisionDiagnostics } from "./decisionDiagnostics";

export type VerificationResult = { valid: boolean; error?: string; actions: number };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, maximum = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
const endReasons: EndReason[] = ["point-limit", "round-limit", "action-limit", "aborted"];

function action(value: unknown): boolean {
  if (!object(value)) return false;
  switch (value.type) {
    case "reveal": case "place": return string(value.slotId);
    case "draw": case "take-discard": case "discard": case "next-round": return true;
    default: return false;
  }
}

function control(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.type === "delay") return integer(value.delayMs, 0, 60_000);
  return ["pause", "resume", "step-action", "step-turn"].includes(value.type as string);
}

/** Bound nested event data too; malformed logs must not create unbounded replay work. */
function jsonValue(value: unknown, budget: { remaining: number }, depth = 0): boolean {
  if (--budget.remaining < 0 || depth > 10) return false;
  if (value === null || typeof value === "boolean" || finite(value)) return true;
  if (typeof value === "string") return value.length <= 8_192;
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => jsonValue(item, budget, depth + 1));
  if (!object(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= 256 && keys.every((key) => key.length <= 256 && jsonValue(value[key], budget, depth + 1));
}

function event(value: unknown): boolean {
  return object(value) && string(value.type) && (value.playerId === undefined || string(value.playerId)) &&
    (value.data === undefined || (object(value.data) && jsonValue(value.data, { remaining: 4_096 })));
}

function configuration(value: unknown): boolean {
  if (!object(value) || !string(value.matchId) || !string(value.sessionId) ||
    !(typeof value.seed === "string" ? value.seed.length <= 4_096 : finite(value.seed)) ||
    !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 8) return false;
  const ids = new Set<string>();
  for (const player of value.players) {
    if (!object(player) || !string(player.id) || !string(player.name, 128) ||
      !["human", "bot"].includes(player.kind as string) || ids.has(player.id)) return false;
    ids.add(player.id);
    if (player.kind === "bot") {
      if (!object(player.botConfig) || !string(player.botConfig.strategyId) ||
        !(typeof player.botConfig.profile === "string" && string(player.botConfig.profile, 80) && player.botConfig.difficulty === undefined ||
          player.botConfig.profile === undefined && ["easy", "medium", "hard"].includes(player.botConfig.difficulty as string)) ||
        (player.botConfig.version !== undefined && !string(player.botConfig.version))) return false;
    }
  }
  return (value.pointLimit === undefined || integer(value.pointLimit, 1, 1_000_000)) &&
    (value.maxRounds === undefined || integer(value.maxRounds, 1, 10_000)) &&
    (value.maxActions === undefined || integer(value.maxActions, 1, MAX_RECORD_ACTIONS));
}

function recordShape(value: unknown): value is MatchRecord {
  if (!object(value) || ![1, RECORD_SCHEMA_VERSION].includes(value.schemaVersion as number) || value.ruleVersion !== RULE_VERSION ||
    !timestamp(value.recordedAt) || !configuration(value.config) || !fingerprint(value.initialFingerprint) ||
    !Array.isArray(value.actions) || value.actions.length > MAX_RECORD_ACTIONS ||
    !Array.isArray(value.controls) || value.controls.length > MAX_CONTROL_RECORDS || !object(value.completion)) return false;
  const configuredLimit = (value.config as { maxActions?: number }).maxActions ?? MAX_RECORD_ACTIONS;
  if (value.actions.length > configuredLimit) return false;
  for (let index = 0; index < value.actions.length; index++) {
    const entry = value.actions[index];
    if (!object(entry) || entry.sequence !== index + 1 || !timestamp(entry.timestamp) || !string(entry.playerId) || !action(entry.action) ||
      !integer(entry.revision, 1) || !integer(entry.round, 1, 10_000) || !integer(entry.turn) ||
      !finite(entry.decisionMs) || entry.decisionMs < 0 || entry.decisionMs > 86_400_000 || typeof entry.fallback !== "boolean" ||
      (entry.explanation !== undefined && (typeof entry.explanation !== "string" || entry.explanation.length > 8_192)) ||
      (entry.diagnostics !== undefined && (!validDecisionDiagnostics(entry.diagnostics) ||
        entry.fallback !== (entry.diagnostics.source === "fallback"))) ||
      !Array.isArray(entry.events) || entry.events.length > 256 || !entry.events.every(event) || !fingerprint(entry.fingerprint)) return false;
  }
  for (const entry of value.controls) {
    if (!object(entry) || !timestamp(entry.timestamp) || !integer(entry.afterAction, 0, value.actions.length) || !control(entry.command)) return false;
  }
  const completion = value.completion;
  if (!timestamp(completion.timestamp) || !endReasons.includes(completion.endReason as EndReason) ||
    !integer(completion.revision) || !integer(completion.round, 1, 10_000) || !integer(completion.turn) || !fingerprint(completion.fingerprint) ||
    !Array.isArray(completion.scores) || completion.scores.length !== (value.config as { players: unknown[] }).players.length) return false;
  return completion.scores.every((score) => object(score) && string(score.playerId) && integer(score.roundPoints, -1_000_000, 1_000_000) &&
    integer(score.totalPoints, -1_000_000_000, 1_000_000_000) && (score.place === null || integer(score.place, 1, 8)));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Replays accepted actions, never re-runs a bot or depends on its current implementation. */
export function verifyRecord(value: unknown): VerificationResult {
  let actions = 0;
  try {
    if (!object(value)) return { valid: false, error: "Recording must be a JSON object", actions };
    if (![1, RECORD_SCHEMA_VERSION].includes(value.schemaVersion as number)) return { valid: false, error: "Unsupported recording schema version", actions };
    if (value.ruleVersion !== RULE_VERSION) return { valid: false, error: "Unsupported game rule version", actions };
    if (!recordShape(value)) return { valid: false, error: "Malformed or oversized recording", actions };
    const core = new GameCore(value.config);
    if (core.fingerprint() !== value.initialFingerprint) return { valid: false, error: "Initial state fingerprint mismatch", actions };
    for (const entry of value.actions) {
      const result = core.apply(entry.playerId, entry.action);
      if (!result.accepted) return { valid: false, error: `Action ${entry.sequence} is illegal`, actions };
      actions++;
      const view = core.view();
      if (view.revision !== entry.revision || view.round !== entry.round || view.turn !== entry.turn) {
        return { valid: false, error: `Action ${entry.sequence} state counters mismatch`, actions };
      }
      if (core.fingerprint() !== entry.fingerprint) return { valid: false, error: `Action ${entry.sequence} state fingerprint mismatch`, actions };
      if (stable(result.events) !== stable(entry.events)) return { valid: false, error: `Action ${entry.sequence} events mismatch`, actions };
    }
    if (core.view().phase !== "game ended") {
      if (!["aborted", "action-limit"].includes(value.completion.endReason)) {
        return { valid: false, error: "Recording stops before the declared natural game ending", actions };
      }
      // Action-limit normally ends in apply(). Permit an explicit runner stop at its bounded recording limit only.
      if (value.completion.endReason === "action-limit" && actions !== (value.config.maxActions ?? MAX_RECORD_ACTIONS)) {
        return { valid: false, error: "Recording declares an action limit that was not reached", actions };
      }
      core.stop(value.completion.endReason);
    }
    const view = core.view();
    if (view.endReason !== value.completion.endReason || view.revision !== value.completion.revision ||
      view.round !== value.completion.round || view.turn !== value.completion.turn || core.fingerprint() !== value.completion.fingerprint) {
      return { valid: false, error: "Final state mismatch", actions };
    }
    const scores = view.players.map((player) => ({ playerId: player.id, roundPoints: player.roundPoints, totalPoints: player.totalPoints, place: player.place }));
    if (stable(scores) !== stable(value.completion.scores)) return { valid: false, error: "Final scores mismatch", actions };
    return { valid: true, actions };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Recording validation failed", actions };
  }
}
