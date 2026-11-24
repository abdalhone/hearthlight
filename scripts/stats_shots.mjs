// Screenshots of the character sheet, Bram's forge, the Spellbook with prices and the HUD
// timers (DESIGN §25–26) on a phone (both ways up) and a desktop. Fails on page errors.
//   node scripts/stats_shots.mjs [outDir]       (run `npm run build` first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || 'screenshots/stats';
await mkdir(out, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const problems = [];

const SIZES = [
  ['phone-land', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['phone-port', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 }],
];

for (const [label, opts] of SIZES) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${label}] ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) problems.push(`[${label}] console.error ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  // A stranger a few levels in, with gear, points to spend and prices running.
  await page.evaluate(() => {
    const g = window.__game;
    const P = g.player;
    g.combat.giveXp(P, 20 + 38 + 64 + 98);
    g.progression.spend('vitality', 3);
    g.progression.spend('might', 2);
    g.progression.spend('grace', 2);
    g.progression.spend('resolve', 1);
    for (const id of ['steel_sword', 'iron_mail', 'murrel_cloak', 'roadrunner_boots', 'hearth_charm', 'moonglass_bead', 'iron_sword', 'leather_jerkin', 'lakewort_cloak', 'lucky_knucklebone', 'saints_thread', 'traveler_cloak']) P.inventory.add(id, 1);
    P.inventory.add('iron_ore', 9);
    P.inventory.add('crystal', 3);
    P.inventory.add('coin', 300);
    for (const id of ['steel_sword', 'iron_mail', 'murrel_cloak', 'roadrunner_boots', 'hearth_charm', 'moonglass_bead']) g.gear.equip(id);
    g.gear.upgrade('steel_sword');
    g.magic.unlockAll();
    g.magic.setSlot(0, { shape: 'bolt', essences: ['fire'], twists: ['split'], prices: ['bloodprice'] });
    g.magic.setSlot(1, { shape: 'surge', essences: ['wind'], twists: [] });
    g.magic.setSlot(2, { shape: 'strike', essences: ['iron'], twists: [], prices: ['berserk'] });
    g.magic.cast(P, 0, { x: P.x + 60, y: P.y });
    g.magic.cast(P, 1, null, { free: true });
    P.inventory.add('swiftfoot_draught', 1);
    g.combat.useItem(P, 'swiftfoot_draught');
    g.combat.giveXp(P, 140);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${label}-hud.png` });
  await page.evaluate(() => window.__game.ui.openCharacter());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${label}-sheet.png` });
  await page.evaluate(() => window.__game.ui.openCharacter('weapon'));
  await page.waitForTimeout(300);
  // Scroll the sheet to the worn pieces on a narrow screen.
  await page.evaluate(() => document.querySelector('.panel-character .cs-pick')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${label}-sheet-gear.png` });
  await page.evaluate(() => window.__game.ui.character.close());
  await page.evaluate(() => window.__game.ui.openForge('upgrade'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${label}-forge.png` });
  await page.evaluate(() => window.__game.ui.openForge('forge'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${label}-forge-new.png` });
  await page.evaluate(() => window.__game.ui.forge.close());
  await page.evaluate(() => window.__game.ui.openSpellbook(0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${label}-spellbook.png` });
  await page.evaluate(() => document.querySelector('.sb-sec-prices')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${label}-spellbook-prices.png` });
  await ctx.close();
}
await browser.close();
server.close();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
