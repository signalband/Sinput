import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// --- Config ---
const API_BASE = "https://ws.sinput.jowork.work";
const WS_BASE = "wss://ws.sinput.jowork.work";
const PWA_BASE = "https://sinput.jowork.work";

// --- State ---
let ws: WebSocket | null = null;
let roomId = "";
let pairSecret = "";
let deviceId = "";
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let phoneOnline = false;

// --- Elements ---
const stateLoading = document.getElementById("stateLoading")!;
const statePairing = document.getElementById("statePairing")!;
const stateConnected = document.getElementById("stateConnected")!;
const qrContainer = document.getElementById("qrContainer")!;
const pairUrl = document.getElementById("pairUrl")!;
const phoneDot = document.getElementById("phoneDot")!;
const phoneStatus = document.getElementById("phoneStatus")!;
const lastMsg = document.getElementById("lastMsg")!;
const repairBtn = document.getElementById("repairBtn")!;
const closeBtn = document.getElementById("closeBtn")!;
const injectFlash = document.getElementById("injectFlash")!;

// --- UI State ---
function showState(state: "loading" | "pairing" | "connected") {
  stateLoading.classList.toggle("active", state === "loading");
  statePairing.classList.toggle("active", state === "pairing");
  stateConnected.classList.toggle("active", state === "connected");
}

function flashInject() {
  injectFlash.classList.add("show");
  setTimeout(() => injectFlash.classList.remove("show"), 600);
}

// --- QR Code (simple SVG-based) ---
function renderQR(url: string) {
  // Use a minimal QR code library inline — for MVP, display the URL as text
  // and generate QR via an img tag pointing to a QR API
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&format=svg`;
  qrContainer.innerHTML = `<img src="${qrApiUrl}" alt="QR Code" style="width:100%;height:100%;border-radius:4px;">`;
  pairUrl.textContent = url;
}

// --- Room Creation ---
async function createRoom() {
  showState("loading");

  try {
    const result = await invoke<{
      room_id: string;
      token: string;
      pair_secret: string;
      device_id: string;
    }>("create_room", { apiBase: API_BASE });

    roomId = result.room_id;
    pairSecret = result.pair_secret;
    deviceId = result.device_id;

    // Generate PWA URL for phone
    const phoneUrl = `${PWA_BASE}/?room=${roomId}&secret=${pairSecret}`;
    renderQR(phoneUrl);
    showState("pairing");

    // Connect desktop WebSocket
    connectWS();
  } catch (e) {
    console.error("Failed to create room:", e);
    showState("loading");
    // Retry after 3s
    setTimeout(createRoom, 3000);
  }
}

// --- WebSocket ---
function connectWS() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  const wsUrl = `${WS_BASE}/api/room/${roomId}/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws!.send(
      JSON.stringify({
        type: "auth",
        pairSecret,
        deviceId,
        role: "desktop",
      })
    );
    startHeartbeat();
  };

  ws.onmessage = (e) => {
    let msg: any;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "status":
        phoneOnline = msg.phoneOnline;
        if (phoneOnline) {
          showState("connected");
          phoneDot.className = "status-dot online";
          phoneStatus.textContent = "iPhone 已连接";
        } else {
          phoneDot.className = "status-dot waiting";
          phoneStatus.textContent = "等待手机连接...";
        }
        break;

      case "text":
        handleIncomingText(msg.text);
        break;

      case "pong":
        break;

      case "error":
        console.error("Server error:", msg);
        break;
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    // Auto-reconnect after 2s
    setTimeout(() => {
      if (roomId) connectWS();
    }, 2000);
  };
}

// --- Text Injection ---
async function handleIncomingText(text: string) {
  lastMsg.textContent = text.length > 100 ? text.slice(0, 100) + "..." : text;

  try {
    await invoke("inject_text", { text });
    flashInject();
  } catch (e) {
    console.error("Inject failed:", e);
    // Fallback: at least show the text was received
    lastMsg.textContent = `[注入失败] ${text}`;
  }
}

// --- Heartbeat ---
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// --- Events ---
closeBtn.addEventListener("click", async () => {
  const win = getCurrentWebviewWindow();
  await win.hide();
});

repairBtn.addEventListener("click", () => {
  // Close existing WS
  if (ws) {
    ws.close();
    ws = null;
  }
  stopHeartbeat();
  phoneOnline = false;
  createRoom();
});

// --- Init ---
window.addEventListener("DOMContentLoaded", () => {
  createRoom();
});
