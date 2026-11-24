// Bind and ward (DESIGN §22.5) on screen: every essence's bind holding a foe and every
// essence's ward on a bearer under fire, by day and by night, then close-ups (Lyra warded,
// a song ward over friends, the orbit twist's small shields, a light ward turning arrows
// back, a multishot bind, a boss held and resisting).
//
//   node scripts/ward_bind_shots.mjs [--src] [--size 844x390] [--day|--night] [--out dir]
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
const out = opt('--out', 'screenshots/wardbind');
const times = flag('--day') ? ['day'] : flag('--night') ? ['night'] : ['day', 'night'];
const tag = `${W}x${H}`;

await mkdir(out, { recursive: true });
const server = await startServer(0);
const port = server.address().port;
const url = `http://localhost:${port}/${flag('--src') ? 'index.html' : 'dist/index.html'}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
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

await page.evaluate(() => {
  const g = window.__game;
  const T = 16;
  const ESS = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'wind', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
  const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
  const Creature = proto.constructor;
  const Actor = Object.getPrototypeOf(Creature.prototype).constructor;
  const S = (window.__wb = { ESS, cells: [] });
  const map = g.map;
  const GRASSY = new Set([1, 7]);
  const cam = g.camera;
  const vw = Math.ceil(cam.vw / T);
  const vh = Math.ceil(cam.vh / T);
  const p = g.player;
  let spot = null;
  let best = Infinity;
  for (let ty = 2; ty < map.h - vh - 2; ty += 2) {
    for (let tx = 2; tx < map.w - vw - 2; tx += 2) {
      let bad = 0;
      for (let y = ty; y < ty + vh && bad < best; y++) for (let x = tx; x < tx + vw; x++) if (!GRASSY.has(map.tileAt(x, y)) || g.objects.objectsAt(x, y)) bad++;
      if (bad < best) {
        best = bad;
        spot = { x: tx * T, y: ty * T };
      }
    }
  }
  S.spot = spot;
  for (const e of g.entities.all()) if (e.species && Math.hypot(e.x - (spot.x + cam.vw / 2), e.y - (spot.y + cam.vh / 2)) < 700) g.entities.remove(e);
  p.x = spot.x + cam.vw / 2;
  p.y = spot.y + cam.vh / 2 + 10;
  p.invuln = 0;
  p.maxHp = p.hp = 1e6;
  g.camera.follow({ x: p.x, y: p.y, removed: false });
  g.camera.snap();
  g.magic.unlockAll();
  const lyra = g.companion;
  const park = () => {
    if (!lyra) return;
    lyra.x = spot.x - 420;
    lyra.y = spot.y - 300;
  };
  park();

  function foe(x, y, species = 'slime') {
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
  // A stand-in friend for a ward: the stranger's own look, on the player's side.
  function friend(x, y) {
    const a = new Actor(g, { id: `wb_friend_${S.cells.length}_${Math.round(x)}`, name: 'Friend', faction: 'player', x, y, maxHp: 1e7, spriteKey: 'player' });
    a.hp = a.maxHp = 1e7;
    a.dir = 'down';
    g.entities.add(a);
    return a;
  }
  function hiddenCaster(x, y, faction = 'player') {
    const c = new Creature(g, 'chicken', { x, y });
    c.faction = faction;
    c.controller = null;
    c.hidden = true;
    c.solid = false;
    c.invuln = 1e9;
    c.maxHp = c.hp = 1e7;
    c.facing = { x: 1, y: 0 };
    g.entities.add(c);
    return c;
  }
  const cols = 5;
  const rows = 3;
  const cw = cam.vw / cols;
  const ch = (cam.vh - 20) / rows;
  for (let i = 0; i < ESS.length; i++) {
    const cx = spot.x + (i % cols) * cw;
    const cy = spot.y + 26 + Math.floor(i / cols) * ch;
    const c = hiddenCaster(cx + cw * 0.2, cy + ch * 0.5);
    const d = foe(cx + cw * 0.72, cy + ch * 0.5, i % 2 ? 'wolf' : 'slime');
    const f = friend(cx + cw * 0.3, cy + ch * 0.55);
    const archer = hiddenCaster(cx + cw * 0.95, cy + ch * 0.4, 'bandit');
    S.cells.push({ c, d, f, archer, ess: ESS[i] });
  }
  S.show = (what) => {
    for (const cell of S.cells) {
      for (const [k, on] of [
        ['d', what === 'bind'],
        ['f', what === 'ward'],
        ['c', true],
        ['archer', what === 'ward'],
      ]) {
        const e = cell[k];
        e.removed = !on;
        if (on && !g.entities.all().includes(e)) g.entities.add(e);
      }
    }
  };
  S.reset = () => {
    const m = g.magic;
    park();
    for (const b of m.bodies) if (b.active) m.end(b, 'dismiss');
    m.pending.length = 0;
    m.decals.length = 0;
    for (const e of g.entities.all()) {
      if (e.type === 'projectile') g.entities.remove(e);
      if (e.type !== 'actor') continue;
      m.status.clear(e);
      e.statusImmune = null;
      e._bindDR = null;
      if (e.maxHp >= 1e6) e.hp = e.maxHp;
    }
    g.magicFx?.parts?.clear?.();
    g.magicFx?.effects?.clear?.();
    g.bubbles?.clearAll?.();
    m.mana.cur = m.mana.max;
    m.cooldowns.fill(0);
  };
  S.bindGrid = (twists = []) => {
    for (const cell of S.cells) g.magic.cast(cell.c, { shape: 'bind', essences: [cell.ess], twists }, { x: cell.d.x, y: cell.d.y, target: cell.d }, { free: true });
  };
  S.wardGrid = (twists = []) => {
    for (const cell of S.cells) g.magic.cast(cell.c, { shape: 'ward', essences: [cell.ess], twists }, { x: cell.f.x, y: cell.f.y - 6, target: cell.f }, { free: true });
  };
  S.volley = () => {
    for (const cell of S.cells) {
      cell.archer._shotReadyAt = 0;
      g.combat.shoot(cell.archer, cell.f.x, cell.f.y - 6, 'arrow', { target: cell.f, damageMul: 1 });
    }
  };
  S.time = (h) => {
    g.clock.skipTo(h);
    g.clock.setWeather?.('clear');
  };
  S.foe = foe;
  S.friend = friend;
  S.hiddenCaster = hiddenCaster;
  const ui = document.getElementById('ui-root');
  if (ui) ui.style.visibility = 'hidden';
});

const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);

for (const tod of times) {
  await ev((h) => window.__wb.time(h), tod === 'day' ? 13 : 22.5);
  await wait(300);
  // Every essence's bind, closing and then holding.
  await ev(() => window.__wb.show('bind'));
  await ev(() => window.__wb.reset());
  await wait(60);
  await ev(() => window.__wb.bindGrid());
  await wait(560);
  await shot(`${tod}-bind-closing`);
  await wait(900);
  await shot(`${tod}-bind-holding`);
  // Every essence's ward, with arrows coming in.
  await ev(() => window.__wb.show('ward'));
  await ev(() => window.__wb.reset());
  await wait(60);
  await ev(() => window.__wb.wardGrid());
  await wait(500);
  await shot(`${tod}-ward-up`);
  await ev(() => window.__wb.volley());
  await wait(260);
  await shot(`${tod}-ward-struck`);
  await wait(500);
  // Close-ups around the player.
  await ev(() => {
    window.__wb.reset();
    window.__wb.show('none');
  });
  const close = await ev(() => {
    const g = window.__game;
    const S = window.__wb;
    const p = g.player;
    const portrait = g.camera.vw < g.camera.vh;
    const at = (dx, dy) => (portrait ? { x: p.x + dy * 0.5, y: p.y + dx } : { x: p.x + dx, y: p.y + dy });
    S.lyraSpot = at(-30, 0);
    S.foes = [at(60, -30), at(70, 0), at(60, 30), at(95, -14), at(95, 16)].map((q, i) => S.foe(q.x, q.y, i % 2 ? 'wolf' : 'bandit'));
    S.archers = [at(120, -40), at(125, 40)].map((q) => S.hiddenCaster(q.x, q.y, 'bandit'));
    return portrait;
  });
  void close;
  const scenes = [
    ['lyra-ward-light', () => {
      const g = window.__game;
      const S = window.__wb;
      const l = g.companion;
      l.x = S.lyraSpot.x;
      l.y = S.lyraSpot.y;
      g.magic.cast(g.player, { shape: 'ward', essences: ['light'], twists: [] }, { x: l.x, y: l.y - 6, target: l }, { free: true });
      setTimeout(() => {
        for (const a of S.archers) {
          a._shotReadyAt = 0;
          g.combat.shoot(a, l.x, l.y - 6, 'arrow', { target: l });
        }
      }, 300);
    }, 720],
    ['song-ward-shared', () => {
      const g = window.__game;
      const S = window.__wb;
      const l = g.companion;
      l.x = S.lyraSpot.x;
      l.y = S.lyraSpot.y;
      g.magic.cast(g.player, { shape: 'ward', essences: ['song', 'water'], twists: ['big'] }, null, { free: true });
    }, 600],
    ['ward-orbit-iron', () => {
      const g = window.__game;
      g.magic.cast(g.player, { shape: 'ward', essences: ['iron'], twists: ['orbit'] }, null, { free: true });
    }, 700],
    ['ward-storm-break', () => {
      const g = window.__game;
      g.magic.cast(g.player, { shape: 'ward', essences: ['storm'], twists: ['burst'] }, null, { free: true });
      setTimeout(() => {
        const w = g.magic.wardOn(g.player);
        if (w) w.shield = 1;
        const f = window.__wb.foes[1];
        g.player.invuln = 0;
        g.combat.damage(f, g.player, 30, { kind: 'melee' });
      }, 400);
    }, 520],
    ['bind-multishot-fire', () => {
      const g = window.__game;
      const S = window.__wb;
      g.magic.cast(g.player, { shape: 'bind', essences: ['fire'], twists: ['multishot'] }, { x: S.foes[1].x, y: S.foes[1].y, target: S.foes[1] }, { free: true });
    }, 900],
    ['bind-nature-dark-burst', () => {
      const g = window.__game;
      const S = window.__wb;
      g.magic.cast(g.player, { shape: 'bind', essences: ['nature', 'dark'], twists: ['burst'] }, { x: S.foes[1].x, y: S.foes[1].y, target: S.foes[1] }, { free: true });
    }, 1100],
    ['bind-frost-flight', () => {
      const g = window.__game;
      const S = window.__wb;
      g.magic.cast(g.player, { shape: 'bind', essences: ['frost'], twists: ['spiral'] }, { x: S.foes[3].x, y: S.foes[3].y, target: S.foes[3] }, { free: true });
    }, 160],
  ];
  for (const [name, fn, ms] of scenes) {
    await ev(() => window.__wb.reset());
    await wait(60);
    await ev(fn);
    await wait(ms);
    await shot(`${tod}-close-${name}`);
  }
  await ev(() => {
    const g = window.__game;
    const S = window.__wb;
    for (const e of [...S.foes, ...S.archers]) g.entities.remove(e);
  });
}

const counts = await ev(() => ({ bodies: window.__game.magic.bodies.length }));
console.log(`[wardbind] ${tag}: done, ${counts.bodies} bodies left`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
await browser.close();
server.close();
