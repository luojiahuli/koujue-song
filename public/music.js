const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// 每句的音高轮廓（音阶级数），四句一循环，避免每句唱得一样
const CONTOURS = [
  [0, 1, 2, 1, 3, 2, 1],
  [2, 1, 0, 1, 2, 3, 2],
  [0, 2, 1, 3, 2, 1, 0],
  [1, 2, 3, 2, 1, 0, 1],
];

export const STYLES = {
  folk: {
    name: "轻快民谣",
    bpm: 104,
    chords: [
      [60, 64, 67],
      [55, 59, 62],
      [57, 60, 64],
      [53, 57, 60],
    ],
    arp: "eighth",
    arpGain: 0.045,
    padGain: 0.032,
    bassGain: 0.2,
    bassHits: [0, 2.5],
    kick: [0, 2],
    snare: [1, 3],
    hat: "eighth",
    swing: 0,
    scale: [0, 2, 4, 7, 9],
    rhythm: [0, 0.5, 1, 1.5, 2, 2.5, 3],
  },
  ballad: {
    name: "抒情钢琴",
    bpm: 76,
    chords: [
      [60, 64, 67, 71],
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 65],
    ],
    arp: "quarter",
    arpGain: 0.04,
    padGain: 0.04,
    bassGain: 0.17,
    bassHits: [0, 2],
    kick: [0, 2],
    snare: [1, 3],
    hat: "quarter",
    swing: 0,
    scale: [0, 2, 4, 5, 7, 9, 11],
    rhythm: [0, 0.6, 1.2, 1.8, 2.4, 3, 3.5],
  },
  hiphop: {
    name: "说唱节拍",
    bpm: 88,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ],
    arp: "offbeat",
    arpGain: 0.035,
    padGain: 0.024,
    bassGain: 0.23,
    bassHits: [0, 1.75, 2.5],
    kick: [0, 2.5],
    snare: [1, 3],
    hat: "eighth",
    swing: 0.11,
    scale: [0, 2, 3, 5, 7, 10],
    rhythm: [0, 0.5, 1, 1.25, 1.75, 2, 2.5],
  },
  nursery: {
    name: "童谣",
    bpm: 120,
    chords: [
      [60, 64, 67],
      [53, 57, 60],
      [55, 59, 62],
      [60, 64, 67],
    ],
    arp: "eighth",
    arpGain: 0.05,
    padGain: 0.03,
    bassGain: 0.19,
    bassHits: [0, 2],
    kick: [0, 2],
    snare: [1, 3],
    hat: "eighth",
    swing: 0,
    scale: [0, 2, 4, 7, 9],
    rhythm: [0, 0.5, 1, 2, 2.5, 3, 3.5],
  },
};

function makeNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 1.2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function connectNoise(ctx, noise, t, dest, type, freq, gain, decay) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filter).connect(g).connect(dest);
  src.start(t);
  src.stop(t + decay + 0.02);
}

function scheduleDrums(ctx, dest, noise, time, beat, def) {
  def.kick.forEach((hit) => {
    const t = time + hit * beat;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(148, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  });

  def.snare.forEach((hit) => {
    const t = time + hit * beat;
    connectNoise(ctx, noise, t, dest, "highpass", 1500, 0.13, 0.16);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(196, t);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    body.connect(bg).connect(dest);
    body.start(t);
    body.stop(t + 0.12);
  });

  const hatStep = def.hat === "quarter" ? 1 : 0.5;
  for (let i = 0; i < 4 / hatStep; i++) {
    const swing = i % 2 === 1 ? def.swing : 0;
    const t = time + (i * hatStep + swing) * beat;
    connectNoise(ctx, noise, t, dest, "highpass", 8200, 0.026, 0.045);
  }
}

function scheduleBar(ctx, master, delaySend, noise, time, barIndex, def) {
  const beat = 60 / def.bpm;
  const barDur = beat * 4;
  const chord = def.chords[barIndex % def.chords.length];

  const padGain = ctx.createGain();
  padGain.gain.setValueAtTime(0.0001, time);
  padGain.gain.linearRampToValueAtTime(def.padGain, time + 0.4);
  padGain.gain.setValueAtTime(def.padGain, time + barDur - 0.45);
  padGain.gain.exponentialRampToValueAtTime(0.0001, time + barDur);
  padGain.connect(master);

  chord.forEach((note, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiToHz(note);
    osc.detune.value = (i - 1) * 5;
    osc.connect(padGain);
    osc.start(time);
    osc.stop(time + barDur + 0.05);
  });

  def.bassHits.forEach((hit) => {
    const t = time + hit * beat;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(midiToHz(chord[0] - 12), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(def.bassGain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 1.3);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + beat * 1.35);
  });

  const steps = def.arp === "quarter" ? 4 : 8;
  for (let i = 0; i < steps; i++) {
    if (def.arp === "offbeat" && i % 2 === 0) continue;
    const t = time + (i * 4) / steps * beat;
    const note = chord[i % chord.length] + 12;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(def.arpGain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g);
    g.connect(master);
    if (delaySend) g.connect(delaySend);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  scheduleDrums(ctx, master, noise, time, beat, def);
}

function countSyllables(text) {
  const clean = String(text || "").replace(/[\s，。、！？；：,.!?;:"'“”‘’（）()《》【】…—·]/g, "");
  return Math.max(1, Math.min(24, Array.from(clean).length));
}

function noteSlots(count, def) {
  if (count === def.rhythm.length) return def.rhythm.slice();
  if (count <= 1) return [0];
  const last = def.rhythm[def.rhythm.length - 1];
  return Array.from({ length: count }, (_, i) => (i * last) / (count - 1));
}

function lineNotes(count, lineIndex, def) {
  const contour = CONTOURS[lineIndex % CONTOURS.length];
  const semis = Array.from({ length: count }, (_, j) =>
    def.scale[contour[j % contour.length] % def.scale.length]
  );
  const mean = semis.reduce((a, b) => a + b, 0) / semis.length;
  return semis.map((s) => s - mean);
}

function medianF0(buffer, from, to) {
  const data = buffer.getChannelData(0);
  const step = 4;
  const n = Math.max(0, Math.floor((to - from) / step));
  if (!n) return 0;
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = from + i * step;
    ds[i] = (data[o] + data[o + 1] + data[o + 2] + data[o + 3]) * 0.25;
  }
  const sr = buffer.sampleRate / step;
  const win = Math.max(128, Math.floor(sr * 0.04));
  const minLag = Math.max(8, Math.floor(sr / 450));
  const maxLag = Math.min(win - 1, Math.floor(sr / 75));
  const found = [];
  for (let start = 0; start + win + maxLag <= n; start += win) {
    let energy = 0;
    for (let i = 0; i < win; i += 2) energy += ds[start + i] * ds[start + i];
    if (energy / (win / 2) < 0.0004) continue;
    let bestLag = 0;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      let a2 = 0;
      let b2 = 0;
      for (let i = 0; i < win; i += 2) {
        const a = ds[start + i];
        const b = ds[start + i + lag];
        corr += a * b;
        a2 += a * a;
        b2 += b * b;
      }
      const norm = corr / Math.sqrt(a2 * b2 + 1e-12);
      if (norm > best) {
        best = norm;
        bestLag = lag;
      }
    }
    if (bestLag && best > 0.45) found.push(sr / bestLag);
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

function voicedRange(buffer) {
  const data = buffer.getChannelData(0);
  const threshold = 0.003;
  let start = 0;
  let end = data.length;
  while (start < end && Math.abs(data[start]) < threshold) start++;
  while (end > start + 1 && Math.abs(data[end - 1]) < threshold) end--;
  if (end <= start) return [0, data.length];
  const pad = Math.floor(buffer.sampleRate * 0.01);
  return [Math.max(0, start - pad), Math.min(data.length, end + pad)];
}

// 把整句 TTS 切片，按旋律给每个字换音高，再串联成演唱
function scheduleSungLine(ctx, dest, buffer, when, lineIndex, text, def, track, send) {
  if (!buffer) return;
  const count = countSyllables(text);
  const slots = noteSlots(count, def);
  const notes = lineNotes(count, lineIndex, def);
  const beat = 60 / def.bpm;
  const lineDur = beat * 4;

  const bus = ctx.createGain();
  bus.gain.value = 1.9;
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.016;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.1;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.0009;
  lfo.connect(lfoDepth).connect(delay.delayTime);
  bus.connect(delay).connect(dest);
  if (send) {
    const wet = ctx.createGain();
    wet.gain.value = 0.12;
    bus.connect(wet).connect(send);
  }
  lfo.start(when);
  lfo.stop(when + lineDur + 1.2);
  if (track) {
    track.add(lfo);
    lfo.onended = () => track.delete(lfo);
  }

  const [lo, hi] = voicedRange(buffer);
  const sliceLen = Math.max(1, hi - lo) / count;
  const refHz = medianF0(buffer, lo, hi);
  for (let j = 0; j < count; j++) {
    const t = when + slots[j] * beat;
    const from = lo + j * sliceLen;
    const srcHz = medianF0(buffer, from, from + sliceLen);
    let ratio = Math.pow(2, notes[j] / 12);
    if (refHz && srcHz) {
      let f = srcHz;
      if (f > refHz * 1.7) f /= 2;
      else if (f < refHz * 0.6) f *= 2;
      ratio = (refHz * Math.pow(2, notes[j] / 12)) / f;
    }
    ratio = Math.min(1.45, Math.max(0.7, ratio));
    const nextSlot = j + 1 < count ? slots[j + 1] : 4;
    const noteDur = Math.max(0.12, (nextSlot - slots[j]) * beat + 0.04);
    const offset = from / buffer.sampleRate;
    const sourceDur = Math.min(sliceLen / buffer.sampleRate, noteDur * ratio);
    const outDur = sourceDur / ratio;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = ratio;
    const g = ctx.createGain();
    const attack = Math.min(0.014, outDur * 0.3);
    const release = Math.min(0.045, outDur * 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + attack);
    g.gain.setValueAtTime(1, t + Math.max(attack, outDur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + outDur);
    src.connect(g).connect(bus);
    src.start(t, offset, sourceDur);
    src.stop(t + outDur + 0.02);
    if (track) {
      track.add(src);
      src.onended = () => track.delete(src);
    }
  }
}

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.session = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  buildGraph() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;

    const delay = ctx.createDelay(0.6);
    delay.delayTime.value = 0.3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(master);

    const noise = makeNoiseBuffer(ctx);

    return { ctx, master, comp, analyser, delay, wet, noise };
  }

  startBed(style, totalSeconds) {
    const ctx = this.ensureContext();
    this.stop(true);
    const def = STYLES[style] || STYLES.folk;
    const graph = this.buildGraph();
    graph.master.connect(graph.comp).connect(graph.analyser);
    graph.analyser.connect(ctx.destination);

    const barDur = (60 / def.bpm) * 4;
    const bedStart = ctx.currentTime + 0.14;
    const totalBars = Math.max(4, Math.ceil(totalSeconds / barDur));

    const session = {
      ctx,
      graph,
      def,
      barDur,
      bedStart,
      nodes: new Set(),
      timers: new Set(),
      stopped: false,
      onEnd: null,
      analyser: graph.analyser,
    };

    let bar = 0;
    const lookahead = () => {
      if (session.stopped) return;
      const horizon = ctx.currentTime + 0.4;
      while (bar < totalBars && bedStart + bar * barDur < horizon) {
        scheduleBar(ctx, graph.master, graph.delay, graph.noise, bedStart + bar * barDur, bar, def);
        bar++;
      }
      if (bar >= totalBars) clearInterval(session.timer);
    };
    lookahead();
    session.timer = setInterval(lookahead, 90);

    session.duration = totalSeconds;
    session.stop = () => this.stopSession(session);
    this.session = session;
    return session;
  }

  scheduleVoices(session, buffers, starts, verse = [], style) {
    const { ctx, graph, def } = session;
    const tone = STYLES[style] || def;
    buffers.forEach((buffer, i) => {
      if (!buffer) return;
      const when = session.bedStart + Math.max(0, starts[i] || 0);
      scheduleSungLine(ctx, graph.master, buffer, Math.max(ctx.currentTime, when), i, verse[i], tone, session.nodes, graph.delay);
    });
  }

  stopSession(session) {
    if (!session || session.stopped) return;
    session.stopped = true;
    clearInterval(session.timer);
    session.timers.forEach((t) => clearTimeout(t));
    session.timers.clear();
    const { ctx, graph } = session;
    try {
      graph.master.gain.cancelScheduledValues(ctx.currentTime);
      graph.master.gain.setValueAtTime(graph.master.gain.value, ctx.currentTime);
      graph.master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    } catch (_) {}
    session.nodes.forEach((node) => {
      try { node.stop(); } catch (_) {}
    });
    session.nodes.clear();
    setTimeout(() => {
      try { graph.analyser.disconnect(); } catch (_) {}
      try { graph.master.disconnect(); } catch (_) {}
      try { graph.comp.disconnect(); } catch (_) {}
    }, 160);
    if (this.session === session) this.session = null;
  }

  stop() {
    if (this.session) this.stopSession(this.session);
  }
}

export async function renderSongToWav({ style, totalSeconds, voiceBuffers = [], voiceStarts = [], verse = [] }) {
  const def = STYLES[style] || STYLES.folk;
  const sampleRate = 44100;
  const duration = Math.max(4, totalSeconds);
  const frames = Math.ceil(duration * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.72;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 18;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  master.connect(comp).connect(ctx.destination);

  const delay = ctx.createDelay(0.6);
  delay.delayTime.value = 0.3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.22;
  const wet = ctx.createGain();
  wet.gain.value = 0.16;
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(master);

  const noise = makeNoiseBuffer(ctx);
  const barDur = (60 / def.bpm) * 4;
  const totalBars = Math.ceil(duration / barDur) + 1;
  for (let bar = 0; bar < totalBars; bar++) {
    scheduleBar(ctx, master, delay, noise, bar * barDur, bar, def);
  }

  voiceBuffers.forEach((buffer, i) => {
    if (!buffer) return;
    scheduleSungLine(ctx, master, buffer, Math.max(0, voiceStarts[i] || 0), i, verse[i], def, null, delay);
  });

  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

function audioBufferToWav(buffer) {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const bufferSize = 44 + dataSize;
  const wav = new ArrayBuffer(bufferSize);
  const view = new DataView(wav);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wav], { type: "audio/wav" });
}

export function estimateSpeechSeconds(verse, bpm) {
  const barDur = (60 / bpm) * 4;
  let total = barDur * 2;
  verse.forEach((line) => {
    total += Math.max(barDur * 2, line.length * 0.3 + 1);
  });
  return total + barDur * 2;
}

export function computeVoiceTimeline(buffers, style) {
  const def = STYLES[style] || STYLES.folk;
  const barDur = (60 / def.bpm) * 4;
  let cursor = barDur * 2;
  const starts = [];
  buffers.forEach(() => {
    starts.push(cursor);
    cursor += barDur;
  });
  return { starts, totalSeconds: cursor + barDur * 2 };
}
