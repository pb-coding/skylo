import { FC, useEffect, useRef, useState } from "react";
import { socket } from "../socket";

import HeadsetIcon from "../global/icons/HeadsetIcon";

type VoiceChatProps = {
  session: string;
};

const VoiceChat: FC<VoiceChatProps> = ({ session }) => {
  const servers = {
    iceServers: [
      {
        urls: [
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
        ],
      },
    ],
    iceCandidatePoolSize: 10,
  };

  const [isAudioEnabled, setIsAudioEnabled] = useState(false);

  // const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());

  const pc = useRef(new RTCPeerConnection(servers));
  const sessionRef = useRef<string>(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const setupAudio = async () => {
    localStreamRef.current = await navigator.mediaDevices.getUserMedia({
      video: false, // disabled video for now
      audio: true,
    });

    // only when using video the own video stream is displayed
    /*
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = localStreamRef.current;
    }
    */

    localStreamRef.current.getTracks().forEach((track) => {
      if (!localStreamRef.current) return;
      pc.current.addTrack(track, localStreamRef.current);
    });
  };

  const createOffer = async () => {
    const offerDescription = await pc.current.createOffer();
    await pc.current.setLocalDescription(offerDescription);
    console.log("session (create offer):", session);
    socket.emit("create-offer", { offerDescription, sessionName: session });
  };

  const answerCall = async (offer: RTCSessionDescriptionInit) => {
    console.log("Answer call triggered");

    await pc.current.setRemoteDescription(new RTCSessionDescription(offer));

    const answerDescription = await pc.current.createAnswer();
    await pc.current.setLocalDescription(answerDescription);

    console.log("session (answer call):", sessionRef.current);

    socket.emit("answer-call", {
      answerDescription,
      sessionName: sessionRef.current,
    });
  };

  useEffect(() => {
    // only when using video the own video stream is displayed
    /*
    if (localAudioRef.current && localStreamRef.current) {
      localAudioRef.current.srcObject = localStreamRef.current;
    }
    */

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }

    socket.on("offer-made", async (offer) => {
      console.log("Offer received:", offer);
      answerCall(offer);
    });

    socket.on("answer-made", async (answer) => {
      console.log("Answer received:", answer);
      await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      console.log("set remote description", pc.current);
    });

    socket.on("add-ice-candidate", (candidate) => {
      console.log("Ice candidate received:", candidate);
      pc.current.addIceCandidate(new RTCIceCandidate(candidate));
    });

    pc.current.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        console.log("Emit ICE-candidate:", candidate);
        socket.emit("ice-candidate", {
          candidate,
          sessionName: sessionRef.current,
        });
      }
    };

    pc.current.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStreamRef.current.addTrack(track);
      });
      console.log("remote stream", remoteStreamRef.current);
      if (remoteAudioRef.current) {
        console.log("setting remote video ref");
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
    };
  }, []);

  const enableAudio = async () => {
    if (!session || session === "") {
      console.log("You need to be in a session to start voice chat.");
      return;
    }
    await setupAudio();
    console.log("Audio enabled");
    await createOffer();
    console.log("Offer created");
  };

  const disableAudio = () => {
    pc.current.close();
    console.log("Audio disabled");
  };

  const toggleAudio = async () => {
    isAudioEnabled ? disableAudio() : enableAudio();
    setIsAudioEnabled((previous) => !previous);
  };

  return (
    <div>
      {/*<audio ref={localAudioRef} autoPlay muted></audio>*/}
      <audio ref={remoteAudioRef} autoPlay></audio>
      <button onClick={toggleAudio}>
        <HeadsetIcon enabled={isAudioEnabled} />
      </button>
    </div>
  );
};

export default VoiceChat;
