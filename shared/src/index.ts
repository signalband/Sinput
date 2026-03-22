// Sinput WebSocket Protocol Types

export type ClientRole = "phone" | "desktop";

// --- Messages from client to Worker ---

export interface AuthMessage {
  type: "auth";
  pairSecret: string;
  deviceId: string;
  role: ClientRole;
}

export interface TextMessage {
  type: "text";
  text: string;
  ts: number;
}

export interface PingMessage {
  type: "ping";
}

// --- Messages from Worker to client ---

export interface StatusMessage {
  type: "status";
  desktopOnline: boolean;
  phoneOnline: boolean;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  code: "AUTH_FAILED" | "TOKEN_EXPIRED" | "TOKEN_CONSUMED" | "DESKTOP_OFFLINE" | "ROOM_FULL" | "ROOM_DESTROYED" | "UNKNOWN";
  message: string;
}

export interface AckMessage {
  type: "ack";
  ts: number;
}

// --- Union types ---

export type ClientMessage = AuthMessage | TextMessage | PingMessage;
export type ServerMessage = StatusMessage | PongMessage | ErrorMessage | AckMessage | TextMessage;

// --- Room creation (HTTP) ---

export interface CreateRoomResponse {
  roomId: string;
  token: string;
  pairSecret: string;
  expiresAt: number;
}

// --- Constants ---

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 120_000;
export const ROOM_DESTROY_TIMEOUT_MS = 600_000;
export const TOKEN_EXPIRY_MS = 300_000;
export const CLIPBOARD_RESTORE_DELAY_MS = 150;
export const PAIR_CODE_TTL_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
