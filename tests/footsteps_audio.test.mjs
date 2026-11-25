// Others' footfalls never swallow the player's own (r14a verify: in the busy square, a
// villager's step a moment earlier dropped the player's step of the same ground through the
// shared per-sound gap, and a crowd of walkers could fill the voice budget so a sword swing
// went unheard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../src/core/audio.js';

// A Web Audio stand-in: every node connects, every param takes any automation call.
function fakeCtx() {
  const param = () => new Proxy({ value: 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const node = () =>
    new Proxy(
      {},
      {
        get(t, k) {
          if (k in t) return t[k];
          if (['gain', 'frequency', 'Q', 'pan', 'detune', 'playbackRate', 'offset'].includes(k)) return (t[k] = param());
          if (k === 'buffer' || k === 'type') return t[k];
          return () => {};
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    );
  return new Proxy({ currentTime: 10, state: 'running', sampleRate: 44100 }, { get: (t, k) => (k in t ? t[k] : () => node()) });
}

function audio() {
  const a = new Audio({ settings: {}, state: 'playing', voice: {} });
  a.ctx = fakeCtx();
  a.sfxBus = { connect() {} };
  a.noiseBuffer = {};
  return a;
}
const heard = (a, name, opts) => {
  const before = a.voiceEnds.length;
  a.play(name, opts);
  return a.voiceEnds.length > before;
};

test("a villager's step a moment before yours does not swallow your own", () => {
  const a = audio();
  assert.equal(heard(a, 'step_stone', { volume: 0.14, other: true }), true, 'their step');
  a.ctx.currentTime += 0.01;
  assert.equal(heard(a, 'step_stone', { volume: 0.36 }), true, 'your own step, right after');
  a.ctx.currentTime += 0.01;
  assert.equal(heard(a, 'step_stone', { volume: 0.14, other: true }), false, "another of theirs this close is still spaced out");
  a.ctx.currentTime += 0.01;
  assert.equal(heard(a, 'step_stone', { volume: 0.36 }), false, 'your own steps keep their own spacing too');
});

test('a crowd of footfalls leaves voices free for what you do', () => {
  const a = audio();
  const now = a.ctx.currentTime;
  for (let i = 0; i < 14; i++) a.voiceEnds.push(now + 1);
  assert.equal(heard(a, 'step_grass', { volume: 0.1, other: true }), false, 'background steps yield when the budget is half full');
  assert.equal(heard(a, 'step_grass', { volume: 0.36 }), true, 'your own step still sounds');
  assert.equal(heard(a, 'hit', {}), true, 'and so does a hit');
});
