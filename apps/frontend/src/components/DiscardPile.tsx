import DiscardPileCard from "./DiscardPileCard";
import type { Card } from "../types/gameProtocol";

export default function DiscardPile({ discardPileData }: { discardPileData: Card[] }) {
  const visible = discardPileData.slice(-12);
  return <>{visible.map((value, index) => <DiscardPileCard key={index} value={value} index={index} top={index === visible.length - 1} />)}</>;
}
