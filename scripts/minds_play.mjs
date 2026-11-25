// Minds that keep their word (DESIGN §16.11–16.13, §23.1–23.2, §29.2–29.3), played in the
// built game the way the author played it: by touch on a phone sideways and upright, and
// with the mouse on a desktop. Each scene sets the moment up (the hour, the quest, who is
// where), then plays it through the real UI (tapping people in the world, typing in the
// chat, the send button) and the real world (the game runs; nothing is stepped by hand),
// and checks what the author complained about:
//
//   chapel   "come with me to the chapel" — "lets go": she leads, talks to Aveline, and
//            does not snap back to following when she gets there
//   elda     "please go to Lyra and tell her I'm sorry": Elda really goes, and Lyra hears it
//   gift     "can I have a honey cake": it changes hands
//   teach    "teach me magic" to Bram: the lesson starts (or he says when)
//   hate     Lyra afraid of you: the player walks at her; she keeps away, no moving in place
//   wall     a killing on the far side of a house: nobody inside sees it
//   witness  a killing in front of Elda, far from the watch: she runs screaming for the
//            watch, will not talk, and the watch knows only when she reaches them
//
//   node scripts/minds_play.mjs [--out DIR] [--size 844x390|390x844|1280x720]
// Build first (npm run build). Exit 1 on a failed check or a page error.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = arg('--out', 'screenshots/minds');
const ONLY = arg('--size', '');
const DEBUG = argv.includes('--debug');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: '844x390', viewport: { width: 844, height: 390 }, touch: true },
  { tag: '390x844', viewport: { width: 390, height: 844 }, touch: true },
  { tag: '1280x720', viewport: { width: 1280, height: 720 }, touch: false },
].filter((s) => !ONLY || s.tag === ONLY);

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
const log = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
};

async function play(size) {
  const ctx = await browser.newContext(size.touch ? { viewport: size.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: UA } : { viewport: size.viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|net::ERR/.test(t)) return;
    errors.push(`console.error: ${t}`);
  });
  const tag = size.tag;
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const tap = async (x, y) => {
    if (size.touch) await page.touchscreen.tap(Math.round(x), Math.round(y));
    else await page.mouse.click(Math.round(x), Math.round(y));
  };
  // Where a world point is on the screen (CSS px).
  const screenOf = (id) =>
    page.evaluate((id) => {
      const g = window.__game;
      const e = id === 'lyra' ? g.companion : g.entities.get(id);
      const c = document.querySelector('canvas');
      if (!e || !c) return null;
      const r = c.getBoundingClientRect();
      const s = r.width / g.camera.vw;
      const p = g.camera.worldToScreen(e.x, e.y - 10);
      return { x: r.left + p.x * s, y: r.top + p.y * s };
    }, id);
  const tapPerson = async (id) => {
    const p = await screenOf(id);
    if (!p) return false;
    await tap(p.x, p.y);
    await wait(350);
    return true;
  };
  const say = async (text) => {
    const f = await page.$('.chat .chat-field');
    if (!f) return false;
    await f.click();
    await f.fill(text);
    const b = await page.evaluate(() => {
      const e = document.querySelector('.chat .chat-send');
      const r = e?.getBoundingClientRect();
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (b) await tap(...b);
    await wait(900);
    return true;
  };
  const closeChat = async () => {
    const b = await page.evaluate(() => {
      const e = document.querySelector('.chat .chat-close');
      const r = e?.getBoundingClientRect();
      return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    });
    if (b) await tap(...b);
    await wait(300);
  };
  const quiet = () =>
    page.evaluate(() => {
      const u = window.__game.ui;
      u.toasts?.clear?.();
      for (const id of ['cast', 'book', 'found']) if (u.coach?.done) u.coach.done[id] = true;
      u.coach?.forced?.clear?.();
      u.coach?.stop?.();
    });
  // The player walks after someone (the game runs; we only steer the player's feet).
  const walkAfter = async (id, seconds, { gap = 36, until = null } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      const done = await page.evaluate(
        ({ id, gap, until }) => {
          const g = window.__game;
          const e = id === 'lyra' ? g.companion : g.entities.get(id);
          const p = g.player;
          if (e && p) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > gap * 3) {
              // Keep up: a step closer along the line between us.
              const k = (d - gap) / d;
              p.x += (e.x - p.x) * k;
              p.y += (e.y - p.y) * k;
            }
          }
          return until ? !!Function('g', `return (${until})`)(g) : false;
        },
        { id, gap, until },
      );
      if (done) return true;
      await wait(250);
    }
    return false;
  };

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing' || window.__game.story?.isPlaying?.(), null, { timeout: 30000 });
  await wait(800);
  await page.evaluate(() => window.__game.story?.isPlaying?.() && window.__game.story.skip?.());
  await page.waitForFunction(() => window.__game.state === 'playing' && !window.__game.story?.isPlaying?.(), null, { timeout: 30000 });
  await wait(800);
  await quiet();

  // ------------------------------------------------------------------ chapel
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.skipTo(10);
    const q = g.plugins.get('quest');
    q.advance(g.plugins.ctx, 1, 'play');
    q.settlePending(g);
    const sq = g.locations.get('town_square').center;
    g.player.x = sq.x;
    g.player.y = sq.y + 20;
    g.companion.x = sq.x + 24;
    g.companion.y = sq.y + 20;
    g.companion.behavior?.steering?.reset?.();
    const a = g.companion.mind.autonomy;
    a.lastInitiativeT = -1e9;
    a.lastSpokeT = -1e9;
    a._initiative();
  });
  await wait(700);
  await tapPerson('lyra');
  await page.waitForFunction(() => window.__game.ui.chat.isOpen(), null, { timeout: 4000 }).catch(() => null);
  check(await page.evaluate(() => window.__game.ui.chat.isOpen()), `${tag}: tapping Lyra opens the chat`);
  await say('lets go');
  await wait(800);
  await shot('01-chapel-lets-go');
  const outing = await page.evaluate(() => {
    const o = window.__game.companion.mind.autonomy.outings.current;
    return o ? { phase: o.phase, npc: o.npc, at: o.at } : null;
  });
  check(outing && outing.npc === 'aveline', `${tag}: "lets go" made it her outing (${JSON.stringify(outing)})`);
  await closeChat();
  await page.evaluate(() => {
    window.__game.timeScale = 2;
  });
  await walkAfter('lyra', 25, { until: "g.companion.mind.autonomy.outings.current?.phase !== 'go'" });
  await shot('02-chapel-arrived');
  let snapped = false;
  const t0 = Date.now();
  let talkShot = false;
  while (Date.now() - t0 < 60000) {
    const s = await page.evaluate(() => {
      const g = window.__game;
      const o = g.companion.mind.autonomy.outings.current;
      const d = g.companion.behavior.directive;
      return { phase: o?.phase, result: o?.result, follow: d.type === 'follow' && d.target === 'player' };
    });
    if (s.phase !== 'done' && s.phase !== 'go' && s.follow) snapped = true;
    if (s.phase === 'talk' && !talkShot) {
      await wait(1500);
      await shot('03-chapel-talk');
      talkShot = true;
    }
    if (s.phase === 'done') break;
    await walkAfter('lyra', 1, { gap: 40 });
  }
  const after = await page.evaluate(() => {
    const g = window.__game;
    const a = g.companion.mind.autonomy;
    return { result: a.outings.current?.result, stage: a.questStage, state: a.companionship, block: a.currentBlock()?.activity, chosen: a.currentBlock()?.chosen, dir: g.companion.behavior.directive.type };
  });
  await wait(1200);
  await shot('04-chapel-after');
  check(after.result === 'talked' && after.stage >= 2, `${tag}: she talked to Aveline about Maren (${JSON.stringify(after)})`);
  check(!snapped, `${tag}: she never snapped back to following once there`);
  log.push({ tag, scene: 'chapel', after });
  await page.evaluate(() => {
    window.__game.timeScale = 1;
  });

  // ------------------------------------------------------------------ elda: go to Lyra for me
  await page.evaluate(() => {
    const g = window.__game;
    g.clock.skipTo(11);
    const e = g.entities.get('elda');
    e.adjustOpinion?.(30, 'play');
    g.player.x = e.x + 22;
    g.player.y = e.y + 4;
    // Lyra across the village, her own day.
    const sq = g.locations.get('town_square').center;
    g.companion.x = sq.x;
    g.companion.y = sq.y;
  });
  await wait(600);
  await quiet();
  await tapPerson('elda');
  await page.waitForFunction(() => window.__game.ui.chat.isOpen() && window.__game.ui.chat.target === 'elda', null, { timeout: 4000 }).catch(() => null);
  check(await page.evaluate(() => window.__game.ui.chat.target === 'elda'), `${tag}: tapping Elda talks to her`);
  await say("please go to Lyra and tell her I'm sorry");
  await wait(1500);
  await shot('05-elda-promise');
  const c1 = await page.evaluate(() => window.__game.village.commitments.open('elda').map((c) => ({ kind: c.kind, message: c.message })));
  check(c1.some((c) => c.kind === 'tell'), `${tag}: Elda promised, and it is a real errand (${JSON.stringify(c1)})`);
  // ------------------------------------------------------------------ gift
  const cakes0 = await page.evaluate(() => window.__game.player.inventory.count('honey_cake'));
  await say('can I have a honey cake please');
  await wait(1200);
  await shot('06-elda-gift');
  const cakes1 = await page.evaluate(() => window.__game.player.inventory.count('honey_cake'));
  check(cakes1 === cakes0 + 1, `${tag}: the honey cake changed hands (${cakes0} -> ${cakes1})`);
  await closeChat();
  // Walk away and watch her go.
  await page.evaluate(() => {
    const g = window.__game;
    g.player.x += 120;
    g.timeScale = 2;
  });
  const kept = await walkAfter('elda', 70, { gap: 60, until: "window.__game.village.commitments.all().some((c) => c.by === 'elda' && c.kind === 'tell' && c.state === 'kept')" });
  await wait(500);
  await shot('07-elda-told-lyra');
  const heard = await page.evaluate(() => {
    const m = window.__game.companion.mind;
    const all = m.memory?.all?.() || m.memory?.list || [];
    return (Array.isArray(all) ? all : []).filter((x) => /message from/.test(x.text)).map((x) => x.text).slice(-1)[0] || null;
  });
  check(kept && !!heard, `${tag}: Elda found Lyra and Lyra heard it (${heard})`);
  await page.evaluate(() => {
    window.__game.timeScale = 1;
  });

  // ------------------------------------------------------------------ teach
  await page.evaluate(() => {
    const g = window.__game;
    const ms = g.missions;
    if (ms && !ms.state.first_spark) ms.state.first_spark = { status: 'done', step: 0, n: 0 };
    const b = g.entities.get('bram');
    b.adjustOpinion?.(30, 'play');
    g.player.x = b.x + 22;
    g.player.y = b.y + 4;
  });
  await wait(600);
  await quiet();
  await tapPerson('bram');
  await page.waitForFunction(() => window.__game.ui.chat.target === 'bram', null, { timeout: 4000 }).catch(() => null);
  await say('can you teach me magic?');
  await wait(1200);
  await shot('08-bram-teach');
  const lesson = await page.evaluate(() => window.__game.missions?.status?.('hinge_ore'));
  check(lesson === 'active', `${tag}: Bram's lesson (iron) has begun (${lesson})`);
  await closeChat();

  // ------------------------------------------------------------------ hate
  // She has left them, afraid. The village is calm (nobody killed yet). The player stands
  // where her day takes her, then walks at her ("If I go to her, she goes away"): she keeps
  // her distance and goes about her day, without stepping back and forth in place.
  const hate = await page.evaluate(() => {
    const g = window.__game;
    const L = g.companion;
    const a = L.mind.autonomy;
    a.adjustPlayer({ trust: -40, fear: 70, affinity: -60 }, 'play');
    if (a.companionship !== 'left' && a.companionship !== 'gone') a.setCompanionship('left', 'You frighten me.', { cause: 'fear_left' });
    const sq = g.locations.get('town_square').center;
    g.player.x = sq.x;
    g.player.y = sq.y + 8;
    L.x = sq.x + 90;
    L.y = sq.y;
    L.behavior?.steering?.reset?.();
    return { state: a.companionship };
  });
  await quiet();
  const sample = () =>
    page.evaluate(() => {
      const g = window.__game;
      const L = g.companion;
      const d = L.behavior.directive;
      return { x: L.x, y: L.y, d: Math.hypot(L.x - g.player.x, L.y - g.player.y), dir: d.type, follow: d.type === 'follow' && d.target === 'player' };
    });
  let prev = null;
  let lastV = null;
  let reversals = 0;
  let minD = Infinity;
  let followed = false;
  const dirs = new Set();
  for (let i = 0; i < 72; i++) {
    // The first half: the player walks at her, at walking pace. The second: stands still.
    if (i < 36)
      await page.evaluate(() => {
        const g = window.__game;
        const L = g.companion;
        const p = g.player;
        const dx = L.x - p.x;
        const dy = L.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 20) {
          p.x += (dx / d) * 18;
          p.y += (dy / d) * 18;
        }
      });
    const s = await sample();
    if (prev) {
      const vx = s.x - prev.x;
      const vy = s.y - prev.y;
      const sp = Math.hypot(vx, vy);
      if (sp > 2) {
        if (lastV && vx * lastV.x + vy * lastV.y < -0.5 * sp * Math.hypot(lastV.x, lastV.y)) reversals++;
        lastV = { x: vx, y: vy };
      }
    }
    if (i > 8) minD = Math.min(minD, s.d);
    if (s.follow) followed = true;
    dirs.add(s.dir);
    prev = s;
    if (i === 30) await shot('09-hate-walk-at-her');
    if (i === 70) await shot('10-hate-her-day');
    await wait(250);
  }
  check(reversals <= 3 && !followed, `${tag}: afraid of you, she keeps away without moving in place (${reversals} reversals, closest ${Math.round(minD)} px, ${hate.state}, ${[...dirs].join('/')})`);
  log.push({ tag, scene: 'hate', reversals, minD: Math.round(minD), dirs: [...dirs] });

  // ------------------------------------------------------------------ a killing behind a house
  // Elda in the Ember Kettle; Corran killed outside, the far side of its wall. Nobody sees.
  const wall = await page.evaluate(() => {
    const g = window.__game;
    g.flags.finisherWarned = true;
    const b = g.locations.get('ember_kettle').bounds;
    const T = 16;
    const e = g.entities.get('elda');
    const v = g.entities.get('corran');
    for (const x of [v, e]) {
      x.walker?.stop?.();
      if (x.r) x.r.key = null;
      x.think = () => {};
    }
    const cy = (b.y + b.h / 2) * T;
    e.x = (b.x + 2.5) * T;
    e.y = cy;
    v.x = (b.x - 1.5) * T;
    v.y = cy;
    g.player.x = v.x - 14;
    g.player.y = v.y;
    v.hp = 1;
    g.combat.damage(g.player, v, 999, { exact: true, crit: false });
    const rec = g.murder.kill(v, g.player);
    return { seen: (rec?.seen || []).map((s) => s.id), fear: g.murder.fearOf(e), d: Math.round(Math.hypot(e.x - v.x, e.y - v.y)), wanted: !!g.murder.wanted };
  });
  await wait(600);
  await shot('11-kill-behind-wall');
  check(!wall.seen.includes('elda') && !wall.fear && !wall.wanted, `${tag}: Elda, ${wall.d} px away behind the Kettle's wall, saw nothing (${JSON.stringify(wall)})`);
  await page.evaluate(() => {
    const e = window.__game.entities.get('elda');
    delete e.think;
  });

  // ------------------------------------------------------------------ a killing in front of Elda
  // In the open, far from the watch: she sees it, she is terrified, she runs for the watch
  // screaming, and will not talk. The watch knows only when she reaches them.
  const open = await page.evaluate(() => {
    const g = window.__game;
    const at = g.locations.get('south_meadow')?.center || g.locations.get('town_square').center;
    const v = g.entities.get('tobias');
    const e = g.entities.get('elda');
    for (const x of [v, e]) {
      x.walker?.stop?.();
      if (x.r) x.r.key = null;
    }
    v.think = () => {};
    v.x = at.x;
    v.y = at.y;
    g.player.x = at.x - 14;
    g.player.y = at.y;
    e.x = at.x + 50;
    e.y = at.y - 8;
    const watch = ['rowan', 'wys', 'hess'].map((id) => g.entities.get(id)).filter(Boolean);
    const nearestWatch = Math.round(Math.min(...watch.map((w) => Math.hypot(w.x - at.x, w.y - at.y))));
    v.hp = 1;
    g.combat.damage(g.player, v, 999, { exact: true, crit: false });
    const rec = g.murder.kill(v, g.player);
    return { seen: (rec?.seen || []).map((s) => s.id), nearestWatch, wanted: !!g.murder.wanted };
  });
  await wait(500);
  await shot('12-witness-screams');
  const fear = await page.evaluate(() => {
    const g = window.__game;
    const e = g.entities.get('elda');
    return { fear: g.murder.fearOf(e), mode: e.mode, runningTo: e.fleeHome === 'to' ? e.fleeTo?.entity?.id || 'guardhouse' : null, wanted: !!g.murder.wanted };
  });
  check(open.seen.includes('elda') && fear.fear === 'terror' && fear.mode === 'flee' && !!fear.runningTo, `${tag}: Elda saw it, and runs screaming for the watch (${JSON.stringify({ ...fear, seen: open.seen })})`);
  check(!open.wanted && !fear.wanted, `${tag}: the watch (${open.nearestWatch} px off) does not know yet`);
  // Go after her and tap her: she will not talk.
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.entities.get('elda');
    g.player.x = e.x - 20;
    g.player.y = e.y + 2;
  });
  await wait(150);
  await tapPerson('elda');
  await page.waitForFunction(() => window.__game.ui.chat.isOpen(), null, { timeout: 3000 }).catch(() => null);
  await wait(400);
  await shot('13-witness-wont-talk');
  const refused = await page.evaluate(() => {
    const c = window.__game.ui.chat;
    return { open: c.isOpen(), target: c.target, away: c.away, disabled: c.field.disabled, placeholder: c.field.placeholder };
  });
  check(refused.target === 'elda' && refused.away === 'refuses' && refused.disabled, `${tag}: tapped, she will not talk (${JSON.stringify(refused)})`);
  await closeChat();
  // Let her run (the game runs, faster): the watch learns when she reaches them.
  await page.evaluate(() => {
    window.__game.timeScale = 3;
  });
  const tw = Date.now();
  let alarm = null;
  while (Date.now() - tw < 60000) {
    if (DEBUG)
      console.log(
        JSON.stringify(
          await page.evaluate(() => {
            const g = window.__game;
            const rec = g.murder.dead.tobias;
            const e = g.entities.get('elda');
            const r = rec?.rumor ? g.village.rumors.get(rec.rumor) : null;
            const w = (id) => {
              const x = g.entities.get(id);
              return x ? [Math.round(x.x), Math.round(x.y), x.mode, x.state] : null;
            };
            return { t: Math.round(g.time), paused: g.paused || g.state, dlg: !!document.querySelector('.dialog:not([hidden]), .dlg:not([hidden])'), elda: [Math.round(e.x), Math.round(e.y), e.mode, e.fleeHome, e.fleeTo?.entity?.id, Math.round((e.fleeUntil ?? 0) - g.time)], hess: w('hess'), rowan: w('rowan'), wys: w('wys'), heard: r?.heardBy, found: rec?.foundAt, alarm: rec?.alarm };
          }),
        ),
      );
    alarm = await page.evaluate(() => {
      const g = window.__game;
      const rec = g.murder.dead.tobias;
      const e = g.entities.get('elda');
      return rec?.alarm?.raised ? { by: rec.alarm.by, wanted: !!g.murder.wanted, elda: Math.round(Math.min(...['rowan', 'wys', 'hess'].map((id) => g.entities.get(id)).filter(Boolean).map((w) => Math.hypot(w.x - e.x, w.y - e.y)))) } : null;
    });
    if (alarm) break;
    await wait(400);
  }
  await page.evaluate(() => {
    window.__game.timeScale = 1;
  });
  await wait(600);
  await shot('14-the-watch-knows');
  check(!!alarm && ['rowan', 'wys', 'hess'].includes(alarm.by) && alarm.wanted, `${tag}: she reached the watch and they know now (${JSON.stringify(alarm)})`);
  log.push({ tag, scene: 'witness', open, alarm });

  for (const e of errors) failures.push(`${tag}: ${e}`);
  await ctx.close();
}

try {
  for (const s of SIZES) await play(s);
} catch (err) {
  failures.push(`run failed: ${err.stack || err}`);
}
await browser.close();
server.close();
console.log(JSON.stringify(log));
if (failures.length) {
  console.error(`\nMINDS PLAY FAILED (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nMINDS PLAY PASSED');
