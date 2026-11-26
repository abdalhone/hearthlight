// Round 14b follow-up: casting stops you (plan §14, verifier item 27) and the dark path you can
// leave (plan §13c, verifier item 28), played in the built game on a phone held sideways
// (844x390, 4x CPU throttle for the casting) and upright (390x844) by real touches, and on a
// computer (1280x720) by keys and the mouse.
//
// 27: hold to charge a weave and push the stick (or D): you turn, you do not walk; roll, and
//     the charge breaks; tap-cast while running: a short plant, then you run on at full speed;
//     the stance's hint is said once.
// 28: take the pact; his single ask (a named person), done: their missions and roles close or
//     pass on, and the journal says so; refuse the next ask: the pact holds; "I'm done" in
//     your own words: the pact ends, you keep the Unkindling, nobody was warned; go back: a
//     higher price; refuse it; on that later night he stands against you; the hero ending.
//
// State is set up through the game hooks other check scripts use (window.__game); the acts
// go through real input (the weave button or key, the stick or WASD, the roll, the chat field,
// the dialog's options, the quest line, the close buttons).
//
//   node scripts/followup_check.mjs [--out DIR] [--only sideways,upright,desktop]
//   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/followup';
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${String(info).slice(0, 900)}` : ''}`);
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
  for (const t of ['cast_broken', 'cast_stand', 'pact_sealed', 'pact_ended', 'tempter_ask', 'tempter_return', 'tempter_stands', 'villain_ending', 'mission_passed', 'spell_cast'])
    g.bus.on(t, (p) => window.__ev.push({ t, why: p?.why ?? null, how: p?.how ?? null, state: p?.state ?? null, kind: p?.ask?.kind ?? null, target: p?.ask?.target ?? null, ending: p?.ending ?? null, held: p?.held ?? null, chargeK: p?.chargeK ?? null, player: p?.caster ? p.caster === g.player : null }));
  window.__toasts = [];
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
  // A frame sampler (one row per drawn frame) for the feet.
  window.__sample = (on) => {
    const P = g.player;
    if (!on) {
      window.__sampling = false;
      return window.__samples || [];
    }
    window.__samples = [];
    window.__sampling = true;
    const tick = (t) => {
      window.__samples.push({ t, x: P.x, y: P.y, plant: P.castPlantT || 0, st: g.magic?.castingState?.(P) || null, roll: !!P.rolling, dir: P.dir });
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return [];
  };
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
  const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true).catch(() => false);
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return null;
    if (S.phone) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await wait(300);
    return r;
  };
  const option = async (sel) => {
    for (let i = 0; i < 30; i++) {
      if (await rectOf(sel)) return press(sel);
      await press('.panel-dialog .dlg-box');
      await wait(250);
    }
    return null;
  };

  // ---- fingers (phones) and keys (computer)
  const fingers = new Map(); // id -> {x, y}
  const touch = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
  const fingerDown = async (id, x, y) => {
    fingers.set(id, { x: Math.round(x), y: Math.round(y) });
    await touch('touchStart');
  };
  const fingerMove = async (id, x, y) => {
    fingers.set(id, { x: Math.round(x), y: Math.round(y) });
    await touch('touchMove');
  };
  // Lift one finger: a touchEnd naming only that point (a touchMove without it lifts nothing).
  const fingerUp = async (id) => {
    const p = fingers.get(id);
    fingers.delete(id);
    if (p) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  };
  const allUp = async () => {
    fingers.clear();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
  };
  const WEAVE = '.tcluster .wbtn[data-slot="0"]';
  const weaveDown = async () => {
    if (!S.phone) return page.keyboard.down('1');
    const r = await rectOf(WEAVE);
    if (!r) return false;
    await fingerDown(7, r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  const weaveUp = async () => (S.phone ? fingerUp(7) : page.keyboard.up('1'));
  const moveOn = async (dx = 1) => {
    if (!S.phone) return page.keyboard.down(dx > 0 ? 'd' : 'a');
    const z = await rectOf('.stick-zone');
    if (!z) return false;
    const at = { x: z.x + z.w * 0.4, y: z.y + z.h * 0.6 };
    await fingerDown(8, at.x, at.y);
    for (let i = 1; i <= 4; i++) {
      await fingerMove(8, at.x + dx * i * 12, at.y);
      await wait(30);
    }
    return true;
  };
  const moveOff = async (dx = 1) => (S.phone ? fingerUp(8) : page.keyboard.up(dx > 0 ? 'd' : 'a'));
  const roll = async () => {
    if (!S.phone) return page.keyboard.press('k');
    const r = await rectOf('.tbtn-dodge');
    if (!r) return false;
    await fingerDown(9, r.x + r.w / 2, r.y + r.h / 2);
    await wait(70);
    await fingerUp(9);
    return true;
  };
  // Talk (T, or the phone's Talk button) to whoever is in front: him, at the gate. Once more if
  // the first press found nobody (a frame where the button was still changing).
  const talk = async () => {
    for (let i = 0; i < 2; i++) {
      if (S.phone) await press('.tbtn-interact');
      else await page.keyboard.press('t');
      await wait(500);
      const ok = await ev(() => window.__game.ui.chat.isOpen?.() && window.__game.ui.chat.target === 'isembard');
      if (ok) return true;
      await ev(() => {
        const g = window.__game;
        g.ui.chat.close?.();
        const t = g.villain.tempter;
        if (t) {
          g.player.x = t.x - 18;
          g.player.y = t.y;
          g.player.facing = { x: 1, y: 0 };
          g.player.dir = 'right';
        }
      });
      await wait(300);
    }
    return false;
  };
  // Type into the chat field and send; make sure it went (a row with the words), else once more.
  const say = async (text) => {
    for (let tries = 0; tries < 2; tries++) {
      await press('.chat-field');
      const focused = await ev(() => document.activeElement?.classList?.contains('chat-field'));
      if (!focused) await ev(() => document.querySelector('.chat-field')?.focus());
      await ev(() => {
        const f = document.querySelector('.chat-field');
        if (f) f.value = '';
      });
      await page.keyboard.type(text, { delay: 4 });
      await page.keyboard.press('Enter');
      const sent = await until((t) => [...document.querySelectorAll('.chat-log .msg')].some((r) => r.textContent.includes(t)), text, 3000);
      if (sent) break;
    }
    await wait(900);
  };
  const lastRows = () => ev(() => [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-4));
  const closeChat = async () => {
    const r = await rectOf('.chat-close');
    if (r) {
      check(r.w >= 44 && r.h >= 44, `[${tag}] the chat's close is finger-sized`, `${r.w}x${r.h}`);
      await press('.chat-close');
    } else await ev(() => window.__game.ui.chat.close());
    await wait(300);
  };

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(700);
  await ev(pageSetup);
  await wait(200);

  // ================================================================ 27: casting stops you
  const meadow = async (faceLeft = true) =>
    ev((faceLeft) => {
      const g = window.__game;
      const P = g.player;
      window.__away();
      window.__at(P, 100, 61, false);
      P.vel.x = P.vel.y = 0;
      P.facing = { x: faceLeft ? -1 : 1, y: 0 };
      P.dir = faceLeft ? 'left' : 'right';
      P.hp = P.maxHp;
      g.clock.skipTo?.(12);
      g.magic.mana.cur = g.magic.mana.max;
      g.magic.resetCooldowns?.();
      g.camera.snap?.();
      return { x: P.x, y: P.y, speed: P.speed };
    }, faceLeft);
  const throttle = async (on) => {
    if (!S.throttle) return;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: on ? S.throttle : 1 });
  };

  // (a) Hold to charge, push the stick or D: you turn, you do not walk; the hint once.
  await throttle(true);
  const m0 = await meadow(true);
  await ev(() => {
    window.__game.flags.standHintShown = false;
  });
  const slotOk = await rectOf(S.phone ? WEAVE : '.hotbar .hslot');
  check(!!slotOk, `[${tag}] 27 a weave on its button`);
  await weaveDown();
  await wait(150);
  await moveOn(1);
  await ev(() => window.__sample(true));
  await wait(1300);
  const samples = await ev(() => window.__sample(false));
  const fps = samples.length >= 2 ? (samples.length - 1) / ((samples.at(-1).t - samples[0].t) / 1000) : 0;
  const charge = await ev((m0) => {
    const g = window.__game;
    const P = g.player;
    const h = g.magic.holdOf(P);
    return { st: g.magic.castingState(P), k: h?.k ?? 0, moved: Math.hypot(P.x - m0.x, P.y - m0.y), dir: P.dir, mul: P.castMoveMul, hint: window.__toasts.some((t) => /stand still to weave/i.test(t)) };
  }, m0);
  await shot('27-charge-push');
  check(charge.st === 'charge' && charge.k > 0.3, `[${tag}] 27 the charge gathers while held`, JSON.stringify(charge));
  check(charge.moved < 1.5, `[${tag}] 27 pushing ${S.phone ? 'the stick' : 'D'} while it gathers: you do not walk`, `${charge.moved.toFixed(2)} px`);
  check(charge.dir === 'right', `[${tag}] 27 ... you turn (facing ${charge.dir})`);
  check(charge.hint, `[${tag}] 27 the stance is said once: "You stand still to weave. Roll to break off."`);
  if (S.throttle) check(fps >= 12, `[${tag}] 27 4x CPU: the charge stays smooth`, `${fps.toFixed(1)} fps`);
  // (b) Roll: the charge breaks, and you roll.
  const r0 = await ev(() => ({ x: window.__game.player.x, mana: window.__game.magic.mana.cur }));
  await roll();
  await wait(120);
  const rolled = await ev(() => {
    const g = window.__game;
    const P = g.player;
    return { rolling: P.rolling, hold: !!g.magic.holdOf(P), broken: window.__ev.some((e) => e.t === 'cast_broken' && e.why === 'roll' && e.held) };
  });
  await shot('27-roll-breaks');
  await wait(600);
  const after = await ev(() => ({ x: window.__game.player.x, mana: window.__game.magic.mana.cur, cast: window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length }));
  check(rolled.broken && !rolled.hold, `[${tag}] 27 a roll breaks the charge`, JSON.stringify(rolled));
  check(after.x - r0.x > 10, `[${tag}] 27 ... and you roll away`, `${(after.x - r0.x).toFixed(1)} px`);
  await moveOff(1);
  await weaveUp();
  await wait(300);
  const noCast = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
  check(noCast === 0, `[${tag}] 27 letting go after the roll casts nothing (the charge was broken, free)`, `${noCast} casts`);
  // (c) Tap-cast while running: a short plant, then you run on at full speed.
  await meadow(false);
  await moveOn(1);
  await wait(700);
  await ev(() => window.__sample(true));
  await wait(150);
  await weaveDown();
  await wait(60);
  await weaveUp();
  await wait(950);
  const run = await ev(() => window.__sample(false));
  await moveOff(1);
  await throttle(false);
  const planted = run.filter((s) => s.plant > 0);
  const plantMs = planted.length ? planted.at(-1).t - planted[0].t : 0;
  const plantMoved = planted.length ? Math.abs(planted.at(-1).x - planted[0].x) : 99;
  const tail = run.filter((s) => s.t > (planted.at(-1)?.t ?? 0) + 250);
  const runSpeed = tail.length >= 2 ? (tail.at(-1).x - tail[0].x) / ((tail.at(-1).t - tail[0].t) / 1000) : 0;
  const speed = await ev(() => window.__game.player.speed * (window.__game.player.speedMul || 1));
  const tapCast = await ev(() => window.__ev.filter((e) => e.t === 'spell_cast' && e.player).length);
  check(tapCast >= 1, `[${tag}] 27 the tap cast flew`);
  check(planted.length > 3 && plantMoved < 0.6, `[${tag}] 27 a tap while running plants you for the pose`, `planted ${plantMs.toFixed(0)} ms, moved ${plantMoved.toFixed(2)} px over ${planted.length} frames`);
  check(plantMs >= 150 && plantMs <= 520, `[${tag}] 27 ... a short plant (${plantMs.toFixed(0)} ms)`);
  check(runSpeed > speed * 0.85, `[${tag}] 27 ... then you run on at full speed`, `${runSpeed.toFixed(1)} of ${speed.toFixed(1)} px/s`);
  await allUp().catch(() => {});

  // ================================================================ 28: the dark path you can leave
  const toGate = async () => {
    const ok = await until(() => !!window.__game.villain?.tempter, null, 10000);
    if (!ok) return false;
    await ev(() => {
      const g = window.__game;
      const t = g.villain.tempter;
      const P = g.player;
      P.x = t.x - 18;
      P.y = t.y;
      P.vel.x = P.vel.y = 0;
      P.facing = { x: 1, y: 0 };
      P.dir = 'right';
      g.camera.snap?.();
      window.__game.ui.chat.target = '@near';
    });
    await wait(300);
    return true;
  };
  const nextNight = async () => {
    await ev(() => {
      const g = window.__game;
      g.ui.closeAll?.();
      g.ui.chat.close?.();
      g.clock.skipTo(12);
    });
    await wait(700);
    await ev(() => window.__game.clock.skipTo(22));
    await wait(400);
    return toGate();
  };
  const V = () => ev(() => {
    const g = window.__game;
    const s = g.villain.state;
    const a = g.villain.currentAsk();
    return { pact: g.villain.hasPact(), ended: s.ended, hostile: s.hostile, returns: s.returns, offer: s.returnOffer, ask: a ? { kind: a.kind, target: a.target, state: a.state } : null, asks: s.asks.map((x) => `${x.kind}:${x.target}:${x.state}`), learned: !!g.unkindle?.learned, fighting: s.fighting, ending: s.ending, warned: s.warned.length };
  });

  await ev(() => {
    const g = window.__game;
    window.__away();
    g.flags.bosses = { varek: { defeated: true, shards: {} } };
    // Rowan's own drill, taken: if he is the one asked for, the journal shows it pass on.
    g.missions?.accept?.('spear_drill', { silent: true });
    g.clock.skipTo(22);
  });
  check(await toGate(), `[${tag}] 28 he waits at the ruins gate at night`);
  // The pact, in your own words.
  await talk();
  const target = await ev(() => window.__game.ui.chat.target);
  check(target === 'isembard', `[${tag}] 28 Talk reaches him`, target);
  await say('Fine. Teach me after.');
  let v = await V();
  check(v.pact && v.learned, `[${tag}] 28 the pact (after): the Unkindling is taught`, JSON.stringify(v));
  await closeChat();

  // Night 2: his single ask (a named person): yes, by an option; it is done.
  check(await nextNight(), `[${tag}] 28 the next night he is there`);
  if (S.phone) {
    await talk();
    await say('What do you want of me tonight?');
    v = await V();
    const rows = await lastRows();
    check(v.ask?.kind === 'person' && v.ask.state === 'offered', `[${tag}] 28 he asks for one person`, JSON.stringify(v.ask));
    check(rows.join(' ').length > 10, `[${tag}] 28 ... in his words`, rows.join(' | '));
    await shot('28-ask-person');
    await say("Yes. I'll do it.");
    await closeChat();
  } else {
    await page.keyboard.press('e');
    await wait(700);
    v = await V();
    check(v.ask?.kind === 'person' && v.ask.state === 'offered', `[${tag}] 28 he asks for one person`, JSON.stringify(v.ask));
    await shot('28-ask-person');
    await option('.panel-dialog .opt-ask_yes');
    await wait(400);
    await option('.panel-dialog .opt-bye');
  }
  v = await V();
  const asked = v.ask?.target;
  check(v.ask?.state === 'accepted' && v.pact, `[${tag}] 28 ... agreed`, JSON.stringify(v.ask));
  // Do it (the deed through the murder's own hooks: killed by the stranger, the body found).
  await ev((id) => {
    const g = window.__game;
    const e = g.entities.get(id);
    g.murder.kill(e, g.player);
    const rec = g.murder.dead[id];
    rec.known = 'witnessed';
    if (rec.alarm) rec.alarm.raised = true;
    rec.foundAt = g.clock.t;
    rec.newsWaits = false;
    g.missions?.update?.(1);
  }, asked);
  await wait(600);
  v = await V();
  check(v.asks.includes(`person:${asked}:done`), `[${tag}] 28 the ask is done when they die by your hand`, v.asks.join(','));
  // The journal says so (the quest line opens it).
  await ev(() => window.__game.ui.closeAll?.());
  const qOpen = (await press('.quest-line')) || (await ev(() => (window.__game.ui.openMissions('active'), true)));
  await wait(500);
  const jr = await ev((id) => {
    const card = document.querySelector(`.mj-gone[data-id="${id}"]`);
    const note = [...document.querySelectorAll('.mj-gone-note')].map((n) => n.textContent);
    card?.scrollIntoView?.({ block: 'center' });
    return { has: !!card, lines: card ? [...card.querySelectorAll('li')].map((l) => l.textContent) : [], note };
  }, asked);
  await wait(250);
  await shot('28-journal-stays-done');
  check(!!qOpen && jr.has, `[${tag}] 28 the journal: "What is done stays done" for ${asked}`, JSON.stringify(jr).slice(0, 600));
  check(jr.lines.some((l) => /keeps|takes the chair|seat at the Moot|passes|sees it done|ends here/.test(l)), `[${tag}] 28 ... their missions and roles close or pass on`, jr.lines.join(' | '));
  if (asked === 'rowan') check(jr.note.some((n) => /Rowan is dead\. Wys sees it done now/.test(n)), `[${tag}] 28 ... and Rowan's drill says who sees it done`, jr.note.join(' | '));
  const jClose = await rectOf('.panel-missions .panel-close');
  check(!!jClose && jClose.w >= 44 && jClose.h >= 44, `[${tag}] 28 the journal closes by a finger-sized button`, JSON.stringify(jClose));
  if (jClose) await press('.panel-missions .panel-close');

  // Night 3: the next ask: no. The pact holds. Then "I'm done", in your own words.
  check(await nextNight(), `[${tag}] 28 night three`);
  await talk();
  await say('Is there something else?');
  v = await V();
  check(!!v.ask && v.ask.state === 'offered', `[${tag}] 28 another ask`, JSON.stringify(v.ask));
  await say('No. Not that.');
  v = await V();
  check(v.pact && v.asks.some((x) => /:refused$/.test(x)), `[${tag}] 28 refused: the pact holds`, JSON.stringify(v));
  await say("I'm done. I won't kill for you anymore.");
  v = await V();
  const done = await ev(() => {
    const g = window.__game;
    const ids = [...g.villageLife.villagers().map((e) => e.id), 'lyra'];
    return { oath: ids.filter((id) => g.reputation.titles({ knownTo: id }).some((t) => t.id === 'oathbreaker')), rumour: g.village.rumors.list.some((r) => r.kind === 'tempter_warning') };
  });
  await shot('28-im-done');
  check(v.ended && !v.pact && v.hostile, `[${tag}] 28 "I'm done": the pact ends; he is cold`, JSON.stringify(v));
  check(v.learned, `[${tag}] 28 ... you keep the Unkindling`);
  check(v.warned === 0 && !done.rumour && !done.oath.length, `[${tag}] 28 ... nobody was warned; the broken word is his to know`, JSON.stringify(done));
  check((await lastRows()).join(' ').length > 10, `[${tag}] 28 ... he answers in his own words`, (await lastRows()).join(' | '));
  await closeChat();

  // Night 4: go back: a higher price. Say no to it. Then, silent beside him, he stands against you.
  check(await nextNight(), `[${tag}] 28 night four`);
  await talk();
  await say('I changed my mind. I want the pact back.');
  v = await V();
  const toll = v.offer?.toll?.map((p) => p.id) || [];
  check(toll.length >= 1, `[${tag}] 28 going back: a higher price (${toll.join(', ')} first)`, JSON.stringify(v.offer));
  const minorToll = await ev((ids) => ids.filter((id) => window.__game.entities.get(id)?.isChild?.() || ['pip', 'tansy'].includes(id)), toll);
  check(!minorToll.length, `[${tag}] 28 ... never a child`, minorToll.join(','));
  // He names the price in his own words (the lines come one after the other).
  const named = await until((id) => {
    const n = window.__game.entities.get(id)?.profile?.name?.split(' ')[0] || id;
    return [...document.querySelectorAll('.chat-log .msg')].slice(-3).some((r) => r.textContent.includes(n));
  }, toll[0], 8000);
  check(named, `[${tag}] 28 ... he names the price in the chat`);
  await shot('28-higher-price');
  await say('No. Not at that price.');
  v = await V();
  check(!v.offer && v.ended && !v.pact, `[${tag}] 28 refused: still no pact`, JSON.stringify(v));
  await closeChat();
  await ev(() => {
    const g = window.__game;
    const t = g.villain.tempter;
    g.player.x = t.x - 34;
    g.player.y = t.y;
    g.camera.snap?.();
  });
  const stands = await until(() => !!window.__game.villain.state.fighting, null, 20000);
  await wait(500);
  await shot('28-stands-against-you');
  check(stands, `[${tag}] 28 that later night, silent beside him: he stands against you`);
  // The hero ending stays open: struck down, he comes apart.
  await ev(() => {
    const g = window.__game;
    const t = g.villain.tempter;
    g.player.hp = g.player.maxHp;
    t.hp = 1;
    g.combat.damage(g.player, t, 999, { exact: true });
  });
  const hero = await until(() => window.__game.villain.state.ending === 'hero', null, 10000);
  check(hero, `[${tag}] 28 the hero ending is still reachable`);
  await wait(1200);
  await shot('28-hero');
  // Let the scene go (a tap or a key), so the page is left playing.
  for (let i = 0; i < 12; i++) {
    const playing = await ev(() => window.__game.state === 'playing' && !document.querySelector('.cutscene:not([hidden]), .scene:not([hidden])'));
    if (playing) break;
    if (S.phone) await page.touchscreen.tap(S.w / 2, S.h / 2);
    else await page.keyboard.press('Space');
    await wait(500);
  }
  check(!errors.length, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await allUp().catch(() => {});
  await ctx.close();
}

try {
  for (const S of SIZES) {
    console.log(`=== ${S.tag} ${S.w}x${S.h}`);
    try {
      await play(S);
    } catch (err) {
      check(false, `[${S.tag}] ran to the end`, err?.stack || String(err));
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed${failures.length ? `; failed:\n  ${failures.join('\n  ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
