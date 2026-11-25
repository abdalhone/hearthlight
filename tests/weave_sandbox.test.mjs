// The Spellbook's preview is the real Weave in a sandbox (r13 C4; the author: "when I
// [add] twists on spells, it does not change the preview"): the plan the Spellbook
// compiled is cast by the real runtime in a tiny arena at two straw dummies, so every
// twist changes what is seen. Headless: no canvas drawing, the simulation only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPreview, makeSandbox } from '../src/ui/weave_sandbox.js';
import { compileWeave } from '../src/magic/compile.js';

const canvas = { getContext: () => null, clientWidth: 400, clientHeight: 168, width: 0, height: 0 };

// What one cast of a weave looks like in the sandbox, as numbers.
function signature(shape, twists = [], ess = ['fire']) {
  const pv = new SandboxPreview(canvas, null);
  const weave = { shape, essences: ess, twists };
  const plan = compileWeave(weave, { trusted: true });
  assert.ok(plan.ok, `${shape}+${twists}: ${plan.reason}`);
  pv.set(weave, plan, plan.palette);
  const g = pv.sg;
  const sig = { casts: 0, maxBodies: 0, hit0: 0, hit1: 0, heals: 0, children: 0, maxR: 0, firstHitAt: -1, decals: 0, casterFar: 0, orbitNear: 0, minY: Infinity };
  g.bus.on('spell_cast', () => sig.casts++);
  g.bus.on('damage', (p) => {
    if (p.target === g.dummies[0]) sig.hit0++;
    if (p.target === g.dummies[1]) sig.hit1++;
    if (sig.firstHitAt < 0) sig.firstHitAt = pv.t;
  });
  g.bus.on('heal', (p) => {
    if (p.target === g.player) sig.heals++;
  });
  g.player.hp = g.player.maxHp * 0.5;
  for (let i = 0; i < 60 * 2.4; i++) {
    pv.update(1 / 60);
    const live = g.magic.bodies.filter((b) => b.active);
    sig.maxBodies = Math.max(sig.maxBodies, live.length);
    for (const b of live) {
      sig.maxR = Math.max(sig.maxR, b.r || 0);
      if ((b.gen || 0) > 0) sig.children++;
      if (Math.hypot(b.x - g.player.x, b.y - g.player.y) < 24 && pv.t - (pv.casterPose ?? 0) > 0.35) sig.orbitNear++;
      sig.minY = Math.min(sig.minY, b.y);
    }
    sig.decals = Math.max(sig.decals, g.magic.decals.length + live.filter((b) => b.kind === 'patch' || b.mode === 'patch').length);
  }
  return sig;
}

test('the sandbox is its own small world and casts the real plan at a dummy', () => {
  const g = makeSandbox(null);
  assert.ok(g.sandbox && g.magic && g.combat && g.entities);
  assert.equal(g.dummies.length, 2);
  const s = signature('bolt');
  assert.equal(s.casts, 1, 'one cast a cycle');
  assert.ok(s.hit0 >= 1, 'the bolt hits the dummy');
});

test('every twist changes what the preview shows', () => {
  const plain = signature('bolt');
  const t = (x) => signature('bolt', [x]);
  const multishot = t('multishot');
  assert.ok(multishot.maxBodies >= 3 && plain.maxBodies < 3, 'multishot fans three');
  const split = t('split');
  assert.ok(split.children > 0, 'split bursts into pieces');
  const chain = t('chain');
  assert.ok(chain.hit1 > plain.hit1, 'chain arcs to the second dummy');
  const echo = t('echo');
  assert.ok(echo.casts > plain.casts || echo.maxBodies > plain.maxBodies || echo.hit0 > plain.hit0, 'echo casts again');
  const volley = t('volley');
  assert.ok(volley.hit0 + volley.hit1 > plain.hit0 + plain.hit1, 'volley fires a burst');
  const orbit = t('orbit');
  assert.ok(orbit.orbitNear > 10, 'orbit circles the caster');
  const big = t('big');
  assert.ok(big.maxR > plain.maxR, 'big is bigger');
  const swift = t('swift');
  assert.ok(swift.firstHitAt > 0 && swift.firstHitAt < plain.firstHitAt, 'swift arrives sooner');
  const pierce = t('pierce');
  assert.ok(pierce.hit1 > plain.hit1, 'pierce goes through to the dummy behind');
  const leech = t('leech');
  assert.ok(leech.heals > 0 && plain.heals === 0, 'leech threads life back');
  const charge = t('charge');
  assert.ok(charge.firstHitAt > plain.firstHitAt, 'charge gathers before it flies');
  const homing = t('homing');
  assert.ok(homing.hit0 >= 1 && homing.minY < plain.minY - 5, 'homing turns after the dummy as it steps aside, and still hits');
  const burst = t('burst');
  assert.ok(burst.hit1 > plain.hit1 || burst.hit0 > plain.hit0, 'burst explodes into the dummies');
  const linger = t('linger');
  assert.ok(linger.decals > plain.decals || linger.hit0 > plain.hit0, 'linger leaves something burning');
  const bounce = t('bounce');
  assert.ok(bounce.hit1 + bounce.hit0 > plain.hit1 + plain.hit0, 'bounce comes back for more');
  const spiral = t('spiral');
  assert.notDeepEqual([spiral.minY, spiral.firstHitAt], [plain.minY, plain.firstHitAt], 'spiral weaves its own path');
});

test('every shape casts in the sandbox without error', () => {
  for (const shape of ['bolt', 'throw', 'beam', 'nova', 'ward', 'summon', 'bind', 'rain', 'rune', 'wall', 'dash', 'strike', 'blast', 'orb']) {
    const s = signature(shape, [], ['frost']);
    assert.ok(s.casts >= 1, `${shape} cast`);
  }
});
