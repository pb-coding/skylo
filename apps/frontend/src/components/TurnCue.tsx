import { CaretDownIcon } from "@phosphor-icons/react";
import { Game } from "../types/gameTypes";
import { getGameActions } from "../scene/gameActions";
export default function TurnCue({ gameData, connected }: { gameData: Game; connected: boolean }) {
  const { ownPlayer } = getGameActions(gameData, connected);
  const initial = gameData.phase === "reveal two cards";
  const revealed = ownPlayer?.knownCardPositions.flat().filter(Boolean).length ?? 0;
  const mine = Boolean(ownPlayer?.playersTurn);
  const currentIndex = gameData.players.findIndex((player) => player.playersTurn);
  let title = mine ? "Du bist dran" : `Spieler ${currentIndex + 1} ist dran`;
  let instruction = "Warte auf den nächsten Spielzug.";
  if (!connected) { title = "Verbindung unterbrochen"; instruction = "Deine Aktionen sind vorübergehend gesperrt."; }
  else if (initial) { title = revealed < 2 ? "Los geht’s" : "Gleich geht’s weiter"; instruction = revealed < 2 ? `Decke ${2 - revealed} ${revealed === 1 ? "Karte" : "Karten"} auf` : "Die anderen decken ihre Karten auf."; }
  else if (gameData.phase === "new round") { title = "Runde abgeschlossen"; instruction = "Die Punkte sind gezählt. Bereit für die nächste Runde?"; }
  else if (gameData.phase === "game ended") {
    const winners = gameData.players.filter((player) => player.place === 1);
    const winnerNames = winners.map((player) => player.socketId === ownPlayer?.socketId ? "Du" : `Spieler ${gameData.players.indexOf(player) + 1}`);
    title = "Partie beendet";
    instruction = winnerNames.length === 1 ? `${winnerNames[0]} ${winnerNames[0] === "Du" ? "hast" : "hat"} gewonnen!` : winnerNames.length > 1 ? `${winnerNames.join(" und ")} teilen sich den Sieg!` : "Die Partie wurde beendet.";
  }
  else if (mine) {
    if (gameData.phase === "pick up card") instruction = "Ziehe eine Karte oder nimm die Ablage";
    if (gameData.phase === "place card") instruction = ownPlayer?.tookDispiledCard ? `Tausche die ${ownPlayer.cardCache} gegen eine deiner Karten` : `Tausche die ${ownPlayer?.cardCache} oder lege sie ab`;
    if (gameData.phase === "reveal card") instruction = "Decke eine deiner verdeckten Karten auf";
  }
  return <div className={`turn-cue ${initial || mine ? "your-turn" : ""}`} role="status" aria-live="polite"><strong>{title}</strong><span>{instruction}</span>{(initial && revealed < 2 || mine && gameData.phase === "pick up card") && connected && <CaretDownIcon className="cue-arrow" size={18} weight="fill" aria-hidden="true" />}</div>;
}
