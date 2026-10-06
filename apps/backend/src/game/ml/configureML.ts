import { registerBotStrategy } from "../bots";
import { MLBot, readModelManifest } from "./MLBot";

/** An explicit local artifact enables the bot; no download or training happens here. */
export function configureML(env: NodeJS.ProcessEnv = process.env): () => void {
  if (!env.SKYLO_ML_MANIFEST) return () => undefined;
  const model = readModelManifest(env.SKYLO_ML_MANIFEST);
  return registerBotStrategy({ id: "ml", version: model.version, name: "Skylo · ML (2 Spieler)",
    supportedPlayerCounts: [2],
    profiles: [{ id: "trained", name: "Zweispieler-Modell" }],
    factory: () => new MLBot(model.modelPath, model.version) });
}
