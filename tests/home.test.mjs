// Finding your bed (r13 C1; the author: "I'm not able to find my bed"): the bed is marked
// "Your bed", the Menu has Home (an arrow at the screen's edge until you get there), and
// Lyra and the villagers can tell you where it is — offline too — and asking marks the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './survival_world.mjs';
import { asksForHome, homeBed, homeFacts, wayHomeLine, compass } from '../src/world/home.js';
import { edgePoint } from '../src/ui/home_pointer.js';
import { pauseItems } from '../src/ui/overlays.js';
import { homePlugin } from '../src/ai/plugins/home_plugin.js';

test('the questions that ask for home, and the ones that do not', () => {
  for (const q of ['where is my bed?', "Where's my bed", 'where do I sleep', 'where do i live?', 'how do I get home', 'how do i get back home', "I can't find my bed", 'i cant find my house', 'where is the wayhouse', 'which bed is mine?', 'take me home', 'show me the way home', 'where is home', 'where can I sleep?']) assert.ok(asksForHome(q), q);
  for (const q of ['where is the smithy?', 'go home', 'I love my home village', 'where is Bram', 'is this bed comfy', 'hello', 'where is your bed']) assert.ok(!asksForHome(q), q);
  assert.equal(compass(10, 0), 'east');
  assert.equal(compass(0, 10), 'south');
  assert.equal(compass(-10, -10), 'north-west');
});

test('the bed is "Your bed" in the Wayhouse, and the way there is said the same by everyone', () => {
  const g = makeGame({ hour: 12 });
  const bed = homeBed(g);
  assert.ok(bed, 'the player has a bed');
  assert.equal(bed.name, 'Your bed');
  assert.equal(bed.owner, 'player');
  assert.equal(g.locations.at(bed.x, bed.y - 8)?.id, 'player_home', 'in the Wayhouse');
  // From the square, far to the north-west of it.
  const sq = g.locations.get('town_square').center;
  const f = homeFacts(g, sq);
  assert.ok(f.ok && !f.inside);
  assert.equal(f.dir, 'south-east');
  assert.match(f.line, /Wayhouse/);
  assert.match(f.line, /south-east/);
  assert.match(wayHomeLine(g, sq, 'lyra'), /Wayhouse.*south-east/);
  assert.match(wayHomeLine(g, sq, 'elda'), /Wayhouse.*south-east/i);
  // Inside, it is "right here".
  const inside = homeFacts(g, { x: bed.x + 20, y: bed.y + 30 });
  assert.ok(inside.inside, 'standing in the Wayhouse');
  assert.match(wayHomeLine(g, { x: bed.x + 20, y: bed.y + 30 }, 'lyra'), /on the left/);
});

test('Lyra answers offline, and asking her marks the way (whoever words the answer)', async () => {
  const g = makeGame({ hour: 12 });
  const shown = [];
  g.ui.showHome = (r) => (shown.push(r), true);
  // The author's words were "I'm not able to find my bed"; before r13 she said "Bed? No idea".
  for (const q of ['where is my bed?', "I can't find my bed", 'where do I sleep?']) {
    shown.length = 0;
    const r = await g.brain.handlePlayerMessage(q);
    assert.match(r.say, /Wayhouse|on the left/, `${q} -> ${r.say}`);
    assert.doesNotMatch(r.say, /no idea|don't know/i);
    assert.deepEqual(shown, ['lyra'], `${q}: the way is marked`);
  }
  // Claude is told the facts only when the player asks, and gets the show_home action.
  const ctx = g.plugins.ctx;
  assert.equal(homePlugin.promptContext(ctx, 'how are you?'), '');
  assert.match(homePlugin.promptContext(ctx, 'where is my bed?'), /Wayhouse.*left as you come in/);
  assert.ok(g.actions.has?.('show_home') ?? g.actions.get?.('show_home'), 'show_home is an action Claude may call');
  const r = homePlugin.actions.show_home.run({}, ctx);
  assert.equal(r.ok, true);
  g.ui.showHome = () => false;
  assert.equal(homePlugin.actions.show_home.run({}, ctx).ok, false, 'the game checks there is a bed to show');
});

test('a villager tells you the way (offline) and the brief carries it for Claude', async () => {
  const g = makeGame({ hour: 12 });
  const shown = [];
  g.ui.showHome = (r) => (shown.push(r), true);
  const elda = g.entities.get('elda');
  const r = await g.village.playerSays(elda, 'where is my bed?');
  assert.equal(r.intent, 'home');
  assert.match(r.lines[0], /Wayhouse/);
  assert.deepEqual(shown, ['elda']);
  const brief = g.village.sayBrief(elda, 'where is my bed?', { intent: 'home', homeFact: homeFacts(g, elda).line, lines: [] });
  assert.match(brief.standing, /ask where their bed is.*Wayhouse/);
  const other = await g.village.playerSays(elda, 'how are you?');
  assert.notEqual(other.intent, 'home');
});

test('Menu → Home: one place in the menu, toggling the mark; the edge arrow sits on the edge', () => {
  const calls = [];
  const g = makeGame({ hour: 12 });
  const ui = { homePointer: { active: false, toggle: () => calls.push('toggle') }, openInventory() {}, openSettings() {}, quitToTitle() {}, mind: { tab: 'now' } };
  const items = pauseItems(g, ui);
  const home = items.find((i) => i.id === 'home');
  assert.ok(home, 'Home is in the menu');
  assert.equal(home.label, 'Home');
  assert.equal(items.filter((i) => i.id === 'home').length, 1);
  home.run({ close: () => calls.push('close') });
  assert.deepEqual(calls, ['close', 'toggle']);
  ui.homePointer.active = true;
  assert.equal(pauseItems(g, ui).find((i) => i.id === 'home').hint, 'Hide the way home');
  // A world without a bed of yours has no Home.
  assert.ok(!pauseItems({ ...g, objects: { list: [], get: () => null } }, ui).some((i) => i.id === 'home'));
  const e = edgePoint({ x: 2000, y: 300 }, 800, 600, 40);
  assert.equal(Math.round(e.x), 760);
  assert.equal(Math.round(e.y), 300, 'level with the middle');
  const n = edgePoint({ x: 400, y: -900 }, 800, 600, 40);
  assert.equal(Math.round(n.y), 40);
});
