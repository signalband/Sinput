import type {
  ClientMessage,
  AuthMessage,
  TextMessage,
  ServerMessage,
  ClientRole,
} from "@sinput/shared";
import {
  HEARTBEAT_TIMEOUT_MS,
  ROOM_DESTROY_TIMEOUT_MS,
  TOKEN_EXPIRY_MS,
} from "@sinput/shared";

interface ClientState {
  ws: WebSocket;
  role: ClientRole;
  deviceId: string;
  lastPing: number;
}

interface RoomConfig {
  token: string;
  pairSecret: string;
  tokenConsumed: boolean;
  tokenExpiresAt: number;
}

export class SinputRoom implements DurableObject {
  private state: DurableObjectState;
  private clients: Map<WebSocket, ClientState> = new Map();
  private config: RoomConfig | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private destroyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;

    // Restore WebSocket clients from hibernation
    this.state.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment() as Omit<ClientState, "ws"> | null;
      if (meta) {
        this.clients.set(ws, { ...meta, ws });
      }
    });

    // Load persisted room config from storage
    this.state.blockConcurrencyWhile(async () => {
      this.config = (await this.state.storage.get<RoomConfig>("config")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — initialize room
    if (url.pathname === "/init" && request.method === "POST") {
      this.config = {
        token: crypto.randomUUID(),
        pairSecret: crypto.randomUUID(),
        tokenConsumed: false,
        tokenExpiresAt: Date.now() + TOKEN_EXPIRY_MS,
      };
      await this.state.storage.put("config", this.config);
      this.scheduleDestroy();
      return new Response(
        JSON.stringify({
          token: this.config.token,
          pairSecret: this.config.pairSecret,
          expiresAt: this.config.tokenExpiresAt,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      this.startHeartbeatCheck();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      this.sendTo(ws, { type: "error", code: "UNKNOWN", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "auth":
        await this.handleAuth(ws, msg);
        break;
      case "text":
        this.handleText(ws, msg);
        break;
      case "ping":
        this.handlePing(ws);
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.clients.delete(ws);
    this.broadcastStatus();
    if (this.clients.size === 0) {
      this.scheduleDestroy();
    }
  }

  async webSocketError(ws: WebSocket) {
    this.clients.delete(ws);
    this.broadcastStatus();
    if (this.clients.size === 0) {
      this.scheduleDestroy();
    }
  }

  // --- Handlers ---

  private async handleAuth(ws: WebSocket, msg: AuthMessage) {
    if (!this.config) {
      this.sendTo(ws, { type: "error", code: "UNKNOWN", message: "Room not initialized" });
      ws.close(4000, "ROOM_NOT_INIT");
      return;
    }

    // Validate pairSecret
    if (msg.pairSecret !== this.config.pairSecret) {
      this.sendTo(ws, { type: "error", code: "AUTH_FAILED", message: "Invalid pair secret" });
      ws.close(4001, "AUTH_FAILED");
      return;
    }

    // For phone role, validate token on first connection
    if (msg.role === "phone" && !this.hasClientWithRole("phone")) {
      if (this.config.tokenConsumed) {
        this.sendTo(ws, { type: "error", code: "TOKEN_CONSUMED", message: "Token already used" });
        ws.close(4002, "TOKEN_CONSUMED");
        return;
      }
      if (Date.now() > this.config.tokenExpiresAt) {
        this.sendTo(ws, { type: "error", code: "TOKEN_EXPIRED", message: "Token expired" });
        ws.close(4003, "TOKEN_EXPIRED");
        return;
      }
      this.config.tokenConsumed = true;
      await this.state.storage.put("config", this.config);
    }

    // Check if role slot is already taken by a different device
    const existingClient = this.getClientByRole(msg.role);
    if (existingClient && existingClient.deviceId !== msg.deviceId) {
      this.sendTo(ws, { type: "error", code: "ROOM_FULL", message: `${msg.role} slot taken` });
      ws.close(4004, "ROOM_FULL");
      return;
    }

    // Remove previous connection for same device (reconnect case)
    if (existingClient) {
      this.clients.delete(existingClient.ws);
      try { existingClient.ws.close(1000, "Replaced"); } catch { /* already closed */ }
    }

    const clientState: ClientState = {
      ws,
      role: msg.role,
      deviceId: msg.deviceId,
      lastPing: Date.now(),
    };
    this.clients.set(ws, clientState);
    ws.serializeAttachment({ role: msg.role, deviceId: msg.deviceId, lastPing: clientState.lastPing });

    this.cancelDestroy();
    this.broadcastStatus();
  }

  private handleText(ws: WebSocket, msg: TextMessage) {
    const sender = this.clients.get(ws);
    if (!sender || sender.role !== "phone") return;

    const desktop = this.getClientByRole("desktop");
    if (!desktop) {
      this.sendTo(ws, {
        type: "error",
        code: "DESKTOP_OFFLINE",
        message: "Desktop is offline",
      });
      return;
    }

    // Forward text to desktop
    this.sendTo(desktop.ws, { type: "text", text: msg.text, ts: msg.ts });
    // Ack to phone
    this.sendTo(ws, { type: "ack", ts: msg.ts });
  }

  private handlePing(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (client) {
      client.lastPing = Date.now();
    }
    this.sendTo(ws, { type: "pong" });
  }

  // --- Helpers ---

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* connection may be dead */ }
  }

  private broadcastStatus() {
    const status: ServerMessage = {
      type: "status",
      desktopOnline: this.hasClientWithRole("desktop"),
      phoneOnline: this.hasClientWithRole("phone"),
    };
    for (const [ws] of this.clients) {
      this.sendTo(ws, status);
    }
  }

  private hasClientWithRole(role: ClientRole): boolean {
    for (const [, c] of this.clients) {
      if (c.role === role) return true;
    }
    return false;
  }

  private getClientByRole(role: ClientRole): ClientState | null {
    for (const [, c] of this.clients) {
      if (c.role === role) return c;
    }
    return null;
  }

  private startHeartbeatCheck() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, client] of this.clients) {
        if (now - client.lastPing > HEARTBEAT_TIMEOUT_MS) {
          this.clients.delete(ws);
          try { ws.close(4005, "Heartbeat timeout"); } catch { /* */ }
        }
      }
      this.broadcastStatus();
      if (this.clients.size === 0) {
        this.stopHeartbeatCheck();
        this.scheduleDestroy();
      }
    }, 30_000);
  }

  private stopHeartbeatCheck() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleDestroy() {
    this.cancelDestroy();
    this.destroyTimeout = setTimeout(async () => {
      this.stopHeartbeatCheck();
      await this.state.storage.deleteAll();
    }, ROOM_DESTROY_TIMEOUT_MS);
  }

  private cancelDestroy() {
    if (this.destroyTimeout) {
      clearTimeout(this.destroyTimeout);
      this.destroyTimeout = null;
    }
  }
}
