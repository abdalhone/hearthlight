import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, resetArena, assertSane, AIM } from './magic_helpers.mjs';
import { Shapes } from '../src/magic/shapes.js';
import { Essences } from '../src/magic/essences.js';
import { Twists } from '../src/magic/twists.js';
import { compileWeave } from '../src/magic/compile.js';
import { RNG } from '../src/core/rng.js';
import { BODY_CAP } from '../src/magic/balance.js';

// DESIGN §22.2: "Test that it is combinatorial." Every shape with every essence (and
// every pair of essences), every twist, and a deterministic sample of twist triples is
// compiled, cast and run for 4 simulated seconds against dummy foes in a walled room:
// no throw, no NaN, never more bodies than the cap, inside a time budget.

const SECONDS = 4;
const STEPS = SECONDS * 60;

function arena() {
  const g = makeGame({ foes: 6 });
  g.magic.unlockAll();
  return g;
}

// Cast (held shapes are held for a second, charged ones charged), then run.
function exercise(g, weave, label) {
  resetArena(g);
  const m = g.magic;
  const plan = m.compile(weave);
  assert.ok(plan.ok, `${label}: ${plan.reason}`);
  assert.ok(plan.name && plan.description && plan.aim, `${label}: words and aim`);
  let r;
  if (plan.input === 'tap') r = m.cast(g.player, weave, AIM, { free: true });
  else r = m.castStart(g.player, weave, AIM, { free: true });
  assert.ok(r.ok, `${label}: ${r.message}`);
  let peak = 0;
  for (let i = 0; i < STEPS; i++) {
    if (plan.input !== 'tap' && i === 60) {
      const rel = m.castRelease(g.player, AIM);
      assert.ok(rel.ok, `${label}: release ${rel.message}`);
    }
    // A second cast a second in, so bodies of two casts meet.
    if (i === 70 && plan.input === 'tap') m.cast(g.player, weave, { x: AIM.x + 30, y: AIM.y - 20 }, { free: true });
    step(g);
    if (m.bodies.length > peak) peak = m.bodies.length;
    if (i % 40 === 0) assertSane(g, assert, label);
  }
  assertSane(g, assert, label);
  assert.ok(peak <= BODY_CAP, `${label}: ${peak} bodies`);
  return peak;
}

function timed(fn) {
  const t0 = performance.now();
  const out = fn();
  return [performance.now() - t0, out];
}

test('every shape x every essence', () => {
  const g = arena();
  let worst = 0;
  for (const s of Shapes.ids()) {
    for (const e of Essences.ids()) {
      const [ms] = timed(() => exercise(g, { shape: s, essences: [e] }, `${s}/${e}`));
      worst = Math.max(worst, ms);
    }
  }
  assert.ok(worst < 400, `slowest 4 s run took ${worst.toFixed(1)} ms`);
});

test('every shape x every pair of essences', () => {
  const g = arena();
  const ess = Essences.ids();
  let worst = 0;
  for (const s of Shapes.ids()) {
    for (let i = 0; i < ess.length; i++) {
      for (let j = i + 1; j < ess.length; j++) {
        const [ms] = timed(() => exercise(g, { shape: s, essences: [ess[i], ess[j]] }, `${s}/${ess[i]}+${ess[j]}`));
        worst = Math.max(worst, ms);
      }
    }
  }
  assert.ok(worst < 400, `slowest 4 s run took ${worst.toFixed(1)} ms`);
});

test('every shape x every twist', () => {
  const g = arena();
  const ess = Essences.ids();
  let k = 0;
  let worst = 0;
  for (const s of Shapes.ids()) {
    for (const t of Twists.ids()) {
      const e = ess[k++ % ess.length];
      const [ms] = timed(() => exercise(g, { shape: s, essences: [e], twists: [t] }, `${s}/${e}/${t}`));
      worst = Math.max(worst, ms);
    }
  }
  assert.ok(worst < 400, `slowest 4 s run took ${worst.toFixed(1)} ms`);
});

test('a deterministic sample of twist triples on mixed essences', () => {
  const g = arena();
  const rng = new RNG(4242);
  const shapes = Shapes.ids();
  const ess = Essences.ids();
  const tw = Twists.ids();
  let worst = 0;
  const seen = new Set();
  for (let n = 0; n < 240; n++) {
    const shape = shapes[n % shapes.length];
    const ne = 1 + (n % 3);
    const es = [];
    while (es.length < ne) {
      const e = rng.pick(ess);
      if (!es.includes(e)) es.push(e);
    }
    const ts = [];
    while (ts.length < 3) {
      const t = rng.pick(tw);
      if (!ts.includes(t)) ts.push(t);
    }
    const weave = { shape, essences: es, twists: ts };
    seen.add(`${shape}|${es}|${ts}`);
    const [ms] = timed(() => exercise(g, weave, `${shape}/${es.join('+')}/${ts.join('+')}`));
    worst = Math.max(worst, ms);
  }
  assert.ok(seen.size > 200, 'varied');
  assert.ok(worst < 600, `slowest 4 s run took ${worst.toFixed(1)} ms`);
});

test('every twist on every shape compiles even with four twists and three essences', () => {
  const tw = Twists.ids();
  for (const s of Shapes.ids()) {
    for (let i = 0; i < tw.length; i++) {
      const ts = [tw[i], tw[(i + 3) % tw.length], tw[(i + 7) % tw.length], tw[(i + 11) % tw.length]];
      const p = compileWeave({ shape: s, essences: ['fire', 'water', 'storm'], twists: ts });
      assert.ok(p.ok, `${s} ${ts}: ${p.reason}`);
      assert.ok(Number.isFinite(p.cost) && p.cost > 0 && Number.isFinite(p.dmg) && p.dmg > 0);
    }
  }
});

test('a full screen of the heaviest weaves stays under the body cap and well inside 2 ms a frame', () => {
  const g = makeGame({ foes: 24 });
  const m = g.magic;
  m.unlockAll();
  // Foes spread through the room.
  g.foes.forEach((f, i) => {
    f.x = (12 + (i % 8) * 3) * 16;
    f.y = (6 + Math.floor(i / 8) * 6) * 16;
  });
  const heavy = [
    { shape: 'bolt', essences: ['fire', 'storm', 'water'], twists: ['multishot', 'split', 'chain', 'burst'] },
    { shape: 'orb', essences: ['poison', 'wind', 'fire'], twists: ['multishot', 'linger', 'bounce', 'echo'] },
    { shape: 'rain', essences: ['frost', 'water', 'iron'], twists: ['multishot', 'volley', 'burst', 'split'] },
    { shape: 'nova', essences: ['light', 'dark', 'song'], twists: ['echo', 'volley', 'chain', 'linger'] },
    { shape: 'summon', essences: ['earth', 'iron', 'storm'], twists: ['multishot', 'split', 'chain', 'burst'] },
    { shape: 'beam', essences: ['fire', 'frost', 'storm'], twists: ['multishot', 'bounce', 'split', 'chain'] },
    { shape: 'throw', essences: ['nature', 'fire', 'wind'], twists: ['multishot', 'bounce', 'split', 'linger'] },
    { shape: 'wall', essences: ['fire', 'iron', 'earth'], twists: ['multishot', 'orbit', 'burst', 'linger'] },
  ];
  const aims = [
    { x: 200, y: 120 },
    { x: 300, y: 200 },
    { x: 380, y: 300 },
    { x: 260, y: 380 },
  ];
  let peak = 0;
  let total = 0;
  let worstStep = 0;
  let frames = 0;
  for (let i = 0; i < 360; i++) {
    if (i % 12 === 0) {
      const w = heavy[(i / 12) % heavy.length];
      const a = aims[(i / 12) % aims.length];
      if (w.shape === 'beam') m.cast(g.player, w, a, { free: true });
      else m.cast(g.player, w, a, { free: true });
    }
    g.foes.forEach((f) => {
      if (f.hp < 200) f.hp = f.maxHp; // keep the room full
    });
    const t0 = performance.now();
    g.magic.update(1 / 60);
    const ms = performance.now() - t0;
    g.entities.update(1 / 60);
    g.combat.update(1 / 60);
    if (i >= 60) {
      total += ms;
      frames++;
      worstStep = Math.max(worstStep, ms);
    }
    peak = Math.max(peak, m.bodies.length);
    if (i % 30 === 0) assertSane(g, assert, `stress ${i}`);
  }
  const avg = total / frames;
  console.log(`[magic stress] peak bodies ${peak}, mean ${avg.toFixed(3)} ms / frame, worst ${worstStep.toFixed(2)} ms, capped spawns ${m.capped}`);
  assert.ok(peak <= BODY_CAP, `peak ${peak}`);
  assert.ok(peak > 80, `the screen really was full (${peak})`);
  assert.ok(avg < 2, `mean simulation ${avg.toFixed(3)} ms a frame`);
});
