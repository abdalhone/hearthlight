// Screenshots of the pixelfx effects in the real game (DESIGN §30): hits aimed four ways,
// crits, weave impacts per essence, the strike's punch, statuses on bodies, bind and ward,
// heals, deaths, pickups, level-ups, revival and the critters, by day and by night, at a
// phone held sideways (844x390), upright (390x844) and a desktop (1280x720). The game loop
// is stopped and stepped by hand, so each shot shows the same instant every run.
//
//   npm run build && node scripts/pixelfx_shots.mjs [--out dir] [--scenes hits,crit] [--sizes desk1280]
//   --night (night only) --day (day only) --hud (keep the HUD) --reduce (reduced motion)
//   --perf   frame times with many effects at once (desktop, then 4x CPU throttle)
// Fails (exit 1) on a page error or when a scene played no effect.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (f) => argv.includes(f);
const out = opt('--out', 'screenshots/pixelfx');
const only = opt('--scenes', '') ? opt('--scenes', '').split(',') : null;
const onlySizes = opt('--sizes', '') ? opt('--sizes', '').split(',') : null;
const times = flag('--night') ? ['night'] : flag('--day') ? ['day'] : ['day', 'night'];
const SIZES = [
  { name: 'l844x390', w: 844, h: 390, phone: true },
  { name: 'p390x844', w: 390, h: 844, phone: true },
  { name: 'desk1280', w: 1280, h: 720, phone: false },
].filter((s) => !onlySizes || onlySizes.includes(s.name));

await mkdir(out, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];

async function open(size) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: size.phone, hasTouch: size.phone });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && /pixel fx/.test(m.text())) errors.push(`console.warn: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate((reduce) => {
    if (reduce) window.__game.setSetting('reduceMotion', true);
    window.__game.newGame();
  }, flag('--reduce'));
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(setupStage, { hud: flag('--hud') });
  return { context, page, errors };
}

// ------------------------------------------------------------------ the stage (in the page)
function setupStage({ hud }) {
  const g = window.__game;
  const T = 16;
  const map = g.map;
  const cam = g.camera;
  const p = g.player;
  // An open meadow near the start: the screenful of grass with the fewest props.
  const GRASSY = new Set([1, 7]);
  const vw = Math.ceil(cam.vw / T) + 2;
  const vh = Math.ceil(cam.vh / T) + 2;
  let spot = null;
  let best = Infinity;
  const tx0 = Math.max(2, Math.floor(p.x / T) - 60);
  const ty0 = Math.max(2, Math.floor(p.y / T) - 60);
  for (let ty = ty0; ty < Math.min(map.h - vh - 2, ty0 + 120); ty += 2)
    for (let tx = tx0; tx < Math.min(map.w - vw - 2, tx0 + 120); tx += 2) {
      let bad = 0;
      for (let y = ty; y < ty + vh && bad < best; y++) for (let x = tx; x < tx + vw; x++) if (!GRASSY.has(map.tileAt(x, y)) || g.objects.objectsAt(x, y)) bad++;
      if (bad < best) {
        best = bad;
        spot = { x: (tx + vw / 2) * T, y: (ty + vh / 2) * T };
      }
    }
  spot = spot || { x: p.x, y: p.y };
  for (const e of g.entities.all()) if (e.species && Math.hypot(e.x - spot.x, e.y - spot.y) < 700) g.entities.remove(e);
  const proto = g.entities.all().find((e) => e.species && e.type === 'actor');
  const S = (window.__px = { spot, dummies: [], proto: proto?.constructor });
  if (g.companion) {
    g.companion.x = spot.x - 260;
    g.companion.y = spot.y - 200;
  }
  p.x = spot.x;
  p.y = spot.y + 6;
  p.invuln = 1e9;
  p.hp = p.maxHp;
  g.camera.follow({ x: spot.x, y: spot.y - 4, removed: false });
  g.camera.snap();
  g.magic?.unlockAll?.();
  g.clock?.setWeather?.('clear');
  if (!hud) {
    const ui = document.getElementById('ui-root');
    if (ui) ui.style.visibility = 'hidden';
  }
  g.loop.stop();
  S.dummy = (x, y, species = 'slime') => {
    const d = new S.proto(g, species, { x, y });
    d.maxHp = d.hp = 1e7;
    d.controller = null;
    d.speed = 0;
    d.xpValue = 0;
    d.drops = [];
    d.aggroRadius = 0;
    g.entities.add(d);
    S.dummies.push(d);
    return d;
  };
  S.reset = () => {
    for (const d of S.dummies) g.entities.remove(d);
    S.dummies.length = 0;
    g.pixelFx?.clear?.();
    g.magic?.clearAll?.();
    g.hitStop = 0;
    g.entities.update?.(0);
  };
  // Step the world by hand (the loop is stopped) and draw one frame.
  S.step = (sec) => {
    const n = Math.max(0, Math.round(sec * 60));
    for (let i = 0; i < n; i++) g.update(1 / 60);
    g.render(0, 1 / 60);
  };
  S.time = (h) => {
    g.clock.skipTo(h);
    g.clock.setWeather?.('clear');
    for (let i = 0; i < 30; i++) g.lighting?.update?.(1 / 30);
  };
}

// ------------------------------------------------------------------ scenes
// Each: [name, setup(page-side, returns nothing), [shot times in seconds after setup]]
const SCENES = {
  // A blade's hit spark, the blow coming from the right, below, the left and above.
  hits: {
    at: [0.03, 0.12, 0.3],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      dirs.forEach(([dx, dy], i) => {
        const d = S.dummy(c.x - 90 + i * 60, c.y - 10, i % 2 ? 'wolf' : 'slime');
        g.combat.damage(g.player, d, 3, { dirX: dx, dirY: dy, crit: false, noHitStop: true });
      });
    },
  },
  crit: {
    at: [0.03, 0.1, 0.25],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      [[1, 0], [0.7, 0.7], [0, -1]].forEach(([dx, dy], i) => {
        const d = S.dummy(c.x - 70 + i * 70, c.y - 10, 'wolf');
        g.combat.damage(g.player, d, 3, { dirX: dx, dirY: dy, crit: true, noHitStop: true });
      });
    },
  },
  // Bolts of every essence at a row of dummies.
  essences: {
    at: [0.02, 0.1, 0.25],
    untilPlayed: true,
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const ESS = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
      ESS.forEach((e, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        const d = S.dummy(c.x - 100 + col * 40, c.y - 30 + row * 60, 'slime');
        const caster = S.dummy(d.x - 34, d.y + 2, 'chicken');
        caster.hidden = true;
        caster.faction = 'player';
        caster.solid = false;
        g.magic.cast(caster, { shape: 'bolt', essences: [e], twists: [] }, { x: d.x, y: d.y, target: d }, { free: true });
      });
    },
  },
  // Every status pixelfx shows, on bandits (people-shaped) and a wolf: burning, chilled,
  // poisoned, drained (cursed), stunned, dazzled (confused); a fallen bandit bleeding; the
  // player under berserk's price (rage).
  statuses: {
    at: [0.6, 1.2],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const st = ['burning', 'chilled', 'poisoned', 'drained', 'stunned', 'dazzled'];
      st.forEach((id, i) => {
        const d = S.dummy(c.x - 100 + (i % 3) * 50 + (i >= 3 ? 25 : 0), c.y - 40 + Math.floor(i / 3) * 56, i === 4 ? 'wolf' : 'bandit');
        d.faction = 'neutral';
        d.aggroRadius = 0;
        g.magic.applyStatus(d, id, { src: g.player, potency: 1.2, power: 6, duration: 30, ignoreImmunity: true, chance: 99 });
      });
      const f = S.dummy(c.x + 90, c.y + 30, 'bandit');
      f.downed = true;
      f.setState?.('downed');
      if (g.prices) g.prices.state.berserk = { t: 30 };
    },
    after: () => {
      const g = window.__game;
      if (g.prices) g.prices.state.berserk = null;
    },
  },
  // The Strike's punch, thrown four ways (right, down, left, up) and in two essences.
  punch: {
    at: [0.03, 0.1, 0.22],
    untilPlayed: true,
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      dirs.forEach(([dx, dy], i) => {
        const d = S.dummy(c.x - 110 + i * 70, c.y - 4, 'wolf');
        const caster = S.dummy(d.x - dx * 16, d.y - dy * 16, 'chicken');
        caster.hidden = true;
        caster.faction = 'player';
        caster.solid = false;
        g.magic.cast(caster, { shape: 'strike', essences: [i % 2 ? 'fire' : 'raw'], twists: [] }, { x: d.x, y: d.y, target: d }, { free: true });
      });
    },
  },
  // Binds closing on three foes, in three essences.
  bind: {
    at: [0.15, 0.45, 1.0],
    untilPlayed: true,
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      ['dark', 'nature', 'frost'].forEach((e, i) => {
        const d = S.dummy(c.x - 80 + i * 80, c.y - 6, i === 1 ? 'bandit' : 'wolf');
        const caster = S.dummy(d.x - 40, d.y + 30, 'chicken');
        caster.hidden = true;
        caster.faction = 'player';
        caster.solid = false;
        g.magic.cast(caster, { shape: 'bind', essences: [e], twists: [] }, { x: d.x, y: d.y, target: d }, { free: true });
      });
    },
  },
  // The player's ward, struck from four sides.
  ward: {
    at: [0.03, 0.1, 0.3],
    prep: 0.6,
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const p = g.player;
      p.invuln = 0;
      g.magic.cast(p, { shape: 'ward', essences: ['light'], twists: [] }, null, { free: true });
      S.wardHits = () => {
        [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([dx, dy]) => {
          const foe = S.dummy(p.x + dx * 26, p.y + dy * 22, 'wolf');
          foe.hidden = true;
          g.combat.damage(foe, p, 2, { dirX: -dx, dirY: -dy, noHitStop: true });
        });
      };
    },
    // the hits land after the ward has formed (prep), then the shots
    afterPrep: () => window.__px.wardHits(),
    after: () => {
      window.__game.player.invuln = 1e9;
    },
  },
  // Heals: Lyra's spell, a potion, a revival in gold.
  heals: {
    at: [0.2, 0.6, 1.1],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const p = g.player;
      const lyra = g.companion;
      if (lyra) {
        lyra.x = p.x + 30;
        lyra.y = p.y - 4;
      }
      p.hp = Math.max(1, p.maxHp - 30);
      if (lyra) g.combat.castHeal(lyra, p);
      // a villager drinking a potion (combat.useItem, as anyone with a bag does)
      const v = S.dummy(c.x - 70, c.y, 'bandit');
      v.faction = 'neutral';
      v.hp = 5;
      if (!v.inventory) v.inventory = p.inventory.constructor ? new p.inventory.constructor() : null;
      v.inventory?.add?.('potion', 1);
      g.combat.useItem(v, 'potion');
      const f = S.dummy(c.x + 80, c.y, 'bandit');
      g.bus.emit('revived', { entity: f, by: p });
    },
  },
  // Deaths: four creatures go in a poof; a boss arrives in one; a boss's soul lifts out.
  deaths: {
    at: [0.25, 0.4, 0.7],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      ['slime', 'wolf', 'bandit', 'chicken'].forEach((sp, i) => {
        const d = S.dummy(c.x - 120 + i * 50, c.y - 10, sp);
        d.maxHp = d.hp = 3;
        g.combat.damage(g.player, d, 50, { dirX: 1, dirY: 0, noHitStop: true });
      });
      const b = S.dummy(c.x + 110, c.y - 10, 'bandit');
      g.bus.emit('boss_defeated', { boss: b, yielded: false });
      const a = S.dummy(c.x + 60, c.y + 50, 'wolf');
      g.bus.emit('boss_started', { boss: a });
    },
  },
  // Coins and an item picked up, a chest opened, a level gained, the kept flame lit.
  pickups: {
    at: [0.05, 0.2, 0.5],
    run: () => {
      const g = window.__game;
      const S = window.__px;
      const c = S.spot;
      const p = g.player;
      g.bus.emit('level_up', { entity: p, level: 3 });
      if (g.companion) {
        g.companion.x = c.x - 70;
        g.companion.y = c.y;
        g.bus.emit('level_up', { entity: g.companion, level: 3 });
      }
      // a coin picked up (as Pickup.collect plays it) and a chest's haul (as Chest.open does)
      g.pixelFx.play('collect', { x: c.x + 60, y: c.y, height: 5, size: 0.55, palette: undefined });
      g.pixelFx.play('collect', { x: c.x + 120, y: c.y - 6, height: 8, size: 1 });
    },
  },
  // Butterflies over the meadow by day, bats at dusk (the director's ambience).
  bats: {
    at: [0.3, 0.6],
    prep: 3,
    hour: 19.6,
    run: () => {
      const g = window.__game;
      const d = g.pixelFx.director;
      for (const c of d.critters) g.pixelFx.stop(c.handle);
      d.critters.length = 0;
      d._ambT = 0;
    },
  },
  critters: {
    at: [0.5, 1.5],
    prep: 6,
    hour: 12,
    run: () => {
      const g = window.__game;
      const d = g.pixelFx.director;
      for (const c of d.critters) g.pixelFx.stop(c.handle);
      d.critters.length = 0;
      d._ambT = 0;
    },
  },
};

const wanted = Object.keys(SCENES).filter((k) => !only || only.includes(k));

for (const size of SIZES) {
  const { context, page, errors } = await open(size);
  for (const tod of times) {
    await page.evaluate((h) => window.__px.time(h), tod === 'day' ? 11 : 22.5);
    for (const name of wanted) {
      const sc = SCENES[name];
      await page.evaluate(() => window.__px.reset());
      const before = await page.evaluate(() => window.__game.pixelFx?.stats?.played || 0);
      if (sc.hour != null) await page.evaluate((h) => window.__px.time(h), sc.hour);
      await page.evaluate(sc.run);
      let t = 0;
      if (sc.prep) {
        await page.evaluate((s) => window.__px.step(s), sc.prep);
        t = sc.prep;
      }
      if (sc.afterPrep) await page.evaluate(sc.afterPrep);
      let t0 = sc.prep || 0;
      if (sc.untilPlayed) {
        // Step until the first effect starts (a weave in flight lands), then time from there.
        t = t0 = await page.evaluate((n0) => {
          const g = window.__game;
          let k = 0;
          while ((g.pixelFx?.stats?.played || 0) <= n0 && k < 120) {
            g.update(1 / 60);
            k++;
          }
          return k / 60;
        }, before);
      }
      for (const at of sc.at) {
        const target = t0 + at;
        await page.evaluate((s) => window.__px.step(s), Math.max(1 / 60, target - t));
        t = target;
        await page.screenshot({ path: `${out}/${size.name}-${tod}-${name}-${String(Math.round(at * 1000)).padStart(4, '0')}.png` });
      }
      if (sc.after) await page.evaluate(sc.after);
      if (sc.hour != null) await page.evaluate((h) => window.__px.time(h), tod === 'day' ? 11 : 22.5);
      const after = await page.evaluate(() => window.__game.pixelFx?.stats?.played || 0);
      if (after <= before && !flag('--reduce')) failures.push(`${size.name} ${tod} ${name}: no pixelfx effect played`);
    }
  }
  if (errors.length) failures.push(`${size.name}: ${errors.slice(0, 5).join(' | ')}`);
  await context.close();
}

await browser.close();
server.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`screenshots in ${out}/`);
