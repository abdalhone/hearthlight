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


  // ================================================================ 5: a click on a person (D3)
  await item(5, 'a click on a calm person: the sword, forgiven once', async () => {
    if (S.phone) {
      // A tap on a person does nothing at all (no chat, no swing).
      const r = await ev(() => {
        const g = window.__game;
        const sq = g.locations.get('town_square').center;
        window.__away(['tobias']);
        const t = g.entities.get('tobias');
        window.__at(t, Math.floor(sq.x / 16), Math.floor(sq.y / 16));
        g.player.x = t.x + 40;
        g.player.y = t.y;
        g.camera.snap?.();
        return { hp: t.hp };
      });
      await wait(500);
      Object.assign(r, await ev(() => {
        const g = window.__game;
        const t = g.entities.get('tobias');
        const p = g.renderer.worldToCss(t.x, t.y - 10);
        const c = g.canvas.getBoundingClientRect();
        return { x: c.left + p.x, y: c.top + p.y };
      }));
      await page.touchscreen.tap(r.x, r.y);
      await wait(500);
      const after = await ev(() => ({ hp: window.__game.entities.get('tobias').hp, chat: window.__game.ui.chat.isOpen?.() }));
      check(after.hp === r.hp && !after.chat, `[${tag}] 5 a tap on Tobias: no chat, no blow`, JSON.stringify(after));
      return;
    }
    const at = await ev(() => {
      const g = window.__game;
      g.flags.talkHintShown = false;
      g.flags.habitForgiven = false;
      g.clock.skipTo?.(12);
      const sq = g.locations.get('town_square').center;
      window.__away(['tobias', 'garrick']);
      const t = g.entities.get('tobias');
      window.__at(t, Math.floor(sq.x / 16), Math.floor(sq.y / 16));
      const gar = g.entities.get('garrick');
      window.__at(gar, Math.floor(sq.x / 16) + 1, Math.floor(sq.y / 16) + 3);
      gar.faceToward?.(t.x, t.y);
      g.player.x = t.x + 18;
      g.player.y = t.y;
      g.player.facing = { x: -1, y: 0 };
      g.player.dir = 'left';
      g.camera.snap?.();
      window.__toasts.length = 0;
      window.__crimes = [];
      g.bus.on('crime', (p) => window.__crimes.push(p.kind));
      window.__blows = [];
      g.bus.on('damage', (p) => {
        if (p?.target?.id === 'tobias' && p.source === g.player) window.__blows.push(!!p.accident);
      });
      window.__yelps = [];
      const say = g.bubbles.say.bind(g.bubbles);
      g.bubbles.say = (e, text, o) => {
        if (e?.id === 'tobias') window.__yelps.push(text);
        return say(e, text, o);
      };
      return { hp: t.hp };
    });
    await wait(500);
    Object.assign(at, await ev(() => {
      const g = window.__game;
      const t = g.entities.get('tobias');
      const p = g.renderer.worldToCss(t.x, t.y - 10);
      const c = g.canvas.getBoundingClientRect();
      return { x: c.left + p.x, y: c.top + p.y };
    }));
    const tgt = await ev((at) => {
      const e = document.elementFromPoint(at.x, at.y);
      return e ? `${e.tagName}.${e.className}` : null;
    }, at);
    await page.mouse.move(at.x, at.y);
    await wait(60);
    await page.mouse.click(at.x, at.y);
    await wait(700);
    const one = await ev(() => ({ attacks: window.__game.player.combo, st: window.__game.player.state, state: window.__game.state, input: window.__game.input.enabled, hp: window.__game.entities.get('tobias').hp, crimes: window.__crimes.slice(), yelps: window.__yelps.slice(), toasts: window.__toasts.slice(), crime: window.__game.combat.hasCrime(window.__game.player), chat: window.__game.ui.chat.isOpen?.() }));
    check(one.hp < at.hp && !one.chat, `[${tag}] 5 a click on Tobias is the sword, not talk`, JSON.stringify({ ...one, tgt, at }));
    check(!one.crime && one.crimes.length === 0, `[${tag}] 5 the first such blow is forgiven (no crime)`, JSON.stringify(one.crimes));
    check(one.yelps.some((y) => /Watch it|Careful|Mind where|Not at me/.test(y)), `[${tag}] 5 ... he yelps "Watch it!"`, JSON.stringify(one.yelps));
    check(one.toasts.some((t) => /T talks to whoever is in front of you\. Striking people is a crime/.test(t)), `[${tag}] 5 ... and the hint is said once`, JSON.stringify(one.toasts));
    await shot('05-habit-forgiven');
    await wait(900);
    await ev(() => {
      const g = window.__game;
      const t = g.entities.get('tobias');
      t.invuln = 0;
      t.fightTarget = null;
      g.player.x = t.x + 18;
      g.player.y = t.y;
      g.player.facing = { x: -1, y: 0 };
      g.player.dir = 'left';
    });
    await wait(400);
    const at2 = await ev(() => {
      const g = window.__game;
      const t = g.entities.get('tobias');
      const p = g.renderer.worldToCss(t.x, t.y - 10);
      const c = g.canvas.getBoundingClientRect();
      return { x: c.left + p.x, y: c.top + p.y };
    });
    await page.mouse.click(at2.x, at2.y);
    await wait(700);
    const two = await ev(() => ({ blows: window.__blows.slice(), crimes: window.__crimes.slice(), crime: window.__game.combat.hasCrime(window.__game.player), secret: !!window.__game.murder?.isSecret?.('tobias') }));
    check(two.blows.length >= 2 && two.blows[0] === true && two.blows.slice(1).every((a) => a === false), `[${tag}] 5 the second click is a real blow (a crime if seen, his to tell if not)`, JSON.stringify(two));
    await shot('05-second-is-crime');
  });

  // ================================================================ TOP PRIORITY B: the HUD
  const vis = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return false;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, sel);
  const hudState = () =>
    ev(() => {
      const g = window.__game;
      const v = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return false;
        for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const walk = (n, out) => {
        if (n.nodeType === 3) out.push(n.textContent);
        else if (n.nodeType === 1) {
          const cs = getComputedStyle(n);
          if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return out;
          for (const c of n.childNodes) walk(c, out);
        }
        return out;
      };
      const hud = document.querySelector('.hud');
      g.ui.openMap();
      const dots = g.ui.worldMap.marks().filter((x) => x.kind === 'companion').map((x) => x.label);
      g.ui.closeModal(g.ui.worldMap.panel, true);
      return {
        holder: g.party?.holderId || null,
        card: v('.companion-card'),
        cardText: document.querySelector('.companion-card')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        cmdbar: v('.cmdbar'),
        orders: v('.orders-btn'),
        text: hud ? walk(hud, []).join(' ').replace(/\s+/g, ' ') : '',
        badge: g.bubbles?._holder?.id || null,
        dots,
        talk: v('.hud-talk') || v('.tbtn-interact'),
      };
    });
  await item(30, 'TOP PRIORITY B: the HUD is not built around Lyra', async () => {
    const prep = () =>
      ev(() => {
        const g = window.__game;
        g.clock.skipTo?.(12);
        const sq = g.locations.get('town_square').center;
        g.player.x = sq.x + 60;
        g.player.y = sq.y + 40;
        g.camera.snap?.();
        g.ui.closeAll?.();
        document.querySelectorAll('.toast').forEach((e) => e.remove());
      });
    // (1) With Lyra, the new game's companion.
    await prep();
    await ev(() => {
      const g = window.__game;
      const L = g.companion;
      if (L._heldController) L.controller = L._heldController;
      L.x = g.player.x - 20;
      L.y = g.player.y;
    });
    await wait(700);
    let h = await hudState();
    check(h.holder === 'lyra' && h.card && /Lyra/.test(h.cardText), `[${tag}] B with Lyra: her card`, JSON.stringify({ holder: h.holder, card: h.cardText.slice(0, 80) }));
    await shot('B1-with-lyra');
    // (2) With Bram: his card, no "Lyra" anywhere on the HUD, and no Lyra dot on the map.
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.x = g.player.x + 24;
      b.y = g.player.y;
      b.walker?.stop?.();
      b.opinionOfPlayer = 85;
      b.wrongedDay = null;
      const r = g.party.invite(b);
      window.__inv = r?.decision || r;
      window.__away(['bram']);
    });
    await wait(900);
    h = await hudState();
    check(h.holder === 'bram' && h.card && /Bram/.test(h.cardText), `[${tag}] B with Bram: his card`, JSON.stringify({ holder: h.holder, card: h.cardText.slice(0, 90), inv: await ev(() => window.__inv) }));
    check(!/Lyra/.test(h.text), `[${tag}] B with Bram: no "Lyra" on the HUD`, h.text.match(/.{0,40}Lyra.{0,40}/)?.[0] || '');
    check(!h.dots.includes('Lyra') && (h.dots.length === 0 || h.dots.every((d) => /Bram/.test(d))), `[${tag}] B with Bram: the map's companion dot is his`, JSON.stringify(h.dots));
    await shot('B2-with-bram');
    // (3) Alone: no card, no Ask bar, no orders, no badge, no dot; Talk still there.
    await ev(() => {
      const g = window.__game;
      g.party.release('dismissed');
      const a = g.companion.mind.autonomy;
      a.setCompanionship('apart', 'Off on my own day.', { silent: true });
      window.__away();
    });
    await wait(900);
    h = await hudState();
    check(!h.holder && !h.card && !h.cmdbar && !h.orders && !h.badge && h.dots.length === 0, `[${tag}] B alone: an empty slot (no card, Ask bar, orders, badge, dot)`, JSON.stringify({ ...h, text: undefined }));
    check(!/Lyra/.test(h.text), `[${tag}] B alone: no "Lyra" on the HUD`, h.text.match(/.{0,40}Lyra.{0,40}/)?.[0] || '');
    check(h.talk, `[${tag}] B alone: a Talk control is there`);
    await shot('B3-alone');
    // (4) After Lyra cut ties: the same empty slot, and nothing of hers pinned.
    await ev(() => {
      const g = window.__game;
      const L = g.companion;
      L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
      L.x = g.player.x + 12 * 16;
      L.y = g.player.y;
    });
    await wait(1200);
    h = await hudState();
    check(!h.holder && !h.card && !h.cmdbar && !h.orders && h.dots.length === 0, `[${tag}] B after Lyra cut ties: the slot is empty`, JSON.stringify({ ...h, text: undefined }));
    check(!/Lyra/.test(h.text), `[${tag}] B after Lyra cut ties: no "Lyra" on the HUD`, h.text.match(/.{0,40}Lyra.{0,40}/)?.[0] || '');
    await shot('B4-after-cut-ties');
    // Bram again while she is gone: his card; Tab (or a card tap) opens People at him.
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.x = g.player.x + 24;
      b.y = g.player.y;
      g.party.invite(b);
    });
    await wait(700);
    if (S.phone) {
      const r = await rectOf('.companion-card');
      if (r) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    } else await page.keyboard.press('Tab');
    await wait(700);
    const ppl = await ev(() => {
      const P = document.querySelector('.panel-people');
      const sel = P?.querySelector('[aria-selected="true"], .selected, .active, .on');
      return { open: !!P, sel: (sel?.textContent || '').replace(/\s+/g, ' ').slice(0, 60), text: (P?.querySelector('.panel-body')?.textContent || '').replace(/\s+/g, ' ').slice(0, 200) };
    });
    check(ppl.open && /Bram/.test(ppl.sel + ppl.text), `[${tag}] B ${S.phone ? 'a tap on his card' : 'Tab'} opens People at Bram`, JSON.stringify(ppl));
    await shot('B5-people-bram');
    const close = await rectOf('.panel-people .panel-close');
    check(!!close && close.w >= 44 && close.h >= 44, `[${tag}] B People closes with a finger-sized ✕`, close ? `${close.w}x${close.h}` : 'none');
    if (close) {
      if (S.phone) await page.touchscreen.tap(close.x + close.w / 2, close.y + close.h / 2);
      else await page.mouse.click(close.x + close.w / 2, close.y + close.h / 2);
    }
    await wait(300);
    await ev(() => window.__game.party.release('dismissed'));
  });

  // ================================================================ 23: saves, mid-scene
  const reload = async () => {
    await ev(async () => {
      await window.__game.save.save('verify_a');
    });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
    const ok = await ev(async () => !!(await window.__game.continueGame()));
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 }).catch(() => {});
    await wait(700);
    await ev(pageSetup);
    return ok;
  };
  await item(23, 'saves: with Bram, mid-parting, a year on, mid-hunt', async () => {
    // (a) Bram walks with you; save, reload: he still does, and walks after you.
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo?.(11);
      const sq = g.locations.get('town_square').center;
      g.player.x = sq.x + 60;
      g.player.y = sq.y + 40;
      const b = g.entities.get('bram');
      b.x = g.player.x + 24;
      b.y = g.player.y;
      b.opinionOfPlayer = 85;
      b.wrongedDay = null;
      g.party.invite(b);
    });
    await wait(400);
    const h0 = await ev(() => window.__game.party.holderId);
    let ok = await reload();
    const a = await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      const P = g.player;
      P.x += 90;
      g.camera.snap?.();
      return { holder: g.party.holderId, duty: !!b.duty, d0: Math.round(Math.hypot(b.x - P.x, b.y - P.y)) };
    });
    await wait(3000);
    const a2 = await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      return { d1: Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y)), card: document.querySelector('.companion-card')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) || '' };
    });
    check(ok && h0 === 'bram' && a.holder === 'bram' && a.duty, `[${tag}] 23 with Bram: reloaded, he still walks with you`, JSON.stringify({ h0, ...a }));
    check(a2.d1 < a.d0 - 30, `[${tag}] 23 ... and walks after you`, JSON.stringify({ ...a, ...a2 }));
    if (!S.phone) check(/Bram/.test(a2.card), `[${tag}] 23 ... his card on the HUD`, a2.card);
    await shot('23-bram-reloaded');
    await ev(() => window.__game.party.release('dismissed'));
    // (b) Lyra's parting scene, saved mid-scene: it ends on load, the letter is there, the
    // chat to her is open, and nothing is stuck.
    await ev(() => {
      const g = window.__game;
      const L = g.companion;
      if (L._heldController) L.controller = L._heldController;
      L.x = g.player.x - 40;
      L.y = g.player.y;
      g.party.release?.('dismissed');
      L.mind.autonomy.setCompanionship('left', 'I need to walk my own road for a while.', { cause: 'trust' });
    });
    await wait(2500);
    const mid = await ev(() => {
      const g = window.__game;
      const pa = g.companion.mind.autonomy.parting;
      return { active: !!pa?.active, phase: pa?.st?.phase || null, cs: g.companion.mind.companionship };
    });
    await shot('23-parting-mid');
    ok = await reload();
    await wait(800);
    const b = await ev(() => {
      const g = window.__game;
      const pa = g.companion.mind.autonomy.parting;
      return { ok: true, active: !!pa?.active, cs: g.companion.mind.companionship, letter: !!g.flags.lyra_letter, inBag: !!g.player.inventory?.has?.('lyra_letter'), holder: g.party.holderId, state: g.state };
    });
    check(mid.active, `[${tag}] 23 the parting scene was playing when saved`, JSON.stringify(mid));
    check(ok && !b.active && b.cs === 'left' && b.state === 'playing', `[${tag}] 23 reloaded mid-parting: the scene is over, she has left`, JSON.stringify(b));
    check(b.letter, `[${tag}] 23 ... and her letter is there (bag or table)`, JSON.stringify(b));
    check(b.holder !== 'lyra', `[${tag}] 23 ... and she does not hold the companion slot`, String(b.holder));
    await shot('23-parting-reloaded');
    // (c) A year on: the day, the ages and Tansy grown come back.
    const y0 = await ev(() => {
      const g = window.__game;
      g.clock.skipDays?.(12);
      g.calendar?.update?.();
      return { day: g.clock.day, tansy: g.calendar?.ageOf?.('tansy'), pip: g.calendar?.ageOf?.('pip') };
    });
    ok = await reload();
    const y1 = await ev(() => {
      const g = window.__game;
      return { day: g.clock.day, tansy: g.calendar?.ageOf?.('tansy'), pip: g.calendar?.ageOf?.('pip'), label: g.calendar?.dateLabel?.() || '' };
    });
    check(ok && y1.day === y0.day && y1.tansy === y0.tansy && y1.pip === y0.pip, `[${tag}] 23 a year on: the day and the ages come back`, JSON.stringify({ y0, y1 }));
    // (d) Mid-hunt: a killing the watch saw; save; the hunt comes back.
    const h = await ev(() => {
      const g = window.__game;
      g.clock.skipTo?.(12);
      const sq = g.locations.get('town_square').center;
      const wys = g.entities.get('wys');
      const row = g.entities.get('rowan');
      wys.x = sq.x;
      wys.y = sq.y;
      row.x = sq.x + 40;
      row.y = sq.y + 10;
      row.faceToward?.(wys.x, wys.y);
      g.player.x = sq.x + 14;
      g.player.y = sq.y;
      g.murder.kill(wys, g.player);
      const rec = g.murder.dead.wys;
      if (rec && !g.murder.isHunted()) g.murder.raiseAlarm?.(rec, 'rowan', { saw: true });
      return { hunted: g.murder.isHunted(), about: g.murder.hunt?.about || null };
    });
    ok = await reload();
    const h2 = await ev(() => ({ hunted: window.__game.murder.isHunted(), about: window.__game.murder.hunt?.about || null, dead: window.__game.murder.isDead('wys') }));
    check(h.hunted && ok && h2.hunted && h2.about === h.about && h2.dead, `[${tag}] 23 mid-hunt: the hunt and the dead come back`, JSON.stringify({ h, h2 }));
    await shot('23-hunt-reloaded');
  });

  // ================================================================ 40: talk and party leftovers
  await item(40, 'leftovers: Lyra quiet while you are down, place lines, her ear, frightened chips, a companion behind, waking, the map, prompts and bubbles', async () => {
    // A log of every bubble, by speaker, with where they stood.
    await ev(() => {
      const g = window.__game;
      window.__said = [];
      if (!g.bubbles.__logged) {
        for (const k of ['say', 'thought']) {
          const f = g.bubbles[k].bind(g.bubbles);
          g.bubbles[k] = (e, text, o) => {
            window.__said.push({ who: e?.id, kind: k, text: String(text), d: e && g.player ? Math.round(Math.hypot(e.x - g.player.x, e.y - g.player.y)) : null, job: e === g.companion ? !!g.survival?.jobs?.has?.(e) : null, down: !!g.player.downed });
            return f(e, text, o);
          };
        }
        g.bubbles.__logged = true;
      }
    });
    const lyraBack = () =>
      ev(() => {
        const g = window.__game;
        const L = g.companion;
        if (L._heldController) L.controller = L._heldController;
        if (L.mind.companionship !== 'together') L.mind.autonomy.setCompanionship('together', '', { silent: true });
        if (g.party.holderId !== 'lyra') g.party.set?.('lyra', 'verify');
      });
    // (a) Down and bleeding, Lyra a long way off: she says nothing to you.
    await lyraBack();
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo?.(11);
      const m = g.locations.get('south_meadow').center;
      g.player.x = m.x;
      g.player.y = m.y;
      const L = g.companion;
      L.x = m.x + 2000;
      L.y = m.y;
      L.behavior?.setDirective?.({ type: 'stay', x: m.x + 2000, y: m.y });
      g.camera.snap?.();
      window.__said.length = 0;
      g.player.fall({ cause: 'test' });
    });
    for (let i = 0; i < 6; i++) {
      await ev(() => {
        const g = window.__game;
        g.companion.mind?.thinker?.nudge?.(0);
        if (g.brain?.barks) g.brain.barks.lastBarkAt = -1e9;
      });
      await wait(1500);
    }
    const a = await ev(() => window.__said.filter((x) => x.who === 'lyra' && x.down && !x.job && x.d > 400));
    check(a.length === 0, `[${tag}] L1 down, Lyra far off and not coming: she says nothing to you`, JSON.stringify(a.slice(0, 3)));
    await shot('L1-down-quiet');
    await ev(() => {
      const g = window.__game;
      g.survival.reviveWith(g.player, g.companion, 'test', 1);
      g.player.hp = g.player.maxHp;
    });
    await wait(500);
    const up = await ev(() => ({ downed: !!window.__game.player.downed, fallen: !!window.__game.survival.isFallen(window.__game.player), ring: !!document.querySelector('.sv-fallen:not([hidden])') }));
    check(!up.downed && !up.fallen, `[${tag}] L1 ... helped up again`, JSON.stringify(up));
    // (b) A place line only where you both are: Lyra walks into the chapel far from you.
    await ev(() => {
      const g = window.__game;
      window.__said.length = 0;
      const ch = g.locations.get('chapel').center;
      const L = g.companion;
      L.x = ch.x;
      L.y = ch.y;
      g.brain?.barks?.visited?.delete?.('chapel');
    });
    await wait(4500);
    const b = await ev(() => window.__said.filter((x) => x.who === 'lyra' && /chapel|Chapel|Flame/.test(x.text)));
    check(b.length === 0, `[${tag}] L2 Lyra enters the chapel far from you: no place line to you`, JSON.stringify(b.slice(0, 2)));
    // (c) Her ear: Elda cries out inside the Kettle; Lyra outside with you: she turns and asks.
    const c0 = await ev(() => {
      const g = window.__game;
      window.__said.length = 0;
      const k = g.locations.get('ember_kettle').bounds;
      const elda = g.entities.get('elda');
      window.__at(elda, k.x + 2, Math.floor(k.y + k.h / 2));
      const L = g.companion;
      L.behavior?.setDirective?.({ type: 'follow', target: 'player' });
      L.x = (k.x - 1.5) * 16;
      L.y = (k.y + k.h / 2) * 16;
      L.facing = { x: -1, y: 0 };
      g.player.x = L.x - 24;
      g.player.y = L.y;
      g.camera.snap?.();
      g.brain.barks.cooldowns?.clear?.();
      g.brain.barks.lastBarkAt = -1e9;
      g.brain.barks.lastLyraSpeechAt = -1e9;
      g.brain.lastReplyAt = -1e9;
      g.bus.emit('call_for_help', { victim: elda, victimEntity: elda, attacker: null, x: elda.x, y: elda.y, severity: 3 });
      return { fx: L.facing.x };
    });
    await wait(3500);
    const c = await ev(() => ({ lines: window.__said.filter((x) => x.who === 'lyra').map((x) => x.text), fx: window.__game.companion.facing.x }));
    check(c.lines.some((t) => /hear|What was that|Something|Hush|scream/i.test(t)) && !c.lines.some((t) => /Elda/.test(t)), `[${tag}] L3 a cry behind a wall: Lyra turns and says she heard something, never who`, JSON.stringify(c));
    await shot('L3-her-ear');
    // (d) Someone terrified of you: the chat's chips are a frightened person's, not hellos.
    await ev(() => {
      const g = window.__game;
      const elda = g.entities.get('elda');
      const sq = g.locations.get('town_square').center;
      window.__at(elda, Math.floor(sq.x / 16), Math.floor(sq.y / 16));
      elda.terror = { until: g.murder.now() + 600, of: 'player' };
      g.player.x = elda.x + 18;
      g.player.y = elda.y;
      g.player.facing = { x: -1, y: 0 };
      g.player.dir = 'left';
      g.camera.snap?.();
      g.ui.chat.close?.();
    });
    await wait(400);
    const who4 = await ev(() => {
      const g = window.__game;
      const P = g.player;
      const near = g.villageLife.villagers().map((v) => ({ id: v.id, d: Math.round(Math.hypot(v.x - P.x, v.y - P.y)) })).filter((v) => v.d < 120);
      return { near, label: document.querySelector('.tbtn-interact')?.getAttribute('aria-label') || '', elda: { mode: g.entities.get('elda').mode } };
    });
    if (S.phone) await page.touchscreen.tap(...(await (async () => {
      const r = await rectOf('.tbtn-interact');
      return [r.x + r.w / 2, r.y + r.h / 2];
    })()));
    else await page.keyboard.press('t');
    await wait(700);
    const d = await ev(() => {
      const c = window.__game.ui.chat;
      return { target: c.target, chips: [...document.querySelectorAll('.chat-chips .chip')].map((b) => b.textContent), status: document.querySelector('.chat-status, .chat-head .chat-sub')?.textContent || '', rows: [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-2) };
    });
    check(d.target === 'elda' && d.chips.length > 0 && !d.chips.some((t) => /Hello|news|Tell me about yourself/.test(t)), `[${tag}] L4 Elda terrified: no friendly chips`, JSON.stringify({ ...d, who4 }));
    check(d.rows.some((r) => /backs away from you/.test(r)), `[${tag}] L4 ... and what you see as you turn to her`, JSON.stringify(d.rows));
    await shot('L4-terrified-chips');
    await ev(() => {
      const g = window.__game;
      g.ui.chat.close?.();
      g.entities.get('elda').terror = null;
    });
    // (e) A companion who falls far behind catches up without a blink you can see.
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      const sq = g.locations.get('town_square').center;
      b.x = sq.x;
      b.y = sq.y;
      b.opinionOfPlayer = 85;
      b.wrongedDay = null;
      g.player.x = sq.x + 20;
      g.player.y = sq.y;
      g.party.release?.('dismissed');
      g.party.invite(b);
    });
    await wait(500);
    await ev(() => {
      const g = window.__game;
      const m = g.locations.get('south_meadow').center;
      g.player.x = m.x;
      g.player.y = m.y + 40;
      g.camera.snap?.();
      window.__bramPath = [];
      const tick = () => {
        const b = g.entities.get('bram');
        const c = g.camera;
        window.__bramPath.push({ x: b.x, y: b.y, px: g.player.x, py: g.player.y, view: c ? { x: c.x, y: c.y, w: c.viewW || c.w || 0, h: c.viewH || c.h || 0 } : null });
        if (window.__bramPath.length < 900) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await wait(9000);
    const e = await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      const path = window.__bramPath;
      let jump = null;
      for (let i = 1; i < path.length; i++) {
        const dd = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        if (dd > 64) {
          const p = path[i];
          const onScreen = (() => {
            const r = g.renderer.worldToCss(p.x, p.y);
            const W = innerWidth;
            const H = innerHeight;
            return r && r.x > 0 && r.x < W && r.y > 0 && r.y < H;
          })();
          jump = { dd: Math.round(dd), onScreen };
        }
      }
      return { holder: g.party.holderId, d: Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y) / 16), jump };
    });
    check(e.holder === 'bram' && e.d <= 12, `[${tag}] L5 Bram left far behind catches up (${e.d} tiles off after 9 s)`, JSON.stringify(e));
    check(!e.jump || !e.jump.onScreen, `[${tag}] L5 ... with no blink in view`, JSON.stringify(e.jump));
    await shot('L5-caught-up');
    await ev(() => window.__game.party.release?.('dismissed'));
    // (f) Waking: Lyra far behind when you sleep does not wake beside you.
    await lyraBack();
    const f0 = await ev(async () => {
      const g = window.__game;
      g.clock.skipTo?.(22);
      const home = g.locations.get('player_home') || g.locations.get('home') || g.locations.get('wayhouse');
      const P = g.player;
      if (home?.center) {
        P.x = home.center.x;
        P.y = home.center.y;
      }
      const L = g.companion;
      L.x = P.x + 70 * 16;
      L.y = P.y;
      L.behavior?.setDirective?.({ type: 'stay', x: L.x, y: L.y });
      g.camera.snap?.();
      const r = await g.sleep();
      return { slept: r !== false, d: Math.round(Math.hypot(L.x - P.x, L.y - P.y) / 16) };
    });
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 }).catch(() => {});
    await wait(800);
    const f = await ev(() => {
      const g = window.__game;
      const L = g.companion;
      return { hour: Math.round(g.clock.hour), d: Math.round(Math.hypot(L.x - g.player.x, L.y - g.player.y) / 16) };
    });
    check(f0.slept && f.d > 4, `[${tag}] L6 Lyra far off when you slept: she does not wake beside you (${f.d} tiles)`, JSON.stringify({ f0, f }));
    // (g) The map on this screen: your coins' ember-ring far off is in view with you.
    const g0 = await ev(() => {
      const g = window.__game;
      g.ui.closeAll?.();
      const m = g.locations.get('south_meadow').center;
      g.player.x = m.x;
      g.player.y = m.y;
      g.player.inventory.add('coin', 40);
      const save = { x: g.player.x, y: g.player.y };
      g.player.x = m.x - 50 * 16;
      g.player.y = m.y + 10 * 16;
      g.survival.dropRing(g.player);
      g.player.x = save.x;
      g.player.y = save.y;
      g.camera.snap?.();
      g.ui.openMap();
      return true;
    });
    await wait(900);
    const gm = await ev(() => {
      const g = window.__game;
      const wm = g.ui.worldMap;
      const c = wm.canvas;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const s = wm.scale(W, H);
      const toScr = (x, y) => ({ x: (x / 16 - wm.cx) * s + W / 2, y: (y / 16 - wm.cy) * s + H / 2 });
      const ring = wm.marks().find((m) => m.kind === 'ember');
      const me = toScr(g.player.x, g.player.y);
      const rr = ring ? toScr(ring.x, ring.y) : null;
      const inView = (p) => !!p && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
      return { W, H, me: inView(me), ring: inView(rr), hasRing: !!ring };
    });
    check(gm.hasRing && gm.me && gm.ring, `[${tag}] L7 the map opens with you and your coins' ember-ring in view`, JSON.stringify(gm));
    await shot('L7-map-ring');
    await ev(() => {
      const g = window.__game;
      g.ui.closeModal(g.ui.worldMap.panel, true);
      g.survival.ring && (g.survival.ring.taken = true);
    });
    // (h) A prompt never under the companion's words: by the well with Bram talking.
    await ev(() => {
      const g = window.__game;
      const sq = g.locations.get('town_square').center;
      const b = g.entities.get('bram');
      g.party.invite(b);
      const well = g.objects?.all?.().find?.((o) => /well/.test(o.kind || o.type || '')) || null;
      const at = well ? { x: well.x, y: well.y + 18 } : { x: sq.x, y: sq.y + 20 };
      g.player.x = at.x;
      g.player.y = at.y;
      g.player.facing = { x: 0, y: -1 };
      g.player.dir = 'up';
      b.x = g.player.x + 16;
      b.y = g.player.y + 4;
      g.camera.snap?.();
      g.bubbles.say(b, 'Aye, the well water is the best in the vale, they say. Drink, if you like.', { kind: 'say', duration: 8 });
    });
    await wait(900);
    const hh = await ev(() => {
      const g = window.__game;
      const pr = document.querySelector('.interact-prompt');
      const vis = pr && !pr.hidden && getComputedStyle(pr).display !== 'none';
      const R = vis ? pr.getBoundingClientRect() : null;
      const c = g.canvas.getBoundingClientRect();
      const dpr = c.width ? g.canvas.width / c.width : 1;
      const bub = (g.bubbles._vis || []).find((x) => x.entity?.id === 'bram');
      const L = bub?.layout;
      const B = L ? { left: c.left + L.x / dpr, top: c.top + L.y / dpr, right: c.left + (L.x + L.w) / dpr, bottom: c.top + (L.y + L.h) / dpr } : null;
      const overlap = !!R && !!B && R.left < B.right && R.right > B.left && R.top < B.bottom && R.bottom > B.top;
      return { prompt: vis ? pr.textContent.trim() : null, R: R && { l: Math.round(R.left), t: Math.round(R.top), r: Math.round(R.right), b: Math.round(R.bottom) }, B: B && { l: Math.round(B.left), t: Math.round(B.top), r: Math.round(B.right), b: Math.round(B.bottom) }, overlap };
    });
    check(!hh.overlap, `[${tag}] L8 the use prompt (${hh.prompt}) and Bram's words do not overlap`, JSON.stringify(hh));
    await shot('L8-prompt-bubble');
    await ev(() => window.__game.party.release?.('dismissed'));
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
