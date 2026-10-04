import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { Mesh } from "three";
type ModelProps = { name: string; path: string; position: [number, number, number]; rotation?: [number, number, number]; scale: [number, number, number] };
export default function Model({ name, path, position, rotation = [0, 0, 0], scale }: ModelProps) {
  const { scene } = useGLTF(path);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((object) => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    return copy;
  }, [scene]);
  return <primitive name={name} object={model} position={position} rotation={rotation} scale={scale} dispose={null} />;
}
