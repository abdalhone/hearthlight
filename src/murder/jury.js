// The Moot weighs it (round 14b, S-11, decision D12; DESIGN §36.5; the author: "literally,
// all of them use the API and try to think, should they forgive me? Do I have a reason?
// ... 'Would this guy do it?' Of everything I know about him").
//
// The jurors are the chair and the living heads of the Moot (at most 7). Each one weighs the
// stranger's defence on their OWN brief and nobody else's: what they saw (the sight rule:
// the record's seen, their own sightings), what the watch said aloud before the whole room
// (the case's evidence as spoken at the Moot), what they heard by meeting (rumours they have
// heard), what they think of the stranger (opinion, familiarity, their grievance), whether
// they loved the dead, whether they are afraid, and the claims they themselves could check.
// One quick-tier Claude call per juror, all at once, inside ONE 25 s budget for the whole
// trial; a juror who has not answered by then (or with no Claude at all) weighs it by the
// local rules, deterministic per juror. A lie a juror says they caught counts only if
// checkClaim says that juror knows it (knownBy): nobody catches a lie with a fact they do
// not have. Votes: guilty | not_proven | mercy.
//
//   jurorsOf(m, about)                          [ids] (chair first)
//   jurorBrief(m, id, about, checked, defence)  { id, text, knows } for one juror only
//   localJuror(m, id, about, checked, defence)  { vote, belief, reason, caught, source: 'local' }
//   deliberate(m, about, { defence, checked, provider, budgetMs, onVote, have })
//                                               -> Promise<[votes]> (have: votes already in)
//   tally(votes, chair)                         { guilty, mercy, notProven, outcome }

import { MOOT_CHAIR, MOOT_HEADS } from './data.js';
import { SHORT_NAMES } from '../ai/social/bonds_data.js';
import { profileById } from '../entities/npc_data.js';

export const MAX_JURORS = 7;
export const BUDGET_MS = 25000;

export const JUROR_RULES = [
  'You are one member of the Hearthmoot, the council of Hearthvale, a small warded village in Halcyre (a pixel-art RPG). The stranger (the player) stands before the Moot over a death.',
  'Weigh only what YOUR brief says you know: what you saw yourself, what the watch said aloud to the whole room, what you have heard by word of mouth, and what you think of the stranger. Never invent evidence. If you know little, say so in your reason.',
  'Read their defence and ask yourself, from everything you know of them: would this person do this? Did they have a reason? Is what they say true, as far as you can tell?',
  'Vote "guilty", "not_proven", or "mercy" (you believe they did it but would spare them the full sentence: provoked, sorry, or you are fond of them). Give your belief that they did it, 0 to 1, and one or two sentences of reason in your own voice, as you would say it aloud to the room.',
  'Only list a claim as caught if your brief marks it as one YOU know to be false.',
  'Reply with JSON only, in the format the task gives.',
].join('\n');

export const JUROR_SCHEMA = {
  type: 'object',
  properties: {
    vote: { type: 'string', enum: ['guilty', 'not_proven', 'mercy'] },
    belief: { type: 'number', description: 'how sure you are they did it, 0..1' },
    reason: { type: 'string', description: 'one or two spoken sentences, in your voice' },
    caught: { type: 'array', items: { type: 'string' }, description: 'ids of claims you know to be false' },
  },
  required: ['vote', 'belief', 'reason', 'caught'],
  additionalProperties: false,
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function alive(m, id) {
  if (m.dead?.[id]) return false;
  const e = m.entity?.(id);
  return !!e && !e.removed && !e.absent;
}

const name = (m, id) => safe(() => m.name(id), null) || SHORT_NAMES[id] || id;

export function jurorsOf(m, about) {
  const out = [];
  for (const id of MOOT_CHAIR) if (id !== about && alive(m, id)) {
    out.push(id);
    break;
  }
  for (const id of MOOT_HEADS) {
    if (out.length >= MAX_JURORS) break;
    if (id !== about && !out.includes(id) && alive(m, id)) out.push(id);
  }
  return out;
}

function kin(a, b) {
  const pa = profileById(a)?.family;
  const pb = profileById(b)?.family;
  const has = (f, id) => !!f && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => f[k]?.includes(id));
  return has(pa, b) || has(pb, a);
}

// What one juror knows, and nothing more.
export function knowledgeOf(m, id, about) {
  const rec = m.dead?.[about];
  const c = m.cases?.[about];
  const e = m.entity?.(id);
  const k = { saw: null, spoken: [], heard: [], care: 0, kin: false, opinion: Number(e?.opinionOfPlayer) || 30, familiarity: Number(e?.familiarity) || 0, fear: null, uneasy: null, grievance: null, otherDeaths: 0 };
  const w = (rec?.seen || []).find((s) => s.id === id);
  if (w) k.saw = w.clarity || 'glimpse';
  // The watch's account, said aloud to the whole Moot (trialScripts reads the strongest four).
  k.spoken = (c?.evidence || [])
    .filter((x) => x.text)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4)
    .map((x) => x.text);
  // Word of mouth: rumours about the stranger this juror has heard.
  const village = m.village;
  for (const r of safe(() => village.rumors.list, []) || []) {
    if (!Array.isArray(r.heardBy) || !r.heardBy.includes(id) || r.about !== 'player') continue;
    const text = safe(() => village.rumors.render(r, 'narrator', { stranger: 'the stranger' }), null);
    if (text) k.heard.push(text);
  }
  k.heard = k.heard.slice(-8);
  k.care = safe(() => m.life?.care?.(id, about), 0) || 0;
  k.kin = kin(id, about);
  k.fear = safe(() => m.fearOf?.(e), null);
  if (e?.uneasy && (e.uneasy.day == null || e.uneasy.day === m.day?.())) k.uneasy = e.uneasy.place || 'nearby';
  k.grievance = safe(() => village?.grievances?.[id], null);
  // Other deaths they know the stranger did (each count of the case, per knower).
  k.otherDeaths = Object.values(m.dead || {}).filter((r) => r.id !== about && !r.natural && r.by === 'player' && safe(() => m.game?.reputation?.knows?.(r, id), false)).length;
  return k;
}

const OPINION = (o) => (o < 15 ? 'you hate them' : o < 30 ? 'you distrust them' : o < 50 ? 'you hardly know what to make of them' : o < 75 ? 'you like them' : 'you are fond of them');

export function jurorBrief(m, id, about, checked, defence) {
  const k = knowledgeOf(m, id, about);
  const p = profileById(id);
  const age = safe(() => m.game?.calendar?.ageOf?.(id), null) ?? p?.age;
  const V = name(m, about);
  const lines = [];
  lines.push(`You are ${p?.name || name(m, id)}${age ? `, ${age}` : ''}, ${p?.role || 'of Hearthvale'}. Voice: ${String(p?.voice || '').slice(0, 160)}`);
  lines.push(`The stranger stands before the Moot over the death of ${V}.`);
  lines.push(`Of the stranger: ${OPINION(k.opinion)} (opinion ${Math.round(k.opinion)}/100; you have spoken with them ${k.familiarity > 30 ? 'often' : k.familiarity > 8 ? 'a few times' : 'hardly at all'}).`);
  if (k.kin) lines.push(`${V} was your family.`);
  else if (k.care >= 0.6) lines.push(`You loved ${V}.`);
  else if (k.care >= 0.3) lines.push(`${V} was your friend.`);
  if (k.saw) lines.push(k.saw === 'clear' ? `You SAW the stranger kill ${V}, clearly, with your own eyes.` : `You glimpsed it happen, not clearly.`);
  else lines.push('You did not see it happen.');
  if (k.fear) lines.push('You are afraid of the stranger.');
  if (k.uneasy) lines.push(`Earlier today you heard a scream${typeof k.uneasy === 'string' ? ` from ${safe(() => m.placeName(k.uneasy), k.uneasy)}` : ''}; you never saw what it was.`);
  if (k.spoken.length) lines.push(`What the watch told the Moot: ${k.spoken.join(' ')}`);
  else lines.push('The watch told the Moot it knows very little.');
  if (k.heard.length) lines.push(`What you have heard of the stranger: ${k.heard.join('; ')}.`);
  if (k.otherDeaths) lines.push(`You know of ${k.otherDeaths} other ${k.otherDeaths === 1 ? 'death' : 'deaths'} by their hand.`);
  lines.push(`Their defence, in their words: "${String(defence || '').slice(0, 500) || '(they said nothing)'}"`);
  const mine = (checked || []).filter((c) => c.lie && (c.knownBy || []).includes(id));
  const knows = mine.map((c) => c.id);
  if (mine.length) lines.push(`Claims YOU know are false: ${mine.map((c) => `${c.id} (${c.kind}${c.proof ? `: ${c.proof.replace(/^\w+ saw you/, 'you saw them')}` : ''})`).join('; ')}.`);
  const supports = (checked || []).filter((c) => c.supports && (c.knownBy || []).includes(id));
  if (supports.length) lines.push(`What you saw bears out: ${supports.map((c) => c.kind.replace('_', ' ')).join(', ')}.`);
  lines.push('Answer as JSON: {"vote": "guilty"|"not_proven"|"mercy", "belief": 0..1, "reason": string, "caught": [claim ids]}.');
  let text = lines.join('\n');
  if (text.length > 2400) text = `${text.slice(0, 2399)}…`;
  return { id, text, knows };
}

// Deterministic per juror (a hash of the case and the juror), never Math.random.
function roll(m, about, id) {
  let h = 2166136261;
  const s = `${m.game?.seed ?? 1}|${about}|${id}|${m.dead?.[about]?.t ?? 0}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function localJuror(m, id, about, checked, defence) {
  const k = knowledgeOf(m, id, about);
  const c = m.cases?.[about];
  const claims = checked || [];
  const has = (kind) => claims.some((x) => x.kind === kind);
  const caught = claims.filter((x) => x.lie && (x.knownBy || []).includes(id)).map((x) => x.id);
  const provoked = claims.find((x) => x.kind === 'self_defence' && x.supports && (x.knownBy || []).includes(id));
  let belief = Math.max(0, Math.min(1, c?.suspicion ?? 0.3));
  if (k.saw === 'clear') belief = Math.max(belief, 0.92);
  else if (k.saw) belief = Math.max(belief, 0.7);
  if (has('confess')) belief = 1;
  belief += 0.18 * caught.length;
  belief += 0.08 * k.otherDeaths;
  // Would this one do it? What they know of the stranger leans it.
  belief += (30 - k.opinion) / 250;
  if (k.kin || k.care >= 0.6) belief += 0.06;
  belief += (roll(m, about, id) - 0.5) * 0.12;
  belief = Math.max(0, Math.min(1, belief));
  const fond = k.opinion >= 60;
  const sorry = has('mercy') || has('confess');
  let vote;
  if (belief >= 0.7) vote = (provoked || (fond && sorry)) && !k.kin ? 'mercy' : 'guilty';
  else if (belief >= 0.5 && (provoked || (fond && sorry))) vote = 'mercy';
  else vote = belief >= 0.62 ? 'guilty' : 'not_proven';
  const reason = reasonFor(m, id, about, { vote, k, caught, provoked, claims });
  return { id, vote, belief: Math.round(belief * 100) / 100, reason, caught, source: 'local' };
}

function reasonFor(m, id, about, { vote, k, caught, provoked, claims }) {
  const V = name(m, about);
  const r = roll(m, about, `${id}:why`);
  const one = (list) => list[Math.floor(r * list.length) % list.length];
  if (caught.length) {
    const c = claims.find((x) => x.id === caught[0]);
    if (c?.kind === 'alibi') return one(['They say they were somewhere else. I saw them with my own eyes. They are lying to this room.', 'I saw where they were. It was not where they say.']);
    if (c?.kind === 'blame') return one(['They put it on someone else. I know better.', 'That is a lie, and a cruel one. I know who it was not.']);
    return one(['What they told us is not true. I know it is not.', 'I know that for a lie.']);
  }
  if (k.saw === 'clear') return vote === 'mercy' ? `I saw it. But I saw ${V} go for them first, too.` : one(['I saw it with my own eyes. I will not unsee it.', `I was there. I watched ${V} die.`]);
  if (provoked) return `I saw ${V} strike first. That does not make it right. It makes it a fight.`;
  if (claims.some((x) => x.kind === 'confess')) return vote === 'mercy' ? 'They said it to our faces. That counts for something.' : 'They said it themselves. What else is there?';
  if (vote === 'not_proven') return k.opinion >= 55 ? one(['I know them a little. I do not see it in them, and nobody here saw it.', 'Would they do this? Not the one I know.']) : one(['Nobody here saw it done. I will not put anyone outside on a feeling.', 'Suspicion is not proof. Not proven.']);
  if (vote === 'mercy') return one(['I think they did it. I am not sure they deserve the whole of it.', 'Guilty, I think. But I would not shut the door on them for good.']);
  if (k.kin) return `${V} was mine. Somebody did this. Everything points one way.`;
  if (k.opinion < 30) return one(['I never trusted them, and now this.', 'They came out of the snow, and now a grave. I have heard enough.']);
  return one(['Everything the watch says points one way.', 'What the watch told us is enough for me.', 'I did not see it. But I heard what was found, and I believe it.']);
}

function coerce(r, id, knows) {
  if (!r || typeof r !== 'object') return null;
  const vote = ['guilty', 'not_proven', 'mercy'].includes(r.vote) ? r.vote : null;
  if (!vote) return null;
  const belief = Number.isFinite(Number(r.belief)) ? Math.max(0, Math.min(1, Number(r.belief))) : vote === 'not_proven' ? 0.4 : 0.8;
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 240) : '';
  // A caught lie counts only if this juror knows the fact (checkClaim's knownBy).
  const caught = (Array.isArray(r.caught) ? r.caught : []).map(String).filter((x) => knows.includes(x));
  return { id, vote, belief, reason: reason || '…', caught, source: 'claude' };
}

// Everyone at once, one budget. onVote(vote) as each answer arrives (the portraits fill in).
export async function deliberate(m, about, { defence = '', checked = [], provider = null, budgetMs = BUDGET_MS, onVote = null, have = [] } = {}) {
  const jurors = jurorsOf(m, about);
  const got = new Map((have || []).filter((v) => v && jurors.includes(v.id)).map((v) => [v.id, v]));
  const ask = jurors.filter((id) => !got.has(id));
  const report = (v) => {
    got.set(v.id, v);
    try {
      onVote?.(v);
    } catch {
      /* the view is optional */
    }
  };
  if (provider && ask.length) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => {
        ctrl?.abort?.();
        resolve('late');
      }, budgetMs);
    });
    const calls = ask.map((id) => {
      const brief = jurorBrief(m, id, about, checked, defence);
      return Promise.resolve()
        .then(() => provider.complete({ rules: JUROR_RULES, task: brief.text, schema: JUROR_SCHEMA, tier: 'quick', signal: ctrl?.signal, maxTokens: 400 }))
        .then(
          (r) => {
            const v = coerce(r, id, brief.knows);
            if (v && !got.has(id)) report(v);
          },
          () => {},
        );
    });
    await Promise.race([Promise.all(calls), late]);
    clearTimeout(timer);
  }
  // Whoever has not answered weighs it by their own rules.
  for (const id of jurors) if (!got.has(id)) report(localJuror(m, id, about, checked, defence));
  return jurors.map((id) => got.get(id));
}

// The majority decides; the chair breaks a tie. Guilty and mercy both believe it was done:
// more of them than not_proven is a finding; mercy outnumbering guilty lightens the sentence.
export function tally(votes, chair = null) {
  const n = { guilty: 0, mercy: 0, not_proven: 0 };
  for (const v of votes || []) if (v && n[v.vote] != null) n[v.vote]++;
  const did = n.guilty + n.mercy;
  let found;
  if (did > n.not_proven) found = true;
  else if (did < n.not_proven) found = false;
  else {
    const cv = (votes || []).find((v) => v?.id === chair)?.vote;
    found = cv ? cv !== 'not_proven' : false;
  }
  const mercy = found && n.mercy > n.guilty;
  return { guilty: n.guilty, mercy: n.mercy, notProven: n.not_proven, found, outcome: !found ? 'not_proven' : mercy ? 'mercy' : 'guilty' };
}
