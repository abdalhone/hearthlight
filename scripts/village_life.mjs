// Watch Hearthvale react when someone vanishes (DESIGN §28 test harness), in headless
// Chromium on the built game:
//   node scripts/village_life.mjs [--src] [--who garrick] [--mode gone|away] [--place mirror_lake] [--out dir]
// Garrick (by default) vanishes at 7 AM. The day runs fast between scenes; at each scene
// the player stands where the story is, the world runs in real time, and screenshots are
// taken. Everything said aloud, every thought and the case's timeline go to story.txt.
// Exits 1 on any page error.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const useSrc = argv.includes('--src');
const WHO = arg('who', 'garrick');
const MODE = arg('mode', 'gone');
const PLACE = arg('place', 'mirror_lake');
const OUT = arg('out', 'screenshots/village-life');
await mkdir(OUT, { recursive: true });

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useSrc ? 'index.html' : 'dist/index.html'}`;
const browser = await chromium.launch();
const errors = [];

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${(err.stack || '').split('\n').slice(0, 5).join('\n')}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${label}] console.error: ${t}`);
  });
}

const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
watch(page, 'desktop');
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
await page.evaluate(() => window.__game.newGame());
await page.waitForFunction(() => window.__game.state === 'playing');
await page.waitForTimeout(800);

// Record everything said and thought, with who and when.
await page.evaluate(() => {
  const g = window.__game;
  g.__story = [];
  const name = (e) => (e?.id === 'player' ? 'You' : e?.name ? String(e.name).replace(/^(Captain|Sister) /, '').split(' ')[0] : '?');
  g.bus.on('speech', (p) => g.__story.push(`${g.clock.timeString()}  ${name(p.speaker)}${p.target ? ` (to ${name(p.target)})` : ''}: ${p.text}`));
  g.bus.on('village_talk', (p) => g.__story.push(`${g.clock.timeString()}  [talk] ${p.summary}`));
  g.bus.on('rumor', (p) => g.__story.push(`${g.clock.timeString()}  [rumor] ${p.rumor?.text}`));
  for (const k of ['search_started', 'missing_declared', 'person_found', 'body_found']) g.bus.on(k, (p) => g.__story.push(`${g.clock.timeString()}  [${k}] ${JSON.stringify({ id: p.id || p.about, by: p.by || p.leader || null })}`));
  const toast = g.ui.toast.bind(g.ui);
  g.ui.toast = (text, kind, o) => {
    g.__story.push(`${g.clock.timeString()}  [toast] ${text}`);
    return toast(text, kind, o);
  };
  g.settings.showThoughts = true;
});

// Run the game fast (no rendering) until a given hour; dt 1/30.
async function fastTo(hour, { day = null } = {}) {
  for (;;) {
    const done = await page.evaluate(
      ({ hour, day }) => {
        const g = window.__game;
        for (let i = 0; i < 600; i++) {
          const h = g.clock.hour;
          if ((day == null || g.clock.day >= day) && h >= hour && h < hour + 0.5) return true;
          g.update(1 / 30);
        }
        return false;
      },
      { hour, day },
    );
    if (done) return;
  }
}

// Put the player (and the camera) where the story is.
async function standAt(where) {
  await page.evaluate((where) => {
    const g = window.__game;
    let x;
    let y;
    if (typeof where === 'string' && g.entities.get(where)) {
      const e = g.entities.get(where);
      x = e.x + 26;
      y = e.y + 18;
    } else {
      const loc = g.locations.get(where);
      x = loc.center.x;
      y = loc.center.y + 24;
    }
    const p = g.player;
    for (let r = 0; r < 6; r++) {
      const tx = Math.floor(x / 16);
      const ty = Math.floor(y / 16);
      if (!g.isBlockedTile(tx, ty, p)) break;
      y += 16;
    }
    p.x = x;
    p.y = y;
    if (g.companion) {
      g.companion.x = x - 18;
      g.companion.y = y + 6;
    }
    g.camera.snap?.();
  }, where);
}

let shot = 0;
async function snap(label) {
  shot++;
  const f = `${OUT}/${String(shot).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path: f });
  return f;
}

// Real time, with a screenshot every few seconds.
// With `follow`, the camera keeps up with that villager.
async function watchFor(seconds, label, every = 3, follow = null) {
  const n = Math.max(1, Math.round(seconds / every));
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(every * 1000);
    if (follow) await standAt(follow);
    await snap(`${label}-${i + 1}`);
  }
}

// --- the morning: he vanishes ------------------------------------------------------------
await page.evaluate(() => window.__game.clock.skipTo(6.8));
await fastTo(6.85);
await page.evaluate(
  ({ WHO, MODE, PLACE }) => {
    const g = window.__game;
    const life = g.villageLife;
    life.vanish(WHO, MODE === 'away' ? { mode: 'away', place: PLACE, hours: 8, witnesses: [] } : { mode: 'gone' });
    // Make sure somebody needs him this morning, where the player can watch.
    if (WHO === 'garrick') {
      life.forceErrand('hobb', 'hobb_wick', 9);
      life.forceErrand('elda', 'elda_needles', 9.6);
    }
  },
  { WHO, MODE, PLACE },
);

// --- 9 AM: Hobb comes for his wick -------------------------------------------------------
await fastTo(8.9);
const shopId = await page.evaluate((WHO) => window.__game.entities.get(WHO)?.profile?.work || 'general_store', WHO);
await standAt(shopId);
await page.evaluate(() => (window.__game.ui.chat?.isOpen?.() ? window.__game.ui.chat.close() : null));
await watchFor(30, 'shop', 3);

// --- follow whoever has a problem --------------------------------------------------------
async function followTrouble(label, seconds = 18) {
  const who = await page.evaluate(() => {
    const life = window.__game.villageLife;
    const p = life.problems.filter((x) => x.status === 'open').sort((a, b) => b.since - a.since)[0];
    return p?.owner || null;
  });
  if (!who) return null;
  await standAt(who);
  await watchFor(seconds, `${label}-${who}`, 3, who);
  return who;
}
await fastTo(10.2);
await followTrouble('asking');
await fastTo(11.5);
await followTrouble('asking2');

// --- the search ---------------------------------------------------------------------------
await fastTo(13);
const searching = await page.evaluate((WHO) => {
  const c = window.__game.villageLife.cases.get(WHO);
  return c ? { status: c.status, searchers: Object.keys(c.searchers || {}) } : null;
}, WHO);
if (searching?.searchers?.length) {
  await standAt(searching.searchers[0]);
  await watchFor(15, 'search', 3, searching.searchers[0]);
}
// Away somewhere unexpected: stand where he is and watch the search reach him.
if (MODE === 'away') {
  await standAt(WHO);
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(3000);
    await snap(`found-watch-${i + 1}`);
    const st = await page.evaluate((WHO) => window.__game.villageLife.cases.get(WHO)?.status, WHO);
    if (st === 'found') {
      await page.waitForTimeout(2500);
      await snap('found');
      await page.waitForTimeout(3000);
      await snap('found-2');
      break;
    }
  }
}
await fastTo(15.2);
await followTrouble('afternoon');

// --- nightfall: missing ---------------------------------------------------------------------
await fastTo(20.4);
await standAt('town_square');
await watchFor(9, 'nightfall', 3);
// Find Lyra: missing is news she brings to the player.
await standAt('lyra');
await watchFor(6, 'lyra', 3, 'lyra');
await page.evaluate(() => window.__game.ui.chat?.open?.());
await page.waitForTimeout(1500);
await snap('lyra-asks');
await page.evaluate(() => window.__game.ui.chat?.close?.());

// The village view: desktop, then phone (landscape and portrait).
await page.evaluate(() => window.__game.ui.openVillageLife());
await page.waitForTimeout(600);
await snap('village-view');
await page.evaluate(() => {
  const d = document.querySelector('.life-timeline');
  if (d) d.open = true;
});
await page.waitForTimeout(300);
await snap('village-view-timeline');
for (const [w, hgt] of [
  [844, 390],
  [390, 844],
]) {
  await page.setViewportSize({ width: w, height: hgt });
  await page.waitForTimeout(500);
  await snap(`village-view-${w}x${hgt}`);
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.evaluate(() => window.__game.ui.closeAll());

// --- the next morning: schedules adapt ------------------------------------------------------
const day = await page.evaluate(() => window.__game.clock.day);
await fastTo(9.2, { day: day + 1 });
const cover = await page.evaluate((WHO) => {
  const g = window.__game;
  const covers = { garrick: 'alder', bram: 'tilly', elda: 'sabeth' };
  const by = covers[WHO];
  const e = by ? g.entities.get(by) : null;
  return e ? { by, at: g.locations.at(e.x, e.y)?.id, doing: e.r?.entry?.doing || null } : null;
}, WHO);
if (cover) {
  await standAt(cover.by);
  await watchFor(9, 'next-morning', 3);
}

// --- the story, for reading -----------------------------------------------------------------
const story = await page.evaluate((WHO) => {
  const g = window.__game;
  const life = g.villageLife;
  const c = life.cases.get(WHO);
  return {
    status: c?.status,
    timeline: life.caseStory(WHO),
    speech: g.__story,
    lyra: (g.companion?.mind?.memory?.list || g.companion?.mind?.memory?.all?.() || []).filter?.((m) => /missing|lied/.test((m.tags || []).join(' '))).map((m) => m.text) || [],
    perf: life.perf,
    claude: life.claude.stats(),
    problems: life.problems.map((p) => `${p.owner} (${p.kind} ${p.about}) ${p.status}: ${p.history.map((h) => `${h.action}${h.target ? `→${h.target}` : ''} “${h.thought}”`).join(' | ')}`),
  };
}, WHO);
const text = [
  `Case: ${WHO} (${MODE}) — ${story.status}`,
  '',
  '== Timeline ==',
  ...story.timeline,
  '',
  '== Problems and thoughts ==',
  ...story.problems,
  '',
  '== Everything said, heard and told ==',
  ...story.speech,
  '',
  '== Lyra remembers ==',
  ...story.lyra,
  '',
  `perf: avg ${story.perf.avg.toFixed(4)} ms, max ${story.perf.max.toFixed(2)} ms over ${story.perf.n} frames; cover: ${JSON.stringify(cover)}`,
].join('\n');
await writeFile(`${OUT}/story.txt`, text);
console.log(`status ${story.status}; ${story.speech.length} lines; ${shot} screenshots in ${OUT}`);
console.log(`perf avg ${story.perf.avg.toFixed(4)} ms max ${story.perf.max.toFixed(2)} ms`);
await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
