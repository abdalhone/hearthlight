// Generative music: four moods (title, day, night, combat) written as small
// composers that pick chords and melodies phrase by phrase, scheduled a fraction of
// a second ahead on the WebAudio clock and crossfaded when the mood changes.
// The theory helpers at the top are pure and unit-tested.

import { tone, noise, fm, midiToFreq } from './synth.js';

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// MIDI note of scale step `step` (can be negative or beyond one octave).
export function scaleNote(root, scale, step) {
  const n = scale.length;
  const oct = Math.floor(step / n);
  const idx = ((step % n) + n) % n;
  return root + oct * 12 + scale[idx];
}

// Triad (or seventh) on a scale degree, as MIDI notes, stacked in thirds.
export function chordNotes(root, scale, degree, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(scaleNote(root, scale, degree + i * 2));
  return out;
}

// Is a scale step one of the chord's tones (any octave)?
export function isChordStep(step, degree, scaleLen = 7) {
  const rel = (((step - degree) % scaleLen) + scaleLen) % scaleLen;
  return rel === 0 || rel === 2 || rel === 4;
}

// Next melody step: mostly stepwise, leaning to chord tones on strong beats, and
// pulled back toward the middle of the range so the line never wanders off.
export function nextMelodyStep(prev, degree, strong, rand, lo = 5, hi = 13) {
  const moves = [-2, -1, -1, 0, 1, 1, 2, 3, -3];
  let best = prev;
  let bestScore = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const s = prev + moves[i];
    if (s < lo || s > hi) continue;
    let score = rand() * 1.2;
    if (strong && isChordStep(s, degree)) score += 1.1;
    if (!strong && moves[i] !== 0) score += 0.25;
    score -= Math.abs(s - (lo + hi) / 2) * 0.06;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

const rnd = () => Math.random();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- instruments ----------

function pad(c, out, t, notes, dur, vel = 1, bright = 900) {
  for (const n of notes) {
    const f = midiToFreq(n);
    for (const det of [-7, 6]) {
      tone(c.ctx, out, t, { type: 'sawtooth', freq: f, detune: det, dur, a: Math.min(1.2, dur * 0.35), release: Math.min(1.4, dur * 0.45), gain: 0.022 * vel, filter: { type: 'lowpass', freq: bright, q: 0.4 } });
    }
  }
}

function pluck(c, out, t, note, vel = 1, len = 0.9) {
  const f = midiToFreq(note);
  tone(c.ctx, out, t, { type: 'sawtooth', freq: f, dur: len, a: 0.004, gain: 0.07 * vel, filter: { type: 'lowpass', freq: 3200, to: 520, time: 0.35, q: 1.4 } });
  tone(c.ctx, out, t, { type: 'triangle', freq: f * 2, dur: len * 0.4, a: 0.002, gain: 0.025 * vel });
}

function bell(c, out, t, note, vel = 1, len = 1.6) {
  fm(c.ctx, out, t, { freq: midiToFreq(note), ratio: 3.5, index: 1.3, dur: len, gain: 0.06 * vel, indexDecay: 0.5 });
}

function musicBox(c, out, t, note, vel = 1) {
  fm(c.ctx, out, t, { freq: midiToFreq(note), ratio: 5.0, index: 0.7, dur: 1.4, gain: 0.05 * vel, indexDecay: 0.25 });
}

function bass(c, out, t, note, len, vel = 1) {
  const f = midiToFreq(note);
  tone(c.ctx, out, t, { type: 'triangle', freq: f, dur: len, a: 0.01, release: len * 0.5, gain: 0.11 * vel });
  tone(c.ctx, out, t, { type: 'sine', freq: f / 2, dur: len, a: 0.01, release: len * 0.5, gain: 0.07 * vel });
}

function flute(c, out, t, note, len, vel = 1) {
  const f = midiToFreq(note);
  tone(c.ctx, out, t, { type: 'sine', freq: f, dur: len, a: 0.07, release: Math.min(0.35, len * 0.5), gain: 0.06 * vel, vibrato: { rate: 5.2, cents: 9, delay: 0.25 } });
  tone(c.ctx, out, t, { type: 'triangle', freq: f * 2, dur: len, a: 0.09, release: Math.min(0.3, len * 0.5), gain: 0.008 * vel });
  noise(c.ctx, out, t, c.nb, { dur: 0.09, gain: 0.006 * vel, filter: { type: 'bandpass', freq: f * 2, q: 2 } });
}

function kick(c, out, t, vel = 1) {
  tone(c.ctx, out, t, { type: 'sine', freq: 130, to: 42, slide: 0.16, dur: 0.3, gain: 0.32 * vel });
  noise(c.ctx, out, t, c.nb, { dur: 0.02, gain: 0.05 * vel, filter: { type: 'lowpass', freq: 1800 } });
}

function snare(c, out, t, vel = 1) {
  noise(c.ctx, out, t, c.nb, { dur: 0.16, gain: 0.12 * vel, filter: { type: 'bandpass', freq: 1900, q: 0.8 }, offset: rnd() });
  tone(c.ctx, out, t, { type: 'triangle', freq: 200, to: 150, dur: 0.1, gain: 0.08 * vel });
}

function hat(c, out, t, vel = 1) {
  noise(c.ctx, out, t, c.nb, { dur: 0.035, gain: 0.04 * vel, filter: { type: 'highpass', freq: 7200 }, offset: rnd() });
}

function tom(c, out, t, freq, vel = 1) {
  tone(c.ctx, out, t, { type: 'sine', freq, to: freq * 0.55, dur: 0.28, gain: 0.22 * vel });
  noise(c.ctx, out, t, c.nb, { dur: 0.05, gain: 0.04 * vel, filter: { type: 'lowpass', freq: 1200 } });
}

function stab(c, out, t, notes, vel = 1) {
  for (const n of notes) tone(c.ctx, out, t, { type: 'sawtooth', freq: midiToFreq(n), dur: 0.32, a: 0.008, gain: 0.03 * vel, filter: { type: 'lowpass', freq: 2600, to: 500, time: 0.25, q: 2 } });
}

function shaker(c, out, t, vel = 1) {
  noise(c.ctx, out, t, c.nb, { dur: 0.05, a: 0.01, gain: 0.018 * vel, filter: { type: 'highpass', freq: 6000 }, offset: rnd() });
}

// ---------- composers ----------
// Each composer exposes bpm, stepsPerBar (sixteenth-note steps) and step(c, t, s, bar),
// where c = { ctx, nb, out, wet } and out/wet are this track's own gain nodes.

function phraseComposer({ root, scale, progressions, barsPerChord = 1 }) {
  return {
    prog: pick(progressions),
    chordAt(bar) {
      const p = this.prog;
      const idx = Math.floor(bar / barsPerChord) % p.length;
      return p[idx];
    },
    maybeNewPhrase(bar) {
      if (bar % (this.prog.length * barsPerChord) === 0) this.prog = pick(progressions);
    },
    root,
    scale,
  };
}

function dayTrack() {
  const k = phraseComposer({
    root: 55, // G3
    scale: SCALES.major,
    progressions: [
      [0, 4, 5, 3],
      [0, 3, 0, 4],
      [5, 3, 0, 4],
      [0, 2, 3, 4],
      [3, 0, 1, 4],
    ],
  });
  let mel = 9;
  let melodyOn = false;
  const ARP = [0, 2, 1, 2, 3, 2, 1, 2];
  return {
    bpm: 90,
    stepsPerBar: 16,
    step(c, t, s, bar) {
      if (s === 0) {
        k.maybeNewPhrase(bar);
        if (bar % 8 === 0) melodyOn = rnd() < 0.7;
        const deg = k.chordAt(bar);
        const ch = chordNotes(k.root, k.scale, deg, 3);
        pad(c, c.out, t, ch.map((n) => n + 12), (60 / this.bpm) * 4 + 0.4, 0.9, 1100);
        bass(c, c.out, t, ch[0] - 12, (60 / this.bpm) * 1.8);
      }
      const deg = k.chordAt(bar);
      if (s === 8) bass(c, c.out, t, scaleNote(k.root, k.scale, deg + 4) - 12, (60 / this.bpm) * 1.5, 0.8);
      if (s % 2 === 0) {
        const ch = chordNotes(k.root, k.scale, deg, 3);
        ch.push(ch[0] + 12);
        const i = ARP[(s / 2) % 8];
        if (!(s === 14 && rnd() < 0.3)) pluck(c, c.out, t, ch[i] + 12, s % 4 === 0 ? 1 : 0.7);
      }
      if (s % 4 === 2) shaker(c, c.out, t, 0.8 + rnd() * 0.4);
      if (melodyOn && (s === 0 || s === 8 || (s === 12 && rnd() < 0.4) || (s === 6 && rnd() < 0.25))) {
        mel = nextMelodyStep(mel, deg, s === 0 || s === 8, rnd, 7, 14);
        const len = (60 / this.bpm) * (s === 0 ? 1.6 : 0.9);
        flute(c, c.out, t, scaleNote(k.root, k.scale, mel) + 12, len, 0.9);
        if (rnd() < 0.5) flute(c, c.wet, t, scaleNote(k.root, k.scale, mel) + 12, len, 0.4);
      }
    },
  };
}

function nightTrack() {
  const k = phraseComposer({
    root: 57, // A3
    scale: SCALES.minor,
    progressions: [
      [0, 5, 2, 6],
      [0, 3, 5, 4],
      [5, 3, 0, 6],
    ],
    barsPerChord: 2,
  });
  let mel = 11;
  return {
    bpm: 62,
    stepsPerBar: 12, // 3/4
    step(c, t, s, bar) {
      const deg = k.chordAt(bar);
      const beat = 60 / this.bpm;
      if (s === 0) {
        k.maybeNewPhrase(bar);
        if (bar % 2 === 0) {
          const ch = chordNotes(k.root, k.scale, deg, 3);
          pad(c, c.out, t, ch, beat * 6 + 0.6, 0.85, 700);
          pad(c, c.wet, t, [ch[0] + 12], beat * 6, 0.6, 900);
          bass(c, c.out, t, ch[0] - 12, beat * 5.5, 0.7);
        }
      }
      if (s % 4 === 0 && rnd() < (s === 0 ? 0.85 : 0.55)) {
        mel = nextMelodyStep(mel, deg, s === 0, rnd, 9, 16);
        const n = scaleNote(k.root, k.scale, mel) + 12;
        musicBox(c, c.out, t, n, 0.9);
        musicBox(c, c.wet, t, n, 0.6);
        if (rnd() < 0.2) musicBox(c, c.wet, t + beat * 0.5, scaleNote(k.root, k.scale, mel + 2) + 12, 0.5);
      }
    },
  };
}

function titleTrack() {
  const k = phraseComposer({
    root: 50, // D3
    scale: SCALES.major,
    progressions: [
      [0, 5, 3, 4],
      [0, 4, 5, 3],
      [3, 4, 0, 0],
    ],
    barsPerChord: 2,
  });
  const UP = [0, 1, 2, 3, 4, 3, 2, 1];
  let mel = 9;
  return {
    bpm: 72,
    stepsPerBar: 16,
    step(c, t, s, bar) {
      const deg = k.chordAt(bar);
      const beat = 60 / this.bpm;
      if (s === 0) {
        k.maybeNewPhrase(bar);
        if (bar % 2 === 0) {
          const ch = chordNotes(k.root, k.scale, deg, 3);
          pad(c, c.out, t, ch.map((n) => n + 12), beat * 8 + 0.8, 1, 950);
          bass(c, c.out, t, ch[0] - 12, beat * 7.5, 0.8);
        }
      }
      if (s % 2 === 0) {
        const ch = chordNotes(k.root, k.scale, deg, 3);
        const tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[1] + 24];
        const i = UP[(s / 2) % 8];
        musicBox(c, c.out, t, tones[i], s % 8 === 0 ? 0.85 : 0.55);
      }
      if ((s === 0 || s === 8) && bar % 4 >= 2) {
        mel = nextMelodyStep(mel, deg, s === 0, rnd, 7, 13);
        bell(c, c.wet, t, scaleNote(k.root, k.scale, mel) + 12, 0.8, 2.2);
      }
    },
  };
}

function combatTrack() {
  const k = phraseComposer({
    root: 50, // D3
    scale: SCALES.minor,
    progressions: [
      [0, 5, 6, 0],
      [0, 3, 6, 4],
      [0, 6, 5, 6],
    ],
  });
  const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const KICK2 = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0];
  const BASS = [0, 0, 12, 0, 0, 7, 0, 12];
  let kickPat = KICK;
  return {
    bpm: 132,
    stepsPerBar: 16,
    step(c, t, s, bar) {
      const deg = k.chordAt(bar);
      const ch = chordNotes(k.root, k.scale, deg, 3);
      if (s === 0) {
        k.maybeNewPhrase(bar);
        kickPat = rnd() < 0.35 ? KICK2 : KICK;
        stab(c, c.out, t, ch.map((n) => n + 12), 1);
        stab(c, c.wet, t, [ch[0] + 24], 0.5);
      }
      if (s === 10 && rnd() < 0.5) stab(c, c.out, t, ch.map((n) => n + 12), 0.6);
      if (kickPat[s]) kick(c, c.out, t, s === 0 ? 1 : 0.8);
      if (s === 4 || s === 12) snare(c, c.out, t, 1);
      if (s % 2 === 0) hat(c, c.out, t, s % 4 === 0 ? 1 : 0.6);
      if (s % 2 === 0) bass(c, c.out, t, ch[0] - 12 + BASS[(s / 2) % 8], 0.16, 0.8);
      const lastBar = bar % 4 === 3;
      if (lastBar && s >= 12) tom(c, c.out, t, [220, 180, 150, 120][s - 12], 0.9);
    },
  };
}

export const TRACKS = { title: titleTrack, day: dayTrack, night: nightTrack, combat: combatTrack };

// One playing track: its own gain for crossfades, its own scheduler position.
class TrackInstance {
  constructor(engine, name) {
    const ctx = engine.ctx;
    this.name = name;
    this.composer = TRACKS[name]();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.0001;
    this.wet = ctx.createGain();
    this.wet.gain.value = 1;
    this.gain.connect(engine.musicBus);
    this.wet.connect(engine.reverbIn || engine.musicBus);
    this.c = { ctx, nb: engine.noiseBuffer, out: this.gain, wet: this.wet };
    this.nextTime = ctx.currentTime + 0.08;
    this.stepIndex = 0;
    this.bar = 0;
    this.stopping = false;
    this.stopAt = 0;
  }

  fadeTo(level, seconds, now) {
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.exponentialRampToValueAtTime(Math.max(0.0001, level), now + seconds);
  }

  schedule(now, ahead) {
    if (this.stopping) return;
    const comp = this.composer;
    const stepDur = 60 / comp.bpm / 4;
    // After a stall (hidden tab), skip ahead instead of firing a burst of notes.
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05;
    while (this.nextTime < now + ahead) {
      try {
        comp.step(this.c, this.nextTime, this.stepIndex, this.bar);
      } catch (err) {
        console.warn('[music] step failed', err);
      }
      this.stepIndex++;
      if (this.stepIndex >= comp.stepsPerBar) {
        this.stepIndex = 0;
        this.bar++;
      }
      this.nextTime += stepDur;
    }
  }

  dispose() {
    try {
      this.gain.disconnect();
      this.wet.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

export class MusicPlayer {
  constructor(engine) {
    this.engine = engine;
    this.current = null;
    this.fading = [];
    this.track = 'none';
  }

  set(name, fade = 2.4) {
    if (name === this.track) return;
    this.track = name;
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.current) {
      this.current.fadeTo(0.0001, fade, now);
      this.current.stopping = true;
      this.current.stopAt = now + fade + 1.5;
      this.fading.push(this.current);
      this.current = null;
    }
    if (TRACKS[name]) {
      const inst = new TrackInstance(this.engine, name);
      inst.fadeTo(1, name === 'combat' ? 0.9 : fade, now);
      this.current = inst;
    }
  }

  update() {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.current) this.current.schedule(now, 0.25);
    if (this.fading.length) {
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const f = this.fading[i];
        if (now >= f.stopAt) {
          f.dispose();
          this.fading.splice(i, 1);
        }
      }
    }
  }
}
