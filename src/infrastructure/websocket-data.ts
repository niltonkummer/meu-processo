import type WebSocket from "ws";

export const websocketDataToText = (value: WebSocket.RawData): string => {
  if (Array.isArray(value)) return Buffer.concat(value).toString("utf-8");
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf-8");
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString(
    "utf-8",
  );
};
