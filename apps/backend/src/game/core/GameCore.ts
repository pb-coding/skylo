import { createHash } from "node:crypto";
import {
  Card, CoreView, EndReason, GameAction, GameEvent, GamePhase,
  PlayerSpec, PlayerView, PROTOCOL_VERSION, RULE_VERSION,
} from "../../protocol/gameProtocol";
import { SeededRandom, shuffle } from "./random";

export interface CoreConfig {
  matchId: string;
  sessionId: string;
  seed: string | number;
  players: PlayerSpec[];
  pointLimit?: number;
  maxRounds?: number;
  maxActions?: number;
}

export type CorePlayer = Omit<PlayerView, "deck"> & { deck: [Card, Card, Card][] };
export type CoreState = {
  matchId: string;
  sessionId: string;
  phase: GamePhase;
  revision: number;
  turn: number;
  round: number;
  players: CorePlayer[];
  activePlayerId: string | null;
  cardStack: { cards: Card[] };
  discardPile: Card[];
  endReason: EndReason | null;
  actionCount: number;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonical(object[key]);
      return result;
    }, {});
  }
  return value;
}

function limit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`Game limit must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function fullPack(): Card[] {
  const cards: Card[] = [];
  for (let value = -2; value <= 12; value++) {
    const count = value === -2 ? 5 : value === 0 ? 15 : 10;
    for (let index = 0; index < count; index++) cards.push(value as Card);
  }
  return cards;
}

/** Deterministic rules only. The runner owns sockets, decisions and timing. */
export class GameCore {
  state: CoreState;
  private config: Required<CoreConfig>;
  private shuffleRandom: SeededRandom;
  private starterRandom: SeededRandom;

  constructor(config: CoreConfig) {
    if (config.players.length < 2 || config.players.length > 8 ||
      new Set(config.players.map((player) => player.id)).size !== config.players.length ||
      config.players.some((player) => typeof player.id !== "string" || player.id.length === 0)) {
      throw new Error("A game requires 2–8 players with unique nonempty IDs");
    }
    if (typeof config.seed !== "string" && (typeof config.seed !== "number" || !Number.isFinite(config.seed))) {
      throw new Error("A game requires a string or finite numeric seed");
    }
    this.config = copy({
      ...config,
      pointLimit: limit(config.pointLimit, 100, 1_000_000),
      maxRounds: limit(config.maxRounds, 100, 10_000),
      maxActions: limit(config.maxActions, 100_000, 10_000_000),
    });
    this.shuffleRandom = new SeededRandom(`${config.seed}:cards`);
    this.starterRandom = new SeededRandom(`${config.seed}:starter`);
    this.state = {
      matchId: config.matchId, sessionId: config.sessionId,
      phase: "reveal two cards", revision: 0, turn: 0, round: 1,
      players: [], activePlayerId: null, cardStack: { cards: [] },
      discardPile: [], endReason: null, actionCount: 0,
    };
    this.initializeRound();
  }

  /** Skylo shows a picked-up card publicly; board backs and stack stay hidden. */
  view(): CoreView {
    return {
      protocolVersion: PROTOCOL_VERSION, ruleVersion: RULE_VERSION,
      matchId: this.state.matchId, sessionId: this.state.sessionId,
      revision: this.state.revision, turn: this.state.turn, round: this.state.round,
      phase: this.state.phase, playerCount: this.state.players.length,
      players: this.state.players.map((player) => ({
        ...copy(player),
        deck: player.deck.map((column, columnIndex) => column.map((card, row) =>
          player.knownCardPositions[columnIndex][row] ? card : null
        ) as [Card | null, Card | null, Card | null]),
      })),
      activePlayerId: this.state.activePlayerId,
      cardStack: { cards: this.state.cardStack.cards.map(() => null) },
      discardPile: [...this.state.discardPile], endReason: this.state.endReason,
    };
  }

  eligiblePlayerIds(): string[] {
    return this.state.players.filter((player) => this.legalActions(player.id).length > 0)
      .map((player) => player.id);
  }

  legalActions(playerId: string): GameAction[] {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player || this.state.phase === "game ended") return [];
    if (this.state.phase === "new round") return [{ type: "next-round" }];
    if (this.state.phase === "reveal two cards") {
      return this.revealedCount(player) < 2 ? this.slotActions(player, "reveal", true) : [];
    }
    if (this.state.activePlayerId !== player.id) return [];
    switch (this.state.phase) {
      case "pick up card": {
        const actions: GameAction[] = [];
        if (this.state.cardStack.cards.length > 0 || this.state.discardPile.length > 1) actions.push({ type: "draw" });
        if (this.state.discardPile.length > 0) actions.push({ type: "take-discard" });
        return actions;
      }
      case "place card": {
        if (player.cardCache === null) return [];
        const actions = this.slotActions(player, "place", false);
        // A fully revealed player can discard and finish, without another reveal.
        if (!player.tookDispiledCard) actions.push({ type: "discard" });
        return actions;
      }
      case "reveal card": return this.slotActions(player, "reveal", true);
      default: return [];
    }
  }

  apply(playerId: string, action: GameAction): { accepted: boolean; events: GameEvent[] } {
    if (!this.isLegal(playerId, action)) return { accepted: false, events: [] };
    const player = this.state.players.find((candidate) => candidate.id === playerId)!;
    const events: GameEvent[] = [{ type: "action", playerId, data: { action: copy(action) } }];
    switch (action.type) {
      case "next-round":
        this.state.round++;
        this.initializeRound();
        events.push({ type: "round-started", data: { round: this.state.round } });
        break;
      case "reveal": {
        const [column, row] = this.slotPosition(player, action.slotId)!;
        player.knownCardPositions[column][row] = true;
        events.push({ type: "card-revealed", playerId, data: { slotId: action.slotId, card: player.deck[column][row] } });
        this.removeTriples(player, events);
        if (this.state.phase === "reveal two cards") {
          this.updateRoundPoints();
          if (this.state.players.every((candidate) => this.revealedCount(candidate) >= 2)) this.selectStarter(events);
        } else this.finishTurn(player, events);
        break;
      }
      case "draw": {
        if (this.state.cardStack.cards.length === 0) {
          const top = this.state.discardPile.pop()!;
          this.state.cardStack.cards = this.state.discardPile;
          this.state.discardPile = [top];
          shuffle(this.state.cardStack.cards, this.shuffleRandom);
          events.push({ type: "stack-refilled" });
        }
        player.cardCache = this.state.cardStack.cards.pop()!;
        player.tookDispiledCard = false;
        this.state.phase = "place card";
        events.push({ type: "card-drawn", playerId, data: { card: player.cardCache } });
        break;
      }
      case "take-discard":
        player.cardCache = this.state.discardPile.pop()!;
        player.tookDispiledCard = true;
        this.state.phase = "place card";
        events.push({ type: "discard-taken", playerId, data: { card: player.cardCache } });
        break;
      case "discard":
        this.state.discardPile.push(player.cardCache!);
        events.push({ type: "card-discarded", playerId, data: { card: player.cardCache } });
        player.cardCache = null;
        player.tookDispiledCard = false;
        this.state.phase = "reveal card";
        if (this.slotActions(player, "reveal", true).length === 0) this.finishTurn(player, events);
        break;
      case "place": {
        const [column, row] = this.slotPosition(player, action.slotId)!;
        const replaced = player.deck[column][row];
        player.deck[column][row] = player.cardCache!;
        player.cardCache = null;
        player.tookDispiledCard = false;
        player.knownCardPositions[column][row] = true;
        this.state.discardPile.push(replaced);
        events.push({ type: "card-placed", playerId, data: { slotId: action.slotId, card: player.deck[column][row], replaced } });
        this.removeTriples(player, events);
        this.finishTurn(player, events);
        break;
      }
    }
    this.state.actionCount++;
    this.state.revision++;
    this.updateRoundPoints();
    if (this.state.actionCount >= this.config.maxActions && this.state.phase !== "game ended") {
      this.end("action-limit");
      events.push({ type: "game-ended", data: { reason: "action-limit" } });
    }
    return { accepted: true, events };
  }

  stop(reason: EndReason): void {
    if (this.state.phase === "game ended") return;
    this.end(reason);
    this.state.revision++;
  }

  clone(): GameCore {
    const cloned = Object.create(GameCore.prototype) as GameCore;
    cloned.config = copy(this.config);
    cloned.state = copy(this.state);
    cloned.shuffleRandom = this.shuffleRandom.clone();
    cloned.starterRandom = this.starterRandom.clone();
    return cloned;
  }

  fingerprint(): string {
    return createHash("sha256").update(JSON.stringify(canonical({
      config: this.config, state: this.state,
      shuffleRandom: this.shuffleRandom.snapshot(), starterRandom: this.starterRandom.snapshot(),
    }))).digest("hex");
  }

  private initializeRound(): void {
    const cards = fullPack();
    shuffle(cards, this.shuffleRandom);
    this.state.players = this.config.players.map((spec, seat) => {
      const previous = this.state.players.find((player) => player.id === spec.id);
      const deck: [Card, Card, Card][] = [];
      const slotIds: [string, string, string][] = [];
      for (let column = 0; column < 4; column++) {
        deck.push(cards.splice(0, 3) as [Card, Card, Card]);
        slotIds.push([0, 1, 2].map((row) => `r${this.state.round}:p${seat}:c${column}:r${row}`) as [string, string, string]);
      }
      return {
        ...copy(spec), deck, slotIds,
        knownCardPositions: deck.map(() => [false, false, false] as [boolean, boolean, boolean]),
        playersTurn: true, cardCache: null, tookDispiledCard: false,
        roundPoints: 0, totalPoints: previous?.totalPoints ?? 0,
        closedRound: false, place: null,
      };
    });
    this.state.discardPile = [cards.pop()!];
    this.state.cardStack = { cards };
    this.state.activePlayerId = null;
    this.state.phase = "reveal two cards";
  }

  private isLegal(playerId: string, action: unknown): action is GameAction {
    if (action === null || typeof action !== "object" || Array.isArray(action)) return false;
    const candidate = action as Record<string, unknown>;
    const type = candidate.type;
    const targeted = type === "reveal" || type === "place";
    const keys = Object.keys(candidate);
    if (keys.length !== (targeted ? 2 : 1) || !keys.includes("type") ||
      (targeted && (!keys.includes("slotId") || typeof candidate.slotId !== "string"))) return false;
    return this.legalActions(playerId).some((legal) => legal.type === type &&
      (!("slotId" in legal) || legal.slotId === candidate.slotId));
  }

  private slotPosition(player: CorePlayer, slotId: string): [number, number] | null {
    for (let column = 0; column < player.slotIds.length; column++) {
      const row = player.slotIds[column].indexOf(slotId);
      if (row >= 0) return [column, row];
    }
    return null;
  }

  private slotActions(player: CorePlayer, type: "reveal" | "place", hiddenOnly: boolean): GameAction[] {
    const actions: GameAction[] = [];
    player.slotIds.forEach((column, columnIndex) => column.forEach((slotId, row) => {
      if (!hiddenOnly || !player.knownCardPositions[columnIndex][row]) actions.push({ type, slotId });
    }));
    return actions;
  }

  private revealedCount(player: CorePlayer): number {
    return player.knownCardPositions.reduce((sum, column) => sum + column.filter(Boolean).length, 0);
  }

  private updateRoundPoints(): void {
    this.state.players.forEach((player) => {
      player.roundPoints = player.deck.reduce((sum, column, columnIndex) => sum + column.reduce<number>((subtotal, card, row) =>
        subtotal + (player.knownCardPositions[columnIndex][row] ? card : 0), 0), 0);
    });
  }

  private selectStarter(events: GameEvent[]): void {
    const sum = Math.max(...this.state.players.map((player) => player.roundPoints));
    let candidates = this.state.players.filter((player) => player.roundPoints === sum);
    const highest = (player: CorePlayer) => Math.max(...player.deck.flatMap((column, columnIndex) =>
      column.filter((_, row) => player.knownCardPositions[columnIndex][row])));
    const highCard = Math.max(...candidates.map(highest));
    candidates = candidates.filter((player) => highest(player) === highCard);
    const starter = candidates[Math.floor(this.starterRandom.next() * candidates.length)];
    this.setActivePlayer(starter.id);
    this.state.phase = "pick up card";
    this.state.turn++;
    events.push({ type: "turn-started", playerId: starter.id, data: { turn: this.state.turn } });
  }

  private setActivePlayer(playerId: string | null): void {
    this.state.activePlayerId = playerId;
    this.state.players.forEach((player) => { player.playersTurn = player.id === playerId; });
  }

  private removeTriples(player: CorePlayer, events: GameEvent[]): void {
    // Descending indices preserve remaining column identity and public pile order.
    for (let column = player.deck.length - 1; column >= 0; column--) {
      if (!player.knownCardPositions[column].every(Boolean) ||
        !player.deck[column].every((card) => card === player.deck[column][0])) continue;
      const cards = player.deck.splice(column, 1)[0];
      const slotIds = player.slotIds.splice(column, 1)[0];
      player.knownCardPositions.splice(column, 1);
      this.state.discardPile.push(...cards);
      events.push({ type: "column-removed", playerId: player.id, data: { slotIds, card: cards[0] } });
    }
  }

  private finishTurn(player: CorePlayer, events: GameEvent[]): void {
    let closer = this.state.players.find((candidate) => candidate.closedRound);
    if (!closer && player.knownCardPositions.every((column) => column.every(Boolean))) {
      player.closedRound = true;
      closer = player;
      events.push({ type: "round-closed", playerId: player.id });
    }
    const seat = this.state.players.indexOf(player);
    const next = this.state.players[(seat + 1) % this.state.players.length];
    this.state.turn++;
    if (closer?.id === next.id) {
      this.finishRound(events);
      return;
    }
    this.setActivePlayer(next.id);
    this.state.phase = "pick up card";
    events.push({ type: "turn-started", playerId: next.id, data: { turn: this.state.turn } });
  }

  private finishRound(events: GameEvent[]): void {
    for (const player of this.state.players) {
      player.knownCardPositions = player.deck.map(() => [true, true, true]);
      this.removeTriples(player, events);
    }
    this.updateRoundPoints();
    const lowest = Math.min(...this.state.players.map((player) => player.roundPoints));
    const lowestPlayers = this.state.players.filter((player) => player.roundPoints === lowest);
    const scores: Record<string, number> = {};
    for (const player of this.state.players) {
      const failedClose = player.closedRound && (lowestPlayers.length !== 1 || lowestPlayers[0] !== player);
      const points = failedClose && player.roundPoints > 0 ? player.roundPoints * 2 : player.roundPoints;
      player.totalPoints += points;
      scores[player.id] = points;
    }
    this.setActivePlayer(null);
    this.state.phase = "new round";
    events.push({ type: "round-ended", data: { round: this.state.round, scores } });
    if (this.state.players.some((player) => player.totalPoints >= this.config.pointLimit)) {
      this.end("point-limit");
    } else if (this.state.round >= this.config.maxRounds) this.end("round-limit");
    if (this.state.endReason) events.push({ type: "game-ended", data: { reason: this.state.endReason } });
  }

  private end(reason: EndReason): void {
    this.state.phase = "game ended";
    this.state.endReason = reason;
    this.setActivePlayer(null);
    this.state.players.forEach((player) => {
      player.place = 1 + this.state.players.filter((other) => other.totalPoints < player.totalPoints).length;
    });
  }
}
