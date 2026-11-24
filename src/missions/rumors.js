// What Hearthvale says about the stranger's weaving (DESIGN §22.3 4, §19.3). The kinds
// join the village's rumor table (src/ai/social/village.js registers them); the watcher
// below decides when a weave becomes news. Protecting people with it warms the village;
// throwing it about near them, or weaving dark, cools it.

import { inPlace } from './tracker.js';

export const WEAVE_RUMORS = {
  weaving: { text: '{stranger} can make light out of thin air, like in the old stories', you: 'you make light out of thin air', valence: 0.1, severity: 0.45 },
  weave_rescue: { text: '{stranger} burned a {beast} off {v} with light from their bare hands', you: 'you burned a {beast} off {v} with your light', valence: 0.85, severity: 0.65 },
  weave_scare: { text: '{stranger} has been throwing wild light about and gave {v} a fright', you: 'you gave {v} a fright with your light', valence: -0.35, severity: 0.4 },
  weave_dark: { text: '{stranger} has been weaving something cold and dark, like the ruins at night', you: "you've been weaving something cold and dark", valence: -0.3, severity: 0.55 },
  weave_show: { text: '{stranger} made lights dance for {v} in the square', you: 'you made lights dance for {v}', valence: 0.35, severity: 0.25 },
  weave_errand: { text: '{stranger} turned that light of theirs to helping {v}', you: 'you helped {v} with your light', valence: 0.45, severity: 0.35 },
};

const SCARE_RADIUS = 72; // px: a weave this close to a villager, with nothing to fight, frightens them
const SCARE_COUNT = 3; // weaves within the window before it is news
const SCARE_WINDOW = 25; // seconds
const SEEN_RADIUS = 150;
const KID = new Set(['pip', 'tansy']);

export class WeaveGossip {
  constructor(game, missions) {
    this.game = game;
    this.missions = missions;
    this.reset();
  }

  reset() {
    this.told = {}; // kind -> day last raised
    this.recent = []; // [{t, near: [ids]}]
    this.lastHit = new WeakMap(); // creature -> time of the player's last weave on it
  }

  village() {
    const v = this.game.village;
    return v && typeof v.addRumor === 'function' ? v : null;
  }

  now() {
    return this.game.clock?.t ?? 0;
  }

  day() {
    return this.game.clock?.day ?? 1;
  }

  villagersNear(x, y, r) {
    const out = [];
    const all = this.game.entities?.all?.() || [];
    for (const e of all) {
      if (!e?.profile || e.removed || e.dead || e.state === 'sleep') continue;
      if (Math.hypot(e.x - x, e.y - y) <= r) out.push(e);
    }
    return out;
  }

  hostileNear(x, y, r) {
    const all = this.game.entities?.all?.() || [];
    for (const e of all) {
      if (!e?.species || e.removed || e.dead) continue;
      if (e.faction === 'village' || e.faction === 'wildlife' || e.species === 'cat' || e.species === 'chicken') continue;
      if (Math.hypot(e.x - x, e.y - y) <= r) return true;
    }
    return false;
  }

  raise(kind, opts) {
    const v = this.village();
    if (!v) return null;
    try {
      return v.addRumor(kind, opts);
    } catch (err) {
      console.warn('[missions] rumor failed', kind, err);
      return null;
    }
  }

  // A weave a mission asked for, where it asked for it, is a lesson, not a fright.
  sanctioned(p) {
    const ms = this.missions;
    if (!ms?.active) return false;
    for (const m of ms.active()) {
      const o = ms.objective(m.id);
      if (!o || !['weave', 'protect', 'defeat'].includes(o.type)) continue;
      if (!o.at || inPlace(this.game, o.at, p.x, p.y)) return true;
    }
    return false;
  }

  onEvent(type, p) {
    const g = this.game;
    if (!p) return;
    if (type === 'spell_hit' && (p.body?.owner === g.player || p.body?.owner?.id === 'player') && p.target) {
      this.lastHit.set(p.target, this.now());
      return;
    }
    if (type === 'mission_completed') {
      const giver = p.mission?.giver;
      if (giver && giver !== 'lyra' && giver !== 'board') {
        const e = g.entities?.get?.(giver);
        try {
          e?.adjustOpinion?.(6, `mission: ${p.id}`);
        } catch {
          /* opinions are optional */
        }
        this.raise('weave_errand', { victim: giver, witnesses: [giver] });
      }
      return;
    }
    if (type !== 'spell_cast') return;
    const pl = g.player;
    if (!pl || !(p.caster === pl || p.caster?.id === 'player')) return;
    const seen = this.villagersNear(pl.x, pl.y, SEEN_RADIUS);
    if (!seen.length) return;
    const ids = seen.map((e) => e.id);
    if (!this.told.weaving) {
      this.told.weaving = this.day();
      this.raise('weaving', { witnesses: ids });
    }
    const essences = [].concat(p.weave?.essences ?? p.plan?.essences ?? []).map((x) => (typeof x === 'object' ? x?.id : x));
    if (essences.includes('dark') && this.told.weave_dark !== this.day()) {
      this.told.weave_dark = this.day();
      this.raise('weave_dark', { witnesses: ids });
    }
    // Weaving for the children with no fight about is a show, not a fright.
    const close = seen.filter((e) => Math.hypot(e.x - pl.x, e.y - pl.y) <= SCARE_RADIUS);
    if (!close.length || this.hostileNear(pl.x, pl.y, 220)) return;
    if (this.sanctioned(pl)) {
      const kid = close.find((e) => KID.has(e.id));
      if (kid && this.told[`show_${kid.id}`] !== this.day()) {
        this.told[`show_${kid.id}`] = this.day();
        this.raise('weave_show', { victim: kid.id, witnesses: ids });
      }
      return;
    }
    const t = this.now();
    this.recent.push({ t, near: close.map((e) => e.id) });
    this.recent = this.recent.filter((r) => t - r.t <= SCARE_WINDOW);
    if (this.recent.length < SCARE_COUNT) return;
    const counts = {};
    for (const r of this.recent) for (const id of r.near) counts[id] = (counts[id] || 0) + 1;
    const victim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!victim || counts[victim] < SCARE_COUNT) return;
    if (this.told[`scare_${victim}`] === this.day()) return;
    this.told[`scare_${victim}`] = this.day();
    this.recent = [];
    if (KID.has(victim) && !this.told[`show_${victim}`]) {
      this.told[`show_${victim}`] = this.day();
      this.raise('weave_show', { victim, witnesses: ids });
      return;
    }
    this.raise('weave_scare', { victim, witnesses: ids });
  }

  // Did the player's weave land the last blow (within a few seconds) on this creature?
  wovenKill(creature) {
    const t = this.lastHit.get(creature);
    return Number.isFinite(t) && this.now() - t < 4;
  }

  serialize() {
    return { told: { ...this.told } };
  }

  deserialize(d) {
    this.reset();
    if (d?.told && typeof d.told === 'object') this.told = { ...d.told };
  }
}
