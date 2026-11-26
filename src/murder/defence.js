// The stranger's defence before the Moot (round 14b, S-11; DESIGN §36.5; the author: "when
// I'm being judged ... I should be able to text and like convince them ... let me fight for my
// right. I can't just say I didn't do it or did it or stay silent").
//
//   parseDefence(text, m, about) -> claims [{ id, kind, text, place?, who? }]
//     kinds: alibi (I was at the lake), not_there, never_met, self_defence, accident, blame
//     (it was Hess), character (I would never; I carried Tobias home), mercy (forgive me),
//     confess (I did it), deny (it was not me). Offline, by plain words and the village's
//     own place words (parseClaim).
//   checkClaim(m, rec, claim) -> { lie: true | false | null, knownBy: [ids], proof }
//     The game knows the truth (the record: who, where, when, provoked); a lie can be CAUGHT
//     only by someone who knows a fact against it: they saw the stranger somewhere else at
//     that hour (sightings), saw it done (the record's seen, the sight rule), are the one
//     blamed (they know they did not), or saw the two together. An unknown place is
//     unverifiable (null), never a lie. Self-defence is true or false by rec.provoked.
//
// Nothing here is a hidden truth handed to anyone: knownBy names only those whose own eyes
// (or own innocence) hold the fact, and each juror is told only their own (jury.js).

import { parseClaim } from '../ai/village_life/village_life.js';
import { VILLAGERS, SHORT_NAMES } from '../ai/social/bonds_data.js';
import { HOUR } from './data.js';

const WINDOW = 1.5 * HOUR; // how near the hour of the death a sighting must be to tell

const RE = {
  confess: /\b(i did it|i killed (him|her|them)|it was me\b|i'?m guilty|i am guilty|i confess|yes,? i did)\b/i,
  deny: /\b(it (was|wasn'?t) not me|wasn'?t me|i didn'?t (do it|kill)|i did not (do it|kill)|not guilty|i'?m innocent|i am innocent)\b/i,
  self_defence: /\b(attacked me|came at me|went for me|self[- ]?defen[cs]e|defend(ing|ed)? myself|hit me first|struck me first|tried to kill me|had no choice|no choice|swung at me|he started it|she started it|they started it)\b/i,
  accident: /\b(accident|accidental|didn'?t mean|never meant|by mistake|slipped|it just happened)\b/i,
  never_met: /\b(never met|never (even )?(spoke|talked)|didn'?t (even )?know (him|her|them)|barely knew|hardly knew|a stranger to me)\b/i,
  not_there: /\b(wasn'?t there|was not there|never (went|been) there|nowhere near|far from there|wasn'?t even there)\b/i,
  alibi: /\b(i was (at|in|by|on|down|up|out|with|asleep|sleeping|somewhere|elsewhere|home|miles)|i spent|i stayed|all (day|night|evening) (at|in))\b/i,
  character: /\b(would never|wouldn'?t (hurt|harm|kill)|not a killer|i'?m not a killer|i saved|i helped|i carried|i pulled|i protect|ask anyone|you know me|look what i('?ve)? done for)\b/i,
  mercy: /\b(mercy|forgive|i'?m sorry|i am sorry|please|i beg|have pity|spare me|one more chance)\b/i,
};

function nameIn(text) {
  const s = String(text || '').toLowerCase();
  for (const id of VILLAGERS) {
    const n = String(SHORT_NAMES[id] || id).toLowerCase();
    if (new RegExp(`\\b${n}\\b`).test(s)) return id;
  }
  if (/\b(bandits?|varek|one-eye)\b/.test(s)) return 'bandits';
  return null;
}

export function parseDefence(text, m = null, about = null) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const out = [];
  if (!s) return out;
  const add = (kind, extra = {}) => {
    if (out.some((c) => c.kind === kind)) return;
    out.push({ id: `${kind}${out.length + 1}`, kind, text: s.slice(0, 160), ...extra });
  };
  // Sentence by sentence, so "I was at the lake. It was Hess." is two claims.
  for (const part of s.split(/(?<=[.!?;])\s+|\s+but\s+|\s+and\s+(?=i\b)/i)) {
    const p = part.trim();
    if (!p) continue;
    if (RE.confess.test(p) && !/\b(not|never|didn'?t|wasn'?t)\b/i.test(p.replace(RE.confess, ''))) add('confess');
    if (RE.self_defence.test(p)) add('self_defence');
    if (RE.accident.test(p)) add('accident');
    if (RE.never_met.test(p)) add('never_met');
    if (RE.not_there.test(p)) add('not_there');
    if (RE.alibi.test(p)) {
      const c = parseClaim(p, about, m?.life || null);
      if (c?.kind === 'seen_at' && c.place) add('alibi', { place: c.place });
      else add('alibi', { place: null });
    }
    const blamed = /\b(it was|did it|ask|blame|blamed|probably|must have been|killed by)\b/i.test(p) ? nameIn(p) : null;
    if (blamed && blamed !== about && !RE.confess.test(p)) add('blame', { who: blamed });
    if (RE.character.test(p)) add('character');
    if (RE.mercy.test(p)) add('mercy');
    if (RE.deny.test(p)) add('deny');
  }
  return out;
}

// The stranger's whereabouts near the hour of the death, as each pair of eyes saw them.
function sightingsNear(m, rec) {
  const out = [];
  for (const s of rec?.snap?.player || []) if (Number.isFinite(s.t) && Math.abs(s.t - rec.t) <= WINDOW) out.push({ by: s.by, place: s.place, t: s.t, with: s.with });
  try {
    for (const s of m?.life?.sight?.sightingsOf?.('player', { since: rec.t - WINDOW }) || []) {
      if (s.t > rec.t + WINDOW) continue;
      if (!out.some((x) => x.by === s.by && Math.abs(x.t - s.t) < 1)) out.push({ by: s.by, place: s.place, t: s.t, with: s.with });
    }
  } catch {
    /* no sightings */
  }
  for (const w of rec?.seen || []) if (!out.some((x) => x.by === w.id && x.place === rec.place)) out.push({ by: w.id, place: rec.place, t: rec.t, saw: true, clarity: w.clarity });
  return out.filter((x) => x.by && x.by !== 'player');
}

function eyewitnesses(rec, { clear = false } = {}) {
  return (rec?.seen || []).filter((w) => w.id !== 'player' && (!clear || w.clarity === 'clear')).map((w) => w.id);
}

export function checkClaim(m, rec, claim) {
  const none = { lie: null, knownBy: [], proof: '' };
  if (!rec || !claim) return none;
  const did = rec.by === 'player';
  const name = (id) => m?.name?.(id) || SHORT_NAMES[id] || id;
  const V = name(rec.id);
  switch (claim.kind) {
    case 'alibi': {
      if (!claim.place) return none; // an unknown place: nothing to check it against
      const near = sightingsNear(m, rec).filter((x) => x.place && x.place !== claim.place);
      const lie = did ? claim.place !== rec.place : near.length > 0 ? true : null;
      const knownBy = [...new Set(near.map((x) => x.by))];
      const proof = near[0] ? `${name(near[0].by)} saw you ${near[0].saw ? 'there, when it happened' : `at ${m?.placeName?.(near[0].place) || near[0].place} at that hour`}` : '';
      return { lie, knownBy, proof };
    }
    case 'not_there': {
      const at = sightingsNear(m, rec).filter((x) => x.place === rec.place);
      const knownBy = [...new Set(at.map((x) => x.by))];
      return { lie: did ? true : knownBy.length ? true : null, knownBy, proof: knownBy.length ? `${name(knownBy[0])} saw you there` : '' };
    }
    case 'never_met': {
      const together = [];
      for (const s of rec?.snap?.victim || []) if (s.with === 'player') together.push(s.by);
      for (const s of rec?.snap?.player || []) if (s.with === rec.id) together.push(s.by);
      const fam = Number(m?.entity?.(rec.id)?.familiarity) || 0;
      const knownBy = [...new Set(together.filter((x) => x && x !== 'player' && x !== rec.id))];
      const lie = fam > 5 || knownBy.length > 0;
      return { lie: lie || (knownBy.length ? true : null), knownBy, proof: knownBy.length ? `${name(knownBy[0])} saw you with ${V}` : '' };
    }
    case 'self_defence': {
      if (rec.provoked == null) return { lie: null, knownBy: [], proof: '' };
      const knownBy = eyewitnesses(rec, { clear: true });
      return { lie: !rec.provoked, knownBy, proof: knownBy.length ? `${name(knownBy[0])} saw who struck first` : '', supports: !!rec.provoked };
    }
    case 'accident': {
      // The finishing blow is held and meant: never an accident.
      const knownBy = eyewitnesses(rec, { clear: true });
      return { lie: did ? true : null, knownBy, proof: knownBy.length ? `${name(knownBy[0])} saw the blow held and struck` : '' };
    }
    case 'blame': {
      const who = claim.who;
      if (!who) return none;
      const knownBy = [...eyewitnesses(rec)];
      // The one blamed knows they did not (and the stranger's name is not theirs to clear).
      if (VILLAGERS.includes(who) && who !== rec.id && did) knownBy.push(who);
      return { lie: did ? true : null, knownBy: [...new Set(knownBy)], proof: knownBy.length ? (knownBy.includes(who) ? `${name(who)} knows it was not them` : `${name(knownBy[0])} saw who did it`) : '' };
    }
    case 'confess':
      return { lie: did ? false : true, knownBy: [], proof: '' };
    default:
      return none; // deny, character, mercy: weighed, not checked
  }
}

// Every claim checked against the record. -> [{ ...claim, lie, knownBy, proof, saw }]
// opts.room: everyone at the Moot; opts.spokenBy: those whose word the watch said aloud to the
// room. A fact the watch told the whole room is known to everyone in it ("being told"): a lie
// it gives away, and (verify-b) a true defence an eyewitness bears out, alike. `saw` keeps who
// knew it with their own eyes, so nobody else is told they saw it.
export function checkDefence(m, rec, claims, { room = [], spokenBy = [] } = {}) {
  return (claims || []).map((c) => {
    const r = { ...c, ...checkClaim(m, rec, c) };
    r.saw = [...(r.knownBy || [])];
    if ((r.lie || r.supports) && room.length && (r.knownBy || []).some((id) => spokenBy.includes(id))) {
      r.knownBy = [...new Set([...(r.knownBy || []), ...room])];
      r.public = true;
    }
    return r;
  });
}

// The quick chips (no words typed): the old three pleas as defences.
export const QUICK = {
  confess: 'I did it.',
  deny: 'It was not me.',
  silent: '',
};
