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
} from "./game/events";
import dotenv from "dotenv";

dotenv.config();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "";
const httpServer = new Server(app);
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket: Socket) => {
  console.log("A user connected:", socket.id);

  socket.on(
    "join-session",
    (sessionId: string, callback: Function | undefined) => {
      console.log(typeof callback);
      handleJoinSession(socket, sessionId, callback);
    }
  );

  socket.on("leave-session", (sessionId: string) => {
    // TODO: check if user is in that session before leaving
    handleLeaveSession(socket, sessionId);
  });

  socket.on("create-offer", (offerData) => {
    const { offerDescription, sessionName } = offerData;

    if (!sessionName || sessionName == "")
      return console.log("No session name provided");

    const clientsInRoom =
      io.sockets.adapter.rooms.get(sessionName) || new Set();
    clientsInRoom.forEach((clientId) => {
      if (clientId !== socket.id) {
        io.to(clientId).emit("offer-made", offerDescription);
      }
    });
  });

  socket.on("answer-call", (answerData) => {
    const { answerDescription, sessionName } = answerData;

    if (!sessionName || sessionName == "")
      return console.log("No session name provided");

    const clientsInRoom =
      io.sockets.adapter.rooms.get(sessionName) || new Set();
    clientsInRoom.forEach((clientId) => {
      if (clientId !== socket.id) {
        io.to(clientId).emit("answer-made", answerDescription);
      }
    });
  });

  socket.on("ice-candidate", (candidateData) => {
    const { candidate, sessionName } = candidateData;

    if (!sessionName || sessionName == "")
      return console.log("No session name provided");

    const clientsInRoom =
      io.sockets.adapter.rooms.get(sessionName) || new Set();
    clientsInRoom.forEach((clientId) => {
      if (clientId !== socket.id) {
        io.to(clientId).emit("add-ice-candidate", candidate);
      }
    });
  });

  socket.on("new-game", (gameDetails: { sessionId: string }) =>
    // TODO: get sessionId from socket instead of passing it from client
    handleNewGame(socket, gameDetails)
  );

  socket.on("disconnect", () => {
    handleDisconnect(socket);
  });
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

httpServer.listen(PORT, () => {
  log("ExpressJS", `Server listening on ${PORT} - Environment: ${environment}`);
});
