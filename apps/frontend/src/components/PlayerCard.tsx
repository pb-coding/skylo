import { useMemo, useEffect } from "react";
import { Vector3 } from "three";
import { createCard } from "../objects/cards";
import { useGameInteraction } from "../gameInteraction";
import type { Card, GameAction } from "../types/gameProtocol";

type Props = { value: Card | null; slotId: string; faceUp: boolean; position: [number, number, number]; owned: boolean };

export default function PlayerCard({ value, slotId, faceUp, position, owned }: Props) {
  const [x, y, z] = position;
  const card = useMemo(() => createCard(value, new Vector3(x, y, z), faceUp), [value, x, y, z, faceUp]);
  useEffect(() => () => card.material.forEach((material) => material.dispose()), [card]);
  const interaction = useGameInteraction();
  const action = interaction.legalActions.find((action): action is GameAction & { slotId: string } =>
    "slotId" in action && action.slotId === slotId);
  return <primitive object={card} dispose={null} onClick={(event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (owned && action && interaction.allows(action)) interaction.sendAction(action);
  }} />;
}
