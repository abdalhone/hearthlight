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

// Item 5, decision D3: a click on a person used to open talk; now it is the sword wherever it
// lands. The author's old habit is forgiven once: the first blow in a life on a calm person
// (not the one you locked on to, not someone fighting or fleeing you) lands, they yelp, and
// there is no crime. The second is a real blow: an assault.
import { clearScene, events as eventsOf } from './murder_world.mjs';

const faceTo = (e, x, y) => {
  e.faceToward?.(x, y);
  const l = Math.hypot(x - e.x, y - e.y) || 1;
  e.facing = { x: (x - e.x) / l, y: (y - e.y) / l };
};

test('D3: the first habit click on a calm person is an accident; the second is an assault', () => {
  const g = makeMurderGame({ hour: 12 });
  clearScene(g, ['tobias', 'garrick']);
  const tob = g.entities.get('tobias');
  putAt(tob, g.player.x + 16, g.player.y);
  const gar = g.entities.get('garrick');
  putAt(gar, g.player.x + 8, g.player.y + 40);
  faceTo(gar, g.player.x, g.player.y); // he sees it
  const crimes = { get length() { return eventsOf(g, 'crime').length; } };
  const hurt = { at: (i) => eventsOf(g, 'damage').at(i) };
  const hp0 = tob.hp;
  g.combat.damage(g.player, tob, 3, { kind: 'melee', habit: true });
  assert.ok(tob.hp < hp0, 'the blow lands');
  assert.equal(hurt.at(-1)?.accident, true, 'it reads as an accident (a yelp, no call to arms)');
  assert.equal(crimes.length, 0, 'no crime: the habit is forgiven once');
  assert.equal(g.combat.hasCrime(g.player), false);
  tob.invuln = 0;
  g.combat.damage(g.player, tob, 3, { kind: 'melee', habit: true });
  assert.ok(!hurt.at(-1)?.accident, 'the second blow is meant');
  assert.equal(g.combat.hasCrime(g.player), true, 'the second blow, seen, is a crime');
});

test('D3: never forgiven when it is meant: the lock target, someone fighting you, a weave', () => {
  const g = makeMurderGame({ hour: 12 });
  clearScene(g, ['garrick', 'tobias', 'rowan', 'elda', 'wenna']);
  const gar = g.entities.get('garrick');
  putAt(gar, g.player.x + 16, g.player.y);
  const hurt = { at: (i) => eventsOf(g, 'damage').at(i) };
  // Locked on to him: meant.
  if (g.lock) g.lock.target = gar;
  else g.lock = { target: gar };
  g.combat.damage(g.player, gar, 3, { kind: 'melee', habit: true });
  assert.ok(!hurt.at(-1)?.accident, 'a blow on the one you locked on to is meant');
  g.lock.target = null;
  // Someone already fighting you.
  const row = g.entities.get('rowan');
  putAt(row, g.player.x - 16, g.player.y);
  row.mode = 'fight';
  row.fightTarget = g.player;
  g.combat.damage(g.player, row, 3, { kind: 'melee', habit: true });
  assert.ok(!hurt.at(-1)?.accident, 'a blow in a fight is meant');
  // A weave is never the click habit.
  const tob = g.entities.get('tobias');
  putAt(tob, g.player.x, g.player.y + 16);
  g.combat.damage(g.player, tob, 3, { kind: 'magic', deliberate: true });
  assert.ok(!hurt.at(-1)?.accident, 'a weave thrown at them is meant');
  // A swing by the key (J, Space) or the phone's sword button is meant, never the habit.
  const wen = g.entities.get('wenna');
  putAt(wen, g.player.x + 12, g.player.y - 12);
  g.combat.damage(g.player, wen, 1, { kind: 'melee' }); // a key swing: not the habit
  assert.ok(!hurt.at(-1)?.accident, 'a key swing is meant');
  // The one forgiveness is still there for a calm person after all that.
  const elda = g.entities.get('elda');
  putAt(elda, g.player.x, g.player.y - 16);
  g.combat.damage(g.player, elda, 3, { kind: 'melee', habit: true });
  assert.equal(hurt.at(-1)?.accident, true, 'the first habit blow on a calm person is forgiven');
});

// TOP PRIORITY B, played: whoever walks with you is off screen and says something. Their words
// are pinned to the screen's edge and so is their badge (their portrait pointing at them):
// on a computer the badge was drawn over the middle of the words ("Aim [badge]he things with
// tee[badge]"). The bubble keeps clear of the badge.
import { Bubbles } from '../src/render/bubbles.js';
import { EventBus } from '../src/core/events.js';

test('the companion off screen: their edge-pinned words never sit under their edge badge', () => {
  const g = { settings: { textSpeed: 1, showThoughts: true }, state: 'playing', bus: new EventBus() };
  const player = { id: 'player', x: 0, y: 0 };
  const lyra = { id: 'lyra', name: 'Lyra', x: 900, y: 600 }; // far off, bottom right
  g.player = player;
  g.companion = lyra;
  g.party = { holder: lyra, isCompanion: (e) => e === lyra || e === 'lyra' };
  const b = new Bubbles(g);
  b.say(lyra, 'Aim at the things with teeth, not the people.', { kind: 'say' });
  for (let i = 0; i < 40; i++) b.update?.(0.05);
  const ctx = { measureText: (s) => ({ width: String(s).length * 7 }), canvas: { width: 1280, height: 720 } };
  const W = 1280;
  const H = 720;
  const r = { scale: 3, dpr: 1, ox: -W / 6, oy: -H / 6, subX: 0, subY: 0 };
  b._dpr = 1;
  b._metrics(r);
  b._layoutBubbles(ctx, r, W, H);
  const vis = b._vis.find((x) => x.entity === lyra);
  assert.ok(vis, 'her words are pinned to the edge (she walks with you)');
  const badge = b._badgeRect(r, W, H);
  assert.ok(badge, 'her badge is on the edge');
  const L = vis.layout;
  const overlap = !(L.x + L.w <= badge.x || badge.x + badge.w <= L.x || L.y + L.h <= badge.y || badge.y + badge.h <= L.y);
  assert.equal(overlap, false, `bubble ${JSON.stringify({ x: L.x, y: L.y, w: L.w, h: L.h })} clear of badge ${JSON.stringify(badge)}`);
});

// Item 5 with Lyra far off (seen in play: a forgiven click on Tobias in the square, Lyra a
// field away; her edge bubble said "Hey — me, not them!"). A blow that is not a crime (the
// forgiven habit, a weave's accident) is screened by nobody, and "nobody screened it" read
// as "she saw it". Only what she sees: by the sight rule.
test('a blow nobody screened (an accident, the forgiven habit): Lyra reacts only if she saw it', () => {
  const g = makeMurderGame({ hour: 12 });
  clearScene(g, ['tobias']);
  const tob = g.entities.get('tobias');
  putAt(tob, g.player.x + 16, g.player.y);
  // Lyra far across the vale, out of sight.
  g.companion.x = g.player.x + 60 * 16;
  g.companion.y = g.player.y + 40 * 16;
  const a = g.companion.mind.autonomy;
  const said = [];
  const say = a.say.bind(a);
  a.say = (text, o) => {
    said.push(text);
    return say(text, o);
  };
  g.combat.damage(g.player, tob, 2, { kind: 'melee', habit: true });
  tob.invuln = 0;
  g.combat.damage(g.player, tob, 2, { kind: 'magic', accident: true });
  assert.deepEqual(said, [], 'she did not see it, so she says nothing about it');
  // Beside you, she does see: she says so.
  g.companion.x = g.player.x - 20;
  g.companion.y = g.player.y;
  tob.invuln = 0;
  a.npcHits?.clear?.();
  g.combat.damage(g.player, tob, 2, { kind: 'magic', accident: true });
  assert.ok(said.length >= 1, 'in sight, she reacts');
});
