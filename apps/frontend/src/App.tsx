import { useState, useEffect, useRef } from "react";
import { socket } from "./socket";

import GameCanvas from "./components/GameCanvas";
import { Footer } from "./components/Footer";
import { SessionManager } from "./components/SessionManager";
import { Game } from "./types/gameTypes";
import MessageDisplay from "./components/MessageDisplay";
import TopFixedChips from "./components/TopFixedChips";

export default function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const disconnectedSinceConnect = useRef(false);
  const [hostId, setHostId] = useState("");
  const [session, setSession] = useState("");
  const [clientsInRoom, setClientsInRoom] = useState(0);
  const [gameData, setGameData] = useState<Game | null>(null);
  const [messageDispaly, setMessageDisplay] = useState<string>("");

  const showStartGameButton = isConnected && session !== "" && clientsInRoom >= 2 && hostId === socket.id;
  const showNextGameButton = gameData?.phase === "new round";

  function setTempMessage(message: string) {
    clearTimeout(messageTimer.current);
    setMessageDisplay(message);
    messageTimer.current = setTimeout(() => {
      setMessageDisplay("");
    }, 3000);
  }

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
      if (disconnectedSinceConnect.current) {
        // A new socket has no session membership until resume support exists.
        setSession("");
        setGameData(null);
        setClientsInRoom(0);
        setHostId("");
        setTempMessage("Verbindung wiederhergestellt. Bitte tritt einer Session erneut bei.");
        disconnectedSinceConnect.current = false;
      }
    }

    function onDisconnect() {
      disconnectedSinceConnect.current = true;
      setIsConnected(false);
      setHostId("");
    }

    function onClientsInRoomUpdate(clients: number) {
      setClientsInRoom(clients);
    }

    function onMessageEvent(message: string) {
      setTempMessage(message);
      // setMessageEvents((previous) => [...previous, message]);
    }

    function onSessionState(state: { sessionId: string; hostId: string; maxPlayers: number }) {
      setHostId(state.hostId);
    }

    function onGameUpdate(gameData: Game | null) {
      setGameData(gameData);
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message", onMessageEvent);
    socket.on("clients-in-session", onClientsInRoomUpdate);
    socket.on("game-update", onGameUpdate);
    socket.on("session-state", onSessionState);
    // The connection may have completed between rendering and subscribing.
    setIsConnected(socket.connected);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message", onMessageEvent);
      socket.off("clients-in-session", onClientsInRoomUpdate);
      socket.off("game-update", onGameUpdate);
      socket.off("session-state", onSessionState);
      clearTimeout(messageTimer.current);
    };
  }, []);

  useEffect(() => {
    if (session === "") setGameData(null);
  }, [session]);

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
      {!isConnected && <p role="status" className="relative z-30 bg-teal-950 text-white text-center p-2">Verbindung zum Spielserver unterbrochen. Aktionen sind vorübergehend gesperrt.</p>}
      <GameCanvas session={session} gameData={gameData} isConnected={isConnected} />
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
