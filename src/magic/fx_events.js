import { planLook, essenceLook, reactionLook, statusLook } from './fx_styles.js';
import { FX } from './fx_effects.js';
import { silhouetteOf } from './fx_draw.js';
import { TAU } from './fx_util.js';
import { playPunch, playBind, playWardHit } from '../render/pixel_fx_play.js';

// What happens on screen (and in the ears) when the runtime reports something (the
// runtime calls game.magicFx.onEvent(type, payload, magic); types are listed in the
// header of magic.js). Each handler throws particles, spawns flourishes, flashes light,
// shakes the camera a little, and plays the matching synthesized sound.

const isMissile = (b) => b.kind === 'projectile' && (b.mode === 'fly' || b.mode === 'orb' || b.mode === 'arc');

const volleys = new WeakMap(); // cast -> volley shots so far (rising pitch)

// Hits land with pixelfx's hit spark (src/render/pixel_fx_play.js, played by combat).
const pixelHits = (fx) => !!fx.game?.pixelFx?.has?.('hit');

function burstStyles(fx, list, x, y, z, n, speed = 1, ang = NaN, spread = TAU) {
  if (!list || !list.length) return;
  const per = Math.max(1, Math.round(n / list.length));
  for (let i = 0; i < list.length && i < 3; i++) fx.parts.burst(list[i].style, list[i].pal, x, y, z, per, speed, ang, spread);
}

function ring(fx, x, y, r0, r1, color, color2, life = 0.3, w = 1, z = 0, sq = 0.6) {
  const e = fx.effects.spawn(FX.RING, x, y, life);
  if (!e) return null;
  e.r0 = r0;
  e.r1 = r1;
  e.color = color;
  e.color2 = color2;
  e.w = w;
  e.z = z;
  e.sq = sq;
  return e;
}

function star(fx, x, y, r1, color, color2, life = 0.18, z = 0) {
  const e = fx.effects.spawn(FX.STAR, x, y, life);
  if (!e) return null;
  e.r1 = r1;
  e.color = color;
  e.color2 = color2;
  e.z = z;
  return e;
}

function isFriendly(fx, a) {
  const g = fx.game;
  if (!a) return false;
  if (a === g.player || a === g.companion || a.id === 'player' || a.id === 'lyra') return true;
  try {
    return !!g.combat?.isLawful?.(a);
  } catch {
    return false;
  }
}

// An afterimage of an actor's current frame, tinted, at its current spot.
function ghostOf(fx, actor, color, life, delay = 0, alpha = 0.55, atX, atY) {
  const F = fx.frameOf(actor);
  if (!F || !F.img) return null;
  const img = silhouetteOf(F.img, color);
  if (!img) return null;
  const e = fx.effects.spawn(FX.GHOST, (atX ?? actor.x) - F.ax, (atY ?? actor.y) - F.ay - (actor.z || 0), life);
  if (!e) return null;
  e.img = img;
  e.delay = delay;
  e.w = alpha;
  return e;
}

// Where a ward was just struck (its ripple, drawn by fx_wards), plus a little of its
// essence thrown off there and a flash.
function markHit(fx, b, x, y) {
  const fs = b.fxState || (b.fxState = {});
  fs.hitAge = b.age;
  fs.hx = x;
  fs.hy = y;
  const L = planLook(b.plan);
  // A spark glancing off the shell (pixelfx), thrown outward from the ward's middle.
  if (!playWardHit(fx.game, x, y, Math.atan2(y - (b.y - 9), x - b.x), L.pal)) burstStyles(fx, L.debris, x, y + 9, 9, 4, 0.9);
  fx.flash(x, y, 30, L.lightColor, 0.55, 0.12);
}

const H = {
  cast(fx, p) {
    const plan = p.plan;
    const caster = p.caster;
    if (!plan || !caster) return;
    const L = planLook(plan);
    const P = L.pal;
    const ang = Number.isFinite(p.angle) ? p.angle : 0;
    const hx = p.x + Math.cos(ang) * 7;
    const hy = p.y + Math.sin(ang) * 4;
    const cast = p.cast;
    const base = cast?.plan;
    const echo = !!(base && plan !== base && base.twists?.includes('echo') && !plan.twists.includes('echo'));
    const volley = !!(base && plan !== base && base.twists?.includes('volley') && !plan.twists.includes('volley'));
    fx.sound.stopLoop(`ch:${caster.id}`);
    // The cast sigil: a glyph circle at the hands (on the ground for novas, summons and runes).
    if (plan.shape === 'nova') {
      const e = fx.effects.spawn(FX.SIGIL, p.x, p.y, 0.45);
      if (e) {
        e.pal = P;
        e.r1 = Math.min(26, 10 + plan.radius * 0.25);
        e.glyph = L.look.glyph;
        e.ang = ang;
      }
    } else if (plan.shape !== 'dash' && plan.shape !== 'summon' && plan.shape !== 'rune') {
      const e = fx.effects.spawn(FX.SIGIL, hx, hy, echo ? 0.25 : 0.32);
      if (e) {
        e.pal = P;
        e.r1 = 5 + Math.min(4, (plan.size || 1) * 1.5);
        e.z = 10;
        e.ang = ang;
      }
    }
    // A spray of the weave's own stuff from the hands.
    burstStyles(fx, L.trail, hx, hy, 10, plan.shape === 'blast' ? 10 : 5, 0.8, ang, 0.9);
    if (plan.count > 1 && (plan.kind === 'projectile' || plan.shape === 'beam')) {
      const e = fx.effects.spawn(FX.FAN, hx, hy, 0.16);
      if (e) {
        e.n = Math.min(9, plan.count);
        e.ang = ang;
        e.w = plan.shape === 'beam' ? 0.26 : 0.3;
        e.color = P.core;
        e.color2 = P.spark;
        e.z = 10;
      }
    }
    if (plan.shape === 'summon') {
      for (const b of p.bodies || []) {
        const e = fx.effects.spawn(FX.SIGIL, b.x, b.y, 0.6);
        if (e) {
          e.pal = P;
          e.r1 = 9;
          e.glyph = L.look.glyph;
        }
        fx.parts.burst('twinkle', P, b.x, b.y, 4, 8, 1.2);
      }
    }
    if (plan.shape === 'rain' && cast) ring(fx, cast.aimX, cast.aimY, 4, plan.radius, P.glow, P.spark, 0.4, 1);
    if (plan.shape === 'wall') {
      for (const b of p.bodies || []) {
        const n = Math.round((b.len || 40) / 6);
        for (let i = 0; i <= n; i++) {
          const k = i / Math.max(1, n);
          fx.parts.burst('dust', P, b.ox + (b.x2 - b.ox) * k, b.oy + (b.y2 - b.oy) * k, 0, 1, 0.6);
        }
      }
    }
    if (echo) ghostOf(fx, caster, P.glow, 0.45, 0, 0.5);
    // A charged release (hold to charge): a burst at the hands that grows with the charge;
    // a full one throws a star and a wider ring, and kicks the camera a little.
    const ck = !echo && !volley && cast?.plan === plan ? Math.max(0, Math.min(1, cast?.chargeK || 0)) : 0;
    if (ck > 0.05) {
      ring(fx, hx, hy, 3, 8 + 16 * ck, P.core, P.glow, 0.22 + 0.12 * ck, ck >= 0.999 ? 2 : 1, 10);
      fx.parts.burst('twinkle', P, hx, hy, 10, Math.round(3 + 9 * ck), 0.9 + 0.8 * ck);
      if (ck >= 0.999) {
        star(fx, hx, hy, 14, '#ffffff', L.halo, 0.2, 10);
        fx.shake(1.1, 0.1);
      }
    }
    if (volley) {
      const n = (volleys.get(cast) || 0) + 1;
      volleys.set(cast, n);
      ring(fx, hx, hy, 2, 9, P.core, P.glow, 0.18, 1, 10);
    }
    fx.flash(hx, hy - 10, (26 + (plan.size || 1) * 10) * (1 + 0.6 * ck), L.lightColor, echo ? 0.35 : 0.6 + 0.3 * ck, 0.14 + 0.08 * ck);
    // A dash cast: afterimages along the path in the weave's colors.
    const d = fx._pendingDash;
    if (d && d.caster === caster) {
      fx._pendingDash = null;
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const k = i / steps;
        ghostOf(fx, caster, i & 1 ? P.glow : P.spark, 0.32, d.dur * k, 0.55 - k * 0.25, d.x + Math.cos(d.angle) * d.dist * k, d.y + Math.sin(d.angle) * d.dist * k);
      }
      fx.parts.burst('dust', P, d.x, d.y, 0, 6, 1);
      fx.sound.cue('dash', d.x, d.y, plan);
      return;
    }
    const vol = volley ? volleys.get(cast) || 1 : 0;
    fx.sound.cast(plan, p.x, p.y, { echo, volley, pitch: volley ? 1 + vol * 0.07 : 1 });
  },

  spawn(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    const cast = b.cast;
    const fs = b.fxState || (b.fxState = {});
    fs.acc = 0;
    fs.acc2 = 0;
    fs.sx = b.x;
    fs.sy = b.y;
    fs.lunge = 0;
    fs.echo = !!(cast?.plan && cast.plan.twists?.includes('echo') && !b.plan.twists.includes('echo'));
    if (b.kind === 'rune') fs.arm = b.armT > 0 ? b.armT : 0.6;
    if (b.kind === 'ward') {
      // A ward rises: a sigil under the bearer, a ring climbing the dome.
      const e = fx.effects.spawn(FX.SIGIL, b.x, b.y, 0.5);
      if (e) {
        e.pal = L.pal;
        e.r1 = Math.min(26, (b.r || 13) * 1.1);
        e.glyph = L.look.glyph;
      }
      ring(fx, b.x, b.y, 3, (b.r || 13) * 1.1, L.pal.core, L.pal.glow, 0.35, 1, 0, 0.42);
      ring(fx, b.x, b.y - 9, 2, b.r || 13, L.pal.spark, L.pal.glow, 0.4, 1, 0, 1.08);
      burstStyles(fx, L.trail, b.x, b.y, 4, 8, 0.8);
    } else if (b.kind === 'summon') {
      burstStyles(fx, L.debris, b.x, b.y, 6, 10, 1);
      ring(fx, b.x, b.y, 2, 14, L.pal.core, L.pal.glow, 0.35, 1);
    } else if (b.kind === 'projectile' && b.mode === 'arc') {
      fx.parts.burst('zap', L.pal, b.x, b.y, 6, 2, 1);
    }
  },

  launch(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    burstStyles(fx, L.trail, b.x, b.y, b.z || 8, 4, 1, b.angle + Math.PI, 0.8);
    ring(fx, b.x, b.y, 1, 6, L.pal.core, L.pal.glow, 0.16, 1, b.z || 8);
  },

  hit(fx, p, magic) {
    const b = p.body;
    const target = p.target;
    if (!b || !target) return;
    const plan = b.plan;
    const L = planLook(plan);
    const P = L.pal;
    const g = fx.game;
    const x = p.x;
    const y = p.y;
    const z = 8 + (target.z || 0);
    const big = Math.min(2, plan.size || 1);
    if (p.tick) {
      if (Math.random() < 0.5) burstStyles(fx, L.debris, x, y, z, 1, 0.6);
    } else {
      const dir = b.kind === 'projectile' && (b.vx || b.vy) ? Math.atan2(b.vy, b.vx) : Math.atan2(y - b.y, x - b.x);
      // The pixelfx hit spark (combat played it, in this weave's colors) is the impact now;
      // a pinch of the essence's own stuff stays for its flavor.
      if (pixelHits(fx)) burstStyles(fx, L.debris, x, y, z, 2, 0.7, dir, 1.4);
      else burstStyles(fx, L.debris, x, y, z, Math.round(6 * big), 1, dir, 1.8);
      fx.flash(x, y - 8, 22 + 8 * big, L.lightColor, 0.5, 0.1);
      // The number combat just floated over the target, tinted by the essence.
      const n = g.bubbles?.lastNumber;
      if (n && n.active && n.t === 0 && n.kind === 'damage') n.fill = L.number;
    }
    const last = fx._lastDamage;
    const crit = !p.tick && last && last.target === target && last.crit;
    if (crit) {
      if (!pixelHits(fx)) {
        star(fx, x, y, 11, '#ffffff', L.halo, 0.22, z);
        fx.parts.burst('spark', P, x, y, z, 6, 1.3);
      }
      fx.sound.cue('crit', x, y);
      fx.hitStop(0.035);
    }
    const dead = target.dead || target.hp <= 0;
    if (dead && !p.tick) {
      burstStyles(fx, L.debris, x, y, z, 14, 1.4);
      ring(fx, x, y, 3, 20, P.core, P.glow, 0.35, 2);
      fx.hitStop(0.05);
      fx.shake(1.6, 0.14);
    }
    if (!p.tick && isMissile(b)) {
      if (plan.twists.includes('split')) {
        ring(fx, x, y, 1, 10, P.core, P.spark, 0.2, 1, z);
        fx.parts.burst('spark', P, x, y, z, 6, 1.2);
        fx.sound.cue('split', x, y);
      }
      if (plan.pierce > 0 && b.active && !b.ending) {
        const e = fx.effects.spawn(FX.FAN, x, y, 0.14);
        if (e) {
          e.n = 1;
          e.ang = Math.atan2(b.vy, b.vx);
          e.w = 0;
          e.color = P.core;
          e.color2 = P.spark;
          e.z = z;
        }
      }
    }
    if (!p.tick && plan.twists.includes('leech') && b.owner && p.amount > 0) {
      const e = fx.effects.spawn(FX.THREAD, x, y, 0.55);
      if (e) {
        e.a = target;
        e.b = b.owner;
        e.color = '#9ff0b8';
        e.color2 = P.glow;
      }
    }
    if (b.kind === 'strike' && !p.tick) fx.shake(1.4, 0.1);
    if (isFriendly(fx, target)) {
      if (!p.tick) g.audio?.play?.('hurt', { x, y });
    } else fx.sound.hit(plan, x, y, { tick: p.tick, heavy: b.kind === 'strike' || (b.kind === 'area' && b.mode === 'burst') });
  },

  end(fx, p) {
    const b = p.body;
    if (!b || !b.plan) return;
    const L = planLook(b.plan);
    const P = L.pal;
    const why = p.why;
    if (b.kind === 'projectile') {
      if (b.mode === 'fly' && why === 'wall') {
        burstStyles(fx, L.debris, b.x, b.y, b.z, 5, 0.9);
        ring(fx, b.x, b.y, 1, 7, P.core, P.glow, 0.18, 1, b.z);
        fx.sound.hit(b.plan, b.x, b.y, { tick: true });
      } else if (b.mode === 'fly' && why === 'expire') {
        burstStyles(fx, L.trail, b.x, b.y, b.z, 3, 0.5);
      } else if (b.mode === 'orb' && why !== 'dismiss') {
        burstStyles(fx, L.debris, b.x, b.y, b.z, 10, 1.1);
        ring(fx, b.x, b.y, 2, b.r * 2.5, P.core, P.glow, 0.3, 2);
      } else if (b.mode === 'arc' && why === 'hit') {
        star(fx, b.x, b.y, 6, P.core, L.halo, 0.14, 6);
      }
    } else if (b.kind === 'summon') {
      burstStyles(fx, L.debris, b.x, b.y, b.z || 6, 12, 1);
      fx.parts.burst('smoke', P, b.x, b.y, 4, 3, 0.6);
      ring(fx, b.x, b.y, 2, 12, P.core, P.glow, 0.3, 1);
      fx.sound.cue('pulse', b.x, b.y);
    } else if (b.kind === 'wall') {
      const n = Math.max(2, Math.round((b.len || 40) / 5));
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        burstStyles(fx, L.debris, b.ox + (b.x2 - b.ox) * k, b.oy + (b.y2 - b.oy) * k, 6, 1, 0.7);
      }
    } else if (b.kind === 'rune' && why === 'trigger') {
      const e = fx.effects.spawn(FX.PILLAR, b.x, b.y, 0.4);
      if (e) {
        e.r1 = 6;
        e.r0 = 0;
        e.color = P.core;
        e.color2 = P.glow;
      }
    }
  },

  explode(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    const P = L.pal;
    const x = p.x;
    const y = p.y;
    const r = Math.max(6, p.r || 20);
    const n = Math.min(30, 8 + r * 0.5);
    burstStyles(fx, L.debris, x, y, 4, n, Math.min(2, 0.7 + r / 40));
    if (L.smoke) fx.parts.burst('smoke', P, x, y, 6, Math.round(2 + r / 12), 0.8);
    ring(fx, x, y, r * 0.3, r * 1.15, P.core, P.glow, 0.36, 2);
    switch (L.leadId) {
      case 'frost': {
        const e = fx.effects.spawn(FX.SHARDS, x, y, 0.6);
        if (e) {
          e.n = 8;
          e.r1 = r * 0.7;
          e.pal = P;
        }
        break;
      }
      case 'nature': {
        const e = fx.effects.spawn(FX.VINES, x, y, 0.8);
        if (e) {
          e.n = 7;
          e.r1 = r * 0.55;
          e.pal = P;
        }
        break;
      }
      case 'light': {
        const e = fx.effects.spawn(FX.RAYS, x, y, 0.3);
        if (e) {
          e.n = 10;
          e.r0 = 4;
          e.r1 = r;
          e.z = 6;
          e.color = P.core;
          e.color2 = P.spark;
          e.ang = Math.random();
        }
        break;
      }
      case 'storm': {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU;
          const e = fx.effects.spawn(FX.ZAP, x, y, 0.18);
          if (e) {
            e.x2 = x + Math.cos(a) * r;
            e.y2 = y + Math.sin(a) * r * 0.6;
            e.z = 4;
            e.color = P.core;
            e.color2 = P.glow;
          }
        }
        break;
      }
      case 'dark': {
        const e = fx.effects.spawn(FX.ECLIPSE, x, y + 8, 0.4);
        if (e) {
          e.r1 = r * 0.7;
          e.color = P.glow;
          e.color2 = P.spark;
        }
        break;
      }
      default:
        break;
    }
    fx.flash(x, y - 6, r * 2.4, L.lightColor, 0.95, 0.3);
    if (r >= 18) fx.shake(Math.min(4, r / 14), 0.18);
    if (r >= 36 || (b.heavy && r >= 24)) fx.hitStop(0.04);
    fx.sound.explode(b.plan, x, y, r);
  },

  bounce(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    fx.parts.burst('spark', L.pal, p.x, p.y, b.z || 6, 5, 1);
    ring(fx, p.x, p.y, 1, 8, L.pal.core, L.pal.glow, 0.2, 1, b.z || 6);
    fx.sound.cue('bounce', p.x, p.y);
  },

  pulse(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    ring(fx, b.x, b.y, b.r, b.pulseR || b.r * 2.6, L.pal.glow, L.pal.spark, 0.4, 1);
    if (!p.empty) {
      burstStyles(fx, L.debris, b.x, b.y, b.z || 8, 3, 0.8);
      fx.sound.cue('pulse', b.x, b.y);
    }
  },

  impact(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    const P = L.pal;
    const x = p.x;
    const y = p.y;
    if (b.kind === 'strike') {
      // The punch (pixelfx's blunt hit, top-down) carries the blow; the old star and
      // spray only when it could not play.
      const punched = !!playPunch(fx.game, x, y, b.angle, P, Math.min(1.4, (p.r || 12) / 12));
      if (!punched) {
        star(fx, x, y, 6, P.core, L.halo, 0.16, 8);
        burstStyles(fx, L.debris, x, y, 8, 8, 1.3, b.angle, 1.4);
        // (the punch has its own dust ring on the floor: one ring, not two)
        ring(fx, x, y, 2, (p.r || 12) * 1.6, P.core, P.glow, 0.25, 2, 4);
      }
      fx.shake(1.2, 0.1);
      // (the punch brings its own warm glow: the scene's flash is small with it, so a
      // night punch doesn't bloom white over the fight)
      fx.flash(x, y - 8, punched ? 20 : 36, L.lightColor, punched ? 0.32 : 0.8, 0.14);
      return;
    }
    // A rain drop landing.
    ring(fx, x, y, 1, p.r || 8, P.core, P.glow, 0.25, 1);
    burstStyles(fx, L.debris, x, y, 1, 3, 0.7);
    const fall = L.look.fall;
    const now = fx.game.time || 0;
    if (fall === 'bolt' && now - (fx._skyboltAt || 0) > 0.09) {
      fx._skyboltAt = now;
      const e = fx.effects.spawn(FX.SKYBOLT, x, y, 0.22);
      if (e) {
        e.color = P.core;
        e.color2 = P.glow;
      }
      fx.flash(x, y - 20, 60, L.lightColor, 0.8, 0.12);
    } else if (fall === 'ray') {
      const e = fx.effects.spawn(FX.PILLAR, x, y, 0.25);
      if (e) {
        e.r1 = 3;
        e.r0 = -20;
        e.color = P.core;
        e.color2 = P.glow;
      }
    } else if (fall === 'meteor') fx.parts.burst('smoke', P, x, y, 2, 1, 0.5);
    fx.sound.hit(b.plan, x, y, { tick: true, volume: 0.8 });
  },

  armed(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    ring(fx, b.x, b.y, 4, (b.trigR || 14) + 8, L.pal.core, L.pal.glow, 0.35, 1);
    fx.parts.burst('twinkle', L.pal, b.x, b.y, 2, 6, 1);
    fx.sound.cue('armed', b.x, b.y);
  },

  patch(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    burstStyles(fx, L.debris, b.x, b.y, 2, 6, 0.7);
    ring(fx, b.x, b.y, 2, b.r1 || 14, L.pal.glow, L.pal.spark, 0.3, 1);
  },

  block(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    star(fx, p.x, p.y, 6, L.pal.core, L.halo, 0.15, 6);
    fx.parts.burst('spark', L.pal, p.x, p.y, 6, 5, 1);
    fx.sound.cue('block', p.x, p.y);
  },

  status(fx, p) {
    const t = p.target;
    const def = p.def;
    if (!t || !def) return;
    const look = statusLook(def);
    const pal = fx.statusPal(def);
    const style = look.parts?.[0]?.[0] || 'twinkle';
    fx.parts.burst(style, pal, t.x, t.y, 10 + (t.z || 0), 6, 1);
    if (def.id === 'frozen') {
      const e = fx.effects.spawn(FX.SHARDS, t.x, t.y + 1, 0.45);
      if (e) {
        e.n = 6;
        e.r1 = 9;
        e.pal = pal;
      }
    }
    fx.sound.status(def.id, t.x, t.y);
  },

  reaction(fx, p) {
    const x = p.x;
    const y = p.y;
    const r = p.reaction || {};
    const look = reactionLook(p.id);
    const E = essenceLook(look.ess);
    const P = E.pal;
    const color = r.color || P.glow;
    const pal = { core: '#ffffff', glow: color, spark: P.spark, deep: P.deep };
    switch (look.kind) {
      case 'shock':
        star(fx, x, y, 14, '#ffffff', color, 0.25, 10);
        fx.parts.burst('zap', P, x, y, 10, 14, 1.4);
        ring(fx, x, y, 4, 34, '#ffffff', color, 0.3, 2);
        break;
      case 'freeze': {
        const e = fx.effects.spawn(FX.SHARDS, x, y, 0.7);
        if (e) {
          e.n = 9;
          e.r1 = 14;
          e.pal = P;
        }
        fx.parts.burst('snow', P, x, y, 10, 14, 1.2);
        ring(fx, x, y, 4, 26, '#ffffff', P.glow, 0.4, 2);
        break;
      }
      case 'firestorm': {
        const st = 'flame';
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * TAU;
          const rr = 8 + (i % 3) * 8;
          fx.parts.burst(st, P, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, 2, 1, 1.4, a + Math.PI / 2, 0.4);
        }
        fx.parts.burst('smoke', P, x, y, 8, 3, 0.8);
        ring(fx, x, y, 6, 46, P.core, P.glow, 0.45, 2);
        break;
      }
      case 'wildfire':
        fx.parts.burst('flame', P, x, y, 1, 28, 2.4);
        fx.parts.burst('ember', P, x, y, 6, 10, 1.4);
        ring(fx, x, y, 4, 42, P.spark, P.glow, 0.5, 2);
        break;
      case 'steam':
        fx.parts.burst('steam', P, x, y, 6, 16, 1.6);
        ring(fx, x, y, 4, 36, '#ffffff', '#e8eef2', 0.4, 1);
        break;
      case 'mud':
        fx.parts.burst('mud', P, x, y, 2, 14, 1.2);
        ring(fx, x, y, 4, 30, '#8a6a3e', '#5a3f22', 0.35, 2);
        break;
      case 'eclipse': {
        const e = fx.effects.spawn(FX.ECLIPSE, x, y, 0.7);
        if (e) {
          e.r1 = 46;
          e.color = '#c9a6ff';
          e.color2 = '#fff2c0';
        }
        fx.parts.burst('wisp', essenceLook('dark').pal, x, y, 8, 10, 1.4);
        fx.parts.burst('mote', essenceLook('light').pal, x, y, 8, 10, 1.4);
        break;
      }
      case 'flare':
        fx.parts.burst('bubble', P, x, y, 6, 12, 1.4);
        fx.parts.burst('flame', essenceLook('fire').pal, x, y, 2, 12, 1.6);
        ring(fx, x, y, 4, 40, '#ffffff', color, 0.35, 2);
        break;
      case 'skybolt': {
        const e = fx.effects.spawn(FX.SKYBOLT, x, y, 0.3);
        if (e) {
          e.color = '#ffffff';
          e.color2 = essenceLook('storm').pal.glow;
        }
        fx.parts.burst('spark', essenceLook('iron').pal, x, y, 4, 12, 1.4);
        break;
      }
      case 'shatter': {
        const e = fx.effects.spawn(FX.SHARDS, x, y, 0.5);
        if (e) {
          e.n = 10;
          e.r1 = 18;
          e.pal = P;
        }
        fx.parts.burst('shard', P, x, y, 10, 18, 1.6);
        star(fx, x, y, 16, '#ffffff', P.glow, 0.22, 10);
        break;
      }
      case 'thaw':
        fx.parts.burst('steam', P, x, y, 8, 8, 1);
        fx.parts.burst('drip', P, x, y, 14, 8, 1);
        break;
      case 'miasma':
        fx.parts.burst('dust', P, x, y, 4, 18, 1.8);
        fx.parts.burst('bubble', P, x, y, 4, 8, 1.2);
        ring(fx, x, y, 6, 52, P.glow, P.spark, 0.5, 1);
        break;
      case 'overgrowth': {
        const e = fx.effects.spawn(FX.VINES, x, y, 0.9);
        if (e) {
          e.n = 8;
          e.r1 = 9;
          e.pal = P;
        }
        fx.parts.burst('leaf', P, x, y, 6, 12, 1.2);
        break;
      }
      case 'tempest':
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          fx.parts.burst(i & 1 ? 'gust' : 'zap', i & 1 ? essenceLook('wind').pal : P, x + Math.cos(a) * 14, y + Math.sin(a) * 9, 4, 1, 1.5, a + Math.PI / 2, 0.3);
        }
        ring(fx, x, y, 6, 50, '#ffffff', color, 0.4, 2);
        break;
      case 'bloom': {
        fx.parts.burst('petal', P, x, y, 6, 16, 1.3);
        fx.parts.burst('mote', essenceLook('light').pal, x, y, 4, 10, 1);
        ring(fx, x, y, 4, 60, '#fff2c0', P.glow, 0.6, 1);
        const e = fx.effects.spawn(FX.RAYS, x, y, 0.4);
        if (e) {
          e.n = 8;
          e.r0 = 4;
          e.r1 = 28;
          e.z = 8;
          e.color = '#fff2c0';
          e.color2 = P.glow;
        }
        break;
      }
      case 'dirge':
        fx.parts.burst('note', { core: '#e6d0ff', spark: '#c09cff', glow: '#8a3f9e', deep: '#2a1640' }, x, y, 12, 10, 1.2);
        ring(fx, x, y, 4, 30, '#c09cff', '#8a3f9e', 0.4, 2);
        break;
      case 'prism': {
        const e = fx.effects.spawn(FX.PRISM, x, y, 0.5);
        if (e) {
          e.r0 = 6;
          e.r1 = 48;
        }
        fx.parts.burst('twinkle', P, x, y, 10, 12, 1.4);
        break;
      }
      default:
        ring(fx, x, y, 4, 36, '#ffffff', color, 0.35, 2);
        fx.parts.burst('spark', pal, x, y, 10, 12, 1.3);
    }
    fx.flash(x, y - 8, 70, color, 0.9, 0.35);
    fx.shake(1.6, 0.15);
    fx.sound.reaction(p.id, x, y);
  },

  familiar(fx, p) {
    const b = p.body;
    if (!b) return;
    const L = planLook(b.plan);
    const fs = b.fxState || (b.fxState = {});
    fs.lunge = 0.3;
    if (p.attack === 'slam') {
      fx.parts.burst('dust', L.pal, b.x, b.y, 0, 6, 1.2);
      ring(fx, b.x, b.y, 2, 22, L.pal.core, L.pal.glow, 0.3, 1);
    } else fx.parts.burst(L.trail[0]?.style || 'mote', L.pal, b.x, b.y, (b.z || 8) + 4, 3, 1);
    fx.sound.cue('familiar', b.x, b.y, b.plan);
  },

  dash(fx, p) {
    const c = p.caster;
    if (!c) return;
    // The plan arrives with the cast event right after; keep what we need till then.
    fx._pendingDash = { caster: c, x: c.x, y: c.y, angle: p.angle || 0, dist: p.dist || 0, dur: p.dur || 0.15 };
  },

  charge(fx, p) {
    const c = p.caster;
    if (!c || !p.plan) return;
    const L = planLook(p.plan);
    if (p.start) fx.sound.startLoop(`ch:${c.id}`, p.plan, c.x, c.y, 'charge', p.rise);
    else if (p.cancel) {
      fx.sound.stopLoop(`ch:${c.id}`);
      if (!p.quiet) fx.parts.burst('dust', L.pal, c.x, c.y, 10, 4, 0.6);
    } else if (p.full) {
      star(fx, c.x, c.y, 12, '#ffffff', L.halo, 0.25, 10);
      ring(fx, c.x, c.y, 14, 3, L.pal.core, L.pal.glow, 0.3, 1, 10);
      fx.parts.burst('twinkle', L.pal, c.x, c.y, 10, 8, 1.4);
      fx.flash(c.x, c.y - 10, 40, L.lightColor, 0.7, 0.2);
      fx.sound.cue('charged', c.x, c.y);
    }
  },

  beam_start(fx, p) {
    const cast = p.cast;
    if (!cast || !p.caster) return;
    fx.sound.startLoop(`bm:${cast.id}`, cast.plan, p.caster.x, p.caster.y, 'beam');
  },

  beam_end(fx, p) {
    const id = p.body?.cast?.id;
    if (id != null) fx.sound.stopLoop(`bm:${id}`);
  },

  // ---------------------------------------------------------------- bind and ward (§22.5)

  // A ring closed on someone: it snaps in from wide, a flash, a lock-chime.
  bind(fx, p) {
    const t = p.target;
    if (!t || !p.plan) return;
    const L = planLook(p.plan);
    const P = L.pal;
    const r = Math.max(8, p.body?.r || 10);
    ring(fx, t.x, t.y, r * 2.8, r, P.core, P.glow, 0.22, 2, 0, 0.42);
    star(fx, t.x, t.y - 2, p.resisted ? 6 : 9, '#ffffff', L.halo, 0.2, 2);
    // Hands come up round them and hold on (pixelfx); the old spray when they cannot.
    const tag = p.body ? `bind:${p.body.uid ?? ''}` : null;
    if (p.resisted || !playBind(fx.game, t, P, tag)) {
      burstStyles(fx, L.debris, t.x, t.y, 2, p.resisted ? 4 : 8, 0.8);
      fx.parts.burst('twinkle', P, t.x, t.y, 4, 5, 1);
    }
    fx.flash(t.x, t.y - 6, 46, L.lightColor, p.resisted ? 0.55 : 0.85, 0.22);
    if (!p.resisted) fx.shake(0.8, 0.08);
    fx.sound.cue('bind', t.x, t.y, p.plan);
  },

  // It let go: the ring breaks into motes.
  unbind(fx, p) {
    const b = p.body;
    const t = p.target;
    if (!b?.plan || !t) return;
    const L = planLook(b.plan);
    fx.game.pixelFx?.stop?.(`bind:${b.uid ?? ''}`);
    ring(fx, t.x, t.y, b.r, b.r * 1.8, L.pal.spark, L.pal.glow, 0.25, 1, 0, 0.42);
    burstStyles(fx, L.trail, t.x, t.y, 2, 5, 0.6);
    fx.sound.cue('unbind', t.x, t.y, b.plan);
  },

  // A boss shrugged a bind off.
  bind_resist(fx, p) {
    const t = p.target;
    if (!t || !p.plan) return;
    const L = planLook(p.plan);
    ring(fx, t.x, t.y, 6, (t.radius || 8) + 14, L.pal.glow, '#8e8a95', 0.3, 1, 0, 0.42);
    fx.parts.burst('spark', L.pal, t.x, t.y, 4, 8, 1.3);
    fx.sound.cue('resist', t.x, t.y);
  },

  // A blow on a ward: a ripple where it landed (toward whoever struck), a glassy knock.
  ward_hit(fx, p) {
    const b = p.body;
    if (!b?.plan) return;
    const fs = b.fxState || (b.fxState = {});
    const src = p.source;
    const tgt = p.target || b.target;
    let ux = 0;
    let uy = -1;
    if (src && !src.removed) {
      const dx = src.x - tgt.x;
      const dy = src.y - tgt.y;
      const l = Math.hypot(dx, dy) || 1;
      ux = dx / l;
      uy = dy / l;
    }
    const r = b.cur || b.r;
    markHit(fx, b, tgt.x + ux * r, tgt.y - 9 + uy * r * 1.08);
    fx.sound.cue('ward_hit', tgt.x, tgt.y, b.plan);
  },

  // A missile stopped (or turned back, or turned aside) at the shell.
  ward_block(fx, p) {
    const b = p.body;
    if (!b?.plan) return;
    const L = planLook(b.plan);
    const P = L.pal;
    markHit(fx, b, p.x, p.y);
    if (p.how === 'reflect') {
      star(fx, p.x, p.y, 8, '#ffffff', L.halo, 0.18, 0);
      ring(fx, p.x, p.y, 1, 9, P.core, P.spark, 0.2, 1, 0, 0.8);
      fx.sound.cue('reflect', p.x, p.y);
    } else if (p.how === 'deflect') {
      fx.parts.burst('gust', P, p.x, p.y, 0, 4, 1.2);
      fx.sound.cue('deflect', p.x, p.y);
    } else {
      if (p.color) fx.parts.burst('drop', { core: p.color, glow: p.color, spark: p.color, deep: P.deep }, p.x, p.y, 0, 5, 1);
      fx.sound.cue('ward_hit', p.x, p.y, b.plan);
    }
  },

  // Another ward on top of one: it swells and brightens.
  ward_thicken(fx, p) {
    const b = p.body;
    if (!b?.plan) return;
    const L = planLook(b.plan);
    ring(fx, b.x, b.y - 9, (b.cur || b.r) * 0.6, (b.cur || b.r) * 1.2, L.pal.core, L.pal.glow, 0.3, 1, 0, 1.08);
    fx.parts.burst('twinkle', L.pal, b.x, b.y, 9, 6, 1);
    fx.sound.cue('thicken', b.x, b.y, b.plan);
  },

  // Spent: the shell shatters outward.
  ward_break(fx, p) {
    const b = p.body;
    if (!b?.plan) return;
    const L = planLook(b.plan);
    const P = L.pal;
    const r = b.cur || b.r;
    const e = fx.effects.spawn(FX.SHARDS, b.x, b.y, 0.55);
    if (e) {
      e.n = 10;
      e.r1 = r * 1.3;
      e.pal = P;
    }
    ring(fx, b.x, b.y - 9, r, r * 2, '#ffffff', P.glow, 0.3, 2, 0, 1.08);
    burstStyles(fx, L.debris, b.x, b.y, 9, 14, 1.3);
    fx.flash(b.x, b.y - 9, 60, L.lightColor, 0.8, 0.25);
    fx.shake(1.2, 0.12);
    fx.sound.cue('ward_break', b.x, b.y, b.plan);
  },

  link(fx, p) {
    if (!p.from || !p.to) return;
    const e = fx.effects.spawn(FX.ZAP, p.from.x, p.from.y, 0.3);
    if (e) {
      e.a = p.from;
      e.b = p.to;
      e.color = '#ffffff';
      e.color2 = p.color || '#fff07a';
    }
  },

  // A refused cast: out of mana puffs grey dust; still cooling says "not ready" (a soft
  // muted knock; the button shakes and shows its seconds).
  fizzle(fx, p) {
    const c = p.caster;
    if (!c || (p.reason !== 'mana' && p.reason !== 'cooldown')) return;
    const now = fx.game.time || 0;
    if (now - (fx._fizzleAt || 0) < 0.25) return;
    fx._fizzleAt = now;
    if (p.reason === 'cooldown') {
      fx.sound.cue('not_ready', c.x, c.y);
      return;
    }
    fx.parts.burst('dust', { core: '#c9c6cf', spark: '#c9c6cf', glow: '#8e8a95', deep: '#5f5a69' }, c.x + (c.facing?.x || 0) * 6, c.y, 10, 5, 0.7);
    fx.sound.cue('fizzle', c.x, c.y);
  },

  // A weave's cooldown ran out: a soft tick for a long one (a Spark's short wait stays
  // quiet), and a glint at the hands in its colors.
  ready(fx, p) {
    const c = p.caster;
    if (!c || !p.plan) return;
    if (!(p.total >= 1.2)) return;
    const L = planLook(p.plan);
    fx.parts.burst('twinkle', L.pal, c.x, c.y, 12, 3, 0.6);
    fx.sound.cue('ready', c.x, c.y);
  },
};

export function handleEvent(fx, type, payload, magic) {
  const h = H[type];
  if (h && payload) h(fx, payload, magic);
}

export const EVENT_TYPES = Object.keys(H);
