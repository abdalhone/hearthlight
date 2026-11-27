// Round 15, the power builder (DESIGN §40.3, §40.8, §40.10): the author's Version 12 playtest.
//   - "Bosses are literally too easy … I killed her in 2 hits … fully charged";
//   - "Increase the mana of modified spells and spells in general";
//   - the Unkindling "too easy at high levels" (every soul "easy" by level 15; a boss taken at
//     Free 999).
// Each test failed on Version 12 (c484794) and passes after the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame as simGame, enterArena, step as simStep, castOnce } from '../scripts/stats_sim.mjs';
import { compileWeave } from '../src/magic/compile.js';
import * as BAL from '../src/magic/balance.js';
import { BOSSES, BOSS_IDS } from '../src/bosses/defs.js';
import { BLOW_SHARE, GUARD_AT, GUARD_MUL } from '../src/bosses/boss.js';
import { makeGame as worldGame, put, px, villagers, holdLyra } from './murder_world.mjs';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { installProgression } from '../src/progression/index.js';
import { partyPlugin } from '../src/core/party.js';
import { chanceOf, oddsWords, KNOW_AT } from '../src/magic/unkindle.js';

// What the author built: level 7, every point on spells (half Weave, half Focus), and the
// strongest weaves of Version 12 at level 7 and level 9 (scripts/stats_sim.mjs --only weaves).
const L7 = { level: 7, points: { weave: 9, focus: 9 } };
const L9 = { level: 9, points: { weave: 12, focus: 12 } };
const ORB_L7 = { shape: 'orb', essences: ['fire', 'earth'], twists: ['multishot', 'big', 'volley'] }; // Version 12: 62.3 mana, 1089 to a boss's body
const BOMB_L9 = { shape: 'throw', essences: ['earth', 'iron'], twists: ['multishot', 'echo', 'big', 'volley'] }; // Version 12: 82 mana ("80 something")

// ---------------------------------------------------------------- item 10: the mana

test('every weave costs more, and much more for each twist, essence, strong shape and the charge', () => {
  const cost = (w) => compileWeave(w).cost;
  const spark = cost({ shape: 'bolt', essences: ['raw'] });
  assert.ok(spark > 4 && spark <= 5, `the Spark costs a little more: ${spark} (was 4)`);
  // Each twist and each essence past the first adds on top of the budget's own price.
  const one = compileWeave({ shape: 'bolt', essences: ['fire'], twists: ['multishot'] });
  assert.ok(one.cost >= one.costBudget * 1.15 * 1.12 - 0.05, `a twist: ${one.cost} on ${one.costBudget}`);
  const two = compileWeave({ shape: 'bolt', essences: ['fire', 'storm'], twists: ['multishot'] });
  assert.ok(two.surcharge > one.surcharge * 1.2, 'a second essence: +25%');
  const four = compileWeave({ shape: 'bolt', essences: ['fire'], twists: ['multishot', 'pierce', 'echo', 'volley'] });
  assert.ok(four.surcharge >= 1.15 * 1.48 - 1e-9, 'four twists: +48%');
  // A strong shape costs more than a plain one with the same parts.
  assert.ok(compileWeave({ shape: 'nova', essences: ['fire'] }).surcharge > compileWeave({ shape: 'bolt', essences: ['fire'] }).surcharge);
  // The 90 ceiling that held every big weave at 90 is gone.
  const bomb = compileWeave(BOMB_L9);
  assert.ok(bomb.cost > 160, `the strongest level-9 weave: ${bomb.cost} (Version 12: 82)`);
  // The charge costs as much more as it hits.
  assert.ok(1 + BAL.CHARGE_MANA >= 1 + BAL.CHARGE_POWER, 'a charge is never cheaper harm');
  // Damage is the budget's, untouched by the surcharge.
  assert.equal(compileWeave({ shape: 'bolt', essences: ['raw'] }).dmg, 10.7, 'the Spark hits as it did');
});

test('max mana and Focus stand: the pools of Version 12, and the strongest weave drains a level-9 pool', () => {
  const pool = (points, level) => simGame({ level, points, bosses: false }).magic.mana.max;
  assert.equal(pool({ weave: 24 }, 9), 64);
  assert.equal(pool({ weave: 12, focus: 12 }, 9), 156);
  assert.equal(pool({ focus: 24 }, 9), 243);
  assert.equal(pool({}, 1), 40);
  const g = simGame({ ...L9, points: { focus: 24 }, bosses: false });
  g.magic.startTrial();
  const P = g.player;
  const plan = g.magic.compile(BOMB_L9);
  const c = g.magic.costOf(P, plan);
  assert.ok(c >= 0.75 * g.magic.mana.max && c <= g.magic.mana.max, `the strongest uncharged drains most of an all-Focus pool: ${c} of ${g.magic.mana.max}`);
  assert.ok(g.magic.chargedCost(P, plan, 1) > g.magic.mana.max, 'and no level-9 pool fires it fully charged');
  // The half-and-half pool (the author's) cannot cast it at all.
  const h = simGame({ ...L9, bosses: false });
  h.magic.startTrial();
  assert.equal(h.magic.cast(h.player, BOMB_L9, { x: h.player.x + 40, y: h.player.y }).ok, false);
});

test('a charged cast pays what the Spellbook says (chargedCost), and the charge twist x3', () => {
  const g = simGame({ ...L7, bosses: false });
  g.magic.startTrial();
  const P = g.player;
  P.x = 1200;
  P.y = 900;
  for (const w of [{ shape: 'bolt', essences: ['fire'] }, { shape: 'bolt', essences: ['fire'], twists: ['charge'] }]) {
    g.magic.mana.cur = g.magic.mana.max;
    g.magic.resetCooldowns?.();
    const plan = g.magic.compile(w);
    const before = g.magic.mana.cur;
    const r = g.magic.cast(P, w, { x: P.x + 50, y: P.y }, { chargeK: 1 });
    assert.ok(r.ok, r.message);
    const paid = before - g.magic.mana.cur;
    const want = g.magic.costOf(P, plan) * (w.twists ? 3 : 2.5);
    assert.ok(Math.abs(paid - want) < 0.2 && Math.abs(paid - g.magic.chargedCost(P, plan, 1)) < 0.2, `${plan.name}: paid ${paid}, want ${want}`);
  }
});

// ---------------------------------------------------------------- item 8: the bosses

test('each boss names the level it is meant for, and is far tougher than Version 12', () => {
  const v12 = { varek: 520, greyjaw: 600, mother_of_slimes: 560, lakes_hum: 440, bone_warden: 560 };
  for (const id of BOSS_IDS) {
    const d = BOSSES[id];
    assert.ok(d.level >= 4 && d.level <= 9, `${id} level ${d.level}`);
    assert.ok(d.hp >= 3.5 * v12[id], `${id} health ${d.hp}`);
    assert.ok(d.def >= 3, `${id} armour ${d.def}`);
    assert.ok(d.resist && Object.keys(d.resist).length >= 2, `${id} resists`);
  }
});

function lakeFight() {
  const g = simGame({ ...L7, seed: 3 });
  const p = enterArena(g, 'lakes_hum');
  const b = g.bosses.get('lakes_hum');
  // Her surfacing (she cannot be struck under the water): stand her up for the test.
  for (let i = 0; i < 30 * 4 && !(b.mem.stage === 'up'); i++) simStep(g);
  b.mem.stage = 'up';
  b.move = null;
  return { g, p, b };
}

test('one blow takes at most its share of a boss; a flood raises its guard, which lets a little through', () => {
  const { g, p, b } = lakeFight();
  const guards = [];
  g.bus.on('boss_guard', (e) => guards.push(e.on));
  const hp0 = b.hp;
  b.invuln = 0;
  g.combat.damage(p, b, 5000, { kind: 'magic', exact: true, crit: false });
  const took = hp0 - b.hp;
  assert.ok(took <= Math.ceil(b.maxHp * BLOW_SHARE) && took > 0, `one 5000 blow took ${took} of ${b.maxHp}`);
  // A second at once: past GUARD_AT of its health from this hand, the guard rises.
  b.invuln = 0;
  g.combat.damage(p, b, 5000, { kind: 'magic', exact: true, crit: false });
  assert.ok(hp0 - b.hp >= b.maxHp * GUARD_AT - 2, 'two blows: past the guard line');
  assert.equal(b.guarded(), true, 'guarded');
  assert.deepEqual(guards, [true]);
  const h1 = b.hp;
  b.invuln = 0;
  g.combat.damage(p, b, 100, { kind: 'magic', exact: true, crit: false });
  assert.ok(Math.abs(h1 - b.hp - Math.max(1, Math.round(100 * GUARD_MUL - b.def))) <= 1, `guarded: ${h1 - b.hp} of 100`);
  // It falls after its time, and the slate is clean (an opening).
  for (let i = 0; i < 30 * 4; i++) simStep(g);
  assert.equal(b.guarded(), false);
  assert.deepEqual(guards, [true, false]);
});

test('no burst: what the author did (level 7, three fully charged casts of the strongest weave) leaves the Lake\'s Hum standing', () => {
  // The Version 12 strongest, if the pool could still pay for it; and whatever a level-7
  // half-and-half pool fires fully charged now.
  const { g, p, b } = lakeFight();
  g.magic.startTrial();
  const before = b.hp;
  for (let n = 0; n < 3; n++) {
    g.magic.mana.cur = 1e6; // as if the pool were bottomless
    g.magic.mana.max = 1e6;
    g.magic.resetCooldowns?.();
    b.mem.stage = 'up';
    const r = g.magic.cast(p, ORB_L7, { x: b.x, y: b.y - 6, target: b }, { chargeK: 1 });
    assert.ok(r.ok, r.message);
    for (let i = 0; i < 30 * 5; i++) {
      b.mem.stage = 'up';
      p.hp = p.maxHp;
      simStep(g);
    }
  }
  const lost = before - b.hp;
  assert.equal(b.mode, 'fight', 'still fighting');
  assert.ok(lost < 0.2 * b.maxHp, `three charged casts took ${Math.round(lost)} of ${b.maxHp} (Version 12: one took ${1089} of 440)`);
  // And against a boss's still body (no guard, no blow cap: armour alone), the same cast at the
  // same level once dealt more than twice her old health.
  const body = castOnce(ORB_L7, { ...L7, def: BOSSES.lakes_hum.def });
  assert.ok(body.dealt > 440, `the weave is as strong as it was (${body.dealt}); the boss is what changed`);
});

// ---------------------------------------------------------------- item 3: the Unkindling

function soulWorld(level, points = null) {
  const g = worldGame({ hour: 12 });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  if (!g.party) g.plugins.register(partyPlugin);
  const unk = installUnkindle(g);
  unk.learn('test');
  const P = g.player;
  if (level > 1) {
    P.level = level;
    g.stats.refresh(P);
  }
  const pr = g.progression;
  if (points) {
    pr.startFree();
    for (const [id, n] of Object.entries(points)) pr.spend(id, n);
  } else {
    const all = 3 * (level - 1);
    const third = Math.ceil(all / 3);
    for (const [id, n] of Object.entries({ vitality: third, might: third, weave: all - 2 * third })) if (n > 0) pr.spend(id, n);
  }
  g.stats.refresh(P);
  P.hp = P.maxHp;
  for (const v of villagers(g)) v.think = () => {};
  return { g, unk, P };
}

test('the Unkindling is a contest of who they are: level 1, 7 and 15 (the design\'s reading), never all easy', () => {
  {
    const { g, unk } = soulWorld(1);
    const v = (id) => unk.verdict(g.entities.get(id));
    assert.equal(v('elda').kind, 'easy');
    assert.equal(v('bram').kind, 'easy', `Bram at level 1: ${JSON.stringify(v('bram'))} (Version 12: close, 1.51)`);
    assert.equal(v('wys').kind, 'close');
    assert.equal(v('hess').kind, 'resists');
    assert.equal(v('rowan').kind, 'resists');
  }
  for (const level of [7, 15]) {
    const { g, unk } = soulWorld(level);
    const all = villagers(g).filter((e) => !unk.check(e) || unk.check(e).reason === 'far');
    const contests = all.filter((e) => unk.verdict(e).kind !== 'easy').map((e) => e.id);
    assert.ok(contests.includes('rowan') && contests.includes('hess') && contests.includes('aveline'), `level ${level}: the watch's captain, the huntress and the chapel's keeper hold on: ${contests}`);
    for (const id of ['rowan', 'hess']) {
      const o = unk.odds(g.entities.get(id));
      assert.ok(o.chance > 0 && o.chance < 0.85, `level ${level} ${id}: ${JSON.stringify(o)}`);
    }
    if (level === 15) assert.ok(Math.abs(unk.odds(g.entities.get('rowan')).chance - 0.5) < 0.2, 'Rowan at level 15: about even');
  }
});

test('bosses and the tempter are never taken, even at Free 999', () => {
  const { g, unk, P } = soulWorld(15, { might: 999, weave: 999, vitality: 999, resolve: 999, focus: 999 });
  for (const id of BOSS_IDS) {
    const d = BOSSES[id];
    const boss = { type: 'actor', bossId: id, id, x: P.x + 16, y: P.y, hp: d.hp, maxHp: d.hp, atk: d.atk, def: d.def, isAlive: () => true };
    const v = unk.verdict(boss);
    assert.equal(v.kind, 'resists', `${id}: ${JSON.stringify(v)}`);
    assert.equal(v.chance, 0);
  }
  // A villager, at 999: easy.
  assert.equal(unk.verdict(g.entities.get('bram')).kind, 'easy');
});

test('the odds shown are the odds played: a soul the roll goes against breaks free past KNOW_AT, and knows', () => {
  assert.ok(chanceOf(0.3) > 0.95 && Math.abs(chanceOf(0.85) - 0.5) < 1e-9 && chanceOf(1.6) === 0);
  assert.equal(oddsWords(0), 'too strong');
  assert.equal(oddsWords(0.5), 'even');
  for (const lose of [false, true]) {
    const { g, unk, P } = soulWorld(15);
    holdLyra(g, px(150), px(112));
    put(P, px(62), px(14));
    P.facing = { x: 1, y: 0 };
    const rowan = g.entities.get('rowan');
    for (const v of villagers(g)) if (v !== rowan) put(v, px(141) + Math.random() * 20, px(101));
    put(rowan, P.x + 16, P.y);
    const odds = unk.odds(rowan);
    assert.ok(odds.chance > 0.2 && odds.chance < 0.85, JSON.stringify(odds));
    // The roll: below the chance takes, at or above it breaks free.
    unk.rand = () => (lose ? Math.min(0.999, odds.chance + 0.01) : Math.max(0, odds.chance - 0.2));
    assert.ok(unk.begin(rowan).ok);
    assert.equal(unk.channel.fails, lose);
    assert.ok(unk.channel.breakAt > KNOW_AT);
    let t = 0;
    while (unk.channel && t < 12) {
      unk.update(0.05);
      t += 0.05;
    }
    if (lose) {
      assert.ok(!rowan.dead, 'he broke free');
      const a = unk.attempts.at(-1);
      assert.equal(a.outcome, 'resisted');
      assert.equal(a.knows, true, 'and knows what you tried');
    } else assert.ok(rowan.dead || g.murder.dead?.rowan, 'taken');
  }
});
