// Where your coins lie (DESIGN §27, round 14): while an ember-ring holds what you carried
// when you died, a small ember tag floats over it ("Your 57 coins") and, when it is off
// screen, an ember arrow at the screen's edge points the way with how far it is — the
// compass to it. Hidden under panels and cutscenes; nothing runs while there is no ring.
// Maps read game.survival.mapMarks() for the same place.

import { h, setText } from './dom.js';

const STYLE_ID = 'er-styles';
const CSS = `
.er-layer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.er-layer[hidden] { display: none; }
.er-tag { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-display, system-ui); font-size: var(--fs-xs, 12px); color: #ffe0b8; padding: 2px 7px 3px;
  background: rgba(26, 10, 6, .78); box-shadow: 0 0 0 1px rgba(255, 138, 58, .65), 0 0 10px rgba(255, 110, 40, .45); will-change: transform; }
.er-tag[hidden], .er-edge[hidden] { display: none; }
.er-dot { width: 7px; height: 7px; background: #ff8a3a; box-shadow: 0 0 6px #ffb047; transform: rotate(45deg); flex: none; }
.er-edge { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform; }
.er-edge-tip { position: absolute; left: -12px; top: -10px; width: 0; height: 0; border-top: 10px solid transparent; border-bottom: 10px solid transparent;
  border-left: 20px solid #ff8a3a; filter: drop-shadow(1px 0 0 #1a0c08) drop-shadow(-1px 0 0 #1a0c08) drop-shadow(0 1px 0 #1a0c08) drop-shadow(0 -1px 0 #1a0c08) drop-shadow(0 0 6px rgba(255,120,40,.8));
  animation: er-nudge 1.1s ease-in-out infinite; }
.er-edge-label { position: absolute; left: 0; top: 0; transform: translate(-50%, 14px); white-space: nowrap; font-family: var(--font-display, system-ui);
  font-size: var(--fs-2xs, 11px); color: #ffd7b0; text-shadow: 0 1px 0 #000, 0 0 6px rgba(0,0,0,.9); }
@keyframes er-nudge { 0%,100% { margin-left: 0; } 50% { margin-left: 4px; } }
@media (prefers-reduced-motion: reduce) { .er-edge-tip { animation: none; } }
`;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class EmberRingView {
  constructor(game) {
    this.game = game;
    this.layer = null;
    this.raf = 0;
    const bus = game.bus;
    const wake = () => this.start();
    bus?.on?.('ember_ring', wake);
    bus?.on?.('game_start', wake);
    bus?.on?.('ember_ring_taken', wake);
    bus?.on?.('ember_ring_lost', wake);
  }

  mount() {
    if (this.layer || typeof document === 'undefined') return;
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.append(st);
    }
    this.count = h('span', { class: 'er-count' });
    this.tag = h('div', { class: 'er-tag', hidden: true }, h('span', { class: 'er-dot' }), this.count);
    this.edgeLabel = h('span', { class: 'er-edge-label' });
    this.edgeTip = h('div', { class: 'er-edge-tip' });
    this.edge = h('div', { class: 'er-edge', hidden: true }, this.edgeTip, this.edgeLabel);
    this.layer = h('div', { class: 'layer er-layer', 'aria-hidden': 'true', hidden: true }, this.tag, this.edge);
    const root = this.game.ui?.root || this.game.uiRoot || document.body;
    const fx = root.querySelector?.('.layer-fx');
    if (fx?.after) fx.after(this.layer);
    else root.prepend(this.layer);
  }

  start() {
    if (typeof requestAnimationFrame !== 'function') return;
    this.mount();
    if (this.raf) return;
    const loop = () => {
      this.raf = 0;
      let more = true;
      try {
        more = this.frame();
      } catch (err) {
        if (!this.warned) console.warn('[ember ring] view', err);
        this.warned = true;
      }
      if (more) this.raf = requestAnimationFrame(loop);
      else if (this.layer) this.layer.hidden = true;
    };
    this.raf = requestAnimationFrame(loop);
  }

  // One frame; false when there is nothing left to show (the loop stops).
  frame() {
    const g = this.game;
    const ring = g.survival?.ring;
    if (!ring || ring.taken) return false;
    const P = g.player;
    const R = g.renderer;
    const on = g.state === 'playing' && !!P && !!R?.worldToCss && !safe(() => g.ui?.isModalOpen?.(), false) && !safe(() => g.story?.isPlaying?.(), false);
    if (this.layer.hidden === on) this.layer.hidden = !on;
    if (!on) return true;
    const canvas = R.canvas || g.canvas;
    const W = canvas?.clientWidth || window.innerWidth;
    const H = canvas?.clientHeight || window.innerHeight;
    const p = R.worldToCss(ring.x, ring.y - 16);
    const d = Math.hypot(P.x - ring.x, P.y - ring.y);
    const inside = p.x > 10 && p.y > 24 && p.x < W - 10 && p.y < H - 10;
    const label = `Your ${ring.coins} ${ring.coins === 1 ? 'coin' : 'coins'}`;
    // Over the ring while it is in view (and you are not already standing at it).
    const showTag = inside && d > 34;
    if (showTag) {
      setText(this.count, label);
      this.tag.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    if (this.tag.hidden === showTag) this.tag.hidden = !showTag;
    // At the edge, pointing the way, while it is out of view.
    if (inside) {
      if (!this.edge.hidden) this.edge.hidden = true;
      return true;
    }
    const cx = W / 2;
    const cy = H / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    // Clear of the HUD: the cards and the quest line at the top, the hotbar at the bottom.
    const pad = 40;
    // Clear of the HUD as it is drawn (round 13's Interface size zooms it on a computer):
    // below the mission line, and below the corner cards when the arrow is at a side.
    const hud = this.hudClear();
    const top = Math.max(74, hud.top);
    // (on a phone, above the thumbs: the stick and the buttons own the bottom corners)
    const touch = !!g.ui?.isTouch;
    const bottom = Math.max(46, touch ? Math.min(150, H * 0.28) : this.hotbarClear(H));
    const sx = dx ? (dx > 0 ? W - pad - cx : pad - cx) / dx : Infinity;
    const sy = dy ? (dy > 0 ? H - bottom - cy : top - cy) / dy : Infinity;
    const s = Math.min(Math.abs(sx), Math.abs(sy));
    const x = cx + dx * s;
    let y = cy + dy * s;
    if (x < hud.leftR && y < hud.leftB) y = Math.min(H - bottom, hud.leftB);
    else if (x > hud.rightL && y < hud.rightB) y = Math.min(H - bottom, hud.rightB);
    const ang = Math.atan2(dy, dx);
    this.edge.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.edgeTip.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    // Paces: a tile is a stride.
    const paces = Math.round(d / 16);
    setText(this.edgeLabel, `${label} · ${paces} ${paces === 1 ? 'pace' : 'paces'}`);
    // Keep the label inside the screen near the left and right edges.
    this.edgeLabel.style.transform = `translate(${x < 90 ? '-10%' : x > W - 90 ? '-90%' : '-50%'}, ${y > H - bottom - 20 ? '-34px' : '14px'})`;
    if (this.edge.hidden) this.edge.hidden = false;
    return true;
  }

  // How far up from the bottom the hotbar reaches (re-read now and then, not every frame).
  // The HUD's top band, measured twice a second: { top, leftR, leftB, rightL, rightB } (px).
  hudClear() {
    const now = performance.now();
    if (this._hud && now - (this._hudAt || 0) < 500) return this._hud;
    this._hudAt = now;
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden || e.offsetParent === null) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const quest = box('.hud-center .quest-line');
    const left = box('.hud-cards');
    const right = box('.hud-right');
    // (round 14b polish: the arrow is drawn at the Interface size too, src/styles/polish.css,
    // and turned it reaches about 14 px × the size from its point: the gap grows with it)
    const z = Math.max(1, Number(this.game?.ui?._uiz) || 1);
    const gap = 14 + 18 * (z - 1);
    this._hud = {
      top: quest ? quest.bottom + gap : 0,
      leftR: left ? left.right + 12 : -1,
      leftB: left ? left.bottom + gap : 0,
      rightL: right ? right.left - 12 : Infinity,
      rightB: right ? right.bottom + gap : 0,
    };
    return this._hud;
  }

  hotbarClear(H) {
    const now = performance.now();
    if (now - (this._hbAt || 0) > 500) {
      this._hbAt = now;
      const hb = document.querySelector('.hotbar');
      const r = hb && !hb.hidden && hb.offsetParent !== null ? hb.getBoundingClientRect() : null;
      // (and the "E · Talk to…" prompt that sits just above it)
      this._hb = r && r.height > 0 ? Math.max(0, H - r.top + 62) : 0;
    }
    return this._hb || 0;
  }
}

export function installEmberRingView(game) {
  if (!game || game.emberRingView || typeof document === 'undefined') return game?.emberRingView || null;
  game.emberRingView = new EmberRingView(game);
  return game.emberRingView;
}
