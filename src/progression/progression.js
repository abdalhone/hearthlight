import { ATTRS, ATTR_IDS, POINTS_PER_LEVEL, LEVEL_GROWTH, XP_FOR, respecCost, scaled } from './attributes.js';

// Levels and stat points (DESIGN §26): game.progression.
//
//   earned() -> points the levels have given      unspent() -> points still to spend
//   spend(attr, n = 1) -> { ok, reason? }          canSpend(attr)
//   respec(by = 'aveline') -> { ok, reason?, cost }   (the chapel, for coin)
//   points (the spent ones, by attribute)           xpFor(kind) (fights are combat's)
//   serialize() / deserialize(d)
//
// The pipeline's 'level' and 'points' sources live here, so a level or a point is
// felt everywhere the moment it lands. Bus: points_changed {unspent, points},
// respec {cost}.

const own = Object.prototype.hasOwnProperty;

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
    const S = game.stats;
    if (S) {
      S.addSource('level', 'Level', (a) => this.levelContribution(a), 10);
      S.addSource('points', 'Points', (a) => this.pointsContribution(a), 20);
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
        if (n > 0) this.toast(`Level ${p.level}! You have ${n} point${n === 1 ? '' : 's'} to spend. Open your character sheet (C).`, 'good');
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

  pointsContribution(a) {
    if (!this.isPlayer(a)) return null;
    const out = { add: {}, pct: {} };
    let any = false;
    for (const id of ATTR_IDS) {
      const n = this.points[id] || 0;
      if (!n) continue;
      const c = scaled(ATTRS[id].per, n);
      for (const part of ['add', 'pct']) for (const [k, v] of Object.entries(c?.[part] || {})) out[part][k] = (out[part][k] || 0) + v;
      any = true;
    }
    return any ? out : null;
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

  unspent() {
    return Math.max(0, this.earned() - this.spent());
  }

  canSpend(attr) {
    return own.call(ATTRS, attr) && this.unspent() > 0;
  }

  spend(attr, n = 1) {
    if (!own.call(ATTRS, attr)) return { ok: false, reason: 'There is no such attribute.' };
    const k = Math.max(1, Math.floor(n || 1));
    if (this.unspent() < k) return { ok: false, reason: 'No points left to spend. Each level gives three.' };
    this.points[attr] += k;
    this.changed();
    return { ok: true, attr, points: this.points[attr] };
  }

  // Give back the points: the chapel's quiet hour, for a price in coin.
  respec() {
    const P = this.game.player;
    if (!P) return { ok: false, reason: 'Nobody to unmake.' };
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

  changed() {
    const g = this.game;
    g.stats?.refresh(g.player);
    g.bus?.emit?.('points_changed', { unspent: this.unspent(), points: { ...this.points } });
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
    return { points: { ...this.points }, bonus: this.bonus, respecs: this.respecs };
  }

  deserialize(d) {
    this.points = emptyPoints();
    if (d && typeof d === 'object') {
      for (const id of ATTR_IDS) {
        const v = Number(d.points?.[id]);
        if (Number.isFinite(v) && v > 0) this.points[id] = Math.floor(v);
      }
      this.bonus = Number.isFinite(d.bonus) ? Math.max(0, Math.floor(d.bonus)) : 0;
      this.respecs = Number.isFinite(d.respecs) ? d.respecs : 0;
    }
    // A save can never hold more spent points than its levels gave.
    let over = this.spent() - this.earned();
    for (const id of [...ATTR_IDS].reverse()) {
      if (over <= 0) break;
      const take = Math.min(over, this.points[id]);
      this.points[id] -= take;
      over -= take;
    }
    this.game.stats?.refresh(this.game.player);
  }
}
