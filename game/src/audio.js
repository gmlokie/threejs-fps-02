// Kestrel Yard — sound. Fully synthesized WebAudio: no audio files, no
// network. Short oscillators and filtered noise bursts for shots, hits,
// reloads, planting, explosions and round stingers. Everything is guarded:
// if the AudioContext cannot start (headless, no gesture yet) every call is
// a silent no-op and the game keeps playing.
let ctx = null;
let master = null;
let muted = false;
let noiseBuf = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.35;
}
export function isMuted() {
  return muted;
}

function tone(freq, dur, type = 'sine', vol = 0.5, slideTo = null, delay = 0) {
  if (!ctx || muted) return;
  try {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch { /* audio is cosmetic */ }
}

function noise(dur, filterFreq, vol = 0.6, type = 'lowpass', delay = 0) {
  if (!ctx || muted || !noiseBuf) return;
  try {
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  } catch { /* audio is cosmetic */ }
}

// One sound per game event. The main loop drains state.events and calls these.
export function playEvent(ev) {
  if (!ctx || muted) return;
  switch (ev.kind) {
    case 'shot':
      if (ev.weapon === 'longshot') { noise(0.22, 1400, 0.9); tone(160, 0.14, 'square', 0.3, 55); }
      else if (ev.weapon === 'p9') { noise(0.09, 2400, 0.5); tone(220, 0.07, 'square', 0.22, 90); }
      else { noise(0.11, 1800, 0.65); tone(180, 0.09, 'square', 0.28, 70); }
      break;
    case 'dry':
      tone(900, 0.04, 'square', 0.15);
      break;
    case 'hit':
      tone(1250, 0.06, 'sine', 0.4);
      break;
    case 'kill':
      tone(660, 0.09, 'sine', 0.4);
      tone(990, 0.12, 'sine', 0.4, null, 0.08);
      break;
    case 'reload':
      tone(500, 0.05, 'square', 0.18);
      tone(700, 0.05, 'square', 0.18, null, 0.18);
      break;
    case 'throw':
      noise(0.15, 900, 0.3);
      break;
    case 'explosion':
      noise(0.9, 300, 1.0);
      tone(70, 0.8, 'sine', 0.9, 28);
      break;
    case 'flash':
      tone(1800, 0.4, 'sine', 0.25, 300);
      break;
    case 'planted':
      tone(880, 0.12, 'sine', 0.4);
      tone(880, 0.12, 'sine', 0.4, null, 0.18);
      tone(1320, 0.2, 'sine', 0.4, null, 0.36);
      break;
    case 'detonation':
      noise(1.4, 220, 1.0);
      tone(55, 1.2, 'sine', 1.0, 24);
      break;
    case 'roundEnd':
      if (ev.winner === 'falcons') {
        tone(523, 0.16, 'sine', 0.4);
        tone(659, 0.16, 'sine', 0.4, null, 0.15);
        tone(784, 0.3, 'sine', 0.45, null, 0.3);
      } else {
        tone(392, 0.2, 'sine', 0.4);
        tone(311, 0.35, 'sine', 0.4, null, 0.2);
      }
      break;
    default:
      break;
  }
}
