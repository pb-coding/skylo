import { Card } from "../types/gameTypes";
import CardMesh from "../scene/CardMesh";
import { emitCardAction } from "../scene/gameActions";
export default function CardStackCard({ value, enabled, position }: { value: Card; enabled: boolean; position: [number, number, number] }) {
  return <CardMesh value={value} position={position} enabled={enabled} emphasized={enabled} animate={false} onActivate={() => emitCardAction("draw-from-card-stack", "draw card")} />;
}
