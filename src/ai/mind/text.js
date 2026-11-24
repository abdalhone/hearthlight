import { DAY_SECONDS, PLAYER_ID, COMPANION_ID, TILE } from '../../core/constants.js';

// Small language and world helpers shared by every part of Lyra's mind.
// Pure functions only: no DOM, safe to import under node --test.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Words that carry no meaning for memory recall.
export const STOPWORDS = new Set(
  `a an the and or but if then so of to in on at by for with from into onto about over under up down out off
  is am are was were be been being do does did doing have has had having will would shall should can could may might must
  i me my mine myself you your yours yourself we us our ours he him his she her hers it its they them their theirs
  this that these those there here what which who whom whose when where why how all any some no not nor only own same
  too very just than also again ever still yet once more most much many such each both few other
  lyra please tell know think remember recall said say says thing things something anything really maybe okay ok
  hey hi oh yes yeah well like get got go going went let lets let's dont don't didnt didn't im i'm youre you're`.split(/\s+/),
);

const IRREGULAR = {
  wolves: 'wolf',
  knives: 'knife',
  leaves: 'leaf',
  lives: 'life',
  thieves: 'thief',
  halves: 'half',
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  geese: 'goose',
  people: 'person',
  folk: 'person',
  folks: 'person',
  fought: 'fight',
  met: 'meet',
  ate: 'eat',
  eaten: 'eat',
  gave: 'give',
  given: 'give',
  told: 'tell',
  saw: 'see',
  seen: 'see',
  fell: 'fall',
  fallen: 'fall',
  found: 'find',
  went: 'go',
  gone: 'go',
  slept: 'sleep',
  caught: 'catch',
  died: 'die',
  dead: 'die',
  killed: 'kill',
};

const VOWELS = 'aeiou';

// Light stemming: good enough that "wolves", "wolf's" and "wolf" meet, and
// "loved"/"loves"/"loving" all become "lov". Both sides of a comparison go through it.
export function stem(word) {
  let w = String(word).toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '');
  if (!w) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3));
  else if (w.endsWith('edly') && w.length > 6) w = undouble(w.slice(0, -4));
  else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2));
  else if (/(s|x|z|ch|sh)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

function undouble(w) {
  const n = w.length;
  if (n > 3 && w[n - 1] === w[n - 2] && !VOWELS.includes(w[n - 1]) && !'lsz'.includes(w[n - 1])) return w.slice(0, -1);
  return w;
}

// Lowercase words of 2+ letters, stopwords removed, stemmed.
export function tokenize(text, { keepStop = false } = {}) {
  const out = [];
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[_]/g, ' ')
    .match(/[a-z0-9'’]+/g);
  if (!words) return out;
  for (const raw of words) {
    const w = raw.replace(/^['’]+|['’]+$/g, '');
    if (w.length < 2) continue;
    if (!keepStop && STOPWORDS.has(w)) continue;
    const s = stem(w);
    if (s && (keepStop || !STOPWORDS.has(s))) out.push(s);
  }
  return out;
}

export function tokenSet(text) {
  return new Set(tokenize(text));
}

// Plain normalized phrase for fuzzy name matching ("Sister Aveline!" -> "sister aveline").
export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cap(s) {
  s = String(s ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Proper names that keep their capital at the start of a clause.
const PROPER = new Set(
  `I Lyra Maren Pip Bram Elda Rowan Mira Tobias Aveline Garrick Gale Sister Captain Hearthvale Glasswater
  Whisperwood Mirror Sunken Stonecut South King's Ember Ironhand Reed Biscuit Varek Lanternwright Lanternwrights Pale
  Hobb Wenna Ambrel Hess Sabeth Beth Alder Petra Tilly Tansy Corran Wys Bryn Davin Halcyre Lowmarch Hollowcrown Crownfells
  Brindlecombe Saltmere Brightwater Owlsend Cinderwick Wellstone Stillring Wayhouse Mam Da Sprout Reeve Moot Lamplight Duchess`.split(/\s+/),
);

export function addProperNames(names) {
  for (const n of names || []) if (n) PROPER.add(String(n).split(/\s+/)[0]);
}

export function lowerFirst(s) {
  s = String(s ?? '');
  if (!s) return s;
  const first = s.split(/[\s,.!?;:]/)[0];
  if (PROPER.has(first) || /^I['’]/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function shorten(s, n = 90) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

export function firstSentence(s, max = 120) {
  const m = String(s ?? '').match(/^.*?[.!?](\s|$)/);
  return shorten(m ? m[0].trim() : s, max);
}

export function joinList(items, conj = 'and') {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} ${conj} ${a[a.length - 1]}`;
}

export function firstName(name) {
  const n = String(name ?? '').trim();
  if (!n) return n;
  const parts = n.split(/\s+/);
  // Titles go with the name: "Sister Aveline", "Captain Rowan Vale" -> "Aveline", "Rowan".
  if (parts.length > 1 && /^(sister|brother|captain|mother|father|old|master|lady|lord|sir)$/i.test(parts[0])) return parts[1];
  return parts[0];
}

export const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function countWord(n) {
  return NUMBER_WORDS[n] || String(n);
}

// Pick from a list with the game's RNG when there is one (gameplay randomness).
export function pick(arr, rng = null) {
  if (!arr || !arr.length) return undefined;
  const r = rng && typeof rng.next === 'function' ? rng.next() : Math.random();
  return arr[Math.floor(r * arr.length)];
}

export function chance(p, rng = null) {
  const r = rng && typeof rng.next === 'function' ? rng.next() : Math.random();
  return r < p;
}

// ---------- items ----------

// Things you count in "some", not "a".
const MASS_ITEMS = new Set(['bread', 'stew', 'iron_ore', 'slime_gel', 'wheat', 'stone', 'wood', 'coin', 'berries', 'raw_fish']);

// "a honey cake", "some bread", "three healing potions" (name: the item's display name).
export function itemPhrase(id, name, qty = 1) {
  const n = String(name || id || 'something').toLowerCase();
  if (qty > 1) {
    if (MASS_ITEMS.has(id) || /s$/.test(n)) return `${countWord(qty)} ${id === 'wood' ? 'logs of wood' : n}`;
    return `${countWord(qty)} ${n.replace(/(sh|ch|x|s)$/, '$1e')}s`;
  }
  if (MASS_ITEMS.has(id) || /s$/.test(n)) return `some ${n}`;
  return `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

// ---------- the player and the world ----------

export function playerName(game) {
  const n = game?.settings?.playerName || game?.player?.name || 'Traveler';
  return String(n).trim() || 'Traveler';
}

// How Lyra refers to the player in narration (memories, thoughts). The default
// name reads like a title, so it becomes "the traveler".
export function playerRef(game, capital = false) {
  const n = playerName(game);
  if (/^(traveler|traveller|player|you)$/i.test(n)) return capital ? 'The traveler' : 'the traveler';
  return n;
}

export function companionName(game) {
  return String(game?.settings?.companionName || 'Lyra').trim() || 'Lyra';
}

export function isPlayerRef(game, e) {
  if (!e) return false;
  if (typeof e === 'string') return e === PLAYER_ID;
  return e === game?.player || e.id === PLAYER_ID;
}

export function isSelf(owner, e) {
  if (!e) return false;
  if (typeof e === 'string') return e === (owner?.id ?? COMPANION_ID);
  return e === owner || e.id === owner?.id;
}

export function speciesOf(e) {
  return e?.species ? String(e.species) : null;
}

// Creatures nobody should hurt for fun.
export const HARMLESS_SPECIES = new Set(['rabbit', 'deer', 'chicken', 'cat']);

export function isHarmless(e) {
  const s = speciesOf(e);
  return !!s && HARMLESS_SPECIES.has(s);
}

export function isVillagerLike(e) {
  return !!e && (e.faction === 'villager' || e.faction === 'guard');
}

// A person with a profile (villager) or anything with a proper name of its own.
export function isNamedCreature(e) {
  if (!e || !e.species || !e.name) return false;
  if (e.named === true) return true;
  const n = normName(e.name);
  const s = normName(String(e.species).replace(/_/g, ' '));
  if (!n || n === s || n.includes(s) || s.includes(n)) return false;
  return /^[A-Z]/.test(String(e.name).trim());
}

export function isPerson(e) {
  return !!e && (!!e.profile || (e.kind === 'human' && !e.species && e.type === 'actor'));
}

export function isChild(e, rel = null) {
  const role = String(e?.role || e?.profile?.role || rel?.role || '').toLowerCase();
  const age = e?.profile?.age ?? null;
  return /child|orphan|kid|boy|girl/.test(role) || (typeof age === 'number' && age < 14) || e?.id === 'pip' || rel?.id === 'pip';
}

// ---------- time ----------

export function nowT(game) {
  return game?.clock?.t ?? 0;
}

export function dayOf(t) {
  return Math.floor(t / DAY_SECONDS) + 1;
}

export function ageDays(game, t) {
  return Math.max(0, (nowT(game) - t) / DAY_SECONDS);
}

export function timeAgo(game, t) {
  const today = game?.clock?.day ?? dayOf(nowT(game));
  const d = today - dayOf(t);
  if (d <= 0) {
    const mins = (nowT(game) - t) / (DAY_SECONDS / 1440);
    if (mins < 90) return 'a little while ago';
    return 'earlier today';
  }
  if (d === 1) return 'yesterday';
  if (d < 7) return `${countWord(d)} days ago`;
  if (d < 14) return 'last week';
  return 'a while back';
}

export function partOfDay(game) {
  const h = game?.clock?.hour ?? 12;
  if (h < 5) return 'the dead of night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 18.5) return 'late afternoon';
  if (h < 20.5) return 'dusk';
  return 'night';
}

export function weatherType(game) {
  return game?.clock?.weather?.type || 'clear';
}

// ---------- line of sight ----------

// True when no wall tile lies on the straight line between two points.
export function hasLineOfSight(game, ax, ay, bx, by) {
  const map = game?.map;
  if (!map || typeof map.blocksProjectile !== 'function') return true;
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor((ax + dx * t) / TILE);
    const ty = Math.floor((ay + dy * t - 6) / TILE);
    if (map.blocksProjectile(tx, ty)) return false;
  }
  return true;
}

// "in the Whisperwood", "at the Ember Kettle", "on the King's Road".
const PLACE_PREP = {
  hearthvale: 'in Hearthvale',
  town_square: 'in the town square',
  player_home: 'at the cottage',
  ember_kettle: 'at the Ember Kettle',
  smithy: 'at the Ironhand Smithy',
  general_store: "at Gale's Goods",
  chapel: 'in the Chapel of the Hearth',
  herbalist: "at Fennick's Herbs",
  guardhouse: 'at the guardhouse',
  farmhouse: 'at the Reed farmhouse',
  reed_farm: 'on Reed Farm',
  whisperwood: 'in the Whisperwood',
  stonecut_quarry: 'at Stonecut Quarry',
  bandit_camp: 'at the bandit camp',
  mirror_lake: 'at Mirror Lake',
  sunken_ruins: 'in the Sunken Ruins',
  south_meadow: 'in the South Meadow',
  kings_road: "on the King's Road",
};

export function placePhrase(loc) {
  if (!loc) return 'out in the wilds';
  if (PLACE_PREP[loc.id]) return PLACE_PREP[loc.id];
  const name = String(loc.name || loc.id || 'somewhere').replace(/^The\s+/, 'the ');
  if (loc.kind === 'road') return `on ${name}`;
  if (loc.kind === 'forest' || loc.kind === 'ruins' || loc.kind === 'village') return `in ${name}`;
  return `at ${name}`;
}
