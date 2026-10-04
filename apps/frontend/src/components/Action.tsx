import { ReactNode } from "react";
import { useGameInteraction } from "../gameInteraction";
import type { GameAction } from "../types/gameProtocol";

export default function Action({ action, children }: { action: GameAction; children: ReactNode }) {
  const interaction = useGameInteraction();
  return <button disabled={!interaction.allows(action)} onClick={() => interaction.sendAction(action)}>{children}</button>;
}
