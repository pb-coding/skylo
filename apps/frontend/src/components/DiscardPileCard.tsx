import { useEffect, useMemo } from "react";
import { Vector3 } from "three";
import { createCard } from "../objects/cards";
import { useGameInteraction } from "../gameInteraction";
import type { Card } from "../types/gameProtocol";

export default function DiscardPileCard({ value, index, top }: { value: Card; index: number; top: boolean }) {
  const card = useMemo(() => createCard(value, new Vector3(1.3, 20.05 + index * 0.01, 0), true), [value, index]);
  useEffect(() => () => card.material.forEach((material) => material.dispose()), [card]);
  const interaction = useGameInteraction();
  return <primitive object={card} dispose={null} onClick={(event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (!top) return;
    const action = interaction.legalActions.find((action) => action.type === "take-discard" || action.type === "discard");
    if (action && interaction.allows(action)) interaction.sendAction(action);
  }} />;
}
