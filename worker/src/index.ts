import type { CreateRoomResponse } from "@sinput/shared";

export { SinputRoom } from "./room";
export { PairCodeRegistry } from "./pair-code";

interface Env {
  SINPUT_ROOM: DurableObjectNamespace;
  PAIR_CODE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // POST /api/room — create a new room
    if (url.pathname === "/api/room" && request.method === "POST") {
      const roomId = crypto.randomUUID();
      const id = env.SINPUT_ROOM.idFromName(roomId);
      const stub = env.SINPUT_ROOM.get(id);
      const res = await stub.fetch(
        new Request("https://internal/init", { method: "POST" })
      );
      const data = (await res.json()) as { token: string; pairSecret: string; expiresAt: number };
      const body: CreateRoomResponse = { roomId, ...data };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // POST /api/pair-code/register — desktop registers a short code
    if (url.pathname === "/api/pair-code/register" && request.method === "POST") {
      const registryId = env.PAIR_CODE.idFromName("global");
      const stub = env.PAIR_CODE.get(registryId);
      const res = await stub.fetch(
        new Request("https://internal/register", {
          method: "POST",
          body: await request.text(),
          headers: { "Content-Type": "application/json" },
        })
      );
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // POST /api/pair-code/lookup — phone looks up a short code
    if (url.pathname === "/api/pair-code/lookup" && request.method === "POST") {
      const registryId = env.PAIR_CODE.idFromName("global");
      const stub = env.PAIR_CODE.get(registryId);
      const res = await stub.fetch(
        new Request("https://internal/lookup", {
          method: "POST",
          body: await request.text(),
          headers: { "Content-Type": "application/json" },
        })
      );
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // GET /api/room/:roomId/ws — WebSocket upgrade
    const wsMatch = url.pathname.match(/^\/api\/room\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
      const roomId = wsMatch[1];
      const id = env.SINPUT_ROOM.idFromName(roomId);
      const stub = env.SINPUT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response("Sinput API", {
      status: 200,
      headers: corsHeaders,
    });
  },
};
