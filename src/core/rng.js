// Seeded random numbers and value noise. Never use Math.random() for anything that
// shapes the world (worldgen, sprite generation): use an RNG so results repeat.

export class RNG {
  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
    this.state = this.seed;
  }

  // mulberry32
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  // Integer in [a, b] inclusive.
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined;
  }

  // Pick by weights: [{value, weight}] or [[value, weight]].
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += Array.isArray(e) ? e[1] : e.weight;
    let r = this.next() * total;
    for (const e of entries) {
      const w = Array.isArray(e) ? e[1] : e.weight;
      if ((r -= w) <= 0) return Array.isArray(e) ? e[0] : e.value;
    }
    const last = entries[entries.length - 1];
    return Array.isArray(last) ? last[0] : last?.value;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  fork(salt = 0) {
    return new RNG((this.seed * 2654435761 + salt * 40503 + 1) >>> 0);
  }
}

// Deterministic hash of integer coordinates -> [0, 1).
export function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise in [0, 1).
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise in [0, 1).
export function fbm(x, y, seed = 0, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
