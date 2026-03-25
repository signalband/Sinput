import { invoke } from "@tauri-apps/api/core";
import { PAIR_CODE_TTL_MS, MAX_RECONNECT_ATTEMPTS } from "@sinput/shared";

const API_BASE = "https://ws.sinput.jowork.work";
const WS_BASE = "wss://ws.sinput.jowork.work";
const PWA_BASE = "https://sinput.jowork.work";

// --- State Machine ---
//
//  unpaired ──(phone connects)──→ paired-connected
//     ↑                               │
//     │ disconnect                     │ phone disconnects
//     │                               ↓
//     └──────────────────────── paired-waiting
//                                     │
//                              reconnecting (ws lost)
//                                     │
//                              reconnect-failed (5x)

type AppState = "unpaired" | "paired-waiting" | "paired-connected" | "reconnecting" | "reconnect-failed";

let appState: AppState = "unpaired";
let ws: WebSocket | null = null;
let roomId = "";
let pairSecret = "";
let deviceId = "";
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let codeTimer: ReturnType<typeof setInterval> | null = null;
let countdownVal = PAIR_CODE_TTL_MS / 1000;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let unpairConfirmTimer: ReturnType<typeof setTimeout> | null = null;

// --- Elements ---

const permBanner = document.getElementById("permBanner")!;
const permBtn = document.getElementById("permBtn")!;
const statusDot = document.getElementById("statusDot")!;
const statusText = document.getElementById("statusText")!;
const lastMsg = document.getElementById("lastMsg")!;
const pairingView = document.getElementById("pairingView")!;
const connectedView = document.getElementById("connectedView")!;
const failedView = document.getElementById("failedView")!;
const repairSection = document.getElementById("repairSection")!;
const qrContainer = document.getElementById("qrContainer")!;
const pairCodeEl = document.getElementById("pairCode")!;
const countdownEl = document.getElementById("countdown")!;
const disconnectBtn = document.getElementById("disconnectBtn")!;
const repairBtn = document.getElementById("repairBtn")!;
const retryBtn = document.getElementById("retryBtn")!;
const injectFlash = document.getElementById("injectFlash")!;

// --- Render: single function maps state → UI ---

function render() {
  // Status indicator
  switch (appState) {
    case "unpaired":
      statusDot.className = "dot off";
      statusText.textContent = "未连接";
      break;
    case "paired-waiting":
      statusDot.className = "dot wait";
      statusText.textContent = "等待手机连接...";
      break;
    case "paired-connected":
      statusDot.className = "dot on";
      statusText.textContent = "已连接";
      break;
    case "reconnecting":
      statusDot.className = "dot wait";
      statusText.textContent = "重新连接中...";
      break;
    case "reconnect-failed":
      statusDot.className = "dot off";
      statusText.textContent = "连接失败";
      break;
  }

  // View visibility
  const showPairing = appState === "unpaired" || appState === "paired-waiting";
  const showConnected = appState === "paired-connected";
  const showFailed = appState === "reconnect-failed";

  pairingView.classList.toggle("active", showPairing);
  connectedView.classList.toggle("active", showConnected);
  failedView.classList.toggle("active", showFailed);
  repairSection.style.display = showPairing ? "block" : "none";

  // Last message only when connected
  lastMsg.style.display = showConnected ? "block" : "none";

  // Tray
  invoke("update_tray_status", { connected: showConnected });
}

function setState(newState: AppState) {
  appState = newState;
  render();
}

// --- Permission ---

permBtn.addEventListener("click", () => invoke("open_accessibility_settings"));

async function checkPerm(prompt = false): Promise<boolean> {
  try { return await invoke<boolean>("check_accessibility", { prompt }); }
  catch { return false; }
}

async function updatePermBanner() {
  permBanner.style.display = (await checkPerm()) ? "none" : "block";
}

// --- Inject flash ---

function flashInject() {
  injectFlash.classList.add("show");
  setTimeout(() => injectFlash.classList.remove("show"), 600);
}

// --- QR ---

function renderQR(url: string) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&format=svg`;
  qrContainer.innerHTML = `<img src="${src}" alt="QR">`;
}

// --- Pair Code with fade transition ---

async function registerPairCode() {
  try {
    const res = await fetch(`${API_BASE}/api/pair-code/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, pairSecret }),
    });
    const data = await res.json();
    if (data.code) {
      // Fade out → update → fade in
      pairCodeEl.style.opacity = "0";
      setTimeout(() => {
        pairCodeEl.textContent = data.code;
        pairCodeEl.style.opacity = "1";
      }, 200);
    }
  } catch {
    pairCodeEl.textContent = "------";
  }
}

function startCodeRefresh() {
  stopCodeRefresh();
  countdownVal = PAIR_CODE_TTL_MS / 1000;
  countdownEl.textContent = String(countdownVal);
  registerPairCode();

  codeTimer = setInterval(() => {
    countdownVal--;
    if (countdownVal <= 0) {
      countdownVal = PAIR_CODE_TTL_MS / 1000;
      registerPairCode();
    }
    countdownEl.textContent = String(countdownVal);
  }, 1000);
}

function stopCodeRefresh() {
  if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
  pairCodeEl.textContent = "------";
}

// --- Room ---

async function createRoom() {
  setState("unpaired");
  qrContainer.innerHTML = `<span style="color:var(--text2);font-size:12px">生成中...</span>`;
  try {
    const r = await invoke<{
      room_id: string; token: string; pair_secret: string; device_id: string;
    }>("create_room", { apiBase: API_BASE });
    roomId = r.room_id;
    pairSecret = r.pair_secret;
    deviceId = r.device_id;
    renderQR(`${PWA_BASE}/?room=${roomId}&secret=${pairSecret}`);
    startCodeRefresh();
    connectWS();
  } catch {
    qrContainer.innerHTML = `<span style="color:var(--red);font-size:12px">生成失败，重试中...</span>`;
    setTimeout(createRoom, 3000);
  }
}

// --- WebSocket ---

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
    setState("paired-waiting");
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
          setState("paired-connected");
          stopCodeRefresh();
          updatePermBanner();
        } else {
          setState("paired-waiting");
          if (roomId && pairSecret) startCodeRefresh();
        }
        break;
      case "text":
        lastMsg.textContent = msg.text.length > 60 ? msg.text.slice(0, 60) + "…" : msg.text;
        invoke("inject_text", { text: msg.text }).then(() => flashInject()).catch(() => {
          lastMsg.textContent = `[注入失败] ${msg.text}`;
        });
        break;
      case "error":
        if (["AUTH_FAILED", "ROOM_DESTROYED", "TOKEN_EXPIRED", "UNKNOWN"].includes(msg.code)) {
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
    // Auth/room errors (4001-4007): room is dead, create a new one
    if (e.code >= 4001 && e.code <= 4007) {
      invoke("clear_pairing");
      createRoom();
      return;
    }
    scheduleReconnect();
  };

  socket.onerror = () => {};
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempt++;

  if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    setState("reconnect-failed");
    return;
  }

  setState("reconnecting");
  const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempt - 1), 15000);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(); }, delay);
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

// Double-click confirm for disconnect
disconnectBtn.addEventListener("click", () => {
  if (unpairConfirmTimer) {
    // Second click — execute disconnect
    clearTimeout(unpairConfirmTimer);
    unpairConfirmTimer = null;
    disconnectBtn.textContent = "断开连接";
    disconnectBtn.classList.remove("confirm");
    cleanupWS();
    roomId = "";
    invoke("clear_pairing");
    createRoom();
    return;
  }
  // First click — show confirmation
  disconnectBtn.textContent = "确认断开?";
  disconnectBtn.classList.add("confirm");
  unpairConfirmTimer = setTimeout(() => {
    unpairConfirmTimer = null;
    disconnectBtn.textContent = "断开连接";
    disconnectBtn.classList.remove("confirm");
  }, 2000);
});

retryBtn.addEventListener("click", () => {
  reconnectAttempt = 0;
  if (roomId) {
    connectWS();
  } else {
    createRoom();
  }
});

repairBtn.addEventListener("click", () => {
  cleanupWS();
  invoke("clear_pairing");
  createRoom();
});

// --- Init ---

async function init() {
  // First launch: if no accessibility permission, auto-open System Settings prompt
  const hasPerm = await checkPerm(true); // prompt=true → opens Settings if not trusted
  permBanner.style.display = hasPerm ? "none" : "block";

  const saved = await invoke<{ room_id: string; pair_secret: string; device_id: string } | null>("get_saved_pairing");

  if (saved?.room_id) {
    roomId = saved.room_id;
    pairSecret = saved.pair_secret;
    deviceId = saved.device_id;
    renderQR(`${PWA_BASE}/?room=${roomId}&secret=${pairSecret}`);
    setState("paired-waiting");
    connectWS();
  } else {
    await invoke("show_window");
    createRoom();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => init().catch(console.error), 300);
});

// Poll permission in background
setInterval(() => updatePermBanner(), 3000);
