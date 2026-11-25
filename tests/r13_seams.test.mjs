// Round 13's seams: where the three workstreams meet (minds A, the world with walls B, the
// home and interface C). Each test is a place where one workstream's rule has to hold inside
// another's: a wall stops the eye as it stops a blow, a felled tree hides nobody, a lamp under
// a roof lights no street, sleeping to morning breaks nobody's promise, "show me where my bed
// is" is not a lesson, a villager's silence marks no way home, and a smashed barrel is no
// workplace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../src/core/constants.js';
import { lineOfSight, lightAt } from '../src/murder/witness.js';
import { makeGame as makeMurderGame, put, clearScene, downBy } from './murder_world.mjs';
import { makeGame, placeAt } from './survival_world.mjs';
import { wayHomeLine } from '../src/world/home.js';
import { homePlugin } from '../src/ai/plugins/home_plugin.js';
import { seatFor } from '../src/world/rest.js';

const quiet = () => {
  const keep = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = () => {};
  return () => Object.assign(console, keep);
};

// A strip of open ground with one wall row at ty = 5 (a door at tx = 4) and two trees at
// tx = 10 and 12 on row 2: the eye and the blow share the wall rule (world/walls.js).
function strip({ doorOpen = false, stumps = false } = {}) {
  const tree = (tx, ty) => ({ objType: 'tree', state: { depleted: stumps }, blocksTile: () => true, tx, ty });
  const trees = [tree(10, 2), tree(12, 2)];
  return {
    map: { blocksProjectile: (tx, ty) => ty === 5 && tx !== 4 && tx >= 0 && tx <= 20, buildingAt: () => null },
    objects: {
      doorAt: (tx, ty) => (tx === 4 && ty === 5 ? { objType: 'door', isOpen: doorOpen, state: { open: doorOpen } } : null),
      objectsAt: (tx, ty) => trees.filter((t) => t.tx === tx && t.ty === ty),
    },
  };
}

test('sight follows the blow\'s wall rule: a shut door blocks the eye, an open one does not', () => {
  const y = (ty) => ty * TILE + TILE / 2;
  const x = 4 * TILE + TILE / 2;
  assert.equal(lineOfSight(strip({ doorOpen: false }), x, y(3), x, y(7)), false, 'through a shut door');
  assert.equal(lineOfSight(strip({ doorOpen: true }), x, y(3), x, y(7)), true, 'through the open doorway');
  assert.equal(lineOfSight(strip(), 2 * TILE + 8, y(3), 2 * TILE + 8, y(7)), false, 'through the wall');
});

test('a felled tree\'s stump hides nobody (two standing trees still do)', () => {
  const y = 2 * TILE + TILE / 2;
  assert.equal(lineOfSight(strip(), 8 * TILE, y, 14 * TILE, y), false, 'two trees in the way');
  assert.equal(lineOfSight(strip({ stumps: true }), 8 * TILE, y, 14 * TILE, y), true, 'two stumps in the way');
});

test('a lamp under a roof lights its room, not the street outside the wall (as the renderer\'s roofs)', () => {
  // A building over tiles x 0..9, y 0..9 (its front wall rows are y 7..9); night.
  const b = { id: 'chapel', x: 0, y: 0, w: 10, h: 10 };
  const lamp = (x, y) => ({ getLight: () => ({ x, y, r: 120, intensity: 1 }) });
  const at = (lx, ly) => ({
    clock: { daylight: 0, isNight: true },
    time: 0,
    map: { buildingAt: (tx, ty) => (tx >= 0 && ty >= 0 && tx < 10 && ty < 10 ? b : null) },
    objects: { inRadius: () => [lamp(lx, ly)] },
    entities: { all: () => [] },
    player: null,
  });
  const street = { x: 5 * TILE, y: 10 * TILE + 6 }; // just outside the front wall
  assert.equal(lightAt(at(5 * TILE, 5 * TILE), street.x, street.y), 0, 'the altar deep inside lights no street');
  assert.ok(lightAt(at(5 * TILE, 9 * TILE + 4), street.x, street.y) > 0.4, 'a lamp on the front wall still does');
});

test('no finishing blow through a wall (the same rule as every other blow)', () => {
  const back = quiet();
  const g = makeMurderGame({ hour: 12 });
  const map = g.map;
  // A one-tile wall with open ground straight above and below it.
  let spot = null;
  for (let ty = 4; ty < 140 && !spot; ty++) {
    for (let tx = 4; tx < 190 && !spot; tx++) {
      if (!map.blocksProjectile(tx, ty)) continue;
      if (map.isSolidTile(tx, ty - 1) || map.isSolidTile(tx, ty + 1) || g.objects.isBlockingTile(tx, ty - 1) || g.objects.isBlockingTile(tx, ty + 1)) continue;
      if (map.blocksProjectile(tx, ty - 1) || map.blocksProjectile(tx, ty + 1)) continue;
      spot = { tx, ty };
    }
  }
  assert.ok(spot, 'a one-tile wall somewhere in the village');
  const v = g.entities.get('tobias');
  clearScene(g, ['tobias']);
  const P = g.player;
  const cx = spot.tx * TILE + TILE / 2;
  put(P, cx, (spot.ty + 1) * TILE + 6);
  put(v, cx, spot.ty * TILE - 6);
  assert.ok(Math.hypot(v.x - P.x, v.y - P.y) <= 28, 'within a finishing blow\'s reach');
  downBy(g, v);
  P.faceDir?.('up');
  assert.equal(g.murder.finishTarget(P)?.id ?? null, null, 'not through the wall');
  // The same distance in the open: the blow is there to take.
  put(v, P.x - 22, P.y);
  P.faceDir?.('left');
  assert.equal(g.murder.finishTarget(P)?.id, 'tobias');
  back();
});

test('sleeping to morning breaks no promise: the day it is due moves with the skipped hours', () => {
  const back = quiet();
  const g = makeGame({ hour: 9 });
  const cm = g.village.commitments;
  cm.update(1.1); // the clock is seen once
  const c = cm.add({ by: 'elda', kind: 'tell', to: 'lyra', message: 'sorry', state: 'open', made: g.clock.t, day: g.village.day(), due: g.clock.t + 1.5 * 900 });
  c.retryAt = Infinity; // she has not set off yet
  const due = c.due;
  // Two nights' sleep at any hour, back to back.
  g.clock.skipTo(7);
  cm.update(1.1);
  g.clock.skipTo(7);
  cm.update(1.1);
  assert.notEqual(c.state, 'broken', 'still hers to keep');
  assert.ok(c.due > due + 900, 'its day moved with the clock');
  // The clock running on with no skip still breaks it, as before.
  g.clock.t = c.due + 2;
  cm._lastT = g.clock.t - 1;
  cm.update(1.1);
  assert.equal(c.state, 'broken');
  back();
});

test('"show me where my bed is" asks the way, not for a lesson; a silence marks no way home', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  const shown = [];
  g.ui.showHome = (r) => (shown.push(r), true);
  const elda = g.entities.get('elda');
  placeAt(g, g.player, elda.x + 18, elda.y);
  for (const q of ['can you show me where my bed is?', 'could you show me the way home?']) {
    shown.length = 0;
    const r = await g.village.playerSays(elda, q);
    assert.equal(r.intent, 'home', q);
    assert.match(r.lines[0], /Wayhouse/, q);
    assert.doesNotMatch(r.lines.join(' '), /teach|weaving/i, q);
    assert.deepEqual(shown, ['elda'], `${q}: the way is marked`);
  }
  // "Teach me" and "show me how to weave" are still asks for a lesson.
  assert.equal(g.village.commitments.detect(elda, 'teach me')?.kind, 'teach');
  assert.equal(g.village.commitments.detect(elda, 'show me how to weave')?.kind, 'teach');
  assert.equal(g.village.commitments.detect(elda, 'show me the way to the smithy'), null);
  // Claude has them say nothing (and the game sees a reason): no mark.
  const v = g.village;
  v.provider = () => ({ id: 'fake' });
  v.askClaude = async () => ({ say: '', silent: true, mood: 'cold', opinion_delta: -1, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null });
  elda.opinionOfPlayer = 5;
  shown.length = 0;
  const s = await v.playerSays(elda, 'where is my bed?');
  assert.equal(s.silent, true);
  assert.deepEqual(shown, [], 'she said nothing; nothing is marked');
  back();
});

test('Lyra: "our cottage" only while she sleeps there; cut off, asking her marks nothing', async () => {
  const back = quiet();
  const g = makeGame({ hour: 12 });
  const L = g.companion;
  const sq = g.locations.get('town_square').center;
  L.mind.agenda.sleepAt = 'lyra_bed';
  assert.match(wayHomeLine(g, sq, 'lyra', 0), /\bour cottage/);
  L.mind.agenda.sleepAt = 'lyra_inn_bed';
  for (let i = 0; i < 2; i++) assert.doesNotMatch(wayHomeLine(g, sq, 'lyra', i), /\bour cottage|Mine's the far one/);
  const ctx = g.plugins.ctx;
  assert.match(homePlugin.promptContext(ctx, 'where is my bed?'), /Ember Kettle/);
  // Together, asking her marks the way; once she has cut the player off, it does not.
  const shown = [];
  g.ui.showHome = (r) => (shown.push(r), true);
  placeAt(g, L, g.player.x + 24, g.player.y);
  await g.brain.handlePlayerMessage('where is my bed?');
  assert.deepEqual(shown, ['lyra']);
  shown.length = 0;
  L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  await g.brain.handlePlayerMessage('where is my bed?');
  assert.deepEqual(shown, [], 'her word (or her silence) is the whole answer');
  assert.match(homePlugin.promptContext(ctx, 'where is my bed?'), /not marked[^]*only if you choose/);
  back();
});

test('a smashed prop is nobody\'s workplace or seat until it is mended', () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  // Garrick works at shelves, crates, barrels and tables: break every crate and barrel in
  // his shop, and his work spot is never beside one of them.
  const garrick = g.entities.get('garrick');
  const entry = (garrick.profile.schedule || []).find((e) => e.activity === 'work');
  assert.ok(entry, 'Garrick has a working hour');
  const loc = garrick.locFor(entry.at);
  const props = garrick.objectsIn(loc, ['crate', 'barrel']);
  for (const o of props) o.state.broken = true;
  for (let i = 0; i < 8; i++) {
    const sp = garrick.spotFor(entry, i > 0);
    if (!sp) continue;
    for (const o of props) assert.ok(Math.hypot(sp.x - o.x, sp.y - o.y) > 6, 'not working at rubble');
  }
  // A seat with state.broken (the shape breakables use) has no seat to give.
  const chair = g.objects.all().find((o) => o.objType === 'chair');
  assert.ok(seatFor(chair), 'a whole chair seats you');
  chair.state.broken = true;
  assert.equal(JSON.stringify(seatFor(chair)), 'null');
  chair.state.broken = false;
  back();
});
