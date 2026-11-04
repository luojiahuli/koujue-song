import {
  MusicEngine,
  STYLES,
  renderSongToWav,
  estimateSpeechSeconds,
  computeVoiceTimeline,
} from "./music.js";
import { getSample } from "./samples.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  source: $("#source"),
  charCount: $("#charCount"),
  fileInput: $("#fileInput"),
  clearBtn: $("#clearBtn"),
  styleButtons: Array.from(document.querySelectorAll(".segmented button")),
  generateBtn: $("#generateBtn"),
  btnLabel: $(".primary-btn .btn-label"),
  formHint: $("#formHint"),
  formError: $("#formError"),
  stage: $("#stage"),
  songTitle: $("#songTitle"),
  songSummary: $("#songSummary"),
  songMeta: $("#songMeta"),
  lyrics: $("#lyrics"),
  points: $("#points"),
  playBtn: $("#playBtn"),
  playGlyph: $(".play-glyph"),
  playText: $(".play-text"),
  playState: $("#playState"),
  downloadBtn: $("#downloadBtn"),
  copyBtn: $("#copyBtn"),
  againBtn: $("#againBtn"),
  audioNote: $("#audioNote"),
  wave: $("#waveCanvas"),
  navWorks: $("#navWorks"),
};

const engine = new MusicEngine();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  style: "folk",
  result: null,
  genId: 0,
  ttsState: "idle",
  voiceBuffers: null,
  voiceStarts: null,
  totalSeconds: 0,
  playing: false,
  session: null,
  timers: new Set(),
  speechToken: 0,
  waveRaf: 0,
  themeColor: null,
};

const MAX_CHARS = 8000;
const LOADING_LABELS = ["正在读出要点…", "正在压韵脚…", "正在编排旋律…"];

function setStyle(style) {
  if (!STYLES[style]) return;
  state.style = style;
  els.styleButtons.forEach((btn) => {
    const on = btn.dataset.style === style;
    btn.setAttribute("aria-checked", String(on));
    btn.classList.toggle("is-on", on);
  });
}

function updateCount() {
  const len = els.source.value.length;
  els.charCount.textContent = `${len} / ${MAX_CHARS}`;
}

function showError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

function clearError() {
  els.formError.hidden = true;
  els.formError.textContent = "";
}

function setLoading(loading) {
  els.generateBtn.disabled = loading;
  els.generateBtn.classList.toggle("is-loading", loading);
  els.againBtn.disabled = loading;
  els.btnLabel.textContent = loading ? LOADING_LABELS[0] : "生成口诀歌";
  els.formHint.textContent = loading
    ? "通常 8 到 20 秒，材料越长越慢。"
    : "建议 100 字以上。要点越集中，韵脚越准。";
  if (loading) {
    let step = 0;
    state.loadingTimer = setInterval(() => {
      step = (step + 1) % LOADING_LABELS.length;
      els.btnLabel.textContent = LOADING_LABELS[step];
    }, 5200);
  } else {
    clearInterval(state.loadingTimer);
    state.loadingTimer = null;
    els.btnLabel.textContent = "生成口诀歌";
  }
}

function renderSkeleton() {
  els.stage.hidden = false;
  els.navWorks.hidden = false;
  els.stage.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  els.songTitle.textContent = "正在提炼要点";
  els.songSummary.textContent = "把材料读一遍，找出真正值得记的那几句。";
  els.songMeta.textContent = "Workers AI";
  els.lyrics.innerHTML = Array.from({ length: 8 })
    .map((_, i) => `<li class="lyric-line"><span class="line-no">${String(i + 1).padStart(2, "0")}</span><span class="line-text"><span class="sk sk-line"></span></span></li>`)
    .join("");
  els.points.innerHTML = Array.from({ length: 6 })
    .map((_, i) => `<li><span class="point-no">${i + 1}</span><span class="sk sk-line"></span></li>`)
    .join("");
  els.lyrics.querySelectorAll(".sk-line").forEach((el, i) => {
    el.style.width = `${42 + ((i * 13) % 42)}%`;
  });
  els.points.querySelectorAll(".sk-line").forEach((el, i) => {
    el.style.width = `${64 + ((i * 9) % 30)}%`;
  });
  els.playBtn.disabled = true;
  els.downloadBtn.disabled = true;
  els.copyBtn.disabled = true;
  els.playState.textContent = "";
  els.audioNote.textContent = "正在准备人声…";
}

function renderResult(result) {
  const def = STYLES[result.style] || STYLES.folk;
  els.songTitle.textContent = result.title;
  els.songSummary.textContent = result.summary;
  els.songMeta.textContent = `${def.name} / ${def.bpm} BPM / ${result.verse.length} 句`;
  els.songMeta.dataset.style = result.style;

  els.lyrics.innerHTML = result.verse
    .map((line, i) => {
      const classes = ["lyric-line"];
      if (i % 4 === 0 && i !== 0) classes.push("stanza-start");
      return `<li class="${classes.join(" ")}"><span class="line-no">${String(i + 1).padStart(2, "0")}</span><span class="line-text">${escapeHtml(line)}</span></li>`;
    })
    .join("");
  els.lyricEls = Array.from(els.lyrics.children);

  els.points.innerHTML = result.points
    .map((point, i) => `<li><span class="point-no">${i + 1}</span><span>${escapeHtml(point)}</span></li>`)
    .join("");

  els.playBtn.disabled = true;
  els.downloadBtn.disabled = true;
  els.copyBtn.disabled = false;
  els.playState.textContent = "";
  els.audioNote.textContent = "正在准备人声…";
  els.songTitle.focus({ preventScroll: true });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function generate() {
  const text = els.source.value.trim();
  if (text.length < 20) {
    showError("材料太短了，至少写二十个字，模型才有东西可提炼。");
    els.source.focus();
    return;
  }

  clearError();
  stopPlayback(true);
  state.result = null;
  state.voiceBuffers = null;
  state.ttsState = "idle";
  const genId = ++state.genId;
  setLoading(true);
  renderSkeleton();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, style: state.style }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error((data && data.error) || "生成失败，请稍后再试。");
    }
    const result = normalizeResult(data, state.style);
    if (genId !== state.genId) return;

    state.result = result;
    setLoading(false);
    els.stage.hidden = false;
    els.navWorks.hidden = false;
    renderResult(result);
    sizeCanvas();
    drawIdle();
    els.stage.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    prepareVoices(result, genId);
  } catch (err) {
    if (genId !== state.genId) return;
    setLoading(false);
    els.stage.hidden = true;
    els.navWorks.hidden = true;
    const message =
      err.name === "AbortError"
        ? "等待超时了。材料可以再精简一点，或稍后再试。"
        : err.message || "生成失败，请稍后再试。";
    showError(message);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResult(data, style) {
  const points = Array.isArray(data.points) ? data.points.filter((p) => typeof p === "string" && p.trim()).slice(0, 10) : [];
  const verse = Array.isArray(data.verse) ? data.verse.filter((v) => typeof v === "string" && v.trim()).slice(0, 20) : [];
  if (points.length < 2 || verse.length < 4) {
    throw new Error("模型返回的内容不完整，再试一次就好。");
  }
  return {
    title: (data.title || "未命名口诀").toString().slice(0, 30),
    summary: (data.summary || "按材料要点压缩成的记忆口诀。").toString().slice(0, 80),
    points,
    verse,
    style: data.style && STYLES[data.style] ? data.style : style,
  };
}

async function postTtsLine(text) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("tts failed");
  const data = await res.json();
  if (!data || !data.audio) throw new Error("no audio");
  return base64ToArrayBuffer(data.audio);
}

function base64ToArrayBuffer(base64) {
  const clean = base64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function prepareVoices(result, genId) {
  state.ttsState = "loading";
  els.playBtn.disabled = true;
  els.downloadBtn.disabled = true;

  if (!window.speechSynthesis) {
    state.ttsState = "speech";
    els.audioNote.textContent = "此浏览器不支持语音朗读。仍可播放伴奏并导出音频。";
    els.playBtn.disabled = false;
    els.downloadBtn.disabled = false;
    return;
  }

  let ctx;
  try {
    ctx = engine.ensureContext();
  } catch (_) {
    ctx = null;
  }

  const buffers = new Array(result.verse.length).fill(null);
  let failed = false;
  let done = 0;

  const worker = async (index) => {
    if (failed) return;
    try {
      const buf = await postTtsLine(result.verse[index]);
      if (!ctx) throw new Error("no context");
      const decoded = await ctx.decodeAudioData(buf);
      buffers[index] = decoded;
    } catch (_) {
      failed = true;
    } finally {
      done++;
      if (!failed && genId === state.genId) {
        els.audioNote.textContent = `正在合成人声 ${done} / ${result.verse.length}`;
      }
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, result.verse.length) }, async () => {
    while (cursor < result.verse.length && !failed) {
      const index = cursor++;
      await worker(index);
    }
  });
  await Promise.all(workers);

  if (genId !== state.genId) return;

  if (failed || buffers.some((b) => !b)) {
    state.ttsState = "speech";
    state.voiceBuffers = null;
    els.audioNote.textContent = "AI 配音暂不可用，将使用系统朗读。下载的音频只含伴奏。";
    els.playBtn.disabled = false;
    els.downloadBtn.disabled = false;
    els.playState.textContent = "系统语音";
    return;
  }

  const def = STYLES[result.style] || STYLES.folk;
  const timeline = computeVoiceTimeline(buffers, def.bpm);
  state.ttsState = "ai";
  state.voiceBuffers = buffers;
  state.voiceStarts = timeline.starts;
  state.totalSeconds = timeline.totalSeconds;
  els.audioNote.textContent = "AI 人声已就绪。导出音频包含人声与伴奏。";
  els.playBtn.disabled = false;
  els.downloadBtn.disabled = false;
  els.playState.textContent = "AI 人声";
}

function highlight(index) {
  if (!els.lyricEls) return;
  els.lyricEls.forEach((el, i) => {
    el.classList.toggle("is-current", i === index);
    el.classList.toggle("is-past", i < index);
  });
}

function clearHighlight() {
  if (!els.lyricEls) return;
  els.lyricEls.forEach((el) => el.classList.remove("is-current", "is-past"));
}

function addTimer(fn, ms) {
  const id = setTimeout(() => {
    state.timers.delete(id);
    fn();
  }, ms);
  state.timers.add(id);
  return id;
}

function setPlayingUI(on) {
  state.playing = on;
  els.playBtn.classList.toggle("is-playing", on);
  els.playGlyph.textContent = on ? "■" : "▶";
  els.playText.textContent = on ? "停止" : "播放";
  els.playBtn.setAttribute("aria-label", on ? "停止播放" : "播放口诀歌");
  if (on) startWave();
  else stopWave();
}

function startPlayback() {
  const result = state.result;
  if (!result) return;
  sizeCanvas();
  const def = STYLES[result.style] || STYLES.folk;

  if (state.ttsState === "ai" && state.voiceBuffers && state.voiceBuffers.every(Boolean)) {
    const session = engine.startBed(result.style, state.totalSeconds);
    engine.scheduleVoices(session, state.voiceBuffers, state.voiceStarts);
    state.session = session;
    setPlayingUI(true);
    const ctx = session.ctx;
    state.voiceStarts.forEach((start, i) => {
      const delay = Math.max(0, (session.bedStart - ctx.currentTime + start) * 1000);
      addTimer(() => highlight(i), delay);
    });
    addTimer(() => finishPlayback(), state.totalSeconds * 1000);
    updateProgress(session, state.totalSeconds);
  } else {
    const estimated = estimateSpeechSeconds(result.verse, def.bpm) * 1.5 + 6;
    const session = engine.startBed(result.style, estimated);
    state.session = session;
    setPlayingUI(true);
    updateProgress(session, estimated);
    addTimer(() => speakVerses(result.verse), 900);
  }
}

function updateProgress(session, total) {
  const tick = () => {
    if (!state.playing || state.session !== session) return;
    const elapsed = Math.max(0, session.ctx.currentTime - session.bedStart);
    els.playState.textContent = `${fmtTime(Math.min(elapsed, total))} / ${fmtTime(total)}`;
    const id = setTimeout(tick, 500);
    state.timers.add(id);
  };
  tick();
}

function fmtTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function speakVerses(verse) {
  if (!window.speechSynthesis) {
    els.playState.textContent = "仅伴奏";
    return;
  }
  const token = ++state.speechToken;
  const synth = window.speechSynthesis;
  const voice = pickChineseVoice();
  let index = 0;

  const next = () => {
    if (!state.playing || token !== state.speechToken) return;
    if (index >= verse.length) {
      finishPlayback();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(verse[index]);
    utterance.lang = "zh-CN";
    utterance.rate = 0.94;
    utterance.pitch = 1.03;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => highlight(index);
    utterance.onend = () => {
      index++;
      addTimer(next, 280);
    };
    utterance.onerror = () => {
      index++;
      addTimer(next, 80);
    };
    synth.speak(utterance);
  };
  next();
}

function pickChineseVoice() {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const chinese = voices.filter((v) => /zh(-|_)?CN|cmn|Chinese|中文/i.test(`${v.lang} ${v.name}`));
  return chinese.find((v) => /Ting|Mei|Xiaoxiao|Yaoyao|Google/i.test(v.name)) || chinese[0] || null;
}

function finishPlayback() {
  stopPlayback(false);
  els.playState.textContent = "结束";
}

function stopPlayback(silent = false) {
  const wasPlaying = state.playing;
  state.playing = false;
  state.speechToken++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.session) engine.stopSession(state.session);
  state.session = null;
  state.timers.forEach((id) => clearTimeout(id));
  state.timers.clear();
  clearHighlight();
  setPlayingUI(false);
  if (!silent && wasPlaying) els.playState.textContent = "已停止";
}

function togglePlay() {
  if (state.playing) stopPlayback();
  else startPlayback();
}

async function downloadAudio() {
  const result = state.result;
  if (!result) return;
  const def = STYLES[result.style] || STYLES.folk;
  const withVoice = state.ttsState === "ai" && state.voiceBuffers && state.voiceBuffers.every(Boolean);
  const label = els.downloadBtn.textContent;
  els.downloadBtn.disabled = true;
  els.downloadBtn.textContent = "正在导出…";

  try {
    const blob = await renderSongToWav({
      style: result.style,
      totalSeconds: withVoice ? state.totalSeconds : estimateSpeechSeconds(result.verse, def.bpm),
      voiceBuffers: withVoice ? state.voiceBuffers : [],
      voiceStarts: withVoice ? state.voiceStarts : [],
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = result.title.replace(/[\\/:*?"<>|]/g, "").trim() || "口诀歌";
    a.href = url;
    a.download = `${safeTitle}-口诀歌${withVoice ? "" : "-伴奏"}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (_) {
    els.audioNote.textContent = "导出失败了，可以换个浏览器再试。";
  } finally {
    els.downloadBtn.disabled = false;
    els.downloadBtn.textContent = label;
  }
}

async function copyLyrics() {
  if (!state.result) return;
  const text = `《${state.result.title}》\n\n${state.result.verse.join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.textContent = "已复制";
    addTimer(() => {
      els.copyBtn.textContent = "复制歌词";
    }, 1600);
  } catch (_) {
    els.audioNote.textContent = "复制失败，请手动选中歌词。";
  }
}

function getAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e2522d";
}

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = els.wave.getBoundingClientRect();
  els.wave.width = Math.max(1, Math.round(rect.width * dpr));
  els.wave.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = els.wave.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawIdle() {
  const ctx = els.wave.getContext("2d");
  const w = els.wave.width / (Math.min(2, window.devicePixelRatio || 1));
  const h = els.wave.height / (Math.min(2, window.devicePixelRatio || 1));
  ctx.clearRect(0, 0, w, h);
  const bars = Math.max(28, Math.floor(w / 9));
  const gap = w / bars;
  ctx.fillStyle = getAccent();
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < bars; i++) {
    const amp = 0.18 + 0.16 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19));
    const barH = Math.max(2, amp * h * 0.9);
    ctx.fillRect(i * gap + gap * 0.2, (h - barH) / 2, Math.max(2, gap * 0.5), barH);
  }
  ctx.globalAlpha = 1;
}

function drawLive() {
  if (!state.session) return;
  const analyser = state.session.analyser;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const ctx = els.wave.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = els.wave.width / dpr;
  const h = els.wave.height / dpr;
  const bars = Math.max(28, Math.floor(w / 9));
  const gap = w / bars;
  const accent = getAccent();

  const loop = () => {
    if (!state.playing || !state.session) return;
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = accent;
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor((i / bars) * data.length * 0.72);
      const value = data[idx] / 255;
      const barH = Math.max(2, (0.1 + value * 0.9) * h * 0.92);
      ctx.globalAlpha = 0.35 + value * 0.65;
      ctx.fillRect(i * gap + gap * 0.2, (h - barH) / 2, Math.max(2, gap * 0.5), barH);
    }
    ctx.globalAlpha = 1;
    state.waveRaf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(state.waveRaf);
  loop();
}

function startWave() {
  if (reduceMotion.matches) {
    drawIdle();
    return;
  }
  drawLive();
}

function stopWave() {
  cancelAnimationFrame(state.waveRaf);
  state.waveRaf = 0;
  drawIdle();
}

function loadSample(key) {
  const sample = getSample(key);
  if (!sample) return;
  els.source.value = sample.text.slice(0, MAX_CHARS);
  updateCount();
  clearError();
  els.source.focus({ preventScroll: false });
  els.source.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
}

function bindEvents() {
  els.source.addEventListener("input", () => {
    updateCount();
    clearError();
  });
  els.source.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  els.clearBtn.addEventListener("click", () => {
    els.source.value = "";
    updateCount();
    clearError();
    els.source.focus();
  });

  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showError("文件太大了，请控制在 2MB 以内。");
      return;
    }
    try {
      const text = await file.text();
      els.source.value = text.slice(0, MAX_CHARS);
      updateCount();
      clearError();
      if (text.length > MAX_CHARS) {
        showError(`文件超过 ${MAX_CHARS} 字，已截取前面部分。`);
      }
    } catch (_) {
      showError("读取文件失败，试试直接粘贴文本。");
    } finally {
      els.fileInput.value = "";
    }
  });

  els.styleButtons.forEach((btn) => {
    btn.addEventListener("click", () => setStyle(btn.dataset.style));
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const current = els.styleButtons.indexOf(btn);
      const next = (current + (e.key === "ArrowRight" ? 1 : els.styleButtons.length - 1)) % els.styleButtons.length;
      els.styleButtons[next].focus();
      setStyle(els.styleButtons[next].dataset.style);
    });
  });

  document.querySelectorAll("[data-sample]").forEach((btn) => {
    btn.addEventListener("click", () => loadSample(btn.dataset.sample));
  });

  els.generateBtn.addEventListener("click", generate);
  els.playBtn.addEventListener("click", togglePlay);
  els.downloadBtn.addEventListener("click", downloadAudio);
  els.copyBtn.addEventListener("click", copyLyrics);
  els.againBtn.addEventListener("click", () => {
    stopPlayback(true);
    generate();
  });
  els.navWorks.addEventListener("click", (e) => {
    if (els.stage.hidden) {
      e.preventDefault();
      els.source.focus();
    }
  });

  window.addEventListener("resize", () => {
    sizeCanvas();
    if (!state.playing) drawIdle();
  });

  reduceMotion.addEventListener("change", () => {
    if (!state.playing) drawIdle();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) stopPlayback();
  });
}

function init() {
  updateCount();
  els.navWorks.hidden = true;
  els.stage.hidden = true;
  sizeCanvas();
  drawIdle();
  bindEvents();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
  }
}

init();
