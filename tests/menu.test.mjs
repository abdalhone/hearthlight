// One clean menu (DESIGN §24): every setting exactly once in Settings, the menu's items
// unique and never a second copy of what the HUD already gives, the controls written
// once for every device, and the grid arrow-key walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { SETTINGS_TABS, SETTINGS_LAYOUT, SETTING_ROWS, EXTRA_SETTING_KEYS, ACTION_ROWS, settingKeysInLayout } from '../src/ui/settings_panel.js';
import { pauseItems, characterOpener, nextInDirection } from '../src/ui/overlays.js';
import { MENU_ICONS, CONTROLS, CONTROL_DEVICES, controlsFor, HOW_TO_PLAY } from '../src/ui/content.js';
import { ICONS } from '../src/ui/icons.js';

const CUSTOM = new Set(['brain', 'villageAi', 'apiModel']);

test('settings: every key in DEFAULT_SETTINGS (and the touch ones) appears exactly once', () => {
  const keys = settingKeysInLayout().map((r) => r.key);
  const count = new Map();
  for (const k of keys) count.set(k, (count.get(k) || 0) + 1);
  for (const k of Object.keys(DEFAULT_SETTINGS)) assert.equal(count.get(k), 1, `${k} appears ${count.get(k) || 0} times`);
  for (const k of EXTRA_SETTING_KEYS) assert.equal(count.get(k), 1, `${k} appears ${count.get(k) || 0} times`);
  for (const k of keys) assert.ok(k in DEFAULT_SETTINGS || EXTRA_SETTING_KEYS.includes(k), `${k} is not a setting`);
  assert.equal(keys.length, new Set(keys).size);
});

test('settings: five tabs (Game, Controls, Sound & voices, Minds (Claude), Display), none empty', () => {
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.label),
    ['Game', 'Controls', 'Sound & voices', 'Minds (Claude)', 'Display'],
  );
  assert.deepEqual(Object.keys(SETTINGS_LAYOUT).sort(), SETTINGS_TABS.map((t) => t.id).sort());
  for (const t of SETTINGS_TABS) {
    assert.ok(ICONS[t.icon], t.icon);
    const groups = SETTINGS_LAYOUT[t.id];
    // A group holds settings, or action rows (Game → Practice), never nothing.
    assert.ok(groups.length && groups.every((g) => g.title && (g.keys.length || g.actions?.length)), t.id);
  }
});

test('settings: Game → Practice holds the three action rows, each once, none of them a setting', () => {
  const all = Object.values(SETTINGS_LAYOUT).flat().flatMap((g) => g.actions || []);
  // (Round 14b: Minds holds one more, Back up: the Mind panel's export moved to Settings.)
  assert.deepEqual(all, ['resetPoints', 'freePoints', 'trialMagic', 'backupMind'], 'exactly these, once');
  const practice = SETTINGS_LAYOUT.game.find((g) => g.id === 'practice');
  assert.equal(practice.title, 'Practice');
  assert.deepEqual(practice.keys, []);
  for (const id of all) {
    const row = ACTION_ROWS[id];
    assert.ok(row && row.label && row.label.length <= 28, `${id}: label`);
    assert.ok(row.note && row.note.length <= 140 && !/\n/.test(row.note), `${id}: note`);
    assert.ok(row.button, `${id}: button`);
    assert.ok(!(id in DEFAULT_SETTINGS) && !EXTRA_SETTING_KEYS.includes(id), `${id} is not a setting`);
  }
  assert.equal(ACTION_ROWS.resetPoints.label, 'Reset stat points');
  assert.equal(ACTION_ROWS.trialMagic.label, 'Try all magic');
  assert.equal(ACTION_ROWS.freePoints.label, 'Free stat points');
});

test('settings: each plain row has a short label and a one-line note', () => {
  for (const { key } of settingKeysInLayout()) {
    if (CUSTOM.has(key)) continue;
    const row = SETTING_ROWS[key];
    assert.ok(row, `${key} has a row`);
    assert.ok(['toggle', 'range', 'select', 'text'].includes(row.kind), key);
    assert.ok(row.label && row.label.length <= 28, `${key}: label "${row.label}"`);
    if (row.kind !== 'range') assert.ok(row.note && row.note.length <= 140 && !/\n/.test(row.note), `${key}: note`);
    if (row.kind === 'select') {
      assert.ok(row.options.length >= 2, key);
      const def = key in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[key] : row.fallback;
      assert.ok(row.options.some(([v]) => String(v) === String(def)), `${key}: the default ${def} is one of the options`);
    }
  }
  // Short and plain: no two rows say the same thing.
  const labels = settingKeysInLayout().filter((r) => !CUSTOM.has(r.key)).map((r) => `${r.tab}:${SETTING_ROWS[r.key].label}`);
  assert.equal(labels.length, new Set(labels).size);
});

function fakeUi({ magic = true, missions = true, character = false, story = true } = {}) {
  const calls = [];
  const game = {
    settings: { companionName: 'Lyra' },
    magic: magic ? {} : null,
    story: story ? { playPrologue: () => calls.push('prologue') } : null,
  };
  const ui = {
    game,
    hud: { weaving: { available: () => magic } },
    openSpellbook: () => calls.push('spellbook'),
    openMind: (tab) => calls.push(`mind:${tab}`),
    openSettings: () => calls.push('settings'),
    openInventory: () => calls.push('inventory'),
    quitToTitle: () => calls.push('quit'),
    codex: { open: () => calls.push('book') },
    mind: { tab: 'now' },
  };
  if (missions) ui.openMissions = (tab) => calls.push(`missions:${tab}`);
  if (character) ui.openCharacter = () => calls.push('character');
  return { game, ui, calls };
}

test('menu: Resume, Spellbook, Bag, Missions, People, Character, the Book, Settings, Save, Quit — each once', () => {
  const { game, ui, calls } = fakeUi({ character: true });
  const items = pauseItems(game, ui);
  assert.deepEqual(
    items.map((i) => i.id),
    ['resume', 'spellbook', 'inventory', 'missions', 'people', 'character', 'book', 'settings', 'save', 'quit'],
  );
  const all = items.flatMap((i) => (i.sub ? [i, i.sub] : [i]));
  assert.equal(new Set(all.map((i) => i.id)).size, all.length, 'ids unique');
  assert.equal(new Set(all.map((i) => i.label)).size, all.length, 'labels unique');
  // Every place has its home here (the HUD keeps only what play needs every second);
  // the chat and the menu itself are not places.
  for (const id of ['chat', 'talk', 'pause']) assert.ok(!all.some((i) => i.id === id), id);
  assert.equal(items.find((i) => i.id === 'people').label, 'People'); // round 14b: not Lyra's
  assert.equal(items.find((i) => i.id === 'book').sub.id, 'prologue');
  const ctx = { close: () => calls.push('close'), save: () => calls.push('save') };
  for (const it of all) it.run(ctx);
  assert.deepEqual(calls, ['close', 'spellbook', 'inventory', 'missions:active', 'mind:now', 'character', 'book', 'prologue', 'settings', 'save', 'quit']);
  for (const it of all) assert.ok(MENU_ICONS[it.id], `${it.id} has an icon`);
});

test('menu: what this build lacks is left out, never shown broken', () => {
  const { game, ui } = fakeUi({ magic: false, missions: false, character: false, story: false });
  const ids = pauseItems(game, ui).map((i) => i.id);
  assert.deepEqual(ids, ['resume', 'inventory', 'people', 'book', 'settings', 'save', 'quit']);
  assert.equal(pauseItems(game, ui).find((i) => i.id === 'book').sub, null);
  assert.equal(characterOpener({}), null);
  let opened = 0;
  characterOpener({ character: { open: () => opened++ } })();
  assert.equal(opened, 1);
  // People is People whatever Lyra is called (round 14b: the menu is not built around her).
  game.settings.companionName = 'Wren';
  assert.equal(pauseItems(game, ui).find((i) => i.id === 'people').label, 'People');
});

test('menu icons: one per place, all real icons', () => {
  for (const [id, name] of Object.entries(MENU_ICONS)) assert.ok(name === 'spellbook' || ICONS[name], `${id}: ${name}`);
  // The same place never borrows another place's icon.
  const places = ['prologue', 'book', 'pastLives', 'settings', 'howTo', 'spellbook', 'inventory', 'missions', 'people', 'character', 'village', 'save', 'quit', 'newGame'];
  const used = places.map((p) => MENU_ICONS[p]);
  assert.equal(new Set(used).size, used.length, used.join(' '));
});

test('controls: written once, for every device; How to play starts with them', () => {
  assert.deepEqual(CONTROL_DEVICES.map((d) => d.id), ['touch', 'keys', 'pad']);
  const ids = CONTROLS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CONTROLS) {
    assert.ok(c.what, c.id);
    assert.ok(c.keys || c.pad || c.touch, `${c.id} works somehow`);
  }
  for (const d of CONTROL_DEVICES) {
    const rows = controlsFor(d.id);
    assert.ok(rows.length >= 9, `${d.id}: ${rows.length}`);
    for (const [what, how] of rows) assert.ok(what && how);
  }
  // What the keyboard really does (src/core/input.js KEYMAP).
  const keys = Object.fromEntries(controlsFor('keys'));
  assert.match(keys['Menu (pause)'], /Esc/);
  assert.match(keys.Spellbook, /\bB\b/);
  assert.match(keys.Bag, /\bI\b/); // the bag ("Bag" in the menu and its panel)
  assert.match(keys.People, /Tab or M/); // the Mind is People (round 14b)
  assert.equal(HOW_TO_PLAY[0].id, 'controls');
  assert.ok(HOW_TO_PLAY[0].controls);
  const ids2 = HOW_TO_PLAY.map((s) => s.id);
  assert.equal(new Set(ids2).size, ids2.length);
  // The other sections are about the game, not a second list of keys.
  const text = JSON.stringify(HOW_TO_PLAY.slice(1));
  assert.ok(!/\b(WASD|Shift|Tab or M)\b/.test(text), 'no keys outside the controls list');
});

test('menu arrow keys: nearest row that way, then the most in line; -1 at the edge', () => {
  // Resume; Spellbook | Missions; Lyra (wide); Book | Prologue; Settings | Save | Quit.
  const R = [
    { x: 0, y: 0, w: 400, h: 50 },
    { x: 0, y: 58, w: 196, h: 48 },
    { x: 204, y: 58, w: 196, h: 48 },
    { x: 0, y: 114, w: 400, h: 48 },
    { x: 0, y: 170, w: 300, h: 48 },
    { x: 308, y: 170, w: 92, h: 48 },
    { x: 0, y: 236, w: 130, h: 42 },
    { x: 135, y: 236, w: 130, h: 42 },
    { x: 270, y: 236, w: 130, h: 42 },
  ];
  const go = (i, d) => nextInDirection(R, i, d);
  assert.equal(go(0, 'down'), 1);
  assert.equal(go(1, 'down'), 3);
  assert.equal(go(2, 'down'), 3);
  assert.equal(go(3, 'down'), 4);
  assert.equal(go(5, 'down'), 8);
  assert.equal(go(1, 'right'), 2);
  assert.equal(go(2, 'right'), -1);
  assert.equal(go(8, 'up'), 5);
  assert.equal(go(6, 'up'), 4);
  assert.equal(go(0, 'up'), -1);
  assert.equal(go(7, 'left'), 6);
});

test('menu: the places’ hints are short enough for two to a row on an upright phone', () => {
  const { game, ui } = fakeUi({ character: true });
  game.villageLife = {};
  ui.openVillageLife = () => {};
  for (const it of pauseItems(game, ui)) {
    if (it.group !== 'go' || it.id === 'book') continue; // the Book spans the row
    assert.ok(String(it.hint || '').length <= 18, `${it.id}: "${it.hint}" is too long for half of a 390 px menu`);
  }
});
