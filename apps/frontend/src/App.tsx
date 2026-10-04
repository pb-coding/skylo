import { useState, useEffect } from "react";
import { socket } from "./socket";

import GameCanvas from "./components/GameCanvas";
import { Footer } from "./components/Footer";
import { SessionManager } from "./components/SessionManager";
import { Game } from "./types/gameTypes";
import MessageDisplay from "./components/MessageDisplay";
import TopFixedChips from "./components/TopFixedChips";

export default function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  // const [messageEvents, setMessageEvents] = useState<string[]>([]);
  const [session, setSession] = useState("");
  const [clientsInRoom, setClientsInRoom] = useState(0);
  const [gameData, setGameData] = useState<Game | null>(null);
  const [messageDispaly, setMessageDisplay] = useState<string>("");

  const showStartGameButton = session !== "" && clientsInRoom >= 2;
  const showNextGameButton = gameData?.phase === "new round";

  function setTempMessage(message: string) {
    setMessageDisplay(message);
    setTimeout(() => {
      setMessageDisplay("");
    }, 3000);
  }

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onClientsInRoomUpdate(clients: number) {
      setClientsInRoom(clients);
    }

    function onMessageEvent(message: string) {
      setTempMessage(message);
      // setMessageEvents((previous) => [...previous, message]);
    }

    function onGameUpdate(gameData: Game) {
      console.log("New game data", gameData);
      setGameData(gameData);
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message", onMessageEvent);
    socket.on("clients-in-session", onClientsInRoomUpdate);
    socket.on("game-update", onGameUpdate);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message", onMessageEvent);
      socket.off("clients-in-session", onClientsInRoomUpdate);
      socket.off("game-update", onGameUpdate);
    };
  }, []);

  return (
    <div className="bg-teal-900 font-theme w-screen h-screen">
      {!gameData && (
        <SessionManager
          isConnected={isConnected}
          clientsInRoom={clientsInRoom}
          setClientsInRoom={setClientsInRoom}
          session={session}
          setSession={setSession}
          showStartGameButton={showStartGameButton}
        />
      )}
      <GameCanvas session={session} gameData={gameData} />
      <MessageDisplay message={messageDispaly} />
      {gameData && session !== "" && (
        <Footer
          isConnected={isConnected}
          session={session}
          clientsInRoom={clientsInRoom}
          gameData={gameData}
          showNextGameButton={showNextGameButton}
          setClientsInRoom={setClientsInRoom}
          setSession={setSession}
        />
      )}
      <TopFixedChips session={session} />
    </div>
  );
}
