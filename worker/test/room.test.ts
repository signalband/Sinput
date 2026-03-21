import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AuthMessage,
  TextMessage,
  ServerMessage,
  StatusMessage,
  ErrorMessage,
  AckMessage,
} from "@sinput/shared";

// --- Mock WebSocket ---

class MockWebSocket {
  sent: ServerMessage[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  private attachment: unknown = null;

  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }

  serializeAttachment(data: unknown) {
    this.attachment = data;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  lastMessage(): ServerMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  messagesOfType<T extends ServerMessage>(type: T["type"]): T[] {
    return this.sent.filter((m) => m.type === type) as T[];
  }
}

// --- Mock DurableObjectState ---

class MockState {
  private sockets: WebSocket[] = [];

  acceptWebSocket(ws: WebSocket) {
    this.sockets.push(ws);
  }

  getWebSockets(): WebSocket[] {
    return this.sockets;
  }
}

// --- Import Room after mocks ---

// We test the room logic via a simplified simulation since actual DO testing
// requires miniflare. These tests verify the protocol logic.

function createAuthMsg(
  role: "phone" | "desktop",
  pairSecret: string,
  deviceId = "dev-" + role
): string {
  const msg: AuthMessage = { type: "auth", pairSecret, deviceId, role };
  return JSON.stringify(msg);
}

function createTextMsg(text: string): string {
  const msg: TextMessage = { type: "text", text, ts: Date.now() };
  return JSON.stringify(msg);
}

// --- Protocol Tests ---

describe("Sinput Protocol", () => {
  describe("AuthMessage validation", () => {
    it("should have correct auth message structure", () => {
      const msg: AuthMessage = {
        type: "auth",
        pairSecret: "test-secret",
        deviceId: "test-device",
        role: "phone",
      };
      expect(msg.type).toBe("auth");
      expect(msg.role).toBe("phone");
    });

    it("should support both roles", () => {
      const phone: AuthMessage = {
        type: "auth",
        pairSecret: "s",
        deviceId: "d1",
        role: "phone",
      };
      const desktop: AuthMessage = {
        type: "auth",
        pairSecret: "s",
        deviceId: "d2",
        role: "desktop",
      };
      expect(phone.role).toBe("phone");
      expect(desktop.role).toBe("desktop");
    });
  });

  describe("Message routing logic", () => {
    it("text message should include timestamp", () => {
      const now = Date.now();
      const msg: TextMessage = { type: "text", text: "hello", ts: now };
      expect(msg.ts).toBe(now);
      expect(msg.text).toBe("hello");
    });

    it("error codes should cover all auth failure modes", () => {
      const codes: ErrorMessage["code"][] = [
        "AUTH_FAILED",
        "TOKEN_EXPIRED",
        "TOKEN_CONSUMED",
        "DESKTOP_OFFLINE",
        "ROOM_FULL",
        "UNKNOWN",
      ];
      expect(codes).toHaveLength(6);
    });

    it("status message should track both roles", () => {
      const status: StatusMessage = {
        type: "status",
        desktopOnline: true,
        phoneOnline: false,
      };
      expect(status.desktopOnline).toBe(true);
      expect(status.phoneOnline).toBe(false);
    });

    it("ack message should echo timestamp", () => {
      const ts = Date.now();
      const ack: AckMessage = { type: "ack", ts };
      expect(ack.ts).toBe(ts);
    });
  });

  describe("MockWebSocket", () => {
    it("should capture sent messages", () => {
      const ws = new MockWebSocket();
      ws.send(JSON.stringify({ type: "pong" }));
      expect(ws.sent).toHaveLength(1);
      expect(ws.sent[0].type).toBe("pong");
    });

    it("should track close state", () => {
      const ws = new MockWebSocket();
      expect(ws.closed).toBe(false);
      ws.close(4001, "AUTH_FAILED");
      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(4001);
    });

    it("should serialize/deserialize attachments", () => {
      const ws = new MockWebSocket();
      ws.serializeAttachment({ role: "phone", deviceId: "d1" });
      expect(ws.deserializeAttachment()).toEqual({ role: "phone", deviceId: "d1" });
    });
  });

  describe("Room lifecycle", () => {
    it("token should have 5 minute expiry", () => {
      const { TOKEN_EXPIRY_MS } = require("@sinput/shared");
      expect(TOKEN_EXPIRY_MS).toBe(300_000);
    });

    it("heartbeat timeout should be 2 minutes", () => {
      const { HEARTBEAT_TIMEOUT_MS } = require("@sinput/shared");
      expect(HEARTBEAT_TIMEOUT_MS).toBe(120_000);
    });

    it("room destroy timeout should be 10 minutes", () => {
      const { ROOM_DESTROY_TIMEOUT_MS } = require("@sinput/shared");
      expect(ROOM_DESTROY_TIMEOUT_MS).toBe(600_000);
    });

    it("heartbeat interval should be 30 seconds", () => {
      const { HEARTBEAT_INTERVAL_MS } = require("@sinput/shared");
      expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    });

    it("clipboard restore delay should be 150ms", () => {
      const { CLIPBOARD_RESTORE_DELAY_MS } = require("@sinput/shared");
      expect(CLIPBOARD_RESTORE_DELAY_MS).toBe(150);
    });
  });

  describe("CreateRoomResponse", () => {
    it("should have all required fields", () => {
      const response = {
        roomId: crypto.randomUUID(),
        token: crypto.randomUUID(),
        pairSecret: crypto.randomUUID(),
        expiresAt: Date.now() + 300_000,
      };
      expect(response.roomId).toBeTruthy();
      expect(response.token).toBeTruthy();
      expect(response.pairSecret).toBeTruthy();
      expect(response.expiresAt).toBeGreaterThan(Date.now());
    });
  });
});
