// Who saw whom, where and when (DESIGN §28 "Sightings"): every villager's, Lyra's and the
// player's own last sighting of every other person, from their own eyes as they move about.
// This is all anyone in Hearthvale actually knows about where someone is: an asked villager
// answers from it, the watch rebuilds a missing person's last day from it, and (DESIGN §29)
// it is who was last seen with whom.
//
// Cheap by design: a 21×21 table in typed arrays, refreshed by one sweep every half a
// second (positions and buildings looked up once per person per sweep), no allocation in
// the sweep. Seeing needs the same space (both outdoors, or under the same roof), range
// (less at night, much less for nearly blind Wenna), and the seer awake and on their feet.

import { TILE, DAY_SECONDS } from '../../core/constants.js';

const NONE = -1;
const OUT_RANGE = 150; // px outdoors by day
const NIGHT_RANGE = 88; // px outdoors at night (lamps and lanterns do the rest)
const ROOM_RANGE = 240; // px under the same roof: a room is seen whole
const BLIND_RANGE = 44; // Wenna knows people by their step, close by
const WITH_RANGE = 40; // px: two people this close are "together"
const KEEP_DAYS = 4; // sightings older than this are not saved

export class Sightings {
  // ids: who sees and is seen (villagers, 'lyra', 'player').
  constructor(game, ids, { blind = ['wenna'] } = {}) {
    this.game = game;
    this.ids = ids.slice();
    this.n = this.ids.length;
    this.idx = new Map(this.ids.map((id, i) => [id, i]));
    const nn = this.n * this.n;
    this.T = new Float64Array(nn).fill(NONE);
    this.X = new Float32Array(nn);
    this.Y = new Float32Array(nn);
    this.P = new Int16Array(nn).fill(NONE); // place index
    this.W = new Int16Array(nn).fill(NONE); // who they were with (index into ids)
    this.H = new Int16Array(nn).fill(NONE); // where they were heading (place index), when noted
    this.places = [];
    this.placeIdx = new Map();
    this.blind = new Set(blind);
    // Per-sweep scratch (one slot per person).
    this._ent = new Array(this.n).fill(null);
    this._bld = new Int32Array(this.n);
    this._loc = new Int16Array(this.n);
    this._sees = new Uint8Array(this.n);
    this._seen = new Uint8Array(this.n);
    this._with1 = new Int16Array(this.n);
    this._with2 = new Int16Array(this.n);
    this._bldIds = new Map();
    this.sweeps = 0;
    this.onBody = null; // (seerId, deadId, placeId) when someone comes on a body
    this.onSeen = null; // (seerId, targetId) for each fresh sighting, when set (cheap filter in the caller)
  }

  placeIndex(id) {
    if (!id) return NONE;
    let i = this.placeIdx.get(id);
    if (i === undefined) {
      i = this.places.length;
      this.places.push(id);
      this.placeIdx.set(id, i);
    }
    return i;
  }

  entity(id) {
    const g = this.game;
    if (id === 'player') return g?.player || null;
    if (id === 'lyra') return g?.companion || null;
    try {
      return g?.entities?.get?.(id) || null;
    } catch {
      return null;
    }
  }

  // One look around for everyone. Returns how many fresh sightings it recorded.
  sweep() {
    const g = this.game;
    const n = this.n;
    const t = g?.clock?.t ?? 0;
    const night = !!g?.clock?.isNight;
    const fog = g?.clock?.weather?.type === 'fog';
    const outRange = night ? NIGHT_RANGE : fog ? NIGHT_RANGE + 20 : OUT_RANGE;
    const map = g?.map;
    const locs = g?.locations;
    let fresh = 0;
    this.sweeps++;
    for (let i = 0; i < n; i++) {
      const e = this.entity(this.ids[i]);
      this._ent[i] = e;
      this._sees[i] = 0;
      this._seen[i] = 0;
      this._with1[i] = NONE;
      this._with2[i] = NONE;
      if (!e || e.removed || e.hidden) continue;
      const alive = typeof e.isAlive === 'function' ? e.isAlive() : !e.dead;
      const body = !!e.dead;
      if (!alive && !body) continue;
      this._seen[i] = alive ? 1 : 2; // 2: a body
      if (alive && e.state !== 'sleep' && !e.downed) this._sees[i] = 1;
      let b = 0;
      if (map?.buildingAt) {
        try {
          const bd = map.buildingAt(Math.floor(e.x / TILE), Math.floor(e.y / TILE));
          if (bd) {
            const key = bd.id ?? bd;
            let k = this._bldIds.get(key);
            if (k === undefined) {
              k = this._bldIds.size + 1;
              this._bldIds.set(key, k);
            }
            b = k;
          }
        } catch {
          b = 0;
        }
      }
      this._bld[i] = b;
      let li = NONE;
      if (locs?.at) {
        try {
          li = this.placeIndex(locs.at(e.x, e.y)?.id || null);
        } catch {
          li = NONE;
        }
      }
      this._loc[i] = li;
    }
    // Who each person is with: the two nearest others, close by.
    const w2 = WITH_RANGE * WITH_RANGE;
    for (let i = 0; i < n; i++) {
      if (this._seen[i] !== 1) continue;
      const a = this._ent[i];
      let b1 = NONE;
      let d1 = w2;
      let b2 = NONE;
      let d2 = w2;
      for (let j = 0; j < n; j++) {
        if (j === i || this._seen[j] !== 1) continue;
        const e = this._ent[j];
        const dx = e.x - a.x;
        const dy = e.y - a.y;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          b2 = b1;
          d2 = d1;
          b1 = j;
          d1 = d;
        } else if (d < d2) {
          b2 = j;
          d2 = d;
        }
      }
      this._with1[i] = b1;
      this._with2[i] = b2;
    }
    for (let i = 0; i < n; i++) {
      if (!this._sees[i]) continue;
      const a = this._ent[i];
      const blind = this.blind.has(this.ids[i]);
      for (let j = 0; j < n; j++) {
        if (j === i || !this._seen[j]) continue;
        const e = this._ent[j];
        const same = this._bld[i] === this._bld[j];
        if (!same) continue;
        const r = blind ? BLIND_RANGE : this._bld[i] ? ROOM_RANGE : outRange;
        const dx = e.x - a.x;
        const dy = e.y - a.y;
        if (dx * dx + dy * dy > r * r) continue;
        if (this._seen[j] === 2) {
          if (this.onBody) this.onBody(this.ids[i], this.ids[j], this.places[this._loc[j]] || null);
          continue;
        }
        const k = i * n + j;
        this.T[k] = t;
        this.X[k] = e.x;
        this.Y[k] = e.y;
        this.P[k] = this._loc[j];
        const w = this._with1[j] !== i ? this._with1[j] : this._with2[j];
        this.W[k] = w;
        this.H[k] = NONE;
        fresh++;
        if (this.onSeen) this.onSeen(this.ids[i], this.ids[j]);
      }
    }
    return fresh;
  }

  // What `obs` knows of where `target` was: { t, day, place, x, y, with, heading } or null.
  lastSeen(obs, target) {
    const i = this.idx.get(obs);
    const j = this.idx.get(target);
    if (i === undefined || j === undefined || i === j) return null;
    const k = i * this.n + j;
    const t = this.T[k];
    if (t < 0) return null;
    return {
      t,
      day: Math.floor(t / DAY_SECONDS) + 1,
      place: this.places[this.P[k]] || null,
      x: this.X[k],
      y: this.Y[k],
      with: this.W[k] >= 0 ? this.ids[this.W[k]] : null,
      heading: this.H[k] >= 0 ? this.places[this.H[k]] : null,
    };
  }

  // The time of obs's last sighting of target (-1 for never).
  lastT(obs, target) {
    const i = this.idx.get(obs);
    const j = this.idx.get(target);
    if (i === undefined || j === undefined) return NONE;
    return this.T[i * this.n + j];
  }

  // A sighting from outside the sweep (someone saw a person set off somewhere).
  note(obs, target, { t, x = 0, y = 0, place = null, with: w = null, heading = null } = {}) {
    const i = this.idx.get(obs);
    const j = this.idx.get(target);
    if (i === undefined || j === undefined || i === j) return false;
    const k = i * this.n + j;
    this.T[k] = Number.isFinite(t) ? t : this.game?.clock?.t ?? 0;
    this.X[k] = x;
    this.Y[k] = y;
    this.P[k] = this.placeIndex(place);
    this.W[k] = w != null && this.idx.has(w) ? this.idx.get(w) : NONE;
    this.H[k] = this.placeIndex(heading);
    return true;
  }

  // Everyone's last sighting of target, freshest first: [{ by, t, place, with, heading }].
  sightingsOf(target, { since = -Infinity } = {}) {
    const j = this.idx.get(target);
    if (j === undefined) return [];
    const out = [];
    for (let i = 0; i < this.n; i++) {
      if (i === j) continue;
      const k = i * this.n + j;
      const t = this.T[k];
      if (t < 0 || t < since) continue;
      out.push({ by: this.ids[i], t, place: this.places[this.P[k]] || null, with: this.W[k] >= 0 ? this.ids[this.W[k]] : null, heading: this.H[k] >= 0 ? this.places[this.H[k]] : null });
    }
    out.sort((a, b) => b.t - a.t);
    return out;
  }

  // Can a see b right now (same rule as the sweep)?
  canSee(a, b) {
    const g = this.game;
    if (!a || !b || a === b) return false;
    const night = !!g?.clock?.isNight;
    let ba = null;
    let bb = null;
    try {
      ba = g?.map?.buildingAt?.(Math.floor(a.x / TILE), Math.floor(a.y / TILE)) || null;
      bb = g?.map?.buildingAt?.(Math.floor(b.x / TILE), Math.floor(b.y / TILE)) || null;
    } catch {
      ba = bb = null;
    }
    if ((ba?.id ?? ba) !== (bb?.id ?? bb)) return false;
    const r = this.blind.has(a.id) ? BLIND_RANGE : ba ? ROOM_RANGE : night ? NIGHT_RANGE : OUT_RANGE;
    return Math.hypot(a.x - b.x, a.y - b.y) <= r;
  }

  serialize() {
    const now = this.game?.clock?.t ?? 0;
    const rows = {};
    for (let i = 0; i < this.n; i++) {
      const row = {};
      let any = false;
      for (let j = 0; j < this.n; j++) {
        const k = i * this.n + j;
        const t = this.T[k];
        if (t < 0 || now - t > KEEP_DAYS * DAY_SECONDS) continue;
        row[this.ids[j]] = [Math.round(t), Math.round(this.X[k]), Math.round(this.Y[k]), this.places[this.P[k]] || 0, this.W[k] >= 0 ? this.ids[this.W[k]] : 0, this.H[k] >= 0 ? this.places[this.H[k]] : 0];
        any = true;
      }
      if (any) rows[this.ids[i]] = row;
    }
    return { v: 1, rows };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object' || !d.rows) return;
    for (const [obs, row] of Object.entries(d.rows)) {
      if (!this.idx.has(obs) || !row || typeof row !== 'object') continue;
      for (const [target, v] of Object.entries(row)) {
        if (!Array.isArray(v) || !Number.isFinite(v[0])) continue;
        this.note(obs, target, { t: v[0], x: Number(v[1]) || 0, y: Number(v[2]) || 0, place: typeof v[3] === 'string' ? v[3] : null, with: typeof v[4] === 'string' ? v[4] : null, heading: typeof v[5] === 'string' ? v[5] : null });
      }
    }
  }
}
