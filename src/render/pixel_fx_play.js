import { PixelFx } from './pixel_fx.js';
import { PIXEL_FX, RAMP, rampOf } from './pixel_fx_catalog.js';
import { actorOf, bodySize } from './pixel_fx_bodies.js';
import { wanderer } from './pixel_fx_critters.js';

// Where the game plays its pixelfx effects (DESIGN §30): one small function per moment, so
// call sites stay one line and fall back to their old look when nothing was played (no
// host, over the cap, or skipped under reduced motion). Each returns the handle or null.
// The director (update once per world step) keeps the long-lived ones in step with the
// world: statuses on bodies, the fallen bleeding, berserk's rage.

const px = (game) => game?.pixelFx || null;

export function installPixelFx(game) {
  const host = new PixelFx(game, PIXEL_FX);
  host.actorOf = (e) => actorOf(game, e);
  host.director = new PixelFxDirector(game, host);
  return host;
}

// A blow lands (a blade, a fist, a weave): the hit spark at the target's chest, thrown along
// the blow; a critical hit gets the starburst. pal: a Weave palette to recolor it.
export function playHit(game, target, { dx = 0, dy = 0, crit = false, pal = null, heavy = false, scale = 1 } = {}) {
  const P = px(game);
  if (!P || !target) return null;
  const { h } = bodySize(game, target);
  const height = Math.max(6, Math.round(h * 0.5)) + Math.round(target.z || 0);
  const big = Math.min(1.6, Math.max(1, h / 22)) * Math.max(1, Math.min(1.8, Number(scale) || 1));
  const angle = dx || dy ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
  const o = { x: target.x, y: target.y, angle, height, seed: (Math.random() * 1e6) | 0 };
  if (pal) o.palette = rampOf(pal);
  if (crit) return P.play('crit', { ...o, size: 0.5 * big });
  return P.play('hit', { ...o, size: (heavy ? 0.7 : 0.6) * big });
}

// The Strike lands: a real punch at the knuckles, along the blow, in the weave's colors.
export function playPunch(game, x, y, angle, pal, size = 1) {
  const P = px(game);
  if (!P) return null;
  return P.play('punch', { x, y, angle, palette: rampOf(pal), size: 0.55 * Math.min(1.2, size), seed: (Math.random() * 1e6) | 0 });
}

// A creature goes (its body fading under the cloud).
export function playPoof(game, e, size = 1) {
  const P = px(game);
  if (!P || !e) return null;
  const { h } = bodySize(game, e);
  const k = Math.max(0.8, Math.min(1.8, h / 16)) * size;
  return P.play('poof', { x: e.x, y: e.y, size: 0.55 * k, height: Math.round(h * 0.45) + 2, seed: (Math.random() * 1e6) | 0 });
}

// A heal on a body. kind: 'spell' (green), 'potion' (red), 'gold' (revival, the kept flame).
export function playHeal(game, e, kind = 'spell') {
  const P = px(game);
  if (!P || !e || e.removed || e.hidden) return null;
  const ramp = kind === 'potion' ? RAMP.potion : kind === 'gold' ? RAMP.gold : RAMP.heal;
  P.stop(`heal:${e.uid ?? e.id}`);
  return P.play('heal', { follow: e, palette: ramp, tag: `heal:${e.uid ?? e.id}`, seed: (Math.random() * 1e6) | 0 });
}

// A level gained: a burst of gold at the chest of whoever rose (combat plays it, in place
// of its old gold spray).
export function playLevelUp(game, e) {
  if (!e) return null;
  return playCollect(game, e.x, e.y, { gold: true, size: 1.2, height: Math.round(bodySize(game, e).h * 0.55) });
}

// Something picked up, a chest's haul, a level-up.
export function playCollect(game, x, y, { gold = true, pal = null, size = 1, height = 6 } = {}) {
  const P = px(game);
  if (!P) return null;
  return P.play('collect', { x, y, height, palette: pal ? rampOf(pal) : gold ? RAMP.gold : RAMP.item, size, seed: (Math.random() * 1e6) | 0 });
}

// A blow on a ward's shell: a small spark glancing off it, outward, in the ward's colors.
export function playWardHit(game, x, y, angle, pal) {
  const P = px(game);
  if (!P) return null;
  return P.play('hit', { x, y: y + 6, height: 6, angle, palette: rampOf(pal), size: 0.42, sparks: 6, lightScale: 0.5, seed: (Math.random() * 1e6) | 0 });
}

// A bind takes hold: hands come up round the bound one, in the weave's colors.
export function playBind(game, target, pal, tag) {
  const P = px(game);
  if (!P || !target) return null;
  const { w } = bodySize(game, target);
  return P.play('bind', { x: target.x, y: target.y, palette: rampOf(pal), radius: Math.max(13, w + 4), tag, seed: (Math.random() * 1e6) | 0 });
}

// ------------------------------------------------------------------ the director

// Weave statuses that pixelfx shows on the body (the old tint and overlay step aside).
// The game's 'frozen' (sealed in ice) keeps its own ice crust; 'chilled' is pixelfx's chill.
const STATUS_FX = {
  burning: 'st-burning',
  chilled: 'st-chill',
  poisoned: 'st-poison',
  drained: 'st-cursed',
  stunned: 'st-stun',
  staggered: 'st-stun',
  dazzled: 'st-dazed',
};
export const PIXEL_STATUSES = Object.keys(STATUS_FX);

const NEAR = 120; // px past the view a body still keeps its effects running
const RETRY = 0.5; // s before trying again an effect the cap refused

export class PixelFxDirector {
  constructor(game, host) {
    this.game = game;
    this.host = host;
    this.live = new Map(); // body -> Map(fxId -> { handle, retry })
    this._want = new Map();
    this._t = 0;
    this.critters = []; // { kind, mover, handle }
    this._ambT = 0;
    this._listen();
  }

  // Moments the game announces on its bus.
  _listen() {
    const g = this.game;
    const on = (ev, fn) => {
      try {
        g.bus?.on?.(ev, (p) => {
          try {
            fn(p || {});
          } catch (err) {
            this.host.warn(`on ${ev}`, err);
          }
        });
      } catch {
        /* no bus in some tests */
      }
    };
    // (A level gained is played by combat itself, playLevelUp, so its old spray can step aside.)
    // Stat points spent on the character sheet: a small burst at the player's chest, seen as
    // the sheet closes (the world is paused under it). One burst however many were spent.
    let unspent = null;
    on('points_changed', (p) => {
      const n = Number(p.unspent);
      if (!Number.isFinite(n)) return;
      const was = unspent;
      unspent = n;
      const pl = g.player;
      if (!pl || !(p.raised > 0 || (was != null && n < was))) return; // a point spent (or a free one raised)
      this.host.stop('points');
      this.host.play('collect', { x: pl.x, y: pl.y, height: Math.round(bodySize(g, pl).h * 0.55), size: 0.8, palette: RAMP.points, tag: 'points', seed: n + 3 });
    });
    // Back on their feet with help (a potion, a hand up, carried home): life climbs back up
    // the body in gold. combat.revive plays it itself (its old shimmer steps aside); this
    // covers the other ways back. Getting up alone is no fanfare (combat.revive says so).
    on('revived', (p) => {
      const e = p.entity;
      if (!e || !p.by || p.by === e || this.host.playing(`heal:${e.uid ?? e.id}`)) return;
      playHeal(g, e, 'gold');
    });
    // Laid in a cot at Mira's: her care starts with a heal.
    on('delivered', (p) => {
      if (p.entity) playHeal(g, p.entity, 'spell');
    });
    // A flame kept for the player at the chapel.
    on('kept_flame', (p) => {
      const pl = g.player;
      if (p.lit && pl) playCollect(g, pl.x, pl.y, { gold: true, size: 1.1, height: 14 });
    });
    // Bosses: a puff of their own colors as they arrive; beaten for good, the soul lifts out.
    on('boss_started', (p) => {
      const b = p.boss;
      if (b && !b.removed) playPoof(g, b, 1.3);
    });
    on('boss_defeated', (p) => {
      const b = p.boss;
      if (!b || b.removed) return;
      if (p.yielded) playCollect(g, b.x, b.y, { gold: true, size: 1.3, height: Math.round(bodySize(g, b).h * 0.5) });
      else {
        // room for the whole body to lift out of itself (a boss is far bigger than a villager)
        const { h, w } = bodySize(g, b);
        const rise = Math.max(30, Math.round(h * 1.6));
        const half = Math.max(40, Math.ceil(w / 2) + 26);
        this.host.play('soul-rise', { follow: b, height: rise, seed: 7, bounds: [-half, -(h + rise + 24), half, 24] });
      }
    });
  }

  // Does pixelfx show this status on this body right now (so the old look steps aside)?
  // Only when it can really be drawn: a body pixelfx cannot read (no sprite frame to wrap)
  // keeps the old look rather than showing nothing.
  owns(actor, statusId) {
    const id = STATUS_FX[statusId];
    if (!id) return false;
    const rec = this.live.get(actor)?.get(id);
    return !!(rec && rec.handle && this.host.playing(rec.handle) && this.host.actorOf?.(actor));
  }

  update(dt) {
    this._t += dt;
    const g = this.game;
    const want = this._want;
    want.clear();
    const cam = g.camera;
    const near = (e) => !cam || (e.x > cam.x - NEAR && e.x < cam.x + cam.vw + NEAR && e.y > cam.y - NEAR && e.y < cam.y + cam.vh + NEAR + 40);
    const add = (e, id) => {
      let m = want.get(e);
      if (!m) want.set(e, (m = new Set()));
      m.add(id);
    };
    // The Weave's statuses.
    const list = g.magic?.status?.afflicted || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const l = a.magicStatus;
      if (!l || !l.length || a.removed || a.dead || a.hidden || !near(a)) continue;
      for (let k = 0; k < l.length; k++) {
        const id = STATUS_FX[l[k].id];
        if (id) add(a, id);
      }
    }
    // The fallen bleed where they lie (DESIGN §27).
    const ents = g.entities?.all?.() || [];
    const surv = g.survival;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.type !== 'actor' || e.removed || e.dead || e.hidden || e.carriedBy) continue;
      let down = false;
      try {
        down = !!(surv?.isFallen?.(e) || e.downed);
      } catch {
        down = !!e.downed;
      }
      if (down && near(e)) add(e, 'st-bleed');
    }
    // Berserk's price on the player: seething until it runs out.
    const p = g.player;
    if (p && !p.removed && g.prices?.state?.berserk && !p.downed) add(p, 'st-rage');
    this._sync(want);
    this._ambience(dt);
  }

  // Sparse life in the air (fireflies and falling leaves are weather.js's): butterflies over
  // the grass by day, bats at dusk. A few at a time, near the view, never indoors, in rain
  // or under reduced motion.
  _ambience(dt) {
    const g = this.game;
    const host = this.host;
    const cam = g.camera;
    const list = this.critters;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.mover.step(dt, c.home);
      const m = c.mover;
      const far = !cam || m.x < cam.x - 160 || m.x > cam.x + cam.vw + 160 || m.y < cam.y - 160 || m.y > cam.y + cam.vh + 160;
      if (m.removed || far || !host.playing(c.handle)) {
        host.stop(c.handle);
        list.splice(i, 1);
      }
    }
    this._ambT -= dt;
    if (this._ambT > 0 || !cam || !g.map || host.reduceMotion) return;
    this._ambT = 1.2;
    const hour = g.clock?.hour ?? 12;
    const w = g.weather;
    if (w?.indoors || (w?.rain ?? 0) > 0.2 || (w?.snow ?? 0) > 0.3) return;
    const max = host.phone ? 2 : 3;
    const count = (k) => list.reduce((n, c) => n + (c.kind === k), 0);
    const rnd = Math.random;
    if (hour >= 8 && hour < 17.5 && count('butterfly') < max && rnd() < 0.5) {
      const x = cam.x + 20 + rnd() * (cam.vw - 40);
      const y = cam.y + 20 + rnd() * (cam.vh - 40);
      const tile = g.map.tileAt?.(Math.floor(x / 16), Math.floor(y / 16));
      if (tile === 1 || tile === 7) {
        const mover = wanderer(x, y, { speed: 10 + rnd() * 6, turn: 2.2, life: 25 + rnd() * 20, seed: rnd() });
        const hues = [
          ['#1a1030', '#3a2a6a', '#5a4ab0', '#7f9cff', '#bcd4ff', '#ffffff'],
          ['#2a1205', '#5c2c08', '#b0600e', '#f5a52c', '#ffe08a', '#ffffff'],
          ['#1a0516', '#4a1240', '#a0307a', '#f070b0', '#ffc0e0', '#ffffff'],
          ['#101a10', '#2a4a20', '#5a9a40', '#c0e070', '#f0ffc0', '#ffffff'],
        ];
        const handle = host.play('butterfly', { follow: mover, palette: hues[Math.floor(rnd() * hues.length)], seed: Math.floor(rnd() * 97) });
        if (handle) list.push({ kind: 'butterfly', mover, handle, home: { x, y } });
      }
    }
    if (hour >= 18.6 && hour < 20.8 && count('bat') < max && rnd() < 0.45) {
      // in from an edge, across the view in jinks, and away
      const side = Math.floor(rnd() * 4);
      const x = side === 0 ? cam.x - 20 : side === 1 ? cam.x + cam.vw + 20 : cam.x + rnd() * cam.vw;
      const y = side === 2 ? cam.y - 20 : side === 3 ? cam.y + cam.vh + 20 : cam.y + rnd() * cam.vh;
      const mover = wanderer(x, y, { speed: 34 + rnd() * 16, turn: 4, life: 9 + rnd() * 5, seed: rnd() });
      const tx = cam.x + cam.vw * (0.2 + rnd() * 0.6);
      const ty = cam.y + cam.vh * (0.2 + rnd() * 0.6);
      mover.heading = Math.atan2(ty - y, tx - x);
      const handle = host.play('bat', { follow: mover, seed: Math.floor(rnd() * 97) });
      if (handle) list.push({ kind: 'bat', mover, handle, home: null });
    }
  }

  _sync(want) {
    const host = this.host;
    // Stop what is no longer wanted.
    for (const [e, m] of this.live) {
      const w = want.get(e);
      for (const [id, rec] of m) {
        if (w && w.has(id)) continue;
        if (rec.handle) host.stop(rec.handle);
        m.delete(id);
      }
      if (!m.size) this.live.delete(e);
    }
    // Start what is wanted and not playing.
    for (const [e, w] of want) {
      let m = this.live.get(e);
      if (!m) this.live.set(e, (m = new Map()));
      for (const id of w) {
        let rec = m.get(id);
        if (rec && rec.handle && host.playing(rec.handle)) continue;
        if (rec && this._t < rec.retry) continue;
        const { h, w: bw } = bodySize(this.game, e);
        const handle = host.play(id, { follow: e, tag: `body:${id}`, seed: (e.uid || e.id?.length || 1) % 97, bounds: [-Math.max(26, bw + 14), -Math.max(46, h + 26), Math.max(26, bw + 14), 16] });
        if (!rec) m.set(id, (rec = { handle: null, retry: 0 }));
        rec.handle = handle;
        rec.retry = this._t + RETRY;
      }
    }
  }
}
