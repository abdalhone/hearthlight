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
import { COMMANDS, JOBS, ACK_LINES, pickAck, CHIPS, HOW_TO_PLAY } from '../src/ui/content.js';
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
    Digit1: 'cmd1', Digit2: 'cmd2', Digit3: 'cmd3', Digit4: 'cmd4', Digit5: 'cmd5',
  };
  for (const [code, action] of Object.entries(expect)) assert.equal(actionForKey(code), action, code);
  assert.equal(actionForKey('KeyZ'), null);
  assert.equal(actionForKey('', 'e'), 'interact');
  assert.equal(actionForKey('', ' '), 'attack');
  assert.equal(actionForKey('', '3'), 'cmd3');
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
  assert.ok(CHIPS.includes('Follow me') && CHIPS.includes('Attack mode') && CHIPS.includes('How are you?') && CHIPS.includes("What's next?"));
  assert.ok(HOW_TO_PLAY.length >= 4);
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
