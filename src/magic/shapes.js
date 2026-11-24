import { defineRegistry } from './registry.js';

// SHAPES: how a weave leaves the hands (DESIGN §22.1). A shape knows its base numbers,
// what its aim preview looks like, how to describe itself, and how to make bodies;
// the runtime (bodies.js) moves, hits and ends them by kind, and every essence and
// twist applies on top with no code per combination.
//
// Entry format (get() fills the rest):
// {
//   id: 'bolt', name: 'Bolt',
//   noun: 'Bolt',               name fragment: "Splitting Ember Bolt"
//   kind: 'projectile',         the main body kind it makes (projectile area beam strike
//                               summon rune wall trail) — used by twists and the UI
//   base: { dmg, cost, cooldown, speed, range, radius, count, life, ...extra },
//                               `radius` is the shape's main size: a bolt's radius, a nova's
//                               reach, a beam's half-width, a wall's half-thickness
//   hits: 1,                    expected targets hit per body (for the power budget)
//   input: 'tap' | 'hold',      'hold' = held while the button is down (beam)
//   aim(plan) -> { type: 'line'|'cone'|'circle'|'ring'|'arc'|'point', range, width, radius, ... },
//   describe(n, noun) -> 'Fires 3 bolts of fire',
//   emit(ctx),                  makes bodies with ctx.spawn(kind, init); see bodies.js for
//                               ctx (origin ox/oy, aim aimX/aimY/angle/dist, count, fan(),
//                               ring(), plan, caster, target, held, chargeK) and body fields
// }

const TAU = Math.PI * 2;
const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

export const SHAPES = {
  bolt: {
    name: 'Bolt',
    noun: 'Bolt',
    kind: 'projectile',
    base: { dmg: 9, cost: 5, cooldown: 0.32, speed: 240, range: 210, radius: 4, count: 1, life: 1.0 },
    hits: 1,
    aim: (p) => ({ type: 'line', range: p.range, width: p.radius * 2 }),
    describe: (n, noun) => `Fires ${plural(n, 'a bolt', 'bolts')} of ${noun}`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.3);
        ctx.spawn('projectile', {
          mode: 'fly',
          x: ctx.ox + Math.cos(a) * 6,
          y: ctx.oy + Math.sin(a) * 6,
          angle: a,
          speed: p.speed,
          r: p.radius,
          life: p.life,
          range: p.range,
        });
      }
    },
  },

  blast: {
    name: 'Blast',
    noun: 'Blast',
    kind: 'area',
    base: { dmg: 11, cost: 7, cooldown: 0.6, speed: 0, range: 52, radius: 52, count: 1, life: 0.24, arc: 0.62 },
    hits: 2.2,
    aim: (p) => ({ type: 'cone', range: p.range, angle: p.arc * 2, width: p.range * Math.sin(p.arc) * 2 }),
    describe: (n, noun) => `Blasts ${plural(n, 'a cone', 'cones')} of ${noun} in front of you`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, p.arc * 1.4);
        ctx.spawn('area', { mode: 'cone', x: ctx.ox, y: ctx.oy, angle: a, r0: 6, r1: p.range, arc: p.arc, life: p.life, follow: true });
      }
    },
  },

  strike: {
    name: 'Strike',
    noun: 'Fist',
    kind: 'strike',
    base: { dmg: 15, cost: 6, cooldown: 0.5, speed: 0, range: 34, radius: 12, count: 1, life: 0.28, arc: 0.85 },
    hits: 1.8,
    aim: (p) => ({ type: 'arc', range: p.range, angle: p.arc * 2, radius: p.radius }),
    describe: (n, noun) => (n === 1 ? `Punches with a fist of ${noun} and an impact wave` : `Punches ${n} times with fists of ${noun}`),
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.7);
        ctx.spawn('strike', { x: ctx.ox, y: ctx.oy, angle: a, r: p.radius, r1: p.range, arc: p.arc, life: p.life, delay: i * 0.07, follow: true });
      }
    },
  },

  throw: {
    name: 'Throw',
    noun: 'Bomb',
    kind: 'projectile',
    base: { dmg: 16, cost: 9, cooldown: 0.85, speed: 170, range: 150, radius: 28, count: 1, life: 1.6 },
    hits: 2.4,
    aim: (p) => ({ type: 'circle', range: p.range, radius: p.radius }),
    describe: (n, noun) => `Lobs ${plural(n, 'a bomb', 'bombs')} of ${noun} that burst${n === 1 ? 's' : ''} where ${n === 1 ? 'it lands' : 'they land'}`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const o = ctx.ring(i, ctx.count, 20);
        ctx.spawn('projectile', {
          mode: 'lob',
          x: ctx.ox,
          y: ctx.oy,
          tx: ctx.aimX + o.x,
          ty: ctx.aimY + o.y,
          speed: p.speed,
          r: 3 + p.size * 1.5,
          burstR: p.radius,
          life: 6,
        });
      }
    },
  },

  beam: {
    name: 'Beam',
    noun: 'Ray',
    kind: 'beam',
    input: 'hold',
    base: { dmg: 3, cost: 9, cooldown: 0.5, speed: 0, range: 150, radius: 3, count: 1, life: 0.8, tick: 0.12 },
    hits: 9,
    aim: (p) => ({ type: 'line', range: p.range, width: p.radius * 2 }),
    describe: (n, noun) => `Pours out ${plural(n, 'a beam', 'beams')} of ${noun} while held`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.26);
        ctx.spawn('beam', { x: ctx.ox, y: ctx.oy, angle: a, aimOffset: a - ctx.angle, range: p.range, r: p.radius, life: ctx.held ? 1e9 : p.life, held: !!ctx.held, tick: p.tick });
      }
    },
  },

  nova: {
    name: 'Nova',
    noun: 'Nova',
    kind: 'area',
    base: { dmg: 13, cost: 10, cooldown: 1.1, speed: 0, range: 0, radius: 58, count: 1, life: 0.34 },
    hits: 3,
    aim: (p) => ({ type: 'ring', range: 0, radius: p.radius }),
    describe: (n, noun) => `Releases ${plural(n, 'a ring', 'rings')} of ${noun} around you`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        ctx.spawn('area', { mode: 'ring', x: ctx.ox, y: ctx.oy, angle: ctx.angle, r0: 4, r1: p.radius * (1 + i * 0.18), life: p.life, delay: i * 0.13, follow: true });
      }
    },
  },

  orb: {
    name: 'Orb',
    noun: 'Orb',
    kind: 'projectile',
    base: { dmg: 5, cost: 11, cooldown: 1.3, speed: 55, range: 190, radius: 8, count: 1, life: 3.4, tick: 0.4 },
    hits: 7,
    aim: (p) => ({ type: 'line', range: p.range, width: p.radius * 2 }),
    describe: (n, noun) => `Sends ${plural(n, 'a slow orb', 'slow orbs')} of ${noun} that pulse${n === 1 ? 's' : ''} at everything near`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.4);
        ctx.spawn('projectile', {
          mode: 'orb',
          x: ctx.ox + Math.cos(a) * 8,
          y: ctx.oy + Math.sin(a) * 8,
          angle: a,
          speed: p.speed,
          r: p.radius,
          life: p.life,
          range: p.range,
          pulseR: p.radius * 2.8,
          tick: p.tick,
          pierce: 999,
        });
      }
    },
  },

  summon: {
    name: 'Summon',
    noun: 'Familiar',
    kind: 'summon',
    base: { dmg: 5, cost: 18, cooldown: 6, speed: 85, range: 120, radius: 6, count: 1, life: 14, atkCd: 1.0 },
    hits: 12,
    aim: () => ({ type: 'point', range: 30, radius: 8 }),
    describe: (n, noun, plan) => {
      const f = plan?.familiar?.name || 'familiar';
      return n === 1 ? `Calls ${/^[aeiou]/i.test(f) ? 'an' : 'a'} ${f.toLowerCase()} of ${noun} that fights beside you` : `Calls ${n} ${f.toLowerCase()}s of ${noun} that fight beside you`;
    },
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const o = ctx.ring(i, ctx.count, 16);
        ctx.spawn('summon', {
          x: ctx.ox + o.x - Math.cos(ctx.angle) * 4,
          y: ctx.oy + o.y - Math.sin(ctx.angle) * 4,
          speed: p.speed,
          r: p.radius,
          life: p.life,
          aggro: p.range,
          atkCd: p.atkCd,
          slot: i,
        });
      }
    },
  },

  rune: {
    name: 'Rune',
    noun: 'Rune',
    kind: 'rune',
    base: { dmg: 20, cost: 9, cooldown: 0.7, speed: 0, range: 120, radius: 30, count: 1, life: 24, arm: 0.6 },
    hits: 2.2,
    aim: (p) => ({ type: 'circle', range: p.range, radius: p.radius }),
    describe: (n, noun) => `Draws ${plural(n, 'a rune trap', 'rune traps')} of ${noun} that burst${n === 1 ? 's' : ''} when a foe steps close`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const o = ctx.ring(i, ctx.count, 26);
        ctx.spawn('rune', { x: ctx.aimX + o.x, y: ctx.aimY + o.y, r: 7, triggerR: 14, burstR: p.radius, life: p.life, arm: p.arm });
      }
    },
  },

  rain: {
    name: 'Rain',
    noun: 'Rain',
    kind: 'area',
    base: { dmg: 6, cost: 14, cooldown: 2.2, speed: 0, range: 140, radius: 34, count: 1, life: 1.6, drops: 12 },
    hits: 6,
    aim: (p) => ({ type: 'circle', range: p.range, radius: p.radius }),
    describe: (n, noun) => `Calls down ${n === 1 ? 'a rain' : `${n} rains`} of ${noun} on the spot you aim at`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        const o = ctx.ring(i, ctx.count, p.radius * 0.9);
        ctx.spawn('area', { mode: 'rain', x: ctx.aimX + o.x, y: ctx.aimY + o.y, r1: p.radius, life: p.life, drops: p.drops, dropR: 8 + p.size * 2 });
      }
    },
  },

  wall: {
    name: 'Wall',
    noun: 'Wall',
    kind: 'wall',
    base: { dmg: 4, cost: 12, cooldown: 3, speed: 0, range: 70, radius: 4, count: 1, life: 6, length: 54, tick: 0.5 },
    hits: 4,
    aim: (p) => ({ type: 'line', range: p.range, width: p.radius * 2, length: p.length, across: true }),
    describe: (n, noun) => `Raises ${n === 1 ? 'a wall' : `${n} walls`} of ${noun} that stops foes and their arrows`,
    emit(ctx) {
      const p = ctx.plan;
      const across = ctx.angle + Math.PI / 2;
      for (let i = 0; i < ctx.count; i++) {
        const k = i - (ctx.count - 1) / 2;
        const off = k * p.length * 0.92;
        ctx.spawn('wall', {
          x: ctx.aimX + Math.cos(across) * off,
          y: ctx.aimY + Math.sin(across) * off,
          angle: across + k * 0.25,
          len: p.length,
          r: p.radius,
          life: p.life,
          tick: p.tick,
        });
      }
    },
  },

  dash: {
    name: 'Dash',
    noun: 'Blink',
    kind: 'trail',
    base: { dmg: 7, cost: 7, cooldown: 1.3, speed: 420, range: 72, radius: 6, count: 1, life: 1.2, tick: 0.25 },
    hits: 2,
    aim: (p) => ({ type: 'line', range: p.range, width: p.radius * 2 }),
    describe: (n, noun) => (n === 1 ? `Blinks forward, leaving a trail of ${noun}` : `Blinks forward, leaving ${n} trails of ${noun}`),
    emit(ctx) {
      const p = ctx.plan;
      const dist = Math.min(p.range, Math.max(24, ctx.dist));
      ctx.dash(ctx.angle, dist, p.range / Math.max(60, p.speed));
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.5);
        const lead = i === Math.floor(ctx.count / 2) && Math.abs(a - ctx.angle) < 1e-6;
        ctx.spawn('trail', {
          x: ctx.ox,
          y: ctx.oy,
          x2: ctx.ox + (lead ? 0 : Math.cos(a) * dist),
          y2: ctx.oy + (lead ? 0 : Math.sin(a) * dist),
          r: p.radius,
          life: p.life,
          tick: p.tick,
          follow: lead,
          angle: a,
        });
      }
    },
  },
};

const BASE_KEYS = ['dmg', 'cost', 'cooldown', 'speed', 'range', 'radius', 'count', 'life'];

function fillShape(raw, id) {
  const base = { dmg: 8, cost: 6, cooldown: 0.5, speed: 0, range: 100, radius: 6, count: 1, life: 1 };
  for (const k of Object.keys(raw.base || {})) if (Number.isFinite(raw.base[k])) base[k] = raw.base[k];
  const name = raw.name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    ...raw,
    name,
    noun: raw.noun || name,
    kind: raw.kind || 'projectile',
    base,
    hits: Number.isFinite(raw.hits) ? raw.hits : 1,
    input: raw.input === 'hold' ? 'hold' : 'tap',
    aim: typeof raw.aim === 'function' ? raw.aim : (p) => ({ type: 'line', range: p.range, width: p.radius * 2 }),
    describe: typeof raw.describe === 'function' ? raw.describe : (n, noun) => `Casts ${n === 1 ? `a ${name.toLowerCase()}` : `${n} ${name.toLowerCase()}s`} of ${noun}`,
    emit: typeof raw.emit === 'function' ? raw.emit : SHAPES_FALLBACK_EMIT,
  };
}

// A shape with no emit() still works: it fires bolts.
function SHAPES_FALLBACK_EMIT(ctx) {
  const p = ctx.plan;
  for (let i = 0; i < ctx.count; i++) {
    const a = ctx.fan(i, ctx.count, 0.3);
    ctx.spawn('projectile', { mode: 'fly', x: ctx.ox, y: ctx.oy, angle: a, speed: p.speed || 200, r: p.radius, life: p.life, range: p.range });
  }
}

export const Shapes = defineRegistry('shape', SHAPES, fillShape);
export const getShape = (id) => Shapes.get(id);
export const shapeIds = () => Shapes.ids();
export { BASE_KEYS, TAU };
