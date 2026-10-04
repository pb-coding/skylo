import type { Card } from "../types/gameProtocol";
import CardMesh from "../scene/CardMesh";
import { useGameInteraction } from "../gameInteraction";
export default function DiscardPileCard({ value, position }: { value: Card; position: [number, number, number] }) {
  const interaction = useGameInteraction();
  const action = interaction.legalActions.find((action) => action.type === "take-discard" || action.type === "discard");
  const enabled = !!(action && interaction.allows(action));
  return <CardMesh value={value} revealed position={position} enabled={enabled} animate={false}
    onActivate={() => { if (action) interaction.sendAction(action); }} />;
}
