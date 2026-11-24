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
//   describe(n, noun, plan) -> 'Fires 3 bolts of fire',
//   clauseStyle: 'that' | 'sentence',   twists read '...bolts of fire that split' or, after a
//                               head with an ending of its own ('...around you'), 'They split...'
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
    clauseStyle: 'that',
    base: { dmg: 9, cost: 4, cooldown: 0.32, speed: 240, range: 210, radius: 4, count: 1, life: 1.0 },
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
  // DESIGN §22.5 (the author: "even the binding spell that the girl has, I can have it as
  // well"): the stranger's own Stillring. A ring of light flies to the mark and closes on
  // it: held — rooted, no blows, no weaves — for a few heartbeats. Whatever a bind weave
  // touches is held (its shards, arcs, bursts, a lingering patch's bite), so every twist
  // binds in its own way; children hold for less. Bosses resist: a shorter hold, shorter
  // again each time (magic.holdTarget). Aimed at a villager or Lyra it is an attack.
  bind: {
    name: 'Bind',
    noun: 'Bind',
    kind: 'projectile',
    clauseStyle: 'that',
    missile: 'ring', // fx draws the flying ring, not a bolt
    base: { dmg: 4, cost: 10, cooldown: 4.5, speed: 300, range: 150, radius: 5, count: 1, life: 0.9, hold: 2.6, tick: 0.7 },
    hits: 1,
    aim: (p) => ({ type: 'bind', range: p.range, radius: 10 }),
    describe: (n, noun) =>
      n === 1 ? `Throws a ring of ${noun} that closes on what you aim at and holds it still` : `Throws ${n} rings of ${noun} that close on foes and hold them still`,
    onPlan(plan) {
      // A ring finds its mark: it steers hard and forgives a loose aim.
      plan.homing = Math.max(plan.homing, 9);
      plan.aimAssist = true;
      // It closes; it does not shove (or, in a gale, toss) what it holds.
      plan.knock = 0;
      plan.launch = 0;
      plan.hold = (plan.hold || 2.6) * Math.max(0.5, Math.min(2.2, plan.lifeMul || 1));
    },
    emit(ctx) {
      const p = ctx.plan;
      const rt = ctx.rt;
      // Many rings, many marks: the aimed one first, then whoever stands nearest it.
      const chosen = ctx.target ? [ctx.target] : [];
      for (let i = 0; i < ctx.count; i++) {
        const a = ctx.fan(i, ctx.count, 0.35);
        let target = i === 0 ? ctx.target : null;
        if (!target && i > 0 && rt?.nearestFoe) {
          target = rt.nearestFoe({ cast: ctx.cast }, ctx.aimX, ctx.aimY, 110, chosen);
          if (target) chosen.push(target);
        }
        ctx.spawn('projectile', {
          mode: 'fly',
          x: ctx.ox + Math.cos(a) * 6,
          y: ctx.oy + Math.sin(a) * 6,
          angle: a,
          speed: p.speed,
          r: p.radius,
          life: p.life,
          range: p.range,
          target: target || undefined,
        });
      }
    },
    onHit(body, target, rt, info) {
      if (body.kind === 'bind') return; // the hold itself bites; it never binds again
      rt.holdTarget?.(body, target, info);
    },
  },

  // DESIGN §22.5 ("a shield spell that would save me from spells"): a ward around the
  // caster, or around the friend it is aimed at. It takes blows until its strength is
  // spent, stops foes' arrows, bolts, globs and weaves, and answers whoever strikes it
  // with its essences (fire burns them, frost chills…). magic.js runs it (absorb, the
  // shots it stops, its flavors below); twists that mean something else on a shield are
  // adapted: linger lasts longer, burst bursts when it breaks, orbit becomes a ring of
  // small shields, bounce turns missiles back, spiral turns them aside, homing finds the
  // friend who needs it most.
  ward: {
    name: 'Ward',
    noun: 'Ward',
    kind: 'ward',
    base: { dmg: 5, cost: 14, cooldown: 8, speed: 0, range: 110, radius: 13, count: 1, life: 6, shield: 24, tick: 0.5 },
    hits: 2,
    aim: (p) => ({ type: 'shield', range: p.range, radius: p.radius }),
    describe: (n, noun) =>
      n === 1
        ? `Raises a ward of ${noun} around you (or the friend you aim at) that takes blows and stops missiles`
        : `Raises wards of ${noun} around you and up to ${n - 1} friend${n > 2 ? 's' : ''} near you that take blows and stop missiles`,
    adapt: {
      linger: { hooks: false, clause: ['lasts longer', 'last longer'], onPlan: (p) => (p.life *= 1.7) },
      burst: { hooks: false, clause: ['bursts when it breaks', 'burst when they break'], onPlan: (p) => (p.wardBurst = true) },
      orbit: { hooks: false, clause: ['becomes a ring of small shields', 'become rings of small shields'], onPlan: (p) => (p.wardOrbit = true) },
      bounce: { clause: ['turns missiles back', 'turn missiles back'], onPlan: (p) => (p.reflect = true) },
      spiral: { hooks: false, clause: ['turns missiles aside', 'turn missiles aside'], onPlan: (p) => (p.deflect = true) },
      homing: { clause: ['finds whoever needs it most', 'find whoever needs them most'], onPlan: (p) => (p.seekHurt = true) },
      pierce: { clause: ['bites through armour', 'bite through armour'] },
      split: { clause: ['throws off shards when struck', 'throw off shards when struck'] },
      chain: { clause: ['arcs into whoever strikes it', 'arc into whoever strikes them'] },
    },
    onPlan(plan) {
      const f = wardFlavor(plan);
      plan.ward = f;
      plan.shield = Math.round((plan.shield || 24) * f.absorb * Math.pow(plan.size || 1, 0.6) * 10) / 10;
      if (f.reflect) plan.reflect = true;
      if (f.deflect) plan.deflect = true;
    },
    emit(ctx) {
      const p = ctx.plan;
      const rt = ctx.rt;
      const bearers = rt?.wardBearers ? rt.wardBearers(ctx.cast, p, ctx.count) : [ctx.caster];
      const k = (rt?.powerOf ? rt.powerOf(ctx.caster) : 1) * (ctx.cast?.curMul ?? 1) * (1 + 0.6 * (ctx.chargeK || 0));
      for (let i = 0; i < ctx.count; i++) {
        // More wards than friends near: the rest thicken the first.
        const who = bearers[i] || bearers[0] || ctx.caster;
        ctx.spawn('ward', { target: who, x: who.x, y: who.y, r: p.radius, life: p.life, shield: p.shield * k * (bearers[i] ? 1 : 0.5), tick: p.tick, delay: i * 0.05 });
      }
    },
  },
};

// How each essence flavors a bind (DESIGN §22.5: "fire ring burns, frost freezes the hold
// longer, storm shocks, dark drains, song lulls, nature roots with vines…"). hold: how
// long it holds; tick: how hard the ring bites while it holds, for the essences that
// bite (its statuses ride on the bite: burning, shocked, drained…; the rest hold the way
// Lyra's does, without hurting); after: a status left when it lets go. An essence with
// no entry holds plainly.
export const BIND_FLAVORS = {
  raw: { hold: 1, tick: 0 },
  fire: { hold: 0.9, tick: 1 },
  water: { hold: 1, tick: 0 },
  frost: { hold: 1.45, tick: 0 },
  storm: { hold: 0.9, tick: 0.8 },
  earth: { hold: 1.15, tick: 0 },
  wind: { hold: 0.85, tick: 0 },
  nature: { hold: 1.05, tick: 0.4, after: 'rooted' },
  poison: { hold: 1, tick: 0.7 },
  light: { hold: 1, tick: 0 },
  dark: { hold: 1, tick: 0.8 },
  iron: { hold: 1.2, tick: 0 },
  song: { hold: 1.3, tick: 0, after: 'lulled' },
};
const BIND_DEFAULT = { hold: 1, tick: 0 };

// How each essence flavors a ward ("light reflects bolts back, fire burns whoever strikes
// it, frost chills them, earth and iron absorb more but slow you, water heals a little,
// wind deflects missiles, storm shocks, dark drinks a little health, nature grows thorns,
// poison stings, song shields nearby friends too"). absorb: strength; thorns: how hard it
// answers a blow (its statuses ride on it); heal: share of max health per second; slow:
// the bearer's pace while it stands; drink: share of each blow it turns into health;
// share: px around the bearer whose friends it also shields; reach: wider catch.
export const WARD_FLAVORS = {
  raw: { absorb: 1, thorns: 0.35 },
  fire: { absorb: 0.9, thorns: 1.1 },
  water: { absorb: 1, thorns: 0.3, heal: 0.02 },
  frost: { absorb: 1, thorns: 0.6 },
  storm: { absorb: 0.9, thorns: 0.9 },
  earth: { absorb: 1.55, thorns: 0.4, slow: 0.8 },
  wind: { absorb: 0.85, thorns: 0.4, deflect: true, reach: 1.35 },
  nature: { absorb: 1.05, thorns: 1 },
  poison: { absorb: 0.95, thorns: 0.8 },
  light: { absorb: 1, thorns: 0.35, reflect: true },
  dark: { absorb: 1, thorns: 0.7, drink: 0.2 },
  iron: { absorb: 1.6, thorns: 0.5, slow: 0.78 },
  song: { absorb: 0.95, thorns: 0.2, share: 46 },
};
const WARD_DEFAULT = { absorb: 1, thorns: 0.4 };

const flavorCache = new WeakMap();

// A plan's blended bind flavor: holds and bites average, every after-status is kept.
export function bindFlavor(plan) {
  let f = plan && flavorCache.get(plan);
  if (f) return f;
  const ess = plan?.essences?.length ? plan.essences : ['raw'];
  f = { hold: 0, tick: 0, after: [] };
  for (const e of ess) {
    const d = BIND_FLAVORS[e] || BIND_DEFAULT;
    f.hold += (d.hold ?? 1) / ess.length;
    f.tick += (d.tick ?? 0) / ess.length;
    if (d.after && !f.after.includes(d.after)) f.after.push(d.after);
  }
  if (plan && typeof plan === 'object') flavorCache.set(plan, f);
  return f;
}

// A plan's blended ward flavor: strengths average, every gift is kept (at the
// strongest one any of its essences gives).
export function wardFlavor(plan) {
  const ess = plan?.essences?.length ? plan.essences : ['raw'];
  const f = { absorb: 0, thorns: 0, heal: 0, slow: 1, drink: 0, share: 0, reach: 1, reflect: false, deflect: false };
  for (const e of ess) {
    const d = WARD_FLAVORS[e] || WARD_DEFAULT;
    f.absorb += (d.absorb ?? 1) / ess.length;
    f.thorns += (d.thorns ?? 0.4) / ess.length;
    if (d.heal) f.heal = Math.max(f.heal, d.heal);
    if (d.slow) f.slow = Math.min(f.slow, d.slow);
    if (d.drink) f.drink = Math.max(f.drink, d.drink);
    if (d.share) f.share = Math.max(f.share, d.share);
    if (d.reach) f.reach = Math.max(f.reach, d.reach);
    if (d.reflect) f.reflect = true;
    if (d.deflect) f.deflect = true;
  }
  return f;
}

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
