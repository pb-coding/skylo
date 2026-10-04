import { Game } from "../types/gameTypes";
import { socket } from "../socket";

export function getGameActions(game: Game, connected = true) {
  const ownPlayer = game.players.find((player) => player.socketId === socket.id);
  const active = Boolean(connected && ownPlayer?.playersTurn);
  const initial = game.phase === "reveal two cards";
  const revealedCount = ownPlayer?.knownCardPositions.flat().filter(Boolean).length ?? 0;
  return {
    ownPlayer,
    canDraw: active && game.phase === "pick up card",
    canDiscard: active && (game.phase === "pick up card" || (game.phase === "place card" && !ownPlayer?.tookDispiledCard)),
    canSelectCard: (column: number, row: number) => {
      if (!connected || !ownPlayer?.deck[column] || row < 0 || row > 2) return false;
      const known = ownPlayer.knownCardPositions[column]?.[row];
      if (initial) return revealedCount < 2 && !known;
      return active && (game.phase === "place card" || (game.phase === "reveal card" && !known));
    },
  };
}

export function emitCardAction(event: "click-card" | "draw-from-card-stack" | "click-discard-pile", payload: [number, number] | string) {
  if (socket.connected) socket.emit(event, payload);
}
