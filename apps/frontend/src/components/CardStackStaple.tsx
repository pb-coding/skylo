import CardStackCard from "./CardStackCard";
import type { GameView } from "../types/gameProtocol";

export default function CardStackStaple({ cardStackData }: { cardStackData: GameView["cardStack"] }) {
  // A small visual stack represents the count; hidden values never enter the renderer.
  const count = Math.min(cardStackData.cards.length, 12);
  return <>{Array.from({ length: count }, (_, index) => <CardStackCard key={index} index={index} top={index === count - 1} />)}</>;
}
