import { FC, useState, useEffect } from "react";
import { socket } from "../socket";
import { Vector3 } from "three";

import { createPlayerCards as createPlayerDeck } from "../objects/cards";
import PlayerCard from "./PlayerCard";
import { PlayerVisualDeck, Player } from "../types/gameTypes";
import CardCache from "./CardCache";

type PlayerDecksProps = {
  playersData: Player[];
};

const PlayerDecks: FC<PlayerDecksProps> = ({ playersData }) => {
  const [visualPlayerDecks, setVisualPlayerDecks] = useState<
    PlayerVisualDeck[]
  >([]);

  const updatePlayerCards = (playersData: Player[]) => {
    const visualPlayerDecks: PlayerVisualDeck[] = [];
    const currentVisualPlayerDeck: PlayerVisualDeck[] = [];
    let nonCurrentPlayerIndex = 1;
    playersData.forEach((player) => {
      const positionOffset = 14;
      const playerVisualDeck: PlayerVisualDeck = {
        player,
        visualDeck: [],
      };
      if (player.socketId === socket.id) {
        playerVisualDeck.visualDeck = createPlayerDeck(
          player.deck,
          new Vector3(0, 20, positionOffset)
        );
        currentVisualPlayerDeck.push(playerVisualDeck);
      } else {
        const playerOffset = positionOffset + nonCurrentPlayerIndex * -20;
        playerVisualDeck.visualDeck = createPlayerDeck(
          player.deck,
          new Vector3(0, 20, playerOffset)
        );
        visualPlayerDecks.push(playerVisualDeck);
        nonCurrentPlayerIndex++;
      }
    });
    setVisualPlayerDecks([...currentVisualPlayerDeck, ...visualPlayerDecks]);
  };

  useEffect(() => {
    if (!playersData) return;
    updatePlayerCards(playersData);
  }, [playersData]);

  if (!visualPlayerDecks) return null;

  return (
    <>
      {visualPlayerDecks.map((visualPlayerDeck, playerIndex) => (
        <>
          {visualPlayerDeck.visualDeck.map((column, columnIndex) => (
            <>
              {column.map((card, cardIndex) => (
                <PlayerCard
                  key={columnIndex + cardIndex * 4}
                  card={card}
                  visualPlayerDeck={visualPlayerDeck}
                  columnIndex={columnIndex}
                  cardIndex={cardIndex}
                  isCurrentPlayer={playerIndex === 0}
                />
              ))}
            </>
          ))}
          <CardCache
            playerData={visualPlayerDeck.player}
            // current player is always at index 0
            position={new Vector3(9, 20, 6 - playerIndex * 12)}
          />
        </>
      ))}
    </>
  );
};

export default PlayerDecks;
// ich (0) --> 4
// andere (1) --> -8
