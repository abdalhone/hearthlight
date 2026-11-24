import { PLAYER_ID } from '../../core/constants.js';
import { ITEMS } from '../../entities/items.js';
import { normName, firstName } from './text.js';

// Entity linking: which people, places, items and lore a piece of text refers to.
// "the blacksmith" -> person:bram, "that lake" -> place:mirror_lake, "her journal" ->
// item:maren_journal, "the waygate" -> lore:waygates. Keys are '<type>:<id>' with type
// person | place | item | lore | kind (a kind of creature: kind:wolf, kind:bandit).
// Built from the game's villagers and locations, her relationships and the lorebook,
// with the contract's fixed villagers and places as a fallback (DESIGN §6, §7).

const MAX_WORDS = 4;

// Contract villagers by what people call them (DESIGN §7).
const ROLE_WORDS = {
  bram: ['blacksmith', 'the smith', 'smith', 'ironhand'],
  elda: ['innkeeper', 'thornbury', 'the landlady'],
  pip: ['orphan', 'the kid', 'the boy', 'the child', 'little one'],
  rowan: ['captain', 'the captain', 'guard captain', 'captain rowan', 'vale'],
  mira: ['herbalist', 'fennick'],
  tobias: ['farmer', 'reed'],
  aveline: ['sister', 'chapel keeper', 'priestess', 'the sister'],
  garrick: ['merchant', 'shopkeeper', 'trader', 'hale'],
  maren: ['my teacher', 'her teacher', 'mentor', 'my mentor', 'ashgrove', 'grey cloak'],
  cal: ['my brother', 'her brother', 'little brother'],
};

// Contract places and the plain words people use for them (DESIGN §6).
const PLACE_WORDS = {
  hearthvale: ['hearthvale', 'the village', 'village'],
  town_square: ['town square', 'the square', 'square', 'notice board'],
  player_home: ['your cottage', 'the cottage', 'our cottage', 'your house'],
  ember_kettle: ['ember kettle', 'the kettle', 'kettle', 'inn', 'tavern'],
  smithy: ['ironhand smithy', 'smithy', 'forge'],
  general_store: ["gale's goods", 'gales goods', 'general store', 'store'],
  chapel: ['chapel of the hearth', 'chapel'],
  herbalist: ["fennick's herbs", 'fennicks herbs', 'herb shop'],
  guardhouse: ['guardhouse', 'guard house'],
  farmhouse: ['reed farmhouse', 'farmhouse'],
  reed_farm: ['reed farm', 'farm', 'turnip field', 'fields'],
  whisperwood: ['whisperwood', 'whisper wood', 'forest', 'the woods', 'woods'],
  stonecut_quarry: ['stonecut quarry', 'quarry'],
  bandit_camp: ['bandit camp', "bandits' camp", 'bandits camp', 'the camp'],
  mirror_lake: ['mirror lake', 'lake', 'the dock', 'dock'],
  sunken_ruins: ['sunken ruins', 'ruins', 'ruins gate'],
  south_meadow: ['south meadow', 'meadow'],
  kings_road: ["king's road", 'kings road', 'king road', 'the road into hearthvale'],
};

const PLACE_LABELS = {
  hearthvale: 'Hearthvale',
  town_square: 'the town square',
  player_home: 'the cottage',
  ember_kettle: 'the Ember Kettle',
  smithy: 'the smithy',
  general_store: "Gale's Goods",
  chapel: 'the chapel',
  herbalist: "Fennick's Herbs",
  guardhouse: 'the guardhouse',
  farmhouse: 'the farmhouse',
  reed_farm: 'Reed Farm',
  whisperwood: 'the Whisperwood',
  stonecut_quarry: 'Stonecut Quarry',
  bandit_camp: 'the bandit camp',
  mirror_lake: 'Mirror Lake',
  sunken_ruins: 'the Sunken Ruins',
  south_meadow: 'the South Meadow',
  kings_road: "the King's Road",
};

// Items worth linking; plain materials (stone, wood, coin) would link half of everything.
const ITEM_WORDS = {
  maren_journal: ["maren's journal", 'maren journal', 'journal', 'her journal', 'diary of maren'],
  ruins_key: ['rusted key', 'ruins key', 'the key', 'gate key'],
  honey_cake: ['honey cake', 'honey cakes', 'honeycake', 'cake', 'cakes'],
  moonpetal: ['moonpetal', 'moonpetals', 'moon petal'],
  crystal: ['glow crystal', 'crystal', 'crystals'],
  potion: ['healing potion', 'potion', 'potions'],
  iron_ore: ['iron ore', 'ore'],
  wolf_pelt: ['wolf pelt', 'pelt', 'pelts'],
  cooked_fish: ['grilled fish', 'cooked fish'],
  raw_fish: ['raw fish', 'fish'],
  bread: ['bread', 'loaf'],
  stew: ['stew', 'hearty stew'],
  berries: ['berries', 'berry', 'wild berries'],
  turnip: ['turnip', 'turnips'],
  iron_sword: ['iron sword'],
  slime_gel: ['slime gel', 'gel'],
  herb: ['healing herb', 'silverleaf', 'herbs'],
};

const KINDS = {
  wolf: ['wolf', 'wolves', 'wolf pack'],
  bandit: ['bandit', 'bandits', 'outlaw', 'outlaws', 'brigands'],
  slime: ['slime', 'slimes'],
  skeleton: ['skeleton', 'skeletons', 'undead', 'walking dead'],
  boar: ['boar', 'boars'],
  bat: ['bat', 'bats'],
  deer: ['deer'],
  rabbit: ['rabbit', 'rabbits', 'bunny', 'bunnies'],
  chicken: ['chicken', 'chickens', 'hen', 'hens'],
  cat: ['cat', 'cats', 'stray'],
};

const KIND_LABELS = { wolf: 'wolves', bandit: 'bandits', slime: 'slimes', skeleton: 'skeletons', boar: 'boars', bat: 'bats', deer: 'deer', rabbit: 'rabbits', chicken: 'chickens', cat: 'cats' };

// The player's own words: "me", "we" mean the player when they are the one asking.
const QUERY_PRONOUNS = ['me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'i'];

function norm(s) {
  return normName(s).replace(/^(the|a|an) /, '');
}

export class EntityLinker {
  constructor() {
    this.dict = new Map(); // normalized phrase -> Set(entity key)
    this.labels = new Map(); // entity key -> label
    this.maxWords = 1;
  }

  // exact: curated phrases are registered as written ("the cottage" does not also
  // register "cottage"); names from data also register without a leading article.
  add(key, label, surfaces, { exact = false } = {}) {
    if (!key) return;
    if (label && (!this.labels.has(key) || this.labels.get(key) === key)) this.labels.set(key, String(label));
    else if (!this.labels.has(key)) this.labels.set(key, key);
    for (const raw of surfaces || []) {
      if (!raw) continue;
      const full = normName(raw);
      for (const s of exact ? [full] : [full, norm(raw)]) {
        if (!s || s.length < 3) continue;
        let set = this.dict.get(s);
        if (!set) this.dict.set(s, (set = new Set()));
        set.add(key);
        const words = s.split(' ').length;
        if (words > this.maxWords) this.maxWords = Math.min(MAX_WORDS, words);
      }
    }
  }

  label(key) {
    return this.labels.get(key) || String(key).replace(/^[a-z]+:/, '').replace(/_/g, ' ');
  }

  has(key) {
    return this.labels.has(key);
  }

  // Entity keys mentioned in a text. query: true when the player is speaking ("me" = them).
  link(text, { query = false } = {}) {
    const out = new Set();
    const words = normName(text).split(' ').filter(Boolean);
    for (let i = 0; i < words.length; ) {
      let hit = 0;
      for (let n = Math.min(this.maxWords, words.length - i); n >= 1; n--) {
        const phrase = n === 1 ? words[i] : words.slice(i, i + n).join(' ');
        const set = this.dict.get(phrase);
        if (set) {
          for (const k of set) out.add(k);
          hit = n;
          break;
        }
      }
      if (!hit && query && QUERY_PRONOUNS.includes(words[i])) out.add(`person:${PLAYER_ID}`);
      i += hit || 1;
    }
    return out;
  }

  // Entities for a stored record: its text plus explicit ids (about, location, tags).
  linkRecord(text, { about = [], places = [], tags = [] } = {}) {
    const out = this.link(text);
    for (const a of about || []) if (a) out.add(this.keyForId(a, 'person'));
    for (const p of places || []) if (p) out.add(`place:${p}`);
    for (const t of tags || []) {
      const k = this.keyForTag(t);
      if (k) out.add(k);
    }
    return out;
  }

  keyForId(id, fallbackType = 'person') {
    const s = String(id);
    if (s.includes(':')) {
      // Relationship group ids: 'faction:bandit', 'species:wolf'.
      const [type, rest] = s.split(':');
      if (type === 'species' || type === 'faction') return `kind:${rest}`;
      return s;
    }
    for (const type of ['person', 'place', 'item', 'lore']) if (this.labels.has(`${type}:${s}`)) return `${type}:${s}`;
    return `${fallbackType}:${s}`;
  }

  keyForTag(tag) {
    const s = String(tag || '');
    if (!s) return null;
    for (const type of ['place', 'person', 'item', 'kind', 'lore']) if (this.labels.has(`${type}:${s}`)) return `${type}:${s}`;
    return null;
  }
}

// Build a linker for one mind from everything it can see.
export function buildLinker(mind) {
  const L = new EntityLinker();
  const game = mind?.game;
  const lore = mind?.lorebook;

  for (const [id, words] of Object.entries(PLACE_WORDS)) L.add(`place:${id}`, PLACE_LABELS[id], words, { exact: true });
  for (const loc of game?.locations?.all?.() || []) {
    L.add(`place:${loc.id}`, loc.name, [loc.name, String(loc.id).replace(/_/g, ' '), ...(loc.aliases || [])]);
  }
  for (const [id, words] of Object.entries(ITEM_WORDS)) L.add(`item:${id}`, ITEMS[id]?.name || id, words, { exact: true });
  for (const [id, words] of Object.entries(KINDS)) L.add(`kind:${id}`, KIND_LABELS[id], words, { exact: true });

  // People: the player, villagers in the world, everyone she has a relationship with.
  const pname = game?.settings?.playerName || game?.player?.name;
  const playerWords = ['traveler', 'traveller'];
  if (pname && !/^(traveler|traveller|player)$/i.test(pname)) playerWords.push(pname);
  L.add(`person:${PLAYER_ID}`, pname && !/^(traveler|traveller|player)$/i.test(pname) ? pname : 'the traveler', playerWords);
  L.add('person:lyra', mind?.name || 'Lyra', ['lyra', mind?.name, mind?.soul?.fullName]);

  const addPerson = (id, name, role) => {
    const surfaces = [name, firstName(name), id];
    const parts = String(name || '').split(/\s+/).filter((p) => p.length >= 4 && /^[A-Z]/.test(p));
    surfaces.push(...parts);
    if (role && String(role).split(/\s+/).length <= 3) surfaces.push(role, `the ${role}`);
    L.add(`person:${id}`, name || id, surfaces);
  };
  for (const [id, words] of Object.entries(ROLE_WORDS)) L.add(`person:${id}`, null, words, { exact: true });
  for (const e of game?.entities?.all?.() || []) {
    if (e?.profile) addPerson(e.id, e.name, e.profile.role || e.role);
  }
  for (const r of mind?.relationships?.map?.values?.() || []) {
    if (r.kind === 'group') {
      const kind = String(r.id).split(':')[1];
      if (kind) L.add(`kind:${kind}`, r.name, [r.name]);
      continue;
    }
    if (r.id === PLAYER_ID) continue;
    addPerson(r.id, r.name, r.role);
  }

  // Lore: people, places, world concepts, and places from her own life.
  if (lore) {
    for (const e of lore.all('person')) {
      const id = e.npcId || e.id;
      const role = e.role ? String(e.role).replace(/^(lyra's|maren's|her|his|the)\s+/i, '') : null;
      addPerson(id, e.name, role && role.split(/\s+/).length <= 2 ? role : null);
    }
    for (const e of lore.all('place')) if (e.locationId) L.add(`place:${e.locationId}`, e.title, [e.title]);
    for (const e of lore.all('world')) L.add(`lore:${e.id}`, e.title, [e.title, ...e.aliases]);
    for (const e of lore.all('life')) for (const p of e.places) if (!L.has(`place:${p}`)) L.add(`place:${p}`, p.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), [p.replace(/_/g, ' ')]);
  }
  return L;
}
