// Missions (DESIGN §22.3): every piece of the Weave but the starting bolt and the bosses'
// ten drops comes from exactly one mission; every mission can be finished by the events
// the game really emits; requirements never loop; state survives a save; the HUD line and
// the journal render; and no mission line, scene or rumor says a truth LORE §9 keeps hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { Inventory } from '../src/entities/items.js';
import { generateWorld } from '../src/world/worldgen.js';
import { MISSIONS, GIVERS } from '../src/missions/data.js';
import { MissionSystem } from '../src/missions/system.js';
import { missionComponents, BOSS_REWARDS, KINDS, WORDS, isBossReward } from '../src/missions/components.js';
import { ESSENCE_LINES, SHAPE_LINES, LyraWatch } from '../src/missions/lyra.js';
import { WEAVE_RUMORS, WeaveGossip } from '../src/missions/rumors.js';
import { WHEN, whenOk, pointPx } from '../src/missions/tracker.js';
import { missionsPlugin, ensureMissions } from '../src/missions/plugin.js';
import { MISSION_SCRIPTS, MISSION_SCENES } from '../src/story/scripts_missions.js';
import { SCRIPTS, validateStep } from '../src/story/scripts.js';
import { SCENES } from '../src/story/triggers.js';
import { PANELS } from '../src/story/panels.js';
import { hiddenIn as socialHidden } from '../src/ai/social/hidden.js';
import { RUMOR_KINDS } from '../src/ai/social/rumors.js';
import '../src/ai/social/village.js';
import { mainOptions, chooseOption } from '../src/entities/npc_dialogue.js';

const TILE = 16;

// ------------------------------------------------------------------ a small world

let WORLD = null;
function world() {
  if (WORLD) return WORLD;
  const g0 = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null, all: () => [], get: () => null }, atlas: null, ui: null };
  WORLD = generateWorld(g0, 20261123);
  return WORLD;
}

function makeClock() {
  const c = {
    t: 0,
    day: 1,
    hour: 8,
    weather: { type: 'clear', intensity: 0 },
    get isNight() {
      return this.hour >= 20.5 || this.hour < 5;
    },
  };
  return c;
}

function makeMagic() {
  const unlocked = { shapes: new Set(['bolt']), essences: new Set(['raw']), twists: new Set() };
  const m = {
    unlocked,
    log: [],
    slots: 4,
    essenceSlots: 2,
    twistSlots: 2,
    mana: { cur: 40, max: 40 },
    unlock(kind, id, source) {
      const set = unlocked[`${kind}s`];
      if (!set) throw new Error(`bad kind ${kind}`);
      set.add(id);
      m.log.push({ kind, id, source });
    },
    unlockSlot() {
      m.slots++;
    },
    unlockEssenceSlot() {
      m.essenceSlots++;
    },
    unlockTwistSlot() {
      m.twistSlots++;
    },
    addMaxMana(n) {
      m.mana.max += n;
    },
  };
  return m;
}

function makeNpc(game, id, x, y) {
  return { id, name: GIVERS[id]?.name || id, profile: { id }, x, y, game, opinionOfPlayer: 50, adjustOpinion(d) {
    this.opinionOfPlayer += d;
    return d;
  } };
}

function makeGame({ magic = true } = {}) {
  const w = world();
  const bus = new EventBus();
  const ents = new Map();
  const game = {
    bus,
    rng: new RNG(11),
    flags: {},
    state: 'playing',
    clock: makeClock(),
    locations: w.locations,
    objects: { all: () => [], get: (id) => (id === 'notice_board' ? { id, x: 83 * TILE, y: 57 * TILE } : null) },
    settings: {},
    entities: {
      get: (id) => ents.get(id) || null,
      all: () => [...ents.values()],
      add: (e) => (ents.set(e.id, e), e),
    },
    combat: { giveXp(a, n) {
      a.xp = (a.xp || 0) + n;
    } },
    isBlockedTile: () => false,
    map: { isWater: () => false },
    plugins: { get: (id) => (id === 'quest' ? { questName: 'The Candle and the Gate', stageOf: () => ({ index: game.questIndex ?? 0, text: 'Settle in.' }) } : null) },
    questIndex: 0,
  };
  if (magic) game.magic = makeMagic();
  const player = { id: 'player', x: 80 * TILE, y: 60 * TILE, level: 1, xp: 0, inventory: new Inventory(), facing: { x: 0, y: 1 } };
  game.player = player;
  ents.set('player', player);
  const lyra = { id: 'lyra', x: player.x + 20, y: player.y, mind: { companionship: 'together', autonomy: { stats: () => ({ trust: game.trust ?? 70, fear: 0 }) }, said: [], sayLines(lines) {
    this.said.push(...lines);
  }, remember() {}, appraise() {}, learn() {}, isSpeaking: () => false, perception: { threats: 0 } } };
  game.companion = lyra;
  ents.set('lyra', lyra);
  for (const id of Object.keys(GIVERS)) if (id !== 'lyra' && id !== 'board') ents.set(id, makeNpc(game, id, 70 * TILE, 60 * TILE));
  ents.set('cat', { id: 'cat_1', species: 'cat', x: 96 * TILE, y: 82 * TILE });
  game.missions = new MissionSystem(game);
  return game;
}

// ------------------------------------------------------------------ driving objectives

function placeCenter(game, id) {
  const l = game.locations.get(id);
  assert.ok(l, `location ${id} exists`);
  return { x: (l.bounds.x + l.bounds.w / 2) * TILE, y: (l.bounds.y + l.bounds.h / 2) * TILE };
}

function moveTo(game, pos) {
  game.player.x = pos.x;
  game.player.y = pos.y;
  game.companion.x = pos.x + 18;
  game.companion.y = pos.y;
}

function setTime(game, when) {
  if (!when) return;
  const w = typeof when === 'string' ? WHEN[when] : when;
  const h = w.from <= w.to ? (w.from + w.to) / 2 : w.from + 0.5;
  game.clock.hour = h % 24;
  assert.ok(whenOk(when, game.clock), `clock set for ${JSON.stringify(when)}`);
}

function tick(game, seconds) {
  const steps = Math.ceil(seconds / 0.25) + 1;
  for (let i = 0; i < steps; i++) game.missions.update(0.26);
}

function weaveFor(o) {
  const essences = ['raw'];
  if (o.essence) essences.push(o.essence);
  for (const e of ['light', 'iron', 'nature']) if (o.essences && essences.filter((x) => x !== 'raw').length < o.essences && !essences.includes(e)) essences.push(e);
  return { shape: o.shape || 'bolt', essences, twists: o.twist ? [o.twist] : [] };
}

// Do whatever the current objective asks, the way the game would report it.
function play(game, id) {
  const ms = game.missions;
  const m = ms.get(id);
  for (let guard = 0; guard < 12 && ms.status(id) === 'active'; guard++) {
    const o = ms.objective(id);
    const before = ms.state[id].step;
    setTime(game, o.when);
    if (o.at) moveTo(game, placeCenter(game, o.at));
    if (o.point) moveTo(game, pointPx(o.point));
    switch (o.type) {
      case 'weave':
        for (let i = 0; i < (o.count ?? 1); i++) game.missions.onEvent('spell_cast', { caster: game.player, weave: weaveFor(o), plan: {} });
        break;
      case 'defeat':
        if (o.target.startsWith('boss:')) game.missions.onEvent('boss_defeated', { id: o.target.slice(5) });
        else {
          tick(game, 1); // the objective may set its foes out first
          for (let i = 0; i < (o.count ?? 1); i++) {
            const pos = o.at ? placeCenter(game, o.at) : { x: game.player.x + 30, y: game.player.y };
            game.missions.onEvent('death', { entity: { id: `${o.target}_${i}`, species: o.target, x: pos.x, y: pos.y }, killer: game.player });
          }
        }
        break;
      case 'bring':
        game.player.inventory.add(o.item, o.count ?? 1);
        tick(game, 0.5);
        break;
      case 'collect':
        game.missions.onEvent('item_gained', { actor: game.player, itemId: o.item, qty: o.count ?? 1, from: 'pickup' });
        break;
      case 'reach':
        if (o.entity) {
          const e = game.missions.findEntity(o.entity);
          moveTo(game, { x: e.x + 4, y: e.y });
        }
        tick(game, (o.stay || 0) + 1);
        break;
      case 'talk':
        if (o.target === 'lyra') tick(game, 1);
        else {
          const npc = game.entities.get(o.target);
          const opts = ms.npcOptions(npc);
          assert.ok(opts.some((x) => x.id === `mission:talk:${id}`), `${id}: ${o.target} offers the talk step`);
          const r = ms.npcChoose(npc, `mission:talk:${id}`);
          assert.ok(r.lines.length, `${id}: the talk step has lines`);
        }
        break;
      case 'protect':
        tick(game, o.seconds + 1);
        break;
      default:
        assert.fail(`unknown objective type ${o.type}`);
    }
    if (ms.status(id) === 'active') assert.notEqual(ms.state[id].step, before, `${id}: objective ${before} (${o.type}) moved`);
  }
  if (ms.status(id) === 'ready') {
    const to = game.entities.get(ms.turnInTo(m));
    assert.ok(ms.npcOptions(to).some((x) => x.id === `mission:turnin:${id}`), `${id}: ${ms.turnInTo(m)} takes the turn-in`);
    const r = ms.npcChoose(to, `mission:turnin:${id}`);
    assert.ok(r.lines.length);
  }
  assert.equal(ms.status(id), 'done', `${id} finishes`);
}

function prepare(game) {
  game.trust = 80;
  game.questIndex = 6;
  game.clock.day = 3;
  game.missions.onEvent('spell_cast', { caster: game.player, weave: { shape: 'bolt', essences: ['raw'], twists: [] }, plan: {} });
}

// ------------------------------------------------------------------ the tests

test('every piece of the Weave but bolt and the boss drops comes from exactly one mission', () => {
  const given = new Map();
  for (const m of MISSIONS) {
    for (const r of m.rewards || []) {
      if (!r.magic) continue;
      const k = `${r.magic.kind}:${r.magic.id}`;
      assert.ok(KINDS[r.magic.kind]?.includes(r.magic.id), `${m.id} grants a real component (${k})`);
      assert.ok(!isBossReward(r.magic.kind, r.magic.id), `${m.id} must not grant a boss drop (${k})`);
      given.set(k, [...(given.get(k) || []), m.id]);
    }
  }
  for (const c of missionComponents()) {
    const k = `${c.kind}:${c.id}`;
    assert.equal(given.get(k)?.length, 1, `${k} is granted by exactly one mission (got ${given.get(k)?.join(', ') || 'none'})`);
  }
  assert.ok(!given.has('shape:bolt'), 'bolt is where you start');
  const boss = Object.values(BOSS_REWARDS).flat();
  assert.equal(boss.length, 10);
  for (const b of boss) assert.ok(!given.has(`${b.kind}:${b.id}`), `${b.kind} ${b.id} is a boss drop`);
  // Slot unlocks: two weave slots, a third essence, a third and fourth twist.
  const slots = MISSIONS.flatMap((m) => (m.rewards || []).filter((r) => r.slot).map((r) => r.slot)).sort();
  assert.deepEqual(slots, ['essence', 'twist', 'twist', 'weave', 'weave']);
  assert.ok(MISSIONS.some((m) => m.rewards.some((r) => r.maxMana)), 'missions grow max mana');
  // Boss-pointing missions exist for all five.
  for (const id of Object.keys(BOSS_REWARDS)) assert.ok(MISSIONS.some((m) => m.objectives.some((o) => o.target === `boss:${id}`)), `a mission points at ${id}`);
});

test('mission data is well formed: ids, givers, places, objectives, lines', () => {
  const ids = new Set();
  const w = world();
  for (const m of MISSIONS) {
    assert.ok(/^[a-z_]+$/.test(m.id), m.id);
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.ok(GIVERS[m.giver], `${m.id}: giver ${m.giver}`);
    assert.ok(m.title && m.summary && m.hint, `${m.id}: title, summary, hint`);
    assert.ok(m.offer?.length && m.accept?.length && m.decline?.length && m.progress?.length, `${m.id}: lines`);
    const to = m.turnIn === undefined ? m.giver : m.turnIn;
    if (to) assert.ok(m.turnin?.length, `${m.id}: turn-in lines`);
    if (to) assert.ok(GIVERS[to] && to !== 'board', `${m.id}: turn in to a person`);
    if (m.giver === 'board') assert.ok(m.board, `${m.id}: notice text`);
    if (m.danger) assert.ok(w.locations.get(m.danger), `${m.id}: danger place ${m.danger}`);
    assert.ok(m.objectives.length >= 1);
    for (const o of m.objectives) {
      assert.ok(o.label, `${m.id}: objective label`);
      for (const k of ['at', 'where']) if (o[k]) assert.ok(w.locations.get(o[k]), `${m.id}: ${k} ${o[k]}`);
      if (o.when) assert.ok(typeof o.when === 'object' || WHEN[o.when], `${m.id}: when ${o.when}`);
      if (o.type === 'talk') assert.ok(o.lines?.length && (o.target === 'lyra' || GIVERS[o.target]), `${m.id}: talk`);
      if (o.point) {
        const tx = o.point.tx;
        const ty = o.point.ty;
        assert.ok(tx >= 0 && ty >= 0 && tx < 160 && ty < 120, `${m.id}: point on the map`);
      }
    }
  }
  assert.ok(MISSIONS.length >= 16);
});

test('requirements form no cycles and every requirement names a real mission', () => {
  const byId = new Map(MISSIONS.map((m) => [m.id, m]));
  const state = {};
  const visit = (id, path) => {
    if (state[id] === 2) return;
    assert.notEqual(state[id], 1, `cycle: ${[...path, id].join(' -> ')}`);
    state[id] = 1;
    for (const r of byId.get(id).requires?.missions || []) {
      assert.ok(byId.has(r), `${id} requires unknown ${r}`);
      visit(r, [...path, id]);
    }
    state[id] = 2;
  };
  for (const m of MISSIONS) visit(m.id, []);
});

test('every mission can be finished by simulated events, in an order the requirements allow', () => {
  const game = makeGame();
  const ms = game.missions;
  assert.equal(ms.status('first_spark'), 'locked', 'nothing until the first weave');
  prepare(game);
  const order = [];
  for (let round = 0; round < MISSIONS.length + 2; round++) {
    const next = ms.available()[0];
    if (!next) break;
    assert.ok(ms.accept(next.id), `accept ${next.id}`);
    play(game, next.id);
    order.push(next.id);
  }
  assert.equal(order.length, MISSIONS.length, `all finished (left: ${MISSIONS.filter((m) => !order.includes(m.id)).map((m) => m.id).join(', ')})`);
  assert.equal(order[0], 'first_spark', 'the first spark comes first');
  // Every reward reached the runtime.
  for (const c of missionComponents()) assert.ok(game.magic.unlocked[`${c.kind}s`].has(c.id), `${c.kind} ${c.id} unlocked`);
  assert.equal(game.magic.slots, 6);
  assert.equal(game.magic.essenceSlots, 3);
  assert.equal(game.magic.twistSlots, 4);
  assert.ok(game.magic.mana.max > 100);
  for (const u of game.magic.log) assert.match(u.source, /^mission:/);
});

test('the early curve: strike first, then light within a couple of errands', () => {
  const game = makeGame();
  const ms = game.missions;
  prepare(game);
  game.trust = 50;
  game.clock.day = 1;
  game.questIndex = 0;
  ms.accept('first_spark');
  play(game, 'first_spark');
  assert.ok(game.magic.unlocked.shapes.has('strike'));
  const avail = ms.available().map((m) => m.id);
  for (const id of ['leaning_flames', 'why_hit_once', 'pips_lessons']) assert.ok(avail.includes(id), `${id} opens right after the first spark`);
  // Nothing dangerous and no boss is offered on the first minutes.
  for (const m of ms.available()) assert.ok(!m.danger, `${m.id} is not dangerous`);
  ms.accept('leaning_flames');
  play(game, 'leaning_flames');
  assert.ok(game.magic.unlocked.essences.has('light'));
});

test('when Lyra has cut the player off, the first lesson still happens without her', () => {
  const game = makeGame();
  const ms = game.missions;
  game.companion.mind.companionship = 'gone';
  prepare(game);
  tick(game, 8);
  assert.equal(ms.status('first_spark'), 'active');
  for (let i = 0; i < 3; i++) ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'bolt', essences: [], twists: [] } });
  tick(game, 1);
  assert.equal(ms.status('first_spark'), 'done');
  assert.ok(game.magic.unlocked.shapes.has('strike'));
  assert.equal(game.companion.mind.said.length, 0, 'she said nothing');
  // Her own later offers never come while she has cut them off.
  assert.ok(!ms.available().some((m) => m.giver === 'lyra' && ms.lyraOffered[m.id]));
});

test('without the magic runtime, unlocks wait in game.flags.pendingUnlocks and flush later', () => {
  const game = makeGame({ magic: false });
  const ms = game.missions;
  prepare(game);
  ms.accept('first_spark');
  play(game, 'first_spark');
  const pend = game.flags.pendingUnlocks;
  assert.ok(pend.some((u) => u.kind === 'shape' && u.id === 'strike'));
  game.magic = makeMagic();
  tick(game, 0.5);
  assert.ok(game.magic.unlocked.shapes.has('strike'));
  assert.equal(game.flags.pendingUnlocks.length, 0);
});

test('objective rules: time of day, place, filters, bring held at turn-in, time limits', () => {
  const game = makeGame();
  const ms = game.missions;
  prepare(game);
  for (const id of ['first_spark', 'why_hit_once']) {
    if (ms.status(id) !== 'available') continue;
    ms.accept(id);
    if (id === 'first_spark') play(game, id);
  }
  // why_hit_once wants strikes at the smithy: a bolt there, or a strike elsewhere, doesn't count.
  moveTo(game, placeCenter(game, 'chapel'));
  ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'strike', essences: [], twists: [] } });
  moveTo(game, placeCenter(game, 'smithy'));
  ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'bolt', essences: [], twists: [] } });
  assert.equal(ms.state.why_hit_once.n, 0);
  ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'strike', essences: [], twists: [] } });
  assert.equal(ms.state.why_hit_once.n, 1);
  assert.match(ms.hudLine()?.text || ms.objectiveText('why_hit_once'), /1\/3/);

  // Night objectives wait for night.
  game.clock.day = 3;
  for (const id of ['hinge_ore', 'silverleaf', 'pips_lessons', 'full_table', 'quarry_watch']) {
    if (ms.status(id) === 'available') {
      ms.accept(id);
      play(game, id);
    }
  }
  if (ms.status('cold_lake') === 'available') ms.accept('cold_lake');
  game.clock.hour = 12;
  moveTo(game, placeCenter(game, 'mirror_lake'));
  tick(game, 2);
  assert.equal(ms.state.cold_lake.step, 0, 'the lake at noon is not the lake after dark');
  assert.match(ms.objectiveText('cold_lake'), /after dark/);
  game.clock.hour = 22;
  tick(game, 1);
  assert.equal(ms.state.cold_lake.step, 1);

  // Bring: eaten before the turn-in, the errand goes back to fetching.
  const g2 = makeGame();
  prepare(g2);
  g2.missions.accept('first_spark');
  play(g2, 'first_spark');
  g2.missions.accept('hinge_ore');
  g2.player.inventory.add('iron_ore', 3);
  tick(g2, 0.5);
  assert.equal(g2.missions.status('hinge_ore'), 'ready');
  g2.player.inventory.remove('iron_ore', 2);
  tick(g2, 0.5);
  assert.equal(g2.missions.status('hinge_ore'), 'active');
  g2.player.inventory.add('iron_ore', 2);
  tick(g2, 0.5);
  const r = g2.missions.npcChoose(g2.entities.get('bram'), 'mission:turnin:hinge_ore');
  assert.ok(r.lines.length);
  assert.equal(g2.missions.status('hinge_ore'), 'done');
  assert.equal(g2.player.inventory.count('iron_ore'), 0, 'the ore was handed over');

  // A run with a time limit starts over when it takes too long.
  const g3 = makeGame();
  prepare(g3);
  for (const id of ['first_spark', 'hinge_ore', 'silverleaf', 'tracks']) {
    if (g3.missions.status(id) !== 'available') continue;
    g3.missions.accept(id);
    play(g3, id);
  }
  g3.missions.accept('wardrun');
  moveTo(g3, pointPx({ tx: 152, ty: 84 }));
  tick(g3, 1);
  assert.equal(g3.missions.state.wardrun.step, 1);
  moveTo(g3, { x: 10 * TILE, y: 10 * TILE });
  tick(g3, 125);
  assert.equal(g3.missions.state.wardrun.step, 0, 'too slow: back to the start');
});

test('villager dialogue: "Need a hand?" offers, accepts and turns in; not when they are cold', () => {
  const game = makeGame();
  prepare(game);
  game.missions.accept('first_spark');
  play(game, 'first_spark');
  const tilly = game.entities.get('tilly');
  tilly.profile = { id: 'tilly', facts: [], shop: null, greetings: ['Oi!'], farewells: ['Bye'] };
  tilly.opinionOfPlayer = 50;
  let opts = mainOptions(tilly, game.player);
  const offer = opts.find((o) => o.label === 'Need a hand?');
  assert.ok(offer, 'Tilly offers work');
  let r = chooseOption(tilly, offer.id, game.player);
  assert.ok(r.lines.length >= 2);
  assert.deepEqual(r.options.map((o) => o.id), ['mission:accept:why_hit_once', 'mission:decline:why_hit_once']);
  r = chooseOption(tilly, 'mission:accept:why_hit_once', game.player);
  assert.equal(game.missions.status('why_hit_once'), 'active');
  assert.ok(r.options.some((o) => o.id === 'talk'), 'back to her own menu');
  // Someone the player hurt today offers nothing.
  tilly.coldDay = game.clock.day;
  opts = mainOptions(tilly, game.player);
  assert.ok(!opts.some((o) => String(o.id).startsWith('mission:')));
});

test('Lyra: her own offers come through the chat; dangerous missions go through her request API', () => {
  const game = makeGame();
  const ms = game.missions;
  const said = [];
  game.ui = { chat: { addMessage: (m) => said.push(m) }, toast() {} };
  prepare(game);
  tick(game, 8);
  assert.equal(ms.status('first_spark'), 'active', 'the first spark starts by itself after the first weave');
  play(game, 'first_spark');
  // A dangerous one: she weighs it.
  const asked = [];
  game.companion.mind.evaluateRequest = (req) => {
    asked.push(req);
    return { decision: 'refuse', message: "Not that hill. Not today." };
  };
  game.actions = { run() {} };
  for (const id of ['hinge_ore', 'silverleaf', 'pips_lessons', 'full_table', 'quarry_watch', 'why_hit_once']) {
    if (ms.status(id) === 'available') {
      ms.accept(id);
      play(game, id);
    }
  }
  assert.equal(ms.status('fork_lit'), 'available');
  ms.accept('fork_lit');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].action, 'explore');
  assert.equal(asked[0].args.target, 'bandit_camp');
  assert.equal(ms.state.fork_lit.lyra, 'declined');
  assert.equal(ms.journal().active.find((c) => c.id === 'fork_lit').lyra, 'declined');
  // dead_waystone needs her trust: offered in the chat with a button.
  game.trust = 80;
  for (const id of ['leaning_flames', 'bee_song']) {
    if (ms.status(id) === 'available') {
      ms.accept(id);
      play(game, id);
    }
  }
  game.clock.day = 3;
  ms.lastLyraOffer = -Infinity;
  ms.pending.length = 0;
  tick(game, 2);
  const offer = said.find((m) => m.offer?.name === 'accept_mission');
  assert.ok(offer, 'an offer button in the chat');
  const res = missionsPlugin.actions.accept_mission.run({ value: offer.offer.args.value }, { game });
  assert.ok(res.ok);
  assert.equal(ms.status(offer.offer.args.value), 'active');
});

test('save and load keep every mission where it was', () => {
  const game = makeGame();
  const ms = game.missions;
  prepare(game);
  ms.accept('first_spark');
  play(game, 'first_spark');
  ms.accept('why_hit_once');
  moveTo(game, placeCenter(game, 'smithy'));
  ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'strike', essences: [], twists: [] } });
  ms.accept('hinge_ore');
  ms.track('hinge_ore');
  const data = JSON.parse(JSON.stringify(ms.serialize()));
  const g2 = makeGame();
  g2.missions.deserialize(data);
  assert.equal(g2.missions.status('first_spark'), 'done');
  assert.equal(g2.missions.status('why_hit_once'), 'active');
  assert.equal(g2.missions.state.why_hit_once.n, 1);
  assert.equal(g2.missions.tracked, 'hinge_ore');
  assert.equal(g2.missions.flags.weave_seen, true);
  assert.deepEqual(g2.missions.serialize().state, ms.serialize().state);
  // Through the plugin, with Lyra's eye and the gossip, as the game saves it.
  const g3 = makeGame();
  ensureMissions(g3);
  g3.missions.lyraWatch.seenEssences.push('dark');
  const blob = JSON.parse(JSON.stringify(missionsPlugin.serialize({ game: g3 })));
  const g4 = makeGame();
  ensureMissions(g4);
  missionsPlugin.deserialize(blob, { game: g4 });
  assert.deepEqual(g4.missions.lyraWatch.seenEssences, ['dark']);
  // Junk in a save is ignored, not fatal.
  const g5 = makeGame();
  g5.missions.deserialize({ state: { nope: { status: 'active' }, first_spark: { status: 'weird' } }, tracked: 'nope', granted: [{ kind: 'shape', id: 'laser' }] });
  assert.deepEqual(Object.keys(g5.missions.state), []);
  assert.equal(g5.missions.tracked, null);
  assert.equal(g5.missions.granted.length, 0);
});

test('markers: ! over givers, the notice board, ? for turn-ins, the tracked objective', () => {
  const game = makeGame();
  const ms = game.missions;
  prepare(game);
  ms.accept('first_spark');
  play(game, 'first_spark');
  let mk = ms.markers();
  assert.ok(mk.some((m) => m.kind === 'offer' && m.entity?.id === 'tilly'));
  assert.ok(mk.some((m) => m.kind === 'offer' && m.entity?.id === 'aveline'));
  ms.accept('leaning_flames');
  mk = ms.markers();
  const obj = mk.find((m) => m.kind === 'objective');
  const chapel = game.locations.get('chapel').center;
  assert.ok(obj && obj.x === chapel.x && obj.y === chapel.y, 'the objective marker sits on the chapel');
  moveTo(game, placeCenter(game, 'chapel'));
  tick(game, 1);
  ms.onEvent('spell_cast', { caster: game.player, weave: { shape: 'bolt', essences: [], twists: [] } });
  assert.equal(ms.status('leaning_flames'), 'ready');
  mk = ms.markers();
  assert.ok(mk.some((m) => m.kind === 'turnin' && m.entity?.id === 'aveline'));
  // Hints for the Spellbook's locked pieces.
  assert.match(ms.hintFor('essence', 'fire'), /Varek/);
  assert.match(ms.hintFor('twist', 'multishot'), /Tilly/);
  assert.match(ms.hintFor('essence', 'light'), /Leaning Flames/);
  assert.equal(ms.hintFor('shape', 'laser'), '');
});

test('the HUD line and the journal render with stubs', async () => {
  const restore = installFakeDom();
  try {
    const game = makeGame();
    const ms = game.missions;
    prepare(game);
    ms.accept('first_spark');
    const { Hud } = await import('../src/ui/hud.js');
    const fakeHud = { game, storyQuest: 'Settle in.', questText: document.createElement('span'), questLine: document.createElement('div'), questShown: null };
    Hud.prototype.refreshMission.call(fakeHud, true);
    assert.match(fakeHud.questText.textContent, /^First Spark: Weave three more sparks/);
    assert.equal(fakeHud.questLine.hidden, false);
    ms.track('story');
    Hud.prototype.refreshMission.call(fakeHud, true);
    assert.equal(fakeHud.questText.textContent, 'Settle in.');

    const view = await import('../src/ui/missions_view.js');
    const opened = [];
    game.uiRoot = document.createElement('div');
    game.ui = { root: game.uiRoot, stack: [], openModal: (p) => (game.ui.stack.push(p), opened.push(p)), closeModal: (p) => game.ui.stack.splice(game.ui.stack.indexOf(p), 1), top: () => null, toast() {} };
    view.openJournal(game, 'active');
    assert.equal(opened.length, 1);
    const text = opened[0].el.textAll();
    assert.match(text, /First Spark/);
    assert.match(text, /The Candle and the Gate/);
    view.openJournal(game, 'available');
    assert.match(opened[0].el.textAll(), /Leaning Flames|Need|Later/);
    view.openJournal(game, 'done');
    assert.match(opened[0].el.textAll(), /Nothing finished yet/);
  } finally {
    restore();
  }
});

test('no hidden truth in any mission line, scene, rumor or word about the Weave', () => {
  const lines = [];
  const add = (where, t) => {
    if (typeof t === 'string' && t.trim()) lines.push([where, t]);
  };
  for (const m of MISSIONS) {
    for (const k of ['title', 'summary', 'hint', 'board']) add(`${m.id}.${k}`, m[k]);
    for (const k of ['offer', 'accept', 'decline', 'progress', 'turnin']) for (const t of m[k] || []) add(`${m.id}.${k}`, t);
    for (const o of m.objectives) {
      add(`${m.id}.label`, o.label);
      add(`${m.id}.alone`, o.alone);
      for (const t of o.lines || []) add(`${m.id}.talk`, t);
    }
    for (const t of Object.values(m.lyra || {})) add(`${m.id}.lyra`, t);
  }
  for (const [e, ls] of Object.entries(ESSENCE_LINES)) for (const t of ls) add(`lyra.${e}`, t);
  for (const [s, ls] of Object.entries(SHAPE_LINES)) for (const t of ls) add(`lyra.${s}`, t);
  for (const [k, r] of Object.entries(WEAVE_RUMORS)) {
    add(`rumor.${k}`, r.text);
    add(`rumor.${k}.you`, r.you);
  }
  for (const kind of Object.values(WORDS)) for (const [id, [n, l]] of Object.entries(kind)) add(`words.${id}`, `${n}: ${l}`);
  for (const [id, sc] of Object.entries(MISSION_SCRIPTS)) for (const st of sc.steps) add(`scene.${id}`, st.say ? st.text : st.narrate);
  assert.ok(lines.length > 300);
  for (const [where, t] of lines) {
    assert.equal(socialHidden(t), null, `${where} says a hidden truth (${socialHidden(t)}): ${t}`);
    const hit = STORY_HIDDEN.find((re) => re.test(t));
    assert.equal(hit, undefined, `${where} reveals ${hit}: ${t}`);
  }
});

test('mission scenes are valid story steps, registered with the triggers, with stable keys', () => {
  for (const [id, sc] of Object.entries(MISSION_SCRIPTS)) {
    assert.equal(SCRIPTS[id], sc, `${id} joins SCRIPTS`);
    sc.steps.forEach((st, i) => assert.equal(validateStep(st, PANELS), null, `${id}[${i}]`));
    assert.ok(sc.steps.filter((s) => s.say || s.narrate).every((s) => s.key?.startsWith(`${id}.`)));
  }
  for (const s of MISSION_SCENES) assert.ok(SCENES.includes(s), `${s.id} registered`);
  // A check with no missions in the world is simply not ready.
  const c = { game: { flags: {} }, inPlace: () => false, calm: () => true };
  for (const s of MISSION_SCENES) assert.equal(!!s.check(c), false);
});

test('Lyra notices weaves: remembers the first, comments once per essence, worries about dark', () => {
  const game = makeGame();
  const ms = game.missions;
  const watch = new LyraWatch(game, ms);
  const mem = [];
  game.companion.mind.remember = (t, o) => mem.push([t, o]);
  const cast = (essences) => watch.onEvent('spell_cast', { caster: game.player, weave: { shape: 'bolt', essences, twists: [] } });
  cast(['raw']);
  assert.equal(watch.firstSeen, true);
  assert.equal(mem.length, 1);
  cast(['light']);
  cast(['light']);
  assert.deepEqual(watch.seenEssences, ['light']);
  assert.equal(ms.pending.length, 1, 'one comment on light');
  cast(['dark']);
  assert.ok(mem.some(([t, o]) => /gravelight/.test(t) && o.emotion === 'fear'));
  // Too far away to see: nothing.
  game.companion.x += 900;
  cast(['frost']);
  assert.ok(!watch.seenEssences.includes('frost'));
});

test('the village talks about weaving: wonder, fright near people, warmth for errands', () => {
  const game = makeGame();
  const raised = [];
  game.village = { addRumor: (kind, o) => (raised.push([kind, o]), { kind }) };
  const gossip = new WeaveGossip(game, game.missions);
  const wys = game.entities.get('wys');
  wys.x = game.player.x + 30;
  wys.y = game.player.y;
  const cast = () => gossip.onEvent('spell_cast', { caster: game.player, weave: { shape: 'blast', essences: ['raw'], twists: [] } });
  cast();
  assert.equal(raised[0][0], 'weaving');
  cast();
  cast();
  assert.ok(raised.some(([k, o]) => k === 'weave_scare' && o.victim === 'wys'));
  gossip.onEvent('mission_completed', { id: 'quarry_watch', mission: MISSIONS.find((m) => m.id === 'quarry_watch') });
  assert.ok(raised.some(([k, o]) => k === 'weave_errand' && o.victim === 'wys'));
  assert.ok(wys.opinionOfPlayer > 50);
  // The kinds are part of the village's rumor table.
  for (const k of Object.keys(WEAVE_RUMORS)) assert.ok(RUMOR_KINDS[k], `${k} registered`);
});

// ------------------------------------------------------------------ helpers

// Truths LORE §9 marks hidden, as tests/story.test.mjs words them.
const STORY_HIDDEN = [
  /\bKeepers?\b (of|in) the Song/i,
  /sang themselves|held out of time|struck through/i,
  /maren (is|was) (alive|singing|held)|joined the (song|verse)|cut her own name/i,
  /free of me|\bI chose this\b|tell her not to follow/i,
  /varek coll|sabeth'?s brother|her brother,? varek/i,
  /rowan'?s spear|took (his|varek'?s) eye/i,
  /lyra is brightborn|wenna (walked|went|stood) out|asked,? in the (falling light|brightfall)|eyes glowed|pinched the candles/i,
  /(bear|bears|hold|holds) forty-one|forty-(one|five) flames|\b41 flames|read the number|every (brindlecombe )?soul could be taken/i,
  /could not do it twice|changed (his|the) vote because/i,
  /garrick (pays|paid) the|purse (at|by) the (old )?boundary stone/i,
  /did not come to scout|failed to scout|drank (herself|himself) senseless/i,
  /moonpetal in the (honey )?cakes|letter in (her|the|elda'?s) strongbox/i,
  /mira (leaves|left) the herb/i,
  /ewan vale (is )?alive|walked away from (the )?(border )?wars/i,
  /twenty-three (people )?survived|ketty brask|gethin brask/i,
  /drowned verse-house|verse-house under/i,
  /the song is failing|verse by verse|binding others to sing/i,
  /chart of (this|the) verse/i,
  /tilly (has )?read|bram'?s poems/i,
  /buying the (old )?ferry-house|june'?s letter/i,
  /wys froze|rowan plays the flute/i,
];

// Just enough DOM for dom.js and the journal: elements with children, text, classes.
function installFakeDom() {
  const saved = { document: globalThis.document, Node: globalThis.Node, requestAnimationFrame: globalThis.requestAnimationFrame, window: globalThis.window };
  class FakeNode {}
  class El extends FakeNode {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.style = { setProperty() {} };
      this.dataset = {};
      this.listeners = {};
      this.hidden = false;
      this._text = '';
      const set = new Set();
      this.classList = { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), toggle: (c, on) => (on ?? !set.has(c) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
      this.className = '';
    }
    set textContent(v) {
      this.children = [];
      this._text = String(v);
    }
    get textContent() {
      return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
    }
    textAll() {
      return this.textContent;
    }
    append(...cs) {
      for (const c of cs) this.children.push(c);
    }
    prepend(...cs) {
      this.children.unshift(...cs);
    }
    after(...cs) {
      this.parent?.children.splice(this.parent.children.indexOf(this) + 1, 0, ...cs);
    }
    remove() {}
    removeChild(c) {
      this.children.splice(this.children.indexOf(c), 1);
    }
    get firstChild() {
      return this.children[0] || null;
    }
    get childNodes() {
      return this.children;
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    addEventListener(k, fn) {
      (this.listeners[k] = this.listeners[k] || []).push(fn);
    }
    querySelector() {
      return null;
    }
  }
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new El(t), getElementById: () => null, head: new El('head') };
  globalThis.requestAnimationFrame = () => 0;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  };
}
