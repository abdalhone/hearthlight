// The Bone Warden: an armored skeleton the ruins' gravelight wears like a knight, a cold
// lantern in one hand. A heavy slash (cone); a gravelight beam from the lantern along a
// marked line; bones that claw up out of marked circles; and twice in the fight it kneels
// behind its shield inside a dome of gravelight that only certain blows can crack: the
// sword's heavy third swing, Lyra's bolts and any weave. Crack it and the Warden staggers,
// open to everything. Leave it be and it heals. Phase 2: the beam sweeps.

import { addMarker, hitShape, angleTo, dist, steerTo, faceTarget, stop, shake, particles, sound, flashLight } from './kit.js';
import { spawnHazard } from './hazards.js';
import { spawnCreature } from '../entities/monsters.js';
import { alive } from '../entities/creature_util.js';

const quick = (b) => (b.phase >= 2 ? 0.85 : 1);
const SHIELD_PIPS = 6;

function lanternAt(b) {
  return { x: b.x + b.faceX * 9, y: b.y - 2 };
}

function crack(b, n, src) {
  const s = b.mem.shield;
  if (!s) return;
  s.pips = Math.max(0, s.pips - n);
  s.flash = 1;
  sound(b, 'boss_clang', { pitch: 1 + (SHIELD_PIPS - s.pips) * 0.06 });
  particles(b, 'magic', b.x, b.y - 16, { count: 8 * n, color: '#9fc8ff', speed: 50, life: 0.5 });
  if (s.pips <= 0) breakShield(b, src);
}

function breakShield(b) {
  b.mem.shield = null;
  b.mem.stagger = b.t + 3.6;
  if (b.move) b.endMove();
  b.setAnim('stagger', true);
  sound(b, 'boss_break', { volume: 1 });
  shake(b, 3, 0.3);
  flashLight(b, b.x, b.y - 16, 110, '#cfe0ff', 1, 0.5);
  particles(b, 'magic', b.x, b.y - 18, { count: 30, color: '#cfe0ff', speed: 90, life: 0.7 });
  b.game.bosses?.onShield?.(b, false);
}

export const wardenBrain = {
  init(b) {
    b.mem.shield = null;
    b.mem.stagger = 0;
    b.mem.shieldsUsed = 0;
  },

  start(b) {
    sound(b, 'boss_grave', { volume: 1, pitch: 0.7 });
    sound(b, 'boss_rattle');
    b.cool('beam', 2.5);
    b.cool('bones', 8);
  },

  update(b, dt) {
    // Staggered after its shield broke: sagging, open.
    if (b.t < b.mem.stagger) {
      stop(b);
      b.pose('stagger');
      return;
    }
    // Shielded: kneels, pulses, waits for someone to crack it.
    const s = b.mem.shield;
    if (s) {
      stop(b);
      s.t += dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3);
      b.pose('shield');
      if (s.t >= 14) {
        // Nobody broke it: the gravelight mends the bones.
        b.mem.shield = null;
        try {
          b.game.combat?.heal?.(b, b, Math.round(b.maxHp * 0.06));
        } catch {
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.06);
        }
        sound(b, 'boss_grave', { pitch: 1.3 });
        b.game.bosses?.onShield?.(b, false);
        return;
      }
      if (b.ready('pulse')) b.startMove('pulse');
      return;
    }
    // Time to raise the shield?
    const marks = b.info.shields || [];
    if (b.mem.shieldsUsed < marks.length && b.hp <= b.maxHp * marks[b.mem.shieldsUsed]) {
      b.mem.shieldsUsed++;
      return void b.startMove('raise_shield');
    }
    const t = b.target;
    if (!t) {
      steerTo(b, b.arena.x, b.arena.y, 0.6);
      return;
    }
    const d = dist(b, t);
    faceTarget(b, t);
    if (b.ready('bones') && b.adds.size < 2) return void b.startMove('bones');
    if (b.phase >= 2 && b.ready('sweep') && d < 150) return void b.startMove('sweep');
    if (b.ready('beam') && d > 46 && d < 200) return void b.startMove('beam');
    if (d < 36 && b.ready('slash')) return void b.startMove('slash');
    if (d > 30) steerTo(b, t.x, t.y, 1);
    else stop(b);
    void dt;
  },

  // The dome takes every blow; the right ones crack it.
  hitMul(b, src, amount, opts) {
    if (b.mem.shield) {
      const kind = opts.kind || 'melee';
      const ess = opts.essences || opts.plan?.essences || [];
      let n = 0;
      const ticking = opts.dot || opts.tick || opts.status;
      if ((kind === 'magic' || kind === 'bolt') && !ticking && b.t - (b.mem.crackAt ?? -9) > 0.3) {
        n = 1 + (Array.isArray(ess) && ess.some((e) => e === 'light' || e === 'fire') ? 1 : 0);
        b.mem.crackAt = b.t;
      } else if (opts.heavy) n = 2;
      if (n > 0) crack(b, n, src);
      else {
        sound(b, 'boss_clang', { pitch: 0.8, volume: 0.6 });
        particles(b, 'spark', b.x - b.faceX * 4, b.y - 14, { count: 5, color: '#cfe0ff', speed: 50, life: 0.3 });
        const now = b.t;
        if (now - (b.mem.tipAt ?? -99) > 3) {
          b.mem.tipAt = now;
          try {
            b.game.bubbles?.number?.(b.x, b.y - 34, 'blocked', '#9fc8ff', { kind: 'damage' });
          } catch {
            /* cosmetic */
          }
        }
      }
      return 0;
    }
    if (b.t < b.mem.stagger) return amount * 1.6;
    return amount;
  },

  onPhase(b, phase) {
    if (phase === 2) {
      sound(b, 'boss_grave', { pitch: 0.6, volume: 1 });
      flashLight(b, b.x, b.y - 18, 90, '#7fb2ff', 0.8, 0.5);
    }
  },

  moves: {
    slash: {
      windup: (b) => 0.7 * quick(b),
      active: 0.15,
      recover: 0.65,
      cooldown: 1.1,
      anim: { windup: 'telegraph', active: 'attack', recover: 'attack' },
      begin(b, m) {
        m.angle = b.target ? angleTo(b, b.target) : 0;
        m.mk = addMarker(b, { kind: 'cone', x: b.x, y: b.y, angle: m.angle, range: 46, arc: 2.2, dur: m.dur, color: '#7fb2ff' });
      },
      windupTick(b, m, dt, k) {
        if (k < 0.5 && b.target) {
          m.angle = angleTo(b, b.target);
          faceTarget(b, b.target);
        }
        m.mk.angle = m.angle;
      },
      strike(b, m) {
        sound(b, 'boss_swing', { pitch: 0.85 });
        hitShape(b, m.mk, { mul: 1.2, knockback: 180, heavy: true, hitSet: m.hitSet });
        b.knock.x += Math.cos(m.angle) * 50;
        b.knock.y += Math.sin(m.angle) * 50;
      },
    },

    beam: {
      windup: (b) => 1.0 * quick(b),
      active: 0.4,
      recover: 0.55,
      cooldown: (b) => (b.phase >= 2 ? 4.5 : 5.5),
      anim: { windup: 'lantern', active: 'lantern', recover: 'idle' },
      begin(b, m) {
        const L = lanternAt(b);
        m.angle = b.target ? angleTo(L, b.target) : 0;
        m.mk = addMarker(b, { kind: 'line', x: L.x, y: L.y, angle: m.angle, len: 210, w: 16, dur: m.dur, color: '#7fb2ff', edge: '#e0f0ff' });
        sound(b, 'boss_grave', { volume: 0.6, pitch: 1.2 });
      },
      windupTick(b, m, dt, k) {
        const L = lanternAt(b);
        if (k < 0.62 && b.target) {
          m.angle = angleTo(L, b.target);
          faceTarget(b, b.target);
        }
        m.mk.x = L.x;
        m.mk.y = L.y;
        m.mk.angle = m.angle;
      },
      strike(b, m) {
        sound(b, 'boss_beam');
        const beam = { x: m.mk.x, y: m.mk.y, angle: m.angle, len: 210, w: 16 };
        m.beam = beam;
        // (A blow that knocks the player out resets the fight mid-strike: use locals.)
        flashLight(b, beam.x + Math.cos(beam.angle) * 100, beam.y + Math.sin(beam.angle) * 100, 120, '#9fc8ff', 0.9, 0.35);
        hitShape(b, { kind: 'line', ...beam }, { mul: 1.3, kind: 'magic', knockback: 120, hitSet: m.hitSet });
        shake(b, 1.5, 0.2);
      },
      end(b, m) {
        m.beam = null;
      },
    },

    sweep: {
      windup: 1.05,
      active: 0.9,
      recover: 0.6,
      cooldown: 7,
      anim: { windup: 'lantern', active: 'lantern', recover: 'idle' },
      begin(b, m) {
        const L = lanternAt(b);
        const base = b.target ? angleTo(L, b.target) : 0;
        m.dir = Math.random() < 0.5 ? 1 : -1;
        m.a0 = base - 0.8 * m.dir;
        m.a1 = base + 0.8 * m.dir;
        m.mk = addMarker(b, { kind: 'cone', x: L.x, y: L.y, angle: base, range: 170, arc: 1.6, dur: m.dur, color: '#7fb2ff', edge: '#e0f0ff' });
        sound(b, 'boss_grave', { volume: 0.7 });
      },
      strike(b) {
        sound(b, 'boss_beam', { pitch: 0.8 });
      },
      activeTick(b, m, dt, k) {
        const L = lanternAt(b);
        const a = m.a0 + (m.a1 - m.a0) * Math.min(1, m.t / 0.9);
        m.beam = { x: L.x, y: L.y, angle: a, len: 170, w: 14 };
        hitShape(b, { kind: 'line', ...m.beam }, { mul: 1.0, kind: 'magic', knockback: 120, hitSet: m.hitSet });
        void k;
      },
      end(b, m) {
        m.beam = null;
      },
    },

    bones: {
      windup: 0.9,
      active: 0.4,
      recover: 0.5,
      cooldown: (b) => (b.phase >= 2 ? 13 : 17),
      anim: { windup: 'lantern', active: 'lantern', recover: 'idle' },
      begin(b, m) {
        const t = b.target || b.game.player;
        const n = b.phase >= 2 ? 3 : 2;
        m.spots = [];
        for (let i = 0; i < n; i++) {
          const a = (t ? angleTo(t, b) : 0) + Math.PI + (i - (n - 1) / 2) * 1.1;
          const x = (t ? t.x : b.x) + Math.cos(a) * 34;
          const y = (t ? t.y : b.y) + Math.sin(a) * 30;
          m.spots.push({ x, y });
          addMarker(b, { kind: 'circle', x, y, r: 12, dur: m.dur, color: '#7fb2ff' });
        }
        sound(b, 'boss_rattle');
      },
      strike(b, m) {
        const g = b.game;
        for (const s of m.spots) {
          spawnHazard(g, { kind: 'eruption', owner: b, palette: 'grave', x: s.x, y: s.y, r: 12, delay: 0.01, mul: 0.6, knockback: 90 });
          try {
            const k = spawnCreature(g, 'skeleton', s.x, s.y, { spawnZone: `boss:${b.bossId}`, home: { x: b.arena.x, y: b.arena.y }, hpMul: 0.45 });
            if (k) {
              b.adds.add(k);
              k.target = g.player && alive(g.player) ? g.player : b.target;
              if (k.ai) {
                k.ai.state = 'notice';
                k.ai.t = 0;
                k.ai.dur = 0.8;
              }
            }
          } catch (err) {
            console.error('[warden] bones failed', err);
          }
          particles(b, 'stone_chip', s.x, s.y, { count: 8, color: '#ded5bd' });
        }
        sound(b, 'boss_rattle', { pitch: 0.8 });
      },
    },

    raise_shield: {
      windup: 0.7,
      active: 0.3,
      recover: 0.2,
      invuln: true,
      anim: { windup: 'shield', active: 'shield', recover: 'shield' },
      strike(b) {
        b.mem.shield = { pips: SHIELD_PIPS, max: SHIELD_PIPS, t: 0, flash: 0 };
        b.cool('pulse', 1.4);
        sound(b, 'boss_shield', { volume: 1 });
        flashLight(b, b.x, b.y - 14, 90, '#7fb2ff', 0.8, 0.5);
        b.game.bosses?.onShield?.(b, true);
      },
      end(b) {
        b.invuln = 0;
      },
    },

    pulse: {
      windup: 0.65,
      active: 0.1,
      recover: 0.2,
      cooldown: 2.6,
      anim: { windup: 'shield', active: 'shield', recover: 'shield' },
      begin(b, m) {
        m.mk = addMarker(b, { kind: 'ring', x: b.x, y: b.y, r: 84, dur: m.dur, color: '#7fb2ff', edge: '#e0f0ff' });
      },
      strike(b) {
        spawnHazard(b.game, { kind: 'ring', owner: b, x: b.x, y: b.y, r0: 14, r1: 84, life: 0.8, mul: 0.55, knockback: 170, palette: 'grave' });
        sound(b, 'boss_grave', { volume: 0.5, pitch: 1.5 });
      },
    },
  },

  // It folds down into a heap of bones; the lantern rolls and gutters out.
  defeat(b) {
    if (b.anim !== 'defeat') b.setAnim('defeat', true);
    if (b.defeatT > 0.15 && !b.mem.rattled) {
      b.mem.rattled = true;
      sound(b, 'boss_rattle', { volume: 1, pitch: 0.7 });
    }
    b.mem.lanternFade = Math.max(0, 1 - b.defeatT / 2.4);
    return b.defeatT >= 2.6;
  },

  onDefeat(b) {
    b.mem.shield = null;
    for (const a of b.adds) {
      if (!alive(a)) continue;
      try {
        b.game.combat?.kill?.(a, null);
      } catch {
        a.removed = true;
      }
    }
  },

  drawOver(ctx, b, x, y, time) {
    const m = b.move;
    // The gravelight beam itself.
    if (m && m.beam) {
      const bm = m.beam;
      const sx = bm.x - b.x + x;
      const sy = bm.y - b.y + y;
      ctx.save();
      ctx.translate(sx, sy - 12);
      ctx.rotate(bm.angle);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#7fb2ff';
      ctx.fillRect(0, -bm.w / 2, bm.len, bm.w);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e0f0ff';
      ctx.fillRect(0, -2, bm.len, 4);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // The dome.
    const s = b.mem.shield;
    if (s) {
      const k = s.pips / (s.max || SHIELD_PIPS);
      const r = 22;
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(time * 5) + 0.4 * (s.flash || 0);
      ctx.fillStyle = '#7fb2ff';
      ctx.beginPath();
      ctx.arc(x, y - 12, r, Math.PI, 0);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#e0f0ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y - 12, r, Math.PI, 0);
      ctx.stroke();
      // Cracks grow as pips fall.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      const cracks = (s.max || SHIELD_PIPS) - s.pips;
      for (let i = 0; i < cracks; i++) {
        const a = Math.PI + ((i + 0.5) / (s.max || SHIELD_PIPS)) * Math.PI;
        const cx = x + Math.cos(a) * r;
        const cy = y - 12 + Math.sin(a) * r;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - Math.cos(a) * 6 + (i % 2 ? 2 : -2), cy - Math.sin(a) * 6);
        ctx.lineTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 9 + 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      void k;
    }
  },

  light(b, time) {
    const L = b.mem.light || (b.mem.light = { x: 0, y: 0, r: 70, color: '#7fb2ff', intensity: 0.8, flicker: 0.12 });
    const fade = b.mode === 'defeat' ? b.mem.lanternFade ?? 1 : 1;
    L.x = b.x + b.faceX * 9;
    L.y = b.y - 14;
    L.r = b.mem.shield ? 90 : 70;
    L.intensity = (0.7 + 0.15 * Math.sin(time * 7) + (b.move?.beam ? 0.4 : 0)) * fade;
    return fade > 0.02 ? L : null;
  },
};
