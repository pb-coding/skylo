import { FC, useCallback, useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash } from "@phosphor-icons/react";
import { socket } from "../socket";

const VoiceChat: FC<{ session: string; isConnected: boolean; playerCount: number; hostId: string }> = ({ session, isConnected, playerCount, hostId }) => {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const peer = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const lastAcceptedOffer = useRef("");

  const stop = useCallback(() => {
    generation.current += 1;
    peer.current?.close();
    peer.current = null;
    candidates.current = [];
    makingOffer.current = false;
    ignoreOffer.current = false;
    lastAcceptedOffer.current = "";
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (audio.current) audio.current.srcObject = null;
    setEnabled(false);
  }, []);

  useEffect(() => {
    async function flushCandidates(current: RTCPeerConnection) {
      const waiting = candidates.current.splice(0);
      for (const candidate of waiting) {
        try { await current.addIceCandidate(candidate); }
        catch (failure) { if (!ignoreOffer.current) throw failure; }
      }
    }
    async function onOffer(offer: RTCSessionDescriptionInit) {
      const current = peer.current;
      if (!current || !stream.current || !isConnected) return;
      const offerGeneration = generation.current;
      const stillCurrent = () => peer.current === current && generation.current === offerGeneration;
      try {
        const collision = makingOffer.current || current.signalingState !== "stable";
        const polite = socket.id !== hostId;
        ignoreOffer.current = !polite && collision;
        if (ignoreOffer.current) {
          // The guest may have enabled its microphone after our first offer.
          // Resend the existing offer so the polite guest can answer it now.
          if (stillCurrent() && current.localDescription?.type === "offer") {
            socket.emit("create-offer", { offerDescription: current.localDescription.toJSON(), sessionName: session });
          }
          return;
        }
        const offerIdentity = offer.sdp?.match(/^o=(.*)$/m)?.[1] || offer.sdp || "";
        if (offerIdentity && lastAcceptedOffer.current === offerIdentity) return;
        lastAcceptedOffer.current = offerIdentity;
        // setRemoteDescription automatically rolls back the polite peer's offer.
        await current.setRemoteDescription(offer);
        if (!stillCurrent()) return;
        await flushCandidates(current);
        if (!stillCurrent()) return;
        const answer = await current.createAnswer();
        if (!stillCurrent()) return;
        await current.setLocalDescription(answer);
        if (!stillCurrent()) return;
        socket.emit("answer-call", { answerDescription: answer, sessionName: session });
      } catch { if (stillCurrent()) setError("Die Sprachverbindung konnte nicht hergestellt werden."); }
    }
    async function onAnswer(answer: RTCSessionDescriptionInit) {
      const current = peer.current;
      if (!current || current.signalingState !== "have-local-offer") return;
      try { await current.setRemoteDescription(answer); await flushCandidates(current); }
      catch { setError("Die Sprachverbindung konnte nicht hergestellt werden."); }
    }
    async function onCandidate(candidate: RTCIceCandidateInit) {
      const current = peer.current;
      if (!current) return;
      if (!current.remoteDescription) { candidates.current.push(candidate); return; }
      try { await current.addIceCandidate(candidate); }
      catch { if (!ignoreOffer.current) setError("Die Sprachverbindung wurde unterbrochen."); }
    }
    socket.on("offer-made", onOffer);
    socket.on("answer-made", onAnswer);
    socket.on("add-ice-candidate", onCandidate);
    return () => {
      socket.off("offer-made", onOffer);
      socket.off("answer-made", onAnswer);
      socket.off("add-ice-candidate", onCandidate);
      stop();
    };
  }, [session, isConnected, hostId, stop]);

  useEffect(() => { if (playerCount > 2) stop(); }, [playerCount, stop]);

  async function toggle() {
    if (enabled) { stop(); return; }
    if (pending || !isConnected || playerCount > 2) return;
    setPending(true);
    setError("");
    const requestedGeneration = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
      const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (requestedGeneration !== generation.current) { local.getTracks().forEach((track) => track.stop()); return; }
      stream.current = local;
      const current = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      peer.current = current;
      current.onnegotiationneeded = async () => {
        try {
          makingOffer.current = true;
          await current.setLocalDescription();
          if (peer.current !== current || !current.localDescription) return;
          socket.emit("create-offer", { offerDescription: current.localDescription.toJSON(), sessionName: session });
        } catch {
          if (peer.current === current) setError("Die Sprachverbindung konnte nicht hergestellt werden.");
        } finally { makingOffer.current = false; }
      };
      local.getTracks().forEach((track) => current.addTrack(track, local));
      current.onicecandidate = (event) => {
        if (event.candidate) socket.emit("ice-candidate", { candidate: event.candidate.toJSON(), sessionName: session });
      };
      current.ontrack = (event) => {
        if (audio.current) { audio.current.srcObject = event.streams[0]; void audio.current.play().catch(() => setError("Bitte erlaube die Audiowiedergabe in deinem Browser.")); }
      };
      current.onconnectionstatechange = () => {
        if (current.connectionState === "failed") setError("Keine Sprachverbindung möglich. Schalte das Mikrofon aus und erneut ein.");
      };
      setEnabled(true);
    } catch (failure) {
      stop();
      setError(failure instanceof DOMException && failure.name === "NotAllowedError" ? "Mikrofonzugriff abgelehnt. Du kannst ohne Sprachchat weiterspielen." : "Mikrofon nicht verfügbar. Prüfe die Freigabe im Browser.");
    } finally { setPending(false); }
  }

  return <div className="voice-control">
    <audio ref={audio} autoPlay />
    <button className={`microphone-button ${enabled ? "enabled" : ""}`} onClick={toggle} disabled={!isConnected || pending || playerCount > 2} aria-pressed={enabled} aria-label={enabled ? "Mikrofon ausschalten" : "Mikrofon einschalten"} title={playerCount > 2 ? "Sprachchat aktuell für zwei Spieler verfügbar" : "Sprachchat für zwei Spieler"}>
      {enabled ? <Microphone size={26} weight="fill" /> : <MicrophoneSlash size={26} />}
    </button>
    {error && <div className="voice-error" role="status">{error}<button className="text-button" onClick={() => setError("")}>Schließen</button></div>}
  </div>;
};
export default VoiceChat;
