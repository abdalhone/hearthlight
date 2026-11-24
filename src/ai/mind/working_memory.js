import { clamp01 } from './text.js';

// mind.workingMemory (DESIGN §17.2): what is on her mind right now. At most 12 items,
// each with an activation that fades (half-life about two minutes of play) unless
// something keeps it alive: entering a place, seeing a face, holding an item, a topic in
// conversation. Items are entities ('place:mirror_lake', 'person:bram', 'item:moonpetal')
// or records from her stores ('episode:m12', 'life:cal_dies', 'knowledge:k4').
//   item = { key, store: 'entity'|'episode'|'life'|'knowledge'|'person', id, label,
//            activation 0..1, t (when last refreshed), source }

export const WM_LIMITS = Object.freeze({ max: 12, halfLife: 120, floor: 0.06 });

export class WorkingMemory {
  constructor({ max = WM_LIMITS.max, halfLife = WM_LIMITS.halfLife, now = () => 0 } = {}) {
    this.max = max;
    this.halfLife = halfLife;
    this.now = now;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  get(key) {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].key === key) return this.items[i];
    return null;
  }

  has(key) {
    return !!this.get(key);
  }

  activationOf(key) {
    const it = this.get(key);
    return it ? it.activation : 0;
  }

  // Bring something to mind (or keep it there). Activation saturates instead of adding up,
  // so a face seen every two seconds stays warm without crowding out everything else.
  activate(key, { label = null, store = 'entity', id = null, amount = 0.6, source = 'perception' } = {}) {
    if (!key) return null;
    const a = clamp01(amount);
    let it = this.get(key);
    if (it) {
      it.activation = clamp01(Math.max(it.activation, a) + a * 0.15 * (1 - it.activation));
      it.t = this.now();
      it.source = source || it.source;
      if (label) it.label = label;
      return it;
    }
    it = { key, store, id: id ?? key.replace(/^[a-z]+:/, ''), label: label || key, activation: a, t: this.now(), source };
    this.items.push(it);
    if (this.items.length > this.max) {
      this.items.sort((x, y) => y.activation - x.activation);
      this.items.length = this.max;
    }
    return it;
  }

  // dt: seconds of play. Allocation-free unless something actually drops out.
  decay(dt) {
    if (!(dt > 0) || !this.items.length) return;
    const k = Math.pow(0.5, dt / this.halfLife);
    let drop = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.activation *= k;
      if (it.activation < WM_LIMITS.floor) drop = true;
    }
    if (drop) this.items = this.items.filter((it) => it.activation >= WM_LIMITS.floor);
  }

  remove(key) {
    const i = this.items.findIndex((it) => it.key === key);
    if (i >= 0) this.items.splice(i, 1);
  }

  // Most active first.
  list(n = this.max) {
    return [...this.items].sort((a, b) => b.activation - a.activation).slice(0, n);
  }

  clear() {
    this.items.length = 0;
  }

  serialize() {
    return this.items.map((it) => ({ key: it.key, store: it.store, id: it.id, label: it.label, a: Math.round(it.activation * 100) / 100, source: it.source }));
  }

  deserialize(d) {
    this.items = [];
    if (!Array.isArray(d)) return;
    for (const x of d.slice(0, this.max)) {
      if (!x || !x.key) continue;
      this.items.push({ key: String(x.key), store: x.store || 'entity', id: x.id ?? null, label: String(x.label || x.key), activation: clamp01(Number(x.a) || 0.1), t: this.now(), source: x.source || 'perception' });
    }
  }
}
