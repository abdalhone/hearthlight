// Small overlays: the pause menu, sign and diary popups, full-screen fades and the
// red hit vignette.

import { h, button, setStyle, toggleClass } from './dom.js';
import { makePanel } from './modal.js';
import { dayLabel } from './format.js';
import { openCodex } from './codex.js';

export function buildPause(ui) {
  const g = ui.game;
  const panel = makePanel({ id: 'pause', title: 'Paused', subtitle: '', iconName: 'pause', cls: 'panel-small panel-pause' });
  panel.pauses = true;
  const where = (() => {
    try {
      const loc = g.locations?.at(g.player.x, g.player.y);
      return `${loc?.name || 'The Wilds'} · ${g.clock?.fullString?.() || ''}`;
    } catch {
      return '';
    }
  })();
  panel.setTitle('Paused', where);
  const menu = h('div', { class: 'pause-menu' });
  menu.append(
    button('Resume', { cls: 'btn-ember btn-big', key: 'Esc', onClick: () => ui.closeModal(panel) }),
    button("Lyra's mind", { icon: 'mind', onClick: () => {
      ui.closeModal(panel, true);
      ui.openMind('now');
    } }),
    button('Inventory', { icon: 'bag', onClick: () => {
      ui.closeModal(panel, true);
      ui.openInventory();
    } }),
    button('The Book of Halcyre', { icon: 'book', onClick: () => {
      ui.closeModal(panel, true);
      openCodex(ui);
    } }),
    button('Watch the prologue', { icon: 'flame', onClick: () => {
      ui.closeModal(panel, true);
      g.story?.playPrologue?.({ world: false });
    } }),
    button('Settings', { icon: 'gear', onClick: () => ui.openSettings() }),
    button('Save game', { icon: 'scroll', onClick: () => g.save?.save?.('manual') }),
    button('Quit to title', { cls: 'btn-ghost', onClick: () => ui.quitToTitle() }),
  );
  panel.body.append(menu);
  return panel;
}

export function buildSign(title, text) {
  const panel = makePanel({ id: 'sign', title: title || 'A weathered sign', iconName: 'scroll', cls: 'panel-small panel-sign' });
  for (const para of String(text || '').split(/\n{2,}/)) panel.body.append(h('p', { class: 'sign-text', text: para.trim() }));
  return panel;
}

export function buildDiary(ui, entry) {
  const g = ui.game;
  const name = g.settings?.companionName || g.companion?.name || 'Lyra';
  const panel = makePanel({ id: 'diary', title: `${name}'s diary`, subtitle: dayLabel(entry?.day, (g.clock?.day || 0) + 1), iconName: 'book', cls: 'panel-small panel-diary' });
  const page = h('article', { class: 'diary-page' });
  for (const para of String(entry?.text || '').split(/\n{2,}/)) if (para.trim()) page.append(h('p', { text: para.trim() }));
  page.append(h('p', { class: 'diary-sign', text: `— ${name}` }));
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
