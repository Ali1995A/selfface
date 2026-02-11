/* global GIF */

import JEELIZFACEFILTER from "./assets/jeeliz/jeelizFaceFilter.moduleES6.js";

const OUTPUT_SIZE = 360;
const FPS = 10;
const DURATION_S = 3;
const FRAME_COUNT = FPS * DURATION_S;
const FRAME_DELAY_MS = Math.round(1000 / FPS);

const els = {
  canvas: document.getElementById("outputCanvas"),
  status: document.getElementById("statusLine"),
  progress: document.getElementById("progressLine"),
  video: document.getElementById("inputVideo"),
  jeelizCanvas: document.getElementById("jeelizCanvas"),
  gifPreview: document.getElementById("gifPreview"),
  effectFromName: document.getElementById("effectFromName"),

  sheet: document.getElementById("sheet"),
  sheetCollapsed: document.getElementById("sheetCollapsed"),
  sheetExpanded: document.getElementById("sheetExpanded"),
  btnSheetHandle: document.getElementById("btnSheetHandle"),
  btnDockChevron: document.getElementById("btnDockChevron"),
  btnShutter: document.getElementById("btnShutter"),
  btnSwitchCam: document.getElementById("btnSwitchCam"),

  effectStrip: document.getElementById("effectStrip"),
  effectGrid: document.getElementById("effectGrid"),

  resultPanel: document.getElementById("resultPanel"),
  btnRetake: document.getElementById("btnRetake"),
  btnDownload: document.getElementById("btnDownload"),
  btnShare: document.getElementById("btnShare"),

  btnSubRealtime: document.getElementById("btnSubRealtime"),
  btnSubStable: document.getElementById("btnSubStable"),
};

const ctx = els.canvas.getContext("2d", { alpha: false, desynchronized: true });

let mediaStream = null;
let micStream = null;
let faceState = null;
let rafId = 0;
let isPreviewing = false;
let isRecording = false;
let lastGifBlob = null;
let lastGifUrl = null;
let currentFacingMode = "user"; // "user" | "environment"
let hasMic = false;
let hasRequestedPermissions = false;
let lastStreamFacingMode = null;

let stickerImg = null;
let stickerReady = false;
let imageCache = new Map(); // url -> Image
let currentEffect = null;
let frameImg = null;

let captionText = "";
let captionSource = "none"; // "webspeech" | "whisper" | "none"
let webSpeech = null;
let whisperTranscriber = null;
let whisperReady = false;
let subtitleMode = "realtime"; // "realtime" | "stable"

const effects = [
  { id: "none", name: "无特效", from: "WeChat Effect", sticker: null, thumb: "none" },
  { id: "thanksBoss", name: "谢谢老板", from: "WeChat Effect", sticker: "./assets/stickers/glasses.png" },
  { id: "newYear", name: "新年好", from: "MurphyM", sticker: "./assets/stickers/mustache.png" },
  { id: "gongXiFaCai", name: "恭喜发财", from: "MurphyM", sticker: "./assets/stickers/crown.png" },
  {
    id: "comedyGlasses",
    name: "搞笑眼镜",
    from: "jeelizFaceFilter",
    sticker: "./assets/templates/jeeliz/comedy-glasses.png",
    placement: { scale: 2.15, offsetX: 0, offsetY: -0.08, clamp: [140, 320] },
  },
  {
    id: "catFace",
    name: "猫猫",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/cat.png",
    placement: { scale: 2.35, offsetX: 0, offsetY: -0.02, clamp: [140, 320] },
  },
  {
    id: "dogFace",
    name: "狗狗",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/dog.png",
    placement: { scale: 2.35, offsetX: 0, offsetY: -0.02, clamp: [140, 320] },
  },
  {
    id: "flowerBand",
    name: "花环",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/flower_hairband.png",
    placement: { scale: 2.45, offsetX: 0, offsetY: -0.36, clamp: [160, 340] },
  },
  {
    id: "devilHorn",
    name: "小恶魔",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/evil_horn_eye.png",
    placement: { scale: 2.35, offsetX: 0, offsetY: -0.32, clamp: [150, 340] },
  },
  {
    id: "eyeFx",
    name: "眼神",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/eye.png",
    placement: { scale: 2.0, offsetX: 0, offsetY: -0.02, clamp: [120, 300], alpha: 0.75 },
  },
  {
    id: "baldHair",
    name: "秃一点",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/bald_hair.png",
    placement: { scale: 2.6, offsetX: 0, offsetY: -0.38, clamp: [170, 360] },
  },
  {
    id: "skeleton",
    name: "骷髅面具",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/skeleton_mask.png",
    placement: { scale: 2.15, offsetX: 0, offsetY: 0.06, clamp: [160, 340], alpha: 0.62 },
  },
  {
    id: "neonMask",
    name: "霓虹口罩",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/neon_facemask.png",
    placement: { scale: 2.05, offsetX: 0, offsetY: 0.1, clamp: [140, 300], alpha: 0.7 },
  },
  {
    id: "bald",
    name: "光头",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/bald.png",
    placement: { scale: 2.5, offsetX: 0, offsetY: -0.34, clamp: [160, 360] },
  },
  {
    id: "edgeSparkles",
    name: "金闪闪",
    from: "selfface",
    sticker: null,
  },
  {
    id: "fireworksFrame",
    name: "烟花框",
    from: "jeelizFaceFilter",
    sticker: null,
    frame: "./assets/templates/jeeliz/frame_fireworks.png",
  },
  {
    id: "warmVignette",
    name: "暖色",
    from: "selfface",
    sticker: null,
    filter: "warmVignette",
  },
  { id: "more", name: "更多特效", from: "", sticker: null, thumb: "more" },
];
let selectedEffectId = "thanksBoss";
let shutterProgressRaf = 0;
let shutterProgressStart = 0;
let shutterProgressDuration = DURATION_S * 1000;
let effectState = { id: "none", startedAt: performance.now(), seed: 1, particles: [] };

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  // Mulberry32
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRectPath(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function drawWeChatText(context, text, { x, y, fontSize = 54, fill = "#ffffff", stroke = "#000000", strokeW = 10 }) {
  context.save();
  context.font = `900 ${fontSize}px -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.miterLimit = 2;
  if (strokeW > 0) {
    context.lineWidth = strokeW;
    context.strokeStyle = stroke;
    context.strokeText(text, x, y);
  }
  context.fillStyle = fill;
  context.fillText(text, x, y);
  context.restore();
}

function drawEffectOverlay(context, nowMs) {
  const t = (nowMs - effectState.startedAt) / 1000;
  const id = effectState.id;

  if (id === "thanksBoss") {
    // Money background: subtle drifting banknotes behind.
    context.save();
    for (const b of effectState.particles) {
      const dx = Math.sin(t * b.w + b.p) * 5;
      const dy = Math.cos(t * b.w + b.p) * 5;
      const x = b.x + dx;
      const y = b.y + dy;
      context.save();
      context.translate(x, y);
      context.rotate(b.r);
      context.scale(b.s, b.s);
      context.globalAlpha = particleAlphaOutsideFace(x, y, 0.42);
      // bill
      context.fillStyle = "rgba(120, 200, 140, 0.65)";
      context.strokeStyle = "rgba(40, 120, 70, 0.55)";
      context.lineWidth = 3;
      roundRectPath(context, -44, -24, 88, 48, 10);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(20, 80, 40, 0.4)";
      context.beginPath();
      context.ellipse(0, 0, 14, 12, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    // Red packet at bottom center
    context.globalAlpha = 0.95;
    context.fillStyle = "rgba(205, 40, 40, 0.98)";
    context.strokeStyle = "rgba(120, 10, 10, 0.8)";
    context.lineWidth = 4;
    roundRectPath(context, OUTPUT_SIZE / 2 - 34, OUTPUT_SIZE - 118, 68, 96, 14);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(255, 210, 80, 0.95)";
    context.beginPath();
    context.ellipse(OUTPUT_SIZE / 2, OUTPUT_SIZE - 78, 9, 9, 0, 0, Math.PI * 2);
    context.fill();

    // Text style similar to meme: white with black outline near bottom
    drawWeChatText(context, "谢谢老板", {
      x: OUTPUT_SIZE / 2,
      y: OUTPUT_SIZE - 52,
      fontSize: 48,
      fill: "#ffffff",
      stroke: "#000000",
      strokeW: 12,
    });
    context.restore();
    return;
  }

  if (id === "newYear") {
    // Red packets falling + golden-stroked red text
    context.save();
    for (const p of effectState.particles) {
      const yy = ((p.y + t * p.v) % (OUTPUT_SIZE + 120)) - 60;
      const xx = p.x + Math.sin(t * 1.2 + p.p) * 8;
      context.save();
      context.translate(xx, yy);
      context.rotate(p.r);
      context.globalAlpha = particleAlphaOutsideFace(xx, yy, 0.62);
      context.fillStyle = "rgba(185, 30, 30, 0.98)";
      context.strokeStyle = "rgba(120, 10, 10, 0.85)";
      context.lineWidth = 3;
      roundRectPath(context, -18, -22, 36, 44, 10);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255, 210, 80, 0.85)";
      context.fillRect(-10, -6, 20, 4);
      context.restore();
    }

    // Text: show briefly / lower area to avoid fully covering face
    const textAlpha = 1 - smoothstep(0.6, 1.4, t); // fade out after ~1s
    if (textAlpha > 0.02) {
      context.globalAlpha = 0.9 * textAlpha;
      drawWeChatText(context, "新年好", {
        x: OUTPUT_SIZE / 2,
        y: OUTPUT_SIZE * 0.76,
        fontSize: 72,
        fill: "#b21d1d",
        stroke: "#f2c25c",
        strokeW: 12,
      });
    }
    context.restore();
    return;
  }

  if (id === "gongXiFaCai") {
    // Sparkles + bottom meme text
    context.save();
    for (const s of effectState.particles) {
      const phase = t * s.v + s.p;
      const alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(phase));
      context.globalAlpha = particleAlphaOutsideFace(s.x, s.y, alpha);
      context.fillStyle = "rgba(255, 210, 80, 0.9)";
      context.beginPath();
      context.ellipse(s.x, s.y, 3 + 3 * (0.5 + 0.5 * Math.sin(phase)), 3, 0, 0, Math.PI * 2);
      context.fill();
    }
    drawWeChatText(context, "恭喜发财", {
      x: OUTPUT_SIZE / 2,
      y: OUTPUT_SIZE - 54,
      fontSize: 58,
      fill: "#ffffff",
      stroke: "#000000",
      strokeW: 12,
    });
    context.restore();
    return;
  }

  if (id === "edgeSparkles") {
    context.save();
    for (const s of effectState.particles) {
      const phase = t * s.v + s.p;
      const alpha = 0.08 + 0.22 * (0.5 + 0.5 * Math.sin(phase));
      const x = s.x + Math.sin(phase) * 6;
      const y = s.y + Math.cos(phase) * 6;
      context.globalAlpha = particleAlphaOutsideFace(x, y, alpha);
      context.fillStyle = "rgba(255, 210, 80, 0.95)";
      context.beginPath();
      context.ellipse(x, y, 2.2, 2.2, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function setStatus(text, tone = "normal") {
  els.status.textContent = text || "";
  els.status.style.color = tone === "error" ? "#d23b3b" : "#8c9096";
}

function setProgress(text) {
  els.progress.textContent = text || "";
}

function isSecureContextOk() {
  return window.isSecureContext || location.hostname === "localhost";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preloadStickers() {
  const sources = effects
    .flatMap((e) => [e.sticker, e.frame])
    .filter((s) => typeof s === "string" && s);
  const uniq = Array.from(new Set(sources));
  const res = await Promise.allSettled(uniq.map((s) => preloadImage(s)));
  for (let i = 0; i < uniq.length; i++) {
    const r = res[i];
    if (r.status === "fulfilled") imageCache.set(uniq[i], r.value);
  }
  stickerReady = true;
}

function stopTracks(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

async function requestMedia(facingMode) {
  if (!isSecureContextOk()) {
    throw new Error("必须在 HTTPS（或 localhost）下才能调用摄像头/麦克风。");
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("当前浏览器不支持 getUserMedia（无法调用摄像头/麦克风）。");
  }

  const constraints = {
    video: { facingMode: facingMode || "user" },
    audio: true,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  // iPad Safari / some WebViews may return a video-only stream even if audio:true.
  // Try a second explicit audio-only request to force the mic permission prompt and obtain an audio track.
  if (stream.getAudioTracks().length === 0) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const [audioTrack] = audioStream.getAudioTracks();
      if (audioTrack) stream.addTrack(audioTrack);
      // Stop any extra tracks from the audio-only stream (we only keep the adopted audioTrack).
      for (const t of audioStream.getTracks()) {
        if (t !== audioTrack) t.stop();
      }
    } catch {
      // ignore: we'll keep running with video-only
    }
  }

  return stream;
}

function streamIsLive(stream) {
  if (!stream) return false;
  const tracks = stream.getTracks();
  return tracks.length > 0 && tracks.some((t) => t.readyState === "live");
}

async function ensureMediaStream() {
  // Reuse existing stream to avoid repeated permission prompts.
  const needNew = !streamIsLive(mediaStream) || lastStreamFacingMode !== currentFacingMode;

  if (!needNew) return mediaStream;

  stopTracks(mediaStream);
  stopTracks(micStream);
  mediaStream = null;
  micStream = null;
  hasMic = false;

  const stream = await requestMedia(currentFacingMode);
  mediaStream = stream;
  lastStreamFacingMode = currentFacingMode;
  hasRequestedPermissions = true;

  const audioTracks = stream.getAudioTracks();
  hasMic = audioTracks.length > 0;
  micStream = hasMic ? new MediaStream(audioTracks) : null;
  return stream;
}

function attachStreamToVideo(stream) {
  els.video.srcObject = stream;
  els.video.muted = true;
  els.video.playsInline = true;
  return els.video.play().catch(() => {
    // iOS sometimes requires explicit user gesture; Start button is a gesture already.
  });
}

function waitForVideoReady(videoEl) {
  return new Promise((resolve, reject) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) return resolve();
    const to = setTimeout(() => reject(new Error("摄像头初始化超时")), 8000);
    const onReady = () => {
      if (videoEl.videoWidth > 0) {
        clearTimeout(to);
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      videoEl.removeEventListener("loadeddata", onReady);
      videoEl.removeEventListener("canplay", onReady);
      videoEl.removeEventListener("timeupdate", onReady);
    };
    videoEl.addEventListener("loadeddata", onReady);
    videoEl.addEventListener("canplay", onReady);
    videoEl.addEventListener("timeupdate", onReady);
  });
}

async function initJeelizFaceFilter() {
  if (!JEELIZFACEFILTER) throw new Error("jeelizFaceFilter 未加载");

  return new Promise((resolve, reject) => {
    JEELIZFACEFILTER.init({
      canvasId: "jeelizCanvas",
      NNCPath: "./assets/jeeliz/neuralNets/",
      videoSettings: {
        videoElement: els.video,
        facingMode: currentFacingMode,
        flipX: currentFacingMode !== "environment",
      },
      callbackReady: (errCode) => {
        if (errCode) reject(new Error(`jeelizFaceFilter 初始化失败: ${errCode}`));
        else resolve();
      },
      callbackTrack: (detectState) => {
        faceState = detectState;
      },
    });
  });
}

function destroyJeeliz() {
  try {
    if (JEELIZFACEFILTER) JEELIZFACEFILTER.destroy();
  } catch {
    // ignore
  }
}

function drawSubtitle(context, text) {
  if (!text) return;

  const padding = 12;
  const maxWidth = OUTPUT_SIZE - padding * 2;
  const fontSize = 18;

  context.save();
  context.font = `600 ${fontSize}px -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif`;
  context.textBaseline = "bottom";

  // Simple wrap (1-2 lines)
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words.length ? words : [text]) {
    const next = line ? `${line} ${w}` : w;
    if (context.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length >= 1) break;
    }
  }
  if (line) lines.push(line);

  const lineHeight = Math.round(fontSize * 1.25);
  const blockHeight = lines.length * lineHeight + 14;
  const x = OUTPUT_SIZE / 2;
  const yBottom = OUTPUT_SIZE - 14;

  // Background
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.strokeStyle = "rgba(255,255,255,0.15)";
  context.lineWidth = 1;
  roundRect(context, padding, yBottom - blockHeight, OUTPUT_SIZE - padding * 2, blockHeight, 12);
  context.fill();
  context.stroke();

  // Text (shadow)
  context.fillStyle = "rgba(255,255,255,0.95)";
  context.shadowColor = "rgba(0,0,0,0.65)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;
  for (let i = 0; i < lines.length; i++) {
    context.textAlign = "center";
    context.fillText(lines[i], x, yBottom - 10 - (lines.length - 1 - i) * lineHeight);
  }
  context.restore();
}

function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function faceToCanvasTransform(state) {
  // state.x, state.y in [-1,1], origin center; state.s is scale.
  // With flipX=true, x already matches mirrored output.
  const x = (state.x * 0.5 + 0.5) * OUTPUT_SIZE;
  const y = (state.y * -0.5 + 0.5) * OUTPUT_SIZE;
  const s = state.s * OUTPUT_SIZE; // rough
  const rz = state.rz || 0;
  return { x, y, s, rz };
}

function getFaceRegion() {
  if (!faceState || !faceState.detected || faceState.detected < 0.6) return null;
  const { x, y, s } = faceToCanvasTransform(faceState);
  const rx = clamp(s * 0.75, 70, 155);
  const ry = clamp(s * 0.95, 90, 190);
  return { x, y, rx, ry };
}

function particleAlphaOutsideFace(x, y, baseAlpha) {
  const face = getFaceRegion();
  if (!face) return baseAlpha;
  const dx = (x - face.x) / face.rx;
  const dy = (y - face.y) / face.ry;
  const d = Math.sqrt(dx * dx + dy * dy); // ~1 at ellipse boundary
  const keep = smoothstep(0.9, 1.25, d); // 0 near center, 1 outside
  return baseAlpha * (0.06 + 0.94 * keep);
}

function drawSticker(context) {
  if (!stickerReady || !stickerImg) return;
  if (!faceState || !faceState.detected || faceState.detected < 0.6) return;

  const { x, y, s, rz } = faceToCanvasTransform(faceState);
  const placement = currentEffect?.placement || { scale: 1.9, offsetX: 0, offsetY: -0.08, clamp: [70, 260] };
  const [wMin, wMax] = placement.clamp || [70, 260];
  const w = clamp(s * placement.scale, wMin, wMax);
  const h = (w / stickerImg.width) * stickerImg.height;

  context.save();
  if (typeof placement.alpha === "number") context.globalAlpha = clamp(placement.alpha, 0, 1);
  context.translate(x + s * (placement.offsetX || 0), y + s * (placement.offsetY || -0.08));
  context.rotate(rz);
  context.drawImage(stickerImg, -w / 2, -h / 2, w, h);
  context.restore();
}

function drawFrame() {
  if (!isPreviewing) return;

  const v = els.video;
  const cw = OUTPUT_SIZE;
  const ch = OUTPUT_SIZE;

  ctx.save();
  ctx.clearRect(0, 0, cw, ch);

  // Draw video to a square canvas with center-crop and mirror.
  const vw = v.videoWidth || 0;
  const vh = v.videoHeight || 0;
  if (vw && vh) {
    const side = Math.min(vw, vh);
    const sx = Math.round((vw - side) / 2);
    const sy = Math.round((vh - side) / 2);

    const shouldMirror = currentFacingMode !== "environment";
    if (shouldMirror) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, side, side, 0, 0, cw, ch);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
  }

  drawSticker(ctx);
  drawEffectOverlay(ctx, performance.now());
  drawFrameOverlay(ctx);
  drawSubtitle(ctx, captionText);

  ctx.restore();

  rafId = requestAnimationFrame(drawFrame);
}

function drawFrameOverlay(context) {
  // Color filters / vignette (minimal face occlusion)
  if (currentEffect?.filter === "warmVignette") {
    context.save();
    context.globalAlpha = 0.14;
    context.fillStyle = "#ffb36a";
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const g = context.createRadialGradient(
      OUTPUT_SIZE / 2,
      OUTPUT_SIZE / 2,
      OUTPUT_SIZE * 0.15,
      OUTPUT_SIZE / 2,
      OUTPUT_SIZE / 2,
      OUTPUT_SIZE * 0.75,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.36)");
    context.globalAlpha = 1;
    context.fillStyle = g;
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    context.restore();
  }

  // Frame image (e.g., fireworks border)
  if (frameImg) {
    context.save();
    context.globalAlpha = 0.95;
    context.drawImage(frameImg, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    context.restore();
  }
}

function stopPreview() {
  isPreviewing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  destroyJeeliz();
  stopTracks(mediaStream);
  stopTracks(micStream);
  mediaStream = null;
  micStream = null;
  hasMic = false;
  lastStreamFacingMode = null;
  faceState = null;
  stopWebSpeech();
}

function canUseWebSpeech() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function startWebSpeech() {
  try {
    const Ctor = window.webkitSpeechRecognition || window.SpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "zh-CN";

    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const next = (final || interim || "").trim();
      if (next) {
        captionText = next;
        captionSource = "webspeech";
      }
    };
    rec.onerror = () => {
      // Some WebViews throw "not-allowed" / "service-not-allowed"
      setStatus("实时字幕不可用：未获得麦克风权限或系统不支持语音识别", "error");
    };
    rec.onend = () => {
      // iOS/WebView often ends automatically; try restart while previewing and not recording stable mode.
      if (isPreviewing && subtitleMode === "realtime" && !isRecording) {
        try {
          rec.start();
        } catch {
          // ignore
        }
      }
    };
    rec.start();
    webSpeech = rec;
  } catch {
    webSpeech = null;
  }
}

function stopWebSpeech() {
  if (!webSpeech) return;
  try {
    webSpeech.onresult = null;
    webSpeech.onerror = null;
    webSpeech.onend = null;
    webSpeech.stop();
  } catch {
    // ignore
  }
  webSpeech = null;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureWhisperReady() {
  if (whisperReady) return;

  await loadScriptOnce("./assets/stt/whisper-web-transcriber.bundled.min.js");

  const lib = window.WhisperTranscriber;
  const Ctor = lib?.WhisperTranscriber || lib?.default || lib;
  if (!Ctor) {
    throw new Error("whisper.wasm 相关脚本加载失败");
  }

  if (!crossOriginIsolated) {
    // Not a hard error: some builds still work without SAB, but performance may be poor or fail.
    console.warn("crossOriginIsolated=false; whisper.wasm 可能不可用或很慢（建议配置 COOP/COEP）。");
  }

  // Minimal config: use default model hosted by the library (may download on first run).
  whisperTranscriber = new Ctor({
    language: "zh",
    task: "transcribe",
    // callbacks:
    onStatus: (s) => {
      if (typeof s === "string" && s) setProgress(s);
    },
    onError: (err) => {
      console.error(err);
    },
  });

  if (typeof whisperTranscriber.init === "function") {
    await whisperTranscriber.init();
  }
  whisperReady = true;
}

function normalizeWhisperResult(res) {
  if (!res) return "";
  if (typeof res === "string") return res.trim();
  if (typeof res.text === "string") return res.text.trim();
  if (typeof res.transcription === "string") return res.transcription.trim();
  return "";
}

async function recordAudioBlob(durationMs) {
  if (!micStream || micStream.getAudioTracks().length === 0) return null;
  if (!("MediaRecorder" in window)) return null;

  const chunks = [];
  let recorder = null;
  try {
    recorder = new MediaRecorder(micStream);
  } catch {
    return null;
  }

  return await new Promise((resolve) => {
    const finish = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      resolve(blob.size ? blob : null);
    };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = finish;
    recorder.start();
    setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    }, durationMs);
  });
}

function canRecordAudioBlob() {
  return !!(hasMic && micStream && micStream.getAudioTracks().length > 0 && "MediaRecorder" in window);
}

async function transcribeAudioBlobWithWhisper(blob) {
  await ensureWhisperReady();
  if (!blob) return "";

  // Try common method names first (depends on library build).
  const methodNames = ["transcribeBlob", "transcribeFile", "transcribe", "transcribeAudio"];
  for (const name of methodNames) {
    const fn = whisperTranscriber?.[name];
    if (typeof fn === "function") {
      const res = await fn.call(whisperTranscriber, blob);
      return normalizeWhisperResult(res);
    }
  }

  throw new Error("whisper.wasm 不支持对录音文件转写（请升级脚本或改用录制时实时转写）");
}

function whisperSupportsBlobTranscribe() {
  const methodNames = ["transcribeBlob", "transcribeFile", "transcribe", "transcribeAudio"];
  return methodNames.some((n) => typeof whisperTranscriber?.[n] === "function");
}

async function transcribeStableDuringRecording(durationMs) {
  await ensureWhisperReady();
  if (typeof whisperTranscriber?.startRecording !== "function") {
    throw new Error("whisperTranscriber.startRecording 不可用（脚本版本不匹配或未初始化）");
  }

  let lastText = "";
  whisperTranscriber.onTranscription = (t) => {
    const next = normalizeWhisperResult(t);
    if (next) lastText = next;
  };

  await whisperTranscriber.startRecording();
  await new Promise((r) => setTimeout(r, durationMs));
  await whisperTranscriber.stopRecording();

  // Give it a short time to flush.
  await new Promise((r) => setTimeout(r, 600));
  return lastText;
}

function createGifEncoder() {
  return new GIF({
    workers: 2,
    quality: 10,
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    workerScript: "./assets/libs/gif.worker.js",
  });
}

function revokeLastGifUrl() {
  if (lastGifUrl) URL.revokeObjectURL(lastGifUrl);
  lastGifUrl = null;
}

function setShutterProgress(p) {
  const v = Math.max(0, Math.min(1, p || 0));
  els.btnShutter.style.setProperty("--p", String(v));
}

function stopShutterProgress() {
  if (shutterProgressRaf) cancelAnimationFrame(shutterProgressRaf);
  shutterProgressRaf = 0;
}

function startShutterProgress(durationMs) {
  stopShutterProgress();
  shutterProgressDuration = durationMs;
  shutterProgressStart = performance.now();
  const tick = () => {
    const t = performance.now() - shutterProgressStart;
    setShutterProgress(t / shutterProgressDuration);
    if (t < shutterProgressDuration) shutterProgressRaf = requestAnimationFrame(tick);
  };
  setShutterProgress(0);
  shutterProgressRaf = requestAnimationFrame(tick);
}

async function startPreview() {
  hideResult();
  if (isPreviewing) stopPreview();
  setProgress("");
  setStatus("初始化中：请求摄像头/麦克风权限…");

  try {
    await preloadStickers();
  } catch {
    // Stickers missing shouldn't block preview.
  }

  try {
    mediaStream = await ensureMediaStream();
  } catch (err) {
    setStatus(`权限被拒绝或设备不可用：${err?.message || err}`, "error");
    return;
  }

  if (!hasMic) setProgress("提示：未获得麦克风权限，字幕/转写可能不可用");

  try {
    await attachStreamToVideo(mediaStream);
    await waitForVideoReady(els.video);
  } catch (err) {
    // Common on iOS: permission granted but playback needs user gesture.
    setStatus("已获取权限：点击快门开始预览", "error");
    isPreviewing = false;
    return;
  }

  try {
    await initJeelizFaceFilter();
  } catch (err) {
    // Face filter failure should degrade: still show camera without sticker tracking.
    console.warn(err);
    setStatus("已开始预览（人脸跟踪不可用，将不叠加贴纸）", "error");
  }

  isPreviewing = true;
  captionText = "";
  captionSource = "none";

  if (subtitleMode === "realtime" && canUseWebSpeech()) {
    startWebSpeech();
  }

  setStatus("预览中：点击快门录制 3 秒 GIF");
  drawFrame();
}

async function recordGif3s() {
  if (!isPreviewing || isRecording) return;
  isRecording = true;
  els.btnShutter.classList.add("is-busy");
  setProgress("");
  startShutterProgress(DURATION_S * 1000);

  revokeLastGifUrl();
  lastGifBlob = null;

  const stableMode = subtitleMode === "stable";
  if (!stableMode) {
    // Real-time mode: ensure WebSpeech is running if possible.
    if (!webSpeech && canUseWebSpeech()) startWebSpeech();
    if (!canUseWebSpeech()) {
      setStatus("当前环境不支持实时语音识别，可切到“稳定字幕优先”或无字幕。", "error");
    }
  } else {
    stopWebSpeech();
    if (!hasMic) {
      setStatus("稳定字幕不可用：未获得麦克风权限（仍可生成无字幕 GIF）", "error");
    }
  }

  const frames = stableMode ? [] : null;
  const start = performance.now();

  let gif = null;
  if (!stableMode) {
    setStatus("录制中（3 秒）…");
    gif = createGifEncoder();
    gif.on("progress", (p) => {
      const pct = Math.round((p || 0) * 100);
      setProgress(`${pct}%`);
    });
    gif.on("finished", (blob) => {
      lastGifBlob = blob;
      lastGifUrl = URL.createObjectURL(blob);
      setStatus("拍摄完成");
      setProgress("");
      isRecording = false;
      els.btnShutter.classList.remove("is-busy");
      stopShutterProgress();
      setShutterProgress(1);
      showResult();
    });
  }

  // Stable subtitles:
  // - Prefer: record audio only during 3s, transcribe after (keeps recording phase light).
  // - Fallback: if current whisper build can't transcribe a Blob, transcribe while recording.
  let stableTranscribePromise = null;
  let audioBlobPromise = Promise.resolve(null);
  if (stableMode) {
    setStatus("准备中：初始化稳定字幕（whisper.wasm）…");
    setProgress("初始化字幕引擎…");
    try {
      await ensureWhisperReady();
      if (whisperSupportsBlobTranscribe() && canRecordAudioBlob()) {
        audioBlobPromise = recordAudioBlob(DURATION_S * 1000);
      } else {
        setStatus("录制中（3 秒）…（稳定字幕：录制时转写，可能更耗性能）");
        stableTranscribePromise = transcribeStableDuringRecording(DURATION_S * 1000);
      }
    } catch (e) {
      console.warn(e);
      stableTranscribePromise = Promise.resolve("");
    }
    if (!stableTranscribePromise) {
      setStatus("录制中（3 秒）…请说话");
      setProgress("");
    }
  }

  let captured = 0;
  let resolveCapture = null;
  const captureDone = new Promise((r) => (resolveCapture = r));
  const captureTick = () => {
    if (captured >= FRAME_COUNT) return;
    captured++;
    try {
      if (stableMode) {
        frames.push(ctx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE));
        setProgress(`采样帧：${captured}/${FRAME_COUNT}`);
      } else {
        gif.addFrame(els.canvas, { copy: true, delay: FRAME_DELAY_MS });
        setProgress(`采样帧：${captured}/${FRAME_COUNT}`);
      }
    } catch {
      // ignore
    }
    if (captured >= FRAME_COUNT) resolveCapture();
  };

  captureTick();
  const captureTimer = setInterval(captureTick, FRAME_DELAY_MS);
  await captureDone;
  clearInterval(captureTimer);

  let stableCaption = "";
  if (stableMode) {
    setStatus("转写中（whisper.wasm）…");
    if (stableTranscribePromise) {
      stableCaption = (await stableTranscribePromise) || "";
    } else {
      const audioBlob = await audioBlobPromise;
      try {
        stableCaption = await transcribeAudioBlobWithWhisper(audioBlob);
      } catch (e) {
        console.warn(e);
        stableCaption = "";
      }
    }

    captionText = stableCaption;
    captionSource = stableCaption ? "whisper" : "none";

    setStatus("编码 GIF 中…");
    setProgress("0%");

    gif = createGifEncoder();
    gif.on("progress", (p) => {
      const pct = Math.round((p || 0) * 100);
      setProgress(`${pct}%`);
    });
    gif.on("finished", (blob) => {
      lastGifBlob = blob;
      lastGifUrl = URL.createObjectURL(blob);
      setStatus("拍摄完成");
      setProgress("");
      isRecording = false;
      els.btnShutter.classList.remove("is-busy");
      stopShutterProgress();
      setShutterProgress(1);
      showResult();
    });

    const encodeCanvas = document.createElement("canvas");
    encodeCanvas.width = OUTPUT_SIZE;
    encodeCanvas.height = OUTPUT_SIZE;
    const encodeCtx = encodeCanvas.getContext("2d", { alpha: false });

    for (const img of frames) {
      encodeCtx.putImageData(img, 0, 0);
      drawSubtitle(encodeCtx, captionText);
      gif.addFrame(encodeCanvas, { copy: true, delay: FRAME_DELAY_MS });
    }
    gif.render();
  } else {
    setStatus("编码 GIF 中…");
    setProgress("0%");
    gif.render();
  }

  const elapsed = Math.round(performance.now() - start);
  console.debug(`record started, stableMode=${stableMode}, frames=${captured}, elapsedMs=${elapsed}`);
}

function downloadGif() {
  if (!lastGifBlob) return;
  const a = document.createElement("a");
  a.href = lastGifUrl || URL.createObjectURL(lastGifBlob);
  a.download = `selfface_${new Date().toISOString().replace(/[:.]/g, "-")}.gif`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function gifFile() {
  if (!lastGifBlob) return null;
  const name = `selfface_${new Date().toISOString().replace(/[:.]/g, "-")}.gif`;
  return new File([lastGifBlob], name, { type: "image/gif" });
}

async function shareGif() {
  if (!lastGifBlob) {
    setStatus("还没有可分享的 GIF，请先拍摄一次", "error");
    return;
  }
  const file = gifFile();
  if (!file) return;

  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: "selfface",
        text: "selfface GIF",
        files: [file],
      });
      setStatus("已打开系统分享面板");
      return;
    }
  } catch (e) {
    // AbortError: user cancelled
    if (String(e?.name || "").toLowerCase().includes("abort")) return;
    console.warn(e);
  }

  // Fallbacks:
  // iOS without Web Share files: open in a new tab so user can long-press to save/share.
  if (lastGifUrl) {
    window.open(lastGifUrl, "_blank", "noopener,noreferrer");
    setStatus("已打开 GIF：可长按保存/分享", "error");
  } else {
    downloadGif();
    setStatus("已下载 GIF：可在“文件”中打开再分享/存相册", "error");
  }
}

async function saveToPhotos() {
  // Web can't directly write to iOS Photos. Best UX is Web Share -> “存储到相册 / 保存图片”.
  if (!lastGifBlob) {
    setStatus("还没有可下载的 GIF，请先拍摄一次", "error");
    return;
  }
  const file = gifFile();
  if (!file) return;

  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      setStatus("请在弹出的面板中选择“存储到相册 / 保存图片”");
      await navigator.share({ files: [file], title: "selfface" });
      return;
    }
  } catch (e) {
    if (String(e?.name || "").toLowerCase().includes("abort")) return;
    console.warn(e);
  }

  // Fallback: download to Files (user can then Save to Photos).
  downloadGif();
  setStatus("已下载到“文件”：打开后可保存到相册", "error");
}

function setSubtitleMode(nextMode) {
  subtitleMode = nextMode;
  els.btnSubRealtime.classList.toggle("is-active", subtitleMode === "realtime");
  els.btnSubStable.classList.toggle("is-active", subtitleMode === "stable");

  if (!isPreviewing) return;
  captionText = "";
  captionSource = "none";

  if (subtitleMode === "stable") {
    stopWebSpeech();
    setStatus("稳定字幕优先：录制后转写并写入每帧");
  } else {
    if (canUseWebSpeech()) {
      startWebSpeech();
      setStatus("实时字幕优先：系统语音识别");
    } else {
      setStatus("当前环境不支持实时语音识别，可切到稳定字幕优先", "error");
    }
  }
}

function setSheetExpanded(expanded) {
  const isExpanded = !!expanded;
  els.sheet.classList.toggle("wx-sheet--collapsed", !isExpanded);
  els.sheetExpanded.hidden = !isExpanded;
  els.sheetCollapsed.hidden = isExpanded;
  els.btnSheetHandle.style.transform = isExpanded ? "rotate(180deg)" : "rotate(0deg)";
}

function showResult() {
  if (!lastGifUrl) return;
  els.gifPreview.src = lastGifUrl;
  els.gifPreview.classList.add("is-on");
  els.sheet.hidden = true;
  els.resultPanel.hidden = false;
}

function hideResult() {
  els.gifPreview.classList.remove("is-on");
  els.gifPreview.removeAttribute("src");
  els.sheet.hidden = false;
  els.resultPanel.hidden = true;
  setShutterProgress(0);
}

function resetToDefaultView() {
  hideResult();
  setSheetExpanded(false);
  stopShutterProgress();
  els.btnShutter.classList.remove("is-busy");
  setShutterProgress(0);
  setProgress("");
  setStatus("点击快门开始预览");
}

function setEffect(effectId) {
  selectedEffectId = effectId;
  const eff = effects.find((e) => e.id === effectId) || effects[0];
  currentEffect = eff;
  els.effectFromName.textContent = eff.from || "WeChat Effect";

  stickerImg = eff.sticker ? imageCache.get(eff.sticker) || null : null;
  frameImg = eff.frame ? imageCache.get(eff.frame) || null : null;

  // Effect overlay state
  effectState = {
    id: eff.id,
    startedAt: performance.now(),
    seed: hashSeed(eff.id),
    particles: [],
  };
  const rnd = seededRandom(effectState.seed);
  if (eff.id === "thanksBoss") {
    for (let i = 0; i < 10; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * OUTPUT_SIZE,
        r: (rnd() - 0.5) * 1.0,
        s: 0.75 + rnd() * 0.65,
        w: 0.6 + rnd() * 0.9,
        p: rnd() * Math.PI * 2,
      });
    }
  } else if (eff.id === "newYear") {
    for (let i = 0; i < 8; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * (OUTPUT_SIZE + 120),
        v: 120 + rnd() * 160,
        r: (rnd() - 0.5) * 0.6,
        p: rnd() * Math.PI * 2,
      });
    }
  } else if (eff.id === "gongXiFaCai") {
    for (let i = 0; i < 18; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * OUTPUT_SIZE * 0.9,
        v: 1.8 + rnd() * 2.8,
        p: rnd() * Math.PI * 2,
      });
    }
  } else if (eff.id === "edgeSparkles") {
    for (let i = 0; i < 22; i++) {
      const edge = Math.floor(rnd() * 4);
      const m = 10 + rnd() * 16;
      let x = m;
      let y = m;
      if (edge === 0) {
        x = m;
        y = rnd() * OUTPUT_SIZE;
      } else if (edge === 1) {
        x = OUTPUT_SIZE - m;
        y = rnd() * OUTPUT_SIZE;
      } else if (edge === 2) {
        x = rnd() * OUTPUT_SIZE;
        y = m;
      } else {
        x = rnd() * OUTPUT_SIZE;
        y = OUTPUT_SIZE - m;
      }
      effectState.particles.push({
        x,
        y,
        v: 1.4 + rnd() * 2.3,
        p: rnd() * Math.PI * 2,
      });
    }
  }

  renderEffectSelections();
}

function makeEffectThumb(effect) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "wx-effectItem";
  item.dataset.effectId = effect.id;
  item.setAttribute("role", "listitem");
  item.style.border = "0";
  item.style.background = "transparent";
  item.style.padding = "0";

  const thumb = document.createElement("div");
  thumb.className = "wx-thumb";
  if (effect.thumb === "none") thumb.classList.add("wx-thumb--none");
  if (effect.thumb === "more") thumb.classList.add("wx-thumb--more");

  if (effect.sticker) {
    const img = document.createElement("img");
    img.alt = effect.name;
    img.src = effect.sticker;
    thumb.appendChild(img);
  }

  const label = document.createElement("div");
  label.className = "wx-label";
  label.textContent = effect.name;

  item.appendChild(thumb);
  item.appendChild(label);

  item.addEventListener("click", () => {
    if (effect.id === "more") {
      setSheetExpanded(true);
      return;
    }
    setEffect(effect.id);
  });

  return item;
}

function makeGridItem(effect) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "wx-gridItem";
  item.dataset.effectId = effect.id;
  item.setAttribute("role", "listitem");
  item.style.border = "0";
  item.style.background = "transparent";
  item.style.padding = "0";

  const icon = document.createElement("div");
  icon.className = "wx-gridIcon";
  if (effect.sticker) {
    const img = document.createElement("img");
    img.alt = effect.name;
    img.src = effect.sticker;
    icon.appendChild(img);
  } else {
    icon.textContent = effect.id === "none" ? "Ø" : "…";
    icon.style.color = "#b2b6bc";
    icon.style.fontWeight = "700";
    icon.style.fontSize = "22px";
  }

  const label = document.createElement("div");
  label.className = "wx-gridLabel";
  label.textContent = effect.name;

  item.appendChild(icon);
  item.appendChild(label);

  item.addEventListener("click", () => {
    if (effect.id === "more") return;
    setEffect(effect.id);
    setSheetExpanded(false);
  });

  return item;
}

function renderEffects() {
  els.effectStrip.innerHTML = "";
  for (const eff of effects) {
    els.effectStrip.appendChild(makeEffectThumb(eff));
  }

  // Expanded grid: show without "more", add a few duplicates as placeholders to mimic density.
  els.effectGrid.innerHTML = "";
  const gridEffects = effects.filter((e) => e.id !== "more");
  const padded = [...gridEffects];
  while (padded.length < 15) padded.push(gridEffects[(padded.length * 7) % gridEffects.length]);
  for (const eff of padded) {
    els.effectGrid.appendChild(makeGridItem(eff));
  }
}

function renderEffectSelections() {
  for (const el of els.effectStrip.querySelectorAll(".wx-effectItem")) {
    el.classList.toggle("is-selected", el.dataset.effectId === selectedEffectId);
  }
  for (const el of els.effectGrid.querySelectorAll(".wx-gridItem")) {
    el.classList.toggle("is-selected", el.dataset.effectId === selectedEffectId);
  }
}

els.btnSheetHandle.addEventListener("click", () => {
  setSheetExpanded(els.sheetExpanded.hidden);
});
els.btnDockChevron.addEventListener("click", () => setSheetExpanded(true));

async function shutterAction() {
  if (isRecording) return;
  if (!isPreviewing) {
    await startPreview();
    // If user is holding the shutter, start recording after preview is ready.
    if (isPreviewing) await recordGif3s();
    return;
  }
  await recordGif3s();
}

function bindShutterHold() {
  const el = els.btnShutter;
  let holding = false;

  const onDown = async (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      // ignore
    }
    if (holding) return;
    holding = true;
    await shutterAction();
  };
  const onUp = () => {
    holding = false;
  };

  el.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });

  // Fallbacks for older iOS WebViews:
  el.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("touchend", onUp, { passive: true });
  window.addEventListener("touchcancel", onUp, { passive: true });
  el.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
}

async function autoRequestPermissionsOnLoad() {
  if (hasRequestedPermissions) return;
  try {
    // Only request permissions; preview rendering may still require a user gesture on iOS.
    await ensureMediaStream();
    setStatus("已请求权限：点击快门开始预览");
  } catch (err) {
    setStatus(`无法获取权限：${err?.message || err}`, "error");
  }
}

els.btnSwitchCam.addEventListener("click", async () => {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  await startPreview();
});

els.btnRetake.addEventListener("click", () => {
  hideResult();
  setStatus("重拍：点击快门录制");
});

els.btnDownload.addEventListener("click", () => {
  saveToPhotos();
});

els.btnShare.addEventListener("click", () => {
  shareGif();
});

els.btnSubRealtime.addEventListener("click", () => setSubtitleMode("realtime"));
els.btnSubStable.addEventListener("click", () => setSubtitleMode("stable"));

// First paint
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
resetToDefaultView();
renderEffects();
setSubtitleMode("realtime");
setSheetExpanded(false);
setEffect(selectedEffectId);
bindShutterHold();
autoRequestPermissionsOnLoad();

// iOS Safari may restore DOM state via BFCache; ensure we don't show mixed panels.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    stopPreview();
    resetToDefaultView();
  }
});
window.addEventListener("pagehide", () => {
  stopPreview();
  resetToDefaultView();
});
