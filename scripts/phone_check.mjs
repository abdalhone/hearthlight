// Phone check: taps through every screen of the built game on the phone sizes the
// author plays at (the claude.ai app shows the game in about 390×640 upright and
// 844×340 sideways), with real touch input, and asserts:
//   - every panel opens, fits on the screen (its box inside the viewport), has a ✕ of
//     at least 44 px, and closes both by its ✕ and by a tap outside it; a panel opened
//     from the menu goes back to play on ✕ and back to the menu on "‹ Menu";
//   - the HUD shows only what play needs every second (health and mana, Lyra's face,
//     the mission line, Menu, the weave buttons, sword, dodge, Talk/Use);
//   - the chat closes by ✕ and by a tap on the world;
//   - the magic lessons appear and can be finished with taps on the real controls;
//   - cutscenes advance on a tap and skip on Skip;
//   - a villager's "more" says to tap; trading keeps the wares and "Done trading" in view;
//   - every control in every panel is finger-sized (40 px+);
//   - the world's news waits while a panel is open, and shows once it closes;
//   - fallen: the fight buttons are put away, Call for help is in view, clear of the stick;
//   - no page errors, and the page never scrolls sideways.
//
//   node scripts/phone_check.mjs              (build first: npm run build)
//   node scripts/phone_check.mjs --out DIR    screenshots there (default screenshots/phone)
//   node scripts/phone_check.mjs --size 390x640   one size only
// Exit code 1 on any failure.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = arg('--out', 'screenshots/phone');
const ONLY = arg('--size', '');
const SIZES = [
  [390, 640],
  [390, 844],
  [844, 340],
  [844, 390],
  [667, 375],
].filter(([w, h]) => !ONLY || ONLY === `${w}x${h}`);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
let checks = 0;

function check(ok, label) {
  checks++;
  if (!ok) failures.push(label);
  return ok;
}

async function run([W, H]) {
  const tag = `${W}x${H}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR/.test(t)) return;
    errors.push(`console.error: ${t}`);
  });
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const tap = (x, y) => page.touchscreen.tap(Math.round(x), Math.round(y));
  const box = (sel) =>
    page.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        for (let p = e; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (p.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
        }
        return true;
      });
      const e = els[els.length - 1];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }, sel);
  const tapSel = async (sel, label = sel) => {
    await page.evaluate((sel) => {
      const e = [...document.querySelectorAll(sel)].pop();
      const r = e?.getBoundingClientRect();
      if (r && (r.bottom > innerHeight || r.top < 0)) e.scrollIntoView({ block: 'center' });
    }, sel);
    const b = await box(sel);
    if (!check(!!b, `${tag}: ${label} is on screen to tap`)) return false;
    await tap(b.cx, b.cy);
    return true;
  };
  const stack = () => page.evaluate(() => window.__game.ui.stack.map((p) => p.id));
  const quiet = () =>
    page.evaluate(() => {
      const u = window.__game.ui;
      u.toasts?.clear?.();
      for (const id of ['cast', 'book', 'found']) u.coach.done[id] = true;
      u.coach.forced?.clear?.();
      u.coach.stop?.();
    });

  // The top panel fits the screen; its ✕ is finger-sized and not covered.
  const fits = async (label) => {
    const r = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.modal-layer > .panel')].pop();
      if (!p) return null;
      const b = p.getBoundingClientRect();
      const x = p.querySelector(':scope > .panel-head .panel-close');
      const xb = x?.getBoundingClientRect();
      let xTop = false;
      if (xb) {
        const at = document.elementFromPoint(xb.left + xb.width / 2, xb.top + xb.height / 2);
        xTop = !!at && (at === x || x.contains(at));
      }
      return { b: [b.left, b.top, b.right, b.bottom], x: xb ? [xb.width, xb.height] : null, xTop, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
    });
    if (!check(!!r, `${tag}: ${label} opened`)) return false;
    const [l, t, rr, bb] = r.b;
    check(l >= -1 && t >= -1 && rr <= r.vw + 1 && bb <= r.vh + 1, `${tag}: ${label} fits the screen (${r.b.map(Math.round).join(',')})`);
    check(r.x && r.x[0] >= 44 && r.x[1] >= 44, `${tag}: ${label} ✕ is at least 44 px (${r.x})`);
    check(r.xTop, `${tag}: ${label} ✕ is not covered`);
    check(r.sw <= r.vw + 1, `${tag}: ${label}: no sideways page scroll`);
    return true;
  };
  // A point outside the top panel (inside the backdrop).
  const outside = () =>
    page.evaluate(() => {
      const p = [...document.querySelectorAll('.modal-layer > .panel')].pop();
      const b = p.getBoundingClientRect();
      const cands = [
        [b.left / 2, innerHeight / 2],
        [(b.right + innerWidth) / 2, innerHeight / 2],
        [innerWidth / 2, b.top / 2],
        [innerWidth / 2, (b.bottom + innerHeight) / 2],
      ];
      for (const [x, y] of cands) {
        const at = document.elementFromPoint(x, y);
        if (at && at.classList.contains('modal-backdrop')) return [x, y];
      }
      return null;
    });

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 30000 });
  await wait(600);
  await shot('01-title');

  // ---------- the title screen ----------
  const titleBad = await page.evaluate(() =>
    [...document.querySelectorAll('.layer-title button')]
      .filter((b) => b.getBoundingClientRect().width)
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.height < 40;
      })
      .map((b) => b.textContent.trim()),
  );
  check(!titleBad.length, `${tag}: title buttons fit and are 40 px+ (${titleBad.join(', ')})`);
  for (const [label, sel] of [
    ['Settings', '.layer-title button:is([data-item="settings"], .title-settings)'],
    ['How to play', '.layer-title button:is([data-item="howTo"], .title-howto)'],
  ]) {
    const found = await page.evaluate((label) => {
      const b = [...document.querySelectorAll('.layer-title button')].find((x) => x.textContent.trim().includes(label));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }, label);
    if (!check(!!found, `${tag}: title has ${label} (${sel})`)) continue;
    await tap(...found);
    await wait(400);
    if (await fits(`title ${label}`)) {
      await shot(`02-title-${label.replace(/\s/g, '')}`);
      await tapSel('.modal-layer > .panel:last-child .panel-close', `${label} ✕`);
      await wait(350);
      check((await stack()).length === 0, `${tag}: title ${label} closes by ✕`);
      await tap(...found);
      await wait(400);
      const o = await outside();
      if (check(!!o, `${tag}: title ${label} has room outside it`)) {
        await tap(...o);
        await wait(350);
        check((await stack()).length === 0, `${tag}: title ${label} closes by a tap outside`);
      }
    }
  }

  // New game: the warning closes on a tap outside ("no"); then Begin starts the prologue.
  const newGame = async () => {
    const b = await page.evaluate(() => {
      const x = [...document.querySelectorAll('.layer-title button')].find((e) => /new game/i.test(e.textContent));
      const r = x?.getBoundingClientRect();
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (b) await tap(...b);
    await wait(400);
  };
  await newGame();
  const warn = (await stack()).includes('confirm');
  if (warn) {
    await fits('new-game warning');
    const o = await outside();
    if (o) {
      await tap(...o);
      await wait(300);
      check(!(await stack()).includes('confirm'), `${tag}: the new-game warning closes on a tap outside`);
    }
    await newGame();
    const begin = await page.evaluate(() => {
      const x = [...document.querySelectorAll('.modal-layer button')].find((e) => /begin/i.test(e.textContent));
      const r = x?.getBoundingClientRect();
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (begin) await tap(...begin);
  }
  // ---------- the prologue: a tap moves it on, Skip ends it ----------
  await page.waitForFunction(() => window.__game.story?.isPlaying?.() || window.__game.state === 'playing', null, { timeout: 20000 });
  await wait(1500);
  const cs = await page.evaluate(() => !!window.__game.story?.isPlaying?.());
  if (cs) {
    const text = () => page.evaluate(() => document.querySelector('.cs-box')?.textContent || '');
    const t0 = await text();
    for (let i = 0; i < 4; i++) {
      await tap(W / 2, H / 3);
      await wait(250);
    }
    const t1 = await text();
    check(t1 && t1 !== t0, `${tag}: a tap moves the prologue on`);
    await shot('03-prologue');
    const skip = await box('.cs-skip');
    check(skip && skip.h >= 44, `${tag}: Skip is at least 44 px tall`);
    if (skip) await tap(skip.cx, skip.cy);
  }
  await page.waitForFunction(() => window.__game.state === 'playing' && !window.__game.story?.isPlaying?.(), null, { timeout: 30000 });
  await wait(1200);
  await quiet();
  await wait(300);
  await shot('04-hud');

  // ---------- the HUD: only what play needs every second ----------
  const hud = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      for (let p = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (p.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    const allowed = ['.lyra-card', '.hud-menu', '.quest-line', '.wbtn', '.tbtn-attack', '.tbtn-dodge', '.tbtn-interact', '.buff', '.listen-prompt', '.boss-bar button'];
    const out = { extra: [], have: {} };
    for (const e of document.querySelectorAll('.layer-hud button, .layer-touch button, .layer-hud [role=button]')) {
      if (!vis(e)) continue;
      const hit = allowed.find((s) => e.matches(s));
      if (hit) out.have[hit] = (out.have[hit] || 0) + 1;
      else out.extra.push((e.className || e.tagName).toString().slice(0, 40));
    }
    out.cards = [...document.querySelectorAll('.layer-hud .card')].filter(vis).map((c) => c.className);
    return out;
  });
  check(!hud.extra.length, `${tag}: the HUD has nothing extra (${hud.extra.join(' | ')})`);
  for (const s of ['.lyra-card', '.hud-menu', '.wbtn', '.tbtn-attack', '.tbtn-dodge', '.tbtn-interact']) check(hud.have[s] > 0, `${tag}: the HUD has ${s}`);
  check(!hud.cards.some((c) => /place-card/.test(c)), `${tag}: no clock card on a phone`);
  // Weave buttons do not overlap one another (their tap areas).
  const overlap = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.tcluster .wbtn, .tcluster .tbtn')].filter((b) => !b.hidden && b.getBoundingClientRect().width).map((b) => b.getBoundingClientRect());
    let worst = 0;
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const d = Math.hypot(a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2)) - (a.width + b.width) / 2;
        worst = Math.min(worst, d);
      }
    return worst;
  });
  check(overlap >= -1, `${tag}: the thumb cluster's buttons do not overlap (${overlap.toFixed(1)} px)`);

  // ---------- the magic lessons, finished with taps ----------
  await page.evaluate(() => window.__game.ui.coach.replay());
  await page.waitForFunction(() => window.__game.ui.coach.lesson?.id === 'cast' && !window.__game.ui.coach.el.hidden, null, { timeout: 15000 }).catch(() => null);
  const lesson = () => page.evaluate(() => ({ id: window.__game.ui.coach.lesson?.id || null, i: window.__game.ui.coach.lesson?.i ?? -1 }));
  let L = await lesson();
  if (check(L.id === 'cast', `${tag}: the casting lesson appears`)) {
    await wait(400); // the card's fade-in
    await shot('05-lesson-cast');
    // 1: really cast (tap the weave it points at).
    const ring = await box('.coach-ring');
    check(!!ring, `${tag}: the lesson rings a real control`);
    await tapSel('.tcluster .wbtn[data-slot="0"]', 'the first weave');
    await wait(1100);
    L = await lesson();
    check(L.i === 1, `${tag}: casting moves the lesson on (${L.i})`);
    // 2: drag to aim and let go.
    const wb = await box('.tcluster .wbtn[data-slot="0"]');
    if (wb) {
      const cdp = await ctx.newCDPSession(page);
      const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(wb.cx, wb.cy) });
      for (let k = 1; k <= 8; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(wb.cx - k * 10, wb.cy - k * 7) });
        await wait(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await wait(1300);
    L = await lesson();
    check(L.i === 2, `${tag}: a drag-cast moves the lesson on (${L.i})`);
    // 3: hold the weave to charge it, let go (a real hold: the ring fills, then it flies).
    await shot('05b-lesson-hold');
    if (wb) {
      await page.evaluate(() => window.__game.magic.resetCooldowns?.());
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(wb.cx), y: Math.round(wb.cy), id: 2 }] });
      await wait(1000);
      await shot('05c-charging');
      await wait(700);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await wait(1300);
    L = await lesson();
    check(L.i === 3, `${tag}: a charged cast moves the lesson on (${L.i})`);
    // 4, 5: mana and the cooldown, the buttons.
    for (const want of [4, 5]) {
      await tapSel('.coach-next', 'the lesson’s Next');
      await wait(350);
      L = await lesson();
      check(L.i === want, `${tag}: Next moves the lesson to step ${want + 1} (${L.i})`);
    }
    await shot('06-lesson-new');
    // 5: + New opens the Spellbook; the book's lesson follows.
    await tapSel('.tcluster .wbtn.empty:not([hidden])', '+ New');
    await wait(1200);
    L = await lesson();
    check(L.id === 'book', `${tag}: the Spellbook's lesson follows (${L.id})`);
    await fits('Spellbook');
    await shot('07-lesson-book');
    await tapSel('.coach-next', 'the lesson’s Next');
    await wait(500);
    // 2: really pick a shape.
    await tapSel('.panel-spellbook .sb-sec-shapes .sb-tile:not(.locked):not(.sb-more)', 'a shape');
    await wait(900);
    L = await lesson();
    check(L.i === 2, `${tag}: picking a shape moves the book's lesson on (${L.i})`);
    const saved = await page.evaluate(() => !!window.__game.ui.hud.weaving.weaveAt(1));
    check(saved, `${tag}: the new weave is saved to its slot`);
    for (let k = 0; k < 3; k++) {
      await tapSel('.coach-next', 'the lesson’s Next');
      await wait(450);
    }
    L = await lesson();
    check(L.id === null, `${tag}: the lessons can be finished with taps`);
    await shot('08-lesson-done');
    await tapSel('.modal-layer > .panel:last-child .panel-close', 'Spellbook ✕');
    await wait(400);
  }
  await quiet();

  // ---------- every place, from the menu ----------
  const openMenu = async () => {
    await tapSel('.hud-menu', 'Menu');
    await wait(400);
    return (await stack()).at(-1) === 'pause';
  };
  if (check(await openMenu(), `${tag}: Menu opens`)) {
    await fits('menu');
    await shot('10-menu');
    const cut = await page.evaluate(() => [...document.querySelectorAll('.pause-menu .menu-label')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    check(!cut.length, `${tag}: menu labels are not cut (${cut.join(', ')})`);
    await tapSel('.modal-layer > .panel:last-child .panel-close', 'menu ✕');
    await wait(300);
    check((await stack()).length === 0, `${tag}: the menu closes by ✕`);
  }
  const items = await page.evaluate(() => [...document.querySelectorAll('.layer-hud')].length && ['spellbook', 'inventory', 'missions', 'lyra', 'character', 'village', 'book', 'settings']);
  for (const id of items) {
    await quiet();
    if (!(await openMenu())) continue;
    const present = await box(`.pause-menu [data-item="${id}"]`);
    if (!present) {
      await tapSel('.modal-layer > .panel:last-child .panel-close', 'menu ✕');
      await wait(300);
      continue;
    }
    await tapSel(`.pause-menu [data-item="${id}"]`, `menu: ${id}`);
    await wait(700);
    const top = (await stack()).at(-1);
    if (!check(top && top !== 'pause', `${tag}: menu → ${id} opens a panel (${top})`)) continue;
    await fits(`${id} (${top})`);
    await shot(`11-${id}`);
    if (id === 'book') {
      // A swipe that starts on the words scrolls the page (not only one on the margin).
      const start = await page.evaluate(() => {
        const pg = document.querySelector('.codex-book > .codex-page');
        const list = [...document.querySelectorAll('.codex-entry h4, .codex-entry p')].map((e) => e.getBoundingClientRect()).filter((r) => r.top > innerHeight * 0.55 && r.bottom < innerHeight - 10);
        const r = list[0];
        return pg && r ? [r.left + 30, r.top + 6] : null;
      });
      if (start) {
        const cdp = await ctx.newCDPSession(page);
        const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(start[0], start[1]) });
        for (let k = 1; k <= 10; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(start[0], start[1] - k * 12) });
          await wait(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await wait(500);
        const top = await page.evaluate(() => document.querySelector('.codex-book > .codex-page').scrollTop);
        check(top > 20, `${tag}: a swipe on the Book's words scrolls it (${top})`);
      }
    }
    // ✕: back to play.
    await tapSel('.modal-layer > .panel:last-child .panel-close', `${id} ✕`);
    await wait(400);
    check((await stack()).length === 0, `${tag}: ${id} ✕ goes back to play`);
    // A tap outside: back to play.
    await openMenu();
    await tapSel(`.pause-menu [data-item="${id}"]`, `menu: ${id}`);
    await wait(600);
    const o = await outside();
    if (check(!!o, `${tag}: ${id} leaves room outside it`)) {
      await tap(...o);
      await wait(400);
      check((await stack()).length === 0, `${tag}: ${id} closes by a tap outside`);
    }
    // ‹ Menu: back to the menu.
    await openMenu();
    await tapSel(`.pause-menu [data-item="${id}"]`, `menu: ${id}`);
    await wait(600);
    if (await tapSel('.modal-layer > .panel:last-child .panel-back', `${id} ‹ Menu`)) {
      await wait(400);
      check((await stack()).join() === 'pause', `${tag}: ${id} ‹ Menu goes back to the menu`);
    }
    await page.evaluate(() => window.__game.ui.closeAll());
    await wait(200);
  }

  // ---------- shortcuts on the HUD ----------
  await quiet();
  await tapSel('.lyra-card', 'her portrait');
  await wait(600);
  check((await stack()).at(-1) === 'mind', `${tag}: her portrait opens her Mind`);
  if (await box('.mind-ask .ask-btn')) check(true, 'ask');
  else check(false, `${tag}: her Mind has the Ask row`);
  // Opened a second time (the menu opened it before): her face and mood are still there.
  check(!!(await box('.mind-hero .portrait')), `${tag}: her Mind shows her face and mood when opened again`);
  await shot('12-mind');
  await tapSel('.modal-layer > .panel:last-child .panel-close', 'Mind ✕');
  await wait(400);
  const q = await box('.quest-line');
  if (q) {
    await tap(q.cx, q.cy);
    await wait(600);
    check((await stack()).at(-1) === 'missions', `${tag}: the mission line opens Missions`);
    await page.evaluate(() => window.__game.ui.closeAll());
    await wait(300);
  }

  // ---------- Settings → How to play, stacked; and the forge ----------
  await page.evaluate(() => window.__game.ui.openSettings('controls'));
  await wait(500);
  await fits('Settings: Controls');
  const how = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.panel-settings button')].find((x) => /how to play/i.test(x.textContent));
    b?.scrollIntoView({ block: 'center' });
    const r = b?.getBoundingClientRect();
    return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
  });
  if (check(!!how, `${tag}: Settings links How to play`)) {
    await tap(...how);
    await wait(500);
    await fits('How to play (from Settings)');
    await shot('13-howto');
    await tapSel('.modal-layer > .panel:last-child .panel-close', 'How to play ✕');
    await wait(400);
    check((await stack()).join() === 'settings', `${tag}: How to play's ✕ goes back to Settings`);
  }
  await page.evaluate(() => window.__game.ui.closeAll());
  if (await page.evaluate(() => typeof window.__game.ui.openForge === 'function')) {
    await page.evaluate(() => window.__game.ui.openForge('upgrade'));
    await wait(500);
    await fits('the forge');
    await shot('14-forge');
    const small = await page.evaluate(() => [...document.querySelectorAll('.modal-layer > .panel:last-child button')].filter((b) => b.getBoundingClientRect().width && b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim().slice(0, 20)));
    check(!small.length, `${tag}: the forge's buttons are 40 px+ (${small.join(', ')})`);
    await page.evaluate(() => window.__game.ui.closeAll());
  }

  // ---------- a villager ----------
  await quiet();
  const npc = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const list = g.entities.all().filter((e) => e.type === 'actor' && typeof e.getDialogue === 'function' && e !== g.companion && e.id !== 'player' && !e.downed);
    list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    if (!list[0]) return null;
    g.ui.openDialog(list[0]);
    return list[0].id;
  });
  if (npc) {
    await wait(2800);
    await fits(`talking with ${npc}`);
    await shot('15-dialog');
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('.panel-dialog .dlg-opt')].filter((b) => {
        const r = b.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, r.top + r.height / 2));
        const sc = b.closest('.dlg-options');
        const sr = sc?.getBoundingClientRect();
        const inView = sr ? r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 : true;
        return inView && at && at !== b && !b.contains(at);
      }).map((b) => b.textContent.trim()),
    );
    check(!hidden.length, `${tag}: no dialog choice is covered (${hidden.join(', ')})`);
    // "Chat": while they have more to say, the choices wait behind a ▼ that says so.
    const chatOpt = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.panel-dialog .dlg-opt')].find((x) => /^chat/i.test(x.textContent.trim()));
      const r = b?.getBoundingClientRect();
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (chatOpt) {
      const xAt = () => page.evaluate(() => Math.round(document.querySelector('.modal-layer > .panel:last-child .panel-close').getBoundingClientRect().top));
      const x0 = await xAt();
      await tap(...chatOpt);
      await wait(700);
      const x1 = await xAt();
      await wait(800);
      const x2 = await xAt();
      check(Math.abs(x1 - x0) <= 2 && Math.abs(x2 - x0) <= 2, `${tag}: the dialog's ✕ stays put while they talk (${x0}, ${x1}, ${x2})`);
      const more = await page.evaluate(() => {
        const m = document.querySelector('.panel-dialog .dlg-more');
        return m && !m.hidden ? m.textContent : null;
      });
      if (more !== null) check(/tap/i.test(more), `${tag}: the dialog's ▼ says to tap for more (${more})`);
    }
    await tapSel('.modal-layer > .panel:last-child .panel-close', 'dialog ✕');
    await wait(400);
    check(!(await stack()).includes('dialog'), `${tag}: the dialog closes by ✕`);
  }

  // ---------- trading: the wares and "Done trading" in view ----------
  await quiet();
  const trader = await page.evaluate(() => {
    const g = window.__game;
    const t = g.entities.all().find((e) => e.type === 'actor' && typeof e.getDialogue === 'function' && !e.downed && (e.profile?.shop?.sells?.length || e.shop?.sells?.length));
    if (!t) return null;
    g.ui.openDialog(t);
    return t.id;
  });
  if (trader) {
    await wait(2500);
    const tr = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.panel-dialog .dlg-opt')].find((x) => /trade|buy|shop|wares/i.test(x.textContent));
      const r = b?.getBoundingClientRect();
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (check(!!tr, `${tag}: ${trader} offers to trade`)) {
      await tap(...tr);
      await wait(700);
      await fits(`trading with ${trader}`);
      await shot('15-trade');
      const view = await page.evaluate(() => {
        const inView = (e) => {
          const r = e.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && !!at && (at === e || e.contains(at));
        };
        const done = [...document.querySelectorAll('.panel-dialog .shop > .btn')].find((b) => /done/i.test(b.textContent));
        const rows = [...document.querySelectorAll('.panel-dialog .shop-list > *')];
        return { done: !!done && inView(done), firstRow: rows.length ? inView(rows[0]) : true };
      });
      check(view.done, `${tag}: "Done trading" is in view and not covered`);
      check(view.firstRow, `${tag}: the first ware is in view`);
    }
    await page.evaluate(() => window.__game.ui.closeAll());
    await wait(300);
  }

  // ---------- finger-sized: every control in every panel ----------
  const small = await page.evaluate(async () => {
    const u = window.__game.ui;
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const vis = (e) => {
      for (let p = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (p.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    // A control inside a taller tappable row (a switch in its label) is that row's size.
    const hitBox = (e) => {
      const row = e.closest('label, .set-main, .choice, .set-toggle');
      const r = (row && row !== e ? row : e).getBoundingClientRect();
      const before = getComputedStyle(e, '::before');
      if (before.content !== 'none' && before.position === 'absolute') {
        const t = parseFloat(before.top) || 0;
        const b = parseFloat(before.bottom) || 0;
        return { width: r.width, height: r.height - t - b };
      }
      return r;
    };
    const out = [];
    const opens = [
      ['spellbook', () => u.openSpellbook()],
      ['bag', () => u.openInventory()],
      ['missions', () => u.openMissions('active')],
      ['mind', () => u.openMind('now')],
      ['settings', () => u.openSettings('game')],
      ['village', () => u.openVillageLife?.()],
      ['menu', () => u.openPause()],
    ];
    for (const [name, open] of opens) {
      try {
        open();
      } catch {
        continue;
      }
      await pause(450);
      const p = [...document.querySelectorAll('.modal-layer > .panel')].pop();
      const tabs = p ? [...p.querySelectorAll('.set-tab, .settings-tabs [role=tab]')] : [];
      for (let i = 0; i <= tabs.length; i++) {
        if (i) {
          tabs[i - 1].click();
          await pause(200);
        }
        for (const b of p?.querySelectorAll('button, [role=tab], select, input:not([type=hidden]), summary') || []) {
          const r = b.getBoundingClientRect();
          if (!r.width || !r.height || !vis(b)) continue;
          const hb = hitBox(b);
          if (hb.height < 40 || hb.width < 36) out.push(`${name}: ${(b.className || b.tagName).toString().slice(0, 30)} "${(b.textContent || '').trim().slice(0, 16)}" ${Math.round(hb.width)}×${Math.round(hb.height)}`);
        }
      }
      u.closeAll();
      await pause(150);
    }
    return [...new Set(out)];
  });
  check(!small.length, `${tag}: every control in every panel is finger-sized (${small.slice(0, 6).join(' | ')})`);

  // ---------- the world's news waits while a panel is open ----------
  await quiet();
  await page.evaluate(() => window.__game.ui.openInventory());
  await wait(2800); // longer than a tap's answer window
  await page.evaluate(() => window.__game.ui.toast('News from the world', 'warn'));
  await wait(400);
  const held = await page.evaluate(() => [...document.querySelectorAll('.toast:not(.queued):not(.leaving)')].some((t) => /News from the world/.test(t.textContent)));
  check(!held, `${tag}: a notice from the world waits while a panel is open`);
  await tapSel('.modal-layer > .panel:last-child .panel-close', 'bag ✕');
  await wait(500);
  const after = await page.evaluate(() => [...document.querySelectorAll('.toast:not(.queued):not(.leaving)')].some((t) => /News from the world/.test(t.textContent)));
  check(after, `${tag}: it shows once the panel closes`);
  await page.evaluate(() => window.__game.ui.toasts.clear());

  // ---------- the chat: ✕ and a tap on the world ----------
  await quiet();
  // Step somewhere with nothing to use nearby, so the thumb button is Talk.
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const x0 = p.x;
    const y0 = p.y;
    for (let r = 0; r <= 12; r++) {
      for (let a = 0; a < 8; a++) {
        const x = x0 + Math.cos((a * Math.PI) / 4) * r * 24;
        const y = y0 + Math.sin((a * Math.PI) / 4) * r * 24;
        const tx = Math.floor(x / 16);
        const ty = Math.floor(y / 16);
        if (g.map?.isSolidTile?.(tx, ty) || g.map?.isWater?.(tx, ty)) continue;
        p.x = x;
        p.y = y;
        if (!g.interactions?.best?.(p)) return;
      }
    }
    p.x = x0;
    p.y = y0;
  });
  await page.waitForFunction(() => document.querySelector('.tcluster .tbtn-interact')?.classList.contains('idle'), null, { timeout: 3000 }).catch(() => null);
  await tapSel('.tcluster .tbtn-interact', 'Talk');
  await wait(500);
  if (check(await page.evaluate(() => window.__game.ui.chat.isOpen()), `${tag}: Talk opens the chat`)) {
    await shot('16-chat');
    await tapSel('.chat .chat-close', 'chat ✕');
    await wait(300);
    check(!(await page.evaluate(() => window.__game.ui.chat.isOpen())), `${tag}: the chat closes by ✕`);
    await page.evaluate(() => window.__game.ui.chat.open(false));
    await wait(400);
    // A tap on the world: the canvas, away from the chat and the HUD.
    const spot = await page.evaluate(() => {
      const c = document.querySelector('.chat').getBoundingClientRect();
      const cands = [
        [innerWidth / 2, Math.max(120, c.top / 2 + 40)],
        [c.left / 2, innerHeight / 2],
        [(c.right + innerWidth) / 2, innerHeight / 2],
      ];
      for (const [x, y] of cands) {
        const at = document.elementFromPoint(x, y);
        if (at && (at.tagName === 'CANVAS' || at.closest?.('.stick-zone'))) return [x, y];
      }
      return null;
    });
    if (check(!!spot, `${tag}: there is world to tap beside the chat`)) {
      await tap(...spot);
      await wait(400);
      check(!(await page.evaluate(() => window.__game.ui.chat.isOpen())), `${tag}: a tap on the world closes the chat`);
    }
  }

  // ---------- notices: one at a time, a tap puts one away ----------
  await page.evaluate(() => {
    const u = window.__game.ui;
    u.toast('First notice', 'info');
    u.toast('Second notice', 'info');
  });
  await wait(400);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.toast:not(.queued):not(.leaving)')].filter((t) => getComputedStyle(t).display !== 'none').length);
  check(shown === 1, `${tag}: one notice at a time on a phone (${shown})`);
  const t1 = await box('.toast:not(.queued):not(.leaving)');
  if (t1) {
    await tap(t1.cx, t1.cy);
    await wait(500);
    const left = await page.evaluate(() => [...document.querySelectorAll('.toast:not(.leaving)')].map((t) => t.textContent));
    check(!left.some((t) => /First notice/.test(t)), `${tag}: a tap puts a notice away`);
  }

  // ---------- the weave buttons: every name and mana can be read ----------
  // Nothing else covers them, with two weaves and with six (the ring at its fullest).
  // Last before the fall: it unlocks every part, which would start the "found" lesson.
  const covered = async () =>
    page.evaluate(() => {
      // Names and badges let taps through (pointer-events: none); hit-test them anyway.
      const st = document.createElement('style');
      st.textContent = '.tcluster .wbtn-name, .tcluster .wbtn-mana { pointer-events: auto !important; }';
      document.head.append(st);
      const bad = [];
      for (const b of document.querySelectorAll('.tcluster .wbtn:not([hidden])')) {
        for (const part of b.querySelectorAll('.wbtn-name, .wbtn-mana')) {
          const r = part.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          for (const [fx, fy] of [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]) {
            const at = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
            if (!at || !b.contains(at)) {
              bad.push(`${part.className.split(' ')[0]} of ${b.getAttribute('aria-label')} under ${at?.className || at?.tagName}`);
              break;
            }
          }
        }
      }
      st.remove();
      return bad;
    });
  for (const n of [1, 5]) {
    await page.evaluate((n) => {
      const g = window.__game;
      g.magic.unlockAll?.();
      const w = g.ui.hud.weaving;
      const list = [
        { name: 'Fireball', shape: 'blast', essences: ['fire'], twists: [] },
        { name: 'Frost Nova', shape: 'nova', essences: ['frost'], twists: [] },
        { name: 'Hold', shape: 'bind', essences: ['light'], twists: [] },
        { name: 'Shield', shape: 'ward', essences: ['earth'], twists: [] },
        { name: 'Storm Rain', shape: 'rain', essences: ['storm'], twists: [] },
      ];
      for (let i = 0; i < 5; i++) w.setSlot(i + 1, i < n ? list[i] : null);
      const c = g.ui.coach;
      c.done.found = true;
      c.foundKind = null;
      c.stop?.();
      g.ui.toasts?.clear?.();
    }, n);
    await wait(500);
    const bad = await covered();
    check(!bad.length, `${tag}: with ${n + 1} weaves every name and mana is in view (${bad.join(' | ')})`);
    if (n === 5) await shot('04b-hud-six-weaves');
  }
  await page.evaluate(() => {
    const w = window.__game.ui.hud.weaving;
    for (let i = 1; i < 6; i++) w.setSlot(i, null);
  });
  await wait(300);

  // ---------- fallen: no fight buttons; the call and the heartbeat in view, clear of the stick ----------
  await page.evaluate(() => window.__game.ui.toasts.clear());
  await page.evaluate(() => window.__game.player.fall({ cause: 'test' }));
  await wait(1500);
  const fallen = await page.evaluate(() => {
    const vis = (e) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      for (let p = e; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (p.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    const call = document.querySelector('.sv-call');
    const block = document.querySelector('.sv-fallen');
    const fight = [...document.querySelectorAll('.tcluster .wbtn, .tbtn-attack, .tbtn-dodge')].filter(vis).length;
    const b = block?.getBoundingClientRect();
    const c = call?.getBoundingClientRect();
    const stick = document.querySelector('.stick-zone .stick')?.getBoundingClientRect();
    const hit = (a, s) => !!a && !!s && s.width > 0 && a.left < s.right && a.right > s.left && a.top < s.bottom && a.bottom > s.top;
    return {
      downed: !!window.__game.player.downed,
      call: vis(call) && c.height >= 44,
      inside: !!b && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
      fight,
      onStick: hit(c, stick),
    };
  });
  if (fallen.downed) {
    await shot('17-fallen');
    check(fallen.call, `${tag}: fallen: Call for help shows, 44 px+`);
    check(fallen.inside, `${tag}: fallen: the heartbeat block is on screen`);
    check(fallen.fight === 0, `${tag}: fallen: the fight buttons are put away (${fallen.fight})`);
    check(!fallen.onStick, `${tag}: fallen: Call for help is clear of the move stick`);
    // The village's news while you lie there keeps off Call for help and the stick.
    await page.evaluate(() => window.__game.ui.toast('Captain is shouting for help, and the village is coming.', 'warn'));
    await wait(700);
    const clash = await page.evaluate(() => {
      const hit = (a, s) => !!a && !!s && s.width > 0 && a.width > 0 && a.left < s.right && a.right > s.left && a.top < s.bottom && a.bottom > s.top;
      const call = document.querySelector('.sv-call')?.getBoundingClientRect();
      const stick = document.querySelector('.stick-zone .stick')?.getBoundingClientRect();
      return [...document.querySelectorAll('.toast:not(.leaving)')].filter((t) => getComputedStyle(t).display !== 'none' && t.closest('.toasts')?.style.visibility !== 'hidden').map((t) => t.getBoundingClientRect()).filter((r) => hit(r, call) || hit(r, stick)).length;
    });
    await shot('17b-fallen-news');
    check(clash === 0, `${tag}: fallen: a notice keeps off Call for help and the stick`);
  }

  check(!errors.length, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

for (const size of SIZES) {
  try {
    await run(size);
    console.log(`[phone] ${size.join('x')} done`);
  } catch (err) {
    failures.push(`${size.join('x')}: crashed: ${err?.stack || err}`);
  }
}
await browser.close();
server.close();
console.log(`[phone] ${checks} checks, ${failures.length} failed; screenshots in ${OUT}/`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
