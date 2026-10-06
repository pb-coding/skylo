import { DecisionDiagnostics } from "../../protocol/gameProtocol";

/** Bounded metadata only; provider response bodies and error messages are never diagnostics. */
export function validDecisionDiagnostics(value: unknown): value is DecisionDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const strings = ["strategyId", "strategyVersion", "promptVersion", "requestedModel", "model", "sdkVersion", "requestId", "selectedCandidate"];
  const fields = [...strings, "source", "failure", "responseMs", "inputTokens", "outputTokens", "contextHash", "confidence", "probabilities"];
  if (Object.keys(data).some(key => !fields.includes(key)) ||
      typeof data.strategyId !== "string" || typeof data.strategyVersion !== "string" ||
      !["strategy", "model", "automatic", "fallback"].includes(data.source as string)) return false;
  if (strings.some(key => data[key] !== undefined && (typeof data[key] !== "string" || (data[key] as string).length < 1 || (data[key] as string).length > 200))) return false;
  if (data.failure !== undefined && !["timeout", "aborted", "rate-limit", "authentication", "transport", "provider", "invalid-response", "illegal-action", "budget-exhausted", "circuit-open", "strategy-error"].includes(data.failure as string)) return false;
  if (data.contextHash !== undefined && (typeof data.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(data.contextHash))) return false;
  if (data.responseMs !== undefined && (typeof data.responseMs !== "number" || !Number.isFinite(data.responseMs) || data.responseMs < 0 || data.responseMs > 86_400_000)) return false;
  if (["inputTokens", "outputTokens"].some(key => data[key] !== undefined && (typeof data[key] !== "number" || !Number.isSafeInteger(data[key]) || (data[key] as number) < 0))) return false;
  const probability = (p: unknown) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;
  if (data.confidence !== undefined && !probability(data.confidence)) return false;
  if (data.probabilities !== undefined) {
    if (!data.probabilities || typeof data.probabilities !== "object" || Array.isArray(data.probabilities)) return false;
    const entries = Object.entries(data.probabilities);
    if (!entries.length || entries.length > 255 || entries.some(([key, p]) => !/^a\d{1,3}$/.test(key) || !probability(p)) ||
        Math.abs(entries.reduce((sum, [, p]) => sum + (p as number), 0) - 1) > 0.001) return false;
  }
  return true;
}
