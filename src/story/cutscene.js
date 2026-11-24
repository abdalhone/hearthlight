// The cutscene player (DESIGN §20): letterboxed scenes made of data steps — painted panels,
// narration, dialogue with portraits, in-world camera moves and actors, fades, waits,
// sound, music and voiced lines. Tap, click, Space or Enter advances (finishing the typing
// first); Escape, holding the pointer, or the Skip button skips the whole scene. The game
// is paused underneath while a scene plays (the director sets the state). Text is DOM at
// full resolution. Voice: game.voice.play({ speaker, text, key }) → Promise that resolves
// when the clip ends (or at once when there is none); the line then waits out a reading
// time, so a missing or failed voice never blocks.

import { PANELS } from './panels.js';
import { PanelInstance, panelMetrics, makeOverlay } from './panel_view.js';
import { castPortrait, setStampAtlas } from './cast.js';
import { stepKey, speakerName, readingMs, isSpoken } from './scripts.js';
import { Score } from './score.js';

const HOLD_TO_SKIP = 0.9; // seconds of holding the pointer down
const FADE_MS = 700;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class CutscenePlayer {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.active = false;
    this.script = null;
    this.skipping = false;
    this.panel = null; // current PanelInstance
    this.prevPanel = null;
    this.xfade = 1;
    this.waiters = new Set();
    this.typing = null;
    this.advanceFn = null;
    this.holdT = -1;
    this.camTween = null;
    this.actorTweens = [];
    this.devW = 0;
    this.devH = 0;
    this.overlay = null;
    this.score = null;
    this.lineStarted = 0;
    this.onKey = (e) => this.handleKey(e);
    this.onKeyUp = (e) => {
      if (this.active || performance.now() < (this.guardUntil || 0)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
  }

  // ------------------------------------------------------------------ DOM

  mount() {
    if (this.root) return;
    const g = this.game;
    const r = el('div', 'cs-root');
    r.hidden = true;
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Cutscene');
    this.canvas = el('canvas', 'cs-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fadeEl = el('div', 'cs-fade');
    this.barTop = el('div', 'cs-bar cs-bar-top');
    this.barBottom = el('div', 'cs-bar cs-bar-bottom');
    this.titleEl = el('div', 'cs-title');
    this.titleMain = el('div', 'cs-title-main');
    this.titleSub = el('div', 'cs-title-sub');
    this.titleEl.append(this.titleMain, this.titleSub);
    this.box = el('div', 'cs-box');
    this.portraitWrap = el('div', 'cs-portrait');
    this.portraitCanvas = el('canvas');
    this.portraitCanvas.width = 48;
    this.portraitCanvas.height = 48;
    this.portraitWrap.append(this.portraitCanvas);
    this.nameEl = el('div', 'cs-name');
    this.textEl = el('p', 'cs-text');
    this.textEl.setAttribute('aria-live', 'polite');
    this.nextEl = el('span', 'cs-next');
    this.nextEl.setAttribute('aria-hidden', 'true');
    const wrap = el('div', 'cs-words');
    wrap.append(this.nameEl, this.textEl, this.nextEl);
    this.box.append(this.portraitWrap, wrap);
    this.skipBtn = el('button', 'cs-skip');
    this.skipBtn.type = 'button';
    this.skipLabel = el('span', 'cs-skip-label', 'Skip');
    this.skipFill = el('span', 'cs-skip-fill');
    this.skipBtn.append(this.skipFill, this.skipLabel);
    this.skipBtn.title = 'Skip this scene (Esc)';
    this.skipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    this.skipBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.hint = el('div', 'cs-hint', '');
    r.append(this.canvas, this.fadeEl, this.barTop, this.barBottom, this.titleEl, this.box, this.skipBtn, this.hint);
    r.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.holdT = 0;
    });
    r.addEventListener('pointerup', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const held = this.holdT;
      this.holdT = -1;
      this.skipFill.style.transform = 'scaleX(0)';
      if (held >= 0 && held < HOLD_TO_SKIP) this.advance();
    });
    r.addEventListener('pointercancel', () => {
      this.holdT = -1;
      this.skipFill.style.transform = 'scaleX(0)';
    });
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    (g.uiRoot || document.body).append(r);
    this.root = r;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.root || this.root.hidden) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((this.root.clientWidth || window.innerWidth) * dpr));
    const h = Math.max(1, Math.round((this.root.clientHeight || window.innerHeight) * dpr));
    if (w === this.devW && h === this.devH) return;
    this.devW = w;
    this.devH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.metrics = panelMetrics(w, h);
    this.overlay = null;
    // Repaint the current panel at the new shape, keeping its clock.
    if (this.panel) {
      const t = this.panel.t;
      this.panel = this.makePanel(this.panel.def.id, { pan: this.panel.pan });
      if (this.panel) this.panel.t = t;
    }
    this.prevPanel = null;
    const portrait = h > w * 1.1;
    this.root.classList.toggle('cs-portrait-screen', portrait);
  }

  makePanel(id, opts = {}) {
    const def = PANELS[id];
    if (!def || !this.devW) return null;
    try {
      const m = panelMetrics(this.devW, this.devH, def.short);
      return new PanelInstance(def, m.vw, m.vh, { ...opts, s: m.s });
    } catch (err) {
      console.warn('[story] panel failed', id, err);
      return null;
    }
  }

  // ------------------------------------------------------------------ playing

  isPlaying() {
    return this.active;
  }

  // Play a script. opts: { world: bool (world steps run on the live map), onWorldBegin,
  // onWorldEnd }. Resolves { skipped } when the scene has ended and the screen is clear.
  play(script, opts = {}) {
    if (this.active) return Promise.resolve({ skipped: true, busy: true });
    this.mount();
    setStampAtlas(this.game.atlas);
    this.script = script;
    this.opts = opts;
    this.active = true;
    this.skipping = false;
    this.root.hidden = false;
    this.root.classList.add('cs-on');
    this.root.classList.remove('cs-world');
    this.devW = 0;
    this.resize();
    this.panel = null;
    this.prevPanel = null;
    this.camTween = null;
    this.actorTweens = [];
    this.inWorld = false;
    this.box.classList.remove('cs-show');
    this.titleEl.classList.remove('cs-show');
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    this.game.input?.releaseAll?.();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.game.uiRoot?.classList.add('cs-active');
    try {
      this.score = new Score(this.game.audio);
    } catch {
      this.score = null;
    }
    return this.runSteps().then(
      (r) => r,
      (err) => {
        console.warn('[story] scene failed', script?.id, err);
        return this.finish(true);
      },
    );
  }

  async runSteps() {
    const steps = this.script.steps || [];
    let i = 0;
    while (i < steps.length && !this.skipping) {
      const st = steps[i];
      if (st.world === 'begin' && !this.opts.world) {
        // No live map to play on (a replay, or the title screen): show the stand-in panel
        // and keep only the lines.
        if (st.panel) this.showPanel(st.panel, st);
        i++;
        while (i < steps.length && steps[i].world !== 'end') {
          const s2 = steps[i];
          if (isSpoken(s2)) await this.exec(s2, i);
          i++;
        }
        i++;
        continue;
      }
      await this.exec(st, i);
      // The words leave the screen when the next step is not another line.
      if (isSpoken(st) && !isSpoken(steps[i + 1])) this.box.classList.remove('cs-show');
      i++;
    }
    return this.finish(this.skipping);
  }

  async exec(st, index) {
    if (this.skipping) return;
    if (st.when && !this.check(st.when)) return;
    if (st.world === 'begin') return this.beginWorld(st);
    if (st.world === 'end') return this.endWorld(st);
    if (st.title != null && !st.steps) return this.showTitle(st);
    if (st.panel) {
      this.showPanel(st.panel, st);
      if (st.hold) await this.wait(st.hold);
      return;
    }
    if (st.fade) return this.fade(st.fade, st.ms ?? FADE_MS, st.color);
    if (st.wait != null) return this.wait(st.wait);
    if (st.sound) {
      try {
        this.game.audio?.play?.(st.sound, { volume: st.volume ?? 0.9 });
      } catch {
        /* sound is decoration */
      }
      return;
    }
    if (st.music) {
      this.score?.cue(st.music);
      return;
    }
    if (st.camera) return this.cameraTo(st.camera);
    if (st.actor) return this.actor(st);
    if (st.call) {
      try {
        await this.opts.calls?.[st.call]?.(st);
      } catch (err) {
        console.warn('[story] call failed', st.call, err);
      }
      return;
    }
    if (isSpoken(st)) return this.line(st, index);
  }

  check(when) {
    try {
      return typeof this.opts.when === 'function' ? !!this.opts.when(when) : true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ steps

  showPanel(id, st = {}) {
    const inst = this.makePanel(id, { pan: st.pan, panSeconds: st.panSeconds });
    if (!inst) return;
    this.prevPanel = this.panel;
    this.panel = inst;
    this.xfade = this.prevPanel ? 0 : 1;
    if (!this.prevPanel) this.fade('in', 900);
    this.root.classList.remove('cs-world');
  }

  showTitle(st) {
    this.titleMain.textContent = st.title || '';
    this.titleSub.textContent = st.sub || '';
    this.titleEl.classList.add('cs-show');
    return this.wait(st.ms ?? 2600).then(() => {
      this.titleEl.classList.remove('cs-show');
      return this.wait(500);
    });
  }

  fade(dir, ms = FADE_MS, color) {
    const target = dir === 'out' ? 1 : 0;
    const reduce = this.reduceMotion();
    const dur = reduce ? Math.min(200, ms) : ms;
    this.fadeEl.style.background = color || '#05040c';
    this.fadeEl.style.transition = 'none';
    void this.fadeEl.offsetWidth;
    this.fadeEl.style.transition = `opacity ${dur}ms ease`;
    this.fadeEl.style.opacity = String(target);
    return this.wait(dur);
  }

  async beginWorld(st) {
    try {
      await this.opts.onWorldBegin?.(st);
    } catch (err) {
      console.warn('[story] world setup failed', err);
    }
    this.inWorld = true;
    this.panel = null;
    this.prevPanel = null;
    this.ctx.clearRect(0, 0, this.devW, this.devH);
    this.root.classList.add('cs-world');
  }

  async endWorld() {
    this.inWorld = false;
  }

  // Resolve a place or a person to a world point.
  where(target) {
    const g = this.game;
    if (!target) return null;
    if (typeof target === 'object' && Number.isFinite(target.x)) return { x: target.x, y: target.y };
    const id = String(target);
    const e = id === 'player' ? g.player : id === 'lyra' ? g.companion : g.entities?.get?.(id);
    if (e) return { x: e.x, y: e.y - 8 };
    const o = g.objects?.get?.(id);
    if (o) return { x: o.x, y: o.y - 8 };
    const loc = g.locations?.get?.(id);
    if (loc?.center) return { x: loc.center.x, y: loc.center.y };
    return null;
  }

  cameraTo(spec) {
    const g = this.game;
    const cam = g.camera;
    const p = this.where(spec.to);
    if (!cam || !p || !g.map) return null;
    const from = { x: cam.x, y: cam.y };
    const to = { x: p.x + (spec.dx || 0) - cam.vw / 2, y: p.y + (spec.dy || 0) - cam.vh / 2 };
    const ms = spec.ms ?? 1200;
    if (ms <= 0 || this.reduceMotion()) {
      cam.x = to.x;
      cam.y = to.y;
      cam.clampToMap?.();
      return null;
    }
    this.camTween = { from, to, t: 0, dur: ms / 1000 };
    return this.wait(spec.wait === false ? 0 : ms);
  }

  actor(st) {
    const g = this.game;
    const who = st.actor === 'player' ? g.player : st.actor === 'lyra' ? g.companion : g.entities?.get?.(st.actor);
    if (!who) return null;
    if (st.place) {
      const p = this.where(st.place);
      if (p) {
        who.x = p.x + (st.dx || 0);
        who.y = p.y + 8 + (st.dy || 0);
      }
    }
    if (st.face) {
      const dirs = ['up', 'down', 'left', 'right'];
      if (dirs.includes(st.face)) who.faceDir?.(st.face);
      else {
        const p = this.where(st.face);
        if (p) who.faceToward?.(p.x, p.y + 8);
      }
    }
    if (st.anim) who.setState?.(st.anim);
    if (st.emote) {
      try {
        g.bubbles?.icon?.(who, st.emote);
      } catch {
        /* emotes are decoration */
      }
    }
    if (st.walkTo) {
      const p = this.where(st.walkTo);
      if (!p) return null;
      const to = { x: p.x + (st.dx || 0), y: p.y + 8 + (st.dy || 0) };
      const dist = Math.hypot(to.x - who.x, to.y - who.y);
      const speed = st.speed || 38;
      const dur = Math.max(0.2, dist / speed);
      who.faceToward?.(to.x, to.y);
      who.setState?.('walk');
      this.actorTweens.push({ who, from: { x: who.x, y: who.y }, to, t: 0, dur, then: st.thenFace });
      return st.wait === false ? null : this.wait(dur * 1000);
    }
    return null;
  }

  // A spoken or narrated line: show it, type it, voice it, then wait for the reader.
  async line(st, index) {
    const g = this.game;
    const narr = st.narrate != null;
    const speaker = narr ? 'narrator' : st.say;
    let text = String(narr ? st.narrate : st.text || '');
    const name = speakerName(speaker, g);
    const companion = g.settings?.companionName;
    if (companion && companion !== 'Lyra') text = text.replace(/\bLyra\b/g, companion);
    this.box.classList.toggle('cs-narration', narr);
    this.box.classList.toggle('cs-lyra', speaker === 'lyra');
    this.nameEl.textContent = narr ? '' : name;
    const pc = narr ? null : castPortrait(speaker === 'lyra' && st.young ? 'lyra_young' : speaker, st.mood || 'neutral', g.atlas);
    this.portraitWrap.hidden = !pc;
    if (pc) {
      const ctx = this.portraitCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 48, 48);
      ctx.drawImage(pc, 0, 0, 48, 48);
    }
    this.box.classList.add('cs-show');
    this.textEl.textContent = '';
    this.nextEl.classList.remove('cs-ready');
    const rate = this.reduceMotion() ? Infinity : 42 * Math.max(0.5, Number(g.settings?.textSpeed) || 1);
    this.typing = { text, shown: 0, rate, done: !Number.isFinite(rate) };
    if (this.typing.done) this.textEl.textContent = text;
    const key = stepKey(this.script.id, index, st);
    // Voice: plays alongside the typing; never blocks the scene.
    const started = performance.now();
    let voiceEnded = Promise.resolve(false);
    const voice = g.voice;
    if (voice && typeof voice.play === 'function') {
      try {
        voiceEnded = Promise.resolve(voice.play({ speaker, text, key })).then(
          (v) => v,
          () => false,
        );
      } catch {
        voiceEnded = Promise.resolve(false);
      }
    }
    const minRead = readingMs(text, narr);
    let auto = false;
    const autoTimer = voiceEnded.then((v) => {
      // A clip that resolved almost at once means there was no clip: read instead.
      const elapsed = performance.now() - started;
      const remain = v && elapsed > 400 ? 650 : Math.max(650, minRead - elapsed);
      return this.wait(remain);
    });
    const advanced = new Promise((resolve) => {
      this.advanceFn = resolve;
    });
    autoTimer.then(() => {
      auto = true;
      this.advanceFn?.();
    });
    await advanced;
    this.advanceFn = null;
    if (!auto) {
      try {
        voice?.stop?.();
      } catch {
        /* nothing to stop */
      }
    }
    this.typing = null;
  }

  // The player taps: finish the typing first, then move on.
  advance() {
    if (!this.active) return;
    if (this.typing && !this.typing.done) {
      this.typing.done = true;
      this.typing.shown = this.typing.text.length;
      this.textEl.textContent = this.typing.text;
      this.nextEl.classList.add('cs-ready');
      return;
    }
    if (this.advanceFn) {
      const f = this.advanceFn;
      this.advanceFn = null;
      f();
    }
  }

  skip() {
    if (!this.active || this.skipping) return;
    this.skipping = true;
    try {
      this.game.voice?.stop?.();
    } catch {
      /* nothing playing */
    }
    this.advanceFn?.();
    for (const w of [...this.waiters]) w();
    this.waiters.clear();
  }

  handleKey(e) {
    if (!this.active) {
      if (performance.now() < (this.guardUntil || 0)) {
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.skip();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter' || e.code === 'Space' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      if (!e.repeat) this.advance();
      return;
    }
    if (e.key === 'Tab') e.preventDefault();
  }

  // A wait that a skip cuts short.
  wait(ms) {
    if (this.skipping || !(ms > 0)) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.waiters.delete(finish);
        resolve();
      };
      this.waiters.add(finish);
      setTimeout(finish, ms);
    });
  }

  async finish(skipped) {
    const g = this.game;
    // Land every tween where it was going, so a skip leaves the world in its end state.
    if (this.camTween && g.camera) {
      g.camera.x = this.camTween.to.x;
      g.camera.y = this.camTween.to.y;
    }
    this.camTween = null;
    for (const tw of this.actorTweens) {
      tw.who.x = tw.to.x;
      tw.who.y = tw.to.y;
      tw.who.setState?.('idle');
    }
    this.actorTweens = [];
    this.box.classList.remove('cs-show');
    this.titleEl.classList.remove('cs-show');
    this.skipping = false;
    await this.fade('out', skipped ? 250 : 500);
    try {
      await this.opts.onEnd?.({ skipped });
    } catch (err) {
      console.warn('[story] scene end failed', err);
    }
    this.score?.stop();
    this.score = null;
    this.panel = null;
    this.prevPanel = null;
    this.ctx.clearRect(0, 0, this.devW, this.devH);
    this.root.classList.remove('cs-world');
    g.input?.releaseAll?.();
    this.active = false;
    // Keep swallowing keys for a moment: the Space that advanced the last line must not
    // land in the game as a sword swing at whoever is standing beside you.
    this.guardUntil = performance.now() + 900;
    setTimeout(() => {
      if (this.active) return;
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      g.input?.releaseAll?.();
    }, 950);
    await this.fade('in', skipped ? 300 : 700);
    this.root.hidden = true;
    this.root.classList.remove('cs-on');
    g.uiRoot?.classList.remove('cs-active');
    this.script = null;
    return { skipped: !!skipped };
  }

  reduceMotion() {
    const g = this.game;
    if (g.settings?.reduceMotion) return true;
    try {
      return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ per frame

  // Fixed-step update from the game loop (also while on the title screen).
  update(dt) {
    if (!this.active) return;
    if (this.holdT >= 0) {
      this.holdT += dt;
      this.skipFill.style.transform = `scaleX(${Math.min(1, this.holdT / HOLD_TO_SKIP)})`;
      if (this.holdT >= HOLD_TO_SKIP) {
        this.holdT = -1;
        this.skip();
      }
    }
    if (this.typing && !this.typing.done) {
      this.typing.shown += dt * this.typing.rate;
      const n = Math.min(this.typing.text.length, Math.floor(this.typing.shown));
      this.textEl.textContent = this.typing.text.slice(0, n);
      if (n >= this.typing.text.length) {
        this.typing.done = true;
        this.nextEl.classList.add('cs-ready');
      }
    }
    if (this.panel) this.panel.update(dt);
    if (this.prevPanel) {
      this.prevPanel.update(dt);
      this.xfade = Math.min(1, this.xfade + dt / 1.1);
      if (this.xfade >= 1) this.prevPanel = null;
    }
    const g = this.game;
    if (this.camTween && g.camera) {
      const tw = this.camTween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = k * k * (3 - 2 * k);
      g.camera.x = tw.from.x + (tw.to.x - tw.from.x) * e;
      g.camera.y = tw.from.y + (tw.to.y - tw.from.y) * e;
      if (k >= 1) this.camTween = null;
    }
    for (let i = this.actorTweens.length - 1; i >= 0; i--) {
      const tw = this.actorTweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.who.x = tw.from.x + (tw.to.x - tw.from.x) * k;
      tw.who.y = tw.from.y + (tw.to.y - tw.from.y) * k;
      tw.who.animTime = (tw.who.animTime || 0) + dt;
      if (k >= 1) {
        tw.who.setState?.('idle');
        if (tw.then) {
          const p = this.where(tw.then);
          if (p) tw.who.faceToward?.(p.x, p.y + 8);
          else tw.who.faceDir?.(tw.then);
        }
        this.actorTweens.splice(i, 1);
      }
    }
    // Idle breathing for the people in an in-world shot (the world itself is frozen).
    if (this.inWorld) {
      for (const a of [g.player, g.companion]) if (a && a.state !== 'walk') a.animTime = (a.animTime || 0) + dt;
    }
  }

  // Draw the painted panel (if any) over the game canvas.
  render() {
    if (!this.active || !this.ctx) return;
    const ctx = this.ctx;
    if (!this.panel) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05040c';
    ctx.fillRect(0, 0, this.devW, this.devH);
    if (this.prevPanel) this.prevPanel.draw(ctx, this.prevPanel.s, this.devW, this.devH, 1);
    this.panel.draw(ctx, this.panel.s, this.devW, this.devH, this.prevPanel ? this.xfade : 1);
    // The dither and vignette match the current panel's pixel size.
    const s = this.panel.s;
    if (!this.overlay || this.overlayS !== s) {
      this.overlay = makeOverlay(this.devW, this.devH, s);
      this.overlayS = s;
    }
    ctx.drawImage(this.overlay, 0, 0);
  }

  // True while a painted panel covers the whole screen (the world need not be drawn).
  coversScreen() {
    return this.active && !!this.panel && !this.prevPanel && this.xfade >= 1;
  }
}
