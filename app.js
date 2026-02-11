/* global GIF */

import JEELIZFACEFILTER from "./assets/jeeliz/jeelizFaceFilter.moduleES6.js";

// Injected by Vite `define` (vite.config.js). Fallback is for dev/test.
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const OUTPUT_SIZE = 360;
const FPS = 10;
const DURATION_S = 3;
const FRAME_COUNT = FPS * DURATION_S;
const FRAME_DELAY_MS = Math.round(1000 / FPS);

const COI_SW_URL = "./coi-sw.js";
const COI_RELOAD_KEY = "selfface_coi_reloaded_at";
const COI_FAILED_KEY = "selfface_coi_failed";

const BEAUTY = {
  enabled: true,
  // Cheap GPU-ish filter applied during video draw (if supported).
  videoFilter: "brightness(1.14) contrast(1.06) saturate(1.10)",
  // Soft overlays (very cheap; avoids per-pixel processing).
  softLightStrength: 0.06,
  warmTintStrength: 0.045,
  faceBrightStrength: 0.22,
  // Makeup (approx mouth region based on face box; no landmarks).
  lipstick: {
    enabled: true,
    color: "rgba(210, 45, 80, 0.62)",
    strength: 0.62,
  },
};

const els = {
  canvas: document.getElementById("outputCanvas"),
  status: document.getElementById("statusLine"),
  progress: document.getElementById("progressLine"),
  video: document.getElementById("inputVideo"),
  jeelizCanvas: document.getElementById("jeelizCanvas"),
  gifPreview: document.getElementById("gifPreview"),
  effectFromName: document.getElementById("effectFromName"),
  version: document.getElementById("appVersion"),

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
  btnToolCutout: document.getElementById("btnToolCutout"),
  btnToolFast: document.getElementById("btnToolFast"),
  btnToolEmoji: document.getElementById("btnToolEmoji"),
  emojiFile: document.getElementById("emojiFile"),

  btnSubRealtime: document.getElementById("btnSubRealtime"),
  btnSubStable: document.getElementById("btnSubStable"),
};

const ctx = els.canvas.getContext("2d", { alpha: false, desynchronized: true });

let mediaStream = null;
let micStream = null;
let faceState = null;
let faceSmooth = null; // { x,y,s,rz,detected,lastMs,lastSeenMs }
let rafId = 0;
let isPreviewing = false;
let isRecording = false;
let lastGifBlob = null;
let lastGifUrl = null;
let lastOriginalGifBlob = null;
let lastOriginalGifUrl = null;
let lastCapture = null; // { frames: ImageData[], faces: (FaceRegion|null)[], delayMs:number, w:number, h:number, caption:string }
let isReencoding = false;
let resultEdits = { cutout: false, fast: false, emojiImg: null }; // emojiImg: HTMLImageElement|null
let pendingPreviewStart = false;
let pendingWhisperRealtimeStart = false;
let pendingCoiReload = false;
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
let whisperInitPromise = null;
let whisperTextListener = null; // (text: string) => void
let whisperIsRecording = false;
let whisperNeedsUserGesture = false;
let subtitleMode = "realtime"; // "realtime" | "stable"

const effects = [
  { id: "none", name: "无特效", from: "WeChat Effect", sticker: null, thumb: "none" },
  {
    id: "thanksBoss",
    name: "谢谢老板",
    from: "WeChat Effect",
    sticker: "./assets/stickers/glasses.png",
    icon: { emoji: "💰", bg: "linear-gradient(135deg,#ffe37a,#ff9fd1)" },
  },
  {
    id: "newYear",
    name: "新年好",
    from: "MurphyM",
    sticker: "./assets/stickers/mustache.png",
    icon: { emoji: "🧧", bg: "linear-gradient(135deg,#ff8a7a,#ffd36a)" },
  },
  {
    id: "gongXiFaCai",
    name: "恭喜发财",
    from: "MurphyM",
    sticker: "./assets/stickers/crown.png",
    icon: { emoji: "👑", bg: "linear-gradient(135deg,#ffe27a,#a7ffcf)" },
  },
  {
    id: "comedyGlasses",
    name: "搞笑眼镜",
    from: "jeelizFaceFilter",
    sticker: "./assets/templates/jeeliz/comedy-glasses.png",
    placement: { scale: 2.15, offsetX: 0, offsetY: -0.08, clamp: [140, 320] },
    icon: { emoji: "😎", bg: "linear-gradient(135deg,#7cf0ff,#b98cff)" },
  },
  {
    id: "catFace",
    name: "猫猫",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/cat.png",
    placement: { scale: 2.22, offsetX: 0, offsetY: -0.26, clamp: [140, 320] },
    icon: { emoji: "🐱", bg: "linear-gradient(135deg,#ffd1e6,#c6fff3)" },
  },
  {
    id: "dogFace",
    name: "狗狗",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/dog.png",
    placement: { scale: 2.22, offsetX: 0, offsetY: -0.26, clamp: [140, 320] },
    icon: { emoji: "🐶", bg: "linear-gradient(135deg,#c6e8ff,#ffe5b6)" },
  },
  {
    id: "flowerBand",
    name: "花环",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/flower_hairband.png",
    placement: { scale: 2.45, offsetX: 0, offsetY: -0.36, clamp: [160, 340] },
    icon: { emoji: "🌸", bg: "linear-gradient(135deg,#ffb7d9,#b7f0ff)" },
  },
  {
    id: "devilHorn",
    name: "小恶魔",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/evil_horn_eye.png",
    placement: { scale: 2.35, offsetX: 0, offsetY: -0.32, clamp: [150, 340] },
    icon: { emoji: "😈", bg: "linear-gradient(135deg,#ffb4ec,#a6b9ff)" },
  },
  {
    id: "eyeFx",
    name: "眼神",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/eye.png",
    placement: { scale: 2.0, offsetX: 0, offsetY: -0.02, clamp: [120, 300], alpha: 0.75 },
    icon: { emoji: "✨", bg: "linear-gradient(135deg,#fff4a6,#b7f0ff)" },
  },
  {
    id: "baldHair",
    name: "秃一点",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/bald_hair.png",
    placement: { scale: 2.6, offsetX: 0, offsetY: -0.38, clamp: [170, 360] },
    icon: { emoji: "🧑‍🦲", bg: "linear-gradient(135deg,#ffe0d1,#d1f0ff)" },
  },
  {
    id: "skeleton",
    name: "骷髅面具",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/skeleton_mask.png",
    placement: { scale: 2.15, offsetX: 0, offsetY: 0.06, clamp: [160, 340], alpha: 0.62 },
    icon: { emoji: "💀", bg: "linear-gradient(135deg,#d7e2ff,#ffd6e7)" },
  },
  {
    id: "neonMask",
    name: "霓虹口罩",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/neon_facemask.png",
    placement: { scale: 2.05, offsetX: 0, offsetY: 0.1, clamp: [140, 300], alpha: 0.7 },
    icon: { emoji: "😷", bg: "linear-gradient(135deg,#b6ffea,#b6c7ff)" },
  },
  {
    id: "bald",
    name: "光头",
    from: "FaceUp",
    sticker: "./assets/templates/faceup/bald.png",
    placement: { scale: 2.5, offsetX: 0, offsetY: -0.34, clamp: [160, 360] },
    icon: { emoji: "🥚", bg: "linear-gradient(135deg,#fff0c9,#d4fff0)" },
  },
  {
    id: "edgeSparkles",
    name: "金闪闪",
    from: "selfface",
    sticker: null,
    icon: { emoji: "🌟", bg: "linear-gradient(135deg,#ffe48a,#ffb0d9)" },
  },
  {
    id: "fireworksFrame",
    name: "烟花框",
    from: "jeelizFaceFilter",
    sticker: null,
    frame: "./assets/templates/jeeliz/frame_fireworks.png",
    icon: { emoji: "🎆", bg: "linear-gradient(135deg,#a6d6ff,#ffb0d9)" },
  },
  {
    id: "warmVignette",
    name: "暖色",
    from: "selfface",
    sticker: null,
    filter: "warmVignette",
    icon: { emoji: "🧡", bg: "linear-gradient(135deg,#ffd2a6,#ffeaa6)" },
  },
  {
    id: "heartBurst",
    name: "爱心雨",
    from: "selfface",
    sticker: null,
    icon: { emoji: "💖", bg: "linear-gradient(135deg,#ffb6d9,#ffd6f0)" },
  },
  {
    id: "bubbles",
    name: "泡泡",
    from: "selfface",
    sticker: null,
    icon: { emoji: "🫧", bg: "linear-gradient(135deg,#b6f3ff,#d2e2ff)" },
  },
  {
    id: "rainbow",
    name: "彩虹框",
    from: "selfface",
    sticker: null,
    filter: "rainbowFrame",
    icon: { emoji: "🌈", bg: "linear-gradient(135deg,#ffb0d9,#b6f3ff)" },
  },
  {
    id: "starRain",
    name: "星星雨",
    from: "selfface",
    sticker: null,
    icon: { emoji: "⭐️", bg: "linear-gradient(135deg,#fff0a6,#b7f0ff)" },
  },
  {
    id: "confetti",
    name: "彩纸雨",
    from: "selfface",
    sticker: null,
    icon: { emoji: "🎉", bg: "linear-gradient(135deg,#b7f0ff,#ffd1e6)" },
  },
  {
    id: "bunnyEars",
    name: "兔兔耳朵",
    from: "selfface",
    sticker: null,
    icon: { emoji: "🐰", bg: "linear-gradient(135deg,#ffd1e6,#d1f0ff)" },
  },
  {
    id: "blush",
    name: "害羞腮红",
    from: "selfface",
    sticker: null,
    icon: { emoji: "😊", bg: "linear-gradient(135deg,#ffd1e6,#ffeaa6)" },
  },
  {
    id: "sparkleHalo",
    name: "闪闪光环",
    from: "selfface",
    sticker: null,
    icon: { emoji: "👼", bg: "linear-gradient(135deg,#d7e2ff,#fff0a6)" },
  },
  {
    id: "candyFrame",
    name: "糖果边框",
    from: "selfface",
    sticker: null,
    filter: "candyFrame",
    icon: { emoji: "🍬", bg: "linear-gradient(135deg,#b7f0ff,#ffb7d9)" },
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

  if (id === "starRain") {
    // Bright stars falling from top; fade near face.
    const drawStar = (cx, cy, outerR, innerR, rot) => {
      const spikes = 5;
      let angle = -Math.PI / 2 + rot;
      const step = Math.PI / spikes;
      context.beginPath();
      for (let i = 0; i < spikes; i++) {
        context.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
        angle += step;
        context.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        angle += step;
      }
      context.closePath();
    };

    context.save();
    for (const p of effectState.particles) {
      const y = ((p.y + t * p.v) % (OUTPUT_SIZE + 130)) - 60;
      const x = p.x + Math.sin(t * 1.1 + p.p) * 10;
      const a = particleAlphaOutsideFace(x, y, 0.5);
      context.globalAlpha = a;
      context.fillStyle = p.c;
      const r = p.s * (7.5 + 3.5 * (0.5 + 0.5 * Math.sin(t * 2 + p.p)));
      drawStar(x, y, r, r * 0.48, t * 0.6 + p.r);
      context.fill();
    }
    context.restore();
    return;
  }

  if (id === "confetti") {
    // Confetti pieces drifting down; keep away from face via fade.
    context.save();
    for (const p of effectState.particles) {
      const y = ((p.y + t * p.v) % (OUTPUT_SIZE + 150)) - 70;
      const x = p.x + Math.sin(t * 1.4 + p.p) * 14;
      const a = particleAlphaOutsideFace(x, y, 0.33);
      context.globalAlpha = a;
      context.save();
      context.translate(x, y);
      context.rotate(p.r + t * 1.2);
      context.fillStyle = p.c;
      context.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      context.restore();
    }
    context.restore();
    return;
  }

  if (id === "bunnyEars") {
    // Cute bunny ears above head (face-tracked).
    const ft = getFaceTransform();
    if (!ft || ft.detected < FACE_RENDER_TH) return;
    const { x, y, s, rz, detected } = ft;
    const earH = clamp(s * 1.05, 140, 220);
    const earW = earH * 0.32;
    const gap = earW * 0.55;
    const baseY = y - earH * 0.62;

    const drawEar = (dx, tilt) => {
      context.save();
      context.translate(x + dx, baseY);
      context.rotate(rz + tilt);
      context.globalAlpha = 0.95;

      // outer
      context.fillStyle = "rgba(255,255,255,0.97)";
      context.strokeStyle = "rgba(255,180,210,0.55)";
      context.lineWidth = 4;
      roundRectPath(context, -earW / 2, -earH / 2, earW, earH, earW * 0.6);
      context.fill();
      context.stroke();

      // inner
      context.globalAlpha = 0.85;
      context.fillStyle = "rgba(255,170,210,0.75)";
      roundRectPath(context, -earW * 0.25, -earH * 0.33, earW * 0.5, earH * 0.72, earW * 0.5);
      context.fill();

      context.restore();
    };

    context.save();
    context.globalAlpha = 0.86 + 0.14 * clamp((detected - FACE_RENDER_TH) / (1 - FACE_RENDER_TH), 0, 1);
    drawEar(-(gap + earW * 0.15), -0.12);
    drawEar(gap + earW * 0.15, 0.08);
    context.restore();
    return;
  }

  if (id === "blush") {
    // Soft blush on cheeks (face-tracked).
    const ft = getFaceTransform();
    if (!ft || ft.detected < FACE_RENDER_TH) return;
    const { x, y, s, rz, detected } = ft;
    const r = clamp(s * 0.22, 22, 44);
    const dx = clamp(s * 0.28, 28, 60);
    const yy = y + clamp(s * 0.08, 10, 22);
    const pulse = 0.86 + 0.12 * Math.sin(t * 2.2);

    const conf = clamp((detected - FACE_RENDER_TH) / (1 - FACE_RENDER_TH), 0, 1);
    const drawCheek = (sx) => {
      const cx = x + sx;
      context.save();
      context.translate(cx, yy);
      context.rotate(rz);
      const g = context.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(255,120,170,${(0.26 + 0.10 * conf) * pulse})`);
      g.addColorStop(1, "rgba(255,120,170,0)");
      context.fillStyle = g;
      context.beginPath();
      context.ellipse(0, 0, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };

    context.save();
    drawCheek(-dx);
    drawCheek(dx);
    context.restore();
    return;
  }

  if (id === "sparkleHalo") {
    // Small halo + sparkles above head (face-tracked).
    const ft = getFaceTransform();
    if (!ft || ft.detected < FACE_RENDER_TH) return;
    const { x, y, s, rz, detected } = ft;
    const cx = x;
    const cy = y - clamp(s * 0.62, 70, 150);
    const R = clamp(s * 0.34, 48, 96);

    context.save();
    context.globalAlpha = 0.88 + 0.12 * clamp((detected - FACE_RENDER_TH) / (1 - FACE_RENDER_TH), 0, 1);
    context.translate(cx, cy);
    context.rotate(rz * 0.4);

    // halo ring
    context.globalAlpha = 0.92;
    context.strokeStyle = "rgba(255, 230, 120, 0.95)";
    context.lineWidth = clamp(s * 0.06, 5, 10);
    context.beginPath();
    context.ellipse(0, 0, R, R * 0.62, 0, 0, Math.PI * 2);
    context.stroke();

    // sparkles
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.9;
      const px = Math.cos(a) * (R + 10);
      const py = Math.sin(a) * (R * 0.62 + 8);
      const alpha = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2 + i));
      context.globalAlpha = alpha;
      context.fillStyle = "rgba(255,255,255,0.9)";
      context.beginPath();
      context.ellipse(px, py, 2.2, 2.2, 0, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
    return;
  }

  if (id === "heartBurst") {
    // Floating hearts mostly around edges / above head. Very low face occlusion.
    context.save();
    for (const h of effectState.particles) {
      const yy = ((h.y - t * h.v) % (OUTPUT_SIZE + 140)) + OUTPUT_SIZE;
      const x = h.x + Math.sin(t * 1.4 + h.p) * 10;
      const y = yy - 60;
      const a = particleAlphaOutsideFace(x, y, 0.55);
      context.globalAlpha = a;
      context.translate(x, y);
      context.rotate(h.r + Math.sin(t + h.p) * 0.15);
      const s = h.s * (0.9 + 0.1 * Math.sin(t * 2 + h.p));
      context.scale(s, s);
      // heart
      context.fillStyle = h.c;
      context.beginPath();
      context.moveTo(0, 10);
      context.bezierCurveTo(0, -6, -16, -8, -16, 4);
      context.bezierCurveTo(-16, 16, 0, 22, 0, 30);
      context.bezierCurveTo(0, 22, 16, 16, 16, 4);
      context.bezierCurveTo(16, -8, 0, -6, 0, 10);
      context.closePath();
      context.fill();
      context.setTransform(1, 0, 0, 1, 0, 0);
    }
    context.restore();
    return;
  }

  if (id === "bubbles") {
    // Soft colorful bubbles drifting; avoid face by fading.
    context.save();
    for (const b of effectState.particles) {
      const x = b.x + Math.sin(t * b.w + b.p) * 14;
      const y = ((b.y - t * b.v) % (OUTPUT_SIZE + 120)) + OUTPUT_SIZE - 60;
      const a = particleAlphaOutsideFace(x, y, 0.22);
      context.globalAlpha = a;
      context.strokeStyle = b.c;
      context.lineWidth = 2.2;
      context.beginPath();
      context.ellipse(x, y, b.r, b.r, 0, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = a * 0.35;
      context.fillStyle = b.c;
      context.beginPath();
      context.ellipse(x - b.r * 0.25, y - b.r * 0.25, b.r * 0.18, b.r * 0.18, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    return;
  }

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

function attachStreamToVideo(stream) {
  els.video.srcObject = stream;
  els.video.muted = true;
  els.video.playsInline = true;
  // Note: iOS may reject play() without a user gesture; we handle retries elsewhere.
  return els.video.play().catch(() => {});
}

function tryResumeVideoPlayback() {
  if (!els.video || !els.video.srcObject) return;
  // Try resume if it is paused or not playing; ignore failures.
  if (els.video.paused || els.video.readyState < 2) {
    els.video.play().catch(() => {});
  }
}

async function requestMedia(facingMode) {
  if (!isSecureContextOk()) {
    throw new Error("必须在 HTTPS（或 localhost）下才能调用摄像头/麦克风。");
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("当前浏览器不支持 getUserMedia（无法调用摄像头/麦克风）。");
  }

  // iOS / some WebViews can be flaky when requesting camera+mic in a single call.
  // Request camera first (to ensure preview starts), then request mic separately.
  // This also avoids the case where mic denial/constraints cause a black preview.
  const videoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facingMode || "user" },
    audio: false,
  });

  let audioStream = null;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    audioStream = null;
  }

  const tracks = [...videoStream.getVideoTracks()];
  if (audioStream) tracks.push(...audioStream.getAudioTracks());
  return new MediaStream(tracks);
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

async function ensureMicOnlyStream() {
  // Try to obtain an audio track even if the camera stream doesn't include one (common on some iOS WebViews).
  if (streamIsLive(micStream) && micStream.getAudioTracks().length > 0) {
    hasMic = true;
    return micStream;
  }
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const tracks = audioStream.getAudioTracks();
    if (!tracks.length) return null;
    stopTracks(micStream);
    micStream = new MediaStream([tracks[0]]);
    hasMic = true;
    return micStream;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

function waitForVideoReady(videoEl) {
  return new Promise((resolve, reject) => {
    if (videoEl.videoWidth > 0) return resolve();
    const to = setTimeout(() => reject(new Error("摄像头初始化超时")), 8000);
    const onReady = () => {
      if (videoEl.videoWidth > 0) {
        clearTimeout(to);
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      videoEl.removeEventListener("loadedmetadata", onReady);
      videoEl.removeEventListener("loadeddata", onReady);
      videoEl.removeEventListener("canplay", onReady);
      videoEl.removeEventListener("timeupdate", onReady);
    };
    videoEl.addEventListener("loadedmetadata", onReady);
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

const FACE_DETECT_UPDATE_TH = 0.45; // start/keep updating smoother
const FACE_RENDER_TH = 0.55; // draw stickers/face-locked effects
const FACE_LOST_HOLD_MS = 380; // keep last face for a short time when detection drops

function getVideoSquareCrop(videoEl) {
  const vw = videoEl?.videoWidth || 0;
  const vh = videoEl?.videoHeight || 0;
  if (!vw || !vh) return null;
  const side = Math.min(vw, vh);
  const sx = (vw - side) * 0.5;
  const sy = (vh - side) * 0.5;
  return { vw, vh, side, sx, sy };
}

function rawFaceToCanvasTransform(state) {
  // `detectState` coords are in [-1,1] with origin at center in the VIDEO space.
  // Our render pipeline center-crops the video to a square. Depending on the Jeeliz build/config,
  // the returned coordinates may be based on the full video or an internal square crop.
  // To be robust across iOS Safari / WeChat WebView variants, we blend between:
  // - simple mapping (assumes Jeeliz already uses a square crop)
  // - crop-aware mapping (assumes Jeeliz uses full video coords)
  const crop = getVideoSquareCrop(els.video);
  if (!crop) {
    // Fallback: assume a square view.
    const x = (state.x * 0.5 + 0.5) * OUTPUT_SIZE;
    const y = (state.y * -0.5 + 0.5) * OUTPUT_SIZE;
    const s = state.s * OUTPUT_SIZE;
    const rz = state.rz || 0;
    return { x, y, s, rz };
  }

  const { vw, vh, side, sx, sy } = crop;

  // Simple (already-square) mapping
  const x0 = (state.x * 0.5 + 0.5) * OUTPUT_SIZE;
  const y0 = (state.y * -0.5 + 0.5) * OUTPUT_SIZE;

  // Crop-aware mapping
  const vx = (state.x * 0.5 + 0.5) * vw;
  const vy = (0.5 - state.y * 0.5) * vh;
  const x1 = ((vx - sx) / side) * OUTPUT_SIZE;
  const y1 = ((vy - sy) / side) * OUTPUT_SIZE;

  // Blend factor by aspect ratio (more non-square -> rely more on crop-aware mapping)
  const aspect = Math.max(vw, vh) / Math.min(vw, vh);
  const k = clamp((aspect - 1) / 0.55, 0, 1);
  const x = clamp(lerp(x0, x1, k), -OUTPUT_SIZE * 0.25, OUTPUT_SIZE * 1.25);
  const y = clamp(lerp(y0, y1, k), -OUTPUT_SIZE * 0.25, OUTPUT_SIZE * 1.25);

  // Scale: blend between "already square" and "full video width" interpretations.
  // This improves sticker sizing/offset on iPad landscape streams (16:9 or 4:3).
  const s0 = state.s * OUTPUT_SIZE;
  const s1 = state.s * OUTPUT_SIZE * (vw / side);
  const s = lerp(s0, s1, k);
  const rz = state.rz || 0;
  return { x, y, s, rz };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  // shortest path on [-pi, pi]
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateFaceSmoother(nowMs) {
  if (!faceSmooth) {
    faceSmooth = {
      x: OUTPUT_SIZE * 0.5,
      y: OUTPUT_SIZE * 0.5,
      s: OUTPUT_SIZE * 0.35,
      rz: 0,
      detected: 0,
      lastMs: nowMs,
      lastSeenMs: 0,
    };
  }

  const dt = Math.max(0, Math.min(200, nowMs - (faceSmooth.lastMs || nowMs)));
  faceSmooth.lastMs = nowMs;

  const det = Number(faceState?.detected || 0);
  const canUpdate =
    !!faceState &&
    Number.isFinite(faceState.x) &&
    Number.isFinite(faceState.y) &&
    Number.isFinite(faceState.s) &&
    det >= FACE_DETECT_UPDATE_TH;

  if (canUpdate) {
    const raw = rawFaceToCanvasTransform(faceState);
    faceSmooth.lastSeenMs = nowMs;

    // Adaptive smoothing: strong enough to remove jitter, but responsive.
    const posAlpha = 1 - Math.exp(-dt / 70);
    const scaleAlpha = 1 - Math.exp(-dt / 95);
    const rotAlpha = 1 - Math.exp(-dt / 110);

    // More confident -> follow faster.
    const conf = clamp((det - FACE_DETECT_UPDATE_TH) / (1 - FACE_DETECT_UPDATE_TH), 0, 1);
    const kPos = clamp(posAlpha * (0.25 + 0.75 * conf), 0.08, 1);
    const kS = clamp(scaleAlpha * (0.25 + 0.75 * conf), 0.06, 1);
    const kR = clamp(rotAlpha * (0.22 + 0.78 * conf), 0.04, 1);

    // First lock: snap quickly.
    if (faceSmooth.detected < 0.01) {
      faceSmooth.x = raw.x;
      faceSmooth.y = raw.y;
      faceSmooth.s = raw.s;
      faceSmooth.rz = raw.rz;
    } else {
      faceSmooth.x = lerp(faceSmooth.x, raw.x, kPos);
      faceSmooth.y = lerp(faceSmooth.y, raw.y, kPos);
      faceSmooth.s = lerp(faceSmooth.s, raw.s, kS);
      faceSmooth.rz = lerpAngle(faceSmooth.rz, raw.rz, kR);
    }

    faceSmooth.detected = det;
  } else {
    // Detection dropped: hold briefly (prevents flicker), then fade out.
    const sinceSeen = nowMs - (faceSmooth.lastSeenMs || 0);
    if (sinceSeen > FACE_LOST_HOLD_MS) {
      faceSmooth.detected = 0;
    } else {
      // decay confidence slowly while holding
      const left = clamp(1 - sinceSeen / FACE_LOST_HOLD_MS, 0, 1);
      faceSmooth.detected = Math.max(faceSmooth.detected * 0.985, left * 0.6);
    }
  }
}

function getFaceTransform() {
  if (!faceSmooth) return null;
  return { x: faceSmooth.x, y: faceSmooth.y, s: faceSmooth.s, rz: faceSmooth.rz, detected: faceSmooth.detected };
}

function getFaceRegion() {
  const ft = getFaceTransform();
  if (!ft || ft.detected < FACE_RENDER_TH) return null;
  const { x, y, s } = ft;
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

function clipEllipse(context, x, y, rx, ry) {
  context.beginPath();
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  context.clip();
}

function drawBeautyOverlay(context, nowMs) {
  if (!BEAUTY.enabled) return;

  // Global "soft" whitening (very subtle)
  context.save();
  context.globalCompositeOperation = "soft-light";
  context.globalAlpha = clamp(BEAUTY.softLightStrength, 0, 0.3);
  context.fillStyle = "rgba(255,255,255,1)";
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  // Warm tint (gives nicer skin tone on iPad camera)
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = clamp(BEAUTY.warmTintStrength, 0, 0.25);
  context.fillStyle = "rgba(255, 180, 200, 1)";
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  context.restore();

  // Face-only brightness lift (avoid brightening background too much)
  const face = getFaceRegion();
  if (!face) return;
  context.save();
  clipEllipse(context, face.x, face.y, face.rx, face.ry);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = clamp(BEAUTY.faceBrightStrength, 0, 0.8);
  const g = context.createRadialGradient(face.x, face.y - face.ry * 0.2, face.rx * 0.2, face.x, face.y, face.rx * 1.2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = g;
  context.fillRect(face.x - face.rx - 10, face.y - face.ry - 10, (face.rx + 10) * 2, (face.ry + 10) * 2);
  context.restore();
}

function drawLipstick(context, nowMs) {
  if (!BEAUTY.enabled || !BEAUTY.lipstick?.enabled) return;
  const ft = getFaceTransform();
  if (!ft || ft.detected < FACE_RENDER_TH) return;

  const { x, y, s, rz } = ft;
  // Approx mouth region: slightly below face center.
  const mouthY = y + clamp(s * 0.23, 18, 62);
  const mouthW = clamp(s * 0.44, 54, 118);
  const mouthH = clamp(mouthW * 0.24, 14, 28);

  const strength = clamp(BEAUTY.lipstick.strength, 0, 1);
  const baseAlpha = 0.38 * strength;
  const edgeAlpha = 0.22 * strength;

  context.save();
  context.translate(x, mouthY);
  context.rotate(rz);

  // Main tint (multiply looks more like makeup on top of video)
  context.globalCompositeOperation = "multiply";
  const r = Math.max(1, mouthW * 0.5);
  const g = context.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, BEAUTY.lipstick.color);
  g.addColorStop(1, "rgba(210, 45, 80, 0)");
  context.globalAlpha = baseAlpha;
  context.fillStyle = g;
  context.beginPath();
  context.ellipse(0, 0, mouthW * 0.5, mouthH * 0.62, 0, 0, Math.PI * 2);
  context.fill();

  // Slightly sharper inner lip area
  context.globalAlpha = edgeAlpha;
  context.fillStyle = "rgba(175, 20, 55, 1)";
  context.beginPath();
  context.ellipse(0, mouthH * 0.06, mouthW * 0.46, mouthH * 0.44, 0, 0, Math.PI * 2);
  context.fill();

  // Highlight
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.10 * strength;
  context.fillStyle = "rgba(255,255,255,1)";
  context.beginPath();
  context.ellipse(-mouthW * 0.16, -mouthH * 0.18, mouthW * 0.12, mouthH * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawSticker(context) {
  if (!stickerReady || !stickerImg) return;
  const ft = getFaceTransform();
  if (!ft || ft.detected < FACE_RENDER_TH) return;

  const { x, y, s, rz, detected } = ft;
  const placement = currentEffect?.placement || { scale: 1.9, offsetX: 0, offsetY: -0.08, clamp: [70, 260] };
  const [wMin, wMax] = placement.clamp || [70, 260];
  const w = clamp(s * placement.scale, wMin, wMax);
  const h = (w / stickerImg.width) * stickerImg.height;

  context.save();
  const conf = clamp((detected - FACE_RENDER_TH) / (1 - FACE_RENDER_TH), 0, 1);
  const fade = 0.72 + 0.28 * conf; // keep visible even when tracking is a bit weak
  const baseAlpha = typeof placement.alpha === "number" ? clamp(placement.alpha, 0, 1) : 1;
  context.globalAlpha = baseAlpha * fade;
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
    // Beauty filter (if supported by the browser).
    const canFilter = "filter" in ctx;
    if (BEAUTY.enabled && canFilter) ctx.filter = BEAUTY.videoFilter;
    ctx.drawImage(v, sx, sy, side, side, 0, 0, cw, ch);
    if (canFilter) ctx.filter = "none";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
  }

  const now = performance.now();
  updateFaceSmoother(now);
  drawBeautyOverlay(ctx, now);
  drawLipstick(ctx, now);
  drawSticker(ctx);
  drawEffectOverlay(ctx, now);
  drawFrameOverlay(ctx);
  drawSubtitle(ctx, captionText);

  ctx.restore();

  rafId = requestAnimationFrame(drawFrame);
}

function drawFrameOverlay(context) {
  // Color filters / vignette (minimal face occlusion)
  if (currentEffect?.filter === "rainbowFrame") {
    context.save();
    // rainbow border
    const w = 18;
    const grad = context.createLinearGradient(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    grad.addColorStop(0, "#ff5aa5");
    grad.addColorStop(0.2, "#ffcc4a");
    grad.addColorStop(0.4, "#6be8ff");
    grad.addColorStop(0.6, "#7c5cff");
    grad.addColorStop(0.8, "#4cffb7");
    grad.addColorStop(1, "#ff5aa5");
    context.lineWidth = w;
    context.strokeStyle = grad;
    context.globalAlpha = 0.95;
    roundRectPath(context, w / 2 + 2, w / 2 + 2, OUTPUT_SIZE - w - 4, OUTPUT_SIZE - w - 4, 34);
    context.stroke();
    context.restore();
  }

  if (currentEffect?.filter === "candyFrame") {
    context.save();
    const w = 18;
    const grad = context.createLinearGradient(0, 0, OUTPUT_SIZE, 0);
    grad.addColorStop(0, "#ff86c8");
    grad.addColorStop(0.25, "#ffd36a");
    grad.addColorStop(0.5, "#7cf0ff");
    grad.addColorStop(0.75, "#b98cff");
    grad.addColorStop(1, "#4cffb7");
    context.lineWidth = w;
    context.strokeStyle = grad;
    context.globalAlpha = 0.95;
    roundRectPath(context, w / 2 + 2, w / 2 + 2, OUTPUT_SIZE - w - 4, OUTPUT_SIZE - w - 4, 34);
    context.stroke();

    // subtle diagonal stripes
    context.globalAlpha = 0.12;
    context.save();
    context.beginPath();
    roundRectPath(context, w + 2, w + 2, OUTPUT_SIZE - (w + 2) * 2, OUTPUT_SIZE - (w + 2) * 2, 26);
    context.clip();
    context.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    context.rotate(-0.5);
    context.translate(-OUTPUT_SIZE / 2, -OUTPUT_SIZE / 2);
    context.fillStyle = "rgba(255,255,255,0.95)";
    for (let x = -OUTPUT_SIZE; x < OUTPUT_SIZE * 2; x += 22) {
      context.fillRect(x, 0, 10, OUTPUT_SIZE * 2);
    }
    context.restore();

    context.restore();
  }

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
  faceSmooth = null;
  stopWebSpeech();
  stopWhisperCaptions();
}

function canUseWebSpeech() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function looksLikeSABOrCOIError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("sharedarraybuffer") ||
    msg.includes("crossoriginisolated") ||
    msg.includes("cross-origin-isolated") ||
    msg.includes("coep") ||
    msg.includes("coop") ||
    msg.includes("cross-origin")
  );
}

function startWebSpeech() {
  try {
    const Ctor = window.webkitSpeechRecognition || window.SpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "zh-CN";

    webSpeech = rec;

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
    rec.onerror = async (e) => {
      // Some WebViews expose the API but fail at runtime ("not-allowed" / "service-not-allowed").
      const err = String(e?.error || "").toLowerCase();
      stopWebSpeech();

      // Fallback to whisper realtime captions if possible.
      if (subtitleMode === "realtime" && !isRecording) {
        try {
          if (!hasMic) await ensureMicOnlyStream();
          await startWhisperRealtimeCaptions({ allowReload: false });
          setStatus("系统语音识别不可用：已切换到 whisper.wasm");
          return;
        } catch (werr) {
          console.warn(werr);
          pendingWhisperRealtimeStart = true;
        }
      }

      if (subtitleMode === "realtime") {
        // Don't over-emphasize WebSpeech failure; in iOS/WeChat this is expected.
        setStatus("系统语音识别不可用：将使用 whisper.wasm（点按任意位置可再试/启动）", "error");
        return;
      }

      if (err.includes("not-allowed") || err.includes("service-not-allowed")) {
        setStatus("系统语音识别不可用：未获得麦克风权限或系统不支持语音识别", "error");
      } else {
        setStatus("系统语音识别出错：请切换到“稳定字幕优先”或使用 whisper.wasm", "error");
      }
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

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

async function withConfirmBypassForLargeModelDownload(fn) {
  const orig = window.confirm;
  const shouldBypass = (msg) => {
    const s = String(msg || "");
    // whisper-web-transcriber uses a confirm like:
    // "You are about to download 57 MB of data. The model data will be cached..."
    return (
      s.includes("You are about to download") &&
      s.toLowerCase().includes("model data") &&
      s.toLowerCase().includes("cached")
    );
  };

  if (typeof orig !== "function") return fn();

  try {
    window.confirm = (msg) => {
      if (shouldBypass(msg)) return true;
      return orig(msg);
    };
    return await fn();
  } finally {
    window.confirm = orig;
  }
}

function initCoiState() {
  const attemptedAt = safeStorageGet(localStorage, COI_RELOAD_KEY);

  if (crossOriginIsolated) {
    safeStorageRemove(localStorage, COI_FAILED_KEY);
    if (attemptedAt) safeStorageRemove(localStorage, COI_RELOAD_KEY);
    return;
  }

  // If we already reloaded once for COI and still aren't isolated, don't try again.
  if (attemptedAt) {
    safeStorageSet(localStorage, COI_FAILED_KEY, "1");
  }
}

function coiFailed() {
  return safeStorageGet(localStorage, COI_FAILED_KEY) === "1";
}

async function ensureCoiForWhisper({ allowReload = false } = {}) {
  if (crossOriginIsolated) return true;
  if (coiFailed()) return false;
  if (!("serviceWorker" in navigator)) return false;

  try {
    await navigator.serviceWorker.register(COI_SW_URL, { scope: "./" });
    // Best-effort: give SW a moment to be ready.
    try {
      await navigator.serviceWorker.ready;
    } catch {
      // ignore
    }
  } catch (e) {
    console.warn(e);
    safeStorageSet(localStorage, COI_FAILED_KEY, "1");
    return false;
  }

  // If this page isn't controlled yet, a single reload is needed for COI headers to apply.
  if (!navigator.serviceWorker.controller) {
    const alreadyReloaded = !!safeStorageGet(localStorage, COI_RELOAD_KEY);
    if (!alreadyReloaded) {
      if (allowReload) {
        const stored = safeStorageSet(localStorage, COI_RELOAD_KEY, String(Date.now()));
        if (!stored) {
          // If we can't persist a guard flag, never auto-reload to avoid loops.
          safeStorageSet(localStorage, COI_FAILED_KEY, "1");
          return false;
        }
        setStatus("为启用字幕引擎（whisper.wasm），页面将刷新一次…");
        location.reload();
      } else {
        pendingCoiReload = true;
        setStatus("字幕引擎需要刷新一次才能启用：点按任意位置刷新", "error");
      }
      return false;
    }
    // Reload already happened but still no controller -> avoid loops.
    safeStorageSet(localStorage, COI_FAILED_KEY, "1");
    return false;
  }

  // Controlled but still not isolated -> likely not supported in this environment.
  if (!crossOriginIsolated) {
    safeStorageSet(localStorage, COI_FAILED_KEY, "1");
    return false;
  }

  return true;
}

async function ensureWhisperReady() {
  if (whisperReady) return;
  if (whisperInitPromise) return whisperInitPromise;

  whisperInitPromise = (async () => {
    await loadScriptOnce("./assets/stt/whisper-web-transcriber.bundled.min.js");

    const lib = window.WhisperTranscriber;
    const Ctor = lib?.WhisperTranscriber;
    if (typeof Ctor !== "function") {
      throw new Error("whisper.wasm 相关脚本加载失败");
    }

    if (!crossOriginIsolated) {
      // Not always a hard error, but many WASM builds need SharedArrayBuffer.
      console.warn("crossOriginIsolated=false; whisper.wasm 可能不可用或很慢（建议配置 COOP/COEP 或启用 COI SW）。");
    }

    whisperTranscriber = new Ctor({
      onStatus: (s) => {
        if (typeof s === "string" && s) setProgress(s);
      },
      onProgress: (p) => {
        if (typeof p === "number" && Number.isFinite(p)) setProgress(`${Math.round(p * 100)}%`);
      },
      onError: (err) => {
        console.error(err);
      },
      onTranscription: (t) => {
        const next = normalizeWhisperResult(t);
        if (!next) return;
        try {
          whisperTextListener?.(next);
        } catch {
          // ignore
        }
      },
      debug: false,
    });

    if (typeof whisperTranscriber.initialize === "function") {
      await whisperTranscriber.initialize();
    } else if (typeof whisperTranscriber.init === "function") {
      await whisperTranscriber.init();
    }

    if (typeof whisperTranscriber.loadModel === "function") {
      // The library may show a blocking confirm about downloading ~57MB.
      // Bypass it and rely on our own status/progress UI instead.
      setProgress("字幕模型下载中…");
      await withConfirmBypassForLargeModelDownload(() => whisperTranscriber.loadModel());
      setProgress("");
    }

    whisperReady = true;
  })();

  try {
    await whisperInitPromise;
  } finally {
    if (!whisperReady) whisperInitPromise = null;
  }
}

function normalizeWhisperResult(res) {
  if (!res) return "";
  if (typeof res === "string") return res.trim();
  if (typeof res.text === "string") return res.text.trim();
  if (typeof res.transcription === "string") return res.transcription.trim();
  if (typeof res.transcribedText === "string") return res.transcribedText.trim();
  return "";
}

function setWhisperTextListener(fn) {
  whisperTextListener = typeof fn === "function" ? fn : null;
}

function whisperIsActuallyRecording() {
  return !!(whisperIsRecording || whisperTranscriber?.isRecording);
}

async function startWhisperRealtimeCaptions({ allowReload = false } = {}) {
  // Ensure mic stream is available (some iOS WebViews don't include audio tracks on the camera stream).
  if (!hasMic) await ensureMicOnlyStream();
  if (!crossOriginIsolated && !coiFailed()) {
    // May require a single reload to enable SharedArrayBuffer.
    await ensureCoiForWhisper({ allowReload });
  }
  await ensureWhisperReady();
  if (typeof whisperTranscriber?.startRecording !== "function") {
    throw new Error("whisper.wasm 不支持 startRecording（脚本版本不匹配或未初始化）");
  }

  setWhisperTextListener((text) => {
    if (!isPreviewing) return;
    if (subtitleMode !== "realtime") return;
    captionText = text;
    captionSource = "whisper";
  });

  if (whisperIsActuallyRecording()) return;

  try {
    await whisperTranscriber.startRecording();
    whisperIsRecording = true;
    whisperNeedsUserGesture = false;
    pendingWhisperRealtimeStart = false;
  } catch (e) {
    // If COI/SAB is the real blocker, prompt a one-time reload when possible.
    if (!crossOriginIsolated && !coiFailed() && looksLikeSABOrCOIError(e)) {
      try {
        await ensureCoiForWhisper({ allowReload: false });
      } catch {
        // ignore
      }
    }
    // iOS/WebView often requires a user gesture to start audio capture/AudioContext.
    whisperNeedsUserGesture = true;
    pendingWhisperRealtimeStart = true;
    throw e;
  }
}

async function stopWhisperCaptions() {
  setWhisperTextListener(null);
  if (!whisperTranscriber) return;
  if (!whisperIsActuallyRecording()) return;
  try {
    await whisperTranscriber.stopRecording();
  } catch {
    // ignore
  }
  whisperIsRecording = false;
}

async function transcribeStableDuringRecording(durationMs) {
  if (!hasMic) await ensureMicOnlyStream();
  if (!crossOriginIsolated && !coiFailed()) {
    // May require a single reload to enable SharedArrayBuffer.
    await ensureCoiForWhisper({ allowReload: true });
  }
  await ensureWhisperReady();
  if (typeof whisperTranscriber?.startRecording !== "function") {
    throw new Error("whisper.wasm 不支持 startRecording（脚本版本不匹配或未初始化）");
  }

  let lastText = "";
  const prevListener = whisperTextListener;
  setWhisperTextListener((text) => {
    if (text) lastText = text;
  });

  try {
    await whisperTranscriber.startRecording();
    whisperIsRecording = true;
    whisperNeedsUserGesture = false;
    await new Promise((r) => setTimeout(r, durationMs));
    await whisperTranscriber.stopRecording();
  } finally {
    setWhisperTextListener(prevListener);
    whisperIsRecording = false;
  }

  // Give it a short time to flush.
  await new Promise((r) => setTimeout(r, 700));
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

function revokeOriginalGifUrl() {
  if (lastOriginalGifUrl) URL.revokeObjectURL(lastOriginalGifUrl);
  lastOriginalGifUrl = null;
}

function setGifBlob(blob) {
  revokeLastGifUrl();
  lastGifBlob = blob;
  lastGifUrl = blob ? URL.createObjectURL(blob) : null;
}

function setOriginalGifBlob(blob) {
  revokeOriginalGifUrl();
  lastOriginalGifBlob = blob;
  lastOriginalGifUrl = blob ? URL.createObjectURL(blob) : null;
}

function setToolActive(el, active) {
  if (!el) return;
  el.classList.toggle("is-active", !!active);
}

function resetResultEdits() {
  resultEdits = { cutout: false, fast: false, emojiImg: null };
  setToolActive(els.btnToolCutout, false);
  setToolActive(els.btnToolFast, false);
  setToolActive(els.btnToolEmoji, false);
}

function hasAnyEdits() {
  return !!(resultEdits.cutout || resultEdits.fast || resultEdits.emojiImg);
}

async function loadEmojiFromFile(file) {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode().catch(() => new Promise((r, rej) => ((img.onload = r), (img.onerror = rej))));
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function reencodeFromLastCapture() {
  if (isReencoding || isRecording) return;
  if (!lastCapture?.frames?.length) {
    setStatus("没有可编辑的拍摄内容，请先拍摄一次", "error");
    return;
  }

  // If no edits, restore original GIF quickly.
  if (!hasAnyEdits() && lastOriginalGifBlob) {
    setGifBlob(lastOriginalGifBlob);
    if (els.gifPreview) els.gifPreview.src = lastGifUrl;
    setStatus("已恢复原图");
    return;
  }

  isReencoding = true;
  setProgress("0%");
  setStatus("处理中…");

  const delayMs = Math.max(20, Math.round(lastCapture.delayMs / (resultEdits.fast ? 2 : 1)));
  const gif = createGifEncoder();
  gif.on("progress", (p) => setProgress(`${Math.round((p || 0) * 100)}%`));

  const finishedBlob = await new Promise((resolve, reject) => {
    gif.on("finished", resolve);
    try {
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = lastCapture.w;
      srcCanvas.height = lastCapture.h;
      const srcCtx = srcCanvas.getContext("2d", { alpha: false });

      const outCanvas = document.createElement("canvas");
      outCanvas.width = lastCapture.w;
      outCanvas.height = lastCapture.h;
      const outCtx = outCanvas.getContext("2d", { alpha: false });

      for (let i = 0; i < lastCapture.frames.length; i++) {
        const frame = lastCapture.frames[i];
        const face = lastCapture.faces?.[i] || null;

        srcCtx.putImageData(frame, 0, 0);

        // Base
        if (resultEdits.cutout && face) {
          // Blur background, keep face sharp.
          outCtx.save();
          outCtx.filter = "blur(10px) brightness(1.05) saturate(1.05)";
          outCtx.drawImage(srcCanvas, 0, 0);
          outCtx.restore();

          outCtx.save();
          clipEllipse(outCtx, face.x, face.y, face.rx, face.ry);
          outCtx.filter = "none";
          outCtx.drawImage(srcCanvas, 0, 0);
          outCtx.restore();

          // Soft edge
          outCtx.save();
          outCtx.globalAlpha = 0.55;
          outCtx.strokeStyle = "rgba(255,255,255,0.85)";
          outCtx.lineWidth = 2;
          outCtx.beginPath();
          outCtx.ellipse(face.x, face.y, face.rx, face.ry, 0, 0, Math.PI * 2);
          outCtx.stroke();
          outCtx.restore();
        } else {
          outCtx.filter = "none";
          outCtx.drawImage(srcCanvas, 0, 0);
        }

        // Emoji overlay (fixed corner; avoid face by placing bottom-left)
        if (resultEdits.emojiImg) {
          const margin = 14;
          const size = 86;
          const x = margin;
          const y = outCanvas.height - margin - size;
          outCtx.save();
          outCtx.globalAlpha = 0.96;
          outCtx.drawImage(resultEdits.emojiImg, x, y, size, size);
          outCtx.restore();
        }

        gif.addFrame(outCanvas, { copy: true, delay: delayMs });
      }

      gif.render();
    } catch (e) {
      reject(e);
    }
  }).catch((e) => {
    console.warn(e);
    setStatus("处理失败，请重试", "error");
    return null;
  });

  if (finishedBlob) {
    setGifBlob(finishedBlob);
    if (els.gifPreview) els.gifPreview.src = lastGifUrl;
    setStatus("处理完成");
  }

  setProgress("");
  isReencoding = false;
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
  pendingPreviewStart = false;
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
    pendingPreviewStart = true;
    setStatus("已获取权限但预览未启动：请点按任意按钮/页面一次以启动预览", "error");
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

  stopWebSpeech();
  stopWhisperCaptions();

  if (subtitleMode === "realtime") {
    if (canUseWebSpeech()) {
      startWebSpeech();
    } else {
      try {
        await startWhisperRealtimeCaptions({ allowReload: false });
      } catch (e) {
        console.warn(e);
        pendingWhisperRealtimeStart = true;
        if (!pendingCoiReload) {
          setStatus("实时字幕不可用：WebSpeech 不可用，whisper.wasm 启动失败（点按任意位置可再试）", "error");
        }
      }
    }
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
  // Reset editing state for the new capture:
  resetResultEdits();
  lastCapture = null;
  setOriginalGifBlob(null);

  const stableMode = subtitleMode === "stable";
  if (!stableMode) {
    // Real-time mode: prefer WebSpeech; otherwise use whisper.wasm as fallback.
    if (canUseWebSpeech()) {
      if (!webSpeech) startWebSpeech();
    } else {
      try {
        await startWhisperRealtimeCaptions({ allowReload: true });
      } catch (e) {
        console.warn(e);
        pendingWhisperRealtimeStart = true;
        if (!pendingCoiReload) {
          setStatus("实时字幕不可用：WebSpeech 不可用，whisper.wasm 启动失败（点按任意位置可再试）", "error");
        }
      }
    }
  } else {
    stopWebSpeech();
    stopWhisperCaptions();
    // Stable mode will degrade to empty captions if mic isn't available.
  }

  const frames = [];
  const faces = [];
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
      setGifBlob(blob);
      setOriginalGifBlob(blob);
      lastCapture = {
        frames,
        faces,
        delayMs: FRAME_DELAY_MS,
        w: OUTPUT_SIZE,
        h: OUTPUT_SIZE,
        caption: captionText || "",
      };
      setStatus("拍摄完成");
      setProgress("");
      isRecording = false;
      els.btnShutter.classList.remove("is-busy");
      stopShutterProgress();
      setShutterProgress(1);
      showResult();
    });
  }

  // Stable subtitles: transcribe after/around recording using whisper.wasm.
  let stableTranscribePromise = null;
  if (stableMode) {
    setStatus("准备中：初始化稳定字幕（whisper.wasm）…");
    setProgress("初始化字幕引擎…");
    try {
      await ensureWhisperReady();
      setStatus("录制中（3 秒）…请说话");
      stableTranscribePromise = transcribeStableDuringRecording(DURATION_S * 1000).catch(() => "");
    } catch (e) {
      console.warn(e);
      stableTranscribePromise = Promise.resolve("");
    }
    setProgress("");
  }

  let captured = 0;
  let resolveCapture = null;
  const captureDone = new Promise((r) => (resolveCapture = r));
  const captureTick = () => {
    if (captured >= FRAME_COUNT) return;
    captured++;
    try {
      // Always sample frames for post-edit tools.
      frames.push(ctx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE));
      faces.push(getFaceRegion());
      if (!stableMode) gif.addFrame(els.canvas, { copy: true, delay: FRAME_DELAY_MS });
      setProgress(`采样帧：${captured}/${FRAME_COUNT}`);
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
    stableCaption = (await stableTranscribePromise) || "";

    captionText = stableCaption;
    captionSource = stableCaption ? "whisper" : "none";

    setStatus("编码 GIF 中…");
    setProgress("0%");

    gif = createGifEncoder();
    gif.on("progress", (p) => {
      const pct = Math.round((p || 0) * 100);
      setProgress(`${pct}%`);
    });
    const finalFrames = [];

    gif.on("finished", (blob) => {
      setGifBlob(blob);
      setOriginalGifBlob(blob);
      lastCapture = {
        frames: finalFrames.length ? finalFrames : frames,
        faces,
        delayMs: FRAME_DELAY_MS,
        w: OUTPUT_SIZE,
        h: OUTPUT_SIZE,
        caption: captionText || "",
      };
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
      try {
        finalFrames.push(encodeCtx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE));
      } catch {
        // ignore
      }
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
    stopWhisperCaptions();
    if (!crossOriginIsolated && !coiFailed()) {
      ensureCoiForWhisper({ allowReload: true }).catch(() => {});
    }
    setStatus("稳定字幕优先：录制后转写并写入每帧");
  } else {
    stopWhisperCaptions();
    if (canUseWebSpeech()) {
      startWebSpeech();
      setStatus("实时字幕优先：系统语音识别");
    } else {
      startWhisperRealtimeCaptions({ allowReload: true })
        .then(() => setStatus("实时字幕优先：whisper.wasm"))
        .catch((e) => {
          console.warn(e);
          pendingWhisperRealtimeStart = true;
          if (!pendingCoiReload) {
            setStatus("实时字幕不可用：WebSpeech 不可用，whisper.wasm 启动失败（点按任意位置可再试）", "error");
          }
        });
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
  // Reflect current edit toggles (if any).
  setToolActive(els.btnToolCutout, !!resultEdits.cutout);
  setToolActive(els.btnToolFast, !!resultEdits.fast);
  setToolActive(els.btnToolEmoji, !!resultEdits.emojiImg);
}

function hideResult() {
  els.gifPreview.classList.remove("is-on");
  els.gifPreview.removeAttribute("src");
  els.sheet.hidden = false;
  els.resultPanel.hidden = true;
  setShutterProgress(0);
  // Hide edit state highlight when leaving result view.
  setToolActive(els.btnToolCutout, false);
  setToolActive(els.btnToolFast, false);
  setToolActive(els.btnToolEmoji, false);
}

function resetToDefaultView() {
  hideResult();
  setSheetExpanded(false);
  stopShutterProgress();
  els.btnShutter.classList.remove("is-busy");
  setShutterProgress(0);
  setProgress("");
  setStatus("正在启动…");
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
  } else if (eff.id === "heartBurst") {
    const palette = ["#ff5aa5", "#ff4d4d", "#ffcc4a", "#7c5cff", "#4cffb7"];
    for (let i = 0; i < 16; i++) {
      // bias to edges and upper area
      const edge = Math.floor(rnd() * 4);
      let x = rnd() * OUTPUT_SIZE;
      if (edge === 0) x = 18 + rnd() * 36;
      if (edge === 1) x = OUTPUT_SIZE - (18 + rnd() * 36);
      if (edge === 2) x = rnd() * OUTPUT_SIZE;
      if (edge === 3) x = rnd() * OUTPUT_SIZE;
      effectState.particles.push({
        x,
        y: rnd() * (OUTPUT_SIZE + 140),
        v: 55 + rnd() * 85,
        r: (rnd() - 0.5) * 0.6,
        s: 0.5 + rnd() * 0.55,
        p: rnd() * Math.PI * 2,
        c: palette[Math.floor(rnd() * palette.length)],
      });
    }
  } else if (eff.id === "bubbles") {
    const palette = [
      "rgba(110,200,255,0.85)",
      "rgba(255,170,210,0.85)",
      "rgba(255,225,120,0.85)",
      "rgba(140,255,210,0.85)",
    ];
    for (let i = 0; i < 12; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * (OUTPUT_SIZE + 120),
        v: 38 + rnd() * 62,
        r: 10 + rnd() * 18,
        w: 0.6 + rnd() * 1.2,
        p: rnd() * Math.PI * 2,
        c: palette[Math.floor(rnd() * palette.length)],
      });
    }
  } else if (eff.id === "starRain") {
    const palette = ["#ffe27a", "#ffffff", "#ffd1e6", "#b7f0ff", "#d7e2ff"];
    for (let i = 0; i < 18; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * (OUTPUT_SIZE + 130),
        v: 90 + rnd() * 150,
        r: (rnd() - 0.5) * 0.8,
        s: 0.75 + rnd() * 0.65,
        p: rnd() * Math.PI * 2,
        c: palette[Math.floor(rnd() * palette.length)],
      });
    }
  } else if (eff.id === "confetti") {
    const palette = ["#ff5aa5", "#ffcc4a", "#6be8ff", "#7c5cff", "#4cffb7", "#ffffff"];
    for (let i = 0; i < 22; i++) {
      effectState.particles.push({
        x: rnd() * OUTPUT_SIZE,
        y: rnd() * (OUTPUT_SIZE + 150),
        v: 95 + rnd() * 180,
        r: (rnd() - 0.5) * 1.2,
        w: 6 + rnd() * 10,
        h: 4 + rnd() * 10,
        p: rnd() * Math.PI * 2,
        c: palette[Math.floor(rnd() * palette.length)],
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

  if (effect.icon?.bg) {
    thumb.classList.add("wx-thumb--kid");
    thumb.style.setProperty("--kidbg", effect.icon.bg);
  }
  if (effect.icon?.emoji) {
    const emoji = document.createElement("div");
    emoji.className = "wx-thumbEmoji";
    emoji.textContent = effect.icon.emoji;
    thumb.appendChild(emoji);
  } else if (effect.sticker) {
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
  if (effect.icon?.bg) {
    icon.classList.add("wx-gridIcon--kid");
    icon.style.setProperty("--kidbg", effect.icon.bg);
  }
  if (effect.icon?.emoji) {
    const emoji = document.createElement("div");
    emoji.className = "wx-gridEmoji";
    emoji.textContent = effect.icon.emoji;
    icon.appendChild(emoji);
  } else if (effect.sticker) {
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

  // Expanded grid: show all effects without "more".
  els.effectGrid.innerHTML = "";
  const gridEffects = effects.filter((e) => e.id !== "more");
  for (const eff of gridEffects) {
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
    // Request permissions on load, and try to start preview immediately.
    await ensureMediaStream();
    setStatus("已获取权限：正在启动预览…");
    await startPreview();
    // If preview still can't start (iOS gesture restriction), keep status only (no overlay).
    if (!isPreviewing && streamIsLive(mediaStream)) pendingPreviewStart = true;
  } catch (err) {
    setStatus(`无法获取权限：${err?.message || err}`, "error");
  }
}

function onAnyUserGesture() {
  // Help iOS Safari/WebViews start <video> playback and any audio processing.
  tryResumeVideoPlayback();

  // If whisper engine needs a one-time COI reload, do it only after a user gesture (avoid "auto refresh").
  if (pendingCoiReload && !crossOriginIsolated && !coiFailed()) {
    pendingCoiReload = false;
    ensureCoiForWhisper({ allowReload: true }).catch(() => {});
  }

  // If preview couldn't start due to gesture restriction, retry now.
  if (pendingPreviewStart && !isPreviewing && streamIsLive(mediaStream)) {
    startPreview().catch(() => {});
  }

  // If whisper realtime captions couldn't start due to gesture restriction, retry now.
  if (pendingWhisperRealtimeStart && isPreviewing && subtitleMode === "realtime" && !isRecording) {
    startWhisperRealtimeCaptions({ allowReload: true })
      .then(() => setStatus("实时字幕：whisper.wasm 已启动"))
      .catch(() => {});
  }
}

// iOS gesture hooks: don't block clicks.
window.addEventListener("pointerup", onAnyUserGesture, { passive: true });
window.addEventListener("touchend", onAnyUserGesture, { passive: true });

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

els.btnToolCutout?.addEventListener("click", async () => {
  if (!lastGifBlob) return;
  resultEdits.cutout = !resultEdits.cutout;
  setToolActive(els.btnToolCutout, resultEdits.cutout);
  await reencodeFromLastCapture();
});

els.btnToolFast?.addEventListener("click", async () => {
  if (!lastGifBlob) return;
  resultEdits.fast = !resultEdits.fast;
  setToolActive(els.btnToolFast, resultEdits.fast);
  await reencodeFromLastCapture();
});

els.btnToolEmoji?.addEventListener("click", async () => {
  if (!lastGifBlob) return;
  if (resultEdits.emojiImg) {
    resultEdits.emojiImg = null;
    setToolActive(els.btnToolEmoji, false);
    await reencodeFromLastCapture();
    return;
  }
  if (!els.emojiFile) return;
  els.emojiFile.value = "";
  els.emojiFile.click();
});

els.emojiFile?.addEventListener("change", async () => {
  const f = els.emojiFile.files && els.emojiFile.files[0];
  if (!f) return;
  try {
    const img = await loadEmojiFromFile(f);
    if (!img) return;
    resultEdits.emojiImg = img;
    setToolActive(els.btnToolEmoji, true);
    await reencodeFromLastCapture();
  } catch (e) {
    console.warn(e);
    setStatus("贴表情失败：无法读取图片", "error");
  }
});

els.btnSubRealtime.addEventListener("click", () => setSubtitleMode("realtime"));
els.btnSubStable.addEventListener("click", () => setSubtitleMode("stable"));

// First paint
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
initCoiState();
if (els.version) els.version.textContent = APP_VERSION;
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
