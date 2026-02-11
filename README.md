# selfface

纯前端静态站点：iPad Safari/微信内置浏览器运行；前置摄像头实时预览 + 人脸贴纸叠加 + 一键录制 3 秒导出 GIF。

## 功能

- 摄像头：`getUserMedia({ video: { facingMode: "user" }, audio: false })`
- 渲染管线：`video -> canvas -> 叠加 PNG 贴纸 -> canvas`
- GIF：默认 `360x360`，`10fps`，`3s`，共 `30` 帧；`gif.js` 使用 web worker
- UI：WeChat 风格预览 + 特效面板 + 快门（长按/点按录制）+ 结果页下载/分享；显示生成进度

## 本地开发（HTTPS）

> iOS Safari / 微信内置浏览器需要 **HTTPS**（或 `localhost` 安全上下文）才能调用摄像头。
>
> 注：部分微信内置浏览器/企业微信 WebView 可能会限制 `getUserMedia` 等能力，出现提示时请优先用 iPad Safari 验证。

### 方式 A：Vite（推荐）

1. 安装依赖：`npm i`
2. 启动（HTTPS + 局域网访问）：`npm run dev:https`
3. iPad 访问：在同一局域网，打开 `https://你的电脑IP:5173`

首次使用自签名证书时，iOS 需要手动信任证书（或直接部署到公网 HTTPS）。

构建产物（可选）：`npm run build` 会生成 `dist/`，并自动复制 `assets/` 到 `dist/assets/`，可直接部署 `dist/`。

### 方式 B：直接部署静态文件

把整个目录部署到任何支持 HTTPS 的静态托管（如 Nginx / Cloudflare Pages / Netlify / Vercel）。

## 文件结构

- `index.html` / `style.css` / `app.js`
- `assets/jeeliz/*`：jeelizFaceFilter（人脸跟踪）
- `assets/libs/*`：gif.js（GIF 编码 + worker）
- `assets/stickers/*.png`：示例贴纸（预加载）
