// Cutscene sound design (DESIGN §20), the author's way: every action gets its own sound,
// timed to the step or to the word that is spoken (footsteps in snow, the litter creaking,
// the stone ring's hum, a candle leaning, gravelight, the Wellstone, a landing, a flash);
// big moments stack several (a sub thump, a crash, a long ring and a braam); under
// everything a quiet bed (wind, a room, a low drone, whispers) so there is never dead air;
// a heartbeat where fear lives; and before the biggest moment, near silence with a thin
// ringing tone, then the sound slammed back in. Every effect ducks while someone speaks
// (the voice always wins). All of it is synthesized here: filtered noise, sine sweeps,
// FM pings. Nothing is downloaded.
//
//   const s = new SceneSound(game.audio, score)
//   s.fx('step_snow')         one effect now (or s.fx(['sub', 'crash']) stacked)
//   s.bed('wind') / s.bed(null)   the quiet layer under the scene (crossfades)
//   s.heart(70) / s.heart(0)  a heartbeat at that many beats a minute, or none
//   s.hush()                  near silence and a thin ring, until…
//   s.slam('big')             …the sound comes back at once with a stacked hit
//   s.duckFor(words)          duck under a clip's words ([[w, start, end]], seconds from now)
//   s.stop()                  the scene is over
//
// Everything is a silent no-op until the game's audio has been unlocked by a gesture.

import { tone, noise, fm } from '../ui/synth.js';

const DUCK = 0.42; // effects under a voice (about -7.5 dB)
const HUSH = 0.03; // the bed and the score in the silence before the slam
const BED = 1.8; // the beds' level: about 25 dB under the voice, quiet but never dead air

const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ one-shots
// Each recipe: (S, t) where S = { tone, noise, fm, out, ctx } and t is the start time.

const RECIPES = {
  step_snow(S, t) {
    const f = rnd(1400, 2400);
    S.noise(t, { dur: 0.11, a: 0.004, gain: 0.16, filter: { type: 'bandpass', freq: f, q: 1.4 } });
    S.noise(t + 0.035, { dur: 0.08, gain: 0.1, filter: { type: 'bandpass', freq: f * 1.6, q: 2 } });
    S.tone(t, { type: 'sine', freq: 95, to: 55, dur: 0.07, gain: 0.07 });
  },
  steps_snow(S, t) {
    for (let i = 0; i < 4; i++) RECIPES.step_snow(S, t + i * rnd(0.48, 0.56));
  },
  step(S, t) {
    S.noise(t, { dur: 0.07, gain: 0.12, filter: { type: 'lowpass', freq: rnd(700, 1000), q: 0.8 } });
    S.tone(t, { type: 'sine', freq: 80, to: 50, dur: 0.06, gain: 0.08 });
  },
  steps(S, t) {
    for (let i = 0; i < 4; i++) RECIPES.step(S, t + i * rnd(0.42, 0.5));
  },
  creak(S, t) {
    const f = rnd(70, 95);
    S.tone(t, { type: 'sawtooth', freq: f, to: f * rnd(1.15, 1.35), dur: 0.55, a: 0.08, gain: 0.05, filter: { type: 'bandpass', freq: 620, q: 9 }, vibrato: { rate: 23, cents: 60, delay: 0.02 } });
    S.noise(t + 0.02, { dur: 0.04, gain: 0.04, filter: { type: 'bandpass', freq: 2500, q: 3 } });
  },
  litter(S, t) {
    // The cloak litter: wood creaking in time with steps in the snow.
    for (let i = 0; i < 3; i++) {
      RECIPES.creak(S, t + i * 0.95);
      RECIPES.step_snow(S, t + i * 0.95 + 0.4);
    }
  },
  snuff(S, t) {
    S.noise(t, { dur: 0.18, a: 0.01, gain: 0.07, filter: { type: 'lowpass', freq: 900, to: 300, q: 0.7 } });
    S.tone(t, { type: 'sine', freq: 420, to: 260, dur: 0.06, gain: 0.015 });
  },
  snuffs(S, t) {
    // Lamps going out one by one.
    for (let i = 0; i < 6; i++) RECIPES.snuff(S, t + i * rnd(0.32, 0.5));
  },
  candle_lean(S, t) {
    S.noise(t, { dur: 1.1, a: 0.35, gain: 0.06, release: 0.6, filter: { type: 'bandpass', freq: 380, to: 1500, q: 1.2, time: 1.0 } });
    for (let i = 0; i < 5; i++) S.noise(t + 0.25 + i * 0.12, { dur: 0.05, gain: 0.025, filter: { type: 'bandpass', freq: rnd(2500, 4000), q: 4 } });
    S.fm(t + 0.3, { freq: 1568, ratio: 2.01, index: 0.4, dur: 1.4, gain: 0.012 });
  },
  stone_hum(S, t) {
    // The old stones that still hum: a cluster that beats against itself.
    for (const [f, g] of [[110, 0.05], [110.9, 0.04], [165, 0.03], [220.6, 0.025]]) S.tone(t, { type: 'sine', freq: f, dur: 3.4, a: 0.7, release: 1.6, gain: g });
    S.fm(t + 0.2, { freq: 880, ratio: 1.5, index: 0.3, dur: 2.6, gain: 0.01, a: 0.6 });
  },
  wellstone(S, t) {
    // The Wellstone hums for the whole square to hear: deep, wide, and singing.
    for (const [f, g] of [[55, 0.14], [110, 0.08], [165.2, 0.045], [220, 0.03], [330.5, 0.015]]) {
      S.tone(t, { type: 'sine', freq: f, dur: 5.2, a: 0.9, release: 2.4, gain: g, vibrato: { rate: 4.2, cents: 6, delay: 1.2 } });
    }
    S.fm(t + 0.6, { freq: 440, ratio: 2, index: 0.5, dur: 3.6, gain: 0.02, a: 1.2 });
  },
  gravelight(S, t) {
    S.tone(t, { type: 'sine', freq: 660, dur: 3.8, a: 1.2, release: 1.8, gain: 0.022, vibrato: { rate: 0.7, cents: 25, delay: 0.5 } });
    S.tone(t, { type: 'sine', freq: 667.5, dur: 3.8, a: 1.4, release: 1.8, gain: 0.018 });
    S.tone(t, { type: 'triangle', freq: 990, dur: 3.2, a: 1.6, release: 1.4, gain: 0.008 });
    S.noise(t, { dur: 3.4, a: 1.2, release: 1.6, gain: 0.03, filter: { type: 'lowpass', freq: 180, q: 0.7 } });
  },
  shimmer(S, t) {
    // Light falling like snow: little high pings and air.
    for (let i = 0; i < 9; i++) S.fm(t + rnd(0, 1.7), { freq: rnd(1700, 3400), ratio: 2.76, index: 0.5, dur: rnd(0.6, 1.1), gain: 0.012 });
    S.noise(t, { dur: 2.2, a: 0.7, release: 1.2, gain: 0.025, filter: { type: 'highpass', freq: 6500, q: 0.5 } });
  },
  flash(S, t) {
    S.noise(t, { dur: 0.4, a: 0.003, gain: 0.16, filter: { type: 'highpass', freq: 2200, to: 700, q: 0.6 } });
    S.tone(t, { type: 'sine', freq: 1900, to: 5200, dur: 0.25, gain: 0.04 });
    S.fm(t + 0.02, { freq: 1760, ratio: 3.01, index: 1.1, dur: 1.2, gain: 0.03 });
  },
  ignite(S, t) {
    S.noise(t, { dur: 0.6, a: 0.05, gain: 0.2, filter: { type: 'lowpass', freq: 200, to: 2600, q: 0.8, time: 0.3 } });
    S.tone(t, { type: 'sine', freq: 70, to: 150, dur: 0.35, gain: 0.12 });
  },
  whoosh(S, t) {
    S.noise(t, { dur: 0.75, a: 0.25, gain: 0.13, release: 0.4, filter: { type: 'bandpass', freq: 300, to: 2600, q: 1.1, time: 0.5 } });
  },
  thump(S, t) {
    S.tone(t, { type: 'sine', freq: 120, to: 40, dur: 0.35, a: 0.003, gain: 0.38 });
    S.noise(t, { dur: 0.18, gain: 0.18, filter: { type: 'lowpass', freq: 380, q: 0.7 } });
  },
  landing(S, t) {
    RECIPES.thump(S, t);
    S.noise(t + 0.02, { dur: 0.5, a: 0.01, gain: 0.08, filter: { type: 'bandpass', freq: 1400, q: 0.8 } });
  },
  crack(S, t) {
    S.noise(t, { dur: 0.05, a: 0.001, gain: 0.32, filter: { type: 'highpass', freq: 1500, q: 0.7 } });
    S.tone(t, { type: 'sine', freq: 1900, to: 380, dur: 0.05, gain: 0.08 });
    for (let i = 0; i < 4; i++) S.noise(t + 0.05 + i * rnd(0.03, 0.08), { dur: 0.025, gain: 0.08, filter: { type: 'highpass', freq: 2500, q: 0.7 } });
  },
  sub(S, t) {
    S.tone(t, { type: 'sine', freq: 56, to: 27, dur: 1.4, a: 0.004, gain: 0.62 });
  },
  crash(S, t) {
    S.noise(t, { dur: 1.8, a: 0.003, gain: 0.26, filter: { type: 'lowpass', freq: 7000, to: 260, q: 0.6, time: 1.6 } });
    S.noise(t, { dur: 0.45, gain: 0.14, filter: { type: 'bandpass', freq: 900, q: 0.9 } });
  },
  ring(S, t) {
    for (const [f, g] of [[523.3, 0.03], [789.6, 0.022], [1059, 0.016], [1571, 0.01]]) S.fm(t, { freq: f, ratio: 1.0, index: 0.15, dur: 4.6, gain: g });
  },
  braam(S, t) {
    for (const f of [36.7, 55, 73.4, 110]) {
      for (const d of [-9, 8]) S.tone(t, { type: 'sawtooth', freq: f, detune: d, dur: 3.2, a: 0.06, release: 2.2, gain: 0.05, filter: { type: 'lowpass', freq: 220, to: 1500, q: 1.2, time: 0.45 } });
    }
  },
  howl(S, t) {
    S.tone(t, { type: 'sine', freq: 380, to: 640, slide: 0.9, dur: 2.6, a: 0.35, release: 1.2, gain: 0.045, vibrato: { rate: 5.5, cents: 30, delay: 0.8 }, filter: { type: 'bandpass', freq: 700, q: 1.2 } });
    S.tone(t + 0.05, { type: 'triangle', freq: 760, to: 1280, slide: 0.9, dur: 2.4, a: 0.4, release: 1.1, gain: 0.012, vibrato: { rate: 5.5, cents: 30, delay: 0.8 } });
  },
  howls(S, t) {
    RECIPES.howl(S, t + 0.8);
    RECIPES.howl(S, t + 2.2);
    RECIPES.howl(S, t + 2.9);
  },
  sword(S, t) {
    S.noise(t, { dur: 0.28, gain: 0.08, filter: { type: 'highpass', freq: 3200, q: 0.7 } });
    S.fm(t + 0.04, { freq: 2093, ratio: 2.76, index: 1.4, dur: 1.5, gain: 0.03 });
  },
  squelch(S, t) {
    S.noise(t, { dur: 0.32, gain: 0.14, filter: { type: 'bandpass', freq: 420, to: 180, q: 6 } });
    S.tone(t, { type: 'sine', freq: 210, to: 110, dur: 0.22, gain: 0.1 });
  },
  bubbles(S, t) {
    for (let i = 0; i < 6; i++) S.tone(t + i * rnd(0.12, 0.3), { type: 'sine', freq: rnd(140, 260), to: rnd(300, 520), dur: 0.08, gain: 0.05 });
  },
  lake_hum(S, t) {
    S.tone(t, { type: 'sine', freq: 49, dur: 5, a: 1.6, release: 2.4, gain: 0.16, vibrato: { rate: 0.4, cents: 18, delay: 0.5 } });
    S.tone(t, { type: 'sine', freq: 98.4, dur: 4.6, a: 1.8, release: 2.2, gain: 0.05 });
  },
  drip(S, t) {
    const f = rnd(1100, 1700);
    S.tone(t, { type: 'sine', freq: f, to: f * 1.6, dur: 0.07, gain: 0.03 });
  },
  rockfall(S, t) {
    RECIPES.crash(S, t);
    RECIPES.sub(S, t);
    for (let i = 0; i < 8; i++) RECIPES.thump(S, t + 0.1 + i * rnd(0.06, 0.15));
  },
  page(S, t) {
    for (let i = 0; i < 3; i++) S.noise(t + i * 0.07, { dur: 0.09, gain: 0.05, filter: { type: 'bandpass', freq: rnd(3000, 5500), q: 1.5 } });
  },
  breath(S, t) {
    S.noise(t, { dur: 1.1, a: 0.4, release: 0.6, gain: 0.03, filter: { type: 'bandpass', freq: 900, q: 0.9 } });
  },
  weave(S, t) {
    // Raw light gathering between the stranger's hands, marks in it for a heartbeat.
    RECIPES.shimmer(S, t);
    S.tone(t, { type: 'sine', freq: 220, to: 880, slide: 1.2, dur: 1.6, a: 0.4, release: 0.6, gain: 0.03 });
    RECIPES.flash(S, t + 1.1);
  },
  // The stack for the biggest moments.
  big(S, t) {
    RECIPES.sub(S, t);
    RECIPES.crash(S, t);
    RECIPES.ring(S, t + 0.02);
    RECIPES.braam(S, t);
  },
};

export const SFX_NAMES = Object.freeze(Object.keys(RECIPES));

// ------------------------------------------------------------------ beds

const BEDS = {
  // Each: (B) where B = { ctx, out, noise(filter), osc(...), every(fn, a, b) } → builds nodes on B.out.
  wind(B) {
    const n = B.loop({ type: 'bandpass', freq: 420, q: 0.7 }, 0.05);
    B.lfo(n.filter.frequency, 0.07, 220);
    B.lfo(n.gain.gain, 0.11, 0.022);
    const hi = B.loop({ type: 'highpass', freq: 2400, q: 0.5 }, 0.006);
    B.lfo(hi.gain.gain, 0.05, 0.004);
  },
  room(B) {
    B.loop({ type: 'lowpass', freq: 380, q: 0.5 }, 0.02);
    // The fire in the grate: a crackle now and then.
    B.every(0.15, 1.1, (S, t) => S.noise(t, { dur: 0.02, gain: rnd(0.015, 0.05), filter: { type: 'bandpass', freq: rnd(1800, 4200), q: 2 } }));
  },
  chapel(B) {
    B.loop({ type: 'lowpass', freq: 300, q: 0.5 }, 0.018);
    B.drone([55, 82.5], 0.012);
    B.every(0.4, 1.6, (S, t) => S.noise(t, { dur: 0.015, gain: rnd(0.01, 0.03), filter: { type: 'bandpass', freq: rnd(2500, 5000), q: 3 } }));
  },
  drone(B) {
    B.drone([55, 82.4, 110.3], 0.02);
    B.loop({ type: 'lowpass', freq: 160, q: 0.7 }, 0.02);
  },
  whispers(B) {
    B.drone([55, 82.4], 0.014);
    for (const f of [520, 1450, 2600]) {
      const n = B.loop({ type: 'bandpass', freq: f, q: 6 }, 0.0);
      B.lfo(n.gain.gain, rnd(0.3, 0.9), 0.012, 0.012);
    }
  },
  cave(B) {
    B.drone([49, 73.5], 0.016);
    B.loop({ type: 'lowpass', freq: 220, q: 0.6 }, 0.022);
    B.every(0.7, 2.4, (S, t) => RECIPES.drip(S, t));
  },
  village(B) {
    const n = B.loop({ type: 'bandpass', freq: 500, q: 0.6 }, 0.014);
    B.lfo(n.gain.gain, 0.09, 0.008);
    B.every(1.2, 4.5, (S, t) => {
      const f = rnd(2400, 3600);
      for (let i = 0; i < 3; i++) S.tone(t + i * 0.09, { type: 'sine', freq: f, to: f * rnd(1.1, 1.4), dur: 0.06, gain: 0.008 });
    });
  },
  lake(B) {
    const n = B.loop({ type: 'lowpass', freq: 300, q: 0.7 }, 0.03);
    B.lfo(n.gain.gain, 0.23, 0.018);
  },
};

export const BED_NAMES = Object.freeze(Object.keys(BEDS));

export class SceneSound {
  constructor(audio, score = null) {
    this.audio = audio;
    this.score = score;
    this.bus = null; // effects and bed, ducked under voices
    this.bedOut = null; // the bed, hushed in the silence
    this.curBed = null;
    this.bedName = null;
    this.heartTimer = null;
    this.bpm = 0;
    this.ringNodes = null;
    this.hushed = false;
    this.timers = new Set();
  }

  ready() {
    const a = this.audio;
    return !!(a && a.ctx && a.unlocked !== false && a.sfxBus && a.ctx.state === 'running');
  }

  _bus() {
    if (this.bus && this.bus.context === this.audio.ctx) return this.bus;
    const ctx = this.audio.ctx;
    this.bus = ctx.createGain();
    this.bus.connect(this.audio.sfxBus);
    if (this.audio.reverbIn) {
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      this.bus.connect(wet);
      wet.connect(this.audio.reverbIn);
    }
    this.bedOut = ctx.createGain();
    this.bedOut.connect(this.bus);
    return this.bus;
  }

  _helpers(out) {
    const ctx = this.audio.ctx;
    const nb = this.audio.noiseBuffer;
    return {
      ctx,
      out,
      tone: (t, o) => tone(ctx, out, t, o),
      noise: (t, o) => noise(ctx, out, t, nb, o),
      fm: (t, o) => fm(ctx, out, t, o),
    };
  }

  // One effect (or several stacked) now, or `delay` seconds from now.
  fx(names, { volume = 1, delay = 0 } = {}) {
    if (!this.ready()) return false;
    const list = Array.isArray(names) ? names : [names];
    const ctx = this.audio.ctx;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(2, volume));
    out.connect(this._bus());
    const S = this._helpers(out);
    const t = ctx.currentTime + 0.01 + Math.max(0, delay);
    let any = false;
    for (const n of list) {
      const r = RECIPES[n];
      if (!r) continue;
      try {
        r(S, t);
        any = true;
      } catch (err) {
        console.warn('[story] sound failed', n, err);
      }
    }
    this._later(() => out.disconnect(), (delay + 7) * 1000);
    return any;
  }

  // The quiet layer under the scene (crossfades over a second or two; null for none).
  bed(name, { level = 1 } = {}) {
    if (name === this.bedName && this.curBed) return;
    this.bedName = name || null;
    if (!this.ready()) return;
    const ctx = this.audio.ctx;
    this._bus();
    const old = this.curBed;
    this.curBed = null;
    if (old) {
      old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
      this._later(() => old.stop(), 3500);
    }
    const build = BEDS[name];
    if (!build) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.setTargetAtTime(Math.max(0, level) * BED, ctx.currentTime, 0.5);
    g.connect(this.bedOut);
    const nodes = [];
    const intervals = [];
    const B = {
      ctx,
      out: g,
      loop: (filter, gain) => {
        const src = ctx.createBufferSource();
        src.buffer = this.audio.noiseBuffer;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = filter.type;
        f.frequency.value = filter.freq;
        f.Q.value = filter.q ?? 0.7;
        const gn = ctx.createGain();
        gn.gain.value = gain;
        src.connect(f);
        f.connect(gn);
        gn.connect(g);
        src.start(ctx.currentTime, Math.random() * 1.2);
        nodes.push(src);
        return { src, filter: f, gain: gn };
      },
      lfo: (param, rate, depth, base = null) => {
        const o = ctx.createOscillator();
        o.frequency.value = rate;
        const d = ctx.createGain();
        d.gain.value = depth;
        o.connect(d);
        d.connect(param);
        if (base != null) param.value = base;
        o.start();
        nodes.push(o);
      },
      drone: (freqs, gain) => {
        for (const f of freqs) {
          for (const det of [-4, 4]) {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = f;
            o.detune.value = det;
            const gn = ctx.createGain();
            gn.gain.value = gain / 2;
            o.connect(gn);
            gn.connect(g);
            o.start();
            nodes.push(o);
          }
        }
      },
      every: (a, b, fn) => {
        const S = this._helpers(g);
        let alive = true;
        const tick = () => {
          if (!alive || !this.ready()) return;
          try {
            fn(S, ctx.currentTime + 0.02);
          } catch {
            /* decoration */
          }
          const id = setTimeout(tick, rnd(a, b) * 1000);
          intervals.push(id);
        };
        const id = setTimeout(tick, rnd(a, b) * 1000);
        intervals.push(id);
        intervals.push({ stop: () => (alive = false) });
      },
    };
    try {
      build(B);
    } catch (err) {
      console.warn('[story] bed failed', name, err);
    }
    this.curBed = {
      gain: g,
      stop: () => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            /* stopped */
          }
        }
        for (const i of intervals) (typeof i === 'object' ? i.stop() : clearTimeout(i));
        try {
          g.disconnect();
        } catch {
          /* gone */
        }
      },
    };
  }

  // A heartbeat where fear lives (0 stops it).
  heart(bpm = 0) {
    this.bpm = Math.max(0, Number(bpm) || 0);
    clearTimeout(this.heartTimer);
    this.heartTimer = null;
    if (!this.bpm) return;
    const beat = () => {
      if (!this.bpm) return;
      if (this.ready() && !this.hushed) {
        const ctx = this.audio.ctx;
        const out = ctx.createGain();
        out.gain.value = 1;
        out.connect(this._bus());
        const S = this._helpers(out);
        const t = ctx.currentTime + 0.01;
        S.tone(t, { type: 'sine', freq: 62, to: 42, dur: 0.17, a: 0.006, gain: 0.5 });
        S.tone(t, { type: 'triangle', freq: 118, to: 60, dur: 0.07, gain: 0.12, filter: { type: 'lowpass', freq: 380 } });
        S.tone(t + 0.21, { type: 'sine', freq: 54, to: 38, dur: 0.19, a: 0.006, gain: 0.36 });
        this._later(() => out.disconnect(), 1500);
      }
      this.heartTimer = setTimeout(beat, 60000 / this.bpm);
    };
    beat();
  }

  // Near silence with a thin ringing tone: the bed, the score and the heartbeat drop away.
  hush() {
    if (this.hushed) return;
    this.hushed = true;
    if (!this.ready()) return;
    const ctx = this.audio.ctx;
    const t = ctx.currentTime;
    this._bus();
    this.bedOut.gain.cancelScheduledValues(t);
    this.bedOut.gain.setTargetAtTime(HUSH, t, 0.12);
    this.score?.hush?.(true);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(0.009, t + 0.15, 0.5);
    g.connect(this.audio.sfxBus); // the ring is not ducked: it is the silence
    const oscs = [2960, 2963.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      return o;
    });
    this.ringNodes = { g, oscs };
  }

  // The sound slammed back in, with a stacked hit.
  slam(names = 'big') {
    const was = this.hushed;
    this.hushed = false;
    if (!this.ready()) return;
    const ctx = this.audio.ctx;
    const t = ctx.currentTime;
    if (this.ringNodes) {
      const { g, oscs } = this.ringNodes;
      this.ringNodes = null;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0.0001, t + 0.005);
      for (const o of oscs) o.stop(t + 0.05);
      this._later(() => g.disconnect(), 300);
    }
    this._bus();
    this.bedOut.gain.cancelScheduledValues(t);
    this.bedOut.gain.setTargetAtTime(1, t, was ? 0.01 : 0.2);
    this.score?.hush?.(false, was ? 0.01 : 0.3);
    if (names) this.fx(names);
  }

  // Effects duck under a clip's words (seconds from now): a sidechain made from the very
  // times the words are spoken.
  duckFor(words, offset = 0) {
    if (!this.ready() || !Array.isArray(words) || !words.length) return;
    const ctx = this.audio.ctx;
    const g = this._bus().gain;
    const t0 = ctx.currentTime + offset;
    const spans = [];
    for (const w of words) {
      const s = Number(w[1]);
      const e = Number(w[2]);
      if (!Number.isFinite(s)) continue;
      const last = spans[spans.length - 1];
      if (last && s - last[1] < 0.35) last[1] = Math.max(last[1], e);
      else spans.push([s, Math.max(s, e)]);
    }
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    for (const [s, e] of spans) {
      g.setTargetAtTime(DUCK, Math.max(ctx.currentTime, t0 + s - 0.06), 0.02);
      g.setTargetAtTime(1, t0 + e + 0.08, 0.14);
    }
  }

  // The voice was cut short: let the effects back up.
  unduck() {
    if (!this.bus || !this.ready()) return;
    const ctx = this.audio.ctx;
    const g = this.bus.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(1, ctx.currentTime, 0.12);
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      try {
        fn();
      } catch {
        /* gone */
      }
    }, ms);
    this.timers.add(id);
  }

  stop() {
    this.heart(0);
    this.bedName = null;
    const ctx = this.audio?.ctx;
    if (this.ringNodes && ctx) {
      for (const o of this.ringNodes.oscs) {
        try {
          o.stop();
        } catch {
          /* stopped */
        }
      }
      this.ringNodes = null;
    }
    this.hushed = false;
    const bed = this.curBed;
    this.curBed = null;
    const bus = this.bus;
    if (bus && ctx) {
      try {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      } catch {
        /* gone */
      }
    }
    setTimeout(() => {
      bed?.stop();
      try {
        bus?.disconnect();
      } catch {
        /* gone */
      }
    }, 2500);
    this.bus = null;
    this.bedOut = null;
  }
}
