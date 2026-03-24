<p align="center">
  <img src="pwa/public/icon-512.png" alt="Sinput" width="128" height="128">
</p>

<h1 align="center">Sinput</h1>

<p align="center">
  <strong>Phone voice input → Computer cursor. Instantly.</strong><br>
  手机语音输入，直达电脑光标。
</p>

<p align="center">
  <a href="#how-it-works">How It Works</a> •
  <a href="#download">Download</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#中文说明">中文说明</a>
</p>

---

## What is Sinput?

Sinput lets you use your phone's voice keyboard to type on your computer. Open the phone app, speak, and text appears at your computer's cursor — in any application.

No drivers. No Bluetooth pairing. No app install on your phone (it's a PWA).

**Sinput 是什么？** 用手机语音键盘在电脑上打字。打开手机端，说话，文字直接出现在电脑光标处——任何应用都行。

## How It Works

```
📱 Phone (PWA)  →  ☁️ Cloudflare Worker  →  💻 Desktop App (menubar)
   voice input       WebSocket relay          clipboard → paste
```

1. **Pair** — Desktop app shows a 6-digit code. Enter it on your phone.
2. **Speak** — Use your phone's voice keyboard (or type). Hit send.
3. **Done** — Text appears at your computer's cursor position.

The desktop app writes text to the clipboard, simulates ⌘V (macOS) or Ctrl+V (Windows), then restores your original clipboard — all in ~150ms.

## Download

### Desktop App

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [Sinput.dmg](https://github.com/signalband/Sinput/releases/latest) |
| **Windows** (x64) | [Sinput.msi](https://github.com/signalband/Sinput/releases/latest) |

> **macOS users:** If you see *"Sinput is damaged and can't be opened"*, run this in Terminal after installing:
> ```bash
> xattr -cr /Applications/Sinput.app
> ```
> This removes the macOS quarantine flag. The app is open-source and safe — Apple just blocks unsigned apps by default.

### Phone (PWA)

Open **[sinput.jowork.work](https://sinput.jowork.work)** on your phone browser. Add to home screen for the best experience.

Works on iOS Safari, Chrome, and Android browsers.

## Features

- **Universal** — Works with any app that accepts paste (VS Code, browsers, Slack, etc.)
- **Fast** — WebSocket relay, ~100ms latency
- **Private** — No account required. Pair codes expire in 30 seconds. Rooms auto-destruct.
- **Offline-resilient** — PWA with service worker. Auto-reconnects on network changes.
- **Minimal** — Menubar app on desktop. Single input field on phone. Nothing else.

## Architecture

| Component | Tech | Location |
|-----------|------|----------|
| **Phone PWA** | Vanilla HTML/JS, Service Worker | `pwa/` |
| **Desktop App** | Tauri 2.0 (Rust + TypeScript) | `desktop/` |
| **WebSocket Relay** | Cloudflare Workers + Durable Objects | `worker/` |
| **Shared Types** | TypeScript | `shared/` |

## Self-Hosting

You can deploy your own WebSocket relay:

```bash
# Clone
git clone https://github.com/signalband/Sinput.git
cd Sinput

# Install dependencies
pnpm install

# Deploy the Worker (needs a Cloudflare account)
cd worker
npx wrangler deploy

# Deploy the PWA (Cloudflare Pages)
cd ../pwa
npx wrangler pages deploy public --project-name=sinput-pwa
```

Update `API_BASE` and `HTTP_BASE` in `pwa/public/index.html` to point to your Worker URL.

## Development

```bash
pnpm install

# Terminal 1: Worker (local)
pnpm dev:worker

# Terminal 2: Desktop app
pnpm dev:desktop

# Terminal 3: PWA (http://localhost:3000)
pnpm dev:pwa
```

## Security

- Pair codes are 6-digit, single-use, and expire in 30 seconds
- Each room has a unique `pairSecret` verified on every WebSocket connection
- Rooms auto-destroy after 10 minutes of inactivity
- No data is stored — messages are relayed in real-time, never persisted
- The relay server never sees your clipboard contents (only the text you explicitly send)

## License

MIT

---

# 中文说明

## Sinput 是什么？

Sinput 让你用手机的语音键盘在电脑上打字。打开手机网页，说话，文字直接出现在电脑光标处。

**无需安装驱动，无需蓝牙配对，手机端无需安装 App**（是一个 PWA 网页应用）。

## 工作原理

```
📱 手机 (PWA)  →  ☁️ Cloudflare Worker  →  💻 桌面端 (菜单栏应用)
   语音输入         WebSocket 中继           剪贴板 → 粘贴
```

1. **配对** — 桌面端显示 6 位配对码，在手机上输入
2. **说话** — 用手机语音键盘（或手打），点发送
3. **完成** — 文字出现在电脑光标位置

桌面端将文字写入剪贴板，模拟 ⌘V（macOS）或 Ctrl+V（Windows），然后恢复原始剪贴板内容——全程约 150ms。

## 下载

### 桌面端

| 平台 | 下载 |
|------|------|
| **macOS** (Apple Silicon) | [Sinput.dmg](https://github.com/signalband/Sinput/releases/latest) |
| **Windows** (x64) | [Sinput.msi](https://github.com/signalband/Sinput/releases/latest) |

### 手机端 (PWA)

用手机浏览器打开 **[sinput.jowork.work](https://sinput.jowork.work)**，添加到主屏幕获得最佳体验。

支持 iOS Safari、Chrome 和 Android 浏览器。

> **macOS 用户：** 如果打开时提示 *"Sinput 已损坏，无法打开"*，在终端执行：
> ```bash
> xattr -cr /Applications/Sinput.app
> ```
> 这会移除 macOS 隔离标记。本应用开源安全，Apple 默认阻止未签名应用。

## 特性

- **通用** — 支持所有接受粘贴的应用（VS Code、浏览器、Slack 等）
- **快速** — WebSocket 中继，延迟约 100ms
- **隐私** — 无需注册账号。配对码 30 秒过期。房间自动销毁。
- **断线恢复** — PWA 支持离线。网络变化时自动重连。
- **极简** — 桌面端是菜单栏应用，手机端只有一个输入框。

## 自部署

```bash
git clone https://github.com/signalband/Sinput.git
cd Sinput && pnpm install

# 部署 Worker（需要 Cloudflare 账号）
cd worker && npx wrangler deploy

# 部署 PWA
cd ../pwa && npx wrangler pages deploy public --project-name=sinput-pwa
```

修改 `pwa/public/index.html` 中的 `API_BASE` 和 `HTTP_BASE` 指向你的 Worker URL。

## 开发

```bash
pnpm install

# 终端 1: Worker（本地）
pnpm dev:worker

# 终端 2: 桌面端
pnpm dev:desktop

# 终端 3: PWA (http://localhost:3000)
pnpm dev:pwa
```
