// The offline mind's diary: a heartfelt first-person entry built from the day's real
// memories, her mood, her bond with the player and what she is reaching for next.

import { moodKey, bondLevel, lowerFirst, bare } from './speech_gen.js';
import { soulOf } from './soul_fallback.js';

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

const CONNECTORS = ['First:', 'Then', 'And later,', 'Also —'];

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

const CLOSERS = {
  rain: ['The rain is soft on the roof. Goodnight.', 'Rain on the shutters. My favorite lullaby. Goodnight.'],
  clear: ['The stars are out. I counted eleven before I gave up. Goodnight.', 'Clear sky tonight. Maren, if you can see these stars too — hold on.'],
  fog: ['Fog against the window, thick as wool. Goodnight.'],
  cloudy: ['No stars tonight. Tomorrow, maybe. Goodnight.'],
};

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length) % list.length];
}

function sentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

// memories: [{text, importance, emotion, about}] most important first.
export function composeDiary(game, memories = [], { day, rnd = Math.random } = {}) {
  const mind = game?.companion?.mind;
  const mood = moodKey(mind);
  const bond = bondLevel(mind);
  const soul = soulOf(game);
  const playerName = game?.settings?.playerName || 'the traveler';
  const parts = [];
  parts.push(pick(OPENERS[mood] || OPENERS.calm, rnd));

  const top = memories.filter((m) => m && m.text).slice(0, 3);
  top.forEach((m, i) => {
    const text = sentence(m.text);
    const c = CONNECTORS[i] || 'And';
    const body = c.endsWith(':') || c.endsWith('—') ? `${c} ${text}` : `${c} ${lowerFirst(text)}`;
    parts.push(body);
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
  const pLine = rel && rel.affinity < -10 ? pick(COLD_PLAYER, rnd) : pick(PLAYER_LINES[bond >= 4 ? 2 : bond >= 2 ? 1 : 0], rnd);
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

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const head = top[0]?.text ? bare(top[0].text) : 'a quiet day';
  return { text, summary: `Day ${day ?? game?.clock?.day ?? 1}: ${lowerFirst(head)}.` };
}
