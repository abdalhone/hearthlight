// Small overlays: the menu (pause), sign and diary popups, full-screen fades and the
// red hit vignette.

import { h, button, icon, setStyle, setText, toggleClass } from './dom.js';
import { makePanel } from './modal.js';
import { dayLabel } from './format.js';
import { prologueAction, bookAction } from './story_menu.js';
import { openCodex } from './codex.js';
import { MENU_ICONS } from './content.js';
import { spellbookIconUrl, SPELLBOOK_ICON_SIZE } from './weave_icons.js';

// The icon for a place in the menus (MENU_ICONS), the same everywhere it appears.
export function menuIcon(id, cls = 'menu-ico') {
  const name = MENU_ICONS[id] || id;
  if (name !== 'spellbook') return icon(name, cls);
  const img = h('img', { class: `px-icon ${cls}`, alt: '', draggable: 'false', 'aria-hidden': 'true', src: spellbookIconUrl() });
  img.style.setProperty('--iw', String(SPELLBOOK_ICON_SIZE.w));
  img.style.setProperty('--ih', String(SPELLBOOK_ICON_SIZE.h));
  return img;
}

function fnOf(obj, name) {
  return obj && typeof obj[name] === 'function' ? obj[name].bind(obj) : null;
}

// The character sheet comes from its own branch (DESIGN §26): shown when this build has it.
export function characterOpener(ui) {
  const open = fnOf(ui, 'openCharacter') || fnOf(ui?.character, 'open') || fnOf(ui?.game?.character, 'open');
  return open ? () => open() : null;
}

function spellbookReady(game, ui) {
  const w = ui?.hud?.weaving;
  if (w && typeof w.available === 'function') return !!w.available();
  return typeof ui?.openSpellbook === 'function' && !!game?.magic;
}

// The one menu (DESIGN §24): what pauses the world and the places that are not already a
// tap away on the HUD, except where the menu is their home (her mind, the Spellbook,
// Missions: the HUD's shortcuts to those lead to the same panels). Inventory and the chat
// live on the HUD only. Pure: [{ id, label, hint, key, group, run, sub }].
//   group 'main' — the big Resume; 'go' — places; 'sys' — settings, save, quit.
// `run(ctx)`: ctx.close() closes the menu; panels opened from it stack on top, so
// closing them (Esc, ✕) comes back here.
export function pauseItems(game, ui) {
  const name = game?.settings?.companionName || game?.companion?.name || 'Lyra';
  const items = [{ id: 'resume', group: 'main', label: 'Resume', hint: '', key: 'Esc', run: (ctx) => ctx.close() }];
  if (spellbookReady(game, ui)) items.push({ id: 'spellbook', group: 'go', label: 'Spellbook', hint: 'Make weaves, fill your slots', key: '', run: () => ui.openSpellbook() });
  if (typeof ui?.openMissions === 'function') items.push({ id: 'missions', group: 'go', label: 'Missions', hint: 'What you have taken on', key: '', run: () => ui.openMissions('active') });
  items.push({ id: 'lyra', group: 'go', label: name, hint: 'Her mind: mood, memories, you', key: '', run: () => ui.openMind?.(ui.mind?.tab || 'now') });
  const character = characterOpener(ui);
  if (character) items.push({ id: 'character', group: 'go', label: 'Character', hint: 'Your stats and gear', key: '', run: character });
  const book = bookAction(game, ui) || (() => openCodex(ui));
  const prologue = prologueAction(game);
  items.push({
    id: 'book',
    group: 'go',
    label: 'The Book of Halcyre',
    hint: 'The world and the story so far',
    key: '',
    run: book,
    sub: prologue ? { id: 'prologue', label: 'Prologue', hint: 'Watch how it began', run: prologue } : null,
  });
  items.push({ id: 'settings', group: 'sys', label: 'Settings', hint: '', key: '', run: () => ui.openSettings?.() });
  items.push({ id: 'save', group: 'sys', label: 'Save', hint: '', key: '', run: (ctx) => ctx.save() });
  items.push({ id: 'quit', group: 'sys', label: 'Quit to title', hint: '', key: '', run: () => ui.quitToTitle?.() });
  return items;
}

function whereText(g) {
  try {
    const loc = g.locations?.at(g.player.x, g.player.y);
    return `${loc?.name || 'The Wilds'} · ${g.clock?.fullString?.() || ''}`;
  } catch {
    return '';
  }
}

function itemButton(it, cls) {
  const text = h('span', { class: 'menu-text' }, h('span', { class: 'menu-label', text: it.label }), it.hint ? h('span', { class: 'menu-hint', text: it.hint }) : null);
  const b = h('button', { type: 'button', class: `btn menu-item pause-${it.id} ${cls}`.trim(), 'data-item': it.id, title: it.hint || null }, menuIcon(it.id), text, it.key ? h('kbd', { class: 'keycap', text: it.key }) : null);
  return b;
}

export function buildPause(ui) {
  const g = ui.game;
  const panel = makePanel({ id: 'pause', title: 'Menu', subtitle: '', iconName: 'pause', cls: 'panel-small panel-pause', closeLabel: 'Resume' });
  panel.pauses = true;
  const where = whereText(g);
  panel.setTitle('Menu', where ? `Paused · ${where}` : 'Paused');
  const items = pauseItems(g, ui);
  let saving = false;
  const ctx = {
    close: () => ui.closeModal(panel),
    // Saving keeps the menu open and says how it went on the button itself.
    save: async () => {
      if (saving) return;
      saving = true;
      const b = panel.el.querySelector('.pause-save');
      const label = b?.querySelector('.menu-label');
      toggleClass(b, 'is-busy', true);
      if (label) setText(label, 'Saving…');
      let ok = false;
      try {
        ok = !!(await g.save?.save?.('manual'));
      } catch {
        ok = false;
      }
      saving = false;
      toggleClass(b, 'is-busy', false);
      if (label) setText(label, ok ? 'Saved' : 'Not saved');
      toggleClass(b, 'is-done', ok);
      setTimeout(() => {
        if (label && b.isConnected) setText(label, 'Save');
        toggleClass(b, 'is-done', false);
      }, 2200);
    },
  };
  const run = async (entry) => {
    try {
      await entry.run(ctx);
    } catch (err) {
      console.warn(`[ui] menu: ${entry.id} failed`, err);
      ui.toast?.(`${entry.label} will not open right now.`, 'warn');
    }
  };

  const menu = h('nav', { class: 'pause-menu', 'aria-label': 'Menu' });
  const go = h('div', { class: 'menu-go' });
  const sys = h('div', { class: 'menu-sys' });
  const goItems = items.filter((it) => it.group === 'go');
  // Two columns where there is room: the Book (with the Prologue beside it) takes a
  // whole row, and so does the last place when the others do not pair up.
  const pairs = goItems.filter((it) => it.id !== 'book');
  for (const it of items) {
    if (it.group === 'main') {
      const b = itemButton(it, 'btn-ember btn-big menu-main');
      b.addEventListener('click', () => run(it));
      menu.append(b);
      continue;
    }
    const wide = it.id === 'book' || (pairs.length % 2 === 1 && it === pairs[pairs.length - 1]);
    const b = itemButton(it, it.group === 'sys' ? 'btn-ghost menu-sys-item' : 'menu-go-item');
    b.addEventListener('click', () => run(it));
    if (it.group === 'sys') {
      sys.append(b);
      continue;
    }
    if (it.sub) {
      const sub = h('button', { type: 'button', class: `btn btn-ghost menu-sub pause-${it.sub.id}`, 'data-item': it.sub.id, title: it.sub.hint }, menuIcon(it.sub.id), h('span', { class: 'menu-label', text: it.sub.label }));
      sub.addEventListener('click', () => {
        // The cutscene takes the whole screen: nothing stays open under it.
        ui.closeAll?.();
        run(it.sub);
      });
      go.append(h('div', { class: `menu-row${wide ? ' menu-wide' : ''}` }, b, sub));
    } else {
      if (wide) b.classList.add('menu-wide');
      go.append(b);
    }
  }
  menu.append(go, sys);
  menu.addEventListener('keydown', (e) => moveFocus(menu, e));
  panel.body.append(menu);
  return panel;
}

// Arrow keys walk the menu (in reading order), Home and End jump to its ends.
function moveFocus(menu, e) {
  const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: -99, End: 99 };
  const step = keys[e.key];
  if (!step) return;
  const list = [...menu.querySelectorAll('button')].filter((b) => !b.disabled && b.offsetParent !== null);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  let n;
  if (step === -99) n = 0;
  else if (step === 99) n = list.length - 1;
  else n = i < 0 ? 0 : (i + step + list.length) % list.length;
  list[n].focus({ preventScroll: false });
  e.preventDefault();
  e.stopPropagation();
}

export function buildSign(title, text) {
  const panel = makePanel({ id: 'sign', title: title || 'A weathered sign', iconName: 'scroll', cls: 'panel-small panel-sign' });
  for (const para of String(text || '').split(/\n{2,}/)) panel.body.append(h('p', { class: 'sign-text', text: para.trim() }));
  return panel;
}

// `extra`: the morning's "While you slept" block, shown above her page when given.
export function buildDiary(ui, entry, extra = null) {
  const g = ui.game;
  const name = g.settings?.companionName || g.companion?.name || 'Lyra';
  const panel = makePanel({ id: 'diary', title: `${name}'s diary`, subtitle: dayLabel(entry?.day, (g.clock?.day || 0) + 1), iconName: 'book', cls: 'panel-small panel-diary' });
  const page = h('article', { class: 'diary-page' });
  for (const para of String(entry?.text || '').split(/\n{2,}/)) if (para.trim()) page.append(h('p', { text: para.trim() }));
  page.append(h('p', { class: 'diary-sign', text: `— ${name}` }));
  if (extra) panel.body.append(extra);
  panel.body.append(h('p', { class: 'muted small', text: 'She left her diary open while you slept. You probably should not read it. You read it anyway.' }), page);
  panel.foot.append(button('Close the diary', { cls: 'btn-ember', onClick: () => ui.closeModal(panel) }));
  return panel;
}

// Full-screen black fade used for sleeping and scene changes.
export class Fader {
  constructor() {
    this.el = h('div', { class: 'fader', 'aria-hidden': 'true' });
    this.timer = 0;
  }

  to(opacity, seconds, reduce) {
    const s = Math.max(0, reduce ? Math.min(0.25, seconds) : seconds);
    clearTimeout(this.timer);
    setStyle(this.el, 'transition-duration', `${s}s`);
    // Force the start value to commit before changing it, so the transition runs.
    void this.el.offsetWidth;
    setStyle(this.el, 'opacity', String(opacity));
    this.el.classList.toggle('blocking', opacity > 0.5);
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, s * 1000 + 30);
    });
  }
}

// The red edge flash when the player is hit, plus a slow pulse at low health.
export class Vignette {
  constructor() {
    this.flashEl = h('div', { class: 'vignette-hit', 'aria-hidden': 'true' });
    this.lowEl = h('div', { class: 'vignette-low', 'aria-hidden': 'true' });
    this.flash = 0;
    this.lastOpacity = -1;
  }

  hit(strength = 0.6) {
    this.flash = Math.min(1, Math.max(this.flash, 0.35 + strength));
  }

  update(dt, hpFrac, active) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);
    const o = Math.round(this.flash * 100) / 100;
    if (o !== this.lastOpacity) {
      this.lastOpacity = o;
      setStyle(this.flashEl, 'opacity', String(o));
    }
    toggleClass(this.lowEl, 'on', !!active && hpFrac > 0 && hpFrac < 0.25);
  }
}
