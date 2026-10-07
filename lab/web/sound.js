// Synthesized sound effects (WebAudio, no audio files). The palette is airy and
// "spaceship": filtered noise whooshes, falling pitch sweeps, soft sub pulses.
const PREF = "hx-sound";
let ctx = null, out = null, noise = null;
let enabled = (() => { try { return localStorage.getItem(PREF) !== "off"; } catch { return true; } })();

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(PREF, on ? "on" : "off"); } catch { /* private mode */ }
}

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
// Browsers only allow audio after a user gesture.
export function unlockAudio() { audio(); }

function env(gainNode, t, attack, hold, release, peak) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.setValueAtTime(peak, t + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
}

// Band-passed noise sweeping from one frequency to another, optionally panned across.
function whoosh({ at = 0, dur = 0.4, from = 6000, to = 600, q = 5, gain = 0.5, panFrom = 0, panTo = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at;
  const src = a.createBufferSource(); src.buffer = noise; src.loop = true;
  const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q;
  bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain(); env(g, t, dur * 0.25, 0, dur * 0.75, gain);
  let node = src.connect(bp).connect(g);
  if (a.createStereoPanner && (panFrom || panTo)) {
    const p = a.createStereoPanner();
    p.pan.setValueAtTime(panFrom, t); p.pan.linearRampToValueAtTime(panTo, t + dur);
    node = node.connect(p);
  }
  node.connect(out);
  src.start(t); src.stop(t + dur + 0.05);
}

// An oscillator gliding between two pitches.
function sweep({ at = 0, type = "sine", f0 = 800, f1 = 400, dur = 0.2, gain = 0.25, attack = 0.01, lowpass = 0, detune = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = a.createGain(); env(g, t, attack, 0, Math.max(0.02, dur - attack), gain);
  let node = o.connect(g);
  if (lowpass) { const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lowpass; node = node.connect(lp); }
  node.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  select() { sweep({ f0: 1900, f1: 2300, dur: 0.05, gain: 0.08 }); },
  cancel() { sweep({ f0: 1200, f1: 700, dur: 0.07, gain: 0.07 }); },
  // A quick "pew" that materialises a piece.
  spawn() {
    whoosh({ dur: 0.16, from: 9000, to: 2500, q: 3, gain: 0.25 });
    sweep({ type: "triangle", f0: 2200, f1: 520, dur: 0.16, gain: 0.2 });
  },
  // Rising charge.
  grow(height = 2) {
    sweep({ type: "triangle", f0: 300 + height * 60, f1: 1200 + height * 180, dur: 0.18, gain: 0.18 });
    whoosh({ dur: 0.18, from: 1500, to: 5000, q: 4, gain: 0.12 });
  },
  // A ship cutting past: noise sweep with a falling, Doppler-ish engine tone, panned.
  vast() {
    whoosh({ dur: 0.55, from: 7000, to: 450, q: 6, gain: 0.55, panFrom: -0.7, panTo: 0.7 });
    sweep({ type: "sawtooth", f0: 1100, f1: 160, dur: 0.55, gain: 0.07, lowpass: 2400, detune: 6 });
    sweep({ type: "sawtooth", f0: 1110, f1: 165, dur: 0.55, gain: 0.05, lowpass: 2400, detune: -8 });
  },
  drop(i = 0) {
    sweep({ f0: 1300 + i * 160, f1: 900 + i * 120, dur: 0.06, gain: 0.12 });
    whoosh({ dur: 0.06, from: 4000, to: 2000, q: 8, gain: 0.08 });
  },
  // Deep pulse plus a shimmering blast for a 5-stack going off.
  ripple() {
    sweep({ f0: 150, f1: 38, dur: 0.75, gain: 0.55, attack: 0.005 });
    whoosh({ dur: 0.6, from: 3000, to: 180, q: 1.2, gain: 0.35 });
    sweep({ at: 0.05, type: "triangle", f0: 2600, f1: 4200, dur: 0.3, gain: 0.06 });
  },
  flip(i = 0) { sweep({ at: i * 0.04, type: "triangle", f0: 700, f1: 1700, dur: 0.08, gain: 0.07 }); },
  turn() {
    sweep({ f0: 880, f1: 900, dur: 0.12, gain: 0.1 });
    sweep({ at: 0.11, f0: 1320, f1: 1340, dur: 0.18, gain: 0.1 });
  },
  tick() { sweep({ f0: 2400, f1: 2300, dur: 0.025, gain: 0.05 }); },
  error() { sweep({ type: "square", f0: 160, f1: 120, dur: 0.14, gain: 0.08, lowpass: 900 }); },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => sweep({ at: i * 0.11, type: "triangle", f0: f, f1: f * 1.01, dur: 0.3, gain: 0.14 }));
    whoosh({ at: 0.3, dur: 0.8, from: 2000, to: 9000, q: 2, gain: 0.12 });
  },
  lose() {
    [659, 523, 440, 330].forEach((f, i) => sweep({ at: i * 0.13, type: "triangle", f0: f, f1: f * 0.97, dur: 0.32, gain: 0.12 }));
  }
};
