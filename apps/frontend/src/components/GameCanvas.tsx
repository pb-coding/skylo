import { Suspense, useLayoutEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useProgress } from "@react-three/drei";
import { PerspectiveCamera } from "three";
import ErrorBoundary from "./ErrorBoundary";
import PlayArea from "./PlayArea";
import EnvironmentModels from "./EnvironmentModels";
import { Game } from "../types/gameTypes";

type Props = { session: string; gameData: Game | null; isConnected: boolean; focusedCard?: [number, number] | null };
function CameraFraming() {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const mobile = size.width < 600;
    perspective.position.set(0, mobile ? 37 : 30, mobile ? 31 : 28);
    perspective.lookAt(0, 6, 3);
    perspective.fov = mobile ? 50 : 45;
    perspective.aspect = size.width / size.height;
    perspective.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  return null;
}
function LoadingStatus() {
  const { active } = useProgress();
  return active ? <p role="status" className="scene-loading">Dein Spieltisch wird vorbereitet …</p> : null;
}
export default function GameCanvas({ gameData, isConnected, focusedCard }: Props) {
  if (!gameData) return null;
  return <ErrorBoundary canLeaveSession>
    <div style={{ width: "100%", height: "100%", pointerEvents: isConnected ? "auto" : "none" }}>
      <Canvas fallback={<p role="alert">Dein Browser unterstützt keine 3D-Grafik. Bitte aktiviere WebGL oder verwende einen aktuellen Browser.</p>} frameloop="demand" dpr={[1, 1.5]} shadows camera={{ position: [0, 30, 28], fov: 45, near: 0.1, far: 150 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={["#112222"]} />
        <fog attach="fog" args={["#112222", 65, 125]} />
        <CameraFraming />
        <ambientLight intensity={0.2} color="#a2d4cf" />
        <directionalLight position={[-12, 35, 15]} intensity={1.1} color="#ffe9c3" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} shadow-bias={-0.001} />
        <spotLight position={[0, 30, 6]} angle={0.75} penumbra={0.45} intensity={3000} distance={60} color="#cbeefa" />
        <Suspense fallback={null}>
          <Environment files="/hdri/lebombo_1k.hdr" environmentIntensity={0.28} />
          <EnvironmentModels />
          <PlayArea gameData={gameData} isConnected={isConnected} focusedCard={focusedCard} />
        </Suspense>
      </Canvas>
      <LoadingStatus />
    </div>
  </ErrorBoundary>;
}
