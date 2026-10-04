import { Object3D } from "three";
import { Card as WireCard, GameView, PlayerView } from "./gameProtocol";

// Render-only types extend the generated wire contract; no parallel game schema.
export type Player = PlayerView;
export type Game = GameView;
export type Card = WireCard | null;
export type Column = [Card, Card, Card];
export type Deck = Column[];
export type KnownCardsColumn = [boolean, boolean, boolean];
export type VisualColumn = [Object3D, Object3D, Object3D];
export type VisualDeck = VisualColumn[];
export type PlayerVisualDeck = { player: Player; visualDeck: VisualDeck };
export type CardStack = GameView["cardStack"];
