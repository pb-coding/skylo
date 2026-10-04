import { ResponseCode } from "../protocol/gameProtocol";
export type SessionResponse = ResponseCode;

export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u.test(value) &&
  value === value.trim();

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const acknowledge = (callback: unknown, response: SessionResponse) => {
  if (typeof callback !== "function") return;
  try {
    callback(response);
  } catch (error) {
    console.error("Socket acknowledgement failed", error);
  }
};

export const validDescription = (value: unknown, type: "offer" | "answer") =>
  isRecord(value) && value.type === type && typeof value.sdp === "string" &&
  value.sdp.length > 0 && value.sdp.length <= 32_768;

export const validIceCandidate = (value: unknown) =>
  isRecord(value) && typeof value.candidate === "string" &&
  value.candidate.length <= 2_048 &&
  (value.sdpMid === null || typeof value.sdpMid === "string" && value.sdpMid.length <= 128) &&
  (value.sdpMLineIndex === null || Number.isInteger(value.sdpMLineIndex) &&
    (value.sdpMLineIndex as number) >= 0 && (value.sdpMLineIndex as number) <= 128);
