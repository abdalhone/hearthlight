// Gear (DESIGN §26): what the stranger wears and carries, its numbers and where it comes
// from. Plain data, no imports, so items.js can fold these into ITEMS and node tests load
// it cleanly. Each piece: { name, slot, rarity, value, desc, stats: { add, pct },
// up: { add, pct } (per upgrade level at Bram's forge; weapons and armor only), maxUp,
// tint (sprite color), icon (items_art shape), from (where it comes from, in words) }.
// Item ids are a contract: never rename.

export const SLOTS = Object.freeze(['weapon', 'armor', 'cloak', 'boots', 'charm1', 'charm2']);
export const SLOT_LABEL = Object.freeze({ weapon: 'Weapon', armor: 'Armor', cloak: 'Cloak', boots: 'Boots', charm1: 'Charm', charm2: 'Charm' });
// Which equip slot(s) an item kind fits.
export const KIND_SLOTS = Object.freeze({ weapon: ['weapon'], armor: ['armor'], cloak: ['cloak'], boots: ['boots'], charm: ['charm1', 'charm2'] });

export const RARITY = Object.freeze({
  common: { label: 'Common', color: '#cfc6b4', rank: 0, maxUp: 3 },
  uncommon: { label: 'Uncommon', color: '#6fd08c', rank: 1, maxUp: 4 },
  rare: { label: 'Rare', color: '#6fa8ff', rank: 2, maxUp: 5 },
  epic: { label: 'Epic', color: '#c58cff', rank: 3, maxUp: 5 },
  legendary: { label: 'Legendary', color: '#ffb047', rank: 4, maxUp: 6 },
});

export const GEAR = {
  // ---------------------------------------------------------------- weapons (Bram)
  iron_sword: {
    name: 'Iron Sword',
    slot: 'weapon',
    rarity: 'common',
    value: 40,
    desc: 'Forged by Bram Ironhand. Plain, true, and it does not turn in the hand.',
    stats: { add: { atk: 3 } },
    up: { add: { atk: 1 } },
    tint: '#c9d2dc',
    from: 'Sold at the smithy.',
  },
  steel_sword: {
    name: 'Steel Sword',
    slot: 'weapon',
    rarity: 'uncommon',
    value: 110,
    desc: 'Bram folds the iron with a crystal\'s dust. It rings when it bites.',
    stats: { add: { atk: 5, crit: 0.03 } },
    up: { add: { atk: 1.2 } },
    tint: '#e4ecf4',
    from: 'Forged at the smithy.',
  },
  forgesung_blade: {
    name: 'Forgesung Blade',
    slot: 'weapon',
    rarity: 'epic',
    value: 320,
    desc: 'Bram listened to this one cool. It hums under the hand like a held note.',
    stats: { add: { atk: 8, crit: 0.05 }, pct: { spellPower: 0.05 } },
    up: { add: { atk: 1.6 } },
    tint: '#ffd27a',
    from: 'Forged at the smithy, once Bram trusts your hand.',
  },
  varek_cleaver: {
    name: "Varek's Cleaver",
    slot: 'weapon',
    rarity: 'rare',
    value: 180,
    desc: 'A bandit chief\'s heavy blade, notched along the back. It swings slow and lands like a door.',
    stats: { add: { atk: 7, crit: 0.04 }, pct: { swing: -0.08 } },
    up: { add: { atk: 1.5 } },
    tint: '#b88a6a',
    from: 'Carried by Varek One-Eye.',
  },
  greyjaw_fang: {
    name: "Greyjaw's Fang",
    slot: 'weapon',
    rarity: 'rare',
    value: 170,
    desc: 'A long knife set with the pack leader\'s tooth. Quick as he was.',
    stats: { add: { atk: 5, crit: 0.08 }, pct: { swing: 0.15 } },
    up: { add: { atk: 1.2, crit: 0.01 } },
    tint: '#e8e2d0',
    from: 'Taken from Greyjaw in deep Whisperwood.',
  },
  warden_bonebrand: {
    name: "The Warden's Bonebrand",
    slot: 'weapon',
    rarity: 'epic',
    value: 300,
    desc: 'Pale iron that was never forged by any hand in Hearthvale. Weaves go easier with it held.',
    stats: { add: { atk: 9 }, pct: { spellPower: 0.1 } },
    up: { add: { atk: 1.6 }, pct: { spellPower: 0.02 } },
    tint: '#cfe6ff',
    from: 'Held by the Bone Warden in the Sunken Ruins.',
  },

  // ---------------------------------------------------------------- armor (Bram)
  leather_jerkin: {
    name: 'Leather Jerkin',
    slot: 'armor',
    rarity: 'common',
    value: 45,
    desc: 'Boiled leather with Bram\'s rivets. Turns a bite, mostly.',
    stats: { add: { def: 1, maxHp: 6 } },
    up: { add: { def: 0.5, maxHp: 3 } },
    tint: '#8a5a3a',
    from: 'Sold at the smithy.',
  },
  iron_mail: {
    name: 'Iron Mail',
    slot: 'armor',
    rarity: 'uncommon',
    value: 130,
    desc: 'Riveted rings over quilting. Heavy on the shoulders, kind to the ribs.',
    stats: { add: { def: 2, maxHp: 12 }, pct: { speed: -0.04 } },
    up: { add: { def: 0.6, maxHp: 4 } },
    tint: '#9aa6b4',
    from: 'Forged at the smithy.',
  },
  lakeglass_mail: {
    name: 'Lakeglass Mail',
    slot: 'armor',
    rarity: 'rare',
    value: 210,
    desc: 'Scales of something the lake grew, cold to the touch. Spells slide off it.',
    stats: { add: { def: 2, maxHp: 14, resist: 0.12 } },
    up: { add: { def: 0.6, maxHp: 4, resist: 0.02 } },
    tint: '#7fd6d0',
    from: "Left by the Lake's Hum under Mirror Lake.",
  },
  ironhand_plate: {
    name: 'Ironhand Plate',
    slot: 'armor',
    rarity: 'epic',
    value: 340,
    desc: 'Bram\'s best, fitted to you strap by strap. Hard to fall in.',
    stats: { add: { def: 4, maxHp: 24, bleedout: 10 }, pct: { speed: -0.06 } },
    up: { add: { def: 0.8, maxHp: 5 } },
    tint: '#d2dae4',
    from: 'Forged at the smithy, once Bram trusts your hand.',
  },

  // ---------------------------------------------------------------- cloaks (Sabeth)
  traveler_cloak: {
    name: "Traveler's Cloak",
    slot: 'cloak',
    rarity: 'common',
    value: 35,
    desc: 'Grey wool with a teal hem. Sabeth sews them for anyone leaving the ward.',
    stats: { add: { dodge: 0.03, maxHp: 4 } },
    tint: '#5f8f8c',
    from: "Sewn at the dye-vats.",
  },
  murrel_cloak: {
    name: 'Murrel Cloak',
    slot: 'cloak',
    rarity: 'uncommon',
    value: 90,
    desc: 'Murrel-root violet, cut close so it never snags. Light on the run.',
    stats: { add: { dodge: 0.05, resist: 0.04 }, pct: { speed: 0.04 } },
    tint: '#7d4fb0',
    from: 'Sewn at the dye-vats.',
  },
  lakewort_cloak: {
    name: 'Lakewort Cloak',
    slot: 'cloak',
    rarity: 'uncommon',
    value: 95,
    desc: 'Dyed in Mirror Lake\'s lake-wort. Your breath comes slower in it, and the weave with it.',
    stats: { add: { maxMana: 6 }, pct: { manaRegen: 0.15 } },
    tint: '#2f9a9a',
    from: 'Sewn at the dye-vats.',
  },
  madder_mantle: {
    name: 'Madder Mantle',
    slot: 'cloak',
    rarity: 'rare',
    value: 180,
    desc: 'Madder red, the dye that costs the most root. Sabeth only made the one.',
    stats: { add: { crit: 0.05 }, pct: { castSpeed: 0.08, dmgDealt: 0.04 } },
    tint: '#b33a3a',
    from: "Sabeth's thanks for the red thread.",
  },

  // ---------------------------------------------------------------- boots (Garrick)
  field_boots: {
    name: 'Field Boots',
    slot: 'boots',
    rarity: 'common',
    value: 30,
    desc: 'Saltmere-stitched, broken in by someone else. Garrick swears they are lucky.',
    stats: { pct: { speed: 0.05 } },
    tint: '#6a4a32',
    from: "Sold at Gale's Goods.",
  },
  roadrunner_boots: {
    name: 'Roadrunner Boots',
    slot: 'boots',
    rarity: 'uncommon',
    value: 85,
    desc: 'Soft soles for the King\'s Road. Quiet, quick, gone.',
    stats: { add: { dodge: 0.03 }, pct: { speed: 0.08 } },
    tint: '#3e5a7a',
    from: "Sold at Gale's Goods.",
  },
  gelstep_boots: {
    name: 'Gelstep Boots',
    slot: 'boots',
    rarity: 'rare',
    value: 170,
    desc: 'Lined with the Mother\'s own gel. They grip wet stone and shrug off what clings.',
    stats: { add: { dodge: 0.04, resist: 0.1 }, pct: { speed: 0.06 } },
    tint: '#7ccf6a',
    from: 'Left in the quarry pools by the Mother of Slimes.',
  },

  // ---------------------------------------------------------------- charms (Garrick and others)
  hearth_charm: {
    name: 'Hearth Charm',
    slot: 'charm',
    rarity: 'common',
    value: 25,
    desc: 'A knot of red thread around a cinder. Small charms make people braver in the dark.',
    stats: { add: { hpRegen: 0.25 } },
    tint: '#e0603a',
    from: "Sold at Gale's Goods.",
  },
  lucky_knucklebone: {
    name: 'Lucky Knucklebone',
    slot: 'charm',
    rarity: 'common',
    value: 30,
    desc: 'Garrick won it at dice in Owlsend. Or lost it. The story changes.',
    stats: { add: { crit: 0.04 } },
    tint: '#efe6cf',
    from: "Sold at Gale's Goods.",
  },
  moonglass_bead: {
    name: 'Moonglass Bead',
    slot: 'charm',
    rarity: 'uncommon',
    value: 70,
    desc: 'A bead of pale glass on a cord. Holds a little light, gives a little back.',
    stats: { add: { maxMana: 8 }, pct: { manaRegen: 0.1 } },
    tint: '#bfd8ff',
    from: "Sold at Gale's Goods.",
  },
  wolftooth_charm: {
    name: 'Wolftooth Charm',
    slot: 'charm',
    rarity: 'uncommon',
    value: 75,
    desc: 'A wolf\'s canine wrapped in wire. The road crews wear them.',
    stats: { add: { atk: 1, dodge: 0.02 } },
    tint: '#dcd4c2',
    from: "Sold at Gale's Goods.",
  },
  saints_thread: {
    name: "Saint's Thread",
    slot: 'charm',
    rarity: 'uncommon',
    value: 80,
    desc: 'A chapel-blessed thread tied at the wrist. Wounds wait for help a little longer.',
    stats: { add: { resist: 0.12, bleedout: 10 } },
    tint: '#ffe08a',
    from: "Sold at Gale's Goods.",
  },
  humstone: {
    name: 'Humstone',
    slot: 'charm',
    rarity: 'rare',
    value: 150,
    desc: 'A lake pebble that never stops humming. Weaves come out of your hands quicker near it.',
    stats: { add: { maxMana: 12 }, pct: { castSpeed: 0.06 } },
    tint: '#8ad8ff',
    from: "Corran's thanks for a still lake.",
  },
  lanternwright_glyph: {
    name: 'Lanternwright Glyph',
    slot: 'charm',
    rarity: 'epic',
    value: 280,
    desc: 'A glyph cut in stone that rings like an anvil. It knows the shapes your hands make.',
    stats: { pct: { spellPower: 0.12, cooldown: -0.08 } },
    tint: '#ffd27a',
    from: 'Found where the Bone Warden fell.',
  },
};

// Potions and food with timed buffs (Mira's tonics, Elda's kitchen): plain items whose
// `buff` the pipeline adds as a modifier when eaten or drunk.
export const BUFF_ITEMS = {
  ironbark_tonic: { name: 'Ironbark Tonic', type: 'potion', value: 30, heal: 0, desc: "Mira's bitter bark tonic. Skin like old oak for a while.", buff: { label: 'Ironbark', seconds: 180, add: { def: 2 }, color: '#a0784a' } },
  swiftfoot_draught: { name: 'Swiftfoot Draught', type: 'potion', value: 28, heal: 0, desc: 'Peppermint and something fizzing. Your feet forget they are tired.', buff: { label: 'Swiftfoot', seconds: 120, pct: { speed: 0.12 }, add: { dodge: 0.03 }, color: '#7fe0b0' } },
  clearmind_tincture: { name: 'Clearmind Tincture', type: 'potion', value: 32, heal: 0, desc: 'Three drops under the tongue. The weave comes back to you faster.', buff: { label: 'Clearmind', seconds: 180, pct: { manaRegen: 0.4 }, color: '#9fc8ff' } },
  heartwort_salve: { name: 'Heartwort Salve', type: 'potion', value: 26, heal: 6, desc: 'Rubbed on the chest. Wounds knit while you walk.', buff: { label: 'Heartwort', seconds: 60, add: { hpRegen: 1.2 }, color: '#ff8a8a' } },
  emberroot_soup: { name: 'Emberroot Soup', type: 'food', value: 18, heal: 10, desc: "Elda's hot soup. You could punch a door after a bowl.", buff: { label: 'Emberroot', seconds: 240, add: { atk: 1.5, resist: 0.1 }, color: '#ff9a4a' } },
  travelers_pie: { name: "Traveler's Pie", type: 'food', value: 16, heal: 10, desc: 'Mutton, turnip and a crust like armor. Sits in you all day.', buff: { label: 'Well fed', seconds: 300, add: { maxHp: 10 }, color: '#e6c07a' } },
  spiced_cider: { name: 'Spiced Cider', type: 'food', value: 12, heal: 4, desc: 'Warm, sweet, sharp. Your fingers move quicker.', buff: { label: 'Spiced', seconds: 180, pct: { castSpeed: 0.08 }, color: '#e0a060' } },
};

// ITEMS-shaped entries for every gear piece (iron_sword stays the weapon it always was).
export const GEAR_ITEMS = {};
for (const [id, g] of Object.entries(GEAR)) {
  if (id === 'iron_sword') continue;
  GEAR_ITEMS[id] = { name: g.name, type: 'gear', slot: g.slot, rarity: g.rarity, value: g.value, desc: g.desc };
}

export function gearDef(id) {
  return Object.prototype.hasOwnProperty.call(GEAR, id) ? GEAR[id] : null;
}

export function isGear(id) {
  return !!gearDef(id);
}

export function rarityOf(id) {
  const g = gearDef(id);
  return RARITY[g?.rarity] || RARITY.common;
}

export function maxUpOf(id) {
  const g = gearDef(id);
  if (!g) return 0;
  if (g.slot !== 'weapon' && g.slot !== 'armor') return 0;
  return Number.isFinite(g.maxUp) ? g.maxUp : rarityOf(id).maxUp;
}

// A piece's numbers at an upgrade level: base + level × up.
export function gearStats(id, level = 0) {
  const g = gearDef(id);
  if (!g) return null;
  const lv = Math.max(0, Math.min(maxUpOf(id), Math.floor(level || 0)));
  const add = { ...(g.stats?.add || {}) };
  const pct = { ...(g.stats?.pct || {}) };
  if (lv && g.up) {
    for (const [k, v] of Object.entries(g.up.add || {})) add[k] = Math.round(((add[k] || 0) + v * lv) * 1000) / 1000;
    for (const [k, v] of Object.entries(g.up.pct || {})) pct[k] = Math.round(((pct[k] || 0) + v * lv) * 1000) / 1000;
  }
  return { add, pct };
}

// What Bram asks for the next level: ore, crystals (rarer pieces need them early) and coin.
export function upgradeCost(id, level) {
  const g = gearDef(id);
  if (!g) return null;
  const next = Math.floor(level || 0) + 1;
  if (next > maxUpOf(id)) return null;
  const rank = rarityOf(id).rank;
  return {
    level: next,
    coin: Math.round((30 + 22 * rank) * next),
    iron_ore: 1 + next + rank,
    crystal: rank >= 2 ? next : next >= 3 ? next - 2 : 0,
  };
}

// What Bram can forge from scratch. needs: { level?, opinion? } (Bram's of the player).
export const FORGE_RECIPES = [
  { id: 'iron_sword', coin: 25, iron_ore: 2, crystal: 0 },
  { id: 'leather_jerkin', coin: 30, iron_ore: 1, crystal: 0, wolf_pelt: 1 },
  { id: 'steel_sword', coin: 70, iron_ore: 3, crystal: 1 },
  { id: 'iron_mail', coin: 80, iron_ore: 4, crystal: 0 },
  { id: 'forgesung_blade', coin: 220, iron_ore: 6, crystal: 4, needs: { level: 6, opinion: 55 } },
  { id: 'ironhand_plate', coin: 260, iron_ore: 8, crystal: 3, needs: { level: 7, opinion: 55 } },
];

// Who sells what (DESIGN §26: Bram forges, Sabeth sews, Garrick sells charms and boots,
// Mira and Elda sell potions and food with timed buffs). Merged into each shop at start.
export const SHOP_STOCK = {
  bram: [
    { id: 'iron_sword', price: 45 },
    { id: 'leather_jerkin', price: 50 },
  ],
  sabeth: [
    { id: 'traveler_cloak', price: 35 },
    { id: 'murrel_cloak', price: 90 },
    { id: 'lakewort_cloak', price: 95 },
  ],
  garrick: [
    { id: 'field_boots', price: 30 },
    { id: 'roadrunner_boots', price: 85 },
    { id: 'hearth_charm', price: 25 },
    { id: 'lucky_knucklebone', price: 30 },
    { id: 'moonglass_bead', price: 70 },
    { id: 'wolftooth_charm', price: 75 },
    { id: 'saints_thread', price: 80 },
  ],
  mira: [
    { id: 'potion', price: 22 },
    { id: 'heartwort_salve', price: 26 },
    { id: 'ironbark_tonic', price: 30 },
    { id: 'swiftfoot_draught', price: 28 },
    { id: 'clearmind_tincture', price: 32 },
  ],
  elda: [
    { id: 'emberroot_soup', price: 18 },
    { id: 'travelers_pie', price: 16 },
    { id: 'spiced_cider', price: 12 },
  ],
};

export const SHOP_BUYS = {
  mira: { herb: 3, moonpetal: 6, slime_gel: 3, bat_wing: 3 },
  bram: { wolf_pelt: 8 },
};

// Bosses drop special pieces where they fall (their reward hook: boss_defeated).
export const BOSS_GEAR = {
  varek: ['varek_cleaver'],
  greyjaw: ['greyjaw_fang'],
  mother_of_slimes: ['gelstep_boots'],
  lakes_hum: ['lakeglass_mail'],
  bone_warden: ['warden_bonebrand', 'lanternwright_glyph'],
};
