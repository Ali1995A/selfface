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
  btnAdd: document.getElementById("btnAdd"),

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

let stickerImg = null;
let stickerReady = false;
let stickers = [];
let stickerIndex = 0;

let captionText = "";
let captionSource = "none"; // "webspeech" | "whisper" | "none"
let webSpeech = null;
let whisperTranscriber = null;
let whisperReady = false;
let subtitleMode = "realtime"; // "realtime" | "stable"

const effects = [
  { id: "none", name: "无特效", from: "WeChat Effect", sticker: null, thumb: "none" },
  { id: "glasses", name: "谢谢老板", from: "WeChat Effect", sticker: "./assets/stickers/glasses.png" },
  { id: "mustache", name: "新年好", from: "MurphyM", sticker: "./assets/stickers/mustache.png" },
  { id: "crown", name: "恭喜发财", from: "MurphyM", sticker: "./assets/stickers/crown.png" },
  { id: "more", name: "更多特效", from: "", sticker: null, thumb: "more" },
];
let selectedEffectId = "glasses";

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

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preloadStickers() {
  const sources = [
    "./assets/stickers/glasses.png",
    "./assets/stickers/mustache.png",
    "./assets/stickers/crown.png",
  ];
  const res = await Promise.allSettled(sources.map((s) => preloadImage(s)));
  stickers = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
  stickerIndex = 0;
  stickerImg = stickers[stickerIndex] || null;
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

  return await navigator.mediaDevices.getUserMedia(constraints);
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

function drawSticker(context) {
  if (!stickerReady || !stickerImg) return;
  if (!faceState || !faceState.detected || faceState.detected < 0.6) return;

  const { x, y, s, rz } = faceToCanvasTransform(faceState);
  const w = clamp(s * 1.9, 70, 260);
  const h = (w / stickerImg.width) * stickerImg.height;

  context.save();
  context.translate(x, y - s * 0.08);
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
  drawSubtitle(ctx, captionText);

  ctx.restore();

  rafId = requestAnimationFrame(drawFrame);
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
  return !!(micStream && micStream.getAudioTracks().length > 0 && "MediaRecorder" in window);
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

async function startPreview() {
  hideResult();
  if (isPreviewing) stopPreview();
  setProgress("");
  setStatus("点击快门开始：将请求摄像头/麦克风权限");

  try {
    await preloadStickers();
  } catch {
    // Stickers missing shouldn't block preview.
  }

  try {
    setStatus("请求摄像头/麦克风权限中…");
    mediaStream = await requestMedia(currentFacingMode);
  } catch (err) {
    setStatus(`权限被拒绝或设备不可用：${err?.message || err}`, "error");
    return;
  }

  // Split mic-only stream for record/transcribe.
  micStream = new MediaStream(mediaStream.getAudioTracks());

  try {
    await attachStreamToVideo(mediaStream);
    await waitForVideoReady(els.video);
  } catch (err) {
    setStatus(`摄像头启动失败：${err?.message || err}`, "error");
    stopPreview();
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
}

function setEffect(effectId) {
  selectedEffectId = effectId;
  const eff = effects.find((e) => e.id === effectId) || effects[0];
  els.effectFromName.textContent = eff.from || "WeChat Effect";

  // Sticker mapping:
  if (!eff.sticker) {
    stickerImg = null;
  } else if (stickers.length) {
    const idx = ["glasses", "mustache", "crown"].indexOf(eff.id);
    if (idx >= 0 && stickers[idx]) stickerImg = stickers[idx];
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

els.btnShutter.addEventListener("click", async () => {
  if (isRecording) return;
  if (!isPreviewing) {
    await startPreview();
    return;
  }
  await recordGif3s();
});

els.btnSwitchCam.addEventListener("click", async () => {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  if (isPreviewing) {
    await startPreview();
  } else {
    setStatus("切换摄像头后，点击快门开始预览");
  }
});

els.btnRetake.addEventListener("click", () => {
  hideResult();
  setStatus("重拍：点击快门录制");
});

els.btnAdd.addEventListener("click", () => {
  downloadGif();
});

els.btnSubRealtime.addEventListener("click", () => setSubtitleMode("realtime"));
els.btnSubStable.addEventListener("click", () => setSubtitleMode("stable"));

// First paint
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
setStatus("点击快门开始预览");
setProgress("");
renderEffects();
setSubtitleMode("realtime");
setSheetExpanded(false);
setEffect(selectedEffectId);

window.addEventListener("pagehide", () => stopPreview());
