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
//   - on the throttled phone the hold keeps the frame rate;
//   - the hold plants you: pushing the stick (phone, a second finger) or D (desktop) while the
//     spell is held does not walk you (the author: "I can move while I'm doing spells; it
//     should stop me");
//   - §13b: three wolves and a bandit feed the taken flame (the bar under health, the weaves
//     harder, the Character panel's numbers); days later the signs (a hug: "your hands—
//     like ice"; a flame leaning in the Kettle at night; breath, eyes, frost, the slow shadow,
//     the flowers by your bed); Aveline comes by day, in private, and asks: a lie she doubts,
//     the truth about the beasts (wary, asks you to stop, the rite offered, no crime); a wolf
//     taken in front of Hobb is dark magic, no crime; weeks of stopping: the bar and the signs
//     gone, "You're warmer"; the skeletons by Brindlecombe's graveyard: "Nothing in there".
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

  // Push to walk: D on a computer; on a phone a second finger on the move stick, dragged right
  // (the hand's finger stays down: both points in every touch event).
  let stickAt = null;
  const pushMove = async (on) => {
    if (!S.phone) {
      if (on) await page.keyboard.down('d');
      else await page.keyboard.up('d');
      return;
    }
    const hand = touchAt ? [{ x: touchAt.x, y: touchAt.y, id: 7 }] : [];
    if (on) {
      const z = await rectOf('.stick-zone');
      if (!z) return;
      stickAt = { x: Math.round(z.x + z.w * 0.4), y: Math.round(z.y + z.h * 0.6) };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...hand, { x: stickAt.x, y: stickAt.y, id: 8 }] });
      for (let i = 1; i <= 4; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...hand, { x: stickAt.x + i * 12, y: stickAt.y, id: 8 }] });
        await wait(40);
      }
    } else if (stickAt) {
      // Lift only the stick's finger: the active points left are the hand's (a touchEnd would
      // lift every finger, the hand's too).
      if (hand.length) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: hand });
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      stickAt = null;
    }
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
  check(!(await rectOf('.meter-coldfire')), `[${tag}] no coldfire bar on the HUD before a soul is taken`);

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
    const over = await ev(() => {
      const me = document.querySelector('.unk-hint')?.getBoundingClientRect();
      const out = [];
      if (!me) return ['none'];
      for (const el of document.querySelectorAll('.interact-prompt, .hud button, .hotbar, .hud-bar')) {
        if (el.hidden || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (Math.min(me.right, r.right) - Math.max(me.left, r.left) > 1 && Math.min(me.bottom, r.bottom) - Math.max(me.top, r.top) > 1) out.push(el.className);
      }
      return out;
    });
    check(over.length === 0, `[${tag}] the hint sits clear of the use prompt and the hotbar`, over.join(' | '));
  }
  await shot('0-in-reach');
  check(await holdDown(), `[${tag}] hold the spell (${S.phone ? 'a finger on the dark hand' : 'F held'})`);
  // Push to walk while holding it (a second finger on the stick; D on a computer): you stand.
  const at0 = await ev(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  await pushMove(true);
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
  const at1 = await ev(() => ({ x: window.__game.player.x, y: window.__game.player.y, phase: window.__game.unkindle.channel?.phase ?? null }));
  await pushMove(false);
  check(Math.hypot(at1.x - at0.x, at1.y - at0.y) < 1.5, `[${tag}] the hold plants you: pushing to walk does not move you`, `${Math.hypot(at1.x - at0.x, at1.y - at0.y).toFixed(2)} px (${at1.phase})`);
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

  // ---------- §13b (9): three wolves and a bandit on the road feed the taken flame ----------
  const before13b = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(10.5);
    const P = g.player;
    P.hp = P.maxHp;
    window.__at(P, 100, 61);
    P.faceDir?.('right');
    for (const id of ['elda', 'hess', 'tobias']) window.__at(g.entities.get(id), 20, 52);
    // A cold flame to start from (the people taken above fed it): this part reads the bar
    // from nothing, as the verifier plays it on a fresh path.
    const cf = g.unkindle.coldfire;
    cf.bar = 0;
    cf.mark = 0;
    cf.settled = 0;
    cf.touch();
    g.camera.snap?.();
    // A creature of the world's own kind (any one's constructor), standing still for the check.
    const C = g.entities.all().find((e) => e.species === 'chicken' || e.species === 'rabbit' || e.species === 'slime')?.constructor;
    window.__spawn = (sp, tx, ty) => {
      const c = g.entities.add(new C(g, sp, { x: tx * 16 + 8, y: ty * 16 + 10 }));
      c.controller = null;
      c.aggroRadius = 0;
      return c;
    };
    window.__clean();
    return { sp: g.stats.get(P, 'spellPower'), atk: g.stats.get(P, 'atk'), meter: !!document.querySelector('.meter-coldfire:not([hidden])'), tally: g.unkindle.tally, murders: Object.keys(g.murder.dead).length };
  });
  for (const sp of ['wolf', 'wolf', 'wolf', 'bandit']) {
    await ev((sp) => {
      const g = window.__game;
      g.unkindle.cooldownUntil = -Infinity;
      window.__prey = window.__spawn(sp, 101, 61);
      window.__prey.x = g.player.x + 14;
      window.__prey.y = g.player.y;
    }, sp);
    await wait(450);
    await holdDown();
    await until(() => !window.__game.unkindle.channel && window.__prey?.dead, null, 20000).catch(() => {});
    await holdUp();
    await wait(150);
  }
  await wait(500);
  const fed = await ev(() => {
    const g = window.__game;
    const P = g.player;
    const m = document.querySelector('.meter-coldfire');
    const card = document.querySelector('.player-card');
    const r = m && !m.hidden ? m.getBoundingClientRect() : null;
    const c = card?.getBoundingClientRect();
    return {
      bar: Math.round(g.unkindle.coldfire.bar),
      prey: { ...g.unkindle.prey },
      sp: g.stats.get(P, 'spellPower'),
      atk: g.stats.get(P, 'atk'),
      meter: r && { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom },
      inCard: !!(r && c && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1),
      inView: !!(r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
      text: m?.textContent || '',
      tally: g.unkindle.tally,
      murders: Object.keys(g.murder.dead).length,
    };
  });
  check(fed.prey.beast === 3 && fed.prey.bandit === 1 && fed.bar > 30 && fed.bar < 100, `[${tag}] three wolves and a bandit feed the taken flame`, JSON.stringify({ bar: fed.bar, prey: fed.prey }));
  check(fed.tally === before13b.tally && fed.murders === before13b.murders, `[${tag}] prey, not murder: no death record, the Hollow's tally unmoved`, `${fed.tally} ${fed.murders}`);
  check(fed.sp > before13b.sp && fed.atk > before13b.atk, `[${tag}] the weaves and the blade hit harder`, `spellPower ${before13b.sp} -> ${fed.sp}, atk ${before13b.atk} -> ${fed.atk}`);
  check(!!fed.meter && fed.inCard && fed.inView && fed.meter.h >= 4, `[${tag}] the cold bar shows under health, inside the player card, on screen`, `${JSON.stringify(fed.meter)} "${fed.text}"`);
  await shot('12-coldfire-hud');
  if (!S.phone) {
    // Interface size Large: the bar grows with its card and stays in it.
    const big = await ev(() => {
      const g = window.__game;
      g.settings.uiSize = 'large';
      window.dispatchEvent(new Event('resize'));
      return true;
    });
    await wait(400);
    const lg = await ev(() => {
      const m = document.querySelector('.meter-coldfire')?.getBoundingClientRect();
      const c = document.querySelector('.player-card')?.getBoundingClientRect();
      const out = !!(m && c && m.left >= c.left - 1 && m.right <= c.right + 1 && m.bottom <= c.bottom + 1 && m.right <= innerWidth);
      window.__game.settings.uiSize = 'normal';
      window.dispatchEvent(new Event('resize'));
      return { out, w: m?.width };
    });
    check(big && lg.out, `[${tag}] Interface size Large: the bar still sits in its card`, JSON.stringify(lg));
  }
  // The Character panel: its numbers.
  const sheet = await ev(() => {
    const g = window.__game;
    g.ui.character?.open?.();
    const box = document.querySelector('.chs-coldfire');
    box?.scrollIntoView?.({ block: 'center' });
    return { has: !!box && !box.hidden, text: box?.textContent || '' };
  });
  await wait(300);
  await shot('13-character');
  check(sheet.has && /Coldfire/.test(sheet.text) && /\+\d+%/.test(sheet.text) && /3 beasts/.test(sheet.text), `[${tag}] the Character panel: Coldfire, its numbers, the souls taken`, sheet.text.slice(0, 160));
  await ev(() => {
    window.__game.ui.character?.close?.();
    window.__clean();
  });

  // ---------- (10) days pass: the signs come on; a hug; a flame leans in the Kettle ----------
  const tierNow = await ev(async () => {
    const g = window.__game;
    for (let i = 0; i < 6; i++) {
      g.clock.t += 450;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    g.clock.skipTo?.(11);
    return g.unkindle.coldfire.tier();
  });
  check(tierNow >= 2, `[${tag}] three days on, the signs have come on (clear)`, String(tierNow));
  // *hugs Sabeth* (a real message through the chat): she feels your hands.
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    window.__at(P, 100, 61);
    const sab = g.entities.get('sabeth');
    window.__at(sab, 101, 61, 2, 10);
    sab.faceDir?.('left');
    g.camera.snap?.();
    window.__clean();
    g.ui.chat.selectTarget('sabeth');
    g.ui.chat.open(true);
  });
  await wait(400);
  const field = await page.$('.chat-input textarea, .chat-input input');
  if (field) {
    await field.fill('*hugs Sabeth*');
    await field.press('Enter');
  }
  await until(() => /ice|cold/i.test(document.querySelector('.chat')?.textContent || ''), null, 12000).catch(() => {});
  await shot('14-hug');
  const hug = await ev(() => ({ text: (document.querySelector('.chat')?.textContent || '').slice(-400), sab: window.__game.unkindle.suspicion.people.sabeth?.signs || {} }));
  check(!!field && hug.sab.hands >= 1 && /ice|cold/i.test(hug.text), `[${tag}] *hugs Sabeth*: she says your hands are ice`, hug.text.slice(-120));
  await ev(() => {
    window.__game.ui.chat.close?.();
    window.__at(window.__game.entities.get('sabeth'), 20, 52);
  });
  // Night in the Ember Kettle: a flame by you leans away and gutters.
  const kettle = await ev(async () => {
    const g = window.__game;
    g.clock.skipTo?.(22.3);
    const loc = g.locations.get('ember_kettle');
    const P = g.player;
    const hearth = g.objects.all().find((o) => (o.objType === 'hearth' || o.objType === 'lamp') && !o.removed && g.locations.at(o.x, o.y)?.id === 'ember_kettle');
    const at = hearth || loc.center;
    P.x = at.x - 12;
    P.y = at.y + 26;
    P.walker?.stop?.();
    P.faceDir?.('up');
    g.camera.snap?.();
    window.__clean();
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 700));
    return { leaning: g.unkindle.signs.leaningNear(), leaned: g.unkindle.signs.stats.leaned, what: hearth?.objType || 'none' };
  });
  await shot('15-kettle-lean');
  check(kettle.leaning && kettle.leaned > 0, `[${tag}] at night in the Kettle a flame by you leans away and gutters`, JSON.stringify(kettle));

  // The strong signs at night (for the eye): breath, a cold glint, frost in your steps, the slow shadow.
  await ev(async () => {
    const g = window.__game;
    const cf = g.unkindle.coldfire;
    window.__keepMark = { mark: cf.mark, settled: cf.settled };
    cf.mark = 5;
    cf.settled = 5;
    const P = g.player;
    window.__at(P, 86, 61);
    P.faceDir?.('down');
    g.camera.snap?.();
    window.__clean();
    // A few steps along the lane, by the body's own steps (each makes a print).
    for (let i = 0; i < 8; i++) {
      P.x += 5;
      P.stepIndex = (P.stepIndex || 0) + 1;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    P.dir = 'down';
    await new Promise((r) => setTimeout(r, 200));
  });
  await shot('16-signs-night');
  const signsNight = await ev(() => ({ prints: window.__game.unkindle.signs.prints.length, tier: window.__game.unkindle.coldfire.tier() }));
  check(signsNight.prints >= 4 && signsNight.tier === 3, `[${tag}] at night: frost in your footprints (the strong signs drawn)`, JSON.stringify(signsNight));
  // The flowers by your bed: fresh, and at the strongest dead.
  for (const [mk, name] of [
    [0, '17-flowers-fresh'],
    [5, '18-flowers-dead'],
  ]) {
    await ev((mk) => {
      const g = window.__game;
      g.clock.skipTo?.(13);
      g.unkindle.coldfire.mark = mk;
      g.unkindle.coldfire.settled = mk;
      const P = g.player;
      window.__at(P, 94, 77, 8, 4);
      P.faceDir?.('left');
      g.camera.snap?.();
      window.__clean();
    }, mk);
    await wait(500);
    await shot(name);
  }
  await ev(() => {
    const cf = window.__game.unkindle.coldfire;
    cf.mark = window.__keepMark.mark;
    cf.settled = window.__keepMark.settled;
  });

  // ---------- (11) Aveline comes, by day, in private, and asks ----------
  const askBy = async (answer, label) => {
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo?.(11);
      const P = g.player;
      window.__at(P, 100, 61);
      P.faceDir?.('left');
      const av = g.entities.get('aveline');
      window.__at(av, 95, 61, 8, 10);
      delete av.think; // her own day again: the duty walks her to you
      av.mode = 'routine';
      av.state = 'idle';
      g.camera.snap?.();
      window.__clean();
      const sus = g.unkindle.suspicion;
      const st = sus.st('aveline');
      st.signs.flames = (st.signs.flames || 0) + 1;
      st.signs.hands = (st.signs.hands || 0) + 1;
      st.s = 75;
      st.quietUntil = null;
      st.asked = null;
      sus.asking = null;
      sus.tick();
    });
    await until(() => window.__game.unkindle.suspicion.asking?.phase === 'open', null, 25000).catch(() => {});
    await wait(500);
    const open = await ev(() => {
      const g = window.__game;
      const a = g.unkindle.suspicion.asking;
      const chat = document.querySelector('.chat');
      return { phase: a?.phase, line: a?.line || '', chatOpen: !!chat && getComputedStyle(chat).display !== 'none' && !chat.hidden, target: g.ui.chat.target, dist: Math.round(Math.hypot(g.entities.get('aveline').x - g.player.x, g.entities.get('aveline').y - g.player.y)) };
    });
    await shot(`${label}-asks`);
    check(open.phase === 'open' && open.target === 'aveline' && /What are you carrying|cold that takes/.test(open.line), `[${tag}] Aveline walks up, by day and in private, and asks in her own words`, JSON.stringify({ ...open, line: open.line.slice(0, 70) }));
    const fld = open.phase === 'open' ? await page.$('.chat-input textarea, .chat-input input') : null;
    if (fld) {
      await fld.fill(answer);
      await fld.press('Enter');
    }
    await until(() => window.__game.unkindle.suspicion.people.aveline?.asked?.verdict, null, 12000).catch(() => {});
    await wait(700);
    await shot(`${label}-answer`);
    return ev(() => {
      const g = window.__game;
      const st = g.unkindle.suspicion.people.aveline;
      return { verdict: st.asked?.verdict, dark: st.dark, askedStop: st.askedStop, rite: st.riteOffered, text: (document.querySelector('.chat')?.textContent || '').slice(-300), op: g.entities.get('aveline').opinionOfPlayer, wanted: g.murder.isWanted() };
    });
  };
  const op0 = await ev(() => ({ op: window.__game.entities.get('aveline').opinionOfPlayer, wanted: window.__game.murder.isWanted() }));
  const lie = await askBy("No. I've been ill, that's all.", '19');
  check(lie.verdict === 'doubted' || lie.verdict === 'believed', `[${tag}] a lie: she doubts it or believes it, by what she knows`, `${lie.verdict}: ${lie.text.slice(-110)}`);
  check(/watching|fever|Mira|isn't that/.test(lie.text), `[${tag}] her answer in the chat, in her words`, lie.text.slice(-110));
  const truth = await askBy('Yes. I took the life out of three wolves and a bandit. It makes me stronger.', '20');
  check(truth.verdict === 'knows' && truth.askedStop != null && truth.rite, `[${tag}] the truth about the beasts: she knows, asks you to stop, offers the rite`, JSON.stringify({ v: truth.verdict, stop: truth.askedStop, rite: truth.rite }));
  check(/[Ss]top/.test(truth.text) && /chapel/.test(truth.text), `[${tag}] "Stop… come to the chapel flame… your choice"`, truth.text.slice(-140));
  check(op0.op - truth.op <= 10 && truth.wanted === op0.wanted, `[${tag}] dangerous, not evil: her opinion barely moves, nobody is after you for it`, `${op0.op} -> ${truth.op}`);
  await ev(() => {
    const g = window.__game;
    g.ui.chat.close?.();
    g.unkindle.suspicion.asking = null;
    window.__at(g.entities.get('aveline'), 20, 52);
  });

  // ---------- (12) a wolf taken in front of Hobb: dark magic, no crime ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(12);
    const P = g.player;
    window.__at(P, 100, 61);
    P.faceDir?.('right');
    const hobb = g.entities.get('hobb');
    window.__at(hobb, 97, 61, 8, 10);
    hobb.state = 'idle';
    hobb.faceDir?.('right');
    g.unkindle.cooldownUntil = -Infinity;
    window.__prey = window.__spawn('wolf', 101, 61);
    window.__prey.x = P.x + 14;
    window.__prey.y = P.y;
    window.__said = [];
    g.camera.snap?.();
    window.__clean();
    window.__wantedBefore = g.murder.isWanted();
  });
  await wait(450);
  await holdDown();
  await until(() => !window.__game.unkindle.channel && window.__prey?.dead, null, 20000).catch(() => {});
  await holdUp();
  await wait(500);
  await shot('21-dark-seen');
  const dark = await ev(() => {
    const g = window.__game;
    return { saw: g.unkindle.suspicion.people.hobb?.dark, said: (window.__said || []).filter((s) => s.who === 'hobb').map((s) => s.text), wanted: g.murder.isWanted(), before: window.__wantedBefore, rumor: !!g.village.rumors.list.find((r) => r.kind === 'dark_magic'), dark: g.unkindle.suspicion.briefLine('hobb') };
  });
  check(dark.saw === 'saw' && dark.said.length > 0, `[${tag}] Hobb saw it: shaken, dark magic, in his words`, dark.said.join(' | '));
  check(dark.wanted === dark.before && dark.rumor && /Dangerous, not evil/.test(dark.dark) && !/killer/.test(dark.dark), `[${tag}] no crime: a rumour of dark magic; what he knows of it, "dangerous, not evil"`, dark.dark.slice(0, 120));

  // ---------- (13) stop for weeks: the bar ebbs, the signs fade, "You're warmer" ----------
  const stopped = await ev(async () => {
    const g = window.__game;
    for (let d = 0; d < 26; d++) {
      g.clock.t += 900;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    g.clock.skipTo?.(12);
    const P = g.player;
    window.__at(P, 100, 61);
    P.faceDir?.('left');
    const av = g.entities.get('aveline');
    window.__at(av, 99, 61, 4, 10);
    av.state = 'idle';
    av.faceDir?.('right');
    window.__said = [];
    g.unkindle.suspicion.barkAt = -Infinity;
    g.camera.snap?.();
    window.__clean();
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 1600));
    const cf = g.unkindle.coldfire;
    return { bar: cf.bar, tier: cf.tier(), s: Math.round(g.unkindle.suspicion.people.aveline?.s ?? -1), said: (window.__said || []).filter((s) => s.who === 'aveline').map((s) => s.text), meter: !!document.querySelector('.meter-coldfire:not([hidden])') };
  });
  await shot('22-warmer');
  check(stopped.bar === 0 && stopped.tier === 0, `[${tag}] weeks later: the bar has ebbed, the signs are gone`, JSON.stringify({ bar: stopped.bar, tier: stopped.tier }));
  check(stopped.said.some((t) => /warmer|colour/i.test(t)), `[${tag}] Aveline: "You're warmer. Thank you."`, stopped.said.join(' | '));

  // ---------- (14) the skeletons by Brindlecombe's graveyard: nothing in there to take ----------
  const bone = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(23);
    const P = g.player;
    const z = (g.spawner?.zones || []).find((x) => x.id === 'brindle_dead_night');
    const r = z?.rect || z?.area || z;
    const tx = Math.round((r?.x ?? -328) + (r?.w ?? 44) / 2);
    const ty = Math.round((r?.y ?? 26) + (r?.h ?? 40) / 2);
    window.__at(P, tx, ty);
    P.faceDir?.('right');
    window.__bone = window.__spawn('skeleton', tx + 1, ty);
    window.__bone.x = P.x + 14;
    window.__bone.y = P.y;
    g.camera.snap?.();
    window.__toasts.length = 0;
    window.__clean();
    const r2 = g.unkindle.targetInReach();
    return { refusal: r2.refusal?.reason || null, target: !!r2.target, place: g.locations.at(P.x, P.y)?.id || '' };
  });
  await wait(500);
  if (!S.phone) {
    await page.keyboard.down('f');
    await wait(250);
    await page.keyboard.up('f');
  }
  await wait(200);
  await shot('23-skeleton');
  const boneR = await ev(() => ({ toasts: window.__toasts.slice(), ch: !!window.__game.unkindle.channel, alive: !window.__bone.dead, btn: !!document.querySelector('.unk-btn:not([hidden])') }));
  check(bone.refusal === 'undead' && !bone.target && boneR.alive && !boneR.ch, `[${tag}] a skeleton by the graveyard: nothing in there to take`, JSON.stringify({ ...bone, ...boneR }));
  if (!S.phone) check(boneR.toasts.includes('Nothing in there to take.'), `[${tag}] F on it: "Nothing in there to take."`, boneR.toasts.join(' | '));
  else check(!boneR.btn, `[${tag}] no dark hand for the dead`);

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
