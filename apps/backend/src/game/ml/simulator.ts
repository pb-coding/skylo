import { createInterface } from "node:readline";
import { once } from "node:events";
import { GameCore } from "../core/GameCore";
import { createRandom } from "../core/random";
import { RuleBot } from "../bots/rules";
import { RandomBot } from "../bots/random";
import { BotStrategy } from "../bots/types";
import { Difficulty, GameAction, PlayerObservation, RULE_VERSION } from "../../protocol/gameProtocol";
import { ACTION_COUNT, OBSERVATION_SIZE, ENCODER_VERSION, encodeObservation, decodeAction, actionIndex, PublicMemory, publicDistribution } from "./observation";
import { MLBot } from "./MLBot";

type TeacherWeights = Partial<Record<"pairs" | "information" | "endRisk", number>>;
type TeacherPatience = { closing: number; information: number };
type Options = { n: number; namespace: string; opponent?: string; teacher?: boolean; limitEpisodes?: number; roundReward?: number; snapshotModels?: string[]; potentialReward?: number; discount?: number; teacherWeights?: TeacherWeights; teacherPatience?: TeacherPatience; teacherScores?: boolean };
type Completion = { index: number; seed: string; seat: number; opponent: string; score: number; otherScore: number; win: boolean; draw: boolean; endReason: string | null; rounds: number; actions: number };
type Environment = { core: GameCore; seed: string; ownId: string; opponentId: string; seat: number; index: number; opponent: BotStrategy; opponentName: string; teacher: RuleBot; memory: PublicMemory; reward: number; done: boolean; inactive: boolean; label: number; teacherScores?: number[] };

export function trainingTeacher(parameters?: TeacherWeights, patience?: TeacherPatience): RuleBot {
  const teacher = new RuleBot("hard");
  if (parameters) {
    if (Object.entries(parameters).some(([key, value]) => !["pairs", "information", "endRisk"].includes(key) || !Number.isFinite(value)))
      throw new Error("Invalid training teacher parameters");
    // Isolated student's weights; the reference RuleBot's shared constants stay intact.
    Reflect.set(teacher, "weights", { ...Reflect.get(teacher, "weights"), ...parameters });
  }
  if (patience) {
    if (!Number.isFinite(patience.closing) || patience.closing <= 0 || !Number.isFinite(patience.information) || patience.information < 0)
      throw new Error("Invalid training teacher patience");
    const closingPenalty = Reflect.get(teacher, "closingPenalty");
    // Training-only instance overrides preserve the pinned opponent implementation.
    Reflect.set(teacher, "informationReward", () => Reflect.get(teacher, "weights").information +
      Math.max(0, (Reflect.get(teacher, "progress")?.stagnant ?? 0) - patience.information) * 0.3);
    Reflect.set(teacher, "closingPenalty", (...args: unknown[]) => {
      const progress = Reflect.get(teacher, "progress");
      try {
        if (progress) Reflect.set(teacher, "progress", { ...progress, stagnant: 0 });
        return closingPenalty.apply(teacher, args) * Math.max(0, 1 - (progress?.stagnant ?? 0) / patience.closing);
      } finally { Reflect.set(teacher, "progress", progress); }
    });
  }
  return teacher;
}

/** Training transport only: the encoder is the sole path from core to learner. */
export class SimulationBatch {
  private nextEpisode = 0;
  private environments: Environment[] = [];
  private completions: Completion[] = [];
  constructor(readonly options: Options) {
    if (!Number.isInteger(options.n) || options.n < 1 || options.n > 2048 || !options.namespace) throw new Error("Invalid simulation configuration");
  }
  async reset(): Promise<void> {
    this.environments = [];
    for (let i = 0; i < this.options.n; i++) this.environments.push(await this.newEnvironment());
  }
  private async newEnvironment(): Promise<Environment> {
    const index = this.nextEpisode++, seat = index % 2;
    const seed = `${this.options.namespace}:${Math.floor(index / 2)}`;
    const pool = this.options.snapshotModels ?? [];
    const league = this.options.opponent === "league";
    const snapshot = (this.options.opponent === "mixed" || league) && pool.length > 0 && Math.floor(index / 2) % (league ? 8 : 4) === (league ? 7 : 3)
      ? pool[Math.floor(index / 8) % pool.length] : null;
    const opponentName = snapshot ? `snapshot:${snapshot}` : league
      ? [...Array(12).fill("hard"), "medium", "easy", "random", "hard"][Math.floor(index / 2) % 16] : this.options.opponent === "mixed"
      ? ["hard", "hard", "hard", "medium", "easy", "random"][Math.floor(index / 2) % 6] : this.options.opponent ?? "hard";
    const opponent = snapshot ? new MLBot(snapshot) : opponentName === "random" ? new RandomBot() : new RuleBot(opponentName as Difficulty);
    const core = new GameCore({ matchId: `training-${index}`, sessionId: "offline", seed,
      players: [0, 1].map(i => ({ id: `p${i}`, name: `Seat ${i}`, kind: "bot" as const })),
      pointLimit: 100, maxRounds: 100, maxActions: 100_000 });
    const env: Environment = { core, seed, ownId: `p${seat}`, opponentId: `p${1 - seat}`, seat, index,
      opponent, opponentName, teacher: trainingTeacher(this.options.teacherWeights, this.options.teacherPatience), memory: new PublicMemory(), reward: 0, done: false,
      inactive: this.options.limitEpisodes !== undefined && index >= this.options.limitEpisodes, label: 3 };
    if (this.options.teacherScores) {
      env.teacherScores = Array(ACTION_COUNT).fill(-10000);
      const score = Reflect.get(env.teacher, "score");
      Reflect.set(env.teacher, "score", (action: GameAction, ...args: unknown[]) => {
        const value = score.call(env.teacher, action, ...args);
        env.teacherScores![actionIndex(action)] = value;
        return value;
      });
    }
    if (!env.inactive) await this.settle(env);
    return env;
  }
  private observation(env: Environment, playerId: string): PlayerObservation {
    return { ...env.core.view(), ownPlayerId: playerId, legalActions: env.core.legalActions(playerId) };
  }
  private context(env: Environment, playerId: string) {
    return { signal: new AbortController().signal,
      random: createRandom(`${env.seed}:bot:seat${playerId === "p0" ? 0 : 1}:${env.core.state.revision}`),
      budget: { maxMs: 1000, maxIterations: 1000 },
      publicRules: { ruleVersion: RULE_VERSION, pointLimit: 100, maxRounds: 100, maxActions: 100_000 } };
  }
  private potential(env: Environment): number {
    const observation = this.observation(env, env.ownId), mean = publicDistribution(observation).mean;
    const points = (id: string): number => {
      const player = observation.players.find(p => p.id === id)!;
      return player.totalPoints + player.deck.reduce((sum, column, c) => sum + column.reduce<number>((part, value, r) =>
        part + (player.knownCardPositions[c]?.[r] ? value! : mean), 0), 0);
    };
    return (points(env.opponentId) - points(env.ownId)) / 50;
  }
  private apply(env: Environment, playerId: string, action: GameAction): void {
    const result = env.core.apply(playerId, action);
    if (!result.accepted) throw new Error("Simulator attempted an illegal action");
    for (const event of result.events) if (event.type === "round-ended") {
      const scores = event.data!.scores as Record<string, number>;
      env.reward += (this.options.roundReward ?? 0.25) * (scores[env.opponentId] - scores[env.ownId]) / 50;
    }
  }
  private async settle(env: Environment): Promise<void> {
    while (env.core.state.phase !== "game ended") {
      if (env.core.state.phase === "new round") { this.apply(env, "p0", { type: "next-round" }); continue; }
      // Preserve the live runner's seat-order handling of initial reveals.
      const playerId = env.core.eligiblePlayerIds()[0];
      if (!playerId) throw new Error("No eligible player in live simulation");
      if (playerId === env.ownId) {
        if (this.options.teacher) {
          env.teacherScores?.fill(-10000);
          const observation = this.observation(env, playerId);
          env.label = actionIndex((await env.teacher.decide(observation, observation.legalActions, this.context(env, playerId))).action);
        }
        return;
      }
      const observation = this.observation(env, playerId);
      this.apply(env, playerId, (await env.opponent.decide(observation, observation.legalActions, this.context(env, playerId))).action);
    }
    const own = env.core.state.players.find(p => p.id === env.ownId)!;
    const other = env.core.state.players.find(p => p.id === env.opponentId)!;
    env.done = true;
    env.reward += env.core.state.endReason === "point-limit" ? Math.sign(other.totalPoints - own.totalPoints) : -1;
    this.completions.push({ index: env.index, seed: `${this.options.namespace}:${Math.floor(env.index / 2)}`, seat: env.seat,
      opponent: env.opponentName, score: own.totalPoints, otherScore: other.totalPoints, win: own.totalPoints < other.totalPoints,
      draw: own.totalPoints === other.totalPoints, endReason: env.core.state.endReason,
      rounds: env.core.state.round, actions: env.core.state.actionCount });
  }
  async step(actions: number[]): Promise<void> {
    if (actions.length !== this.environments.length) throw new Error("Simulation action batch length mismatch");
    for (let i = 0; i < this.environments.length; i++) {
      let env = this.environments[i];
      env.reward = 0; env.done = false;
      if (env.inactive) continue;
      const potentialBefore = this.options.potentialReward ? this.potential(env) : 0;
      const legal = env.core.legalActions(env.ownId);
      this.apply(env, env.ownId, decodeAction(actions[i], legal));
      await this.settle(env);
      // Gamma*Phi(next)-Phi(now), with terminal Phi=0, telescopes within a match.
      // Only fair public views enter Phi; it is never a deployed policy input.
      if (this.options.potentialReward) env.reward += this.options.potentialReward *
        ((env.done ? 0 : (this.options.discount ?? 0.997) * this.potential(env)) - potentialBefore);
      if (env.done) {
        const reward = env.reward;
        env.opponent.dispose?.(); env.teacher.dispose();
        env = await this.newEnvironment(); env.reward = reward; env.done = true;
        this.environments[i] = env;
      }
    }
  }
  setSnapshots(paths: string[]): void { this.options.snapshotModels = [...paths]; }
  async write(): Promise<void> {
    const width = OBSERVATION_SIZE + ACTION_COUNT + 3 + (this.options.teacherScores ? ACTION_COUNT : 0);
    const data = new Float32Array(width * this.environments.length);
    for (let i = 0; i < this.environments.length; i++) {
      const env = this.environments[i], offset = i * width;
      if (!env.inactive) {
        const observation = this.observation(env, env.ownId);
        const encoded = encodeObservation(observation, observation.legalActions, env.memory);
        data.set(encoded.observation, offset); data.set(encoded.mask, offset + OBSERVATION_SIZE);
      } else data[offset + OBSERVATION_SIZE + 3] = 1;
      data[offset + OBSERVATION_SIZE + ACTION_COUNT] = env.reward;
      data[offset + OBSERVATION_SIZE + ACTION_COUNT + 1] = Number(env.done);
      data[offset + OBSERVATION_SIZE + ACTION_COUNT + 2] = env.label;
      if (env.teacherScores) data.set(env.teacherScores, offset + OBSERVATION_SIZE + ACTION_COUNT + 3);
    }
    const header = { bytes: data.byteLength, n: this.environments.length, width, observationSize: OBSERVATION_SIZE,
      encoderVersion: ENCODER_VERSION, ruleVersion: RULE_VERSION, completions: this.completions.splice(0) };
    if (!process.stdout.write(JSON.stringify(header) + "\n")) await once(process.stdout, "drain");
    if (!process.stdout.write(Buffer.from(data.buffer))) await once(process.stdout, "drain");
  }
}

if (require.main === module) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  void (async () => {
    let batch: SimulationBatch | undefined;
    for await (const line of lines) {
      const request = JSON.parse(line);
      if (request.command === "close") break;
      if (request.command === "reset") { batch = new SimulationBatch(request.options); await batch.reset(); }
      else if (request.command === "step" && batch) await batch.step(request.actions);
      else if (request.command === "pool" && batch) batch.setSnapshots(request.paths);
      else throw new Error("Invalid simulator command");
      await batch.write();
    }
    lines.close();
    process.stdin.destroy();
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
