// Who could see a thing happen (DESIGN §29): line of sight, light, distance, walls and
// night. Only those who could see it know. A witness either sees it clearly (they know who
// did it) or catches a glimpse (a figure, a blade, a shape carrying something heavy).
//
//   lightAt(game, x, y)                    0..1, daylight plus lamps, fires and lanterns
//   sightRange(game, seer, light)          px a seer can make things out at, for that light
//   lineOfSight(game, ax, ay, bx, by)      walls and shut doors block it; two trees in the way block it
//   look(game, seer, x, y)                 { sees, clarity: 'clear'|'glimpse', d } | null
//   witnessesOf(game, x, y, { exclude })   everyone who saw a point right now, nearest first

import { TILE } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { wallTile } from '../world/walls.js';

export const RANGE = Object.freeze({
  day: 150, // px outdoors by full day (a villager's SIGHT)
  night: 56, // px outdoors in the dark: shapes, close by
  lit: 118, // px under a lamp or by a fire at night
  room: 210, // px under the same roof: a room is lit and seen whole
  blind: 40, // Wenna knows people by their step, close by
});
const CLEAR = 0.55; // nearer than this share of the range, in good light: they know who
const CLEAR_ALWAYS = 34; // px: this close, anyone awake knows who it is
const LIGHT_REACH = 90; // px searched for lamps and fires around a point
const BLIND = new Set(['wenna']);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export function daylightOf(game) {
  const c = game?.clock;
  const d = safe(() => c?.daylight);
  if (Number.isFinite(d)) return Math.max(0, Math.min(1, d));
  return c?.isNight ? 0 : 1;
}

// The light falling on a point: the day, and any lamp, fire or lantern close enough.
export function lightAt(game, x, y) {
  let l = daylightOf(game);
  if (l >= 0.95) return 1;
  const t = game?.time ?? 0;
  const take = (L) => {
    if (!L || !Number.isFinite(L.x) || !(L.r > 0)) return;
    const d = Math.hypot(L.x - x, L.y + 10 - y);
    if (d >= L.r * 1.15) return;
    const k = Math.min(1, (Number(L.intensity) || 0.6) * 1.25) * (1 - d / (L.r * 1.15));
    if (k > l) l = k;
  };
  const objs = safe(() => game.objects?.inRadius?.(x, y, LIGHT_REACH), []) || [];
  // A light under a roof stays inside (DESIGN §31.5): it lights its own room, never the
  // street outside the wall (the chapel's altar does not light a killing in the square).
  const outside = buildingKey(game, x, y) == null;
  const takeOne = (L) => {
    if (outside && L && underRoof(game, L.x, L.y)) return;
    take(L);
  };
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (o.removed || typeof o.getLight !== 'function') continue;
    const L = safe(() => o.getLight(t));
    if (Array.isArray(L)) L.forEach(takeOne);
    else takeOne(L);
  }
  // Lights that walk or lie on the ground (a lantern carried, the ember-ring where coins
  // were left, round 14) keep the same roof rule: under a roof they light their room only.
  const ents = safe(() => game.entities?.all?.(), []) || [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed || typeof e.getLight !== 'function' || Math.abs(e.x - x) > LIGHT_REACH || Math.abs(e.y - y) > LIGHT_REACH) continue;
    const L = safe(() => e.getLight(t));
    if (Array.isArray(L)) L.forEach(takeOne);
    else takeOne(L);
  }
  // A lantern in the player's pack lights them and what they stand over.
  const p = game?.player;
  if (p && !p.removed && Math.hypot(p.x - x, p.y - y) < 80 && safe(() => p.inventory?.has?.('lantern'), false)) take({ x: p.x, y: p.y - 10, r: 88, intensity: 0.85 });
  return Math.max(0, Math.min(1, l));
}

// How far `seer` makes things out, given the light on what they look at.
export function sightRange(game, seer, light = null) {
  if (seer && BLIND.has(seer.id)) return RANGE.blind;
  const day = daylightOf(game);
  const lit = light == null ? day : light;
  let r = RANGE.night + (RANGE.day - RANGE.night) * day;
  if (lit > day) r = Math.max(r, RANGE.night + (RANGE.lit - RANGE.night) * lit);
  const w = game?.clock?.weather;
  if (w?.type === 'fog') r *= 0.6;
  else if (w?.type === 'rain' && (w.intensity ?? 1) > 0.3) r *= 0.85;
  return r;
}

function buildingKey(game, x, y) {
  const b = safe(() => game.map?.buildingAt?.(Math.floor(x / TILE), Math.floor(y / TILE)));
  return b ? b.id ?? b : null;
}

// Under a building's roof (not its front wall, where windows and lamps hang to the street):
// the same rule the renderer's roofs use (render/lighting.js roofSeen).
function underRoof(game, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const ty = Math.floor(y / TILE);
  const b = safe(() => game.map?.buildingAt?.(Math.floor(x / TILE), ty));
  return !!b && !(ty > b.y + b.h - 3);
}

// Walls (and anything that stops an arrow) block the view; trees thin it, and two of them
// in the way hide what is behind. The two end tiles never block (you see a door you lean on).
export function lineOfSight(game, ax, ay, bx, by) {
  const map = game?.map;
  if (!map) return true;
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < TILE) return true;
  const n = Math.ceil(d / (TILE / 3));
  const t0x = Math.floor(ax / TILE);
  const t0y = Math.floor(ay / TILE);
  const t1x = Math.floor(bx / TILE);
  const t1y = Math.floor(by / TILE);
  let lastX = t0x;
  let lastY = t0y;
  let trees = 0;
  for (let i = 1; i < n; i++) {
    const tx = Math.floor((ax + (dx * i) / n) / TILE);
    const ty = Math.floor((ay + (dy * i) / n) / TILE);
    if (tx === lastX && ty === lastY) continue;
    lastX = tx;
    lastY = ty;
    if ((tx === t0x && ty === t0y) || (tx === t1x && ty === t1y)) continue;
    // The tiles that stop a blow stop the eye too (world/walls.js): walls, rock, and a door
    // shut in the way.
    if (safe(() => wallTile(game, tx, ty), false)) return false;
    const objs = safe(() => game.objects?.objectsAt?.(tx, ty), null);
    if (objs) {
      for (let k = 0; k < objs.length; k++) {
        const o = objs[k];
        // A felled tree's stump hides nobody (world/breakables.js).
        if (o.removed || o.hidden || o.objType !== 'tree' || o.state?.depleted) continue;
        if (typeof o.blocksTile === 'function' && !safe(() => o.blocksTile(tx, ty, null), true)) continue;
        trees++;
        if (trees >= 2) return false;
        break;
      }
    }
  }
  return true;
}

// Awake, on their feet and in the world: someone who can see anything at all.
export function canLook(e) {
  if (!e || e.removed || e.hidden || e.absent || e.dead || e.downed || e.carriedBy) return false;
  if (e.state === 'sleep') return false;
  if (typeof e.isAlive === 'function' && !e.isAlive()) return false;
  return true;
}

// Does `seer` see the point (x, y) right now? -> { sees, clarity, d, light } or null.
export function look(game, seer, x, y, { light = null } = {}) {
  if (!canLook(seer)) return null;
  if (buildingKey(game, seer.x, seer.y) !== buildingKey(game, x, y)) return null;
  const d = Math.hypot(seer.x - x, seer.y - y);
  const indoors = buildingKey(game, x, y) != null;
  const L = light == null ? (indoors ? 1 : lightAt(game, x, y)) : light;
  const r = indoors ? (BLIND.has(seer.id) ? RANGE.blind : RANGE.room) : sightRange(game, seer, L);
  if (d > r) return null;
  if (!lineOfSight(game, seer.x, seer.y - 6, x, y - 6)) return null;
  const clear = d <= CLEAR_ALWAYS || (d <= r * CLEAR && L >= 0.45) || (indoors && d <= r * 0.8);
  return { sees: true, clarity: clear ? 'clear' : 'glimpse', d, light: L };
}

// Everyone (the eighteen and Lyra, by default) who sees (x, y) now, nearest first.
export function witnessesOf(game, x, y, { exclude = [], ids = null } = {}) {
  const out = [];
  const skip = new Set(exclude);
  const L = buildingKey(game, x, y) != null ? 1 : lightAt(game, x, y);
  for (const id of ids || [...VILLAGERS, 'lyra']) {
    if (skip.has(id)) continue;
    const e = id === 'lyra' ? game?.companion : safe(() => game.entities?.get?.(id));
    const v = e ? look(game, e, x, y, { light: L }) : null;
    if (v) out.push({ id, clarity: v.clarity, d: Math.round(v.d) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}
