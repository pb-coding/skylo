import { useEffect, useMemo } from "react";
import { Vector3 } from "three";
import { createCard } from "../objects/cards";
import { useGameInteraction } from "../gameInteraction";

export default function CardStackCard({ index, top }: { index: number; top: boolean }) {
  const card = useMemo(() => createCard(null, new Vector3(-1.3, 20.05 + index * 0.01, 0)), [index]);
  useEffect(() => () => card.material.forEach((material) => material.dispose()), [card]);
  const interaction = useGameInteraction();
  return <primitive object={card} dispose={null} onClick={(event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (top && interaction.allows({ type: "draw" })) interaction.sendAction({ type: "draw" });
  }} />;
}
