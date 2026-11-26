// Version 12 join (DESIGN §39): the stat points second pass played against round 14b's panels
// on a phone sideways (844x390, 4x CPU), upright (390x844) by real taps, and a computer
// (1280x720) by mouse and keys, with 999 Focus, 999 Vitality and 999 Might (Free stat points):
//   - the HUD with Lyra, with nobody (she is dead) and with Bram (any adult);
//   - People, the Character sheet (the Next line and the curve note), the shop's ware detail
//     (gear words saying what each % is a share of), the trial (defence and the Moot);
//   - Lyra at full health and one real swing: down, never gone; the held blow's finisher;
//   - fallen with 999 Resolve: a 300 s countdown that fits its ring.
//   node scripts/v12_ui_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/v12';
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
      for (const e of document.querySelectorAll(sel)) {
        let hidden = false;
        for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') hidden = true;
        if (hidden) continue;
        const r = e.getBoundingClientRect();
        if (r.width && r.height) return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
      }
      return null;
    }, sel);
  const tapAt = async (x, y) => {
    if (S.phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await wait(250);
  };
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return false;
    await tapAt(r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  const option = async (sel) => {
    for (let i = 0; i < 30; i++) {
      if (await rectOf(sel)) return press(sel);
      await press('.panel-dialog .dlg-box');
      await wait(250);
    }
    return false;
  };
  // Nothing of the HUD spills off the screen.
  const hudFits = () =>
    ev(() => {
      const W = innerWidth;
      const H = innerHeight;
      const out = [];
      for (const e of document.querySelectorAll('.hud-cards, .hud-cards *, .hud-right, .hud-bottom, .hud-bottom *')) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${e.className || e.tagName}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
      return out;
    });
  const swing = async () => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      if (!r) return false;
      await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    } else await page.keyboard.press('j');
    await wait(260);
    return true;
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

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(600);
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
  }
  const nums = await ev(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.clock.skipTo?.(11);
    const u = g.ui;
    for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
    u?.coach?.stop?.();
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__ev = [];
    for (const t of ['finisher', 'villager_killed', 'companion_changed']) g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? null, to: p?.to ?? null }));
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__hold = (ids) => {
      for (const id of ids) {
        const e = g.entities.get(id);
        if (e) e.think = () => {
          e.moveIntent.x = 0;
          e.moveIntent.y = 0;
        };
      }
    };
    // The companion card as seen: '' when the slot is empty (hidden).
    window.__compCard = () => {
      const w = document.querySelector('.companion-wrap');
      if (!w || w.hidden || getComputedStyle(w).display === 'none') return '';
      return w.textContent || '';
    };
    window.__put = (id, x, y) => {
      const e = id === 'player' ? g.player : id === 'lyra' ? g.companion : g.entities.get(id);
      e.x = x;
      e.y = y;
      e.walker?.stop?.();
      if (e.r) e.r.key = null;
    };
    const m = g.locations.get('south_meadow').center;
    window.__put('player', m.x, m.y);
    window.__put('lyra', m.x + 24, m.y + 6);
    g.camera.snap?.();
    const pr = g.progression;
    pr.startFree();
    for (const id of ['vitality', 'focus', 'might']) pr.spend(id, 999);
    g.stats.refresh(g.player);
    g.player.hp = g.player.maxHp;
    g.magic.mana.cur = g.magic.mana.max;
    window.__clean();
    return { hp: g.player.maxHp, mana: g.magic.mana.max, atk: g.stats.get(g.player, 'atk') };
  });
  check(nums.hp > 4800 && nums.mana > 3800, `[${tag}] 999 Vitality and Focus: ${nums.hp} health, ${nums.mana} mana, sword ${Math.round(nums.atk)}`);
  await wait(1200);

  // ---------- the HUD with Lyra ----------
  const hudLyra = await ev(() => window.__compCard());
  check(/Lyra/.test(hudLyra), `[${tag}] Lyra's card in the slot`, hudLyra.slice(0, 40));
  const spill1 = await hudFits();
  check(spill1.length === 0, `[${tag}] the HUD fits with 4908 health and 3907 mana (with Lyra)`, spill1.slice(0, 4).join(' '));
  await shot('01-hud-lyra');

  // ---------- People ----------
  await ev(() => window.__game.ui.openPeople('lyra'));
  await wait(600);
  const ppl = await rectOf('.panel-people .panel-close, .people .panel-close, .panel .panel-close');
  check(!!ppl && ppl.w >= 44 && ppl.h >= 44, `[${tag}] People closes with a 44 px control`, ppl ? `${Math.round(ppl.w)}x${Math.round(ppl.h)}` : 'none');
  await shot('02-people');
  await ev(() => window.__clean());
  await wait(300);

  // ---------- the Character sheet ----------
  if (S.phone) {
    const r = await ev(() => {
      const q = document.querySelector('.player-card')?.getBoundingClientRect();
      return q ? { x: q.left + Math.min(30, q.width / 2), y: q.top + q.height / 2 } : null;
    });
    if (r) await tapAt(r.x, r.y);
  } else await page.keyboard.press('KeyC');
  await wait(600);
  const sheet = await ev(() => {
    const rows = [...document.querySelectorAll('.chs-attr')].map((r) => ({ name: r.querySelector('.chs-attr-name')?.textContent, next: r.querySelector('.chs-next-text')?.textContent || '' }));
    const note = document.querySelector('.chs-curve-note')?.textContent || '';
    const W = innerWidth;
    let over = 0;
    for (const e of document.querySelectorAll('.panel-character *, .chs *')) {
      const r = e.getBoundingClientRect();
      if (r.width && r.right > W + 1) over++;
    }
    return { open: !!window.__game.ui.character?.isOpen?.(), rows, note, over };
  });
  check(sheet.open, `[${tag}] the Character sheet opens (${S.phone ? 'a tap on your card' : 'C'})`);
  const vit = sheet.rows.find((r) => r.name === 'Vitality');
  check(!!vit && /As high as it goes|health/.test(vit.next), `[${tag}] Vitality's Next line at 999: "${vit?.next}"`);
  const grace = sheet.rows.find((r) => r.name === 'Grace');
  check(!!grace && /\+1\.5% speed/.test(grace.next), `[${tag}] Grace's Next line: "${grace?.next}"`);
  check(/keep growing/.test(sheet.note), `[${tag}] the curve note: "${sheet.note}"`);
  check(sheet.over === 0, `[${tag}] nothing on the sheet spills sideways`, String(sheet.over));
  await shot('03-sheet');
  await ev(() => window.__clean());
  await wait(300);

  // ---------- the shop: a ware says what its % are a share of ----------
  const P = await ev(() => {
    const g = window.__game;
    window.__hold(['garrick']);
    g.player.inventory.add('coin', 400);
    return { x: g.player.x, y: g.player.y };
  });
  await ev((P) => {
    window.__put('garrick', P.x + 18, P.y);
    window.__game.ui.openDialog(window.__game.entities.get('garrick'));
  }, P);
  await option('.dlg-opt.opt-shop');
  await page.waitForSelector('.shop', { timeout: 4000 }).catch(() => {});
  await wait(300);
  const boots = await ev(() => {
    const rows = [...document.querySelectorAll('.shop-row')];
    const r = rows.find((x) => /Boots/.test(x.querySelector('.shop-name')?.textContent || ''));
    if (!r) return { found: false, names: rows.map((x) => x.querySelector('.shop-name')?.textContent) };
    r.setAttribute('data-test', 'boots');
    r.scrollIntoView({ block: 'center' });
    return { found: true, name: r.querySelector('.shop-name')?.textContent };
  });
  check(boots.found, `[${tag}] Garrick sells boots`, JSON.stringify(boots));
  if (boots.found) {
    const r = await rectOf('[data-test="boots"] .shop-name');
    if (r) await tapAt(r.x + 10, r.y + r.h / 2);
    await wait(300);
  }
  const detail = await ev(() => {
    const d = document.querySelector('[data-test="boots"] .shop-detail');
    return { shown: !!d && !d.hidden, text: d?.textContent || '', title: document.querySelector('[data-test="boots"]')?.getAttribute('title') || '' };
  });
  check(detail.shown && /of your normal pace/.test(detail.text), `[${tag}] a tap on the boots shows what they do, each % a share: "${detail.text.slice(-70)}"`);
  check(/of your normal pace/.test(detail.title), `[${tag}] and the row's hover title says it`);
  await shot('04-shop-ware');
  await ev(() => window.__clean());
  await wait(300);

  // ---------- Bram walks with you ----------
  const inv = await ev(() => {
    const g = window.__game;
    const b = g.entities.get('bram');
    b.opinionOfPlayer = 85;
    window.__put('bram', g.player.x + 18, g.player.y + 30);
    return g.party.invite(b);
  });
  await wait(900);
  const withBram = await ev(() => ({ holder: window.__game.party?.holderId ?? null, text: window.__compCard() }));
  check(withBram.holder === 'bram' && /Bram/.test(withBram.text), `[${tag}] the HUD with Bram`, JSON.stringify({ ok: inv?.ok, why: inv?.reason, text: withBram.text.slice(0, 60) }));
  const spill3 = await hudFits();
  check(spill3.length === 0, `[${tag}] the HUD fits with Bram`, spill3.slice(0, 4).join(' '));
  await shot('05-hud-bram');
  await ev(() => {
    window.__game.party.release('dismissed');
    window.__clean();
  });
  await wait(400);

  // ---------- the trial ----------
  await ev(() => {
    const g = window.__game;
    const tob = g.entities.get('tobias');
    window.__put('tobias', g.player.x + 16, g.player.y);
    const rec = g.murder.kill(tob);
    rec.seen = [{ id: 'elda', clarity: 'clear' }];
    rec.known = 'witnessed';
    rec.provoked = true;
    rec.alarm = { raised: true, by: 'rowan' };
    g.murder.openCase('tobias');
    g.murder.surrender('tobias');
  });
  await page.waitForFunction(() => window.__game.story?.isPlaying?.(), null, { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 24; i++) {
    if (await ev(() => !!document.querySelector('.panel-defence'))) break;
    await ev(() => window.__game.story?.player?.skip?.());
    await wait(300);
  }
  await page.waitForSelector('.panel-defence', { timeout: 8000 }).catch(() => {});
  await wait(500);
  const field = await rectOf('.panel-defence .defence-field');
  check(!!field, `[${tag}] the trial: the defence panel with your huge numbers`);
  if (field) {
    await tapAt(field.x + 20, field.y + 10);
    await page.keyboard.type('He came at me with a pitchfork.', { delay: 4 });
  }
  const dclose = await rectOf('.panel-defence .panel-close');
  check(!!dclose && dclose.w >= 44 && dclose.h >= 44, `[${tag}] the defence closes with a 44 px control`);
  await shot('06-trial-defence');
  await press('.panel-defence .defence-send');
  await page.waitForSelector('.panel-weighing', { timeout: 8000 }).catch(() => {});
  await wait(700);
  const jury = await ev(() => document.querySelectorAll('.panel-weighing .jury-card').length);
  check(jury >= 3, `[${tag}] the Moot weighs it: ${jury} faces`);
  await shot('07-trial-weighing');
  await press('.panel-weighing .opt-hear');
  for (let i = 0; i < 30; i++) {
    if (await ev(() => !!window.__game.murder.cases.tobias?.verdict)) break;
    await ev(() => window.__game.story?.player?.skip?.());
    await wait(250);
  }
  await ev(() => {
    const g = window.__game;
    for (let i = 0; i < 8; i++) g.story?.player?.skip?.();
    g.murder.outside = null;
    g.murder.wanted = null;
    g.player.crime = null;
    window.__clean();
    const m = g.locations.get('south_meadow').center;
    window.__put('player', m.x, m.y);
    g.camera.snap?.();
  });
  await wait(600);

  // ---------- Lyra at full health, one real swing with 999 Might ----------
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    L.hp = L.maxHp;
    window.__put('lyra', g.player.x + 16, g.player.y);
    L.behavior?.setDirective?.({ type: 'stay', x: L.x, y: L.y });
    g.player.faceToward(L.x, L.y);
    g.player.attackCd = 0;
    g.flags.finisherWarned = true;
    g.flags.finisherWarnedLyra = true;
  });
  await wait(200);
  for (let i = 0; i < 4; i++) {
    if (await ev(() => !!window.__game.companion.downed)) break;
    await ev(() => {
      const g = window.__game;
      window.__put('lyra', g.player.x + 16, g.player.y);
      g.player.faceToward(g.companion.x, g.companion.y);
      g.player.attackCd = 0;
    });
    await swing();
  }
  const ld = await ev(() => ({ downed: !!window.__game.companion.downed, dead: !!window.__game.companion.dead, removed: !!window.__game.companion.removed, hp: window.__game.companion.hp }));
  check(ld.downed && !ld.dead && !ld.removed, `[${tag}] Lyra at full health, struck by a ${Math.round(nums.atk)} sword: down, never gone`, JSON.stringify(ld));
  await shot('08-lyra-down');
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    g.player.x = L.x - 14;
    g.player.y = L.y;
    g.player.faceToward(L.x, L.y);
  });
  const holdP = holdSword(1900);
  await page.waitForFunction(() => window.__ev.some((e) => e.t === 'finisher'), null, { timeout: 4000 }).catch(() => {});
  await wait(450);
  await shot('09-lyra-finisher');
  await holdP;
  await wait(400);
  const fin = await ev(() => ({ dead: window.__game.murder.isDead('lyra'), fin: window.__game.murder.dead.lyra?.finisher ?? null, holder: window.__game.party?.holderId ?? null }));
  check(fin.dead && fin.fin === 'sword', `[${tag}] the held blow, the sword's finisher`, JSON.stringify(fin));
  await ev(() => window.__clean());
  await wait(800);
  const empty = await ev(() => ({ holder: window.__game.party?.holderId ?? null, text: window.__compCard() }));
  check(empty.holder == null && empty.text === '', `[${tag}] the HUD with nobody: the slot is empty`, empty.text.slice(0, 60));
  const spill2 = await hudFits();
  check(spill2.length === 0, `[${tag}] the HUD fits alone`, spill2.slice(0, 4).join(' '));
  await shot('10-hud-alone');

  // ---------- fallen with 999 Resolve: 300 s ----------
  await ev(() => {
    const g = window.__game;
    g.progression.spend('resolve', 999);
    g.stats.refresh(g.player);
    g.settings.deathMode = 'home';
    g.player.fall({ cause: 'test' });
  });
  await wait(2600);
  const fall = await ev(() => {
    const ring = document.querySelector('.sv-ring')?.getBoundingClientRect();
    return { secs: document.querySelector('.sv-secs')?.textContent || '', window: window.__game.survival.falls?.get?.(window.__game.player)?.window ?? null, ring: ring ? { l: ring.left, t: ring.top, r: ring.right, b: ring.bottom } : null, W: innerWidth, H: innerHeight };
  });
  check(fall.window >= 299, `[${tag}] 999 Resolve: a ${fall.window} s window`);
  check(/^29\d|^300/.test(fall.secs), `[${tag}] the countdown reads "${fall.secs}"`);
  check(!!fall.ring && fall.ring.l >= 0 && fall.ring.t >= 0 && fall.ring.r <= fall.W && fall.ring.b <= fall.H, `[${tag}] the ring is on screen`, JSON.stringify(fall.ring));
  await shot('11-fallen-300');

  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

for (const S of SIZES) {
  try {
    await run(S);
  } catch (err) {
    check(false, `[${S.tag}] ran to the end`, String(err?.stack || err).slice(0, 400));
  }
}
await browser.close();
server.close();
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
