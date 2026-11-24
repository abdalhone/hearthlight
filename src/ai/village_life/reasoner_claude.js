// Claude thinking for the villagers (DESIGN §28 "Claude thinks for them"). Only with a
// Claude provider (claude.ai or the player's own key) and the setting "Villagers think with
// Claude: always", and only when someone has a real problem: never for idle chatter.
//
// Batched: one call decides for every villager with a decision pending (up to six).
// Budgeted: at most one call every ~30 real seconds, a cap per session, the quick tier,
// a compact prompt and strict JSON. Validated: an action, target or line that is not one
// of that villager's own options is dropped and the local reasoner decides instead. The
// prompt carries only what each villager knows (sightings, habits, what they were told):
// no secrets, nothing LORE §9.10 keeps hidden, and every line Claude writes is checked.
// It never blocks the game: callers carry on with the local reasoner while it waits.

import { ACTIONS } from './problems.js';
import { speakable } from '../social/hidden.js';

export const THINK_GAP = 30; // real seconds between calls
export const THINK_CAP = 40; // calls per session
export const THINK_BATCH = 6;
export const THINK_TIMEOUT_MS = 20000;

export const THINK_RULES = [
  'You decide what villagers of Hearthvale do next when something in their day has gone wrong. Hearthvale is a small warded village of about a hundred and fifty people in a cosy fantasy valley. Each villager below has a real problem: an errand they cannot finish because someone is not where they should be, a shop that is shut, goods that are gone, or a neighbour nobody can find.',
  'Think as each of them, from ONLY what the brief says they know. Never invent sightings, injuries, deaths, crimes, secrets or reasons why someone is gone. They do not know why; at most they guess, as people do. Keep each villager in their own voice (the voice note), short and spoken.',
  'For each villager give: "thought" (their private first-person thought, one short sentence), "say" (what they say aloud right now, one short sentence in their voice, or "" to say nothing), "action" (one of that villager\'s options), "target" (an id from that option\'s list; null for wait, give_up and alarm; "lyra" for tell_lyra) and "belief" (a short guess where the person might be, or null).',
  'Actions: go = walk to a place and look; search = search a place properly; ask = ask a person; wait = wait here a while; alarm = tell the watch (Captain Rowan or Wys); give_up = leave it for today; tell_lyra = ask Lyra, who sees a lot.',
  'People are sensible: look where the person usually is, ask whoever is close or most likely to know, follow any word of where they went, and when it stops making sense either tell the watch or let it go. Family and close friends do not let it go.',
  'Reply with JSON only: {"decisions":[...]}, one entry per villager, in the order given.',
].join('\n');

export const THINK_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          who: { type: 'string' },
          thought: { type: 'string' },
          say: { type: 'string' },
          action: { type: 'string', enum: ACTIONS },
          target: { type: ['string', 'null'] },
          belief: { type: ['string', 'null'] },
        },
        required: ['who', 'thought', 'say', 'action', 'target', 'belief'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
};

const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();
  return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t;
};

const KIND_TEXT = {
  absent: (I) => `came to ${I.shop || I.hereName || 'find them'} to ${I.purpose || 'see them'}; ${I.aboutName} is not there`,
  shut: (I) => `came to ${I.shop || I.hereName} to ${I.purpose}; ${I.aboutName} is not there and the shop is shut`,
  item: (I) => `came to ${I.purpose}, but ${I.aboutName || 'the seller'} has none left`,
  blocked: (I) => `went to ${I.hereName} to ${I.purpose}, but something dangerous is there`,
  worried: (I) => `heard that nobody has seen ${I.aboutName}, and is worried`,
};

function careText(c) {
  if (c >= 0.95) return 'family: will not let it go';
  if (c >= 0.7) return 'very fond of them';
  if (c >= 0.5) return 'fond of them';
  return 'not close: they only needed them for the errand';
}

// One villager's brief, compact.
export function briefFor(I, i) {
  const L = [];
  L.push(`[${i + 1}] who="${I.who}" ${I.name}, ${I.role}. Voice: ${clip(I.voice, 150)}`);
  L.push(`Problem since ${I.sinceText} (${I.elapsedH} h ago; now ${Math.floor(I.hour)}:${String(Math.round((I.hour % 1) * 60)).padStart(2, '0')}): ${(KIND_TEXT[I.kind] || KIND_TEXT.absent)(I)}. Now at ${I.hereName}.`);
  if (I.about) {
    const where = [];
    if (I.habitNow) where.push(`usually at ${I.habitNow.name} at this hour`);
    if (I.home) where.push(`lives at ${I.home.name}`);
    if (where.length) L.push(`${I.aboutName}: ${where.join('; ')}.`);
    const knows = [];
    if (I.ownSeen) knows.push(`${I.name} last saw ${I.aboutName} ${I.ownSeen.when} at ${I.ownSeen.placeName}${I.ownSeen.withName ? ` with ${I.ownSeen.withName}` : ''}`);
    else knows.push(`${I.name} has not seen ${I.aboutName} lately`);
    for (const h of I.heard || []) {
      if (h.kind === 'seen') knows.push(`${h.fromName} saw them ${h.when} at ${h.placeName}${h.withName ? ` with ${h.withName}` : ''}${h.headingName ? `, heading for ${h.headingName}` : ''}`);
      else if (h.kind === 'heard') knows.push(`${h.fromName} heard they were at ${h.placeName}`);
      else if (h.kind === 'guess') knows.push(`${h.fromName} guessed ${h.placeName}`);
      else knows.push(`${h.fromName} has not seen them`);
    }
    L.push(`Knows: ${knows.join('; ')}.`);
    L.push(`Cares: ${careText(I.care)}. Watch: ${I.caseSearching ? 'already searching' : I.watchKnows ? 'told' : 'not told'}.`);
  }
  if (I.checked?.length) L.push(`Already looked: ${I.checked.join(', ')}.`);
  if (I.asked?.length) L.push(`Already asked: ${I.asked.join(', ')}.`);
  const opts = [];
  for (const o of I.options || []) {
    if (o === 'go' || o === 'search') {
      if (o === 'search' && !I.options.includes('go')) continue;
      if (o === 'go') opts.push(`go|search -> ${(I.places || []).map((p) => `${p.id} (${p.name}${p.checked ? ', looked' : ''}: ${p.why})`).join('; ')}`);
    } else if (o === 'ask') {
      const a = (I.askable || []).map((x) => `${x.id} (${x.name}: ${x.why}${x.near ? ', close by' : ''})`).join('; ');
      if (a) opts.push(`ask -> ${a}`);
    } else opts.push(o);
  }
  L.push(`Options: ${opts.join(' | ')}`);
  return L.join('\n');
}

export function buildThinkTask(inputs) {
  return [`Villagers with a problem right now (${inputs.length}):`, ...inputs.map((I, i) => briefFor(I, i))].join('\n\n');
}

const BAD_WORDS = /\b(ai|a\.i\.|claude|language model|json|assistant|prompt|npc|game)\b/i;

function cleanLine(s, n) {
  const t = clip(s, n);
  if (!t || BAD_WORDS.test(t) || !speakable(t)) return '';
  return t;
}

// Claude's answer -> Map(who -> decision), keeping only what each villager could really do.
export function coerceDecisions(raw, inputs) {
  const out = new Map();
  const list = Array.isArray(raw?.decisions) ? raw.decisions : Array.isArray(raw) ? raw : [];
  const byWho = new Map(inputs.map((I) => [I.who, I]));
  for (let k = 0; k < list.length; k++) {
    const d = list[k];
    if (!d || typeof d !== 'object') continue;
    const who = typeof d.who === 'string' && byWho.has(d.who) ? d.who : inputs[k]?.who;
    const I = byWho.get(who);
    if (!I || out.has(who)) continue;
    const type = typeof d.action === 'object' && d.action ? d.action.type : d.action;
    let target = typeof d.action === 'object' && d.action ? d.action.target ?? d.target : d.target;
    if (!ACTIONS.includes(type) || !(I.options || []).includes(type)) continue;
    if (type === 'go' || type === 'search') {
      if (!(I.places || []).some((p) => p.id === target)) continue;
    } else if (type === 'ask') {
      if (!(I.askable || []).some((a) => a.id === target)) continue;
    } else if (type === 'tell_lyra') target = 'lyra';
    else target = null;
    const thought = cleanLine(d.thought, 160);
    const say = cleanLine(d.say, 130);
    const belief = typeof d.belief === 'string' && d.belief.trim() ? cleanLine(d.belief, 100) || null : null;
    out.set(who, { action: { type, target }, thought, say, belief, source: 'claude' });
  }
  return out;
}

export class ClaudeReasoner {
  constructor(life, { gap = THINK_GAP, cap = THINK_CAP, batch = THINK_BATCH, timeoutMs = THINK_TIMEOUT_MS, provider = null } = {}) {
    this.life = life;
    this.gap = gap;
    this.cap = cap;
    this.batch = batch;
    this.timeoutMs = timeoutMs;
    this.fixedProvider = provider;
    this.calls = 0;
    this.ok = 0;
    this.failed = 0;
    this.decided = 0;
    this.lastAt = -Infinity;
    this.busy = false;
    this.backoffUntil = -Infinity;
    this.streak = 0;
    this.disabled = false;
    this.lastError = null;
  }

  rt() {
    return this.life.game?.time ?? 0;
  }

  provider() {
    if (this.fixedProvider) return this.fixedProvider;
    try {
      return this.life.game?.brain?.providers?.current?.() || null;
    } catch {
      return null;
    }
  }

  enabled() {
    return !this.disabled && this.life.game?.settings?.villageAi === 'always' && !!this.provider();
  }

  ready() {
    return this.enabled() && !this.busy && this.calls < this.cap && this.rt() - this.lastAt >= this.gap && this.rt() >= this.backoffUntil;
  }

  // Seconds until a call could go out (Infinity when it never will this session).
  waitFor() {
    if (!this.enabled() || this.calls >= this.cap) return Infinity;
    const t = this.rt();
    return Math.max(0, this.lastAt + this.gap - t, this.backoffUntil - t, this.busy ? 2 : 0);
  }

  // Decide for these villagers. Resolves to Map(who -> decision); empty on any failure.
  async decide(inputs) {
    if (!inputs?.length || !this.ready()) return new Map();
    const batch = inputs.slice(0, this.batch);
    const provider = this.provider();
    this.busy = true;
    this.calls++;
    this.lastAt = this.rt();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => {
        try {
          ctrl?.abort?.();
        } catch {
          /* ignore */
        }
        resolve('__timeout__');
      }, this.timeoutMs);
    });
    try {
      const task = buildThinkTask(batch);
      const call = Promise.resolve().then(() => provider.complete({ rules: THINK_RULES, task, schema: THINK_SCHEMA, tier: 'quick', signal: ctrl?.signal, maxTokens: 260 * batch.length + 200 }));
      const raw = await Promise.race([call, late]);
      if (raw === '__timeout__') throw Object.assign(new Error('timed out'), { code: 'timeout' });
      const out = coerceDecisions(raw, batch);
      this.ok++;
      this.streak = 0;
      this.decided += out.size;
      this.lastError = null;
      return out;
    } catch (err) {
      this.failed++;
      this.streak++;
      this.lastError = err?.code || err?.message || 'failed';
      if (err?.permanent) this.disabled = true;
      // Back off: longer after each failure in a row.
      this.backoffUntil = this.rt() + (this.streak >= 3 ? 600 : 90);
      if (err?.code !== 'cancelled' && err?.code !== 'timeout') console.warn('[village life] Claude could not think for the villagers:', err?.code || err);
      return new Map();
    } finally {
      clearTimeout(timer);
      this.busy = false;
    }
  }

  stats() {
    return { enabled: this.enabled(), calls: this.calls, cap: this.cap, ok: this.ok, failed: this.failed, decided: this.decided, busy: this.busy, lastError: this.lastError, waitFor: this.waitFor() };
  }

  serialize() {
    return { calls: this.calls, ok: this.ok, failed: this.failed, decided: this.decided };
  }
}
