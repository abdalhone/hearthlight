// Round 15, the shop builder's items (DESIGN §40), played on a phone held sideways (844x390,
// 4x CPU throttle, taps and drags), a phone held upright (390x844, taps) and a computer
// (1280x720, keys and the mouse; Interface size Normal and Large):
//   1. every shop shows its wares whole: Garrick (many), Bram, Elda, Mira, Hobb and Wenna (few),
//      buy and sell, "Done trading" and the close in view, the rows full width; a buy works;
//      the "Say something" field in use and put down again;
//   7. The Leaning Flames from Aveline to the turn-in: walk in, weave toward the altar with
//      Aveline standing before it (a key, a held charge and a hotbar click on the computer; a
//      tap and a drag-aimed weave on a phone): it counts, she is not hurt, she takes the turn-in;
//  13. the finisher's killing scene: bars, the close-in, the HUD aside, your pose; it ends by
//      itself where you stood; a tap, a click or a key skips it; never a child;
//  14. a bandit killed and a villager finished: no soul, tally, cold or dark sign; a boss's
//      shard is not pulled into you while its soul rises; on the pact path the Unkindling
//      still draws the soul in.
//   node scripts/shop_mission_check.mjs [--out DIR] [--only sideways,upright,desktop] [--parts shop,mission,finisher,soul]
//   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/r15-shop';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const PARTS = argv.includes('--parts') ? argv[argv.indexOf('--parts') + 1].split(',') : null; // shop,mission,finisher,soul
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true, throttle: 4 },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
].filter((s) => !ONLY || ONLY.includes(s.tag));
const MERCHANTS = ['garrick', 'bram', 'elda', 'mira', 'hobb', 'wenna'];

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
let checks = 0;
const check = (ok, label, info = '') => {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${info}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

async function newGame(S) {
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.clock.skipTo?.(11);
    for (const id of Object.keys(g.ui?.coach?.done || {})) g.ui.coach.done[id] = true;
    g.ui?.coach?.stop?.();
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    if (g.spawner) g.spawner.update = () => {};
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__hold = (id) => {
      const e = g.entities.get(id);
      if (e) {
        e.think = () => {
          e.moveIntent.x = 0;
          e.moveIntent.y = 0;
        };
        e.walker?.stop?.();
      }
      return e;
    };
    window.__clean();
  });
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
  }
  return { ctx, page, errors };
}

function helpers(S, ctx, page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: `${OUT}/${S.tag}-${name}.png` });
  const rectOf = (sel) =>
    ev((sel) => {
      for (const e of document.querySelectorAll(sel)) {
        let hidden = false;
        for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') hidden = true;
        if (hidden) continue;
        const r = e.getBoundingClientRect();
        if (r.width && r.height) return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
      }
      return null;
    }, sel);
  const tapAt = async (x, y) => {
    if (S.phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await wait(S.throttle ? 350 : 220);
  };
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return false;
    await tapAt(r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  // Tap the dialog's words until an option that matches shows, then tap it.
  const option = async (re) => {
    for (let i = 0; i < 40; i++) {
      const hit = await ev((src) => {
        const re = new RegExp(src, 'i');
        const b = [...document.querySelectorAll('.panel-dialog .dlg-opt')].find((x) => re.test(x.textContent));
        if (!b) return null;
        // (sideways the choices scroll in their own column: bring it into view first)
        b.scrollIntoView({ block: 'nearest' });
        b.setAttribute('data-pick', '1');
        return true;
      }, re.source);
      if (hit) {
        // A person reads the choices before tapping one (a second tap hard on the heels of
        // the one that finished the words can be taken as a double tap on a phone).
        await wait(S.throttle ? 900 : S.phone ? 450 : 150);
        let ok = await press('[data-pick="1"]');
        // Still there (the tap was taken for the second half of a double tap): tap it again,
        // as a person would.
        for (let k = 0; k < 2 && ok && (await ev(() => !!document.querySelector('[data-pick="1"]')?.isConnected)); k++) {
          await wait(500);
          ok = await press('[data-pick="1"]');
        }
        await ev(() => document.querySelectorAll('[data-pick]').forEach((e) => e.removeAttribute('data-pick')));
        return ok;
      }
      await press('.panel-dialog .dlg-box');
    }
    return false;
  };
  const cdpTouch = async () => ctx.newCDPSession(page);
  return { wait, ev, shot, rectOf, tapAt, press, option, cdpTouch };
}

// What the open shop shows: rows whole in each visible list, the buttons, the panel.
const LOOK_SHOP = () => {
  const whole = (e) => {
    const r = e.getBoundingClientRect();
    if (!(r.height > 0)) return false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'contents' || !/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) continue;
      const c = p.getBoundingClientRect();
      if (r.top < c.top - 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1 || r.right > c.right + 1) return false;
    }
    return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1;
  };
  const seen = (e) => {
    if (!e || !whole(e)) return false;
    const r = e.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === e || e.contains(at));
  };
  const panes = [...document.querySelectorAll('.shop .shop-pane')].filter((p) => getComputedStyle(p).display !== 'none');
  const lists = panes.map((p) => {
    const rows = [...p.querySelectorAll('.shop-row')];
    return { name: p.querySelector('h3')?.textContent || '', rows: rows.length, whole: rows.filter(whole).length, rowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0, left: Math.round(p.getBoundingClientRect().left), width: Math.round(p.getBoundingClientRect().width) };
  });
  const done = [...document.querySelectorAll('.shop > .btn')].find((b) => /Done trading/.test(b.textContent));
  const close = document.querySelector('.panel-dialog .panel-close');
  const face = document.querySelector('.panel-dialog .dlg-portrait')?.getBoundingClientRect();
  const shop = document.querySelector('.shop .shop-panes')?.getBoundingClientRect();
  const btns = [...document.querySelectorAll('.shop .btn, .shop .seg')].filter((b) => b.getBoundingClientRect().height > 0);
  let spill = 0;
  for (const e of document.querySelectorAll('.panel-dialog *')) {
    const r = e.getBoundingClientRect();
    if (r.width && (r.right > innerWidth + 1 || r.left < -1)) spill++;
  }
  return {
    lists,
    done: seen(done),
    close: seen(close),
    closeSize: close ? Math.round(Math.min(close.getBoundingClientRect().width, close.getBoundingClientRect().height)) : 0,
    // Not indented under the portrait: the wares start where the portrait does.
    indent: shop && face ? Math.round(shop.left - face.left) : 99,
    underFace: !!(shop && face && shop.left > face.right - 2),
    shopShare: shop ? shop.width / (document.querySelector('.panel-dialog')?.getBoundingClientRect().width || 1) : 0,
    small: btns.filter((b) => b.getBoundingClientRect().height < 44).length,
    spill,
    isShop: !!document.querySelector('.panel-dialog.is-shop'),
  };
};

async function shopPart(S, ctx, page) {
  const { wait, ev, shot, press, option } = helpers(S, ctx, page);
  await ev(() => {
    const g = window.__game;
    g.player.inventory.add('coin', 500);
    for (const id of ['herb', 'berries', 'iron_ore', 'crystal', 'bread', 'wood', 'stone', 'honey', 'bone', 'moonpetal', 'slime_gel', 'bat_wing', 'candle']) g.player.inventory.add(id, 3);
    const m = g.locations.get('town_square').center;
    g.player.x = m.x;
    g.player.y = m.y;
    g.camera.snap?.();
  });
  const sizes = S.phone ? ['phone'] : ['normal', 'large'];
  for (const size of sizes) {
    if (!S.phone) await ev((size) => {
      const g = window.__game;
      g.settings.uiSize = size;
      g.bus.emit('settings_changed', { key: 'uiSize' });
    }, size);
    for (const who of MERCHANTS) {
      await ev((who) => {
        const g = window.__game;
        window.__clean();
        const e = window.__hold(who);
        e.x = g.player.x + 18;
        e.y = g.player.y;
        e.opinionOfPlayer = Math.max(40, e.opinionOfPlayer || 0);
        g.ui.openDialog(e);
      }, who);
      await wait(250);
      const opened = await option(/^(Trade|Food and drink)/);
      await page.waitForSelector('.shop', { timeout: 5000 }).catch(() => {});
      await wait(S.throttle ? 700 : 350);
      const L = await ev(LOOK_SHOP);
      const tag = `[${S.tag}${S.phone ? '' : `/${size}`}] ${who}`;
      if (!check(opened && L.isShop, `${tag}: the shop opens from "Trade"`)) continue;
      const need = S.phone ? 3 : size === 'large' ? 3 : 4;
      for (const l of L.lists) check(l.whole >= Math.min(need, l.rows), `${tag}: ${l.name || 'the list'} shows ${l.whole} of ${l.rows} wares whole (row ${l.rowH} px)`);
      if (!S.phone) check(L.lists.length === 2, `${tag}: Buy and Sell side by side`, String(L.lists.length));
      check(L.done, `${tag}: "Done trading" in view and not covered`);
      check(L.close && (!S.phone || L.closeSize >= 44), `${tag}: the panel's close in view (${L.closeSize} px)`);
      // Upright and on a computer the wares run the panel's full width under their face;
      // sideways their words keep a narrow column and the shop has the rest.
      if (S.phone && S.w > S.h) check(L.shopShare >= 0.55, `${tag}: the shop has most of the panel (${Math.round(L.shopShare * 100)}%)`);
      else check(!L.underFace && L.indent <= 4, `${tag}: the wares full width, not indented under the portrait (${L.indent} px)`);
      check(L.spill === 0, `${tag}: nothing spills sideways`, String(L.spill));
      if (S.phone) check(L.small === 0, `${tag}: every shop button is a 44 px target`, String(L.small));
      if (who === 'garrick' || who === 'hobb') await shot(`shop-${who}${S.phone ? '' : `-${size}`}`);
      // The Sell list (phones: the tab).
      if (S.phone && who === 'bram') {
        await press('.shop-tabs .seg:nth-child(2)');
        await wait(300);
        const L2 = await ev(LOOK_SHOP);
        const l = L2.lists[0];
        check(!!l && l.whole >= Math.min(3, l.rows) && L2.done, `${tag}: the Sell tab shows ${l?.whole} of ${l?.rows} whole, Done in view`);
        await shot('shop-bram-sell');
        await press('.shop-tabs .seg:nth-child(1)');
        await wait(200);
      }
      // A buy works (Elda's first ware).
      if (who === 'elda') {
        const c0 = await ev(() => window.__game.player.inventory.count('coin'));
        await ev(() => [...document.querySelectorAll('.shop-pane:not([hidden]) .shop-row .btn-ember')].find((b) => !b.disabled && /Buy/.test(b.textContent))?.setAttribute('data-test', 'buy'));
        await press('[data-test="buy"]');
        await wait(300);
        const c1 = await ev(() => window.__game.player.inventory.count('coin'));
        check(c1 < c0, `${tag}: a ware bought (${c0 - c1} coins)`);
      }
      // The "Say something" field in use, then put down: the shop comes back whole.
      if (who === 'garrick') {
        const hasField = await ev(() => !!document.querySelector('.dlg-say-field'));
        if (hasField && !(S.phone && S.w > S.h)) {
          await press('.dlg-say-field');
          await page.keyboard.type('a fair price?', { delay: 10 });
          await wait(300);
          await shot(`shop-garrick-typing${S.phone ? '' : `-${size}`}`);
          const typing = await ev(LOOK_SHOP);
          check(typing.close, `${tag}: with the field in use the panel still closes`);
          await ev(() => document.activeElement?.blur?.());
          await wait(300);
          const after = await ev(LOOK_SHOP);
          check(after.done && after.lists.every((l) => l.whole >= Math.min(S.phone ? 3 : 3, l.rows)), `${tag}: the field put down, the wares and Done are whole again`);
        }
      }
      // Done trading goes back to the talk.
      if (who === 'wenna') {
        await ev(() => [...document.querySelectorAll('.shop > .btn')].find((b) => /Done trading/.test(b.textContent))?.setAttribute('data-test', 'done'));
        await press('[data-test="done"]');
        await wait(400);
        check(await ev(() => !document.querySelector('.panel-dialog.is-shop') && !!document.querySelector('.panel-dialog')), `${tag}: "Done trading" returns to the talk`);
      }
      await ev(() => window.__clean());
    }
  }
  if (!S.phone) await ev(() => {
    const g = window.__game;
    g.settings.uiSize = 'normal';
    g.bus.emit('settings_changed', { key: 'uiSize' });
  });
}

// The Leaning Flames, as the author would play it.
async function missionPart(S, ctx, page) {
  const { wait, ev, shot, rectOf, press, option } = helpers(S, ctx, page);
  await ev(() => {
    const g = window.__game;
    window.__clean();
    const ms = g.missions;
    ms.flags.weave_seen = true;
    ms.accept('first_spark', { silent: true });
    ms.complete('first_spark');
    const a = window.__hold('aveline');
    g.player.x = a.x;
    g.player.y = a.y + 26;
    g.camera.snap?.();
    window.__lf = [];
    for (const t of ['spell_cast', 'mission_progress', 'mission_ready', 'mission_completed']) g.bus.on(t, (p) => window.__lf.push(t));
  });
  await ev(() => window.__game.ui.openDialog(window.__game.entities.get('aveline')));
  await wait(300);
  check(await option(/Need a hand/), `[${S.tag}] 7 Aveline: "Need a hand?"`);
  check(await option(/I'll do it/), `[${S.tag}] 7 "I'll do it"`);
  await page.waitForFunction(() => window.__game.missions.status('leaning_flames') === 'active', null, { timeout: 5000 }).catch(() => {});
  check(await ev(() => window.__game.missions.status('leaning_flames') === 'active'), `[${S.tag}] 7 The Leaning Flames taken`);
  await ev(() => window.__clean());
  // Walk in (a key on the computer; the stick on a phone).
  const walk = async (ms) => {
    if (!S.phone) {
      await page.keyboard.down('w');
      await wait(ms);
      await page.keyboard.up('w');
      return;
    }
    const z = (await rectOf('.stick-zone')) || { x: 20, y: S.h - 200, w: 160, h: 160 };
    const x0 = z.x + Math.min(80, z.w / 2);
    const y0 = z.y + z.h - Math.min(80, z.h / 2);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - i * 8, id: 1 }] });
      await wait(20);
    }
    await wait(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  await walk(500);
  await wait(500);
  const inside = await ev(() => ({ obj: window.__game.missions.objectiveText('leaning_flames'), p: [Math.round(window.__game.player.x), Math.round(window.__game.player.y)] }));
  check(/Weave a spark/.test(inside.obj), `[${S.tag}] 7 inside the chapel: "${inside.obj}"`);
  // Aveline stands before the altar, between you and it (where she tends it).
  const stage = async () =>
    ev(() => {
      const g = window.__game;
      const a = g.entities.get('aveline');
      const P = g.player;
      P.x = 88.5 * 16;
      P.y = 50 * 16;
      a.x = P.x;
      a.y = P.y - 30;
      a.hp = a.maxHp;
      P.faceToward(a.x, a.y - 40);
      g.camera.snap?.();
      g.magic.mana.cur = g.magic.mana.max;
      g.magic.resetCooldowns?.();
      const r = g.renderer;
      const at = r.worldToCss(88.5 * 16, 42 * 16 + 4);
      const av = r.worldToCss(a.x, a.y - 10);
      return { altar: at, aveline: av, op: a.opinionOfPlayer };
    });
  const reset = async () =>
    ev(() => {
      const ms = window.__game.missions;
      const s = ms.state.leaning_flames;
      s.status = 'active';
      s.step = 1;
      ms.enterStep('leaning_flames');
    });
  const methods = S.phone ? ['tap', 'drag'] : ['key', 'charge', 'hotbar'];
  for (const m of methods) {
    const st = await stage();
    await wait(200);
    if (m === 'key') {
      await page.mouse.move(st.aveline.x, st.aveline.y);
      await page.keyboard.press('1');
    } else if (m === 'charge') {
      await page.mouse.move(st.aveline.x, st.aveline.y);
      await page.keyboard.down('1');
      await wait(1300);
      await page.keyboard.up('1');
    } else if (m === 'hotbar') {
      const b = await rectOf('.hotbar .wbtn:not(.empty)');
      await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await page.mouse.down();
      await page.mouse.move(st.aveline.x, st.aveline.y, { steps: 4 });
      await page.mouse.up();
    } else {
      const b = await rectOf('.layer-touch .wbtn:not(.empty)');
      if (m === 'tap') await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
      else {
        // Drag-aim straight at the altar through her: the weave button pulled up and back.
        const cdp = await ctx.newCDPSession(page);
        const x0 = b.x + b.w / 2;
        const y0 = b.y + b.h / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 4 }] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - i * 9, id: 4 }] });
          await wait(25);
        }
        await wait(300);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      }
    }
    await wait(S.throttle ? 1800 : 1100);
    const r = await ev(() => {
      const g = window.__game;
      const a = g.entities.get('aveline');
      return { st: g.missions.status('leaning_flames'), hp: a.hp, max: a.maxHp, cast: window.__lf.filter((x) => x === 'spell_cast').length };
    });
    check(r.st === 'ready', `[${S.tag}] 7 a spark woven before the altar (${m}) counts`, JSON.stringify(r));
    check(r.hp === r.max, `[${S.tag}] 7 ...and does not strike Aveline in its line (${m})`, `${r.hp}/${r.max}`);
    if (m === methods[0]) await shot('mission-ready');
    if (m !== methods[methods.length - 1]) await reset();
  }
  await ev(() => window.__game.ui.openDialog(window.__game.entities.get('aveline')));
  await wait(300);
  check(await option(/Leaning Flames: it's done/), `[${S.tag}] 7 Aveline takes the turn-in`);
  await wait(400);
  const fin = await ev(() => ({ st: window.__game.missions.status('leaning_flames'), light: window.__game.magic.isEarned('essence', 'light'), nova: window.__game.magic.isEarned('shape', 'nova') }));
  check(fin.st === 'done' && fin.light && fin.nova, `[${S.tag}] 7 The Leaning Flames done: Light and Nova earned`, JSON.stringify(fin));
  await shot('mission-done');
  await ev(() => window.__clean());
}

// The killing scene; and no soul off the dark path.
async function finisherPart(S, ctx, page) {
  const { wait, ev, shot, rectOf } = helpers(S, ctx, page);
  const setup = async (id) =>
    ev((id) => {
      const g = window.__game;
      window.__clean();
      const P = g.player;
      const m = g.locations.get('south_meadow').center;
      P.x = m.x;
      P.y = m.y;
      for (const e of g.entities.all()) if (e.species && Math.hypot(e.x - P.x, e.y - P.y) < 500) e.removed = true;
      for (const e of g.entities.all()) if (e.profile && e.id !== id && Math.hypot(e.x - P.x, e.y - P.y) < 400) {
        e.x += 700;
        e.walker?.stop?.();
      }
      const L = g.companion;
      if (L && !L.dead) {
        L.x = P.x - 80;
        L.y = P.y - 40;
      }
      const v = window.__hold(id);
      v.x = P.x + 14;
      v.y = P.y;
      v.hp = 1;
      g.combat.damage(P, v, 999, { exact: true, crit: false });
      const fall = g.survival?.falls?.get?.(v);
      if (fall) fall.crawled = 1e9;
      g.flags.finisherWarned = true;
      P.faceToward(v.x, v.y);
      g.camera.snap?.();
      window.__fin = [];
      if (!window.__finOn) {
        window.__finOn = true;
        g.bus.on('finisher', (p) => window.__fin.push({ t: 'start', ...p }));
        g.bus.on('finisher_scene_end', (p) => window.__fin.push({ t: 'end', ...p }));
      }
      return { x: P.x, y: P.y, downed: !!v.downed };
    }, id);
  const hold = async () => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 9 }] });
      return async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      };
    }
    await page.keyboard.down('j');
    return async () => page.keyboard.up('j');
  };
  const started = () => page.waitForFunction(() => window.__fin.some((x) => x.t === 'start'), null, { timeout: 9000 }).then(() => true).catch(() => false);
  // A full scene, left to run.
  const at = await setup('bram');
  let release = await hold();
  const began = await started();
  check(began, `[${S.tag}] 13 holding the blow over Bram starts the scene`);
  await wait(250);
  await release();
  await wait(S.throttle ? 250 : 350);
  const mid = await ev(() => ({
    bars: !!document.querySelector('.fin-scene-layer.is-on'),
    hud: getComputedStyle(document.querySelector('.layer-hud')).opacity,
    zoom: document.getElementById('game-canvas')?.style.transform || '',
    pose: window.__game.player._finisherPose?.anim || null,
    hint: document.querySelector('.fin-skip-hint')?.textContent || '',
  }));
  check(mid.bars && /scale/.test(mid.zoom) && Number(mid.hud) < 0.5, `[${S.tag}] 13 letterbox bars, the camera closed in, the HUD aside`, JSON.stringify(mid));
  check(!!mid.pose, `[${S.tag}] 13 your own pose (${mid.pose})`);
  check(S.phone ? /Tap/.test(mid.hint) : /key/.test(mid.hint), `[${S.tag}] 13 it says how to skip: "${mid.hint}"`);
  await shot('finisher-raise');
  await wait(650);
  await shot('finisher-blow');
  const t0 = Date.now();
  await page.waitForFunction(() => window.__fin.some((x) => x.t === 'end'), null, { timeout: 8000 }).catch(() => {});
  const after = await ev(() => ({ end: window.__fin.find((x) => x.t === 'end')?.why, ts: window.__game.timeScale, x: window.__game.player.x, y: window.__game.player.y, playing: document.querySelector('.ui')?.classList.contains('fin-playing'), dead: !!window.__game.murder.dead.bram, rec: window.__game.murder.dead.bram?.cause }));
  check(after.end === 'done' && after.ts === 1 && !after.playing, `[${S.tag}] 13 it ends by itself and play comes back (${((Date.now() - t0) / 1000).toFixed(1)} s more)`, JSON.stringify(after));
  check(Math.abs(after.x - at.x) < 0.5 && Math.abs(after.y - at.y) < 0.5, `[${S.tag}] 13 exactly where you were`);
  check(after.dead && after.rec === 'killed', `[${S.tag}] 13 the death is the strike's, as before`);
  await wait(500);
  await shot('finisher-after');
  // Skipped: a tap or a click (phones, desktop), and a key (desktop).
  for (const how of S.phone ? ['tap'] : ['click', 'key']) {
    const who = how === 'key' ? 'tobias' : 'elda';
    await setup(who);
    release = await hold();
    if (!(await started())) {
      check(false, `[${S.tag}] 13 a second finisher (${who}) starts`);
      await release();
      continue;
    }
    await wait(200);
    await release();
    await wait(400);
    const t1 = Date.now();
    if (how === 'tap') await page.touchscreen.tap(S.w / 2, S.h / 2);
    else if (how === 'click') await page.mouse.click(S.w / 2, S.h / 2);
    else await page.keyboard.press('k');
    await page.waitForFunction(() => window.__fin.some((x) => x.t === 'end'), null, { timeout: 4000 }).catch(() => {});
    const sk = await ev(() => ({ why: window.__fin.find((x) => x.t === 'end')?.why, ts: window.__game.timeScale }));
    check(sk.why === 'skipped' && sk.ts === 1, `[${S.tag}] 13 a ${how} skips it (${Date.now() - t1} ms)`, JSON.stringify(sk));
  }
  // Never a child.
  await setup('pip');
  release = await hold();
  await wait(2600);
  await release();
  const child = await ev(() => ({ scene: !!window.__game._finisherScene, dead: !!window.__game.murder.dead.pip, any: window.__fin.length }));
  check(!child.scene && !child.dead && child.any === 0, `[${S.tag}] 13 never a child: no blow, no scene`, JSON.stringify(child));
  // 14: nothing of the dark changed by a killing and a finisher (a bandit too).
  const dark = await ev(() => {
    const g = window.__game;
    const P = g.player;
    const b = g.entities.all().find((e) => e.species === 'bandit' && !e.dead) || null;
    if (b) {
      b.x = P.x + 20;
      b.y = P.y;
      for (let i = 0; i < 10 && !b.dead; i++) {
        b.invuln = 0;
        g.combat.damage(P, b, 999, { exact: true, crit: false });
        if (b.downed && !b.dead) g.combat.kill(b, P);
      }
    }
    const u = g.unkindle;
    return { bandit: !!b?.dead, learned: !!u?.learned, tally: u?.tally ?? 0, bar: u?.coldfire?.bar ?? 0, mark: u?.coldfire?.mark ?? 0, tier: u?.signs?.tier?.() ?? 0, pact: g.villain?.state?.pact ?? null };
  });
  check(!dark.learned && dark.tally === 0 && dark.bar === 0 && dark.mark === 0 && dark.tier === 0 && !dark.pact, `[${S.tag}] 14 Bram and Elda finished${dark.bandit ? ', a bandit killed' : ''}: no soul taken, no cold, no dark sign, no pact`, JSON.stringify(dark));
}

// 14 in the world: a boss's shard is not drawn into you while its soul rises; the pact path.
async function soulPart(S, ctx, page) {
  const { wait, ev, shot } = helpers(S, ctx, page);
  await ev(() => {
    const g = window.__game;
    window.__clean();
    const b = g.bosses.get('lakes_hum') || g.bosses.spawn('lakes_hum');
    g.player.x = b.x + 6;
    g.player.y = b.y + 14;
    g.camera.snap?.();
    b.think = () => {};
    window.__boss = b;
  });
  await wait(300);
  await ev(() => {
    const g = window.__game;
    window.__boss.beginDefeat(g.player);
    window.__t0 = g.time;
    window.__seen = [];
  });
  let closest = Infinity;
  let takenAt = null;
  for (let i = 0; i < 28; i++) {
    const r = await ev(() => {
      const g = window.__game;
      const P = g.player;
      const s = g.entities.all().filter((e) => e.type === 'glyph');
      return { t: g.time - window.__t0, d: s.length ? Math.min(...s.map((e) => Math.hypot(e.x - P.x, e.y - P.y))) : null, n: s.length };
    });
    if (r.t < 3.1 && r.d != null) closest = Math.min(closest, r.d);
    if (takenAt == null && r.n === 0 && r.t > 0.6) takenAt = r.t;
    if (i === 6) await shot('soul-boss-rise');
    await wait(120);
  }
  check(takenAt == null || takenAt > 3.0, `[${S.tag}] 14 the boss's shard is not drawn into you while its soul rises (closest ${closest.toFixed(0)} px${takenAt != null ? `, taken at ${takenAt.toFixed(1)} s` : ', not taken'})`);
  // The pact path: the Unkindling still draws the soul in.
  const pact = await ev(async () => {
    const g = window.__game;
    window.__clean();
    const u = g.unkindle;
    g.bus.emit('pact_sealed', { gifts: ['dark', 'bloodprice', 'unkindle'], pact: 'before' });
    const P = g.player;
    const m = g.locations.get('south_meadow').center;
    P.x = m.x;
    P.y = m.y;
    const v = window.__hold('wenna');
    v.x = P.x + 14;
    v.y = P.y;
    P.faceToward(v.x, v.y);
    g.camera.snap?.();
    const r = u.begin(v);
    return { learned: !!u.learned, ok: !!r?.ok, why: r?.reason || '' };
  });
  await page.waitForFunction(() => !window.__game.unkindle.channel, null, { timeout: 15000 }).catch(() => {});
  const took = await ev(() => ({ tally: window.__game.unkindle.tally, bar: window.__game.unkindle.coldfire?.bar ?? 0 }));
  check(pact.learned && pact.ok && took.tally >= 1 && took.bar > 0, `[${S.tag}] 14 on the pact path the Unkindling still draws the soul in`, JSON.stringify({ ...pact, ...took }));
}

for (const S of SIZES) {
  console.log(`\n== ${S.tag} ${S.w}x${S.h}${S.throttle ? ` (${S.throttle}x CPU)` : ''}`);
  for (const part of [shopPart, missionPart, finisherPart, soulPart].filter((p) => !PARTS || PARTS.includes(p.name.replace('Part', '')))) {
    const { ctx, page, errors } = await newGame(S);
    try {
      await part(S, ctx, page);
    } catch (err) {
      check(false, `[${S.tag}] ${part.name} ran`, err.message.split('\n')[0]);
      await page.screenshot({ path: `${OUT}/${S.tag}-${part.name}-error.png` }).catch(() => {});
    }
    check(errors.length === 0, `[${S.tag}] ${part.name}: no page errors`, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`\n${checks - failures.length}/${checks} checks passed${failures.length ? `\nFAILED:\n  ${failures.join('\n  ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
