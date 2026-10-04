import PlayerDecks from "./PlayerDecks";
import { Game } from "../types/gameTypes";
import { getGameActions } from "../scene/gameActions";
import CardStackStaple from "./CardStackStaple";
import DiscardPile from "./DiscardPile";
export default function PlayArea({ gameData, isConnected, focusedCard }: { gameData: Game; isConnected: boolean; focusedCard?: [number, number] | null }) {
  const actions = getGameActions(gameData, isConnected);
  return <>
    <PlayerDecks gameData={gameData} isConnected={isConnected} focusedCard={focusedCard} />
    <CardStackStaple cardStackData={gameData.cardStack} enabled={actions.canDraw} />
    <DiscardPile discardPileData={gameData.discardPile} enabled={actions.canDiscard} />
  </>;
}
