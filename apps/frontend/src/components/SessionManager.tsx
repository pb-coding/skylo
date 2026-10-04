import { Dispatch, FC, SetStateAction, useState } from "react";
import { socket } from "../socket";

import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import Button from "../global/Button";
import CardFanAnimation from "./CardFanAnimation";

type SessionManagerProps = {
  isConnected: boolean;
  clientsInRoom: number;
  setClientsInRoom: Dispatch<SetStateAction<number>>;
  session: string;
  setSession: Dispatch<SetStateAction<string>>;
  showStartGameButton: boolean;
};

type SessionResponse = "success" | "error:full" | "error:running" | "error:invalid" | "error:joined";

const joinErrors: Record<Exclude<SessionResponse, "success">, string> = {
  "error:full": "Diese Session ist bereits voll.",
  "error:running": "In dieser Session läuft bereits eine Partie.",
  "error:invalid": "Bitte gib einen gültigen Sessionnamen ein (maximal 40 Zeichen).",
  "error:joined": "Verlasse zunächst deine aktuelle Session.",
};

export const SessionManager: FC<SessionManagerProps> = ({
  isConnected,
  clientsInRoom,
  setClientsInRoom,
  session,
  setSession,
  showStartGameButton,
}) => {
  const [sessionField, setSessionField] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function joinSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isConnected || pending) return;
    setPending(true);
    setError("");
    const requestedSession = sessionField.trim();
    socket.timeout(8000).emit("join-session", requestedSession, (timeout: Error | null, response: SessionResponse) => {
      setPending(false);
      if (timeout) return setError("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response !== "success") return setError(joinErrors[response] || "Beitritt fehlgeschlagen.");
      setSession(requestedSession);
      setSessionField("");
    });
  }

  function leaveSession(sessionName: string) {
    if (!isConnected) {
      setClientsInRoom(0);
      setSession("");
      return;
    }
    if (pending) return;
    setPending(true);
    setError("");
    socket.timeout(8000).emit("leave-session", sessionName, (timeout: Error | null, response: string) => {
      setPending(false);
      if (timeout) return setError("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response !== "success") return setError("Die Session konnte nicht verlassen werden. Bitte versuche es erneut.");
      setClientsInRoom(0);
      setSession("");
    });
  }

  function startGame() {
    if (!isConnected || pending) return;
    setPending(true);
    setError("");
    socket.timeout(8000).emit("new-game", { sessionId: session }, (timeout: Error | null, response: string) => {
      setPending(false);
      if (timeout) return setError("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response !== "success") setError("Die Partie konnte nicht gestartet werden. Nur der Gastgeber kann eine neue Partie mit mindestens zwei Spielern starten.");
    });
  }

  const isActiveSession = session !== "";

  return (
    <section>
      <div className="w-full h-full absolute top-0 left-0 z-0 bg-gradient-to-b from-theme-bg to-teal-500">
        <div className="py-8 px-4 mx-auto max-w-screen-xl text-center lg:py-16 z-10 relative">
          <h1 className="drop-shadow-black mb-4 text-7xl font-extrabold tracking-tight leading-none md:text-8xl lg:text-8xl text-white">
            SKYLO
          </h1>
          <p className="mb-8 text-lg font-bold lg:text-xl sm:px-16 lg:px-48 text-theme-primary">
            Play Skylo online with your friends!
          </p>
          <div className="p-4">
            {!isActiveSession && (
              <form onSubmit={joinSession}>
                <label
                  htmlFor="session-name"
                  className="block mb-2 text-md font-medium text-theme-font drop-shadow-white"
                >
                  Join Skylo Session
                </label>
                <div className="flex space-x-1 items-center">
                  <input
                    id="session-name"
                    maxLength={40}
                    value={sessionField}
                    disabled={!isConnected || pending}
                    className="border text-sm rounded-lg block w-full p-2.5 bg-theme-tertiary border-black placeholder-gray-400 text-theme-font focus:ring-theme-primary focus:border-theme-primary"
                    placeholder="Session name"
                    required
                    onChange={(e) => setSessionField(e.target.value)}
                  />
                  <Button disabled={!isConnected || pending}>{pending ? "Bitte warten …" : "Join"}</Button>
                </div>
              </form>
            )}
          </div>

          {error && <p role="alert" className="mb-4 p-3 text-white bg-teal-900 rounded-lg">{error}</p>}
          <div className="mx-4 py-4 bg-teal-200 border border-black rounded-lg">
            {isActiveSession && (
              <p className="text-theme-font text-3xl drop-shadow-white my-2">
                Session: {session}
              </p>
            )}
            <p className="text-theme-font text-3xl drop-shadow-white mt-4">
              Players: {clientsInRoom}
            </p>
            <br />
            {showStartGameButton && (
              <Button disabled={!isConnected || pending} onClick={startGame}>Start Game</Button>
            )}
            {isActiveSession && (
              <Button disabled={pending} variant="secondary" onClick={() => leaveSession(session)}>
                Leave Session
              </Button>
            )}
          </div>
          <div className="mt-4 flex justify-center items-center">
            <span className="text-theme-font drop-shadow-white">
              Game Server:{" "}
            </span>
            {isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
          </div>
          <div className="mt-4">
            <p className="font-bold text-xs text-theme-font drop-shadow-white">
              This is a tribute to the creator of my favorite game, Skyjo!
              Please purchase the game to discover the true gaming experience:
            </p>
            <a
              className="text-theme-primary text-sm font-extrabold"
              href="https://www.magilano.com/produkt/skyjo/"
            >
              Buy Skyjo here
            </a>
          </div>
          <CardFanAnimation />
        </div>
      </div>
    </section>
  );
};
