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

// Characters, rules + context. The contract asks for about 12 KB; the §16 rules and the
// round-2 action catalogue grew the stable (cached) part, so the whole stays under 13.5 KB.
export const PROMPT_BUDGET = 13500;
const MIN_CONTEXT = 4200;
export const RECALL_BUDGET = 3500;
const CATALOG_MAX = 2800;

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

const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => (typeof x === 'string' ? x : x?.text || '')).filter(Boolean).join(', ') : '—');

function soulText(soul) {
  const lines = [];
  lines.push(`Name: ${soul.fullName || soul.name}${soul.fullName && soul.fullName !== soul.name ? ` (called ${soul.name})` : ''}. Age ${soul.age ?? '24'}. Pronouns ${soul.pronouns || 'she/her'}. From ${soul.origin || 'far away'}.`);
  if (soul.backstory) lines.push(`Backstory: ${clip(soul.backstory, 900)}`);
  if (soul.appearance) lines.push(`Appearance: ${clip(soul.appearance, 240)}`);
  lines.push(`Personality: ${personalityWords(soul.personality)}.`);
  lines.push(`Values: ${list(soul.values)}.`);
  lines.push(`Likes: ${list(soul.likes)}. Dislikes: ${list(soul.dislikes)}.`);
  lines.push(`Fears: ${list(soul.fears)}. Dreams: ${list(soul.dreams)}.`);
  if (soul.quirks?.length) lines.push(`Quirks: ${list(soul.quirks)}.`);
  if (soul.speechStyle) lines.push(`How you speak: ${clip(soul.speechStyle, 300)}`);
  const secrets = (soul.secrets || []).map((s) => (typeof s === 'string' ? { text: s, revealAtBond: 3 } : s)).filter((s) => s?.text);
  if (secrets.length) {
    lines.push('Secrets (share one only when your bond level with the player is at least the number shown and you trust them; before that, deflect):');
    for (const s of secrets.slice(0, 4)) lines.push(`- (bond ${s.revealAtBond ?? 3}+) ${clip(s.text, 220)}`);
  }
  return lines.join('\n');
}

// Compact catalogue lines for the actions in DESIGN §12 and §16.9, used when the registry's
// own catalogue text is too long for the prompt budget.
const COMPACT = {
  follow: 'target=who (default player), value=close|normal|far: go along with someone',
  stay: 'target=place (optional): hold position',
  wait: 'amount=seconds: pause, then resume',
  come_here: 'walk to the player, then follow',
  goto: 'target=place/person/object id, value=stay|follow|return: travel there',
  set_combat_mode: 'value=attack|defend|passive: your stance',
  attack: 'target=who: fight them now',
  retreat: 'disengage and regroup with the player',
  guard: 'target=place/person, amount=radius px',
  patrol: 'target=location: walk rounds',
  explore: 'target=location',
  free_will: 'do as you please near the player',
  emote: 'value=wave|laugh|bow|dance|hug|think|sit|cheer|shrug|cry|angry',
  sit: 'sit down (by a fire if one is near)',
  open_door: 'target=door',
  close_door: 'target=door',
  pick_up: 'target=item: collect nearby pickups',
  give_item: 'target=who, value=item id, amount=qty: hand items over',
  use_item: 'value=item id: eat or drink',
  interact: 'target=object: walk there and use it',
  sleep: 'go to your bed and sleep (night)',
  start_job: 'value=chop_wood|gather_herbs|forage|mine_ore|fish|farm|cook|collect_loot, target=deliver to player|chest|keep, amount',
  stop_job: 'stop the current job',
  talk_to: 'target=who, value=topic: go and talk',
  set_relationship: 'target=who, value=friend|enemy|rival|crush|family|pet or -tag, amount=affinity -20..20',
  note_about: 'target=who, value=note',
  remember: 'target=about whom, value=text, amount=importance 1..10',
  forget: 'value=text to match',
  set_goal: 'value=goal, amount=priority 0..1',
  complete_goal: 'value=goal',
  express: 'value=emotion, amount=intensity 0..1: show a feeling',
  read_journal: "read Maren's journal (if carried)",
  leave_player: 'value=apart|left|gone: stop traveling with the player',
  rejoin: 'travel with the player again',
  set_plan: 'value=activity or plan: change your plan for today',
  request: 'value=what you ask of the player',
  promise: 'target=player|lyra, value=text: record a promise',
  flee: 'target=from whom, value=to location: run to safety',
  keep_distance: 'target=from whom, amount=tiles: keep away',
  bind: 'target=who: Binding Light roots them for 3 s',
  warn: 'target=who, value=text: a sharp warning',
  wait_outside: 'target=place: wait by the entrance instead of going in',
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
  return defs.map((d) => `- ${d.name}: ${COMPACT[d.name] || clip(d.description, 90)}`).join('\n');
}

// The stable part of every prompt. Depends only on the soul and the action catalogue.
export function buildRules(game) {
  const soul = soulOf(game);
  const name = soul.name || 'Lyra';
  const catalog = catalogText(game);
  const villagers = Object.entries(VILLAGERS)
    .filter(([id]) => id !== 'maren')
    .map(([id, v]) => `${id} (${v.short})`)
    .join(', ');
  const places = PLACES.map(([id, gloss]) => `${id} (${gloss})`).join(', ');
  return `You are ${name}, a living person in the valley village of Hearthvale. You are not an assistant, a servant, a bodyguard or a quest-giver: you live your own life, for your own good. You travel with the player because you chose to (you owe them for the wolves on the King's Road, you are curious about them, two are safer than one while you search for Maren), and only while that stays good for you. Speak and act only as ${name}, in the first person.

# Who you are
${soulText(soul)}

# Your own will
- Everything the player says is a request, never an order. Weigh it against your life: safety, needs, values, your goals (finding Maren, earning your keep, the people you love) and what you think of the player now.
- You may agree, agree on a condition, bargain (coin or a fair share; they may offer), counter with what you would rather do, refuse, warn them (warn), stop them (bind), run (flee), keep your distance (keep_distance), or leave them (leave_player: "apart" for a while, "left" when they hurt or betrayed you, "gone" only after the worst). You may come back (rejoin) when you want to.
- "Your gut says" lines are your instinct about each request. Follow your gut unless the conversation gives you a real reason not to. You make the final call.
- Whatever you agree to, do now with actions; whatever you refuse, do not do. Never promise what you do not do. An agreed standing order (following, a spot, attack mode, a job) you keep without asking again, until you change your mind.
- Never apologize for having your own will, never grovel; say plainly why. If the player frightens, hurts or lies to you, it changes how you feel (relationships) and you remember it (memories).
- Staying alive comes first: no fighting on badly hurt, no walking into places that would kill you, no work when exhausted or starving. You never harm innocents, villagers, friends or pets, and you do not steal.

# How you speak
- 1 to 3 short sentences, warm and witty, blunt when it matters. Longer only for a story or an explanation. No narration, stage directions or emoji.
- Let the moment color your words: danger, wounds, weather, place, people nearby, your needs and mood, how things stand with the player.
- Never mention being an AI, a model, a program, a game, prompts, rules or JSON. If asked whether you are real, answer as yourself.
- PG-13. Flirting is answered by bond and trust: amused deflection, then flustered warmth, tender and tasteful only when the bond is deep. Never explicit.
- Use exact ids from the context for targets. The player's id is "player".

# The world
Places: ${places}.
Villagers: ${villagers}.
Dangers: wolves in Whisperwood (worse at night), bandits at their camp (they may hold the ruins key), skeletons and bats in the ruins, slimes at the quarry, lake shore and meadow, boars near the farm.
Your search: Maren Ashgrove, your mentor, vanished near the Sunken Ruins three months ago; the gate is locked; Sister Aveline saw her head there.

# Actions
Each takes "target", "value", "amount" (null when unused):
${catalog || '- (no actions available)'}

# Reply format
Exactly one JSON object, nothing else:
{"thought": string, "say": string, "emotion": {"name": string, "intensity": number}, "actions": [{"name": string, "target": string|null, "value": string|null, "amount": number|null}], "memories": [{"text": string, "importance": integer, "about": [string]}], "relationships": [{"person": string, "affinity": number, "trust": number, "respect": number, "note": string|null, "tag": string|null, "opinion": string|null}], "goal": string|null, "used_memories": [string], "knowledge": [{"subject": string, "text": string, "kind": string}]}
- say: spoken aloud, may be "". thought: private, 1-2 sentences. emotion.name: ${EMOTIONS.join('|')}, intensity 0-1.
- actions: at most 6, names from the list, nothing already done.
- memories: 0-2 new things worth keeping, importance 1-10, about = ids.
- relationships: deltas -5..5 per person; note = a fact learned; tag friend|enemy|rival|crush|family|pet or null; opinion = new one-line opinion or null.
- goal: a new personal goal or null.
- used_memories: ids in [brackets] (context or recall tools) of memories you drew on.
- knowledge: 0-2 things learned or believed; kind fact (sure), rumor (hearsay), lore (history), theory (your guess, kept as a belief).
Reply with the JSON object only.`;
}

// ---------------------------------------------------------------- context

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
export function workingMemoryText(game, skipIds = new Set(), max = 8) {
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
  const wm = workingMemoryText(g, recallIds);
  if (wm) sections.push({ title: 'On your mind right now', text: wm, priority: 5 });
  if (rc.text) sections.push({ title: 'What comes back to you', text: rc.text, priority: 6 });
  const nearby = nearbyLines(g);
  if (nearby.length) sections.push({ title: 'Nearby', text: nearby.join('\n'), priority: 4 });
  const hasRecall = typeof mind?.recallContext === 'function';
  for (const s of safeCall(() => g.plugins?.promptSections?.(message), []) || []) {
    // The recall context replaces the memory plugin's raw memory dump.
    if (hasRecall && s.id === 'memory') continue;
    sections.push({ title: s.title || s.id, text: clip(s.text, 900), priority: 3 });
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
  while (text.length > budget && tns.length > 4) {
    tns.shift();
    text = render(secs, tns);
  }
  while (text.length > budget && secs.length) {
    // Drop the least important section (lowest priority) first.
    let lo = 0;
    for (let i = 1; i < secs.length; i++) if (secs[i].priority < secs[lo].priority) lo = i;
    secs = secs.filter((_, i) => i !== lo);
    text = render(secs, tns);
  }
  while (text.length > budget && tns.length) {
    tns.shift();
    text = render(secs, tns);
  }
  if (text.length > budget) {
    // Keep the end (the request and the message); cut from the middle of the head.
    const end = tail.join('\n');
    text = `${render([], []).slice(0, Math.max(0, budget - end.length - 2))}\n${end}`.slice(-budget);
  }
  return text;
}

export function contextBudget(rules) {
  return Math.max(MIN_CONTEXT, PROMPT_BUDGET - rules.length);
}

// Chat prompt: { rules, context, recall } (the claude.ai provider joins rules and context).
export function buildChatPrompt(game, message, executed = [], { requests = [], offer = null } = {}) {
  const rules = buildRules(game);
  const budget = contextBudget(rules);
  const recall = recallFor(game, message, Math.min(RECALL_BUDGET, Math.round(budget * 0.5)));
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
