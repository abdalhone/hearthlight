// Chat with Lyra (DESIGN.md §14): message log, text field, Send, quick-reply chips,
// a dictation mic when the runtime offers one, and her thinking indicator.
// Opening it never pauses the world; typing turns game keys off.

import { h, button, setText, toggleClass, clear } from './dom.js';
import { CHIPS } from './content.js';
import { portraitUrl } from './art.js';
import { cleanLine } from './format.js';
import { memoryRefs, findMemory, memoryChipLabel, STORE_LABELS, companionshipOf, companionshipLabel } from './lyra_view.js';
import { STORY } from '../lore/story.js';

const MAX_MESSAGES = 140;
const DUP_WINDOW_MS = 6000; // the same line from two paths within this window is one message
const KINDS = new Set(['answer', 'refusal', 'problem', 'initiative', 'state', 'order', 'bark']);

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
  }

  mount() {
    if (this.mounted) return this.el;
    this.mounted = true;
    this.portrait = h('img', { class: 'portrait portrait-chat', alt: '', draggable: 'false' });
    this.title = h('div', { class: 'chat-name' });
    this.status = h('div', { class: 'chat-status' });
    const closeBtn = button('', { icon: 'close', cls: 'btn-icon chat-close', title: 'Close chat (Esc)', onClick: () => this.close() });
    const head = h('header', { class: 'chat-head' }, h('span', { class: 'portrait-frame small' }, this.portrait), h('div', { class: 'chat-heading' }, this.title, this.status), closeBtn);

    this.log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with Lyra' });
    this.thinkingRow = h('div', { class: 'msg msg-lyra msg-thinking', hidden: true }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')));

    this.chips = h('div', { class: 'chat-chips' });
    for (const c of CHIPS) {
      const b = h('button', { type: 'button', class: 'chip', text: c });
      b.addEventListener('click', () => this.send(c));
      this.chips.append(b);
    }

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

    this.el = h('aside', { class: 'chat', hidden: true, 'aria-label': 'Chat with Lyra' }, head, this.log, this.chips, form);
    for (const m of this.messages) this._render(m);
    this.log.append(this.thinkingRow);
    this.refreshHeader();
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
      this.refreshHeader();
    }
    this.unread = 0;
    this.ui.hud?.setUnread(0);
    this.scrollToEnd();
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
  }

  toggle() {
    if (this._open) this.close();
    else this.open(!this.ui.isTouch);
  }

  isOpen() {
    return this._open;
  }

  // {from: 'player'|'lyra'|'system'|'npc', text, name, kind?, memories?, offer?, note?}
  // kind: 'initiative' (her own announcement or request), 'refusal', 'answer' (to a
  // request), 'problem', 'state' (system: where she stands with you changed).
  // memories: what she remembered for this reply (ids or {id, label, store, text}).
  // offer: { label, name, args } a counter-offer the player can accept with one tap.
  addMessage(m) {
    if (!m || !m.text) return null;
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
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    if (this.mounted) {
      this._render(msg);
      if (from === 'lyra' && !this._open) {
        this.unread++;
        this.ui.hud?.setUnread(this.unread);
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
  }

  setThinking(on) {
    this.thinking = !!on;
    if (!this.mounted) return;
    this.thinkingRow.hidden = !this.thinking;
    if (this.thinking) this.log.append(this.thinkingRow);
    this.refreshHeader();
    this.scrollToEnd();
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
    this.send(text);
  }

  send(text) {
    const t = cleanLine(text, 400);
    if (!t || this.gone) return;
    const g = this.game;
    if (!g.brain?.handlePlayerMessage) return;
    // Echo now so the line appears instantly even if the brain is slow to answer.
    this.addMessage({ from: 'player', text: t });
    this.lastPlayerEcho = { text: t, at: Date.now() };
    this.lastSentAt = Date.now();
    g.audio?.play('ui_click');
    let p;
    try {
      p = g.brain.handlePlayerMessage(t);
    } catch (err) {
      console.warn('[chat] message failed', err);
      this.addMessage({ from: 'system', text: "Lyra didn't catch that. Try again in a moment." });
      return;
    }
    const sentAt = Date.now();
    Promise.resolve(p).then(
      (r) => this.afterReply(r, sentAt),
      (err) => {
        console.warn('[chat] message failed', err);
        this.setThinking(false);
        this.addMessage({ from: 'system', text: "Lyra didn't catch that. Try again in a moment." });
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

  // Once she has cut the player off she will not talk; the log stays to read.
  setGone(on) {
    const gone = !!on;
    if (gone === this.gone && this.mounted && this.field.disabled === gone) return;
    this.gone = gone;
    if (!this.mounted) return;
    const name = this.game.settings?.companionName || 'Lyra';
    if (gone && this.dictState !== 'idle') this.stopDictation();
    this.field.disabled = gone;
    this.sendBtn.disabled = gone;
    this.mic.disabled = gone;
    this.chips.hidden = gone;
    this.field.placeholder = gone ? `${name} won't talk to you.` : `Say something to ${name}…`;
    toggleClass(this.el, 'is-gone', gone);
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
          this.mic.title = this.dictState === 'idle' ? 'Speak to Lyra' : 'Stop listening';
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
  ownsDictation() {
    return !this.ui.dictOwner || this.ui.dictOwner === 'chat';
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
    if (this.mounted) {
      clear(this.log);
      this.log.append(this.thinkingRow);
    }
  }

  update() {
    // Lyra's header line (mood / provider) follows her state while open.
    if (this._open && !this.thinking) {
      this._hdr = (this._hdr || 0) + 1;
      if (this._hdr >= 90) {
        this._hdr = 0;
        this.refreshHeader();
      }
    }
  }
}

function safeFind(mind, id) {
  try {
    return findMemory(mind, id, STORY);
  } catch {
    return null;
  }
}
