// Small health bars under whoever was just hurt (the author: "the spells do not do any
// damage" — hits must read). A creature or a boss that takes a blow shows a bar at its
// feet (over its head rise the damage numbers, and names, speech and icons sit): what
// is left, a pale stretch for what it just lost (draining after a beat), and a white
// blink on the hit. A villager or Lyra who is hurt shows a thinner, quieter bar. Bars
// fade a few seconds after the last hit. Drawn in screen space over the light map and
// the speech, so they read at night and in a crowd; never under the player (the HUD has
// their health).
//
//   new HealthBars(game)      listens for 'damage' and 'death' on game.bus
//   bars.draw(ctx, renderer, dt)
//   bars.shown()              [{ actor, frac, alpha }] (tests, screenshots)

import { isParty } from '../core/party.js';

const HOLD = 3.2; // seconds a bar stays after the last hit
const FADE = 0.6;
const LAG_WAIT = 0.35; // the pale "just lost" stretch waits this long, then drains
const LAG_RATE = 0.9; // of the bar per second
const MAX_BARS = 24;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Is this someone on the player's side (a quieter bar)?
function friendly(game, a) {
  if (!a) return false;
  if (a === game.companion || a.id === 'lyra' || isParty(game, a)) return true;
  if (a.profile || a.faction === 'village' || a.faction === 'guard') return true;
  try {
    return !!game.combat?.isLawful?.(a);
  } catch {
    return false;
  }
}

export class HealthBars {
  constructor(game) {
    this.game = game;
    this.bars = new Map(); // actor -> { t, lag, blink, friend }
    const bus = game?.bus;
    bus?.on?.('damage', (p) => this.onDamage(p));
    bus?.on?.('death', (p) => p?.entity && this.bars.delete(p.entity));
    bus?.on?.('game_start', () => this.bars.clear());
  }

  onDamage(p) {
    const a = p?.target;
    const g = this.game;
    if (!a || a === g.player || a.removed || !(a.maxHp > 0)) return;
    if (!(p.amount > 0) && !(p.absorbed > 0)) return;
    let b = this.bars.get(a);
    if (!b) {
      if (this.bars.size >= MAX_BARS) {
        // Make room: the bar that has waited longest goes.
        let oldest = null;
        for (const [k, v] of this.bars) if (!oldest || v.t > oldest[1].t) oldest = [k, v];
        if (oldest) this.bars.delete(oldest[0]);
      }
      b = { t: 0, lag: clamp01(((a.hp || 0) + (p.amount || 0)) / a.maxHp), blink: 0, friend: friendly(g, a), since: 0 };
      this.bars.set(a, b);
    }
    b.t = 0;
    b.since = 0;
    b.blink = 1;
  }

  shown() {
    const out = [];
    for (const [a, b] of this.bars) out.push({ actor: a, frac: clamp01((a.hp || 0) / a.maxHp), alpha: this._alpha(b), friend: b.friend });
    return out;
  }

  _alpha(b) {
    return b.t < HOLD ? 1 : Math.max(0, 1 - (b.t - HOLD) / FADE);
  }

  update(dt) {
    for (const [a, b] of this.bars) {
      b.t += dt;
      b.since += dt;
      b.blink = Math.max(0, b.blink - dt * 5);
      const frac = clamp01((a.hp || 0) / a.maxHp);
      if (b.lag < frac) b.lag = frac;
      else if (b.since > LAG_WAIT) b.lag = Math.max(frac, b.lag - dt * LAG_RATE);
      if (a.removed || a.dead || b.t > HOLD + FADE) this.bars.delete(a);
    }
  }

  draw(ctx, r, dt = 0) {
    if (dt > 0) this.update(Math.min(0.1, dt));
    if (!this.bars.size) return;
    const g = this.game;
    const cam = g.camera;
    const s = r.scale;
    const dpr = r.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    for (const [a, b] of this.bars) {
      if (a.hidden || a.inBed) continue;
      if (cam?.inView && !cam.inView(a.x, a.y, 24)) continue;
      const alpha = this._alpha(b) * (b.friend ? 0.78 : 1);
      if (alpha <= 0.02) continue;
      const frac = clamp01((a.hp || 0) / a.maxHp);
      // Size in device pixels: about 18 world px wide (bosses 34), never too small to see.
      const worldW = a.boss ? 34 : b.friend ? 14 : Math.max(14, Math.min(24, (a.radius || 6) * 2.6));
      const w = Math.round(Math.max(worldW * s, (b.friend ? 26 : 32) * dpr));
      const h = Math.round(Math.max((b.friend ? 2 : 3) * dpr, (b.friend ? 1.5 : 2.2) * s));
      const pad = Math.max(1, Math.round(dpr));
      // Under the feet (below the shadow): the space over a head belongs to names,
      // speech, icons and the damage numbers rising out of the hit.
      const cx = (a.x - r.ox) * s - r.subX;
      const top = (a.y + (a.boss ? 6 : 3) - r.oy) * s - r.subY;
      const x = Math.round(cx - w / 2);
      const y = Math.round(top);
      ctx.globalAlpha = alpha;
      // frame
      ctx.fillStyle = 'rgba(12, 8, 20, 0.85)';
      ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
      // the stretch just lost (pale), then what is left
      const lagW = Math.round(w * b.lag);
      const leftW = Math.round(w * frac);
      if (lagW > leftW) {
        ctx.fillStyle = '#f4ead7';
        ctx.fillRect(x + leftW, y, lagW - leftW, h);
      }
      ctx.fillStyle = b.friend ? (frac < 0.35 ? '#e8a23a' : '#58cf8f') : frac < 0.3 ? '#ff8a3d' : '#e0433a';
      ctx.fillRect(x, y, leftW, h);
      if (h >= 3 * dpr) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x, y, leftW, Math.max(1, Math.round(h / 3)));
      }
      if (b.blink > 0) {
        ctx.globalAlpha = alpha * b.blink * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
      }
    }
    ctx.globalAlpha = 1;
  }
}
