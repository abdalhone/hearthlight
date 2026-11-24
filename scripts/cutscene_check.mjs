// Cutscenes on a phone: the New Game prologue tapped quickly through every line, with the
// voice clips working, failing (requests blocked) and slow (each clip held back 9 s).
//   npm run build && node scripts/cutscene_check.mjs [outDir]
// Every run must finish the prologue in well under a minute of fast taps and leave the
// player in the Wayhouse; taps must land on the cutscene (not on the title underneath).
// Prints one JSON line per run; exits 1 on a failure.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'screenshots/cutscenes';
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

for (const size of SIZES) for (const v of VOICES) await run(size, v);
await browser.close();
server.close();
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exit(1);
}
console.log('cutscene check: all runs finished the prologue by tapping');
