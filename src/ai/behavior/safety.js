import { TILE } from '../../core/constants.js';
import { isFriend, isThreat, isInnocent } from './combat_ai.js';
import { clamp, dist, tileOf, tileCenter, walkable, nearestWalkable, isActorAlive, clearShot, safe } from './util.js';

// Self-preservation (DESIGN §16.5): how dangerous a place is to her right now and
// where her own limit lies, where safety is when she has to run, the doorway to wait
// at instead of going in, whether a fight still looks winnable, the King's Road exit
// when she leaves for good, and staying out of the player's sword arc.

export const LOW_HP_DISENGAGE = 0.3; // below this, in a fight, she gets out
export const DISENGAGE_RECOVER = 0.45; // ...until she is back above this
export const LOVED_AFFINITY = 70; // someone she would stay and cover
const SAFE_LOCATIONS = ['guardhouse', 'ember_kettle', 'chapel'];
const WILD_KINDS = new Set(['forest', 'ruins', 'camp', 'lake', 'field', 'road', 'area']);

// --- what she knows about the player ---

export function relToPlayer(game) {
  const rels = game?.companion?.mind?.relationships;
  if (!rels || typeof rels.get !== 'function') return null;
  return safe('relationships.get', () => rels.get('player') || null, null);
}

export function companionshipOf(game) {
  const m = game?.companion?.mind;
  const s = m?.companionship ?? m?.autonomy?.companionship;
  return typeof s === 'string' ? s : 'together';
}

// True while she travels with the player by choice (together or wary).
export function isTogether(game) {
  const s = companionshipOf(game);
  return s === 'together' || s === 'wary';
}

export function emotion(game, name) {
  const v = game?.companion?.mind?.emotions?.[name];
  return Number.isFinite(v) ? v : 0;
}

export function need(game, name) {
  const v = game?.companion?.mind?.needs?.[name];
  return Number.isFinite(v) ? v : 1;
}

// --- places ---

export function inBounds(loc, x, y, pad = 0) {
  const b = loc?.bounds;
  if (!b) return false;
  const tx = x / TILE;
  const ty = y / TILE;
  return tx >= b.x - pad && ty >= b.y - pad && tx < b.x + b.w + pad && ty < b.y + b.h + pad;
}

export function placeAt(game, x, y) {
  return safe('locations.at', () => game.locations?.at?.(x, y) || null, null);
}

// The location (by id or object) as a location object, or null.
export function asLocation(game, ref) {
  if (!ref) return null;
  if (typeof ref === 'object' && ref.bounds) return ref;
  return safe('locations.get', () => game.locations?.get?.(String(ref)) || game.locations?.find?.(String(ref)) || null, null);
}

// The dangerous place that contains (x, y): the innermost one, or its parent when
// the parent is the more dangerous of the two (a glade inside the forest).
export function dangerousPlaceAt(game, x, y) {
  const loc = placeAt(game, x, y);
  if (!loc) return null;
  let best = loc;
  if (loc.parent) {
    const parent = asLocation(game, loc.parent);
    if (parent && (parent.danger || 0) > (best.danger || 0) && inBounds(parent, x, y)) best = parent;
  }
  return (best.danger || 0) >= 1 ? best : null;
}

// How dangerous `loc` is for her right now (about 0..12).
export function riskOf(game, actor, loc) {
  if (!loc) return 0;
  const danger = clamp(loc.danger || 0, 0, 3);
  let r = danger * 2;
  const wild = !loc.indoor && WILD_KINDS.has(loc.kind || 'area');
  const clock = game.clock;
  if (danger > 0 && wild && clock?.isNight) r += 1.5;
  else if (danger > 0 && wild && clock?.phase === 'dusk') r += 0.6;
  const w = clock?.weather?.type;
  if (danger > 0 && wild && (w === 'fog' || w === 'rain')) r += 0.5;
  const frac = actor?.maxHp > 0 ? clamp(actor.hp / actor.maxHp, 0, 1) : 1;
  r += (1 - frac) * 4;
  r += emotion(game, 'fear') * 1.5;
  if (danger >= 3 && (actor?.level || 1) < 3) r += 0.5;
  return r;
}

// Where her limit lies for `loc`: braver with someone she trusts at her side,
// much braver where Maren's trail leads.
export function riskThreshold(game, actor, loc) {
  const m = game?.companion?.mind;
  const own = m?.autonomy?.riskThreshold ?? m?.riskThreshold;
  if (typeof own === 'function') {
    const v = safe('autonomy.riskThreshold', () => own.call(m.autonomy || m, loc), null);
    if (Number.isFinite(v)) return v;
  } else if (Number.isFinite(own)) return own;
  let th = 6.5;
  const p = game.player;
  const together = isTogether(game);
  const rel = relToPlayer(game);
  if (together && p && isActorAlive(p) && actor && dist(actor.x, actor.y, p.x, p.y) < 12 * TILE) th += 0.5;
  if (together && rel && rel.trust >= 70) th += 1;
  if (companionshipOf(game) === 'wary') th -= 1.5;
  if (loc && (loc.id === 'sunken_ruins' || /maren/i.test(String(loc.description || '')))) th += 2.5;
  return th;
}

export function isTooRisky(game, actor, loc) {
  if (!loc || (loc.danger || 0) < 1) return false;
  return riskOf(game, actor, loc) > riskThreshold(game, actor, loc);
}

// May she step onto (x, y)? False when that lies in a place too risky to enter
// (being inside it already does not count: she can always walk on, or out).
export function allowedAt(game, actor, x, y) {
  const loc = dangerousPlaceAt(game, x, y);
  if (!loc || inBounds(loc, actor.x, actor.y)) return true;
  return !isTooRisky(game, actor, loc);
}

// A walkable spot just outside `loc`, near its entrance: outside a door or gate on
// its edge when there is one, else the outside tile nearest to (fromX, fromY).
export function entranceSpot(game, actor, loc, fromX, fromY) {
  const b = loc?.bounds;
  if (!b) return null;
  const map = game.map;
  const inside = (tx, ty) => tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  let best = null;
  let bd = Infinity;
  // Building doors first, then any door object on the edge (the ruins gate).
  const doors = [];
  const building = safe('map.buildings', () => (map?.buildings || []).find((bb) => bb.id === loc.id) || null, null);
  for (const d of building?.doorTiles || []) doors.push({ tx: d.tx, ty: d.ty });
  const objs = safe('objects.inRadius', () => game.objects?.inRadius?.((b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE, (Math.max(b.w, b.h) / 2 + 3) * TILE, (o) => o.objType === 'door'), []) || [];
  for (const o of objs) {
    const tx = o.tx ?? tileOf(o.x);
    const ty = o.ty ?? tileOf(o.y - 1);
    if (tx >= b.x - 1 && ty >= b.y - 1 && tx <= b.x + b.w && ty <= b.y + b.h) doors.push({ tx, ty });
  }
  for (const d of doors) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      // Two tiles out from the doorway, so she is not standing in it.
      for (const k of [2, 1]) {
        const tx = d.tx + dx * k;
        const ty = d.ty + dy * k;
        if (inside(tx, ty) || !walkable(game, tx, ty, actor)) continue;
        const x = tileCenter(tx);
        const y = tileCenter(ty);
        const dd = dist(fromX, fromY, x, y);
        if (dd < bd) {
          bd = dd;
          best = { x, y };
        }
        break;
      }
    }
  }
  if (best) return best;
  // No door: the outside ring, two tiles beyond the edge, nearest to `from`.
  for (let ring = 2; ring <= 4 && !best; ring++) {
    const x0 = b.x - ring;
    const y0 = b.y - ring;
    const x1 = b.x + b.w - 1 + ring;
    const y1 = b.y + b.h - 1 + ring;
    const consider = (tx, ty) => {
      if (map && !map.inBounds?.(tx, ty)) return;
      if (!walkable(game, tx, ty, actor)) return;
      const x = tileCenter(tx);
      const y = tileCenter(ty);
      const dd = dist(fromX, fromY, x, y);
      if (dd < bd) {
        bd = dd;
        best = { x, y };
      }
    };
    for (let tx = x0; tx <= x1; tx++) {
      consider(tx, y0);
      consider(tx, y1);
    }
    for (let ty = y0 + 1; ty < y1; ty++) {
      consider(x0, ty);
      consider(x1, ty);
    }
  }
  return best;
}

// --- running to safety ---

// The guards, the inn, the chapel: { x, y, label, location?, entity? } candidates.
export function safePlaces(game, actor) {
  const out = [];
  const list = game.entities?.list || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.type !== 'actor' || e.faction !== 'guard' || !isActorAlive(e)) continue;
    if (dist(actor.x, actor.y, e.x, e.y) > 40 * TILE) continue;
    out.push({ x: e.x, y: e.y, label: 'guards', entity: e, location: null });
  }
  for (const id of SAFE_LOCATIONS) {
    const loc = asLocation(game, id);
    if (loc?.center) out.push({ x: loc.center.x, y: loc.center.y, label: id, entity: null, location: loc });
  }
  return out;
}

// The safest place to run to, away from `threat` (an entity or null). `preferRef`
// names a place she was told to run to.
export function chooseSafePlace(game, actor, threat, preferRef = null) {
  if (preferRef) {
    const loc = asLocation(game, preferRef);
    if (loc?.center) return { x: loc.center.x, y: loc.center.y, label: loc.id, entity: null, location: loc };
    const e = typeof preferRef === 'object' && preferRef.type === 'actor' ? preferRef : game.entities?.get?.(String(preferRef));
    if (e && isActorAlive(e)) return { x: e.x, y: e.y, label: e.id, entity: e, location: null };
  }
  let best = null;
  let bestScore = Infinity;
  for (const c of safePlaces(game, actor)) {
    let score = dist(actor.x, actor.y, c.x, c.y);
    if (threat) {
      const dt = dist(threat.x, threat.y, c.x, c.y);
      score -= dt * 0.5;
      // Running past the threat to get there is no escape.
      const ax = c.x - actor.x;
      const ay = c.y - actor.y;
      const tx = threat.x - actor.x;
      const ty = threat.y - actor.y;
      const al = Math.hypot(ax, ay) || 1;
      const tl = Math.hypot(tx, ty) || 1;
      if ((ax * tx + ay * ty) / (al * tl) > 0.55 && tl < al) score += 600;
      if (c.entity && c.entity === threat) continue;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Has she got away from `threat`? Out of its sight and well clear, or far away.
export function escapedFrom(game, actor, threat) {
  if (!threat || !isActorAlive(threat) || threat.removed) return true;
  const d = dist(actor.x, actor.y, threat.x, threat.y);
  if (d > 18 * TILE) return true;
  if (d > 9 * TILE && !clearShot(game, actor, threat)) return true;
  return false;
}

// Non-friends that threaten her within r px (written into `out`, reused).
export function threatsNear(game, actor, r, out) {
  out.length = 0;
  const list = game.entities?.list || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === actor || e.type !== 'actor' || !isActorAlive(e)) continue;
    if (Math.abs(e.x - actor.x) > r || Math.abs(e.y - actor.y) > r) continue;
    if (dist(actor.x, actor.y, e.x, e.y) > r) continue;
    if (isFriend(game, actor, e) || isInnocent(game, actor, e)) continue;
    if (!isThreat(game, actor, e)) continue;
    out.push(e);
  }
  return out;
}

// Could she and whoever stands with her finish this? Total enemy health against
// hers plus the player's when the player is up and close.
export function fightWinnable(game, actor, threats) {
  if (!threats.length) return true;
  if (threats.length > 3) return false;
  let foes = 0;
  let foeThreat = 0;
  for (const e of threats) {
    foes += Math.max(0, e.hp || 0);
    foeThreat += Number.isFinite(e.threat) ? e.threat : 1.5;
  }
  let ours = Math.max(0, actor.hp || 0) + (actor.atk || 5) * 3;
  const p = game.player;
  if (p && isActorAlive(p) && dist(actor.x, actor.y, p.x, p.y) < 8 * TILE) ours += Math.max(0, p.hp || 0) + (p.atk || 5) * 3;
  return foeThreat <= 5 && foes <= ours * 1.1;
}

// Someone she loves (affinity >= 70) lying downed close by, or null.
export function lovedDownedNearby(game, actor, r = 4 * TILE) {
  const rels = game.companion?.mind?.relationships;
  if (!rels?.get) return null;
  const list = game.entities?.list || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === actor || e.type !== 'actor' || e.removed || e.dead || !e.downed) continue;
    if (dist(actor.x, actor.y, e.x, e.y) > r) continue;
    const rel = safe('relationships.get', () => rels.get(e.id), null);
    if (rel && rel.affinity >= LOVED_AFFINITY) return e;
  }
  return null;
}

// --- leaving for good ---

// A walkable map-edge tile along the King's Road (else any walkable edge tile),
// nearest to her: { x, y } in pixels, or null.
export function edgeExit(game, actor) {
  const map = game.map;
  if (!map?.w || !map?.h) return null;
  // The world names where the King's Road leaves it (worldgen: map.exits, west and east).
  const ex = map.exits ? Object.values(map.exits).filter((e) => e && Number.isFinite(e.x)) : [];
  if (ex.length) {
    ex.sort((a, b) => dist(actor.x, actor.y, a.x, a.y) - dist(actor.x, actor.y, b.x, b.y));
    return { x: ex[0].x, y: ex[0].y, tx: tileOf(ex[0].x), ty: tileOf(ex[0].y) };
  }
  const X0 = map.x0 || 0;
  const Y0 = map.y0 || 0;
  const X1 = X0 + map.w;
  const Y1 = Y0 + map.h;
  const road = asLocation(game, 'kings_road');
  let best = null;
  let bd = Infinity;
  const consider = (tx, ty) => {
    if (!walkable(game, tx, ty, actor)) return;
    const x = tileCenter(tx);
    const y = tileCenter(ty);
    const d = dist(actor.x, actor.y, x, y);
    if (d < bd) {
      bd = d;
      best = { x, y, tx, ty };
    }
  };
  const b = road?.bounds;
  // The road leaves the map at its ends: the left/right ends of a road running east
  // to west, the top/bottom of one running north to south.
  if (b && b.w >= b.h) {
    for (let ty = b.y; ty < b.y + b.h; ty++) {
      for (let k = 0; k < 3; k++) {
        if (b.x <= X0 + k) consider(X0 + k, ty);
        if (b.x + b.w >= X1 - k) consider(X1 - 1 - k, ty);
      }
    }
  } else if (b) {
    for (let tx = b.x; tx < b.x + b.w; tx++) {
      for (let k = 0; k < 3; k++) {
        if (b.y <= Y0 + k) consider(tx, Y0 + k);
        if (b.y + b.h >= Y1 - k) consider(tx, Y1 - 1 - k);
      }
    }
  }
  if (best) return best;
  for (let k = 0; k < 3 && !best; k++) {
    for (let tx = X0; tx < X1; tx++) {
      consider(tx, Y0 + k);
      consider(tx, Y1 - 1 - k);
    }
    for (let ty = Y0; ty < Y1; ty++) {
      consider(X0 + k, ty);
      consider(X1 - 1 - k, ty);
    }
  }
  return best;
}

export function atMapEdge(game, actor, margin = 1) {
  const map = game.map;
  if (!map?.w) return false;
  const tx = tileOf(actor.x);
  const ty = tileOf(actor.y);
  const X0 = map.x0 || 0;
  const Y0 = map.y0 || 0;
  return tx <= X0 + margin || ty <= Y0 + margin || tx >= X0 + map.w - 1 - margin || ty >= Y0 + map.h - 1 - margin;
}

// --- the player's sword ---

// Where the player's next swing lands (DESIGN §16.7), read from player.swingZone()
// when the player has one: { x, y, fx, fy, reach, cosMin, active } in a reused object.
// The reach gets a margin for the lunge that carries every swing forward.
const ZONE = { x: 0, y: 0, fx: 0, fy: 1, reach: 36, cosMin: 0.4, active: false };
const LUNGE_MARGIN = 10;

export function swingZoneOf(game) {
  const p = game.player;
  const z = ZONE;
  z.active = false;
  if (!p || !isActorAlive(p)) return z;
  const sz = typeof p.swingZone === 'function' ? safe('player.swingZone', () => p.swingZone(), null) : null;
  if (sz) {
    z.x = sz.x;
    z.y = sz.y;
    z.fx = sz.fx;
    z.fy = sz.fy;
    z.reach = (sz.range || 26) + LUNGE_MARGIN;
    // Half the arc, widened a little: standing on the edge of a swing still gets you hit.
    z.cosMin = Math.cos(Math.min(Math.PI * 0.95, (sz.arc || 1.8) / 2 + 0.25));
    z.active = !!sz.active;
    return z;
  }
  z.x = p.x;
  z.y = p.y;
  z.fx = p.facing?.x ?? 0;
  z.fy = p.facing?.y ?? 1;
  z.reach = 36;
  z.cosMin = 0.4;
  z.active = p.state === 'attack' || p.attackCd > 0.05;
  return z;
}

// Is the player swinging (or about to) right now?
export function playerFighting(game) {
  return swingZoneOf(game).active;
}

// Would someone standing at (x, y) be inside the fighting player's swing?
export function inSwordArc(game, x, y) {
  const z = swingZoneOf(game);
  if (!z.active) return false;
  const dx = x - z.x;
  const dy = y - z.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return true;
  if (d > z.reach) return false;
  return (dx * z.fx + dy * z.fy) / d >= z.cosMin;
}

// When she stands in front of a fighting player, the sideways step that takes her
// out of the swing. Writes { x, y } into `out` and returns true when she must move.
export function swordArcPush(game, actor, out) {
  const p = game.player;
  if (!p || p === actor) return false;
  const z = swingZoneOf(game);
  if (!z.active) return false;
  const dx = actor.x - z.x;
  const dy = actor.y - z.y;
  const d = Math.hypot(dx, dy);
  if (d > z.reach || d < 0.01) return false;
  const fx = z.fx;
  const fy = z.fy;
  const cos = (dx * fx + dy * fy) / d;
  if (cos < z.cosMin) return false;
  // Step to whichever side she is already on, and a little back.
  const side = dx * -fy + dy * fx >= 0 ? 1 : -1;
  let px = -fy * side;
  let py = fx * side;
  px -= fx * 0.35;
  py -= fy * 0.35;
  if (!walkable(game, tileOf(actor.x + px * 10), tileOf(actor.y + py * 10), actor)) {
    px = -px - fx * 0.7;
    py = -py - fy * 0.7;
  }
  const l = Math.hypot(px, py) || 1;
  out.x = px / l;
  out.y = py / l;
  return true;
}

// A spot `r` px from (fx, fy) that is open (not a corner) and close to where she is.
export function openSpotAway(game, actor, fx, fy, r) {
  let best = null;
  let bestScore = -Infinity;
  const base = Math.atan2(actor.y - fy, actor.x - fx);
  for (let i = 0; i < 12; i++) {
    const ang = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
    const x = fx + Math.cos(ang) * r;
    const y = fy + Math.sin(ang) * r;
    const tx = tileOf(x);
    const ty = tileOf(y);
    if (!walkable(game, tx, ty, actor)) continue;
    let open = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && walkable(game, tx + ox, ty + oy, actor)) open++;
    if (open < 5) continue; // a corner or a dead end
    const score = open * 6 - dist(actor.x, actor.y, x, y) * 0.35 - Math.abs(i) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = { x: tileCenter(tx), y: tileCenter(ty) };
    }
  }
  return best || nearestWalkable(game, fx + Math.cos(base) * r, fy + Math.sin(base) * r, 3, actor);
}
