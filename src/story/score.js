// A small synthesized score for the cutscenes, played on the game's music bus: slow pad
// chords with a music-box line for the prologue, a swell for the turns of the story, and a
// hush for Lyra's memories. Silent until the audio has been unlocked by a gesture.

import { tone, fm, midiToFreq } from '../ui/synth.js';

const CUES = {
  // D minor into F major: old, wide, a little hopeful.
  prologue: { chords: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 57, 60], [48, 55, 60, 64]], bar: 5.2, melody: [74, 72, 69, 72, 77, 76, 72, 69], gain: 1 },
  swell: { chords: [[53, 60, 65, 69], [50, 57, 62, 69], [46, 53, 62, 65], [48, 55, 64, 67]], bar: 4.4, melody: [81, 79, 77, 76, 77, 74, 72, 74], gain: 1.25 },
  memory: { chords: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 55, 59]], bar: 5.8, melody: [76, 74, 72, 71, 72, 69, 67, 69], gain: 0.85 },
  cold: { chords: [[38, 45, 50, 53], [36, 43, 50, 51], [34, 41, 50, 53], [33, 40, 45, 52]], bar: 6.4, melody: [62, 63, 62, 60, 58, 57, 58, 55], gain: 0.8 },
};

export class Score {
  constructor(audio) {
    this.audio = audio;
    this.out = null;
    this.cueName = null;
    this.timer = null;
    this.step = 0;
  }

  ready() {
    const a = this.audio;
    return !!(a && a.ctx && a.musicBus && a.ctx.state !== 'closed');
  }

  cue(name) {
    if (name === 'none' || name === 'stop') {
      this.stop();
      return;
    }
    const spec = CUES[name] || CUES.prologue;
    if (!this.ready()) return;
    const a = this.audio;
    const ctx = a.ctx;
    // The game's own music steps aside while a scene has its score.
    try {
      a.setMusic?.('none');
    } catch {
      /* music is optional */
    }
    const old = this.out;
    if (old) {
      old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.8);
      setTimeout(() => old.disconnect(), 4000);
    }
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.9 * spec.gain, ctx.currentTime + 2.5);
    out.connect(a.musicBus);
    if (a.reverbIn) {
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      out.connect(wet);
      wet.connect(a.reverbIn);
    }
    this.out = out;
    this.spec = spec;
    this.cueName = name;
    this.step = 0;
    clearInterval(this.timer);
    this.next = ctx.currentTime + 0.1;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 400);
  }

  schedule() {
    if (!this.ready() || !this.out) return;
    const ctx = this.audio.ctx;
    const spec = this.spec;
    while (this.next < ctx.currentTime + 1.2) {
      const t = this.next;
      const chord = spec.chords[this.step % spec.chords.length];
      for (const n of chord) {
        for (const det of [-6, 5]) {
          tone(ctx, this.out, t, { type: 'sawtooth', freq: midiToFreq(n), detune: det, dur: spec.bar + 1.2, a: 1.6, release: 1.8, gain: 0.016, filter: { type: 'lowpass', freq: 760, q: 0.3 } });
        }
      }
      tone(ctx, this.out, t, { type: 'sine', freq: midiToFreq(chord[0] - 12), dur: spec.bar + 0.8, a: 1.2, release: 1.4, gain: 0.05 });
      // A music-box phrase over every other chord.
      if (this.step % 2 === 1) {
        const m = spec.melody;
        for (let i = 0; i < 4; i++) {
          const note = m[(this.step * 2 + i) % m.length];
          fm(ctx, this.out, t + 0.4 + i * (spec.bar / 4.5), { freq: midiToFreq(note), ratio: 5.0, index: 0.6, dur: 1.6, gain: 0.04, indexDecay: 0.3 });
        }
      }
      this.next += spec.bar;
      this.step++;
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const a = this.audio;
    if (this.out && this.ready()) {
      const out = this.out;
      out.gain.setTargetAtTime(0.0001, a.ctx.currentTime, 0.6);
      setTimeout(() => {
        try {
          out.disconnect();
        } catch {
          /* gone */
        }
      }, 3500);
    }
    this.out = null;
    if (this.cueName) {
      try {
        a?.setMusic?.(null);
      } catch {
        /* music is optional */
      }
    }
    this.cueName = null;
  }
}
