// The chat (DESIGN.md §14, §23): message log, text field, Send, quick-reply chips, a
// dictation mic when the runtime offers one, and a thinking indicator. It talks to Lyra
// by default, or to anyone within earshot: the "To:" row (chat_target.js) picks who,
// and each person keeps their own history (a villager's is saved with the village).
// To a villager, a line goes through village.playerSays and the answer comes back in
// the log, as a bubble over them and in their voice. Opening it never pauses the world;
// typing turns game keys off.

import { h, button, setText, toggleClass, clear } from './dom.js';
import { CHIPS } from './content.js';
import { portraitUrl } from './art.js';
import { cleanLine, capitalize } from './format.js';
import { memoryRefs, findMemory, memoryChipLabel, STORE_LABELS, companionshipOf, companionshipLabel } from './lyra_view.js';
import { TalkSession, villageOf, firstName, lineBeat } from './village_view.js';
import { LYRA, ChatTargetBar, moodWord, earshotPeople, whyNotHeard, canHear, chipFor, standingOf, faceOf, partingLine, villagerChips, isVillager, EARSHOT_LOSE, notHeardText, NEAR, lyraHears, nearestTalkTarget } from './chat_target.js';
import { silenceAct } from '../ai/silence.js';
import { chatOf, recordChat, knownName } from '../ai/social/player_talk.js';
import { STORY } from '../lore/story.js';

const MAX_MESSAGES = 140;
const SCAN_EVERY = 0.25; // seconds between earshot checks while open
const DUP_WINDOW_MS = 6000; // the same line from two paths within this window is one message
const KINDS = new Set(['answer', 'refusal', 'problem', 'initiative', 'state', 'order', 'bark', 'act']);
// Quick lines for saying something aloud to everyone near (round 14b T-2).
const ALOUD_CHIPS = ['Hello, everyone!', 'Good morning, Hearthvale!', 'Has anyone seen Maren?', 'Can anyone help me?', 'HELP!'];
const HIM = new Set(['hobb', 'bram', 'pip', 'rowan', 'tobias', 'garrick', 'alder', 'corran', 'wys']);
const pronounOf = (id) => (HIM.has(id) ? 'him' : 'her');

export class Chat {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.messages = []; // {from, text, name, t}
    this.el = null;
    this.mounted = false;
    this._open = false;
    this.thinking = false;
    this.unread = 0;
    this.typing = false;
    this.dict = null; // dictation namespace once available
    this.dictState = 'idle';
    this.dictCommitted = '';
    this.dictPartial = '';
    this.dictOffs = [];
    this.lastPlayerEcho = { text: '', at: 0 };
    this.gone = false;
    // Who the chat talks to (§23).
    this.target = LYRA;
    this.away = null; // why the selected villager can't hear the player any more, or null
    this.people = []; // ids within earshot, nearest first
    this.sessions = new Map(); // villager id -> TalkSession
    this.talkSeq = new Map(); // villager id -> which conversation this is (a new one after they leave)
    this.waiting = new Set(); // villager ids whose answer is on its way
    this.queued = new Map(); // villager id -> a line typed while they were still answering
    this.unreadBy = new Map(); // id -> unread lines from someone not selected
    this.moods = new Map(); // villager id -> their mood word from the last answer
    this.seenAt = new Map(); // villager id -> {nx, ny, px, py} when last in earshot
    this.local = {}; // villager threads when the village is not in this build
    this.unsaid = new Map(); // villager id -> [{ show, timer }]: lines of an answer still to come
    this._scanT = 0;
  }

  mount() {
    if (this.mounted) return this.el;
    this.mounted = true;
    this.portrait = h('img', { class: 'portrait portrait-chat', alt: '', draggable: 'false' });
    this.title = h('div', { class: 'chat-name' });
    this.status = h('div', { class: 'chat-status' });
    const closeBtn = button('', { icon: 'close', cls: 'btn-icon chat-close', title: 'Close chat (Esc)', onClick: () => this.close() });
    // Within reach of a villager: their dialog (shop, gifts, missions) is one tap away
    // (round 14b, decision D4); farther off, the header says to walk up to them.
    this.tradeBtn = button('Trade · Give · Work', { cls: 'btn-small btn-ghost chat-trade', title: 'Trade, give a gift, or ask about work', onClick: () => this.openTrade() });
    this.tradeBtn.hidden = true;
    const head = h('header', { class: 'chat-head' }, h('span', { class: 'portrait-frame small' }, this.portrait), h('div', { class: 'chat-heading' }, this.title, this.status), this.tradeBtn, closeBtn);
    this.toBar = new ChatTargetBar({ onPick: (id) => this.selectTarget(id, { focus: !this.ui.isTouch, from: 'chip' }) });

    this.log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with Lyra' });
    this.thinkingRow = h('div', { class: 'msg msg-lyra msg-thinking', hidden: true }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')));

    this.chips = h('div', { class: 'chat-chips' });
    this.chips.addEventListener('scroll', () => this.markMoreChips(), { passive: true });
    this.renderChips();

    this.field = h('input', {
      class: 'field chat-field',
      type: 'text',
      maxlength: '400',
      autocomplete: 'off',
      enterkeyhint: 'send',
      spellcheck: 'true',
      'aria-label': 'Message to Lyra',
      placeholder: 'Say something to Lyra…',
    });
    this.field.addEventListener('focus', () => this.setTyping(true));
    this.field.addEventListener('blur', () => this.setTyping(false));
    this.field.addEventListener('input', () => {
      // Typing during dictation: what's in the field becomes the committed text.
      if (this.dictState !== 'idle') {
        this.dictCommitted = this.field.value;
        this.dictPartial = '';
      }
    });
    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (this.field.value) this.field.value = '';
        else this.close();
      }
    });
    this.mic = button('', { icon: 'mic', cls: 'btn-icon chat-mic', title: 'Speak to Lyra' });
    this.mic.hidden = true;
    this.mic.addEventListener('click', () => this.toggleDictation());
    this.sendBtn = button('', { icon: 'send', cls: 'btn-icon btn-ember chat-send', title: 'Send (Enter)', onClick: () => this.submit() });
    const form = h('div', { class: 'chat-input' }, this.field, this.mic, this.sendBtn);

    this.el = h('aside', { class: 'chat', hidden: true, 'aria-label': 'Chat with Lyra' }, head, this.toBar.el, this.log, this.chips, form);
    for (const m of this.messages) this._render(m);
    this.log.append(this.thinkingRow);
    this.refreshHeader();
    this.refreshPeople(true);
    // Talking to Lyra in the world (E beside her) addresses her.
    this.game.bus?.on?.('interact', (p) => {
      if (p?.target && p.target === this.game.companion) this.selectTarget(LYRA);
    });
    return this.el;
  }

  // ---------- contract ----------

  // focus: put the caret in the field. sync: do it now, inside the tap, so phones
  // raise their keyboard (a deferred focus is ignored there).
  open(focus = false, sync = false) {
    if (!this.mounted) return;
    if (!this._open) {
      this._open = true;
      this.el.hidden = false;
      this.ui.root.classList.add('chat-open');
      this.game.audio?.play('ui_open', { volume: 0.7 });
      this.game.bus?.emit('ui_open', { panel: 'chat' });
      // Whoever walked off while the chat was shut has gone: to whoever is near now, else
      // the companion, else everyone nearby (never back to Lyra by default, round 14b T-1).
      if ((this.target !== LYRA && this.target !== NEAR && this.away) || (this.target === LYRA && !this.lyraListening())) this.selectTarget(this.defaultTarget());
      this.refreshPeople(true);
      this.refreshHeader();
      this.ui.armBack?.();
    }
    this.unreadBy.set(this.target, 0);
    this.unread = 0;
    this.ui.hud?.setUnread(0);
    this.scrollToEnd();
    this.markMoreChips();
    if (focus && sync) this.field.focus({ preventScroll: true });
    else if (focus) this.focusSoon();
  }

  close() {
    if (!this._open) return;
    this._open = false;
    if (this.dictState !== 'idle') this.stopDictation();
    this.field.blur();
    this.el.hidden = true;
    this.ui.root.classList.remove('chat-open');
    this.setTyping(false);
    this.game.audio?.play('ui_close', { volume: 0.7 });
    this.game.bus?.emit('ui_close', { panel: 'chat' });
    this.frameWorld();
  }

  toggle() {
    if (this._open) this.close();
    else if (typeof this.ui.talkToNearest === 'function') this.ui.talkToNearest();
    else this.open(!this.ui.isTouch);
  }

  // Can Lyra hear the chat now (her own earshot by how things stand)?
  lyraListening() {
    try {
      return lyraHears(this.game);
    } catch {
      return true;
    }
  }

  // Who the chat turns to by default: the nearest person, else whoever walks with you, else
  // everyone nearby.
  defaultTarget() {
    const g = this.game;
    let e = null;
    try {
      e = nearestTalkTarget(g);
    } catch {
      e = null;
    }
    if (e) return e === g.companion ? LYRA : e.id;
    const holder = (() => {
      try {
        return g.party?.holder || null;
      } catch {
        return null;
      }
    })();
    if (holder === g.companion && this.lyraListening()) return LYRA;
    if (holder && holder.id && canHear(g, holder, EARSHOT_LOSE)) return holder.id;
    return NEAR;
  }

  // The selected villager's dialog (shop, gifts, missions), when they are within reach.
  openTrade() {
    const e = this.entity(this.target);
    if (!e || !isVillager(e) || !this.inReach(e)) return;
    this.close();
    this.ui.openDialog?.(e);
  }

  inReach(e) {
    const p = this.game.player;
    return !!e && !!p && Math.hypot(e.x - p.x, e.y - p.y) <= 40 && !whyNotHeard(this.game, e, 48);
  }

  isOpen() {
    return this._open;
  }

  // {from: 'player'|'lyra'|'system'|'npc', text, name, kind?, memories?, offer?, note?}
  // kind: 'initiative' (her own announcement or request), 'refusal', 'answer' (to a
  // request), 'problem', 'state' (system: where she stands with you changed).
  // memories: what she remembered for this reply (ids or {id, label, store, text}).
  // offer: { label, name, args } a counter-offer the player can accept with one tap.
  // to: a villager's id puts the line in their conversation instead of Lyra's.
  addMessage(m) {
    if (!m || !m.text) return null;
    if (m.to && m.to !== LYRA) return this.pushVillager(m.to, m);
    const from = ['player', 'lyra', 'system', 'npc'].includes(m.from) ? m.from : 'system';
    const text = cleanLine(m.text, 1200);
    if (!text) return null;
    const now = Date.now();
    // The UI echoes the player's line at once; the brain may echo it again.
    if (from === 'player' && this.lastPlayerEcho.text === text && now - this.lastPlayerEcho.at < 4000) {
      this.lastPlayerEcho.text = '';
      return null;
    }
    const refs = memoryRefs(m.memories || m.used_memories || m.usedMemories);
    // Her reply can reach the chat twice (the brain, and the UI's fallback): keep one.
    if (from === 'lyra') {
      const dup = this.recentLyra(text, now);
      if (dup) {
        if (refs.length && !dup.memories?.length) this.attachMemories(dup, refs);
        return dup;
      }
    }
    const kind = KINDS.has(m.kind) ? m.kind : null;
    const msg = { from, text, name: m.name || null, t: now, kind, memories: refs, offer: m.offer && m.offer.name ? m.offer : null, note: m.note ? cleanLine(m.note, 300) : '', el: null };
    this.messages.push(msg);
    if (from === 'lyra') this.noteShared(refs);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    if (this.mounted) {
      this._render(msg);
      if (from === 'lyra' && (!this._open || this.target !== LYRA)) {
        if (this.target !== LYRA) this.bumpUnread(LYRA);
        if (!this._open) {
          this.unread++;
          this.ui.hud?.setUnread(this.unread);
        }
      }
    }
    return msg;
  }

  recentLyra(text, now) {
    for (let i = this.messages.length - 1; i >= 0 && i >= this.messages.length - 6; i--) {
      const m = this.messages[i];
      if (now - m.t > DUP_WINDOW_MS) break;
      if (m.from === 'lyra' && m.text === text) return m;
    }
    return null;
  }

  // Add "remembered …" chips to a message already shown.
  attachMemories(msg, list) {
    const refs = memoryRefs(list);
    if (!msg || !refs.length) return;
    msg.memories = refs;
    if (msg.el && !msg.el.querySelector('.mem-wrap')) msg.el.append(this.memoryChips(refs));
    if (msg.from === 'lyra') this.noteShared(refs);
  }

  // What she cited to you in talk is shared now (contract §33/§34.5: party keeps it in
  // mind.shared, and People shows it; a left or gone Lyra confides nothing new).
  noteShared(refs) {
    const ids = (Array.isArray(refs) ? refs : []).map((r) => r?.id).filter(Boolean);
    if (!ids.length) return;
    try {
      this.game?.bus?.emit?.('memories_shared', { who: LYRA, ids });
    } catch {
      /* a listener's trouble is not the chat's */
    }
  }

  // Lyra's thinking (the brain drives it); a villager's shows while their answer comes.
  setThinking(on) {
    this.thinking = !!on;
    if (!this.mounted) return;
    this.syncThinkingRow();
    this.refreshHeader();
    this.scrollToEnd();
  }

  syncThinkingRow() {
    if (!this.mounted) return;
    const lyra = this.target === LYRA;
    const show = lyra ? this.thinking : this.waiting.has(this.target);
    this.thinkingRow.hidden = !show;
    this.thinkingRow.className = `msg ${lyra ? 'msg-lyra' : 'msg-npc'} msg-thinking`;
    if (show) this.log.append(this.thinkingRow);
  }

  // ---------- internals ----------

  _render(m) {
    const g = this.game;
    const row = h('div', { class: `msg msg-${m.from}${m.kind ? ` msg-${m.kind}` : ''}` });
    if (m.from === 'npc' && m.name) row.append(h('span', { class: 'msg-name', text: m.name }));
    if (m.kind === 'initiative') row.append(h('span', { class: 'msg-kicker', text: `${g.settings?.companionName || 'Lyra'}, of her own accord` }));
    if (m.kind === 'refusal') row.append(h('span', { class: 'msg-kicker', text: 'She said no' }));
    row.append(h('span', { class: 'msg-text', text: m.text }));
    if (m.note) row.append(h('span', { class: 'msg-note', text: `“${m.note}”` }));
    if (m.memories?.length) row.append(this.memoryChips(m.memories));
    // She asked something on her own: answering is one tap (the brain hears the words).
    if (m.kind === 'initiative' && /\?["'”’)]*$/.test(m.text) && !this.gone) {
      const replies = h('div', { class: 'msg-replies' });
      for (const word of ['Yes.', 'Not now.']) {
        const b = button(word.replace('.', ''), { cls: 'btn-small btn-ghost' });
        b.addEventListener('click', () => {
          for (const x of replies.querySelectorAll('button')) x.disabled = true;
          this.send(word);
        });
        replies.append(b);
      }
      row.append(replies);
    }
    if (m.offer) {
      const b = button(m.offer.label || 'All right', { cls: 'btn-small btn-ghost msg-offer' });
      b.addEventListener('click', () => {
        b.disabled = true;
        this.ui.ask?.(m.offer.name, m.offer.args || {}, 'counter');
      });
      row.append(b);
    }
    m.el = row;
    if (this.target !== LYRA) return;
    this.log.insertBefore(row, this.thinkingRow.parentNode === this.log ? this.thinkingRow : null);
    while (this.log.childElementCount > MAX_MESSAGES + 1) {
      const first = this.log.firstElementChild;
      if (first === this.thinkingRow) break;
      first.remove();
    }
    this.scrollToEnd();
  }

  // Small chips naming what she remembered; a tap unfolds the memory itself.
  memoryChips(refs) {
    const mind = this.game.companion?.mind || null;
    const wrap = h('div', { class: 'mem-chips' });
    const detail = h('div', { class: 'mem-detail', hidden: true });
    let openId = null;
    for (const ref of refs) {
      const found = ref.label ? null : safeFind(mind, ref.id);
      const chip = h('button', { type: 'button', class: 'mem-chip', 'aria-expanded': 'false' }, h('span', { class: 'mem-pre', text: 'remembered' }), h('span', { class: 'mem-label', text: memoryChipLabel(ref, found) }));
      chip.addEventListener('click', () => {
        const same = openId === (ref.id || ref.label);
        for (const c of wrap.querySelectorAll('.mem-chip')) c.setAttribute('aria-expanded', 'false');
        if (same) {
          openId = null;
          detail.hidden = true;
          return;
        }
        openId = ref.id || ref.label;
        chip.setAttribute('aria-expanded', 'true');
        const hit = safeFind(this.game.companion?.mind || null, ref.id);
        clear(detail);
        const text = hit?.text || ref.text || ref.label || 'She keeps this one to herself.';
        const store = hit?.store || ref.store;
        // Only lived moments have a day; what she knows and her past do not.
        const episodic = store === 'memory' || store === 'episode';
        const when = episodic && hit ? (hit.day > 0 ? `Day ${hit.day}` : 'before you met') : '';
        const where = [STORE_LABELS[store] || '', when].filter(Boolean).join(' · ');
        if (hit?.title && hit.title !== text) detail.append(h('strong', { class: 'mem-title', text: hit.title }));
        detail.append(h('span', { class: 'mem-text', text }));
        if (where) detail.append(h('span', { class: 'mem-where', text: where }));
        detail.hidden = false;
        this.scrollToEnd();
      });
      wrap.append(chip);
    }
    return h('div', { class: 'mem-wrap' }, wrap, detail);
  }

  // A conversation Lyra had with a villager, shown as an overheard exchange.
  addOverheard(title, lines) {
    if (!this.mounted || !lines?.length) return;
    const block = h('div', { class: 'msg msg-overheard' }, h('div', { class: 'overheard-title', text: title }));
    for (const l of lines.slice(0, 8)) {
      block.append(h('div', { class: 'overheard-line' }, h('span', { class: 'msg-name', text: l.name }), h('span', { class: 'msg-text', text: cleanLine(l.text, 300) })));
    }
    // It belongs to her conversation: kept with her lines, shown when she is selected.
    this.messages.push({ from: 'overheard', text: title, t: Date.now(), el: block });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    if (this.target !== LYRA) return;
    this.log.insertBefore(block, this.thinkingRow.parentNode === this.log ? this.thinkingRow : null);
    this.scrollToEnd();
  }

  scrollToEnd() {
    if (!this.mounted || !this._open) return;
    requestAnimationFrame(() => {
      this.log.scrollTop = this.log.scrollHeight;
    });
  }

  focusSoon() {
    // Next frame, so the key that opened the chat is not typed into the field.
    requestAnimationFrame(() => {
      if (this._open) this.field.focus({ preventScroll: true });
    });
  }

  setTyping(on) {
    this.typing = !!on;
    this.ui.syncInputEnabled();
  }

  refreshHeader() {
    if (!this.mounted) return;
    if (this.target !== LYRA) {
      this.villagerHeader();
      return;
    }
    toggleClass(this.el, 'to-npc', false);
    if (this.tradeBtn) this.tradeBtn.hidden = true;
    const g = this.game;
    const c = g.companion;
    setText(this.title, g.settings?.companionName || c?.name || 'Lyra');
    let status = '';
    if (this.thinking) status = 'thinking…';
    else if (this.dictState === 'listening') status = 'listening to you…';
    else {
      try {
        const mood = c?.mind?.mood?.();
        status = mood?.label ? `feeling ${mood.label}` : '';
      } catch {
        status = '';
      }
      const cs = companionshipOf(g);
      if (cs !== 'together') status = status && cs !== 'gone' ? `${companionshipLabel(cs).toLowerCase()} · ${status}` : companionshipLabel(cs);
      const st = (() => {
        try {
          return g.brain?.status?.();
        } catch {
          return null;
        }
      })();
      if (st?.label) status = status ? `${status} · ${st.label}` : st.label;
    }
    setText(this.status, status);
    toggleClass(this.el, 'is-thinking', this.thinking);
    const cs = companionshipOf(g);
    const expr = this.thinking || cs === 'wary' || cs === 'apart' ? 'neutral' : cs === 'left' || cs === 'gone' ? 'sad' : 'happy';
    const url = portraitUrl(g, 'lyra', expr);
    if (url && this.portrait.src !== url) this.portrait.src = url;
  }

  submit() {
    const text = this.field.value.trim();
    if (!text) {
      this.field.focus();
      return;
    }
    if (this.dictState !== 'idle') this.stopDictation();
    this.field.value = '';
    this.dictCommitted = '';
    this.dictPartial = '';
    this.send(text, this.target);
  }

  // to: who hears it. Callers outside the chat (her "ask back", the reply buttons under
  // her lines) mean Lyra; the field and the chips pass whoever is selected.
  send(text, to = LYRA) {
    if (to === NEAR) {
      this.sayAloud(text);
      return;
    }
    if (to && to !== LYRA) {
      this.sendToVillager(to, text);
      return;
    }
    const t = cleanLine(text, 400);
    if (!t) return;
    const g = this.game;
    if (this.target !== LYRA) this.selectTarget(LYRA);
    if (!g.brain?.handlePlayerMessage) return;
    // Echo now so the line appears instantly even if the brain is slow to answer.
    this.addMessage({ from: 'player', text: t });
    this.actBubble(t);
    this.lastPlayerEcho = { text: t, at: Date.now() };
    this.lastSentAt = Date.now();
    g.audio?.play('ui_click');
    let p;
    // The words reached her first (the brain records them before anything else, DESIGN
    // §23.3); should her answer fail on the way, what the player sees is her hearing it,
    // never "didn't catch that".
    const heard = () => {
      this.setThinking(false);
      this.addMessage({ from: 'system', text: silenceAct('lyra', this.targetName(LYRA), { kind: 'heard', n: (this._heardN = (this._heardN ?? -1) + 1) }) });
    };
    try {
      p = g.brain.handlePlayerMessage(t);
    } catch (err) {
      console.warn('[chat] message failed', err);
      heard();
      return;
    }
    const sentAt = Date.now();
    Promise.resolve(p).then(
      (r) => this.afterReply(r, sentAt),
      (err) => {
        console.warn('[chat] message failed', err);
        heard();
      },
    );
  }

  // The brain shows her reply itself; this only fills gaps: a reply it returned but did
  // not show, or the memories it used but did not attach.
  afterReply(r, sentAt) {
    if (!r || typeof r !== 'object') return;
    // `memories` on the result may be the chips the brain cites ({id, label}); new
    // memories to store (text without an id) are not chips.
    const cited = Array.isArray(r.memories) ? r.memories.filter((m) => typeof m === 'string' || (m && typeof m === 'object' && m.id)) : null;
    const used = r.used_memories || r.usedMemories || r.recalled || (cited && cited.length ? cited : null);
    let last = null;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.t < sentAt - 50) break;
      if (m.from === 'lyra') {
        last = m;
        break;
      }
    }
    const say = typeof r.say === 'string' ? r.say.trim() : '';
    if (!last && say) {
      this.addMessage({ from: 'lyra', text: say, memories: used });
      return;
    }
    if (last && used && !last.memories?.length) this.attachMemories(last, used);
  }

  // She has cut the player off. Nothing is locked (the author: "even if somebody really
  // hates me, make me able to talk to them"): the field stays open, she hears it, and
  // answers as she feels. The flag only colours the header and her chip.
  setGone(on) {
    const gone = !!on;
    if (gone === this.gone && this.mounted) return;
    this.gone = gone;
    if (!this.mounted) return;
    if (gone && this.dictState !== 'idle' && this.target === LYRA) this.stopDictation();
    this.applyTarget();
    this.refreshPeople(true);
  }

  // ---------- dictation ----------

  // Called when the runtime's dictation capability appears or disappears.
  attachDictation(dict) {
    if (this.dict === dict) return;
    for (const off of this.dictOffs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.dictOffs = [];
    this.dict = dict || null;
    if (!this.mounted) return;
    this.mic.hidden = !this.dict;
    if (!this.dict) return;
    try {
      this.dictOffs.push(
        this.dict.onPartial((e) => {
          if (!this.ownsDictation()) return;
          this.dictPartial = e?.text || '';
          this.showDictation();
        }),
      );
      this.dictOffs.push(
        this.dict.onFinal((e) => {
          if (!this.ownsDictation()) return;
          let t = e?.text || '';
          if (!this.dictCommitted) t = t.replace(/^\s+/, '');
          this.dictCommitted += t;
          this.dictPartial = '';
          this.showDictation();
        }),
      );
      this.dictOffs.push(
        this.dict.onState((e) => {
          if (!this.ownsDictation()) return;
          this.dictState = e?.state || 'idle';
          if (this.dictState === 'idle' && this.ui.dictOwner === 'chat') this.ui.dictOwner = null;
          toggleClass(this.mic, 'listening', this.dictState === 'listening' || this.dictState === 'starting');
          this.mic.title = this.dictState === 'idle' ? `Speak to ${this.targetName()}` : 'Stop listening';
          if (this.dictState === 'idle') {
            this.dictPartial = '';
            this.showDictation();
            this.handleDictationEnd(e?.reason);
          }
          this.refreshHeader();
        }),
      );
    } catch (err) {
      console.warn('[chat] dictation setup failed', err);
      this.mic.hidden = true;
    }
  }

  // The mic is shared with villagers' dialogs: the chat only follows dictation it started.
  // With no owner recorded, only a session the chat is still following counts (an
  // 'idle' that ends a villager's session must not rewrite the chat's field).
  ownsDictation() {
    const o = this.ui.dictOwner;
    return o === 'chat' || (!o && this.dictState !== 'idle');
  }

  showDictation() {
    const partial = this.dictPartial;
    const base = this.dictCommitted;
    const sep = base && partial && !/^\s/.test(partial) && !/\s$/.test(base) ? ' ' : '';
    this.field.value = base + sep + partial;
    toggleClass(this.field, 'provisional', !!partial);
  }

  // Must run synchronously inside the click: start() needs the user's gesture.
  toggleDictation() {
    const d = this.dict;
    if (!d) return;
    let active = false;
    try {
      active = d.active();
    } catch {
      active = this.dictState !== 'idle';
    }
    if (active && this.ownsDictation()) {
      this.stopDictation();
      return;
    }
    this.ui.dictOwner = 'chat';
    this.dictCommitted = this.field.value;
    this.dictPartial = '';
    let p;
    try {
      p = d.start();
    } catch (err) {
      this.handleDictationError(err);
      return;
    }
    Promise.resolve(p).then(
      () => {},
      (err) => this.handleDictationError(err),
    );
  }

  stopDictation() {
    try {
      Promise.resolve(this.dict?.stop()).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  handleDictationError(err) {
    if (this.ui.dictOwner === 'chat') this.ui.dictOwner = null;
    const code = err?.code || 'upstream_error';
    const ui = this.ui;
    if (code === 'unavailable') {
      this.mic.hidden = true;
      ui.toast('Speaking to Lyra is not available here. Typing still works.', 'info');
    } else if (code === 'not_granted') ui.toast('The microphone is off for this game. You can allow it in the page permissions.', 'warn');
    else if (code === 'rate_limited') ui.toast('The microphone is busy. Try again in a moment.', 'info');
    else if (code === 'no_gesture') ui.toast('Tap the microphone again to start speaking.', 'info');
    else if (code !== 'stopped' && code !== 'dismissed') ui.toast('Listening failed. Try again, or type instead.', 'warn');
  }

  handleDictationEnd(reason) {
    if (reason === 'unavailable') {
      this.mic.hidden = true;
      this.ui.toast('Speaking to Lyra is not available here. Typing still works.', 'info');
    } else if (reason === 'time_limit') this.ui.toast('Listening stopped after a long while. Tap the mic to continue.', 'info');
    else if (reason === 'upstream_error') this.ui.toast('The microphone stopped unexpectedly.', 'warn');
    if (this.field.value.trim() && this._open) this.field.focus({ preventScroll: true });
  }

  reset() {
    this.messages.length = 0;
    if (this.mounted && this.target === LYRA) {
      clear(this.log);
      this.log.append(this.thinkingRow);
    }
  }

  update(dt = 1 / 60) {
    // The header line (mood / provider / how they stand with you) follows them while open.
    if (this._open && !this.thinking) {
      this._hdr = (this._hdr || 0) + 1;
      if (this._hdr >= 90) {
        this._hdr = 0;
        this.refreshHeader();
      }
    }
    // Who is within earshot: the To: row while open, and whether the one you talk to has gone.
    this._scanT -= Number(dt) || 0;
    if (this._scanT <= 0) {
      this._scanT = this._open ? SCAN_EVERY : SCAN_EVERY * 4;
      if (this._open) this.refreshPeople();
      else if (this.target !== LYRA) this.checkTarget();
      this.frameWorld();
    }
  }

  // On a phone held upright the chat covers the lower half of the world, where the player
  // (and whoever they talk to) stands: the camera looks a little lower while it is open,
  // so they stay in sight above it. Restored when the chat closes.
  frameWorld() {
    const cam = this.game.camera;
    const r = this.game.renderer;
    if (!cam || !Number.isFinite(cam.focusY) || typeof window === 'undefined') return;
    if (this._baseFocusY === undefined) this._baseFocusY = cam.focusY;
    let shift = 0;
    if (this._open && this.el && r?.cssToWorld) {
      const box = this.el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      if (box.width >= vw * 0.8 && box.top > vh * 0.2 && box.top < vh) {
        const perCss = r.cssToWorld(0, 1).y - r.cssToWorld(0, 0).y;
        if (perCss > 0) shift = Math.min(cam.vh * 0.4, ((vh - box.top) / 2) * perCss);
      }
    }
    const want = this._baseFocusY + Math.round(shift);
    if (cam.focusY !== want) cam.focusY = want;
  }

  // ======================================================================== §23: anyone

  targetName(id = this.target) {
    if (id === NEAR) return 'Everyone nearby';
    if (id === LYRA) return this.game.settings?.companionName || this.game.companion?.name || 'Lyra';
    const e = this.entity(id);
    return firstName(e?.name) || capitalize(String(id || 'them'));
  }

  entity(id) {
    if (!id || id === NEAR) return null;
    if (id === LYRA) return this.game.companion || null;
    try {
      return this.game.entities?.get?.(id) || null;
    } catch {
      return null;
    }
  }

  village() {
    return villageOf(this.game);
  }

  // A villager's conversation: the village keeps (and saves) it; without one, this chat does.
  threadOf(id) {
    if (id === NEAR) return this.local[NEAR] || [];
    const v = this.village();
    if (v) {
      try {
        return chatOf(v, id);
      } catch {
        /* an older village */
      }
    }
    return this.local[id] || [];
  }

  // One line in a villager's conversation; shown at once when they are selected.
  pushVillager(id, m) {
    const from = ['player', 'npc', 'system'].includes(m.from) ? m.from : 'system';
    const text = cleanLine(m.text, 400);
    if (!text || !id || id === LYRA) return null;
    const v = this.village();
    let msg = null;
    if (id === NEAR) {
      const list = (this.local[NEAR] ||= []);
      msg = { from, text, name: m.name || null, aloud: !!m.aloud, act: !!m.act, day: this.game.clock?.day ?? 1, t: Math.round(this.game.clock?.t ?? 0) };
      list.push(msg);
      if (list.length > 60) list.splice(0, list.length - 60);
    } else if (v) {
      try {
        msg = recordChat(v, id, { from, text });
      } catch {
        msg = null;
      }
    }
    if (msg && m.act) msg.act = true;
    if (!msg) {
      const list = (this.local[id] ||= []);
      msg = { from, text, act: !!m.act, day: this.game.clock?.day ?? 1, t: Math.round(this.game.clock?.t ?? 0) };
      list.push(msg);
      if (list.length > 40) list.splice(0, list.length - 40);
    }
    if (!this.mounted) return msg;
    if (this.target === id) {
      this.log.querySelector('.chat-empty')?.remove();
      this.log.insertBefore(this.buildVillagerRow(id, msg), this.thinkingRow.parentNode === this.log ? this.thinkingRow : null);
      this.scrollToEnd();
    } else if (from === 'npc' && !m.seen) this.bumpUnread(id);
    if (from === 'npc' && !this._open && !m.seen) {
      this.unread++;
      this.ui.hud?.setUnread(this.unread);
    }
    return msg;
  }

  bumpUnread(id) {
    this.unreadBy.set(id, (this.unreadBy.get(id) || 0) + 1);
    this.refreshPeople(true);
  }

  buildVillagerRow(id, m) {
    if (m.from === 'player') return h('div', { class: `msg msg-player${m.aloud ? ' msg-aloud' : ''}` }, h('span', { class: 'msg-text', text: m.text }));
    if (m.from === 'system') return h('div', { class: `msg msg-system chat-note${m.act ? ' msg-act' : ''}` }, h('span', { class: 'msg-text', text: m.text }));
    return h('div', { class: 'msg msg-npc chat-npc-line' }, h('span', { class: 'msg-name', text: m.name || this.targetName(id) }), h('span', { class: 'msg-text', text: m.text }));
  }

  // Show the selected person's conversation.
  renderThread() {
    if (!this.mounted) return;
    clear(this.log);
    if (this.target === LYRA) {
      for (const m of this.messages) {
        if (!m.el) this._render(m);
        if (m.el) this.log.append(m.el);
      }
    } else {
      const id = this.target;
      const list = this.threadOf(id);
      const today = this.game.clock?.day ?? 1;
      let lastDay = null;
      for (const m of list) {
        // Earlier days are marked, so "last time" reads as last time.
        if (m.day !== lastDay && (lastDay !== null || m.day < today)) this.log.append(h('div', { class: 'chat-day', text: m.day === today ? 'Today' : m.day === today - 1 ? 'Yesterday' : `Day ${m.day}` }));
        lastDay = m.day;
        this.log.append(this.buildVillagerRow(id, m));
      }
      if (!list.length && id === NEAR) {
        this.log.append(h('div', { class: 'chat-empty' }, h('span', { text: 'Say it aloud: everyone near enough hears you.' }), h('span', { class: 'chat-empty-sub', text: 'A shout (all capitals, or "!") carries farther. Walls muffle it.' })));
      } else if (!list.length) {
        const e = this.entity(id);
        const n = this.targetName(id);
        this.log.append(h('div', { class: 'chat-empty' }, h('span', { text: `Say anything to ${n}.` }), h('span', { class: 'chat-empty-sub', text: `${e && standingOf(this.game, e).asleep ? `${n} is asleep; some of it reaches ${pronounOf(e.id)} all the same. ` : ''}What you say stays with them, and gets around.` })));
      }
    }
    this.log.append(this.thinkingRow);
    this.syncThinkingRow();
    this.scrollToEnd();
  }

  // Pick who the chat talks to. opts: { focus, from: 'chip'|'world'|… }
  selectTarget(id, { focus = false, from = '' } = {}) {
    if (!id) return false;
    if (id === LYRA && from && !this.lyraListening() && !this.game.party?.isCompanion?.(this.game.companion)) {
      // Lyra is a person like anyone else: out of her earshot, she cannot hear the chat.
      const L = this.game.companion;
      if (L) this.ui.toast?.(notHeardText(this.game, L, whyNotHeard(this.game, L, Infinity) || 'far'), 'info', { key: 'chat-far' });
      return false;
    }
    if (id !== LYRA && id !== NEAR) {
      const e = this.entity(id);
      if (!isVillager(e)) return false;
      if (!canHear(this.game, e, EARSHOT_LOSE)) {
        this.ui.toast?.(notHeardText(this.game, e, whyNotHeard(this.game, e, EARSHOT_LOSE)), 'info', { key: 'chat-far' });
        return false;
      }
      this.seenAt.set(id, { nx: e.x, ny: e.y, px: this.game.player?.x ?? 0, py: this.game.player?.y ?? 0 });
      // They notice you turn to them.
      try {
        if (this.game.player) e.faceToward?.(this.game.player.x, this.game.player.y);
      } catch {
        /* cosmetic */
      }
    }
    const changed = id !== this.target;
    if (changed) {
      if (this.dictState !== 'idle' && this.ownsDictation()) this.stopDictation();
      this.target = id;
      this.away = null;
      this.unreadBy.set(id, 0);
      this.applyTarget();
      this.renderThread();
      // Someone who watched the stranger kill: what the player sees as they turn to them.
      // The talk stays open; they answer in terror (DESIGN §29.3).
      if (id !== LYRA && id !== NEAR) this.fearNote(this.entity(id));
      if (from) this.game.audio?.play('ui_click', { volume: 0.6 });
    }
    this.refreshPeople(true);
    this.toBar?.reveal(id);
    if (focus && this._open && !this.field.disabled) this.focusSoon();
    return true;
  }

  // The field, the mic, the chips and the header follow the selected person.
  applyTarget() {
    if (!this.mounted) return;
    const lyra = this.target === LYRA;
    const n = this.targetName();
    const gone = lyra && this.gone;
    // Only the body stops a talk (out of earshot, asleep, hurt): never hate or fear.
    const away = !lyra && !!this.away;
    this.field.disabled = away;
    this.sendBtn.disabled = away;
    this.mic.disabled = away;
    this.chips.hidden = gone || away;
    this.field.placeholder = away ? `${n} can't hear you now.` : this.target === NEAR ? 'Say something aloud…' : `Say something to ${n}…`;
    this.field.setAttribute('aria-label', `Message to ${n}`);
    if (this.dictState === 'idle') this.mic.title = `Speak to ${n}`;
    this.log.setAttribute('aria-label', `Conversation with ${n}`);
    this.el.setAttribute('aria-label', `Chat with ${n}`);
    toggleClass(this.el, 'is-gone', gone);
    toggleClass(this.el, 'to-npc', !lyra);
    toggleClass(this.el, 'to-near', this.target === NEAR);
    toggleClass(this.el, 'is-away', away);
    this.renderChips();
    this.refreshHeader();
  }

  renderChips() {
    if (!this.chips) return;
    clear(this.chips);
    const id = this.target;
    let list = CHIPS;
    if (id === NEAR) list = ALOUD_CHIPS;
    else if (id !== LYRA) {
      const v = this.village();
      let knows = false;
      try {
        knows = !!(v && knownName(v, id));
      } catch {
        knows = false;
      }
      list = villagerChips(this.game, id, knows);
    }
    for (const c of list) {
      const b = h('button', { type: 'button', class: 'chip', text: c });
      b.addEventListener('click', () => this.send(c, this.target));
      this.chips.append(b);
    }
    this.chips.scrollLeft = 0;
    this.chips.scrollTop = 0;
    this.markMoreChips();
  }

  // A fade at the far edge while more quick replies are out of view (.has-more).
  markMoreChips() {
    const el = this.chips;
    if (!el || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      const more = el.scrollHeight > el.clientHeight + el.scrollTop + 2 || el.scrollWidth > el.clientWidth + el.scrollLeft + 2;
      el.classList.toggle('has-more', more);
    });
  }

  villagerHeader() {
    const g = this.game;
    const id = this.target;
    if (id === NEAR) {
      this.nearHeader();
      return;
    }
    const e = this.entity(id);
    toggleClass(this.el, 'to-npc', true);
    const reach = !!e && isVillager(e) && this.inReach(e);
    this.tradeBtn.hidden = !reach;
    setText(this.title, e?.name || this.targetName(id));
    const st = standingOf(g, e);
    const bits = [];
    const role = e?.role || e?.profile?.role;
    if (role) bits.push(String(role));
    if (this.waiting.has(id)) bits.push('thinking…');
    else if (this.away) bits.push('out of earshot');
    else if (st.asleep) bits.push('asleep');
    else {
      bits.push(st.cold ? 'cold to you' : st.label);
      const mood = moodWord(this.moods.get(id));
      if (mood) bits.push(mood);
    }
    if (this.dictState === 'listening') bits.push('listening to you…');
    if (e && isVillager(e) && !reach && !this.away && e.profile?.shop) bits.push(`walk up to ${this.targetName(id)} to trade`);
    // Lyra overhears what you say near her (§23): worth knowing.
    const lyra = g.companion;
    if (lyra && !lyra.removed && !lyra.downed && g.player && Math.hypot(lyra.x - g.player.x, lyra.y - g.player.y) <= 110) bits.push(`${this.targetName(LYRA)} can hear`);
    setText(this.status, bits.join(' · '));
    toggleClass(this.el, 'is-thinking', this.waiting.has(id));
    const url = e ? portraitUrl(g, e.spriteKey || e.id, faceOf(st, this.moods.get(id))) : '';
    if (url && this.portrait.src !== url) this.portrait.src = url;
  }

  // The To: row: Lyra, then everyone within earshot (and the selected one while they go).
  refreshPeople(force = false) {
    if (!this.mounted || !this.toBar) return;
    const g = this.game;
    // Chips keep their places while you tap: whoever was already here stays where they
    // were, and newcomers join at the end (never sliding in under your finger).
    const prev = this.people || [];
    const rank = (id) => {
      const i = prev.indexOf(id);
      return i < 0 ? 1e9 : i;
    };
    const people = earshotPeople(g, { keep: this.people }).sort((a, b) => rank(a.id) - rank(b.id));
    const ids = people.map((e) => e.id);
    this.people = ids;
    for (const e of people) this.seenAt.set(e.id, { nx: e.x, ny: e.y, px: g.player?.x ?? 0, py: g.player?.y ?? 0 });
    this.checkTarget(ids);
    // While you are in the middle of talking with someone close by, they stay to listen.
    if (this.target !== LYRA && !this.away && Date.now() - (this.talkedAt || 0) < 30000) {
      const e = this.entity(this.target);
      if (e && e.talkingUntil !== undefined) e.talkingUntil = Math.max(e.talkingUntil ?? 0, (g.clock?.t ?? 0) + 2);
    }
    const lyra = g.companion;
    const cs = companionshipOf(g);
    const list = [];
    // Everyone nearby first (saying it aloud), then whoever walks with you, then Lyra while
    // she can hear you (a person like anyone else when she is not your companion), then the
    // rest, nearest first (round 14b T-1, T-2).
    list.push({ id: NEAR, name: `Everyone (${people.length + (lyra && this.lyraListening() && lyra.x != null && g.player && Math.hypot(lyra.x - g.player.x, lyra.y - g.player.y) <= EARSHOT_LOSE ? 1 : 0)})`, portrait: '', tone: 'near', label: 'say it aloud', selected: this.target === NEAR, unread: 0 });
    let holder = null;
    try {
      holder = g.party?.holder || null;
    } catch {
      holder = null;
    }
    if (holder && holder !== lyra && isVillager(holder)) {
      list.push({ ...chipFor(g, holder, { selected: this.target === holder.id, unread: this.unreadBy.get(holder.id) || 0 }), label: 'with you', companion: true });
    }
    if (lyra && (this.lyraListening() || this.target === LYRA)) {
      const expr = cs === 'gone' || cs === 'left' ? 'sad' : this.thinking ? 'neutral' : 'happy';
      list.push({ id: LYRA, name: this.targetName(LYRA), portrait: portraitUrl(g, 'lyra', expr), tone: cs === 'gone' ? 'hostile' : cs === 'left' ? 'wary' : 'lyra', label: cs === 'gone' ? 'cut you off' : companionshipLabel(cs).toLowerCase(), selected: this.target === LYRA, unread: this.unreadBy.get(LYRA) || 0, gone: cs === 'gone', away: !this.lyraListening() });
    }
    for (const e of people) if (e !== holder) list.push(chipFor(g, e, { selected: this.target === e.id, unread: this.unreadBy.get(e.id) || 0 }));
    if (this.target !== LYRA && this.target !== NEAR && !ids.includes(this.target) && !(holder && holder.id === this.target)) {
      const e = this.entity(this.target);
      if (e) list.push(chipFor(g, e, { selected: true, away: true }));
    }
    const key = list.map((p) => `${p.id}:${p.tone}:${p.selected}:${p.unread}:${p.asleep}:${p.away}:${p.label}`).join(',');
    if (!force && key === this._peopleKey) return;
    this._peopleKey = key;
    this.toBar.render(list);
  }

  // Has the person you are talking to gone out of earshot? Then the talk ends, gracefully.
  checkTarget(ids = null) {
    const id = this.target;
    if (id === LYRA || id === NEAR) return;
    const e = this.entity(id);
    const why = !e ? 'dead' : ids ? (ids.includes(id) ? null : whyNotHeard(this.game, e, EARSHOT_LOSE) || 'far') : whyNotHeard(this.game, e, EARSHOT_LOSE);
    if (!why) {
      if (this.away) {
        // Back within earshot: the field opens again.
        this.away = null;
        this.applyTarget();
      }
      return;
    }
    if (this.away) return;
    this.away = why;
    // That conversation is over: an answer still on its way is never given, and catching
    // up with them starts a new one (DESIGN §23).
    this.talkSeq.set(id, (this.talkSeq.get(id) || 0) + 1);
    const ended = this.sessions.get(id);
    if (ended) {
      ended.onLate = null;
      this.sessions.delete(id);
    }
    // Who moved: the villager walking off, or the player walking away?
    const seen = this.seenAt.get(id);
    const p = this.game.player;
    let who = 'they';
    if (seen && e && p) who = Math.hypot(p.x - seen.px, p.y - seen.py) > Math.hypot(e.x - seen.nx, e.y - seen.ny) ? 'you' : 'they';
    // Whatever they were still saying is said before they go.
    this.flushUnsaid(id);
    const last = this.threadOf(id).slice(-1)[0];
    if (last && last.from !== 'system') this.pushVillager(id, { from: 'system', text: partingLine(e, why, who) });
    if (this.dictState !== 'idle' && this.ownsDictation()) this.stopDictation();
    if (!this._open) {
      this.selectTarget(this.defaultTarget());
      return;
    }
    this.applyTarget();
  }

  sessionFor(e) {
    let s = this.sessions.get(e.id);
    const v = this.village();
    if (!s || s.village !== v) {
      s = new TalkSession({ village: v, npc: e });
      s.onLate = (reply) => this.villagerReplied(e, reply, true);
      this.sessions.set(e.id, s);
    }
    s.npc = e;
    return s;
  }

  // An act between asterisks shows over the player's head, in italics (round 14b T-3).
  actBubble(text) {
    const m = String(text || '').match(/\*([^*\n]{1,120})\*/);
    if (!m) return false;
    try {
      this.game.bubbles?.say?.(this.game.player, `*${m[1].trim()}*`, { kind: 'act' });
    } catch {
      /* cosmetic */
    }
    return true;
  }

  // The player says something to a villager.
  sendToVillager(id, text) {
    const t = cleanLine(text, 300);
    if (!t) return;
    const g = this.game;
    const e = this.entity(id);
    const v = this.village();
    if (!e || typeof v?.playerSays !== 'function') {
      this.pushVillager(id, { from: 'system', text: `${this.targetName(id)} can't hear you.` });
      return;
    }
    if (this.target !== id) this.selectTarget(id);
    if (!canHear(g, e, EARSHOT_LOSE) || this.away) {
      this.checkTarget();
      return;
    }
    // The rest of their last answer is said before the player's next line, never after.
    this.flushUnsaid(id);
    this.pushVillager(id, { from: 'player', text: t });
    this.actBubble(t);
    this.talkedAt = Date.now();
    g.audio?.play('ui_click');
    // Still answering the last line: this one waits its turn.
    if (this.waiting.has(id)) {
      this.queued.set(id, t);
      return;
    }
    this.ask(e, t);
  }

  // ---------- saying it aloud (round 14b T-2, DESIGN §33.3) ----------

  // The "Everyone nearby" thread: said aloud, heard by whoever the hearing rule lets hear
  // it; their answers come back staggered, as bubbles over their heads and rows here.
  sayAloud(text) {
    const t = cleanLine(text, 300);
    if (!t) return;
    const g = this.game;
    const v = this.village();
    if (this.target !== NEAR) this.selectTarget(NEAR);
    this.flushUnsaid(NEAR);
    this.pushVillager(NEAR, { from: 'player', text: t, aloud: true });
    g.audio?.play('ui_click');
    if (this.actBubble(t)) {
      /* the act over their head; the words, if any, follow in the thread */
    } else try {
      const shout = /!\s*$/.test(t) || (t.replace(/[^A-Za-z]/g, '').length >= 3 && t.replace(/[^A-Za-z]/g, '') === t.replace(/[^A-Za-z]/g, '').toUpperCase());
      g.bubbles?.say?.(g.player, t, { kind: shout ? 'shout' : 'say' });
    } catch {
      /* cosmetic */
    }
    if (typeof v?.sayAloud !== 'function') {
      this.pushVillager(NEAR, { from: 'system', text: 'Nobody is near enough to hear you.', act: true });
      return;
    }
    this.setWaiting(NEAR, true);
    let p;
    try {
      p = v.sayAloud(t);
    } catch (err) {
      console.warn('[chat] saying it aloud failed', err);
      p = Promise.resolve(null);
    }
    Promise.resolve(p).then(
      (res) => {
        this.setWaiting(NEAR, false);
        this.aloudReplied(res, t);
      },
      () => this.setWaiting(NEAR, false),
    );
  }

  aloudReplied(res, said) {
    const g = this.game;
    if (!res) return;
    if (res.refused) {
      this.pushVillager(NEAR, { from: 'system', text: res.refused, act: true });
      return;
    }
    if (res.acted) this.pushVillager(NEAR, { from: 'system', text: res.acted, act: true });
    const heardClear = (res.hearers || []).filter((h) => h.how === 'clear');
    if (!res.hearers?.length) {
      this.pushVillager(NEAR, { from: 'system', text: res.shout ? 'Your shout carries, and nobody answers. Nobody is near enough to hear it.' : 'Nobody is near enough to hear you.', act: true });
      return;
    }
    if (!heardClear.length) {
      this.pushVillager(NEAR, { from: 'system', text: 'Somewhere behind the walls, someone may have heard a voice.', act: true });
      return;
    }
    // Lyra, named or your companion: she answers once, through her own mind.
    if (res.lyra === 'answer' && g.brain?.handlePlayerMessage) {
      Promise.resolve(g.brain.handlePlayerMessage(said)).then((r) => {
        const say = typeof r?.say === 'string' ? r.say.trim() : '';
        if (say) this.pushVillager(NEAR, { from: 'npc', name: this.targetName(LYRA), text: say });
        else if (r?.silent) this.pushVillager(NEAR, { from: 'system', text: silenceAct('lyra', this.targetName(LYRA), { kind: 'gone' }), act: true });
      }, () => {});
    }
    const queue = [];
    this.unsaid.set(NEAR, queue);
    let delay = 0;
    const speed = Math.max(0.25, Number(g.settings?.textSpeed) || 1);
    for (const r of res.replies || []) {
      const e = this.entity(r.id);
      const rows = [...(r.lines || []).map((l) => ({ from: 'npc', name: r.name, text: l, say: l })), ...(r.narration ? [{ from: 'system', text: r.narration, act: true }] : [])];
      for (const row of rows) {
        const item = { show: null, timer: null };
        item.show = () => {
          const k = queue.indexOf(item);
          if (k < 0) return;
          queue.splice(k, 1);
          clearTimeout(item.timer);
          this.pushVillager(NEAR, row);
          if (row.say && e) {
            try {
              g.bubbles?.clear?.(e);
              if (typeof e.say === 'function') e.say(row.say, { target: g.player || null, kind: 'say' });
              else g.bubbles?.say?.(e, row.say, { kind: 'say' });
            } catch {
              /* cosmetic */
            }
          }
        };
        queue.push(item);
        item.timer = setTimeout(item.show, delay * 1000);
        delay += Math.min(2.6, lineBeat(row.text, speed) * 0.5);
      }
    }
    if (queue.length) queue[0].show();
    else this.pushVillager(NEAR, { from: 'system', text: `${heardClear.length === 1 ? 'Someone hears' : `${heardClear.length} people hear`} you. Nobody answers.`, act: true });
    this.refreshPeople(true);
  }

  // The header while saying it aloud: who can hear.
  nearHeader() {
    const g = this.game;
    toggleClass(this.el, 'to-npc', true);
    if (this.tradeBtn) this.tradeBtn.hidden = true;
    setText(this.title, 'Everyone nearby');
    const n = (this.people || []).length + (g.companion && this.lyraListening() && g.player && Math.hypot(g.companion.x - g.player.x, g.companion.y - g.player.y) <= EARSHOT_LOSE ? 1 : 0);
    const bits = [this.waiting.has(NEAR) ? 'listening…' : n ? `${n} near enough to hear you` : 'nobody near enough to hear you'];
    bits.push('say it aloud');
    setText(this.status, bits.join(' · '));
    toggleClass(this.el, 'is-thinking', this.waiting.has(NEAR));
    this.portrait.removeAttribute('src');
  }

  // A villager in terror of the player: one line of what the player sees (once in a
  // row), and nothing locked. Their answers come in terror, from them.
  fearNote(e) {
    if (!e) return null;
    let note = null;
    try {
      note = this.village()?.fearNote?.(e) || null;
    } catch {
      note = null;
    }
    if (!note || this.target !== e.id) return note;
    const last = this.threadOf(e.id).slice(-1)[0];
    if (!last || last.text !== note) this.pushVillager(e.id, { from: 'system', text: note });
    return note;
  }

  ask(e, t) {
    const g = this.game;
    const id = e.id;
    const s = this.sessionFor(e);
    this.setWaiting(id, true);
    try {
      if (g.player) e.faceToward?.(g.player.x, g.player.y);
      // They stop to listen (the village holds them a little longer once they answer).
      if (e.talkingUntil !== undefined) e.talkingUntil = Math.max(e.talkingUntil ?? 0, (g.clock?.t ?? 0) + 6);
      g.bubbles?.icon?.(e, '...');
    } catch {
      /* cosmetic */
    }
    let p;
    const talk = this.talkSeq.get(id) || 0;
    try {
      p = s.send(t);
    } catch (err) {
      console.warn('[chat] villager failed', err);
      p = Promise.resolve(null);
    }
    Promise.resolve(p).then(
      (reply) => {
        this.setWaiting(id, false);
        // Only within the conversation it answers: not after they went on their way.
        if (reply && (this.talkSeq.get(id) || 0) === talk) this.villagerReplied(e, reply);
        const next = this.queued.get(id);
        if (next) {
          this.queued.delete(id);
          if (canHear(g, e, EARSHOT_LOSE)) this.ask(e, next);
        }
      },
      () => this.setWaiting(id, false),
    );
  }

  setWaiting(id, on) {
    if (on) this.waiting.add(id);
    else this.waiting.delete(id);
    if (this.target === id) {
      this.syncThinkingRow();
      this.refreshHeader();
      this.scrollToEnd();
    }
  }

  // Their answer: in the log and as bubbles over their head, one line at a time. What they
  // did instead of words, or with them, is a narration row (DESIGN §23.3, §33.4).
  villagerReplied(e, reply, late = false) {
    if (!e || !reply?.lines?.length) return;
    const g = this.game;
    const id = e.id;
    // Gone on their way (or backed off in fear) before the answer came: they cannot answer
    // you now (the author: "Elda has gone on her way… and she STILL replies").
    if ((this.target === id && this.away) || !canHear(g, e, EARSHOT_LOSE)) return;
    if (reply.mood) this.moods.set(id, String(reply.mood).toLowerCase());
    // What the player's hands did, as the game decided it (*bows*, *slaps Bram*).
    if (reply.acted) this.pushVillager(id, { from: 'system', text: reply.acted, act: true });
    if (!reply.ok || reply.silent || reply.narrationOnly) {
      // No words came: what the player sees them do instead.
      this.pushVillager(id, { from: 'system', text: reply.narration || reply.lines[0], act: true });
      if (this.target === id) this.refreshHeader();
      this.refreshPeople(true);
      return;
    }
    this.flushUnsaid(id);
    let delay = 0;
    const speed = Math.max(0.25, Number(g.settings?.textSpeed) || 1);
    const queue = [];
    this.unsaid.set(id, queue);
    reply.lines.forEach((line, i) => {
      const item = { show: null, timer: null };
      const show = () => {
        const k = queue.indexOf(item);
        if (k < 0) return;
        queue.splice(k, 1);
        clearTimeout(item.timer);
        this.pushVillager(id, { from: 'npc', text: line });
        try {
          g.bubbles?.clear?.(e);
          if (typeof e.say === 'function') e.say(line, { target: g.player || null, kind: 'say' });
          else g.bubbles?.say?.(e, line, { kind: 'say' });
        } catch {
          /* cosmetic */
        }
        if (!this._open || this.target !== id) g.audio?.play('talk_blip', { volume: 0.6 });
      };
      item.show = show;
      queue.push(item);
      if (i > 0 && !late) item.timer = setTimeout(show, delay * 1000);
      delay += Math.min(3.2, lineBeat(line, speed) * 0.6);
    });
    // What they do with the words, after them.
    if (reply.narration) {
      const item = { show: null, timer: null };
      item.show = () => {
        const k = queue.indexOf(item);
        if (k < 0) return;
        queue.splice(k, 1);
        clearTimeout(item.timer);
        this.pushVillager(id, { from: 'system', text: reply.narration });
      };
      queue.push(item);
      if (!late) item.timer = setTimeout(item.show, delay * 1000);
    }
    // The first line at once (and all of a late answer); the rest in their own time.
    for (const it of late ? [...queue] : queue.slice(0, 1)) it.show();
    if (this.target === id) this.refreshHeader();
    this.refreshPeople(true);
  }

  flushUnsaid(id) {
    const q = this.unsaid.get(id);
    if (!q?.length) return;
    for (const it of [...q]) it.show();
  }
}

function safeFind(mind, id) {
  try {
    return findMemory(mind, id, STORY);
  } catch {
    return null;
  }
}
