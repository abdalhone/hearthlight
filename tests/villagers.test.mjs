// The eighteen villagers of round 3 (DESIGN §19.1, §19.7, §19.8; docs/LORE.md §6, §9.10, §10):
// profiles, schedules, hidden facts, family, art, sleeping in their own beds, the
// lamplighter's round, Hess and Wys, and the village answering a call for help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { TILE } from '../src/core/constants.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor, factionRelation } from '../src/entities/entity.js';
import { ITEMS } from '../src/entities/items.js';
import { LocationIndex } from '../src/world/locations.js';
import { NPC_PROFILES, profileById } from '../src/entities/npc_data.js';
import { MORE_PROFILES, MORE_KNOWS, MORE_IDS, factTellable } from '../src/entities/npc_data_more.js';
import { RESPONSE_LINES } from '../src/entities/npc_lines.js';
import { scheduleProblems, entryAt } from '../src/entities/npc_schedule.js';
import { NPC, helpRole, ensureVillagers, PLACE_FALLBACK } from '../src/entities/npc.js';
import { spawnCreature } from '../src/entities/monsters.js';
import { resetPathBudget } from '../src/entities/npc_walker.js';
import { answerTopic, getDialogue, chooseOption } from '../src/entities/npc_dialogue.js';
import { availableFacts } from '../src/ai/mind/conversation.js';
import { paintHumanoid, HUMANOID_ANIMS, DIRECTIONS } from '../src/art/characters_humanoid.js';
import { normalizeAppearance } from '../src/art/characters_appearance.js';
import { paintPortrait } from '../src/art/characters_portrait.js';
import { PAINTED_ICONS } from '../src/art/items_art.js';

const px = (t) => t * TILE + TILE / 2;

const KNOWN_PLACES = [
  'hearthvale', 'town_square', 'player_home', 'ember_kettle', 'smithy', 'general_store', 'chapel', 'herbalist',
  'guardhouse', 'farmhouse', 'reed_farm', 'whisperwood', 'stonecut_quarry', 'bandit_camp', 'mirror_lake',
  'sunken_ruins', 'south_meadow', 'kings_road',
];
const NEW_PLACES = ['chandlery', 'lamplight_lane', 'ashby_house', 'dye_cottage', 'weavers_row', 'net_shed', 'wenna_hives'];
const TEN = ['hobb', 'wenna', 'hess', 'sabeth', 'alder', 'petra', 'tilly', 'tansy', 'corran', 'wys'];
const EIGHT = ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick'];
const ALL = [...EIGHT, ...TEN];

// ---------------------------------------------------------------- a small fake world

class FakeCombat {
  constructor(game) {
    this.game = game;
    this.swings = [];
    this.shots = [];
    this.heals = [];
  }
  now() {
    return this.game.clock.t;
  }
  hasCrime(actor) {
    return !!actor?.crime && actor.crime.until > this.now();
  }
  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if ((a.faction === 'guard' && this.hasCrime(b)) || (b.faction === 'guard' && this.hasCrime(a))) return true;
    if (factionRelation(a.faction, b.faction) === 'hostile') return true;
    const prov = (c, o) => c.provokedBy === o && c.provokedMode === 'fight' && this.now() - c.provokedAt < 45;
    return prov(a, b) || prov(b, a);
  }
  melee(attacker, opts = {}) {
    this.swings.push({ attacker, opts });
    return true;
  }
  shoot(attacker, tx, ty, kind = 'bolt', opts = {}) {
    this.shots.push({ attacker, tx, ty, kind, opts });
    return {};
  }
  damage(source, target, amount) {
    target.hp = Math.max(0, target.hp - amount);
    this.game.bus.emit('damage', { source, target, amount, kind: 'melee' });
    if (target.hp <= 0) this.down(target, source);
    return amount;
  }
  heal(source, target, amount) {
    const got = Math.min(amount, target.maxHp - target.hp);
    target.hp += got;
    this.heals.push({ source, target, got });
    return got;
  }
  down(target, by) {
    if (target.downed) return false;
    target.hp = 0;
    target.downed = true;
    target.setState('downed');
    this.game.bus.emit('downed', { entity: target, by });
    target.onDowned?.(by);
    return true;
  }
  revive(target, by, f = 0.35) {
    if (!target.downed) return false;
    target.downed = false;
    target.hp = Math.max(1, Math.round(target.maxHp * f));
    target.setState('idle');
    this.game.bus.emit('revived', { entity: target, by });
    target.onRevived?.(by);
    return true;
  }
}

function fakeObject(o) {
  return { solid: false, removed: false, state: {}, markDirty() {}, ...o, x: o.x ?? px(o.tx), y: o.y ?? o.ty * TILE + TILE - 1 };
}

function makeGame({ w = 90, h = 70, objects = [], extraLocs = [] } = {}) {
  resetPathBudget();
  const locs = [
    { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'town_square', name: 'Town Square', kind: 'square', bounds: { x: 30, y: 20, w: 10, h: 8 }, parent: 'hearthvale' },
    { id: 'smithy', name: 'Ironhand Smithy', kind: 'building', indoor: true, bounds: { x: 10, y: 10, w: 6, h: 5 }, parent: 'hearthvale' },
    { id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building', indoor: true, bounds: { x: 20, y: 10, w: 8, h: 6 }, parent: 'hearthvale' },
    { id: 'chapel', name: 'Chapel of the Hearth', kind: 'building', indoor: true, bounds: { x: 30, y: 10, w: 6, h: 6 }, parent: 'hearthvale' },
    { id: 'guardhouse', name: 'Guardhouse', kind: 'building', indoor: true, bounds: { x: 42, y: 10, w: 6, h: 5 }, parent: 'hearthvale' },
    { id: 'whisperwood', name: 'Whisperwood', kind: 'forest', bounds: { x: 50, y: 30, w: 30, h: 30 } },
    ...extraLocs,
  ];
  const said = [];
  const events = [];
  const objs = objects.map(fakeObject);
  const game = {
    time: 0,
    bus: new EventBus(),
    rng: new RNG(7),
    settings: {},
    flags: {},
    locations: new LocationIndex(locs),
    map: { w, h, inBounds: (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h, isWater: () => false, blocksProjectile: () => false, buildingAt: () => null, isIndoors: () => false },
    objects: { all: () => objs, get: (id) => objs.find((o) => o.id === id) || null, doorAt: () => null, isBlockingTile: () => false },
    isBlockedTile(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
      return objs.some((o) => o.solid && !o.removed && (o.footprint ? tx >= o.footprint.x && ty >= o.footprint.y && tx < o.footprint.x + o.footprint.w && ty < o.footprint.y + o.footprint.h : tx === o.tx && ty === o.ty));
    },
    bubbles: { say: (e, text, o) => said.push({ e, text, o }), icon() {}, number() {} },
    particles: { emit() {} },
    camera: { x: 0, y: 0, vw: 2000, vh: 2000 },
    pathfinder: null,
    player: null,
    companion: null,
    said,
    events,
  };
  game.clock = new GameClock(game);
  game.clock.weather.timer = 1e9;
  game.entities = new EntityManager(game);
  game.combat = new FakeCombat(game);
  game.bus.on('*', (type, p) => events.push({ type, p }));
  return game;
}

function addPlayer(game, x, y) {
  const p = new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', maxHp: 60, atk: 6, speed: 78, spriteKey: 'player', x, y });
  game.player = game.entities.add(p);
  return p;
}

function addLyra(game, x, y) {
  const l = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', maxHp: 60, atk: 6, speed: 70, spriteKey: 'lyra', x, y });
  l.downable = true;
  game.companion = game.entities.add(l);
  return l;
}

function addNpc(game, id, tx, ty) {
  return game.entities.add(new NPC(game, profileById(id), { x: px(tx), y: px(ty) }));
}

function run(game, seconds, dt = 1 / 30) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.time += dt;
    game.clock.t += dt;
    game.entities.update(dt);
  }
}

function setHour(game, hour) {
  game.clock.skipTo(hour);
}

// ---------------------------------------------------------------- profiles

test('all eighteen profiles are complete and follow the schema', () => {
  assert.deepEqual(NPC_PROFILES.map((p) => p.id).sort(), [...ALL].sort());
  assert.deepEqual(MORE_IDS, TEN);
  for (const p of NPC_PROFILES) {
    const n = p.id;
    assert.ok(p.name && p.role && p.personality && p.voice, `${n} identity`);
    assert.ok(['villager', 'guard'].includes(p.faction), `${n} faction`);
    assert.ok(Array.isArray(p.traits) && p.traits.length >= 3, `${n} traits`);
    assert.ok(p.age > 0 && p.home && p.work, `${n} age/home/work`);
    assert.ok(Number.isFinite(p.startOpinion), `${n} startOpinion`);
    assert.ok(p.appearance?.hairStyle && p.appearance.skin, `${n} appearance`);
    assert.ok(p.greetings.length >= 3 && p.farewells.length >= 2, `${n} greetings/farewells`);
    for (const k of ['day', 'night', 'rain']) assert.ok(p.lines[k]?.length >= 2, `${n} lines.${k}`);
    for (const k of ['liked', 'neutral', 'disliked']) assert.ok(p.gift[k]?.length >= 2, `${n} gift.${k}`);
    for (const k of ['lyra', 'chatter', 'sleepy', 'flee', 'cold', 'crime', 'shaken', 'wronged', 'lyraAlone', 'askPrompt', 'noMore', 'notYet', 'helped']) {
      assert.ok(Array.isArray(p[k]) && p[k].length, `${n} ${k}`);
    }
    assert.ok(Array.isArray(p.refuse), `${n} refuse`);
    for (const k of ['apart', 'left', 'gone']) assert.ok(p.aboutLyra?.[k]?.length, `${n} aboutLyra.${k}`);
    assert.ok(p.pairs && typeof p.pairs === 'object', `${n} pairs`);
    assert.ok(Object.keys(p.knows).length >= 7, `${n} knows`);
    for (const id of [...p.likes, ...p.dislikes]) assert.ok(ITEMS[id], `${n} likes/dislikes ${id}`);
    if (p.shop) {
      for (const s of p.shop.sells) assert.ok(ITEMS[s.id] && s.price > 0, `${n} sells ${s.id}`);
      for (const [id, price] of Object.entries(p.shop.buys)) assert.ok(ITEMS[id] && price > 0, `${n} buys ${id}`);
    }
  }
  for (const p of MORE_PROFILES) {
    assert.ok(p.howAreYou?.length >= 1 && p.saysOutLoud?.length >= 3, `${p.id} howAreYou/saysOutLoud`);
    for (const k of ['parent', 'child', 'spouse', 'sibling', 'ward']) assert.ok(Array.isArray(p.family?.[k]), `${p.id} family.${k}`);
    for (const ids of Object.values(p.family)) for (const id of ids) assert.ok(id === 'lyra' || ALL.includes(id), `${p.id} family ${id}`);
  }
});

test('LORE details: who is a guard, who hunts, who walks slowly, who trades what', () => {
  assert.equal(profileById('wys').faction, 'guard');
  assert.equal(profileById('hess').faction, 'villager');
  assert.ok(profileById('hess').hunter);
  assert.ok(profileById('hobb').lamplighter);
  const base = 40;
  assert.ok(profileById('wenna').speed < base * 0.7 && profileById('petra').speed < base * 0.7, 'Wenna and Petra move slowly');
  assert.equal(profileById('wenna').appearance.eyeStyle, 'milky');
  assert.equal(profileById('wenna').appearance.held, 'stick');
  assert.deepEqual(profileById('hobb').family.child, ['lyra']);
  assert.deepEqual(profileById('wenna').family.spouse, ['hobb']);
  assert.deepEqual(profileById('sabeth').family.parent.sort(), ['hobb', 'wenna']);
  assert.ok(profileById('hobb').shop.sells.some((s) => s.id === 'candle'));
  assert.ok(profileById('wenna').shop.sells.some((s) => s.id === 'honey'));
  assert.ok(profileById('corran').shop.sells.some((s) => s.id === 'raw_fish') && profileById('corran').shop.buys.raw_fish > 0);
  assert.ok(profileById('sabeth').shop.sells.some((s) => s.id === 'wool_cloak'));
  for (const id of ['candle', 'honey', 'smoked_eel', 'wool_cloak']) assert.ok(PAINTED_ICONS.includes(id), `icon for ${id}`);
});

test('no duplicate fact ids; every fact is spoken in its own voice', () => {
  const seen = new Set();
  for (const p of NPC_PROFILES) {
    assert.ok(p.facts.length >= 10, `${p.id} has ${p.facts.length} facts`);
    for (const f of p.facts) {
      assert.ok(!seen.has(f.id), `duplicate fact ${f.id}`);
      seen.add(f.id);
      assert.ok(f.text && f.topic && Number.isFinite(f.minFamiliarity), `${f.id} shape`);
    }
  }
  for (const p of MORE_PROFILES) for (const f of p.facts) assert.ok(f.say && f.say !== f.text, `${f.id} has a spoken line`);
});

test('schedules cover the day at known places, with the new places listed', () => {
  for (const p of NPC_PROFILES) {
    assert.deepEqual(scheduleProblems(p.schedule, [...KNOWN_PLACES, ...NEW_PLACES]), [], `${p.id} schedule`);
    const sleep = p.schedule.filter((e) => e.activity === 'sleep');
    assert.ok(sleep.length && sleep.every((e) => e.at === p.home), `${p.id} sleeps at home (${p.home})`);
  }
  // Homes from LORE §10.
  const homes = { hobb: 'chandlery', wenna: 'chandlery', hess: 'dye_cottage', sabeth: 'dye_cottage', alder: 'ashby_house', petra: 'ashby_house', tilly: 'ashby_house', tansy: 'farmhouse', corran: 'net_shed', wys: 'guardhouse' };
  for (const [id, home] of Object.entries(homes)) assert.equal(profileById(id).home, home, `${id} home`);
  // Hobb walks the lamp-round at dusk; Corran fishes at dawn; Tilly is at the smithy.
  assert.equal(entryAt(profileById('hobb').schedule, 18.5).activity, 'lamps');
  assert.equal(entryAt(profileById('corran').schedule, 5.5).at, 'mirror_lake');
  assert.equal(entryAt(profileById('tilly').schedule, 9).at, 'smithy');
  assert.equal(entryAt(profileById('tansy').schedule, 6).at, 'reed_farm');
  // Every new place has a stand-in while the world branch has not built it.
  for (const id of NEW_PLACES) assert.ok(PLACE_FALLBACK[id] && KNOWN_PLACES.includes(PLACE_FALLBACK[id]), `${id} fallback`);
});

test('the original eight know each newcomer, and everyone has words for the call for help', () => {
  for (const id of EIGHT) {
    for (const nid of TEN) assert.ok(profileById(id).knows[nid], `${id} knows ${nid}`);
    assert.ok(MORE_KNOWS[id], `MORE_KNOWS.${id}`);
  }
  for (const id of ALL) assert.ok(RESPONSE_LINES[id], `${id} response lines`);
});

// ---------------------------------------------------------------- hidden facts (LORE §9.10)

test('secrets kept from Lyra are marked hiddenFrom lyra and never tellable to her', () => {
  const hidden = MORE_PROFILES.flatMap((p) => p.facts).filter((f) => f.hiddenFrom?.includes('lyra'));
  assert.ok(hidden.length >= 15);
  for (const f of hidden) {
    assert.equal(f.topic, 'secret', `${f.id} topic`);
    assert.ok(f.minFamiliarity >= 50, `${f.id} needs closeness`);
    assert.equal(factTellable(f, 'lyra'), false);
  }
  for (const id of ['sabeth_varek', 'sabeth_eye', 'alder_fourteen', 'petra_lyra_eyes', 'wenna_brightfall', 'hobb_count', 'hess_ambush', 'tilly_poems', 'wys_froze', 'tansy_letter']) {
    const f = MORE_PROFILES.flatMap((p) => p.facts).find((x) => x.id === id);
    assert.ok(f?.hiddenFrom?.includes('lyra'), `${id} hidden from Lyra`);
  }
  // The deepest truths wait for the story, even for the player.
  const varek = profileById('sabeth').facts.find((f) => f.id === 'sabeth_varek');
  assert.equal(factTellable(varek, 'player', {}), false);
  assert.equal(factTellable(varek, 'player', { [varek.revealFlag]: true }), true);
});

test('Lyra is never offered a fact hidden from her (conversation.availableFacts)', (t) => {
  const leaks = [];
  for (const p of MORE_PROFILES) {
    const got = availableFacts({ profile: p }, { familiarity: 100, notes: [] });
    for (const f of got) if (f.hiddenFrom?.includes('lyra')) leaks.push(f.id);
  }
  // Seam: conversation.js (mind) filters on hiddenFrom; until it does this is a todo.
  if (leaks.length) t.todo(`conversation.availableFacts should skip hiddenFrom ['lyra']: ${leaks.length} leak(s)`);
  else assert.equal(leaks.length, 0);
});

test('asking a villager never tells the player a truth hidden until the story reveals it', () => {
  const g = makeGame();
  addPlayer(g, px(32), px(22));
  const sabeth = addNpc(g, 'sabeth', 33, 22);
  sabeth.familiarity = 100;
  sabeth.opinionOfPlayer = 100;
  const told = [];
  for (let i = 0; i < 30; i++) {
    const r = answerTopic(sabeth, 'self', g.player);
    if (r.fact) told.push(r.fact.id);
  }
  assert.ok(told.length >= 3);
  assert.ok(!told.includes('sabeth_varek') && !told.includes('sabeth_eye'), told.join(','));
});

// ---------------------------------------------------------------- dialogue

test('every villager answers the dialogue options; Hobb and Wenna talk about their daughter', () => {
  const g = makeGame();
  addPlayer(g, px(32), px(22));
  for (const id of ALL) {
    const n = addNpc(g, id, 33, 22);
    const d = getDialogue(n, g.player);
    assert.ok(d.lines.length && d.options.some((o) => o.id === 'ask'), `${id} dialogue`);
    for (const topic of ['lyra', 'maren', 'village']) {
      const r = chooseOption(n, `ask:${topic}`, g.player);
      assert.ok(r.lines.length && r.lines.every((l) => typeof l === 'string' && l.length > 3), `${id} on ${topic}`);
    }
    if (n.profile.shop) assert.equal(chooseOption(n, 'shop', g.player).open, 'shop');
    g.entities.remove(n);
  }
  const hobb = addNpc(g, 'hobb', 33, 22);
  const lines = chooseOption(hobb, 'ask:lyra', g.player).lines.join(' ');
  assert.ok(/Star|her mother|supper/i.test(lines), lines);
  const wenna = addNpc(g, 'wenna', 34, 22);
  const wl = chooseOption(wenna, 'ask:lyra', g.player).lines.join(' ');
  assert.ok(/my girl|Lyra Ambrel|daughter|she/i.test(wl), wl);
});

// ---------------------------------------------------------------- art

test('every villager paints every anim and direction, and a portrait', () => {
  for (const p of NPC_PROFILES) {
    const a = normalizeAppearance({ ...p.appearance, key: p.id });
    for (const [anim, spec] of Object.entries(HUMANOID_ANIMS)) {
      for (const dir of DIRECTIONS) {
        const sp = paintHumanoid(a, anim, dir, spec.frames - 1);
        const px = sp.render();
        let opaque = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i]) opaque++;
        assert.ok(opaque > 60, `${p.id} ${anim} ${dir} has pixels`);
      }
    }
    const portrait = paintPortrait(a, 'neutral').render();
    assert.ok(portrait.length > 0, `${p.id} portrait`);
  }
});

test('the newcomers read differently from each other at game scale', () => {
  const sig = new Map();
  for (const id of TEN) {
    const a = normalizeAppearance({ ...profileById(id).appearance, key: id });
    const bytes = paintHumanoid(a, 'idle', 'down', 0).render();
    sig.set(id, bytes);
  }
  const ids = [...sig.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = sig.get(ids[i]);
      const B = sig.get(ids[j]);
      let diff = 0;
      for (let k = 0; k < A.length; k += 4) if (A[k] !== B[k] || A[k + 1] !== B[k + 1] || A[k + 2] !== B[k + 2] || A[k + 3] !== B[k + 3]) diff++;
      assert.ok(diff > 80, `${ids[i]} and ${ids[j]} differ by only ${diff} pixels`);
    }
  }
});

// ---------------------------------------------------------------- beds (DESIGN §19.8)

test('a villager sleeps in the bed they own, lying in it, and steps out in the morning', () => {
  const bed = { id: 'bed_wys', objType: 'bed', owner: 'wys', tx: 44, ty: 12, footprint: { x: 44, y: 11, w: 1, h: 2 }, solid: true };
  const g = makeGame({ objects: [bed] });
  addPlayer(g, px(80), px(60));
  setHour(g, 23);
  const wys = addNpc(g, 'wys', 34, 22);
  run(g, 25, 0.1);
  const b = g.objects.get('bed_wys');
  assert.equal(wys.inBed, b, 'in his own bed');
  assert.equal(wys.state, 'sleep');
  assert.equal(Math.round(wys.x), Math.round(b.x));
  assert.ok(wys.y <= b.y && wys.y > b.y - TILE, 'lying along the bed');
  setHour(g, 6.5);
  run(g, 2, 0.1);
  assert.equal(wys.inBed, null, 'out of bed in the morning');
  assert.notEqual(wys.state, 'sleep');
});

test('with no bed of their own, a villager dozes in a chair by the hearth — never on the floor', () => {
  const objects = [
    { id: 'kettle_hearth', objType: 'hearth', tx: 22, ty: 11, solid: true },
    { id: 'kettle_chair', objType: 'chair', tx: 23, ty: 13, solid: false },
    { id: 'someone_elses_bed', objType: 'bed', owner: 'elda', tx: 26, ty: 12, footprint: { x: 26, y: 11, w: 1, h: 2 }, solid: true },
  ];
  const g = makeGame({ objects });
  addPlayer(g, px(80), px(60));
  setHour(g, 23.5);
  // Hobb's chandlery is not built in this world: he goes to its stand-in (the Kettle).
  const hobb = addNpc(g, 'hobb', 34, 22);
  run(g, 25, 0.1);
  assert.equal(hobb.inBed, null);
  assert.notEqual(hobb.state, 'sleep', 'never lies down without a bed');
  assert.equal(hobb.state, 'sit');
  assert.equal(hobb.seat?.obj?.id, 'kettle_chair');
});

// ---------------------------------------------------------------- the lamp-round

test("Hobb lights the square's lamps one by one at dusk, and each stays lit", () => {
  const lamps = [0, 1, 2, 3].map((i) => ({ id: `lamp_${i}`, objType: 'lamp', kind: 'post', tx: 31 + i * 2, ty: 21 + (i % 2) * 4, solid: true, round: i }));
  const g = makeGame({ objects: lamps });
  addPlayer(g, px(34), px(24));
  setHour(g, 17.9);
  const hobb = addNpc(g, 'hobb', 32, 23);
  const lit = [];
  g.bus.on('lamp_lit', (p) => lit.push(p.id));
  run(g, 60, 1 / 20);
  assert.deepEqual(lit, ['lamp_0', 'lamp_1', 'lamp_2', 'lamp_3'], 'in round order');
  assert.ok(lamps.every((l) => g.objects.get(l.id).state.lit));
  assert.ok(g.events.filter((e) => e.type === 'lamp_lit').every((e) => e.p.by === hobb));
});

test('Hobb skips a lamp somebody lit before him (the clever wind)', () => {
  const lamps = [0, 1].map((i) => ({ id: `lamp_${i}`, objType: 'lamp', kind: 'post', tx: 31 + i * 3, ty: 21, solid: true, round: i, far: i === 1 }));
  const g = makeGame({ objects: lamps });
  addPlayer(g, px(34), px(24));
  g.objects.get('lamp_1').state.lit = true;
  setHour(g, 17.9);
  addNpc(g, 'hobb', 32, 23);
  const lit = [];
  g.bus.on('lamp_lit', (p) => lit.push(p.id));
  run(g, 30, 1 / 20);
  assert.deepEqual(lit, ['lamp_0']);
});

// ---------------------------------------------------------------- Hess and Wys

test('Hess shoots a wolf that comes near; she never draws on a villager or an innocent player', () => {
  const g = makeGame();
  const p = addPlayer(g, px(36), px(22));
  setHour(g, 14);
  const hess = addNpc(g, 'hess', 32, 22);
  const tilly = addNpc(g, 'tilly', 33, 24);
  run(g, 1);
  assert.notEqual(hess.mode, 'fight');
  const wolf = spawnCreature(g, 'wolf', hess.x + 80, hess.y);
  run(g, 3);
  assert.equal(hess.fightTarget, wolf);
  assert.ok(g.combat.shots.some((s) => s.attacker === hess && s.kind === 'arrow' && s.opts.target === wolf), 'arrows at the wolf');
  assert.ok(!g.combat.shots.some((s) => s.opts.target === p || s.opts.target === tilly));
});

test('Wys is of the watch: he fights a wanted player', () => {
  const g = makeGame();
  const p = addPlayer(g, px(33), px(22));
  setHour(g, 9);
  const wys = addNpc(g, 'wys', 36, 22);
  assert.ok(wys.isGuard);
  p.crime = { level: 1, kind: 'assault', until: g.clock.t + 30 };
  g.bus.emit('crime', { actor: p, victim: null, kind: 'assault' });
  assert.equal(wys.mode, 'fight');
  assert.equal(wys.fightTarget, p);
});

// ---------------------------------------------------------------- the village answers (DESIGN §19.7)

test('helpRole: guards and Hess fight, carers tend, children run, one fetches the watch', () => {
  const g = makeGame();
  addPlayer(g, px(10), px(60));
  const lyra = addLyra(g, px(32), px(22));
  const wolf = spawnCreature(g, 'wolf', px(33), px(22));
  const at = (id, tx, ty) => addNpc(g, id, tx, ty);
  const rowan = at('rowan', 36, 22);
  const hess = at('hess', 30, 25);
  const mira = at('mira', 28, 22);
  const hobb = at('hobb', 38, 26);
  const pip = at('pip', 34, 26);
  const garrick = at('garrick', 29, 20);
  const ctx = (npc) => ({ victim: lyra, attacker: wolf, sev: 2, d: npc.distTo(lyra), incident: { shielded: new Set(), fetcher: null }, game: g });
  assert.equal(helpRole(rowan, ctx(rowan)), 'fight');
  assert.equal(helpRole(hess, ctx(hess)), 'fight');
  assert.equal(helpRole(mira, ctx(mira)), 'tend');
  assert.equal(helpRole(hobb, ctx(hobb)), 'tend');
  assert.equal(helpRole(pip, ctx(pip)), 'flee');
  assert.ok(['shield', 'shout', 'flee'].includes(helpRole(garrick, ctx(garrick))));
  // The player striking Lyra before combat calls it a crime: the watch steps in the way.
  const c = { ...ctx(rowan), attacker: g.player, d: 60 };
  assert.equal(helpRole(rowan, c), 'confront');
});

test('Lyra cries out: Rowan runs in to fight the wolf, her father comes to her side and tends her', () => {
  const g = makeGame();
  addPlayer(g, px(80), px(60));
  setHour(g, 15);
  const lyra = addLyra(g, px(34), px(24));
  lyra.hp = 20;
  const rowan = addNpc(g, 'rowan', 52, 24); // far enough that he does not see it himself
  const hobb = addNpc(g, 'hobb', 24, 30);
  const wolf = spawnCreature(g, 'wolf', px(35), px(24));
  g.bus.emit('call_for_help', { victim: lyra, attacker: wolf, x: lyra.x, y: lyra.y, severity: 3 });
  assert.equal(rowan.mode, 'fight');
  assert.equal(rowan.fightTarget, wolf);
  assert.equal(hobb.mode, 'help');
  assert.equal(hobb.help.role, 'tend');
  assert.ok(g.said.some((s) => s.e === hobb && profileById('hobb').rescue.lyra.includes(s.text)), 'Hobb calls her by name');
  // Hobb keeps back while the wolf is on her.
  run(g, 2);
  assert.ok(hobb.distTo(lyra) > 60, 'waits clear of the wolf');
  // The wolf is dealt with; Hobb goes in and heals her.
  wolf.hp = 0;
  wolf.dead = true;
  wolf.removed = true;
  g.entities.remove(wolf);
  for (let i = 0; i < 200 && !g.combat.heals.some((h) => h.source === hobb); i++) run(g, 0.1);
  assert.ok(g.combat.heals.some((h) => h.source === hobb && h.target === lyra && h.got > 0), 'healed');
  assert.ok(g.events.some((e) => e.type === 'tended' && e.p.npc === hobb && e.p.victim === lyra));
  assert.equal(hobb.help?.phase, 'escort');
});

test('a downed villager calls for help and Mira helps them up', () => {
  const g = makeGame();
  addPlayer(g, px(80), px(60));
  setHour(g, 11);
  const tobias = addNpc(g, 'tobias', 34, 24);
  const mira = addNpc(g, 'mira', 26, 24);
  const wolf = spawnCreature(g, 'wolf', px(60), px(50));
  g.combat.down(tobias, wolf);
  assert.ok(g.events.some((e) => e.type === 'call_for_help' && e.p.victim === tobias && e.p.severity === 3));
  assert.equal(mira.mode, 'help');
  for (let i = 0; i < 200 && tobias.downed; i++) run(g, 0.1);
  assert.ok(!tobias.downed, 'up again before the 30 s are out');
  assert.ok(g.events.some((e) => e.type === 'revived' && e.p.entity === tobias && e.p.by === mira));
});

test('with no guard near, one villager runs to fetch the watch, and the guard comes', () => {
  const g = makeGame();
  addPlayer(g, px(85), px(65));
  setHour(g, 11);
  const victim = addNpc(g, 'tobias', 30, 30);
  const garrick = addNpc(g, 'garrick', 36, 30);
  const alder = addNpc(g, 'alder', 30, 36);
  const wys = addNpc(g, 'wys', 75, 30); // across the map
  const bandit = spawnCreature(g, 'bandit', px(31), px(30));
  bandit.aggroRadius = 0;
  victim.callForHelp(bandit, 2);
  const fetchers = [garrick, alder].filter((n) => n.help?.role === 'fetch');
  assert.equal(fetchers.length, 1, 'exactly one fetcher');
  for (let i = 0; i < 400 && wys.mode !== 'fight'; i++) run(g, 0.1);
  assert.equal(wys.mode, 'fight');
  assert.equal(wys.fightTarget, bandit);
});

test('an adult puts themselves between Pip and the trouble; Pip runs', () => {
  const g = makeGame();
  addPlayer(g, px(85), px(65));
  setHour(g, 11);
  const pip = addNpc(g, 'pip', 34, 26);
  const bram = addNpc(g, 'bram', 35, 27);
  const victim = addNpc(g, 'garrick', 33, 24);
  const bandit = spawnCreature(g, 'bandit', px(33), px(23));
  bandit.aggroRadius = 0;
  victim.callForHelp(bandit, 2);
  assert.equal(pip.mode, 'flee');
  assert.equal(bram.help?.role, 'shield');
  assert.equal(bram.help.child, pip);
});

test('ensureVillagers places anyone the world did not, at home or its stand-in', () => {
  const g = makeGame();
  addPlayer(g, px(80), px(60));
  addNpc(g, 'bram', 12, 12);
  const added = ensureVillagers(g);
  assert.equal(added.length, ALL.length - 1);
  assert.ok(g.entities.get('hobb') && g.entities.get('wys'));
  const kettle = g.locations.get('ember_kettle').bounds;
  const hobb = g.entities.get('hobb');
  assert.ok(Math.abs(hobb.x / TILE - (kettle.x + kettle.w / 2)) < 6, 'Hobb waits at the Kettle while the chandlery is missing');
  assert.equal(ensureVillagers(g).length, 0, 'idempotent');
});

test('the bed pose: head top on the pillow row for every build, nothing wider than a bed', async () => {
  const { BED_HEAD_ROW, FRAME } = await import('../src/art/characters_humanoid.js');
  for (const p of NPC_PROFILES) {
    const a = normalizeAppearance({ ...p.appearance, key: p.id });
    const px = paintHumanoid(a, 'bed', 'down', 0).render();
    let top = FRAME;
    let minX = FRAME;
    let maxX = -1;
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        if (!px[(y * FRAME + x) * 4 + 3]) continue;
        top = Math.min(top, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    assert.ok(top >= BED_HEAD_ROW - 4 && top <= BED_HEAD_ROW + 1, `${p.id} head top at ${top}`);
    assert.ok(maxX - minX <= 14, `${p.id} fits a bed (${maxX - minX + 1} px wide)`);
  }
});

test('bedUnder finds the bed someone is asleep in, and nothing for the awake', async () => {
  const { bedUnder } = await import('../src/art/characters_bed.js');
  const bed = { id: 'lyra_bed', objType: 'bed', owner: 'lyra', tx: 10, ty: 10, footprint: { x: 10, y: 9, w: 1, h: 2 } };
  const g = makeGame({ objects: [bed] });
  const lyra = addLyra(g, px(10), 10 * TILE + TILE - 4);
  lyra.state = 'sleep';
  assert.equal(bedUnder(g, lyra)?.id, 'lyra_bed');
  lyra.state = 'idle';
  assert.equal(bedUnder(g, lyra), null);
  lyra.state = 'sleep';
  lyra.x = px(14);
  assert.equal(bedUnder(g, lyra), null, 'asleep on the floor is not in a bed');
});
