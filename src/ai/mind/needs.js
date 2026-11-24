import { clamp01 } from './text.js';

// Lyra's needs, 0..1 where 1 is fully satisfied. They drift every step with what she
// is doing (fighting and working tire her, sitting and sleeping rest her) and with
// where she is (danger and low health erode her sense of safety).

export const NEEDS = ['energy', 'hunger', 'social', 'fun', 'safety'];

// Per second of play.
const RATE = {
  energy: { base: -0.00035, moving: -0.0002, working: -0.0008, combat: -0.0025, sitting: 0.004, sleeping: 0.012 },
  hunger: { base: -0.0007, busyMul: 1.8 },
  social: { base: -0.0005, nearPlayerMul: 0.45, aloneNightMul: 1.4 },
  fun: { base: -0.00055, workingMul: 1.4, idleMul: 1.2, newPlaceGain: 0.0006 },
};

// How much each food fills her (also used to choose what to eat).
export const FOOD_VALUE = {
  honey_cake: 0.5,
  stew: 0.75,
  cooked_fish: 0.5,
  bread: 0.4,
  turnip: 0.2,
  berries: 0.15,
  raw_fish: 0.08,
};

// Her order of preference when she is hungry (she will not eat raw fish).
export const FOOD_PREFERENCE = ['honey_cake', 'bread', 'cooked_fish', 'stew', 'berries', 'turnip'];

const PHRASES = {
  energy: ['exhausted', 'tired', 'a little tired', 'rested', 'full of energy'],
  hunger: ['starving', 'hungry', 'a bit peckish', 'fed', 'nicely full'],
  social: ['lonely', 'starved for company', 'happy to chat', 'glad of the company', 'well talked-out'],
  fun: ['bored stiff', 'restless', 'itching for something new', 'entertained', 'delighted with the day'],
  safety: ['frightened', 'on edge', 'wary', 'safe enough', 'perfectly safe'],
};

export class Needs {
  constructor(init = null) {
    this.values = { energy: 0.86, hunger: 0.72, social: 0.7, fun: 0.62, safety: 0.92 };
    if (init) this.deserialize(init);
  }

  // act: { moving, working, combat, sitting, sleeping, nearPlayer, danger 0..3,
  //        hpFrac 0..1, threats (count), night, indoor, exploring }
  update(dt, act = {}) {
    const v = this.values;
    const busy = act.combat || act.working;

    let e = RATE.energy.base;
    if (act.sleeping) e = RATE.energy.sleeping;
    else if (act.sitting) e = RATE.energy.sitting;
    else {
      if (act.moving) e += RATE.energy.moving;
      if (act.working) e += RATE.energy.working;
      if (act.combat) e += RATE.energy.combat;
    }
    v.energy = clamp01(v.energy + e * dt);

    const h = RATE.hunger.base * (busy ? RATE.hunger.busyMul : 1) * (act.sleeping ? 0.4 : 1);
    v.hunger = clamp01(v.hunger + h * dt);

    let s = RATE.social.base;
    if (act.nearPlayer) s *= RATE.social.nearPlayerMul;
    else if (act.night) s *= RATE.social.aloneNightMul;
    v.social = clamp01(v.social + s * dt);

    let f = RATE.fun.base;
    if (act.working) f *= RATE.fun.workingMul;
    else if (!act.moving && !act.combat) f *= RATE.fun.idleMul;
    if (act.exploring) f = RATE.fun.newPlaceGain;
    v.fun = clamp01(v.fun + f * dt);

    // Safety chases a target set by the surroundings: falls fast, recovers slowly.
    const target = this.safetyTarget(act);
    const rate = target < v.safety ? 0.35 : 0.04;
    const step = rate * dt;
    v.safety = target < v.safety ? Math.max(target, v.safety - step) : Math.min(target, v.safety + step);
  }

  safetyTarget(act) {
    let t = 1;
    t -= (act.danger || 0) * 0.16;
    if (Number.isFinite(act.hpFrac) && act.hpFrac < 0.5) t -= (0.5 - act.hpFrac) * 1.2;
    t -= Math.min(3, act.threats || 0) * 0.14;
    if (act.night && !act.indoor) t -= 0.08;
    if (act.combat) t -= 0.12;
    if (act.nearPlayer) t += 0.06;
    if (act.indoor) t += 0.05;
    return clamp01(t);
  }

  satisfy(name, amount) {
    if (!(name in this.values) || !Number.isFinite(amount)) return 0;
    const before = this.values[name];
    this.values[name] = clamp01(before + amount);
    return this.values[name] - before;
  }

  // Eating fills hunger by the food's value; returns how much it helped.
  eat(itemId) {
    const gain = FOOD_VALUE[itemId] ?? 0;
    if (!gain) return 0;
    if (itemId === 'honey_cake') this.satisfy('fun', 0.05);
    return this.satisfy('hunger', gain);
  }

  // A night's sleep.
  sleep() {
    const v = this.values;
    v.energy = Math.max(v.energy, 0.97);
    v.hunger = Math.min(v.hunger, 0.55);
    v.safety = Math.max(v.safety, 0.9);
    v.fun = Math.max(v.fun, 0.55);
  }

  // The lowest need under `threshold`, or null.
  pressing(threshold = 0.35) {
    let best = null;
    let bv = threshold;
    for (const n of NEEDS) {
      if (this.values[n] < bv) {
        bv = this.values[n];
        best = n;
      }
    }
    return best;
  }

  phrase(name) {
    const v = this.values[name];
    const list = PHRASES[name];
    if (!list) return '';
    const i = v < 0.15 ? 0 : v < 0.35 ? 1 : v < 0.55 ? 2 : v < 0.85 ? 3 : 4;
    return list[i];
  }

  // "a bit peckish, rested, glad of the company"
  describe() {
    const parts = [];
    const order = NEEDS.slice().sort((a, b) => this.values[a] - this.values[b]);
    for (const n of order) {
      const v = this.values[n];
      if (v < 0.55 || parts.length < 2) parts.push(this.phrase(n));
      if (parts.length >= 3) break;
    }
    return parts.join(', ');
  }

  serialize() {
    const o = {};
    for (const n of NEEDS) o[n] = Math.round(this.values[n] * 1000) / 1000;
    return o;
  }

  deserialize(d) {
    if (!d) return;
    for (const n of NEEDS) if (Number.isFinite(d[n])) this.values[n] = clamp01(d[n]);
  }
}
