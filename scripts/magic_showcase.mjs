// The Weave showcase: casts a grid of weaves at training dummies, by day and by night,
// and saves screenshots so every essence and shape can be compared side by side; also
// close-ups of twists, statuses and reactions, and (with --perf) a stress test that keeps
// 150+ bodies alive and reports frame times.
//
//   node scripts/magic_showcase.mjs                 built page (npm run build first), 844×390
//   node scripts/magic_showcase.mjs --src           the ES-module source instead
//   node scripts/magic_showcase.mjs --size 390x844  another viewport (css px, dpr 1)
//   node scripts/magic_showcase.mjs --only bolt,nova --day   just those shapes, by day
//   node scripts/magic_showcase.mjs --perf          frame times with a screen full of weaves
//   --out <dir>  where screenshots go (default screenshots/magic)
//   --throttle N slow the CPU N times (Chromium emulation, e.g. 4 for a mid phone)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const [W, H] = opt('--size', '844x390').split('x').map(Number);
const out = opt('--out', 'screenshots/magic');
const only = opt('--only', '') ? opt('--only', '').split(',') : null;
const perfOnly = flag('--perf');
const times = flag('--day') ? ['day'] : flag('--night') ? ['night'] : ['day', 'night'];
const tag = `${W}x${H}`;

const SHAPES = ['bolt', 'blast', 'strike', 'throw', 'beam', 'nova', 'orb', 'summon', 'rune', 'rain', 'wall', 'dash'];
// How long after the cast each shape looks its best (ms).
const SETTLE = { bolt: 70, blast: 110, strike: 90, throw: 560, beam: 420, nova: 170, orb: 700, summon: 1500, rune: 1300, rain: 750, wall: 450, dash: 70 };

await mkdir(out, { recursive: true });
const server = await startServer(0);
const port = server.address().port;
const url = `http://localhost:${port}/${flag('--src') ? 'index.html' : 'dist/index.html'}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
const throttle = Number(opt('--throttle', '0'));
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 30000 });
await page.evaluate(() => window.__game.newGame());
await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(400);

// ------------------------------------------------------------------ the arena (in the page)
await page.evaluate(() => {
  const g = window.__game;
  const T = 16;
  const ESS = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'wind', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
  const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
  const Creature = proto.constructor;
  const S = (window.__show = { ESS, cells: [], dummies: [], casters: [] });

  // An open meadow: the screen of grass with the fewest props, the closest to the start.
  const map = g.map;
  const GRASSY = new Set([1, 7]); // GRASS, TALL_GRASS
  const cam = g.camera;
  const vw = Math.ceil(cam.vw / T);
  const vh = Math.ceil(cam.vh / T);
  const p = g.player;
  let spot = null;
  let best = Infinity;
  for (let ty = 2; ty < map.h - vh - 2; ty += 2) {
    for (let tx = 2; tx < map.w - vw - 2; tx += 2) {
      let bad = 0;
      for (let y = ty; y < ty + vh && bad < best; y++) {
        for (let x = tx; x < tx + vw; x++) if (!GRASSY.has(map.tileAt(x, y)) || g.objects.objectsAt(x, y)) bad++;
      }
      if (bad < best) {
        best = bad;
        spot = { x: tx * T, y: ty * T };
      }
    }
  }
  if (!spot) spot = { x: p.x - cam.vw / 2, y: p.y - cam.vh / 2 };
  S.spot = spot;
  // Clear the stage: creatures away, Lyra off to the side and calm.
  for (const e of g.entities.all()) {
    if (e.species && Math.hypot(e.x - (spot.x + cam.vw / 2), e.y - (spot.y + cam.vh / 2)) < 600) g.entities.remove(e);
  }
  if (g.companion) {
    g.companion.x = spot.x - 200;
    g.companion.y = spot.y - 200;
  }
  p.x = spot.x + cam.vw / 2;
  p.y = spot.y + cam.vh / 2 + 10;
  p.invuln = 1e9;
  p.hp = p.maxHp;
  g.camera.follow({ x: p.x, y: p.y - 0, removed: false });
  g.camera.snap();
  g.magic.unlockAll();

  function dummy(x, y, species = 'slime') {
    const d = new Creature(g, species, { x, y });
    d.maxHp = d.hp = 1e7;
    d.controller = null;
    d.speed = 0;
    d.xpValue = 0;
    d.drops = [];
    d.aggroRadius = 0;
    g.entities.add(d);
    return d;
  }
  function caster(x, y) {
    const c = new Creature(g, 'chicken', { x, y });
    c.faction = 'player';
    c.controller = null;
    c.hidden = true;
    c.solid = false;
    c.invuln = 1e9;
    c.maxHp = c.hp = 1e7;
    c.facing = { x: 1, y: 0 };
    g.entities.add(c);
    return c;
  }
  // A 5×3 grid of cells: a hidden caster on the left, a dummy on the right.
  const cols = 5;
  const rows = 3;
  const cw = cam.vw / cols;
  const ch = (cam.vh - 20) / rows;
  for (let i = 0; i < ESS.length; i++) {
    const cx = spot.x + (i % cols) * cw;
    const cy = spot.y + 26 + Math.floor(i / cols) * ch;
    const c = caster(cx + cw * 0.2, cy + ch * 0.45);
    const d = dummy(cx + cw * 0.78, cy + ch * 0.45);
    S.cells.push({ c, d, ess: ESS[i] });
  }
  // A row of dummies right of the player for twist close-ups.
  // Where the i-th close-up dummy stands: a column to the right in landscape, a row
  // below the player in portrait (so the shots stay on screen either way).
  S.dummySpot = (i) => {
    const pl = g.player;
    if (cam.vw >= cam.vh) return { x: pl.x + 60 + (i % 2) * 26, y: pl.y - 40 + i * 20 };
    return { x: pl.x - 48 + i * 24, y: pl.y + 64 + (i % 2) * 22 };
  };
  for (let i = 0; i < 5; i++) {
    const at = S.dummySpot(i);
    S.dummies.push(dummy(at.x, at.y, i % 2 ? 'wolf' : 'slime'));
  }
  for (const d of S.dummies) d.removed = true;

  S.reset = () => {
    const m = g.magic;
    // Lyra watches from far off (her own healing and spells stay out of the pictures).
    if (g.companion) {
      g.companion.x = spot.x - 420;
      g.companion.y = spot.y - 300;
      g.companion.hidden = true;
    }
    for (const b of m.bodies) if (b.active) m.end(b, 'dismiss');
    m.pending.length = 0;
    for (const k of [...m.holds.keys()]) m.castCancel(k);
    m.decals.length = 0;
    for (const e of g.entities.all()) {
      if (e.type !== 'actor') continue;
      m.status.clear(e);
      e.statusImmune = null;
      e.reactAt = null;
      if (e.maxHp >= 1e6) e.hp = e.maxHp;
    }
    g.magicFx?.parts?.clear?.();
    g.magicFx?.effects?.clear?.();
    g.bubbles?.clearAll?.();
    m.mana.cur = m.mana.max;
    m.cooldowns.fill(0);
  };
  S.showCells = (on) => {
    for (const cell of S.cells) {
      cell.d.removed = !on;
      if (on && !g.entities.all().includes(cell.d)) g.entities.add(cell.d);
      cell.c.removed = !on;
      if (on && !g.entities.all().includes(cell.c)) g.entities.add(cell.c);
    }
    for (const d of S.dummies) {
      d.removed = on;
      if (!on && !g.entities.all().includes(d)) g.entities.add(d);
    }
  };
  S.grid = (shape, twists = []) => {
    const m = g.magic;
    for (const cell of S.cells) {
      const { c, d } = cell;
      let aim = { x: d.x, y: d.y };
      if (shape === 'rune') aim = { x: d.x - 26, y: d.y };
      if (shape === 'wall') aim = { x: (c.x + d.x) / 2 + 6, y: d.y };
      if (shape === 'nova' || shape === 'summon') aim = { x: c.x + 10, y: c.y };
      c.facing = { x: 1, y: 0 };
      const w = { shape, essences: [cell.ess], twists };
      const plan = m.compile(w);
      if (plan.input === 'hold') m.castStart(c, plan, aim, { free: true });
      else m.cast(c, plan, aim, { free: true });
    }
  };
  S.player = (weave, aim, opts = {}) => g.magic.cast(g.player, weave, aim || { x: S.dummies[2].x, y: S.dummies[2].y }, { free: true, ...opts });
  S.hold = (weave, aim) => g.magic.castStart(g.player, weave, aim || { x: S.dummies[2].x, y: S.dummies[2].y }, { free: true });
  S.release = () => g.magic.castRelease(g.player);
  S.time = (h) => {
    g.clock.skipTo(h);
    g.clock.setWeather?.('clear');
  };
  const ui = document.getElementById('ui-root');
  if (ui) ui.style.visibility = 'hidden';
});

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${tag}-${name}.png` });
};
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);

if (!perfOnly) {
  for (const tod of times) {
    await ev((h) => window.__show.time(h), tod === 'day' ? 13 : 22.5);
    await wait(300);
    // Every essence for each shape, side by side.
    await ev(() => window.__show.showCells(true));
    for (const shape of SHAPES) {
      if (only && !only.includes(shape)) continue;
      await ev(() => window.__show.reset());
      await wait(60);
      await ev((s) => window.__show.grid(s), shape);
      await wait(SETTLE[shape]);
      await shot(`${tod}-grid-${shape}`);
    }
    if (only && !only.includes('twists')) continue;
    // Twists, statuses and reactions, from the player at a row of dummies.
    await ev(() => {
      window.__show.reset();
      window.__show.showCells(false);
    });
    const combos = [
      ['multishot-split', { shape: 'bolt', essences: ['fire'], twists: ['multishot', 'split'] }, 160],
      ['chain', { shape: 'bolt', essences: ['storm', 'iron'], twists: ['chain'] }, 230],
      ['homing-spiral', { shape: 'bolt', essences: ['light', 'dark'], twists: ['homing', 'spiral'] }, 260],
      ['echo-volley', { shape: 'bolt', essences: ['dark', 'fire'], twists: ['echo', 'volley'] }, 420],
      ['orbit', { shape: 'orb', essences: ['frost'], twists: ['orbit'] }, 500],
      ['leech', { shape: 'bolt', essences: ['nature', 'poison'], twists: ['leech', 'multishot'] }, 300],
      ['pierce-bounce', { shape: 'bolt', essences: ['iron'], twists: ['pierce', 'bounce', 'swift'] }, 160],
      ['linger-burst', { shape: 'throw', essences: ['poison', 'fire'], twists: ['linger', 'burst'] }, 1200],
      ['big', { shape: 'bolt', essences: ['water', 'frost'], twists: ['big'] }, 200],
      ['beam-storm-split', { shape: 'beam', essences: ['storm'], twists: ['split', 'multishot'] }, 450],
      ['nova-fire-dark', { shape: 'nova', essences: ['fire', 'dark'], twists: ['big'] }, 180],
      ['nova-fire-light', { shape: 'nova', essences: ['fire', 'light'], twists: ['big'] }, 180],
      ['rain-storm', { shape: 'rain', essences: ['storm'], twists: [] }, 600],
      ['strike-earth', { shape: 'strike', essences: ['earth'], twists: [] }, 80],
      ['summon-trio', { shape: 'summon', essences: ['fire', 'dark'], twists: ['multishot'] }, 900],
    ];
    for (const [name, weave, ms] of combos) {
      if (only && !only.includes('twists')) break;
      await ev(() => window.__show.reset());
      await wait(60);
      if (weave.shape === 'beam') {
        await ev((w) => window.__show.hold(w), weave);
        await wait(ms);
        await shot(`${tod}-twist-${name}`);
        await ev(() => window.__show.release());
        continue;
      }
      if (name === 'leech') await ev(() => (window.__game.player.hp = Math.round(window.__game.player.maxHp * 0.4)));
      await ev((w) => window.__show.player(w), weave);
      await wait(ms);
      await shot(`${tod}-twist-${name}`);
    }
    // A charge building on the caster.
    await ev(() => window.__show.reset());
    await ev(() => window.__show.hold({ shape: 'bolt', essences: ['light', 'fire'], twists: ['charge'] }));
    await wait(1250);
    await shot(`${tod}-twist-charge`);
    await ev(() => window.__show.release());
    await wait(150);
    await shot(`${tod}-twist-charge-release`);
    // A dash with its afterimages.
    await ev(() => window.__show.reset());
    await ev(() => window.__show.player({ shape: 'dash', essences: ['frost'], twists: [] }, { x: window.__game.player.x + 70, y: window.__game.player.y }));
    await wait(90);
    await shot(`${tod}-twist-dash`);
    await ev(() => {
      const g = window.__game;
      g.player.x -= 70;
    });
    // Every status on the row of dummies.
    await ev(() => window.__show.reset());
    await ev(() => {
      const g = window.__game;
      const S = window.__show;
      const st = [['burning'], ['soaked'], ['frozen'], ['shocked'], ['poisoned'], ['rooted'], ['dazzled'], ['drained'], ['stunned'], ['charmed'], ['slowed'], ['sundered'], ['blinded'], ['chilled'], ['knocked']];
      const extra = [];
      for (let i = 0; i < st.length; i++) {
        let d = S.dummies[i];
        if (!d) {
          const proto = S.dummies[i % 5];
          d = new proto.constructor(g, i % 2 ? 'wolf' : 'slime', { x: g.camera.x + g.camera.vw * (0.1 + 0.2 * (i % 5)), y: g.player.y - 60 + Math.floor(i / 5) * 40 });
          d.maxHp = d.hp = 1e7;
          d.controller = null;
          g.entities.add(d);
          extra.push(d);
        } else {
          d.x = g.camera.x + g.camera.vw * (0.1 + 0.2 * (i % 5));
          d.y = g.player.y - 60 + Math.floor(i / 5) * 40;
        }
        for (const id of st[i]) g.magic.applyStatus(d, id, { src: g.player, potency: 1.2, power: 6, duration: 30, ignoreImmunity: true, chance: 99 });
      }
      S.extra = extra;
    });
    await wait(900);
    await shot(`${tod}-statuses`);
    await ev(() => {
      const g = window.__game;
      const S = window.__show;
      for (const d of S.extra || []) g.entities.remove(d);
      S.extra = [];
      S.dummies.forEach((d, i) => {
        const at = S.dummySpot(i);
        d.x = at.x;
        d.y = at.y;
      });
    });
    // Reactions: set up what each dummy carries, then touch it with the other.
    const reactions = [
      ['soaked', { shape: 'bolt', essences: ['storm'] }],
      ['soaked', { shape: 'bolt', essences: ['frost'] }],
      ['burning', { shape: 'bolt', essences: ['wind'] }],
      ['soaked', { shape: 'bolt', essences: ['fire'] }],
      ['dazzled', { shape: 'bolt', essences: ['dark'] }],
    ];
    for (let i = 0; i < reactions.length; i++) {
      const [st, weave] = reactions[i];
      await ev(() => window.__show.reset());
      await ev(
        ([s, w, k]) => {
          const g = window.__game;
          const d = window.__show.dummies[2];
          g.magic.applyStatus(d, s, { src: g.player, power: 8, duration: 10, ignoreImmunity: true });
          g.magic.cast(g.player, w, { x: d.x, y: d.y, target: d }, { free: true });
          window.__show.k = k;
        },
        [st, weave, i],
      );
      await wait(330);
      await shot(`${tod}-reaction-${i}-${st}-${weave.essences[0]}`);
    }
  }
}

// ------------------------------------------------------------------ performance
if (perfOnly || flag('--with-perf')) {
  // Throttled only for the measurement, so loading and setting up stay quick.
  if (throttle > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await ev(() => {
    window.__show.reset();
    window.__show.showCells(true);
    window.__show.time(22.5);
  });
  await wait(300);
  const result = await page.evaluate(async () => {
    const g = window.__game;
    const S = window.__show;
    const m = g.magic;
    const shapes = ['bolt', 'blast', 'throw', 'nova', 'orb', 'rain', 'beam', 'wall', 'rune', 'summon', 'strike'];
    const twists = ['multishot', 'split', 'chain', 'echo', 'volley', 'burst', 'linger', 'spiral', 'homing', 'bounce', 'big'];
    let k = 0;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const timer = setInterval(() => {
      for (let i = 0; i < 6; i++) {
        const cell = S.cells[k++ % S.cells.length];
        const w = { shape: pick(shapes), essences: [cell.ess, pick(S.ESS)], twists: [pick(twists), pick(twists)] };
        const plan = m.compile(w);
        if (!plan.ok) continue;
        const aim = { x: cell.d.x, y: cell.d.y };
        if (plan.input === 'hold') {
          m.castStart(cell.c, plan, aim, { free: true });
          setTimeout(() => m.castRelease(cell.c), 400);
        } else m.cast(cell.c, plan, aim, { free: true });
      }
    }, 220);
    await new Promise((r) => setTimeout(r, 2500));
    const frames = [];
    let peak = 0;
    let parts = 0;
    let bodies = 0;
    let samples = 0;
    let last = performance.now();
    await new Promise((resolve) => {
      const t0 = performance.now();
      function tick(now) {
        frames.push(now - last);
        last = now;
        peak = Math.max(peak, m.bodies.length);
        bodies += m.bodies.length;
        parts += g.magicFx?.parts?.count || 0;
        samples++;
        if (now - t0 < 6000) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    clearInterval(timer);
    frames.shift();
    const sorted = [...frames].sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return {
      frames: frames.length,
      avgMs: +avg.toFixed(2),
      fps: +(1000 / avg).toFixed(1),
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      worst: +sorted[sorted.length - 1].toFixed(2),
      avgBodies: Math.round(bodies / samples),
      peakBodies: peak,
      avgParticles: Math.round(parts / samples),
      loopFps: g.loop?.fps,
      pixelFx: g.pixelFx ? { live: g.pixelFx.count, cap: g.pixelFx.cap } : null,
    };
  });
  console.log(`[perf ${tag}${throttle > 1 ? ` cpu/${throttle}` : ''}]`, JSON.stringify(result));
  await shot('perf-night');
}

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`screenshots in ${out}/`);
