// Tiny synthesized sound effects (no audio files to download).
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = Boolean(on); }

function audio() {
  if (!enabled) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq, { at = 0, dur = 0.12, type = "sine", gain = 0.12, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ at = 0, dur = 0.15, gain = 0.1, freq = 1200 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const g = a.createGain();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  g.gain.value = gain;
  src.buffer = buffer;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

// A short "ruff": pitched square burst with a falling pitch, plus a breathy noise edge.
function bark(at = 0, pitch = 520) {
  tone(pitch, { at, dur: 0.1, type: "square", gain: 0.13, slide: -pitch * 0.45 });
  tone(pitch * 1.5, { at, dur: 0.07, type: "sawtooth", gain: 0.05, slide: -pitch * 0.6 });
  noise({ at, dur: 0.08, gain: 0.08, freq: 1400 });
}

// A wet, wobbly fart: low sawtooth with a fast "flap" on pitch and volume, through a low-pass filter.
function fart(at = 0, dur = 0.75) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const flap = a.createOscillator();
  const flapDepth = a.createGain();
  const amp = a.createGain();
  const ampFlap = a.createGain();
  const flapStage = a.createGain();
  const filter = a.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.linearRampToValueAtTime(120, t + dur * 0.25);
  osc.frequency.exponentialRampToValueAtTime(55, t + dur);
  flap.type = "square";
  flap.frequency.setValueAtTime(26, t);
  flap.frequency.linearRampToValueAtTime(14, t + dur);
  flapDepth.gain.value = 28;
  flap.connect(flapDepth).connect(osc.frequency);
  flapStage.gain.value = 0.6;
  ampFlap.gain.value = 0.4;
  flap.connect(ampFlap).connect(flapStage.gain);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(700, t);
  filter.frequency.exponentialRampToValueAtTime(260, t + dur);
  filter.Q.value = 6;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
  amp.gain.setValueAtTime(0.3, t + dur * 0.7);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter).connect(flapStage).connect(amp).connect(a.destination);
  osc.start(t); flap.start(t);
  osc.stop(t + dur + 0.05); flap.stop(t + dur + 0.05);
  noise({ at, dur: dur * 0.6, gain: 0.05, freq: 180 });
}

export const sfx = {
  tap: () => tone(660, { dur: 0.05, type: "triangle", gain: 0.06 }),
  play: () => { tone(220, { dur: 0.14, type: "triangle", gain: 0.16, slide: -80 }); noise({ dur: 0.08, gain: 0.08, freq: 500 }); },
  spell: () => { tone(520, { dur: 0.2, type: "sine", slide: 400 }); tone(780, { at: 0.06, dur: 0.2, slide: 300, gain: 0.08 }); },
  attack: () => noise({ dur: 0.18, gain: 0.14, freq: 900 }),
  hit: () => { tone(140, { dur: 0.16, type: "square", gain: 0.08, slide: -60 }); noise({ dur: 0.1, gain: 0.12, freq: 300 }); },
  heal: () => { tone(660, { dur: 0.16 }); tone(880, { at: 0.08, dur: 0.18 }); },
  shield: () => tone(1200, { dur: 0.2, type: "triangle", gain: 0.08, slide: -600 }),
  death: () => { tone(300, { dur: 0.35, type: "sawtooth", gain: 0.06, slide: -220 }); },
  bark: () => { bark(0, 520); bark(0.13, 470); },
  barkFart: () => { bark(0, 540); bark(0.13, 480); fart(0.3); },
  turn: () => { tone(523, { dur: 0.12 }); tone(659, { at: 0.1, dur: 0.12 }); tone(784, { at: 0.2, dur: 0.2 }); },
  error: () => tone(160, { dur: 0.18, type: "square", gain: 0.06 }),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.3, type: "triangle", gain: 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, { at: i * 0.18, dur: 0.35, type: "triangle", gain: 0.1 })),
  packShake: () => noise({ dur: 0.12, gain: 0.06, freq: 2400 }),
  packOpen: () => { noise({ dur: 0.4, gain: 0.12, freq: 3000 }); tone(880, { at: 0.1, dur: 0.3, slide: 600, gain: 0.06 }); },
  flip: rarity => {
    tone(700, { dur: 0.08, type: "triangle", gain: 0.07 });
    if (rarity === "rare") tone(990, { at: 0.06, dur: 0.2, gain: 0.08 });
    if (rarity === "epic") [880, 1175].forEach((f, i) => tone(f, { at: 0.06 + i * 0.08, dur: 0.25, gain: 0.09 }));
    if (rarity === "legendary") [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, { at: 0.05 + i * 0.09, dur: 0.4, type: "triangle", gain: 0.1 }));
  },
  coins: () => [1318, 1568].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.12, type: "square", gain: 0.04 }))
};

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ }
}
