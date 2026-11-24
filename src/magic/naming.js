// Names and descriptions for weaves, built from the registries' words alone, so a new
// shape, essence or twist names itself ("Splitting Ember Bolt", "Echoing Tide Nova").
//
//   name:        [twist adjective] [essence word(s)] [shape noun]
//   description: "Fires 3 bolts of fire and water that split on impact and seek out foes.
//                 It echoes a moment later."

// Two essences that have a word of their own together. Keys are sorted ids joined by '+'.
// Anything not listed is named by both words ("Ember Tide").
export const PAIR_WORDS = {
  'fire+water': 'Steam',
  'earth+fire': 'Magma',
  'fire+wind': 'Wildfire',
  'fire+storm': 'Plasma',
  'fire+poison': 'Brimstone',
  'dark+fire': 'Hellfire',
  'fire+light': 'Solar',
  'fire+iron': 'Forge',
  'frost+water': 'Glacial',
  'frost+wind': 'Blizzard',
  'frost+storm': 'Hail',
  'earth+frost': 'Permafrost',
  'storm+water': 'Tempest',
  'storm+wind': 'Gale-Thunder',
  'earth+water': 'Mire',
  'nature+water': 'Verdant',
  'nature+poison': 'Blight',
  'nature+light': 'Bloom',
  'dark+light': 'Twilight',
  'dark+poison': 'Plague',
  'dark+song': 'Dirge',
  'light+song': 'Choir',
  'earth+iron': 'Ore',
  'iron+storm': 'Magnet',
  'nature+song': 'Lullaby',
  'poison+water': 'Bog',
  'earth+wind': 'Sandstorm',
  'dark+frost': 'Deathfrost',
};

const MAX_NAME = 30;

// plan: a compiled plan (compile.js) carrying shapeDef, essenceDefs, twistDefs, count.
export function weaveName(plan) {
  const ess = plan.essenceDefs || [];
  const tw = plan.twistDefs || [];
  const shape = plan.shapeDef;
  let noun = shape?.noun || 'Weave';
  if (shape?.id === 'summon' && plan.familiar?.name) noun = plan.familiar.name;
  let words = '';
  const real = ess.filter((e) => e.id !== 'raw');
  if (!real.length) words = ess[0]?.word || 'Arcane';
  else if (real.length === 1) words = real[0].word;
  else {
    const key = real
      .slice(0, 2)
      .map((e) => e.id)
      .sort()
      .join('+');
    words = PAIR_WORDS[key] || `${real[0].word} ${real[1].word}`;
    if (real.length > 2 && `${words} ${real[2].word}`.length <= 18) words = `${words} ${real[2].word}`;
  }
  const adjs = [];
  for (const t of tw) {
    if (!t?.adj) continue;
    adjs.push(t.adj);
    if (adjs.length >= 2) break;
  }
  let name = [...adjs, words, noun].join(' ');
  while (name.length > MAX_NAME && adjs.length) {
    adjs.pop();
    name = [...adjs, words, noun].join(' ');
  }
  if (name.length > MAX_NAME) name = `${words} ${noun}`;
  return name;
}

function joinList(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function essencePhrase(ess) {
  const nouns = ess.map((e) => e.noun);
  return joinList(nouns) || 'raw weave';
}

export function describeWeave(plan) {
  const shape = plan.shapeDef;
  const n = Math.max(1, plan.count || 1);
  const noun = essencePhrase(plan.essenceDefs || []);
  let head = '';
  try {
    head = shape?.describe ? shape.describe(n, noun, plan) : `Casts ${noun}`;
  } catch {
    head = `Casts ${noun}`;
  }
  const clauses = [];
  const sentences = [];
  for (const t of plan.twistDefs || []) {
    if (t.clause) clauses.push(n === 1 ? t.clause[0] : t.clause[1]);
    if (t.sentence) sentences.push(t.sentence);
  }
  let text = head;
  if (clauses.length) text += ` that ${joinList(clauses.slice(0, 3))}`;
  text += '.';
  if (sentences.length) text += ` ${sentences.join(' ')}`;
  return text;
}
