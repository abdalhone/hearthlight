// game.brain: Lyra's conversational mind (DESIGN §13).
//
// A player message flows like this: echo it in the chat, emit player_message, face the
// player with a "..." icon, run the offline NLU. Clear commands run at once (the game
// never waits on the network) with a quick acknowledgement bubble. Then Claude (through
// claude.ai or the player's API key) writes the real reply and any further actions; if
// Claude is unavailable or fails, the offline mind answers instead. Every reply lands in
// the chat, a speech bubble, the `speech` event, the mind's conversation log, and her
// emotions, memories, relationships, goals and thoughts.

import { SpeechGen, speechContext } from './speech_gen.js';
import { parseMessage, nluEnv } from './nlu.js';
import { LocalBrain } from './local_brain.js';
import { ProviderSet, BrainError, toBrainError, PROVIDER_LABELS } from './providers.js';
import { buildChatPrompt, buildRules, buildReflectionTask, buildConversationTask, RESPONSE_SCHEMA, REFLECTION_SCHEMA, CONVERSATION_SCHEMA } from './prompt.js';
import { coerceResponse, coerceReflection, coerceConversation, dedupeActions, MAX_ACTIONS } from './claude_brain.js';
import { applyEffects, logConversation, resolvePerson } from './effects.js';
import { Voice } from './voice.js';
import { Barker } from './barks.js';
import { composeDiary } from './diary.js';
import { DAY_SECONDS } from '../../core/constants.js';

const REFLECT_WAIT = 20; // seconds the wake-up waits for Claude's diary before using her own
const ICON_EVERY = 2.2;
const NOTICE_REPEAT = 180; // seconds before the same transient notice repeats
const TALK_ORDER_WINDOW = 300; // a conversation may call Claude this long after a "talk to" order

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export class Brain {
  constructor(game, { loadSdk } = {}) {
    this.game = game;
    this.speech = new SpeechGen();
    this.local = new LocalBrain(game, this.speech);
    this.providers = new ProviderSet(game, loadSdk ? { loadSdk } : {});
    this.voice = new Voice(game);
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
    });
    g.bus?.on('ui_open', (p) => {
      if (p?.panel === 'chat') this._chatTip();
    });
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
    this.voice.stop();
    this._faceThePlayer();

    let parsed;
    try {
      parsed = parseMessage(clean, nluEnv(g));
    } catch (err) {
      console.error('[brain] understanding failed', err);
      parsed = { text: clean, clauses: [], commands: [] };
    }
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

  // Run the actions of the given clauses (in order, at most MAX_ACTIONS in total).
  _runClauses(clauses, source = 'local') {
    const executed = [];
    for (const clause of clauses || []) {
      if (!clause?.intent || clause.results) continue;
      clause.results = [];
      for (const a of clause.intent.actions) {
        if (executed.length >= MAX_ACTIONS) break;
        const res = this._run(a.name, a.args, source);
        clause.results.push(res);
        executed.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '' });
      }
    }
    return executed;
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
    // Offline, nobody else will act on lower-confidence intents: run them now.
    const more = this._runClauses(parsed.clauses.filter((c) => c.intent && c.intent.actions.length && !c.results));
    const all = executed.concat(more);
    let reply;
    try {
      reply = this.local.compose(parsed, nluEnv(g));
    } catch (err) {
      console.error('[brain] offline reply failed', err);
      reply = { say: this.speech.line('unknown_statement', {}, speechContext(g)) || 'Hm.', thought: null, emotion: null, memories: [], relationships: [], goal: null, actions: [] };
    }
    for (const a of reply.actions || []) {
      if (all.length >= MAX_ACTIONS + 2) break;
      if (!g.actions?.has?.(a.name)) continue;
      const res = this._run(a.name, a.args, 'local');
      all.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '' });
    }
    if (this.localDelay) {
      this._thinking(true);
      await sleepMs(Math.min(900, 280 + reply.say.length * 4));
      this._thinking(false);
    }
    this._deliver(reply, 'local');
    return { say: reply.say, thought: reply.thought || null, actions: all, provider: 'local' };
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
      const { rules, context } = buildChatPrompt(g, turn.text, turn.executed);
      const raw = await provider.complete({ rules, task: context, schema: RESPONSE_SCHEMA, tier: g.settings?.modelTier || 'quick' });
      result = this._applyClaude(coerceResponse(raw, { actionNames: g.actions?.names?.() || null, maxActions: MAX_ACTIONS }), turn, provider.id);
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

  _applyClaude(resp, turn, providerId) {
    const g = this.game;
    const extra = dedupeActions(resp.actions, turn.executed).slice(0, MAX_ACTIONS);
    const ran = [];
    for (const a of extra) {
      const res = this._run(a.name, a.args, 'claude');
      ran.push({ name: a.name, args: a.args, ok: !!res.ok, message: res.message || '' });
    }
    if (resp.rejected?.length) console.warn('[brain] ignored unknown actions:', resp.rejected.join(', '));
    if (!resp.say) {
      // Claude only acted (or said nothing): she still answers in her own words.
      const ack = turn.executed.length || ran.length ? this._ackText(turn.parsed, ran) : '';
      resp.say = ack || this.local.compose(turn.parsed, nluEnv(g)).say;
    }
    this._deliver(resp, providerId);
    return { say: resp.say, thought: resp.thought, actions: turn.executed.concat(ran), provider: providerId };
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
        const reply = { say: this.speech.line('deflect', {}, speechContext(g)) || "Let's not go down that road.", thought: null, emotion: { name: 'embarrassment', intensity: 0.15 }, memories: [], relationships: [], goal: null };
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

  // Show and record a reply. reply: { say, thought, emotion, memories, relationships, goal }
  _deliver(reply, providerId) {
    const g = this.game;
    const lyra = g.companion;
    const say = String(reply.say || '').trim();
    if (say) {
      try {
        g.ui?.chat?.addMessage?.({ from: 'lyra', text: say, name: lyra?.name || g.settings?.companionName || 'Lyra' });
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
      this.voice.speak(say);
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
    this._system('Talk to Lyra in your own words: "follow me and attack anything hostile", "chop 5 wood and bring it to me", "what do you think of Bram?", "how are you feeling?"');
  }

  // ------------------------------------------------------------- reflection

  _dayMemories() {
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
      out.push(m);
    }
    out.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (b.t ?? 0) - (a.t ?? 0));
    return out.slice(0, 12);
  }

  async reflect(reason = 'sleep') {
    const g = this.game;
    const mind = g.companion?.mind;
    if (!mind) return null;
    const day = this._sleepT != null ? Math.floor(this._sleepT / DAY_SECONDS) + 1 : g.clock?.day ?? 1;
    const memories = this._dayMemories();
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
    this.barks.ack({ name, args, ok: result?.ok !== false, message: result?.message || '' });
  }

  // ------------------------------------------------------------ persistence

  serialize() {
    return {
      v: 1,
      notices: [...this.notices].slice(0, 20),
      lastReflectT: this.lastReflectT,
      insults: Math.round((this.local.insults || 0) * 10) / 10,
      barks: this.barks.serialize(),
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.notices)) for (const n of d.notices) if (typeof n === 'string') this.notices.add(n);
    if (Number.isFinite(d.lastReflectT)) this.lastReflectT = d.lastReflectT;
    if (Number.isFinite(d.insults)) this.local.insults = Math.max(0, Math.min(10, d.insults));
    this.barks.deserialize(d.barks);
  }
}
