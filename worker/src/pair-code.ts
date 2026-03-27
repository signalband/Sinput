// PairCodeRegistry — maps 6-digit short codes to room pairing info
// Uses a single Durable Object instance as a global registry

import { PAIR_CODE_TTL_MS } from "@sinput/shared";

interface CodeEntry {
  roomId: string;
  pairSecret: string;
  expiresAt: number;
  attempts: number;
}

export class PairCodeRegistry implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /register — desktop registers a short code for its room
    if (url.pathname === "/register" && request.method === "POST") {
      const { roomId, pairSecret } = (await request.json()) as {
        roomId: string;
        pairSecret: string;
      };

      // Generate unique 6-digit code
      let code: string;
      let attempts = 0;
      do {
        code = String(Math.floor(100000 + Math.random() * 900000));
        const existing = await this.state.storage.get<CodeEntry>(`code:${code}`);
        if (!existing || Date.now() > existing.expiresAt) break;
        attempts++;
      } while (attempts < 10);

      const entry: CodeEntry = {
        roomId,
        pairSecret,
        expiresAt: Date.now() + PAIR_CODE_TTL_MS,
        attempts: 0,
      };

      await this.state.storage.put(`code:${code}`, entry);

      return new Response(JSON.stringify({ code, expiresIn: PAIR_CODE_TTL_MS / 1000 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /lookup — phone looks up a short code
    if (url.pathname === "/lookup" && request.method === "POST") {
      const { code } = (await request.json()) as { code: string };

      const entry = await this.state.storage.get<CodeEntry>(`code:${code}`);

      if (!entry) {
        return new Response(JSON.stringify({ error: "INVALID_CODE" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      entry.attempts++;
      if (entry.attempts > 5) {
        await this.state.storage.delete(`code:${code}`);
        return new Response(JSON.stringify({ error: "TOO_MANY_ATTEMPTS" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Consume the code (one-time use)
      await this.state.storage.delete(`code:${code}`);

      return new Response(
        JSON.stringify({
          roomId: entry.roomId,
          pairSecret: entry.pairSecret,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }
}
