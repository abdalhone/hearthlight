// Death check (DESIGN §25/§27, round 14): plays the heavier death in the built game on a
// phone sideways (844×390) and upright (390×844) by touch, and on a computer (1280×720) by
// keys, and asserts:
//   - fallen: the countdown ring is on screen with the seconds (as words for readers too),
//     inside the viewport, clear of the stick and the hotbar; it drains; Call for help 44 px+;
//   - crawling moves the body in the crawl pose and leaves blood behind;
//   - carried: the rescue bar shows who carries you where, and fills;
//   - death (waking at home): every coin stays where you fell in an ember-ring; the waking
//     words say so; an ember arrow points the way when it is out of view; walking back,
//     the prompt offers it and E / the hand button takes it all back;
//   - the Last Stand: the game's own confirm states the price; once held, the Rise button
//     shows while down (inside the viewport) and rising takes a held press; the minute
//     burns; when it ends the story ends;
//   - no page errors, no sideways scroll.
//
//   node scripts/death_check.mjs          (build first: npm run build)
//   node scripts/death_check.mjs --out DIR   screenshots there (default screenshots/death)
// Exit code 1 on any failure.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/death';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
];

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
let checks = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failures.push(label);
  return ok;
};

async function run(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  // Hold a direction: keys on a computer, the floating stick by touch on a phone.
  const hold = async (dx, dy, ms) => {
    if (!S.phone) {
      const key = dx > 0 ? 'd' : dx < 0 ? 'a' : dy < 0 ? 'w' : 's';
      await page.keyboard.down(key);
      await wait(ms);
      await page.keyboard.up(key);
      return;
    }
    const sx = Math.round(S.w * 0.16);
    const sy = Math.round(S.h * 0.8);
    await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [{ x: sx + dx * 9 * i, y: sy + dy * 9 * i, id: 1 }]);
      await wait(16);
    }
    await wait(ms);
    await touch('touchEnd', []);
  };
  const tapAt = async (x, y, ms = 60) => {
    if (S.phone) {
      await touch('touchStart', [{ x, y, id: 9 }]);
      await wait(ms);
      await touch('touchEnd', []);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await wait(ms);
      await page.mouse.up();
    }
  };
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
    }, sel);
  const inside = (r) => !!r && r.x >= 0 && r.y >= 0 && r.r <= S.w + 0.5 && r.b <= S.h + 0.5;
  const overlap = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(500);
  await ev(() => {
    const g = window.__game;
    g.clock?.skipTo?.(11);
    g.story?.skip?.();
    g.ui?.closeAll?.();
    const u = g.ui;
    for (const id of ['cast', 'book', 'found']) if (u?.coach?.done) u.coach.done[id] = true;
    u?.coach?.stop?.();
    u?.toasts?.clear?.();
    const m = g.locations.get('south_meadow').center;
    g.player.x = m.x;
    g.player.y = m.y;
    g.companion.x = m.x + 2000;
    g.companion.y = m.y;
    g.companion.behavior?.setDirective?.({ type: 'stay', x: m.x + 2000, y: m.y });
    g.camera.snap();
    const have = g.player.inventory.count('coin');
    if (have < 57) g.player.inventory.add('coin', 57 - have);
    g.settings.deathMode = 'home';
    g._alert = g.survival.alert.bind(g.survival);
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
  });

  // ---------- fallen: the countdown ----------
  await ev(() => window.__game.player.fall({ cause: 'test' }));
  await wait(2600);
  const ring = await rectOf('.sv-ring');
  const call = await rectOf('.sv-call');
  const block = await rectOf('.sv-fallen');
  const stick = await rectOf('.stick-zone .stick');
  const hotbar = S.phone ? null : await rectOf('.hotbar');
  const secs1 = await ev(() => document.querySelector('.sv-secs')?.textContent || '');
  await shot('1-fallen');
  check(!!ring && ring.w >= 80, `${tag}: the countdown ring shows, big enough (${ring && Math.round(ring.w)} px)`);
  check(inside(block), `${tag}: the countdown block is on screen`);
  check(/\d+ seconds? to live/.test(secs1), `${tag}: the seconds in words (${secs1})`);
  check(!!call && call.h >= 44, `${tag}: Call for help 44 px+`);
  check(!overlap(call, stick) && !overlap(ring, stick), `${tag}: clear of the stick`);
  check(!overlap(block, hotbar), `${tag}: clear of the hotbar`);
  const n1 = parseInt(secs1, 10);
  await wait(2200);
  const n2 = parseInt(await ev(() => document.querySelector('.sv-secs')?.textContent || ''), 10);
  check(n2 < n1, `${tag}: it drains (${n1} -> ${n2})`);

  // ---------- crawling ----------
  const x0 = await ev(() => ({ x: window.__game.player.x, marks: window.__game.survival.trail.marks.length }));
  await hold(1, 0, 900);
  const x1 = await ev(() => ({ x: window.__game.player.x, pose: window.__game.player.crawlPose, marks: window.__game.survival.trail.marks.length }));
  await shot('2-crawl');
  check(x1.x > x0.x + 4, `${tag}: crawling moves you (${(x1.x - x0.x).toFixed(1)} px)`);
  check(!!x1.pose, `${tag}: in the crawl pose`);
  check(x1.marks > x0.marks, `${tag}: blood behind (${x0.marks} -> ${x1.marks})`);

  // ---------- carried: the rescue bar ----------
  await ev(() => {
    const g = window.__game;
    const r = g.survival.fallOf(g.player);
    r.left = r.window;
    const rowan = g.entities.get('rowan');
    rowan.x = g.player.x + 24;
    rowan.y = g.player.y;
    g.survival.alert = g._alert;
    g.survival.assignJob(rowan, r, 'carry', { forced: true });
  });
  await page.waitForFunction(() => !!window.__game.player.carriedBy, null, { timeout: 20000 }).catch(() => {});
  await wait(1800);
  const help1 = await ev(() => ({ label: document.querySelector('.sv-help-label')?.textContent || '', w: parseFloat(document.querySelector('.sv-help-fill')?.style.width) || 0 }));
  await shot('3-carried');
  await wait(2500);
  const help2 = await ev(() => parseFloat(document.querySelector('.sv-help-fill')?.style.width) || 0);
  check(/carrying you to/.test(help1.label), `${tag}: who carries you where (${help1.label})`);
  check(help2 > help1.w, `${tag}: the rescue bar fills (${help1.w}% -> ${help2}%)`);

  // ---------- death: the ember-ring ----------
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    if (P.carriedBy) g.survival.endCarry(P.carriedBy);
    g.survival.alert = () => {};
    const rowan = g.entities.get('rowan');
    rowan.x = P.x + 3000;
    g.survival.fallOf(P).left = 0.5;
  });
  await page.waitForFunction(() => window.__game.state === 'playing' && !window.__game.player.downed && !window.__game.survival.isFallen(window.__game.player), null, { timeout: 30000 });
  await wait(2500);
  const died = await ev(() => {
    const g = window.__game;
    const r = g.survival.ring;
    return { gold: g.player.gold, coins: r?.coins ?? 0, words: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') };
  });
  await shot('4-woke');
  check(died.gold === 0 && died.coins === 57, `${tag}: every coin stayed where you fell (purse ${died.gold}, ring ${died.coins})`);
  check(/57 coins, lies where you (fell|died)/.test(died.words), `${tag}: the waking words say where the coins are`);
  await ev(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await wait(400);
  const edge = await rectOf('.er-edge-tip');
  await shot('5-arrow');
  check(inside(edge), `${tag}: an ember arrow points the way`);
  // Walk the last stretch back.
  await ev(() => {
    const g = window.__game;
    const r = g.survival.ring;
    g.player.x = r.x - 60;
    g.player.y = r.y + 3;
    g.camera.snap();
  });
  await wait(600);
  const tag1 = await rectOf('.er-tag');
  check(inside(tag1), `${tag}: a tag over the ring while it is in view`);
  await hold(1, 0, 1000);
  await wait(300);
  const prompt = await ev(() => window.__game.ui?.lastPrompt || '');
  await shot('6-at-ring');
  check(/Take back your 57 coins/.test(prompt), `${tag}: the prompt offers it (${prompt})`);
  if (S.phone) {
    const use = await rectOf('.tbtn-interact');
    check(!!use, `${tag}: the hand button is there`);
    if (use) await tapAt(use.x + use.w / 2, use.y + use.h / 2);
  } else await page.keyboard.press('e');
  await wait(700);
  const after = await ev(() => ({ gold: window.__game.player.gold, ring: !!window.__game.survival.ring }));
  await shot('7-taken');
  check(after.gold === 57 && !after.ring, `${tag}: all of it back (${after.gold})`);

  // ---------- the Last Stand ----------
  await ev(() => {
    const g = window.__game;
    g.player.invuln = 0;
    g.ui?.toasts?.clear?.();
    g.magic.unlock('price', 'laststand', 'dev');
    g.magic.cast(g.player, { shape: 'bolt', essences: ['raw'], twists: [], prices: ['laststand'] }, { x: g.player.x + 40, y: g.player.y }, { free: true });
  });
  await wait(700);
  const dlg = await ev(() => {
    const p = [...document.querySelectorAll('.modal-layer > .panel')].pop();
    return p ? p.textContent : '';
  });
  await shot('8-confirm');
  check(/die for good/.test(dlg) && /No kept flame/.test(dlg) && /save closes/.test(dlg), `${tag}: the confirm states the price in full`);
  const yes = await page.getByRole('button', { name: 'Take it up' }).boundingBox();
  check(!!yes, `${tag}: "Take it up" is there`);
  if (yes) await tapAt(yes.x + yes.width / 2, yes.y + yes.height / 2);
  await wait(500);
  check((await ev(() => window.__game.prices.state.laststand)) === 'armed', `${tag}: held after a yes`);
  await ev(() => {
    window.__game.ui?.toasts?.clear?.();
    window.__game.player.invuln = 0;
    window.__game.player.fall({ cause: 'test' });
  });
  await wait(2200);
  const rise = await rectOf('.sv-rise');
  const block2 = await rectOf('.sv-fallen');
  await shot('9-down-held');
  check(!!rise && rise.h >= 36, `${tag}: the Rise button shows while down`);
  check(inside(block2), `${tag}: with it, the block still fits the screen`);
  if (rise) {
    // A quick tap does nothing; a held press rises.
    await tapAt(rise.x + rise.w / 2, rise.y + rise.h / 2, 120);
    await wait(300);
    check(!!(await ev(() => window.__game.player.downed)), `${tag}: a quick tap does not rise`);
    if (S.phone) await tapAt(rise.x + rise.w / 2, rise.y + rise.h / 2, 1400);
    else {
      await page.keyboard.down('r');
      await wait(1400);
      await page.keyboard.up('r');
    }
  }
  await wait(900);
  const burn = await ev(() => ({ left: window.__game.prices.lastStandLeft(), downed: window.__game.player.downed }));
  await shot('10-burning');
  check(burn.left > 50 && !burn.downed, `${tag}: risen, burning (${burn.left && burn.left.toFixed(1)} s)`);
  await ev(() => {
    window.__game.prices.state.laststand.t = 1;
  });
  await page.waitForFunction(() => window.__game.state === 'dead', null, { timeout: 15000 }).catch(() => {});
  await wait(1500);
  await shot('11-the-end');
  check((await ev(() => window.__game.state)) === 'dead', `${tag}: when the minute ends, the story ends`);

  check((await ev(() => document.documentElement.scrollWidth)) <= S.w + 1, `${tag}: no sideways scroll`);
  check(!errors.length, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

for (const S of SIZES) {
  try {
    await run(S);
    console.log(`[death] ${S.tag} done`);
  } catch (err) {
    failures.push(`${S.tag}: crashed: ${err?.stack || err}`);
  }
}
await browser.close();
server.close();
console.log(`[death] ${checks} checks, ${failures.length} failed; screenshots in ${OUT}/`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
