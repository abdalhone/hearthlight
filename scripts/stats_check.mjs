// Round 14b stats check (the author: "when I put a lot of points of speed, I can like
// literally be so fast that it's unplayable"; then "40% should always give 40%, no matter
// what … if I put 10, it's really a benefit"). Played in the built game on a phone held
// sideways (844x390, at a 4x CPU throttle) and upright (390x844) with the touch stick and
// the buttons, and on a computer (1280x720) with keys:
//
//   1. a fixed straight on the lane south of your home, walked at 0, 20, 50, 70, 180, 200
//      and 999 Grace points: the speed each walks at (in game seconds, so a slow phone reads
//      the same), and 180→200 adding less than 50→70;
//   2. 999 Grace with everything that hastes you (the fastest boots and cloak, a Swiftfoot
//      Draught, a wind surge, Berserk, the Last Stand, Oath with Lyra beside you): every
//      share whole (Berserk adds its +30.4 px/s, 40% of the plain walk of 76, on top of
//      everything else), the top speed (~227 px/s); then a loop of the village lanes, in
//      through your door and out again, into the stream east of the lane, and three rolls
//      (one straight into the house wall), every game step checked: never inside a wall, a
//      shut door or the water, never more than a few pixels a step; Lyra keeps up or
//      catches up;
//   3. the Character sheet with Free stat points on: Grace's +10 pressed again and again,
//      the "Next:" line shrinking (and Might's staying a good share), the controls at least
//      44 px, nothing spilling sideways;
//   4. Varek at level 15 with 30 points in Might (and 12 in Vitality), fought by hand on the
//      computer: walk in, swing, roll out of his telegraphed blows, until he yields; on the
//      phones, the sword button tapped at his side, each cut what the sheet says (the same
//      fight headless, by level and points, old and new: scripts/stats_sim.mjs).
//
//   node scripts/stats_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';
import { PRICES, LAST_STAND_GAIN } from '../src/magic/prices.js';
import { BUFF_ITEMS } from '../src/gear/gear_data.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/stats_check';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true, throttle: 4 },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
].filter((s) => !ONLY || ONLY.includes(s.tag));
const POINTS = [0, 20, 50, 70, 180, 200, 999];
const T = 16;
const at = (tx, ty) => ({ x: tx * T + T / 2, y: ty * T + T / 2 });
// The lane south of your home (row 84 is open from x 66 to 126), the lane west of it
// (x 82, rows 72–84), the open row above the houses (72), the lane east of it (x 104) and
// your own door (96, 82).
const STRAIGHT = { from: at(70, 84), dir: { x: 1, y: 0 } };
const LOOP = [at(82, 84), at(82, 72), at(104, 72), at(104, 84), at(96, 84), at(96, 79), at(96, 84), at(88, 84)];
// The stream east of the lane (water from row 86 down, x 127–132): approached head on (it
// stops you at the bank) and on a slant (you slide along the bank), at the top speed.
const STREAM = [
  { from: at(118, 92), dir: { x: 1, y: 0 } },
  { from: at(120, 88), dir: { x: 0.8, y: 0.6 } },
];
const BUFFS = { swift: BUFF_ITEMS.swiftfoot_draught.buff, berserk: PRICES.berserk.gain, laststand: LAST_STAND_GAIN };

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
const report = {};
let checks = 0;
const check = (ok, label, info = '') => {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${info}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

async function run(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const errors = [];
  let phase = 'start';
  page.on('pageerror', (e) => errors.push(`[${phase}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`[${phase}] console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const cdp = await ctx.newCDPSession(page);
  if (S.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const out = (report[tag] = { speeds: {}, notes: [] });

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 90000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 90000 });
  await wait(800);
  await ev(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.clock.skipTo?.(12);
    const u = g.ui;
    for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
    u?.coach?.stop?.();
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        g.ui?.chat?.close?.();
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    // Every game step: where the stranger is, whether that spot is inside a wall or a
    // shut door, how far one step went, how far Lyra is.
    const P = g.player;
    const sc = (window.__sc = { rec: false, steps: 0, blocked: 0, blockedAt: null, maxStep: 0, lyraMax: 0, lyraLast: 0, minY: Infinity, rolls: 0 });
    let lx = P.x;
    let ly = P.y;
    const orig = g.stats.update.bind(g.stats);
    g.stats.update = (dt) => {
      orig(dt);
      if (sc.rec) {
        const d = Math.hypot(P.x - lx, P.y - ly);
        sc.steps++;
        if (d > sc.maxStep) sc.maxStep = d;
        if (g.entities.blockedAt(P, P.x, P.y) || g.map.isWater(Math.floor(P.x / 16), Math.floor(P.y / 16))) {
          sc.blocked++;
          sc.blockedAt = sc.blockedAt || { x: Math.round(P.x), y: Math.round(P.y), tx: Math.floor(P.x / 16), ty: Math.floor(P.y / 16) };
        }
        if (P.y < sc.minY) sc.minY = P.y;
        if (sc.glue && g.companion) {
          g.companion.x = P.x - 14;
          g.companion.y = P.y;
        }
        const L = g.companion;
        if (L && !L.removed) {
          sc.lyraLast = Math.hypot(L.x - P.x, L.y - P.y);
          if (sc.lyraLast > sc.lyraMax) sc.lyraMax = sc.lyraLast;
        }
      }
      lx = P.x;
      ly = P.y;
    };
    window.__put = (x, y) => {
      P.x = x;
      P.y = y;
      P.vel.x = 0;
      P.vel.y = 0;
      lx = x;
      ly = y;
      g.camera?.snap?.(P);
    };
    g.progression.startFree();
    window.__clean();
  });

  // ------------------------------------------------------------------ input: keys or stick
  const keysDown = new Set();
  const setKeys = async (want) => {
    for (const k of [...keysDown]) if (!want.has(k)) {
      await page.keyboard.up(k);
      keysDown.delete(k);
    }
    for (const k of want) if (!keysDown.has(k)) {
      await page.keyboard.down(k);
      keysDown.add(k);
    }
  };
  let stickOn = false;
  let stickBase = null;
  let stickAt = null; // where the thumb is now (a roll keeps it there)
  const stickHome = { x: Math.round(S.w * 0.2), y: Math.round(S.h * 0.74) };
  const stick = async (dx, dy) => {
    if (!stickOn) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stickHome.x, y: stickHome.y, id: 1 }] });
      stickOn = true;
      await wait(30);
      stickBase = await ev(() => ({ ...window.__game.ui.touch.base }));
    }
    // A thumb at the rim (touch.js RADIUS 52): full speed, and the base stays put.
    const R = 51.9;
    stickAt = { x: stickBase.x + dx * R, y: stickBase.y + dy * R };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stickAt.x, y: stickAt.y, id: 1 }] });
  };
  const stickUp = async () => {
    if (!stickOn) return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    stickOn = false;
  };
  // Hold a direction (a unit vector): keys on a computer, the stick on a phone.
  const hold = async (dx, dy) => {
    if (S.phone) return stick(dx, dy);
    const want = new Set();
    if (dx > 0.38) want.add('KeyD');
    if (dx < -0.38) want.add('KeyA');
    if (dy > 0.38) want.add('KeyS');
    if (dy < -0.38) want.add('KeyW');
    return setKeys(want);
  };
  const release = async () => {
    if (S.phone) await stickUp();
    else await setKeys(new Set());
  };
  const roll = async () => {
    // A thumb waits for the roll to come back before pressing again.
    await page.waitForFunction(() => !(window.__game.player.dodgeCd > 0) && !window.__game.player.rolling, null, { timeout: 4000, polling: 30 }).catch(() => {});
    if (S.phone) {
      const r = await ev(() => {
        const b = document.querySelector('.tbtn-dodge');
        const q = b?.getBoundingClientRect();
        return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
      });
      if (!r) return false;
      // The stick thumb lifts for the roll (the roll goes the way you face) and comes back.
      const was = stickOn && stickAt ? { x: (stickAt.x - stickBase.x) / 51.9, y: (stickAt.y - stickBase.y) / 51.9 } : null;
      await stickUp();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(r.x), y: Math.round(r.y), id: 2 }] });
      await wait(S.throttle ? 150 : 60); // long enough for a slow phone's frame to see it
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const went = await rolledNow();
      if (was) await stick(was.x, was.y);
      return went;
    }
    await page.keyboard.down('ShiftLeft');
    await wait(60);
    await page.keyboard.up('ShiftLeft');
    return rolledNow();
  };
  // Did that press start a roll (it is rolling, or its cooldown has just begun)?
  const rolledNow = () => ev(() => !!window.__game.player.rolling || window.__game.player.dodgeCd > 0);
  const simT = () => ev(() => window.__game.stats.t);
  const waitSim = (sec) => page.waitForFunction((t) => window.__game.stats.t >= t, sec, { timeout: 30000, polling: 30 });
  const pos = () => ev(() => {
    const P = window.__game.player;
    return { x: P.x, y: P.y, t: window.__game.stats.t, speed: P.speed, v: Math.hypot(P.vel.x, P.vel.y) };
  });

  // Steer to a point as a thumb or a hand on the keys would: aim at it, let go a body's
  // stopping distance before a corner (player.js decelerates at 1100 px/s²), ease the
  // stick in the last few pixels (keys cannot), stop when there.
  const goTo = async (p, { tol = 5, timeout = 12 } = {}) => {
    const t0 = (await pos()).t;
    const trail = [];
    for (;;) {
      const q = await pos();
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (d <= tol) return true;
      if (q.v > 40 && d < (q.v * q.v) / (2 * 1100) + 3) {
        await release();
        await wait(16);
        continue;
      }
      trail.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
      if (q.t - t0 > timeout) {
        out.notes.push(`stuck going to ${p.x},${p.y}: ${trail.slice(-6).join(' ')}`);
        return false;
      }
      let ux = dx / d;
      let uy = dy / d;
      if (!S.phone) {
        // Keys: one axis at a time once the other is close, so a door is met square.
        if (Math.abs(dx) < 3) ux = 0;
        if (Math.abs(dy) < 3) uy = 0;
      } else if (d < 24) {
        ux *= 0.55;
        uy *= 0.55;
      }
      await hold(ux, uy);
      await wait(16);
    }
  };

  phase = 'straight';
  // ------------------------------------------------------------------ 1. the straight
  for (const n of POINTS) {
    await release();
    await ev(({ n, from }) => {
      const g = window.__game;
      g.progression.points.grace = n;
      g.progression.changed();
      window.__put(from.x, from.y);
    }, { n, from: STRAIGHT.from });
    await wait(150);
    await hold(STRAIGHT.dir.x, STRAIGHT.dir.y);
    const t0 = await simT();
    await waitSim(t0 + 0.9);
    const a = await pos();
    await waitSim(t0 + 2.1);
    const b = await pos();
    await release();
    const v = (b.x - a.x) / (b.t - a.t);
    out.speeds[n] = Math.round(v * 10) / 10;
    check(Math.abs(v - b.speed) / b.speed < 0.04, `${tag}: ${n} Grace walks at ${v.toFixed(1)} px/s (the pipeline says ${b.speed.toFixed(1)})`, Number.isFinite(v) ? '' : JSON.stringify({ a, b }));
    if (n === 999) await shot('1-straight-999');
  }
  const sp = out.speeds;
  check(sp[70] - sp[50] > 3 * (sp[200] - sp[180]), `${tag}: 50→70 adds ${(sp[70] - sp[50]).toFixed(1)} px/s, 180→200 adds ${(sp[200] - sp[180]).toFixed(1)}`);
  check(sp[999] < 132, `${tag}: 999 Grace alone ${sp[999]} px/s, under the roll and about Lyra's run`);

  phase = 'stacked';
  // ------------------------------------------------------------------ 2. everything stacked
  await ev((B) => {
    const g = window.__game;
    const P = g.player;
    const S = g.stats;
    g.progression.points.grace = 999;
    g.progression.changed();
    for (const id of ['roadrunner_boots', 'murrel_cloak']) {
      P.inventory.add(id, 1);
      g.gear.equip(id);
    }
    S.addModifier(P, { id: 'swiftfoot', source: 'swiftfoot', ...B.swift, t: 600 });
    S.addModifier(P, { id: 'surge', source: 'surge', label: 'Surge: swiftness', kind: 'buff', pct: { speed: 0.18 }, add: { dodge: 0.05 }, t: 600 });
    S.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', kind: 'gain', ...B.laststand, label: 'Last Stand: burning', t: 600 });
    g.prices.state.oath = { t: 600 };
    const L = g.companion;
    if (L) {
      L.x = P.x - 14;
      L.y = P.y;
    }
    S.refresh(P);
    // Berserk last: what it adds on top of everything else, and alone at 0 and 50 Grace.
    const shares = {};
    const before = P.speed;
    S.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', kind: 'gain', ...B.berserk, t: 600 });
    S.refresh(P);
    shares.stacked = P.speed - before;
    let pct = 0;
    for (const b of S.breakdown(P, 'speed')) pct += b.pct;
    shares.plain = 76 * (1 + pct);
    shares.top = P.speed;
    window.__berserkAlone = (n) => {
      const was = g.progression.points.grace;
      const mods = ['swiftfoot', 'surge', 'price:laststand:gain', 'price:berserk:gain'].map((id) => S.modifiers(P).find((m) => m.id === id)).filter(Boolean);
      for (const m of mods) S.removeModifier(P, m.id);
      const oath = g.prices.state.oath;
      g.prices.state.oath = null;
      const gear = { ...g.gear.equipped };
      for (const slot of Object.keys(gear)) if (gear[slot]) g.gear.unequip?.(slot);
      g.progression.points.grace = n;
      g.progression.changed();
      S.refresh(P);
      const v0 = P.speed;
      S.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', kind: 'gain', ...B.berserk, t: 600 });
      S.refresh(P);
      const add = P.speed - v0;
      S.removeModifier(P, 'price:berserk:gain');
      for (const slot of Object.keys(gear)) if (gear[slot]) g.gear.equip(gear[slot], slot);
      for (const m of mods) S.addModifier(P, m);
      g.prices.state.oath = oath;
      g.progression.points.grace = was;
      g.progression.changed();
      S.refresh(P);
      return add;
    };
    shares.at0 = window.__berserkAlone(0);
    shares.at50 = window.__berserkAlone(50);
    shares.back = P.speed;
    window.__shares = shares;
  }, BUFFS);
  const shares = await ev(() => window.__shares);
  out.berserk = { stacked: Math.round(shares.stacked * 100) / 100, at0: Math.round(shares.at0 * 100) / 100, at50: Math.round(shares.at50 * 100) / 100 };
  check([shares.stacked, shares.at0, shares.at50].every((v) => Math.abs(v - 30.4) < 0.01), `${tag}: Berserk adds +30.4 px/s (40% of 76) at 0 Grace, 50 Grace and 999 Grace with everything stacked`, JSON.stringify(out.berserk));
  check(Math.abs(shares.top - shares.plain) < 1e-6 && Math.abs(shares.back - shares.top) < 1e-6, `${tag}: the stacked pace is the plain sum of its shares (${shares.top.toFixed(1)} px/s)`);
  // Oath holds only while she is near: for this straight she is kept at your shoulder
  // (her own legs come in the lap below).
  await ev((from) => {
    window.__put(from.x, from.y);
    Object.assign(window.__sc, { rec: true, glue: true });
  }, STRAIGHT.from);
  await wait(200);
  const sources = await ev(() => window.__game.stats.breakdown(window.__game.player, 'speed').map((b) => b.source));
  check(['gear', 'swiftfoot', 'surge', 'price:berserk', 'price:laststand', 'price:oath'].every((s) => sources.includes(s)) && !sources.includes('ceiling'), `${tag}: every haste is on, nothing held back (${sources.join(', ')})`);
  await hold(1, 0);
  {
    const t0 = await simT();
    await waitSim(t0 + 0.9);
    const a = await pos();
    await waitSim(t0 + 2.1);
    const b = await pos();
    await release();
    await ev(() => Object.assign(window.__sc, { rec: false, glue: false }));
    const v = (b.x - a.x) / (b.t - a.t);
    out.stacked = Math.round(v * 10) / 10;
    check(Math.abs(v - b.speed) / b.speed < 0.04 && v > 210 && v < 260, `${tag}: everything stacked walks at ${v.toFixed(1)} px/s (the pipeline says ${b.speed.toFixed(1)}; safety clamp 260)`);
    await shot('2-stacked-straight');
  }

  phase = 'lap';
  // The lane loop, in through your door and out, every step watched.
  await ev((p) => {
    window.__put(p.x, p.y);
    const L = window.__game.companion;
    if (L) {
      L.x = p.x - 14;
      L.y = p.y;
    }
    Object.assign(window.__sc, { rec: true, steps: 0, blocked: 0, blockedAt: null, maxStep: 0, lyraMax: 0, minY: Infinity });
  }, at(88, 84));
  const lapT0 = await simT();
  let reached = 0;
  for (const [i, wp] of LOOP.entries()) {
    // Below your door, line up and stop before going in (at ~227 px/s a body needs 23 px to
    // stop, as a thumb or a hand does).
    let ok = await goTo(wp);
    if (i === 4) {
      await release();
      await page.waitForFunction(() => Math.hypot(window.__game.player.vel.x, window.__game.player.vel.y) < 5, null, { timeout: 5000, polling: 30 }).catch(() => {});
      ok = (await goTo(wp, { tol: 4 })) && ok;
      await release();
      await page.waitForFunction(() => Math.hypot(window.__game.player.vel.x, window.__game.player.vel.y) < 5, null, { timeout: 5000, polling: 30 }).catch(() => {});
    }
    if (ok) reached++;
    else out.notes.push(`waypoint ${i} (${Math.floor(wp.x / T)},${Math.floor(wp.y / T)}) not reached`);
    if (i === 5) await shot('3-stacked-in-the-door');
    if (i === 2) await shot('3-stacked-lane');
  }
  await release();
  const lapT = (await simT()) - lapT0;
  const lap = await ev(() => ({ ...window.__sc }));
  out.lap = { seconds: Math.round(lapT * 10) / 10, reached, steps: lap.steps, maxStep: Math.round(lap.maxStep * 10) / 10, lyraMax: Math.round(lap.lyraMax / T) };
  check(reached === LOOP.length, `${tag}: steered the lanes and the door at the top speed (${reached}/${LOOP.length} points, ${out.lap.seconds} s)`);
  check(lap.minY < 81 * T, `${tag}: went in through the door (reached row ${Math.floor(lap.minY / T)})`);
  check(lap.blocked === 0, `${tag}: never inside a wall or a shut door`, lap.blockedAt ? JSON.stringify(lap.blockedAt) : '');
  check(lap.maxStep < 6, `${tag}: at most ${lap.maxStep.toFixed(1)} px a game step (a tile is 16)`);

  phase = 'stream';
  // The stream: straight at it and on a slant, then a roll into it, at the top speed.
  await ev(() => Object.assign(window.__sc, { steps: 0, blocked: 0, blockedAt: null, maxStep: 0, maxX: 0 }));
  const bank = [];
  for (const [i, run] of STREAM.entries()) {
    await release();
    await ev((p) => window.__put(p.x, p.y), run.from);
    await wait(120);
    await hold(run.dir.x, run.dir.y);
    const t0 = await simT();
    await waitSim(t0 + 1.2);
    if (i === 1) {
      await roll();
      await waitSim(t0 + 1.8);
      await shot('3-stacked-stream');
    }
    const q = await ev(() => {
      const P = window.__game.player;
      return { x: P.x, y: P.y, tx: Math.floor(P.x / 16), ty: Math.floor(P.y / 16), wet: window.__game.map.isWater(Math.floor(P.x / 16), Math.floor(P.y / 16)) };
    });
    bank.push(q);
  }
  await release();
  const st = await ev(() => ({ ...window.__sc }));
  out.stream = bank.map((q) => `${q.tx},${q.ty}`);
  check(st.blocked === 0 && bank.every((q) => !q.wet) && bank[0].tx <= 126 && bank[0].tx >= 124, `${tag}: the stream stops you at its bank at the top speed, head on, and you slide along it on a slant and rolling, never in the water (${out.stream.join(' ')})`, st.blockedAt ? JSON.stringify(st.blockedAt) : '');
  check(st.maxStep < 6, `${tag}: at most ${st.maxStep.toFixed(1)} px a game step at the stream`);

  phase = 'rolls';
  // Rolls: along the lane, then straight into your house's wall (any toast the stream
  // raised cleared first, so the thumb lands on the stick).
  await ev((p) => {
    window.__clean();
    window.__put(p.x, p.y);
  }, at(84, 84));
  await wait(150);
  await hold(1, 0);
  await wait(250);
  let rolled = 0;
  for (let i = 0; i < 2; i++) {
    if (await roll()) rolled++;
    await wait(500);
  }
  await release();
  phase = 'rolls-wall';
  await ev((p) => window.__put(p.x, p.y), at(94, 84));
  await wait(150);
  await hold(0, -1);
  await wait(60);
  await roll();
  await wait(500);
  await shot('4-stacked-roll-wall');
  await release();
  const afterRolls = await ev(() => ({ ...window.__sc, y: window.__game.player.y }));
  check(rolled >= 1, `${tag}: rolled at the top speed (${rolled}/2 rolls seen)`);
  check(afterRolls.blocked === 0 && afterRolls.y > 82 * T, `${tag}: a roll into the wall stops at it (y ${Math.round(afterRolls.y)}, wall at ${82 * T + T})`, afterRolls.blockedAt ? JSON.stringify(afterRolls.blockedAt) : '');

  phase = 'lyra';
  // Lyra: stop, and she is back beside you (her run, or her catch-up).
  const lyra = await ev(() => {
    const L = window.__game.companion;
    return L ? { mode: L.behavior?.mode || L.mode || null, holder: window.__game.party?.holderId || null } : null;
  });
  if (lyra?.holder === 'lyra') {
    const t0 = await simT();
    await page.waitForFunction(() => window.__sc.lyraLast < 5 * 16 || false, null, { timeout: 25000, polling: 100 }).catch(() => {});
    const t1 = await simT();
    const lastD = await ev(() => window.__sc.lyraLast);
    out.lyra = { maxTiles: out.lap.lyraMax, backInSeconds: Math.round((t1 - t0) * 10) / 10, lastTiles: Math.round(lastD / T) };
    check(lastD < 5 * T, `${tag}: Lyra was at most ${out.lap.lyraMax} tiles behind and is back beside you in ${out.lyra.backInSeconds} s`);
  } else out.notes.push(`Lyra does not hold the role here (${JSON.stringify(lyra)})`);
  await ev(() => {
    window.__sc.rec = false;
  });

  phase = 'sheet';
  // ------------------------------------------------------------------ 3. the sheet, +10 by hand
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    for (const id of ['swiftfoot', 'surge', 'price:berserk:gain', 'price:laststand:gain']) g.stats.removeModifier(P, id);
    g.prices.state.oath = null;
    g.progression.points.grace = 0;
    g.progression.changed();
    window.__clean();
  });
  await wait(300);
  if (S.phone) {
    const r = await ev(() => {
      const q = document.querySelector('.player-card')?.getBoundingClientRect();
      return q ? { x: q.left + Math.min(30, q.width / 2), y: q.top + q.height / 2 } : null;
    });
    if (r) await page.touchscreen.tap(r.x, r.y);
  } else await page.keyboard.press('KeyC');
  await wait(500);
  const open = await ev(() => !!window.__game.ui.character?.isOpen?.());
  check(open, `${tag}: the Character sheet opens (${S.phone ? 'a tap on your card' : 'C'})`);
  const tenSel = '.chs-attr:nth-child(5) .chs-ten';
  const nexts = [];
  const readRow = () =>
    ev(() => {
      const rows = [...document.querySelectorAll('.chs-attr')];
      const row = rows.find((r) => r.querySelector('.chs-attr-name')?.textContent === 'Grace');
      return { n: Number(row?.querySelector('.chs-attr-n')?.textContent), next: row?.querySelector('.chs-next-text')?.textContent || '', meter: row?.querySelector('.chs-next-meter i')?.style.width || '' };
    });
  nexts.push(await readRow());
  await ev((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), tenSel);
  await wait(200);
  await shot('5-sheet-free-0');
  for (let i = 0; i < 8; i++) {
    const r = await ev((sel) => {
      const q = document.querySelector(sel)?.getBoundingClientRect();
      return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width, h: q.height } : null;
    }, tenSel);
    if (!r) break;
    if (S.phone) await page.touchscreen.tap(r.x, r.y);
    else await page.mouse.click(r.x, r.y);
    await wait(S.throttle ? 220 : 120);
    nexts.push(await readRow());
    if (i === 4) await shot('5-sheet-free-50');
  }
  await shot('5-sheet-free-80');
  out.sheet = nexts.map((x) => `${x.n}: ${x.next} [${x.meter}]`);
  check(nexts[nexts.length - 1].n === 80, `${tag}: eight presses of +10 on Grace give 80 points`, `(${nexts.map((x) => x.n).join(', ')})`);
  const gains = nexts.map((x) => Number((x.next.match(/([0-9.]+)%/) || [])[1]));
  check(gains.every((gv, i) => i === 0 || gv <= gains[i - 1]) && gains[0] > gains[gains.length - 1], `${tag}: "Next" shrinks as the points grow`, nexts.map((x) => x.next.replace('Next: ', '')).join(' → '));
  // And it is true: one more point really moves the walk by what the line says (a share of
  // the pace you have now, read from the pipeline with one point more).
  const truth = await ev(() => {
    const g = window.__game;
    const P = g.player;
    const pr = g.progression;
    const before = g.stats.all(P).speed;
    pr.points.grace += 1;
    g.stats.touch();
    const after = g.stats.all(P).speed;
    pr.points.grace -= 1;
    g.stats.touch();
    return ((after - before) / before) * 100;
  });
  const said = gains[gains.length - 1];
  check(Math.abs(said - truth) <= 0.051, `${tag}: at 80 Grace "${nexts[nexts.length - 1].next}" is what one more point does (${truth.toFixed(3)}% of the walk now)`);
  phase = 'might';
  // Might the same way: its next point keeps a good share (strength keeps growing), where
  // Grace's speed has bent hard.
  const mightTen = '.chs-attr:nth-child(2) .chs-ten';
  const readMight = () =>
    ev(() => {
      const row = [...document.querySelectorAll('.chs-attr')].find((r) => r.querySelector('.chs-attr-name')?.textContent === 'Might');
      return { n: Number(row?.querySelector('.chs-attr-n')?.textContent), next: row?.querySelector('.chs-next-text')?.textContent || '', meter: parseFloat(row?.querySelector('.chs-next-meter i')?.style.width || '0') };
    });
  const might0 = await readMight();
  for (let i = 0; i < 8; i++) {
    const r = await ev((sel) => {
      const el = document.querySelector(sel);
      el?.scrollIntoView({ block: 'center' });
      const q = el?.getBoundingClientRect();
      return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
    }, mightTen);
    if (!r) break;
    if (S.phone) await page.touchscreen.tap(r.x, r.y);
    else await page.mouse.click(r.x, r.y);
    await wait(S.throttle ? 220 : 120);
  }
  const might80 = await readMight();
  await shot('5-sheet-free-might-80');
  out.might = [`0: ${might0.next} [${might0.meter}%]`, `${might80.n}: ${might80.next} [${might80.meter}%]`];
  const graceMeter = parseFloat(nexts[nexts.length - 1].meter);
  check(might80.n === 80 && might80.meter >= 60 && graceMeter <= 20, `${tag}: at 80 points Might's next point still carries ${might80.meter}% of the first ("${might80.next}"), Grace's speed ${graceMeter}%`);
  const curveNote = await ev(() => document.querySelector('.chs-curve-note')?.textContent || '');
  check(/keep growing/.test(curveNote), `${tag}: the sheet says how points add up ("${curveNote}")`);
  // Controls on the sheet: at least 44 px, nothing spilling sideways, the next line on screen.
  const lay = await ev(() => {
    const small = [];
    for (const b of document.querySelectorAll('.panel-character button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || b.hidden || getComputedStyle(b).display === 'none') continue;
      if (r.width < 43.5 || r.height < 43.5) small.push(`${b.className.split(' ').slice(-1)[0] || b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const body = document.querySelector('.panel-character .panel-body');
    const lines = [...document.querySelectorAll('.chs-attr-next')].map((e) => {
      const r = e.getBoundingClientRect();
      return { h: Math.round(r.height), right: Math.round(r.right) };
    });
    const panel = document.querySelector('.panel-character')?.getBoundingClientRect();
    return { small, over: (body?.scrollWidth || 0) - (body?.clientWidth || 0), pageOver: document.documentElement.scrollWidth - window.innerWidth, lines, panelRight: panel ? Math.round(panel.right) : 0, vw: window.innerWidth };
  });
  check(lay.small.length === 0, `${tag}: every control on the sheet is at least 44 px`, lay.small.join(', '));
  check(lay.over <= 1 && lay.pageOver <= 0, `${tag}: nothing spills sideways on the sheet (${lay.over}, ${lay.pageOver})`);
  check(lay.lines.every((l) => l.right <= lay.panelRight && l.h <= 32), `${tag}: every "Next" line fits its row (${lay.lines.map((l) => l.h).join('/')} px high)`);
  // Turning Free stat points off gives back the real points (none here).
  await ev(() => window.__game.ui.character.close());
  const back = await ev(() => {
    const g = window.__game;
    g.progression.endFree();
    return { free: g.progression.free, spent: g.progression.spent(), speed: g.player.speed };
  });
  check(!back.free && back.spent === 0, `${tag}: Free stat points off puts back the real points (${back.spent} spent, ${back.speed.toFixed(1)} px/s)`);

  phase = 'varek';
  // ------------------------------------------------------------------ 4. Varek, by hand
  // Level 15 with the gear a stranger has by then; Lyra kept at home so the numbers are
  // yours. Walk in, swing (hold the sword: J, or the sword button), roll out of a marker
  // about to land (Shift, or the roll button), until he yields.
  await release();
  // The sword: J held on a computer; on a phone a tap of the sword button (its own touch).
  const pressAttack = async (on) => {
    if (S.phone) {
      if (!on) return;
      const r = await ev(() => {
        const q = document.querySelector('.tbtn-attack')?.getBoundingClientRect();
        return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
      });
      if (!r) return;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(r.x), y: Math.round(r.y), id: 5 }] });
      await wait(S.throttle ? 120 : 40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (on) await page.keyboard.down('KeyJ');
    else await page.keyboard.up('KeyJ');
  };
  const fightVarek = async (might) => {
    await ev((might) => {
      const g = window.__game;
      const P = g.player;
      window.__clean();
      P.level = 15;
      for (const id of Object.keys(g.progression.points)) g.progression.points[id] = 0;
      g.progression.points.might = might;
      g.progression.points.vitality = 42 - might;
      g.progression.changed();
      for (const id of ['steel_sword', 'iron_mail', 'traveler_cloak']) {
        if (!Object.values(g.gear.equipped).includes(id)) {
          P.inventory.add(id, 1);
          g.gear.equip(id);
        }
      }
      g.stats.refresh(P);
      P.hp = P.maxHp;
      const L = g.companion;
      if (L) {
        L._keptUpdate = true;
        L.update = () => {};
        L.x = 96 * 16;
        L.y = 84 * 16;
      }
      const b = g.bosses.get('varek');
      const a = g.bosses.arenas.varek;
      if (b.hp < b.maxHp) b.hp = b.maxHp;
      window.__put(b.x - 70, b.y + 10);
      g.bosses.startFight('varek');
      const f = (window.__fight = { t0: g.stats.t, won: false, hp0: P.maxHp, low: P.maxHp, atk: g.stats.get(P, 'atk') });
      if (!window.__fightHook) {
        window.__fightHook = true;
        g.bus.on('boss_defeated', () => {
          window.__fight.won = true;
          window.__fight.t1 = g.stats.t;
        });
      }
      // What the bot reads: where Varek is, and whether a marker about to land covers you.
      window.__fightState = () => {
        const b2 = g.bosses.get('varek');
        let danger = null;
        for (const m of b2.markers || []) {
          const r = 5 * 0.6;
          let inside = false;
          if (m.kind === 'circle') inside = Math.hypot(P.x - m.x, P.y - m.y) <= m.r + r;
          else if (m.kind === 'ring') inside = Math.abs(Math.hypot(P.x - m.x, P.y - m.y) - (m.r || 0)) < 24;
          else if (m.kind === 'line') {
            const x1 = m.x + Math.cos(m.angle) * m.len;
            const y1 = m.y + Math.sin(m.angle) * m.len;
            const dx = x1 - m.x;
            const dy = y1 - m.y;
            const l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((P.x - m.x) * dx + (P.y - m.y) * dy) / l2));
            inside = Math.hypot(P.x - (m.x + dx * t), P.y - (m.y + dy * t)) <= m.w / 2 + r;
          } else if (m.kind === 'cone') {
            const d = Math.hypot(P.x - m.x, P.y - m.y);
            let da = Math.atan2(P.y - m.y, P.x - m.x) - m.angle;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            inside = d <= m.range + r && (d < 6 || Math.abs(da) <= m.arc / 2 + 0.2);
          }
          if (!inside) continue;
          const left = (m.dur ?? 0.8) - (m.t ?? 0);
          let ax = P.x - m.x;
          let ay = P.y - m.y;
          if (m.kind === 'line' || m.kind === 'cone') {
            const sx = -Math.sin(m.angle);
            const sy = Math.cos(m.angle);
            const side = (P.x - m.x) * sx + (P.y - m.y) * sy >= 0 ? 1 : -1;
            ax = sx * side;
            ay = sy * side;
          }
          const l = Math.hypot(ax, ay) || 1;
          if (!danger || left < danger.left) danger = { left, x: ax / l, y: ay / l };
        }
        window.__fight.low = Math.min(window.__fight.low, P.hp);
        return { t: g.stats.t, px: P.x, py: P.y, bx: b2.x, by: b2.y, mode: b2.mode, hp: Math.round(b2.hp), php: Math.round(P.hp), down: !!(P.downed || P.dead || P.hp <= 0), danger, won: window.__fight.won, active: !!g.bosses.active, rollCd: P.dodgeCd || 0 };
      };
    }, might);
    let attacking = false;
    let shotTaken = false;
    let detour = { until: 0, side: 1 };
    let lastProgress = { t: 0, d: Infinity };
    let st = await ev(() => window.__fightState());
    const t0 = st.t;
    while (!st.won && !st.down && st.t - t0 < 90) {
      const dx = st.bx - st.px;
      const dy = st.by - st.py;
      const d = Math.hypot(dx, dy) || 1;
      // Keep cutting until a marker under you is about to land, then step or roll out.
      if (st.danger && st.danger.left < 0.5) {
        if (attacking) {
          await pressAttack(false);
          attacking = false;
        }
        await hold(st.danger.x, st.danger.y);
        if (st.danger.left < 0.35 && st.rollCd <= 0) await roll();
      } else if (d > 24) {
        if (attacking) {
          await pressAttack(false);
          attacking = false;
        }
        // Snagged on a rock on the way in (no closer for half a second): go round it.
        if (st.t - lastProgress.t > 0.5) {
          if (d > lastProgress.d - 3) detour = { until: st.t + 0.5, side: -detour.side || 1 };
          lastProgress = { t: st.t, d };
        }
        if (st.t < detour.until) await hold((-dy / d) * detour.side * 0.9 + (dx / d) * 0.3, (dx / d) * detour.side * 0.9 + (dy / d) * 0.3);
        else await hold(dx / d, dy / d);
      } else if (S.phone) {
        await pressAttack(true);
      } else if (!attacking) {
        await release();
        await pressAttack(true);
        attacking = true;
      }
      if (process.env.FIGHT_TRACE && Math.floor(st.t * 2) !== Math.floor((st.t - 0.05) * 2)) out.notes.push(`fight ${(st.t - t0).toFixed(1)}: p ${st.px.toFixed(0)},${st.py.toFixed(0)} b ${st.bx.toFixed(0)},${st.by.toFixed(0)} d ${d.toFixed(0)} hp ${st.php} boss ${st.hp} ${st.danger ? 'danger' : ''} atk ${attacking}`);
      if (!shotTaken && (st.hp < 400 || st.t - t0 > 6)) {
        shotTaken = true;
        await shot(`6-varek-${might}`);
      }
      await wait(30);
      st = await ev(() => window.__fightState());
    }
    if (attacking) await pressAttack(false);
    await release();
    const f = await ev(() => ({ ...window.__fight }));
    return { might, won: f.won, seconds: f.won ? Math.round((f.t1 - f.t0) * 10) / 10 : null, left: st.hp, health: Math.round(f.hp0), lowest: Math.round(f.low), fell: st.down, atk: f.atk };
  };
  if (!S.phone) {
    const strong = await fightVarek(30);
    out.varek = { might30: strong };
    check(strong.won && strong.seconds <= 60, `${tag}: Varek yields to level 15 with 30 Might in ${strong.seconds} s (sword ${strong.atk}, health ${strong.health} → lowest ${strong.lowest})`, JSON.stringify(strong));
  } else {
    // On a phone: beside him, the sword button tapped for three game seconds; each cut
    // takes what the sheet's sword says (a scripted thumb on a stick is a poor fighter, so
    // the whole fight's time is measured on the computer and headless).
    await ev(() => {
      const g = window.__game;
      const P = g.player;
      window.__clean();
      P.level = 15;
      for (const id of Object.keys(g.progression.points)) g.progression.points[id] = 0;
      g.progression.points.might = 30;
      g.progression.points.vitality = 12;
      g.progression.changed();
      for (const id of ['steel_sword', 'iron_mail', 'traveler_cloak']) {
        if (!Object.values(g.gear.equipped).includes(id)) {
          P.inventory.add(id, 1);
          g.gear.equip(id);
        }
      }
      g.stats.refresh(P);
      P.hp = P.maxHp;
      const b = g.bosses.get('varek');
      window.__put(b.x - 14, b.y);
      P.facing.x = 1;
      P.facing.y = 0;
      g.bosses.startFight('varek');
      window.__cuts = [];
      g.bus.on('damage', (e) => {
        if (e.target === b && e.source === P) window.__cuts.push(e.amount);
      });
      window.__vk = { hp0: b.hp, t0: g.stats.t, atk: g.stats.get(P, 'atk') };
    });
    const t0 = await simT();
    while ((await simT()) - t0 < 3) {
      await ev(() => {
        const g = window.__game;
        const b = g.bosses.get('varek');
        const P = g.player;
        // Stay at his side (his blows push you back), as a thumb on the stick would.
        if (Math.hypot(b.x - P.x, b.y - P.y) > 20) window.__put(b.x - 14, b.y);
        P.hp = Math.max(P.hp, P.maxHp * 0.5);
      });
      await pressAttack(true);
      await wait(S.throttle ? 60 : 90);
    }
    await shot('6-varek-30');
    const vk = await ev(() => ({ ...window.__vk, cuts: window.__cuts.slice(), hp: window.__game.bosses.get('varek').hp }));
    const avg = vk.cuts.length ? vk.cuts.reduce((a, b) => a + b, 0) / vk.cuts.length : 0;
    out.varek = { cuts: vk.cuts.length, avg: Math.round(avg), sword: vk.atk, took: Math.round(vk.hp0 - vk.hp) };
    check(vk.cuts.length >= 3 && avg >= vk.atk * 0.9 && vk.hp0 - vk.hp >= 3 * vk.atk, `${tag}: tapped at Varek's side, ${vk.cuts.length} cuts of ~${Math.round(avg)} (sword ${vk.atk}) took ${Math.round(vk.hp0 - vk.hp)} of his ${Math.round(vk.hp0)}`, JSON.stringify(vk.cuts));
  }
  await ev(() => {
    const L2 = window.__game.companion;
    if (L2?._keptUpdate) {
      delete L2.update;
      delete L2._keptUpdate;
    }
  });

  await release();
  check(errors.length === 0, `${tag}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

for (const S of SIZES) {
  try {
    await run(S);
  } catch (err) {
    check(false, `${S.tag}: the run finished`, err.stack?.split('\n').slice(0, 3).join(' | '));
  }
}
await browser.close();
server.close();
console.log(JSON.stringify(report, null, 1));
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(`FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
