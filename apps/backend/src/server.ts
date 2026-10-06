// thanks to https://github.com/Apollon77/meross-cloud for the Meross Cloud API

import express, { Request, Response } from "express";
import { Server } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import app from "./lib/app";
import * as path from "path";
import logger, { log } from "./middleware/logEvents";
import errorHandler from "./middleware/errorHandler";
import credentials from "./middleware/credentials";
import cors from "cors";
import corsOptions from "./config/corsOptions";
import cookieParser from "cookie-parser";
import rootRouter from "./routes/root";
import {
  handleJoinSession,
  handleLeaveSession,
  handleNewGame,
  handleDisconnect,
  isSessionMember,
  handleSetRole,
  handleBotChange,
  handleGameAction,
  handlePlayback,
  handleStopMatch,
  handleExportMatch,
} from "./game/events";
import dotenv from "dotenv";
import { acknowledge, isRecord, validDescription, validIceCandidate } from "./game/sessionValidation";
import { sessionRoom } from "./game/sessionRoom";
import { configureJev } from "./game/bots/configureJev";
import { configureML } from "./game/ml/configureML";

dotenv.config();
configureJev();
configureML();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "";
export const httpServer = new Server(app);
export const io = new SocketIOServer(httpServer, {
  maxHttpBufferSize: 65_536,
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket: Socket) => {
  // Bound repeated expensive/control events without affecting normal play or
  // a full group's ICE negotiation. Socket.IO also bounds individual messages.
  let windowStart = Date.now();
  let controls = 0;
  let signals = 0;
  let actionWindow = Date.now();
  let actions = 0;
  const allow = (signaling: boolean) => {
    if (Date.now() - windowStart >= 10_000) {
      windowStart = Date.now();
      controls = 0;
      signals = 0;
    }
    if (signaling) return ++signals <= 600;
    return ++controls <= 60;
  };
  const control = (handler: (payload: unknown, callback?: unknown) => void) =>
    (payload: unknown, callback?: unknown) => {
      if (!allow(false)) {
        acknowledge(callback, "error:invalid");
        return;
      }
      handler(payload, callback);
    };

  socket.on("join-session", control((sessionId, callback) => handleJoinSession(socket, sessionId, callback)));
  socket.on("leave-session", control((sessionId, callback) => handleLeaveSession(socket, sessionId, callback)));
  socket.on("new-game", control((gameDetails, callback) => handleNewGame(socket, gameDetails, callback)));
  socket.on("set-role", control((payload, callback) => handleSetRole(socket, payload, callback)));
  socket.on("add-bot", control((payload, callback) => handleBotChange(socket, payload, callback, "add")));
  socket.on("remove-bot", control((payload, callback) => handleBotChange(socket, payload, callback, "remove")));
  socket.on("update-bot", control((payload, callback) => handleBotChange(socket, payload, callback, "update")));
  socket.on("game-action", (payload, callback) => {
    if (Date.now() - actionWindow >= 10_000) { actionWindow = Date.now(); actions = 0; }
    if (++actions > 60) {
      if (actions === 61) acknowledge(callback, "error:rate-limited");
      return;
    }
    handleGameAction(socket, payload, callback);
  });
  socket.on("playback-control", control((payload, callback) => handlePlayback(socket, payload, callback)));
  socket.on("stop-match", control((payload, callback) => handleStopMatch(socket, payload, callback)));
  socket.on("export-match", control((payload, callback) => handleExportMatch(socket, payload, callback)));

  const signal = (outEvent: string, field: string, valid: (value: unknown) => boolean) =>
    (payload: unknown) => {
      if (!allow(true) || !isRecord(payload) || !isSessionMember(socket, payload.sessionName) || !valid(payload[field])) return;
      // A target is optional for the existing two-player frontend. A targeted
      // request may only address a different participant in the same session.
      if (payload.to !== undefined) {
        if (typeof payload.to !== "string" || payload.to.length > 64 || payload.to === socket.id) return;
        const target = io.sockets.sockets.get(payload.to);
        if (!target || !isSessionMember(target, payload.sessionName)) return;
        target.emit(outEvent, payload[field]);
      } else {
        socket.to(sessionRoom(payload.sessionName)).emit(outEvent, payload[field]);
      }
    };
  socket.on("create-offer", signal("offer-made", "offerDescription", value => validDescription(value, "offer")));
  socket.on("answer-call", signal("answer-made", "answerDescription", value => validDescription(value, "answer")));
  socket.on("ice-candidate", signal("add-ice-candidate", "candidate", validIceCandidate));
  socket.on("disconnect", () => handleDisconnect(socket));
});

// helps to debug reading envs
const environment = process.env.ENVIRONMENT ?? "can not read envs";
const PORT = process.env.PORT || 3001;

app.use(logger);

app.use(credentials);

app.use(cors(corsOptions));

app.use(express.json());

app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(cookieParser());

app.use("/", rootRouter);

app.all("*", (req: Request, res: Response) => {
  res.status(404).send("Not Found");
});

app.use(errorHandler);

export const startServer = (port: number | string = PORT, host?: string) => {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    const numericPort = typeof port === "string" ? Number(port) : port;
    if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65_535) {
      httpServer.off("error", onError);
      reject(new Error("PORT must be a valid TCP port"));
      return;
    }
    httpServer.listen(numericPort, host, () => {
      httpServer.off("error", onError);
      log("ExpressJS", `Server listening on ${port} - Environment: ${environment}`);
      resolve();
    });
  });
};

if (require.main === module) {
  void startServer().catch(error => {
    console.error("Server could not start", error);
    process.exitCode = 1;
  });
}
