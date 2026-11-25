// Shared constants. Every module imports from here instead of hard-coding numbers.

export const TILE = 16; // world pixels per tile
// The vale: Hearthvale and the land around it, laid out by hand (src/world/worldgen.js),
// tiles 0..159 by 0..119. The wider world (src/world/wilds.js) reaches past it on foot:
// west along the King's Road to Brindlecombe, north up the Hollowcrown to the Crown Ring,
// east to the Cinderwick fork. Its tiles run from (WORLD_X0, WORLD_Y0), so the vale keeps
// its coordinates (and every save, mission point and test keeps its meaning).
export const VALE_W = 160; // tiles
export const VALE_H = 120; // tiles
// Edges sit on 16-tile chunk lines (map.js CHUNK) so no ground chunk hangs off the world.
export const WORLD_X0 = -384; // first tile column (west of the vale)
export const WORLD_Y0 = -288; // first tile row (north of the vale)
export const WORLD_W = 640; // tiles, west edge to east edge (x -384 .. 255)
export const WORLD_H = 408; // tiles, north edge to south edge (y -288 .. 119, the vale's south edge)

export const FIXED_DT = 1 / 60; // simulation step (seconds)
export const DAY_SECONDS = 900; // real seconds for one full in-game day (15 minutes)
export const START_HOUR = 8; // a new game starts at 8:00

// Facing directions used by sprites. 'right' sprites may be mirrored 'left' frames.
export const DIRS = ['down', 'left', 'right', 'up'];

// Factions. Relations between them live in entities/entity.js (FACTION_RELATIONS).
export const FACTION = Object.freeze({
  PLAYER: 'player',
  VILLAGER: 'villager',
  GUARD: 'guard',
  WILDLIFE: 'wildlife',
  MONSTER: 'monster',
  BANDIT: 'bandit',
  UNDEAD: 'undead',
});

export const PLAYER_ID = 'player';
export const COMPANION_ID = 'lyra';

export const SAVE_KEY = 'hearthlight.save.v1';
export const SETTINGS_KEY = 'hearthlight.settings.v1';
export const APIKEY_KEY = 'hearthlight.apikey.v1';

// Virtual (low-res) screen: the renderer picks an integer scale so the shorter
// screen side shows about this many world pixels.
export const TARGET_VIRTUAL_MIN = 240;
