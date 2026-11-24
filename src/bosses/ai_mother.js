// The Mother of Slimes: a great translucent slime grown in the quarry's rain-pools.
// She hops onto a marked circle and leaves poison where she lands; spits arcing globs at
// marked spots that become puddles; splits off little slimes when hit hard; and drinks
// her children back to heal, unless you kill them first. Phase 2: wider spits, and a
// poison rain falling on marked circles around you. She shrinks as she loses mass.

import { addMarker, hitShape, angleTo, dist, steerTo, faceTarget, stop, shake, particles, sound, flashLight } from './kit.js';
import { spawnHazard } from './hazards.js';
import { spawnCreature } from '../entities/monsters.js';
import { alive } from '../entities/creature_util.js';

const MAX_CHILDREN = 5;

function sizeFor(b) {
  const f = b.hp / b.maxHp;
  return f > 0.66 ? 'L' : f > 0.33 ? 'M' : 'S';
}

const RADIUS = { L: 12, M: 10, S: 8 };

function puddle(b, x, y, r = 16, life = 5) {
  spawnHazard(b.game, { kind: 'poison', owner: b, x, y, r, life: b.phase >= 2 ? life + 2 : life, mul: 0.25, tick: 0.6, knockback: 10 });
}

function bud(b, n, from = null) {
  const g = b.game;
  for (let i = 0; i < n; i++) {
    if (b.adds.size >= MAX_CHILDREN) return;
    const a = from ? angleTo(from, b) + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
    const x = b.x + Math.cos(a) * (b.radius + 6);
    const y = b.y + Math.sin(a) * (b.radius + 4);
    try {
      const s = spawnCreature(g, 'slime', x, y, { spawnZone: `boss:${b.bossId}`, home: { x: b.arena.x, y: b.arena.y }, variant: 'slime_rose', hpMul: 0.75 });
      if (s) {
        b.adds.add(s);
        s.knock.x += Math.cos(a) * 160;
        s.knock.y += Math.sin(a) * 160;
        s.z = 6;
        s.target = g.player && alive(g.player) ? g.player : b.target;
        if (s.ai) {
          s.ai.state = 'notice';
          s.ai.t = 0;
          s.ai.dur = 0.6;
        }
      }
    } catch (err) {
      console.error('[mother] bud failed', err);
    }
  }
  particles(b, 'splash', b.x, b.y - 6, { count: 10, color: '#f09ab8', speed: 50, life: 0.5 });
  sound(b, 'boss_glob', { pitch: 1.3 });
}

export const motherBrain = {
  init(b) {
    b.variant = 'L';
    b.radius = RADIUS.L;
    b.mem.splitAt = -9;
  },

  start(b) {
    sound(b, 'boss_glob', { volume: 1, pitch: 0.6 });
    b.cool('spit', 2.5);
    b.cool('absorb', 10);
    b.cool('rain', 4);
  },

  tick(b) {
    if (b.mode === 'defeat' || b.mode === 'gone') return;
    const s = sizeFor(b);
    if (s !== b.variant) {
      b.variant = s;
      b.radius = RADIUS[s];
    }
  },

  update(b, dt) {
    const t = b.target;
    if (!t) {
      steerTo(b, b.arena.x, b.arena.y, 0.5);
      return;
    }
    const d = dist(b, t);
    faceTarget(b, t);
    let kids = 0;
    for (const a of b.adds) if (alive(a)) kids++;
    if (kids >= 2 && b.ready('absorb') && b.hp < b.maxHp * 0.9) return void b.startMove('absorb');
    if (b.phase >= 2 && b.ready('rain')) return void b.startMove('rain');
    if (b.ready('spit') && d > 50) return void b.startMove('spit');
    if (b.ready('hop')) return void b.startMove('hop');
    // Creeping between moves.
    if (d > 30) steerTo(b, t.x, t.y, 0.6);
    else stop(b);
    void dt;
  },

  // A blow that lands hard tears off a piece of her.
  onHurt(b, src, dealt, kind) {
    if (b.mode !== 'fight') return;
    const hard = dealt >= 10 || kind === 'magic' || (src === b.game.player && dealt >= 8);
    if (!hard || b.t - b.mem.splitAt < 1.3) return;
    b.mem.splitAt = b.t;
    bud(b, b.phase >= 2 ? 2 : 1, src && src.type === 'actor' ? src : null);
  },

  onPhase(b, phase) {
    if (phase === 2) {
      sound(b, 'boss_glob', { pitch: 0.5, volume: 1 });
      flashLight(b, b.x, b.y - 10, 70, '#b6ff6a', 0.6, 0.4);
      bud(b, 2);
    }
  },

  moves: {
    hop: {
      windup: (b) => (b.phase >= 2 ? 0.62 : 0.75),
      active: 0.55,
      recover: 0.6,
      cooldown: 0.3,
      anim: { windup: 'telegraph', active: 'move', recover: 'attack' },
      begin(b, m) {
        const t = b.target;
        const a = t ? angleTo(b, t) : 0;
        const reach = Math.min(t ? dist(b, t) : 0, 92);
        m.tx = b.x + Math.cos(a) * reach;
        m.ty = b.y + Math.sin(a) * reach;
        m.r = b.radius + 22;
        m.mk = addMarker(b, { kind: 'circle', x: m.tx, y: m.ty, r: m.r, dur: m.dur, color: '#ff6b9e' });
      },
      strike(b, m) {
        m.sx = b.x;
        m.sy = b.y;
        m.mk.t = m.mk.dur;
      },
      activeTick(b, m) {
        const k = Math.min(1, m.t / 0.55);
        const nx = m.sx + (m.tx - m.sx) * k;
        const ny = m.sy + (m.ty - m.sy) * k;
        b.game.entities?.moveActor?.(b, nx - b.x, ny - b.y);
        b.z = Math.sin(k * Math.PI) * 22;
        if (k >= 1 && !m.landed) {
          m.landed = true;
          b.z = 0;
          hitShape(b, { kind: 'circle', x: b.x, y: b.y, r: m.r }, { mul: 1.2, kind: 'bite', knockback: 180, launch: 60, heavy: true, hitSet: m.hitSet });
          shake(b, 3, 0.25);
          sound(b, 'boss_slam', { pitch: 1.5, volume: 0.6 });
          sound(b, 'boss_glob', { volume: 0.8 });
          particles(b, 'splash', b.x, b.y - 2, { count: 16, color: '#f09ab8', speed: 60, life: 0.5 });
          puddle(b, b.x, b.y, m.r * 0.65, 4.5);
        }
      },
      end(b) {
        b.z = 0;
      },
    },

    spit: {
      windup: 0.6,
      active: 0.2,
      recover: 0.55,
      cooldown: (b) => (b.phase >= 2 ? 3.2 : 4.2),
      anim: { windup: 'telegraph', active: 'attack', recover: 'idle' },
      begin(b, m) {
        const t = b.target;
        const n = b.phase >= 2 ? 5 : 3;
        m.spots = [];
        const base = t ? angleTo(b, t) : 0;
        const d = t ? Math.min(150, dist(b, t)) : 80;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.32;
          const r = d + (i % 2 ? -14 : 10);
          m.spots.push({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r });
        }
      },
      strike(b, m) {
        sound(b, 'boss_glob', { pitch: 1.1 });
        const T = 0.75;
        for (const s of m.spots) {
          addMarker(b, { kind: 'circle', x: s.x, y: s.y, r: 16, dur: T, life: T, color: '#b6ff6a' });
          spawnHazard(b.game, {
            kind: 'glob',
            owner: b,
            palette: 'poison',
            x: b.x,
            y: b.y - 2,
            r: 16,
            z: 14,
            vx: (s.x - b.x) / T,
            vy: (s.y - b.y + 2) / T,
            vz: 150 * T - 14 / T,
            mul: 0.6,
            knockback: 60,
            onLand: (h) => puddle(b, h.x, h.y, 14, 5),
          });
        }
      },
    },

    rain: {
      windup: 0.5,
      active: 0.3,
      recover: 0.5,
      cooldown: 9,
      anim: { windup: 'telegraph', active: 'attack', recover: 'idle' },
      strike(b) {
        const t = b.target || b.game.player;
        if (!t) return;
        sound(b, 'boss_glob', { pitch: 0.8 });
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = i === 0 ? 0 : 20 + Math.random() * 46;
          const x = t.x + Math.cos(a) * r;
          const y = t.y + Math.sin(a) * r;
          spawnHazard(b.game, {
            kind: 'eruption',
            owner: b,
            palette: 'poison',
            x,
            y,
            r: 15,
            delay: 0.95 + i * 0.12,
            mul: 0.7,
            knockback: 60,
            markColor: '#b6ff6a',
            onLand: (h) => {
              if (b.mode === 'fight') puddle(b, h.x, h.y, 12, 4);
            },
          });
        }
      },
    },

    absorb: {
      windup: 0.85,
      active: 1.4,
      recover: 0.5,
      cooldown: 13,
      anim: { windup: 'telegraph', active: 'telegraph', recover: 'idle' },
      begin(b, m) {
        m.kids = [...b.adds].filter((a) => alive(a) && dist(a, b) < 170);
        for (const k of m.kids) addMarker(b, { kind: 'line', x: k.x, y: k.y, angle: angleTo(k, b), len: dist(k, b), w: 6, dur: m.dur + 1.4, life: m.dur + 1.4, color: '#b6ff6a', follow: null });
        m.taken = 0;
        m.hpAt = b.hp;
        sound(b, 'boss_hum', { pitch: 2.2, volume: 0.6 });
      },
      activeTick(b, m, dt) {
        // Hit her hard enough and she loses her hold on them.
        if (m.hpAt - b.hp > 36) {
          m.endActive = true;
          b.setAnim('hurt', true);
          return;
        }
        for (const k of m.kids) {
          if (!alive(k)) continue;
          const d = dist(k, b);
          if (d < b.radius + 6) {
            k.removed = true;
            b.adds.delete(k);
            m.taken++;
            try {
              b.game.combat?.heal?.(b, b, 16);
            } catch {
              b.hp = Math.min(b.maxHp, b.hp + 16);
            }
            particles(b, 'heal', b.x, b.y - 10, { count: 8, color: '#b6ff6a' });
            sound(b, 'boss_glob', { pitch: 0.7 });
            continue;
          }
          const a = angleTo(k, b);
          b.game.entities?.moveActor?.(k, Math.cos(a) * 95 * dt, Math.sin(a) * 95 * dt);
        }
      },
    },
  },

  // She melts into a shining puddle; the children melt with her.
  onDefeat(b) {
    for (const a of b.adds) {
      if (!alive(a)) continue;
      try {
        b.game.combat?.kill?.(a, null);
      } catch {
        a.removed = true;
      }
    }
  },

  defeat(b) {
    if (b.anim !== 'defeat') b.setAnim('defeat', true);
    if (b.defeatT > 0.3 && Math.random() < 0.3) particles(b, 'smoke', b.x + (Math.random() - 0.5) * 20, b.y - 2, { count: 1, color: '#f09ab8' });
    return b.defeatT >= 2.4;
  },

  light(b, time) {
    const L = b.mem.light || (b.mem.light = { x: 0, y: 0, r: 40, color: '#f09ab8', intensity: 0.4, flicker: 0.05 });
    L.x = b.x;
    L.y = b.y - 10 - (b.z || 0);
    L.r = 26 + b.radius * 1.4;
    L.intensity = 0.35 + 0.08 * Math.sin(time * 2.2);
    return L;
  },
};
