import { spatialize } from '../core/audio.js';
import { tone, noise, fm } from '../ui/synth.js';
import { Essences } from './essences.js';
import { reactionLook } from './fx_styles.js';

// The Weave's sounds (DESIGN §22.2: "sound in src/magic/sfx.js (synthesized, per essence
// and shape)"). Every sound is a few WebAudio layers (tones, noise, FM bells, filters)
// built when it plays — no samples. A cast is the shape's motion (a zip, a whoosh, a
// punch, a lob's whistle, a nova's boom) plus each essence's timbre (fire's roar and
// crackle, water's bloop, frost's glass, storm's crack, iron's clang, song's chord…),
// the second essence quieter under the first. Impacts and explosions likewise. Pitch is
// varied on every play (and rapid repeats rotate through small offsets) so a fast volley
// never sounds like one sample machine-gunned. Volume follows the sfx setting (it plays
// through the game's sfx bus), positions pan and fade from the camera like every other
// sound, and live voices are capped so a storm of weaves never drowns the game.

const MAX_VOICES = 10; // the Weave's own voices at once
const GAME_VOICES = 28; // audio.js's budget: leave room for everything else
const ROOM_FOR_OTHERS = 5;
const MAX_LOOPS = 2;

const r = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ essence timbres

// cast: the essence's voice as the weave leaves the hands. (S, t, p, g): S voices,
// t start time, p pitch, g gain scale.
const CAST = {
  arcane(S, t, p, g) {
    S.tone(t, { type: 'sawtooth', freq: 620 * p, to: 1500 * p, dur: 0.18, gain: 0.08 * g, filter: { type: 'bandpass', freq: 1800, q: 3 } });
    S.fm(t, { freq: 980 * p, ratio: 2.01, index: 1.6, dur: 0.25, gain: 0.07 * g, out: S.wet });
  },
  fire(S, t, p, g) {
    S.noise(t, { dur: 0.28, a: 0.012, gain: 0.24 * g, filter: { type: 'lowpass', freq: 2400 * p, to: 450 } });
    S.tone(t, { type: 'sine', freq: 150 * p, to: 70 * p, dur: 0.22, gain: 0.18 * g });
    S.noise(t + r(0.03, 0.08), { dur: 0.04, gain: 0.1 * g, filter: { type: 'highpass', freq: 3200 } });
  },
  water(S, t, p, g) {
    S.tone(t, { type: 'sine', freq: 320 * p, to: 880 * p, dur: 0.12, gain: 0.16 * g });
    S.noise(t, { dur: 0.18, gain: 0.14 * g, filter: { type: 'bandpass', freq: 1300 * p, q: 3 } });
    S.tone(t + 0.07, { type: 'sine', freq: 600 * p, to: 1300 * p, dur: 0.07, gain: 0.08 * g });
  },
  frost(S, t, p, g) {
    S.fm(t, { freq: 1760 * p, ratio: 3.5, index: 1.8, dur: 0.3, gain: 0.08 * g, out: S.wet });
    S.noise(t, { dur: 0.2, gain: 0.07 * g, filter: { type: 'highpass', freq: 6500 } });
    S.tone(t, { type: 'triangle', freq: 2400 * p, to: 3300 * p, dur: 0.12, gain: 0.04 * g });
  },
  storm(S, t, p, g) {
    S.noise(t, { dur: 0.09, gain: 0.3 * g, filter: { type: 'bandpass', freq: 3200 * p, q: 0.9 } });
    S.tone(t, { type: 'square', freq: 95 * p, to: 60 * p, dur: 0.14, gain: 0.07 * g, filter: { type: 'lowpass', freq: 900 } });
    S.tone(t, { type: 'sawtooth', freq: 1400 * p, to: 180 * p, dur: 0.1, gain: 0.06 * g });
  },
  earth(S, t, p, g) {
    S.tone(t, { type: 'sine', freq: 120 * p, to: 48 * p, dur: 0.22, gain: 0.32 * g });
    S.noise(t, { dur: 0.22, gain: 0.2 * g, filter: { type: 'lowpass', freq: 700 * p, to: 200 } });
  },
  wind(S, t, p, g) {
    S.noise(t, { dur: 0.32, a: 0.04, gain: 0.2 * g, filter: { type: 'bandpass', freq: 500 * p, to: 2600 * p, q: 2.2 } });
    S.noise(t + 0.06, { dur: 0.22, gain: 0.1 * g, filter: { type: 'bandpass', freq: 2600 * p, to: 700, q: 3 } });
  },
  nature(S, t, p, g) {
    S.tone(t, { type: 'triangle', freq: 440 * p, to: 360 * p, dur: 0.14, gain: 0.14 * g });
    S.noise(t, { dur: 0.1, gain: 0.1 * g, filter: { type: 'highpass', freq: 4000 } });
    S.tone(t + 0.05, { type: 'sine', freq: 880 * p, dur: 0.1, gain: 0.05 * g, out: S.wet });
  },
  poison(S, t, p, g) {
    S.tone(t, { type: 'sine', freq: 260 * p, to: 520 * p, dur: 0.08, gain: 0.12 * g });
    S.tone(t + 0.06, { type: 'sine', freq: 340 * p, to: 700 * p, dur: 0.08, gain: 0.1 * g });
    S.noise(t, { dur: 0.2, gain: 0.08 * g, filter: { type: 'lowpass', freq: 900 } });
  },
  light(S, t, p, g) {
    S.fm(t, { freq: 1320 * p, ratio: 2.0, index: 1.2, dur: 0.45, gain: 0.08 * g, out: S.wet });
    S.tone(t, { type: 'sine', freq: 2640 * p, dur: 0.3, gain: 0.03 * g });
    S.noise(t, { dur: 0.25, gain: 0.04 * g, filter: { type: 'highpass', freq: 7000 } });
  },
  dark(S, t, p, g) {
    S.tone(t, { type: 'sawtooth', freq: 220 * p, to: 110 * p, dur: 0.32, gain: 0.09 * g, filter: { type: 'lowpass', freq: 1200, to: 300 } });
    S.tone(t, { type: 'sawtooth', freq: 223 * p, to: 111 * p, dur: 0.32, gain: 0.07 * g, filter: { type: 'lowpass', freq: 900 } });
    S.tone(t, { type: 'sine', freq: 60 * p, to: 45 * p, dur: 0.3, gain: 0.15 * g });
  },
  iron(S, t, p, g) {
    S.fm(t, { freq: 900 * p, ratio: 3.73, index: 3, dur: 0.3, gain: 0.1 * g, indexDecay: 0.07, out: S.wet });
    S.noise(t, { dur: 0.06, gain: 0.15 * g, filter: { type: 'highpass', freq: 4000 } });
  },
  song(S, t, p, g) {
    const notes = [523.25, 659.25, 783.99];
    for (let i = 0; i < 3; i++) S.tone(t + i * 0.05, { type: 'triangle', freq: notes[i] * p, dur: 0.22, gain: 0.08 * g });
    S.tone(t, { type: 'sine', freq: 1046.5 * p, dur: 0.3, gain: 0.03 * g, out: S.wet });
  },
};

// hit: the essence landing on something.
const HIT = {
  arcane(S, t, p, g) {
    S.noise(t, { dur: 0.1, gain: 0.2 * g, filter: { type: 'highpass', freq: 3200 } });
    S.tone(t, { type: 'sine', freq: 1300 * p, to: 380 * p, dur: 0.14, gain: 0.14 * g });
  },
  fire(S, t, p, g) {
    S.noise(t, { dur: 0.2, gain: 0.28 * g, filter: { type: 'lowpass', freq: 1800 * p, to: 300 } });
    S.noise(t + 0.05, { dur: 0.04, gain: 0.1 * g, filter: { type: 'highpass', freq: 3000 } });
  },
  water(S, t, p, g) {
    S.noise(t, { dur: 0.14, gain: 0.26 * g, filter: { type: 'bandpass', freq: 1500 * p, q: 2 } });
    S.tone(t, { type: 'sine', freq: 600 * p, to: 200 * p, dur: 0.1, gain: 0.14 * g });
  },
  frost(S, t, p, g) {
    S.fm(t, { freq: 2200 * p, ratio: 3.1, index: 2, dur: 0.18, gain: 0.09 * g });
    S.noise(t, { dur: 0.08, gain: 0.14 * g, filter: { type: 'highpass', freq: 5000 } });
  },
  storm(S, t, p, g) {
    S.noise(t, { dur: 0.07, gain: 0.3 * g, filter: { type: 'bandpass', freq: 3500 * p, q: 1 } });
    S.tone(t, { type: 'square', freq: 120 * p, dur: 0.06, gain: 0.06 * g, filter: { type: 'lowpass', freq: 1500 } });
  },
  earth(S, t, p, g) {
    S.tone(t, { type: 'sine', freq: 140 * p, to: 50 * p, dur: 0.16, gain: 0.4 * g });
    S.noise(t, { dur: 0.1, gain: 0.25 * g, filter: { type: 'lowpass', freq: 900 } });
  },
  wind(S, t, p, g) {
    S.noise(t, { dur: 0.14, gain: 0.2 * g, filter: { type: 'bandpass', freq: 1200 * p, to: 400, q: 1.5 } });
  },
  nature(S, t, p, g) {
    S.tone(t, { type: 'triangle', freq: 300 * p, to: 140 * p, dur: 0.1, gain: 0.2 * g });
    S.noise(t, { dur: 0.06, gain: 0.15 * g, filter: { type: 'bandpass', freq: 2500, q: 1.2 } });
  },
  poison(S, t, p, g) {
    S.noise(t, { dur: 0.16, gain: 0.22 * g, filter: { type: 'lowpass', freq: 700 } });
    S.tone(t, { type: 'sine', freq: 400 * p, to: 150 * p, dur: 0.12, gain: 0.14 * g });
  },
  light(S, t, p, g) {
    S.fm(t, { freq: 1760 * p, ratio: 2, index: 1, dur: 0.25, gain: 0.08 * g, out: S.wet });
    S.noise(t, { dur: 0.06, gain: 0.1 * g, filter: { type: 'highpass', freq: 6000 } });
  },
  dark(S, t, p, g) {
    S.tone(t, { type: 'sine', freq: 180 * p, to: 60 * p, dur: 0.2, gain: 0.25 * g });
    S.noise(t, { dur: 0.12, gain: 0.15 * g, filter: { type: 'lowpass', freq: 500 } });
  },
  iron(S, t, p, g) {
    S.fm(t, { freq: 1250 * p, ratio: 3.73, index: 2.6, dur: 0.25, gain: 0.1 * g, indexDecay: 0.05 });
    S.noise(t, { dur: 0.04, gain: 0.2 * g, filter: { type: 'highpass', freq: 5000 } });
  },
  song(S, t, p, g) {
    S.tone(t, { type: 'triangle', freq: 783.99 * p, dur: 0.14, gain: 0.1 * g });
    S.tone(t + 0.03, { type: 'triangle', freq: 1174.66 * p, dur: 0.12, gain: 0.06 * g, out: S.wet });
  },
};

// shape: the motion of the cast, under the essences.
const SHAPE = {
  bolt(S, t, p) {
    S.tone(t, { type: 'sine', freq: 900 * p, to: 1500 * p, dur: 0.06, gain: 0.04 });
  },
  blast(S, t, p) {
    S.noise(t, { dur: 0.26, a: 0.005, gain: 0.26, filter: { type: 'lowpass', freq: 2600 * p, to: 400 } });
  },
  strike(S, t, p) {
    S.tone(t, { type: 'sine', freq: 170 * p, to: 55 * p, dur: 0.12, gain: 0.4 });
    S.noise(t, { dur: 0.05, gain: 0.25, filter: { type: 'lowpass', freq: 2000 } });
  },
  throw(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 380 * p, to: 820 * p, dur: 0.26, gain: 0.06 });
  },
  beam(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 300 * p, to: 900 * p, dur: 0.2, gain: 0.05, filter: { type: 'bandpass', freq: 1500, q: 2 } });
  },
  nova(S, t, p) {
    S.noise(t, { dur: 0.22, a: 0.12, gain: 0.18, filter: { type: 'bandpass', freq: 300, to: 2400, q: 1.5 } });
    S.tone(t + 0.1, { type: 'sine', freq: 110 * p, to: 40 * p, dur: 0.35, gain: 0.3 });
  },
  orb(S, t, p) {
    S.tone(t, { type: 'sine', freq: 180 * p, dur: 0.45, a: 0.04, gain: 0.1, vibrato: { rate: 7, cents: 30, delay: 0.05 } });
  },
  summon(S, t, p) {
    const n = [392, 523.25, 659.25, 783.99];
    for (let i = 0; i < 4; i++) S.tone(t + i * 0.06, { type: 'triangle', freq: n[i] * p, dur: 0.2, gain: 0.06, out: i === 3 ? S.wet : undefined });
  },
  rune(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 1200 * p, dur: 0.15, gain: 0.06 });
    S.tone(t + 0.07, { type: 'triangle', freq: 1600 * p, dur: 0.2, gain: 0.05, out: S.wet });
    S.noise(t, { dur: 0.2, gain: 0.05, filter: { type: 'bandpass', freq: 3000, q: 4 } });
  },
  rain(S, t) {
    S.noise(t, { dur: 0.9, a: 0.2, gain: 0.18, filter: { type: 'lowpass', freq: 400 } });
  },
  wall(S, t) {
    S.noise(t, { dur: 0.45, a: 0.05, gain: 0.2, filter: { type: 'lowpass', freq: 400, to: 1400 } });
  },
  dash(S, t, p) {
    S.noise(t, { dur: 0.2, gain: 0.25, filter: { type: 'bandpass', freq: 2400 * p, to: 500, q: 1.3 } });
  },
  // A ring thrown: a glassy whistle that rises as it spins away.
  bind(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 1100 * p, to: 1750 * p, dur: 0.14, gain: 0.06 });
    S.fm(t + 0.04, { freq: 1568 * p, ratio: 2, index: 0.6, dur: 0.22, gain: 0.035, out: S.wet });
  },
  // A ward rising: a shimmer swelling into two soft bell tones.
  ward(S, t, p) {
    S.noise(t, { dur: 0.38, a: 0.14, gain: 0.08, filter: { type: 'bandpass', freq: 900, to: 2600, q: 2 } });
    S.tone(t, { type: 'sine', freq: 392 * p, to: 523.25 * p, dur: 0.42, a: 0.09, gain: 0.08, out: S.wet });
    S.tone(t + 0.08, { type: 'sine', freq: 784 * p, dur: 0.38, a: 0.05, gain: 0.045, out: S.wet });
  },
};

// Reactions: a two-note chime over a flavor of what happened.
const REACT = {
  steam(S, t) {
    S.noise(t, { dur: 0.7, a: 0.02, gain: 0.18, filter: { type: 'highpass', freq: 2500 } });
  },
  shatter(S, t, p) {
    for (let i = 0; i < 4; i++) S.fm(t + i * 0.03, { freq: r(2000, 3500) * p, ratio: 3.1, index: 2, dur: 0.2, gain: 0.06 });
    S.noise(t, { dur: 0.12, gain: 0.2, filter: { type: 'highpass', freq: 4000 } });
  },
  skybolt(S, t) {
    S.noise(t, { dur: 0.08, gain: 0.35, filter: { type: 'bandpass', freq: 3000, q: 0.8 } });
    S.noise(t + 0.02, { dur: 1.0, a: 0.02, gain: 0.4, filter: { type: 'lowpass', freq: 900, to: 120 } });
  },
  eclipse(S, t, p) {
    S.tone(t, { type: 'sine', freq: 80 * p, to: 40 * p, dur: 0.8, gain: 0.35 });
    S.fm(t + 0.1, { freq: 2093 * p, ratio: 2, index: 0.8, dur: 0.6, gain: 0.05, out: S.wet });
  },
  bloom(S, t, p) {
    const n = [1046.5, 1318.5, 1568];
    for (let i = 0; i < 3; i++) S.tone(t + i * 0.07, { type: 'sine', freq: n[i] * p, dur: 0.4, a: 0.02, gain: 0.08, out: i === 2 ? S.wet : undefined });
  },
  dirge(S, t, p) {
    const n = [220, 261.63, 329.63];
    for (let i = 0; i < 3; i++) S.tone(t, { type: 'sawtooth', freq: n[i] * p * 0.5, dur: 0.6, a: 0.04, gain: 0.05, filter: { type: 'lowpass', freq: 800 } });
  },
  prism(S, t, p) {
    const n = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
    for (let i = 0; i < n.length; i++) S.tone(t + i * 0.035, { type: 'triangle', freq: n[i] * p, dur: 0.18, gain: 0.05 });
  },
};

// A held beam's drone, by essence: [oscillator type, base frequency, noise filter or null].
const DRONE = {
  arcane: ['sawtooth', 196, null],
  fire: ['sawtooth', 110, { type: 'lowpass', freq: 1200 }],
  water: ['sine', 220, { type: 'bandpass', freq: 1200, q: 2 }],
  frost: ['triangle', 440, { type: 'highpass', freq: 6000 }],
  storm: ['square', 90, { type: 'bandpass', freq: 3200, q: 1 }],
  earth: ['sine', 70, { type: 'lowpass', freq: 500 }],
  wind: ['sine', 160, { type: 'bandpass', freq: 1400, q: 2 }],
  nature: ['triangle', 180, null],
  poison: ['sine', 150, { type: 'lowpass', freq: 800 }],
  light: ['sine', 330, { type: 'highpass', freq: 7000 }],
  dark: ['sawtooth', 82, null],
  iron: ['square', 165, null],
  song: ['triangle', 262, null],
};

function soundOf(essId) {
  const s = Essences.get(essId)?.sound;
  return s && CAST[s] ? s : CAST[essId] ? essId : 'arcane';
}

export class MagicSfx {
  constructor(game) {
    this.game = game;
    this.ends = [];
    this.last = new Map();
    this.loops = new Map();
    this.rr = 0;
    this.played = 0; // for tests and the showcase
    const self = this;
    this.S = {
      ctx: null,
      out: null,
      wet: null,
      nb: null,
      tone(t, o) {
        return tone(self.S.ctx, o.out || self.S.out, t, o);
      },
      noise(t, o) {
        return noise(self.S.ctx, o.out || self.S.out, t, self.S.nb, o);
      },
      fm(t, o) {
        return fm(self.S.ctx, o.out || self.S.out, t, o);
      },
    };
  }

  get ready() {
    const A = this.game.audio;
    return !!(A && A.ctx && A.unlocked && A.sfxBus && A.ctx.state !== 'closed');
  }

  // Is this key allowed to sound again yet? (Rapid repeats of one sound are thinned.)
  _gate(key, gap) {
    const now = this.game.audio?.ctx?.currentTime ?? 0;
    const last = this.last.get(key);
    if (last !== undefined && now - last < gap && now >= last) return false;
    this.last.set(key, now);
    if (this.last.size > 200) this.last.clear();
    return true;
  }

  // Pitch with a little life in it: random, plus a rotating offset for rapid repeats.
  _pitch(base = 1) {
    this.rr = (this.rr + 1) % 3;
    return base * (0.94 + Math.random() * 0.12) * (this.rr === 1 ? 1.05 : this.rr === 2 ? 0.96 : 1);
  }

  // Route one sound and hand back the voice builder (null when it should not play).
  _voice(x, y, volume, dur) {
    if (!this.ready) return null;
    const A = this.game.audio;
    const ctx = A.ctx;
    const now = ctx.currentTime;
    let live = 0;
    for (let i = this.ends.length - 1; i >= 0; i--) {
      if (this.ends[i] < now) this.ends.splice(i, 1);
      else live++;
    }
    if (live >= MAX_VOICES) return null;
    if (Array.isArray(A.voiceEnds)) {
      let all = 0;
      for (let i = 0; i < A.voiceEnds.length; i++) if (A.voiceEnds[i] >= now) all++;
      if (all >= GAME_VOICES - ROOM_FOR_OTHERS) return null;
    }
    let gain = volume;
    let pan = 0;
    const cam = this.game.camera;
    if (Number.isFinite(x) && Number.isFinite(y) && cam) {
      const sp = spatialize(x, y, cam.x + cam.vw / 2, cam.y + cam.vh / 2, cam.vw / 2);
      gain *= sp.gain;
      pan = sp.pan;
    }
    if (gain < 0.02) return null;
    const out = ctx.createGain();
    out.gain.value = gain;
    let head = out;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      head = p;
    }
    head.connect(A.sfxBus);
    let wet = out;
    if (A.reverbIn) {
      wet = ctx.createGain();
      wet.gain.value = gain * 0.7;
      wet.connect(A.reverbIn);
    }
    const end = now + dur;
    this.ends.push(end);
    if (Array.isArray(A.voiceEnds)) A.voiceEnds.push(end);
    setTimeout(
      () => {
        try {
          out.disconnect();
          if (head !== out) head.disconnect();
          if (wet !== out) wet.disconnect();
        } catch {
          /* already gone */
        }
      },
      (dur + 1.6) * 1000,
    );
    const S = this.S;
    S.ctx = ctx;
    S.out = out;
    S.wet = wet;
    S.nb = A.noiseBuffer;
    S.t = now + 0.004;
    this.played++;
    return S;
  }

  // ------------------------------------------------------------------ what plays

  cast(plan, x, y, opts = {}) {
    if (!plan || !this.ready) return;
    const lead = soundOf(plan.essences?.[0] || 'raw');
    if (!this._gate(`c:${plan.shape}:${lead}`, opts.volley ? 0.02 : 0.035)) return;
    const S = this._voice(x, y, (opts.volume ?? 0.75) * (opts.echo ? 0.55 : 1), 0.9);
    if (!S) return;
    const size = plan.size || 1;
    let p = this._pitch((size > 1.3 ? 0.86 : size < 0.8 ? 1.12 : 1) * (opts.pitch || 1));
    if (plan.twists?.includes('swift')) p *= 1.1;
    const t = S.t;
    try {
      (SHAPE[plan.shape] || SHAPE.bolt)(S, t, p);
      const ess = plan.essences || ['raw'];
      for (let i = 0; i < ess.length && i < 3; i++) CAST[soundOf(ess[i])](S, t + i * 0.025, p * (i ? 1.12 : 1), i === 0 ? 1 : i === 1 ? 0.55 : 0.4);
    } catch (err) {
      this._warn(err);
    }
  }

  hit(plan, x, y, opts = {}) {
    if (!plan || !this.ready) return;
    const lead = soundOf(plan.essences?.[0] || 'raw');
    if (!this._gate(`h:${lead}`, opts.tick ? 0.16 : 0.045)) return;
    const S = this._voice(x, y, (opts.tick ? 0.35 : 0.8) * (opts.volume ?? 1), 0.5);
    if (!S) return;
    const p = this._pitch((opts.heavy ? 0.85 : 1) * (opts.pitch || 1));
    try {
      HIT[lead](S, S.t, p, opts.heavy ? 1.3 : 1);
      const second = plan.essences?.[1];
      if (second && !opts.tick) HIT[soundOf(second)](S, S.t + 0.02, p * 1.1, 0.45);
    } catch (err) {
      this._warn(err);
    }
  }

  explode(plan, x, y, radius = 24) {
    if (!plan || !this.ready) return;
    const lead = soundOf(plan.essences?.[0] || 'raw');
    if (!this._gate(`x:${lead}`, 0.06)) return;
    const S = this._voice(x, y, 0.9, 1.2);
    if (!S) return;
    const big = Math.min(1.6, Math.max(0.7, radius / 28));
    const p = this._pitch(1.1 / big);
    const t = S.t;
    try {
      S.tone(t, { type: 'sine', freq: 120 * p, to: 35 * p, dur: 0.45, gain: 0.4 * big });
      S.noise(t, { dur: 0.5, gain: 0.26 * big, filter: { type: 'lowpass', freq: 1400 * p, to: 150 } });
      HIT[lead](S, t, p, 1.2);
    } catch (err) {
      this._warn(err);
    }
  }

  reaction(id, x, y) {
    if (!this.ready || !this._gate(`r:${id}`, 0.12)) return;
    const S = this._voice(x, y, 0.85, 1.3);
    if (!S) return;
    const look = reactionLook(id);
    const p = this._pitch();
    const t = S.t;
    try {
      S.fm(t, { freq: 1046.5 * p, ratio: 2, index: 1.4, dur: 0.32, gain: 0.07, out: S.wet });
      S.fm(t + 0.08, { freq: 1568 * p, ratio: 2, index: 1.2, dur: 0.4, gain: 0.06, out: S.wet });
      const flavor = REACT[look.kind] || (look.kind === 'steam' || look.kind === 'thaw' || look.kind === 'miasma' ? REACT.steam : null);
      if (flavor) flavor(S, t, p);
      else HIT[soundOf(look.ess)](S, t, p * 0.9, 1.3);
    } catch (err) {
      this._warn(err);
    }
  }

  status(id, x, y) {
    if (!this.ready) return;
    const kinds = { frozen: 1, burning: 1, shocked: 1, charmed: 1, rooted: 1 };
    if (!kinds[id] || !this._gate(`s:${id}`, 0.15)) return;
    const S = this._voice(x, y, 0.5, 0.5);
    if (!S) return;
    const p = this._pitch();
    const t = S.t;
    try {
      if (id === 'frozen') {
        S.noise(t, { dur: 0.12, gain: 0.15, filter: { type: 'highpass', freq: 3000 } });
        S.fm(t, { freq: 2600 * p, ratio: 3.1, index: 1.5, dur: 0.25, gain: 0.06 });
      } else if (id === 'burning') S.noise(t, { dur: 0.22, a: 0.02, gain: 0.12, filter: { type: 'lowpass', freq: 1500, to: 600 } });
      else if (id === 'shocked') S.noise(t, { dur: 0.05, gain: 0.14, filter: { type: 'bandpass', freq: 4000, q: 1 } });
      else if (id === 'charmed') S.tone(t, { type: 'sine', freq: 1568 * p, to: 2093 * p, dur: 0.16, gain: 0.05, out: S.wet });
      else if (id === 'rooted') S.tone(t, { type: 'triangle', freq: 220 * p, to: 180 * p, dur: 0.2, gain: 0.08 });
    } catch (err) {
      this._warn(err);
    }
  }

  // Small cues: bounce, block, pulse, armed, fizzle, charge, dash, familiar attacks.
  cue(kind, x, y, plan) {
    if (!this.ready || !this._gate(`q:${kind}`, kind === 'pulse' ? 0.1 : 0.05)) return;
    const S = this._voice(x, y, 0.6, 0.6);
    if (!S) return;
    const p = this._pitch();
    const t = S.t;
    try {
      switch (kind) {
        case 'bounce':
          S.tone(t, { type: 'triangle', freq: 1400 * p, to: 1800 * p, dur: 0.05, gain: 0.07 });
          break;
        case 'block':
          S.fm(t, { freq: 2100 * p, ratio: 3.7, index: 1.5, dur: 0.12, gain: 0.08 });
          break;
        case 'pulse':
          S.tone(t, { type: 'sine', freq: 160 * p, to: 120 * p, dur: 0.2, gain: 0.12 });
          break;
        case 'armed':
          S.fm(t, { freq: 1568 * p, ratio: 2, index: 0.8, dur: 0.3, gain: 0.06, out: S.wet });
          break;
        case 'fizzle':
          S.noise(t, { dur: 0.1, gain: 0.12, filter: { type: 'lowpass', freq: 600 } });
          S.tone(t, { type: 'triangle', freq: 220 * p, to: 140 * p, dur: 0.1, gain: 0.06 });
          break;
        case 'not_ready':
          // A muted wooden knock: not a failure, just "wait".
          S.tone(t, { type: 'triangle', freq: 330 * p, to: 300 * p, dur: 0.06, gain: 0.05 });
          S.tone(t + 0.07, { type: 'triangle', freq: 262 * p, to: 240 * p, dur: 0.07, gain: 0.04 });
          break;
        case 'ready':
          S.tone(t, { type: 'sine', freq: 1568 * p, dur: 0.07, gain: 0.035, out: S.wet });
          break;
        case 'charged':
          S.fm(t, { freq: 2093 * p, ratio: 2, index: 1, dur: 0.4, gain: 0.09, out: S.wet });
          S.tone(t, { type: 'sine', freq: 1046.5 * p, dur: 0.3, gain: 0.05 });
          break;
        case 'dash':
          SHAPE.dash(S, t, p);
          if (plan) CAST[soundOf(plan.essences?.[0] || 'raw')](S, t, p, 0.45);
          break;
        case 'familiar':
          if (plan) HIT[soundOf(plan.essences?.[0] || 'raw')](S, t, p * 1.3, 0.5);
          break;
        case 'split':
          S.tone(t, { type: 'triangle', freq: 1800 * p, to: 2600 * p, dur: 0.06, gain: 0.05 });
          break;
        case 'crit':
          S.fm(t, { freq: 1760 * p, ratio: 2.5, index: 1.5, dur: 0.2, gain: 0.07 });
          S.noise(t, { dur: 0.05, gain: 0.15, filter: { type: 'highpass', freq: 5000 } });
          break;
        // DESIGN §22.5: a ring snapping shut (a click and a falling bell), letting go,
        // a boss shrugging it off; a ward knocked, turning a missile back or aside,
        // thickened, shattering.
        case 'bind':
          S.noise(t, { dur: 0.03, gain: 0.18, filter: { type: 'highpass', freq: 3500 } });
          S.fm(t, { freq: 1568 * p, ratio: 2, index: 1.1, dur: 0.22, gain: 0.07, out: S.wet });
          S.fm(t + 0.09, { freq: 1046.5 * p, ratio: 2, index: 0.9, dur: 0.45, gain: 0.06, out: S.wet });
          if (plan) HIT[soundOf(plan.essences?.[0] || 'raw')](S, t + 0.02, p, 0.45);
          break;
        case 'unbind':
          S.tone(t, { type: 'triangle', freq: 880 * p, to: 1320 * p, dur: 0.16, gain: 0.035, out: S.wet });
          break;
        case 'resist':
          S.tone(t, { type: 'sine', freq: 140 * p, to: 90 * p, dur: 0.16, gain: 0.14 });
          S.tone(t, { type: 'sawtooth', freq: 300 * p, to: 220 * p, dur: 0.12, gain: 0.03, filter: { type: 'lowpass', freq: 900 } });
          break;
        case 'ward_hit':
          S.fm(t, { freq: 2350 * p, ratio: 3.4, index: 1.2, dur: 0.14, gain: 0.055 });
          S.tone(t, { type: 'sine', freq: 230 * p, to: 150 * p, dur: 0.1, gain: 0.1 });
          if (plan) HIT[soundOf(plan.essences?.[0] || 'raw')](S, t + 0.01, p * 1.2, 0.3);
          break;
        case 'reflect':
          S.tone(t, { type: 'triangle', freq: 1800 * p, to: 2700 * p, dur: 0.08, gain: 0.07 });
          S.fm(t + 0.03, { freq: 2637 * p, ratio: 2, index: 0.8, dur: 0.2, gain: 0.04, out: S.wet });
          break;
        case 'deflect':
          S.noise(t, { dur: 0.14, gain: 0.16, filter: { type: 'bandpass', freq: 2800 * p, to: 900, q: 1.4 } });
          break;
        case 'thicken':
          S.tone(t, { type: 'sine', freq: 523.25 * p, to: 659.25 * p, dur: 0.3, a: 0.06, gain: 0.05, out: S.wet });
          break;
        case 'ward_break':
          for (let i = 0; i < 4; i++) S.fm(t + i * 0.025, { freq: r(1800, 3200) * p, ratio: 3.1, index: 2, dur: 0.22, gain: 0.055 });
          S.noise(t, { dur: 0.18, gain: 0.2, filter: { type: 'highpass', freq: 3000 } });
          S.tone(t, { type: 'sine', freq: 160 * p, to: 60 * p, dur: 0.3, gain: 0.2 });
          break;
        default:
          break;
      }
    } catch (err) {
      this._warn(err);
    }
  }

  // ------------------------------------------------------------------ loops

  // A held sound (a pouring beam's drone, a charge swelling) until stopLoop(key).
  // rise: seconds the charge's tone climbs (default the plan's charge time).
  startLoop(key, plan, x, y, kind = 'beam', rise = 0) {
    if (!this.ready || this.loops.has(key) || this.loops.size >= MAX_LOOPS || !plan) return;
    const A = this.game.audio;
    const ctx = A.ctx;
    const now = ctx.currentTime;
    try {
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, now);
      const cam = this.game.camera;
      let gain = 1;
      if (Number.isFinite(x) && cam) gain = spatialize(x, y, cam.x + cam.vw / 2, cam.y + cam.vh / 2, cam.vw / 2).gain;
      const level = (kind === 'charge' ? 0.05 : 0.085) * Math.max(0.15, gain);
      out.gain.linearRampToValueAtTime(level, now + (kind === 'charge' ? 0.3 : 0.06));
      out.connect(A.sfxBus);
      const nodes = [out];
      const lead = soundOf(plan.essences?.[0] || 'raw');
      const [type, f0] = DRONE[lead] || DRONE.arcane;
      const osc = ctx.createOscillator();
      osc.type = kind === 'charge' ? 'sine' : type;
      if (kind === 'charge') {
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(720, now + (rise > 0 ? rise : plan.charge || 1.3));
      } else osc.frequency.setValueAtTime(f0, now);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'charge' ? 3000 : 1600;
      osc.connect(lp);
      // A slow tremolo so the drone breathes.
      const trem = ctx.createGain();
      trem.gain.value = 0.8;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'charge' ? 9 : 6;
      const depth = ctx.createGain();
      depth.gain.value = 0.25;
      lfo.connect(depth);
      depth.connect(trem.gain);
      lp.connect(trem);
      trem.connect(out);
      osc.start(now);
      lfo.start(now);
      nodes.push(osc, lfo, lp, trem, depth);
      const nf = kind === 'beam' ? (DRONE[lead] || DRONE.arcane)[2] : null;
      if (nf && A.noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = A.noiseBuffer;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = nf.type;
        f.frequency.value = nf.freq;
        f.Q.value = nf.q ?? 0.7;
        const ng = ctx.createGain();
        ng.gain.value = 0.6;
        src.connect(f);
        f.connect(ng);
        ng.connect(out);
        src.start(now);
        nodes.push(src, f, ng);
      }
      // A second voice a fifth up for song, an octave for light.
      if (kind === 'beam' && (lead === 'song' || lead === 'light')) {
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f0 * (lead === 'song' ? 1.5 : 2);
        const g2 = ctx.createGain();
        g2.gain.value = 0.4;
        o2.connect(g2);
        g2.connect(out);
        o2.start(now);
        nodes.push(o2, g2);
      }
      this.loops.set(key, { out, nodes, level });
      this.played++;
    } catch (err) {
      this._warn(err);
    }
  }

  stopLoop(key) {
    const L = this.loops.get(key);
    if (!L) return;
    this.loops.delete(key);
    try {
      const ctx = this.game.audio.ctx;
      const now = ctx.currentTime;
      L.out.gain.cancelScheduledValues(now);
      L.out.gain.setValueAtTime(Math.max(0.0001, L.out.gain.value), now);
      L.out.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      for (const n of L.nodes) {
        if (typeof n.stop === 'function') {
          try {
            n.stop(now + 0.15);
          } catch {
            /* already stopped */
          }
        }
      }
      setTimeout(() => {
        for (const n of L.nodes) {
          try {
            n.disconnect();
          } catch {
            /* gone */
          }
        }
      }, 400);
    } catch (err) {
      this._warn(err);
    }
  }

  stopAll() {
    for (const k of [...this.loops.keys()]) this.stopLoop(k);
  }

  _warn(err) {
    if (this._warned) return;
    this._warned = true;
    console.warn('[magic sfx] a sound failed', err);
  }
}
