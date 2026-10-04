import { socket } from "./socket";
import type { ResponseCode } from "./types/gameProtocol";

export const responseMessages: Record<Exclude<ResponseCode, "success">, string> = {
  "error:invalid": "Die Eingabe ist ungültig. Bitte prüfe deine Angaben.",
  "error:full": "In dieser Session ist kein Platz für die gewählte Rolle frei.",
  "error:running": "Diese Änderung ist erst nach der laufenden Partie möglich.",
  "error:joined": "Verlasse zunächst deine aktuelle Session.",
  "error:membership": "Du bist nicht mehr in dieser Session. Bitte tritt erneut bei.",
  "error:host": "Nur der Gastgeber darf diese Einstellung ändern.",
  "error:players": "Eine Partie benötigt zwei bis acht Spieler.",
  "error:stale": "Die Spielsituation hat sich geändert. Bitte wähle deine Aktion erneut.",
  "error:rate-limited": "Bitte warte einen Moment und versuche es erneut.",
  "error:finished": "Diese Partie ist bereits beendet.",
};

export function responseMessage(code: ResponseCode) {
  return code === "success" ? "" : responseMessages[code] || "Die Aktion konnte nicht ausgeführt werden.";
}

export function sessionCommand(event: string, payload: unknown): Promise<ResponseCode> {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (timeout: Error | null, code: ResponseCode) => {
      if (timeout) reject(new Error("Keine Antwort vom Server. Bitte versuche es erneut."));
      else resolve(code);
    });
  });
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Die Aktion konnte nicht ausgeführt werden.";
}
