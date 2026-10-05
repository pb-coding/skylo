import { createHash } from "node:crypto";
import { JsonValue } from "@typesafe-ai/sdk";
import { Card, GameAction, PlayerObservation, PlayerView, PublicRules, RULE_VERSION } from "../../protocol/gameProtocol";

export const JEV_PROMPT_VERSION = "skylo-choice-1";
export const JEV_INSTRUCTIONS = "Choose exactly one legal action from `candidates` that best advances the lowest final total score at the end of the match. Consider `rules`, `self`, `opponents`, `roundStatus`, and the public history. Treat hidden cards and future draws as unknown. Visible round points are partial sums, not estimates of hidden cards. Consider opponents' final turns and the penalty for closing without uniquely lowest round points. The candidate descriptions contain facts, not a ranking. Your probabilities compare actions, not winning chances.";
export type JevCandidate = { id: string; action: GameAction; description: string; consequences: { [key: string]: JsonValue } };

function deck(player: PlayerView): (Card | null)[][] {
  return player.deck.map((column, c) => column.map((card, r) => player.knownCardPositions[c]?.[r] ? card : null));
}
const hidden = (cards: (Card | null)[][]) => cards.flat().filter(card => card === null).length;
const sum = (cards: (Card | null)[][]) => cards.flat().reduce<number>((total, card) => total + (card ?? 0), 0);

/** Only observation-derived facts. Never simulate the hidden GameCore to describe a candidate. */
export function buildJevCandidates(observation: PlayerObservation, actions: readonly GameAction[]): JevCandidate[] {
  const own = observation.players.find(player => player.id === observation.ownPlayerId);
  if (!own || !actions.length || actions.length > 255) throw new Error("Invalid Jev candidates");
  const cards = deck(own);
  return actions.map((action, index) => {
    let description: string;
    let remainingHidden = hidden(cards);
    let visiblePointsAfter: number | null = sum(cards);
    let removedColumn: number | null = null;
    let finishesTurn = false;
    const consequences: { [key: string]: JsonValue } = {};
    switch (action.type) {
      case "draw":
        description = "Draw the unknown top card from the draw pile. Decide whether to place or discard after seeing it.";
        consequences.pickedUpCard = null;
        break;
      case "take-discard":
        description = `Take the visible discard ${observation.discardPile[observation.discardPile.length - 1]}. It must then be placed; it cannot be discarded directly.`;
        consequences.pickedUpCard = observation.discardPile[observation.discardPile.length - 1] ?? null;
        break;
      case "discard":
        description = `Discard the drawn ${own.cardCache}. ${remainingHidden ? "Then choose one hidden card to reveal in a separate decision." : "Finish the turn without revealing another card."}`;
        consequences.discardedCard = own.cardCache;
        finishesTurn = remainingHidden === 0;
        break;
      case "place": case "reveal": {
        const column = own.slotIds.findIndex(ids => ids.includes(action.slotId));
        const row = own.slotIds[column]?.indexOf(action.slotId);
        if (column < 0 || row === undefined || row < 0) throw new Error("Unknown Jev slot");
        const previous = cards[column][row];
        consequences.column = column + 1;
        consequences.row = row + 1;
        consequences.previousCard = previous;
        remainingHidden -= previous === null ? 1 : 0;
        if (action.type === "place") {
          if (own.cardCache === null) throw new Error("Missing picked-up card");
          const after = cards.map(column => [...column]);
          after[column][row] = own.cardCache;
          if (after[column].every(card => card !== null && card === after[column][0])) {
            removedColumn = column + 1;
            after.splice(column, 1);
          }
          visiblePointsAfter = sum(after);
          consequences.placedCard = own.cardCache;
          description = `Place ${own.cardCache} in column ${column + 1}, row ${row + 1}, replacing ${previous === null ? "an unknown card" : previous}.`;
        } else {
          visiblePointsAfter = null;
          description = `Reveal the unknown card in column ${column + 1}, row ${row + 1}. Its value and any resulting triple removal are unknown.`;
          consequences.possibleTripleValue = cards[column].filter(card => card !== null).length === 2 &&
            cards[column].filter(card => card !== null).every(card => card === cards[column].find(card => card !== null))
            ? cards[column].find(card => card !== null)! : null;
        }
        finishesTurn = observation.phase !== "reveal two cards";
        break;
      }
      case "next-round": description = "Start the next round with a new hidden deal."; break;
    }
    const closesRound = finishesTurn && remainingHidden === 0 && !observation.players.some(player => player.closedRound);
    if (removedColumn !== null) description += ` Removes the visible triple in column ${removedColumn}.`;
    if (closesRound) description += " Triggers round closing: each opponent gets one final turn; a failed close doubles only positive round points, including ties.";
    return { id: `a${index}`, action, description, consequences: {
      ...consequences, remainingHiddenCards: remainingHidden, visiblePointsAfter,
      exactOwnRoundPointsAfter: remainingHidden === 0 ? visiblePointsAfter : null,
      removedColumn, finishesTurn, closesRound,
    } };
  });
}

/** Whitelist fields, mask again, and replace player IDs/names with neutral seats. */
export function buildJevState(observation: PlayerObservation, rules: Readonly<PublicRules>, candidates: JevCandidate[], history: JsonValue[] = []): { [key: string]: JsonValue } {
  if (rules.ruleVersion !== RULE_VERSION || observation.ruleVersion !== RULE_VERSION) throw new Error("Unsupported Jev rules");
  const ownSeat = observation.players.findIndex(player => player.id === observation.ownPlayerId);
  const activeSeat = observation.players.findIndex(player => player.id === observation.activePlayerId);
  const closerSeat = observation.players.findIndex(player => player.closedRound);
  const playerState = (player: PlayerView, seat: number) => {
    const visible = deck(player);
    return { seat, columns: visible, visibleRoundPoints: sum(visible), hiddenCards: hidden(visible),
      totalPoints: player.totalPoints, pickedUpCard: player.cardCache, mustPlacePickedUpCard: player.tookDispiledCard, closedRound: player.closedRound };
  };
  const finalTurnsRemaining: number[] = [];
  if (closerSeat !== -1 && activeSeat !== -1) {
    for (let seat = activeSeat; seat !== closerSeat; seat = (seat + 1) % observation.players.length) finalTurnsRemaining.push(seat);
  }
  return {
    rules: {
      ...rules,
      goal: "Lowest total score wins. The match ends when any player's total reaches pointLimit, or a safety round/action limit is reached.",
      pack: { minusTwo: 5, zero: 15, eachOtherValueFromMinusOneToTwelve: 10 },
      setup: "Each player starts with four columns of three face-down cards. Reveal two cards. The highest visible sum starts; ties use highest card, then a random tie break.",
      turn: "Draw an unknown card or take the visible discard. A taken discard must be placed. A drawn card can be placed or discarded; after discarding reveal a hidden card if any remain. Placement makes the new card visible and puts the replaced card on the discard pile.",
      triples: "Three equal visible cards in a column are automatically removed, including zero and negative triples. Columns are checked again after revealing all cards at round end.",
      closing: "The first player with no hidden cards after a completed turn closes the round. Every other player takes one final turn. All remaining cards are then revealed and triples removed before scoring.",
      failedClose: "If the closing player is not the unique player with the lowest round points (a tie also fails), only their strictly positive round points are doubled. Zero and negative points are unchanged.",
      drawPile: "If empty, shuffle all discards except the visible top card into a new draw pile. Hidden card locations and future draws are unknown.",
    },
    phase: observation.phase, round: observation.round, turn: observation.turn,
    self: playerState(observation.players[ownSeat], ownSeat),
    opponents: observation.players.flatMap((player, seat) => seat === ownSeat ? [] : [playerState(player, seat)]),
    drawPileSize: observation.cardStack.cards.length, discardPile: [...observation.discardPile],
    roundStatus: { activeSeat: activeSeat === -1 ? null : activeSeat, closerSeat: closerSeat === -1 ? null : closerSeat, finalTurnsRemaining },
    publicHistory: history.slice(-32),
    candidates: candidates.map(({ id, description, consequences }) => ({ id, description, consequences })),
  };
}

export function jevContextHash(state: { [key: string]: JsonValue }, criteria: Record<string, string>): string {
  function canonical(value: JsonValue): JsonValue {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical({ promptVersion: JEV_PROMPT_VERSION, instructions: JEV_INSTRUCTIONS, state, criteria }))).digest("hex");
}
