import { invoke } from "@tauri-apps/api/core";

const API_BASE = "https://ws.sinput.jowork.work";
const WS_BASE = "wss://ws.sinput.jowork.work";
const PWA_BASE = "https://sinput.jowork.work";

let ws: WebSocket | null = null;
let roomId = "";
let pairSecret = "";
let deviceId = "";
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// --- Elements ---

const permBanner = document.getElementById("permBanner")!;
const permBtn = document.getElementById("permBtn")!;
const statusDot = document.getElementById("statusDot")!;
const statusText = document.getElementById("statusText")!;
const lastMsg = document.getElementById("lastMsg")!;
const qrCard = document.getElementById("qrCard")!;
const qrContainer = document.getElementById("qrContainer")!;
const repairBtn = document.getElementById("repairBtn")!;
const disconnectBtn = document.getElementById("disconnectBtn")!;
const injectFlash = document.getElementById("injectFlash")!;

// --- Permission: inline banner, not blocking ---

permBtn.addEventListener("click", () => invoke("open_accessibility_settings"));

async function checkPerm(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_accessibility");
  } catch {
    return false;
  }
}

async function updatePermBanner() {
  const granted = await checkPerm();
  permBanner.style.display = granted ? "none" : "block";
}

// --- Status ---

function setStatus(state: "connected" | "waiting" | "disconnected", text: string) {
  statusDot.className = state === "connected" ? "dot on" : state === "waiting" ? "dot wait" : "dot off";
  statusText.textContent = text;
  qrCard.style.display = state === "connected" ? "none" : "block";
  lastMsg.style.display = state === "connected" ? "block" : "none";
  disconnectBtn.style.display = state === "connected" ? "block" : "none";
  invoke("update_tray_status", { connected: state === "connected" });
}

function flashInject() {
  injectFlash.classList.add("show");
  setTimeout(() => injectFlash.classList.remove("show"), 600);
}

function renderQR(url: string) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&format=svg`;
  qrContainer.innerHTML = `<img src="${src}" alt="QR">`;
}

// --- Room ---

async function createRoom() {
  setStatus("disconnected", "未连接");
  qrContainer.innerHTML = '<span style="color:#999;font-size:12px">生成中...</span>';
  try {
    const r = await invoke<{
      room_id: string; token: string; pair_secret: string; device_id: string;
    }>("create_room", { apiBase: API_BASE });
    roomId = r.room_id;
    pairSecret = r.pair_secret;
    deviceId = r.device_id;
    renderQR(`${PWA_BASE}/?room=${roomId}&secret=${pairSecret}`);
    connectWS();
  } catch {
    qrContainer.innerHTML = '<span style="color:#FF3B30;font-size:12px">生成失败，重试中...</span>';
    setTimeout(createRoom, 3000);
  }
}

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function cleanupWS() {
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    ws = null;
  }
}

function connectWS() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  cleanupWS();

  const socket = new WebSocket(`${WS_BASE}/api/room/${roomId}/ws`);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    socket.send(JSON.stringify({ type: "auth", pairSecret, deviceId, role: "desktop" }));
    setStatus("waiting", "等待手机扫码...");
    reconnectAttempt = 0;
    startHeartbeat();
  };

  socket.onmessage = (e) => {
    if (ws !== socket) return;
    let msg: any;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case "status":
        if (msg.phoneOnline) {
          setStatus("connected", "已连接");
          updatePermBanner();
        } else {
          setStatus("waiting", "等待手机连接...");
        }
        break;
      case "text":
        lastMsg.textContent = msg.text.length > 60 ? msg.text.slice(0, 60) + "…" : msg.text;
        invoke("inject_text", { text: msg.text }).then(() => flashInject()).catch(() => {
          lastMsg.textContent = `[注入失败] ${msg.text}`;
        });
        break;
      case "error":
        if (msg.code === "AUTH_FAILED" || msg.code === "UNKNOWN") {
          invoke("clear_pairing");
          cleanupWS();
          createRoom();
        }
        break;
    }
  };

  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    stopHeartbeat();
    if (e.code >= 4001 && e.code <= 4004) return;
    // Exponential backoff: 2s, 3s, 4.5s, ... max 15s
    const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempt), 15000);
    reconnectAttempt++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (roomId) connectWS(); }, delay);
  };

  socket.onerror = () => {};
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// --- Actions ---

disconnectBtn.addEventListener("click", () => {
  cleanupWS();
  roomId = "";
  invoke("clear_pairing");
  setStatus("disconnected", "未连接");
  createRoom();
});

repairBtn.addEventListener("click", () => {
  cleanupWS();
  invoke("clear_pairing");
  createRoom();
});

// --- Init ---

async function init() {
  // Check permission — show/hide banner (non-blocking)
  await updatePermBanner();

  // Check saved pairing
  const saved = await invoke<{ room_id: string; pair_secret: string; device_id: string } | null>("get_saved_pairing");

  if (saved?.room_id) {
    // Has pairing → background reconnect, don't show window
    roomId = saved.room_id;
    pairSecret = saved.pair_secret;
    deviceId = saved.device_id;
    renderQR(`${PWA_BASE}/?room=${roomId}&secret=${pairSecret}`);
    setStatus("waiting", "重连中...");
    connectWS();
  } else {
    // No pairing → show window
    await invoke("show_window");
    createRoom();
  }
}

// --- Entry ---

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => init().catch(console.error), 300);
});

// Silently poll permission in background (no focus stealing, just hides the banner)
setInterval(() => updatePermBanner(), 3000);
