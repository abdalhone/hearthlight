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
import { buildPause, buildSign, buildDiary, Fader, Vignette } from './overlays.js';
import { makeConfirm } from './modal.js';
import { COMMANDS, JOBS, pickAck } from './content.js';
import { itemIconUrl } from './art.js';
import { itemName } from '../entities/items.js';
import { gainText, frac } from './format.js';

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

const STANCE_ACK = { attack: 'attack', defend: 'defend', passive: 'passive' };

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

    const rt = g.runtime;
    const onCaps = () => {
      this.chat.attachDictation(rt?.dictation || null);
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
    bus.on('revived', ({ entity, by }) => {
      if (isLyra(entity)) this.toast(isPlayer(by) ? `You helped ${lyraName()} back to her feet.` : `${lyraName()} is back on her feet.`, 'good');
    });

    bus.on('job_done', (p) => {
      if (!isLyra(p?.actor)) return;
      const name = this.jobLabel(p.job);
      this.toast(`${lyraName()} finished: ${name.toLowerCase()}.`, 'lyra');
    });
    bus.on('job_failed', (p) => {
      if (!isLyra(p?.actor)) return;
      if (p.reason) this.toast(String(p.reason), 'lyra');
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

    bus.on('relationship_changed', () => this.mind?.markDirty('people'));
    bus.on('memory_added', () => this.mind?.markDirty('memories'));
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
    if (loaded) this.toast(`Welcome back. ${g.clock?.fullString?.() || ''}`.trim(), 'info');
    else this.toast(`Welcome to Hearthvale. ${name} is at your side.`, 'info');
    if (!this.chat.messages.length) {
      this.chat.addMessage({ from: 'system', text: `${name} walks with you. Talk to her about anything, or give orders in plain words.` });
    }
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

  showDiary(entry) {
    if (!this.inited || !entry?.text) return;
    const panel = buildDiary(this, entry);
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
      else if (this.mindSnapshot) mind.deserialize(JSON.parse(this.mindSnapshot));
      else return false;
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

  // ---------- orders ----------

  runCommand(id) {
    const g = this.game;
    if (id === 'talk') {
      this.chat.open(true);
      return;
    }
    if (id === 'jobs') {
      this.hud.openJobs(this.isTouch);
      return;
    }
    const cmd = COMMANDS.find((c) => c.id === id);
    if (!cmd || !g.companion) return;
    const r = safe(() => g.actions.run(cmd.action, cmd.args, 'player'), { ok: false, message: '' }) || { ok: false };
    this.reportOrder(r, STANCE_ACK[id] || id);
  }

  runJob(job, deliverTo = 'player') {
    const g = this.game;
    if (!g.companion) return;
    const r = safe(() => g.actions.run('start_job', { target: deliverTo, value: job.id, amount: job.amount }, 'player'), { ok: false, message: '' }) || { ok: false };
    this.reportOrder(r, 'job');
  }

  runStopJob() {
    const r = safe(() => this.game.actions.run('stop_job', {}, 'player'), { ok: false, message: '' }) || { ok: false };
    this.reportOrder(r, 'stop_job');
  }

  // Lyra answers an order in her own voice: the action's words, or a fitting line.
  reportOrder(r, kind) {
    const g = this.game;
    const c = g.companion;
    if (r.ok) {
      const line = r.message || pickAck(kind);
      if (line && c) {
        safe(() => g.bubbles?.say?.(c, line, { kind: 'say' }));
        this.chat.addMessage({ from: 'lyra', text: line, kind: 'order' });
      }
    } else {
      const line = r.message || "I can't do that right now.";
      safe(() => g.bubbles?.say?.(c, line, { kind: 'say' }));
      this.chat.addMessage({ from: 'lyra', text: line, kind: 'order' });
      this.toast(line, 'lyra');
      g.audio?.play('error');
    }
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
    this.hud.update(dt);
    this.chat.update(dt);
    this.toasts.update(dt);
    this.dialog.update(dt);
    this.mind.update(dt);

    if (this.invDirty) {
      this.invDirty = false;
      if (this.inventory.isOpen()) this.inventory.render();
      if (this.chest.isOpen()) this.chest.render();
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
    for (let i = 0; i < COMMANDS.length; i++) {
      if (inp.uiPressed(`cmd${i + 1}`)) {
        inp.consume(`cmd${i + 1}`);
        this.runCommand(COMMANDS[i].id);
      }
    }
  }
}
