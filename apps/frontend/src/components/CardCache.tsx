import { useEffect, useMemo } from "react";
import { Vector3 } from "three";
import { createCard } from "../objects/cards";
import type { Card } from "../types/gameProtocol";

export default function CardCache({ value, position }: { value: Card | null; position: [number, number, number] }) {
  const [x, y, z] = position;
  const card = useMemo(() => value === null ? null : createCard(value, new Vector3(x, y, z), true), [value, x, y, z]);
  useEffect(() => () => card?.material.forEach((material) => material.dispose()), [card]);
  return card ? <primitive object={card} dispose={null} /> : null;
}
