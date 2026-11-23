// Shared constants. Every module imports from here instead of hard-coding numbers.

export const TILE = 16; // world pixels per tile
export const WORLD_W = 160; // tiles
export const WORLD_H = 120; // tiles

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
