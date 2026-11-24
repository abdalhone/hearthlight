import { defineRegistry } from './registry.js';
import { CHILD_SPEED, CHARGE_TIME } from './balance.js';

// TWISTS: how a weave behaves (DESIGN §22.1). A twist is a bag of hooks plus number
// multipliers; it never knows which shape or essence it rides on. Children a twist makes
// (split, chain, burst, linger, echo, volley) inherit the weave minus that twist and one
// generation more; at the generation cap the plan drops every twist marked `spawns`, so
// nothing recurses forever. The runtime also caps bodies per cast and in the world.
//
// Entry format (get() fills the rest):
// {
//   id: 'split', name: 'Split',
//   adj: 'Splitting',               name fragment: "Splitting Ember Bolt"
//   clause: ['splits on impact', 'split on impact'] | null,   "...that split on impact"
//   sentence: 'It echoes a moment later.' | null,             appended to the description
//   mods: { dmg, cost, cooldown, speed, size, life },          multipliers (default 1)
//   value: 1.5,                     how much more harm per cast it brings (power budget)
//   spawns: true,                   makes children (dropped at the generation cap)
//   input: 'charge',                optional: the weave is charged while held
//   onPlan(plan)                    once, when a weave is compiled
//   onEmit(bodies, rt, cast)        once per emission (bodies: the emission's bodies)
//   onSpawn(body, rt)               each body this weave makes
//   onUpdate(body, dt, rt)          each step, each body
//   onHit(body, target, rt, info)   info = { dealt, x, y }
//   onEnd(body, rt, why)            why: 'expire' | 'hit' | 'wall' | 'trigger' | 'dismiss' | 'cap'
// }
// rt is the runtime (bodies.js): spawnChild, explode, patch, nearestFoe, recast, heal, random.

// Proc limits: a projectile procs once; a long-lived area or beam a few times, spaced out.
function canProc(body, key, limit, gap) {
  const n = body.procs[key] || 0;
  if (n >= limit) return false;
  if (gap > 0 && body.age - (body.procAt[key] ?? -1e9) < gap) return false;
  body.procs[key] = n + 1;
  body.procAt[key] = body.age;
  return true;
}

const isMissile = (b) => b.kind === 'projectile' && (b.mode === 'fly' || b.mode === 'orb' || b.mode === 'arc');

export const TWISTS = {
  multishot: {
    name: 'Multishot',
    adj: 'Triple',
    clause: null,
    mods: { dmg: 0.72, cost: 1.55, cooldown: 1.1 },
    value: 2.1,
    onPlan(plan) {
      plan.count += 2;
    },
  },

  split: {
    name: 'Split',
    adj: 'Splitting',
    clause: ['splits on impact', 'split on impact'],
    mods: { dmg: 0.95, cost: 1.3, cooldown: 1.1 },
    value: 1.55,
    spawns: true,
    onHit(body, target, rt, info) {
      if (!canProc(body, 'split', isMissile(body) ? 1 : body.kind === 'beam' ? 4 : 2, body.kind === 'beam' ? 0.5 : 0)) return;
      const base = isMissile(body) ? Math.atan2(body.vy, body.vx) : Math.atan2(target.y - body.y, target.x - body.x);
      const sp = CHILD_SPEED * body.plan.speedMul;
      for (let i = 0; i < 3; i++) {
        const a = base + (i - 1) * 0.75 + (rt.random() - 0.5) * 0.2;
        const c = rt.spawnChild(body, 'split', 'projectile', {
          mode: 'fly',
          x: info.x,
          y: info.y,
          angle: a,
          speed: sp,
          r: Math.max(2, body.r * 0.62),
          dmg: body.dmg * 0.45,
          life: 0.55,
          range: 120,
        });
        if (c) c.hits.set(target, 1e9);
      }
    },
  },

  pierce: {
    name: 'Pierce',
    adj: 'Piercing',
    clause: ['pierces through foes', 'pierce through foes'],
    mods: { dmg: 0.92, cost: 1.2 },
    value: 1.45,
    onPlan(plan) {
      plan.pierce += 3;
      plan.penetration += 3;
    },
  },

  bounce: {
    name: 'Bounce',
    adj: 'Ricochet',
    clause: ['ricochets', 'ricochet'],
    mods: { dmg: 0.95, cost: 1.2 },
    value: 1.3,
    onPlan(plan) {
      plan.bounce += 2;
    },
  },

  chain: {
    name: 'Chain',
    adj: 'Chaining',
    clause: ['leaps from foe to foe', 'leap from foe to foe'],
    mods: { dmg: 0.92, cost: 1.35 },
    value: 1.7,
    spawns: true,
    onPlan(plan) {
      plan.chain = Math.max(plan.chain, 3);
    },
    onHit(body, target, rt, info) {
      // A chain arc carries the chain on (body.carry); anything else starts one.
      const carried = body.carry === 'chain';
      if (!carried && !canProc(body, 'chain', isMissile(body) ? 1 : body.kind === 'beam' ? 6 : 2, body.kind === 'beam' ? 0.45 : 0)) return;
      const left = carried ? body.chainLeft : body.plan.chain || 3;
      if (left <= 0) return;
      const seen = body.chainSeen;
      if (!carried) seen.length = 0;
      if (!seen.includes(target)) seen.push(target);
      const next = rt.nearestFoe(body, target.x, target.y, 84, seen);
      if (!next) return;
      const c = rt.spawnChild(body, carried ? null : 'chain', 'projectile', {
        mode: 'arc',
        x: target.x,
        y: target.y - 6,
        target: next,
        speed: 560,
        r: 2,
        dmg: body.dmg * 0.78,
        life: 0.6,
        range: 200,
        homing: 60,
      });
      if (!c) return;
      c.carry = 'chain';
      c.chainLeft = left - 1;
      c.chainSeen.length = 0;
      for (let i = 0; i < seen.length && i < 12; i++) c.chainSeen.push(seen[i]);
      c.hits.set(target, 1e9);
    },
  },

  homing: {
    name: 'Homing',
    adj: 'Seeking',
    clause: ['seeks out foes', 'seek out foes'],
    mods: { dmg: 0.95, cost: 1.15 },
    value: 1.15,
    onPlan(plan) {
      plan.homing = Math.max(plan.homing, 4.2);
      plan.aimAssist = true;
    },
  },

  echo: {
    name: 'Echo',
    adj: 'Echoing',
    clause: null,
    sentence: 'It echoes a moment later.',
    mods: { dmg: 0.92, cost: 1.4, cooldown: 1.15 },
    value: 1.6,
    spawns: true,
    onEmit(bodies, rt, cast) {
      rt.recast(cast, 'echo', 0.38, 0.65);
    },
  },

  big: {
    name: 'Big',
    adj: 'Great',
    clause: ['is huge', 'are huge'],
    mods: { dmg: 1.3, cost: 1.35, size: 1.6, speed: 0.82, cooldown: 1.1 },
    value: 1.35,
  },

  swift: {
    name: 'Swift',
    adj: 'Swift',
    clause: ['is swift', 'are swift'],
    mods: { dmg: 0.88, cost: 1.05, speed: 1.6, cooldown: 0.72, life: 0.85 },
    value: 1.05,
  },

  burst: {
    name: 'Burst',
    adj: 'Bursting',
    clause: ['explodes', 'explode'],
    mods: { dmg: 0.92, cost: 1.3 },
    value: 1.45,
    spawns: true,
    onHit(body, target, rt, info) {
      // Long-lived bodies explode on a few of their hits; missiles explode when they end.
      if (isMissile(body) || body.mode === 'lob' || body.mode === 'fall') return;
      if (!canProc(body, 'burst', body.kind === 'beam' ? 4 : 2, body.kind === 'beam' ? 0.6 : 0)) return;
      rt.explode(body, info.x, info.y, 24 * body.plan.size, 0.6, 'burst');
    },
    onEnd(body, rt, why) {
      if (why === 'dismiss' || why === 'cap') return;
      if (isMissile(body) || body.mode === 'lob' || body.kind === 'summon' || body.kind === 'rune' || body.kind === 'trail') {
        rt.explode(body, body.x, body.y, 26 * body.plan.size, 0.65, 'burst');
      }
    },
  },

  linger: {
    name: 'Linger',
    adj: 'Lingering',
    clause: ['leaves a lingering patch', 'leave lingering patches'],
    mods: { dmg: 0.95, cost: 1.25 },
    value: 1.3,
    spawns: true,
    onEnd(body, rt, why) {
      if (why === 'dismiss' || why === 'cap') return;
      const s = body.plan.size;
      if (body.kind === 'trail' || body.kind === 'wall' || body.kind === 'beam') {
        // Along the line: three patches.
        const x0 = body.kind === 'beam' ? body.pts[0] : body.x;
        const y0 = body.kind === 'beam' ? body.pts[1] : body.y;
        const x1 = body.kind === 'beam' ? body.pts[body.npts * 2 - 2] : body.x2;
        const y1 = body.kind === 'beam' ? body.pts[body.npts * 2 - 1] : body.y2;
        for (let i = 0; i < 3; i++) {
          const k = (i + 0.5) / 3;
          rt.patch(body, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 15 * s, 'linger');
        }
        return;
      }
      if (body.kind === 'area' && body.mode === 'patch') return;
      const r = body.kind === 'area' ? Math.max(16, (body.r1 || 20) * 0.7) : 18 * s;
      rt.patch(body, body.x, body.y, r, 'linger');
    },
  },

  orbit: {
    name: 'Orbit',
    adj: 'Orbiting',
    clause: ['circles you first', 'circle you first'],
    mods: { dmg: 1.0, cost: 1.2, life: 1.1 },
    value: 1.1,
    onPlan(plan) {
      plan.orbit = 1.1;
    },
    onSpawn(body, rt) {
      const o = body.owner;
      const n = Math.max(1, body.plan.count);
      const phase = (body.index / n) * Math.PI * 2;
      switch (body.kind) {
        case 'projectile':
          if (body.mode === 'fly' || body.mode === 'orb') {
            body.orbitT = body.plan.orbit + body.index * 0.08;
            body.orbitA = phase;
            body.orbitR = 18 * Math.min(1.6, body.plan.size);
            body.life += body.orbitT;
          }
          break;
        case 'beam':
          body.spin = 3.2;
          break;
        case 'area':
          if (body.mode === 'cone') body.spin = 10;
          else if (body.mode === 'rain' && o) body.followOwner = true;
          break;
        case 'wall':
          if (o) {
            body.orbitR = 28;
            body.orbitA = phase;
            body.spin = 1.7;
          }
          break;
        case 'rune':
          if (o) {
            body.x = o.x + Math.cos(phase) * 30;
            body.y = o.y + Math.sin(phase) * 30;
          }
          break;
        case 'summon':
          body.orbitR = 20;
          body.orbitA = phase;
          break;
        default:
          break;
      }
    },
  },

  volley: {
    name: 'Volley',
    adj: 'Volley',
    clause: null,
    sentence: 'Three times in quick succession.',
    mods: { dmg: 0.72, cost: 1.75, cooldown: 1.2 },
    value: 2.3,
    spawns: true,
    onEmit(bodies, rt, cast) {
      rt.recast(cast, 'volley', 0.13, 1);
      rt.recast(cast, 'volley', 0.26, 1);
    },
  },

  spiral: {
    name: 'Spiral',
    adj: 'Spiraling',
    clause: ['weaves as it flies', 'weave as they fly'],
    mods: { dmg: 1.02, cost: 1.1 },
    value: 1.08,
    onSpawn(body) {
      const dir = body.index % 2 ? -1 : 1;
      if (body.kind === 'projectile' && body.mode !== 'lob' && body.mode !== 'fall') {
        body.spiralAmp = 8 * Math.min(1.8, body.plan.size);
        body.spiralFreq = 10 * dir;
      } else if (body.kind === 'beam') body.wobble = 0.24;
      else if (body.kind === 'area' && (body.mode === 'cone' || body.mode === 'ring')) body.spin = 4 * dir;
      else if (body.kind === 'area' && body.mode === 'rain') body.spiralRain = true;
      else if (body.kind === 'wall') body.wobble = 0.3;
    },
  },

  leech: {
    name: 'Leech',
    adj: 'Leeching',
    clause: ['heals you a little', 'heal you a little'],
    mods: { dmg: 0.95, cost: 1.2 },
    value: 1.15,
    onHit(body, target, rt, info) {
      if (info.dealt > 0) rt.heal(body.owner, info.dealt * 0.18, body);
    },
  },

  charge: {
    name: 'Charge',
    adj: 'Charged',
    clause: null,
    sentence: 'Hold to charge it up.',
    input: 'charge',
    mods: { cost: 1.15 },
    value: 1.25,
    onPlan(plan) {
      plan.charge = CHARGE_TIME;
    },
  },
};

const MOD_KEYS = ['dmg', 'cost', 'cooldown', 'speed', 'size', 'life'];

function fillTwist(raw, id) {
  const mods = { dmg: 1, cost: 1, cooldown: 1, speed: 1, size: 1, life: 1 };
  for (const k of MOD_KEYS) if (Number.isFinite(raw.mods?.[k])) mods[k] = raw.mods[k];
  const name = raw.name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    ...raw,
    name,
    adj: raw.adj || name,
    clause: Array.isArray(raw.clause) ? raw.clause : typeof raw.clause === 'string' ? [raw.clause, raw.clause] : null,
    sentence: raw.sentence || null,
    mods,
    value: Number.isFinite(raw.value) ? raw.value : 1,
    spawns: !!raw.spawns,
    input: raw.input === 'charge' ? 'charge' : null,
  };
}

export const Twists = defineRegistry('twist', TWISTS, fillTwist);
export const getTwist = (id) => Twists.get(id);
export const twistIds = () => Twists.ids();
export const HOOKS = ['onEmit', 'onSpawn', 'onUpdate', 'onHit', 'onEnd'];
export { canProc };
