import { TILE } from '../../core/constants.js';
import { ITEMS } from '../../entities/items.js';

// Small helpers shared by Lyra's behavior modules. Gameplay randomness only
// (never world or sprite generation), so Math.random is fine here.

export const rand = (a = 0, b = 1) => a + (b - a) * Math.random();
export const chance = (p) => Math.random() < p;
export const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const tileOf = (px) => Math.floor(px / TILE);
export const tileCenter = (t) => t * TILE + TILE / 2;
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Pick a line from a list without repeating the last one used for the same key,
// so a command spammed three times still sounds like a person answering.
const lastPicked = new Map();
export function line(key, list) {
  if (!list || !list.length) return '';
  if (list.length === 1) return list[0];
  const last = lastPicked.get(key);
  let i = Math.floor(Math.random() * list.length);
  if (list[i] === last) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  lastPicked.set(key, list[i]);
  return list[i];
}

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const WORD_NUMS = Object.fromEntries(NUM_WORDS.map((w, i) => [w, i]));

export function numberWord(n) {
  return Number.isInteger(n) && n >= 0 && n < NUM_WORDS.length ? NUM_WORDS[n] : String(n);
}

// "5", "five", "a few", "a couple of", "a dozen" -> number; "some"/unknown -> null.
export function parseQty(text) {
  if (text == null) return null;
  const t = String(text).toLowerCase().trim().replace(/\s+of$/, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (t in WORD_NUMS) return WORD_NUMS[t] || null;
  if (t === 'a' || t === 'an' || t === 'a single' || t === 'one more') return 1;
  if (/^(a )?couple$/.test(t) || t === 'a pair' || t === 'pair') return 2;
  if (/^(a )?few$/.test(t)) return 3;
  if (t === 'several') return 4;
  if (t === 'a dozen' || t === 'dozen') return 12;
  if (/^(a lot|lots|plenty|loads|a bunch|a pile|heaps)$/.test(t)) return 10;
  return null;
}

// Human durations for speech: 60 -> "a minute", 30 -> "thirty seconds".
export function durationWords(s) {
  s = Math.max(1, Math.round(s));
  if (s === 90) return 'a minute and a half';
  if (s % 60 === 0) {
    const m = s / 60;
    return m === 1 ? 'a minute' : `${numberWord(m)} minutes`;
  }
  if (s < 60) return `${numberWord(s)} seconds`;
  return `${Math.round(s / 6) / 10} minutes`;
}

// How Lyra says item amounts: [singular, plural]. Mass nouns repeat.
const SPEECH_NAMES = {
  coin: ['coin', 'coins'],
  wood: ['wood', 'wood'],
  stone: ['stone', 'stones'],
  iron_ore: ['chunk of iron ore', 'chunks of iron ore'],
  crystal: ['glow crystal', 'glow crystals'],
  herb: ['healing herb', 'healing herbs'],
  moonpetal: ['moonpetal', 'moonpetals'],
  berries: ['handful of berries', 'handfuls of berries'],
  turnip: ['turnip', 'turnips'],
  wheat: ['sheaf of wheat', 'sheaves of wheat'],
  raw_fish: ['fish', 'fish'],
  cooked_fish: ['grilled fish', 'grilled fish'],
  bread: ['loaf of bread', 'loaves of bread'],
  honey_cake: ['honey cake', 'honey cakes'],
  stew: ['bowl of stew', 'bowls of stew'],
  potion: ['healing potion', 'healing potions'],
  wolf_pelt: ['wolf pelt', 'wolf pelts'],
  slime_gel: ['blob of slime gel', 'blobs of slime gel'],
  bone: ['old bone', 'old bones'],
  iron_sword: ['iron sword', 'iron swords'],
  ruins_key: ['rusted key', 'rusted keys'],
  maren_journal: ["Maren's journal", "Maren's journals"],
  lantern: ['lantern', 'lanterns'],
};

export function itemWord(id, qty = 1) {
  const s = SPEECH_NAMES[id];
  if (s) return qty === 1 ? s[0] : s[1];
  const name = (ITEMS[id]?.name || String(id).replace(/_/g, ' ')).toLowerCase();
  return qty === 1 ? name : name.endsWith('s') ? name : `${name}s`;
}

// "five wood", "a healing potion", "an old bone".
export function qtyPhrase(id, qty) {
  const w = itemWord(id, qty);
  if (qty === 1) {
    if (id === 'wood' || id === 'raw_fish' || id === 'cooked_fish' || id === 'maren_journal') return id === 'maren_journal' ? w : `some ${w}`;
    return /^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`;
  }
  return `${numberWord(qty)} ${w}`;
}

// A list of {id, qty} as words: "five wood and two stones".
export function itemsPhrase(list) {
  const parts = list.filter((i) => i.qty > 0).map((i) => qtyPhrase(i.id, i.qty));
  if (parts.length <= 1) return parts[0] || 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const TITLES = new Set(['captain', 'sister', 'brother', 'master', 'mistress', 'old', 'father', 'mother', 'lady', 'lord', 'sir']);

// The name Lyra uses in a sentence: "you", "Bram", "Captain Rowan", "the wolf".
export function nameOf(game, e) {
  if (!e) return 'that';
  if (e === game?.player || e.id === 'player') return 'you';
  // An animal she has named carries that name in her relationships.
  const rel = relOf(game, e);
  if (rel?.name && Array.isArray(rel.tags) && rel.tags.includes('pet') && rel.name !== e.name) return rel.name;
  const raw = String(e.name || e.species || e.objType || 'that').replace(/"[^"]*"\s*/g, '').trim();
  if (e.species || e.objType || e.type === 'pickup') return `the ${raw.toLowerCase()}`;
  const words = raw.split(/\s+/);
  if (words.length > 1 && TITLES.has(words[0].toLowerCase())) return `${words[0]} ${words[1]}`;
  return words[0];
}

// Lyra's relationship record for an entity, or null (never throws).
export function relOf(game, e) {
  const rels = game?.companion?.mind?.relationships;
  if (!rels || typeof rels.get !== 'function' || !e?.id) return null;
  try {
    return rels.get(e.id) || null;
  } catch {
    return null;
  }
}

// Named place phrases: { name: 'the Ember Kettle', to: 'to the Ember Kettle', at: 'at the Ember Kettle' }.
export function placePhrase(loc) {
  if (!loc) return { name: 'there', to: 'there', at: 'there' };
  if (loc.id === 'player_home' || loc.kind === 'home') return { name: 'home', to: 'home', at: 'at home' };
  const n = String(loc.name || loc.id || 'there').replace(/^The /, 'the ').replace(/^Your /, 'your ');
  return { name: n, to: `to ${n}`, at: `at ${n}` };
}

// Phrase for any resolved goal (see Behavior.resolveGoal).
export function goalPhrase(game, goal) {
  if (!goal) return { name: 'there', to: 'there', at: 'there' };
  if (goal.location) return placePhrase(goal.location);
  if (goal.entity) {
    const n = nameOf(game, goal.entity);
    return { name: n, to: n === 'you' ? 'to you' : `to ${n}`, at: n === 'you' ? 'by you' : `by ${n}` };
  }
  if (goal.object) {
    const n = objectName(goal.object);
    return { name: n, to: `to ${n}`, at: `by ${n}` };
  }
  return { name: 'that spot', to: 'over there', at: 'there' };
}

export function objectName(o) {
  if (!o) return 'that';
  const raw = String(o.name && o.name !== o.objType ? o.name : o.objType || 'that').replace(/_/g, ' ');
  if (/^(the|a|an|your|my) /i.test(raw)) return raw.replace(/^The /, 'the ').replace(/^Your /, 'your ');
  if (/^[A-Z]/.test(raw) && raw.includes("'")) return raw; // "Lyra's Bed"
  return `the ${raw.toLowerCase()}`;
}

// --- world queries (all guarded: other modules may be stubs or missing) ---

export function walkable(game, tx, ty, actor = null) {
  try {
    if (game.isBlockedTile) return !game.isBlockedTile(tx, ty, actor);
    if (game.map?.isSolidTile) return !game.map.isSolidTile(tx, ty, actor);
  } catch {
    return false;
  }
  return true;
}

// True when a walker can go straight from (x0,y0) to (x1,y1) without touching a
// blocked tile. Samples the center line and both feet edges.
export function walkLineClear(game, x0, y0, x1, y1, actor = null, r = 4) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1) return walkable(game, tileOf(x1), tileOf(y1), actor);
  const nx = -dy / d;
  const ny = dx / d;
  const steps = Math.ceil(d / 6);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    if (!walkable(game, tileOf(px), tileOf(py), actor)) return false;
    if (!walkable(game, tileOf(px + nx * r), tileOf(py + ny * r), actor)) return false;
    if (!walkable(game, tileOf(px - nx * r), tileOf(py - ny * r), actor)) return false;
  }
  return true;
}

// Projectile line of sight: walls (map.blocksProjectile) and closed doors block.
export function lineOfSight(game, x0, y0, x1, y1) {
  const map = game.map;
  if (!map) return true;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(d / 4));
  let lastTx = -9999;
  let lastTy = -9999;
  for (let i = 1; i < steps; i++) {
    const tx = tileOf(x0 + (dx * i) / steps);
    const ty = tileOf(y0 + (dy * i) / steps);
    if (tx === lastTx && ty === lastTy) continue;
    lastTx = tx;
    lastTy = ty;
    try {
      if (map.blocksProjectile?.(tx, ty)) return false;
      const door = game.objects?.doorAt?.(tx, ty);
      if (door && !doorIsOpen(door)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function doorIsOpen(door) {
  if (!door) return true;
  if (typeof door.isOpen === 'boolean') return door.isOpen;
  return !!door.state?.open;
}

export function doorIsLocked(door) {
  if (!door) return false;
  if (typeof door.locked === 'boolean') return door.locked;
  return !!door.state?.locked;
}

// Nearest walkable tile center to (x, y), searching rings out to `maxR` tiles.
export function nearestWalkable(game, x, y, maxR = 4, actor = null) {
  const cx = tileOf(x);
  const cy = tileOf(y);
  if (walkable(game, cx, cy, actor)) return { x: tileCenter(cx), y: tileCenter(cy) };
  for (let r = 1; r <= maxR; r++) {
    let best = null;
    let bd = Infinity;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
        if (!walkable(game, tx, ty, actor)) continue;
        const d = dist(x, y, tileCenter(tx), tileCenter(ty));
        if (d < bd) {
          bd = d;
          best = { x: tileCenter(tx), y: tileCenter(ty) };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// Where to stand to use an object: its own tile when walkable and not solid,
// else the walkable neighbor nearest to `from` (front/south side preferred).
const NEIGHBORS = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
export function standSpotFor(game, obj, fromX, fromY, actor = null) {
  const tx = obj.tx ?? tileOf(obj.x);
  const ty = obj.ty ?? tileOf(obj.y - 1);
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < NEIGHBORS.length; i++) {
    const nx = tx + NEIGHBORS[i][0];
    const ny = ty + NEIGHBORS[i][1];
    if (!walkable(game, nx, ny, actor)) continue;
    const px = tileCenter(nx);
    const py = tileCenter(ny);
    // Diagonals and the back side are slightly less natural places to work from.
    const d = dist(fromX, fromY, px, py) + (i === 0 ? 0 : i < 4 ? 6 : 14);
    if (d < bd) {
      bd = d;
      best = { x: px, y: py };
    }
  }
  if (!best && !obj.solid && walkable(game, tx, ty, actor)) best = { x: tileCenter(tx), y: tileCenter(ty) + 3 };
  return best;
}

export function isActorAlive(e) {
  if (!e || e.removed || e.dead) return false;
  try {
    return typeof e.isAlive === 'function' ? e.isAlive() : e.hp > 0;
  } catch {
    return false;
  }
}

export function onScreen(game, x, y, margin = 16) {
  const c = game.camera;
  if (!c || !c.vw || !c.vh) return false;
  return x >= c.x - margin && y >= c.y - margin && x <= c.x + c.vw + margin && y <= c.y + c.vh + margin * 2;
}

// Warn once per key per few seconds: a misbehaving module should be visible in the
// console without flooding it at 60 Hz.
const warned = new Map();
export function warnOnce(key, err) {
  const now = Date.now();
  if ((warned.get(key) || 0) > now - 5000) return;
  warned.set(key, now);
  console.warn(`[behavior] ${key}`, err);
}

// Call into another module; swallow and report failures.
export function safe(key, fn, fallback = null) {
  try {
    return fn();
  } catch (err) {
    warnOnce(key, err);
    return fallback;
  }
}
