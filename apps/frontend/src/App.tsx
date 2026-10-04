import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { socket } from "./socket";
const GameCanvas = lazy(() => import("./components/GameCanvas"));
import { Footer } from "./components/Footer";
import { SessionManager } from "./components/SessionManager";
import MessageDisplay from "./components/MessageDisplay";
import TopFixedChips from "./components/TopFixedChips";
import TurnCue from "./components/TurnCue";
import ErrorBoundary from "./components/ErrorBoundary";
import { GameInteractionContext, sameAction } from "./gameInteraction";
import { errorMessage, responseMessage, sessionCommand } from "./sessionCommands";
import type { ActionRequest, GameAction, GameView, SessionView } from "./types/gameProtocol";

export default function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [sessionId, setSessionId] = useState("");
  const [sessionState, setSessionState] = useState<SessionView | null>(null);
  const [gameData, setGameData] = useState<GameView | null>(null);
  const [message, setMessage] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [focusPlayerId, setFocusPlayerId] = useState("");
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const disconnectedSinceConnect = useRef(false);
  const actionLock = useRef(false);

  function showMessage(value: string) {
    clearTimeout(messageTimer.current);
    setMessage(value);
    messageTimer.current = setTimeout(() => setMessage(""), 5000);
  }

  function clearSession() {
    setSessionId("");
    setSessionState(null);
    setGameData(null);
    setFocusPlayerId("");
    setLobbyOpen(false);
    setFocusedSlotId(null);
    setActionPending(false);
    actionLock.current = false;
  }

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
      if (disconnectedSinceConnect.current) {
        clearSession();
        showMessage("Verbindung wiederhergestellt. Bitte tritt deiner Session erneut bei.");
        disconnectedSinceConnect.current = false;
      }
    }
    function onDisconnect() {
      disconnectedSinceConnect.current = true;
      setIsConnected(false);
      setActionPending(false);
      actionLock.current = false;
    }
    function onSessionState(state: SessionView) {
      setSessionState(state);
      setSessionId(state.sessionId);
    }
    function onGameUpdate(view: GameView | null) {
      setGameData(view);
      if (!view || view.phase !== "game ended") setLobbyOpen(false);
      if (view) setFocusPlayerId((current) =>
        view.players.some((player) => player.id === current)
          ? current : view.ownPlayerId || view.players[0]?.id || "");
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message", showMessage);
    socket.on("session-state", onSessionState);
    socket.on("game-update", onGameUpdate);
    setIsConnected(socket.connected);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message", showMessage);
      socket.off("session-state", onSessionState);
      socket.off("game-update", onGameUpdate);
      clearTimeout(messageTimer.current);
    };
  }, []);

  async function sendAction(action: GameAction) {
    if (!isConnected || actionLock.current || !gameData?.decisionId ||
        !gameData.legalActions.some((legal) => sameAction(legal, action))) return;
    actionLock.current = true;
    setActionPending(true);
    const request: ActionRequest = {
      sessionId, matchId: gameData.matchId,
      requestId: typeof crypto.randomUUID === "function" ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join("-"),
      decisionId: gameData.decisionId, action,
    };
    try {
      const code = await sessionCommand("game-action", request);
      if (code !== "success") showMessage(responseMessage(code));
    } catch (error) {
      showMessage(errorMessage(error));
    } finally {
      actionLock.current = false;
      setActionPending(false);
    }
  }

  return (
    <div className={`skylo-app ${gameData && !lobbyOpen ? "in-game" : "in-lobby"}`}>
      {!isConnected && <p role="status" className="connection-banner">Verbindung zum Spielserver unterbrochen. Aktionen sind vorübergehend gesperrt.</p>}
      {(!gameData || lobbyOpen) && <SessionManager isConnected={isConnected} sessionId={sessionId}
        state={sessionState} onJoined={setSessionId} onLeft={clearSession} />}
      {lobbyOpen && gameData && <button className="text-button last-match-button" onClick={() => setLobbyOpen(false)}>Letzte Partie anzeigen</button>}
      <GameInteractionContext.Provider value={{
        legalActions: gameData?.legalActions || [], enabled: isConnected && !actionPending,
        sendAction,
      }}>
        {gameData && !lobbyOpen && <>
          <main className="game-stage" aria-label="3D-Spieltisch">
            <ErrorBoundary canLeaveSession><Suspense fallback={<p role="status" className="scene-loading">Dein Spieltisch wird vorbereitet …</p>}>
              <GameCanvas gameData={gameData} focusPlayerId={focusPlayerId} focusedSlotId={focusedSlotId} />
            </Suspense></ErrorBoundary>
            <TurnCue gameData={gameData} connected={isConnected} />
          </main>
          <Footer isConnected={isConnected} sessionId={sessionId} state={sessionState}
            gameData={gameData} focusPlayerId={focusPlayerId} onFocus={setFocusPlayerId}
            onLeft={clearSession} onMessage={showMessage} onLobby={() => setLobbyOpen(true)} onFocusCard={setFocusedSlotId} />
        </>}
      </GameInteractionContext.Provider>
      <MessageDisplay message={message} />
      <TopFixedChips key={sessionId} session={sessionId} isConnected={isConnected}
        playerCount={sessionState?.participants.length || 0} hostId={sessionState?.hostId || ""}
        ownParticipantId={sessionState?.ownParticipantId || ""} />
    </div>
  );
}
