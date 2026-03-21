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

export class SinputRoom implements DurableObject {
  private state: DurableObjectState;
  private clients: Map<WebSocket, ClientState> = new Map();
  private token: string | null = null;
  private pairSecret: string | null = null;
  private tokenConsumed = false;
  private tokenExpiresAt = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private destroyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
    this.state.getWebSockets().forEach((ws) => {
      const meta = ws.deserializeAttachment() as ClientState | null;
      if (meta) {
        this.clients.set(ws, { ...meta, ws });
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — initialize room
    if (url.pathname === "/init" && request.method === "POST") {
      this.token = crypto.randomUUID();
      this.pairSecret = crypto.randomUUID();
      this.tokenConsumed = false;
      this.tokenExpiresAt = Date.now() + TOKEN_EXPIRY_MS;
      this.scheduleDestroy();
      return new Response(
        JSON.stringify({
          token: this.token,
          pairSecret: this.pairSecret,
          expiresAt: this.tokenExpiresAt,
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
        this.handleAuth(ws, msg);
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

  private handleAuth(ws: WebSocket, msg: AuthMessage) {
    // Validate pairSecret
    if (msg.pairSecret !== this.pairSecret) {
      this.sendTo(ws, { type: "error", code: "AUTH_FAILED", message: "Invalid pair secret" });
      ws.close(4001, "AUTH_FAILED");
      return;
    }

    // For phone role, validate token on first connection
    if (msg.role === "phone" && !this.hasClientWithRole("phone")) {
      if (this.tokenConsumed) {
        this.sendTo(ws, { type: "error", code: "TOKEN_CONSUMED", message: "Token already used" });
        ws.close(4002, "TOKEN_CONSUMED");
        return;
      }
      if (Date.now() > this.tokenExpiresAt) {
        this.sendTo(ws, { type: "error", code: "TOKEN_EXPIRED", message: "Token expired" });
        ws.close(4003, "TOKEN_EXPIRED");
        return;
      }
      this.tokenConsumed = true;
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
    ws.serializeAttachment(clientState);

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
    this.destroyTimeout = setTimeout(() => {
      this.stopHeartbeatCheck();
      // Durable Object will be evicted by the runtime after inactivity
    }, ROOM_DESTROY_TIMEOUT_MS);
  }

  private cancelDestroy() {
    if (this.destroyTimeout) {
      clearTimeout(this.destroyTimeout);
      this.destroyTimeout = null;
    }
  }
}
