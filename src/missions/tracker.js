// Objective matching (DESIGN §22.3): small pure helpers the mission system uses to decide
// whether an event or a moment moves an objective. No DOM, no state of its own.
//
// Objective types (data.js):
//   weave    { count, shape?, essence?, twist?, essences?: n non-raw, at?, point?, when?, kindle?: area }
//   defeat   { target: species | [species] | 'boss:<id>', count, at?, when?, spawn?, where? }
//   bring    { item, count, where? }            held in the pack at turn-in, then handed over
//   collect  { item, count, at?, when?, spawn? } picked up while the objective is current
//   reach    { at? | point?: {tx, ty, r} | entity?: id or species, radius?, when?, stay?, limit? }
//   talk     { target: npc id | 'lyra', lines }
//   protect  { at, seconds, when?, target?, spawn? }   hold a place while the moment lasts

import { TILE } from '../core/constants.js';

export const WHEN = {
  day: { from: 7, to: 18 },
  dusk: { from: 17.5, to: 21 },
  evening: { from: 17.5, to: 24 },
  night: { from: 20.5, to: 5 },
  dawn: { from: 5, to: 8 },
};

export function hourIn(h, from, to) {
  if (!Number.isFinite(h)) return true;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

// Does the clock satisfy an objective's `when`?
export function whenOk(when, clock) {
  if (!when) return true;
  const h = clock?.hour;
  if (when === 'night' && clock?.isNight) return true;
  const w = typeof when === 'string' ? WHEN[when] : when;
  if (!w) return true;
  return hourIn(h, w.from, w.to);
}

export function whenLabel(when) {
  if (!when) return '';
  if (typeof when === 'string') return { day: 'by day', dusk: 'at dusk', evening: 'after dusk', night: 'after dark', dawn: 'at dawn' }[when] || '';
  const f = (x) => {
    const h = ((Math.floor(x) % 24) + 24) % 24;
    const ap = h < 12 ? 'AM' : 'PM';
    const hh = h % 12 || 12;
    return `${hh} ${ap}`;
  };
  return `between ${f(when.from)} and ${f(when.to)}`;
}

// Inside a location's bounds (its rooms and corners count too).
export function inPlace(game, locId, x, y) {
  if (!locId) return true;
  const loc = game?.locations?.get?.(locId);
  const b = loc?.bounds;
  if (!b || !Number.isFinite(x)) return false;
  const tx = x / TILE;
  const ty = y / TILE;
  return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
}

export function nearPoint(point, x, y, extra = 0) {
  if (!point || !Number.isFinite(x)) return false;
  const px = (point.tx + 0.5) * TILE;
  const py = (point.ty + 0.5) * TILE;
  return Math.hypot(px - x, py - y) <= ((point.r ?? 3) + extra) * TILE;
}

export function pointPx(point) {
  return { x: (point.tx + 0.5) * TILE, y: (point.ty + 0.5) * TILE };
}

const idOf = (x) => (x && typeof x === 'object' ? x.id ?? x.name ?? null : x);

// What a spell_cast payload says was woven: { shape, essences, twists } as id lists.
export function weaveOf(p) {
  const w = p?.weave || p?.plan?.weave || {};
  const plan = p?.plan || {};
  const shape = idOf(w.shape ?? plan.shape ?? null);
  const essences = [].concat(w.essences ?? plan.essences ?? []).map(idOf).filter(Boolean);
  const twists = [].concat(w.twists ?? plan.twists ?? []).map(idOf).filter(Boolean);
  return { shape, essences, twists };
}

// While "Try all magic" (Settings) runs, a weave may be made of borrowed parts: they
// count for nothing (no objective, no first-sight line). Outside a trial, all is earned.
export function earnedPart(game, kind, id) {
  const m = game?.magic;
  if (!m?.trial || typeof m.isEarned !== 'function') return true;
  return m.isEarned(kind, id);
}

export function weaveEarned(game, w) {
  if (!w) return true;
  if (w.shape && !earnedPart(game, 'shape', w.shape)) return false;
  for (const e of w.essences || []) if (e !== 'raw' && !earnedPart(game, 'essence', e)) return false;
  for (const t of w.twists || []) if (!earnedPart(game, 'twist', t)) return false;
  return true;
}

export function nonRaw(essences) {
  return [...new Set((essences || []).filter((e) => e && e !== 'raw'))];
}

// Does a woven spell meet a weave objective's filters (shape, essence, twist, count)?
export function weaveMatches(obj, w) {
  if (obj.shape && w.shape !== obj.shape) return false;
  if (obj.essence && !w.essences.includes(obj.essence)) return false;
  if (obj.twist && !w.twists.includes(obj.twist)) return false;
  if (obj.essences && nonRaw(w.essences).length < obj.essences) return false;
  return true;
}

// Where a spell was aimed, when the payload says; else a step in front of the caster.
export function aimOf(p, caster) {
  const a = p?.aim || p?.plan?.aim || null;
  if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return a;
  if (!caster) return null;
  const f = caster.facing || { x: 0, y: 1 };
  return { x: caster.x + (f.x || 0) * 40, y: caster.y + (f.y || 0) * 40 };
}

export function speciesMatches(target, entity) {
  if (!entity) return false;
  const s = String(entity.species || '');
  if (!s) return false;
  const list = [].concat(target || []);
  return list.includes(s);
}

export function isBossTarget(target) {
  return typeof target === 'string' && target.startsWith('boss:');
}

// Words for an objective's progress ("2/3"), or '' when it has no count to show.
export function progressText(obj, n) {
  if (obj.type === 'protect') return `${Math.min(obj.seconds, Math.floor(n))}/${obj.seconds}s`;
  if (obj.type === 'reach' && obj.stay) return n > 0 ? `${Math.min(obj.stay, Math.floor(n))}/${obj.stay}s` : '';
  const c = obj.count ?? 1;
  return c > 1 ? `${Math.min(c, Math.floor(n))}/${c}` : '';
}

export function objectiveGoal(obj) {
  if (obj.type === 'protect') return obj.seconds || 30;
  if (obj.type === 'reach') return obj.stay || 1;
  if (obj.type === 'talk') return 1;
  return obj.count ?? 1;
}
