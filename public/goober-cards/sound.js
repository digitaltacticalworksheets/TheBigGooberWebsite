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

export const sfx = {
  tap: () => tone(660, { dur: 0.05, type: "triangle", gain: 0.06 }),
  play: () => { tone(220, { dur: 0.14, type: "triangle", gain: 0.16, slide: -80 }); noise({ dur: 0.08, gain: 0.08, freq: 500 }); },
  spell: () => { tone(520, { dur: 0.2, type: "sine", slide: 400 }); tone(780, { at: 0.06, dur: 0.2, slide: 300, gain: 0.08 }); },
  attack: () => noise({ dur: 0.18, gain: 0.14, freq: 900 }),
  hit: () => { tone(140, { dur: 0.16, type: "square", gain: 0.08, slide: -60 }); noise({ dur: 0.1, gain: 0.12, freq: 300 }); },
  heal: () => { tone(660, { dur: 0.16 }); tone(880, { at: 0.08, dur: 0.18 }); },
  shield: () => tone(1200, { dur: 0.2, type: "triangle", gain: 0.08, slide: -600 }),
  death: () => { tone(300, { dur: 0.35, type: "sawtooth", gain: 0.06, slide: -220 }); },
  bark: () => { tone(420, { dur: 0.09, type: "square", gain: 0.1, slide: -160 }); tone(360, { at: 0.11, dur: 0.1, type: "square", gain: 0.1, slide: -160 }); },
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
