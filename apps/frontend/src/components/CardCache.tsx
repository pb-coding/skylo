import type { PlayerView } from "../types/gameProtocol";
import CardMesh from "../scene/CardMesh";
export default function CardCache({ playerData }: { playerData: PlayerView }) {
  if (playerData.cardCache === null) return null;
  return <CardMesh value={playerData.cardCache} revealed position={[6.3, 6.22, 0.5]} />;
}
