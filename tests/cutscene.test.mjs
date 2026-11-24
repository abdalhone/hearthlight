// The cutscene player's clock (DESIGN §20): a tap finishes the typing, the next tap moves
// on at once whatever the voice is doing; a line never waits for a clip that is slow,
// failed or blocked; a clip that really plays is let finish; a scene whose voices keep
// failing carries on silently. Runs on a tiny stand-in for the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CutscenePlayer } from '../src/story/cutscene.js';

// ------------------------------------------------------------------ a tiny DOM

function fakeEl(tag) {
  const listeners = {};
  const classes = new Set();
  const e = {
    tagName: tag,
    hidden: false,
    style: {},
    children: [],
    textContent: '',
    clientWidth: 390,
    clientHeight: 640,
    offsetWidth: 390,
    attrs: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c);
        else classes.delete(c);
        return want;
      },
      contains: (c) => classes.has(c),
    },
    set className(v) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    get className() {
      return [...classes].join(' ');
    },
    append: (...k) => e.children.push(...k),
    setAttribute: (k, v) => (e.attrs[k] = v),
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    removeEventListener: () => {},
    fire: (t, ev = {}) => {
      for (const f of listeners[t] || []) f({ preventDefault() {}, stopPropagation() {}, ...ev });
    },
    getContext: () =>
      new Proxy(
        {},
        {
          get: (o, k) => (k in o ? o[k] : () => {}),
          set: (o, k, v) => ((o[k] = v), true),
        },
      ),
  };
  return e;
}

globalThis.document = globalThis.document || { createElement: fakeEl, body: fakeEl('body') };
globalThis.window = globalThis.window || {
  innerWidth: 390,
  innerHeight: 640,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A voice layer the test controls: each play() is recorded; the test decides when (and
// whether) its clip starts and ends.
function fakeVoice(mode = 'manual') {
  const v = {
    asks: [],
    stops: 0,
    current: null,
    preload: () => Promise.resolve(0),
    speaking: () => !!v.current,
    stop() {
      v.stops++;
      const c = v.current;
      v.current = null;
      c?.resolve({ ok: false, reason: 'stopped' });
    },
    play(opts) {
      let resolve;
      const p = new Promise((r) => (resolve = r));
      const ask = { opts, resolve: (r) => resolve(r) };
      v.asks.push(ask);
      if (mode === 'fail') return Promise.resolve({ ok: false, reason: 'unavailable' });
      if (mode === 'never') return p; // a clip that never comes (unreachable files)
      if (mode === 'silent') return Promise.resolve({ ok: false, reason: 'no_clip' });
      v.current = ask;
      return p;
    },
    // The test starts the newest clip: it "plays" for `ms`, then ends.
    startLast(ms) {
      const a = v.asks[v.asks.length - 1];
      a.opts.onStart?.({ duration: ms / 1000 });
      a.timer = setTimeout(() => {
        if (v.current === a) v.current = null;
        a.resolve({ ok: true, reason: 'done' });
      }, ms);
      return a;
    },
  };
  return v;
}

function makePlayer(voice, readMs = 300) {
  const game = { settings: { textSpeed: 1 }, voice, uiRoot: fakeEl('div'), audio: { unlock() {} } };
  const cp = new CutscenePlayer(game);
  cp.readMs = () => readMs;
  return cp;
}

const lines = (n) => ({ id: 't', steps: Array.from({ length: n }, (_, i) => ({ narrate: `Line number ${i} of the test.`, key: `t.${i}` })) });

// Count how many lines have been shown so far (the text box's current text).
function shown(cp) {
  return cp.textEl.textContent;
}

test('a tap finishes the typing, the next moves on at once while the voice still plays', async () => {
  const voice = fakeVoice('manual');
  const cp = makePlayer(voice, 5000);
  const done = cp.play(lines(3));
  await sleep(5);
  assert.equal(voice.asks.length, 1);
  voice.startLast(8000); // a long clip
  cp.advance(); // finishes the typing
  assert.equal(shown(cp), 'Line number 0 of the test.');
  assert.equal(voice.asks.length, 1, 'the first tap only finishes the typing');
  cp.advance(); // moves on at once, stopping the voice
  await sleep(5);
  assert.equal(voice.asks.length, 2, 'the second tap moved on to the next line');
  assert.ok(voice.stops >= 1, 'the voice was stopped');
  // the next line's clip never comes: taps still move on
  cp.advance();
  cp.advance();
  await sleep(5);
  assert.equal(voice.asks.length, 3);
  cp.advance();
  cp.advance();
  const r = await done;
  assert.equal(r.skipped, false);
});

test('a line never waits for a clip that is slow or never comes: it moves on at its reading time', async () => {
  const voice = fakeVoice('never');
  const cp = makePlayer(voice, 120);
  const t0 = performance.now();
  const r = await cp.play(lines(4));
  const took = performance.now() - t0;
  assert.equal(r.skipped, false);
  assert.equal(voice.asks.length, 4);
  // 4 lines at their reading time (at least 400 ms each) plus the closing fades (500 + 700)
  assert.ok(took < 4 * 400 + 1200 + 600, `took ${Math.round(took)} ms`);
  // each ask carried its reading time as the latest the clip may arrive
  for (const a of voice.asks) assert.ok(Math.abs(a.opts.maxLatency - 0.4) < 1e-9 || a.opts.maxLatency <= 0.4);
  // and a "wanted" check that turns false once the line has moved on
  assert.equal(voice.asks[0].opts.wanted(), false);
});

test('a clip that really plays is let finish: the line waits for its end, then a breath', async () => {
  const voice = fakeVoice('manual');
  const cp = makePlayer(voice, 100);
  const done = cp.play(lines(2));
  await sleep(5);
  voice.startLast(700);
  await sleep(400);
  assert.equal(voice.asks.length, 1, 'still on the first line while its clip plays (reading time was 100 ms)');
  await sleep(1100);
  assert.equal(voice.asks.length, 2, 'moved on after the clip ended');
  voice.startLast(50);
  const r = await done;
  assert.equal(r.skipped, false);
});

test('voices that keep failing: the scene stops asking and carries on silently', async () => {
  const voice = fakeVoice('fail');
  const cp = makePlayer(voice, 60);
  const r = await cp.play(lines(8));
  assert.equal(r.skipped, false);
  assert.equal(voice.asks.length, 3, 'three failures in a row, then silence');
  // a fresh scene tries again
  await cp.play(lines(1));
  assert.equal(voice.asks.length, 4);
});

test('no clip for a line is not a failure (the scene keeps asking)', async () => {
  const voice = fakeVoice('silent');
  const cp = makePlayer(voice, 40);
  await cp.play(lines(6));
  assert.equal(voice.asks.length, 6);
});

test('fast taps run a long scene through in a moment, whatever the voice does', async () => {
  for (const mode of ['never', 'manual', 'fail']) {
    const voice = fakeVoice(mode);
    const cp = makePlayer(voice, 4000);
    const script = { id: 'p', steps: [{ title: 'A title', ms: 2600 }, ...lines(30).steps, { wait: 3000 }, ...lines(10).steps] };
    let over = false;
    const t0 = performance.now();
    const done = cp.play(script).then((r) => ((over = true), r));
    let taps = 0;
    while (!over && taps < 400) {
      await sleep(30);
      if (mode === 'manual' && voice.current && !voice.current.timer) voice.startLast(9000);
      cp.advance();
      taps++;
    }
    const r = await done;
    const took = performance.now() - t0;
    assert.equal(r.skipped, false, mode);
    // 40 lines of 4 s each, a 2.6 s title and a 3 s pause: tapped through in a few seconds
    // (two taps a line, the closing fades), not the 170 s it takes untouched
    assert.ok(taps < 200, `${mode}: ${taps} taps`);
    assert.ok(took < 7000, `${mode}: took ${Math.round(took)} ms`);
  }
});

test('Escape-style skip ends the scene and stops the voice', async () => {
  const voice = fakeVoice('manual');
  const cp = makePlayer(voice, 4000);
  const done = cp.play(lines(5));
  await sleep(5);
  voice.startLast(5000);
  cp.skip();
  const r = await done;
  assert.equal(r.skipped, true);
  assert.ok(voice.stops >= 1);
  assert.equal(voice.asks.length, 1);
});
