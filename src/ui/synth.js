// WebAudio building blocks shared by sound effects and music. Every function
// schedules one short-lived voice on `out` at time `t` and lets it clean itself up
// (stopped sources with no references are collected by the browser).

const MIN = 0.0001;

function envGain(ctx, out, t, attack, peak, dur, release = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(MIN, t);
  g.gain.linearRampToValueAtTime(Math.max(MIN, peak), t + Math.max(0.001, attack));
  if (release > 0) {
    // Hold, then release (pads and sustained notes).
    g.gain.setValueAtTime(Math.max(MIN, peak), t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(MIN, t + Math.max(attack + 0.005, dur));
  }
  g.connect(out);
  return g;
}

function makeFilter(ctx, t, dur, f) {
  const node = ctx.createBiquadFilter();
  node.type = f.type || 'lowpass';
  node.frequency.setValueAtTime(f.freq, t);
  if (f.to) node.frequency.exponentialRampToValueAtTime(Math.max(20, f.to), t + (f.time ?? dur));
  node.Q.value = f.q ?? 0.7;
  return node;
}

// One oscillator voice. o: {type, freq, to, slide, dur, a, gain, detune, filter, release, vibrato}
export function tone(ctx, out, t, o) {
  const dur = o.dur ?? 0.2;
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.slide ?? dur));
  if (o.detune) osc.detune.value = o.detune;
  let lfo = null;
  if (o.vibrato) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate ?? 5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(o.vibrato.cents ?? 8, t + (o.vibrato.delay ?? 0.15));
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = envGain(ctx, out, t, o.a ?? 0.005, o.gain ?? 0.2, dur, o.release ?? 0);
  if (o.filter) {
    const f = makeFilter(ctx, t, dur, o.filter);
    osc.connect(f);
    f.connect(g);
  } else osc.connect(g);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

// Filtered noise burst. o: {dur, a, gain, filter, rate}
export function noise(ctx, out, t, buffer, o) {
  if (!buffer) return null;
  const dur = o.dur ?? 0.1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const g = envGain(ctx, out, t, o.a ?? 0.002, o.gain ?? 0.2, dur, o.release ?? 0);
  if (o.filter) {
    const f = makeFilter(ctx, t, dur, o.filter);
    src.connect(f);
    f.connect(g);
  } else src.connect(g);
  const offset = (o.offset ?? 0) % Math.max(0.01, buffer.duration - 0.01);
  src.start(t, offset);
  src.stop(t + dur + 0.05);
  return src;
}

// Two-operator FM bell / metallic tone. o: {freq, ratio, index, dur, gain, a, indexDecay}
export function fm(ctx, out, t, o) {
  const dur = o.dur ?? 1;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  car.frequency.setValueAtTime(o.freq, t);
  mod.frequency.setValueAtTime(o.freq * (o.ratio ?? 3.5), t);
  const mg = ctx.createGain();
  const idx = (o.index ?? 2) * o.freq;
  mg.gain.setValueAtTime(idx, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.05), t + (o.indexDecay ?? dur * 0.6));
  mod.connect(mg);
  mg.connect(car.frequency);
  const g = envGain(ctx, out, t, o.a ?? 0.003, o.gain ?? 0.15, dur);
  car.connect(g);
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
  return car;
}

export function makeNoiseBuffer(ctx, seconds = 1.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// A soft, warm room: decaying stereo noise with a gentle low-pass tilt.
export function makeImpulse(ctx, seconds = 2.2, decay = 2.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay);
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = lp * env * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
