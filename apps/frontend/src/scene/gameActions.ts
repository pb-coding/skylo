import type { GameView } from "../types/gameProtocol";

/** Permissions come from the server's legal actions, independent of deck layout. */
export function getGameActions(game: GameView, connected = true) {
  const ownPlayer = game.players.find((player) => player.id === game.ownPlayerId);
  const legal = connected ? game.legalActions : [];
  return {
    ownPlayer,
    canDraw: legal.some((action) => action.type === "draw"),
    canDiscard: legal.some((action) => action.type === "take-discard" || action.type === "discard"),
    canSelectCard: (column: number, row: number) => {
      const slotId = ownPlayer?.slotIds[column]?.[row];
      return !!slotId && legal.some((action) => "slotId" in action && action.slotId === slotId);
    },
  };
}
