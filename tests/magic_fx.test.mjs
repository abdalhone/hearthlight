import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, resetArena, AIM } from './magic_helpers.mjs';
import { Shapes } from '../src/magic/shapes.js';
import { Essences } from '../src/magic/essences.js';
import { Twists } from '../src/magic/twists.js';
import { Statuses, REACTIONS } from '../src/magic/status.js';
import { MagicFx } from '../src/magic/fx.js';
import { planLook, LOOKS, STATUS_LOOKS, REACTION_LOOKS } from '../src/magic/fx_styles.js';
import { FxParticles, PARTICLE_STYLES as STYLE_NAMES } from '../src/magic/fx_particles.js';
import { RNG } from '../src/core/rng.js';

// DESIGN §22.2 / r4/fx: the look and sound of the Weave never throws, for any body,
// essence, twist, status or reaction. Every draw call goes to a checking canvas that
// fails on a non-finite number (a NaN coordinate is an invisible bug on a real canvas),
// every sound to a checking WebAudio graph that fails the way a browser does on a
// non-finite parameter, and the fx layer's own try/catch guards must stay silent.

// ------------------------------------------------------------------ checking canvas

const calls = { n: 0, byName: new Map() };

function bad(name, args) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'number' && !Number.isFinite(v)) return `${name}(${args.map(String).join(', ')})`;
  }
  return null;
}

function makeCtx(canvas) {
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, imageSmoothingEnabled: false, font: '8px sans', textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter', filter: 'none' };
  const stack = [];
  const gradient = { addColorStop(o, c) {
    if (!Number.isFinite(o) || o < 0 || o > 1) throw new Error(`addColorStop(${o}, ${c})`);
  } };
  const methods = {
    save() {
      stack.push({ ...state });
    },
    restore() {
      const s = stack.pop();
      if (s) Object.assign(state, s);
    },
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    measureText: (s) => ({ width: String(s).length * 4 }),
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in methods) return methods[prop];
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return (...args) => {
        calls.n++;
        calls.byName.set(prop, (calls.byName.get(prop) || 0) + 1);
        const b = bad(prop, args);
        if (b) throw new Error(`canvas ${b}`);
        if (prop === 'drawImage' && args[0] && args[0].width === 0) throw new Error('drawImage of an empty canvas');
        return undefined;
      };
    },
    set(target, prop, value) {
      if ((prop === 'globalAlpha' || prop === 'lineWidth') && !Number.isFinite(value)) throw new Error(`canvas ${prop} = ${value}`);
      if ((prop === 'fillStyle' || prop === 'strokeStyle') && (value == null || value === '' || /NaN|undefined/.test(String(value)))) throw new Error(`canvas ${prop} = ${value}`);
      target[prop] = value;
      return true;
    },
  });
  return ctx;
}

function makeCanvasEl(w = 1, h = 1) {
  const c = { width: w, height: h, style: {} };
  let ctx = null;
  c.getContext = () => (ctx ||= makeCtx(c));
  return c;
}

globalThis.document ??= { createElement: (tag) => (tag === 'canvas' ? makeCanvasEl() : {}) };

// ------------------------------------------------------------------ checking audio

function param(v = 0) {
  const chk = (name, ...a) => {
    for (const x of a) if (typeof x === 'number' && !Number.isFinite(x)) throw new TypeError(`AudioParam.${name}: non-finite ${a}`);
  };
  return {
    value: v,
    setValueAtTime(x, t) {
      chk('setValueAtTime', x, t);
    },
    linearRampToValueAtTime(x, t) {
      chk('linearRamp', x, t);
    },
    exponentialRampToValueAtTime(x, t) {
      chk('exponentialRamp', x, t);
      if (x <= 0) throw new RangeError('exponentialRamp to a value <= 0');
    },
    setTargetAtTime(x, t, c) {
      chk('setTarget', x, t, c);
    },
    cancelScheduledValues() {},
  };
}

function node(extra = {}) {
  return { connect: () => {}, disconnect: () => {}, start() {}, stop() {}, ...extra };
}

let audioNodes = 0;
function makeAudioCtx() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: node(),
    createGain: () => (audioNodes++, node({ gain: param(1) })),
    createOscillator: () => (audioNodes++, node({ type: 'sine', frequency: param(440), detune: param(0) })),
    createBiquadFilter: () => (audioNodes++, node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) })),
    createStereoPanner: () => (audioNodes++, node({ pan: param(0) })),
    createBufferSource: () => (audioNodes++, node({ buffer: null, loop: false, playbackRate: param(1) })),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return ctx;
}

// ------------------------------------------------------------------ the arena with fx

function fxArena(opts = {}) {
  const g = makeGame({ foes: 6, ...opts });
  g.magic.unlockAll();
  g.renderer = { frame: 0, scale: 2, subX: 0, subY: 0 };
  g.lighting = { flash() {}, ambient: { darkness: 0.8 } };
  g.atlas = null;
  const actx = makeAudioCtx();
  g.audio = { ctx: actx, unlocked: true, sfxBus: node(), reverbIn: node(), noiseBuffer: {}, voiceEnds: [], play() {} };
  const fx = new MagicFx(g);
  g.magicFx = fx;
  const warnings = [];
  fx.warn = (what, err) => warnings.push(`fx ${what}: ${err?.stack || err}`);
  g.magic.warn = (what, err) => warnings.push(`magic ${what}: ${err?.stack || err}`);
  fx.sound._warn = (err) => warnings.push(`sfx: ${err?.stack || err}`);
  g.fxWarnings = warnings;
  g.screen = makeCanvasEl(480, 270).getContext('2d');
  g.final = makeCanvasEl(960, 540).getContext('2d');
  return g;
}

// One rendered frame the way the renderer runs it: ground under actors, the layer over
// them, lights, then the glow pass.
function drawFrame(g) {
  const fx = g.magicFx;
  const m = g.magic;
  const ctx = g.screen;
  g.renderer.frame++;
  const ox = g.camera.x;
  const oy = g.camera.y;
  m.layer.drawShadow(ctx, ox, oy, g.time);
  m.layer.draw(ctx, ox, oy, g.time);
  const lights = m.layer.getLight(g.time);
  assert.ok(Array.isArray(lights), 'lights are a list');
  for (const l of lights) {
    for (const k of ['x', 'y', 'r', 'intensity']) if (!Number.isFinite(l[k])) assert.fail(`light ${k} = ${l[k]}`);
    assert.equal(typeof l.color, 'string');
  }
  fx.drawGlow(g.final, g.renderer);
  if (g.audio.ctx) g.audio.ctx.currentTime = g.time;
}

function exercise(g, weave, label, seconds = 2.2) {
  resetArena(g);
  g.magicFx.parts.clear?.();
  g.magicFx.effects.clear?.();
  const m = g.magic;
  const plan = m.compile(weave);
  assert.ok(plan.ok, `${label}: ${plan.reason}`);
  if (plan.input === 'tap') m.cast(g.player, weave, AIM, { free: true });
  else m.castStart(g.player, weave, AIM, { free: true });
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    if (plan.input !== 'tap') {
      if (i < 45) m.castHold(g.player, AIM);
      else if (i === 45) m.castRelease(g.player, AIM);
    }
    step(g);
    if (i % 3 === 0) drawFrame(g);
  }
  if (g.fxWarnings.length) assert.fail(`${label}: ${g.fxWarnings.join('\n')}`);
}

// ------------------------------------------------------------------ tests

test('every essence has a look; every status overlay and reaction a flourish', () => {
  for (const id of Essences.ids()) {
    const L = planLook({ essences: [id] });
    assert.ok(L.pal.core && L.pal.glow && L.pal.spark && L.pal.deep, `${id} palette`);
    assert.ok(LOOKS[id], `${id} has its own look`);
    for (const t of L.trail) assert.ok(STYLE_NAMES.includes(t.style), `${id} trail style ${t.style}`);
    for (const t of L.debris) assert.ok(STYLE_NAMES.includes(t.style), `${id} debris style ${t.style}`);
  }
  for (const def of Statuses.list()) if (def.overlay) assert.ok(STATUS_LOOKS[def.overlay], `status ${def.id} overlay ${def.overlay}`);
  for (const r of REACTIONS) assert.ok(REACTION_LOOKS[r.id], `reaction ${r.id}`);
  // Blends differ: fire + dark is not fire + light.
  const fd = planLook({ essences: ['fire', 'dark'] });
  const fl = planLook({ essences: ['fire', 'light'] });
  assert.notEqual(fd.accent, fl.accent);
  assert.notDeepEqual(
    fd.trail.map((t) => t.style),
    fl.trail.map((t) => t.style),
  );
});

test('every shape x every essence draws and sounds without a fault', () => {
  const g = fxArena();
  let n = 0;
  for (const shape of Shapes.ids()) {
    for (const ess of Essences.ids()) {
      exercise(g, { shape, essences: [ess], twists: [] }, `${shape}/${ess}`, 1.6);
      n++;
    }
  }
  assert.ok(n >= 12 * 13);
  assert.ok(calls.n > 10000, `drew ${calls.n} calls`);
  assert.ok(g.magicFx.sound.played > 100, `played ${g.magicFx.sound.played} sounds`);
});

test('every shape x every twist (with a pair of essences) draws without a fault', () => {
  const g = fxArena();
  const ess = Essences.ids();
  let i = 0;
  for (const shape of Shapes.ids()) {
    for (const tw of Twists.ids()) {
      const w = { shape, essences: [ess[i % ess.length], ess[(i * 5 + 3) % ess.length]], twists: [tw] };
      if (w.essences[0] === w.essences[1]) w.essences.pop();
      i++;
      const plan = g.magic.compile(w);
      if (!plan.ok) continue;
      exercise(g, w, `${shape}/${w.essences}/${tw}`, 1.4);
    }
  }
});

test('a deterministic sample of triples and blends draws without a fault', () => {
  const g = fxArena();
  const rng = new RNG(4242);
  const shapes = Shapes.ids();
  const ess = Essences.ids();
  const tws = Twists.ids();
  const pick = (a) => a[Math.floor(rng.next() * a.length)];
  let done = 0;
  for (let k = 0; k < 160 && done < 70; k++) {
    const es = [...new Set([pick(ess), pick(ess), pick(ess)])];
    const ts = [...new Set([pick(tws), pick(tws), pick(tws)])];
    const w = { shape: pick(shapes), essences: es, twists: ts };
    const plan = g.magic.compile(w);
    if (!plan.ok) continue;
    exercise(g, w, `${w.shape}/${es}/${ts}`, 1.4);
    done++;
  }
  assert.ok(done >= 40, `ran ${done} triples`);
});

test('every status on actors and every reaction flourish draws without a fault', () => {
  const g = fxArena();
  const m = g.magic;
  const foes = g.foes;
  const ids = Statuses.ids();
  // Each status alone, then all of them stacked on one foe.
  ids.forEach((id, i) => m.applyStatus(foes[i % foes.length], id, { src: g.player, potency: 1, power: 5, duration: 3, ignoreImmunity: true, chance: 99 }));
  for (const id of ids) m.applyStatus(g.player, id, { src: foes[0], potency: 1, power: 0, duration: 2, ignoreImmunity: true, chance: 99 });
  for (let i = 0; i < 150; i++) {
    step(g);
    if (i % 2 === 0) drawFrame(g);
  }
  // Every reaction's flourish, at a foe and in empty air.
  for (const r of REACTIONS) {
    g.magicFx.onEvent('reaction', { id: r.id, name: r.name, x: foes[1].x, y: foes[1].y, target: foes[1], source: g.player }, m);
    g.magicFx.onEvent('reaction', { id: r.id, name: r.name, x: 100, y: 100, target: null, source: null }, m);
    g.magicFx.onEvent('link', { id: r.id, from: foes[1], to: foes[2], x: foes[1].x, y: foes[1].y, x2: foes[2].x, y2: foes[2].y }, m);
  }
  // Real reactions through the runtime: soaked + storm, burning + wind, soaked + frost...
  const pairs = [
    ['soaked', 'storm'],
    ['soaked', 'frost'],
    ['burning', 'wind'],
    ['soaked', 'fire'],
    ['dazzled', 'dark'],
    ['frozen', 'earth'],
    ['poisoned', 'fire'],
    ['rooted', 'fire'],
  ];
  for (const [s, e] of pairs) {
    resetArena(g);
    m.applyStatus(foes[0], s, { src: g.player, power: 8, duration: 10, ignoreImmunity: true });
    m.cast(g.player, { shape: 'bolt', essences: [e], twists: [] }, { x: foes[0].x, y: foes[0].y, target: foes[0] }, { free: true });
    for (let i = 0; i < 90; i++) {
      step(g);
      if (i % 2 === 0) drawFrame(g);
    }
  }
  if (g.fxWarnings.length) assert.fail(g.fxWarnings.join('\n'));
});

test('odd events and missing pieces never throw out of the seam', () => {
  const g = fxArena();
  const fx = g.magicFx;
  const types = ['cast', 'spawn', 'launch', 'hit', 'end', 'explode', 'bounce', 'pulse', 'impact', 'armed', 'patch', 'block', 'status', 'reaction', 'familiar', 'dash', 'charge', 'beam_start', 'beam_end', 'link', 'fizzle', 'unknown_event'];
  for (const t of types) {
    assert.doesNotThrow(() => fx.onEvent(t, {}, g.magic), t);
    assert.doesNotThrow(() => fx.onEvent(t, null, g.magic), t);
    assert.doesNotThrow(() => fx.onEvent(t, { x: NaN, y: Infinity, plan: null, body: null }, g.magic), t);
  }
  assert.doesNotThrow(() => fx.update(1 / 60, g.magic));
  assert.doesNotThrow(() => fx.update(NaN, g.magic));
  assert.doesNotThrow(() => fx.update(1 / 60, null));
  assert.doesNotThrow(() => fx.drawGround(g.screen, 0, 0, 0, null));
  assert.doesNotThrow(() => fx.drawLayer(g.screen, 0, 0, 0, null));
  assert.doesNotThrow(() => fx.drawStatuses(g.screen, 0, 0, 0, null));
  assert.doesNotThrow(() => fx.getLights(0, null));
  assert.doesNotThrow(() => fx.drawGlow(g.final, {}));
  // No audio context at all (a browser that refused it): silent, not broken.
  const g2 = fxArena();
  g2.audio = { play() {} };
  exercise(g2, { shape: 'nova', essences: ['storm', 'water'], twists: ['big'] }, 'no audio');
});

test('particles are pooled under a hard cap and reused', () => {
  const p = new FxParticles(64);
  for (let i = 0; i < 1000; i++) p.add(i % STYLE_NAMES.length, null, i, i, 0, 1, 1, 1);
  assert.ok(p.count <= 64, `count ${p.count}`);
  for (let i = 0; i < 200; i++) p.update(1 / 60);
  assert.ok(p.count <= 64);
  const ctx = makeCanvasEl(480, 270).getContext('2d');
  assert.doesNotThrow(() => {
    p.draw(ctx, 0, 0);
    p.drawGlow(ctx, 0, 0, null);
  });
});

test('a crowd of 150+ bodies stays inside a frame budget', () => {
  const g = fxArena({ foes: 6 });
  const m = g.magic;
  const shapes = ['bolt', 'orb', 'rain', 'throw', 'nova', 'wall', 'rune', 'summon'];
  const ess = Essences.ids();
  let k = 0;
  let peak = 0;
  const t0 = performance.now();
  let frames = 0;
  for (let i = 0; i < 360; i++) {
    if (i % 6 === 0) {
      for (let j = 0; j < 4; j++) {
        const w = { shape: shapes[k % shapes.length], essences: [ess[k % ess.length], ess[(k * 7 + 2) % ess.length]], twists: k % 3 ? ['multishot'] : ['volley', 'split'] };
        if (w.essences[0] === w.essences[1]) w.essences.pop();
        k++;
        m.cast(g.player, w, { x: AIM.x + (j - 2) * 20, y: AIM.y + ((i / 6) % 5) * 10 }, { free: true });
      }
    }
    step(g);
    drawFrame(g);
    frames++;
    peak = Math.max(peak, m.bodies.length);
  }
  const ms = (performance.now() - t0) / frames;
  if (g.fxWarnings.length) assert.fail(g.fxWarnings.join('\n'));
  assert.ok(peak >= 100, `peak ${peak} bodies`);
  // The mock canvas is far slower per call than a real one; this only catches runaway work.
  assert.ok(ms < 40, `${ms.toFixed(2)} ms a frame (update + draw on a mock canvas)`);
  assert.ok(g.magicFx.parts.count <= g.magicFx.parts.cap, 'particles capped');
});

test('the checking canvas and audio really catch a bad number', () => {
  const ctx = makeCanvasEl(10, 10).getContext('2d');
  assert.throws(() => ctx.fillRect(NaN, 0, 1, 1), /canvas fillRect/);
  assert.throws(() => (ctx.globalAlpha = NaN), /globalAlpha/);
  assert.throws(() => makeAudioCtx().createGain().gain.setValueAtTime(NaN, 0), /non-finite/);
  // A body knocked to NaN is caught and reported by the fx guard, never thrown.
  const g = fxArena();
  g.magic.cast(g.player, { shape: 'bolt', essences: ['fire'], twists: [] }, AIM, { free: true });
  step(g);
  const b = g.magic.bodies.find((x) => x.active);
  b.r = NaN;
  b.fxState = null;
  assert.doesNotThrow(() => drawFrame(g));
  assert.ok(g.fxWarnings.length > 0, 'the guard reported it');
});
