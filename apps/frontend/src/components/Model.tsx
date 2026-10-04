import { FC } from "react";
import { useGLTF } from "@react-three/drei";

type ModelProps = {
  name: string;
  path: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: [number, number, number];
};

const Model: FC<ModelProps> = ({
  path,
  position,
  rotation = [0, 0, 0],
  scale,
}) => {
  const model = useGLTF(path);

  return (
    <primitive
      object={model.scene}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
};

export default Model;
