// Greyjaw: the grey alpha of the Whisperwood packs, out only from dusk to dawn.
// He circles, never still; lunges along a marked line; bites when you stand too close;
// when you press him he bounds back into the trees and comes out somewhere else; when he
// howls, wolves answer from the dark. Phase 2: faster, lunges in pairs, and a high pounce
// onto a marked circle.

import { addMarker, hitShape, angleTo, dist, steerTo, orbit, faceTarget, stop, dashStep, shake, particles, sound, arenaPoint } from './kit.js';
import { spawnCreature } from '../entities/monsters.js';
import { alive } from '../entities/creature_util.js';

const quick = (b) => (b.phase >= 2 ? 0.8 : 1);

export const greyjawBrain = {
  init(b) {
    b.mem.orbitDir = 1;
    b.mem.nextAt = 1.2;
    b.mem.lurk = null;
  },

  start(b) {
    sound(b, 'boss_howl', { volume: 0.8, pitch: 0.9 });
    b.cool('howl', 10);
    b.cool('pounce', 6);
    b.mem.nextAt = b.t + 1.5;
  },

  update(b, dt) {
    b.speedMul = b.phase >= 2 ? 1.25 : 1;
    const t = b.target;
    if (!t) {
      steerTo(b, b.arena.x, b.arena.y, 0.7);
      return;
    }
    const d = dist(b, t);
    // Lurking at the edge of the trees after being pressed.
    if (b.mem.lurk) {
      const L = b.mem.lurk;
      L.t += dt;
      if (Math.hypot(L.x - b.x, L.y - b.y) > 8 && L.t < 2.2) {
        b.speedMul = 1.9;
        steerTo(b, L.x, L.y, 1);
        return;
      }
      faceTarget(b, t);
      stop(b);
      b.pose('crouch');
      if (L.t > 2.4 + (b.phase >= 2 ? 0 : 0.6)) {
        b.mem.lurk = null;
        b.startMove('lunge', { long: true });
      }
      return;
    }
    if (b.hitStreak > 32 && b.ready('retreat')) {
      b.cool('retreat', 9);
      b.hitStreak = 0;
      const away = angleTo(t, b);
      const spot = arenaPoint(b, b.arena.x + Math.cos(away) * b.arena.r * 0.6, b.arena.y + Math.sin(away) * b.arena.r * 0.6, 0, b.arena.r * 0.35);
      b.mem.lurk = { x: spot.x, y: spot.y, t: 0 };
      sound(b, 'boss_bite', { pitch: 0.7 });
      return;
    }
    if (b.ready('howl') && b.adds.size < 2 && b.t > 6) return void b.startMove('howl');
    if (b.t >= b.mem.nextAt) {
      if (d < 30 && b.ready('bite')) return void b.startMove('bite');
      if (b.phase >= 2 && b.ready('pounce') && d > 40 && d < 140) return void b.startMove('pounce');
      if (d > 46 && d < 130 && b.ready('lunge')) return void b.startMove('lunge');
    }
    // Circle at a wolf's distance, switching direction now and then.
    if (Math.random() < dt * 0.25) b.mem.orbitDir *= -1;
    const want = d < 44 ? 70 : 64;
    orbit(b, t, want, d > 110 ? 1 : 0.85, b.mem.orbitDir);
  },

  onPhase(b, phase) {
    if (phase === 2) {
      sound(b, 'boss_howl', { volume: 1, pitch: 0.8 });
      b.cool('howl', 0);
      b.cool('pounce', 2);
    }
  },

  moves: {
    lunge: {
      windup: (b, m) => (m.data.chain ? 0.45 : 0.62) * quick(b),
      active: 0.5,
      recover: (b, m) => (m.data.chainNext ? 0.12 : 0.7),
      cooldown: 1.2,
      anim: { windup: 'crouch', active: 'attack', recover: 'idle' },
      begin(b, m) {
        m.len = m.data.long ? 170 : 120;
        m.angle = b.target ? angleTo(b, b.target) : 0;
        m.mk = addMarker(b, { kind: 'line', x: b.x, y: b.y, angle: m.angle, len: m.len, w: 20, dur: m.dur });
        sound(b, 'boss_roar', { volume: 0.35, pitch: 1.7 });
      },
      windupTick(b, m, dt, k) {
        if (k < 0.7 && b.target) {
          m.angle = angleTo(b, b.target);
          faceTarget(b, b.target);
        }
        m.mk.angle = m.angle;
        m.mk.x = b.x;
        m.mk.y = b.y;
      },
      strike(b, m) {
        m.ux = Math.cos(m.angle);
        m.uy = Math.sin(m.angle);
        m.sx = b.x;
        m.sy = b.y;
        b.faceX = m.ux < 0 ? -1 : 1;
        sound(b, 'boss_bite');
        m.data.chainNext = b.phase >= 2 && !m.data.chain && Math.random() < 0.55;
      },
      activeTick(b, m, dt) {
        const blocked = dashStep(b, m.ux, m.uy, 320, dt);
        b.z = Math.sin(Math.min(1, m.t / 0.38) * Math.PI) * 7;
        hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: b.radius + 6 }, { mul: 1.1, kind: 'bite', knockback: 190, hitSet: m.hitSet, push: { x: m.ux, y: m.uy } });
        if (Math.hypot(b.x - m.sx, b.y - m.sy) >= m.len || (blocked && m.t > 0.05)) m.endActive = true;
      },
      end(b, m) {
        b.z = 0;
        if (m.data.chainNext && b.mode === 'fight') b.startMove('lunge', { chain: true });
        else b.mem.nextAt = b.t + 1.2 + Math.random() * 1.2;
      },
    },

    bite: {
      windup: (b) => 0.42 * quick(b),
      active: 0.3,
      recover: 0.45,
      cooldown: 1.6,
      anim: { windup: 'crouch', active: 'attack', recover: 'idle' },
      begin(b, m) {
        m.angle = b.target ? angleTo(b, b.target) : 0;
        m.mk = addMarker(b, { kind: 'cone', x: b.x, y: b.y, angle: m.angle, range: 34, arc: 1.7, dur: m.dur });
      },
      windupTick(b, m) {
        m.mk.x = b.x;
        m.mk.y = b.y;
      },
      strike(b, m) {
        sound(b, 'boss_bite');
        hitShape(b, m.mk, { mul: 0.9, kind: 'bite', knockback: 120, hitSet: m.hitSet });
        m.second = false;
      },
      activeTick(b, m) {
        if (!m.second && m.t > 0.18) {
          m.second = true;
          sound(b, 'boss_bite', { pitch: 1.15 });
          hitShape(b, { ...m.mk, x: b.x, y: b.y }, { mul: 0.7, kind: 'bite', knockback: 150, hitSet: new Set() });
        }
      },
      end(b) {
        b.mem.nextAt = b.t + 1 + Math.random();
      },
    },

    pounce: {
      windup: (b) => 0.85 * quick(b),
      active: 0.55,
      recover: 0.75,
      cooldown: 6,
      anim: { windup: 'crouch', active: 'attack', recover: 'idle' },
      begin(b, m) {
        const t = b.target;
        m.tx = t ? t.x : b.x;
        m.ty = t ? t.y : b.y;
        m.mk = addMarker(b, { kind: 'circle', x: m.tx, y: m.ty, r: 34, dur: m.dur });
      },
      windupTick(b, m, dt, k) {
        if (k < 0.6 && b.target) {
          m.tx = b.target.x;
          m.ty = b.target.y;
          m.mk.x = m.tx;
          m.mk.y = m.ty;
          faceTarget(b, b.target);
        }
      },
      strike(b, m) {
        m.sx = b.x;
        m.sy = b.y;
        m.mk.t = m.mk.dur;
        sound(b, 'boss_roar', { volume: 0.5, pitch: 1.4 });
      },
      activeTick(b, m) {
        const k = Math.min(1, m.t / 0.55);
        const nx = m.sx + (m.tx - m.sx) * k;
        const ny = m.sy + (m.ty - m.sy) * k;
        b.game.entities?.moveActor?.(b, nx - b.x, ny - b.y);
        b.z = Math.sin(k * Math.PI) * 26;
        if (k >= 1 && !m.landed) {
          m.landed = true;
          b.z = 0;
          hitShape(b, { kind: 'circle', x: m.tx, y: m.ty, r: 34 }, { mul: 1.3, kind: 'bite', knockback: 210, launch: 90, heavy: true, hitSet: m.hitSet });
          shake(b, 3.5, 0.3);
          sound(b, 'boss_slam', { pitch: 1.2, volume: 0.7 });
          particles(b, 'dust', b.x, b.y, { count: 18, speed: 60, life: 0.6 });
          particles(b, 'leaf', b.x, b.y - 8, { count: 4 });
        }
      },
      end(b) {
        b.z = 0;
        b.mem.nextAt = b.t + 1;
      },
    },

    howl: {
      windup: 0.45,
      active: 1.2,
      recover: 0.3,
      cooldown: (b) => (b.phase >= 2 ? 15 : 22),
      anim: { windup: 'howl', active: 'howl', recover: 'idle' },
      begin(b) {
        // Back off first: he howls from the edge of the trees.
        const t = b.target;
        if (t) faceTarget(b, t);
      },
      strike(b) {
        sound(b, 'boss_howl', { volume: 1 });
        addMarker(b, { kind: 'ring', x: b.x, y: b.y, r: 80, dur: 1.1, life: 1.1, color: '#9fb4d8', edge: '#e0ecff' });
        const g = b.game;
        const n = b.phase >= 2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const spot = arenaPoint(b, b.arena.x + Math.cos(a) * b.arena.r * 0.9, b.arena.y + Math.sin(a) * b.arena.r * 0.9, 0, 24);
          try {
            const w = spawnCreature(g, 'wolf', spot.x, spot.y, { spawnZone: `boss:${b.bossId}`, home: { x: b.arena.x, y: b.arena.y }, night: true });
            if (w) {
              b.adds.add(w);
              const p = g.player;
              w.target = p && alive(p) ? p : b.target;
              if (w.ai) {
                w.ai.state = 'notice';
                w.ai.t = 0;
                w.ai.dur = 0.5 + i * 0.3;
              }
            }
          } catch (err) {
            console.error('[greyjaw] howl failed', err);
          }
        }
      },
      end(b) {
        b.mem.nextAt = b.t + 0.8;
      },
    },
  },

  // He goes down on his side and does not get up.
  defeat(b) {
    if (b.anim !== 'defeat') b.setAnim('defeat', true);
    if (b.defeatT > 0.4 && !b.mem.lastHowl) {
      b.mem.lastHowl = true;
      sound(b, 'boss_howl', { volume: 0.6, pitch: 0.7 });
    }
    return b.defeatT >= 2.2;
  },

  light(b, time) {
    // Two cold points in the dark (his eyes, brighter while he lurks) and moonlight on
    // his silver coat, so you can always find him.
    const L = b.mem.light || (b.mem.light = { x: 0, y: 0, r: 26, color: '#ffd75e', intensity: 0.5, flicker: 0.05 });
    const M = b.mem.moon || (b.mem.moon = { x: 0, y: 0, r: 58, color: '#c8d4ff', intensity: 0.32, flicker: 0 });
    L.x = b.x + b.faceX * 14;
    L.y = b.y - 16 - (b.z || 0);
    L.intensity = b.mem.lurk ? 0.9 : 0.45 + 0.05 * Math.sin(time * 3);
    M.x = b.x;
    M.y = b.y - 12 - (b.z || 0);
    M.intensity = b.mode === 'defeat' ? Math.max(0, 0.32 - b.defeatT * 0.12) : 0.32;
    if (!b.mem.lights) b.mem.lights = [M, L];
    return b.mem.lights;
  },
};
