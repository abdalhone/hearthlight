import { firstName, normName, pick, tokenSet, shorten, cap } from './text.js';
import { MAREN_TESTIMONY, MAREN_OPENERS } from './maren.js';
import { bondOf } from './relationships.js';

// Lyra's offline conversations with villagers. Built from the NPC profile (greetings,
// lines, knows, and facts her familiarity allows) and her own voice.
// Returns { lines: [{ speaker: 'lyra'|'npc', text }], learned: [{ text, about }], affinity, topic }.

const LEAD_INS = {
  secret: ['Can you keep a secret?', 'Between you and me...', "Don't tell a soul, mind."],
  family: ["You'd not know it to look at me, but...", "Family's a long story. Since you ask...", 'Well. Since you ask...'],
  work: ["Here's a thing most folk don't know about my trade...", "Work's work. But I'll tell you this..."],
  village: ["You'll hear it soon enough, so...", "Here's how things stand in Hearthvale..."],
  default: ['Well, since you ask...', 'Funny you should ask...', 'Now there is a question...'],
};

const REACTIONS = {
  secret: ['Your secret is safe with me.', "I won't tell a soul. Not even the cat.", 'That stays between us. I promise.'],
  family: ["I'm so sorry.", 'That must be heavy to carry.', 'Thank you for telling me.'],
  work: ["I'd love to see that someday.", "That's wonderful.", 'Honest work. I like that.'],
  village: ['Good to know.', "I'll keep my ears open.", 'Huh. This valley keeps surprising me.'],
  default: ["Huh. I wouldn't have guessed.", 'I like learning things like that.', 'Well. I never.'],
};

const QUESTIONS = {
  family: ['Do you have family here, {n}?', 'Who do you go home to, {n}?'],
  work: ["How's work treating you, {n}?", 'What does a day look like for you, {n}?'],
  secret: ["You've got a look about you, {n}. What's the story?", "There's something you're not saying, {n}. Out with it."],
  village: ["What's the news in Hearthvale?", 'Anything I should know about this place, {n}?'],
  default: ['Tell me something about yourself I don\'t know.', 'What keeps you busy, {n}?', 'Tell me something about this valley.'],
};

const CLOSERS = {
  warm: ['Thanks, {n}. Truly.', "I'll let you get back to it.", 'Same time tomorrow?'],
  close: ["You're a treasure, {n}. Don't let it go to your head.", 'Look after yourself, {n}. I mean it.'],
  sad: ['Thank you, {n}.', "I'll leave you be."],
};

function timeGreeting(game) {
  const h = game?.clock?.hour ?? 12;
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

// Replace player placeholders a profile line may carry.
function profileLine(text, game) {
  const name = game?.settings?.playerName || game?.player?.name || 'traveler';
  return String(text)
    .replace(/\{player\}|\{name\}|\{playerName\}/gi, name)
    .replace(/\{lyra\}|\{companion\}/gi, game?.settings?.companionName || 'Lyra');
}

export function isFirstPerson(text) {
  return /\b(I|I'm|I've|I'd|I'll|my|me|mine|myself)\b/.test(String(text));
}

const CONJ = {
  is: 'are',
  was: 'were',
  has: 'have',
  does: 'do',
  "isn't": "aren't",
  "wasn't": "weren't",
  "doesn't": "don't",
  "hasn't": "haven't",
  goes: 'go',
};

function conjugate(word) {
  const w = word.toLowerCase();
  if (CONJ[w]) return CONJ[w];
  if (/ed$/.test(w) || /^(had|lost|made|kept|left|told|went|saw|took|gave|could|would|can|will|should|must|never|once)$/.test(w)) return word;
  if (/ies$/.test(w) && w.length > 4) return word.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes|oes)$/.test(w)) return word.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return word.slice(0, -1);
  return word;
}

// "Bram writes poetry at night." spoken to Bram -> "You write poetry at night."
// Returns null when the sentence is not about the listener or cannot be turned safely.
export function toSecondPerson(fact, npc) {
  const text = String(fact || '').trim();
  if (!text || !npc?.name) return null;
  const names = [npc.name, firstName(npc.name), npc.name.split(/\s+/)[0]].filter(Boolean).sort((a, b) => b.length - a.length);
  let rest = null;
  let possessive = false;
  for (const n of names) {
    const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['’]s)?\\b\\s*`, 'i');
    const m = text.match(re);
    if (m) {
      rest = text.slice(m[0].length);
      possessive = !!m[1];
      break;
    }
  }
  if (rest == null || !rest) return null;
  // Other capitalized names make pronoun swaps unsafe.
  const otherNames = rest.match(/\b[A-Z][a-z]{2,}/g) || [];
  const pronounSafe = otherNames.length === 0;
  let out;
  if (possessive) {
    out = `Your ${rest}`;
  } else {
    const words = rest.split(/\s+/);
    let i = 0;
    while (i < words.length - 1 && /ly$/i.test(words[i]) && !/^(only|early|holy)$/i.test(words[i])) i++;
    words[i] = conjugate(words[i]);
    out = `You ${words.join(' ')}`;
  }
  if (pronounSafe) {
    out = out
      .replace(/\b(his|her)\b(?=\s+[a-z])/g, 'your')
      .replace(/\b(himself|herself)\b/g, 'yourself')
      .replace(/\b(he|she)\b/g, 'you');
  }
  return out;
}

function echoFact(fact, npc) {
  const second = toSecondPerson(fact, npc);
  const base = (second || fact).replace(/[.!]+$/, '');
  return `${cap(base)}?`;
}

function topicOfText(topic) {
  const t = normName(topic);
  if (!t) return null;
  if (/\bmaren\b|mentor|teacher|grey cloak/.test(t)) return 'maren';
  if (/famil|wife|husband|son|daughter|mother|father|parent|kid|child|brother|sister/.test(t)) return 'family';
  if (/work|job|trade|forge|smith|shop|farm|herb|inn|guard|chapel/.test(t)) return 'work';
  if (/secret|hidden|poem|poetry|crush|love/.test(t)) return 'secret';
  if (/village|town|hearthvale|news|gossip|bandit|ruins|road/.test(t)) return 'village';
  return t;
}

function knownNote(rel, text) {
  const n = normName(text);
  return rel?.notes?.some((x) => normName(x.text) === n);
}

// Facts this NPC would share at Lyra's familiarity, best first.
export function availableFacts(npc, rel, topic = null) {
  const facts = Array.isArray(npc?.profile?.facts) ? npc.profile.facts : [];
  const fam = rel?.familiarity ?? 0;
  const topicKey = topic ? topicOfText(topic) : null;
  const q = topic ? tokenSet(topic) : null;
  const out = [];
  for (const f of facts) {
    if (!f || !f.text) continue;
    const need = Number(f.minFamiliarity) || 0;
    // A direct question unlocks things a little early.
    if (need > fam + (topic ? 10 : 0)) continue;
    if (knownNote(rel, f.text)) continue;
    let score = 1 - need / 200;
    if (topicKey && f.topic === topicKey) score += 2;
    if (q && q.size) {
      const ft = tokenSet(`${f.text} ${f.topic || ''}`);
      let hits = 0;
      for (const w of q) if (ft.has(w)) hits++;
      score += hits;
      if (topicKey && f.topic !== topicKey && !hits) score -= 1.5;
    }
    out.push({ fact: f, score });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.fact);
}

function npcLineFor(npc, game, rng) {
  const p = npc?.profile || {};
  const lines = p.lines || {};
  const w = game?.clock?.weather?.type;
  let pool = null;
  if (w === 'rain' && lines.rain?.length) pool = lines.rain;
  else if (game?.clock?.isNight && lines.night?.length) pool = lines.night;
  else if (lines.day?.length) pool = lines.day;
  if (!pool && Array.isArray(lines)) pool = lines;
  return pool?.length ? profileLine(pick(pool, rng), game) : null;
}

function npcGreeting(npc, game, rng) {
  const g = npc?.profile?.greetings;
  if (Array.isArray(g) && g.length) return profileLine(pick(g, rng), game);
  return `${timeGreeting(game)}, Lyra.`;
}

function lyraOpener(mind, npc, rel, topic, rng) {
  const game = mind.game;
  const n = firstName(npc.name);
  const lvl = bondOf(rel).level;
  const mood = mind.mood();
  const vars = { n, tg: timeGreeting(game) };
  if (topic && topicOfText(topic) !== 'maren') {
    return fill(pick([`{n}, I've been meaning to ask you about ${topic}.`, `Got a moment, {n}? I'm curious about ${topic}.`], rng), vars);
  }
  if (mood.valence < -0.2) return fill(pick(['{tg}, {n}.', 'Hello, {n}. Mind some company?'], rng), vars);
  if (lvl <= 1) return fill(pick(['{tg}, {n}. Got a moment for a nosy ranger?', '{n}! Mind if I bother you for a bit?', 'Hello, {n}. I hope I am not interrupting.'], rng), vars);
  if (lvl <= 3) return fill(pick(['{n}! There you are.', '{tg}, {n}. How goes it?', 'There\'s my favorite {role}.'], rng), { ...vars, role: (npc.role || rel.role || 'neighbor').toLowerCase() });
  return fill(pick(["{n}! Best part of my day, right here. Don't tell the others.", '{tg}, {n}. I saved you a smile.'], rng), vars);
}

// Build a full local conversation.
export function localConversation(mind, npc, topic = null) {
  const game = mind.game;
  const rng = game?.rng;
  const rel = mind.relationships.ensure(npc);
  const n = firstName(npc.name);
  const lines = [];
  const learned = [];
  const topicKey = topic ? topicOfText(topic) : null;

  if (topicKey === 'maren') {
    const facts = availableFacts(npc, { ...rel, familiarity: rel.familiarity + 30 }, 'maren').filter((f) => f.topic === 'maren' || /maren/i.test(f.text));
    lines.push({ speaker: 'lyra', text: pick(MAREN_OPENERS, rng) });
    if (facts.length) {
      for (const f of facts.slice(0, 2)) {
        if (isFirstPerson(f.text)) lines.push({ speaker: 'npc', text: profileLine(f.text, game) });
        else {
          lines.push({ speaker: 'npc', text: pick(LEAD_INS.village, rng) });
          lines.push({ speaker: 'lyra', text: echoFact(f.text, npc) });
        }
        learned.push({ text: f.text, about: 'maren' });
      }
      lines.push({ speaker: 'lyra', text: 'Thank you. Truly. That is more than I had this morning.' });
    } else if (MAREN_TESTIMONY[npc.id]) {
      const t = MAREN_TESTIMONY[npc.id];
      for (const l of t.npc) lines.push({ speaker: 'npc', text: l });
      lines.push({ speaker: 'lyra', text: t.lyra });
      learned.push({ text: t.learned, about: 'maren' });
    } else {
      lines.push({ speaker: 'npc', text: "I'm sorry, I don't know the name. I hope you find her." });
      lines.push({ speaker: 'lyra', text: 'Thank you anyway. Someone in this valley saw something.' });
    }
    return { lines, learned, affinity: 3, topic: 'maren' };
  }

  // Asking one villager about another: their opinion, from `knows`.
  const other = topic ? mind.relationships.get(topic) : null;
  const knows = other && npc.profile?.knows?.[other.id];
  if (other && other.id !== npc.id && knows) {
    lines.push({ speaker: 'lyra', text: `What do you make of ${firstName(other.name)}, ${n}?` });
    lines.push({ speaker: 'npc', text: profileLine(knows, game) });
    lines.push({ speaker: 'lyra', text: pick(['Huh. Good to know.', "That's fair.", "I'll remember that."], rng) });
    learned.push({ text: `${n} on ${firstName(other.name)}: "${shorten(profileLine(knows, game), 140)}"`, about: other.id });
    return { lines, learned, affinity: 2, topic };
  }

  lines.push({ speaker: 'lyra', text: lyraOpener(mind, npc, rel, topic, rng) });
  lines.push({ speaker: 'npc', text: npcGreeting(npc, game, rng) });

  const fact = availableFacts(npc, rel, topic)[0] || null;
  if (fact) {
    const ft = fact.topic && QUESTIONS[fact.topic] ? fact.topic : 'default';
    lines.push({ speaker: 'lyra', text: fill(pick(QUESTIONS[ft], rng), { n }) });
    if (isFirstPerson(fact.text)) {
      lines.push({ speaker: 'npc', text: profileLine(fact.text, game) });
      lines.push({ speaker: 'lyra', text: pick(REACTIONS[REACTIONS[fact.topic] ? fact.topic : 'default'], rng) });
    } else {
      lines.push({ speaker: 'npc', text: pick(LEAD_INS[LEAD_INS[fact.topic] ? fact.topic : 'default'], rng) });
      lines.push({ speaker: 'lyra', text: `${echoFact(fact.text, npc)} ${pick(REACTIONS[REACTIONS[fact.topic] ? fact.topic : 'default'], rng)}` });
    }
    learned.push({ text: fact.text, about: npc.id });
  } else {
    const extra = npcLineFor(npc, game, rng);
    if (extra) lines.push({ speaker: 'npc', text: extra });
    lines.push({ speaker: 'lyra', text: fill(pick(rel.familiarity > 50 ? CLOSERS.close : CLOSERS.warm, rng), { n }) });
    return { lines, learned, affinity: 2, topic };
  }
  const mood = mind.mood();
  const closer = mood.valence < -0.2 ? CLOSERS.sad : bondOf(rel).level >= 3 ? CLOSERS.close : CLOSERS.warm;
  lines.push({ speaker: 'lyra', text: fill(pick(closer, rng), { n }) });
  return { lines, learned, affinity: 3, topic };
}

// A two- or three-line hello while passing by.
export function smallTalk(mind, npc) {
  const game = mind.game;
  const rng = game?.rng;
  const rel = mind.relationships.ensure(npc);
  const n = firstName(npc.name);
  const lvl = bondOf(rel).level;
  const tg = timeGreeting(game);
  const w = game?.clock?.weather?.type;
  const opener = pick(
    [
      lvl >= 3 ? `${n}! Good to see you.` : `${tg}, ${n}.`,
      w === 'rain' ? `Wet enough for you, ${n}?` : w === 'fog' ? `Can you see your own boots in this fog, ${n}?` : `Lovely ${tg === 'Evening' ? 'evening' : 'day'} for it, ${n}.`,
      lvl >= 2 ? `There's ${n}. How are you keeping?` : `Hello again, ${n}.`,
    ],
    rng,
  );
  const lines = [{ speaker: 'lyra', text: opener }, { speaker: 'npc', text: npcGreeting(npc, game, rng) }];
  const extra = npcLineFor(npc, game, rng);
  const roll = rng?.next ? rng.next() : Math.random();
  if (extra && roll < 0.6) lines.push({ speaker: 'npc', text: extra });
  return { lines, learned: [], affinity: 1, topic: 'small talk' };
}

// Lyra talking to an animal: one-sided, but she means every word.
export function animalTalk(mind, animal) {
  const rng = mind.game?.rng;
  const sp = String(animal?.species || 'creature');
  const name = animal?.name && !/^(cat|chicken|deer|rabbit|boar)$/i.test(animal.name) ? animal.name : null;
  const call = name || `little ${sp}`;
  const sets = {
    cat: [`Hello, ${call}.`, "No, I don't have fish. Stop looking at me like that.", '...Fine. One scratch behind the ears. One.'],
    chicken: [`Good ${mind.game?.clock?.isNight ? 'evening' : 'morning'}, ${call}.`, 'You are very loud for something so round.'],
    deer: [`Easy, ${call}. Nobody's hunting you today.`, 'Go on. The meadow is yours.'],
    rabbit: [`Hello, ${call}. Don't mind me.`, 'Stay out of Tobias\'s turnips and we\'ll get along fine.'],
  };
  const lines = (sets[sp] || [`Hello there, ${call}.`, 'You and me, we understand each other.']).map((text) => ({ speaker: 'lyra', text }));
  return { lines, learned: [], affinity: 2, topic: 'animal', animal: true };
}
