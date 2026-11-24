// The Weave's fixed component ids (DESIGN §22.1) and how Hearthvale talks about each one
// (LORE §13). The magic runtime (src/magic/*) owns what they do; this module only knows
// their names, so missions, hints and reward reveals read well even before the runtime
// is merged. Ids are a contract: never rename them.

export const SHAPES = ['bolt', 'blast', 'strike', 'throw', 'beam', 'nova', 'orb', 'summon', 'rune', 'rain', 'wall', 'dash'];
export const ESSENCES = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'wind', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
export const TWISTS = ['multishot', 'split', 'pierce', 'bounce', 'chain', 'homing', 'echo', 'big', 'swift', 'burst', 'linger', 'orbit', 'volley', 'spiral', 'leech', 'charge'];

export const KINDS = { shape: SHAPES, essence: ESSENCES, twist: TWISTS };

// What the player holds on the first morning (core's starting state).
export const STARTING = [
  { kind: 'shape', id: 'bolt' },
  { kind: 'essence', id: 'raw' },
];

// The five bosses own these drops (r4/bosses); missions never grant them.
export const BOSS_REWARDS = {
  varek: [{ kind: 'essence', id: 'fire' }, { kind: 'twist', id: 'volley' }],
  greyjaw: [{ kind: 'essence', id: 'wind' }, { kind: 'twist', id: 'swift' }],
  mother_of_slimes: [{ kind: 'essence', id: 'poison' }, { kind: 'twist', id: 'split' }],
  lakes_hum: [{ kind: 'essence', id: 'water' }, { kind: 'twist', id: 'bounce' }],
  bone_warden: [{ kind: 'essence', id: 'dark' }, { kind: 'twist', id: 'chain' }],
};

export const BOSS_NAMES = {
  varek: 'Varek One-Eye',
  greyjaw: 'Greyjaw',
  mother_of_slimes: 'the Mother of Slimes',
  lakes_hum: "the Lake's Hum",
  bone_warden: 'the Bone Warden',
};

export const BOSS_PLACES = {
  varek: 'the bandit camp in the hills above the fork',
  greyjaw: 'deep Whisperwood, at dusk',
  mother_of_slimes: "the quarry's rain-pools",
  lakes_hum: 'the middle of Mirror Lake',
  bone_warden: 'the lower hall of the Sunken Ruins',
};

// Hearthvale's words for each piece: a village name and one line of what it does.
export const WORDS = {
  shape: {
    bolt: ['Spark', 'light thrown hard enough to strike'],
    blast: ['Flare', 'a burst in the face of whatever is in front of you'],
    strike: ['Strike', 'a punch with the weave behind it, and a wave where it lands'],
    throw: ['Lob', 'thrown like a sling-stone; it lands and bursts'],
    beam: ['Lamp-beam', 'a line of light you hold, like a lantern held up on the road'],
    nova: ['Ring', 'a ring of light around you, the way the altar flames lean in'],
    orb: ['Lantern', 'a slow light that hangs in the air and pulses on what it passes'],
    summon: ['Familiar', 'a small companion made of whatever you weave into it'],
    rune: ['Ward-mark', 'a mark set on the ground that waits for a foe to cross it'],
    rain: ['Brightfall', 'light that falls on a spot like snow on a still night'],
    wall: ['Line', 'a barrier: here, and not past here'],
    dash: ['Wardrun', 'a blink across the ground that leaves the weave in your track'],
  },
  essence: {
    raw: ['Violet', 'the weave with nothing in it but itself'],
    fire: ['Fire', 'the fire that never goes out'],
    water: ['Water', 'still water, and what it does when it stops being still'],
    frost: ['Frost', 'the cold that comes off the lake after dark'],
    storm: ['Storm', 'glimmer caught and loosed: crackle and blue light'],
    earth: ['Stone', 'quarry stone that remembers being a hill'],
    wind: ['Wind', 'the wind off the Crownfells, with a bite in it'],
    nature: ['Green', 'the quickening in silverleaf and moonpetal'],
    poison: ['Venom', 'what the slime-pools leave on a blade'],
    light: ['Light', 'candle-light, the oldest thing Hearthvale keeps'],
    dark: ['Dark', "a cold, borrowed light, too like the ruins' gravelight"],
    iron: ['Iron', 'forgesung iron, which bites turned things like cloth'],
    song: ['Song', 'a hum like the Wellstone at the bottom of the well'],
  },
  twist: {
    multishot: ['Many', 'more than one at a time, fanned out'],
    split: ['Splitting', 'breaks into three when it hits'],
    pierce: ['Piercing', 'goes through, the way a spear goes through straw'],
    bounce: ['Skipping', 'skips off walls like a stone off water'],
    chain: ['Chaining', 'jumps from one foe to the next'],
    homing: ['Seeking', 'finds its mark like a hound on a trail'],
    echo: ['Echoing', 'says it twice, the way a hive answers a song'],
    big: ['Great', 'bigger, slower, heavier'],
    swift: ['Swift', 'faster than a thrown thing should be'],
    burst: ['Bursting', 'goes off with a bang where it ends'],
    linger: ['Lingering', 'leaves something growing where it lands'],
    orbit: ['Circling', 'circles you first, like moths round a lamp'],
    volley: ['Volley', 'three in quick succession'],
    spiral: ['Spinning', "a weaving path (Pip calls it the Spinny One)"],
    leech: ['Sharing', 'gives a little back to you: a spoon for them, a spoon for you'],
    charge: ['Gathered', 'hold it, let it gather, then let it go'],
  },
};

export function isComponent(kind, id) {
  return !!KINDS[kind]?.includes(id);
}

export function isBossReward(kind, id) {
  return Object.values(BOSS_REWARDS).some((list) => list.some((r) => r.kind === kind && r.id === id));
}

export function bossFor(kind, id) {
  for (const [boss, list] of Object.entries(BOSS_REWARDS)) if (list.some((r) => r.kind === kind && r.id === id)) return boss;
  return null;
}

// Every component a mission must grant: all of them but the starting ones and the boss drops.
export function missionComponents() {
  const out = [];
  for (const [kind, ids] of Object.entries(KINDS)) {
    for (const id of ids) {
      if (STARTING.some((s) => s.kind === kind && s.id === id)) continue;
      if (isBossReward(kind, id)) continue;
      out.push({ kind, id });
    }
  }
  return out;
}

function title(id) {
  return String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// The name the Spellbook would show: the runtime's own name when it has one.
export function componentLabel(kind, id, game = null) {
  const reg = game?.magic?.registry || game?.magic?.registries || null;
  const table = reg?.[`${kind}s`] || reg?.[kind] || null;
  const entry = table && (typeof table.get === 'function' ? table.get(id) : table[id]);
  if (entry?.name) return String(entry.name);
  return title(id);
}

export function componentWords(kind, id) {
  const w = WORDS[kind]?.[id];
  return w ? { name: w[0], line: w[1] } : { name: title(id), line: '' };
}

export const KIND_LABEL = { shape: 'shape', essence: 'essence', twist: 'twist' };
