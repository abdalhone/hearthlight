// Round-3 interface (DESIGN.md §19.6): the view models behind saying anything to anyone,
// listening in, the morning's "while you slept", the eighteen in the People tab, her
// worth-it judgment, edited memories, and toasts that keep clear of bubbles on a phone.
// The DOM side is checked in a browser by scripts/ui3_check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TalkSession,
  normalizeReply,
  quietReply,
  moodExpression,
  canTalkTo,
  villagerRoster,
  closestToHer,
  villageFeeling,
  villagerBonds,
  villageTalkViews,
  topicWords,
  rumorsAboutPlayer,
  worthView,
  readWorth,
  editHistory,
  conversationSpeakers,
  listenLabel,
  exchangeLines,
  lineBeat,
  nightLines,
  namesTogether,
  firstName,
  opinionLevel,
  overlaps,
  placeStack,
} from '../src/ui/village_view.js';
import { bondOf } from '../src/ai/mind/relationships.js';

// ---------- a tiny world ----------

function npc(id, name, role, opinion = 30, extra = {}) {
  return { id, name, role, kind: 'human', profile: { id, name, role }, opinionOfPlayer: opinion, getDialogue() {}, x: 0, y: 0, ...extra };
}

function world(npcs, rels = []) {
  const ents = [{ id: 'player', name: 'Traveler', kind: 'human' }, { id: 'lyra', name: 'Lyra', kind: 'human', profile: { id: 'lyra' } }, ...npcs, { id: 'wolf1', name: 'Wolf', kind: 'monster', species: 'wolf' }];
  const map = new Map(rels.map((r) => [r.id, r]));
  const relationships = {
    all: () => [...map.values()],
    get: (id) => map.get(id) || null,
    bond: (id) => (map.get(id) ? bondOf(map.get(id)) : null),
  };
  const game = { entities: { all: () => ents, get: (id) => ents.find((e) => e.id === id) || null }, settings: { playerName: 'Wren' } };
  return { game, mind: { relationships } };
}

function rel(id, name, o = {}) {
  return { id, name, kind: 'human', npc: true, affinity: 0, trust: 40, respect: 30, familiarity: 50, fear: 0, tags: [], notes: [], ...o };
}

// Timers the test controls.
function clock() {
  const timers = [];
  return {
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, done: false });
      return timers.length - 1;
    },
    clearTimer: (id) => {
      if (timers[id]) timers[id].done = true;
    },
    fire() {
      for (const t of timers) if (!t.done) {
        t.done = true;
        t.fn();
      }
    },
  };
}

// ---------- saying anything to anyone ----------

test("the dialog's say field calls village.playerSays(npc, text) and shows the reply", async () => {
  const calls = [];
  const village = {
    playerSays(who, text) {
      calls.push({ who: who.id, text });
      return Promise.resolve({ lines: ['Well enough, love.', '  The stew needs salt.  '], mood: 'pleased', options: [{ id: 'bye', label: 'Goodbye' }] });
    },
  };
  const elda = npc('elda', 'Elda Thornbury', 'innkeeper');
  assert.equal(canTalkTo({ village }), true);
  assert.equal(canTalkTo({}), false);
  const talk = new TalkSession({ village, npc: elda });
  const r = await talk.send('  How are   you?  ');
  assert.deepEqual(calls, [{ who: 'elda', text: 'How are you?' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['Well enough, love.', 'The stew needs salt.']);
  assert.equal(r.expr, 'happy');
  assert.deepEqual(r.options, [{ id: 'bye', label: 'Goodbye' }]);
  assert.deepEqual(
    talk.history.map((x) => x.from),
    ['player', 'npc', 'npc'],
  );
  // Nothing to say is not sent.
  assert.equal(await talk.send('   '), null);
  assert.equal(calls.length, 1);
});

test('one line at a time; a slow or failing village still gets an answer from the villager', async () => {
  const c = clock();
  let resolve;
  const village = { playerSays: () => new Promise((r) => (resolve = r)) };
  const bram = npc('bram', 'Bram Ironhand', 'blacksmith');
  const talk = new TalkSession({ village, npc: bram, timeoutMs: 1000, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const late = [];
  talk.onLate = (r) => late.push(r);
  const p = talk.send('Nice forge.');
  assert.equal(talk.pending, true);
  assert.equal(await talk.send('Hello?'), null, 'a second line waits for the first');
  c.fire();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.why, 'timeout');
  assert.match(r.lines[0], /^Bram seems lost in thought/);
  assert.equal(talk.pending, false);
  // The answer that comes after all is still shown.
  resolve({ lines: ['Hm. It does the job.'] });
  await new Promise((r2) => setTimeout(r2, 0));
  assert.equal(late.length, 1);
  assert.deepEqual(late[0].lines, ['Hm. It does the job.']);

  const broken = new TalkSession({ village: { playerSays: () => Promise.reject(new Error('boom')) }, npc: bram });
  const e = await broken.send('Hi');
  assert.equal(e.ok, false);
  assert.deepEqual(e.lines, quietReply(bram));
  const throws = new TalkSession({
    village: {
      playerSays() {
        throw new Error('sync');
      },
    },
    npc: bram,
  });
  assert.equal((await throws.send('Hi')).ok, false);
  const empty = new TalkSession({ village: { playerSays: async () => ({ lines: [] }) }, npc: bram });
  assert.match((await empty.send('Hi')).lines[0], /catch that/);
});

test('replies in any shape become clean lines; moods become portrait expressions', () => {
  assert.deepEqual(normalizeReply('Just a line.').lines, ['Just a line.']);
  assert.deepEqual(normalizeReply(['a', '', { text: 'b' }]).lines, ['a', 'b']);
  assert.deepEqual(normalizeReply({ say: 'Claude said this' }).lines, ['Claude said this']);
  assert.deepEqual(normalizeReply(null).lines, []);
  assert.equal(normalizeReply({ lines: ['x'], options: [] }).options, null);
  assert.equal(moodExpression('annoyed'), 'angry');
  assert.equal(moodExpression({ name: 'worried' }), 'worried');
  assert.equal(moodExpression('quietly delighted'), 'happy');
  assert.equal(moodExpression('flummoxed'), null);
  assert.equal(firstName('Captain Rowan Vale'), 'Rowan');
  assert.equal(firstName('Garrick "Gale" Hale'), 'Garrick');
  assert.equal(firstName('Sister Aveline'), 'Aveline');
  assert.equal(firstName('Pip'), 'Pip');
});

// ---------- listen in ----------

test('listening in names the speakers and plays their lines in turn', () => {
  const elda = npc('elda', 'Elda Thornbury', 'innkeeper');
  const garrick = npc('garrick', 'Garrick "Gale" Hale', 'merchant');
  const { game } = world([elda, garrick]);
  const conv = { a: 'elda', b: garrick, topic: 'bread' };
  assert.deepEqual(
    conversationSpeakers(conv, game).map((e) => e.id),
    ['elda', 'garrick'],
  );
  assert.equal(listenLabel(conv, game), 'Listen in · Elda and Garrick');
  assert.equal(listenLabel(null, game), 'Listen in');
  const lines = exchangeLines(
    [
      { speaker: 'elda', text: 'Your bread is a crime.' },
      { speaker: 'b', text: 'My bread is a bargain.' },
      'Then a line with no speaker takes turns.',
      { speaker: garrick, text: '' },
    ],
    conv,
    game,
  );
  assert.deepEqual(
    lines.map((l) => `${l.name}: ${l.text}`),
    ['Elda: Your bread is a crime.', 'Garrick: My bread is a bargain.', 'Elda: Then a line with no speaker takes turns.'],
  );
  assert.equal(exchangeLines({ lines: [{ speaker: 'a', text: 'hi' }] }, conv, game)[0].speaker, elda);
  assert.ok(lineBeat('short') >= 2 && lineBeat('x'.repeat(400)) <= 7.5);
  assert.equal(namesTogether(['A', 'B', 'C']), 'A, B and C');
});

test('while you slept: the night summary in any shape becomes short lines', () => {
  assert.deepEqual(nightLines(['- Elda and Garrick argued.', '', '• Pip lost Biscuit, then found him.']), ['Elda and Garrick argued.', 'Pip lost Biscuit, then found him.']);
  assert.deepEqual(nightLines('One.\nTwo.'), ['One.', 'Two.']);
  assert.deepEqual(nightLines({ lines: [{ text: 'Three.' }] }), ['Three.']);
  assert.deepEqual(nightLines(null), []);
});

// ---------- the eighteen ----------

const EIGHTEEN = [
  ['hobb', 'Hobb Ambrel', 'chandler'],
  ['wenna', 'Wenna Ambrel', 'beekeeper'],
  ['elda', 'Elda Thornbury', 'innkeeper'],
  ['bram', 'Bram Ironhand', 'blacksmith'],
  ['pip', 'Pip', 'orphan'],
  ['rowan', 'Captain Rowan Vale', 'captain of the watch'],
  ['mira', 'Mira Fennick', 'herbalist'],
  ['tobias', 'Tobias Reed', 'farmer'],
  ['aveline', 'Sister Aveline', 'chapel keeper'],
  ['garrick', 'Garrick "Gale" Hale', 'merchant'],
  ['hess', 'Hesper "Hess" Morrow', 'huntress'],
  ['sabeth', 'Sabeth Coll', 'dyer'],
  ['alder', 'Alder Ashby', 'reeve'],
  ['petra', 'Petra Ashby', 'retired midwife'],
  ['tilly', 'Ottilie "Tilly" Ashby', "smith's apprentice"],
  ['tansy', 'Tansy Reed', 'chicken-keeper'],
  ['corran', 'Corran Dell', 'fisherman'],
  ['wys', 'Wystan "Wys" Pike', 'watchman'],
];

test('the People tab lists every villager present, best bond with her first', () => {
  const npcs = EIGHTEEN.map(([id, name, role], i) => npc(id, name, role, 20 + i * 4));
  const rels = [rel('hobb', 'Hobb Ambrel', { affinity: 90, trust: 85, familiarity: 100 }), rel('wenna', 'Wenna Ambrel', { affinity: 90, trust: 85, familiarity: 100 }), rel('mira', 'Mira Fennick', { affinity: 75, trust: 80, familiarity: 85 }), rel('alder', 'Alder Ashby', { affinity: 10, trust: 35, familiarity: 80 }), rel('maren', 'Maren', { npc: true, absent: true, affinity: 95 }), rel('player', 'Wren', { npc: false }), { id: 'species:wolf', name: 'wolves', kind: 'group', npc: false, affinity: -50 }];
  const { game, mind } = world(npcs, rels);
  const roster = villagerRoster(game, mind);
  const ids = roster.map((r) => r.id);
  for (const [id] of EIGHTEEN) assert.ok(ids.includes(id), `${id} is listed`);
  assert.ok(ids.includes('maren'), 'a villager she knows who is away is listed too');
  for (const id of ['player', 'lyra', 'wolf1', 'species:wolf']) assert.ok(!ids.includes(id), `${id} is not a villager`);
  assert.equal(roster.length, 19);
  assert.equal(roster[0].bond.label, 'Kindred spirit');
  assert.ok(['hobb', 'wenna'].includes(roster[0].id));
  const rowan = roster.find((r) => r.id === 'rowan');
  assert.equal(rowan.first, 'Rowan');
  assert.equal(rowan.rel, null);
  assert.equal(rowan.opinionLevel.label, 'Neutral');
  const close = closestToHer(roster, 5);
  assert.deepEqual(close.map((c) => c.id).slice(0, 3).sort(), ['hobb', 'mira', 'wenna']);
  assert.ok(!close.some((c) => c.id === 'alder'));
});

test('how the village feels about the player, in a sentence and a count', () => {
  const ops = [90, 80, 60, 55, 52, 40, 10];
  const roster = ops.map((o, i) => ({ id: `v${i}`, first: `V${i}`, opinion: o, opinionLevel: opinionLevel(o) }));
  const f = villageFeeling(roster);
  assert.equal(f.count, 7);
  assert.equal(f.counts.fond, 2);
  assert.equal(f.counts.friendly, 3);
  assert.equal(f.counts.hostile, 1);
  assert.match(f.sentence, /^Most of Hearthvale is friendly toward you\./);
  assert.match(f.sentence, /V0, V1 and V2 think well of you/);
  assert.match(f.sentence, /V6 keeps their distance/);
  assert.equal(villageFeeling([]).count, 0);
  assert.equal(opinionLevel(null), null);
});

test('village talk reads like news: "Lyra and Mira talked about Rowan"', () => {
  const names = { lyra: 'Lyra', mira: 'Mira', rowan: 'Rowan', elda: 'Elda', garrick: 'Garrick', player: 'you' };
  const nameOf = (id) => names[id] || '';
  const log = [
    { t: 10, day: 3, a: 'elda', b: 'garrick', topic: 'small_talk' },
    { t: 30, day: 3, a: 'lyra', b: 'mira', topic: 'rowan', summary: 'Mira asked if he had eaten.' },
    { t: 20, day: 2, a: 'elda', b: 'garrick', topic: 'player' },
  ];
  const v = villageTalkViews(log, { nameOf, today: 3 });
  assert.deepEqual(
    v.map((x) => x.text),
    ['Lyra and Mira talked about Rowan', 'Elda and Garrick talked about you', 'Elda and Garrick passed the time of day'],
  );
  assert.equal(v[0].when, 'today');
  assert.equal(v[0].summary, 'Mira asked if he had eaten.');
  assert.equal(v[1].when, 'yesterday');
  assert.equal(topicWords('the_bandits'), 'the bandits');
  assert.equal(topicWords('Sheaf Moot'), 'the Sheaf Moot');
  assert.deepEqual(villageTalkViews(null), []);
  const rumors = rumorsAboutPlayer({ rumors: [{ about: 'player', text: 'Heard you pulled the wolf off Tansy.', valence: 0.5, t: 2 }, { about: 'bram', text: 'not about you' }] });
  assert.deepEqual(rumors, [{ text: 'Heard you pulled the wolf off Tansy.', tone: 'good', heardBy: 0 }]);
  const village = { bond: (a, b) => ({ elda: { pip: { affinity: 80, tags: ['ward'] }, garrick: { affinity: 50, tags: ['friend'] }, rowan: { affinity: -30, tags: [] } } })[a]?.[b] || { affinity: 0, tags: [] } };
  const b = villagerBonds(village, 'elda', ['elda', 'pip', 'garrick', 'rowan', 'mira'], (id) => id.toUpperCase());
  assert.deepEqual(b.close, [{ id: 'pip', name: 'PIP', tag: 'ward' }, { id: 'garrick', name: 'GARRICK', tag: 'friend' }]);
  assert.deepEqual(b.odds, [{ id: 'rowan', name: 'ROWAN', tag: '' }]);
  assert.deepEqual(villagerBonds(null, 'elda', []), { close: [], odds: [] });
});

// ---------- worth it ----------

test("her worth-it judgment as a clear breakdown of what staying gives and costs her", () => {
  const w = {
    stay: 40,
    cost: 10,
    net: 30,
    reasons: [
      { text: "You're the best thread to Maren I have.", weight: 18 },
      { text: 'the hearthwatch wage', weight: 6 },
      { text: 'You pushed after I said no.', weight: -7 },
      { text: 'time away from Mam and Da', weight: -3 },
      { text: '', weight: 5 },
    ],
  };
  const v = worthView(w);
  assert.equal(v.stay, 40);
  assert.equal(v.cost, 10);
  assert.equal(v.tone, 'good');
  assert.match(v.verdict, /clearly worth it/);
  assert.deepEqual(
    v.gives.map((r) => r.text),
    ["You're the best thread to Maren I have.", 'the hearthwatch wage'],
  );
  assert.equal(v.gives[0].quote, true, 'her own words are quoted');
  assert.equal(v.gives[1].quote, false, 'a bare label is not');
  assert.deepEqual(
    v.costs.map((r) => r.text),
    ['You pushed after I said no.', 'time away from Mam and Da'],
  );
  assert.equal(v.gives[0].share, 1);
  // Totals derived from the reasons when worth() gives none.
  const d = worthView({ reasons: [{ text: 'a', weight: 2 }, { text: 'b', weight: -6 }] });
  assert.equal(d.stay, 2);
  assert.equal(d.cost, 6);
  assert.equal(d.tone, 'bad');
  assert.equal(worthView(null), null);
  assert.match(worthView({ stay: 0, cost: 0, reasons: [] }).verdict, /not weighed/);
  // Read from the mind wherever it lives, without throwing.
  assert.equal(readWorth({ autonomy: { worth: () => w } }), w);
  assert.equal(readWorth({ worth: () => w }), w);
  assert.equal(
    readWorth({
      autonomy: {
        worth() {
          throw new Error('x');
        },
      },
    }),
    null,
  );
  assert.equal(readWorth({}), null);
});

// ---------- edited memories ----------

test('an edited memory shows its earlier versions, newest first, and her reasons', () => {
  const DAY = 900;
  const m = {
    text: 'The stranger was exhausted at the well, not rude.',
    edited: true,
    history: [
      { t: DAY * 0.5, text: 'The stranger was rude to me at the well.', importance: 4, why: '' },
      { t: DAY * 2.2, text: 'The stranger was curt at the well.', importance: 5, why: 'Elda said they had not slept in days.' },
    ],
  };
  const e = editHistory(m, 3);
  assert.equal(e.edited, true);
  assert.equal(e.count, 2);
  assert.equal(e.versions[0].text, 'The stranger was curt at the well.');
  assert.equal(e.versions[0].when, 'today');
  assert.equal(e.versions[1].when, 'day 1');
  assert.equal(e.why, 'Elda said they had not slept in days.');
  assert.equal(editHistory({ text: 'plain' }), null);
  assert.equal(editHistory({ text: 'x', edited: true }).count, 0);
  assert.ok(editHistory({ text: 'x', history: [{ text: 'old' }] }));
});

// ---------- toasts and bubbles on a phone ----------

test('toasts never overlap bubbles, the quest line or the HUD on a phone viewport', () => {
  const W = 390;
  const H = 844;
  const hud = [
    { x: 8, y: 8, w: 212, h: 168 }, // the cards
    { x: 268, y: 8, w: 114, h: 160 }, // place and buttons
    { x: 75, y: 172, w: 240, h: 30 }, // the quest line
    { x: 160, y: 756, w: 70, h: 70 }, // the orders button
  ];
  const bubbles = [
    { x: 60, y: 250, w: 200, h: 56 },
    { x: 150, y: 330, w: 180, h: 70 },
  ];
  const player = { x: 180, y: 400, w: 30, h: 50 };
  const obstacles = [...hud, ...bubbles, player];
  const w = 366;
  const h = 150;
  const spot = placeStack({ w, h, viewW: W, top: 8, bottom: H - 8, obstacles });
  assert.ok(spot, 'a free slot is found');
  const stack = { x: spot.x, y: spot.y, w, h };
  for (const o of obstacles) assert.equal(overlaps(stack, o, 6), false, `clear of ${JSON.stringify(o)}`);
  assert.ok(stack.x >= 0 && stack.x + w <= W && stack.y >= 0 && stack.y + h <= H);
  // While its slot stays free, the stack stays put.
  const again = placeStack({ w, h, viewW: W, top: 8, bottom: H - 8, obstacles, prefer: spot.y });
  assert.equal(again.y, spot.y);
  // A bubble moving into the slot moves the stack.
  const moved = placeStack({ w, h, viewW: W, top: 8, bottom: H - 8, obstacles: [...obstacles, { x: 0, y: spot.y, w: W, h: 20 }], prefer: spot.y });
  assert.ok(!moved || !overlaps({ x: moved.x, y: moved.y, w, h }, { x: 0, y: spot.y, w: W, h: 20 }, 6));
  // A screen full of bubbles: nowhere to go (the toasts wait instead of covering one).
  assert.equal(placeStack({ w, h, viewW: W, top: 8, bottom: H - 8, obstacles: [{ x: 0, y: 0, w: W, h: H }] }), null);
  // Without obstacles the stack sits right under the top.
  assert.equal(placeStack({ w, h, viewW: W, top: 214, bottom: H - 8 }).y, 214);
});

test('speech bubbles find room around fixed HUD boxes instead of hiding under them', async () => {
  const { stackRects } = await import('../src/render/text_layout.js');
  const hud = { x: 0, y: 0, w: 390, h: 120 }; // the phone's top band (cards, quest line)
  const bubble = { x: 120, y: 90, w: 160, h: 40, ax: 200, tailPad: 10 };
  const other = { x: 40, y: 300, w: 100, h: 30 };
  stackRects([hud, bubble, other], 3, 4, 4, 686, 390, 1);
  assert.deepEqual(hud, { x: 0, y: 0, w: 390, h: 120 }, 'the HUD box never moves');
  assert.ok(bubble.y >= hud.y + hud.h, `the bubble clears the HUD band (y=${bubble.y})`);
  assert.deepEqual(other, { x: 40, y: 300, w: 100, h: 30 }, 'a bubble already clear stays put');
  // Two HUD boxes that touch are not pushed apart from each other.
  const a = { x: 0, y: 0, w: 200, h: 50 };
  const b = { x: 196, y: 0, w: 100, h: 50 };
  stackRects([a, b], 2, 4, 4, 686, 390, 2);
  assert.equal(b.x, 196);
});
