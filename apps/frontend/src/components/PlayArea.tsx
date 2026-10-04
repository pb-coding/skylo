import PlayerDecks from "./PlayerDecks";
import CardStackStaple from "./CardStackStaple";
import DiscardPile from "./DiscardPile";
import type { GameView } from "../types/gameProtocol";

export default function PlayArea({ gameData, focusPlayerId, focusedSlotId }: { gameData: GameView; focusPlayerId: string; focusedSlotId?: string | null }) {
  return <>
    <PlayerDecks gameData={gameData} focusPlayerId={focusPlayerId} focusedSlotId={focusedSlotId} />
    <CardStackStaple cardStackData={gameData.cardStack} />
    <DiscardPile discardPileData={gameData.discardPile} />
  </>;
}
