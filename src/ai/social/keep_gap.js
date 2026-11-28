// Wary people keep their distance (round 15, item 4; the author: "people who are wary of you
// just say so, they don't keep their distance"). Someone who fears or distrusts the stranger
// does not only say it: they step back, keep a gap, never walk next to you, and leave when
// you close in. Talking is never locked (the standing rule): they hear and answer from where
// they stand, and while you talk with them they let you to talking distance, no nearer.
// Terror is the murder code's (they run, src/murder); this is everything short of it.
// DESIGN §40.4. Called from npc.think() (one line) before the day's routine:
//
//   gapFor(game, npc)        -> { tiles, why } | null   how far they keep from you, and why
//                               wary 3 tiles (opinion under 30), cold or cut ties or hostile
//                               4.5, afraid of your dark magic 4, dread (killings seen) 6;
//                               a child one more; while you talk with them, a tile or two
//                               less (talking distance; a wary merchant still trades)
//   keepGap(npc, dt, tick)   -> true when it took this beat (stepping back, holding the gap
//                               facing you, or walking off), else false
//
// The gap has hysteresis and a hold, so it never jitters (DESIGN "hate means distance, not
// jitter"): inside it they step back; once out they stand and face you until you are a tile
// and a half further off; pressed (you keep closing in, or they are backed into a wall) they
// walk off home or away for a while. Never while on a companion's duty, asleep, down, in a
// fight, fleeing or helping someone (those modes run first).

import { TILE } from '../../core/constants.js';
import { isMinor } from '../../core/people.js';

export const GAP = Object.freeze({ wary: 3, dark: 4, cold: 4.5, dread: 6 });
const TALK_LESS = { wary: 1, dark: 1.5, cold: 1.5, dread: 1 };
const CHILD_MORE = 1;
const HOLD_EXTRA = 1.5; // tiles past the gap they stand and watch you before going on
const PRESS = { wary: 2.2, dark: 1.6, cold: 1.6, dread: 0.8 }; // seconds pressed before they leave
const LEAVE_SECONDS = 22;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function now(game) {
  const t = game?.clock?.t;
  return Number.isFinite(t) ? t : Number(game?.time) || 0;
}

// How far `npc` keeps from the stranger now, and why (null: no gap).
export function gapFor(game, npc) {
  if (!game || !npc || npc.removed || npc.dead || npc.downed || npc.absent || npc.carriedBy) return null;
  if (npc.duty || safe(() => game.party?.isCompanion?.(npc), false)) return null;
  const P = game.player;
  if (!P || P.dead || P.downed) return null;
  let why = null;
  const fear = safe(() => game.murder?.fearOf?.(npc), null);
  if (fear === 'terror') return null; // they run: the murder code's flight
  if (fear === 'dread') why = 'dread';
  if (!why) {
    const cut = !!safe(() => game.village?.cutTies?.[npc.id], null);
    const cold = !!safe(() => game.village?.standing?.(npc.id)?.cold, false);
    const op = Number.isFinite(npc.opinionOfPlayer) ? npc.opinionOfPlayer : 30;
    const sus = safe(() => game.unkindle?.suspicion?.people?.[npc.id], null);
    if (cut || op < 15) why = 'cold';
    else if (sus && (sus.fear >= 20 || (sus.dark && op < 50))) why = 'dark';
    else if (cold) why = 'cold';
    else if (op < 30) why = 'wary';
  }
  if (!why) return null;
  let tiles = GAP[why];
  if (safe(() => isMinor(game, npc), false)) tiles += CHILD_MORE;
  // Talking with them (they hear you out): to talking distance, no nearer.
  const talking = now(game) < (npc.talkingUntil ?? -Infinity) || safe(() => game.ui?.chat?.isOpen?.() && game.ui.chat.target === npc.id, false);
  if (talking) tiles -= TALK_LESS[why];
  return { tiles, why, talking };
}

function leaveTarget(npc, P) {
  const home = safe(() => npc.locFor?.(npc.profile?.home), null);
  if (home?.center) {
    const hx = home.center.x - npc.x;
    const hy = home.center.y - npc.y;
    const fx = P.x - npc.x;
    const fy = P.y - npc.y;
    const hl = Math.hypot(hx, hy) || 1;
    const fl = Math.hypot(fx, fy) || 1;
    if ((hx * fx + hy * fy) / (hl * fl) < 0.3 && hl < 900) return { x: home.center.x, y: home.center.y };
  }
  const dx = npc.x - P.x;
  const dy = npc.y - P.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: npc.x + (dx / d) * 10 * TILE, y: npc.y + (dy / d) * 10 * TILE };
}

function still(npc) {
  if (npc.moveIntent) {
    npc.moveIntent.x = 0;
    npc.moveIntent.y = 0;
  }
}

// One beat of keeping the gap. True when it took the beat.
export function keepGap(npc, dt, tick) {
  const game = npc?.game;
  const P = game?.player;
  if (!P) return false;
  const s = (npc._gap ||= { want: null, active: false, pressT: 0, stuckT: 0, leaveUntil: -Infinity, lx: npc.x, ly: npc.y, said: -Infinity });
  if (tick || s.want === undefined) s.want = gapFor(game, npc);
  if (npc.state === 'sleep') return false;
  const t = now(game);
  // Walking off: on until there, or the time is up.
  if (t < s.leaveUntil) {
    if (!s.want) {
      s.leaveUntil = -Infinity;
      return false;
    }
    // A brisk walk; hurried when you follow them close (never more than a run's pace).
    const dd = Math.hypot(P.x - npc.x, P.y - npc.y);
    npc.speedMul = dd < s.want.tiles * TILE * 0.6 ? 1.75 : 1.2;
    const res = safe(() => npc.walker?.step?.(dt), 'idle');
    if (res === 'arrived' || res === 'idle' || res === 'stuck') {
      s.leaveUntil = -Infinity;
      npc.speedMul = 1;
      safe(() => npc.walker?.stop?.());
      npc.r && (npc.r.key = null); // replan from wherever they went
      return false;
    }
    return true;
  }
  const want = s.want;
  if (!want) {
    if (s.active) {
      s.active = false;
      npc.r && (npc.r.key = null);
    }
    return false;
  }
  const d = Math.hypot(P.x - npc.x, P.y - npc.y);
  const r = want.tiles * TILE;
  if (d < r) {
    if (!s.active) {
      s.active = true;
      s.pressT = 0;
      s.stuckT = 0;
      s.lx = npc.x;
      s.ly = npc.y;
      safe(() => npc.wake?.());
    }
    safe(() => npc.walker?.stop?.());
    if (npc.r) npc.r.walking = false;
    npc.speedMul = want.why === 'dread' || d < r * 0.6 ? 1.35 : 1;
    safe(() => npc.steerAway?.(P.x, P.y, 1));
    // Pressed: you keep closing in, or they cannot back off any further.
    if (d < r * 0.6) s.pressT += dt;
    else s.pressT = Math.max(0, s.pressT - dt * 0.5);
    const moved = Math.hypot(npc.x - s.lx, npc.y - s.ly);
    s.lx = npc.x;
    s.ly = npc.y;
    if (moved < 0.15 * dt * 60) s.stuckT += dt;
    else s.stuckT = Math.max(0, s.stuckT - dt);
    if (!want.talking && (s.pressT > PRESS[want.why] || s.stuckT > 1.4)) {
      // They go: home, or well away from you, at a brisk walk (never a run: that is terror).
      const to = leaveTarget(npc, P);
      safe(() => npc.walker?.goTo?.(to.x, to.y));
      s.leaveUntil = t + LEAVE_SECONDS;
      s.pressT = 0;
      s.stuckT = 0;
      if (t - s.said > 30) {
        s.said = t;
        safe(() => npc.icon?.('...'));
      }
    }
    return true;
  }
  if (s.active && d < r + HOLD_EXTRA * TILE) {
    // At the gap: stand and face you (they hear you from here, and answer).
    safe(() => npc.walker?.stop?.());
    still(npc);
    npc.speedMul = 1;
    safe(() => npc.faceToward?.(P.x, P.y));
    s.pressT = Math.max(0, s.pressT - dt);
    return true;
  }
  if (s.active) {
    s.active = false;
    npc.speedMul = 1;
    if (npc.r) npc.r.key = null; // back to their day from here
  }
  return false;
}
