// The offline mind's diary: a heartfelt first-person entry built from the day's real
// memories, her mood, her bond with the player and what she is reaching for next. It is
// her private voice about her day: the player is written about, never written to.

import { moodKey, bondLevel, lowerFirst, bare, tidy } from './speech_gen.js';
import { soulOf } from './soul_fallback.js';
import { companionshipOf, ledgerOf } from './her_state.js';

const OPENERS = {
  happy: [
    'Today was a good one. I keep smiling about it, which is ridiculous.',
    "A bright day. I don't trust bright days, but I'll take this one.",
    'I have ink on my fingers and I am grinning like a fool. Good day.',
  ],
  calm: [
    'A steady day, the kind Maren used to call honest work.',
    'Not much drama today. My feet ache in the satisfying way.',
    "Quiet entry tonight. That's alright. Quiet days count too.",
  ],
  low: [
    "Hard day. I'm writing anyway, because Maren said the bad days need it most.",
    'Heavy heart tonight. Let me put some of it down here so I can sleep.',
    "I don't feel much like writing. I'm doing it anyway.",
  ],
  tense: [
    'My hands still aren\'t quite steady as I write this.',
    "I keep listening for footsteps outside. Writing helps. A little.",
  ],
  angry: [
    "I'm still angry, so forgive the scratchy handwriting.",
    'I nearly broke the pen nib tonight. Breathe, Lyra.',
  ],
};

// When in the day a memory happened, for the way she tells it ("This afternoon I...").
function partOf(t) {
  if (!Number.isFinite(t)) return null;
  const h = ((((t % DAY) + DAY) % DAY) / DAY) * 24;
  if (h < 5) return 'Last night';
  if (h < 12) return 'This morning';
  if (h < 17) return 'This afternoon';
  if (h < 21) return 'This evening';
  return 'Tonight';
}

const DAY = 900;
const TIME_START = /^(?:today|this (?:morning|afternoon|evening)|tonight|last night|at (?:dawn|dusk|noon)|two days ago|yesterday)\b/i;
// Words that may start a sentence without being a name: lowered after "This morning".
const COMMON_START = /^(?:The|A|An|We|It|There|That|This|Then|One|Two|Some|My|Our|His|Her|Their|After|Before|When|While|At|In|On|Most|All|Nobody|Everyone|Someone|Something|Nothing|Got|Paid|Found|Gave|Saw|Took|Had|Went)\b/;

// Her memories are sometimes written to the player ("I warned you: ..."). Her diary is
// her own: the player is "Ash" or "the traveler", never "you" (quoted words stay as said).
export function privateVoice(text, playerName = 'the traveler') {
  const name = String(playerName || 'the traveler');
  const parts = String(text || '').split(/("[^"]*"|“[^”]*”)/);
  let named = false;
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\byou're\b/gi, "they're")
      .replace(/\byou've\b/gi, "they've")
      .replace(/\byou'll\b/gi, "they'll")
      .replace(/\byou'd\b/gi, "they'd")
      .replace(/\byourself\b/gi, 'themselves')
      .replace(/\byours\b/gi, 'theirs')
      .replace(/\byour\b/gi, (m) => {
        if (!named) {
          named = true;
          return `${name}'s`;
        }
        return m[0] === 'Y' ? 'Their' : 'their';
      })
      .replace(/(^|[.!?]\s+|\b(?:and|but|when|if|that|because|so|while|until)\s+)?\byou\b/gi, (m, lead) => {
        const subject = lead != null;
        let word;
        if (!named) {
          named = true;
          word = name;
        } else word = subject ? 'they' : 'them';
        if (lead && /[.!?]\s+$|^$/.test(lead) && /^[a-z]/.test(word)) word = word[0].toUpperCase() + word.slice(1);
        return `${lead || ''}${word}`;
      });
  }
  return parts.join('').replace(/\bthey (was|is|has)\b/g, (m, v) => `they ${v === 'was' ? 'were' : v === 'is' ? 'are' : 'have'}`);
}

function lowerStart(text) {
  return COMMON_START.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

// A note rather than a sentence ("First time at the mill."): set off after the time of day.
const FRAGMENT_START = /^(?:First|Back|Finally|Another|Still|Just|Nearly|Almost|No|Not)\b/;
function whenSaid(part, text) {
  if (FRAGMENT_START.test(text)) return `${part}: ${text[0].toLowerCase()}${text.slice(1)}`;
  return `${part} ${lowerStart(text)}`;
}

const EMOTION_REFLECTIONS = {
  joy: ["That made me happier than I'll admit out loud.", 'I laughed. Properly laughed.'],
  sadness: ["That one still sits heavy in me.", 'I miss things I can\'t name when that happens.'],
  fear: ["I was more scared than I let on.", 'My heart is still racing a little, remembering it.'],
  anger: ["I'm still angry about it.", 'Some things should make you angry. That was one.'],
  trust: ["I think I trust a little more after that.", 'It felt like solid ground.'],
  affection: ['It made me feel warm all the way through.', "I'm fond of these people. Too fond, maybe."],
  pride: ["I'm proud of that. Let me have it.", 'Maren would have nodded. Just once. That\'s high praise.'],
  curiosity: ['I want to know more. I always want to know more.', 'It keeps tugging at my thoughts.'],
  surprise: ["I didn't see that coming.", 'Still turning it over.'],
  embarrassment: ['My ears are burning just writing it down.', 'Nobody needs to read this part. Ever.'],
};

const PLAYER_LINES = [
  // bond 0-1
  [
    "I still don't know what to make of {player}. They fight like someone with nothing to lose, and they keep coming back for me anyway.",
    "{player} is hard to read. I like that more than I should.",
  ],
  // bond 2-3
  [
    '{player} made me laugh today. I am keeping count, and I am not telling them.',
    "Travelling with {player} is getting easy. Too easy. I'll have to start worrying about that.",
  ],
  // bond 4-5
  [
    "I'm glad it's {player} beside me. I don't say it enough. I don't say it at all, actually.",
    "If anything happens in those ruins, I want {player} to know they were the best part of this.",
  ],
];

const COLD_PLAYER = ["{player} was unkind today. I don't know what I did. Maybe nothing.", "I'm hurt, and it was {player} who did it. I'll sleep on it."];

// How things stand with the player colors the entry (DESIGN §16.3).
const STATE_LINES = {
  wary: [
    "I'm keeping one eye on {player} now. I hate that I have to.",
    'I still walk beside {player}. Just not as close. I need to see who they really are.',
  ],
  apart: [
    'I spent the day on my own business. It felt good to choose my own road for once.',
    "I didn't see much of {player} today. I had my own life to see to, and that's alright.",
  ],
  left: [
    "I'm writing this in a rented room at the Ember Kettle, away from {player}. It's quieter here. It's also lonelier.",
    "I left {player} today. I keep checking that the door is locked, and I hate that most of all.",
  ],
};

const DEED_WORDS = {
  hit_lyra: 'hit me', hit_lyra_accident: 'caught me with their blade by accident', downed_lyra: 'knocked me out',
  abandoned_downed: 'left me lying on the ground', attacked_villager: 'attacked one of the villagers', downed_villager: 'beat a villager senseless',
  attacked_guard: 'attacked a guard', stole: 'stole', lied: 'lied to me', broke_promise: 'broke a promise to me', killed_harmless: 'killed a harmless creature',
  reckless_order: 'nearly got me killed', protected_lyra: 'saved my life', revived_lyra: 'came back for me when I was down',
  gift_loved: 'gave me something I love', kept_promise: 'kept their word', kindness: 'was kind when no one made them',
};

function deedLine(game, playerName, day, rnd) {
  const today = ledgerOf(game, 12).filter((d) => d && (d.day == null || d.day === day) && Number.isFinite(d.severity));
  if (!today.length) return null;
  const worst = today.reduce((a, b) => (b.severity < a.severity ? b : a));
  const best = today.reduce((a, b) => (b.severity > a.severity ? b : a));
  const words = (d) => DEED_WORDS[d.deed] || (d.text ? lowerFirst(bare(d.text)) : null);
  if (worst.severity <= -2 && words(worst)) {
    return pick([`${playerName} ${words(worst)}. I can't stop seeing it.`, `I keep coming back to it: ${playerName} ${words(worst)}.`], rnd);
  }
  if (best.severity >= 2 && words(best)) {
    return pick([`And ${playerName} ${words(best)}. I keep thinking about that.`, `${playerName} ${words(best)}. I won't forget it.`], rnd);
  }
  return null;
}

const CLOSERS = {
  rain: ['The rain is soft on the roof. Goodnight.', 'Rain on the shutters. My favorite lullaby. Goodnight.'],
  clear: ['The stars are out. I counted eleven before I gave up. Goodnight.', 'Clear sky tonight. Maren, if you can see these stars too — hold on.'],
  fog: ['Fog against the window, thick as wool. Goodnight.'],
  cloudy: ['No stars tonight. Tomorrow, maybe. Goodnight.'],
};

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length) % list.length];
}

const STOP = new Set(['the', 'and', 'that', 'with', 'this', 'they', 'them', 'their', 'then', 'have', 'from', 'about', 'what', 'when', 'were', 'was', 'for', 'not', 'but', 'too', 'just', 'very', 'traveler', 'today', 'you', 'your', 'her', 'him', 'his', 'she', 'had', 'did', 'has', 'our', 'who', 'are', 'its', 'one', 'all', 'out', 'got']);

function words(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

// Two memories of one moment (the mind may note a gift twice): keep the first.
function distinct(list) {
  const out = [];
  const seen = [];
  for (const m of list) {
    const w = words(m.text);
    const dup = seen.some((s) => {
      let both = 0;
      for (const x of w) if (s.has(x)) both++;
      return both / Math.max(1, Math.min(w.size, s.size)) >= 0.6;
    });
    if (dup) continue;
    seen.push(w);
    out.push(m);
  }
  return out;
}

// Does a deed line retell a memory ("gave me something I love" / "gave me a honey cake")?
function overlaps(memoryText, line, playerName = '') {
  const a = words(memoryText);
  const name = String(playerName || '').toLowerCase();
  for (const w of words(line)) if (w !== name && a.has(w)) return true;
  return false;
}

function sentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return /[.!?…]["”’')]*$/.test(t) ? t : `${t}.`;
}

// memories: [{text, importance, emotion, about}] most important first.
export function composeDiary(game, memories = [], { day, rnd = Math.random } = {}) {
  const mind = game?.companion?.mind;
  const mood = moodKey(mind);
  const bond = bondLevel(mind);
  const soul = soulOf(game);
  // The default name reads as a title in prose: "the traveler", as her memories say it.
  const named = String(game?.settings?.playerName || '').trim();
  const playerName = !named || /^traveler$/i.test(named) ? 'the traveler' : named;
  const parts = [];
  parts.push(pick(OPENERS[mood] || OPENERS.calm, rnd));

  // The day's three most important moments, told in the order they happened, in her own
  // private voice (DESIGN §13 reflection; the diary is hers, not a letter to the player).
  const top = distinct(memories.filter((m) => m && m.text))
    .slice(0, 3)
    .sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t : 0));
  let lastPart = null;
  top.forEach((m, i) => {
    let text = sentence(privateVoice(String(m.text).trim(), playerName));
    const part = partOf(m.t);
    if (part && part !== lastPart && !TIME_START.test(text)) text = whenSaid(part, text);
    else if (i > 0 && !TIME_START.test(text) && part === lastPart) text = whenSaid(pick(['Later', 'After that', 'Then'], rnd), text);
    lastPart = part || lastPart;
    parts.push(text);
    const refl = EMOTION_REFLECTIONS[m.emotion];
    if (refl && (m.importance ?? 0) >= 5) parts.push(pick(refl, rnd));
  });
  if (!top.length) parts.push('Nothing much happened, and honestly, I needed that.');

  let rel = null;
  try {
    rel = mind?.relationships?.get?.('player') || null;
  } catch {
    rel = null;
  }
  const state = companionshipOf(game);
  const today = day ?? game?.clock?.day ?? 1;
  const dLine = deedLine(game, playerName, today, rnd);
  // The deed may be the very memory she already wrote about.
  if (dLine && !top.some((m) => overlaps(m.text, dLine, playerName))) parts.push(dLine);
  const pLine = STATE_LINES[state] ? pick(STATE_LINES[state], rnd) : rel && rel.affinity < -10 ? pick(COLD_PLAYER, rnd) : pick(PLAYER_LINES[bond >= 4 ? 2 : bond >= 2 ? 1 : 0], rnd);
  parts.push(pLine.replace(/\{player\}/g, playerName));

  let objective = null;
  try {
    objective = game?.plugins?.get?.('quest')?.objective?.(game.plugins.ctx) || null;
  } catch {
    objective = null;
  }
  const goal = (mind?.goals || []).filter((g) => g && !g.done && g.text).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  if (objective) parts.push(`Tomorrow: ${lowerFirst(bare(objective))}. One step closer, Maren.`);
  else if (goal) parts.push(`Tomorrow I keep at it: ${lowerFirst(bare(goal.text))}.`);
  else if ((soul.dreams || []).length) parts.push(`Someday I'll ${lowerFirst(bare(soul.dreams[0]))}. Someday soon.`);

  const w = game?.clock?.weather?.type || 'clear';
  parts.push(pick(CLOSERS[w] || CLOSERS.clear, rnd));

  const text = tidy(parts.join(' '));
  const head = top[0]?.text ? bare(privateVoice(top[0].text, playerName)) : 'a quiet day';
  return { text, summary: `Day ${day ?? game?.clock?.day ?? 1}: ${lowerFirst(head)}.` };
}
