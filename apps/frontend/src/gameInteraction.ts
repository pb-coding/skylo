import { createContext, useContext } from "react";
import type { GameAction } from "./types/gameProtocol";

export function sameAction(left: GameAction, right: GameAction) {
  return left.type === right.type &&
    (!("slotId" in left) || ("slotId" in right && left.slotId === right.slotId));
}

export const GameInteractionContext = createContext({
  legalActions: [] as readonly GameAction[],
  enabled: false,
  sendAction: (_action: GameAction) => { void _action; },
});

export function useGameInteraction() {
  const interaction = useContext(GameInteractionContext);
  return {
    ...interaction,
    allows: (action: GameAction) => interaction.enabled &&
      interaction.legalActions.some((legal) => sameAction(legal, action)),
  };
}
