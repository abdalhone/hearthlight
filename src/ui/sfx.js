// Sound effect recipes. Each is (S, t, p) where S offers tone/noise/fm voices bound
// to the effect's output (already volume- and pan-adjusted), S.wet sends to the
// reverb, t is the start time and p a pitch multiplier. All synthesized, no samples.

const r = (a, b) => a + Math.random() * (b - a);

export const SFX = {
  swing(S, t, p) {
    S.noise(t, { dur: 0.14, gain: 0.32, a: 0.01, filter: { type: 'bandpass', freq: 2600 * p, to: 700 * p, q: 1.6 } });
    S.tone(t, { type: 'triangle', freq: 340 * p, to: 170 * p, dur: 0.1, gain: 0.06 });
  },

  hit(S, t, p) {
    S.tone(t, { type: 'sine', freq: 170 * p, to: 55 * p, dur: 0.16, gain: 0.5 });
    S.noise(t, { dur: 0.06, gain: 0.38, filter: { type: 'lowpass', freq: 3200, to: 600 } });
    S.tone(t, { type: 'square', freq: 95 * p, to: 60 * p, dur: 0.05, gain: 0.08, filter: { type: 'lowpass', freq: 900 } });
  },

  hurt(S, t, p) {
    S.tone(t, { type: 'square', freq: 440 * p, to: 210 * p, dur: 0.16, gain: 0.14, filter: { type: 'lowpass', freq: 1800 } });
    S.tone(t + 0.05, { type: 'sawtooth', freq: 300 * p, to: 140 * p, dur: 0.16, gain: 0.1, filter: { type: 'lowpass', freq: 1200 } });
    S.noise(t, { dur: 0.07, gain: 0.25, filter: { type: 'bandpass', freq: 1400, q: 1 } });
  },

  bolt(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 620 * p, to: 1500 * p, dur: 0.22, gain: 0.1, filter: { type: 'bandpass', freq: 1800, q: 3 } });
    S.fm(t, { freq: 980 * p, ratio: 2.01, index: 1.6, dur: 0.3, gain: 0.1 });
    S.tone(t + 0.02, { type: 'sine', freq: 1500 * p, to: 2700 * p, dur: 0.2, gain: 0.06, out: S.wet });
  },

  bolt_hit(S, t, p) {
    S.noise(t, { dur: 0.14, gain: 0.3, filter: { type: 'highpass', freq: 3200 } });
    S.tone(t, { type: 'sine', freq: 1300 * p, to: 380 * p, dur: 0.18, gain: 0.18 });
    S.fm(t + 0.01, { freq: 1760 * p, ratio: 3.1, index: 1.2, dur: 0.35, gain: 0.06, out: S.wet });
  },

  heal(S, t, p) {
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => {
      S.tone(t + i * 0.07, { type: 'sine', freq: f * p, dur: 0.5, a: 0.02, gain: 0.11 });
      S.tone(t + i * 0.07, { type: 'triangle', freq: f * 2 * p, dur: 0.3, a: 0.02, gain: 0.03, out: S.wet });
    });
    S.noise(t, { dur: 0.6, gain: 0.05, a: 0.1, filter: { type: 'highpass', freq: 6000 }, out: S.wet });
  },

  door_open(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 85 * p, to: 150 * p, dur: 0.38, a: 0.04, gain: 0.08, filter: { type: 'bandpass', freq: 700, q: 6 }, vibrato: { rate: 23, cents: 60, delay: 0.02 } });
    S.noise(t, { dur: 0.05, gain: 0.2, filter: { type: 'lowpass', freq: 500 } });
    S.tone(t + 0.3, { type: 'triangle', freq: 120 * p, to: 80 * p, dur: 0.08, gain: 0.12 });
  },

  door_close(S, t, p) {
    S.tone(t, { type: 'sine', freq: 115 * p, to: 48 * p, dur: 0.18, gain: 0.45 });
    S.noise(t, { dur: 0.09, gain: 0.3, filter: { type: 'lowpass', freq: 700 } });
    S.tone(t + 0.07, { type: 'square', freq: 1600 * p, dur: 0.02, gain: 0.04 });
  },

  pickup(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 880 * p, dur: 0.07, gain: 0.16 });
    S.tone(t + 0.065, { type: 'triangle', freq: 1320 * p, dur: 0.12, gain: 0.16 });
  },

  coin(S, t, p) {
    S.tone(t, { type: 'square', freq: 988 * p, dur: 0.07, gain: 0.08, filter: { type: 'lowpass', freq: 5000 } });
    S.tone(t + 0.07, { type: 'square', freq: 1319 * p, dur: 0.32, gain: 0.08, filter: { type: 'lowpass', freq: 5000 } });
    S.fm(t + 0.07, { freq: 2637 * p, ratio: 2.4, index: 0.6, dur: 0.3, gain: 0.03, out: S.wet });
  },

  chop(S, t, p) {
    S.noise(t, { dur: 0.07, gain: 0.45, filter: { type: 'bandpass', freq: 950 * p, q: 3.5 } });
    S.tone(t, { type: 'triangle', freq: 230 * p, to: 140 * p, dur: 0.09, gain: 0.25 });
    S.noise(t + 0.03, { dur: 0.12, gain: 0.08, filter: { type: 'highpass', freq: 3000 } });
  },

  mine(S, t, p) {
    S.fm(t, { freq: 1650 * p, ratio: 3.73, index: 2.5, dur: 0.32, gain: 0.14, indexDecay: 0.08 });
    S.noise(t, { dur: 0.04, gain: 0.35, filter: { type: 'highpass', freq: 2500 } });
    S.tone(t, { type: 'sine', freq: 260 * p, to: 120 * p, dur: 0.08, gain: 0.2 });
  },

  splash(S, t, p) {
    S.noise(t, { dur: 0.45, gain: 0.32, a: 0.01, filter: { type: 'lowpass', freq: 3800, to: 380 } });
    for (let i = 0; i < 4; i++) {
      const f = r(420, 980) * p;
      S.tone(t + 0.05 + i * r(0.04, 0.09), { type: 'sine', freq: f, to: f * 1.7, dur: 0.06, gain: 0.07 });
    }
  },

  step(S, t, p) {
    S.noise(t, { dur: 0.045, gain: 0.12, filter: { type: 'lowpass', freq: r(500, 800) * p }, offset: r(0, 1) });
  },

  // Footsteps by ground (src/world/footsteps.js).
  step_dirt(S, t, p) {
    S.noise(t, { dur: 0.05, gain: 0.13, filter: { type: 'lowpass', freq: r(520, 820) * p }, offset: r(0, 1) });
    S.noise(t + 0.008, { dur: 0.02, gain: 0.03, filter: { type: 'bandpass', freq: 2600 * p, q: 2 }, offset: r(0, 1) });
  },
  step_grass(S, t, p) {
    // A soft brush of blades, then the heel.
    S.noise(t, { dur: 0.09, gain: 0.06, a: 0.012, filter: { type: 'bandpass', freq: r(2600, 3400) * p, to: 1600 * p, q: 0.9 }, offset: r(0, 1) });
    S.noise(t + 0.01, { dur: 0.04, gain: 0.07, filter: { type: 'lowpass', freq: r(300, 420) * p }, offset: r(0, 1) });
  },
  step_stone(S, t, p) {
    // A hard heel on cobbles: a click and a short knock.
    S.noise(t, { dur: 0.025, gain: 0.1, filter: { type: 'highpass', freq: 2200 * p }, offset: r(0, 1) });
    S.tone(t, { type: 'triangle', freq: r(170, 210) * p, to: 120 * p, dur: 0.05, gain: 0.07 });
  },
  step_wood(S, t, p) {
    // A hollow board.
    S.tone(t, { type: 'triangle', freq: r(230, 270) * p, to: 150 * p, dur: 0.08, gain: 0.08, filter: { type: 'lowpass', freq: 900 } });
    S.noise(t, { dur: 0.04, gain: 0.05, filter: { type: 'bandpass', freq: 1100 * p, q: 1.2 }, offset: r(0, 1) });
  },
  step_water(S, t, p) {
    // Ankle-deep: a slosh and a couple of drops.
    S.noise(t, { dur: 0.16, gain: 0.12, a: 0.01, filter: { type: 'lowpass', freq: 3200 * p, to: 500 }, offset: r(0, 1) });
    for (let i = 0; i < 2; i++) {
      const f = r(520, 900) * p;
      S.tone(t + 0.04 + i * r(0.03, 0.06), { type: 'sine', freq: f, to: f * 1.6, dur: 0.05, gain: 0.04 });
    }
  },
  step_sand(S, t, p) {
    S.noise(t, { dur: 0.08, gain: 0.07, a: 0.01, filter: { type: 'lowpass', freq: r(1300, 1700) * p }, offset: r(0, 1) });
  },
  step_snow(S, t, p) {
    // Packed snow: a squeaky crunch of tiny grains.
    S.noise(t, { dur: 0.1, gain: 0.07, a: 0.008, filter: { type: 'bandpass', freq: r(1500, 1900) * p, q: 2.5 }, offset: r(0, 1) });
    for (let i = 0; i < 4; i++) S.noise(t + 0.012 + i * r(0.012, 0.02), { dur: 0.012, gain: 0.05, filter: { type: 'highpass', freq: 3000 * p }, offset: r(0, 1) });
  },

  levelup(S, t, p) {
    const notes = [783.99, 987.77, 1174.66, 1567.98];
    notes.forEach((f, i) => S.tone(t + i * 0.09, { type: 'triangle', freq: f * p, dur: 0.32, gain: 0.13 }));
    [392, 493.88, 587.33].forEach((f) => S.tone(t + 0.36, { type: 'sawtooth', freq: f * p, dur: 0.9, a: 0.05, release: 0.6, gain: 0.04, filter: { type: 'lowpass', freq: 2200 } }));
    S.fm(t + 0.36, { freq: 3135.96 * p, ratio: 2, index: 0.8, dur: 0.9, gain: 0.04, out: S.wet });
  },

  ui_click(S, t, p) {
    S.tone(t, { type: 'square', freq: 1750 * p, dur: 0.025, gain: 0.05, filter: { type: 'lowpass', freq: 4000 } });
  },

  ui_open(S, t, p) {
    S.tone(t, { type: 'sine', freq: 520 * p, to: 790 * p, dur: 0.1, gain: 0.12 });
    S.tone(t + 0.05, { type: 'triangle', freq: 1040 * p, dur: 0.12, gain: 0.05, out: S.wet });
    S.noise(t, { dur: 0.08, gain: 0.04, filter: { type: 'bandpass', freq: 3000, q: 1 } });
  },

  ui_close(S, t, p) {
    S.tone(t, { type: 'sine', freq: 790 * p, to: 500 * p, dur: 0.1, gain: 0.11 });
    S.noise(t, { dur: 0.06, gain: 0.03, filter: { type: 'bandpass', freq: 2200, q: 1 } });
  },

  talk_blip(S, t, p) {
    S.tone(t, { type: 'square', freq: 520 * p * r(0.96, 1.04), dur: 0.035, gain: 0.045, filter: { type: 'lowpass', freq: 2400 } });
  },

  death(S, t, p) {
    S.tone(t, { type: 'sawtooth', freq: 420 * p, to: 55 * p, dur: 0.55, gain: 0.14, filter: { type: 'lowpass', freq: 2400, to: 200 } });
    S.noise(t, { dur: 0.3, gain: 0.2, filter: { type: 'lowpass', freq: 1500, to: 200 } });
    S.tone(t + 0.1, { type: 'sine', freq: 90 * p, to: 40 * p, dur: 0.4, gain: 0.3 });
  },

  bow(S, t, p) {
    S.tone(t, { type: 'triangle', freq: 190 * p, to: 150 * p, dur: 0.22, gain: 0.25 });
    S.noise(t, { dur: 0.05, gain: 0.25, filter: { type: 'highpass', freq: 2500 } });
    S.noise(t + 0.02, { dur: 0.16, gain: 0.1, filter: { type: 'bandpass', freq: 1800, to: 900, q: 2 } });
  },

  dodge(S, t, p) {
    S.noise(t, { dur: 0.2, gain: 0.28, a: 0.03, filter: { type: 'bandpass', freq: 600 * p, to: 2600 * p, q: 1.2 } });
    S.tone(t, { type: 'sine', freq: 200 * p, to: 420 * p, dur: 0.12, gain: 0.05 });
  },

  eat(S, t, p) {
    for (let i = 0; i < 3; i++) S.noise(t + i * 0.1, { dur: 0.06, gain: 0.26, filter: { type: 'bandpass', freq: r(1300, 1900) * p, q: 2.5 }, offset: r(0, 1) });
    S.tone(t + 0.32, { type: 'sine', freq: 520 * p, to: 700 * p, dur: 0.12, gain: 0.07 });
  },

  quest(S, t, p) {
    S.fm(t, { freq: 1174.66 * p, ratio: 3.5, index: 1.4, dur: 1.3, gain: 0.11 });
    S.fm(t + 0.16, { freq: 1760 * p, ratio: 3.5, index: 1.2, dur: 1.4, gain: 0.1 });
    S.fm(t + 0.16, { freq: 1760 * p, ratio: 3.5, index: 1.2, dur: 1.8, gain: 0.06, out: S.wet });
    [587.33, 880, 1108.73].forEach((f) => S.tone(t + 0.1, { type: 'sine', freq: f * p, dur: 1.6, a: 0.25, release: 1, gain: 0.04, out: S.wet }));
  },

  downed(S, t, p) {
    S.tone(t, { type: 'sine', freq: 320 * p, to: 75 * p, dur: 0.85, gain: 0.26 });
    S.tone(t, { type: 'triangle', freq: 330 * p, to: 80 * p, dur: 0.85, detune: 18, gain: 0.08 });
    S.noise(t + 0.55, { dur: 0.15, gain: 0.25, filter: { type: 'lowpass', freq: 400 } });
  },

  revive(S, t, p) {
    S.tone(t, { type: 'sine', freq: 300 * p, to: 900 * p, dur: 0.65, a: 0.05, gain: 0.14 });
    [659.25, 987.77, 1318.5].forEach((f, i) => S.tone(t + 0.25 + i * 0.08, { type: 'triangle', freq: f * p, dur: 0.45, gain: 0.08, out: S.wet }));
    S.noise(t, { dur: 0.7, a: 0.2, gain: 0.05, filter: { type: 'highpass', freq: 5000 }, out: S.wet });
  },

  sleep(S, t, p) {
    [1318.5, 1046.5, 880, 659.25].forEach((f, i) => {
      S.fm(t + i * 0.32, { freq: f * p, ratio: 4.0, index: 0.9, dur: 1.4, gain: 0.08 });
      S.fm(t + i * 0.32, { freq: f * p, ratio: 4.0, index: 0.9, dur: 1.6, gain: 0.04, out: S.wet });
    });
  },

  error(S, t, p) {
    S.tone(t, { type: 'square', freq: 150 * p, dur: 0.08, gain: 0.08, filter: { type: 'lowpass', freq: 1200 } });
    S.tone(t + 0.11, { type: 'square', freq: 120 * p, dur: 0.12, gain: 0.08, filter: { type: 'lowpass', freq: 1000 } });
  },

  magic(S, t, p) {
    const scale = [1046.5, 1174.66, 1318.5, 1568, 1760, 2093];
    for (let i = 0; i < 7; i++) {
      const f = scale[Math.floor(Math.random() * scale.length)] * p;
      S.tone(t + i * 0.055, { type: 'sine', freq: f, dur: 0.22, gain: 0.07, out: i % 2 ? S.wet : undefined });
    }
    S.noise(t, { dur: 0.5, a: 0.08, gain: 0.04, filter: { type: 'highpass', freq: 6500 }, out: S.wet });
  },

  // The chapel bell (DESIGN §29: a death, a funeral): one slow stroke, a bell's uneven
  // partials ringing out into the reverb.
  bell(S, t, p) {
    const f = 196 * p;
    for (const [k, g, d] of [[1, 0.2, 3.2], [2.0, 0.09, 2.4], [2.4, 0.07, 2.0], [3.0, 0.05, 1.6], [4.07, 0.03, 1.1], [0.5, 0.08, 3.6]]) {
      S.tone(t, { type: 'sine', freq: f * k, dur: d, a: 0.004, gain: g });
      S.tone(t + 0.01, { type: 'sine', freq: f * k * 1.003, dur: d * 0.8, a: 0.01, gain: g * 0.5, out: S.wet });
    }
    S.noise(t, { dur: 0.05, gain: 0.12, filter: { type: 'bandpass', freq: 2400 * p, q: 2 } });
  },
};

export const SFX_NAMES = Object.keys(SFX);

// Minimum seconds between two plays of the same effect (stops stacking into a roar).
export const SFX_GAP = { step: 0.07, step_dirt: 0.06, step_grass: 0.06, step_stone: 0.06, step_wood: 0.06, step_water: 0.06, step_sand: 0.06, step_snow: 0.06, talk_blip: 0.045, ui_click: 0.03, hit: 0.03, coin: 0.05, pickup: 0.04 };
