// Browser check of combat in a world with walls (DESIGN §31), played the way the author
// plays: by touch on a phone held sideways (844x390) and upright (390x844), and on a desktop
// (1280x720) with keys and the mouse. Each scene:
//   dummy   the sword at the training dummy: a number for every hit, training XP; a bolt's number
//   tree    a Strike fells a tree: it goes over, a stump and logs to pick up
//   fence   a Strike breaks a fence into debris: walkable, saved
//   walls   three sword swings and a strike at a wolf just behind a wall: no hit
//   beam    a held beam pins a fleeing deer (it crawls while the ray is on it)
//   chapel  at night the chapel's roof stays dark from outside (the old rule lit it), and
//           the altar shines once you are inside
// Fails (exit 1) on a page error or a failed scene.
//   npm run build && node scripts/world_check.mjs [scene,scene] [--out DIR]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/world';
await mkdir(OUT, { recursive: true });
const only = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') || '';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { name: 'side', w: 844, h: 390, phone: true },
  { name: 'up', w: 390, h: 844, phone: true },
  { name: 'desk', w: 1280, h: 720, phone: false },
];

const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const results = [];
const note = (size, scene, ok, detail) => {
  results.push({ size, scene, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${size} ${scene} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

async function open(size) {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: size.phone,
    hasTouch: size.phone,
    ...(size.phone ? { userAgent: UA } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.clock.skipTo?.(11);
    const m = g.magic;
    const give = { shape: ['bolt', 'strike', 'beam', 'throw', 'nova'], essence: ['fire', 'earth', 'storm'] };
    for (const [k, ids] of Object.entries(give)) for (const id of ids) m.unlock(k, id, 'test');
    while (m.slotCount < 4) m.unlockSlot();
    m.setSlot(0, { shape: 'strike', essences: ['earth'], twists: [] });
    m.setSlot(1, { shape: 'bolt', essences: ['fire'], twists: [] });
    m.setSlot(2, { shape: 'beam', essences: ['storm'], twists: [] });
    m.setSlot(3, { shape: 'throw', essences: ['fire'], twists: [] });
    m.mana.max = Math.max(m.mana.max, 200);
    m.mana.cur = m.mana.max;
    window.__toCss = (x, y) => {
      const r = g.renderer;
      return { x: ((x - r.viewX) * r.scale) / r.dpr, y: ((y - r.viewY) * r.scale) / r.dpr };
    };
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    // Put the player at a tile centre (feet a few px into the tile), facing a way.
    window.__place = (tx, ty, face) => {
      const p = g.player;
      p.x = tx * 16 + 8;
      p.y = ty * 16 + 10;
      p.vel && ((p.vel.x = 0), (p.vel.y = 0));
      if (face) p.faceDir(face);
      const l = g.companion;
      if (l) {
        l.x = p.x - 60;
        l.y = p.y + 30;
      }
      g.camera.follow?.(p);
      g.camera.snap?.();
    };
    window.__clean();
  });
  return { context, page, errors };
}

async function touchTap(page, cdp, sel, holdMs = 60) {
  const c = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel);
  if (!c) throw new Error(`no ${sel}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 7 }] });
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// The sword: the attack button by touch, Space on a desktop.
async function swing(page, cdp, size) {
  if (size.phone) await touchTap(page, cdp, '.tbtn-attack', 50);
  else await page.keyboard.press('Space');
}

// A weave slot: tap its button by touch (aims straight ahead / at a foe), or on a desktop put
// the mouse on the target and press its number key.
async function weave(page, cdp, size, slot, at, holdMs = 60) {
  if (size.phone) {
    await touchTap(page, cdp, `.tcluster .wbtn[data-slot="${slot}"]`, holdMs);
  } else {
    const c = await page.evaluate(([x, y]) => window.__toCss(x, y), [at.x, at.y]);
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(40);
    await page.keyboard.down(`Digit${slot + 1}`);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(`Digit${slot + 1}`);
  }
}

// ------------------------------------------------------------------ scenes

async function dummy(size, page, cdp) {
  const s0 = await page.evaluate(() => {
    const g = window.__game;
    const d = g.objects.all().find((o) => o.objType === 'dummy');
    window.__dummy = d;
    window.__place(d.tx, d.ty + 1, 'up');
    window.__clean();
    const p = g.player;
    return { level: p.level, xp: p.xp, d: [d.tx, d.ty] };
  });
  const nums = [];
  await page.evaluate(() => {
    const g = window.__game;
    window.__nums = [];
    const orig = g.bubbles.number.bind(g.bubbles);
    g.bubbles.number = (x, y, text, ...rest) => {
      window.__nums.push(String(text));
      return orig(x, y, text, ...rest);
    };
  });
  for (let i = 0; i < 5; i++) {
    await swing(page, cdp, size);
    await page.waitForTimeout(i === 2 ? 90 : 300);
    if (i === 2) await page.screenshot({ path: `${OUT}/${size.name}-dummy-sword.png` });
  }
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const g = window.__game;
    return { level: g.player.level, xp: g.player.xp, nums: window.__nums.slice(), given: window.__dummy.state.xpGiven || 0 };
  });
  nums.push(...r.nums);
  const dmg = r.nums.filter((n) => /^\d+!?$/.test(n)).length;
  const xps = r.nums.filter((n) => /xp$/.test(n)).length;
  note(size.name, 'dummy: sword hits show numbers', dmg >= 4, { dmg, nums: r.nums.slice(0, 12) });
  note(size.name, 'dummy: training XP', r.given >= 4 && xps >= 1, { given: r.given, xp: [s0.xp, r.xp], level: [s0.level, r.level] });
  // A bolt at it.
  await page.evaluate(() => {
    window.__nums.length = 0;
    window.__game.magic.resetCooldowns();
  });
  const at = await page.evaluate(() => ({ x: window.__dummy.x, y: window.__dummy.y - 8 }));
  await weave(page, cdp, size, 1, at);
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}/${size.name}-dummy-bolt.png` });
  const b = await page.evaluate(() => window.__nums.slice());
  note(size.name, 'dummy: a bolt shows its number', b.some((n) => /^\d+!?$/.test(n)), b);
}

async function tree(size, page, cdp) {
  const t = await page.evaluate(() => {
    const g = window.__game;
    const p0 = g.objects.all().find((o) => o.objType === 'dummy');
    // A standing tree with open ground south of it, near the guardhouse.
    const open = (tx, ty) => !g.isBlockedTile(tx, ty, g.player) && !g.map.blocksProjectile(tx, ty);
    const trees = g.objects.all().filter((o) => o.objType === 'tree' && !o.state.depleted && open(o.tx, o.ty + 1) && open(o.tx, o.ty + 2) && open(o.tx - 1, o.ty + 1) && open(o.tx + 1, o.ty + 1));
    trees.sort((a, b) => Math.hypot(a.x - p0.x, a.y - p0.y) - Math.hypot(b.x - p0.x, b.y - p0.y));
    const tr = trees[0];
    window.__tree = tr;
    window.__place(tr.tx, tr.ty + 1, 'up');
    g.player.y = tr.y + 9;
    window.__clean();
    g.magic.resetCooldowns();
    return { tx: tr.tx, ty: tr.ty, kind: tr.kind, wood: g.player.inventory.count?.('wood') ?? 0 };
  });
  const at = await page.evaluate(() => ({ x: window.__tree.x, y: window.__tree.y - 8 }));
  await weave(page, cdp, size, 0, at);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${size.name}-tree-falling.png` });
  const mid = await page.evaluate(() => ({ depleted: window.__tree.state.depleted, falling: !!window.__tree._fall }));
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    // Step back so the logs lie where they fell for the picture.
    window.__game.player.x -= 40;
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${size.name}-tree-felled.png` });
  const after = await page.evaluate(() => {
    const g = window.__game;
    const logs = g.entities.all().filter((e) => e.type === 'pickup' && !e.removed && e.itemId === 'wood').length + (g.player.inventory.count?.('wood') ?? 0);
    return { depleted: window.__tree.state.depleted, logs };
  });
  note(size.name, 'Strike fells a tree', mid.depleted && after.depleted && after.logs >= 2, { tree: t, mid, after });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${size.name}-tree-stump-logs.png` });
  // Walk over the logs: picked up.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const log = g.entities.all().find((e) => e.type === 'pickup' && !e.removed && e.itemId === 'wood');
      if (!log) return;
      g.player.x = log.x;
      g.player.y = log.y + 2;
    });
    await page.waitForTimeout(500);
  }
  const got = await page.evaluate(() => window.__game.player.inventory.count?.('wood') ?? 0);
  note(size.name, 'the logs can be picked up', got > t.wood, { before: t.wood, after: got });
}

async function fence(size, page, cdp) {
  const f = await page.evaluate(() => {
    const g = window.__game;
    const open = (tx, ty) => !g.isBlockedTile(tx, ty, g.player) && !g.map.blocksProjectile(tx, ty);
    const fences = g.objects.all().filter((o) => o.objType === 'fence' && !o.state.broken && open(o.tx, o.ty + 1));
    const p = g.player;
    fences.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    const fe = fences[0];
    window.__fence = fe;
    window.__place(fe.tx, fe.ty + 1, 'up');
    g.player.y = fe.y + 9;
    g.magic.resetCooldowns();
    window.__clean();
    return { tx: fe.tx, ty: fe.ty, sprite: fe.sprite };
  });
  const at = await page.evaluate(() => ({ x: window.__fence.x, y: window.__fence.y - 8 }));
  await weave(page, cdp, size, 0, at);
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${OUT}/${size.name}-fence-dust.png` });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${size.name}-fence-debris.png` });
  const r = await page.evaluate(() => {
    const g = window.__game;
    const fe = window.__fence;
    return { broken: !!fe.state.broken, blocks: g.objects.isBlockingTile(fe.tx, fe.ty), saved: JSON.stringify(g.objects.serialize()).includes(`"${fe.id}"`) };
  });
  note(size.name, 'Strike breaks a fence into debris', r.broken && !r.blocks && r.saved, { f, r });
}

async function walls(size, page, cdp) {
  const r0 = await page.evaluate(() => {
    const g = window.__game;
    const b = g.map.buildings.find((x) => x.id === 'general_store');
    // A wall tile on its west side, mid-height; the player just outside, a wolf just inside.
    const ty = b.y + 3;
    const wallX = b.x * 16;
    const p = g.player;
    window.__place(b.x - 1, ty, 'right');
    p.x = wallX - 5;
    p.y = ty * 16 + 10;
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const Creature = proto.constructor;
    const w = new Creature(g, 'wolf', { x: wallX + 16 + 5, y: p.y });
    w.controller = null;
    w.speed = 0;
    w.aggroRadius = 0;
    w.maxHp = w.hp = 80;
    g.entities.add(w);
    window.__wolf = w;
    // Only the stranger's blows count here: since round 14b Garrick takes on a beast in his
    // store (a defender), and his blows are his, from inside.
    window.__wolfByPlayer = 0;
    g.bus.on('damage', (ev) => {
      const src = ev?.source;
      const own = src === p || src?.owner === p || src?.caster === p;
      if (ev?.target === w && own && ev.amount > 0) window.__wolfByPlayer += ev.amount;
    });
    g.camera.snap?.();
    window.__clean();
    return { dist: Math.round(Math.hypot(w.x - p.x, w.y - p.y)), wall: g.map.blocksProjectile(b.x, ty) };
  });
  for (let i = 0; i < 3; i++) {
    await swing(page, cdp, size);
    await page.waitForTimeout(320);
  }
  await page.evaluate(() => window.__game.magic.resetCooldowns());
  const at = await page.evaluate(() => ({ x: window.__wolf.x, y: window.__wolf.y - 6 }));
  await weave(page, cdp, size, 0, at); // a strike into the wall
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${size.name}-wall-swing.png` });
  const r = await page.evaluate(() => ({ hp: window.__wolf.hp, max: window.__wolf.maxHp, byPlayer: window.__wolfByPlayer }));
  note(size.name, 'no hit through a wall (sword x3 + strike)', r.byPlayer === 0, { ...r0, ...r });
  await page.evaluate(() => window.__game.entities.remove(window.__wolf));
}

async function beam(size, page, cdp) {
  const r0 = await page.evaluate(() => {
    const g = window.__game;
    const sq = g.locations.get('town_square')?.center || g.player;
    // An open stretch east of the square.
    const open = (x, y) => !g.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), g.player);
    let spot = null;
    for (let r = 0; r < 30 && !spot; r++)
      for (let k = 0; k < 16 && !spot; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = sq.x + Math.cos(a) * r * 16;
        const y = sq.y + Math.sin(a) * r * 16;
        let ok = true;
        for (let d = -10; d <= 150; d += 6) if (!open(x + d, y) || !open(x + d, y - 6)) ok = false;
        if (ok) spot = { x, y };
      }
    spot = spot || sq;
    const p = g.player;
    p.x = spot.x;
    p.y = spot.y;
    p.faceDir('right');
    if (g.companion) {
      g.companion.x = p.x - 80;
      g.companion.y = p.y + 40;
    }
    const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
    const Creature = proto.constructor;
    const w = new Creature(g, 'deer', { x: p.x + 50, y: p.y });
    w.maxHp = w.hp = 400;
    g.entities.add(w);
    window.__deer = w;
    // It bolts away from the player (provoked to flee).
    w.provokedBy = p;
    w.provokedAt = g.clock.t;
    w.provokedMode = 'flee';
    g.camera.follow?.(p);
    g.camera.snap?.();
    g.magic.resetCooldowns();
    window.__clean();
    return { x0: w.x };
  });
  // A sampler in the page: where the deer is every 50 ms and whether a ray holds it.
  const sample = () =>
    page.evaluate(() => {
      const g = window.__game;
      const d = window.__deer;
      window.__samp = [];
      clearInterval(window.__sampT);
      window.__sampT = setInterval(() => window.__samp.push({ x: d.x, y: d.y, t: g.clock.t, pin: !!g.magic.status.has(d, 'pinned') }), 50);
    });
  // Its speed (px per game second) over the samples that are (or are not) pinned.
  const speed = (pinned) =>
    page.evaluate((want) => {
      clearInterval(window.__sampT);
      const s = window.__samp;
      let dist = 0;
      let time = 0;
      for (let i = 1; i < s.length; i++) {
        if (s[i].pin !== want || s[i - 1].pin !== want) continue;
        dist += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
        time += s[i].t - s[i - 1].t;
      }
      return { v: time > 0 ? dist / time : 0, time };
    }, pinned);
  // Free: how fast it runs from you.
  await sample();
  await page.waitForTimeout(1000);
  const free = await speed(false);
  // Back, and a held beam on it.
  await page.evaluate(() => {
    const g = window.__game;
    window.__deer.x = g.player.x + 50;
    window.__deer.y = g.player.y;
    window.__deer.provokedAt = g.clock.t;
  });
  await sample();
  let pinned = false;
  if (size.phone) {
    const c = await page.evaluate(() => {
      const b = document.querySelector('.tcluster .wbtn[data-slot="2"]').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 9 }] });
    await page.waitForTimeout(500);
    pinned = await page.evaluate(() => !!window.__game.magic.status.has(window.__deer, 'pinned'));
    await page.screenshot({ path: `${OUT}/${size.name}-beam-pin.png` });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    // Keep the mouse on the deer, the way a player tracks it with the ray.
    const follow = async () => {
      const c = await page.evaluate(() => window.__toCss(window.__deer.x, window.__deer.y - 6));
      await page.mouse.move(c.x, c.y);
    };
    await follow();
    await page.keyboard.down('Digit3');
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(50);
      await follow();
    }
    pinned = await page.evaluate(() => !!window.__game.magic.status.has(window.__deer, 'pinned'));
    await page.screenshot({ path: `${OUT}/${size.name}-beam-pin.png` });
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(50);
      await follow();
    }
    await page.keyboard.up('Digit3');
  }
  const held = await speed(true);
  const v = (x) => Math.round(x.v);
  note(size.name, 'a beam pins a fleeing deer', pinned && held.time > 0.3 && held.v < free.v * 0.5, { free: v(free), pinned: v(held), pinnedFor: Math.round(held.time * 10) / 10 });
  await page.evaluate(() => window.__game.entities.remove(window.__deer));
}

async function chapel(size, page) {
  const lum = async () =>
    page.evaluate(() => {
      const g = window.__game;
      const b = g.map.buildings.find((x) => x.id === 'chapel');
      // The roof over the altar (the back third of the building), on screen.
      const a = window.__toCss((b.x + 3) * 16, (b.y + 0.5) * 16);
      const z = window.__toCss((b.x + b.w - 3) * 16, (b.y + 3.5) * 16);
      const c = g.canvas;
      const k = c.width / c.clientWidth;
      const ctx = c.getContext('2d');
      const x0 = Math.max(0, Math.round(a.x * k));
      const y0 = Math.max(0, Math.round(a.y * k));
      const w = Math.max(1, Math.round((z.x - a.x) * k));
      const h = Math.max(1, Math.round((z.y - a.y) * k));
      const d = ctx.getImageData(x0, y0, w, h).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return Math.round((s / (d.length / 4)) * 10) / 10;
    });
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.skipTo?.(22.5);
    const b = g.map.buildings.find((x) => x.id === 'chapel');
    // Beside the chapel (east), level with the altar, its roof whole in view.
    let spot = null;
    for (let dx = 1; dx < 8 && !spot; dx++)
      for (const dy of [3, 4, 2, 5, 1, 6])
        if (!spot && !g.isBlockedTile(b.x + b.w + dx, b.y + dy, g.player)) spot = [b.x + b.w + dx, b.y + dy];
    window.__place(spot ? spot[0] : b.x + b.w + 2, spot ? spot[1] : b.y + 3, 'left');
    // Look at the roof itself (the camera a few tiles west of the player).
    g.camera.follow?.(null);
    g.camera.x = (b.x + b.w / 2) * 16 - g.camera.vw / 2;
    g.camera.y = (b.y + 3) * 16 - g.camera.vh / 2;
    window.__clean();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${size.name}-chapel-night-outside.png` });
  const out = await lum();
  // The same view with the old rule (every light shows): how much the roof glowed before.
  await page.evaluate(() => {
    const L = window.__game.lighting;
    L.__keep = L.roofSeen;
    L.roofSeen = () => 1;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${size.name}-chapel-night-outside-OLD.png` });
  const old = await lum();
  await page.evaluate(() => {
    const L = window.__game.lighting;
    L.roofSeen = L.__keep;
  });
  // Inside, by the altar.
  await page.evaluate(() => {
    const g = window.__game;
    window.__place(88, 46, 'up');
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${size.name}-chapel-night-inside.png` });
  const inside = await page.evaluate(() => {
    const g = window.__game;
    const b = g.map.buildings.find((x) => x.id === 'chapel');
    return { alpha: Math.round(b._alpha * 100) / 100, seen: g.lighting.roofSeen(88 * 16 + 8, 42 * 16 + 8) };
  });
  note(size.name, 'chapel roof dark outside at night, altar lit inside', out < old - 1 && inside.seen > 0.8, { roofLum: out, oldRoofLum: old, inside });
}

const SCENES = { dummy, tree, fence, walls, beam, chapel };

for (const size of SIZES) {
  const { context, page, errors } = await open(size);
  const cdp = size.phone ? await context.newCDPSession(page) : null;
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only && !only.split(',').includes(name)) continue;
    try {
      await fn(size, page, cdp);
    } catch (err) {
      note(size.name, name, false, `threw: ${err.message}`);
    }
  }
  if (errors.length) note(size.name, 'page errors', false, errors.slice(0, 5));
  await context.close();
}

await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `${bad.length} failed` : 'all passed');
process.exit(bad.length ? 1 : 0);
