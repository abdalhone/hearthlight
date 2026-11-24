import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapText,
  revealCount,
  typingDuration,
  typingCps,
  bubbleLifetime,
  viewMetrics,
  uiFontPx,
  pixelUnit,
  layoutBubble,
  stackRects,
  edgePoint,
  numberStyle,
  ambientAt,
  hexToRgbArray,
  lighten,
  luminance,
  flickerWave,
  ELLIPSIS,
} from '../src/render/text_layout.js';
import { Camera } from '../src/core/camera.js';
import { Particles, PARTICLE_TYPES } from '../src/render/particles.js';
import { Bubbles } from '../src/render/bubbles.js';
import { Lighting } from '../src/render/lighting.js';
import { Weather, periodicNoise } from '../src/render/weather.js';
import { arrowFrameForAngle, ICON_NAMES } from '../src/art/fx_art.js';
import { EventBus } from '../src/core/events.js';

// ------------------------------------------------------------------ text

test('wrapText keeps lines within the width and words intact', () => {
  const { lines, truncated } = wrapText('The ruins gate is locked, but the bandits up north might have the key.', 26, 4);
  assert.equal(truncated, false);
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(l.length <= 26, `"${l}" is too long`);
  assert.equal(lines.join(' '), 'The ruins gate is locked, but the bandits up north might have the key.');
});

test('wrapText truncates long text to max lines with an ellipsis', () => {
  const long = 'Once upon a time in the Glasswater Isles there lived a girl who could hear the sea sing, and she followed the song all the way to a lonely tower where an old mage was waiting for her.';
  const { lines, truncated } = wrapText(long, 26, 4);
  assert.equal(truncated, true);
  assert.equal(lines.length, 4);
  assert.ok(lines[3].endsWith(ELLIPSIS));
  for (const l of lines) assert.ok(l.length <= 26);
});

test('wrapText hyphenates words longer than a line and handles empty text', () => {
  const { lines } = wrapText('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', 26, 4);
  assert.ok(lines.length >= 2);
  assert.ok(lines[0].endsWith('-'));
  for (const l of lines) assert.ok(l.length <= 26);
  assert.deepEqual(wrapText('   ', 26, 4).lines, []);
  assert.deepEqual(wrapText(null, 26, 4).lines, []);
});

test('typewriter reveals over time, pauses at punctuation, and finishes at typingDuration', () => {
  const text = 'Hello. Is anyone there?';
  const cps = 40;
  assert.equal(revealCount(text, 0, cps), 0);
  let prev = 0;
  for (let t = 0; t <= 2; t += 0.01) {
    const n = revealCount(text, t, cps);
    assert.ok(n >= prev, 'never goes backwards');
    prev = n;
  }
  // Right after "Hello." there is a pause longer than one character.
  const atDot = 6 / cps + 0.001;
  assert.equal(revealCount(text, atDot, cps), 6);
  assert.equal(revealCount(text, atDot + 3 / cps, cps), 6);
  const d = typingDuration(text, cps);
  assert.equal(revealCount(text, d + 1e-6, cps), text.length);
  assert.ok(revealCount(text, d - 0.05, cps) < text.length);
  assert.equal(revealCount(text, 0, Infinity), text.length);
});

test('text speed setting maps to characters per second', () => {
  assert.equal(typingCps(1), 40);
  assert.equal(typingCps(2), 80);
  assert.equal(typingCps(0), Infinity);
  assert.equal(typingCps(5), Infinity);
  assert.equal(typingCps('nonsense'), Infinity);
  assert.ok(bubbleLifetime('A much longer line of speech for reading.', 40) > bubbleLifetime('Hi!', 40));
  assert.ok(bubbleLifetime('Hi!', 40) >= 2.2);
});

// ------------------------------------------------------------------ sizing

test('viewMetrics picks an integer scale showing about 240 px on the short side', () => {
  const desk = viewMetrics(1280, 720, 1, 1);
  assert.equal(desk.scale, 3);
  assert.equal(desk.cw, 1280);
  assert.equal(desk.bw, Math.ceil(1280 / 3) + 1);
  assert.equal(desk.bh, 241);
  const phone = viewMetrics(390, 844, 3, 1);
  assert.equal(phone.cw, 1170);
  assert.equal(phone.scale, 5);
  assert.ok(phone.vw >= 220 && phone.vw <= 250);
  assert.equal(viewMetrics(400, 300, 5, 1).dpr, 3, 'device pixel ratio is capped at 3');
  assert.ok(viewMetrics(1280, 720, 1, 1.5).scale > desk.scale, 'zoom brings the camera closer');
  assert.equal(viewMetrics(100, 80, 1, 1).scale, 1);
  assert.equal(viewMetrics(0, 0, NaN, NaN).scale, 1);
});

test('bubble text stays readable on phones and modest on monitors', () => {
  const phone = uiFontPx(5, 3);
  assert.ok(phone / 3 >= 13);
  const desk = uiFontPx(3, 1);
  assert.ok(desk >= 13 && desk <= 20);
  assert.ok(uiFontPx(8, 1) <= 20);
  assert.equal(pixelUnit(18), 2);
  assert.equal(pixelUnit(39), 3);
  assert.equal(pixelUnit(5), 1);
});

// ------------------------------------------------------------------ layout

const SCREEN = { screenW: 1280, screenH: 720, margin: 8, gap: 8, corner: 6, tailHalf: 8 };

test('layoutBubble centers above the speaker', () => {
  const L = layoutBubble({ ...SCREEN, ax: 640, ay: 400, footY: 470, w: 200, h: 60 });
  assert.equal(L.x, 540);
  assert.equal(L.y, 400 - 8 - 60);
  assert.equal(L.below, false);
  assert.equal(L.tailX, 640);
});

test('layoutBubble clamps to the screen edges and keeps the tail on the box', () => {
  const L = layoutBubble({ ...SCREEN, ax: 20, ay: 400, w: 200, h: 60 });
  assert.equal(L.x, 8);
  assert.ok(L.tailX >= L.x + 14 && L.tailX <= L.x + L.w - 14);
  const R = layoutBubble({ ...SCREEN, ax: 1275, ay: 400, w: 200, h: 60 });
  assert.equal(R.x + R.w, 1280 - 8);
  assert.ok(R.tailX <= R.x + R.w - 14);
});

test('layoutBubble flips below the speaker near the top of the screen', () => {
  const L = layoutBubble({ ...SCREEN, ax: 640, ay: 30, footY: 90, w: 200, h: 60 });
  assert.equal(L.below, true);
  assert.equal(L.y, 98);
  const off = layoutBubble({ ...SCREEN, ax: 640, ay: 2000, footY: 2050, w: 200, h: 60 });
  assert.equal(off.y, 720 - 8 - 60, 'a speaker below the screen is pinned to the bottom edge');
});

const apart = (p, q, gap) => p.x + p.w + gap <= q.x || q.x + q.w + gap <= p.x || p.y + p.h + gap <= q.y || q.y + q.h + gap <= p.y;

test('stackRects moves later bubbles off earlier ones', () => {
  const a = { x: 100, y: 300, w: 200, h: 60 };
  const b = { x: 150, y: 320, w: 200, h: 60, maxBottom: 380 };
  const c = { x: 800, y: 300, w: 100, h: 40 };
  const moved = stackRects([a, b, c], 3, 4, 0, 720, 1280);
  assert.equal(moved, 1);
  assert.equal(a.y, 300, 'the first bubble keeps its place');
  assert.ok(apart(a, b, 4));
  assert.ok(b.y + b.h <= 380, 'never pushed down onto its speaker');
  assert.equal(c.y, 300, 'a bubble that overlaps nothing stays put');
});

test('stackRects prefers a short sideways slide that keeps the tail over the speaker', () => {
  const a = { x: 400, y: 300, w: 200, h: 60 };
  const b = { x: 560, y: 300, w: 200, h: 60, ax: 700, tailPad: 14, maxBottom: 360 };
  stackRects([a, b], 2, 4, 8, 720, 1280);
  assert.equal(b.y, 300, 'stayed level');
  assert.equal(b.x, 604, 'slid right just past the first bubble');
  assert.ok(b.ax >= b.x + 14 && b.ax <= b.x + b.w - 14);
  const far = { x: 560, y: 300, w: 200, h: 60, ax: 570, tailPad: 14, maxBottom: 360 };
  stackRects([{ ...a }, far], 2, 4, 8, 720, 1280);
  assert.ok(far.y + far.h + 4 <= 300, 'a slide that would strand the tail is refused; it goes up');
  const top = { x: 100, y: 10, w: 200, h: 60 };
  const under = { x: 100, y: 20, w: 200, h: 60, ax: 200, tailPad: 14 };
  stackRects([top, under], 2, 4, 8, 720, 400);
  assert.ok(apart(top, under, 4), 'no room above or beside, so it moves below');
});

test('edgePoint places off-screen markers on the inset border', () => {
  const on = edgePoint(500, 300, 1280, 720, 40);
  assert.equal(on.onScreen, true);
  const right = edgePoint(3000, 360, 1280, 720, 40);
  assert.equal(right.onScreen, false);
  assert.ok(Math.abs(right.x - (1280 - 40)) < 1e-9);
  assert.ok(Math.abs(right.y - 360) < 1e-9);
  assert.ok(Math.abs(right.angle) < 1e-9);
  const up = edgePoint(640, -900, 1280, 720, 40);
  assert.ok(Math.abs(up.y - 40) < 1e-9);
  assert.ok(up.angle < 0);
  const out = {};
  assert.equal(edgePoint(0, 0, 100, 100, 10, out), out, 'writes into the given object');
});

test('numberStyle: crits big and yellow, heals green, XP gold', () => {
  const crit = numberStyle('#ffffff', '31', { crit: true });
  const norm = numberStyle('damage', '12');
  assert.equal(crit.kind, 'crit');
  assert.ok(crit.scale > norm.scale);
  assert.equal(crit.fill, '#ffe27a');
  assert.equal(numberStyle(undefined, '27!').kind, 'crit');
  assert.equal(numberStyle(undefined, '+8').kind, 'heal');
  assert.equal(numberStyle(undefined, '+15 XP').kind, 'xp');
  assert.equal(numberStyle('heal', '8').fill, '#58cf8f');
  assert.equal(numberStyle('#123456', '4').fill, '#123456');
});

// ------------------------------------------------------------------ color

test('color helpers', () => {
  assert.deepEqual(hexToRgbArray('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgbArray('#0f0'), [0, 255, 0]);
  assert.deepEqual(hexToRgbArray('bogus'), [255, 255, 255]);
  assert.equal(lighten('#000000', 1), '#ffffff');
  assert.equal(lighten('#204060', 0), '#204060');
  assert.ok(luminance(255, 255, 255) > 254);
  for (let t = 0; t < 10; t += 0.37) {
    const w = flickerWave(t, 1.3);
    assert.ok(w >= -1 && w <= 1);
  }
});

test('ambient light follows the day: neutral noon, golden morning, pink dusk, deep blue night', () => {
  const noon = ambientAt(12);
  assert.deepEqual([noon.r, noon.g, noon.b], [255, 255, 255]);
  assert.equal(noon.darkness, 0);
  const morning = ambientAt(7.2);
  assert.ok(morning.r > morning.b + 60, 'warm golden morning');
  const dusk = ambientAt(19.2);
  assert.ok(dusk.r > dusk.g && dusk.b > dusk.g, 'pink dusk');
  const night = ambientAt(0, { moon: 0 });
  assert.ok(night.darkness >= 0.82 && night.darkness <= 0.94, `night darkness ${night.darkness}`);
  assert.ok(night.b > night.r * 1.6, 'nights are blue');
  const moonlit = ambientAt(0, { moon: 1 });
  assert.ok(moonlit.darkness < night.darkness, 'clear moonlight is a little lighter');
  const cloudyNight = ambientAt(0, { moon: 1, cloud: 1 });
  assert.ok(cloudyNight.darkness > moonlit.darkness, 'clouds hide the moon');
});

test('weather and indoors shift the ambient', () => {
  const clear = ambientAt(13);
  const rain = ambientAt(13, { rain: 1 });
  assert.ok(rain.darkness > clear.darkness + 0.15, 'rain is darker');
  assert.ok(rain.b / rain.r > clear.b / clear.r, 'rain is cooler');
  const fog = ambientAt(13, { fog: 1 });
  assert.ok(fog.darkness > 0 && fog.darkness < rain.darkness);
  const inside = ambientAt(13, { indoor: 1 });
  assert.ok(inside.darkness > clear.darkness, 'indoors is a little darker');
  assert.ok(inside.r > inside.b + 30, 'and warmer');
  const flash = ambientAt(0, { rain: 1, sky: 1 });
  assert.ok(flash.darkness < 0.3, 'lightning lights up the night');
});

// ------------------------------------------------------------------ camera

function fakeGame(extra = {}) {
  return { settings: {}, map: { w: 160, h: 120 }, bus: new EventBus(), ...extra };
}

test('camera follows, snaps and clamps to the map', () => {
  const g = fakeGame();
  const cam = new Camera(g);
  cam.vw = 400;
  cam.vh = 240;
  const t = { x: 1000, y: 800 };
  cam.follow(t);
  cam.snap();
  assert.equal(cam.x, 1000 - 200);
  assert.equal(cam.y, 800 - 10 - 120);
  t.x = 5;
  t.y = 5;
  cam.snap();
  assert.equal(cam.x, 0);
  assert.equal(cam.y, 0);
  t.x = 160 * 16;
  t.y = 120 * 16;
  cam.snap();
  assert.equal(cam.x, 160 * 16 - 400);
  assert.equal(cam.y, 120 * 16 - 240);
  assert.ok(cam.inView(t.x - 10, t.y - 10));
  assert.ok(!cam.inView(0, 0));
});

test('camera leads in the direction of movement and snaps on teleports', () => {
  const g = fakeGame();
  const cam = new Camera(g);
  cam.vw = 400;
  cam.vh = 240;
  const t = { x: 1000, y: 900 };
  cam.follow(t);
  cam.snap();
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    t.x += 70 * dt;
    cam.update(dt);
  }
  const center = cam.x + cam.vw / 2;
  assert.ok(cam.lookX > 10, 'look-ahead builds up to the right');
  assert.ok(center > t.x - 3, `view leads or keeps up with the walker (${center - t.x})`);
  t.x += 600;
  cam.update(dt);
  assert.equal(cam.x, t.x - 200, 'a teleport cuts instead of panning across the map');
});

test('camera shake decays to zero; reduced motion shakes less', () => {
  const g = fakeGame();
  const cam = new Camera(g);
  cam.follow({ x: 1000, y: 900 });
  cam.snap();
  cam.shake(4, 0.3);
  let maxOff = 0;
  for (let i = 0; i < 6; i++) {
    cam.update(1 / 60);
    maxOff = Math.max(maxOff, Math.abs(cam.offX), Math.abs(cam.offY));
  }
  assert.ok(maxOff > 0.5);
  for (let i = 0; i < 40; i++) cam.update(1 / 60);
  assert.equal(cam.offX, 0);
  assert.equal(cam.offY, 0);
  const calm = new Camera(fakeGame({ settings: { reduceMotion: true } }));
  calm.shake(4, 0.3);
  assert.ok(calm.shakeAmp < 2);
});

// ------------------------------------------------------------------ particles

test('every particle type emits, moves and expires', () => {
  const p = new Particles({ settings: {} });
  const expected = ['dust', 'hit', 'spark', 'leaf', 'wood_chip', 'stone_chip', 'magic', 'heal', 'smoke', 'splash', 'ember', 'firefly', 'heart', 'levelup', 'poof', 'rain_splash', 'blood', 'note', 'sparkle'];
  for (const t of expected) assert.ok(PARTICLE_TYPES.includes(t), t);
  for (const t of PARTICLE_TYPES) assert.ok(p.emit(t, 100, 100) > 0, t);
  const n = p.count;
  assert.ok(n > 40);
  for (let i = 0; i < 60 * 15; i++) p.update(1 / 60);
  assert.equal(p.count, 0, 'everything dies eventually');
  assert.equal(p.emit('nope', 0, 0), 0);
  assert.equal(p.emit('dust', NaN, 0), 0);
});

test('particle pool is bounded and reuses its arrays', () => {
  const p = new Particles({ settings: {} }, 100);
  const xs = p.x;
  for (let i = 0; i < 50; i++) p.emit('spark', 0, 0, { count: 10 });
  assert.equal(p.count, 100);
  p.update(1 / 60);
  assert.equal(p.x, xs, 'no reallocation');
  p.clear();
  assert.equal(p.count, 0);
});

test('chips land on the ground and options override defaults', () => {
  const p = new Particles({ settings: {} });
  p.emit('wood_chip', 50, 50, { count: 5 });
  for (let i = 0; i < 40; i++) p.update(1 / 60);
  for (let i = 0; i < p.count; i++) assert.ok(p.z[i] >= 0);
  p.clear();
  p.emit('magic', 10, 10, { count: 3, color: '#123456', life: 5, z: 7 });
  assert.equal(p.count, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(p.z[i], 7);
    assert.ok(p.life[i] <= 5 && p.life[i] >= 3);
  }
  assert.equal(p.countOf('magic'), 3);
  const lights = [];
  p.emit('firefly', 0, 0, { count: 2 });
  for (let i = 0; i < 120; i++) p.update(1 / 60);
  p.collectLights({ addLight: (...a) => lights.push(a) });
  assert.ok(lights.length >= 1, 'fireflies glow');
});

// ------------------------------------------------------------------ bubbles

function bubbleGame(settings = {}) {
  return { settings: { textSpeed: 1, showThoughts: true, ...settings }, state: 'playing', bus: new EventBus() };
}

test('speech bubbles replace each other and expire', () => {
  const b = new Bubbles(bubbleGame());
  const lyra = { id: 'lyra', name: 'Lyra', x: 0, y: 0 };
  b.say(lyra, 'First.');
  b.say(lyra, 'Second thought, actually.');
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].text, 'Second thought, actually.');
  assert.ok(b.isSpeaking(lyra));
  assert.equal(b.say(lyra, '   '), null, 'empty speech is ignored');
  for (let i = 0; i < 60 * 12; i++) b.update(1 / 60);
  assert.equal(b.items.length, 0);
  assert.ok(!b.isSpeaking(lyra));
  const custom = b.say(lyra, 'Quick.', { duration: 1 });
  assert.equal(custom.life, 1);
  const gone = { id: 'x', x: 0, y: 0 };
  b.say(gone, 'Bye');
  gone.removed = true;
  b.update(0.01);
  assert.ok(!b.hasBubble(gone));
});

test('long speech is wrapped to at most four lines in the bubble', () => {
  const b = new Bubbles(bubbleGame());
  const e = { id: 'bram', name: 'Bram', x: 0, y: 0 };
  const bub = b.say(e, 'Iron does not lie to you, lad. It tells you exactly how hot it is and exactly how hard you hit it, and if you listen it tells you what it wants to become.');
  assert.ok(bub.lines.length <= 4);
  assert.ok(bub.lines[bub.lines.length - 1].endsWith(ELLIPSIS));
  assert.ok(bub.text.length > 100, 'the full text is kept');
});

test('thoughts wait for speech and respect the setting', () => {
  const g = bubbleGame();
  const b = new Bubbles(g);
  const lyra = { id: 'lyra', name: 'Lyra', x: 0, y: 0 };
  b.say(lyra, 'Hello there.');
  assert.equal(b.thought(lyra, 'I wonder...'), null, 'no thought over speech');
  b.clear(lyra);
  assert.ok(b.thought(lyra, 'The stars look close tonight.'));
  assert.ok(!b.isSpeaking(lyra));
  assert.ok(b.hasBubble(lyra));
  b.say(lyra, 'Did you see that?');
  assert.equal(b.items.length, 1, 'speech replaces the thought');
  g.settings.showThoughts = false;
  b.clear(lyra);
  assert.equal(b.thought(lyra, 'Hidden.'), null);
});

test('icons accept aliases and the thinking dots clear when she speaks', () => {
  const b = new Bubbles(bubbleGame());
  const e = { id: 'lyra', name: 'Lyra', x: 0, y: 0 };
  for (const name of ['!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...']) assert.ok(b.icon(e, name), name);
  assert.equal(b.icons.length, 1, 'one icon per entity');
  assert.equal(b.icon(e, 'love').name, 'heart');
  assert.equal(b.icon(e, 'angry').name, 'anger');
  assert.equal(b.icon(e, 'affection').name, 'heart', 'emotion names map to icons');
  assert.equal(b.icon(e, 'curiosity').name, '?');
  assert.equal(b.icon(e, 'not-an-icon'), null);
  b.icon(e, '...');
  b.say(e, 'Here is what I think.');
  assert.equal(b.icons.length, 0);
  for (const n of ICON_NAMES) assert.ok(['!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...'].includes(n));
});

test('floating numbers rise, fall back and recycle their slots', () => {
  const b = new Bubbles(bubbleGame());
  b.number(100, 100, '12', 'damage');
  const n = b.numbers.find((x) => x.active);
  const y0 = n.y;
  b.update(0.1);
  assert.ok(n.y < y0, 'rises first');
  for (let i = 0; i < 200; i++) b.number(0, 0, String(i), 'damage');
  assert.equal(b.numbers.length, 48, 'pool does not grow');
  for (let i = 0; i < 120; i++) b.update(1 / 60);
  assert.equal(b.numbers.filter((x) => x.active).length, 0);
  b.number(NaN, 0, '1');
  assert.equal(b.numbers.filter((x) => x.active).length, 0);
});

// ------------------------------------------------------------------ lighting

test('lighting flashes are pooled and fade out', () => {
  const L = new Lighting({ bus: new EventBus() });
  for (let i = 0; i < 100; i++) L.flash({ x: i, y: 0, r: 30, color: '#ffffff', duration: 0.5 });
  assert.equal(L.flashes.length, 64);
  assert.equal(L.activeFlashes(), 64);
  L.update(0.6);
  assert.equal(L.activeFlashes(), 0);
});

test('lighting collects lights, arrays and pooled lights, and skips junk', () => {
  const game = { bus: new EventBus(), clock: { hour: 23, day: 1, weather: { type: 'clear', intensity: 0 } }, weather: null, player: null, map: null };
  const L = new Lighting(game);
  L.beginFrame(1 / 60);
  assert.ok(L.darkness > 0.6);
  L.collect({ x: 1, y: 2, r: 40, color: '#ffb047', intensity: 1 });
  L.collect([
    { x: 3, y: 4, r: 20, color: '#a995ff', intensity: 0.5 },
    null,
    { x: NaN, y: 0, r: 10 },
    { x: 0, y: 0, r: 0 },
  ]);
  L.collect(null);
  L.addLight(5, 5, 12, '#d8ff7a', 0.4);
  L.flash({ x: 0, y: 0, r: 50, duration: 1 });
  L.collectFlashes();
  assert.equal(L.count, 4);
  L.beginFrame(1 / 60);
  assert.equal(L.count, 0);
  game.clock.hour = 12;
  L.beginFrame(1 / 60);
  assert.equal(L.darkness, 0);
});

// ------------------------------------------------------------------ weather + fx

test('weather levels ease in and lightning flashes then fades', () => {
  const game = { bus: new EventBus(), settings: {}, clock: { weather: { type: 'rain', intensity: 1 }, daylight: 1 }, player: null, map: null, camera: null };
  const w = new Weather(game);
  w.update(1);
  assert.ok(w.rain > 0 && w.rain < 0.5, 'rain fades in');
  for (let i = 0; i < 20; i++) w.update(1);
  assert.equal(w.rain, 1);
  game.clock.weather.type = 'clear';
  w.update(1);
  assert.ok(w.rain < 1 && w.rain > 0.5, 'and out again');
  w.strike();
  w.render(0.02);
  assert.ok(w.flash > 0.5);
  for (let i = 0; i < 60; i++) w.render(1 / 60);
  assert.equal(w.flash, 0);
});

test('fog noise tiles seamlessly', () => {
  for (const [x, y] of [
    [0.3, 0.7],
    [2.5, 3.1],
    [7.9, 0.2],
  ]) {
    const a = periodicNoise(x, y, 8, 911);
    const b = periodicNoise(x + 8, y, 8, 911);
    const c = periodicNoise(x, y + 16, 8, 911);
    assert.ok(Math.abs(a - b) < 1e-12 && Math.abs(a - c) < 1e-12);
    assert.ok(a >= 0 && a < 1);
  }
});

test('arrow frames cover sixteen directions', () => {
  assert.equal(arrowFrameForAngle(0), 0);
  assert.equal(arrowFrameForAngle(Math.PI / 2), 4);
  assert.equal(arrowFrameForAngle(Math.PI), 8);
  assert.equal(arrowFrameForAngle(-Math.PI / 2), 12);
  assert.equal(arrowFrameForAngle(Math.PI * 2 - 0.01), 0);
});

// ---------------------------------------------------------------- hit feedback (r8)

test('health bars: a hurt foe shows one, a villager a quieter one, the player none; they fade', async () => {
  const { HealthBars } = await import('../src/render/health_bars.js');
  const { EventBus } = await import('../src/core/events.js');
  const bus = new EventBus();
  const player = { id: 'player', x: 0, y: 0, hp: 50, maxHp: 60 };
  const wolf = { id: 'w1', x: 30, y: 0, hp: 20, maxHp: 26, kind: 'animal', faction: 'wild' };
  const bram = { id: 'bram', x: -30, y: 0, hp: 40, maxHp: 50, profile: { id: 'bram' }, faction: 'village' };
  const game = { bus, player, companion: null };
  const bars = new HealthBars(game);
  bus.emit('damage', { target: player, amount: 10 });
  bus.emit('damage', { target: wolf, amount: 6 });
  bus.emit('damage', { target: bram, amount: 3, accident: true });
  const shown = bars.shown();
  assert.equal(shown.length, 2, 'never over the player');
  const w = shown.find((b) => b.actor === wolf);
  assert.ok(Math.abs(w.frac - 20 / 26) < 1e-9);
  assert.equal(w.friend, false);
  assert.equal(shown.find((b) => b.actor === bram).friend, true);
  // draws without error on a stand-in canvas, then fades after a few seconds
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => ((o[k] = v), true) });
  const r = { scale: 3, dpr: 1, ox: -100, oy: -100, subX: 0, subY: 0 };
  bars.draw(ctx, r, 0.016);
  assert.ok(calls.some((c) => c[0] === 'fillRect'));
  for (let i = 0; i < 300; i++) bars.update(0.016);
  assert.equal(bars.shown().length, 0, 'gone a few seconds after the last hit');
  // a death clears it at once
  bus.emit('damage', { target: wolf, amount: 6 });
  bus.emit('death', { entity: wolf });
  assert.equal(bars.shown().length, 0);
});

test('damage numbers read on any ground: essence tints are lifted toward white', async () => {
  const { readableFill } = await import('../src/render/text_layout.js');
  const [r, g, b] = hexToRgbArray(readableFill('#7a5cd6')); // a pale violet spark on grass
  assert.ok(luminance(r, g, b) >= 195);
  assert.equal(readableFill('#ffffff'), '#ffffff');
  assert.ok(numberStyle('damage', '9').scale >= 1.25, 'damage numbers are big');
});
