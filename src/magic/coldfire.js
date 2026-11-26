// Coldfire: the taken flame (round 14b §13b, S20-7 and S20-8; workstream soul; DESIGN §37.9;
// LORE §2, "The Unkindling — the cold that takes"). `game.unkindle.coldfire`.
//
// The author: "I want that there's a bar that when I take the soul of someone, it boosts my
// power. But again, it shows some weird things about me."
//
// Two measures, both saved:
//   bar     0..MAX, shown (the HUD beside health once the first soul is taken; the Character
//           panel with its numbers). Every soul the Unkindling takes adds to it by that soul's
//           strength (a grown person a lot, a bandit a fair amount, a beast a little); it ebbs
//           like a hunger, EBB a day, by the clock (sleeping ebbs it too).
//   mark    hidden: how much has been taken over time. Each soul adds to it (MARK_GAIN); it
//           fades very slowly (MARK_FADE a day) once MARK_REST days pass without taking.
//           `settled` follows the mark up at SETTLE a day (the signs come on over days) and down
//           at once; tier() reads it: 0 none, 1 faint (cold hands, breath that fogs on a warm
//           night), 2 clear (flames lean away, beasts shy, frost in your footprints at night),
//           3 strong (a pale glint in your eyes at night, a shadow slow to follow, the flowers
//           by your bed wilt). Never a health loss: the price is that it shows (S20-6 replaced).
//
// What a full bar gives (b = bar / MAX), through the one stat pipeline (src/core/stats.js:
// a live provider, as survival's and the prices' are; nothing in magic.js or combat.js is
// touched): Sword and Weave power +BOOST·b (a full bar +30%: strong, never a one-shot on a
// boss), the Unkindling channels faster (dur / (1 + CHANNEL·b)) and your power in its strength
// check grows (× (1 + POWER·b)), so a fuller bar takes stronger souls.
//
// The rite at the chapel flame (src/society/dark_suspicion.js, Aveline's offer, your choice)
// lets the cold out: rite() empties the bar and takes most of the mark.

import { DAY_SECONDS } from '../core/constants.js';

export const MAX = 100;
// What a soul adds to the bar, by its kind; scaled by its strength against a typical one.
export const FILL = Object.freeze({ person: 36, bandit: 20, beast: 8, boss: 60, tempter: 60 });
export const TYPICAL = Object.freeze({ person: 14, bandit: 15, beast: 10, boss: 100, tempter: 100 });
export const EBB = 14; // bar a day: a full bar is gone in about a week
export const BOOST = 0.3; // Sword and Weave power at a full bar
export const CHANNEL = 0.4; // how much faster a full bar pulls
export const POWER = 0.5; // how much stronger a full bar makes you in the strength check
// The mark (hidden): what each soul leaves, how fast the signs come on and leave.
export const MARK_GAIN = Object.freeze({ person: 1, bandit: 0.5, beast: 0.3, boss: 1.5, tempter: 1.5 });
export const MARK_MAX = 8;
export const SETTLE = 0.5; // mark a day the signs come on by
export const MARK_REST = 5; // days without taking before the cold starts to leave you
export const MARK_FADE = 0.1; // a day, after that
export const TIERS = Object.freeze([0.4, 1, 4]); // settled mark for faint, clear, strong
export const TIER_NAMES = Object.freeze(['none', 'faint', 'clear', 'strong']);

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const round2 = (v) => Math.round(v * 100) / 100;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[coldfire]', err);
    return fallback;
  }
}

export class Coldfire {
  constructor(game) {
    this.game = game;
    this.bar = 0;
    this.mark = 0;
    this.settled = 0;
    this.taken = { person: 0, bandit: 0, beast: 0, boss: 0, tempter: 0 }; // souls, all time
    this.lastTakenDay = null;
    this.lastTakenT = null;
    this.firstTakenDay = null;
    this.rites = 0;
    this._t = null; // the clock when last stepped (ebb and settling follow the clock, sleep too)
    this._provided = false;
    this._shownStep = -1;
  }

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : Number(this.game?.time) || 0;
  }

  day() {
    return this.game?.clock?.day ?? 1;
  }

  // Has a soul ever been taken (the HUD shows the bar from then on).
  get shown() {
    return this.firstTakenDay != null;
  }

  // 0..1
  get frac() {
    return clamp(this.bar / MAX);
  }

  // ------------------------------------------------------------------ filling

  // How much this soul gives, by its kind and strength.
  fillFor(kind, strength = null) {
    const base = FILL[kind] ?? 0;
    if (!base) return 0;
    const typ = TYPICAL[kind] || 14;
    const k = Number.isFinite(strength) && strength > 0 ? clamp(strength / typ, 0.6, 1.5) : 1;
    return round2(base * k);
  }

  // A soul was taken (unkindle.take). -> what it added to the bar.
  take(kind, strength = null) {
    const add = this.fillFor(kind, strength);
    if (!(add > 0) && !MARK_GAIN[kind]) return 0;
    this.step(); // bring the ebb up to now first
    this.bar = Math.min(MAX, round2(this.bar + add));
    this.mark = Math.min(MARK_MAX, round2(this.mark + (MARK_GAIN[kind] || 0)));
    if (this.taken[kind] != null) this.taken[kind]++;
    this.lastTakenDay = this.day();
    this.lastTakenT = Math.round(this.now());
    if (this.firstTakenDay == null) this.firstTakenDay = this.day();
    this.touch();
    safe(() => this.game?.bus?.emit?.('coldfire', { bar: this.bar, add, kind, mark: this.mark }));
    return add;
  }

  // Aveline's rite at the chapel flame (your choice): the cold let out.
  rite() {
    this.step();
    const had = this.bar;
    this.bar = 0;
    this.mark = round2(this.mark * 0.4);
    this.settled = Math.min(this.settled, this.mark);
    this.rites++;
    this.touch();
    safe(() => this.game?.bus?.emit?.('coldfire', { bar: 0, add: -had, kind: 'rite', mark: this.mark }));
    return had;
  }

  // ------------------------------------------------------------------ what it gives

  // Sword and Weave power, as a multiplier share (0..BOOST).
  boost() {
    return round2(BOOST * this.frac);
  }

  // The Unkindling's channel, shortened by a fuller bar.
  channelMul() {
    return 1 / (1 + CHANNEL * this.frac);
  }

  // The strength check: your power, grown by the bar.
  powerMul() {
    return 1 + POWER * this.frac;
  }

  // For the stat pipeline (stats.addProvider): the live modifier on the player.
  modifiers(actor) {
    const g = this.game;
    if (!actor || (actor !== g?.player && actor.id !== 'player')) return null;
    const b = this.boost();
    if (!(b > 0.004)) return null;
    return [{ id: 'coldfire', source: 'coldfire', label: 'Coldfire', kind: 'gain', pct: { atk: b, spellPower: b }, t: null, color: '#9fd4ff', icon: 'coldfire', note: 'Taken flame, burning cold in you' }];
  }

  // Register the provider once (feature-detected: a test game may have no stat pipeline).
  provide() {
    const S = this.game?.stats;
    if (this._provided || !S || typeof S.addProvider !== 'function') return false;
    S.addProvider('coldfire', (a) => this.modifiers(a));
    this._provided = true;
    return true;
  }

  touch() {
    safe(() => this.game?.stats?.touch?.());
  }

  // ------------------------------------------------------------------ the signs

  // 0 none, 1 faint, 2 clear, 3 strong (from the settled mark: the signs come on over days).
  tier() {
    const s = this.settled;
    return s >= TIERS[2] ? 3 : s >= TIERS[1] ? 2 : s >= TIERS[0] ? 1 : 0;
  }

  tierName() {
    return TIER_NAMES[this.tier()];
  }

  // Days since a soul was last taken (Infinity: never).
  restDays() {
    if (this.lastTakenT == null) return Infinity;
    return Math.max(0, (this.now() - this.lastTakenT) / DAY_SECONDS);
  }

  // ------------------------------------------------------------------ the clock

  // Ebb, settle and fade by the clock since the last step (so a night's sleep counts).
  step() {
    const t = this.now();
    if (this._t == null || t < this._t) {
      this._t = t;
      return 0;
    }
    const days = (t - this._t) / DAY_SECONDS;
    this._t = t;
    if (!(days > 0)) return 0;
    const before = this.boost();
    if (this.bar > 0) this.bar = Math.max(0, this.bar - EBB * days);
    // The signs come on toward the mark over days; they go with it at once.
    if (this.settled < this.mark) this.settled = Math.min(this.mark, this.settled + SETTLE * days);
    // Once you stop: after MARK_REST days, the cold leaves you, very slowly.
    const rest = this.restDays();
    if (this.mark > 0 && rest > MARK_REST) {
      const over = Math.min(days, rest - MARK_REST);
      this.mark = Math.max(0, this.mark - MARK_FADE * over);
    }
    if (this.settled > this.mark) this.settled = this.mark;
    if (this.bar < 0.01) this.bar = 0;
    if (this.boost() !== before) this.touch();
    return days;
  }

  update() {
    this.step();
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    return {
      v: 1,
      bar: round2(this.bar),
      mark: round2(this.mark),
      settled: round2(this.settled),
      taken: { ...this.taken },
      lastTakenDay: this.lastTakenDay,
      lastTakenT: this.lastTakenT,
      firstTakenDay: this.firstTakenDay,
      rites: this.rites,
    };
  }

  deserialize(d, legacyMark = null) {
    this._t = null;
    if (!d || typeof d !== 'object') {
      // A save from before the bar: the old mark (souls taken) carries over, settled.
      const m = Math.max(0, Number(legacyMark) || 0);
      this.bar = 0;
      this.mark = Math.min(MARK_MAX, m);
      this.settled = this.mark;
      return;
    }
    const n = (v, a = 0, b = Infinity) => (Number.isFinite(Number(v)) ? clamp(Number(v), a, b) : a);
    this.bar = n(d.bar, 0, MAX);
    this.mark = n(d.mark, 0, MARK_MAX);
    this.settled = Math.min(this.mark, n(d.settled, 0, MARK_MAX));
    const tk = d.taken && typeof d.taken === 'object' ? d.taken : {};
    for (const k of Object.keys(this.taken)) this.taken[k] = Math.max(0, Math.floor(Number(tk[k]) || 0));
    this.lastTakenDay = Number.isFinite(d.lastTakenDay) ? d.lastTakenDay : null;
    this.lastTakenT = Number.isFinite(d.lastTakenT) ? d.lastTakenT : null;
    this.firstTakenDay = Number.isFinite(d.firstTakenDay) ? d.firstTakenDay : null;
    this.rites = Math.max(0, Math.floor(Number(d.rites) || 0));
    this.touch();
  }
}
