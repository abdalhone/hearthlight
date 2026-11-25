import { fit, mix, hex, cycle, TAU } from '../vendor/pixelfx/core/index.js';

// Critters for Hearthlight's ambience (DESIGN §30), drawn with pixelfx's painter but made
// for the game: pixelfx's own butterfly and bat are side-on showpieces bigger than our
// 12x20 px villagers, so these are new, tiny and seen from above. Each is a loop drawn
// round its anchor: the anchor is the spot on the ground under it (the host moves it),
// the critter flies `alt` px above that (drawn up the screen) and casts a small soft
// shadow on the ground where it really is. `heading` (radians, screen space) is where it
// is flying, so it banks and faces that way.

const SHADOW = hex('#0b0a14');

function shadow(p, x, y, r, a) {
  p.disc(x, y, r, SHADOW, a);
}

// A butterfly from above: two pairs of wings that clap shut and open in quick bursts,
// glides with them spread, a wake of glinting dust, bobbing over its shadow.
export const butterfly = {
  meta: {
    name: 'Butterfly (top-down)',
    desc: 'A small butterfly seen from above, wings clapping in bursts and gliding, bobbing over its shadow on the grass.',
    size: [32, 40],
    origin: [16, 30],
    duration: 2,
    loop: true,
    fps: 30,
    options: { palette: ['#1a1030', '#3a2a6a', '#5a4ab0', '#7f9cff', '#bcd4ff', '#ffffff'], alt: 9, heading: 0, seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 6);
    const ph = (o.seed % 7) * 0.37;
    const T = (t + ph) % 2;
    // two bursts of flapping per loop, a glide between
    const flapping = T < 0.7 || (T > 1.1 && T < 1.5);
    const open = flapping ? Math.floor((t + ph) * 18) % 2 === 0 : true;
    const bob = Math.sin((t + ph) * Math.PI * 2) * 1.2 + (flapping ? -0.5 : 0.5);
    const alt = (o.alt ?? 9) + bob;
    const x = 0;
    const y = -alt;
    shadow(p, 0.5, 0.5, open ? 2.2 : 1.4, 0.22);
    // body along the heading (2 px), wings either side of it
    const h = o.heading ?? 0;
    const ux = Math.cos(h);
    const uy = Math.sin(h) * 0.7;
    const nx = -uy;
    const ny = ux;
    p.px(x, y, C[0]);
    p.px(x + ux, y + uy, C[1]);
    const wing = (s, front) => {
      const k = open ? 2 : 1;
      const wx = x + nx * s * k + (front ? ux * 0.8 : -ux * 0.6);
      const wy = y + ny * s * k * 0.8 + (front ? uy * 0.8 : -uy * 0.6) - (open ? 0 : 1);
      p.px(wx, wy, front ? C[3] : C[2]);
      if (open) {
        p.px(wx + nx * s * 0.9, wy + ny * s * 0.7, front ? C[4] : C[3]);
        p.px(wx + (front ? ux : -ux) * 0.9, wy + (front ? uy : -uy) * 0.9, C[2]);
      }
    };
    wing(1, true);
    wing(-1, true);
    wing(1, false);
    wing(-1, false);
    p.light(x, y, C[4], 0.12);
    // a little glinting dust shed in its wake
    cycle(t, 2, 6, o.seed * 3 + 1, (r) => r.range(0.6, 1.1), (age, life, r) => {
      const k = age / life;
      const dx = -ux * (2 + age * 6) + r.range(-1.5, 1.5);
      const dy = -uy * (2 + age * 6) + age * 4;
      if (r.chance(0.5)) p.dot(x + dx, y + dy, C[5], (1 - k) * 1.1);
    });
  },
};

// A bat from above at dusk: wide thin wings beating fast, jinking, a quick shadow.
export const bat = {
  meta: {
    name: 'Bat (top-down)',
    desc: 'A small bat seen from above at dusk, wings beating fast and folding, a quick shadow sliding over the ground.',
    size: [40, 48],
    origin: [20, 38],
    duration: 0.8,
    loop: true,
    fps: 30,
    options: { palette: ['#07050c', '#16101f', '#2a2036', '#4a3a58', '#6e5a80', '#a08ab0'], eyes: '#ff5a4a', alt: 18, heading: 0, seed: 1 },
  },
  draw(p, t, o) {
    const C = fit(o.palette, 6);
    const ph = (o.seed % 5) * 0.11;
    const f = Math.floor(((t + ph) / 0.8) * 8) % 4; // four wing frames a beat, two beats a loop
    const alt = (o.alt ?? 18) + (f === 1 ? -1 : f === 3 ? 1 : 0);
    const x = 0;
    const y = -alt;
    shadow(p, 0.5, 0.5, f === 2 ? 1.6 : 2.6, 0.2);
    const h = o.heading ?? 0;
    const ux = Math.cos(h);
    const uy = Math.sin(h) * 0.7;
    const nx = -uy;
    const ny = ux;
    // body and head
    p.px(x, y, C[2]);
    p.px(x - ux, y - uy, C[1]);
    p.px(x + ux, y + uy, C[2]);
    if (Math.sin(t * 9 + ph * 20) > -0.6) p.px(x + ux * 1.6, y + uy * 1.6 - 0.4, hex(o.eyes));
    // wings: spread wide (frame 0), half up (1), folded (2), half down (3)
    const span = [4, 3, 1.5, 3][f];
    const lift = [0, -1.5, -1, 1][f];
    for (const s of [-1, 1]) {
      for (let d = 1; d <= span; d += 0.5) {
        const u = d / span;
        const wx = x + nx * s * d - ux * u * 1.2;
        const wy = y + ny * s * d * 0.75 + lift * u - uy * u * 1.2;
        p.px(wx, wy, u > 0.75 ? C[1] : C[3]);
        if (span > 2 && u > 0.35 && u < 0.9) p.px(wx - ux, wy - uy + 0.6, C[1]);
      }
    }
    if (f === 0) p.light(x, y, mix(C[4], C[5], 0.5), 0.08);
  },
};

// The ground under a critter is where it is; the host moves it with this little wanderer:
// a heading that drifts, a speed, a lifetime, leaving when its time is up.
export function wanderer(x, y, { speed = 14, turn = 1.4, life = 30, seed = 1 } = {}) {
  let s = Math.floor((seed % 1) * 233280) || 4241;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
  return {
    x,
    y,
    heading: rnd() * TAU,
    speed,
    turn,
    life,
    age: 0,
    removed: false,
    _w: 0,
    step(dt, toward = null) {
      this.age += dt;
      this._w += (rnd() - 0.5) * this.turn * dt * 6;
      this._w *= 0.96;
      this.heading += this._w * dt;
      if (toward) {
        const want = Math.atan2(toward.y - this.y, toward.x - this.x);
        let d = want - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * Math.min(1, dt * 0.8);
      }
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.y += Math.sin(this.heading) * this.speed * dt * 0.8;
      if (this.age > this.life) this.removed = true;
    },
  };
}
