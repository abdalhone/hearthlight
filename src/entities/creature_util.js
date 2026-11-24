import { TILE } from '../core/constants.js';
import { factionRelation } from './entity.js';

// Small helpers shared by creatures, villagers and the spawner.

const PROVOKE_SECONDS = 45;

export function now(game) {
  return game?.clock?.t ?? 0;
}

export function rand(game) {
  const r = game?.rng;
  return r && typeof r.next === 'function' ? r.next() : Math.random();
}

// The village rectangle in world pixels (cached per world), or null.
export function villageRect(game) {
  if (!game) return null;
  if (game._villageRectFor === game.locations) return game._villageRect;
  let r = null;
  try {
    const v = game.locations?.get?.('hearthvale');
    if (v?.bounds) r = { x: v.bounds.x * TILE, y: v.bounds.y * TILE, w: v.bounds.w * TILE, h: v.bounds.h * TILE };
  } catch {
    r = null;
  }
  game._villageRect = r;
  game._villageRectFor = game.locations;
  return r;
}

export function inVillage(game, x, y) {
  const r = villageRect(game);
  return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

// Is `a` hostile to `b`? Always asked through combat.isHostile (which knows about
// crimes and provocation); the fallback mirrors it for tests and stubs.
export function hostileTo(game, a, b) {
  if (!a || !b || a === b) return false;
  try {
    if (game?.combat?.isHostile) return !!game.combat.isHostile(a, b);
  } catch {
    /* fall through */
  }
  if (factionRelation(a.faction, b.faction) === 'hostile') return true;
  const t = now(game);
  if (a.provokedBy === b && a.provokedMode === 'fight' && t - (a.provokedAt ?? -Infinity) < PROVOKE_SECONDS) return true;
  return false;
}

export function alive(e) {
  return !!e && !e.removed && !e.dead && (typeof e.isAlive === 'function' ? e.isAlive() : e.hp > 0);
}

// Straight-line walkability between two points (tile samples every half tile).
export function walkLine(game, actor, x0, y0, x1, y1) {
  if (!game?.isBlockedTile) return true;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / (TILE / 2)));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    try {
      if (game.isBlockedTile(Math.floor((x0 + (x1 - x0) * t) / TILE), Math.floor((y0 + (y1 - y0) * t) / TILE), actor)) return false;
    } catch {
      return true;
    }
  }
  return true;
}

// Line of sight for arrows and eyes (walls block, water does not).
export function sightLine(game, x0, y0, x1, y1) {
  const map = game?.map;
  if (!map?.blocksProjectile) return true;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 8));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    try {
      if (map.blocksProjectile(Math.floor((x0 + (x1 - x0) * t) / TILE), Math.floor((y0 + (y1 - y0) * t) / TILE))) return false;
    } catch {
      return true;
    }
  }
  return true;
}

// Say something aloud: a bubble plus the `speech` event everyone listens to.
export function speak(game, speaker, text, kind = 'say', target = null, duration) {
  if (!text) return;
  try {
    game?.bubbles?.say?.(speaker, text, duration ? { kind, duration } : { kind });
  } catch {
    /* bubbles are cosmetic */
  }
  try {
    game?.bus?.emit?.('speech', { speaker, text, target, kind });
  } catch {
    /* listeners must not break the speaker */
  }
}

export function pickLine(game, list, avoid) {
  if (!Array.isArray(list) || !list.length) return null;
  if (list.length === 1) return list[0];
  for (let k = 0; k < 4; k++) {
    const l = list[Math.floor(rand(game) * list.length)];
    if (l !== avoid) return l;
  }
  return list[0];
}
