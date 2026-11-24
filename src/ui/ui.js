// The DOM user interface (DESIGN.md §14). This facade owns the layers, the stack of
// open panels, hotkeys and the event listeners that turn game events into HUD
// updates, toasts and popups. Each screen lives in its own module.

import { h, isTouchDevice, prefersReducedMotion } from './dom.js';
import { isTextTarget } from '../core/input.js';
import { Hud } from './hud.js';
import { Chat } from './chat.js';
import { Toasts } from './toast.js';
import { MindPanel } from './mind_panel.js';
import { DialogPanel } from './dialog.js';
import { InventoryPanel, ChestPanel } from './inventory.js';
import { SettingsPanel } from './settings_panel.js';
import { TitleScreen } from './title.js';
import { TouchControls } from './touch.js';
import { VillageUI } from './village_ui.js';
import { buildPause, buildSign, buildDiary, Fader, Vignette } from './overlays.js';
import { makeConfirm } from './modal.js';
import { COMMANDS, JOBS, REJOIN, pickAck } from './content.js';
import { itemIconUrl } from './art.js';
import { itemName } from '../entities/items.js';
import { normalizeArgs } from '../ai/brain/actions.js';
import { gainText, frac, truncate } from './format.js';
import { companionshipOf, companionshipLabel, companionshipReason, deedLabel, requestAnswer } from './lyra_view.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[ui]', err);
    return fallback;
  }
}

function clone(o) {
  try {
    return o == null ? null : JSON.parse(JSON.stringify(o));
  } catch {
    return null;
  }
}

const ACCEPTED = new Set(['accept', 'accept_conditional']);

// How the chat marks a change in where she stands with the player.
const STATE_LINES = {
  together: (n) => `${n} travels with you again.`,
  wary: (n) => `${n} is wary of you now.`,
  apart: (n) => `${n} is going her own way for now.`,
  left: (n) => `${n} has left you.`,
  gone: (n) => `${n} has cut you out of her life. She is home with her own people now.`,
};

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.stack = []; // open panels, top last
    this.chat = new Chat(this);
    this.toasts = null;
    this.hud = null;
    this.inited = false;
    this.isTouch = false;
    this.reduceMotion = false;
    this.promptTimer = 0;
    this.lastPrompt = null;
    this.hotkeyGrace = 0;
    this.soulSnapshot = null;
    this.mindSnapshot = null;
    this.gains = new Map(); // itemId -> { qty, at } for merged pickup toasts
    this.invDirty = false;
    this.thinkPoll = 0;
    this.explicitThinking = false;
    this.lastCs = 'together';
    this.lastCompanionReason = '';
    this.pendingSpeech = []; // her unprompted lines, waiting to join the chat
    this.heard = null; // her words while a request runs (see ask)
    this.heardNow = [];
  }

  // ---------- setup ----------

  init() {
    if (this.inited) return;
    this.inited = true;
    const g = this.game;
    const root = this.root;
    root.classList.add('ui');

    this.hud = new Hud(this);
    this.toasts = new Toasts(this);
    this.mind = new MindPanel(this);
    this.dialog = new DialogPanel(this);
    this.inventory = new InventoryPanel(this);
    this.chest = new ChestPanel(this);
    this.settings = new SettingsPanel(this);
    this.title = new TitleScreen(this);
    this.touch = new TouchControls(this);
    this.village = new VillageUI(this);
    this.fader = new Fader();
    this.vignette = new Vignette();
    this.modalLayer = h('div', { class: 'modal-layer', hidden: true });
    this.backdrop = h('div', { class: 'modal-backdrop' });
    this.backdrop.addEventListener('click', () => {
      const top = this.top();
      if (top && top.id !== 'confirm' && top.id !== 'diary') this.closeModal(top);
    });
    this.modalLayer.append(this.backdrop);

    // Keep the chat's thinking indicator honest even if only the brain's busy flag says so.
    const chat = this.chat;
    const rawSetThinking = chat.setThinking.bind(chat);
    chat.setThinking = (on) => {
      this.explicitThinking = !!on;
      rawSetThinking(on);
    };

    root.append(
      h('div', { class: 'layer layer-fx' }, this.vignette.lowEl, this.vignette.flashEl),
      h('div', { class: 'layer layer-touch' }, this.touch.build()),
      h('div', { class: 'layer layer-hud' }, this.hud.el),
      h('div', { class: 'layer layer-chat' }, this.chat.mount()),
      h('div', { class: 'layer layer-toasts' }, this.toasts.el),
      h('div', { class: 'layer layer-title' }, this.title.build()),
      h('div', { class: 'layer layer-modal' }, this.modalLayer),
      h('div', { class: 'layer layer-fade' }, this.fader.el),
    );

    this.applyMotion();
    this.setTouch(isTouchDevice());
    this.bindDom();
    this.bindBus();
    this.village.bind();
    this.watchKeyboard();

    const rt = g.runtime;
    const onCaps = () => {
      this.chat.attachDictation(rt?.dictation || null);
      if (this.dialog.isOpen()) this.dialog.attachDictation(rt?.dictation || null);
      if (this.settings.isOpen()) this.settings.render();
      this.chat.refreshHeader();
    };
    rt?.onChange?.(onCaps);
    onCaps();
  }

  bindDom() {
    const root = this.root;
    // Keyboard handling that must run before the game's input (capture phase).
    window.addEventListener(
      'keydown',
      (e) => {
        const t = e.target;
        if (e.key === 'Escape' && isTextTarget(t) && t !== this.chat.field) {
          t.blur();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Tab toggles Lyra's mind in play; inside other panels it moves focus as usual.
        if (e.code === 'Tab' && this.game.state === 'playing' && !isTextTarget(t)) {
          const top = this.top();
          if (!top || top === this.mind.panel) e.preventDefault();
          else {
            e.stopPropagation();
            return;
          }
        }
        if (this.dialog.isOpen() && this.top() === this.dialog.panel && !isTextTarget(t) && this.dialog.handleKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // L listens in on a conversation nearby (§19.3).
        if (e.code === 'KeyL' && !isTextTarget(t) && this.village.handleKey(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    // HUD and touch buttons should never keep keyboard focus (Space would re-press them).
    for (const el of [this.hud.el, this.touch.el]) el.addEventListener('mousedown', (e) => e.target.closest?.('button') && e.preventDefault());
    // On window, not the UI root: taps on the game canvas must close popovers too.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' && !this.isTouch) this.setTouch(true);
        this.hud.outsidePointer(e.target);
      },
      true,
    );
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('button');
      if (b && !b.disabled && !b.classList.contains('tbtn')) this.game.audio?.play('ui_click', { volume: 0.8 });
    });
    root.addEventListener('contextmenu', (e) => {
      if (!isTextTarget(e.target)) e.preventDefault();
    });
    // No pinch zoom on the game surface (iOS gestures and multi-finger moves).
    root.addEventListener('gesturestart', (e) => e.preventDefault());
    root.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false },
    );
    window.addEventListener('touchstart', () => this.setTouch(true), { once: true, passive: true });
    // Sound may only start inside a user gesture: unlock on the first one of any kind.
    const unlock = () => {
      this.game.audio?.unlock?.();
      if (this.game.audio?.unlocked || !this.game.audio) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    try {
      window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => this.applyMotion());
    } catch {
      /* older browsers */
    }
  }

  // A phone's on-screen keyboard covers the bottom of the page without resizing it.
  // --kb (on the UI root) says how much it covers, so panels and the chat can rise
  // above it while a text field has focus.
  watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = this.root;
    let last = -1;
    const apply = () => {
      const typing = isTextTarget(document.activeElement);
      const kb = typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      const open = kb > 80;
      const v = open ? kb : 0;
      if (v === last) return;
      last = v;
      root.style.setProperty('--kb', `${v}px`);
      root.classList.toggle('kb-open', open);
    };
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('focusin', () => requestAnimationFrame(apply));
    window.addEventListener('focusout', () => setTimeout(apply, 60));
    apply();
  }

  bindBus() {
    const g = this.game;
    const bus = g.bus;
    const isPlayer = (e) => e && (e === g.player || e.id === 'player');
    const isLyra = (e) => e && (e === g.companion || e.id === 'lyra');
    const lyraName = () => g.settings?.companionName || g.companion?.name || 'Lyra';

    bus.on('entity_added', ({ entity }) => {
      // A fresh companion carries her default soul: remember it for "restore default".
      if (entity?.id === 'lyra' && entity.mind && !this.soulSnapshot) {
        this.soulSnapshot = clone(entity.mind.soul);
        this.mindSnapshot = safe(() => JSON.stringify(entity.mind.serialize()));
      }
    });

    bus.on('game_start', ({ loaded }) => this.onGameStart(!!loaded));

    bus.on('quest', (q) => {
      const text = q?.text || '';
      this.hud?.setQuest(text);
      const done = q?.stage === 'waygate' || q?.stage === 6;
      this.toast(text, 'quest', { title: done ? 'Quest complete' : q?.title || 'New objective' });
      g.audio?.play('quest');
    });

    bus.on('damage', (d) => {
      if (isPlayer(d?.target)) {
        const max = d.target.maxHp || 60;
        this.vignette.hit(Math.min(0.65, ((Number(d.amount) || 1) / max) * 4));
      }
    });

    bus.on('level_up', ({ entity, level }) => {
      if (isPlayer(entity)) this.toast(`Level ${level}! You feel stronger and steadier.`, 'good', { title: 'Level up' });
      else if (isLyra(entity)) this.toast(`${lyraName()} reached level ${level}. Her bolts burn brighter.`, 'lyra');
    });

    bus.on('item_gained', (p) => {
      if (!isPlayer(p?.actor) || !p.itemId) return;
      this.invDirty = true;
      if (p.from === 'trade' || p.from === 'chest') return;
      const now = g.time || 0;
      const acc = this.gains.get(p.itemId);
      const qty = (acc && now - acc.at < 3 ? acc.qty : 0) + (Number(p.qty) || 1);
      this.gains.set(p.itemId, { qty, at: now });
      const def = safe(() => itemName(p.itemId)) || p.itemId;
      this.toast(gainText(qty, def), 'item', { key: `gain:${p.itemId}`, iconUrl: itemIconUrl(g, p.itemId) });
    });

    bus.on('item_given', (p) => {
      this.invDirty = true;
      // Same key as pickups: a delivery that also raises item_gained shows one toast, not two.
      if (isLyra(p?.from) && isPlayer(p?.to) && p.itemId) this.toast(`${lyraName()} handed you ${itemName(p.itemId, p.qty || 1)}.`, 'item', { key: `gain:${p.itemId}`, iconUrl: itemIconUrl(g, p.itemId) });
    });
    bus.on('item_used', () => (this.invDirty = true));

    bus.on('downed', ({ entity }) => {
      if (isLyra(entity)) this.toast(`${lyraName()} is down! Reach her and press ${this.isTouch ? 'the hand button' : 'E'} to help her up.`, 'warn');
    });
    // Her village protects her (§19.7): a cry for help is news the player should see,
    // once per person while it lasts.
    const helpAt = new Map();
    bus.on('call_for_help', (p) => {
      const v = p?.victim;
      const ent = v && typeof v === 'object' ? v : safe(() => g.entities?.get?.(v));
      const id = ent?.id || (typeof v === 'string' ? v : '');
      if (!id || isPlayer(ent)) return;
      const now = g.time || 0;
      if (now - (helpAt.get(id) ?? -99) < 15) return;
      helpAt.set(id, now);
      const name = isLyra(ent) || id === 'lyra' ? lyraName() : String(ent?.name || id).split(' ')[0];
      const byYou = isPlayer(p?.attacker) || p?.attacker === 'player';
      this.toast(byYou ? `${name} is shouting for help, and the village is coming.` : `${name} is shouting for help!`, 'warn', { key: `help:${id}` });
    });
    bus.on('revived', ({ entity, by }) => {
      if (isLyra(entity)) this.toast(isPlayer(by) ? `You helped ${lyraName()} back to her feet.` : `${lyraName()} is back on her feet.`, 'good');
    });

    // Work she took on for you is news; her own work, on her own day, is her business.
    bus.on('job_done', (p) => {
      if (!isLyra(p?.actor) || p.own) return;
      const name = this.jobLabel(p.job);
      this.toast(`${lyraName()} finished: ${name.toLowerCase()}.`, 'lyra');
    });
    bus.on('job_failed', (p) => {
      // A job stopped on purpose (asked, or for something else) needs no notice.
      if (!isLyra(p?.actor) || p.own || p.stopped) return;
      if (p.reason) this.toast(String(p.reason), 'lyra', { title: `${lyraName()} gave up on ${this.jobLabel(p.job).toLowerCase()}` });
    });

    bus.on('player_wake', (p) => {
      const r = p?.reflection;
      const diary = r?.diary;
      const text = typeof diary === 'string' ? diary : diary?.text;
      if (text) setTimeout(() => this.showDiary({ day: diary?.day ?? Math.max(1, (p.day || 2) - 1), text }), 900);
    });

    bus.on('conversation', (c) => {
      const lines = Array.isArray(c?.lines) ? c.lines : [];
      if (!lines.length) return;
      const other = isLyra(c.a) ? c.b : c.a;
      const nameOf = (sp) => {
        if (sp && typeof sp === 'object') return sp.name || '…';
        if (sp === 'lyra') return lyraName();
        if (sp === 'npc') return other?.name?.split(' ')[0] || 'Them';
        return safe(() => g.entities.get(sp)?.name?.split(' ')[0]) || String(sp || '…');
      };
      this.chat.addOverheard(`${lyraName()} talked with ${other?.name || 'someone'}`, lines.map((l) => ({ name: nameOf(l.speaker), text: l.text || '' })));
    });

    // ----- Lyra's own will (§16) -----
    bus.on('companionship_changed', (p) => this.onCompanionship(p || {}));
    bus.on('request_evaluated', (p) => {
      const v = p?.verdict;
      if (v && v.decision && !ACCEPTED.has(v.decision)) this.hud?.flashRefusal();
      this.hud?.refreshCompanion(true);
      this.mind?.markDirty('you');
    });
    bus.on('deed', (p) => {
      this.hud?.refreshCompanion(true);
      this.mind?.markDirty('you');
      const sev = Number(p?.severity) || 0;
      if (Math.abs(sev) < 2) return;
      const label = deedLabel(p?.deed);
      // Deed texts are her own words about you.
      const text = String(p?.text || '').trim();
      const body = text ? `${label}: “${text}”` : `${label}.`;
      if (sev > 0) this.toast(body, 'lyra', { title: `${lyraName()} noticed`, key: `deed:${p?.deed}` });
      else this.toast(body, 'warn', { title: sev <= -5 ? `${lyraName()} will not forget this` : `${lyraName()} saw that`, key: `deed:${p?.deed}` });
    });
    bus.on('promise', (p) => {
      this.mind?.markDirty('you');
      const text = truncate(String(p?.text || '').trim(), 120);
      if (!text) return;
      if (p.state === 'kept') this.toast(text, 'good', { title: p.by === 'player' ? 'You kept your word' : `${lyraName()} kept her word` });
      else if (p.state === 'broken') this.toast(text, 'warn', { title: p.by === 'player' ? 'You broke your word' : `${lyraName()} broke her word` });
      else this.toast(text, 'lyra', { title: p.by === 'player' ? 'You promised' : `${lyraName()} promised` });
    });
    bus.on('plan_changed', () => this.mind?.markDirty('now'));
    // What she says aloud to you on her own (announcements, requests, warnings) also
    // lands in the chat. Replies reach the chat through the brain; waiting a moment
    // lets those arrive first, so the same line is never shown twice.
    bus.on('speech', (p) => {
      if (!isLyra(p?.speaker) || !p.text) return;
      if (this.heard) {
        this.heard.push(String(p.text));
        return;
      }
      if (g.state !== 'playing') return;
      const kind = p.kind || 'say';
      if (kind === 'bark' || kind === 'whisper') return;
      if (p.target && !isPlayer(p.target)) return;
      if (this.pendingSpeech.length >= 6) this.pendingSpeech.shift();
      this.pendingSpeech.push({ text: String(p.text), at: g.time || 0 });
    });

    bus.on('relationship_changed', (p) => {
      this.mind?.markDirty('people');
      if (p?.personId === 'player') {
        this.mind?.markDirty('you');
        this.hud?.refreshCompanion(true);
      }
    });
    bus.on('memory_added', () => this.mind?.markDirty('memories'));
    // The village's social life changes what the People tab shows (§19.3).
    for (const ev of ['village_talk', 'rumor', 'bond_changed']) bus.on(ev, () => this.mind?.markDirty('people'));
    bus.on('settings_changed', ({ key }) => {
      if (key === 'reduceMotion') this.applyMotion();
      if (key === 'companionName' || key === 'brain') {
        this.chat.refreshHeader();
        this.title?.refreshMindLine();
      }
    });
  }

  onGameStart(loaded) {
    const g = this.game;
    this.title?.hide();
    this.hud?.show(true);
    this.root.classList.add('in-game');
    this.hotkeyGrace = 0.3;
    // A loaded save may have replaced the soul; the fresh one was captured at entity_added.
    const qp = safe(() => g.plugins?.get?.('quest'));
    const objective = safe(() => qp?.objective?.(g.plugins.ctx)) || '';
    this.hud?.setQuest(objective);
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    const state = companionshipOf(g);
    this.lastCs = state;
    if (loaded) this.toast(`Welcome back. ${g.clock?.fullString?.() || ''}`.trim(), 'info');
    else this.toast(`Welcome to Hearthvale. ${name} walks with you, for her own reasons.`, 'info');
    if (!this.chat.messages.length) {
      const intro =
        state === 'gone'
          ? `${name} has cut you out of her life. She is still in Hearthvale, with her own people, but she won't talk to you beyond a word.`
          : `${name} travels with you because she chooses to. Talk to her about anything, or ask her for help in plain words; she decides what she does.`;
      this.chat.addMessage({ from: 'system', text: intro });
    }
    this.hud?.refreshCompanion(true);
    this.chat.setGone(state === 'gone');
    this.syncInputEnabled();
  }

  setTouch(on) {
    if (this.isTouch === !!on) return;
    this.isTouch = !!on;
    this.root.classList.toggle('is-touch', this.isTouch);
  }

  applyMotion() {
    this.reduceMotion = !!this.game.settings?.reduceMotion || prefersReducedMotion();
    this.root.classList.toggle('reduce-motion', this.reduceMotion);
  }

  // ---------- panels ----------

  top() {
    return this.stack[this.stack.length - 1] || null;
  }

  openModal(panel) {
    if (!panel || this.stack.includes(panel)) return;
    const g = this.game;
    this.hud?.closeJobs();
    this.hud?.closeRadial();
    this.touch?.reset();
    this.stack.push(panel);
    this.modalLayer.append(panel.el);
    this.modalLayer.hidden = false;
    this.root.classList.add('modal-open');
    panel.closeBtn?.addEventListener('click', () => this.closeModal(panel));
    this.syncPause();
    this.syncInputEnabled();
    g.audio?.play('ui_open');
    g.bus?.emit('ui_open', { panel: panel.id });
    requestAnimationFrame(() => {
      if (!this.stack.includes(panel) || this.isTouch) return;
      const focusable = panel.el.querySelector('.panel-body button, .panel-body input, .panel-foot button');
      (focusable || panel.closeBtn)?.focus?.({ preventScroll: true });
    });
  }

  closeModal(panel, silent = false) {
    const i = this.stack.indexOf(panel);
    if (i < 0) return;
    this.stack.splice(i, 1);
    panel.el.remove();
    try {
      panel.onClose?.();
    } catch (err) {
      console.warn('[ui] panel close failed', err);
    }
    if (!this.stack.length) {
      this.modalLayer.hidden = true;
      this.root.classList.remove('modal-open');
    }
    this.syncPause();
    this.syncInputEnabled();
    if (!silent) this.game.audio?.play('ui_close');
    this.game.bus?.emit('ui_close', { panel: panel.id });
  }

  closeTop() {
    const top = this.top();
    if (!top) return false;
    if (top.id === 'confirm') top.noBtn?.click();
    else this.closeModal(top);
    return true;
  }

  closeAll() {
    while (this.stack.length) this.closeModal(this.top(), true);
  }

  syncPause() {
    this.game.paused = this.stack.some((p) => p.pauses);
  }

  syncInputEnabled() {
    const inp = this.game.input;
    if (!inp) return;
    const on = !this.chat.typing && this.stack.length === 0;
    if (inp.enabled !== on) {
      inp.enabled = on;
      if (!on) this.touch?.reset();
    }
  }

  isModalOpen() {
    return this.stack.length > 0;
  }

  confirm({ title, text, yes = 'Yes', no = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const panel = makeConfirm({ title, text, yes, no, danger });
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        this.closeModal(panel, true);
        resolve(v);
      };
      panel.yesBtn.addEventListener('click', () => finish(true));
      panel.noBtn.addEventListener('click', () => finish(false));
      panel.onClose = () => {
        if (!done) {
          done = true;
          resolve(false);
        }
      };
      this.openModal(panel);
      requestAnimationFrame(() => (danger ? panel.noBtn : panel.yesBtn).focus({ preventScroll: true }));
    });
  }

  openDialog(npc) {
    if (!this.inited || !npc) return;
    this.chat.close();
    this.dialog.open(npc);
  }

  closeDialog() {
    this.dialog?.close();
  }

  openMind(tab = 'now') {
    if (!this.inited) return;
    const top = this.top();
    if (top && top !== this.mind.panel && top.id !== 'pause') this.closeModal(top, true);
    this.mind.open(tab);
  }

  toggleMind() {
    if (this.mind.isOpen()) this.mind.close();
    else this.openMind(this.mind.tab || 'now');
  }

  openInventory() {
    if (!this.inited || !this.game.player) return;
    const top = this.top();
    if (top && top !== this.inventory.panel && top.id !== 'pause') this.closeModal(top, true);
    this.inventory.open();
  }

  toggleInventory() {
    if (this.inventory.isOpen()) this.inventory.close();
    else this.openInventory();
  }

  openChest(chest) {
    if (!this.inited) return;
    this.chest.open(chest);
  }

  openSettings() {
    if (!this.inited) return;
    this.settings.open();
  }

  openPause() {
    if (!this.inited || this.game.state !== 'playing') return;
    if (this.stack.some((p) => p.id === 'pause')) return;
    this.chat.close();
    this.openModal(buildPause(this));
  }

  showSign(title, text) {
    if (!this.inited) return;
    const prev = this.stack.find((p) => p.id === 'sign');
    if (prev) this.closeModal(prev, true);
    const panel = buildSign(title, text);
    panel.foot.append(h('button', { type: 'button', class: 'btn btn-ember', text: 'Close', onclick: () => this.closeModal(panel) }));
    this.openModal(panel);
  }

  // The brain may show the page itself while she reflects; the wake event offers it
  // again. One page opens once.
  showDiary(entry) {
    if (!this.inited || !entry?.text) return;
    const text = String(entry.text);
    const now = Date.now();
    if (this.stack.some((p) => p.id === 'diary') || (this.lastDiary && this.lastDiary.text === text && now - this.lastDiary.at < 120000)) return;
    this.lastDiary = { text, at: now };
    const panel = buildDiary(this, entry, this.village?.section());
    panel.onClose = () => this.village?.diaryClosed();
    this.openModal(panel);
    this.game.audio?.play('sleep', { volume: 0.5 });
  }

  quitToTitle() {
    this.confirm({ title: 'Quit to the title screen?', text: 'Your journey is saved first, so you can continue it later.', yes: 'Save and quit', danger: false }).then(async (yes) => {
      if (!yes) return;
      try {
        await this.game.save?.save?.('quit');
      } catch {
        /* quitting anyway */
      }
      await this.fadeOut(0.4);
      location.reload();
    });
  }

  resetMind() {
    const g = this.game;
    const mind = g.companion?.mind;
    if (!mind) return false;
    try {
      if (typeof mind.reset === 'function') mind.reset();
      else if (this.mindSnapshot) {
        mind.deserialize(JSON.parse(this.mindSnapshot));
        // A fresh mind saves no soul (it is the default one): restore that too.
        if (typeof mind.resetSoul === 'function') mind.resetSoul();
        else if (this.soulSnapshot) mind.soul = clone(this.soulSnapshot);
      } else return false;
    } catch (err) {
      console.warn('[ui] mind reset failed', err);
      return false;
    }
    g.bus.emit('soul_changed', { owner: g.companion });
    if (g.save) g.save.pending = 'auto';
    return true;
  }

  // ---------- small contract pieces ----------

  showTitle() {
    if (!this.inited) return;
    this.hud?.show(false);
    this.root.classList.remove('in-game');
    this.title.show();
  }

  toast(text, kind = 'info', opts) {
    if (!this.toasts) return null;
    return this.toasts.show(text, kind, opts);
  }

  setInteractPrompt(label) {
    this.lastPrompt = label || '';
    this.hud?.setPrompt(this.lastPrompt, this.isTouch);
    this.touch?.setInteractLabel(this.lastPrompt);
  }

  fadeOut(seconds = 1) {
    if (!this.fader) return Promise.resolve();
    return this.fader.to(1, seconds, this.reduceMotion);
  }

  fadeIn(seconds = 1) {
    if (!this.fader) return Promise.resolve();
    return this.fader.to(0, seconds, this.reduceMotion);
  }

  // ---------- asking Lyra (§16.4) ----------

  // Every button on the bar is a request: it passes her consent gate and she answers.
  runCommand(id) {
    if (id === 'talk') {
      this.chat.open(true);
      return;
    }
    if (id === 'jobs') {
      this.hud.openJobs(this.isTouch);
      return;
    }
    const cmd = COMMANDS.find((c) => c.id === id);
    if (cmd) this.ask(cmd.action, cmd.args, id);
  }

  runJob(job, deliverTo = 'player') {
    this.ask('start_job', { target: deliverTo, value: job.id, amount: job.amount }, 'job');
  }

  runStopJob() {
    this.ask('stop_job', {}, 'stop_job');
  }

  // "Ask her back" while she is apart or has left. If no plugin offers 'rejoin', the
  // question goes to her in words instead.
  askBack() {
    const g = this.game;
    if (!g.companion || companionshipOf(g) === 'gone') return;
    if (safe(() => g.actions?.has?.(REJOIN.action), false)) {
      this.ask(REJOIN.action, {}, 'rejoin');
      return;
    }
    // Without the action, her own will still answers: she weighs it, then decides.
    const will = g.companion.mind?.autonomy;
    if (typeof will?.rejoin === 'function') {
      this.heard = [];
      let r;
      try {
        const verdict = safe(() => g.companion.mind.evaluateRequest?.({ action: REJOIN.action, args: normalizeArgs({}), source: 'player' }), null);
        if (verdict?.decision && !ACCEPTED.has(verdict.decision)) r = { ok: false, refused: true, verdict, message: verdict.message || '' };
        else r = safe(() => will.rejoin({ asked: true }), null) || { ok: false, message: '' };
      } finally {
        this.heardNow = this.heard;
        this.heard = null;
      }
      this.showAnswer(r, 'rejoin', '', this.heardNow);
      return;
    }
    this.chat.open(false);
    this.chat.send(REJOIN.fallbackMessage);
  }

  // Run one request as the player and show her answer. Returns the action result.
  // `fallback` is her line when she agrees and the action gave no words of its own.
  ask(action, args = {}, kind = action, fallback = '') {
    const g = this.game;
    if (!g.companion || companionshipOf(g) === 'gone') return null;
    // Whatever she says aloud while the request runs (the brain barks an answer to HUD
    // requests) is her answer: listen, so the chat shows the same words, once.
    this.heard = [];
    let r;
    try {
      const weighed = this.weighWithoutGate(action, args);
      if (weighed?.refused) r = weighed.result;
      else {
        r = safe(() => g.actions.run(action, args, 'player'), null) || { ok: false, message: '' };
        // Her conditions ("half the wood is mine") belong with the answer.
        if (weighed?.verdict && r.verdict === undefined) r.verdict = weighed.verdict;
      }
    } finally {
      this.heardNow = this.heard;
      this.heard = null;
    }
    this.showAnswer(r, kind, fallback, this.heardNow);
    return r;
  }

  // Every order is a request (§16.4). When no consent gate is installed on the action
  // registry, the UI puts the request to her mind itself, so a "no" still means no.
  weighWithoutGate(action, args) {
    const g = this.game;
    const acts = g.actions;
    if (!acts || acts.consentGate || !safe(() => acts.has(action), false) || safe(() => acts.get?.(action)?.ungated, false)) return null;
    const mind = g.companion?.mind;
    if (typeof mind?.evaluateRequest !== 'function') return null;
    const norm = normalizeArgs(args);
    const verdict = safe(() => mind.evaluateRequest({ action, args: norm, source: 'player' }), null);
    if (!verdict || typeof verdict !== 'object' || !verdict.decision) return null;
    if (ACCEPTED.has(verdict.decision)) return { refused: false, verdict };
    const result = { ok: false, refused: true, verdict, message: verdict.message || '' };
    // "Why not?" and a coin offer in the chat refer back to this.
    safe(() => g.brain?.noteRefusal?.(action, norm, result));
    return { refused: true, verdict, result };
  }

  // Her answer to a request, in her own voice: the gate's or the action's words, or a
  // fitting line of her own. A counter-offer becomes a button under her reply.
  showAnswer(r, kind, fallback = '', heard = []) {
    const g = this.game;
    const a = requestAnswer(r, { kind, fallback, pick: pickAck, heard });
    this.lyraSays(a.line, { kind: a.kind, offer: a.counter, bubble: a.bubble });
    if (a.refused) {
      this.hud?.flashRefusal();
      g.audio?.play('error', { volume: 0.45, pitch: 0.8 });
    } else if (!a.ok) g.audio?.play('error');
    this.hud?.refreshCompanion(true);
  }

  // Lyra speaks: a bubble over her head and a line in the chat. When neither the chat
  // nor she is in view, a toast carries her words.
  lyraSays(text, { kind = null, offer = null, memories = null, bubble = true } = {}) {
    const g = this.game;
    const c = g.companion;
    const line = String(text || '').trim();
    if (!line) return;
    if (bubble && c && !c.removed) safe(() => g.bubbles?.say?.(c, line, { kind: 'say' }));
    this.chat.addMessage({ from: 'lyra', text: line, kind, offer, memories });
    // A panel covers the world (and her bubble); off-screen she cannot be seen either.
    if (this.stack.length || (!this.chat.isOpen() && !this.lyraInView())) this.toast(line, 'lyra', { title: g.settings?.companionName || c?.name || 'Lyra' });
  }

  lyraInView() {
    const g = this.game;
    const c = g.companion;
    const cam = g.camera;
    if (!c || c.removed || !cam) return false;
    const vw = cam.vw || 0;
    const vh = cam.vh || 0;
    return c.x >= cam.x && c.x <= cam.x + vw && c.y >= cam.y && c.y <= cam.y + vh;
  }

  // Where she stands with the player changed: the HUD, the chat and a toast say so.
  onCompanionship(p) {
    const g = this.game;
    const state = companionshipOf(g);
    const name = g.settings?.companionName || g.companion?.name || 'Lyra';
    this.hud?.refreshCompanion(true);
    this.mind?.markDirty('you');
    this.chat.setGone(state === 'gone');
    if (state === this.lastCs) return;
    this.lastCs = state;
    const reason = String(p.reason || companionshipReason(g.companion?.mind) || '').trim();
    this.lastCompanionReason = reason;
    const head = (STATE_LINES[state] || STATE_LINES.together)(name);
    this.chat.addMessage({ from: 'system', kind: 'state', text: head, note: reason, state });
    const kind = state === 'together' ? 'good' : state === 'apart' ? 'lyra' : 'warn';
    this.toast(reason || head, kind, { title: reason ? head : companionshipLabel(state), key: 'companionship' });
    g.audio?.play(state === 'together' ? 'magic' : state === 'apart' ? 'ui_open' : 'sleep', { volume: 0.7 });
  }

  jobLabel(job) {
    const id = typeof job === 'string' ? job : job?.id || job?.job || job?.type || '';
    return JOBS.find((j) => j.id === id)?.label || String(id || 'her job').replace(/_/g, ' ');
  }

  // ---------- per-step ----------

  update(dt) {
    if (!this.inited) return;
    const g = this.game;
    if (this.hotkeyGrace > 0) this.hotkeyGrace -= dt;
    if (g.state === 'playing') this.handleHotkeys();
    else if (this.stack.length && g.input?.uiPressed('menu')) {
      // On the title screen Esc closes Settings and How to play too.
      g.input.consume('menu');
      this.closeTop();
    }
    this.hud.update(dt);
    this.chat.update(dt);
    this.village.update(dt);
    this.toasts.update(dt);
    this.dialog.update(dt);
    this.mind.update(dt);
    this.settings.update(dt);

    if (this.invDirty) {
      this.invDirty = false;
      if (this.inventory.isOpen()) this.inventory.render();
      if (this.chest.isOpen()) this.chest.render();
    }

    if (this.pendingSpeech.length && (g.time || 0) - this.pendingSpeech[0].at > 0.6) {
      const sp = this.pendingSpeech.shift();
      // Right after the player spoke, her words are a reply: the brain shows those.
      const replying = Date.now() - (this.chat.lastSentAt || 0) < 9000 || !!safe(() => g.brain?.status?.()?.busy, false);
      if (!replying) this.chat.addMessage({ from: 'lyra', text: sp.text, kind: 'initiative' });
    }

    this.thinkPoll -= dt;
    if (this.thinkPoll <= 0) {
      this.thinkPoll = 0.2;
      const busy = !!safe(() => g.brain?.status?.()?.busy, false);
      const want = this.explicitThinking || busy;
      if (want !== this.chat.thinking) Chat.prototype.setThinking.call(this.chat, want);
    }

    // Interact prompt, a few times a second.
    this.promptTimer -= dt;
    if (this.promptTimer <= 0) {
      this.promptTimer = 0.1;
      let label = '';
      if (g.state === 'playing' && !this.stack.length && g.player && !g.player.downed) {
        const best = safe(() => g.interactions?.best?.(g.player));
        label = best?.label || '';
      }
      if (label !== this.lastPrompt) this.setInteractPrompt(label);
    }

    const p = g.player;
    this.vignette.update(dt, p ? frac(p.hp, p.maxHp) : 1, g.state === 'playing');
  }

  handleHotkeys() {
    const inp = this.game.input;
    if (!inp || this.hotkeyGrace > 0) return;
    if (inp.uiPressed('menu')) {
      inp.consume('menu');
      if (this.hud.jobsOpen) this.hud.closeJobs();
      else if (this.hud.radialOpen) this.hud.closeRadial();
      else if (this.stack.length) this.closeTop();
      else if (this.chat.isOpen()) this.chat.close();
      else this.openPause();
      return;
    }
    const top = this.top();
    if (inp.uiPressed('mind')) {
      inp.consume('mind');
      if (!top || top === this.mind.panel || top === this.inventory.panel) this.toggleMind();
      return;
    }
    if (inp.uiPressed('inventory')) {
      inp.consume('inventory');
      if (!top || top === this.inventory.panel || top === this.mind.panel) this.toggleInventory();
      return;
    }
    if (top) return;
    if (inp.uiPressed('talk')) {
      inp.consume('talk');
      this.chat.open(true);
      return;
    }
    // Number keys ask only while she travels with you; apart, she is not yours to direct.
    const mode = this.hud?.mode || 'full';
    for (let i = 0; i < COMMANDS.length; i++) {
      if (inp.uiPressed(`cmd${i + 1}`)) {
        inp.consume(`cmd${i + 1}`);
        if (mode === 'full') this.runCommand(COMMANDS[i].id);
        else if (mode === 'collapsed' && i === 0) this.askBack();
      }
    }
  }
}
