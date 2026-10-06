import { Card, GameAction, GamePhase, PlayerObservation, PlayerView, RULE_VERSION } from "../../protocol/gameProtocol";

export const ENCODER_VERSION = "skylo-ml-observation-1";
export const ACTION_COUNT = 28;
export const GLOBAL_SIZE = 530;
export const CANDIDATE_SIZE = 32;
export const OBSERVATION_SIZE = GLOBAL_SIZE + ACTION_COUNT * CANDIDATE_SIZE;
const phases: GamePhase[] = ["reveal two cards", "pick up card", "place card", "reveal card", "new round", "game ended"];
const types = ["draw", "take-discard", "discard", "next-round", "reveal", "place"];
type Board = (Card | null)[][];

/** Remask even malformed callers; no private state, identity, seed or hash is encoded. */
function board(player: PlayerView): Board {
  return player.deck.map((column, c) => column.map((card, r) => player.knownCardPositions[c]?.[r] ? card : null));
}
function hidden(cards: Board): number { return cards.flat().filter(x => x === null).length; }
function expected(cards: Board, mean: number): number { return cards.flat().reduce<number>((s, x) => s + (x ?? mean), 0); }
function pairs(cards: Board): number {
  let result = 0;
  for (const column of cards) for (let value = 1; value <= 12; value++) {
    if (column.filter(x => x === value).length === 2) result += value;
  }
  return result;
}
function originalSlot(slotId: string): number {
  const match = /:c([0-3]):r([0-2])$/.exec(slotId);
  if (!match) throw new Error("Unsupported ML slot identity");
  return Number(match[1]) * 3 + Number(match[2]);
}
export function actionIndex(action: GameAction): number {
  if (action.type === "reveal") return 4 + originalSlot(action.slotId);
  if (action.type === "place") return 16 + originalSlot(action.slotId);
  return types.indexOf(action.type);
}
export function decodeAction(index: number, legal: readonly GameAction[]): GameAction {
  const action = legal.find(candidate => actionIndex(candidate) === index);
  if (!action) throw new Error(`Illegal ML action ${index}`);
  return action;
}

export class PublicMemory {
  private round = -1;
  private turn = -1;
  private quality = Infinity;
  private hidden = Infinity;
  stagnant = 0;
  observe(observation: PlayerObservation): void {
    if (observation.round !== this.round) {
      this.round = observation.round; this.turn = -1; this.quality = Infinity; this.hidden = Infinity; this.stagnant = 0;
    }
    if (observation.phase !== "pick up card" || observation.activePlayerId !== observation.ownPlayerId || observation.turn === this.turn) return;
    const own = observation.players.find(p => p.id === observation.ownPlayerId)!;
    const cards = board(own), quality = expected(cards, 760 / 150), count = hidden(cards);
    this.stagnant = quality < this.quality - 0.25 || count < this.hidden ? 0 : this.stagnant + 1;
    this.quality = Math.min(quality, this.quality); this.hidden = Math.min(count, this.hidden); this.turn = observation.turn;
  }
}

export function publicDistribution(observation: PlayerObservation): { counts: number[]; probabilities: number[]; mean: number; variance: number } {
  const counts: number[] = Array.from({ length: 15 }, (_, i) => i === 0 ? 5 : i === 2 ? 15 : 10);
  const remove = (card: Card | null) => { if (card !== null) counts[card + 2] = Math.max(0, counts[card + 2] - 1); };
  observation.discardPile.forEach(remove);
  for (const player of observation.players) {
    board(player).flat().forEach(remove);
    // Picked-up cards are public in this rule version, including the opponent's.
    remove(player.cardCache);
  }
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const probabilities = counts.map(n => n / total);
  const mean = probabilities.reduce((s, p, i) => s + p * (i - 2), 0);
  const variance = probabilities.reduce((s, p, i) => s + p * (i - 2 - mean) ** 2, 0);
  return { counts, probabilities, mean, variance };
}

function changed(cards: Board, column: number, row: number, value: Card): Board {
  const after = cards.map(c => [...c]); after[column][row] = value;
  if (after[column].every(x => x === value)) after.splice(column, 1);
  return after;
}

/** Numeric features of observable consequences; these do not choose or rank actions. */
export function encodeObservation(observation: PlayerObservation, legal: readonly GameAction[], memory = new PublicMemory()): { observation: number[]; mask: number[] } {
  if (observation.ruleVersion !== RULE_VERSION || observation.players.length !== 2) throw new Error("ML model requires the pinned two-player rules");
  memory.observe(observation);
  const own = observation.players.find(p => p.id === observation.ownPlayerId);
  if (!own) throw new Error("Missing ML player");
  const other = observation.players.find(p => p.id !== own.id)!;
  const players = [own, other], boards = players.map(board);
  const distribution = publicDistribution(observation), mean = distribution.mean;
  const global: number[] = [];
  for (let seat = 0; seat < 2; seat++) {
    const player = players[seat], slots = new Map<number, Card | null>();
    player.slotIds.forEach((column, c) => column.forEach((id, r) => slots.set(originalSlot(id), boards[seat][c][r])));
    for (let slot = 0; slot < 12; slot++) {
      const value = slots.get(slot), exists = slots.has(slot), known = exists && value !== null;
      global.push(known ? value! / 12 : 0, Number(known), Number(exists));
      for (let card = -2; card <= 12; card++) global.push(Number(known && value === card));
    }
  }
  for (let seat = 0; seat < 2; seat++) for (let original = 0; original < 4; original++) {
    const position = players[seat].slotIds.findIndex(ids => Math.floor(originalSlot(ids[0]) / 3) === original);
    const column = boards[seat][position];
    global.push(column ? 1 : 0, column ? column.filter(x => x === null).length / 3 : 0,
      column ? expected([column], mean) / 36 : 0, column ? pairs([column]) / 12 : 0,
      column ? Math.max(0, ...column.filter((x): x is Card => x !== null)) / 12 : 0,
      column ? Math.min(0, ...column.filter((x): x is Card => x !== null)) / 2 : 0);
  }
  for (let seat = 0; seat < 2; seat++) {
    const player = players[seat], cards = boards[seat];
    global.push(player.totalPoints / 100, expected(cards, 0) / 100, hidden(cards) / 12,
      Number(player.closedRound), (player.cardCache ?? 0) / 12, Number(player.cardCache !== null),
      Number(player.tookDispiledCard), Number(player.playersTurn), cards.length / 4, seat === 0 ? memory.stagnant / 10 : 0);
  }
  for (const phase of phases) global.push(Number(observation.phase === phase));
  const top = observation.discardPile[observation.discardPile.length - 1];
  global.push(observation.round / 100, observation.turn / 100, observation.cardStack.cards.length / 150,
    observation.discardPile.length / 150, (top ?? 0) / 12, Number(top !== undefined), mean / 12, Math.sqrt(distribution.variance) / 12,
    ...distribution.probabilities, (other.totalPoints - own.totalPoints) / 100);
  if (global.length !== GLOBAL_SIZE) throw new Error(`Global encoder length ${global.length}`);
  const candidates = Array.from({ length: ACTION_COUNT }, () => Array(CANDIDATE_SIZE).fill(0) as number[]);
  const mask = Array(ACTION_COUNT).fill(0) as number[];
  const cards = boards[0], before = expected(cards, mean), otherExpected = expected(boards[1], mean);
  for (const action of legal) {
    const index = actionIndex(action), f: number[] = types.map(type => Number(action.type === type));
    let column = -1, row = -1;
    if ("slotId" in action) {
      column = own.slotIds.findIndex(ids => ids.includes(action.slotId)); row = own.slotIds[column]?.indexOf(action.slotId) ?? -1;
      if (column < 0 || row < 0) throw new Error("Unmapped ML action");
    }
    const target = column >= 0 ? cards[column][row] : undefined;
    f.push((target ?? mean) / 12, Number(target === null), Number(target !== undefined),
      column >= 0 ? hidden([cards[column]]) / 3 : 0, column >= 0 ? pairs([cards[column]]) / 12 : 0,
      column >= 0 ? expected([cards[column]], mean) / 36 : 0);
    let afterPoints = before, afterHidden = hidden(cards), afterPairs = pairs(cards), removed = 0, closure = 0, variance = 0;
    const accumulate = (value: Card, probability: number) => {
      const after = changed(cards, column, row, value);
      afterPoints += probability * expected(after, mean); afterHidden += probability * hidden(after);
      afterPairs += probability * pairs(after); removed += probability * (cards.length - after.length);
      closure += probability * Number(hidden(after) === 0); variance += probability * (before - expected(after, mean)) ** 2;
    };
    if (column >= 0) {
      afterPoints = 0; afterHidden = 0; afterPairs = 0;
      if (action.type === "place") accumulate(own.cardCache!, 1);
      else for (let i = 0; i < 15; i++) if (distribution.probabilities[i]) accumulate((i - 2) as Card, distribution.probabilities[i]);
    }
    f.push((before - afterPoints) / 36, afterPoints / 100, afterHidden / 12, (afterPairs - pairs(cards)) / 24,
      removed, closure, Math.sqrt(variance) / 36, (otherExpected - afterPoints) / 100,
      hidden(boards[1]) / 12, Number(other.closedRound), Number(own.closedRound),
      (own.cardCache ?? 0) / 12, Number(own.tookDispiledCard), (top ?? 0) / 12,
      column >= 0 ? cards[column].filter(x => x === own.cardCache && x !== null).length / 3 : 0,
      column >= 0 ? cards[column].filter(x => x === top && x !== null).length / 3 : 0,
      memory.stagnant / 10, (other.totalPoints - own.totalPoints) / 100,
      observation.phase === "reveal two cards" && column >= 0 ? (3 - hidden([cards[column]])) / 3 : 0,
      mean / 12);
    if (f.length !== CANDIDATE_SIZE) throw new Error(`Candidate encoder length ${f.length}`);
    candidates[index] = f; mask[index] = 1;
  }
  return { observation: global.concat(...candidates), mask };
}
