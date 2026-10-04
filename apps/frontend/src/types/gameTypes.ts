import { Object3D } from "three";

export type Player = {
  id: number;
  socketId: string;
  name: string;
  deck: Deck;
  knownCardPositions: KnownCardsColumn[];
  playersTurn: boolean;
  cardCache: Card | null;
  tookDispiledCard: boolean;
  roundPoints: number;
  totalPoints: number;
  closedRound: boolean;
  place: number;
};

export type PlayerVisualDeck = {
  player: Player;
  visualDeck: VisualDeck;
};

export type VisualColumn = [Object3D, Object3D, Object3D];

export type VisualDeck = VisualColumn[];

export type Column = [Card, Card, Card];
export type KnownCardsColumn = [boolean, boolean, boolean];

export type Deck = Column[];

export type Card =
  | -2
  | -1
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | null;

export type CardStack = {
  cards: Card[];
};

export type Game = {
  sessionId: string;
  playerCount: number;
  players: Player[];
  cardStack: CardStack;
  discardPile: Card[];
  phase: string;
};
