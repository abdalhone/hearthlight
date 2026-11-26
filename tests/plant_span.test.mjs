// The plant measure in followup_check (item 27, casting stops you): on a slow phone the
// frames are sparse, so the planted frames only bound the plant from below; the frames on
// either side bound it from above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plantBracket } from '../scripts/plant_span.mjs';

const rows = (pairs) => pairs.map(([t, plant]) => ({ t, plant }));

test('a smooth 60 fps run: the bracket is tight around the plant', () => {
  const s = [];
  for (let i = 0; i < 40; i++) {
    const t = i * 16.7;
    s.push({ t, plant: t >= 100 && t < 317 ? 0.2 : 0 });
  }
  const b = plantBracket(s);
  assert.ok(b.lo >= 190 && b.lo <= 217, `lo ${b.lo}`);
  assert.ok(b.hi >= 217 && b.hi <= 255, `hi ${b.hi}`);
  assert.equal(b.frames, 13);
});

test('a throttled phone: two planted frames 100 ms apart still bracket a 217 ms plant', () => {
  // The sideways 4x-CPU run of followup_check: the plant was 217 ms of game time, drawn on two
  // frames 100 ms apart, with long frames either side. The old measure read "100 ms" and failed.
  const b = plantBracket(rows([[0, 0], [90, 0], [200, 0.2], [300, 0.1], [430, 0], [470, 0]]));
  assert.equal(b.lo, 100);
  assert.equal(b.hi, 340);
  assert.ok(b.lo <= 217 && b.hi >= 217);
  assert.equal(b.frames, 2);
});

test('no plant at all: nothing to bracket', () => {
  assert.deepEqual(plantBracket(rows([[0, 0], [16, 0]])), { lo: 0, hi: 0, frames: 0 });
  assert.deepEqual(plantBracket(null), { lo: 0, hi: 0, frames: 0 });
});

test('only the first run of planted frames counts (a second cast later is its own plant)', () => {
  const b = plantBracket(rows([[0, 0], [20, 0.2], [40, 0.1], [60, 0], [80, 0.2], [100, 0]]));
  assert.equal(b.lo, 20);
  assert.equal(b.hi, 60);
  assert.equal(b.frames, 2);
});
