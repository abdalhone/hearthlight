import { TILE } from '../core/constants.js';
import { newId } from '../entities/entity.js';

// STUB (owned by the world agent). Interactive world objects: doors, trees, ore,
// herbs, crops, chests, beds, campfires, lamps, signs, the journal...
// The interface below is the contract other modules use.

export class WorldObject {
  constructor(game, o = {}) {
    this.game = game;
    this.id = o.id ?? newId('o');
    this.objType = o.objType ?? 'thing'; // see DESIGN.md "World objects" for the type list
    this.tx = o.tx ?? 0;
    this.ty = o.ty ?? 0;
    this.x = o.x ?? this.tx * TILE + TILE / 2; // anchor: bottom-center of the base tile
    this.y = o.y ?? this.ty * TILE + TILE - 1;
    this.solid = o.solid ?? false; // blocks walking on its tile(s)
    this.name = o.name ?? this.objType;
    this.state = o.state ?? {};
    this.interactReach = 0;
  }

  get sortY() {
    return this.y;
  }

  // Tiles this object blocks when solid.
  blocksTile(tx, ty, actor) {
    return this.solid && tx === this.tx && ty === this.ty;
  }

  update(dt) {}
  draw(ctx, ox, oy, time) {}
  canInteract(actor) {
    return false;
  }
  interactLabel(actor) {
    return '';
  }
  interact(actor) {}
  serialize() {
    return { id: this.id, state: this.state };
  }
  deserialize(d) {
    if (d?.state) this.state = { ...this.state, ...d.state };
  }
}

export class Door extends WorldObject {
  constructor(game, o) {
    super(game, { ...o, objType: 'door' });
    this.state = { open: false, locked: !!o.locked, keyId: o.keyId ?? null, ...o.state };
  }
  get isOpen() {
    return this.state.open;
  }
  get locked() {
    return this.state.locked;
  }
  blocksTile(tx, ty) {
    return !this.state.open && tx === this.tx && ty === this.ty;
  }
  // Returns true when the door is open afterwards. Unlocks if `actor` carries the key.
  open(actor) {
    if (this.state.open) return true;
    if (this.state.locked) {
      if (actor?.inventory?.has(this.state.keyId)) this.state.locked = false;
      else return false;
    }
    this.state.open = true;
    this.game.bus.emit('door', { door: this, actor, open: true });
    return true;
  }
  close(actor) {
    if (!this.state.open) return true;
    this.state.open = false;
    this.game.bus.emit('door', { door: this, actor, open: false });
    return true;
  }
  draw(ctx, ox, oy) {
    ctx.fillStyle = this.state.open ? '#3d2619' : '#8c5a35';
    ctx.fillRect(this.tx * TILE - ox, this.ty * TILE - oy, TILE, this.state.open ? 3 : TILE);
  }
  canInteract() {
    return true;
  }
  interactLabel() {
    return this.state.open ? 'Close door' : this.state.locked ? 'Locked' : 'Open door';
  }
  interact(actor) {
    if (this.state.open) this.close(actor);
    else this.open(actor);
  }
}

export class ObjectManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
  }
  add(o) {
    this.list.push(o);
    this.byId.set(o.id, o);
    return o;
  }
  remove(o) {
    this.list = this.list.filter((x) => x !== o);
    this.byId.delete(o.id);
  }
  get(id) {
    return this.byId.get(id) || null;
  }
  all() {
    return this.list;
  }
  update(dt) {
    for (const o of this.list) o.update(dt);
  }
  isBlockingTile(tx, ty, actor = null) {
    for (const o of this.list) if (o.blocksTile(tx, ty, actor)) return true;
    return false;
  }
  doorAt(tx, ty) {
    return this.list.find((o) => o.objType === 'door' && o.tx === tx && o.ty === ty) || null;
  }
  inRadius(x, y, r, filter) {
    return this.list.filter((o) => Math.hypot(o.x - x, o.y - y) <= r && (!filter || filter(o)));
  }
  // nearest('tree', x, y, r) or nearest(o => ..., x, y, r)
  nearest(typeOrFilter, x, y, r = Infinity) {
    const f = typeof typeOrFilter === 'function' ? typeOrFilter : (o) => o.objType === typeOrFilter;
    let best = null;
    let bd = r;
    for (const o of this.list) {
      if (!f(o)) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
  // "door", "chest", "campfire", "bed"... nearest object whose type or name matches.
  findByWord(word, x, y) {
    const w = String(word || '').toLowerCase();
    if (!w) return null;
    return this.nearest((o) => o.objType === w || o.objType === w.replace(/s$/, '') || String(o.name).toLowerCase().includes(w), x, y, 600);
  }
  inView(x, y, w, h, margin = 48) {
    return this.list.filter((o) => o.x > x - margin && o.x < x + w + margin && o.y > y - margin && o.y < y + h + margin * 2);
  }
  serialize() {
    return this.list.map((o) => o.serialize());
  }
  deserialize(list) {
    for (const d of list || []) this.byId.get(d.id)?.deserialize(d);
  }
}
