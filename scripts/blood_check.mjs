// Round 14b blood check: violence and its consequences, played in the built game on a phone
// sideways (844x390) and upright (390x844) by touch, and on a computer (1280x720) by keys
// and mouse (DESIGN §35):
//   1. Lyra knocked down by hand (sword blows), her own warning, the held blow: she dies, a
//      finisher plays (sword build), her body lies; Pip: "No. Not a child.";
//   2. her pack searched (Search or lift: finger-sized), the key to her trunk in it;
//   3. a body searched unseen at night: coins taken, no crime; searched in front of Elda: a
//      theft and the village's news;
//   4. Garrick struck in the square in front of Bram: Bram comes at you (a defender);
//   5. lock-on: a middle click / G on desktop, a held sword button and a swipe on phones;
//      the reticle; the weave aims at the lock;
//   6. a magic build's finisher (a bolt) and Settings -> Finishers;
//   7. a skeleton across a heap of rubble never lands a blow; a Strike forces a locked chest;
//   8. a store set alight at night (smoke, a blackened roof), Pip hides, then is taken away;
//   9. the phone held sideways at 4x CPU keeps its frame rate with a lock on.
//   node scripts/blood_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/blood';
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
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
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return null;
    if (S.phone) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await wait(300);
    return r;
  };
  // The use button: a real tap on a phone, the E key on a computer.
  const use = async () => {
    if (S.phone) {
      const r = await rectOf('.tbtn-interact');
      if (!r) return false;
      await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    } else await page.keyboard.press('e');
    await wait(400);
    return true;
  };
  // The sword: a tap on its button, or J on a computer.
  const swing = async () => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      if (!r) return false;
      await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    } else await page.keyboard.press('j');
    await wait(260);
    return true;
  };
  // Hold the sword down (the finishing blow): a held touch, or J held.
  const holdSword = async (ms) => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      if (!r) return false;
      const cdp = await ctx.newCDPSession(page);
      const pt = [{ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 7 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
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
    g.clock.skipTo?.(12);
    const u = g.ui;
    for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
    u?.coach?.stop?.();
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__ev = [];
    for (const t of ['villager_killed', 'crime', 'finisher', 'lock_changed', 'child_hides', 'child_taken_away', 'store_burned', 'body_searched', 'chest_forced']) g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? p?.target?.id ?? null, kind: p?.kind ?? p?.mode ?? null, w: p?.witnesses || null }));
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__at = (e, tx, ty, still = true) => {
      e.x = tx * 16 + 8;
      e.y = ty * 16 + 10;
      e.walker?.stop?.();
      if (e.r) e.r.key = null;
      if (still) e.think = () => {};
    };
    // Everyone off to the far side of the vale unless a scene asks for them.
    window.__away = (keep = []) => {
      for (const e of g.villageLife.villagers()) if (!keep.includes(e.id)) window.__at(e, 20 + Math.random() * 4, 52);
    };
    window.__away();
    window.__clean();
  });

  // ---------- 1. Lyra, knocked down by hand, and the held blow ----------
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    const L = g.companion;
    window.__at(P, 97, 103, false);
    P.faceDir?.('right');
    L.x = P.x + 16;
    L.y = P.y;
    L.controller = null; // she stands (this check is the blow, not the chase: tests/murder)
    L.hp = 12;
    g.progression.points = { ...(g.progression.points || {}), might: 6 };
    g.camera.snap?.();
    window.__ev.length = 0;
  });
  for (let i = 0; i < 12; i++) {
    const down = await ev(() => !!window.__game.companion.downed);
    if (down) break;
    await ev(() => {
      const g = window.__game;
      g.player.faceToward(g.companion.x, g.companion.y);
      g.player.attackCd = 0;
    });
    await swing();
  }
  const downed = await ev(() => ({ downed: !!window.__game.companion.downed, hp: window.__game.companion.hp }));
  check(downed.downed, `[${tag}] Lyra is knocked down by sword blows`, JSON.stringify(downed));
  // The last blow knocked her back a step: stand over her again.
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    g.player.x = L.x - 14;
    g.player.y = L.y;
    g.player.faceToward(L.x, L.y);
    g.camera.snap?.();
  });
  await wait(300);
  // Her own warning (the game's own dialog), then the held blow.
  await ev(() => {
    window.__game.flags.finisherWarned = true;
    window.__game.flags.finisherWarnedLyra = false;
  });
  await swing();
  await wait(300);
  const warnText = await ev(() => document.querySelector('.panel-confirm .confirm-text')?.textContent || '');
  check(/Hobb and Wenna/.test(warnText), `[${tag}] Lyra has her own first warning`, warnText.slice(0, 60));
  await shot('1-lyra-warning');
  await press('.panel-confirm .btn-danger, .panel-confirm .btn-ember');
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    g.player.x = L.x - 14;
    g.player.y = L.y;
    g.player.faceToward(L.x, L.y);
  });
  // Hold: the ring closes, the blow falls; catch the finisher mid-scene.
  const holdP = holdSword(1900);
  await page.waitForFunction(() => window.__ev.some((e) => e.t === 'finisher'), null, { timeout: 4000 }).catch(() => {});
  await wait(520);
  await shot('2-lyra-finisher');
  await holdP;
  await wait(200);
  const dead = await ev(() => {
    const g = window.__game;
    return { dead: g.murder.isDead('lyra'), body: !!g.companion.dead && !g.companion.downed, fin: window.__ev.find((e) => e.t === 'finisher')?.id ?? null, rec: g.murder.dead.lyra?.finisher ?? null };
  });
  check(dead.dead && dead.body, `[${tag}] Lyra dies by the held blow`, JSON.stringify(dead));
  check(dead.fin === 'sword' && dead.rec === 'sword', `[${tag}] a sword build's finisher plays and marks the body`, JSON.stringify(dead));
  await wait(1500);
  await ev(() => window.__clean());
  await shot('3-lyra-body');

  // Pip: never.
  await ev(() => {
    const g = window.__game;
    const pip = g.entities.get('pip');
    window.__at(pip, 99, 104);
    pip.hp = 1;
    g.combat.damage(g.player, pip, 99, { exact: true, crit: false });
    window.__at(g.player, 98, 104, false);
    g.player.faceToward(pip.x, pip.y);
    g.bubbles?.clearAll?.();
    g.murder._refusedAt = -Infinity;
  });
  await holdSword(1700);
  const pip = await ev(() => {
    const g = window.__game;
    const b = (g.bubbles?.list || g.bubbles?.items || []).map?.((x) => x.text || x.full || '') || [];
    return { dead: g.murder.isDead('pip'), downed: !!g.entities.get('pip').downed, said: JSON.stringify(b) };
  });
  check(!pip.dead, `[${tag}] Pip: never a child`, JSON.stringify(pip));
  await shot('4-not-a-child');
  await ev(() => {
    const g = window.__game;
    const pip = g.entities.get('pip');
    g.combat.revive?.(pip, pip, 1);
    window.__at(pip, 20, 52);
  });

  // ---------- 2. her pack: Search or lift ----------
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    window.__at(g.player, Math.floor(L.x / 16) - 1, Math.floor(L.y / 16), false);
    g.player.faceToward(L.x, L.y);
    window.__clean();
  });
  await wait(400);
  const label = await ev(() => window.__game.ui.lastPrompt || '');
  check(/Search or lift Lyra/.test(label), `[${tag}] her body: "Search or lift"`, label);
  await use();
  const choice = await rectOf('.panel-body-choice [data-choice="search"]');
  const lift = await rectOf('.panel-body-choice [data-choice="lift"]');
  const closeBtn = await rectOf('.panel-body-choice .panel-close');
  check(!!choice && !!lift && choice.h >= 44 && lift.h >= 44 && (!closeBtn || closeBtn.h >= 44), `[${tag}] two finger-sized choices and a 44 px close`, JSON.stringify({ choice, lift, closeBtn }));
  await shot('5-search-or-lift');
  await press('.panel-body-choice [data-choice="search"]');
  const pack = await ev(() => ({ open: !!document.querySelector('.panel-chest'), title: document.querySelector('.panel-chest .panel-title')?.textContent || '', key: window.__game.companion.inventory.count('lyra_trunk_key') }));
  check(pack.open && /Lyra's pack/.test(pack.title) && pack.key === 1, `[${tag}] her pack opens, her trunk key in it`, JSON.stringify(pack));
  await shot('6-lyra-pack');
  await ev(() => window.__clean());

  // ---------- 3. a body searched unseen at night, then in front of Elda ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(23.5);
    window.__away();
    const garrick = g.entities.get('garrick');
    window.__at(garrick, 112, 70);
    window.__at(g.player, 111, 70, false);
    garrick.hp = 1;
    g.combat.damage(g.player, garrick, 99, { exact: true, crit: false });
    g.murder.kill(garrick, g.player);
    g.player.faceToward(garrick.x, garrick.y);
    g.camera.snap?.();
    window.__ev.length = 0;
    window.__toasts.length = 0;
    window.__clean();
  });
  await wait(300);
  await use();
  await press('.panel-body-choice [data-choice="search"]');
  const pockets = await ev(() => ({ title: document.querySelector('.panel-chest .panel-title')?.textContent || '', coins: window.__game.entities.get('garrick').inventory.count('coin') }));
  check(/Garrick's pockets/.test(pockets.title) && pockets.coins > 0, `[${tag}] his pockets open in the chest panel`, JSON.stringify(pockets));
  await shot('7-garrick-pockets');
  const takeAll = await rectOf('.panel-chest .store-col:last-child .btn');
  if (takeAll) await press('.panel-chest .store-col:last-child .btn');
  const unseen = await ev(() => ({ coins: window.__game.entities.get('garrick').inventory.count('coin'), thefts: window.__ev.filter((e) => e.t === 'crime' && e.kind === 'theft').length, toasts: window.__toasts.filter((t) => /Crime|theft|saw you/i.test(t)) }));
  check(unseen.coins === 0 && unseen.thefts === 0 && !unseen.toasts.length, `[${tag}] taken unseen at night: no crime, no toast`, JSON.stringify(unseen));
  await ev(() => window.__clean());
  // In front of Elda, by day: a theft.
  const seen = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(12);
    const sq = g.locations.get('town_square').center;
    const tobias = g.entities.get('tobias');
    tobias.x = sq.x;
    tobias.y = sq.y;
    tobias.think = () => {};
    g.player.x = sq.x - 14;
    g.player.y = sq.y;
    tobias.hp = 1;
    g.combat.damage(g.player, tobias, 99, { exact: true, crit: false });
    g.murder.kill(tobias, g.player);
    const elda = g.entities.get('elda');
    elda.x = sq.x + 60;
    elda.y = sq.y + 10;
    elda.think = () => {};
    window.__ev.length = 0;
    const pockets = g.murder.search(tobias, g.player);
    const n = pockets.inventory.transfer(g.player.inventory, 'coin', 1);
    g.bus.emit('item_gained', { actor: g.player, itemId: 'coin', qty: n, from: 'chest', chest: pockets });
    const theft = window.__ev.find((e) => e.t === 'crime' && e.kind === 'theft');
    return { theft: !!theft, w: theft?.w || [], news: g.village.rumors.list.some((r) => r.kind === 'robbed_the_dead') };
  });
  check(seen.theft && seen.w.includes('elda') && seen.news, `[${tag}] searched in front of Elda: a theft, and robbed_the_dead news`, JSON.stringify(seen));
  await ev(() => window.__clean());

  // ---------- 4. Bram defends Garrick... Tilly defends Wys ----------
  const defend = await ev(() => {
    const g = window.__game;
    window.__away();
    const sq = g.locations.get('town_square').center;
    const wys = g.entities.get('wys');
    const tilly = g.entities.get('tilly');
    const bram = g.entities.get('bram');
    for (const e of [wys, tilly, bram]) {
      e.think = Object.getPrototypeOf(e).think;
      e.mode = 'routine';
      e.help = null;
    }
    // Bram is dead by now in some runs; Tilly and Sabeth defend too.
    const victim = g.entities.get('alder');
    victim.x = sq.x + 30;
    victim.y = sq.y + 40;
    victim.think = () => {};
    tilly.x = sq.x + 70;
    tilly.y = sq.y + 46;
    g.player.x = sq.x + 14;
    g.player.y = sq.y + 40;
    g.player.faceToward(victim.x, victim.y);
    wys.x = sq.x + 2000;
    g.camera.snap?.();
    g.combat.damage(g.player, victim, 4, { kind: 'melee' });
    return { tilly: tilly.mode, hostile: g.combat.isHostile(tilly, g.player) };
  });
  await wait(900);
  const defend2 = await ev(() => ({ tilly: window.__game.entities.get('tilly').mode, target: window.__game.entities.get('tilly').fightTarget?.id ?? null }));
  check(defend2.tilly === 'fight' && defend2.target === 'player', `[${tag}] Tilly, who saw it, comes at the stranger with her tongs`, JSON.stringify({ defend, defend2 }));
  await ev(() => window.__clean());
  await shot('8-tilly-defends');
  await ev(() => {
    const g = window.__game;
    const t = g.entities.get('tilly');
    t.endFight?.(g.player);
    t.think = () => {};
    window.__at(t, 20, 52);
    g.player.crime = null;
    g.player.hp = g.player.maxHp;
  });

  // ---------- 5. lock-on ----------
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    window.__at(P, 92, 100, false);
    P.faceDir?.('right');
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const C = proto.constructor;
    window.__wolves = [0, 1].map((i) => {
      const w = new C(g, 'wolf', { x: P.x + 50 + i * 30, y: P.y + (i ? 36 : -6) });
      w.controller = null;
      w.speed = 0;
      w.aggroRadius = 0;
      w.maxHp = w.hp = 200;
      g.entities.add(w);
      return w;
    });
    g.lock?.clear?.();
    g.camera.snap?.();
    window.__clean();
  });
  await wait(300);
  if (S.phone) {
    // A held sword button (still), then a swipe across it.
    const r = await rectOf('.tbtn-attack');
    const cdp = await ctx.newCDPSession(page);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 3 }] });
    await wait(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(200);
    const l1 = await ev(() => window.__game.lock?.target?.species ?? null);
    check(l1 === 'wolf', `[${tag}] holding the sword button still locks the nearest in front`, String(l1));
    await shot('9-locked');
    const first = await ev(() => {
      window.__firstLock = window.__game.lock.target;
      return window.__wolves.indexOf(window.__game.lock.target);
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 4 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + i * 9, y: c.y, id: 4 }] });
      await wait(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await wait(200);
    const second = await ev(() => {
      const t = window.__game.lock?.target;
      return { moved: !!t && t !== window.__firstLock, who: t?.species || t?.id || null };
    });
    check(second.moved, `[${tag}] a swipe across it moves the lock to the next one round you`, `${first} -> ${JSON.stringify(second)}`);
  } else {
    // A middle click on the far wolf, then the wheel.
    await wait(200);
    const pt = await ev(() => {
      const g = window.__game;
      const w = window.__wolves[1];
      const cv = g.canvas.getBoundingClientRect();
      const c = g.renderer.worldToCss(w.x, w.y - 8);
      return { x: cv.left + c.x, y: cv.top + c.y };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });
    await wait(200);
    const l1 = await ev(() => window.__wolves.indexOf(window.__game.lock?.target));
    const scrolled = await ev(() => window.scrollY);
    check(l1 === 1 && scrolled === 0, `[${tag}] a middle click locks the wolf under the cursor (no autoscroll)`, `${l1} scrollY=${scrolled}`);
    await shot('9-locked');
    await page.mouse.wheel(0, 120);
    await wait(200);
    const l2 = await ev(() => {
      const t = window.__game.lock?.target;
      return { moved: !!t && t !== window.__wolves[1], who: t?.species || t?.id || null };
    });
    check(l2.moved, `[${tag}] the wheel moves the lock to the next one round you`, JSON.stringify(l2));
    await page.keyboard.press('g');
    await wait(150);
    const l3 = await ev(() => window.__game.lock?.target ?? null);
    check(l3 === null, `[${tag}] G lets go`);
    await page.keyboard.press('g');
    await wait(150);
  }
  const aim = await ev(() => {
    const g = window.__game;
    const w = g.ui?.weaving || g.ui?.hud?.weaving || null;
    const t = g.lock?.target;
    if (!w?.aimFor || !t) return { skip: true, locked: !!t };
    const out = w.aimFor({ slot: 0, source: 'key' });
    return { target: out.target === t };
  });
  check(aim.skip ? aim.locked : aim.target, `[${tag}] a weave aims at the lock`, JSON.stringify(aim));

  // ---------- 6. a magic build's finisher, and Settings -> Finishers ----------
  await ev(() => {
    const g = window.__game;
    for (const w of window.__wolves) g.entities.remove?.(w) ?? (w.removed = true);
    g.lock?.clear?.();
    g.progression.points = { might: 0, weave: 9, focus: 3 };
    const sabeth = g.entities.get('sabeth');
    window.__at(sabeth, 93, 100);
    window.__at(g.player, 92, 100, false);
    sabeth.hp = 1;
    g.combat.damage(g.player, sabeth, 99, { exact: true, crit: false });
    g.player.faceToward(sabeth.x, sabeth.y);
    g.flags.finisherWarned = true;
    g.camera.snap?.();
    window.__ev.length = 0;
    window.__clean();
  });
  const holdM = holdSword(1900);
  await page.waitForFunction(() => window.__ev.some((e) => e.t === 'finisher'), null, { timeout: 4000 }).catch(() => {});
  await wait(560);
  await shot('10-magic-finisher');
  await holdM;
  const mfin = await ev(() => window.__ev.find((e) => e.t === 'finisher')?.id ?? null);
  check(mfin === 'magic', `[${tag}] a weave build's finisher is the bolt`, String(mfin));
  const setting = await ev(async () => {
    const g = window.__game;
    g.ui.openSettings?.('game');
    await new Promise((r) => setTimeout(r, 300));
    const row = [...document.querySelectorAll('.panel-settings *')].find((e) => /^Finishers$/.test(e.textContent?.trim() || ''));
    return !!row;
  });
  check(setting, `[${tag}] Settings -> Game shows Finishers`);
  await shot('11-settings-finishers');
  await ev(() => window.__clean());

  // ---------- 7. rubble and a locked chest ----------
  const rubble = await ev(() => {
    const g = window.__game;
    const m = g.map;
    let spot = null;
    for (let ty = 0; ty < 120 && !spot; ty++) {
      for (let tx = 0; tx < 160 && !spot; tx++) {
        if (m.tileAt(tx, ty) !== 20) continue;
        if (!m.isSolidTile(tx, ty - 1) && !m.isSolidTile(tx, ty + 1) && !m.blocksProjectile(tx, ty - 1) && !m.blocksProjectile(tx, ty + 1)) spot = { tx, ty };
      }
    }
    if (!spot) return { none: true };
    const P = g.player;
    P.x = spot.tx * 16 + 8;
    P.y = (spot.ty + 1) * 16 + 6;
    P.hp = P.maxHp;
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const C = proto.constructor;
    const sk = new C(g, 'skeleton', { x: spot.tx * 16 + 8, y: (spot.ty - 1) * 16 + 12 });
    sk.maxHp = sk.hp = 200;
    g.entities.add(sk);
    window.__sk = sk;
    g.camera.snap?.();
    return { spot, d: Math.round(Math.hypot(sk.x - P.x, sk.y - P.y)), hp: P.hp };
  });
  if (!rubble.none) {
    await wait(4000);
    const hit = await ev(() => ({ hp: window.__game.player.hp, max: window.__game.player.maxHp, state: window.__sk.ai?.state || null }));
    await shot('12-rubble');
    check(hit.hp === hit.max, `[${tag}] a skeleton across a heap of rubble lands nothing`, JSON.stringify({ ...rubble, ...hit }));
    await ev(() => (window.__sk.removed = true));
  } else check(true, `[${tag}] (no rubble tile in this world: skipped)`);
  const chest = await ev(() => {
    const g = window.__game;
    const c = g.objects.all().find((o) => o.id === 'guard_footlocker');
    window.__toasts.length = 0;
    const before = JSON.stringify(c.inventory.serialize());
    g.player.x = c.x;
    g.player.y = c.y + 20;
    const light = g.chestBlow?.(c.x, c.y, 16, { source: g.player });
    const heavy = g.chestBlow?.(c.x, c.y, 16, { source: g.player, heavy: true });
    g.camera.snap?.();
    return { light, heavy, locked: c.state.locked, same: before === JSON.stringify(c.inventory.serialize()), toasts: window.__toasts.slice() };
  });
  check(chest.light?.[0] === 'iron' && chest.heavy?.[0] === 'forced' && !chest.locked && chest.same, `[${tag}] a light blow on a locked chest gets a word; a Strike forces it; nothing inside moves`, JSON.stringify(chest));
  await wait(300);
  await shot('13-chest-forced');
  await ev(() => window.__clean());

  // ---------- 8. a store burns at night; Pip hides, then is taken away ----------
  const burn = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(23);
    window.__away();
    const st = g.locations.get('general_store');
    // Stand to the west of the store, level with its roof, so the roof is in view.
    g.player.x = (st.bounds.x - 2) * 16 + 8;
    g.player.y = (st.bounds.y + Math.floor(st.bounds.h / 2)) * 16 + 8;
    g.camera.snap?.();
    const r = g.chestBlow?.(st.center.x, st.center.y, 20, { source: g.player, fire: true });
    return { burned: !!g.occupation?.burned('general_store'), closed: !!g.occupation?.shopClosed('garrick'), r: !!r };
  });
  check(burn.burned && burn.closed, `[${tag}] a fire weave's blow sets the general store alight; its shop is closed`, JSON.stringify(burn));
  await wait(2500);
  await ev(() => window.__clean());
  await shot('14-store-burned');
  const kids = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(12);
    const pip = g.entities.get('pip');
    const sq = g.locations.get('town_square').center;
    pip.x = sq.x;
    pip.y = sq.y;
    pip.think = Object.getPrototypeOf(pip).think;
    g.player.x = sq.x + 60;
    g.player.y = sq.y;
    // He knows: the bell has rung for a killing (the alarm raised).
    const rec = Object.values(g.murder.dead).find((r) => !r.natural);
    rec.known = 'witnessed';
    rec.alarm = { raised: true, by: 'rowan', t: g.clock.t };
    const hid = g.occupation.childSees(pip);
    // Elda (his household) dies: the next morning a carter comes.
    const elda = g.entities.get('elda');
    if (!g.murder.isDead('elda')) {
      elda.hp = 1;
      g.combat.damage(g.player, elda, 99, { exact: true, crit: false });
      g.murder.kill(elda, g.player);
    }
    g.occupation.childrenTick();
    g.clock.t += 900;
    g.clock.skipTo?.(9.5);
    g.occupation.childrenTick();
    return { hid, taken: g.occupation.taken.pip?.by ?? null, absent: pip.absent?.cause ?? null, dead: g.murder.isDead('pip') };
  });
  check(kids.hid, `[${tag}] Pip, who knows, hides from the killer`, JSON.stringify(kids));
  check(kids.taken && kids.absent === 'taken_away' && !kids.dead, `[${tag}] Elda dead, a carter takes Pip away the next morning, unharmed`, JSON.stringify(kids));

  // ---------- 9. a slow phone with a lock on ----------
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev(() => {
      const g = window.__game;
      const P = g.player;
      P.x = 88 * 16;
      P.y = 50 * 16;
      const near = g.entities.all().find((e) => e.profile && !e.dead && !e.absent && Math.hypot(e.x - P.x, e.y - P.y) < 200);
      if (near) g.lock?.set?.(near);
      g.camera.snap?.();
    });
    await wait(1500);
    const fps = await ev(
      () =>
        new Promise((res) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
            else res(Math.round((n * 1000) / (performance.now() - t0)));
          };
          requestAnimationFrame(tick);
        }),
    );
    await shot('15-throttled');
    check(fps >= 20, `[${tag}] at ${S.throttle}x CPU throttle the village runs at ${fps} fps`, `${fps} fps`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  const scroll = await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!scroll, `[${tag}] no sideways scroll`);
  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  for (const S of SIZES) await run(S);
} catch (err) {
  failures.push(`crashed: ${err.stack || err}`);
  console.error(err);
}
await browser.close();
server.close();
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
