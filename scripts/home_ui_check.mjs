// Round 13, workstream C, played the way the author plays: a phone held sideways
// (844×390) and upright (390×844) by touch, and a desktop (1280×720) with mouse and keys.
//   - finding your bed: Menu → Home puts an arrow at the screen's edge, the bed wears its
//     "Your bed" tag inside the Wayhouse, the mark goes once you reach it; Lyra says
//     where it is (offline) and asking her marks the way;
//   - sleep and sit: "Sit" on a chair and a bench (moving stands up), "Sleep until
//     morning" at noon wakes you at 7 the next day healed and saved; a wolf at the door
//     keeps you awake;
//   - the prologue's end: replayed, Lyra's last lines play over the Wayhouse panel, never
//     over black;
//   - the Spellbook preview is the real Weave (a sandbox), and a twist tapped changes it;
//   - the desktop HUD is larger (Interface size), phones keep 1;
//   - desktop: a click on a hotbar slot casts it and selects nothing.
// Screenshots to --out. Exit 1 on a failed check or a page error.
//   node scripts/home_ui_check.mjs [--dist] [--out DIR] [--only land,port,desk]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/home_ui';
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useDist ? 'dist/index.html' : 'index.html'}`;
const browser = await chromium.launch();
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWS = [
  { label: 'land', viewport: { width: 844, height: 390 }, touch: true },
  { label: 'port', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'desk', viewport: { width: 1280, height: 720 }, touch: false },
].filter((v) => !ONLY || ONLY.includes(v.label));
const failures = [];
let checks = 0;
const check = (L, name, ok, detail = '') => {
  checks++;
  if (!ok) failures.push(`[${L}] ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${L}] ${name}${detail ? `  — ${detail}` : ''}`);
};

async function run(v) {
  const L = v.label;
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: 1, isMobile: v.touch, hasTouch: v.touch, ...(v.touch ? { userAgent: UA } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(m.text());
  });
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${L}-${name}.png` });
  const tap = async (sel) => {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    if (v.touch) await el.tap();
    else await el.click();
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // Nobody wanders into the use button's way, no panel or notice in front.
  const clear = () =>
    ev(() => {
      const g = window.__game;
      g.ui.closeAll?.();
      g.ui.toasts?.clear?.();
      for (const e of g.entities.all()) if ((e.profile || e === g.companion) && Math.hypot(e.x - g.player.x, e.y - g.player.y) < 120) e.x += 500;
    });
  const use = async () => {
    await clear();
    if (v.touch) await tap('.tbtn-interact');
    else await page.keyboard.press('KeyE');
    await wait(300);
  };
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await ev(() => {
    try {
      localStorage.clear();
    } catch {
      /* blocked */
    }
  });

  // ---- the prologue's end, replayed: never a caption over black
  await ev(() => {
    window.__game.story.playPrologue({ world: false });
  });
  await page.waitForFunction(() => window.__game.story.isPlaying(), null, { timeout: 15000 });
  const vp = v.viewport;
  for (let n = 0; n < 400; n++) {
    const st = await ev(() => ({ t: window.__game.story.player.textEl?.textContent || '', p: window.__game.story.isPlaying() }));
    if (/^Morning/.test(st.t) || !st.p) break;
    if (v.touch) await page.touchscreen.tap(vp.width / 2, vp.height * 0.7);
    else await page.mouse.click(vp.width / 2, vp.height * 0.7);
    await wait(90);
  }
  await wait(1800);
  const pro = await ev(() => {
    const cp = window.__game.story.player;
    return { text: cp.textEl?.textContent?.slice(0, 30), fade: getComputedStyle(cp.fadeEl).opacity, panel: cp.panel?.id || cp.panel?.def?.id || null };
  });
  check(L, "prologue replay: Lyra's 'Morning' line over the Wayhouse panel, not black", /^Morning/.test(pro.text || '') && Number(pro.fade) < 0.2 && pro.panel === 'wayhouse_morning', JSON.stringify(pro));
  await shot('prologue-end');
  await ev(() => window.__game.story.player.skip?.());
  await page.waitForFunction(() => !window.__game.story.isPlaying(), null, { timeout: 15000 });

  // ---- a journey
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await wait(800);
  await ev(() => {
    const u = window.__game.ui;
    for (const k of Object.keys(u.coach?.done || {})) u.coach.done[k] = true;
    u.coach?.stop?.();
  });

  // ---- the HUD size
  const z = await ev(() => getComputedStyle(document.querySelector('.layer-hud')).zoom);
  if (v.touch) check(L, 'a phone keeps its HUD size', Number(z) === 1, z);
  else {
    check(L, 'the desktop HUD is larger by default', Number(z) >= 1.15, z);
    await ev(() => window.__game.setSetting('uiSize', 'large'));
    await wait(200);
    const zl = await ev(() => getComputedStyle(document.querySelector('.layer-hud')).zoom);
    check(L, 'Interface size: Large is larger still', Number(zl) > Number(z), zl);
    await shot('hud-large');
    await ev(() => window.__game.setSetting('uiSize', 'normal'));
  }

  // ---- finding your bed: from the square
  await ev(() => {
    const g = window.__game;
    const c = g.locations.get('town_square').center;
    g.player.x = c.x;
    g.player.y = c.y;
    g.camera.snap();
  });
  await wait(300);
  await clear();
  if (v.touch) await tap('.hud-menu');
  else await page.keyboard.press('Escape');
  await wait(300);
  await tap('.pause-home');
  await wait(500);
  const far = await ev(() => ({ on: window.__game.ui.homePointer.active, arrow: !document.querySelector('.home-edge')?.hidden }));
  check(L, 'Menu → Home marks the way: an arrow at the edge', far.on && far.arrow, JSON.stringify(far));
  await shot('home-arrow');
  await ev(() => {
    const g = window.__game;
    const b = g.objects.get('home_bed');
    g.player.x = b.x + 48;
    g.player.y = b.y + 60;
    g.camera.snap();
  });
  await wait(400);
  const near = await ev(() => ({ tag: !document.querySelector('.home-tag')?.hidden, text: document.querySelector('.home-tag')?.textContent }));
  check(L, 'inside the Wayhouse the bed wears "Your bed"', near.tag && /Your bed/.test(near.text || ''), JSON.stringify(near));
  await shot('home-tag');
  const said = await ev(async () => {
    const g = window.__game;
    g.ui.homePointer.hide();
    const r = await g.brain.handlePlayerMessage('where is my bed?');
    return { say: r?.say || '', on: g.ui.homePointer.active };
  });
  check(L, 'Lyra says where the bed is, and the way is marked', /Wayhouse|on the left/.test(said.say) && said.on, said.say.slice(0, 80));

  // ---- sit
  await ev(() => {
    const g = window.__game;
    const chair = g.objects.list.find((o) => o.objType === 'chair' && g.locations.at(o.x, o.y)?.id === 'player_home');
    window.__chair = chair;
    g.player.x = chair.x;
    g.player.y = chair.y + 14;
    g.player.faceDir('up');
    g.camera.snap();
  });
  await use();
  const sat = await ev(() => ({ state: window.__game.player.state, seat: window.__game.player.seat?.obj === window.__chair }));
  check(L, '"Sit" on the cottage chair', sat.state === 'sit' && sat.seat, JSON.stringify(sat));
  await shot('sit');
  if (v.touch) {
    await ev(() => window.__game.input.setTouchVector?.(0, 1));
    await wait(400);
    await ev(() => window.__game.input.setTouchVector?.(0, 0));
  } else {
    await page.keyboard.down('KeyS');
    await wait(400);
    await page.keyboard.up('KeyS');
  }
  const up = await ev(() => ({ state: window.__game.player.state, seat: !!window.__game.player.seat }));
  check(L, 'moving stands up', up.state !== 'sit' && !up.seat, JSON.stringify(up));

  // ---- sleep at noon, then a wolf at the door
  await ev(() => {
    const g = window.__game;
    const b = g.objects.get('home_bed');
    g.player.x = b.x + 16;
    g.player.y = b.y - 4;
    g.player.faceDir('left');
    g.player.hp = Math.round(g.player.maxHp / 2);
    g.camera.snap();
  });
  await wait(300);
  const before = await ev(() => ({ day: window.__game.clock.day, label: window.__game.interactions.best(window.__game.player)?.label }));
  check(L, 'the bed says "Sleep until morning" by day', before.label === 'Sleep until morning', before.label);
  await use();
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });
  await wait(2800);
  const after = await ev(() => ({ day: window.__game.clock.day, hour: Math.floor(window.__game.clock.hour), hp: window.__game.player.hp, max: window.__game.player.maxHp }));
  check(L, 'slept: the next morning, healed', after.day === before.day + 1 && after.hour === 7 && after.hp === after.max, JSON.stringify(after));
  await ev(() => window.__game.ui.closeAll?.());
  const wolf = await ev(async () => {
    const g = window.__game;
    const b = g.objects.get('home_bed');
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const w = new proto.constructor(g, 'wolf', { x: b.x + 60, y: b.y + 30 });
    w.controller = null;
    w.speed = 0;
    g.entities.add(w);
    const ok = await g.sleep(b);
    w.removed = true;
    return ok;
  });
  check(L, 'a wolf by the bed: no sleep', wolf === false);

  // ---- the Spellbook preview, a twist tapped
  await ev(() => {
    const g = window.__game;
    g.magic.startTrial();
    g.ui.closeAll?.();
  });
  await clear();
  if (v.touch) await tap('.hud-menu');
  else await page.keyboard.press('Escape');
  await wait(300);
  await tap('.pause-spellbook');
  await wait(800);
  await tap('.sb-sec-twists .sb-tile[title^="Multishot"]');
  await wait(400);
  const sb = await ev(() => ({ sandbox: !!window.__game.ui.hud.spellbook.preview.sg?.magic, tw: window.__game.ui.hud.spellbook.preview.weave?.twists || [] }));
  let most = 0;
  for (let i = 0; i < 30; i++) {
    most = Math.max(most, await ev(() => window.__game.ui.hud.spellbook.preview.sg?.magic.bodies.filter((b) => b.active).length || 0));
    await wait(100);
  }
  check(L, 'the Spellbook preview is the real Weave, and multishot fans three', sb.sandbox && sb.tw.includes('multishot') && most >= 3, `${JSON.stringify(sb)} bodies ${most}`);
  await shot('spellbook-multishot');
  await ev(() => window.__game.ui.closeAll?.());

  // ---- desktop: a click on a hotbar slot casts it, selects nothing
  if (!v.touch) {
    await ev(() => {
      const g = window.__game;
      g.magic.setSlot(1, { shape: 'bolt', essences: ['fire'], twists: [] });
      g.ui.hud.weaving.invalidate();
      g.magic.resetCooldowns?.();
      g.magic.mana.cur = g.magic.mana.max;
      window.__casts = [];
      g.bus.on('spell_cast', (e) => e.caster === g.player && window.__casts.push(e.slot));
    });
    await wait(300);
    const sel0 = await ev(() => window.__game.ui.hud.weaving.selected);
    const b = await page.locator('.hotbar .hslot').nth(1).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await wait(60);
    await page.mouse.up();
    await wait(400);
    const r = await ev(() => ({ casts: window.__casts, sel: window.__game.ui.hud.weaving.selected, focus: document.activeElement?.tagName, raised: document.querySelectorAll('.hotbar .hslot.selected').length }));
    check(L, 'a click on slot 2 casts it at once, nothing selected or focused', r.casts.includes(1) && r.sel === sel0 && r.focus === 'BODY' && r.raised === 0, JSON.stringify(r));
    await shot('click-cast');
  }
  check(L, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

for (const v of VIEWS) {
  try {
    await run(v);
  } catch (err) {
    failures.push(`[${v.label}] crashed: ${err.message}`);
    console.log(`FAIL  [${v.label}] crashed: ${err.message}`);
  }
}
await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} of ${checks} checks failed:\n${failures.join('\n')}` : `\n${checks}/${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
