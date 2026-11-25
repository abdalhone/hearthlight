import { PixelFx } from './pixel_fx.js';
import { PIXEL_FX, RAMP, rampOf } from './pixel_fx_catalog.js';
import { actorOf, bodySize } from './pixel_fx_bodies.js';

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
export function playHit(game, target, { dx = 0, dy = 0, crit = false, pal = null, heavy = false } = {}) {
  const P = px(game);
  if (!P || !target) return null;
  const { h } = bodySize(game, target);
  const height = Math.max(6, Math.round(h * 0.5)) + Math.round(target.z || 0);
  const big = Math.min(1.6, Math.max(1, h / 22));
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
  return P.play('punch', { x, y, angle, palette: rampOf(pal), size: 0.75 * size, seed: (Math.random() * 1e6) | 0 });
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

// Something picked up, a chest's haul, a level-up.
export function playCollect(game, x, y, { gold = true, pal = null, size = 1, height = 6 } = {}) {
  const P = px(game);
  if (!P) return null;
  return P.play('collect', { x, y, height, palette: pal ? rampOf(pal) : gold ? RAMP.gold : RAMP.item, size, seed: (Math.random() * 1e6) | 0 });
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
    // A level gained: a burst of gold at the chest of whoever rose.
    on('level_up', (p) => {
      const e = p.entity;
      if (e && (e === g.player || e === g.companion)) playCollect(g, e.x, e.y, { gold: true, size: 1.2, height: Math.round(bodySize(g, e).h * 0.55) });
    });
    // Back on their feet (a potion, a hand up, the sickroom, the kept flame): life climbs
    // back up the body in gold.
    on('revived', (p) => {
      if (p.entity) playHeal(g, p.entity, 'gold');
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
      else this.host.play('soul-rise', { follow: b, height: Math.max(30, bodySize(g, b).h * 1.6), seed: 7 });
    });
  }

  // Does pixelfx show this status on this body right now (so the old look steps aside)?
  owns(actor, statusId) {
    const id = STATUS_FX[statusId];
    if (!id) return false;
    const rec = this.live.get(actor)?.get(id);
    return !!(rec && rec.handle && this.host.playing(rec.handle));
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
