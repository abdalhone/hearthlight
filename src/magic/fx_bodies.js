import { planLook } from './fx_styles.js';
import { TAU, hash, flicker } from './fx_util.js';
import { disc, ell, ring, line, halo, zig, poly, wedge, px, rect, glyphSprite, fistSprite } from './fx_draw.js';
import { drawFamiliar, drawFamiliarShadow } from './fx_familiars.js';

// How every body kind looks (DESIGN §22.2: "a render layer drawing every body by kind
// with its palette, particle style and light"). Each draw function paints the body into
// the world buffer (R.ctx) and its hot parts into the glow buffer (R.g), both in world px
// minus the view origin. R = { ctx, g, ox, oy, w, h, time, dark, bounds, parts }.
// The look comes from planLook(plan): the lead essence's form, its palette nudged toward
// the blend, and an accent from the second essence.

const PTS = new Float32Array(64);
const DARK_CORE = '#120a1e';

const k01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fadeOf(b, inT = 0.08, outT = 0.12) {
  const a = inT > 0 ? b.age / inT : 1;
  const o = outT > 0 ? (b.life - b.age) / outT : 1;
  return k01(Math.min(a, o));
}

// ================================================================== missile forms

// Each form draws a missile's core at (x, y) (already lifted by z) with radius r,
// heading `ang`. g is the glow buffer or null.
const FORMS = {
  flare(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const c = R.ctx;
    // A licking tail of flame behind the head.
    for (let k = 3; k >= 1; k--) {
      const w = Math.sin(t * 31 + k * 2 + b.seed * 9) * 0.6;
      disc(c, x - ux * k * r * 0.75 - uy * w, y - uy * k * r * 0.75 + ux * w, r * (1 - k * 0.2), k === 1 ? P.glow : k === 2 ? P.deep : L.accentDeep);
    }
    disc(c, x, y, r, P.deep);
    disc(c, x + ux * 0.6, y + uy * 0.6 - 0.4, r * 0.78, P.glow);
    disc(c, x + ux * 1.1, y + uy * 1.1 - 0.5, r * 0.45, P.spark);
    px(c, x + ux * r * 0.5, y + uy * r * 0.5 - 1, P.core);
    if (hash(b.uid, Math.floor(t * 20)) > 0.5) px(c, x - uy * r * 0.7, y - r - 1, P.spark);
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 4.2, L.halo, 0.65, R.bounds);
      disc(g, x + ux, y + uy, r * 0.7, P.spark);
      disc(g, x + ux * 1.2, y + uy * 1.2, r * 0.35, P.core);
    }
  },

  orb(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const wob = Math.sin(t * 18 + b.seed * 7) * 0.12;
    disc(c, x, y, r + 0.6, L.outline);
    ell(c, x, y, r * (1 + wob), r * (1 - wob), P.glow);
    disc(c, x - r * 0.15, y + r * 0.2, r * 0.55, P.deep);
    disc(c, x - r * 0.25, y - r * 0.25, r * 0.45, P.spark);
    px(c, x - r * 0.45, y - r * 0.55, P.core);
    const rp = r + 1 + ((t * 9 + b.seed * 3) % 3);
    const prev = c.globalAlpha;
    c.globalAlpha = prev * 0.5;
    ring(c, x, y, rp, P.spark, 1, 1);
    c.globalAlpha = prev;
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 3.2, L.halo, 0.45, R.bounds);
      disc(g, x - r * 0.25, y - r * 0.25, r * 0.4, P.spark);
    }
  },

  shard(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const c = R.ctx;
    const len = r * 2.1;
    const wid = r * 0.75;
    PTS[0] = x + ux * len;
    PTS[1] = y + uy * len;
    PTS[2] = x - uy * wid;
    PTS[3] = y + ux * wid;
    PTS[4] = x - ux * len * 0.8;
    PTS[5] = y - uy * len * 0.8;
    PTS[6] = x + uy * wid;
    PTS[7] = y - ux * wid;
    poly(c, PTS, 4, P.deep);
    PTS[2] = x - uy * wid * 0.55;
    PTS[3] = y + ux * wid * 0.55;
    PTS[6] = x + uy * wid * 0.55;
    PTS[7] = y - ux * wid * 0.55;
    poly(c, PTS, 4, P.glow);
    line(c, x - ux * len * 0.5, y - uy * len * 0.5, x + ux * len * 0.9, y + uy * len * 0.9, P.core, 1);
    px(c, x + ux * len, y + uy * len, '#ffffff');
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 3, L.halo, 0.4, R.bounds);
      line(g, x - ux * len * 0.3, y - uy * len * 0.3, x + ux * len, y + uy * len, P.core, 1);
      if ((Math.floor(t * 12) + b.uid) % 4 === 0) px(g, x - uy * 2, y + ux * 2, '#ffffff');
    }
  },

  crackle(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const seed = b.uid * 31 + Math.floor(t * 26);
    for (let i = 0; i < 3; i++) {
      const a = hash(seed, i) * TAU;
      const l = r * (1.6 + hash(seed, i, 3) * 1.4);
      zig(c, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.8, 3, 1.5, seed + i, i ? P.glow : P.spark, 1);
    }
    disc(c, x, y, r * 0.9, P.glow);
    disc(c, x, y, r * 0.55, P.core);
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 4.5, L.halo, 0.75, R.bounds);
      disc(g, x, y, r * 0.7, P.core);
      const a = hash(seed, 9) * TAU;
      zig(g, x, y, x + Math.cos(a) * r * 2.4, y + Math.sin(a) * r * 2, 3, 1.5, seed + 5, P.core, 1);
    }
  },

  rock(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const rot = b.age * 9 + b.seed * 6;
    for (let i = 0; i < 7; i++) {
      const a = rot + (i / 7) * TAU;
      const rr = r * (0.82 + hash(b.uid, i) * 0.3);
      PTS[i * 2] = x + Math.cos(a) * rr;
      PTS[i * 2 + 1] = y + Math.sin(a) * rr * 0.9;
    }
    poly(c, PTS, 7, P.deep);
    disc(c, x - r * 0.2, y - r * 0.25, r * 0.62, P.glow);
    px(c, x - r * 0.4, y - r * 0.5, P.core);
    px(c, x + r * 0.3, y + r * 0.1, L.outline);
    if (L.multi) px(c, x + r * 0.1, y - r * 0.4, L.accent);
    const g = R.g;
    if (g) halo(g, x, y, r * 2.4, L.halo, 0.25, R.bounds);
  },

  crescent(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const rot = b.age * 16 + b.seed * 6;
    ring(c, x, y, r * 1.25, P.spark, 1.5, 0.9, rot, rot + Math.PI * 1.15);
    ring(c, x, y, r * 0.8, P.core, 1, 0.9, rot + Math.PI, rot + Math.PI * 2);
    disc(c, x, y, r * 0.35, P.core);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const prev = c.globalAlpha;
    c.globalAlpha = prev * 0.55;
    line(c, x - ux * r * 2 - uy * 2, y - uy * r * 2 + ux * 2, x - ux * r * 4 - uy * 2, y - uy * r * 4 + ux * 2, P.core, 1);
    line(c, x - ux * r * 1.6 + uy * 2, y - uy * r * 1.6 - ux * 2, x - ux * r * 3.2 + uy * 2, y - uy * r * 3.2 - ux * 2, P.spark, 1);
    c.globalAlpha = prev;
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 2.6, L.halo, 0.3, R.bounds);
      ring(g, x, y, r * 1.25, P.core, 1, 0.9, rot, rot + Math.PI);
    }
  },

  thorn(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const rot = b.age * 12 + b.seed * 6;
    const ux = Math.cos(rot);
    const uy = Math.sin(rot);
    PTS[0] = x + ux * r * 1.5;
    PTS[1] = y + uy * r * 1.5;
    PTS[2] = x - uy * r * 0.6;
    PTS[3] = y + ux * r * 0.6;
    PTS[4] = x - ux * r * 1.5;
    PTS[5] = y - uy * r * 1.5;
    PTS[6] = x + uy * r * 0.6;
    PTS[7] = y - ux * r * 0.6;
    poly(c, PTS, 4, P.deep);
    line(c, x - ux * r, y - uy * r, x + ux * r, y + uy * r, P.glow, 1);
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * TAU + 0.5;
      px(c, x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2, i ? P.deep : L.accent);
    }
    px(c, x, y, P.core);
    const g = R.g;
    if (g) halo(g, x, y, r * 2.6, L.halo, 0.35, R.bounds);
  },

  glob(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const s = Math.sin(t * 14 + b.seed * 9) * 0.18;
    ell(c, x, y, r * (1 + s) + 0.6, r * (1 - s) + 0.6, P.deep);
    ell(c, x, y - 0.4, r * (1 + s) * 0.82, r * (1 - s) * 0.8, P.glow);
    disc(c, x - r * 0.3, y - r * 0.35, r * 0.3, P.spark);
    px(c, x + r * 0.35, y + r * 0.1, P.core);
    if (hash(b.uid, Math.floor(t * 6)) > 0.6) px(c, x + r * 0.2, y + r + 1, P.glow);
    const g = R.g;
    if (g) halo(g, x, y, r * 3, L.halo, 0.45, R.bounds);
  },

  star(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const rot = b.age * 2.5;
    const l1 = r * 2.4 * (0.85 + 0.15 * Math.sin(t * 20));
    const l2 = r * 1.3;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      line(c, x, y, x + Math.cos(a) * l1, y + Math.sin(a) * l1, P.spark, 1);
      const a2 = a + Math.PI / 4;
      line(c, x, y, x + Math.cos(a2) * l2, y + Math.sin(a2) * l2, P.glow, 1);
    }
    disc(c, x, y, r * 0.8, P.glow);
    disc(c, x, y, r * 0.5, '#ffffff');
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 5.5, L.halo, 0.8, R.bounds);
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 2;
        line(g, x, y, x + Math.cos(a) * l1, y + Math.sin(a) * l1, P.core, 1);
      }
      disc(g, x, y, r * 0.6, '#ffffff');
    }
  },

  void(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    disc(c, x, y, r + 1, P.deep);
    disc(c, x, y, r * 0.85, DARK_CORE);
    ring(c, x, y, r + 0.5, P.glow, 1, 1);
    for (let i = 0; i < 2; i++) {
      const a = t * 7 + b.seed * 6 + i * Math.PI;
      px(c, x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2) * 0.7, i ? L.accent : P.spark);
    }
    px(c, x - r * 0.3, y - r * 0.3, P.spark);
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 3, L.halo, 0.3, R.bounds);
      ring(g, x, y, r + 0.5, P.glow, 1, 1);
    }
  },

  blade(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const rot = b.age * 22 + b.seed * 6;
    const l = r * 1.5;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const ex = x + Math.cos(a) * l;
      const ey = y + Math.sin(a) * l;
      line(c, x, y, ex, ey, P.deep, 2);
      line(c, x, y, ex, ey, P.glow, 1);
      px(c, ex, ey, i & 1 ? P.spark : P.core);
    }
    px(c, x, y, L.outline);
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 2.2, L.halo, 0.3, R.bounds);
      const a = rot;
      px(g, x + Math.cos(a) * l, y + Math.sin(a) * l, P.spark);
      px(g, x - Math.cos(a) * l, y - Math.sin(a) * l, P.core);
    }
  },

  chime(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    disc(c, x, y, r * 0.9, P.deep);
    disc(c, x, y - 0.5, r * 0.7, P.glow);
    const k = (t * 2.2 + b.seed) % 1;
    const prev = c.globalAlpha;
    c.globalAlpha = prev * (1 - k);
    ring(c, x, y, r + k * r * 2, P.spark, 1, 0.8);
    c.globalAlpha = prev;
    rect(c, x, y - 2, 1, 3, P.core);
    rect(c, x - 1, y + 1, 2, 1, P.core);
    px(c, x + 1, y - 2, P.core);
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 3, L.halo, 0.45, R.bounds);
      ring(g, x, y, r + k * r * 2, P.glow, 1, 0.8);
    }
  },

  gem(R, b, L, x, y, r, ang, t) {
    const P = L.pal;
    const c = R.ctx;
    const h = r * 1.35;
    PTS[0] = x;
    PTS[1] = y - h;
    PTS[2] = x + r;
    PTS[3] = y;
    PTS[4] = x;
    PTS[5] = y + h;
    PTS[6] = x - r;
    PTS[7] = y;
    poly(c, PTS, 4, P.deep);
    PTS[2] = x + r * 0.6;
    PTS[5] = y + h * 0.5;
    PTS[6] = x - r * 0.6;
    poly(c, PTS, 4, P.glow);
    disc(c, x, y - 0.5, r * 0.35, P.core);
    if (Math.sin(t * 9 + b.seed * 7) > 0.6) {
      px(c, x, y - h - 1, P.core);
      px(c, x + r + 1, y, P.spark);
    }
    const g = R.g;
    if (g) {
      halo(g, x, y, r * 3.6, L.halo, 0.55, R.bounds);
      disc(g, x, y, r * 0.45, P.core);
    }
  },
};

export const FORM_NAMES = Object.keys(FORMS);

function form(L) {
  return FORMS[L.look.form] || FORMS.gem;
}

// ================================================================== projectiles

function drawTrail(R, b, L, x, y, r, n) {
  if (b.trailN < 2) return;
  const c = R.ctx;
  const P = L.pal;
  const zl = b.z;
  let px0 = x;
  let py0 = y;
  const m = Math.min(b.trailN, n);
  for (let i = 1; i < m; i++) {
    const j = (b.trailI - i + 16) % 8;
    const tx = b.trail[j * 2] - R.ox;
    const ty = b.trail[j * 2 + 1] - R.oy - zl;
    const k = 1 - i / m;
    c.globalAlpha = 0.75 * k;
    line(c, px0, py0, tx, ty, i < 2 ? P.glow : i < 4 ? P.deep : L.accentDeep, Math.max(1, r * 1.3 * k));
    if (R.g && i < 4) {
      R.g.globalAlpha = 0.6 * k;
      line(R.g, px0, py0, tx, ty, P.glow, Math.max(1, r * 0.6 * k));
    }
    px0 = tx;
    py0 = ty;
  }
  c.globalAlpha = 1;
  if (R.g) R.g.globalAlpha = 1;
}

function drawMissile(R, b, L, fs) {
  const x = b.x - R.ox;
  const y = b.y - R.oy - b.z;
  const r = Math.max(1.5, b.r);
  const ang = b.orbitT > 0 ? b.angle : Math.atan2(b.vy, b.vx) || b.angle;
  const t = R.time;
  const plan = b.plan;
  const swift = plan.twists.includes('swift');
  const echo = fs && fs.echo;
  const base = echo ? 0.55 + 0.25 * Math.sin(t * 30 + b.seed * 9) : 1;
  R.ctx.globalAlpha = base;
  if (R.g) R.g.globalAlpha = base;
  drawTrail(R, b, L, x, y, r, swift ? 8 : 6);
  R.ctx.globalAlpha = base;
  if (R.g) R.g.globalAlpha = base;
  if (swift && b.orbitT <= 0) {
    // Speed lines and a stretched afterglow.
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const c = R.ctx;
    c.globalAlpha = 0.5 * base;
    line(c, x - ux * r * 2 - uy * (r + 1), y - uy * r * 2 + ux * (r + 1), x - ux * r * 6 - uy * (r + 1), y - uy * r * 6 + ux * (r + 1), L.pal.spark, 1);
    line(c, x - ux * r * 2 + uy * (r + 1), y - uy * r * 2 - ux * (r + 1), x - ux * r * 5 + uy * (r + 1), y - uy * r * 5 - ux * (r + 1), L.pal.spark, 1);
    c.globalAlpha = base;
    disc(c, x - ux * r, y - uy * r, r * 0.8, L.pal.glow);
  }
  if (echo) {
    // A lagging ghost copy (the echo).
    R.ctx.globalAlpha = 0.25;
    form(L)(R, b, L, x - Math.cos(ang) * r * 2.5, y - Math.sin(ang) * r * 2.5, r * 0.9, ang, t - 0.05);
    R.ctx.globalAlpha = base;
  }
  form(L)(R, b, L, x, y, r, ang, t);
  if (L.multi) {
    // The second essence rims the first (fire + dark: a fire with a violet edge).
    R.ctx.globalAlpha = 0.7 * base;
    ring(R.ctx, x, y, r + 1.2, L.accent, 1, 1, t * 6, t * 6 + Math.PI * 1.3);
    R.ctx.globalAlpha = 1;
  }
  if (b.spiralAmp > 0) {
    // Spiral: a twin strand on the other side of the path (a double helix).
    const mx = 2 * (b.bx - R.ox) - x;
    const my = 2 * (b.by - R.oy - b.z) - y;
    disc(R.ctx, mx, my, Math.max(1, r * 0.45), L.accent);
    if (R.g) disc(R.g, mx, my, Math.max(1, r * 0.35), L.pal.spark);
  }
  if (b.homing > 0 && b.mode !== 'arc') {
    // A seeker's eye blinking at its nose.
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    if (Math.sin(t * 18 + b.seed * 9) > 0) px(R.ctx, x + ux * (r + 2), y + uy * (r + 2), L.pal.core);
  }
  R.ctx.globalAlpha = 1;
  if (R.g) R.g.globalAlpha = 1;
}

// A big slow sphere that pulses at everything near.
function drawOrb(R, b, L) {
  const x = b.x - R.ox;
  const y = b.y - R.oy - b.z;
  const r = Math.max(3, b.r);
  const P = L.pal;
  const c = R.ctx;
  const t = R.time;
  const fade = fadeOf(b, 0.15, 0.25);
  c.globalAlpha = fade;
  const breathe = 1 + 0.08 * Math.sin(t * 6 + b.seed * 9);
  const rr = r * breathe;
  disc(c, x, y, rr + 1, L.outline);
  disc(c, x, y, rr, P.deep);
  disc(c, x - rr * 0.08, y - rr * 0.1, rr * 0.82, P.glow);
  // The weave's own form turns inside the sphere.
  form(L)(R, b, L, x, y, rr * 0.42, b.age * 3, t);
  c.globalAlpha = fade;
  for (let i = 0; i < 3; i++) {
    const a = b.age * 4 + (i / 3) * TAU;
    px(c, x + Math.cos(a) * rr * 0.65, y + Math.sin(a) * rr * 0.5, i ? P.spark : L.accent);
  }
  disc(c, x - rr * 0.38, y - rr * 0.42, Math.max(1, rr * 0.22), P.core);
  // The pulse: a ring on the ground growing to the pulse radius.
  if (b.tick > 0) {
    const k = 1 - Math.max(0, b.tickT) / b.tick;
    c.globalAlpha = 0.45 * (1 - k) * fade;
    ring(c, x, b.y - R.oy, b.pulseR * k, P.glow, 1, 0.6);
  }
  c.globalAlpha = 1;
  const g = R.g;
  if (g) {
    // A glowing rim and a soft halo: the sphere's inside (its turning form) stays legible.
    g.globalAlpha = fade;
    halo(g, x, y, rr * 3, L.halo, 0.36, R.bounds);
    g.globalAlpha = 0.8 * fade;
    ring(g, x, y, rr, P.glow, 1, 1);
    px(g, x - rr * 0.38, y - rr * 0.42, P.core);
    g.globalAlpha = 1;
  }
}

// A lobbed bomb: the form, tumbling, high on its arc (shadow and reticle: ground pass).
function drawLob(R, b, L) {
  const x = b.x - R.ox;
  const y = b.y - R.oy - b.z;
  const r = Math.max(2.5, b.r);
  form(L)(R, b, L, x, y, r, b.angle, R.time);
  // A spark of a fuse riding on top as it tumbles.
  px(R.ctx, x + Math.cos(b.angle) * r, y + Math.sin(b.angle) * r, L.pal.core);
}

// A falling drop of a rain weave, by look.
function drawFall(R, b, L) {
  const x = Math.round(b.x - R.ox);
  const zy = b.y - R.oy - b.z;
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const r = Math.max(1.5, b.r);
  switch (L.look.fall) {
    case 'meteor': {
      line(c, x + 4, zy - 12, x, zy, P.deep, 3);
      line(c, x + 3, zy - 9, x, zy, P.glow, 2);
      disc(c, x, zy, r, P.glow);
      px(c, x, zy, P.core);
      if (g) {
        halo(g, x, zy, r * 4, L.halo, 0.6, R.bounds);
        line(g, x + 3, zy - 9, x, zy, P.spark, 1);
      }
      break;
    }
    case 'rain':
    case 'acid': {
      line(c, x, zy - 9, x, zy, P.glow, 1);
      rect(c, x, zy - 1, 1, 2, P.core);
      if (g) line(g, x, zy - 6, x, zy, P.spark, 1);
      break;
    }
    case 'icicle': {
      PTS[0] = x - 1.5;
      PTS[1] = zy - 8;
      PTS[2] = x + 1.5;
      PTS[3] = zy - 8;
      PTS[4] = x;
      PTS[5] = zy + 1;
      poly(c, PTS, 3, P.glow);
      line(c, x, zy - 7, x, zy, P.core, 1);
      if (g) {
        halo(g, x, zy - 3, 6, L.halo, 0.35, R.bounds);
        px(g, x, zy, '#ffffff');
      }
      break;
    }
    case 'bolt': {
      const seed = b.uid * 13 + Math.floor(R.time * 30);
      zig(c, x + (hash(b.uid, 1) - 0.5) * 6, zy - 22, x, zy, 4, 2, seed, P.glow, 1);
      disc(c, x, zy, r * 0.8, P.core);
      if (g) {
        zig(g, x + (hash(b.uid, 1) - 0.5) * 6, zy - 22, x, zy, 4, 2, seed, P.core, 1);
        halo(g, x, zy, 10, L.halo, 0.6, R.bounds);
      }
      break;
    }
    case 'rock': {
      disc(c, x, zy, r + 0.5, P.deep);
      disc(c, x - 0.5, zy - 0.5, r * 0.7, P.glow);
      px(c, x - 1, zy - 1, P.core);
      c.globalAlpha = 0.4;
      line(c, x, zy - 2, x, zy - 8, P.spark, 1);
      c.globalAlpha = 1;
      break;
    }
    case 'gust': {
      c.globalAlpha = 0.7;
      ring(c, x, zy - 3, 3, P.core, 1, 0.5, R.time * 12, R.time * 12 + 4);
      line(c, x - 1, zy - 10, x, zy, P.spark, 1);
      c.globalAlpha = 1;
      break;
    }
    case 'thorn': {
      line(c, x, zy - 6, x, zy, P.deep, 2);
      px(c, x, zy, P.glow);
      px(c, x - 1, zy - 4, P.glow);
      break;
    }
    case 'ray': {
      c.globalAlpha = 0.55;
      line(c, x, zy - 40, x, zy, P.glow, 2);
      c.globalAlpha = 1;
      line(c, x, zy - 14, x, zy, P.core, 1);
      if (g) {
        g.globalAlpha = 0.7;
        line(g, x, zy - 40, x, zy, P.spark, 2);
        g.globalAlpha = 1;
        halo(g, x, zy, 7, L.halo, 0.6, R.bounds);
      }
      break;
    }
    case 'spear': {
      line(c, x, zy - 11, x, zy, DARK_CORE, 2);
      line(c, x + 1, zy - 10, x + 1, zy - 1, P.glow, 1);
      px(c, x, zy + 1, P.spark);
      if (g) px(g, x, zy + 1, P.spark);
      break;
    }
    case 'blade': {
      line(c, x, zy - 9, x, zy, P.glow, 1);
      line(c, x - 2, zy - 7, x + 2, zy - 7, P.deep, 1);
      px(c, x, zy, P.core);
      if (g && (b.uid + Math.floor(R.time * 10)) % 3 === 0) px(g, x, zy - 4, '#ffffff');
      break;
    }
    case 'note': {
      rect(c, x, zy - 4, 1, 4, P.glow);
      rect(c, x - 2, zy, 2, 2, P.glow);
      px(c, x + 1, zy - 4, P.core);
      if (g) halo(g, x, zy - 2, 6, L.halo, 0.4, R.bounds);
      break;
    }
    default: {
      line(c, x, zy - 7, x, zy, P.glow, 1);
      disc(c, x, zy, r * 0.7, P.core);
      if (g) halo(g, x, zy, 6, L.halo, 0.4, R.bounds);
    }
  }
}

// A chain arc: lightning from where it leapt to where it is now.
function drawArc(R, b, L, fs) {
  const P = L.pal;
  const x = b.x - R.ox;
  const y = b.y - R.oy - b.z;
  const sx = (fs ? fs.sx : b.x) - R.ox;
  const sy = (fs ? fs.sy : b.y) - R.oy - 6;
  const seed = b.uid * 7 + Math.floor(R.time * 40);
  const d = Math.hypot(x - sx, y - sy);
  const segs = Math.max(2, Math.round(d / 7));
  R.ctx.globalAlpha = 0.6;
  zig(R.ctx, sx, sy, x, y, segs, 3, seed + 1, P.glow, 2);
  R.ctx.globalAlpha = 1;
  zig(R.ctx, sx, sy, x, y, segs, 3, seed, P.core, 1);
  disc(R.ctx, x, y, 1.5, P.core);
  if (R.g) {
    zig(R.g, sx, sy, x, y, segs, 3, seed, P.spark, 1);
    halo(R.g, x, y, 8, L.halo, 0.7, R.bounds);
    R.bounds.add(sx, sy, 4);
  }
}

function drawProjectile(R, b, L, fs) {
  switch (b.mode) {
    case 'fall':
      return drawFall(R, b, L);
    case 'lob':
      return drawLob(R, b, L);
    case 'arc':
      return drawArc(R, b, L, fs);
    case 'orb':
      return drawOrb(R, b, L);
    default:
      return drawMissile(R, b, L, fs);
  }
}

// ================================================================== areas

// Little things riding a ring's (or a cone's) edge, by look. a0..a1 limits a cone.
function edgeDeco(R, b, L, x, y, r, squash, a, a0, a1) {
  const kind = L.look.ring;
  const P = L.pal;
  const c = R.ctx;
  const span = a1 - a0;
  const n = Math.max(6, Math.min(26, Math.round((r * span) / 6)));
  const t = R.time;
  c.globalAlpha = a;
  for (let i = 0; i < n; i++) {
    const ang = a0 + ((i + 0.5) / n) * span + b.seed;
    const ex = x + Math.cos(ang) * r;
    const ey = y + Math.sin(ang) * r * squash;
    const h = hash(b.uid, i);
    switch (kind) {
      case 'flames': {
        const hh = 2 + Math.round(3 * flicker(t, h * 9) * (1 - b.age / b.life));
        rect(c, ex, ey - hh, 1, hh, P.spark);
        px(c, ex, ey - hh - 1, P.core);
        break;
      }
      case 'spikes': {
        const hh = 3 + Math.round(h * 3);
        PTS[0] = ex - 1;
        PTS[1] = ey;
        PTS[2] = ex + 1;
        PTS[3] = ey;
        PTS[4] = ex + Math.cos(ang) * 1.5;
        PTS[5] = ey - hh;
        poly(c, PTS, 3, P.glow);
        px(c, ex, ey - hh + 1, P.core);
        break;
      }
      case 'rocks':
        disc(c, ex, ey - 1, 1 + h * 1.5, i & 1 ? P.glow : P.deep);
        break;
      case 'foam':
        px(c, ex, ey - 1, P.core);
        px(c, ex + 1, ey - 2, P.spark);
        break;
      case 'zigs':
        if (h > 0.4) zig(c, ex, ey - 1, ex + Math.cos(ang + 1.3) * 5, ey + Math.sin(ang + 1.3) * 4 - 1, 2, 1.5, b.uid + i + Math.floor(t * 24), P.core, 1);
        break;
      case 'rays':
        line(c, ex, ey, ex + Math.cos(ang) * 4, ey + Math.sin(ang) * 3, P.core, 1);
        break;
      case 'smoke':
        disc(c, ex, ey - 1, 1.5 + h, DARK_CORE);
        if (h > 0.7) px(c, ex, ey - 2, P.glow);
        break;
      case 'bubbles':
        if (h > 0.3) ring(c, ex, ey - 2 - h * 3, 1.2, P.spark, 1, 1);
        break;
      case 'leaves':
        rect(c, ex, ey - 1, 2, 1, i & 1 ? P.glow : P.deep);
        break;
      case 'swirl':
        line(c, ex, ey, ex + Math.cos(ang + 1.57) * 4, ey + Math.sin(ang + 1.57) * 3, P.core, 1);
        break;
      case 'blades': {
        const s = t * 20 + i;
        line(c, ex - Math.cos(s) * 2, ey - Math.sin(s) * 2, ex + Math.cos(s) * 2, ey + Math.sin(s) * 2, P.glow, 1);
        break;
      }
      case 'echo':
        break;
      default:
        px(c, ex, ey - 1, i & 1 ? P.core : P.spark);
    }
  }
  if (kind === 'echo') {
    // Song: the ring rings — fainter copies inside it.
    for (let k = 1; k <= 2; k++) {
      c.globalAlpha = a * (0.5 / k);
      ring(c, x, y, r * (1 - k * 0.18), P.spark, 1, squash, a0, a1);
    }
  }
  c.globalAlpha = 1;
}

function drawRing(R, b, L) {
  const P = L.pal;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const k = k01(b.age / Math.max(0.01, b.life));
  const a = 1 - k * k;
  const r = Math.max(1, b.cur);
  const c = R.ctx;
  const dark = L.look.dark;
  c.globalAlpha = 0.16 * a;
  ell(c, x, y, r, r * 0.62, dark ? DARK_CORE : P.glow);
  c.globalAlpha = 0.75 * a;
  ring(c, x, y, r * 0.93, dark ? DARK_CORE : P.deep, 3, 0.62);
  ring(c, x, y, r, P.glow, 2, 0.62);
  c.globalAlpha = a;
  ring(c, x, y, r + 1, P.core, 1, 0.62);
  if (L.multi) {
    c.globalAlpha = 0.6 * a;
    ring(c, x, y, r * 0.8, L.accent, 1, 0.62);
  }
  edgeDeco(R, b, L, x, y, r, 0.62, a, 0, TAU);
  const g = R.g;
  if (g) {
    g.globalAlpha = a;
    ring(g, x, y, r, P.glow, 2, 0.62);
    ring(g, x, y, r + 1, P.core, 1, 0.62);
    g.globalAlpha = 1;
    halo(g, x, y - 4, Math.max(16, r * 0.8), L.halo, 0.25 * a, R.bounds);
    R.bounds.add(x, y, r + 4);
  }
}

function drawCone(R, b, L) {
  const P = L.pal;
  const x = b.x - R.ox;
  const y = b.y - R.oy - 4;
  const k = k01(b.age / Math.max(0.01, b.life));
  const a = 1 - k * k;
  const r = Math.max(2, b.cur);
  const ang = b.angle;
  const arc = b.arc || 0.6;
  const c = R.ctx;
  const dark = L.look.dark;
  c.globalAlpha = 0.4 * a;
  wedge(c, x, y, r, ang, arc, dark ? DARK_CORE : P.deep);
  c.globalAlpha = 0.5 * a;
  wedge(c, x, y, r * 0.88, ang, arc * 0.92, P.glow);
  c.globalAlpha = 0.6 * a;
  wedge(c, x, y, r * 0.5, ang, arc * 0.7, P.spark);
  // Streaks fanning out from the hands.
  c.globalAlpha = 0.8 * a;
  for (let i = 0; i < 5; i++) {
    const aa = ang + (i / 4 - 0.5) * arc * 1.6 + (hash(b.uid, i, Math.floor(R.time * 20)) - 0.5) * 0.12;
    const l0 = r * 0.25;
    const l1 = r * (0.7 + hash(b.uid, i) * 0.3);
    line(c, x + Math.cos(aa) * l0, y + Math.sin(aa) * l0 * 0.75, x + Math.cos(aa) * l1, y + Math.sin(aa) * l1 * 0.75, i & 1 ? P.core : P.spark, 1);
  }
  c.globalAlpha = a;
  ring(c, x, y, r, P.core, 1, 0.75, ang - arc, ang + arc);
  edgeDeco(R, b, L, x, y, r, 0.75, a, ang - arc, ang + arc);
  const g = R.g;
  if (g) {
    g.globalAlpha = 0.35 * a;
    wedge(g, x, y, r * 0.8, ang, arc * 0.9, P.glow);
    g.globalAlpha = a;
    ring(g, x, y, r, P.core, 1, 0.75, ang - arc, ang + arc);
    g.globalAlpha = 1;
    R.bounds.add(x, y, r + 4);
  }
}

// An explosion: a brief flash, then a boiling cluster of shaded puffs in the essence's
// colors (a hole of night for dark), the second essence's color in their hearts, and a
// shock ring along the ground carrying the essence's edge (flames, spikes, rocks…).
const PUFFS = 7;
function drawBurst(R, b, L) {
  const P = L.pal;
  const x = b.x - R.ox;
  const y = b.y - R.oy - 3;
  const k = k01(b.age / Math.max(0.01, b.life));
  const a = 1 - k;
  const r = Math.max(3, b.r1);
  const c = R.ctx;
  const dark = L.look.dark;
  const body = dark ? DARK_CORE : P.deep;
  const mid = dark ? P.deep : P.glow;
  const hi = dark ? P.glow : P.spark;
  // The shock ring first (on the ground), so the puffs boil over it.
  const rr = r * (0.5 + 0.55 * Math.sqrt(k));
  c.globalAlpha = 0.5 * a;
  ring(c, x, y + 3, rr, body, 2, 0.62);
  c.globalAlpha = a;
  ring(c, x, y + 3, rr, P.core, 1, 0.62);
  edgeDeco(R, b, L, x, y + 3, rr, 0.62, a * 0.9, 0, TAU);
  // A flash for the first few frames only: hot, small, gone fast.
  if (k < 0.16) {
    c.globalAlpha = 1 - k / 0.16;
    disc(c, x, y, r * (0.22 + k * 1.4), L.hot);
  }
  // The puffs: each drifts out and up, swells, then shrinks away; shaded dark under,
  // mid in the body, a highlight to the upper left, the accent in the newest hearts.
  const spread = r * (0.12 + 0.42 * Math.sqrt(k));
  const lift = k * r * 0.35;
  const swell = k < 0.35 ? 0.55 + k * 1.3 : 1 - (k - 0.35) * 1.15;
  for (let i = 0; i < PUFFS; i++) {
    const h = hash(b.uid, i, 11);
    const an = (i / PUFFS) * TAU + h * 0.9 + b.seed * 3;
    const d = spread * (i === 0 ? 0.15 : 0.7 + h * 0.5);
    const px0 = x + Math.cos(an) * d;
    const py0 = y + Math.sin(an) * d * 0.62 - lift * (0.6 + h * 0.8);
    const pr = Math.max(1, r * (i === 0 ? 0.36 : 0.2 + h * 0.12) * swell);
    c.globalAlpha = Math.min(1, a * 1.4);
    disc(c, px0, py0 + 1, pr + 0.6, body);
    disc(c, px0 - pr * 0.12, py0 - pr * 0.1, pr * 0.82, mid);
    if (k < 0.7) {
      c.globalAlpha = Math.min(1, a * 1.6);
      disc(c, px0 - pr * 0.32, py0 - pr * 0.35, pr * 0.42, hi);
    }
    if (L.multi && k < 0.5 && i % 2 === 0) {
      c.globalAlpha = 0.85 * (1 - k * 2);
      disc(c, px0 + pr * 0.15, py0 + pr * 0.1, pr * 0.3, L.accent);
    }
  }
  c.globalAlpha = 1;
  const g = R.g;
  if (g) {
    halo(g, x, y, r * (0.9 + 0.8 * k), L.halo, 0.7 * a, R.bounds);
    if (k < 0.2) {
      g.globalAlpha = 1 - k / 0.2;
      disc(g, x, y, r * (0.18 + k), P.core);
    }
    g.globalAlpha = a;
    ring(g, x, y + 3, rr, P.spark, 1, 0.62);
    if (!dark && k < 0.6) {
      g.globalAlpha = 0.6 * (1 - k / 0.6);
      disc(g, x - r * 0.1, y - lift - r * 0.1, r * 0.22 * swell, P.spark);
    }
    g.globalAlpha = 1;
    R.bounds.add(x, y, r + 4);
  }
}

function drawArea(R, b, L) {
  switch (b.mode) {
    case 'ring':
      return drawRing(R, b, L);
    case 'cone':
      return drawCone(R, b, L);
    case 'burst':
      return drawBurst(R, b, L);
    case 'patch':
      return drawPatchTop(R, b, L);
    default:
      return undefined; // rain: its zone is on the ground, its drops are bodies
  }
}

// ================================================================== strike

function drawStrike(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const k = k01(b.age / Math.max(0.01, b.life));
  const ang = b.angle;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const fx = x + ux * (b.r * 1.1 + k * 4);
  const fy = y - 8 + uy * b.r * 0.8;
  // The impact wave: crescent arcs rolling out in the punch's cone.
  const arc = b.arc || 0.8;
  for (let i = 0; i < 3; i++) {
    const rr = b.cur * (1 - i * 0.2);
    if (rr < 3) continue;
    c.globalAlpha = (1 - k) * (i === 0 ? 0.95 : 0.5 - i * 0.12);
    ring(c, x, y - 5, rr, i === 0 ? P.core : P.glow, i === 0 ? 2 : 1, 0.7, ang - arc * (1 - i * 0.15), ang + arc * (1 - i * 0.15));
  }
  // The flash at the knuckles first, then the fist over it (so the fist reads), with
  // speed lines behind it; the fist holds a moment, then fades.
  if (k < 0.3) {
    const s = (1 - k / 0.3) * b.r * 1.2;
    c.globalAlpha = 0.85;
    line(c, fx + ux * 6 - s, fy, fx + ux * 6 + s, fy, P.core, 1);
    line(c, fx + ux * 6, fy - s * 0.8, fx + ux * 6, fy + s * 0.8, P.core, 1);
  }
  if (k < 0.65) {
    const fa = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.25;
    c.globalAlpha = fa;
    for (let i = -1; i <= 1; i++) {
      const ox = -uy * i * 3;
      const oy = ux * i * 3;
      line(c, fx - ux * 6 + ox, fy - uy * 5 + oy, fx - ux * 13 + ox, fy - uy * 10 + oy, i ? P.glow : P.spark, 1);
    }
    const s = fistSprite(P);
    c.save();
    c.translate(Math.round(fx), Math.round(fy));
    const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(snapped) > Math.PI / 2) {
      c.scale(-1, 1);
      c.rotate(Math.PI - snapped);
    } else c.rotate(snapped);
    c.drawImage(s, -6, -5);
    c.restore();
  }
  c.globalAlpha = 1;
  const g = R.g;
  if (g) {
    if (k < 0.4) halo(g, fx + ux * 3, fy, b.r * 2.2, L.halo, 0.55 * (1 - k / 0.4), R.bounds);
    g.globalAlpha = 1 - k;
    ring(g, x, y - 5, b.cur, P.core, 1, 0.7, ang - arc, ang + arc);
    g.globalAlpha = 1;
    R.bounds.add(x, y, b.cur + 4);
  }
}

// ================================================================== beam

const BEAM = new Float32Array(400);

// Points along the beam's polyline every ~6 px, displaced per style.
function beamPoints(b, R, style, amp) {
  const ox = R.ox;
  const oy = R.oy + 8;
  const t = R.time;
  let n = 0;
  let dist = 0;
  for (let s = 0; s < b.npts - 1; s++) {
    const x1 = b.pts[s * 2] - ox;
    const y1 = b.pts[s * 2 + 1] - oy;
    const x2 = b.pts[s * 2 + 2] - ox;
    const y2 = b.pts[s * 2 + 3] - oy;
    const l = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(l / 6));
    const nx = l > 0 ? -(y2 - y1) / l : 0;
    const ny = l > 0 ? (x2 - x1) / l : 0;
    for (let i = s === 0 ? 0 : 1; i <= steps && n < 198; i++) {
      const k = i / steps;
      const d = dist + l * k;
      let o = 0;
      if (style === 'lightning') o = (hash(b.uid, Math.floor(d / 6), Math.floor(t * 30)) * 2 - 1) * amp;
      else if (style === 'stream' || style === 'wave' || style === 'vine') o = Math.sin(d * 0.35 - t * 18) * amp;
      else if (amp > 0) o = (hash(b.uid, Math.floor(d / 6), Math.floor(t * 20)) * 2 - 1) * amp;
      // Pinned at both ends.
      const pin = Math.min(1, d / 10);
      BEAM[n * 2] = x1 + (x2 - x1) * k + nx * o * pin;
      BEAM[n * 2 + 1] = y1 + (y2 - y1) * k + ny * o * pin;
      n++;
    }
    dist += l;
  }
  return n;
}

function strokeBeam(ctx, n, color, width, from = 0, step = 1, phase = 0, wave = 0) {
  if (n < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = from; i < n; i += step) {
    let x = BEAM[i * 2];
    let y = BEAM[i * 2 + 1];
    if (wave) {
      const j = Math.min(n - 1, i + 1);
      const dx = BEAM[j * 2] - BEAM[Math.max(0, j - 1) * 2];
      const dy = BEAM[j * 2 + 1] - BEAM[Math.max(0, j - 1) * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      const o = Math.sin(i * 0.9 + phase) * wave * Math.min(1, i / 2);
      x += (-dy / l) * o;
      y += (dx / l) * o;
    }
    if (i === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const BEAM_AMP = { lightning: 3.2, flame: 1.2, stream: 1.6, crystal: 0, sand: 1, spiral: 0, vine: 1.2, acid: 0.8, ray: 0, void: 0.4, chain: 0, wave: 1.8, arcane: 0.5 };

function drawBeam(R, b, L) {
  if (b.npts < 2) return;
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const style = L.look.beam;
  const t = R.time;
  const fade = k01(Math.min((b.life - b.age) / 0.12, b.age / 0.05));
  const flick = 0.85 + 0.15 * Math.sin(t * 40 + b.seed * 9);
  const amp = BEAM_AMP[style] ?? 0.6;
  const n = beamPoints(b, R, style, amp);
  if (n < 2) return;
  const w = Math.max(1, b.r);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const dark = style === 'void';
  // Body: a dark rim, the glow, then the core.
  c.globalAlpha = 0.55 * fade;
  strokeBeam(c, n, dark ? DARK_CORE : P.deep, (w * 2 + 3) * flick);
  c.globalAlpha = 0.9 * fade;
  strokeBeam(c, n, P.glow, Math.max(1, w * 1.3 * flick));
  c.globalAlpha = fade;
  strokeBeam(c, n, dark ? DARK_CORE : P.core, Math.max(1, w * 0.5));
  // Style details.
  switch (style) {
    case 'lightning':
      c.globalAlpha = 0.8 * fade;
      strokeBeam(c, n, P.spark, 1, 0, 1, t * 50, 2.5);
      strokeBeam(c, n, P.core, 1, 1, 2, t * 37 + 2, 3.5);
      break;
    case 'stream':
    case 'wave':
      c.globalAlpha = 0.85 * fade;
      strokeBeam(c, n, P.core, 1, 0, 1, -t * 16, w + 1);
      strokeBeam(c, n, P.spark, 1, 0, 1, -t * 16 + Math.PI, w + 1);
      break;
    case 'spiral':
      c.globalAlpha = 0.8 * fade;
      strokeBeam(c, n, P.core, 1, 0, 1, -t * 22, w + 2);
      strokeBeam(c, n, P.spark, 1, 0, 1, -t * 22 + Math.PI, w + 2);
      break;
    case 'crystal':
      for (let i = 2; i < n; i += 3) {
        const x = BEAM[i * 2];
        const y = BEAM[i * 2 + 1];
        c.globalAlpha = fade;
        rect(c, x - 1, y - 2, 2, 4, P.glow);
        px(c, x, y - 2, '#ffffff');
      }
      break;
    case 'flame':
      for (let i = 1; i < n; i++) {
        const x = BEAM[i * 2];
        const y = BEAM[i * 2 + 1];
        const hh = 1 + Math.round(3 * flicker(t, i * 0.37 + b.seed));
        c.globalAlpha = fade;
        rect(c, x, y - w - hh, 1, hh, i & 1 ? P.spark : P.glow);
      }
      break;
    case 'vine':
      for (let i = 2; i < n; i += 3) {
        const x = BEAM[i * 2];
        const y = BEAM[i * 2 + 1];
        c.globalAlpha = fade;
        rect(c, x, y - w - 1, 2, 1, i & 2 ? P.spark : P.deep);
      }
      break;
    case 'chain':
      for (let i = 0; i < n; i += 2) {
        const x = BEAM[i * 2];
        const y = BEAM[i * 2 + 1];
        c.globalAlpha = fade;
        rect(c, x - 1, y - 1, 3, 2, (i >> 1) & 1 ? P.deep : P.glow);
      }
      break;
    case 'sand':
      for (let i = 1; i < n; i++) {
        const h = hash(b.uid, i, Math.floor(t * 18));
        c.globalAlpha = fade;
        px(c, BEAM[i * 2] + (h - 0.5) * 4, BEAM[i * 2 + 1] + (hash(i, h * 9) - 0.5) * 4, h > 0.5 ? P.glow : P.deep);
      }
      break;
    case 'ray':
      c.globalAlpha = 0.3 * fade;
      strokeBeam(c, n, P.spark, (w * 3 + 4) * flick);
      break;
    case 'void':
      c.globalAlpha = fade;
      strokeBeam(c, n, P.glow, 1, 0, 1, t * 12, w + 1);
      break;
    default:
      break;
  }
  // The end flare and the hands' glow.
  const ex = BEAM[(n - 1) * 2];
  const ey = BEAM[(n - 1) * 2 + 1];
  c.globalAlpha = fade;
  disc(c, ex, ey, w * 1.8 * flick, P.glow);
  disc(c, ex, ey, w * 1.1 * flick, dark ? DARK_CORE : P.core);
  disc(c, BEAM[0], BEAM[1], w * 1.2, P.spark);
  c.globalAlpha = 1;
  c.lineCap = 'butt';
  c.lineJoin = 'miter';
  if (g) {
    g.lineCap = 'round';
    g.globalAlpha = 0.7 * fade;
    strokeBeam(g, n, P.glow, Math.max(1, w * 1.4 * flick));
    g.globalAlpha = fade;
    strokeBeam(g, n, dark ? P.spark : P.core, Math.max(1, w * 0.5));
    g.globalAlpha = 1;
    g.lineCap = 'butt';
    halo(g, ex, ey, w * 6 * flick, L.halo, 0.85 * fade, R.bounds);
    halo(g, BEAM[0], BEAM[1], w * 4, L.halo, 0.6 * fade, R.bounds);
    for (let i = 0; i < n; i += 6) R.bounds.add(BEAM[i * 2], BEAM[i * 2 + 1], w * 3);
  }
}

// ================================================================== walls

function drawWall(R, b, L) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const t = R.time;
  const fade = k01(Math.min((b.life - b.age) / 0.45, 1));
  const rise = k01(b.age / 0.2);
  const ax = b.ox - R.ox;
  const ay = b.oy - R.oy;
  const bx = b.x2 - R.ox;
  const by = b.y2 - R.oy;
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(3, Math.round(len / 3));
  const style = L.look.wall;
  const base = 7 + b.r * 1.4;
  // Back to front so lower (nearer) columns cover the ones behind.
  const rev = by < ay;
  c.globalAlpha = fade;
  for (let jj = 0; jj <= n; jj++) {
    const j = rev ? n - jj : jj;
    const k = j / n;
    const x = Math.round(ax + (bx - ax) * k);
    const y = Math.round(ay + (by - ay) * k);
    const h0 = hash(b.uid, j);
    const end = Math.min(j, n - j);
    const taper = end < 2 ? 0.65 + end * 0.15 : 1;
    let hh = Math.max(2, Math.round((base + h0 * 4) * rise * taper));
    switch (style) {
      case 'flame': {
        hh = Math.max(2, Math.round((base - 1 + 5 * flicker(t, h0 * 13)) * rise * taper));
        rect(c, x - 1, y - hh, 3, hh, P.deep);
        rect(c, x, y - hh + 1, 1, hh - 1, P.glow);
        rect(c, x, y - hh + 1, 1, Math.max(1, hh >> 1), P.spark);
        px(c, x, y - hh, P.core);
        if (g) {
          rect(g, x, y - hh, 1, Math.max(1, hh >> 1), P.spark);
          if (j % (R.lod ? 8 : 4) === 0) halo(g, x, y - hh * 0.5, 7, L.halo, 0.35, R.bounds);
        }
        break;
      }
      case 'water': {
        rect(c, x - 1, y - hh, 3, hh, P.deep);
        for (let yy = 0; yy < hh; yy++) if (((yy + Math.floor(t * 24) + j * 2) & 3) === 0) px(c, x, y - hh + yy, P.spark);
        px(c, x, y - hh, P.core);
        if (j & 1) px(c, x - 1, y - hh - 1, P.core);
        break;
      }
      case 'ice':
      case 'arcane': {
        hh = Math.max(2, Math.round((base + 3 + h0 * 7) * rise * taper));
        c.globalAlpha = 0.85 * fade;
        rect(c, x - 1, y - hh + 2, 3, hh - 2, P.glow);
        rect(c, x, y - hh, 1, 2, P.glow);
        c.globalAlpha = fade;
        rect(c, x - 1, y - hh + 2, 1, hh - 3, P.core);
        rect(c, x + 1, y - hh + 3, 1, hh - 3, P.deep);
        if (g && (j + Math.floor(t * 3)) % 7 === 0) px(g, x - 1, y - hh + 3, '#ffffff');
        break;
      }
      case 'storm': {
        if (j % 4 === 0) {
          rect(c, x - 1, y - hh, 2, hh, P.deep);
          px(c, x, y - hh - 1, P.core);
          if (g) halo(g, x, y - hh, 5, L.halo, 0.5, R.bounds);
        }
        break;
      }
      case 'stone': {
        const blockH = Math.max(2, Math.round((base + 1 + (hash(b.uid, j >> 1) * 4)) * rise * taper));
        rect(c, x - 1, y - blockH, 3, blockH, P.deep);
        rect(c, x, y - blockH + 1, 2, blockH - 2, P.glow);
        if ((j & 1) === 0) rect(c, x - 1, y - blockH, 1, blockH, L.outline);
        px(c, x, y - blockH, P.core);
        if (((j >> 1) & 1) === 0) rect(c, x, y - (blockH >> 1), 2, 1, P.deep);
        break;
      }
      case 'wind': {
        c.globalAlpha = 0.5 * fade;
        for (let yy = 0; yy < hh; yy += 2) {
          const o = Math.round(Math.sin(t * 10 + yy * 0.6 + j) * 1.2);
          if (((yy + Math.floor(t * 30) + j) & 3) < 2) px(c, x + o, y - yy, yy > hh - 3 ? P.core : P.spark);
        }
        c.globalAlpha = fade;
        break;
      }
      case 'thorns': {
        hh = Math.max(2, Math.round((base - 2 + h0 * 4) * rise * taper));
        const o = Math.round(Math.sin(j * 1.3) * 1.5);
        rect(c, x, y - hh, 1, hh, P.deep);
        rect(c, x + o, y - hh + 2, 1, hh - 3, '#2f5a2a');
        if (h0 > 0.55) px(c, x + 1, y - hh + 2, P.core);
        if (h0 < 0.25) px(c, x - 1, y - (hh >> 1), P.glow);
        if (h0 > 0.85) px(c, x, y - hh - 1, L.accent);
        break;
      }
      case 'poison': {
        if (j % 2 === 0) {
          const bob = Math.sin(t * 4 + j) * 1.5;
          c.globalAlpha = 0.55 * fade;
          disc(c, x, y - hh * 0.5 + bob, 2.5 + h0 * 1.5, P.glow);
          c.globalAlpha = 0.8 * fade;
          disc(c, x, y - 2, 2, P.deep);
          c.globalAlpha = fade;
          if (h0 > 0.6) ring(c, x + 1, y - hh + ((t * 8 + h0 * 9) % hh), 1, P.spark, 1, 1);
        }
        break;
      }
      case 'light': {
        const a = 0.35 + 0.3 * Math.sin(t * 6 + j * 0.8);
        c.globalAlpha = a * fade;
        rect(c, x, y - hh - 2, 1, hh + 2, j & 1 ? P.spark : P.core);
        c.globalAlpha = fade;
        if (g) {
          g.globalAlpha = a * fade;
          rect(g, x, y - hh - 2, 1, hh + 2, P.core);
          g.globalAlpha = 1;
        }
        break;
      }
      case 'shadow': {
        const o = Math.sin(t * 3 + j * 0.7) * 1.5;
        c.globalAlpha = 0.85 * fade;
        disc(c, x + o, y - hh * 0.6, 2.2, DARK_CORE);
        disc(c, x - o * 0.5, y - 2, 2, P.deep);
        c.globalAlpha = fade;
        if (h0 > 0.8) px(c, x + o, y - hh, P.glow);
        break;
      }
      case 'iron': {
        rect(c, x - 1, y - hh + 2, 2, hh - 2, P.deep);
        rect(c, x, y - hh + 2, 1, hh - 3, P.glow);
        px(c, x, y - hh + 1, P.core);
        px(c, x, y - hh, P.glow);
        if (j % 3 === 0) px(c, x - 1, y - 3, P.spark);
        if (g && (j + Math.floor(t * 4)) % 9 === 0) px(g, x, y - hh + 2, '#ffffff');
        break;
      }
      case 'song': {
        if (j % 2 === 0) {
          const o = Math.round(Math.sin(t * 40 + j) * 0.6);
          rect(c, x + o, y - hh, 1, hh, P.glow);
          if (g) {
            g.globalAlpha = 0.6;
            rect(g, x + o, y - hh, 1, hh, P.spark);
            g.globalAlpha = 1;
          }
        }
        break;
      }
      default:
        rect(c, x - 1, y - hh, 3, hh, P.glow);
    }
  }
  // Top and bottom rails, lightning between posts.
  if (style === 'storm') {
    const seed = b.uid * 3 + Math.floor(t * 24);
    const lift = (base + 1) * rise;
    c.globalAlpha = fade;
    zig(c, ax, ay - lift * 0.7, bx, by - lift * 0.7, Math.max(3, Math.round(len / 6)), 2.2, seed, P.core, 1);
    zig(c, ax, ay - lift * 0.35, bx, by - lift * 0.35, Math.max(3, Math.round(len / 6)), 2.2, seed + 9, P.glow, 1);
    if (g) zig(g, ax, ay - lift * 0.7, bx, by - lift * 0.7, Math.max(3, Math.round(len / 6)), 2.2, seed, P.spark, 1);
  } else if (style === 'song') {
    const lift = (base + 2) * rise;
    c.globalAlpha = fade;
    line(c, ax, ay - lift, bx, by - lift, P.deep, 1);
    line(c, ax, ay, bx, by, P.deep, 1);
  } else if (style === 'light' && g) {
    halo(g, (ax + bx) / 2, (ay + by) / 2 - 8, len * 0.55, L.halo, 0.35 * fade, R.bounds);
  }
  if (L.multi && style !== 'storm') {
    c.globalAlpha = 0.5 * fade;
    line(c, ax, ay - 1, bx, by - 1, L.accent, 1);
  }
  c.globalAlpha = 1;
  if (g) {
    R.bounds.add(ax, ay - 10, 10);
    R.bounds.add(bx, by - 10, 10);
  }
}

// ================================================================== patches (ground)

// A lingering patch of an essence at (x, y) (screen), radius r, alpha a. Used by the
// linger twist's patches, dash trails and terrain marks.
export function drawPatch(R, style, P, L, x, y, r, a, seed, t) {
  const c = R.ctx;
  const g = R.g;
  const ry = r * 0.6;
  c.globalAlpha = a;
  switch (style) {
    case 'embers': {
      c.globalAlpha = 0.45 * a;
      ell(c, x, y, r, ry, '#1c1418');
      c.globalAlpha = 0.5 * a;
      ell(c, x, y, r * 0.65, ry * 0.65, P.deep);
      c.globalAlpha = a;
      for (let i = 0; i < 6; i++) {
        const an = seed * 9 + i * 1.1;
        const rr = r * (0.2 + hash(seed * 99, i) * 0.6);
        const ex = x + Math.cos(an) * rr;
        const ey = y + Math.sin(an) * rr * 0.6;
        if (flicker(t, seed + i) > 0.35) px(c, ex, ey, i & 1 ? P.spark : P.glow);
        if (g && i < 3) px(g, ex, ey, P.spark);
      }
      if (g) halo(g, x, y - 2, r * 1.2, L.halo, 0.22 * a, R.bounds);
      break;
    }
    case 'puddle': {
      c.globalAlpha = 0.5 * a;
      ell(c, x, y, r, ry, P.deep);
      c.globalAlpha = 0.45 * a;
      ell(c, x - r * 0.1, y - 0.5, r * 0.75, ry * 0.7, P.glow);
      const k = (t * 0.8 + seed) % 1;
      c.globalAlpha = 0.6 * a * (1 - k);
      ring(c, x + (seed - 0.5) * r * 0.4, y, r * 0.2 + k * r * 0.6, P.spark, 1, 0.55);
      c.globalAlpha = 0.8 * a;
      rect(c, x - r * 0.4, y - ry * 0.3, 2, 1, P.core);
      break;
    }
    case 'glaze': {
      c.globalAlpha = 0.4 * a;
      ell(c, x, y, r, ry, P.glow);
      c.globalAlpha = 0.6 * a;
      ring(c, x, y, r, P.core, 1, 0.6);
      c.globalAlpha = a;
      for (let i = 0; i < 4; i++) {
        const an = seed * 7 + i * 1.7;
        const ex = x + Math.cos(an) * r * 0.6;
        const ey = y + Math.sin(an) * ry * 0.6;
        if (Math.sin(t * 4 + i * 2 + seed * 9) > 0.3) {
          px(c, ex, ey, '#ffffff');
          if (g) px(g, ex, ey, '#ffffff');
        }
      }
      break;
    }
    case 'crackle': {
      c.globalAlpha = 0.35 * a;
      ell(c, x, y, r, ry, '#1d1a2a');
      c.globalAlpha = a;
      const s = Math.floor(t * 14 + seed * 50);
      const a1 = hash(s, 1) * TAU;
      const a2 = a1 + 2 + hash(s, 2) * 2;
      const x1 = x + Math.cos(a1) * r * 0.7;
      const y1 = y + Math.sin(a1) * ry * 0.7;
      const x2 = x + Math.cos(a2) * r * 0.7;
      const y2 = y + Math.sin(a2) * ry * 0.7;
      zig(c, x1, y1, x2, y2, 4, 2, s, P.core, 1);
      if (g) {
        zig(g, x1, y1, x2, y2, 4, 2, s, P.spark, 1);
        halo(g, x, y, r, L.halo, 0.2 * a, R.bounds);
      }
      break;
    }
    case 'cracks': {
      c.globalAlpha = 0.35 * a;
      ell(c, x, y, r, ry, P.deep);
      c.globalAlpha = 0.8 * a;
      for (let i = 0; i < 4; i++) {
        const an = seed * 5 + i * 1.6;
        line(c, x, y, x + Math.cos(an) * r * 0.9, y + Math.sin(an) * ry * 0.9, '#2b1d14', 1);
      }
      break;
    }
    case 'gusts': {
      c.globalAlpha = 0.55 * a;
      const rot = t * 5 + seed * 6;
      ring(c, x, y, r * 0.45, P.core, 1, 0.6, rot, rot + 2);
      ring(c, x, y, r * 0.8, P.spark, 1, 0.6, rot + 3, rot + 5);
      break;
    }
    case 'brambles': {
      c.globalAlpha = 0.35 * a;
      ell(c, x, y, r, ry, '#1f3a1c');
      c.globalAlpha = a;
      for (let i = 0; i < 5; i++) {
        const an = seed * 8 + i * 1.25;
        const ex = x + Math.cos(an) * r * 0.65;
        const ey = y + Math.sin(an) * ry * 0.65;
        line(c, ex - 2, ey, ex + 2, ey - 2, '#2f5a2a', 1);
        px(c, ex, ey - 2, i & 1 ? P.glow : P.deep);
        if (i === 2) px(c, ex + 1, ey - 3, L.accent);
      }
      break;
    }
    case 'ooze': {
      c.globalAlpha = 0.55 * a;
      ell(c, x, y, r, ry, P.deep);
      c.globalAlpha = 0.55 * a;
      ell(c, x, y - 0.5, r * 0.8, ry * 0.75, P.glow);
      c.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.3 + i * 0.37 + seed) % 1;
        const an = seed * 11 + i * 2.1;
        ring(c, x + Math.cos(an) * r * 0.4, y + Math.sin(an) * ry * 0.4 - k * 2, 0.6 + k * 1.2, P.spark, 1, 1);
      }
      if (g) halo(g, x, y, r, L.halo, 0.2 * a, R.bounds);
      break;
    }
    case 'sigil': {
      c.globalAlpha = 0.25 * a;
      ell(c, x, y, r, ry, P.glow);
      c.globalAlpha = 0.8 * a;
      ring(c, x, y, r * 0.85, P.core, 1, 0.6);
      const rot = t * 1.5 + seed * 6;
      for (let i = 0; i < 4; i++) {
        const an = rot + (i * Math.PI) / 2;
        line(c, x, y, x + Math.cos(an) * r * 0.7, y + Math.sin(an) * ry * 0.7, P.spark, 1);
      }
      if (g) {
        g.globalAlpha = a;
        ring(g, x, y, r * 0.85, P.core, 1, 0.6);
        g.globalAlpha = 1;
        halo(g, x, y, r * 1.2, L.halo, 0.35 * a, R.bounds);
      }
      break;
    }
    case 'shadow': {
      c.globalAlpha = 0.6 * a;
      ell(c, x, y, r, ry, DARK_CORE);
      c.globalAlpha = 0.7 * a;
      for (let i = 0; i < 5; i++) {
        const an = seed * 6 + i * 1.26 + Math.sin(t * 2 + i) * 0.2;
        line(c, x + Math.cos(an) * r * 0.7, y + Math.sin(an) * ry * 0.7, x + Math.cos(an) * r * 1.15, y + Math.sin(an) * ry * 1.15, P.deep, 1);
      }
      c.globalAlpha = a;
      if (Math.sin(t * 3 + seed * 9) > 0.5) px(c, x + r * 0.3, y - 1, P.glow);
      if (g) {
        g.globalAlpha = 0.5 * a;
        ring(g, x, y, r, P.glow, 1, 0.6);
        g.globalAlpha = 1;
      }
      break;
    }
    case 'filings': {
      for (let i = 0; i < 7; i++) {
        const an = seed * 7 + i * 0.9;
        const rr = r * (0.2 + hash(seed * 77, i) * 0.7);
        const ex = x + Math.cos(an) * rr;
        const ey = y + Math.sin(an) * rr * 0.6;
        const glint = Math.sin(t * 6 + i * 1.7 + seed * 5) > 0.7;
        px(c, ex, ey, glint ? '#ffffff' : i & 1 ? P.glow : P.deep);
        if (glint && g) px(g, ex, ey, P.spark);
      }
      break;
    }
    case 'chord': {
      for (let k = 0; k < 2; k++) {
        const q = (t * 0.9 + k * 0.5 + seed) % 1;
        c.globalAlpha = 0.6 * a * (1 - q);
        ring(c, x, y, r * (0.2 + q * 0.8), k ? P.spark : P.glow, 1, 0.6);
      }
      break;
    }
    default: {
      c.globalAlpha = 0.3 * a;
      ell(c, x, y, r, ry, P.deep);
      c.globalAlpha = 0.25 * a;
      ell(c, x, y, r * 0.7, ry * 0.7, P.glow);
      c.globalAlpha = a;
      const an = t * 2 + seed * 6;
      px(c, x + Math.cos(an) * r * 0.6, y + Math.sin(an) * ry * 0.6, P.core);
      if (g) halo(g, x, y, r, L.halo, 0.25 * a, R.bounds);
    }
  }
  c.globalAlpha = 1;
}

// The above-ground part of a patch (most of it is drawn on the ground pass).
function drawPatchTop() {}

// ================================================================== ground pass

// Everything that lies on the ground under actors: patch pools, rain zones, runes,
// shadows of lobs and drops with their target rings, familiar shadows, wall shadows,
// the scorch of bursts and rings, dash trails.
export function drawBodyGround(R, b) {
  const L = planLook(b.plan);
  const P = L.pal;
  const c = R.ctx;
  const x = b.x - R.ox;
  const y = b.y - R.oy;
  const t = R.time;
  switch (b.kind) {
    case 'area': {
      if (b.mode === 'patch') {
        const a = k01(Math.min((b.life - b.age) / 0.6, b.age / 0.15));
        drawPatch(R, L.look.patch, P, L, x, y, Math.max(3, b.cur), a, b.seed, t);
      } else if (b.mode === 'rain') {
        const a = k01(Math.min((b.life - b.age) / 0.3, b.age / 0.12));
        c.globalAlpha = 0.18 * a;
        ell(c, x, y, b.r1, b.r1 * 0.62, L.look.dark ? DARK_CORE : P.deep);
        c.globalAlpha = (0.45 + 0.2 * Math.sin(t * 10)) * a;
        ring(c, x, y, b.r1, P.glow, 1, 0.62);
        c.globalAlpha = 0.3 * a;
        ring(c, x, y, b.r1 * 0.6, P.spark, 1, 0.62, t * 2, t * 2 + 4);
        if (R.g) {
          R.g.globalAlpha = 0.5 * a;
          ring(R.g, x, y, b.r1, P.glow, 1, 0.62);
          R.g.globalAlpha = 1;
          R.bounds.add(x, y, b.r1);
        }
      } else if (b.mode === 'ring' || b.mode === 'burst') {
        const k = 1 - k01(b.age / Math.max(0.01, b.life));
        c.globalAlpha = 0.22 * k;
        ell(c, x, y, b.cur || b.r1 * 0.5, (b.cur || b.r1 * 0.5) * 0.62, L.look.dark ? DARK_CORE : P.deep);
      }
      break;
    }
    case 'rune':
      drawRune(R, b, L, x, y, t);
      break;
    case 'projectile': {
      if (b.mode === 'lob') {
        const tx = b.tx - R.ox;
        const ty = b.ty - R.oy;
        const rr = Math.max(6, b.burstR);
        const rot = t * 3 + b.seed * 6;
        c.globalAlpha = 0.14;
        ell(c, tx, ty, rr, rr * 0.62, P.deep);
        c.globalAlpha = 0.55 + 0.25 * Math.sin(t * 14);
        for (let i = 0; i < 4; i++) ring(c, tx, ty, rr, P.glow, 1, 0.62, rot + i * 1.57, rot + i * 1.57 + 0.9);
        px(c, tx, ty, P.core);
        // The bomb's shadow shrinks as it climbs.
        const s = Math.max(1.5, b.r * (1 - Math.min(0.6, b.z / 60)));
        c.globalAlpha = 0.35;
        ell(c, x, y, s + 1, s * 0.5 + 0.5, '#100a1c');
        if (R.g) {
          R.g.globalAlpha = 0.5;
          ring(R.g, tx, ty, rr, P.glow, 1, 0.62);
          R.g.globalAlpha = 1;
          R.bounds.add(tx, ty, rr);
        }
      } else if (b.mode === 'fall') {
        const k = 1 - Math.min(1, b.z / 120);
        c.globalAlpha = 0.25 + 0.35 * k;
        ell(c, x, y, 1 + k * 2.5, 0.5 + k * 1.2, '#100a1c');
        c.globalAlpha = 0.3 * k;
        ring(c, x, y, b.r1 * (1.4 - k * 0.6), P.glow, 1, 0.6);
      } else if (b.z > 0 && b.mode !== 'arc') {
        c.globalAlpha = 0.22;
        ell(c, x, y, Math.max(1.5, b.r * 0.8), Math.max(1, b.r * 0.35), '#100a1c');
      }
      break;
    }
    case 'summon':
      drawFamiliarShadow(R, b, x, y);
      break;
    case 'wall': {
      c.globalAlpha = 0.28 * k01((b.life - b.age) / 0.45);
      line(c, b.ox - R.ox, b.oy - R.oy + 1, b.x2 - R.ox, b.y2 - R.oy + 1, '#100a1c', b.r * 2 + 3);
      break;
    }
    case 'trail': {
      const k = k01(b.age / Math.max(0.01, b.life));
      const a = 1 - k;
      const x2 = b.x2 - R.ox;
      const y2 = b.y2 - R.oy;
      const len = Math.hypot(x2 - x, y2 - y);
      c.globalAlpha = 0.25 * a;
      line(c, x, y, x2, y2, L.look.dark ? DARK_CORE : P.deep, b.r * 1.6);
      const n = Math.max(1, Math.round(len / (R.lod ? 16 : 9)));
      for (let i = 0; i <= n; i++) {
        const q = i / n;
        drawPatch(R, L.look.patch, P, L, x + (x2 - x) * q, y + (y2 - y) * q, Math.max(3, b.r * 0.9), a * 0.9, b.seed + i * 0.13, t);
      }
      if (R.g) {
        R.g.globalAlpha = 0.5 * a;
        line(R.g, x, y - 3, x2, y2 - 3, P.glow, 1);
        R.g.globalAlpha = 1;
        R.bounds.add(x, y, 6);
        R.bounds.add(x2, y2, 6);
      }
      break;
    }
    default:
      break;
  }
  c.globalAlpha = 1;
}

// A Lanternwright glyph on the ground: drawn in as it arms, then it breathes.
function drawRune(R, b, L, x, y, t) {
  const P = L.pal;
  const c = R.ctx;
  const g = R.g;
  const fs = b.fxState;
  const armTotal = fs?.arm > 0 ? fs.arm : 0.6;
  const p = b.armed ? 1 : k01(1 - b.armT / armTotal);
  const fade = k01(Math.min((b.life - b.age) / 0.5, b.age / 0.1));
  const pulse = b.armed ? 0.65 + 0.3 * Math.sin(t * 5 + b.seed * 9) : 0.5;
  const r = Math.max(8, b.trigR + 3);
  c.globalAlpha = 0.28 * fade;
  ell(c, x, y, r, r * 0.6, L.look.dark ? DARK_CORE : P.deep);
  c.globalAlpha = pulse * fade;
  const a0 = -Math.PI / 2;
  ring(c, x, y, r, P.glow, 1, 0.6, a0, a0 + p * TAU);
  if (!R.lod) ring(c, x, y, r * 0.62, P.spark, 1, 0.6, a0 + Math.PI, a0 + Math.PI - p * TAU * 0.999);
  // Ticks between the circles, turning (four dots instead in a crowded frame).
  const spin = t * (b.armed ? 1.2 : 0.3) + b.seed * 6;
  const ticks = 8;
  if (R.lod) {
    for (let i = 0; i < 4; i++) {
      const an = spin + (i / 4) * TAU;
      px(c, x + Math.cos(an) * r * 0.8, y + Math.sin(an) * 0.6 * r * 0.8, i & 1 ? P.glow : P.core);
    }
  }
  for (let i = 0; !R.lod && i < Math.round(ticks * p); i++) {
    const an = spin + (i / ticks) * TAU;
    const cx = Math.cos(an);
    const sy = Math.sin(an) * 0.6;
    line(c, x + cx * r * 0.68, y + sy * r * 0.68, x + cx * r * 0.92, y + sy * r * 0.92, i & 1 ? P.glow : P.core, 1);
  }
  // The sign of its essence, in the middle.
  c.globalAlpha = p * fade * (b.armed ? 0.75 + 0.25 * pulse : 0.6);
  c.drawImage(glyphSprite(L.look.glyph, P.core), Math.round(x) - 3, Math.round(y) - 4);
  c.globalAlpha = 1;
  if (g) {
    g.globalAlpha = (b.armed ? 0.55 * pulse : 0.3) * fade;
    ring(g, x, y, r, P.glow, 1, 0.6, a0, a0 + p * TAU);
    g.drawImage(glyphSprite(L.look.glyph, P.spark), Math.round(x) - 3, Math.round(y) - 4);
    g.globalAlpha = 1;
    halo(g, x, y - 2, r * 1.1, L.halo, (b.armed ? 0.3 * pulse : 0.12) * fade, R.bounds);
  }
}

// ================================================================== the body pass

// Draw one body above the actors (the layer's body pass).
export function drawBody(R, b) {
  const L = planLook(b.plan);
  const fs = b.fxState;
  switch (b.kind) {
    case 'projectile':
      drawProjectile(R, b, L, fs);
      break;
    case 'area':
      drawArea(R, b, L);
      break;
    case 'strike':
      drawStrike(R, b, L);
      break;
    case 'beam':
      drawBeam(R, b, L);
      break;
    case 'summon':
      drawFamiliar(R, b, L);
      break;
    case 'wall':
      drawWall(R, b, L);
      break;
    case 'rune':
    case 'trail':
      break; // on the ground pass
    default: {
      const x = b.x - R.ox;
      const y = b.y - R.oy - (b.z || 0);
      disc(R.ctx, x, y, Math.max(1, b.r || 3), L.pal.glow);
      if (R.g) halo(R.g, x, y, (b.r || 3) * 3, L.halo, 0.5, R.bounds);
    }
  }
  R.ctx.globalAlpha = 1;
  if (R.g) R.g.globalAlpha = 1;
}

// The orbit twist: a faint ring around the caster while its bodies circle.
export function drawOrbitRing(R, owner, r, pal) {
  const x = owner.x - R.ox;
  const y = owner.y - R.oy - 6;
  R.ctx.globalAlpha = 0.35 + 0.15 * Math.sin(R.time * 8);
  ring(R.ctx, x, y, r, pal.glow, 1, 0.8);
  R.ctx.globalAlpha = 1;
  if (R.g) {
    R.g.globalAlpha = 0.4;
    ring(R.g, x, y, r, pal.spark, 1, 0.8);
    R.g.globalAlpha = 1;
    R.bounds.add(x, y, r + 2);
  }
}

// The homing twist: brackets locking onto the mark.
export function drawLockOn(R, target, pal) {
  const x = target.x - R.ox;
  const y = target.y - R.oy - 9 - (target.z || 0);
  const s = 7 + Math.sin(R.time * 10) * 1;
  const c = R.ctx;
  c.globalAlpha = 0.85;
  c.fillStyle = pal.core;
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1;
    const sy = i & 2 ? 1 : -1;
    const cx = Math.round(x + sx * s);
    const cy = Math.round(y + sy * s * 0.9);
    c.fillRect(cx - (sx > 0 ? 2 : 0), cy, 3, 1);
    c.fillRect(cx, cy - (sy > 0 ? 2 : 0), 1, 3);
  }
  c.globalAlpha = 1;
}

// The charge twist and held beams: light gathering at the hands.
export function drawCharge(R, caster, hold, pal, halo2) {
  const x = caster.x - R.ox;
  const y = caster.y - R.oy - 10;
  const k = hold.mode === 'charge' ? k01(hold.k) : 0.6;
  const full = hold.mode === 'charge' && k >= 1;
  const t = R.time;
  const c = R.ctx;
  const rr = 12 - k * 7;
  c.globalAlpha = 0.55 + 0.35 * k;
  for (let i = 0; i < 6; i++) {
    const an = t * (3 + k * 6) + (i / 6) * TAU;
    px(c, x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.55, i & 1 ? pal.spark : pal.core);
  }
  disc(c, x, y, 1 + k * 2.5, full ? '#ffffff' : pal.glow);
  c.globalAlpha = 1;
  if (R.g) {
    const pulse = full ? 0.75 + 0.25 * Math.sin(t * 22) : 1;
    halo(R.g, x, y, 6 + k * 16, halo2, (0.25 + 0.6 * k) * pulse, R.bounds);
    disc(R.g, x, y, 1 + k * 2, pal.core);
  }
}

