// Round 14b soul check: the Unkindling, played in the built game on a phone held sideways
// (844x390, by touch, and at 4x CPU throttle), a phone upright (390x844, by touch) and a
// computer (1280x720, the F key held) (DESIGN §37):
//   - the pact's gift teaches it (pact_sealed); before, there is no dark hand and no hint;
//   - with a grown soul in touch: the phone's dark hand (44 px or more, clear of the cluster's
//     own buttons) or the desktop hint names them; Pip is refused ("No. Not a child.");
//   - held at night on the square: the soul is drawn out toward the raised hand, strains back,
//     tears free, gutters into the hand; the body lies with no blood; no call for help, no cry,
//     Elda asleep a tile away sleeps on (loudness 0); the colours drain and the lamps gutter;
//   - Hess, much stronger than a hurt stranger, snaps back and breaks free, and knows;
//   - the finder's shock ("No mark… cold as stone"), and no blade, no case;
//   - reduce motion: the still version;
//   - on the throttled phone the hold keeps the frame rate.
// Frames are saved at the start, the peak of the pull, the tear, the sag, the end, the
// snap-back, the finder's shock and the still version.
//   node scripts/soul_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/soul';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${info}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

async function run(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // A frame held still for the picture (the world paused, the drawing goes on).
  const shot = async (name) => {
    const at = await ev(() => {
      const g = window.__game;
      g.paused = true;
      const c = g.unkindle?.channel;
      return c ? `${c.phase} k=${c.k.toFixed(2)} shown=${c.shown.toFixed(2)} t=${c.phaseT.toFixed(2)}` : 'no hold';
    });
    if (process.env.SOUL_DEBUG) console.log(`  [shot ${tag}-${name}] ${at}`);
    await wait(120);
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
    await ev(() => {
      window.__game.paused = false;
    });
  };
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });

  // Hold the spell: F on a computer; on a phone a finger held on the dark hand (a real touch).
  let touchAt = null;
  const holdDown = async () => {
    if (!S.phone) {
      await page.keyboard.down('f');
      return true;
    }
    const r = await rectOf('.unk-btn');
    if (!r) return false;
    touchAt = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchAt.x, y: touchAt.y, id: 7 }] });
    return true;
  };
  const holdUp = async () => {
    if (!S.phone) {
      await page.keyboard.up('f');
      return;
    }
    if (!touchAt) return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    touchAt = null;
  };

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(600);
  await ev(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    const u = g.ui;
    for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
    u?.coach?.stop?.();
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__ev = [];
    for (const t of ['call_for_help', 'villager_killed', 'crime', 'body_found', 'murder_witnessed', 'unkindle_begin', 'unkindle_end', 'unkindled', 'unkindle_attempt', 'unkindle_learned', 'speech', 'killing_known']) g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? p?.speaker?.id ?? null, outcome: p?.outcome }));
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__at = (e, tx, ty, dx = 8, dy = 10) => {
      e.x = tx * 16 + dx;
      e.y = ty * 16 + dy;
      e.walker?.stop?.();
      if (e.r) e.r.key = null;
      e.think = () => {};
      if (e.state === 'sleep') e.state = 'idle';
    };
    // Everyone far off and still; Lyra too.
    for (const e of g.villageLife.villagers()) window.__at(e, 20 + Math.random() * 4, 52);
    const L = g.companion;
    L.x = 22 * 16;
    L.y = 56 * 16;
    L.controller = null;
    window.__clean();
  });

  // ---------- before the pact: nothing ----------
  const before = await ev(() => {
    const g = window.__game;
    const P = g.player;
    window.__at(P, 84, 62);
    P.faceDir?.('right');
    window.__at(g.entities.get('bram'), 85, 62, 4, 10);
    g.camera.snap?.();
    return { available: g.unkindle?.available?.(), has: !!g.unkindle };
  });
  await wait(400);
  check(before.has && before.available === false, `[${tag}] game.unkindle is there, and unknown before the pact`, JSON.stringify(before));
  check(!(await rectOf('.unk-btn')) && !(await rectOf('.unk-hint')), `[${tag}] before the pact: no dark hand, no hint`);

  // ---------- the pact's gift ----------
  const learned = await ev(() => {
    const g = window.__game;
    g.bus.emit('pact_sealed', { gifts: ['unkindle'], pact: 'after' });
    window.__clean();
    return { learned: g.unkindle.learned, from: g.unkindle.learnedFrom };
  });
  check(learned.learned && learned.from === 'pact', `[${tag}] pact_sealed teaches the Unkindling`, JSON.stringify(learned));

  // ---------- a child: refused ----------
  await ev(() => {
    const g = window.__game;
    window.__at(g.entities.get('bram'), 20, 52);
    window.__at(g.entities.get('pip'), 85, 62, 4, 10);
    window.__toasts.length = 0;
  });
  await wait(400);
  if (S.phone) {
    check(!(await rectOf('.unk-btn')), `[${tag}] Pip in reach: no dark hand for a child`);
  } else {
    check(!(await rectOf('.unk-hint')), `[${tag}] Pip in reach: no hint for a child`);
    await page.keyboard.down('f');
    await wait(300);
    await page.keyboard.up('f');
    const r = await ev(() => ({ toasts: window.__toasts.slice(), ch: !!window.__game.unkindle.channel }));
    check(!r.ch && r.toasts.some((t) => t === 'No. Not a child.'), `[${tag}] F on Pip: "No. Not a child."`, r.toasts.join(' | '));
  }
  const pipAlive = await ev(() => !window.__game.entities.get('pip').dead);
  check(pipAlive, `[${tag}] Pip lives`);

  // ---------- night on the square: Bram, unseen, Elda asleep a tile away ----------
  await ev(() => {
    const g = window.__game;
    window.__at(g.entities.get('pip'), 20, 52);
    g.clock.skipTo?.(22.6);
    for (const o of g.objects.all()) if (o.objType === 'lamp' && Math.hypot(o.x - 88 * 16, o.y - 61 * 16) < 300) o.light?.(null);
    const P = g.player;
    P.hp = P.maxHp;
    window.__at(P, 84, 62);
    P.faceDir?.('right');
    const bram = g.entities.get('bram');
    window.__at(bram, 85, 62, 6, 10);
    bram.faceDir?.('left');
    const elda = g.entities.get('elda');
    window.__at(elda, 83, 62, 2, 12);
    elda.state = 'sleep';
    g.camera.snap?.();
    window.__ev.length = 0;
    window.__toasts.length = 0;
    window.__clean();
  });
  await wait(700);
  if (S.phone) {
    const b = await rectOf('.unk-btn');
    const label = await ev(() => document.querySelector('.unk-btn')?.getAttribute('aria-label'));
    check(!!b && b.w >= 44 && b.h >= 44, `[${tag}] the dark hand shows with Bram in reach, finger-sized`, JSON.stringify(b));
    check(/Bram/.test(label || ''), `[${tag}] it names him`, label);
    const clash = await ev(() => {
      const me = document.querySelector('.unk-btn')?.getBoundingClientRect();
      if (!me) return ['none'];
      const out = [];
      for (const el of document.querySelectorAll('.tcluster .tbtn, .tcluster .wbtn, .hud button')) {
        if (el.classList.contains('unk-btn') || el.hidden || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const ix = Math.min(me.right, r.right) - Math.max(me.left, r.left);
        const iy = Math.min(me.bottom, r.bottom) - Math.max(me.top, r.top);
        if (ix > 2 && iy > 2) out.push(el.className);
      }
      const inView = me.left >= 0 && me.top >= 0 && me.right <= innerWidth && me.bottom <= innerHeight;
      return inView ? out : [...out, 'off-screen'];
    });
    check(clash.length === 0, `[${tag}] the dark hand clears every other button, on screen`, clash.join(' | '));
  } else {
    const hint = await ev(() => document.querySelector('.unk-hint')?.textContent || '');
    check(/F/.test(hint) && /Bram/.test(hint) && !!(await rectOf('.unk-hint')), `[${tag}] the desktop hint: hold F, and who`, hint);
  }
  await shot('0-in-reach');
  check(await holdDown(), `[${tag}] hold the spell (${S.phone ? 'a finger on the dark hand' : 'F held'})`);
  await until(() => (window.__game.unkindle.channel?.k ?? 0) > 0.12);
  await shot('1-start');
  const mid = await ev(() => {
    const g = window.__game;
    const bram = g.entities.get('bram');
    return { held: g.unkindle.isHeld(bram), lit: g.unkindle.fx?.stats?.lights ?? null, fx: g.pixelFx?.playing?.(g.unkindle.fx?.handle) ?? null };
  });
  check(mid.held, `[${tag}] Bram is held and silent`);
  check(mid.fx === true, `[${tag}] the soul effect plays on the pixelfx host`, JSON.stringify(mid));
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || c.phase !== 'pull' || c.shown > 0.78;
  });
  await shot('2-peak');
  const lamps = await ev(() => window.__game.unkindle.fx?.stats?.lights ?? 0);
  check(lamps > 0, `[${tag}] the lamps near him gutter`, `${lamps} lights`);
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || c.phase === 'tear' || c.phase === 'sag';
  });
  await shot('3-tear');
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || (c.phase === 'sag' && c.phaseT > 0.25) || c.phase === 'drawn';
  });
  await shot('4-sag');
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || (c.phase === 'drawn' && c.phaseT > 0.12);
  });
  await shot('5-drawn');
  await until(() => !window.__game.unkindle.channel);
  await holdUp();
  await wait(S.throttle ? 2500 : 1600);
  await shot('6-end');
  const done = await ev(() => {
    const g = window.__game;
    const rec = g.murder.dead.bram;
    const elda = g.entities.get('elda');
    return {
      dead: !!g.entities.get('bram').dead,
      rec: rec && { cause: rec.cause, silent: rec.silent, unmarked: rec.unmarked, seen: rec.seen.length, by: rec.by },
      calls: window.__ev.filter((e) => e.t === 'call_for_help').length,
      bramSpoke: window.__ev.filter((e) => e.t === 'speech' && e.id === 'bram').length,
      elda: { state: elda.state, uneasy: !!elda.uneasy },
      tally: g.unkindle.tally,
      toasts: window.__toasts.slice(),
      level: g.unkindle.fx?.level ?? null,
    };
  });
  check(done.dead && done.rec?.cause === 'unkindled' && done.rec.silent && done.rec.unmarked && done.rec.seen === 0 && done.rec.by === 'player', `[${tag}] Bram's flame is out: unkindled, silent, unmarked, unseen`, JSON.stringify(done.rec));
  check(done.calls === 0 && done.bramSpoke === 0, `[${tag}] no call for help, not a word from him`, `calls=${done.calls} spoke=${done.bramSpoke}`);
  check(done.elda.state === 'sleep' && !done.elda.uneasy, `[${tag}] Elda, asleep a tile away, sleeps on`, JSON.stringify(done.elda));
  check(done.tally === 1, `[${tag}] the tally counts it`);
  check(!done.toasts.some((t) => /cries out|saw you|watch is coming/.test(t)), `[${tag}] no cry, no witness`, done.toasts.join(' | '));

  // ---------- the finder's shock ----------
  const found = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(7.2);
    const elda = g.entities.get('elda');
    window.__at(elda, 86, 62, 8, 10);
    elda.faceDir?.('left');
    window.__toasts.length = 0;
    window.__clean();
    g.murder.found('bram', 'elda', g.murder.dead.bram.place);
    return { toasts: window.__toasts.slice(), case: !!g.murder.cases.bram, wanted: g.murder.isWanted(), mystery: !!g.murder.dead.bram.mystery };
  });
  await wait(500);
  await shot('7-finder');
  check(found.mystery && !found.case && !found.wanted, `[${tag}] found: a mystery, no case, nobody wanted`, JSON.stringify(found));
  check(found.toasts.some((t) => /No mark/.test(t)) && !found.toasts.some((t) => /blade/i.test(t)), `[${tag}] "No mark… cold as stone", no blade`, found.toasts.join(' | '));

  // ---------- Hess, much stronger than a hurt stranger: she breaks free and knows ----------
  await ev(() => {
    const g = window.__game;
    window.__at(g.entities.get('elda'), 20, 52);
    const P = g.player;
    window.__at(P, 91, 60);
    P.faceDir?.('right');
    P.hp = Math.round(P.maxHp * 0.3);
    const hess = g.entities.get('hess');
    window.__at(hess, 92, 60, 4, 10);
    hess.faceDir?.('left');
    g.camera.snap?.();
    window.__toasts.length = 0;
    window.__clean();
    g.unkindle.cooldownUntil = -Infinity;
  });
  await wait(600);
  const vHess = await ev(() => window.__game.unkindle.verdict(window.__game.entities.get('hess')).kind);
  check(vHess === 'resists', `[${tag}] Hess is much stronger than a hurt stranger`, vHess);
  await holdDown();
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || (c.phase === 'snap' && c.phaseT > 0.06);
  });
  await shot('8-snap');
  await until(() => !window.__game.unkindle.channel);
  await holdUp();
  const snap = await ev(() => {
    const g = window.__game;
    const hess = g.entities.get('hess');
    const r = {
      alive: !hess.dead,
      knows: g.unkindle.village.knows('hess'),
      mode: hess.mode,
      at: g.unkindle.attempts.at(-1),
      toasts: window.__toasts.slice(),
    };
    // She would cut the stranger down: hold her for the rest of the check.
    hess.think = () => {};
    hess.mode = 'routine';
    hess.fightTarget = null;
    window.__at(hess, 20, 52);
    g.player.hp = g.player.maxHp;
    return r;
  });
  check(snap.alive && snap.knows && snap.at?.outcome === 'resisted', `[${tag}] Hess breaks free, and knows what you tried`, JSON.stringify(snap.at));
  check(snap.mode === 'fight', `[${tag}] she fights (a fighter)`, snap.mode);
  check(snap.toasts.some((t) => /broke free/.test(t)), `[${tag}] "Hess broke free, and knows"`, snap.toasts.join(' | '));

  // ---------- reduce motion: the still version (Garrick, by day) ----------
  await ev(() => {
    const g = window.__game;
    g.settings.reduceMotion = true;
    document.documentElement.classList.add('reduce-motion');
    const P = g.player;
    window.__at(P, 91, 58);
    P.faceDir?.('right');
    window.__at(g.entities.get('garrick'), 92, 58, 4, 10);
    g.camera.snap?.();
    g.unkindle.cooldownUntil = -Infinity;
    window.__clean();
  });
  await wait(600);
  await holdDown();
  await until(() => {
    const c = window.__game.unkindle.channel;
    return !c || c.phase !== 'pull' || c.k > 0.6;
  });
  await shot('9-still');
  await until(() => !window.__game.unkindle.channel);
  await holdUp();
  const still = await ev(() => {
    const g = window.__game;
    g.settings.reduceMotion = false;
    document.documentElement.classList.remove('reduce-motion');
    return { dead: !!g.entities.get('garrick').dead, tally: g.unkindle.tally };
  });
  check(still.dead && still.tally === 2, `[${tag}] reduce motion: the same spell, the still version`, JSON.stringify(still));

  // ---------- seen once: Elda sees Tobias unkindled, by day; every death is linked ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(13);
    const P = g.player;
    window.__at(P, 89, 60);
    P.faceDir?.('right');
    window.__at(g.entities.get('tobias'), 90, 60, 4, 10);
    const elda = g.entities.get('elda');
    window.__at(elda, 89, 62, 8, 10);
    elda.faceDir?.('up');
    g.camera.snap?.();
    g.unkindle.cooldownUntil = -Infinity;
    window.__said = [];
    g.bus.on('speech', (p) => window.__said.push({ who: p?.speaker?.id, text: p?.text }));
    window.__clean();
  });
  await wait(500);
  await holdDown();
  await until(() => !window.__game.unkindle.channel);
  await holdUp();
  await wait(400);
  await shot('11-seen');
  const seen = await ev(() => {
    const g = window.__game;
    const rec = g.murder.dead.tobias;
    const u = g.unkindle.village;
    return {
      seen: (rec?.seen || []).map((s) => s.id),
      soul: !!rec?.seenSoul,
      elda: (window.__said || []).filter((s) => s.who === 'elda').map((s) => s.text),
      knows: u.knows('elda'),
      bramLinked: !!g.murder.dead.bram?.linked && (g.murder.dead.bram.knownBy || []).includes('elda'),
      known: window.__ev.filter((e) => e.t === 'killing_known').length,
      brief: g.unkindle.briefLine('elda'),
    };
  });
  check(seen.seen.includes('elda') && seen.soul, `[${tag}] Elda saw it (the sight rule): the soul pulled out`, JSON.stringify(seen.seen));
  check(seen.elda.some((t) => /out of|life|light/i.test(t)), `[${tag}] she cries what she saw, in her words`, seen.elda.join(' | '));
  check(seen.knows && seen.bramLinked, `[${tag}] she links Bram's death: that is how he died`, JSON.stringify({ knows: seen.knows, bram: seen.bramLinked }));
  check(/bare hand/.test(seen.brief) && /Bram/.test(seen.brief), `[${tag}] her brief carries what she knows now`, seen.brief);

  // ---------- a slow phone keeps its frame rate through the hold ----------
  if (S.throttle) {
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo?.(22.6);
      const P = g.player;
      window.__at(P, 91, 60);
      P.faceDir?.('right');
      window.__at(g.entities.get('corran'), 92, 60, 4, 10);
      g.camera.snap?.();
      g.unkindle.cooldownUntil = -Infinity;
      window.__clean();
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await wait(1500);
    const fpsOf = () =>
      ev(
        () =>
          new Promise((res) => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
              n++;
              if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
              else res(Math.round((n * 1000) / (performance.now() - t0)));
            };
            requestAnimationFrame(tick);
          }),
      );
    const idle = await fpsOf();
    await holdDown();
    await until(() => (window.__game.unkindle.channel?.k ?? 0) > 0.05);
    const during = await fpsOf();
    await shot('10-throttled');
    await until(() => !window.__game.unkindle.channel, null, 60000);
    await holdUp();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // (Absolute numbers depend on the machine's load: another build may share it. The hold
    // must cost the slow phone no more than a fifth of its frames, and never drop below 15.)
    check(during >= 15 && during >= idle * 0.8, `[${tag}] at ${S.throttle}x CPU the hold runs at ${during} fps (${idle} without)`, `${during}/${idle}`);
  }

  const scroll = await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!scroll, `[${tag}] no sideways scroll`);
  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  for (const S of SIZES) await run(S);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
