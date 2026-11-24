import { TILE } from '../core/constants.js';
import { spawnCreature, SPECIES } from './monsters.js';
import { inVillage, rand, alive } from './creature_util.js';

// Keeps the wild places populated. Each zone (from worldgen) names a rectangle of
// tiles, the species that live there, a cap, and whether it is a night-only zone
// (night: true), a day-only zone (night: false) or always active (undefined).
// New creatures appear out of the player's view, never inside the village (unless
// they are village animals), and only after a per-species pause so a cleared camp
// stays cleared for a while. At dawn, night-only creatures that are out of sight
// slip away (bats return to the dark, the night wolves go deeper into the wood).

const CHECK_EVERY = 1.5; // seconds between zone checks
export const MAX_CREATURES = 70; // across the whole world
const MIN_PLAYER_DIST = 150; // px: never spawn closer than this to the player

// Seconds before a zone refills one creature of this species.
export const RESPAWN_DELAY = {
  slime: 35,
  wolf: 50,
  boar: 60,
  deer: 40,
  rabbit: 30,
  chicken: 60,
  cat: 600,
  bat: 20,
  skeleton: 90,
  bandit: 240,
  bandit_archer: 240,
  bandit_chief: 1200,
};

export function zoneActive(zone, night) {
  if (zone.night === true) return !!night;
  if (zone.night === false) return !night;
  return true;
}

function inRect(e, r) {
  const tx = e.x / TILE;
  const ty = e.y / TILE;
  return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
}

export class Spawner {
  constructor(game, zones = []) {
    this.game = game;
    this.zones = [];
    for (const z of zones || []) {
      if (!z || !z.rect || !Array.isArray(z.species) || !z.species.length) continue;
      const species = z.species.filter((s) => SPECIES[s]);
      if (!species.length) continue;
      this.zones.push({
        id: String(z.id ?? `zone${this.zones.length}`),
        locationId: z.locationId ?? null,
        species,
        max: Math.max(0, Math.floor(z.max ?? 3)),
        night: z.night === true ? true : z.night === false ? false : undefined,
        rect: { x: z.rect.x, y: z.rect.y, w: Math.max(1, z.rect.w), h: Math.max(1, z.rect.h) },
      });
    }
    this.t = 0;
    this.checkT = 0.5;
    this.next = new Map(); // zone id -> this.t when it may spawn again
    this.counts = new Map(); // zone id -> live members (refreshed each check)
    this.total = 0;
    this.maxTotal = MAX_CREATURES;
  }

  update(dt) {
    this.t += dt;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = CHECK_EVERY;
    try {
      this.check();
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        console.error('[spawner] check failed', err);
      }
    }
  }

  // Count members per zone in one pass. A creature belongs to the zone that spawned
  // it, or (for creatures placed by worldgen) to a zone whose rectangle and species fit.
  countMembers() {
    const counts = this.counts;
    counts.clear();
    for (const z of this.zones) counts.set(z.id, 0);
    let total = 0;
    const list = this.game.entities?.list || this.game.entities?.all?.() || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.species || e.removed || e.dead) continue;
      total++;
      if (e.spawnZone && counts.has(e.spawnZone)) {
        counts.set(e.spawnZone, counts.get(e.spawnZone) + 1);
        continue;
      }
      for (const z of this.zones) {
        if (z.species.includes(e.species) && inRect(e.home || e, z.rect)) {
          counts.set(z.id, counts.get(z.id) + 1);
          if (!e.spawnZone) e.spawnZone = z.id;
          break;
        }
      }
    }
    this.total = total;
    return counts;
  }

  check() {
    const g = this.game;
    const night = !!g.clock?.isNight;
    const counts = this.countMembers();
    for (const z of this.zones) {
      if (!zoneActive(z, night)) {
        this.retire(z);
        continue;
      }
      const have = counts.get(z.id) || 0;
      if (have >= z.max) continue;
      if (this.total >= this.maxTotal) return;
      if (this.t < (this.next.get(z.id) ?? 0)) continue;
      const species = z.species[Math.floor(rand(g) * z.species.length)];
      const pack = species === 'wolf' ? Math.min(z.max - have, 2 + (rand(g) < 0.4 ? 1 : 0)) : 1;
      const spot = this.findSpot(z, species);
      if (!spot) {
        this.next.set(z.id, this.t + 4);
        continue;
      }
      let made = 0;
      for (let k = 0; k < pack; k++) {
        const ox = k === 0 ? 0 : (rand(g) - 0.5) * 28;
        const oy = k === 0 ? 0 : (rand(g) - 0.5) * 20;
        const x = spot.x + ox;
        const y = spot.y + oy;
        if (k > 0 && this.blocked(x, y, species)) continue;
        try {
          spawnCreature(g, species, x, y, { spawnZone: z.id, night: z.night === true });
          made++;
        } catch (err) {
          console.error('[spawner] spawn failed', species, err);
          break;
        }
      }
      counts.set(z.id, have + made);
      this.total += made;
      const delay = RESPAWN_DELAY[species] ?? 40;
      this.next.set(z.id, this.t + delay * (0.75 + rand(g) * 0.5));
    }
  }

  // Night-only creatures leave at dawn, but never while someone watches or fights them.
  retire(z) {
    if (z.night !== true) return;
    const list = this.game.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.spawnZone !== z.id || e.removed || e.dead || !alive(e)) continue;
      if (e.target || this.inView(e.x, e.y, 32)) continue;
      e.removed = true;
    }
  }

  blocked(x, y, species) {
    const g = this.game;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const flying = !!SPECIES[species]?.flying;
    try {
      if (g.map?.inBounds && !g.map.inBounds(tx, ty)) return true;
      if (!flying && g.map?.isWater?.(tx, ty)) return true;
      if (g.isBlockedTile?.(tx, ty, flying ? { flying: true } : null)) return true;
    } catch {
      return true;
    }
    if (!SPECIES[species]?.village && inVillage(g, x, y)) return true;
    return false;
  }

  inView(x, y, margin = 24) {
    const cam = this.game.camera;
    if (!cam || !Number.isFinite(cam.vw)) return false;
    return x > cam.x - margin && x < cam.x + cam.vw + margin && y > cam.y - margin && y < cam.y + cam.vh + margin;
  }

  // A free tile in the zone, out of view and away from the player.
  findSpot(z, species) {
    const g = this.game;
    const p = g.player;
    const r = z.rect;
    for (let k = 0; k < 10; k++) {
      const tx = r.x + Math.floor(rand(g) * r.w);
      const ty = r.y + Math.floor(rand(g) * r.h);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      if (this.blocked(x, y, species)) continue;
      if (this.inView(x, y, 32)) continue;
      if (p && Math.hypot(p.x - x, p.y - y) < MIN_PLAYER_DIST) continue;
      return { x, y };
    }
    return null;
  }

  count(zoneId) {
    return this.counts.get(zoneId) || 0;
  }

  serialize() {
    const next = {};
    for (const [id, t] of this.next) if (t > this.t) next[id] = Math.round((t - this.t) * 10) / 10;
    return { next };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    for (const [id, left] of Object.entries(d.next || {})) if (Number.isFinite(left)) this.next.set(id, this.t + Math.max(0, left));
  }
}
