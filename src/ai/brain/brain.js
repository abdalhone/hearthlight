// game.brain: Lyra's conversational mind (DESIGN §13, §16, §17).
//
// A player message flows like this: echo it in the chat, emit player_message, face the
// player with a "..." icon, run the offline NLU. Everything the player asks of her is a
// request: clear commands go through her consent gate at once (source 'player'), so the
// game never waits on the network, and she answers with an acknowledgement, a condition,
// a counter-offer or her refusal. Then Claude (through claude.ai or the player's API key)
// writes the real reply, told what her gut said about each request, and may act on its
// own decision (source 'claude'); if Claude is unavailable or fails, the offline mind
// answers instead. Every reply lands in the chat (with "remembered" chips), a speech
// bubble, the `speech` event, the mind's conversation log, and her emotions, memories,
// knowledge, relationships, goals and thoughts.

import { SpeechGen, speechContext } from './speech_gen.js';
import { parseMessage, nluEnv, AMOUNT_FREE, COMMAND_THRESHOLD } from './nlu.js';
import { LocalBrain, usedMemories } from './local_brain.js';
import { ProviderSet, BrainError, toBrainError, PROVIDER_LABELS } from './providers.js';
import { buildChatPrompt, buildRules, buildReflectionTask, buildConversationTask, RESPONSE_SCHEMA, REFLECTION_SCHEMA, CONVERSATION_SCHEMA, clip } from './prompt.js';
import { coerceResponse, coerceReflection, coerceConversation, dedupeActions, MAX_ACTIONS, extractJson } from './claude_brain.js';
import { coerceMemoryEdits, applyMemoryEdits } from '../mind/memory_edits.js';
import { applyEffects, logConversation, resolvePerson } from './effects.js';
import { VILLAGERS } from './soul_fallback.js';
import { Barker } from './barks.js';
import { composeDiary } from './diary.js';
import { companionshipOf, distanceTiles, previewVerdict, isRefusal } from './her_state.js';
import { DAY_SECONDS } from '../../core/constants.js';

const REFLECT_WAIT = 20; // seconds the wake-up waits for Claude's diary before using her own
const ICON_EVERY = 2.2;
const NOTICE_REPEAT = 180; // seconds before the same transient notice repeats
const TALK_ORDER_WINDOW = 300; // a conversation may call Claude this long after a "talk to" order
const REFUSAL_MEMORY = 120; // "why not?" refers to a refusal this recent
const OFFER_WINDOW = 60; // a bare coin offer sweetens a refusal this recent
const COUNTER_WINDOW = 90; // "deal" accepts a counter-offer this recent
const ASK_WINDOW = 120; // "yes" to something she asked of the player this recent becomes their promise
const EARSHOT = { left: 18, apart: 30 };
// "Let's go", "lead the way", "sure, let's go", "ok I'll come": yes to going along with her.
const GO_ALONG = /^(?:(?:yes|yeah|yep|sure|ok|okay|alright|all right|of course|absolutely|fine|right|aye|great|good|deal)\s*)?(?:let'?s go|lets go|let us go|lead the way|lead on|after you|i'?ll come|i will come|i'?m coming|i'?m in|come on|go on then|show me|take me there|let'?s do it|lets do it|i'?ll go with you|i'?ll walk with you|count me in|with you|sure thing|okay let'?s go)(?:\s+(?:then|now|lyra|together))?(?:\s*(?:yes|sure|ok|okay))?$/; // tiles: beyond this she cannot hear the chat
const KNOWLEDGE_SOURCE = { fact: 'player', rumor: 'told', lore: 'lore', theory: 'inferred' };
const KNOWLEDGE_CONFIDENCE = { fact: 0.8, rumor: 0.4, lore: 0.7, theory: 0.5 };

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export class Brain {
  constructor(game, { loadSdk } = {}) {
    this.game = game;
    this.speech = new SpeechGen();
    this.local = new LocalBrain(game, this.speech);
    this.providers = new ProviderSet(game, loadSdk ? { loadSdk } : {});
    this.barks = new Barker(game, this);
    this.busy = false;
    this.lastError = null;
    this.lastReplyAt = -1e9;
    this.lastPlayerActionAt = -1e9;
    this.lastTalkOrderAt = -1e9;
    this.queued = null;
    this.notices = new Set(); // shown once per save (persisted)
    this.visitNotices = new Map(); // shown once per visit or throttled
    this.lastReflectT = null;
    this.localDelay = browser(); // a beat of "typing" for offline replies, in the browser only
    this.lastRefusal = null; // { name, args, verdict, message, t } of the last request she refused
    this.pendingCounter = null; // { counter: {name, args}, t } she offered instead
    this.pendingAsk = null; // { text, t }: something she asked of the player (the `request` action)
    this.currentOffer = null; // the coin offer riding on the request being evaluated right now
    this.lastCompanionshipReason = '';
    this._chatRun = false; // true while a chat request runs (the HUD ack stays quiet)
    this._iconTimer = 0;
    this._providerId = null;
    this._convBusy = false;
    this._sleepT = null;
    this._inited = false;
  }

  // ------------------------------------------------------------------ setup

  init() {
    if (this._inited) return;
    this._inited = true;
    const g = this.game;
    this.barks.install();
    this._providerId = this.providers.currentId();
    g.bus?.on('settings_changed', (p) => {
      if (!p) return;
      if (p.key === 'brain' || p.key === 'apiKey' || p.key === 'apiModel') this._providerChanged(p.key === 'brain' || p.key === 'apiKey');
    });
    try {
      g.runtime?.onChange?.(() => this._providerChanged(false));
    } catch {
      /* runtime without listeners */
    }
    g.bus?.on('player_sleep', () => {
      this._sleepT = g.clock?.t ?? null;
    });
    g.bus?.on('companion_action', (p) => {
      if (!p) return;
      if (p.source === 'player') this.lastPlayerActionAt = this.now();
      if (p.name === 'talk_to' && p.source !== 'self') this.lastTalkOrderAt = this.now();
      if (p.name === 'request' && p.ok && p.source !== 'player' && p.args?.value) this.pendingAsk = { text: String(p.args.value).slice(0, 200), t: this.now() };
    });
    g.bus?.on('companionship_changed', (p) => {
      if (p?.reason) this.lastCompanionshipReason = String(p.reason).slice(0, 200);
      if (p?.state === 'together' || p?.state === 'apart') this.pendingCounter = null;
    });
    g.bus?.on('ui_open', (p) => {
      if (p?.panel === 'chat') this._chatTip();
    });
    g.bus?.on('game_start', () => this._ensureConsentGate());
  }

  // Her own will installs the consent gate (DESIGN §16.4). If the world is running and no
  // gate is in place, every request from the player would simply run, so a stand-in asks
  // her mind directly. A gate installed later (by the autonomy plugin) replaces it.
  _ensureConsentGate() {
    const actions = this.game?.actions;
    if (!actions?.setConsentGate || actions.consentGate) return false;
    if (typeof this.game.companion?.mind?.evaluateRequest !== 'function') return false;
    const gate = (name, args, source) => {
      const mind = this.game.companion?.mind;
      if (typeof mind?.evaluateRequest !== 'function') return null;
      const req = { action: name, args: { ...(args || {}) }, source };
      const coins = this.currentOffer?.coins;
      if (coins > 0) req.pay = coins;
      const v = mind.evaluateRequest(req);
      return v && typeof v === 'object' && v.decision ? v : null;
    };
    gate.standIn = 'brain';
    actions.setConsentGate(gate);
    return true;
  }

  now() {
    return this.game?.time ?? 0;
  }

  llmAvailable() {
    return !!this.providers.current();
  }

  status() {
    const id = this.providers.currentId();
    return { provider: id, label: PROVIDER_LABELS[id], busy: this.busy, lastError: this.lastError };
  }

  // One line in her voice for a situation of the line banks (for other modules).
  line(situation, vars = {}) {
    try {
      return this.speech.line(situation, vars, speechContext(this.game));
    } catch {
      return null;
    }
  }

  // The last request she refused, if it was recent enough to talk about.
  recentRefusal() {
    const r = this.lastRefusal;
    return r && this.now() - r.t < REFUSAL_MEMORY ? r : null;
  }

  _providerChanged(announce) {
    const id = this.providers.currentId();
    if (id === this._providerId) return;
    this._providerId = id;
    this.lastError = null;
    if (announce && this.game.state === 'playing') this._system(`Lyra's mind: ${PROVIDER_LABELS[id]}.`);
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (this.busy) {
      this._iconTimer -= dt;
      if (this._iconTimer <= 0) {
        this._iconTimer = ICON_EVERY;
        const lyra = this.game.companion;
        if (lyra && this.now() - this.barks.lastBarkAt > 2.5) {
          try {
            this.game.bubbles?.icon?.(lyra, '...');
          } catch {
            /* bubbles not ready */
          }
        }
      }
    }
    try {
      this.barks.update(dt);
    } catch (err) {
      console.error('[brain] barks failed', err);
    }
  }

  // ---------------------------------------------------------------- messages

  async handlePlayerMessage(text) {
    const g = this.game;
    const clean = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (!clean) return { say: '', thought: null, actions: [], provider: this.providers.currentId() };
    this.lastPlayerActionAt = this.now();
    try {
      g.ui?.chat?.addMessage?.({ from: 'player', text: clean });
    } catch (err) {
      console.error('[brain] chat failed', err);
    }
    g.bus?.emit('player_message', { text: clean });
    logConversation(g, 'player', clean);
    const away = this._unreachable();
    if (away) return away;
    this._faceThePlayer();

    let parsed;
    try {
      parsed = parseMessage(clean, nluEnv(g));
    } catch (err) {
      console.error('[brain] understanding failed', err);
      parsed = { text: clean, clauses: [], commands: [], offer: null };
    }
    this._followUps(parsed);
    const executed = this._runClauses(parsed.commands);
    const provider = this.providers.current();
    if (provider) {
      if (executed.length) this._ackBubble(parsed);
      const turn = { text: clean, parsed, executed };
      if (this.busy) return this._enqueue(turn);
      return this._claudeTurn(turn);
    }
    return this._localTurn({ text: clean, parsed, executed });
  }

  // When she cannot answer at all: gone (she has cut the player out of her life), knocked
  // out, or out of earshot.
  _unreachable() {
    const g = this.game;
    const lyra = g.companion;
    const state = companionshipOf(g);
    const name = lyra?.name || g.settings?.companionName || 'Lyra';
    const out = (text, why) => {
      this._system(text);
      return { say: '', thought: null, actions: [], provider: 'local', unreachable: why };
    };
    if (!lyra || lyra.removed) return out(`${name} isn't here.`, 'gone');
    if (state === 'gone') {
      // DESIGN §19.7: she still lives in Hearthvale. Up close she gives a word at most.
      const will = lyra.mind?.autonomy;
      if (distanceTiles(g) <= 4 && !lyra.downed && lyra.state !== 'sleep' && will?.line) {
        const word = will.line('gone_word');
        will.say?.(word, { force: true });
        return { say: word, thought: null, actions: [], provider: 'local', unreachable: 'gone' };
      }
      const phrase = will?.goneHome?.().phrase || 'in Hearthvale';
      return out(`${name} won't speak to you. She lives ${phrase} now, and keeps out of your way.`, 'gone');
    }
    if (lyra.downed || lyra.state === 'downed') return out(`${name} is knocked out and can't hear you. Go to her and help her up.`, 'downed');
    const far = EARSHOT[state];
    if (far && distanceTiles(g) > far) {
      let where = '';
      try {
        const loc = g.locations?.at?.(lyra.x, lyra.y);
        if (loc?.name) where = ` She is somewhere around ${loc.name}.`;
      } catch {
        /* no locations yet */
      }
      if (state === 'left') return out(`${name} isn't traveling with you anymore, and she is too far away to hear you.${where}`, 'far');
      return out(`${name} is off living her own day, too far away to hear you.${where} Find her if you want to talk.`, 'far');
    }
    return null;
  }

  // Answers to her last words: "deal" takes a counter-offer, a bare coin offer sweetens the
  // request she just refused. Also attaches the message's offer to every request in it.
  _followUps(parsed) {
    const now = this.now();
    const clauses = parsed.clauses || (parsed.clauses = []);
    const first = clauses[0];
    const pc = this.pendingCounter && now - this.pendingCounter.t < COUNTER_WINDOW ? this.pendingCounter : null;
    if (pc && clauses.length === 1 && (first?.intent?.id === 'social.yes' || first?.intent?.id === 'social.no')) {
      this.pendingCounter = null;
      if (first.intent.id === 'social.yes') {
        const args = { target: pc.counter.args?.target ?? null, value: pc.counter.args?.value ?? null, amount: pc.counter.args?.amount ?? null };
        first.intent = { id: 'counter.take', source: 'builtin', kind: 'command', command: true, confidence: 0.95, match: null, slots: {}, actions: [{ name: pc.counter.name, args }], answer: null };
        // Her own proposal, which the player accepted: not a request of her.
        first.runAs = 'self';
      } else {
        first.intent = { id: 'counter.decline', source: 'builtin', kind: 'social', command: false, confidence: 0.9, match: null, slots: {}, actions: [], answer: null };
      }
    }
    const ask = this.pendingAsk && now - this.pendingAsk.t < ASK_WINDOW ? this.pendingAsk : null;
    // "Let's go" to "come with me to the chapel?" is a yes, not "follow me" (§16.11): the
    // whole message agrees to go along, so it is taken as the one answer it is.
    if (ask && clauses.length && this._goingAlong(parsed.text || '')) {
      clauses.length = 1;
      clauses[0] = { ...clauses[0], text: parsed.text, intent: { id: 'social.yes', source: 'builtin', kind: 'social', command: false, confidence: 0.9, match: null, slots: {}, actions: [], answer: null } };
    }
    const one = clauses[0];
    if (ask && clauses.length === 1 && (one?.intent?.id === 'social.yes' || one?.intent?.id === 'social.no')) {
      this.pendingAsk = null;
      if (one.intent.id === 'social.yes' && this.game.actions?.has?.('promise')) {
        // Agreeing to what she asked is the player's promise (DESIGN §16.8).
        one.intent = { id: 'ask.accept', source: 'builtin', kind: 'command', command: true, confidence: 0.95, match: null, slots: {}, actions: [{ name: 'promise', args: { target: 'player', value: ask.text, amount: null } }], answer: null };
        one.runAs = 'local';
      } else if (one.intent.id === 'social.no') {
        one.intent = { id: 'ask.decline', source: 'builtin', kind: 'social', command: false, confidence: 0.9, match: null, slots: {}, actions: [], answer: null };
      }
    }
    const offer = parsed.offer || null;
    if (offer && !clauses.some((c) => c.intent?.actions?.length)) {
      const lr = this.lastRefusal && now - this.lastRefusal.t < OFFER_WINDOW ? this.lastRefusal : null;
      if (lr) {
        const args = { ...lr.args };
        if (offer.coins && AMOUNT_FREE.has(lr.name)) args.amount = offer.coins;
        clauses.push({ text: parsed.text, norm: parsed.text, core: parsed.text, question: false, forMe: false, intent: { id: 'offer.reroute', source: 'builtin', kind: 'command', command: true, confidence: 0.9, match: null, slots: {}, actions: [{ name: lr.name, args }], answer: null } });
      }
    }
    if (offer) for (const c of clauses) if (c.intent?.actions?.length) c.offer = offer;
    parsed.commands = clauses.filter((c) => c.intent && c.intent.command && c.intent.confidence >= COMMAND_THRESHOLD && c.intent.actions.length);
  }

  // Does the whole message say "yes, let's go" to an invitation to go somewhere with her?
  _goingAlong(text) {
    const r = this.game?.companion?.mind?.autonomy?.pendingRequest;
    if (!r || r.spec?.kind !== 'visit') return false;
    const t = String(text || '').toLowerCase().replace(/[!.?,]+/g, ' ').replace(/\s+/g, ' ').trim();
    return GO_ALONG.test(t);
  }

  _enqueue(turn) {
    // At most one message waits behind the current reply; a newer one replaces it.
    if (this.queued) this.queued.resolve({ say: '', thought: null, actions: this.queued.executed, provider: this.providers.currentId(), superseded: true });
    return new Promise((resolve) => {
      this.queued = { ...turn, resolve };
    });
  }

  _runQueued() {
    const q = this.queued;
    if (!q) return;
    this.queued = null;
    const run = this.providers.current() ? this._claudeTurn(q) : this._localTurn(q);
    run.then(q.resolve, () => q.resolve({ say: '', thought: null, actions: q.executed, provider: 'local' }));
  }

  // Run the requests in the given clauses, in order, at most MAX_ACTIONS in total.
  _runClauses(clauses) {
    const executed = [];
    for (const clause of clauses || []) {
      if (!clause?.intent || clause.results) continue;
      clause.results = [];
      const source = clause.runAs || 'player';
      for (const a of clause.intent.actions) {
        if (executed.length >= MAX_ACTIONS) break;
        const res = this._request(a.name, a.args, source, clause.offer || null);
        clause.results.push(res);
        executed.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '', refused: isRefusal(res), verdict: res.verdict || null, source });
      }
    }
    return executed;
  }

  // One request from the player (or a counter-offer of hers the player took).
  _request(name, args, source, offer = null) {
    const g = this.game;
    if (!g.actions?.has?.(name)) return { ok: false, message: `I don't know how to "${name}".` };
    if (source === 'player') this._ensureConsentGate();
    const state = companionshipOf(g);
    // Without a consent gate installed, a Lyra who broke off still says no (DESIGN §16.4).
    if (source === 'player' && (state === 'left' || state === 'gone') && !g.actions.consentGate && !g.actions.get?.(name)?.ungated) {
      const message = this.line('refuse_left') || 'No.';
      return { ok: false, refused: true, verdict: { decision: 'refuse', reasons: [], message }, message };
    }
    this._chatRun = true;
    this.currentOffer = offer;
    let res;
    try {
      res = this._run(name, args, source);
    } finally {
      this._chatRun = false;
      this.currentOffer = null;
    }
    if (source !== 'player') return res;
    if (isRefusal(res)) this.noteRefusal(name, args, res);
    else if (res.ok) {
      if (this.lastRefusal?.name === name) this.lastRefusal = null;
      // The mind records a paid deal itself when its verdict weighed the coin.
      if (offer?.coins && !offer.paid && !(res.verdict?.pay > 0)) this._promisePay(name, args, offer.coins);
    }
    return res;
  }

  // Remember a refused request (from the chat or the HUD): "why not?", a coin offer that
  // sweetens it, or a "deal" that takes her counter-offer all refer back to it.
  noteRefusal(name, args, res) {
    const now = this.now();
    this.lastRefusal = { name, args: { ...(args || {}) }, verdict: res?.verdict || null, message: res?.message || '', t: now };
    const counter = res?.verdict?.decision === 'counter' ? res.verdict.counter : null;
    this.pendingCounter = counter?.name && this.game.actions?.has?.(counter.name) ? { counter, t: now } : null;
  }

  // An accepted paid request: the player now owes her (tracked as their promise, §16.8).
  _promisePay(name, args, coins) {
    const g = this.game;
    if (!g.actions?.has?.('promise')) return;
    const me = g.companion?.name || 'Lyra';
    const what = this.local.describeAction(name, args || {});
    this._run('promise', { target: 'player', value: `Pay ${me} ${coins} coins for agreeing to ${what}.`, amount: coins }, 'local');
  }

  _run(name, args, source) {
    const g = this.game;
    if (!g.actions?.has?.(name)) return { ok: false, message: `I don't know how to "${name}".` };
    try {
      const r = g.actions.run(name, args || {}, source);
      return r && typeof r === 'object' ? r : { ok: !!r, message: '' };
    } catch (err) {
      console.error(`[brain] action ${name} failed`, err);
      return { ok: false, message: 'Something went wrong.' };
    }
  }

  async _localTurn({ parsed, executed = [] }) {
    const g = this.game;
    // Offline, nobody else will weigh lower-confidence requests: put them to her now.
    const more = this._runClauses(parsed.clauses.filter((c) => c.intent && c.intent.actions.length && !c.results));
    const all = executed.concat(more);
    const env = nluEnv(g);
    let reply;
    // What she recalls while she composes her answer becomes its "remembered" chips, the
    // same as Claude's used_memories (DESIGN §17.3).
    const index = g.companion?.mind?.index;
    const since = g.clock?.t ?? null;
    let recalled = [];
    try {
      index?.beginTrace?.();
      reply = this.local.compose(parsed, env);
    } catch (err) {
      console.error('[brain] offline reply failed', err);
      reply = { say: this.line('unknown_statement') || 'Hm.', thought: null, emotion: null, memories: [], relationships: [], goal: null, actions: [] };
    } finally {
      recalled = index?.endTrace?.() || [];
    }
    reply.chips = this._localChips(reply, recalled, since);
    for (const a of reply.actions || []) {
      if (all.length >= MAX_ACTIONS + 2) break;
      if (!g.actions?.has?.(a.name)) continue;
      const res = this._run(a.name, a.args, 'local');
      all.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '', source: 'local' });
    }
    if (this.localDelay) {
      this._thinking(true);
      await sleepMs(Math.min(900, 280 + reply.say.length * 4));
      this._thinking(false);
    }
    this._deliver(reply, 'local');
    this._apologyEvent(parsed, reply.apology);
    return { say: reply.say, thought: reply.thought || null, actions: all, provider: 'local', memories: reply.chips || [] };
  }

  // Chips for an offline reply: what she recalled for it, plus today's memories (answers
  // about the day read them straight from the store), kept when the reply carries them.
  _localChips(reply, recalled, since) {
    const mind = this.game.companion?.mind;
    if (!mind || !reply?.say) return [];
    const cands = [...recalled];
    try {
      for (const m of mind.memory?.recent?.(14) || []) cands.push({ store: 'episode', id: m.id, text: m.text, label: m.gist || m.text, ref: m });
    } catch {
      /* a partial mind has no recent() */
    }
    for (const id of reply.used_memories || []) {
      const r = mind.lookup?.(id);
      if (r) cands.unshift({ store: r.store, id: r.store === 'life' ? String(r.id).replace(/^life:/, '') : r.id, text: r.text, label: r.label, ref: r.ref });
    }
    try {
      return usedMemories(reply.say, cands, { since });
    } catch (err) {
      console.error('[brain] chips failed', err);
      return [];
    }
  }

  // What her gut says about requests in the message that did not run at once (§16.10).
  _previewRequests(parsed) {
    const out = [];
    for (const c of parsed.clauses || []) {
      if (out.length >= 4) break;
      if (!c.intent?.actions?.length || c.results) continue;
      const a = c.intent.actions[0];
      out.push({ text: c.text, name: a.name, args: a.args, verdict: previewVerdict(this.game, a.name, a.args, c.offer || null) });
    }
    return out;
  }

  async _claudeTurn(turn) {
    const g = this.game;
    const provider = this.providers.current();
    if (!provider) return this._localTurn(turn);
    this.busy = true;
    this._thinking(true);
    this._iconTimer = ICON_EVERY;
    let result;
    try {
      const requests = this._previewRequests(turn.parsed);
      const { rules, context, recall } = buildChatPrompt(g, turn.text, turn.executed, { requests, offer: turn.parsed.offer || null });
      const call = { items: new Map((recall?.items || []).map((x) => [x.id, x.label])) };
      let toolMax = 0;
      try {
        toolMax = (await provider.toolLimit?.()) || 0;
      } catch {
        toolMax = 0;
      }
      const tools = toolMax > 0 ? this._tools(call).slice(0, toolMax) : null;
      const raw = await provider.complete({ rules, task: context, schema: RESPONSE_SCHEMA, tier: g.settings?.modelTier || 'quick', tools: tools && tools.length ? tools : null });
      const resp = coerceResponse(raw, { actionNames: g.actions?.names?.() || null, maxActions: MAX_ACTIONS });
      resp.memory_edits = memoryEditsOf(raw);
      result = this._applyClaude(resp, turn, provider.id, call);
      this.lastError = null;
    } catch (e) {
      this.busy = false;
      result = await this._failed(e, provider, turn);
    } finally {
      this.busy = false;
      this._thinking(false);
    }
    this._runQueued();
    return result;
  }

  // Read-only page tools Claude may call when the view supports them (DESIGN §17.3).
  // Results stay small; every memory a tool returns can be cited as a chip.
  _tools(call) {
    const mind = this.game.companion?.mind;
    if (!mind) return [];
    const remember = (id, label) => {
      if (id != null && label) call.items.set(String(id), clip(label, 60));
    };
    const tools = [];
    if (typeof mind.recall === 'function') {
      tools.push({
        name: 'recall',
        description: 'Search your own memories (what happened, your past, what you know) for a few words. Returns up to 5 short items with ids you may list in used_memories.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'what to remember, in a few words' } }, required: ['query'] },
        execute: (input) => {
          const q = String(input?.query ?? '').slice(0, 120);
          if (!q.trim()) throw new Error('query is empty');
          const list = mind.recall(q, { limit: 5 }) || [];
          return list
            .filter((m) => m && (m.text || m.label))
            .slice(0, 5)
            .map((m) => {
              const text = clip(m.text || m.label, 220);
              remember(m.id, m.label || m.text);
              return { id: m.id != null ? String(m.id) : null, text, day: m.day ?? null, kind: m.store || m.type || null };
            });
        },
      });
    }
    if (typeof mind.dossier === 'function') {
      tools.push({
        name: 'about_person',
        description: 'Everything you know about one person: how you feel about them, notes, and memories of them. Give a name or id.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'their name or id' } }, required: ['name'] },
        execute: (input) => {
          const who = String(input?.name ?? '').slice(0, 60);
          if (!who.trim()) throw new Error('name is empty');
          const id = resolvePerson(this.game, who);
          const d = mind.dossier(id || who);
          if (d && typeof d === 'object') {
            const mems = Array.isArray(d.memories) ? d.memories.filter((m) => m?.id != null && m.text).slice(0, 4) : [];
            for (const m of mems) remember(m.id, m.label || m.text);
            const text = typeof d.text === 'string' && d.text ? d.text : smallResult(d, 900);
            return { text: clip(typeof text === 'string' ? text : JSON.stringify(text), 900), memories: mems.map((m) => ({ id: String(m.id), text: clip(m.text, 160) })) };
          }
          if (typeof d === 'string' && d.trim()) return clip(d, 900);
          // Not met yet: what anyone in the valley could tell her.
          const sketch = VILLAGERS[id] || VILLAGERS[String(who).toLowerCase().split(/\s+/)[0]];
          if (sketch) return `You have not really met ${sketch.name} yet. People say: ${sketch.role}.`;
          return `You don't know anyone called ${who}.`;
        },
      });
    }
    if (typeof mind.loreLookup === 'function') {
      tools.push({
        name: 'lore',
        description: "What you know of the world's lore on a topic: places, history, legends. Only what you have learned.",
        inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'a place, person, thing or event' } }, required: ['topic'] },
        execute: (input) => {
          const topic = String(input?.topic ?? '').slice(0, 80);
          if (!topic.trim()) throw new Error('topic is empty');
          const r = mind.loreLookup(topic);
          const entries = Array.isArray(r) ? r : Array.isArray(r?.entries) ? r.entries : [];
          if (!r || (!entries.length && !r.text && !r.questions?.length)) return `You don't know anything about ${topic}.`;
          for (const e of entries) remember(e?.id, e?.subject || e?.title || e?.text);
          if (typeof r === 'object' && !Array.isArray(r) && typeof r.text === 'string' && r.text) {
            return { text: clip(r.text, 1200), ids: entries.slice(0, 6).map((e) => (e?.id != null ? String(e.id) : null)).filter(Boolean) };
          }
          return smallResult(r, 1600);
        },
      });
    }
    return tools;
  }

  _applyClaude(resp, turn, providerId, call = null) {
    const g = this.game;
    const extra = dedupeActions(resp.actions, turn.executed).slice(0, MAX_ACTIONS);
    const ran = [];
    for (const a of extra) {
      const res = this._run(a.name, a.args, 'claude');
      ran.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '', source: 'claude' });
      if (res.ok && this.lastRefusal?.name === a.name) this.lastRefusal = null;
    }
    if (resp.rejected?.length) console.warn('[brain] ignored unknown actions:', resp.rejected.join(', '));
    if (!resp.say) {
      // Claude only acted (or said nothing): she still answers in her own words.
      const ack = turn.executed.length || ran.length ? this._ackText(turn.parsed, ran) : '';
      resp.say = ack || this.local.compose(turn.parsed, nluEnv(g)).say;
    }
    const items = call?.items || new Map();
    resp.chips = (resp.used_memories || []).filter((id) => items.has(id)).slice(0, 4).map((id) => ({ id, label: items.get(id) }));
    this._learn(resp.knowledge);
    resp.edited = this._editMemories(resp.memory_edits, call);
    this._deliver(resp, providerId);
    this._apologyEvent(turn.parsed, null, resp);
    return { say: resp.say, thought: resp.thought, actions: turn.executed.concat(ran), provider: providerId, memories: resp.chips };
  }

  // Her own edits to her memory (DESIGN §17.4), only for ids in what this reply was shown
  // (the recall context and the tools' results): an id she was not shown is ignored.
  _editMemories(edits, call) {
    const mind = this.game.companion?.mind;
    if (!mind || !Array.isArray(edits) || !edits.length) return [];
    const allowed = new Set(call?.items ? [...call.items.keys()].map(String) : []);
    try {
      return applyMemoryEdits(mind, edits, { allowed, by: 'claude' });
    } catch (err) {
      console.error('[brain] memory edits failed', err);
      return [];
    }
  }

  // Knowledge from a reply: theories stay beliefs, never facts (DESIGN §17.2).
  _learn(list) {
    const mind = this.game.companion?.mind;
    if (!mind?.learn || !Array.isArray(list)) return;
    for (const k of list.slice(0, 3)) {
      if (!k?.subject || !k?.text) continue;
      try {
        mind.learn(k.subject, k.text, { kind: k.kind, source: KNOWLEDGE_SOURCE[k.kind] || 'inferred', confidence: KNOWLEDGE_CONFIDENCE[k.kind] ?? 0.5 });
      } catch (err) {
        console.error('[brain] learn failed', err);
      }
    }
  }

  // Let her own will hear about an apology and whether she believed it (contract addition).
  _apologyEvent(parsed, local = null, resp = null) {
    const said = (parsed?.clauses || []).some((c) => c.intent?.id === 'social.apology');
    if (!said) return;
    let believed = local?.believed;
    if (believed == null && resp) {
      const r = (resp.relationships || []).find((x) => resolvePerson(this.game, x.person) === 'player');
      const warm = resp.emotion && ['trust', 'affection', 'joy', 'calm'].includes(resp.emotion.name);
      believed = r ? r.trust > 0 || (r.trust === 0 && r.affinity > 0) : !!warm;
    }
    this.game.bus?.emit('apology', { text: parsed.text, believed: !!believed, accident: !!local?.accident, state: companionshipOf(this.game) });
  }

  _ackText(parsed, ran = []) {
    const parts = [];
    const scratch = { thought: 'x', memories: [], relationships: [], actions: [] };
    for (const c of parsed.commands || []) {
      const t = this.local.ack(c, scratch);
      if (t) parts.push(t);
    }
    for (const r of ran) {
      const t = this.local.ackAction(r, r);
      if (t && !parts.includes(t)) parts.push(t);
    }
    return parts.join(' ');
  }

  async _failed(e, provider, turn) {
    const err = e instanceof BrainError ? e : toBrainError(e);
    if (!(e instanceof BrainError) && !(e && typeof e === 'object' && typeof e.code === 'string')) console.warn('[brain] reply failed', e);
    this.lastError = err.code;
    const g = this.game;
    switch (err.code) {
      case 'not_granted':
      case 'sampling_disabled':
      case 'not_declared':
      case 'capability_disabled':
      case 'capability_removed':
      case 'not_available':
        provider.disable?.();
        this._noticeOnce('sample_off', "Claude isn't available in this view, so Lyra is thinking with her own instincts for now.");
        break;
      case 'rate_limited':
        this._noticeThrottled('rate_limited', 'Claude is busy right now (too many requests). Lyra answered on her own; try again in a little while.');
        break;
      case 'refused': {
        const reply = { say: this.line('deflect') || "Let's not go down that road.", thought: null, emotion: { name: 'embarrassment', intensity: 0.15 }, memories: [], relationships: [], goal: null };
        this._deliver(reply, provider.id);
        return { say: reply.say, thought: null, actions: turn.executed, provider: provider.id };
      }
      case 'invalid_json': {
        const salvaged = err.text ? coerceResponse(err.text, { actionNames: g.actions?.names?.() || null }) : null;
        if (salvaged && salvaged.say) return this._applyClaude(salvaged, turn, provider.id);
        break;
      }
      case 'auth':
        this._noticeThrottled('auth', "Your Claude API key wasn't accepted, so Lyra is using her own instincts. Check the key in Settings.");
        break;
      case 'connection':
        this._noticeThrottled('connection', "Couldn't reach Claude. Lyra answered on her own.");
        break;
      case 'invalid_request':
        this._noticeThrottled('invalid_request', `Claude didn't accept the request (${String(err.message || '').slice(0, 120)}). Check the model name in Settings.`);
        break;
      case 'session_expired':
        this._noticeThrottled('session_expired', 'Your claude.ai session expired. Sign in again to bring Claude back; Lyra is on her own until then.');
        break;
      case 'cancelled':
        break;
      default:
        this._noticeThrottled('upstream', "Lyra's connection to Claude faltered, so she answered on instinct.");
    }
    return this._localTurn(turn);
  }

  // Show and record a reply. reply: { say, thought, emotion, memories, relationships, goal, chips }
  _deliver(reply, providerId) {
    const g = this.game;
    const lyra = g.companion;
    const say = String(reply.say || '').trim();
    if (say) {
      try {
        const msg = { from: 'lyra', text: say, name: lyra?.name || g.settings?.companionName || 'Lyra' };
        if (reply.chips?.length) msg.memories = reply.chips;
        g.ui?.chat?.addMessage?.(msg);
      } catch (err) {
        console.error('[brain] chat failed', err);
      }
      if (lyra) {
        try {
          g.bubbles?.clear?.(lyra);
          g.bubbles?.say?.(lyra, say, { kind: 'say' });
        } catch (err) {
          console.error('[brain] bubble failed', err);
        }
      }
      g.bus?.emit('speech', { speaker: lyra, text: say, target: g.player || null, kind: 'say' });
      logConversation(g, 'lyra', say);
    }
    applyEffects(g, reply, { source: providerId === 'local' ? 'local' : 'claude', cause: 'conversation' });
    this.lastReplyAt = this.now();
  }

  _ackBubble(parsed) {
    const g = this.game;
    const lyra = g.companion;
    if (!lyra) return;
    const text = this._ackText(parsed);
    if (!text) return;
    try {
      g.bubbles?.say?.(lyra, text, { kind: 'say' });
    } catch {
      /* ignore */
    }
    this.barks.lastBarkAt = this.now();
    g.bus?.emit('speech', { speaker: lyra, text, target: g.player || null, kind: 'bark' });
  }

  _faceThePlayer() {
    const g = this.game;
    const lyra = g.companion;
    const p = g.player;
    try {
      if (lyra && p && !lyra.downed) lyra.faceToward?.(p.x, p.y);
    } catch {
      /* ignore */
    }
  }

  _thinking(on) {
    const g = this.game;
    try {
      g.ui?.chat?.setThinking?.(!!on);
    } catch {
      /* ignore */
    }
    if (on && g.companion) {
      try {
        g.bubbles?.icon?.(g.companion, '...');
      } catch {
        /* ignore */
      }
    }
  }

  _system(text) {
    try {
      this.game.ui?.chat?.addMessage?.({ from: 'system', text });
    } catch {
      /* ignore */
    }
  }

  _noticeOnce(key, text) {
    if (this.visitNotices.has(key)) return;
    this.visitNotices.set(key, this.now());
    this._system(text);
  }

  _noticeThrottled(key, text) {
    const last = this.visitNotices.get(key);
    if (last != null && this.now() - last < NOTICE_REPEAT) return;
    this.visitNotices.set(key, this.now());
    this._system(text);
  }

  _chatTip() {
    if (this.notices.has('chat_tip')) return;
    this.notices.add('chat_tip');
    this._system('Talk to Lyra in your own words. She decides for herself: "come with me to the forest?", "I\'ll pay you 10 coins to chop wood", "what do you think of Bram?", "how are you feeling?"');
  }

  // ------------------------------------------------------------- reflection
  _dayMemories(day = null) {
    const g = this.game;
    const mind = g.companion?.mind;
    if (!mind) return [];
    const now = g.clock?.t ?? 0;
    const since = this.lastReflectT ?? (this._sleepT ?? now) - DAY_SECONDS;
    let list = [];
    try {
      list = mind.recall?.('today', { limit: 30 }) || [];
    } catch {
      list = [];
    }
    let extra = [];
    try {
      extra = mind.memory?.all?.() || mind.memory?.list?.() || mind.memory?.entries || [];
    } catch {
      extra = [];
    }
    if (Array.isArray(extra) && extra.length) list = list.concat(extra.slice(-60));
    const seen = new Set();
    const out = [];
    for (const m of list) {
      if (!m?.text || seen.has(m.id ?? m.text)) continue;
      seen.add(m.id ?? m.text);
      if (Number.isFinite(m.t) && m.t < since) continue;
      if (m.type === 'reflection') continue;
      // Her first memories (seeded "two days ago", "yesterday") are not today's.
      if ((Number.isFinite(m.daysAgo) && m.daysAgo > 0) || (day != null && Number.isFinite(m.day) && m.day < day)) continue;
      out.push(m);
    }
    out.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (b.t ?? 0) - (a.t ?? 0));
    return out.slice(0, 12);
  }

  async reflect(reason = 'sleep') {
    const g = this.game;
    const mind = g.companion?.mind;
    // Gone, she still keeps her diary: her life goes on without the player (DESIGN §19.7).
    if (!mind) return null;
    const day = this._sleepT != null ? Math.floor(this._sleepT / DAY_SECONDS) + 1 : g.clock?.day ?? 1;
    const memories = this._dayMemories(day);
    const offline = composeDiary(g, memories, { day });
    const entry = { day, text: offline.text, t: g.clock?.t ?? 0, source: 'local', reason };
    let summary = offline.summary;
    const provider = this.providers.current();
    if (provider) {
      const call = provider
        .complete({ rules: buildRules(g), task: buildReflectionTask(g, memories, { day }), schema: REFLECTION_SCHEMA, tier: 'default' })
        .then((raw) => coerceReflection(raw))
        .catch((e) => {
          this._reflectFailed(e, provider);
          return null;
        });
      // Waking up waits a little for her real diary; if it arrives later it replaces this one.
      let timer = null;
      const late = new Promise((r) => {
        timer = setTimeout(() => r('late'), REFLECT_WAIT * 1000);
      });
      const res = await Promise.race([call, late]);
      clearTimeout(timer);
      if (res && res !== 'late') {
        entry.text = res.diary;
        entry.source = provider.id;
        summary = res.summary || summary;
        this._applyReflection(res);
      } else if (res === 'late') {
        call.then((lateRes) => {
          if (!lateRes) return;
          entry.text = lateRes.diary;
          entry.source = provider.id;
          this._applyReflection(lateRes);
          if (lateRes.summary) this._rememberSummary(lateRes.summary);
        });
      }
    }
    try {
      if (!Array.isArray(mind.diary)) mind.diary = [];
      mind.diary.push(entry);
      if (mind.diary.length > 60) mind.diary.splice(0, mind.diary.length - 60);
    } catch (err) {
      console.error('[brain] diary failed', err);
    }
    this._rememberSummary(summary);
    try {
      mind.memory?.consolidate?.();
    } catch (err) {
      console.error('[brain] consolidate failed', err);
    }
    this.lastReflectT = g.clock?.t ?? null;
    this._sleepT = null;
    try {
      g.ui?.showDiary?.(entry);
    } catch (err) {
      console.error('[brain] showDiary failed', err);
    }
    return { diary: entry.text, summary };
  }

  _rememberSummary(summary) {
    if (!summary) return;
    try {
      this.game.companion?.mind?.remember?.(summary, { importance: 6, about: ['player'], tags: ['diary'], type: 'reflection' });
    } catch {
      /* ignore */
    }
  }

  _applyReflection(res) {
    const g = this.game;
    const rels = g.companion?.mind?.relationships;
    for (const o of res.opinions || []) {
      const id = resolvePerson(g, o.person);
      if (!id || !rels?.setOpinion) continue;
      try {
        if (!rels.get?.(id)) rels.ensure?.(g.entities?.get?.(id) || id, { name: g.entities?.get?.(id)?.name || id });
        rels.setOpinion(id, o.opinion);
      } catch {
        /* ignore */
      }
    }
    if (res.goal) applyEffects(g, { goal: res.goal }, { source: 'claude', cause: 'reflection' });
  }

  _reflectFailed(e, provider) {
    const err = e instanceof BrainError ? e : toBrainError(e);
    this.lastError = err.code;
    if (err.permanent) {
      provider.disable?.();
      this._noticeOnce('sample_off', "Claude isn't available in this view, so Lyra is thinking with her own instincts for now.");
    }
  }

  // ---------------------------------------------------------- conversations

  async generateConversation(npc, topic = null) {
    const g = this.game;
    if (!npc) return null;
    const provider = this.providers.current();
    if (!provider) return null;
    // Claude is only asked in answer to the player: a "talk to" order or a recent message.
    const now = this.now();
    if (now - this.lastTalkOrderAt > TALK_ORDER_WINDOW && now - this.lastPlayerActionAt > 60) return null;
    if (companionshipOf(g) === 'gone') return null;
    if (this._convBusy) return null;
    this._convBusy = true;
    try {
      const raw = await provider.complete({ rules: buildRules(g), task: buildConversationTask(g, npc, topic), schema: CONVERSATION_SCHEMA, tier: 'quick' });
      return coerceConversation(raw, { npcName: npc.name, companionName: g.settings?.companionName || 'Lyra' });
    } catch (e) {
      this._reflectFailed(e, provider);
      return null;
    } finally {
      this._convBusy = false;
    }
  }

  // An acknowledgement bubble for an order given outside the chat (HUD, hotkeys).
  ack(name, result = { ok: true, message: '' }, args = {}) {
    this.barks.ack({ name, args, ok: result?.ok !== false, message: result?.message || '', refused: !!result?.refused, decision: result?.verdict?.decision || null, verdict: result?.verdict || null });
  }

  // ------------------------------------------------------------ persistence

  serialize() {
    return {
      v: 2,
      notices: [...this.notices].slice(0, 20),
      lastReflectT: this.lastReflectT,
      insults: Math.round((this.local.insults || 0) * 10) / 10,
      why: this.lastCompanionshipReason ? this.lastCompanionshipReason.slice(0, 160) : undefined,
      barks: this.barks.serialize(),
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.notices)) for (const n of d.notices) if (typeof n === 'string') this.notices.add(n);
    if (Number.isFinite(d.lastReflectT)) this.lastReflectT = d.lastReflectT;
    if (Number.isFinite(d.insults)) this.local.insults = Math.max(0, Math.min(10, d.insults));
    if (typeof d.why === 'string') this.lastCompanionshipReason = d.why.slice(0, 200);
    this.barks.deserialize(d.barks);
  }
}

// "memory_edits" from a raw reply (coerceResponse keeps only the round-2 fields).
function memoryEditsOf(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = extractJson(raw);
    } catch {
      data = null;
    }
  }
  if (Array.isArray(data)) data = data.find((x) => x && typeof x === 'object' && !Array.isArray(x)) || null;
  return coerceMemoryEdits(data?.memory_edits ?? data?.memoryEdits ?? []);
}

// A tool result small enough to send back: plain data when it fits, else clipped JSON text.
function smallResult(v, max) {
  if (typeof v === 'string') return clip(v, max);
  let s = '';
  try {
    s = JSON.stringify(v);
  } catch {
    return '';
  }
  return s.length <= max ? v : clip(s, max);
}
