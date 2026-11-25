import { T } from './tiles.js';
import { TILE } from '../core/constants.js';

// Footsteps by ground (DESIGN §32.7, round 14: "different walking sounds on water and dirt
// and grass"). What a foot meets: grass (and heather, grey grass, the forest floor),
// dirt (roads, farmland), stone (cobbles, flags, scree, gravel), wood (floors, bridges,
// the dock), water (fords), sand and snow. The sounds are made in code like every other
// effect (ui/sfx.js step_*), play through the effects volume, and do not care about
// reduce-motion. Your own steps are the loudest; people and creatures walking near you
// are quieter and fall away with distance.

export const SURFACES = ['grass', 'dirt', 'stone', 'wood', 'water', 'sand', 'snow'];

const BY_TILE = new Array(64).fill('grass');
for (const id of [T.DIRT, T.FARMLAND]) BY_TILE[id] = 'dirt';
for (const id of [T.COBBLE, T.STONE_FLOOR, T.RUIN_FLOOR, T.SCREE, T.GRAVEL, T.ROCK, T.RUBBLE]) BY_TILE[id] = 'stone';
for (const id of [T.FLOOR, T.BRIDGE, T.DOCK, T.RUG]) BY_TILE[id] = 'wood';
for (const id of [T.SHALLOWS, T.WATER, T.DEEP_WATER]) BY_TILE[id] = 'water';
BY_TILE[T.SAND] = 'sand';
BY_TILE[T.SNOW] = 'snow';
BY_TILE[T.RUG] = 'wood';

export function surfaceAt(map, x, y) {
  if (!map?.tileAt) return 'dirt';
  const g = map.tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
  if (g === T.RUG) return 'rug';
  return BY_TILE[g] || 'grass';
}

const STEP_EVERY = 15; // px of walking between footfalls
const NEAR = 170; // px: others' steps are heard only this close to you

// The player's own step (player.js calls it on each footfall).
export function playerStep(game, actor, index = 0) {
  const s = surfaceAt(game.map, actor.x, actor.y);
  try {
    game.audio?.play?.(`step_${s === 'rug' ? 'wood' : s}`, { x: actor.x, y: actor.y, volume: s === 'rug' ? 0.18 : 0.36, pitch: 0.92 + Math.random() * 0.16 });
    if (s === 'water') game.particles?.emit?.('splash', actor.x, actor.y, { count: 3 });
    else if (s === 'snow' && index % 2 === 0) game.particles?.emit?.('poof', actor.x, actor.y, { count: 2, color: '#eef3fa' });
  } catch {
    /* sound is optional */
  }
  return s;
}

// Quieter footfalls of anyone else walking near you (entity.js calls it every update).
export function otherStep(game, actor) {
  const p = game.player;
  if (!p || actor === p || !actor.moved || actor.moved > 8 || actor.z > 0 || actor.flying) return;
  actor._stepDist = (actor._stepDist || 0) + actor.moved;
  if (actor._stepDist < STEP_EVERY * (actor.radius > 7 ? 1.4 : 1)) return;
  actor._stepDist = 0;
  const d = Math.hypot(actor.x - p.x, actor.y - p.y);
  if (d > NEAR) return;
  const s = surfaceAt(game.map, actor.x, actor.y);
  const vol = 0.14 * (1 - d / NEAR) * (actor.radius > 7 ? 1.3 : 1);
  if (vol < 0.03) return;
  try {
    game.audio?.play?.(`step_${s === 'rug' ? 'wood' : s}`, { x: actor.x, y: actor.y, volume: vol, pitch: 0.85 + Math.random() * 0.2, other: true });
  } catch {
    /* sound is optional */
  }
}
