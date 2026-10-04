import { BotConfig, Difficulty } from "../../protocol/gameProtocol";
import { RandomBot } from "./random";
import { RuleBot } from "./rules";
import { BotFactory, BotRegistration, BotStrategy } from "./types";

export * from "./types";
export { RandomBot } from "./random";
export { RuleBot } from "./rules";

const registry = new Map<string, Map<string, BotRegistration>>();
const difficulties: readonly Difficulty[] = ["easy", "medium", "hard"];
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

/** Register model/remote adapters independently of game rules and transport. */
export function registerBotStrategy(registration: BotRegistration): () => void;
export function registerBotStrategy(id: string, version: string, factory: BotFactory, name?: string): () => void;
export function registerBotStrategy(input: BotRegistration | string, version?: string, factory?: BotFactory, name?: string): () => void {
  const registration = typeof input === "string"
    ? { id: input, version: version!, factory: factory!, name: name ?? input }
    : { ...input };
  if (typeof registration.id !== "string" || typeof registration.version !== "string" ||
      !identifier.test(registration.id) || !identifier.test(registration.version) ||
      typeof registration.factory !== "function" || typeof registration.name !== "string" ||
      registration.name.trim().length === 0 || registration.name.length > 120) {
    throw new Error("Invalid bot strategy registration");
  }
  const versions = registry.get(registration.id) ?? new Map<string, BotRegistration>();
  if (versions.has(registration.version)) throw new Error("Bot strategy version already registered");
  versions.set(registration.version, Object.freeze(registration));
  registry.set(registration.id, versions);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    if (versions.get(registration.version) !== undefined) versions.delete(registration.version);
    if (versions.size === 0) registry.delete(registration.id);
  };
}

function resolveStrategy(id: string, version?: string): BotRegistration | undefined {
  const versions = registry.get(id);
  if (!versions) return undefined;
  if (version !== undefined) return versions.get(version);
  // The latest explicitly registered version is the default; existing matches pin it.
  return Array.from(versions.values())[versions.size - 1];
}

/** Reject unknown strategies/versions before a session accepts their configuration. */
export function validateBotConfig(value: unknown): BotConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(candidate, "strategyId") ||
      !Object.prototype.hasOwnProperty.call(candidate, "difficulty") ||
      Object.keys(candidate).some((key) => !["strategyId", "difficulty", "version"].includes(key)) ||
      typeof candidate.strategyId !== "string" || !identifier.test(candidate.strategyId) ||
      !difficulties.includes(candidate.difficulty as Difficulty) ||
      (candidate.version !== undefined && (typeof candidate.version !== "string" || !identifier.test(candidate.version)))) return null;
  const registration = resolveStrategy(candidate.strategyId, candidate.version as string | undefined);
  return registration ? { strategyId: registration.id, version: registration.version, difficulty: candidate.difficulty as Difficulty } : null;
}

export function createBot(config: BotConfig): BotStrategy {
  const validated = validateBotConfig(config);
  if (!validated) throw new Error("Invalid bot configuration");
  const registration = resolveStrategy(validated.strategyId, validated.version)!;
  const bot = registration.factory(Object.freeze({ ...validated }));
  if (!bot || bot.id !== registration.id || bot.version !== registration.version || typeof bot.decide !== "function") {
    throw new Error("Bot factory returned an incompatible strategy");
  }
  return bot;
}

export function strategyInfo(): Array<{ id: string; version: string; name: string }> {
  return Array.from(registry.values()).flatMap((versions) => Array.from(versions.values(), ({ id, version, name }) => ({ id, version, name })));
}

registerBotStrategy({ id: "rules", version: "1", name: "Regel-KI", factory: (config) => new RuleBot(config.difficulty) });
registerBotStrategy({ id: "random", version: "1", name: "Zufallsbot", factory: () => new RandomBot() });
