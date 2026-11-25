import { PixelFx } from './pixel_fx.js';
import { PIXEL_FX, rampOf } from './pixel_fx_catalog.js';
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
