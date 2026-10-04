import { FC } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";

// import Music from "../components/Music";
import PlayArea from "../components/PlayArea";
import EnvironmentModels from "../components/EnvironmentModels";
import { Game } from "../types/gameTypes";

type GameCanvasProps = {
  session: string;
  gameData: Game | null;
};

const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || "";

const GameCanvas: FC<GameCanvasProps> = ({ gameData }) => {
  const heightProportion = 1.4;
  const aspectRatio =
    window.innerWidth / (window.innerHeight / heightProportion);

  const isLocalEnv = ENVIRONMENT === "local";

  if (!gameData) return null;

  return (
    <div
      style={{
        width: window.innerWidth,
        height: window.innerHeight / heightProportion,
      }}
    >
      <Canvas
        camera={{
          position: [0, 43, 10],
          fov: 75,
          near: 0.1,
          far: 1000,
          aspect: aspectRatio,
        }}
      >
        <Environment preset="apartment" />
        {/* Music is currently disabled <Music /> - uncomment to enable */}
        {/*<ambientLight color={0xa3a3a3} intensity={0.1} />
        <directionalLight
          color={0xffffff}
          position={[0, 40, 20]}
          castShadow
          shadow-mapSize={[1024, 1024]}
      />*/}
        <EnvironmentModels />
        <gridHelper args={[100, 100]} />
        <axesHelper args={[5]} />
        {isLocalEnv && <OrbitControls />}
        <PlayArea gameData={gameData} />
      </Canvas>
    </div>
  );
};

export default GameCanvas;
