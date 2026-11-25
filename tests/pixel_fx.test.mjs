// The pixelfx host (src/render/pixel_fx.js, DESIGN §30): lifecycle, culling, the cap,
// reduced motion, and that effects stand still while the game is paused or in a hit-stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelFx, effectBox, softWhite, softenWhites } from '../src/render/pixel_fx.js';
import { PIXEL_FX, RAMP } from '../src/render/pixel_fx_catalog.js';
import { Game } from '../src/core/game.js';
import { EventBus } from '../src/core/events.js';

// A tiny one-shot effect (0.5 s) and a loop, as pixelfx modules: a white dot and its light.
const shot = {
  meta: { name: 'test shot', size: [16, 16], origin: [8, 12], duration: 0.5, loop: false, fps: 30, options: { palette: ['#102030', '#4080c0', '#ffffff'], size: 1, seed: 1 } },
  create(o) {
    let t = 0;
    return {
      update(dt) {
        t += dt;
      },
      draw(p) {
        p.px(0, -4, 0xffffffff);
        p.light(0, -4, 0xff808080, 1);
      },
      done: () => t >= 0.5,
      get t() {
        return t;
      },
      opts: o,
    };
  },
};
const loop = { meta: { name: 'test loop', size: [16, 16], origin: [8, 12], duration: 1, loop: true, fps: 30, options: { palette: ['#000000', '#ff0000'] } }, draw() {} };

function makeGame({ phone = false, reduce = false } = {}) {
  const game = {
    settings: { reduceMotion: reduce },
    camera: { x: 0, y: 0, vw: 480, vh: 270 },
    ui: { isTouch: phone },
    renderer: { canvas: { clientWidth: phone ? 844 : 1280, clientHeight: phone ? 390 : 720 }, buffer: null, frame: 1 },
    bus: new EventBus(),
  };
  return game;
}

function makeHost(game, extra = {}) {
  return new PixelFx(game, {
    shot: { mod: shot, layer: 'top', priority: 1, bounds: [-8, -12, 8, 4] },
    hit: { mod: shot, layer: 'top', priority: 3, bounds: [-8, -12, 8, 4] },
    ambient: { mod: loop, layer: 'body', priority: 0, bounds: [-8, -12, 8, 4], reduce: false },
    ground: { mod: shot, layer: 'ground', priority: 1, bounds: [-8, -12, 8, 4] },
    ...extra,
  });
}

test('pixel fx: an effect plays, ages with the world and goes when it is done; its frame is pooled', () => {
  const host = makeHost(makeGame());
  const h = host.play('shot', { x: 100, y: 100 });
  assert.ok(h, 'a handle');
  assert.equal(host.count, 1);
  assert.equal(host.play('no-such-effect', { x: 1, y: 1 }), null);
  assert.equal(host.play('shot', { x: NaN, y: 1 }), null);
  host.update(0.2);
  assert.equal(host.count, 1);
  assert.ok(host.playing(h));
  host.update(0.2);
  host.update(0.2);
  assert.equal(host.count, 0, 'gone after its 0.5 s');
  assert.equal(host.playing(h), false);
  // its frame went back to the pool and is reused by the next effect of that size
  const pooled = [...host._pool.values()].reduce((n, l) => n + l.length, 0);
  assert.equal(pooled, 1);
  host.play('shot', { x: 100, y: 100 });
  assert.equal([...host._pool.values()].reduce((n, l) => n + l.length, 0), 0);
});

test('pixel fx: stop by handle or tag; a loop runs until stopped; a follower tracks its body and ends with it', () => {
  const host = makeHost(makeGame());
  const body = { x: 50, y: 60, removed: false };
  const a = host.play('ambient', { follow: body, tag: 'body:x' });
  const b = host.play('ambient', { follow: body, tag: 'body:x' });
  assert.ok(a && b);
  for (let i = 0; i < 30; i++) host.update(0.1);
  assert.equal(host.count, 2, 'loops keep playing');
  body.x = 80;
  host.update(0.05);
  assert.equal(host.live[0].x, 80, 'follows the body');
  assert.equal(host.stop('body:x'), 2);
  for (let i = 0; i < 40; i++) host.update(0.1);
  assert.equal(host.count, 0, 'stopped loops fade out and end');
  const c = host.play('ambient', { follow: body });
  body.removed = true;
  for (let i = 0; i < 40; i++) host.update(0.1);
  assert.equal(host.playing(c), false, 'ends when its body is gone');
  const d = host.play('shot', { x: 10, y: 10, life: 0.05 });
  host.update(0.1);
  assert.equal(host.live.find((i) => i.handle === d).stopped, true, 'life cuts it short...');
  host.update(0.1);
  host.update(0.1);
  host.update(0.1);
  assert.equal(host.playing(d), false, '...after a short fade');
});

test('pixel fx: off-screen one-shots are not started; drawables are only collected near the view', () => {
  const game = makeGame();
  const host = makeHost(game);
  assert.equal(host.play('shot', { x: 2000, y: 100 }), null, 'far off screen');
  assert.equal(host.stats.culled, 1);
  assert.ok(host.play('shot', { x: 500, y: 100 }), 'just past the edge still starts');
  const body = { x: 3000, y: 3000 };
  assert.ok(host.play('ambient', { follow: body }), 'a follower is kept (it may walk in)');
  const list = [];
  host.collect(list, 0, 0, 480, 270);
  assert.equal(list.length, 1, 'only the one near the view');
  // layers: ground under everything, body bracketing its anchor, top over everything
  host.clear();
  host.play('ground', { x: 100, y: 100 });
  host.play('ambient', { follow: { x: 100, y: 120 } });
  host.play('shot', { x: 100, y: 100 });
  const l2 = [];
  host.collect(l2, 0, 0, 480, 270);
  const ys = l2.map((d) => d.sortY).sort((p, q) => p - q);
  assert.equal(l2.length, 4);
  assert.ok(ys[0] < -1e8, 'ground first');
  assert.ok(Math.abs(ys[1] - 119.99) < 1e-6 && Math.abs(ys[2] - 120.01) < 1e-6, 'body behind and in front of its feet');
  assert.ok(ys[3] > 1e6, 'top last');
});

test('pixel fx: a cap on effects at once, lower on phones; the least important oldest goes first', () => {
  const host = makeHost(makeGame(), {});
  assert.equal(host.cap, 28);
  const phone = makeHost(makeGame({ phone: true }));
  assert.equal(phone.cap, 14);
  for (let i = 0; i < host.cap; i++) assert.ok(host.play('shot', { x: 100 + i, y: 100 }));
  const first = host.live[0].uid;
  assert.ok(host.play('hit', { x: 100, y: 100 }), 'a hit makes room');
  assert.equal(host.count, host.cap);
  assert.notEqual(host.live[0].uid, first, 'the oldest flourish went');
  assert.equal(host.stats.evicted, 1);
  assert.equal(host.play('ambient', { follow: { x: 1, y: 1 } }), null, 'ambience never pushes anything out');
  assert.equal(host.stats.refused, 1);
  for (let i = 0; i < host.cap; i++) host.play('hit', { x: 100, y: 100 });
  assert.equal(host.play('shot', { x: 100, y: 100 }), null, 'a flourish cannot push out hits');
});

test('pixel fx: reduced motion means fewer, smaller, calmer effects with no white', () => {
  const game = makeGame({ reduce: true });
  const host = makeHost(game);
  assert.equal(host.cap, 14, 'half the cap');
  assert.equal(host.play('ambient', { follow: { x: 1, y: 1 } }), null, 'ambience skipped');
  const h = host.play('shot', { x: 100, y: 100, size: 1 });
  const inst = host.live.find((i) => i.handle === h);
  assert.equal(inst.fx.options.calm, true);
  assert.ok(Math.abs(inst.fx.options.size - 0.85) < 1e-9, 'a little smaller');
  assert.equal(inst.lightK, 0.5, 'half the glow');
  assert.ok(inst.soft, 'whites are softened');
  // the soft color is the ramp's brightest non-white, in frame order (ABGR)
  assert.equal(softWhite(['#102030', '#4080c0', '#ffffff']), (0xc0 << 16) | (0x80 << 8) | 0x40);
  assert.equal(softWhite(RAMP.gold) & 0xffffff, (0xc4 << 16) | (0xf6 << 8) | 0xff);
  const px = new Uint32Array([0xffffffff, 0x80fefefe, 0xff2040ff, 0]);
  softenWhites(px, px.length, 0x123456);
  assert.equal(px[0] >>> 0, 0xff123456);
  assert.equal(px[1] >>> 0, 0x80123456, 'alpha kept');
  assert.equal(px[2] >>> 0, 0xff2040ff, 'colors untouched');
  assert.equal(px[3], 0);
  // and without reduced motion nothing of the sort
  game.settings.reduceMotion = false;
  const h2 = host.play('shot', { x: 100, y: 100, size: 1 });
  const i2 = host.live.find((i) => i.handle === h2);
  assert.equal(i2.fx.options.calm, undefined);
  assert.equal(i2.soft, 0);
});

test('pixel fx: an undefined option keeps the default (no crash on palette: undefined)', () => {
  const host = makeHost(makeGame());
  const h = host.play('shot', { x: 100, y: 100, palette: undefined });
  const inst = host.live.find((i) => i.handle === h);
  assert.deepEqual(inst.fx.options.palette, shot.meta.options.palette);
});

test('pixel fx: drawing composites the color into the buffer and the light into the light buffer', () => {
  const game = makeGame();
  const host = makeHost(game);
  // a stand-in canvas: record what is put and drawn
  const drawn = [];
  host._scratch = (w, h) => ({ canvas: { w, h }, ctx: { putImageData() {} }, img: {}, u32: new Uint32Array(w * h) });
  const lightBuf = { w: 480, h: 270, buf: new Uint32Array(480 * 270), x0: 480, y0: 270, x1: -1, y1: -1 };
  host._lightBuf = () => lightBuf;
  host.play('shot', { x: 100, y: 100 });
  host.update(0.05);
  const list = [];
  host.collect(list, 0, 0, 480, 270);
  const ctx = { drawImage: (...a) => drawn.push(a) };
  list[0].draw(ctx, 0, 0);
  assert.equal(drawn.length, 1, 'blitted once');
  const [, , , , , dx, dy] = drawn[0];
  assert.equal(dx, 100 - 8);
  assert.equal(dy, 100 - 12);
  assert.ok(lightBuf.buf[96 * 480 + 100] & 255, 'light added where the dot is');
  assert.equal(host.stats.drawn, 1);
});

test('pixel fx: effects freeze while the game is paused or in a hit-stop, and slow with timeScale', () => {
  // The real Game.update with every other system stubbed out.
  const noop = { update() {}, endFrame() {}, realtime() {} };
  const host = makeHost(makeGame());
  const g = Object.create(Game.prototype);
  for (const k of ['input', 'story', 'survival', 'clock', 'entities', 'objects', 'map', 'combat', 'magic', 'stats', 'prices', 'spawner', 'bosses', 'plugins', 'villageLife', 'murder', 'brain', 'lighting', 'particles', 'weather', 'bubbles', 'camera', 'save', 'audio', 'ui'])
    g[k] = noop;
  g.pixelFx = host;
  g.time = 0;
  g.state = 'playing';
  g.paused = false;
  g.hitStop = 0;
  g.timeScale = 1;
  const h = host.play('shot', { x: 100, y: 100 });
  const inst = host.live.find((i) => i.handle === h);
  g.update(0.1);
  assert.ok(Math.abs(inst.t - 0.1) < 1e-9);
  g.paused = true;
  g.update(0.1);
  assert.ok(Math.abs(inst.t - 0.1) < 1e-9, 'paused: still');
  g.paused = false;
  g.hitStop = 0.05;
  g.update(0.05);
  assert.ok(Math.abs(inst.t - 0.1) < 1e-9, 'hit-stop: still');
  g.timeScale = 0.25;
  g.update(0.1);
  assert.ok(Math.abs(inst.t - 0.125) < 1e-9, 'timeScale: slowed');
  g.state = 'cutscene';
  g.update(0.1);
  assert.ok(Math.abs(inst.t - 0.125) < 1e-9, 'cutscene: still');
});

test('pixel fx: the catalog is whole: every effect has a module, a layer and bounds that hold it', () => {
  for (const [id, spec] of Object.entries(PIXEL_FX)) {
    assert.ok(spec.mod && (typeof spec.mod.create === 'function' || typeof spec.mod.draw === 'function'), `${id}: module`);
    assert.ok(['ground', 'body', 'top'].includes(spec.layer), `${id}: layer`);
    const [x0, y0, x1, y1] = effectBox(spec);
    assert.ok(x0 < 0 && x1 > 0 && y0 < 0 && y1 >= 0, `${id}: bounds round the anchor`);
  }
  // nothing in the game uses the stock side-on actor or acts
  assert.ok(!Object.values(PIXEL_FX).some((s) => s.mod?.meta?.act), 'no stock acts');
});

test('pixel fx: the real effects play and draw headless at the game scale (smoke)', () => {
  const game = makeGame();
  const host = new PixelFx(game, PIXEL_FX);
  // a 10x20 body for the effects that wrap one
  const mask = { w: 10, h: 20, data: new Uint8Array(200).fill(1) };
  const actor = { mask, pixels: new Uint32Array(200).fill(0xff406080), x: -5, y: -20, w: 10, h: 20, k: 1, head: [0, -20], chest: [0, -11] };
  host.actorOf = () => actor;
  host._scratch = (w, h) => ({ canvas: {}, ctx: { putImageData() {} }, img: {}, u32: new Uint32Array(w * h) });
  host._lightBuf = () => null;
  const body = { x: 100, y: 120 };
  for (const id of Object.keys(PIXEL_FX)) {
    const h = PIXEL_FX[id].actor || PIXEL_FX[id].sync ? host.play(id, { follow: body, angle: 1 }) : host.play(id, { x: 100, y: 120, angle: 1 });
    assert.ok(h, `${id} played`);
  }
  const ctx = { drawImage() {} };
  for (let f = 0; f < 20; f++) {
    host.update(1 / 30);
    const list = [];
    host.collect(list, 0, 0, 480, 270);
    for (const d of list) d.draw(ctx, 0, 0);
  }
  assert.equal(host._warned.size, 0, `no effect failed: ${[...host._warned].join(', ')}`);
  assert.ok(host.stats.drawn > 0);
});

test('pixel fx: effects that wrap a body are made round OUR body, never pixelfx stand-in', async () => {
  const { stockActor } = await import('../src/vendor/pixelfx/core/actor.js');
  const { PixelFxDirector } = await import('../src/render/pixel_fx_play.js');
  const game = makeGame();
  const host = new PixelFx(game, PIXEL_FX);
  const mask = { w: 10, h: 20, data: new Uint8Array(200).fill(1) };
  const ours = { mask, pixels: new Uint32Array(200).fill(0xff406080), x: -5, y: -20, w: 10, h: 20, k: 1, head: [0, -20], chest: [0, -11] };
  const readable = { x: 100, y: 120 };
  const unreadable = { x: 140, y: 120 }; // a body pixelfx cannot read (no sprite frame)
  host.actorOf = (e) => (e === readable ? ours : null);
  const stock = stockActor(2);
  for (const id of ['heal', 'soul-rise', 'st-burning']) {
    const h = host.play(id, { follow: readable });
    assert.ok(h, `${id} played on a readable body`);
    const inst = host.live.find((i) => i.handle === h);
    assert.equal(inst.fx.options.actor, ours, `${id}: made round our body`);
    assert.notEqual(inst.fx.options.actor.mask, stock.mask, `${id}: not the stand-in`);
    assert.equal(host.play(id, { follow: unreadable }), null, `${id}: not started on a body it cannot read`);
  }
  // a status pixelfx cannot draw is not "owned": the old look keeps showing it
  const dir = new PixelFxDirector(game, host);
  dir.live.set(unreadable, new Map([['st-burning', { handle: { uid: -1 }, retry: 0 }]]));
  host.playing = () => true;
  assert.equal(dir.owns(unreadable, 'burning'), false);
});
