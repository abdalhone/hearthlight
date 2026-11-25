// The chapel's lights stay inside (DESIGN §31.5): a light under a roof shows only as much
// as the roof lets through; windows and lamps on the front wall always glow to the street.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lighting } from '../src/render/lighting.js';
import { TILE } from '../src/core/constants.js';
import { generateWorld } from '../src/world/worldgen.js';

function lightingWith(building) {
  const map = {
    buildingAt: (tx, ty) => (tx >= building.x && ty >= building.y && tx < building.x + building.w && ty < building.y + building.h ? building : null),
  };
  return new Lighting({ map });
}

const at = (tx, ty, dy = 8) => ({ x: tx * TILE + 8, y: ty * TILE + dy, r: 40, color: '#ffc26b', intensity: 0.8, flicker: 0 });

test('from outside, a light under the roof is hidden; inside, it shines; the front wall always shows', () => {
  const chapel = { id: 'chapel', x: 83, y: 41, w: 11, h: 13, _alpha: 1 };
  const L = lightingWith(chapel);
  // The altar's glow, under the roof: none of it from the street.
  L.count = 0;
  L.push(at(88, 42));
  assert.equal(L.count, 0, 'the altar is hidden by the roof');
  // A window on the front wall (the facade rows) glows to the street.
  L.push(at(85, 53));
  assert.equal(L.count, 1, 'the window still glows');
  // A lamp in the open is untouched.
  L.push(at(70, 60));
  assert.equal(L.count, 2);
  assert.equal(L._seen[0], 1);
  // Step inside: the roof fades and the altar shines through it.
  chapel._alpha = 0.1;
  L.count = 0;
  L.push(at(88, 42));
  assert.equal(L.count, 1);
  assert.ok(Math.abs(L._seen[0] - 0.9) < 1e-6);
  // Halfway through the fade: halfway lit.
  chapel._alpha = 0.5;
  assert.ok(Math.abs(L.roofSeen(88 * TILE + 8, 42 * TILE + 8) - 0.5) < 1e-6);
});

test('in the real village every light source inside the chapel sits under its roof', () => {
  const g = { rng: null };
  const { map, objects } = generateWorld(g, 20261123);
  g.map = map;
  const chapel = map.buildings.find((b) => b.id === 'chapel');
  assert.ok(chapel, 'the chapel exists');
  const L = new Lighting({ map });
  let inside = 0;
  let windows = 0;
  for (const o of objects.all()) {
    if (o.tx < chapel.x || o.tx >= chapel.x + chapel.w || o.ty < chapel.y || o.ty >= chapel.y + chapel.h) continue;
    // Lights as the objects would give them at night (lamps lit, the altar's flame).
    if (o.objType === 'lamp') o.state.lit = true;
    let l = null;
    try {
      l = o.getLight(1);
    } catch {
      l = null;
    }
    const list = Array.isArray(l) ? l : l ? [l] : [];
    for (const one of list) {
      if (!one) continue;
      const seen = L.roofSeen(one.x, one.y);
      if (o.objType === 'window') {
        windows++;
        assert.equal(seen, 1, 'a window glows to the street');
      } else {
        inside++;
        assert.equal(seen, 0, `${o.objType} at ${o.tx},${o.ty} is hidden from outside`);
      }
    }
  }
  assert.ok(inside >= 2, `the altar and candles are lights (${inside})`);
});
