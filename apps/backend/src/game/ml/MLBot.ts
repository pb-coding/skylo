import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { BotContext, BotDecision, BotStrategy, assertRunning } from "../bots/types";
import { GameAction, PlayerObservation, RULE_VERSION } from "../../protocol/gameProtocol";
import { ACTION_COUNT, ENCODER_VERSION, OBSERVATION_SIZE, encodeObservation, actionIndex, PublicMemory } from "./observation";
import type { InferenceSession } from "onnxruntime-node";

type Manifest = { version: string; ruleVersion: string; encoderVersion: string; observationSize: number; actionCount: number; model: string; sha256: string };
const sessions = new Map<string, Promise<InferenceSession>>();

export function readModelManifest(path: string): Manifest & { modelPath: string } {
  const manifest = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as Manifest;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(manifest.version) || manifest.ruleVersion !== RULE_VERSION ||
      manifest.encoderVersion !== ENCODER_VERSION || manifest.observationSize !== OBSERVATION_SIZE || manifest.actionCount !== ACTION_COUNT ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("Incompatible ML manifest");
  const modelPath = resolve(dirname(path), manifest.model);
  if (createHash("sha256").update(readFileSync(modelPath)).digest("hex") !== manifest.sha256) throw new Error("ML model checksum mismatch");
  return { ...manifest, modelPath };
}

/** Standalone CPU policy: public features -> learned logits -> legal action. */
export class MLBot implements BotStrategy {
  readonly id = "ml";
  private memory = new PublicMemory();
  private disposed = false;
  constructor(readonly modelPath: string, readonly version = "1") {}
  async decide(observation: PlayerObservation, legal: readonly GameAction[], context: BotContext): Promise<BotDecision> {
    assertRunning(context.signal, this.disposed);
    if (!legal.length) throw new Error("No legal ML action");
    this.memory.observe(observation);
    if (legal.length === 1) return { action: legal[0] };
    const ort = await import("onnxruntime-node");
    let session = sessions.get(this.modelPath);
    if (!session) {
      session = ort.InferenceSession.create(this.modelPath, { executionProviders: ["cpu"], intraOpNumThreads: 1, interOpNumThreads: 1 });
      sessions.set(this.modelPath, session);
    }
    const encoded = encodeObservation(observation, legal, this.memory);
    const output = await (await session).run({ observation: new ort.Tensor("float32", Float32Array.from(encoded.observation), [1, OBSERVATION_SIZE]) });
    assertRunning(context.signal, this.disposed);
    const logits = output.logits?.data;
    if (!logits || logits.length !== ACTION_COUNT) throw new Error("Invalid ML output");
    let best = -Infinity, selected: GameAction | undefined;
    for (const action of legal) {
      const value = Number(logits[actionIndex(action)]);
      if (!Number.isFinite(value)) throw new Error("Nonfinite ML output");
      if (value > best || value === best && selected && actionIndex(action) < actionIndex(selected)) { best = value; selected = action; }
    }
    return { action: selected!, explanation: "Das lokal trainierte Modell wählt eine erlaubte Aktion anhand der sichtbaren Spielsituation.",
      diagnostics: { strategyId: this.id, strategyVersion: this.version, source: "model", model: this.version } };
  }
  dispose(): void { this.disposed = true; }
}
