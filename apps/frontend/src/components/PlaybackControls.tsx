import { useEffect, useRef, useState } from "react";
import Button from "../global/Button";
import { errorMessage, responseMessage, sessionCommand } from "../sessionCommands";
import type { PlaybackCommand, PlaybackState } from "../types/gameProtocol";

type Props = {
  sessionId: string;
  playback: PlaybackState;
  isConnected: boolean;
  canControl: boolean;
  ended: boolean;
  hasBots: boolean;
  onMessage: (message: string) => void;
};

export default function PlaybackControls({ sessionId, playback, isConnected, canControl, ended, hasBots, onMessage }: Props) {
  const [delay, setDelay] = useState(playback.delayMs);
  const [pending, setPending] = useState(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout>>();
  const disabled = !isConnected || !canControl || ended || !hasBots;
  useEffect(() => setDelay(playback.delayMs), [playback.delayMs]);
  useEffect(() => () => clearTimeout(delayTimer.current), []);
  useEffect(() => { if (disabled) clearTimeout(delayTimer.current); }, [disabled]);

  async function command(command: PlaybackCommand, lock = true) {
    if (disabled || (lock && pending)) return;
    if (lock) setPending(true);
    try {
      const code = await sessionCommand("playback-control", { sessionId, command });
      if (code !== "success") onMessage(responseMessage(code));
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      if (lock) setPending(false);
    }
  }

  function changeDelay(value: number) {
    setDelay(value);
    clearTimeout(delayTimer.current);
    delayTimer.current = setTimeout(() => void command({ type: "delay", delayMs: value }, false), 120);
  }

  return <section aria-label="Automatische Spielaktionen" className="playback-controls">
    <div className="playback-heading">
      <h2>Bot-Tempo</h2>
      <p role="status" className="playback-status">{ended ? "Partie beendet" : playback.paused
        ? playback.stepping ? "Einzelschritt läuft" : "Pausiert"
        : playback.thinking ? "Bot überlegt …" : "Automatische Aktionen laufen"}</p>
    </div>
    <label htmlFor="bot-tempo">Tempo</label>
    <div className="tempo-endpoints"><span>Langsam</span><span>Schnell</span></div>
    <input id="bot-tempo" type="range" min={0} max={5000} step={100} value={5000 - delay}
      disabled={disabled} className="tempo-slider"
      aria-valuetext={delay === 0 ? "Maximales Tempo, keine Pause zwischen Aktionen" : `${(delay / 1000).toLocaleString("de-DE")} Sekunden zwischen Aktionen`}
      onChange={(event) => changeDelay(5000 - Number(event.target.value))} />
    <output htmlFor="bot-tempo">{delay === 0 ? "Keine künstliche Pause" : `${(delay / 1000).toLocaleString("de-DE")} s zwischen Aktionen`}</output>
    {canControl && <div className="playback-actions">
      <Button disabled={disabled || pending} onClick={() => {
        void command({ type: playback.paused ? "resume" : "pause" });
      }}>{playback.paused ? "Fortsetzen" : "Pause"}</Button>
      <Button variant="secondary" disabled={disabled || pending || !playback.paused || !!playback.stepping}
        onClick={() => void command({ type: "step-action" })}>Nächste Aktion</Button>
      <Button variant="secondary" disabled={disabled || pending || !playback.paused || !!playback.stepping}
        onClick={() => void command({ type: "step-turn" })}>Nächster Zug</Button>
      <Button variant="secondary" disabled={disabled || pending || delay === 0} onClick={() => {
        clearTimeout(delayTimer.current);
        setDelay(0);
        void command({ type: "delay", delayMs: 0 });
      }}>Maximales Tempo</Button>
    </div>}
    <p className="playback-help">{canControl
      ? "Deine Einstellung gilt für die ganze Partie. Sie steuert die Pause zwischen Bot-Aktionen; Menschen spielen in ihrem eigenen Tempo."
      : "Der Gastgeber steuert das Tempo und die Pause für alle Zuschauer."}</p>
  </section>;
}
