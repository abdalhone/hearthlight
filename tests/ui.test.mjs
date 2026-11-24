import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionForKey, KEYMAP, GAMEPAD_BUTTONS, applyDeadzone, joystickVector, combineMove, shouldPreventDefault, isTextTarget, Input } from '../src/core/input.js';
import {
  pickNewer,
  parseSave,
  serializeSave,
  contentHash,
  cloudDecision,
  buildMindExport,
  readMindExport,
  isValidSave,
  CLOUD_DOC_LIMIT,
  CLOUD_HIDDEN_MIN_MS,
  SaveManager,
} from '../src/core/save.js';
import {
  fmtInt,
  hpText,
  frac,
  pctStr,
  truncate,
  bytesLabel,
  utf8Bytes,
  importanceStars,
  starString,
  dayLabel,
  stanceLabel,
  lyraStatusLine,
  weatherIconKey,
  weatherLabel,
  moodEmoji,
  moodToExpression,
  bondLabel,
  affinityWords,
  listFrom,
  filterMemories,
  groupByDay,
  sortItems,
  isGiftable,
  isUsable,
  hash32,
  voicePitch,
  gainText,
  parseList,
  listToText,
  cleanLine,
} from '../src/ui/format.js';
import { ICONS, iconSvg, iconSize } from '../src/ui/icons.js';
import { COMMANDS, JOBS, ACK_LINES, pickAck, CHIPS, HOW_TO_PLAY, REJOIN } from '../src/ui/content.js';
import {
  COMPANIONSHIP_STATES,
  readCompanionship,
  companionshipOf,
  companionshipLabel,
  barMode,
  companionshipReason,
  playerRelation,
  trustWords,
  fearWords,
  sleepsAt,
  deedLabel,
  formatSeverity,
  severityTone,
  clockLabel,
  hourLabel,
  whenLabel,
  ledgerEntries,
  ledgerViews,
  ledgerTally,
  promiseViews,
  planViews,
  knowledgeKind,
  sourceLabel,
  confidenceWord,
  groupKnowledge,
  knowledgeCounts,
  lifeTimeline,
  ageLabel,
  memoryRefs,
  findMemory,
  memoryChipLabel,
  lastSentences,
  farewellText,
  requestAnswer,
  directiveWords,
  DEED_LABELS,
  dayOf,
  handReach,
  reachNote,
  counterLabel,
  nowParagraph,
  joinWords,
} from '../src/ui/lyra_view.js';
import { personArtKey, ABSENT_LOOKS } from '../src/ui/art.js';
import { UI } from '../src/ui/ui.js';
import { SCALES, scaleNote, chordNotes, isChordStep, nextMelodyStep, TRACKS } from '../src/ui/music.js';
import { SFX_NAMES } from '../src/ui/sfx.js';
import { spatialize, chooseTrack, Audio } from '../src/core/audio.js';
import { ITEMS } from '../src/entities/items.js';

// ---------- input ----------

test('keyboard mapping follows DESIGN §14', () => {
  const expect = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    KeyJ: 'attack', Space: 'attack', KeyK: 'dodge', ShiftLeft: 'dodge', KeyE: 'interact',
    KeyT: 'talk', Enter: 'talk', Tab: 'mind', KeyM: 'mind', KeyI: 'inventory', Escape: 'menu',
    Numpad1: 'cmd1', Numpad5: 'cmd5',
    // DESIGN §22.4: the number row casts weaves; B opens the Spellbook; Q / R pick the slot.
    Digit1: 'weave1', Digit4: 'weave4', Digit6: 'weave6', KeyB: 'spellbook', KeyQ: 'slot_prev', KeyR: 'slot_next',
  };
  for (const [code, action] of Object.entries(expect)) assert.equal(actionForKey(code), action, code);
  // Asking Lyra moved to Alt (Option) + 1–5.
  for (let i = 1; i <= 5; i++) assert.equal(actionForKey(`Digit${i}`, String(i), true), `cmd${i}`);
  assert.equal(actionForKey('KeyE', 'e', true), null, 'other Alt chords stay with the browser');
  assert.equal(actionForKey('KeyZ'), null);
  assert.equal(actionForKey('', 'e'), 'interact');
  assert.equal(actionForKey('', ' '), 'attack');
  assert.equal(actionForKey('', '3'), 'weave3');
  assert.equal(actionForKey('', 'Escape'), 'menu', 'named keys fall back to the matching code');
  assert.equal(actionForKey('', 'F5'), null);
  assert.ok(Object.isFrozen(KEYMAP));
});

test('gamepad buttons: A attack, B dodge, X interact, Y talk, Start menu', () => {
  assert.equal(GAMEPAD_BUTTONS[0], 'attack');
  assert.equal(GAMEPAD_BUTTONS[1], 'dodge');
  assert.equal(GAMEPAD_BUTTONS[2], 'interact');
  assert.equal(GAMEPAD_BUTTONS[3], 'talk');
  assert.equal(GAMEPAD_BUTTONS[9], 'menu');
});

test('browser defaults are blocked only for game keys', () => {
  assert.ok(shouldPreventDefault('Tab'));
  assert.ok(shouldPreventDefault('Space'));
  assert.ok(shouldPreventDefault('ArrowLeft'));
  assert.ok(!shouldPreventDefault('KeyR'));
  assert.ok(!shouldPreventDefault('F5'));
});

test('deadzone ignores drift and keeps full range', () => {
  assert.deepEqual(applyDeadzone(0.1, 0.1), { x: 0, y: 0 });
  const full = applyDeadzone(1, 0);
  assert.ok(Math.abs(full.x - 1) < 1e-9 && full.y === 0);
  const mid = applyDeadzone(0.6, 0);
  assert.ok(mid.x > 0 && mid.x < 0.6);
});

test('joystick vector is clamped to length 1', () => {
  const v = joystickVector(200, 0, 50);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  const z = joystickVector(3, 2, 50);
  assert.deepEqual(z, { x: 0, y: 0 });
  const d = joystickVector(30, 30, 50);
  assert.ok(d.x > 0 && d.y > 0 && Math.hypot(d.x, d.y) <= 1);
});

test('digital + analog movement combine and normalize', () => {
  const diag = combineMove(false, true, false, true);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9);
  assert.deepEqual(combineMove(true, true, false, false), { x: 0, y: 0 });
  const both = combineMove(false, true, false, false, 0.5, 0);
  assert.equal(both.x, 1);
});

test('text targets are recognised so typing never moves the player', () => {
  assert.ok(isTextTarget({ tagName: 'INPUT', type: 'text' }));
  assert.ok(isTextTarget({ tagName: 'INPUT', type: 'search' }));
  assert.ok(isTextTarget({ tagName: 'TEXTAREA' }));
  assert.ok(!isTextTarget({ tagName: 'INPUT', type: 'range' }));
  assert.ok(!isTextTarget({ tagName: 'BUTTON' }));
  assert.ok(!isTextTarget(null));
});

test('Input works without a browser: presses, virtual buttons, enabled flag, edges', () => {
  const inp = new Input({});
  inp.press('interact');
  assert.ok(inp.pressed('interact'));
  inp.endFrame();
  assert.ok(!inp.pressed('interact'));
  inp.setVirtual('attack', true);
  assert.ok(inp.pressed('attack') && inp.down('attack'));
  inp.endFrame();
  assert.ok(!inp.pressed('attack') && inp.down('attack'));
  inp.setVirtual('attack', false);
  assert.ok(!inp.down('attack'));
  inp.setTouchVector(0.5, 0);
  assert.equal(inp.moveVector().x, 0.5);
  inp.enabled = false;
  assert.deepEqual(inp.moveVector(), { x: 0, y: 0 });
  inp.press('menu');
  assert.ok(!inp.pressed('menu'), 'game input ignores presses while disabled');
  assert.ok(inp.uiPressed('menu'), 'the UI still sees its hotkeys');
  inp.consume('menu');
  assert.ok(!inp.uiPressed('menu'));
});

// ---------- saving ----------

const save = (savedAt, extra = {}) => ({ version: 1, savedAt, player: { x: 1 }, ...extra });

test('load picks the newer of local and cloud', () => {
  assert.equal(pickNewer(save(100), save(200)).source, 'cloud');
  assert.equal(pickNewer(save(300), save(200)).source, 'local');
  assert.equal(pickNewer(save(200), save(200)).source, 'local', 'ties keep the device copy');
  assert.equal(pickNewer(null, save(5)).source, 'cloud');
  assert.equal(pickNewer(save(5), null).source, 'local');
  assert.equal(pickNewer(null, null).data, null);
  assert.equal(pickNewer({ junk: true }, save(1)).source, 'cloud', 'invalid local never wins');
  assert.equal(pickNewer(save(9), { version: 1 }).source, 'local', 'cloud without a player is invalid');
});

test('saves never contain the API key', () => {
  const json = serializeSave({ version: 1, player: {}, settings: { apiKey: 'sk-secret', name: 'x' }, apiKey: 'sk-2', nested: [{ api_key: 'k' }] });
  assert.ok(!json.includes('sk-secret'));
  assert.ok(!json.includes('sk-2'));
  assert.ok(!json.includes('"api_key"'));
  assert.ok(json.includes('"name":"x"'));
});

test('parseSave validates and survives garbage', () => {
  assert.equal(parseSave('{bad json'), null);
  assert.equal(parseSave(''), null);
  assert.equal(parseSave('[]'), null);
  assert.ok(parseSave(JSON.stringify(save(1))));
  assert.ok(isValidSave(save(1)));
  assert.ok(!isValidSave({ version: '1', player: {} }));
});

test('content hash ignores the timestamp but sees real changes', () => {
  assert.equal(contentHash(save(1, { a: 1 })), contentHash(save(999, { a: 1 })));
  assert.notEqual(contentHash(save(1, { a: 1 })), contentHash(save(1, { a: 2 })));
});

test('cloud writes are rate limited, size checked and skipped when unchanged', () => {
  const base = { now: 1_000_000, lastCloudAt: 0, lastCloudHash: 'aaaa', hash: 'bbbb', bytes: 1000 };
  assert.ok(cloudDecision({ ...base, reason: 'manual' }).ok);
  assert.equal(cloudDecision({ ...base, reason: 'manual', hash: 'aaaa' }).why, 'unchanged');
  assert.equal(cloudDecision({ ...base, reason: 'manual', bytes: CLOUD_DOC_LIMIT + 1 }).why, 'too_large');
  assert.equal(cloudDecision({ ...base, reason: 'hidden', lastCloudAt: base.now - CLOUD_HIDDEN_MIN_MS + 1000 }).why, 'rate');
  assert.ok(cloudDecision({ ...base, reason: 'hidden', lastCloudAt: base.now - CLOUD_HIDDEN_MIN_MS - 1 }).ok);
  assert.equal(cloudDecision({ ...base, reason: 'sleep', lastCloudAt: base.now - 2000 }).why, 'rate');
  assert.equal(cloudDecision({ ...base, reason: 'manual', inFlight: true }).why, 'busy');
});

test('mind export round-trips, and raw mind objects are accepted', () => {
  const mind = { soul: { name: 'Lyra' }, memory: [{ text: 'met you on the road' }], apiKey: 'nope' };
  const json = buildMindExport(mind, { name: 'Lyra', day: 3, exportedAt: 5 });
  assert.ok(!json.includes('nope'));
  const back = readMindExport(json);
  assert.ok(back.ok);
  assert.deepEqual(back.mind.memory, mind.memory);
  assert.ok(readMindExport({ soul: {}, diary: [] }).ok);
  assert.ok(!readMindExport('not json').ok);
  assert.ok(!readMindExport('{"hello":1}').ok);
  assert.ok(!readMindExport('{"kind":"hearthlight-mind"}').ok);
});

test('SaveManager exports and imports a mind through the companion', () => {
  let restored = null;
  const game = {
    settings: {},
    clock: { day: 2 },
    bus: { on: () => () => {} },
    companion: { name: 'Lyra', mind: { serialize: () => ({ soul: { name: 'Lyra' }, diary: [] }), deserialize: (d) => (restored = d) } },
  };
  const sm = new SaveManager(game);
  const json = sm.exportMind();
  assert.ok(json.includes('hearthlight-mind'));
  const r = sm.importMind(json);
  assert.ok(r.ok, r.message);
  assert.deepEqual(restored, { soul: { name: 'Lyra' }, diary: [] });
  assert.ok(!sm.importMind('garbage').ok);
});

// ---------- formatting ----------

test('number and bar helpers', () => {
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt(-1200), '-1,200');
  assert.equal(hpText(41.2, 60), '42/60');
  assert.equal(hpText(-3, 60), '0/60');
  assert.equal(frac(5, 0), 0);
  assert.equal(frac(15, 10), 1);
  assert.equal(pctStr(1, 3), '33%');
  assert.equal(bytesLabel(800), '800 B');
  assert.equal(bytesLabel(2048), '2.0 KB');
  assert.equal(bytesLabel(3 * 1024 * 1024), '3.0 MB');
  assert.equal(utf8Bytes('aé€😀'), 1 + 2 + 3 + 4);
});

test('truncate keeps words whole', () => {
  assert.equal(truncate('short', 10), 'short');
  const t = truncate('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(t.length <= 20 && t.endsWith('…'));
  assert.ok(!/\s…$/.test(t));
});

test('stars, days, stances and status lines', () => {
  assert.equal(importanceStars(1), 1);
  assert.equal(importanceStars(10), 5);
  assert.equal(starString(6), '★★★☆☆');
  assert.equal(dayLabel(3, 3), 'Today · Day 3');
  assert.equal(dayLabel(2, 3), 'Yesterday · Day 2');
  assert.equal(dayLabel(1, 3), 'Day 1');
  assert.equal(stanceLabel('attack'), 'attack mode');
  assert.equal(lyraStatusLine('following you', 'attack'), 'following you · attack mode');
  assert.equal(lyraStatusLine('', 'passive'), 'nearby · passive');
  assert.match(lyraStatusLine('x', 'defend', true), /knocked out/);
});

test('weather icons follow the time of day', () => {
  assert.equal(weatherIconKey('clear', false), 'sun');
  assert.equal(weatherIconKey('clear', true), 'moon');
  assert.equal(weatherIconKey('rain', true), 'rain');
  assert.equal(weatherIconKey('cloudy', true), 'cloud_night');
  assert.equal(weatherLabel('clear', true), 'Starlit');
  assert.equal(weatherLabel('fog', false), 'Fog');
  for (const k of ['sun', 'moon', 'rain', 'cloud', 'cloud_night', 'fog']) assert.ok(ICONS[k], k);
});

test('mood helpers pick emoji and portrait expressions', () => {
  assert.equal(moodEmoji({ label: 'content', emoji: '🌙' }), '🌙');
  assert.equal(moodEmoji({ label: 'anxious' }), '😟');
  assert.equal(moodEmoji('furious'), '😠');
  assert.equal(moodEmoji(null), '🙂');
  assert.equal(moodToExpression({ valence: 0 }, { anger: 0.8, joy: 0.5 }), 'angry');
  assert.equal(moodToExpression({ valence: 0 }, { joy: 0.6 }), 'happy');
  assert.equal(moodToExpression({ valence: 0 }, { affection: 0.7, joy: 0.5 }), 'love');
  assert.equal(moodToExpression({ valence: 0 }, {}, { energy: 0.1 }), 'sleepy');
  assert.equal(moodToExpression({ valence: 0.6 }, {}), 'happy');
  assert.equal(moodToExpression({ valence: -0.3 }, {}), 'worried');
  assert.equal(moodToExpression(null, null, null), 'neutral');
});

test('bond labels and affinity words', () => {
  assert.equal(bondLabel(0), 'Stranger');
  assert.equal(bondLabel(5), 'Kindred spirit');
  assert.equal(bondLabel(9), 'Kindred spirit');
  assert.equal(affinityWords(80), 'adores');
  assert.equal(affinityWords(0), 'feels neutral about');
  assert.equal(affinityWords(-90), 'despises');
});

test('listFrom reads stores of any common shape', () => {
  assert.deepEqual(listFrom([1, 2]), [1, 2]);
  assert.deepEqual(listFrom({ all: () => [3] }), [3]);
  assert.deepEqual(listFrom({ entries: [4] }), [4]);
  assert.deepEqual(listFrom({ list: () => new Set([5]) }), [5]);
  assert.deepEqual(listFrom(new Map([['a', 6]])), [6]);
  assert.deepEqual(listFrom({ all: () => { throw new Error('x'); }, items: [7] }), [7]);
  assert.deepEqual(listFrom(null), []);
});

test('memory search matches all words across text, tags, people and place; newest first', () => {
  const list = [
    { text: 'Bram showed me his forge', t: 10, day: 1, tags: ['work'], about: ['bram'] },
    { text: 'Wolves on the road at night', t: 30, day: 2, tags: ['danger'], location: 'kings_road' },
    { text: 'Pip asked about magic', t: 20, day: 2, about: ['pip'] },
    { text: '' },
    null,
  ];
  assert.deepEqual(filterMemories(list, '').map((m) => m.t), [30, 20, 10]);
  assert.deepEqual(filterMemories(list, 'bram').map((m) => m.t), [10]);
  assert.deepEqual(filterMemories(list, 'kings_road wolves').map((m) => m.t), [30]);
  assert.deepEqual(filterMemories(list, 'DANGER').map((m) => m.t), [30]);
  assert.equal(filterMemories(list, 'dragon').length, 0);
  const groups = groupByDay(filterMemories(list, ''));
  assert.deepEqual(groups.map((g) => g.day), [2, 1]);
  assert.equal(groups[0].items.length, 2);
});

test('inventory helpers sort usefully and know what can be gifted or eaten', () => {
  const list = Object.keys(ITEMS).map((id) => ({ id, qty: 1, def: ITEMS[id] }));
  const sorted = sortItems(list);
  assert.equal(sorted[0].def.type, 'potion');
  assert.equal(sorted[sorted.length - 1].id, 'coin');
  assert.ok(isGiftable(ITEMS.moonpetal));
  assert.ok(!isGiftable(ITEMS.coin));
  assert.ok(!isGiftable(ITEMS.ruins_key));
  assert.ok(!isGiftable(ITEMS.maren_journal));
  assert.ok(isUsable(ITEMS.bread));
  assert.ok(isUsable(ITEMS.potion));
  assert.ok(!isUsable(ITEMS.wood));
});

test('misc text helpers', () => {
  assert.equal(hash32('abc'), hash32('abc'));
  assert.notEqual(hash32('abc'), hash32('abd'));
  const p = voicePitch('bram');
  assert.ok(p >= 0.8 && p <= 1.25);
  assert.equal(voicePitch('bram'), p);
  assert.equal(gainText(5, 'Wood'), '+5 Wood');
  assert.deepEqual(parseList('a, b\n c;;d'), ['a', 'b', 'c', 'd']);
  assert.equal(listToText(['x', { text: 'y' }]), 'x\ny');
  assert.equal(cleanLine('  hi \n there  '), 'hi there');
});

// ---------- icons & content ----------

test('every icon grid is rectangular and uses known colors', () => {
  for (const [name, grid] of Object.entries(ICONS)) {
    const w = grid[0].length;
    for (const row of grid) assert.equal(row.length, w, `${name} rows must be equal width`);
    const svg = iconSvg(name);
    assert.ok(svg.startsWith('<svg') && svg.includes('<rect'), name);
    assert.deepEqual(iconSize(name), { w, h: grid.length });
  }
  assert.equal(iconSvg('nope'), '');
});

test('orders, jobs and acknowledgements are complete', () => {
  assert.deepEqual(COMMANDS.map((c) => c.key), ['1', '2', '3', '4', '5']);
  assert.deepEqual(COMMANDS.map((c) => c.id), ['follow', 'stay', 'attack', 'defend', 'passive']);
  for (const c of COMMANDS) assert.ok(ICONS[c.icon], c.icon);
  assert.deepEqual(
    JOBS.map((j) => j.id).sort(),
    ['chop_wood', 'collect_loot', 'cook', 'fish', 'forage', 'gather_herbs', 'mine_ore'].sort(),
  );
  for (const j of JOBS) assert.ok(ICONS[j.icon], j.icon);
  for (const k of ['follow', 'stay', 'attack', 'defend', 'passive', 'job', 'stop_job']) assert.ok(ACK_LINES[k].length >= 3, k);
  const a = pickAck('follow', 0);
  const b = pickAck('follow', 0);
  assert.notEqual(a, b, 'never the same line twice in a row');
  assert.equal(pickAck('nope'), '');
  for (const k of ['refused', 'failed', 'rejoin', 'give', 'use', 'counter']) assert.ok(ACK_LINES[k]?.length >= 2, k);
  assert.ok(CHIPS.length >= 4 && CHIPS.includes('How are you?'));
  assert.ok(HOW_TO_PLAY.length >= 5);
  assert.ok(ICONS[REJOIN.icon] && REJOIN.action === 'rejoin');
});

test('the bar asks: labels and hints are requests, never orders', () => {
  for (const c of COMMANDS) {
    assert.match(c.hint, /^Ask her/, c.id);
    assert.ok(!/order/i.test(c.hint + c.label), c.id);
  }
  const all = JSON.stringify({ ACK_LINES, HOW_TO_PLAY });
  assert.ok(!/\byes,? (master|sir|ma'am)\b/i.test(all));
});

// ---------- audio ----------

test('every sound named in the contract has a recipe', () => {
  const names = 'swing hit hurt bolt bolt_hit heal door_open door_close pickup coin chop mine splash step levelup ui_click ui_open ui_close talk_blip death bow dodge eat quest downed revive sleep error magic'.split(' ');
  for (const n of names) assert.ok(SFX_NAMES.includes(n), n);
});

test('positional falloff and panning', () => {
  assert.equal(spatialize(100, 100, 100, 100, 160).gain, 1);
  const far = spatialize(1000, 100, 100, 100, 160);
  assert.equal(far.gain, 0);
  const mid = spatialize(250, 100, 100, 100, 160);
  assert.ok(mid.gain > 0 && mid.gain < 1);
  assert.ok(mid.pan > 0);
  assert.ok(spatialize(-50, 100, 100, 100, 160).pan < 0);
});

test('music follows state, danger and the hour', () => {
  assert.equal(chooseTrack({ state: 'title' }), 'title');
  assert.equal(chooseTrack({ state: 'sleeping' }), 'none');
  assert.equal(chooseTrack({ state: 'playing', engaged: true, hour: 12 }), 'combat');
  assert.equal(chooseTrack({ state: 'playing', engaged: false, hour: 12, phase: 'day' }), 'day');
  assert.equal(chooseTrack({ state: 'playing', engaged: false, hour: 23, phase: 'night' }), 'night');
  assert.equal(chooseTrack({ state: 'playing', engaged: false, hour: 4 }), 'night');
});

test('music theory helpers', () => {
  assert.equal(scaleNote(60, SCALES.major, 0), 60);
  assert.equal(scaleNote(60, SCALES.major, 7), 72);
  assert.equal(scaleNote(60, SCALES.major, -1), 59);
  assert.deepEqual(chordNotes(60, SCALES.major, 0), [60, 64, 67]);
  assert.deepEqual(chordNotes(57, SCALES.minor, 0), [57, 60, 64]);
  assert.ok(isChordStep(9, 2));
  assert.ok(!isChordStep(3, 0));
  let s = 9;
  for (let i = 0; i < 200; i++) {
    s = nextMelodyStep(s, i % 7, i % 2 === 0, Math.random, 5, 13);
    assert.ok(s >= 5 && s <= 13);
  }
  assert.deepEqual(Object.keys(TRACKS).sort(), ['combat', 'day', 'night', 'title']);
});

test('audio is silent and harmless before unlock', () => {
  const a = new Audio({ settings: {}, state: 'title' });
  a.play('hit', { x: 0, y: 0 });
  a.setMusic('day');
  a.applyVolumes();
  a.update(1 / 60);
  assert.equal(a.ctx, null);
});

// ---------- Lyra lives for herself (§16) ----------

const DAY = 900;

test('companionship is read defensively and gone wins from the flags', () => {
  assert.equal(readCompanionship(null), 'together');
  assert.equal(readCompanionship({ companionship: 'wary' }), 'wary');
  assert.equal(readCompanionship({ companionship: { state: 'left' } }), 'left');
  assert.equal(readCompanionship({ companionship: 'bogus', autonomy: { companionship: 'apart' } }), 'apart');
  assert.equal(readCompanionship({ get companionship() { throw new Error('x'); } }), 'together');
  assert.equal(companionshipOf({ flags: { lyra_gone: { day: 3 } }, companion: { mind: { companionship: 'together' } } }), 'gone');
  assert.equal(companionshipOf({ flags: {}, companion: null }), 'together');
  assert.equal(companionshipOf({ flags: {}, companion: { mind: { companionship: 'wary' } } }), 'wary');
});

test('companionship labels and what the bar offers in each state', () => {
  assert.deepEqual(COMPANIONSHIP_STATES, ['together', 'wary', 'apart', 'left', 'gone']);
  assert.deepEqual(COMPANIONSHIP_STATES.map(companionshipLabel), ['With you', 'Wary of you', 'Living her own life', 'Left you', 'Cut you off']);
  assert.equal(companionshipLabel('nonsense'), 'With you');
  assert.deepEqual(COMPANIONSHIP_STATES.map(barMode), ['full', 'full', 'collapsed', 'collapsed', 'hidden']);
  assert.equal(companionshipReason({ autonomy: { reason: '  You hit me.  ' } }), 'You hit me.');
  assert.equal(companionshipReason({}), '');
});

test('trust and fear toward the player, in numbers and words', () => {
  assert.equal(playerRelation({}), null);
  const mind = { relationships: { get: (id) => (id === 'player' ? { trust: 140, fear: -5, affinity: '-30', respect: null } : null) } };
  assert.deepEqual(playerRelation(mind), { trust: 100, fear: 0, affinity: -30, respect: 50, familiarity: 0 });
  assert.equal(trustWords(90), 'trusts you deeply');
  assert.equal(trustWords(10), 'does not trust you');
  assert.equal(fearWords(70), 'is afraid of you');
  assert.equal(fearWords(0), 'is not afraid of you');
  assert.equal(sleepsAt({ trust: 60, fear: 10 }), 'the cottage');
  assert.match(sleepsAt({ trust: 60, fear: 30 }), /Ember Kettle/);
  assert.match(sleepsAt({ trust: 40, fear: 0 }), /Ember Kettle/);
});

test('ledger: labels, severity, dates, order and tally', () => {
  for (const d of ['protected_lyra', 'revived_lyra', 'downed_lyra', 'abandoned_downed', 'hit_lyra_accident', 'pushed_after_refusal', 'lied']) assert.ok(DEED_LABELS[d], d);
  assert.equal(deedLabel('downed_lyra'), 'Knocked her out');
  assert.equal(deedLabel('saved_a_cat'), 'Saved a cat');
  assert.equal(formatSeverity(2), '+2');
  assert.equal(formatSeverity(-3), '−3');
  assert.equal(formatSeverity(-0.5), '−0.5');
  assert.equal(formatSeverity(0), '±0');
  assert.equal(formatSeverity('junk'), '±0');
  assert.deepEqual([3, 0, -0.5, -1, -3, -10].map(severityTone), ['good', 'neutral', 'minor', 'minor', 'bad', 'grave']);
  assert.equal(hourLabel(7), '7 AM');
  assert.equal(hourLabel(13.5), '1:30 PM');
  assert.equal(hourLabel(0), '12 AM');
  assert.equal(hourLabel(12, true), '12:00 PM');
  assert.equal(clockLabel(DAY + DAY / 2), '12:00 PM');
  assert.equal(whenLabel({ t: DAY * 2 + DAY * (15 / 24) }, 3), 'Today · 3:00 PM');
  assert.equal(whenLabel({ day: 2, t: DAY + DAY / 4 }, 3), 'Yesterday · 6:00 AM');
  assert.equal(whenLabel({ day: 1 }, 5), 'Day 1');
  const ledger = [
    { t: 10, day: 1, deed: 'protected_lyra', severity: 2, text: 'You cut down the wolf.' },
    { t: 500, deed: 'hit_lyra', severity: -3, text: '' },
    { t: 90, deed: 'gift_liked', severity: 1, text: 'A gift she liked' },
    null,
  ];
  const v = ledgerViews(ledger, 1);
  assert.deepEqual(v.map((x) => x.deed), ['hit_lyra', 'gift_liked', 'protected_lyra'], 'newest first, junk skipped');
  assert.equal(v[0].label, 'Struck her');
  assert.equal(v[0].tone, 'bad');
  assert.equal(v[1].text, '', 'text equal to the label is not repeated');
  assert.equal(v[2].text, 'You cut down the wolf.');
  assert.match(v[2].when, /^Today · /);
  assert.deepEqual(ledgerTally(ledger), { good: 2, bad: 1, net: 0 });
  assert.equal(ledgerEntries({ autonomy: { ledger: [{ deed: 'x' }] } }).length, 1);
  assert.equal(ledgerEntries({ ledger: { all: () => [{ deed: 'x' }, { deed: 'y' }] } }).length, 2);
  assert.deepEqual(ledgerEntries(null), []);
});

test('promises: open first, who promised, and when it is due', () => {
  const list = [
    { id: 'a', text: 'Help Mira', by: 'lyra', state: 'kept', t: 5 },
    { id: 'b', text: 'Buy her a honey cake', by: 'player', state: 'open', due: DAY + DAY / 2, t: 3 },
    { id: 'c', text: '', by: 'player', state: 'open' },
    { id: 'd', text: 'Stay out of fights', by: 'player', state: 'broken', t: 9 },
  ];
  const v = promiseViews(list, { lyraName: 'Lyra', today: 2 });
  assert.deepEqual(v.map((p) => p.id), ['b', 'd', 'a']);
  assert.equal(v[0].by, 'You promised');
  assert.equal(v[0].due, 'by Day 2 · 12:00 PM'.replace('Day 2', 'Today'));
  assert.equal(v[2].by, 'Lyra promised');
  assert.equal(v[1].stateLabel, 'Broken');
  assert.equal(v[1].due, '', 'only open promises are due');
});

test('her plan for today: times, the current slot and place names', () => {
  const rows = planViews(
    [
      { from: 7, to: 11, activity: 'gather_herbs', at: 'whisperwood', why: 'Mira pays well.' },
      { from: 11, to: 14.5, activity: 'travel with you', at: null },
      { activity: '' },
    ],
    12,
    (id) => (id === 'whisperwood' ? 'Whisperwood' : id),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { time: '7 AM – 11 AM', activity: 'Gather herbs', place: 'Whisperwood', why: 'Mira pays well.', now: false, done: true });
  assert.equal(rows[1].time, '11 AM – 2:30 PM');
  assert.ok(rows[1].now);
  assert.deepEqual(planViews(null, 3), []);
  assert.equal(directiveWords('independent'), 'her own day');
  assert.equal(directiveWords(''), 'taking things as they come');
});

test('requests: refusals, conditions, counters and her own fallback lines', () => {
  const pick = (k) => `<${k}>`;
  let a = requestAnswer({ ok: true, message: '' }, { kind: 'follow', pick });
  assert.deepEqual([a.ok, a.refused, a.line, a.kind], [true, false, '<follow>', 'answer']);
  a = requestAnswer({ ok: true, message: '' }, { kind: 'tag', fallback: 'Bram is a friend, then.', pick });
  assert.equal(a.line, 'Bram is a friend, then.');
  a = requestAnswer({ ok: false, refused: true, message: 'Not tonight. I can barely stand.', verdict: { decision: 'refuse' } }, { pick });
  assert.deepEqual([a.ok, a.refused, a.line, a.kind], [false, true, 'Not tonight. I can barely stand.', 'refusal']);
  a = requestAnswer({ ok: false, refused: true, verdict: { decision: 'counter', message: 'Not the camp. The quarry, maybe.', counter: { name: 'goto', args: { target: 'stonecut_quarry' } } } }, { pick });
  assert.equal(a.line, 'Not the camp. The quarry, maybe.');
  assert.deepEqual(a.counter, { label: 'All right, your way', name: 'goto', args: { target: 'stonecut_quarry' } });
  a = requestAnswer({ ok: true, verdict: { decision: 'accept_conditional', message: 'Fine. Half the wood is mine.' } }, { kind: 'job', pick });
  assert.deepEqual([a.ok, a.line, a.counter], [true, 'Fine. Half the wood is mine.', null]);
  a = requestAnswer({ ok: true, verdict: { decision: 'refuse' } }, { pick });
  assert.ok(a.refused && !a.ok, 'a refusing verdict wins over ok');
  assert.equal(a.line, '<refused>');
  a = requestAnswer({ ok: false, message: '' }, { pick });
  assert.deepEqual([a.refused, a.line, a.kind], [false, '<failed>', 'problem']);
  a = requestAnswer(null, { pick });
  assert.equal(a.kind, 'problem');
  // The brain already answered aloud: the chat shows those words, without a second bubble.
  a = requestAnswer({ ok: true, message: '' }, { kind: 'follow', pick, heard: ['Lead the way.'] });
  assert.deepEqual([a.line, a.bubble], ['Lead the way.', false]);
  a = requestAnswer({ ok: false, refused: true, message: 'No.' }, { pick, heard: ['No.'] });
  assert.deepEqual([a.line, a.bubble], ['No.', false]);
  a = requestAnswer({ ok: false, refused: true, message: 'No.' }, { pick, heard: ['Something else.'] });
  assert.deepEqual([a.line, a.bubble], ['No.', true]);
  a = requestAnswer({ ok: true }, { kind: 'stay', pick });
  assert.ok(a.bubble);
});

// ---------- memory and lore (§17) ----------

test('knowledge: kinds, sources, confidence and grouping by subject', () => {
  assert.equal(knowledgeKind({ kind: 'Rumor' }), 'rumor');
  assert.equal(knowledgeKind({ source: 'lore' }), 'lore');
  assert.equal(knowledgeKind({ loreId: 'w1' }), 'lore');
  assert.equal(knowledgeKind({ source: 'inferred' }), 'theory');
  assert.equal(knowledgeKind({}), 'fact');
  assert.equal(sourceLabel({ source: 'told', from: 'elda' }, (id) => (id === 'elda' ? 'Elda' : id)), 'told by Elda');
  assert.equal(sourceLabel({ source: 'told' }), 'someone told her');
  assert.equal(sourceLabel({ source: 'player' }), 'you told her');
  assert.equal(sourceLabel({}), '');
  assert.equal(confidenceWord(0.9), 'certain');
  assert.equal(confidenceWord(0.2), 'doubtful');
  assert.equal(confidenceWord(undefined), '');
  const list = [
    { subject: 'maren', text: 'Maren went to the ruins.', kind: 'fact', t: 1 },
    { subject: 'maren', text: 'Something called her there.', kind: 'theory', t: 5 },
    { subject: 'bandit_camp', text: 'The bandits have the key.', kind: 'rumor', t: 3 },
    { subject: 'sunken_ruins', text: 'A waygate lies below.', source: 'lore', t: 2 },
    { text: '' },
    null,
  ];
  const names = (id) => ({ maren: 'Maren', bandit_camp: 'Bandit Camp', sunken_ruins: 'Sunken Ruins' })[id] || '';
  const groups = groupKnowledge(list, { nameOf: names });
  assert.deepEqual(groups.map((g) => g.label), ['Bandit Camp', 'Maren', 'Sunken Ruins']);
  assert.deepEqual(groups[1].items.map((k) => k.t), [5, 1], 'newest first');
  assert.deepEqual(groupKnowledge(list, { kind: 'lore', nameOf: names }).map((g) => g.label), ['Sunken Ruins']);
  assert.deepEqual(groupKnowledge(list, { query: 'called her', nameOf: names }).map((g) => g.items.length), [1]);
  assert.deepEqual(groupKnowledge(list, { query: 'camp key' }).map((g) => g.label), ['Bandit camp']);
  assert.deepEqual(knowledgeCounts(list), { all: 4, fact: 1, lore: 1, theory: 1, rumor: 1 });
});

test('her life: memories first, then the story, then her soul; ordered from birth', () => {
  const mind = {
    memory: {
      all: () => [
        { id: 'l2', type: 'life', age: 14, text: 'Apprenticed to Maren.' },
        { id: 'e1', type: 'event', text: 'Met Bram.' },
        { id: 'l1', tags: ['life'], age: 0, title: 'Born', text: 'Born by the sea.' },
        { id: 'l3', type: 'life', text: 'Came to Hearthvale.' },
      ],
    },
  };
  const t = lifeTimeline({ mind, story: { lyraLife: [{ id: 's', age: 3, text: 'from the story' }] } });
  assert.deepEqual(t.map((x) => x.id), ['l1', 'l2', 'l3'], 'life memories win over the story; ageless last');
  assert.equal(t[0].ageLabel, 'Birth');
  assert.equal(t[1].ageLabel, 'Age 14');
  const fromStory = lifeTimeline({ mind: {}, story: { lyraLife: [{ id: 'b', age: 9, title: 'Cal', text: 'Her brother.' }, { id: 'a', age: 0, text: 'Born.' }, { id: 'a', age: 0, text: 'dup' }] } });
  assert.deepEqual(fromStory.map((x) => x.id), ['a', 'b']);
  const fromSoul = lifeTimeline({ mind: {}, story: { lyraLife: [] }, soul: { origin: 'The Glasswater Isles', backstory: 'Maren taught her.' } });
  assert.deepEqual(fromSoul.map((x) => x.title), ['Where she comes from', 'Before Hearthvale']);
  assert.deepEqual(lifeTimeline({}), []);
  assert.equal(ageLabel('childhood'), 'Childhood');
});

test('memory chips: refs, lookup across stores and labels', () => {
  const refs = memoryRefs(['m1', { id: 'k1', label: 'Maren went north' }, 'm1', null, { text: 'a bare text' }, 7]);
  assert.deepEqual(refs.map((r) => r.id), ['m1', 'k1', '', '7']);
  assert.equal(memoryRefs(new Array(20).fill(0).map((_, i) => `m${i}`)).length, 6);
  assert.deepEqual(memoryRefs(undefined), []);
  const mind = {
    memory: { all: () => [{ id: 'm1', text: 'The wolves on the King\'s Road.', day: 1 }] },
    knowledge: [{ id: 'k1', subject: 'maren', text: 'Maren went to the ruins.' }],
    life: [{ id: 'l1', title: 'Cal', text: 'Her little brother.' }],
  };
  const story = { world: [{ id: 'w1', title: 'The Waygate', text: 'An old gate.' }], lyraLife: [] };
  assert.equal(findMemory(mind, 'm1').store, 'memory');
  assert.equal(findMemory(mind, 'm1').day, 1);
  assert.equal(findMemory(mind, 'k1').store, 'knowledge');
  assert.equal(findMemory(mind, 'l1').title, 'Cal');
  assert.equal(findMemory(mind, 'w1', story).store, 'lore');
  assert.equal(findMemory(mind, 'zzz', story), null);
  assert.equal(findMemory(null, 'm1'), null);
  assert.equal(findMemory({ lookup: () => ({ text: 'direct hit', store: 'working' }) }, 'q').store, 'working');
  const viaLookup = findMemory({ lookup: (id) => (id === 'life:born' ? { id, store: 'life', label: 'Born in a gale', text: 'I was born on Kettlewake.', ref: { age: 0 } } : null) }, 'life:born');
  assert.deepEqual([viaLookup.title, viaLookup.store, viaLookup.day], ['Born in a gale', 'life', 0]);
  assert.equal(memoryChipLabel({ id: 'm1', label: '' }, findMemory(mind, 'm1')), "the wolves on the King's Road.");
  assert.equal(memoryChipLabel({ label: 'Maren went north' }), 'Maren went north', 'names keep their capital');
  assert.equal(memoryChipLabel({}), 'something');
  assert.ok(memoryChipLabel({ label: 'a very long label that goes on and on about the lake and the fish' }).length <= 34);
});

test('her farewell comes from her own last diary words', () => {
  assert.equal(lastSentences('Short.', 50), 'Short.');
  const long = 'First sentence is here. Second one follows it. I am going north, alone. Do not follow me.';
  assert.equal(lastSentences(long, 45), 'I am going north, alone. Do not follow me.');
  const mind = { diary: [{ day: 1, text: 'Old page.' }, { day: 2, text: 'Morning came.\n\nI am leaving. Do not follow me.' }] };
  assert.equal(farewellText(mind), 'I am leaving. Do not follow me.');
  assert.equal(farewellText(mind, { lyra_gone: { farewell: 'Goodbye, traveler.' } }), 'Goodbye, traveler.');
  assert.equal(farewellText({}), '');
  assert.equal(farewellText(null, { lyra_gone: true }), '');
});

// ---------- round 2: asking, reaching her, faces ----------

test('without a consent gate the UI still puts every request to her', () => {
  const calls = [];
  const refusal = { decision: 'counter', message: 'Rest first. Then we will see.', counter: { name: 'sit', args: {} }, reasons: ['she is exhausted'] };
  const make = (verdict, { gate = null, ungated = false } = {}) => {
    const noted = [];
    const game = {
      actions: { consentGate: gate, has: (n) => n !== 'nope', get: () => ({ ungated }) },
      companion: { mind: { evaluateRequest: (req) => (calls.push(req), verdict) } },
      brain: { noteRefusal: (...a) => noted.push(a) },
    };
    return { ui: Object.assign(Object.create(UI.prototype), { game }), noted };
  };
  let { ui, noted } = make(refusal);
  const w = ui.weighWithoutGate('start_job', { value: 'chop_wood', amount: '5' });
  assert.equal(w.refused, true);
  assert.deepEqual(w.result, { ok: false, refused: true, verdict: refusal, message: 'Rest first. Then we will see.' });
  assert.deepEqual(calls.at(-1), { action: 'start_job', args: { target: null, value: 'chop_wood', amount: 5 }, source: 'player' }, 'args are normalized like the registry does');
  assert.equal(noted.length, 1, 'the brain remembers the refusal for "why not?"');
  ({ ui } = make({ decision: 'accept_conditional', message: 'Half is mine.' }));
  assert.deepEqual(ui.weighWithoutGate('start_job', {}), { refused: false, verdict: { decision: 'accept_conditional', message: 'Half is mine.' } });
  const n = calls.length;
  assert.equal(make(refusal, { gate: () => null }).ui.weighWithoutGate('follow', {}), null, 'an installed gate does the weighing');
  assert.equal(make(refusal, { ungated: true }).ui.weighWithoutGate('remember', {}), null, 'things that ask nothing of her are not weighed');
  assert.equal(make(refusal).ui.weighWithoutGate('nope', {}), null, 'unknown actions are left to the registry');
  assert.equal(calls.length, n);
});

test('handing her things needs her near, awake and still here', () => {
  const at = (dx, extra = {}) => ({ player: { x: 100, y: 100 }, companion: { x: 100 + dx, y: 100, mind: { companionship: 'together' }, ...extra }, flags: {} });
  assert.deepEqual(handReach(at(32)), { ok: true, why: '', tiles: 2 });
  assert.equal(handReach(at(16 * 7)).why, 'far');
  assert.equal(handReach(at(16 * 7)).tiles, 7);
  assert.equal(handReach(at(8, { downed: true })).why, 'downed');
  assert.equal(handReach({ ...at(8), flags: { lyra_gone: { day: 3 } } }).why, 'gone');
  assert.equal(handReach({ player: { x: 0, y: 0 } }).why, 'gone');
  assert.equal(handReach(at(16 * 9), 10).ok, true, 'the reach is adjustable');
  assert.equal(reachNote({ ok: true }), '');
  assert.match(reachNote({ ok: false, why: 'far', tiles: 9 }, 'Lyra'), /9 paces away/);
  assert.match(reachNote({ ok: false, why: 'gone' }, 'Lyra'), /won't take anything/);
  assert.match(reachNote({ ok: false, why: 'downed' }, 'Lyra'), /Help her up/);
});

test('counter-offers read as what the player agrees to', () => {
  assert.equal(counterLabel({ name: 'sit' }), 'Rest, then');
  assert.equal(counterLabel({ name: 'set_combat_mode', args: { value: 'defend' } }), 'Just defend us, then');
  assert.equal(counterLabel({ name: 'start_job', args: { value: 'gather_herbs', amount: 3 } }), 'Gather herbs (3) instead');
  assert.equal(counterLabel({ name: 'start_job', args: { value: 'fish' } }), 'Fish instead');
  assert.equal(counterLabel({ name: 'goto', args: { target: 'x' } }), 'All right, your way');
  assert.equal(counterLabel(null), 'All right, your way');
  const a = requestAnswer({ ok: false, refused: true, verdict: { decision: 'counter', message: 'Rest first.', counter: { name: 'sit', args: {} } } }, { pick: () => '' });
  assert.equal(a.counter.label, 'Rest, then');
});

test('days: the game starts on day 1; her seeded past is before you met', () => {
  const DAY = 900;
  assert.equal(dayOf({ day: 3 }), 3);
  assert.equal(dayOf({ day: 0, t: -2 * DAY }), 0, 'seeded memories carry day 0');
  assert.equal(dayOf({ t: -DAY * 1.5 }), 0, 'a time before the first morning');
  assert.equal(dayOf({ t: DAY * 1.2 }), 2);
  assert.equal(dayOf({}), 0);
  assert.equal(dayOf(null), 0);
});

test('faces in the People tab: species for creatures, painted absent people, initials otherwise', () => {
  const game = { entities: { get: (id) => ({ bram: { id: 'bram', spriteKey: 'bram' }, wolf_3: { id: 'wolf_3', species: 'wolf' } })[id] || null } };
  assert.equal(personArtKey(game, { id: 'bram' }), 'bram');
  assert.equal(personArtKey(game, { id: 'wolf_3', species: 'wolf' }), 'wolf');
  assert.equal(personArtKey(game, { id: 'wolf_9' }), null, 'a creature long gone, without a species, gets an initial');
  assert.equal(personArtKey(game, { id: 'maren' }), 'maren');
  assert.ok(ABSENT_LOOKS.maren.hair, 'Maren is painted from how the story describes her');
  assert.equal(personArtKey(game, { id: 'player' }), 'player');
  assert.equal(personArtKey(game, { id: 'bandits', kind: 'group' }), null);
  assert.equal(personArtKey(game, { id: 'tobias', npc: true }), 'tobias');
  assert.equal(personArtKey(game, null), null);
});

test('the Now tab says how she is in plain words', () => {
  assert.equal(joinWords(['a']), 'a');
  assert.equal(joinWords(['a', 'b', 'c']), 'a, b and c');
  const sum = {
    mood: { label: 'content' },
    emotions: [{ name: 'curiosity', value: 0.5 }, { name: 'trust', value: 0.4 }, { name: 'fear', value: 0.1 }],
    status: 'following you',
    pressingText: 'a bit peckish',
    onMind: ['Maren Ashgrove', "King's Road"],
  };
  assert.equal(nowParagraph(sum, { name: 'Lyra' }), "Lyra feels content, curious and trusting. Right now she is following you. She is a bit peckish. On her mind: Maren Ashgrove and King's Road.");
  assert.equal(nowParagraph({ goal: 'Find Maren.' }), 'On her mind: Find Maren.');
  assert.equal(nowParagraph(null), '');
  assert.equal(nowParagraph({ emotions: 'odd', onMind: [null, 3] }), '');
});
