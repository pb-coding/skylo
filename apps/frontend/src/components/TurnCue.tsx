import { CaretDownIcon } from "@phosphor-icons/react";
import type { GameView } from "../types/gameProtocol";

export default function TurnCue({ gameData, connected }: { gameData: GameView; connected: boolean }) {
  const own = gameData.players.find((player) => player.id === gameData.ownPlayerId);
  const active = gameData.players.find((player) => player.id === gameData.activePlayerId);
  const initial = gameData.phase === "reveal two cards";
  const revealed = own?.knownCardPositions.flat().filter(Boolean).length ?? 0;
  const canAct = connected && gameData.legalActions.length > 0;
  let title = canAct ? "Du bist dran" : active ? `${active.name} ist dran` : "Die Partie läuft";
  let instruction = "Warte auf den nächsten Spielzug.";
  if (!connected) { title = "Verbindung unterbrochen"; instruction = "Deine Aktionen sind vorübergehend gesperrt."; }
  else if (gameData.phase === "game ended") {
    const winners = gameData.players.filter((player) => player.place === 1);
    const names = winners.map((player) => player.id === own?.id ? "Du" : player.name);
    title = "Partie beendet";
    instruction = gameData.endReason === "aborted" ? "Die Partie wurde beendet. Der bisherige Verlauf steht im Protokoll."
      : names.length === 1 ? `${names[0]} ${names[0] === "Du" ? "hast" : "hat"} gewonnen!`
      : names.length > 1 ? `${names.join(" und ")} teilen sich den Sieg!` : "Die Partie wurde beendet.";
  } else if (gameData.phase === "new round") {
    title = "Runde abgeschlossen";
    instruction = gameData.players.every((player) => player.kind === "bot") ? "Die nächste Runde startet automatisch." : "Ein Spieler kann die nächste Runde starten.";
  } else if (initial) {
    if (own) { title = revealed < 2 ? "Los geht’s" : "Gleich geht’s weiter"; instruction = revealed < 2 ? `Decke ${2 - revealed} ${revealed === 1 ? "Karte" : "Karten"} auf` : "Die anderen decken ihre Karten auf."; }
    else { title = "Los geht’s"; instruction = "Die Spieler decken ihre Startkarten auf."; }
  } else if (canAct) {
    if (gameData.phase === "pick up card") instruction = "Ziehe eine Karte oder nimm die Ablage";
    if (gameData.phase === "place card") instruction = own?.tookDispiledCard ? `Tausche die ${own.cardCache} gegen eine deiner Karten` : `Tausche die ${own?.cardCache} oder lege sie ab`;
    if (gameData.phase === "reveal card") instruction = "Decke eine deiner verdeckten Karten auf";
  } else if (active) {
    if (gameData.phase === "pick up card") instruction = "Karte ziehen oder Ablage nehmen";
    if (gameData.phase === "place card") instruction = "Eine Karte tauschen oder abwerfen";
    if (gameData.phase === "reveal card") instruction = "Eine Karte aufdecken";
  }
  if (connected && gameData.playback.paused && gameData.phase !== "game ended") instruction += " · Bot-Aktionen pausiert";
  return <div className={`turn-cue ${canAct ? "your-turn" : ""}`} role="status" aria-live="polite"><strong>{title}</strong><span>{instruction}</span>{canAct && (initial || gameData.phase === "pick up card") && <CaretDownIcon className="cue-arrow" size={18} weight="fill" aria-hidden="true" />}</div>;
}
