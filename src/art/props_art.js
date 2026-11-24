import { registerNature } from './props_nature.js';
import { registerFurniture } from './props_furniture.js';
import { registerVillage } from './props_village.js';

// Every world prop sprite (DESIGN §5: `prop:<objType>[:variant]`). Sprites are painted
// into PixelBufs at boot and turned into canvases once. Anchors (ox, oy) sit at the
// bottom-center of the object's footprint, matching WorldObject.x / .y.

export function registerPropArt(atlas, rng) {
  const add = (name, bufs, opts = {}) => {
    try {
      atlas.add(
        name,
        bufs.map((b) => b.toCanvas()),
        opts,
      );
    } catch (err) {
      console.error('[props] could not register', name, err);
    }
  };
  const steps = [
    ['nature', () => registerNature(add, rng.fork(1))],
    ['furniture', () => registerFurniture(add, rng.fork(2))],
    ['village', () => registerVillage(add, rng.fork(3))],
  ];
  for (const [label, fn] of steps) {
    try {
      fn();
    } catch (err) {
      console.error(`[props] ${label} art failed`, err);
    }
  }
}
