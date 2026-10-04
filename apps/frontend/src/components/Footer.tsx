import { Dispatch, FC, SetStateAction } from "react";
import { socket } from "../socket";

import Text from "../global/Text";
import Button from "../global/Button";
import { Game } from "../types/gameTypes";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";

type Footer = {
  isConnected: boolean;
  session: string;
  clientsInRoom: number;
  gameData: Game;
  showNextGameButton: boolean;
  setClientsInRoom: Dispatch<SetStateAction<number>>;
  setSession: Dispatch<SetStateAction<string>>;
};

// TODO: use clients in room to validate player count

export const Footer: FC<Footer> = ({
  isConnected,
  session,
  gameData,
  showNextGameButton,
  setClientsInRoom,
  setSession,
}) => {
  function nextGame() {
    socket.emit("next-round", { sessionId: session });
  }

  function leaveSession(sessionName: string) {
    socket.emit("leave-session", sessionName);
    setClientsInRoom(0);
    setSession("");
  }

  const isEndOfGame = gameData.phase === "game ended";

  return (
    <div className="p-4 rounded-lg shadow-lg flex flex-col justify-between text-white bg-gradient-to-b from-teal-600 to-teal-700">
      <div className="flex justify-between">
        <div className="flex items-center">
          <Text>Session: {session} </Text>
          {isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
        </div>
        <div className="flex justify-between items-center">
          {!isEndOfGame && showNextGameButton && (
            <Button onClick={nextGame}>Next Game</Button>
          )}
          {isEndOfGame && <p className="mr-4">Game is over</p>}
          <Button variant="secondary" onClick={() => leaveSession(session)}>
            Leave
          </Button>
        </div>
      </div>
      {gameData.players.map((player, index) => (
        <div key={index} className="mb-3 pt-2 mt-2 border-t border-black">
          <div className="flex justify-between items-center">
            <Text>
              {player?.name} {player.socketId == socket.id && "👤"}{" "}
              {player.playersTurn && <span className="text-green-500">⏩</span>}
              {isEndOfGame && player.place == 1 && "🏆"}
            </Text>
            <p></p>
          </div>
          <div className="flex justify-between">
            <Text>Round Points: {player?.roundPoints}</Text>
            <Text>Total Points: {player?.totalPoints}</Text>
          </div>
        </div>
      ))}
    </div>
  );
};
