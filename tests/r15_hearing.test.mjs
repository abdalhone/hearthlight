// Round 15, item 5 (DESIGN §40.5; the author: "sound passes through trees"): trees, bushes and
// the forest floor muffle sound in the one hearing rule (src/ai/hearing.js), and a sound finds
// its way out through any number of openings (a back room's gap, then the front door), not
// only through one open door. Played in the real headless Hearthvale.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put, villagers, holdLyra } from './murder_world.mjs';
import { hears, leavesBetween, leafShare, LOUD, LEAF_MUFFLED, wallsBetween, heardFrom } from '../src/ai/hearing.js';
import { wallTile } from '../src/world/walls.js';

const FAR = { x: px(141), y: px(101) };
function only(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, FAR.x, FAR.y);
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, FAR.x, FAR.y + 80);
}

const treeAt = (g, tx, ty) => (g.objects.objectsAt(tx, ty) || []).find((o) => o.objType === 'tree' && !o.state?.depleted && !o.removed);

// Two open spots in Whisperwood about `tiles` apart on a row, with at least `trees` standing
// trees on the line between and no wall; and a row of open ground (no trees) for comparison.
function woodLine(g, tiles = 14, trees = 3) {
  for (let ty = 4; ty < 34; ty++) {
    for (let tx = 30; tx < 120 - tiles; tx++) {
      const a = [tx, ty];
      const b = [tx + tiles, ty];
      if (wallTile(g, ...a) || wallTile(g, ...b) || g.isBlockedTile(...a) || g.isBlockedTile(...b)) continue;
      let n = 0;
      let wall = false;
      for (let x = tx + 1; x < tx + tiles; x++) {
        if (wallTile(g, x, ty)) wall = true;
        if (treeAt(g, x, ty)) n++;
      }
      if (!wall && n >= trees) return { a, b, n };
    }
  }
  return null;
}

test('item 5: a cry across a stand of trees is muffled or lost; the same distance in the open is clear', () => {
  const g = makeGame({ hour: 12 });
  only(g, ['mira']);
  const mira = g.entities.get('mira');
  const line = woodLine(g, 14, 3);
  assert.ok(line, 'a line through Whisperwood with trees on it');
  put(mira, px(line.a[0]), px(line.a[1]));
  const sx = px(line.b[0]);
  const sy = px(line.b[1]);
  const d = Math.hypot(sx - mira.x, sy - mira.y);
  assert.ok(d < LOUD.shout, `${Math.round(d)} px is inside a shout's open-air reach (a cry's, ${LOUD.cry}, easily)`);
  const w = leavesBetween(g, mira.x, mira.y - 6, sx, sy - 6);
  assert.ok(w >= LEAF_MUFFLED, `trees between: ${w}`);
  const how = hears(g, mira, sx, sy, LOUD.cry);
  assert.ok(how === 'muffled' || how === null, `through the trees: ${how}`);
  // The same cry with the trees felled: clear again.
  const felled = [];
  for (let x = line.a[0] + 1; x < line.b[0]; x++) {
    const t = treeAt(g, x, line.a[1]);
    if (t) {
      t.state.depleted = true;
      felled.push(t);
    }
  }
  const w2 = leavesBetween(g, mira.x, mira.y - 6, sx, sy - 6);
  assert.ok(w2 < LEAF_MUFFLED, `stumps do not muffle (${w2} left: the forest floor)`);
  assert.equal(hears(g, mira, sx, sy, LOUD.cry), 'clear', 'stumps let it through');
  for (const t of felled) t.state.depleted = false;
  // In the open square at the same distance: clear, as always.
  const sq = g.locations.get('town_square').center;
  put(mira, sq.x, sq.y);
  assert.equal(hears(g, mira, sq.x + d, sq.y, LOUD.cry), 'clear');
});

test('item 5: one tree between shortens the reach a little and stays clear; a whole wood no more than LEAF_MIN', () => {
  assert.equal(leafShare(0), 1);
  assert.ok(leafShare(1) < 1 && leafShare(1) >= 0.75);
  assert.ok(leafShare(20) >= 0.25 && leafShare(20) <= 0.26);
});

test('item 5: words said to someone (talk) are not cut by trees; only walls keep them', () => {
  const g = makeGame({ hour: 12 });
  only(g, ['mira']);
  const mira = g.entities.get('mira');
  const line = woodLine(g, 6, 2);
  assert.ok(line);
  put(mira, px(line.a[0]), px(line.a[1]));
  const sx = px(line.b[0]);
  const sy = px(line.b[1]);
  assert.equal(hears(g, mira, sx, sy, 7.5 * 16 + 16, { leaves: false }), 'clear');
});

test("item 5: a scream in the Kettle's back room reaches the street through the room's gap and the open front door (two openings)", () => {
  const g = makeGame({ hour: 12 });
  only(g, ['mira']);
  const mira = g.entities.get('mira');
  const door = g.objects.doorAt(70, 53);
  assert.ok(door, 'the Kettle front door');
  // A back room (the partition at row 45 has a gap at x 67).
  assert.ok(wallTile(g, 66, 45) && !wallTile(g, 67, 45), 'the back room has its gap');
  const src = { x: px(66), y: px(42) };
  put(mira, px(70), px(57));
  // Shut: nothing (two walls and more than a third of the reach).
  door.state.open = false;
  door.autoClose = false;
  assert.equal(hears(g, mira, src.x, src.y, LOUD.scream), null, 'door shut: not heard in the street');
  // Open: out through the gap and the door, muffled.
  door.state.open = true;
  assert.ok(wallsBetween(g, mira.x, mira.y - 6, src.x, src.y - 6) >= 1, 'a wall on the straight line (the partition)');
  assert.equal(hears(g, mira, src.x, src.y, LOUD.scream), 'muffled', 'through the gap and the open door');
  // The village's own ears agree (heardFrom is what a cry uses).
  const who = heardFrom(g, src.x, src.y, LOUD.scream, [mira]);
  assert.deepEqual(who.map((x) => [x.id, x.how]), [['mira', 'muffled']]);
  door.state.open = false;
});
