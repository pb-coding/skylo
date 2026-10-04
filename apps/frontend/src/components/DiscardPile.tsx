import { Card } from "../types/gameTypes";
import DiscardPileCard from "./DiscardPileCard";
import CardMesh from "../scene/CardMesh";
export default function DiscardPile({ discardPileData, enabled }: { discardPileData: Card[] | null; enabled: boolean }) {
  if (!discardPileData?.length) return null;
  const visible = Math.min(3, discardPileData.length);
  return <group position={[1.9, 6.15, 0]}>
    {Array.from({ length: visible - 1 }, (_, index) => <CardMesh key={index} value={null} position={[0, index * 0.045, 0]} animate={false} />)}
    <DiscardPileCard value={discardPileData[discardPileData.length - 1]} enabled={enabled} position={[0, (visible - 1) * 0.045, 0]} />
  </group>;
}
