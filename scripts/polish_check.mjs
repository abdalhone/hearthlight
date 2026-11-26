// Polish check (round 14b, workstream polish): plays the polish items in the built game on
// a phone sideways (844×390) and upright (390×844) by touch, and on a computer (1280×720) by
// mouse and keys, saves screenshots, and asserts:
//   A. the down countdown: its words sit on a solid backing (readable under the pale crowns
//      of the treeline camp); on a phone the countdown and Call for help stay clear of the
//      floating stick's zone, even when the thumb lands high;
//   B. Interface size (computer): the countdown ring and the ember-ring arrow grow with it;
//   C. the Last Stand's fire at the screen's edges is plainly there (measured at the edges);
//   D. snow at dusk on the Crown Ring stays cool and pale (measured on the snow);
//   E. the Spellbook's Leech preview shows life drawn back to the caster (measured: a green
//      stream a plain bolt never draws);
//   F. every price chosen in the Spellbook pays, shows on the HUD and runs clean;
//   G. broken props mend only where people live (Brindlecombe stays broken, the vale mends);
//   and no page errors, no sideways scroll. Optionally a 4× CPU throttle on the upright phone.
//
//   node scripts/polish_check.mjs              (build first: npm run build)
//   node scripts/polish_check.mjs --out DIR    screenshots there (default screenshots/polish)
//   node scripts/polish_check.mjs --only A,C   only some items
//   node scripts/polish_check.mjs --sizes upright,desktop
//   node scripts/polish_check.mjs --soft       report, but exit 0 (for the "before" run)
// Exit code 1 on any failure.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = arg('--out', 'screenshots/polish');
const ONLY = new Set(String(arg('--only', 'A,B,C,D,E,F,G,T')).split(','));
const SOFT = argv.includes('--soft');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ALL_SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
];
const SIZES = ALL_SIZES.filter((s) => String(arg('--sizes', 'sideways,upright,desktop')).split(',').includes(s.tag));

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
const measures = {};
let checks = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  return ok;
};

async function run(S) {
  const tag = S.tag;
  const M = (measures[tag] = {});
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
  const shot = (name, clip) => page.screenshot({ path: `${OUT}/${tag}-${name}.png`, clip });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tapAt = async (x, y, ms = 60) => {
    if (S.phone) {
      await page.touchscreen.tap(x, y);
      return;
    }
    await page.mouse.move(x, y);
    await page.mouse.down();
    await wait(ms);
    await page.mouse.up();
  };
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
    }, sel);
  const inside = (r) => !!r && r.x >= -0.5 && r.y >= -0.5 && r.r <= S.w + 0.5 && r.b <= S.h + 0.5;
  const overlap = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  // Mean colour and luminance of the game canvas (the lit world, with the fall's and the
  // last stand's screen effects) over a set of rectangles, in CSS px of the viewport.
  const canvasStats = (rects) =>
    ev((rects) => {
      const c = document.querySelector('canvas');
      const ctx2 = c.getContext('2d');
      const sx = c.width / c.clientWidth;
      const sy = c.height / c.clientHeight;
      let r = 0, g = 0, b = 0, n = 0;
      for (const q of rects) {
        const x0 = Math.max(0, Math.round(q.x * sx));
        const y0 = Math.max(0, Math.round(q.y * sy));
        const w = Math.max(1, Math.min(c.width - x0, Math.round(q.w * sx)));
        const h = Math.max(1, Math.min(c.height - y0, Math.round(q.h * sy)));
        const d = ctx2.getImageData(x0, y0, w, h).data;
        for (let i = 0; i < d.length; i += 16) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
        }
      }
      r /= n;
      g /= n;
      b /= n;
      return { r: Math.round(r), g: Math.round(g), b: Math.round(b), lum: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
    }, rects);
  const edgeBand = () => {
    const e = Math.round(Math.min(S.w, S.h) * 0.07);
    return [
      { x: 0, y: 0, w: S.w, h: e },
      { x: 0, y: S.h - e, w: S.w, h: e },
      { x: 0, y: e, w: e, h: S.h - 2 * e },
      { x: S.w - e, y: e, w: e, h: S.h - 2 * e },
    ];
  };
  const centre = () => [{ x: S.w * 0.3, y: S.h * 0.3, w: S.w * 0.4, h: S.h * 0.4 }];

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
    for (const id of ['cast', 'book', 'found', 'move', 'talk']) if (u?.coach?.done) u.coach.done[id] = true;
    u?.coach?.stop?.();
    u?.toasts?.clear?.();
    g.settings.deathMode = 'home';
    g._alert = g.survival.alert.bind(g.survival);
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    // Walk alone for these (Lyra stays home).
    g.companion.behavior?.setDirective?.({ type: 'stay', x: g.companion.x, y: g.companion.y });
  });
  // Put the player somewhere (tile coordinates), the camera with them.
  const goTo = (tx, ty, hour) =>
    ev(
      ({ tx, ty, hour }) => {
        const g = window.__game;
        const P = g.player;
        P.x = tx * 16 + 8;
        P.y = ty * 16 + 8;
        if (hour != null) g.clock?.skipTo?.(hour);
        g.camera.snap();
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast').forEach((t) => t.remove());
      },
      { tx, ty, hour },
    );
  const getUp = () =>
    ev(() => {
      const g = window.__game;
      const P = g.player;
      if (g.survival.isFallen(P)) g.survival.reviveFall(P, null, 1);
      P.downed = false;
      P.dead = false;
      P.hp = P.maxHp;
      P.invuln = 0;
    });

  // ---------- A. the down countdown ----------
  if (ONLY.has('A')) {
    // The treeline camp (wilds_layout.js P.treelineCamp), at noon: pale crowns all round.
    await goTo(84, -146, 12);
    await wait(900);
    await ev(() => window.__game.player.fall({ cause: 'test' }));
    await wait(2600);
    const block = await rectOf('.sv-fallen');
    const ring = await rectOf('.sv-ring');
    const call = await rectOf('.sv-call');
    const words = await rectOf('.sv-words-col');
    const zone = S.phone ? await rectOf('.stick-zone') : null;
    await shot('A1-countdown-treeline');
    const backing = await ev(() => {
      const el = document.querySelector('.sv-clock');
      const cs = el && getComputedStyle(el);
      const m = cs && /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
      return { bg: cs?.backgroundColor || '', alpha: parts.length === 4 ? parts[3] : parts.length === 3 ? 1 : 0 };
    });
    M.backing = backing;
    check(inside(block), `${tag} A: the countdown is on screen`);
    check(backing.alpha >= 0.6, `${tag} A: its words sit on a solid backing (${backing.bg})`);
    check(!!call && call.h >= 44, `${tag} A: Call for help 44 px+ (${call && Math.round(call.h)})`);
    if (S.phone) {
      // The stick zone (where a thumb may land to crawl) and the countdown never share ground.
      M.zone = zone;
      M.block = block;
      check(!overlap(zone, ring) && !overlap(zone, call), `${tag} A: the ring and Call for help are clear of the stick zone`);
      check(!overlap(zone, words), `${tag} A: the words are clear of the stick zone`);
      // A thumb that lands high in the zone: the stick appears under it.
      if (zone) {
        const tx = Math.round(zone.x + Math.min(90, zone.w * 0.35));
        const ty = Math.round(zone.y + 24);
        await touch('touchStart', [{ x: tx, y: ty, id: 3 }]);
        for (let i = 1; i <= 4; i++) {
          await touch('touchMove', [{ x: tx + 6 * i, y: ty, id: 3 }]);
          await wait(16);
        }
        await wait(250);
        const stick = await rectOf('.stick-zone .stick');
        await shot('A2-thumb-high');
        check(!overlap(stick, ring) && !overlap(stick, call), `${tag} A: a thumb landing high keeps the stick off the ring and Call for help`);
        await touch('touchEnd', []);
        await wait(300);
      }
    }
    // Readable: the words' own box is darker than the world behind it.
    const under = words ? await canvasStats([{ x: words.x, y: words.y, w: words.w, h: words.h }]) : null;
    M.underWords = under;
    await getUp();
    await wait(400);
  }

  // ---------- B. Interface size (a computer) ----------
  if (ONLY.has('B') && !S.phone) {
    await goTo(80, 90, 11);
    const z = await ev(() => {
      const g = window.__game;
      g.settings.uiSize = 'large';
      g.bus.emit('settings_changed', { key: 'uiSize', value: 'large' });
      g.ui?.applySettings?.();
      window.dispatchEvent(new Event('resize'));
      return g.ui._uiz || 1;
    });
    await wait(400);
    const z2 = await ev(() => window.__game.ui._uiz || 1);
    M.uiz = z2;
    await ev(() => window.__game.player.fall({ cause: 'test' }));
    await wait(2400);
    const ring = await rectOf('.sv-ring');
    const call = await rectOf('.sv-call');
    const block = await rectOf('.sv-fallen');
    const hotbar = await rectOf('.hotbar');
    await shot('B1-countdown-large');
    M.ringLarge = ring && Math.round(ring.w);
    check(!!ring && ring.w >= 136 * z2 * 0.95, `${tag} B: the ring follows Interface size (${ring && Math.round(ring.w)} px at ×${z2}; ${z})`);
    check(!!call && call.h >= 50 * z2 * 0.9, `${tag} B: Call for help follows it too (${call && Math.round(call.h)} px)`);
    check(inside(block), `${tag} B: the countdown still fits the screen`);
    check(!overlap(block, hotbar), `${tag} B: clear of the hotbar`);
    await getUp();
    // The ember-ring arrow: a ring of coins far off to the east.
    await ev(() => {
      const g = window.__game;
      const P = g.player;
      g.survival.placeRing({ x: P.x + 2400, y: P.y - 300, coins: 57, day: 1, where: 'by the far shore', place: 'the far shore' });
      g.bus.emit('ember_ring', { coins: 57, lost: 0, x: P.x + 2400, y: P.y - 300 });
    });
    await wait(700);
    const tip = await rectOf('.er-edge-tip');
    const label = await rectOf('.er-edge-label');
    // (zoom leaves the computed font size alone: measure the words' drawn height)
    const fs = label ? label.h / 1.2 : 0;
    await shot('B2-ember-arrow-large');
    M.tip = tip;
    M.labelFont = fs;
    check(!!tip && Math.max(tip.w, tip.h) >= 20 * z2 * 0.9, `${tag} B: the ember arrow follows Interface size (${tip && Math.round(Math.max(tip.w, tip.h))} px)`);
    check(fs >= 11 * z2 * 0.9, `${tag} B: and its words (${Math.round(fs)} px type)`);
    check(inside(tip) && inside(label), `${tag} B: the arrow and its words are on screen`);
    // The ring far to the north, a little either side: the grown arrow sits under the mission
    // line (and under a corner card when it is off to a side), never on it.
    const hudHits = [];
    for (const [ox, oy, name] of [[0, -2400, 'north'], [-500, -2400, 'north-west'], [700, -2400, 'north-east'], [-2400, -1700, 'up-left']]) {
      await ev(({ ox, oy }) => {
        const g = window.__game;
        const P = g.player;
        g.survival.putOutRing?.('test');
        g.survival.placeRing({ x: P.x + ox, y: P.y + oy, coins: 57, day: 1, where: 'up the hill', place: 'the hill' });
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast').forEach((t) => t.remove());
      }, { ox, oy });
      await wait(900);
      const t = await rectOf('.er-edge-tip');
      const l = await rectOf('.er-edge-label');
      const boxes = await Promise.all(['.hud-center .quest-line', '.hud-cards', '.hud-right'].map((q) => rectOf(q)));
      const hit = boxes.findIndex((b) => overlap(b, t) || overlap(b, l));
      if (hit >= 0) hudHits.push(`${name}: ${['mission line', 'cards', 'right corner'][hit]}`);
      if (name === 'north') await shot('B3-ember-arrow-north-large');
    }
    M.arrowHud = hudHits;
    check(hudHits.length === 0, `${tag} B: the grown arrow and its words keep clear of the mission line and the cards (${hudHits.join('; ') || 'clear'})`);
    await ev(() => {
      const g = window.__game;
      g.survival.putOutRing?.('test');
      g.settings.uiSize = 'normal';
      g.bus.emit('settings_changed', { key: 'uiSize', value: 'normal' });
      window.dispatchEvent(new Event('resize'));
    });
    await wait(400);
  }

  // ---------- C. the Last Stand's fire ----------
  if (ONLY.has('C')) {
    await goTo(80, 90, 12);
    await wait(800);
    const calm = await canvasStats(edgeBand());
    await ev(() => {
      const g = window.__game;
      g.ui?.toasts?.clear?.();
      g.prices.armLastStand(g.player);
      g.prices.riseLastStand(g.player, 'chosen');
      g.ui?.toasts?.clear?.();
    });
    await wait(1600);
    const burn = await canvasStats(edgeBand());
    const mid = await canvasStats(centre());
    await ev(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await shot('C1-last-stand-burning');
    await ev(() => {
      window.__game.prices.state.laststand.t = 7;
    });
    await wait(1200);
    const hot = await canvasStats(edgeBand());
    await shot('C2-last-stand-last-seconds');
    // How much warmer the edges are than before it burned (red over blue, and brighter).
    const warm = (s) => s.r - s.b;
    M.burn = { calm, burn, hot, mid };
    check(warm(burn) - warm(calm) >= 45, `${tag} C: the edges burn plainly (red-blue ${warm(calm)} -> ${warm(burn)})`);
    check(burn.lum - calm.lum >= 8 || burn.r - calm.r >= 30, `${tag} C: and glow (lum ${calm.lum} -> ${burn.lum}, red ${calm.r} -> ${burn.r})`);
    check(warm(burn) - warm(mid) >= 30, `${tag} C: the fire is at the edges, the middle stays clear (${warm(mid)} vs ${warm(burn)})`);
    check(warm(hot) >= warm(burn) * 0.85, `${tag} C: still there in the last seconds (${warm(hot)})`);
    // The end of the minute is not part of this check: put the fire out quietly.
    await ev(() => {
      const g = window.__game;
      g.prices.state.laststand = null;
      g.stats?.removeModifier?.(g.player, 'price:laststand');
      g.stats?.refresh?.(g.player);
    });
    await wait(1500);
  }

  // ---------- D. snow at dusk ----------
  if (ONLY.has('D')) {
    // The Crown Ring (wilds_layout.js P.crownRing), at noon and at dusk.
    await goTo(76, -250, 12);
    await wait(1600);
    const noon = await canvasStats(centre());
    await shot('D1-crown-ring-noon');
    for (const [name, hour] of [
      ['D2-crown-ring-dusk', 18.6],
      ['D3-crown-ring-late-dusk', 19.3],
    ]) {
      await goTo(76, -250, hour);
      await wait(1800);
      const s = await canvasStats(centre());
      await shot(name);
      M[name] = s;
      // Cool: blue at least level with red; pale: bright enough to read as snow, not sand.
      check(s.b >= s.r - 4, `${tag} D: snow at ${hour}h stays cool (rgb ${s.r},${s.g},${s.b})`);
      if (hour < 19) check(s.lum >= noon.lum * 0.68, `${tag} D: and pale (lum ${s.lum}; noon ${noon.lum})`);
    }
    M.noon = noon;
    // Back in the vale at dusk: the snow's light stays on the snow.
    await goTo(80, 92, 18.6);
    await wait(1800);
    const vale = await canvasStats(centre());
    await shot('D4-vale-dusk');
    M.valeDusk = vale;
    check(vale.r > vale.b + 10, `${tag} D: the vale keeps its warm dusk (rgb ${vale.r},${vale.g},${vale.b})`);
    await goTo(80, 90, 12);
  }

  // ---------- E. the Leech preview ----------
  if (ONLY.has('E')) {
    const green = async (twists) => {
      await ev((twists) => {
        const g = window.__game;
        g.magic.unlockAll?.();
        g.ui.closeAll?.();
        g.ui.hud.weaving.setSlot(0, { shape: 'bolt', essences: ['fire'], twists, prices: [] });
        g.ui.openSpellbook(0);
      }, twists);
      await wait(600);
      // Sample the preview over two casts: how many pixels are the green of life coming home.
      let most = 0;
      let total = 0;
      for (let i = 0; i < 26; i++) {
        const n = await ev(() => {
          const c = document.querySelector('.sb-canvas');
          if (!c || !c.width) return 0;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let k = 0;
          for (let j = 0; j < d.length; j += 4) if (d[j + 1] > 150 && d[j + 1] > d[j] + 40 && d[j + 1] > d[j + 2] + 10) k++;
          return k;
        });
        total += n;
        if (n > most) {
          most = n;
          if (twists.length) await shot('E1-leech-preview');
          else await shot('E2-plain-bolt-preview');
        }
        await wait(180);
      }
      await ev(() => window.__game.ui.closeAll?.());
      await wait(200);
      return { most, total };
    };
    const leech = await green(['leech']);
    const plain = await green([]);
    M.leech = leech;
    M.plain = plain;
    check(leech.most >= Math.max(60, plain.most * 4), `${tag} E: the leech draws life home, a plain bolt does not (green px ${leech.most} vs ${plain.most})`);
    check(leech.total >= plain.total * 4 + 200, `${tag} E: and it shows on most frames (${leech.total} vs ${plain.total})`);
  }

  // ---------- F. prices chosen in the Spellbook ----------
  if (ONLY.has('F')) {
    await goTo(80, 90, 12);
    const res = await ev(() => {
      const g = window.__game;
      const P = g.player;
      const out = {};
      g.ui.closeAll?.();
      for (const id of ['bloodprice', 'glass', 'overdraw', 'emberblood', 'lastlight', 'oath', 'berserk']) {
        g.magic.unlock('price', id, 'dev');
        g.magic.resetCooldowns?.();
        const r = g.magic.cast(P, { shape: 'bolt', essences: ['raw'], twists: [], prices: [id] }, { x: P.x + 40, y: P.y }, { free: true });
        const timers = g.prices.timers(P).filter((t) => t.price === id).map((t) => `${t.kind}:${Number.isFinite(t.left) ? Math.round(t.left) : '-'}`);
        out[id] = { ok: !!r?.ok, timers };
      }
      return out;
    });
    await wait(700);
    const chips = await ev(() => document.querySelectorAll('.buff-row .buff').length);
    await shot('F1-prices-running');
    M.prices = res;
    for (const [id, r] of Object.entries(res)) check(r.ok && r.timers.length > 0, `${tag} F: ${id} pays and shows (${r.timers.join(' ')})`);
    check(chips >= 6, `${tag} F: the HUD shows their chips (${chips})`);
    // Overdraw's drought cannot be skipped by casting it again.
    const dry = await ev(() => {
      const g = window.__game;
      const P = g.player;
      const S = g.prices.state;
      if (S.overdraw) S.overdraw.gain = 0.01;
      g.prices.update(0.05);
      g.magic.resetCooldowns?.();
      g.magic.mana.cur = g.magic.mana.max;
      g.magic.cast(P, { shape: 'bolt', essences: ['raw'], twists: [], prices: ['overdraw'] }, { x: P.x + 40, y: P.y });
      return { gain: S.overdraw?.gain ?? null, cost: S.overdraw?.cost ?? null, regen: g.stats.get(P, 'manaRegen') };
    });
    M.overdrawRecast = dry;
    check(!(dry.gain > 0) && dry.regen === 0, `${tag} F: overdraw's drought holds when it is cast again (${JSON.stringify(dry)})`);
    // Down while the prices still run: the chips have grown the top cards to two rows, and
    // the countdown still sits under them (upright), never over them.
    await ev(() => {
      const g = window.__game;
      // (lastlight, chosen above, holds the first wound shut: the second fall is the one)
      for (let i = 0; i < 2 && !g.survival.isFallen(g.player); i++) {
        g.player.downed = false;
        g.player.fall({ cause: 'test' });
      }
    });
    await wait(1800);
    const cards = await rectOf('.hud-cards');
    const fallen = await rectOf('.sv-fallen');
    const zoneF = S.phone ? await rectOf('.stick-zone') : null;
    await shot('F2-down-with-prices');
    M.downWithPrices = { cards, fallen };
    check(inside(fallen) && !overlap(cards, fallen), `${tag} F: down with prices running, the countdown clears the grown cards (${cards && Math.round(cards.b)} / ${fallen && Math.round(fallen.y)})`);
    if (zoneF) check(!overlap(zoneF, fallen), `${tag} F: and still clears the stick zone`);
    await getUp();
    await wait(300);
    await ev(() => {
      const g = window.__game;
      g.prices.endRunning?.(null, 'test');
      g.prices.state.berserk = null;
      g.player.hp = g.player.maxHp;
    });
    await wait(300);
  }

  // ---------- G. mending only where people live ----------
  if (ONLY.has('G')) {
    // A prop in Brindlecombe (the dead village, round tile -306, 46), one in the wilds and
    // one in the vale.
    const r = await ev(() => {
      const g = window.__game;
      const kinds = new Set(['barrel', 'crate', 'fence', 'cart', 'woodpile', 'pot', 'sack', 'hay']);
      const all = g.objects.list.filter((o) => kinds.has(o.objType) && !o.removed && !o.hidden && !o.story && !o.inventory && !o.trailBoss && !o.unbreakable && !o.state?.broken);
      const dBr = (o) => Math.hypot(o.tx + 306, o.ty - 46);
      const dead = all.filter((o) => dBr(o) < 30).sort((a, b) => dBr(a) - dBr(b))[0];
      const wild = all.filter((o) => (o.tx < 0 || o.ty < 0 || o.tx >= 160 || o.ty >= 120) && dBr(o) > 40)[0];
      const home = all.filter((o) => o.tx >= 0 && o.ty >= 0 && o.tx < 160 && o.ty < 120)[0];
      const pick = (o) => o && { tx: o.tx, ty: o.ty, type: o.objType };
      return { dead: pick(dead), wild: pick(wild), home: pick(home) };
    });
    // Break them with a real blow: a Strike at each (again, if the first only chipped it).
    const strikeAt = async (o) => {
      if (!o) return false;
      await goTo(o.tx, o.ty + 2, 12);
      await wait(500);
      for (let i = 0; i < 4; i++) {
        const done = await ev((o) => {
          const g = window.__game;
          const P = g.player;
          const it = g.objects.list.find((x) => x.tx === o.tx && x.ty === o.ty && x.objType === o.type);
          if (!it) return true;
          if (it.state.broken) return true;
          P.x = it.x;
          P.y = it.y + 26;
          P.downed = false;
          g.magic.unlockAll?.();
          g.magic.resetCooldowns?.();
          P.faceDir?.('up');
          g.magic.cast(P, { shape: 'strike', essences: ['raw'], twists: [] }, { x: it.x, y: it.y - 8 }, { free: true });
          return false;
        }, o);
        if (done) return true;
        await wait(450);
      }
      return false;
    };
    const state = (o) => ev((o) => {
      const g = window.__game;
      const it = o && g.objects.list.find((x) => x.tx === o.tx && x.ty === o.ty && x.objType === o.type);
      return it ? { broken: !!it.state.broken, mendAt: it.state.mendAt || 0 } : null;
    }, o);
    for (const k of ['dead', 'wild', 'home']) if (r[k]) await strikeAt(r[k]);
    await wait(600);
    const before = { dead: await state(r.dead), wild: await state(r.wild), home: await state(r.home) };
    if (r.dead) {
      await goTo(r.dead.tx, r.dead.ty + 3, 12);
      await wait(500);
      await shot('G1-brindlecombe-broken');
    }
    // Three days on: every prop updated once more.
    await ev((r) => {
      const g = window.__game;
      g.clock.t += 3 * 900; // three days (DAY_SECONDS)
      g.player.x = 80 * 16;
      g.player.y = 90 * 16;
      for (const k of ['dead', 'wild', 'home']) {
        const o = r[k];
        const it = o && g.objects.list.find((x) => x.tx === o.tx && x.ty === o.ty && x.objType === o.type);
        it?.update?.(1 / 60);
      }
    }, r);
    const after = { dead: await state(r.dead), wild: await state(r.wild), home: await state(r.home) };
    if (r.dead) {
      await goTo(r.dead.tx, r.dead.ty + 3, 12);
      await wait(500);
      await shot('G2-brindlecombe-three-days-on');
    }
    M.mend = { r, before, after };
    check(!r.dead || (before.dead?.broken && after.dead?.broken), `${tag} G: a prop broken in Brindlecombe stays broken (${JSON.stringify([before.dead, after.dead])})`);
    check(!r.wild || (before.wild?.broken && after.wild?.broken), `${tag} G: one broken in the wilds stays broken (${JSON.stringify([before.wild, after.wild])})`);
    check(!r.home || (before.home?.broken && !after.home?.broken), `${tag} G: one broken in the vale is mended (${JSON.stringify([before.home, after.home])})`);
    await goTo(80, 90, 12);
  }

  // ---------- T. a phone at 4× CPU: the fall and the last stand still run ----------
  if (ONLY.has('T') && tag === 'upright') {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await goTo(84, -146, 12);
    await ev(() => window.__game.player.fall({ cause: 'test' }));
    await wait(1500);
    const fpsDown = await ev(() => new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(f);
        else res(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(f);
    }));
    await shot('T1-throttled-down');
    await getUp();
    await ev(() => {
      const g = window.__game;
      g.prices.armLastStand(g.player);
      g.prices.riseLastStand(g.player, 'chosen');
    });
    await wait(1500);
    const fpsBurn = await ev(() => new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(f);
        else res(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(f);
    }));
    await shot('T2-throttled-burning');
    await ev(() => {
      const g = window.__game;
      g.prices.state.laststand = null;
      g.stats?.removeModifier?.(g.player, 'price:laststand');
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    M.fps = { fpsDown, fpsBurn };
    // (the base build measured 17 and 22 here: the fall's colour drain is a full-screen pass)
    check(fpsDown >= 15 && fpsBurn >= 18, `${tag} T: 4× CPU, down ${fpsDown} fps, burning ${fpsBurn} fps`);
  }

  check((await ev(() => document.documentElement.scrollWidth)) <= S.w + 1, `${tag}: no sideways scroll`);
  check(!errors.length, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

for (const S of SIZES) {
  console.log(`[polish] ${S.tag}`);
  try {
    await run(S);
  } catch (err) {
    failures.push(`${S.tag}: crashed: ${err?.stack || err}`);
    console.log(`  CRASH ${err?.stack || err}`);
  }
}
await browser.close();
server.close();
await writeFile(`${OUT}/measures.json`, JSON.stringify(measures, null, 1));
console.log(`[polish] ${checks} checks, ${failures.length} failed; screenshots in ${OUT}/`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length && !SOFT ? 1 : 0);
