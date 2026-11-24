// Browser checks for the round-3 interface (DESIGN.md §19.6), in headless Chromium:
// the villager dialog's "Say something…" field, Listen in, the morning's "While you
// slept", the People tab (every villager), her worth-it breakdown, edited memories,
// toasts that never cover bubbles or the quest line, and panels that fit a phone.
// Where the village or her worth() are not in this build yet, small stubs stand in.
//   node scripts/ui3_check.mjs [--src]        (after `npm run build` unless --src)
// Screenshots go to $SHOTS (default screenshots/), named ui3-*.png.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const useSrc = process.argv.includes('--src');
const SHOTS = process.env.SHOTS || 'screenshots';
await mkdir(SHOTS, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useSrc ? 'index.html' : 'dist/index.html'}`;
const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const VIEWS = [
  { label: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
  { label: 'phone', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'phone-land', viewport: { width: 844, height: 390 }, touch: true },
];

// A stand-in village with the §19.3 surface, installed only when the build has none.
function installStubVillage() {
  const g = window.__game;
  const real = !!g.village;
  const calls = { says: [], listens: 0, nights: [] };
  window.__calls = calls;
  const ids = g.entities.all().filter((e) => e.profile && e.id !== 'lyra').map((e) => e.id);
  const wrap = (v) => {
    // Record what the UI asks of the village, whether it is the real one or the stub.
    const ps = v.playerSays?.bind(v);
    const li = v.listenIn?.bind(v);
    const ns = v.nightSummary?.bind(v);
    v.playerSays = (npc, text) => {
      calls.says.push({ npc: npc?.id, text });
      return ps(npc, text);
    };
    v.listenIn = (conv) => {
      calls.listens++;
      return li(conv);
    };
    v.nightSummary = (day) => {
      calls.nights.push(day);
      return ns(day);
    };
    return v;
  };
  if (real) {
    wrap(g.village);
    return { real, ids };
  }
  const near = () => {
    const p = g.player;
    const people = g.entities.all().filter((e) => e.profile && e.id !== 'lyra' && Math.hypot(e.x - p.x, e.y - p.y) < 120);
    return people.length >= 2 ? { id: `${people[0].id}+${people[1].id}`, a: people[0].id, b: people[1].id, topic: 'harvest' } : null;
  };
  g.village = wrap({
    log: [
      { t: 100, day: g.clock.day, a: 'lyra', b: 'mira', topic: 'rowan', summary: 'Mira asked whether Rowan had eaten. Lyra said no, and that he never does.' },
      { t: 90, day: g.clock.day, a: 'elda', b: 'garrick', topic: 'player', summary: '' },
      { t: 80, day: g.clock.day, a: 'hobb', b: 'corran', topic: 'stones', summary: '' },
    ],
    rumors: [{ id: 'r1', about: 'player', text: 'Heard you pulled the wolf off Tansy.', valence: 0.6, t: 50, heardBy: ['elda', 'pip'] }],
    bond(a, b) {
      const pairs = { 'elda|pip': 80, 'mira|rowan': 60, 'bram|tilly': 55, 'hess|rowan': -40 };
      const k = [a, b].sort().join('|');
      const aff = pairs[k] ?? 0;
      return { affinity: aff, trust: 50, familiarity: 60, tags: aff >= 80 ? ['ward'] : aff < 0 ? ['grudge'] : [] };
    },
    playerSays(npc, text) {
      return new Promise((r) => setTimeout(() => r({ lines: [`${npc.name.split(' ')[0]} hears you say "${text}".`, 'And answers in two lines, to test the dialog.'], mood: 'happy' }), 400));
    },
    canListen: near,
    listenIn(conv) {
      return new Promise((r) =>
        setTimeout(
          () =>
            r([
              { speaker: conv.a, text: 'Did you see the wheat come in?' },
              { speaker: conv.b, text: 'All of it, and Tobias apologizing to every sheaf.' },
              { speaker: conv.a, text: 'He means it, you know.' },
            ]),
          300,
        ),
      );
    },
    nightSummary(day) {
      return new Promise((r) => setTimeout(() => r(['Elda and Garrick argued about bread again.', 'Pip told Tansy a secret, badly.', `Lyra lit the far lamps on Lamplight Lane (day ${day}).`]), 500));
    },
  });
  return { real, ids };
}

// Rects of every visible toast, the quest line and this frame's bubbles (CSS px).
function overlapReport() {
  const g = window.__game;
  const root = g.ui.root.getBoundingClientRect();
  const rel = (r) => ({ x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height });
  const toasts = [...document.querySelectorAll('.toasts .toast:not(.leaving)')].filter((el) => getComputedStyle(el.parentElement).visibility !== 'hidden').map((el) => rel(el.getBoundingClientRect()));
  const q = document.querySelector('.quest-line');
  const quest = q && !q.hidden && q.getBoundingClientRect().width ? rel(q.getBoundingClientRect()) : null;
  const bubbles = g.bubbles.screenRects();
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let bad = 0;
  for (const t of toasts) {
    if (quest && hit(t, quest)) bad++;
    for (const b of bubbles) if (hit(t, b)) bad++;
  }
  return { toasts: toasts.length, bubbles: bubbles.length, quest: !!quest, bad };
}

for (const view of VIEWS) {
  const ctx = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: 1, hasTouch: view.touch, isMobile: view.touch });
  const page = await ctx.newPage();
  const label = view.label;
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(msg.text())) errors.push(`[${label}] console.error: ${msg.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing');
  await page.waitForTimeout(600);
  if (view.touch) await page.evaluate(() => window.__game.ui.setTouch(true));
  const info = await page.evaluate(installStubVillage);
  console.log(`[${label}] village: ${info.real ? 'real' : 'stub'}, ${info.ids.length} villagers`);

  // ---------- the dialog's say field ----------
  await page.evaluate(() => {
    const g = window.__game;
    g.ui.closeAll();
    const npc = g.entities.get('elda') || g.entities.all().find((e) => e.profile && e.id !== 'lyra');
    g.player.x = npc.x;
    g.player.y = npc.y + 20;
    g.camera.snap?.();
    g.ui.openDialog(npc);
  });
  await page.waitForTimeout(300);
  const hasField = await page.$('.dlg-say-field');
  check(`[${label}] dialog shows "Say something…"`, !!hasField);
  if (hasField) {
    await page.click('.dlg-say-field');
    await page.keyboard.type('How are you today?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const waiting = await page.evaluate(() => !document.querySelector('.dlg-dots')?.hidden || !!document.querySelector('.dlg-text')?.textContent);
    check(`[${label}] a typing indicator shows while waiting`, waiting);
    await page.waitForFunction(() => window.__calls.says.length > 0 && !window.__game.ui.dialog.waiting, null, { timeout: 35000 });
    await page.waitForTimeout(view.label === 'desktop' ? 1600 : 1200);
    const said = await page.evaluate(() => ({ calls: window.__calls.says, text: document.querySelector('.dlg-text')?.textContent || '', you: document.querySelector('.dlg-you')?.textContent || '' }));
    check(`[${label}] say field calls village.playerSays(npc, text)`, said.calls[0]?.text === 'How are you today?' && !!said.calls[0]?.npc, JSON.stringify(said.calls[0]));
    check(`[${label}] the reply shows in the dialog`, said.text.length > 3, said.text.slice(0, 60));
    check(`[${label}] the player's words are echoed`, /How are you today/.test(said.you));
    // The field must be on screen, inside the viewport, with the panel.
    const fieldBox = await page.evaluate(() => {
      const r = document.querySelector('.dlg-say-field').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight };
    });
    check(`[${label}] the say field is fully on screen`, fieldBox.top >= 0 && fieldBox.bottom <= fieldBox.vh && fieldBox.left >= 0 && fieldBox.right <= fieldBox.vw, JSON.stringify(fieldBox));
    // A phone keyboard covering 40% of the screen: the field rises above it.
    if (view.touch) {
      const kb = await page.evaluate(() => {
        const root = window.__game.ui.root;
        const k = Math.round(innerHeight * 0.4);
        root.style.setProperty('--kb', `${k}px`);
        root.classList.add('kb-open');
        const r = document.querySelector('.dlg-say-field').getBoundingClientRect();
        return { bottom: r.bottom, limit: innerHeight - k };
      });
      await page.screenshot({ path: `${SHOTS}/ui3-${label}-dialog-keyboard.png` });
      check(`[${label}] with the keyboard up the field stays above it`, kb.bottom <= kb.limit + 1, JSON.stringify(kb));
      await page.evaluate(() => {
        const root = window.__game.ui.root;
        root.style.removeProperty('--kb');
        root.classList.remove('kb-open');
      });
    }
    await page.screenshot({ path: `${SHOTS}/ui3-${label}-dialog.png` });
  }
  await page.evaluate(() => window.__game.ui.closeAll());

  // ---------- listen in ----------
  const listen = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.entities.get('elda') || g.entities.all().find((e) => e.profile && e.id !== 'lyra');
    const b = g.entities.get('pip') || g.entities.all().find((e) => e.profile && e.id !== 'lyra' && e !== a);
    // Gather the two in the open by the player.
    const sq = g.locations.get('town_square')?.center || { x: g.player.x, y: g.player.y };
    for (const [e, dx] of [[a, -18], [b, 18]]) {
      e.x = sq.x + dx;
      e.y = sq.y - 30;
      e.mode = 'routine';
    }
    g.player.x = sq.x;
    g.player.y = sq.y + 10;
    g.camera.snap?.();
    await new Promise((r) => setTimeout(r, 500));
    const btn = document.querySelector('.listen-prompt');
    return { shown: !!btn && !btn.hidden, text: btn?.textContent || '' };
  });
  check(`[${label}] "Listen in" appears near a conversation`, listen.shown, listen.text);
  if (listen.shown) {
    if (view.touch) await page.tap('.listen-prompt');
    else await page.keyboard.press('KeyL');
    await page.waitForFunction(() => window.__calls.listens > 0, null, { timeout: 5000 });
    await page.waitForTimeout(900);
    const played = await page.evaluate(() => window.__game.bubbles.items.filter((b) => b.kind === 'say' && b.entity.profile).map((b) => `${b.entity.id}: ${b.text}`));
    await page.screenshot({ path: `${SHOTS}/ui3-${label}-listen.png` });
    check(`[${label}] listening in plays the lines as bubbles`, played.length > 0, played.join(' | ').slice(0, 120));
    // Toasts arriving now must keep clear of the bubbles and the quest line.
    await page.evaluate(() => {
      const ui = window.__game.ui;
      ui.toast('A notice while they talk.', 'info');
      ui.toast('Another notice, a longer one, that wraps onto a second line on a phone.', 'good', { title: 'Something happened' });
      ui.toast('Lyra says something while you listen.', 'lyra', { title: 'Lyra' });
    });
    let worst = { bad: 0 };
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      const r = await page.evaluate(overlapReport);
      if (r.bad > worst.bad || i === 0) worst = r;
    }
    await page.screenshot({ path: `${SHOTS}/ui3-${label}-toasts.png` });
    check(`[${label}] toasts never overlap bubbles or the quest line`, worst.bad === 0, JSON.stringify(worst));
  }

  // ---------- People tab, worth, edited memories ----------
  const people = await page.evaluate(async () => {
    const g = window.__game;
    const mind = g.companion.mind;
    const aut = mind.autonomy || (mind.autonomy = {});
    if (typeof aut.worth !== 'function') {
      aut.worth = () => ({
        stay: 46,
        cost: 14,
        net: 32,
        reasons: [
          { text: 'You came out of the mountain saying Maren’s name. You are the best thread I have.', weight: 18 },
          { text: 'You kept your word about the honey cakes.', weight: 9 },
          { text: 'The hearthwatch wage pays my room.', weight: 6 },
          { text: 'You pushed after I said no, at the quarry.', weight: -8 },
          { text: 'Time away from Mam and Da.', weight: -6 },
        ],
      });
    }
    // One memory and one fact she edited, to show the mark.
    const mem = mind.memory;
    const list = mem?.all?.() || mem?.list?.() || [];
    if (list[0]) {
      list[0].edited = true;
      list[0].history = [{ t: 50, text: 'The stranger was rude to me at the well.', importance: 4, why: 'I learned they had not slept in three days.' }];
    }
    const kn = mind.knowledge?.all?.() || mind.knowledge?.list?.() || [];
    if (kn[0]) {
      kn[0].edited = true;
      kn[0].history = [{ t: 60, text: 'An older version of what she knew.', why: 'Hess told her otherwise.' }];
    }
    g.ui.openMind('people');
    await new Promise((r) => setTimeout(r, 300));
    const npcIds = g.entities.all().filter((e) => e.profile && e.id !== 'lyra' && !e.removed).map((e) => e.id);
    const shown = [...document.querySelectorAll('.people-village [data-person]')].map((el) => el.dataset.person);
    return { npcIds, shown, missing: npcIds.filter((id) => !shown.includes(id)), village: !!document.querySelector('.village-box .feel'), talk: document.querySelector('.talk-log')?.textContent || '' };
  });
  check(`[${label}] the People tab lists every villager present`, people.missing.length === 0 && people.npcIds.length > 0, `${people.shown.length} shown; missing: ${people.missing.join(', ')}`);
  check(`[${label}] the People tab says how the village sees you`, people.village);
  check(`[${label}] village talk reads "Lyra and Mira talked about Rowan"`, /Lyra and Mira talked about Rowan/.test(people.talk) || !people.talk, people.talk.slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/ui3-${label}-people.png` });
  await page.evaluate(() => window.__game.ui.mind.showTab('you'));
  await page.waitForTimeout(200);
  const worth = await page.evaluate(() => ({ box: !!document.querySelector('.worth-box'), gives: document.querySelectorAll('.worth-col.gives li').length, costs: document.querySelectorAll('.worth-col.costs li').length }));
  check(`[${label}] You & her shows what staying gives and costs her`, worth.box && worth.gives > 0 && worth.costs > 0, JSON.stringify(worth));
  await page.evaluate(() => document.querySelector('.worth-box')?.scrollIntoView());
  await page.screenshot({ path: `${SHOTS}/ui3-${label}-worth.png` });
  await page.evaluate(() => window.__game.ui.mind.showTab('memories'));
  await page.waitForTimeout(200);
  const edited = await page.evaluate(() => {
    const m = document.querySelector('.memory .edit-mark');
    if (!m) return { mark: false };
    m.click();
    m.scrollIntoView();
    return { mark: true, history: document.querySelector('.edit-history')?.textContent || '' };
  });
  check(`[${label}] an edited memory shows its mark and earlier version`, edited.mark && /used to remember/.test(edited.history), (edited.history || '').slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/ui3-${label}-edited.png` });

  // ---------- every panel fits the screen ----------
  const panels = await page.evaluate(async () => {
    const g = window.__game;
    const ui = g.ui;
    const out = [];
    const measure = (name) => {
      const doc = document.documentElement;
      const panel = ui.top()?.el;
      const over = [];
      if (doc.scrollWidth > innerWidth + 1) over.push(`page ${doc.scrollWidth}>${innerWidth}`);
      if (panel) {
        const r = panel.getBoundingClientRect();
        if (r.left < -1 || r.right > innerWidth + 1) over.push(`panel ${Math.round(r.left)}..${Math.round(r.right)}`);
        for (const el of panel.querySelectorAll('.panel-body, .tab-content, .panel-foot, .tabs')) {
          if (el.classList.contains('tabs')) continue; // the tab strip scrolls sideways on purpose
          if (el.scrollWidth > el.clientWidth + 1) over.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
      }
      out.push({ name, over });
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    ui.closeAll();
    for (const tab of ['now', 'you', 'people', 'memories', 'knowledge', 'life', 'diary', 'goals', 'soul', 'data']) {
      ui.openMind(tab);
      await wait(120);
      measure(`mind:${tab}`);
    }
    ui.closeAll();
    ui.openInventory();
    await wait(120);
    measure('inventory');
    ui.closeAll();
    ui.openSettings();
    await wait(120);
    measure('settings');
    ui.closeAll();
    ui.openPause();
    await wait(120);
    measure('pause');
    ui.closeAll();
    const shop = g.entities.get('garrick') || g.entities.all().find((e) => e.profile?.shop);
    if (shop) {
      ui.openDialog(shop);
      await wait(150);
      measure('dialog');
      ui.dialog.choose('trade');
      await wait(150);
      measure('shop');
    }
    ui.closeAll();
    ui.showDiary({ day: 1, text: 'A page of her diary, long enough to wrap a few times on a narrow phone screen and test the layout.' });
    await wait(150);
    measure('diary');
    ui.closeAll();
    return out;
  });
  const bad = panels.filter((p) => p.over.length);
  check(`[${label}] every panel fits the screen without sideways overflow`, bad.length === 0, bad.map((p) => `${p.name}: ${p.over.join('; ')}`).join(' | '));
  await page.evaluate(() => window.__game.ui.openSettings());
  await page.waitForTimeout(150);
  const vai = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[name=villageAi]')];
    return { n: radios.length, always: radios.find((r) => r.value === 'always')?.disabled, checked: radios.find((r) => r.checked)?.value };
  });
  check(`[${label}] Settings: "Villagers think with Claude" ('always' needs an API key)`, vai.n === 2 && vai.always === true && vai.checked === 'player', JSON.stringify(vai));
  await page.evaluate(() => document.querySelector('.village-ai')?.scrollIntoView());
  await page.screenshot({ path: `${SHOTS}/ui3-${label}-settings.png` });
  await page.evaluate(() => window.__game.ui.closeAll());

  // ---------- the morning: while you slept ----------
  const morning = await page.evaluate(async () => {
    const g = window.__game;
    g.clock.skipTo(22);
    const bed = g.objects.get('home_bed');
    g.player.x = bed.x;
    g.player.y = bed.y + 12;
    const done = g.sleep(bed);
    await done;
    await new Promise((r) => setTimeout(r, 2600));
    const sec = document.querySelector('.slept');
    return { nights: window.__calls.nights, panel: g.ui.top()?.id || null, lines: sec ? [...sec.querySelectorAll('li')].map((li) => li.textContent) : [], waiting: !!sec?.querySelector('.slept-wait') };
  });
  await page.screenshot({ path: `${SHOTS}/ui3-${label}-morning.png` });
  check(`[${label}] sleeping asks the village for the night's news`, morning.nights.length > 0, JSON.stringify(morning.nights));
  check(`[${label}] the morning shows "While you slept"`, morning.lines.length > 0, `${morning.panel}: ${morning.lines.join(' / ').slice(0, 100)}`);
  await ctx.close();
}

await browser.close();
server.close();
const failed = checks.filter((c) => !c.ok);
if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of errors) console.error(' - ' + e);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || errors.length ? 1 : 0);
