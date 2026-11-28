import { TILE, DAY_SECONDS } from '../core/constants.js';
import { dropItem } from '../entities/pickups.js';
import { playHit, playDust } from '../render/pixel_fx_play.js';
import { wallBetween } from './walls.js';
import { materialOf, refreshFences } from './broken.js';
import { NEED, sayNeed } from './tools.js';

// Things that break (DESIGN §31.3). The player's blows land on the world's props as well as
// on its people: the sword, and every weave body (missiles and beams stop at a prop they
// meet; bursts, rings, cones, the strike's fist and wave reach every prop in them, never
// through a wall). Damage builds up on a prop: small blows chip it (a jolt, chips flying),
// and once its toughness is spent it breaks:
//   - a tree falls away from the blow, leaving its stump; its logs land along the trunk to
//     pick up, and it grows back in a day (the tree's own regrowth);
//   - a rock cracks to rubble and gives its stones; a berry bush is torn and gives its
//     berries (each grows back the way it always did);
//   - fences, barrels, crates, carts, signs, woodpiles, pots, sacks, hay and bushes burst
//     into debris (pixelfx dust and chips) and sometimes a little wood; the debris lies
//     there, walkable, until it is mended or grows back (MEND below).
// Never: buildings (tiles), doors, windows, beds, chests, lamps, hearths, wells, anything a
// story needs (`story`, and every sign of a boss on its trail: `trailBoss`), the notice
// board and the signs hung on buildings. A chest (a trunk, a strongbox, the wilds' loot
// chests) is never in BREAKABLE: a blow neither opens nor spills it. A locked one keeps its
// own ways in (containers.js: its key, its keeper, or forcing the hasp at the chest itself
// with the use button, which is theft if it is someone's), and what is in it stays in it. A prop you can
// look at breaks like the rest (its words come back with it when it is mended). The
// training dummy never breaks: it counts blows (training XP below).
// Broken and felled state lives on each object's state, so the save keeps it.
// Only the player's blows break things; everyone else's pass over props as they always did.

const DAY = DAY_SECONDS;

// hp: toughness, in blow damage. A Strike's fist counts x4 and a heavy blow x3.5 (a bomb,
// a rune, a heavy missile), a charged weave up to x2 more; a sword blow counts half (and
// never fells a tree or cracks a rock: that is the axe's and the pick's work).
export const BREAKABLE = {
  tree: { hp: 56, sword: false },
  rock: { hp: 48, sword: false },
  berry_bush: { hp: 8 },
  bush: { hp: 10, mend: DAY },
  fence: { hp: 18, drops: [['wood', 0.35, 1]] },
  barrel: { hp: 16, drops: [['wood', 0.5, 1]] },
  crate: { hp: 14, drops: [['wood', 0.6, 1]] },
  cart: { hp: 40, drops: [['wood', 1, [1, 2]]] },
  sign: { hp: 20, drops: [['wood', 0.5, 1]] },
  woodpile: { hp: 24, drops: [['wood', 1, [2, 3]]] },
  pot: { hp: 6 },
  sack: { hp: 8, drops: [['wheat', 0.3, 1]] },
  hay: { hp: 10 },
  dummy: { training: true },
  // Iron (round 15, item 9; tools.js): an ore vein takes a blow (a missile stops at it, the
  // blade rings off it) and never breaks to one: only a pickaxe mines it (objects.js Rock).
  ore: { iron: true },
};
export const MEND = 2 * DAY; // a village prop is mended two days after it was broken

export const BLOW = { punch: 4, heavy: 3.5, sword: 0.5 };

// Training (DESIGN §31.4): each blow that lands on a dummy is worth TRAIN_XP, up to
// TRAIN_DAY a day for the dummy (so a training yard teaches, but never levels you alone).
export const TRAIN_XP = 1;
export const TRAIN_DAY = 40;

const DUST = {
  wood: ['#1e140c', '#3b2414', '#6a4428', '#9c6a40', '#c8a070', '#efd8b4'],
  stone: ['#1c1a24', '#3a3846', '#5e5a6c', '#8c889a', '#bcb8c8', '#e6e4ee'],
  clay: ['#2a140c', '#5a2c18', '#8a4a2c', '#b8764c', '#dca47c', '#f4d4b8'],
  cloth: ['#2a2014', '#5a4a30', '#8a7650', '#b8a47c', '#ddd0a8', '#f6eed6'],
  straw: ['#3a2c0c', '#6a5220', '#9c7e34', '#c8a24a', '#ecd48a', '#fbf0c8'],
  leaf: ['#0e1c0e', '#1f3a1e', '#2f5a2a', '#4f8a40', '#7cb860', '#c4e8a8'],
};
const CHIPS = { wood: 'wood_chip', stone: 'stone_chip', clay: 'stone_chip', cloth: 'dust', straw: 'leaf', leaf: 'leaf' };
const CHIP_COLOR = { wood: '#ad7a48', stone: '#8c889a', clay: '#b8764c', cloth: '#c8b48c', straw: '#e0c060', leaf: '#6fa34c' };
const SOUNDS = { wood: 'chop', stone: 'mine', clay: 'mine', cloth: 'hit', straw: 'hit', leaf: 'hit' };

// What can be struck here, and how, or null.
export function breakSpec(o) {
  if (!o || o.removed || o.hidden) return null;
  const spec = BREAKABLE[o.objType];
  if (!spec) return null;
  // A sign of a boss (boss_trails.js: the toll board, the scored trunks) is what a story
  // needs: it points the way, so a blow never takes it (round 13 x 14a seam).
  if (o.unbreakable || o.story || o.trailBoss) return null;
  // Whatever holds things (a chest's inventory) never breaks: its contents are never lost
  // in the rubble nor spilled twice.
  if (o.inventory || o.objType === 'chest') return null;
  if (spec.training) return spec;
  // The notice board and the signs hung on buildings stay. A prop you can look at (the
  // Holloways' barrels, the thatching reed) breaks like any other and reads again once it
  // is mended: only what a story needs is marked `story` (the author: "a strike and a heavy
  // spell should break trees and also anything else").
  if (o.objType === 'sign' && (o.id === 'notice_board' || o.variant === 'board' || o.variant === 'hanging' || !o.solid)) return null;
  return spec;
}

// Standing, whole and worth a blow: not broken, not a stump or rubble, not mid-fall.
export function intact(o) {
  if (!o || o.removed || o.hidden || o.state?.broken) return false;
  if (o.objType === 'tree' || o.objType === 'rock' || o.objType === 'ore') return !o.state?.depleted && !o._fall;
  if (o.objType === 'berry_bush') return !o.state?.depleted;
  return true;
}

export function strikable(o) {
  return !!breakSpec(o) && intact(o);
}

// The rectangle a prop stands on (world px): its footprint, or its base tile.
export function rectOf(o, out = { x0: 0, y0: 0, x1: 0, y1: 0 }) {
  const f = o.footprint;
  if (f) {
    out.x0 = f.x * TILE;
    out.y0 = f.y * TILE;
    out.x1 = (f.x + f.w) * TILE;
    out.y1 = (f.y + f.h) * TILE;
  } else {
    out.x0 = o.tx * TILE;
    out.y0 = o.ty * TILE;
    out.x1 = out.x0 + TILE;
    out.y1 = out.y0 + TILE;
  }
  return out;
}

const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
const NEAREST = { x: 0, y: 0, d: 0 };

// The point of a prop's ground rectangle nearest (x, y), nudged a pixel inside it.
function nearestPoint(o, x, y) {
  rectOf(o, R);
  NEAREST.x = Math.max(R.x0 + 1, Math.min(R.x1 - 1, x));
  NEAREST.y = Math.max(R.y0 + 1, Math.min(R.y1 - 1, y));
  NEAREST.d = Math.hypot(NEAREST.x - x, NEAREST.y - y);
  return NEAREST;
}

// The intact breakable prop standing on the tile under (x, y), or null (a missile or a
// ray meeting it stops there).
export function propAt(game, x, y) {
  const l = game?.objects?.objectsAt?.(Math.floor(x / TILE), Math.floor(y / TILE));
  if (!l) return null;
  for (let i = 0; i < l.length; i++) {
    const o = l[i];
    if (o.solid && strikable(o) && o.blocksTile?.(Math.floor(x / TILE), Math.floor(y / TILE), null)) return o;
  }
  return null;
}

const LIST = [];
// Intact breakable props whose ground rectangle a circle touches, with a clear line from its
// centre (fills and returns a shared array). cone: { ang, arc } limits it to a wedge.
export function propsInCircle(game, x, y, r, cone = null) {
  LIST.length = 0;
  const objs = game?.objects;
  if (!objs?.inRadius || !(r > 0)) return LIST;
  let found;
  try {
    found = objs.inRadius(x, y + 8, r + 24, strikable);
  } catch {
    return LIST;
  }
  for (let i = 0; i < found.length; i++) {
    const o = found[i];
    const p = nearestPoint(o, x, y);
    if (p.d > r) continue;
    if (cone && p.d > 6) {
      rectOf(o, R);
      const cx = (R.x0 + R.x1) / 2;
      const cy = (R.y0 + R.y1) / 2;
      const slack = Math.atan2((R.x1 - R.x0) / 2, Math.max(1, Math.hypot(cx - x, cy - y)));
      let d = Math.atan2(cy - y, cx - x) - cone.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > cone.arc + slack) continue;
    }
    if (wallBetween(game, x, y - 3, p.x, p.y)) continue;
    LIST.push(o);
  }
  return LIST;
}

// The sword's arc over props (combat.melee, the player's swings only): every breakable prop
// in front within reach. Returns how many it struck.
export function swingAtProps(game, attacker, { fx, fy, minCos, range, power, heavy }) {
  let n = 0;
  const list = propsInCircle(game, attacker.x, attacker.y, range + 4);
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const p = nearestPoint(o, attacker.x, attacker.y);
    if (p.d > 6) {
      const dx = (p.x - attacker.x) / p.d;
      const dy = (p.y - attacker.y) / p.d;
      // The prop's middle or its nearest edge in the arc.
      rectOf(o, R);
      const mx = (R.x0 + R.x1) / 2 - attacker.x;
      const my = (R.y0 + R.y1) / 2 - attacker.y;
      const ml = Math.hypot(mx, my) || 1;
      if (dx * fx + dy * fy < minCos && (mx * fx + my * fy) / ml < minCos) continue;
    }
    if (strikeProp(game, o, { source: attacker, amount: power, sword: true, heavy, dirX: fx, dirY: fy })) n++;
  }
  return n;
}

// A blow lands on a prop. blow: { source, amount (the blow's damage), sword, heavy, punch,
// charge (0..1), tick (a beam's or a patch's tick), dirX, dirY, pal (a weave palette),
// pooled (the runtime pools tick numbers: pass magic) }. Returns true if the prop took it.
export function strikeProp(game, o, blow = {}) {
  const spec = breakSpec(o);
  if (!spec || !intact(o)) return false;
  const src = blow.source || null;
  if (src && src !== game.player && src.id !== 'player') return false;
  if (spec.training) return trainOn(game, o, spec, blow);
  if (spec.iron) return ringOff(game, o, blow);
  if (blow.sword && spec.sword === false) return false;
  const amount = Math.max(0, Number(blow.amount) || 0);
  if (!(amount > 0)) return false;
  const charge = Math.max(0, Math.min(1, Number(blow.charge) || 0));
  const mul = (blow.punch ? BLOW.punch : blow.heavy ? BLOW.heavy : 1) * (1 + charge) * (blow.sword ? BLOW.sword : 1);
  o._dmg = (o._dmg || 0) + amount * mul;
  o._hitAt = game.time ?? 0;
  o._hitDir = (blow.dirX ?? 1) < 0 ? -1 : 1;
  const mat = materialOf(o);
  if (o._dmg >= spec.hp) breakProp(game, o, spec, blow);
  else chip(game, o, mat, blow);
  return true;
}

// Iron (round 15): the blow rings off. Sparks, a high clink, a jolt, and the word that a
// pickaxe is what it wants; nothing breaks and nothing is given.
function ringOff(game, o, blow) {
  o._hitAt = game.time ?? 0;
  o._hitDir = (blow.dirX ?? 1) < 0 ? -1 : 1;
  if (blow.tick && (game.time ?? 0) - (o._chipAt ?? -1) < 0.18) return true;
  o._chipAt = game.time ?? 0;
  emit(game, 'hit', o.x, o.y - 8, { count: blow.tick ? 2 : 6, color: '#ffd9a0', speed: 70, life: 0.3, dir: { x: -(blow.dirX || 0), y: -(blow.dirY || 0) } });
  if (!blow.tick) sound(game, 'mine', o.x, o.y, { pitch: 1.6, volume: 0.7 });
  sayNeed(game, blow.sword ? 'ring' : 'weave', blow.sword ? NEED.ring : NEED.weave);
  return true;
}

// A blow that did not break it: chips fly, a knock, the prop jolts (its draw).
function chip(game, o, mat, blow) {
  if (blow.tick && (game.time ?? 0) - (o._chipAt ?? -1) < 0.18) return;
  o._chipAt = game.time ?? 0;
  const y = o.y - (o.objType === 'tree' ? 14 : 8);
  emit(game, CHIPS[mat] || 'dust', o.x, y, { count: blow.tick ? 2 : 4, color: CHIP_COLOR[mat], speed: 40, life: 0.5, dir: { x: blow.dirX || 0, y: blow.dirY || 0 } });
  if (o.objType === 'tree') emit(game, 'leaf', o.x, o.y - 30, { count: blow.tick ? 1 : 3, spread: 12 });
  if (!blow.tick) sound(game, SOUNDS[mat] || 'hit', o.x, o.y, { volume: 0.6 });
}

// Spent: the prop breaks.
function breakProp(game, o, spec, blow) {
  const mat = materialOf(o);
  const dir = (blow.dirX ?? 1) < 0 ? -1 : 1;
  o._dmg = 0;
  if (o.objType === 'tree') {
    // It goes over away from the blow; the logs land along the trunk when it does.
    o.fell?.(dir, (items, t) => landTree(game, t, items, dir));
    sound(game, 'chop', o.x, o.y, { pitch: 0.7 });
    emit(game, 'wood_chip', o.x, o.y - 8, { count: 8 });
    game.bus?.emit?.('prop_broken', { object: o, by: blow.source || null, kind: 'tree' });
    return;
  }
  if (o.objType === 'rock' || o.objType === 'berry_bush') {
    const items = o._harvest?.(blow.source || null) || [];
    scatter(game, items, o.x, o.y - 4);
    dust(game, o, mat, 0.8);
    sound(game, o.objType === 'rock' ? 'mine' : 'hit', o.x, o.y, { pitch: 0.75 });
    game.bus?.emit?.('prop_broken', { object: o, by: blow.source || null, kind: o.objType });
    return;
  }
  o.state.broken = true;
  o.state.mendAt = (game.clock?.t ?? 0) + (spec.mend ?? MEND);
  o.markDirty?.();
  o._changed?.(true);
  if (o.objType === 'fence') refreshFences(game.objects, o);
  const drops = [];
  for (const [id, chance, qty] of spec.drops || []) {
    if (rand(game) >= chance) continue;
    const n = Array.isArray(qty) ? qty[0] + Math.floor(rand(game) * (qty[1] - qty[0] + 1)) : qty || 1;
    if (n > 0) drops.push({ id, qty: n });
  }
  scatter(game, drops, o.x, o.y - 4);
  dust(game, o, mat, o.footprint ? 1.1 : 0.8);
  emit(game, CHIPS[mat] || 'dust', o.x, o.y - 8, { count: 10, color: CHIP_COLOR[mat], speed: 70, life: 0.7 });
  sound(game, SOUNDS[mat] || 'hit', o.x, o.y, { pitch: 0.65, volume: 1 });
  shake(game, 1.2, 0.12);
  game.bus?.emit?.('prop_broken', { object: o, by: blow.source || null, kind: o.objType });
}

// The tree hits the ground: a cloud of dust and leaves, a thump, its logs along the trunk.
function landTree(game, t, items, dir) {
  const len = t.kind === 'pine' ? 30 : 36;
  const ex = t.x + dir * len;
  dust(game, { x: t.x + dir * len * 0.55, y: t.y, footprint: null }, 'wood', 1.4);
  emit(game, 'leaf', ex, t.y - 6, { count: 16, spread: 18 });
  sound(game, 'chop', t.x, t.y, { pitch: 0.5, volume: 1 });
  shake(game, 2, 0.2);
  let k = 0;
  for (const it of items || []) {
    for (let i = 0; i < it.qty; i++) {
      const along = 0.35 + 0.55 * ((k++ * 0.37) % 1);
      // One log per piece, lying along where the trunk fell, never inside a wall.
      let x = t.x + dir * len * along;
      const y = t.y - 2 + ((k % 2) * 2 - 1) * 2;
      if (wallBetween(game, t.x, t.y - 3, x, y - 3)) x = t.x + dir * 6;
      // No random pop: a log lies where the trunk put it, not rolled back to the stump.
      safeDrop(game, it.id, 1, x, y, { pop: false, collectDelay: 0.4 });
    }
  }
}

function scatter(game, items, x, y) {
  let k = 0;
  for (const it of items || []) {
    const n = Math.max(1, Math.floor(it.qty) || 1);
    const a = k++ * 2.1;
    safeDrop(game, it.id, n, x + Math.cos(a) * 3, y + Math.sin(a) * 2);
  }
}

function safeDrop(game, id, qty, x, y, opts) {
  try {
    dropItem(game, id, qty, x, y, opts);
  } catch (err) {
    console.warn('[breakables] drop failed', err);
  }
}

// ---------------------------------------------------------------- the training dummy

// A blow on a dummy: a number like any hit (crits too), a spark in the blow's colors, the
// dummy rocks on its post, and the training XP (TRAIN_XP a blow, TRAIN_DAY a day).
function trainOn(game, o, spec, blow) {
  const amount = Math.max(0, Number(blow.amount) || 0);
  if (!(amount > 0)) return false;
  const c = game.combat;
  const random = typeof c?.random === 'function' ? () => c.random() : Math.random;
  const src = blow.source;
  const st = (k, d) => {
    const v = src && game.stats?.get ? game.stats.get(src, k) : NaN;
    return Number.isFinite(v) ? v : d;
  };
  const crit = !blow.tick && random() < st('crit', 0.1);
  const charge = Math.max(0, Math.min(1, Number(blow.charge) || 0));
  const dealt = Math.max(1, Math.round(amount * (0.9 + random() * 0.2) * (crit ? st('critMul', 1.5) : 1)));
  o._hitAt = game.time ?? 0;
  o._hitDir = (blow.dirX ?? 1) < 0 ? -1 : 1;
  const top = o.y - 28;
  if (blow.tick && blow.pooled?._number) blow.pooled._number(o, dealt, blow.pal?.glow || '#f4ead7');
  else {
    number(game, o.x, top, crit ? `${dealt}!` : String(dealt), crit ? '#ffb047' : '#f4ead7', {
      crit,
      kind: crit ? 'crit' : 'damage',
      scale: charge > 0 ? 1 + 0.2 * charge : undefined,
    });
    const played = playHit(game, { x: o.x, y: o.y, radius: 6, z: 0 }, { dx: blow.dirX || 0, dy: blow.dirY || 0, crit, heavy: !!(blow.heavy || blow.punch), pal: blow.pal || null });
    if (!played) emit(game, 'hit', o.x, o.y - 14, { count: crit ? 9 : 5, color: '#e0c060', speed: 60, life: 0.35, dir: { x: blow.dirX || 0, y: blow.dirY || 0 } });
    emit(game, 'leaf', o.x, o.y - 16, { count: 2, color: '#e0c060', speed: 30, life: 0.6 });
    sound(game, 'hit', o.x, o.y, { pitch: crit ? 1.15 : 0.85 + random() * 0.15, volume: 0.8 });
  }
  giveTrainingXp(game, o, src, blow.tick ? 0.25 : 1);
  game.bus?.emit?.('dummy_hit', { object: o, by: src || null, amount: dealt, crit });
  return true;
}

// The day's training on this dummy: whole points go to the player, shown as "+1 xp" a
// little above the numbers (gathered, so a flurry reads as one rising count).
function giveTrainingXp(game, o, who, share) {
  const p = who || game.player;
  if (!p || !game.combat?.giveXp) return;
  const day = Math.floor((game.clock?.t ?? 0) / DAY);
  const s = o.state;
  if (s.xpDay !== day) {
    s.xpDay = day;
    s.xpGiven = 0;
  }
  if (s.xpGiven >= TRAIN_DAY) {
    if (!o._toldTired || o._toldTired !== day) {
      o._toldTired = day;
      try {
        if (p === game.player) game.ui?.toast?.('The dummy has taught you all it can today. Come back tomorrow, or go and find a real fight.', 'info', { key: 'dummy' });
      } catch {
        /* ui optional */
      }
    }
    return;
  }
  o._xpPart = (o._xpPart || 0) + TRAIN_XP * share;
  if (o._xpPart < 1) return;
  const n = Math.min(Math.floor(o._xpPart), TRAIN_DAY - s.xpGiven);
  o._xpPart -= n;
  s.xpGiven += n;
  o.markDirty?.();
  game.combat.giveXp(p, n);
  const now = game.time ?? 0;
  // One rising "+N xp" at a time.
  if (now - (o._xpShownAt ?? -9) < 0.45) o._xpPend = (o._xpPend || 0) + n;
  else {
    o._xpShownAt = now;
    number(game, o.x, o.y - 40, `+${n + (o._xpPend || 0)} xp`, '#e4b83d', { kind: 'xp' });
    o._xpPend = 0;
  }
}

// ---------------------------------------------------------------- guarded effects

function rand(game) {
  const r = game.rng;
  if (r?.next) return r.next();
  return Math.random();
}

function emit(game, type, x, y, opts) {
  try {
    game.particles?.emit?.(type, x, y, opts);
  } catch {
    /* cosmetic */
  }
}

function sound(game, name, x, y, extra) {
  try {
    game.audio?.play?.(name, { x, y, ...(extra || {}) });
  } catch {
    /* cosmetic */
  }
}

function number(game, x, y, text, color, opts) {
  try {
    game.bubbles?.number?.(x, y, text, color, opts);
  } catch {
    /* cosmetic */
  }
}

function shake(game, s, t) {
  try {
    game.camera?.shake?.(s, t);
  } catch {
    /* cosmetic */
  }
}

// The pixelfx dust cloud in the material's colors; plain dust particles without it.
function dust(game, o, mat, size) {
  const played = playDust(game, o.x, o.y, { palette: DUST[mat] || DUST.wood, size });
  if (!played) emit(game, 'dust', o.x, o.y - 4, { count: 10, speed: 30, life: 0.6 });
}
