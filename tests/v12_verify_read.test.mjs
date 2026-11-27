// Version 12, the code reader's verify pass (DESIGN §39): seams between round 14b and the
// stat points second pass that the join missed, each test failing before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step as stepWorld, px, put, holdLyra, villagers } from './murder_world.mjs';
import { installProgression } from '../src/progression/index.js';
import { FREE_MAX } from '../src/progression/progression.js';
import { partyPlugin, holderOf } from '../src/core/party.js';
import { TILE } from '../src/core/constants.js';
import { TOP_RUN } from '../src/entities/npc_companion.js';

// The murder world with the game's own stat pipeline and points on, as game.js wires them.
function statsWorld({ hour = 12 } = {}) {
  const g = makeGame({ hour });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  if (!g.party) g.plugins.register(partyPlugin);
  return g;
}

// Everyone not named far away and still; Lyra held out of it unless named.
function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

// ---------------------------------------------------------------- companions keep up

// The stats pass set the points' speed ceiling at Lyra's own top run ("76 px/s walks at most
// ~129 on points alone: Lyra's own top run (80 × 1.6 = 128), so a companion keeps up"), but
// round 14b made the companion anyone: a smith ran at most 2.3 × 40 = 92 px/s, so fifteen
// points in Grace (a level-6 build) left Bram twelve tiles back and in reach a third of the
// time. A companion now runs, when behind, as fast as you go, up to Lyra's top run.
function walkWith(who, grace, { seconds = 20 } = {}) {
  const g = statsWorld();
  quiet(g, [who]);
  const P = g.player;
  if (grace) {
    g.progression.startFree();
    assert.ok(g.progression.spend('grace', grace).ok);
  }
  g.stats.refresh(P);
  const pace = P.speed;
  const c = who === 'lyra' ? g.companion : g.entities.get(who);
  put(P, px(5), px(84)); // the King's Road: open road, east
  put(c, px(4), px(84));
  if (who !== 'lyra') {
    c.opinionOfPlayer = 85;
    assert.ok(g.party.invite(c).ok, `${who} comes`);
  }
  const dt = 1 / 20;
  for (let t = 0; t < 1; t += dt) {
    stepWorld(g, dt, dt);
    g.stats.update(dt);
  }
  let worst = 0;
  let near = 0;
  let n = 0;
  for (let t = 0; t < seconds; t += dt) {
    P.x += pace * dt;
    P.facing = { x: 1, y: 0 };
    stepWorld(g, dt, dt);
    g.stats.update(dt);
    const d = Math.hypot(c.x - P.x, c.y - P.y) / TILE;
    worst = Math.max(worst, d);
    n++;
    if (d <= 8) near++;
  }
  return { g, c, pace, worst, near: near / n };
}

test('v12 verify: any adult companion keeps up with a Grace build as Lyra does (the points\' ceiling is her top run)', () => {
  assert.ok(TOP_RUN >= 128 && TOP_RUN < 140, `a companion's top run is Lyra's (${TOP_RUN} px/s)`);
  for (const [who, grace] of [
    ['bram', 15],
    ['bram', 30],
    ['bram', FREE_MAX],
    ['rowan', FREE_MAX],
    ['lyra', FREE_MAX],
  ]) {
    const r = walkWith(who, grace);
    assert.ok(r.worst <= 8, `${who} behind ${grace} Grace (${r.pace.toFixed(1)} px/s): at most ${r.worst.toFixed(1)} tiles back`);
    assert.ok(r.near >= 0.95, `${who} behind ${grace} Grace: within eight tiles ${Math.round(r.near * 100)}% of the walk`);
    if (who !== 'lyra') assert.equal(holderOf(r.g), r.c, `${who} still walks with you`);
  }
});

test('v12 verify: with no points the companion\'s walk is as it was (a smith still walks a smith\'s pace near you)', () => {
  const r = walkWith('bram', 0);
  assert.ok(r.worst <= 5, `at most ${r.worst.toFixed(1)} tiles back`);
  // Standing beside you, they stroll: the run is only for catching up.
  const { g, c } = r;
  const P = g.player;
  put(c, P.x - 20, P.y);
  const dt = 1 / 20;
  for (let t = 0; t < 1; t += dt) stepWorld(g, dt, dt);
  assert.ok((c.speedMul || 1) <= 1.6 + 1e-9, `close by, ${c.speedMul}× their walk`);
});

// ---------------------------------------------------------------- what a % is a share of

// DESIGN §26: "every number with a percentage on it says what its % are a share of, and a
// chance's own +% reads '+30% of it', a share of the chance, never more points of it"; §39.8
// put gear, the bag, the forge and the shop through stats.pctWords. The prices' own words did
// not follow: Glass said "+50% weave power" and Oath "+30% … crit chance", both numbers the
// sheet shows as a % (100% weave power, 10% crit), so they read as fifty and thirty more
// points; and the coldfire bar's "+30% to Sword and Weave power" the same.
import { PRICES } from '../src/magic/prices.js';
import { STATS, pctWords } from '../src/core/stats.js';
import { boostWords } from '../src/ui/coldfire_view.js';

test('v12 verify: a price\'s words say what each % is a share of (a share of yours, never more points; speed of the normal pace)', () => {
  // Every price's own shares, and Oath's, which its live provider gives while your companion
  // is near (prices.provide).
  const g = statsWorld();
  const P = g.player;
  g.prices.state.oath = { t: 45 };
  put(P, px(97), px(103));
  put(g.companion, P.x + 10, P.y);
  const oath = (g.prices.provide(P) || []).find((m) => m.id === 'price:oath:gain');
  assert.ok(oath?.pct, 'the oath gives while she is near');
  const shares = [];
  for (const [id, d] of Object.entries(PRICES)) for (const part of ['gain', 'cost']) shares.push({ id, pct: d[part]?.pct || {}, label: d[part]?.label || '', text: part === 'gain' ? d.gainText : d.costText });
  shares.push({ id: 'oath (near)', pct: oath.pct, label: PRICES.oath.gain.label, text: PRICES.oath.gainText });
  let named = 0;
  for (const { id, pct, label, text } of shares) {
    {
      const words = { label, text };
      for (const [k, v] of Object.entries(pct)) {
        const fmt = STATS[k]?.fmt;
        if (k === 'speed') {
          assert.match(words.text, /of your normal pace/, `${id}: "${words.text}" says its +${Math.round(v * 100)}% speed is a share of your normal pace`);
          named++;
        } else if ((fmt === 'pct' || fmt === 'mul') && / of your /.test(pctWords(k, v))) {
          // A number shown as a % (weave power 100%, crit 10%): a share of yours, in the chip
          // and in the Spellbook's words alike.
          for (const [where, w] of Object.entries(words)) assert.match(w, /of your/, `${id} ${where}: "${w}" says its +${Math.round(v * 100)}% ${STATS[k].label.toLowerCase()} is a share of yours`);
          named++;
        }
      }
    }
  }
  assert.ok(named >= 5, `${named} shares named`);
  // Emberblood's burn is a share of your max health (EMBER_DRAIN × maxHp), not of what is left.
  assert.match(PRICES.emberblood.costText, /of your max health/);
  assert.match(PRICES.emberblood.cost.label, /of max health/);
});

test('v12 verify: the coldfire bar says its +% is a share of your Sword and Weave power', () => {
  const full = boostWords({ boost: () => 0.3, bar: 100 });
  assert.match(full.title, /of your Sword and Weave power/);
  assert.match(full.note, /\+30% of your Sword and Weave power/);
  assert.match(full.value, /^\+30%/, 'the number itself stays short');
  const some = boostWords({ boost: () => 0.19, bar: 63 });
  assert.match(some.title, /\+19% of your Sword and Weave power/);
});
