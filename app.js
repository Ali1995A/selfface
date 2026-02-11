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
  toast: document.getElementById("toast"),
  shareOverlay: document.getElementById("shareImageOverlay"),
  shareImage: document.getElementById("shareImage"),

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
};

const ctx = els.canvas.getContext("2d", { alpha: true, desynchronized: true });

let mediaStream = null;
let faceState = null;
let faceSmooth = null; // { x,y,s,rz,detected,lastMs,lastSeenMs }
let rafId = 0;
let isPreviewing = false;
let isRecording = false;
let jeelizReady = false;
let jeelizInitPromise = null;
let previewFinalized = false;
let lastGifBlob = null;
let lastGifUrl = null;
let lastOriginalGifBlob = null;
let lastOriginalGifUrl = null;
let lastCapture = null; // { frames: ImageData[], faces: (FaceRegion|null)[], delayMs:number, w:number, h:number }
let isReencoding = false;
let resultEdits = { cutout: false, fast: false, emojiImg: null }; // emojiImg: HTMLImageElement|null
let pendingPreviewStart = false;
let resumePreviewPromise = null;
let currentFacingMode = "user"; // "user" | "environment"
let hasRequestedPermissions = false;
let lastStreamFacingMode = null;
let meme = { text: "", x: OUTPUT_SIZE / 2, y: 285, fontSize: 28, visible: false };
let memeDrag = { active: false, dx: 0, dy: 0, pointerId: null };

let stickerImg = null;
let stickerReady = false;
let imageCache = new Map(); // url -> Image
let imageLoading = new Map(); // url -> Promise<Image|null>
let currentEffect = null;
let frameImg = null;

// Speech-to-text / subtitles are temporarily removed (per product decision).

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

let toastTimer = 0;
function showToast(text, tone = "normal", { durationMs = 2600 } = {}) {
  if (!els.toast) return;
  const msg = String(text || "").trim();
  if (!msg) {
    els.toast.hidden = true;
    els.toast.textContent = "";
    els.toast.classList.remove("is-error");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = 0;
    return;
  }

  els.toast.hidden = false;
  els.toast.textContent = msg;
  els.toast.classList.toggle("is-error", tone === "error");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    // Only auto-hide if the toast wasn't updated in the meantime.
    if (els.toast && els.toast.textContent === msg) {
      els.toast.hidden = true;
    }
  }, Math.max(800, durationMs || 0));
}

function setStatus(text, tone = "normal") {
  els.status.textContent = text || "";
  els.status.style.color = tone === "error" ? "#d23b3b" : "#8c9096";
  // Result view hides the sheet HUD; show a lightweight toast for important messages.
  if (!els.sheet.hidden) return;
  showToast(text || "", tone);
}

function setProgress(text) {
  els.progress.textContent = text || "";
  // Show progress in toast only when in result view (HUD hidden).
  if (!els.sheet.hidden) return;
  if (!text) return;
  showToast(text, "normal", { durationMs: 1200 });
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
    img.decoding = "async";
    const to = setTimeout(() => {
      cleanup();
      reject(new Error("image load timeout"));
    }, 8000);
    const cleanup = () => {
      clearTimeout(to);
      img.onload = null;
      img.onerror = null;
    };
    img.onload = async () => {
      // Ensure Safari has decoded the image before we try drawImage during animation frames.
      try {
        if (typeof img.decode === "function") await img.decode();
      } catch {
        // ignore decode failures; drawImage may still work
      }
      cleanup();
      resolve(img);
    };
    img.onerror = (e) => {
      cleanup();
      reject(e);
    };
    img.src = src;
  });
}

async function loadImageCached(src) {
  if (!src) return null;
  const cached = imageCache.get(src);
  if (cached) return cached;

  const pending = imageLoading.get(src);
  if (pending) return pending;

  const p = preloadImage(src)
    .then((img) => {
      imageCache.set(src, img);
      imageLoading.delete(src);
      return img;
    })
    .catch((e) => {
      console.warn("Failed to load image:", src, e);
      imageLoading.delete(src);
      return null;
    });

  imageLoading.set(src, p);
  return p;
}

async function preloadStickers() {
  const sources = effects
    .flatMap((e) => [e.sticker, e.frame])
    .filter((s) => typeof s === "string" && s);
  const uniq = Array.from(new Set(sources));
  const res = await Promise.allSettled(uniq.map((s) => loadImageCached(s)));
  for (let i = 0; i < uniq.length; i++) {
    const r = res[i];
    if (r.status === "fulfilled" && r.value) imageCache.set(uniq[i], r.value);
  }
  stickerReady = true;
}

function stopTracks(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

function attachStreamToVideo(stream) {
  const v = els.video;
  // Set flags before assigning srcObject (iOS Safari can be picky).
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  try {
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("muted", "");
    v.setAttribute("autoplay", "");
  } catch {
    // ignore
  }

  // Mirror the visible <video> so it matches the canvas preview (front camera).
  try {
    v.style.transform = currentFacingMode !== "environment" ? "scaleX(-1)" : "none";
  } catch {
    // ignore
  }

  v.srcObject = stream;

  // Retry play once metadata is ready (some iOS builds require this ordering).
  try {
    v.onloadedmetadata = () => {
      tryResumeVideoPlayback();
    };
  } catch {
    // ignore
  }
  // Note: iOS may reject play() without a user gesture; we will retry.
  v.play().catch(() => {});
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
    throw new Error("必须在 HTTPS（或 localhost）下才能调用摄像头。");
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("当前浏览器不支持 getUserMedia（无法调用摄像头）。");
  }

  // iOS / some WebViews can be flaky with permissions; keep it camera-only.
  const videoStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facingMode || "user" },
    audio: false,
  });

  return new MediaStream([...videoStream.getVideoTracks()]);
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
  mediaStream = null;

  const stream = await requestMedia(currentFacingMode);
  mediaStream = stream;
  lastStreamFacingMode = currentFacingMode;
  hasRequestedPermissions = true;
  return stream;
}

async function ensureVideoReady(videoEl, { timeoutMs = 12000 } = {}) {
  const start = performance.now();
  let lastPlayTry = 0;
  let lastTime = videoEl.currentTime || 0;
  let gotFrameCb = false;

  const tryPlay = () => {
    const now = performance.now();
    if (now - lastPlayTry < 450) return;
    lastPlayTry = now;
    tryResumeVideoPlayback();
  };

  return new Promise((resolve, reject) => {
    const tryRvfcb = () => {
      if (gotFrameCb) return;
      if (typeof videoEl.requestVideoFrameCallback !== "function") return;
      try {
        videoEl.requestVideoFrameCallback(() => {
          gotFrameCb = true;
        });
      } catch {
        // ignore
      }
    };

    const tick = () => {
      const hasDims = videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
      const timeNow = videoEl.currentTime || 0;
      const advanced = timeNow !== lastTime && timeNow > 0;
      lastTime = timeNow;
      const seemsPlaying = videoEl.readyState >= 2 && !videoEl.paused;

      // Require both metadata and actual frame progress (fixes iPad Chrome black preview).
      if (hasDims && (gotFrameCb || advanced || seemsPlaying)) return resolve();
      if (performance.now() - start > timeoutMs) return reject(new Error("摄像头初始化超时"));
      tryRvfcb();
      tryPlay();
      requestAnimationFrame(tick);
    };
    tryRvfcb();
    tryPlay();
    tick();
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

function promiseTimeout(promise, timeoutMs, timeoutMessage = "timeout") {
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(timeoutMessage));
    }, Math.max(0, timeoutMs || 0));
    Promise.resolve(promise)
      .then((v) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve(v);
      })
      .catch((e) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        reject(e);
      });
  });
}

function startJeelizInBackground() {
  if (jeelizReady) return Promise.resolve(true);
  if (jeelizInitPromise) return jeelizInitPromise;

  jeelizInitPromise = (async () => {
    try {
      await promiseTimeout(initJeelizFaceFilter(), 6000, "jeeliz init timeout");
      jeelizReady = true;
      return true;
    } catch (e) {
      console.warn(e);
      try {
        destroyJeeliz();
      } catch {
        // ignore
      }
      jeelizReady = false;
      if (isPreviewing) setStatus("预览中（人脸跟踪暂不可用）", "error");
      return false;
    }
  })();

  return jeelizInitPromise;
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

   // Some asymmetric stickers should mirror with the selfie preview.
   // (Text overlays are drawn separately and remain readable.)
   const mirrorSticker = currentFacingMode !== "environment" && currentEffect?.mirrorSticker !== false;
   if (mirrorSticker) context.scale(-1, 1);
  try {
    context.drawImage(stickerImg, -w / 2, -h / 2, w, h);
  } catch (e) {
    console.warn("drawImage(sticker) failed", e);
    stickerImg = null;
  }
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
    try {
      ctx.drawImage(v, sx, sy, side, side, 0, 0, cw, ch);
    } catch (e) {
      // iOS Safari/WebViews can occasionally throw from drawImage(video). Keep rendering loop alive.
      console.warn("drawImage(video) failed", e);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      // Keep canvas transparent so the underlying <video> can still be seen.
      ctx.clearRect(0, 0, cw, ch);
    }
    if (canFilter) ctx.filter = "none";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    // No metadata yet: keep transparent so <video> can show when it becomes ready.
    ctx.clearRect(0, 0, cw, ch);
  }

  const now = performance.now();
  updateFaceSmoother(now);
  drawBeautyOverlay(ctx, now);
  drawLipstick(ctx, now);
  drawSticker(ctx);
  drawEffectOverlay(ctx, now);
  drawFrameOverlay(ctx);
  drawMemeText(ctx);

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
    try {
      context.drawImage(frameImg, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    } catch (e) {
      console.warn("drawImage(frame) failed", e);
      frameImg = null;
    }
    context.restore();
  }
}

const MEME_PHRASES = [
  "太开心啦！",
  "耶～",
  "我超厉害",
  "给你比心",
  "冲鸭！",
  "好耶！",
  "今天真棒",
  "笑一笑",
  "爱你哟",
  "可可爱爱",
  "哇哦！",
  "安排！",
  "我来了",
  "看我的",
  "好运来",
  "一起玩吧",
  "你真好",
  "别紧张",
  "我不怕",
  "开心到飞起",
  "开拍啦",
  "出发！",
  "好喜欢",
  "棒棒哒",
];

function pickRandom(arr) {
  if (!arr || !arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}

function canvasPointFromClient(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * OUTPUT_SIZE;
  const y = ((clientY - rect.top) / rect.height) * OUTPUT_SIZE;
  return { x, y };
}

function pointInRect(px, py, r) {
  return !!r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function getMemeBounds(context) {
  if (!meme.visible || !meme.text) return null;
  const fs = meme.fontSize || 28;
  context.save();
  context.font = `900 ${fs}px -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif`;
  const w = context.measureText(meme.text).width;
  context.restore();
  const padX = 14;
  const padY = 10;
  const h = fs * 1.2;
  return {
    x: meme.x - w / 2 - padX,
    y: meme.y - h / 2 - padY,
    w: w + padX * 2,
    h: h + padY * 2,
  };
}

function drawMemeText(context) {
  if (!meme.visible || !meme.text) return;

  const fs = meme.fontSize || 28;
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${fs}px -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif`;

  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "rgba(0,0,0,0.92)";
  context.lineWidth = Math.max(6, Math.round(fs * 0.22));
  context.strokeText(meme.text, meme.x, meme.y);

  context.fillStyle = "rgba(255,255,255,0.98)";
  context.fillText(meme.text, meme.x, meme.y);

  context.restore();
}

function spawnRandomMeme() {
  const text = pickRandom(MEME_PHRASES);
  if (!text) return;

  meme.text = text;
  meme.visible = true;

  const pad = 62;
  meme.x = pad + Math.random() * (OUTPUT_SIZE - pad * 2);
  meme.y = pad + Math.random() * (OUTPUT_SIZE - pad * 2);

  setProgress("已添加文案：拖动可调整位置");
  setTimeout(() => setProgress(""), 1200);
}

function stopPreview() {
  isPreviewing = false;
  previewFinalized = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  destroyJeeliz();
  jeelizInitPromise = null;
  jeelizReady = false;
  stopTracks(mediaStream);
  mediaStream = null;
  lastStreamFacingMode = null;
  faceState = null;
  faceSmooth = null;
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

async function finalizePreviewStart() {
  if (previewFinalized) return;
  previewFinalized = true;

  if (!isPreviewing) {
    isPreviewing = true;
    drawFrame();
  }

  setStatus("预览中：点击快门录制 3 秒 GIF");

  // Initialize face tracking in background so preview never hangs/black-screens.
  startJeelizInBackground();
}

async function resumePendingPreviewStart({ timeoutMs = 9000 } = {}) {
  if (isPreviewing) return;
  if (!pendingPreviewStart) return;
  if (!streamIsLive(mediaStream)) return;
  if (resumePreviewPromise) return resumePreviewPromise;

  resumePreviewPromise = (async () => {
    try {
      // Keep the same stream; just try to start playback after the user gesture.
      attachStreamToVideo(mediaStream);
      await ensureVideoReady(els.video, { timeoutMs });
    } catch {
      return;
    }
    pendingPreviewStart = false;
    await finalizePreviewStart();
  })().finally(() => {
    resumePreviewPromise = null;
  });

  return resumePreviewPromise;
}

async function startPreview() {
  hideResult();
  pendingPreviewStart = false;
  previewFinalized = false;
  if (isPreviewing) stopPreview();
  setProgress("");
  setStatus("初始化中：请求摄像头权限…");

  try {
    await preloadStickers();
  } catch {
    // Stickers missing shouldn't block preview.
  }

  let gotStream = false;
  const permHintTo = setTimeout(() => {
    if (gotStream) return;
    setProgress("如果没有弹出授权弹窗：请检查 iPad/微信的摄像头权限，然后点按页面任意位置再试");
  }, 2500);

  try {
    mediaStream = await ensureMediaStream();
    gotStream = true;
  } catch (err) {
    setStatus(`权限被拒绝或设备不可用：${err?.message || err}`, "error");
    clearTimeout(permHintTo);
    return;
  } finally {
    clearTimeout(permHintTo);
  }

  try {
    attachStreamToVideo(mediaStream);
    await ensureVideoReady(els.video, { timeoutMs: 15000 });
  } catch (err) {
    // Common on iOS: permission granted but playback needs user gesture.
    pendingPreviewStart = true;
    setStatus("已获取权限但预览未启动：请点按任意按钮/页面一次以启动预览", "error");

    // Keep the render loop alive so the underlying <video> can still show, and finalize automatically
    // once frames start flowing (after a user gesture in some environments).
    if (!isPreviewing) {
      isPreviewing = true;
      drawFrame();
    }
    const watchTo = setTimeout(() => {
      if (!previewFinalized && isPreviewing) {
        setStatus("仍未启动预览：请再次点按页面/快门按钮", "error");
      }
    }, 9000);
    ensureVideoReady(els.video, { timeoutMs: 30000 })
      .then(() => finalizePreviewStart())
      .catch(() => {})
      .finally(() => clearTimeout(watchTo));
    return;
  }

  await finalizePreviewStart();
}

async function recordGif3s() {
  if (!isPreviewing || isRecording) return;
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setStatus("预览未就绪：请等待摄像头画面出现后再录制", "error");
    return;
  }

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

  const frames = [];
  const faces = [];
  const startedAt = performance.now();

  setStatus("录制中（3 秒）…");

  const gif = createGifEncoder();
  gif.on("progress", (p) => {
    const pct = Math.round((p || 0) * 100);
    setProgress(`${pct}%`);
  });

  const finishedBlob = await new Promise((resolve) => {
    let done = false;

    const finish = (blob) => {
      if (done) return;
      done = true;
      resolve(blob || null);
    };

    gif.on("finished", (blob) => finish(blob));

    // Capture frames for exactly 3 seconds at 10fps.
    let captured = 0;
    const captureTick = () => {
      if (captured >= FRAME_COUNT) return;
      captured++;
      try {
        // Sample final canvas only (no extra computation during recording).
        frames.push(ctx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE));
        faces.push(getFaceRegion());
        gif.addFrame(els.canvas, { copy: true, delay: FRAME_DELAY_MS });
        setProgress(`采样帧：${captured}/${FRAME_COUNT}`);
      } catch {
        // ignore
      }

      if (captured >= FRAME_COUNT) {
        try {
          clearInterval(timer);
        } catch {
          // ignore
        }
        setStatus("编码 GIF 中…");
        setProgress("0%");
        try {
          gif.render();
        } catch {
          finish(null);
        }
      }
    };

    captureTick();
    const timer = setInterval(captureTick, FRAME_DELAY_MS);

    // Safety timeout: never hang the UI.
    setTimeout(() => finish(null), 15000);
  });

  if (finishedBlob) {
    setGifBlob(finishedBlob);
    setOriginalGifBlob(finishedBlob);
    lastCapture = {
      frames,
      faces,
      delayMs: FRAME_DELAY_MS,
      w: OUTPUT_SIZE,
      h: OUTPUT_SIZE,
    };
    setStatus("拍摄完成");
    showResult();
  } else {
    setStatus("拍摄失败，请重试", "error");
  }

  setProgress("");
  isRecording = false;
  els.btnShutter.classList.remove("is-busy");
  stopShutterProgress();
  setShutterProgress(0);

  const elapsed = Math.round(performance.now() - startedAt);
  console.debug(`record done, frames=${frames.length}, elapsedMs=${elapsed}`);
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

function isWeChatWebView() {
  const ua = String(navigator.userAgent || "");
  return /MicroMessenger/i.test(ua);
}

function showShareOverlay(url) {
  if (!els.shareOverlay || !els.shareImage) return;
  els.shareImage.src = url || "";
  els.shareOverlay.hidden = false;
}

function hideShareOverlay() {
  if (!els.shareOverlay || !els.shareImage) return;
  els.shareOverlay.hidden = true;
  try {
    els.shareImage.removeAttribute("src");
  } catch {
    // ignore
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

function copyToClipboardFallback(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = String(text || "");
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand && document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  const s = String(text || "");
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // ignore
  }
  return copyToClipboardFallback(s);
}

function waitWeixinBridgeReady(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const w = window;
    if (w.WeixinJSBridge) return resolve(w.WeixinJSBridge);
    let done = false;
    const finish = (b) => {
      if (done) return;
      done = true;
      resolve(b || null);
    };
    const to = setTimeout(() => finish(null), timeoutMs);
    document.addEventListener(
      "WeixinJSBridgeReady",
      () => {
        clearTimeout(to);
        finish(w.WeixinJSBridge || null);
      },
      { once: true },
    );
  });
}

async function weChatOpenImagePreview(url) {
  const bridge = await waitWeixinBridgeReady(1500);
  if (!bridge || typeof bridge.invoke !== "function") return false;
  try {
    bridge.invoke("imagePreview", { current: url, urls: [url] }, () => {});
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

async function weChatShareLinkToFriend(url) {
  const link = String(url || location.href);
  const bridge = await waitWeixinBridgeReady(1500);
  if (!bridge || typeof bridge.invoke !== "function") return false;

  return new Promise((resolve) => {
    try {
      bridge.invoke(
        "sendAppMessage",
        {
          title: "selfface",
          desc: "点击打开并保存 GIF",
          link,
          img_url: "",
          img_width: "120",
          img_height: "120",
        },
        (res) => {
          const msg = String(res?.err_msg || res?.errMsg || "").toLowerCase();
          // ok / cancel / fail
          if (msg.includes("ok")) resolve(true);
          else if (msg.includes("cancel")) resolve(true);
          else resolve(false);
        },
      );
    } catch (e) {
      console.warn(e);
      resolve(false);
    }
  });
}

async function sharePageLink() {
  // In WeChat iOS WebView, Web Share API is often unreliable; prefer WeixinJSBridge.
  if (isWeChatWebView()) {
    const ok = await weChatShareLinkToFriend(location.href);
    if (ok) {
      setStatus("已打开微信“转发给朋友”（分享链接）");
      return true;
    }

    const copied = await copyToClipboard(location.href);
    setStatus(
      copied
        ? "已复制链接：请打开微信聊天窗口粘贴发送，或点右上角“⋯”分享"
        : "请点右上角“⋯”使用微信分享（本环境不支持直接转发 GIF 文件）",
      "error",
    );
    return copied;
  }

  if (!navigator.share) return false;
  try {
    await navigator.share({
      title: "selfface",
      text: "selfface",
      url: location.href,
    });
    setStatus("已打开系统分享面板（分享链接）");
    return true;
  } catch (e) {
    if (String(e?.name || "").toLowerCase().includes("abort")) return true;
    console.warn(e);
    return false;
  }
}

async function shareGif() {
  if (!lastGifBlob) {
    setStatus("还没有可分享的 GIF，请先拍摄一次", "error");
    return;
  }

  // WeChat: share the generated image (best-effort). Direct file-share to chats is unreliable;
  // open image preview and let user long-press “发送给朋友/保存”. This matches WeChat's security model.
  if (isWeChatWebView()) {
    setStatus("正在打开图片预览…");
    const url = lastGifUrl || (lastGifBlob ? URL.createObjectURL(lastGifBlob) : "");
    if (url) showShareOverlay(url);

    // Try WeChat native preview first (may expose “发送给朋友”). If it rejects blob:, try data URL.
    let ok = url ? await weChatOpenImagePreview(url) : false;
    if (!ok && lastGifBlob) {
      try {
        const dataUrl = await blobToDataUrl(lastGifBlob);
        if (dataUrl) {
          showShareOverlay(dataUrl);
          ok = await weChatOpenImagePreview(dataUrl);
        }
      } catch (e) {
        console.warn(e);
      }
    }

    if (!ok) setStatus("已打开图片：长按 → 发送给朋友 / 保存到相册", "error");
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

  // Many iOS setups (and especially WeChat) don't accept sharing a GIF file directly to chats.
  // Fall back to sharing the page link, which is the most compatible “share to WeChat friend” option.
  if (await sharePageLink()) return;

  // Fallbacks:
  // Open the GIF so user can long-press to save, then send from Photos in WeChat.
  if (lastGifUrl) {
    try {
      const w = window.open(lastGifUrl, "_blank", "noopener,noreferrer");
      if (!w) throw new Error("popup blocked");
      setStatus("已打开 GIF：可长按保存到相册，再在微信发送", "error");
    } catch {
      // Some WebViews block popups; keep the GIF visible and instruct user.
      setStatus(
        isWeChatWebView()
          ? "微信内置浏览器可能不支持直接转发 GIF：请点“下载”保存到相册，再在微信发送"
          : "当前环境不支持直接分享：请点“下载”保存到相册后再分享",
        "error",
      );
    }
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

  if (isWeChatWebView()) {
    // WeChat WebView is inconsistent with downloads; the most reliable path is long-press on preview.
    setStatus("微信内：已打开图片，长按 → 保存到相册", "error");
    if (lastGifUrl) showShareOverlay(lastGifUrl);
    try {
      // Still try a normal download as a secondary path.
      downloadGif();
    } catch {
      // ignore
    }
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

function bindTap(el, onTap, { moveThreshold = 10, maxPressMs = 700 } = {}) {
  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let moved = false;
  let lastFireAt = 0;

  const nowMs = () => performance.now();

  const setStart = (x, y) => {
    startX = x;
    startY = y;
    startAt = nowMs();
    moved = false;
  };
  const markMove = (x, y) => {
    if (moved) return;
    const dx = x - startX;
    const dy = y - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) moved = true;
  };

  const fire = (e) => {
    const t = nowMs();
    if (t - lastFireAt < 320) return; // avoid double-fire from touchend + click
    lastFireAt = t;
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    } catch {
      // ignore
    }
    onTap(e);
  };

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.isPrimary === false) return;
      setStart(e.clientX || 0, e.clientY || 0);
    },
    { passive: true },
  );
  el.addEventListener(
    "pointermove",
    (e) => {
      if (e.isPrimary === false) return;
      markMove(e.clientX || 0, e.clientY || 0);
    },
    { passive: true },
  );
  el.addEventListener(
    "pointerup",
    (e) => {
      if (e.isPrimary === false) return;
      if (moved) return;
      if (nowMs() - startAt > maxPressMs) return;
      fire(e);
    },
    { passive: false },
  );

  // iOS WeChat WebView fallback:
  el.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      setStart(t.clientX || 0, t.clientY || 0);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      markMove(t.clientX || 0, t.clientY || 0);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchend",
    (e) => {
      if (moved) return;
      if (nowMs() - startAt > maxPressMs) return;
      fire(e);
    },
    { passive: false },
  );

  el.addEventListener("click", (e) => fire(e));
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

  const nextStickerSrc = eff.sticker || "";
  const nextFrameSrc = eff.frame || "";

  stickerImg = nextStickerSrc ? imageCache.get(nextStickerSrc) || null : null;
  frameImg = nextFrameSrc ? imageCache.get(nextFrameSrc) || null : null;

  // Lazy-load missing assets to make effect switching reliable even if preload was interrupted.
  if (nextStickerSrc && !stickerImg) {
    loadImageCached(nextStickerSrc).then((img) => {
      if (!img) return;
      if (selectedEffectId !== eff.id) return;
      stickerImg = img;
    });
  }
  if (nextFrameSrc && !frameImg) {
    loadImageCached(nextFrameSrc).then((img) => {
      if (!img) return;
      if (selectedEffectId !== eff.id) return;
      frameImg = img;
    });
  }

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

  if (effect.id === "none") {
    const memeBtn = document.createElement("button");
    memeBtn.type = "button";
    memeBtn.className = "wx-memeBtn";
    memeBtn.textContent = "随机文案";
    bindTap(memeBtn, (e) => {
      try {
        e?.preventDefault?.();
        e?.stopPropagation?.();
      } catch {
        // ignore
      }
      spawnRandomMeme();
    });
    item.appendChild(memeBtn);
  }

  bindTap(item, () => {
    try {
      if (effect.id === "more") {
        setSheetExpanded(true);
        return;
      }
      setEffect(effect.id);
    } catch (e) {
      console.warn(e);
      setStatus("切换特效失败：资源加载异常", "error");
    }
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

  bindTap(item, () => {
    try {
      if (effect.id === "more") return;
      setEffect(effect.id);
      setSheetExpanded(false);
    } catch (e) {
      console.warn(e);
      setStatus("切换特效失败：资源加载异常", "error");
    }
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
    // Don't call ensureMediaStream() here (startPreview() will do it). This avoids an "init stuck"
    // state if the mic prompt is delayed/suppressed in some iPad/WeChat WebViews.
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

  // If preview couldn't start due to gesture restriction, retry now.
  if (pendingPreviewStart && !isPreviewing && streamIsLive(mediaStream)) {
    resumePendingPreviewStart().catch(() => {});
  }
}

// iOS gesture hooks: don't block clicks.
window.addEventListener("pointerup", onAnyUserGesture, { passive: true });
window.addEventListener("touchend", onAnyUserGesture, { passive: true });
window.addEventListener("pointerdown", onAnyUserGesture, { passive: true });
window.addEventListener("touchstart", onAnyUserGesture, { passive: true });

// Share overlay close
if (els.shareOverlay) {
  els.shareOverlay.addEventListener(
    "click",
    () => {
      hideShareOverlay();
    },
    { passive: true },
  );
}

els.btnSwitchCam.addEventListener("click", async () => {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  await startPreview();
});

bindTap(els.btnRetake, () => {
  hideResult();
  setStatus("重拍：点击快门录制");
});

bindTap(els.btnDownload, () => {
  saveToPhotos();
});

bindTap(els.btnShare, () => {
  shareGif();
});

function bindMemeDrag() {
  const el = els.canvas;
  if (!el) return;

  const onDown = (clientX, clientY, pointerId = null) => {
    if (!meme.visible || !meme.text) return false;
    const pt = canvasPointFromClient(clientX, clientY);
    const bounds = getMemeBounds(ctx);
    if (!pointInRect(pt.x, pt.y, bounds)) return false;

    memeDrag.active = true;
    memeDrag.pointerId = pointerId;
    memeDrag.dx = pt.x - meme.x;
    memeDrag.dy = pt.y - meme.y;
    return true;
  };

  const onMove = (clientX, clientY) => {
    if (!memeDrag.active) return;
    const pt = canvasPointFromClient(clientX, clientY);
    const pad = 18;
    meme.x = clamp(pt.x - memeDrag.dx, pad, OUTPUT_SIZE - pad);
    meme.y = clamp(pt.y - memeDrag.dy, pad, OUTPUT_SIZE - pad);
  };

  const onUp = () => {
    memeDrag.active = false;
    memeDrag.pointerId = null;
  };

  el.addEventListener(
    "pointerdown",
    (e) => {
      const ok = onDown(e.clientX, e.clientY, e.pointerId);
      if (ok) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        e.preventDefault();
      }
    },
    { passive: false },
  );
  el.addEventListener(
    "pointermove",
    (e) => {
      if (!memeDrag.active) return;
      if (memeDrag.pointerId != null && e.pointerId !== memeDrag.pointerId) return;
      onMove(e.clientX, e.clientY);
      e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener(
    "pointerup",
    (e) => {
      if (memeDrag.pointerId != null && e.pointerId !== memeDrag.pointerId) return;
      onUp();
    },
    { passive: true },
  );
  el.addEventListener(
    "pointercancel",
    (e) => {
      if (memeDrag.pointerId != null && e.pointerId !== memeDrag.pointerId) return;
      onUp();
    },
    { passive: true },
  );

  // iOS WeChat fallback:
  el.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      const ok = onDown(t.clientX, t.clientY, null);
      if (ok) e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      if (!memeDrag.active) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      onMove(t.clientX, t.clientY);
      e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener("touchend", onUp, { passive: true });
  el.addEventListener("touchcancel", onUp, { passive: true });
}

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


// First paint
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
if (els.version) els.version.textContent = APP_VERSION;
resetToDefaultView();
renderEffects();
setSheetExpanded(false);
setEffect(selectedEffectId);
bindShutterHold();
bindMemeDrag();
autoRequestPermissionsOnLoad();

// WeChat: ensure option menu is visible (helps long-press/share flows in some builds).
if (isWeChatWebView()) {
  waitWeixinBridgeReady(2000).then((bridge) => {
    try {
      bridge?.call?.("showOptionMenu");
    } catch {
      // ignore
    }
  });
}

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
