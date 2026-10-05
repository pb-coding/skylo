import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { APIError, APITimeoutError, APIUserAbortError, choice, Fetch, JsonValue, TypeSafeClient, VERSION } from "@typesafe-ai/sdk";
import { DecisionDiagnostics, DecisionFailure } from "../../protocol/gameProtocol";
import { BotContext, BotDecisionError, assertRunning } from "./types";
import { JEV_INSTRUCTIONS, JEV_PROMPT_VERSION } from "./jevState";

export type JevSettings = {
  model: string; timeoutMs: number; maxRequests: number; maxRequestsPerMatch: number;
  concurrency: number; failureThreshold: number; cooldownMs: number;
};
export interface RequestLedger { readonly used: number; reserve(maximum: number): void }

/** Reserve before dispatch. Failed/aborted requests also consume one unit. */
export class MemoryRequestLedger implements RequestLedger {
  used = 0;
  reserve(maximum: number) {
    if (this.used >= maximum) throw new JevFailure("budget-exhausted");
    this.used++;
  }
}

/** A persistent, atomically updated counter; fail closed on corruption or concurrent writers. */
export class FileRequestLedger implements RequestLedger {
  constructor(private readonly filename: string) {}
  get used(): number {
    if (!existsSync(this.filename)) return 0;
    const value: unknown = JSON.parse(readFileSync(this.filename, "utf8"));
    if (!value || typeof value !== "object" || !Number.isSafeInteger((value as { requests: number }).requests) ||
        (value as { requests: number }).requests < 0) throw new Error("Invalid TypeSafe usage ledger");
    return (value as { requests: number }).requests;
  }
  reserve(maximum: number): void {
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
    const lock = `${this.filename}.lock`;
    // An abandoned lock blocks usage rather than silently resetting the budget.
    const handle = openSync(lock, "wx", 0o600);
    try {
      const used = this.used;
      if (used >= maximum) throw new JevFailure("budget-exhausted");
      writeFileSync(`${this.filename}.tmp`, JSON.stringify({ requests: used + 1 }), { mode: 0o600 });
      renameSync(`${this.filename}.tmp`, this.filename);
    } finally { closeSync(handle); unlinkSync(lock); }
  }
}

export class JevFailure extends BotDecisionError {}
type QueueItem = { start: () => void; signal: AbortSignal; abort: () => void };

/** One shared provider for all Jev instances. No automatic retries or SDK body logging. */
export class JevProvider {
  private readonly client: TypeSafeClient;
  private active = 0;
  private queue: QueueItem[] = [];
  private failures = 0;
  private openUntil = 0;
  constructor(readonly settings: Readonly<JevSettings>, private readonly ledger: RequestLedger,
    apiKey: string, fetch?: Fetch, private readonly now: () => number = () => performance.now()) {
    this.client = new TypeSafeClient({ apiKey, baseURL: "https://api.typesafe.ai", defaultModel: settings.model,
      retry: { maxRetries: 0 }, logLevel: "off", timeout: settings.timeoutMs, fetch });
  }
  availability(): { available: boolean; unavailableReason?: string } {
    try {
      if (this.ledger.used >= this.settings.maxRequests) return { available: false, unavailableReason: "TypeSafe-Anfragebudget ausgeschöpft" };
      return { available: true };
    } catch { return { available: false, unavailableReason: "TypeSafe-Anfragezähler nicht verfügbar" }; }
  }
  private async acquire(signal: AbortSignal): Promise<() => void> {
    assertRunning(signal);
    if (this.active >= this.settings.concurrency) {
      if (this.queue.length >= 32) throw new JevFailure("rate-limit");
      await new Promise<void>((resolve, reject) => {
        const item: QueueItem = { signal, start: resolve, abort: () => {
          this.queue = this.queue.filter(queued => queued !== item);
          reject(new JevFailure("aborted"));
        } };
        this.queue.push(item);
        signal.addEventListener("abort", item.abort, { once: true });
      });
    } else this.active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) { next.signal.removeEventListener("abort", next.abort); next.start(); }
      else this.active--;
    };
    if (signal.aborted) { release(); throw new JevFailure("aborted"); }
    return release;
  }

  async choose(state: { [key: string]: JsonValue }, criteria: Record<string, string>, contextHash: string,
    context: BotContext): Promise<{ choice: string; diagnostics: DecisionDiagnostics }> {
    const startedAt = this.now();
    const diagnostics: DecisionDiagnostics = { strategyId: "typesafe-jev-choice", strategyVersion: "1", source: "model",
      requestedModel: this.settings.model, sdkVersion: VERSION, promptVersion: JEV_PROMPT_VERSION, contextHash };
    let release: (() => void) | undefined;
    let dispatched = false;
    try {
      if (!context.remoteUsage) throw new JevFailure("strategy-error");
      release = await this.acquire(context.signal);
      if (this.openUntil > this.now()) throw new JevFailure("circuit-open");
      if (context.remoteUsage.requests >= this.settings.maxRequestsPerMatch) throw new JevFailure("budget-exhausted");
      const remainingMs = Math.min(this.settings.timeoutMs, context.budget.maxMs) - (this.now() - startedAt);
      if (remainingMs <= 0) throw new JevFailure("timeout");
      this.ledger.reserve(this.settings.maxRequests);
      context.remoteUsage.requests++;
      dispatched = true;
      const result = await this.client.systemOne({ model: this.settings.model, state,
        questions: { action: choice(JEV_INSTRUCTIONS, criteria) } }, { signal: context.signal, timeout: remainingMs }).withResponse();
      diagnostics.responseMs = Math.max(0, this.now() - startedAt);
      if (result.requestId) diagnostics.requestId = result.requestId.slice(0, 200);
      const answer = result.data?.answers?.action;
      const usage = result.data?.usage;
      if (!result.data || typeof result.data.model !== "string" || !result.data.model || result.data.model.length > 120 ||
          !usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 ||
          !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) throw new JevFailure("invalid-response");
      diagnostics.model = result.data.model;
      diagnostics.inputTokens = usage.input_tokens;
      diagnostics.outputTokens = usage.output_tokens;
      if (!answer || answer.type !== "choice" || !Object.prototype.hasOwnProperty.call(criteria, answer.choice) || !probability(answer.confidence) ||
          !answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities) ||
          Object.keys(answer.probabilities).length !== Object.keys(criteria).length ||
          Object.keys(criteria).some(id => !Object.prototype.hasOwnProperty.call(answer.probabilities, id) || !probability(answer.probabilities[id])) ||
          Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.001) throw new JevFailure("invalid-response");
      this.failures = 0;
      diagnostics.selectedCandidate = answer.choice;
      diagnostics.confidence = answer.confidence;
      diagnostics.probabilities = { ...answer.probabilities };
      return { choice: answer.choice, diagnostics };
    } catch (error) {
      const reason = failureReason(error, context.signal);
      diagnostics.responseMs ??= Math.max(0, this.now() - startedAt);
      diagnostics.source = "fallback";
      diagnostics.failure = reason;
      if (error instanceof APIError && error.requestId) diagnostics.requestId = error.requestId.slice(0, 200);
      if (dispatched && reason !== "aborted" && ++this.failures >= this.settings.failureThreshold) {
        this.openUntil = this.now() + this.settings.cooldownMs;
        this.failures = 0;
      }
      throw new JevFailure(reason, diagnostics);
    } finally { release?.(); }
  }
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function failureReason(error: unknown, signal: AbortSignal): DecisionFailure {
  if (error instanceof BotDecisionError) return error.reason;
  if (error instanceof APITimeoutError) return "timeout";
  if (signal.aborted && signal.reason instanceof BotDecisionError) return signal.reason.reason;
  if (error instanceof APIUserAbortError || signal.aborted) return "aborted";
  if (error instanceof APIError) {
    if (error.status === 429) return "rate-limit";
    if (error.status === 401 || error.status === 403) return "authentication";
    return "provider";
  }
  return "transport";
}
