// Story and cutscenes (DESIGN §20): scripts are valid data with stable keys, nothing the
// lore keeps hidden is ever said or written in the book, and scenes fire once and stay seen
// across a save.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SCRIPTS, spokenLines, validateStep, isSpoken, readingMs, speakerName } from '../src/story/scripts.js';
import { SFX_NAMES, BED_NAMES } from '../src/story/sfx.js';
import { BOSS_SCRIPTS } from '../src/story/scripts_bosses.js';
import { MISSION_SCRIPTS } from '../src/story/scripts_missions.js';
import { PANELS } from '../src/story/panels.js';
import { CHAPTERS, PAGES, QUESTIONS, PROLOGUE_UNLOCKS, unlocksForEvent } from '../src/story/codex_data.js';
import { SCENES, sceneContext, lyraState } from '../src/story/triggers.js';
import { StoryDirector } from '../src/story/director.js';
import { chapterPages } from '../src/ui/codex.js';
import { STORY } from '../src/lore/story.js';
import { EventBus } from '../src/core/events.js';

// Truths LORE §9 marks hidden (and character secrets nobody tells the player in these
// scenes). None may appear in a script line or a page of the book.
const HIDDEN = [
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

function hiddenIn(text) {
  return HIDDEN.find((re) => re.test(String(text || ''))) || null;
}

test('every script step is a valid step, every panel exists', () => {
  for (const [id, script] of Object.entries(SCRIPTS)) {
    assert.ok(Array.isArray(script.steps) && script.steps.length > 0, `${id} has steps`);
    assert.ok(script.title, `${id} has a title`);
    script.steps.forEach((st, i) => {
      const err = validateStep(st, PANELS, { sfx: SFX_NAMES, beds: BED_NAMES });
      assert.equal(err, null, `${id}[${i}] ${err}: ${JSON.stringify(st)}`);
    });
    // world sections are balanced
    const begins = script.steps.filter((s) => s.world === 'begin').length;
    const ends = script.steps.filter((s) => s.world === 'end').length;
    assert.equal(begins, ends, `${id}: world begin/end balance`);
  }
});

test('every spoken step has a stable, unique key and real text', () => {
  const keys = new Set();
  for (const [id, script] of Object.entries(SCRIPTS)) {
    let n = 0;
    for (const st of script.steps) {
      if (!isSpoken(st)) continue;
      const text = st.narrate ?? st.text;
      assert.ok(typeof text === 'string' && text.trim().length > 1, `${id}: text`);
      assert.match(st.key, new RegExp(`^${id}\\.\\d{2}$`), `${id}: key shape ${st.key}`);
      assert.equal(st.key, `${id}.${String(n).padStart(2, '0')}`, 'keys count spoken lines only');
      assert.ok(!keys.has(st.key), `duplicate key ${st.key}`);
      keys.add(st.key);
      n++;
    }
  }
  const lines = spokenLines();
  assert.equal(lines.length, keys.size);
  for (const l of lines) {
    assert.ok(l.key && l.text && l.speaker, 'line has key, text, speaker');
    assert.ok(['narrator', 'lyra', 'hess', 'hobb', 'wenna', 'maren', 'aveline'].includes(l.speaker), `known speaker ${l.speaker}`);
  }
});

test('the prologue covers the story in order and ends in play with Lyra', () => {
  const p = SCRIPTS.prologue.steps;
  const panels = p.filter((s) => s.panel && !s.world).map((s) => s.panel);
  assert.deepEqual(panels, ['halcyre', 'the_drift', 'warded_villages', 'hearthvale_dusk', 'brightfall', 'maren_ruins', 'the_climb', 'crown_ring', 'carry_down', 'long_sleep']);
  const world = p.findIndex((s) => s.world === 'begin');
  assert.ok(world > 0, 'it ends in the world');
  const after = p.slice(world).filter(isSpoken);
  assert.ok(after.length >= 4 && after.every((s) => s.say === 'lyra'), 'Lyra speaks the first lines in play');
  const all = after.map((s) => s.text).join(' ');
  assert.match(all, /Lyra Ambrel/);
  assert.match(all, /Wayhouse/);
  assert.match(all, /carried you down a mountain/);
  assert.match(all, /hearthwatch/);
  // never a threat to leave (DESIGN §19: she never hints that she might leave)
  assert.doesNotMatch(all, /\b(leave you|walk away|give (it|you) up)\b/i);
  // a 2-3 minute prologue at reading speed
  const ms = p.filter(isSpoken).reduce((t, s) => t + readingMs(s.narrate ?? s.text, s.narrate != null), 0);
  assert.ok(ms > 100000 && ms < 200000, `prologue reads in ${Math.round(ms / 1000)} s`);
});

test('no hidden truth in any script line', () => {
  for (const l of spokenLines()) {
    const hit = hiddenIn(l.text);
    assert.equal(hit, null, `${l.key} says something hidden (${hit}): ${l.text}`);
  }
});

test('no hidden truth in any page of the book, even with every page unlocked', () => {
  const everything = new Set([
    ...PAGES.map((p) => p.id),
    ...QUESTIONS.map((q) => q.id),
    ...(STORY.world || []).map((e) => e.id),
    ...(STORY.places || []).map((e) => e.id),
    ...(STORY.people || []).map((e) => e.id),
    ...(STORY.lyraLife || []).map((e) => e.id),
    'little_lamp_words',
    'far_lamps',
  ]);
  const seen = SCENES.map((s) => s.id);
  const truths = (STORY.mysteries || []).map((m) => String(m.truth || '')).filter((t) => t.length > 30);
  for (const ch of CHAPTERS) {
    for (const page of chapterPages(ch.id, everything, { seen, objective: '' })) {
      if (page.locked) continue;
      const text = `${page.title} ${page.text}`;
      const hit = hiddenIn(text);
      assert.equal(hit, null, `${ch.id}/${page.id} reveals ${hit}: ${text}`);
      for (const tr of truths) assert.ok(!text.includes(tr.slice(0, 40)), `${page.id} quotes a mystery's truth`);
    }
  }
});

test('locked pages never show their text', () => {
  const only = new Set(PROLOGUE_UNLOCKS);
  for (const ch of CHAPTERS) {
    for (const page of chapterPages(ch.id, only, {})) {
      if (page.locked) assert.equal(page.text, undefined);
      else if (page.kind === 'page') assert.ok(only.has(page.id), `${page.id} shown without being unlocked`);
    }
  }
  // the prologue opens something in the main chapters
  for (const id of ['world', 'magic', 'hearthvale', 'lyra', 'stranger', 'story']) {
    assert.ok(chapterPages(id, only, {}).some((p) => !p.locked), `${id} has pages after the prologue`);
  }
});

test('places, meetings and scenes open pages', () => {
  const g = { player: { id: 'player' } };
  assert.ok(unlocksForEvent('enter_location', { actor: g.player, location: { id: 'smithy' } }, g).includes('forgesong'));
  assert.equal(unlocksForEvent('enter_location', { actor: { id: 'lyra' }, location: 'smithy' }, g), null);
  assert.ok(unlocksForEvent('npc_met', { id: 'hess' }, g).includes('q_owlsend'));
  assert.ok(unlocksForEvent('story_scene', { id: 'night_of_lamps' }, g).includes('night_of_lamps'));
  assert.deepEqual(unlocksForEvent('memory_added', { memory: { tags: ['secret'], text: "they said 'little lamp' in their sleep" } }, g), ['little_lamp_words']);
  assert.equal(unlocksForEvent('damage', {}, g), null);
});

// ------------------------------------------------------------------ scene triggers

function fakeGame({ trust = 80, bond = 4, hour = 20, place = 'town_square', near = {}, flags = {} } = {}) {
  const bus = new EventBus();
  const remembered = [];
  const player = { id: 'player', x: 100, y: 100, hp: 60, maxHp: 60 };
  const ents = new Map();
  const companion = {
    id: 'lyra',
    x: 120,
    y: 100,
    mind: {
      companionship: 'together',
      autonomy: { stats: () => ({ trust, fear: 0 }), tone: () => 'warm' },
      relationships: { bond: () => ({ level: bond }) },
      activity: () => ({ combat: false }),
      perception: { threats: 0 },
      mood: () => ({ valence: 0.4 }),
      soul: { secrets: [{ text: 'At nineteen she went into the Weeping Cut... Bryn.' }] },
      secretsRevealed: [],
      revealSecret(i) {
        this.secretsRevealed.push(i);
        remembered.push({ text: 'secret', i });
      },
      remember(text, opts) {
        remembered.push({ text, opts });
      },
      say() {},
    },
  };
  for (const [id, d] of Object.entries(near)) ents.set(id, { id, x: player.x + d, y: player.y });
  const bounds = { town_square: { x: 0, y: 0, w: 20, h: 20 }, chapel: { x: 0, y: 0, w: 20, h: 20 }, stonecut_quarry: { x: 0, y: 0, w: 20, h: 20 } };
  const game = {
    bus,
    state: 'playing',
    paused: false,
    flags: { ...flags },
    clock: { day: 3, hour },
    player,
    companion,
    entities: { get: (id) => (id === 'lyra' ? companion : ents.get(id) || null) },
    objects: { get: () => null },
    locations: { get: (id) => (id === place ? { id, bounds: bounds[id] || { x: 0, y: 0, w: 20, h: 20 } } : null) },
    ui: { isModalOpen: () => false, chat: { isOpen: () => false } },
    remembered,
  };
  return game;
}

function director(game) {
  const d = new StoryDirector(game);
  d.autoScenes = true;
  d.played = [];
  // No browser here: playing a scene is recorded instead of shown.
  d.player.play = async (script) => {
    d.played.push(script.id);
    return { skipped: false };
  };
  return d;
}

async function tick(d, seconds = 3) {
  for (let t = 0; t < seconds; t += 0.25) {
    d.update(0.25);
    await new Promise((r) => setImmediate(r));
  }
}

test('a scene fires once, is remembered by Lyra, and stays seen across a save', async () => {
  const g = fakeGame({ trust: 80, hour: 20, place: 'town_square' });
  const d = director(g);
  await tick(d);
  assert.deepEqual(d.played, ['night_of_lamps']);
  assert.ok(d.seen('night_of_lamps'));
  assert.ok(g.remembered.some((m) => /night of the lamps/i.test(m.text)), 'Lyra remembers telling it');
  assert.ok(d.isUnlocked('lyra_workings'), 'the book gains the page');
  await tick(d);
  assert.deepEqual(d.played, ['night_of_lamps'], 'never twice');
  // Save and load: flags are serialized as JSON with the game.
  const saved = JSON.parse(JSON.stringify(g.flags));
  const g2 = fakeGame({ trust: 80, hour: 20, place: 'town_square', flags: saved });
  const d2 = director(g2);
  await tick(d2);
  assert.deepEqual(d2.played, [], 'a loaded game does not replay it');
  assert.ok(d2.seen('night_of_lamps'));
});

test("she does not tell her stories to someone she doesn't trust, or when it is not the moment", async () => {
  const low = director(fakeGame({ trust: 20, hour: 20 }));
  await tick(low);
  assert.deepEqual(low.played, []);
  const noon = director(fakeGame({ trust: 90, hour: 12 }));
  await tick(noon);
  assert.deepEqual(noon.played, []);
  const g = fakeGame({ trust: 90, hour: 20 });
  g.companion.mind.companionship = 'wary';
  const wary = director(g);
  await tick(wary);
  assert.deepEqual(wary.played, []);
  assert.equal(lyraState(g).ok, false);
  const scared = fakeGame({ trust: 90, hour: 20 });
  scared.companion.mind.autonomy.tone = () => 'afraid';
  const sd = director(scared);
  await tick(sd);
  assert.deepEqual(sd.played, []);
});

test('the Weeping Cut needs high trust at the quarry, tells her secret once, and she may decline', async () => {
  const g = fakeGame({ trust: 90, bond: 4, hour: 11, place: 'stonecut_quarry' });
  const d = director(g);
  const orig = Math.random;
  Math.random = () => 0.1; // she says no the first time today
  try {
    await tick(d);
  } finally {
    Math.random = orig;
  }
  assert.deepEqual(d.played, []);
  assert.equal(d.data.declined.weeping_cut, 3);
  await tick(d);
  assert.deepEqual(d.played, [], 'not again the same day');
  g.clock.day = 4;
  Math.random = () => 0.9;
  try {
    await tick(d);
  } finally {
    Math.random = orig;
  }
  assert.deepEqual(d.played, ['weeping_cut']);
  assert.deepEqual(g.companion.mind.secretsRevealed, [0], 'the secret she told is marked told');
  const low = director(fakeGame({ trust: 50, bond: 2, hour: 11, place: 'stonecut_quarry' }));
  await tick(low);
  assert.deepEqual(low.played, []);
});

test('meeting Hobb and Wenna waits for both of them; scenes stop under automation', async () => {
  const none = director(fakeGame({ hour: 12, place: 'nowhere' }));
  await tick(none);
  assert.deepEqual(none.played, []);
  const g = fakeGame({ hour: 12, place: 'nowhere', near: { wenna: 30, hobb: 60 } });
  const d = director(g);
  await tick(d);
  assert.deepEqual(d.played, ['meet_ambrels']);
  const auto = director(fakeGame({ hour: 12, place: 'nowhere', near: { wenna: 30, hobb: 60 } }));
  auto.autoScenes = false;
  await tick(auto);
  assert.deepEqual(auto.played, []);
});

test('scene contexts and speakers', () => {
  const g = fakeGame({ place: 'chapel', near: { aveline: 40 } });
  const c = sceneContext(g);
  assert.ok(c.inPlace('chapel'));
  assert.ok(!c.inPlace('smithy'));
  assert.ok(c.near('aveline', 50));
  assert.ok(!c.near('aveline', 20));
  assert.equal(speakerName('narrator', g), '');
  assert.equal(speakerName('lyra', { settings: { companionName: 'Lyra' } }), 'Lyra');
  assert.equal(speakerName('aveline', g), 'Sister Aveline');
});

test('scene sound: every cue names a word of its line and a sound that exists; the prologue has its silence and its slam', () => {
  const all = { ...SCRIPTS, ...MISSION_SCRIPTS, ...BOSS_SCRIPTS };
  for (const [id, script] of Object.entries(all)) {
    script.steps.forEach((st, i) => assert.equal(validateStep(st, PANELS, { sfx: SFX_NAMES, beds: BED_NAMES }), null, `${id}[${i}]`));
  }
  // A cue on a word that is not in the line, or an unknown sound, is caught.
  assert.match(validateStep({ narrate: 'It was you.', key: 'x.0', cues: [{ word: 'them', sfx: 'flash' }] }, null, { sfx: SFX_NAMES, beds: BED_NAMES }), /not in the line/);
  assert.match(validateStep({ sfx: 'kazoo' }, null, { sfx: SFX_NAMES, beds: BED_NAMES }), /unknown sound/);
  const steps = SCRIPTS.prologue.steps;
  const hush = steps.findIndex((s) => s.hush != null);
  const slam = steps.findIndex((s) => s.slam);
  const you = steps.findIndex((s) => s.narrate === 'It was you.');
  assert.ok(hush > 0 && hush < slam && slam < you, 'near silence, then the slam, then "It was you."');
  // Every scene has a bed under it (no dead air), the prologue changes it as it goes.
  for (const [id, script] of Object.entries(all)) assert.ok(script.steps.some((s) => s.bed != null), `${id} has a bed`);
  assert.ok(steps.filter((s) => s.bed != null).length >= 6);
  // Fear has a heartbeat somewhere.
  assert.ok(Object.values(all).some((s) => s.steps.some((st) => st.heart > 0 || st.cues?.some((c) => c.heart > 0))));
});
