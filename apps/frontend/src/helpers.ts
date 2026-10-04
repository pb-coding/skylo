import { Game } from "./types/gameTypes";
import { socket } from "./socket";

export function extractCurrentPlayer(gameData: Game | null) {
  if (!gameData) return undefined;
  return gameData.players.find((player) => player.socketId === socket.id);
}
