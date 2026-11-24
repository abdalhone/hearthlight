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
    this.moreEl = h('span', { class: 'dlg-more', text: '▼', hidden: true });
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
    this.talk.send(text).then((reply) => {
      if (!this.isOpen() || this.npc !== npc) return;
      this.setWaiting(false);
      if (reply) this.showReply(reply);
    });
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
    const first = this.optionsEl.querySelector('button');
    if (first && !this.ui.isTouch) first.focus({ preventScroll: true });
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

  renderShop() {
    clear(this.extraEl);
    const g = this.game;
    const npc = this.npc;
    const p = g.player;
    const shop = npc?.profile?.shop || npc?.shop || { sells: [], buys: {} };
    const coins = h('span', { class: 'num', text: fmtInt(p?.inventory?.count('coin') || 0) });
    const buyList = h('div', { class: 'shop-list' });
    const sellList = h('div', { class: 'shop-list' });
    const redraw = () => {
      setText(coins, fmtInt(p.inventory.count('coin')));
      clear(buyList);
      clear(sellList);
      const sells = Array.isArray(shop.sells) ? shop.sells : [];
      if (!sells.length) buyList.append(h('p', { class: 'empty', text: 'Nothing for sale today.' }));
      for (const s of sells) {
        const def = itemDef(s.id);
        const price = Math.max(0, Math.round(Number(s.price) || def?.value || 1));
        const afford = p.inventory.count('coin') >= price;
        const b = button('Buy', { cls: 'btn-small btn-ember', disabled: !afford });
        b.addEventListener('click', () => {
          this.trade(s.id, price, true);
          redraw();
        });
        buyList.append(this.shopRow(s.id, def, `${price}`, b, !afford));
      }
      const buys = shop.buys && typeof shop.buys === 'object' ? shop.buys : {};
      const mine = sortItems(p.inventory.list()).filter((it) => it.id !== 'coin' && buys[it.id] != null);
      if (!mine.length) sellList.append(h('p', { class: 'empty', text: `${npc.name?.split(' ')[0] || 'They'} isn't buying anything you carry.` }));
      for (const it of mine) {
        const price = Math.max(0, Math.round(Number(buys[it.id]) || 0));
        const b = button('Sell', { cls: 'btn-small' });
        b.addEventListener('click', () => {
          this.trade(it.id, price, false);
          redraw();
        });
        const row = this.shopRow(it.id, it.def, `${price}`, b, false, it.qty);
        if (it.qty > 1) {
          const all = button(`All ${it.qty}`, { cls: 'btn-small btn-ghost' });
          all.addEventListener('click', () => {
            this.trade(it.id, price, false, it.qty);
            redraw();
          });
          row.lastChild.append(all);
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
    const shopEl = h('div', { class: 'shop' }, h('div', { class: 'shop-head' }, tabs, h('span', { class: 'purse' }, h('img', { class: 'item-img', alt: '', src: itemIconUrl(g, 'coin') }), coins)), h('div', { class: 'shop-panes' }, buyPane, sellPane), button('Done trading', { cls: 'btn-ghost btn-small', onClick: () => this.choose('__back') }));
    this.extraEl.append(shopEl);
    redraw();
  }

  shopRow(id, def, price, btn, dim, qty) {
    return h(
      'div',
      { class: `shop-row ${dim ? 'dim' : ''}`.trim(), title: def?.desc || '' },
      h('img', { class: 'item-img', alt: '', src: itemIconUrl(this.game, id) }),
      h('span', { class: 'shop-name' }, h('span', { text: def?.name || id }), qty ? h('span', { class: 'shop-qty num', text: `×${qty}` }) : null),
      h('span', { class: 'price num' }, h('img', { class: 'item-img tiny', alt: '', src: itemIconUrl(this.game, 'coin') }), price),
      h('span', { class: 'shop-btns' }, btn),
    );
  }

  trade(itemId, price, buying, qty = 1) {
    const g = this.game;
    const p = g.player;
    const npc = this.npc;
    if (!p || !npc) return;
    if (buying) {
      if (p.inventory.count('coin') < price) {
        g.audio?.play('error');
        return;
      }
      p.inventory.remove('coin', price);
      p.inventory.add(itemId, 1);
      g.bus.emit('item_gained', { actor: p, itemId, qty: 1, from: 'trade' });
      g.bus.emit('trade', { npc, itemId, qty: 1, price, bought: true });
      g.audio?.play('coin');
      this.ui.toast(`Bought ${itemName(itemId)} for ${price} coins.`, 'item', { iconUrl: itemIconUrl(g, itemId) });
    } else {
      const n = p.inventory.remove(itemId, qty);
      if (!n) return;
      const total = price * n;
      if (total > 0) {
        p.inventory.add('coin', total);
        g.bus.emit('item_gained', { actor: p, itemId: 'coin', qty: total, from: 'trade' });
      }
      g.bus.emit('trade', { npc, itemId, qty: n, price: total, bought: false });
      g.audio?.play('coin');
      this.ui.toast(`Sold ${itemName(itemId, n)} for ${total} coins.`, 'item', { iconUrl: itemIconUrl(g, 'coin') });
    }
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
