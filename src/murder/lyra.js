// Lyra and a death in her village (DESIGN §19.7 at its gravest, §29). She sees it, or
// hears it, or a body is found and she weighs what the watch suspects with everything she
// knows of the stranger: what she saw herself, what they told her, how they have treated
// people, how far she trusts them. Believing it ends things for good (gone). Unsure, she
// asks the stranger to their face, once. A confession she takes to the watch. Grief is
// her own: for a friend, quiet; for her mother or her father, everything stops.
//
// Round 14b (DESIGN §35.1): Lyra can be killed. Dead, she sees, hears, weighs and remembers
// nothing more: every entry here does nothing for a dead Lyra (lyra(m) is null), and she
// never remembers, grieves or asks about her own death.

import { HOUR, DAY } from './data.js';
import { lyraLine } from './lines.js';
import { placeAt } from '../ai/village_life/errands_data.js';
import { whenPhrase } from '../ai/village_life/problems.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[murder:lyra]', err);
    return fallback;
  }
}

// The record (or id) is her own death: she never learns of that.
function isHers(m, x) {
  const id = typeof x === 'string' ? x : x?.id;
  return !!id && id === lyraOf(m.game)?.id;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PARENTS = { hobb: 'father', wenna: 'mother' };
const RE_CONFESS = /\b(yes|yeah|i did|i killed|it was me|i did it|guilty|i'?m sorry|forgive me)\b/i;
const RE_DENY = /\b(no|nope|never|i didn'?t|didn'?t do|wasn'?t me|it wasn'?t|of course not|how could you)\b/i;

import { lyraOf } from '../core/people.js';

function lyra(m) {
  const L = lyraOf(m.game);
  if (!L || L.dead || m.dead?.[L.id]) return null;
  return L;
}

// Is she dead (or never there)? Then nothing of hers runs: no belief, no clue, no word.
function gone(m) {
  return !lyra(m);
}

function mind(m) {
  return lyra(m)?.mind || null;
}

function autonomy(m) {
  return mind(m)?.autonomy || null;
}

function state(m, id) {
  return (m.lyra[id] ||= { belief: null, asked: null, answered: null });
}

function near(m, r = 160) {
  const L = lyra(m);
  const P = m.game?.player;
  return !!L && !!P && Math.hypot(L.x - P.x, L.y - P.y) <= r;
}

function say(m, text, kind = 'say') {
  if (!text) return;
  const a = autonomy(m);
  if (a?.say) safe(() => a.say(text, { force: true, kind }));
  else safe(() => mind(m)?.say?.(text, { kind }));
}

function remember(m, text, opts) {
  safe(() => mind(m)?.remember?.(text, { type: 'event', ...opts }));
}

function feel(m, name, amount, cause) {
  safe(() => mind(m)?.feel?.(name, amount, cause));
}

function careOf(m, id) {
  const rel = safe(() => mind(m)?.relationships?.get?.(id));
  const aff = Number(rel?.affinity);
  if (Number.isFinite(aff)) return clamp(aff / 100, 0, 1);
  return PARENTS[id] ? 0.9 : 0.4;
}

function companionship(m) {
  return mind(m)?.companionship || autonomy(m)?.companionship || 'together';
}

function goneFor(m, rec, text, severity = -10) {
  const a = autonomy(m);
  const st = state(m, rec.id);
  st.belief = st.belief === 'knows' ? 'knows' : 'believes';
  if (!a?.recordDeed) return;
  if (a.ledger?.some?.((e) => e.deed === 'murdered_villager' && e.victimId === rec.id)) {
    if (companionship(m) !== 'gone') safe(() => a._goGone?.('murder', 'to_gone_murder', { target: m.name(rec.id) }, m.entity(rec.id)));
    return;
  }
  safe(() => a.recordDeed('murdered_villager', { victim: m.entity(rec.id), severity, text }));
}

// ------------------------------------------------------------------ seeing and hearing

export function sawHold(m, v) {
  if (gone(m) || isHers(m, v)) return;
  say(m, v.id === 'hobb' || v.id === 'wenna' ? `NO! Get away from ${v.id === 'hobb' ? 'Da' : 'Mam'}! GET AWAY!` : "Don't you dare. Don't you DARE! Put it down!", 'shout');
}

export function witnessed(m, rec) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  st.belief = 'knows';
  st.how = 'saw';
  const V = m.name(rec.id);
  const P = m.playerName();
  say(m, lyraLine('witness', { about: rec.id, P }, m.rng()), 'shout');
  remember(m, `I watched ${P} kill ${V} ${placeAt(rec.place, m.placeName(rec.place))}. ${V} was lying on the ground, helpless. I will never forgive it.`, { importance: 10, about: ['player', rec.id], tags: ['murder', 'death', rec.id], emotion: 'fear' });
  feel(m, 'fear', 0.9, `${P} killed ${V}`);
  feel(m, 'sadness', 0.6 + careOf(m, rec.id) * 0.4, `${V} is dead`);
  goneFor(m, rec, `Killed ${V}. I saw it.`);
  safe(() => autonomy(m)?.callForHelp?.(m.game.player, { reason: 'attacked', severity: 3, run: true }));
}

// Someone saw it; the news reaches her (the bell, the shouting in the lane).
export function hearsOfMurder(m, rec) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  if (st.belief === 'knows' || st.belief === 'believes') return;
  const from = (rec.seen || []).find((s) => s.id !== 'lyra') || (rec.clues || []).find((c) => c.kind === 'carry' && c.clarity === 'clear');
  const fromName = from ? m.name(from.id || from.by) : 'Everyone';
  const V = m.name(rec.id);
  const P = m.playerName();
  st.belief = 'believes';
  st.how = 'told';
  remember(m, `${fromName} saw ${P} kill ${V}. The whole village knows. I keep trying to make it mean something else.`, { importance: 10, about: ['player', rec.id], tags: ['murder', 'death', rec.id], emotion: 'grief' });
  grief(m, rec, { quiet: true });
  if (near(m, 220)) say(m, lyraLine('hears', { about: rec.id, P, from: fromName }, m.rng()), 'say');
  goneFor(m, rec, `Killed ${V}; ${fromName} saw it.`, -9);
}

// The body was found by someone else: grief, then she weighs what is said.
export function learnsDeath(m, rec) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  if (st.belief === 'knows' || st.belief === 'believes') return;
  grief(m, rec);
  st.weighAt = Math.round(m.now() + 0.6 * HOUR);
}

// She came on the body herself.
export function foundBody(m, rec) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  const V = m.name(rec.id);
  say(m, PARENTS[rec.id] ? `${PARENTS[rec.id] === 'father' ? 'Da' : 'Mam'}? ${PARENTS[rec.id] === 'father' ? 'Da' : 'Mam'}! No— no, no, no. ROWAN!` : `${V}? Oh, no. No. ROWAN! Somebody! It's ${V}!`, 'shout');
  remember(m, `I found ${V}'s body ${placeAt(m.placeOf(m.entity(rec.id)), m.placeName(m.placeOf(m.entity(rec.id))))}. Somebody did that with a blade.`, { importance: 9, about: [rec.id], tags: ['murder', 'death', rec.id], emotion: 'fear' });
  if (st.belief !== 'knows') {
    grief(m, rec, { quiet: true });
    st.weighAt = Math.round(m.now() + 0.6 * HOUR);
  }
}

export function grief(m, rec, { quiet = false } = {}) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  if (st.grieved) return;
  st.grieved = true;
  const V = m.name(rec.id);
  const c = careOf(m, rec.id);
  const rel = PARENTS[rec.id];
  feel(m, 'sadness', rel ? 1 : 0.3 + c * 0.6, `${V} is dead`);
  remember(m, rel ? `My ${rel} is dead. Somebody killed ${rec.id === 'hobb' ? 'Da' : 'Mam'}. I don't know how to write the rest of this.` : `${V} is dead. Murdered. I keep expecting to see ${m.pronoun(rec.id, 'him')} in the lane.`, { importance: rel ? 10 : 6 + Math.round(c * 3), about: [rec.id], tags: ['death', 'grief', rec.id], emotion: 'grief' });
  if (!quiet && near(m, 260)) say(m, lyraLine(rel ? 'griefParent' : 'grief', { about: rec.id, rel: rel || '' }, m.rng()));
  // Her mother or her father: she goes home to the one who is left, for a while.
  if (rel && ['together', 'wary'].includes(companionship(m))) safe(() => autonomy(m)?.setCompanionship?.('apart', '', { cause: 'chose', vars: { why: `I need to be at home. ${rec.id === 'hobb' ? 'Mam' : 'Da'} needs me.` }, silent: true }));
  const diary = mind(m)?.diary;
  if (Array.isArray(diary)) diary.push({ day: m.day(), text: rel ? `Day ${m.day()}. ${rec.id === 'hobb' ? 'Da' : 'Mam'} is dead. Somebody killed ${rec.id === 'hobb' ? 'him' : 'her'}. The lamps are still burning. I don't know who lit them.` : `Day ${m.day()}. ${V} is dead. They say a blade did it. I keep thinking ${m.pronoun(rec.id, 'he')} should be here.`, t: m.now() });
}

// She saw the stranger carrying something, or someone.
export function sawCarry(m, rec, clarity) {
  if (gone(m) || isHers(m, rec)) return;
  const V = m.name(rec.id);
  const P = m.playerName();
  if (clarity === 'clear') {
    const st = state(m, rec.id);
    st.belief = 'knows';
    say(m, `That's ${V}. That's— what did you DO?`, 'shout');
    remember(m, `I saw ${P} carrying ${V}'s body. ${V} is dead, and ${P} was carrying ${m.pronoun(rec.id, 'him')} away.`, { importance: 10, about: ['player', rec.id], tags: ['murder', rec.id], emotion: 'fear' });
    grief(m, rec, { quiet: true });
    goneFor(m, rec, `Carried ${V}'s body away to hide it.`);
    safe(() => autonomy(m)?.callForHelp?.(m.game.player, { reason: 'attacked', severity: 3, run: true }));
    // She tells the watch what she saw.
    rec.clues.push({ kind: 'carry', by: 'lyra_eyes', t: Math.round(m.now()), place: m.placeOf(m.game.player), clarity: 'clear' });
    rec.known = 'witnessed';
    m.setWanted(rec.id, 'murder');
    m.found(rec.id, 'lyra', m.placeOf(m.game.player), { witnessed: true });
    return;
  }
  (state(m, rec.id).own ||= []).push({ kind: 'carry', t: Math.round(m.now()), place: m.placeOf(m.game.player) });
  remember(m, `I saw ${P} at a distance, carrying something heavy ${placeAt(m.placeOf(m.game.player), m.placeName(m.placeOf(m.game.player)))}. I couldn't see what.`, { importance: 4, about: ['player'], tags: ['odd'] });
}

// ------------------------------------------------------------------ weighing

// How strongly she believes the stranger did it (0..1), and why.
export function beliefOf(m, rec) {
  const c = m.cases[rec.id];
  const s = c ? (m.weigh(rec.id), c.suspicion) : 0;
  let keep = 1;
  const why = [];
  const add = (w, text) => {
    keep *= 1 - w;
    why.push(text);
  };
  const win = 2 * HOUR;
  if ((rec.snap?.victim || []).some((x) => x.by === 'lyra' && x.with === 'player' && rec.t - x.t <= win) || (rec.snap?.player || []).some((x) => x.by === 'lyra' && x.with === rec.id && rec.t - x.t <= win)) add(0.3, `I saw them with ${m.name(rec.id)} that day`);
  for (const o of state(m, rec.id).own || []) if (o.kind === 'carry') add(0.3, 'I saw them carrying something heavy');
  for (const cl of m.claimsAbout(rec.id)) if (cl.to === 'lyra' && cl.found) add(0.3, `they lied to me about ${m.name(rec.id)}`);
  const a = autonomy(m);
  const now = m.now();
  const violent = (a?.ledger || []).filter((e) => ['attacked_villager', 'downed_villager', 'hit_lyra', 'downed_lyra'].includes(e.deed) && now - e.t < 3 * DAY).length;
  if (violent) add(Math.min(0.35, 0.15 * violent), 'they have hurt people here');
  const own = 1 - keep;
  const trust = Number(a?.stats?.()?.trust ?? 40);
  let b = 1 - (1 - s * 0.85) * (1 - own);
  b -= (trust - 40) / 250;
  return { belief: clamp(Math.round(b * 1000) / 1000, 0, 1), suspicion: s, why };
}

export function tick(m) {
  if (gone(m)) return;
  const now = m.now();
  for (const [id, st] of Object.entries(m.lyra)) {
    const rec = m.dead[id];
    if (!rec || st.belief === 'knows' || st.belief === 'believes') continue;
    if (st.weighAt != null && now >= st.weighAt) {
      st.weighAt = Math.round(now + 0.5 * DAY);
      decide(m, rec, st);
    }
    // A question waiting for the stranger to come close.
    if (st.belief === 'fears' && !st.asked && near(m, 110)) ask(m, rec, st);
  }
}

function decide(m, rec, st) {
  const { belief, why } = beliefOf(m, rec);
  st.score = belief;
  st.why = why;
  const V = m.name(rec.id);
  const P = m.playerName();
  if (belief >= 0.6) {
    st.belief = 'believes';
    remember(m, `The watch thinks ${P} killed ${V}, and everything I know points the same way: ${why.join('; ') || 'what the village says'}.`, { importance: 9, about: ['player', rec.id], tags: ['murder', rec.id], emotion: 'grief' });
    if (near(m, 220)) say(m, lyraLine('believes', { about: rec.id, P }, m.rng()));
    goneFor(m, rec, `I believe they killed ${V}.`, -8);
    return;
  }
  if (belief >= 0.3) {
    st.belief = 'fears';
    remember(m, `People are saying ${P} had something to do with ${V}'s death. I don't know what to believe. I'm going to ask them.`, { importance: 7, about: ['player', rec.id], tags: ['murder', rec.id], emotion: 'fear' });
    if (companionship(m) === 'together') safe(() => autonomy(m)?.setCompanionship?.('wary', '', { cause: 'chose', vars: { why: `I need to know what happened to ${V}.` }, silent: true }));
    return;
  }
  st.belief = 'doubts';
}

function ask(m, rec, st) {
  st.asked = Math.round(m.now());
  m.lyraAsking = { about: rec.id, rt: m.game?.time ?? 0 };
  say(m, lyraLine('ask', { about: rec.id, P: m.playerName() }, m.rng()));
}

// The stranger's answer to her question, from the chat.
export function onPlayerMessage(m, text) {
  if (gone(m)) return null;
  const q = m.lyraAsking;
  if (!q || !text) return null;
  const rec = m.dead[q.about];
  const st = m.lyra[q.about];
  if (!rec || !st) {
    m.lyraAsking = null;
    return null;
  }
  const s = String(text);
  const confess = RE_CONFESS.test(s) && !/\bno\b/i.test(s.split(/[.!?]/)[0]);
  const deny = !confess && RE_DENY.test(s);
  if (!confess && !deny) return null;
  m.lyraAsking = null;
  st.answered = confess ? 'confessed' : 'denied';
  rec.answers.push({ kind: confess ? 'told_lyra' : null, w: 0, t: Math.round(m.now()), text: confess ? `${m.playerName()} told Lyra they did it.` : `${m.playerName()} told Lyra they did not.` });
  if (confess) {
    onConfession(m, rec, 'lyra');
    return lyraLine('confessed', { about: rec.id, P: m.playerName() }, m.rng());
  }
  // She chooses to believe them, for now; a lie found later costs everything.
  st.belief = 'doubts';
  st.denied = Math.round(m.now());
  remember(m, `I asked ${m.playerName()} straight out about ${m.name(rec.id)}. They said no. I'm choosing to believe them.`, { importance: 7, about: ['player', rec.id], tags: ['murder', rec.id] });
  return lyraLine('denied', { about: rec.id }, m.rng());
}

export function onConfession(m, rec, to) {
  if (gone(m) || isHers(m, rec)) return;
  const st = state(m, rec.id);
  const V = m.name(rec.id);
  const P = m.playerName();
  if (to === 'lyra') {
    remember(m, `${P} told me they killed ${V}. To my face. I told Rowan. I had to.`, { importance: 10, about: ['player', rec.id], tags: ['murder', rec.id], emotion: 'grief' });
    rec.answers.push({ kind: 'lyra_told', w: 0.85, t: Math.round(m.now()), text: `Lyra told the watch that ${P} confessed to her.` });
    m.weigh(rec.id);
    const c = m.cases[rec.id];
    if (c && c.state === 'open') c.askAt = m.now();
  } else if (near(m, 240)) {
    remember(m, `${P} confessed to the watch that they killed ${V}. I heard it.`, { importance: 10, about: ['player', rec.id], tags: ['murder', rec.id], emotion: 'grief' });
  }
  if (st.belief !== 'knows') goneFor(m, rec, `Killed ${V}, and said so.`, -10);
  st.belief = 'knows';
}

// After the watch has asked: a word for the stranger, if she doubts it and is near.
export function afterQuestioning(m, c) {
  if (gone(m) || isHers(m, c?.about)) return;
  const st = m.lyra[c.about];
  if (!st || !near(m, 180)) return;
  if (st.belief === 'doubts' && c.suspicion < 0.6) say(m, lyraLine('defends', { about: c.about }, m.rng()));
}

export function onVerdict(m, about, v) {
  if (gone(m) || isHers(m, about)) return;
  const rec = m.dead[about];
  if (!rec) return;
  const st = state(m, about);
  if (v.guilty) {
    if (st.belief !== 'knows' && st.belief !== 'believes') goneFor(m, rec, `The Moot found them guilty of killing ${m.name(about)}.`, -9);
    st.belief = st.belief === 'knows' ? 'knows' : 'believes';
    remember(m, `The Moot found ${m.playerName()} guilty of ${m.name(about)}'s death and put them outside.`, { importance: 8, about: ['player', about], tags: ['murder', 'moot', about] });
  } else {
    remember(m, `The Moot could not prove ${m.playerName()} killed ${m.name(about)}. I don't know what I think.`, { importance: 6, about: ['player', about], tags: ['murder', 'moot', about] });
    st.weighAt = Math.round(m.now() + HOUR);
  }
}

// What she knows, for Claude: deaths, and what she believes.
export function promptContext(m) {
  if (gone(m)) return '';
  const bits = [];
  const t = m.now();
  for (const rec of Object.values(m.dead)) {
    const st = m.lyra[rec.id];
    if (!st && rec.foundAt == null) continue; // she does not know (nobody does)
    const V = m.name(rec.id);
    const how = st?.how === 'saw' ? `You watched ${m.playerName()} kill ${V}.` : rec.foundAt != null ? `${V} is dead: murdered, found ${placeAt(rec.foundPlace, m.placeName(rec.foundPlace))} ${whenPhrase(rec.foundAt, t)}.` : `${V} is dead.`;
    const belief = st?.belief === 'knows' ? 'You know the stranger did it.' : st?.belief === 'believes' ? 'You believe the stranger did it.' : st?.belief === 'fears' ? 'You fear the stranger had something to do with it; you have asked them.' : st?.belief === 'doubts' ? 'The watch has questions about the stranger; you do not believe it.' : '';
    bits.push(`${how} ${belief}`.trim());
  }
  if (m.lyraAsking) bits.push(`You just asked ${m.playerName()} whether they had anything to do with ${m.name(m.lyraAsking.about)}'s death; their message may be the answer.`);
  let s = bits.join(' ');
  if (s.length > 520) s = `${s.slice(0, 517)}…`;
  return s;
}
