// Round 14b base check: the shared ground every workstream builds on, played in the built
// game on a phone sideways (844x390) and upright (390x844) by touch, and on a computer
// (1280x720) by keys and mouse (DESIGN §33–§37):
//   - game.lyra is Lyra; game.party.holder is Lyra at a new game; a child can never hold it;
//   - the six workstream sheets are in the page, after styles.css; the plugin slots load;
//   - a silent, unmarked killing (the Unkindling's path, murder.kill options) makes no call
//     for help and no cry; its body lies with no blood beside a marked one that has some;
//   - an onFound handler owns the discovery of the cause it knows; without one the old
//     discovery (a case, "struck down with a blade") holds;
//   - murder.die (old age): no alarm and no case; found, "no mark on her";
//   - the use button lifts and lays down an unmarked body (real taps / the E key);
//   - party, provenance and the new death records are in the save;
//   - Tansy is a child at 15 and an adult at 16 (the calendar's age decides);
//   - on the phone held sideways at 4x CPU throttle the game keeps its frame rate.
//   node scripts/base_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/base';
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
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    // Every event this check cares about, as it happens.
    window.__ev = [];
    for (const t of ['call_for_help', 'villager_killed', 'villager_died', 'crime', 'body_found', 'companion_changed', 'murder_witnessed']) g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? p?.victim ?? null, p: { cause: p?.cause, silent: p?.silent, unmarked: p?.unmarked, owned: p?.owned, murder: p?.murder, to: p?.to } }));
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    // Nobody comes running (a fight near the vale would bring the watch).
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__clean();
  });

  // ---------- the vocabulary: Lyra the person, the role, a child ----------
  const who = await ev(() => {
    const g = window.__game;
    return {
      lyraIsCompanion: g.lyra === g.companion,
      holder: g.party?.holder?.id ?? null,
      pip: g.party.canHold('pip'),
      bram: g.party.canHold('bram'),
      provenance: !!g.provenance && typeof g.provenance.add === 'function',
      slots: Array.isArray(g.slotInstallers),
    };
  });
  check(who.lyraIsCompanion, `[${tag}] game.lyra is Lyra herself`);
  check(who.holder === 'lyra', `[${tag}] Lyra holds the companion role at a new game`, String(who.holder));
  check(!who.pip && who.bram, `[${tag}] a child never holds the role; an adult may`);
  check(who.provenance && who.slots, `[${tag}] game.provenance and the plugin slots are installed`);
  const sheets = await ev(() => {
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const at = (k) => css.indexOf(`workstream ${k}'s styles`);
    const main = css.indexOf('.cs-root');
    return { found: ['blood', 'party', 'polish', 'society', 'soul', 'talk'].map(at), main };
  });
  check(sheets.found.every((i) => i > sheets.main) && sheets.found.every((i, k, a) => k === 0 || i > a[k - 1]), `[${tag}] the six workstream sheets are inlined after styles.css, sorted`, JSON.stringify(sheets.found));

  // ---------- a silent, unmarked killing, then a blade killing beside it, in the open meadow ----------
  // Bram dies silently with Elda asleep a tile away (she would hear any cry, asleep: a third
  // of its reach) and nobody awake to see; then a handler owns his discovery; then Garrick
  // is knocked down and finished with the blade beside him. Everyone else is far off.
  await ev(() => {
    const g = window.__game;
    window.__at = (e, tx, ty) => {
      e.x = tx * 16 + 8;
      e.y = ty * 16 + 10;
      e.walker?.stop?.();
      if (e.r) e.r.key = null;
      e.think = () => {};
    };
    for (const e of g.villageLife.villagers()) if (!['bram', 'elda'].includes(e.id)) window.__at(e, 20 + Math.random() * 4, 52);
    const L = g.companion;
    L.x = 22 * 16;
    L.y = 56 * 16;
    L.controller = null;
    const P = g.player;
    P.x = 97 * 16 + 8;
    P.y = 103 * 16 + 10;
    P.faceDir?.('up');
    window.__at(g.entities.get('bram'), 96, 100);
    const elda = g.entities.get('elda');
    window.__at(elda, 95, 100);
    elda.state = 'sleep';
    g.camera.follow?.(P);
    g.camera.snap?.();
    window.__ev.length = 0;
    window.__toasts.length = 0;
  });
  await wait(400);
  const silent = await ev(() => {
    const g = window.__game;
    const bram = g.entities.get('bram');
    const elda = g.entities.get('elda');
    // The Unkindling's path (soul builds the spell): silent and unmarked.
    const r1 = g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true });
    return {
      r1: r1 && { cause: r1.cause, silent: r1.silent, unmarked: r1.unmarked, by: r1.by, seen: r1.seen.length },
      calls: window.__ev.filter((e) => e.t === 'call_for_help').length,
      heard: g.murder.heardBy(bram, 3),
      elda: { state: elda.state, uneasy: !!elda.uneasy },
      toasts: window.__toasts.slice(),
    };
  });
  await wait(800);
  const after = await ev(() => {
    const elda = window.__game.entities.get('elda');
    return { state: elda.state, uneasy: !!elda.uneasy, calls: window.__ev.filter((e) => e.t === 'call_for_help').length };
  });
  check(!!silent.r1 && silent.r1.cause === 'unkindled' && silent.r1.silent && silent.r1.unmarked && silent.r1.by === 'player' && silent.r1.seen === 0, `[${tag}] a silent, unmarked killing nobody saw records its cause, its killer and both marks`, JSON.stringify(silent.r1));
  check(silent.calls === 0 && after.calls === 0 && silent.heard === false, `[${tag}] silent: no call for help, nobody hears it`, `calls=${after.calls} heard=${silent.heard}`);
  check(after.state === 'sleep' && !after.uneasy, `[${tag}] Elda, asleep a tile away, sleeps on`, JSON.stringify(after));
  check(!silent.toasts.some((t) => /Bram cries out|Bram is shouting|saw you kill/.test(t)), `[${tag}] silent: no cry and no witness toast`, silent.toasts.join(' | '));

  // ---------- who owns a discovery: onFound ----------
  const found = await ev(() => {
    const g = window.__game;
    window.__toasts.length = 0;
    window.__off = g.murder.onFound((rec, ctx) => {
      if (rec.cause !== 'unkindled') return false;
      g.ui.toast(`${ctx.finder === 'hess' ? 'Hess' : 'Someone'} found Bram. No mark on him. Cold as stone, like the hollow wind took him, but there has been no wind.`, 'warn');
      return true;
    });
    // Elda goes home to bed; Garrick comes by.
    window.__at(g.entities.get('elda'), 22, 50);
    g.murder.found('bram', 'hess', 'south_meadow');
    return { toasts: window.__toasts.slice(), bramCase: !!g.murder.cases.bram, owned: !!g.murder.dead.bram.foundOwned };
  });
  check(!found.bramCase && found.owned && found.toasts.some((t) => /No mark on him/.test(t)) && !found.toasts.some((t) => /blade/i.test(t)), `[${tag}] onFound: the owner of 'unkindled' takes the discovery and the case`, JSON.stringify(found));

  // ---------- a blade killing beside it ----------
  const blade = await ev(() => {
    const g = window.__game;
    const P = g.player;
    const garrick = g.entities.get('garrick');
    window.__at(garrick, 99, 100);
    window.__ev.length = 0;
    window.__toasts.length = 0;
    garrick.hp = 1;
    g.combat.damage(P, garrick, 999, { exact: true, crit: false });
    const r2 = g.murder.kill(garrick, P);
    g.murder.found('garrick', 'hess', 'south_meadow');
    window.__off?.();
    return {
      r2: r2 && { cause: r2.cause, silent: r2.silent, unmarked: r2.unmarked, by: r2.by },
      calls: window.__ev.filter((e) => e.t === 'call_for_help' && e.id === 'garrick').length,
      ev: window.__ev.filter((e) => e.t === 'villager_killed').map((e) => [e.id, e.p.cause, e.p.silent, e.p.unmarked]),
      garrickCase: !!g.murder.cases.garrick,
      toasts: window.__toasts.slice(),
    };
  });
  check(!!blade.r2 && blade.r2.cause === 'killed' && !blade.r2.silent && !blade.r2.unmarked, `[${tag}] a blade killing is a marked, voiced killing`, JSON.stringify(blade.r2));
  check(blade.calls > 0, `[${tag}] the blow on Garrick still cries out (the hearing rule, unchanged)`);
  check(JSON.stringify(blade.ev) === JSON.stringify([['garrick', 'killed', false, false]]), `[${tag}] villager_killed carries cause, silent and unmarked`, JSON.stringify(blade.ev));
  check(blade.garrickCase && blade.toasts.some((t) => /Struck down with a blade/.test(t)), `[${tag}] no owner for a blade killing: the old discovery and a case`);
  // The two bodies, the stranger a little below them, the speech marks cleared.
  await ev(() => {
    const g = window.__game;
    g.bubbles?.clearAll?.();
    window.__clean();
    g.camera.snap?.();
  });
  await wait(600);
  await shot('1-unmarked-and-marked');
  // The pixels under each body: dried blood under Garrick, none under Bram.
  const blood = await ev(() => {
    const g = window.__game;
    const cv = g.canvas;
    const c2 = document.createElement('canvas');
    c2.width = cv.width;
    c2.height = cv.height;
    const x2 = c2.getContext('2d');
    x2.drawImage(cv, 0, 0);
    const red = (e) => {
      const r = g.renderer;
      const k = cv.width / cv.clientWidth || 1; // canvas pixels per CSS pixel
      const vx = r.viewX;
      const vy = r.viewY;
      const cx = Math.round((((e.x - vx) * r.scale) / r.dpr) * k);
      const cy = Math.round((((e.y - vy) * r.scale) / r.dpr) * k);
      const s = Math.max(1, Math.round((r.scale / r.dpr) * k));
      const d = x2.getImageData(cx - 10 * s, cy - 4 * s, 20 * s, 8 * s).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 40 && d[i] < 150 && d[i + 1] < 35 && d[i + 2] < 45 && d[i] > d[i + 1] * 2.2) n++;
      return n;
    };
    return { bram: red(g.entities.get('bram')), garrick: red(g.entities.get('garrick')) };
  });
  check(blood.garrick > 0 && blood.bram === 0, `[${tag}] blood under the marked body, none under the unmarked one`, JSON.stringify(blood));

  // ---------- the body is still a body: lift it and lay it down (the use button) ----------
  await ev(() => {
    const g = window.__game;
    const b = g.entities.get('bram');
    g.player.x = b.x - 12;
    g.player.y = b.y;
    g.player.faceDir?.('right');
  });
  await wait(500);
  const label = await ev(() => window.__game.ui.lastPrompt || '');
  check(/Lift Bram/.test(label), `[${tag}] the use button offers to lift the unmarked body`, label);
  await shot('2-lift-prompt');
  await use();
  const lifted = await ev(() => window.__game.player.carrying?.id ?? null);
  check(lifted === 'bram', `[${tag}] ${S.phone ? 'a tap' : 'E'} lifts him`, String(lifted));
  await shot('3-carrying');
  await use();
  const laid = await ev(() => ({ carrying: window.__game.player.carrying?.id ?? null, state: window.__game.murder.dead.bram.state }));
  check(!laid.carrying, `[${tag}] and lays him down again`, JSON.stringify(laid));
  await wait(300);
  await shot('4-found');

  // ---------- a death nobody did ----------
  const age = await ev(() => {
    const g = window.__game;
    window.__ev.length = 0;
    window.__toasts.length = 0;
    const petra = g.entities.get('petra');
    const rec = g.murder.die(petra, { cause: 'age' });
    g.murder.found('petra', 'alder', 'ashby_house');
    return {
      rec: rec && { cause: rec.cause, natural: rec.natural, unmarked: rec.unmarked },
      kinds: window.__ev.map((e) => e.t),
      caseOpen: !!g.murder.cases.petra,
      wanted: g.murder.isWanted(),
      toasts: window.__toasts.slice(),
      pip: g.murder.die(g.entities.get('pip'), { cause: 'age' }),
    };
  });
  check(!!age.rec && age.rec.natural && age.rec.cause === 'age', `[${tag}] Petra dies of age: a natural death`, JSON.stringify(age.rec));
  check(age.kinds.includes('villager_died') && !age.kinds.includes('villager_killed') && !age.kinds.includes('crime') && !age.caseOpen && !age.wanted, `[${tag}] no killing, no alarm, no case, not wanted`, age.kinds.join(','));
  check(age.toasts.some((t) => /No mark on her/.test(t)) && !age.toasts.some((t) => /blade/i.test(t)), `[${tag}] found: "no mark on her", no blade`, age.toasts.join(' | '));
  check(age.pip === null, `[${tag}] a child never dies of age`);
  await wait(300);
  await shot('5-old-age-found');

  // ---------- the save holds it ----------
  const saved = await ev(() => {
    const g = window.__game;
    g.player.inventory.add('ring', 1);
    g.provenance.add('ring', 1, { owner: 'garrick', how: 'body', seenBy: [] });
    const d = JSON.parse(JSON.stringify(g.serialize()));
    return { party: d.party, prov: d.plugins?.provenance?.entries?.map((e) => [e.itemId, e.owner, e.how]), bram: d.murder.dead.bram && [d.murder.dead.bram.cause, d.murder.dead.bram.silent, d.murder.dead.bram.unmarked, d.murder.dead.bram.by], petra: d.murder.dead.petra && [d.murder.dead.petra.cause, d.murder.dead.petra.natural] };
  });
  check(saved.party?.holderId === 'lyra' && JSON.stringify(saved.prov) === JSON.stringify([['ring', 'garrick', 'body']]) && JSON.stringify(saved.bram) === JSON.stringify(['unkindled', true, true, 'player']) && JSON.stringify(saved.petra) === JSON.stringify(['age', true]), `[${tag}] the save holds the party, the ledger and the new death records`, JSON.stringify(saved));

  // ---------- a slow phone keeps its frame rate ----------
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev(() => {
      const g = window.__game;
      const P = g.player;
      P.x = 88 * 16;
      P.y = 50 * 16;
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
    await shot('6-throttled');
    const st = await ev(() => window.__game.state);
    check(st === 'playing', `[${tag}] measured in play (no scene)`, st);
    check(fps >= 20, `[${tag}] at ${S.throttle}x CPU throttle the village runs at ${fps} fps`, `${fps} fps`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  // ---------- Tansy grows up ----------
  const tansy = await ev(() => {
    const g = window.__game;
    const before = { age: g.calendar.ageOf('tansy'), canHold: g.party.canHold('tansy') };
    const day = g.clock.day;
    let d = day;
    while (g.calendar.ageOf('tansy') < 16 && d < day + 40) {
      g.clock.t += 900;
      d = g.clock.day;
    }
    g.calendar.update();
    return { before, after: { age: g.calendar.ageOf('tansy'), canHold: g.party.canHold('tansy') } };
  });
  check(tansy.before.age === 15 && !tansy.before.canHold && tansy.after.age === 16 && tansy.after.canHold, `[${tag}] Tansy is a child at 15 and an adult at 16`, JSON.stringify(tansy));

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
