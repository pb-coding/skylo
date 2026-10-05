import { useState, SyntheticEvent } from "react";
import { ArrowRight, CaretDown, DownloadSimple, SignOut, Trophy } from "@phosphor-icons/react";
import Button from "../global/Button";
import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import PlaybackControls from "./PlaybackControls";
import { useGameInteraction } from "../gameInteraction";
import { socket } from "../socket";
import { errorMessage, responseMessage, sessionCommand } from "../sessionCommands";
import type { Difficulty, GameAction, GamePhase, GameView, ResponseCode, SessionView } from "../types/gameProtocol";

type Props = {
  isConnected: boolean;
  sessionId: string;
  state: SessionView | null;
  gameData: GameView;
  focusPlayerId: string;
  onFocus: (playerId: string) => void;
  onLeft: () => void;
  onMessage: (message: string) => void;
  onLobby?: () => void;
  onFocusCard?: (slotId: string | null) => void;
};

const phases: Record<GamePhase, string> = {
  "reveal two cards": "Zwei Startkarten aufdecken",
  "pick up card": "Karte ziehen oder Ablage nehmen",
  "place card": "Karte tauschen oder abwerfen",
  "reveal card": "Eine Karte aufdecken",
  "new round": "Runde abgeschlossen",
  "game ended": "Partie beendet",
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

export function Footer({ isConnected, sessionId, state, gameData, focusPlayerId, onFocus, onLeft, onMessage, onLobby, onFocusCard }: Props) {
  const [pending, setPending] = useState(false);
  const [scoresExpanded, setScoresExpanded] = useState(false);
  const [showExplanation, setShowExplanation] = useState(true);
  const interaction = useGameInteraction();
  const ended = gameData.phase === "game ended";
  const hasBots = gameData.players.some((player) => player.kind === "bot");
  const focused = gameData.players.find((player) => player.id === focusPlayerId) ?? gameData.players[0];
  const focusedOwn = focused?.id === gameData.ownPlayerId;
  const active = gameData.players.find((player) => player.id === gameData.activePlayerId);
  const lastDecisionPlayer = gameData.players.find((player) => player.id === gameData.lastDecision?.playerId);
  const sortedPlayers = [...gameData.players].sort((a, b) => Number(b.id === gameData.ownPlayerId) - Number(a.id === gameData.ownPlayerId));
  const disabled = !isConnected || pending;

  function openPopup(event: SyntheticEvent<HTMLDetailsElement>) {
    const current = event.currentTarget;
    if (!current.open) { onFocusCard?.(null); return; }
    current.closest(".game-bottom-bar")?.querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((other) => { if (other !== current) other.open = false; });
  }

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

  function leaveSession() {
    if (!isConnected) onLeft();
    else void command("leave-session", sessionId, onLeft);
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

  return <>
    <aside className={`player-rail ${scoresExpanded ? "scores-expanded" : ""}`} aria-label="Spieler und Punkte">
      <div className="rail-brand">
        <span className="wordmark">SKYLO</span>
        <button className="mobile-score-toggle" onClick={() => setScoresExpanded(!scoresExpanded)}
          aria-expanded={scoresExpanded} aria-label="Punktestand anzeigen"><CaretDown size={20} /></button>
      </div>
      <div className="players-list">
        {sortedPlayers.map((player) => {
          const originalIndex = gameData.players.indexOf(player);
          const mine = player.id === gameData.ownPlayerId;
          const playersTurn = !ended && (gameData.phase === "reveal two cards"
            ? player.knownCardPositions.flat().filter(Boolean).length < 2
            : player.playersTurn);
          return <div className={`rail-player ${playersTurn ? "active" : ""}`} key={player.id}
            aria-current={playersTurn ? "true" : undefined}>
            <div className="avatar-wrap">
              <img className="player-avatar" src={`/avatars/player-${originalIndex % 2 ? "b" : "a"}.png`} alt="" />
              {playersTurn && <span className="turn-dot" />}
            </div>
            <div className="player-info">
              <p className="player-name" title={player.name}>{player.name}{mine ? " (du)" : ""}
                {ended && player.place === 1 && <Trophy size={18} weight="fill" aria-label="Gewonnen" />}</p>
              <p className="rail-player-kind">{player.kind === "bot"
                ? player.botConfig?.strategyId === "random" ? "Zufallsbot"
                  : player.botConfig?.strategyId === "rules" ? `Regel-KI · ${difficulties[player.botConfig.difficulty ?? "medium"]}`
                    : player.botConfig?.strategyId === "typesafe-jev-choice" ? "Jev · TypeSafe"
                    : `${player.botConfig?.strategyId ?? "Bot"}${player.botConfig ? ` · ${difficulties[player.botConfig.difficulty ?? "medium"]}` : ""}`
                : "Spieler"}</p>
              <p className="player-score"><span>Runde:</span> {player.roundPoints}</p>
              <p className="player-score"><span>Gesamt:</span> {player.totalPoints}</p>
              {gameData.lastDecision?.playerId === player.id && gameData.lastDecision.fallback &&
                <p className="rail-player-closed" role="status">Ersatzentscheidung · Regel-KI</p>}
              {player.closedRound && <p className="rail-player-closed">Runde beendet</p>}
              <span className="sr-only">{playersTurn ? "Ist am Zug" : "Wartet"}</span>
            </div>
          </div>;
        })}
      </div>
      <div className="rail-meta">
        <span>Raum {sessionId}</span><span>Runde {gameData.round}</span>
        <span>{isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
          {gameData.role === "spectator" ? " Zuschauer" : " Spieler"}{state?.canControl ? " · Gastgeber" : ""}</span>
      </div>
    </aside>

    <div className="game-bottom-bar">
      <div className="footer-controls">
        <details className="keyboard-actions" onToggle={openPopup}>
          <summary>{gameData.role === "spectator" ? "Ansicht" : "Karten bedienen"} <CaretDown size={16} /></summary>
          <div className="keyboard-panel">
            <p>{gameData.role === "spectator" ? "Karten ansehen" : "Tastatur & Touch"}</p>
            <p role="status" className="muted small">{phases[gameData.phase]}{active && !ended ? ` · ${active.name}` : ""}</p>
            <label className="camera-focus-field">Kamerafokus
              <select value={focused?.id ?? ""} onChange={(event) => { onFocusCard?.(null); onFocus(event.target.value); }}>
                {gameData.players.map((player) => <option key={player.id} value={player.id}>
                  {player.name}{player.id === gameData.ownPlayerId ? " (du)" : ""}
                </option>)}
              </select>
            </label>
            {!ended && gameData.role === "player" && <div className="pile-actions" aria-label="Verfügbare Spielaktionen">
              {interaction.legalActions.filter((action) => !("slotId" in action)).map((action) => <button key={action.type}
                disabled={!interaction.allows(action)} onClick={() => interaction.sendAction(action)}>{actionLabel(action)}</button>)}
            </div>}
            {focused && <>
              <p className="muted small">{focused.name}{focusedOwn ? " · Deine Karten" : ""}
                {focused.cardCache !== null ? ` · Gezogene Karte: ${focused.cardCache}` : ""}</p>
              <div className="accessible-card-grid" aria-label={`Karten von ${focused.name}`}
                style={{ gridTemplateColumns: `repeat(${Math.max(1, focused.deck.length)}, 1fr)` }}>
                {[0, 1, 2].map((row) => focused.deck.map((column, columnIndex) => {
                  const slotId = focused.slotIds[columnIndex][row];
                  const value = column[row];
                  const action = interaction.legalActions.find((candidate) => "slotId" in candidate && candidate.slotId === slotId);
                  const label = `Spalte ${columnIndex + 1}, Reihe ${row + 1}: ${value === null ? "verdeckt" : `Wert ${value}`}`;
                  return focusedOwn ? <button key={slotId} disabled={!action || !interaction.allows(action)}
                    onFocus={() => onFocusCard?.(slotId)} onBlur={() => onFocusCard?.(null)}
                    onClick={() => { if (action) interaction.sendAction(action); }}
                    aria-label={`${label}${action ? ` · ${actionLabel(action)}` : ""}`}>{value ?? "?"}</button>
                    : <span className="accessible-card-static" key={slotId} aria-label={label}>{value ?? "?"}</span>;
                }))}
              </div>
              {!focused.deck.length && <p className="muted small">Alle Spalten entfernt</p>}
            </>}
            <p className="muted small">{gameData.role === "spectator" ? "Verdeckte Karten bleiben verborgen."
              : interaction.legalActions.some((action) => "slotId" in action)
                ? `Wähle eine deiner Karten zum ${gameData.phase === "place card" ? "Tauschen" : "Aufdecken"}.`
                : !interaction.legalActions.length && !ended ? "Warte auf die anderen Spieler." : "Nur erlaubte Aktionen sind freigegeben."}</p>
            <p className="muted small">Ablage: {gameData.discardPile[gameData.discardPile.length - 1] ?? "leer"} · Nachziehstapel: {gameData.cardStack.cards.length} Karten</p>
            {hasBots && <div className="bot-explanation">
              <label><input type="checkbox" checked={showExplanation}
                onChange={(event) => setShowExplanation(event.target.checked)} /> Bot-Entscheidungen anzeigen</label>
              {showExplanation && gameData.lastDecision && <>
                <p aria-live="polite"><strong>{lastDecisionPlayer?.name || "Bot"}:</strong> {gameData.lastDecision.explanation}{gameData.lastDecision.fallback ? " (Ersatzentscheidung)" : ""}</p>
                {gameData.lastDecision.diagnostics?.source === "model" && <p className="muted small">
                  {gameData.lastDecision.diagnostics.model} · {(gameData.lastDecision.decisionMs / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} s · {gameData.lastDecision.diagnostics.inputTokens} Eingabetokens.
                  Die Antwortwahrscheinlichkeiten bewerten die Aktionsauswahl; sie sind keine Gewinnwahrscheinlichkeiten.
                </p>}
              </>}
            </div>}
          </div>
        </details>
        {hasBots && <details className="keyboard-actions footer-popup" onToggle={openPopup}>
          <summary>Bot-Tempo{gameData.playback.thinkingStrategyId === "typesafe-jev-choice" && gameData.playback.thinking ? " · Jev entscheidet …" : ""} <CaretDown size={16} /></summary>
          <div className="keyboard-panel">
            <PlaybackControls sessionId={sessionId} playback={gameData.playback} isConnected={isConnected}
              canControl={!!state?.canControl} ended={ended} hasBots onMessage={onMessage} />
          </div>
        </details>}
      </div>
      <div className="round-actions">
        <details className="keyboard-actions footer-popup footer-popup-right" onToggle={openPopup}>
          <summary>Partie <CaretDown size={16} /></summary>
          <div className="keyboard-panel match-actions-panel">
            <p>Session: {sessionId}</p>
            <p className="session-panel-meta">{isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
              {isConnected ? "Verbunden" : "Verbindung unterbrochen"} · {gameData.role === "spectator" ? "Zuschauer" : "Spieler"}{state?.canControl ? " · Gastgeber" : ""} · Runde {gameData.round}</p>
            {ended && gameData.endReason === "aborted" && <p className="muted small">Die Partie wurde beendet. Das Protokoll enthält den bisherigen Spielverlauf.</p>}
            {ended && state?.canControl && <>
              <Button disabled={disabled || state.players.length < 2} onClick={() => void command("new-game", { sessionId })}>Neue Partie <ArrowRight size={18} /></Button>
              <Button variant="secondary" disabled={disabled || !state.hasExport} onClick={downloadRecord}>
                Partieprotokoll herunterladen <DownloadSimple size={18} /></Button>
            </>}
            {ended && onLobby && <Button variant="secondary" disabled={disabled} onClick={onLobby}>Lobby öffnen</Button>}
            {!ended && state?.canControl && <Button variant="secondary" disabled={disabled}
              onClick={() => void command("stop-match", { sessionId })}>Partie beenden</Button>}
            <button className="text-button leave-button" disabled={pending} onClick={leaveSession}>
              <SignOut size={17} /> Session verlassen</button>
          </div>
        </details>
      </div>
    </div>
  </>;
}
