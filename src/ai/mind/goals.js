import { tokenSet, clamp01, normName } from './text.js';
import { jaccard } from './memory.js';

// Goals live in a plain array on the mind (mind.goals):
//   { id, text, priority 0..1, source: 'soul'|'player'|'self'|'quest', done, t, doneT? }
// These helpers keep it tidy: no duplicates, a bounded size, fuzzy lookup by text.

const SOURCES = new Set(['soul', 'player', 'self', 'quest']);
const MAX_ACTIVE = 12;
const MAX_DONE = 20;

let counter = 0;

function goalId(text) {
  const slug = normName(text).split(' ').slice(0, 4).join('_') || 'goal';
  counter = (counter + 1) % 100000;
  return `g_${slug}_${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
}

export function findGoal(goals, idOrText, { includeDone = false } = {}) {
  if (!idOrText) return null;
  const key = String(idOrText);
  const pool = includeDone ? goals : goals.filter((g) => !g.done);
  const direct = pool.find((g) => g.id === key);
  if (direct) return direct;
  const n = normName(key);
  const exact = pool.find((g) => normName(g.text) === n);
  if (exact) return exact;
  const q = tokenSet(key);
  let best = null;
  let bs = 0;
  for (const g of pool) {
    const s = jaccard(q, tokenSet(g.text));
    // Containment also counts: "the moonpetals" finds "Find moonpetals blooming in the Whisperwood".
    let inter = 0;
    for (const w of q) if (tokenSet(g.text).has(w)) inter++;
    const contain = q.size ? inter / q.size : 0;
    const score = Math.max(s, contain * 0.8);
    if (score > bs) {
      bs = score;
      best = g;
    }
  }
  return bs >= 0.45 ? best : null;
}

export function addGoal(goals, text, priority = 0.5, source = 'self', t = 0, id = null) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').slice(0, 160);
  if (!clean) return null;
  const p = clamp01(Number.isFinite(Number(priority)) ? Number(priority) : 0.5);
  const src = SOURCES.has(source) ? source : 'self';
  const existing = (id && goals.find((g) => g.id === id)) || findSimilar(goals, clean);
  if (existing) {
    existing.priority = Math.max(existing.priority, p);
    if (existing.done && id) {
      existing.done = false;
      delete existing.doneT;
    }
    return existing;
  }
  const g = { id: id || goalId(clean), text: clean[0].toUpperCase() + clean.slice(1), priority: p, source: src, done: false, t };
  goals.push(g);
  pruneGoals(goals);
  return g;
}

function findSimilar(goals, text) {
  const q = tokenSet(text);
  for (const g of goals) {
    if (g.done) continue;
    if (normName(g.text) === normName(text) || jaccard(q, tokenSet(g.text)) >= 0.7) return g;
  }
  return null;
}

export function completeGoal(goals, idOrText, t = 0) {
  const g = findGoal(goals, idOrText);
  if (!g) return null;
  g.done = true;
  g.doneT = t;
  pruneGoals(goals);
  return g;
}

export function activeGoals(goals) {
  return goals.filter((g) => !g.done).sort((a, b) => b.priority - a.priority);
}

export function topGoal(goals) {
  return activeGoals(goals)[0] || null;
}

// Bound the list: the least important player/self goals go first; soul and quest goals stay.
export function pruneGoals(goals) {
  const active = goals.filter((g) => !g.done);
  if (active.length > MAX_ACTIVE) {
    const drop = active
      .filter((g) => g.source !== 'soul' && g.source !== 'quest')
      .sort((a, b) => a.priority - b.priority)
      .slice(0, active.length - MAX_ACTIVE);
    for (const g of drop) goals.splice(goals.indexOf(g), 1);
  }
  const done = goals.filter((g) => g.done).sort((a, b) => (a.doneT || 0) - (b.doneT || 0));
  if (done.length > MAX_DONE) for (const g of done.slice(0, done.length - MAX_DONE)) goals.splice(goals.indexOf(g), 1);
  return goals;
}

export function sanitizeGoals(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const g of list) {
    if (!g || !g.text) continue;
    out.push({
      id: String(g.id || goalId(g.text)),
      text: String(g.text).slice(0, 160),
      priority: clamp01(Number(g.priority) || 0.5),
      source: SOURCES.has(g.source) ? g.source : 'self',
      done: !!g.done,
      t: Number(g.t) || 0,
      ...(g.doneT != null ? { doneT: Number(g.doneT) || 0 } : {}),
    });
  }
  return pruneGoals(out);
}
