import { Socket } from "socket.io";
import { io } from "../server";
import { Game, allGames } from "./game";
import { sessionRoom } from "./sessionRoom";
import { acknowledge, isRecord, isSessionId, SessionResponse } from "./sessionValidation";

export const MAX_PLAYERS = 8;
const MAX_SESSIONS = 1_000;
type Session = { members: Set<string>; hostId: string };
const sessions = new Map<string, Session>();

const reject = (socket: Socket, callback: unknown, response: SessionResponse, message: string) => {
  acknowledge(callback, response);
  socket.emit("message", message);
};

export const isSessionMember = (socket: Socket, sessionId: unknown): sessionId is string =>
  isSessionId(sessionId) && socket.data.sessionId === sessionId &&
  sessions.get(sessionId)?.members.has(socket.id) === true;

const broadcastSession = (sessionId: string, session: Session) => {
  io.to(sessionRoom(sessionId)).emit("clients-in-session", session.members.size);
  io.to(sessionRoom(sessionId)).emit("session-state", { sessionId, hostId: session.hostId, maxPlayers: MAX_PLAYERS });
};

export const handleJoinSession = (socket: Socket, sessionId: unknown, callback?: unknown) => {
  // Reject confusing active socket IDs as names; internal rooms additionally
  // use a separate namespace so future socket IDs cannot collide either.
  if (!isSessionId(sessionId) || io.sockets.sockets.has(sessionId)) {
    return reject(socket, callback, "error:invalid", "Bitte nutze einen Raumnamen mit 1–40 Buchstaben, Zahlen, Leerzeichen, Bindestrichen oder Unterstrichen.");
  }
  if (isSessionMember(socket, sessionId)) {
    acknowledge(callback, "success");
    const session = sessions.get(sessionId)!;
    socket.emit("clients-in-session", session.members.size);
    socket.emit("session-state", { sessionId, hostId: session.hostId, maxPlayers: MAX_PLAYERS });
    return;
  }
  if (socket.data.sessionId) {
    return reject(socket, callback, "error:joined", "Verlasse zuerst deinen aktuellen Raum.");
  }
  if (allGames.some(game => game.sessionId === sessionId)) {
    return reject(socket, callback, "error:running", "In diesem Raum läuft bereits eine Partie.");
  }
  let session = sessions.get(sessionId);
  if (session && session.members.size >= MAX_PLAYERS || !session && sessions.size >= MAX_SESSIONS) {
    return reject(socket, callback, "error:full", "Dieser Raum ist voll. Bitte wähle einen anderen Raum.");
  }
  if (!session) {
    session = { members: new Set(), hostId: socket.id };
    sessions.set(sessionId, session);
  }
  session.members.add(socket.id);
  socket.data.sessionId = sessionId;
  socket.join(sessionRoom(sessionId));
  acknowledge(callback, "success");
  broadcastSession(sessionId, session);
  for (const memberId of session.members) {
    if (memberId !== socket.id) io.to(memberId).emit("initiate-voice-chat", { to: socket.id });
  }
};

const removeMember = (socket: Socket, sessionId: string) => {
  const session = sessions.get(sessionId);
  delete socket.data.sessionId;
  socket.leave(sessionRoom(sessionId));
  if (!session) return;
  session.members.delete(socket.id);
  if (session.members.size === 0) sessions.delete(sessionId);
  else {
    if (session.hostId === socket.id) session.hostId = session.members.values().next().value!;
    broadcastSession(sessionId, session);
  }
  allGames.find(game => game.sessionId === sessionId)?.checkForPlayerLeave();
};

export const handleLeaveSession = (socket: Socket, sessionId: unknown, callback?: unknown) => {
  if (!isSessionMember(socket, sessionId)) {
    return reject(socket, callback, "error:membership", "Du bist nicht Mitglied dieses Raums.");
  }
  socket.emit("game-update", null);
  removeMember(socket, sessionId);
  acknowledge(callback, "success");
};

export const handleNewGame = (socket: Socket, gameDetails: unknown, callback?: unknown) => {
  if (!isRecord(gameDetails) || !isSessionId(gameDetails.sessionId)) {
    return reject(socket, callback, "error:invalid", "Die Anfrage zum Spielstart ist ungültig.");
  }
  const { sessionId } = gameDetails;
  if (!isSessionMember(socket, sessionId)) {
    return reject(socket, callback, "error:membership", "Du bist nicht Mitglied dieses Raums.");
  }
  const session = sessions.get(sessionId)!;
  if (session.hostId !== socket.id) {
    return reject(socket, callback, "error:host", "Nur der Gastgeber kann die Partie starten.");
  }
  if (allGames.some(game => game.sessionId === sessionId)) {
    return reject(socket, callback, "error:running", "In diesem Raum läuft bereits eine Partie.");
  }
  if (session.members.size < 2 || session.members.size > MAX_PLAYERS) {
    return reject(socket, callback, "error:players", "Für eine Partie werden 2–8 Spieler benötigt.");
  }
  const game = new Game(socket, sessionId, new Set(session.members));
  allGames.push(game);
  acknowledge(callback, "success");
  // Do not allow a future unexpected game-loop exception to become an unhandled
  // rejection. The game itself validates actions before applying mutations.
  void game.gameLoop().catch((error: unknown) => {
    console.error("Game loop failed", error);
    io.to(sessionRoom(sessionId)).emit("message", "Die Partie wurde wegen eines Fehlers beendet. Du kannst eine neue Partie starten.");
    io.to(sessionRoom(sessionId)).emit("game-update", null);
    game.dispose();
  });
};

export const handleDisconnect = (socket: Socket) => {
  const sessionId = socket.data.sessionId;
  if (typeof sessionId === "string") removeMember(socket, sessionId);
};
