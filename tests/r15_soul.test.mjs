// Round 15, item 14 (DESIGN §40.4). The author: "there's a soul that leaves their body and goes
// to me, even though I haven't gone into the soul spelling, necromancer, evil side of the
// story yet". The rule: a soul (if shown at all) rises and fades upward, toward the Hearth,
// and never toward you; only the Unkindling, or coldfire on the tempter's pact, draws a soul
// or a flame into you. The look (what moved from a body into the player) and the logic (no
// coldfire, soul tally or dark sign without the pact or the Unkindling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, px, put, holdLyra, villagers, downBy, events } from './murder_world.mjs';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { spawnCreature } from '../src/entities/monsters.js';
import { TILE } from '../src/core/constants.js';
import { StatusFx } from '../src/magic/fx_status.js';
import * as Shard from '../src/bosses/shard.js';

const { GlyphShard } = Shard;
const SOUL_GONE = Shard.SOUL_GONE ?? 3.2; // the soul-rise's length

const WOODS = { tx: 62, ty: 14 };

function darkState(g) {
  const u = g.unkindle;
  const cf = u?.coldfire;
  return {
    learned: !!u?.learned,
    tally: u?.tally ?? 0,
    deaths: u?.deaths?.length ?? 0,
    bar: cf?.bar ?? 0,
    mark: cf?.mark ?? 0,
    tier: u?.signs?.tier?.() ?? 0,
    pact: g.villain?.state?.pact ?? null,
    darkEssence: !!g.magic?.isEarned?.('essence', 'dark'),
  };
}

test('a new game: a bandit killed and a villager finished; no soul reaches you and nothing dark changes', () => {
  const g = makeGame({ hour: 12 });
  installUnkindle(g);
  for (const v of villagers(g)) {
    v.think = () => {};
    put(v, px(141) + Math.random() * 20, px(101));
  }
  holdLyra(g, px(150), px(112));
  const P = g.player;
  put(P, px(WOODS.tx), px(WOODS.ty));
  const before = darkState(g);
  assert.deepEqual(before, { learned: false, tally: 0, deaths: 0, bar: 0, mark: 0, tier: 0, pact: before.pact, darkEssence: false });
  // A bandit, by the sword.
  const b = spawnCreature(g, 'bandit', P.x + 20, P.y);
  b.think = () => {};
  for (let i = 0; i < 12 && !b.dead; i++) {
    b.invuln = 0;
    g.combat.damage(P, b, 999, { exact: true, crit: false });
    if (b.downed && !b.dead) g.combat.kill(b, P);
  }
  assert.ok(b.dead, 'the bandit is dead');
  step(g, 2);
  // A villager, by the held finisher.
  const bram = g.entities.get('bram');
  put(bram, P.x + 14, P.y);
  assert.ok(downBy(g, bram), 'Bram is down');
  P.faceToward(bram.x, bram.y);
  const rec = g.murder.strike(P, bram);
  assert.ok(rec && g.murder.dead.bram, 'the finisher killed him');
  assert.equal(rec.cause, 'killed', 'a killing, not an unkindling');
  step(g, 3);
  const after = darkState(g);
  assert.deepEqual(after, before, 'no coldfire, soul tally, dark sign or pact from an ordinary kill and a finisher');
  for (const t of ['unkindle_learned', 'unkindle_taken', 'unkindled', 'coldfire_changed']) assert.equal(events(g, t).length, 0, `no ${t}`);
});

test('on the pact path the Unkindling still draws the soul in: the tally and the cold rise', () => {
  const g = makeGame({ hour: 12 });
  const unk = installUnkindle(g);
  for (const v of villagers(g)) {
    v.think = () => {};
    put(v, px(141) + Math.random() * 20, px(101));
  }
  holdLyra(g, px(150), px(112));
  const P = g.player;
  put(P, px(WOODS.tx), px(WOODS.ty));
  P.facing = { x: 1, y: 0 };
  P.dir = 'right';
  g.bus.emit('pact_sealed', { gifts: ['dark', 'bloodprice', 'unkindle'], pact: 'before' });
  assert.equal(unk.learned, true, 'the pact teaches it');
  // A weak soul (Elda), touched, held till it is drawn in.
  const elda = g.entities.get('elda');
  put(elda, P.x + TILE, P.y);
  const r = unk.begin(elda);
  assert.ok(r.ok, JSON.stringify(r));
  for (let t = 0; unk.channel && t < 14; t += 1 / 20) {
    unk.update(1 / 20);
    step(g, 1 / 20, 1 / 20);
  }
  assert.equal(unk.tally, 1, 'one soul taken');
  assert.ok((unk.coldfire?.bar ?? 0) > 0, 'the taken flame fills the cold bar');
});

test('drained life rises and fades upward; it never drifts into the one who drains it', () => {
  const got = [];
  const parts = { add: (st, ramp, x, y, z, vx, vy, vz) => got.push({ vx, vy, vz }) };
  const fx = new StatusFx({ game: {} });
  const victim = { x: 100, y: 100, z: 0 };
  for (const src of [{ x: 160, y: 100 }, { x: 40, y: 160 }, { x: 100, y: 30 }]) {
    got.length = 0;
    for (let i = 0; i < 40; i++) fx._emit(parts, 'wisp', null, 'body', victim, { w: 10, h: 18 }, { id: 'drained', src });
    for (const p of got) {
      const toward = (p.vx * (src.x - victim.x) + p.vy * (src.y - victim.y)) / Math.hypot(src.x - victim.x, src.y - victim.y);
      assert.ok(toward < 6, `no wisp heads for the drainer (${toward.toFixed(1)} px/s toward)`);
      assert.ok(p.vz > 0 && p.vy < 0, 'it rises');
    }
  }
});

test("a boss's shard rises out of the body and hovers: it is never pulled into you while the soul rises", () => {
  const g = { player: { x: 0, y: 0, isAlive: () => true }, particles: { emit() {} }, magic: null, entities: { remove() {} }, bus: { emit() {} } };
  const s = new GlyphShard(g, { kind: 'essence', id: 'water', x: 0, y: 0, rise: true, vx: 0, vy: 0 });
  g.player.x = 22;
  g.player.y = 4;
  let pulled = 0;
  for (let t = 0; t < SOUL_GONE - 0.1; t += 1 / 30) {
    const x0 = s.x;
    s.update(1 / 30);
    if (s.collected) break;
    if (Math.abs(s.x - x0) > 0.01 && s.z <= 10) pulled++;
  }
  assert.equal(s.collected, false, 'not taken while the soul rises');
  assert.equal(pulled, 0, 'not drawn toward you meanwhile');
  for (let t = 0; t < 2 && !s.collected; t += 1 / 30) s.update(1 / 30);
  assert.equal(s.collected || Math.hypot(s.x - 22, s.y - 0) < 22, true, 'after it, walking up to it still takes it');
});
