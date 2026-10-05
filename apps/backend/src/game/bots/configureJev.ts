import { registerBotStrategy } from "./index";
import { JevBot } from "./jev";
import { FileRequestLedger, JevProvider, JevSettings } from "./jevProvider";

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid server setting: ${name}`);
  return value;
}
export function readJevSettings(env: NodeJS.ProcessEnv): JevSettings {
  const model = env.TYPESAFE_MODEL || "jev-1.13.0";
  if (!/^jev-[a-zA-Z0-9._-]{1,80}$/.test(model)) throw new Error("Invalid server setting: TYPESAFE_MODEL");
  return {
    model, timeoutMs: integer(env, "TYPESAFE_DECISION_TIMEOUT_MS", 15_000, 100, 60_000),
    maxRequests: integer(env, "TYPESAFE_MAX_REQUESTS", 0, 0, 1_000_000),
    maxRequestsPerMatch: integer(env, "TYPESAFE_MAX_REQUESTS_PER_MATCH", 10, 1, 100_000),
    concurrency: integer(env, "TYPESAFE_CONCURRENCY", 2, 1, 8),
    failureThreshold: integer(env, "TYPESAFE_FAILURE_THRESHOLD", 3, 1, 20),
    cooldownMs: integer(env, "TYPESAFE_COOLDOWN_MS", 60_000, 100, 600_000),
  };
}

/** Call only after dotenv has loaded; merely registering the bot never makes an API request. */
export function configureJev(env: NodeJS.ProcessEnv = process.env): () => void {
  const settings = readJevSettings(env);
  const key = env.TYPESAFE_API_KEY;
  const ledgerPath = env.TYPESAFE_USAGE_FILE;
  const provider = key?.trim() && settings.maxRequests > 0 && ledgerPath
    ? new JevProvider(settings, new FileRequestLedger(ledgerPath), key) : null;
  return registerBotStrategy({ id: "typesafe-jev-choice", version: "1", name: "Jev · TypeSafe",
    profiles: [{ id: "choice", name: "Jev Choice" }],
    availability: () => provider ? provider.availability() : { available: false,
      unavailableReason: "Jev ist derzeit nicht freigeschaltet" },
    factory: () => { if (!provider) throw new Error("Jev unavailable"); return new JevBot(provider); },
  });
}
