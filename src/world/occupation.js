// The village under the stranger's hand (round 14b, item 19, the world side; DESIGN §35.7;
// the author's evil path: "children flee and hide from a killer and are taken away if the
// village is emptied; burning stores; taking over houses and the village"). `game.occupation`.
//
//   burned(locId) -> { day, by } | null     a store set alight (a fire weave on it): smoke and
//                                          embers, a blackened roof, its shop closed for good
//   claimed(locId) -> day | null           a house taken: its beds and chests are yours
//   emptied() -> bool                      nobody grown is left alive in Hearthvale: every
//                                          house, chest and counter is claimable at once
//   canClaim(locId), claim(locId)          a household dead or gone: its house can be taken
//   shopClosed(npcId)                      their shop burned (murder.refusesTrade reads it)
//   fireAt(x, y, r, blow)                  a weave's blow landed: fire on a store burns it
//   placeName(id, name)                    "Hearthvale (yours)" once the village is emptied
//   entryFor(npc, e, hour)                 a child hiding at home while a known killer is near
//
// Children (never killable, people.js isMinor; never hurt when a village is emptied):
//   - they hide: a child who SEES a stranger they know to be a killer (they saw it, or the
//     news reached them: murder.knowsKiller) runs home and stays in, doors shut, for a while;
//   - they are taken away: once every grown person of their household is dead, kin or a
//     carter from Saltmere comes for them the next morning (village_life.markGone, cause
//     'taken_away': out of the world, unharmed). Their missions pass on (murder STAND_INS).
//
// Saved as a plugin (id 'occupation').

import { TILE } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isMinor } from '../core/people.js';
import { profileById } from '../entities/npc_data.js';
import { witnessesOf } from '../murder/witness.js';
import { Entity } from '../entities/entity.js';

// Buildings that burn: the stores and workshops of the square, and the homes.
export const BURNABLE = Object.freeze(['general_store', 'herbalist', 'smithy', 'ember_kettle', 'chandlery', 'farmhouse', 'dye_cottage', 'ashby_house', 'net_shed']);
// Whose counter each store is (its shop closes when it burns).
export const STORE_OF = Object.freeze({ general_store: 'garrick', herbalist: 'mira', smithy: 'bram', ember_kettle: 'elda', chandlery: 'hobb' });
// Houses that can be taken once their household is gone (homes, by profile.home).
export const HOUSES = Object.freeze(['smithy', 'ember_kettle', 'herbalist', 'farmhouse', 'general_store', 'chandlery', 'dye_cottage', 'ashby_house', 'net_shed']);
const HIDE_SECONDS = 2.5 * 37.5; // a child stays hidden this long after seeing the killer
const TAKE_HOUR = 9; // the cart comes at this hour of the morning after
const SMOKE_DAYS = 1; // smoke rises this long after a burning
// An owner by their burned shop (verify-b: never their wares over the ashes).
const BURNED_LINES = ['Everything I had. Gone in an hour.', 'Who would do this? Who?', 'Twenty years of work. Look at it.', "Don't. Just… don't ask me to sell you anything."];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function dayOf(game) {
  return game?.clock?.day ?? 1;
}

export class Occupation {
  constructor(game) {
    this.game = game;
    this.burns = {}; // locId -> { day, t, by }
    this.claims = {}; // locId -> day
    this.taken = {}; // childId -> { day, by }
    this.pendingTake = {}; // childId -> { day } (the morning they will be fetched)
    this.fallen = null; // day the village was emptied
    this._smokeT = 0;
    this._t = 0;
    // A burned building shows on its roof (the map's roof pass; verify-b).
    if (game?.map) game.map.roofDecor = (ctx, b, geo, ox, oy, time, alpha) => this.drawRoof(ctx, b, geo, ox, oy, time, alpha);
  }

  // ---------------------------------------------------------------- who lives where

  householdOf(id) {
    const home = profileById(id)?.home;
    if (!home) return [];
    return VILLAGERS.filter((v) => profileById(v)?.home === home);
  }

  isGone(id) {
    const g = this.game;
    if (safe(() => g.murder?.isDead?.(id), false)) return true;
    const e = safe(() => g.entities?.get?.(id), null);
    return !!e?.absent;
  }

  adultsOf(home) {
    return VILLAGERS.filter((v) => profileById(v)?.home === home && !isMinor(this.game, v));
  }

  // ---------------------------------------------------------------- burning

  burned(locId) {
    return this.burns[locId] || null;
  }

  shopClosed(npcId) {
    for (const [loc, who] of Object.entries(STORE_OF)) if (who === npcId && this.burns[loc]) return true;
    return false;
  }

  // An owner whose shop burned says so, in place of crying their wares (npc.js asks it for
  // their idle line). -> a line, or null.
  burnedLine(npc) {
    if (!npc?.id || !this.shopClosed(npc.id)) return null;
    const i = Math.floor((this.game?.time ?? Math.random() * 10) / 7) % BURNED_LINES.length;
    return BURNED_LINES[(i + BURNED_LINES.length) % BURNED_LINES.length];
  }

  // The building on the map a burned location stands in (tile rects overlap).
  burnedAt(b) {
    if (!b) return null;
    for (const [id, rec] of Object.entries(this.burns)) {
      const lb = safe(() => this.game.locations.get(id).bounds, null);
      if (lb && b.x < lb.x + lb.w && b.x + b.w > lb.x && b.y < lb.y + lb.h && b.y + b.h > lb.y) return { id, rec };
    }
    return null;
  }

  // Scorch on the roof itself (map.roofDecor; the roof is drawn over the world, so a scorch
  // drawn among the people never showed): blackened patches, a burned-through hole, and
  // embers for a day or two. geo is the roof's geometry in world pixels.
  drawRoof(ctx, b, geo, ox, oy, time = 0, alpha = 1) {
    const hit = this.burnedAt(b);
    if (!hit || !geo || !(alpha > 0.02)) return false;
    const x0 = Math.round(geo.x - ox);
    const y0 = Math.round(geo.y - oy);
    const w = Math.round(geo.w);
    const h = Math.round(geo.h);
    const seed = hit.id.length * 31;
    ctx.save();
    ctx.globalAlpha = alpha * 0.78;
    ctx.fillStyle = '#17100c';
    for (let yy = 0; yy < h; yy += 3) {
      for (let xx = 0; xx < w; xx += 3) {
        const k = ((xx * 7 + yy * 13 + seed) ^ (xx * yy + seed)) & 7;
        if (k < 5) ctx.fillRect(x0 + xx, y0 + yy, 3, 3);
      }
    }
    // A hole burned through near the ridge, charred rafters across it.
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = '#070505';
    const hx = x0 + Math.round(w * 0.38);
    const hy = y0 + Math.round(h * 0.22);
    ctx.fillRect(hx, hy, Math.round(w * 0.24), Math.round(h * 0.26));
    ctx.fillStyle = '#3a2418';
    for (let i = 0; i < 3; i++) ctx.fillRect(hx - 2, hy + 3 + i * Math.round(h * 0.08), Math.round(w * 0.24) + 4, 2);
    const day = this.game?.clock?.day ?? 1;
    if (day - hit.rec.day < 2) {
      for (let i = 0; i < 10; i++) {
        const fx = x0 + ((i * 37 + seed) % Math.max(1, w));
        const fy = y0 + ((i * 23 + seed) % Math.max(1, h));
        ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(time * 6 + i));
        ctx.fillStyle = i % 2 ? '#ff7a2a' : '#ffd66b';
        ctx.fillRect(fx, fy, 2, 2);
      }
    }
    ctx.restore();
    return true;
  }

  // A weave's blow at (x, y): fire on a store sets it alight (blow.fire, from the player).
  fireAt(x, y, r, blow = {}) {
    const g = this.game;
    if (!blow.fire) return null;
    const src = blow.source;
    if (src && src !== g.player && src.id !== 'player') return null;
    const loc = safe(() => g.locations?.at?.(x, y), null);
    if (!loc || !BURNABLE.includes(loc.id) || this.burns[loc.id]) return null;
    return this.burn(loc.id, src || g.player);
  }

  burn(locId, by = this.game?.player) {
    const g = this.game;
    if (!BURNABLE.includes(locId) || this.burns[locId]) return null;
    const rec = { day: dayOf(g), t: Math.round(g.clock?.t ?? 0), by: by ? (by === g.player ? 'player' : by.id) : null };
    this.burns[locId] = rec;
    const loc = safe(() => g.locations?.get?.(locId), null);
    const c = loc?.center;
    // Arson: a crime only if seen (the shared sight rule), never a fight.
    const P = g.player;
    if (rec.by === 'player' && P) {
      const seen = safe(() => witnessesOf(g, P.x, P.y).map((w) => w.id), []) || [];
      rec.seen = seen;
      if (seen.length) safe(() => g.bus?.emit?.('crime', { actor: P, victim: safe(() => g.entities.get(STORE_OF[locId]), null), kind: 'arson', object: locId, owner: STORE_OF[locId] || null, witnesses: seen }));
    }
    if (c) {
      safe(() => g.particles?.emit?.('ember', c.x, c.y - 20, { count: 24, speed: 40, life: 1.2 }));
      safe(() => g.lighting?.flash?.({ x: c.x, y: c.y - 16, r: 120, color: '#ff7a2a', intensity: 0.9, duration: 1.2 }));
      safe(() => g.audio?.play?.('fire', { x: c.x, y: c.y, volume: 0.8 }));
    }
    safe(() => g.villageLife?.event?.('burned', `${loc?.name || locId} burned.`, { about: locId }));
    safe(() => g.bus?.emit?.('store_burned', { id: locId, by: rec.by, seen: rec.seen || [] }));
    safe(() => g.ui?.toast?.(`${loc?.name || 'The building'} is burning.`, 'warn', { key: `burn:${locId}` }));
    return rec;
  }

  // ---------------------------------------------------------------- houses

  canClaim(locId) {
    if (!HOUSES.includes(locId) || this.claims[locId]) return false;
    if (this.emptied()) return true;
    const adults = this.adultsOf(locId);
    if (!adults.length) return false;
    return adults.every((id) => this.isGone(id));
  }

  claimed(locId) {
    return this.claims[locId] ?? null;
  }

  // Take the house: its beds and chests are the stranger's now (a chest of theirs is no
  // theft, a bed of theirs is slept in as at home).
  claim(locId, { force = false, quiet = false } = {}) {
    const g = this.game;
    if (!force && !this.canClaim(locId)) return false;
    this.claims[locId] = dayOf(g);
    const b = safe(() => g.locations?.get?.(locId)?.bounds, null);
    if (b) {
      for (const o of safe(() => g.objects?.all?.(), []) || []) {
        const tx = Math.floor(o.x / TILE);
        const ty = Math.floor((o.y - 1) / TILE);
        if (tx < b.x || ty < b.y || tx >= b.x + b.w || ty >= b.y + b.h) continue;
        if (o.objType === 'chest' && o.owner !== 'player') {
          o.prevOwner = o.owner;
          o.owner = 'player';
          o.markDirty?.();
        } else if (o.objType === 'bed' && o.owner && o.owner !== 'player') {
          o.prevOwner = o.owner;
          o.owner = 'player';
          o.villagerBed = false;
          o.markDirty?.();
        }
      }
    }
    if (quiet) return true;
    safe(() => g.bus?.emit?.('house_claimed', { id: locId }));
    safe(() => g.ui?.toast?.(`${safe(() => g.locations.get(locId).name, locId)} is yours now. Nobody is left to say otherwise.`, 'info', { key: `claim:${locId}` }));
    return true;
  }

  // Nobody grown is left alive and present in Hearthvale.
  emptied() {
    const adults = VILLAGERS.filter((id) => !isMinor(this.game, id));
    return adults.length > 0 && adults.every((id) => this.isGone(id));
  }

  placeName(id, name) {
    if (id === 'hearthvale' && this.fallen != null) return `${name || 'Hearthvale'} (yours)`;
    return name;
  }

  // The fallen village (the villain's ending reads it): once, the bell rings, and every
  // house is the stranger's to take.
  checkFallen() {
    if (this.fallen != null || !this.emptied()) return;
    const g = this.game;
    this.fallen = dayOf(g);
    safe(() => g.audio?.play?.('bell', { volume: 0.8 }));
    for (const id of HOUSES) if (!this.claims[id]) this.claim(id);
    safe(() => g.bus?.emit?.('village_emptied', { day: this.fallen }));
    safe(() => g.ui?.toast?.('The Moot bell rings once, and nobody comes. Hearthvale is yours.', 'warn', { key: 'emptied' }));
  }

  // ---------------------------------------------------------------- children

  // Does this child know the stranger for a killer (saw it, or the news reached them)?
  knowsKiller(child) {
    const m = this.game?.murder;
    if (!m) return false;
    for (const rec of Object.values(m.dead || {})) if (!rec.natural && safe(() => m.knowsKiller(rec, child.id), false)) return true;
    // What this child knows by society's per-knower rule (reputation.counts({knownTo})): a
    // killing they saw, were told of face to face, or heard proven at the Moot.
    const c = safe(() => this.game.reputation?.counts?.({ knownTo: child.id }), null);
    return !!c && (Number(c.killedKnown) || 0) > 0;
  }

  // A child who sees a known killer near hides at home (npc.perceive asks, through
  // murder.entryFor and the child's own flight).
  childSees(child) {
    const g = this.game;
    const P = g?.player;
    if (!child || !P || !isMinor(g, child) || child.dead || child.absent) return false;
    if (Math.hypot(child.x - P.x, child.y - P.y) > 150) return false;
    if (!safe(() => child.canSee?.(P), false)) return false;
    if (!this.knowsKiller(child)) return false;
    const was = child.hideUntil > (g.clock?.t ?? 0);
    child.hideUntil = (g.clock?.t ?? 0) + HIDE_SECONDS;
    if (!was) {
      safe(() => child.startFlee?.(P, 6, 'crime'));
      safe(() => g.bus?.emit?.('child_hides', { id: child.id }));
    }
    return true;
  }

  entryFor(npc, e, hour) {
    void e;
    void hour;
    const g = this.game;
    if (!npc || !(npc.hideUntil > (g.clock?.t ?? 0))) return null;
    const home = npc.profile?.home || 'chapel';
    return { activity: 'rest', at: home, vl: `hide-${home}`, doing: 'hiding at home with the door shut' };
  }

  // Every grown person of a child's household is gone: kin or a carter comes the next
  // morning and takes them away, unharmed.
  childrenTick() {
    const g = this.game;
    const day = dayOf(g);
    const hour = g.clock?.hour ?? 12;
    for (const id of VILLAGERS) {
      if (this.taken[id] || !isMinor(g, id)) continue;
      const e = safe(() => g.entities.get(id), null);
      if (!e || e.dead || e.absent) continue;
      const home = profileById(id)?.home;
      const adults = home ? this.adultsOf(home) : [];
      const orphaned = adults.length > 0 && adults.every((a) => this.isGone(a));
      if (!orphaned) {
        delete this.pendingTake[id];
        continue;
      }
      if (!this.pendingTake[id]) this.pendingTake[id] = { day: day + 1 };
      const p = this.pendingTake[id];
      if (day > p.day || (day === p.day && hour >= TAKE_HOUR)) this.takeAway(id);
    }
  }

  takeAway(id) {
    const g = this.game;
    const by = id === 'tansy' ? 'kin' : 'cart';
    this.taken[id] = { day: dayOf(g), by };
    delete this.pendingTake[id];
    const name = safe(() => g.entities.get(id).name.split(' ')[0], id);
    const text = by === 'kin' ? `Kin from Brightwater came for ${name} at first light, and took ${name} away from Hearthvale.` : `A carter from Saltmere came for ${name} at first light. ${name} went with them, holding a bundle, and did not look back.`;
    safe(() => g.villageLife?.markGone?.(id, { cause: 'taken_away', seen: false, keepBody: false }));
    safe(() => g.villageLife?.event?.('taken_away', text, { about: id }));
    safe(() => g.bus?.emit?.('child_taken_away', { id, by }));
    safe(() => g.ui?.toast?.(text, 'info', { key: `taken:${id}` }));
  }

  // ---------------------------------------------------------------- the frame

  update(dt) {
    const g = this.game;
    if (!g || g.state !== 'playing') return;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 1;
      safe(() => this.childrenTick());
      safe(() => this.checkFallen());
      for (const id of VILLAGERS) {
        const e = safe(() => g.entities.get(id), null);
        if (e && isMinor(g, e)) safe(() => this.childSees(e));
      }
    }
    // Smoke over a burned building for a day.
    this._smokeT -= dt;
    if (this._smokeT <= 0) {
      this._smokeT = 0.35;
      const day = dayOf(g);
      for (const [id, b] of Object.entries(this.burns)) {
        if (day - b.day >= SMOKE_DAYS + 1) continue;
        const c = safe(() => g.locations.get(id).center, null);
        if (!c || !safe(() => g.camera?.inView?.(c.x, c.y, 120), true)) continue;
        safe(() => g.particles?.emit?.('smoke', c.x + (Math.random() - 0.5) * 30, c.y - 24, { count: 3, speed: 14, life: 2.6, color: '#8a8290' }));
        if (day === b.day) safe(() => g.particles?.emit?.('ember', c.x + (Math.random() - 0.5) * 24, c.y - 18, { count: 1, speed: 18, life: 1 }));
      }
    }
  }

  serialize() {
    return { v: 1, burns: this.burns, claims: this.claims, taken: this.taken, pendingTake: this.pendingTake, fallen: this.fallen };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : {});
    this.burns = obj(d.burns);
    this.claims = obj(d.claims);
    this.taken = obj(d.taken);
    this.pendingTake = obj(d.pendingTake);
    this.fallen = Number.isFinite(d.fallen) ? d.fallen : null;
    // Claimed beds and chests are the stranger's again (objects keep only their state).
    const claims = { ...this.claims };
    this.claims = {};
    for (const id of Object.keys(claims)) {
      this.claim(id, { force: true, quiet: true });
      this.claims[id] = claims[id];
    }
  }
}

// The blackened roof of a burned building: scorched patches and dying embers over its
// footprint (an fx entity drawn over the world; no renderer change).
export class ScorchLayer extends Entity {
  constructor(game) {
    super(game, { id: 'scorch_layer', solid: false, radius: 0 });
    this.type = 'fx';
  }

  get sortY() {
    return this.y + 1.5e6;
  }

  update() {
    const P = this.game?.player;
    if (P) {
      this.x = P.x;
      this.y = P.y;
    }
  }

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  // The embers of a building burned today glow orange through the night (one light, for
  // the most recent fire; lighting.js collects it with the rest).
  getLight(time = 0) {
    const occ = this.game?.occupation;
    const day = this.game?.clock?.day ?? 1;
    let best = null;
    for (const [id, b] of Object.entries(occ?.burns || {})) if (day - b.day < 1 && (!best || b.t > best.b.t)) best = { id, b };
    if (!best) return null;
    const loc = safe(() => this.game.locations.get(best.id), null);
    const c = loc?.center;
    if (!c) return null;
    const L = (this._glow ||= { x: 0, y: 0, r: 80, color: '#ff7a2a', intensity: 0.7 });
    // Just outside its front wall (a light inside a building is masked by its roof).
    L.x = c.x;
    L.y = loc.bounds ? (loc.bounds.y + loc.bounds.h) * TILE + 6 : c.y + 24;
    L.r = 76 + 8 * Math.sin(time * 3.1);
    L.intensity = 0.55 + 0.2 * Math.sin(time * 7.3) * Math.sin(time * 2.1);
    return L;
  }

  draw(ctx, ox, oy, time = 0) {
    const occ = this.game?.occupation;
    if (!occ) return;
    for (const id of Object.keys(occ.burns || {})) {
      const b = safe(() => this.game.locations.get(id).bounds, null);
      if (!b) continue;
      const x0 = b.x * TILE - ox;
      const y0 = b.y * TILE - oy;
      const w = b.w * TILE;
      const h = Math.max(TILE * 2, (b.h - 2) * TILE);
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = '#1a1210';
      for (let yy = 0; yy < h; yy += 4) {
        for (let xx = 0; xx < w; xx += 4) {
          const k = ((xx * 7 + yy * 13 + id.length * 31) >> 2) & 7;
          if (k < 5) ctx.fillRect(Math.round(x0 + xx), Math.round(y0 + yy), 4, 4);
        }
      }
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#3a2418';
      ctx.fillRect(Math.round(x0 + w * 0.2), Math.round(y0 + 2), Math.round(w * 0.6), 2);
      const day = this.game.clock?.day ?? 1;
      if (day - occ.burns[id].day < 2) {
        for (let i = 0; i < 6; i++) {
          const fx = x0 + ((i * 37 + id.length * 11) % Math.max(1, w));
          const fy = y0 + ((i * 23) % Math.max(1, h));
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 6 + i);
          ctx.fillStyle = i % 2 ? '#ff7a2a' : '#ffd66b';
          ctx.fillRect(Math.round(fx), Math.round(fy), 2, 2);
        }
      }
      ctx.restore();
    }
  }
}
