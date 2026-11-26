// Round 14b, independent verifier A: what playing the author's items on three screens found,
// each pinned by a test that failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const filesUnder = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.js') ? [p] : [];
  });

// Item 27 on a phone: the stick held in one thumb and a weave dragged to aim with the other is
// a two-finger touch. A touchmove that is no longer cancelable (the browser has begun its own
// gesture) must not be cancelled: Chrome logs an intervention error for every such move.
test('two-finger touch: no touchmove listener cancels an uncancelable move', () => {
  const bad = [];
  for (const f of filesUnder(SRC)) {
    const src = readFileSync(f, 'utf8');
    const re = /addEventListener\(\s*'touchmove'[\s\S]{0,240}?preventDefault\(\)/g;
    for (const m of src.matchAll(re)) if (!/cancelable/.test(m[0])) bad.push(`${f.slice(SRC.length)}: ${m[0].replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
});

// Item 27 (and 5) on a computer: a notice the toast stack places over the play field (clear of
// the HUD, the bubbles and the player, but not of a wolf) must not eat the click meant for the
// world: the left button is the sword and the right button casts, wherever they land. A tap
// on a phone still puts a notice away.
test('with a mouse, a notice over the field lets the sword and the cast through', () => {
  const css = [readFileSync(join(SRC, 'styles.css'), 'utf8'), ...readdirSync(join(SRC, 'styles')).map((f) => readFileSync(join(SRC, 'styles', f), 'utf8'))].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/pointer-events\s*:\s*auto/.test(m[2])) continue;
    for (const sel of m[1].split(',').map((x) => x.trim()))
      if (/\.toast(?![-\w])/.test(sel) && !/\.is-touch/.test(sel)) bad.push(sel);
  }
  assert.deepEqual(bad, [], 'a notice is clickable only on a touch screen');
  assert.match(css, /\.is-touch \.toast\s*\{[^}]*pointer-events:\s*auto/, 'on a phone a tap still puts one away');
});

// Item 1: "I killed in front of Elda; can I still talk to her?" The chat was already on Elda
// (she was the last one you spoke to) when she watched you kill. Walking up and pressing T
// opens the chat: what you see as you turn to her ("Elda backs away from you, white to the
// lips.") must be there, and the header must say she is terrified of you, not merely "cold".
import { makeGame as makeMurderGame, put as putAt } from './murder_world.mjs';
import { Chat } from '../src/ui/chat.js';
import { fearWord } from '../src/ui/chat_target.js';

function headlessChat(g) {
  const chat = new Chat({ game: g, isTouch: false, toast() {}, root: { classList: { add() {}, remove() {}, toggle() {} } }, hud: { setUnread() {} }, armBack() {} });
  chat.mounted = true;
  chat.el = { hidden: true };
  chat.field = { blur() {}, focus() {} };
  for (const k of ['refreshPeople', 'refreshHeader', 'scrollToEnd', 'markMoreChips', 'focusSoon', 'applyTarget', 'renderThread', 'setTyping', 'frameWorld']) chat[k] = () => {};
  chat.toBar = { reveal() {} };
  chat.log = { querySelector: () => null, insertBefore() {} };
  chat.thinkingRow = { parentNode: null };
  chat.buildVillagerRow = () => ({});
  return chat;
}

test('item 1: the chat already on Elda, reopened after she watched you kill: the fear line shows, and the header says terrified', () => {
  const g = makeMurderGame({ hour: 12 });
  const elda = g.entities.get('elda');
  putAt(g.player, elda.x + 18, elda.y);
  const chat = headlessChat(g);
  assert.ok(chat.selectTarget('elda'), 'Elda can be spoken to');
  chat.open(false);
  assert.equal(chat.threadOf('elda').filter((m) => /backs away/.test(m.text)).length, 0, 'calm: no fear line');
  assert.equal(fearWord(g, elda), null, 'calm: nothing in the header but how she stands with you');
  chat.close();
  // She watches a killing.
  elda.terror = { until: g.murder.now() + 600, of: 'player' };
  const fear = g.murder.fearOf(elda);
  assert.ok(fear, 'she is afraid of the player now');
  // T again, to the same person: the chat opens on her as it was.
  assert.ok(chat.selectTarget('elda'));
  chat.open(false);
  const notes = chat.threadOf('elda').filter((m) => /backs away from you|keeps (her|his) distance/.test(m.text));
  assert.equal(notes.length, 1, 'what you see as you turn to her is shown');
  assert.match(fearWord(g, elda), /terrified of you|afraid of you/);
  // Opened again straight away: not shown twice in a row.
  chat.close();
  chat.open(false);
  assert.equal(chat.threadOf('elda').filter((m) => /backs away from you|keeps (her|his) distance/.test(m.text)).length, 1, 'once in a row');
});
