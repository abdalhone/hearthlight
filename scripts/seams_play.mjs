// Seams play (Version 11, round 13 x 14a): plays the joined parts in the built game on a
// phone sideways (844x390) and upright (390x844) by touch, and on a computer (1280x720) by
// keys and mouse, and asserts what each seam promises:
//   - Brindlecombe: a Strike breaks a rain barrel and a crate in the square (negative tiles);
//   - a Strike on Lyra's locked trunk does nothing to it; the use button offers Force the lock;
//   - a sword and a Strike at a wolf behind a Brindlecombe wall do not hit it;
//   - sleeping at 14:00 wakes you at 7:00 the next day: the calendar turns, an open promise's
//     due time moves with the clock; a free Brindlecombe bed sleeps you too;
//   - down in the wilds (Interface size Large on the computer): the countdown ring is on
//     screen, clear of the HUD; dying leaves the coins in an ember-ring there;
//   - the menu has Map and Home; the map opens (N on a computer); a click on the map at
//     Interface size Large names the mark under the mouse; Home marks the way.
//   node scripts/seams_play.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/seams';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true },
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
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null;
    }, sel);
  const inside = (r) => !!r && r.x >= -0.5 && r.y >= -0.5 && r.r <= S.w + 0.5 && r.b <= S.h + 0.5;
  const overlap = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  const tapAt = async (x, y, ms = 60) => {
    if (S.phone) {
      await touch('touchStart', [{ x, y, id: 9 }]);
      await wait(ms);
      await touch('touchEnd', []);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await wait(ms);
      await page.mouse.up();
    }
  };
  const tapSel = async (sel, ms = 60) => {
    const r = await rectOf(sel);
    if (!r) return false;
    await tapAt(r.x + r.w / 2, r.y + r.h / 2, ms);
    return true;
  };
  const use = async () => {
    if (S.phone) return tapSel('.tbtn-interact');
    await page.keyboard.press('e');
    return true;
  };
  const swing = async () => {
    if (S.phone) await tapSel('.tbtn-attack', 50);
    else await page.keyboard.press('Space');
  };
  // Slot 0 holds a Strike: its button by touch, its key with the mouse on the target.
  const strike = async (at) => {
    if (S.phone) {
      await tapSel('.tcluster .wbtn[data-slot="0"]', 60);
    } else {
      const c = await ev(([x, y]) => window.__toCss(x, y), [at.x, at.y]);
      await page.mouse.move(c.x, c.y);
      await wait(40);
      await page.keyboard.down('Digit1');
      await wait(60);
      await page.keyboard.up('Digit1');
    }
    await wait(900);
  };
  const clean = () => ev(() => window.__clean());
  const place = (tx, ty, face) => ev(([tx, ty, face]) => window.__place(tx, ty, face), [tx, ty, face]);

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
    g.clock.skipTo?.(11);
    const m = g.magic;
    for (const id of ['strike', 'bolt']) m.unlock('shape', id, 'test');
    m.unlock('essence', 'earth', 'test');
    while (m.slotCount < 2) m.unlockSlot();
    m.setSlot(0, { shape: 'strike', essences: ['earth'], twists: [] });
    m.mana.max = Math.max(m.mana.max, 300);
    m.mana.cur = m.mana.max;
    const u = g.ui;
    for (const id of ['cast', 'book', 'found']) if (u?.coach?.done) u.coach.done[id] = true;
    u?.coach?.stop?.();
    window.__toCss = (x, y) => {
      const r = g.renderer;
      return { x: ((x - r.viewX) * r.scale) / r.dpr, y: ((y - r.viewY) * r.scale) / r.dpr };
    };
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__place = (tx, ty, face) => {
      const p = g.player;
      p.x = tx * 16 + 8;
      p.y = ty * 16 + 10;
      if (p.vel) p.vel.x = p.vel.y = 0;
      if (face) p.faceDir(face);
      const l = g.companion;
      if (l) {
        l.x = p.x - 70;
        l.y = p.y + 40;
        l.behavior?.setDirective?.({ type: 'stay', x: l.x, y: l.y });
      }
      g.camera.follow?.(p);
      g.camera.snap?.();
    };
    // Nobody comes running in these tests (a fight near the vale would bring the watch).
    g._alert = g.survival.alert.bind(g.survival);
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__clean();
  });

  // ---------- Brindlecombe: a Strike breaks a rain barrel and a crate ----------
  for (const [id, tx, ty] of [
    ['barrel@-312,43', -312, 43],
    ['crate@-301,43', -301, 43],
  ]) {
    await place(tx, ty + 2, 'up');
    await clean();
    await wait(300);
    const at = await ev((id) => {
      const o = window.__game.objects.get(id);
      return { x: o.x, y: o.y - 6 };
    }, id);
    if (id.startsWith('barrel')) await shot('1-brindle-barrel-before');
    for (let i = 0; i < 2; i++) {
      const done = await ev((id) => !!window.__game.objects.get(id).state.broken, id);
      if (done) break;
      await ev(() => (window.__game.magic.mana.cur = window.__game.magic.mana.max));
      await strike(at);
      await wait(700);
    }
    const st = await ev((id) => ({ broken: !!window.__game.objects.get(id).state.broken, ty: window.__game.objects.get(id).ty }), id);
    await shot(`1-brindle-${id.split('@')[0]}-struck`);
    check(st.broken, `[${tag}] a Strike breaks the ${id.split('@')[0]} in Brindlecombe (${id})`);
  }

  // ---------- Lyra's locked trunk: a Strike does nothing; the use button offers to force it ----------
  await place(75, 46, 'up');
  await clean();
  await wait(300);
  const trunkAt = await ev(() => {
    const o = window.__game.objects.get('lyra_trunk');
    return { x: o.x, y: o.y - 6, items: JSON.stringify(o.inventory.serialize()) };
  });
  await strike(trunkAt);
  await wait(400);
  const trunk = await ev(() => {
    const o = window.__game.objects.get('lyra_trunk');
    return { locked: !!o.state.locked, broken: !!o.state.broken, forced: !!o.state.forced, items: JSON.stringify(o.inventory.serialize()) };
  });
  await shot('2-trunk-struck');
  check(trunk.locked && !trunk.broken && !trunk.forced && trunk.items === trunkAt.items, `[${tag}] a Strike on Lyra's locked trunk: still locked, whole, its contents as they were`);
  await place(75, 45, 'up');
  await clean();
  await wait(400);
  const label = await ev(() => window.__game.ui.lastPrompt || '');
  await use();
  await wait(600);
  const dlg = await ev(() => {
    const p = [...document.querySelectorAll('.modal-layer > .panel')].pop();
    return p ? p.textContent : '';
  });
  await shot('2-trunk-force');
  check(/locked/i.test(label) && /Force the lock/.test(dlg), `[${tag}] the use button names it locked and offers Force the lock`, `prompt "${label}"`);
  const leave = await page.getByRole('button', { name: 'Leave it' }).boundingBox();
  if (leave) await tapAt(leave.x + leave.width / 2, leave.y + leave.height / 2);
  await wait(400);
  check(await ev(() => !!window.__game.objects.get('lyra_trunk').state.locked), `[${tag}] Leave it: still locked`);

  // ---------- a swing and a Strike at a wolf behind a Brindlecombe wall ----------
  const wall = await ev(() => {
    const g = window.__game;
    const b = g.map.buildings.find((x) => x.id === 'brindle_coll_house');
    const it = b.interior;
    window.__place(b.x - 1, it.y + 2, 'right');
    // Hug the wall outside, the wolf hugging it inside: well within a sword's reach.
    const p = g.player;
    p.x = b.x * 16 - 5;
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    if (!proto) return null;
    const w = new proto.constructor(g, 'wolf', { x: (b.x + 1) * 16 + 5, y: p.y });
    w.controller = null;
    w.speed = 0;
    w.aggroRadius = 0;
    w.maxHp = w.hp = 80;
    g.entities.add(w);
    g.camera.snap?.();
    window.__wolf = w;
    return { hp: w.hp, x: w.x, y: w.y };
  });
  check(!!wall, `[${tag}] a wolf stands inside the Coll house`);
  if (wall) {
    await clean();
    for (let i = 0; i < 3; i++) {
      await swing();
      await wait(450);
    }
    await ev(() => (window.__game.magic.mana.cur = window.__game.magic.mana.max));
    await strike(wall);
    await wait(500);
    await shot('3-wall-swing');
    const hp = await ev(() => window.__wolf.hp);
    check(hp === wall.hp, `[${tag}] no blow lands through the Brindlecombe wall (${hp}/${wall.hp})`);
    await ev(() => {
      window.__wolf.hp = 0;
      window.__game.entities.remove?.(window.__wolf);
      window.__wolf.removed = true;
    });
  }

  // ---------- sleep at 14:00: the day turns, the calendar too, a promise moves with the clock ----------
  await ev(() => {
    const g = window.__game;
    g.clock.t = (g.clock.day - 1) * 900 + (14 / 24) * 900;
  });
  await wait(1500); // the promise keeper sees the clock settle at 14:00 before the promise is made
  const before = await ev(() => {
    const g = window.__game;
    const t0 = g.clock.t;
    const day = g.clock.day;
    const c = g.village.commitments.add({ by: 'elda', kind: 'tell', to: 'lyra', message: 'I am sorry', state: 'open', made: g.clock.t, day, due: g.clock.t + 1.5 * 900, retryAt: g.clock.t + 99999 });
    window.__c = c;
    const bed = g.objects.get('home_bed');
    window.__place(Math.floor(bed.x / 16) + 1, Math.floor((bed.y - 4) / 16), 'left');
    return { day, hour: g.clock.hour, due: c.due, calDay: g.calendar?.day?.(), t: g.clock.t, t0 };
  });
  await clean();
  await wait(500);
  const sleepLabel = await ev(() => window.__game.ui.lastPrompt || '');
  await shot('4-bed-1400');
  await use();
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.clock.hour >= 7 && window.__game.clock.hour < 8, null, { timeout: 20000 }).catch(() => {});
  await wait(2600);
  const after = await ev(() => {
    const g = window.__game;
    return { day: g.clock.day, hour: g.clock.hour, calDay: g.calendar?.day?.(), due: window.__c.due, state: window.__c.state, t: g.clock.t };
  });
  await shot('4-woke');
  check(/Sleep until morning/.test(sleepLabel), `[${tag}] at 14:00 the bed offers sleep until morning`, sleepLabel);
  check(after.day === before.day + 1 && Math.floor(after.hour) === 7, `[${tag}] woke at 7 the next day (day ${before.day} -> ${after.day}, ${after.hour.toFixed(2)} h)`);
  check(after.calDay === after.day, `[${tag}] the calendar turned with it (calendar day ${after.calDay})`);
  const skipped = after.t - before.t;
  check(after.state === 'open' && Math.abs(after.due - (before.due + skipped)) < 30, `[${tag}] the open promise's due time moved with the clock (+${Math.round(after.due - before.due)} s for ${Math.round(skipped)} s slept)`);

  // ---------- down in the wilds at Interface size Large (computer) ----------
  if (!S.phone) await ev(() => window.__game.setSetting('uiSize', 'large'));
  await wait(300);
  const uiz = await ev(() => getComputedStyle(document.querySelector('.ui-zoomed') || document.body).getPropertyValue('--uiz') || '1');
  await ev(() => {
    const g = window.__game;
    const camp = g.locations.get('treeline_camp').center;
    g.clock.skipTo(15);
    window.__place(Math.floor(camp.x / 16) + 3, Math.floor(camp.y / 16) + 3, 'down');
    const have = g.player.inventory.count('coin');
    if (have < 31) g.player.inventory.add('coin', 31 - have);
    g.settings.deathMode = 'home';
    g.player.invuln = 0;
    g.player.fall({ cause: 'test' });
  });
  await clean();
  await wait(2600);
  const ring = await rectOf('.sv-ring');
  const block = await rectOf('.sv-fallen');
  const secs = await ev(() => document.querySelector('.sv-secs')?.textContent || '');
  const hud = S.phone ? await rectOf('.stick-zone .stick') : await rectOf('.hotbar');
  const cards = await rectOf('.hud-cards, .hud-left, .hud-top-left');
  await shot('5-down-wilds');
  check(!!ring && inside(block), `[${tag}] the countdown is on screen in the wilds (zoom ${String(uiz).trim() || 1})`, secs);
  check(/\d+ seconds? to live/.test(secs), `[${tag}] the seconds are readable`, secs);
  const call = await rectOf('.sv-call');
  check(!overlap(ring, hud) && !overlap(call, hud), `[${tag}] the ring and Call for help are clear of the ${S.phone ? 'stick' : 'hotbar'}`);
  check(!overlap(block, cards), `[${tag}] the countdown is clear of the HUD cards`);
  await ev(() => (window.__game.survival.fallOf(window.__game.player).left = 0.5));
  await page.waitForFunction(() => window.__game.state === 'playing' && !window.__game.player.downed && !window.__game.survival.isFallen(window.__game.player), null, { timeout: 30000 }).catch(() => {});
  await wait(2500);
  const died = await ev(() => {
    const g = window.__game;
    const r = g.survival.ring;
    return { coins: r?.coins ?? 0, y: r?.y ?? 0, where: r?.where || '' };
  });
  await clean();
  await wait(400);
  const edge = await rectOf('.er-edge-tip');
  await shot('6-woke-ring-arrow');
  check(died.coins >= 31 && died.y < 0, `[${tag}] the coins wait in an ember-ring up in the wilds (${died.coins}, ${died.where})`);
  check(inside(edge), `[${tag}] the ember arrow is on screen at this size`);
  const edgeLabel = await rectOf('.er-edge-label');
  const hudBoxes = await Promise.all(['.hud-center .quest-line', '.hud-cards', '.hud-right'].map((q) => rectOf(q)));
  const hit = hudBoxes.findIndex((b) => overlap(b, edge) || overlap(b, edgeLabel));
  check(hit < 0, `[${tag}] the ember arrow and its words keep clear of the HUD (mission line, cards)`, hit >= 0 ? ['mission line', 'cards', 'right corner'][hit] : '');

  // ---------- the menu: Map and Home ----------
  if (S.phone) await tapSel('.hud-menu');
  else await page.keyboard.press('Escape');
  await wait(500);
  const items = await ev(() => [...document.querySelectorAll('.panel-pause [data-item]')].map((b) => b.dataset.item));
  const mapIco = await ev(() => {
    const b = document.querySelector('.panel-pause [data-item="map"]');
    const i = b?.querySelector('.menu-ico');
    return !!i && (i.tagName === 'IMG' ? !!i.getAttribute('src') : !!(i.style.backgroundImage || i.getAttribute('src') || i.innerHTML));
  });
  await shot('7-menu');
  check(items.includes('map') && items.includes('home'), `[${tag}] the menu has Map and Home`, items.join(' '));
  check(mapIco, `[${tag}] the Map item has its icon`);
  await tapSel('.panel-pause [data-item="map"]');
  await wait(800);
  const map = await rectOf('.panel-map');
  const canvas = await rectOf('.panel-map .map-canvas');
  await shot('8-map');
  check(inside(map), `[${tag}] the map panel fits the screen`, JSON.stringify(map && { w: Math.round(map.w), h: Math.round(map.h) }));
  // A click on the chart names the mark under it (the "You" mark at the centre after Me).
  const tapped = await ev(() => {
    const wm = window.__game.ui.worldMap;
    wm.center();
    wm.draw();
    const you = (wm._drawn || []).find((m) => m.kind === 'you');
    const r = wm.canvas.getBoundingClientRect();
    const k = r.width / wm.canvas.clientWidth;
    return you ? { x: r.left + you.sx * k, y: r.top + you.sy * k, k } : null;
  });
  if (tapped) {
    await tapAt(tapped.x, tapped.y);
    await wait(300);
  }
  const cap = await ev(() => document.querySelector('.panel-map .map-caption')?.textContent || '');
  await shot('8-map-tap');
  check(/You/.test(cap), `[${tag}] a ${S.phone ? 'tap' : 'click'} on the map names the mark under it (zoom ${tapped?.k?.toFixed(2)})`, cap);
  if (!S.phone) {
    // Drag the chart: it follows the mouse one for one.
    const d0 = await ev(() => ({ cx: window.__game.ui.worldMap.cx }));
    const c = canvas;
    await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.w / 2 + 120, c.y + c.h / 2, { steps: 6 });
    await page.mouse.up();
    const d1 = await ev(() => {
      const wm = window.__game.ui.worldMap;
      const s = wm.scale(wm.canvas.clientWidth, wm.canvas.clientHeight);
      const k = wm.canvas.getBoundingClientRect().width / wm.canvas.clientWidth;
      return { cx: wm.cx, s, k };
    });
    const moved = (d0.cx - d1.cx) * d1.s * d1.k; // screen px the chart moved (dragged east: the view goes west)
    check(Math.abs(moved - 120) < 12, `[${tag}] dragging the map moves it with the mouse (${moved.toFixed(0)} px for 120, zoom ${d1.k.toFixed(2)})`);
    await page.keyboard.press('Escape');
    await wait(300);
    await page.keyboard.press('Escape');
    await wait(300);
    await clean();
    await page.keyboard.press('n');
    await wait(600);
    check(await ev(() => !!window.__game.ui.worldMap?.isOpen?.()), `[${tag}] N opens the map`);
    await shot('8-map-n');
    await page.keyboard.press('n');
    await wait(300);
  }
  await clean();
  await wait(300);
  // From the square, so there is a way to mark.
  await ev(() => {
    const sq = window.__game.locations.get('town_square').center;
    window.__place(Math.floor(sq.x / 16), Math.floor(sq.y / 16), 'down');
  });
  await clean();
  await wait(300);
  if (S.phone) await tapSel('.hud-menu');
  else await page.keyboard.press('Escape');
  await wait(500);
  await tapSel('.panel-pause [data-item="home"]');
  await wait(800);
  const homeOn = await ev(() => !!window.__game.ui.homePointer?.active);
  const homeEdge = await rectOf('.home-edge-tip');
  const homeTag = await rectOf('.home-tag > span');
  await shot('9-home');
  check(homeOn && (inside(homeEdge) || inside(homeTag)), `[${tag}] Home marks the way to your bed`);
  const agree = await ev(() => {
    const g = window.__game;
    const wm = g.ui.worldMap || null;
    const mk = wm ? wm.marks().find((m) => m.kind === 'home') : null;
    const bed = g.objects.get('home_bed');
    return !!mk && mk.x === bed.x && mk.y === bed.y;
  });
  check(agree, `[${tag}] the map's home mark is the bed the Home pointer leads to`);

  // ---------- a free Brindlecombe bed ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo(15);
    const b = g.objects.get('bed_brindle_coll_house');
    window.__place(Math.floor(b.x / 16) + 1, Math.floor((b.y - 4) / 16), 'left');
    window.__b = { day: g.clock.day };
  });
  await clean();
  await wait(500);
  const bLabel = await ev(() => window.__game.ui.lastPrompt || '');
  await shot('10-brindle-bed');
  await use();
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.clock.day > window.__b.day, null, { timeout: 20000 }).catch(() => {});
  await wait(2200);
  const bSlept = await ev(() => ({ day: window.__game.clock.day, hour: window.__game.clock.hour, home: window.__game.objects.get('home_bed').name }));
  await shot('10-brindle-woke');
  check(/Sleep until morning/.test(bLabel) && bSlept.day > 0 && Math.floor(bSlept.hour) === 7, `[${tag}] an empty Brindlecombe bed sleeps you to morning`, bLabel);

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
