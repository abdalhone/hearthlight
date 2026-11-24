// The Lake's Hum: the still water of Mirror Lake, risen. It comes up beside the island,
// humming; rolls waves across it (a marked band you step out of or roll through), lets
// loose drifting bubbles, and pushes everything with a tide. Then it sinks, and its
// ripple slides under the water to wherever it will rise next (a ring of bubbles marks
// the spot). It can only be hurt while it is up. Phase 2: shorter breaths above, crossed
// waves, and geysers under your feet.

import { addMarker, angleTo, dist, faceTarget, stop, particles, sound, shake, hitShape } from './kit.js';
import { spawnHazard } from './hazards.js';
import { alive, hostileTo } from '../entities/creature_util.js';

// Places just off the island's shore where it can rise (the arena gives them).
function spots(b) {
  const a = b.arena;
  if (Array.isArray(a.spots) && a.spots.length) return a.spots;
  const out = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    out.push({ x: a.x + Math.cos(ang) * (a.r + 12), y: a.y + Math.sin(ang) * (a.r * 0.8 + 12) });
  }
  return (a.spots = out);
}

function nextSpot(b) {
  const list = spots(b);
  const t = b.target || b.game.player;
  // Somewhere new, not too far from whoever it is hunting.
  let best = null;
  let bs = -Infinity;
  for (const s of list) {
    const moved = Math.hypot(s.x - b.x, s.y - b.y);
    if (moved < 30) continue;
    const near = t ? Math.hypot(s.x - t.x, s.y - t.y) : 0;
    const score = -near * 1.0 + Math.random() * 50 + Math.min(moved, 120) * 0.2;
    if (score > bs) {
      bs = score;
      best = s;
    }
  }
  return best || list[0] || { x: b.arena.x, y: b.arena.y };
}

export const lakeBrain = {
  init(b) {
    b.mem.stage = 'below';
    b.mem.stageT = 0;
    b.setVeiled(true);
    b.alpha = 1;
  },

  idle(b) {
    // Waiting under the water until someone comes out onto the island.
    if (!b.veiled) b.setVeiled(true);
  },

  start(b) {
    const s = nextSpot(b);
    b.x = s.x;
    b.y = s.y;
    this.rise(b);
    sound(b, 'boss_hum', { volume: 1 });
    b.cool('wave', 1.6);
    b.cool('bubbles', 3);
    b.cool('tide', 9);
    b.cool('geyser', 2);
  },

  rise(b) {
    b.mem.stage = 'rise';
    b.mem.stageT = 0;
    b.setVeiled(false);
    b.invuln = 0;
    b.setAnim('rise', true);
    particles(b, 'splash', b.x, b.y - 4, { count: 20, color: '#cfeeff', speed: 60, life: 0.6 });
    sound(b, 'boss_splash', { volume: 0.9 });
    // Rising shoves away whoever stands right on top of it.
    hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: 26 }, { mul: 0.6, kind: 'magic', knockback: 220, hitSet: new Set() });
  },

  sink(b) {
    if (b.move) b.endMove();
    b.mem.stage = 'sink';
    b.mem.stageT = 0;
    b.setAnim('sink', true);
    sound(b, 'boss_splash', { volume: 0.6, pitch: 0.8 });
  },

  update(b, dt) {
    const m = b.mem;
    m.stageT += dt;
    const t = b.target;
    if (t) faceTarget(b, t);
    stop(b);
    switch (m.stage) {
      case 'below': {
        if (!b.veiled) b.setVeiled(true);
        // The ripple slides toward the next spot; bubbles mark it before it breaks the surface.
        const s = m.next || (m.next = nextSpot(b));
        const k = Math.min(1, m.stageT / 1.1);
        b.x = m.fromX + (s.x - m.fromX) * k;
        b.y = m.fromY + (s.y - m.fromY) * k;
        if (!m.marked) {
          m.marked = true;
          addMarker(b, { kind: 'circle', x: s.x, y: s.y, r: 26, dur: 1.4, life: 1.4, color: '#6fc8ff', edge: '#e0f6ff' });
        }
        if (Math.random() < dt * 14) particles(b, 'splash', b.x + (Math.random() - 0.5) * 10, b.y, { count: 1, color: '#cfeeff', speed: 12, life: 0.4 });
        if (m.stageT >= 1.4) {
          m.next = null;
          m.marked = false;
          this.rise(b);
        }
        return;
      }
      case 'rise':
        b.pose('rise');
        if (m.stageT >= 1.0) {
          m.stage = 'up';
          m.stageT = 0;
          m.upFor = b.phase >= 2 ? 7 : 9;
          b.setAnim('idle');
        }
        return;
      case 'sink':
        b.pose('sink');
        if (m.stageT >= 0.9) {
          m.stage = 'below';
          m.stageT = 0;
          m.fromX = b.x;
          m.fromY = b.y;
          b.setVeiled(true);
        }
        return;
      default:
        break;
    }
    // Up: a breath of attacks, then down again.
    if (m.stageT >= m.upFor) return void this.sink(b);
    if (!t) return;
    const d = dist(b, t);
    if (b.phase >= 2 && b.ready('geyser') && Math.random() < 0.5) return void b.startMove('geyser');
    if (b.ready('wave')) return void b.startMove('wave');
    if (b.ready('tide') && d < 160) return void b.startMove('tide');
    if (b.ready('bubbles')) return void b.startMove('bubbles');
    if (b.phase < 2 && b.ready('geyser') && d > 70) return void b.startMove('geyser');
  },

  // Under the water nothing reaches it.
  hitMul(b, src, amount) {
    if (b.mem.stage !== 'up' && b.mem.stage !== 'rise') {
      if (Math.random() < 0.5) particles(b, 'splash', b.x, b.y - 2, { count: 4, color: '#cfeeff', speed: 30, life: 0.4 });
      return 0;
    }
    return amount;
  },

  onPhase(b, phase) {
    if (phase === 2) {
      sound(b, 'boss_hum', { volume: 1, pitch: 1.2 });
      shake(b, 2.5, 0.6);
      this.sink(b);
    }
  },

  moves: {
    wave: {
      windup: (b) => (b.phase >= 2 ? 0.8 : 0.95),
      active: 0.2,
      recover: 0.6,
      cooldown: (b) => (b.phase >= 2 ? 3.6 : 4.6),
      anim: { windup: 'telegraph', active: 'attack', recover: 'idle' },
      begin(b, m) {
        const t = b.target;
        const base = t ? angleTo(b, t) : angleTo(b, b.arena);
        m.angles = b.phase >= 2 ? [base - 0.5, base + 0.5] : [base];
        m.span = 92;
        m.mks = m.angles.map((a) => addMarker(b, { kind: 'line', x: b.x - Math.sin(a) * 0, y: b.y, angle: a, len: 230, w: m.span, dur: m.dur, color: '#4fb6f0', edge: '#e0f6ff' }));
        sound(b, 'boss_hum', { volume: 0.5, pitch: 1.4 });
      },
      strike(b, m) {
        sound(b, 'boss_splash');
        for (const a of m.angles) {
          spawnHazard(b.game, {
            kind: 'wave',
            owner: b,
            palette: 'water',
            x: b.x + Math.cos(a) * 8,
            y: b.y + Math.sin(a) * 8,
            angle: a,
            len: m.span,
            w: 14,
            speed: 150,
            life: 1.5,
            mul: 0.6,
            knockback: 120,
            push: 200,
          });
        }
      },
    },

    bubbles: {
      windup: 0.6,
      active: 0.4,
      recover: 0.4,
      cooldown: (b) => (b.phase >= 2 ? 3.5 : 4.5),
      anim: { windup: 'telegraph', active: 'attack', recover: 'idle' },
      strike(b) {
        const g = b.game;
        const n = b.phase >= 2 ? 6 : 4;
        const foes = [];
        const list = g.entities?.all?.() || [];
        for (const e of list) if (e.type === 'actor' && alive(e) && hostileTo(g, b, e) && dist(e, b) < 260) foes.push(e);
        sound(b, 'boss_pop', { pitch: 0.7 });
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          spawnHazard(g, {
            kind: 'bubble',
            owner: b,
            palette: 'water',
            x: b.x + Math.cos(a) * 14,
            y: b.y + Math.sin(a) * 10,
            vx: Math.cos(a) * 40,
            vy: Math.sin(a) * 40,
            r: 9,
            speed: 42,
            life: 5.5,
            mul: 0.55,
            knockback: 80,
            target: foes.length ? foes[i % foes.length] : g.player,
          });
        }
      },
    },

    tide: {
      windup: 1.0,
      active: 2.3,
      recover: 0.4,
      cooldown: 12,
      anim: { windup: 'telegraph', active: 'attack', recover: 'idle' },
      begin(b, m) {
        m.angle = angleTo(b, b.arena);
        m.mk = addMarker(b, { kind: 'arrows', x: b.arena.x, y: b.arena.y, r: b.arena.r + 16, angle: m.angle, dur: m.dur + 2.3, life: m.dur + 2.3, color: '#4fb6f0', edge: '#cfeeff' });
        sound(b, 'boss_hum', { volume: 0.7, pitch: 0.8 });
      },
      activeTick(b, m, dt) {
        // Everything on the island slides away from it, toward the far water.
        const g = b.game;
        const ux = Math.cos(m.angle);
        const uy = Math.sin(m.angle);
        const list = g.entities?.all?.() || [];
        for (const e of list) {
          if (e.type !== 'actor' || !alive(e) || e === b || !hostileTo(g, b, e)) continue;
          if (Math.hypot(e.x - b.arena.x, e.y - b.arena.y) > b.arena.r + 40) continue;
          g.entities?.moveActor?.(e, ux * 62 * dt, uy * 62 * dt);
        }
        if (Math.random() < dt * 12) particles(b, 'splash', b.arena.x + (Math.random() - 0.5) * b.arena.r * 2, b.arena.y + (Math.random() - 0.5) * b.arena.r, { count: 1, color: '#cfeeff', speed: 18, life: 0.4 });
        // A bubble or two rides the tide.
        m.bt = (m.bt || 0) + dt;
        if (m.bt > 0.9) {
          m.bt = 0;
          const tgt = b.target || g.player;
          spawnHazard(g, { kind: 'bubble', owner: b, palette: 'water', x: b.x, y: b.y, vx: ux * 40, vy: uy * 40, r: 9, speed: 40, life: 4, mul: 0.5, knockback: 70, target: tgt });
        }
      },
    },

    geyser: {
      windup: 0.4,
      active: 1.2,
      recover: 0.4,
      cooldown: (b) => (b.phase >= 2 ? 3.8 : 7),
      anim: { windup: 'telegraph', active: 'telegraph', recover: 'idle' },
      strike(b, m) {
        m.n = 0;
        m.next = 0;
      },
      activeTick(b, m) {
        const count = b.phase >= 2 ? 3 : 2;
        if (m.n >= count || m.t < m.next) return;
        m.next = m.t + 0.42;
        m.n++;
        const t = b.target || b.game.player;
        if (!t) return;
        spawnHazard(b.game, { kind: 'eruption', owner: b, palette: 'water', x: t.x, y: t.y, r: 22, delay: 0.85, mul: 1.1, knockback: 140, launch: 120, markColor: '#4fb6f0' });
      },
    },
  },

  defeat(b) {
    if (b.anim !== 'defeat') b.setAnim('defeat', true);
    if (b.defeatT > 0.2 && !b.mem.lastHum) {
      b.mem.lastHum = true;
      sound(b, 'boss_hum', { volume: 1, pitch: 0.75 });
    }
    b.alpha = Math.max(0, 1 - Math.max(0, b.defeatT - 1.4) / 1.4);
    if (Math.random() < 0.3) particles(b, 'splash', b.x + (Math.random() - 0.5) * 18, b.y - Math.random() * 20, { count: 1, color: '#cfeeff', speed: 20, life: 0.5 });
    return b.defeatT >= 2.8;
  },

  // Under the water: a moving ripple and a dark shape, so you always know where it is.
  drawHidden(ctx, b, ox, oy, time) {
    if (b.mode !== 'fight' || b.mem.stage !== 'below') return;
    const x = b.x - ox;
    const y = b.y - oy;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#0c1a33';
    ctx.beginPath();
    ctx.ellipse(x, y, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cfeeff';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const k = ((time * 1.3 + i / 3) % 1);
      ctx.globalAlpha = 0.6 * (1 - k);
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + k * 18, 3 + k * 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // The shards wash up on the island, not in the water.
  shardSpot(b) {
    const a = b.arena;
    return { x: b.x + (a.x - b.x) * 0.6, y: b.y + (a.y - b.y) * 0.6 };
  },

  light(b, time) {
    if (b.mem.stage === 'below') return null;
    const L = b.mem.light || (b.mem.light = { x: 0, y: 0, r: 70, color: '#6fc8ff', intensity: 0.6, flicker: 0.04 });
    L.x = b.x;
    L.y = b.y - 22;
    L.intensity = (0.5 + 0.12 * Math.sin(time * 2.6)) * b.alpha;
    return L;
  },
};
