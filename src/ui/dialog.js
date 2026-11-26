// NPC conversations (DESIGN.md §7, §14, §19.6): portrait, name, role, typed-out lines
// and options; gifts through an inventory picker; shops with buy and sell lists; and a
// "Say something…" field (with the mic when dictation exists) that lets the player say
// anything to anyone through village.playerSays.

import { h, button, clear, setText, toggleClass } from './dom.js';
import { makePanel } from './modal.js';
import { portraitUrl, itemIconUrl } from './art.js';
import { itemDef, itemName } from '../entities/items.js';
import { fmtInt, isGiftable, sortItems, voicePitch, capitalize } from './format.js';
import { TalkSession, villageOf, firstName, SAY_MAX } from './village_view.js';
import { FieldDictation } from './dictation.js';
import { shopOf, priceFor, stance, moodOf } from '../world/trade.js';

const CHARS_PER_SECOND = 52;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[dialog]', err);
    return fallback;
  }
}

export class DialogPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.npc = null;
    this.lines = [];
    this.lineIdx = 0;
    this.shown = 0;
    this.typing = false;
    this.options = [];
    this.mode = 'talk'; // talk | gift | shop
    this.blipAcc = 0;
    this.mood = 'neutral';
    this.talk = null; // TalkSession while the village can answer free text
    this.waiting = false;
    this.dict = null;
  }

  isOpen() {
    return !!this.panel && this.ui.stack.includes(this.panel);
  }

  open(npc) {
    if (!npc) return;
    if (this.isOpen()) this.close(true);
    this.npc = npc;
    const panel = makePanel({ id: 'dialog', title: npc.name || 'Someone', subtitle: capitalize(npc.role || npc.profile?.role || ''), cls: 'panel-dialog' });
    this.panel = panel;
    this.portrait = h('img', { class: 'portrait portrait-xl', alt: '', draggable: 'false' });
    this.setExpression('happy');
    this.textEl = h('p', { class: 'dlg-text', 'aria-live': 'polite' });
    // More to say: a bobbing ▼, and on a phone the words too (the options wait behind it).
    this.moreEl = h('span', { class: 'dlg-more', hidden: true }, this.ui.isTouch ? h('span', { class: 'dlg-more-hint', text: 'Tap for more' }) : null, h('span', { class: 'dlg-more-arrow', text: '▼' }));
    this.optionsEl = h('div', { class: 'dlg-options' });
    this.extraEl = h('div', { class: 'dlg-extra' });
    this.youEl = h('p', { class: 'dlg-you', hidden: true });
    this.dotsEl = h('span', { class: 'dots dlg-dots', hidden: true, 'aria-label': `${firstName(npc.name) || 'They'} is thinking` }, h('i'), h('i'), h('i'));
    const textBox = h('div', { class: 'dlg-box' }, this.textEl, this.dotsEl, this.moreEl);
    textBox.addEventListener('click', () => this.advance());
    panel.body.append(h('div', { class: 'dlg' }, h('span', { class: 'portrait-frame dlg-portrait' }, this.portrait), h('div', { class: 'dlg-main' }, this.youEl, textBox, this.extraEl, this.optionsEl)));
    this.buildSay(npc);
    panel.onClose = () => this.onClosed();
    this.ui.openModal(panel);
    const d = safe(() => npc.getDialogue(this.game.player), null) || { lines: [`${npc.name || 'They'} nods at you.`], options: [{ id: 'bye', label: 'Goodbye' }] };
    this.mode = 'talk';
    this.play(d.lines, d.options);
  }

  close(silent = false) {
    if (this.isOpen()) this.ui.closeModal(this.panel, silent);
  }

  onClosed() {
    this.dict?.detach();
    this.dict = null;
    if (this.talk) this.talk.onLate = null;
    this.talk = null;
    this.waiting = false;
    this.sayField = null;
    this.ui.root.classList.remove('dlg-typing');
    this.panel = null;
    this.npc = null;
    this.typing = false;
  }

  // ---------- saying anything (§19.3 playerSays) ----------

  // The field sits in the panel's footer, outside the scrolling body, so it stays on
  // screen (above a phone's keyboard) however long the conversation runs.
  buildSay(npc) {
    const village = villageOf(this.game);
    this.talk = null;
    this.sayField = null;
    if (typeof village?.playerSays !== 'function') return;
    this.talk = new TalkSession({ village, npc });
    this.talk.onLate = (reply) => {
      this.noteInChat(npc, reply);
      if (this.isOpen() && this.npc === npc) this.showReply(reply);
    };
    const who = firstName(npc.name) || 'them';
    const field = h('input', {
      class: 'field dlg-say-field',
      type: 'text',
      maxlength: String(SAY_MAX),
      autocomplete: 'off',
      enterkeyhint: 'send',
      spellcheck: 'true',
      'aria-label': `Say something to ${who}`,
      placeholder: this.ui.isTouch ? 'Say something…' : 'Say something… (T)',
    });
    field.addEventListener('focus', () => this.setTypingClass(true));
    field.addEventListener('blur', () => this.setTypingClass(false));
    field.addEventListener('keydown', (e) => {
      // The world's keys stay quiet while typing; Enter sends.
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.submitSay();
      }
    });
    const mic = button('', { icon: 'mic', cls: 'btn-icon dlg-mic', title: `Speak to ${who}` });
    this.sendBtn = button('', { icon: 'send', cls: 'btn-icon btn-ember dlg-send', title: 'Say it (Enter)', onClick: () => this.submitSay() });
    this.sayField = field;
    this.dict = new FieldDictation(this.ui, { field, mic, owner: 'dialog', idleTitle: `Speak to ${who}` });
    this.dict.attach(this.game.runtime?.dictation || null);
    this.panel.foot.classList.add('dlg-say');
    this.panel.foot.append(field, mic, this.sendBtn);
  }

  attachDictation(dict) {
    this.dict?.attach(dict || null);
  }

  setTypingClass(on) {
    // Phones fold the options away while the keyboard is up, so the reply stays in view.
    this.ui.root.classList.toggle('dlg-typing', !!on && this.ui.isTouch);
  }

  submitSay() {
    const field = this.sayField;
    if (!field || !this.talk) return;
    const text = field.value.replace(/\s+/g, ' ').trim();
    if (!text) {
      field.focus({ preventScroll: true });
      return;
    }
    if (this.waiting) return;
    this.dict?.reset();
    field.value = '';
    field.classList.remove('provisional');
    this.game.audio?.play('ui_click');
    this.echoPlayer(text);
    this.setWaiting(true);
    const npc = this.npc;
    // The chat keeps one conversation per person: what is said here is part of it (§23).
    this.ui.chat?.addMessage?.({ to: npc.id, from: 'player', text, seen: true });
    this.talk.send(text).then((reply) => {
      this.noteInChat(npc, reply);
      if (!this.isOpen() || this.npc !== npc) return;
      this.setWaiting(false);
      if (reply) this.showReply(reply);
    });
  }

  noteInChat(npc, reply) {
    if (!npc || !reply?.lines?.length) return;
    for (const line of reply.lines) this.ui.chat?.addMessage?.({ to: npc.id, from: reply.ok ? 'npc' : 'system', text: line, seen: true });
  }

  echoPlayer(text) {
    const name = this.game.settings?.playerName || 'You';
    clear(this.youEl);
    this.youEl.append(h('span', { class: 'dlg-you-name', text: name }), h('span', { class: 'dlg-you-text', text: `“${text}”` }));
    this.youEl.hidden = false;
  }

  setWaiting(on) {
    this.waiting = !!on;
    if (!this.panel) return;
    if (this.sendBtn) this.sendBtn.disabled = this.waiting;
    this.dotsEl.hidden = !this.waiting;
    toggleClass(this.panel.el, 'is-waiting', this.waiting);
    if (this.waiting) {
      this.typing = false;
      setText(this.textEl, '');
      this.moreEl.hidden = true;
      clear(this.optionsEl);
      if (this.mode !== 'talk') {
        this.mode = 'talk';
        clear(this.extraEl);
      }
    }
  }

  showReply(reply) {
    if (!reply?.lines?.length) return;
    if (reply.expr) this.setExpression(reply.expr);
    this.mode = 'talk';
    clear(this.extraEl);
    const opts = reply.options?.length ? reply.options : this.talkOptions();
    this.play(reply.lines, opts);
  }

  // The villager's own options for this moment, as the dialog would offer them now.
  talkOptions() {
    const fresh = safe(() => this.npc?.chooseOption?.('__back', this.game.player)?.options, null);
    const list = Array.isArray(fresh) && fresh.length ? fresh : this.options;
    return list.length ? list : [{ id: 'bye', label: 'Goodbye' }];
  }

  setExpression(expr) {
    if (!this.npc) return;
    const url = portraitUrl(this.game, this.npc.spriteKey || this.npc.id, expr);
    if (url) this.portrait.src = url;
    else this.portrait.classList.add('no-art');
  }

  // Show a sequence of lines, then the options.
  play(lines, options) {
    this.lines = (Array.isArray(lines) ? lines : [lines]).map((l) => String(l ?? '').trim()).filter(Boolean);
    if (!this.lines.length) this.lines = ['…'];
    this.options = Array.isArray(options) && options.length ? options : this.options.length ? this.options : [{ id: 'bye', label: 'Goodbye' }];
    this.lineIdx = 0;
    this.startLine();
  }

  startLine() {
    this.shown = 0;
    this.typing = true;
    this.blipAcc = 0;
    if (this.dotsEl) this.dotsEl.hidden = true;
    setText(this.textEl, '');
    this.moreEl.hidden = true;
    clear(this.optionsEl);
    const reduce = this.ui.reduceMotion;
    if (reduce) this.finishLine();
  }

  finishLine() {
    const line = this.lines[this.lineIdx] || '';
    this.shown = line.length;
    this.typing = false;
    setText(this.textEl, line);
    if (this.lineIdx < this.lines.length - 1) this.moreEl.hidden = false;
    else this.showOptions();
  }

  advance() {
    if (this.typing) {
      this.finishLine();
      return;
    }
    if (this.lineIdx < this.lines.length - 1) {
      this.lineIdx++;
      this.startLine();
    }
  }

  showOptions() {
    clear(this.optionsEl);
    if (this.mode !== 'talk') return;
    this.options.forEach((o, i) => {
      const b = button(o.label || o.id, { cls: `dlg-opt opt-${o.id}`, key: i < 9 ? String(i + 1) : null });
      b.addEventListener('click', () => this.choose(o.id));
      this.optionsEl.append(b);
    });
    // Keyboard players land on the first option, unless they are typing in
    // "Say something…" (the options must not steal the caret mid-word).
    const first = this.optionsEl.querySelector('button');
    const typing = !!this.sayField && document.activeElement === this.sayField;
    if (first && !this.ui.isTouch && !typing) first.focus({ preventScroll: true });
  }

  // Number keys pick options; Enter / Space / E advance the text.
  handleKey(e) {
    if (!this.isOpen()) return false;
    // T (talk) or / puts the caret in "Say something…".
    if (this.sayField && (e.code === 'KeyT' || e.key === '/') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.sayField.focus({ preventScroll: true });
      return true;
    }
    if (/^Digit[1-9]$|^Numpad[1-9]$/.test(e.code) && !this.typing && this.mode === 'talk' && this.lineIdx >= this.lines.length - 1) {
      const i = Number(e.code.slice(-1)) - 1;
      const o = this.options[i];
      if (o) {
        this.choose(o.id);
        return true;
      }
    }
    if ((e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') && (this.typing || this.lineIdx < this.lines.length - 1)) {
      this.advance();
      return true;
    }
    return false;
  }

  choose(id) {
    const npc = this.npc;
    if (!npc) return;
    this.game.audio?.play('ui_click');
    if (id === 'bye' || id === 'goodbye') {
      const r = safe(() => npc.chooseOption(id, this.game.player), null);
      if (r?.lines?.length) {
        this.options = [];
        this.play(r.lines, [{ id: '__close', label: 'Leave' }]);
        return;
      }
      this.close();
      return;
    }
    if (id === '__close') {
      this.close();
      return;
    }
    if (id === '__back') {
      this.mode = 'talk';
      clear(this.extraEl);
      // The villager decides what is still on offer (a shop may close to a wanted player).
      const r = safe(() => npc.chooseOption('__back', this.game.player), null);
      const opts = r?.options?.length ? r.options : safe(() => npc.getDialogue(this.game.player)?.options, null) || this.options;
      this.play(r?.lines?.length ? r.lines : ['Anything else?'], opts);
      return;
    }
    const r = safe(() => npc.chooseOption(id, this.game.player), null) || { lines: ['…'], close: false };
    if (r.open === 'gift') {
      this.mode = 'gift';
      this.play(r.lines?.length ? r.lines : ['Oh? For me?'], r.options);
      this.renderGiftPicker();
      return;
    }
    // Bram's forge (DESIGN §26) opens over the dialogue; closing it comes back here.
    if (r.open === 'forge' && typeof this.ui.openForge === 'function') {
      this.mode = 'talk';
      this.play(r.lines?.length ? r.lines : ['Hmph.'], r.options);
      this.ui.openForge('upgrade');
      return;
    }
    if (r.open === 'shop') {
      this.mode = 'shop';
      this.play(r.lines?.length ? r.lines : ['Take a look.'], r.options);
      this.renderShop();
      return;
    }
    this.mode = 'talk';
    clear(this.extraEl);
    if (r.close && !(r.lines && r.lines.length)) {
      this.close();
      return;
    }
    this.play(r.lines, r.close ? [{ id: '__close', label: 'Leave' }] : r.options || this.options);
  }

  // ---------- gifts ----------

  renderGiftPicker() {
    clear(this.extraEl);
    const p = this.game.player;
    const items = sortItems(p?.inventory?.list?.() || []).filter((it) => isGiftable(it.def || itemDef(it.id)));
    const grid = h('div', { class: 'item-grid compact' });
    if (!items.length) grid.append(h('p', { class: 'empty', text: "You don't have anything to give right now." }));
    for (const it of items) {
      const b = h('button', { type: 'button', class: 'slot', title: `${it.def?.name || it.id}: ${it.def?.desc || ''}` }, h('img', { class: 'item-img', alt: '', src: itemIconUrl(this.game, it.id) }), h('span', { class: 'slot-qty num', text: String(it.qty) }), h('span', { class: 'slot-name', text: it.def?.name || it.id }));
      b.addEventListener('click', () => this.giveGift(it.id));
      grid.append(b);
    }
    this.extraEl.append(h('div', { class: 'picker-head', text: 'Choose a gift' }), grid, button('Never mind', { cls: 'btn-ghost btn-small', onClick: () => this.choose('__back') }));
  }

  giveGift(itemId) {
    const g = this.game;
    const npc = this.npc;
    const p = g.player;
    if (!npc || !p?.inventory?.has(itemId)) return;
    p.inventory.remove(itemId, 1);
    // The UI hands the item over, so it reports the hand-over (Lyra sees kindness in it).
    g.bus.emit('item_given', { from: p, to: npc, itemId, qty: 1 });
    const r = safe(() => npc.receiveGift(itemId, p), null) || { lines: ['Thank you.'], liked: 0 };
    const liked = Number(r.liked) || 0;
    this.setExpression(liked > 0 ? 'happy' : liked < 0 ? 'sad' : 'neutral');
    g.audio?.play(liked > 0 ? 'heal' : liked < 0 ? 'error' : 'pickup', { volume: 0.7 });
    clear(this.extraEl);
    this.extraEl.append(h('div', { class: `gift-result liked-${liked}`, text: liked > 0 ? '♥ They loved it' : liked < 0 ? '✗ Not to their taste' : '· A polite thank-you' }));
    this.mode = 'talk';
    const back = safe(() => npc.chooseOption('__back', p), null);
    this.play(r.lines?.length ? r.lines : ['Thank you.'], back?.options?.length ? back.options : this.options);
  }

  // ---------- shop ----------
  // Round 14b (S-17, DESIGN §36.2): one stock that runs out and comes back in the morning,
  // prices by taste and by how they feel about you, a haggle a day, a stolen mark on what
  // the provenance ledger says was taken, an inline "are you sure" before selling gear, a
  // rare thing or your last one, and a tap on a row for what it is (no tooltips on touch).

  renderShop() {
    clear(this.extraEl);
    const g = this.game;
    const npc = this.npc;
    const p = g.player;
    const T = g.trade;
    T?.ensureDay?.();
    const shop = shopOf(g, npc);
    const st = stance(g, npc);
    const coins = h('span', { class: 'num', text: fmtInt(p?.inventory?.count('coin') || 0) });
    const buyList = h('div', { class: 'shop-list' });
    const sellList = h('div', { class: 'shop-list' });
    const badge = h('span', { class: 'shop-mood' });
    const haggleBtn = button('Haggle', { cls: 'btn-small btn-ghost shop-haggle' });
    const first = firstName(npc.name) || 'They';
    haggleBtn.addEventListener('click', () => {
      const r = T?.haggle?.(npc);
      if (!r) return;
      g.audio?.play(r.won ? 'coin' : 'error', { volume: 0.6 });
      this.play([r.line], this.options);
      this.mode = 'shop';
      redraw();
    });
    const redraw = () => {
      setText(coins, fmtInt(p.inventory.count('coin')));
      const mood = moodOf(npc);
      const won = !!T?.haggled?.(npc.id);
      const bits = [];
      if (st.markup > 1) bits.push(`blood price ×${st.markup.toFixed(2).replace(/0$/, '')}`);
      else if (mood === 'dear' || mood === 'warm') bits.push('a friend\'s price');
      else if (mood === 'low' || mood === 'cold') bits.push('a cold price');
      if (won) bits.push('haggled: a tenth off');
      if (st.fence) bits.push("he doesn't ask");
      setText(badge, bits.join(' · '));
      badge.hidden = !bits.length;
      haggleBtn.disabled = !!T?.haggles?.[npc.id] && T.haggles[npc.id].day === T.today?.();
      clear(buyList);
      clear(sellList);
      const sells = shop.sells || [];
      if (!sells.length) buyList.append(h('p', { class: 'empty', text: 'Nothing for sale today.' }));
      for (const s of sells) {
        const def = itemDef(s.id);
        const price = priceFor(g, npc, s.id, 'buy', { markup: st.markup });
        if (price == null) continue;
        const left = T ? T.stockLeft(npc, s.id) : Infinity;
        const out = left <= 0;
        let qty = 1;
        const qEl = h('span', { class: 'shop-step-n num', text: '1' });
        const minus = button('−', { cls: 'btn-small btn-ghost shop-step', title: 'One fewer' });
        const plus = button('+', { cls: 'btn-small btn-ghost shop-step', title: 'One more' });
        const b = button(out ? 'Sold out' : 'Buy', { cls: 'btn-small btn-ember', disabled: out || p.inventory.count('coin') < price });
        const setQ = (n) => {
          const max = Math.max(1, Math.min(Number.isFinite(left) ? left : 9, Math.floor(p.inventory.count('coin') / Math.max(1, price)) || 1, 9));
          qty = Math.max(1, Math.min(max, n));
          setText(qEl, String(qty));
          b.disabled = out || p.inventory.count('coin') < price * qty;
          setText(b, out ? 'Sold out' : qty > 1 ? `Buy ${qty}` : 'Buy');
        };
        minus.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setQ(qty - 1);
        });
        plus.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setQ(qty + 1);
        });
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.buyFrom(s.id, qty);
          redraw();
        });
        const note = out ? 'Sold out, back tomorrow' : Number.isFinite(left) ? `${left} left` : '';
        const row = this.shopRow(s.id, def, `${price}`, h('span', { class: 'shop-step-box' }, minus, qEl, plus, b), out, null, { note, worth: def?.value });
        buyList.append(row);
      }
      const mine = sortItems(p.inventory.list()).filter((it) => it.id !== 'coin' && priceFor(g, npc, it.id, 'sell', { markup: st.markup }) != null);
      if (!mine.length) sellList.append(h('p', { class: 'empty', text: `${first} isn't buying anything you carry.` }));
      for (const it of mine) {
        const price = priceFor(g, npc, it.id, 'sell', { markup: st.markup });
        const stolen = (g.provenance?.qtyOf?.(it.id) ?? 0) > 0 && (T?.stolenOf?.(it.id, 1)?.length ?? 0) > 0;
        const b = button('Sell 1', { cls: 'btn-small' });
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.askSell(row, it, 1, price, redraw);
        });
        const row = this.shopRow(it.id, it.def, `${price}`, b, false, it.qty, { stolen, worth: (it.def || itemDef(it.id))?.value });
        if (it.qty > 1) {
          const all = button(`All ${it.qty}`, { cls: 'btn-small btn-ghost' });
          all.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.askSell(row, it, it.qty, price, redraw);
          });
          row.querySelector('.shop-btns').append(all);
        }
        sellList.append(row);
      }
    };
    const tabs = h('div', { class: 'segmented shop-tabs' });
    const buyPane = h('div', { class: 'shop-pane' }, h('h3', { text: 'Buy' }), buyList);
    const sellPane = h('div', { class: 'shop-pane' }, h('h3', { text: 'Sell' }), sellList);
    for (const [id, label] of [
      ['buy', 'Buy'],
      ['sell', 'Sell'],
    ]) {
      const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': id === 'buy' ? 'true' : 'false', text: label });
      b.addEventListener('click', () => {
        for (const el of tabs.children) el.setAttribute('aria-checked', el === b ? 'true' : 'false');
        toggleClass(shopEl, 'show-sell', id === 'sell');
      });
      tabs.append(b);
    }
    const shopEl = h(
      'div',
      { class: 'shop' },
      h('div', { class: 'shop-head' }, tabs, h('span', { class: 'purse' }, h('img', { class: 'item-img', alt: '', src: itemIconUrl(g, 'coin') }), coins)),
      h('div', { class: 'shop-bar' }, badge, haggleBtn),
      h('div', { class: 'shop-panes' }, buyPane, sellPane),
      button('Done trading', { cls: 'btn-ghost btn-small', onClick: () => this.choose('__back') }),
    );
    this.extraEl.append(shopEl);
    redraw();
  }

  // A row: icon, name (and how many), a note (stock), the stolen mark, the price against what it
  // is worth, the buttons. A tap on the row shows what it is, inline.
  shopRow(id, def, price, btn, dim, qty, { note = '', stolen = false, worth = null } = {}) {
    const detail = h('p', { class: 'shop-detail', hidden: true, text: def?.desc || '' });
    const worthTxt = Number.isFinite(worth) && String(worth) !== String(price) ? h('span', { class: 'shop-worth', text: `worth ${worth}` }) : null;
    const row = h(
      'div',
      { class: `shop-row ${dim ? 'dim' : ''} ${stolen ? 'is-stolen' : ''}`.trim() },
      h('img', { class: 'item-img', alt: '', src: itemIconUrl(this.game, id) }),
      h(
        'span',
        { class: 'shop-name' },
        h('span', { text: def?.name || id }),
        qty ? h('span', { class: 'shop-qty num', text: `×${qty}` }) : null,
        note ? h('span', { class: `shop-stock ${dim ? 'is-out' : ''}`.trim(), text: note }) : null,
        stolen ? h('span', { class: 'shop-stolen', text: 'stolen' }) : null,
      ),
      h('span', { class: 'price num' }, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(this.game, 'coin') }), price, worthTxt),
      h('span', { class: 'shop-btns' }, btn),
      detail,
    );
    row.addEventListener('click', () => {
      detail.hidden = !detail.hidden || !detail.textContent;
    });
    return row;
  }

  // Selling gear, a rare thing or your last one asks first, inline (never a browser confirm).
  askSell(row, it, qty, price, redraw) {
    const def = it.def || itemDef(it.id);
    const rare = ['rare', 'epic', 'legendary'].includes(def?.rarity) || def?.type === 'gear' || def?.type === 'weapon';
    const last = qty >= (it.qty || 1);
    if (!rare && !(last && (def?.value || 0) >= 10)) {
      this.sellTo(it.id, qty);
      redraw();
      return;
    }
    const box = row.querySelector('.shop-btns');
    clear(box);
    const yes = button(`Sell for ${price * qty}`, { cls: 'btn-small btn-ember' });
    const no = button('Keep it', { cls: 'btn-small btn-ghost' });
    yes.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.sellTo(it.id, qty);
      redraw();
    });
    no.addEventListener('click', (ev) => {
      ev.stopPropagation();
      redraw();
    });
    box.append(h('span', { class: 'shop-ask', text: last ? 'Your last one. Sure?' : 'Sure?' }), yes, no);
  }

  buyFrom(itemId, qty = 1) {
    const g = this.game;
    const r = g.trade?.buy?.(this.npc, itemId, qty) || { ok: false };
    if (!r.ok) {
      g.audio?.play('error');
      if (r.line) this.play([r.line], this.options);
      this.mode = 'shop';
      return r;
    }
    g.audio?.play('coin');
    this.ui.toast(`Bought ${itemName(itemId, r.qty)} for ${r.total} coins.`, 'item', { iconUrl: itemIconUrl(g, itemId) });
    return r;
  }

  sellTo(itemId, qty = 1) {
    const g = this.game;
    const r = g.trade?.sell?.(this.npc, itemId, qty) || { ok: false };
    if (!r.ok) {
      g.audio?.play('error');
      if (r.line) {
        this.setExpression(r.reason === 'stolen' ? 'angry' : 'neutral');
        this.play([r.line], this.options);
        this.mode = 'shop';
      }
      return r;
    }
    g.audio?.play('coin');
    if (r.line) this.play([r.line], this.options);
    this.mode = 'shop';
    this.ui.toast(`Sold ${itemName(itemId, r.qty)} for ${r.total} coins.`, 'item', { iconUrl: itemIconUrl(g, 'coin') });
    return r;
  }

  // (Kept for callers of the old shop: one item at a price, through the day's trade.)
  trade(itemId, price, buying, qty = 1) {
    return buying ? this.buyFrom(itemId, qty) : this.sellTo(itemId, qty);
  }

  // Typewriter, with a soft voice blip every few letters.
  update(dt) {
    if (!this.isOpen() || !this.typing) return;
    const line = this.lines[this.lineIdx] || '';
    const speed = CHARS_PER_SECOND * Math.max(0.25, Number(this.game.settings?.textSpeed) || 1);
    const before = Math.floor(this.shown);
    this.shown = Math.min(line.length, this.shown + speed * dt);
    const now = Math.floor(this.shown);
    if (now !== before) {
      setText(this.textEl, line.slice(0, now));
      this.blipAcc += now - before;
      if (this.blipAcc >= 3) {
        this.blipAcc = 0;
        const ch = line[now - 1];
        if (ch && /[a-z0-9]/i.test(ch)) this.game.audio?.play('talk_blip', { pitch: voicePitch(this.npc?.id || 'npc'), volume: 0.8 });
      }
    }
    if (this.shown >= line.length) this.finishLine();
  }
}
