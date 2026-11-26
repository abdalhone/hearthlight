// Round 14b society check: the workstream's items played in the built game on a phone
// sideways (844x390) and upright (390x844) by touch (real taps), and on a computer (1280x720)
// by mouse and keys (DESIGN §36):
//   - the date ("Day 1, early autumn, year 1") and Settings → Game → The years;
//   - the shop: Bram's jerkin bought down to sold out, an iron sword sold after an inline
//     "Sure?", Mira's haggle, Garrick knowing his own stolen lantern (refused, in his words);
//   - the trial: a defence typed in the stranger's own words, the Moot weighing it face by
//     face, each juror's reason, the verdict;
//   - the tempter at the ruins gate at night: his offer, the pact ("Teach me after"), and
//     pact_sealed carrying the Unkindling;
//   - the years: Bram greyer after thirteen years, Pip grown, the dead not aging, a death of
//     old age with no case and no Moot;
//   - on the phone held sideways at 4x CPU throttle, the shop and the village keep their pace.
//   node scripts/society_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/society';
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
      const list = [...document.querySelectorAll(sel)];
      for (const e of list) {
        let hidden = false;
        for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') hidden = true;
        if (hidden) continue;
        e.scrollIntoView?.({ block: 'nearest' });
        const r = e.getBoundingClientRect();
        if (r.width && r.height) return { x: r.left, y: r.top, w: r.width, h: r.height };
      }
      return null;
    }, sel);
  // A real tap on a phone, a real click with the mouse on a computer.
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return false;
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    if (S.phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await wait(250);
    return true;
  };
  const sizeOf = async (sel) => (await rectOf(sel)) || { w: 0, h: 0 };
  // A dialogue's options show once its line has been read: tap the words on until they do.
  const option = async (sel) => {
    for (let i = 0; i < 30; i++) {
      if (await rectOf(sel)) return press(sel);
      await press('.panel-dialog .dlg-box');
      await wait(250);
    }
    return false;
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
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__ev = [];
    for (const t of ['pact_sealed', 'moot_verdict', 'villager_died', 'villager_killed', 'birthday', 'theft_recognized', 'trade']) g.bus.on(t, (p) => window.__ev.push({ t, p: { gifts: p?.gifts, pact: p?.pact, guilty: p?.guilty, mercy: p?.mercy, votes: p?.votes?.length, id: p?.id, cause: p?.cause, itemId: p?.itemId } }));
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    // Everyone still, where the check puts them.
    window.__hold = (ids) => {
      for (const id of ids) {
        const e = g.entities.get(id);
        if (!e) continue;
        e.think = () => {
          e.moveIntent.x = 0;
          e.moveIntent.y = 0;
        };
      }
    };
    window.__put = (id, x, y) => {
      const e = id === 'player' ? g.player : g.entities.get(id);
      e.x = x;
      e.y = y;
      e.walker?.stop?.();
      if (e.r) e.r.key = null;
    };
    window.__clean();
  });

  // ---------- the date and the years ----------
  const date = await ev(() => window.__game.calendar?.dateLabel?.());
  check(date === 'Day 1, early autumn, year 1', `[${tag}] the date reads ${date}`);
  await ev(() => window.__game.ui.openSettings('game'));
  await wait(500);
  const years = await ev(() => [...document.querySelectorAll('.panel-settings *')].some((e) => /A year lasts/.test(e.textContent || '')) && [...document.querySelectorAll('.panel-settings *')].some((e) => /People die of old age/.test(e.textContent || '')));
  await ev(() => [...document.querySelectorAll('.panel-settings *')].find((e) => /A year lasts/.test(e.textContent || '') && e.children.length === 0)?.scrollIntoView?.({ block: 'center' }));
  await wait(200);
  await shot('1-settings-years');
  check(years, `[${tag}] Settings → Game → The years: "A year lasts" and "People die of old age"`);
  await ev(() => window.__clean());

  // ---------- the shop ----------
  const P = await ev(() => {
    const g = window.__game;
    window.__hold(['bram', 'mira', 'garrick', 'elda']);
    g.player.inventory.add('coin', 400);
    g.player.inventory.add('iron_sword', 1);
    return { x: g.player.x, y: g.player.y };
  });
  await ev((P) => {
    window.__put('bram', P.x + 18, P.y);
    window.__game.ui.openDialog(window.__game.entities.get('bram'));
  }, P);
  await option('.dlg-opt.opt-shop');
  await page.waitForSelector('.shop', { timeout: 4000 }).catch(() => {});
  await wait(300);
  const jerkinRow = await ev(() => [...document.querySelectorAll('.shop-row')].findIndex((r) => /Leather Jerkin/.test(r.textContent)));
  check(jerkinRow >= 0, `[${tag}] Bram sells a leather jerkin`);
  await shot('2-shop-bram-buy');
  // Buy it with a real tap on its Buy button.
  const bought = await ev(() => {
    const r = [...document.querySelectorAll('.shop-row')].find((x) => /Leather Jerkin/.test(x.textContent));
    r?.querySelector('.btn-ember')?.setAttribute('data-test', 'buy-jerkin');
    return !!r;
  });
  if (bought) await press('[data-test="buy-jerkin"]');
  await wait(300);
  const after = await ev(() => {
    const g = window.__game;
    const r = [...document.querySelectorAll('.shop-row')].find((x) => /Leather Jerkin/.test(x.textContent));
    return { have: g.player.inventory.count('leather_jerkin'), left: g.trade.stockLeft(g.entities.get('bram'), 'leather_jerkin'), text: r?.textContent || '' };
  });
  check(after.have === 1 && after.left === 0 && /Sold out/.test(after.text), `[${tag}] the jerkin bought; "Sold out, back tomorrow"`, JSON.stringify(after).slice(0, 160));
  await shot('3-shop-sold-out');
  // Sell the sword: the Sell tab (phones) or the right column; an inline "Sure?" first.
  if (S.phone) await press('.shop-tabs .seg:nth-child(2)');
  await ev(() => {
    const r = [...document.querySelectorAll('.shop-row')].find((x) => /Iron Sword/.test(x.textContent) && /Sell 1/.test(x.textContent));
    [...(r?.querySelectorAll('.btn') || [])].find((b) => /Sell 1/.test(b.textContent))?.setAttribute('data-test', 'sell-sword');
  });
  await press('[data-test="sell-sword"]');
  const ask = await ev(() => !!document.querySelector('.shop-ask'));
  check(ask, `[${tag}] selling a sword asks first, inline (no browser confirm)`);
  await shot('4-shop-sell-ask');
  await ev(() => [...document.querySelectorAll('.shop-btns .btn-ember')].find((b) => /Sell for/.test(b.textContent))?.setAttribute('data-test', 'sell-yes'));
  const coin0 = await ev(() => window.__game.player.inventory.count('coin'));
  await press('[data-test="sell-yes"]');
  const coin1 = await ev(() => window.__game.player.inventory.count('coin'));
  check(coin1 > coin0, `[${tag}] the sword sold (${coin1 - coin0} coins)`);
  const btnH = await sizeOf('.shop .btn');
  if (S.phone) check(btnH.h >= 43, `[${tag}] shop buttons are 44 px targets`, `${Math.round(btnH.h)} px`);
  await ev(() => window.__clean());
  // Mira: haggle.
  await ev((P) => {
    window.__put('mira', P.x + 18, P.y);
    window.__game.ui.openDialog(window.__game.entities.get('mira'));
  }, P);
  await option('.dlg-opt.opt-shop');
  await page.waitForSelector('.shop-haggle', { timeout: 4000 }).catch(() => {});
  await press('.shop-haggle');
  await wait(400);
  const hag = await ev(() => {
    const g = window.__game;
    const h = g.trade.haggles.mira;
    return { tried: !!h, line: document.querySelector('.panel-dialog .dlg-text')?.textContent || '', disabled: !!document.querySelector('.shop-haggle')?.disabled };
  });
  check(hag.tried && hag.disabled && hag.line.length > 2, `[${tag}] Mira's haggle: once today, answered in her words`, hag.line.slice(0, 80));
  await shot('5-shop-mira-haggle');
  await ev(() => window.__clean());
  // Garrick and his own lantern (stolen from his shelf).
  await ev((P) => {
    const g = window.__game;
    window.__put('garrick', P.x + 18, P.y);
    g.player.inventory.add('lantern', 1);
    g.provenance.add('lantern', 1, { owner: 'garrick', how: 'chest', day: 1, seenBy: [] });
    // Make today one he knows it (the roll is seeded by the day): try days until he would.
    const T = g.trade;
    for (let i = 0; i < 8 && !T.recognizes('garrick', 'lantern', T.stolenOf('lantern', 1)); i++) g.clock.t += 1200;
    g.ui.openDialog(g.entities.get('garrick'));
  }, P);
  await option('.dlg-opt.opt-shop');
  await page.waitForSelector('.shop', { timeout: 4000 }).catch(() => {});
  if (S.phone) await press('.shop-tabs .seg:nth-child(2)');
  await wait(300);
  const marked = await ev(() => [...document.querySelectorAll('.shop-row.is-stolen')].some((r) => /Lantern/.test(r.textContent)));
  check(marked, `[${tag}] the lantern is marked stolen`);
  await shot('6-shop-stolen-mark');
  await ev(() => {
    const r = [...document.querySelectorAll('.shop-row.is-stolen')].find((x) => /Lantern/.test(x.textContent));
    [...(r?.querySelectorAll('.btn') || [])].find((b) => /Sell 1/.test(b.textContent))?.setAttribute('data-test', 'sell-lantern');
  });
  await press('[data-test="sell-lantern"]');
  await ev(() => [...document.querySelectorAll('.shop-btns .btn-ember')].find((b) => /Sell for/.test(b.textContent))?.click());
  await wait(500);
  const caught = await ev(() => ({ have: window.__game.player.inventory.count('lantern'), line: document.querySelector('.panel-dialog .dlg-text')?.textContent || '', ev: window.__ev.some((e) => e.t === 'theft_recognized') }));
  check(caught.have === 1 && caught.ev, `[${tag}] Garrick knows his own lantern: refused, in his words`, caught.line.slice(0, 80));
  await shot('7-shop-stolen-refused');
  await ev(() => window.__clean());

  // ---------- the trial ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo(14);
    const bram = g.entities.get('bram');
    window.__put('bram', g.player.x + 16, g.player.y);
    const rec = g.murder.kill(bram);
    rec.seen = [{ id: 'elda', clarity: 'clear' }];
    rec.known = 'witnessed';
    rec.provoked = true;
    rec.alarm = { raised: true, by: 'rowan' };
    g.murder.openCase('bram');
    g.murder.surrender('bram');
  });
  await page.waitForFunction(() => window.__game.story?.isPlaying?.(), null, { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    const open = await ev(() => !!document.querySelector('.panel-defence'));
    if (open) break;
    await ev(() => window.__game.story?.player?.skip?.());
    await wait(300);
  }
  await page.waitForSelector('.panel-defence', { timeout: 8000 }).catch(() => {});
  await wait(600);
  const field = await rectOf('.panel-defence .defence-field');
  check(!!field, `[${tag}] the defence: a field to speak for yourself`);
  if (field) {
    if (S.phone) await page.touchscreen.tap(field.x + 20, field.y + 10);
    else await page.mouse.click(field.x + 20, field.y + 10);
    await page.keyboard.type('He attacked me first with his hammer. I had no choice.', { delay: 4 });
  }
  const chips = await ev(() => ['confess', 'deny', 'silent'].every((k) => !!document.querySelector(`.panel-defence .opt-${k}`)));
  check(chips, `[${tag}] the three chips stay: I did it / It was not me / Say nothing`);
  const closeBtn = await sizeOf('.panel-defence .panel-close');
  check(closeBtn.w >= 44 && closeBtn.h >= 44, `[${tag}] the defence panel closes with a 44 px control`, `${Math.round(closeBtn.w)}x${Math.round(closeBtn.h)}`);
  await shot('8-trial-defence');
  await press('.panel-defence .defence-send');
  await page.waitForSelector('.panel-weighing', { timeout: 8000 }).catch(() => {});
  await wait(700);
  const jury = await ev(() => ({ cards: document.querySelectorAll('.panel-weighing .jury-card').length, voted: [...document.querySelectorAll('.panel-weighing .jury-vote')].filter((v) => !v.classList.contains('is-wait')).length }));
  check(jury.cards >= 3 && jury.voted === jury.cards, `[${tag}] the Moot weighs it: ${jury.cards} faces, each with a word and a vote`);
  await shot('9-trial-weighing');
  await press('.panel-weighing .opt-hear');
  for (let i = 0; i < 30; i++) {
    const done = await ev(() => !!window.__game.murder.cases.bram?.verdict);
    if (done) break;
    await ev(() => window.__game.story?.player?.skip?.());
    await wait(250);
  }
  const verdict = await ev(() => {
    const c = window.__game.murder.cases.bram;
    return { verdict: c?.verdict, sentence: c?.trial?.sentence, votes: c?.trial?.votes?.length, claims: (c?.trial?.claims || []).map((x) => x.kind) };
  });
  check(!!verdict.verdict && verdict.votes >= 3 && verdict.claims.includes('self_defence'), `[${tag}] the verdict emerges from the votes`, JSON.stringify(verdict));
  await wait(400);
  await shot('10-trial-verdict');
  await ev(() => {
    const g = window.__game;
    g.murder.outside = null;
    g.murder.wanted = null;
    g.player.crime = null;
    window.__clean();
  });

  // ---------- the tempter ----------
  await ev(() => {
    const g = window.__game;
    g.flags.bosses = { varek: { defeated: true, shards: {} } };
    g.clock.skipTo(22);
  });
  await page.waitForFunction(() => !!window.__game.villain?.tempter, null, { timeout: 8000 }).catch(() => {});
  const T = await ev(() => {
    const g = window.__game;
    const t = g.villain.tempter;
    if (!t) return null;
    window.__put('player', t.x, t.y + 22);
    g.camera.snap?.();
    return { x: t.x, y: t.y };
  });
  check(!!T, `[${tag}] the tempter waits at the ruins gate at night`);
  await wait(600);
  await ev(() => window.__clean());
  await shot('11-tempter-gate');
  await ev(() => window.__game.ui.openDialog(window.__game.villain.tempter));
  await wait(600);
  const offer = await ev(() => document.querySelector('.panel-dialog .dlg-text')?.textContent || '');
  await shot('12-tempter-offer');
  // Read on to the choices, then "Teach me after."
  await option('.panel-dialog .opt-after');
  await wait(500);
  const pact = await ev(() => ({ has: window.__game.villain.hasPact(), sealed: window.__ev.find((e) => e.t === 'pact_sealed')?.p }));
  check(pact.has && pact.sealed?.gifts?.includes('unkindle'), `[${tag}] the pact sealed "after"; pact_sealed carries the Unkindling`, JSON.stringify(pact.sealed));
  await shot('13-tempter-pact');
  check(offer.length > 10, `[${tag}] he speaks first`, offer.slice(0, 60));
  await ev(() => window.__clean());

  // ---------- the years ----------
  const years2 = await ev(() => {
    const g = window.__game;
    g.settings.oldAge = false;
    g.clock.skipTo(10);
    g.clock.skipDays(12 * 13);
    g.calendar.update();
    const bram = g.entities.get('bram');
    const pip = g.entities.get('pip');
    return { date: g.calendar.dateLabel(), bramAge: g.calendar.ageOf('bram'), pipAge: g.calendar.ageOf('pip'), pipKey: pip?.spriteKey, hobbKey: g.entities.get('hobb')?.spriteKey, elda: g.entities.get('elda')?.spriteKey };
  });
  check(years2.pipAge >= 16 && /^pip~/.test(years2.pipKey || ''), `[${tag}] thirteen years on: Pip is ${years2.pipAge}, grown (${years2.pipKey})`);
  check(years2.bramAge === 52, `[${tag}] the dead do not age: Bram stays 52`, String(years2.bramAge));
  check(/^hobb~/.test(years2.hobbKey || ''), `[${tag}] Hobb looks his years (${years2.hobbKey})`);
  await ev((P) => {
    const g = window.__game;
    window.__hold(['pip', 'elda', 'hobb']);
    window.__put('player', P.x, P.y);
    window.__put('pip', P.x + 20, P.y);
    window.__put('elda', P.x + 40, P.y);
    window.__put('hobb', P.x + 60, P.y);
    g.camera.snap?.();
  }, P);
  await wait(800);
  await ev(() => window.__clean());
  await shot('14-years-grown');
  await ev(() => window.__game.ui.openDialog(window.__game.entities.get('elda')));
  await wait(600);
  await shot('15-years-elda-portrait');
  await ev(() => window.__clean());

  // ---------- a death of old age ----------
  const age = await ev(() => {
    const g = window.__game;
    g.settings.oldAge = true;
    g.aging.begin('corran');
    g.clock.skipTo(2.5);
    return g.aging.failing.corran ? true : g.murder.dead.corran?.cause;
  });
  await wait(2600);
  const died = await ev(() => {
    const g = window.__game;
    g.clock.skipTo(8);
    return { rec: g.murder.dead.corran ? { cause: g.murder.dead.corran.cause, natural: g.murder.dead.corran.natural } : null };
  });
  await wait(2600);
  const found = await ev(() => {
    const g = window.__game;
    return { found: g.murder.dead.corran?.foundAt != null, case: !!g.murder.cases.corran, moot: g.murder.moots.some((x) => x.about === 'corran'), funeral: g.murder.funerals.some((f) => f.about === 'corran'), killed: window.__ev.some((e) => e.t === 'villager_killed' && e.p.id === 'corran') };
  });
  check(!!age && died.rec?.cause === 'age' && died.rec?.natural, `[${tag}] Corran dies of old age in the night (murder.die)`, JSON.stringify(died));
  check(found.found && !found.case && !found.moot && found.funeral && !found.killed, `[${tag}] found in the morning: a funeral, no case, no Moot, no killing`, JSON.stringify(found));
  await shot('16-old-age-found');

  // ---------- the phone at 4x CPU throttle ----------
  if (S.throttle) {
    await ev(() => window.__clean());
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev((P) => {
      window.__put('player', P.x, P.y);
      window.__game.camera.snap?.();
    }, P);
    await wait(800);
    const fps = await ev(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - t0 >= 3000) resolve(Math.round((n * 1000) / (performance.now() - t0)));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await shot('17-throttled');
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
