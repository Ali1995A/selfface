# selfface

纯前端静态站点：iPad Safari/微信内置浏览器运行；前置摄像头实时预览 + 人脸贴纸叠加 + 一键录制 3 秒导出 GIF；同时支持麦克风与字幕（双策略）。

## 功能

- 摄像头：`getUserMedia({ video: { facingMode: "user" }, audio: true })`
- 渲染管线：`video -> canvas -> 叠加 PNG 贴纸 -> 叠加字幕 -> canvas`
- GIF：默认 `360x360`，`10fps`，`3s`，共 `30` 帧；`gif.js` 使用 web worker
- UI：3 个按钮（开始预览 / 录制 GIF / 下载 GIF）+ 1 个字幕策略开关；显示编码进度百分比
- 字幕策略：
  - **实时字幕优先**：优先 `webkitSpeechRecognition`（若环境不支持会提示）
  - **稳定字幕优先**：录音后用 `whisper.wasm` 转写，再把字幕绘制进每一帧

## 本地开发（HTTPS）

> iOS Safari / 微信内置浏览器需要 **HTTPS**（或 `localhost` 安全上下文）才能调用摄像头/麦克风。
>
> 注：部分微信内置浏览器/企业微信 WebView 可能会限制 `getUserMedia`、`SpeechRecognition`、`ServiceWorker` 等能力，出现提示时请优先用 iPad Safari 验证。

### 方式 A：Vite（推荐）

1. 安装依赖：`npm i`
2. 启动（HTTPS + 局域网访问）：`npm run dev:https`
3. iPad 访问：在同一局域网，打开 `https://你的电脑IP:5173`

首次使用自签名证书时，iOS 需要手动信任证书（或直接部署到公网 HTTPS）。

构建产物（可选）：`npm run build` 会生成 `dist/`，并自动复制 `assets/` 到 `dist/assets/`，可直接部署 `dist/`。

### 方式 B：直接部署静态文件

把整个目录部署到任何支持 HTTPS 的静态托管（如 Nginx / Cloudflare Pages / Netlify / Vercel）。

## 部署注意：whisper.wasm（稳定字幕）

`whisper.wasm`（浏览器端 Whisper）通常需要更强的设备，并可能依赖 `SharedArrayBuffer`（部分实现要求 **COOP/COEP** 头）。
首次使用可能会下载较大的 wasm/模型文件，等待时间取决于网络与设备性能。

- 如果你发现稳定字幕初始化失败或非常慢：页面会自动降级为“无字幕”或建议你改用“实时字幕优先”
- 若你的托管支持设置响应头，建议开启：
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`

## 文件结构

- `index.html` / `style.css` / `app.js`
- `assets/jeeliz/*`：jeelizFaceFilter（人脸跟踪）
- `assets/libs/*`：gif.js（GIF 编码 + worker）
- `assets/stt/*`：whisper.wasm 相关（稳定字幕）
- `assets/stickers/*.png`：示例贴纸（预加载）
