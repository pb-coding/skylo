import { useState } from "react";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import Button from "../global/Button";
import CardFanAnimation from "./CardFanAnimation";
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
  const [sessionField, setSessionField] = useState("");
  const [name, setName] = useState("");
  const [joinRole, setJoinRole] = useState<ParticipantRole>("player");
  const [seed, setSeed] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const disabled = !isConnected || pending;
  const canConfigure = !!state?.canControl && !state.running;
  const allBots = !!state?.players.length && state.players.every((player) => player.kind === "bot");

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
    const requestedSession = sessionField.trim();
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
    <section className="min-h-screen bg-gradient-to-b from-theme-bg to-teal-600 px-4 py-8 sm:py-12 text-theme-font">
      <div className="relative mx-auto max-w-3xl text-center">
        <h1 className="drop-shadow-black mb-3 text-7xl font-extrabold tracking-tight text-white sm:text-8xl">SKYLO</h1>
        <p className="mb-7 text-xl font-bold">Spiele mit Freunden und Bots oder schau einer Partie zu.</p>
        {!sessionId ? (
          <form onSubmit={joinSession} className="mx-auto max-w-lg rounded-xl border border-teal-900 bg-teal-100 p-5 text-left shadow-lg">
            <label htmlFor="player-name" className="block font-bold mb-1">Dein Name</label>
            <input id="player-name" maxLength={32} value={name} disabled={disabled}
              className="field mb-4" placeholder="Spieler" onChange={(event) => setName(event.target.value)} />
            <label htmlFor="session-name" className="block font-bold mb-1">Sessionname</label>
            <input id="session-name" maxLength={40} value={sessionField} disabled={disabled}
              className="field mb-4" placeholder="Session erstellen oder beitreten" required
              onChange={(event) => setSessionField(event.target.value)} />
            <fieldset disabled={disabled} className="mb-5">
              <legend className="font-bold mb-2">Wie möchtest du beitreten?</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2"><input type="radio" name="join-role" value="player" checked={joinRole === "player"}
                  onChange={() => setJoinRole("player")} /> Mitspielen</label>
                <label className="flex items-center gap-2"><input type="radio" name="join-role" value="spectator" checked={joinRole === "spectator"}
                  onChange={() => setJoinRole("spectator")} /> Zuschauen</label>
              </div>
            </fieldset>
            <Button disabled={disabled}>{pending ? "Bitte warten …" : "Session beitreten"}</Button>
            <p className="text-sm mt-3">Ein neuer Sessionname eröffnet eine Lobby. Als Zuschauer kannst du auch einer laufenden Partie beitreten.</p>
          </form>
        ) : (
          <div className="rounded-xl border border-teal-900 bg-teal-100 p-5 text-left shadow-lg">
            <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
              <div><h2 className="text-2xl font-bold break-all">Session: {sessionId}</h2>
                <p>Du bist {state?.role === "spectator" ? "Zuschauer" : "Spieler"}{state?.canControl ? " und Gastgeber" : ""}.</p></div>
              <Button variant="secondary" disabled={pending} onClick={leaveSession}>Session verlassen</Button>
            </div>
            {state ? <>
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span>{state.players.length}/{state.maxPlayers} Spieler</span>
                <span>{state.participants.filter((participant) => participant.role === "spectator").length} Zuschauer</span>
                <Button disabled={disabled || state.running || (state.role === "spectator" && state.players.length >= state.maxPlayers)}
                  onClick={() => void command("set-role", { sessionId, role: state.role === "player" ? "spectator" : "player" })}>
                  {state.role === "player" ? "Zum Zuschauer wechseln" : "Mitspielen"}
                </Button>
              </div>
              <ul className="space-y-3 mb-5">
                {state.players.map((player) => <li key={player.id} className="rounded-lg bg-white/60 p-3">
                  <div className="flex flex-wrap gap-2 items-center justify-between">
                    <span className="font-bold break-all">{player.name} {player.id === state.ownPlayerId ? "(du)" : ""}
                      <span className="font-normal ml-2">{player.kind === "bot" ? "Bot" : "Mensch"}</span></span>
                    {player.kind === "bot" && player.botConfig && <div className="flex flex-wrap gap-2 items-center">
                      <select aria-label={`Strategie für ${player.name}`} className="field compact-field" value={player.botConfig.strategyId}
                        disabled={disabled || !canConfigure} onChange={(event) => updateBot(player.id, { ...player.botConfig!, strategyId: event.target.value })}>
                        <option value="rules">Regel-KI</option><option value="random">Zufallsbot</option>
                      </select>
                      <select aria-label={`Schwierigkeit für ${player.name}`} className="field compact-field" value={player.botConfig.difficulty}
                        disabled={disabled || !canConfigure || player.botConfig.strategyId === "random"}
                        onChange={(event) => updateBot(player.id, { ...player.botConfig!, difficulty: event.target.value as Difficulty })}>
                        {Object.entries(difficultyNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {canConfigure && <Button variant="secondary" disabled={disabled}
                        onClick={() => void command("remove-bot", { sessionId, playerId: player.id })}>Entfernen</Button>}
                    </div>}
                  </div>
                </li>)}
              </ul>
              {state.players.length === 0 && <p className="mb-4">Füge als Gastgeber mindestens zwei Bots hinzu, um ihnen beim Spielen zuzuschauen.</p>}
              {canConfigure && <div className="flex flex-wrap gap-3 mb-5">
                <Button disabled={disabled || state.players.length >= state.maxPlayers}
                  onClick={() => void command("add-bot", { sessionId, config: { strategyId: "rules", difficulty: "medium" } })}>Bot hinzufügen</Button>
                <Button disabled={disabled || state.players.length < 2}
                  onClick={() => void command("new-game", { sessionId, ...(allBots && seed.trim() ? { seed: seed.trim() } : {}) })}>Partie starten</Button>
              </div>}
              {canConfigure && allBots && <div className="max-w-lg mb-4">
                <label htmlFor="match-seed" className="block font-bold mb-1">Startwert für Vergleichspartien (optional)</label>
                <input id="match-seed" className="field" maxLength={80} value={seed} disabled={disabled}
                  placeholder="Leer lassen für eine neue Kartenverteilung" onChange={(event) => setSeed(event.target.value)} />
                <p className="text-sm mt-1">Derselbe Startwert und dieselben Bot-Einstellungen machen reine Bot-Partien reproduzierbar.</p>
              </div>}
              {!state.canControl && <p className="mb-4">Der Gastgeber konfiguriert die Bots und startet die Partie.</p>}
              {state.participants.some((participant) => participant.role === "spectator") && <p className="text-sm break-words">Zuschauer: {state.participants.filter((participant) => participant.role === "spectator").map((participant) => `${participant.name}${participant.id === state.hostId ? " (Gastgeber)" : ""}`).join(", ")}</p>}
            </> : <p role="status">Lobby wird geladen …</p>}
          </div>
        )}
        {error && <p role="alert" className="mt-4 p-3 text-white bg-teal-900 rounded-lg">{error}</p>}
        <div className="mt-5 flex justify-center items-center gap-2">Spielserver: {isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}</div>
        <p className="text-sm mt-5">Eine Hommage an Skyjo. Entdecke auch das Original von <a className="font-bold underline" href="https://www.magilano.com/produkt/skyjo/">Magilano</a>.</p>
        {!sessionId && <CardFanAnimation />}
      </div>
    </section>
  );
}
