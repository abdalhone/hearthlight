import { TILE } from '../core/constants.js';
import { SOLID, WATERY, COST } from './tiles.js';

// A* over the tile grid.
// Contract: new Pathfinder(game); find(sx, sy, gx, gy, opts) -> [{x, y}] pixel waypoints
// (tile centers, the last one is the goal) or null when unreachable.
// opts: { maxNodes = 6000, allowDoors = true, actor }
//  - 8-way movement without corner cutting.
//  - Closed unlocked doors are passable at an extra cost (the walker opens them);
//    locked doors only when `actor` carries the key. allowDoors:false treats closed
//    doors as walls.
//  - Roads are slightly cheaper than grass, so villagers keep to the streets.
//  - The raw path is smoothed with line-of-walk checks; door tiles always stay as
//    waypoints so walkers line up with doorways.
// All buffers are typed arrays allocated once and reused between searches.

const SQRT2 = Math.SQRT2;
const DOOR_COST = 4;
const CACHE_TTL = 1; // seconds
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class Pathfinder {
  constructor(game) {
    this.game = game;
    this._alloc();
    this.cache = new Map();
    this.lastExpanded = 0;
  }

  get map() {
    return this.game.map;
  }

  _alloc() {
    const m = this.game.map;
    this.w = m.w;
    this.h = m.h;
    const n = m.w * m.h;
    this.n = n;
    this.gScore = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n); // generation stamp: g/parent valid
    this.closed = new Uint32Array(n);
    this.gen = 0;
    // Binary heap with lazy deletion (duplicates allowed).
    this.heapCap = n * 4;
    this.heapNode = new Int32Array(this.heapCap);
    this.heapF = new Float32Array(this.heapCap);
    this.heapSize = 0;
    // Static terrain: 0 walkable, 1 solid, 2 water (flyers only).
    this.terrain = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.mapVersion = -1;
    this.tileBuf = new Int32Array(n);
  }

  _syncTerrain() {
    const m = this.game.map;
    if (m.w !== this.w || m.h !== this.h) this._alloc();
    if (this.mapVersion === m.version) return;
    const g = m.ground;
    for (let i = 0; i < this.n; i++) {
      const id = g[i];
      this.terrain[i] = WATERY[id] ? 2 : SOLID[id] ? 1 : 0;
      this.cost[i] = COST[id] || 1;
    }
    this.mapVersion = m.version;
    this.cache.clear();
  }

  // Cost to step onto tile i (multiplier), or -1 when it cannot be entered.
  _enter(i, tx, ty, actor, flying, allowDoors) {
    const t = this.terrain[i];
    if (t === 1 || (t === 2 && !flying)) return -1;
    let c = this.cost[i];
    const list = this.game.objects?.tileIndex?.[i];
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const o = list[k];
        if (o.objType === 'door') {
          if (o.state.open) continue;
          if (o.state.locked && !(o.state.keyId && actor?.inventory?.has?.(o.state.keyId))) return -1;
          if (!allowDoors) return -1;
          c += DOOR_COST;
        } else if (o.blocksTile(tx, ty, actor)) return -1;
      }
    }
    return c;
  }

  // Is the tile walkable for this actor right now (closed unlocked doors count as walkable)?
  isWalkable(tx, ty, actor = null, allowDoors = true) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    this._syncTerrain();
    return this._enter(ty * this.w + tx, tx, ty, actor, !!actor?.flying, allowDoors) >= 0;
  }

  // Nearest walkable tile center to a pixel point (spiral search), or null.
  nearestWalkable(px, py, actor = null, radius = 6) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (this.isWalkable(tx, ty, actor)) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
    let best = null;
    let bd = Infinity;
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isWalkable(tx + dx, ty + dy, actor)) continue;
          const cx = (tx + dx) * TILE + TILE / 2;
          const cy = (ty + dy) * TILE + TILE / 2;
          const d = (cx - px) ** 2 + (cy - py) ** 2;
          if (d < bd) (bd = d), (best = { x: cx, y: cy });
        }
      }
      if (best) return best;
    }
    return null;
  }

  _push(node, f) {
    let i = this.heapSize++;
    if (i >= this.heapCap) {
      // Extremely rare: grow instead of failing.
      const nn = new Int32Array(this.heapCap * 2);
      const nf = new Float32Array(this.heapCap * 2);
      nn.set(this.heapNode);
      nf.set(this.heapF);
      this.heapNode = nn;
      this.heapF = nf;
      this.heapCap *= 2;
    }
    const hn = this.heapNode;
    const hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hn[i] = hn[p];
      hf[i] = hf[p];
      i = p;
    }
    hn[i] = node;
    hf[i] = f;
  }

  _pop() {
    const hn = this.heapNode;
    const hf = this.heapF;
    const top = hn[0];
    const n = --this.heapSize;
    if (n > 0) {
      const node = hn[n];
      const f = hf[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hn[i] = hn[c];
        hf[i] = hf[c];
        i = c;
      }
      hn[i] = node;
      hf[i] = f;
    }
    return top;
  }

  find(sx, sy, gx, gy, opts = {}) {
    const map = this.game.map;
    if (!map || !Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(gx) || !Number.isFinite(gy)) return null;
    this._syncTerrain();
    const maxNodes = opts.maxNodes ?? 6000;
    const allowDoors = opts.allowDoors ?? true;
    const actor = opts.actor || null;
    const flying = !!actor?.flying;
    const W = this.w;
    const H = this.h;
    const stx = Math.max(0, Math.min(W - 1, Math.floor(sx / TILE)));
    const sty = Math.max(0, Math.min(H - 1, Math.floor(sy / TILE)));
    let gtx = Math.floor(gx / TILE);
    let gty = Math.floor(gy / TILE);
    let exactGoal = true;
    if (gtx < 0 || gty < 0 || gtx >= W || gty >= H) return null;

    // Goal inside something solid (a tree to chop, a bed): settle for the nearest
    // walkable neighbour, preferring the side facing the start.
    if (this._enter(gty * W + gtx, gtx, gty, actor, flying, allowDoors) < 0) {
      let best = -1;
      let bd = Infinity;
      for (let r = 1; r <= 2 && best < 0; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = gtx + dx;
            const y = gty + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            if (this._enter(y * W + x, x, y, actor, flying, allowDoors) < 0) continue;
            const d = Math.hypot(dx, dy) * 4 + Math.hypot(x - stx, y - sty) * 0.05;
            if (d < bd) (bd = d), (best = y * W + x);
          }
        }
      }
      if (best < 0) return null;
      gtx = best % W;
      gty = (best / W) | 0;
      exactGoal = false;
    }

    const start = sty * W + stx;
    const goal = gty * W + gtx;
    const goalPoint = exactGoal ? { x: gx, y: gy } : { x: gtx * TILE + TILE / 2, y: gty * TILE + TILE / 2 };
    if (start === goal) return [goalPoint];

    const now = this.game.time ?? 0;
    const key = `${start}|${goal}|${flying ? 1 : 0}${allowDoors ? 1 : 0}|${actor?.id ?? ''}|${this.game.objects?.version ?? 0}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.t < CACHE_TTL) return hit.path ? hit.path.map((p, i, a) => (i === a.length - 1 ? { x: goalPoint.x, y: goalPoint.y } : { x: p.x, y: p.y })) : null;

    const gen = ++this.gen;
    if (gen === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const G = this.gScore;
    const P = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    this.heapSize = 0;
    const hfun = (x, y) => {
      const dx = Math.abs(x - gtx);
      const dy = Math.abs(y - gty);
      return (dx > dy ? dx - dy + dy * SQRT2 : dy - dx + dx * SQRT2) * 0.95;
    };
    G[start] = 0;
    P[start] = -1;
    seen[start] = this.gen;
    this._push(start, hfun(stx, sty));
    let expanded = 0;
    let found = false;
    const pass = new Float32Array(8); // reused per expansion below
    while (this.heapSize > 0) {
      const cur = this._pop();
      if (closed[cur] === this.gen) continue;
      closed[cur] = this.gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const gc = G[cur];
      // Orthogonal neighbours first; diagonals need both adjacent orthogonals open.
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          pass[d] = -1;
          continue;
        }
        const ni = ny * W + nx;
        if (d >= 4) {
          const ox = d === 4 || d === 5 ? 0 : 1; // index of the x-orthogonal (0: +x, 1: -x)
          const oy = d === 4 || d === 6 ? 2 : 3; // index of the y-orthogonal (2: +y, 3: -y)
          if (pass[ox] < 0 || pass[oy] < 0) {
            pass[d] = -1;
            continue;
          }
        }
        const c = ni === goal ? Math.max(0.5, this._enter(ni, nx, ny, actor, flying, allowDoors)) : this._enter(ni, nx, ny, actor, flying, allowDoors);
        pass[d] = c;
        if (c < 0 || closed[ni] === this.gen) continue;
        const ng = gc + c * (d >= 4 ? SQRT2 : 1);
        if (seen[ni] !== this.gen || ng < G[ni]) {
          seen[ni] = this.gen;
          G[ni] = ng;
          P[ni] = cur;
          this._push(ni, ng + hfun(nx, ny));
        }
      }
    }
    this.lastExpanded = expanded;
    if (!found) {
      this._remember(key, now, null);
      return null;
    }

    // Walk back to a tile list (start excluded).
    const buf = this.tileBuf;
    let len = 0;
    for (let i = goal; i !== start && i >= 0; i = P[i]) buf[len++] = i;
    const tiles = new Array(len);
    for (let k = 0; k < len; k++) tiles[k] = buf[len - 1 - k];
    const path = this._smooth(start, tiles, actor, flying, allowDoors);
    const out = path.map((i) => ({ x: (i % W) * TILE + TILE / 2, y: ((i / W) | 0) * TILE + TILE / 2 }));
    out[out.length - 1] = goalPoint;
    this._remember(key, now, out);
    return out.map((p) => ({ x: p.x, y: p.y }));
  }

  _remember(key, t, path) {
    if (this.cache.size > 96) {
      for (const [k, v] of this.cache) if (t - v.t >= CACHE_TTL) this.cache.delete(k);
      if (this.cache.size > 96) this.cache.clear();
    }
    this.cache.set(key, { t, path });
  }

  // Greedy line-of-walk smoothing. Doors are anchors: a waypoint always lands on them.
  _smooth(start, tiles, actor, flying, allowDoors) {
    if (tiles.length <= 1) return tiles;
    const W = this.w;
    const isDoor = (i) => {
      const l = this.game.objects?.tileIndex?.[i];
      if (!l) return false;
      for (const o of l) if (o.objType === 'door') return true;
      return false;
    };
    const out = [];
    let from = start;
    let k = 0;
    while (k < tiles.length) {
      // Find the farthest tile visible from `from`, stopping at the next door anchor.
      let reach = k;
      for (let j = k; j < tiles.length; j++) {
        if (j > k && !this._lineWalkable(from, tiles[j], actor, flying, allowDoors)) break;
        reach = j;
        if (isDoor(tiles[j])) break;
      }
      out.push(tiles[reach]);
      from = tiles[reach];
      k = reach + 1;
    }
    if (out[out.length - 1] !== tiles[tiles.length - 1]) out.push(tiles[tiles.length - 1]);
    return out;
  }

  // Can a walker's feet box travel straight between two tile centers?
  _lineWalkable(a, b, actor, flying, allowDoors) {
    const W = this.w;
    const ax = (a % W) * TILE + 8;
    const ay = ((a / W) | 0) * TILE + 8;
    const bx = (b % W) * TILE + 8;
    const by = ((b / W) | 0) * TILE + 8;
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 4));
    const r = 6;
    let lastTile = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      // Check the four corners of the feet box (same proportions as EntityManager.blockedAt).
      for (let c = 0; c < 4; c++) {
        const qx = px + (c & 1 ? r : -r);
        const qy = py + (c & 2 ? r * 0.4 : -r * 0.6);
        const tx = Math.floor(qx / TILE);
        const ty = Math.floor(qy / TILE);
        if (tx < 0 || ty < 0 || tx >= W || ty >= this.h) return false;
        const i = ty * W + tx;
        if (i === lastTile) continue;
        if (this._enter(i, tx, ty, actor, flying, allowDoors) < 0) return false;
        // Never cut across a door tile that is not an endpoint.
        if (i !== a && i !== b) {
          const l = this.game.objects?.tileIndex?.[i];
          if (l) for (const o of l) if (o.objType === 'door') return false;
        }
      }
      lastTile = -1;
    }
    return true;
  }
}
