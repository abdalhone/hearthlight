// What the interface knows about the Weave's building blocks (DESIGN.md §22.1): names,
// one-line descriptions, a fallback palette per essence and an aim preview per shape.
// The runtime's registries (game.magic) win wherever they say something; this table
// only fills gaps, so an entry added to a registry shows up here with a generic look.
// Pure data and small pure helpers: unit-tested without a browser.

export const KINDS = ['shapes', 'essences', 'twists'];

export const SHAPE_IDS = ['bolt', 'blast', 'strike', 'throw', 'beam', 'nova', 'orb', 'summon', 'rune', 'rain', 'wall', 'dash', 'bind', 'ward'];
export const ESSENCE_IDS = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'wind', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
export const TWIST_IDS = ['multishot', 'split', 'pierce', 'bounce', 'chain', 'homing', 'echo', 'big', 'swift', 'burst', 'linger', 'orbit', 'volley', 'spiral', 'leech', 'charge'];

export const IDS = { shapes: SHAPE_IDS, essences: ESSENCE_IDS, twists: TWIST_IDS };

export const SHAPE_INFO = {
  bolt: { name: 'Bolt', desc: 'A quick projectile.', preview: { type: 'line', range: 150, width: 6 } },
  blast: { name: 'Blast', desc: 'A short cone burst.', preview: { type: 'cone', range: 56, angle: 1.1 } },
  strike: { name: 'Strike', desc: 'A punch with an impact wave.', preview: { type: 'arc', range: 30, angle: 1.6 } },
  throw: { name: 'Throw', desc: 'Lobbed; it lands and bursts.', preview: { type: 'circle', range: 120, radius: 22 } },
  beam: { name: 'Beam', desc: 'A held line. Hold to keep it flowing.', preview: { type: 'line', range: 130, width: 8 } },
  nova: { name: 'Nova', desc: 'A ring bursting out around you.', preview: { type: 'ring', range: 0, radius: 46 } },
  orb: { name: 'Orb', desc: 'Slow and big; it pulses on everything it passes.', preview: { type: 'line', range: 140, width: 16 } },
  summon: { name: 'Summon', desc: 'A familiar whose form and bite come from its essences.', preview: { type: 'point', range: 60, radius: 10 } },
  rune: { name: 'Rune', desc: 'A glyph trap laid on the ground.', preview: { type: 'circle', range: 90, radius: 18 } },
  rain: { name: 'Rain', desc: 'Strikes fall on the spot you aim at.', preview: { type: 'circle', range: 130, radius: 34 } },
  wall: { name: 'Wall', desc: 'A barrier across your aim.', preview: { type: 'wall', range: 50, width: 64 } },
  dash: { name: 'Dash', desc: 'A blink that leaves the weave in a trail.', preview: { type: 'line', range: 70, width: 10 } },
  bind: { name: 'Bind', desc: 'Your own Stillring: a ring that closes on what you aim at and holds it still.', preview: { type: 'bind', range: 150, radius: 10 } },
  ward: { name: 'Ward', desc: 'A shield on you, or the friend you aim at: it takes blows and stops missiles.', preview: { type: 'shield', range: 110, radius: 13 } },
};

// Palettes follow DESIGN §22.1 { core, glow, spark, deep }; the runtime's own win.
export const ESSENCE_INFO = {
  raw: { name: 'Raw weave', desc: 'Unaspected violet Drift.', palette: { core: '#cdbcff', glow: '#8a6cff', spark: '#f3eeff', deep: '#3d2a8a' } },
  fire: { name: 'Fire', desc: 'Burns; spreads on grass and in the wind.', palette: { core: '#ffd36b', glow: '#ff7a2f', spark: '#fff3c4', deep: '#a3261b' } },
  water: { name: 'Water', desc: 'Soaks; carries a shock and freezes in frost.', palette: { core: '#a6e6ff', glow: '#3a9be0', spark: '#ecfbff', deep: '#1d4f9a' } },
  frost: { name: 'Frost', desc: 'Chills, then freezes.', palette: { core: '#eafcff', glow: '#8fd8ff', spark: '#ffffff', deep: '#3f7fb8' } },
  storm: { name: 'Storm', desc: 'Shocks and arcs between the wet.', palette: { core: '#fff59a', glow: '#7fd6ff', spark: '#ffffff', deep: '#3b4fa8' } },
  earth: { name: 'Earth', desc: 'Staggers; mud with water.', palette: { core: '#e0bb85', glow: '#a5733f', spark: '#f6e4c0', deep: '#4f3220' } },
  wind: { name: 'Wind', desc: 'Knocks back and fans flames.', palette: { core: '#e6fff5', glow: '#93e3c6', spark: '#ffffff', deep: '#3f8f7f' } },
  nature: { name: 'Nature', desc: 'Roots in place.', palette: { core: '#c2f283', glow: '#55c25a', spark: '#efffd6', deep: '#1f6b34' } },
  poison: { name: 'Poison', desc: 'Poisons over time; flares in fire.', palette: { core: '#d2f566', glow: '#86c43c', spark: '#f2ffc8', deep: '#5b2a7a' } },
  light: { name: 'Light', desc: 'Dazzles; eclipses against dark.', palette: { core: '#fffbe2', glow: '#ffe27a', spark: '#ffffff', deep: '#c98a2a' } },
  dark: { name: 'Dark', desc: 'Drains strength.', palette: { core: '#a88ae0', glow: '#5a3790', spark: '#e0d2ff', deep: '#1a0f30' } },
  iron: { name: 'Iron', desc: 'Sunders armour; conducts the storm.', palette: { core: '#e7ebf2', glow: '#9aa3b5', spark: '#ffffff', deep: '#4a5062' } },
  song: { name: 'Song', desc: 'Charms the wild for a moment.', palette: { core: '#ffd6f2', glow: '#f08cc8', spark: '#fff2fb', deep: '#8a3a7a' } },
};

export const TWIST_INFO = {
  multishot: { name: 'Multishot', desc: 'Two more, fanned out.' },
  split: { name: 'Split', desc: 'Divides into three on a hit.' },
  pierce: { name: 'Pierce', desc: 'Passes through what it hits.' },
  bounce: { name: 'Bounce', desc: 'Ricochets on.' },
  chain: { name: 'Chain', desc: 'Jumps to a foe nearby.' },
  homing: { name: 'Homing', desc: 'Seeks its target.' },
  echo: { name: 'Echo', desc: 'Casts again a moment later.' },
  big: { name: 'Big', desc: 'Larger and heavier.' },
  swift: { name: 'Swift', desc: 'Faster.' },
  burst: { name: 'Burst', desc: 'Explodes on a hit or at the end.' },
  linger: { name: 'Linger', desc: 'Leaves a patch of its essences.' },
  orbit: { name: 'Orbit', desc: 'Circles you before it flies.' },
  volley: { name: 'Volley', desc: 'Three in quick succession.' },
  spiral: { name: 'Spiral', desc: 'A weaving path.' },
  leech: { name: 'Leech', desc: 'Heals you a little.' },
  charge: { name: 'Charge', desc: 'Charges twice as fast, hits harder at full.' },
};

export const INFO = { shapes: SHAPE_INFO, essences: ESSENCE_INFO, twists: TWIST_INFO };

// Where the five bosses' gifts come from (DESIGN §22.3). Everything else is a mission
// reward; the missions system words those hints itself (game.missions.hintFor).
export const BOSS_HINTS = {
  'essences:fire': 'Won from Varek One-Eye at the bandit camp.',
  'twists:volley': 'Won from Varek One-Eye at the bandit camp.',
  'essences:wind': 'Won from Greyjaw, deep in the Whisperwood.',
  'twists:swift': 'Won from Greyjaw, deep in the Whisperwood.',
  'essences:poison': "Won from the Mother of Slimes in the quarry's rain-pools.",
  'twists:split': "Won from the Mother of Slimes in the quarry's rain-pools.",
  'essences:water': 'Won from the Lake’s Hum, out on Mirror Lake.',
  'twists:bounce': 'Won from the Lake’s Hum, out on Mirror Lake.',
  'essences:dark': 'Won from the Bone Warden in the Sunken Ruins.',
  'twists:chain': 'Won from the Bone Warden in the Sunken Ruins.',
};

export const GENERIC_HINT = 'Not yet found. Someone in Hearthvale may help you find it.';

// 'essence' | 'essences' -> 'essences' (the runtime's unlock() takes the singular).
export function normKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k.startsWith('shape')) return 'shapes';
  if (k.startsWith('essence')) return 'essences';
  if (k.startsWith('twist')) return 'twists';
  return '';
}

export function singular(kind) {
  return normKind(kind).replace(/s$/, '');
}

function titleCase(id) {
  return String(id || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Name and description of a component: the registry entry's own words first.
export function componentInfo(kind, id, entry = null) {
  const k = normKind(kind);
  const base = INFO[k]?.[id] || null;
  return {
    id,
    kind: k,
    name: (entry && (entry.name || entry.label)) || base?.name || titleCase(id),
    desc: (entry && (entry.desc || entry.description || entry.blurb)) || base?.desc || '',
    palette: paletteOf(entry?.palette) || base?.palette || null,
  };
}

const HEX = /^#[0-9a-f]{3,8}$/i;

// A usable { core, glow, spark, deep } from anything palette-like, or null.
export function paletteOf(p) {
  if (!p || typeof p !== 'object') return null;
  const core = p.core || p.main || p.color;
  const glow = p.glow || core;
  if (typeof core !== 'string' || typeof glow !== 'string') return null;
  return { core, glow, spark: typeof p.spark === 'string' ? p.spark : core, deep: typeof p.deep === 'string' ? p.deep : glow };
}

export function essencePalette(id, entry = null) {
  return paletteOf(entry?.palette) || ESSENCE_INFO[id]?.palette || ESSENCE_INFO.raw.palette;
}

// Mix two #rrggbb colours (t = share of b).
export function mixHex(a, b, t) {
  if (!HEX.test(a || '') || !HEX.test(b || '')) return a || b || '#ffffff';
  const pa = hexRgb(a);
  const pb = hexRgb(b);
  const c = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `#${[c(0), c(1), c(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hexRgb(h) {
  let s = String(h).slice(1);
  if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The palette of a weave: the plan's blended one if the runtime gave it, else a blend
// of its essences' palettes (raw when it has none).
export function weavePalette(weave, plan, entryOf = null) {
  const pp = paletteOf(plan?.palette);
  if (pp) return pp;
  const list = (weave?.essences || []).filter(Boolean);
  if (!list.length) return essencePalette('raw', entryOf?.('essences', 'raw'));
  let out = { ...essencePalette(list[0], entryOf?.('essences', list[0])) };
  for (let i = 1; i < list.length; i++) {
    const p = essencePalette(list[i], entryOf?.('essences', list[i]));
    const t = 1 / (i + 1);
    out = { core: mixHex(out.core, p.core, t), glow: mixHex(out.glow, p.glow, t), spark: mixHex(out.spark, p.spark, t), deep: mixHex(out.deep, p.deep, t) };
  }
  return out;
}

// The aim preview descriptor for a plan: the runtime's, else the shape's default.
// The runtime calls it plan.aim (r4/core); plan.preview is accepted too.
export function previewOf(plan, weave) {
  const pv = plan?.aim || plan?.preview;
  const shape = weave?.shape || plan?.shape || 'bolt';
  const base = SHAPE_INFO[shape]?.preview || SHAPE_INFO.bolt.preview;
  const count = Number(plan?.count) > 1 ? Math.min(7, Number(plan.count)) : 1;
  if (!pv || typeof pv !== 'object' || !pv.type) {
    const range = Number(plan?.range) > 0 ? Number(plan.range) : base.range;
    return { ...base, range, count };
  }
  const out = { ...base, ...pv };
  if (out.count == null) out.count = count;
  // A wall is a line laid across the aim, at the spot aimed at.
  if (out.across && out.type === 'line') out.type = 'wall';
  if (out.type === 'wall' && Number(out.length) > 0) out.width = Number(out.length);
  return out;
}

// Is a preview aimed at a spot (where the finger's distance matters) or a direction?
// (A bind is aimed at someone, a ward at whoever it shields: both spots.)
export function aimsAtSpot(preview) {
  const t = preview?.type;
  return t === 'circle' || t === 'point' || t === 'wall' || t === 'bind' || t === 'shield';
}

// How a weave is cast: 'hold' (channelled while held: beams), 'charge' (the charge
// twist: charges fast, release to fire) or 'quick' (a tap casts at once; held, it
// charges too: every weave but a beam does). The plan's own input wins: a beam with the
// charge twist charges and is let go, it does not pour.
export function castModeOf(plan, weave) {
  if (!plan && !weave) return 'quick';
  const twists = (weave?.twists || plan?.twists || []).map((t) => (typeof t === 'string' ? t : t?.id));
  if (plan?.input === 'charge' || plan?.mode === 'charge') return 'charge';
  if (plan?.input === 'hold' || plan?.mode === 'hold' || plan?.held === true || plan?.channel) return 'hold';
  if (twists.includes('charge')) return 'charge';
  if (plan?.input === 'tap') return 'quick';
  if ((weave?.shape || plan?.shape) === 'beam') return 'hold';
  return 'quick';
}

// A weave as plain data, trimmed to the limits (shape required for a castable weave).
export function cleanWeave(w, maxEss = 2, maxTw = 2, maxPr = 2) {
  if (!w || typeof w !== 'object') return null;
  const uniq = (a, max) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && x))].slice(0, Math.max(0, max));
  const out = { shape: typeof w.shape === 'string' ? w.shape : null, essences: uniq(w.essences, maxEss), twists: uniq(w.twists, maxTw) };
  // A price (DESIGN §25) rides with its weave: without this the Spellbook's choice never
  // reached the slot (r14a: the Last Stand could not be taken up from the Spellbook).
  // The runtime's compile still checks each one is earned and fits.
  if (Array.isArray(w.prices)) out.prices = uniq(w.prices, maxPr);
  if (typeof w.id === 'string') out.id = w.id;
  if (typeof w.name === 'string' && w.name.trim()) out.name = w.name.trim().slice(0, 32);
  return out;
}

export function sameWeave(a, b) {
  if (!a || !b) return !a && !b;
  return a.shape === b.shape && (a.name || '') === (b.name || '') && String(a.essences || []) === String(b.essences || []) && String(a.twists || []) === String(b.twists || []);
}

// A short readable name when the runtime has not named the weave: "Splitting Fire Bolt".
const TWIST_ADJ = { multishot: 'Triple', split: 'Splitting', pierce: 'Piercing', bounce: 'Bouncing', chain: 'Chaining', homing: 'Seeking', echo: 'Echoing', big: 'Great', swift: 'Swift', burst: 'Bursting', linger: 'Lingering', orbit: 'Orbiting', volley: 'Volleying', spiral: 'Spiralling', leech: 'Leeching', charge: 'Charged' };
const ESSENCE_ADJ = { raw: '', fire: 'Ember', water: 'Tide', frost: 'Frost', storm: 'Storm', earth: 'Stone', wind: 'Gale', nature: 'Thorn', poison: 'Venom', light: 'Dawn', dark: 'Shade', iron: 'Iron', song: 'Song' };

export function fallbackName(weave) {
  if (!weave?.shape) return 'Empty';
  const shape = SHAPE_INFO[weave.shape]?.name || titleCase(weave.shape);
  const tw = (weave.twists || []).map((t) => TWIST_ADJ[t] || titleCase(t))[0] || '';
  const es = (weave.essences || []).map((e) => ESSENCE_ADJ[e] ?? titleCase(e)).filter(Boolean).join('-');
  return [tw, es, shape].filter(Boolean).join(' ');
}
