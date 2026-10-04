import PlayerDecks from "./PlayerDecks";
import CardStackStaple from "./CardStackStaple";
import DiscardPile from "./DiscardPile";
import type { GameView } from "../types/gameProtocol";

export default function PlayArea({ gameData, focusPlayerId }: { gameData: GameView; focusPlayerId: string }) {
  return <>
    <PlayerDecks gameData={gameData} focusPlayerId={focusPlayerId} />
    <CardStackStaple cardStackData={gameData.cardStack} />
    <DiscardPile discardPileData={gameData.discardPile} />
  </>;
}
