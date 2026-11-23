import { TILE } from '../core/constants.js';
import { TileMap } from './map.js';
import { T } from './tiles.js';
import { ObjectManager, Door } from './objects.js';
import { LocationIndex } from './locations.js';

// STUB (owned by the world agent). A tiny test field so the skeleton runs.
// Contract: generateWorld(game, seed) -> { map, objects, locations, spawns }
//  spawns = { player: {x,y}, companion: {x,y}, npcs: [{ id, x, y }], creatures: [{ species, x, y }],
//             spawnZones: [{ id, locationId, species: [..], max, night?: bool, rect: {x,y,w,h} (tiles) }] }
export function generateWorld(game, seed = 1) {
  const W = 60;
  const H = 40;
  const map = new TileMap(W, H);
  map.ground.fill(T.GRASS);
  for (let x = 0; x < W; x++) {
    map.set(x, 0, T.WALL);
    map.set(x, H - 1, T.WALL);
  }
  for (let y = 0; y < H; y++) {
    map.set(0, y, T.WALL);
    map.set(W - 1, y, T.WALL);
  }
  // A little hut with a door.
  for (let x = 20; x < 27; x++) {
    map.set(x, 10, T.WALL);
    map.set(x, 15, T.WALL);
  }
  for (let y = 10; y < 16; y++) {
    map.set(20, y, T.WALL);
    map.set(26, y, T.WALL);
  }
  for (let y = 11; y < 15; y++) for (let x = 21; x < 26; x++) map.set(x, y, T.FLOOR);
  map.set(23, 15, T.FLOOR);
  for (let y = 25; y < 32; y++) for (let x = 35; x < 48; x++) map.set(x, y, T.WATER);

  const objects = new ObjectManager(game);
  objects.add(new Door(game, { tx: 23, ty: 15 }));

  const locations = new LocationIndex([
    { id: 'hearthvale', name: 'Hearthvale', kind: 'village', bounds: { x: 1, y: 1, w: W - 2, h: H - 2 }, description: 'A test field.' },
    { id: 'hut', name: 'Little Hut', kind: 'building', indoor: true, bounds: { x: 20, y: 10, w: 7, h: 6 }, aliases: ['house'], description: 'A test hut.' },
    { id: 'pond', name: 'Test Pond', kind: 'lake', bounds: { x: 35, y: 25, w: 13, h: 7 }, aliases: ['lake', 'water'], center: { x: 34 * TILE, y: 28 * TILE } },
  ]);

  return {
    map,
    objects,
    locations,
    spawns: {
      player: { x: 15 * TILE, y: 20 * TILE },
      companion: { x: 13 * TILE, y: 20 * TILE },
      npcs: [],
      creatures: [{ species: 'slime', x: 40 * TILE, y: 12 * TILE }],
      spawnZones: [],
    },
  };
}
