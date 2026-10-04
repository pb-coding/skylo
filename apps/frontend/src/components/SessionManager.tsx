import { Dispatch, FC, SetStateAction, useState } from "react";
import { ArrowRight, Plus, SignOut, UsersThree } from "@phosphor-icons/react";
import { socket } from "../socket";
import Button from "../global/Button";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";

type SessionManagerProps = {
  isConnected: boolean;
  clientsInRoom: number;
  setClientsInRoom: Dispatch<SetStateAction<number>>;
  session: string;
  setSession: Dispatch<SetStateAction<string>>;
  showStartGameButton: boolean;
};
type SessionResponse = "success" | "error:full" | "error:running" | "error:invalid" | "error:joined";
const joinErrors = {
  "error:full": "Dieser Raum ist voll.",
  "error:running": "In diesem Raum läuft bereits eine Partie.",
  "error:invalid": "Bitte gib einen gültigen Raumcode ein (maximal 40 Zeichen).",
  "error:joined": "Verlasse zunächst deinen aktuellen Raum.",
};

export const SessionManager: FC<SessionManagerProps> = ({ isConnected, clientsInRoom, setClientsInRoom, session, setSession, showStartGameButton }) => {
  const [sessionField, setSessionField] = useState(() => new URLSearchParams(window.location.search).get("room") || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"create" | "join">(new URLSearchParams(window.location.search).has("room") ? "join" : "create");

  function enterRoom(requestedSession: string) {
    if (!isConnected || pending) return;
    setPending(true);
    setError("");
    socket.timeout(8000).emit("join-session", requestedSession, (timeout: Error | null, response: SessionResponse) => {
      setPending(false);
      if (timeout) return setError("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response !== "success") return setError(joinErrors[response] || "Beitritt fehlgeschlagen.");
      setSession(requestedSession);
    });
  }

  function joinSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    enterRoom(sessionField.trim());
  }

  function leaveSession() {
    if (!isConnected) {
      setClientsInRoom(0);
      setSession("");
      return;
    }
    if (pending) return;
    setPending(true);
    setError("");
    socket.timeout(8000).emit("leave-session", session, (timeout: Error | null, response: string) => {
      setPending(false);
      if (timeout || response !== "success") return setError("Der Raum konnte nicht verlassen werden. Bitte versuche es erneut.");
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
      if (response !== "success") setError("Die Partie konnte nicht gestartet werden. Nur der Gastgeber kann mit mindestens zwei Spielern starten.");
    });
  }

  return (
    <main className="lobby">
      <div className="lobby-intro">
        <div className="wordmark">SKYLO<span className="brand-dot" /></div>
        <p className="eyebrow">Ein Tisch. Deine Freunde. Wenige Punkte.</p>
        <h1>Ein guter Abend<br />beginnt mit einer Runde.</h1>
        <p className="lobby-description">Ziehe, tausche und decke deine Karten auf. Wer am Ende die wenigsten Punkte hat, gewinnt.</p>
      </div>
      <section className="lobby-panel" aria-label={session ? "Dein Spielraum" : "Spielraum auswählen"}>
        {session ? <>
          <span className="eyebrow">Dein Spielraum</span>
          <h2>Alle an den Tisch.</h2>
          <p className="room-code">{session}</p>
          <p className="muted">Teile den Einladungslink oben rechts mit deinen Freunden.</p>
          <div className="waiting-players" aria-live="polite">
            <UsersThree size={26} weight="duotone" />
            <span>{clientsInRoom} von 8 Spielern am Tisch</span>
          </div>
          <div className="waiting-avatars" aria-hidden="true">
            {Array.from({ length: clientsInRoom }, (_, index) => <img key={index} src={`/avatars/player-${index % 2 ? "b" : "a"}.png`} alt="" />)}
          </div>
          {showStartGameButton ? <Button disabled={!isConnected || pending} onClick={startGame}>Partie starten <ArrowRight size={20} /></Button> : <p className="waiting-note" role="status">{clientsInRoom < 2 ? "Sobald ihr zu zweit seid, kann es losgehen." : "Der Gastgeber startet die Partie."}</p>}
          <button className="text-button lobby-leave" onClick={leaveSession} disabled={pending}><SignOut size={18} /> Raum verlassen</button>
        </> : <>
          <span className="eyebrow">Gemeinsam spielen</span>
          <h2>Platz für deine Runde.</h2>
          <div className="lobby-tabs" aria-label="Spielraum auswählen">
            <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Raum erstellen</button>
            <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Raum beitreten</button>
          </div>
          {mode === "create" ? <>
            <p className="muted">Erstelle einen privaten Tisch und lade bis zu sieben Freunde ein. Ohne Anmeldung.</p>
            <Button disabled={!isConnected || pending} onClick={() => enterRoom(crypto.randomUUID().slice(0, 8).toUpperCase())}><Plus size={20} /> {pending ? "Raum wird erstellt …" : "Neuen Raum erstellen"}</Button>
          </> : <form onSubmit={joinSession}>
            <label htmlFor="session-name">Raumcode</label>
            <input id="session-name" maxLength={40} value={sessionField} disabled={!isConnected || pending} placeholder="z. B. 7FA3B821" required onChange={(event) => setSessionField(event.target.value)} autoComplete="off" spellCheck={false} />
            <Button disabled={!isConnected || pending}>{pending ? "Bitte warten …" : "An den Tisch"} <ArrowRight size={20} /></Button>
          </form>}
        </>}
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="connection-status">{isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}<span>{isConnected ? "Mit dem Spielserver verbunden" : "Verbindung wird hergestellt …"}</span></div>
      </section>
      <p className="lobby-credit">Inspiriert vom Kartenspiel Skyjo. <a href="https://www.magilano.com/produkt/skyjo/" target="_blank" rel="noreferrer">Das Original entdecken <ArrowRight size={14} /></a></p>
    </main>
  );
};
