// The built game tells docs/LORE.md's story (DESIGN §19): the retired placeholder Lyra is
// gone from the code, the story is real, nobody is told a hidden truth, and the offline
// mind answers questions about her life the way LORE §7 tells it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { DAY_SECONDS } from '../src/core/constants.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Inventory } from '../src/entities/items.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { generateWorld } from '../src/world/worldgen.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { Brain } from '../src/ai/brain/brain.js';
import { buildRules } from '../src/ai/brain/prompt.js';
import { FALLBACK_SOUL } from '../src/ai/brain/soul_fallback.js';
import { Mind } from '../src/ai/mind/mind.js';
import { DEFAULT_SOUL, LYRA_PEOPLE, PLAYER_REL_START } from '../src/ai/mind/soul.js';
import { availableFacts, factHiddenFrom } from '../src/ai/mind/conversation.js';
import { MAREN_JOURNAL, MAREN_TESTIMONY, marenAnswer } from '../src/ai/mind/maren.js';
import { firstPerson, toListener } from '../src/ai/mind/voice.js';
import { T } from '../src/ai/mind/autonomy_data.js';
import { STORY, BOOK_CHAPTERS, STORY_VILLAGERS } from '../src/lore/story.js';
import { Lorebook } from '../src/lore/lorebook.js';
import { relationshipsPlugin } from '../src/ai/plugins/relationships_plugin.js';
import { memoryPlugin } from '../src/ai/plugins/memory_plugin.js';
import { feelingsPlugin } from '../src/ai/plugins/feelings_plugin.js';
import { socialPlugin } from '../src/ai/plugins/social_plugin.js';
import { questPlugin } from '../src/ai/plugins/quest_plugin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(?:js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Code only: comments say what a line was, not what the game says.
function codeOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

// ------------------------------------------------------------------ the retired Lyra is gone

test('no source file still gives Lyra the old origin (LORE §12)', () => {
  const RETIRED = [
    [/\bTidewell\b/, 'Tidewell'],
    [/\bKettlewake\b/, 'Kettlewake'],
    [/\bOdile\b/, 'Odile'],
    [/\bOrrin\b/, 'Orrin'],
    [/\bCal\b/, 'Cal, her brother'],
    [/\bbrother Cal\b|\bCal's fever\b/i, "Cal's fever"],
    [/Lyra of the Glasswater/i, 'Lyra of the Glasswater Isles'],
    [/arcane ranger/i, 'arcane ranger'],
    [/since I left the Isles|back on the Isles|island girl|island skies/i, 'Lyra from the Isles'],
  ];
  const hits = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const code = codeOf(file);
    for (const [re, label] of RETIRED) if (re.test(code)) hits.push(`${path.relative(ROOT, file)}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('her soul is Lyra Ambrel of Hearthvale, and Hearthvale is her home (DESIGN §19.7)', () => {
  for (const soul of [DEFAULT_SOUL, FALLBACK_SOUL]) {
    assert.equal(soul.fullName, 'Lyra Ambrel');
    assert.match(soul.origin, /^Hearthvale/);
    assert.match(soul.backstory, /lumencrafter/);
    assert.match(soul.backstory, /Hobb/);
    assert.ok(soul.secrets.some((s) => /Bryn/.test(s.text)), "her secret is Bryn's leg");
  }
  assert.ok(DEFAULT_SOUL.limits.some((l) => /home/.test(l) && /chandlery/.test(l) && /does not leave/.test(l)));
  assert.ok(DEFAULT_SOUL.dreams.some((d) => /waystones/.test(d)), 'the road to the sea is a dream');
  const rules = buildRules({ companion: { mind: { soul: DEFAULT_SOUL } }, actions: { catalogText: () => '' } });
  assert.match(rules, /born in the village of Hearthvale/);
  assert.match(rules, /never leave Hearthvale/);
  assert.match(rules, /Hollowcrown/);
  assert.ok(!/Glasswater|Kettlewake|\branger\b/i.test(rules));
});

test('LORE §7: gone means she cuts the stranger out of her life at home, never that she takes the road', () => {
  const lore = fs.readFileSync(path.join(ROOT, 'docs/LORE.md'), 'utf8');
  const table = lore.slice(lore.indexOf('### Hearthwatch, and where she sleeps'), lore.indexOf('### What she would never do'));
  const gone = table.split('\n').find((l) => l.startsWith('| gone |'));
  assert.match(gone, /chandlery/);
  assert.match(gone, /village stands with her/);
  assert.ok(!/leaves Hearthvale|down the King's Road/.test(gone));
  assert.match(table, /never a way out of her own village/);
  const boundaries = lore.slice(lore.indexOf('### Boundaries'), lore.indexOf('### Hearthwatch, and where she sleeps'));
  assert.match(boundaries, /shouts for help/);
  assert.match(boundaries, /never leaves it/);
});

// ------------------------------------------------------------------ the story is real, and keeps its secrets

test('story.js is the real story: eighteen villagers, LORE §9 mysteries, every hidden truth with its holders', () => {
  assert.equal(STORY.placeholder, false);
  assert.equal(STORY_VILLAGERS.length, 18);
  for (const id of STORY_VILLAGERS) assert.ok(STORY.people.some((p) => p.npcId === id), `${id} is in the story`);
  // LORE §9.10, "Hidden truths": each one a mystery whose truth names who holds it (never Lyra).
  const HIDDEN = ['who_is_the_stranger', 'where_is_maren', 'who_is_varek', 'thinning_ward', 'is_lyra_brightborn', 'the_greywinter_count', 'why_the_song_broke', 'mirror_lake_hum', 'map_to_a_well', 'owlsend_dark'];
  for (const id of HIDDEN) {
    const m = STORY.mysteries.find((x) => x.id === id);
    assert.ok(m, `mystery ${id}`);
    assert.ok(Array.isArray(m.knownBy), `${id} has knownBy`);
    assert.ok(!m.knownBy.includes('lyra') && !m.knownBy.includes('everyone'), `${id} is hidden from Lyra`);
    assert.ok(m.truth.length > 40 && m.clues.length >= 1);
  }
  assert.deepEqual(STORY.mysteries.find((m) => m.id === 'the_greywinter_count').knownBy, ['alder']);
  // What Lyra is seeded with never contains a hidden truth.
  const book = new Lorebook(STORY);
  const hers = JSON.stringify(book.knownBy('lyra'));
  for (const secret of ['Keeper', 'Varek Coll', "Sabeth's brother", 'read the number', 'asked, and the Drift answered', 'Ewan Vale did not die', 'Mira is the one', 'paid the toll', 'poems']) {
    assert.ok(!hers.includes(secret), `Lyra's lore never says "${secret}"`);
  }
  assert.equal(book.get('glasswater_isles').knownBy[0], 'everyone');
  assert.match(book.get('glasswater_isles').text, /Maren Ashgrove was born there/);
  for (const id of ['cal', 'orrin', 'odile']) assert.equal(book.get(id), null);
});

test('the Book of Halcyre: every chapter page is a story entry, and no truth is a page', () => {
  const book = new Lorebook(STORY);
  const keys = BOOK_CHAPTERS.flatMap((c) => c.entries);
  for (const k of keys) assert.ok(book.get(k), `${k} resolves`);
  const listed = new Set(keys);
  assert.equal(listed.size, keys.length, 'every page is in exactly one chapter');
  for (const e of book.all()) assert.ok(listed.has(e.key), `${e.key} has a chapter`);
  // A page nobody knows at the start (the inside of the ruins) never sits in a chapter open from the start.
  for (const c of BOOK_CHAPTERS.filter((x) => x.unlock === 'start')) {
    for (const k of c.entries) {
      const kb = book.get(k).knownBy;
      assert.ok(!Array.isArray(kb) || kb.length > 0, `${k} is known to someone before it opens at the start`);
    }
  }
  for (const c of BOOK_CHAPTERS) assert.ok(['start', 'seen', 'met', 'told', 'clue'].includes(c.unlock) && c.title && c.blurb);
});

test("LORE §12: villagers' secrets carry knownBy / hiddenFrom, and availableFacts never offers them to Lyra", () => {
  const SECRET = ['aveline_maren_words', 'elda_recipe', 'mira_herbs_rowan', 'bram_poetry', 'bram_poem_line', 'rowan_flute', 'garrick_toll_secret', 'tobias_secret', 'pip_fear', 'elda_maren_things'];
  const facts = new Map(NPC_PROFILES.flatMap((p) => p.facts || []).map((f) => [f.id, f]));
  for (const id of SECRET) {
    const f = facts.get(id);
    assert.ok(f, id);
    assert.ok(factHiddenFrom(f, 'lyra'), `${id} is hidden from Lyra`);
    assert.ok(!factHiddenFrom(f, 'player'), `${id} can still be learned by the player`);
  }
  // However close she is to them, nobody tells her a secret LORE hides from her.
  for (const p of NPC_PROFILES) {
    const npc = { id: p.id, name: p.name, profile: p };
    for (const topic of [null, 'secret', 'maren', 'people', 'lyra']) {
      for (const f of availableFacts(npc, { familiarity: 100, notes: [] }, topic)) assert.ok(!SECRET.includes(f.id), `${p.id} never offers ${f.id} to Lyra`);
    }
  }
  // The rule itself.
  const npc = {
    id: 'x',
    profile: {
      facts: [
        { id: 'open', text: 'Open to everyone.', minFamiliarity: 0, topic: 'work' },
        { id: 'hidden', text: 'Hidden from her.', minFamiliarity: 0, topic: 'work', hiddenFrom: ['lyra'] },
        { id: 'held', text: 'Only Bram knows.', minFamiliarity: 0, topic: 'work', knownBy: ['bram'] },
        { id: 'shared', text: 'Bram and Lyra know.', minFamiliarity: 0, topic: 'work', knownBy: ['bram', 'lyra'] },
        { id: 'common', text: 'Common knowledge.', minFamiliarity: 0, topic: 'work', knownBy: ['everyone'] },
      ],
    },
  };
  assert.deepEqual(availableFacts(npc, { familiarity: 100 }).map((f) => f.id).sort(), ['common', 'open', 'shared']);
  // The player can still learn what Lyra is never told; only what is hidden from them stays hidden.
  assert.deepEqual(availableFacts(npc, { familiarity: 100 }, null, { listener: 'player' }).map((f) => f.id).sort(), ['common', 'held', 'hidden', 'open', 'shared']);
});

test("Maren's journal tells LORE §9.2 and no more; villagers tell Lyra what they saw, never their secrets", () => {
  const journal = MAREN_JOURNAL.map((e) => e.text).join(' ');
  assert.match(journal, /stones of this verse are failing/);
  assert.match(journal, /from here to the Crown Ring, and past the Ring into the Pale/);
  assert.match(journal, /I mean to go through/);
  assert.match(journal, /where the Song lets go/);
  assert.match(journal, /If someone comes out, I hope whoever it is is kind\./);
  assert.ok(!/Little lamp|Keeper|chose this|join|singer|Wellstone/i.test(journal), 'nothing the journal does not say');
  const told = JSON.stringify(MAREN_TESTIMONY);
  for (const secret of ['chose this', 'not to follow', 'strongbox', 'letter', 'Keeper']) assert.ok(!told.includes(secret), `no one tells Lyra "${secret}"`);
  assert.match(marenAnswer('settle'), /nineteen years/);
  assert.match(marenAnswer('settle', { what: true }), /ruins wall at midsummer/);
  assert.match(marenAnswer('waygate', { what: true }), /north through the old waygate/);
});

// ------------------------------------------------------------------ her people

test("Lyra's people: the eighteen, Maren and Bryn as LORE §7 gives them; the stranger's trust fits her will", () => {
  const W = generateWorld({ bus: new EventBus(), rng: new RNG(3), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null }, atlas: null, ui: null }, 1337);
  const { mind } = makeGame(W);
  const want = {
    hobb: [90, 85, 100], wenna: [90, 85, 100], sabeth: [85, 80, 90], hess: [60, 70, 85], elda: [75, 75, 90], mira: [75, 80, 85],
    bram: [65, 75, 85], pip: [60, 55, 70], rowan: [40, 65, 75], tobias: [45, 60, 70], aveline: [55, 65, 75], garrick: [40, 45, 70],
    alder: [10, 35, 80], petra: [60, 60, 90], tilly: [50, 55, 75], tansy: [20, 40, 65], corran: [55, 60, 85], wys: [25, 45, 60],
    maren: [95, 90, 100], bryn: [75, 80, 90],
  };
  for (const [id, [a, t, f]] of Object.entries(want)) {
    const r = mind.relationships.get(id);
    assert.ok(r, id);
    assert.deepEqual([r.affinity, r.trust, r.familiarity], [a, t, f], `${id}: affinity, trust, familiarity`);
    assert.ok(r.opinion && r.opinion.length > 30, `${id}: her own words`);
  }
  assert.ok(mind.relationships.get('hobb').tags.includes('family') && mind.relationships.get('wenna').tags.includes('family'));
  assert.equal(mind.relationships.get('hobb').call, 'Da');
  // What she knows of each person, never their hidden secrets (LORE §9.10).
  const notes = JSON.stringify(Object.keys(LYRA_PEOPLE).map((id) => mind.relationships.get(id).notes));
  for (const secret of ['poem', 'toll', 'ferry-house', "June's letter", 'Ewan', 'strongbox', 'chose this', 'Varek is', 'froze', 'moonpetal in', 'brightfall night', 'spear']) {
    assert.ok(!new RegExp(`\\b${secret}\\b`, 'i').test(notes), `no note says "${secret}"`);
  }
  const p = mind.relationships.get('player');
  assert.equal(PLAYER_REL_START.trust, T.startTrust, "the stranger's starting trust is her will's calibration");
  assert.equal(p.trust, T.startTrust);
  assert.ok(p.history.some((h) => /Hollowcrown/.test(h)) && p.history.some((h) => /wolves/.test(h)));
});

// ------------------------------------------------------------------ the offline mind

function makeGame(W) {
  const bus = new EventBus();
  const game = {
    bus,
    rng: new RNG(42),
    time: 1,
    state: 'playing',
    flags: {},
    settings: { ...DEFAULT_SETTINGS, provider: 'local' },
    map: W.map,
    objects: W.objects,
    locations: W.locations,
    spawns: W.spawns,
    bubbles: { say() {}, thought() {}, icon() {}, isBusy: () => false, clear() {} },
    ui: { chat: { messages: [], addMessage(m) { this.messages.push(m); }, isOpen: () => false }, toast() {} },
  };
  game.clock = new GameClock(game);
  game.clock.t = (10 / 24) * DAY_SECONDS;
  game.entities = new EntityManager(game);
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  const home = W.spawns.player;
  game.player = game.entities.add(new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', x: home.x, y: home.y, maxHp: 50 }));
  const lyra = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', x: home.x + 12, y: home.y, maxHp: 45, inventory: new Inventory({ coin: 8 }) });
  lyra.behavior = { directive: { type: 'follow', target: 'player' }, stance: 'defend', setDirective() { return { ok: true, message: '' }; }, status: () => 'following you', emote() {} };
  game.companion = game.entities.add(lyra);
  lyra.mind = new Mind(game, lyra);
  for (const p of [relationshipsPlugin, memoryPlugin, feelingsPlugin, socialPlugin, questPlugin]) game.plugins.register(p);
  game.plugins.installAll();
  game.brain = new Brain(game);
  game.brain.init?.();
  return { game, mind: lyra.mind, lyra };
}

test('offline, she answers questions about her life, her people, Maren and the world the way LORE tells it', async () => {
  const W = generateWorld({ bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null }, atlas: null, ui: null }, 1337);
  const { game } = makeGame(W);
  const ask = async (q) => (await game.brain.handlePlayerMessage(q))?.say || '';
  const CASES = [
    ['where are you from?', [/Hearthvale/, /Lamplight Lane|chandlery/]],
    ['tell me about your parents', [/Lamplight Lane/, /lamplighter/, /bees/]],
    ['who is your father?', [/lamp/]],
    ['tell me about your mother', [/Seventy-six|nearly blind|fiercest/]],
    ['do you have any siblings?', [/Ansel, Bee and little Jem/, /Beth/]],
    ['how did you find me?', [/Hollowcrown|ring of stones|Crown Ring/]],
    ['how did we meet?', [/Crown Ring/, /wolves/]],
    ['what happened to Maren?', [/ruins wall/, /midsummer/, /Aveline/]],
    ['who is Maren?', [/teacher/, /nightgown/]],
    ['who is Bryn?', [/Bryn/, /leg|Cut/]],
    ['what happened in the Weeping Cut?', [/Bryn/, /Davin/]],
    ['what is the Drift?', [/magic/i, /ward/i]],
    ['tell me about the ward', [/Drift/]],
    ['what is the Wellstone?', [/well/i, /ward|Song/]],
    ['what magic do you use?', [/[Ll]umencraft/, /warmth/]],
    ['are you a ranger?', [/[Ll]umencraft/]],
    ['tell me about Glasswater', [/Maren's home, not mine/]],
    ['why are you here?', [/born here/]],
    ['are you brightborn?', [/brightborn/, /not to care/]],
  ];
  for (const [q, res] of CASES) {
    const a = await ask(q);
    for (const re of res) assert.match(a, re, `"${q}" -> ${a}`);
    assert.ok(!/Kettlewake|Tidewell|Odile|Orrin|\bCal\b|the Isles|arcane ranger|island/i.test(a), `"${q}" never uses the retired canon: ${a}`);
    assert.ok(!/\bI is\b|\bI has\b|the stranger/.test(a), `"${q}" is in her own voice: ${a}`);
  }
});

test('offline, she keeps her pride, her secrets and her home; the stranger is "you" in every telling', async () => {
  const W = generateWorld({ bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 300, hour: 8, daylight: 1, weather: { type: 'clear' } }, entities: { list: [], nearest: () => null }, atlas: null, ui: null }, 1337);
  const { game } = makeGame(W);
  const ask = async (q) => (await game.brain.handlePlayerMessage(q))?.say || '';
  const CASES = [
    // Family words are her family, never "a thing she likes".
    ['what about your mother?', [/fiercest|nearly blind/], [/\bI love mother\b|mother — yes/i]],
    ['what about your parents?', [/Lamplight Lane/], []],
    // Her opinion of the stranger, not a yes or no.
    ['what do you think of me?', [/wolves/], [/^Yes\./]],
    // LORE §7: she has never admitted she is afraid of deep water (a deep-bond secret).
    ['what are you afraid of?', [/Sickbeds/], [/water/i]],
    ['can you swim?', [/swim/], [/afraid|scares me/i]],
    // DESIGN §19.7: Hearthvale is her home; the road is a dream, not a door.
    ['are you going to leave Hearthvale?', [/born here/, /dream/], []],
    ['would you ever leave the village?', [/born here/], []],
    // She does not talk about Davin, and keeps the inside of the Cut for a deep bond.
    ['tell me about Davin', [/don't talk about Davin/], [/first love/]],
    ['what happened in the Weeping Cut?', [/Bryn/, /Davin/], [/said no, and then yes|made his life small/]],
    // Told to the player, the stranger is "you".
    ['what happened on the mountain?', [/you/, /carried you down/], [/\bthem\b|the stranger/]],
    ['tell me about the long sleep', [/You sleep eighty-one days/, /sits with you/], [/\bthem\b|her turns/]],
    ['tell me about the wolves', [/You stood beside me/], [/the stranger/]],
    ['what do you dream of?', [/waystones/], [/the stranger/]],
    ['why did you take the hearthwatch?', [/stipend/], [/^Here\?/]],
    // People and places by what the valley knows (LORE §6, §10), not a stranger's shrug.
    ['who is Varek?', [/bandits|axe/], [/haven't met properly/]],
    ['tell me about the Sunken Ruins', [/marsh/, /Blue lights/], []],
    ['tell me about the chapel', [/Thirty-eight family flames/], [/when they kneel/]],
    ['who is Bryn?', [/Saltmere/], [/saltmere/]],
  ];
  for (const [q, want, never] of CASES) {
    const a = await ask(q);
    for (const re of want) assert.match(a, re, `"${q}" -> ${a}`);
    for (const re of never) assert.doesNotMatch(a, re, `"${q}" -> ${a}`);
  }
});

test('every story text she may tell reads right in her mouth: Lyra is I, the stranger is you (story.js header)', () => {
  for (const kind of ['world', 'timeline', 'places', 'people']) {
    for (const e of STORY[kind]) {
      const said = toListener(firstPerson(e.text, 'Lyra'), { aboutPlayer: (e.tags || []).includes('player') });
      assert.doesNotMatch(said, /\bme (?!included\b)(?:[a-z]+ed|came|went|took|saw|heard|paid|made|can|could|will|would|lights?)\b|\bI (?:as|a)\b/, `${kind}:${e.id} -> ${said}`);
      assert.doesNotMatch(said, /\bthe stranger\b/i, `${kind}:${e.id} -> ${said}`);
      assert.doesNotMatch(said.replace(/'Lyra'/g, ''), /\bLyra\b/, `${kind}:${e.id} -> ${said}`);
    }
  }
});
