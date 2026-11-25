// Sleep and sit (r13; the author: "I can't sit anywhere, and I can't sleep"). Pure rules
// over the game objects, used by the beds and seats (src/world/objects.js), game.sleep
// and the player's controls:
//   sleepBlocked(game, actor) -> why not, or null   (any hour; never with a fight near)
//   SEAT_TYPES; seatFor(obj) -> a free seat on it    sitDown / standUp / keepSeated
// A seat is one tile of a chair, stool, bench or pew's footprint, shared with the
// villagers' own sitting (npc.js seatOn: obj._sitters).

import { TILE } from '../core/constants.js';

export const SEAT_TYPES = new Set(['chair', 'stool', 'bench', 'pew']);
export const FIGHT_NEAR = 10 * TILE; // a hostile this close keeps you awake
export const HIT_RECENT = 8; // seconds since a blow landed on you

function alive(e) {
  return !!e && !e.removed && !e.dead && (typeof e.isAlive === 'function' ? e.isAlive() : (e.hp ?? 1) > 0);
}

// The nearest hostile awake within `r`, or null.
export function foeNear(game, who, r = FIGHT_NEAR) {
  const list = game?.entities?.all?.() || game?.entities?.list || [];
  const combat = game?.combat;
  const r2 = r * r;
  let best = null;
  let bd = Infinity;
  for (const e of list) {
    if (!e || e === who || e.type !== 'actor' || !alive(e) || e.downed) continue;
    const dx = e.x - who.x;
    const dy = e.y - who.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2 || d2 >= bd) continue;
    let hostile = false;
    try {
      hostile = combat?.isHostile ? combat.isHostile(e, who) : !!e.hostile;
    } catch {
      hostile = false;
    }
    if (hostile) {
      best = e;
      bd = d2;
    }
  }
  return best;
}

// Why the player cannot lie down now (a sentence), or null. Any hour will do (the author
// could not sleep before 6 PM); a fight close by, or a blow just taken, will not.
export function sleepBlocked(game, actor = game?.player) {
  if (!actor) return 'There is nobody to sleep.';
  if (actor.downed || game?.survival?.isFallen?.(actor)) return 'Not while you lie bleeding.';
  if (actor.carrying) return 'Put them down first.';
  const t = game?.clock?.t ?? 0;
  const hit = actor.lastAttackedAt;
  if (Number.isFinite(hit) && t - hit >= 0 && t - hit < HIT_RECENT) return 'Not with blood still up. Get clear of the fight first.';
  const foe = foeNear(game, actor);
  if (foe) return `Not with ${foe.name ? (/^(the|a|an) /i.test(foe.name) ? foe.name.toLowerCase() : foe.profile ? foe.name : `a ${String(foe.name).toLowerCase()}`) : 'danger'} this close. Deal with it, or get away first.`;
  return null;
}

// A free seat on a chair, stool, bench or pew: { i, x, y } (the sitter's feet), or null.
export function seatFor(o, who = null) {
  if (!o || !SEAT_TYPES.has(o.objType) || o.removed || o.broken || o.state?.broken) return null;
  const f = o.footprint || { x: o.tx ?? Math.floor(o.x / TILE), y: o.ty ?? Math.floor(o.y / TILE), w: 1, h: 1 };
  const sitters = o._sitters || [];
  const n = Math.max(1, f.w | 0);
  // The seat nearest the one asking.
  const order = [...Array(n).keys()];
  if (who) order.sort((a, b) => Math.abs((f.x + a) * TILE + TILE / 2 - who.x) - Math.abs((f.x + b) * TILE + TILE / 2 - who.x));
  for (const i of order) {
    const s = sitters[i];
    if (s && s !== who && !s.removed && s.seat?.obj === o) continue;
    return { i, x: (f.x + i) * TILE + TILE / 2, y: o.y + 1 };
  }
  return null;
}

// Sit `actor` (the player) on `o`. -> { ok, reason? }
export function sitDown(game, actor, o) {
  if (!actor || !o) return { ok: false, reason: 'Nothing to sit on.' };
  if (actor.downed || actor.dead) return { ok: false, reason: 'Not now.' };
  if (actor.carrying) return { ok: false, reason: 'Not with someone on your shoulders.' };
  if (actor.seat?.obj === o) return { ok: true };
  if (actor.seat) standUp(game, actor);
  const s = seatFor(o, actor);
  if (!s) return { ok: false, reason: 'Somebody is sitting there.' };
  const sitters = (o._sitters ||= []);
  sitters[s.i] = actor;
  actor.seat = { obj: o, i: s.i, x: s.x, y: s.y, from: { x: actor.x, y: actor.y } };
  actor.x = s.x;
  actor.y = s.y;
  if (actor.vel) actor.vel.x = actor.vel.y = 0;
  if (actor.moveIntent) actor.moveIntent.x = actor.moveIntent.y = 0;
  // A chair at a table faces it (its variant); a bench, stool or pew faces out.
  actor.faceDir?.(o.objType === 'chair' && (o.variant === 'left' || o.variant === 'right') ? o.variant : 'down');
  actor.setState?.('sit');
  game?.bus?.emit?.('sat_down', { actor, seat: o });
  return { ok: true };
}

// Up again, where they stood before sitting.
export function standUp(game, actor) {
  const s = actor?.seat;
  if (!s) return false;
  actor.seat = null;
  if (s.obj?._sitters?.[s.i] === actor) s.obj._sitters[s.i] = null;
  if (s.from) {
    actor.x = s.from.x;
    actor.y = s.from.y;
  }
  if (actor.state === 'sit') actor.setState?.('idle');
  game?.bus?.emit?.('stood_up', { actor, seat: s.obj });
  return true;
}

// The player's controls while seated: moving stands up (and walks on), a swing, a roll or
// the use button stands up and is spent doing so. -> true while they stay in the seat.
export function keepSeated(game, actor, { move = null, attack = false, dodge = false, interact = false } = {}) {
  const s = actor?.seat;
  if (!s) return false;
  // Knocked, hurt, downed, the seat gone: up.
  if (actor.downed || actor.dead || actor.state !== 'sit' || s.obj?.removed || s.obj?.broken || Math.hypot(actor.x - s.x, actor.y - s.y) > 4) {
    standUp(game, actor);
    return false;
  }
  if (move && (Math.abs(move.x) > 0.2 || Math.abs(move.y) > 0.2)) {
    standUp(game, actor);
    return false;
  }
  if (attack || dodge || interact) {
    standUp(game, actor);
    return true;
  }
  if (actor.vel) actor.vel.x = actor.vel.y = 0;
  if (actor.moveIntent) actor.moveIntent.x = actor.moveIntent.y = 0;
  return true;
}
