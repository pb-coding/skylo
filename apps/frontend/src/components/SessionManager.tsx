import { Dispatch, FC, SetStateAction, useState } from "react";
import { socket } from "../socket";

import { ConnectedIndicator, DisconnectedIndicator } from "./Indicators";
import Button from "../global/Button";
import CardFanAnimation from "./CardFanAnimation";

type SessionManagerProps = {
  isConnected: boolean;
  clientsInRoom: number;
  setClientsInRoom: Dispatch<SetStateAction<number>>;
  session: string;
  setSession: Dispatch<SetStateAction<string>>;
  showStartGameButton: boolean;
};

type SessionResponse = "success" | "error:full" | "error:running";

export const SessionManager: FC<SessionManagerProps> = ({
  isConnected,
  clientsInRoom,
  setClientsInRoom,
  session,
  setSession,
  showStartGameButton,
}) => {
  const [sessionField, setSessionField] = useState("");

  function joinSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    socket.emit("join-session", sessionField, (response: SessionResponse) => {
      if (response !== "success") return;
      setSession(sessionField);
      setSessionField("");
    });
  }

  function leaveSession(sessionName: string) {
    socket.emit("leave-session", sessionName);
    setClientsInRoom(0);
    setSession("");
  }

  function startGame() {
    socket.emit("new-game", { sessionId: session });
  }

  const isActiveSession = session !== "";

  return (
    <section>
      <div className="w-full h-full absolute top-0 left-0 z-0 bg-gradient-to-b from-theme-bg to-teal-500">
        <div className="py-8 px-4 mx-auto max-w-screen-xl text-center lg:py-16 z-10 relative">
          <h1 className="drop-shadow-black mb-4 text-7xl font-extrabold tracking-tight leading-none md:text-8xl lg:text-8xl text-white">
            SKYLO
          </h1>
          <p className="mb-8 text-lg font-bold lg:text-xl sm:px-16 lg:px-48 text-theme-primary">
            Play Skylo online with your friends!
          </p>
          <div className="p-4">
            {!isActiveSession && (
              <form onSubmit={joinSession}>
                <label
                  htmlFor="first_name"
                  className="block mb-2 text-md font-medium text-theme-font drop-shadow-white"
                >
                  Join Skylo Session
                </label>
                <div className="flex space-x-1 items-center">
                  <input
                    className="border text-sm rounded-lg block w-full p-2.5 bg-theme-tertiary border-black placeholder-gray-400 text-theme-font focus:ring-theme-primary focus:border-theme-primary"
                    placeholder="Session name"
                    required
                    onChange={(e) => setSessionField(e.target.value)}
                  />
                  <Button>Join</Button>
                </div>
              </form>
            )}
          </div>

          <div className="mx-4 py-4 bg-teal-200 border border-black rounded-lg">
            {isActiveSession && (
              <p className="text-theme-font text-3xl drop-shadow-white my-2">
                Session: {session}
              </p>
            )}
            <p className="text-theme-font text-3xl drop-shadow-white mt-4">
              Players: {clientsInRoom}
            </p>
            <br />
            {showStartGameButton && (
              <Button onClick={startGame}>Start Game</Button>
            )}
            {isActiveSession && (
              <Button variant="secondary" onClick={() => leaveSession(session)}>
                Leave Session
              </Button>
            )}
          </div>
          <div className="mt-4 flex justify-center items-center">
            <span className="text-theme-font drop-shadow-white">
              Game Server:{" "}
            </span>
            {isConnected ? <ConnectedIndicator /> : <DisconnectedIndicator />}
          </div>
          <div className="mt-4">
            <p className="font-bold text-xs text-theme-font drop-shadow-white">
              This is a tribute to the creator of my favorite game, Skyjo!
              Please purchase the game to discover the true gaming experience:
            </p>
            <a
              className="text-theme-primary text-sm font-extrabold"
              href="https://www.magilano.com/produkt/skyjo/"
            >
              Buy Skyjo here
            </a>
          </div>
          <CardFanAnimation />
        </div>
      </div>
    </section>
  );
};
