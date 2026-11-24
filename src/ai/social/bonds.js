import { SEED_BONDS, BASELINE, BASELINE_YOUNG, YOUNG, FAMILY_TAGS } from './bonds_data.js';

// The village's directed social graph: bond(a, b) is how a stands toward b (DESIGN §19.3).
// Seeded from the lore; it drifts with every conversation, favor, slight and rumor. Only
// edges that moved away from their seed are saved, so a fresh village costs nothing.
//
// Lyra's own side (bond('lyra', x)) is read from her mind's relationships when she has
// one; the Village class handles that. This class only knows numbers.

const STATS = ['affinity', 'trust', 'familiarity'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export function bondKey(a, b) {
  return `${a}|${b}`;
}

function baselineFor(a, b) {
  return YOUNG.has(a) || YOUNG.has(b) ? BASELINE_YOUNG : BASELINE;
}

function freshBond(a, b, seed) {
  if (seed) return { affinity: seed[2], trust: seed[3], familiarity: seed[4], tags: [...seed[5]], note: seed[6] || '' };
  const base = baselineFor(a, b);
  return { affinity: base.affinity, trust: base.trust, familiarity: base.familiarity, tags: [], note: '' };
}

export class Bonds {
  constructor({ onChange = null } = {}) {
    this.onChange = onChange; // (a, b, bond, changes, reason) after every real change
    this.seeds = new Map();
    for (const s of SEED_BONDS) this.seeds.set(bondKey(s[0], s[1]), s);
    this.edges = new Map();
  }

  // The live bond (created from its seed or the village baseline on first use).
  edge(a, b) {
    const k = bondKey(a, b);
    let e = this.edges.get(k);
    if (!e) {
      e = freshBond(a, b, this.seeds.get(k));
      this.edges.set(k, e);
    }
    return e;
  }

  get(a, b) {
    if (!a || !b || a === b) return null;
    const e = this.edge(a, b);
    return { affinity: e.affinity, trust: e.trust, familiarity: e.familiarity, tags: [...e.tags], note: e.note };
  }

  has(a, b, tag) {
    if (!a || !b || a === b) return false;
    return this.edge(a, b).tags.includes(tag);
  }

  isFamily(a, b) {
    if (!a || !b || a === b) return false;
    return this.edge(a, b).tags.some((t) => FAMILY_TAGS.has(t)) || this.edge(b, a).tags.some((t) => FAMILY_TAGS.has(t));
  }

  // Change the numbers; returns the changes actually applied ({} when nothing moved).
  adjust(a, b, changes = {}, reason = '') {
    if (!a || !b || a === b) return {};
    const e = this.edge(a, b);
    const applied = {};
    for (const k of STATS) {
      const d = Number(changes[k]);
      if (!Number.isFinite(d) || d === 0) continue;
      const old = e[k];
      e[k] = round1(clamp(old + d, k === 'affinity' ? -100 : 0, 100));
      const real = round1(e[k] - old);
      if (real) applied[k] = real;
    }
    if (Object.keys(applied).length && this.onChange) {
      try {
        this.onChange(a, b, this.get(a, b), applied, reason);
      } catch (err) {
        console.error('[village] bond listener failed', err);
      }
    }
    return applied;
  }

  setTag(a, b, tag, on = true) {
    if (!a || !b || a === b || !tag) return;
    const e = this.edge(a, b);
    const has = e.tags.includes(tag);
    if (on && !has) e.tags.push(tag);
    else if (!on && has) e.tags = e.tags.filter((t) => t !== tag);
    else return;
    if (this.onChange) {
      try {
        this.onChange(a, b, this.get(a, b), { tags: [...e.tags] }, on ? `became ${tag}` : `no longer ${tag}`);
      } catch (err) {
        console.error('[village] bond listener failed', err);
      }
    }
  }

  // Everyone a stands toward with a tag (from the seeds and anything that moved since).
  withTag(a, tag) {
    const out = [];
    const seen = new Set();
    for (const [k, s] of this.seeds) {
      if (s[0] !== a) continue;
      seen.add(k);
      if (this.edge(a, s[1]).tags.includes(tag)) out.push(s[1]);
    }
    for (const [k, e] of this.edges) {
      if (seen.has(k) || !k.startsWith(`${a}|`)) continue;
      if (e.tags.includes(tag)) out.push(k.slice(a.length + 1));
    }
    return out;
  }

  // Only what moved since the seed: [[a, b, affinity, trust, familiarity, tags?]].
  serialize() {
    const out = [];
    for (const [k, e] of this.edges) {
      const [a, b] = k.split('|');
      const seed = freshBond(a, b, this.seeds.get(k));
      const tagsMoved = seed.tags.length !== e.tags.length || seed.tags.some((t) => !e.tags.includes(t));
      const moved = STATS.some((s) => Math.abs(seed[s] - e[s]) >= 0.1) || tagsMoved;
      if (!moved) continue;
      const row = [a, b, e.affinity, e.trust, e.familiarity];
      if (tagsMoved) row.push([...e.tags]);
      out.push(row);
    }
    return out;
  }

  deserialize(rows) {
    this.edges.clear();
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'string' || r[0] === r[1]) continue;
      const e = this.edge(r[0], r[1]);
      if (Number.isFinite(r[2])) e.affinity = clamp(r[2], -100, 100);
      if (Number.isFinite(r[3])) e.trust = clamp(r[3], 0, 100);
      if (Number.isFinite(r[4])) e.familiarity = clamp(r[4], 0, 100);
      if (Array.isArray(r[5])) e.tags = r[5].filter((t) => typeof t === 'string').slice(0, 8);
    }
  }
}
