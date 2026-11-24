// Applies what a reply changes in Lyra's mind: emotion, memories, relationships,
// a goal and a private thought. Shared by the Claude path and the offline mind so
// both leave the same traces. Every call into the mind is guarded: the mind module
// may be partial, and a reply must never crash the game.

import { resolveEntity } from '../resolve.js';
import { COMPANION_ID, PLAYER_ID } from '../../core/constants.js';

export const EMOTION_NAMES = ['joy', 'sadness', 'fear', 'anger', 'trust', 'surprise', 'affection', 'curiosity', 'pride', 'embarrassment', 'calm'];
export const REL_TAGS = ['friend', 'enemy', 'rival', 'crush', 'family', 'pet', 'mentor'];

const PLAYER_WORDS = /^(?:player|me|you|the player|traveler|traveller)$/i;

// Resolve a loose person reference to a relationship id, or null when unknown.
export function resolvePerson(game, ref) {
  if (ref == null) return null;
  if (typeof ref === 'object' && ref.id) return ref.id === COMPANION_ID ? null : ref.id;
  const s = String(ref).trim();
  if (!s) return null;
  const playerName = String(game?.settings?.playerName || '').toLowerCase();
  if (PLAYER_WORDS.test(s) || (playerName && s.toLowerCase() === playerName)) return PLAYER_ID;
  let e = null;
  try {
    e = resolveEntity(game, s);
  } catch {
    e = null;
  }
  if (e && e.id) return e.id === COMPANION_ID ? null : e.id;
  const rels = game?.companion?.mind?.relationships;
  try {
    const r = rels?.get?.(s) || rels?.get?.(s.toLowerCase());
    if (r?.id) return r.id;
  } catch {
    /* ignore */
  }
  return null;
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error('[brain] mind update failed', err);
    return undefined;
  }
}

function ensureRel(game, id) {
  const rels = game?.companion?.mind?.relationships;
  if (!rels) return null;
  let rel = safe(() => rels.get?.(id));
  if (!rel && rels.ensure) {
    const ent = game.entities?.get?.(id) || (id === PLAYER_ID ? game.player : null);
    rel = safe(() => rels.ensure(ent || id, { name: ent?.name || id, kind: ent?.kind || 'human' }));
  }
  return rel || null;
}

// effects: { emotion: {name, intensity}, memories: [{text, importance, about}],
//   relationships: [{person, affinity, trust, respect, note, tag, opinion}], goal, thought }
export function applyEffects(game, effects, { source = 'local', cause = 'conversation' } = {}) {
  const mind = game?.companion?.mind;
  const out = { emotion: null, memories: 0, relationships: [], goal: null };
  if (!mind || !effects) return out;

  const em = effects.emotion;
  if (em && em.name && em.name !== 'calm' && EMOTION_NAMES.includes(em.name) && em.intensity > 0) {
    safe(() => mind.feel?.(em.name, Math.min(1, em.intensity), cause));
    out.emotion = em.name;
  }

  for (const m of effects.memories || []) {
    if (!m?.text) continue;
    const about = [];
    for (const a of m.about || []) {
      const id = resolvePerson(game, a);
      if (id && !about.includes(id)) about.push(id);
    }
    const loc = game.locations?.at?.(game.companion.x, game.companion.y)?.id || null;
    safe(() => mind.remember?.(m.text, { importance: m.importance ?? 4, about, tags: [source, ...(m.tags || [])], type: m.type || 'conversation', location: loc }));
    out.memories++;
  }

  for (const r of effects.relationships || []) {
    const id = resolvePerson(game, r?.person);
    if (!id) continue;
    const rels = mind.relationships;
    if (!rels) break;
    ensureRel(game, id);
    const deltas = {};
    for (const k of ['affinity', 'trust', 'respect', 'familiarity', 'fear']) if (Number.isFinite(r[k]) && r[k] !== 0) deltas[k] = r[k];
    if (Object.keys(deltas).length) safe(() => rels.adjust?.(id, deltas, r.reason || cause));
    if (r.note) safe(() => rels.addNote?.(id, r.note, source === 'player' ? 'player' : 'self'));
    if (r.tag) {
      const off = r.tag.startsWith('-');
      const tag = off ? r.tag.slice(1) : r.tag;
      if (REL_TAGS.includes(tag)) safe(() => rels.setTag?.(id, tag, !off));
    }
    if (r.opinion) safe(() => rels.setOpinion?.(id, r.opinion));
    out.relationships.push(id);
  }

  if (effects.goal) {
    const text = String(effects.goal).trim();
    const exists = (mind.goals || []).some((g) => !g.done && similar(g.text, text));
    if (text && !exists) {
      safe(() => mind.addGoal?.(text, 0.55, 'self'));
      out.goal = text;
    }
  }

  if (effects.thought) safe(() => mind.addThought?.(effects.thought, source === 'claude' ? 'claude' : 'self'));
  return out;
}

function words(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

// Rough "same goal" check so the mind does not collect near-duplicates.
export function similar(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return String(a).toLowerCase() === String(b).toLowerCase();
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

// Push a line to the mind's conversation log, capped. The mind may log the same line from
// the bus (player_message / speech): a duplicate of one of the last entries is skipped.
export function logConversation(game, role, text, cap = 40) {
  const mind = game?.companion?.mind;
  if (!mind || !text) return;
  if (!Array.isArray(mind.conversation)) mind.conversation = [];
  const clean = String(text).slice(0, 600);
  const t = game.clock?.t ?? 0;
  const log = mind.conversation;
  for (let i = log.length - 1; i >= 0 && i >= log.length - 3; i--) {
    const e = log[i];
    if (!e || e.role !== role || Math.abs((e.t ?? t) - t) >= 10) continue;
    const prev = String(e.text ?? '');
    // The mind keeps a shorter copy of long lines.
    if (prev === clean || (prev.length >= 300 && clean.startsWith(prev))) return;
  }
  log.push({ role, text: clean, t });
  if (log.length > cap) log.splice(0, log.length - cap);
}
