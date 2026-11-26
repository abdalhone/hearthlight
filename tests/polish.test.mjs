// Round 14b, workstream polish: the rules it adds, each with its test.
//   - broken props mend only where people live (src/world/broken.js peopleLiveAt, mendTick);
//   - snow keeps cool and pale under a warm light (src/render/lighting.js snowLight);
//   - overdraw's drought is paid in full; emberblood's blood pays part of each weave
//     (src/magic/prices.js);
//   - the Spellbook's Leech preview draws life home to the caster (src/ui/weave_sandbox.js);
//   - the Last Stand's minute never makes a child killable (D1: children stay unkillable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_SECONDS, TILE } from '../src/core/constants.js';
import { peopleLiveAt, mendTick } from '../src/world/broken.js';
import { MEND, strikeProp } from '../src/world/breakables.js';
import { snowLight, Lighting } from '../src/render/lighting.js';
import { ambientAt } from '../src/render/text_layout.js';
import { makeGame as makeArena, step as arenaStep, resetArena, AIM } from './magic_helpers.mjs';
import { installProgression } from '../src/progression/index.js';
import { SandboxPreview } from '../src/ui/weave_sandbox.js';
import { compileWeave } from '../src/magic/compile.js';
import { PriceRuntime } from '../src/magic/prices.js';
import { makeGame as makeMurderWorld, step as worldStep, put, px } from './murder_world.mjs';

// ------------------------------------------------------------------ mending

// A broken prop as the mend rule sees it (objects.js calls mendTick from its update).
function brokenProp(game, tx, ty, objType = 'barrel', mendAt = 1) {
  return { game, tx, ty, objType, solid: false, state: { broken: true, mendAt }, markDirty() {}, _changed() {} };
}
const village = (hereIds = ['bram']) => ({
  villagers: () => hereIds.map((id) => ({ id, here: true })).concat([{ id: 'gone', here: false }]),
  isHere: (e) => !!e.here,
});

test('polish: people live in the vale while anyone is still there; not in Brindlecombe, not in the wilds', () => {
  const g = { clock: { t: 0 }, villageLife: village() };
  assert.equal(peopleLiveAt(g, 80, 90), true, 'the vale, with people in it');
  assert.equal(peopleLiveAt(g, -306, 46), false, 'Brindlecombe, the dead village');
  assert.equal(peopleLiveAt(g, 84, -150), false, 'the treeline camp');
  assert.equal(peopleLiveAt(g, 182, 66), false, 'the far shore');
  assert.equal(peopleLiveAt({ villageLife: village([]) }, 80, 90), false, 'a vale whose people are all gone');
  assert.equal(peopleLiveAt({ villageLife: village(), occupation: { emptied: () => true } }, 80, 90), false, 'a village emptied (the fallen village)');
  assert.equal(peopleLiveAt({}, 80, 90), true, 'no village life (a bare arena): the vale as it was');
});

test('polish: nothing mends where nobody lives; it is asked again a day later; the vale mends; a bush grows back anywhere', () => {
  const g = { clock: { t: 10 * DAY_SECONDS }, villageLife: village() };
  const dead = brokenProp(g, -311, 43, 'barrel');
  const wild = brokenProp(g, -151, 81, 'woodpile');
  const home = brokenProp(g, 71, 40, 'crate');
  const bush = brokenProp(g, -150, 80, 'bush');
  assert.equal(mendTick(dead), false);
  assert.equal(dead.state.broken, true, 'Brindlecombe keeps its debris');
  assert.equal(dead.state.mendAt, g.clock.t + DAY_SECONDS, 'and asks again a day on');
  assert.equal(mendTick(wild), false);
  assert.equal(wild.state.broken, true, 'so do the wilds');
  assert.equal(mendTick(home), true);
  assert.equal(home.state.broken, false, 'the vale sweeps up and mends');
  assert.equal(mendTick(bush), true, 'a bush is not mended: it grows back');
  // Years later, still nobody: still broken.
  for (let d = 0; d < 30; d++) {
    g.clock.t += DAY_SECONDS;
    mendTick(dead);
  }
  assert.equal(dead.state.broken, true);
  // Not yet due: nothing is asked.
  const fresh = brokenProp(g, 71, 41, 'crate', g.clock.t + 5);
  assert.equal(mendTick(fresh), false);
  assert.equal(fresh.state.mendAt, g.clock.t + 5);
});

test('polish: in the vale itself a prop broken by a Strike is mended two days on, and not once its people are gone', () => {
  const g = makeMurderWorld({ hour: 12 });
  const props = g.objects.list.filter((o) => ['barrel', 'crate'].includes(o.objType) && !o.story && !o.inventory && !o.hidden && o.tx > 0 && o.ty > 0);
  assert.ok(props.length >= 2, `props in the vale (${props.length})`);
  const [a, b] = props;
  put(g.player, a.x, a.y + 30);
  assert.ok(strikeProp(g, a, { source: g.player, amount: 999, punch: true }));
  assert.equal(a.state.broken, true);
  g.player.x = px(20);
  g.player.y = px(20);
  g.clock.t += MEND + 1;
  a.update(1 / 20);
  assert.equal(a.state.broken, false, 'mended where people live');
  // Every villager gone (the vale emptied): the next one lies broken.
  for (const e of g.villageLife.villagers()) g.villageLife.markGone(e.id, { cause: 'taken_away' });
  assert.ok(strikeProp(g, b, { source: g.player, amount: 999, punch: true }));
  g.clock.t += MEND * 3;
  b.update(1 / 20);
  worldStep(g, 0.2);
  assert.equal(b.state.broken, true, 'nobody left to mend it');
});

// ------------------------------------------------------------------ snow

const lum = (a) => 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b;

test('polish: snow under a warm light stays cool and pale; noon and night are left alone', () => {
  for (const hour of [6.2, 18.3, 18.6, 19.2]) {
    const warm = ambientAt(hour, {}, {});
    const on = snowLight({ ...warm }, 1);
    assert.ok(on.b >= on.r - 2, `${hour}h: cool on snow (${on.r},${on.g},${on.b} from ${warm.r},${warm.g},${warm.b})`);
    assert.ok(lum(on) >= lum(warm) * 0.95, `${hour}h: pale, not darker (${lum(on).toFixed(0)} vs ${lum(warm).toFixed(0)})`);
    assert.ok(Math.abs(on.darkness - (1 - lum(on) / 255)) < 0.01, 'the darkness follows');
    const half = snowLight({ ...warm }, 0.4);
    assert.ok(half.r < warm.r && half.r > on.r, `${hour}h: the foothills' thin snow is between`);
    assert.deepEqual(snowLight({ ...warm }, 0), warm, 'no snow, no change');
  }
  for (const hour of [12, 0, 23]) {
    const a = ambientAt(hour, {}, {});
    assert.deepEqual(snowLight({ ...a }, 1), a, `${hour}h: unchanged`);
  }
});

test('polish: the lighting eases into the snow light where travel says the ground is snow, and out of it', () => {
  const game = { clock: { hour: 18.4, day: 1, weather: { type: 'clear' } }, weather: { localSnow: 1 }, player: null, map: null };
  const L = new Lighting(game);
  L._computeAmbient(1 / 60);
  const first = { ...L.ambient };
  for (let i = 0; i < 300; i++) L._computeAmbient(1 / 60);
  assert.ok(L.ambient.b > first.b && L.ambient.r < first.r, 'eased, not popped');
  assert.ok(L.ambient.b >= L.ambient.r - 2, `cool on the Crown Ring at dusk (${L.ambient.r},${L.ambient.g},${L.ambient.b})`);
  game.weather.localSnow = 0;
  for (let i = 0; i < 600; i++) L._computeAmbient(1 / 60);
  assert.ok(L.ambient.r > L.ambient.b + 60, `back in the vale, dusk is warm again (${L.ambient.r},${L.ambient.g},${L.ambient.b})`);
});

// ------------------------------------------------------------------ prices

function priceArena() {
  const g = makeArena({ foes: 3 });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  g.magic.unlockAll();
  g.toasts = [];
  g.ui = { toast: (t) => g.toasts.push(t) };
  resetArena(g);
  g.prices.deserialize(null);
  return g;
}
function run(g, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    arenaStep(g);
    g.stats.update(1 / 60);
    g.prices.update(1 / 60);
  }
}

test('polish: overdraw\'s drought is paid in full; casting it again while the well is dry borrows nothing', () => {
  const g = priceArena();
  const P = g.player;
  const m = g.magic;
  const od = { shape: 'bolt', essences: ['raw'], twists: [], prices: ['overdraw'] };
  const plan = m.compile({ shape: 'bolt', essences: ['raw'] });
  assert.ok(m.cast(P, od, AIM).ok);
  assert.equal(m.costOf(P, plan), 0, 'free for ten breaths');
  run(g, 10.2);
  assert.equal(g.stats.get(P, 'manaRegen'), 0, 'the drought');
  m.resetCooldowns();
  m.mana.cur = m.mana.max;
  const before = m.mana.cur;
  assert.ok(m.cast(P, od, AIM).ok, 'the weave still leaves your hands');
  assert.ok(m.mana.cur < before, 'and costs its mana');
  assert.ok(m.costOf(P, plan) > 0, 'nothing is free again');
  assert.equal(g.stats.get(P, 'manaRegen'), 0, 'the drought holds');
  assert.ok(g.toasts.some((t) => /well is dry/.test(t)), 'it says why');
  run(g, 20.5);
  assert.ok(g.stats.get(P, 'manaRegen') > 0, 'twenty seconds on, the well fills');
  assert.equal(g.prices.state.overdraw, null);
  m.resetCooldowns();
  assert.ok(m.cast(P, od, AIM).ok);
  assert.equal(m.costOf(P, plan), 0, 'and it can be borrowed again');
});

test('polish: emberblood makes weaves cheaper while it burns (the blood pays part), and no cheaper once doused', () => {
  const g = priceArena();
  const P = g.player;
  const m = g.magic;
  const plan = m.compile({ shape: 'bolt', essences: ['raw'] });
  const full = m.costOf(P, plan);
  assert.ok(m.cast(P, { shape: 'bolt', essences: ['raw'], twists: [], prices: ['emberblood'] }, AIM, { free: true }).ok);
  assert.ok(Math.abs(m.costOf(P, plan) - full * 0.7) <= 1, `30% less (${m.costOf(P, plan)} of ${full})`);
  assert.ok(Math.abs(g.stats.get(P, 'castSpeed') - 1.3) < 1e-9, 'and 30% faster');
  g.prices.douse();
  assert.equal(m.costOf(P, plan), full);
});

test('polish: the price play-test agrees: each price gives more in a short fight than no price at all', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = JSON.parse(execFileSync(process.execPath, ['scripts/price_sim.mjs', '--json'], { encoding: 'utf8' }));
  const row = (p) => out.find((r) => r.price === p);
  const none = row('(none)');
  for (const p of ['bloodprice', 'glass', 'overdraw', 'emberblood', 'oath']) assert.ok(row(p).d15 > none.d15 * 1.15, `${p}: ${row(p).d15} vs ${none.d15} in 15 s`);
  assert.ok(row('berserk, sword').d60 > row('(none), sword').d60 * 1.15, 'berserk: the sword hits harder');
  // A price is a price: the long fights cost.
  for (const p of ['bloodprice', 'overdraw', 'emberblood']) assert.ok(row(p).d60 < none.d60, `${p} costs over a minute (${row(p).d60} vs ${none.d60})`);
  assert.ok(row('overdraw, recast').d30 <= row('overdraw').d30 + 5, 'recasting overdraw does not skip its drought');
});

// ------------------------------------------------------------------ the Leech preview

const canvas = { getContext: () => null, clientWidth: 400, clientHeight: 168, width: 0, height: 0 };
function preview(twists) {
  const pv = new SandboxPreview(canvas, null);
  const weave = { shape: 'bolt', essences: ['fire'], twists };
  const plan = compileWeave(weave, { trusted: true });
  pv.set(weave, plan, plan.palette);
  let most = 0;
  let glow = 0;
  for (let i = 0; i < 60 * 3; i++) {
    pv.update(1 / 60);
    most = Math.max(most, pv.drains.length);
    glow = Math.max(glow, pv.glow);
  }
  return { most, glow };
}

test('polish: the Leech preview draws life from the dummy home to the caster; a plain bolt draws none', () => {
  const leech = preview(['leech']);
  assert.ok(leech.most >= 1, 'a stream of life runs home');
  assert.ok(leech.glow > 0.5, 'and the caster glows as it lands');
  const plain = preview([]);
  assert.equal(plain.most, 0);
  assert.equal(plain.glow, 0);
  const other = preview(['pierce']);
  assert.equal(other.most, 0, 'only leech draws it');
});

// ------------------------------------------------------------------ children (D1)

test('polish: burning in the Last Stand ("kill anybody") still never makes a child killable', () => {
  const g = makeMurderWorld({ hour: 12 });
  g.prices = new PriceRuntime(g);
  g.prices.state.laststand = 'armed';
  assert.ok(g.prices.riseLastStand(g.player, 'chosen'));
  assert.ok(g.prices.burning());
  const pip = g.entities.get('pip');
  const tansy = g.entities.get('tansy');
  put(g.player, px(60), px(60));
  put(pip, px(61), px(60));
  assert.equal(g.murder.canKill(pip), false, 'Pip (9)');
  assert.equal(g.murder.canKill(tansy), false, 'Tansy (15)');
  assert.equal(g.murder.kill(pip, g.player), null);
  assert.ok(!pip.dead);
  void TILE;
});
