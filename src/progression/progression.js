import { ATTRS, ATTR_IDS, POINTS_PER_LEVEL, LEVEL_GROWTH, XP_FOR, THREAT, respecCost, scaled, pointsEffect, nextPoint } from './attributes.js';
import { STATS } from '../core/stats.js';

// Levels and stat points (DESIGN §26): game.progression.
//
//   earned() -> points the levels have given      unspent() -> points still to spend
//   spend(attr, n = 1) -> { ok, reason? }          canSpend(attr)
//   respec(by = 'aveline') -> { ok, reason?, cost }   (the chapel, for coin)
//   startFree() / endFree() -> bool, free           (Settings → Game → Practice: Free stat
//                                                   points; raise anything, then the real
//                                                   points come back)
//   points (the spent ones, by attribute)           xpFor(kind) (fights are combat's)
//   nextGain(attr) -> [{ stat, part, d, first,      what one more point adds: the curve's step
//     before, after, real, limit }]                 (d) and what it really does (the pipeline)
//   serialize() / deserialize(d)
//
// The pipeline's 'level' and 'points' sources live here, so a level or a point is
// felt everywhere the moment it lands. Bus: points_changed {unspent, points},
// respec {cost}.

const own = Object.prototype.hasOwnProperty;

// While Free stat points is on, one attribute can hold at most this many (the curve keeps
// what they add under each effect's soft cap, and the pipeline clamps the rest).
export const FREE_MAX = 999;

function emptyPoints() {
  const o = {};
  for (const id of ATTR_IDS) o[id] = 0;
  return o;
}

export class Progression {
  constructor(game) {
    this.game = game;
    this.points = emptyPoints();
    this.bonus = 0; // points from elsewhere than levels (a mission's gift)
    this.respecs = 0;
    // Free stat points (r13; the author: "give me a button to give me inf stats points
    // like the magic thing"): while on, points cost nothing and the ones really spent wait
    // in `realPoints`, to come back when it is turned off.
    this.free = false;
    this.realPoints = null;
    const S = game.stats;
    if (S) {
      S.addSource('level', 'Level', (a) => this.levelContribution(a), 10);
      S.addSource('points', 'Points', (a) => this.pointsContribution(a), 20);
      S.addSource('threat', 'The wilds grow bolder', (a) => this.threatContribution(a), 40);
    }
    this._bind();
  }

  _bind() {
    const g = this.game;
    const bus = g.bus;
    if (!bus?.on) return;
    try {
      bus.on('level_up', (p) => {
        if (p?.entity !== g.player) return;
        g.stats?.refresh(g.player);
        const n = this.unspent();
        const how = g.ui?.isTouch ? 'tap your health bars (top left)' : 'press C, or click your card';
        if (n > 0) this.toast(`${n} point${n === 1 ? '' : 's'} to spend: ${how} to open your character sheet.`, 'good');
        bus.emit('points_changed', { unspent: n, points: { ...this.points } });
      });
      bus.on('mission_completed', (p) => {
        const m = p?.mission;
        if (m && !(m.rewards || []).some((r) => r && r.xp)) this.giveXp(XP_FOR.mission);
      });
      bus.on('boss_defeated', () => this.giveXp(XP_FOR.boss));
      // Good deeds: helping the fallen up, carrying them to a bed in time.
      bus.on('revived', (p) => {
        if (p?.by && p.by === g.player && p.entity && p.entity !== g.player) this.giveXp(XP_FOR.revive);
      });
      bus.on('delivered', (p) => {
        if (p?.carrier && p.carrier === g.player && p.entity && p.entity !== g.player) this.giveXp(XP_FOR.carry);
      });
    } catch {
      /* the bus is optional in tests */
    }
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  isLyra(a) {
    return !!a && (a === this.game.companion || a.id === 'lyra');
  }

  giveXp(n) {
    const P = this.game.player;
    if (!P || !(n > 0)) return 0;
    const c = this.game.combat;
    if (typeof c?.giveXp === 'function') {
      try {
        c._number?.(P.x, P.y - 34, `+${n} xp`, '#e4b83d', { kind: 'xp' });
      } catch {
        /* numbers are optional */
      }
      return c.giveXp(P, n);
    }
    P.xp = (P.xp || 0) + n;
    return 0;
  }

  // ---------------------------------------------------------------- the pipeline's sources

  levelContribution(a) {
    const lv = Math.max(1, Math.floor(a?.level || 1));
    if (lv <= 1) return null;
    const rule = this.isPlayer(a) ? LEVEL_GROWTH.player : this.isLyra(a) ? LEVEL_GROWTH.lyra : null;
    return rule ? scaled(rule, lv - 1) : null;
  }

  // The points as they stand, each attribute on its curve (attributes.js: the first point
  // gives what it always gave, each later one a little less). Only the counts are kept and
  // saved, so an old save's points simply follow the curve when it loads.
  pointsContribution(a) {
    if (!this.isPlayer(a)) return null;
    const out = { add: {}, pct: {} };
    let any = false;
    for (const id of ATTR_IDS) {
      const n = this.points[id] || 0;
      if (!n) continue;
      const c = pointsEffect(id, n);
      for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(c?.[part] || {})) out[part][k] = (out[part][k] || 0) + v;
      any = true;
    }
    return any ? out : null;
  }

  // Death stays dangerous (DESIGN §26–27): what hunts the roads bites harder as the
  // stranger grows, so better gear and more health keep pace rather than run away.
  threatContribution(a) {
    if (!a || this.isPlayer(a) || this.isLyra(a) || a.boss || !THREAT.factions.includes(a.faction)) return null;
    const lv = this.level();
    if (lv <= 1) return null;
    return { pct: { dmgDealt: Math.min(THREAT.cap, THREAT.perLevel * (lv - 1)) } };
  }

  // ---------------------------------------------------------------- points

  level() {
    return Math.max(1, Math.floor(this.game.player?.level || 1));
  }

  earned() {
    return POINTS_PER_LEVEL * (this.level() - 1) + Math.max(0, this.bonus | 0);
  }

  spent() {
    let n = 0;
    for (const id of ATTR_IDS) n += this.points[id] || 0;
    return n;
  }

  // Points still to spend. While Free stat points is on, the real ones (what the levels
  // gave less what was really spent) — the free ones are never counted.
  unspent() {
    if (this.free) return Math.max(0, this.earned() - this.sumOf(this.realPoints));
    return Math.max(0, this.earned() - this.spent());
  }

  sumOf(pts) {
    let n = 0;
    for (const id of ATTR_IDS) n += pts?.[id] || 0;
    return n;
  }

  // What the next point in this attribute would add: the curve's own step (attributes.js
  // nextPoint: `d`, `first`), and what it really does to the numbers the sheet shows
  // (`before`, `after`, `real`), read from the pipeline with one point more, as the gear
  // compare does, so the speed knee, the clamps, gear and whatever runs now all count.
  // `limit`: the stat already sits at its clamp, so the point adds nothing to it.
  // The character sheet's "Next:" line.
  nextGain(attr) {
    if (!own.call(ATTRS, attr)) return [];
    const n = this.points[attr] || 0;
    const list = nextPoint(attr, n);
    const P = this.game.player;
    const S = this.game.stats;
    if (!P || !S || typeof S.all !== 'function' || typeof S.touch !== 'function') return list;
    let before = null;
    let after = null;
    try {
      before = S.all(P);
      this.points[attr] = n + 1;
      S.touch();
      after = S.all(P);
    } catch {
      after = null;
    } finally {
      this.points[attr] = n;
      S.touch();
    }
    if (!before || !after) return list;
    for (const m of list) {
      const s = STATS[m.stat];
      m.before = before[m.stat];
      m.after = after[m.stat];
      m.real = m.after - m.before;
      const edge = s ? (m.d < 0 ? s.min : s.max) : null;
      m.limit = edge != null && Number.isFinite(m.before) && Math.abs(m.before - edge) < 1e-9;
    }
    return list;
  }

  canSpend(attr) {
    if (!own.call(ATTRS, attr)) return false;
    if (this.free) return (this.points[attr] || 0) < FREE_MAX;
    return this.unspent() > 0;
  }

  spend(attr, n = 1) {
    if (!own.call(ATTRS, attr)) return { ok: false, reason: 'There is no such attribute.' };
    let k = Math.max(1, Math.floor(n || 1));
    if (this.free) {
      k = Math.min(k, FREE_MAX - (this.points[attr] || 0));
      if (k <= 0) return { ok: false, reason: `${ATTRS[attr].name} is as high as it goes.` };
      this.points[attr] += k;
      this.changed({ free: true, raised: k });
      return { ok: true, attr, points: this.points[attr], free: true };
    }
    if (this.unspent() < k) return { ok: false, reason: 'No points left to spend. Each level gives three.' };
    this.points[attr] += k;
    this.changed();
    return { ok: true, attr, points: this.points[attr] };
  }

  // Free stat points only: take points back off an attribute (nothing to lose).
  lower(attr, n = 1) {
    if (!own.call(ATTRS, attr)) return { ok: false, reason: 'There is no such attribute.' };
    if (!this.free) return { ok: false, reason: 'Points only come back all at once (Reset stat points, or the chapel).' };
    const k = Math.min(Math.max(1, Math.floor(n || 1)), this.points[attr] || 0);
    if (k <= 0) return { ok: false, reason: `No points in ${ATTRS[attr].name}.` };
    this.points[attr] -= k;
    this.changed({ free: true });
    return { ok: true, attr, points: this.points[attr], free: true };
  }

  // Free stat points on: the points really spent are kept aside, and from now on any
  // attribute can be raised as far as you like (FREE_MAX), free. Saved with the game.
  startFree() {
    if (this.free || !this.game.player) return false;
    this.realPoints = { ...this.points };
    this.free = true;
    this.changed({ free: true });
    this.game.bus?.emit?.('free_points', { on: true });
    return true;
  }

  // Off: the points really spent come back exactly; levels gained meanwhile have left
  // their points to spend (the badge shows them).
  endFree() {
    if (!this.free) return false;
    const real = this.realPoints || emptyPoints();
    this.points = emptyPoints();
    for (const id of ATTR_IDS) this.points[id] = Math.max(0, Math.floor(real[id] || 0));
    this.realPoints = null;
    this.free = false;
    this.clampToEarned();
    this.changed();
    this.game.bus?.emit?.('free_points', { on: false });
    return true;
  }

  // Give back the points: the chapel's quiet hour, for a price in coin.
  respec() {
    const P = this.game.player;
    if (!P) return { ok: false, reason: 'Nobody to unmake.' };
    if (this.free) return { ok: false, reason: 'Free stat points is on: turn it off in Settings → Game first.' };
    if (!this.spent()) return { ok: false, reason: 'You have not spent any points yet.' };
    const cost = respecCost(this.level());
    const coin = P.inventory?.count?.('coin') ?? 0;
    if (coin < cost) return { ok: false, reason: `It costs ${cost} coins for the chapel's candles. You have ${coin}.`, cost };
    P.inventory.remove('coin', cost);
    this.points = emptyPoints();
    this.respecs++;
    this.changed();
    this.game.bus?.emit?.('respec', { cost });
    return { ok: true, cost };
  }

  respecCost() {
    return respecCost(this.level());
  }

  // Give back every spent point, free (Settings → Game → Practice; the author: "a thing
  // that will reset states"). Level, gear, weaves, coin and the points missions gave stay;
  // health and mana settle into the new maximums (changed()).
  resetPoints() {
    const g = this.game;
    const P = g.player;
    if (!P) return { ok: false, reason: 'Start or continue a journey first.' };
    let fallen = !!P.downed;
    try {
      fallen = fallen || !!g.survival?.isFallen?.(P);
    } catch {
      /* survival is optional */
    }
    if (fallen) return { ok: false, reason: 'Not while you lie bleeding.' };
    const n = this.spent();
    if (!n) return { ok: false, reason: 'You have not spent any points yet.' };
    this.points = emptyPoints();
    this.changed();
    this.game.bus?.emit?.('respec', { cost: 0, free: true, points: n });
    return { ok: true, points: n };
  }

  changed(extra = null) {
    const g = this.game;
    g.stats?.refresh(g.player);
    g.bus?.emit?.('points_changed', { unspent: this.unspent(), points: { ...this.points }, free: this.free, ...(extra || {}) });
  }

  toast(text, kind = 'info') {
    try {
      this.game.ui?.toast?.(text, kind);
    } catch {
      /* the UI is optional */
    }
  }

  // ---------------------------------------------------------------- saving

  serialize() {
    const d = { points: { ...this.points }, bonus: this.bonus, respecs: this.respecs };
    if (this.free) {
      d.free = true;
      d.realPoints = { ...(this.realPoints || emptyPoints()) };
    }
    return d;
  }

  deserialize(d) {
    this.points = emptyPoints();
    this.free = false;
    this.realPoints = null;
    const read = (src, max) => {
      const o = emptyPoints();
      for (const id of ATTR_IDS) {
        const v = Number(src?.[id]);
        if (Number.isFinite(v) && v > 0) o[id] = Math.min(max, Math.floor(v));
      }
      return o;
    };
    if (d && typeof d === 'object') {
      this.bonus = Number.isFinite(d.bonus) ? Math.max(0, Math.floor(d.bonus)) : 0;
      this.respecs = Number.isFinite(d.respecs) ? d.respecs : 0;
      if (d.free) {
        // Free stat points was on: the free points as they were, the real ones aside.
        this.free = true;
        this.points = read(d.points, FREE_MAX);
        this.realPoints = read(d.realPoints, FREE_MAX);
      } else this.points = read(d.points, Infinity);
    }
    this.clampToEarned();
    this.game.stats?.refresh(this.game.player);
  }

  // A save can never hold more really spent points than its levels gave.
  clampToEarned() {
    const pts = this.free ? this.realPoints : this.points;
    if (!pts) return;
    let over = this.sumOf(pts) - this.earned();
    for (const id of [...ATTR_IDS].reverse()) {
      if (over <= 0) break;
      const take = Math.min(over, pts[id]);
      pts[id] -= take;
      over -= take;
    }
  }
}
