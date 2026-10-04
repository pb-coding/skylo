import { FC } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, useProgress } from "@react-three/drei";
import ErrorBoundary from "./ErrorBoundary";

// import Music from "../components/Music";
import PlayArea from "../components/PlayArea";
import EnvironmentModels from "../components/EnvironmentModels";
import { Game } from "../types/gameTypes";

type GameCanvasProps = {
  session: string;
  gameData: Game | null;
  isConnected: boolean;
};

const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || "";

function LoadingStatus() {
  const { active } = useProgress();
  return active ? (
    <p role="status" className="absolute inset-x-0 top-4 z-10 text-center text-white bg-teal-900 p-2">
      3D-Spielwelt wird geladen …
    </p>
  ) : null;
}

const GameCanvas: FC<GameCanvasProps> = ({ gameData, isConnected }) => {
  const heightProportion = 1.4;
  const aspectRatio =
    window.innerWidth / (window.innerHeight / heightProportion);

  const isLocalEnv = ENVIRONMENT === "local";

  if (!gameData) return null;

  return (
    <ErrorBoundary canLeaveSession>
      <div
        className="relative"
        style={{
          width: window.innerWidth,
          height: window.innerHeight / heightProportion,
          pointerEvents: isConnected ? "auto" : "none",
        }}
      >
        <Canvas
          fallback={<p role="alert" className="p-6 text-white">Dein Browser unterstützt keine 3D-Grafik. Bitte aktiviere WebGL oder verwende einen aktuellen Browser.</p>}
          camera={{
            position: [0, 43, 10],
            fov: 75,
            near: 0.1,
            far: 1000,
            aspect: aspectRatio,
          }}
        >
          <Environment files="/hdri/lebombo_1k.hdr" />
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
        <LoadingStatus />
      </div>
    </ErrorBoundary>
  );
};

export default GameCanvas;
