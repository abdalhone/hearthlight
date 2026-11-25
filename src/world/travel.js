import { TILE } from '../core/constants.js';
import { inVale } from './wilds_layout.js';
import { onTrailEvent, checkSight } from './boss_trails.js';

// Travel in the wider world (DESIGN §32): what you have walked (the map's fog), the
// places you reach for the first time, the weather a place keeps for itself (snow on
// the Hollowcrown, the grey that never lifted from Brindlecombe), the bosses you have
// heard of (their markers on the map, DESIGN §32.4), and where you are for Claude.
//
// game.travel = new Travel(game); travelPlugin saves it with the plugins.
//   explored(cx, cy)        has the player seen this map cell (CELL tiles square)?
//   hear(bossId, from)      a boss is now known: it gets its marker
//   known(bossId)           heard of?
//   marks()                 [{ kind, id, x, y, label }] for the map (bosses, places)
// Bus events out: place_reached { id, name, first }, boss_heard { id, from }.

export const CELL = 8; // tiles per fog cell
const SEE = 13; // tiles you can see around you, for the fog
const POLL = 0.4; // seconds between position checks

export class Travel {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.pollT = 0;
    this.heard = {}; // bossId -> { from, day }
    this.reached = {}; // location id -> day first reached
    this.lastPlace = null;
    this._alloc();
  }

  _alloc() {
    const m = this.game.map;
    this.x0 = m ? Math.floor(m.x0 / CELL) : 0;
    this.y0 = m ? Math.floor(m.y0 / CELL) : 0;
    this.cw = m ? Math.ceil((m.x0 + m.w) / CELL) - this.x0 : 1;
    this.ch = m ? Math.ceil((m.y0 + m.h) / CELL) - this.y0 : 1;
    this.fog = new Uint8Array(this.cw * this.ch);
    this._mapFor = m || null;
    // The vale is known from the start: you have lived in it for six days.
    if (m) for (let cy = 0; cy < 120 / CELL; cy++) for (let cx = 0; cx < 160 / CELL; cx++) this._see(cx, cy);
  }

  _see(cx, cy) {
    const i = (cy - this.y0) * this.cw + (cx - this.x0);
    if (i >= 0 && i < this.fog.length && cx >= this.x0 && cx < this.x0 + this.cw) this.fog[i] = 1;
  }

  explored(cx, cy) {
    if (cx < this.x0 || cy < this.y0 || cx >= this.x0 + this.cw || cy >= this.y0 + this.ch) return false;
    return this.fog[(cy - this.y0) * this.cw + (cx - this.x0)] === 1;
  }

  // Seen the tile at (tx, ty)?
  seenTile(tx, ty) {
    return this.explored(Math.floor(tx / CELL), Math.floor(ty / CELL));
  }

  update(dt) {
    const g = this.game;
    if (g.map && g.map !== this._mapFor) this._alloc();
    this.t += dt;
    this.pollT -= dt;
    if (this.pollT > 0) return;
    this.pollT = POLL;
    const p = g.player;
    if (!p || !g.map) return;
    const tx = p.x / TILE;
    const ty = p.y / TILE;
    const r = SEE / CELL;
    const cx = tx / CELL;
    const cy = ty / CELL;
    for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) this._see(x, y);
    this._arrive(p);
    this._weather(p);
    checkSight(g);
  }

  // First steps into a place of the wider world: a quiet line, once.
  _arrive(p) {
    const g = this.game;
    const loc = g.locations?.at?.(p.x, p.y);
    const id = loc?.id || null;
    if (id === this.lastPlace) return;
    this.lastPlace = id;
    if (!loc || !loc.wilds) return;
    const first = !this.reached[loc.id];
    if (first) this.reached[loc.id] = g.clock?.day ?? 1;
    g.bus?.emit?.('place_reached', { id: loc.id, name: loc.name, first });
    if (first && loc.kind !== 'building') {
      try {
        g.ui?.toast?.(`${loc.name}. ${firstSentence(loc.description)}`, 'info');
      } catch {
        /* the ui is optional */
      }
    }
  }

  // A place's own weather: the grey over Brindlecombe, snow on the Hollowcrown.
  _weather(p) {
    const w = this.game.weather;
    if (!w) return;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    const region = inVale(tx, ty) ? null : this.game.map?.regionAt?.(tx, ty);
    w.localFog = region === 'grey' ? 1 : 0;
    w.localSnow = region === 'snow' ? 1 : region === 'foothill' && ty < -120 ? 0.4 : 0;
  }

  // ------------------------------------------------------------------ bosses

  hear(bossId, from = 'rumor') {
    if (!bossId) return false;
    if (this.heard[bossId]) return false;
    this.heard[bossId] = { from: String(from || 'rumor'), day: this.game.clock?.day ?? 1 };
    this.game.bus?.emit?.('boss_heard', { id: bossId, from });
    return true;
  }

  known(bossId) {
    return !!this.heard[bossId];
  }

  // ------------------------------------------------------------------ map marks

  marks() {
    const g = this.game;
    const out = [];
    const places = g.map?.places || {};
    for (const [id, pt] of Object.entries(places)) {
      const loc = g.locations?.get?.(id);
      out.push({ kind: 'place', id, x: pt.x, y: pt.y, label: loc?.name || null });
    }
    for (const s of g.map?.safeSpots || []) out.push({ kind: 'waystone', id: s.id, x: s.x, y: s.y, label: null });
    return out;
  }

  // ------------------------------------------------------------------ save

  serialize() {
    return { fog: packBits(this.fog), cw: this.cw, ch: this.ch, heard: { ...this.heard }, reached: { ...this.reached } };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (d.fog && d.cw === this.cw && d.ch === this.ch) {
      const bits = unpackBits(d.fog, this.fog.length);
      for (let i = 0; i < bits.length; i++) if (bits[i]) this.fog[i] = 1;
    }
    if (d.heard && typeof d.heard === 'object') this.heard = { ...d.heard };
    if (d.reached && typeof d.reached === 'object') this.reached = { ...d.reached };
  }

  // Where the stranger is, for Claude's prompt (only out in the wider world).
  promptContext() {
    const g = this.game;
    const p = g.player;
    if (!p) return '';
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (inVale(tx, ty)) return '';
    const loc = g.locations?.at?.(p.x, p.y);
    const home = g.locations?.get?.('town_square')?.center;
    const far = home ? Math.round(Math.hypot(p.x - home.x, p.y - home.y) / TILE / 4.75) : null;
    const where = loc ? `${loc.name}: ${loc.description}` : 'out in the wilds';
    return `Out beyond the vale, on foot. ${where}${far != null ? ` About ${far} seconds' hard walking from the square (call it ${far < 60 ? 'an hour' : 'half a day'} in the world's time).` : ''}`;
  }
}

function firstSentence(s) {
  const m = String(s || '').match(/^[^.!?]*[.!?]/);
  return m ? m[0] : String(s || '');
}

// Bits to a compact base64 string (saves stay small) and back.
export function packBits(arr) {
  const bytes = new Uint8Array(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

export function unpackBits(str, n) {
  const out = new Uint8Array(n);
  let s = '';
  try {
    s = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  } catch {
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

export function ensureTravel(game) {
  if (!game) return null;
  if (!(game.travel instanceof Travel)) game.travel = new Travel(game);
  return game.travel;
}

export const travelPlugin = {
  id: 'travel',
  name: 'Travel',
  description: 'The wider world on foot: the map, places reached, bosses heard of.',
  install(ctx) {
    const t = ensureTravel(ctx.game);
    if (t && this._pending !== undefined) {
      t.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx.game?.travel?.update(dt);
  },
  onEvent(type, p, ctx) {
    onTrailEvent(ctx.game, type, p);
  },
  serialize(ctx) {
    return ctx.game?.travel?.serialize() ?? null;
  },
  deserialize(d, ctx) {
    const t = ctx.game?.travel;
    if (t) t.deserialize(d);
    else this._pending = d;
  },
  promptContext(ctx) {
    return ctx.game?.travel?.promptContext?.() || '';
  },
};
