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
//   node scripts/stats_sim.mjs [--json FILE] [--only stats,foes,boss-hits,mana,bosses] [--variants old,first,new]
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

function makeGame({ hour = 22, rule = 'new', level = 1, points = {}, gear = null, seed = 1, bosses = true } = {}) {
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

function step(game, dt = DT) {
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
function enterArena(game, id) {
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
function danger(game, b, p) {
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

// One fight: the bot plays until the boss is beaten, the player drops, or `limit` seconds.
export function fight(id, { rule = 'new', build = 'sword', level = 15, main = 30, seed = 1, limit = 240, trace = null } = {}) {
  const spare = Math.max(0, 3 * (level - 1) - main);
  const points = build === 'sword' ? { might: main, vitality: spare } : { weave: main, focus: spare };
  const g = makeGame({ rule, level, points, seed });
  const log = [];
  g.bus.on('boss_defeated', (e) => log.push(e));
  const p = enterArena(g, id);
  const b = g.bosses.get(id);
  const m = g.magic;
  // Both builds carry Spark (the starter weave): the weave build lives by it, the sword
  // build reaches with it what the blade cannot (the Lake's Hum over its water).
  m.setSlot(0, SPARK);
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
  const swing = (t) => {
    if (t < next || p.lockTime > 0) return;
    const c = COMBO[combo];
    const rate = g.stats.get(p, 'swing') || 1;
    p.faceToward?.(b.x, b.y);
    g.combat.melee(p, { target: b, arc: c.arc, range: c.range, damageMul: c.mul, knockback: c.knock, launch: c.launch, heavy: c.heavy, lock: c.lock / rate, cooldown: 0.08, silent: true });
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
  const spark = (d) => {
    if (d > 200 || !clear()) return false;
    const r = m.canCast?.(0);
    if (r && !r.ok) return false;
    return !!m.cast(p, 0, { x: b.x, y: b.y - 6 })?.ok;
  };
  const b0 = b.hp;
  while (g.time - start < limit) {
    if (log.length) break;
    if (!p.isAlive() || p.downed || p.hp <= 0) {
      dropped = true;
      break;
    }
    const t = g.time;
    rollCd -= DT;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const ux = (b.x - p.x) / (d || 1);
    const uy = (b.y - p.y) / (d || 1);
    const hurt = danger(g, b, p);
    let intent = { x: 0, y: 0 };
    const reach = COMBO[combo].range + (b.radius ?? 8) - 2;
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
      if (hurt.left < 0.3 && rollCd <= 0) {
        rollCd = ROLL.cooldown;
        rollT = ROLL.time;
        rollDir = intent;
        p.invuln = Math.max(p.invuln || 0, ROLL.iframes);
      }
    } else if (b.veiled || b.mode !== 'fight') {
      intent = { x: 0, y: 0 };
    } else if (build === 'sword') {
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
      if (!spark(d) && d <= reach && m.mana.cur < m.costOf(p, m.slotPlan(0))) swing(t);
    }
    p.moveIntent = intent;
    if (trace && Math.floor(t * 2) !== Math.floor((t - DT) * 2)) trace({ t: Math.round((t - start) * 10) / 10, p: [Math.round(p.x), Math.round(p.y)], b: [Math.round(b.x), Math.round(b.y)], d: Math.round(d), bhp: Math.round(b.hp), mode: b.mode, move: b.move?.name, veiled: b.veiled, shield: b.mem?.shield?.pips, hurt: !!hurt, mana: Math.round(m.mana.cur), php: Math.round(p.hp), cast: m.canCast?.(0)?.reason });
    step(g);
    if (p.hp < hpLow) hpLow = p.hp;
  }
  return {
    won: log.length > 0,
    dropped,
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

function bossTable() {
  const out = [];
  for (const build of ['sword', 'weave']) {
    for (const { level, main } of FIGHTS) {
      for (const n of main) {
        const row = { build, level, main: n };
        for (const rule of VARIANTS) {
          row[rule] = {};
          for (const id of BOSS_LIST) row[rule][id] = fight(id, { rule, build, level, main: n });
        }
        out.push(row);
        console.error(`  ${build} L${level} ${n}: ${VARIANTS.map((r) => `${r} ${BOSS_LIST.map((id) => fmtFight(row[r][id])).join(' ')}`).join(' | ')}`);
      }
    }
  }
  return out;
}

const fmtFight = (f) => (f.won ? `${f.seconds}s` : f.dropped ? `fell@${f.seconds}` : `>${f.seconds}`);

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
if (MAIN && want('bosses')) {
  console.log('\n== boss fights (varek greyjaw lake warden), seconds to beat');
  report.bosses = bossTable();
}
if (MAIN && JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
