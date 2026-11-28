import { GEAR_ITEMS, BUFF_ITEMS } from '../gear/gear_data.js';

// Item definitions and the Inventory class. Item ids are part of the shared
// contract (DESIGN.md, "Items"): AI plugins, jobs, NPC gifts and quests use them.
// Owners may add items; never rename or remove an id.

export const ITEMS = {
  coin: { name: 'Coin', type: 'currency', value: 1, desc: 'Hearthvale silver.' },
  wood: { name: 'Wood', type: 'material', value: 2, desc: 'Split oak, good for fires and building.' },
  stone: { name: 'Stone', type: 'material', value: 1, desc: 'A fist-sized grey stone.' },
  iron_ore: { name: 'Iron Ore', type: 'material', value: 6, desc: 'Rust-streaked ore. Bram can smelt it.' },
  crystal: { name: 'Glow Crystal', type: 'material', value: 15, desc: 'Hums faintly with old magic.' },
  herb: { name: 'Healing Herb', type: 'material', value: 3, desc: 'Silverleaf. Brewed into potions.' },
  moonpetal: { name: 'Moonpetal', type: 'gift', value: 8, desc: 'A pale flower that opens at night.' },
  berries: { name: 'Wild Berries', type: 'food', value: 2, heal: 4, desc: 'Sweet and a little sour.' },
  turnip: { name: 'Turnip', type: 'food', value: 3, heal: 5, desc: "From Tobias's field. Crunchy." },
  wheat: { name: 'Wheat', type: 'material', value: 2, desc: 'A golden sheaf. Two make a loaf.' },
  raw_fish: { name: 'Raw Fish', type: 'food', value: 4, heal: 1, desc: 'Fresh from Mirror Lake.' },
  cooked_fish: { name: 'Grilled Fish', type: 'food', value: 9, heal: 14, desc: 'Smoky and warm.' },
  bread: { name: 'Bread', type: 'food', value: 4, heal: 8, desc: 'From the Ember Kettle ovens.' },
  honey_cake: { name: 'Honey Cake', type: 'food', value: 12, heal: 12, desc: "Elda's recipe. Lyra's favorite." },
  stew: { name: 'Hearty Stew', type: 'food', value: 14, heal: 22, desc: 'Fills you to the toes.' },
  potion: { name: 'Healing Potion', type: 'potion', value: 20, heal: 40, desc: 'Restores a good deal of health.' },
  wolf_pelt: { name: 'Wolf Pelt', type: 'material', value: 10, desc: 'Thick grey fur.' },
  slime_gel: { name: 'Slime Gel', type: 'material', value: 3, desc: 'Wobbly. Mira uses it in salves.' },
  bone: { name: 'Old Bone', type: 'material', value: 2, desc: 'From something that should have stayed dead.' },
  iron_sword: { name: 'Iron Sword', type: 'weapon', value: 40, atk: 3, desc: 'Forged by Bram Ironhand.' },
  ruins_key: { name: 'Rusted Key', type: 'key', value: 0, desc: 'Stamped with the Sunken Ruins crest.' },
  flame_book: { name: 'The Flame-Book', type: 'quest', value: 0, desc: "Brindlecombe's chapel book: every household, every name, every flame. Water-stained, the ink gone brown." },
  guard_key: { name: "Rowan's Key", type: 'key', value: 0, desc: "The watch's footlocker key, off Captain Rowan's belt. He gave it to you." },
  lyra_trunk_key: { name: "Lyra's Key", type: 'key', value: 0, desc: "The key to Lyra's old trunk. She does not give it lightly." },
  // Round 14b (T-5): what she wrote when she left you. The words are in game.flags.lyra_letter.
  lyra_letter: { name: "Lyra's Letter", type: 'letter', value: 0, unsellable: true, desc: 'Folded twice, in her small slanted hand. Read it from your bag.' },
  maren_journal: { name: "Maren's Journal", type: 'quest', value: 0, desc: "Lyra's mentor's journal, water-stained." },
  lantern: { name: 'Lantern', type: 'tool', value: 15, desc: 'Lights the dark.' },
  // Round 15 (item 9, src/world/tools.js): iron yields only to its tool.
  pickaxe: { name: 'Pickaxe', type: 'tool', value: 18, desc: "An iron head on an ash haft, from Bram's forge. Iron ore and an iron hasp yield to it; nothing else you carry will move them." },
  // Creature drops (added by the combat module). Ids and names avoid common short words as
  // substrings ("me", "it", "the") so resolveItemId() stays predictable for chat parsing.
  venison: { name: 'Venison', type: 'food', value: 5, heal: 3, desc: 'Lean red meat from the Whisperwood. Better over a fire.' },
  egg: { name: 'Egg', type: 'food', value: 3, heal: 4, desc: 'Brown and speckled, still warm from the nest.' },
  bat_wing: { name: 'Bat Wing', type: 'material', value: 4, desc: 'Leathery and thin as paper. Mira swears it soothes a cough.' },
  boar_tusk: { name: 'Boar Tusk', type: 'material', value: 8, desc: 'A curved ivory hook. Bram can set it into a knife handle.' },
  antler: { name: 'Antler', type: 'material', value: 7, desc: 'A forked deer antler, worn smooth as river stone.' },
  // Round 3 (the newcomers' trades, LORE §5 economy).
  candle: { name: 'Beeswax Candle', type: 'tool', value: 4, desc: "Dipped by Hobb Ambrel from Wenna's wax. Burns slow and smells of lindens." },
  honey: { name: 'Linden Honey', type: 'food', value: 9, heal: 10, desc: "A crock of Wenna Ambrel's lindenflower honey, the last pull before winter." },
  smoked_eel: { name: 'Smoked Eel', type: 'food', value: 12, heal: 16, desc: "From Corran Dell's net-shed. Garrick tells Brightwater it comes from Saltmere." },
  wool_cloak: { name: 'Wool Cloak', type: 'gift', value: 30, desc: 'Dyed and sewn by Sabeth Coll: murrel violet with a lake-wort teal lining.' },
};

// Gear and buff food (DESIGN §26, src/gear/gear_data.js): new ids, never overriding one
// already here (iron_sword stays the weapon it always was).
for (const [id, def] of Object.entries({ ...GEAR_ITEMS, ...BUFF_ITEMS })) if (!ITEMS[id]) ITEMS[id] = def;

export function itemDef(id) {
  return ITEMS[id] || null;
}

export function itemName(id, qty = 1) {
  const d = ITEMS[id];
  if (!d) return id;
  return qty > 1 ? `${qty} × ${d.name}` : d.name;
}

// Words that are never an item on their own: chat parsing may hand over a bare pronoun or
// article ("give me", "her", "the"), and loose substring matching would turn "me" into
// slime gel and "her" into a herb.
const NOT_ITEMS = new Set(
  'i me my mine it its her hers him his he she you your we us our they them the a an and or of to so up in on at this that these those some any one all thing things stuff'.split(' '),
);

// Everyday words for items ("a loaf", "some money", "the key").
const ITEM_ALIASES = {
  loaf: 'bread',
  loaves: 'bread',
  money: 'coin',
  gold: 'coin',
  silver: 'coin',
  cash: 'coin',
  fur: 'wolf_pelt',
  petal: 'moonpetal',
  petals: 'moonpetal',
  diary: 'maren_journal',
  lamp: 'lantern',
};

// Find an item id from loose text ("healing potions", "fish", "honey cake").
export function resolveItemId(text) {
  if (!text) return null;
  const t = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_ ]/g, '')
    .replace(/^(?:(?:a|an|the|some|my|your|her|his|our|that|this|those|these)\s+)+/, '');
  if (!t || NOT_ITEMS.has(t)) return null;
  if (ITEMS[t]) return t;
  if (ITEM_ALIASES[t]) return ITEM_ALIASES[t];
  const snake = t.replace(/\s+/g, '_');
  if (ITEMS[snake]) return snake;
  const compact = t.replace(/\s+/g, ''); // "moon petal(s)"
  if (ITEMS[compact]) return compact;
  if (ITEMS[compact.replace(/s$/, '')]) return compact.replace(/s$/, '');
  const singular = snake.replace(/(es|s)$/, '');
  if (ITEMS[singular]) return singular;
  const plural = snake.replace(/y$/, 'ies'); // "berry"
  if (plural !== snake && ITEMS[plural]) return plural;
  let best = null;
  for (const [id, def] of Object.entries(ITEMS)) {
    const n = def.name.toLowerCase();
    if (n === t || n.replace(/s$/, '') === t.replace(/s$/, '')) return id;
    // Partial matches need a real fragment of a word, not one or two letters.
    if (!best && (t.includes(n) || (t.length >= 3 && (n.includes(t) || id.includes(singular))))) best = id;
  }
  return best;
}

export class Inventory {
  constructor(init) {
    this.items = new Map(); // id -> qty
    if (init) this.deserialize(init);
  }

  count(id) {
    return this.items.get(id) || 0;
  }

  has(id, qty = 1) {
    return this.count(id) >= qty;
  }

  add(id, qty = 1) {
    if (!id || qty <= 0) return 0;
    this.items.set(id, this.count(id) + qty);
    return qty;
  }

  // Removes up to qty; returns how many were removed.
  remove(id, qty = 1) {
    const have = this.count(id);
    const n = Math.min(have, qty);
    if (n <= 0) return 0;
    if (have - n <= 0) this.items.delete(id);
    else this.items.set(id, have - n);
    return n;
  }

  // Move items to another inventory; returns how many moved.
  transfer(to, id, qty = 1) {
    const n = this.remove(id, qty);
    if (n) to.add(id, n);
    return n;
  }

  list() {
    return [...this.items.entries()].map(([id, qty]) => ({ id, qty, def: ITEMS[id] || { name: id } }));
  }

  isEmpty() {
    return this.items.size === 0;
  }

  describe() {
    if (this.isEmpty()) return 'nothing';
    return this.list()
      .map(({ id, qty }) => itemName(id, qty))
      .join(', ');
  }

  serialize() {
    return Object.fromEntries(this.items);
  }

  deserialize(d) {
    this.items.clear();
    if (Array.isArray(d)) for (const { id, qty } of d) this.add(id, qty);
    else if (d && typeof d === 'object') for (const [id, qty] of Object.entries(d)) this.add(id, qty);
  }
}
