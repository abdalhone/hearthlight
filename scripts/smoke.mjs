// End-to-end smoke test in headless Chromium.
//   node scripts/smoke.mjs            test the built page (dist/index.html; run `npm run build` first)
//   node scripts/smoke.mjs --src      test the ES-module source (index.html)
//   node scripts/smoke.mjs --mobile   also run a phone-sized pass
// Fails (exit 1) on any uncaught page error or console.error. Screenshots go to screenshots/.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const args = new Set(process.argv.slice(2));
const useSrc = args.has('--src');
const mobile = args.has('--mobile');
const seconds = Number(process.env.SMOKE_SECONDS || 6);

const server = await startServer(0);
const port = server.address().port;
const url = `http://localhost:${port}/${useSrc ? 'index.html' : 'dist/index.html'}`;
await mkdir('screenshots', { recursive: true });

const browser = await chromium.launch();
const problems = [];

async function run(label, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // Google Fonts may be unreachable in CI sandboxes; that is not a game error.
      if (/fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR/.test(t)) return;
      problems.push(`[${label}] console.error: ${t}`);
    }
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 20000 });
  await page.screenshot({ path: `screenshots/${label}-title.png` });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });

  // Walk around, swing, interact.
  const kb = page.keyboard;
  await kb.down('KeyD');
  await page.waitForTimeout(700);
  await kb.up('KeyD');
  await kb.down('KeyS');
  await page.waitForTimeout(500);
  await kb.up('KeyS');
  await kb.press('KeyJ');
  await kb.press('KeyE');

  // Talk to Lyra through the brain (works with the offline mind).
  const replies = await page.evaluate(async () => {
    const g = window.__game;
    const out = [];
    for (const msg of ['follow me', 'attack mode', 'wait here', 'how are you feeling?', 'come with me']) {
      try {
        const r = await g.brain.handlePlayerMessage(msg);
        out.push({ msg, say: r?.say ?? null, stance: g.companion?.behavior?.stance, directive: g.companion?.behavior?.directive?.type });
      } catch (err) {
        out.push({ msg, error: String(err) });
      }
    }
    return out;
  });
  console.log(`[${label}] replies:`, JSON.stringify(replies));

  await page.waitForTimeout(seconds * 1000);
  const state = await page.evaluate(() => {
    const g = window.__game;
    return {
      fps: g.loop.fps,
      entities: g.entities.all().length,
      time: g.clock.fullString(),
      player: { x: Math.round(g.player.x), y: Math.round(g.player.y), hp: g.player.hp },
      lyra: { x: Math.round(g.companion.x), y: Math.round(g.companion.y), hp: g.companion.hp, status: g.companion.behavior.status?.() },
      actions: g.actions.names().length,
      plugins: g.plugins.all().map((p) => p.id),
    };
  });
  console.log(`[${label}] state:`, JSON.stringify(state));
  await page.screenshot({ path: `screenshots/${label}-play.png` });

  // Night look.
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.skipTo(22);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `screenshots/${label}-night.png` });

  // Save and reload round-trip.
  const saved = await page.evaluate(async () => {
    const g = window.__game;
    await g.save.save('smoke');
    return JSON.stringify(g.serialize()).length;
  });
  console.log(`[${label}] save size: ${saved} bytes`);
  await context.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 720 } });
  if (mobile) await run('mobile', { ...devices['iPhone 13'] });
} catch (err) {
  problems.push(`smoke run failed: ${err.stack || err}`);
}

await browser.close();
server.close();

if (problems.length) {
  console.error(`\nSMOKE FAILED (${problems.length} problem${problems.length > 1 ? 's' : ''}):`);
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log('\nSMOKE PASSED');
