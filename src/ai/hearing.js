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
//   silence(game, e, seconds) / isSilenced(game, e) / voiceOf(game, e, loud)
//                                               -> a person held silent (round 14b: the
//                                                  Unkindling's hold, a silent killing) makes
//                                                  no sound: loudness 0, heard by nobody
//
// - The reach comes from the loudness: px in open air (LOUD; a cry by severity is the old
//   HELP_HEAR 300 / 440 / 600). `mul` widens it for one listener (kin know the voice).
// - A wall or a shut door between them (walls.js wallBetween) muffles it hard: heard only
//   within MUFFLE (under a third) of the open-air reach, and only 'muffled'; each further wall
//   muffles again. A scream inside a shut house is heard just outside it, not down the street.
// - An open door lets it out: in line with the doorway it is open air ('clear'); round the
//   corner, along the way through the doorway, it carries DOOR of the reach ('muffled').
//   The way round is the shortest walk over open ground (roundPath: through any number of
//   open doors and gaps, a partition's opening and then the front door; round the end of a
//   fence), never through a wall or a shut door (round 15, item 5: the one-doorway gap).
// - Trees muffle (round 15, item 5; the author: "sound passes through trees"): each standing
//   tree on the straight line takes LEAF of what is left of the reach (a berry bush half as
//   much, each tile of forest floor's undergrowth an eighth), down to LEAF_MIN; two trees or more between
//   and it is 'muffled', a sound somewhere in the wood. A stump, a felled tree and open
//   ground do not. Words said to someone (talk) ignore it (`leaves: false`).
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
export const LEAF = 0.8; // share of the reach a standing tree on the line lets through
export const LEAF_MIN = 0.25; // a whole wood muffles no more than this
export const LEAF_MUFFLED = 2; // trees (by weight) between: only a muffled sound
const LEAF_WEIGHT = { tree: 1, berry_bush: 0.5 };
const FOREST_FLOOR = 8; // tiles.js T.FOREST: undergrowth between the trunks
const FLOOR_WEIGHT = 0.12;
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

// Held silent (round 14b, DESIGN §37.2): a person whose voice is taken (the Unkindling's
// channel, murder.kill's `silent`) makes no sound for anyone, until `seconds` pass (Infinity:
// for good). Every cry, call for help, scream and blow they would make is loudness 0
// through voiceOf(), so hears() hears nothing, behind nothing, a tile away. The clock is the
// game's (game.clock.t, else game.time).
function nowOf(game) {
  const t = game?.clock?.t;
  return Number.isFinite(t) ? t : Number(game?.time) || 0;
}

export function silence(game, e, seconds = Infinity) {
  if (!e) return null;
  const until = seconds === Infinity ? Infinity : nowOf(game) + Math.max(0, Number(seconds) || 0);
  const prev = typeof e.silentUntil === 'number' && !Number.isNaN(e.silentUntil) ? e.silentUntil : -Infinity;
  e.silentUntil = Math.max(prev, until);
  return e.silentUntil;
}

export function unsilence(e) {
  if (e) e.silentUntil = -Infinity;
}

export function isSilenced(game, e) {
  if (!e || typeof e !== 'object') return false;
  const u = e.silentUntil;
  return u === Infinity || (Number.isFinite(u) && u > nowOf(game));
}

// The loudness a sound from `e` really has: 0 while they are held silent.
export function voiceOf(game, e, loud) {
  return isSilenced(game, e) ? 0 : loud;
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

// How much foliage the straight line from (x0, y0) to (x1, y1) passes (round 15, item 5):
// standing trees 1 each, a berry bush 0.5, forest floor 0.12 a tile; the end tiles do not count
// (someone leaning on a trunk still hears). Stops counting at `max`.
export function leavesBetween(game, x0, y0, x1, y1, max = 8) {
  const objects = game?.objects;
  const map = game?.map;
  if (!objects?.objectsAt && !map?.tileAt) return 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < TILE) return 0;
  const n = Math.max(1, Math.ceil(d / (TILE / 2)));
  const t0x = Math.floor(x0 / TILE);
  const t0y = Math.floor(y0 / TILE);
  const t1x = Math.floor(x1 / TILE);
  const t1y = Math.floor(y1 / TILE);
  let lx = t0x;
  let ly = t0y;
  let w = 0;
  for (let i = 1; i < n; i++) {
    const tx = Math.floor((x0 + (dx * i) / n) / TILE);
    const ty = Math.floor((y0 + (dy * i) / n) / TILE);
    if (tx === lx && ty === ly) continue;
    lx = tx;
    ly = ty;
    if ((tx === t0x && ty === t0y) || (tx === t1x && ty === t1y)) continue;
    let here = 0;
    const list = safe(() => objects?.objectsAt?.(tx, ty), null);
    if (list) {
      for (let j = 0; j < list.length; j++) {
        const o = list[j];
        const lw = LEAF_WEIGHT[o.objType];
        if (!lw || o.removed || o._fall || o.state?.depleted) continue;
        here = Math.max(here, lw);
      }
    }
    if (!here && safe(() => map?.tileAt?.(tx, ty), -1) === FOREST_FLOOR) here = FLOOR_WEIGHT;
    w += here;
    if (w >= max) return max;
  }
  return w;
}

// The share of the reach foliage of weight `w` lets through.
export function leafShare(w) {
  return w > 0 ? Math.max(LEAF_MIN, Math.pow(LEAF, w)) : 1;
}

// The shortest walk over open ground (no wall tile, no shut door) from (x, y) to the listener's
// tile, in px, or Infinity past `reach` (round 15, item 5: through any number of open doors and
// gaps, replacing the single open-door detour). A distance field from the sound's tile,
// 8-way with no cutting of a wall's corner, kept for the rest of this moment of game time so
// everyone who might hear one cry shares one search.
const ROUND = { key: '', field: null };
function nowKey(game) {
  return `${game?.clock?.t ?? ''}:${game?.time ?? ''}`;
}
export function roundPath(game, lx, ly, x, y, reach) {
  const R = Math.ceil(reach / TILE);
  if (!(R > 0)) return Infinity;
  const sx = Math.floor(x / TILE);
  const sy = Math.floor(y / TILE);
  const ex = Math.floor(lx / TILE);
  const ey = Math.floor(ly / TILE);
  if (Math.abs(ex - sx) > R || Math.abs(ey - sy) > R) return Infinity;
  // (Kept while nothing that could change it has: the moment, and every door in reach.)
  const doors = safe(() => game.objects?.inRadius?.(x, y, reach + TILE, (o) => o.objType === 'door' && !o.removed), []) || [];
  let sig = '';
  for (const o of doors) sig += o.isOpen || o.state?.open ? '1' : '0';
  const key = `${nowKey(game)}|${sx},${sy},${R}|${sig}`;
  let field = ROUND.key === key && ROUND.game === game ? ROUND.field : null;
  if (!field) {
    field = distanceField(game, sx, sy, R);
    ROUND.key = key;
    ROUND.game = game;
    ROUND.field = field;
  }
  const W = 2 * R + 1;
  const d = field[(ey - sy + R) * W + (ex - sx + R)];
  if (!Number.isFinite(d)) return Infinity;
  // Tile steps to px, plus the bits from the points to their tile centres.
  const px = d * TILE + Math.hypot(x - (sx * TILE + TILE / 2), y - (sy * TILE + TILE / 2)) * 0.5 + Math.hypot(lx - (ex * TILE + TILE / 2), ly - (ey * TILE + TILE / 2)) * 0.5;
  return px <= reach ? px : Infinity;
}

export function distanceField(game, sx, sy, R) {
  const W = 2 * R + 1;
  const dist = new Float64Array(W * W).fill(Infinity);
  const open = new Int8Array(W * W).fill(-1); // -1 unknown, 0 wall, 1 open
  const isOpen = (i, tx, ty) => {
    let v = open[i];
    if (v < 0) {
      v = safe(() => wallTile(game, tx, ty), true) ? 0 : 1;
      open[i] = v;
    }
    return v === 1;
  };
  const start = R * W + R;
  dist[start] = 0;
  open[start] = 1; // the sound's own tile carries, whatever it is
  // A small binary heap of [d, i].
  const heapD = [];
  const heapI = [];
  const push = (dd, i) => {
    let k = heapD.length;
    heapD.push(dd);
    heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= dd) break;
      heapD[k] = heapD[p];
      heapI[k] = heapI[p];
      k = p;
    }
    heapD[k] = dd;
    heapI[k] = i;
  };
  const pop = () => {
    const topD = heapD[0];
    const topI = heapI[0];
    const lastD = heapD.pop();
    const lastI = heapI.pop();
    const n = heapD.length;
    if (n) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && heapD[r] < heapD[l] ? r : l;
        if (heapD[c] >= lastD) break;
        heapD[k] = heapD[c];
        heapI[k] = heapI[c];
        k = c;
      }
      heapD[k] = lastD;
      heapI[k] = lastI;
    }
    return [topD, topI];
  };
  push(0, start);
  const SQ2 = Math.SQRT2;
  while (heapD.length) {
    const [d, i] = pop();
    if (d > dist[i] || d > R) continue;
    const cx = (i % W) - R;
    const cy = Math.floor(i / W) - R;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < -R || nx > R || ny < -R || ny > R) continue;
        const j = (ny + R) * W + (nx + R);
        if (!isOpen(j, sx + nx, sy + ny)) continue;
        if (ox && oy) {
          // No slipping between two walls that meet at a corner.
          const a = (cy + R) * W + (nx + R);
          const b = (ny + R) * W + (cx + R);
          if (!isOpen(a, sx + nx, sy + cy) || !isOpen(b, sx + cx, sy + ny)) continue;
        }
        const nd = d + (ox && oy ? SQ2 : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          push(nd, j);
        }
      }
    }
  }
  return dist;
}

// Does `listener` hear a sound of loudness `loud` (px in open air) made at (x, y) right now?
// -> 'clear' (in the open: the sound, and words if close enough), 'muffled' (through a wall
// or round a doorway: something, somewhere over there), or null.
export function hears(game, listener, x, y, loud, { mul = 1, leaves = true } = {}) {
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
  if (!walls) {
    // Open air, unless a wood stands between (round 15, item 5).
    if (!leaves) return 'clear';
    const w = leavesBetween(game, lx, ly, x, sy);
    if (!w) return 'clear';
    if (d > r * leafShare(w)) return null;
    return w >= LEAF_MUFFLED ? 'muffled' : 'clear';
  }
  // Out through open doors and gaps and round: further than through a wall.
  const via = roundPath(game, lx, ly, x, sy, r * DOOR);
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
