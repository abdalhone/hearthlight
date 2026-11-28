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

// To the boss (the Lake's Hum on her shore, the Mother in her pools), the fight begun as
// walking in begins it.
async function toLake(page, id = 'lakes_hum') {
  return page.evaluate((id) => {
    const g = window.__game;
    const P = g.player;
    window.__bossId = id;
    const b = g.bosses.get(id);
    const a = g.bosses.arenas[id];
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
    g.bosses.startFight(id);
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
        if (e.target === g.bosses.get(window.__bossId) && e.source === g.player && e.amount > 0) window.__fight.hits.push(e.amount);
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
  }, id);
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    const P = g.player;
    const b = g.bosses.get(window.__bossId || 'lakes_hum');
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
      if (inside) danger = { x: m.x, y: m.y, left: (m.dur ?? 0.8) - (m.t ?? 0), ax: P.x - m.x, ay: P.y - m.y };
    }
    const f = window.__fight;
    if (b.mode === 'fight') f.low = Math.min(f.low ?? b.maxHp, b.hp);
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
      blow: Math.round(f.low ?? b.hp),
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
      hitList: window.__fight.hits.slice(),
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
    let most = 0;
    while (Date.now() - t0 < 2600) {
      await wait(90);
      const st = await state(page);
      await page.mouse.move(Math.round(st.bx), Math.round(st.by));
      const k = await page.evaluate(() => window.__game.magic.holdOf?.(window.__game.player));
      most = Math.max(most, k?.k || 0);
      if (st.danger && st.danger.left < 0.5) break;
      if (k && (k.k >= 1 || k.capped) && Date.now() - t0 > 400) break;
    }
    await page.keyboard.up(key);
    return most;
  }
  // A phone: press the weave button, drag toward the boss (the aim follows the drag), hold, lift.
  const b = await weaveButton(page, slot);
  if (!b) return false;
  const id = 7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(b.x), y: Math.round(b.y), id }] });
  const t0 = Date.now();
  let last = { x: b.x, y: b.y };
  let most = 0;
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
    const k = await page.evaluate(() => window.__game.magic.holdOf?.(window.__game.player));
    most = Math.max(most, k?.k || 0);
    if (st.danger && st.danger.left < 0.5) break;
    if (k && (k.k >= 1 || k.capped) && Date.now() - t0 > 500) break;
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return most;
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
  // Away from the marker's middle (or from her, when standing on her own spot).
  let ax = s.danger?.ax ?? s.mx - s.bx;
  let ay = s.danger?.ay ?? s.my - s.by;
  if (Math.hypot(ax, ay) < 2) {
    ax = -s.dx;
    ay = -s.dy;
  }
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

async function fight(size, id = 'lakes_hum') {
  const tag = `${size.name}-${id === 'lakes_hum' ? 'lake' : 'mother'}`;
  const { context, page, errors, cdp } = await open(size);
  const info = await setupStranger(page, STRONG.weave);
  await toLake(page, id);
  await wait(900);
  await page.screenshot({ path: `${OUT}/${tag}-0-arena.png` });
  const shots = new Set();
  const t0 = Date.now();
  const budgetMs = LONG ? (size.throttle ? 900000 : 600000) : 45000;
  let charged = 0;
  let fullCharges = 0;
  let s = await state(page);
  while (Date.now() - t0 < budgetMs) {
    // The short check is about what the casts do, not about a scripted thumb's dodging (a poor
    // fighter): the stranger is kept on their feet, as stats_check's phone fight does.
    if (!LONG) await page.evaluate(() => {
      const P = window.__game.player;
      if (!P.downed && !P.dead) P.hp = Math.max(P.hp, P.maxHp * 0.6);
    });
    s = await state(page);
    if (s.won || s.down || s.mode !== 'fight') break;
    if (s.guard && !shots.has('guard')) {
      shots.add('guard');
      await page.screenshot({ path: `${OUT}/${tag}-guard.png` });
    }
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
      const k = await chargedCast(page, size, cdp, 1);
      charged++;
      if (k >= 0.999) fullCharges++;
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
  console.log(`  [${size.name}] ${info.name}: pool ${info.pool}, cost ${info.cost}; ${charged} charged casts, ${s.casts} casts in all, ${secs} s; her health ${s.bhp}/${s.bmax} (lowest ${s.blow}); guards ${s.guards}; you ${s.php}/${s.pmax}${s.won ? ' — she fell' : ''}${s.down ? ' — you fell' : ''}; mana paid ${JSON.stringify(s.costs)}`);
  if (!LONG) {
    const most = Math.max(0, ...(s.hitList || []));
    const cap = Math.ceil(s.bmax * 0.03);
    check(`[${size.name}] the fully charged casts of the strongest weave a level-7 pool fires do not burst ${id === 'lakes_hum' ? "the Lake's Hum" : 'the Mother of Slimes'}: she stands, no blow over 3% of her`, !s.won && charged >= 1 && most <= cap, `${charged} charged (${fullCharges} full), ${s.casts} casts, at her lowest ${s.blow}/${s.bmax}, the biggest blow ${most} (cap ${cap})`);
    const big = s.costs.filter((c) => c > s.full / 2.5 + 1);
    check(`[${size.name}] ${id}: a charge pays what it reached, a full one the full-charge cost`, big.length >= 1 && big.every((c) => c <= s.full + 1) && (!fullCharges || big.some((c) => Math.abs(c - s.full) <= Math.max(1, s.full * 0.04))), `paid ${JSON.stringify(big)}, full ${Math.round(s.full)}, ${fullCharges} full charges`);
  } else {
    check(`[${size.name}] the fight lasts minutes, not a burst`, s.won ? secs >= 180 : secs >= 60, `${secs} s, ${s.won ? 'won' : s.down ? 'fell' : 'unfinished'}, at her lowest ${s.blow}/${s.bmax}`);
  }
  check(`[${size.name}] no page errors in the fight`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// ------------------------------------------------------------------ the Spellbook's cost

async function book(size) {
  const tag = `${size.name}-book`;
  const { context, page, errors } = await open(size);
  const info = await setupStranger(page, STRONG.weave);
  // The strongest level-9 weave of Version 12 too, in slot 3 (the parts learned for real).
  const big = { shape: 'throw', essences: ['earth', 'iron'], twists: ['multishot', 'echo', 'big', 'volley'] };
  await page.evaluate((w) => {
    const g = window.__game;
    const m = g.magic;
    m.unlock('shape', w.shape, 'test');
    for (const e of w.essences) m.unlock('essence', e, 'test');
    for (const t of w.twists) m.unlock('twist', t, 'test');
    while (m.twistSlots < 4 && m.unlockTwistSlot()) {}
    m.setSlot(2, w);
  }, big);
  for (const slot of [1, 2]) {
    await page.evaluate((slot) => window.__game.ui.openSpellbook(slot), slot);
    await wait(700);
    const r = await page.evaluate((slot) => {
      const g = window.__game;
      const tile = document.querySelector('.sb-stat-mana');
      const plan = g.magic.slotPlan(slot);
      const q = tile?.getBoundingClientRect();
      const stand = document.querySelector('.sb-stand');
      return { stand: stand && !stand.hidden ? stand.textContent : '', text: tile?.querySelector('.sb-stat-value')?.textContent || '', title: tile?.getAttribute('title') || '', cost: g.magic.costOf(g.player, plan), full: g.magic.chargedCost(g.player, plan, 1), name: plan.name, visible: !!q && q.width > 0 && q.bottom <= innerHeight && q.right <= innerWidth, pool: g.magic.mana.max };
    }, slot);
    await page.screenshot({ path: `${OUT}/${tag}-slot${slot + 1}.png` });
    check(`[${size.name}] the Spellbook's Mana tile reads the true cost of ${r.name}`, r.text.trim() === String(Math.round(r.cost)) && r.visible, `tile "${r.text}" vs costOf ${r.cost}`);
    check(`[${size.name}] … and names what a full charge takes, in a line a phone shows`, r.title.includes(String(Math.round(r.full))) && r.stand.includes(`${Math.round(r.full)} mana`), `"${r.stand}" / "${r.title}" (full ${r.full}, pool ${r.pool})`);
    // Closable with a 44 px control.
    const closed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.panel .close, .panel [aria-label="Close"], .sb-close, .panel-close')].find((b) => b.offsetParent);
      const q = btn?.getBoundingClientRect();
      const big = q ? Math.min(q.width, q.height) >= 44 : false;
      btn?.click();
      return { big, had: !!btn };
    });
    await wait(300);
    check(`[${size.name}] the Spellbook closes with a 44 px control`, closed.had && closed.big, JSON.stringify(closed));
  }
  check(`[${size.name}] no page errors in the Spellbook`, errors.length === 0, errors.slice(0, 3).join(' | '));
  void info;
  await context.close();
}

// ------------------------------------------------------------------ the Unkindling's odds

async function soul(size) {
  const tag = `${size.name}-soul`;
  const { context, page, errors, cdp } = await open(size);
  const read = () =>
    page.evaluate(() => {
      const hint = document.querySelector('.unk-hint');
      const btn = document.querySelector('.unk-btn');
      // What a thumb can read: the tag over the dark hand, whole (not cut by an ellipsis) and
      // inside the screen.
      const tag = btn?.querySelector('.unk-btn-odds');
      const q = tag && !tag.hidden ? tag.getBoundingClientRect() : null;
      const whole = !!q && q.width > 0 && tag.scrollWidth <= tag.clientWidth + 1 && q.left >= 0 && q.right <= innerWidth && q.top >= 0;
      return {
        hint: hint && !hint.hidden ? hint.textContent.replace(/\s+/g, ' ').trim() : '',
        btn: btn && !btn.hidden ? (whole ? tag.textContent : '(odds not readable)') : '',
        label: btn?.getAttribute('aria-label') || '',
      };
    });
  // Level 15, a third each in Vitality, Might and Weave; the pact's gift; Rowan close enough to touch.
  const setup = (who, level, free) =>
    page.evaluate(
      ({ who, level, free }) => {
        const g = window.__game;
        const P = g.player;
        g.clock?.skipTo?.(11);
        P.level = level;
        for (const id of Object.keys(g.progression.points)) g.progression.points[id] = 0;
        if (free) {
          g.progression.startFree?.();
          for (const id of ['might', 'weave', 'vitality', 'resolve', 'focus']) g.progression.points[id] = 999;
        } else Object.assign(g.progression.points, { vitality: 14, might: 14, weave: 14 });
        g.progression.changed();
        g.stats.refresh(P);
        P.hp = P.maxHp;
        g.unkindle.learn('test');
        const c = g.ui?.coach;
        if (c) {
          c.done = new Proxy({}, { get: () => true });
          c.stop?.();
        }
        document.querySelectorAll('.toast').forEach((e) => e.remove());
        const L = g.companion;
        if (L) {
          L.update = () => {};
          L.x = 150 * 16;
          L.y = 112 * 16;
        }
        let e;
        if (who === 'varek') {
          e = g.bosses.get('varek');
          P.x = e.x - 20;
          P.y = e.y;
        } else {
          e = g.entities.get(who);
          for (const v of g.entities.all()) if (v.profile && v !== e && Math.hypot(v.x - 62 * 16, v.y - 14 * 16) < 200) v.x += 300;
          e.think = () => {};
          if (e.walker) e.walker.stop?.();
          P.x = 62 * 16 + 8;
          P.y = 14 * 16 + 8;
          e.x = P.x + 16;
          e.y = P.y;
        }
        P.faceToward?.(e.x, e.y);
        g.camera.follow?.(P);
        g.camera.snap?.();
        const o = g.unkindle.odds(e);
        return { odds: o, name: e.name };
      },
      { who, level, free },
    );
  const r = await setup('rowan', 15, false);
  await wait(900);
  let shown = await read();
  await page.screenshot({ path: `${OUT}/${tag}-rowan-odds.png` });
  const want = r.odds.chance > 0 ? `${r.odds.words}, ${r.odds.percent}%` : r.odds.words;
  const seen = size.phone ? shown.btn : shown.hint;
  check(`[${size.name}] before you start, the hint names the odds for Rowan at level 15 (${want}), readable whole`, seen.includes(want) && r.odds.chance > 0 && r.odds.chance < 0.85, `"${seen}" / "${shown.label}"`);
  // Hold it: the key, or the dark hand.
  const t0 = Date.now();
  if (!size.phone) await page.keyboard.down('KeyF');
  else {
    const b = await page.evaluate(() => {
      const q = document.querySelector('.unk-btn:not([hidden])')?.getBoundingClientRect();
      return q ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
    });
    if (b) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(b.x), y: Math.round(b.y), id: 4 }] });
  }
  let mid = false;
  while (Date.now() - t0 < (size.throttle ? 14000 : 9000)) {
    await wait(250);
    const ch = await page.evaluate(() => window.__game.unkindle.channel?.phase || null);
    if (ch === 'pull' && !mid && Date.now() - t0 > 1200) {
      mid = true;
      await page.screenshot({ path: `${OUT}/${tag}-rowan-pull.png` });
    }
    if (!ch && Date.now() - t0 > 600) break;
  }
  if (!size.phone) await page.keyboard.up('KeyF');
  else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(500);
  const out = await page.evaluate(() => {
    const g = window.__game;
    const a = g.unkindle.attempts.at(-1);
    return { dead: !!g.murder?.dead?.rowan || !!g.entities.get('rowan')?.dead, attempt: a ? { outcome: a.outcome, knows: a.knows } : null, tally: g.unkindle.tally };
  });
  await page.screenshot({ path: `${OUT}/${tag}-rowan-end.png` });
  check(`[${size.name}] the hold plays out as the odds said: taken, or he breaks free and knows`, out.dead ? out.tally === 1 : out.attempt?.outcome === 'resisted' && out.attempt.knows === true, JSON.stringify(out));
  // A boss: too strong, whatever the build (Free 999).
  const v = await setup('varek', 15, true);
  await wait(600);
  // He comes at you (the fight starts as you walk in, and a blow throws you back out of
  // touch): step back to his side and read the hint as soon as it is painted.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const b = g.bosses.get('varek');
      const P = g.player;
      P.x = b.x - 18;
      P.y = b.y;
      P.hp = P.maxHp;
      P.faceToward?.(b.x, b.y);
    });
    await wait(260);
    shown = await read();
    if (shown.hint || shown.btn) break;
  }
  await page.screenshot({ path: `${OUT}/${tag}-varek-odds.png` });
  const vs = size.phone ? shown.btn : shown.hint;
  check(`[${size.name}] at Free 999, Varek reads too strong`, v.odds.chance === 0 && vs.includes('too strong'), `"${vs}" ${JSON.stringify(v.odds)}`);
  check(`[${size.name}] no page errors with the Unkindling`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

for (const size of SIZES) {
  if (ONLY.includes('fight')) {
    await fight(size, 'lakes_hum');
    await fight(size, 'mother_of_slimes');
  }
  if (ONLY.includes('book')) await book(size);
  if (ONLY.includes('soul')) await soul(size);
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
