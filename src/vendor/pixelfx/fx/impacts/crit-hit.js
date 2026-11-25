// The star, its key frames and the spark spray are adapted from Sprite Fusion's open-source impact
// (https://www.spritefusion.com/pixel-art-vfx/impact), MIT License, Copyright (c) 2026 Hugo Duprez.
//
// Hearthlight top-down variant (changed from pixelfx 5294518, MIT): seen from above, `aim` is the blow's
// direction on the floor; sparks, shards and motes fly out over the floor in x and y (each with its own floor
// patch, see core/sim.js) and hop up the screen instead of falling to one floor line. `size` scales it to the
// game's 12x20 px characters (1 = the original), `calm` (reduced motion) drops the white frames and thins it.
import { Particles, Bits, Lights, P, B, Rng, fit, clamp, smooth, ease, TAU, WHITE } from "../../core/index.js";
import { spikes, star, brokenRing } from "./_lib.js";

export const meta = {
  name: "Critical hit",
  desc: "A critical hit: a jagged starburst slams in white and overshoots, a ring breaks into flying arcs, sparks streak off, shards tumble to the floor under a big flare.",
  tags: ["impact", "hit", "crit", "critical", "combat", "directional", "one-shot"],
  size: [216, 136],
  origin: [84, 106],
  duration: 0.9,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: ["#2a0510", "#5c0a1c", "#a3142a", "#e0302c", "#ff7a2a", "#ffc23d", "#fff09a", "#ffffff"], height: 26, aim: 0.12, size: 1, calm: false, seed: 3 },
};

// the star's key frames: [from t, scale, thickness, alpha, colors (rim, body, inner, core) as steps of the ramp]
const KEYS = [
  [0, 1, 1, 1, [6, 7, 7, 7]],
  [0.025, 1.3, 1, 1, [2, 5, 6, 7]],
  [0.058, 1.05, 0.72, 1, [2, 4, 5, 6]],
  [0.092, 1.22, 0.3, 1, [1, 2, 3, 4]],
  [0.125],
];

// a lens flare: a long level streak, thick and white at the heart, a shorter upright one, on a bed of light
function flare(p, x, y, L, k, C, WHITE) {
  for (const [dx, dy, len] of [[1, 0, L], [0, 1, L * 0.45], [0.7, 0.7, L * 0.16], [0.7, -0.7, L * 0.16]])
    for (const s of [-1, 1])
      for (let d = 1; d <= len; d++) {
        const u = d / len, a = u < 0.7 ? 1 : k * (1.6 - u);
        p.dot(x + s * dx * d, y + s * dy * d, u < 0.35 ? WHITE : u < 0.7 ? C[6] : C[5], a);
        if (dy === 0 && u < 0.42) for (const e of [-1, 1]) p.dot(x + s * d, y + e, u < 0.2 ? C[6] : C[5], u < 0.3 ? 1 : k);
      }
  p.glowLine(x - L, y, x + L, y, Math.max(2, L / 10), C[6], 0.5 * k);
  p.glowLine(x, y - L * 0.45, x, y + L * 0.45, 4, C[6], 0.3 * k);
}

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), X = 0, Y = -o.height, A = o.aim, floor = () => 0, S = o.size ?? 1;
  const calm = !!o.calm, HOT = calm ? C[6] : WHITE, N = calm ? 0.45 : 1;
  if (calm) C[7] = C[6];
  const ps = new Particles({ rng: R, ground: floor, sparks: [C[7], C[6], C[5], C[3]] });
  const bits = new Bits({ ground: floor }), lights = new Lights();
  const sp = spikes(R, 14, A, { len: [11 * S, 15 * S], w: [1.8 * Math.sqrt(S), 2.5 * Math.sqrt(S)], fwd: 1.4, back: 0.6, jag: 0.5 });
  [...sp].sort((a, b) => b.len - a.len).slice(0, 2).forEach((s) => (s.len *= 1.3));
  const segs = Array.from({ length: 7 }, (_, i) => {
    const a = A + (i / 7) * TAU;
    return { a, gap: R.range(0.55, 0.85), dr: R.range(0.08, 0.4) + 0.15 * Math.max(0, Math.cos(a - A)), w: 0.7 + 0.5 * Math.max(0, Math.cos(a - A)) };
  });

  lights.add(X, Y, 84 * S, C[5], 0.6, 0.5);
  lights.add(X, Y, 30 * S, HOT, 0.7, 0.1);
  lights.add(X, -4, 44 * S, C[4], 0.3, 0.45);
  // (top-down) sparks: most sprayed on along the blow over the floor, a few kicked back; each hops up the
  // screen and comes down on its own patch of floor
  for (let i = 0; i < Math.round(36 * N * Math.min(1, S + 0.2)); i++) {
    const back = R.chance(0.22), a = (back ? A + Math.PI : A) + R.range(-1, 1) * (back ? 0.6 : 0.8), v = R.range(150, 360) * S * (back ? 0.6 : 1);
    ps.spawn(P.SPARK, X, Y, Math.cos(a) * v, -R.range(40, 130) * S, R.range(0.15, 0.5), WHITE, 1, R.chance(0.3) ? R.range(0, 0.04) : 0, 0, Math.sin(a) * v);
  }
  // shards: bright splinters that tumble out over the floor, bounce and settle round the target
  for (let i = 0; i < Math.round(10 * N); i++) {
    const a = A + R.range(-1, 1) * 1.3, v = R.range(90, 220) * S;
    bits.add({ kind: B.SHARD, x: X, y: Y, vx: Math.cos(a) * v, vy: -R.range(60, 140) * S, fv: Math.sin(a) * v, g: 0.8, drag: 0.7, bounce: 0.35, life: R.range(0.55, 0.85), a: R.range(0, TAU), va: R.range(-25, 25), s: R.range(2, 4.5) * Math.max(0.6, S), c: R.pick([C[7], C[6], C[6], C[5]]) });
  }
  // embers of light drifting up and off, and glints that pop round the ring after the hit
  for (let i = 0; i < Math.round(12 * N); i++) {
    const a = A - Math.PI / 2 + R.range(-1.4, 1.4), v = R.range(35, 110) * S;
    ps.spawn(P.MOTE, X + Math.cos(a) * 4 * S, Y + Math.sin(a) * 4 * S, Math.cos(a) * v, Math.sin(a) * v - 15, R.range(0.35, 0.7), R.pick([C[6], C[5], C[5]]), 0.6, R.range(0, 0.05));
  }
  for (let i = 0; i < Math.round(5 * N); i++) {
    const a = R.range(0, TAU), d = R.range(14, 34) * S;
    ps.spawn(P.STAR, X + Math.cos(a) * d, Y + Math.sin(a) * d * 0.8, 0, -4, R.range(0.22, 0.38), R.chance(0.5) ? C[6] : HOT, R.range(1.6, 3) * Math.max(0.7, S), R.range(0.08, 0.32));
  }

  let t = 0;
  return {
    update(dt) {
      t += dt;
      ps.update(dt);
      bits.update(dt);
      lights.update(dt);
    },
    draw(p) {
      // the ring: it swells off the star, then breaks into arcs that fly on and cool
      const u = clamp((t - 0.03) / 0.37);
      if (t >= 0.03 && u < 1) {
        const r = (10 + 30 * ease.outCubic(u)) * S, brk = smooth(0.12, 0.6, u), th = Math.max(1, 3.6 * Math.sqrt(S) * Math.pow(1 - u, 1.2));
        const i = u < 0.12 ? 7 : u < 0.3 ? 6 : u < 0.5 ? 5 : u < 0.75 ? 4 : 3;
        brokenRing(p, X, Y, r, th, segs, brk, C[i], C[Math.max(2, i - 2)], u < 0.6 ? 1 : (1 - u) / 0.4, 1, 0);
        if (u < 0.6) p.glowRing(X, Y, r, 6 * S, C[5], 0.35 * Math.pow(1 - u / 0.6, 2));
      }
      bits.draw(p);
      ps.draw(p);
      // the flare blooms as the star collapses
      const f = (t - 0.04) / 0.28;
      if (f > 0 && f < 1) {
        flare(p, X, Y, 64 * S * Math.pow(1 - f, 1.3), 1 - f, C, HOT);
        p.glow(X, Y, 56 * S, C[5], 0.4 * (1 - f));
      }
      // the starburst slams in: a white frame, an overshoot, a settle, then it breaks up
      for (let i = 0; i < KEYS.length - 1; i++)
        if (t >= KEYS[i][0] && t < KEYS[i + 1][0]) {
          const [, sc, th, a, cols] = KEYS[i];
          star(p, X, Y, sp, sc, th, cols.map((j) => C[j]), a, 2.6 * Math.sqrt(S));
        }
      const pop = Math.exp(-t / 0.05);
      if (pop > 0.02) {
        p.glow(X, Y, 44 * S, C[5], 0.4 * pop);
        p.glow(X, Y, 12 * S, HOT, 0.6 * pop);
      }
      lights.draw(p);
    },
  };
}
