// Browser check of one clean menu (DESIGN.md §24) in headless Chromium, on a phone held
// sideways (844×390), upright (390×844) and a desktop (1280×800):
//   - the title menu: Continue, New game, Prologue, Book, Past lives, Settings, How to play,
//     each once, all on screen;
//   - Settings: every setting key exactly once in the page, five tabs that fit without
//     sideways scrolling, every pane without sideways overflow;
//   - the in-game menu: Resume, the places (Spellbook, Bag, Missions, Lyra, Character,
//     Village, Home, Book + Prologue), Settings, Save, Quit; its items unique, none of them a
//     second copy of a button the HUD shows (Talk, Menu), all on screen without scrolling;
//     a ✕ closes it as it closes every panel (the phone pass); each place opens on top of
//     the menu and Esc (or a tap on ‹ Menu) comes back to it; touch taps; arrow keys walk the
//     grid by where the buttons are; Enter on Resume resumes and does nothing else;
//   - How to play reachable in game (Settings → Controls);
//   - Settings → Game → Practice: "Reset stat points", "Free stat points" and "Try all
//     magic" — greyed on the title (the note says why), in game each asks first (the
//     in-game confirm) and does what it says: the points come back; free points raise a
//     stat past what the levels gave on the Character sheet (+, +10, −) and turning it off
//     puts the real points back; the trial turns on ("On"), then off again.
// Screenshots of every screen go to --out. Fails on page errors or a failed check.
//   node scripts/menu_check.mjs [--dist] [--out DIR] [--only land,port,desk]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'screenshots';
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const base = `http://localhost:${server.address().port}`;
const url = `${base}/${useDist ? 'dist/index.html' : 'index.html'}`;
const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const VIEWS = [
  { label: 'land', viewport: { width: 844, height: 390 }, touch: true },
  { label: 'port', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'desk', viewport: { width: 1280, height: 800 }, touch: false },
];

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${label}] console.error: ${t}`);
  });
}

const wait = (page, ms) => page.waitForTimeout(ms);

// Everything the browser can measure about the open panels: sideways overflow of the
// page and of each scroller, and whether the top panel needs scrolling.
async function measure(page) {
  return page.evaluate(() => {
    const top = window.__game.ui.top();
    const el = top?.el;
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const wide = [];
    if (el) {
      for (const n of el.querySelectorAll('*')) {
        if (n.offsetParent === null) continue;
        const cs = getComputedStyle(n);
        if (!/(auto|scroll)/.test(cs.overflowX) && !n.classList.contains('tabs')) continue;
        if (n.scrollWidth > n.clientWidth + 1) wide.push(`${n.className} ${n.scrollWidth}>${n.clientWidth}`);
      }
    }
    const r = el?.getBoundingClientRect();
    const body = el?.querySelector('.panel-body');
    return {
      id: top?.id || null,
      over,
      wide,
      onScreen: !r || (r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1),
      scrolls: body ? body.scrollHeight - body.clientHeight : 0,
    };
  });
}

async function shot(page, v, name) {
  await wait(page, 220);
  await page.screenshot({ path: `${OUT}/menu-${v.label}-${name}.png` });
}

async function tap(page, v, selector) {
  const el = page.locator(selector).first();
  if (v.touch) await el.tap();
  else await el.click();
}

async function title(page, v) {
  const L = v.label;
  const t = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.title-menu button')].filter((b) => !b.hidden && b.offsetParent);
    const off = vis.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth;
    });
    return { labels: vis.map((b) => b.querySelector('.btn-label')?.textContent.trim()), off: off.length };
  });
  return t;
}

async function settings(page, v, where) {
  const L = v.label;
  await page.evaluate(() => window.__game.ui.openSettings());
  await wait(page, 200);
  const counts = await page.evaluate(async () => {
    const { DEFAULT_SETTINGS } = await import('/src/core/settings.js').catch(() => ({ DEFAULT_SETTINGS: null }));
    const { EXTRA_SETTING_KEYS } = await import('/src/ui/settings_panel.js').catch(() => ({ EXTRA_SETTING_KEYS: [] }));
    const keys = DEFAULT_SETTINGS ? [...Object.keys(DEFAULT_SETTINGS), ...EXTRA_SETTING_KEYS] : [];
    const panel = window.__game.ui.top().el;
    const bad = [];
    for (const k of keys) {
      const n = panel.querySelectorAll(`[data-setting="${k}"]`).length;
      if (n !== 1) bad.push(`${k}×${n}`);
    }
    const all = [...panel.querySelectorAll('[data-setting]')].map((e) => e.dataset.setting);
    return { n: keys.length, bad, extra: all.filter((k) => !keys.includes(k)), tabs: [...panel.querySelectorAll('.settings-tabs [role=tab]')].map((b) => b.dataset.tab) };
  });
  if (counts.n) check(`[${L}] ${where} Settings: every setting key exactly once (${counts.n} keys)`, !counts.bad.length && !counts.extra.length, [...counts.bad, ...counts.extra].join(' '));
  check(`[${L}] ${where} Settings: five tabs`, counts.tabs.join() === 'game,controls,sound,minds,display', counts.tabs.join());
  const strip = await page.evaluate(() => {
    const t = document.querySelector('.settings-tabs');
    const r = [...t.children].map((b) => b.getBoundingClientRect());
    const box = t.getBoundingClientRect();
    return { scroll: t.scrollWidth - t.clientWidth, outside: r.filter((b) => b.right > box.right + 1 || b.left < box.left - 1).length, small: r.filter((b) => b.height < 30).length };
  });
  check(`[${L}] ${where} Settings: the tabs fit without sideways scrolling`, strip.scroll <= 1 && !strip.outside && !strip.small, JSON.stringify(strip));
  for (const tab of counts.tabs) {
    await tap(page, v, `.settings-tabs [data-tab="${tab}"]`);
    await wait(page, 120);
    const m = await measure(page);
    const shown = await page.evaluate((id) => !document.querySelector(`#set-pane-${id}`).hidden, tab);
    check(`[${L}] ${where} Settings → ${tab}: shown, no sideways overflow`, shown && m.over <= 0 && !m.wide.length && m.onScreen, `${m.wide.join('; ')} over ${m.over}`);
    await shot(page, v, `${where}-settings-${tab}`);
  }
  // Keyboard: arrows walk the tabs.
  if (!v.touch) {
    await page.focus('.settings-tabs [data-tab="game"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const on = await page.evaluate(() => document.querySelector('.settings-tabs [aria-selected=true]')?.dataset.tab);
    check(`[${L}] ${where} Settings: arrow keys walk the tabs`, on === 'sound', on);
  }
}

// Settings → Game → Practice (the Settings panel is open).
async function practice(page, v, where) {
  const L = v.label;
  await tap(page, v, '.settings-tabs [data-tab="game"]');
  await wait(page, 150);
  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#set-pane-game .set-row[data-action]')].map((r) => ({
        id: r.dataset.action,
        label: r.querySelector('.set-label').textContent,
        note: r.querySelector('.set-note').textContent,
        disabled: r.querySelector('button').disabled,
        h: r.querySelector('button').getBoundingClientRect().height,
      })),
    );
  let r = await rows();
  check(`[${L}] ${where} Settings → Game → Practice: Reset stat points, Free stat points and Try all magic`, r.map((x) => x.id).join() === 'resetPoints,freePoints,trialMagic', JSON.stringify(r.map((x) => x.id)));
  if (where === 'title') {
    check(`[${L}] title Practice rows: greyed, and the note says why`, r.every((x) => x.disabled && /journey/.test(x.note)), JSON.stringify(r.map((x) => [x.disabled, x.note])));
    await page.evaluate(() => document.querySelector('#set-pane-game .set-group-practice')?.scrollIntoView({ block: 'center' }));
    await shot(page, v, 'title-settings-practice');
    return;
  }
  if (v.touch) check(`[${L}] Practice buttons easy to hit with a thumb (≥ 40 px tall)`, r.every((x) => x.h >= 40), JSON.stringify(r.map((x) => x.h)));
  const reset0 = r.find((x) => x.id === 'resetPoints');
  check(`[${L}] Reset stat points: greyed with nothing spent, and says so`, reset0.disabled && /not spent/.test(reset0.note), JSON.stringify(reset0));
  // Spend three points, then reset them through the confirm.
  await page.evaluate(() => {
    const g = window.__game;
    g.player.level = Math.max(2, g.player.level || 1);
    g.progression.spend('might', 1);
    g.progression.spend('weave', 2);
    g.ui.settings.refreshActions();
  });
  r = await rows();
  check(`[${L}] Reset stat points: ready once points are spent`, !r[0].disabled && /3/.test(await page.evaluate(() => document.querySelector('[data-action="resetPoints"] button').textContent)), JSON.stringify(r[0]));
  await tap(page, v, '[data-action="resetPoints"] button');
  await wait(page, 250);
  const ask = await page.evaluate(() => ({ stack: window.__game.ui.stack.map((p) => p.id).join(), text: document.querySelector('.panel-confirm .confirm-text')?.textContent || '' }));
  check(`[${L}] Reset stat points asks first`, /confirm$/.test(ask.stack) && /All 3 points/.test(ask.text), JSON.stringify(ask));
  await shot(page, v, 'practice-reset-confirm');
  await tap(page, v, '.panel-confirm .panel-foot button:last-child');
  await wait(page, 250);
  const after = await page.evaluate(() => ({ spent: window.__game.progression.spent(), unspent: window.__game.progression.unspent(), stack: window.__game.ui.stack.map((p) => p.id).join() }));
  check(`[${L}] Reset stat points: every point back to spend, Settings still open`, after.spent === 0 && after.unspent >= 3 && /settings$/.test(after.stack), JSON.stringify(after));
  // Try all magic: on, through the confirm; then off again.
  await tap(page, v, '[data-action="trialMagic"] button');
  await wait(page, 250);
  const ask2 = await page.evaluate(() => document.querySelector('.panel-confirm .confirm-text')?.textContent || '');
  check(`[${L}] Try all magic asks first and warns about prices`, /Berserk/.test(ask2), ask2.slice(0, 80));
  await shot(page, v, 'practice-trial-confirm');
  await tap(page, v, '.panel-confirm .panel-foot button:last-child');
  await wait(page, 250);
  const on = await page.evaluate(() => ({ trial: !!window.__game.magic.trial, label: document.querySelector('[data-action="trialMagic"] .set-label').textContent, slots: window.__game.magic.slotCount }));
  check(`[${L}] Try all magic: On (six slots, everything open)`, on.trial && /On$/.test(on.label) && on.slots === 6, JSON.stringify(on));
  await page.evaluate(() => document.querySelector('#set-pane-game .set-group-practice')?.scrollIntoView({ block: 'center' }));
  await shot(page, v, 'practice-trial-on');
  await tap(page, v, '[data-action="trialMagic"] button');
  await wait(page, 250);
  await tap(page, v, '.panel-confirm .panel-foot button:last-child');
  await wait(page, 250);
  const off = await page.evaluate(() => ({ trial: !!window.__game.magic.trial, label: document.querySelector('[data-action="trialMagic"] .set-label').textContent, slots: window.__game.magic.slotCount, w0: window.__game.magic.slots[0]?.shape }));
  check(`[${L}] Try all magic: Off again, the real weaves back`, !off.trial && /Off$/.test(off.label) && off.slots === 4 && off.w0 === 'bolt', JSON.stringify(off));
  // Free stat points (r13): on through the confirm, raise a stat far past the levels on
  // the Character sheet, then off: the real points come back.
  await page.evaluate(() => {
    window.__game.progression.spend('might', 1);
    window.__game.ui.settings.refreshActions();
  });
  await tap(page, v, '[data-action="freePoints"] button');
  await wait(page, 250);
  const ask3 = await page.evaluate(() => document.querySelector('.panel-confirm .confirm-text')?.textContent || '');
  check(`[${L}] Free stat points asks first and says off puts the real points back`, /really spent/.test(ask3), ask3.slice(0, 90));
  await tap(page, v, '.panel-confirm .panel-foot button:last-child');
  await wait(page, 250);
  const fon = await page.evaluate(() => ({ free: window.__game.progression.free, label: document.querySelector('[data-action="freePoints"] .set-label').textContent }));
  check(`[${L}] Free stat points: On`, fon.free && /On$/.test(fon.label), JSON.stringify(fon));
  await page.evaluate(() => window.__game.ui.openCharacter());
  await wait(page, 300);
  const ten = '.chs-attr:nth-child(1) .chs-ten';
  for (let i = 0; i < 3; i++) await tap(page, v, ten);
  await tap(page, v, '.chs-attr:nth-child(1) .chs-plus:not(.chs-minus):not(.chs-ten)');
  await tap(page, v, '.chs-attr:nth-child(1) .chs-minus');
  await wait(page, 150);
  const sheet = await page.evaluate(() => ({ vit: window.__game.progression.points.vitality, shown: document.querySelector('.chs-attr:nth-child(1) .chs-attr-n')?.textContent, badge: document.querySelector('.chs-points')?.textContent, hp: window.__game.player.maxHp }));
  check(`[${L}] Free stat points: the sheet raises Vitality to 30 (+10 ×3, +, −)`, sheet.vit === 30 && sheet.shown === '30' && /Free points/.test(sheet.badge), JSON.stringify(sheet));
  await shot(page, v, 'practice-free-sheet');
  await page.evaluate(() => window.__game.ui.closeModal(window.__game.ui.top(), true));
  await wait(page, 200);
  if (!(await page.evaluate(() => !!document.querySelector('[data-action="freePoints"] button')))) await page.evaluate(() => window.__game.ui.openSettings('game'));
  await wait(page, 200);
  await tap(page, v, '[data-action="freePoints"] button');
  await wait(page, 250);
  await tap(page, v, '.panel-confirm .panel-foot button:last-child');
  await wait(page, 250);
  const foff = await page.evaluate(() => ({ free: window.__game.progression.free, pts: { ...window.__game.progression.points }, label: document.querySelector('[data-action="freePoints"] .set-label')?.textContent }));
  check(`[${L}] Free stat points: Off, the point really spent is back (Might 1, nothing else)`, !foff.free && foff.pts.might === 1 && foff.pts.vitality === 0 && /Off$/.test(foff.label || ''), JSON.stringify(foff));
}

async function run(v) {
  const L = v.label;
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: 1, hasTouch: v.touch, isMobile: v.touch });
  const page = await ctx.newPage();
  watch(page, L);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* blocked */
    }
  });
  if (v.touch) await page.evaluate(() => window.__game.ui.setTouch(true));
  await wait(page, 500);

  // ---------- the title ----------
  let t = await title(page, v);
  check(`[${L}] title: New game, Prologue, Book, Settings, How to play — each once, on screen`, t.labels.join('|') === 'New game|Prologue|The Book of Halcyre|Settings|How to play' && !t.off, `${t.labels.join('|')} off ${t.off}`);
  await shot(page, v, 'title');
  await settings(page, v, 'title');
  await practice(page, v, 'title');
  await page.evaluate(() => window.__game.ui.closeAll());
  await page.evaluate(() => window.__game.ui.title.openHowTo());
  await wait(page, 200);
  const how = await page.evaluate(() => {
    const p = window.__game.ui.top();
    return { id: p?.id, devices: [...p.el.querySelectorAll('.how-devices .seg')].map((b) => b.dataset.device), on: p.el.querySelector('.how-devices [aria-checked=true]')?.dataset.device, rows: p.el.querySelectorAll('.how-controls .how-row').length, foot: p.foot.children.length };
  });
  check(`[${L}] How to play: the controls for the device in hand, switchable`, how.id === 'howto' && how.devices.join() === 'touch,keys,pad' && how.on === (v.touch ? 'touch' : 'keys') && how.rows >= 9 && how.foot === 0, JSON.stringify(how));
  await shot(page, v, 'howto');
  await tap(page, v, '.how-devices [data-device="pad"]');
  const padRows = await page.evaluate(() => [...document.querySelectorAll('.how-controls dt')].map((d) => d.textContent));
  check(`[${L}] How to play: the gamepad list`, padRows.includes('Sword') && !padRows.includes('Listen in'), padRows.join(', '));
  await page.keyboard.press('Escape');
  await wait(page, 200);
  check(`[${L}] title: Esc closes How to play`, await page.evaluate(() => window.__game.ui.stack.length === 0));

  // ---------- the game ----------
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await wait(page, 600);
  await page.evaluate(async (stubUrl) => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    if (!g.magic) {
      const { makeMagicStub } = await import(stubUrl);
      g.magic = makeMagicStub(g);
    } else {
      const m = g.magic;
      for (const [k, ids] of Object.entries({ shape: ['bolt', 'throw', 'nova'], essence: ['fire', 'frost'], twist: ['multishot'] })) for (const id of ids) m.unlock(k, id, 'test');
      [{ shape: 'bolt', essences: ['fire'], twists: ['multishot'] }, { shape: 'throw', essences: ['frost'], twists: [] }, { shape: 'nova', essences: [], twists: [] }].forEach((w, i) => m.setSlot(i, w));
    }
    g.ui.hud.weaving.invalidate?.();
  }, `${base}/tests/helpers/magic_stub.mjs`);
  await wait(page, 1500);
  await page.evaluate(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.ui.closeAll();
    g.ui.toasts?.clear?.();
  });
  await wait(page, 400);

  // Open the menu the way a player does: the pause button (touch) or Esc.
  if (v.touch) await tap(page, v, '.hud-menu');
  else await page.keyboard.press('Escape');
  await wait(page, 250);
  const menu = await page.evaluate(() => {
    const p = window.__game.ui.top();
    const items = [...p.el.querySelectorAll('.pause-menu [data-item]')];
    const hud = [...document.querySelectorAll('.hud-buttons .hud-btn')].filter((b) => b.offsetParent).map((b) => (b.title || '').split(' (')[0]);
    const x = p.el.querySelector('.panel-close');
    const xr = x?.getBoundingClientRect();
    return { id: p?.id, paused: window.__game.paused, items: items.map((b) => b.dataset.item), labels: items.map((b) => b.querySelector('.menu-label').textContent), close: x && getComputedStyle(x).display !== 'none' && xr.width >= 40 && xr.height >= 40, hud };
  });
  check(`[${L}] menu: opens and pauses`, menu.id === 'pause' && menu.paused, JSON.stringify(menu.id));
  const want = ['resume', 'spellbook', 'inventory', 'missions', 'lyra', 'character', 'village', 'home', 'book', 'prologue', 'settings', 'save', 'quit'];
  check(`[${L}] menu: Resume, Spellbook, Bag, Missions, Lyra, Character, Village, Home, Book (+ Prologue), Settings, Save, Quit`, menu.items.join() === want.join(), menu.items.join());
  check(`[${L}] menu: every item once`, new Set(menu.items).size === menu.items.length && new Set(menu.labels).size === menu.labels.length, menu.labels.join('|'));
  // The Bag's home is the menu now (the HUD keeps only what play needs every second);
  // nothing in it may repeat a button the HUD shows, and the chat lives on the HUD.
  const hudNames = menu.hud.map((s) => s.toLowerCase());
  check(`[${L}] menu: nothing the HUD already shows (${menu.hud.join(', ')})`, !menu.items.some((i) => /chat|talk/.test(i)) && !menu.labels.some((l) => hudNames.includes(l.toLowerCase()) || /^(Talk|Chat)$/.test(l)), menu.labels.join('|'));
  check(`[${L}] menu: a ✕ closes it, like every panel`, menu.close);
  let m = await measure(page);
  check(`[${L}] menu: fits the screen without scrolling`, m.onScreen && m.scrolls <= 1 && m.over <= 0 && !m.wide.length, JSON.stringify(m));
  const small = await page.evaluate(() => [...document.querySelectorAll('.pause-menu button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 41.5).map((b) => b.dataset.item));
  check(`[${L}] menu: every button easy to hit (≥ 42 px tall)`, !small.length, small.join());
  await shot(page, v, 'menu');

  // Each place opens on top of the menu; Esc (or ‹ Menu on touch) comes back to it. Its ✕
  // goes back to play (scripts/phone_check.mjs checks that on every phone size).
  for (const id of ['spellbook', 'inventory', 'missions', 'lyra', 'character', 'village', 'book', 'settings']) {
    const has = await page.evaluate((i) => !!document.querySelector(`.pause-menu [data-item="${i}"]`), id);
    if (!has) continue;
    await tap(page, v, `.pause-menu [data-item="${id}"]`);
    await wait(page, 350);
    const open = await page.evaluate(() => ({ stack: window.__game.ui.stack.map((p) => p.id), hidden: getComputedStyle(document.querySelector('.panel-pause')).visibility }));
    check(`[${L}] menu → ${id}: opens on top, the menu waits underneath`, open.stack.length === 2 && open.stack[0] === 'pause' && open.hidden === 'hidden', JSON.stringify(open));
    await shot(page, v, `menu-${id}`);
    if (v.touch) await tap(page, v, '.modal-layer > .panel:last-child .panel-back');
    else await page.keyboard.press('Escape');
    await wait(page, 300);
    const back = await page.evaluate(() => {
      const m = document.querySelector('.panel-pause');
      return { stack: window.__game.ui.stack.map((p) => p.id), shown: m ? getComputedStyle(m).visibility : 'gone' };
    });
    check(`[${L}] menu → ${id} → back: the menu again`, back.stack.join() === 'pause' && back.shown === 'visible', JSON.stringify(back));
  }

  // Settings in game (with Practice), then How to play from Settings → Controls.
  await settings(page, v, 'game');
  await practice(page, v, 'game');
  await tap(page, v, '.settings-tabs [data-tab="controls"]');
  await tap(page, v, '.set-link button');
  await wait(page, 250);
  const how2 = await page.evaluate(() => window.__game.ui.stack.map((p) => p.id).join());
  check(`[${L}] Settings → Controls → How to play (in game)`, how2 === 'pause,settings,howto', how2);
  await shot(page, v, 'game-howto');
  await page.evaluate(() => {
    const ui = window.__game.ui;
    while (ui.stack.length > 1) ui.closeTop();
  });
  await wait(page, 200);

  // Save keeps the menu open and says so on the button.
  await tap(page, v, '.pause-menu [data-item="save"]');
  await wait(page, 600);
  const saved = await page.evaluate(() => ({ text: document.querySelector('.pause-save .menu-label').textContent, stack: window.__game.ui.stack.map((p) => p.id).join() }));
  check(`[${L}] menu → Save: saved, the menu stays`, saved.text === 'Saved' && saved.stack === 'pause', JSON.stringify(saved));

  // Quit asks first; "Go back" leaves the menu as it was.
  await tap(page, v, '.pause-menu [data-item="quit"]');
  await wait(page, 250);
  const q = await page.evaluate(() => window.__game.ui.stack.map((p) => p.id).join());
  check(`[${L}] menu → Quit to title: asks first`, q === 'pause,confirm', q);
  await shot(page, v, 'menu-quit');
  await page.keyboard.press('Escape');
  await wait(page, 250);

  if (!v.touch) {
    // Arrow keys walk the grid; Enter on Resume resumes and does not open the chat.
    await page.focus('.pause-menu [data-item="resume"]');
    await page.keyboard.press('ArrowDown');
    const f1 = await page.evaluate(() => document.activeElement?.dataset?.item);
    await page.keyboard.press('ArrowDown');
    const f2 = await page.evaluate(() => document.activeElement?.dataset?.item);
    // Down from Spellbook is the button straight under it on screen, whatever the grid.
    const under = await page.evaluate(() => {
      const r = document.querySelector('.pause-menu [data-item="spellbook"]').getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const below = [...document.querySelectorAll('.pause-menu [data-item]')]
        .map((b) => ({ id: b.dataset.item, r: b.getBoundingClientRect() }))
        .filter((o) => o.r.top >= r.bottom - 1 && o.r.left <= cx && o.r.right >= cx)
        .sort((a, b) => a.r.top - b.r.top);
      return below[0]?.id;
    });
    check(`[${L}] menu: arrow keys walk the grid`, f1 === 'spellbook' && f2 === under, `${f1}, ${f2} (under Spellbook: ${under})`);
    // A gamepad: the d-pad walks, A presses, Start comes back, B resumes.
    const pad = await page.evaluate(async () => {
      const g = window.__game;
      const inp = g.input;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const press = async (a) => {
        inp.lastDevice = 'gamepad';
        inp.edge.add(a);
        await sleep(120);
      };
      document.activeElement?.blur?.();
      await press('down');
      await press('down');
      const f = document.activeElement?.dataset?.item;
      await press('attack');
      const opened = g.ui.stack.map((p) => p.id).join();
      await press('menu');
      const back = g.ui.stack.map((p) => p.id).join();
      await press('dodge');
      const out = { f, opened, back, after: g.ui.stack.length };
      inp.lastDevice = 'keyboard';
      return out;
    });
    check(`[${L}] menu: a gamepad walks it (d-pad, A, Start back, B resumes)`, pad.f === 'spellbook' && pad.opened === 'pause,spellbook' && pad.back === 'pause' && pad.after === 0, JSON.stringify(pad));
    await page.keyboard.press('Escape');
    await wait(page, 250);
    await page.focus('.pause-menu [data-item="resume"]');
    await page.keyboard.press('Enter');
    await wait(page, 300);
    const after = await page.evaluate(() => ({ stack: window.__game.ui.stack.length, chat: window.__game.ui.chat.isOpen(), paused: window.__game.paused }));
    check(`[${L}] menu: Enter on Resume resumes, and nothing else`, after.stack === 0 && !after.chat && !after.paused, JSON.stringify(after));
  } else {
    await tap(page, v, '.pause-menu [data-item="resume"]');
    await wait(page, 250);
    const after = await page.evaluate(() => ({ stack: window.__game.ui.stack.length, paused: window.__game.paused }));
    check(`[${L}] menu: a tap on Resume resumes`, after.stack === 0 && !after.paused, JSON.stringify(after));
  }

  // ---------- back at the title, with a save and a past life ----------
  await page.evaluate(async () => {
    const g = window.__game;
    await g.save?.save?.('manual');
    const { addPastLife } = await import('/src/survival/past_lives.js');
    addPastLife({ id: 'menu-check', name: 'Ada', diedOn: 3, place: 'the Whisperwood', at: Date.now() });
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  if (v.touch) await page.evaluate(() => window.__game.ui.setTouch(true));
  await page.waitForFunction(() => !document.querySelector('.title-continue').hidden, null, { timeout: 10000 }).catch(() => {});
  await wait(page, 400);
  t = await title(page, v);
  check(`[${L}] title with a save and a past life: Continue, New game, Prologue, Book, Past lives, Settings, How to play — on screen`, t.labels.join('|') === 'Continue|New game|Prologue|The Book of Halcyre|Past lives|Settings|How to play' && !t.off, `${t.labels.join('|')} off ${t.off}`);
  await shot(page, v, 'title-full');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`[${L}] no horizontal overflow`, over <= 0, String(over));
  await ctx.close();
}

for (const v of VIEWS) {
  if (ONLY && !ONLY.includes(v.label)) continue;
  try {
    await run(v);
  } catch (err) {
    check(`[${v.label}] the run finished`, false, err.message.split('\n')[0]);
  }
}
await browser.close();
server.close();
const failed = checks.filter((c) => !c.ok);
if (errors.length) console.log(`\nPAGE ERRORS:\n${errors.join('\n')}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `, ${errors.length} page errors` : ''}`);
process.exit(failed.length || errors.length ? 1 : 0);
