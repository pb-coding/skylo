import { FC, useMemo, memo } from "react";
import { Vector3 } from "three";

import Model from "../components/Model";
import { createFloor } from "../objects/floor";

const EnviromentModels: FC<{ playerCount: number }> = memo(({ playerCount }) => {
  const wideTable = playerCount > 2;
  const rows = Math.ceil(playerCount / (wideTable ? 2 : 1));
  const tableDepthScale = wideTable ? Math.max(2.6, rows * 1.15) : 2;
  const seatOffset = wideTable ? rows * 8 + 14 : 16;
  const floorObject = useMemo(() => {
    return createFloor(
      new Vector3(0, 0, 0),
      { x: 1, y: 0.001, z: 1 },
      "/textures/floor.jpg",
      200
    );
  }, []);
  const carpetObject = useMemo(() => {
    return createFloor(
      new Vector3(0, 1, 0),
      { x: 1, y: 0.001, z: 2 },
      "/textures/red-carpet.jpg",
      60,
      true,
      4,
      4
    );
  }, []);

  return (
    <>
      <Model
        name="table"
        path="/models/table.glb"
        position={[0, 1.8, 2]}
        scale={[wideTable ? 6 : 2, 2, tableDepthScale]}
      />
      <Model
        name="armchair"
        path="/models/arm-chair/modern_arm_chair_01_1k.gltf"
        position={[0, 0, seatOffset]}
        rotation={[0, 3.15, 0]}
        scale={[20, 20, 20]}
      />
      <Model
        name="green-chair"
        path="/models/GreenChair_01_1k.gltf/GreenChair_01_1k.gltf"
        position={[0, 0, -seatOffset - 2]}
        rotation={[0, 0, 0]}
        scale={[25, 25, 25]}
      />
      <Model
        name="sofa"
        path="/models/sofa/sofa_02_1k.gltf"
        position={[wideTable ? -42 : -25, 0, 2]}
        rotation={[0, 1.55, 0]}
        scale={[25, 25, 25]}
      />
      <primitive object={floorObject} />
      <primitive object={carpetObject} />
    </>
  );
});

export default EnviromentModels;
