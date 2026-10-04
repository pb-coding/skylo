import type { Card } from "../types/gameTypes";
import CardMesh from "../scene/CardMesh";
import { useGameInteraction } from "../gameInteraction";
export default function CardStackCard({ value, position }: { value: Card; position: [number, number, number] }) {
  const interaction = useGameInteraction();
  const enabled = interaction.allows({ type: "draw" });
  return <CardMesh value={value} position={position} enabled={enabled} emphasized={enabled} animate={false} onActivate={() => interaction.sendAction({ type: "draw" })} />;
}
