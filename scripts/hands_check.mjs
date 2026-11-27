// Round 15, the hands workstream (DESIGN §40.1–40.3), played in headless Chromium the way
// the author plays: a phone held sideways (844×390) and upright (390×844) with real taps and
// drags (CDP touch points), and a computer (1280×720) with keys and the mouse; the sideways
// phone again under a 4× CPU throttle where timing matters.
//   6. the aim preview goes the moment a cast ends: keys 1–4 with the mouse, a held hotbar
//      click dragged out to aim, the right button, a roll that breaks a charge, a press
//      refused for mana, casting while planted; on phones a tap, a drag-aim, a full charge, a
//      drag back to cancel, a press refused while cooling, a second weave while planted;
//   9. iron needs a pickaxe: the "Mine iron: needs a pickaxe" prompt, the word on the use
//      button, the blade ringing off, the iron hasp, the quarry tool chest, then mining;
//  11. the lock takes the training dummy: middle click and G on the computer, the long press
//      on the sword button on phones; weaves and the sword land on it.
// Screenshots go to --out (default screenshots/hands). Fails on page errors or a failed check.
//   node scripts/hands_check.mjs [--dist] [--out DIR] [--only desk|side|up]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const arg = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', 'screenshots/hands');
const ONLY = arg('--only', '');
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useDist ? 'dist/index.html' : 'index.html'}`;
const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (page, ms) => page.waitForTimeout(ms);

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${label}] console.error: ${t}`);
  });
}

// A new game with four weaves (a bolt, a thrown frost, a beam, a nova), mana kept full (unless
// a check starves it), the lessons and toasts out of the way, at noon.
async function startGame(page) {
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(page, 700);
  await page.evaluate(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    const m = g.magic;
    const give = { shape: ['bolt', 'throw', 'beam', 'nova'], essence: ['fire', 'frost', 'storm'] };
    for (const [k, ids] of Object.entries(give)) for (const id of ids) m.unlock(k, id, 'test');
    [
      { shape: 'bolt', essences: ['fire'], twists: [] },
      { shape: 'throw', essences: ['frost'], twists: [] },
      { shape: 'beam', essences: ['storm'], twists: [] },
      { shape: 'nova', essences: [], twists: [] },
    ].forEach((w, i) => m.setSlot(i, w));
    window.__fill = true;
    setInterval(() => {
      if (window.__fill) m.mana.cur = m.mana.max = Math.max(m.mana.max, 200);
    }, 100);
    g.ui.hud.weaving.invalidate();
    const u = g.ui;
    if (u.coach) {
      for (const id of ['cast', 'book', 'found']) u.coach.done[id] = true;
      u.coach.forced?.clear?.();
      u.coach.stop?.();
    }
    g.clock.skipTo?.(12);
    window.__hits = 0;
    g.bus.on('dummy_hit', () => window.__hits++);
    g.ui.toasts?.clear?.();
  });
  await wait(page, 300);
}

// The player (and whoever walks with them) to a world point, the camera with them.
async function teleport(page, x, y, face = { x: 1, y: 0 }) {
  await page.evaluate(
    ([x, y, face]) => {
      const g = window.__game;
      const P = g.player;
      P.x = x;
      P.y = y;
      P.vel && ((P.vel.x = 0), (P.vel.y = 0));
      P.facing = { ...face };
      const c = g.party?.holder || g.companion;
      if (c && !c.removed) {
        c.x = x - 30;
        c.y = y + 56;
        c.walker?.stop?.();
      }
      // Nobody else within the lock's reach (a check decides who is near).
      for (const e of g.entities.all()) if (e !== P && e !== c && e.type === 'actor' && !e.boss && Math.hypot(e.x - x, e.y - y) < 260) e.removed ? 0 : ((e.x += 2400), e.walker?.stop?.());
      g.camera.snap?.(P);
      g.camera.x = P.x - g.camera.vw / 2;
      g.camera.y = P.y - g.camera.vh / 2;
    },
    [x, y, face],
  );
  await wait(page, 350);
}

const aimState = (page) =>
  page.evaluate(() => {
    const w = window.__game.ui.hud.weaving;
    return { aims: w.aims.length, hover: !!w.hover, casts: w.casts.size };
  });
const cleared = (s) => s.aims === 0 && !s.hover;
const css = (page, wx, wy) => page.evaluate(([x, y]) => window.__game.renderer.worldToCss(x, y), [wx, wy]);

// A slime that stays put, in front of the player: a fight, the mouse aiming at it.
async function slimeAhead(page, dx = 80, dy = 6) {
  return page.evaluate(
    async ([dx, dy]) => {
      const g = window.__game;
      const { spawnCreature } = await import('/src/entities/monsters.js');
      const c = spawnCreature(g, 'slime', g.player.x + dx, g.player.y + dy);
      c.aggroRadius = 0;
      c.speed = 0;
      c.maxHp = c.hp = 9999;
      window.__slime = c;
      return { x: c.x, y: c.y };
    },
    [dx, dy],
  );
}

async function clearFoes(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (window.__slime) {
      window.__slime.removed = true;
      g.entities.remove?.(window.__slime);
    }
    g.ui.hud.weaving.stopAll?.();
    g.magic.resetCooldowns?.();
  });
}

const tileOf = (page, pred) => page.evaluate((src) => {
  const g = window.__game;
  // eslint-disable-next-line no-new-func
  const f = new Function('o', `return (${src})(o)`);
  const o = g.objects.all().find((x) => f(x));
  return o ? { id: o.id, x: o.x, y: o.y } : null;
}, pred.toString());

const promptText = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    let best = null;
    try {
      best = g.interactions?.best?.(g.player);
    } catch {
      best = null;
    }
    const dom = document.querySelector('.interact-prompt:not([hidden]) .prompt-text')?.textContent || '';
    const use = document.querySelector('.tbtn-interact')?.textContent || '';
    // The phone's tag over the use button shows the whole label (no ellipsis).
    const tag = document.querySelector('.tbtn-interact .tbtn-tag');
    const fits = !tag || !tag.offsetParent || tag.scrollWidth <= tag.clientWidth + 1;
    return { label: best?.label || '', dom, use, fits };
  });
const toastsSay = (page, re) => page.evaluate((src) => new RegExp(src, 'i').test(document.querySelector('.toasts')?.textContent || ''), re.source);
const count = (page, id) => page.evaluate((id) => window.__game.player.inventory.count(id), id);

// ------------------------------------------------------------------ the computer

async function desktop() {
  const label = 'desk';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page, label);
  await startGame(page);

  // ---- 6: the aim highlight, every input path on the computer
  const foe = await slimeAhead(page);
  const at = await css(page, foe.x, foe.y - 6);
  await page.mouse.move(at.x - 30, at.y);
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await page.keyboard.down('Digit1');
  await wait(page, 600);
  const held = await aimState(page);
  await page.screenshot({ path: `${OUT}/desk-6-key-held.png` });
  check('desk 6: holding 1 shows the aim', held.aims === 1, JSON.stringify(held));
  await page.keyboard.up('Digit1');
  let worst = { aims: 0, hover: false };
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(at.x + (i % 3) * 4, at.y + (i % 2) * 3, { steps: 2 });
    await wait(page, 160);
    const s = await aimState(page);
    if (!cleared(s)) worst = s;
  }
  await page.screenshot({ path: `${OUT}/desk-6-key-after.png` });
  check('desk 6: released, nothing of the aim stays (1.3 s, the mouse still moving in the fight)', cleared(worst), JSON.stringify(worst));

  // A hotbar slot pressed, held, dragged out over the world to aim, let go there.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  const slot = await page.evaluate(() => {
    const b = document.querySelector('.hotbar .hslot:not([hidden])');
    const r = b?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  if (slot) {
    await page.mouse.move(slot.x, slot.y);
    await page.mouse.down();
    await wait(page, 350);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    await wait(page, 200);
    const h2 = await aimState(page);
    await page.screenshot({ path: `${OUT}/desk-6-click-held.png` });
    await page.mouse.up();
    await wait(page, 300);
    await page.mouse.move(at.x + 6, at.y + 4, { steps: 3 });
    await wait(page, 600);
    const a2 = await aimState(page);
    await page.screenshot({ path: `${OUT}/desk-6-click-after.png` });
    check('desk 6: a hotbar click held and dragged out shows the aim', h2.aims === 1, JSON.stringify(h2));
    check('desk 6: let go, the aim goes', cleared(a2), JSON.stringify(a2));
  } else check('desk 6: the hotbar is there', false);

  // The right button (the marked weave).
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await wait(page, 500);
  const h3 = await aimState(page);
  await page.mouse.up({ button: 'right' });
  await wait(page, 250);
  await page.mouse.move(at.x + 5, at.y, { steps: 3 });
  await wait(page, 500);
  const a3 = await aimState(page);
  check('desk 6: the right button shows the aim while held and nothing after', h3.aims === 1 && cleared(a3), `${JSON.stringify(h3)} -> ${JSON.stringify(a3)}`);

  // A roll breaks a charge: the key still down, the aim goes with the charge.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await page.keyboard.down('Digit2');
  await wait(page, 500);
  const h4 = await aimState(page);
  await page.keyboard.press('ShiftLeft');
  await wait(page, 250);
  const a4 = await aimState(page);
  await page.screenshot({ path: `${OUT}/desk-6-roll.png` });
  await page.keyboard.up('Digit2');
  await wait(page, 300);
  check('desk 6: a roll breaks the charge and its aim goes, the key still held', h4.aims === 1 && cleared(a4), `${JSON.stringify(h4)} -> ${JSON.stringify(a4)}`);

  // Refused for mana: nothing drawn, now or after.
  await wait(page, 600);
  await page.evaluate(() => {
    window.__fill = false;
    window.__game.magic.mana.cur = 0;
    window.__game.magic.resetCooldowns?.();
  });
  await page.keyboard.down('Digit1');
  await wait(page, 400);
  const h5 = await aimState(page);
  await page.keyboard.up('Digit1');
  await wait(page, 600);
  const a5 = await aimState(page);
  await page.evaluate(() => (window.__fill = true));
  check('desk 6: a press refused for mana draws nothing, now or after', cleared(h5) && cleared(a5), `${JSON.stringify(h5)} -> ${JSON.stringify(a5)}`);

  // Casting while planted (§14): a quick cast, then a second weave held at once.
  await wait(page, 300);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await page.keyboard.press('Digit1');
  await wait(page, 60);
  await page.keyboard.down('Digit3');
  await wait(page, 450);
  const h6 = await aimState(page);
  await page.keyboard.up('Digit3');
  await wait(page, 600);
  const a6 = await aimState(page);
  check('desk 6: planted, a second weave shows its aim only while held', h6.aims === 1 && cleared(a6), `${JSON.stringify(h6)} -> ${JSON.stringify(a6)}`);
  await clearFoes(page);

  // ---- 11: the lock on the training dummy
  const dummy = await tileOf(page, (o) => o.objType === 'dummy');
  // In front of it, in the yard (its west side is the watch-house wall).
  await teleport(page, dummy.x, dummy.y + 36, { x: 0, y: -1 });
  const dc = await css(page, dummy.x, dummy.y - 16);
  await page.mouse.move(dc.x, dc.y, { steps: 4 });
  await page.mouse.click(dc.x, dc.y, { button: 'middle' });
  await wait(page, 300);
  const lk = await page.evaluate(() => window.__game.lock?.target?.id || null);
  await page.mouse.move(dc.x - 160, dc.y - 120, { steps: 4 });
  await wait(page, 200);
  await page.screenshot({ path: `${OUT}/desk-11-locked.png` });
  check('desk 11: a middle click on the training dummy locks it', lk === dummy.id, String(lk));
  const before = await page.evaluate(() => window.__hits);
  await page.keyboard.press('Digit1');
  await wait(page, 900);
  const afterBolt = await page.evaluate(() => window.__hits);
  check('desk 11: a weave cast with the mouse elsewhere flies to the locked dummy', afterBolt > before, `${before} -> ${afterBolt}`);
  await teleport(page, dummy.x, dummy.y + 14, { x: 0, y: 1 });
  const lk2 = await page.evaluate(() => window.__game.lock?.target?.id || null);
  await page.keyboard.press('KeyJ');
  await wait(page, 500);
  const afterSword = await page.evaluate(() => ({ hits: window.__hits, fy: window.__game.player.facing.y }));
  check('desk 11: the sword turns to the locked dummy behind and lands', lk2 === dummy.id && afterSword.hits > afterBolt && afterSword.fy < -0.5, JSON.stringify({ lk2, ...afterSword }));
  await page.keyboard.press('KeyG');
  await wait(page, 150);
  const g1 = await page.evaluate(() => window.__game.lock?.target?.id || null);
  await page.keyboard.press('KeyG');
  await wait(page, 150);
  const g2 = await page.evaluate(() => window.__game.lock?.target?.id || null);
  check('desk 11: G lets go, G again takes the dummy (the nearest in front)', g1 === null && g2 === dummy.id, `${g1} -> ${g2}`);
  await page.keyboard.press('KeyG');

  // ---- 9: iron and the pickaxe
  await ironPath(page, label, {
    use: async () => page.keyboard.press('KeyE'),
    swing: async () => page.keyboard.press('KeyJ'),
    tapText: async (re) => {
      const ok = await page.evaluate((src) => {
        const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent) && x.offsetParent);
        if (!b) return false;
        b.click();
        return true;
      }, re.source);
      return ok;
    },
    close: async () => page.keyboard.press('Escape'),
  });
  await ctx.close();
}

// ------------------------------------------------------------------ the phones

async function phone(label, w, h, { throttle = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page, label);
  await startGame(page);
  const cdp = await ctx.newCDPSession(page);
  if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const center = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, sel);
  let id = 10;
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (p, ms = 60) => {
    const i = id++;
    await touch('touchStart', [{ x: p.x, y: p.y, id: i }]);
    await wait(page, ms);
    await touch('touchEnd', []);
  };
  const slotSel = (i) => `.tcluster .wbtn[data-slot="${i}"]`;

  // ---- 6
  await slimeAhead(page);
  // A tap.
  const s0 = await center(slotSel(0));
  await tap(s0, 60);
  await wait(page, 300);
  const t1 = await aimState(page);
  check(`${label} 6: a tap casts and leaves no aim`, cleared(t1), JSON.stringify(t1));
  // A drag to aim, let go out there.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  let i = id++;
  await touch('touchStart', [{ x: s0.x, y: s0.y, id: i }]);
  for (let k = 1; k <= 6; k++) {
    await touch('touchMove', [{ x: s0.x - 12 * k, y: s0.y - 7 * k, id: i }]);
    await wait(page, 40);
  }
  await wait(page, 250);
  const d1 = await aimState(page);
  await page.screenshot({ path: `${OUT}/${label}-6-drag-held.png` });
  await touch('touchEnd', []);
  await wait(page, throttle ? 500 : 300);
  const d2 = await aimState(page);
  await page.screenshot({ path: `${OUT}/${label}-6-drag-after.png` });
  check(`${label} 6: a drag shows the aim and the lift clears it${throttle ? ' (4× CPU throttle)' : ''}`, d1.aims === 1 && cleared(d2), `${JSON.stringify(d1)} -> ${JSON.stringify(d2)}`);
  // Hold to charge, full, then let go.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  const s1 = await center(slotSel(1));
  i = id++;
  await touch('touchStart', [{ x: s1.x, y: s1.y, id: i }]);
  await wait(page, 1700);
  const c1 = await aimState(page);
  await touch('touchEnd', []);
  await wait(page, 300);
  const c2 = await aimState(page);
  check(`${label} 6: a full charge shows the aim, the lift clears it`, c1.aims === 1 && cleared(c2), `${JSON.stringify(c1)} -> ${JSON.stringify(c2)}`);
  // A charge held with one thumb, a roll with the other (the dodge button): the roll breaks
  // the charge, and its aim goes with it while the first thumb is still down.
  await wait(page, 500);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  const dg = await center('.tbtn-dodge');
  i = id++;
  await touch('touchStart', [{ x: s1.x, y: s1.y, id: i }]);
  await wait(page, 600);
  const rr1 = await aimState(page);
  await touch('touchStart', [{ x: s1.x, y: s1.y, id: i }, { x: dg.x, y: dg.y, id: i + 1 }]);
  await wait(page, 80);
  // (CDP: a move that lists only the weave thumb lifts the dodge thumb.)
  await touch('touchMove', [{ x: s1.x, y: s1.y, id: i }]);
  await wait(page, throttle ? 450 : 300);
  const rr2 = await aimState(page);
  const rolled = await page.evaluate(() => window.__game.player.rolling || window.__game.player.state === 'dodge' || (window.__game.player.rollT ?? 0) > 0);
  await page.screenshot({ path: `${OUT}/${label}-6-roll.png` });
  await touch('touchEnd', []);
  await wait(page, 300);
  check(`${label} 6: a roll breaks a held charge and its aim goes, the thumb still on the weave`, rr1.aims === 1 && cleared(rr2), `${JSON.stringify(rr1)} -> ${JSON.stringify(rr2)} rolled ${rolled}`);
  // Drag back onto the button to cancel.
  await wait(page, 500);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  i = id++;
  await touch('touchStart', [{ x: s0.x, y: s0.y, id: i }]);
  await touch('touchMove', [{ x: s0.x - 70, y: s0.y - 30, id: i }]);
  await wait(page, 150);
  await touch('touchMove', [{ x: s0.x - 3, y: s0.y + 2, id: i }]);
  await wait(page, 150);
  const k1 = await page.evaluate(() => ({ cancel: !!window.__game.ui.hud.weaving.aims[0]?.cancel }));
  await page.screenshot({ path: `${OUT}/${label}-6-cancel-held.png` });
  await touch('touchEnd', []);
  await wait(page, 300);
  const k2 = await aimState(page);
  check(`${label} 6: dragged back to cancel, the aim turns red, and goes on the lift`, k1.cancel && cleared(k2) && k2.casts === 0, `${JSON.stringify(k1)} -> ${JSON.stringify(k2)}`);
  // Refused while cooling: the nova cast, pressed again at once.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  const s3 = await center(slotSel(3));
  await tap(s3, 60);
  await wait(page, 200);
  i = id++;
  await touch('touchStart', [{ x: s3.x, y: s3.y, id: i }]);
  await wait(page, 400);
  const r1 = await aimState(page);
  await touch('touchEnd', []);
  await wait(page, 300);
  const r2 = await aimState(page);
  check(`${label} 6: a press refused while cooling draws nothing, now or after`, cleared(r1) && cleared(r2), `${JSON.stringify(r1)} -> ${JSON.stringify(r2)}`);
  // Planted: a tap, then a second weave held at once.
  await wait(page, 300);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await tap(s0, 50);
  i = id++;
  await touch('touchStart', [{ x: s1.x, y: s1.y, id: i }]);
  await wait(page, 400);
  const p1 = await aimState(page);
  await touch('touchEnd', []);
  await wait(page, 350);
  const p2 = await aimState(page);
  await page.screenshot({ path: `${OUT}/${label}-6-planted-after.png` });
  check(`${label} 6: planted, the second weave's aim shows while held and goes on the lift`, p1.aims === 1 && cleared(p2), `${JSON.stringify(p1)} -> ${JSON.stringify(p2)}`);
  await clearFoes(page);
  if (throttle) {
    await ctx.close();
    return;
  }

  // ---- 11: a long press on the sword button locks the dummy
  const dummy = await tileOf(page, (o) => o.objType === 'dummy');
  await teleport(page, dummy.x, dummy.y + 36, { x: 0, y: -1 });
  const sw = await center('.tbtn-attack');
  i = id++;
  await touch('touchStart', [{ x: sw.x, y: sw.y, id: i }]);
  await wait(page, 700);
  await touch('touchEnd', []);
  await wait(page, 250);
  const lk = await page.evaluate(() => window.__game.lock?.target?.id || null);
  await page.screenshot({ path: `${OUT}/${label}-11-locked.png` });
  check(`${label} 11: a long press on the sword button locks the training dummy`, lk === dummy.id, String(lk));
  const h0 = await page.evaluate(() => window.__hits);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await tap(await center(slotSel(0)), 60);
  await wait(page, 900);
  const h1 = await page.evaluate(() => window.__hits);
  check(`${label} 11: a tapped weave flies to the locked dummy`, h1 > h0, `${h0} -> ${h1}`);
  await page.evaluate(() => window.__game.lock?.clear?.());

  // ---- 9
  await ironPath(page, label, {
    // A thumb taps the use button once it names what is there (not the instant after a
    // teleport, while it still reads Talk).
    use: async (re = /mine|open|locked|footlocker|chest/i) => {
      await page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('.tbtn-interact .tbtn-tag')?.textContent || ''), re.source, { timeout: 4000 }).catch(() => {});
      await tap(await center('.tbtn-interact'), 60);
    },
    swing: async () => tap(await center('.tbtn-attack'), 60),
    tapText: async (re) => {
      const p = await page.evaluate((src) => {
        const b = [...document.querySelectorAll('button')].find((x) => new RegExp(src, 'i').test(x.textContent) && x.offsetParent);
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, re.source);
      if (!p) return false;
      await tap(p, 60);
      return true;
    },
    close: async () => {
      const p = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.panel-close')].find((x) => x.offsetParent);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      });
      if (p) await tap(p, 60);
      return p;
    },
  });
  await ctx.close();
}

// ------------------------------------------------------------------ 9: one path, any device

async function ironPath(page, label, io) {
  const box = await tileOf(page, (o) => o.id === 'quarry_tools');
  const vein = await page.evaluate(() => {
    const g = window.__game;
    const box = g.objects.get('quarry_tools');
    const list = g.objects.all().filter((o) => o.objType === 'ore' && !o.state.depleted);
    list.sort((a, b) => Math.hypot(a.x - (box?.x ?? 0), a.y - (box?.y ?? 0)) - Math.hypot(b.x - (box?.x ?? 0), b.y - (box?.y ?? 0)));
    const o = list[0];
    return o ? { id: o.id, x: o.x, y: o.y } : null;
  });
  check(`${label} 9: the quarry has its tool chest`, !!box, JSON.stringify(box));
  if (!vein) return check(`${label} 9: an ore vein to try`, false);
  // (Run on the build before round 15, the bare-hands half still plays and shows the bug.)
  await page.evaluate(() => window.__game.ui.toasts?.clear?.());
  await teleport(page, vein.x - 13, vein.y + 1);
  const pr = await promptText(page);
  await page.screenshot({ path: `${OUT}/${label}-9-prompt.png` });
  check(`${label} 9: the prompt names the tool ("Mine iron: needs a pickaxe"), whole on the screen`, /needs a pickaxe/i.test(pr.label) && (/needs a pickaxe/i.test(pr.dom) || /pickaxe|mine/i.test(pr.use) || label !== 'desk') && pr.fits, JSON.stringify(pr));
  await io.use();
  await wait(page, 400);
  const said = await toastsSay(page, /need a pickaxe for iron/);
  check(`${label} 9: the use button says what it needs, and where to get one`, said);
  // The author's way: the use button, held to its end by bare hands (a vein takes 4 s).
  await wait(page, 4800);
  const byHand = await count(page, 'iron_ore');
  await page.screenshot({ path: `${OUT}/${label}-9-by-hand.png` });
  check(`${label} 9: bare hands mine no iron (the author: "I can like break iron without any specialized tools")`, byHand === 0, `iron ore ${byHand}`);
  for (let k = 0; k < 5; k++) {
    await io.swing();
    await wait(page, 380);
  }
  await page.screenshot({ path: `${OUT}/${label}-9-ring.png` });
  const ore0 = await count(page, 'iron_ore');
  const ring = await toastsSay(page, /rings off it/);
  const whole = await page.evaluate((id) => !window.__game.objects.get(id).state.depleted, vein.id);
  check(`${label} 9: by hand and sword the vein stays whole and gives nothing; the blade rings off`, ore0 === 0 && whole && ring, JSON.stringify({ ore0, whole, ring }));

  // The iron hasp, by hand: the word, no offer to force it.
  const locker = await tileOf(page, (o) => o.id === 'guard_footlocker');
  if (!box) {
    await teleport(page, locker.x, locker.y + 14, { x: 0, y: -1 });
    await io.use();
    await wait(page, 500);
    await page.screenshot({ path: `${OUT}/${label}-9-hasp-bare.png` });
    return check(`${label} 9: (no tool chest: the rest needs the pickaxe)`, false);
  }
  await teleport(page, locker.x, locker.y + 14, { x: 0, y: -1 });
  await page.evaluate(() => window.__game.ui.toasts?.clear?.());
  await io.use();
  await wait(page, 400);
  const modal = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Break the hasp|Force the lock/i.test(b.textContent) && b.offsetParent));
  const haspWord = await toastsSay(page, /pickaxe/);
  await page.screenshot({ path: `${OUT}/${label}-9-hasp-bare.png` });
  check(`${label} 9: an iron hasp by hand: the word of the pickaxe, no offer to force it`, !modal && haspWord, JSON.stringify({ modal, haspWord }));

  // The quarry tool chest: take the spare pick.
  await teleport(page, box.x, box.y + 14, { x: 0, y: -1 });
  await io.use();
  await wait(page, 600);
  await page.screenshot({ path: `${OUT}/${label}-9-chest.png` });
  const took = await io.tapText(/Take everything/);
  await wait(page, 400);
  const pick = await count(page, 'pickaxe');
  check(`${label} 9: the quarry tool chest gives a pickaxe`, took && pick === 1, JSON.stringify({ took, pick }));
  await io.close();
  await wait(page, 400);
  const open = await page.evaluate(() => !!window.__game.ui.isModalOpen?.());
  if (open) await page.evaluate(() => window.__game.ui.closeModal?.());

  // Now the vein: the prompt, the use button, the ore.
  await teleport(page, vein.x - 13, vein.y + 1);
  const pr2 = await promptText(page);
  check(`${label} 9: with the pick the prompt reads "Mine iron ore (pickaxe)", whole on the screen`, /\(pickaxe\)/.test(pr2.label) && pr2.fits, JSON.stringify(pr2));
  await io.use();
  await wait(page, 5600);
  const ore1 = await count(page, 'iron_ore');
  await page.screenshot({ path: `${OUT}/${label}-9-mined.png` });
  const why = ore1 >= 1 ? '' : await page.evaluate((id) => {
    const g = window.__game;
    const o = g.objects.get(id);
    return JSON.stringify({ worker: !!o._worker, depleted: o.state.depleted, modal: !!g.ui.isModalOpen?.(), enabled: g.input.enabled, pstate: g.player.state, d: Math.round(Math.hypot(o.x - g.player.x, o.y - g.player.y)), best: g.interactions?.best?.(g.player)?.label, pick: g.player.inventory.count('pickaxe') });
  }, vein.id);
  check(`${label} 9: with the pickaxe the vein gives its ore`, ore1 >= 1, `iron ore ${ore1} ${why}`);

  // The hasp with the pick: the offer appears (left alone: no theft here).
  await teleport(page, locker.x, locker.y + 14, { x: 0, y: -1 });
  await io.use();
  await wait(page, 500);
  const offer = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Break the hasp/i.test(b.textContent) && b.offsetParent));
  await page.screenshot({ path: `${OUT}/${label}-9-hasp-pick.png` });
  check(`${label} 9: with a pickaxe, the hasp can be broken (asked first)`, offer);
  if (offer) await io.tapText(/Leave it/);
  await wait(page, 300);

  // Bram keeps them in stock (the shop's panel is the shop workstream's; its data is here).
  const ware = await page.evaluate(async () => {
    const { shopOf } = await import('/src/world/trade.js');
    const g = window.__game;
    return shopOf(g, g.entities.get('bram')).sells.find((s) => s.id === 'pickaxe') || null;
  }).catch(() => null);
  check(`${label} 9: Bram sells the pickaxe`, ware && ware.price > 0, JSON.stringify(ware));
}

// ------------------------------------------------------------------ run

if (!ONLY || ONLY === 'desk') await desktop();
if (!ONLY || ONLY === 'side') await phone('side', 844, 390);
if (!ONLY || ONLY === 'up') await phone('up', 390, 844);
if (!ONLY || ONLY === 'side') await phone('side-4x', 844, 390, { throttle: true });

await browser.close();
server.close();
for (const e of errors) console.log(e);
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}`);
process.exit(failed.length || errors.length ? 1 : 0);
