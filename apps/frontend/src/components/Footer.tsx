import { useState } from "react";
import Button from "../global/Button";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import PlaybackControls from "./PlaybackControls";
import { useGameInteraction } from "../gameInteraction";
import { socket } from "../socket";
import { errorMessage, responseMessage, sessionCommand } from "../sessionCommands";
import type { Difficulty, GameAction, GamePhase, GameView, ResponseCode, SessionView } from "../types/gameProtocol";

type Props = {
  isConnected: boolean; sessionId: string; state: SessionView | null; gameData: GameView;
  focusPlayerId: string; onFocus: (playerId: string) => void; onLeft: () => void;
  onMessage: (message: string) => void; onLobby?: () => void;
};
const phases: Record<GamePhase, string> = {
  "reveal two cards": "Zwei Startkarten aufdecken", "pick up card": "Karte ziehen oder Ablage nehmen",
  "place card": "Karte tauschen oder abwerfen", "reveal card": "Eine Karte aufdecken",
  "new round": "Runde abgeschlossen", "game ended": "Partie beendet",
};
const difficulties: Record<Difficulty, string> = { easy: "Leicht", medium: "Mittel", hard: "Schwer" };

function actionLabel(action: GameAction) {
  switch (action.type) {
    case "draw": return "Karte ziehen";
    case "take-discard": return "Ablagekarte nehmen";
    case "discard": return "Gezogene Karte abwerfen";
    case "next-round": return "Nächste Runde starten";
    case "place": return "Tauschen";
    case "reveal": return "Aufdecken";
  }
}

export function Footer({ isConnected, sessionId, state, gameData, focusPlayerId, onFocus, onLeft, onMessage, onLobby }: Props) {
  const [pending, setPending] = useState(false);
  const [showExplanation, setShowExplanation] = useState(true);
  const interaction = useGameInteraction();
  const ended = gameData.phase === "game ended";
  const active = gameData.players.find((player) => player.id === gameData.activePlayerId);
  const lastDecisionPlayer = gameData.players.find((player) => player.id === gameData.lastDecision?.playerId);
  const disabled = !isConnected || pending;

  async function command(event: string, payload: unknown, onSuccess?: () => void) {
    if (disabled) return;
    setPending(true);
    try {
      const code = await sessionCommand(event, payload);
      if (code === "success") onSuccess?.();
      else onMessage(responseMessage(code));
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function downloadRecord() {
    if (disabled || !state?.canControl || !state.hasExport) return;
    setPending(true);
    socket.timeout(8000).emit("export-match", { sessionId }, (timeout: Error | null, response: { code: ResponseCode; record?: unknown }) => {
      setPending(false);
      if (timeout) return onMessage("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response.code !== "success" || !response.record) return onMessage(responseMessage(response.code) || "Das Partieprotokoll ist noch nicht verfügbar.");
      const blob = new Blob([JSON.stringify(response.record, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `skylo-${gameData.matchId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return <div className="p-4 sm:p-6 text-white bg-gradient-to-b from-teal-700 to-teal-900 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold break-all">Session: {sessionId}</h1>
        <p className="flex items-center gap-2">{isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
          {gameData.role === "spectator" ? "Zuschauer" : "Spieler"}{state?.canControl ? " · Gastgeber" : ""} · Runde {gameData.round}</p>
      </div>
      <div className="flex flex-wrap gap-y-2">
        {ended && state?.canControl && <>
          <Button disabled={disabled || state.players.length < 2} onClick={() => void command("new-game", { sessionId })}>Neue Partie</Button>
          <Button disabled={disabled || !state.hasExport} onClick={downloadRecord}>Partieprotokoll herunterladen</Button>
        </>}
        {ended && onLobby && <Button disabled={disabled} onClick={onLobby}>Lobby öffnen</Button>}
        {!ended && state?.canControl && <Button variant="secondary" disabled={disabled}
          onClick={() => void command("stop-match", { sessionId })}>Partie beenden</Button>}
        <Button variant="secondary" disabled={pending} onClick={() => {
          if (!isConnected) onLeft();
          else void command("leave-session", sessionId, onLeft);
        }}>Session verlassen</Button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-xl font-bold">{phases[gameData.phase]}{active && !ended ? ` · ${active.name}` : ""}</p>
      <label className="flex flex-wrap gap-2 items-center">Kamerafokus
        <select className="field compact-field" value={focusPlayerId} onChange={(event) => onFocus(event.target.value)}>
          {gameData.players.map((player) => <option key={player.id} value={player.id}>{player.name}{player.id === gameData.ownPlayerId ? " (du)" : ""}</option>)}
        </select>
      </label>
    </div>
    {ended && gameData.endReason === "aborted" && <p>Die Partie wurde beendet. Das Protokoll enthält den bisherigen Spielverlauf.</p>}
    {!ended && gameData.role === "player" && <div className="flex flex-wrap gap-y-2" aria-label="Verfügbare Spielaktionen">
      {interaction.legalActions.filter((action) => !("slotId" in action)).map((action) => <Button key={action.type}
        disabled={!interaction.allows(action)} onClick={() => interaction.sendAction(action)}>{actionLabel(action)}</Button>)}
      {interaction.legalActions.some((action) => "slotId" in action) && <p>Wähle eine deiner Karten zum {gameData.phase === "place card" ? "Tauschen" : "Aufdecken"}.</p>}
      {!interaction.legalActions.length && <p>{gameData.phase === "new round" ? "Ein Spieler startet die nächste Runde." : "Warte auf die anderen Spieler."}</p>}
    </div>}
    {gameData.players.some((player) => player.kind === "bot") && <>
      <PlaybackControls sessionId={sessionId} playback={gameData.playback} isConnected={isConnected}
        canControl={!!state?.canControl} ended={ended} hasBots onMessage={onMessage} />
      <div className="rounded-lg bg-teal-950/30 p-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={showExplanation} onChange={(event) => setShowExplanation(event.target.checked)} /> Bot-Begründungen anzeigen</label>
        {showExplanation && gameData.lastDecision && <p className="mt-2" aria-live="polite"><strong>{lastDecisionPlayer?.name || "Bot"}:</strong> {gameData.lastDecision.explanation}{gameData.lastDecision.fallback ? " (Ersatzentscheidung)" : ""}</p>}
      </div>
    </>}
    <section aria-label="Spieler, Karten und Punkte" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {gameData.players.map((player) => <article key={player.id}
        className={`rounded-lg border p-4 ${player.playersTurn ? "border-yellow-400 bg-teal-800" : "border-teal-500 bg-teal-950/40"}`}>
        <h2 className="font-bold text-xl break-words">{player.playersTurn ? "▶ " : ""}{player.name}{player.id === gameData.ownPlayerId ? " (du)" : ""}{ended && player.place === 1 ? " 🏆" : ""}</h2>
        {player.botConfig && <p className="text-sm">{player.botConfig.strategyId === "random" ? "Zufallsbot" : `Regel-KI · ${difficulties[player.botConfig.difficulty]}`}</p>}
        <div className="flex flex-wrap justify-between gap-2 my-2"><p>Runde: <strong>{player.roundPoints}</strong></p><p>Gesamt: <strong>{player.totalPoints}</strong></p></div>
        {player.closedRound && <p className="text-sm mb-2">Hat die Runde beendet</p>}
        {player.cardCache !== null && <p className="mb-2">Gezogene Karte: <strong>{player.cardCache}</strong></p>}
        <div className="flex gap-2" aria-label={`Karten von ${player.name}`}>
          {player.deck.map((column, columnIndex) => <div className="grid gap-2" key={player.slotIds[columnIndex][0]}>
            {column.map((value, cardIndex) => {
              const slotId = player.slotIds[columnIndex][cardIndex];
              const action = interaction.legalActions.find((action) => "slotId" in action && action.slotId === slotId);
              const cardClass = `w-10 h-12 rounded border flex items-center justify-center font-bold ${value === null ? "bg-teal-700 border-teal-500" : "bg-teal-50 text-teal-950 border-white"}`;
              return action && player.id === gameData.ownPlayerId ? <button key={slotId}
                className={`${cardClass} hover:ring-2 hover:ring-yellow-400`} disabled={!interaction.allows(action)}
                aria-label={`Spalte ${columnIndex + 1}, Karte ${cardIndex + 1}: ${value === null ? "verdeckt" : value} · ${actionLabel(action)}`}
                onClick={() => interaction.sendAction(action)}>{value ?? "?"}</button>
                : <span key={slotId} className={cardClass} aria-label={`Spalte ${columnIndex + 1}, Karte ${cardIndex + 1}: ${value === null ? "verdeckt" : value}`}>{value ?? "?"}</span>;
            })}
          </div>)}
        </div>
        {!player.deck.length && <p>Alle Spalten entfernt</p>}
      </article>)}
    </section>
    <p className="text-sm">Verdeckte Karten bleiben für Zuschauer verborgen. Ablage: {gameData.discardPile[gameData.discardPile.length - 1] ?? "leer"} · Nachziehstapel: {gameData.cardStack.cards.length} Karten</p>
  </div>;
}
