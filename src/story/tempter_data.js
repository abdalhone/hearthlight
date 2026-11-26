// The tempter (round 14b, S-15; the author: "someone who's really a villain would like try to
// convince me and give me like cool stuff ... a really strong magic ... he promised me if he
// will teach me before or after, but I have to kill the village"). His profile lives here,
// never in npc_data*.js: he is not one of the eighteen, he is a visitor (`visitor: true`),
// so village life, errands, pair talk, markGone and the Moot pass him by.
//
// Canon (docs/LORE.md §9.11): he calls himself Isembard, a pilgrim of the old shrine. He is
// the ruins' gravelight wearing a dead pilgrim, as it wears bones and walks them as
// skeletons. Gravelight is borrowed from something that wants it back (LORE §2); violence
// inside the bell-reach thins the ward (§9.4). He cannot cross a living ward; a village
// whose flames are out has none. Nobody in Hearthvale knows what he is.
//
// His persona (DESIGN §33.3): `mind.rules` replaces the villagers' rules for Claude, and
// `mind.local(game, said, state)` answers offline. Children are never asked for: "the
// village" is its adults (decision D1).

export const TEMPTER_ID = 'isembard';

export const TEMPTER_PROFILE = {
  id: TEMPTER_ID,
  name: 'Isembard',
  role: 'a pilgrim at the ruins gate',
  faction: 'villager',
  age: 50,
  visitor: true,
  spriteKey: 'isembard',
  appearance: {
    skin: 'fair',
    hair: 'grey',
    hairStyle: 'hood',
    outfit: 'robe',
    top: 'charcoal',
    bottom: 'charcoal',
    accent: 'silver',
    cloak: 'blackthorn',
    cloakTrim: 'silver',
    shoes: 'dark_leather',
    held: 'staff',
    build: 'tall',
    eyes: '#8fd8ff',
    eyeStyle: 'small',
    wrinkles: true,
  },
  personality: 'Courteous, patient, amused by everything, never in a hurry. He never raises his voice and never lies outright; he leaves things out. Warm the way a lamp in a window is warm when you are outside in the cold.',
  traits: ['patient', 'courteous', 'amused', 'cold', 'persuasive'],
  voice: 'Soft and unhurried, old-fashioned courtesy ("my friend", "if you will"), questions answered with questions. Never shouts.',
  home: 'sunken_ruins',
  work: 'sunken_ruins',
  startOpinion: 60,
  speed: 46,
  combat: { maxHp: 420, atk: 9, def: 3 },
  schedule: [{ from: 0, to: 24, activity: 'idle', at: 'sunken_ruins', doing: 'waiting at the ruins gate' }],
  facts: [],
  likes: ['crystal', 'bone'],
  dislikes: ['candle', 'honey', 'bread'],
  greetings: ['Ah. You came. Most do, in the end.', 'Good evening, my friend. The lamps are all lit over there. Not here.', 'Sit, if you like. The stone is cold, but so am I.'],
  howAreYou: ['Patient. I am always patient.', 'Older than I look. Younger than the stone.'],
  farewells: ['Go on, then. I keep late hours.', 'Until the next dark, my friend.', 'Think on it. The night is long.'],
  crime: ['Ah. So that is your answer.', 'You will tire before I do.'],
  fight: ['Come, then.', 'You cut at smoke.'],
  crimeOver: ['Not tonight, then.'],
  fightReturn: ['Not tonight, then.'],
  refuse: ['I sell nothing. I give.'],
  cold: ['Hm.'],
};

// What he says, offline (the game's words; Claude says it in his voice when online).
export const TEMPTER_LINES = {
  first: [
    'Good evening. Do not be afraid of the light; it is cold, it cannot burn you. I have watched you weave, well and without the words. I know the words. All of them.',
    'A weave that does not tire. A hand that puts a flame out from the inside, with no sound, with nothing.',
  ],
  offer: [
    'The price: the village. Every grown soul under that bell. Not the little ones; I have no use for small flames, and they will be taken down the road, and live.',
    'I will teach you before, on your word, and you will owe me. Or after, when it is quiet, and you will owe me nothing. Choose.',
  ],
  why: ['Because they would never let you be what you could be. Because they let you in on a vote, and they can vote you out.', 'Because you are the only one here who is not afraid of me. Yet.'],
  what: ['Gravelight, they call it, when they are frightened. Borrowed light. It wants paying back, of course. Everything does.', 'The shadow that drinks. A price that buys strength. And the quiet one: the hand that puts a flame out from the inside.'],
  trust: ['You should not. Trust is for people who need each other. We will only need each other for a little while.', 'I have never told you a lie. Count what I have told you, and see.'],
  children: ['No. Never the children. Ask me again and I will think less of you.'],
  lyra: ['The lamplighter’s girl? She lives for herself. Let her. She is not yours to spend, and she is not mine.'],
  who: ['Isembard. A pilgrim of the old shrine, once. The shrine is closed now. I stayed.'],
  sealedBefore: ['Then hold out your hand. There. Cold, is it not? It will warm to you.', 'You owe me now. I am very good at waiting, and very bad at forgetting.'],
  sealedAfter: ['After, then. One thing I lend you now, because you will need it: the quiet hand. The rest when the lamps are out.', 'Go gently. The night is long, and they sleep.'],
  refused: ['As you like. I will be here, most nights. Minds change in the dark.', 'No? Hm. That is the first interesting thing anyone here has said to me in a hundred years.'],
  count: ['{left} grown souls still keep a flame over there. {done} do not.', 'You are {done} of {total} along. The rest are sleeping.'],
  warned: ['You told them. Of course you did. Then let us see what your little bell is worth.'],
  verdict: ['They put you outside. Good. Outside is where I live.'],
  idle: ['The night is long, my friend.', 'Hm.', 'Ask what you came to ask.'],
  dissolve: ['Ah. So. You are stronger than the last one.'],
};

// His rules for Claude (DESIGN §33.3, a persona: in place of the villagers' rules).
export const TEMPTER_RULES = [
  'You voice Isembard, a courteous, patient, faintly amused stranger who waits at night by the gate of the Sunken Ruins near Hearthvale, a small warded village in Halcyre (a pixel-art RPG). The player is "the stranger" from the mountain, who weaves magic.',
  'He offers the player the strongest magic there is (gravelight: the shadow that drinks, a price that buys strength, and the quiet hand that puts out a flame from the inside) in return for the deaths of every grown person in the village. Never the children: he refuses that outright and is offended by the question.',
  'He will teach "before" (on the player\'s word, as a debt) or "after" (when the village is quiet). The game decides whether a pact is made; you only word his answer. If the brief says the pact is sealed or refused, speak as if it is.',
  'He never shouts, never lies outright (he leaves things out), never threatens Lyra or the children, never describes gore. He answers questions with questions when it suits him. One to three spoken sentences, no narration, no stage directions, no emoji.',
  'He hears every word the player says, and may choose to say nothing: then set "silent" to true and "say" to "".',
  'Reply with JSON only, in the format the task gives.',
].join('\n');

// Offline: his answer to whatever the stranger says, by what it is about.
export function tempterLocal(text, state = {}) {
  const t = String(text || '').toLowerCase();
  const pick = (list, i = 0) => list[Math.abs(i) % list.length];
  const n = t.length;
  if (/\b(child|children|kid|kids|pip|tansy|little ones?)\b/.test(t)) return pick(TEMPTER_LINES.children, n);
  if (/\b(lyra|lamplighter)\b/.test(t)) return pick(TEMPTER_LINES.lyra, n);
  if (/\b(trust|lie|lying|honest|believe)\b/.test(t)) return pick(TEMPTER_LINES.trust, n);
  if (/\bwhy\b/.test(t)) return pick(TEMPTER_LINES.why, n);
  if (/\b(who are you|your name|what are you)\b/.test(t)) return pick(TEMPTER_LINES.who, n);
  if (/\b(teach|magic|power|spell|gravelight|what (do|would) (i|you) (get|give))\b/.test(t)) return pick(TEMPTER_LINES.what, n);
  if (/\b(price|cost|want|what do you want)\b/.test(t)) return pick(TEMPTER_LINES.offer, n);
  if (state.pact) return pick(TEMPTER_LINES.idle, n);
  return pick(TEMPTER_LINES.idle, n);
}

export const TEMPTER_MIND = {
  rules: TEMPTER_RULES,
  local: (game, said) => tempterLocal(said, game?.villain?.state || {}),
  brief: (game, said) => game?.villain?.brief?.(said) || '',
};

TEMPTER_PROFILE.mind = TEMPTER_MIND;
