import type { CreateRoomResponse } from "@sinput/shared";

export { SinputRoom } from "./room";

interface Env {
  SINPUT_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
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
