import { useTexture, RoundedBox } from "@react-three/drei";
import { RepeatWrapping, SRGBColorSpace } from "three";
import { useMemo, useEffect } from "react";
import Model from "./Model";

export default function EnvironmentModels() {
  const maps = useTexture(["/textures/floor.jpg", "/textures/skylo-felt.png"]);
  const [wood, felt] = useMemo(() => maps.map((map, index) => {
    const copy = map.clone();
    copy.colorSpace = SRGBColorSpace;
    copy.wrapS = copy.wrapT = RepeatWrapping;
    copy.repeat.set(index === 0 ? 2 : 4, index === 0 ? 3 : 4);
    copy.needsUpdate = true;
    return copy;
  }), [maps]);
  useEffect(() => () => { wood.dispose(); felt.dispose(); }, [wood, felt]);
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial envMapIntensity={0.25} map={wood} color="#795b45" roughness={0.72} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 2]} receiveShadow>
      <planeGeometry args={[48, 48]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#211b17" roughness={1} />
    </mesh>
    <RoundedBox args={[30, 0.9, 32]} radius={0.32} smoothness={2} position={[0, 5.5, 0]} castShadow receiveShadow>
      <meshStandardMaterial envMapIntensity={0.25} map={wood} color="#795337" roughness={0.48} />
    </RoundedBox>
    <RoundedBox args={[28.8, 0.09, 30.8]} radius={0.035} smoothness={2} position={[0, 6.005, 0]} receiveShadow>
      <meshStandardMaterial envMapIntensity={0.25} map={felt} color="#93daf2" roughness={0.97} />
    </RoundedBox>
    {[-11, 11].flatMap((x) => [-12, 12].map((z) => <mesh key={`${x}:${z}`} position={[x, 2.75, z]} castShadow>
      <boxGeometry args={[1, 5.5, 1]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#392317" roughness={0.55} />
    </mesh>))}
    <Model name="sofa" path="/models/sofa/sofa_02_1k.gltf" position={[-23, 0, -2]} rotation={[0, 1.55, 0]} scale={[9, 9, 9]} />
    <RoundedBox args={[7, 7, 1.6]} radius={0.7} smoothness={3} position={[0, 6, -22]} castShadow><meshStandardMaterial envMapIntensity={0.25} color="#193e40" roughness={0.95} /></RoundedBox>
    <RoundedBox args={[7, 1.6, 6]} radius={0.5} smoothness={2} position={[0, 3.5, -19.6]} castShadow><meshStandardMaterial envMapIntensity={0.25} color="#193e40" roughness={0.95} /></RoundedBox>
    {[-3.5, 3.5].map((x) => <RoundedBox key={x} args={[1.2, 3, 6]} radius={0.5} smoothness={2} position={[x, 5, -19.6]} castShadow><meshStandardMaterial envMapIntensity={0.25} color="#193e40" roughness={0.95} /></RoundedBox>)}
    <Model name="front-chair" path="/models/arm-chair/modern_arm_chair_01_1k.gltf" position={[0, 0, 22]} rotation={[0, Math.PI, 0]} scale={[8, 8, 8]} />
    <mesh position={[11, 8, -24]} castShadow>
      <cylinderGeometry args={[1.5, 1.7, 2.5, 20, 1, true]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#e6c697" emissive="#b87b32" emissiveIntensity={0.35} side={2} roughness={1} />
    </mesh>
    <mesh position={[11, 3.5, -24]}>
      <cylinderGeometry args={[0.09, 0.09, 6.5, 10]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#402f22" metalness={0.5} roughness={0.3} />
    </mesh>
    <mesh position={[11, 0.1, -24]}>
      <cylinderGeometry args={[1.2, 1.2, 0.2, 16]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#402f22" metalness={0.5} roughness={0.3} />
    </mesh>
    <pointLight position={[11, 8, -24]} intensity={70} distance={45} color="#ffc67d" />
    <mesh position={[0, 14, -35]}>
      <boxGeometry args={[90, 28, 0.4]} />
      <meshStandardMaterial envMapIntensity={0.25} color="#172626" roughness={0.95} />
    </mesh>
  </>;
}
