import { CardStack } from "../types/gameTypes";
import CardStackCard from "./CardStackCard";
import CardMesh from "../scene/CardMesh";
import { Html } from "@react-three/drei";
import { ArrowClockwise } from "@phosphor-icons/react";
import { emitCardAction } from "../scene/gameActions";
export default function CardStackStaple({ cardStackData, enabled }: { cardStackData: CardStack | null; enabled: boolean }) {
  if (!cardStackData) return null;
  if (cardStackData.cards.length === 0) return (
    <group position={[-1.9, 6.16, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={(event) => {
        event.stopPropagation();
        if (enabled) emitCardAction("draw-from-card-stack", "refill and draw");
      }}>
        <planeGeometry args={[3, 4.05]} />
        <meshStandardMaterial color={enabled ? "#167f83" : "#183e40"} roughness={0.95} />
      </mesh>
      <Html center position={[0, 0.04, 0]} style={{ pointerEvents: "none" }}>
        <span style={{ color: "#c1e9e5", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 11 }}>
          <ArrowClockwise size={22} aria-hidden="true" />Mischen
        </span>
      </Html>
    </group>
  );
  const visible = Math.min(5, cardStackData.cards.length);
  return <group position={[-1.9, 6.15, 0]}>
    {Array.from({ length: visible - 1 }, (_, index) => <CardMesh key={index} value={null} position={[0, index * 0.055, 0]} animate={false} />)}
    <CardStackCard value={null} enabled={enabled} position={[0, (visible - 1) * 0.055, 0]} />
  </group>;
}
