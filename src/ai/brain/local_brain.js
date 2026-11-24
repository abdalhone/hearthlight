// Lyra's offline mind: turns the NLU's understanding of a message into her reply,
// answering from real game data (her mind, the world, her soul) in her own voice,
// and deciding how the exchange changes her feelings, memories and relationships.
// Used whenever Claude is unavailable, and as the fallback when a Claude call fails.

import { speechContext, moodKey, bondLevel, lowerFirst, bare } from './speech_gen.js';
import { resolvePerson } from './effects.js';
import { soulOf, VILLAGERS } from './soul_fallback.js';
import { ITEMS, itemName, resolveItemId } from '../../entities/items.js';
import { matchBuiltinClause } from './nlu.js';
import { companionshipOf, playerRel, ledgerOf, agendaOf, isRefusal, reasonText, ACCEPTED } from './her_state.js';

export const JOB_LABELS = {
  chop_wood: 'chopping wood',
  gather_herbs: 'gathering herbs',
  forage: 'foraging',
  mine_ore: 'mining',
  fish: 'fishing',
  farm: 'helping on the farm',
  cook: 'cooking',
  collect_loot: 'collecting the loot',
  patrol: 'patrolling',
  guard: 'standing guard',
};

// Verb phrases for "I'll {counter}" and for her plans.
const JOB_VERBS = {
  chop_wood: 'chop some wood',
  gather_herbs: 'gather herbs',
  forage: 'forage for berries',
  mine_ore: 'mine some ore',
  fish: 'fish',
  farm: 'help Tobias on the farm',
  cook: 'cook something',
  collect_loot: 'collect the loot',
  patrol: 'walk the rounds',
  guard: 'stand guard',
};

const JOB_NOUNS = { chop_wood: 'wood', gather_herbs: 'herbs', forage: 'forage', mine_ore: 'ore', fish: 'fish', farm: 'crops', cook: 'meals', collect_loot: 'loot' };

export function jobLabel(job, amount) {
  const base = JOB_LABELS[job] || String(job || 'work').replace(/_/g, ' ');
  if (amount && JOB_NOUNS[job]) {
    if (job === 'chop_wood') return `chopping ${amount} wood`;
    if (job === 'fish') return `catching ${amount} fish`;
    if (job === 'gather_herbs') return `gathering ${amount} herbs`;
    if (job === 'mine_ore') return `mining ${amount} ore`;
  }
  return base;
}

export function listJoin(arr) {
  const a = (arr || []).filter(Boolean).map(String);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

export function firstName(name) {
  const n = String(name || '').trim();
  if (/^(?:sister|captain|brother|old)\s/i.test(n)) return n.split(/\s+/).slice(0, 2).join(' ');
  return n.split(/\s+/)[0] || n;
}

export function dirName(dx, dy) {
  const ang = Math.atan2(dy, dx);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const i = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return dirs[i];
}

function sentences(text) {
  return (String(text || '').match(/[^.!?]+[.!?]+/g) || [String(text || '')]).map((s) => s.trim()).filter(Boolean);
}

function pickSentence(text, re) {
  return sentences(text).find((s) => re.test(s)) || null;
}

// Third-person soul text ("She could not save her brother") -> first person.
export function toFirstPerson(text) {
  return String(text || '')
    .replace(/\bShe\b/g, 'I')
    .replace(/\bshe\b/g, 'I')
    .replace(/\bherself\b/g, 'myself')
    .replace(/\bI is\b/g, 'I am')
    .replace(/\bI has\b/g, 'I have')
    .replace(/\bI does\b/g, 'I do')
    .replace(/\b(I|still|also|never|always|and) (blame|love|hate|miss|want|keep|think|wish|fear|hope|dream|feel|carr(?:y|ie)|lie)s\b/g, (m, a, b) => `${a} ${b.replace(/ie$/, 'y')}`)
    .replace(/\bher\b/g, 'my')
    .replace(/\bLyra\b/g, 'I');
}

const AFFINITY_TAKES = [
  [60, 'I adore {name}. Truly.'],
  [30, 'I like {name}. A lot, actually.'],
  [8, "{name} is good people. I'm warming up."],
  [-15, "I'm not sure about {name} yet."],
  [-40, "I don't trust {name}."],
  [-200, "I can't stand {name}."],
];

const PLACE_TAKES = {
  hearthvale: 'I like it here. People wave at you, and the bread is warm.',
  town_square: 'The heart of the village. Everyone passes through eventually.',
  player_home: 'Our cottage. Small, a little drafty, and somehow already home.',
  ember_kettle: "Best room in the valley. Elda's stew could raise the dead. Please don't tell the skeletons.",
  smithy: "Hot, loud, smells of iron. Bram pretends he doesn't like company.",
  general_store: "Gale's shop. You can buy anything there, if you're willing to overpay.",
  chapel: 'Quiet. The candles never seem to burn down. I feel watched, but kindly.',
  herbalist: "Mira's little shop smells like summer. I could stay in there all day.",
  guardhouse: "Rowan's domain. Lots of maps, very little sleep.",
  whisperwood: 'I love the forest. Even the wolves, a little. From a distance.',
  stonecut_quarry: 'Loud, dusty, full of slimes. Useful, though.',
  bandit_camp: "A nest of thieves. I'd burn it if it wouldn't spread to the trees.",
  mirror_lake: "Beautiful. Deep. I'll admire it from the shore, thank you.",
  sunken_ruins: "That place took Maren. I hate it. And I need it.",
  south_meadow: 'Flowers up to my knees and rabbits everywhere. Perfect.',
  kings_road: "The road where we met. I'm fond of it, wolves and all.",
};

export class LocalBrain {
  constructor(game, speech) {
    this.game = game;
    this.speech = speech;
    this.insults = 0;
    this.lastInsultAt = -1e9;
    this.lastGreetAt = -1e9;
    this.lastCareAt = -1e9;
  }

  get mind() {
    return this.game?.companion?.mind || null;
  }

  now() {
    return this.game?.time ?? 0;
  }

  line(situation, vars = {}) {
    return this.speech.line(situation, vars, speechContext(this.game));
  }

  // ------------------------------------------------------------------ reply

  // parsed: from nlu.parseMessage, with clause.results filled for actions already run.
  compose(parsed, env = null) {
    const reply = { say: '', thought: null, emotion: null, memories: [], relationships: [], goal: null, actions: [], apology: null };
    const state = env?.companionship || companionshipOf(this.game);
    const parts = [];
    for (const clause of parsed.clauses) {
      let text = null;
      try {
        text = this.answer(clause, reply, env, state);
      } catch (err) {
        console.error('[brain] offline answer failed', err);
      }
      if (text && !parts.includes(text)) parts.push(text);
    }
    if (!parsed.clauses.length && parsed.offer) parts.push(this.line('offer_nothing'));
    reply.say = joinParts(parts) || this.line(state === 'left' ? 'left_reply' : state === 'wary' ? 'wary_reply' : 'unknown_statement') || 'Hm.';
    return reply;
  }

  answer(clause, reply, env, state = 'together') {
    const it = clause.intent;
    // Gone or broken off: she does not chat like a companion. Requests still get her refusal,
    // and a few things (an apology, "why did you leave?") still reach her.
    if (state === 'left' && !(it && (it.actions?.length || LEFT_HEARS.has(it.id)))) {
      if (reply._coldSaid) return null;
      reply._coldSaid = true;
      return this.line('left_reply');
    }
    if (!it) return this.unknown(clause, reply, state);
    if (it.id === 'counter.take') return `${this.line('counter_taken')} ${this.ack(clause, reply)}`.trim();
    if (it.id === 'counter.decline') return this.line('counter_declined');
    if (it.source === 'plugin') {
      if (it.answer) {
        let text = null;
        try {
          text = it.answer(clause.results || []);
        } catch (err) {
          console.error(`[brain] intent ${it.id} answer failed`, err);
        }
        // A plugin answer that ignores a refusal would read as obedience: her refusal wins.
        if (typeof text === 'string' && text.trim() && !(clause.results || []).some(isRefusal)) return text.trim();
      }
      if (it.actions.length) return this.ack(clause, reply);
      // A plugin question without an answer: let the built-ins try the same words.
      const builtin = env ? matchBuiltinClause(clause, env) : null;
      if (builtin && builtin.kind !== 'command' && HANDLERS[builtin.id]) return HANDLERS[builtin.id].call(this, builtin.slots || {}, clause, reply, state);
      return this.unknown(clause, reply, state);
    }
    if (it.kind === 'command') return this.ack(clause, reply);
    const h = HANDLERS[it.id];
    return h ? h.call(this, it.slots || {}, clause, reply, state) : this.unknown(clause, reply, state);
  }

  // ---------------------------------------------------------- acknowledgements

  ack(clause, reply) {
    const it = clause.intent;
    const results = clause.results || [];
    const out = [];
    let refused = false;
    for (let i = 0; i < it.actions.length; i++) {
      const res = results[i];
      if (isRefusal(res)) refused = true;
      const t = this.ackAction(it.actions[i], res, { offer: clause.offer || null });
      if (t && !out.includes(t)) out.push(t);
    }
    if (!reply.thought) reply.thought = refused ? this.line('thought_refusal') : Math.random() < 0.5 ? this.line('thought_order') : null;
    return out.join(' ');
  }

  // A short line for one action and its result: her refusal, condition or counter-offer
  // when the consent gate said so (DESIGN §16.4), otherwise an acknowledgement.
  ackAction(a, res, { offer = null } = {}) {
    if (isRefusal(res)) return this.refusalLine(res, a, { offer });
    if (res && !res.ok) {
      const reason = String(res.message || '').trim();
      return reason ? this.line('refused_order', { reason }) || reason : this.line('ack_refused', { reason: "I can't do that right now." });
    }
    const base = this.ackPlain(a, res);
    const v = res?.verdict;
    let extra = '';
    if (v?.decision === 'accept_conditional') {
      const cond = sentenceBody(v.condition);
      if (v.message) return String(v.message).trim();
      extra = cond ? this.line('accept_condition', { condition: cond }) : '';
    } else if (v?.decision === 'accept' && v.message && String(v.message).trim().length > 3) {
      // Her own words for agreeing beat a generic acknowledgement.
      return String(v.message).trim();
    }
    if (offer?.coins && (!res || res.ok)) extra = `${extra} ${this.line('accept_paid', { coins: offer.coins })}`.trim();
    else if (offer?.share && (!res || res.ok)) extra = `${extra} ${this.line('accept_share')}`.trim();
    return `${base || ''} ${extra}`.replace(/\s+/g, ' ').trim();
  }

  // Her refusal / counter-offer for a refused request, in her voice.
  refusalLine(res, a = {}, { offer = null } = {}) {
    const v = res?.verdict || { decision: res?.decision || 'refuse', reasons: [], message: res?.message || '' };
    const message = String(v.message || res?.message || '').trim();
    if (v.decision === 'counter' && v.counter?.name) {
      if (message) return message;
      return this.line('counter_offer', { counter: this.describeAction(v.counter.name, v.counter.args || {}) });
    }
    if (message) return message;
    const reason = capitalize(firstPersonReason(reasonText(v.reasons)));
    const situation = refusalSituation(v, companionshipOf(this.game), offer);
    if (situation === 'refuse_left' || situation === 'refuse_and_act') return this.line(situation, { reason });
    if (!reason) return this.line('refuse_noreason');
    return this.line(situation, { reason }) || this.line('refuse_generic', { reason });
  }

  // "I'll {phrase}" for an action: what she offers to do instead.
  describeAction(name, args = {}) {
    const who = args.target && args.target !== 'player' ? this.displayName(args.target) : null;
    switch (name) {
      case 'follow':
        return args.value === 'far' ? 'follow you from a distance' : 'come with you';
      case 'stay':
        return args.target ? `wait at ${this.displayName(args.target)}` : 'wait here';
      case 'wait':
        return 'wait a little';
      case 'come_here':
        return 'come to you';
      case 'goto':
        return `go to ${this.displayName(args.target) || 'the village'}`;
      case 'set_combat_mode':
        return args.value === 'attack' ? 'fight' : args.value === 'passive' ? 'stay out of the fighting' : 'only defend us';
      case 'attack':
        return `deal with ${who || 'it'} if it comes at us`;
      case 'retreat':
        return 'fall back with you';
      case 'guard':
        return who ? `keep an eye on ${who}` : 'keep watch here';
      case 'explore':
        return `scout ${this.displayName(args.target) || 'around here'}`;
      case 'start_job':
        return args.amount && JOB_NOUNS[args.value] ? jobLabel(args.value, args.amount).replace(/^chopping/, 'chop').replace(/^catching/, 'catch').replace(/^gathering/, 'gather').replace(/^mining/, 'mine') : JOB_VERBS[args.value] || 'do something useful';
      case 'wait_outside':
        return `wait outside ${this.displayName(args.target) || 'there'}`;
      case 'keep_distance':
        return 'keep my distance';
      case 'sleep':
        return 'get some sleep first';
      case 'use_item':
        return 'eat something first';
      case 'sit':
        return 'rest a moment first';
      case 'talk_to':
        return `talk to ${who || 'them'}`;
      case 'set_plan':
        return args.value ? `stick to my own plan: ${String(args.value).toLowerCase()}` : 'stick to my own plan';
      default:
        return String(name || 'something else').replace(/_/g, ' ');
    }
  }

  // Acknowledgement for an action she agreed to.
  ackPlain(a, res) {
    const args = a.args || {};
    switch (a.name) {
      case 'follow':
        if (args.target && args.target !== 'player') return `Following ${this.displayName(args.target)}.`;
        return this.line(args.value === 'close' ? 'ack_follow_close' : args.value === 'far' ? 'ack_follow_far' : 'ack_follow');
      case 'stay':
        return args.target ? this.line('ack_goto', { place: this.displayName(args.target) }) + ' ' + this.line('ack_stay') : this.line('ack_stay');
      case 'wait':
        return this.line('ack_wait');
      case 'come_here':
        return this.line('ack_come');
      case 'goto':
        return this.line('ack_goto', { place: this.displayName(args.target) });
      case 'set_combat_mode':
        return this.line(args.value === 'attack' ? 'stance_attack' : args.value === 'passive' ? 'stance_passive' : 'stance_defend');
      case 'attack':
        return this.line('ack_attack', { target: this.displayName(args.target === 'nearest enemy' ? null : args.target) || 'that one' });
      case 'retreat':
        return this.line('ack_retreat');
      case 'guard':
        return args.target && args.target !== 'player' ? `I'll keep ${this.displayName(args.target)} safe.` : this.line('ack_guard');
      case 'patrol':
        return this.line('ack_patrol');
      case 'explore':
        return this.line('ack_explore');
      case 'free_will':
        return this.line('ack_free');
      case 'emote':
        if (args.value === 'hug') return bondLevel(this.mind) >= 2 ? 'Come here, you.' : 'Oh — alright. Just a quick one.';
        if (args.value === 'dance') return this.speech.pick(['Watch and weep.', 'Island style!', 'Only for you.']);
        return this.line('ack_emote');
      case 'sit':
        return this.line('ack_sit');
      case 'start_job': {
        const label = jobLabel(args.value, args.amount);
        const to = args.target === 'chest' ? " I'll put it in the chest." : args.target === 'player' ? " I'll bring it to you." : '';
        return this.line('ack_job', { job: label }) + to;
      }
      case 'stop_job':
        return this.line('ack_stop_job');
      case 'give_item':
        return args.value ? `${this.line('ack_give')}` : this.line('ack_give');
      case 'use_item':
        return this.line('ack_use');
      case 'open_door':
      case 'close_door':
        return this.line('ack_door');
      case 'pick_up':
        return this.line('ack_pickup');
      case 'sleep':
        return this.line('ack_sleep');
      case 'talk_to':
        return this.line('ack_talk', { name: this.displayName(args.target) });
      case 'set_relationship':
        if (args.value === 'enemy') return this.line('ack_enemy', { name: this.displayName(args.target) });
        if (args.value === 'friend' || (args.amount ?? 0) > 0) return this.line('ack_friend', { name: this.displayName(args.target) });
        return this.line('ack_remember');
      case 'note_about':
      case 'remember':
        return this.line('ack_remember');
      case 'forget':
        return this.line('ack_forget');
      case 'set_goal':
      case 'complete_goal':
        return this.line('ack_goal');
      case 'express':
        return null;
      case 'read_journal':
        return res?.message || 'Let me read it...';
      case 'rejoin':
        return (res?.message && String(res.message).trim()) || this.line('ack_rejoin');
      case 'leave_player':
        return (res?.message && String(res.message).trim()) || this.line(args.value === 'apart' || !args.value ? 'ack_part_ways' : 'leaving');
      case 'promise':
        return this.line('ack_promise');
      case 'flee':
        return this.line('ack_flee');
      case 'keep_distance':
        return this.line('ack_keep_distance');
      case 'warn':
        return this.line('ack_warn');
      case 'wait_outside':
        return this.line('ack_wait_outside');
      default:
        return (res?.message && String(res.message).trim()) || this.line('ack_generic');
    }
  }

  displayName(ref) {
    if (!ref) return null;
    const g = this.game;
    if (ref === 'player') return 'you';
    try {
      const id = resolvePerson(g, ref);
      const e = id ? g.entities?.get?.(id) : null;
      if (e?.name) return firstName(e.name);
      const rel = id ? this.mind?.relationships?.get?.(id) : null;
      if (rel?.name) return firstName(rel.name);
    } catch {
      /* ignore */
    }
    const loc = g.locations?.find?.(String(ref));
    if (loc?.name) return loc.name;
    const key = String(ref).toLowerCase().split(/\s+/)[0];
    if (VILLAGERS[key]) return firstName(VILLAGERS[key].name);
    const item = ITEMS[ref] ? ITEMS[ref].name : null;
    if (item) return item.toLowerCase();
    return String(ref);
  }

  // --------------------------------------------------------------- unknowns

  unknown(clause, reply, state = 'together') {
    const text = clause.norm || '';
    if (state === 'wary' && Math.random() < 0.5) return this.line('wary_reply');
    const mention = this.findMention(text);
    if (clause.question) {
      if (mention?.kind === 'person') return this.opinionOf(mention.ref, null, reply);
      if (mention?.kind === 'place') return this.line('know_place', { place: mention.loc.name, desc: mention.loc.description || 'I know the way, at least.' });
      if (mention?.kind === 'item') return this.line('know_item', { item: ITEMS[mention.id].name, desc: ITEMS[mention.id].desc });
      return this.line('unknown_question');
    }
    const mem = this.recallRelevant(text);
    if (mem) return this.line('reminds_me', { memory: mem.text });
    if (mention?.kind === 'person') {
      const op = this.opinionText(mention.ref);
      if (op) return this.line('mention_person', { name: op.name, opinion: op.text });
    }
    return this.line('unknown_statement');
  }

  findMention(text) {
    const g = this.game;
    const words = String(text).toLowerCase();
    for (const key of Object.keys(VILLAGERS)) if (new RegExp(`\\b${key}\\b`).test(words)) return { kind: 'person', ref: key };
    for (const r of this.safeRels()) {
      const fn = String(r.name || '').toLowerCase().split(/\s+/)[0];
      if (fn && fn.length > 2 && new RegExp(`\\b${fn}\\b`).test(words)) return { kind: 'person', ref: r.id };
    }
    for (const loc of g.locations?.all?.() || []) {
      const names = [loc.name, ...(loc.aliases || [])].map((n) => String(n).toLowerCase().replace(/^the /, ''));
      if (names.some((n) => n.length > 2 && words.includes(n))) return { kind: 'place', loc };
    }
    for (const [id, def] of Object.entries(ITEMS)) {
      const n = def.name.toLowerCase();
      if (n.length > 3 && words.includes(n)) return { kind: 'item', id };
    }
    return null;
  }

  recallRelevant(text) {
    const mind = this.mind;
    if (!mind?.recall) return null;
    const q = String(text || '');
    const keys = new Set(q.split(/\W+/).filter((w) => w.length > 3));
    if (keys.size < 2) return null;
    let list = [];
    try {
      list = mind.recall(q, { limit: 3 }) || [];
    } catch {
      return null;
    }
    for (const m of list) {
      if (!m?.text || (m.importance ?? 0) < 4) continue;
      const overlap = String(m.text)
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => keys.has(w)).length;
      if (overlap >= 2) return m;
    }
    return null;
  }

  safeRels() {
    try {
      return this.mind?.relationships?.all?.() || [];
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------- opinions

  opinionText(ref) {
    const g = this.game;
    const id = resolvePerson(g, ref) || String(ref).toLowerCase();
    let rel = null;
    try {
      rel = this.mind?.relationships?.get?.(id) || null;
    } catch {
      rel = null;
    }
    const key = String(ref).toLowerCase().split(/\s+/)[0];
    const sketch = VILLAGERS[id] || VILLAGERS[key];
    const name = firstName(rel?.name || g.entities?.get?.(id)?.name || sketch?.name || ref);
    if (rel?.opinion) return { name, text: rel.opinion, rel };
    if (rel && Number.isFinite(rel.affinity) && (Math.abs(rel.affinity) >= 8 || !sketch)) {
      const note = rel.notes?.length ? ` ${bare(rel.notes[rel.notes.length - 1].text)}.` : '';
      const take = AFFINITY_TAKES.find(([min]) => rel.affinity >= min)[1].replace('{name}', name);
      return { name, text: take + note, rel };
    }
    if (sketch) return { name, text: sketch.take, rel };
    return null;
  }

  opinionOf(ref, verb, reply) {
    const op = this.opinionText(ref);
    if (!op) {
      const name = this.displayName(ref);
      return this.line('opinion_unknown_person', { name: name || ref });
    }
    if (verb === 'trust' && op.rel && Number.isFinite(op.rel.trust)) return this.line(op.rel.trust >= 45 ? 'trust_yes' : 'trust_no', { name: op.name });
    return this.line('opinion_person', { name: op.name, opinion: op.text });
  }

  opinionOfPlayer(reply) {
    let rel = null;
    try {
      rel = this.mind?.relationships?.get?.('player') || null;
    } catch {
      rel = null;
    }
    const bond = bondLevel(this.mind);
    const state = companionshipOf(this.game);
    let text;
    if ((rel && rel.affinity < -10) || state === 'left') text = this.line('opinion_player_cold');
    else if (state === 'wary') text = this.line('opinion_player_wary');
    else text = this.line(bond >= 4 ? 'opinion_player_high' : bond >= 2 ? 'opinion_player_mid' : 'opinion_player_low');
    if (rel?.opinion && !text.includes(rel.opinion)) text += ` ${rel.opinion}`;
    reply.emotion = reply.emotion || { name: 'affection', intensity: 0.15 };
    return text;
  }

  placeTake(loc) {
    if (!loc) return null;
    return PLACE_TAKES[loc.id] || (loc.danger >= 2 ? 'Beautiful, in a way that wants to kill you.' : loc.indoor ? 'Cozy. I like it.' : 'Pleasant enough. I keep my eyes open anyway.');
  }

  likeOf(thing) {
    const soul = soulOf(this.game);
    const t = String(thing || '').toLowerCase().replace(/s$/, '');
    if (!t) return null;
    const hit = (list) => (list || []).find((x) => String(x).toLowerCase().includes(t) || t.includes(String(x).toLowerCase().replace(/s$/, '')));
    if (hit(soul.likes)) return 'like';
    if (hit(soul.dislikes)) return 'dislike';
    if (hit(soul.fears)) return 'dislike';
    return null;
  }

  // --------------------------------------------------------------- helpers

  currentLocation() {
    const c = this.game?.companion || this.game?.player;
    if (!c) return null;
    try {
      return this.game.locations?.at?.(c.x, c.y) || null;
    } catch {
      return null;
    }
  }

  revealableSecret(re) {
    const soul = soulOf(this.game);
    const bond = bondLevel(this.mind);
    for (const s of soul.secrets || []) {
      const text = typeof s === 'string' ? s : s?.text;
      const at = typeof s === 'string' ? 3 : s?.revealAtBond ?? 3;
      if (!text) continue;
      if (re && !re.test(text)) continue;
      return { text, ok: bond >= at };
    }
    return null;
  }

  care(reply, amount = 1) {
    if (this.now() - this.lastCareAt < 90) return;
    this.lastCareAt = this.now();
    reply.relationships.push({ person: 'player', affinity: amount, trust: 0, respect: 0, note: null, tag: null, opinion: null });
  }
}

// What still reaches her when she has left the player.
const LEFT_HEARS = new Set(['social.apology', 'social.greet', 'social.farewell', 'social.insult', 'ask.why_left', 'ask.trust_me', 'ask.fear_me', 'ask.why_refused', 'counter.take', 'counter.decline']);

// Which refusal bank fits the gate's reasons (they are free text from the mind).
export function refusalSituation(verdict, state = 'together', offer = null) {
  if (verdict?.decision === 'refuse_and_act') return 'refuse_and_act';
  if (state === 'left' || state === 'gone') return 'refuse_left';
  const r = `${(verdict?.reasons || []).join(' ')} ${verdict?.message || ''}`.toLowerCase();
  if (/\b(?:again|already (?:said|told)|push|keep asking|asked (?:me )?(?:twice|before))\b/.test(r)) return 'refuse_pushed';
  if (/exhaust|tired|energy|sleep|barely stand|rest\b|worn out/.test(r)) return 'refuse_tired';
  if (/hungry|hunger|starv|\beat\b|food/.test(r)) return 'refuse_hungry';
  if (/\bhurt\b|wounded|bleed|\bhp\b|injur|health/.test(r)) return 'refuse_hurt';
  if (/innocent|villager|friend|\bpets?\b|harm|steal|cruel|value|wrong|murder|harmless/.test(r)) return 'refuse_values';
  if (/afraid|fear|scared|frighten/.test(r)) return 'refuse_fear';
  if (/trust/.test(r)) return 'refuse_trust';
  if (/danger|risk|\bdie\b|death|deadly|night|dark|wolves|bandit|too many|outnumber|threat|crossbow|skeleton/.test(r)) return 'refuse_danger';
  if (offer?.coins || offer?.share) return 'refuse_offer';
  return 'refuse_generic';
}

// Reasons may be written about her ("Lyra is exhausted"); she says them as herself.
export function firstPersonReason(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (!/\b(?:lyra|she|her|herself)\b/i.test(t)) return t;
  return t
    .replace(/\b(?:Lyra|She|she) is\b/g, "I'm")
    .replace(/\b(?:Lyra|She|she) has\b/g, 'I have')
    .replace(/\b(?:Lyra|She|she) does(?:n't| not)\b/g, "I don't")
    .replace(/\b(?:Lyra|She|she) (?:wo(?:n't|uld not)|will not)\b/g, "I won't")
    .replace(/\bLyra's\b/g, 'my')
    .replace(/\bherself\b/g, 'myself')
    .replace(/\bher\b/g, 'my')
    .replace(/\b(?:Lyra|She|she)\b/g, 'I');
}

// A condition as a clause: "Half the wood is mine." -> "half the wood is mine".
function sentenceBody(text) {
  const t = bare(String(text || '').replace(/\s+/g, ' '));
  if (!t) return '';
  return /^(?:I\b|I'|[A-Z][a-z]+ [A-Z])/.test(t) ? t : t[0].toLowerCase() + t.slice(1);
}

function joinParts(parts) {
  const out = [];
  let len = 0;
  for (const p of parts) {
    if (!p) continue;
    if (out.length && len + p.length > 520) break;
    out.push(p);
    len += p.length + 1;
    if (out.length >= 4) break;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const NEED_KEYS = { hungry: 'hunger', starving: 'hunger', tired: 'energy', sleepy: 'energy', exhausted: 'energy', lonely: 'social', bored: 'fun', scared: 'safety', afraid: 'safety', frightened: 'safety', worried: 'safety', nervous: 'safety', cold: 'energy' };

// Built-in question and social intents -> her answer. `this` is the LocalBrain.
const HANDLERS = {
  'ask.feelings'(s, clause, reply) {
    const mind = this.mind;
    const mood = moodKey(mind);
    const needs = mind?.needs || {};
    const c = this.game?.companion;
    const hpRatio = c && c.maxHp ? c.hp / c.maxHp : 1;
    this.care(reply, 1);
    if (s.state) {
      const st = s.state;
      if (/hurt|injured|wounded/.test(st)) return hpRatio < 0.75 ? this.line('state_yes') + ' ' + this.line('hurt_self', { hp: hpText(hpRatio) }) : this.line('state_fine');
      const need = NEED_KEYS[st];
      if (need) {
        const v = needs[need];
        if (Number.isFinite(v) && v < 0.45) return `${this.line('state_yes')} ${this.line(`need_${need === 'safety' ? 'safety' : need}`) || ''}`.trim();
        return this.line('state_fine');
      }
      if (/happy|excited|ready/.test(st)) return mood === 'happy' ? this.line('feel_happy') : st === 'ready' ? 'Always. Point me at it.' : this.line('feel_calm');
      if (/sad|upset/.test(st)) return mood === 'low' ? this.line('feel_low') : "No, I'm alright. Thank you for asking.";
      if (/angry|mad/.test(st)) return mood === 'angry' ? this.line('feel_angry') : 'Not at you. Not right now, anyway.';
    }
    const parts = [this.line(`feel_${mood}`)];
    let low = null;
    for (const k of ['hunger', 'energy', 'safety', 'social', 'fun']) {
      const v = needs[k];
      if (Number.isFinite(v) && v < 0.3 && (!low || v < needs[low])) low = k;
    }
    if (low) parts.push(this.line(`need_${low}`));
    if (hpRatio < 0.5) parts.push(this.line('hurt_self', { hp: hpText(hpRatio) }));
    reply.thought = reply.thought || this.line('thought_question');
    return parts.filter(Boolean).join(' ');
  },

  'ask.thoughts'(s, clause, reply) {
    const th = this.mind?.thoughts;
    const last = Array.isArray(th) && th.length ? th[th.length - 1] : null;
    if (last?.text) return this.line('thoughts_share', { thought: last.text });
    const goal = (this.mind?.goals || []).filter((x) => !x.done).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (goal) return this.line('thoughts_share', { thought: `${bare(goal.text)}. Always that.` });
    return this.line('thoughts_none');
  },

  'ask.opinion'(s, clause, reply) {
    const who = s.who;
    if (!who) return this.line('unknown_question');
    if (who === 'player') return this.opinionOfPlayer(reply);
    if (/^(?:it|here|this place|this village|this town|the village|the town)$/.test(who)) {
      const loc = this.currentLocation();
      return this.line('place_opinion', { place: loc?.name || 'Here', take: this.placeTake(loc) || 'I like it.' });
    }
    const id = resolvePerson(this.game, who);
    const key = String(who).split(/\s+/)[0];
    if (id || VILLAGERS[key]) {
      if (s.verb === 'know') return HANDLERS['ask.who'].call(this, { topic: who }, clause, reply);
      return this.opinionOf(id || key, s.verb, reply);
    }
    const loc = this.game.locations?.find?.(who);
    if (loc) return this.line('place_opinion', { place: loc.name, take: this.placeTake(loc) });
    const like = this.likeOf(who);
    if (like === 'like') return this.line('like_yes', { thing: who });
    if (like === 'dislike') return this.line('like_no', { thing: who });
    const item = resolveItemId(who);
    if (item && ITEMS[item]) return this.line('like_yes', { thing: who });
    return this.line('opinion_unsure', { thing: who });
  },

  'ask.memory'(s, clause, reply) {
    const topic = s.topic || '';
    if (/\b(?:met|meet|king'?s road|first time)\b/.test(topic)) return this.line('meet_story');
    let list = [];
    try {
      list = this.mind?.recall?.(topic || 'today', { limit: 3 }) || [];
    } catch {
      list = [];
    }
    const m = list.find((x) => x?.text);
    reply.emotion = reply.emotion || { name: 'curiosity', intensity: 0.1 };
    return m ? this.line('memory_found', { memory: m.text }) : this.line('memory_none');
  },

  'ask.today'(s, clause, reply) {
    const day = this.game.clock?.day;
    let list = [];
    try {
      list = this.mind?.recall?.('today', { limit: 12 }) || [];
    } catch {
      list = [];
    }
    const today = list.filter((m) => m?.text && (m.day == null || m.day === day)).sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    if (!today.length) return this.line('today_none');
    const texts = today.slice(0, 3).map((m) => `${bare(m.text)}.`);
    return this.line('today_intro', { list: texts.join(' ') });
  },

  'ask.status'() {
    const b = this.game.companion?.behavior;
    let status = '';
    try {
      status = b?.status?.() || '';
    } catch {
      status = '';
    }
    const stance = b?.stance || 'defend';
    const stanceText = {
      attack: "I'm in attack mode — anything that isn't a friend is fair game",
      defend: "I'm on defense — I'll answer anything that comes at us",
      passive: "I'm keeping my bolts to myself",
    }[stance];
    const target = b?.currentTarget;
    const fight = target?.name ? ` Right now I'm busy with ${target.species || target.name}.` : '';
    const head = status ? `${status[0].toUpperCase()}${status.slice(1)}.` : 'Just keeping pace with you.';
    return `${head} ${stanceText}.${fight}`;
  },

  'ask.inventory'(s) {
    const inv = this.game.companion?.inventory;
    if (!inv) return this.line('inventory_empty');
    if (s.item) {
      const n = inv.count(s.item);
      if (s.item === 'coin') return this.line('gold_report', { qty: n });
      const name = itemName(s.item, 2).replace(/^\d+ × /, '').toLowerCase();
      return n > 0 ? this.line('inventory_has', { qty: n, item: n === 1 ? ITEMS[s.item]?.name?.toLowerCase() || name : pluralize(ITEMS[s.item]?.name || s.item) }) : this.line('inventory_none', { item: pluralize(ITEMS[s.item]?.name || s.raw || 'that') });
    }
    if (s.raw) return this.line('inventory_none', { item: s.raw });
    const items = inv.list().filter((x) => x.id !== 'coin');
    const coins = inv.count('coin');
    if (!items.length && !coins) return this.line('inventory_empty');
    const list = listJoin(items.slice(0, 8).map((x) => (x.qty > 1 ? `${x.qty} ${pluralize(x.def?.name || x.id).toLowerCase()}` : `a ${String(x.def?.name || x.id).toLowerCase()}`)));
    const money = coins ? `${list ? ', plus ' : ''}${coins} coin${coins === 1 ? '' : 's'}` : '';
    return this.line('inventory_list', { list: `${list}${money}` });
  },

  'ask.time'() {
    const c = this.game.clock;
    if (!c) return "I've lost track of time entirely.";
    const phase = c.phase === 'dawn' ? 'time_dawn' : c.phase === 'dusk' ? 'time_dusk' : c.phase === 'night' ? 'time_night' : 'time_day';
    return `It's ${c.timeString()}, day ${c.day}. ${this.line(phase)}`;
  },

  'ask.weather'() {
    const w = this.game.clock?.weather?.type || 'clear';
    return this.line(`weather_${w}`) || this.line('weather_clear');
  },

  'ask.where'() {
    const loc = this.currentLocation();
    if (!loc) return "Somewhere between here and lost. I'd follow the road.";
    const danger = this.line(`danger_${Math.max(0, Math.min(3, loc.danger | 0))}`);
    return `${loc.name}. ${loc.description || ''} ${danger}`.replace(/\s+/g, ' ').trim();
  },

  'ask.past'(s, clause, reply) {
    const soul = soulOf(this.game);
    const name = soul.name || 'Lyra';
    const bs = soul.backstory || '';
    reply.thought = reply.thought || this.line('thought_question');
    switch (s.topic) {
      case 'self': {
        const mentor = pickSentence(bs, /maren|mentor|vanish/i);
        return `I'm ${name}${soul.age ? `, ${soul.age}` : ''}, from ${soul.origin || 'far away'}. ${mentor ? toFirstPerson(mentor) : ''}`.trim();
      }
      case 'origin': {
        const s1 = pickSentence(bs, /grew up|island|born|home/i);
        return `${capitalize(soul.origin || 'Far from here')}. ${s1 ? toFirstPerson(s1) : ''} I miss the sound of it.`.replace(/\s+/g, ' ').trim();
      }
      case 'age':
        return `${soul.age || 'Old enough'}. ${this.speech.pick(['Old enough to know better, young enough not to care.', "Don't ask a ranger her age. Ask her kill count. ...Don't ask that either."])}`;
      case 'name':
        return soul.fullName && soul.fullName !== name ? `${soul.fullName}. But ${name} is fine — everyone calls me ${name}.` : `Just ${name}. Short, easy to shout in a fight.`;
      case 'family':
      case 'secret': {
        const sec = this.revealableSecret(s.topic === 'family' ? /brother|sister|mother|father|family|cal\b/i : null);
        if (sec?.ok) {
          reply.emotion = { name: 'sadness', intensity: 0.4 };
          reply.memories.push({ text: `I told ${this.game.settings?.playerName || 'the traveler'} something I don't tell people: ${bare(toFirstPerson(sec.text))}.`, importance: 8, about: ['player'] });
          reply.relationships.push({ person: 'player', affinity: 2, trust: 4, respect: 0, note: null, tag: null, opinion: null });
          reply.thought = 'I said it out loud. To someone. Finally.';
          return `I'll tell you something I don't tell people. ${toFirstPerson(sec.text)}`;
        }
        if (sec) return this.line('past_deflect');
        return s.topic === 'family' ? "My family's back on the Isles. We write. Rarely, and badly." : this.line('secret_none');
      }
      case 'maren': {
        const op = this.opinionText('maren');
        const quest = this.objective();
        return `${op?.text || VILLAGERS.maren.take}${quest ? ` ${quest}` : ''}`;
      }
      case 'meet':
        return this.line('meet_story');
      case 'why': {
        const s1 = pickSentence(bs, /vanish|followed|came to|maren/i);
        return `${s1 ? toFirstPerson(s1) : 'Maren. She came here and never came back.'} So here I am.`;
      }
      case 'magic':
        return this.line('past_magic');
      case 'likes': {
        const quirk = soul.quirks?.length ? ` And I ${toFirstPerson(this.speech.pick(soul.quirks))}. Don't judge.` : '';
        return `${capitalize(listJoin((soul.likes || []).slice(0, 4)))}.${quirk}`;
      }
      case 'dislikes':
        return `${capitalize(listJoin((soul.dislikes || []).slice(0, 4)))}. ${/bandit/i.test((soul.dislikes || []).join(' ')) ? 'Bandits most of all — they tend to be all three.' : ''}`.trim();
      case 'fears': {
        if (/swim/.test(clause.core) && /water/i.test((soul.fears || []).join(' '))) return "Technically. Do I want to? Absolutely not. Deep water and I have an understanding: it stays down there, I stay up here.";
        reply.emotion = { name: 'fear', intensity: 0.1 };
        return `${capitalize(listJoin(soul.fears || ['losing people']))}. Don't laugh.`;
      }
      case 'dreams':
        return `${capitalize(listJoin(soul.dreams || ['find Maren']))}. Someday.`;
      case 'values':
        return `${capitalize(listJoin(soul.values || ['loyalty']))}. Everything else is negotiable.`;
      case 'favorite':
        return favoriteAnswer.call(this, s.fav || '', soul);
      default:
        return this.line('unknown_question');
    }
  },

  'ask.quest'() {
    const obj = this.objective();
    const c = this.game.clock;
    if (c && (c.hour >= 22 || c.hour < 4)) return `${obj ? `${obj} ` : ''}But first? Sleep. It's late, and the dark here bites.`;
    return obj ? this.line('quest_report', { objective: obj }) : this.line('quest_free');
  },

  'ask.goals'() {
    const goals = (this.mind?.goals || []).filter((g) => !g.done).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 3);
    if (!goals.length) return this.line('goals_none');
    return this.line('goals_report', { list: goals.map((g) => `${capitalize(bare(g.text))}.`).join(' ') });
  },

  'ask.can_do'() {
    return this.line('can_do');
  },

  'ask.who'(s, clause, reply) {
    const topic = s.topic;
    if (!topic) return this.line('unknown_question');
    if (/^maren\b/.test(topic)) return HANDLERS['ask.past'].call(this, { topic: 'maren' }, clause, reply);
    if (topic === 'player') return this.line('my_name') || this.opinionOfPlayer(reply);
    const id = resolvePerson(this.game, topic);
    const key = String(topic).split(/\s+/)[0];
    const sketch = VILLAGERS[id] || VILLAGERS[key];
    if (id || sketch) {
      const e = id ? this.game.entities?.get?.(id) : null;
      const name = e?.name || sketch?.name || this.displayName(topic);
      const role = e?.profile?.role || sketch?.role || e?.role || null;
      const op = this.opinionText(id || key);
      const desc = `${role ? `${capitalize(role)}. ` : ''}${op?.text || ''}`.trim() || 'Someone I keep meaning to talk to.';
      return this.line('know_person', { name, desc });
    }
    const loc = this.game.locations?.find?.(topic);
    if (loc) return this.line('know_place', { place: loc.name, desc: loc.description || this.placeTake(loc) });
    const item = resolveItemId(topic);
    if (item && ITEMS[item]) return this.line('know_item', { item: ITEMS[item].name, desc: ITEMS[item].desc });
    const k = (this.mind?.knowledge || []).find((x) => String(x.subject || '').toLowerCase().includes(topic));
    if (k?.text) return k.text;
    return this.line('know_none', { topic });
  },

  'ask.where_is'(s, clause, reply) {
    const g = this.game;
    const topic = s.topic;
    if (!topic) return this.line('unknown_question');
    const me = g.companion || g.player;
    const id = resolvePerson(g, topic);
    const e = id ? g.entities?.get?.(id) : null;
    if (e && me) {
      const place = g.locations?.at?.(e.x, e.y);
      if (place) return this.line('where_person', { name: firstName(e.name), place: place.name });
      return `${firstName(e.name)}? ${dirName(e.x - me.x, e.y - me.y)} of here, last I saw.`;
    }
    const loc = g.locations?.find?.(topic);
    if (loc && me) {
      const here = g.locations?.at?.(me.x, me.y);
      if (here && (here.id === loc.id || here.parent === loc.id)) return this.line('where_here', { place: loc.name });
      return this.line('where_place', { place: loc.name, dir: dirName(loc.center.x - me.x, loc.center.y - me.y) });
    }
    if (VILLAGERS[String(topic).split(/\s+/)[0]]) return `I haven't seen ${firstName(VILLAGERS[String(topic).split(/\s+/)[0]].name)} around lately.`;
    return this.line('know_none', { topic });
  },

  'ask.what_is'(s, clause, reply) {
    return HANDLERS['ask.who'].call(this, { topic: s.topic }, clause, reply);
  },

  'ask.ai'(s, clause, reply) {
    reply.emotion = { name: 'surprise', intensity: 0.15 };
    return this.line('ai_deflect');
  },

  'ask.plan'(s, clause, reply) {
    const agenda = agendaOf(this.game);
    const today = Array.isArray(agenda.today) ? agenda.today.filter((p) => p && p.activity) : [];
    const h = this.game.clock?.hour ?? 12;
    const ahead = today.filter((p) => !Number.isFinite(p.to) || p.to > h).slice(0, 3);
    if (!ahead.length) return this.line('plan_none');
    const parts = ahead.map((p) => {
      const when = Number.isFinite(p.from) && p.from <= h ? 'right now' : timeOfDay(p.from);
      const where = p.at ? ` at ${this.displayName(p.at)}` : '';
      const why = p.why ? ` — ${lowerFirst(bare(p.why))}` : '';
      return `${capitalize(when)}, ${activityPhrase(p.activity)}${where}${why}.`;
    });
    return this.line('plan_report', { plan: parts.join(' ') });
  },

  'ask.trust_me'(s, clause, reply, state) {
    const rel = playerRel(this.game);
    if (state === 'left' || rel.trust < 35) return this.line('trust_player_low');
    return this.line(rel.trust >= 65 && state !== 'wary' ? 'trust_player_high' : 'trust_player_mid');
  },

  'ask.fear_me'(s, clause, reply) {
    const f = playerRel(this.game).fear;
    if (f >= 45) {
      reply.emotion = { name: 'fear', intensity: 0.2 };
      return this.line('fear_player_high');
    }
    return this.line(f >= 15 ? 'fear_player_some' : 'fear_player_none');
  },

  'ask.why_left'(s, clause, reply, state) {
    if (state === 'together') return this.line('not_avoiding');
    const why = String(this.game.brain?.lastCompanionshipReason || '').trim();
    return why ? this.line('why_left', { reason: capitalize(/[.!?]$/.test(why) ? why : `${why}.`) }) : this.line('why_left_none');
  },

  'ask.why_refused'() {
    const r = this.game.brain?.recentRefusal?.();
    const why = r ? firstPersonReason(reasonText(r.verdict?.reasons)) : '';
    if (why) return this.line('why_refused', { reasons: why[0].toLowerCase() === why[0] ? why : lowerFirst(why) });
    if (r?.message) return this.line('why_refused', { reasons: lowerFirst(bare(r.message)) });
    return this.line('why_refused_none');
  },

  // ---------------------------------------------------------------- social
  'social.greet'(s, clause, reply, state) {
    const t = this.now();
    const again = t - this.lastGreetAt < 120;
    this.lastGreetAt = t;
    if (state === 'left') return this.line('left_greet');
    if (state === 'wary') return this.line('wary_greet');
    if (state === 'apart' && !again) return this.line('apart_greet');
    if (again) return this.line('greet_again');
    const h = this.game.clock?.hour ?? 12;
    reply.emotion = { name: 'joy', intensity: 0.08 };
    if (s.part === 'morning' || (h >= 5 && h < 11 && Math.random() < 0.5)) return this.line('greet_morning');
    if (s.part === 'evening' || (h >= 18 && h < 22 && Math.random() < 0.5)) return this.line('greet_evening');
    if (h >= 22 || h < 4) return this.line('greet_night');
    return this.line('greet');
  },
  'social.farewell'() {
    return this.line('farewell');
  },
  'social.goodnight'() {
    return this.line('goodnight');
  },
  'social.thanks'(s, clause, reply) {
    reply.emotion = { name: 'joy', intensity: 0.12 };
    reply.relationships.push({ person: 'player', affinity: 1, trust: 0, respect: 0, note: null, tag: null, opinion: null });
    reply.thought = this.line('thought_thanks');
    return this.line('thanks_reply');
  },
  'social.praise'(s, clause, reply) {
    reply.emotion = { name: 'pride', intensity: 0.3 };
    reply.relationships.push({ person: 'player', affinity: 1, trust: 1, respect: 0, note: null, tag: null, opinion: null });
    return this.line('praise_reply');
  },
  'social.compliment'(s, clause, reply, state) {
    if (state === 'wary' || state === 'left') return this.line('compliment_wary');
    reply.emotion = { name: 'joy', intensity: 0.22 };
    reply.relationships.push({ person: 'player', affinity: 2, trust: 0, respect: 0, note: null, tag: null, opinion: null });
    reply.thought = this.line('thought_compliment');
    return this.line('compliment_reply');
  },
  'social.flirt'(s, clause, reply, state) {
    const bond = bondLevel(this.mind);
    const pname = this.game.settings?.playerName || 'the traveler';
    if (state === 'wary' || state === 'left' || playerRel(this.game).fear > 35) {
      reply.emotion = { name: 'anger', intensity: 0.15 };
      return this.line('flirt_wary');
    }
    reply.thought = this.line('thought_flirt');
    if (bond >= 4) {
      reply.emotion = { name: 'affection', intensity: 0.5 };
      reply.relationships.push({ person: 'player', affinity: 3, trust: 1, respect: 0, note: null, tag: null, opinion: null });
      reply.memories.push({ text: `${pname} told me how they feel about me. I told them the truth back.`, importance: 7, about: ['player'] });
      reply.actions.push({ name: 'express', args: { target: null, value: 'affection', amount: 0.6 } });
      return this.line('flirt_high');
    }
    if (bond >= 2) {
      reply.emotion = { name: 'embarrassment', intensity: 0.4 };
      reply.relationships.push({ person: 'player', affinity: 2, trust: 0, respect: 0, note: null, tag: null, opinion: null });
      reply.memories.push({ text: `${pname} flirted with me. My ears went red. I didn't hate it.`, importance: 5, about: ['player'] });
      reply.actions.push({ name: 'express', args: { target: null, value: 'embarrassment', amount: 0.5 } });
      return this.line('flirt_mid');
    }
    reply.emotion = { name: 'surprise', intensity: 0.25 };
    reply.relationships.push({ person: 'player', affinity: 1, trust: 0, respect: 0, note: null, tag: null, opinion: null });
    return this.line('flirt_low');
  },
  'social.insult'(s, clause, reply) {
    const t = this.now();
    if (t - this.lastInsultAt > 600) this.insults = 0;
    this.lastInsultAt = t;
    const weight = s.mild ? 0.5 : s.harsh ? 2 : 1;
    this.insults += weight;
    const pname = this.game.settings?.playerName || 'the traveler';
    reply.thought = this.line('thought_insult');
    if (this.insults >= 3.5) {
      reply.emotion = { name: 'sadness', intensity: 0.45 };
      reply.relationships.push({ person: 'player', affinity: -8, trust: -6, respect: -2, note: 'Can be cruel when they are frustrated.', tag: null, opinion: null });
      reply.memories.push({ text: `${pname} kept tearing into me with words. I stopped answering.`, importance: 6, about: ['player'] });
      return this.line('insult_3');
    }
    if (this.insults >= 2) {
      reply.emotion = { name: 'anger', intensity: 0.35 };
      reply.relationships.push({ person: 'player', affinity: -6, trust: -4, respect: 0, note: null, tag: null, opinion: null });
      reply.memories.push({ text: `${pname} insulted me again. It stung.`, importance: 5, about: ['player'] });
      return this.line('insult_2');
    }
    reply.emotion = { name: 'anger', intensity: 0.2 * weight + 0.05 };
    reply.relationships.push({ person: 'player', affinity: -Math.round(4 * weight), trust: -Math.round(2 * weight), respect: 0, note: null, tag: null, opinion: null });
    return this.line('insult_1');
  },
  'social.apology'(s, clause, reply, state) {
    // "I'm sorry. I didn't mean it." is one apology, not two.
    if (reply.apology) return null;
    const g = this.game;
    const rel = playerRel(g);
    const now = this.now();
    const day = g.clock?.day ?? 1;
    const deeds = ledgerOf(g, 8).filter((d) => d && Number.isFinite(d.severity) && d.severity < 0 && (d.day == null || day - d.day <= 1));
    const hurt = this.insults > 0 || rel.affinity < 0 || deeds.length > 0 || state === 'wary' || state === 'left';
    if (!hurt) return this.line('apology_nothing');
    this.apologies = (this.apologies || []).filter((t) => now - t < 600);
    this.apologies.push(now);
    const pname = g.settings?.playerName || 'the traveler';
    const worst = deeds.reduce((m, d) => Math.min(m, d.severity), 0);
    let believed;
    let situation;
    if (this.apologies.length >= 3) {
      believed = false;
      situation = 'apology_repeat';
    } else if (state === 'left') {
      believed = rel.trust >= 35 && rel.fear <= 30;
      situation = believed ? 'apology_believed_left' : 'apology_reject';
    } else if (state === 'wary') {
      believed = rel.trust >= 20 && rel.fear <= 45;
      situation = believed ? 'apology_wary' : 'apology_reject';
    } else {
      // An accident she can forgive easily; a real hurt needs trust behind the words.
      believed = s.accident ? worst > -3 || rel.trust >= 25 : rel.trust >= 15 || worst > -2;
      situation = believed ? 'apology_accept' : 'apology_cold';
    }
    reply.apology = { believed, accident: !!s.accident, state };
    reply.thought = this.line(believed ? 'thought_apology' : 'thought_doubt');
    this.insults = Math.max(0, this.insults - (believed ? 1.5 : 0.5));
    if (believed) {
      reply.emotion = { name: 'trust', intensity: 0.2 };
      reply.relationships.push({ person: 'player', affinity: 3, trust: state === 'left' || state === 'wary' ? 3 : 2, respect: 0, fear: state === 'together' ? 0 : -2, note: null, tag: null, opinion: null });
    } else {
      reply.emotion = { name: 'sadness', intensity: 0.15 };
      reply.relationships.push({ person: 'player', affinity: 1, trust: 0, respect: 0, note: null, tag: null, opinion: null });
    }
    reply.memories.push({
      text: `${pname} apologized${s.accident ? ' and said it was an accident' : ''}. I ${believed ? 'believed them' : "didn't believe them"}.`,
      importance: state === 'left' || worst <= -3 ? 6 : 4,
      about: ['player'],
      tags: ['apology', believed ? 'believed' : 'doubted'],
    });
    return this.line(situation);
  },
  'social.joke'(s, clause, reply) {
    reply.emotion = { name: 'joy', intensity: 0.12 };
    return this.line('joke');
  },
  'social.story'(s, clause, reply) {
    reply.emotion = { name: 'joy', intensity: 0.1 };
    reply.relationships.push({ person: 'player', affinity: 1, trust: 0, respect: 0, note: null, tag: null, opinion: null });
    return this.line('story');
  },
  'social.song'(s, clause, reply) {
    reply.emotion = { name: 'embarrassment', intensity: 0.15 };
    return this.line('song');
  },
  'social.laugh'(s, clause, reply) {
    reply.emotion = { name: 'joy', intensity: 0.15 };
    return this.line('laugh_reply');
  },
  'social.careful'() {
    return this.line('careful_reply');
  },
  'social.quiet'(s, clause, reply) {
    reply.emotion = { name: 'embarrassment', intensity: 0.1 };
    return this.line('quiet_reply');
  },
  'social.player_feeling'(s, clause, reply) {
    const f = s.feeling || 'sad';
    const pname = this.game.settings?.playerName || 'the traveler';
    if (f === 'sad' || f === 'lonely' || f === 'scared') {
      reply.emotion = { name: 'affection', intensity: 0.25 };
      reply.memories.push({ text: `${pname} told me they were feeling ${s.word || f}.`, importance: 4, about: ['player'] });
      reply.relationships.push({ person: 'player', affinity: 1, trust: 2, respect: 0, note: null, tag: null, opinion: null });
    } else if (f === 'happy') reply.emotion = { name: 'joy', intensity: 0.2 };
    const key = f === 'hurt' ? 'player_hurt_words' : `player_${f}`;
    return this.line(key) || this.line('player_sad');
  },
  'social.set_name'(s, clause, reply) {
    const name = String(s.name || '').trim();
    if (!name) return this.line('unknown_statement');
    try {
      this.game.setSetting?.('playerName', name);
    } catch {
      /* settings unavailable */
    }
    reply.memories.push({ text: `The traveler told me their name: ${name}.`, importance: 7, about: ['player'] });
    reply.relationships.push({ person: 'player', affinity: 2, trust: 1, respect: 0, note: `Their name is ${name}.`, tag: null, opinion: null });
    reply.emotion = { name: 'joy', intensity: 0.2 };
    return this.speech.lineFrom('name_reply', [`${name}. I like it. It suits you.`, `${name} it is. I won't forget.`, `${name}. Finally, a name to shout in a fight.`], {}, speechContext(this.game));
  },
  'social.my_name'() {
    return this.line('my_name');
  },
  'social.yes'() {
    return this.line('ok_reply');
  },
  'social.no'() {
    return this.line('no_reply');
  },
  'social.name_call'() {
    return this.line('hello_name');
  },
};

function favoriteAnswer(fav, soul) {
  const f = String(fav).toLowerCase();
  const likes = soul.likes || [];
  const like = (re) => likes.find((l) => re.test(l));
  if (/food|meal|dessert|snack|treat|cake|dish|thing to eat/.test(f)) return `${capitalize(like(/cake|bread|food|pie|stew|honey/i) || likes[0] || 'honey cakes')}. Elda's, warm, with a cup of something.`;
  if (/flower|plant/.test(f)) return `${capitalize(like(/petal|flower|bloom/i) || 'moonpetals')}. They only open at night, like they're keeping a secret.`;
  if (/colou?r/.test(f)) return 'Moonpetal silver. Or arcane violet — the color a bolt makes just before it leaves your hand.';
  if (/book|story/.test(f)) return 'Anything old, with a cracked spine and someone else\'s notes in the margins.';
  if (/song|music/.test(f)) return this.line('song');
  if (/animal|creature|pet/.test(f)) return 'Herons. Or the stray cat Pip keeps chasing. I named her Admiral the Second.';
  if (/season|weather/.test(f)) return 'Autumn. Rain on roofs and a perfect excuse to stay in with a book.';
  if (/place|spot/.test(f)) return 'Rooftops in the rain. Or Mirror Lake at dawn — from the shore.';
  if (/weapon/.test(f)) return 'My bow. Though a dagger never hurts. Well. It hurts them.';
  if (/star|constellation/.test(f)) return 'The Heron. Maren taught me to find it. I still need her to.';
  if (/person|friend|villager/.test(f)) return bondLevel(this.mind) >= 3 ? "You. Obviously. Don't make me say it twice." : 'Pip, probably. Though you might be catching up.';
  return likes.length ? `Hm. ${capitalize(this.speech.pick(likes))}, probably.` : "I'd have to think about that.";
}

function timeOfDay(h) {
  if (!Number.isFinite(h)) return 'later';
  if (h < 12) return 'this morning';
  if (h < 17) return 'this afternoon';
  if (h < 21) return 'this evening';
  return 'tonight';
}

const ACTIVITY_PHRASES = {
  work: 'working for coin', job: 'working for coin', eat: 'supper', supper: 'supper', meal: 'a proper meal', sleep: 'sleep',
  rest: 'resting', free: 'my own time', wander: 'wandering', socialize: 'catching up with people', visit: 'visiting friends',
  study: 'studying', read: 'reading', train: 'practicing my bolts', lead: 'following a lead about Maren',
  follow_lead: 'following a lead about Maren', maren: 'looking for Maren', search: 'looking for Maren', pray: 'sitting in the chapel',
  shop: 'buying supplies', stargaze: 'watching the stars',
};

function activityPhrase(activity) {
  const a = String(activity || '').trim();
  const key = a.toLowerCase();
  if (JOB_LABELS[key]) return JOB_LABELS[key];
  if (ACTIVITY_PHRASES[key]) return ACTIVITY_PHRASES[key];
  return lowerFirst(a.replace(/_/g, ' '));
}

function hpText(r) {
  if (r < 0.2) return 'barely standing';
  if (r < 0.4) return 'not much left in me';
  if (r < 0.6) return 'about half my strength';
  return 'just scratches';
}

function capitalize(s) {
  const t = String(s || '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function pluralize(name) {
  const n = String(name || '').toLowerCase();
  if (/(?:s|fish|wheat|wood|stone|ore|stew|bread|gel)$/.test(n)) return n;
  if (/y$/.test(n)) return n.replace(/y$/, 'ies');
  return `${n}s`;
}

// Shared by LocalBrain: the quest objective in her voice, if the quest plugin offers one.
LocalBrain.prototype.objective = function objective() {
  const g = this.game;
  try {
    const q = g.plugins?.get?.('quest');
    const text = q?.objective?.(g.plugins.ctx);
    return text ? String(text).trim() : null;
  } catch {
    return null;
  }
};

export { HANDLERS as LOCAL_HANDLERS, lowerFirst };
