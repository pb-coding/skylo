import { useState } from "react";
import { ArrowRight, Plus, Robot, SignOut, UsersThree } from "@phosphor-icons/react";
import Button from "../global/Button";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import { errorMessage, responseMessage, sessionCommand } from "../sessionCommands";
import type { BotConfig, Difficulty, ParticipantRole, SessionView } from "../types/gameProtocol";

type Props = {
  isConnected: boolean;
  sessionId: string;
  state: SessionView | null;
  onJoined: (sessionId: string) => void;
  onLeft: () => void;
};

const difficultyNames: Record<Difficulty, string> = { easy: "Leicht", medium: "Mittel", hard: "Schwer" };

export function SessionManager({ isConnected, sessionId, state, onJoined, onLeft }: Props) {
  const [sessionField, setSessionField] = useState(() => new URLSearchParams(window.location.search).get("room") || "");
  const [mode, setMode] = useState<"create" | "join">(() => new URLSearchParams(window.location.search).has("room") ? "join" : "create");
  const [name, setName] = useState("");
  const [joinRole, setJoinRole] = useState<ParticipantRole>("player");
  const [seed, setSeed] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const disabled = !isConnected || pending;
  const canConfigure = !!state?.canControl && !state.running;
  const allBots = !!state?.players.length && state.players.every((player) => player.kind === "bot");
  const spectators = state?.participants.filter((participant) => participant.role === "spectator") || [];

  async function command(event: string, payload: unknown, onSuccess?: () => void) {
    if (disabled) return;
    setPending(true);
    setError("");
    try {
      const code = await sessionCommand(event, payload);
      if (code === "success") onSuccess?.();
      else setError(responseMessage(code));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function joinSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedSession = sessionField.trim() || (mode === "create" ? crypto.randomUUID().slice(0, 8).toUpperCase() : "");
    void command("join-session", { sessionId: requestedSession, role: joinRole, name: name.trim() || "Spieler" },
      () => { onJoined(requestedSession); setSessionField(""); });
  }

  function leaveSession() {
    if (!isConnected) onLeft();
    else void command("leave-session", sessionId, onLeft);
  }

  function updateBot(playerId: string, config: BotConfig) {
    void command("update-bot", { sessionId, playerId, config });
  }

  return (
    <main className={`lobby${sessionId ? " lobby-room" : ""}`}>
      <div className="lobby-intro">
        <div className="wordmark">SKYLO<span className="brand-dot" /></div>
        <p className="eyebrow">Ein Tisch. Freunde und Bots. Wenige Punkte.</p>
        <h1>Ein guter Abend<br />beginnt mit einer Runde.</h1>
        <p className="lobby-description">Ziehe, tausche und decke deine Karten auf. Wer am Ende die wenigsten Punkte hat, gewinnt. Spiele mit Freunden und Bots oder schau einer Partie zu.</p>
      </div>
      <section className="lobby-panel" aria-label={sessionId ? "Dein Spielraum" : "Spielraum auswählen"}>
        {sessionId ? <>
          <span className="eyebrow">Dein Spielraum</span>
          <h2>Alle an den Tisch.</h2>
          <p className="room-code">{sessionId}</p>
          <p className="muted">Teile den Einladungslink oben rechts mit deinen Freunden.</p>
          {state ? <>
            <div className="waiting-players" aria-live="polite">
              <UsersThree size={26} weight="duotone" />
              <span>{state.players.length} von {state.maxPlayers} Spielern am Tisch · {spectators.length} Zuschauer</span>
            </div>
            <div className="lobby-meta">
              <p className="muted">Du bist {state.role === "spectator" ? "Zuschauer" : "Spieler"}{state.canControl ? " und Gastgeber" : ""}.</p>
              <Button variant="secondary" disabled={disabled || state.running || (state.role === "spectator" && state.players.length >= state.maxPlayers)}
                onClick={() => void command("set-role", { sessionId, role: state.role === "player" ? "spectator" : "player" })}>
                {state.role === "player" ? "Zum Zuschauer wechseln" : "Mitspielen"}
              </Button>
            </div>
            <ul className="lobby-participants">
              {state.players.map((player, index) => <li key={player.id} className="lobby-player-row">
                <div className="lobby-player-identity">
                  {player.kind === "bot" ? <span className="lobby-player-avatar lobby-bot-avatar" aria-hidden="true"><Robot size={25} weight="duotone" /></span>
                    : <img className="lobby-player-avatar" src={`/avatars/player-${index % 2 ? "b" : "a"}.png`} alt="" />}
                  <div><span className="lobby-player-name">{player.name} {player.id === state.ownPlayerId ? "(du)" : ""}</span>
                    <span className="lobby-player-badge">{player.kind === "bot" ? "Bot" : "Mensch"}</span></div>
                </div>
                {player.kind === "bot" && player.botConfig && <div className="lobby-bot-controls">
                  <select aria-label={`Strategie für ${player.name}`} value={player.botConfig.strategyId}
                    disabled={disabled || !canConfigure} onChange={(event) => updateBot(player.id, { ...player.botConfig!, strategyId: event.target.value })}>
                    <option value="rules">Regel-KI</option><option value="random">Zufallsbot</option>
                  </select>
                  <select aria-label={`Schwierigkeit für ${player.name}`} value={player.botConfig.difficulty}
                    disabled={disabled || !canConfigure || player.botConfig.strategyId === "random"}
                    onChange={(event) => updateBot(player.id, { ...player.botConfig!, difficulty: event.target.value as Difficulty })}>
                    {Object.entries(difficultyNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {canConfigure && <button type="button" className="text-button" disabled={disabled}
                    onClick={() => void command("remove-bot", { sessionId, playerId: player.id })}>Entfernen</button>}
                </div>}
              </li>)}
            </ul>
            {state.players.length === 0 && <p className="waiting-note">Füge als Gastgeber mindestens zwei Bots hinzu, um ihnen beim Spielen zuzuschauen.</p>}
            {canConfigure && <>
              <div className="lobby-actions">
                <Button variant="secondary" disabled={disabled || state.players.length >= state.maxPlayers}
                  onClick={() => void command("add-bot", { sessionId, config: { strategyId: "rules", difficulty: "medium" } })}>Bot hinzufügen</Button>
                <Button disabled={disabled || state.players.length < 2}
                  onClick={() => void command("new-game", { sessionId, ...(allBots && seed.trim() ? { seed: seed.trim() } : {}) })}>Partie starten <ArrowRight size={20} /></Button>
              </div>
              {allBots && <div className="lobby-seed">
                <label htmlFor="match-seed">Startwert für Vergleichspartien (optional)</label>
                <input id="match-seed" maxLength={80} value={seed} disabled={disabled}
                  placeholder="Neue Kartenverteilung" onChange={(event) => setSeed(event.target.value)} />
                <p className="muted small">Derselbe Startwert und dieselben Bot-Einstellungen machen reine Bot-Partien reproduzierbar.</p>
              </div>}
            </>}
            {!state.canControl && <p className="waiting-note">Der Gastgeber konfiguriert die Bots und startet die Partie.</p>}
            {spectators.length > 0 && <p className="lobby-spectators muted small">Zuschauer: {spectators.map((participant) => `${participant.name}${participant.id === state.hostId ? " (Gastgeber)" : ""}`).join(", ")}</p>}
          </> : <p className="waiting-note" role="status">Lobby wird geladen …</p>}
          <button type="button" className="text-button lobby-leave" onClick={leaveSession} disabled={pending}><SignOut size={18} /> Session verlassen</button>
        </> : <>
          <span className="eyebrow">Gemeinsam spielen</span>
          <h2>Platz für deine Runde.</h2>
          <div className="lobby-tabs" aria-label="Spielraum auswählen">
            <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Raum erstellen</button>
            <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Raum beitreten</button>
          </div>
          <p className="muted">{mode === "create" ? "Erstelle einen privaten Tisch für bis zu acht Spieler. Wähle Mitspielen oder Zuschauen und füge später Freunde oder Bots hinzu." : "Gib den Raumcode ein, um mitzuspielen oder zuzuschauen. Als Zuschauer kannst du auch einer laufenden Partie beitreten."}</p>
          <form onSubmit={joinSession}>
            <div className="lobby-field">
              <label htmlFor="player-name">Dein Name</label>
              <input id="player-name" maxLength={32} value={name} disabled={disabled}
                placeholder="Spieler" autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="lobby-field">
              <label htmlFor="session-name">{mode === "create" ? "Eigener Raumcode (optional)" : "Raumcode"}</label>
              <input id="session-name" maxLength={40} value={sessionField} disabled={disabled}
                placeholder={mode === "create" ? "Leer lassen für einen neuen Raumcode" : "z. B. 7FA3B821"} required={mode === "join"}
                onChange={(event) => setSessionField(event.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            <fieldset disabled={disabled} className="lobby-roles">
              <legend>Wie möchtest du beitreten?</legend>
              <div className="lobby-role-options">
                <label><input type="radio" name="join-role" value="player" checked={joinRole === "player"}
                  onChange={() => setJoinRole("player")} /> Mitspielen</label>
                <label><input type="radio" name="join-role" value="spectator" checked={joinRole === "spectator"}
                  onChange={() => setJoinRole("spectator")} /> Zuschauen</label>
              </div>
            </fieldset>
            <Button disabled={disabled}>{mode === "create" && !sessionField.trim() ? <><Plus size={20} /> {pending ? "Raum wird erstellt …" : "Neuen Raum erstellen"}</> : <>{pending ? "Bitte warten …" : "Session beitreten"} <ArrowRight size={20} /></>}</Button>
          </form>
        </>}
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="connection-status">{isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}<span>{isConnected ? "Mit dem Spielserver verbunden" : "Verbindung wird hergestellt …"}</span></div>
      </section>
      <p className="lobby-credit">Inspiriert vom Kartenspiel Skyjo. <a href="https://www.magilano.com/produkt/skyjo/" target="_blank" rel="noreferrer">Das Original entdecken <ArrowRight size={14} /></a></p>
    </main>
  );
}
