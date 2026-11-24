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
  // She has known every one of them all her life (LORE §7): a neighbor's replies, not a newcomer's.
  work: ['Some things never change. Good.', 'Ha. Same as ever, then.', 'Honest work. I like that.'],
  village: ['Good to know.', "I'll keep my ears open.", 'Twenty-four years in this valley, and it still surprises me.'],
  maren: ['I know. I keep asking anyway.', 'Every time I hear it, I hope it ends differently.', 'Thank you. I needed to hear it again.'],
  default: ["Huh. I wouldn't have guessed.", 'I like learning things like that.', 'Well. I never.'],
};

const QUESTIONS = {
  family: ['How are your people, {n}?', 'Everyone well at home, {n}?'],
  work: ["How's the work treating you, {n}?", 'Busy day, {n}?'],
  secret: ["You've got a look about you, {n}. What's the story?", "There's something you're not saying, {n}. Out with it."],
  village: ["What's the news, {n}?", "Heard anything I haven't, {n}?"],
  default: ["Tell me something I don't know, {n}. I dare you.", 'What keeps you busy these days, {n}?', "What's new with you, {n}?"],
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

// ---------------------------------------------------------------- facts in their own mouth

// Who is a he and who is a she, for pronouns in villagers' facts. Unknown names make a
// pronoun ambiguous, so it is left alone.
const GENDER = {
  bram: 'm', elda: 'f', pip: 'm', rowan: 'm', mira: 'f', tobias: 'm', aveline: 'f', garrick: 'm', gale: 'm',
  maren: 'f', hanna: 'f', tam: 'm', june: 'f', biscuit: 'm', varek: 'm', duchess: 'f', barnaby: 'm', lyra: 'f',
  // Round three's ten and the people of LORE §6, §7.
  hobb: 'm', wenna: 'f', hess: 'f', hesper: 'f', sabeth: 'f', beth: 'f', alder: 'm', petra: 'f', tilly: 'f', ottilie: 'f',
  tansy: 'f', corran: 'm', wys: 'm', wystan: 'm', bryn: 'f', davin: 'm', maudie: 'f', edric: 'm', ewan: 'm', jory: 'm',
  rosalind: 'f', abel: 'm', osric: 'm', nan: 'f', marl: 'm',
};
const PRONOUNS = {
  m: { subj: 'he', obj: 'him', poss: 'his', self: 'himself' },
  f: { subj: 'she', obj: 'her', poss: 'her', self: 'herself' },
};
const ADVERBS = new Set(['still', 'never', 'always', 'often', 'once', 'also', 'just', 'only', 'really', 'sometimes', 'usually', 'even', 'already', 'rarely', 'barely', 'nearly', 'almost', 'quietly', 'secretly', 'privately', 'truly', 'firmly', 'honestly']);
const FIRST_CONJ = { is: 'am', "isn't": "am not", was: 'was', "wasn't": "wasn't", are: 'am', has: 'have', does: 'do', "doesn't": "don't", "hasn't": "haven't", goes: 'go' };
const NOT_PEOPLE = new Set(['The', 'A', 'An', 'I', 'One', 'Last', 'Some', 'Before', 'After', 'When', 'If', 'From', 'Every', 'Something', 'Someone', 'Nobody', 'Ember', 'Kettle', 'Stonecut', 'Quarry', 'Whisperwood', 'Sunken', 'Ruins', 'Mirror', 'Lake', 'Reed', 'Farm', 'Hearthvale', 'Chapel', 'Hearth', 'King', 'Road', 'Glasswater', 'Brightwater', 'Border', 'Wars', 'Ironhand', 'Smithy', 'Fennick', 'Goods', 'South', 'Meadow', 'Pale', 'Reach', 'Isles', 'Saltmere', 'Lanternwright', 'Lanternwrights', 'Sir', 'Wellstone', 'Wayhouse', 'Moot', 'Lamplight', 'Lane', 'Hollowcrown', 'Crown', 'Ring', 'Owlsend', 'Cinderwick', 'Brindlecombe', 'Greywinter', 'Longwatch', 'Weeping', 'Cut', 'Captain', 'Sister', 'Bandit', 'Bandits', 'Blue', 'Wolves', 'Boars', 'Slimes', 'Moonpetals']);
const PRONOUN_WORDS = new Set(['he', 'she', 'it', 'they', 'we', 'you', 'her', 'his', 'him', 'their', 'them', 'this', 'that', 'these', 'those', 'there', 'then', 'just', 'watch', 'bring']);
const OBJECT_BEFORE = new Set(['to', 'for', 'with', 'by', 'at', 'of', 'from', 'told', 'asked', 'let', 'lets', 'made', 'makes', 'helped', 'saw', 'gave', 'pays', 'paid', 'taught', 'showed', 'sent', 'warned', 'thanked']);
const GIVING_VERBS = new Set(['bring', 'give', 'show', 'tell', 'ask', 'help', 'let', 'make', 'pay', 'send', 'lend', 'offer', 'sell', 'buy', 'teach', 'thank', 'owe', 'told', 'asked', 'gave', 'showed', 'sent', 'lent', 'paid', 'taught', 'thanked', 'warned', 'call', 'called', 'leave', 'left', 'saw', 'see']);
const NOT_NOUN_AFTER = new Set(['and', 'but', 'to', 'in', 'on', 'at', 'for', 'with', 'again', 'too', 'alone', 'that', 'the', 'a', 'an', 'out', 'up', 'off', 'back', 'home', 'anyway', 'politely', 'ever', 'once', 'now', 'then', 'so', 'or', 'about', 'into', 'from', 'by', 'when', 'if', 'how', 'what', 'who', 'not', 'go', 'be', 'blow', 'hold', 'know', 'see']);
const OBJECT_AFTER = /^(?:that|to|the|a|an|them|it|his|her|their|my|every|when|in|on|at|for|from|with|out|up|down|off|over|into|onto|nothing|something|everything|anyone|everyone|two|three|four|five|six|one)$/i;
const VERBISH = /^(?:[a-z]+(?:s|ed)|lost|made|kept|left|told|went|saw|took|gave|could|would|can|will|should|must|might|may|had|did|thinks|knows|says|was|is|has|does|doesn't|isn't|wasn't|hasn't|never|still|always|once|often|secretly|sometimes)$/;

function npcGender(npc) {
  const id = String(npc?.id || '').toLowerCase();
  if (GENDER[id]) return GENDER[id];
  const text = `${npc?.profile?.personality || ''} ${(npc?.profile?.facts || []).map((f) => f.text).join(' ')}`;
  const he = (text.match(/\b(he|him|his|himself)\b/gi) || []).length;
  const she = (text.match(/\b(she|her|hers|herself)\b/gi) || []).length;
  return he > she ? 'm' : she > he ? 'f' : null;
}

// Verb after a new "I": "has" -> "have", "pays" -> "pay", "secretly writes" -> "secretly write".
function conjugateFirst(words, i) {
  let j = i;
  while (j < words.length - 1 && (ADVERBS.has(words[j].toLowerCase()) || (/ly$/i.test(words[j]) && !/^(only|early|holy|belly|ally)$/i.test(words[j])))) j++;
  const w = words[j];
  if (!w) return words;
  const lw = w.toLowerCase();
  if (FIRST_CONJ[lw]) words[j] = FIRST_CONJ[lw];
  else if (/ed$/.test(lw) || /^(had|lost|made|kept|left|told|went|saw|took|gave|could|would|can|will|should|must|might|may|did|never|once)$/.test(lw)) return words;
  else if (/ies$/.test(lw) && lw.length > 4) words[j] = w.slice(0, -3) + 'y';
  else if (/(sses|shes|ches|xes|zes|oes)$/.test(lw)) words[j] = w.slice(0, -2);
  else if (/s$/.test(lw) && !/ss$/.test(lw)) words[j] = w.slice(0, -1);
  return words;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Bram's wife, Hanna, died of the winter fever. He still sets out two cups." told by Bram
// -> "My wife, Hanna, died of the winter fever. I still set out two cups." Lyra, the
// listener, becomes "you". Quoted words stay as they were said. Returns the text unchanged
// when it is not about the speaker.
export function toFirstPerson(fact, npc, { listener = 'Lyra' } = {}) {
  const text = String(fact || '').trim();
  if (!text || !npc?.name) return text;
  const g = npcGender(npc);
  const P = g ? PRONOUNS[g] : null;
  const full = String(npc.name).replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  const names = [...new Set([full, full.replace(/\s+[A-Z][a-z]+\s+/, ' '), firstName(full), full.split(' ')[0]].filter(Boolean))].sort((a, b) => b.length - a.length);
  const nameRe = names.map(escapeRe).join('|');
  const own = new Set(full.toLowerCase().split(' '));
  // Quoted words are someone's own and stay exactly as said.
  const quotes = [];
  const body = text.replace(/"[^"]*"|“[^”]*”/g, (q) => `qq${quotes.push(q) - 1}qq`);
  const sentences = body.split(/(?<=[.!?;])\s+/);
  const out = [];
  let prevSafe = true;
  for (const original of sentences) {
    // People named in this sentence, other than the speaker (sentence-initial words that are
    // not known names are just capitals).
    const named = [];
    original.replace(/\b[A-Z][a-z]+\b/g, (w, idx) => {
      const lw = w.toLowerCase();
      if (own.has(lw) || NOT_PEOPLE.has(w) || PRONOUN_WORDS.has(lw)) return w;
      if (idx === 0 && !GENDER[lw]) return w;
      named.push(w);
      return w;
    });
    const rival = (w) => (GENDER[w.toLowerCase()] ? GENDER[w.toLowerCase()] === g : true);
    let s = original;
    s = s.replace(new RegExp(`^(${nameRe})['’]s\\b`), 'My');
    s = s.replace(new RegExp(`\\b(${nameRe})['’]s\\b`, 'g'), 'my');
    let words = s.split(' ');
    const startName = new RegExp(`^(${nameRe})$`);
    let subject = false;
    for (const n of names) {
      const k = n.split(' ').length;
      if (k > 1 && words.slice(0, k).join(' ') === n) {
        words = ['I', ...words.slice(k)];
        subject = true;
        break;
      }
    }
    if (!subject && startName.test(words[0])) {
      words[0] = 'I';
      subject = true;
    }
    if (!subject && P && prevSafe && words[0] && words[0].toLowerCase() === P.subj) {
      words[0] = 'I';
      subject = true;
    }
    // Later mentions: "Last spring Rowan lost" -> "I lost"; "Elda took Pip in" -> "me".
    for (let i = 1; i < words.length; i++) {
      const bare = words[i].replace(/[,.!?;:]+$/, '');
      if (!startName.test(bare)) continue;
      const tail = words[i].slice(bare.length);
      const next = (words[i + 1] || '').toLowerCase().replace(/[,.!?;:]+$/, '');
      const prev = (words[i - 1] || '').toLowerCase().replace(/[^a-z']/g, '');
      const asSubject = VERBISH.test(next) && !OBJECT_BEFORE.has(prev);
      words[i] = `${asSubject ? 'I' : 'me'}${tail}`;
    }
    s = words.join(' ');
    // The speaker's own pronouns, unless another he (or she) was named before them.
    if (P) {
      const re = new RegExp(`\\b(${P.subj}|${P.obj}|${P.poss}|${P.self})\\b`, 'gi');
      const lis = listener && GENDER[String(listener).toLowerCase()] === g ? String(listener) : null;
      s = s.replace(re, (m, pr, idx) => {
        const head = s.slice(0, idx);
        const p = pr.toLowerCase();
        const cap = idx === 0 && pr[0] !== p[0];
        // Said right after the listener's name, it is the listener: "show her" -> "show you".
        if (lis && head.lastIndexOf(lis) >= 0 && head.lastIndexOf(lis) > Math.max(...named.filter((w) => w !== lis).map((w) => head.lastIndexOf(w)), -1) && head.lastIndexOf(lis) > Math.max(head.lastIndexOf(' I '), head.lastIndexOf(' me'), head.lastIndexOf('my '))) {
          if (p === P.self) return 'yourself';
          if (p === P.subj) return cap ? 'You' : 'you';
          return p === P.poss && p !== P.obj ? 'your' : 'you';
        }
        const anchored = /\b(I|me|my|My)\b/.test(head);
        if (named.some((w) => w !== lis && rival(w) && head.includes(w))) return m;
        if (!anchored && !prevSafe) return m;
        if (p === P.self) return cap ? 'Myself' : 'myself';
        if (p === P.subj) return 'I';
        const after = s.slice(idx + pr.length).match(/^\s+([a-z']+)/);
        const nextWord = after ? after[1] : '';
        const before = (head.match(/([a-z']+)\s*$/i) || [])[1]?.toLowerCase() || '';
        if (p === P.poss && p !== P.obj) return cap ? 'My' : 'my';
        // "her": "her shop" is "my shop"; "show her", "tell her the truth" is "me".
        const objectVerb = GIVING_VERBS.has(before);
        const poss = p === P.poss && nextWord && !objectVerb && !NOT_NOUN_AFTER.has(nextWord);
        return poss ? (cap ? 'My' : 'my') : 'me';
      });
    }
    // Verbs after a new "I": "I still sets" -> "I still set", "and hides them" -> "and hide them".
    s = s.replace(/\bI ((?:[a-z]+ly |never |still |always |often |also |once |just |only |even |already |sometimes ){0,2})([a-z']+)\b/g, (m, adv, verb) => `I ${adv}${firstPersonVerb(verb)}`);
    if (/\bI\b/.test(s)) {
      s = s.replace(/\b(and|but) ((?:[a-z]+ly |never |still |always |often |also |once |just |only |even |sometimes ){0,2})([a-z]+?(?:es|s))\b(?=(\s+\S+|$))/g, (m, conj, adv, verb, rest) => {
        const next = (rest || '').trim().replace(/[^a-z]/gi, '');
        if (/ss$|us$|is$/.test(verb)) return m;
        if (next && !OBJECT_AFTER.test(next) && !/^[A-Z]/.test(next) && !/^qq\d+qq$/.test((rest || '').trim())) return m;
        return `${conj} ${adv}${firstPersonVerb(verb)}`;
      });
    }
    // The listener: "Lyra" is "you" when they are talking to her.
    if (listener) {
      const L = escapeRe(listener);
      s = s.replace(new RegExp(`\\b${L}['’]s\\b`, 'g'), 'your');
      s = s.replace(new RegExp(`\\b${L}\\s+(is|was|has|does|isn't|wasn't|hasn't|doesn't)\\b`, 'g'), (m, verb) => `you ${CONJ[verb.toLowerCase()]}`);
      s = s.replace(new RegExp(`\\b${L}\\b`, 'g'), 'you');
    }
    if (/^[A-Z]/.test(original)) s = s.replace(/^(you|my|me)\b/, (w) => w[0].toUpperCase() + w.slice(1));
    prevSafe = !named.some(rival);
    out.push(s);
  }
  let result = out.join(' ').replace(/qq(\d+)qq/g, (m, i) => quotes[Number(i)] ?? m).replace(/\s+/g, ' ').trim();
  // "I say they dull a pick" is how a report reads, not how anyone talks.
  result = result.replace(/(^|[.!?]\s+)I say to /g, '$1My advice: ').replace(/(^|[.!?]\s+)I say (?:that )?(\S)/g, (m, lead, c) => `${lead}${c.toUpperCase()}`);
  if (/^My advice|^[A-Z]/.test(result) && !/\bI say\b/.test(result)) result = result.replace(/, and that /, ', and ');
  return result ? result[0].toUpperCase() + result.slice(1) : result;
}

// "Bram has kept the forge..." -> "he has kept the forge...": a fact about someone, retold
// by Lyra after they told it to her.
export function retold(fact, npc) {
  const text = String(fact || '').trim();
  if (!text || !npc?.name) return text;
  const g = npcGender(npc);
  const P = g ? PRONOUNS[g] : { subj: 'they', obj: 'them', poss: 'their' };
  const full = String(npc.name).replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  const names = [...new Set([full, firstName(full), full.split(' ')[0]])].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return text
    .replace(new RegExp(`^(${names})['’]s\\b`), P.poss)
    .replace(new RegExp(`^(${names})\\b`), P.subj)
    .replace(new RegExp(`\\b(${names})['’]s\\b`, 'g'), P.poss)
    .replace(new RegExp(`\\b(${names})\\b`, 'g'), P.obj);
}

// A third-person present verb as "I" would say it.
function firstPersonVerb(verb) {
  const lw = verb.toLowerCase();
  if (FIRST_CONJ[lw]) return FIRST_CONJ[lw];
  if (lw.length <= 2 || /(ss|us|is|ous)$/.test(lw) || /ed$/.test(lw)) return verb;
  if (/ies$/.test(lw) && lw.length > 4) return verb.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes|oes)$/.test(lw)) return verb.slice(0, -2);
  if (/s$/.test(lw)) return verb.slice(0, -1);
  return verb;
}

// A fact from a villager's profile, as they would say it to Lyra.
export function inTheirWords(fact, npc, game = null) {
  const text = profileLine(String(fact || ''), game);
  if (isFirstPerson(text) && !new RegExp(`\\b${String(firstName(npc?.name || '')).replace(/[^a-z]/gi, '')}\\b`).test(text)) return text;
  return toFirstPerson(text, npc, { listener: game?.settings?.companionName || 'Lyra' });
}

const MAREN_PROMPTS = ['Go on. Please.', 'What else? Anything at all.', 'And then?'];
const MAREN_THANKS = ['Thank you. Truly. That is more than I had this morning.', "That's her. That is so exactly her. Thank you.", 'Every scrap helps. I mean it. Thank you.'];

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
// Who may be told a fact (LORE §9.10, DESIGN §19.1): never someone in its `hiddenFrom`;
// and when it carries a `knownBy`, only those it names (or 'everyone') learn it from talk.
// The player is the exception the LORE makes: they can still learn secrets Lyra never is
// told, so for them only `hiddenFrom` applies.
export function factHiddenFrom(f, listener = 'lyra') {
  if (!f) return true;
  const who = String(listener || 'lyra');
  if (Array.isArray(f.hiddenFrom) && f.hiddenFrom.includes(who)) return true;
  if (who !== 'lyra') return false;
  return Array.isArray(f.knownBy) && !f.knownBy.includes(who) && !f.knownBy.includes('everyone');
}

// The facts a villager would share with Lyra now (her familiarity with them, the topic).
export function availableFacts(npc, rel, topic = null, { listener = 'lyra' } = {}) {
  const facts = Array.isArray(npc?.profile?.facts) ? npc.profile.facts : [];
  const fam = rel?.familiarity ?? 0;
  const topicKey = topic ? topicOfText(topic) : null;
  const q = topic ? tokenSet(topic) : null;
  const out = [];
  for (const f of facts) {
    if (!f || !f.text) continue;
    if (factHiddenFrom(f, listener)) continue;
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
  if (lvl <= 1) return fill(pick(['{tg}, {n}. Got a moment for a nosy neighbor?', '{n}! Mind if I bother you for a bit?', 'Hello, {n}. I hope I am not interrupting.'], rng), vars);
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
      facts.slice(0, 2).forEach((f, i) => {
        lines.push({ speaker: 'npc', text: inTheirWords(f.text, npc, game) });
        if (i === 0 && facts.length > 1) lines.push({ speaker: 'lyra', text: pick(MAREN_PROMPTS, rng) });
        learned.push({ text: f.text, about: 'maren' });
      });
      lines.push({ speaker: 'lyra', text: pick(MAREN_THANKS, rng) });
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
    // She already asked about the topic in her opening line.
    if (!topic) lines.push({ speaker: 'lyra', text: fill(pick(QUESTIONS[ft], rng), { n }) });
    const said = inTheirWords(fact.text, npc, game);
    // A secret or a sorrow gets a lead-in, the way people really tell them.
    const lead = fact.topic === 'secret' || fact.topic === 'family' ? `${pick(LEAD_INS[fact.topic], rng)} ` : '';
    lines.push({ speaker: 'npc', text: `${lead}${said}` });
    lines.push({ speaker: 'lyra', text: pick(REACTIONS[REACTIONS[fact.topic] ? fact.topic : 'default'], rng) });
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
