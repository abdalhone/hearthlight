// The five bosses of the Weave (DESIGN §22.3): who they are, how tough, where they live,
// what they leave behind and what they say. Numbers are tuned for a player with the
// sword and early weaves (bolt + strike + one essence) and Lyra beside them: hard but
// fair, one to three minutes each. Every attack is telegraphed for at least half a
// second with a ground marker, so a thumb on a phone held sideways can read it.
//
// def fields:
//   id, entityId (the boss actor's id; story scenes point the camera at it), species,
//   name, title, faction, kind, hp, atk, def, speed, radius, mass, xp
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
    entityId: 'varek',
    species: 'bandit_chief',
    name: 'Varek One-Eye',
    title: 'Chief of the hill bandits',
    faction: 'bandit',
    kind: 'human',
    hp: 420,
    atk: 11,
    def: 2,
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
    entityId: 'greyjaw',
    species: 'greyjaw',
    name: 'Greyjaw',
    title: 'Alpha of the Whisperwood packs',
    faction: 'monster',
    kind: 'animal',
    hp: 380,
    atk: 10,
    def: 1,
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
    entityId: 'mother_of_slimes',
    species: 'mother_of_slimes',
    name: 'The Mother of Slimes',
    title: 'What the rain-pools grew',
    faction: 'monster',
    kind: 'monster',
    hp: 360,
    atk: 9,
    def: 0,
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
    entityId: 'lakes_hum',
    species: 'lakes_hum',
    name: "The Lake's Hum",
    title: 'The voice under Mirror Lake',
    faction: 'monster',
    kind: 'monster',
    hp: 400,
    atk: 10,
    def: 1,
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
    entityId: 'bone_warden',
    species: 'bone_warden',
    name: 'The Bone Warden',
    title: 'Gravelight given a shield',
    faction: 'undead',
    kind: 'undead',
    hp: 480,
    atk: 12,
    def: 3,
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
