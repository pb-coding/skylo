import { Card, Difficulty, GameAction, PlayerObservation, PlayerView } from "../../protocol/gameProtocol";
import { assertRunning, BotContext, BotDecision, BotStrategy, sample } from "./types";

type VisibleDeck = Array<Array<Card | null>>;
type Distribution = { mean: number; variance: number; cards: Array<{ value: Card; probability: number }> };
type Weights = { information: number; pairs: number; endRisk: number; noise: number };
const weights: Record<Difficulty, Weights> = {
  easy: { information: 0.15, pairs: 0, endRisk: 0, noise: 1.2 },
  medium: { information: 0.3, pairs: 0.55, endRisk: 0.75, noise: 0.15 },
  hard: { information: 0.4, pairs: 1, endRisk: 1, noise: 0 },
};

function visibleDeck(player: PlayerView): VisibleDeck {
  // Respect visibility even if a caller accidentally includes an unknown value.
  return player.deck.map((column, c) => column.map((card, r) => player.knownCardPositions[c]?.[r] ? card : null));
}

/** Public observations update a prior, without claiming to know hidden locations. */
function unknownDistribution(observation: PlayerObservation): Distribution {
  const counts = new Map<Card, number>();
  for (let value = -2; value <= 12; value++) counts.set(value as Card, value === -2 ? 5 : value === 0 ? 15 : 10);
  const remove = (value: Card | null) => {
    if (value !== null) counts.set(value, Math.max(0, (counts.get(value) ?? 0) - 1));
  };
  for (const card of observation.discardPile) remove(card);
  for (const player of observation.players) {
    for (const column of visibleDeck(player)) for (const card of column) remove(card);
    if (player.id === observation.ownPlayerId) remove(player.cardCache);
  }
  let count = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (count === 0) {
    // Defensive fallback for synthetic observations; real matches conserve 150 cards.
    for (let value = -2; value <= 12; value++) counts.set(value as Card, value === -2 ? 5 : value === 0 ? 15 : 10);
    count = 150;
  }
  const cards = Array.from(counts, ([value, amount]) => ({ value, probability: amount / count })).filter(({ probability }) => probability > 0);
  const mean = cards.reduce((sum, card) => sum + card.value * card.probability, 0);
  const variance = cards.reduce((sum, card) => sum + (card.value - mean) ** 2 * card.probability, 0);
  return { mean, variance, cards };
}

function expectedPoints(deck: VisibleDeck, mean: number): number {
  return deck.reduce((total, column) => total + column.reduce<number>((sum, card) => sum + (card ?? mean), 0), 0);
}

function hiddenCount(deck: VisibleDeck): number {
  return deck.reduce((sum, column) => sum + column.filter((card) => card === null).length, 0);
}

function locate(player: PlayerView, slotId: string): [number, number] | null {
  for (let column = 0; column < player.slotIds.length; column++) {
    const row = player.slotIds[column].indexOf(slotId);
    if (row !== -1) return [column, row];
  }
  return null;
}

function replace(deck: VisibleDeck, position: [number, number], card: Card): VisibleDeck {
  const result = deck.map((column) => [...column]);
  const [column, row] = position;
  result[column][row] = card;
  const current = result[column];
  if (current.every((value) => value !== null && value === current[0])) result.splice(column, 1);
  return result;
}

export class RuleBot implements BotStrategy {
  readonly id = "rules";
  readonly version = "1";
  private disposed = false;
  private readonly weights: Weights;
  private progress: { round: number; turn: number; quality: number; hidden: number; stagnant: number } | null = null;

  constructor(private readonly difficulty: Difficulty = "medium") {
    if (!weights[difficulty]) throw new Error("Invalid bot difficulty");
    this.weights = weights[difficulty];
  }

  async decide(observation: PlayerObservation, legalActions: readonly GameAction[], context: BotContext): Promise<BotDecision> {
    assertRunning(context.signal, this.disposed);
    if (legalActions.length === 0) throw new Error("No legal action available");
    const player = observation.players.find(({ id }) => id === observation.ownPlayerId);
    if (!player) throw new Error("Bot player is missing from observation");
    if (context.budget.maxMs <= 0 || context.budget.maxIterations <= 0) {
      return { action: legalActions[Math.floor(sample(context.random) * legalActions.length)], explanation: "Wählt innerhalb des Rechenbudgets eine erlaubte Aktion." };
    }
    const distribution = unknownDistribution(observation);
    const deck = visibleDeck(player);
    this.trackProgress(observation, deck);
    const started = Date.now();
    let best = -Infinity;
    const candidates: Array<{ action: GameAction; score: number }> = [];
    const limit = Math.max(1, Math.floor(context.budget.maxIterations));
    for (let index = 0; index < legalActions.length && index < limit; index++) {
      assertRunning(context.signal, this.disposed);
      if (index > 0 && Date.now() - started >= context.budget.maxMs) break;
      const action = legalActions[index];
      const score = this.score(action, observation, player, deck, distribution) + (sample(context.random) - 0.5) * this.weights.noise;
      if (score > best + 1e-8) { best = score; candidates.length = 0; }
      if (Math.abs(score - best) <= 1e-8) candidates.push({ action, score });
    }
    const selected = candidates[Math.floor(sample(context.random) * candidates.length)]?.action ?? legalActions[0];
    assertRunning(context.signal, this.disposed);
    return { action: selected, explanation: this.explanation(selected, observation, player, deck, distribution) };
  }

  dispose(): void { this.disposed = true; this.progress = null; }

  private trackProgress(observation: PlayerObservation, deck: VisibleDeck): void {
    if (observation.phase !== "pick up card") return;
    // A fixed public prior measures actual board progress, not other players' reveals.
    const quality = expectedPoints(deck, 760 / 150);
    const hidden = hiddenCount(deck);
    if (!this.progress || this.progress.round !== observation.round) {
      this.progress = { round: observation.round, turn: observation.turn, quality, hidden, stagnant: 0 };
    } else if (this.progress.turn !== observation.turn) {
      const improved = quality < this.progress.quality - 0.25 || hidden < this.progress.hidden;
      this.progress = { round: observation.round, turn: observation.turn,
        quality: Math.min(quality, this.progress.quality), hidden: Math.min(hidden, this.progress.hidden),
        stagnant: improved ? 0 : this.progress.stagnant + 1 };
    }
  }

  private informationReward(): number {
    // If low cards are locked on boards, caution must not cause an endless round.
    return this.weights.information + Math.max(0, (this.progress?.stagnant ?? 0) - 3) * 0.3;
  }

  private score(action: GameAction, observation: PlayerObservation, player: PlayerView, deck: VisibleDeck, distribution: Distribution): number {
    if (action.type === "next-round") return 0;
    if (action.type === "reveal") {
      const position = locate(player, action.slotId);
      if (!position) return -Infinity;
      if (observation.phase === "reveal two cards") {
        const known = deck[position[0]].filter((card) => card !== null).length;
        return this.difficulty === "easy" ? known * 0.05 : -known * 0.2;
      }
      return this.revealScore(position, observation, deck, distribution);
    }
    if (action.type === "place") {
      const position = locate(player, action.slotId);
      return position && player.cardCache !== null ? this.placementScore(position, player.cardCache, observation, deck, distribution) : -Infinity;
    }
    if (action.type === "discard") return this.bestReveal(observation, deck, distribution);
    if (action.type === "take-discard") {
      const top = observation.discardPile[observation.discardPile.length - 1];
      return top === undefined ? -Infinity : this.bestPlacement(top, observation, deck, distribution);
    }
    // A draw can be placed or discarded, whereas taking a discard commits to placement.
    const revealing = this.bestReveal(observation, deck, distribution);
    return distribution.cards.reduce((score, card) => score + card.probability * Math.max(
      this.bestPlacement(card.value, observation, deck, distribution), revealing,
    ), 0);
  }

  private bestPlacement(card: Card, observation: PlayerObservation, deck: VisibleDeck, distribution: Distribution): number {
    let best = -Infinity;
    for (let column = 0; column < deck.length; column++) for (let row = 0; row < deck[column].length; row++) {
      best = Math.max(best, this.placementScore([column, row], card, observation, deck, distribution));
    }
    return best;
  }

  private bestReveal(observation: PlayerObservation, deck: VisibleDeck, distribution: Distribution): number {
    let best = -Infinity;
    for (let column = 0; column < deck.length; column++) for (let row = 0; row < deck[column].length; row++) {
      if (deck[column][row] === null) best = Math.max(best, this.revealScore([column, row], observation, deck, distribution));
    }
    // Already revealed players may discard during their final turn without revealing.
    return best === -Infinity ? 0 : best;
  }

  private placementScore(position: [number, number], card: Card, observation: PlayerObservation, deck: VisibleDeck, distribution: Distribution): number {
    const after = replace(deck, position, card);
    return expectedPoints(deck, distribution.mean) - expectedPoints(after, distribution.mean) +
      this.weights.pairs * (this.pairPotential(after) - this.pairPotential(deck)) +
      (deck[position[0]][position[1]] === null ? this.informationReward() : 0) -
      this.closingPenalty(observation, after, distribution);
  }

  private revealScore(position: [number, number], observation: PlayerObservation, deck: VisibleDeck, distribution: Distribution): number {
    return this.informationReward() + distribution.cards.reduce((score, card) => {
      const after = replace(deck, position, card.value);
      return score + card.probability * (expectedPoints(deck, distribution.mean) - expectedPoints(after, distribution.mean) +
        this.weights.pairs * (this.pairPotential(after) - this.pairPotential(deck)) - this.closingPenalty(observation, after, distribution));
    }, 0);
  }

  /** Reward positive pairs only: removing three negative cards increases points. */
  private pairPotential(deck: VisibleDeck): number {
    return deck.reduce((sum, column) => {
      const values = column.filter((card): card is Card => card !== null);
      for (const value of new Set(values)) {
        if (value > 0 && values.filter((card) => card === value).length === 2) {
          return sum + value * (column.includes(null) ? 0.3 : 0.2);
        }
      }
      return sum;
    }, 0);
  }

  private closingPenalty(observation: PlayerObservation, deck: VisibleDeck, distribution: Distribution): number {
    if (this.weights.endRisk === 0 || hiddenCount(deck) > 0 || observation.players.some(({ closedRound }) => closedRound)) return 0;
    const points = expectedPoints(deck, distribution.mean);
    // Only positive points can be doubled by an unsuccessful round closer.
    if (points <= 0) return 0;
    let safelyLowest = 1;
    for (const opponent of observation.players) {
      if (opponent.id === observation.ownPlayerId) continue;
      const otherDeck = visibleDeck(opponent);
      const expected = expectedPoints(otherDeck, distribution.mean);
      const hidden = hiddenCount(otherDeck);
      // Opponents get a final turn. Hard anticipates a modest improvement as well.
      const finalTurnImprovement = this.difficulty === "hard" ? 2 : 0;
      const deviation = Math.sqrt(hidden * distribution.variance + finalTurnImprovement ** 2);
      const risk = deviation === 0 ? (expected <= points ? 1 : 0)
        : 1 / (1 + Math.exp((expected - finalTurnImprovement - points) / Math.max(1, deviation)));
      safelyLowest *= 1 - risk;
    }
    const patience = Math.max(0, 1 - (this.progress?.stagnant ?? 0) / 8);
    return (1 - safelyLowest) * points * this.weights.endRisk * patience;
  }

  private explanation(action: GameAction, observation: PlayerObservation, player: PlayerView, deck: VisibleDeck, distribution: Distribution): string {
    if (action.type === "next-round") return "Startet die nächste Runde.";
    if (action.type === "draw") return "Zieht eine unbekannte Karte und hält die Wahl zwischen Tauschen und Abwerfen offen.";
    if (action.type === "take-discard") return "Nimmt die Ablagekarte für einen günstigen Tausch oder eine Dreierspalte.";
    if (action.type === "discard") return "Wirft die gezogene Karte ab und deckt anschließend eine verdeckte Karte auf.";
    const position = locate(player, action.slotId);
    if (action.type === "reveal") {
      if (observation.phase === "reveal two cards") return "Deckt eine Startkarte auf, ohne ihren Wert zu kennen.";
      return "Deckt eine unbekannte Karte auf und berücksichtigt Spalten sowie das Rundenende.";
    }
    if (position && player.cardCache !== null) {
      const [column, row] = position;
      const before = deck[column][row];
      if (replace(deck, position, player.cardCache).length < deck.length) return "Vervollständigt eine Dreierspalte und berücksichtigt deren tatsächlichen Punktegewinn.";
      if (before !== null) return `Ersetzt die offene ${before} durch eine ${player.cardCache}.`;
      return `Ersetzt eine unbekannte Karte (erwartet etwa ${distribution.mean.toFixed(1)} Punkte) durch eine ${player.cardCache}.`;
    }
    return "Wählt eine erlaubte Aktion anhand der sichtbaren Spielsituation.";
  }
}
