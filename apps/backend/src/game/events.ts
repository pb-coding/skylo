import { randomUUID } from "node:crypto";
import { Socket } from "socket.io";
import { io } from "../server";
import { GameRunner } from "./runtime/GameRunner";
import { allGames } from "./game";
import { botCatalog, botPlayerCountError, validateBotConfig } from "./bots";
import { sessionRoom } from "./sessionRoom";
import { acknowledge, isRecord, isSessionId, SessionResponse } from "./sessionValidation";
import { ActionRequest, ParticipantRole, PlaybackCommand, PlayerSpec, PROTOCOL_VERSION, SessionParticipant, SessionView } from "../protocol/gameProtocol";

export const MAX_PLAYERS = 8;
export const MAX_SPECTATORS = 32;
const MAX_SESSIONS = 1000;
const RETENTION_MS = 30 * 60_000;
const UNOBSERVED_RUNNING_MS = 10 * 60_000;
type Member = SessionParticipant & { socketId: string };
type Session = { members: Map<string, Member>; hostId: string; players: PlayerSpec[]; runner: GameRunner | null; cleanupTimer?: ReturnType<typeof setTimeout>; exportTimer?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Session>();

const reject = (socket: Socket, callback: unknown, response: SessionResponse, message: string) => {
  acknowledge(callback, response);
  socket.emit("message", message);
};
const running = (session: Session) => Boolean(session.runner && !session.runner.disposed);
const validRole = (role: unknown): role is ParticipantRole => role === "player" || role === "spectator";
const validName = (name: unknown) => typeof name === "string" && name.trim().length > 0 && name.trim().length <= 32;

export const isSessionMember = (socket: Socket, sessionId: unknown): sessionId is string =>
  isSessionId(sessionId) && socket.data.sessionId === sessionId && sessions.get(sessionId)?.members.has(socket.id) === true;

function sessionView(sessionId: string, session: Session, member: Member): SessionView {
  return { protocolVersion: PROTOCOL_VERSION, sessionId, hostId: session.hostId, ownParticipantId: member.id,
    ownPlayerId: member.playerId, role: member.role, maxPlayers: MAX_PLAYERS, maxSpectators: MAX_SPECTATORS,
    players: session.players.map(player => ({ ...player, botConfig: player.botConfig ? { ...player.botConfig } : undefined })),
    participants: [...session.members.values()].map(({ socketId: _socketId, ...participant }) => participant),
    running: running(session), canControl: session.hostId === member.id, hasExport: Boolean(session.runner?.hasExport), botCatalog: botCatalog(session.players.length) };
}
function broadcastSession(sessionId: string, session: Session) {
  for (const member of session.members.values()) {
    io.to(member.socketId).emit("clients-in-session", session.players.length);
    io.to(member.socketId).emit("session-state", sessionView(sessionId, session, member));
  }
}
function broadcastGame(session: Session) {
  if (!session.runner) return;
  for (const member of session.members.values()) io.to(member.socketId).emit("game-update", session.runner.view(member.playerId, member.role));
}
function cleanupLater(sessionId: string, session: Session) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = undefined;
  if (session.members.size) return;
  if (!session.runner) { sessions.delete(sessionId); return; }
  session.cleanupTimer = setTimeout(() => {
    session.cleanupTimer = undefined;
    if (sessions.get(sessionId) !== session || session.members.size) return;
    if (running(session)) session.runner!.stop("aborted");
    else {
      if (session.exportTimer) clearTimeout(session.exportTimer);
      session.runner?.expireRecord();
      sessions.delete(sessionId);
    }
  }, running(session) ? UNOBSERVED_RUNNING_MS : RETENTION_MS);
  session.cleanupTimer.unref();
}

export const handleJoinSession = (socket: Socket, request: unknown, callback?: unknown) => {
  const sessionId = typeof request === "string" ? request : isRecord(request) ? request.sessionId : null;
  const role = typeof request === "string" ? "player" : isRecord(request) ? request.role : null;
  const name = isRecord(request) ? request.name : undefined;
  if (!isSessionId(sessionId) || io.sockets.sockets.has(sessionId) || !validRole(role) || name !== undefined && !validName(name)) {
    return reject(socket, callback, "error:invalid", "Bitte nutze einen gültigen Raumnamen (1–40 Zeichen), eine Rolle und einen Namen mit höchstens 32 Zeichen.");
  }
  if (isSessionMember(socket, sessionId)) {
    acknowledge(callback, "success");
    const session = sessions.get(sessionId)!;
    const member = session.members.get(socket.id)!;
    socket.emit("session-state", sessionView(sessionId, session, member));
    socket.emit("clients-in-session", session.players.length);
    if (session.runner) socket.emit("game-update", session.runner.view(member.playerId, member.role));
    return;
  }
  if (socket.data.sessionId) return reject(socket, callback, "error:joined", "Verlasse zuerst deinen aktuellen Raum.");
  let session = sessions.get(sessionId);
  if (session && running(session) && role === "player") return reject(socket, callback, "error:running", "Die Partie läuft bereits. Du kannst als Zuschauer beitreten.");
  if (session && (role === "player" && session.players.length >= MAX_PLAYERS || role === "spectator" && [...session.members.values()].filter(member => member.role === "spectator").length >= MAX_SPECTATORS) || !session && sessions.size >= MAX_SESSIONS) {
    return reject(socket, callback, "error:full", "Dieser Raum ist voll. Bitte wähle einen anderen Raum.");
  }
  if (!session) { session = { members: new Map(), hostId: "", players: [], runner: null }; sessions.set(sessionId, session); }
  const participantId = randomUUID();
  const member: Member = { id: participantId, socketId: socket.id, name: typeof name === "string" ? name.trim() : `Spieler ${session.players.length + 1}`,
    role, playerId: role === "player" ? randomUUID() : null };
  session.members.set(socket.id, member);
  if (member.playerId) session.players.push({ id: member.playerId, name: member.name, kind: "human" });
  if (!session.hostId) session.hostId = participantId;
  socket.data.sessionId = sessionId;
  socket.join(sessionRoom(sessionId));
  cleanupLater(sessionId, session);
  acknowledge(callback, "success");
  broadcastSession(sessionId, session);
  if (session.runner) socket.emit("game-update", session.runner.view(member.playerId, member.role));
};

function removeMember(socket: Socket, sessionId: string) {
  const session = sessions.get(sessionId);
  delete socket.data.sessionId;
  socket.leave(sessionRoom(sessionId));
  if (!session) return;
  const member = session.members.get(socket.id);
  session.members.delete(socket.id);
  if (member?.id === session.hostId) session.hostId = session.members.values().next().value?.id ?? "";
  if (member?.playerId) {
    session.players = session.players.filter(player => player.id !== member.playerId);
    if (running(session)) session.runner!.stop("aborted");
  }
  broadcastSession(sessionId, session);
  cleanupLater(sessionId, session);
}
export const handleLeaveSession = (socket: Socket, sessionId: unknown, callback?: unknown) => {
  if (!isSessionMember(socket, sessionId)) return reject(socket, callback, "error:membership", "Du bist nicht Mitglied dieses Raums.");
  socket.emit("game-update", null);
  removeMember(socket, sessionId);
  acknowledge(callback, "success");
};
export const handleDisconnect = (socket: Socket) => {
  if (typeof socket.data.sessionId === "string") removeMember(socket, socket.data.sessionId);
};

function authorized(socket: Socket, payload: unknown, callback: unknown, hostOnly = false): Session | null {
  if (!isRecord(payload) || !isSessionId(payload.sessionId)) {
    reject(socket, callback, "error:invalid", "Die Anfrage ist ungültig."); return null;
  }
  if (!isSessionMember(socket, payload.sessionId)) {
    reject(socket, callback, "error:membership", "Du bist nicht Mitglied dieses Raums."); return null;
  }
  const session = sessions.get(payload.sessionId)!;
  if (hostOnly && session.members.get(socket.id)!.id !== session.hostId) {
    reject(socket, callback, "error:host", "Diese Aktion kann nur der Gastgeber ausführen."); return null;
  }
  return session;
}

export const handleNewGame = (socket: Socket, payload: unknown, callback?: unknown) => {
  const session = authorized(socket, payload, callback, true);
  if (!session || !isRecord(payload)) return;
  if (running(session)) return reject(socket, callback, "error:running", "In diesem Raum läuft bereits eine Partie.");
  if (session.players.length < 2 || session.players.length > MAX_PLAYERS) return reject(socket, callback, "error:players", "Für eine Partie werden 2–8 Spieler benötigt. Du kannst Bots hinzufügen.");
  for (const player of session.players) {
    const error = player.botConfig && botPlayerCountError(player.botConfig, session.players.length);
    if (error) return reject(socket, callback, "error:players", error);
  }
  if (payload.seed !== undefined && (typeof payload.seed !== "string" || payload.seed.length < 1 || payload.seed.length > 80 || session.players.some(player => player.kind === "human"))) {
    return reject(socket, callback, "error:invalid", "Eigene Seeds sind ausschließlich für reine Bot-Partien möglich.");
  }
  const config = { matchId: randomUUID(), sessionId: payload.sessionId as string, seed: typeof payload.seed === "string" ? payload.seed : randomUUID(),
    players: session.players.map(player => ({ ...player, botConfig: player.botConfig ? validateBotConfig(player.botConfig)! : undefined })), maxRounds: 100, maxActions: 100000 };
  try {
    const runner = new GameRunner(config, {
      onUpdate: () => broadcastGame(session),
      onEnd: completed => {
        const index = allGames.indexOf(completed);
        if (index !== -1) allGames.splice(index, 1);
        if (session.exportTimer) clearTimeout(session.exportTimer);
        session.exportTimer = setTimeout(() => {
          session.exportTimer = undefined;
          completed.expireRecord();
          if (session.runner === completed) broadcastSession(config.sessionId, session);
        }, RETENTION_MS);
        session.exportTimer.unref();
        broadcastSession(config.sessionId, session);
        cleanupLater(config.sessionId, session);
      },
    });
    if (session.exportTimer) clearTimeout(session.exportTimer);
    session.exportTimer = undefined;
    session.runner?.expireRecord();
    session.runner = runner;
    allGames.push(runner);
    acknowledge(callback, "success");
    broadcastSession(config.sessionId, session);
    runner.start();
  } catch (error) {
    console.error("Unable to initialize game", error);
    reject(socket, callback, "error:invalid", "Die Partie konnte nicht gestartet werden.");
  }
};

export const handleSetRole = (socket: Socket, payload: unknown, callback?: unknown) => {
  const session = authorized(socket, payload, callback);
  if (!session || !isRecord(payload)) return;
  if (running(session)) return reject(socket, callback, "error:running", "Die Rolle kann vor der nächsten Partie geändert werden.");
  if (!validRole(payload.role)) return reject(socket, callback, "error:invalid", "Die Rolle ist ungültig.");
  const member = session.members.get(socket.id)!;
  if (member.role === payload.role) { acknowledge(callback, "success"); return; }
  if (payload.role === "player" && session.players.length >= MAX_PLAYERS || payload.role === "spectator" && [...session.members.values()].filter(participant => participant.role === "spectator").length >= MAX_SPECTATORS) {
    return reject(socket, callback, "error:full", "Für diese Rolle ist kein Platz mehr frei.");
  }
  session.players = session.players.filter(player => player.id !== member.playerId);
  member.role = payload.role;
  member.playerId = member.role === "player" ? randomUUID() : null;
  if (member.playerId) session.players.push({ id: member.playerId, name: member.name, kind: "human" });
  acknowledge(callback, "success");
  broadcastSession(payload.sessionId as string, session);
  if (session.runner) socket.emit("game-update", session.runner.view(member.playerId, member.role));
};

export const handleBotChange = (socket: Socket, payload: unknown, callback: unknown, operation: "add" | "remove" | "update") => {
  const session = authorized(socket, payload, callback, true);
  if (!session || !isRecord(payload)) return;
  if (running(session)) return reject(socket, callback, "error:running", "Bots können vor der nächsten Partie geändert werden.");
  if (operation === "add" && session.players.length >= MAX_PLAYERS) return reject(socket, callback, "error:full", "Alle acht Spielerplätze sind belegt.");
  const config = operation !== "remove" ? validateBotConfig(payload.config) : null;
  if (operation !== "remove" && !config || payload.name !== undefined && !validName(payload.name)) return reject(socket, callback, "error:invalid", "Die Bot-Konfiguration ist ungültig.");
  if (operation === "add") session.players.push({ id: randomUUID(), name: typeof payload.name === "string" ? payload.name.trim() : `Bot ${session.players.filter(player => player.kind === "bot").length + 1}`, kind: "bot", botConfig: config! });
  else {
    const bot = session.players.find(player => player.id === payload.playerId && player.kind === "bot");
    if (!bot) return reject(socket, callback, "error:invalid", "Dieser Bot ist nicht im Raum.");
    if (operation === "remove") session.players = session.players.filter(player => player !== bot);
    else { bot.botConfig = config!; if (typeof payload.name === "string") bot.name = payload.name.trim(); }
  }
  acknowledge(callback, "success");
  broadcastSession(payload.sessionId as string, session);
};

export const handleGameAction = (socket: Socket, payload: unknown, callback?: unknown) => {
  const session = authorized(socket, payload, callback);
  if (!session || !isRecord(payload)) return;
  const member = session.members.get(socket.id)!;
  if (!member.playerId || member.role !== "player") return reject(socket, callback, "error:membership", "Zuschauer können keine Spielaktionen ausführen.");
  if (!session.runner) return reject(socket, callback, "error:invalid", "Es läuft keine Partie.");
  const response = session.runner.submit(member.playerId, payload as ActionRequest);
  acknowledge(callback, response);
  if (response === "error:stale") socket.emit("game-update", session.runner.view(member.playerId, member.role));
};
export const handlePlayback = (socket: Socket, payload: unknown, callback?: unknown) => {
  const session = authorized(socket, payload, callback, true);
  if (!session || !isRecord(payload)) return;
  acknowledge(callback, session.runner ? session.runner.control(payload.command as PlaybackCommand) : "error:invalid");
};
export const handleStopMatch = (socket: Socket, payload: unknown, callback?: unknown) => {
  const session = authorized(socket, payload, callback, true);
  if (!session) return;
  if (!session.runner || session.runner.disposed) return acknowledge(callback, "error:finished");
  session.runner.stop("aborted");
  acknowledge(callback, "success");
};
export const handleExportMatch = (socket: Socket, payload: unknown, callback?: unknown) => {
  if (typeof callback !== "function") return;
  let response: SessionResponse = "error:invalid";
  const session = authorized(socket, payload, (code: SessionResponse) => { response = code; }, true);
  const record = session?.runner?.exportRecord();
  try { callback({ code: record ? "success" : session ? running(session) ? "error:running" : "error:finished" : response, ...(record ? { record } : {}) }); } catch { /* bad acknowledgement is isolated */ }
};
