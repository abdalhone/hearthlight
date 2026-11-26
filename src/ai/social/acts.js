// *Actions* between asterisks (round 14b T-3; the author: "If I put text between those two
// things, it should understand it as moves. So if I say kiss, it would understand it like I'm
// kissing it."). Pure: what the player's hands do, read from what they typed. The game then
// decides consent and outcome (acts_effects.js), and the minds only word the reaction (D6).
//
//   parseActs(text, { names }) -> { words, acts: [{ verb, kind, raw, target }] }
//
// kind: affection | intimate | respect | offence | assault | threat | neutral
//   intimate verbs need canBeIntimate (18 and over, src/core/people.js);
//   assault verbs deal at most 1–3 hp and never down anyone; threat verbs (stab, strangle…)
//   are only a threat: text never kills.

// verb -> kind. Several words may name one verb (the first word of the act is matched after
// its -s/-es is dropped: "kisses" -> kiss).
export const VERBS = {
  kiss: { kind: 'intimate', words: ['kiss', 'smooch', 'peck'] },
  hold_hand: { kind: 'intimate', words: [] }, // "holds her hand", "takes his hand"
  caress: { kind: 'intimate', words: ['caress', 'stroke', 'cuddle', 'nuzzle', 'fondle'] },
  hug: { kind: 'affection', words: ['hug', 'embrace', 'squeeze', 'cuddle up'] },
  pat: { kind: 'affection', words: ['pat', 'tousle', 'ruffle'] },
  wink: { kind: 'affection', words: ['wink'] },
  smile: { kind: 'neutral', words: ['smile', 'grin', 'beam'] },
  wave: { kind: 'neutral', words: ['wave', 'nod', 'salute'] },
  bow: { kind: 'respect', words: ['bow', 'curtsy', 'curtsey', 'doff', 'tip'] },
  kneel: { kind: 'respect', words: ['kneel', 'genuflect'] },
  poke: { kind: 'offence', words: ['poke', 'prod', 'flick', 'tickle'] },
  spit: { kind: 'offence', words: ['spit', 'sneer', 'scoff', 'mock', 'laugh at'] },
  grab: { kind: 'assault', words: ['grab', 'seize', 'yank', 'pull', 'pinch'] },
  shove: { kind: 'assault', words: ['shove', 'push', 'jostle', 'trip', 'elbow'] },
  slap: { kind: 'assault', words: ['slap', 'smack', 'cuff'] },
  punch: { kind: 'assault', words: ['punch', 'hit', 'strike', 'thump', 'headbutt', 'beat'] },
  kick: { kind: 'assault', words: ['kick', 'stomp'] },
  // Lethal words are a threat, never a killing (D6).
  stab: { kind: 'threat', words: ['stab', 'strangle', 'choke', 'kill', 'murder', 'slit', 'behead', 'draw', 'unsheathe', 'brandish', 'raise', 'point'] },
};

const WORD_TO_VERB = (() => {
  const m = new Map();
  for (const [verb, d] of Object.entries(VERBS)) for (const w of d.words) m.set(w, verb);
  return m;
})();

// Act segments: *…* (also _…_ is left alone: only asterisks).
const SEG = /\*([^*\n]{1,120})\*/g;
const PRONOUN = /^(him|her|them|you|his|hers|their|your)\b/i;

function stem(w) {
  const t = String(w || '').toLowerCase();
  if (WORD_TO_VERB.has(t)) return t;
  for (const cut of [/ies$/, /es$/, /s$/]) {
    const s = t.replace(cut, cut.source === 'ies$' ? 'y' : '');
    if (WORD_TO_VERB.has(s)) return s;
  }
  // "slapped", "kissing", "hugged"
  const ed = t.replace(/(?:ed|ing)$/, '');
  if (WORD_TO_VERB.has(ed)) return ed;
  const dbl = ed.replace(/(.)\1$/, '$1');
  if (WORD_TO_VERB.has(dbl)) return dbl;
  if (WORD_TO_VERB.has(`${ed}e`)) return `${ed}e`;
  return null;
}

// One act, read from the words between the asterisks. names: { id: [lowercase names] } of
// the people who could be meant, so "*hugs Elda*" names Elda.
export function readAct(raw, { names = null } = {}) {
  const text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  const low = text.toLowerCase().replace(/[’]/g, "'");
  if (!low) return null;
  let verb = null;
  // "holds her hand", "takes his hand", "hold hands"
  if (/\b(?:hold|holds|holding|take|takes|taking|reach(?:es)? for)\b[^.]*\bhands?\b/.test(low)) verb = 'hold_hand';
  if (!verb) {
    const words = low.split(/[^a-z']+/).filter(Boolean);
    // The first word that is a verb we know ("gently hugs her" reads "hugs").
    for (let i = 0; i < Math.min(words.length, 4) && !verb; i++) {
      const two = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : '';
      if (two && WORD_TO_VERB.has(two)) verb = WORD_TO_VERB.get(two);
      else {
        const s = stem(words[i]);
        if (s) verb = WORD_TO_VERB.get(s);
      }
    }
    // "draws my sword", "raises a knife": a threat only with a weapon in it.
    if ((verb === 'stab' && /\b(draw|unsheathe|brandish|raise|point)/.test(low)) && !/\b(sword|blade|knife|dagger|axe|weapon|steel|fist)\b/.test(low)) verb = null;
    // "blows a kiss" is a kiss blown, an affection.
    if (/\bblows? (?:\w+ ){0,2}kiss/.test(low)) verb = 'wink';
  }
  const kind = verb ? VERBS[verb].kind : 'neutral';
  let target = null;
  if (names) {
    for (const [id, list] of Object.entries(names)) {
      if (list.some((n) => n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low))) {
        target = id;
        break;
      }
    }
  }
  if (!target) {
    const after = low.replace(/^\s*(?:\w+ly\s+)?\S+\s*/, '');
    if (PRONOUN.test(after)) target = 'addressee';
  }
  return { verb: verb || 'other', kind, raw: text, target };
}

// -> { words: what was said aloud (the acts taken out), acts: [...] }
export function parseActs(text, opts = {}) {
  const s = String(text ?? '');
  const acts = [];
  for (const m of s.matchAll(SEG)) {
    const a = readAct(m[1], opts);
    if (a) acts.push(a);
    if (acts.length >= 3) break;
  }
  const words = s
    .replace(SEG, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { words, acts };
}

// How the player's act reads in the third person, for the chat row and the bubble:
// "*hugs Elda*" -> "You hug Elda." (the verb taken back to its plain form).
export function actLine(act, targetName = '') {
  const raw = String(act?.raw || '').trim();
  if (!raw) return '';
  const words = raw.split(' ');
  const first = words[0].toLowerCase();
  const plain = stem(first) || first.replace(/(?:es|s)$/, '');
  const rest = words.slice(1).join(' ');
  const body = `${plain}${rest ? ` ${rest}` : targetName && act.target ? ` ${targetName}` : ''}`;
  return `You ${body}`.replace(/\s+/g, ' ').replace(/[.!]*$/, '.');
}
