import { TILE, WORLD_W, WORLD_H, WORLD_X0, WORLD_Y0 } from '../core/constants.js';
import { Inventory, itemName } from '../entities/items.js';
import { playCollect } from '../render/pixel_fx_play.js';
import { drawDebris, drawFallingTree, mendTick, shakeX, swayOf, refreshAllFences, FALL_SECONDS } from './broken.js';
import { seatFor, sitDown, SEAT_TYPES } from './rest.js';

// Interactive world objects: doors, trees, ore, herbs, crops, chests, beds, fires,
// lamps, signs, windows, the journal, and the furniture that makes a house a home.
// The public interface (DESIGN.md §6) is what other modules use; everything else is
// internal to the world module.
//
// Objects never touch the DOM or the atlas outside draw(), so worldgen and tests run in Node.

const DAY = 900; // game seconds in one in-game day (constants.DAY_SECONDS)
const TAU = Math.PI * 2;

const isPlayer = (game, a) => !!a && (a === game?.player || a.id === 'player');

// Small deterministic hash used for per-object animation phases.
function phaseOf(tx, ty) {
  let h = Math.imul(tx * 73856093 ^ ty * 19349663, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
}

function hasItem(actor, id, qty = 1) {
  try {
    return !!actor?.inventory?.has?.(id, qty);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Base class

export class WorldObject {
  constructor(game, o = {}) {
    this.game = game;
    this.objType = o.objType ?? 'thing';
    const f = o.footprint || null;
    this.footprint = f; // {x, y, w, h} tiles it covers (solid area); default = its base tile
    this.tx = o.tx ?? (f ? f.x : 0);
    this.ty = o.ty ?? (f ? f.y + f.h - 1 : 0);
    this.id = o.id ?? `${this.objType}@${this.tx},${this.ty}`;
    // Anchor: bottom-center of the base tile (or of the footprint).
    this.x = o.x ?? (f ? (f.x + f.w / 2) * TILE : this.tx * TILE + TILE / 2);
    this.y = o.y ?? (f ? (f.y + f.h) * TILE - 1 : this.ty * TILE + TILE - 1);
    this.solid = o.solid ?? false;
    this.low = o.low ?? false; // flyers pass over
    this.name = o.name ?? prettyType(this.objType);
    this.variant = o.variant ?? null;
    this.sprite = o.sprite ?? `prop:${this.objType}${this.variant ? ':' + this.variant : ''}`;
    this.state = { ...(o.state || {}) };
    this.interactReach = o.interactReach ?? 0;
    this.shadow = o.shadow ?? null; // {dx, dy, rx, ry}: soft ground shadow baked into the map
    this.words = o.words ?? [];
    this.trailBoss = o.trailBoss ?? null; // a sign of a boss: looking at it puts the boss on the map (boss_trails.js)
    this.hidden = !!o.hidden;
    // Never broken by a blow (DESIGN §31.3): something a story needs, or kept whole on purpose.
    if (o.story) this.story = true;
    if (o.unbreakable) this.unbreakable = true;
    this.dirty = false; // state differs from the generated world (saved)
    this.removed = false;
    this.phase = phaseOf(this.tx, this.ty);
    this._light = null;
  }

  get sortY() {
    return this.y;
  }

  // Tiles this object occupies, for the manager's tile index.
  occupiedTiles() {
    const f = this.footprint;
    if (!f) return [[this.tx, this.ty]];
    const out = [];
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) out.push([x, y]);
    return out;
  }

  blocksTile(tx, ty, actor) {
    if (!this.solid || this.state.broken) return false; // broken props are rubble you walk over (§31.3)
    if (this.low && actor?.flying) return false;
    const f = this.footprint;
    if (f) return tx >= f.x && ty >= f.y && tx < f.x + f.w && ty < f.y + f.h;
    return tx === this.tx && ty === this.ty;
  }

  markDirty() {
    this.dirty = true;
  }

  // Tell the world that walkability or the baked ground (shadows) changed here.
  _changed(groundToo = false) {
    this.game?.objects?.changed?.(this);
    if (groundToo) {
      try {
        this.game?.map?.invalidateTile?.(this.tx, this.ty);
      } catch {
        /* map may not be built yet */
      }
    }
  }

  update(dt) {
    if (this.state.broken) mendTick(this);
  }

  spriteName() {
    return this.sprite;
  }

  draw(ctx, ox, oy, time) {
    if (this.hidden) return;
    if (this.state.broken) return drawDebris(ctx, this, ox, oy);
    const atlas = this.game?.atlas;
    const name = this.spriteName(time);
    if (atlas && atlas.draw(ctx, name, 0, Math.round(this.x - ox) + shakeX(this, time), Math.round(this.y - oy))) return;
    // Art missing: a modest stand-in so the object is still visible.
    ctx.fillStyle = '#7d5233';
    ctx.fillRect(Math.round(this.x - ox) - 6, Math.round(this.y - oy) - 10, 12, 10);
  }

  getLight(time) {
    return null;
  }

  // Reuse one light object per source so lighting collection allocates nothing.
  _setLight(x, y, r, color, intensity, flicker = 0) {
    const l = this._light || (this._light = { x: 0, y: 0, r: 0, color: '#ffffff', intensity: 0, flicker: 0 });
    l.x = x;
    l.y = y;
    l.r = r;
    l.color = color;
    l.intensity = intensity;
    l.flicker = flicker;
    return l;
  }

  // In the rain the wet ground mirrors a light: a short streak of dim glow below the
  // object's base. Returns the light alone when dry, indoors or under a roof.
  _wetReflection(l, drop) {
    const map = this.game?.map;
    const wet = map?.wetness || 0;
    if (!l || wet < 0.12 || this._underRoof()) return l;
    const list = this._refl || (this._refl = [null, { x: 0, y: 0, r: 0, color: '#ffffff', intensity: 0, flicker: 0, glow: 1.5 }, { x: 0, y: 0, r: 0, color: '#ffffff', intensity: 0, flicker: 0, glow: 1.5 }]);
    list[0] = l;
    const near = list[1];
    const far = list[2];
    near.x = far.x = l.x;
    near.y = this.y + drop * 0.35;
    far.y = this.y + drop * 0.75;
    near.r = Math.max(10, l.r * 0.24);
    far.r = Math.max(8, l.r * 0.17);
    near.color = far.color = l.color;
    near.flicker = far.flicker = l.flicker;
    near.glow = 1.9;
    far.glow = 1.6;
    near.intensity = l.intensity * 0.78 * wet;
    far.intensity = l.intensity * 0.55 * wet;
    return list;
  }

  // Inside a building's walls (its facade, where windows hang, is outdoors).
  _underRoof() {
    const b = this.game?.map?.buildingAt?.(this.tx, this.ty);
    const it = b?.interior;
    return !!it && this.tx >= it.x && this.ty >= it.y && this.tx < it.x + it.w && this.ty < it.y + it.h;
  }

  canInteract(actor) {
    return false;
  }

  interactLabel(actor) {
    return '';
  }

  interact(actor) {}

  _fx(type, x, y, opts) {
    try {
      this.game?.particles?.emit?.(type, x, y, opts);
    } catch {
      /* particles are cosmetic */
    }
  }

  _sound(name, extra) {
    try {
      this.game?.audio?.play?.(name, { x: this.x, y: this.y, ...(extra || {}) });
    } catch {
      /* sound is cosmetic */
    }
  }

  _toast(actor, text, kind = 'info') {
    if (!isPlayer(this.game, actor)) return;
    try {
      this.game?.ui?.toast?.(text, kind);
    } catch {
      /* ui optional */
    }
  }

  _inView(margin = 32) {
    const cam = this.game?.camera;
    if (!cam) return false;
    return this.x > cam.x - margin && this.x < cam.x + cam.vw + margin && this.y > cam.y - margin && this.y < cam.y + cam.vh + margin * 2;
  }

  _darkness() {
    const d = this.game?.clock?.daylight;
    return d == null ? 0 : 1 - d;
  }

  serialize() {
    return { id: this.id, state: { ...this.state } };
  }

  deserialize(d) {
    if (d?.state) {
      this.state = { ...this.state, ...d.state };
      this.dirty = true;
    }
  }
}

function prettyType(t) {
  return String(t)
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Doors

export class Door extends WorldObject {
  constructor(game, o = {}) {
    super(game, { ...o, objType: 'door', solid: true, interactReach: o.interactReach ?? 10 });
    this.gate = !!o.gate; // the heavy stone-and-iron ruins gate
    this.sprite = this.gate ? 'prop:door:gate' : 'prop:door';
    this.name = o.name ?? (this.gate ? 'Iron-bound gate' : 'Door');
    this.state = { open: false, locked: !!o.locked, keyId: o.keyId ?? null, ...(o.state || {}) };
    this.autoClose = o.autoClose ?? !this.gate;
    this.building = o.building ?? null; // location id of the building it belongs to
    this.lockedText = o.lockedText ?? null; // a shut house says so in its own words
    this.anim = this.state.open ? 1 : 0; // 0 closed .. 1 open (visual only)
    this._idle = 0;
    this._bumpCd = 0;
    this.words = ['door', 'gate', 'entrance', ...(o.words || [])];
  }

  get isOpen() {
    return !!this.state.open;
  }

  get locked() {
    return !!this.state.locked;
  }

  blocksTile(tx, ty) {
    return !this.state.open && tx === this.tx && ty === this.ty;
  }

  // Returns true when the door is open afterwards. Unlocks if `actor` carries the key.
  open(actor) {
    if (this.state.open) return true;
    if (this.state.locked) {
      if (this.state.keyId && hasItem(actor, this.state.keyId)) {
        this.state.locked = false;
        this._sound('door_open', { pitch: 0.7 });
        this._toast(actor, `The ${itemName(this.state.keyId)} turns with a grinding groan. The way is open.`, 'good');
      } else {
        if (isPlayer(this.game, actor)) {
          this._sound('error');
          this._toast(actor, this.lockedText || `It's locked. You need the ${itemName(this.state.keyId || 'ruins_key')}.`, this.lockedText ? 'info' : 'warn');
        }
        return false;
      }
    }
    this.state.open = true;
    this._idle = 0;
    this.markDirty();
    this._sound('door_open', this.gate ? { pitch: 0.6 } : undefined);
    this._fx('dust', this.x, this.y - 2, { count: 3 });
    this._changed();
    this.game?.bus?.emit('door', { door: this, actor: actor || null, open: true });
    return true;
  }

  // Returns true when the door is closed afterwards (false if someone stands in the doorway).
  close(actor) {
    if (!this.state.open) return true;
    if (this._someoneInDoorway()) return false;
    this.state.open = false;
    this.markDirty();
    this._sound('door_close', this.gate ? { pitch: 0.6 } : undefined);
    this._changed();
    this.game?.bus?.emit('door', { door: this, actor: actor || null, open: false });
    return true;
  }

  _someoneInDoorway() {
    const list = this.game?.entities?.list;
    if (!list) return false;
    const x0 = this.tx * TILE - 4;
    const x1 = x0 + TILE + 8;
    const y0 = this.ty * TILE - 2;
    const y1 = y0 + TILE + 8;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed || e.type !== 'actor' || e.dead) continue;
      if (e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) return true;
    }
    return false;
  }

  update(dt) {
    const target = this.state.open ? 1 : 0;
    if (this.anim !== target) {
      const step = dt * (this.gate ? 3 : 6);
      this.anim = this.anim < target ? Math.min(target, this.anim + step) : Math.max(target, this.anim - step);
    }
    if (this._bumpCd > 0) this._bumpCd -= dt;
    const p = this.game?.player;
    const cx = this.tx * TILE + TILE / 2;
    const cy = this.ty * TILE + TILE / 2;
    // Walking into a closed door opens it, so the player never has to stop at every house.
    if (!this.state.open && p && !p.dead && this._bumpCd <= 0) {
      const dx = cx - p.x;
      const dy = cy - p.y;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 18) {
        const mi = p.moveIntent || { x: 0, y: 0 };
        const toward = mi.x * dx + mi.y * dy;
        if (toward > 4 && Math.abs(mi.y) > 0.3) {
          this._bumpCd = this.state.locked ? 3 : 0.5;
          this.open(p);
        }
      }
    }
    // House doors swing shut again once nobody has been near them for a while.
    if (this.state.open && this.autoClose) {
      const near = this.game?.entities?.nearest?.(cx, cy, 30, (e) => e.type === 'actor' && !e.dead);
      if (near) this._idle = 0;
      else if ((this._idle += dt) > 5) {
        this._idle = 0;
        this.close(null);
      }
    }
  }

  spriteName() {
    return this.sprite;
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const name = this.gate ? 'prop:door:gate' : 'prop:door';
    const s = atlas?.get(`${name}:anim`);
    if (s) {
      const n = s.frames.length;
      const fi = Math.max(0, Math.min(n - 1, Math.round(this.anim * (n - 1))));
      atlas.draw(ctx, `${name}:anim`, fi, sx, sy);
      return;
    }
    if (atlas?.draw(ctx, `${name}:${this.state.open ? 'open' : 'closed'}`, 0, sx, sy)) return;
    ctx.fillStyle = this.state.open ? '#3d2619' : '#8c5a35';
    ctx.fillRect(sx - 8, sy - (this.state.open ? 4 : 28), 16, this.state.open ? 4 : 28);
  }

  canInteract() {
    return true;
  }

  interactLabel(actor) {
    if (this.state.open) return this.gate ? 'Close gate' : 'Close door';
    if (this.state.locked) return this.state.keyId && hasItem(actor, this.state.keyId) ? `Unlock (${itemName(this.state.keyId)})` : 'Locked';
    return this.gate ? 'Open gate' : 'Open door';
  }

  interact(actor) {
    this._bumpCd = 0.6;
    if (this.state.open) this.close(actor);
    else this.open(actor);
  }
}

// ---------------------------------------------------------------------------
// Harvestables: the work API shared by the player and Lyra's jobs.
//   canWork(actor) -> bool
//   work(actor, dt) -> { done, progress 0..1, items?: [{id, qty}] }   (items once, when done)
//   workSeconds
// work() never adds items to anyone's inventory: the caller decides where they go.
// interact(player) runs a work session and puts the yield in the player's pack.

class Harvestable extends WorldObject {
  constructor(game, o) {
    super(game, o);
    this.workSeconds = o.workSeconds ?? 2;
    this.yields = o.yields ?? []; // [{ id, min, max, chance }]
    this.regrowSeconds = o.regrowSeconds ?? DAY;
    this.state = { depleted: false, regrowAt: 0, ...this.state };
    this.progress = 0;
    this._sinceWork = 99;
    this._worker = null;
    this._tick = 0;
    this.workSound = 'chop';
    this.workFx = 'leaf';
    this.workVerb = 'Gather';
  }

  get depleted() {
    return !!this.state.depleted;
  }

  // Why this cannot be worked right now (in words), or '' when it can.
  blockedReason(actor) {
    return this.state.depleted ? `There is nothing left to gather here yet.` : '';
  }

  canWork(actor) {
    return !this.removed && !this.blockedReason(actor);
  }

  work(actor, dt) {
    if (!this.canWork(actor)) return { done: true, progress: 0, items: [], failed: true, reason: this.blockedReason(actor) };
    this._sinceWork = 0;
    this.progress += Math.max(0, dt || 0);
    const p = Math.min(1, this.progress / this.workSeconds);
    if (p >= 1) {
      this.progress = 0;
      const items = this._harvest(actor);
      return { done: true, progress: 1, items };
    }
    return { done: false, progress: p };
  }

  // Yields use the game's seeded RNG; without one (tools, tests) a per-object hash
  // sequence keeps harvests deterministic.
  _rand() {
    const rng = this.game?.rng;
    if (rng?.next) return rng.next();
    this._seq = (this._seq ?? Math.floor(this.phase * 1e6)) + 1;
    let h = Math.imul(this._seq ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  _roll(min, max) {
    const rng = this.game?.rng;
    if (rng?.int) return rng.int(min, max);
    return min + Math.floor(this._rand() * (max - min + 1));
  }

  _chance(p) {
    const rng = this.game?.rng;
    return rng?.chance ? rng.chance(p) : this._rand() < p;
  }

  _harvest(actor) {
    const items = [];
    for (const y of this.yields) {
      if (y.chance != null && !this._chance(y.chance)) continue;
      const qty = this._roll(y.min ?? 1, y.max ?? y.min ?? 1);
      if (qty > 0) items.push({ id: y.id, qty });
    }
    this._deplete();
    for (const it of items) this.game?.bus?.emit('harvest', { actor: actor || null, object: this, itemId: it.id, qty: it.qty });
    return items;
  }

  _deplete() {
    this.state.depleted = true;
    this.state.regrowAt = (this.game?.clock?.t ?? 0) + this.regrowSeconds;
    this.markDirty();
    this._changed(true);
  }

  _regrow() {
    this.state.depleted = false;
    this.state.regrowAt = 0;
    this.markDirty();
    this._changed(true);
  }

  _canRegrowNow() {
    if (!this.solid) return true;
    // Never regrow on top of someone standing there.
    const cx = this.tx * TILE + TILE / 2;
    const cy = this.ty * TILE + TILE / 2;
    return !this.game?.entities?.nearest?.(cx, cy, 12, (e) => e.type === 'actor' && !e.dead);
  }

  update(dt) {
    // Most of the world's trees and stones are untouched: nothing to do (thousands of
    // them out in the wider world).
    if (!this._worker && !(this.progress > 0) && !this.state.depleted) return;
    this._sinceWork += dt;
    if (this._sinceWork > 4 && this.progress > 0) this.progress = 0;
    if (this.state.depleted && this.state.regrowAt) {
      const t = this.game?.clock?.t ?? 0;
      if (t >= this.state.regrowAt) {
        if (this._canRegrowNow()) this._regrow();
        else this.state.regrowAt = t + 10;
      }
    }
    if (this._worker) this._tickSession(dt);
  }

  canInteract(actor) {
    if (this.removed || this.hidden) return false;
    return !this.state.depleted;
  }

  interactLabel(actor) {
    const r = this.blockedReason(actor);
    if (r && this.showBlockedLabel) return this.showBlockedLabel;
    return `${this.workVerb} ${this.name.toLowerCase()}`;
  }

  interact(actor) {
    if (!actor) return;
    const reason = this.blockedReason(actor);
    if (reason) {
      this._toast(actor, reason, 'info');
      return;
    }
    if (this._worker && this._worker !== actor) {
      this._toast(actor, 'Someone is already working here.', 'info');
      return;
    }
    this._worker = actor;
    this._tick = 0;
    actor.faceToward?.(this.x, this.y - 6);
    actor.setState?.('work', 0.2);
  }

  _cancelSession() {
    const a = this._worker;
    this._worker = null;
    if (a && a.state === 'work') {
      a.lockTime = 0;
      a.setState?.('idle');
    }
  }

  _tickSession(dt) {
    const a = this._worker;
    const g = this.game;
    if (!a || a.removed || a.dead || a.downed || (a.isAlive && !a.isAlive())) return this._cancelSession();
    if (Math.hypot(a.x - this.x, a.y - this.y) > 36) return this._cancelSession();
    if (a.state === 'attack' || a.state === 'hurt' || a.state === 'cast' || a.state === 'dodge') return this._cancelSession();
    if (isPlayer(g, a)) {
      const mv = g.input?.moveVector?.();
      if (mv && Math.hypot(mv.x, mv.y) > 0.25) return this._cancelSession();
    }
    const r = this.work(a, dt);
    a.faceToward?.(this.x, this.y - 6);
    a.setState?.('work', 0.15);
    this._tick -= dt;
    if (this._tick <= 0 && !r.done) {
      this._tick = 0.45;
      this._sound(this.workSound);
      this._fx(this.workFx, this.x, this.y - 8, { count: 4 });
    }
    if (r.done) {
      this._worker = null;
      a.lockTime = 0;
      a.setState?.('idle');
      this._give(a, r.items || []);
    }
  }

  _give(actor, items) {
    const g = this.game;
    const names = [];
    for (const it of items) {
      actor.inventory?.add?.(it.id, it.qty);
      g?.bus?.emit('item_gained', { actor, itemId: it.id, qty: it.qty, from: 'pickup' });
      names.push(itemName(it.id, it.qty));
      try {
        g?.bubbles?.number?.(this.x, this.y - 20, `+${it.qty} ${itemName(it.id)}`, '#f4ead7');
      } catch {
        /* cosmetic */
      }
    }
    this._sound(items.length ? 'pickup' : 'error');
    if (!items.length) this._toast(actor, 'Nothing worth keeping this time.', 'info');
  }

  serialize() {
    return { id: this.id, state: { depleted: this.state.depleted, regrowAt: this.state.regrowAt } };
  }
}

export class Tree extends Harvestable {
  constructor(game, o = {}) {
    const kind = o.kind === 'pine' ? 'pine' : o.kind === 'linden' ? 'linden' : 'oak';
    super(game, {
      ...o,
      objType: 'tree',
      solid: true,
      name: o.name ?? (kind === 'pine' ? 'Pine tree' : kind === 'linden' ? 'Linden tree' : 'Oak tree'),
      shadow: o.shadow ?? (kind === 'pine' ? { dx: 2, dy: -2, rx: 9, ry: 5 } : { dx: 2, dy: -2, rx: 14, ry: 6 }),
      workSeconds: 3,
      yields: [{ id: 'wood', min: 2, max: 3 }],
      regrowSeconds: DAY,
    });
    this.kind = kind;
    this.v = o.v ?? 0; // art variant
    this.words = ['tree', kind, 'wood', 'timber', 'log', ...(kind === 'linden' ? ['lindens', 'lime tree'] : []), ...(this.words || [])];
    this.workVerb = 'Chop';
    this.workSound = 'chop';
    this.workFx = 'wood_chip';
    this._fade = 1;
    this._lastT = 0;
  }

  get isStump() {
    return !!this.state.depleted;
  }

  // Felled by a blow (DESIGN §31.3): the stump stays, the tree goes over away from the
  // blow (dir -1 left, 1 right) and lands after FALL_SECONDS, when onLand(items) is called
  // with what it yields (breakables.js drops them as logs). Returns false on a stump.
  fell(dir = 1, onLand = null) {
    if (this.state.depleted || this.removed) return false;
    this._cancelSession?.();
    const items = this._harvest(null);
    this._fall = { k: 0, dir: dir < 0 ? -1 : 1, items, onLand };
    return true;
  }

  update(dt) {
    super.update(dt);
    const f = this._fall;
    if (!f) return;
    f.k += dt / FALL_SECONDS;
    if (f.k >= 1 && !f.landed) {
      f.landed = true;
      try {
        f.onLand?.(f.items, this);
      } catch (err) {
        console.error('[objects] tree landing failed', err);
      }
    }
    if (f.k >= 1.2) this._fall = null;
  }

  blockedReason() {
    return this.state.depleted ? 'Only a stump is left. It will grow back in time.' : '';
  }

  interactLabel() {
    return `Chop ${this.kind}`;
  }

  _harvest(actor) {
    const items = super._harvest(actor);
    this._fx('leaf', this.x, this.y - 30, { count: 10, spread: 14 });
    this._fx('wood_chip', this.x, this.y - 6, { count: 6 });
    return items;
  }

  // Someone stands behind the canopy: let them show through it.
  _behind(e) {
    if (!e || e.removed) return false;
    const w = this.kind === 'pine' ? 11 : 15;
    return e.y < this.y - 3 && e.y > this.y - 44 && Math.abs(e.x - this.x) < w;
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    if (!atlas) return;
    if (this.state.depleted) {
      atlas.draw(ctx, `prop:stump:${this.kind}`, 0, sx, sy) || atlas.draw(ctx, 'prop:stump', 0, sx, sy);
      if (this._fall) drawFallingTree(ctx, atlas, this, sx, sy, this._fall.k);
      return;
    }
    const base = `prop:tree_${this.kind}`;
    const g = this.game;
    const jolt = shakeX(this, time);
    const target = this._behind(g.player) || this._behind(g.companion) ? 0.42 : 1;
    const fdt = Math.min(0.1, Math.max(0, time - this._lastT));
    this._lastT = time;
    this._fade += (target - this._fade) * Math.min(1, fdt * 8);
    const trunk = atlas.get(`${base}:trunk`);
    if (!trunk) {
      atlas.draw(ctx, base, this.v, sx, sy, { alpha: this._fade });
      return;
    }
    atlas.draw(ctx, `${base}:trunk`, this.v, sx, sy);
    const wind = g.clock?.weather?.type === 'rain' ? 1.15 : 0.7;
    const sway = Math.round(Math.sin(time * 1.3 + this.phase * TAU) * wind) + jolt;
    atlas.draw(ctx, `${base}:canopy`, this.v, sx + sway, sy, this._fade < 0.99 ? { alpha: this._fade } : undefined);
  }
}

export class Rock extends Harvestable {
  constructor(game, o = {}) {
    const type = o.objType === 'ore' || o.objType === 'crystal' ? o.objType : 'rock';
    const cfg = {
      rock: { name: 'Rock', yields: [{ id: 'stone', min: 2, max: 3 }], work: 3, regrow: DAY * 1.5, sprite: 'prop:rock' },
      ore: { name: 'Iron ore vein', yields: [{ id: 'iron_ore', min: 1, max: 2 }, { id: 'stone', min: 1, max: 1, chance: 0.5 }], work: 4, regrow: DAY * 2, sprite: 'prop:ore_iron' },
      crystal: { name: 'Glow crystal', yields: [{ id: 'crystal', min: 1, max: 1 }], work: 3.5, regrow: DAY * 2, sprite: 'prop:crystal' },
    }[type];
    super(game, {
      ...o,
      objType: type,
      solid: true,
      low: true,
      name: o.name ?? cfg.name,
      shadow: o.shadow ?? { dx: 1, dy: -1, rx: 7, ry: 3 },
      workSeconds: cfg.work,
      yields: cfg.yields,
      regrowSeconds: cfg.regrow,
    });
    this.sprite = cfg.sprite;
    this.v = o.v ?? 0;
    this.workVerb = 'Mine';
    this.workSound = 'mine';
    this.workFx = type === 'crystal' ? 'sparkle' : 'stone_chip';
    this.words = type === 'ore' ? ['ore', 'iron', 'iron ore', 'vein', 'rock'] : type === 'crystal' ? ['crystal', 'crystals', 'glow crystal'] : ['rock', 'stone', 'boulder'];
  }

  // A mined-out rock leaves rubble you can walk over.
  blocksTile(tx, ty, actor) {
    if (this.state.depleted) return false;
    return super.blocksTile(tx, ty, actor);
  }

  blockedReason() {
    return this.state.depleted ? 'Mined out. The stone will surface again in a day or two.' : '';
  }

  interactLabel() {
    return this.objType === 'ore' ? 'Mine iron ore' : this.objType === 'crystal' ? 'Mine crystal' : 'Mine rock';
  }

  _harvest(actor) {
    const items = super._harvest(actor);
    this._fx(this.objType === 'crystal' ? 'magic' : 'stone_chip', this.x, this.y - 6, { count: 8 });
    this._fx('dust', this.x, this.y - 2, { count: 4 });
    return items;
  }

  getLight(time) {
    if (this.objType !== 'crystal' || this.state.depleted) return null;
    const pulse = 0.5 + 0.12 * Math.sin(time * 2 + this.phase * TAU);
    return this._setLight(this.x, this.y - 8, 34, '#7fe3ff', pulse, 0.08);
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    if (!atlas) return;
    if (this.state.depleted) {
      atlas.draw(ctx, 'prop:rock:rubble', this.v, sx, sy);
      return;
    }
    if (this.objType === 'crystal') atlas.drawAnim(ctx, this.sprite, time + this.phase * 3, sx, sy);
    else atlas.draw(ctx, this.sprite, this.v, sx + shakeX(this, time), sy);
  }
}

export class Plant extends Harvestable {
  constructor(game, o = {}) {
    const type = o.objType === 'moonpetal' || o.objType === 'berry_bush' ? o.objType : 'herb';
    const cfg = {
      herb: { name: 'Silverleaf', yields: [{ id: 'herb', min: 1, max: 2 }], work: 1.2, regrow: DAY * 0.5, solid: false },
      moonpetal: { name: 'Moonpetal', yields: [{ id: 'moonpetal', min: 1, max: 1 }], work: 1.5, regrow: DAY, solid: false },
      berry_bush: { name: 'Berry bush', yields: [{ id: 'berries', min: 2, max: 4 }], work: 1.5, regrow: DAY * 0.75, solid: true },
    }[type];
    super(game, {
      ...o,
      objType: type,
      solid: cfg.solid,
      low: true,
      name: o.name ?? cfg.name,
      shadow: type === 'berry_bush' ? { dx: 1, dy: -1, rx: 8, ry: 3 } : null,
      workSeconds: cfg.work,
      yields: cfg.yields,
      regrowSeconds: cfg.regrow,
    });
    this.workVerb = 'Pick';
    this.workSound = 'pickup';
    this.workFx = type === 'moonpetal' ? 'sparkle' : 'leaf';
    this.words =
      type === 'herb' ? ['herb', 'herbs', 'silverleaf', 'plant'] : type === 'moonpetal' ? ['moonpetal', 'moonpetals', 'flower', 'glowing flower'] : ['berry', 'berries', 'bush', 'berry bush'];
  }

  get bloomed() {
    const c = this.game?.clock;
    if (!c) return true;
    const h = c.hour;
    return h >= 19.5 || h < 5.5;
  }

  blockedReason() {
    if (this.state.depleted) return this.objType === 'berry_bush' ? 'Picked clean. New berries will ripen soon.' : 'Already picked. It will grow back.';
    if (this.objType === 'moonpetal' && !this.bloomed) return 'The moonpetal is curled tight. It only opens under the night sky.';
    return '';
  }

  canInteract(actor) {
    // Closed moonpetals still explain themselves when you try them.
    return !this.removed && !this.state.depleted;
  }

  interactLabel(actor) {
    if (this.objType === 'moonpetal') return this.bloomed ? 'Pick moonpetal' : 'Moonpetal (blooms at night)';
    if (this.objType === 'berry_bush') return 'Pick berries';
    return 'Pick silverleaf';
  }

  getLight(time) {
    if (this.objType !== 'moonpetal' || this.state.depleted || !this.bloomed) return null;
    const pulse = 0.55 + 0.15 * Math.sin(time * 1.7 + this.phase * TAU);
    return this._setLight(this.x, this.y - 5, 26, '#c9b8ff', pulse, 0.1);
  }

  update(dt) {
    super.update(dt);
    if (this.objType === 'moonpetal' && !this.state.depleted && this.bloomed && this._inView(0)) {
      this._twinkle = (this._twinkle ?? this.phase * 3) - dt;
      if (this._twinkle <= 0) {
        this._twinkle = 1.8 + this.phase * 2;
        this._fx('sparkle', this.x, this.y - 6, { count: 1, color: '#ddd2ff' });
      }
    }
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    let name;
    if (this.objType === 'moonpetal') name = this.state.depleted ? 'prop:moonpetal:picked' : this.bloomed ? 'prop:moonpetal:open' : 'prop:moonpetal:closed';
    else if (this.objType === 'berry_bush') name = this.state.depleted ? 'prop:berry_bush:empty' : 'prop:berry_bush';
    else name = this.state.depleted ? 'prop:herb:picked' : 'prop:herb';
    if (this.objType === 'moonpetal' && !this.state.depleted && this.bloomed) atlas.drawAnim(ctx, name, time + this.phase * 2, sx, sy);
    else atlas.draw(ctx, name, 0, sx, sy);
  }
}

// Tobias's crops. Stage is derived from the clock, so growth needs no ticking.
export const CROP_STAGE_SECONDS = DAY / 3;

export class Crop extends Harvestable {
  constructor(game, o = {}) {
    const kind = o.kind === 'wheat' ? 'wheat' : 'turnip';
    super(game, {
      ...o,
      objType: 'crop',
      solid: false,
      name: o.name ?? (kind === 'wheat' ? 'Wheat' : 'Turnips'),
      workSeconds: 1,
      yields: kind === 'wheat' ? [{ id: 'wheat', min: 1, max: 2 }] : [{ id: 'turnip', min: 1, max: 2 }],
      regrowSeconds: 0,
    });
    this.kind = kind;
    const t0 = game?.clock?.t ?? 0;
    const stage = o.stage ?? 3;
    this.state = { plantedAt: t0 - stage * CROP_STAGE_SECONDS - (o.offset ?? 0), ...(o.state || {}) };
    this.workVerb = 'Harvest';
    this.workSound = 'pickup';
    this.workFx = 'leaf';
    this.words = ['crop', 'crops', kind, kind + 's', 'field', 'harvest'];
  }

  get stage() {
    const t = this.game?.clock?.t ?? 0;
    return Math.max(0, Math.min(3, Math.floor((t - this.state.plantedAt) / CROP_STAGE_SECONDS)));
  }

  get ripe() {
    return this.stage >= 3;
  }

  blockedReason() {
    return this.ripe ? '' : `The ${this.kind === 'wheat' ? 'wheat' : 'turnips'} aren't ready yet.`;
  }

  canInteract() {
    return this.ripe;
  }

  interactLabel() {
    return this.kind === 'wheat' ? 'Harvest wheat' : 'Harvest turnips';
  }

  _deplete() {
    // Harvesting replants at once; the crop grows back through its stages.
    this.state.plantedAt = this.game?.clock?.t ?? 0;
    this.markDirty();
  }

  update(dt) {
    // Most of the world's trees and stones are untouched: nothing to do (thousands of
    // them out in the wider world).
    if (!this._worker && !(this.progress > 0) && !this.state.depleted) return;
    this._sinceWork += dt;
    if (this._sinceWork > 4 && this.progress > 0) this.progress = 0;
    if (this._worker) this._tickSession(dt);
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const name = `prop:crop:${this.kind}:${this.stage}`;
    atlas.draw(ctx, name, 0, Math.round(this.x - ox), Math.round(this.y - oy));
  }

  serialize() {
    return { id: this.id, state: { plantedAt: this.state.plantedAt } };
  }
}

// The dock's fishing marker: invisible, endlessly fishable, used by the fish job.
export class FishingSpot extends Harvestable {
  constructor(game, o = {}) {
    super(game, {
      ...o,
      objType: 'fishing_spot',
      solid: false,
      name: o.name ?? 'Fishing spot',
      workSeconds: 5,
      yields: [
        { id: 'raw_fish', min: 1, max: 1 },
        { id: 'raw_fish', min: 1, max: 1, chance: 0.25 },
      ],
    });
    this.workVerb = 'Fish';
    this.workSound = 'splash';
    this.workFx = 'splash';
    this.words = ['fishing spot', 'fishing', 'fish', 'dock', 'pier'];
    this.interactReach = 6;
  }

  _deplete() {
    /* the lake never runs out */
  }

  blockedReason() {
    return '';
  }

  canInteract(actor) {
    return isPlayer(this.game, actor);
  }

  interactLabel() {
    return 'Fish';
  }

  _harvest(actor) {
    const items = super._harvest(actor);
    this._fx('splash', this.x + 4, this.y + 6, { count: 8 });
    return items;
  }

  draw(ctx, ox, oy, time) {
    // Ripples while someone is fishing; otherwise invisible.
    if (!this._worker) return;
    const atlas = this.game?.atlas;
    atlas?.drawAnim(ctx, 'prop:ripple', time, Math.round(this.x - ox + 4), Math.round(this.y - oy + 10));
  }

  serialize() {
    return { id: this.id, state: {} };
  }
}

// ---------------------------------------------------------------------------
// Containers, furniture, light sources

export class Chest extends WorldObject {
  constructor(game, o = {}) {
    super(game, { ...o, objType: 'chest', solid: true, low: true, name: o.name ?? 'Chest', shadow: { dx: 1, dy: -1, rx: 8, ry: 3 } });
    this.inventory = o.inventory instanceof Inventory ? o.inventory : new Inventory(o.items || null);
    this.owner = o.owner ?? null; // 'player' for home_chest
    this.loot = !!o.loot; // anyone may empty it (bandit loot)
    // A lock (DESIGN §32.6): its key (keyId), who keeps it (keeper, a person id) and what
    // the lock says. No key: you may force it, and if it is someone's that is theft.
    this.state.locked = this.state.locked ?? !!o.locked;
    this.keyId = o.keyId ?? null;
    this.keeper = o.keeper ?? null;
    this.lockedText = o.lockedText ?? null;
    this.lid = 0;
    this._viewer = null;
    this._idle = 0;
    this.words = ['chest', 'box', 'storage', ...(o.words || [])];
  }

  canInteract(actor) {
    return !!actor;
  }

  interactLabel(actor) {
    if (this.state.locked) return this.keyId && hasItem(actor, this.keyId) ? `Unlock ${this.name.toLowerCase()}` : `${this.name}: locked`;
    return this.loot && this.inventory.isEmpty() ? 'Empty chest' : `Open ${this.name.toLowerCase()}`;
  }

  interact(actor) {
    const g = this.game;
    if (this.state.locked) {
      if (this.keyId && hasItem(actor, this.keyId)) {
        this.state.locked = false;
        this.markDirty();
        this._sound('door_open', { pitch: 0.8 });
        this._toast(actor, `The ${itemName(this.keyId)} turns. ${this.name} is open.`, 'good');
      } else {
        if (isPlayer(g, actor)) lockedChest(g, this, actor);
        return;
      }
    }
    this._viewer = actor;
    this._idle = 0;
    if (!this.state.opened) {
      this.state.opened = true;
      this.markDirty();
      // The first time it opens its haul glints out of it (pixelfx, DESIGN §30).
      if (!this.inventory.isEmpty()) playCollect(g, this.x, this.y, { gold: true, size: 1, height: 8 });
    }
    this._sound('door_open', { pitch: 1.5 });
    g?.bus?.emit?.('chest_opened', { chest: this, actor });
    if (isPlayer(g, actor)) {
      if (typeof g.ui?.openChest === 'function') {
        g.ui.openChest(this);
        return;
      }
      this.takeAll(actor);
      return;
    }
    if (this.loot) this.takeAll(actor);
  }

  // Move everything to the actor (used when looting, and when no chest UI exists).
  takeAll(actor) {
    const list = this.inventory.list();
    if (!list.length) {
      this._toast(actor, 'The chest is empty.', 'info');
      return [];
    }
    const out = [];
    for (const { id, qty } of list) {
      const n = this.inventory.transfer(actor.inventory, id, qty);
      if (n > 0) {
        out.push({ id, qty: n });
        this.game?.bus?.emit('item_gained', { actor, itemId: id, qty: n, from: 'chest', chest: this });
      }
    }
    this.markDirty();
    this._sound('coin');
    this._toast(actor, `You take ${out.map((i) => itemName(i.id, i.qty)).join(', ')}.`, 'good');
    return out;
  }

  update(dt) {
    const open = !!this._viewer;
    this.lid = open ? Math.min(1, this.lid + dt * 6) : Math.max(0, this.lid - dt * 6);
    if (!this._viewer) return;
    const v = this._viewer;
    const far = v.removed || Math.hypot(v.x - this.x, v.y - this.y) > 44;
    const modal = this.game?.ui?.isModalOpen?.();
    this._idle = modal ? 0 : this._idle + dt;
    if (far || this._idle > 0.6) {
      this._viewer = null;
      this._sound('door_close', { pitch: 1.5 });
    }
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const name = this.lid > 0.5 ? 'prop:chest:open' : 'prop:chest:closed';
    atlas.draw(ctx, `${name}${this.variant ? ':' + this.variant : ''}`, 0, Math.round(this.x - ox), Math.round(this.y - oy)) ||
      atlas.draw(ctx, name, 0, Math.round(this.x - ox), Math.round(this.y - oy));
  }

  // Chests are always saved: the storage UI changes their contents directly.
  serialize() {
    return { id: this.id, state: { ...this.state }, items: this.inventory.serialize() };
  }

  deserialize(d) {
    super.deserialize(d);
    if (d?.items) this.inventory.deserialize(d.items);
  }
}

// A locked chest without its key (src/world/containers.js decides: its keeper may open
// it for you, or you may force the lock).
let lockedChest = () => {};
export function setLockedChestHandler(fn) {
  lockedChest = typeof fn === 'function' ? fn : () => {};
}

export class Bed extends WorldObject {
  constructor(game, o = {}) {
    const f = o.footprint || { x: o.tx, y: o.ty - 1, w: 1, h: 2 };
    super(game, { ...o, objType: 'bed', footprint: f, solid: true, low: true, interactReach: 8, shadow: { dx: 1, dy: -2, rx: 8, ry: 3 } });
    this.owner = o.owner ?? null;
    // A room Lyra pays for herself at the Ember Kettle (DESIGN §16.1): hers, not the player's.
    this.rented = !!o.rented;
    this.name = o.name ?? (this.owner === 'lyra' ? "Lyra's bed" : 'Bed');
    this.sprite = o.sprite ?? (this.rented ? 'prop:bed:inn' : this.variant ? `prop:${o.cot ? 'bunk' : 'bed'}:${this.variant}` : o.cot ? 'prop:bunk' : this.owner === 'lyra' ? 'prop:bed:lyra' : 'prop:bed');
    // A villager's own bed (LORE §10 homes): they sleep in it; the player only looks.
    this.villagerBed = !!this.owner && this.owner !== 'player' && this.owner !== 'lyra';
    this.text = o.text ?? null;
    const ownWords = this.owner === 'lyra' ? ['lyra', 'her bed', 'your bed'] : this.owner === 'player' ? ['my bed', 'home bed'] : this.villagerBed ? [`${this.owner}'s bed`, `${this.owner} bed`] : [];
    this.words = ['bed', 'sleep', ...ownWords, ...(o.words || [])];
    // A free spot beside the bed for whoever sleeps here.
    this.sleepSpot = { x: this.x + (o.sleepSide === 'left' ? -TILE : TILE), y: this.y - 6 };
    // Which way it lies, where the head goes, and where a sleeper's feet point (DESIGN
    // §19.8: a sleeper lies the way the bed is oriented, head on the pillow).
    this.orient = f.w > f.h ? 'h' : 'v';
    this.pillow = { x: this.x, y: this.y - f.h * TILE + 8 };
    this.lie = { x: this.x, y: this.y - 6 };
    this.sleeper = null;
    this._scanT = this.phase * 0.25;
  }

  // Whoever lies down in a bed is drawn by the bed: head on the pillow, the blanket
  // pulled up over them, never a sideways figure across the quilt. Any humanoid in the
  // 'sleep' state lying on the bed counts; while they do, the renderer skips the actor
  // itself (actor.hidden) and the bed paints them in.
  update(dt) {
    this._scanT -= dt;
    if (this._scanT > 0) return;
    this._scanT = 0.2;
    if (this.sleeper && !this.holds(this.sleeper)) this._release();
    if (this.sleeper) return;
    const list = this.game?.entities?.all?.() || this.game?.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e.inBed !== this && !e.inBed?.holds?.(e) && this.holds(e) && this._drawable(e)) {
        this._claim(e);
        break;
      }
    }
  }

  // A bed is furniture to everyone but the one who sleeps in it: its owner can step into
  // it (and out again in the morning), so a villager lies down in the bed, not beside it.
  blocksTile(tx, ty, actor) {
    if (actor && this.owner && this.owner !== 'player' && actor.id === this.owner) return false;
    return super.blocksTile(tx, ty, actor);
  }

  holds(e) {
    return !!e && !e.removed && !this.removed && e.state === 'sleep' && !e.downed && Math.abs(e.x - this.x) <= 10 && e.y > this.y - 34 && e.y < this.y + 4;
  }

  _drawable(e) {
    const atlas = this.game?.atlas;
    return !!atlas?.has?.(`char:${e.spriteKey}:sleep:down`) && atlas.getMeta?.(`char:${e.spriteKey}`)?.kind !== 'creature';
  }

  _claim(e) {
    this.sleeper = e;
    e.inBed = this;
    const d = Object.getOwnPropertyDescriptor(e, 'hidden');
    if (d && d.get) return;
    let own = d ? !!d.value : false;
    Object.defineProperty(e, 'hidden', {
      configurable: true,
      enumerable: false,
      get() {
        const b = e.inBed;
        return own || (!!b && b.sleeper === e && b.holds(e));
      },
      set(v) {
        own = !!v;
      },
    });
  }

  _release() {
    const e = this.sleeper;
    this.sleeper = null;
    if (e && e.inBed === this) e.inBed = null;
  }

  draw(ctx, ox, oy, time) {
    super.draw(ctx, ox, oy, time);
    const e = this.sleeper;
    if (e && this.holds(e)) this._drawSleeper(ctx, ox, oy, time, e);
  }

  // The lying frame has the head to the left; a quarter turn clockwise stands it head-up
  // on the mattress. Frame pixel (fx, fy) lands at (X0 - fy, Y0 + fx); paintLying made
  // the lying frame from the standing one as (fx, fy) = (y, 38 - x), so the turned image
  // is the standing figure with its left edge at X0 - 39 and its top at Y0.
  _drawSleeper(ctx, ox, oy, time, e) {
    const atlas = this.game?.atlas;
    const spr = atlas?.get?.(`char:${e.spriteKey}:sleep:down`);
    if (!spr) return;
    const img = spr.frames[Math.floor(Math.max(0, time) * (spr.fps || 1.2)) % spr.frames.length];
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const bed = atlas.get(this.sprite) || atlas.get('prop:bed');
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 7, sy - 33, 14, 31);
    ctx.clip();
    // Head on the pillow: the standing figure's crown (about y 4) sits at the pillow top.
    ctx.translate(sx + 23, sy - 35);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    // The blanket: the bed's own quilt redrawn over the body from the shoulders down,
    // with its folded edge turned back a little higher than when the bed is empty.
    if (bed) {
      const q = bed.frames[0];
      const top = 13;
      ctx.drawImage(q, 1, top, 14, 34 - top - 2, sx - 7, sy - bed.oy + top, 14, 34 - top - 2);
      ctx.fillStyle = 'rgba(244,238,222,0.95)';
      ctx.fillRect(sx - 6, sy - bed.oy + top, 12, 1);
      ctx.fillStyle = 'rgba(40,30,40,0.35)';
      ctx.fillRect(sx - 6, sy - bed.oy + top + 1, 12, 1);
      // The shape of a body under it: a soft ridge down the middle.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(sx - 3, sy - bed.oy + top + 3, 4, 14);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(sx + 2, sy - bed.oy + top + 3, 2, 14);
    }
  }

  canInteract(actor) {
    return !!actor;
  }

  interactLabel(actor) {
    const player = isPlayer(this.game, actor);
    if (player && this.rented) return "Lyra's room";
    if (player && this.villagerBed) return this.name;
    // Any hour (r13): a bed sleeps you to morning (game.sleep says when it cannot). Your
    // own, or any bed that is nobody's (an empty house in Brindlecombe, round 14): the same
    // sleep, so the same words. Home stays the Wayhouse bed (world/home.js, the Home pointer).
    if (player && (this.owner === 'player' || !this.owner)) return 'Sleep until morning';
    return this.owner === 'lyra' && player ? "Sleep in Lyra's bed" : 'Sleep';
  }

  interact(actor) {
    const g = this.game;
    if (isPlayer(g, actor)) {
      if (this.rented) {
        this._toast(actor, "This is Lyra's room. She pays Elda for it out of her own purse, and what is in here is hers.", 'info');
        return;
      }
      if (this.villagerBed) {
        this._toast(actor, this.text || `${this.name}. Not yours, and somebody would notice.`, 'info');
        return;
      }
      try {
        g.sleep?.(this);
      } catch (err) {
        console.error('[objects] sleep failed', err);
      }
      return;
    }
    // Anyone else lies down beside it until their controller decides otherwise.
    actor.faceDir?.('down');
    actor.setState?.('sleep', 2);
  }
}

const RECIPES = [
  { inputs: { raw_fish: 1 }, out: 'cooked_fish', qty: 1 },
  { inputs: { turnip: 2 }, out: 'stew', qty: 1 },
  { inputs: { wheat: 2 }, out: 'bread', qty: 1 },
];

export class Fire extends WorldObject {
  constructor(game, o = {}) {
    const type = o.objType === 'hearth' ? 'hearth' : 'campfire';
    super(game, {
      ...o,
      objType: type,
      solid: true,
      low: type === 'campfire',
      name: o.name ?? (type === 'hearth' ? 'Hearth' : 'Campfire'),
      interactReach: type === 'hearth' ? 10 : 4,
      shadow: null,
    });
    this.sprite = type === 'hearth' ? 'prop:hearth' : 'prop:campfire';
    this.words = ['fire', 'campfire', 'hearth', 'fireplace', 'cooking', 'cook', 'warmth', ...(o.words || [])];
    this.recipes = RECIPES;
    this._emberT = this.phase;
    this._warmCd = 0;
  }

  getLight(time) {
    const f = 0.86 + 0.08 * Math.sin(time * 11 + this.phase * 9) + 0.06 * Math.sin(time * 23.7 + this.phase * 4);
    const r = this.objType === 'hearth' ? 66 : 84;
    const l = this._setLight(this.x, this.y - 8, r, '#ff9a3c', f, 0.35);
    return this.objType === 'campfire' ? this._wetReflection(l, 12) : l;
  }

  update(dt) {
    if (this._warmCd > 0) this._warmCd -= dt;
    this._emberT -= dt;
    if (this._emberT <= 0) {
      this._emberT = 0.28 + (this.phase * 0.3);
      if (this._inView(16)) this._fx('ember', this.x + ((this._emberT * 97) % 6) - 3, this.y - 10, { count: 1 });
      if (this.objType === 'campfire' && this._inView(16) && (this._smokeN = ((this._smokeN || 0) + 1) % 4) === 0) this._fx('smoke', this.x, this.y - 16, { count: 1 });
    }
  }

  // Cook the first recipe the actor has ingredients for. Returns { ok, itemId, qty, message }.
  cook(actor) {
    const inv = actor?.inventory;
    if (!inv) return { ok: false, message: 'Nothing to cook with.' };
    for (const r of this.recipes) {
      if (!Object.entries(r.inputs).every(([id, n]) => inv.has(id, n))) continue;
      for (const [id, n] of Object.entries(r.inputs)) inv.remove(id, n);
      inv.add(r.out, r.qty);
      this.game?.bus?.emit('item_gained', { actor, itemId: r.out, qty: r.qty, from: 'job' });
      this._sound('eat', { pitch: 1.3 });
      this._fx('smoke', this.x, this.y - 14, { count: 3 });
      return { ok: true, itemId: r.out, qty: r.qty, message: `Cooked ${itemName(r.out, r.qty)}.` };
    }
    return { ok: false, message: 'Nothing here to cook. Raw fish, two turnips or two sheaves of wheat would do.' };
  }

  cookable(actor) {
    const inv = actor?.inventory;
    if (!inv) return null;
    return this.recipes.find((r) => Object.entries(r.inputs).every(([id, n]) => inv.has(id, n))) || null;
  }

  canInteract(actor) {
    return isPlayer(this.game, actor);
  }

  interactLabel(actor) {
    const r = this.cookable(actor);
    return r ? `Cook ${itemName(r.out)}` : 'Warm your hands';
  }

  interact(actor) {
    const r = this.cookable(actor);
    if (r) {
      const res = this.cook(actor);
      this._toast(actor, res.message, res.ok ? 'good' : 'info');
      return;
    }
    if (this._warmCd > 0) {
      this._toast(actor, 'The fire crackles. You already feel warm to your bones.', 'info');
      return;
    }
    this._warmCd = 30;
    try {
      this.game?.combat?.heal?.(this, actor, 6);
    } catch {
      /* combat optional */
    }
    this._toast(actor, 'You warm your hands. The ache of the road eases a little.', 'good');
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    atlas.drawAnim(ctx, this.sprite, time + this.phase, Math.round(this.x - ox), Math.round(this.y - oy));
  }
}

// Village lamps (LORE §5: every dusk an Ambrel lights the lamps around the square and
// along the lanes). A street lamp is lit or not: `state.lit`, saved with the world.
//   lamp.light(by)  -> true when it was dark and is now lit; emits 'lamp_lit' {id, lamp, by}
//   lamp.douse(by)  -> true when it was lit; emits 'lamp_out' {id, lamp, by}
//   lamp.round      -> its place in the lamplighter's round (0 first; null = not on it)
//   lamp.area       -> the location id it stands in ('town_square', 'lamplight_lane'...)
//   lamp.far        -> one of the far lamps at the end of Lamplight Lane
//   lamp.needsLighting() -> on the round, still dark, and dusk has come
// Nobody has to light them: whatever is still dark at LAMP_HOURS.selfLight lights itself
// (Hobb may be downed), and every lamp goes out at dawn. Chapel candles never go out.
export const LAMP_HOURS = { dusk: 17.25, selfLight: 21.5, out: 6, roundStart: 18.25, roundStep: 0.07 };

export class Lamp extends WorldObject {
  constructor(game, o = {}) {
    const kind = o.kind ?? 'post'; // post | candles | wall
    const wall = kind === 'wall';
    super(game, {
      ...o,
      objType: 'lamp',
      solid: o.solid ?? !wall,
      low: false,
      name: o.name ?? (wall ? 'Door lantern' : 'Street lamp'),
      shadow: wall ? null : { dx: 1, dy: -1, rx: 3, ry: 2 },
      interactReach: o.interactReach ?? (wall ? 8 : 0),
    });
    this.kind = kind;
    this.sprite = `prop:lamp${kind === 'post' ? '' : ':' + kind}`;
    this.words = ['lamp', 'lantern', 'light', ...(kind === 'candles' ? ['candle', 'candles'] : ['street lamp', 'lamp post']), ...(o.words || [])];
    this.alwaysLit = kind === 'candles';
    this.round = Number.isFinite(o.round) ? o.round : null;
    this.area = o.area ?? null;
    this.far = !!o.far;
    this.text = o.text ?? null;
    this.state = { lit: false, ...(o.state || {}) };
    this._checkT = this.phase; // lamps look at the clock a few times a second, not every step
  }

  get lit() {
    return this.alwaysLit || !!this.state.lit;
  }

  get isStreetLamp() {
    return !this.alwaysLit;
  }

  light(by = null) {
    if (this.alwaysLit || this.state.lit) return false;
    this.state.lit = true;
    this.markDirty();
    if (this._inView(24)) this._fx('ember', this.x, this.y - (this.kind === 'wall' ? 20 : 28), { count: 3 });
    this.game?.bus?.emit('lamp_lit', { id: this.id, lamp: this, by: by || null });
    return true;
  }

  douse(by = null) {
    if (this.alwaysLit || !this.state.lit) return false;
    this.state.lit = false;
    this.markDirty();
    this.game?.bus?.emit('lamp_out', { id: this.id, lamp: this, by: by || null });
    return true;
  }

  needsLighting(hour = this.game?.clock?.hour) {
    if (this.alwaysLit || this.state.lit || this.round == null || hour == null) return false;
    return hour >= LAMP_HOURS.dusk || hour < 2;
  }

  // Seconds-cheap clock rules: out at dawn (staggered a little, lamp by lamp), and
  // self-lighting once full dark comes. With no lamplighter in the world at all, the
  // round still happens at dusk, one lamp after another, so the village never waits.
  update(dt) {
    if (this.alwaysLit) return;
    this._checkT -= dt;
    if (this._checkT > 0) return;
    this._checkT = 0.5;
    const h = this.game?.clock?.hour;
    if (h == null) return;
    if (this.state.lit) {
      if (h >= LAMP_HOURS.out + this.phase * 0.6 && h < 12) this.douse(null);
      return;
    }
    if (h >= 12 && h < LAMP_HOURS.dusk) return;
    if (h >= LAMP_HOURS.out && h < 12) return;
    const late = h >= LAMP_HOURS.selfLight + this.phase * 0.08 || h < LAMP_HOURS.out;
    let due = late;
    if (!due && this.round != null && !this._lamplighter()) due = h >= LAMP_HOURS.roundStart + this.round * LAMP_HOURS.roundStep;
    else if (!due && this.round == null) due = h >= LAMP_HOURS.roundStart + 0.5 + this.phase * 0.5;
    if (due) this.light(null);
  }

  // Is there a lamplighter in the world to do the round (alive, not knocked down)?
  _lamplighter() {
    const e = this.game?.entities?.get?.('hobb');
    return !!e && !e.removed && !e.dead;
  }

  getLight(time) {
    if (!this.lit) return null;
    const night = this._darkness();
    const dark = this.alwaysLit ? Math.max(0.55, night) : Math.max(0.18, Math.min(1, (night - 0.1) / 0.5));
    const f = 0.92 + 0.08 * Math.sin(time * 7 + this.phase * 13);
    if (this.kind === 'candles') return this._setLight(this.x, this.y - 10, 42, '#ffc26b', 0.75 * f * dark, 0.3);
    if (this.kind === 'wall') return this._wetReflection(this._setLight(this.x, this.y - 20, 50, '#ffcf7a', 0.82 * f * dark, 0.15), 22);
    return this._wetReflection(this._setLight(this.x, this.y - 26, 64, '#ffcf7a', 0.9 * f * dark, 0.15), 30);
  }

  canInteract(actor) {
    return !!this.text && isPlayer(this.game, actor) && !this.state.broken;
  }

  interactLabel() {
    return 'Look';
  }

  interact(actor) {
    if (this.text) this._toast(actor, this.text, 'info');
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    if (this.lit && atlas.has(`${this.sprite}:lit`)) atlas.drawAnim(ctx, `${this.sprite}:lit`, time + this.phase, sx, sy);
    else atlas.draw(ctx, this.sprite, 0, sx, sy) || atlas.draw(ctx, 'prop:lamp', 0, sx, sy);
  }

  serialize() {
    return { id: this.id, state: { lit: !!this.state.lit } };
  }
}

// The village's street lamps in the order of the lamplighter's round.
export function lampRound(game) {
  const list = game?.objects?.all?.() || [];
  return list.filter((o) => o.objType === 'lamp' && o.round != null && !o.removed).sort((a, b) => a.round - b.round);
}

export class Sign extends WorldObject {
  constructor(game, o = {}) {
    super(game, { ...o, objType: 'sign', solid: o.solid ?? true, low: true, interactReach: o.interactReach ?? 6 });
    this.title = o.title ?? this.name;
    this.text = o.text ?? '';
    this.sprite = o.sprite ?? (this.variant ? `prop:sign:${this.variant}` : 'prop:sign');
    this.words = ['sign', 'signpost', ...(this.variant === 'board' ? ['notice board', 'board', 'notices', 'notice'] : []), ...(o.words || [])];
  }

  canInteract(actor) {
    return isPlayer(this.game, actor) && !this.state.broken;
  }

  interactLabel() {
    return this.variant === 'board' ? 'Read notices' : 'Read';
  }

  interact(actor) {
    const ui = this.game?.ui;
    try {
      if (typeof ui?.showSign === 'function') ui.showSign(this.title, this.text);
      else ui?.toast?.(`${this.title}: ${this.text}`, 'info');
    } catch (err) {
      console.error('[objects] sign failed', err);
    }
    this._sound('ui_open');
    this.game?.bus?.emit?.('sign_read', { sign: this, actor: actor || null });
  }
}

export class Window extends WorldObject {
  constructor(game, o = {}) {
    super(game, { ...o, objType: 'window', solid: false });
    this.sprite = `prop:window${this.variant ? ':' + this.variant : ''}`;
    this.lightDy = o.lightDy ?? null;
    // Nobody lives behind it (Brindlecombe's empty houses): no lamp comes on at dusk.
    this.unlit = !!o.unlit;
  }

  getLight(time) {
    if (this.unlit) return null;
    const dark = this._darkness();
    if (dark < 0.25) return null;
    const f = 0.9 + 0.1 * Math.sin(time * 3 + this.phase * 20);
    const k = Math.min(1, (dark - 0.25) * 1.6) * f;
    // A dormer is painted into its roof: only its glow comes from here.
    if (this.hidden) return this._setLight(this.x, this.y - (this.lightDy ?? 8), 24, '#ffc46b', k * 0.55, 0.12);
    return this._wetReflection(this._setLight(this.x, this.y - 18, 30, '#ffc46b', k * 0.7, 0.12), 20);
  }

  draw(ctx, ox, oy, time) {
    if (this.hidden) return;
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    atlas.draw(ctx, this.sprite, 0, sx, sy) || atlas.draw(ctx, 'prop:window', 0, sx, sy);
    const dark = this.unlit ? 0 : this._darkness();
    if (dark > 0.25) {
      const lit = atlas.has(`${this.sprite}:lit`) ? `${this.sprite}:lit` : 'prop:window:lit';
      atlas.draw(ctx, lit, 0, sx, sy, { alpha: Math.min(1, (dark - 0.25) * 1.8) });
    }
  }
}

// Maren's journal, deep in the ruins.
export class Journal extends WorldObject {
  constructor(game, o = {}) {
    super(game, { ...o, id: o.id ?? 'maren_journal', objType: 'journal', solid: false, name: o.name ?? "Maren's Journal", interactReach: 6 });
    this.words = ['journal', 'book', 'maren', "maren's journal", 'diary'];
    this._sparkT = 0;
  }

  canInteract(actor) {
    return !this.removed && !!actor && !!actor.inventory;
  }

  interactLabel() {
    return 'Pick up the journal';
  }

  interact(actor) {
    if (this.removed || !actor?.inventory) return;
    const g = this.game;
    actor.inventory.add('maren_journal', 1);
    if (g) {
      if (!g.flags) g.flags = {};
      g.flags.journal_found = true;
    }
    g?.bus?.emit('item_gained', { actor, itemId: 'maren_journal', qty: 1, from: 'quest' });
    this._sound('quest');
    this._fx('sparkle', this.x, this.y - 6, { count: 16, color: '#ffe27a' });
    this._fx('magic', this.x, this.y - 6, { count: 10 });
    try {
      g?.lighting?.flash?.({ x: this.x, y: this.y - 6, r: 70, color: '#ffe08a', intensity: 1, duration: 0.6 });
    } catch {
      /* cosmetic */
    }
    if (isPlayer(g, actor)) this._toast(actor, "You found Maren's Journal. The cover is water-stained, but the pages are dry.", 'quest');
    g?.objects?.remove?.(this);
  }

  update(dt) {
    this._sparkT -= dt;
    if (this._sparkT <= 0) {
      this._sparkT = 0.55;
      if (this._inView(8)) this._fx('sparkle', this.x + Math.sin(this.game?.time * 3 || 0) * 5, this.y - 8, { count: 1, color: '#ffe27a' });
    }
  }

  getLight(time) {
    if (this.removed) return null;
    return this._setLight(this.x, this.y - 6, 40, '#ffd76a', 0.75 + 0.15 * Math.sin(time * 3), 0.1);
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game?.atlas;
    if (!atlas) return;
    const bob = Math.round(Math.sin(time * 2.4) * 1.2);
    atlas.drawAnim(ctx, 'prop:journal', time, Math.round(this.x - ox), Math.round(this.y - oy) + bob);
  }
}

// Everything else: wells, anvils, tables, fences, tents, pillars... Some are lit, some
// have a line or two to read when you use them.
const DECOR_LIGHTS = {
  forge: { r: 58, color: '#ff8a3a', intensity: 0.95, flicker: 0.3, dy: -10 },
  altar: { r: 50, color: '#ffc26b', intensity: 0.8, flicker: 0.25, dy: -14 },
  cauldron: { r: 30, color: '#8cff9c', intensity: 0.55, flicker: 0.2, dy: -8 },
  brazier: { r: 60, color: '#ff9a3c', intensity: 0.9, flicker: 0.35, dy: -14 },
  dipping_vat: { r: 34, color: '#ffb35c', intensity: 0.6, flicker: 0.25, dy: -6 },
};

const ANIMATED_DECOR = new Set(['forge', 'altar', 'cauldron', 'brazier', 'banner', 'hive', 'dipping_vat', 'washing_line']);

export class Decor extends WorldObject {
  constructor(game, o = {}) {
    super(game, o);
    this.text = o.text ?? null;
    this.title = o.title ?? this.name;
    this.useLabel = o.label ?? null;
    this.heal = o.heal ?? 0;
    this.cooldown = 0;
    this.lightDef = o.light ?? DECOR_LIGHTS[this.objType] ?? null;
    this.animated = o.animated ?? ANIMATED_DECOR.has(this.objType);
    this.words = [this.objType.replace(/_/g, ' '), ...(o.words || [])];
  }

  update(dt) {
    if (this.state.broken) mendTick(this);
    if (this.cooldown > 0) this.cooldown -= dt;
    if ((this.objType === 'forge' || this.objType === 'brazier') && this._inView(8)) {
      this._emberT = (this._emberT ?? this.phase) - dt;
      if (this._emberT <= 0) {
        this._emberT = 0.4;
        this._fx('ember', this.x, this.y - 14, { count: 1 });
      }
    }
  }

  getLight(time) {
    const L = this.lightDef;
    if (!L) return null;
    const f = 1 - L.flicker * 0.5 + L.flicker * 0.5 * Math.sin(time * 9 + this.phase * 17) * Math.sin(time * 4.3 + this.phase * 5);
    return this._setLight(this.x, this.y + (L.dy ?? -8), L.r, L.color, L.intensity * f, L.flicker);
  }

  canInteract(actor) {
    return !!this.text && isPlayer(this.game, actor) && !this.state.broken; // rubble has nothing to read
  }

  interactLabel() {
    return this.useLabel || 'Look';
  }

  interact(actor) {
    if (!this.text) return;
    this.game?.bus?.emit?.('object_looked', { obj: this, actor: actor || null });
    const ui = this.game?.ui;
    if (this.heal > 0 && this.cooldown <= 0) {
      this.cooldown = 45;
      try {
        this.game?.combat?.heal?.(this, actor, this.heal);
      } catch {
        /* combat optional */
      }
    }
    try {
      if (typeof ui?.showSign === 'function' && this.text.length > 90) ui.showSign(this.title, this.text);
      else ui?.toast?.(this.text, 'info');
    } catch (err) {
      console.error('[objects] decor interact failed', err);
    }
  }

  draw(ctx, ox, oy, time) {
    if (this.hidden) return;
    if (this.state.broken) return drawDebris(ctx, this, ox, oy);
    const atlas = this.game?.atlas;
    if (!atlas) return;
    // Struck: a jolt (the training dummy rocks on its post).
    const sx = Math.round(this.x - ox) + (this.objType === 'dummy' ? swayOf(this, time) : shakeX(this, time));
    const sy = Math.round(this.y - oy);
    if (this.animated) atlas.drawAnim(ctx, this.sprite, time + this.phase, sx, sy);
    else atlas.draw(ctx, this.sprite, 0, sx, sy);
  }

  serialize() {
    return { id: this.id, state: { ...this.state } };
  }
}

// A chair, stool, bench or pew (r13; the author: "I can't sit anywhere"): the player sits
// on it with the use button and stands by moving (src/world/rest.js); the villagers'
// own sitting shares its seats. A bench with words still says them as you sit.
export class Seat extends Decor {
  canInteract(actor) {
    if (!isPlayer(this.game, actor)) return false;
    return actor.seat?.obj === this || !!seatFor(this, actor);
  }

  interactLabel(actor) {
    return actor?.seat?.obj === this ? 'Stand up' : 'Sit';
  }

  interact(actor) {
    if (!isPlayer(this.game, actor)) return;
    const r = sitDown(this.game, actor, this);
    if (!r.ok) {
      this.game?.ui?.toast?.(r.reason, 'info');
      return;
    }
    if (this.text) {
      try {
        this.game?.ui?.toast?.(this.text, 'info');
      } catch {
        /* words are a kindness */
      }
    }
  }
}

// Build any object from a plain description (worldgen and tests use this).
export function makeObject(game, d) {
  if (SEAT_TYPES.has(d.objType)) return new Seat(game, d);
  switch (d.objType) {
    case 'door':
      return new Door(game, d);
    case 'tree':
      return new Tree(game, d);
    case 'rock':
    case 'ore':
    case 'crystal':
      return new Rock(game, d);
    case 'herb':
    case 'moonpetal':
    case 'berry_bush':
      return new Plant(game, d);
    case 'crop':
      return new Crop(game, d);
    case 'fishing_spot':
      return new FishingSpot(game, d);
    case 'chest':
      return new Chest(game, d);
    case 'bed':
      return new Bed(game, d);
    case 'campfire':
    case 'hearth':
      return new Fire(game, d);
    case 'lamp':
      return new Lamp(game, d);
    case 'sign':
      return new Sign(game, d);
    case 'window':
      return new Window(game, d);
    case 'journal':
      return new Journal(game, d);
    default:
      return new Decor(game, d);
  }
}

// ---------------------------------------------------------------------------
// The manager: spatial indexes so collision, interaction and rendering stay O(1)-ish
// with well over a thousand objects in the world.

const CELL = 8; // tiles per spatial cell
const FAR_UPDATE = 40 * TILE; // px: objects farther from the player update in turns
const FAR_SLICES = 8;

const WORD_ALIASES = {
  fire: ['campfire', 'hearth'],
  fireplace: ['hearth'],
  gate: ['door'],
  entrance: ['door'],
  board: ['sign'],
  notice: ['sign'],
  lantern: ['lamp'],
  light: ['lamp'],
  ore: ['ore'],
  iron: ['ore'],
  stone: ['rock'],
  boulder: ['rock'],
  bush: ['berry_bush'],
  berries: ['berry_bush'],
  berry: ['berry_bush'],
  flower: ['moonpetal'],
  flowers: ['moonpetal'],
  herbs: ['herb'],
  crops: ['crop'],
  turnips: ['crop'],
  turnip: ['crop'],
  wheat: ['crop'],
  field: ['crop'],
  fishing: ['fishing_spot'],
  dock: ['fishing_spot'],
  pier: ['fishing_spot'],
  book: ['journal'],
  trees: ['tree'],
  hives: ['hive'],
  beehive: ['hive'],
  beehives: ['hive'],
  bees: ['hive'],
  skep: ['hive'],
  vat: ['dipping_vat', 'dye_vat'],
  vats: ['dye_vat', 'dipping_vat'],
  nets: ['net_rack'],
  net: ['net_rack'],
  laundry: ['washing_line'],
  washing: ['washing_line'],
  lamps: ['lamp'],
  linden: ['tree'],
  lindens: ['tree'],
};

export class ObjectManager {
  // (x0, y0): the first tile, as in TileMap: tileIndex shares the map's indexing. With no
  // size given it covers the whole world (constants.js); a given size starts at 0, 0.
  constructor(game, w, h, x0, y0) {
    this.game = game;
    const whole = w == null;
    this.w = whole ? WORLD_W : w;
    this.h = whole ? WORLD_H : h;
    this.x0 = (x0 ?? (whole ? WORLD_X0 : 0)) | 0;
    this.y0 = (y0 ?? (whole ? WORLD_Y0 : 0)) | 0;
    w = this.w;
    h = this.h;
    this.list = [];
    this.byId = new Map();
    this.tileIndex = new Array(w * h); // per tile (map.idx order): array of objects covering it
    this.cx0 = Math.floor(this.x0 / CELL); // first spatial cell column and row
    this.cy0 = Math.floor(this.y0 / CELL);
    this.cw = Math.floor((this.x0 + w - 1) / CELL) - this.cx0 + 1;
    this.ch = Math.floor((this.y0 + h - 1) / CELL) - this.cy0 + 1;
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
    this.removedIds = new Set();
    this.version = 0; // bumps whenever walkability changes (doors, mined rocks)
  }

  _cellOf(o) {
    const cx = Math.max(0, Math.min(this.cw - 1, Math.floor(o.x / TILE / CELL) - this.cx0));
    const cy = Math.max(0, Math.min(this.ch - 1, Math.floor(o.y / TILE / CELL) - this.cy0));
    return cy * this.cw + cx;
  }

  _in(tx, ty) {
    return tx >= this.x0 && ty >= this.y0 && tx < this.x0 + this.w && ty < this.y0 + this.h;
  }

  _idx(tx, ty) {
    return (ty - this.y0) * this.w + (tx - this.x0);
  }

  add(o) {
    if (!o) return o;
    if (this.byId.has(o.id)) {
      let n = 2;
      while (this.byId.has(`${o.id}#${n}`)) n++;
      o.id = `${o.id}#${n}`;
    }
    this.list.push(o);
    this.byId.set(o.id, o);
    for (const [tx, ty] of o.occupiedTiles()) {
      if (!this._in(tx, ty)) continue;
      const i = this._idx(tx, ty);
      (this.tileIndex[i] || (this.tileIndex[i] = [])).push(o);
    }
    o._cell = this._cellOf(o);
    this.cells[o._cell].push(o);
    this.version++;
    return o;
  }

  remove(o) {
    if (!o || !this.byId.has(o.id)) return;
    o.removed = true;
    this.list.splice(this.list.indexOf(o), 1);
    this.byId.delete(o.id);
    for (const [tx, ty] of o.occupiedTiles()) {
      const l = this._in(tx, ty) ? this.tileIndex[this._idx(tx, ty)] : null;
      if (l) {
        const k = l.indexOf(o);
        if (k >= 0) l.splice(k, 1);
      }
    }
    const cell = this.cells[o._cell];
    if (cell) {
      const k = cell.indexOf(o);
      if (k >= 0) cell.splice(k, 1);
    }
    this.removedIds.add(o.id);
    this.version++;
    try {
      this.game?.map?.invalidateTile?.(o.tx, o.ty);
    } catch {
      /* map may not exist yet */
    }
  }

  // Called by objects whose walkability changed.
  changed(o) {
    this.version++;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  all() {
    return this.list;
  }

  // Everything near the player updates every step; the rest of the (wide) world takes
  // turns, an eighth of it a step with eight steps' time, so far timers still run and a
  // step never walks all the world's thousands of trees.
  update(dt) {
    const list = this.list;
    const p = this.game?.player;
    if (!p || list.length < 1500) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        this._updateOne(o, dt);
        // An object may remove itself (the journal); keep the index in step.
        if (list[i] !== o) i--;
      }
      return;
    }
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    const near = this._near || (this._near = []);
    near.length = 0;
    const R = FAR_UPDATE;
    this._eachInRect(p.x - R, p.y - R, p.x + R, p.y + R, (o) => near.push(o));
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      o._updStamp = stamp;
      if (!o.removed) this._updateOne(o, dt);
    }
    const n = list.length;
    const per = Math.ceil(n / FAR_SLICES);
    let c = (this._cursor || 0) % Math.max(1, n);
    for (let k = 0; k < per && n > 0; k++, c = (c + 1) % n) {
      const o = list[c];
      if (!o || o._updStamp === stamp || o.removed) continue;
      this._updateOne(o, dt * FAR_SLICES);
      if (list[c] !== o) c--;
    }
    this._cursor = c;
  }

  _updateOne(o, dt) {
    try {
      o.update(dt);
    } catch (err) {
      o._errors = (o._errors || 0) + 1;
      if (o._errors < 4) console.error('[objects] update failed for', o.id, err);
    }
  }

  // Objects covering a tile (or null). Shared array: do not modify.
  objectsAt(tx, ty) {
    if (!this._in(tx, ty)) return null;
    return this.tileIndex[this._idx(tx, ty)] || null;
  }

  isBlockingTile(tx, ty, actor = null) {
    if (!this._in(tx, ty)) return false;
    const l = this.tileIndex[this._idx(tx, ty)];
    if (!l) return false;
    for (let i = 0; i < l.length; i++) if (l[i].blocksTile(tx, ty, actor)) return true;
    return false;
  }

  doorAt(tx, ty) {
    const l = this.objectsAt(tx, ty);
    if (!l) return null;
    for (let i = 0; i < l.length; i++) if (l[i].objType === 'door') return l[i];
    return null;
  }

  // Visit objects in cells overlapping a pixel rectangle.
  _eachInRect(x0, y0, x1, y1, fn) {
    const span = TILE * CELL;
    const cx0 = Math.max(0, Math.floor(x0 / span) - this.cx0);
    const cy0 = Math.max(0, Math.floor(y0 / span) - this.cy0);
    const cx1 = Math.min(this.cw - 1, Math.floor(x1 / span) - this.cx0);
    const cy1 = Math.min(this.ch - 1, Math.floor(y1 / span) - this.cy0);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = this.cells[cy * this.cw + cx];
        for (let i = 0; i < cell.length; i++) fn(cell[i]);
      }
    }
  }

  inRadius(x, y, r, filter) {
    const out = [];
    const r2 = r * r;
    this._eachInRect(x - r, y - r, x + r, y + r, (o) => {
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy <= r2 && (!filter || filter(o))) out.push(o);
    });
    return out;
  }

  // nearest('tree', x, y, r) or nearest(o => ..., x, y, r)
  nearest(typeOrFilter, x, y, r = Infinity) {
    const f = typeof typeOrFilter === 'function' ? typeOrFilter : (o) => o.objType === typeOrFilter;
    let best = null;
    let bd = r * r;
    const visit = (o) => {
      if (o.removed) return;
      const dx = o.x - x;
      const dy = o.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bd && f(o)) {
        bd = d2;
        best = o;
      }
    };
    if (Number.isFinite(r) && r < 2000) this._eachInRect(x - r, y - r, x + r, y + r, visit);
    else for (let i = 0; i < this.list.length; i++) visit(this.list[i]);
    return best;
  }

  // "door", "chest", "campfire", "bed", "notice board", "home chest"... An exact id or
  // name wins anywhere in the world; otherwise the nearest object of a matching kind.
  findByWord(word, x = 0, y = 0) {
    const w = String(word || '')
      .toLowerCase()
      .replace(/[^a-z0-9_' ]/g, ' ')
      .replace(/\b(the|a|an|that|this|nearest|closest)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!w) return null;
    const snake = w.replace(/ /g, '_');
    const exact = this.byId.get(snake) || this.byId.get(w);
    if (exact && !exact.removed) return exact;
    for (const o of this.list) if (o.name && o.name.toLowerCase() === w && !o.removed && this._uniqueName(o)) return o;
    const types = new Set([w, snake, w.replace(/s$/, ''), snake.replace(/s$/, '')]);
    for (const part of w.split(' ')) for (const t of WORD_ALIASES[part] || []) types.add(t);
    if (WORD_ALIASES[w]) for (const t of WORD_ALIASES[w]) types.add(t);
    // Kind matches beat loose name matches ("gate" means the gate, not the gate pillar).
    const kind = (o) => !o.removed && o.objType !== 'window' && (types.has(o.objType) || !!o.words?.some((k) => k === w || types.has(k)));
    const named = (o) => !o.removed && o.objType !== 'window' && !!o.name && o.name.toLowerCase().includes(w);
    // Nearby first; then anywhere, so "the inn bed" works from across the map.
    return this.nearest(kind, x, y, 900) || this.nearest(named, x, y, 900) || this.nearest(kind, x, y, Infinity) || this.nearest(named, x, y, Infinity);
  }

  _uniqueName(o) {
    let n = 0;
    for (const p of this.list) if (p.name === o.name) if (++n > 1) return false;
    return true;
  }

  inView(x, y, w, h, margin = 48) {
    const out = [];
    const x0 = x - margin;
    const x1 = x + w + margin;
    const y0 = y - margin;
    const y1 = y + h + margin * 2;
    this._eachInRect(x0, y0, x1, y1, (o) => {
      if (o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) out.push(o);
    });
    return out;
  }

  // Only objects that differ from the generated world are saved, plus removed ids.
  serialize() {
    const out = [];
    for (const o of this.list) if (o.dirty || o.objType === 'chest') out.push(o.serialize());
    for (const id of this.removedIds) out.push({ id, removed: true });
    return out;
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    for (const d of list) {
      if (!d || !d.id) continue;
      const o = this.byId.get(d.id);
      if (!o) continue;
      if (d.removed) {
        this.remove(o);
        continue;
      }
      try {
        o.deserialize(d);
      } catch (err) {
        console.error('[objects] could not restore', d.id, err);
      }
      if (o.objType === 'door') o.anim = o.state.open ? 1 : 0;
    }
    refreshAllFences(this); // rails beside a broken fence (DESIGN §31.3)
    this.version++;
    try {
      this.game?.map?.invalidateAll?.();
    } catch {
      /* map may not exist yet */
    }
  }
}
