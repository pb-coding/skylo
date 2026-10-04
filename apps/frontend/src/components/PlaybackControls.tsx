import { useEffect, useRef, useState } from "react";
import Button from "../global/Button";
import { errorMessage, responseMessage, sessionCommand } from "../sessionCommands";
import type { PlaybackCommand, PlaybackState } from "../types/gameProtocol";

type Props = { sessionId: string; playback: PlaybackState; isConnected: boolean; canControl: boolean; ended: boolean; hasBots: boolean; onMessage: (message: string) => void };

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

  return <section aria-label="Automatische Spielaktionen" className="rounded-lg border border-teal-400/60 bg-teal-950/40 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h2 className="text-xl font-bold">Bot-Tempo</h2>
      <p role="status">{ended ? "Partie beendet" : playback.paused ? playback.stepping ? "Einzelschritt läuft" : "Pausiert" : playback.thinking ? "Bot überlegt …" : "Automatische Aktionen laufen"}</p>
    </div>
    <div className="flex flex-wrap gap-3 items-center mb-3">
      <label htmlFor="bot-tempo" className="font-bold">Tempo</label>
      <span className="text-sm">Langsam</span>
      <input id="bot-tempo" type="range" min={0} max={5000} step={100} value={5000 - delay}
        disabled={disabled} className="flex-1 min-w-32 accent-yellow-400"
        aria-valuetext={delay === 0 ? "Maximales Tempo, keine Pause zwischen Aktionen" : `${(delay / 1000).toLocaleString("de-DE")} Sekunden zwischen Aktionen`}
        onChange={(event) => changeDelay(5000 - Number(event.target.value))} />
      <span className="text-sm">Schnell</span>
      <output htmlFor="bot-tempo" className="min-w-40">{delay === 0 ? "Keine künstliche Pause" : `${(delay / 1000).toLocaleString("de-DE")} s zwischen Aktionen`}</output>
    </div>
    {canControl && <div className="flex flex-wrap gap-y-2">
      <Button disabled={disabled || pending} onClick={() => {
        void command({ type: playback.paused ? "resume" : "pause" });
      }}>{playback.paused ? "Fortsetzen" : "Pause"}</Button>
      <Button disabled={disabled || pending || !playback.paused || !!playback.stepping} onClick={() => void command({ type: "step-action" })}>Nächste Aktion</Button>
      <Button disabled={disabled || pending || !playback.paused || !!playback.stepping} onClick={() => void command({ type: "step-turn" })}>Nächster Zug</Button>
      <Button disabled={disabled || pending || delay === 0} onClick={() => {
        clearTimeout(delayTimer.current);
        setDelay(0);
        void command({ type: "delay", delayMs: 0 });
      }}>Maximales Tempo</Button>
    </div>}
    <p className="text-sm mt-3">{canControl ? "Deine Einstellung gilt für die ganze Partie. Sie steuert die Pause zwischen Bot-Aktionen; Menschen spielen in ihrem eigenen Tempo." : "Der Gastgeber steuert das Tempo und die Pause für alle Zuschauer."}</p>
  </section>;
}
