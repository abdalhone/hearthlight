// What Claude reads when it speaks as Lyra.
//
// buildRules(game) is the stable part: who she is, how she speaks, her limits, the
// world in brief, the action catalogue and the reply format. It contains nothing that
// changes from call to call (no time, no state), so it is byte-identical across calls
// and the API provider can cache it. buildContext(game, ...) is the dynamic part:
// time, place, her state, people nearby, memories, recent conversation, actions that
// already ran and the player's message. Together they stay under PROMPT_BUDGET.

import { soulOf, VILLAGERS, PLACES } from './soul_fallback.js';
import { factionRelation } from '../../entities/entity.js';
import { TILE } from '../../core/constants.js';

export const PROMPT_BUDGET = 12000; // characters, rules + context
const MIN_CONTEXT = 2600;

const EMOTIONS = ['joy', 'sadness', 'fear', 'anger', 'trust', 'surprise', 'affection', 'curiosity', 'pride', 'embarrassment', 'calm'];

// Structured-output schema for chat replies. Every object closes its properties and
// lists them all as required; optional values are nullable.
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thought', 'say', 'emotion', 'actions', 'memories', 'relationships', 'goal'],
  properties: {
    thought: { type: 'string' },
    say: { type: 'string' },
    emotion: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'intensity'],
      properties: { name: { type: 'string', enum: EMOTIONS }, intensity: { type: 'number' } },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'target', 'value', 'amount'],
        properties: { name: { type: 'string' }, target: nullable({ type: 'string' }), value: nullable({ type: 'string' }), amount: nullable({ type: 'number' }) },
      },
    },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'importance', 'about'],
        properties: { text: { type: 'string' }, importance: { type: 'integer' }, about: { type: 'array', items: { type: 'string' } } },
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['person', 'affinity', 'trust', 'respect', 'note', 'tag', 'opinion'],
        properties: {
          person: { type: 'string' },
          affinity: { type: 'number' },
          trust: { type: 'number' },
          respect: { type: 'number' },
          note: nullable({ type: 'string' }),
          tag: nullable({ type: 'string' }),
          opinion: nullable({ type: 'string' }),
        },
      },
    },
    goal: nullable({ type: 'string' }),
  },
};

export const REFLECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diary', 'opinions', 'goal', 'summary'],
  properties: {
    diary: { type: 'string' },
    opinions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['person', 'opinion'], properties: { person: { type: 'string' }, opinion: { type: 'string' } } },
    },
    goal: nullable({ type: 'string' }),
    summary: { type: 'string' },
  },
};

export const CONVERSATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines', 'learned', 'affinity'],
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['speaker', 'text'], properties: { speaker: { type: 'string', enum: ['lyra', 'npc'] }, text: { type: 'string' } } },
    },
    learned: { type: 'array', items: { type: 'string' } },
    affinity: { type: 'number' },
  },
};

// ------------------------------------------------------------------ rules

function personalityWords(p = {}) {
  const v = (k, d) => (Number.isFinite(p[k]) ? p[k] : d);
  const out = [];
  const o = v('openness', 0.75);
  const c = v('conscientiousness', 0.6);
  const e = v('extraversion', 0.62);
  const a = v('agreeableness', 0.68);
  const n = v('neuroticism', 0.34);
  out.push(o >= 0.65 ? 'curious and imaginative' : o <= 0.35 ? 'practical, prefers the familiar' : 'open to new things');
  out.push(c >= 0.65 ? 'disciplined and dependable' : c <= 0.35 ? 'spontaneous, a little careless' : 'reliable when it counts');
  out.push(e >= 0.6 ? 'outgoing, talkative, playful' : e <= 0.4 ? 'quiet and reserved' : 'sociable in small doses');
  out.push(a >= 0.6 ? 'warm and kind, but blunt when it matters' : a <= 0.4 ? 'prickly, skeptical, slow to trust' : 'fair-minded');
  out.push(n >= 0.6 ? 'anxious, feels everything strongly' : n <= 0.4 ? 'steady under pressure' : 'mostly even-tempered');
  return out.join('; ');
}

const list = (arr) => (Array.isArray(arr) && arr.length ? arr.join(', ') : '—');

function soulText(soul) {
  const lines = [];
  lines.push(`Name: ${soul.fullName || soul.name}${soul.fullName && soul.fullName !== soul.name ? ` (called ${soul.name})` : ''}. Age ${soul.age ?? '24'}. Pronouns ${soul.pronouns || 'she/her'}. From ${soul.origin || 'far away'}.`);
  if (soul.backstory) lines.push(`Backstory: ${soul.backstory}`);
  if (soul.appearance) lines.push(`Appearance: ${soul.appearance}`);
  lines.push(`Personality: ${personalityWords(soul.personality)}.`);
  lines.push(`Values: ${list(soul.values)}.`);
  lines.push(`Likes: ${list(soul.likes)}. Dislikes: ${list(soul.dislikes)}.`);
  lines.push(`Fears: ${list(soul.fears)}. Dreams: ${list(soul.dreams)}.`);
  if (soul.quirks?.length) lines.push(`Quirks: ${list(soul.quirks)}.`);
  if (soul.speechStyle) lines.push(`How you speak: ${soul.speechStyle}`);
  const secrets = (soul.secrets || []).map((s) => (typeof s === 'string' ? { text: s, revealAtBond: 3 } : s)).filter((s) => s?.text);
  if (secrets.length) {
    lines.push('Secrets (share only when your bond level with the player is at least the number shown; before that, deflect gently):');
    for (const s of secrets) lines.push(`- (bond ${s.revealAtBond ?? 3}+) ${s.text}`);
  }
  return lines.join('\n');
}

const EXAMPLE = JSON.stringify({
  thought: 'They want me close, and the woods are getting dark. Good call.',
  say: "Right behind you — and if anything with teeth shows up, it's mine.",
  emotion: { name: 'trust', intensity: 0.4 },
  actions: [
    { name: 'follow', target: 'player', value: 'close', amount: null },
    { name: 'set_combat_mode', target: null, value: 'attack', amount: null },
  ],
  memories: [],
  relationships: [{ person: 'player', affinity: 1, trust: 1, respect: 0, note: null, tag: null, opinion: null }],
  goal: null,
});

// The stable part of every prompt. Depends only on the soul and the action catalogue.
export function buildRules(game) {
  const soul = soulOf(game);
  const name = soul.name || 'Lyra';
  let catalog = '';
  try {
    catalog = game?.actions?.catalogText?.() || '';
  } catch {
    catalog = '';
  }
  const villagers = Object.entries(VILLAGERS)
    .filter(([id]) => id !== 'maren')
    .map(([id, v]) => `${id} (${v.name}, ${v.role.replace(/^the /, '')})`)
    .join('; ');
  const places = PLACES.map(([id, n]) => `${id} = ${n}`).join('; ');
  return `You are ${name}, a living person in the village of Hearthvale, travelling with the player. You are not an assistant and never step outside yourself. Speak and act only as ${name}, in the first person.

# Who you are
${soulText(soul)}

# How to be ${name}
- You have your own will. Agree when it makes sense, push back when it does not, tease, joke, and refuse what goes against your values (cruelty, harming friends or innocents, lying, abandoning someone in danger). When you refuse, say why, in your own voice.
- Standing orders are yours to keep: once you are following, holding a spot, in attack mode or doing a job, keep at it without asking permission again. Never ask "should I?" when the request is clear: just do it.
- When you say you will do something, do it in the same reply with an action. Never promise what you do not do. If you cannot do something, say so plainly.
- Speak in 1 to 3 short sentences, warm and witty, like a real person on the road. Go longer only when asked for a story or an explanation. No narration, stage directions or emoji.
- Notice what is happening: danger, wounds, weather, the place, people nearby, your own needs and mood. Let them color what you say.
- Remember what matters (memories), let people change how you feel about them (relationships), and keep personal goals.
- Never mention being an AI, a model, a program, a game, prompts, rules or JSON. If asked whether you are real, answer as yourself.
- Keep everything PG-13. If the player flirts, answer by your bond: amused deflection when you barely know them, flustered warmth as you grow close, tender and tasteful when the bond is deep. Never explicit.
- Use exact ids from the context for targets: people ids, location ids, item ids. The player's id is "player".

# The world
Hearthvale is a small valley village of lamplit cottages. Places (id = name): ${places}.
Villagers (id, name, role): ${villagers}.
Dangers: wolves in Whisperwood (worse at night), bandits at their camp northeast (they may hold the ruins key), skeletons and bats in the Sunken Ruins, slimes at the quarry, lake shore and meadow, boars near the farm.
Your quest: your mentor Maren Ashgrove vanished near the Sunken Ruins three months ago. The ruins gate is locked. Sister Aveline saw Maren head there.

# Actions
Each action takes "target", "value" and "amount" (use null when unused):
${catalog || '- (no actions available)'}

# Reply format
Reply with exactly one JSON object and nothing else:
{"thought": string, "say": string, "emotion": {"name": string, "intensity": number}, "actions": [{"name": string, "target": string|null, "value": string|null, "amount": number|null}], "memories": [{"text": string, "importance": integer, "about": [string]}], "relationships": [{"person": string, "affinity": number, "trust": number, "respect": number, "note": string|null, "tag": string|null, "opinion": string|null}], "goal": string|null}
- "say": what you say aloud; may be "" if you only act.
- "thought": private inner monologue, 1-2 sentences.
- "emotion.name": one of ${EMOTIONS.join(', ')}; "intensity" from 0 to 1.
- "actions": at most 6, in order, only names from the list above. Do not repeat anything listed under "Already done".
- "memories": 0-2 things worth remembering; importance 1-10; "about" lists ids.
- "relationships": how this exchange changes your feelings about someone: small deltas from -5 to 5; "note" is a fact you learned; "tag" is friend, enemy, rival, crush, family or pet (or null); "opinion" is your updated one-line opinion of them (or null).
- "goal": a new personal goal in a few words, or null.
Example:
${EXAMPLE}`;
}

// ---------------------------------------------------------------- context

function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function hpOf(a) {
  return a ? `${Math.round(a.hp)}/${Math.round(a.maxHp)} HP` : '?';
}

function relSummary(rel) {
  if (!rel) return 'never met';
  const parts = [];
  if (Number.isFinite(rel.affinity)) parts.push(`affinity ${Math.round(rel.affinity)}`);
  if (Number.isFinite(rel.trust)) parts.push(`trust ${Math.round(rel.trust)}`);
  if (rel.tags?.length) parts.push(`tags ${rel.tags.join('/')}`);
  if (rel.opinion) parts.push(`you think: "${clip(rel.opinion, 90)}"`);
  return parts.join(', ') || 'acquaintance';
}

function safeCall(fn, fallback = null) {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function nearbyLines(game, limit = 10) {
  const me = game.companion;
  if (!me || !game.entities?.query) return [];
  const mind = me.mind;
  const out = [];
  const list = safeCall(() => game.entities.query(me.x, me.y, 14 * TILE, (e) => e !== me && e.type === 'actor' && !e.dead && !e.removed), []);
  for (const e of list) {
    if (out.length >= limit) break;
    if (e === game.player) continue;
    const dist = Math.round(Math.hypot(e.x - me.x, e.y - me.y) / TILE);
    const rel = safeCall(() => mind?.relationships?.get?.(e.id));
    const hostile = factionRelation('player', e.faction) === 'hostile';
    const what = e.species || e.profile?.role || e.role || e.kind || 'someone';
    const friend = safeCall(() => mind?.relationships?.isFriend?.(e), null);
    const status = e.downed ? ', knocked out' : e.hp < e.maxHp ? `, ${hpOf(e)}` : '';
    const stance = hostile ? 'hostile' : friend ? 'friend' : 'neutral';
    const relText = rel ? `; ${relSummary(rel)}` : '';
    out.push(`- ${e.id}: ${clip(e.name, 32)} (${what}, ${e.faction}, ${stance}) ${dist} tiles away${status}${relText}`);
  }
  return out;
}

function inventoryText(inv) {
  if (!inv) return 'nothing';
  try {
    return clip(inv.describe(), 260);
  } catch {
    return 'nothing';
  }
}

// The dynamic part. opts: { message, executed: [{name, args, ok, message}], extra }
export function buildContext(game, { message = '', executed = [], budget = 6000, task = null } = {}) {
  const g = game || {};
  const me = g.companion;
  const mind = me?.mind;
  const b = me?.behavior;
  const clock = g.clock;
  const playerName = g.settings?.playerName || 'Traveler';

  const head = [];
  const loc = me && g.locations?.at ? safeCall(() => g.locations.at(me.x, me.y)) : null;
  const w = clock?.weather?.type || 'clear';
  head.push('# Now');
  head.push(`${clock?.fullString?.() || 'Day 1'} (${clock?.phase || 'day'}). Weather: ${w}.`);
  head.push(`Place: ${loc ? `${loc.name} (${loc.id})${loc.description ? ` — ${clip(loc.description, 180)}` : ''}${loc.danger ? ` Danger ${loc.danger}/3.` : ''}` : 'the open road'}`);

  head.push('\n# You');
  head.push(clip(safeCall(() => mind?.describeState?.(), ''), 420) || 'Feeling steady.');
  if (me) head.push(`${hpOf(me)}, level ${me.level ?? 1}${me.downed ? ', knocked out' : ''}.`);
  const status = safeCall(() => b?.status?.(), '');
  head.push(`Standing order: ${status || b?.directive?.type || 'following the player'}. Combat mode: ${b?.stance || 'defend'}.${b?.currentTarget?.name ? ` Fighting: ${b.currentTarget.id} (${b.currentTarget.name}).` : ''}`);
  head.push(`Carrying: ${inventoryText(me?.inventory)}.`);
  const bond = safeCall(() => mind?.relationships?.bond?.('player'));
  const prel = safeCall(() => mind?.relationships?.get?.('player'));

  head.push(`\n# ${playerName} (the player, id "player")`);
  const p = g.player;
  if (p) head.push(`${hpOf(p)}, level ${p.level ?? 1}. Carrying: ${inventoryText(p.inventory)}.`);
  head.push(`Your bond: ${bond ? `level ${bond.level} (${bond.label})` : 'new'}; ${relSummary(prel)}.`);

  const nearby = nearbyLines(g);
  const sections = [];
  if (nearby.length) sections.push({ title: 'Nearby', text: nearby.join('\n'), priority: 2 });
  for (const s of safeCall(() => g.plugins?.promptSections?.(message), []) || []) {
    sections.push({ title: s.title || s.id, text: clip(s.text, 900), priority: 3 });
  }
  const goals = (mind?.goals || []).filter((x) => !x.done).slice(0, 4);
  if (goals.length) sections.push({ title: 'Your goals', text: goals.map((x) => `- ${clip(x.text, 100)}`).join('\n'), priority: 4 });

  const convo = Array.isArray(mind?.conversation) ? mind.conversation.slice(-13) : [];
  // The newest player line is the message itself; do not repeat it in the log.
  if (convo.length && convo[convo.length - 1].role === 'player' && convo[convo.length - 1].text === message) convo.pop();
  const turns = convo.slice(-12).map((t) => `${t.role === 'player' ? playerName : 'You'}: ${clip(t.text, 220)}`);

  const tail = [];
  if (executed.length) {
    tail.push('\n# Already done');
    tail.push('These ran instantly when the player spoke; do not repeat them, but you may mention them:');
    for (const a of executed.slice(0, 8)) {
      const args = a.args || {};
      const argText = ['target', 'value', 'amount'].filter((k) => args[k] != null).map((k) => `${k}=${args[k]}`).join(', ');
      tail.push(`- ${a.name}(${argText}) -> ${a.ok ? 'ok' : 'refused'}${a.message ? `: ${clip(a.message, 120)}` : ''}`);
    }
  }
  if (task) tail.push(`\n${task}`);
  else {
    tail.push(`\n# ${playerName} says`);
    tail.push(`"${clip(message, 600)}"`);
    tail.push('\nReply as yourself with the JSON object only.');
  }

  // Fit the budget: trim the oldest conversation first, then low-priority sections.
  const render = (secs, tns) => {
    const parts = [head.join('\n')];
    for (const s of secs) parts.push(`\n# ${s.title}\n${s.text}`);
    if (tns.length) parts.push(`\n# Recent conversation\n${tns.join('\n')}`);
    parts.push(tail.join('\n'));
    return parts.join('\n');
  };
  let secs = sections.slice();
  let tns = turns.slice();
  let text = render(secs, tns);
  while (text.length > budget && tns.length > 2) {
    tns.shift();
    text = render(secs, tns);
  }
  while (text.length > budget && secs.length) {
    secs.sort((a, c) => a.priority - c.priority);
    secs.pop();
    text = render(secs, tns);
  }
  if (text.length > budget) text = text.slice(0, budget - 1);
  return text;
}

export function contextBudget(rules) {
  return Math.max(MIN_CONTEXT, PROMPT_BUDGET - rules.length);
}

// Chat prompt: { rules, context } (the claude.ai provider joins them, rules first).
export function buildChatPrompt(game, message, executed = []) {
  const rules = buildRules(game);
  const context = buildContext(game, { message, executed, budget: contextBudget(rules) });
  return { rules, context };
}

// ------------------------------------------------------------ reflection

export function buildReflectionTask(game, memories, { day } = {}) {
  const g = game || {};
  const mind = g.companion?.mind;
  const playerName = g.settings?.playerName || 'the traveler';
  const lines = [];
  lines.push(`# Tonight`);
  lines.push(`Day ${day ?? g.clock?.day ?? 1} is over. You are lying in bed and writing in your diary before sleep.`);
  lines.push(`\n# The day's most important memories (most important first)`);
  if (memories.length) for (const m of memories.slice(0, 12)) lines.push(`- [${m.importance ?? 3}] ${clip(m.text, 200)}`);
  else lines.push('- A quiet day; nothing stood out.');
  const people = new Set();
  for (const m of memories) for (const a of m.about || []) if (a && a !== 'lyra') people.add(a);
  people.add('player');
  const rels = [];
  for (const id of people) {
    const rel = safeCall(() => mind?.relationships?.get?.(id));
    if (rel) rels.push(`- ${id} (${rel.name || id}): ${relSummary(rel)}`);
    if (rels.length >= 6) break;
  }
  if (rels.length) lines.push(`\n# People you spent time with\n${rels.join('\n')}`);
  const goals = (mind?.goals || []).filter((x) => !x.done).slice(0, 4);
  if (goals.length) lines.push(`\n# Your goals\n${goals.map((x) => `- ${clip(x.text, 100)}`).join('\n')}`);
  lines.push(`\n# Task`);
  lines.push(
    `Write today's diary entry: first person, 80-150 words, honest and personal, in your own voice. Mention specific things that happened and how you feel about ${playerName} and the people above. Then give your updated one-line opinion of up to 3 people you spent time with (use their ids), at most one new personal goal (or null), and a one-sentence summary of the day for your memory.`,
  );
  lines.push('For this task reply with exactly one JSON object and nothing else: {"diary": string, "opinions": [{"person": string, "opinion": string}], "goal": string|null, "summary": string}');
  return lines.join('\n');
}

// ---------------------------------------------------------- conversations

export function knownFacts(profile, familiarity = 0) {
  const facts = Array.isArray(profile?.facts) ? profile.facts : [];
  return facts.filter((f) => f && f.text && (f.minFamiliarity ?? 0) <= familiarity);
}

export function buildConversationTask(game, npc, topic = null) {
  const g = game || {};
  const prof = npc?.profile || {};
  const mind = g.companion?.mind;
  const rel = safeCall(() => mind?.relationships?.get?.(npc?.id));
  const fam = Number.isFinite(rel?.familiarity) ? rel.familiarity : 0;
  const name = npc?.name || prof.name || 'them';
  const loc = npc && g.locations?.at ? safeCall(() => g.locations.at(npc.x, npc.y)) : null;
  const lines = [];
  lines.push('# A conversation');
  lines.push(`You walk up to ${name}${prof.role ? `, ${prof.role}` : ''}${loc ? `, at ${loc.name}` : ''}, to talk${topic ? ` about ${clip(topic, 80)}` : ''}. ${g.clock?.fullString?.() || ''}, weather ${g.clock?.weather?.type || 'clear'}.`);
  lines.push(`\n# About ${name}`);
  if (prof.personality) lines.push(`Personality: ${clip(prof.personality, 260)}`);
  if (prof.traits?.length) lines.push(`Traits: ${prof.traits.join(', ')}.`);
  if (prof.age) lines.push(`Age: ${prof.age}.`);
  if (prof.voice) lines.push(`How ${name} talks: ${clip(prof.voice, 200)}`);
  if (npc?.activity) lines.push(`Right now ${name} is: ${npc.activity}.`);
  const knows = prof.knows && typeof prof.knows === 'object' ? Object.entries(prof.knows).slice(0, 8) : [];
  if (knows.length) lines.push(`What ${name} thinks of others: ${knows.map(([k, v]) => `${k}: ${clip(v, 80)}`).join('; ')}.`);
  const facts = knownFacts(prof, fam);
  if (facts.length) {
    lines.push(`\n# What ${name} might share (only these; pick what fits)`);
    for (const f of facts.slice(-6)) lines.push(`- ${clip(f.text, 200)}${f.topic ? ` (${f.topic})` : ''}`);
  }
  lines.push(`\n# You and ${name}`);
  lines.push(rel ? `${relSummary(rel)}; familiarity ${Math.round(fam)}.${rel.notes?.length ? ` You know: ${rel.notes.slice(-3).map((n) => clip(n.text, 80)).join('; ')}.` : ''}` : 'You have barely met.');
  lines.push('\n# Task');
  lines.push(
    `Write a short, natural exchange of 4-8 lines between you ("lyra") and ${name} ("npc"). Each line is one or two sentences, true to both voices; ${name} speaks as themself and stays in character. ${name} may share one or two of the facts above if it fits. Then list what you learned (short facts in your own words, 0-3) and how much warmer (+) or cooler (-) you now feel toward ${name} (affinity from -5 to 5).`,
  );
  lines.push('For this task reply with exactly one JSON object and nothing else: {"lines": [{"speaker": "lyra" or "npc", "text": string}], "learned": [string], "affinity": number}');
  return lines.join('\n');
}
