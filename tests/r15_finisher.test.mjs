// Round 15, item 13 (DESIGN §40.3). The author: "if I finish someone, there is still no
// cutscene of me killing them." A finisher now plays a short killing scene (2-4 s): your own
// character raises the blade and drives it home (its sprite's attack frames, or the weaving
// hands), the victim's last moment and fall, a beat of slowed time, then back to play exactly
// where you were. It never stalls or traps you: a skip ends it at once, a wall clock guards it,
// reduce motion plays a short still one. The death itself is the strike's, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, downBy } from './murder_world.mjs';
import { SCENE, poseAt, victimKind, finisherById } from '../src/murder/finishers.js';
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

function strike(g, id, points = { might: 6 }) {
  g.progression = g.progression || {};
  g.progression.points = { ...points };
  const v = g.entities.get(id);
  v.think = () => {};
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  put(v, g.player.x + 14, g.player.y);
  g.player.faceToward(v.x, v.y);
  downBy(g, v);
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(g.player), true);
  let scene = null;
  g.bus.on('finisher', () => (scene = g._finisherScene));
  for (let t = 0; t < FINISH_HOLD + 0.4 && !scene; t += 1 / 20) step(g, 1 / 20, 1 / 20);
  g.input.down = () => false;
  return { v, scene };
}

test('a full finisher is a 2-4 s scene: raise, drive home, the fall, then back where you were', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram']);
  g.settings.finishers = 'full';
  const { v, scene } = strike(g, 'bram');
  assert.ok(scene, 'a scene plays');
  assert.ok(v.dead, 'the death is at the strike, as before');
  assert.ok(scene.dur >= 2 && scene.dur <= 4, `about 2-4 s (${scene.dur})`);
  assert.equal(scene.kind, 'person');
  const at = { x: g.player.x, y: g.player.y };
  const seen = [];
  let slow = 1;
  for (let i = 0; i < 80 && !scene.removed; i++) {
    step(g, 1 / 20, 1 / 20);
    if (g.player._finisherPose) seen.push(`${g.player._finisherPose.anim}:${g.player._finisherPose.frame}`);
    slow = Math.min(slow, g.timeScale ?? 1);
  }
  assert.ok(scene.removed, 'it ends on its own');
  assert.equal(scene.ended, 'done');
  assert.ok(seen.includes('attack:0') && seen.includes('attack:3'), `the blade is raised, then driven home (${[...new Set(seen)].join(' ')})`);
  assert.ok(seen.indexOf('attack:0') < seen.indexOf('attack:3'));
  assert.ok(slow < 0.5, 'a beat of slowed time');
  assert.equal(g.timeScale ?? 1, 1, 'the pace comes back');
  assert.equal(g.player._finisherPose, null);
  assert.deepEqual({ x: g.player.x, y: g.player.y }, at, 'exactly where you were');
  assert.equal(g._finisherScene ?? null, null);
});

test('a skip ends it at once (input or the page), and the pace comes back', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['elda']);
  g.settings.finishers = 'full';
  const { scene } = strike(g, 'elda');
  step(g, 0.3, 1 / 20);
  assert.equal(scene.removed, false);
  scene.skip();
  assert.equal(scene.removed, true);
  assert.equal(scene.ended, 'skipped');
  assert.equal(g.timeScale ?? 1, 1);
  assert.equal(g.player._finisherPose, null);
});

test('a stalled clock never holds you: the wall clock ends it', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['elda']);
  const { scene } = strike(g, 'elda');
  scene.wall0 -= scene.dur + 5; // as if the page had hung for seconds
  step(g, 1 / 20, 1 / 20);
  assert.equal(scene.removed, true);
  assert.equal(scene.ended, 'guard');
});

test('reduce motion: a short still scene (no slowed time), the same death', () => {
  const g = makeGame({ hour: 12, settings: { reduceMotion: true } });
  g.settings.reduceMotion = true;
  quiet(g, ['bram']);
  const { v, scene } = strike(g, 'bram');
  assert.ok(v.dead);
  assert.ok(scene.brief && scene.dur < 1.2, `brief (${scene.dur})`);
  let slow = 1;
  for (let i = 0; i < 40 && !scene.removed; i++) {
    step(g, 1 / 20, 1 / 20);
    slow = Math.min(slow, g.timeScale ?? 1);
  }
  assert.equal(slow, 1, 'no slowed time');
  assert.ok(scene.removed);
});

test('the pose follows the build: a weave build raises the weaving hands; victims read by kind', () => {
  const magic = finisherById('magic');
  const sword = finisherById('sword');
  const T = { RAISE: SCENE.RAISE, DRIVE: SCENE.DRIVE, FALL: SCENE.FALL, FULL: SCENE.FULL };
  assert.equal(poseAt(magic, 0.1, T).anim, 'cast');
  assert.equal(poseAt(sword, 0.1, T).anim, 'attack');
  assert.equal(poseAt(sword, T.FULL - 0.05, T), null, 'back to your own pose for the way out');
  const g = { companion: { id: 'lyra' } };
  assert.equal(victimKind(g, g.companion), 'lyra');
  assert.equal(victimKind(g, { id: 'bram', profile: { id: 'bram' } }), 'person');
  assert.equal(victimKind(g, { species: 'bandit' }), 'bandit');
  assert.equal(victimKind(g, { species: 'wolf' }), 'beast');
});

test('never a child: the blow is refused, so no scene', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['pip']);
  const pip = g.entities.get('pip');
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  put(pip, g.player.x + 14, g.player.y);
  downBy(g, pip);
  g.input.down = (a) => a === 'attack';
  g.murder.onAttackPress(g.player);
  step(g, FINISH_HOLD + 0.5, 1 / 20);
  assert.equal(g._finisherScene ?? null, null);
  assert.ok(!pip.dead);
});
