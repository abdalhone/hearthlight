// Finishers that adapt to your build (round 14b, item 10; DESIGN §35.4). The author: "If I am
// more of a sword build … the kill will be with sword … more into magic … I will shoot his
// head with magic. Or if they are close … both … if we add arrows … the kill animation
// would change". A registry, a build read from points, gear, recent blows and weaves; the
// kill itself unchanged; a setting to turn the scene off.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, downBy, events } from './murder_world.mjs';
import { buildOf, chooseFinisher, registerFinisher, unregisterFinisher, finisherMode, finishers } from '../src/murder/finishers.js';
import { FINISH_HOLD } from '../src/murder/data.js';

const WOODS = { tx: 62, ty: 14 };

function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

function setPoints(g, pts) {
  g.progression = g.progression || {};
  g.progression.points = { ...pts };
}

test('buildOf reads the build: might makes a sword, weave makes magic, close makes both', () => {
  const g = makeGame({ hour: 12 });
  setPoints(g, { might: 8, weave: 0, focus: 0 });
  assert.equal(buildOf(g).kind, 'sword');
  assert.equal(chooseFinisher(g).id, 'sword');
  setPoints(g, { might: 0, weave: 7, focus: 3 });
  assert.equal(buildOf(g).kind, 'magic');
  assert.equal(chooseFinisher(g).id, 'magic');
  setPoints(g, { might: 4, weave: 4, focus: 0 });
  assert.equal(buildOf(g).kind, 'hybrid');
  assert.equal(chooseFinisher(g).id, 'hybrid');
  assert.ok(buildOf(g).why.length >= 1, 'explainable');
  assert.deepEqual(finishers().map((f) => f.id).slice(0, 3), ['sword', 'magic', 'hybrid']);
});

test('registerFinisher: a future bow takes part and wins for a bow build', () => {
  const g = makeGame({ hour: 12 });
  setPoints(g, { might: 8 });
  registerFinisher({ id: 'bow', label: 'The arrow', score: (b, game) => (game.flags.bowBuild ? 99 : -1), draw() {} });
  try {
    assert.equal(chooseFinisher(g).id, 'sword');
    g.flags.bowBuild = true;
    assert.equal(chooseFinisher(g).id, 'bow');
  } finally {
    unregisterFinisher('bow');
  }
});

function killHeld(g, id) {
  const v = g.entities.get(id);
  put(v, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  g.player.faceToward(v.x, v.y);
  downBy(g, v);
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(g.player), true);
  step(g, FINISH_HOLD + 0.3, 1 / 20);
  return { v, rec: g.murder.dead[id] };
}

test("'off' gives the same death with no scene; 'full' lays a scene over it; reduce motion is brief", () => {
  const a = makeGame({ hour: 12 });
  quiet(a, ['bram']);
  a.settings.finishers = 'off';
  setPoints(a, { might: 6 });
  const ra = killHeld(a, 'bram');
  assert.ok(ra.rec && ra.v.dead, 'dead');
  assert.equal(a.entities.all().filter((e) => String(e.id).startsWith('finisher_')).length, 0, 'no scene');
  assert.equal(ra.rec.finisher, 'sword', 'the body still bears the blade');
  const b = makeGame({ hour: 12 });
  quiet(b, ['bram']);
  b.settings.finishers = 'full';
  setPoints(b, { might: 6 });
  let scene = null;
  b.bus.on('finisher', (p) => (scene = p));
  const rb = killHeld(b, 'bram');
  assert.ok(rb.rec && rb.v.dead);
  assert.equal(scene?.id, 'sword');
  assert.equal(scene?.mode, 'full');
  // The same death either way: who saw it, the cause, who did it.
  assert.deepEqual(ra.rec.seen, rb.rec.seen);
  assert.equal(ra.rec.cause, rb.rec.cause);
  assert.equal(ra.rec.by, 'player');
  // The scene ends on its own and the world's pace comes back.
  step(b, 3, 1 / 20);
  assert.equal(b.timeScale ?? 1, 1);
  assert.equal(b._finisherScene ?? null, null);
  // Reduce motion: brief.
  b.settings.reduceMotion = true;
  assert.equal(finisherMode(b), 'brief');
  b.settings.finishers = 'off';
  assert.equal(finisherMode(b), 'off');
});

test('rec.finisher survives a save, and the blade mark is drawn with the body', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['elda']);
  setPoints(g, { weave: 9 });
  const { rec } = killHeld(g, 'elda');
  assert.equal(rec.finisher, 'magic');
  const data = JSON.parse(JSON.stringify(g.murder.serialize()));
  const h = makeGame({ hour: 12 });
  h.murder.deserialize(data);
  assert.equal(h.murder.dead.elda.finisher, 'magic');
});

test('the last stand: the blow falls on any adult, Lyra included, without a warning; never a child', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['pip', 'lyra']);
  g.prices = { burning: () => true, lastStandArmed: () => false };
  g.flags.finisherWarned = false;
  g.flags.finisherWarnedLyra = false;
  let asked = 0;
  g.ui.confirm = () => {
    asked++;
    return Promise.resolve(true);
  };
  const L = g.companion;
  if (L._heldController) L.controller = L._heldController;
  put(L, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  g.player.faceToward(L.x, L.y);
  L.hp = 1;
  g.combat.damage(g.player, L, 99, { exact: true, crit: false });
  g.input.down = (a) => a === 'attack';
  g.murder.onAttackPress(g.player);
  step(g, FINISH_HOLD + 0.3, 1 / 20);
  assert.equal(asked, 0, 'the burning minute asks nothing');
  assert.ok(g.murder.isDead('lyra'), 'Lyra dies');
  const pip = g.entities.get('pip');
  put(pip, g.player.x + 10, g.player.y);
  pip.hp = 1;
  g.combat.damage(g.player, pip, 99, { exact: true, crit: false });
  g.player.faceToward(pip.x, pip.y);
  g.murder.onAttackPress(g.player);
  step(g, FINISH_HOLD + 0.3, 1 / 20);
  assert.ok(!pip.dead, 'never a child');
  assert.ok(events(g, 'villager_killed').every((e) => e.id !== 'pip'));
});
