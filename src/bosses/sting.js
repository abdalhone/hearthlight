// Boss sounds and music stings, synthesized on the game's audio context like every other
// sound (no samples). Stings play on the music bus; effects on the sfx bus. Silent until
// the audio is unlocked by a gesture, and harmless without one (tests, automation).
//
//   sfx.play(name, { volume, pitch })   one of BOSS_SFX
//   sfx.sting('intro' | 'phase' | 'defeat' | 'reveal', bossId)

import { tone, noise, fm, midiToFreq } from '../ui/synth.js';

const R = (a, b) => a + Math.random() * (b - a);

export const BOSS_SFX = {
  boss_slam(S, t, p) {
    S.tone(t, { type: 'sine', freq: 90 * p, to: 32 * p, dur: 0.5, gain: 0.7 });
    S.noise(t, { dur: 0.35, gain: 0.45, filter: { type: 'lowpass', freq: 1400, to: 160 } });
    S.tone(t, { type: 'square', freq: 60 * p, to: 38 * p, dur: 0.18, gain: 0.12, filter: { type: 'lowpass', freq: 500 } });
    S.noise(t + 0.06, { dur: 0.5, gain: 0.08, filter: { type: 'lowpass', freq: 600 }, out: S.wet });
  },
  boss_swing(S, t, p) {
    S.noise(t, { dur: 0.22, gain: 0.42, a: 0.02, filter: { type: 'bandpass', freq: 1600 * p, to: 380 * p, q: 1.3 } });
    S.tone(t, { type: 'triangle', freq: 200 * p, to: 90 * p, dur: 0.16, gain: 0.08 });
  },
  boss_roar(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 120 * p, to: 70 * p, dur: 0.9, a: 0.06, gain: 0.16, filter: { type: 'lowpass', freq: 700, to: 300 }, vibrato: { rate: 18, cents: 80, delay: 0.05 } });
    S.tone(t, { type: 'square', freq: 182 * p, to: 96 * p, dur: 0.8, a: 0.08, gain: 0.06, filter: { type: 'lowpass', freq: 900 } });
    S.noise(t, { dur: 0.9, gain: 0.18, a: 0.05, filter: { type: 'bandpass', freq: 520, q: 0.9 } });
  },
  boss_howl(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 300 * p, to: 640 * p, slide: 0.5, dur: 1.6, a: 0.12, release: 0.8, gain: 0.08, filter: { type: 'bandpass', freq: 900, q: 2 }, vibrato: { rate: 5, cents: 30, delay: 0.3 } });
    S.tone(t, { type: 'sine', freq: 600 * p, to: 1280 * p, slide: 0.5, dur: 1.6, a: 0.12, release: 0.8, gain: 0.07, vibrato: { rate: 5, cents: 25, delay: 0.3 } });
    S.tone(t + 0.1, { type: 'sine', freq: 450 * p, to: 900 * p, slide: 0.6, dur: 1.4, a: 0.2, release: 0.6, gain: 0.05, out: S.wet });
  },
  boss_bite(S, t, p) {
    S.noise(t, { dur: 0.08, gain: 0.4, filter: { type: 'bandpass', freq: 2400 * p, q: 1.5 } });
    S.tone(t, { type: 'square', freq: 220 * p, to: 110 * p, dur: 0.07, gain: 0.1, filter: { type: 'lowpass', freq: 1200 } });
  },
  boss_splash(S, t, p) {
    S.noise(t, { dur: 0.5, gain: 0.35, filter: { type: 'lowpass', freq: 3000, to: 400 } });
    S.tone(t, { type: 'sine', freq: 340 * p, to: 120 * p, dur: 0.3, gain: 0.2 });
    for (let i = 0; i < 4; i++) S.tone(t + 0.05 + i * 0.05, { type: 'sine', freq: R(900, 1600) * p, to: R(400, 700) * p, dur: 0.08, gain: 0.05 });
  },
  boss_hum(S, t, p) {
    S.tone(t, { type: 'sine', freq: 73.4 * p, dur: 2.2, a: 0.5, release: 1.2, gain: 0.22, vibrato: { rate: 3, cents: 12, delay: 0.4 } });
    S.tone(t, { type: 'sine', freq: 110 * p, dur: 2.2, a: 0.6, release: 1.2, gain: 0.12, out: S.wet });
    S.tone(t + 0.2, { type: 'triangle', freq: 146.8 * p, dur: 1.8, a: 0.5, release: 1, gain: 0.05, out: S.wet });
  },
  boss_glob(S, t, p) {
    S.tone(t, { type: 'sine', freq: 180 * p, to: 60 * p, dur: 0.18, gain: 0.3 });
    S.noise(t, { dur: 0.12, gain: 0.2, filter: { type: 'lowpass', freq: 900 } });
  },
  boss_pop(S, t, p) {
    S.tone(t, { type: 'sine', freq: 600 * p, to: 1400 * p, dur: 0.06, gain: 0.2 });
    S.noise(t, { dur: 0.05, gain: 0.15, filter: { type: 'highpass', freq: 2500 } });
  },
  boss_burst(S, t, p) {
    S.noise(t, { dur: 0.4, gain: 0.35, filter: { type: 'lowpass', freq: 2400, to: 300 } });
    S.tone(t, { type: 'sawtooth', freq: 160 * p, to: 50 * p, dur: 0.3, gain: 0.12, filter: { type: 'lowpass', freq: 900 } });
  },
  boss_fire(S, t, p) {
    S.noise(t, { dur: 0.7, gain: 0.3, a: 0.08, filter: { type: 'bandpass', freq: 900 * p, to: 2600 * p, q: 0.8 } });
    S.tone(t, { type: 'sawtooth', freq: 90 * p, to: 180 * p, dur: 0.6, gain: 0.06, filter: { type: 'lowpass', freq: 700 } });
  },
  boss_grave(S, t, p) {
    S.fm(t, { freq: 220 * p, ratio: 1.41, index: 3, dur: 0.9, gain: 0.12 });
    S.tone(t, { type: 'sine', freq: 880 * p, to: 330 * p, dur: 0.6, gain: 0.06, out: S.wet });
    S.noise(t, { dur: 0.4, gain: 0.08, filter: { type: 'highpass', freq: 4000 }, out: S.wet });
  },
  boss_beam(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 160 * p, to: 640 * p, dur: 0.6, gain: 0.08, filter: { type: 'bandpass', freq: 1200, q: 4 } });
    S.fm(t, { freq: 660 * p, ratio: 2.5, index: 2, dur: 0.7, gain: 0.08 });
  },
  boss_rattle(S, t, p) {
    for (let i = 0; i < 6; i++) S.noise(t + i * 0.045, { dur: 0.03, gain: 0.22, filter: { type: 'bandpass', freq: R(1800, 3600) * p, q: 4 } });
  },
  boss_clang(S, t, p) {
    S.fm(t, { freq: 520 * p, ratio: 2.76, index: 4, dur: 0.5, gain: 0.16 });
    S.noise(t, { dur: 0.05, gain: 0.3, filter: { type: 'highpass', freq: 3000 } });
  },
  boss_shield(S, t, p) {
    S.fm(t, { freq: 330 * p, ratio: 1.5, index: 2, dur: 1.2, gain: 0.12, a: 0.1 });
    S.tone(t, { type: 'sine', freq: 660 * p, dur: 1.2, a: 0.2, release: 0.6, gain: 0.06, out: S.wet });
  },
  boss_break(S, t, p) {
    for (let i = 0; i < 5; i++) S.fm(t + i * 0.03, { freq: R(700, 1400) * p, ratio: 2.9, index: 3, dur: 0.4, gain: 0.07 });
    S.noise(t, { dur: 0.3, gain: 0.3, filter: { type: 'highpass', freq: 2000 } });
  },
  boss_down(S, t, p) {
    S.tone(t, { type: 'sine', freq: 120 * p, to: 40 * p, dur: 0.9, gain: 0.5 });
    S.noise(t, { dur: 0.6, gain: 0.25, filter: { type: 'lowpass', freq: 900, to: 120 } });
    S.fm(t + 0.05, { freq: 440 * p, ratio: 1.5, index: 2, dur: 1.2, gain: 0.08, out: S.wet });
  },
  glyph(S, t, p) {
    const notes = [72, 76, 79, 84, 88];
    notes.forEach((m, i) => {
      S.fm(t + i * 0.07, { freq: midiToFreq(m) * p, ratio: 3.01, index: 1.2, dur: 1.1, gain: 0.08 });
      S.tone(t + i * 0.07, { type: 'sine', freq: midiToFreq(m + 12) * p, dur: 0.8, a: 0.02, gain: 0.04, out: S.wet });
    });
    S.noise(t, { dur: 1.2, gain: 0.05, a: 0.2, filter: { type: 'highpass', freq: 6000 }, out: S.wet });
  },
};

// Stings: short phrases on the music bus.
const STINGS = {
  // Two low hits and a minor chord: something big turned to look at you.
  intro(S, t, k) {
    const root = k.root;
    for (const [d, g] of [
      [0, 0.6],
      [0.32, 0.5],
    ]) {
      S.tone(t + d, { type: 'sine', freq: midiToFreq(root - 24), to: midiToFreq(root - 31), dur: 0.5, gain: g });
      S.noise(t + d, { dur: 0.25, gain: 0.25, filter: { type: 'lowpass', freq: 600, to: 120 } });
    }
    for (const m of [0, 3, 7, 12]) S.tone(t + 0.62, { type: 'sawtooth', freq: midiToFreq(root + m - 12), dur: 1.7, a: 0.05, release: 1.2, gain: 0.05, filter: { type: 'lowpass', freq: 1400, to: 500 } });
    S.tone(t + 0.62, { type: 'triangle', freq: midiToFreq(root), dur: 1.8, a: 0.03, release: 1.2, gain: 0.08, out: S.wet });
  },
  // It changed: a rising stab.
  phase(S, t, k) {
    const root = k.root;
    S.noise(t, { dur: 0.6, gain: 0.25, a: 0.25, filter: { type: 'bandpass', freq: 400, to: 3000, q: 0.8 } });
    for (const m of [0, 6, 12]) S.tone(t + 0.45, { type: 'sawtooth', freq: midiToFreq(root + m - 12), dur: 0.8, a: 0.01, release: 0.5, gain: 0.06, filter: { type: 'lowpass', freq: 2000, to: 600 } });
    S.tone(t + 0.45, { type: 'sine', freq: midiToFreq(root - 24), to: midiToFreq(root - 30), dur: 0.6, gain: 0.5 });
  },
  // Beaten: a major arpeggio climbing into light.
  defeat(S, t, k) {
    const root = k.root + 3;
    const seq = [0, 4, 7, 12, 16, 19, 24];
    seq.forEach((m, i) => {
      S.tone(t + i * 0.085, { type: 'triangle', freq: midiToFreq(root + m), dur: 0.9, a: 0.01, gain: 0.08 });
      S.fm(t + i * 0.085, { freq: midiToFreq(root + m + 12), ratio: 3.01, index: 1, dur: 0.6, gain: 0.03, out: S.wet });
    });
    for (const m of [0, 4, 7]) S.tone(t + 0.62, { type: 'sine', freq: midiToFreq(root + m - 12), dur: 2.2, a: 0.1, release: 1.4, gain: 0.07 });
  },
  reveal(S, t, k) {
    const root = k.root + 12;
    for (const [i, m] of [0, 7, 12, 16, 19].entries()) S.fm(t + i * 0.09, { freq: midiToFreq(root + m), ratio: 2.01, index: 1.4, dur: 1.4, gain: 0.06 });
    S.noise(t, { dur: 1.4, gain: 0.04, a: 0.3, filter: { type: 'highpass', freq: 5000 }, out: S.wet });
  },
};

const ROOTS = { varek: 52, greyjaw: 50, mother_of_slimes: 53, lakes_hum: 48, bone_warden: 47 };

export class BossSfx {
  constructor(game) {
    this.game = game;
    this.last = new Map();
  }

  has(name) {
    return !!BOSS_SFX[name];
  }

  bus(music = false) {
    const a = this.game?.audio;
    if (!a || !a.ctx || a.ctx.state === 'closed') return null;
    const out = music ? a.musicBus : a.sfxBus;
    if (!out) return null;
    return a;
  }

  voice(a, out, volume) {
    const ctx = a.ctx;
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(out);
    let wet = g;
    if (a.reverbIn) {
      wet = ctx.createGain();
      wet.gain.value = volume * 0.7;
      wet.connect(a.reverbIn);
    }
    const nb = a.noiseBuffer;
    const S = {
      wet,
      tone: (t, o) => tone(ctx, o.out || g, t, o),
      noise: (t, o) => noise(ctx, o.out || g, t, nb, o),
      fm: (t, o) => fm(ctx, o.out || g, t, o),
    };
    setTimeout(() => {
      try {
        g.disconnect();
        if (wet !== g) wet.disconnect();
      } catch {
        /* gone */
      }
    }, 4000);
    return S;
  }

  play(name, opts = {}) {
    const recipe = BOSS_SFX[name];
    const a = this.bus(false);
    if (!recipe || !a) return;
    const now = a.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < 0.05) return;
    this.last.set(name, now);
    try {
      const S = this.voice(a, a.sfxBus, Math.max(0, Math.min(1.5, opts.volume ?? 1)));
      recipe(S, now + 0.005, opts.pitch > 0 ? opts.pitch : 1);
    } catch (err) {
      console.warn('[bosses] sound failed', name, err);
    }
  }

  sting(name, bossId) {
    const recipe = STINGS[name];
    const a = this.bus(true);
    if (!recipe || !a) return;
    try {
      const S = this.voice(a, a.musicBus, 1);
      recipe(S, a.ctx.currentTime + 0.01, { root: ROOTS[bossId] || 50 });
    } catch (err) {
      console.warn('[bosses] sting failed', name, err);
    }
  }
}
