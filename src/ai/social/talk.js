// One exchange between two of Hearthvale's people, from their own voices (voices.js):
// 2–6 lines, picked by who they are to each other, the time and weather, what is in the
// air this week, and the news one of them carries. Pure: the village passes in what it
// knows (`ctx`) and applies the result.
//
// ctx: { rng, hour, weather: 'clear'|'rain'|'fog'|'cloudy', isNight, stance(id) ->
//        'good'|'mid'|'bad' (how they see the player), bond(a, b), tellable(a, b) ->
//        [rumor], renderRumor(rumor, speakerId) -> clause, sameWork(a, b), recent: Set of
//        recently said lines, recentScenes: Set, avoidTopics: Set, lyraMood: valence }
// -> { topic, lines: [{ speaker, text }], scene?, rumor?, effects: { ab, ba } }

import { VOICES, SCENES } from './voices.js';
import { voiceOf, say, topicPool, hasTopic, rnd, pickOne, shortName, fill, varsFor } from './lines.js';
import { FAMILY_TAGS } from './bonds_data.js';

// LORE §5 "In the air this week".
export const WEEK_TOPICS = ['harvest', 'dance', 'contests', 'stones', 'duchess', 'oil', 'far_lamps', 'well_cap', 'notices', 'bets'];
const BIG_TOPICS = ['stranger', 'lyra', 'maren', 'bandits', 'stone', 'ward', 'owlsend'];

export const TOPIC_SUMMARY = {
  small: 'passed the time of day',
  howare: 'asked after each other',
  weather: 'talked about the weather',
  work: 'talked shop',
  harvest: 'talked about the harvest',
  dance: 'talked about the Sheaf Moot dance',
  contests: 'argued about the Moot contests',
  stones: 'argued over the stones score',
  duchess: 'laughed about Duchess and the Reeve’s ledger',
  oil: 'grumbled about the price of oil',
  far_lamps: 'wondered who lights the far lamps early',
  well_cap: 'talked about the well-cap hinge',
  notices: 'talked about Pip’s notices',
  bets: 'talked about Petra’s bets',
  own: 'had a good long talk',
  family: 'talked about family',
  stranger: 'talked about you',
  lyra: 'talked about Lyra',
  maren: 'talked about Maren',
  bandits: 'worried about the bandits',
  stone: 'talked about the stone question',
  ward: 'talked about the ward',
  owlsend: 'talked about Owlsend’s dark lamps',
  rumor: 'traded news',
};

// The tag that best names what b is to a.
const TAG_ORDER = ['spouse', 'child', 'parent', 'ward', 'sibling', 'crush', 'mentor', 'apprentice', 'grudge', 'rival', 'friend'];
export function mainTag(bond) {
  const tags = bond?.tags || [];
  for (const t of TAG_ORDER) if (tags.includes(t)) return t;
  return null;
}

function isFamily(bond) {
  return (bond?.tags || []).some((t) => FAMILY_TAGS.has(t));
}

function weatherKey(ctx) {
  if (ctx.weather === 'rain') return 'rain';
  if (ctx.weather === 'fog') return 'fog';
  if (ctx.isNight) return 'night';
  return 'clear';
}

function weighted(list, rng) {
  let sum = 0;
  for (const [, w] of list) sum += Math.max(0, w);
  if (sum <= 0) return null;
  let r = rnd(rng) * sum;
  for (const [x, w] of list) {
    r -= Math.max(0, w);
    if (r <= 0) return x;
  }
  return list[list.length - 1][0];
}

export function scenesFor(a, b) {
  return SCENES.filter((s) => (s.with[0] === a && s.with[1] === b) || (s.with[0] === b && s.with[1] === a));
}

// What two people talk about now.
export function chooseTopic(ctx, a, b) {
  const rng = ctx.rng;
  const bab = ctx.bond(a, b);
  const bba = ctx.bond(b, a);
  const avoid = ctx.avoidTopics || new Set();
  const cands = [];
  const news = ctx.tellable?.(a, b) || [];
  if (news.length) cands.push(['rumor', 2 + news[0].severity * 4]);
  const back = ctx.tellable?.(b, a) || [];
  if (!news.length && back.length) cands.push(['rumor_back', 1.5 + back[0].severity * 3]);
  const wet = ctx.weather === 'rain' || ctx.weather === 'fog';
  cands.push(['weather', wet ? 1.4 : 0.6]);
  cands.push(['howare', 0.9 + (bab?.affinity > 50 ? 0.5 : 0)]);
  for (const s of scenesFor(a, b)) {
    if (ctx.recentScenes?.has(s)) continue;
    if (s.night && !ctx.isNight) continue;
    // A daytime scene (a market cry) not at night; a dusk scene (the far lamps) at dusk.
    if (s.day && ctx.isNight) continue;
    if (s.dusk && !(ctx.hour >= 17 && ctx.hour < 22.5)) continue;
    if (avoid.has(s.topic)) continue;
    cands.push([{ scene: s }, 1.6]);
  }
  const shared = new Set();
  for (const k of Object.keys(voiceOf(a)?.about || {})) {
    if (k === 'weather' || avoid.has(k)) continue;
    if (k === 'lyra' && (a === 'lyra' || b === 'lyra')) continue;
    if (k === 'own') {
      cands.push(['own', 0.5]);
      continue;
    }
    const both = hasTopic(b, k);
    if (both) shared.add(k);
    let w = both ? 1 : 0.45;
    if (WEEK_TOPICS.includes(k)) w += 0.45;
    if (k === 'work' && ctx.sameWork?.(a, b)) w += 1.2;
    if (k === 'family' && isFamily(bab)) w += 1.2;
    if (k === 'stranger') w += 0.3 + (ctx.strangerNews || 0);
    if (k === 'lyra' && (bab?.tags?.includes('parent') || bba?.tags?.includes('child') || b === 'hobb' || b === 'wenna')) w += 0.8;
    cands.push([k, w]);
  }
  const pick = weighted(cands, rng);
  return pick || 'howare';
}

function line(speaker, text) {
  return text ? { speaker, text } : null;
}

// a's opening line to b.
function opener(ctx, a, b, extra) {
  const v = voiceOf(a);
  if (!v) return null;
  if (v.helloTo?.[b]?.length && rnd(ctx.rng) < 0.6) {
    const l = say(v.helloTo[b], a, b, { rng: ctx.rng, direct: true, avoid: ctx.recent, extra });
    if (l) return l;
  }
  return say(v.hello, a, b, { rng: ctx.rng, avoid: ctx.recent, extra });
}

// b's answer to an opening, in passing.
function helloBack(ctx, b, a, extra) {
  const v = voiceOf(b);
  if (!v) return null;
  if (v.helloTo?.[a]?.length && rnd(ctx.rng) < 0.5) {
    const l = say(v.helloTo[a], b, a, { rng: ctx.rng, direct: true, avoid: ctx.recent, extra });
    if (l) return l;
  }
  return say(rnd(ctx.rng) < 0.5 ? v.short : v.hello, b, a, { rng: ctx.rng, avoid: ctx.recent, extra });
}

// b's reply to a's greeting: what a is to b colours it ("Yes, love." to a wife's hello;
// "Six! It's Brightwater flour!" to Elda's bread price).
function greetBack(ctx, b, a, extra) {
  const v = voiceOf(b);
  if (!v) return null;
  const tag = mainTag(ctx.bond(b, a));
  if (tag && v.as?.[tag]?.length && rnd(ctx.rng) < 0.5) {
    const l = say(v.as[tag], b, a, { rng: ctx.rng, direct: true, onlyFor: true, avoid: ctx.recent, extra });
    if (l) return l;
  }
  return helloBack(ctx, b, a, extra);
}

// How b answers what a just said about a topic: their own line on it when they have one,
// otherwise agreement or argument as befits who a is to them.
function answer(ctx, b, a, { agree = null, topic = null, extra = {} } = {}) {
  const v = voiceOf(b);
  if (!v) return null;
  const bond = ctx.bond(b, a);
  const tag = mainTag(bond);
  const rng = ctx.rng;
  const opts = { rng, avoid: ctx.recent, extra };
  if (topic && hasTopic(b, topic) && rnd(rng) < 0.65) {
    const l = say(topicPool(b, topic, { weather: weatherKey(ctx), stance: ctx.stance?.(b) }), b, a, opts);
    if (l) return l;
  }
  const aff = bond?.affinity ?? 0;
  if (agree === true) return say(rnd(rng) < 0.5 ? v.yes : v.short, b, a, opts);
  if (agree === false || tag === 'rival' || tag === 'grudge' || aff < -10) return say(rnd(rng) < 0.5 ? v.no : v.tease || v.no, b, a, opts);
  if (aff > 55 && rnd(rng) < 0.3) return say(v.warm, b, a, opts);
  if (rnd(rng) < 0.5) return say(v.yes, b, a, opts);
  return say(v.short, b, a, opts);
}

// Build one exchange. opts: { topic, passing, rumor, maxLines, playerName }.
export function buildExchange(ctx, a, b, opts = {}) {
  const rng = ctx.rng;
  const extra = { playerName: opts.playerName || '' };
  const maxLines = Math.max(2, Math.min(6, opts.maxLines || 6));
  let topic = opts.topic || (opts.passing ? 'small' : chooseTopic(ctx, a, b));
  // A scripted scene: the best-written moments, played whole.
  if (topic && typeof topic === 'object' && topic.scene) {
    const s = topic.scene;
    return { topic: s.topic, scene: s, lines: s.lines.slice(0, maxLines).map(([sp, text]) => ({ speaker: sp, text })), effects: effectsFor(ctx, a, b, s.topic) };
  }
  if (topic === 'rumor_back') return buildExchange(ctx, b, a, { ...opts, topic: 'rumor' });
  const lines = [];
  const push = (l) => {
    if (!l || lines.length >= maxLines || lines.some((x) => x.text === l.text)) return;
    const last = lines[lines.length - 1];
    // One speaker twice running reads as one turn.
    if (last && last.speaker === l.speaker) {
      if (last.text.length + l.text.length < 150) last.text = `${last.text} ${l.text}`;
      return;
    }
    lines.push(l);
  };
  // Passing in the lane: a nod each way.
  if (opts.passing || topic === 'small') {
    push(line(a, opener(ctx, a, b, extra)));
    push(line(b, helloBack(ctx, b, a, extra)));
    return { topic: 'small', lines, effects: effectsFor(ctx, a, b, 'small') };
  }
  const va = voiceOf(a);
  const vb = voiceOf(b);
  // Carrying on a talk already going: no second hello.
  if (!opts.continuing) push(line(a, opener(ctx, a, b, extra)));
  let rumor = null;
  if (topic === 'rumor') {
    rumor = opts.rumor || ctx.tellable?.(a, b)?.[0] || null;
    const clause = rumor ? ctx.renderRumor?.(rumor, a) : null;
    // Someone who saw it with their own eyes says so.
    const pool = rumor?.saw?.includes(a) && va?.rumor?.saw?.length ? va.rumor.saw : va?.rumor?.tell;
    const tell = clause ? say(pool, a, b, { rng, vars: { ...varsFor(a, b, extra), rumor: clause } }) : null;
    if (tell) {
      if (!opts.continuing) push(line(b, rnd(rng) < 0.5 ? greetBack(ctx, b, a, extra) : null));
      push(line(a, tell));
      const trust = ctx.bond(b, a)?.trust ?? 50;
      const kind = trust < 40 && rnd(rng) < 0.6 ? 'doubt' : rumor.valence > 0.15 ? 'good' : rumor.valence < -0.15 ? 'bad' : rnd(rng) < 0.5 ? 'doubt' : 'good';
      push(line(b, say(vb?.rumor?.[kind] || vb?.short, b, a, { rng, avoid: ctx.recent, extra })));
      // Someone who loves the one it happened to says more.
      if (rumor.victim && rumor.victim !== b && rumor.valence < 0 && (ctx.bond(b, rumor.victim)?.affinity ?? 0) >= 60) {
        push(line(b, say(vb?.rumor?.bad || vb?.no, b, a, { rng, avoid: new Set(lines.map((l) => l.text)), extra })));
      } else if (lines.length < maxLines - 1 && rnd(rng) < 0.5) push(line(a, answer(ctx, a, b, { agree: true, extra })));
    } else {
      rumor = null;
      topic = 'howare';
    }
  }
  if (topic === 'howare') {
    const ask = say(va?.askHow, a, b, { rng, avoid: ctx.recent, extra });
    push(line(a, ask));
    const how = ctx.howAreYou?.(b) || vb?.howAreYou;
    push(line(b, say(how, b, a, { rng, avoid: ctx.recent, extra })));
    const last = lines[lines.length - 1]?.text || '';
    if (/\b(you|yourself)\?$/i.test(last)) push(line(a, say(ctx.howAreYou?.(a) || va?.howAreYou || va?.short, a, b, { rng, avoid: ctx.recent, extra })));
    else if (rnd(rng) < 0.5) push(line(a, answer(ctx, a, b, { extra })));
  } else if (topic !== 'rumor') {
    const pool = topicPool(a, topic, { weather: weatherKey(ctx), stance: ctx.stance?.(a) });
    const said = say(pool, a, b, { rng, avoid: ctx.recent, extra });
    if (said) {
      if (!opts.continuing && rnd(rng) < 0.6) push(line(b, greetBack(ctx, b, a, extra)));
      push(line(a, said));
      push(line(b, answer(ctx, b, a, { topic, extra })));
      if (lines.length < maxLines - 1 && rnd(rng) < 0.4) push(line(a, answer(ctx, a, b, { extra })));
    } else {
      topic = 'howare';
      push(line(a, say(va?.askHow, a, b, { rng, extra })));
      push(line(b, say(ctx.howAreYou?.(b) || vb?.howAreYou, b, a, { rng, extra })));
    }
  }
  // A goodbye, sometimes.
  if (!opts.noBye && lines.length < maxLines && lines.length >= 3 && rnd(rng) < 0.5) {
    // Whoever did not speak last takes their leave.
    const who = lines[lines.length - 1]?.speaker === a ? b : a;
    const other = who === a ? b : a;
    push(line(who, say(voiceOf(who)?.bye, who, other, { rng, avoid: ctx.recent, extra })));
  }
  if (lines.length < 2) {
    lines.length = 0;
    push(line(a, opener(ctx, a, b, extra) || fill('Well.', {})));
    push(line(b, helloBack(ctx, b, a, extra) || say(vb?.short, b, a, { rng })));
  }
  return { topic, lines: lines.filter(Boolean), rumor, teller: rumor ? a : null, effects: effectsFor(ctx, a, b, topic) };
}

// How talking moves the two of them: closer, mostly; rivals stay rivals.
function effectsFor(ctx, a, b, topic) {
  const out = {};
  for (const [x, y, key] of [
    [a, b, 'ab'],
    [b, a, 'ba'],
  ]) {
    const bond = ctx.bond(x, y);
    const tag = mainTag(bond);
    let aff = 0.6 + rnd(ctx.rng) * 0.8;
    if (tag === 'grudge') aff = -0.4;
    else if (tag === 'rival') aff = rnd(ctx.rng) < 0.5 ? -0.3 : 0.4;
    if (topic === 'small') aff *= 0.4;
    // Warmth comes slower the warmer they already are: old friends stay old friends.
    if (aff > 0) aff *= Math.max(0.1, 1 - Math.max(0, bond?.affinity ?? 0) / 110);
    out[key] = { affinity: Math.round(aff * 10) / 10, familiarity: topic === 'small' ? 0.3 : 1, trust: topic === 'rumor' ? 0.4 : 0.2 };
  }
  return out;
}

// One line naming the conversation for the log and the morning's news.
export function summarize(a, b, topic, { names = shortName, rumorText = null } = {}) {
  const A = names(a);
  const B = names(b);
  if (topic === 'rumor' && rumorText) return `${A} told ${B} that ${rumorText}.`;
  const what = TOPIC_SUMMARY[topic] || 'talked';
  return `${A} and ${B} ${what}.`;
}

export { VOICES, pickOne, BIG_TOPICS };
