// The watch investigates from what people actually know (DESIGN §29): who saw the killing,
// who last saw the dead alive and with whom, who saw the stranger near the place and the
// time, who saw them carrying something heavy, what the stranger said when asked, and the
// harm they did before. Suspicion is a belief, not a certainty: each piece of evidence
// weighs on it (noisy-OR), and the stranger's answers to the watch can make it heavier
// (a lie a sighting contradicts, a dodge) or lighter (a lie nobody can catch, an honest word).

import { levelOf, HOUR } from './data.js';
import { whenPhrase } from '../ai/village_life/problems.js';
import { placeAt } from '../ai/village_life/errands_data.js';
import { ANSWERS } from './lines.js';

export const WEIGHTS = Object.freeze({
  witness_clear: 0.95, // saw the stranger strike the blow
  witness_glimpse: 0.55, // saw a figure strike it, in the dark or from afar
  caught_body: 0.9, // saw the stranger carrying the body itself
  carry_glimpse: 0.32, // saw them carrying something heavy, toward where it was found
  over_body: 0.5, // found them standing over the body
  with_victim: 0.4, // the dead was last seen alive with the stranger
  near_place: 0.2, // the stranger was seen near the place, near the time
  lie_caught: 0.35, // what they told someone is contradicted by a sighting
  deflect: 0.08, // would not answer the watch
  truth_there: 0.12, // said, honestly, that they were there
  avoided: 0.15, // kept away from the watch's questions
  violence: 0.28, // struck or beat the dead before
  threat: 0.18, // threatened the dead
  confession: 1, // said it
  lyra_told: 0.85, // Lyra told the watch what the stranger told her
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function suspicionOf(evidence, { outside = false } = {}) {
  let keep = 1;
  for (const e of evidence || []) keep *= 1 - clamp(Number(e.w) || 0, 0, 1);
  let s = 1 - keep;
  // Found out past the ward with nothing pointing at anyone: it could have been the bandits.
  if (outside && !(evidence || []).some((e) => e.w >= 0.5)) s *= 0.8;
  return Math.round(clamp(s, 0, 1) * 1000) / 1000;
}

function nameOf(m, id) {
  return id === 'player' ? m.playerName() : m.name(id);
}

function where(m, place) {
  return placeAt(place, m.placeName(place));
}

// Everything the watch can learn about one death, from people's real knowledge.
export function gatherEvidence(m, rec) {
  const out = [];
  const t = m.now();
  const add = (kind, by, extra = {}) => {
    const w = extra.w ?? WEIGHTS[kind] ?? 0.1;
    const key = extra.uid || `${kind}:${by || ''}:${extra.place || ''}`;
    if (out.some((e) => e.key === key)) return;
    out.push({ key, kind, by: by || null, w, t: extra.t ?? null, place: extra.place || null, text: extra.text || '' });
  };
  const V = m.name(rec.id);
  const P = m.playerName();
  // Who saw the killing itself.
  for (const s of rec.seen || []) {
    if (s.id === 'lyra') continue; // Lyra speaks for herself (lyra.js)
    const clear = s.clarity === 'clear';
    add(clear ? 'witness_clear' : 'witness_glimpse', s.id, { place: rec.place, t: rec.t, text: clear ? `${m.name(s.id)} saw ${P} strike ${V} down ${where(m, rec.place)}.` : `${m.name(s.id)} saw someone strike ${V} down ${where(m, rec.place)}, ${clear ? '' : 'and could not see clearly'}.`.replace(', .', '.') });
  }
  // Clues people noticed afterwards: the stranger carrying something, standing over the body.
  for (const c of rec.clues || []) {
    if (c.kind === 'carry') add(c.clarity === 'clear' ? 'caught_body' : 'carry_glimpse', c.by, { place: c.place, t: c.t, text: c.clarity === 'clear' ? `${m.name(c.by)} saw ${P} carrying ${V}'s body.` : `${m.name(c.by)} saw ${P} carrying something heavy ${where(m, c.place)}, ${whenPhrase(c.t, t)}.` });
    else if (c.kind === 'over_body') add('over_body', c.by, { place: c.place, t: c.t, text: `${m.name(c.by)} found ${P} standing over ${V}'s body.` });
  }
  // The dead's last day: who saw them last, and with whom.
  const window = 2 * HOUR;
  for (const s of rec.snap?.victim || []) {
    if (s.with === 'player' && rec.t - s.t <= window && s.by !== 'player' && s.by !== 'lyra') add('with_victim', s.by, { place: s.place, t: s.t, text: `${m.name(s.by)} saw ${V} with ${P} ${where(m, s.place)}, ${whenPhrase(s.t, t)}.` });
  }
  for (const s of rec.snap?.player || []) {
    if (s.by === 'lyra' || s.by === rec.id) continue;
    if (s.with === rec.id && rec.t - s.t <= window) add('with_victim', s.by, { place: s.place, t: s.t, text: `${m.name(s.by)} saw ${P} with ${V} ${where(m, s.place)}, ${whenPhrase(s.t, t)}.` });
  }
  // The stranger near the place, near the time (before, and in the hour after).
  const places = new Set([rec.place, rec.foundPlace].filter(Boolean));
  let near = 0;
  const nearList = [...(rec.snap?.player || []), ...(rec.after || [])].sort((a, b) => Math.abs(a.t - rec.t) - Math.abs(b.t - rec.t));
  for (const s of nearList) {
    if (near >= 2 || s.by === 'lyra' || s.by === rec.id) continue;
    if (!places.has(s.place) && !places.has(s.heading)) continue;
    if (Math.abs(s.t - rec.t) > 1.5 * HOUR) continue;
    const before = out.length;
    add('near_place', s.by, { place: s.place || s.heading, t: s.t, text: `${m.name(s.by)} saw ${P} ${s.place ? where(m, s.place) : `heading for ${m.placeName(s.heading)}`}, ${whenPhrase(s.t, t)}.` });
    if (out.length > before) near++;
  }
  // What the stranger said when asked, against what people saw.
  const placedThere = out.some((e) => e.kind === 'with_victim' || e.kind === 'near_place' || e.kind === 'witness_clear');
  for (const cl of m.claimsAbout(rec.id)) {
    if (cl.found) add('lie_caught', cl.found.by || cl.to, { t: cl.t, text: `${P} told ${m.name(cl.to)} they had not seen ${V}; ${m.name(cl.found.by || cl.to)} knows otherwise.` });
    else if (cl.kind === 'not_seen' && placedThere && cl.t >= rec.t - window) add('lie_caught', cl.to, { t: cl.t, text: `${P} told ${m.name(cl.to)} they had not seen ${V} that day. Others saw them together.` });
  }
  // Harm done before.
  for (const h of m.priorHarm(rec.id)) add(h.kind, h.by, { t: h.t, text: h.text });
  // What happened when the watch asked.
  (rec.answers || []).forEach((a, i) => {
    if (a.kind) add(a.kind, a.by || 'watch', { w: a.w, t: a.t, text: a.text, uid: `answer:${i}` });
  });
  return out;
}

// --------------------------------------------------------------------------- questioning

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The watch's questions for the stranger, from what it knows. -> [{ id, key, vars, options }]
export function buildQuestions(m, rec, evidence) {
  const P = m.playerName();
  const V = m.name(rec.id);
  const t = m.now();
  const qs = [];
  const truthWhen = whenPhrase(rec.t, t);
  qs.push({
    id: 'last',
    key: 'lastSeen',
    vars: {},
    options: [
      { id: 'truth', label: ANSWERS.truth(where(m, rec.place), truthWhen), kind: 'truth' },
      { id: 'lie', label: ANSWERS.lieNever(m.pronoun(rec.id, 'him')), kind: 'lie' },
      { id: 'deflect', label: ANSWERS.deflect(), kind: 'deflect' },
      { id: 'confess', label: ANSWERS.confess(m.pronoun(rec.id, 'him')), kind: 'confess' },
    ],
  });
  const best = (kinds) => evidence.filter((e) => kinds.includes(e.kind)).sort((a, b) => b.w - a.w)[0] || null;
  const withE = best(['with_victim']);
  const carryE = best(['carry_glimpse']);
  const nearE = best(['near_place', 'over_body', 'witness_glimpse']);
  const e = withE || carryE || nearE;
  if (e) {
    const vars = { from: m.name(e.by), place: m.placeName(e.place), at: where(m, e.place), when: e.t != null ? whenPhrase(e.t, t) : 'that day' };
    if (e === withE) {
      qs.push({ id: 'with', key: 'with', vars, evidence: e.key, options: [
        { id: 'excuse', label: `${cap(m.pronoun(rec.id, 'he'))} went home.`, kind: 'lie_soft' },
        { id: 'dunno', label: "I don't know.", kind: 'deflect' },
        { id: 'lie', label: `I never met ${V} that day.`, kind: 'lie' },
        { id: 'confess', label: ANSWERS.confess(m.pronoun(rec.id, 'him')), kind: 'confess' },
      ] });
    } else if (e === carryE) {
      qs.push({ id: 'carry', key: 'carry', vars, evidence: e.key, options: [
        { id: 'excuse', label: ANSWERS.firewood(), kind: 'lie_soft' },
        { id: 'dunno', label: ANSWERS.dunno(), kind: 'deflect' },
        { id: 'lie', label: "I wasn't carrying anything.", kind: 'lie' },
        { id: 'confess', label: ANSWERS.confess(m.pronoun(rec.id, 'him')), kind: 'confess' },
      ] });
    } else {
      qs.push({ id: 'near', key: 'near', vars, evidence: e.key, options: [
        { id: 'excuse', label: ANSWERS.excuse(String(e.place || '')), kind: 'excuse' },
        { id: 'deflect', label: "Walking. It's not a crime.", kind: 'deflect' },
        { id: 'lie', label: 'I was never there.', kind: 'lie' },
        { id: 'confess', label: ANSWERS.confess(m.pronoun(rec.id, 'him')), kind: 'confess' },
      ] });
    }
  }
  void P;
  return qs;
}

// The stranger answers one question. Returns { reply: key for the watch's line, add: evidence | null, caught: by | null }.
export function judgeAnswer(m, rec, evidence, q, opt) {
  const kind = opt?.kind || 'deflect';
  const t = m.now();
  if (kind === 'confess') return { reply: 'confess', add: { kind: 'confession', w: WEIGHTS.confession, t, text: `${m.playerName()} confessed to the watch.` } };
  if (kind === 'deflect') return { reply: 'deflect', add: { kind: 'deflect', w: WEIGHTS.deflect, t, text: `${m.playerName()} would not answer the watch about ${m.name(rec.id)}.` } };
  if (kind === 'truth') return { reply: 'honest', add: { kind: 'truth_there', w: WEIGHTS.truth_there, t, text: `${m.playerName()} said they were with ${m.name(rec.id)} that day.` } };
  if (kind === 'excuse') {
    // An honest-sounding reason for being there: it neither helps nor hurts much.
    return { reply: 'honest', add: null };
  }
  // A lie: caught if a sighting contradicts it.
  const against = (ids) => evidence.find((e) => ids.includes(e.kind)) || null;
  let contra = null;
  if (q.id === 'last' && kind === 'lie') contra = against(['with_victim', 'near_place', 'witness_clear', 'over_body', 'caught_body']);
  else if (kind === 'lie') contra = evidence.find((e) => e.key === q.evidence) || null;
  if (contra) return { reply: 'caught', caught: contra.by, add: { kind: 'lie_caught', w: WEIGHTS.lie_caught, by: contra.by, t, text: `${m.playerName()} lied to the watch; ${m.name(contra.by)} saw otherwise.` } };
  // A lie nobody can catch, or a soft one ("he went home"): it holds, a little thin.
  return { reply: 'honest', add: kind === 'lie_soft' ? { kind: 'lie_soft', w: 0.05, t, text: '' } : null };
}

export { levelOf };
