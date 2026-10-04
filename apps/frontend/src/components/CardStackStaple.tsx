import type { CardStack } from "../types/gameTypes";
import CardStackCard from "./CardStackCard";
import CardMesh from "../scene/CardMesh";
import { Html } from "@react-three/drei";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useGameInteraction } from "../gameInteraction";
export default function CardStackStaple({ cardStackData }: { cardStackData: CardStack }) {
  const interaction = useGameInteraction();
  const enabled = interaction.allows({ type: "draw" });
  if (cardStackData.cards.length === 0) return (
    <group position={[-1.9, 6.16, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={(event) => {
        event.stopPropagation();
        if (enabled) interaction.sendAction({ type: "draw" });
      }}>
        <planeGeometry args={[3, 4.05]} />
        <meshStandardMaterial color={enabled ? "#167f83" : "#183e40"} roughness={0.95} />
      </mesh>
      <Html center zIndexRange={[7, 0]} position={[0, 0.04, 0]} style={{ pointerEvents: "none" }}>
        <span style={{ color: "#c1e9e5", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 11 }}>
          <ArrowClockwise size={22} aria-hidden="true" />Mischen
        </span>
      </Html>
    </group>
  );
  const visible = Math.min(5, cardStackData.cards.length);
  return <group position={[-1.9, 6.15, 0]}>
    {Array.from({ length: visible - 1 }, (_, index) => <CardMesh key={index} value={null} position={[0, index * 0.055, 0]} animate={false} />)}
    <CardStackCard value={null} position={[0, (visible - 1) * 0.055, 0]} />
  </group>;
}
