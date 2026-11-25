import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, placeAt, wolf, villagers } from './survival_world.mjs';
import { TILE } from '../src/core/constants.js';
import { CRAWL_SPEED, CRAWL_BUDGET, NPC_CRAWL, RATE } from '../src/survival/constants.js';
import { paintHumanoid, CRAWL_ANIM, CRAWL_STEP, FRAME } from '../src/art/characters_humanoid.js';
import { PRESET_APPEARANCES } from '../src/art/characters_appearance.js';

// A heavier death (DESIGN §27, round 14): the countdown you can read, the crawl, the
// ember-ring your coins stay in, and the last stand.

const at = (g, id) => g.locations.get(id).center;

function alone(g) {
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  g.survival.lyraForVillager = () => {};
}

function banish(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    placeAt(g, v, 141 * TILE, 101 * TILE);
    v.think = () => {};
  }
}

function lyraAway(g, x, y) {
  const L = g.companion;
  placeAt(g, L, x, y);
  L.behavior.setDirective({ type: 'stay', x, y });
}

function fell(g) {
  const P = g.player;
  const w = wolf(g, P.x + 12, P.y);
  g.combat.damage(w, P, 999);
  w.removed = true;
  return g.survival.fallOf(P);
}

// ---------------------------------------------------------------- D2: the crawl

function opaque(sp) {
  const px = sp.render();
  const out = [];
  for (let i = 0; i < FRAME * FRAME; i++) if (px[i * 4 + 3] > 0) out.push(i);
  return { px, set: out };
}

test('the crawl is painted in every direction: four distinct frames, arms reaching past the head, lower than standing', () => {
  for (const key of ['player', 'lyra', 'villager']) {
    const a = { ...PRESET_APPEARANCES[key], key };
    for (const dir of ['down', 'left', 'right', 'up']) {
      const frames = [];
      for (let f = 0; f < CRAWL_ANIM.frames; f++) frames.push(opaque(paintHumanoid(a, 'crawl', dir, f)));
      for (const fr of frames) assert.ok(fr.set.length > 120, `${key} ${dir}: a whole body (${fr.set.length} px)`);
      const sig = frames.map((fr) => fr.set.join(','));
      assert.equal(new Set(sig).size, CRAWL_ANIM.frames, `${key} ${dir}: every frame differs (the limbs move)`);
      const lying = opaque(paintHumanoid(a, 'down', dir, 0)).set.join(',');
      assert.ok(!sig.includes(lying), `${key} ${dir}: not the plain lying pose`);
      const standing = opaque(paintHumanoid(a, 'idle', dir, 0));
      const top = (fr) => Math.floor(fr.set[0] / FRAME);
      if (dir === 'up' || dir === 'down') {
        // Laid on the ground: the body takes less height than standing.
        for (const fr of frames) assert.ok(top(fr) > top(standing) + 1, `${key} ${dir}: lower than standing (${top(fr)} vs ${top(standing)})`);
      } else {
        // Laid along the ground: wider than tall.
        for (const fr of frames) {
          const xs = fr.set.map((i) => i % FRAME);
          const ys = fr.set.map((i) => Math.floor(i / FRAME));
          assert.ok(Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys), `${key} ${dir}: lying along the ground`);
        }
      }
    }
  }
});

test('the player drags themselves: slow, the frame follows the distance, blood smears behind; carried or revived, the pose is gone', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  banish(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraAway(g, m.x + 900, m.y);
  const rec = fell(g);
  assert.equal(P.crawlPose, null, 'lying still: the fallen pose');
  const marks0 = g.survival.trail.marks.length;
  assert.ok(marks0 >= 1, 'a pool where they fell');
  step(g, 2.5); // the slow-motion beat passes
  g.input.move = { x: 1, y: 0 };
  const x0 = P.x;
  const frames = new Set();
  for (let i = 0; i < 40; i++) {
    step(g, 0.05);
    if (P.crawlPose) frames.add(P.crawlPose.frame);
  }
  const moved = P.x - x0;
  assert.ok(moved > 0.8 * 2 * CRAWL_SPEED && moved < 1.1 * 2 * CRAWL_SPEED, `about ${CRAWL_SPEED} px a second (${moved.toFixed(1)} in 2 s)`);
  assert.ok(CRAWL_SPEED * 4 < (P.speed || 60), 'far slower than walking');
  assert.equal(frames.size, CRAWL_ANIM.frames, 'the whole cycle plays');
  assert.equal(P.crawlPose.frame, Math.floor(rec.crawled / CRAWL_STEP) % CRAWL_ANIM.frames, 'the frame is the distance');
  assert.equal(P.dir, 'right', 'facing the way they crawl');
  assert.ok(g.survival.trail.marks.length >= marks0 + Math.floor(moved / 3), `a smear behind them (${g.survival.trail.marks.length - marks0} marks)`);
  assert.ok(g.survival.trail.marks.every((mk) => mk.x <= P.x + 1), 'the smear is behind, not ahead');
  assert.equal(g.survival.rateOf(rec), RATE.crawling, 'crawling opens the wound');
  // Stop: the pose holds (face down) and the drain eases.
  g.input.move = { x: 0, y: 0 };
  step(g, 0.2);
  assert.ok(P.crawlPose, 'still face down where they stopped');
  assert.equal(g.survival.rateOf(rec), RATE.alone);
  // Out of room: no further.
  g.input.move = { x: 0, y: 1 };
  step(g, 12);
  assert.ok(rec.crawled <= CRAWL_BUDGET + 0.5, `only a little (${rec.crawled.toFixed(1)})`);
  // Revived: back on their feet, the crawl pose cleared.
  g.input.move = { x: 0, y: 0 };
  g.combat.revive(P, null, 0.5);
  step(g, 0.1);
  assert.ok(!P.downed);
  assert.equal(P.crawlPose, null);
});

test('a villager on the ground drags themselves away from whoever stands over them, slower still, and leaves blood', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const m = at(g, 'south_meadow');
  banish(g, ['hobb']);
  lyraAway(g, m.x + 1200, m.y);
  placeAt(g, g.player, m.x - 400, m.y);
  const hobb = g.entities.get('hobb');
  placeAt(g, hobb, m.x, m.y);
  hobb.think = () => {};
  const w = wolf(g, m.x + 14, m.y);
  w.think = () => {};
  w.update = () => {};
  g.combat.damage(w, hobb, 999);
  assert.ok(hobb.downed, 'down');
  const rec = g.survival.fallOf(hobb);
  assert.ok(rec);
  const d0 = Math.hypot(hobb.x - w.x, hobb.y - w.y);
  step(g, 3);
  const d1 = Math.hypot(hobb.x - w.x, hobb.y - w.y);
  assert.ok(d1 > d0 + 0.6 * 3 * CRAWL_SPEED * NPC_CRAWL, `away from the wolf (${d0.toFixed(1)} -> ${d1.toFixed(1)})`);
  assert.ok(d1 - d0 < 3 * CRAWL_SPEED * NPC_CRAWL + 2, 'slowly');
  assert.ok(hobb.crawlPose && Number.isInteger(hobb.crawlPose.frame), 'in the crawl');
  assert.ok(g.survival.trail.marks.length > 4, 'blood behind them');
  step(g, 20);
  assert.ok(rec.crawled <= CRAWL_BUDGET + 0.5, 'a little, then no further');
  // Nobody over them: they lie still.
  w.removed = true;
  const x = hobb.x;
  rec.crawled = 0;
  step(g, 2);
  assert.ok(Math.abs(hobb.x - x) < 0.01, 'no danger, no crawl');
});
