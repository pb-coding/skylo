import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Fragment } from "react";
import PlayerCard from "./PlayerCard";
import CardCache from "./CardCache";
import type { GameView } from "../types/gameProtocol";

type Props = { gameData: GameView; focusPlayerId: string; focusedSlotId?: string | null };
export default function PlayerDecks({ gameData, focusPlayerId, focusedSlotId }: Props) {
  const mobile = useThree((state) => state.size.width < 600);
  const focused = gameData.players.find((player) => player.id === focusPlayerId) || gameData.players[0];
  const others = gameData.players.filter((player) => player.id !== focused?.id);
  const opponentScale = mobile
    ? (others.length <= 2 ? 0.35 : others.length <= 3 ? 0.3 : 0.25)
    : (others.length <= 2 ? 0.65 : others.length <= 4 ? 0.48 : 0.4);
  const seats = others.map((player, index) => {
    const angle = others.length === 1 ? 0 : (-Math.PI * 0.62 + index * Math.PI * 1.24 / (others.length - 1));
    if (mobile) {
      const columns = Math.min(others.length, 4);
      const row = Math.floor(index / columns);
      const countInRow = Math.min(columns, others.length - row * columns);
      return { player, position: [((index % columns) - (countInRow - 1) / 2) * 4.5, 6.16, -8.8 + row * 4] as [number, number, number], rotation: 0, scale: opponentScale };
    }
    const position: [number, number, number] = others.length === 2
      ? [index === 0 ? -7.7 : 7.7, 6.16, -9]
      : [Math.sin(angle) * 11.5, 6.16, -Math.cos(angle) * 10];
    return { player, position, rotation: others.length <= 2 ? 0 : Math.atan2(-position[0], -position[2]), scale: opponentScale };
  });
  const allSeats = focused ? [{ player: focused, position: [0, 6.16, 9] as [number, number, number], rotation: 0, scale: 1 }, ...seats] : seats;
  const drawn = gameData.players.find((player) => player.cardCache !== null);
  return <>
    {allSeats.map(({ player, position, rotation, scale }) => <group key={player.id} position={position} rotation={[0, rotation, 0]} scale={scale}>
      {player.deck.map((column, columnIndex) => <Fragment key={player.slotIds[columnIndex][0]}>
        {column.map((value, row) => <PlayerCard key={player.slotIds[columnIndex][row]} value={value}
          revealed={player.knownCardPositions[columnIndex][row]} columnIndex={columnIndex} cardIndex={row}
          slotId={player.slotIds[columnIndex][row]} columnCount={player.deck.length}
          owned={player.id === gameData.ownPlayerId} focused={focusedSlotId === player.slotIds[columnIndex][row]} />)}
      </Fragment>)}
      {player.id !== focused?.id && <Html center zIndexRange={[7, 0]} position={[0, 0.2, 6.45]} style={{ pointerEvents: "none" }}>
        <span className={`table-player-label ${player.playersTurn ? "active" : ""}`}>{player.name}</span>
      </Html>}
    </group>)}
    {drawn && <CardCache playerData={drawn} />}
  </>;
}
