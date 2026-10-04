import { useThree } from "@react-three/fiber";
import { Fragment } from "react";
import { Game } from "../types/gameTypes";
import { getGameActions } from "../scene/gameActions";
import PlayerCard from "./PlayerCard";
import CardCache from "./CardCache";

type Props = { gameData: Game; isConnected: boolean; focusedCard?: [number, number] | null };
export default function PlayerDecks({ gameData, isConnected, focusedCard }: Props) {
  const mobile = useThree((state) => state.size.width < 600);
  const actions = getGameActions(gameData, isConnected);
  const own = actions.ownPlayer;
  const opponents = gameData.players.filter((player) => player.socketId !== own?.socketId);
  const opponentScale = mobile
    ? (opponents.length <= 2 ? 0.35 : opponents.length <= 3 ? 0.3 : 0.25)
    : (opponents.length <= 2 ? 0.65 : opponents.length <= 4 ? 0.48 : 0.4);
  const seats = opponents.map((player, index) => {
    const angle = opponents.length === 1 ? 0 : (-Math.PI * 0.62 + index * Math.PI * 1.24 / (opponents.length - 1));
    if (mobile) {
      const columns = Math.min(opponents.length, 4);
      const row = Math.floor(index / columns);
      const countInRow = Math.min(columns, opponents.length - row * columns);
      return { player, position: [((index % columns) - (countInRow - 1) / 2) * 4.5, 6.16, -8.8 + row * 4] as [number, number, number], rotation: 0 };
    }
    // For the common three-player table both opponents sit across from you.
    const position: [number, number, number] = opponents.length === 2
      ? [index === 0 ? -7.7 : 7.7, 6.16, -9]
      : [Math.sin(angle) * 11.5, 6.16, -Math.cos(angle) * 10];
    return { player, position, rotation: opponents.length <= 2 ? 0 : Math.atan2(-position[0], -position[2]) };
  });
  return <>
    {own && <group position={[0, 6.16, 9]}>
      {own.deck.map((column, columnIndex) => <Fragment key={columnIndex}>
        {column.map((value, row) => <PlayerCard key={row} value={value} revealed={own.knownCardPositions[columnIndex][row]} columnIndex={columnIndex} cardIndex={row}
          columnCount={own.deck.length} enabled={actions.canSelectCard(columnIndex, row)} focused={focusedCard?.[0] === columnIndex && focusedCard?.[1] === row} />)}
      </Fragment>)}
    </group>}
    {seats.map(({ player, position, rotation }) => <group key={player.socketId} position={position} rotation={[0, rotation, 0]} scale={opponentScale}>
      {player.deck.map((column, columnIndex) => <Fragment key={columnIndex}>
        {column.map((value, row) => <PlayerCard key={row} value={value} revealed={player.knownCardPositions[columnIndex][row]} columnIndex={columnIndex} cardIndex={row} columnCount={player.deck.length} enabled={false} />)}
      </Fragment>)}
    </group>)}
    {own && <CardCache playerData={own} />}
  </>;
}
