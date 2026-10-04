import { FC } from "react";

import PlayerDecks from "./PlayerDecks";
import { Game } from "../types/gameTypes";
import CardStackStaple from "./CardStackStaple";
import DiscardPile from "./DiscardPile";

type PlayAreaProps = {
  gameData: Game | null;
};

const PlayArea: FC<PlayAreaProps> = ({ gameData }) => {
  if (!gameData) return null;

  return (
    <>
      <PlayerDecks playersData={gameData.players} />
      <CardStackStaple cardStackData={gameData.cardStack} />
      <DiscardPile discardPileData={gameData.discardPile} />
    </>
  );
};

export default PlayArea;
