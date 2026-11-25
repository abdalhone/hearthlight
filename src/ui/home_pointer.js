// The way home (r13; the author: "I'm not able to find my bed"; DESIGN §19.8): Menu → Home
// marks the player's bed — a "Your bed" tag over it when it is on screen, an arrow at the
// screen's edge pointing to it when it is not — until they reach it, sleep, or turn it off
// there. Asking Lyra or a villager where the bed is turns it on too (src/world/home.js).
// Inside the Wayhouse the bed always wears its tag. Its own layer under the HUD; its own
// styles (injected once), so the shared stylesheet is untouched.

import { h } from './dom.js';
import { icon } from './dom.js';
import { homeBed, homeFacts, HOME_ID } from '../world/home.js';

const STYLE_ID = 'hl-home-pointer';
const CSS = `
.home-layer { z-index: 1; overflow: hidden; }
.home-tag { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
.home-tag > span { position: absolute; left: 0; bottom: 6px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px 2px; white-space: nowrap; font-family: var(--font-display); font-size: 13px; line-height: 1.1; color: #2a1a05;
  background: linear-gradient(180deg, #ffe9a3, #f2c04f 70%, #d39a2f); border: 2px solid #1a1423;
  box-shadow: 0 0 0 1px rgba(255,233,163,.35), 0 0 12px rgba(255,200,90,.45), 0 3px 0 rgba(10,8,25,.45); animation: home-bob 1.6s ease-in-out infinite; }
.home-tag > span::after { content: ''; position: absolute; left: 50%; top: 100%; margin-left: -5px; border: 5px solid transparent; border-top-color: #1a1423; }
.home-tag .px-icon { --isc: 2; }
.home-edge { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
.home-edge-tip { position: absolute; left: -14px; top: -12px; width: 0; height: 0; border-top: 12px solid transparent; border-bottom: 12px solid transparent;
  border-left: 26px solid #ffd36b; transform-origin: 14px 12px;
  filter: drop-shadow(0 0 0 #1a1423) drop-shadow(1px 0 0 #1a1423) drop-shadow(-1px 0 0 #1a1423) drop-shadow(0 1px 0 #1a1423) drop-shadow(0 0 6px rgba(255,200,90,.7)); }
.home-edge-label { position: absolute; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px 1px;
  font-family: var(--font-display); font-size: 12px; color: #ffe9b0; background: rgba(13,12,34,.86); border: 2px solid #b8862a; white-space: nowrap; }
.home-edge-label .px-icon { --isc: 2; }
@keyframes home-bob { 0%,100% { margin-bottom: 0; } 50% { margin-bottom: 3px; } }
@media (prefers-reduced-motion: reduce) { .home-tag > span { animation: none; } }
.reduce-motion .home-tag > span { animation: none; }
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.append(st);
}

function safe(fn, fb = null) {
  try {
    return fn();
  } catch {
    return fb;
  }
}

// Pure: where an arrow toward p (CSS px) sits on the edge of a W×H screen, `pad` in from it.
export function edgePoint(p, W, H, pad = 40) {
  const cx = W / 2;
  const cy = H / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const sx = dx ? (dx > 0 ? W - pad - cx : pad - cx) / dx : Infinity;
  const sy = dy ? (dy > 0 ? H - pad - cy : pad - cy) / dy : Infinity;
  const s = Math.min(Math.abs(sx), Math.abs(sy));
  return { x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) };
}

export class HomePointer {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.active = false;
    this.reason = null;
    this.built = false;
    const bus = game?.bus;
    bus?.on?.('player_sleep', () => this.hide());
    bus?.on?.('game_start', () => this.hide());
  }

  build() {
    if (this.built || typeof document === 'undefined') return;
    const root = this.ui?.root;
    if (!root) return;
    this.built = true;
    injectStyles();
    this.layer = h('div', { class: 'layer home-layer', 'aria-hidden': 'true' });
    this.tag = h('div', { class: 'home-tag', hidden: true }, h('span', null, icon('home'), document.createTextNode('Your bed')));
    this.tip = h('div', { class: 'home-edge-tip' });
    this.label = h('span', { class: 'home-edge-label' }, icon('home'), document.createTextNode('Home'));
    this.arrow = h('div', { class: 'home-edge', hidden: true }, this.tip, this.label);
    this.layer.append(this.tag, this.arrow);
    const fx = root.querySelector?.('.layer-fx');
    if (fx?.after) fx.after(this.layer);
    else root.prepend(this.layer);
  }

  // Mark the way (reason: 'menu' | 'lyra' | a villager id | 'asked'). -> false if there is no bed.
  show(reason = 'menu') {
    if (!homeBed(this.game)) return false;
    this.build();
    this.active = true;
    this.reason = reason;
    this.game.bus?.emit?.('home_pointer', { on: true, reason });
    return true;
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    this.game.bus?.emit?.('home_pointer', { on: false });
  }

  // Menu → Home: on (with a word of where it is), or off again.
  toggle() {
    if (this.active) {
      this.hide();
      this.ui?.toast?.('The way home is no longer marked.', 'info');
      return false;
    }
    if (!this.show('menu')) {
      this.ui?.toast?.('You have no bed of your own here.', 'info');
      return false;
    }
    const f = homeFacts(this.game);
    if (f.inside) this.ui?.toast?.('You are home: your bed is the one marked, on the left as you come in.', 'good', { title: 'Home' });
    else this.ui?.toast?.(`Your bed is in the Wayhouse, ${f.dir} of here. Follow the arrow; it goes away when you get there.`, 'good', { title: 'The way home' });
    return true;
  }

  visible() {
    const g = this.game;
    if (g.state !== 'playing' || !g.player || !g.renderer?.worldToCss) return false;
    if (safe(() => g.ui?.isModalOpen?.(), false)) return false;
    if (safe(() => g.story?.isPlaying?.(), false)) return false;
    return true;
  }

  // Each frame (ui.update).
  update() {
    const g = this.game;
    const bed = this.active || this.built ? homeBed(g) : null;
    const p = g.player;
    // Reached it: the mark has done its work.
    if (this.active && bed && p && Math.hypot(p.x - bed.x, p.y - (bed.y - 8)) < 30) this.hide();
    const inside = !!bed && !!p && safe(() => g.locations?.at?.(p.x, p.y)?.id === HOME_ID, false);
    if (!this.active && !inside) {
      if (this.built) {
        if (!this.tag.hidden) this.tag.hidden = true;
        if (!this.arrow.hidden) this.arrow.hidden = true;
      }
      return;
    }
    this.build();
    if (!this.built) return;
    const on = !!bed && this.visible();
    if (this.layer.hidden === on) this.layer.hidden = !on;
    if (!on) return;
    const canvas = g.renderer.canvas || g.canvas;
    const W = canvas?.clientWidth || window.innerWidth;
    const H = canvas?.clientHeight || window.innerHeight;
    const s = g.renderer.worldToCss(bed.x, bed.y - 34);
    const onScreen = s.x > 12 && s.y > 12 && s.x < W - 12 && s.y < H - 12;
    if (onScreen) {
      this.tag.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      if (this.tag.hidden) this.tag.hidden = false;
      if (!this.arrow.hidden) this.arrow.hidden = true;
      return;
    }
    if (!this.tag.hidden) this.tag.hidden = true;
    if (!this.active) {
      if (!this.arrow.hidden) this.arrow.hidden = true;
      return;
    }
    const e = edgePoint(s, W, H, 40);
    this.arrow.style.transform = `translate(${Math.round(e.x)}px, ${Math.round(e.y)}px)`;
    this.tip.style.transform = `rotate(${e.angle.toFixed(3)}rad)`;
    // The word sits just inside the tip, toward the middle of the screen.
    this.label.style.left = `${Math.round(-Math.cos(e.angle) * 50)}px`;
    this.label.style.top = `${Math.round(-Math.sin(e.angle) * 30)}px`;
    if (this.arrow.hidden) this.arrow.hidden = false;
  }
}
