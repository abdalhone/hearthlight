// Round 15, the power builder's check (DESIGN §40.3, §40.8, §40.10): the author's own fight played
// in the browser by real input, on a computer (keys and the mouse) and on a phone held sideways
// and upright (taps, a held weave button dragged to aim, a 4x CPU throttle sideways).
//
//   npm run build && node scripts/power_check.mjs [--only fight,book,soul] [--sizes desk,land,port] [--long]
//
// The author: "My level is 7. I just killed the boss on the right of the map, and I … put every
// single thing I can on my spells, and I literally killed her in 2 hits … fully charged";
// "Increase the mana of modified spells and spells in general"; and the Unkindling "too easy".
//
//   fight: a level-7 stranger, every point on spells (half Weave, half Focus), with the strongest
//          weave that pool fires at full charge in slot 2 (found by scripts/stats_sim.mjs with
//          the game's own pieces), walks into the Lake's Hum's arena and holds key 2 (or the
//          weave button) at her until the charge is full. Checks: no handful of charged casts
//          beats her (she stands after three); her guard shows when struck hard; a charged cast
//          costs what the Spellbook says. With --long it plays on until she falls or you do (a
//          real fight, minutes).
//   book:  the Spellbook's cost tile for a weave with twists reads the true cost (game.magic's
//          costOf), the charge's full cost is named, on three screens.
//   soul:  the Unkindling's hint names the odds before you start ("Hold F · Bram · even odds"),
//          the same odds the hold then plays out; a boss shrugs it off whatever the build.
//
// Screenshots at deviceScaleFactor 1 into $OUT (default: screenshots/power). Exit 1 on a failed
// check or a page error.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';
import { strongestWeave } from './stats_sim.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const ONLY = opt('--only')?.split(',') || ['fight', 'book', 'soul'];
const SIZES_WANT = opt('--sizes')?.split(',') || ['desk', 'land', 'port'];
const LONG = argv.includes('--long');
const OUT = process.env.OUT || opt('--out') || 'screenshots/power';
await mkdir(OUT, { recursive: true });

const SIZES = [
  { name: 'desk', w: 1280, h: 720, phone: false },
  { name: 'land', w: 844, h: 390, phone: true, throttle: 4 },
  { name: 'port', w: 390, h: 844, phone: true },
].filter((s) => SIZES_WANT.includes(s.name));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The strongest weave a level-7 stranger with every point on spells fires at full charge from a
// full pool: read from the game's own code, so the browser plays what the numbers say.
const LEVEL = 7;
const ALL = 3 * (LEVEL - 1);
const POINTS = { weave: Math.ceil(ALL / 2), focus: Math.floor(ALL / 2) };
let STRONG = null;
if (ONLY.includes('fight') || ONLY.includes('book')) {
  const { makeGame } = await import('./stats_sim.mjs');
  const pool = makeGame({ level: LEVEL, points: POINTS, bosses: false }).magic.mana.max;
  STRONG = strongestWeave({ level: LEVEL, points: POINTS, essences: 2, twists: 3, pool, sim: 18 });
  console.log(`strongest weave at level ${LEVEL} (pool ${pool}): ${STRONG.weave.shape} ${STRONG.weave.essences.join('+')} [${STRONG.weave.twists.join(',')}] "${STRONG.name}" cost ${STRONG.cost}, full ${STRONG.full}, one full cast deals ${STRONG.dealt} to a boss's body`);
}

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();

async function open(size) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: size.phone, hasTouch: size.phone });
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
  await wait(600);
  let cdp = null;
  if (size.phone) cdp = await context.newCDPSession(page);
  if (size.throttle && cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: size.throttle });
  return { context, page, errors, cdp };
}

// A level-7 stranger with every point on spells, the parts the weave needs learned for real (as
// missions and bosses teach them), the weave in slot 2, Lyra left at home (solo).
async function setupStranger(page, weave) {
  return page.evaluate(
    ({ weave, points, level }) => {
      const g = window.__game;
      const P = g.player;
      g.clock?.skipTo?.(11);
      P.level = level;
      for (const id of Object.keys(g.progression.points)) g.progression.points[id] = 0;
      Object.assign(g.progression.points, points);
      g.progression.changed();
      for (const id of ['iron_sword', 'leather_jerkin']) {
        P.inventory.add(id, 1);
        g.gear.equip(id);
      }
      const m = g.magic;
      if (weave) {
        m.unlock('shape', weave.shape, 'test');
        for (const e of weave.essences) m.unlock('essence', e, 'test');
        for (const t of weave.twists) m.unlock('twist', t, 'test');
        while (m.twistSlots < weave.twists.length && m.unlockTwistSlot()) {}
        m.setSlot(1, weave);
      }
      g.stats.refresh(P);
      P.hp = P.maxHp;
      m._recomputeMax?.(9999, true);
      m.mana.cur = m.mana.max;
      // Solo: Lyra stays in the village.
      const L = g.companion;
      if (L) {
        L.update = () => {};
        L.x = 96 * 16;
        L.y = 84 * 16;
      }
      try {
        // The magic lessons are taught already (this stranger is level 7).
        const c = g.ui?.coach;
        if (c) {
          c.done = new Proxy({}, { get: () => true });
          c.stop?.();
        }
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
      const plan = m.slotPlan(1);
      return { pool: m.mana.max, cost: plan ? m.costOf(P, plan) : 0, name: plan?.name, power: g.stats.get(P, 'spellPower'), hp: P.maxHp };
    },
    { weave, points: POINTS, level: LEVEL },
  );
}

// To the Lake's Hum, on her shore, the fight begun as walking in begins it.
async function toLake(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const P = g.player;
    const b = g.bosses.get('lakes_hum');
    const a = g.bosses.arenas.lakes_hum;
    let spot = null;
    for (let k = 0; k < 32 && !spot; k++) {
      const ang = (k / 32) * Math.PI * 2;
      for (const f of [0.75, 0.6, 0.9, 0.45]) {
        const x = a.x + Math.cos(ang) * a.r * f;
        const y = a.y + Math.sin(ang) * a.r * f;
        if (!g.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), P) && Math.hypot(x - b.x, y - b.y) > 60) {
          spot = { x, y };
          break;
        }
      }
    }
    P.x = spot.x;
    P.y = spot.y;
    g.camera.follow?.(P);
    g.camera.snap?.();
    g.bosses.startFight('lakes_hum');
    window.__fight = { t0: g.clock.t, won: false, casts: 0, big: 0, hits: [], guards: 0, costs: [] };
    if (!window.__powerHook) {
      window.__powerHook = true;
      g.bus.on('boss_defeated', () => {
        window.__fight.won = true;
        window.__fight.t1 = g.clock.t;
      });
      g.bus.on('spell_cast', (e) => {
        if (e.caster !== g.player) return;
        window.__fight.casts++;
        if (e.slot === 1) window.__fight.big++;
      });
      g.bus.on('damage', (e) => {
        if (e.target === g.bosses.get('lakes_hum') && e.source === g.player && e.amount > 0) window.__fight.hits.push(e.amount);
      });
      g.bus.on('boss_guard', () => window.__fight.guards++);
      g.bus.on('mana_changed', (e) => {
        const f = window.__fight;
        if (f.lastMana != null && e.cur < f.lastMana - 0.5) f.costs.push(Math.round((f.lastMana - e.cur) * 10) / 10);
        f.lastMana = e.cur;
      });
    }
    window.__fight.lastMana = g.magic.mana.cur;
    return { x: spot.x, y: spot.y };
  });
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const P = g.player;
    const b = g.bosses.get('lakes_hum');
    const p = g.renderer.worldToCss(b.x, b.y - 8);
    const r = g.canvas.getBoundingClientRect();
    const me = g.renderer.worldToCss(P.x, P.y - 8);
    let danger = null;
    for (const m of b.markers || []) {
      const dx = P.x - m.x;
      const dy = P.y - m.y;
      const d = Math.hypot(dx, dy);
      let inside = false;
      if (m.kind === 'circle') inside = d <= (m.r || 0) + 4;
      else if (m.kind === 'ring') inside = Math.abs(d - (m.r || 0)) < 24;
      else if (m.kind === 'line') {
        const x1 = m.x + Math.cos(m.angle) * m.len;
        const y1 = m.y + Math.sin(m.angle) * m.len;
        const lx = x1 - m.x;
        const ly = y1 - m.y;
        const l2 = lx * lx + ly * ly || 1;
        const t = Math.max(0, Math.min(1, (dx * lx + dy * ly) / l2));
        inside = Math.hypot(P.x - (m.x + lx * t), P.y - (m.y + ly * t)) <= (m.w || 8) / 2 + 4;
      } else if (m.kind === 'cone') {
        let da = Math.atan2(dy, dx) - m.angle;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        inside = d <= (m.range || 0) + 4 && (d < 6 || Math.abs(da) <= (m.arc || 1) / 2 + 0.2);
      }
      if (inside) danger = { x: m.x, y: m.y, left: (m.dur ?? 0.8) - (m.t ?? 0) };
    }
    const plan = g.magic.slotPlan(1);
    return {
      t: g.clock.t - window.__fight.t0,
      bx: r.left + p.x,
      by: r.top + p.y,
      mx: r.left + me.x,
      my: r.top + me.y,
      dx: b.x - P.x,
      dy: b.y - P.y,
      d: Math.hypot(b.x - P.x, b.y - P.y),
      bhp: Math.round(b.hp),
      bmax: b.maxHp,
      mode: b.mode,
      veiled: !!b.veiled,
      up: b.mem?.stage === 'up' || b.mem?.stage === 'rise',
      guard: !!b.guarded?.(),
      php: Math.round(P.hp),
      pmax: P.maxHp,
      down: !!(P.downed || P.dead || P.hp <= 0),
      mana: Math.round(g.magic.mana.cur),
      full: plan ? (typeof g.magic.chargedCost === 'function' ? g.magic.chargedCost(P, plan, 1) : g.magic.costOf(P, plan) * 2) : 0,
      ready: g.magic.canCast(1).ok,
      sparkReady: g.magic.canCast(0).ok,
      danger,
      won: window.__fight.won,
      casts: window.__fight.casts,
      big: window.__fight.big,
      guards: window.__fight.guards,
      hits: window.__fight.hits.length,
      costs: window.__fight.costs.slice(),
      holding: g.magic.holdOf?.(P)?.k ?? null,
    };
  });

// ------------------------------------------------------------------ input, by device

async function moveKeys(page, dx, dy, ms) {
  const keys = [];
  if (dx < -0.3) keys.push('KeyA');
  if (dx > 0.3) keys.push('KeyD');
  if (dy < -0.3) keys.push('KeyW');
  if (dy > 0.3) keys.push('KeyS');
  for (const k of keys) await page.keyboard.down(k);
  await wait(ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function weaveButton(page, slot) {
  return page.evaluate((slot) => {
    const el = document.querySelector(`.tcluster .wbtn[data-slot="${slot}"]:not([hidden])`);
    const q = el?.getBoundingClientRect();
    return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
  }, slot);
}

// Hold a weave until its charge is full (or the pool caps it), aimed at the boss, then let go.
async function chargedCast(page, size, cdp, slot = 1) {
  const s = await state(page);
  if (!size.phone) {
    await page.mouse.move(Math.round(s.bx), Math.round(s.by));
    const key = `Digit${slot + 1}`;
    await page.keyboard.down(key);
    const t0 = Date.now();
    while (Date.now() - t0 < 2600) {
      await wait(90);
      const st = await state(page);
      await page.mouse.move(Math.round(st.bx), Math.round(st.by));
      if (st.danger && st.danger.left < 0.5) break;
      const k = await page.evaluate(() => window.__game.magic.holdOf?.(window.__game.player));
      if (k && (k.k >= 1 || k.capped) && Date.now() - t0 > 400) break;
    }
    await page.keyboard.up(key);
    return true;
  }
  // A phone: press the weave button, drag toward the boss (the aim follows the drag), hold, lift.
  const b = await weaveButton(page, slot);
  if (!b) return false;
  const id = 7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(b.x), y: Math.round(b.y), id }] });
  const t0 = Date.now();
  let last = { x: b.x, y: b.y };
  while (Date.now() - t0 < (size.throttle ? 3600 : 2600)) {
    await wait(size.throttle ? 160 : 90);
    const st = await state(page);
    // Drag out the way the boss lies from you, as a thumb does.
    const l = Math.hypot(st.bx - st.mx, st.by - st.my) || 1;
    const x = Math.round(b.x + ((st.bx - st.mx) / l) * 70);
    const y = Math.round(b.y + ((st.by - st.my) / l) * 70);
    if (x !== last.x || y !== last.y) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] });
      last = { x, y };
    }
    if (st.danger && st.danger.left < 0.5) break;
    const k = await page.evaluate(() => window.__game.magic.holdOf?.(window.__game.player));
    if (k && (k.k >= 1 || k.capped) && Date.now() - t0 > 500) break;
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}

async function tapSpark(page, size, cdp) {
  const s = await state(page);
  if (!size.phone) {
    await page.mouse.move(Math.round(s.bx), Math.round(s.by));
    await page.keyboard.down('Digit1');
    await wait(60);
    await page.keyboard.up('Digit1');
    return;
  }
  const b = await weaveButton(page, 0);
  if (!b) return;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(b.x), y: Math.round(b.y), id: 8 }] });
  await wait(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// Out of a marker: a step away (keys, or the stick dragged on the left half), then a roll.
async function dodge(page, size, cdp, s) {
  const ax = s.mx - (s.danger ? s.bx : 0);
  const ay = s.my - (s.danger ? s.by : 0);
  const l = Math.hypot(ax, ay) || 1;
  if (!size.phone) {
    await moveKeys(page, ax / l, ay / l, 260);
    if (s.danger.left < 0.35) {
      await page.keyboard.down('ShiftLeft');
      await wait(40);
      await page.keyboard.up('ShiftLeft');
    }
    return;
  }
  const vw = size.w;
  const vh = size.h;
  const sx = Math.round(vw * 0.18);
  const sy = Math.round(vh * 0.7);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(sx + (ax / l) * 40), y: Math.round(sy + (ay / l) * 40), id: 3 }] });
  await wait(size.throttle ? 380 : 260);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ------------------------------------------------------------------ fight

async function fight(size) {
  const tag = `${size.name}-lake`;
  const { context, page, errors, cdp } = await open(size);
  const info = await setupStranger(page, STRONG.weave);
  await toLake(page);
  await wait(900);
  await page.screenshot({ path: `${OUT}/${tag}-0-arena.png` });
  const shots = new Set();
  const t0 = Date.now();
  const budgetMs = LONG ? (size.throttle ? 900000 : 600000) : 45000;
  let charged = 0;
  let s = await state(page);
  while (Date.now() - t0 < budgetMs) {
    s = await state(page);
    if (s.won || s.down || s.mode !== 'fight') break;
    if (s.danger) {
      await dodge(page, size, cdp, s);
      continue;
    }
    // Keep about a weave's distance from her.
    if (s.d > 150 || (s.veiled && s.d > 110)) {
      if (!size.phone) await moveKeys(page, s.dx / s.d, s.dy / s.d, 220);
      else await dodge(page, size, cdp, { ...s, danger: { x: 0, y: 0, left: 9 }, bx: s.mx - s.dx, by: s.my - s.dy });
      continue;
    }
    if (!s.veiled && s.ready && s.mana >= s.full - 0.5) {
      await chargedCast(page, size, cdp, 1);
      charged++;
      await wait(250);
      const after = await state(page);
      if (charged <= 3 && !shots.has(charged)) {
        shots.add(charged);
        await page.screenshot({ path: `${OUT}/${tag}-${charged}-after-charged.png` });
      }
      if (!LONG && charged >= 3) break;
      if (after.guard && !shots.has('guard')) {
        shots.add('guard');
        await page.screenshot({ path: `${OUT}/${tag}-guard.png` });
      }
      continue;
    }
    if (!s.veiled && s.sparkReady && s.mana > 8) await tapSpark(page, size, cdp);
    await wait(size.throttle ? 200 : 120);
  }
  s = await state(page);
  await page.screenshot({ path: `${OUT}/${tag}-end.png` });
  const secs = Math.round(s.t);
  console.log(`  [${size.name}] ${info.name}: pool ${info.pool}, cost ${info.cost}; ${charged} charged casts, ${s.casts} casts in all, ${secs} s; her health ${s.bhp}/${s.bmax}; guards ${s.guards}; you ${s.php}/${s.pmax}${s.won ? ' — she fell' : ''}${s.down ? ' — you fell' : ''}; mana paid ${JSON.stringify(s.costs)}`);
  if (!LONG) {
    check(`[${size.name}] three fully charged casts of the strongest weave a level-7 pool fires do not beat the Lake's Hum`, !s.won && s.bhp > 0.5 * s.bmax, `${charged} charged, ${s.bhp}/${s.bmax} left`);
    check(`[${size.name}] a charged cast pays the full-charge cost`, s.costs.some((c) => Math.abs(c - s.full) <= Math.max(1, s.full * 0.04)), `paid ${JSON.stringify(s.costs)}, full ${Math.round(s.full)}`);
  } else {
    check(`[${size.name}] the fight lasts minutes, not a burst`, s.won ? secs >= 180 : secs >= 120, `${secs} s, ${s.won ? 'won' : s.down ? 'fell' : 'unfinished'}`);
  }
  check(`[${size.name}] no page errors in the fight`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

for (const size of SIZES) {
  if (ONLY.includes('fight')) await fight(size);
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
