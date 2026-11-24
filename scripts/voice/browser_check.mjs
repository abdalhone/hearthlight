#!/usr/bin/env node
// Plays rendered clips inside the built game in headless Chromium (DESIGN.md §21):
// real fetch, real MP3 decoding, the priority rules and music ducking, through the same
// calls the game makes. Run after `npm run build`.
//
//   node scripts/voice/browser_check.mjs [--mobile] [--live]
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mobile = process.argv.includes('--mobile');

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'dist/voice/manifest.json'), 'utf8'));
const lines = ['scripts/voice/lines.json', 'scripts/voice/lines.sample.json']
  .map((f) => path.join(ROOT, f))
  .filter(existsSync)
  .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).lines)
  .filter((l) => manifest.clips[l.key]);
const pick = (sp) => lines.find((l) => l.speaker === sp);
const villager = lines.find((l) => !['lyra', 'narrator', 'lyra_young'].includes(l.speaker));
const lyra = pick('lyra');
const narrator = pick('narrator');

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 20000 });
await page.evaluate(() => window.__game.newGame());
await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });
await page.mouse.click(200, 200);

const result = await page.evaluate(
  async ({ villager, lyra, narrator }) => {
    const g = window.__game;
    g.audio.unlock();
    const out = {};
    const t0 = performance.now();
    await g.voice.loadManifest();
    out.manifestMs = Math.round(performance.now() - t0);
    out.clips = g.voice.manifest.size;
    const timed = async (fn) => {
      const a = performance.now();
      const r = await fn();
      return { ...r, ms: Math.round(performance.now() - a) };
    };
    // A villager line, as the cutscene engine would await it.
    out.villager = await timed(() => g.voice.play({ speaker: villager.speaker, text: villager.text, kind: 'cutscene' }));
    out.musicDuckedDuring = null;
    // Lyra's line through the speech bus (her bubble), while we watch the music duck.
    const lyraP = g.voice.say({ speaker: 'lyra', text: lyra.text, kind: 'bark' });
    await new Promise((r) => setTimeout(r, 150));
    out.duckedWhileSpeaking = !!g.audio.ducking;
    out.lyra = await lyraP;
    await new Promise((r) => setTimeout(r, 600));
    out.duckReleased = !g.audio.ducking;
    // Priority: a villager cannot talk over the narrator; the narrator stops Lyra.
    const n = g.voice.play({ speaker: 'narrator', text: narrator.text, kind: 'cutscene' });
    await new Promise((r) => setTimeout(r, 50));
    out.villagerOverNarrator = await g.voice.say({ speaker: villager.speaker, text: villager.text });
    g.voice.stop();
    out.narrator = await n;
    // An unknown line falls back without a fetch.
    out.unknown = await g.voice.say({ speaker: villager.speaker, text: 'Nobody ever recorded this one.' });
    // A second play of the same clip is served from the decode cache.
    out.cached = await timed(() => g.voice.play({ speaker: villager.speaker, text: villager.text, kind: 'cutscene' }));
    out.stats = g.voice.stats;
    return out;
  },
  { villager, lyra, narrator },
);
console.log(JSON.stringify(result, null, 1));

// --live: her live Kokoro voice inside the game (needs `npm run build -- --kokoro`).
let liveOk = true;
if (process.argv.includes('--live')) {
  const live = await page.evaluate(async () => {
    const g = window.__game;
    // Measure even on a slow machine: the real limit would stand the voice down here.
    window.__HEARTHLIGHT_VOICES__.maxRtf = 10;
    const t0 = performance.now();
    g.setSetting('kokoroLive', true);
    const lv = g.brain.voice.live;
    while (lv.state === 'loading' || lv.state === 'off') await new Promise((r) => setTimeout(r, 100));
    const out = { state: lv.state, error: lv.error, loadMs: Math.round(performance.now() - t0), info: lv.engine?.info, status: lv.statusText() };
    if (lv.state !== 'ready') return out;
    const s = performance.now();
    const r = await g.brain.voice.speakLive("Wicks and ashes, you walked right past the lamp again, didn't you?", { kind: 'reply' });
    out.reply = { ...r, ms: Math.round(performance.now() - s), sentenceMs: lv.engine.timings.slice(-3).map(Math.round) };
    out.liveStats = g.voice.stats.live;
    return out;
  });
  console.log('live:', JSON.stringify(live, null, 1));
  liveOk = live.state === 'ready' && live.reply?.ok && live.liveStats >= 1;
}
await browser.close();
server.close();
const ok =
  result.villager.ok && result.lyra.ok && result.duckedWhileSpeaking && result.duckReleased && result.villagerOverNarrator.reason === 'busy' &&
  result.narrator.reason === 'stopped' && result.unknown.reason === 'no_clip' && result.cached.ok && liveOk && !errors.length;
if (errors.length) console.log('page errors:', errors);
console.log(ok ? 'VOICE CHECK PASSED' : 'VOICE CHECK FAILED');
process.exit(ok ? 0 : 1);
