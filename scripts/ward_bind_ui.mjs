// The bind and ward in the interface (DESIGN §22.5): their aim previews under the mouse
// (a ring closing on the foe, a dome over Lyra), what a cast leaves on screen, the
// hotbar glyphs, and the Spellbook (tiles, words, the live preview) on a desktop and on
// a phone held both ways. Fails on page errors.
//   node scripts/ward_bind_ui.mjs [--dist] [--out DIR]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/wardbind';
await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useDist ? 'dist/index.html' : 'index.html'}`;
const browser = await chromium.launch();
const errors = [];

async function open(size, touch) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    const m = g.magic;
    m.unlockAll();
    m.setSlot(0, { shape: 'bind', essences: ['fire'], twists: [] });
    m.setSlot(1, { shape: 'ward', essences: ['light'], twists: [] });
    m.setSlot(2, { shape: 'bind', essences: ['frost', 'nature'], twists: ['multishot'] });
    m.setSlot(3, { shape: 'ward', essences: ['earth', 'song'], twists: ['linger'] });
    const p = g.player;
    p.hp = p.maxHp;
    // A wolf to the right, Lyra to the left.
    const proto = g.entities.all().find((e) => e.species === 'wolf') || g.entities.all().find((e) => e.species);
    const C = proto.constructor;
    const w = new C(g, 'wolf', { x: p.x + 70, y: p.y - 6 });
    w.controller = null;
    w.maxHp = w.hp = 400;
    g.entities.add(w);
    window.__wolf = w;
    const l = g.companion;
    if (l) {
      l.x = p.x - 46;
      l.y = p.y + 4;
    }
    g.clock.skipTo(14);
  });
  await page.waitForTimeout(400);
  return { ctx, page };
}

const at = (page, who) =>
  page.evaluate((who) => {
    const g = window.__game;
    const e = who === 'wolf' ? window.__wolf : g.companion;
    const r = g.renderer;
    const d = r.worldToDevice(e.x, e.y - 8);
    const dpr = r.dpr || 1;
    return { x: d.x / dpr, y: d.y / dpr };
  }, who);

// ------------------------------------------------------------------ desktop
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  const wolf = await at(page, 'wolf');
  await page.mouse.move(wolf.x, wolf.y);
  await page.keyboard.down('1');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ui-desktop-bind-aim.png` });
  await page.keyboard.up('1');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/ui-desktop-bind-held.png` });
  const held = await page.evaluate(() => window.__game.magic.status.has(window.__wolf, 'bound'));
  console.log(`desktop: the wolf is held: ${held}`);
  const lyra = await at(page, 'lyra');
  await page.mouse.move(lyra.x, lyra.y);
  await page.keyboard.down('2');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ui-desktop-ward-aim.png` });
  await page.keyboard.up('2');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/ui-desktop-ward-on-lyra.png` });
  const on = await page.evaluate(() => !!window.__game.magic.wardOn(window.__game.companion));
  console.log(`desktop: Lyra is warded: ${on}`);
  await page.evaluate(() => window.__game.ui.openSpellbook(0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/ui-desktop-spellbook-bind.png` });
  await page.evaluate(() => window.__game.ui.openSpellbook(1));
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/ui-desktop-spellbook-ward.png` });
  await ctx.close();
}

// ------------------------------------------------------------------ phones
for (const [label, size] of [
  ['phone-land', { width: 844, height: 390 }],
  ['phone-port', { width: 390, height: 844 }],
]) {
  const { ctx, page } = await open(size, true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ui-${label}-hotbar.png` });
  // Drag a weave button toward the mark: the preview while the finger is down.
  const cdp = await ctx.newCDPSession(page);
  for (const [slot, name, dx, dy] of [
    [0, 'bind', 50, -4],
    [1, 'ward', -46, 4],
  ]) {
    const b = await page.evaluate((i) => {
      const el = document.querySelectorAll(".tcluster .wbtn")[i];
      const r = el?.getBoundingClientRect();
      return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    }, slot);
    if (!b) {
      errors.push(`${label}: no button for weave ${slot + 1}`);
      continue;
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 5 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + (dx * i) / 6, y: b.y + (dy * i) / 6, id: 5 }] });
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/ui-${label}-${name}-drag.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/ui-${label}-${name}-cast.png` });
  }
  // A ward cast by a tap: on yourself.
  await page.evaluate(() => {
    const g = window.__game;
    g.magic.cast(g.player, 1, { x: g.player.x + 1, y: g.player.y });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ui-${label}-ward-tap.png` });
  await page.evaluate(() => window.__game.ui.openSpellbook(2));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/ui-${label}-spellbook.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push(`${label}: horizontal overflow with the Spellbook open`);
  await ctx.close();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('[wardbind ui] no page errors');
await browser.close();
server.close();
