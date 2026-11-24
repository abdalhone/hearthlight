import { defineRegistry, mixColors } from './registry.js';

// ESSENCES: what a weave is made of (DESIGN §22.1). One entry per essence; a weave holds
// up to 2 (3 later) and its bodies carry all of them: palettes blend, damage is split
// across their types, and every status lands at reduced potency.
//
// Entry format (only `id` and `palette` are required; get() fills the rest):
// {
//   id: 'fire', name: 'Fire',
//   word: 'Ember',              name fragment: "Splitting Ember Bolt"
//   noun: 'fire',               description fragment: "3 bolts of fire"
//   palette: { core, glow, spark, deep },   hex colors, brightest to darkest
//   light: { color, radius },   the light each body casts at night
//   particle: 'flame',          particle style (flame drop shard spark pebble gust leaf bubble
//                               mote wisp filing note); fx draws it, the fallback maps it below
//   fallbackParticle: 'ember',  a render/particles.js type for the plain fallback look
//   sound: 'fire',              a sfx voice name (sfx.js)
//   damageType: 'fire',         combat damage type (targets may resist: actor.resist = { fire: 0.5 })
//   status: { id: 'burning', chance: 1, potency: 1 } | null,   applied on every hit
//   terrain: [{ on: 'grass'|'water'|'stone'|'any', mark: 'scorch'|..., status? }],
//   tags: ['fire', 'hot'],      what reactions key on (status.js REACTIONS)
//   mods: { dmg, cost (+mana), speed, size, life, knock, cooldown },   multipliers
//   familiar: { name: 'Imp', form: 'imp', attack: 'bolt'|'slam'|'zap', range },  summon look
//   hue: 0..360                 for UI sorting
// }

export const ESSENCES = {
  raw: {
    name: 'Raw Weave',
    word: 'Arcane',
    noun: 'raw weave',
    palette: { core: '#f4efff', glow: '#a995ff', spark: '#ddd2ff', deep: '#5a3fc0' },
    light: { color: '#a995ff', radius: 38 },
    particle: 'mote',
    fallbackParticle: 'magic',
    sound: 'arcane',
    damageType: 'arcane',
    status: null,
    terrain: [],
    tags: ['arcane'],
    mods: { dmg: 1.1, cost: 0 },
    familiar: { name: 'Familiar', form: 'wisp', attack: 'bolt' },
    hue: 265,
  },
  fire: {
    name: 'Fire',
    word: 'Ember',
    noun: 'fire',
    palette: { core: '#fff4c0', glow: '#ffa53a', spark: '#ffe08a', deep: '#c2412d' },
    light: { color: '#ff9a3c', radius: 48 },
    particle: 'flame',
    fallbackParticle: 'ember',
    sound: 'fire',
    damageType: 'fire',
    status: { id: 'burning' },
    terrain: [{ on: 'grass', mark: 'scorch' }, { on: 'water', mark: 'steam' }],
    tags: ['fire', 'hot'],
    mods: { dmg: 1.15, cost: 3 },
    familiar: { name: 'Imp', form: 'imp', attack: 'bolt' },
    hue: 25,
  },
  water: {
    name: 'Water',
    word: 'Tide',
    noun: 'water',
    palette: { core: '#e6f8ff', glow: '#4fb3e8', spark: '#a8e2ff', deep: '#235c9e' },
    light: { color: '#5fbdf0', radius: 36 },
    particle: 'drop',
    fallbackParticle: 'splash',
    sound: 'water',
    damageType: 'water',
    status: { id: 'soaked' },
    terrain: [{ on: 'any', mark: 'puddle', status: 'soaked' }],
    tags: ['wet', 'water'],
    mods: { dmg: 0.92, cost: 2, size: 1.1, knock: 1.6 },
    familiar: { name: 'Undine', form: 'blob', attack: 'bolt' },
    hue: 200,
  },
  frost: {
    name: 'Frost',
    word: 'Rime',
    noun: 'frost',
    palette: { core: '#ffffff', glow: '#9fe3ff', spark: '#dff6ff', deep: '#4f86c6' },
    light: { color: '#9fe3ff', radius: 40 },
    particle: 'shard',
    fallbackParticle: 'sparkle',
    sound: 'frost',
    damageType: 'frost',
    status: { id: 'chilled' },
    terrain: [{ on: 'water', mark: 'glaze' }, { on: 'any', mark: 'rime' }],
    tags: ['cold', 'frost'],
    mods: { dmg: 0.95, cost: 3, speed: 0.92 },
    familiar: { name: 'Wisp', form: 'crystal', attack: 'bolt' },
    hue: 190,
  },
  storm: {
    name: 'Storm',
    word: 'Thunder',
    noun: 'lightning',
    palette: { core: '#ffffff', glow: '#ffe45c', spark: '#fff7b0', deep: '#6a5cff' },
    light: { color: '#fff07a', radius: 50 },
    particle: 'spark',
    fallbackParticle: 'spark',
    sound: 'storm',
    damageType: 'storm',
    status: { id: 'shocked' },
    terrain: [{ on: 'any', mark: 'char' }],
    tags: ['shock', 'storm'],
    mods: { dmg: 1.05, cost: 3, speed: 1.25 },
    familiar: { name: 'Sprite', form: 'sprite', attack: 'zap' },
    hue: 55,
  },
  earth: {
    name: 'Earth',
    word: 'Stone',
    noun: 'stone',
    palette: { core: '#f1d9a8', glow: '#c08a4e', spark: '#e8c48a', deep: '#6b4a2e' },
    light: { color: '#d49a5a', radius: 26 },
    particle: 'pebble',
    fallbackParticle: 'stone_chip',
    sound: 'earth',
    damageType: 'earth',
    status: { id: 'staggered' },
    terrain: [{ on: 'any', mark: 'crack' }],
    tags: ['earth', 'heavy'],
    mods: { dmg: 1.2, cost: 3, speed: 0.8, size: 1.15, knock: 1.5 },
    familiar: { name: 'Golem', form: 'golem', attack: 'slam' },
    hue: 32,
  },
  wind: {
    name: 'Wind',
    word: 'Gale',
    noun: 'wind',
    palette: { core: '#ffffff', glow: '#bff5e0', spark: '#e6fff6', deep: '#5fb3a0' },
    light: { color: '#c8fff0', radius: 30 },
    particle: 'gust',
    fallbackParticle: 'poof',
    sound: 'wind',
    damageType: 'wind',
    status: { id: 'knocked' },
    terrain: [],
    tags: ['air', 'wind'],
    mods: { dmg: 0.86, cost: 2, speed: 1.3, knock: 2.3 },
    familiar: { name: 'Sylph', form: 'bird', attack: 'bolt' },
    hue: 160,
  },
  nature: {
    name: 'Nature',
    word: 'Thorn',
    noun: 'thorns',
    palette: { core: '#efffd0', glow: '#7ed957', spark: '#c6f59a', deep: '#2f7a3a' },
    light: { color: '#9be070', radius: 32 },
    particle: 'leaf',
    fallbackParticle: 'leaf',
    sound: 'nature',
    damageType: 'nature',
    status: { id: 'rooted' },
    terrain: [{ on: 'grass', mark: 'bloom' }, { on: 'any', mark: 'sprout' }],
    tags: ['plant', 'nature'],
    mods: { dmg: 0.92, cost: 3 },
    familiar: { name: 'Dryad', form: 'sprout', attack: 'bolt' },
    hue: 110,
  },
  poison: {
    name: 'Poison',
    word: 'Venom',
    noun: 'venom',
    palette: { core: '#f2ffc4', glow: '#a6e22e', spark: '#d4ff7a', deep: '#5a2f7a' },
    light: { color: '#b4f04a', radius: 30 },
    particle: 'bubble',
    fallbackParticle: 'magic',
    sound: 'poison',
    damageType: 'poison',
    status: { id: 'poisoned' },
    terrain: [{ on: 'any', mark: 'ooze' }],
    tags: ['poison', 'toxic'],
    mods: { dmg: 0.72, cost: 3 },
    familiar: { name: 'Toad', form: 'toad', attack: 'bolt' },
    hue: 80,
  },
  light: {
    name: 'Light',
    word: 'Dawn',
    noun: 'light',
    palette: { core: '#ffffff', glow: '#ffe9a8', spark: '#fffbe6', deep: '#e0a83a' },
    light: { color: '#fff2c0', radius: 60 },
    particle: 'mote',
    fallbackParticle: 'sparkle',
    sound: 'light',
    damageType: 'light',
    status: { id: 'dazzled' },
    terrain: [{ on: 'any', mark: 'glow' }],
    tags: ['light', 'holy'],
    mods: { dmg: 1.0, cost: 3, speed: 1.15 },
    familiar: { name: 'Seraph', form: 'halo', attack: 'zap' },
    hue: 48,
  },
  dark: {
    name: 'Dark',
    word: 'Shadow',
    noun: 'shadow',
    palette: { core: '#e6d0ff', glow: '#8a4fd6', spark: '#c09cff', deep: '#2a1640' },
    light: { color: '#9a5cff', radius: 34 },
    particle: 'wisp',
    fallbackParticle: 'smoke',
    sound: 'dark',
    damageType: 'dark',
    status: { id: 'drained' },
    terrain: [{ on: 'any', mark: 'blight' }],
    tags: ['dark', 'shadow'],
    mods: { dmg: 1.1, cost: 4 },
    familiar: { name: 'Shade', form: 'shade', attack: 'bolt' },
    hue: 275,
  },
  iron: {
    name: 'Iron',
    word: 'Iron',
    noun: 'iron',
    palette: { core: '#ffffff', glow: '#c9d3e0', spark: '#ffd9a0', deep: '#56627a' },
    light: { color: '#ffd9a0', radius: 28 },
    particle: 'filing',
    fallbackParticle: 'spark',
    sound: 'iron',
    damageType: 'iron',
    status: { id: 'sundered' },
    terrain: [{ on: 'any', mark: 'filings' }],
    tags: ['metal', 'iron'],
    mods: { dmg: 1.2, cost: 4, speed: 0.9, knock: 1.3 },
    familiar: { name: 'Sentinel', form: 'sentinel', attack: 'slam' },
    hue: 215,
  },
  song: {
    name: 'Song',
    word: 'Hymn',
    noun: 'song',
    palette: { core: '#fff0fb', glow: '#ff9ad5', spark: '#ffd1ee', deep: '#8a3f9e' },
    light: { color: '#ffa8de', radius: 40 },
    particle: 'note',
    fallbackParticle: 'note',
    sound: 'song',
    damageType: 'song',
    status: { id: 'charmed' },
    terrain: [],
    tags: ['song', 'sound'],
    mods: { dmg: 0.8, cost: 4 },
    familiar: { name: 'Songbird', form: 'bird', attack: 'zap' },
    hue: 320,
  },
};

const ESSENCE_MODS = ['dmg', 'cost', 'speed', 'size', 'life', 'knock', 'cooldown'];
const DEFAULT_PALETTE = { core: '#ffffff', glow: '#a995ff', spark: '#ddd2ff', deep: '#5a3fc0' };

function fillEssence(raw, id) {
  const palette = { ...DEFAULT_PALETTE, ...(raw.palette || {}) };
  const mods = { dmg: 1, cost: 2, speed: 1, size: 1, life: 1, knock: 1, cooldown: 1 };
  for (const k of ESSENCE_MODS) if (Number.isFinite(raw.mods?.[k])) mods[k] = raw.mods[k];
  const name = raw.name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    ...raw,
    name,
    word: raw.word || name,
    noun: raw.noun || id,
    palette,
    light: { color: raw.light?.color || palette.glow, radius: raw.light?.radius ?? 36 },
    particle: raw.particle || 'mote',
    fallbackParticle: raw.fallbackParticle || 'magic',
    sound: raw.sound || id,
    damageType: raw.damageType || id,
    status: raw.status ? { chance: 1, potency: 1, ...raw.status } : null,
    terrain: Array.isArray(raw.terrain) ? raw.terrain : [],
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : [id],
    mods,
    familiar: { name: 'Familiar', form: 'wisp', attack: 'bolt', ...(raw.familiar || {}) },
    hue: Number.isFinite(raw.hue) ? raw.hue : 0,
  };
}

export const Essences = defineRegistry('essence', ESSENCES, fillEssence);
export const getEssence = (id) => Essences.get(id);
export const essenceIds = () => Essences.ids();

// Blend up to three palettes: the first essence leads (weight 2), the rest tint it.
const blendCache = new Map();
export function blendPalettes(palettes) {
  if (!palettes.length) return { ...DEFAULT_PALETTE };
  if (palettes.length === 1) return { ...palettes[0] };
  const key = palettes.map((p) => `${p.core}${p.glow}${p.spark}${p.deep}`).join('|');
  let out = blendCache.get(key);
  if (out) return out;
  const w = palettes.map((_, i) => (i === 0 ? 2 : 1.2));
  out = {};
  for (const k of ['core', 'glow', 'spark', 'deep']) out[k] = mixColors(palettes.map((p) => p[k]), w);
  // Keep the second essence visible: its glow becomes the spark color.
  out.spark = mixColors([palettes[1].glow, out.spark], [2, 1]);
  if (blendCache.size > 256) blendCache.clear();
  blendCache.set(key, out);
  return out;
}
