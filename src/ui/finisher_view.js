// The finisher's killing scene, on the page (round 15, DESIGN §40.3): the camera closes in on
// the two of them (a CSS scale of the game canvas round their midpoint: the whole lit frame,
// pixel-crisp, nothing redrawn), letterbox bars slide in with a word on how to skip, the HUD
// steps aside; a tap, a click or any key skips it. src/murder/finishers.js runs the scene and
// calls open(scene) / frame(scene) / close(scene); this never decides anything.
//
// Reduce motion (the scene is 'brief'): no zoom, the bars appear without sliding.
// Installed in a browser by src/core/plugins/blood.js (game.finisherView).

const ZOOM = 1.8; // how far the camera closes in (a phone held upright too: the pair stays in view)

export class FinisherView {
  constructor(game) {
    this.game = game;
    this.scene = null;
    this.root = null;
    this.canvas = null;
    this._keys = (e) => this.onKey(e);
    this._tap = (e) => this.onTap(e);
    this._down = new Set();
    this._track = (e) => this._down.add(e.code);
    this._untrack = (e) => this._down.delete(e.code);
    window.addEventListener('keydown', this._track, true);
    window.addEventListener('keyup', this._untrack, true);
  }

  build() {
    if (this.root) return this.root;
    const doc = document;
    const root = doc.createElement('div');
    root.className = 'fin-scene-layer';
    root.setAttribute('aria-hidden', 'true');
    const top = doc.createElement('div');
    top.className = 'fin-bar fin-bar-top';
    const bot = doc.createElement('div');
    bot.className = 'fin-bar fin-bar-bottom';
    const hint = doc.createElement('span');
    hint.className = 'fin-skip-hint';
    bot.append(hint);
    root.append(top, bot);
    this.hint = hint;
    this.root = root;
    root.addEventListener('pointerdown', this._tap);
    return root;
  }

  host() {
    return this.game.ui?.root || document.body;
  }

  open(scene) {
    if (typeof document === 'undefined') return;
    this.scene = scene;
    const root = this.build();
    const touch = !!this.game.ui?.isTouch;
    this.hint.textContent = touch ? 'Tap to skip' : 'Click or press any key to skip';
    root.classList.toggle('is-brief', !!scene.brief);
    if (!root.isConnected) this.host().append(root);
    this.host().classList.add('fin-playing');
    // The keys already held when it began (the held blow's own key) do not skip it.
    this._held = new Set(this._down);
    window.addEventListener('keydown', this._keys, true);
    // The camera closes in round the midpoint of the two of them.
    const c = (this.canvas = this.game.renderer?.canvas || document.getElementById('game-canvas'));
    if (c && !scene.brief) {
      const r = this.game.renderer;
      const mx = (scene.x + scene.px) / 2;
      const my = (scene.y + scene.py) / 2 - 8;
      const at = r?.worldToCss ? r.worldToCss(mx, my) : { x: c.clientWidth / 2, y: c.clientHeight / 2 };
      const W = c.clientWidth || window.innerWidth;
      const H = c.clientHeight || window.innerHeight;
      const fx = Math.max(0, Math.min(W, at.x));
      const fy = Math.max(0, Math.min(H, at.y));
      // Scaled round the pair, then moved so they sit in the middle, never so far that the
      // canvas's edge comes into view.
      const tx = Math.max((1 - ZOOM) * (W - fx), Math.min((ZOOM - 1) * fx, W / 2 - fx));
      const ty = Math.max((1 - ZOOM) * (H - fy), Math.min((ZOOM - 1) * fy, H / 2 - fy));
      c.style.transformOrigin = `${Math.round(fx)}px ${Math.round(fy)}px`;
      c.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.7, 0.2, 1)';
      // (next frame, so the transition runs)
      requestAnimationFrame(() => {
        if (this.scene === scene) c.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${ZOOM})`;
      });
    }
    requestAnimationFrame(() => {
      if (this.scene === scene) root.classList.add('is-on');
    });
  }

  // Every step of the scene: the bars and the camera go back for its last beat.
  frame(scene) {
    if (scene !== this.scene || !this.root) return;
    const out = scene.t >= scene.T.FALL + (scene.dur - scene.T.FALL) * 0.25;
    if (out && !this._out) {
      this._out = true;
      this.root.classList.remove('is-on');
      if (this.canvas && !scene.brief) this.canvas.style.transform = '';
    }
  }

  close(scene) {
    if (scene && scene !== this.scene) return;
    this.scene = null;
    this._out = false;
    window.removeEventListener('keydown', this._keys, true);
    this.host()?.classList.remove('fin-playing');
    if (this.root) this.root.classList.remove('is-on');
    const c = this.canvas;
    if (c) {
      c.style.transform = '';
      // The way back eases out, then the canvas is left as it was.
      setTimeout(() => {
        if (!this.scene) {
          c.style.transition = '';
          c.style.transformOrigin = '';
        }
      }, 500);
    }
    setTimeout(() => {
      if (!this.scene && this.root?.isConnected) this.root.remove();
    }, 400);
  }

  onKey(e) {
    if (!this.scene || e.repeat || this._held?.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    this.scene.skip?.();
  }

  onTap(e) {
    if (!this.scene) return;
    e.preventDefault();
    e.stopPropagation();
    this.scene.skip?.();
  }
}

export function installFinisherView(game) {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !game || game.finisherView) return null;
  game.finisherView = new FinisherView(game);
  return game.finisherView;
}
