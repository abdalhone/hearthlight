// What game.pixelFx can play (src/render/pixel_fx.js): one spec per effect id.
//
// spec: {
//   mod        the effect module (src/vendor/pixelfx/fx/..., MIT, see THIRD_PARTY.md)
//   layer      'ground' (on the floor under everyone) | 'body' (y-sorted with its anchor) | 'top'
//   bounds     [x0, y0, x1, y1] round the anchor that it may draw in (its pooled frame)
//   priority   who goes first when the cap is reached (ambient 0, flourish 1, status 2, hit 3)
//   opts       default options (the game's scale, height above the feet...)
//   rotates    true: the caller's angle turns the painter (beams, cones); otherwise the
//              angle is passed to the effect as its own `aim` (top-down variants, which
//              keep "up" pointing up the screen for anything that hops or rises)
//   reduce     under reduced motion: false (skip it) or { scale, opts } (calmer)
//   lightK     how strongly its light is added (1 = as drawn)
// }
//
// Every effect here was looked at from above, at the game's scale and in several aim
// directions (scripts/pixelfx_preview.mjs and scripts/pixelfx_shots.mjs).

import * as hitSpark from '../vendor/pixelfx/fx/impacts/hit-spark.js';
import * as critHit from '../vendor/pixelfx/fx/impacts/crit-hit.js';
import * as burning from '../vendor/pixelfx/fx/status/burning.js';
import * as frozen from '../vendor/pixelfx/fx/status/frozen.js';
import * as poisoned from '../vendor/pixelfx/fx/status/poisoned.js';
import * as bleeding from '../vendor/pixelfx/fx/status/bleeding.js';
import * as cursed from '../vendor/pixelfx/fx/status/cursed.js';
import * as stunned from '../vendor/pixelfx/fx/status/stunned.js';
import * as confused from '../vendor/pixelfx/fx/status/confused.js';
import * as rage from '../vendor/pixelfx/fx/status/rage.js';

// ------------------------------------------------------------------ colors

function hexToRgb(h) {
  const s = String(h).replace('#', '');
  const v = parseInt(s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s.slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}
function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

const RAMPS = new Map();
// A pixelfx ramp (dark to bright, 7 steps) from a Weave palette { core, glow, spark, deep }:
// a shadow under its deep color, its deep, glow and spark, its core, white.
export function rampOf(pal) {
  if (!pal) return undefined;
  const key = `${pal.deep}|${pal.glow}|${pal.spark}|${pal.core}`;
  let r = RAMPS.get(key);
  if (r) return r;
  const shadow = mixHex(pal.deep, '#0b0a14', 0.55);
  r = [shadow, pal.deep, mixHex(pal.deep, pal.glow, 0.5), pal.glow, pal.spark, pal.core, '#ffffff'];
  if (RAMPS.size > 64) RAMPS.clear();
  RAMPS.set(key, r);
  return r;
}

// ------------------------------------------------------------------ the catalog

// Room round a body for what wraps it (a 12x20 villager; bigger bodies pass their own).
const STATUS_BOX = [-26, -46, 26, 16];

export const PIXEL_FX = {
  // The everyday hit (a weave or a blade): a cross flare at the point of contact, a cone
  // of sparks and chips thrown along the blow over the floor. Recolored per essence.
  hit: {
    mod: hitSpark,
    layer: 'top',
    priority: 3,
    bounds: [-44, -40, 44, 34],
    opts: { size: 0.6, height: 10, sparks: 9 },
    reduce: { opts: { sparks: 5 } },
  },
  // A critical hit: a starburst slams in and overshoots, a ring breaks into flying arcs,
  // sparks and shards scatter over the floor round the target.
  crit: {
    mod: critHit,
    layer: 'top',
    priority: 3,
    bounds: [-52, -50, 52, 36],
    opts: { size: 0.5, height: 10 },
    lightK: 0.8,
  },

  // ---------------------------------------------------------------- statuses on a body
  // Each wraps the afflicted body's own sprite frame (actor: true; pixel_fx_bodies.js),
  // its back half behind the body and its front half over it; started and stopped by the
  // status director in pixel_fx_play.js as the Weave's statuses come and go.
  'st-burning': { mod: burning, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: { flash: false } },
  'st-chill': { mod: frozen, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: { still: true, reach: 8 } },
  'st-poison': { mod: poisoned, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: {} },
  'st-cursed': { mod: cursed, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: { smoke: 0.6, skullUp: 8 } },
  'st-stun': { mod: stunned, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: {} },
  'st-dazed': { mod: confused, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: {} },
  'st-bleed': { mod: bleeding, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: { pool: 5.5 } },
  'st-rage': { mod: rage, layer: 'body', actor: true, priority: 2, bounds: STATUS_BOX, opts: { still: true } },
};
