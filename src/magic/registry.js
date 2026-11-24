// A registry is a plain object of entries keyed by id (SHAPES, ESSENCES, TWISTS, STATUSES)
// plus a lazy normalizer. Adding an entry is one assignment (or one register() call):
// nothing else in the game needs to change, because every system reads entries through
// get(id), which fills defaults the first time an entry is seen.
//
//   const R = defineRegistry('essence', TABLE, (raw, id) => ({ ...defaults, ...raw, id }));
//   R.get('fire') -> normalized entry | null      R.has('fire') -> bool
//   R.ids() -> ['raw', 'fire', ...]               R.register({ id: 'ash', ... })
//
// Normalized entries are cached per raw object, so replacing an entry (TABLE.fire = {...})
// is picked up on the next get().

const own = Object.prototype.hasOwnProperty;

export function defineRegistry(kind, table, fill) {
  const cache = new WeakMap();
  let version = 0;
  const R = {
    kind,
    table,
    get version() {
      return version + Object.keys(table).length;
    },
    has(id) {
      return typeof id === 'string' && own.call(table, id) && !!table[id] && typeof table[id] === 'object';
    },
    get(id) {
      if (!R.has(id)) return null;
      const raw = table[id];
      let n = cache.get(raw);
      if (!n) {
        n = fill(raw, id);
        n.id = id;
        cache.set(raw, n);
      }
      return n;
    },
    ids() {
      const out = [];
      for (const k of Object.keys(table)) if (R.has(k)) out.push(k);
      return out;
    },
    list() {
      return R.ids().map((id) => R.get(id));
    },
    register(entry) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error(`[magic] a ${kind} needs an id`);
      table[entry.id] = entry;
      version++;
      return R.get(entry.id);
    },
    unregister(id) {
      if (own.call(table, id)) {
        delete table[id];
        version++;
      }
    },
  };
  return R;
}

// Multiply a set of named factors into `into` (missing names count as 1).
export function mulInto(into, mods, names) {
  if (!mods) return into;
  for (const k of names) {
    const v = mods[k];
    if (typeof v === 'number' && Number.isFinite(v)) into[k] *= v;
  }
  return into;
}

// ------------------------------------------------------------------ colors

const rgbCache = new Map();

export function hexToRgb(hex) {
  let c = rgbCache.get(hex);
  if (c) return c;
  let s = String(hex || '#ffffff').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  c = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
  if (rgbCache.size > 512) rgbCache.clear();
  rgbCache.set(hex, c);
  return c;
}

export function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Weighted mix of hex colors: mixColors(['#ff0000', '#0000ff'], [2, 1]).
export function mixColors(colors, weights) {
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  for (let i = 0; i < colors.length; i++) {
    const k = weights ? weights[i] ?? 1 : 1;
    const c = hexToRgb(colors[i]);
    r += c[0] * k;
    g += c[1] * k;
    b += c[2] * k;
    w += k;
  }
  if (w <= 0) return '#ffffff';
  return rgbToHex(r / w, g / w, b / w);
}

export function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
