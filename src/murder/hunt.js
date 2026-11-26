// The hunt (round 14b, item 8; DESIGN §35.2; the author: "the people should fight me, not
// just let me kill their whole village"). A known killer is hunted: once the bell has rung
// (raiseAlarm) the watch, Hess and any defender who saw it make a posse. They go to where
// the killer was LAST SEEN by someone who reported it, never to where the killer really is:
//
//   - a posse member's own eyes put the stranger on the map at once;
//   - anyone else who knows the stranger is wanted and sees them carries the sighting to the
//     posse face to face (news by meeting: close, and no wall between, src/ai/hearing.js);
//   - the posse walks there and searches; seen, they fight, and their leash is lifted while
//     the chase lasts; lost, the place they lost the stranger is the new last-seen;
//   - two hours with nothing new and the trail goes cold until someone reports again;
//   - the hunt ends when the stranger is no longer wanted (the Moot, a surrender, the time).
//
// murder.hunt = { about, since, lastSeen: { x, y, t, by, place } | null, posse: [ids],
//                 reports: { seerId: { x, y, t, place } }, state: 'search' | 'cold' | 'over' }
// Saved with murder.serialize. Pure apart from the game it reads.

import { hearsWords } from '../ai/hearing.js';
import { isDefender } from '../entities/defenders.js';
import { HOUR, DAY } from './data.js';

const TELL = 64; // px: a sighting is told to a posse member this close, face to face
const COLD_AFTER = 2 * HOUR; // nothing new for this long: the trail goes cold
const SEARCH_SPREAD = 36; // px around the last-seen spot each searcher takes
export const CHASE = Object.freeze({ far: 420, leash: 2400 }); // the leash lifted for the posse
const WATCH = ['rowan', 'wys', 'hess'];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function aliveOn(m, id) {
  const e = m.entity(id);
  return !!e && !e.removed && !e.dead && !e.absent && !m.dead[id] && (typeof e.isAlive !== 'function' || e.isAlive());
}

// Who rides with the hunt: the watch, Hess, and the defenders who saw the killing.
export function posseFor(m, rec) {
  const ids = WATCH.filter((id) => aliveOn(m, id));
  for (const s of rec?.seen || []) {
    if (ids.includes(s.id) || s.id === 'lyra') continue;
    const e = m.entity(s.id);
    if (e && aliveOn(m, s.id) && isDefender(m.game, e) && !e.isGuard) ids.push(s.id);
  }
  return ids;
}

// The bell has rung: a known killer is hunted from where they were last seen (the killing).
export function startHunt(m, rec, by = null) {
  if (!rec) return null;
  const t = m.now();
  const prev = m.hunt && m.hunt.state !== 'over' ? m.hunt : null;
  const lastSeen = prev?.lastSeen && prev.lastSeen.t > rec.t ? prev.lastSeen : { x: rec.x, y: rec.y, t: Math.round(rec.t), by: by || rec.seen?.[0]?.id || null, place: rec.place || null };
  m.hunt = { about: rec.id, since: Math.round(prev?.since ?? t), lastSeen, posse: posseFor(m, rec), reports: prev?.reports || {}, state: 'search', heardAt: Math.round(t) };
  m.emit('hunt_started', { about: rec.id, posse: m.hunt.posse.slice(), lastSeen: { ...lastSeen } });
  return m.hunt;
}

export function active(m) {
  return !!m.hunt && m.hunt.state !== 'over';
}

// Does this villager know the stranger is wanted (their own knowledge, npc.knowsWanted)?
function knows(m, e) {
  const P = m.game?.player;
  if (!e || !P) return false;
  if (typeof e.knowsWanted === 'function') return !!safe(() => e.knowsWanted(P), false);
  return m.isWanted();
}

// A fresh sighting of the stranger (village life's sight sweep, sight.onSeen).
export function sighting(m, seerId) {
  const h = m.hunt;
  if (!h || h.state === 'over' || !seerId || seerId === 'player' || seerId === 'lyra') return;
  const P = m.game?.player;
  const e = m.entity(seerId);
  if (!P || !e || !knows(m, e)) return;
  const at = { x: Math.round(P.x), y: Math.round(P.y), t: Math.round(m.now()), by: seerId, place: m.placeOf(P) };
  if (h.posse.includes(seerId)) see(m, at);
  else h.reports[seerId] = at;
}

function see(m, at) {
  const h = m.hunt;
  if (!h || (h.lastSeen && h.lastSeen.t > at.t)) return;
  h.lastSeen = at;
  h.state = 'search';
  h.heardAt = Math.round(m.now());
}

// Once a second (murder.slowTick): reports told face to face, the trail going cold, the end.
export function tickHunt(m) {
  const h = m.hunt;
  if (!h || h.state === 'over') return;
  if (!m.isWanted()) {
    h.state = 'over';
    m.emit('hunt_over', { about: h.about });
    return;
  }
  const g = m.game;
  const t = m.now();
  h.posse = h.posse.filter((id) => aliveOn(m, id));
  // Someone who saw the stranger meets one of the posse: they tell them where.
  for (const [id, at] of Object.entries(h.reports)) {
    const e = m.entity(id);
    if (!e || !aliveOn(m, id) || t - at.t > DAY) {
      delete h.reports[id];
      continue;
    }
    for (const pid of h.posse) {
      const p = m.entity(pid);
      if (!p || Math.hypot(p.x - e.x, p.y - e.y) > TELL) continue;
      if (!safe(() => hearsWords(g, p, e, TELL), true)) continue;
      see(m, at);
      delete h.reports[id];
      break;
    }
  }
  if (h.state === 'search' && t - (h.heardAt ?? t) > COLD_AFTER) h.state = 'cold';
}

// A posse member's day while the hunt is on: to the last-seen spot, spread out, looking.
export function entryFor(m, npc, e, hour) {
  const h = m.hunt;
  if (!h || h.state !== 'search' || !h.lastSeen || !npc?.id || !h.posse.includes(npc.id)) return null;
  void e;
  void hour;
  const i = h.posse.indexOf(npc.id);
  const ang = (i / Math.max(1, h.posse.length)) * Math.PI * 2;
  const spot = { x: h.lastSeen.x + Math.cos(ang) * SEARCH_SPREAD * (i ? 1 : 0.3), y: h.lastSeen.y + Math.sin(ang) * SEARCH_SPREAD * (i ? 1 : 0.3) };
  return { activity: 'errand', at: h.lastSeen.place || 'town_square', spot, vl: `hunt-${h.lastSeen.t}-${i}`, doing: `hunting ${m.playerName()}, last seen ${h.lastSeen.place ? `near ${m.placeName(h.lastSeen.place)}` : 'out in the open'}` };
}

// The leash a posse member fights the hunted stranger with (npc.fightStep): lifted.
export function chaseOf(m, npc, target) {
  const h = m.hunt;
  if (!h || h.state === 'over' || !npc || target !== m.game?.player || !h.posse.includes(npc.id)) return null;
  return CHASE;
}

// A posse member lost the stranger (the fight ended without them down): last seen there.
export function lost(m, npc, target) {
  const h = m.hunt;
  if (!h || h.state === 'over' || !npc || !target || target !== m.game?.player || !h.posse.includes(npc.id)) return;
  see(m, { x: Math.round(target.x), y: Math.round(target.y), t: Math.round(m.now()), by: npc.id, place: m.placeOf(target) });
}

export function serializeHunt(h) {
  if (!h) return null;
  return { about: h.about, since: h.since, lastSeen: h.lastSeen ? { ...h.lastSeen } : null, posse: h.posse.slice(), reports: { ...h.reports }, state: h.state, heardAt: h.heardAt ?? null };
}

export function deserializeHunt(d) {
  if (!d || typeof d !== 'object' || typeof d.about !== 'string') return null;
  const ls = d.lastSeen && Number.isFinite(d.lastSeen.x) && Number.isFinite(d.lastSeen.y) ? { ...d.lastSeen } : null;
  return { about: d.about, since: Number(d.since) || 0, lastSeen: ls, posse: Array.isArray(d.posse) ? d.posse.filter((x) => typeof x === 'string') : [], reports: d.reports && typeof d.reports === 'object' ? { ...d.reports } : {}, state: ['search', 'cold', 'over'].includes(d.state) ? d.state : 'cold', heardAt: Number.isFinite(d.heardAt) ? d.heardAt : null };
}
