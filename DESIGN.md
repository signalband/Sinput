# Design System — Sinput

## Product Context
- **What this is:** 手机语音输入直达电脑光标的跨设备传输工具
- **Who it's for:** Vibe coder（初期），广泛语音输入用户（长期）
- **Space/industry:** 开发者工具 / 生产力工具
- **Project type:** PWA（手机）+ macOS Tauri menubar app（电脑）

## Aesthetic Direction
- **Direction:** Brutally Minimal
- **Decoration level:** Minimal — 字体和绿色指示灯做所有设计工作，无纹理/渐变/阴影层级
- **Mood:** 像 AirPods 充电盒——打开就用，不需要思考。精密工具的隐形感，不是华丽界面的存在感。
- **Design language:** "话筒"而非"聊天"——大输入区 + 大按钮，无消息气泡/对话历史
- **Default theme:** Dark-first（vibe coder 活在深色终端里）

## Typography
- **Display/Brand:** Geist — 为开发者工具设计的现代字体，克制但有辨识度
- **Body (PWA):** system-ui — 跟随手机系统字体，零加载延迟，原生感
- **Body (Desktop):** Geist — 与 display 统一，macOS webview 加载快
- **UI/Labels:** same as body
- **Data/Tables:** Geist Mono — 同族配对，支持 tabular-nums
- **Code:** Geist Mono
- **Loading:** CDN `https://cdn.jsdelivr.net/npm/geist@1/dist/fonts/geist-sans/style.css`
- **Scale:**
  - Caption: 11px / 0.6875rem
  - Small: 12px / 0.75rem
  - Body: 14px / 0.875rem
  - Input: 16px / 1rem（防止 iOS 缩放）
  - Heading: 20px / 1.25rem
  - Display: 36px / 2.25rem

## Color
- **Approach:** Restrained — 一个功能色 + 中性灰，颜色不做装饰只做信号
- **Primary:** #22C55E — 连接/成功/激活态。产品的唯一颜色标识。
- **Primary AA:** #16A34A — 文本级绿色，4.5:1 对比度合规
- **Neutrals (Light):**
  - Background: #FAFAFA
  - Surface: #FFFFFF
  - Text Primary: #171717
  - Text Secondary: #737373
  - Border: #E5E5E5
- **Neutrals (Dark):**
  - Background: #0A0A0A
  - Surface: #171717
  - Text Primary: #FAFAFA
  - Text Secondary: #A3A3A3
  - Border: #262626
- **Semantic:**
  - Success: #22C55E
  - Warning: #F59E0B
  - Error: #EF4444
  - Info: #3B82F6
- **Dark mode:** Dark-first 设计。Light mode 作为可选项。语义色在 dark 模式下保持相同色值，通过 20% opacity 背景创建徽章效果。

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — 少量元素，充足呼吸空间
- **Scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px
- **PWA padding:** 16px (4 × 4)

## Layout
- **Approach:** Single-column, content-first
- **Grid:** 无需多列——PWA 和 desktop popover 都是单列
- **Max content width:** PWA 不限（全屏）；Desktop popover 260px
- **Border radius:**
  - sm: 4px（小元素）
  - md: 8px（popover、代码块）
  - lg: 12px（按钮、输入框、卡片）
  - full: 9999px（徽章、状态点）
  - phone: 32px（手机外框视觉）

## Motion
- **Approach:** Minimal-functional — 只有状态通信，无装饰性动画
- **Easing:** ease-in-out（呼吸动效）, ease-out（出现）
- **Animations:**
  - Connection pulse: 2s ease-in-out infinite（opacity 1→0.5→1 + scale 1→0.95→1）
  - Send confirm: fade-in 200ms → hold 500ms → fade-out 200ms
  - Reconnecting: 状态栏 opacity 脉冲
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- **No motion:** 无页面转场、无滚动动画、无入场效果

## Interaction States
- **Send feedback:** 轻微——文本框清空 + 顶部短暂 ✓（0.5s 后消失）
- **Magic moment:** 首次发送成功时显示 "✨ 已到达电脑光标"（仅首次）
- **Offline:** 发送按钮置灰 + 显示"等待电脑连接"
- **Error:** 红色状态文字 + "点击重试"
- **Desktop success:** menubar 图标短暂闪烁 ✓

## Responsive
- **PWA:** 竖屏锁定
- **Keyboard adaptation:** `position: fixed; bottom: 0` + `visualViewport` API
- **Touch targets:** ≥ 48×48px
- **Desktop popover:** 固定 260px 宽度

## Accessibility
- **Contrast:** 正文使用 #16A34A（4.5:1 AA），非文本使用 #22C55E（3.2:1 AA Large）
- **Status announcements:** `aria-live="polite"` 播报连接状态变化
- **Keyboard nav:** Tab 顺序自然（文本框 → 发送按钮）
- **Screen reader:** 状态变化、发送确认、错误提示均通过 aria 播报

## Anti-Patterns (DO NOT)
- 不用蓝色/紫色渐变（AI 模板感）
- 不做消息气泡/对话界面
- 不加装饰性图标或插画
- 不用圆角头像或社交元素
- 不加 loading skeleton（app 太小用不上）
- 首次使用后不显示 logo/app name（零品牌 = 品牌）

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-21 | Initial design system | Created by /design-consultation, Brutally Minimal aesthetic |
| 2026-03-21 | Dark-first default | Target users (vibe coders) live in dark terminals |
| 2026-03-21 | Green #22C55E as sole accent | "Connected" = green, universal signal language |
| 2026-03-21 | system-ui for PWA body | Zero loading, native feel on every phone |
| 2026-03-21 | Geist for brand/desktop | Modern dev-tool identity without Vercel lock-in feel |
| 2026-03-21 | Clipboard ⌘V injection | 100% app compatibility vs CGEvent Unicode risk |
