import { Card, CardStack, ConcealableCard } from "./card";

type Column = [Card, Card, Card];
type Deck = Column[];

export type ConcealableColumn = [
  ConcealableCard,
  ConcealableCard,
  ConcealableCard
];
type ConcealableDeck = ConcealableColumn[];

type ColumnIndex = number;

type ThreeOfAKind = {
  columnIndex: ColumnIndex;
  value: number;
};

type KnownCardsColumn = [boolean, boolean, boolean];

export type ObfuscatedPlayer = {
  id: number;
  socketId: string;
  name: string;
  deck: ConcealableDeck;
  knownCardPositions: KnownCardsColumn[];
  playersTurn: boolean;
  cardCache: Card | null;
  tookDispiledCard: boolean;
  roundPoints: number;
  totalPoints: number;
  closedRound: boolean;
};

export class Player {
  id: number;
  socketId: string;
  name: string;
  deck: Deck;
  knownCardPositions: KnownCardsColumn[];
  playersTurn: boolean;
  cardCache: Card | null; // this is where the card is temporarily stored when a player draws a card
  tookDispiledCard: boolean; // this is used to check if a player took a dispiled card in the current turn
  roundPoints: number;
  totalPoints: number;
  closedRound: boolean;
  place: number | null; // indicates the place the player got in the last round
  constructor(
    id: number,
    socketId: string,
    name: string,
    cardStack: CardStack
  ) {
    this.id = id;
    this.socketId = socketId;
    this.name = name;
    this.deck = this.generateDeck(cardStack);
    this.knownCardPositions = this.createUnknownCardPositions();
    this.playersTurn = true;
    this.cardCache = null;
    this.tookDispiledCard = false;
    this.roundPoints = 0;
    this.totalPoints = 0;
    this.closedRound = false;
    this.place = null;
  }

  generateDeck(cardStack: CardStack): Deck {
    const deck: Deck = [];
    for (let i = 0; i < 4; i++) {
      deck.push(cardStack.cards.splice(0, 3) as Column);
    }
    return deck;
  }

  createUnknownCardPositions(): KnownCardsColumn[] {
    const knownCardPositions: KnownCardsColumn[] = [];
    for (let i = 0; i < 4; i++) {
      knownCardPositions.push([false, false, false]);
    }
    return knownCardPositions;
  }

  hasInitialCardsRevealed(): boolean {
    const flattenedKnownCardPositions = this.knownCardPositions.flat();
    const revealedCards = flattenedKnownCardPositions.filter(
      (position) => position
    );
    if (revealedCards.length > 1) return true;
    else return false;
  }

  getRevealedCardCount(): number {
    return this.knownCardPositions.flat().filter((position) => position == true)
      .length;
  }

  getThreeOfAKinds(): ThreeOfAKind[] {
    const threeOfAKinds: ThreeOfAKind[] = [];
    this.deck.forEach((column, index) => {
      const firstCard = column[0];
      const columnIndex = index;

      const columnHasSameCards = column.every((card) => card === firstCard);
      const columnIsRevealed = this.knownCardPositions[columnIndex].every(
        (isCardRevealed) =>
          isCardRevealed === this.knownCardPositions[columnIndex][0]
      );

      if (columnHasSameCards && columnIsRevealed) {
        threeOfAKinds.push({
          columnIndex: columnIndex as ColumnIndex,
          value: firstCard,
        });
      }
    });
    return threeOfAKinds;
  }

  getRevealedCards(): Card[] {
    const revealedCards: Card[] = [];
    this.knownCardPositions.forEach((column, columnIndex) => {
      column.forEach((isCardRevealed, cardIndex) => {
        if (isCardRevealed)
          revealedCards.push(this.deck[columnIndex][cardIndex]);
      });
    });
    return revealedCards;
  }

  getRevealedCardsValueSum(): number {
    const revealedCards = this.getRevealedCards();
    let revealedCardsValueSum = 0;
    revealedCards.forEach((card) => (revealedCardsValueSum += card));
    return revealedCardsValueSum;
  }

  getHighestRevealedCardValue(): number {
    const revealedCards = this.getRevealedCards();
    const highestRevealedCardValue = Math.max(...revealedCards);
    return highestRevealedCardValue;
  }
}
