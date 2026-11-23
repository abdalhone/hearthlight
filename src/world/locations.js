import { TILE } from '../core/constants.js';
import { normalizeRef } from '../ai/resolve.js';

// Named places. Worldgen fills the index; brains use it to understand
// "go to the inn", the HUD shows the current place, and Lyra's mind remembers where
// things happened.
//
// Location: {
//   id: 'ember_kettle', name: 'The Ember Kettle', kind: 'building'|'village'|'forest'|'lake'|'ruins'|'camp'|'field'|'road'|'square'|'home',
//   bounds: { x, y, w, h }   // in TILES
//   center: { x, y }         // in PIXELS (a walkable spot to path to)
//   description: 'one or two sentences, in the world's voice',
//   danger: 0..3, indoor: bool, aliases: ['inn', 'tavern'], parent: 'hearthvale' | null
// }

export class LocationIndex {
  constructor(list = []) {
    this.list = [];
    this.byId = new Map();
    for (const l of list) this.add(l);
  }

  add(loc) {
    const b = loc.bounds;
    const l = {
      kind: 'area',
      description: '',
      danger: 0,
      indoor: false,
      aliases: [],
      parent: null,
      ...loc,
      center: loc.center || { x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE },
    };
    this.list.push(l);
    this.byId.set(l.id, l);
    return l;
  }

  all() {
    return this.list;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  // Innermost (smallest) location containing the pixel point.
  at(px, py) {
    const tx = px / TILE;
    const ty = py / TILE;
    let best = null;
    let bestArea = Infinity;
    for (const l of this.list) {
      const b = l.bounds;
      if (tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h) {
        const area = b.w * b.h;
        if (area < bestArea) {
          best = l;
          bestArea = area;
        }
      }
    }
    return best;
  }

  // Fuzzy lookup by id, name, alias or kind.
  find(text) {
    const n = normalizeRef(text);
    if (!n) return null;
    const snake = n.replace(/\s+/g, '_');
    if (this.byId.has(snake)) return this.byId.get(snake);
    let partial = null;
    for (const l of this.list) {
      const names = [l.name, l.id.replace(/_/g, ' '), ...(l.aliases || [])].map((s) => normalizeRef(s));
      if (names.includes(n)) return l;
      if (!partial && names.some((s) => s && (s.includes(n) || n.includes(s)))) partial = l;
    }
    if (partial) return partial;
    return this.list.find((l) => l.kind === n) || null;
  }

  describe(loc) {
    if (!loc) return 'somewhere in the wilds';
    return loc.description ? `${loc.name}: ${loc.description}` : loc.name;
  }

  serialize() {
    return null; // static data, rebuilt by worldgen
  }
}
