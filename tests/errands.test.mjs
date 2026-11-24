// Errands, problems and the missing (DESIGN §28, and what §29 builds on), in a real
// Hearthvale: the generated world, all eighteen villagers on their schedules, the village,
// and game.villageLife. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run, runUntilHour } from './village_life_world.mjs';
import { ERRANDS, EXPECTS, COVER, PLACE_PHRASE } from '../src/ai/village_life/errands_data.js';
import { ANY, LIFE, LYRA_LIFE, THOUGHTS } from '../src/ai/village_life/life_lines.js';
import { decideLocal } from '../src/ai/village_life/reasoner_local.js';
import { ClaudeReasoner, coerceDecisions, buildThinkTask, THINK_SCHEMA } from '../src/ai/village_life/reasoner_claude.js';
import { parseClaim } from '../src/ai/village_life/village_life.js';
import { entryAt } from '../src/entities/npc_schedule.js';
import { profileById } from '../src/entities/npc_data.js';
import { speakable } from '../src/ai/social/hidden.js';
import { VILLAGERS } from '../src/ai/social/bonds_data.js';

const HOUR = 37.5;

// Like run(), but lets promises (Claude's answers) settle every simulated second.
async function runAsync(game, seconds, dt = 0.1) {
  const per = Math.round(1 / dt);
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    run(game, dt, dt);
    if (i % per === 0) await new Promise((r) => setImmediate(r));
  }
}

async function runUntilHourAsync(game, hour, dt = 0.1) {
  const target = Math.floor(game.clock.t / 900) * 900 + (hour / 24) * 900;
  await runAsync(game, Math.max(0, target - game.clock.t), dt);
}

function allLines(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) for (const x of o) allLines(x, out);
  else if (o && typeof o === 'object') for (const v of Object.values(o)) allLines(v, out);
  return out;
}

// ------------------------------------------------------------------ data

test('errand data fits the villagers’ days: the person needed is there, the runner is awake', () => {
  const who = new Set(ERRANDS.map((e) => e.who));
  for (const id of VILLAGERS) assert.ok(who.has(id), `${id} has errands`);
  for (const id of VILLAGERS) assert.ok(ERRANDS.filter((e) => e.who === id).length >= 2, `${id} has at least two kinds of errand (variety)`);
  for (const e of ERRANDS) {
    assert.ok(e.window[0] < e.window[1], `${e.id} window`);
    assert.ok(e.label && e.purpose && e.why?.length, `${e.id} label/purpose/why`);
    assert.ok(PLACE_PHRASE[e.at], `${e.id} place ${e.at}`);
    const mid = (e.window[0] + e.window[1]) / 2;
    const runner = entryAt(profileById(e.who).schedule, mid);
    assert.notEqual(runner.activity, 'sleep', `${e.id}: ${e.who} is asleep then`);
    if (e.to) {
      const p = profileById(e.to);
      const at = [e.window[0] + 0.05, mid, e.window[1] - 0.05].map((h) => entryAt(p.schedule, h).at);
      assert.ok(at.every((x) => x === e.at), `${e.id}: ${e.to} is at ${e.at} through the window (${at.join(',')})`);
      assert.ok(e.talks?.length, `${e.id} has an exchange`);
      for (const talk of e.talks) for (const [sp] of talk) assert.ok(sp === e.who || sp === e.to, `${e.id} speaker ${sp}`);
    }
  }
  for (const x of EXPECTS) {
    const p = profileById(x.whom);
    const mid = (x.window[0] + x.window[1]) / 2;
    assert.equal(entryAt(p.schedule, mid).at, x.at, `${x.who} expects ${x.whom} at ${x.at}`);
    assert.equal(entryAt(profileById(x.who).schedule, mid).at, x.at, `${x.who} is at ${x.at} themselves`);
  }
  for (const [id, c] of Object.entries(COVER)) assert.ok(VILLAGERS.includes(id) && VILLAGERS.includes(c.by), `cover ${id}`);
});

test('nothing anyone says about errands or the missing states a hidden truth (LORE §9.10)', () => {
  const lines = [...allLines(ERRANDS), ...allLines(ANY), ...allLines(LIFE), ...allLines(LYRA_LIFE), ...allLines(THOUGHTS)];
  assert.ok(lines.length > 300);
  for (const l of lines) assert.ok(speakable(l), `hidden truth in: ${l}`);
});

// ------------------------------------------------------------------ errands and sightings

test('errands are planned every morning with variety, and done for real over two days', () => {
  const game = makeWorld({ hour: 5.5 });
  const life = game.villageLife;
  const wennaHoney = () => game.entities.get('wenna').inventory.count('honey');
  run(game, 1);
  const d0 = game.clock.day;
  const day1 = life.book.list.map((e) => e.tpl);
  assert.ok(day1.length >= 24, `planned ${day1.length}`);
  assert.ok(new Set(life.book.list.map((e) => e.who)).size >= 16, 'most of the eighteen have errands');
  const honeyBefore = wennaHoney();
  const garrickWick = life.stock.garrick.wick;
  // Count the two-person exchanges as they happen (the village's own log is a rolling 80).
  const exchanges = [];
  const converse = game.village.converse.bind(game.village);
  game.village.converse = (a, b, o = {}) => {
    if (o.source === 'village_life') exchanges.push([a, b, o.summary]);
    return converse(a, b, o);
  };
  runUntilHour(game, 23);
  const done1 = life.book.list.filter((e) => e.state === 'done');
  assert.ok(done1.length >= day1.length * 0.75, `day 1: ${done1.length}/${day1.length} done`);
  assert.ok(life.events.some((e) => e.kind === 'errand' && / is /.test(e.text)), 'errands are visible ("Hobb is off to Gale\'s Goods for wick")');
  assert.ok(exchanges.length >= 15, `errands are exchanges between two people (${exchanges.length})`);
  assert.ok(game.village.log.some((c) => c.source === 'village_life'), 'logged by the village');
  // Goods, coin and stock really move.
  if (done1.some((e) => e.tpl === 'elda_honey')) assert.ok(wennaHoney() < honeyBefore, "Wenna's honey went to the Kettle");
  if (done1.some((e) => e.tpl === 'hobb_wick')) assert.ok(life.stock.garrick.wick < garrickWick, "Garrick's wick stock went down");
  // A second day: a different handful.
  runUntilHour(game, 23.9);
  run(game, 900 * (6 / 24));
  const day2 = life.book.list.map((e) => e.tpl);
  assert.equal(life.book.day, d0 + 1);
  assert.ok(day2.length >= 24);
  const same = day2.filter((t) => day1.includes(t)).length;
  assert.ok(same < day2.length, 'day two is not a copy of day one');
  runUntilHour(game, 23);
  const done2 = life.book.list.filter((e) => e.state === 'done');
  assert.ok(done2.length >= day2.length * 0.75, `day 2: ${done2.length}/${day2.length} done`);
});

test('sightings come from each villager’s own eyes', () => {
  const game = makeWorld({ hour: 12.3 });
  const life = game.villageLife;
  run(game, 3);
  // Lunch at the Kettle: Elda sees Pip there; Hess at the dye-vats does not see Wenna's hives.
  const s = life.sight.lastSeen('elda', 'pip');
  assert.ok(s && s.place === 'ember_kettle', `Elda saw Pip at the Kettle (${s?.place})`);
  assert.ok(Math.abs(s.t - game.clock.t) < 2);
  // Someone gone is seen by nobody after they went.
  const t0 = game.clock.t;
  life.markGone('corran', { cause: 'test' });
  run(game, 20);
  for (const id of VILLAGERS) {
    const x = life.sight.lastSeen(id, 'corran');
    assert.ok(!x || x.t <= t0 + 0.6, `${id} cannot see Corran after he went`);
  }
  // Who someone was with is remembered.
  const any = VILLAGERS.flatMap((a) => VILLAGERS.map((b) => life.sight.lastSeen(a, b))).filter((x) => x?.with);
  assert.ok(any.length > 0, 'sightings note who people were with');
});

// ------------------------------------------------------------------ the chain

test('a smith away somewhere unexpected: the forge is cold, people ask, the watch searches, he is found', () => {
  const game = makeWorld({ hour: 4.8 });
  const life = game.villageLife;
  run(game, 1);
  life.vanish('bram', { mode: 'away', place: 'mirror_lake', hours: 9, witnesses: [] });
  runUntilHour(game, 14);
  const c = life.cases.get('bram');
  assert.ok(c, 'the village opened a case');
  const story = life.caseStory('bram').join('\n');
  assert.ok(c.noticers.includes('tilly'), `Tilly noticed the cold forge:\n${story}`);
  assert.ok(life.events.some((e) => e.kind === 'ask' && e.about === 'bram'), 'people asked after him');
  assert.ok(c.alarmAt != null, `the watch was told and searched:\n${story}`);
  assert.equal(c.status, 'found', `he was found:\n${story}`);
  assert.equal(c.foundPlace, 'mirror_lake');
  assert.ok(game.toasts.some((t) => /Bram has turned up safe/.test(t.text)));
  // Word goes round, and those who were looking let it go.
  runUntilHour(game, 17);
  assert.ok(!life.problems.some((p) => p.status === 'open' && p.about === 'bram'), 'nobody is still looking');
  assert.ok(!life.absences.get('bram'), 'he is back in his own life');
});

test('someone gone for good: errands fail, word spreads, the watch searches, and by nightfall he is missing', () => {
  const game = makeWorld({ hour: 6.5 });
  const life = game.villageLife;
  run(game, 2);
  runUntilHour(game, 7);
  const d0 = game.clock.day;
  life.forceErrand('hobb', 'hobb_wick', 13.5);
  life.vanish('garrick');
  runUntilHour(game, 16);
  const failed = life.book.list.filter((e) => e.to === 'garrick' && e.state !== 'planned');
  assert.ok(failed.length >= 2 && failed.every((e) => e.state !== 'done'), 'errands to Garrick fail');
  const c = life.cases.get('garrick');
  assert.ok(['search', 'asking'].includes(c.status), `status ${c.status}`);
  assert.ok(c.noticers.length >= 3, 'several people noticed');
  assert.ok(life.problems.some((p) => p.owner === 'hobb' && p.about === 'garrick'), 'Hobb could not get his wick');
  assert.ok(Object.keys(c.searched).length >= 2, 'places were searched');
  runUntilHour(game, 21);
  assert.equal(c.status, 'missing');
  const r = game.village.rumors.get(c.rumor);
  assert.equal(r.kind, 'missing');
  const present = VILLAGERS.filter((id) => id !== 'garrick');
  assert.ok(present.every((id) => r.heardBy.includes(id)), 'missing is village knowledge');
  assert.ok(game.toasts.some((t) => /Garrick is missing/.test(t.text)));
  // Lyra hears, and asks the player.
  assert.ok(game.companion.mind.sayings.some((s) => /Garrick/.test(s.text) && /\?/.test(s.text)), 'Lyra asks "Have you seen Garrick?"');
  // Schedules adapt next morning: Alder minds the shop. People worry.
  run(game, 900 * (10.5 / 24) + 30);
  assert.equal(game.clock.day, d0 + 1);
  const alder = game.entities.get('alder');
  const e = life.entryFor(alder, { activity: 'work', at: 'ashby_house' }, 9);
  assert.equal(e?.at, 'general_store');
  assert.ok(VILLAGERS.some((id) => life.mourning[id]?.about === 'garrick'), 'those close to him worry');
  const worry = life.ambientLine(game.entities.get(Object.keys(life.mourning).find((id) => life.mourning[id].about === 'garrick')));
  assert.ok(worry === null || /Garrick/.test(worry));
  // Nobody runs errands to him now.
  assert.ok(!life.book.list.some((x) => x.to === 'garrick' && x.state === 'done'));
});

test('a body found turns missing into dead (the §29 hook)', () => {
  const game = makeWorld({ hour: 8 });
  const life = game.villageLife;
  run(game, 1);
  life.markGone('corran', { cause: 'killed', keepBody: true });
  const events = [];
  game.bus.on('body_found', (p) => events.push(p));
  const c = life.onBodyFound('corran', 'hess', 'mirror_lake');
  assert.equal(c.status, 'dead');
  assert.equal(events.length, 1);
  assert.ok(game.village.rumors.list.some((r) => r.kind === 'found_dead' && r.victim === 'corran'));
  assert.ok(VILLAGERS.some((id) => life.mourning[id]?.kind === 'grief'), 'friends grieve');
  assert.equal(typeof game.village.markGone, 'function');
});

// ------------------------------------------------------------------ talking to the player

test('"what\'s wrong?" and "have you seen X?" are answered from real state', async () => {
  const game = makeWorld({ hour: 13.2 });
  const life = game.villageLife;
  run(game, 1);
  life.vanish('garrick');
  life.forceErrand('hobb', 'hobb_wick', game.clock.hour);
  const hobb = game.entities.get('hobb');
  runUntilHour(game, 14.5, 0.1);
  assert.ok(life.openProblem('hobb') || life.problems.some((p) => p.owner === 'hobb'), 'Hobb has a problem');
  if (life.openProblem('hobb')) {
    const r = await game.village.playerSays(hobb, "What's wrong?");
    assert.ok(/Garrick|wick|shut/i.test(r.lines.join(' ')), r.lines.join(' '));
  }
  const elda = game.entities.get('elda');
  const seen = life.sight.lastSeen('elda', 'pip');
  const r2 = await game.village.playerSays(elda, 'Have you seen Pip?');
  if (seen) assert.ok(/kettle|square|this|ago|now|noon|morning|afternoon|yesterday/i.test(r2.lines.join(' ')), r2.lines.join(' '));
  else assert.ok(r2.lines.length);
});

test('a villager’s bad day shows in the dialog, and the player can answer their question with a button', () => {
  const game = makeWorld({ hour: 13.2 });
  const life = game.villageLife;
  run(game, 1);
  life.vanish('garrick');
  const hobb = game.entities.get('hobb');
  const prob = life.newProblemFor(hobb, { kind: 'shut', about: 'garrick', place: 'general_store', purpose: 'buy wick for tonight’s lamp-round', goods: 'wick', shop: "Gale's Goods", care: 0.5 });
  const d = hobb.getDialogue(game.player);
  assert.ok(d.options.some((o) => o.id === 'life:wrong' && /wrong/i.test(o.label)), JSON.stringify(d.options));
  const r = hobb.chooseOption('life:wrong', game.player);
  assert.match(r.lines.join(' '), /wick|Garrick/);
  assert.ok(r.options.length >= 2, 'the usual options stay');
  life.pending.npc.hobb = { about: 'garrick', t: game.clock.t, rt: game.time, prob: prob.id };
  const d2 = hobb.getDialogue(game.player);
  assert.ok(d2.options.some((o) => o.id === 'life:answer:no'));
  const r2 = hobb.chooseOption('life:answer:no', game.player);
  assert.ok(r2.lines.length && r2.lines[0].length > 2);
  const claim = life.claims[life.claims.length - 1];
  assert.equal(claim.kind, 'not_seen');
  assert.equal(claim.to, 'hobb');
});

test('the player can lie to Lyra, and the lie can be found out', () => {
  const game = makeWorld({ hour: 9 });
  const life = game.villageLife;
  run(game, 1);
  const garrick = game.entities.get('garrick');
  const player = game.player;
  const corran = game.entities.get('corran');
  // The player walks with Garrick by the lake; Corran sees them together.
  player.x = garrick.x + 10;
  player.y = garrick.y;
  corran.x = garrick.x + 40;
  corran.y = garrick.y + 10;
  life.sight.sweep();
  assert.equal(life.sight.lastSeen('corran', 'garrick')?.with, 'player');
  life.markGone('garrick', { cause: 'test' });
  const c = life.cases.open('garrick', { by: 'elda', t: game.clock.t, day: 1, place: 'general_store' });
  c.status = 'search';
  c.lyra.knew = game.clock.t;
  life.pending.lyra = { about: 'garrick', t: game.clock.t, rt: game.time };
  game.bus.emit('player_message', { text: "No, I haven't seen him." });
  const claim = life.claims[0];
  assert.equal(claim.kind, 'not_seen');
  assert.equal(claim.lie, true, 'the game knows it is a lie');
  assert.equal(life.lyraReact()?.length > 0, true);
  life.checkClaims();
  assert.equal(claim.found, null, 'nobody knows yet');
  // Corran tells what he saw when asked; the village's talk reaches Lyra.
  const ans = life.answerFor('corran', 'garrick', 'rowan');
  assert.ok(/with/i.test(ans.line), ans.line);
  life.cases.report(c, { by: 'corran', kind: 'seen', place: ans.info.place, t: ans.info.t, with: ans.info.with, public: true });
  life.checkClaims();
  assert.ok(claim.found, 'the lie is found out');
  assert.ok(game.companion.mind.deeds.some((d) => d.deed === 'lied'), 'Lyra holds it against the player');
  assert.ok(game.companion.mind.memories.some((m) => /lied/.test(m.text)));
});

test('Lyra answers "have you seen X?" from her own eyes, and reacts to the answer to her question', () => {
  const game = makeWorld({ hour: 12.4 });
  const life = game.villageLife;
  const lyra = game.companion;
  const elda = game.entities.get('elda');
  lyra.x = elda.x + 30;
  lyra.y = elda.y;
  run(game, 2);
  const m = life.seenPattern('Have you seen Elda today?');
  assert.equal(m?.groups?.who, 'elda');
  assert.equal(life.seenPattern('Have you seen the ruins?'), null);
  const line = life.lyraAnswer('elda');
  assert.ok(/just now|kettle|ago|noon|morning/i.test(line), line);
  // Her question, the player's answer, her reaction (the offline brain uses the intent).
  life.pending.lyra = { about: 'elda', t: game.clock.t, rt: game.time };
  game.bus.emit('player_message', { text: 'I saw her down by the lake' });
  assert.ok(life.answerPattern('I saw her down by the lake'));
  assert.match(life.lyraReact(), /lake/i);
  assert.equal(life.claims[0].kind, 'seen_at');
  assert.ok(life.promptContext().length < 600);
});

test('the player’s answers are understood', () => {
  assert.equal(parseClaim("No, I haven't seen him", 'garrick').kind, 'not_seen');
  assert.deepEqual(parseClaim('I saw him down by the lake this morning', 'garrick'), { kind: 'seen_at', place: 'mirror_lake' });
  assert.equal(parseClaim('Yes', 'garrick').kind, 'seen');
  assert.equal(parseClaim('no idea', 'garrick').kind, 'not_seen');
  assert.equal(parseClaim('maybe', 'garrick').kind, 'unknown');
  assert.equal(parseClaim('I think we should go to the ruins tonight and look for the stone of the old song', 'garrick').kind, 'seen_at');
  assert.equal(parseClaim('Tell me about your childhood and the brightfall, please, I have always wondered', 'garrick').kind, 'unrelated');
});

// ------------------------------------------------------------------ the reasoners

const baseInput = (over = {}) => ({
  who: 'hobb',
  name: 'Hobb',
  kind: 'shut',
  about: 'garrick',
  aboutName: 'Garrick',
  purpose: 'buy wick',
  here: 'general_store',
  hereName: "Gale's Goods",
  origin: 'general_store',
  originAgo: 0,
  care: 0.5,
  steps: 1,
  elapsedH: 0.5,
  hour: 14,
  habitNow: { id: 'general_store', name: "Gale's Goods" },
  home: { id: 'general_store', name: "Gale's Goods" },
  checked: ['general_store'],
  checkedAt: { general_store: 500 },
  asked: [],
  heard: [],
  askable: [],
  places: [{ id: 'ember_kettle', name: 'The Ember Kettle', why: 'haunt' }],
  options: ['go', 'ask', 'wait', 'give_up', 'search', 'alarm', 'tell_lyra'],
  ...over,
});

test('the local reasoner reaches every action', () => {
  const seen = new Set();
  const D = (over) => {
    const d = decideLocal(baseInput(over), { rng: () => 0.1, say: () => 'said', think: () => 'thought' });
    seen.add(d.action.type);
    return d;
  };
  assert.equal(D({ steps: 0, expectedBackSoon: true }).action.type, 'wait');
  assert.deepEqual(D({ heard: [{ kind: 'seen', place: 'mirror_lake', placeName: 'the lake', t: 600, fromName: 'Corran' }] }).action, { type: 'go', target: 'mirror_lake' });
  assert.deepEqual(D({ askable: [{ id: 'mira', name: 'Mira', why: 'right here', near: true }] }).action, { type: 'ask', target: 'mira' });
  assert.equal(D({ care: 0.8, asked: ['mira', 'elda'], elapsedH: 2, places: [{ id: 'ember_kettle', name: 'Kettle' }], home: null }).action.type, 'alarm');
  assert.deepEqual(D({ care: 0.8, asked: ['mira', 'elda'], elapsedH: 2, watchKnows: true, caseSearching: true, home: null }).action, { type: 'search', target: 'ember_kettle' });
  assert.equal(D({ care: 0.3, asked: ['a', 'b', 'c'], elapsedH: 1, home: null, places: [] }).action.type, 'give_up');
  assert.equal(D({ lyraNear: true, home: null, asked: ['x'] }).action.type, 'tell_lyra');
  for (const a of ['go', 'ask', 'search', 'wait', 'alarm', 'give_up', 'tell_lyra']) assert.ok(seen.has(a), `reached ${a}`);
});

test('someone seen within the hour is only out and about: no alarm, the errand waits for later', () => {
  const recent = decideLocal(baseInput({ care: 0.8, asked: ['mira', 'elda'], elapsedH: 2, home: null, lastKnownAgo: 0.4, lastKnown: { fromName: 'Sabeth', when: 'just now' } }), { rng: () => 0.1, say: () => 'said', think: (k) => k });
  assert.equal(recent.action.type, 'give_up');
  assert.equal(recent.thought, 'about');
  const stale = decideLocal(baseInput({ care: 0.8, asked: ['mira', 'elda'], elapsedH: 2, home: null, lastKnownAgo: 3, lastKnown: { fromName: 'Sabeth', when: 'this morning' } }), { rng: () => 0.1, say: () => 'said', think: (k) => k });
  assert.equal(stale.action.type, 'alarm');
  // In the world: the errand goes back on the list instead of failing.
  const game = makeWorld({ hour: 9 });
  const life = game.villageLife;
  run(game, 1);
  const inst = life.forceErrand('hobb', 'hobb_wick', 9);
  inst.state = 'active';
  const hobb = game.entities.get('hobb');
  const prob = life.newProblemFor(hobb, { kind: 'shut', about: 'garrick', errand: inst.id, purpose: 'buy wick', place: 'general_store', care: 0.5 });
  prob.heard.push({ kind: 'seen', place: 'ember_kettle', placeName: 'the Kettle', t: life.now() - 5, when: 'just now', from: 'elda', fromName: 'Elda' });
  life.apply(prob, { action: { type: 'give_up', target: null }, thought: '', say: '', source: 'local' });
  assert.equal(prob.status, 'resolved');
  assert.equal(inst.state, 'planned', 'he will try again later');
});

test('news about a villager: never told by the one it is about, never once it is stale, good news only to those who heard the bad', () => {
  const game = makeWorld({ hour: 10 });
  const v = game.village;
  const R = v.rumors;
  const ask = v.addRumor('asking_after', { victim: 'mira', witnesses: ['aveline', 'mira'], source: 'aveline', about: 'village' });
  assert.ok(ask);
  assert.ok(!R.tellable('mira', 'rowan', v.now()).includes(ask), 'Mira does not spread "nobody can find Mira"');
  assert.ok(R.tellable('aveline', 'rowan', v.now()).includes(ask));
  run(game, 2);
  const found = v.addRumor('found_safe', { victim: 'mira', witnesses: ['aveline'], source: 'aveline', about: 'village' });
  assert.ok(!R.tellable('mira', 'rowan', v.now()).includes(ask) && !R.tellable('aveline', 'rowan', v.now()).includes(ask), 'stale: she has turned up');
  assert.ok(!R.tellable('aveline', 'rowan', v.now()).includes(found), 'Rowan never heard she was lost');
  R.hear(ask, 'rowan', 'aveline', () => 0.9);
  assert.ok(R.tellable('aveline', 'rowan', v.now()).includes(found), 'Rowan heard she was lost: he hears she is found');
});

test('asked about someone the watch is searching for, people who know say so', () => {
  const game = makeWorld({ hour: 9 });
  const life = game.villageLife;
  run(game, 1);
  life.vanish('garrick');
  life.startSearch('garrick', 'rowan', { by: 'hobb' });
  const r = game.village.rumors.get(life.cases.get('garrick').rumor);
  r.heardBy.push('hess');
  const ans = life.answerFor('hess', 'garrick', 'tobias');
  assert.ok(['sought', 'seen', 'heard'].includes(ans.info.kind), ans.info.kind);
  if (ans.info.kind === 'sought') assert.match(ans.line, /watch|looking|search/i);
});

test('every decided action runs in the world without breaking anyone’s day', () => {
  const game = makeWorld({ hour: 14 });
  const life = game.villageLife;
  run(game, 2);
  const actions = [
    { type: 'go', target: 'ember_kettle' },
    { type: 'ask', target: 'mira' },
    { type: 'search', target: 'mirror_lake' },
    { type: 'wait', target: null },
    { type: 'alarm', target: null },
    { type: 'tell_lyra', target: 'lyra' },
    { type: 'give_up', target: null },
  ];
  life.markGone('garrick', { cause: 'test' });
  for (const action of actions) {
    const hobb = game.entities.get('hobb');
    life.steps.delete('hobb');
    for (const p of life.problems) if (p.owner === 'hobb') life.closeProblem(p, 'given_up');
    const prob = life.newProblemFor(hobb, { kind: 'shut', about: 'garrick', place: 'general_store', purpose: 'buy wick', care: 0.6 });
    life.apply(prob, { action, thought: 'Where is he?', say: '', source: 'test' });
    if (action.type === 'give_up') assert.equal(prob.status, 'given_up');
    else if (action.type === 'alarm') assert.ok(life.steps.get('hobb')?.kind === 'alarm' || life.cases.get('garrick')?.status === 'search');
    else assert.ok(life.steps.get('hobb'), `${action.type} became a step`);
    run(game, 20);
  }
});

function mockProvider(answer) {
  const calls = [];
  return {
    calls,
    id: 'api',
    available: () => true,
    async complete(req) {
      calls.push({ at: req, task: req.task });
      return typeof answer === 'function' ? answer(req) : answer;
    },
  };
}

test('Claude is never called when nothing is wrong', async () => {
  const provider = mockProvider({ decisions: [] });
  const game = makeWorld({ hour: 1, settings: { villageAi: 'always' }, claude: { provider } });
  await runAsync(game, 1.5 * HOUR);
  assert.equal(provider.calls.length, 0);
  assert.equal(game.villageLife.claude.enabled(), true);
});

test('with "always", Claude thinks for villagers with problems: batched, budgeted, validated', async () => {
  // Claude answers every villager in the batch: go to the first place offered.
  const provider = mockProvider((req) => {
    const whos = [...req.task.matchAll(/who="(\w+)"/g)].map((m) => m[1]);
    const go = [...req.task.matchAll(/go\|search -> (\w+) /g)].map((m) => m[1]);
    return { decisions: whos.map((who, i) => ({ who, thought: `Where can he be? I'll try the ${go[i] || 'square'}.`, say: '', action: go[i] ? 'go' : 'wait', target: go[i] || null, belief: null })) };
  });
  const game = makeWorld({ hour: 6.5, settings: { villageAi: 'always' }, claude: { provider, gap: 30, cap: 6 } });
  const life = game.villageLife;
  run(game, 2);
  runUntilHour(game, 7);
  life.vanish('garrick');
  life.forceErrand('hobb', 'hobb_wick', 9);
  await runUntilHourAsync(game, 15);
  assert.ok(provider.calls.length >= 2, `called ${provider.calls.length} times`);
  assert.ok(provider.calls.length <= 6, 'within the session cap');
  const times = provider.calls.map((c, i) => i);
  assert.ok(times.length);
  const batchSizes = provider.calls.map((c) => [...c.task.matchAll(/who="/g)].length);
  assert.ok(batchSizes.every((n) => n >= 1 && n <= 6), `batches ${batchSizes}`);
  const byClaude = life.problems.flatMap((p) => p.history).filter((h) => h.by === 'claude');
  assert.ok(byClaude.length >= 1, 'Claude’s decisions were used');
  // Budget: at most one call per ~30 real seconds.
  assert.equal(life.claude.gap, 30);
  assert.equal(life.claude.stats().calls, provider.calls.length);
  // The prompt carries no secrets and asks for strict JSON.
  for (const c of provider.calls) {
    assert.ok(speakable(c.task));
    assert.ok(c.task.length < 6000, `compact prompt (${c.task.length})`);
    assert.deepEqual(c.at.schema, THINK_SCHEMA);
    assert.equal(c.at.tier, 'quick');
  }
});

test('Claude’s answers are validated: bad actions, targets and secrets fall back to the local reasoner', () => {
  const inputs = [baseInput({ askable: [{ id: 'mira', name: 'Mira', why: 'here', near: true }] }), baseInput({ who: 'elda', name: 'Elda' })];
  const out = coerceDecisions(
    {
      decisions: [
        { who: 'hobb', thought: 'Mira might know.', say: 'Mira, have you seen Garrick?', action: 'ask', target: 'mira', belief: null },
        { who: 'elda', thought: 'He pays the toll at the boundary stone to the bandits, I know it.', say: 'Garrick pays the toll at the boundary stone to the bandits.', action: 'ask', target: 'varek', belief: null },
        { who: 'nobody', thought: 'x', say: 'y', action: 'go', target: 'ember_kettle', belief: null },
      ],
    },
    inputs,
  );
  assert.deepEqual(out.get('hobb').action, { type: 'ask', target: 'mira' });
  assert.equal(out.has('elda'), false, 'an ask of someone not offered is dropped');
  const leak = coerceDecisions({ decisions: [{ who: 'hobb', thought: 'Garrick pays the toll at the boundary stone to the bandits.', say: 'Bram writes poems in a tin box.', action: 'wait', target: null, belief: null }] }, inputs);
  assert.equal(leak.get('hobb').say, '', 'a hidden truth is never said');
  assert.equal(leak.get('hobb').thought, '');
  assert.ok(buildThinkTask(inputs).includes('who="hobb"'));
});

test('a failing or slow Claude never stops the village: the local reasoner carries on', async () => {
  const provider = { id: 'api', available: () => true, complete: () => new Promise(() => {}) };
  const game = makeWorld({ hour: 6.5, settings: { villageAi: 'always' }, claude: { provider, timeoutMs: 50, gap: 1 } });
  const life = game.villageLife;
  run(game, 2);
  runUntilHour(game, 7);
  life.vanish('garrick');
  life.forceErrand('hobb', 'hobb_wick', 9.5);
  life.forceErrand('elda', 'elda_needles', 10);
  await runUntilHourAsync(game, 13);
  assert.ok(life.claude.failed >= 1, 'the call timed out');
  const byLocal = life.problems.flatMap((p) => p.history).filter((h) => h.by === 'local');
  assert.ok(byLocal.length >= 3, `villagers kept deciding (${byLocal.length})`);
  assert.ok(!life.problems.some((p) => p.awaiting), 'nobody is left waiting on Claude');
  assert.ok(life.cases.get('garrick'));
});

// ------------------------------------------------------------------ saving

test('save and load keep errands, sightings, problems, the absent and the case', () => {
  const game = makeWorld({ hour: 6.5 });
  const life = game.villageLife;
  run(game, 2);
  runUntilHour(game, 7);
  life.vanish('garrick');
  runUntilHour(game, 13);
  const data = JSON.parse(JSON.stringify(life.serialize()));
  assert.ok(JSON.stringify(data).length < 120000, 'the save stays small');
  const game2 = makeWorld({ hour: 13 });
  game2.clock.t = game.clock.t;
  const life2 = game2.villageLife;
  life2.deserialize(data);
  assert.equal(life2.book.list.length, life.book.list.length);
  assert.equal(life2.cases.get('garrick')?.status, life.cases.get('garrick')?.status);
  assert.ok(game2.entities.get('garrick').hidden && game2.entities.get('garrick').absent, 'still gone');
  assert.deepEqual(life2.sight.lastSeen('elda', 'pip')?.place, life.sight.lastSeen('elda', 'pip')?.place);
  assert.equal(life2.problems.filter((p) => p.status === 'open').length, life.problems.filter((p) => p.status === 'open').length);
  runUntilHour(game2, 21.5);
  assert.equal(life2.cases.get('garrick').status, 'missing', 'the story carries on after loading');
});

// ------------------------------------------------------------------ performance

test('eighteen villagers with errands and sightings cost well under 1 ms per frame', () => {
  const game = makeWorld({ hour: 6 });
  const life = game.villageLife;
  run(game, 900 * (15 / 24), 1 / 30);
  assert.ok(life.perf.n > 10000);
  assert.ok(life.perf.avg < 0.25, `average ${life.perf.avg.toFixed(4)} ms`);
});
