// Screenshots of DESIGN §29 in headless Chromium on the built game:
//   node scripts/murder_shots.mjs [--src] [--out dir] [--only desktop|landscape|portrait]
// The finishing blow (the first-time warning, the held ring), a body where it fell, the
// body found and covered, the body laid out in the chapel, the funeral, the watch
// questioning the player, and the plea before the Moot. Exits 1 on any page error.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const useSrc = argv.includes('--src');
const OUT = arg('out', 'screenshots/murder');
const ONLY = arg('only', null);
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useSrc ? 'index.html' : 'dist/index.html'}`;
const browser = await chromium.launch();
const errors = [];

const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'landscape', viewport: { width: 844, height: 390 }, touch: true },
  { name: 'portrait', viewport: { width: 390, height: 844 }, touch: true },
].filter((v) => !ONLY || v.name === ONLY);

for (const view of VIEWS) {
  const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: 1, hasTouch: view.touch, isMobile: view.touch });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`[${view.name}] pageerror: ${err.message}\n${(err.stack || '').split('\n').slice(0, 5).join('\n')}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${view.name}] console.error: ${t}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing');
  await page.waitForTimeout(600);
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${view.name}-${name}.png` });
  };
  const run = (seconds) =>
    page.evaluate((s) => {
      const g = window.__game;
      for (let i = 0; i < Math.round(s * 30); i++) g.update(1 / 30);
    }, seconds);

  // Set the stage: mid-afternoon, Bram and the stranger on the woods' edge path, alone.
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.skipTo(14);
    const T = 16;
    const bram = g.entities.get('bram');
    const P = g.player;
    const spot = (tx, ty) => ({ x: tx * T + 8, y: ty * T + 8 });
    const a = spot(63, 14);
    const b = spot(62, 14);
    for (const e of g.entities.all()) {
      if (e.profile && e !== bram) {
        e.x = 150 * T;
        e.y = 110 * T;
        e.walker?.stop?.();
      }
    }
    const L = g.companion;
    L.x = 150 * T;
    L.y = 112 * T;
    L._held = L.controller;
    L.controller = null;
    bram.x = a.x;
    bram.y = a.y;
    bram.walker?.stop?.();
    P.x = b.x;
    P.y = b.y;
    P.faceToward(bram.x, bram.y);
    g.camera.snap?.();
    bram.hp = 1;
    g.combat.damage(P, bram, 999, { exact: true, crit: false });
    g.flags.finisherWarned = false;
    // No beast wanders into the scene (a wolf's bite knocks the stranger out of reach of
    // the held blow and the shots go wrong): the Whisperwood's creatures are sent off.
    for (const e of g.entities.all()) if (e.species && Math.hypot(e.x - P.x, e.y - P.y) < 600) e.removed = true;
    g.spawner && (g.spawner.update = () => {});
    // The downed crawl away from whoever downed them (r14a): Bram stays where he fell for
    // the shots (on a loaded machine the page's own clock let him crawl out of reach).
    const fall = g.survival?.falls?.get?.(bram);
    if (fall) fall.crawled = 1e9;
  });
  await run(0.5);
  // The first time: the warning.
  await page.evaluate(() => window.__game.murder.onAttackPress(window.__game.player));
  await shot('1-warning');
  await page.evaluate(() => {
    const g = window.__game;
    const btn = [...document.querySelectorAll('.panel-confirm button')].find((b) => /understand/i.test(b.textContent));
    btn?.click();
  });
  await page.waitForTimeout(200);
  // The held ring.
  await page.evaluate(() => {
    const g = window.__game;
    const bram = g.entities.get('bram');
    g.player.x = bram.x - 14;
    g.player.y = bram.y;
    g.player.faceToward(bram.x, bram.y);
    g.murder.onAttackPress(g.player);
    g.murder.hold.auto = true;
  });
  await run(0.9);
  await shot('2-hold');
  await run(1);
  await shot('3-body');
  // Night: the same body under no light at all, then the lake.
  // Found: Hess comes on it.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.murder;
    const hess = g.entities.get('hess');
    const bram = g.entities.get('bram');
    hess.x = bram.x + 26;
    hess.y = bram.y + 10;
    hess.walker?.stop?.();
    g.player.x = bram.x - 90;
    g.player.y = bram.y + 60;
    m.found('bram', 'hess', 'whisperwood');
    const rowan = g.entities.get('rowan');
    rowan.x = bram.x - 22;
    rowan.y = bram.y + 14;
    rowan.walker?.stop?.();
    g.camera.follow(bram);
    g.camera.snap();
  });
  await run(12);
  await shot('4-found-covered');
  // Laid out in the chapel.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.murder;
    const rec = m.dead.bram;
    rec.chapelAt = 0;
    g.camera.follow(g.player);
    g.player.x = 88 * 16 + 8;
    g.player.y = 50 * 16 + 8;
    g.camera.snap();
  });
  await run(2.2);
  await page.evaluate(() => {
    const g = window.__game;
    g.camera.snap();
  });
  await shot('5-laid-out');
  // The funeral: the next dusk, in the chapel.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.murder;
    const f = m.funerals.find((x) => x.about === 'bram');
    g.clock.skipTo(16.9);
    f.day = g.clock.day;
    g.player.x = 88 * 16 + 8;
    g.player.y = 51 * 16;
  });
  await run(2.5);
  await page.waitForFunction(() => window.__game.story?.isPlaying?.(), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1400);
  await shot('6-funeral');
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(view.viewport.width / 2, view.viewport.height / 2);
    await page.waitForTimeout(900);
  }
  await shot('7-funeral-words');
  await page.evaluate(() => window.__game.story?.player?.skip?.());
  await page.waitForFunction(() => !window.__game.story?.isPlaying?.(), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  // The watch asks: a sighting puts the stranger with Bram that day.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.murder;
    const rec = m.dead.bram;
    rec.snap.victim.unshift({ by: 'tilly', t: Math.round(rec.t - 20), place: 'whisperwood', with: 'player', heading: null });
    g.clock.skipTo(10);
    const rowan = g.entities.get('rowan');
    const sq = g.locations.get('town_square').center;
    g.player.x = sq.x;
    g.player.y = sq.y;
    rowan.x = sq.x + 24;
    rowan.y = sq.y;
    rowan.walker?.stop?.();
    g.camera.snap();
    m.cases.bram.state = 'open';
    m.beginQuestioningUI('bram');
  });
  await shot('8-questioning');
  await page.evaluate(() => document.querySelector('.panel-questioning .opt-lie')?.click());
  await page.waitForTimeout(300);
  await shot('9-lie-caught');
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) (document.querySelector('.panel-questioning .opt-lie') || document.querySelector('.panel-questioning .dlg-opt'))?.click();
  });
  await page.waitForSelector('.panel-arrest', { timeout: 3000 }).catch(() => {});
  // Not enough to hold them this time: the Moot sends for the stranger anyway (for the shots).
  await page.evaluate(() => {
    const g = window.__game;
    document.querySelector('.panel-questioning .dlg-opt')?.click();
    if (!document.querySelector('.panel-arrest')) g.murder.arrestOffer('rowan', 'bram');
  });
  await page.waitForSelector('.panel-arrest', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await shot('10-arrest');
  await page.evaluate(() => document.querySelector('.panel-arrest .opt-quiet')?.click());
  await page.waitForFunction(() => window.__game.story?.isPlaying?.(), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('11-moot');
  await page.evaluate(() => window.__game.story?.player?.skip?.());
  await page.waitForSelector('.panel-plea', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot('12-plea');
  await page.evaluate(() => document.querySelector('.panel-plea .opt-deny')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.story?.player?.skip?.());
  await page.waitForTimeout(1500);
  await shot('13-verdict');
  const state = await page.evaluate(() => {
    const g = window.__game;
    const m = g.murder;
    return { verdict: m.cases.bram?.verdict, crime: g.player.crime?.kind, graves: m.graves.length, lyra: g.companion.mind?.companionship, events: m.life.events.filter((e) => !e.hidden).slice(-8).map((e) => e.text) };
  });
  console.log(`[${view.name}]`, JSON.stringify(state, null, 1));
  await context.close();
}

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('MURDER SHOTS OK');
