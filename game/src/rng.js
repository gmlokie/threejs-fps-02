// Kestrel Yard — seeded RNG. The whole simulation runs off this one generator
// so a round replays exactly from its seed; Math.random never appears in the
// simulation (only the renderer may use wall-clock time for cosmetic motion).
// mulberry32: small, fast, good enough for bot decisions, spread and spawns.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny wrapper the sim carries around: next(), range, int, pick, chance.
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(lo, hi) {
      return lo + (hi - lo) * next();
    },
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
    // Box-Muller-ish normal in [-1, 1] for aim error and spread.
    gauss() {
      return (next() + next() + next() - 1.5) * 0.8165;
    },
  };
}

// Deterministic shuffle (Fisher-Yates) using a sim RNG.
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
