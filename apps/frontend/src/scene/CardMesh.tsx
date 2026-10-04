import { useEffect, useRef, useState } from "react";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Mesh, MathUtils, Group } from "three";
import { Card } from "../types/gameTypes";
import { cardGeometry, getCardMaterials, CARD_WIDTH, CARD_HEIGHT } from "../objects/cards";

type Props = {
  value: Card;
  revealed?: boolean;
  position?: [number, number, number];
  enabled?: boolean;
  focused?: boolean;
  onActivate?: () => void;
  animate?: boolean;
  emphasized?: boolean;
};

export default function CardMesh({ value, revealed = false, position = [0, 0, 0], enabled = false, focused = false, onActivate, animate = true, emphasized = false }: Props) {
  const mesh = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = revealed ? Math.PI : 0;
  const initial = useRef(target);
  useEffect(() => { invalidate(); }, [target, invalidate]);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    const current = mesh.current.rotation.x;
    if (Math.abs(current - target) > 0.001) {
      mesh.current.rotation.x = reducedMotion || !animate ? target : MathUtils.damp(current, target, 18, delta);
      invalidate();
    } else { mesh.current.rotation.x = target; }
    if (group.current) {
      const lift = hovered && enabled ? 0.12 : 0;
      const currentLift = group.current.position.y;
      if (Math.abs(currentLift - lift) > 0.001) {
        group.current.position.y = reducedMotion ? lift : MathUtils.damp(currentLift, lift, 20, delta);
        invalidate();
      }
    }
  });
  const highlight = enabled || focused;
  const activate = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (enabled) onActivate?.();
  };
  return (
    <group position={position}>
      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.026, 0]}>
          <planeGeometry args={[CARD_WIDTH + (emphasized ? 0.35 : 0.18), CARD_HEIGHT + (emphasized ? 0.35 : 0.18)]} />
          <meshBasicMaterial color={emphasized ? "#15e1df" : focused || hovered ? "#b2ffff" : "#11d0cf"} transparent opacity={emphasized ? 1 : focused || hovered ? 0.9 : 0.45} />
        </mesh>
      )}
      {enabled && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]} onClick={activate}>
        <planeGeometry args={[3, 4.05]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>}
      <group ref={group}>
        <mesh castShadow receiveShadow ref={mesh} geometry={cardGeometry} material={getCardMaterials(value, invalidate)} rotation={[initial.current, 0, 0]} dispose={null}
          onClick={activate}
          onPointerOver={(event) => { event.stopPropagation(); if (enabled) { setHovered(true); document.body.style.cursor = "pointer"; } }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; }}>
        </mesh>
      </group>
    </group>
  );
}
