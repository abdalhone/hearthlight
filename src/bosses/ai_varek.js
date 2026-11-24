// Varek One-Eye: an axe brute who fights like a man who has done it all his life.
// Phase 1: chop (cone), shoulder charge (line; stuns him if he hits a wall), overhead
// slam (circle), and a shout that calls his men. Phase 2 (half health): he walks to the
// camp fire and lights his axe in it; every blow then leaves fire on the ground, the
// slam rolls a ring of flame, and a spinning sweep rings him in burning grass.
// At the end he is beaten, not killed: he drops to a knee, yields, and runs for the hills.
// The glyph-shards come out of the fire itself.

import { addMarker, hitShape, angleTo, dist, steerTo, faceTarget, stop, dashStep, shake, particles, flashLight, sound, arenaPoint } from './kit.js';
import { spawnHazard } from './hazards.js';
import { spawnCreature } from '../entities/monsters.js';
import { alive } from '../entities/creature_util.js';

const quick = (b) => (b.phase >= 2 ? 0.85 : 1);

function firePos(b) {
  const f = b.game.objects?.get?.('camp_campfire');
  return f ? { x: f.x, y: f.y } : { x: b.arena.x, y: b.arena.y + 16 };
}

function menNear(b) {
  let n = 0;
  for (const e of b.game.entities?.all?.() || []) {
    if (e !== b && e.faction === 'bandit' && alive(e) && Math.hypot(e.x - b.arena.x, e.y - b.arena.y) < b.arena.r + 32) n++;
  }
  return n;
}

function fireDrop(b, x, y, r = 12, life = 3.2) {
  if (!b.mem.fire) return;
  spawnHazard(b.game, { kind: 'fire', owner: b, x, y, r, life, mul: 0.3, tick: 0.55, knockback: 30 });
}

export const varekBrain = {
  init(b) {
    b.mem.fire = false;
    b.mem.wantIgnite = false;
    b.variant = null;
    b.glow = 0;
  },

  start(b) {
    b.bark(b.info.barks.start, 'shout', 0);
    sound(b, 'boss_roar', { volume: 0.8, pitch: 1.2 });
    b.cool('call', 8);
    b.cool('charge', 3);
    b.cool('slam', 5);
  },

  update(b, dt) {
    b.speedMul = b.phase >= 2 ? 1.15 : 1;
    if (b.mem.wantIgnite) {
      // Off to the fire. He turns his back on you to do it: an opening.
      const f = firePos(b);
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d < 22 || b.mem.igniteWalk > 4) {
        b.mem.wantIgnite = false;
        b.startMove('ignite');
        return;
      }
      b.mem.igniteWalk = (b.mem.igniteWalk || 0) + dt;
      steerTo(b, f.x, f.y - 14, 1.2);
      return;
    }
    const t = b.target;
    if (!t) {
      steerTo(b, b.arena.x, b.arena.y, 0.6);
      return;
    }
    const d = dist(b, t);
    faceTarget(b, t);
    // His men come when he shouts, unless the camp is already full of them.
    if (b.ready('call') && b.adds.size < 2 && menNear(b) < 3) return void b.startMove('call');
    if (b.phase >= 2 && b.ready('sweep') && d < 44) return void b.startMove('sweep');
    if (b.ready('slam') && d < 46) return void b.startMove('slam');
    if (b.ready('charge') && d > 64 && d < 170) return void b.startMove('charge');
    if (d < 30 && b.ready('chop')) return void b.startMove('chop');
    if (d > 24) steerTo(b, t.x, t.y, 1);
    else stop(b);
  },

  onPhase(b, phase) {
    if (phase === 2) {
      b.mem.wantIgnite = true;
      b.mem.igniteWalk = 0;
      if (b.move) b.endMove();
    }
  },

  onHurt(b) {
    if (b.hp > b.maxHp * 0.2 && Math.random() < 0.12) b.bark(b.info.barks.hurt, 'shout', 6);
  },

  moves: {
    chop: {
      windup: (b) => 0.62 * quick(b),
      active: 0.14,
      recover: 0.55,
      cooldown: 0.9,
      anim: { windup: 'telegraph', active: 'attack', recover: 'attack' },
      begin(b, m) {
        m.angle = b.target ? angleTo(b, b.target) : 0;
        m.mk = addMarker(b, { kind: 'cone', x: b.x, y: b.y, angle: m.angle, range: 40, arc: 2.0, dur: m.dur });
      },
      windupTick(b, m, dt, k) {
        if (k < 0.55 && b.target) {
          m.angle = angleTo(b, b.target);
          faceTarget(b, b.target);
        }
        m.mk.angle = m.angle;
        m.mk.x = b.x;
        m.mk.y = b.y;
      },
      strike(b, m) {
        sound(b, 'boss_swing');
        hitShape(b, m.mk, { mul: 1, knockback: 170, hitSet: m.hitSet });
        b.knock.x += Math.cos(m.angle) * 70;
        b.knock.y += Math.sin(m.angle) * 70;
        if (b.mem.fire) fireDrop(b, b.x + Math.cos(m.angle) * 24, b.y + Math.sin(m.angle) * 24, 13, 3);
      },
    },

    charge: {
      windup: (b) => 0.78 * quick(b),
      active: 0.6,
      recover: (b, m) => (m.data.stunned ? 1.6 : 0.5),
      cooldown: (b) => (b.phase >= 2 ? 4.5 : 6),
      anim: { windup: 'telegraph', active: 'charge', recover: 'idle' },
      begin(b, m) {
        m.angle = b.target ? angleTo(b, b.target) : 0;
        m.mk = addMarker(b, { kind: 'line', x: b.x, y: b.y, angle: m.angle, len: 160, w: 22, dur: m.dur });
        sound(b, 'boss_roar', { volume: 0.5, pitch: 1.3 });
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
        m.trail = 0;
        b.faceX = m.ux < 0 ? -1 : 1;
      },
      activeTick(b, m, dt) {
        const blocked = dashStep(b, m.ux, m.uy, 270, dt);
        hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: b.radius + 7 }, { mul: 1.2, knockback: 260, heavy: true, hitSet: m.hitSet, push: { x: m.ux, y: m.uy } });
        if (b.mem.fire) {
          m.trail += dt;
          if (m.trail > 0.09) {
            m.trail = 0;
            fireDrop(b, b.x, b.y, 10, 2.6);
          }
        }
        if (Math.random() < dt * 30) particles(b, 'dust', b.x, b.y, { count: 1, speed: 14, life: 0.4 });
        if (Math.hypot(b.x - m.sx, b.y - m.sy) >= 160) m.endActive = true;
        else if (blocked && m.t > 0.05) {
          // Into a wall or a tent pole: dazed. Your opening.
          m.endActive = true;
          m.data.stunned = true;
          shake(b, 3, 0.25);
          sound(b, 'boss_slam', { volume: 0.7, pitch: 1.3 });
          particles(b, 'dust', b.x + m.ux * 8, b.y + m.uy * 8, { count: 12, speed: 40, life: 0.6 });
          b.setAnim('hurt', true);
          b.game.bubbles?.icon?.(b, '?');
        }
      },
    },

    slam: {
      windup: (b) => 1.0 * quick(b),
      active: 0.2,
      recover: 0.95,
      cooldown: (b) => (b.phase >= 2 ? 4.8 : 6.5),
      anim: { windup: 'raise', active: 'slam', recover: 'slam' },
      begin(b, m) {
        m.mk = addMarker(b, { kind: 'circle', x: b.x, y: b.y, r: 46, dur: m.dur, follow: b });
      },
      strike(b, m) {
        hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: 46 }, { mul: 1.45, knockback: 230, launch: 90, heavy: true, hitSet: m.hitSet });
        shake(b, 4.5, 0.35);
        sound(b, 'boss_slam');
        particles(b, 'dust', b.x, b.y, { count: 22, speed: 75, life: 0.7 });
        flashLight(b, b.x, b.y - 4, 60, b.mem.fire ? '#ff8a3d' : '#ffb047', 0.5, 0.2);
        if (b.mem.fire) {
          spawnHazard(b.game, { kind: 'ring', owner: b, x: b.x, y: b.y, r0: 30, r1: 118, life: 0.95, mul: 0.55, knockback: 150, palette: 'fire' });
          sound(b, 'boss_fire', { volume: 0.7 });
        }
      },
    },

    sweep: {
      windup: 0.85,
      active: 0.35,
      recover: 0.8,
      cooldown: 7,
      anim: { windup: 'raise', active: 'attack', recover: 'idle' },
      begin(b, m) {
        m.mk = addMarker(b, { kind: 'circle', x: b.x, y: b.y, r: 40, dur: m.dur, follow: b });
      },
      strike(b, m) {
        hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: 40 }, { mul: 1.1, knockback: 200, hitSet: m.hitSet });
        sound(b, 'boss_fire');
        sound(b, 'boss_swing', { pitch: 0.8 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + b.t;
          fireDrop(b, b.x + Math.cos(a) * 34, b.y + Math.sin(a) * 34, 11, 3.6);
        }
      },
    },

    call: {
      windup: 0.8,
      active: 0.5,
      recover: 0.3,
      cooldown: (b) => (b.phase >= 2 ? 18 : 22),
      anim: { windup: 'call', active: 'call', recover: 'idle' },
      begin(b) {
        b.bark(b.info.barks.call, 'shout', 0);
      },
      strike(b) {
        const g = b.game;
        const p = g.player;
        const n = b.phase >= 2 ? 2 : 2 - Math.min(1, b.adds.size);
        for (let i = 0; i < n; i++) {
          let spot = arenaPoint(b, b.arena.x, b.arena.y, b.arena.r * 0.55, b.arena.r * 0.9);
          if (p && Math.hypot(spot.x - p.x, spot.y - p.y) < 56) spot = arenaPoint(b, b.arena.x, b.arena.y, b.arena.r * 0.55, b.arena.r * 0.9);
          const species = i === 1 && b.phase >= 2 ? 'bandit_archer' : 'bandit';
          try {
            const c = spawnCreature(g, species, spot.x, spot.y, { spawnZone: `boss:${b.bossId}`, home: { x: b.arena.x, y: b.arena.y } });
            if (c) {
              b.adds.add(c);
              c.target = p && alive(p) ? p : b.target;
              if (c.ai) {
                c.ai.state = 'notice';
                c.ai.t = 0;
                c.ai.dur = 0.5;
              }
              particles(b, 'dust', spot.x, spot.y, { count: 8, speed: 30, life: 0.5 });
            }
          } catch (err) {
            console.error('[varek] call failed', err);
          }
        }
      },
    },

    ignite: {
      windup: 1.1,
      active: 0.4,
      recover: 0.6,
      anim: { windup: 'raise', active: 'slam', recover: 'idle' },
      begin(b) {
        const f = firePos(b);
        b.faceX = f.x < b.x ? -1 : 1;
        b.bark(b.info.barks.phase, 'shout', 0);
      },
      windupTick(b, m, dt, k) {
        const f = firePos(b);
        if (Math.random() < dt * 20) particles(b, 'ember', f.x + (Math.random() - 0.5) * 10, f.y - 4, { count: 2 });
        b.glow = k;
      },
      strike(b) {
        const f = firePos(b);
        b.mem.fire = true;
        b.variant = 'fire';
        b.glow = 1;
        sound(b, 'boss_fire', { volume: 1 });
        shake(b, 3, 0.3);
        flashLight(b, f.x, f.y - 8, 110, '#ff8a3d', 1, 0.6);
        particles(b, 'spark', f.x, f.y - 6, { count: 30, speed: 90, life: 0.7 });
        spawnHazard(b.game, { kind: 'ring', owner: b, x: f.x, y: f.y, r0: 16, r1: 96, life: 0.8, mul: 0.4, knockback: 160, palette: 'fire' });
      },
    },
  },

  onDefeat(b) {
    b.mem.fire = false;
    b.variant = null;
    b.glow = 0;
    b.bark(b.info.barks.yield, 'say', 0);
  },

  // Down on one knee; the fire on the axe dies; the camp fire flares and gives up its
  // glyphs; then he gets up and goes, the way a beaten man goes.
  defeat(b, dt) {
    const t = b.defeatT;
    if (t < 2.4) {
      if (b.anim !== 'defeat') b.setAnim('defeat', true);
      if (t > 1.5 && !b.mem.shardsOut) {
        b.mem.shardsOut = true;
        const f = firePos(b);
        flashLight(b, f.x, f.y - 10, 120, '#ffb047', 1, 0.8);
        particles(b, 'spark', f.x, f.y - 8, { count: 26, speed: 70, life: 0.8 });
        sound(b, 'boss_fire', { volume: 0.9 });
        b.game.bosses?.dropShards?.(b, f.x, f.y - 2);
      }
      return false;
    }
    if (!b.mem.fleeing) {
      b.mem.fleeing = true;
      b.bark(b.info.barks.flee, 'say', 0);
      b.speedMul = 1.5;
      b.mem.exit = b.arena.exit || { x: b.arena.x - 6 * 16, y: b.arena.y + 13 * 16 };
      b.solid = false;
    }
    const e = b.mem.exit;
    steerTo(b, e.x, e.y, 1);
    b.setAnim('move');
    const away = b.defeatT - 2.4;
    if (away > 3) b.alpha = Math.max(0, 1 - (away - 3) / 1.2);
    return away > 4.3 || Math.hypot(e.x - b.x, e.y - b.y) < 10;
  },

  light(b, time) {
    if (!b.mem.fire && !(b.glow > 0)) return null;
    const L = b.mem.light || (b.mem.light = { x: 0, y: 0, r: 64, color: '#ff8a3d', intensity: 0.8, flicker: 0.3 });
    L.x = b.x + b.faceX * 10;
    L.y = b.y - 22;
    L.intensity = 0.6 + 0.3 * (b.glow || 0) + 0.1 * Math.sin(time * 13);
    return L;
  },

  // Flames licking off the axe head.
  tick(b, dt) {
    if (!b.mem.fire || b.mode !== 'fight') return;
    if (Math.random() < dt * 24) particles(b, 'ember', b.x + b.faceX * (10 + Math.random() * 6), b.y - 22 - Math.random() * 8, { count: 1 });
  },
};
