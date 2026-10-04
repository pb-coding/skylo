import { Game } from "./types/gameTypes";

export function extractCurrentPlayer(gameData: Game | null) {
  return gameData?.players.find((player) => player.id === gameData.ownPlayerId);
}
