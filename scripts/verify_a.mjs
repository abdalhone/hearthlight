// Round 14b, independent verifier A: the author's items played by hand-like input in the built
// game, on a phone held sideways (844x390, by touch; 4x CPU for the fight), a phone upright
// (390x844, by touch) and a computer (1280x720, keys and mouse). Claude is offline.
//
// 27  Casting stops you, in a real fight (the author: "I can move while I'm doing spells; it
//     should stop me"): three wolves come at you. Run and tap the Spark: you stop for the pose,
//     then run on. Hold to charge and push the stick / WASD: you turn, you do not walk. Roll:
//     the charge breaks. A beam held: you stand. The computer's other ways to cast (the right
//     button, a click on the hotbar) plant you too; the phone's drag-to-aim does as well.
//     No frame of a cast lets the feet move by walking.
//
//   node scripts/verify_a.mjs [--out DIR] [--only sideways,upright,desktop] [--items 27]
//   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/verify_a';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const ITEMS = argv.includes('--items') ? new Set(argv[argv.indexOf('--items') + 1].split(',').map(Number)) : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true, throttle: 4 },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
].filter((s) => !ONLY || ONLY.includes(s.tag));

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
let checks = 0;
const check = (ok, label, info = '') => {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${String(info).slice(0, 1200)}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

function pageSetup() {
  const g = window.__game;
  try {
    g.story?.skip?.();
  } catch {
    /* no story */
  }
  const u = g.ui;
  for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
  u?.coach?.stop?.();
  g.flags.talkHintShown = true;
  g.flags.finisherWarned = true;
  g.flags.finisherWarnedLyra = true;
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  window.__ev = [];
  for (const t of ['cast_broken', 'cast_stand', 'spell_cast', 'damage'])
    g.bus.on(t, (p) => window.__ev.push({ t, why: p?.why ?? null, held: p?.held ?? null, player: p?.caster ? p.caster === g.player : null, toPlayer: p?.target === g.player, fromPlayer: p?.source === g.player, amount: p?.amount ?? null }));
  window.__toasts = [];
  window.__fizz = [];
  if (!g.magic.__wrapped) {
    const fx = g.magic.fx.bind(g.magic);
    g.magic.fx = (kind, p) => {
      if (kind === 'fizzle') window.__fizz.push(String(p?.reason));
      return fx(kind, p);
    };
    g.magic.__wrapped = true;
  }
  if (!g.ui.__wrapped) {
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.ui.__wrapped = true;
  }
  window.__at = (e, tx, ty, still = true) => {
    e.x = tx * 16 + 8;
    e.y = ty * 16 + 10;
    e.walker?.stop?.();
    if (e.r) e.r.key = null;
    if (still) e.think = () => {};
  };
  window.__away = (keep = []) => {
    for (const e of g.villageLife.villagers()) if (!keep.includes(e.id)) window.__at(e, 20 + Math.random() * 4, 52);
    const L = g.companion;
    if (L && !L.dead && !keep.includes('lyra')) {
      L.x = 150 * 16;
      L.y = 112 * 16;
      L._heldController = L._heldController || L.controller;
      L.controller = null;
    }
  };
  // One row per drawn frame: where the feet are, what holds them, and whether a blow shoved.
  window.__sample = (on) => {
    const P = g.player;
    if (!on) {
      window.__sampling = false;
      return window.__samples || [];
    }
    window.__samples = [];
    window.__sampling = true;
    const tick = (t) => {
      window.__samples.push({ t, x: P.x, y: P.y, vx: P.vel.x, vy: P.vel.y, kx: P.knock?.x || 0, ky: P.knock?.y || 0, plant: P.castPlantT || 0, st: g.magic?.castingState?.(P) || null, roll: !!P.rolling, dir: P.dir, state: P.state, hurt: P.state === 'hurt' || P.lockTime > 0 });
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return [];
  };
}

// The feet moved by walking while held: frames where a cast holds you, the step between them,
// leaving out a frame where a blow's knockback (not the legs) shoved you.
// The walk is the velocity the legs give (vel); a bite's knockback or a wolf's shoulder moves
// the body without it, so `walked` counts only steps taken with the legs going.
function walkedWhileHeld(samples) {
  let walked = 0;
  let frames = 0;
  let maxV = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a.st || !b.st || a.roll || b.roll) continue;
    frames++;
    const v = Math.hypot(b.vx, b.vy);
    maxV = Math.max(maxV, v);
    const shoved = Math.hypot(a.kx, a.ky) > 0 || Math.hypot(b.kx, b.ky) > 0;
    if (shoved || v < 0.01) continue;
    walked += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return { walked, frames, maxV };
}

async function play(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const item = async (n, title, fn) => {
    if (ITEMS && !ITEMS.has(n)) return;
    console.log(`--- [${tag}] item ${n}: ${title}`);
    try {
      await fn();
    } catch (err) {
      check(false, `[${tag}] ${n} ran to the end`, err?.stack || String(err));
    }
  };

  // ---- fingers (phones) and keys (computer)
  const fingers = new Map();
  const touch = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
  const fingerDown = async (id, x, y) => {
    fingers.set(id, { x: Math.round(x), y: Math.round(y) });
    await touch('touchStart');
  };
  const fingerMove = async (id, x, y) => {
    fingers.set(id, { x: Math.round(x), y: Math.round(y) });
    await touch('touchMove');
  };
  const fingerUp = async (id) => {
    const p = fingers.get(id);
    fingers.delete(id);
    if (p) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  };
  const allUp = async () => {
    fingers.clear();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
  };
  const WEAVE = (slot) => `.tcluster .wbtn[data-slot="${slot}"]`;
  const weaveDown = async (slot = 0) => {
    if (!S.phone) return page.keyboard.down(String(slot + 1));
    const r = await rectOf(WEAVE(slot));
    if (!r) return false;
    await fingerDown(7, r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  const weaveUp = async (slot = 0) => (S.phone ? fingerUp(7) : page.keyboard.up(String(slot + 1)));
  // The stick (or WASD) pushed toward (dx, dy) in -1..1.
  const keysFor = (dx, dy) => [dx > 0.3 ? 'd' : dx < -0.3 ? 'a' : null, dy > 0.3 ? 's' : dy < -0.3 ? 'w' : null].filter(Boolean);
  let heldKeys = [];
  const moveOn = async (dx = 1, dy = 0) => {
    if (!S.phone) {
      heldKeys = keysFor(dx, dy);
      for (const k of heldKeys) await page.keyboard.down(k);
      return true;
    }
    const z = await rectOf('.stick-zone');
    if (!z) return false;
    const at = { x: z.x + z.w * 0.4, y: z.y + z.h * 0.6 };
    await fingerDown(8, at.x, at.y);
    for (let i = 1; i <= 4; i++) {
      await fingerMove(8, at.x + dx * i * 12, at.y + dy * i * 12);
      await wait(30);
    }
    return true;
  };
  const moveOff = async () => {
    if (!S.phone) {
      for (const k of heldKeys) await page.keyboard.up(k);
      heldKeys = [];
      return;
    }
    await fingerUp(8);
  };
  const roll = async () => {
    if (!S.phone) return page.keyboard.press('k');
    const r = await rectOf('.tbtn-dodge');
    if (!r) return false;
    await fingerDown(9, r.x + r.w / 2, r.y + r.h / 2);
    await wait(70);
    await fingerUp(9);
    return true;
  };
  const throttle = async (on) => {
    if (!S.throttle) return;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: on ? S.throttle : 1 });
  };

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(700);
  await ev(pageSetup);
  await wait(200);

  // ================================================================ 27: casting stops you
  await item(27, 'casting stops you, in a real fight', async () => {
    // A mid-game weaver at the meadow: the Spark in slot 1, a beam in slot 2; three wolves.
    const arena = (n = 3) =>
      ev((n) => {
        const g = window.__game;
        const P = g.player;
        window.__away();
        for (const e of g.entities.all()) if (e.type === 'actor' && e.species && !e.profile && e !== P && Math.hypot(e.x - P.x, e.y - P.y) < 900) e.removed = true;
        window.__at(P, 100, 61, false);
        g.clock.skipTo?.(12);
        g.magic.unlock?.('shapes', 'beam', 'verify');
        g.magic.unlock?.('essences', 'fire', 'verify');
        g.magic.setSlot(0, { shape: 'bolt', essences: ['fire'] });
        g.magic.setSlot(1, { shape: 'beam', essences: ['fire'] });
        g.magic.selected = 0;
        const C = g.entities.all().find((e) => e.species && e.type === 'actor' && !e.boss && !e.profile)?.constructor;
        window.__wolves = [];
        for (let i = 0; i < n && C; i++) {
          const w = g.entities.add(new C(g, 'wolf', { x: P.x + 190 + i * 16, y: P.y - 24 + i * 24 }));
          w.aggroRadius = 600;
          w.leashRadius = 900;
          window.__wolves.push(w);
        }
        P.maxHp = Math.max(P.maxHp, 240);
        P.hp = P.maxHp;
        P.vel.x = P.vel.y = 0;
        P.facing = { x: 1, y: 0 };
        P.dir = 'right';
        g.magic.mana.max = Math.max(g.magic.mana.max, 200);
        g.magic.mana.cur = g.magic.mana.max;
        g.magic.resetCooldowns?.();
        g.camera.snap?.();
        return { wolves: window.__wolves.length, speed: P.speed * (P.speedMul || 1) };
      }, n);
    await throttle(true);
    // (a) Run, tap the Spark: the feet stop for the pose, then run on (the wolves not yet out,
    // so nothing but the weave stops you).
    const a0 = await arena(0);
    await ev(() => {
      window.__game.flags.standHintShown = false;
    });
    await moveOn(1, 0);
    await wait(500);
    await ev(() => window.__sample(true));
    await wait(200);
    await weaveDown(0);
    await wait(70);
    await weaveUp(0);
    await wait(120);
    await shot('27-fight-tap-plant');
    await wait(800);
    let s = await ev(() => window.__sample(false));
    const planted = s.filter((r) => r.plant > 0);
    const plantMs = planted.length ? planted.at(-1).t - planted[0].t + planted.at(-1).plant * 1000 : 0;
    const w1 = walkedWhileHeld(s);
    const tail = s.filter((r) => r.t > (planted.at(-1)?.t ?? 0) + 250 && !r.st && !r.hurt);
    const runV = tail.length >= 2 ? Math.hypot(tail.at(-1).x - tail[0].x, tail.at(-1).y - tail[0].y) / ((tail.at(-1).t - tail[0].t) / 1000) : 0;
    const casts1 = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
    check(casts1 >= 1, `[${tag}] 27 a tap of the Spark flies`, `${casts1} casts`);
    check(planted.length >= 1 && plantMs >= 150 && plantMs <= 560, `[${tag}] 27 a tap while running plants you for the pose`, `${plantMs.toFixed(0)} ms over ${planted.length} frames`);
    check(w1.walked < 0.75, `[${tag}] 27 ... not a step while it leaves the hands`, `${w1.walked.toFixed(2)} px over ${w1.frames} held frames`);
    check(runV > a0.speed * 0.8 || tail.length < 2, `[${tag}] 27 ... then you run on`, `${runV.toFixed(1)} of ${a0.speed.toFixed(1)} px/s over ${tail.length} frames`);
    await moveOff();
    await wait(200);
    const a1 = await arena(3);
    check(a1.wolves === 3, `[${tag}] 27 three wolves come`);
    await wait(500);

    // (b) Hold to charge while the wolves close in; push the stick / WASD the other way: you
    // turn to face it, you do not walk.
    await ev(() => {
      const g = window.__game;
      g.magic.resetCooldowns?.();
      g.magic.mana.cur = g.magic.mana.max;
    });
    const p0 = await ev(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
    await weaveDown(0);
    await wait(160);
    await moveOn(-1, 0.4);
    await ev(() => window.__sample(true));
    await wait(1100);
    await shot('27-fight-charge-push');
    s = await ev(() => window.__sample(false));
    const ch = await ev((p0) => {
      const g = window.__game;
      const P = g.player;
      const h = g.magic.holdOf(P);
      return { st: g.magic.castingState(P), k: h?.k ?? 0, dir: P.dir, moved: Math.hypot(P.x - p0.x, P.y - p0.y), hint: window.__toasts.find((t) => /stand still to weave/i.test(t)) || null, near: window.__wolves.filter((w) => !w.removed && w.hp > 0 && Math.hypot(w.x - P.x, w.y - P.y) < 80).length };
    }, p0);
    const w2 = walkedWhileHeld(s);
    check(ch.st === 'charge' && ch.k > 0.25, `[${tag}] 27 the charge gathers while held`, JSON.stringify(ch));
    check(w2.walked < 0.75 && w2.maxV < 1, `[${tag}] 27 pushing ${S.phone ? 'the stick' : 'A+S'} while it gathers: no step`, `legs ${w2.maxV.toFixed(2)} px/s at most, ${w2.walked.toFixed(2)} px walked over ${w2.frames} frames (${ch.moved.toFixed(1)} px in all, bites' knockback included)`);
    check(ch.dir === 'left', `[${tag}] 27 ... you turn to face the push`, ch.dir);
    check(!!ch.hint, `[${tag}] 27 the stance is said: "You stand still to weave. Roll to break off."`, ch.hint);
    // (c) Roll: the charge breaks, and the roll carries you.
    const r0 = await ev(() => {
      const P = window.__game.player;
      return { x: P.x, y: P.y, state: P.state, lock: +P.lockTime.toFixed(2), st: +P.stateTime.toFixed(2), cd: +P.dodgeCd.toFixed(2) };
    });
    await roll();
    await wait(140);
    const rb = await ev(() => {
      const g = window.__game;
      return { rolling: g.player.rolling, hold: !!g.magic.holdOf(g.player), broken: window.__ev.some((e) => e.t === 'cast_broken' && e.why === 'roll' && e.held) };
    });
    await wait(500);
    const r1 = await ev(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
    check(rb.broken && !rb.hold, `[${tag}] 27 a roll breaks the charge`, JSON.stringify({ ...rb, before: r0 }));
    check(Math.hypot(r1.x - r0.x, r1.y - r0.y) > 10, `[${tag}] 27 ... and you roll clear`, `${Math.hypot(r1.x - r0.x, r1.y - r0.y).toFixed(1)} px`);
    await moveOff();
    await weaveUp(0);
    await wait(250);

    // (d) Hold the beam (slot 2) while pushing: you stand while it pours.
    await ev(() => {
      const g = window.__game;
      g.magic.resetCooldowns?.();
      g.magic.mana.cur = g.magic.mana.max;
    });
    await moveOn(0, 1);
    await wait(300);
    await weaveDown(1);
    await ev(() => window.__sample(true));
    await wait(900);
    await shot('27-fight-beam');
    s = await ev(() => window.__sample(false));
    await weaveUp(1);
    await moveOff();
    const w3 = walkedWhileHeld(s);
    const beamFrames = s.filter((r) => r.st === 'beam' || r.st === 'charge').length;
    check(beamFrames >= 5, `[${tag}] 27 the beam pours while held`, `${beamFrames} frames`);
    check(w3.walked < 0.75, `[${tag}] 27 ... and you stand while it pours`, `${w3.walked.toFixed(2)} px walked over ${w3.frames} frames`);
    await wait(300);

    // (e) The computer's other ways to cast: the right button, and a click on the hotbar.
    if (!S.phone) {
      for (const how of ['right', 'hotbar']) {
        await ev(() => {
          const g = window.__game;
          g.magic.resetCooldowns?.();
          g.magic.mana.cur = g.magic.mana.max;
          g.magic.selected = 0;
        });
        await moveOn(0, -1);
        await wait(450);
        await ev(() => window.__sample(true));
        await wait(100);
        const before = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
        if (how === 'right') {
          const wf = await ev(() => {
            const g = window.__game;
            const w = window.__wolves.find((x) => !x.removed && x.hp > 0);
            const p = w ? g.renderer.worldToCss(w.x, w.y - 8) : g.renderer.worldToCss(g.player.x + 60, g.player.y);
            const r = g.canvas.getBoundingClientRect();
            return { x: r.left + p.x, y: r.top + p.y };
          });
          await page.mouse.move(wf.x, wf.y);
          globalThis.__rtarget = await ev((wf) => {
            const e = document.elementFromPoint(wf.x, wf.y);
            return e ? `${e.tagName}.${e.className}` : null;
          }, wf);
          await page.mouse.down({ button: 'right' });
          await wait(60);
          await page.mouse.up({ button: 'right' });
        } else {
          const hs = await rectOf('.hotbar .hslot');
          if (hs) await page.mouse.click(hs.x + hs.w / 2, hs.y + hs.h / 2);
        }
        await wait(600);
        s = await ev(() => window.__sample(false));
        await moveOff();
        const after = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
        const why = await ev(() => {
          const P = window.__game.player;
          return { toasts: window.__toasts.slice(-3), fizzles: (window.__fizz || []).slice(-3), state: P.state, hp: Math.round(P.hp), downed: !!P.downed, dis: !!P.statusFlags?.disabled, sel: window.__game.magic.selected, chat: !!window.__game.ui.chat?.isOpen?.(), modal: !!window.__game.ui.isModalOpen?.() };
        });
        const pl = s.filter((r) => r.plant > 0);
        const w4 = walkedWhileHeld(s);
        check(after > before, `[${tag}] 27 ${how === 'right' ? 'the right button' : 'a click on the hotbar'} casts`, `${after - before} ${JSON.stringify(why)} target=${how === 'right' ? globalThis.__rtarget : ''}`);
        check(pl.length >= 2 && w4.walked < 0.75, `[${tag}] 27 ... and plants you while W is held`, `${pl.length} planted frames, ${w4.walked.toFixed(2)} px walked`);
        await wait(250);
      }
    } else {
      // The phone's drag-to-aim on the weave button, with the stick held: no step either.
      await ev(() => {
        const g = window.__game;
        g.magic.resetCooldowns?.();
        g.magic.mana.cur = g.magic.mana.max;
      });
      await moveOn(0, -1);
      await wait(400);
      const r = await rectOf(WEAVE(0));
      await ev(() => window.__sample(true));
      const before = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
      await fingerDown(7, r.x + r.w / 2, r.y + r.h / 2);
      for (let i = 1; i <= 6; i++) {
        await fingerMove(7, r.x + r.w / 2 - i * 14, r.y + r.h / 2 - i * 6);
        await wait(40);
      }
      await wait(250);
      await shot('27-drag-aim');
      await fingerUp(7);
      await wait(500);
      s = await ev(() => window.__sample(false));
      await moveOff();
      const after = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
      const w5 = walkedWhileHeld(s);
      check(after > before, `[${tag}] 27 drag-to-aim on the weave button casts`, `${after - before}`);
      check(w5.walked < 0.75, `[${tag}] 27 ... and you stand while you aim it, the stick held`, `${w5.walked.toFixed(2)} px walked over ${w5.frames} frames`);
    }

    // (f) Fight it out by input alone for a while (three fresh wolves): tap and charge at the wolves, kiting by the
    // stick between casts; the feet never walk while a weave holds them.
    await arena(3);
    await ev(() => {
      window.__ev = window.__ev.filter((e) => e.t !== 'spell_cast');
    });
    await ev(() => window.__sample(true));
    const t0 = Date.now();
    let dir = 1;
    while (Date.now() - t0 < (S.throttle ? 16000 : 10000)) {
      const st = await ev(() => {
        const g = window.__game;
        const P = g.player;
        g.magic.mana.cur = Math.max(g.magic.mana.cur, 40);
        if (P.hp < 60) P.hp = P.maxHp;
        const live = window.__wolves.filter((w) => !w.removed && w.hp > 0 && !w.dead);
        if (!live.length) return null;
        const n = live.reduce((a, b) => (Math.hypot(a.x - P.x, a.y - P.y) < Math.hypot(b.x - P.x, b.y - P.y) ? a : b));
        return { dx: n.x - P.x, dy: n.y - P.y, live: live.length, canRoll: !(P.dodgeCd > 0) };
      });
      if (!st) break;
      const d = Math.hypot(st.dx, st.dy) || 1;
      // Teeth at your throat: roll away; else turn to them and weave (a tap, or a charge).
      if (d < 40 && st.canRoll) {
        await moveOn(-st.dx / d, -st.dy / d);
        await wait(40);
        await roll();
        await wait(380);
        await moveOff();
      } else {
        await moveOn(st.dx / d, st.dy / d);
        await wait(70);
        await weaveDown(0);
        await wait(dir > 0 ? 80 : 650);
        await weaveUp(0);
        await moveOff();
        await wait(260);
        dir = -dir;
      }
    }
    s = await ev(() => window.__sample(false));
    await allUp().catch(() => {});
    const fight = await ev(() => ({
      casts: window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length,
      wolvesLeft: window.__wolves.filter((w) => !w.removed && w.hp > 0 && !w.dead).length,
      hp: Math.round(window.__game.player.hp),
      down: !!window.__game.player.downed,
    }));
    const w6 = walkedWhileHeld(s);
    const fps = s.length >= 2 ? (s.length - 1) / ((s.at(-1).t - s[0].t) / 1000) : 0;
    check(w6.walked < 1.5 && w6.maxV < 1, `[${tag}] 27 in the fight, no step while a weave holds you`, `legs ${w6.maxV.toFixed(2)} px/s at most, ${w6.walked.toFixed(2)} px over ${w6.frames} held frames; ${JSON.stringify(fight)}`);
    check(fight.casts >= 3, `[${tag}] 27 the fight was fought with weaves`, JSON.stringify(fight));
    if (S.throttle) check(fps >= 12, `[${tag}] 27 4x CPU: the fight stays smooth`, `${fps.toFixed(1)} fps`);
    await shot('27-fight-end');
    await throttle(false);
  });

  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 5).join(' | '));
  await ctx.close();
}

for (const S of SIZES) await play(S);
await browser.close();
server.close();
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
