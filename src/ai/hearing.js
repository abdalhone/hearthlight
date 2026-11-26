// One rule for who hears what (DESIGN §29.4; the author, of Wenna crying out in the street
// at a killing inside the Ember Kettle: "How does it sees the death from the wall?").
// Hearing is a sense like sight (sight.js): every ear in Hearthvale goes through hears() —
// the village answering a cry for help (npc.js onCallForHelp), the watch hearing a blow
// (npc.js onCrime), the words of a witness's scream (murder.seenMurder), a fallen victim's
// words (murder.tick), and the toast that says whether anyone heard (murder.heardBy).
//
//   hears(game, listener, x, y, loud, { mul })  -> 'clear' | 'muffled' | null
//   heardFrom(game, x, y, loud, people)         -> [{ id, how, d }] nearest first
//   cryLoudness(severity)                       -> px a cry carries in open air
//
// - The reach comes from the loudness: px in open air (LOUD; a cry by severity is the old
//   HELP_HEAR 300 / 440 / 600). `mul` widens it for one listener (kin know the voice).
// - A wall or a shut door between them (walls.js wallBetween) muffles it hard: heard only
//   within MUFFLE (under a third) of the open-air reach, and only 'muffled'; each further wall
//   muffles again. A scream inside a shut house is heard just outside it, not down the street.
// - An open door lets it out: in line with the doorway it is open air ('clear'); round the
//   corner, along the way through the doorway, it carries DOOR of the reach ('muffled').
// - Asleep: a third of the reach (the loudest scream, 0.6).
// - Hearing tells WHAT and WHERE, never WHO. A listener who only heard knows a sound and a
//   place; who did it is known by eyes (sight.js) or by words face to face (TELL_REACH, the
//   village's news by meeting). The callers keep to that.

import { TILE } from '../core/constants.js';
import { wallBetween, wallTile } from '../world/walls.js';

export const LOUD = Object.freeze({
  word: 44, // px: words said to someone close (a fallen victim telling who did it)
  talk: 96, // px: a scream's words made out (who and what), in the open
  blow: 300, // px: a blow and a cry of pain (an assault)
  shout: 300, // a cry for help, severity 1
  cry: 440, // severity 2: hurt, struck again
  scream: 600, // severity 3: knocked down, a killing
});
export const MUFFLE = 0.3; // share of the reach a wall lets through
export const DOOR = 0.6; // share of the reach that carries round through an open doorway
const EAR = 6; // px above the feet: where heads are
const SLEEP = 0.3; // share of the reach that wakes a sleeper (the loudest: SLEEP_LOUD)
const SLEEP_LOUD = 0.6;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// How far a cry for help carries in open air, by severity 1..3 (npc.js's old HELP_HEAR).
export function cryLoudness(severity = 1) {
  const s = Math.max(1, Math.min(3, Math.round(Number(severity) || 1)));
  return [0, LOUD.shout, LOUD.cry, LOUD.scream][s];
}

// Awake enough to hear and in the world: not dead, downed, gone or carried. (Asleep they
// still hear, less: see hears().)
export function canHear(e) {
  if (!e || e.removed || e.absent || e.dead || e.downed || e.carriedBy) return false;
  if (typeof e.isAlive === 'function' && !e.isAlive()) return false;
  return true;
}

// How many walls (runs of wall tiles, or shut doors) the straight line crosses, end tiles
// aside; at most `max`.
export function wallsBetween(game, x0, y0, x1, y1, max = 3) {
  if (!safe(() => wallBetween(game, x0, y0, x1, y1), false)) return 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(d / (TILE / 4)));
  const t0x = Math.floor(x0 / TILE);
  const t0y = Math.floor(y0 / TILE);
  const t1x = Math.floor(x1 / TILE);
  const t1y = Math.floor(y1 / TILE);
  let runs = 0;
  let inWall = false;
  let lx = t0x;
  let ly = t0y;
  for (let i = 1; i < n; i++) {
    const tx = Math.floor((x0 + (dx * i) / n) / TILE);
    const ty = Math.floor((y0 + (dy * i) / n) / TILE);
    if (tx === lx && ty === ly) continue;
    lx = tx;
    ly = ty;
    if ((tx === t0x && ty === t0y) || (tx === t1x && ty === t1y)) continue;
    const w = safe(() => wallTile(game, tx, ty), false);
    if (w && !inWall) runs++;
    inWall = w;
    if (runs >= max) break;
  }
  return Math.max(1, runs);
}

// The shortest way a sound at (x, y) takes to the listener through an open doorway (both
// legs clear of walls), or Infinity.
function viaOpenDoor(game, lx, ly, x, y, reach) {
  const doors = safe(() => game.objects?.inRadius?.(x, y, reach, (o) => o.objType === 'door' && !o.removed && (o.isOpen || o.state?.open)), []) || [];
  let best = Infinity;
  for (const o of doors) {
    const dx = Number.isFinite(o.tx) ? o.tx * TILE + TILE / 2 : o.x;
    const dy = Number.isFinite(o.ty) ? o.ty * TILE + TILE / 2 : o.y;
    const a = Math.hypot(dx - x, dy - y);
    const b = Math.hypot(lx - dx, ly - dy);
    if (a + b >= best || a + b > reach) continue;
    if (safe(() => wallBetween(game, x, y, dx, dy), true)) continue;
    if (safe(() => wallBetween(game, dx, dy, lx, ly), true)) continue;
    best = a + b;
  }
  return best;
}

// Does `listener` hear a sound of loudness `loud` (px in open air) made at (x, y) right now?
// -> 'clear' (in the open: the sound, and words if close enough), 'muffled' (through a wall
// or round a doorway: something, somewhere over there), or null.
export function hears(game, listener, x, y, loud, { mul = 1 } = {}) {
  if (!canHear(listener) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  let r = Math.max(0, Number(loud) || 0) * (Number(mul) > 0 ? Number(mul) : 1);
  if (listener.state === 'sleep') r *= r >= LOUD.scream ? SLEEP_LOUD : SLEEP;
  if (!(r > 0)) return null;
  const lx = listener.x;
  const ly = listener.y - EAR;
  const sy = y - EAR;
  const d = Math.hypot(lx - x, ly - sy);
  if (d > r) return null;
  const walls = wallsBetween(game, lx, ly, x, sy);
  if (!walls) return 'clear';
  // Out through an open door and round: further than through a wall.
  const via = viaOpenDoor(game, lx, ly, x, sy, r * DOOR);
  if (via <= r * DOOR) return 'muffled';
  if (d <= r * Math.pow(MUFFLE, walls)) return 'muffled';
  return null;
}

// Everyone of `people` (entities) who hears it, nearest first: [{ id, e, how, d }].
export function heardFrom(game, x, y, loud, people = [], { mulOf = null, exclude = [] } = {}) {
  const out = [];
  const skip = new Set(exclude);
  for (const e of people) {
    if (!e || skip.has(e) || skip.has(e.id)) continue;
    const how = hears(game, e, x, y, loud, { mul: mulOf ? mulOf(e) : 1 });
    if (how) out.push({ id: e.id, e, how, d: Math.round(Math.hypot(e.x - x, e.y - y)) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// Can `listener` make out words said by `speaker` (a fallen victim naming who did it, a
// witness screaming who): close, and clear (no wall: a wall leaves only a muffled noise).
export function hearsWords(game, listener, speaker, reach = LOUD.word) {
  if (!speaker || !listener || speaker === listener) return false;
  return hears(game, listener, speaker.x, speaker.y, reach) === 'clear';
}

// Which place a sound came from (a location id, or null out in the lanes and fields).
export function placeOfSound(game, x, y) {
  const loc = safe(() => game?.locations?.at?.(x, y), null);
  if (!loc || loc.id === 'hearthvale' || loc.id === 'wilds') return null;
  return loc.id;
}
