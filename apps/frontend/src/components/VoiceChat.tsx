import { useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import HeadsetIcon from "../global/icons/HeadsetIcon";

const servers: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }],
  iceCandidatePoolSize: 10,
};

export default function VoiceChat({ session }: { session: string }) {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(session);
  const enabledRef = useRef(false);
  const mountedRef = useRef(false);
  sessionRef.current = session;

  function closeAudio() {
    enabledRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    remoteRef.current?.getTracks().forEach((track) => track.stop());
    remoteRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }

  function peer() {
    if (peerRef.current && peerRef.current.connectionState !== "closed") return peerRef.current;
    const connection = new RTCPeerConnection(servers);
    peerRef.current = connection;
    remoteRef.current = new MediaStream();
    if (audioRef.current) audioRef.current.srcObject = remoteRef.current;
    connection.onicecandidate = (event) => {
      if (event.candidate && enabledRef.current) socket.emit("ice-candidate", { candidate: event.candidate.toJSON(), sessionName: sessionRef.current });
    };
    connection.ontrack = (event) => remoteRef.current?.addTrack(event.track);
    localRef.current?.getTracks().forEach((track) => connection.addTrack(track, localRef.current!));
    return connection;
  }

  useEffect(() => {
    mountedRef.current = true;
    async function onOffer(offer: RTCSessionDescriptionInit) {
      if (!enabledRef.current) return;
      try {
        const connection = peer();
        if (connection.signalingState !== "stable") return;
        await connection.setRemoteDescription(offer);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit("answer-call", { answerDescription: answer, sessionName: sessionRef.current });
      } catch { if (mountedRef.current) setError("Die Sprachverbindung konnte nicht aufgebaut werden."); }
    }
    async function onAnswer(answer: RTCSessionDescriptionInit) {
      if (!enabledRef.current || peerRef.current?.signalingState !== "have-local-offer") return;
      try { await peerRef.current.setRemoteDescription(answer); }
      catch { if (mountedRef.current) setError("Die Sprachverbindung konnte nicht aufgebaut werden."); }
    }
    async function onCandidate(candidate: RTCIceCandidateInit) {
      if (!enabledRef.current || !peerRef.current?.remoteDescription) return;
      try { await peerRef.current.addIceCandidate(candidate); }
      catch { /* A candidate may arrive after the other participant left. */ }
    }
    function onDisconnect() { closeAudio(); setEnabled(false); }
    socket.on("offer-made", onOffer);
    socket.on("answer-made", onAnswer);
    socket.on("add-ice-candidate", onCandidate);
    socket.on("disconnect", onDisconnect);
    return () => {
      mountedRef.current = false;
      socket.off("offer-made", onOffer);
      socket.off("answer-made", onAnswer);
      socket.off("add-ice-candidate", onCandidate);
      socket.off("disconnect", onDisconnect);
      closeAudio();
    };
  }, []);

  async function toggleAudio() {
    if (pending) return;
    if (enabled) { closeAudio(); setEnabled(false); return; }
    if (!session || !socket.connected) return;
    setPending(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!mountedRef.current || !socket.connected) { stream.getTracks().forEach((track) => track.stop()); return; }
      localRef.current = stream;
      enabledRef.current = true;
      const connection = peer();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit("create-offer", { offerDescription: offer, sessionName: sessionRef.current });
      setEnabled(true);
    } catch {
      closeAudio();
      if (mountedRef.current) setError("Mikrofon nicht verfügbar. Bitte prüfe die Berechtigung im Browser.");
    } finally { if (mountedRef.current) setPending(false); }
  }

  return <div>
    <audio ref={audioRef} autoPlay />
    <button aria-label={enabled ? "Sprachchat ausschalten" : "Sprachchat einschalten"} aria-pressed={enabled}
      disabled={pending || !socket.connected} onClick={() => void toggleAudio()}>
      <HeadsetIcon enabled={enabled} />
    </button>
    {error && <span role="alert" className="absolute top-14 left-4 w-64 rounded bg-teal-950 p-3 text-white">{error}</span>}
  </div>;
}
