// The player says anything to any villager (DESIGN §19.3 "Talking to anyone"): the local
// understanding of what was said, and the villager's answer in their own voice. Claude
// does this better when it is available; this is what the village says without it, and
// it has to be good on its own: "oh hello, how are you?" gets a warm, in-character answer.

import { voiceOf, say, topicPool, rnd, thirdName, shortName, fill, varsFor } from './lines.js';
import { ALIASES } from './voices.js';
import { PEOPLE } from './bonds_data.js';
import { TO_YOU, FALLBACK_TO_YOU } from './voices_player.js';
import { WEEK_TOPICS } from './talk.js';
import { speakable } from './hidden.js';

const RE = {
  greet: /\b(hi|hello|hey|hiya|howdy|greetings|good (?:morning|afternoon|evening|day)|morning|evening|well met|ho there|salutations)\b|^yo\b/i,
  howare: /\bhow(?:'s| is| are|'re)? (?:you|ya|it going|things|life|are things|have you been|you been|do you do|you doing|goes it|fare you|are you keeping|is your day|was your day)\b|\bhow you doing\b|\bhow goes\b|\bwhat'?s up\b|\bare you (?:well|ok(?:ay)?|alright|all right)\b|\byou (?:ok(?:ay)?|alright|all right|well)\?/i,
  thanks: /\b(thanks|thank you|thank ye|thankyou|cheers|much obliged|grateful|appreciate it)\b/i,
  apology: /\b(sorry|apologi[sz]e|apology|forgive me|my fault|i was wrong|i didn'?t mean|i regret|i shouldn'?t have|make (?:it )?(?:up|amends))\b/i,
  threat: /\b(i(?:'ll| will| am going to|'m going to|'m gonna| gonna| shall) (?:kill|hurt|hit|stab|burn|beat|end|smash|rob|cut|break|get) you|kill you|you(?:'re| are) dead|watch your back|or else|i'?ll burn (?:this|your)|i'?ll make you pay)\b/i,
  insult: /\b(idiot|stupid|fool(?:ish)?|ugly|hate you|shut up|useless|pathetic|dumb|moron|loser|old (?:hag|crow|fool|goat)|you stink|you smell|worthless|bastard|damn you|get lost|annoying|boring|coward|liar|cheat|fraud|crook)\b/i,
  compliment: /\b(you(?:'re| are) (?:so |very |really )?(?:great|amazing|kind|lovely|wonderful|beautiful|pretty|handsome|clever|smart|brave|the best|cool|nice|funny|wise|strong|talented|sweet|awesome|brilliant)|i like (?:you|your|it here)|love your|nice (?:hat|shop|forge|place|work|hair|cakes?|bread|bees|lamps|garden|hens|boat)|good (?:job|work)|well done|you look (?:nice|well|great|lovely|good)|best (?:cakes?|smith|bread|honey))\b/i,
  flirt: /\b(marry me|kiss me|kiss you|go out with me|date me|you(?:'re| are) (?:cute|hot|gorgeous|beautiful)|be mine|i fancy you|i love you|sweetheart|darling)\b/i,
  farewell: /\b(bye|goodbye|good-bye|farewell|see you|see ya|good night|goodnight|take care|later|i must go|got to go|gotta go)\b/i,
  news: /\b(news|gossip|what'?s new|anything new|heard anything|rumou?rs?|what'?s happening|what'?s going on|what have you heard|tell me something)\b/i,
  work: /\b(what do you do|your (?:job|work|trade)|what are you (?:doing|making|working on|up to)|how'?s (?:work|business|the (?:forge|shop|inn|farm|harvest|fishing|bees|hives|dyeing|chapel|watch))|need (?:any )?help|can i help|anything i can do)\b/i,
  whoami: /\b(who are you|what'?s your name|tell me about yourself|introduce yourself|what are you like)\b/i,
  aboutme: /\bwhat do you (?:think|make) of me\b|\bdo you like me\b|\bwhat do (?:people|they|you all) (?:think|say) (?:of|about) me\b/i,
  yes: /^(?:yes|yeah|yep|yup|sure|of course|okay|ok|aye|indeed|right)\b/i,
  no: /^(?:no|nope|nah|never|not really)\b/i,
};

// Topic words -> the voice banks' topic keys.
const TOPIC_WORDS = [
  ['bandits', /\b(bandits?|varek|one-eyed|outlaws?|toll|the fork|camp)\b/i],
  ['maren', /\b(maren|wardwright|your teacher)\b/i],
  ['stone', /\b(marry(?:ing)? the stone|the stone question|wedd(?:ed|ing) to the stone|wardstone)\b/i],
  ['ward', /\b(the ward|ward\b|wellstone|bell-?reach|the hum|slimes?)\b/i],
  ['harvest', /\b(harvest|sheaf|wheat|turnips?|crops?)\b/i],
  ['dance', /\b(dance|dancing|sheaf moot|the moot|festival)\b/i],
  ['contests', /\b(hammer-?throw|contests?|ribbon|biggest turnip)\b/i],
  ['stones', /\b(game of stones|stones score|stones game|play stones)\b/i],
  ['duchess', /\b(duchess|hens?|chickens?)\b/i],
  ['oil', /\b(lamp-?oil|oil|cinderwick|prices?)\b/i],
  ['far_lamps', /\b(far lamps|lamps lit early|who lights the lamps)\b/i],
  ['well_cap', /\b(well-?cap|hinge)\b/i],
  ['notices', /\b(notices?|notice board|biscuit)\b/i],
  ['bets', /\b(bets?|betting|wager)\b/i],
  ['owlsend', /\b(owlsend)\b/i],
  ['weather', /\b(weather|rain(?:ing)?|fog(?:gy)?|sunny|cold today|storm)\b/i],
  ['stranger', /\b(the stranger|strangers?|the mountain|hollowcrown|the wayhouse)\b/i],
];

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let PERSON_RES = null;
function personRes() {
  if (PERSON_RES) return PERSON_RES;
  PERSON_RES = [];
  for (const id of PEOPLE) {
    const names = [...new Set([shortName(id), id, ...(ALIASES[id] || []).filter((a) => !/^(the|my|that|master|captain|da|gran|kicker)\b/i.test(a) || /^the (captain|reeve|sister)$/i.test(a))])];
    PERSON_RES.push([id, new RegExp(`\\b(?:${names.map(ESC).join('|')})\\b`, 'i')]);
  }
  return PERSON_RES;
}

// What the player said, understood well enough to answer.
export function understand(text, { selfId = null, locations = null } = {}) {
  const t = String(text || '').trim();
  const intents = new Set();
  for (const [k, re] of Object.entries(RE)) if (re.test(t)) intents.add(k);
  // "Thank you, I'm fine" is thanks, not a greeting; "good morning" is a greeting, not praise.
  if (intents.has('threat')) intents.delete('insult');
  const question = /\?\s*$/.test(t) || /^(what|who|where|why|how|when|do|does|did|is|are|can|could|would|will|have|has|tell me|know)\b/i.test(t);
  let person = null;
  for (const [id, re] of personRes()) {
    if (id === selfId) continue;
    if (re.test(t)) {
      person = id;
      break;
    }
  }
  if (!person && /\bmaren\b/i.test(t)) person = 'maren';
  let topic = null;
  for (const [k, re] of TOPIC_WORDS) {
    if (re.test(t)) {
      topic = k;
      break;
    }
  }
  if (topic === 'maren') {
    person = 'maren';
    topic = null;
  }
  let place = null;
  if (!person && !topic && locations?.find && /\b(about|where|what'?s|the)\b/i.test(t)) {
    const m = t.match(/\babout (?:the )?([a-z' -]{3,30})\??$/i) || t.match(/\bwhere(?:'s| is) (?:the )?([a-z' -]{3,30})\??$/i) || t.match(/\bwhat(?:'s| is) (?:the )?([a-z' -]{3,30})\??$/i);
    if (m) {
      try {
        place = locations.find(m[1]) || null;
      } catch {
        place = null;
      }
    }
  }
  return { text: t, intents, question, person, topic, place, empty: !t };
}

// The answer, local. v: the Village. Returns { lines, mood, delta, intent, told?: factIds,
// mentioned?: rumorIds, topicAsked? }.
export function localReply(v, npc, text) {
  const g = v.game;
  const id = npc.id;
  const voice = voiceOf(id) || {};
  const rng = g?.rng;
  const u = understand(text, { selfId: id, locations: g?.locations });
  const st = v.standing(id);
  const playerName = g?.settings?.playerName || '';
  // They know the player's name once they have talked a little.
  const knowsPlayer = (npc.familiarity ?? 0) >= 3 || (v.talks[id]?.length ?? 0) > 0 || (npc.opinionOfPlayer ?? 30) >= 60;
  const extra = { playerName, knowsPlayer };
  const P = (pool, o = {}) => say(pool, id, 'player', { rng, extra, avoid: v.recentPlayerLines(id), ...o });
  const lines = [];
  let mood = st.opinion >= 70 ? 'warm' : st.opinion < 20 ? 'wary' : 'neutral';
  let delta = 0;
  let intent = 'unknown';
  const told = [];
  const mentioned = [];
  const asleep = npc.state === 'sleep' || npc.activity === 'sleep';
  if (asleep) {
    const l = pickProfile(npc.profile?.sleepy, rng) || 'Mmh... go away... sleeping...';
    return { lines: [l], mood: 'sleepy', delta: 0, intent: 'asleep' };
  }

  // Raw: they have heard what the player did to someone they love.
  const grave = st.grievance && st.grievance.grave && st.grievance.fresh;
  const toYou = TO_YOU[id] || {};
  const fallback = FALLBACK_TO_YOU;
  if (u.intents.has('threat')) {
    intent = 'threat';
    delta = -12;
    mood = 'angry';
    lines.push(P(voice.reply?.threat) || P(voice.no) || 'Get away from me.');
  } else if (u.intents.has('apology')) {
    intent = 'apology';
    if (st.grievance || st.opinion < 35) {
      lines.push(P(toYou.mend || fallback.mend) || P(voice.reply?.apology));
      delta = 0; // amends are applied by the village, slowly
      mood = st.opinion < 20 ? 'wary' : 'neutral';
    } else {
      lines.push(P(voice.reply?.apology) || P(voice.short));
      delta = 0.5;
      mood = 'warm';
    }
  } else if (grave && !u.intents.has('thanks')) {
    intent = u.intents.has('insult') ? 'insult' : 'cold';
    delta = u.intents.has('insult') ? -6 : 0;
    mood = 'angry';
    lines.push(P(st.grievance.victim === 'lyra' && toYou.grave ? toYou.grave : toYou.cold || fallback.cold) || P(toYou.cold || fallback.cold));
  } else if (u.intents.has('insult')) {
    intent = 'insult';
    delta = -6;
    mood = 'angry';
    lines.push(P(voice.reply?.insult) || P(voice.no));
  } else if (u.intents.has('flirt')) {
    intent = 'flirt';
    delta = st.opinion >= 60 ? 0.5 : -1;
    mood = 'amused';
    lines.push(P(voice.reply?.flirt) || P(voice.tease) || P(voice.short));
  } else if (st.cold && !u.intents.has('thanks') && !u.intents.has('compliment')) {
    intent = 'cold';
    mood = 'wary';
    lines.push(P(toYou.cold || fallback.cold));
  } else if (u.intents.has('howare')) {
    intent = 'howare';
    delta = 1;
    mood = st.opinion >= 45 ? 'warm' : 'neutral';
    const how = P(v.howAreYou(id)) || P(voice.short) || 'Well enough.';
    if (u.intents.has('greet') && rnd(rng) < 0.75) {
      const hello = P(voice.helloTo?.player || voice.hello, {}) || null;
      // A hello that asks back, or says the same thing as the answer, is left out.
      if (hello && !/\bhow (?:are|is)\b|\byou\?/i.test(hello) && !overlaps(hello, how)) lines.push(hello);
    }
    lines.push(how);
  } else if (u.intents.has('aboutme')) {
    intent = 'aboutme';
    lines.push(opinionOfYou(v, npc, P, voice, toYou, st));
  } else if (u.person) {
    intent = 'person';
    const r = aboutPerson(v, npc, u.person, P, voice);
    if (r.line) lines.push(r.line);
    if (r.topicAsked) v.emitTopic(npc, r.topicAsked);
  } else if (u.topic === 'stranger') {
    intent = 'aboutme';
    lines.push(opinionOfYou(v, npc, P, voice, toYou, st));
  } else if (u.topic) {
    intent = 'topic';
    const r = aboutTopic(v, npc, u.topic, P, voice, st);
    if (r.line) lines.push(r.line);
    told.push(...(r.told || []));
    v.emitTopic(npc, u.topic);
  } else if (u.intents.has('news')) {
    intent = 'news';
    const r = news(v, npc, P, voice, st);
    lines.push(...r.lines);
    mentioned.push(...r.mentioned);
  } else if (u.intents.has('thanks')) {
    intent = 'thanks';
    delta = 1;
    mood = 'warm';
    lines.push(P(voice.reply?.thanks) || P(voice.yes));
  } else if (u.intents.has('compliment')) {
    intent = 'compliment';
    delta = 2;
    mood = 'happy';
    lines.push(P(voice.reply?.compliment) || P(voice.warm));
  } else if (u.intents.has('work')) {
    intent = 'work';
    lines.push(P(topicPool(id, 'work')) || P(voice.about?.own) || P(voice.short));
  } else if (u.intents.has('whoami')) {
    intent = 'whoami';
    lines.push(introduce(v, npc, P, voice));
  } else if (u.place) {
    intent = 'place';
    lines.push(aboutPlace(npc, u.place, P, voice));
  } else if (u.intents.has('farewell')) {
    intent = 'farewell';
    lines.push(P(voice.reply?.farewell) || P(voice.bye));
  } else if (u.intents.has('greet')) {
    intent = 'greet';
    delta = 0.5;
    mood = st.opinion >= 45 ? 'warm' : 'neutral';
    lines.push(P(voice.helloTo?.player || voice.hello) || P(voice.short));
  } else if (u.intents.has('yes') || u.intents.has('no')) {
    intent = 'ack';
    lines.push(P(voice.short) || P(voice.yes));
  } else {
    intent = 'unknown';
    // Something they have a line about, if any word in it touches one of their topics.
    lines.push(P(voice.reply?.unknown) || P(voice.short));
  }

  // News about the player they have not raised with them yet comes up now.
  if (!['threat', 'insult', 'cold', 'news', 'farewell', 'apology'].includes(intent) && lines.length < 3) {
    const r = v.playerNews(id);
    if (r) {
      const clause = v.rumors.renderYou(r, id);
      const pool = r.valence >= 0.15 ? toYou.good || fallback.good : r.valence <= -0.15 ? toYou.bad || fallback.bad : null;
      const l = clause && pool ? fill(pickProfile(pool, rng), { you: clause }) : null;
      if (l) {
        lines.push(l);
        mentioned.push(r.id);
        if (r.valence < 0 && mood === 'warm') mood = 'neutral';
      }
    }
  }
  const out = lines.filter((l) => typeof l === 'string' && l.trim() && speakable(l));
  if (!out.length) out.push(fill(pickProfile(voice.short, rng) || 'Hm.', {}) || 'Hm.');
  return { lines: out, mood, delta, intent, told, mentioned };
}

// Do two lines share three words in a row?
function overlaps(a, b) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  const wa = words(a);
  const tri = new Set();
  for (let i = 0; i + 2 < wa.length; i++) tri.add(`${wa[i]} ${wa[i + 1]} ${wa[i + 2]}`);
  const wb = words(b);
  for (let i = 0; i + 2 < wb.length; i++) if (tri.has(`${wb[i]} ${wb[i + 1]} ${wb[i + 2]}`)) return true;
  return false;
}

function pickProfile(list, rng) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(rnd(rng) * list.length)];
}

function opinionOfYou(v, npc, P, voice, toYou, st) {
  if (st.grievance?.grave) return P(toYou.grave || toYou.cold) || P(voice.no);
  if (st.opinion >= 70) return P(voice.warm) || P(voice.yes);
  if (st.opinion < 20) return P(toYou.cold) || P(voice.no);
  if (st.opinion < 40) return P(voice.no) || P(voice.short);
  return P(voice.yes) || P(voice.short);
}

function aboutPerson(v, npc, who, P, voice) {
  const id = npc.id;
  if (who === 'maren') {
    const l = P(topicPool(id, 'maren')) || (npc.profile?.knows?.maren && speakable(npc.profile.knows.maren) ? npc.profile.knows.maren : null) || P(voice.reply?.unknown);
    return { line: l, topicAsked: 'maren' };
  }
  if (who === 'player') return { line: P(voice.short) };
  if (who === 'lyra') {
    const pool = topicPool(id, 'lyra');
    const l = P(pool);
    if (l) return { line: l, topicAsked: 'lyra' };
  }
  const bond = v.bond(id, who);
  const aff = bond?.affinity ?? 0;
  const knows = npc.profile?.knows?.[who];
  if (typeof knows === 'string' && knows && speakable(knows) && rnd(v.game?.rng) < 0.55) return { line: knows };
  const kind = aff >= 60 ? 'love' : aff >= 25 ? 'like' : aff >= -10 ? 'meh' : 'dislike';
  const pool = voice.people?.[kind] || voice.people?.meh;
  const line = pool ? say(pool, id, 'player', { rng: v.game?.rng, vars: { ...varsFor(id, 'player'), who: thirdName(id, who) } }) : null;
  return { line: line || P(voice.reply?.unknown) };
}

function aboutTopic(v, npc, topic, P, voice, st) {
  const id = npc.id;
  const fact = v.factFor(npc, topic);
  if (fact) return { line: fact.line, told: [fact.id] };
  const stance = st.opinion >= 60 ? 'good' : st.opinion < 30 ? 'bad' : 'mid';
  const pool = topicPool(id, topic, { weather: v.weatherKey(), stance });
  // Said to the player, "the stranger" lines about them become about them to their face.
  const l = pool ? say(pool, id, 'player', { rng: v.game?.rng, extra: { aboutPlayer: topic === 'stranger', playerName: '' }, vars: { ...varsFor(id, 'player'), stranger: 'you', P: 'you' } }) : null;
  return { line: l || P(voice.reply?.unknown) };
}

function news(v, npc, P, voice, st) {
  const id = npc.id;
  const out = { lines: [], mentioned: [] };
  const r = v.playerNews(id);
  if (r) {
    const clause = v.rumors.renderYou(r, id);
    const toYou = TO_YOU[id] || {};
    const pool = r.valence >= 0 ? toYou.good || FALLBACK_TO_YOU.good : toYou.bad || FALLBACK_TO_YOU.bad;
    const l = clause ? fill(pickProfile(pool, v.game?.rng), { you: clause }) : null;
    if (l) {
      out.lines.push(l);
      out.mentioned.push(r.id);
      return out;
    }
  }
  const other = v.rumors.tellable(id, 'player', v.now()).find((x) => x.about !== 'player');
  if (other) {
    const clause = v.rumors.render(other, id, { stranger: 'you' });
    const l = clause ? say(voice.rumor?.tell, id, 'player', { rng: v.game?.rng, vars: { ...varsFor(id, 'player'), rumor: clause } }) : null;
    if (l) {
      out.lines.push(l);
      out.mentioned.push(other.id);
      return out;
    }
  }
  // What the whole village is on about this week.
  const topics = WEEK_TOPICS.filter((k) => voice.about?.[k]);
  for (let i = 0; i < 3 && topics.length; i++) {
    const k = topics[Math.floor(rnd(v.game?.rng) * topics.length)];
    const l = P(topicPool(id, k));
    if (l) {
      out.lines.push(l);
      return out;
    }
  }
  out.lines.push(P(voice.about?.own) || P(voice.short));
  return out;
}

function introduce(v, npc, P, voice) {
  const own = P(topicPool(npc.id, 'work')) || P(voice.about?.own);
  const name = shortName(npc.id);
  const hello = P(voice.hello);
  if (own) return own;
  return hello || `${name}.`;
}

function aboutPlace(npc, loc, P, voice) {
  const d = String(loc?.description || '').split(/(?<=[.!?])\s/)[0];
  if (!d) return P(voice.reply?.unknown) || P(voice.short);
  const lead = P(voice.short) || '';
  return `${lead} ${d}`.trim();
}
