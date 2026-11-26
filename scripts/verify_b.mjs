// Round 14b, independent verifier B: what the author would do that the story run does not.
// Played in the built game on a phone held sideways (844x390) and upright (390x844) by real
// taps, and on a computer (1280x720) by keys and mouse. Claude offline, with the village stub
// the story run uses (it records each task).
//
//   11. Lyra, with you, struck by your own sword until she falls (no scripted damage), then the
//       held blow: she can be caught; no "help her up" call is left over her body; the slot
//       empties; Pip: "No. Not a child."
//   15. The trial after a real fight: Bram swings first, Elda watches, the stranger kills him
//       and says "He struck me first". Elda bears it out to the Moot, and the room hears her.
//   28. The dark path left in the author's own words, typed: "I want to stop." The pact ends,
//       he turns cold in the chat, the Unkindling stays; a single ask refused in plain words
//       ("I don't want to kill him") leaves the pact standing.
//
//   node scripts/verify_b.mjs [--out DIR] [--only sideways,upright,desktop] [--items 11,15,28]
//   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/verify_b';
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

// The page's own setup after a new game (or a loaded one): noon, the coach quiet, the
// village Claude stub, an event log, and the helpers every item uses.
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
  window.__ev = [];
  const TYPES = ['villager_killed', 'villager_died', 'crime', 'finisher', 'lock_changed', 'companion_changed', 'pact_sealed', 'killing_known', 'hunt_started', 'child_hides', 'child_taken_away', 'store_burned', 'body_searched', 'theft_recognized', 'memories_shared', 'letter_read', 'parting', 'dark_verdict', 'unkindled', 'talk_opened'];
  for (const t of TYPES)
    g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? p?.target?.id ?? p?.npc?.id ?? null, why: p?.why ?? null, from: p?.from ?? null, to: p?.to ?? null, kind: p?.kind ?? p?.mode ?? null, gifts: p?.gifts ?? null, w: Array.isArray(p?.witnesses) ? p.witnesses.map((x) => (typeof x === 'string' ? x : x?.id)) : null }));
  window.__toasts = [];
  if (!g.ui.__wrapped) {
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.ui.__wrapped = true;
  }
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  // A Claude for the villagers the run can steer: plain, silent, terror, or a yes to join.
  window.__vClaude = 'plain';
  window.__vTasks = [];
  const v = g.village;
  v.provider = () => ({ id: 'check' });
  v.askClaude = async (p, rules, task, schema, kind) => {
    window.__vTasks.push({ kind, task: String(task).slice(0, 40000) });
    const base = { say: '', silent: null, action: null, act: null, mood: 'warm', opinion_delta: 0, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
    if (kind === 'aloud') {
      const ids = [...String(task).matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((x) => g.entities.get(x));
      return { replies: ids.slice(0, 3).map((id, i) => ({ who: id, say: ['Good morning to you too!', 'Hmph. Morning.', 'Morning! Morning!'][i % 3], action: null, mood: 'warm', opinion_delta: 1, memory: null })) };
    }
    if (window.__vClaude === 'silent') return { ...base, action: 'turn_away', mood: 'cold', opinion_delta: -1 };
    if (window.__vClaude === 'terror') return { ...base, say: 'Don’t come near me! Somebody, help!', action: 'flee', mood: 'afraid', opinion_delta: -2 };
    if (window.__vClaude === 'yesjoin') return { ...base, say: 'Aye, I will come with you!', act: 'join' };
    return { ...base, say: 'Well, good day to you.', opinion_delta: 1 };
  };
  window.__at = (e, tx, ty, still = true) => {
    e.x = tx * 16 + 8;
    e.y = ty * 16 + 10;
    e.walker?.stop?.();
    if (e.r) e.r.key = null;
    if (still) e.think = () => {};
  };
  window.__put = (e, x, y, still = true) => {
    e.x = x;
    e.y = y;
    e.walker?.stop?.();
    if (e.r) e.r.key = null;
    if (still) e.think = () => {};
  };
  window.__away = (keep = []) => {
    for (const e of g.villageLife.villagers()) if (!keep.includes(e.id)) window.__at(e, 20 + Math.random() * 4, 52);
  };
  window.__lyraAway = () => {
    const L = g.companion;
    if (L && !L.dead) {
      L.x = 150 * 16;
      L.y = 112 * 16;
      L._heldController = L._heldController || L.controller;
      L.controller = null;
    }
  };
  window.__clean = () => {
    try {
      g.ui?.closeAll?.();
      g.ui?.chat?.close?.();
      // The next Talk is a fresh turn to whoever it is (the chat notes fear on a turn).
      if (g.ui?.chat && g.ui.chat.target !== 'lyra') g.ui.chat.target = '@near';
      document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
    } catch {
      /* cosmetic */
    }
  };
  window.__sq = g.locations.get('town_square').center;
  window.__hudText = () => {
    const hud = document.querySelector('.hud');
    const walk = (n, out) => {
      if (n.nodeType === 3) out.push(n.textContent);
      else if (n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return out;
        for (const c of n.childNodes) walk(c, out);
      }
      return out;
    };
    return hud ? walk(hud, []).join(' ').replace(/\s+/g, ' ') : '';
  };
  window.__vis = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Midday for a new game; a loaded game keeps its own hour unless it is far from midday.
  const h = g.clock.hour;
  if (!(h >= 10 && h <= 15)) g.clock.skipTo?.(12);
  window.__clean();
}

async function play(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  let page = await ctx.newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`);
    });
  };
  watch(page);
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
  // A dialog option: tap the box until the choices show, then the option.
  const option = async (sel) => {
    for (let i = 0; i < 30; i++) {
      if (await rectOf(sel)) return press(sel);
      await press('.panel-dialog .dlg-box');
      await wait(250);
    }
    return null;
  };
  const talk = async () => {
    if (S.phone) await press('.tbtn-interact');
    else await page.keyboard.press('t');
    await wait(450);
  };
  const say = async (text) => {
    await press('.chat-field');
    await page.keyboard.type(text, { delay: 4 });
    await page.keyboard.press('Enter');
  };
  const chatState = () =>
    ev(() => {
      const c = window.__game.ui.chat;
      return { open: c.isOpen(), target: c.target, disabled: !!c.field?.disabled, ph: c.field?.placeholder || '', chips: [...document.querySelectorAll('.chat-chips .chip')].map((b) => b.textContent), rows: [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-8) };
    });
  // Stand beside someone, facing them.
  const standBy = (id, dx = 18) =>
    ev(
      ({ id, dx }) => {
        const g = window.__game;
        const e = id === 'lyra' ? g.companion : g.entities.get(id);
        const P = g.player;
        P.x = e.x + dx;
        P.y = e.y;
        P.facing = { x: dx > 0 ? -1 : 1, y: 0 };
        P.dir = dx > 0 ? 'left' : 'right';
        g.camera.snap?.();
      },
      { id, dx },
    );
  const swing = async () => {
    if (S.phone) await press('.tbtn-attack');
    else await page.keyboard.press('j');
    await wait(260);
  };
  const holdSword = async (ms) => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      if (!r) return false;
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 7 }] });
      await wait(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.keyboard.down('j');
      await wait(ms);
      await page.keyboard.up('j');
    }
    await wait(200);
    return true;
  };
  // A finishing blow on someone already down: stand over them, hold the sword.
  const finish = async (id) => {
    await ev((id) => {
      const g = window.__game;
      const v = id === 'lyra' ? g.companion : g.entities.get(id);
      g.player.x = v.x - 14;
      g.player.y = v.y;
      g.player.faceToward(v.x, v.y);
      g.camera.snap?.();
    }, id);
    await holdSword(1900);
    await wait(300);
  };
  const boot = async () => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  };
  const fresh = async () => {
    await boot();
    await ev(() => window.__game.newGame());
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
    await wait(600);
    await ev(pageSetup);
    await wait(200);
  };
  // Save, reload the page, continue: the run picks up the loaded game.
  let savedDay = null;
  const reload = async () => {
    savedDay = await ev(async () => {
      await window.__game.save.save('r14b_story');
      return window.__game.clock.day;
    });
    await boot();
    const ok = await ev(async () => !!(await window.__game.continueGame()));
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 }).catch(() => {});
    await wait(600);
    await ev(pageSetup);
    return ok;
  };
  const item = async (n, title, fn) => {
    if (ITEMS && !ITEMS.has(n)) return;
    console.log(`--- [${tag}] item ${n}: ${title}`);
    try {
      await fn();
    } catch (err) {
      check(false, `[${tag}] ${n} ran to the end`, err?.message || String(err));
    }
    await ev(() => window.__clean?.()).catch(() => {});
  };
  // The square at noon with a few people held where they are put; the rest away.
  const square = (spots) =>
    ev((spots) => {
      const g = window.__game;
      // Midday (not a jump to tomorrow's noon when it is already midday).
      const h = g.clock.hour ?? (g.clock.t % 900) / 37.5;
      if (!(h >= 10 && h <= 15)) g.clock.skipTo?.(12);
      const sq = window.__sq;
      window.__away(Object.keys(spots));
      for (const [id, [dx, dy]] of Object.entries(spots)) {
        const e = g.entities.get(id);
        if (e) window.__put(e, sq.x + dx, sq.y + dy);
      }
      window.__lyraAway();
      g.player.x = sq.x + 120;
      g.player.y = sq.y + 80;
      g.camera.snap?.();
    }, spots);


  // On a computer the blade follows the mouse (DESIGN §22.4): a player points at who they
  // strike. On a phone the swing goes where you face.
  const aimAt = async (id) => {
    if (S.phone) return;
    const at = await ev((id) => {
      const g = window.__game;
      const e = id === 'lyra' ? g.companion : g.entities.get(id);
      return e ? g.renderer.worldToCss(e.x, e.y - 8) : null;
    }, id);
    if (at) await page.mouse.move(at.x, at.y);
  };

  // ================================================================ 11: Lyra, by your own hand
  if (!ITEMS || ITEMS.has(11)) await fresh();
  await item(11, 'Lyra struck down by hand, then the held blow', async () => {
    await ev(() => {
      const g = window.__game;
      window.__away(['pip']);
      const P = g.player;
      window.__at(P, 97, 103, false);
      // A strong stranger (the fight is about her, not about surviving her).
      P.maxHp = 600;
      P.hp = 600;
      const L = g.companion;
      L.x = P.x + 22;
      L.y = P.y;
      g.camera.snap?.();
      window.__lyraStart = { x: L.x, y: L.y };
      window.__opens = [];
      const o = g.ui.chat.open.bind(g.ui.chat);
      g.ui.chat.open = (...a) => {
        window.__opens.push('open ' + new Error('open').stack.split('\n').slice(1, 9).map((x) => x.trim().slice(0, 90)).join(' <- '));
        return o(...a);
      };
      for (const k of ['talkTo', 'talkToNearest']) {
        const f = g.ui[k].bind(g.ui);
        g.ui[k] = (...a) => {
          window.__opens.push(k + ' ' + new Error(k).stack.split('\n').slice(1, 9).map((x) => x.trim().slice(0, 90)).join(' <- '));
          return f(...a);
        };
      }
    });
    await wait(400);
    // Chase and strike, as a player would: walk at her (keys or the stick), swing when close.
    const stick = async (dx, dy, ms) => {
      if (S.phone) {
        const r = await rectOf('.joystick, .stick, .touch-stick');
        const ox = r ? r.x + r.w / 2 : 90;
        const oy = r ? r.y + r.h / 2 : S.h - 90;
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ox, y: oy, id: 3 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: ox + dx * 40, y: oy + dy * 40, id: 3 }] });
        await wait(ms);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: ox + dx * 40, y: oy + dy * 40, id: 3 }] });
        await cdp.detach();
      } else {
        const keys = [];
        if (dx > 0.3) keys.push('d');
        if (dx < -0.3) keys.push('a');
        if (dy > 0.3) keys.push('s');
        if (dy < -0.3) keys.push('w');
        for (const k of keys) await page.keyboard.down(k);
        await wait(ms);
        for (const k of keys) await page.keyboard.up(k);
      }
    };
    // A strong stranger: the fight is about her, not about surviving her bolts and binds.
    await ev(() => {
      const g = window.__game;
      g.stats?.addModifier?.(g.player, { id: 'vb_strong', source: 'vb', label: 'Strong', kind: 'buff', add: { maxHp: 600 } });
      g.player.hp = g.player.maxHp;
    });
    const state = () =>
      ev(() => {
        const g = window.__game;
        const L = g.companion;
        const P = g.player;
        if (P.hp < P.maxHp * 0.6) P.hp = P.maxHp;
        return { dx: L.x - P.x, dy: L.y - P.y, d: Math.hypot(L.x - P.x, L.y - P.y), downed: !!L.downed, dead: !!L.dead, dir: L.behavior?.directive?.type || '', winded: L._windedFrom != null, speed: L.speed };
      });
    // 1. A blow that lands, then she keeps away; chase her on foot (keys or the stick) and see
    // her tire.
    let swings = 0;
    for (let i = 0; i < 8; i++) {
      const s = await state();
      if (s.dir !== 'follow' || s.downed) break;
      await standBy('lyra', 16);
      await ev(() => window.__game.player.faceToward(window.__game.companion.x, window.__game.companion.y));
      await aimAt('lyra');
      await swing();
      swings++;
      await wait(250);
    }
    let kept = false;
    let windedAt = null;
    let closest = Infinity;
    let slow = null;
    const t0 = Date.now();
    // The thumb stays on the stick (or the keys stay down) and turns toward her as she goes.
    let cdp = null;
    let origin = null;
    const held = new Set();
    const steer = async (ux, uy) => {
      if (S.phone) {
        if (!cdp) {
          cdp = await ctx.newCDPSession(page);
          origin = { x: 90, y: S.h - 90 };
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: origin.x, y: origin.y, id: 3 }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: origin.x + ux * 44, y: origin.y + uy * 44, id: 3 }] });
      } else {
        const want = new Set();
        if (ux > 0.38) want.add('d');
        if (ux < -0.38) want.add('a');
        if (uy > 0.38) want.add('s');
        if (uy < -0.38) want.add('w');
        for (const k of [...held]) if (!want.has(k)) {
          await page.keyboard.up(k);
          held.delete(k);
        }
        for (const k of want) if (!held.has(k)) {
          await page.keyboard.down(k);
          held.add(k);
        }
      }
    };
    const letGo = async () => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: origin.x, y: origin.y, id: 3 }] }).catch(() => {});
        await cdp.detach().catch(() => {});
        cdp = null;
      }
      for (const k of [...held]) await page.keyboard.up(k);
      held.clear();
    };
    while (Date.now() - t0 < 30000) {
      const s = await state();
      if (/keep_away|flee|independent/.test(s.dir)) kept = true;
      if (s.winded && windedAt == null) windedAt = Date.now() - t0;
      if (s.winded) slow = s.speed;
      if (windedAt != null) closest = Math.min(closest, s.d);
      if (process.env.VB_DEBUG) console.log('   chase', Math.round((Date.now() - t0) / 100) / 10, Math.round(s.d), s.dir, s.speed, s.winded);
      if (s.downed || (windedAt != null && closest < 26)) break;
      const n = Math.hypot(s.dx, s.dy) || 1;
      await steer(s.dx / n, s.dy / n);
      await wait(120);
    }
    await letGo();
    check(kept && windedAt != null && slow < 60 && closest < 30, `[${tag}] 11 she keeps away, and chased she tires and is caught (winded after ${windedAt == null ? '-' : (windedAt / 1000).toFixed(1)} s at ${slow} px/s; closest ${Math.round(closest)} px)`, JSON.stringify({ kept, windedAt, slow, closest: Math.round(closest) }));
    if (process.env.VB_DEBUG) await ev(() => {
      const g = window.__game;
      window.__dmg = [];
      const d = g.combat.damage.bind(g.combat);
      g.combat.damage = (src, t, amt, o = {}) => {
        const L = g.companion;
        const before = t?.hp;
        const r = d(src, t, amt, o);
        if (t === L) window.__dmg.push(`amt=${Math.round(amt)} r=${r} hp ${before}->${t.hp} inv=${t.invuln?.toFixed?.(2)} src=${src?.id || src?.type} canHarm=${g.combat.canHarm(src?.type === 'projectile' ? src.owner : src, t, true)} dodge=${g.stats?.get?.(t, 'dodge')}`);
        return r;
      };
      const m = g.combat.melee.bind(g.combat);
      g.combat.melee = (a, o = {}) => {
        const r = m(a, o);
        if (a === g.player) window.__dmg.push(`melee r=${r} hits=${g.combat.lastMeleeHits} disabled=${!!a.statusFlags?.disabled}`);
        return r;
      };
    });
    // 2. Strike her down (beside her each time: the script does not walk round houses).
    for (let i = 0; i < 60; i++) {
      const s = await state();
      if (s.downed || s.dead) break;
      if (s.d > 22) await standBy('lyra', 16);
      await ev(() => window.__game.player.faceToward(window.__game.companion.x, window.__game.companion.y));
      await aimAt('lyra');
      await swing();
      swings++;
      if (process.env.VB_DEBUG) console.log('   strike', i, await ev(() => { const L = window.__game.companion; const P = window.__game.player; return `hp=${Math.round(L.hp)} d=${Math.round(Math.hypot(L.x - P.x, L.y - P.y))} state=${L.state} dir=${L.behavior?.directive?.type} ward=${!!(L.ward || L.statusFlags?.ward)} shield=${L.shield ?? ''} php=${Math.round(P.hp)} lock=${P.lockTime?.toFixed?.(2)} root=${P.rootTime?.toFixed?.(2)} modal=${window.__game.ui.isModalOpen?.()} top=${window.__game.ui.top?.()?.id || ''} chat=${window.__game.ui.chat?.isOpen?.()} dlg=${window.__game.ui.dialog?.isOpen?.()} st=${window.__game.state} focus=${document.activeElement?.className || document.activeElement?.tagName}`; }));
    }
    const down = await ev(() => {
      const g = window.__game;
      const L = g.companion;
      return { downed: !!L.downed, hp: L.hp, d: Math.round(Math.hypot(L.x - g.player.x, L.y - g.player.y)) };
    });
    if (process.env.VB_DEBUG) console.log('   opens', JSON.stringify(await ev(() => window.__opens), null, 1));
    if (process.env.VB_DEBUG) console.log('   dmg', JSON.stringify(await ev(() => window.__dmg.slice(0, 30)), null, 1));
    check(down.downed, `[${tag}] 11 struck by hand until she falls (${swings} swings)`, JSON.stringify(down));
    await shot('11-down');
    await finish('lyra');
    await wait(1500);
    const after = await ev(() => {
      const g = window.__game;
      const vis = [...document.querySelectorAll('.toast')].filter((t) => !t.classList.contains('queued') && !t.classList.contains('leaving') && getComputedStyle(t).display !== 'none').map((t) => t.textContent);
      return { dead: g.murder.isDead('lyra'), holder: g.party.holderId, card: window.__vis('.companion-card'), toasts: vis, hud: window.__hudText() };
    });
    check(after.dead, `[${tag}] 11 the held blow: she is dead`, JSON.stringify(after));
    check(!after.toasts.some((x) => /is down!.*help .* up/i.test(x)), `[${tag}] 11 no "help her up" call left over her body`, JSON.stringify(after.toasts));
    check(!after.holder && !after.card && !/\bLyra\b/.test(after.hud), `[${tag}] 11 the companion slot is empty, no Lyra on the HUD`, JSON.stringify({ holder: after.holder, card: after.card, hud: after.hud.slice(0, 200) }));
    await shot('11-dead');
    // People, opened as a player would (Tab on a computer; the menu on a phone).
    if (S.phone) await ev(() => window.__game.ui.openPeople('lyra'));
    else {
      await page.keyboard.press('Tab');
      await wait(400);
      await ev(() => window.__game.ui.openPeople('lyra'));
    }
    await wait(500);
    const mem = await ev(() => document.querySelector('.people-page')?.textContent || '');
    check(/In memory/i.test(mem), `[${tag}] 11 People: Lyra in memory`, mem.slice(0, 120));
    await shot('11-memorial');
    await ev(() => window.__clean());
    // Pip: never.
    await ev(() => {
      const g = window.__game;
      const pip = g.entities.get('pip');
      window.__put(pip, g.player.x + 40, g.player.y);
      pip.hp = 1;
      g.combat.damage(g.player, pip, 99, { exact: true, crit: false });
      window.__toasts.length = 0;
      window.__said = [];
      const say = g.bubbles.say.bind(g.bubbles);
      g.bubbles.say = (e, text, o) => {
        window.__said.push(String(text));
        return say(e, text, o);
      };
    });
    await finish('pip');
    const pip = await ev(() => ({ dead: window.__game.murder.isDead('pip'), downed: !!window.__game.entities.get('pip').downed, said: window.__toasts.concat(window.__said).join(' | ') }));
    check(!pip.dead && /Not a child/i.test(pip.said), `[${tag}] 11 Pip: "No. Not a child."`, JSON.stringify(pip).slice(0, 220));
    await shot('11-not-a-child');
  });

  // ================================================================ 15: the trial after a real fight
  if (!ITEMS || ITEMS.has(15)) await fresh();
  await item(15, 'the trial: Bram struck first, Elda saw', async () => {
    await square({ bram: [0, 0], elda: [-60, 0] });
    await ev(() => {
      const g = window.__game;
      const P = g.player;
      const bram = g.entities.get('bram');
      P.x = bram.x + 18;
      P.y = bram.y;
      P.maxHp = 300;
      P.hp = 300;
      P.faceToward(bram.x, bram.y);
      delete bram.think;
      // He comes at the stranger (a quarrel the run does not need to stage in words).
      bram.startFight(P, { anchor: { x: bram.x, y: bram.y }, leash: 200 });
      g.camera.snap?.();
    });
    const hit = await until(() => window.__game.player.lastAttacker === window.__game.entities.get('bram'), null, 20000);
    check(hit, `[${tag}] 15 Bram swings first and lands it`);
    for (let i = 0; i < 40; i++) {
      const s = await ev(() => {
        const g = window.__game;
        const b = g.entities.get('bram');
        g.player.faceToward(b.x, b.y);
        return { downed: !!b.downed, d: Math.hypot(b.x - g.player.x, b.y - g.player.y) };
      });
      if (s.downed) break;
      if (s.d > 22) await ev(() => {
        const g = window.__game;
        const b = g.entities.get('bram');
        g.player.x = b.x + 16;
        g.player.y = b.y;
      });
      await aimAt('bram');
      await swing();
    }
    await finish('bram');
    const rec = await ev(() => {
      const r = window.__game.murder.dead.bram;
      return r ? { provoked: r.provoked, seen: (r.seen || []).map((x) => `${x.id}:${x.clarity}`) } : null;
    });
    check(rec && rec.provoked === true && rec.seen.some((x) => x.startsWith('elda')), `[${tag}] 15 the record: provoked, and Elda saw it`, JSON.stringify(rec));
    await ev(() => {
      const g = window.__game;
      const rec = g.murder.dead.bram;
      rec.known = 'witnessed';
      rec.alarm = rec.alarm || { raised: true, by: 'rowan' };
      g.murder.openCase('bram');
      g.murder.weigh?.('bram');
      g.murder.surrender('bram');
    });
    await until(() => !!window.__game.story?.isPlaying?.(), null, 8000);
    for (let i = 0; i < 24; i++) {
      if (await ev(() => !!document.querySelector('.panel-defence'))) break;
      await ev(() => window.__game.story?.player?.skip?.());
      await wait(300);
    }
    const field = await rectOf('.panel-defence .defence-field');
    check(!!field, `[${tag}] 15 a field to speak for yourself`);
    if (field) {
      if (S.phone) await page.touchscreen.tap(field.x + 20, field.y + 10);
      else await page.mouse.click(field.x + 20, field.y + 10);
      await page.keyboard.type('He struck me first with his hammer. I had no choice.', { delay: 3 });
    }
    await shot('15-defence');
    await press('.panel-defence .defence-send');
    await page.waitForSelector('.panel-weighing', { timeout: 8000 }).catch(() => {});
    await wait(900);
    await shot('15-weighing');
    const votes = await ev(() => (window.__game.murder.cases.bram?.trial?.votes || []).map((v) => ({ id: v.id, vote: v.vote, reason: v.reason })));
    const others = votes.filter((v) => v.id !== 'elda');
    check(votes.some((v) => v.id === 'elda' && v.vote === 'mercy'), `[${tag}] 15 Elda saw it and bears it out`, JSON.stringify(votes.find((v) => v.id === 'elda')));
    check(others.length && others.every((v) => v.vote !== 'guilty' || /Elda/.test(v.reason)) && others.some((v) => /Elda saw/.test(v.reason) || v.vote !== 'guilty'), `[${tag}] 15 the room heard her: nobody else votes as if the defence were never borne out`, JSON.stringify(others));
    check(!others.some((v) => /^I saw/.test(v.reason)), `[${tag}] 15 nobody claims to have seen what they did not`, JSON.stringify(others.map((v) => v.reason)));
    await press('.panel-weighing .opt-hear');
    for (let i = 0; i < 30; i++) {
      if (await ev(() => !!window.__game.murder.cases.bram?.verdict)) break;
      await ev(() => window.__game.story?.player?.skip?.());
      await wait(250);
    }
    const v = await ev(() => window.__game.murder.cases.bram?.trial?.sentence || null);
    check(v === 'mercy' || v === 'not_proven', `[${tag}] 15 the verdict follows the votes: ${v}`, v);
  });

  // ================================================================ 28: "I want to stop", typed
  if (!ITEMS || ITEMS.has(28)) await fresh();
  await item(28, 'the dark path left in the author\'s words', async () => {
    const gate = async () => {
      const ok = await until(() => !!window.__game.villain?.tempter, null, 10000);
      if (!ok) return false;
      await ev(() => {
        const g = window.__game;
        const t = g.villain.tempter;
        g.player.x = t.x - 18;
        g.player.y = t.y;
        g.player.vel.x = g.player.vel.y = 0;
        g.player.faceToward(t.x, t.y);
        g.ui.chat.target = '@near';
        g.camera.snap?.();
      });
      await wait(300);
      return true;
    };
    const sayTo = async (text) => {
      for (let i = 0; i < 2; i++) {
        await say(text);
        const ok = await until((t) => [...document.querySelectorAll('.chat-log .msg')].some((r) => r.textContent.includes(t)), text, 3000);
        if (ok) break;
        await gate();
        await talk();
      }
      await until(() => {
        const c = window.__game.ui.chat;
        return !c.waiting?.size && !c.queued?.size;
      }, null, 12000);
      await wait(600);
    };
    const V = () => ev(() => {
      const g = window.__game;
      const s = g.villain.state;
      const a = g.villain.currentAsk();
      return { pact: g.villain.hasPact(), ended: s.ended, hostile: s.hostile, ask: a ? `${a.kind}:${a.target}:${a.state}` : null, learned: !!g.unkindle?.learned, header: document.querySelector('.chat-head, .chat-header')?.textContent || '' };
    });
    await ev(() => {
      const g = window.__game;
      window.__away();
      window.__lyraAway();
      g.flags.bosses = { varek: { defeated: true, shards: {} } };
      // Claude offline: his own lines.
      g.village.provider = () => null;
      g.clock.skipTo(22);
    });
    check(await gate(), `[${tag}] 28 he waits at the gate`);
    await talk();
    await sayTo('I accept. Teach me after.');
    let v = await V();
    check(v.pact && v.learned, `[${tag}] 28 the pact, in my words: the Unkindling is taught`, JSON.stringify(v));
    // The next night: his ask, refused in plain words. The pact holds.
    await ev(() => {
      const g = window.__game;
      g.ui.closeAll?.();
      g.ui.chat.close?.();
      g.clock.skipTo(12);
    });
    await wait(700);
    await ev(() => window.__game.clock.skipTo(22));
    await wait(400);
    await gate();
    await talk();
    await sayTo('What do you want from me tonight?');
    v = await V();
    check(/:offered$/.test(v.ask || ''), `[${tag}] 28 he asks one thing`, v.ask);
    await sayTo("I don't want to kill him.");
    v = await V();
    check(v.pact && !v.ask, `[${tag}] 28 "I don't want to kill him": that ask refused, the pact holds`, JSON.stringify(v));
    await sayTo('I want to stop.');
    v = await V();
    check(v.ended && !v.pact && v.hostile && v.learned, `[${tag}] 28 "I want to stop.": the pact ends, he turns cold, the Unkindling stays`, JSON.stringify(v));
    const rows = await ev(() => [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-3));
    check(rows.some((r) => /^Isembard/.test(r) && /word|broken|friend|kept|enem/i.test(r)), `[${tag}] 28 he answers it in his own words (heard first, then answered)`, JSON.stringify(rows));
    check(/cold/i.test(v.header), `[${tag}] 28 the chat says he is cold to you`, v.header.slice(0, 120));
    check(!/Trade · Give · Work/.test(v.header) && /The bargain/.test(v.header), `[${tag}] 28 his header's button is the bargain, not a shop`, v.header.slice(0, 120));
    await shot('28-i-want-to-stop');
  });

  const scroll = await ev(() => document.documentElement.scrollWidth > innerWidth + 1).catch(() => false);
  check(!scroll, `[${tag}] no sideways scroll`);
  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  for (const S of SIZES) await play(S);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('Failed:');
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
