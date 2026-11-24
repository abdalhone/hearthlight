import { Essences } from './essences.js';
import { mix, lighten, darken, readable } from './fx_util.js';

// How each essence LOOKS (fx_bodies, fx_familiars, fx_status read this). One entry per
// essence; an essence with no entry (a new one added to ESSENCES) borrows the look of
// the essence whose particle style it shares, so it works everywhere at once.
//
//   form      the core of a missile: flare orb shard crackle rock crescent thorn glob star
//             void blade chime gem
//   trail     particle styles its bodies shed (fx_particles STYLES)
//   ring      what rides the edge of a nova / blast: flames spikes rocks foam zigs rays
//             smoke bubbles leaves swirl blades echo motes
//   patch     a lingering ground patch: embers puddle glaze crackle cracks gusts brambles
//             ooze sigil shadow filings chord arcane
//   wall      flame water ice storm stone wind thorns poison light shadow iron song arcane
//   beam      flame stream crystal lightning sand spiral vine acid ray void chain wave arcane
//   fall      a rain drop: meteor rain icicle bolt rock gust thorn acid ray spear blade note gem
//   familiar  hound sprite owl wisp imp kite thornling toad moth shade beetle singer arcane
//   glyph     the rune's central sign: flame drop flake bolt peak swirl leaf skull sun moon
//             anvil note diamond
//   debris    particle styles thrown by impacts and explosions
//   smoke     explosions leave smoke (fire, earth, dark)
//   flicker   how much its light flickers (0..1); lightK scales its light
//   dark      it darkens what it touches (shadow) rather than only lighting it

export const LOOKS = {
  raw: { form: 'gem', trail: ['mote'], ring: 'motes', patch: 'arcane', wall: 'arcane', beam: 'arcane', fall: 'gem', familiar: 'arcane', glyph: 'diamond', debris: ['mote', 'spark'], flicker: 0.12, lightK: 1 },
  fire: { form: 'flare', trail: ['flame', 'ember'], ring: 'flames', patch: 'embers', wall: 'flame', beam: 'flame', fall: 'meteor', familiar: 'hound', glyph: 'flame', debris: ['flame', 'ember'], smoke: true, flicker: 0.55, lightK: 1.15 },
  water: { form: 'orb', trail: ['drop', 'bubble'], ring: 'foam', patch: 'puddle', wall: 'water', beam: 'stream', fall: 'rain', familiar: 'sprite', glyph: 'drop', debris: ['drop', 'drop', 'foam'], flicker: 0.08, lightK: 0.8 },
  frost: { form: 'shard', trail: ['shard', 'snow'], ring: 'spikes', patch: 'glaze', wall: 'ice', beam: 'crystal', fall: 'icicle', familiar: 'owl', glyph: 'flake', debris: ['shard', 'snow'], flicker: 0.05, lightK: 0.9 },
  storm: { form: 'crackle', trail: ['zap', 'spark'], ring: 'zigs', patch: 'crackle', wall: 'storm', beam: 'lightning', fall: 'bolt', familiar: 'wisp', glyph: 'bolt', debris: ['zap', 'spark'], flicker: 0.8, lightK: 1.2 },
  earth: { form: 'rock', trail: ['dust', 'pebble'], ring: 'rocks', patch: 'cracks', wall: 'stone', beam: 'sand', fall: 'rock', familiar: 'imp', glyph: 'peak', debris: ['pebble', 'pebble', 'dust'], smoke: true, flicker: 0.04, lightK: 0.6 },
  wind: { form: 'crescent', trail: ['gust'], ring: 'swirl', patch: 'gusts', wall: 'wind', beam: 'spiral', fall: 'gust', familiar: 'kite', glyph: 'swirl', debris: ['gust', 'gust', 'mote'], flicker: 0.1, lightK: 0.6 },
  nature: { form: 'thorn', trail: ['leaf', 'petal'], ring: 'leaves', patch: 'brambles', wall: 'thorns', beam: 'vine', fall: 'thorn', familiar: 'thornling', glyph: 'leaf', debris: ['leaf', 'petal'], flicker: 0.06, lightK: 0.7 },
  poison: { form: 'glob', trail: ['bubble', 'drip'], ring: 'bubbles', patch: 'ooze', wall: 'poison', beam: 'acid', fall: 'acid', familiar: 'toad', glyph: 'skull', debris: ['bubble', 'drip'], flicker: 0.15, lightK: 0.75 },
  light: { form: 'star', trail: ['mote', 'twinkle'], ring: 'rays', patch: 'sigil', wall: 'light', beam: 'ray', fall: 'ray', familiar: 'moth', glyph: 'sun', debris: ['twinkle', 'mote'], flicker: 0.04, lightK: 1.35 },
  dark: { form: 'void', trail: ['wisp', 'mote'], ring: 'smoke', patch: 'shadow', wall: 'shadow', beam: 'void', fall: 'spear', familiar: 'shade', glyph: 'moon', debris: ['wisp', 'wisp', 'mote'], smoke: true, dark: true, flicker: 0.2, lightK: 0.7 },
  iron: { form: 'blade', trail: ['filing', 'spark'], ring: 'blades', patch: 'filings', wall: 'iron', beam: 'chain', fall: 'blade', familiar: 'beetle', glyph: 'anvil', debris: ['filing', 'spark'], flicker: 0.25, lightK: 0.75 },
  song: { form: 'chime', trail: ['note', 'mote'], ring: 'echo', patch: 'chord', wall: 'song', beam: 'wave', fall: 'note', familiar: 'singer', glyph: 'note', debris: ['note', 'twinkle'], flicker: 0.1, lightK: 0.9 },
};

// The essence whose look a new essence borrows, by its particle style.
const BY_PARTICLE = { flame: 'fire', drop: 'water', shard: 'frost', spark: 'storm', pebble: 'earth', gust: 'wind', leaf: 'nature', bubble: 'poison', mote: 'light', wisp: 'dark', filing: 'iron', note: 'song' };

export function lookOf(id) {
  if (LOOKS[id]) return LOOKS[id];
  const def = Essences.get(id);
  const borrow = (def && BY_PARTICLE[def.particle]) || 'raw';
  return LOOKS[borrow] || LOOKS.raw;
}

// Everything the drawing code needs about a plan's look, computed once per essence set:
// the lead essence's look (its form), the palettes kept per essence, a lead palette
// nudged toward the blend, the accent (the second essence's glow, so fire+dark reads as
// dark fire and fire+light as white fire) and the particle styles to alternate.
const planLooks = new Map();
const byPlan = new WeakMap(); // plan object -> look (no string building per frame)

export function planLook(plan) {
  if (plan && typeof plan === 'object') {
    const hit = byPlan.get(plan);
    if (hit) return hit;
  }
  const ids = plan?.essences || ['raw'];
  const key = ids.join(',');
  let L = planLooks.get(key);
  if (L) {
    if (plan && typeof plan === 'object') byPlan.set(plan, L);
    return L;
  }
  const defs = ids.map((id) => Essences.get(id)).filter(Boolean);
  if (!defs.length) defs.push(Essences.get('raw'));
  // The first essence that is not raw leads (a raw + fire weave looks like fire).
  const leadIdx = Math.max(0, defs.findIndex((d) => d.id !== 'raw'));
  const lead = defs[leadIdx];
  const blend = plan?.palette || lead.palette;
  const others = defs.filter((_, i) => i !== leadIdx);
  const lp = lead.palette;
  const pal = {
    core: lp.core,
    glow: others.length ? mix(lp.glow, blend.glow, 0.25) : lp.glow,
    spark: others.length ? mix(lp.spark, others[0].palette.glow, 0.45) : lp.spark,
    deep: others.length ? mix(lp.deep, others[0].palette.deep, 0.4) : lp.deep,
  };
  const accent = others.length ? others[0].palette.glow : lp.spark;
  const accentDeep = others.length ? others[0].palette.deep : lp.deep;
  const looks = defs.map((d) => lookOf(d.id));
  const look = lookOf(lead.id);
  // Particle styles: each essence's trail styles, interleaved (lead first).
  const trail = [];
  const debris = [];
  const ordered = [leadIdx, ...defs.map((_, i) => i).filter((i) => i !== leadIdx)];
  const maxT = Math.max(...looks.map((l) => l.trail.length));
  for (let k = 0; k < maxT; k++) for (const i of ordered) if (looks[i].trail[k]) trail.push({ style: looks[i].trail[k], pal: defs[i].palette, ess: defs[i].id });
  const maxD = Math.max(...looks.map((l) => l.debris.length));
  for (let k = 0; k < maxD; k++) for (const i of ordered) if (looks[i].debris[k]) debris.push({ style: looks[i].debris[k], pal: defs[i].palette, ess: defs[i].id });
  const dark = looks.some((l) => l.dark);
  // Lights take the lead essence's own light color (a fixed set of a dozen or so): the
  // renderer caches a light sprite per color, and a color per blend would churn it.
  const lightColor = lead.light?.color || lp.glow;
  L = {
    key,
    ids: defs.map((d) => d.id),
    lead,
    leadId: lead.id,
    look,
    looks,
    defs,
    pal,
    blend,
    accent,
    accentDeep,
    halo: others.length ? mix(lp.glow, others[0].palette.glow, 0.5) : lp.glow,
    hot: lighten(lp.core, 0.2),
    outline: darken(pal.deep, 0.55),
    trail,
    debris,
    smoke: looks.some((l) => l.smoke),
    dark,
    flicker: Math.max(...looks.map((l) => l.flicker)),
    lightK: looks.reduce((a, l) => a + l.lightK, 0) / looks.length,
    lightColor,
    // Damage numbers tinted by the essence, kept readable on the dark outline.
    number: readable(mix(lp.glow, '#ffffff', 0.2)),
    multi: defs.length > 1,
  };
  if (planLooks.size > 400) planLooks.clear();
  planLooks.set(key, L);
  if (plan && typeof plan === 'object') byPlan.set(plan, L);
  return L;
}

// Look of a single essence by id (statuses, decals, reactions).
export function essenceLook(id) {
  return planLook({ essences: [id] });
}

// Status visuals by overlay name; an unknown overlay gets a tinted pulse and a ring.
//   tint: silhouette color and strength, pulse: how it breathes, parts: particles shed
//   (style, per second, where: 'body'|'head'|'feet'), light: { r, k, flicker }
export const STATUS_LOOKS = {
  flame: { tint: '#ff8a2a', tintK: 0.22, pulse: 'flicker', parts: [['flame', 16, 'body'], ['ember', 5, 'body']], light: { r: 30, k: 0.55, flicker: 0.6 } },
  drip: { tint: '#1d3f78', tintK: 0.28, parts: [['drip', 7, 'body']] },
  rime: { tint: '#9fe3ff', tintK: 0.26, parts: [['snow', 3, 'body']], feet: 'rime' },
  ice: { tint: '#cdefff', tintK: 0.6, freeze: true, crust: true, parts: [['twinkle', 2.5, 'body']], light: { r: 18, k: 0.25, flicker: 0 } },
  sparks: { tint: '#fff7b0', tintK: 0.5, pulse: 'strobe', parts: [['zap', 9, 'body'], ['spark', 4, 'body']], light: { r: 22, k: 0.45, flicker: 0.9 } },
  stars: { head: 'stars' },
  gust: { head: 'swirl', parts: [['gust', 6, 'body']] },
  vines: { tint: '#2f7a3a', tintK: 0.15, feet: 'vines', parts: [['leaf', 1.5, 'feet']] },
  bubbles: { tint: '#7ccf2a', tintK: 0.2, pulse: 'slow', parts: [['bubble', 6, 'body']] },
  glare: { tint: '#ffffff', tintK: 0.35, pulse: 'blink', head: 'glare', parts: [['twinkle', 4, 'head']], light: { r: 16, k: 0.3, flicker: 0.2 } },
  wisps: { tint: '#2a1640', tintK: 0.3, pulse: 'slow', parts: [['wisp', 7, 'body']] },
  cracks: { tint: '#c9d3e0', tintK: 0.18, cracks: true, parts: [['filing', 2, 'body']] },
  hearts: { tint: '#ff9ad5', tintK: 0.2, pulse: 'slow', head: 'hearts', parts: [['heart', 1.4, 'head']] },
  mud: { tint: '#5a3f22', tintK: 0.2, feet: 'mud', parts: [['mud', 2.5, 'feet']] },
  steam: { tint: '#e8eef2', tintK: 0.18, head: 'steam', parts: [['steam', 5, 'head']] },
};

export const DEFAULT_STATUS_LOOK = { tintK: 0.2, pulse: 'slow', ring: true };

export function statusLook(def) {
  return STATUS_LOOKS[def?.overlay] || DEFAULT_STATUS_LOOK;
}

// Reaction flourishes by id; an unknown reaction gets 'burst' in its color.
export const REACTION_LOOKS = {
  arc_shock: { kind: 'shock', ess: 'storm' },
  freeze: { kind: 'freeze', ess: 'frost' },
  firestorm: { kind: 'firestorm', ess: 'fire' },
  wildfire: { kind: 'wildfire', ess: 'fire' },
  scalding_steam: { kind: 'steam', ess: 'water' },
  mud: { kind: 'mud', ess: 'earth' },
  eclipse: { kind: 'eclipse', ess: 'dark' },
  toxic_flare: { kind: 'flare', ess: 'poison' },
  conducted_bolt: { kind: 'skybolt', ess: 'storm' },
  shatter: { kind: 'shatter', ess: 'frost' },
  shatter_iron: { kind: 'shatter', ess: 'iron' },
  thaw: { kind: 'thaw', ess: 'water' },
  miasma: { kind: 'miasma', ess: 'poison' },
  overgrowth: { kind: 'overgrowth', ess: 'nature' },
  tempest: { kind: 'tempest', ess: 'storm' },
  bloom: { kind: 'bloom', ess: 'nature' },
  dirge: { kind: 'dirge', ess: 'song' },
  prism: { kind: 'prism', ess: 'light' },
};

export function reactionLook(id) {
  return REACTION_LOOKS[id] || { kind: 'burst', ess: 'raw' };
}
