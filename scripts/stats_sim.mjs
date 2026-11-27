// Round 14b stats, second pass: what stat points do in a fight, measured headless with the
// game's own pieces (the stat pipeline, combat, the Weave and the five bosses' real brains
// in the real world), for three rules side by side:
//
//   old    the straight line of 07b2e76 (each point the same, no end)
//   first  the first pass (every effect bent toward a soft cap)
//   new    attributes.js as it stands (speeds bent, everything else gently curving on)
//
// What it measures (the author: "if I put 5 points into something … a little benefit, but
// if I put 10, it's really a benefit"; "I would never be able to be the same power as bosses"):
//
//   1. each effect's total at 0/5/10/20/50/100/200 points;
//   2. hits to kill a slime, a wolf, a bandit and a skeleton with the sword and with Spark,
//      at levels 1, 5 and 12 with 0, 5 and 10 points in Might or Weave;
//   3. hits a boss (its plain blow) and a wolf (grown bolder with your level) need to drop
//      you, with 0, 5, 10, 30 points in Vitality;
//   4. Sparks and novas cast from a full pool before it runs dry (no regen), 0/5/10 Focus;
//   5. seconds to beat each boss, a sword build (Might, the rest in Vitality) and a weave
//      build (Weave, the rest in Focus) played by a bot that walks in, swings or casts, and
//      steps or rolls out of every telegraphed marker, by level and points; and whether the
//      boss dropped it, and how much health it lost.
//
//   6. far out (50, 100, 200 points) beside Varek: your health, sword cuts and Sparks to beat him.
//
// Round 15 (the author: "Bosses are literally too easy … I killed her in 2 hits … fully charged";
// "Increase the mana of modified spells and spells in general"; the Unkindling "too easy"):
//
//   7. weaves: the strongest weave a level-7 and a level-9 stranger can build (two essences, three
//      or four twists; and with a third essence), by what one full-charge cast deals to a boss's
//      body, its cost and its full-charge cost, and how many of it a full pool casts, for an
//      all-Weave, an all-Focus and a half-and-half build;
//   8. power-bosses: seconds and casts to beat each of the five bosses at the level each is meant
//      for (defs.js `level`) and at level 15, with every point in Might, every point in Weave
//      (the Spark bot), and the strongest weave fully charged (half Weave, half Focus);
//   9. souls: the Unkindling's verdict and odds by target: Bram at level 1, the villagers at 7 and
//      15, Varek and the tempter at Free 999.
//
//   node scripts/stats_sim.mjs [--json FILE] [--only stats,foes,boss-hits,mana,reach,bosses,weaves,power-bosses,souls] [--variants old,first,new] [--seeds 3]
import { writeFileSync } from 'node:fs';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Combat } from '../src/entities/combat.js';
import { SPECIES, spawnCreature } from '../src/entities/monsters.js';
import { BossManager } from '../src/bosses/manager.js';
import { BOSSES } from '../src/bosses/defs.js';
import { inShape } from '../src/bosses/kit.js';
import { wallBetween } from '../src/world/walls.js';
import { Magic } from '../src/magic/magic.js';
import { compileWeave } from '../src/magic/compile.js';
import { installProgression } from '../src/progression/index.js';
import { ATTRS, ATTR_IDS, pointsEffect, scaled, THREAT } from '../src/progression/attributes.js';
import { PLAYER_BASE, COMBO, ROLL } from '../src/entities/player.js';
import * as BAL from '../src/magic/balance.js';
import { Shapes } from '../src/magic/shapes.js';
import { Twists } from '../src/magic/twists.js';

const BAL_CHARGE_MANA = () => BAL.CHARGE_MANA;

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const ONLY = opt('--only')?.split(',') || null;
const VARIANTS = opt('--variants')?.split(',') || ['old', 'first', 'new'];
const JSON_OUT = opt('--json');
const want = (k) => !ONLY || ONLY.includes(k);

// ---------------------------------------------------------------- the three rules

// 07b2e76: what one point gave, in a straight line.
const OLD_PER = {
  vitality: { add: { maxHp: 6, hpRegen: 0.12 } },
  might: { add: { atk: 0.8 }, pct: { strike: 0.05 } },
  weave: { add: { spellPower: 0.05 } },
  focus: { add: { maxMana: 5 }, pct: { manaRegen: 0.06, cooldown: -0.02 } },
  grace: { pct: { speed: 0.015 }, add: { dodge: 0.012, crit: 0.01 } },
  resolve: { add: { resist: 0.03, bleedout: 4 }, pct: { carrySpeed: 0.04 } },
};
// The first pass (7e92815): the same per point, bent toward these soft caps by x/√(1+(x/cap)²).
const FIRST_CAP = {
  vitality: { add: { maxHp: 360, hpRegen: 7.2 } },
  might: { add: { atk: 48 }, pct: { strike: 3 } },
  weave: { add: { spellPower: 3 } },
  focus: { add: { maxMana: 250 }, pct: { manaRegen: 3, cooldown: -0.5 } },
  grace: { pct: { speed: 0.7 }, add: { dodge: 0.3, crit: 0.3 } },
  resolve: { add: { resist: 0.5, bleedout: 120 }, pct: { carrySpeed: 0.6 } },
};
function firstEffect(id, n) {
  if (!(n > 0)) return null;
  const out = {};
  for (const part of ['add', 'pct']) {
    if (!OLD_PER[id][part]) continue;
    out[part] = {};
    for (const [k, per] of Object.entries(OLD_PER[id][part])) {
      const x = per * n;
      const c = Math.abs(FIRST_CAP[id][part][k]);
      out[part][k] = x / Math.sqrt(1 + (x / c) ** 2);
    }
  }
  return out;
}
export const RULES = {
  old: (id, n) => scaled(OLD_PER[id], n),
  first: firstEffect,
  new: pointsEffect,
};
const val = (rule, id, part, stat, n) => RULES[rule](id, n)?.[part]?.[stat] ?? 0;

// ---------------------------------------------------------------- a real world, a light game

const SEED = 20261123;
const DT = 1 / 30;
let WORLD = null;
function world() {
  if (!WORLD) {
    const g = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 0, hour: 8 }, entities: { list: [], nearest: () => null } };
    WORLD = generateWorld(g, SEED);
  }
  return WORLD;
}

// A deterministic stream for combat (variance and crits as in the game, the same every run).
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The gear a stranger of this level has usually found by then (the same for every rule).
export function gearFor(level) {
  if (level >= 15) return ['steel_sword', 'iron_mail', 'traveler_cloak'];
  if (level >= 10) return ['steel_sword', 'leather_jerkin'];
  if (level >= 5) return ['iron_sword', 'leather_jerkin'];
  return [];
}

export function makeGame({ hour = 22, rule = 'new', level = 1, points = {}, gear = null, seed = 1, bosses = true } = {}) {
  const W = world();
  const game = {
    bus: new EventBus(),
    rng: new RNG(11),
    flags: {},
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: {},
    clock: {
      t: 0,
      hour,
      day: 1,
      daylight: 0.2,
      get isNight() {
        return this.hour >= 20.5 || this.hour < 5;
      },
      update(dt) {
        this.t += dt;
      },
    },
    particles: { emit() {} },
    camera: { shake() {}, x: -9999, y: -9999, vw: 10, vh: 10 },
    lighting: { flash() {} },
    bubbles: { say() {}, number() {}, icon() {}, clear() {} },
    ui: { toast() {} },
    audio: { play() {}, setMusic() {} },
  };
  game.map = W.map;
  game.objects = W.objects;
  game.locations = W.locations;
  game.spawns = W.spawns;
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = mulberry(seed);
  game.pathfinder = new Pathfinder(game);
  installProgression(game);
  game.magic = new Magic(game);
  game.entities.add(game.magic.layer);
  // The stranger at level 1 (player.js), then grown to `level` with these points and gear.
  const p = new Actor(game, { id: 'player', name: 'You', faction: 'player', maxHp: PLAYER_BASE.maxHp, atk: PLAYER_BASE.atk, def: PLAYER_BASE.def, speed: PLAYER_BASE.speed, radius: 5, x: 0, y: 0 });
  game.player = p;
  game.entities.add(p);
  game.bus.emit('game_start', { loaded: false });
  if (rule !== 'new') {
    game.stats.addSource(
      'points',
      'Points',
      (a) => {
        if (a !== p) return null;
        const out = { add: {}, pct: {} };
        for (const id of ATTR_IDS) {
          const c = RULES[rule](id, game.progression.points[id] || 0);
          for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(c?.[part] || {})) out[part][k] = (out[part][k] || 0) + v;
        }
        return out;
      },
      20,
    );
  }
  p.level = level;
  for (const [id, n] of Object.entries(points)) game.progression.points[id] = n;
  game.progression.changed();
  for (const id of gear || gearFor(level)) {
    p.inventory.add(id, 1);
    game.gear.equip(id);
  }
  game.stats.refresh(p);
  p.hp = p.maxHp;
  game.magic._recomputeMax(9999, true);
  game.magic.mana.cur = game.magic.mana.max;
  if (bosses) {
    game.bosses = new BossManager(game);
    for (const c of W.spawns.creatures) if (c.species === 'bandit_chief') spawnCreature(game, c.species, c.x, c.y, c.opts || {});
    game.bosses.onWorldBuilt();
  }
  return game;
}

export function step(game, dt = DT) {
  game.time += dt;
  game.clock.update(dt);
  game.entities.update(dt);
  game.combat.update(dt);
  game.magic.update(dt);
  game.stats.update(dt);
  game.prices?.update?.(dt);
  game.bosses?.update(dt);
}

// ---------------------------------------------------------------- 1. the effects

const POINTS = [0, 5, 10, 20, 50, 100, 200];
function effectsTable() {
  const rows = [];
  for (const id of ATTR_IDS) {
    for (const part of ['add', 'pct']) {
      for (const stat of Object.keys(OLD_PER[id][part] || {})) {
        const row = { attr: id, stat, part };
        for (const rule of VARIANTS) row[rule] = POINTS.map((n) => Math.round(val(rule, id, part, stat, n) * 1000) / 1000);
        rows.push(row);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------- 2. common foes

const FOES = ['slime', 'wolf', 'bandit', 'skeleton'];
const SPARK = { shape: 'bolt', essences: ['raw'] };
const NOVA = { shape: 'nova', essences: ['raw'] };

// What one cast of a weave hits for, read from the Weave itself (its plan × the caster's power).
function weaveHit(game, weave) {
  const m = game.magic;
  const plan = compileWeave(weave);
  return { dmg: (plan.dmg || 0) * m.powerOf(game.player), cost: m.costOf(game.player, plan), cooldown: m.cooldownOf(game.player, plan), plan };
}

function hitsToKill(game, species, hitAmounts, opts = {}) {
  const s = SPECIES[species];
  const foe = new Actor(game, { id: `dummy_${species}`, name: species, faction: s.faction, kind: 'monster', maxHp: s.hp, atk: s.atk, def: s.def, x: game.player.x + 12, y: game.player.y });
  foe.species = species;
  game.entities.add(foe);
  let n = 0;
  game.combat.random = () => 0.5; // no crit, no variance: the plain number
  while (foe.hp > 0 && n < 99) {
    const amt = hitAmounts[n % hitAmounts.length];
    foe.invuln = 0;
    game.combat.damage(game.player, foe, amt, { exact: true, crit: false, noStagger: true, quiet: true, silent: true, knockback: 0, ...opts });
    n++;
  }
  foe.removed = true;
  return n;
}

function foesTable() {
  const out = [];
  for (const level of [1, 5, 12]) {
    for (const [attr, kind] of [
      ['might', 'sword'],
      ['weave', 'spark'],
    ]) {
      for (const n of [0, 5, 10]) {
        const row = { level, attr, n, kind };
        for (const rule of VARIANTS) {
          const g = makeGame({ rule, level, points: { [attr]: n }, bosses: false });
          const P = g.player;
          let hits;
          if (kind === 'sword') {
            const atk = g.stats.get(P, 'atk');
            hits = COMBO.map((c) => atk * c.mul);
            row[`${rule}_power`] = Math.round(atk * 10) / 10;
          } else {
            const w = weaveHit(g, SPARK);
            hits = [w.dmg];
            row[`${rule}_power`] = Math.round(w.dmg * 10) / 10;
          }
          row[rule] = FOES.map((f) => hitsToKill(g, f, hits, kind === 'spark' ? { kind: 'magic', damageType: 'raw' } : {}));
        }
        out.push(row);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. hits that drop you

function bossHitsTable() {
  const out = [];
  for (const level of [1, 5, 12, 15]) {
    for (const n of [0, 5, 10, 30]) {
      if (n > 3 * (level - 1)) continue;
      const row = { level, n };
      for (const rule of VARIANTS) {
        const g = makeGame({ rule, level, points: { vitality: n }, bosses: false });
        const P = g.player;
        g.combat.random = () => 0.5;
        const hits = {};
        const one = (atk, mul, faction, bossy) => {
          const src = new Actor(g, { id: `hitter_${faction}`, name: 'hitter', faction, kind: 'monster', maxHp: 999, atk, x: P.x + 10, y: P.y });
          if (bossy) src.boss = true;
          g.entities.add(src);
          P.hp = P.maxHp;
          let k = 0;
          while (P.hp > 0 && k < 999) {
            P.invuln = 0;
            g.combat.damage(src, P, atk * mul, { exact: true, crit: false, noStagger: true, quiet: true, silent: true, knockback: 0 });
            k++;
            if (P.downed || P.dead) break;
          }
          src.removed = true;
          P.hp = P.maxHp;
          P.dead = false;
          P.downed = false;
          return k;
        };
        for (const id of ['varek', 'greyjaw', 'lakes_hum', 'bone_warden']) hits[id] = one(BOSSES[id].atk, 1, BOSSES[id].faction, true);
        hits.wolf = one(SPECIES.wolf.atk, 1, 'monster', false);
        row[rule] = hits;
        row[`${rule}_hp`] = P.maxHp;
      }
      out.push(row);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 4. mana

function manaTable() {
  const out = [];
  for (const level of [1, 5, 12, 15]) {
    for (const n of [0, 5, 10, 30]) {
      if (n > 3 * (level - 1)) continue;
      const row = { level, n };
      for (const rule of VARIANTS) {
        const g = makeGame({ rule, level, points: { focus: n }, bosses: false });
        const m = g.magic;
        const sp = weaveHit(g, SPARK);
        const nv = weaveHit(g, NOVA);
        row[rule] = { mana: m.mana.max, sparks: Math.floor(m.mana.max / sp.cost + 1e-9), novas: Math.floor(m.mana.max / nv.cost + 1e-9), regen: Math.round((5 + m.mana.max * 0.025) * g.stats.get(g.player, 'manaRegen') * 10) / 10, cd: Math.round(nv.cooldown * 100) / 100 };
      }
      out.push(row);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 5. the bosses

// Put the player inside the arena's edge and let the manager start the fight.
export function enterArena(game, id) {
  const a = game.bosses.arenas[id];
  const b = game.bosses.get(id);
  let spot = null;
  for (let k = 0; k < 24 && !spot; k++) {
    const ang = (k / 24) * Math.PI * 2;
    for (const f of [0.6, 0.45, 0.3, 0.75]) {
      const x = a.x + Math.cos(ang) * a.r * f;
      const y = a.y + Math.sin(ang) * a.r * f;
      if (!game.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), null) && Math.hypot(x - b.x, y - b.y) > 40) {
        spot = { x, y };
        break;
      }
    }
  }
  const p = game.player;
  p.x = spot.x;
  p.y = spot.y;
  for (let i = 0; i < 30 && !game.bosses.active; i++) step(game);
  return p;
}

// Is the player standing in a marker that is about to land, or on a live hazard?
export function danger(game, b, p) {
  let worst = null;
  for (const m of b.markers) {
    if (!inShape(m, p) && !(m.kind === 'ring' && Math.abs(Math.hypot(p.x - m.x, p.y - m.y) - (m.r || 0)) < 24)) continue;
    const left = (m.dur ?? 0.8) - (m.t ?? 0);
    if (!worst || left < worst.left) worst = { m, left };
  }
  for (const e of game.entities.all()) {
    if (e.type !== 'hazard' || e.removed) continue;
    const r = e.r ?? e.r1 ?? 20;
    if (Math.hypot(e.x - p.x, e.y - p.y) < r + 6) {
      if (!worst) worst = { m: { x: e.x, y: e.y }, left: 1 };
    }
  }
  return worst;
}

// The way out of every marker that is open ground (round 15: the bot no longer backs into a
// corner of the Mother's pools and stands in her hops): the preferred way when it is open, else
// the open direction that leaves the markers soonest, nearest the preferred.
function escapeDir(game, b, p, want) {
  const blocked = (x, y) => game.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), p);
  const inMarker = (x, y) => b.markers.some((m) => inShape(m, { x, y }));
  const ok = (dx, dy) => !blocked(p.x + dx * 12, p.y + dy * 12) && !blocked(p.x + dx * 24, p.y + dy * 24);
  if (ok(want.x, want.y) && !inMarker(p.x + want.x * 34, p.y + want.y * 34)) return null;
  let best = null;
  let bs = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    if (!ok(dx, dy)) continue;
    let steps = 0;
    while (steps < 6 && inMarker(p.x + dx * 12 * (steps + 1), p.y + dy * 12 * (steps + 1))) steps++;
    const score = steps * 10 - (dx * want.x + dy * want.y) * 4;
    if (score < bs) {
      bs = score;
      best = { x: dx, y: dy };
    }
  }
  return best;
}

// One fight: the bot plays until the boss is beaten, the player drops, or `limit` seconds.
// Builds: 'sword' (main in Might, the rest in Vitality), 'weave' (main in Weave, the rest in
// Focus: the Spark bot), and round 15's 'might' (every point in Might), 'weaveall' (every point
// in Weave, the Spark bot) and 'max' (half Weave, half Focus, casting `weave` at full charge
// whenever the pool pays for it, Spark between).
export function buildPoints(build, level, main = 30) {
  const all = 3 * (level - 1);
  const spare = Math.max(0, all - main);
  if (build === 'sword') return { might: main, vitality: spare };
  if (build === 'might') return { might: all };
  if (build === 'weaveall') return { weave: all };
  if (build === 'max') return { weave: Math.ceil(all / 2), focus: Math.floor(all / 2) };
  return { weave: main, focus: spare };
}

export function fight(id, { rule = 'new', build = 'sword', level = 15, main = 30, seed = 1, limit = 240, trace = null, weave = null, potions = 0 } = {}) {
  const points = buildPoints(build, level, main);
  const g = makeGame({ rule, level, points, seed });
  const log = [];
  g.bus.on('boss_defeated', (e) => log.push(e));
  const p = enterArena(g, id);
  const b = g.bosses.get(id);
  const m = g.magic;
  // Both builds carry Spark (the starter weave): the weave build lives by it, the sword
  // build reaches with it what the blade cannot (the Lake's Hum over its water).
  m.setSlot(0, SPARK);
  // The strongest weave (round 15): in slot 1, cast at full charge when the pool pays for it.
  const big = build === 'max' && weave ? weave : null;
  if (big) {
    m.startTrial(); // every part the weave needs (the pool stays the stranger's own)
    m.setSlot(1, big);
  }
  let casts = 0;
  let bigCasts = 0;
  let drunk = 0; // healing potions (40 health each), drunk below a third of your health
  let bossLow = Infinity;
  let swings = 0;
  let charging = 0; // seconds into a charge of the big weave
  g.bus.on('spell_cast', (e) => {
    if (e.caster !== p) return;
    casts++;
    if (e.slot === 1) bigCasts++;
  });
  const start = g.time;
  let combo = 0;
  let next = 0; // when the next swing may start
  let rollCd = 0;
  let rollT = 0;
  let rollDir = null;
  let taken = 0;
  let dealt = 0;
  let lastHit = start;
  let outOfReach = 0;
  let hpLow = p.hp;
  const hp0 = p.maxHp;
  g.bus.on('damage', (e) => {
    if (e.target === p) taken += e.amount || 0;
    if (e.target === b && e.source === p && e.amount > 0) {
      dealt += e.amount;
      lastHit = g.time;
    }
  });
  let dropped = false;
  const swing = (t, who = b) => {
    if (t < next || p.lockTime > 0) return;
    const c = COMBO[combo];
    const rate = g.stats.get(p, 'swing') || 1;
    p.faceToward?.(who.x, who.y);
    g.combat.melee(p, { target: who, arc: c.arc, range: c.range, damageMul: c.mul, knockback: c.knock, launch: c.launch, heavy: c.heavy, lock: c.lock / rate, cooldown: 0.08, silent: true });
    swings++;
    // A hand mashing the button: the next hit chains at 70% of a swing, the third rests.
    if (combo === COMBO.length - 1) {
      next = t + c.lock / rate + 0.2;
      combo = 0;
    } else {
      next = t + (c.lock / rate) * 0.7;
      combo++;
    }
  };
  const clear = () => !wallBetween(g, p.x, p.y - 4, b.x, b.y - 6);
  const spark = (d, who = b) => {
    if (d > 200 || !clear()) return false;
    const r = m.canCast?.(0);
    if (r && !r.ok) return false;
    return !!m.cast(p, 0, { x: who.x, y: who.y - 6, target: who })?.ok;
  };
  // Round 15: a hand deals with what the boss calls in (Varek's lads, the Mother's children)
  // when they close on it, before going back to the boss.
  const addNear = (r) => {
    let best = null;
    let bd = r;
    for (const a of b.adds) {
      if (!a || a.removed || a.dead || !(a.isAlive?.() ?? a.hp > 0)) continue;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  };
  const b0 = b.hp;
  const stuck = { x: p.x, y: p.y, t: g.time };
  let detour = [];
  while (g.time - start < limit) {
    if (log.length) break;
    if (!p.isAlive() || p.downed || p.hp <= 0) {
      dropped = true;
      break;
    }
    const t = g.time;
    rollCd -= DT;
    if (b.mode === 'fight' && b.hp < bossLow) bossLow = b.hp;
    if (drunk < potions && p.hp < p.maxHp * 0.34 && rollT <= 0 && !charging) {
      drunk++;
      g.combat.heal?.(p, p, 40) ?? (p.hp = Math.min(p.maxHp, p.hp + 40));
    }
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const ux = (b.x - p.x) / (d || 1);
    const uy = (b.y - p.y) / (d || 1);
    const hurt = danger(g, b, p);
    let intent = { x: 0, y: 0 };
    const reach = COMBO[combo].range + (b.radius ?? 8) - 2;
    // The big weave's charge: held standing while nothing threatens; a marker under you lets
    // it go (a cancelled charge costs nothing) and you step out.
    if (big && charging > 0) {
      if (hurt || !p.isAlive() || b.veiled || b.mode !== 'fight') {
        m.castCancel(p);
        charging = 0;
      } else {
        charging += DT;
        const h = m.castHold(p, { x: b.x, y: b.y - 6, target: b });
        if (!h) charging = 0;
        else if (h.k >= 1 || h.capped) {
          m.castRelease(p, { x: b.x, y: b.y - 6, target: b });
          charging = 0;
        } else {
          p.moveIntent = { x: 0, y: 0 };
          step(g);
          if (p.hp < hpLow) hpLow = p.hp;
          continue;
        }
      }
    }
    if (rollT > 0) {
      rollT -= DT;
      p.knock.x = rollDir.x * ROLL.speed;
      p.knock.y = rollDir.y * ROLL.speed;
    } else if (hurt) {
      // Out of the marker: away from its middle (or from the boss), a roll when it is about to land.
      let ax = p.x - (hurt.m.x ?? b.x);
      let ay = p.y - (hurt.m.y ?? b.y);
      if (hurt.m.kind === 'line' || hurt.m.kind === 'cone') {
        // Sideways out of a line or a cone.
        const a = hurt.m.angle || 0;
        const sx = -Math.sin(a);
        const sy = Math.cos(a);
        const side = (p.x - hurt.m.x) * sx + (p.y - hurt.m.y) * sy >= 0 ? 1 : -1;
        ax = sx * side;
        ay = sy * side;
      }
      const l = Math.hypot(ax, ay) || 1;
      intent = { x: ax / l, y: ay / l };
      // Round 15: a hand does not run into a wall it can see. When that way is blocked (a
      // corner of the arena), the open way out of every marker is taken instead.
      const open = escapeDir(g, b, p, intent);
      if (open) intent = open;
      if (hurt.left < 0.3 && rollCd <= 0) {
        rollCd = ROLL.cooldown;
        rollT = ROLL.time;
        rollDir = intent;
        p.invuln = Math.max(p.invuln || 0, ROLL.iframes);
      }
    } else if (b.veiled || b.mode !== 'fight') {
      intent = { x: 0, y: 0 };
    } else if ((build === 'sword' || build === 'might') && addNear(30)) {
      const a = addNear(30);
      const da = Math.hypot(a.x - p.x, a.y - p.y);
      if (da > COMBO[combo].range + 4) intent = { x: (a.x - p.x) / da, y: (a.y - p.y) / da };
      else swing(t, a);
    } else if (build !== 'sword' && build !== 'might' && addNear(46) && spark(20, addNear(46))) {
      intent = { x: 0, y: 0 };
    } else if (build === 'sword' || build === 'might') {
      outOfReach = d > reach ? outOfReach + DT : 0;
      if (d > reach) {
        intent = { x: ux, y: uy };
        // Out of the blade's reach a while (over water, across a gap): Spark it.
        if (outOfReach > 1.5) spark(d);
      } else swing(t);
    } else {
      // Keep a weave's distance (about 80–150 px, closer when the bolts stop landing) and
      // cast when it is ready; out of mana and in reach, the sword.
      const far = t - lastHit > 2 || !clear() ? 50 : 150;
      if (d > far) intent = { x: ux, y: uy };
      else if (d < Math.min(80, far - 20)) intent = { x: -ux, y: -uy };
      let started = false;
      if (big && d <= Math.min(170, (m.slotPlan(1)?.aim?.range || 150) + 20) && clear()) {
        const plan = m.slotPlan(1);
        const full = m.costOf(p, plan) * (1 + BAL_CHARGE_MANA());
        if (plan && m.mana.cur >= full && m.canCast(1).ok) {
          const r = m.castStart(p, 1, { x: b.x, y: b.y - 6, target: b }, { charge: true });
          if (r?.ok) {
            charging = DT;
            started = true;
            intent = { x: 0, y: 0 };
          }
        }
      }
      if (!started && !spark(d) && d <= reach && m.mana.cur < m.costOf(p, m.slotPlan(0))) swing(t);
    }
    // Round 15: knocked out of the arena behind a tree or a rock, a hand walks round it: when
    // the bot has wanted to move for half a second and not moved, it follows a path to the boss.
    if (intent.x || intent.y) {
      if (Math.hypot(p.x - stuck.x, p.y - stuck.y) > 3) {
        stuck.x = p.x;
        stuck.y = p.y;
        stuck.t = t;
      } else if (t - stuck.t > 0.5 && !detour.length) {
        const path = g.pathfinder.find(p.x, p.y, b.x, b.y);
        if (Array.isArray(path) && path.length) detour = path.slice(0, 6).map((q) => ({ x: q.x, y: q.y }));
        stuck.t = t;
      }
    }
    if (detour.length && !hurt && rollT <= 0) {
      const q = detour[0];
      const dq = Math.hypot(q.x - p.x, q.y - p.y);
      if (dq < 6) detour.shift();
      else intent = { x: (q.x - p.x) / dq, y: (q.y - p.y) / dq };
      if (d < 70 && clear()) detour = [];
    }
    p.moveIntent = intent;
    if (trace && Math.floor(t * 2) !== Math.floor((t - DT) * 2)) trace({ t: Math.round((t - start) * 10) / 10, p: [Math.round(p.x), Math.round(p.y)], b: [Math.round(b.x), Math.round(b.y)], d: Math.round(d), bhp: Math.round(b.hp), mode: b.mode, move: b.move?.name, veiled: b.veiled, shield: b.mem?.shield?.pips, hurt: !!hurt, mana: Math.round(m.mana.cur), php: Math.round(p.hp), cast: m.canCast?.(0)?.reason });
    step(g);
    if (p.hp < hpLow) hpLow = p.hp;
  }
  return {
    won: log.length > 0,
    dropped,
    casts,
    bigCasts,
    swings,
    drunk,
    bossLow: Math.round(Math.min(bossLow, b.hp)),
    seconds: Math.round((g.time - start) * 10) / 10,
    hp: hp0,
    lowest: Math.max(0, Math.round(hpLow)),
    taken: Math.round(taken),
    dealt: Math.round(dealt),
    bossLeft: Math.round(b.hp),
    boss0: Math.round(b0),
  };
}

const BOSS_LIST = ['varek', 'greyjaw', 'lakes_hum', 'bone_warden'];
const FIGHTS = [
  { level: 5, main: [0, 5, 10] },
  { level: 10, main: [0, 10, 20] },
  { level: 15, main: [0, 15, 30, 42] },
  { level: 20, main: [30, 57] },
];

// A boss fight is chaotic (the brain picks its moves, the bot dodges what it sees), so each
// cell is played with SEEDS combat streams and reads the median: seconds when every one
// was won, else how many were won.
const SEEDS = Number(opt('--seeds')) || 3;
export function fights(id, o, seeds = SEEDS) {
  const list = [];
  for (let s = 1; s <= seeds; s++) list.push(fight(id, { ...o, seed: s }));
  const won = list.filter((f) => f.won);
  const secs = list.map((f) => (f.won ? f.seconds : Infinity)).sort((x, y) => x - y);
  const med = (k) => {
    const v = (won.length ? won : list).map((f) => f[k]).sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)];
  };
  return { won: won.length, of: seeds, median: secs[Math.floor(seeds / 2)], fell: list.filter((f) => f.dropped).length, lowest: Math.min(...list.map((f) => f.lowest)), hp: list[0].hp, casts: med('casts'), bigCasts: med('bigCasts'), swings: med('swings'), left: med('bossLow'), drunk: med('drunk'), boss0: list[0].boss0, runs: list.map((f) => ({ won: f.won, s: f.seconds, low: f.bossLow, casts: f.casts, drunk: f.drunk })) };
}

function bossTable() {
  const out = [];
  for (const build of ['sword', 'weave']) {
    for (const { level, main } of FIGHTS) {
      for (const n of main) {
        const row = { build, level, main: n };
        for (const rule of VARIANTS) {
          row[rule] = {};
          for (const id of BOSS_LIST) row[rule][id] = fights(id, { rule, build, level, main: n });
        }
        out.push(row);
        console.log(`  ${build} L${level} ${n}: ${VARIANTS.map((r) => `${r} ${BOSS_LIST.map((id) => fmtFight(row[r][id])).join(' ')}`).join(' | ')}`);
      }
    }
  }
  return out;
}

const fmtFight = (f) => (f.won === f.of ? `${Math.round(f.median)}s` : `${f.won}/${f.of}${Number.isFinite(f.median) ? `~${Math.round(f.median)}s` : ''}${f.fell ? ` (fell ${f.fell})` : ''}`);

// ---------------------------------------------------------------- 6. a boss's power

// Far out (Free stat points, or a long life): what 50, 100 and 200 points in one attribute
// make of you beside Varek (520 health, hits for 11): your health; sword cuts (the combo's
// average, armor taken off) and Sparks to bring him down.
function reachTable() {
  const out = [];
  const V = BOSSES.varek;
  for (const n of [0, 10, 30, 50, 100, 200]) {
    const row = { n };
    for (const rule of VARIANTS) {
      const hp = makeGame({ rule, level: 15, points: { vitality: n }, bosses: false }).player.maxHp;
      const gm = makeGame({ rule, level: 15, points: { might: n }, bosses: false });
      const atk = gm.stats.get(gm.player, 'atk');
      const cut = COMBO.reduce((t, c) => t + Math.max(atk * c.mul - V.def, atk * c.mul * 0.35), 0) / COMBO.length;
      const gw = makeGame({ rule, level: 15, points: { weave: n }, bosses: false });
      const spark = weaveHit(gw, SPARK).dmg;
      row[rule] = { hp, cuts: Math.ceil(V.hp / cut), sparks: Math.ceil(V.hp / Math.max(spark - V.def, spark * 0.35)), atk: Math.round(atk * 10) / 10, spark: Math.round(spark * 10) / 10 };
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- 7. the strongest weave (round 15)

// Shapes that strike a foe (a ward, a bind, a wall, a dash, a familiar and a rune do other work),
// and every essence but raw.
export const STRIKING = ['bolt', 'blast', 'strike', 'throw', 'beam', 'nova', 'orb', 'rain'];
const combos = (arr, k, from = 0, pre = [], out = []) => {
  if (pre.length === k) {
    out.push(pre.slice());
    return out;
  }
  for (let i = from; i < arr.length; i++) {
    pre.push(arr[i]);
    combos(arr, k, i + 1, pre, out);
    pre.pop();
  }
  return out;
};

// A boss's body to strike: still, huge, armoured like the boss (`def`), as big as one.
function bossBody(game, x, y, def = 1, radius = 10) {
  const t = new Actor(game, { id: 'boss_body', name: 'Boss body', faction: 'monster', kind: 'monster', maxHp: 1e7, atk: 1, def, x, y, radius });
  t.superArmor = true;
  t.mass = 6;
  game.entities.add(t);
  return t;
}

// What one cast of `weave` at charge k deals to a boss's body 70 px away (every body, child,
// echo and status tick of it, for six seconds), and what it costs.
export function castOnce(weave, { level = 7, points = {}, k = 1, def = 1, rule = 'new' } = {}) {
  const g = makeGame({ rule, level, points, bosses: false });
  const p = g.player;
  p.x = 1200;
  p.y = 900;
  const t = bossBody(g, p.x + 70, p.y, def);
  let dealt = 0;
  let hits = 0;
  g.bus.on('damage', (e) => {
    if (e.target === t && e.amount > 0) {
      dealt += e.amount;
      hits++;
    }
  });
  g.magic.startTrial();
  const pool = g.magic.mana.max;
  const plan = g.magic.compile(weave);
  const cost = g.magic.costOf(p, plan);
  g.magic.mana.max = 1e6;
  g.magic.mana.cur = 1e6;
  const r = g.magic.cast(p, weave, { x: t.x, y: t.y - 6, target: t }, { chargeK: k });
  for (let i = 0; i < 30 * 6; i++) {
    step(g);
    t.x = p.x + 70;
    t.y = p.y;
  }
  return { ok: !!r.ok, dealt: Math.round(dealt), hits, cost, full: Math.round(cost * (1 + BAL.CHARGE_MANA * k) * 10) / 10, pool, name: plan.name, cooldown: g.magic.cooldownOf(p, plan) };
}

// The strongest weave: every striking shape, the essences given (by default all but raw), and
// every set of `twists` twists, ranked by the plan's own budget value at a full charge; the best
// `sim` of those (and the best few of each shape) are cast at a boss's body and the most harm
// wins. `pool`: only weaves whose full charge that pool pays for.
export function strongestWeave({ level = 7, points = {}, essences = 2, twists = 3, pool = Infinity, sim = 36, essencePool = null, k = 1 } = {}) {
  const ess = essencePool || ['fire', 'storm', 'earth', 'light', 'dark', 'iron', 'frost', 'poison'];
  const essSets = combos(ess, essences);
  const twSets = combos(Twists.ids(), twists);
  const g = makeGame({ level, points, bosses: false });
  g.magic.startTrial();
  const P = g.player;
  const cands = [];
  for (const shape of STRIKING) {
    if (!Shapes.has(shape)) continue;
    for (const es of essSets) {
      for (const ts of twSets) {
        const w = { shape, essences: es, twists: ts };
        const plan = g.magic.compile(w);
        if (!plan.ok) continue;
        const cost = g.magic.costOf(P, plan);
        const full = cost * (1 + BAL.CHARGE_MANA * k);
        if (full > pool) continue;
        cands.push({ w, h: plan.value * (1 + (plan.chargePower ?? BAL.CHARGE_POWER) * k) * plan.count, cost });
      }
    }
  }
  cands.sort((a, b) => b.h - a.h);
  const pick = new Set(cands.slice(0, sim));
  for (const shape of STRIKING) cands.filter((c) => c.w.shape === shape).slice(0, 3).forEach((c) => pick.add(c));
  let best = null;
  for (const c of pick) {
    const m = castOnce(c.w, { level, points, k });
    if (!best || m.dealt > best.dealt) best = { weave: c.w, ...m };
  }
  return best;
}

// The pools a level gives: every point in Weave, in Focus, or half and half.
function poolOf(level, points) {
  const g = makeGame({ level, points, bosses: false });
  return { mana: g.magic.mana.max, power: Math.round(g.stats.get(g.player, 'spellPower') * 100) / 100 };
}

function weavesTable() {
  const out = [];
  for (const level of [7, 9]) {
    const all = 3 * (level - 1);
    const builds = { weave: { weave: all }, half: { weave: Math.ceil(all / 2), focus: Math.floor(all / 2) }, focus: { focus: all } };
    const pools = Object.fromEntries(Object.entries(builds).map(([k, v]) => [k, poolOf(level, v)]));
    for (const [nE, nT] of [
      [2, 3],
      [2, 4],
      [3, 4],
    ]) {
      // The strongest a hand can make, whatever it costs; and the strongest the half-and-half
      // pool fires at full charge.
      const any = strongestWeave({ level, points: builds.half, essences: nE, twists: nT });
      const fits = strongestWeave({ level, points: builds.half, essences: nE, twists: nT, pool: pools.half.mana });
      const row = { level, essences: nE, twists: nT, pools, any, fits };
      // How many of each a full pool casts at full charge (no regen), by build.
      row.casts = {};
      for (const [b, pts] of Object.entries(builds)) {
        const g = makeGame({ level, points: pts, bosses: false });
        g.magic.startTrial();
        const cost = (w) => g.magic.costOf(g.player, g.magic.compile(w)) * (1 + BAL.CHARGE_MANA);
        row.casts[b] = { any: Math.floor(g.magic.mana.max / cost(any.weave) + 1e-9), fits: fits ? Math.floor(g.magic.mana.max / cost(fits.weave) + 1e-9) : 0, spark: Math.floor(g.magic.mana.max / (g.magic.costOf(g.player, g.magic.compile(SPARK)) * (1 + BAL.CHARGE_MANA)) + 1e-9) };
      }
      out.push(row);
      const wd = (x) => (x ? `${x.weave.shape} ${x.weave.essences.join('+')} [${x.weave.twists.join(',')}] "${x.name}" cost ${x.cost} full ${x.full} deals ${x.dealt}` : 'none');
      console.log(`L${level} ${nE}e ${nT}t: pools weave ${pools.weave.mana} half ${pools.half.mana} focus ${pools.focus.mana} (power ${pools.weave.power}/${pools.half.power}/${pools.focus.power})`);
      console.log(`   strongest: ${wd(any)}`);
      console.log(`   strongest the half pool fires full: ${wd(fits)}`);
      console.log(`   full casts from a full pool (strongest / fits / spark): ${Object.entries(row.casts).map(([b, c]) => `${b} ${c.any}/${c.fits}/${c.spark}`).join('  ')}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 8. bosses against what can be built

const ALL_BOSSES = ['mother_of_slimes', 'varek', 'greyjaw', 'lakes_hum', 'bone_warden'];
const LIMIT = Number(opt('--limit')) || 900;

function powerBossTable() {
  const out = [];
  const ids = opt('--bosses')?.split(',') || ALL_BOSSES;
  for (const id of ids) {
    const meant = BOSSES[id].level || 7;
    for (const level of [meant, 15]) {
      const all = 3 * (level - 1);
      const half = { weave: Math.ceil(all / 2), focus: Math.floor(all / 2) };
      const pool = poolOf(level, half).mana;
      const strong = strongestWeave({ level, points: half, essences: 2, twists: level >= 9 ? 4 : 3, pool, sim: 18 });
      const row = { id, level, meant, weave: strong?.weave || null, weaveName: strong?.name, dealt: strong?.dealt };
      for (const build of ['might', 'weaveall', 'max']) row[build] = fights(id, { build, level, weave: strong?.weave, limit: LIMIT });
      // A good build, prepared (two thirds in Might or Weave, the rest in Vitality or Focus, three
      // healing potions): what the target is written for.
      const main = Math.round((2 * all) / 3);
      row.sword = fights(id, { build: 'sword', level, main, limit: LIMIT, potions: 3 });
      row.weave = fights(id, { build: 'weave', level, main, limit: LIMIT, potions: 3 });
      out.push(row);
      const f = (x) => `${fmtFight(x)} (${x.casts} casts${x.bigCasts ? `, ${x.bigCasts} big` : ''}, ${x.swings} swings${x.drunk ? `, ${x.drunk} potions` : ''}, boss down to ${x.left}/${x.boss0}, you ${x.lowest}/${x.hp})`;
      console.log(`  ${id} L${level}${level === meant ? ' (meant)' : ''}:\n     all Might ${f(row.might)}\n     all Weave ${f(row.weaveall)}\n     strongest ${f(row.max)} :: ${row.weaveName} deals ${row.dealt}\n     sword+vit ${f(row.sword)}\n     weave+focus ${f(row.weave)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 9. the Unkindling's odds

async function soulsTable() {
  const { makeGame: worldGame, put, px, villagers } = await import('../tests/murder_world.mjs');
  const { installUnkindle } = await import('../src/core/plugins/soul.js');
  const { partyPlugin } = await import('../src/core/party.js');
  const { villainPlugin, installVillainHooks } = await import('../src/story/villain.js').catch(() => ({}));
  const out = [];
  const make = (level, pts = null) => {
    const g = worldGame({ hour: 12 });
    installProgression(g);
    g.bus.emit('game_start', { loaded: false });
    if (!g.party) g.plugins.register(partyPlugin);
    const unk = installUnkindle(g);
    unk.learn('sim');
    const P = g.player;
    if (level > 1) {
      P.level = level;
      g.stats.refresh(P);
    }
    const pr = g.progression;
    if (pts) {
      pr.startFree();
      for (const [id, n] of Object.entries(pts)) pr.spend(id, n);
    } else {
      // A level's points spread the usual way: a third each in Vitality, Might and Weave.
      const all = 3 * (level - 1);
      for (const [id, n] of Object.entries({ vitality: Math.ceil(all / 3), might: Math.ceil(all / 3), weave: all - 2 * Math.ceil(all / 3) })) if (n > 0) pr.spend(id, n);
    }
    g.stats.refresh(P);
    P.hp = P.maxHp;
    return { g, unk, P };
  };
  const read = (unk, e) => {
    const v = unk.verdict(e);
    const o = typeof unk.odds === 'function' ? unk.odds(e) : null;
    return { kind: v.kind, ratio: Math.round(v.ratio * 100) / 100, chance: o ? Math.round(o.chance * 100) : v.kind === 'resists' ? 0 : 100, words: o?.words || v.kind };
  };
  for (const level of [1, 7, 15]) {
    const { g, unk } = make(level);
    const row = { level, power: Math.round(unk.powerOf()), souls: {} };
    const people = villagers(g).filter((v) => !unk.check(v) || unk.check(v).reason === 'far');
    for (const v of people) row.souls[v.id] = read(unk, v);
    if (g.companion) row.souls.lyra = read(unk, g.companion);
    out.push(row);
    console.log(`  level ${level} (power ${row.power}): ${Object.entries(row.souls).map(([id, s]) => `${id} ${s.kind} ${s.ratio}${typeof unk.odds === 'function' ? ` ${s.chance}%` : ''}`).join(', ')}`);
  }
  {
    const { g, unk, P } = make(15, { might: 999, weave: 999, vitality: 999, resolve: 999, focus: 999 });
    const row = { level: 15, free: 999, power: Math.round(unk.powerOf()), souls: {} };
    const W = world();
    void W;
    const varek = { type: 'actor', bossId: 'varek', id: 'varek', x: P.x + 16, y: P.y, hp: BOSSES.varek.hp, maxHp: BOSSES.varek.hp, atk: BOSSES.varek.atk, def: BOSSES.varek.def, isAlive: () => true };
    row.souls.varek = read(unk, varek);
    for (const id of ['lakes_hum', 'bone_warden']) row.souls[id] = read(unk, { type: 'actor', bossId: id, id, x: P.x + 16, y: P.y, hp: BOSSES[id].hp, maxHp: BOSSES[id].hp, atk: BOSSES[id].atk, def: BOSSES[id].def, isAlive: () => true });
    if (villainPlugin && installVillainHooks) {
      if (!g.villain) {
        g.plugins.register(villainPlugin);
        installVillainHooks(g);
      }
      g.flags.bosses = { varek: { defeated: true } };
      const T = g.villain.spawn?.();
      if (T) row.souls.tempter = read(unk, T);
    }
    const bram = g.entities.get('bram');
    if (bram) row.souls.bram = read(unk, bram);
    const rowan = g.entities.get('rowan');
    if (rowan) row.souls.rowan = read(unk, rowan);
    out.push(row);
    console.log(`  Free 999 (power ${row.power}): ${Object.entries(row.souls).map(([id, s]) => `${id} ${s.kind} ${s.ratio}`).join(', ')}`);
    void put;
    void px;
  }
  return out;
}

// ---------------------------------------------------------------- run

const MAIN = import.meta.url === `file://${process.argv[1]}`;
const report = {};
if (MAIN && want('stats')) {
  report.effects = effectsTable();
  console.log('\n== effects at', POINTS.join('/'), 'points');
  for (const r of report.effects) console.log(`${r.attr}.${r.stat}: ${VARIANTS.map((v) => `${v} ${r[v].join('/')}`).join(' | ')}`);
}
if (MAIN && want('foes')) {
  report.foes = foesTable();
  console.log('\n== hits to kill', FOES.join('/'));
  for (const r of report.foes) console.log(`L${r.level} ${r.attr} ${r.n} (${r.kind}): ${VARIANTS.map((v) => `${v} [${r[`${v}_power`]}] ${r[v].join('/')}`).join(' | ')}`);
}
if (MAIN && want('boss-hits')) {
  report.bossHits = bossHitsTable();
  console.log('\n== hits that drop you (varek/greyjaw/lake/warden/wolf)');
  for (const r of report.bossHits) console.log(`L${r.level} vit ${r.n}: ${VARIANTS.map((v) => `${v} hp ${r[`${v}_hp`]} ${Object.values(r[v]).join('/')}`).join(' | ')}`);
}
if (MAIN && want('mana')) {
  report.mana = manaTable();
  console.log('\n== mana: pool, sparks, novas, regen/s, nova cooldown');
  for (const r of report.mana) console.log(`L${r.level} focus ${r.n}: ${VARIANTS.map((v) => `${v} ${r[v].mana} ${r[v].sparks} ${r[v].novas} ${r[v].regen}/s ${r[v].cd}s`).join(' | ')}`);
}
if (MAIN && want('reach')) {
  report.reach = reachTable();
  console.log('\n== level 15, n points in one attribute beside Varek (520 health): health / sword cuts / Sparks to beat him');
  for (const r of report.reach) console.log(`${r.n}: ${VARIANTS.map((v) => `${v} ${r[v].hp} hp, ${r[v].cuts} cuts (atk ${r[v].atk}), ${r[v].sparks} sparks (${r[v].spark})`).join(' | ')}`);
}
if (MAIN && want('bosses')) {
  console.log('\n== boss fights (varek greyjaw lake warden), seconds to beat');
  report.bosses = bossTable();
}
if (MAIN && ONLY && ONLY.includes('weaves')) {
  console.log('\n== the strongest weave (round 15)');
  report.weaves = weavesTable();
}
if (MAIN && ONLY && ONLY.includes('power-bosses')) {
  console.log(`\n== the five bosses at the level each is meant for and at 15: all Might / all Weave (Spark) / the strongest weave at full charge (limit ${LIMIT} s)`);
  report.powerBosses = powerBossTable();
}
if (MAIN && ONLY && ONLY.includes('souls')) {
  console.log('\n== the Unkindling: verdict and ratio by target');
  report.souls = await soulsTable();
}
if (MAIN && JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
