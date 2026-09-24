// Synthesized sound effects, plus a few recorded samples.
// Everything runs through one bus: a little reverb for space, then a
// compressor so layered hits sound punchy instead of clipping.
let ctx = null;
let bus = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = Boolean(on); }

function audio() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      buildBus(ctx);
      decodeSamples(ctx);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

// Browsers (iOS Safari especially) only let audio start inside a tap or key press.
// Online, most sounds are triggered by server messages with no tap behind them, so an
// AudioContext first created then stays muted. Wake it on any tap instead, and play a
// silent sample in that tap, which iOS needs to fully unlock output.
function unlockAudio() {
  const a = audio();
  if (!a || a.state === "running") return;
  a.resume().catch(() => {});
  try {
    const src = a.createBufferSource();
    src.buffer = a.createBuffer(1, 1, 22050);
    src.connect(a.destination);
    src.start(0);
  } catch { /* nothing to unlock */ }
}

if (typeof window !== "undefined") {
  for (const type of ["pointerdown", "touchend", "mousedown", "keydown", "click"]) window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  // iOS suspends audio when the app is backgrounded; pick it back up on return (or on the next tap).
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx && ctx.state !== "running") ctx.resume().catch(() => {}); });
}

function buildBus(a) {
  const input = a.createGain();
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  const master = a.createGain();
  master.gain.value = 0.9;
  // Short generated room reverb.
  const reverb = a.createConvolver();
  const len = Math.floor(a.sampleRate * 1.1);
  const impulse = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  reverb.buffer = impulse;
  const wet = a.createGain();
  wet.gain.value = 0.22;
  input.connect(comp);
  input.connect(reverb).connect(wet).connect(comp);
  comp.connect(master).connect(a.destination);
  bus = { input, dry: input };
}

const out = () => bus.input;

// Recorded samples: fetched up front, decoded once the AudioContext exists.
// Until a sample is ready (or if it fails to load) the synth fallback plays.
const SAMPLE_URLS = { barkFart: new URL("./sounds/bark-fart.mp3", import.meta.url).href };
const sampleBytes = {};
const samples = {};
for (const [name, url] of Object.entries(SAMPLE_URLS)) {
  sampleBytes[name] = fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
}

function decodeSamples(a) {
  for (const [name, bytes] of Object.entries(sampleBytes)) {
    bytes.then(buf => (buf ? a.decodeAudioData(buf) : null))
      .then(decoded => { if (decoded) samples[name] = decoded; })
      .catch(() => {});
  }
}

function playSample(name, fallback, gain = 0.9) {
  const a = audio();
  if (!a) return;
  const buffer = samples[name];
  if (!buffer) { fallback(); return; }
  const src = a.createBufferSource();
  src.buffer = buffer;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out());
  src.start();
}

function env(g, t, { attack = 0.005, peak = 0.2, hold = 0, dur = 0.2 }) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  if (hold) g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
}

function tone(freq, { at = 0, dur = 0.15, type = "sine", gain = 0.12, slide = 0, attack = 0.006, hold = 0, detune = 0, filter = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + attack + hold + dur);
  env(g, t, { attack, peak: gain, hold, dur });
  let node = osc;
  if (filter) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    node = osc.connect(f);
  }
  node.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + attack + hold + dur + 0.05);
}

let noiseBuffer = null;
function noise({ at = 0, dur = 0.15, gain = 0.1, freq = 1200, q = 1, type = "bandpass", sweep = 0, attack = 0.003 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  if (!noiseBuffer) {
    noiseBuffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
  const g = a.createGain();
  env(g, t, { attack, peak: gain, dur });
  src.connect(f).connect(g).connect(out());
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

// Deep kick: the body of every impact.
function kick(at = 0, { from = 160, to = 42, gain = 0.5, dur = 0.28 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  env(g, t, { attack: 0.002, peak: gain, dur });
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function chord(freqs, opts = {}) { freqs.forEach((f, i) => tone(f, { ...opts, at: (opts.at || 0) + (opts.stagger || 0) * i })); }

// Meme: the "vine boom". Low sine with a pitch drop, pushed through soft distortion.
function vineBoom(at = 0, gain = 0.55) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const osc2 = a.createOscillator();
  const shaper = a.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 3); }
  shaper.curve = curve;
  const g = a.createGain();
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(190, t);
  osc2.frequency.exponentialRampToValueAtTime(96, t + 0.5);
  env(g, t, { attack: 0.004, peak: gain, hold: 0.05, dur: 1.3 });
  osc.connect(shaper);
  osc2.connect(shaper);
  shaper.connect(g).connect(out());
  osc.start(t); osc2.start(t);
  osc.stop(t + 1.5); osc2.stop(t + 1.5);
  noise({ at, dur: 0.15, gain: 0.18, freq: 200, type: "lowpass" });
}

// Meme: MLG air horn, a detuned sawtooth stack in short blasts.
function airHorn(at = 0, blasts = 3) {
  for (let b = 0; b < blasts; b++) {
    const start = at + b * (b === blasts - 1 ? 0.2 : 0.17);
    const long = b === blasts - 1 ? 0.45 : 0.1;
    [415, 523, 622].forEach((f, i) => {
      tone(f, { at: start, type: "sawtooth", gain: 0.07, attack: 0.01, hold: long, dur: 0.12, detune: i * 7 - 7, filter: 2600 });
      tone(f * 1.005, { at: start, type: "sawtooth", gain: 0.05, attack: 0.01, hold: long, dur: 0.12, detune: 12, filter: 2600 });
    });
  }
}

// Meme: sad trombone "wah wah wah waaah".
function sadTrombone(at = 0) {
  const a = audio();
  if (!a) return;
  const notes = [[311, 0.32], [293, 0.32], [277, 0.32], [262, 1.0]];
  let t0 = at;
  for (const [f, d] of notes) {
    const t = a.currentTime + t0;
    const osc = a.createOscillator();
    const vib = a.createOscillator();
    const vibAmt = a.createGain();
    const filt = a.createBiquadFilter();
    const g = a.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f * 1.03, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    vib.frequency.value = d > 0.5 ? 6 : 0;
    vibAmt.gain.value = f * 0.02;
    vib.connect(vibAmt).connect(osc.frequency);
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(600, t);
    filt.frequency.linearRampToValueAtTime(1400, t + 0.1);
    filt.frequency.linearRampToValueAtTime(700, t + d);
    env(g, t, { attack: 0.04, peak: 0.16, hold: d * 0.6, dur: d * 0.4 });
    osc.connect(filt).connect(g).connect(out());
    osc.start(t); vib.start(t);
    osc.stop(t + d + 0.1); vib.stop(t + d + 0.1);
    t0 += d;
  }
}

// A dog "ruff": voiced sawtooth through two formant filters, pitch pops up then drops.
function bark(at = 0, pitch = 440) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const dur = 0.16;
  const osc = a.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(pitch * 0.8, t);
  osc.frequency.linearRampToValueAtTime(pitch * 1.25, t + 0.03);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + dur);
  const g = a.createGain();
  env(g, t, { attack: 0.008, peak: 0.5, dur });
  for (const [freq, q, amt] of [[900, 5, 0.6], [2100, 7, 0.35]]) {
    const f = a.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.linearRampToValueAtTime(freq * 0.7, t + dur);
    f.Q.value = q;
    const fg = a.createGain();
    fg.gain.value = amt;
    osc.connect(f).connect(fg).connect(g);
  }
  g.connect(out());
  osc.start(t);
  osc.stop(t + dur + 0.05);
  noise({ at, dur: 0.06, gain: 0.12, freq: 1800, q: 1.5 });
}

// A wet, flappy fart: low sawtooth + noise, both "flapped" by a wobbling square LFO.
function fart(at = 0, dur = 0.8) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(88, t);
  osc.frequency.linearRampToValueAtTime(118, t + dur * 0.2);
  osc.frequency.exponentialRampToValueAtTime(52, t + dur);
  const flap = a.createOscillator();
  flap.type = "square";
  flap.frequency.setValueAtTime(28, t);
  flap.frequency.linearRampToValueAtTime(12, t + dur);
  const pitchWobble = a.createGain();
  pitchWobble.gain.value = 22;
  flap.connect(pitchWobble).connect(osc.frequency);
  const flapStage = a.createGain();
  flapStage.gain.value = 0.55;
  const flapDepth = a.createGain();
  flapDepth.gain.value = 0.45;
  flap.connect(flapDepth).connect(flapStage.gain);
  const filt = a.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(900, t);
  filt.frequency.exponentialRampToValueAtTime(240, t + dur);
  filt.Q.value = 7;
  const amp = a.createGain();
  env(amp, t, { attack: 0.02, peak: 0.55, hold: dur * 0.55, dur: dur * 0.45 });
  osc.connect(filt).connect(flapStage).connect(amp).connect(out());
  // Breathy "air" layer through the same flap.
  if (!noiseBuffer) noise({ gain: 0.0001 });
  const air = a.createBufferSource();
  air.buffer = noiseBuffer;
  const airFilt = a.createBiquadFilter();
  airFilt.type = "lowpass";
  airFilt.frequency.value = 420;
  const airGain = a.createGain();
  airGain.gain.value = 0.35;
  air.connect(airFilt).connect(airGain).connect(flapStage);
  osc.start(t); flap.start(t); air.start(t);
  osc.stop(t + dur + 0.05); flap.stop(t + dur + 0.05); air.stop(t + dur + 0.05);
  // Little sputter at the end.
  tone(70, { at: at + dur + 0.04, dur: 0.08, type: "sawtooth", gain: 0.2, filter: 400, slide: -20 });
}

function sparkle(at = 0, base = 1320, count = 5, gap = 0.045, gain = 0.05) {
  for (let i = 0; i < count; i++) tone(base * Math.pow(1.122, i * 2), { at: at + i * gap, dur: 0.18, type: "sine", gain });
}

function whoosh(at = 0, { up = true, dur = 0.25, gain = 0.14 } = {}) {
  noise({ at, dur, gain, freq: up ? 400 : 3000, sweep: up ? 2600 : -2600, q: 0.8, attack: dur * 0.5 });
}

export const sfx = {
  tap: () => { tone(1500, { dur: 0.03, type: "triangle", gain: 0.05 }); tone(900, { at: 0.012, dur: 0.04, gain: 0.04 }); },
  select: () => { whoosh(0, { dur: 0.12, gain: 0.07 }); tone(880, { dur: 0.06, type: "triangle", gain: 0.05, slide: 300 }); },
  play: () => { whoosh(0, { up: false, dur: 0.16, gain: 0.1 }); kick(0.12, { gain: 0.45 }); noise({ at: 0.12, dur: 0.12, gain: 0.12, freq: 500 }); sparkle(0.14, 1568, 3, 0.04, 0.035); },
  summon: () => { tone(520, { dur: 0.1, type: "triangle", gain: 0.08, slide: 400 }); noise({ dur: 0.06, gain: 0.05, freq: 3000 }); },
  spell: () => { whoosh(0, { dur: 0.3, gain: 0.1 }); sparkle(0.05, 988, 6, 0.05, 0.06); tone(220, { at: 0.05, dur: 0.5, type: "triangle", gain: 0.08, slide: 440 }); },
  attack: () => whoosh(0, { dur: 0.22, gain: 0.16 }),
  hit: (big = false) => {
    kick(0, { gain: big ? 0.6 : 0.45, from: 180 });
    noise({ dur: 0.12, gain: 0.2, freq: 1800, q: 0.7 });
    noise({ dur: 0.25, gain: 0.12, freq: 300, type: "lowpass" });
    if (big) vineBoom(0.02, 0.45);
  },
  vineBoom: () => vineBoom(0),
  heal: () => chord([784, 988, 1175, 1568], { dur: 0.5, gain: 0.05, stagger: 0.06, type: "sine" }),
  shield: () => { tone(300, { dur: 0.09, gain: 0.12, slide: 900 }); noise({ at: 0.05, dur: 0.1, gain: 0.08, freq: 4000 }); },
  death: () => { noise({ dur: 0.3, gain: 0.18, freq: 900, sweep: -700 }); tone(900, { at: 0.05, dur: 0.45, type: "sine", gain: 0.07, slide: -700 }); kick(0.02, { gain: 0.25, from: 120 }); },
  bark: () => { bark(0, 460); bark(0.17, 420); },
  barkFart: () => playSample("barkFart", () => { bark(0, 470); bark(0.17, 430); fart(0.38); }),
  turn: () => { chord([523, 659, 784], { gain: 0.07, dur: 0.4, stagger: 0.07, type: "triangle" }); sparkle(0.22, 1568, 4, 0.05, 0.04); whoosh(0, { dur: 0.3, gain: 0.06 }); },
  endTurn: () => { tone(392, { dur: 0.12, type: "triangle", gain: 0.08 }); tone(294, { at: 0.08, dur: 0.18, type: "triangle", gain: 0.07 }); },
  error: () => { tone(180, { dur: 0.09, type: "square", gain: 0.06, filter: 900 }); tone(150, { at: 0.11, dur: 0.12, type: "square", gain: 0.06, filter: 900 }); },
  win: () => { airHorn(0); chord([523, 659, 784, 1046], { at: 0.75, dur: 0.9, gain: 0.07, stagger: 0.08, type: "triangle" }); sparkle(0.9, 1568, 6, 0.06, 0.05); },
  lose: () => sadTrombone(0.1),
  packShake: () => { noise({ dur: 0.08, gain: 0.08, freq: 3500, q: 2 }); noise({ at: 0.1, dur: 0.08, gain: 0.08, freq: 3000, q: 2 }); noise({ at: 0.2, dur: 0.08, gain: 0.08, freq: 3800, q: 2 }); },
  packOpen: () => { kick(0, { gain: 0.5, from: 140 }); noise({ dur: 0.6, gain: 0.2, freq: 5000, sweep: -4000, q: 0.5 }); sparkle(0.1, 1175, 7, 0.04, 0.06); },
  flip: rarity => {
    tone(1200, { dur: 0.05, type: "triangle", gain: 0.06 });
    whoosh(0, { dur: 0.1, gain: 0.05 });
    if (rarity === "rare") chord([988, 1319], { at: 0.05, dur: 0.35, gain: 0.07, stagger: 0.05 });
    if (rarity === "epic") { chord([784, 988, 1175, 1568], { at: 0.05, dur: 0.6, gain: 0.07, stagger: 0.06, type: "triangle" }); sparkle(0.3, 1568, 5, 0.04, 0.05); }
    if (rarity === "legendary") { airHorn(0.05, 2); chord([523, 659, 784, 1046, 1319], { at: 0.5, dur: 1, gain: 0.07, stagger: 0.07, type: "triangle" }); sparkle(0.6, 1568, 8, 0.05, 0.05); }
  },
  shiny: () => sparkle(0, 1760, 8, 0.035, 0.06),
  coins: () => { tone(988, { dur: 0.07, type: "square", gain: 0.05, filter: 3000 }); tone(1319, { at: 0.07, dur: 0.25, type: "square", gain: 0.05, filter: 3000 }); },
  emote: () => { tone(660, { dur: 0.06, type: "triangle", gain: 0.08, slide: 300 }); }
};

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
}
