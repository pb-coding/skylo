import { useEffect, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, useProgress } from "@react-three/drei";
import ErrorBoundary from "./ErrorBoundary";
import PlayArea from "./PlayArea";
import EnvironmentModels from "./EnvironmentModels";
import type { GameView } from "../types/gameProtocol";

const ENVIRONMENT = import.meta.env.VITE_ENVIRONMENT || "";

function LoadingStatus() {
  const { active } = useProgress();
  return active ? <p role="status" className="absolute inset-x-0 top-4 z-10 text-center text-white bg-teal-900 p-2">3D-Spielwelt wird geladen …</p> : null;
}

function CameraFit({ count }: { count: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const rows = Math.ceil(count / (count > 2 ? 2 : 1));
    const depth = rows * 16 + 8;
    const width = count > 2 ? 50 : 26;
    const aspect = size.width / Math.max(size.height, 1);
    const distance = Math.max(depth, width / aspect) * 0.9;
    camera.position.set(0, 20 + distance, distance * 0.15);
    camera.lookAt(0, 20, 0);
    camera.updateProjectionMatrix();
  }, [camera, count, size.height, size.width]);
  return null;
}

export default function GameCanvas({ gameData, focusPlayerId }: { gameData: GameView; focusPlayerId: string }) {
  return (
    <ErrorBoundary key={gameData.matchId} canLeaveSession>
      <div className="relative w-full" style={{ height: "clamp(320px, 54vh, 620px)" }} aria-label="Dreidimensionale Spielansicht">
        <Canvas fallback={<p role="alert" className="p-6">Dein Browser unterstützt keine 3D-Grafik. Die Karten und Aktionen stehen auch unter der Spielansicht zur Verfügung.</p>}
          camera={{ position: [0, 70, 10], fov: 65, near: 0.1, far: 1000 }}>
          <CameraFit count={gameData.playerCount} />
          <ambientLight intensity={0.6} />
          <Suspense fallback={null}>
            <Environment files="/hdri/lebombo_1k.hdr" />
            <EnvironmentModels playerCount={gameData.playerCount} />
          </Suspense>
          {ENVIRONMENT === "local" && <OrbitControls target={[0, 20, 0]} />}
          <PlayArea gameData={gameData} focusPlayerId={focusPlayerId} />
        </Canvas>
        <LoadingStatus />
      </div>
    </ErrorBoundary>
  );
}
