// Browser check of the weaving controls (DESIGN.md §22.4) in headless Chromium:
// the battle layout on phones held sideways (844×390, 667×375) and upright (390×844),
// real multi-touch (moving and aiming a weave at the same time, through CDP touch
// points), the desktop hotbar with keys, mouse aim, wheel and clicks, and the Spellbook.
// Every weave starts on the press and is cast on the release (DESIGN §22.4): a quick tap
// casts uncharged, a long hold charges it (the button's ring fills, pulses when full),
// and a cast weave cools with its seconds on the button; a press while cooling shakes.
// When the build has no game.magic yet, a stub stands in (tests/helpers/magic_stub.mjs).
// Fails on page errors, horizontal overflow, tap targets under 44 px, or a failed check.
//   node scripts/controls_check.mjs [--dist] [--out DIR]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'screenshots';
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const base = `http://localhost:${server.address().port}`;
const url = `${base}/${useDist ? 'dist/index.html' : 'index.html'}`;
const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${label}] console.error: ${t}`);
  });
}

// Start a game, skip any story, give the stub magic when the build has none, and put
// two slimes in front of the player for auto-aim.
async function startGame(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return page.evaluate(async (stubUrl) => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    let stub = false;
    if (!g.magic) {
      const { makeMagicStub } = await import(stubUrl);
      g.magic = makeMagicStub(g);
      g.magic.fired = g.magic.released;
      window.__stubTimer = setInterval(() => g.magic.update?.(0.1), 100);
      stub = true;
    } else {
      // The real runtime: the same unlocks and slots as the stub, and a record of calls.
      const m = g.magic;
      const give = { shape: ['bolt', 'blast', 'throw', 'beam', 'nova', 'strike'], essence: ['fire', 'frost', 'storm'], twist: ['multishot', 'split', 'charge', 'homing'] };
      for (const [k, ids] of Object.entries(give)) for (const id of ids) m.unlock(k, id, 'test');
      const weaves = [
        { shape: 'bolt', essences: ['fire'], twists: ['multishot'] },
        { shape: 'throw', essences: ['frost'], twists: [] },
        { shape: 'beam', essences: ['storm'], twists: [] },
        { shape: 'nova', essences: [], twists: [] },
      ];
      weaves.forEach((w, i) => m.setSlot(i, w));
      m.mana.cur = m.mana.max = Math.max(m.mana.max, 120);
      m.calls = [];
      for (const fn of ['cast', 'castStart', 'castHold', 'castRelease', 'castCancel']) {
        const raw = m[fn].bind(m);
        m[fn] = (caster, a, b, ...rest) => {
          const slot = fn === 'cast' || fn === 'castStart' ? a : m.holds?.get?.(caster)?.r?.slot ?? -1;
          const aim = fn === 'cast' || fn === 'castStart' ? b : a;
          m.calls.push({ fn, slot, aim: aim ? { x: aim.x, y: aim.y, target: aim.target || null } : null });
          return raw(caster, a, b, ...rest);
        };
      }
      // What really left the hands: { slot, aim, k } for every cast (a release, a tap).
      m.fired = [];
      const fire = m._fire.bind(m);
      m._fire = (caster, r, aim, opts = {}) => {
        if (caster === g.player) m.fired.push({ slot: r.slot, aim: aim ? { x: aim.x, y: aim.y, target: aim.target || null } : null, k: opts.chargeK || 0 });
        return fire(caster, r, aim, opts);
      };
      window.__stubTimer = setInterval(() => {
        m.mana.cur = m.mana.max;
      }, 200);
    }
    g.ui.hud.weaving.invalidate();
    // The magic lessons would cover the outer weave buttons: this check is not about them
    // (phone_check walks through them).
    const u = g.ui;
    if (u.coach) {
      for (const id of ['cast', 'book', 'found']) u.coach.done[id] = true;
      u.coach.forced?.clear?.();
      u.coach.stop?.();
    }
    // Toasts from the start of the game cover the HUD in screenshots: clear them.
    try {
      g.ui.toasts?.clear?.();
    } catch {
      /* optional */
    }
    let foes = 0;
    try {
      const { spawnCreature } = await import('/src/entities/monsters.js');
      for (const [dx, dy] of [
        [70, -10],
        [96, 26],
      ]) {
        const c = spawnCreature(g, 'slime', g.player.x + dx, g.player.y + dy);
        if (c) {
          c.aggroRadius = 0;
          foes++;
        }
      }
    } catch {
      /* the dist build has no source modules */
    }
    g.clock.skipTo?.(17);
    return { stub, foes };
  }, `${base}/tests/helpers/magic_stub.mjs`);
}

// Every visible control must be at least 44 px both ways; no horizontal scroll.
async function layoutChecks(page, label, selector) {
  const r = await page.evaluate((sel) => {
    const small = [];
    for (const el of document.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (b.width < 43.5 || b.height < 43.5) small.push(`${el.className || el.tagName} ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const offscreen = [];
    for (const el of document.querySelectorAll('.tcluster .tbtn:not([hidden]), .tcluster .wbtn:not([hidden]), .hud-btn:not([hidden])')) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.left < -1 || b.right > window.innerWidth + 1 || b.top < -1 || b.bottom > window.innerHeight + 1)) offscreen.push(el.className);
    }
    return { small, over, offscreen };
  }, selector);
  check(`${label}: no horizontal overflow`, r.over <= 0, `scrollWidth - width = ${r.over}`);
  check(`${label}: tap targets ≥ 44 px`, !r.small.length, r.small.slice(0, 6).join(', '));
  check(`${label}: controls on screen`, !r.offscreen.length, r.offscreen.join(', '));
}

async function center(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, selector);
}

const TOUCH_SEL = '.tcluster .tbtn:not([hidden]), .tcluster .wbtn:not([hidden]), .is-touch .hud-btn:not([hidden]), .orders-btn';

async function phone(label, w, h) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  watch(page, label);
  const info = await startGame(page);
  await page.waitForTimeout(700);
  const ui = await page.evaluate(() => ({ touch: window.__game.ui.isTouch, slots: document.querySelectorAll('.tcluster .wbtn:not([hidden])').length }));
  check(`${label}: touch layout with weave buttons`, ui.touch && ui.slots >= 4, `slots ${ui.slots}, stub ${info.stub}`);
  await page.screenshot({ path: `${OUT}/controls-${label}.png` });
  await layoutChecks(page, label, TOUCH_SEL);

  // Two fingers at once: one moves (left half), one drags a weave to aim.
  const cdp = await context.newCDPSession(page);
  const slot = await center(page, '.tcluster .wbtn:not([hidden])');
  const stick = { x: Math.round(w * 0.18), y: Math.round(h * 0.75) };
  const before = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y, calls: window.__game.magic.calls?.length ?? 0 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x, y: stick.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x, y: stick.y, id: 1 }, { x: slot.x, y: slot.y, id: 2 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: stick.x + 8 * i, y: stick.y, id: 1 },
        { x: slot.x - 12 * i, y: slot.y - 7 * i, id: 2 },
      ],
    });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => {
    const g = window.__game;
    const wv = g.ui.hud.weaving;
    return { move: { ...g.input.touchVec }, aims: wv.aims.length, aim: wv.aims[0] ? { x: wv.aims[0].x - g.player.x, y: wv.aims[0].y - g.player.y } : null, px: g.player.x };
  });
  await page.screenshot({ path: `${OUT}/controls-${label}-aiming.png` });
  check(`${label}: moving while aiming (two fingers)`, mid.move.x > 0.3 && mid.aims === 1, JSON.stringify(mid));
  check(`${label}: the drag aims up-left`, mid.aim && mid.aim.x < 0 && mid.aim.y < 0, JSON.stringify(mid.aim));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: stick.x + 48, y: stick.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({ x: window.__game.player.x, calls: (window.__game.magic.calls || []).slice(-3).map((c) => ({ fn: c.fn, slot: c.slot, aim: c.aim && { x: c.aim.x, y: c.aim.y } })), move: { ...window.__game.input.touchVec } }));
  check(`${label}: the player walked`, after.x > before.x + 4, `${Math.round(before.x)} -> ${Math.round(after.x)}`);
  const cast = await page.evaluate(() => {
    const f = window.__game.magic.fired.slice(-1)[0];
    return f ? { slot: f.slot, k: f.k, aim: f.aim && { x: f.aim.x, y: f.aim.y } } : null;
  });
  check(`${label}: release cast the weave toward the drag`, !!cast && cast.aim && cast.aim.x < before.x, JSON.stringify(cast || after.calls));
  check(`${label}: stick released`, after.move.x === 0 && after.move.y === 0);

  // A quick tap auto-aims at the nearest foe, uncharged; the weave then cools with its
  // seconds on the button (slot 4 is a nova: 3.5 s).
  if (info.foes) {
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__game.magic.resetCooldowns?.());
    const slot2 = await center(page, '.tcluster .wbtn:not([hidden])');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: slot2.x, y: slot2.y, id: 3 }] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const tap = await page.evaluate(() => {
      const f = window.__game.magic.fired.slice(-1)[0];
      return f ? { slot: f.slot, k: f.k, target: !!f.aim?.target } : null;
    });
    check(`${label}: a tap auto-aims at a foe, uncharged`, tap && tap.slot === 0 && tap.target && tap.k === 0, JSON.stringify(tap));
  }

  // Hold a weave: its ring fills, pulses when full; letting go casts it fully charged.
  {
    await page.evaluate(() => window.__game.magic.resetCooldowns?.());
    const s = await center(page, '.tcluster .wbtn[data-slot="1"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y, id: 5 }] });
    await page.waitForTimeout(700);
    const mid = await page.evaluate(() => {
      const b = document.querySelector('.tcluster .wbtn[data-slot="1"]');
      return { charging: b.classList.contains('charging'), k: Number(getComputedStyle(b.querySelector('.wbtn-chg')).getPropertyValue('--charge')) };
    });
    await page.screenshot({ path: `${OUT}/controls-${label}-charging.png` });
    check(`${label}: holding a weave fills its charge ring`, mid.charging && mid.k > 0.2 && mid.k < 1, JSON.stringify(mid));
    await page.waitForTimeout(1100);
    const full = await page.evaluate(() => document.querySelector('.tcluster .wbtn[data-slot="1"]').classList.contains('charged'));
    await page.screenshot({ path: `${OUT}/controls-${label}-charged.png` });
    check(`${label}: full charge pulses`, full);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(90);
    await page.screenshot({ path: `${OUT}/controls-${label}-release.png` });
    const f = await page.evaluate(() => window.__game.magic.fired.slice(-1)[0] || null);
    check(`${label}: letting go casts it fully charged`, f && f.slot === 1 && f.k >= 0.999, JSON.stringify(f && { slot: f.slot, k: f.k }));
  }

  // The nova cools: seconds on its button; pressed again it shakes and casts nothing.
  if (!info.stub) {
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__game.magic.resetCooldowns?.());
    const s = await center(page, '.tcluster .wbtn[data-slot="3"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y, id: 6 }] });
    await page.waitForTimeout(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const cool = await page.evaluate(() => {
      const b = document.querySelector('.tcluster .wbtn[data-slot="3"]');
      return { cooling: b.classList.contains('cooling'), secs: b.querySelector('.wbtn-secs')?.textContent || '' };
    });
    await page.screenshot({ path: `${OUT}/controls-${label}-cooldown.png` });
    check(`${label}: a cast nova cools with its seconds on the button`, cool.cooling && Number(cool.secs) >= 2, JSON.stringify(cool));
    const n0 = await page.evaluate(() => window.__game.magic.fired.length);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y, id: 7 }] });
    await page.waitForTimeout(60);
    const shake = await page.evaluate(() => document.querySelector('.tcluster .wbtn[data-slot="3"]').classList.contains('not-ready'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const n1 = await page.evaluate(() => window.__game.magic.fired.length);
    check(`${label}: pressing a cooling weave shakes and casts nothing`, shake && n1 === n0, `shake ${shake}, casts ${n0} -> ${n1}`);
  }

  // Drag out and back onto the button: cancelled, nothing cast.
  {
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__game.magic.resetCooldowns?.());
    const n0 = await page.evaluate(() => window.__game.magic.fired.length);
    const s = await center(page, '.tcluster .wbtn:not([hidden])');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y, id: 4 }] });
    for (const [dx, dy] of [
      [-30, -10],
      [-60, -20],
      [-20, -6],
      [-2, 0],
    ]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x + dx, y: s.y + dy, id: 4 }] });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const n1 = await page.evaluate(() => window.__game.magic.fired.length);
    check(`${label}: dragging back onto the button cancels`, n1 === n0, `${n0} -> ${n1}`);
  }

  // Upright, once: "Turn your phone sideways for fights." (when the build has that tip)
  if (h > w && (await page.evaluate(() => !!document.querySelector('.turn-tip')))) {
    const tip = await page.waitForFunction(() => !document.querySelector('.turn-tip')?.hidden, null, { timeout: 8000 }).then(
      () => true,
      () => false,
    );
    check(`${label}: the one-time tip suggests turning the phone`, tip);
    if (tip) await page.screenshot({ path: `${OUT}/controls-${label}-tip.png` });
    await page.evaluate(() => document.querySelector('.turn-tip')?.click());
    const gone = await page.evaluate(() => document.querySelector('.turn-tip').hidden);
    check(`${label}: a tap puts the tip away`, gone);
  }

  // Night look of the layout.
  await page.evaluate(() => window.__game.clock.skipTo(22));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/controls-${label}-night.png` });

  // The Spellbook.
  await page.evaluate(() => window.__game.ui.openSpellbook(0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/spellbook-${label}.png` });
  await layoutChecks(page, `${label} spellbook`, '.panel-spellbook button:not([disabled])');
  // Tap a locked essence: its hint shows.
  const hint = await page.evaluate(async () => {
    // What is still to find folds into one "N more to find" tile: open it first.
    const more = document.querySelector('.sb-sec-essences .sb-more[aria-expanded="false"]');
    if (more) {
      more.click();
      await new Promise((r) => setTimeout(r, 60));
    }
    const t = document.querySelector('.sb-sec-essences .sb-tile.locked');
    if (!t) return 'no locked tile';
    t.click();
    await new Promise((r) => setTimeout(r, 60));
    return document.querySelector('.sb-sec-essences .sb-hint:not([hidden])')?.textContent || '';
  });
  check(`${label}: a locked essence says where it is found`, hint && hint !== 'no locked tile', hint);
  await page.screenshot({ path: `${OUT}/spellbook-${label}-hint.png` });
  await page.evaluate(() => window.__game.ui.closeAll());
  await context.close();
}

async function desktop() {
  const label = 'desktop';
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, label);
  const info = await startGame(page);
  await page.mouse.move(900, 300);
  await page.waitForTimeout(700);
  const hb = await page.evaluate(() => ({ hotbar: !document.querySelector('.hotbar')?.hidden, slots: document.querySelectorAll('.hslot:not([hidden])').length, cursor: window.__game.canvas.style.cursor }));
  check('desktop: hotbar with slots', hb.hotbar && hb.slots >= 4, JSON.stringify(hb));
  check('desktop: the reticle replaces the cursor over the world', hb.cursor === 'none');
  await page.screenshot({ path: `${OUT}/controls-desktop.png` });

  // 2 casts slot 2 toward the mouse (right of the player), on the key's release.
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(120);
  const k = await page.evaluate(() => {
    const g = window.__game;
    const c = g.magic.fired.slice(-1)[0];
    return { c: c && { slot: c.slot, k: c.k, aim: { x: c.aim.x, y: c.aim.y } }, px: g.player.x, sel: g.ui.hud.weaving.selected };
  });
  check('desktop: number key casts that slot toward the mouse', k.c?.slot === 1 && k.c.aim.x > k.px && k.c.k === 0, JSON.stringify(k));
  check('desktop: number key selects the slot', k.sel === 1);

  // Holding 1 charges the weave: the hotbar slot's ring fills; the release casts it charged.
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(800);
  const hk = await page.evaluate(() => {
    const b = document.querySelectorAll('.hslot')[0];
    return { charging: b.classList.contains('charging'), k: Number(getComputedStyle(b.querySelector('.wbtn-chg')).getPropertyValue('--charge')) };
  });
  await page.screenshot({ path: `${OUT}/controls-desktop-charging.png` });
  await page.waitForTimeout(900);
  await page.keyboard.up('Digit1');
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${OUT}/controls-desktop-release.png` });
  const hf = await page.evaluate(() => window.__game.magic.fired.slice(-1)[0] || null);
  check('desktop: holding a number key charges (the slot ring fills), the release casts it charged', hk.charging && hk.k > 0.2 && hf?.slot === 0 && hf.k >= 0.999, JSON.stringify({ hk, k: hf?.k }));
  await page.waitForTimeout(200);
  const hc = await page.evaluate(() => {
    const b = document.querySelectorAll('.hslot')[0];
    return { cooling: b.classList.contains('cooling') };
  });
  await page.screenshot({ path: `${OUT}/controls-desktop-cooldown.png` });
  check('desktop: the cast slot shows its cooldown sweep', hc.cooling, JSON.stringify(hc));
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(100);

  // Holding 3 (a beam) channels until released.
  const c0 = await page.evaluate(() => (window.__game.magic.calls || []).length);
  await page.keyboard.down('Digit3');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/controls-desktop-beam.png` });
  await page.keyboard.up('Digit3');
  await page.waitForTimeout(120);
  const beam = await page.evaluate((from) => [...new Set((window.__game.magic.calls || []).slice(from).map((c) => c.fn))], c0);
  check('desktop: holding a beam key starts, holds and releases', beam.includes('castStart') && beam.includes('castHold') && beam.includes('castRelease'), beam.join(','));

  // Wheel and Q / R change the selected slot.
  const sel0 = await page.evaluate(() => window.__game.ui.hud.weaving.selected);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(80);
  const sel1 = await page.evaluate(() => window.__game.ui.hud.weaving.selected);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(80);
  const sel2 = await page.evaluate(() => window.__game.ui.hud.weaving.selected);
  check('desktop: wheel and Q cycle the selected weave', sel1 !== sel0 && sel2 === sel0, `${sel0} -> ${sel1} -> ${sel2}`);

  // Right click casts the selected slot; left click swings toward the mouse.
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__game.magic.resetCooldowns?.());
  const n0 = await page.evaluate(() => (window.__game.magic.calls || []).length);
  await page.mouse.click(900, 300, { button: 'right' });
  await page.waitForTimeout(120);
  const rc = await page.evaluate((from) => {
    // The press starts it (a beam pours from there; anything else is cast on the release).
    const c = (window.__game.magic.calls || []).slice(from).find((x) => x.fn === 'castStart');
    return c && { fn: c.fn, slot: c.slot };
  }, n0);
  check('desktop: right click casts the selected weave', rc && rc.slot === sel0, JSON.stringify(rc));
  await page.mouse.move(400, 360);
  await page.mouse.down();
  await page.waitForTimeout(60);
  const swing = await page.evaluate(() => {
    const g = window.__game;
    return { aim: g.input.swingAim() ? { ...g.input.swingAim() } : null, facing: { ...g.player.facing } };
  });
  await page.mouse.up();
  check('desktop: left click aims the sword at the mouse (left of the player)', swing.aim && swing.aim.x < 0, JSON.stringify(swing));

  // Alt + 1 asks Lyra (Follow) — and casts nothing.
  await page.evaluate(() => {
    window.__asked = [];
    window.__game.bus.on('companion_action', (p) => window.__asked.push(p?.name));
    window.__castsBefore = (window.__game.magic.calls || []).length;
  });
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(400);
  const asked = await page.evaluate(() => ({ asked: window.__asked, casts: (window.__game.magic.calls || []).length - window.__castsBefore }));
  // (Follow when she is with you; rejoin when she has wandered off: the same request.)
  check('desktop: Alt + 1 asks Lyra to follow, casting nothing', (asked.asked.includes('follow') || asked.asked.includes('rejoin')) && asked.casts === 0, JSON.stringify(asked));

  // B opens the Spellbook, B closes it.
  await page.mouse.move(900, 300);
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(900);
  const open = await page.evaluate(() => !!document.querySelector('.panel-spellbook'));
  check('desktop: B opens the Spellbook', open);
  await page.screenshot({ path: `${OUT}/spellbook-desktop.png` });
  // Build a weave: pick a shape and add an essence; it saves to the slot.
  const built = await page.evaluate(async () => {
    const g = window.__game;
    const q = (s) => document.querySelector(s);
    const tiles = [...document.querySelectorAll('.sb-sec-shapes .sb-tile:not(.locked)')];
    tiles.find((t) => t.textContent.includes('Throw'))?.click();
    await new Promise((r) => setTimeout(r, 50));
    // Clear the essences, then add one that is not there.
    for (const t of document.querySelectorAll('.sb-sec-essences .sb-tile[aria-pressed="true"]')) {
      t.click();
      await new Promise((r) => setTimeout(r, 30));
    }
    const pick = document.querySelector('.sb-sec-essences .sb-tile:not(.locked)[aria-pressed="false"]');
    const want = pick?.querySelector('.sb-tile-name')?.textContent || '';
    pick?.click();
    await new Promise((r) => setTimeout(r, 50));
    const slot = g.ui.hud.spellbook.slot;
    return { slot, want, weave: g.magic.slots[slot], name: q('.sb-name')?.textContent, note: q('.sb-note')?.textContent };
  });
  check('desktop: the Spellbook saves a weave into its slot', built.weave?.shape === 'throw' && built.weave.essences.length === 1 && built.want.toLowerCase().includes(built.weave.essences[0]), JSON.stringify(built));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/spellbook-desktop-built.png` });
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => !document.querySelector('.panel-spellbook'));
  check('desktop: B closes it again', closed);
  await layoutChecks(page, 'desktop', '.hslot:not([hidden])');
  await context.close();
}

try {
  await phone('land844', 844, 390);
  await phone('land667', 667, 375);
  await phone('port390', 390, 844);
  await desktop();
} catch (err) {
  errors.push(`controls check crashed: ${err.stack || err}`);
}
await browser.close();
server.close();
const failed = checks.filter((c) => !c.ok);
if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of errors) console.error(' - ' + e);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || errors.length ? 1 : 0);
