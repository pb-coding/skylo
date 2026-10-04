import { Card } from "../types/gameTypes";
import CardMesh from "../scene/CardMesh";
import { emitCardAction } from "../scene/gameActions";
export default function DiscardPileCard({ value, enabled, position }: { value: Card; enabled: boolean; position: [number, number, number] }) {
  return <CardMesh value={value} revealed position={position} enabled={enabled} animate={false} onActivate={() => emitCardAction("click-discard-pile", "discard pile")} />;
}
