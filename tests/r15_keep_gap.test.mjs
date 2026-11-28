// Round 15, item 4 (DESIGN §40.4; the author: "people who are wary of you just say so, they
// don't keep their distance"): played in the real headless Hearthvale. Someone wary keeps a
// few tiles and faces you; pressed, they walk off; they still hear and answer; a child keeps
// a wider gap; someone who likes you lets you stand beside them; nobody jitters.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, put, villagers, holdLyra } from './murder_world.mjs';
import { gapFor, GAP } from '../src/ai/social/keep_gap.js';
import { TILE } from '../src/core/constants.js';

const FAR = { x: 141 * TILE, y: 101 * TILE };
// The square at noon, everyone but `keep` far off and still.
function square(g, keep) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, FAR.x, FAR.y);
    v.think = () => {};
  }
  holdLyra(g, FAR.x, FAR.y + 80);
  return g.locations.get('town_square').center;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('item 4: the gap by who they are to you: none when they like you; wary 3; cold 4.5; dread 6; a child one more', () => {
  const g = makeGame({ hour: 12 });
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 60;
  assert.equal(gapFor(g, bram), null);
  bram.opinionOfPlayer = 22;
  assert.deepEqual([gapFor(g, bram).why, gapFor(g, bram).tiles], ['wary', GAP.wary]);
  bram.opinionOfPlayer = 8;
  assert.deepEqual([gapFor(g, bram).why, gapFor(g, bram).tiles], ['cold', GAP.cold]);
  bram.opinionOfPlayer = 60;
  bram.dread = true;
  assert.deepEqual([gapFor(g, bram).why, gapFor(g, bram).tiles], ['dread', GAP.dread]);
  bram.dread = false;
  const pip = g.entities.get('pip');
  pip.opinionOfPlayer = 20;
  assert.equal(gapFor(g, pip).tiles, GAP.wary + 1, 'a child keeps a wider gap');
  // On a companion's duty: never.
  bram.opinionOfPlayer = 22;
  bram.duty = { step: () => undefined };
  assert.equal(gapFor(g, bram), null);
});

test('item 4: walk at a wary villager: they step back, keep about three tiles and face you; nothing jitters', () => {
  const g = makeGame({ hour: 12 });
  const sq = square(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 22;
  put(bram, sq.x, sq.y);
  bram.think = Object.getPrototypeOf(bram).think.bind(bram);
  const P = g.player;
  put(P, sq.x + 1.2 * TILE, sq.y);
  const d0 = dist(P, bram);
  step(g, 3);
  const d1 = dist(P, bram);
  assert.ok(d1 > d0 + TILE, `he stepped back: ${Math.round(d0)} -> ${Math.round(d1)} px`);
  assert.ok(d1 >= GAP.wary * TILE - 6, `about three tiles: ${Math.round(d1)} px`);
  // Then he holds there, facing you (no back-and-forth).
  const xs = [];
  for (let i = 0; i < 20; i++) {
    step(g, 0.1);
    xs.push(bram.x);
  }
  const spread = Math.max(...xs) - Math.min(...xs);
  assert.ok(spread < 6, `standing still at the gap (moved ${spread.toFixed(1)} px in 2 s)`);
  const fx = bram.facing?.x ?? 0;
  const fy = bram.facing?.y ?? 0;
  const toP = { x: P.x - bram.x, y: P.y - bram.y };
  assert.ok(fx * toP.x + fy * toP.y > 0, 'facing you');
});

test('item 4: close in again and again: a wary villager walks off rather than let you stand beside them', () => {
  const g = makeGame({ hour: 12 });
  const sq = square(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 22;
  put(bram, sq.x, sq.y);
  const P = g.player;
  put(P, sq.x + 2 * TILE, sq.y);
  let closest = Infinity;
  let left = false;
  let beside = 0; // seconds within a tile of him
  for (let i = 0; i < 80; i++) {
    // The player keeps walking straight at him.
    const dx = bram.x - P.x;
    const dy = bram.y - P.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 10) put(P, P.x + (dx / d) * 5, P.y + (dy / d) * 5); // walking up to him, 50 px/s
    step(g, 0.1);
    closest = Math.min(closest, dist(P, bram));
    if (dist(P, bram) < TILE) beside += 0.1;
    if (g.clock.t < (bram._gap?.leaveUntil ?? -Infinity)) left = true;
  }
  assert.ok(left, 'he walked off');
  assert.ok(beside <= 1, `never beside you for long (${beside.toFixed(1)} s within a tile; closest ${Math.round(closest)} px)`);
});

test('item 4: talking is never locked: a wary villager hears you from where they stand and answers; talking, they let you to talking distance', async () => {
  const g = makeGame({ hour: 12 });
  const sq = square(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 22;
  put(bram, sq.x, sq.y);
  const P = g.player;
  put(P, sq.x + 3.2 * TILE, sq.y);
  step(g, 0.5);
  const r = await g.village.playerSays(bram, 'Good day, Bram. Can we talk?');
  assert.ok(r, 'he heard you');
  assert.ok((r.lines && r.lines.length) || r.silent || r.reply, `he answered from where he stands: ${JSON.stringify(r).slice(0, 200)}`);
  // While you talk (the chat holds him), the gap shrinks to talking distance.
  bram.talkingUntil = g.clock.t + 10;
  assert.equal(gapFor(g, bram).tiles, GAP.wary - 1);
});

test('item 4: someone fond of you lets you stand right beside them', () => {
  const g = makeGame({ hour: 12 });
  const sq = square(g, ['bram']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 80;
  put(bram, sq.x, sq.y);
  const P = g.player;
  put(P, sq.x + 1.2 * TILE, sq.y);
  step(g, 2);
  assert.ok(!bram._gap?.active, 'no gap kept');
});
