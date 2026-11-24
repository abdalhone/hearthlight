// Appearance presets and normalization for the humanoid generator.
// An appearance is plain data (also used in NPC profiles):
//   { skin, hair, hairStyle, outfit, top, bottom, accent, shoes, cloak, cloakTrim,
//     accessories: [...], hat, held, build, eyes, eyeStyle, ... }
// Colors may be palette keys (HAIR / CLOTH names, SKIN index or name) or hex strings.

import { SKIN, HAIR, CLOTH, RAMPS } from './palette.js';
import { rampFrom, tri, mixHex } from './characters_paint.js';

// Extra ramps the characters need that the shared palette does not have.
export const HAIR_EXTRA = {
  chestnut: ['#3b1f16', '#6b3a24', '#985a38'],
  dark_brown: ['#22150f', '#3a251a', '#563727'],
  grey: ['#4c4a55', '#7d7b88', '#b3b1bd'],
  copper: ['#5a2414', '#93401f', '#c86a36'],
  greying_black: ['#1c1a20', '#3b3942', '#86848f'], // Hess: black going grey
};

export const CLOTH_EXTRA = {
  violet: ['#2e1846', '#4c2a78', '#7148a8'],
  ranger_teal: ['#10343a', '#1b5a5e', '#2f8584'],
  leather: ['#2e1d14', '#51331f', '#76502f'],
  dark_leather: ['#1e1612', '#33251b', '#4a3626'],
  silver: ['#5f6273', '#a3a8b8', '#e6e9f2'],
  olive: ['#262a17', '#3f4627', '#5d673a'],
  moss: ['#1d2c1c', '#2f4a2c', '#4a6d3f'],
  wine: ['#3a1220', '#5e1e32', '#86304a'],
  sky: ['#25406a', '#3d6496', '#6a94c4'],
  straw: ['#6b5326', '#a5843f', '#d8b867'],
  rust: ['#3d1c12', '#6e3420', '#9c5530'],
  charcoal: ['#16151b', '#26242d', '#3a3743'],
  slate: ['#202733', '#364254', '#56657c'],
  honey: ['#5a3a14', '#966524', '#cf9a3e'],
  blackthorn: ['#120e10', '#2a1e1c', '#463430'],
  bone: tri(RAMPS.bone),
  iron: tri(RAMPS.iron),
  gold: tri(RAMPS.gold),
  fur: tri(RAMPS.fur),
};

export const SKIN_NAMES = { deep: 0, brown: 1, tan: 2, light: 3, fair: 4 };

// Round 3 adds tufts (Hobb), cropped (Hess, Tansy), fringe (Tilly) and scarf (Sabeth's
// headscarf); the coat (Hobb, Alder); the lamplighter's pole, walking sticks, a spear, a
// fishing rod, a sling, a bolt of cloth and a dye paddle; and builds from lanky to tiny.
export const HAIR_STYLES = ['short', 'long', 'ponytail', 'braid', 'bun', 'curly', 'bald', 'hood', 'tufts', 'cropped', 'fringe', 'scarf'];
export const OUTFITS = ['tunic', 'dress', 'robe', 'armor', 'apron', 'trousers', 'coat'];
export const ACCESSORIES = ['beard', 'mustache', 'glasses', 'hat', 'headband', 'eyepatch', 'earrings'];
export const HELD_ITEMS = ['sword', 'dagger', 'staff', 'bow', 'hammer', 'hoe', 'ladle', 'book', 'axe', 'none', 'lamppole', 'stick', 'spear', 'rod', 'sling', 'cloth', 'paddle'];
export const BUILDS = ['normal', 'slim', 'stout', 'big', 'child', 'lanky', 'tall', 'broad', 'small', 'tiny', 'teen'];
export const POSTURES = ['upright', 'stooped', 'bent'];

export function skinRamp(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'number') return SKIN[Math.max(0, Math.min(SKIN.length - 1, v | 0))];
  if (typeof v === 'string' && v in SKIN_NAMES) return SKIN[SKIN_NAMES[v]];
  if (typeof v === 'string' && v.startsWith('#')) return rampFrom(v, 0.2);
  return SKIN[3];
}

export function hairRamp(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    if (HAIR[v]) return HAIR[v];
    if (HAIR_EXTRA[v]) return HAIR_EXTRA[v];
    if (CLOTH[v]) return CLOTH[v];
    if (v.startsWith('#')) return rampFrom(v, 0.3);
  }
  return HAIR.brown;
}

export function clothRamp(v, fallback = 'brown') {
  if (Array.isArray(v)) return v.length === 3 ? v : tri(v);
  if (typeof v === 'string') {
    if (CLOTH[v]) return CLOTH[v];
    if (CLOTH_EXTRA[v]) return CLOTH_EXTRA[v];
    if (HAIR[v]) return HAIR[v];
    if (RAMPS[v]) return tri(RAMPS[v]);
    if (v.startsWith('#')) return rampFrom(v, 0.3);
  }
  return fallback ? clothRamp(fallback, null) : CLOTH.brown;
}

// Fill in defaults and resolve every color to a ramp. Unknown values never throw.
export function normalizeAppearance(a = {}) {
  const acc = new Set(Array.isArray(a.accessories) ? a.accessories : []);
  const hairStyle = HAIR_STYLES.includes(a.hairStyle) ? a.hairStyle : 'short';
  const outfit = OUTFITS.includes(a.outfit) ? a.outfit : 'tunic';
  const held = HELD_ITEMS.includes(a.held) ? a.held : 'none';
  const build = BUILDS.includes(a.build) ? a.build : 'normal';
  const top = clothRamp(a.top ?? a.outfitColor ?? 'blue');
  const hair = hairRamp(a.hair);
  return {
    key: a.key || '',
    skin: skinRamp(a.skin),
    hair,
    hairStyle,
    outfit,
    top,
    bottom: clothRamp(a.bottom ?? (outfit === 'dress' || outfit === 'robe' ? a.top : 'brown')),
    accent: clothRamp(a.accent ?? 'leather'),
    shoes: clothRamp(a.shoes ?? 'dark_leather'),
    belt: clothRamp(a.belt ?? 'leather'),
    apron: clothRamp(a.apron ?? 'cream'),
    cloak: a.cloak ? clothRamp(a.cloak) : null,
    cloakLining: a.cloakLining ? clothRamp(a.cloakLining) : null,
    cloakTrim: a.cloakTrim ? clothRamp(a.cloakTrim) : null,
    hood: a.hood ? clothRamp(a.hood) : hairStyle === 'hood' ? clothRamp(a.hoodColor ?? a.cloak ?? 'brown') : null,
    hoodUp: hairStyle === 'hood' || !!a.hoodUp,
    hat: acc.has('hat') ? clothRamp(a.hatColor ?? 'straw') : null,
    hatStyle: a.hatStyle || 'brim',
    headband: acc.has('headband') ? clothRamp(a.headbandColor ?? 'red') : null,
    beard: acc.has('beard') ? hairRamp(a.beardColor ?? a.hair) : null,
    mustache: acc.has('mustache') || acc.has('beard') ? hairRamp(a.beardColor ?? a.hair) : null,
    glasses: acc.has('glasses'),
    eyepatch: acc.has('eyepatch'),
    earrings: acc.has('earrings') ? a.earringColor || '#e4b83d' : null,
    mask: a.mask ? clothRamp(a.mask) : null,
    held,
    workTool: HELD_ITEMS.includes(a.workTool) ? a.workTool : null,
    build,
    eyes: a.eyes || '#2a2130',
    eyeStyle: a.eyeStyle || (build === 'child' ? 'big' : 'small'),
    lashes: !!a.lashes,
    blush: !!a.blush,
    braid: a.braid || (hairStyle === 'braid' ? 'back' : null), // 'left' = over her left shoulder
    hairpin: a.hairpin || null,
    staffCrystal: a.staffCrystal ? clothRamp(a.staffCrystal) : null,
    glowColor: a.glowColor || '#a995ff',
    armorRamp: clothRamp(a.armor ?? 'iron'),
    skeleton: !!a.skeleton,
    quiver: !!a.quiver || held === 'bow',
    scar: !!a.scar,
    freckles: !!a.freckles,
    wrinkles: !!a.wrinkles,
    sash: a.sash ? clothRamp(a.sash) : null,
    pauldron: a.pauldron ? clothRamp(a.pauldron) : null,
    tabard: a.tabard ? clothRamp(a.tabard) : null,
    metal: clothRamp(a.metal ?? 'iron'),
    rust: !!a.rust,
    skirt: a.skirt !== false,
    bookColor: a.bookColor || null,
    // Round 3 details (DESIGN §19.1): what makes each newcomer recognisable.
    posture: POSTURES.includes(a.posture) ? a.posture : 'upright',
    scarf: hairStyle === 'scarf' ? clothRamp(a.scarfColor ?? 'teal') : null,
    shawl: a.shawl ? clothRamp(a.shawl) : null,
    chain: a.chain ? clothRamp(a.chain === true ? 'gold' : a.chain) : null,
    clothColor: clothRamp(a.clothColor ?? 'teal'),
    stick: clothRamp(a.stickColor ?? 'leather'),
    hands: a.handTint ? rampFrom(mixHex(skinRamp(a.skin)[1], a.handTint, 0.55), 0.22) : skinRamp(a.skin),
    apronStain: a.apronStain ? a.handTint || '#7a4aa0' : null,
    apronBig: !!a.apronBig,
    handOut: !!a.handOut,
    bigEars: !!a.bigEars,
    bigBoots: !!a.bigBoots,
    glassesUp: !!a.glassesUp,
    beltLantern: !!a.beltLantern,
    knife: !!a.knife,
    singed: !!a.singed,
    needle: !!a.needle,
    rolled: a.sleeves === 'rolled',
    waxCuffs: a.cuffs === 'wax',
  };
}

// The traveler: chestnut hair, blue tunic, brown cloak, sword.
export const PLAYER_APPEARANCE = {
  key: 'player',
  skin: 'light',
  hair: 'chestnut',
  hairStyle: 'short',
  outfit: 'tunic',
  top: 'blue',
  bottom: 'dark_leather',
  accent: 'cream',
  shoes: 'leather',
  belt: 'leather',
  cloak: 'brown',
  cloakLining: 'rust',
  held: 'sword',
  workTool: 'axe',
  build: 'normal',
  eyes: '#3a4a8a',
};

// Lyra: long midnight hair with one braid and a silver crescent pin, violet-and-teal
// ranger cloak with silver trim, a short crystal-tipped staff.
export const LYRA_APPEARANCE = {
  key: 'lyra',
  skin: 'fair',
  hair: 'midnight',
  hairStyle: 'long',
  braid: 'left',
  hairpin: 'crescent',
  outfit: 'tunic',
  top: 'ranger_teal',
  bottom: 'charcoal',
  accent: 'silver',
  shoes: 'dark_leather',
  belt: 'leather',
  cloak: 'violet',
  cloakLining: 'ranger_teal',
  cloakTrim: 'silver',
  held: 'staff',
  staffCrystal: ['#4f3db3', '#8fd8e8', '#e8fbff'],
  workTool: 'axe',
  build: 'slim',
  eyes: '#7a64e0',
  eyeStyle: 'big',
  lashes: true,
  blush: true,
  glowColor: '#b9a8ff',
};

// Hostile humanoids share the generator.
export const BANDIT_APPEARANCE = {
  key: 'bandit',
  skin: 'tan',
  hair: 'dark_brown',
  hairStyle: 'hood',
  hoodColor: 'charcoal',
  mask: 'wine',
  outfit: 'tunic',
  top: 'leather',
  bottom: 'charcoal',
  accent: 'dark_leather',
  shoes: 'dark_leather',
  held: 'sword',
  build: 'normal',
  eyes: '#1a1423',
  rust: true,
};

export const BANDIT_ARCHER_APPEARANCE = {
  key: 'bandit_archer',
  skin: 'light',
  hair: 'auburn',
  hairStyle: 'hood',
  hoodColor: 'moss',
  mask: 'charcoal',
  outfit: 'tunic',
  top: 'olive',
  bottom: 'dark_leather',
  accent: 'leather',
  shoes: 'leather',
  held: 'bow',
  quiver: true,
  build: 'slim',
  eyes: '#1a1423',
};

export const BANDIT_CHIEF_APPEARANCE = {
  key: 'bandit_chief',
  skin: 'brown',
  hair: 'black',
  hairStyle: 'bald',
  accessories: ['beard', 'eyepatch'],
  beardColor: 'black',
  outfit: 'armor',
  armor: 'iron',
  tabard: 'wine',
  pauldron: 'fur',
  top: 'leather',
  bottom: 'charcoal',
  accent: 'wine',
  shoes: 'dark_leather',
  held: 'axe',
  build: 'big',
  eyes: '#1a1423',
  scar: true,
  rust: true,
};

export const SKELETON_APPEARANCE = {
  key: 'skeleton',
  skeleton: true,
  hairStyle: 'bald',
  outfit: 'trousers',
  top: 'bone',
  bottom: 'rust',
  held: 'sword',
  rust: true,
  build: 'normal',
  eyes: '#ff9a5a',
};

// A plain villager for actors without their own sprite key.
export const VILLAGER_APPEARANCE = {
  key: 'villager',
  skin: 'tan',
  hair: 'brown',
  hairStyle: 'short',
  outfit: 'trousers',
  top: 'cream',
  bottom: 'brown',
  held: 'none',
};

export const PRESET_APPEARANCES = {
  player: PLAYER_APPEARANCE,
  lyra: LYRA_APPEARANCE,
  bandit: BANDIT_APPEARANCE,
  bandit_archer: BANDIT_ARCHER_APPEARANCE,
  bandit_chief: BANDIT_CHIEF_APPEARANCE,
  skeleton: SKELETON_APPEARANCE,
  villager: VILLAGER_APPEARANCE,
};

export const tint = mixHex;
