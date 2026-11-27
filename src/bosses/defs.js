// The five bosses of the Weave (DESIGN §22.3): who they are, how tough, where they live,
// what they leave behind and what they say. Round 15 (the author: "bosses are too easy … I
// don't think the 3 or 2 minutes fights are enough … if I wanted to do it alone, like 4
// minutes or like something that is really hard … make it have a really good damage and a
// really good defense"): tuned for a stranger alone at the level each is meant for (`level`),
// with a good build, to need about four minutes or more of a hard fight; much stronger, less,
// never a burst (boss.js: the blow cap and the guard). They hit hard: a few unread markers
// drop you. Every attack is still telegraphed for at least half a second with a ground
// marker, so a thumb on a phone held sideways can read it.
//
// def fields:
//   id, entityId (the boss actor's id; story scenes point the camera at it), species,
//   name, title, faction, kind, hp, atk, def, speed, radius, mass, xp
//   resist       damage taken by type, x (combat.resistMul): 0.25 shrugs most of it off
//   level        the level the fight is meant for (round 15: the stranger the missions lead there)
//   phases       hp fractions where a new phase starts (descending)
//   rewards      [[kind, id], ...] glyph-shards dropped on defeat (kind 'essence'|'twist')
//   intro        story script id (src/story/scripts_bosses.js)
//   night        only present from dusk to dawn
//   yields       beaten, not killed (people are never killed: LORE §9.3, DESIGN §19.7)
//   lyraDread    0..1, how much the fight itself frightens Lyra (on top of her own judgment)
//   accent       the color of the health bar and the reveal glow
//   arena        fallback arena in tiles when worldgen gives none: { home: [tx, ty], center: [tx, ty], r }

export const BOSS_IDS = ['varek', 'greyjaw', 'mother_of_slimes', 'lakes_hum', 'bone_warden'];

export const BOSSES = {
  varek: {
    id: 'varek',
    level: 5,
    entityId: 'varek',
    species: 'bandit_chief',
    name: 'Varek One-Eye',
    title: 'Chief of the hill bandits',
    faction: 'bandit',
    kind: 'human',
    hp: 1900, // round 15: was 520
    atk: 18, // was 11
    def: 6, // was 2
    resist: { fire: 0.5, iron: 0.8 }, // his fire never goes out; a hillman's mail
    speed: 44,
    radius: 8,
    mass: 3,
    xp: 140,
    phases: [0.5],
    rewards: [
      ['essence', 'fire'],
      ['twist', 'volley'],
    ],
    intro: 'boss_varek',
    yields: true,
    lyraDread: 0,
    accent: '#ff8a3d',
    arena: { home: [140, 11], center: [140, 15], r: 11 },
    barks: {
      start: ['Come on, then!', 'My hill. My toll.'],
      call: ['Lads! To me!', 'Up! All of you!'],
      phase: 'This fire never goes out. Neither do I.',
      hurt: ['Is that all?', 'Again!', 'Ha!'],
      win: 'Go home. Tell them the toll still stands.',
      yield: 'Enough. ...Enough. Keep your road.',
      flee: 'This is not finished.',
    },
  },
  greyjaw: {
    id: 'greyjaw',
    level: 6,
    entityId: 'greyjaw',
    species: 'greyjaw',
    name: 'Greyjaw',
    title: 'Alpha of the Whisperwood packs',
    faction: 'monster',
    kind: 'animal',
    hp: 2200, // round 15: was 600
    atk: 17, // was 10
    def: 4, // was 1
    resist: { frost: 0.6, wind: 0.5, fire: 1.25 }, // a winter coat; the wind is his
    speed: 66,
    radius: 9,
    mass: 3,
    xp: 130,
    phases: [0.5],
    rewards: [
      ['essence', 'wind'],
      ['twist', 'swift'],
    ],
    intro: 'boss_greyjaw',
    night: true,
    lyraDread: 0.1,
    accent: '#9fb4d8',
    arena: { home: [99, 7], center: [99, 8], r: 7 },
  },
  mother_of_slimes: {
    id: 'mother_of_slimes',
    level: 4,
    entityId: 'mother_of_slimes',
    species: 'mother_of_slimes',
    name: 'The Mother of Slimes',
    title: 'What the rain-pools grew',
    faction: 'monster',
    kind: 'monster',
    hp: 2000, // round 15: was 560
    atk: 15, // was 9
    def: 3, // was 0
    resist: { poison: 0.25, water: 0.7, fire: 1.3 }, // what the pools grew: poison is her own
    speed: 26,
    radius: 12,
    mass: 5,
    xp: 120,
    phases: [0.5],
    rewards: [
      ['essence', 'poison'],
      ['twist', 'split'],
    ],
    intro: 'boss_mother',
    lyraDread: 0.15,
    accent: '#e46aa0',
    arena: { home: [14, 14], center: [15, 15], r: 8 },
  },
  lakes_hum: {
    id: 'lakes_hum',
    level: 7,
    entityId: 'lakes_hum',
    species: 'lakes_hum',
    name: "The Lake's Hum",
    title: 'The voice under Mirror Lake',
    faction: 'monster',
    kind: 'monster',
    hp: 1800, // round 15: was 440
    atk: 18, // was 10
    def: 4, // was 1
    resist: { water: 0.25, frost: 0.6, storm: 1.3 }, // still water; a bolt through it sings
    speed: 54,
    radius: 10,
    mass: 6,
    xp: 140,
    phases: [0.5],
    rewards: [
      ['essence', 'water'],
      ['twist', 'bounce'],
    ],
    intro: 'boss_lake',
    flying: true,
    lyraDread: 0.1,
    accent: '#6fc8ff',
    arena: { home: [140, 51], center: [134, 51], r: 6 },
  },
  bone_warden: {
    id: 'bone_warden',
    level: 9,
    entityId: 'bone_warden',
    species: 'bone_warden',
    name: 'The Bone Warden',
    title: 'Gravelight given a shield',
    faction: 'undead',
    kind: 'undead',
    hp: 2400, // round 15: was 560
    atk: 21, // was 12
    def: 8, // was 3
    resist: { dark: 0.25, poison: 0.3, light: 1.3 }, // gravelight; light unmakes it
    speed: 30,
    radius: 9,
    mass: 6,
    xp: 170,
    phases: [0.5],
    shields: [0.7, 0.35],
    rewards: [
      ['essence', 'dark'],
      ['twist', 'chain'],
    ],
    intro: 'boss_warden',
    lyraDread: 0.3,
    accent: '#7fb2ff',
    arena: { home: [10, 105], center: [10, 106], r: 7 },
  },
};

// What each shard teaches, in the reveal ("You can weave fire").
export const GLYPH_TEXT = {
  essence: {
    fire: 'The fire that never goes out.',
    wind: 'The breath of the deep wood.',
    poison: 'What the rain-pools grew.',
    water: 'Still water, given a voice.',
    dark: 'Gravelight. Every Moot forbids it.',
  },
  twist: {
    volley: 'Three in quick succession.',
    swift: 'Faster than a wolf can turn.',
    split: 'Hit hard, and it divides.',
    bounce: 'It skips like a stone on the lake.',
    chain: 'It leaps from foe to foe.',
  },
};

// Colors for glyphs when the magic registry has none for an id (the fx agent's palettes
// win when present: game.magic's essences carry { core, glow, spark, deep }).
export const GLYPH_PALETTE = {
  fire: { core: '#ffe08a', glow: '#ff8a3d', spark: '#fff4c0', deep: '#86301b' },
  wind: { core: '#e8fff4', glow: '#9fe8c8', spark: '#ffffff', deep: '#3f7a68' },
  poison: { core: '#e8ff9a', glow: '#9ee05a', spark: '#f6ffd0', deep: '#4a2a5e' },
  water: { core: '#d8f4ff', glow: '#4fb6f0', spark: '#ffffff', deep: '#1d3a63' },
  dark: { core: '#c8b8ff', glow: '#6a4cc8', spark: '#e8e0ff', deep: '#1c1547' },
  twist: { core: '#fff4c0', glow: '#e4b83d', spark: '#ffffff', deep: '#7d5a1c' },
};

export function bossDef(id) {
  return BOSSES[id] || null;
}

export function rewardSource(id) {
  return `boss:${id}`;
}

export function glyphName(kind, id) {
  const n = String(id || '').replace(/_/g, ' ');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// "You can weave fire" / "New twist: Volley".
export function revealLine(kind, id) {
  const n = String(id || '').replace(/_/g, ' ');
  if (kind === 'essence') return `You can weave ${n}`;
  if (kind === 'shape') return `You can shape a ${n}`;
  return `New twist: ${glyphName(kind, id)}`;
}
