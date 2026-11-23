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
  maren_journal: { name: "Maren's Journal", type: 'quest', value: 0, desc: "Lyra's mentor's journal, water-stained." },
  lantern: { name: 'Lantern', type: 'tool', value: 15, desc: 'Lights the dark.' },
};

export function itemDef(id) {
  return ITEMS[id] || null;
}

export function itemName(id, qty = 1) {
  const d = ITEMS[id];
  if (!d) return id;
  return qty > 1 ? `${qty} × ${d.name}` : d.name;
}

// Find an item id from loose text ("healing potions", "fish", "honey cake").
export function resolveItemId(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim().replace(/[^a-z0-9_ ]/g, '');
  if (ITEMS[t]) return t;
  const snake = t.replace(/\s+/g, '_');
  if (ITEMS[snake]) return snake;
  const singular = snake.replace(/(es|s)$/, '');
  if (ITEMS[singular]) return singular;
  let best = null;
  for (const [id, def] of Object.entries(ITEMS)) {
    const n = def.name.toLowerCase();
    if (n === t || n.replace(/s$/, '') === t.replace(/s$/, '')) return id;
    if (!best && (n.includes(t) || t.includes(n) || id.includes(singular))) best = id;
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
