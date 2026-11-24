// Cutscenes on a phone: the New Game prologue tapped quickly through every line, with the
// voice clips working, failing (requests blocked) and slow (each clip held back 9 s).
//   npm run build && node scripts/cutscene_check.mjs [outDir] [--listen [seconds]]
// Every run must finish the prologue in well under a minute of fast taps and leave the
// player in the Wayhouse; taps must land on the cutscene (not on the title underneath).
// --listen also plays the prologue untouched with voices working and with voices blocked,
// sampling the captions against the voice's own clock: with a clip, every word must be on
// screen within a frame or two of being spoken (never before); without one, the line types
// itself; the scene's sound (bed, heartbeat, silence, slam) must run; no stall.
// Prints one JSON line per run; exits 1 on a failure.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const out = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--listen') || 'screenshots/cutscenes';
const listenAt = argv.indexOf('--listen');
const LISTEN_S = listenAt >= 0 ? Number(argv[listenAt + 1]) || 400 : 0;
await mkdir(out, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const SIZES = [
  { name: 'p390x640', w: 390, h: 640 },
  { name: 'l844x340', w: 844, h: 340 },
];
const VOICES = ['ok', 'blocked', 'slow'];
const LIMIT_S = 50;
const failures = [];

async function run(size, voice) {
  const label = `${size.name}-${voice}`;
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let voiceRequests = 0;
  await page.route(/\/voice\/.+\.(mp3|json)$/, async (route) => {
    voiceRequests++;
    if (voice === 'blocked' && route.request().url().endsWith('.mp3')) return route.abort();
    if (voice === 'slow' && route.request().url().endsWith('.mp3')) await new Promise((r) => setTimeout(r, 9000));
    return route.continue().catch(() => {});
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.getByRole('button', { name: /New game/ }).first().tap();
  await page.getByRole('button', { name: /^Begin$/ }).first().tap();
  await page.waitForFunction(() => window.__game?.story?.isPlaying?.(), null, { timeout: 15000 });
  const t0 = Date.now();
  // Tap in the middle of the lower third (where the words are), fast, until it ends.
  const x = Math.round(size.w / 2);
  const y = Math.round(size.h * 0.7);
  let taps = 0;
  let hitScene = 0;
  let shot = false;
  let maxLine = 0;
  while (Date.now() - t0 < 120000) {
    const st = await page.evaluate(
      ([px, py]) => {
        const g = window.__game;
        const cp = g.story.player;
        const at = document.elementFromPoint(px, py);
        return { playing: g.story.isPlaying(), state: g.state, onScene: !!at?.closest?.('.cs-root'), text: cp.textEl?.textContent || '' };
      },
      [x, y],
    );
    if (!st.playing) break;
    if (st.onScene) hitScene++;
    if (!shot && st.text.length > 20 && Date.now() - t0 > 3000) {
      await page.screenshot({ path: `${out}/${label}-mid.png` });
      shot = true;
    }
    await page.touchscreen.tap(x, y);
    taps++;
    maxLine++;
    await page.waitForTimeout(110);
  }
  const took = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1200);
  const end = await page.evaluate(() => {
    const g = window.__game;
    return { state: g.state, playing: g.story.isPlaying(), seen: g.story.seen('prologue'), lyraNear: Math.hypot(g.companion.x - g.player.x, g.companion.y - g.player.y) < 80, voice: { ...g.voice.stats } };
  });
  await page.screenshot({ path: `${out}/${label}-after.png` });
  const ok = took < LIMIT_S && end.state === 'playing' && !end.playing && end.seen && errors.length === 0 && hitScene >= taps * 0.9;
  const row = { label, ok, seconds: Math.round(took * 10) / 10, taps, tapsOnScene: hitScene, voiceRequests, end, errors };
  console.log(JSON.stringify(row));
  if (!ok) failures.push(label);
  await context.close();
}

// Untouched: the words follow the voice, the sound runs, nothing stalls.
async function listen(size, voice) {
  const label = `${size.name}-listen-${voice}`;
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/voice\/.+\.mp3$/, (route) => (voice === 'blocked' ? route.abort() : route.continue().catch(() => {})));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.getByRole('button', { name: /New game/ }).first().tap();
  await page.getByRole('button', { name: /^Begin$/ }).first().tap();
  await page.waitForFunction(() => window.__game?.story?.isPlaying?.(), null, { timeout: 15000 });
  // Watch from inside the page every animation frame: captions against the voice clock.
  await page.evaluate(() => {
    const g = window.__game;
    const cp = g.story.player;
    const rec = (window.__listen = { startedAt: performance.now(), lines: 0, voiced: 0, typed: 0, samples: 0, early: 0, lateMax: 0, lateOver: 0, beds: new Set(), heart: 0, hush: 0, slam: 0, lastText: '', stalls: 0, lastChange: performance.now() });
    let lastTyping = null;
    // Listen to the mix itself (everything goes through the master bus): never dead air,
    // and the voice on top of the effects.
    let an = null;
    let buf = null;
    rec.levels = { voice: [], rest: [], dead: 0, frames: 0 };
    const level = () => {
      const a = g.audio;
      if (!an && a?.ctx && a.master) {
        an = a.ctx.createAnalyser();
        an.fftSize = 2048;
        a.master.connect(an);
        buf = new Float32Array(an.fftSize);
      }
      if (!an) return null;
      an.getFloatTimeDomainData(buf);
      let e = 0;
      for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
      return 10 * Math.log10(e / buf.length + 1e-12);
    };
    const frame = () => {
      if (!g.story.isPlaying()) return;
      const db = level();
      if (db != null && cp.sound && !cp.sound.hushed && performance.now() - rec.startedAt > 3000) {
        rec.levels.frames++;
        if (db < -60) rec.levels.dead++;
        (g.voice.speaking() ? rec.levels.voice : rec.levels.rest).push(db);
      }
      const ty = cp.typing;
      const snd = cp.sound;
      if (snd) {
        if (snd.bedName) rec.beds.add(snd.bedName);
        if (snd.bpm > 0) rec.heart++;
        if (snd.hushed) rec.hush++;
        if (snd.hushed) rec.wasHushed = true;
        else if (rec.wasHushed) (rec.slam++, (rec.wasHushed = false));
      }
      if (ty && ty !== lastTyping) {
        lastTyping = ty;
        rec.lines++;
        ty.__counted = false;
      }
      if (ty && ty.words && ty.spans) {
        if (!ty.__counted) (rec.voiced++, (ty.__counted = true));
        const t = g.voice.elapsed();
        if (t >= 0 && !ty.done) {
          rec.samples++;
          const due = ty.words.filter((w) => w <= t + 0.03).length;
          const shown = ty.spans.filter((s) => s.classList.contains('on')).length;
          if (shown > due + 0) rec.early++;
          // A word should be up within two frames (~40 ms) of its time.
          const lateBy = ty.words.slice(shown).filter((w) => w < t - 0.05).length;
          rec.lateMax = Math.max(rec.lateMax, lateBy);
          if (lateBy > 0) rec.lateOver++;
        }
      }
      const text = cp.textEl?.textContent || '';
      if (text !== rec.lastText || ty?.next !== rec.lastNext) {
        rec.lastText = text;
        rec.lastNext = ty?.next;
        rec.lastChange = performance.now();
      } else if (performance.now() - rec.lastChange > 25000) {
        rec.stalls++;
        rec.lastChange = performance.now();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < LISTEN_S * 1000) {
    const st = await page.evaluate(() => ({ playing: window.__game.story.isPlaying(), spans: !!window.__game.story.player.typing?.spans }));
    if (!st.playing) break;
    if (shot < 2 && Date.now() - t0 > 6000 + shot * 20000) {
      await page.screenshot({ path: `${out}/${label}-${shot}.png` });
      shot++;
    }
    await page.waitForTimeout(500);
  }
  const took = (Date.now() - t0) / 1000;
  const r = await page.evaluate(() => {
    const L = window.__listen;
    const g = window.__game;
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
    const mix = { voiceDb: med(L.levels.voice), restDb: med(L.levels.rest), deadAir: L.levels.frames ? Math.round((1000 * L.levels.dead) / L.levels.frames) / 1000 : null };
    return { ...L, levels: undefined, mix, beds: [...L.beds], playing: g.story.isPlaying(), state: g.state, voice: { ...g.voice.stats } };
  });
  const finished = !r.playing && r.state === 'playing';
  const ok =
    errors.length === 0 &&
    r.stalls === 0 &&
    r.early === 0 &&
    r.lateMax <= 1 &&
    (voice === 'ok' ? r.voiced >= Math.min(8, r.lines - 2) && r.voice.played >= r.voiced : r.voiced === 0) &&
    r.beds.length >= 1 &&
    (r.mix.deadAir == null || r.mix.deadAir < 0.02) &&
    (voice !== 'ok' || r.mix.voiceDb == null || r.mix.restDb == null || r.mix.voiceDb > r.mix.restDb + 6) &&
    (!finished || (r.hush > 0 && r.slam > 0 && r.heart > 0));
  const row = { label, ok, seconds: Math.round(took), finished, lines: r.lines, voiced: r.voiced, samples: r.samples, wordsEarly: r.early, wordsLateMax: r.lateMax, lateSamples: r.lateOver, beds: r.beds, heartFrames: r.heart, hushFrames: r.hush, slams: r.slam, stalls: r.stalls, mix: r.mix, voice: r.voice, errors };
  console.log(JSON.stringify(row));
  if (!ok) failures.push(label);
  await context.close();
}

if (LISTEN_S) {
  for (const size of SIZES) for (const v of ['ok', 'blocked']) await listen(size, v);
} else for (const size of SIZES) for (const v of VOICES) await run(size, v);
await browser.close();
server.close();
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exit(1);
}
console.log('cutscene check: all runs finished the prologue by tapping');
