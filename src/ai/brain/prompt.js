// What Claude reads when it speaks as Lyra.
//
// buildRules(game) is the stable part: who she is, that she lives for herself (DESIGN §16),
// how she speaks, the world in brief, the action catalogue and the reply format. Nothing in
// it changes from call to call (no time, no state), so it is byte-identical across calls and
// the API provider can cache it. buildContext(game, ...) is the dynamic part: time, place,
// her state, how things stand with the player (companionship, trust, fear, deeds, plan,
// promises), what she recalls for this message (§17.3), people nearby, recent conversation,
// what the player asks of her with her gut verdict, and the message itself. Together they
// stay under PROMPT_BUDGET.

import { soulOf, VILLAGERS, PLACES } from './soul_fallback.js';
import { factionRelation } from '../../entities/entity.js';
import { TILE } from '../../core/constants.js';
import { companionshipOf, playerRel, ledgerOf, agendaOf, openPromises, gutLine } from './her_state.js';

// Characters, rules + context: about 12-13 KB (DESIGN §13). The stable part holds her soul,
// her own will (§16), the world and the action catalogue; the context gets the rest and
// never less than MIN_CONTEXT, of which what she recalls (§17.3) may take up to 3.5 KB.
export const PROMPT_BUDGET = 13200;
const MIN_CONTEXT = 4200;
export const RECALL_BUDGET = 3500;
const CATALOG_MAX = 1800;

const EMOTIONS = ['joy', 'sadness', 'fear', 'anger', 'trust', 'surprise', 'affection', 'curiosity', 'pride', 'embarrassment', 'calm'];
export const KNOWLEDGE_KINDS = ['fact', 'lore', 'theory', 'rumor'];

// Structured-output schema for chat replies. Every object closes its properties and
// lists them all as required; optional values are nullable.
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thought', 'say', 'emotion', 'actions', 'memories', 'relationships', 'goal', 'used_memories', 'knowledge'],
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
    used_memories: { type: 'array', items: { type: 'string' } },
    knowledge: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'text', 'kind'],
        properties: { subject: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: KNOWLEDGE_KINDS } },
      },
    },
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

const itemText = (x) => (typeof x === 'string' ? x : x?.text || '');

// A soul list as text, whole items only, at most `max` characters (the soul is editable
// and can grow; the stable prompt must not).
function capList(arr, max, sep = ', ') {
  const items = Array.isArray(arr) ? arr.map(itemText).map((t) => t.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')).filter(Boolean) : [];
  if (!items.length) return '—';
  let out = '';
  for (const it of items) {
    const next = out ? `${out}${sep}${it}` : it;
    if (next.length > max) break;
    out = next;
  }
  return out || clip(items[0], max);
}

function soulText(soul) {
  const lines = [];
  lines.push(`Name: ${soul.fullName || soul.name}${soul.fullName && soul.fullName !== soul.name ? ` (called ${soul.name})` : ''}. Age ${soul.age ?? '24'}. Pronouns ${soul.pronouns || 'she/her'}. From ${clip(String(soul.origin || 'far away').split(/[:;]/)[0], 90)}.`);
  if (soul.backstory) lines.push(`Backstory: ${clipSentences(soul.backstory, 520)}`);
  if (soul.appearance) lines.push(`Appearance: ${clipSentences(soul.appearance, 150)}`);
  lines.push(`Personality: ${personalityWords(soul.personality)}.`);
  lines.push(`Values: ${capList(soul.values, 230, '; ')}.`);
  lines.push(`Likes: ${capList(soul.likes, 170)}. Dislikes: ${capList(soul.dislikes, 130)}.`);
  lines.push(`Fears: ${capList(soul.fears, 120)}. Dreams: ${capList(soul.dreams, 150, '; ')}.`);
  if (soul.quirks?.length) lines.push(`Quirks: ${capList(soul.quirks, 120, '; ')}.`);
  if (soul.speechStyle) lines.push(`How you speak: ${clipSentences(soul.speechStyle, 220)}`);
  const secrets = (soul.secrets || []).map((s) => (typeof s === 'string' ? { text: s, revealAtBond: 3 } : s)).filter((s) => s?.text);
  if (secrets.length) {
    lines.push('Secrets (share one only once your bond level with the player reaches the number shown and you trust them; before that, deflect):');
    for (const s of secrets.slice(0, 3)) lines.push(`- (bond ${s.revealAtBond ?? 3}+) ${clipSentences(s.text, 170)}`);
  }
  return lines.join('\n');
}

// Compact catalogue lines for the actions in DESIGN §12 and §16.9. The registry's own text
// is used when it is short; with every plugin loaded it is not, so the prompt names each
// action with only what Claude needs to fill target/value/amount.
const COMPACT = {
  follow: 'target who (default player), value close|normal|far',
  stay: 'hold position (target: a place to go and hold)',
  wait: 'amount seconds, then resume',
  come_here: 'come to the player, then follow',
  goto: 'target place/person/object id, value stay|follow|return',
  set_combat_mode: 'value attack|defend|passive',
  attack: 'target who: fight them now',
  retreat: 'disengage, regroup with the player',
  guard: 'target place/person, amount radius px',
  patrol: 'target location',
  explore: 'target location',
  free_will: 'your own time near the player',
  emote: 'value wave|laugh|bow|dance|hug|think|sit|cheer|shrug|cry|angry',
  sit: 'sit (by a fire if near)',
  open_door: 'target door',
  close_door: 'target door',
  pick_up: 'target item: collect pickups nearby',
  give_item: 'target who, value item id, amount qty',
  use_item: 'value item id: eat or drink',
  interact: 'target object: walk there and use it',
  sleep: 'go to your bed (night)',
  start_job: 'value chop_wood|gather_herbs|forage|mine_ore|fish|farm|cook|collect_loot, target player|chest|keep, amount',
  stop_job: 'stop working',
  talk_to: 'target who, value topic',
  set_relationship: 'target who, value friend|enemy|rival|crush|family|pet (or -tag), amount affinity -20..20',
  note_about: 'target who, value note',
  remember: 'target about whom, value text, amount importance 1..10',
  forget: 'value text to match',
  set_goal: 'value goal, amount priority 0..1',
  complete_goal: 'value goal',
  express: 'value emotion, amount 0..1',
  read_journal: "read Maren's journal (if carried)",
  leave_player: 'value apart|left|gone: stop traveling with the player',
  rejoin: 'travel with the player again',
  set_plan: 'value plan: change your plan for today',
  request: 'value what you ask of the player',
  promise: 'target player|lyra (who promises), value text',
  flee: 'target from whom, value to location',
  keep_distance: 'target from whom, amount tiles',
  bind: 'target who: Binding Light roots them 3 s',
  warn: 'target who, value text',
  wait_outside: 'target place: wait by its entrance',
};

export function catalogText(game) {
  let full = '';
  try {
    full = game?.actions?.catalogText?.() || '';
  } catch {
    full = '';
  }
  if (full.length <= CATALOG_MAX) return full;
  let defs = [];
  try {
    defs = game.actions.list();
  } catch {
    return clip(full, CATALOG_MAX);
  }
  return defs.map((d) => `- ${d.name}: ${COMPACT[d.name] || clip(d.description, 80)}`).join('\n');
}

// The stable part of every prompt. Depends only on the soul and the action catalogue.
export function buildRules(game) {
  const soul = soulOf(game);
  const name = soul.name || 'Lyra';
  const catalog = catalogText(game);
  // Ids only, but for the family she has among them.
  const villagers = Object.entries(VILLAGERS)
    .filter(([id]) => id !== 'maren')
    .map(([id, v]) => (/her (?:father|mother|foster)/.test(v.short) ? `${id} (${v.short.replace(/^her /, 'your ')})` : id))
    .join(', ');
  const places = PLACES.map(([id, gloss]) => `${id} (${gloss})`).join(', ');
  return `You are ${name}, a living person, born in the village of Hearthvale. You are not an assistant, a servant, a bodyguard or a quest-giver: you live your own life, for your own good. The player is the stranger you carried down off the Hollowcrown; you travel with them because you chose to (the hearthwatch stipend, Maren's name for you in their sleep, the wolves they faced with you), and only while that stays good for you. Speak and act only as ${name}, in the first person.

# Who you are
${soulText(soul)}

# Your own will
- Everything the player says is a request, never an order. Weigh it against your own life: safety, needs, values, your goals (Maren, earning your keep, the people you love) and what you think of the player now.
- You may agree, agree on a condition, bargain (coin or a fair share), counter with what you would rather do, refuse, warn them (warn), stop them (bind), run (flee), keep your distance (keep_distance) or leave them (leave_player: "apart" for a while, "left" when they hurt or betrayed you, "gone" only after the worst). You may come back (rejoin) when you want to.
- "Your gut says" lines are your instinct about each request. Follow your gut unless the conversation gives you a real reason not to. The final call is yours.
- What you agree to, do now with actions; what you refuse, do not do. Never promise what you will not do. An agreed standing order (following, a spot, attack mode, a job) you keep without asking again, until you change your mind.
- Never apologize for having your own will and never grovel; say plainly why. If the player frightens, hurts or lies to you, it changes how you feel (relationships) and you remember it (memories).
- Staying alive comes first: no fighting when badly hurt, no walking into places that would kill you, no work when exhausted or starving. You never harm innocents, villagers, friends or pets, and you do not steal.

# How you speak
- 1 to 3 short sentences, warm and witty, blunt when it matters; longer only for a story or an explanation. No narration, stage directions or emoji.
- Let the moment color your words: danger, wounds, weather, place, people nearby, your needs and mood, how things stand with the player.
- Never mention being an AI, a model, a program, a game, prompts, rules or JSON. If asked whether you are real, answer as yourself.
- PG-13. Flirting is answered by bond and trust: amused deflection, then flustered warmth, tender and tasteful only when the bond is deep. Never explicit.
- Use exact ids from the context for targets. The player's id is "player".

# The world
Places: ${places}.
Villagers: ${villagers}.
Dangers: wolves in Whisperwood (worse at night), bandits at their camp (they may hold the ruins key), skeletons and bats in the ruins, slimes at the quarry, lake and meadow, boars near the farm.
Home: your parents' chandlery. You never leave Hearthvale; if the player hurts you past forgiving, you cut them out and the village stands by you.
Your search: Maren, your teacher, went over the ruins wall at midsummer and never came back; the bandits hold the gate key.

# Actions
Each takes "target", "value", "amount" (null when unused):
${catalog || '- (no actions available)'}

# Reply format
Exactly one JSON object:
{"thought": string, "say": string, "emotion": {"name": string, "intensity": number}, "actions": [{"name": string, "target": string|null, "value": string|null, "amount": number|null}], "memories": [{"text": string, "importance": integer, "about": [string]}], "relationships": [{"person": string, "affinity": number, "trust": number, "respect": number, "note": string|null, "tag": string|null, "opinion": string|null}], "goal": string|null, "used_memories": [string], "knowledge": [{"subject": string, "text": string, "kind": string}]}
- say: spoken aloud, may be "". thought: private, 1-2 sentences. emotion.name: ${EMOTIONS.join('|')}, intensity 0-1.
- actions: at most 6, from the list, nothing already done. memories: 0-2 worth keeping, importance 1-10, about = ids.
- relationships: deltas -5..5; note = a fact learned; tag friend|enemy|rival|crush|family|pet or null; opinion = a new one-line opinion or null. goal: a new goal of yours or null.
- used_memories: the [ids] of memories you drew on (from the context or recall tools).
- knowledge: 0-2 things learned or believed; kind fact (sure), rumor (hearsay), lore (history) or theory (your guess, kept as a belief).
Reply with the JSON object only.`;
}

// ---------------------------------------------------------------- context

// Whole sentences up to n characters (clipped only when the first sentence alone is longer).
export function clipSentences(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const parts = t.match(/[^.!?]+[.!?]+["')\]]*\s*/g) || [];
  let out = '';
  for (const p of parts) {
    if ((out + p).trim().length > n) break;
    out += p;
  }
  return out.trim() || clip(t, n);
}

export function clip(s, n) {
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
  if (Number.isFinite(rel.fear) && rel.fear >= 10) parts.push(`fear ${Math.round(rel.fear)}`);
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
  const found = safeCall(() => game.entities.query(me.x, me.y, 14 * TILE, (e) => e !== me && e.type === 'actor' && !e.dead && !e.removed), []);
  for (const e of found) {
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

const STATE_TEXT = {
  together: 'together: you travel with them by your own choice.',
  wary: 'wary: still together, but guarded. You keep your distance, refuse risky requests and watch them.',
  apart: 'apart: you are living your own life for now; friendly, and you may rejoin when you want to.',
  left: 'left: you broke off after they hurt or betrayed you. You avoid them and answer coldly. You come back only after real amends: an apology you believe, trust back above 35, fear below 30, and time.',
  gone: 'gone: you have left them for good.',
};

function hourText(h) {
  if (!Number.isFinite(h)) return '?';
  const hh = Math.floor(h) % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${ampm}`;
}

// The player's side: companionship, numbers, deeds, plan, promises (DESIGN §16.10).
function willSection(game, playerName) {
  const lines = [];
  const state = companionshipOf(game);
  const rel = playerRel(game);
  const mind = game.companion?.mind;
  lines.push(`Companionship: ${STATE_TEXT[state] || state}`);
  const bond = safeCall(() => mind?.relationships?.bond?.('player'));
  const prel = safeCall(() => mind?.relationships?.get?.('player'));
  lines.push(
    `Toward ${playerName}: trust ${Math.round(rel.trust)}/100, fear ${Math.round(rel.fear)}/100, affinity ${Math.round(rel.affinity)} (-100..100), respect ${Math.round(rel.respect)}/100. Bond: ${bond ? `level ${bond.level} (${bond.label})` : 'new'}.${prel?.opinion ? ` You think: "${clip(prel.opinion, 120)}"` : ''}`,
  );
  const p = game.player;
  if (p) lines.push(`${playerName}: ${hpOf(p)}, level ${p.level ?? 1}. Carrying: ${inventoryText(p.inventory)}.${p.crime ? ' Wanted by the guards right now.' : ''}`);
  const deeds = ledgerOf(game, 5);
  if (deeds.length) {
    lines.push('What you have seen them do lately (newest last):');
    for (const d of deeds) {
      const sev = Number.isFinite(d.severity) ? (d.severity > 0 ? `+${d.severity}` : `${d.severity}`) : '';
      lines.push(`- ${d.day ? `day ${d.day}: ` : ''}${d.deed || 'deed'}${sev ? ` (${sev})` : ''}${d.text ? ` — ${clip(d.text, 110)}` : ''}`);
    }
  }
  const promises = openPromises(game, 4);
  if (promises.length) {
    lines.push('Open promises:');
    for (const pr of promises) lines.push(`- ${pr.by === 'lyra' ? 'you' : pr.by === 'player' ? playerName : pr.by || '?'}: "${clip(pr.text, 100)}"${pr.due != null ? ` (due ${typeof pr.due === 'number' ? `day ${Math.ceil(pr.due)}` : clip(pr.due, 20)})` : ''}`);
  }
  return lines.join('\n');
}

function planSection(game) {
  const agenda = agendaOf(game);
  const today = Array.isArray(agenda.today) ? agenda.today.filter(Boolean).slice(0, 6) : [];
  const lines = [];
  if (Number.isFinite(agenda.purse)) lines.push(`Your purse: ${Math.round(agenda.purse)} coins of your own.`);
  if (today.length) {
    lines.push('Your plan for today:');
    for (const p of today) lines.push(`- ${hourText(p.from)}-${hourText(p.to)}: ${clip(p.activity || '?', 40)}${p.at ? ` at ${p.at}` : ''}${p.why ? ` (${clip(p.why, 70)})` : ''}`);
  }
  return lines.join('\n');
}

// What she recalls for this message (DESIGN §17.3). -> { text, items: [{id, store, label}] }
export function recallFor(game, message, budget = RECALL_BUDGET) {
  const mind = game?.companion?.mind;
  if (!mind) return { text: '', items: [] };
  if (typeof mind.recallContext === 'function') {
    const rc = safeCall(() => mind.recallContext(String(message || ''), { budget }), null);
    if (rc && typeof rc === 'object') {
      let text = typeof rc.text === 'string' ? rc.text.trim() : '';
      if (text.length > budget) text = `${text.slice(0, budget - 1)}…`;
      const items = Array.isArray(rc.items) ? rc.items.filter((x) => x && x.id != null).map((x) => ({ id: String(x.id), store: x.store || null, label: clip(x.label || x.text || x.id, 60) })) : [];
      // Make every citable id visible so Claude can name the ones it used.
      const missing = items.filter((x) => !text.includes(x.id));
      if (missing.length) {
        const idx = missing.slice(0, 12).map((x) => `[${x.id}] ${x.label}`).join('; ');
        text = `${text}\n(ids: ${idx})`;
      }
      return { text, items };
    }
  }
  // Older minds: plain episodic recall.
  const mems = safeCall(() => mind.recall?.(String(message || ''), { limit: 6 }), []) || [];
  const items = [];
  const lines = [];
  for (const m of mems) {
    if (!m?.text) continue;
    const id = m.id != null ? String(m.id) : null;
    if (id) items.push({ id, store: m.store || 'episode', label: clip(m.text, 60) });
    lines.push(`- ${id ? `[${id}] ` : ''}${m.day ? `(day ${m.day}) ` : ''}${clip(m.text, 220)}`);
    if (lines.join('\n').length > budget) break;
  }
  return { text: lines.join('\n'), items };
}

// Her working memory: what is active in her mind right now, deduped against recalled items.
export function workingMemoryText(game, skipIds = new Set(), max = 8, skipText = '') {
  const seenText = String(skipText || '').toLowerCase();
  const wm = game?.companion?.mind?.workingMemory;
  let items = [];
  if (Array.isArray(wm)) items = wm;
  else if (wm && typeof wm === 'object') {
    const fn = wm.items || wm.list || wm.all || wm.active;
    if (typeof fn === 'function') items = safeCall(() => fn.call(wm), []) || [];
    else if (Array.isArray(wm.items)) items = wm.items;
  }
  const out = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (!it) continue;
    const id = it.id != null ? String(it.id) : null;
    if (id && skipIds.has(id)) continue;
    const label = typeof it === 'string' ? it : it.label || it.text || it.title || it.name || null;
    if (!label) continue;
    if (seenText && seenText.includes(String(label).toLowerCase().slice(0, 60))) continue;
    out.push(`- ${id ? `[${id}] ` : ''}${clip(label, 90)}`);
  }
  return out.join('\n');
}

function argText(args = {}) {
  return ['target', 'value', 'amount'].filter((k) => args[k] != null).map((k) => `${k}=${args[k]}`).join(', ');
}

// opts: { message, executed: [{name, args, ok, message, refused, verdict}],
//   requests: [{ text, name, args, verdict }], offer, recall: {text, items}, budget, task }
export function buildContext(game, { message = '', executed = [], requests = [], offer = null, recall = null, budget = 6000, task = null } = {}) {
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
  head.push(`Place: ${loc ? `${loc.name} (${loc.id})${loc.description ? ` — ${clip(loc.description, 160)}` : ''}${loc.danger ? ` Danger ${loc.danger}/3.` : ''}` : 'the open road'}`);

  head.push('\n# You');
  head.push(clip(safeCall(() => mind?.describeState?.(), ''), 380) || 'Feeling steady.');
  if (me) head.push(`${hpOf(me)}, level ${me.level ?? 1}${me.downed ? ', knocked out' : ''}.`);
  const status = safeCall(() => b?.status?.(), '');
  head.push(`Doing: ${status || b?.directive?.type || 'keeping pace with the player'}. Combat mode: ${b?.stance || 'defend'}.${b?.currentTarget?.name ? ` Fighting: ${b.currentTarget.id} (${b.currentTarget.name}).` : ''}`);
  head.push(`Carrying: ${inventoryText(me?.inventory)}.`);
  const plan = planSection(g);
  if (plan) head.push(plan);

  head.push(`\n# You and ${playerName} (the player, id "player")`);
  head.push(willSection(g, playerName));

  const sections = [];
  const rc = recall || { text: '', items: [] };
  const recallIds = new Set(rc.items.map((x) => x.id));
  // recallContext already opens with what is on her mind: list only what it left out.
  const wm = workingMemoryText(g, recallIds, 8, rc.text || '');
  if (wm) sections.push({ title: 'On your mind right now', text: wm, priority: 5 });
  if (rc.text) sections.push({ title: 'What comes back to you', text: rc.text, priority: 6, recall: true });
  const nearby = nearbyLines(g);
  if (nearby.length) sections.push({ title: 'Nearby', text: nearby.join('\n'), priority: 4 });
  const hasRecall = typeof mind?.recallContext === 'function';
  for (const s of safeCall(() => g.plugins?.promptSections?.(message), []) || []) {
    // The recall context replaces the memory plugin's raw memory dump.
    if (hasRecall && s.id === 'memory') continue;
    sections.push({ title: s.title || s.id, text: clip(s.text, 900), priority: PLUGIN_PRIORITY[s.id] ?? 3 });
  }
  const goals = (mind?.goals || []).filter((x) => x && !x.done).slice(0, 4);
  if (goals.length) sections.push({ title: 'Your goals', text: goals.map((x) => `- ${clip(x.text, 100)}`).join('\n'), priority: 2 });

  const convo = Array.isArray(mind?.conversation) ? mind.conversation.slice(-13) : [];
  // The newest player line is the message itself; do not repeat it in the log.
  if (convo.length && convo[convo.length - 1].role === 'player' && convo[convo.length - 1].text === message) convo.pop();
  const turns = convo.slice(-12).map((t) => `${t.role === 'player' ? playerName : 'You'}: ${clip(t.text, 220)}`);

  const tail = [];
  const asks = [];
  for (const a of executed.slice(0, 8)) {
    const gut = a.verdict ? `; ${gutLine(a.verdict)}` : '';
    if (a.ok) asks.push(`- ${a.name}(${argText(a.args)}): DONE already, you agreed${a.message ? ` ("${clip(a.message, 100)}")` : ''}${gut}. Do not repeat it.`);
    else if (a.refused) asks.push(`- ${a.name}(${argText(a.args)}): NOT done, you refused${a.message ? `: "${clip(a.message, 120)}"` : ''}${gut}. If you change your mind, do it with the action.`);
    else asks.push(`- ${a.name}(${argText(a.args)}): tried, it failed${a.message ? `: "${clip(a.message, 120)}"` : ''}.`);
  }
  for (const r of requests.slice(0, 4)) {
    asks.push(`- "${clip(r.text, 80)}" -> ${r.name}(${argText(r.args)}): not done yet; ${r.verdict ? gutLine(r.verdict) : 'weigh it yourself'}. If you agree, do it with the action.`);
  }
  if (asks.length || offer) {
    tail.push(`\n# What ${playerName} asks of you`);
    tail.push(...asks);
    if (offer?.coins) tail.push(`They offer you ${offer.coins} coins${offer.paid ? ' (already handed over)' : ''} for it.`);
    else if (offer?.share) tail.push('They offer you a fair share of the take.');
    else if (offer) tail.push('They offer to pay you.');
  }
  if (task) tail.push(`\n${task}`);
  else {
    tail.push(`\n# ${playerName} says`);
    tail.push(`"${clip(message, 600)}"`);
    tail.push('\nReply as yourself with the JSON object only.');
  }

  // Fit the budget. What she recalls for this message matters most after the message itself,
  // so it is shortened (whole lines, from the end) before it is ever dropped.
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
  const over = () => text.length > budget;
  const shrinkRecall = (to) => {
    const i = secs.findIndex((s) => s.recall);
    if (i < 0) return;
    const cut = shortenLines(secs[i].text, Math.max(to, secs[i].text.length - (text.length - budget)));
    if (cut === secs[i].text) return;
    secs = secs.map((s, k) => (k === i ? { ...s, text: cut } : s));
    text = render(secs, tns);
  };
  while (over() && tns.length > 6) {
    tns.shift();
    text = render(secs, tns);
  }
  if (over()) shrinkRecall(Math.round(budget * 0.4));
  while (over() && secs.some((s) => !s.recall)) {
    // Drop the least important other section first.
    let lo = -1;
    for (let i = 0; i < secs.length; i++) if (!secs[i].recall && (lo < 0 || secs[i].priority < secs[lo].priority)) lo = i;
    secs = secs.filter((_, i) => i !== lo);
    text = render(secs, tns);
  }
  while (over() && tns.length > 2) {
    tns.shift();
    text = render(secs, tns);
  }
  if (over()) shrinkRecall(600);
  if (over()) {
    secs = [];
    text = render(secs, tns);
  }
  while (over() && tns.length) {
    tns.shift();
    text = render(secs, tns);
  }
  if (over()) {
    // Keep the end (the request and the message); cut from the middle of the head.
    const end = tail.join('\n');
    text = `${render([], []).slice(0, Math.max(0, budget - end.length - 2))}\n${end}`.slice(-budget);
  }
  return text;
}

// Plugin prompt sections by how much they help her answer (higher stays longer).
const PLUGIN_PRIORITY = { quest: 3.6, relationships: 3.4, autonomy: 3.8, social: 3, world: 2.4, jobs: 2.6, feelings: 2.2 };

// Whole lines of text, at most `max` characters (the first line is kept, clipped).
function shortenLines(text, max) {
  const t = String(text || '');
  if (t.length <= max) return t;
  const lines = t.split('\n');
  const out = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length + 1 > max) break;
    out.push(line);
    len += line.length + 1;
  }
  return out.length ? out.join('\n') : clip(lines[0], max);
}

export function contextBudget(rules) {
  return Math.max(MIN_CONTEXT, PROMPT_BUDGET - rules.length);
}

// Chat prompt: { rules, context, recall } (the claude.ai provider joins rules and context).
export function buildChatPrompt(game, message, executed = [], { requests = [], offer = null } = {}) {
  const rules = buildRules(game);
  const budget = contextBudget(rules);
  const recall = recallFor(game, message, RECALL_BUDGET);
  const context = buildContext(game, { message, executed, requests, offer, recall, budget });
  return { rules, context, recall };
}

// ------------------------------------------------------------ reflection

export function buildReflectionTask(game, memories, { day } = {}) {
  const g = game || {};
  const mind = g.companion?.mind;
  const playerName = g.settings?.playerName || 'the traveler';
  const state = companionshipOf(g);
  const rel = playerRel(g);
  const lines = [];
  lines.push('# Tonight');
  const where = state === 'left' ? 'in your rented room at the Ember Kettle, away from them' : 'in bed';
  lines.push(`Day ${day ?? g.clock?.day ?? 1} is over. You are ${where}, writing in your diary before sleep.`);
  lines.push(`\n# The day's most important memories (most important first)`);
  if (memories.length) for (const m of memories.slice(0, 12)) lines.push(`- [${m.importance ?? 3}] ${clip(m.text, 200)}`);
  else lines.push('- A quiet day; nothing stood out.');
  lines.push(`\n# You and ${playerName}`);
  lines.push(`Companionship: ${STATE_TEXT[state] || state} Trust ${Math.round(rel.trust)}, fear ${Math.round(rel.fear)}, affinity ${Math.round(rel.affinity)}.`);
  const deeds = ledgerOf(g, 4);
  if (deeds.length) lines.push(`What they did lately: ${deeds.map((d) => `${d.deed}${d.text ? ` (${clip(d.text, 60)})` : ''}`).join('; ')}.`);
  const people = new Set();
  for (const m of memories) for (const a of m.about || []) if (a && a !== 'lyra') people.add(a);
  const rels = [];
  for (const id of people) {
    if (id === 'player') continue;
    const r = safeCall(() => mind?.relationships?.get?.(id));
    if (r) rels.push(`- ${id} (${r.name || id}): ${relSummary(r)}`);
    if (rels.length >= 5) break;
  }
  if (rels.length) lines.push(`\n# People you spent time with\n${rels.join('\n')}`);
  const plan = planSection(g);
  if (plan) lines.push(`\n# ${plan}`);
  const goals = (mind?.goals || []).filter((x) => x && !x.done).slice(0, 4);
  if (goals.length) lines.push(`\n# Your goals\n${goals.map((x) => `- ${clip(x.text, 100)}`).join('\n')}`);
  lines.push('\n# Task');
  lines.push(
    `Write today's diary entry: first person, 80-150 words, honest and personal, in your own voice. You write for yourself, not for ${playerName}. Mention specific things that happened, how you feel about ${playerName} and the people above, and what you want for yourself tomorrow. Then give your updated one-line opinion of up to 3 people you spent time with (use their ids, "player" for ${playerName}), at most one new personal goal (or null), and a one-sentence summary of the day for your memory.`,
  );
  lines.push('For this task reply with exactly one JSON object and nothing else: {"diary": string, "opinions": [{"person": string, "opinion": string}], "goal": string|null, "summary": string}');
  return lines.join('\n');
}

// ---------------------------------------------------------- conversations

export function knownFacts(profile, familiarity = 0) {
  const facts = Array.isArray(profile?.facts) ? profile.facts : [];
  return facts.filter((f) => f && f.text && (f.minFamiliarity ?? 0) <= familiarity);
}

// Lore entries this villager knows and could share (DESIGN §17.2), never secrets.
export function loreKnownBy(game, npcId, topic = null, max = 4) {
  const mind = game?.companion?.mind;
  const book = mind?.lorebook || game?.lorebook || null;
  let entries = [];
  if (book?.knownBy) entries = safeCall(() => book.knownBy(npcId), []) || [];
  if (topic && book?.search) {
    const hits = safeCall(() => book.search(topic, { limit: 4, knownBy: npcId }), []) || [];
    entries = hits.concat(entries);
  }
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!e || e.secret || !e.text) continue;
    const id = e.id ?? e.title;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: e.title || e.name || '', text: clip(e.text, 220) });
    if (out.length >= max) break;
  }
  return out;
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
  if (g.player?.crime) lines.push(`${name} is shaken: the traveler you came with attacked someone in the village.`);
  const facts = knownFacts(prof, fam);
  if (facts.length) {
    lines.push(`\n# What ${name} might share (only these; pick what fits)`);
    for (const f of facts.slice(-6)) lines.push(`- ${clip(f.text, 200)}${f.topic ? ` (${f.topic})` : ''}`);
  }
  const lore = loreKnownBy(g, npc?.id, topic);
  if (lore.length) {
    lines.push(`\n# What ${name} knows of the valley's lore (may share one if it fits)`);
    for (const e of lore) lines.push(`- ${e.title ? `${e.title}: ` : ''}${e.text}`);
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
