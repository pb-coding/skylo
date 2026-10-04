import { Html } from "@react-three/drei";
import PlayerCard from "./PlayerCard";
import CardCache from "./CardCache";
import type { GameView } from "../types/gameProtocol";

export default function PlayerDecks({ gameData, focusPlayerId }: { gameData: GameView; focusPlayerId: string }) {
  const focused = gameData.players.find((player) => player.id === focusPlayerId);
  const ordered = focused ? [focused, ...gameData.players.filter((player) => player.id !== focused.id)] : gameData.players;
  const columns = ordered.length > 2 ? 2 : 1;
  const rows = Math.ceil(ordered.length / columns);
  return <>{ordered.map((player, index) => {
    const x = columns === 1 ? 0 : index % 2 === 0 ? -12 : 12;
    const z = (rows - 1) * 8 - Math.floor(index / columns) * 16;
    return <group key={player.id}>
      <Html position={[x, 20.4, z + 6.2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none", whiteSpace: "nowrap" }}>
        <span className={`px-2 py-1 rounded text-xs text-white ${player.playersTurn ? "bg-green-800" : "bg-teal-950"}`}>
          {player.playersTurn ? "▶ " : ""}{player.name}{player.id === gameData.ownPlayerId ? " (du)" : ""}{player.kind === "bot" ? " · Bot" : ""}
        </span>
      </Html>
      {player.id === focusPlayerId && <mesh position={[x, 20.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[17.5, 13]} /><meshBasicMaterial color="#facc15" transparent opacity={0.2} />
      </mesh>}
      {player.deck.map((column, columnIndex) => column.map((value, cardIndex) => {
        const slotId = player.slotIds[columnIndex][cardIndex];
        return <PlayerCard key={slotId} value={value} slotId={slotId}
          faceUp={player.knownCardPositions[columnIndex][cardIndex]}
          position={[x + columnIndex * 4 - 6, 20, z + cardIndex * 4 - 4]}
          owned={player.id === gameData.ownPlayerId} />;
      }))}
      <CardCache value={player.cardCache} position={[x + 9, 20, z]} />
    </group>;
  })}</>;
}
