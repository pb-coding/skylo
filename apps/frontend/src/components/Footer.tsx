import { Dispatch, FC, SetStateAction, useState } from "react";
import { SignOut, Trophy, CaretDown, ArrowRight } from "@phosphor-icons/react";
import { socket } from "../socket";
import Button from "../global/Button";
import { Game } from "../types/gameTypes";
import { getGameActions } from "../scene/gameActions";

type FooterProps = {
  isConnected: boolean;
  session: string;
  clientsInRoom: number;
  gameData: Game;
  showNextGameButton: boolean;
  showNewGameButton: boolean;
  setClientsInRoom: Dispatch<SetStateAction<number>>;
  setSession: Dispatch<SetStateAction<string>>;
  onFocusCard: (position: [number, number] | null) => void;
};

export const Footer: FC<FooterProps> = ({ isConnected, session, gameData, showNextGameButton, showNewGameButton, setClientsInRoom, setSession, onFocusCard }) => {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [scoresExpanded, setScoresExpanded] = useState(false);
  const actions = getGameActions(gameData, isConnected);
  const own = actions.ownPlayer;
  const ended = gameData.phase === "game ended";
  const sortedPlayers = [...gameData.players].sort((a, b) => Number(b.socketId === socket.id) - Number(a.socketId === socket.id));

  function request(event: string, payload: string | { sessionId: string } | [number, number], onSuccess?: () => void) {
    if (!isConnected || pending) return;
    setPending(true);
    setError("");
    socket.timeout(8000).emit(event, payload, (timeout: Error | null, response: string) => {
      setPending(false);
      if (timeout) return setError("Keine Antwort vom Server. Bitte versuche es erneut.");
      if (response !== "success") return setError("Diese Aktion ist gerade nicht möglich. Bitte prüfe den aktuellen Spielzug.");
      onSuccess?.();
    });
  }

  function leaveSession() {
    const clear = () => { setClientsInRoom(0); setSession(""); };
    if (!isConnected) { clear(); return; }
    request("leave-session", session, clear);
  }

  return <>
    <aside className={`player-rail ${scoresExpanded ? "scores-expanded" : ""}`} aria-label="Spieler und Punkte">
      <div className="rail-brand"><span className="wordmark">SKYLO</span><button className="mobile-score-toggle" onClick={() => setScoresExpanded(!scoresExpanded)} aria-expanded={scoresExpanded} aria-label="Punktestand anzeigen"><CaretDown size={20} /></button></div>
      <div className="players-list">
        {sortedPlayers.map((player) => {
          const originalIndex = gameData.players.indexOf(player);
          const mine = player.socketId === socket.id;
          const active = gameData.phase === "reveal two cards" ? player.knownCardPositions.flat().filter(Boolean).length < 2 : player.playersTurn && !ended;
          return <div className={`rail-player ${active ? "active" : ""}`} key={player.socketId} aria-current={active ? "true" : undefined}>
            <div className="avatar-wrap"><img className="player-avatar" src={`/avatars/player-${originalIndex % 2 ? "b" : "a"}.png`} alt="" />{active && <span className="turn-dot" />}</div>
            <div className="player-info"><p className="player-name">{mine ? "Du" : `Spieler ${originalIndex + 1}`} {ended && player.place === 1 && <Trophy size={18} weight="fill" aria-label="Gewonnen" />}</p><p className="player-score"><span>Runde:</span> {player.roundPoints}</p><p className="player-score"><span>Gesamt:</span> {player.totalPoints}</p><span className="sr-only">{active ? "Ist am Zug" : "Wartet"}</span></div>
          </div>;
        })}
      </div>
      <div className="rail-meta"><span>Raum {session}</span><span>Runde {gameData.round}</span></div>
    </aside>
    <div className="game-bottom-bar">
      <details className="keyboard-actions" onToggle={(event) => { if (!event.currentTarget.open) onFocusCard(null); }}>
        <summary>Karten bedienen <CaretDown size={16} /></summary>
        <div className="keyboard-panel">
          <p>Deine Karten · Tastatur & Touch</p>
          <div className="pile-actions">
            <button disabled={!actions.canDraw || pending} onClick={() => request("draw-from-card-stack", session)}>Karte ziehen</button>
            <button disabled={!actions.canDiscard || pending} onClick={() => request("click-discard-pile", session)}>{gameData.phase === "place card" ? "Gezogene Karte ablegen" : `Ablage nehmen (${gameData.discardPile[gameData.discardPile.length - 1] ?? "leer"})`}</button>
          </div>
          {own && <div className="accessible-card-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, own.deck.length)}, 1fr)` }}>
            {[0, 1, 2].map((row) => own.deck.map((column, columnIndex) => <button key={`${columnIndex}-${row}`} disabled={!actions.canSelectCard(columnIndex, row) || pending} onFocus={() => onFocusCard([columnIndex, row])} onBlur={() => onFocusCard(null)} onClick={() => request("click-card", [columnIndex, row])} aria-label={`Spalte ${columnIndex + 1}, Reihe ${row + 1}: ${own.knownCardPositions[columnIndex][row] ? `Wert ${column[row]}` : "verdeckt"}`}>{own.knownCardPositions[columnIndex][row] ? column[row] : "?"}</button>))}
          </div>}
          <p className="muted small">Nur erlaubte Aktionen sind freigegeben.</p>
        </div>
      </details>
      <div className="round-actions">{showNewGameButton && <Button disabled={!isConnected || pending} onClick={() => request("new-game", { sessionId: session })}>Neue Partie <ArrowRight size={18} /></Button>}{showNextGameButton && !ended && <Button disabled={!isConnected || pending} onClick={() => request("next-round", { sessionId: session })}>Nächste Runde <ArrowRight size={18} /></Button>}<button className="text-button leave-button" disabled={pending} onClick={leaveSession}><SignOut size={17} /> Sitzung verlassen</button></div>
    </div>
    {error && <div className="toast error-toast" role="alert">{error}<button className="text-button" onClick={() => setError("")}>Schließen</button></div>}
  </>;
};
