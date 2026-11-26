// Round 14b stats check (the author: "when I put a lot of points of speed, I can like
// literally be so fast that it's unplayable … the difference between 180 and 200 is not
// as big of a difference as 50 and 70"). Played in the built game on a phone held sideways
// (844x390, at a 4x CPU throttle) and upright (390x844) with the touch stick and the
// dodge button, and on a computer (1280x720) with keys:
//
//   1. a fixed straight on the lane south of your home, walked at 0, 20, 50, 70, 180, 200
//      and 999 Grace points: the speed each walks at (in game seconds, so a slow phone reads
//      the same), and 180→200 adding less than 50→70;
//   2. 999 Grace with everything that hastes you (the fastest boots and cloak, a Swiftfoot
//      Draught, a wind surge, Berserk, the Last Stand, Oath with Lyra beside you): the top
//      speed; then a loop of the village lanes, in through your door and out again, and
//      three rolls (one straight into the house wall), every game step checked: never
//      inside a wall or a shut door, never more than a few pixels a step; Lyra keeps up
//      or catches up;
//   3. the Character sheet with Free stat points on: Grace's +10 pressed again and again,
//      the "Next:" line shrinking, the controls at least 44 px, nothing spilling sideways.
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
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
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
        if (g.entities.blockedAt(P, P.x, P.y)) {
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
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stickBase.x + dx * R, y: stickBase.y + dy * R, id: 1 }] });
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
    if (S.phone) {
      const r = await ev(() => {
        const b = document.querySelector('.tbtn-dodge');
        const q = b?.getBoundingClientRect();
        return q && q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null;
      });
      if (!r) return false;
      const thumb = stickOn ? [{ x: stickBase.x + 51.9, y: stickBase.y, id: 1 }] : [];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...thumb, { x: Math.round(r.x), y: Math.round(r.y), id: 2 }] });
      await wait(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: thumb });
      return true;
    }
    await page.keyboard.down('ShiftLeft');
    await wait(60);
    await page.keyboard.up('ShiftLeft');
    return true;
  };
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
    S.addModifier(P, { id: 'price:berserk:gain', source: 'price:berserk', kind: 'gain', ...B.berserk, t: 600 });
    S.addModifier(P, { id: 'price:laststand:gain', source: 'price:laststand', kind: 'gain', ...B.laststand, label: 'Last Stand: burning', t: 600 });
    g.prices.state.oath = { t: 600 };
    const L = g.companion;
    if (L) {
      L.x = P.x - 14;
      L.y = P.y;
    }
    S.refresh(P);
  }, BUFFS);
  // Oath holds only while she is near: for this straight she is kept at your shoulder
  // (her own legs come in the lap below).
  await ev((from) => {
    window.__put(from.x, from.y);
    Object.assign(window.__sc, { rec: true, glue: true });
  }, STRAIGHT.from);
  await wait(200);
  const sources = await ev(() => window.__game.stats.breakdown(window.__game.player, 'speed').map((b) => b.source));
  check(['gear', 'swiftfoot', 'surge', 'price:berserk', 'price:laststand', 'price:oath', 'ceiling'].every((s) => sources.includes(s)), `${tag}: every haste is on (${sources.join(', ')})`);
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
    check(v <= 170 && v > 140, `${tag}: everything stacked walks at ${v.toFixed(1)} px/s (ceiling 170)`);
    await shot('2-stacked-straight');
  }

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
    const ok = await goTo(wp);
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

  // Rolls: along the lane, then straight into your house's wall.
  await ev((p) => window.__put(p.x, p.y), at(84, 84));
  await hold(1, 0);
  await wait(250);
  let rolled = 0;
  for (let i = 0; i < 2; i++) {
    const before = await ev(() => window.__game.player.dodgeCd || 0);
    await roll();
    await wait(450);
    const r = await ev(() => ({ cd: window.__game.player.dodgeCd || 0 }));
    if (r.cd > 0 || before > 0) rolled++;
    await wait(500);
  }
  await release();
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
