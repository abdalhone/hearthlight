// STUB (owned by the world agent): tile definitions.
// Contract: export T (name -> id) and tileDef(id) -> { name, solid, water, wall, color }.
//  solid: blocks walkers; water: blocks walkers but not flyers, fishable;
//  wall: blocks projectiles and sight.

export const T = { VOID: 0, GRASS: 1, DIRT: 2, WATER: 3, WALL: 4, FLOOR: 5 };

const DEFS = {
  0: { name: 'void', solid: true, water: false, wall: true, color: '#000000' },
  1: { name: 'grass', solid: false, water: false, wall: false, color: '#4a8240' },
  2: { name: 'dirt', solid: false, water: false, wall: false, color: '#9a7049' },
  3: { name: 'water', solid: true, water: true, wall: false, color: '#2f74ad' },
  4: { name: 'wall', solid: true, water: false, wall: true, color: '#545266' },
  5: { name: 'floor', solid: false, water: false, wall: false, color: '#9c6b43' },
};

export function tileDef(id) {
  return DEFS[id] || DEFS[0];
}
