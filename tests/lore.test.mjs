import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STORY } from '../src/lore/story.js';
import { Lorebook, defaultLorebook, LORE_KINDS } from '../src/lore/lorebook.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { LOCATION_INFO } from '../src/world/world_content.js';
import { Mind } from '../src/ai/mind/mind.js';
import { EventBus } from '../src/core/events.js';
import { GameClock } from '../src/core/time.js';

const VILLAGERS = ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'hobb', 'wenna', 'hess', 'sabeth', 'alder', 'petra', 'tilly', 'tansy', 'corran', 'wys'];
// Round three's homes (DESIGN §19.1, §19.2) are built by the world agent; the story may
// already name them.
const ROUND3_PLACES = ['chandlery', 'lamplight_lane', 'ashby_house', 'dye_cottage', 'weavers_row', 'net_shed', 'wenna_hives'];
const LOCATION_IDS = new Set([...Object.keys(LOCATION_INFO), ...ROUND3_PLACES]);

// ------------------------------------------------------------------ the story's shape (DESIGN §17.1)

test('STORY has exactly the §17.1 shape, and it is the real story now', () => {
  assert.equal(STORY.placeholder, false);
  assert.equal(typeof STORY.title, 'string');
  assert.ok(STORY.premise.length > 40);
  const shapes = {
    world: ['id', 'title', 'text', 'tags', 'aliases', 'knownBy', 'secret'],
    timeline: ['id', 'when', 'title', 'text', 'tags'],
    places: ['id', 'locationId', 'title', 'text', 'tags', 'knownBy'],
    people: ['id', 'npcId', 'name', 'title', 'text', 'tags', 'knownBy'],
    lyraLife: ['id', 'age', 'title', 'text', 'people', 'places', 'feeling', 'importance'],
    mysteries: ['id', 'question', 'clues', 'truth', 'knownBy'],
  };
  for (const [field, keys] of Object.entries(shapes)) {
    assert.ok(Array.isArray(STORY[field]) && STORY[field].length, `${field} is a non-empty array`);
    for (const e of STORY[field]) {
      for (const k of keys) assert.ok(k in e, `${field}.${e.id} has ${k}`);
      for (const k of Object.keys(e)) assert.ok(keys.includes(k), `${field}.${e.id} has no extra key ${k}`);
    }
  }
  const ids = new Set();
  for (const field of Object.keys(shapes)) for (const e of STORY[field]) {
    assert.ok(!ids.has(`${field}:${e.id}`), `unique id ${field}:${e.id}`);
    ids.add(`${field}:${e.id}`);
  }
});

test("Lyra's life runs from her birth in Hearthvale to today, in order, as LORE §7 tells it", () => {
  const life = STORY.lyraLife;
  assert.ok(life.length >= 12 && life.length <= 24, `${life.length} chapters`);
  assert.equal(life[0].age, 0, 'it begins with her birth');
  for (let i = 1; i < life.length; i++) assert.ok(life[i].age >= life[i - 1].age, 'chapters are in order');
  assert.equal(life[life.length - 1].age, 24, 'it ends today, at 24');
  const text = life.map((e) => `${e.title}. ${e.text}`).join(' ');
  for (const word of ['Hearthvale', 'Lamplight Lane', 'Hobb', 'Wenna', 'Sabeth', 'Maren', 'violet', 'Bryn', 'Davin', 'Weeping Cut', 'Hollowcrown', 'little lamp', 'wolves']) assert.ok(text.includes(word), `her life mentions ${word}`);
  for (const word of ['Kettlewake', 'Tidewell', 'Odile', 'Orrin', 'Glasswater']) assert.ok(!text.includes(word), `her life no longer mentions ${word}`);
  assert.ok(!/\bCal\b/.test(text));
  const cut = life.find((e) => e.id === 'went_into_the_cut');
  assert.equal(cut.age, 19);
  assert.equal(cut.importance, 10);
  assert.equal(life.find((e) => e.id === 'lamps_relit').age, 11, 'the night of the lamps, at eleven');
  for (const e of life) {
    assert.ok(e.importance >= 1 && e.importance <= 10);
    assert.ok(e.text.length > 40 && e.text.length < 600);
  }
});

test('the world, places and people fit the village, the eighteen and the Maren arc', () => {
  for (const p of STORY.places) assert.ok(LOCATION_IDS.has(p.locationId), `place ${p.id} -> ${p.locationId} exists`);
  const npcIds = new Set([...NPC_PROFILES.map((p) => p.id), ...VILLAGERS]);
  for (const p of STORY.people) if (p.npcId) assert.ok(npcIds.has(p.npcId), `person ${p.id} is a villager`);
  for (const v of VILLAGERS) assert.ok(STORY.people.some((p) => p.npcId === v), `${v} has a lore entry`);
  for (const id of ['maren', 'bryn', 'davin', 'varek', 'hanna', 'tam', 'june', 'jory', 'ewan']) assert.ok(STORY.people.some((p) => p.id === id), `${id} has a lore entry`);
  for (const id of ['cal', 'orrin', 'odile']) assert.ok(!STORY.people.some((p) => p.id === id), `${id} is retired`);
  for (const e of [...STORY.world, ...STORY.places, ...STORY.people]) {
    for (const k of e.knownBy) assert.ok(k === 'lyra' || k === 'everyone' || npcIds.has(k), `${e.id} knownBy ${k}`);
  }
  assert.ok(STORY.people.some((p) => p.id === 'maren' && p.knownBy.includes('everyone')), 'everyone knows Maren');
  const isles = STORY.world.find((e) => e.id === 'glasswater_isles');
  assert.ok(/Maren/.test(isles.text) && isles.knownBy.includes('everyone'), "the Glasswater Isles are Maren's home");
  for (const id of ['halcyre', 'the_drift', 'glimmer', 'the_grey', 'hollow_wind', 'brightfall', 'wardstones', 'kept_flame', 'bell_reach', 'lumencraft', 'hearthcraft', 'greenwit', 'forgesong', 'gravelight', 'dungeons', 'weeping_cut', 'brightwater', 'saltmere', 'cinderwick', 'owlsend', 'brindlecombe']) {
    assert.ok(STORY.world.some((e) => e.id === id), `the world has ${id}`);
  }
  assert.ok(STORY.mysteries.length >= 8);
  for (const m of STORY.mysteries) {
    assert.ok(m.truth.length > 20);
    assert.ok(Array.isArray(m.knownBy) && !m.knownBy.includes('lyra') && !m.knownBy.includes('everyone'), `${m.id}: a hidden truth says who holds it, and it is never Lyra`);
    for (const c of m.clues) assert.ok(c.text && c.foundAt, 'every clue says where it is found');
  }
});

// ------------------------------------------------------------------ the lorebook

test('Lorebook: get, all, search and knownBy', () => {
  const book = defaultLorebook();
  assert.equal(book, defaultLorebook(), 'built once');
  assert.equal(book.placeholder, false);
  assert.deepEqual(LORE_KINDS, ['world', 'timeline', 'place', 'person', 'life', 'mystery']);
  const total = Object.values(STORY).filter(Array.isArray).reduce((n, a) => n + a.length, 0);
  assert.equal(book.all().length, total);
  assert.equal(book.size, total);

  const w = book.get('waygates');
  assert.equal(w.kind, 'world');
  assert.equal(book.get('world:waygates'), w);
  assert.equal(book.get('nope'), null);
  assert.equal(book.get('bram').kind, 'person');
  assert.equal(book.get('bram').role, 'the blacksmith');

  assert.equal(book.search('the blacksmith')[0].id, 'bram', 'a role finds the person');
  assert.equal(book.search('waygate')[0].id, 'waygates', 'an alias finds the entry');
  assert.equal(book.search('Varek One-Eye', { kinds: ['world'] })[0].id, 'varek_band');
  assert.ok(book.search('Mirror Lake hum').some((e) => e.id === 'p_mirror_lake'));
  assert.ok(book.search('the Wellstone').some((e) => e.id === 'wardstones'));
  assert.deepEqual(book.search(''), []);
  assert.deepEqual(book.search('zzz qqq xyzzy'), []);
  assert.ok(book.search('Maren', { limit: 2 }).length <= 2);

  // What Lyra knows: her own life and what the story says; never a mystery.
  const lyra = book.knownBy('lyra');
  assert.ok(lyra.some((e) => e.id === 'waygates'));
  assert.ok(lyra.some((e) => e.kind === 'life' && e.id === 'went_into_the_cut'));
  assert.ok(lyra.some((e) => e.id === 'little_lamp_words'));
  assert.ok(!lyra.some((e) => e.kind === 'mystery'));
  const bram = book.knownBy('bram');
  assert.ok(bram.some((e) => e.id === 'varek_band'));
  assert.ok(bram.some((e) => e.id === 'hearth_faith'), "'everyone' includes Bram");
  assert.ok(!bram.some((e) => e.kind === 'life'), "Bram does not know Lyra's childhood as she tells it");
  assert.ok(!bram.some((e) => e.id === 'little_lamp_words'), "only Lyra heard 'little lamp'");
  assert.ok(book.search('waygate', { knownBy: 'bram' }).every((e) => book.isKnownBy(e, 'bram')));
});

test('mystery truths never leak through search, listing or JSON', () => {
  const book = defaultLorebook();
  for (const id of ['where_is_maren', 'who_is_the_stranger', 'is_lyra_brightborn', 'the_greywinter_count', 'who_is_varek']) {
    const m = book.get(id);
    assert.ok(m.truth.length > 20, 'the truth is kept on the entry');
    assert.ok(!Object.keys(m).includes('truth'), 'but not enumerable');
    assert.ok(!JSON.stringify(book.all()).includes(m.truth));
    for (const word of ['verse', 'Song', 'chisel', 'fourteen', 'Sabeth']) {
      for (const hit of book.search(word, { mysteries: true })) assert.ok(!JSON.stringify(hit).includes(m.truth));
    }
  }
  // The hidden truths themselves (Keepers, Maren singing, Varek's name) appear in no entry anyone can know.
  const known = JSON.stringify(book.all().filter((e) => e.kind !== 'mystery'));
  for (const secret of ['Keeper', 'Varek Coll', 'Sabeth\'s brother', 'read the number', 'Wenna walked out', 'Ewan Vale did not die']) assert.ok(!known.includes(secret), `"${secret}" is in no knowable entry`);
  assert.ok(!book.search('waygate alive').some((e) => e.kind === 'mystery'), 'mysteries only when asked for');
  assert.ok(book.search('waygate alive', { mysteries: true }).some((e) => e.kind === 'mystery'));
  assert.ok(book.cluesAt('maren_journal').length >= 2);
  assert.ok(book.cluesAt('moonpetal_glade').length >= 1);
});

// ------------------------------------------------------------------ the real story drops in

const AUTHOR_STORY = {
  placeholder: false,
  title: 'A different telling',
  premise: 'The same valley, written by its author.',
  world: [{ id: 'saltwind', title: 'The Saltwind', text: 'A warm wind off the sea that smells of oranges.', tags: ['weather'], aliases: ['the wind'], knownBy: ['lyra'], secret: false }],
  timeline: [{ id: 'flood', when: 'Ten years ago', title: 'The flood', text: 'The river rose over the mill.', tags: ['history'] }],
  places: [{ id: 'p_well', locationId: 'town_square', title: 'The old well', text: 'Wishes go down it; frogs come up.', tags: ['well'], knownBy: ['everyone'] }],
  people: [{ id: 'nan', npcId: null, name: 'Nan Merrow', title: "Lyra's grandmother", text: 'Taught Lyra to whistle through grass.', tags: ['family'], knownBy: ['lyra'] }],
  lyraLife: [
    { id: 'first', age: 0, title: 'A quiet birth', text: 'I was born on a still night, and my grandmother sang the tide in.', people: ['nan'], places: [], feeling: 'joy', importance: 5 },
    { id: 'orchard', age: 9, title: 'The orange orchard', text: 'I spent a whole summer in the orange orchard learning every tree by name.', people: [], places: [], feeling: 'joy', importance: 6 },
  ],
  mysteries: [{ id: 'who_sings', question: 'Who sings at the well?', clues: [{ text: 'A voice under the water.', foundAt: 'town_square' }], truth: 'Nobody: it is the wind in the shaft.' }],
};

test("an author's story replaces the placeholder with no code changes: her past and her knowledge follow it", () => {
  const book = new Lorebook(AUTHOR_STORY);
  assert.equal(book.placeholder, false);
  const bus = new EventBus();
  const game = { bus, time: 1, state: 'title', settings: {}, flags: {}, entities: { all: () => [], get: () => null } };
  game.clock = new GameClock(game);
  const mind = new Mind(game, { id: 'lyra', name: 'Lyra', x: 0, y: 0 }, { lorebook: book });
  assert.deepEqual(mind.life.map((e) => e.id), ['first', 'orchard']);
  assert.ok(mind.knowsLore('saltwind'), 'lore she knows comes from the new story');
  assert.ok(mind.knowsLore('nan'));
  assert.ok(!mind.knowsLore('waygates'), 'and none from the placeholder');
  const hits = mind.recall('orange orchard', { stores: ['life'] });
  assert.equal(hits[0].id, 'orchard');
  assert.ok(mind.loreLookup('the Saltwind').entries.some((e) => e.loreId === 'saltwind'));
  assert.ok(!mind.loreLookup('well').text.includes('wind in the shaft'), 'truths stay hidden');
});
