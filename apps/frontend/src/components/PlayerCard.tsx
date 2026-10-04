import CardMesh from "../scene/CardMesh";
import { useGameInteraction } from "../gameInteraction";
import type { Card } from "../types/gameProtocol";

type Props = { value: Card | null; revealed: boolean; slotId: string; columnIndex: number; cardIndex: number; owned: boolean; columnCount?: number; focused?: boolean };
export default function PlayerCard({ value, revealed, slotId, columnIndex, cardIndex, owned, focused, columnCount = 4 }: Props) {
  const interaction = useGameInteraction();
  const action = interaction.legalActions.find((action) => "slotId" in action && action.slotId === slotId);
  const enabled = !!(owned && action && interaction.allows(action));
  return <CardMesh value={value} revealed={revealed} position={[(columnIndex - (columnCount - 1) / 2) * 3.05, 0, (cardIndex - 1) * 4.1]} enabled={enabled} focused={focused}
    onActivate={() => { if (action) interaction.sendAction(action); }} />;
}
