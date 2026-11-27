// Round 15, the shop builder's items (DESIGN §40): The Leaning Flames could not be ended,
// and every weave objective in every mission must be doable with the real Weave.
//
// The cause, found by playing it (scripts/shop_mission_check.mjs): "Weave a spark before the
// altar" sends the spark at the altar, and Sister Aveline stands before it. The spark struck
// her; a giver the player has just hurt takes no turn-in (npc_dialogue: no mission options
// from someone afraid of you), so the mission sat at "Return to Sister Aveline" for good.
// The same trap stood in every weave errand set in a lived-in place (Bram at his anvil, Pip
// in the square, Sabeth at her vats). A weave made for an errand's showing now spares the
// people around it (missions.showing, asked by magic._newCast).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, run } from './magic_helpers.mjs';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { generateWorld } from '../src/world/worldgen.js';
import { MISSIONS } from '../src/missions/data.js';
import { MissionSystem } from '../src/missions/system.js';
import { WHEN, pointPx } from '../src/missions/tracker.js';

let WORLD = null;
function world() {
  if (WORLD) return WORLD;
  const g0 = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null, all: () => [], get: () => null }, atlas: null, ui: null };
  WORLD = generateWorld(g0, 20261123);
  return WORLD;
}

// The Weave's arena opened out over the vale's places: the real magic, combat and entities,
// the real locations, no walls (the places' own walls are not what is tested here).
function vale() {
  const g = makeGame({ foes: 0 });
  const open = () => false;
  g.map.blocksProjectile = open;
  g.map.isSolidTile = open;
  g.map.w = 400;
  g.map.h = 400;
  g.isBlockedTile = open;
  g.locations = world().locations;
  g.clock.hour = 11;
  g.clock.day = 3;
  g.magic.unlockAll();
  g.missions = new MissionSystem(g);
  g.bus.on('spell_cast', (p) => g.missions.onEvent('spell_cast', p));
  return g;
}

function setTime(g, when) {
  if (!when) return;
  const w = typeof when === 'string' ? WHEN[when] : when;
  g.clock.hour = (w.from <= w.to ? (w.from + w.to) / 2 : w.from + 0.5) % 24;
  g.clock.isNight = when === 'night';
}

// Where an objective is done: the centre of its place, or its point.
function spotOf(g, o) {
  if (o.point) return pointPx(o.point);
  const b = g.locations.get(o.at)?.bounds;
  assert.ok(b, `place ${o.at} exists`);
  return { x: (b.x + b.w / 2) * 16, y: (b.y + b.h / 2) * 16 };
}

function weaveFor(o) {
  const essences = [];
  if (o.essence) essences.push(o.essence);
  for (const e of ['light', 'fire', 'frost']) if (o.essences && essences.length < o.essences && !essences.includes(e)) essences.push(e);
  if (!essences.length) essences.push('raw');
  return { shape: o.shape || 'bolt', essences, twists: o.twist ? [o.twist] : [] };
}

// The player at the spot, a friend a step ahead in the line of the weave, the aim beyond.
function stage(g, spot) {
  const p = g.player;
  p.x = spot.x;
  p.y = spot.y;
  p.facing = { x: 0, y: -1 };
  const v = g.villager;
  v.x = spot.x;
  v.y = spot.y - 30;
  v.hp = v.maxHp;
  if (g.companion) {
    g.companion.x = spot.x + 200;
    g.companion.y = spot.y + 200;
  }
  return { x: spot.x, y: spot.y - 80 };
}

function castAt(g, weave, aim) {
  const m = g.magic;
  m.mana.cur = m.mana.max = 999;
  m.resetCooldowns();
  const r = m.cast(g.player, weave, aim);
  assert.ok(r.ok, `the weave is cast (${r.reason || ''} ${r.message || ''})`);
  run(g, 1.2);
}

function toWeaveStep(ms, id) {
  ms.accept(id, { silent: true, askLyra: false });
  for (let guard = 0; guard < 8 && ms.objective(id)?.type !== 'weave'; guard++) ms.completeStep(id);
  assert.equal(ms.objective(id)?.type, 'weave', `${id} reaches its weave step`);
}

test('The Leaning Flames: the spark before the altar spares Sister Aveline, and the mission ends', () => {
  const g = vale();
  const ms = g.missions;
  ms.flags.weave_seen = true;
  ms.state.first_spark = { status: 'done', step: 0, n: 0 };
  // Aveline (here the arena's villager, by her id) stands before the altar.
  g.villager.id = 'aveline';
  g.villager.profile = { id: 'aveline' };
  toWeaveStep(ms, 'leaning_flames');
  const o = ms.objective('leaning_flames');
  const aim = stage(g, spotOf(g, o));
  castAt(g, { shape: 'bolt', essences: ['raw'], twists: [] }, aim);
  assert.equal(g.villager.hp, g.villager.maxHp, 'the spark did not strike her');
  assert.equal(ms.status('leaning_flames'), 'ready', 'the weave counted');
});

test('the same spark with no errand to show still strikes whoever stands in its line', () => {
  const g = vale();
  const o = { at: 'chapel' };
  const aim = stage(g, spotOf(g, o));
  castAt(g, { shape: 'bolt', essences: ['raw'], twists: [] }, aim);
  assert.ok(g.villager.hp < g.villager.maxHp, 'a weave aimed through a friend still hits them (an accident)');
});

test('every weave objective in every mission can be done with the real Weave, a friend in its line', () => {
  const weaveMissions = MISSIONS.filter((m) => m.objectives.some((o) => o.type === 'weave'));
  assert.ok(weaveMissions.length >= 9, `the weave errands are all here (${weaveMissions.length})`);
  for (const m of weaveMissions) {
    for (let k = 0; k < m.objectives.length; k++) {
      const o = m.objectives[k];
      if (o.type !== 'weave') continue;
      const g = vale();
      const ms = g.missions;
      ms.flags.weave_seen = true;
      ms.accept(m.id, { silent: true, askLyra: false });
      for (let i = 0; i < k; i++) ms.completeStep(m.id);
      assert.equal(ms.objective(m.id), o, `${m.id}: at its weave step ${k}`);
      setTime(g, o.when);
      const spot = o.at || o.point ? spotOf(g, o) : { x: 80 * 16, y: 60 * 16 };
      const aim = stage(g, spot);
      const step0 = ms.state[m.id].step;
      for (let i = 0; i < (o.count ?? 1); i++) castAt(g, weaveFor(o), aim);
      const s = ms.state[m.id];
      assert.ok(s.step > step0 || ['ready', 'done'].includes(s.status), `${m.id}: "${o.label}" is done by ${o.count ?? 1} weave(s) (n ${s.n}, step ${s.step}, ${s.status})`);
      if (o.at || o.point) assert.equal(g.villager.hp, g.villager.maxHp, `${m.id}: "${o.label}" spares the friend in its line`);
    }
  }
});

test('borrowed magic ("Try all magic") does not count for an errand, and it says so once', () => {
  const g = vale();
  const toasts = [];
  g.ui.toast = (t) => toasts.push(String(t));
  const ms = g.missions;
  ms.flags.weave_seen = true;
  ms.state.first_spark = { status: 'done', step: 0, n: 0 };
  toWeaveStep(ms, 'leaning_flames');
  // A trial over a real state that has only the Spark.
  const m = g.magic;
  m.trial = { unlocked: { shapes: new Set(['bolt']), essences: new Set(['raw']), twists: new Set(), prices: new Set() } };
  const aim = stage(g, spotOf(g, { at: 'chapel' }));
  castAt(g, { shape: 'bolt', essences: ['fire'], twists: [] }, aim);
  castAt(g, { shape: 'bolt', essences: ['fire'], twists: [] }, aim);
  assert.equal(ms.status('leaning_flames'), 'active', 'a borrowed part does not count');
  assert.equal(toasts.filter((t) => /borrowed magic does not count/.test(t)).length, 1, 'told once, in words');
  castAt(g, { shape: 'bolt', essences: ['raw'], twists: [] }, aim);
  assert.equal(ms.status('leaning_flames'), 'ready', 'the earned Spark counts during the trial');
});
