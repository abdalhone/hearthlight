// The cutscene player (DESIGN §20): letterboxed scenes made of data steps — painted panels,
// narration, dialogue with portraits, in-world camera moves and actors, fades, waits,
// sound, music and voiced lines. Tap, click, Space or Enter advances: the first finishes
// the typing, the next moves on at once (stopping the voice); a tap in a quiet pause
// (a title card, a held panel, a wait) cuts it short. Escape, holding the pointer, or the
// Skip button skips the whole scene. The game is paused underneath while a scene plays
// (the director sets the state). Text is DOM at full resolution.
//
// Voice never holds a line: game.voice.play({ speaker, text, maxLatency, onStart, wanted })
// is asked for the clip, but the line keeps its own clock. It moves on by itself at its
// reading time; only when the clip really starts playing does it wait for the clip's end
// too (whichever is later). A clip that is slow, failed, blocked (audio not yet allowed on
// an iPhone) or unreachable is dropped at the reading time, and after a few failures in a
// row the scene carries on silently.
//
// Captions follow the voice: when the clip plays, each word pops in the moment it is
// spoken (the clip's word times, scripts/voice/); without a clip the line types itself.
// Sound (src/story/sfx.js): steps { sfx }, { bed }, { heart }, { hush: ms }, { slam }, and
// `cues` on a spoken line — [{ word: 'melted', sfx: 'shimmer' }, { at: 1.2, heart: 64 }]
// — fire on the word as it is spoken (or as it is typed), so picture, words and sound
// move together. Effects duck under every spoken word.

import { PANELS } from './panels.js';
import { PanelInstance, panelMetrics, makeOverlay } from './panel_view.js';
import { castPortrait, setStampAtlas } from './cast.js';
import { stepKey, speakerName, readingMs, isSpoken, isSound } from './scripts.js';
import { Score } from './score.js';
import { SceneSound } from './sfx.js';

const HOLD_TO_SKIP = 0.9; // seconds of holding the pointer down
const FADE_MS = 700;
const CLIP_TAIL_MS = 650; // a breath after a voiced line ends before the next
const PAUSE_TAP_MS = 250; // a pause must have shown this long before a tap cuts it
const VOICE_FAILS_OFF = 3; // failed clips in a row before a scene stops asking
// Reasons a clip did not play that say the voice layer itself is failing (not "no clip
// for this line" or "muted").
const VOICE_FAILURES = new Set(['unavailable', 'late', 'failed']);
const CLIP_WAIT_S = 0.6; // a line with a clip holds its words this long for the voice to start
const WORD_LEAD_S = 0.03; // a word pops in this much before it is heard

// A word as cues name it: lower case, no punctuation.
const bare = (w) =>
  String(w || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, '');

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
    this.readMs = readingMs; // how long a line stays up unvoiced (tests may shorten it)
    this.voiceFails = 0;
    this.voiceOff = false;
    this.pauses = new Set(); // quiet waits a tap may cut short: { finish, from }
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
    // How to move on (hidden by the stylesheet unless the UI chooses to show it).
    let touch = false;
    try {
      touch = !!window.matchMedia?.('(pointer: coarse)').matches;
    } catch {
      touch = false;
    }
    this.hint = el('div', 'cs-hint', touch ? 'Tap to continue · hold to skip' : 'Click or Space to continue · Esc to skip');
    r.append(this.canvas, this.fadeEl, this.barTop, this.barBottom, this.titleEl, this.box, this.skipBtn, this.hint);
    r.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.holdT = 0;
      // A tap is a gesture: on an iPhone this is when sound may start.
      try {
        g.audio?.unlock?.();
      } catch {
        /* sound is optional */
      }
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
    this.voiceFails = 0;
    this.voiceOff = false;
    // The opening lines' clips start loading now, so the first one is ready when it speaks.
    this.preloadAhead(-1);
    this.box.classList.remove('cs-show');
    this.titleEl.classList.remove('cs-show');
    // A scene that opens on a painted panel rises out of black; one that opens in the
    // world keeps the world in view while the letterbox slides in.
    const first = (script.steps || []).find((st) => st.panel || st.camera || st.actor || st.say != null || st.narrate != null || st.world);
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = first && !first.panel ? '0' : '1';
    this.game.input?.releaseAll?.();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.game.uiRoot?.classList.add('cs-active');
    try {
      this.score = new Score(this.game.audio);
    } catch {
      this.score = null;
    }
    try {
      this.sound = new SceneSound(this.game.audio, this.score);
    } catch {
      this.sound = null;
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
          if (isSpoken(s2) || isSound(s2)) await this.exec(s2, i);
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
      if (st.hold) await this.pause(st.hold);
      return;
    }
    if (st.fade) return this.fade(st.fade, st.ms ?? FADE_MS, st.color);
    if (st.wait != null) return this.pause(st.wait);
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
    if (isSound(st)) return this.soundStep(st);
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

  // A sound step: an effect, the bed, the heartbeat, the silence (a quiet pause a tap may
  // cut short) or the slam.
  soundStep(st) {
    const s = this.sound;
    try {
      if (st.sfx) s?.fx(st.sfx, { volume: st.volume ?? 1 });
      if (st.bed != null) s?.bed(st.bed === 'none' ? null : st.bed, { level: st.level ?? 1 });
      if (st.heart != null) s?.heart(st.heart);
      if (st.slam) {
        s?.slam(st.slam === true ? 'big' : st.slam);
        this.flash(st.flash || null);
      }
      if (st.hush != null) {
        s?.hush();
        return this.pause(Number(st.hush) || 0);
      }
    } catch (err) {
      console.warn('[story] sound step failed', err);
    }
    return null;
  }

  // A cue on a spoken line, at its moment.
  cue(c) {
    const s = this.sound;
    try {
      if (c.sfx) s?.fx(c.sfx, { volume: c.volume ?? 1 });
      if (c.bed != null) s?.bed(c.bed === 'none' ? null : c.bed, { level: c.level ?? 1 });
      if (c.heart != null) s?.heart(c.heart);
      if (c.hush) s?.hush();
      if (c.slam) s?.slam(c.slam === true ? 'big' : c.slam);
      if (c.flash) this.flash(c.flash);
      if (c.shake) this.shake(c.shake);
    } catch (err) {
      console.warn('[story] cue failed', err);
    }
  }

  // A white (or coloured) flash over the picture, gone in a breath.
  flash(color) {
    if (!color || !this.root || this.reduceMotion()) return;
    const f = el('div', 'cs-flash');
    f.style.background = color === true ? '#fff8e8' : String(color);
    this.root.append(f);
    setTimeout(() => f.remove?.(), 700);
  }

  shake(px = 4) {
    if (!this.root || this.reduceMotion()) return;
    this.root.style.setProperty?.('--cs-shake', `${Math.max(1, Math.min(10, Number(px) || 4))}px`);
    this.root.classList.remove('cs-shaking');
    void this.root.offsetWidth;
    this.root.classList.add('cs-shaking');
    setTimeout(() => this.root.classList.remove('cs-shaking'), 450);
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
    // A panel painted ahead of time (see prepaintNext) is used if the screen is unchanged.
    let inst = this.ahead?.id === id && this.ahead.w === this.devW && this.ahead.h === this.devH ? this.ahead.inst : null;
    this.ahead = null;
    if (inst) {
      inst.pan = st.pan || inst.def.pan || 'right';
      if (st.panSeconds) inst.panSeconds = st.panSeconds;
    } else inst = this.makePanel(id, { pan: st.pan, panSeconds: st.panSeconds });
    if (!inst) return;
    this.prevPanel = this.panel;
    this.panel = inst;
    this.xfade = this.prevPanel ? 0 : 1;
    if (!this.prevPanel) this.fade('in', 900);
    this.root.classList.remove('cs-world');
    this.prepaintNext(id);
  }

  // Paint the script's next panel while this one is on screen, so the crossfade never
  // waits for a brush.
  prepaintNext(currentId) {
    const steps = this.script?.steps || [];
    const at = steps.findIndex((st) => st.panel === currentId);
    const next = steps.slice(at + 1).find((st) => st.panel && !st.world);
    if (!next) return;
    const w = this.devW;
    const h = this.devH;
    setTimeout(() => {
      if (!this.active || this.devW !== w || this.devH !== h) return;
      const inst = this.makePanel(next.panel, { pan: next.pan });
      if (inst) this.ahead = { id: next.panel, w, h, inst };
    }, 1200);
  }

  showTitle(st) {
    this.titleMain.textContent = st.title || '';
    this.titleSub.textContent = st.sub || '';
    this.titleEl.classList.add('cs-show');
    return this.pause(st.ms ?? 2600).then(() => {
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

  // A spoken or narrated line: show it, voice it (the words follow the voice) or type it,
  // then wait for the reader.
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
    const voice = this.voiceOff ? null : g.voice;
    const rate = this.reduceMotion() ? Infinity : 42 * Math.max(0.5, Number(g.settings?.textSpeed) || 1);
    // A line with a clip holds its words a moment for the voice, so they can pop in as
    // they are spoken; without one (or if it is late) it types itself.
    let expect = null;
    try {
      expect = voice && voice.enabled?.() !== false ? voice.clip?.(speaker, text) || null : null;
    } catch {
      expect = null;
    }
    const typing = { text, shown: 0, rate, done: !Number.isFinite(rate), wait: expect && Number.isFinite(rate) ? CLIP_WAIT_S : 0, words: null, spans: null, next: 0, t0: 0 };
    this.typing = typing;
    if (typing.done) this.textEl.textContent = text;
    const key = stepKey(this.script.id, index, st);
    // The line's own clock (see the top of the file): it moves on at `deadline`, which only
    // a clip that really plays may push later.
    const started = performance.now();
    const minRead = Math.max(400, Number(this.readMs(text, narr)) || 0);
    const readEnd = started + minRead;
    let deadline = readEnd;
    let auto = false;
    let resolveThis = null;
    let timer = null;
    const line = { clip: false, over: false, ended: false, cues: [], timers: [] };
    const advanced = new Promise((resolve) => {
      resolveThis = resolve;
    });
    this.advanceFn = resolveThis;
    const current = () => this.advanceFn === resolveThis && !line.over;
    const arm = () => {
      clearTimeout(timer);
      if (!current()) return;
      timer = setTimeout(() => {
        if (!current()) return;
        if (performance.now() < deadline - 4) return arm();
        auto = true;
        // Never leave a line half-typed on its way out.
        this.finishTyping();
        this.advanceFn = null;
        resolveThis();
      }, Math.max(0, deadline - performance.now()));
    };
    arm();
    // Cues: on a word as it is spoken (or typed), or at a time into the line.
    line.cues = (Array.isArray(st.cues) ? st.cues : []).map((c) => ({ c, fired: false }));
    const fire = (q) => {
      if (q.fired || line.over) return;
      q.fired = true;
      this.cue(q.c);
    };
    const schedule = (timeOf) => {
      for (const t of line.timers) clearTimeout(t);
      line.timers = [];
      for (const q of line.cues) {
        if (q.fired) continue;
        const at = timeOf(q.c);
        if (at == null) continue;
        line.timers.push(setTimeout(() => fire(q), Math.max(0, at * 1000)));
      }
    };
    const tokens = text.split(/\s+/).filter(Boolean);
    const tokenAt = (c) => {
      if (c.word == null) return -1;
      const want = bare(c.word);
      let n = Number(c.nth) || 1;
      for (let i = 0; i < tokens.length; i++) if (bare(tokens[i]) === want && --n <= 0) return i;
      return -1;
    };
    // Unvoiced: as the typing reaches the word.
    const typedTime = (c) => {
      if (Number.isFinite(c.at)) return c.at;
      const i = tokenAt(c);
      if (i < 0) return 0;
      if (!Number.isFinite(rate)) return 0;
      const chars = tokens.slice(0, i).join(' ').length + (i ? 1 : 0);
      return typing.wait + chars / rate;
    };
    if (line.cues.length) schedule(typedTime);
    if (voice && typeof voice.play === 'function') {
      this.preloadAhead(index);
      try {
        const asked = voice.play({
          speaker,
          text,
          key,
          kind: 'cutscene',
          // The clip may arrive no later than the line would have moved on without it.
          maxLatency: minRead / 1000,
          wanted: current,
          onStart: ({ duration, words } = {}) => {
            if (!current()) return;
            line.clip = true;
            const ms = Math.max(0, Number(duration) || 0) * 1000;
            deadline = Math.max(readEnd, performance.now() + ms + CLIP_TAIL_MS);
            arm();
            const w = Array.isArray(words) && words.length ? words : null;
            if (w) {
              this.followVoice(typing, w);
              this.sound?.duckFor(w);
              if (line.cues.length) {
                schedule((c) => {
                  if (Number.isFinite(c.at)) return c.at;
                  const i = tokenAt(c);
                  if (i < 0) return 0;
                  const k = tokens.length === w.length ? i : Math.min(w.length - 1, Math.floor((i * w.length) / tokens.length));
                  return Math.max(0, Number(w[k][1]) || 0);
                });
              }
            }
          },
        });
        Promise.resolve(asked).then(
          (r) => this.voiceResult(r, line, () => {
            if (!current()) return;
            // The clip ended (or was cut): a breath after it, but never before the reading time.
            if (line.clip) {
              if (typing.words) this.finishTyping();
              deadline = Math.max(readEnd, performance.now() + CLIP_TAIL_MS);
              arm();
            } else typing.wait = 0; // no voice after all: type at once
          }),
          () => this.voiceResult({ ok: false, reason: 'failed' }, line),
        );
      } catch {
        this.voiceResult({ ok: false, reason: 'failed' }, line);
      }
    }
    await advanced;
    line.over = true;
    clearTimeout(timer);
    for (const t of line.timers) clearTimeout(t);
    // What a cue would have changed (the bed, the heartbeat, the silence) still changes when
    // the line is tapped past; its one-off sounds are let go.
    for (const q of line.cues) {
      if (q.fired) continue;
      const { sfx, flash, shake, ...state } = q.c;
      if (state.bed != null || state.heart != null || state.hush || state.slam) this.cue(state);
    }
    if (this.advanceFn === resolveThis) this.advanceFn = null;
    // A tap stops the voice at once; a line that moved on by itself stops a clip that is
    // still loading or stuck (it would talk over the next line).
    if (voice && (!auto || !line.ended)) {
      try {
        voice.stop?.();
      } catch {
        /* nothing to stop */
      }
      if (line.clip) this.sound?.unduck();
    }
    this.typing = null;
  }

  // The clip is playing: the words pop in as they are spoken. Words already on screen
  // (the line began to type before a late clip) stay.
  followVoice(typing, words) {
    if (!typing || typing.done || this.typing !== typing) return;
    const tokens = typing.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return;
    const at = tokens.map((_, i) => {
      const k = tokens.length === words.length ? i : Math.min(words.length - 1, Math.floor((i * words.length) / tokens.length));
      return Math.max(0, Number(words[k][1]) || 0);
    });
    for (let i = 1; i < at.length; i++) if (at[i] < at[i - 1]) at[i] = at[i - 1];
    let typed = 0;
    let n = 0;
    for (; n < tokens.length; n++) {
      typed += tokens[n].length + (n ? 1 : 0);
      if (typed > typing.shown) break;
    }
    this.textEl.textContent = '';
    const spans = [];
    tokens.forEach((tok, i) => {
      if (i) this.textEl.append(document.createTextNode ? document.createTextNode(' ') : ' ');
      const sp = el('span', i < n ? 'cw on' : 'cw', tok);
      spans.push(sp);
      this.textEl.append(sp);
    });
    typing.words = at;
    typing.spans = spans;
    typing.next = n;
    typing.t0 = performance.now();
  }

  // Show the whole line at once (a tap, or the line leaving).
  finishTyping() {
    const t = this.typing;
    if (!t || t.done) return;
    t.done = true;
    if (t.spans) {
      for (let i = t.next; i < t.spans.length; i++) t.spans[i].classList.add('on');
      t.next = t.spans.length;
    } else {
      t.shown = t.text.length;
      this.textEl.textContent = t.text;
    }
    this.nextEl.classList.add('cs-ready');
  }

  // Fetch the next couple of lines' clips while this one plays, so they are ready in time.
  preloadAhead(index) {
    const voice = this.game.voice;
    if (!voice?.preload || this.voiceOff) return;
    const steps = this.script?.steps || [];
    const next = [];
    for (let i = index + 1; i < steps.length && next.length < 2; i++) {
      const st = steps[i];
      if (isSpoken(st)) next.push({ speaker: st.narrate != null ? 'narrator' : st.say, text: st.narrate != null ? st.narrate : st.text });
    }
    if (!next.length) return;
    try {
      Promise.resolve(voice.preload(next)).catch(() => {});
    } catch {
      /* a head start only */
    }
  }

  // What the voice layer said about a line's clip. Failures in a row mean the voice files
  // cannot be reached (or decoded): the rest of the scene carries on silently.
  voiceResult(r, line, onEnded) {
    const reason = r?.reason || (r?.ok ? 'done' : 'failed');
    line.ended = true;
    if (r?.ok || reason === 'done') this.voiceFails = 0;
    else if (VOICE_FAILURES.has(reason)) {
      this.voiceFails++;
      if (this.voiceFails >= VOICE_FAILS_OFF) this.voiceOff = true;
    }
    onEnded?.();
  }

  // The player taps: finish the typing first, then move on at once (never waiting for the
  // voice). A tap with no line up cuts a quiet pause short.
  advance() {
    if (!this.active) return;
    if (this.typing && !this.typing.done) {
      this.finishTyping();
      return;
    }
    if (this.advanceFn) {
      const f = this.advanceFn;
      this.advanceFn = null;
      f();
      return;
    }
    const now = performance.now();
    for (const p of [...this.pauses]) if (now - p.from >= PAUSE_TAP_MS) p.finish();
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
    this.pauses.clear();
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

  // A quiet wait (a title card, a held panel, a `wait` step) that a tap may cut short.
  pause(ms) {
    if (this.skipping || !(ms > 0)) return Promise.resolve();
    let entry = null;
    const p = new Promise((resolve) => {
      entry = { from: performance.now(), finish: resolve };
    });
    this.pauses.add(entry);
    return Promise.race([p, this.wait(ms)]).then(() => {
      this.pauses.delete(entry);
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
    this.sound?.stop();
    this.sound = null;
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
    const ty = this.typing;
    if (ty && !ty.done) {
      if (ty.words) {
        // Following the voice: every word whose moment has come.
        const v = this.game.voice;
        const clock = typeof v?.elapsed === 'function' ? v.elapsed() : -1;
        const now = clock >= 0 ? clock : (performance.now() - ty.t0) / 1000;
        while (ty.next < ty.spans.length && ty.words[ty.next] <= now + WORD_LEAD_S) ty.spans[ty.next++].classList.add('on');
        if (ty.next >= ty.spans.length) {
          ty.done = true;
          this.nextEl.classList.add('cs-ready');
        }
      } else if (ty.wait > 0) {
        ty.wait -= dt; // the voice may yet start
      } else {
        ty.shown += dt * ty.rate;
        const n = Math.min(ty.text.length, Math.floor(ty.shown));
        this.textEl.textContent = ty.text.slice(0, n);
        if (n >= ty.text.length) {
          ty.done = true;
          this.nextEl.classList.add('cs-ready');
        }
      }
    }
    // Sound waits for the first tap on a phone: the bed starts as soon as it may.
    const snd = this.sound;
    if (snd?.bedName && !snd.curBed && snd.ready()) snd.bed(snd.bedName);
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
