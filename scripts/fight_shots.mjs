// Screenshots of hit feedback and of Lyra fighting back (DESIGN §16.6, r8), on phones
// (sideways 844x390 and 844x340, upright 390x844) and a desktop.
//   npm run build && node scripts/fight_shots.mjs [outDir]
// Fails (exit 1) on a page error, or if a scene did not happen (a weave hit no number,
// no bar; Lyra never fought or the player never fell).
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'screenshots/fight';
await mkdir(out, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];

const SIZES = [
  { name: 'l844x390', w: 844, h: 390, phone: true },
  { name: 'l844x340', w: 844, h: 340, phone: true },
  { name: 'p390x844', w: 390, h: 844, phone: true },
  { name: 'desk1280', w: 1280, h: 720, phone: false },
];

async function open(size) {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: size.phone,
    hasTouch: size.phone,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  // Daylight on the square, the two of them a few steps apart, no tips over the world.
  await page.evaluate(() => {
    const g = window.__game;
    g.clock?.skipTo?.(11);
    const sq = g.locations.get('town_square')?.center || g.player;
    const p = g.player;
    const l = g.companion;
    // Open ground for both of them (and the slime), with nothing between.
    const T = 16;
    const open = (x, y) => {
      const tx = Math.floor(x / T);
      const ty = Math.floor(y / T);
      return !g.isBlockedTile(tx, ty, p) && !g.map.blocksProjectile?.(tx, ty);
    };
    const clearRow = (x0, x1, y) => {
      for (let x = x0; x <= x1; x += 4) if (!open(x, y) || !open(x, y - 6)) return false;
      return true;
    };
    let spot = null;
    for (let r = 0; r < 24 && !spot; r++) {
      for (let k = 0; k < 8 * Math.max(1, r) && !spot; k++) {
        const a = (k / (8 * Math.max(1, r))) * Math.PI * 2;
        const x = sq.x + Math.cos(a) * r * T;
        const y = sq.y + Math.sin(a) * r * T;
        if (clearRow(x - 30, x + 100, y)) spot = { x, y };
      }
    }
    spot = spot || sq;
    p.x = spot.x - 20;
    p.y = spot.y;
    l.x = spot.x + 22;
    l.y = spot.y;
    p.faceToward?.(l.x, l.y);
    g.camera.follow(p);
    g.camera.snap();
    try {
      g.ui?.closeAll?.();
      document.querySelectorAll('.toast, .tip, .hint-card').forEach((e) => e.remove());
    } catch {
      /* cosmetic */
    }
  });
  await page.waitForTimeout(300);
  return { context, page, errors };
}

// ------------------------------------------------------------------ hit feedback

async function hits(size) {
  const { context, page, errors } = await open(size);
  const label = `${size.name}-hits`;
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const Creature = proto.constructor;
    // Off the line to Lyra (a bolt through her would be an accident: a real hit).
    const s = new Creature(g, 'slime', { x: p.x + 40, y: p.y - 58 });
    s.maxHp = s.hp = 40;
    s.controller = null;
    s.speed = 0;
    s.aggroRadius = 0;
    g.entities.add(s);
    window.__slime = s;
    g.magic.mana.cur = g.magic.mana.max;
    const r = g.magic.cast(p, 0, { x: s.x, y: s.y - 7, target: s });
    return { ok: r.ok, reason: r.reason || null };
  });
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${out}/${label}-1-spark.png` });
  await page.evaluate(() => {
    const g = window.__game;
    g.magic.cooldowns?.fill?.(0);
    g.magic.mana.cur = g.magic.mana.max;
    g.magic.cast(g.player, 0, { x: window.__slime.x, y: window.__slime.y - 7, target: window.__slime });
  });
  await page.waitForTimeout(240);
  const shown = await page.evaluate(() => {
    const g = window.__game;
    const bars = g.renderer?.healthBars?.shown?.() || [];
    return { bars: bars.map((b) => ({ id: b.actor.id || b.actor.species, frac: Math.round(b.frac * 100) / 100 })), slime: window.__slime.hp };
  });
  await page.screenshot({ path: `${out}/${label}-2-bar.png` });
  // A weave dragged straight at Lyra: it lands, and she feels it.
  const lyraHit = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const l = g.companion;
    window.__slime.hp = 0;
    window.__slime.dead = true;
    g.magic.cooldowns?.fill?.(0);
    g.magic.mana.cur = g.magic.mana.max;
    l.invuln = 0;
    const hp = l.hp;
    const dx = l.x - p.x;
    const dy = l.y - 6 - (p.y - 7);
    const d = Math.hypot(dx, dy) || 1;
    const r = g.magic.cast(p, 0, { x: p.x + (dx / d) * 140, y: p.y - 7 + (dy / d) * 140, auto: false });
    return { ok: r.ok, friendly: !!r.cast?.friendly, hp };
  });
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${out}/${label}-3-lyra.png` });
  const after = await page.evaluate(() => window.__game.companion.hp);
  const row = { label, cast: r1, shown, lyra: { ...lyraHit, after }, errors };
  console.log(JSON.stringify(row));
  if (!r1.ok || !shown.bars.length || shown.slime >= 40 || !lyraHit.friendly || !(after < lyraHit.hp) || errors.length) failures.push(label);
  await context.close();
}

// ------------------------------------------------------------------ she fights back

async function fight(size) {
  const { context, page, errors } = await open(size);
  const label = `${size.name}-fight`;
  const strike = () =>
    page.evaluate(() => {
      const g = window.__game;
      const l = g.companion;
      l.invuln = 0;
      g.player.faceToward?.(l.x, l.y);
      return g.combat.damage(g.player, l, 6, { kind: 'melee' });
    });
  await strike();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${label}-1-warned.png` });
  await strike();
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${label}-2-stillring.png` });
  const decided = await page.evaluate(() => window.__game.companion.mind.autonomy.lastFightChoice || null);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${label}-3-turns.png` });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/${label}-4-mid.png` });
  // Until the player falls (real time; she is quick about it).
  const t0 = Date.now();
  let fell = false;
  while (Date.now() - t0 < 60000) {
    fell = await page.evaluate(() => !!window.__game.survival?.isFallen?.(window.__game.player));
    if (fell) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${label}-5-dropped.png` });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${label}-6-after.png` });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/${label}-7-watch.png` });
  const end = await page.evaluate(() => {
    const g = window.__game;
    const A = g.companion.mind.autonomy;
    return { companionship: A.companionship, deed: A.ledger.find((e) => e.deed === 'lethal_attack') || null, playerHp: g.player.hp, dead: !!g.player.dead, lyraHp: g.companion.hp };
  });
  const row = { label, decided: decided && { choice: decided.choice, risk: decided.risk, will: decided.will }, fell, seconds: Math.round((Date.now() - t0) / 100) / 10, end, errors };
  console.log(JSON.stringify(row));
  if (decided?.choice !== 'fight' || !fell || end.dead || errors.length) failures.push(label);
  await context.close();
}

for (const s of SIZES) {
  await hits(s);
  await fight(s);
}
await browser.close();
server.close();
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exit(1);
}
console.log('fight shots: done');
