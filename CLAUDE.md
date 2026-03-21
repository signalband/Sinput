# Sinput

手机语音输入直达电脑光标。PWA + macOS Tauri menubar app + Cloudflare Worker WebSocket relay。

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Tech Stack
- **Worker:** Cloudflare Durable Objects (TypeScript)
- **PWA:** Vanilla HTML/JS (no framework)
- **Desktop:** Tauri 2.0 menubar app (Rust + TypeScript)
- **Shared:** TypeScript types in `shared/` package
- **Package manager:** pnpm workspace

## Key Architecture Decisions
- 文字注入：剪贴板模拟 ⌘V（保存→写入→⌘V→150ms delay→恢复全部 pasteboard items）
- 安全：QR 码嵌入 pairSecret，每次连接验证
- 域名：sinput.jowork.work
- 默认主题：Dark-first

## Project Structure
```
Sinput/
  worker/     ← Cloudflare Worker + Durable Object
  pwa/        ← 手机端 PWA
  desktop/    ← Tauri menubar app
  shared/     ← 共享类型定义（消息协议）
```
