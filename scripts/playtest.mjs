// Scripted integration playtest in headless Chromium. Exercises the systems together and
// reports what worked: attack mode, friend protection, jobs, conversations, sleep and diary,
// the ruins gate, saving, and the phone layout. Screenshots go to screenshots/playtest-*.png.
//   node scripts/playtest.mjs [--src]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const useSrc = process.argv.includes('--src');
const server = await startServer(0);
const url = `http://localhost:${server.address().port}/${useSrc ? 'index.html' : 'dist/index.html'}`;
await mkdir('screenshots', { recursive: true });

const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function watch(page, label) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${(err.stack || '').split('\n').slice(0, 4).join('\n')}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(t)) return;
    errors.push(`[${label}] console.error: ${t}`);
  });
}

async function boot(page) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 30000 });
}

const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await desktop.newPage();
watch(page, 'desktop');
await boot(page);
await page.screenshot({ path: 'screenshots/playtest-title.png' });
await page.evaluate(() => window.__game.newGame());
await page.waitForFunction(() => window.__game.state === 'playing');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/playtest-start.png' });

// --- World and population -------------------------------------------------------------
const world = await page.evaluate(() => {
  const g = window.__game;
  const ids = ['hearthvale', 'town_square', 'player_home', 'ember_kettle', 'smithy', 'general_store', 'chapel', 'herbalist', 'guardhouse', 'farmhouse', 'reed_farm', 'whisperwood', 'stonecut_quarry', 'bandit_camp', 'mirror_lake', 'sunken_ruins', 'south_meadow', 'kings_road'];
  const objIds = ['home_bed', 'lyra_bed', 'home_chest', 'ruins_gate', 'bandit_chest', 'maren_journal', 'inn_hearth', 'camp_campfire', 'lake_campfire'];
  const npcs = ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick'];
  return {
    size: `${g.map.w}x${g.map.h}`,
    missingLocations: ids.filter((id) => !g.locations.get(id)),
    missingObjects: objIds.filter((id) => !g.objects.get(id)),
    missingNpcs: npcs.filter((id) => !g.entities.get(id)),
    creatures: g.entities.all().filter((e) => e.species).length,
    actions: g.actions.names(),
    plugins: g.plugins.all().map((p) => p.id),
    brain: g.brain.status(),
  };
});
check('world is full size', world.size === '160x120', world.size);
check('all required locations exist', world.missingLocations.length === 0, world.missingLocations.join(', '));
check('all required objects exist', world.missingObjects.length === 0, world.missingObjects.join(', '));
check('all villagers exist', world.missingNpcs.length === 0, world.missingNpcs.join(', '));
check('creatures spawned', world.creatures > 10, `${world.creatures}`);
const wantActions = ['follow', 'stay', 'wait', 'come_here', 'goto', 'set_combat_mode', 'attack', 'retreat', 'guard', 'patrol', 'explore', 'free_will', 'emote', 'sit', 'open_door', 'close_door', 'pick_up', 'give_item', 'use_item', 'interact', 'sleep', 'start_job', 'stop_job', 'talk_to', 'set_relationship', 'note_about', 'remember', 'forget', 'set_goal', 'complete_goal', 'express', 'read_journal'];
const missingActions = wantActions.filter((a) => !world.actions.includes(a));
check('full action catalogue registered', missingActions.length === 0, missingActions.join(', ') || `${world.actions.length} actions`);
console.log('brain:', JSON.stringify(world.brain));

// --- Chat commands through the offline mind ---------------------------------------------
const chat = await page.evaluate(async () => {
  const g = window.__game;
  const out = [];
  for (const msg of ['Follow me', 'attack mode', 'Stay here', 'how are you feeling?', 'what do you think of me?', 'come with me and defend me']) {
    const r = await g.brain.handlePlayerMessage(msg);
    out.push({ msg, say: r?.say, stance: g.companion.behavior.stance, directive: g.companion.behavior.directive?.type });
  }
  return out;
});
for (const c of chat) console.log(`  "${c.msg}" → "${c.say}" [${c.stance}/${c.directive}]`);
check('"attack mode" sets attack stance', chat[1].stance === 'attack');
check('"Stay here" holds position', chat[2].directive === 'stay');
check('every message gets a reply', chat.every((c) => c.say && c.say.length > 1));

// --- Attack mode in the forest: she fights non-friends, never villagers -------------------
const fight = await page.evaluate(async () => {
  const g = window.__game;
  const log = { lyraHits: 0, lyraHitVillager: 0, lyraHitTargets: new Set() };
  const off = g.bus.on('damage', (p) => {
    if (p.source === g.companion) {
      log.lyraHits++;
      log.lyraHitTargets.add(p.target.species || p.target.faction);
      if (p.target.faction === 'villager' || p.target.faction === 'guard' || p.target === g.player) log.lyraHitVillager++;
    }
  });
  const wolf = g.entities.all().find((e) => e.species === 'wolf' && e.isAlive()) || null;
  let spawned = false;
  const ww = g.locations.get('whisperwood');
  const cx = wolf ? wolf.x : ww.center.x;
  const cy = wolf ? wolf.y + 60 : ww.center.y;
  g.player.x = cx;
  g.player.y = cy;
  g.companion.x = cx + 12;
  g.companion.y = cy;
  g.player.invuln = 999; // keep the test player alive
  if (!wolf) {
    const { spawnCreature } = window.__hl || {};
    spawned = !!spawnCreature;
  }
  g.actions.run('follow', { target: 'player' }, 'player');
  g.actions.run('set_combat_mode', { value: 'attack' }, 'player');
  g.camera.snap?.();
  await new Promise((r) => setTimeout(r, 9000));
  off();
  g.player.invuln = 0;
  return { lyraHits: log.lyraHits, lyraHitVillager: log.lyraHitVillager, targets: [...log.lyraHitTargets], hadWolf: !!wolf, spawned };
});
await page.screenshot({ path: 'screenshots/playtest-forest-fight.png' });
check('attack mode: Lyra attacks creatures on her own', fight.lyraHits > 0, JSON.stringify(fight));
check('attack mode: Lyra never hits villagers or the player', fight.lyraHitVillager === 0);

// --- Friend protection: she refuses to attack a villager --------------------------------
const refusal = await page.evaluate(() => {
  const g = window.__game;
  const r = g.actions.run('attack', { target: 'bram' }, 'player');
  return r;
});
check('refuses to attack a friend (Bram)', refusal.ok === false, refusal.message);

// --- A job: chop wood ------------------------------------------------------------------
const job = await page.evaluate(async () => {
  const g = window.__game;
  const tree = g.objects.nearest((o) => o.objType === 'tree' && (o.canWork ? o.canWork(g.companion) : true), g.player.x, g.player.y, 4000);
  if (tree) {
    g.player.x = tree.x + 30;
    g.player.y = tree.y + 20;
    g.companion.x = tree.x + 24;
    g.companion.y = tree.y + 24;
  }
  g.actions.run('set_combat_mode', { value: 'passive' }, 'player');
  const before = g.companion.inventory.count('wood') + g.player.inventory.count('wood');
  const r = g.actions.run('start_job', { value: 'chop_wood', amount: 2, target: 'keep' }, 'player');
  let done = false;
  const off = g.bus.on('job_done', () => (done = true));
  for (let i = 0; i < 40 && !done; i++) await new Promise((res) => setTimeout(res, 1000));
  off();
  const after = g.companion.inventory.count('wood') + g.player.inventory.count('wood');
  return { started: r, done, gained: after - before, status: g.companion.behavior.status() };
});
await page.screenshot({ path: 'screenshots/playtest-job.png' });
check('job: chop wood completes', job.done && job.gained > 0, JSON.stringify(job));

// --- Social: talk to a villager ---------------------------------------------------------
const social = await page.evaluate(async () => {
  const g = window.__game;
  const bram = g.entities.get('bram');
  g.player.x = bram.x + 20;
  g.player.y = bram.y + 10;
  g.companion.x = bram.x + 30;
  g.companion.y = bram.y + 14;
  let convo = null;
  const off = g.bus.on('conversation', (p) => (convo = p));
  const r = g.actions.run('talk_to', { target: 'bram' }, 'player');
  // Six lines read at a speaking pace take about 25 s on an idle machine; allow for load.
  for (let i = 0; i < 45 && !convo; i++) await new Promise((res) => setTimeout(res, 1000));
  off();
  const rel = g.companion.mind.relationships.get('bram');
  return { started: r, lines: convo?.lines?.length || 0, rel: rel ? { familiarity: rel.familiarity, notes: rel.notes?.length } : null };
});
await page.screenshot({ path: 'screenshots/playtest-talk.png' });
check('talk_to: Lyra converses with Bram', social.lines > 0, JSON.stringify(social));
check('talk_to: she learns about Bram', (social.rel?.notes || 0) > 0);

// --- UI panels -------------------------------------------------------------------------
await page.evaluate(() => window.__game.ui.openMind?.('people'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/playtest-mind-people.png' });
await page.evaluate(() => window.__game.ui.openMind?.('now'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/playtest-mind-now.png' });
await page.keyboard.press('Escape');
await page.evaluate(() => window.__game.ui.chat.open());
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/playtest-chat.png' });
await page.evaluate(() => window.__game.ui.chat.close());

// --- Night in the village --------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__game;
  const sq = g.locations.get('town_square');
  g.player.x = sq.center.x;
  g.player.y = sq.center.y;
  g.companion.x = sq.center.x + 14;
  g.companion.y = sq.center.y;
  g.clock.skipTo(21.5);
  g.camera.snap?.();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/playtest-night-village.png' });

// --- Sleep and reflection --------------------------------------------------------------
const sleep = await page.evaluate(async () => {
  const g = window.__game;
  const bed = g.objects.get('home_bed');
  g.player.x = bed.x;
  g.player.y = bed.y + 12;
  const diaryBefore = g.companion.mind.diary?.length || 0;
  const ok = await g.sleep(bed);
  return { ok, hour: Math.floor(g.clock.hour), diary: (g.companion.mind.diary?.length || 0) - diaryBefore, entry: g.companion.mind.diary?.at(-1)?.text?.slice(0, 160) };
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/playtest-diary.png' });
check('sleep reaches morning', sleep.ok && sleep.hour === 7, JSON.stringify(sleep));
check('Lyra writes a diary entry', sleep.diary > 0, sleep.entry || '');
await page.keyboard.press('Escape');

// --- Ruins gate: locked, opens with the key --------------------------------------------
const gate = await page.evaluate(() => {
  const g = window.__game;
  const door = g.objects.get('ruins_gate');
  const lockedBefore = door.locked;
  const openedWithoutKey = door.open(g.player);
  g.player.inventory.add('ruins_key', 1);
  const openedWithKey = door.open(g.player);
  return { lockedBefore, openedWithoutKey, openedWithKey };
});
check('ruins gate starts locked', gate.lockedBefore && !gate.openedWithoutKey);
check('ruins gate opens with the key', gate.openedWithKey);

// --- Save round trip -------------------------------------------------------------------
const saved = await page.evaluate(async () => {
  const g = window.__game;
  g.companion.mind.remember('The traveler showed me a secret path behind the mill.', { importance: 8, about: ['player'] });
  await g.save.save('playtest');
  return { bytes: JSON.stringify(g.serialize()).length, memories: g.companion.mind.memory?.all?.().length ?? null };
});
check('save is reasonably small', saved.bytes < 250000, `${saved.bytes} bytes`);
const page2 = await desktop.newPage();
watch(page2, 'reload');
await boot(page2);
const restored = await page2.evaluate(async () => {
  const g = window.__game;
  const ok = await g.continueGame();
  const found = (g.companion.mind.recall?.('secret path mill') || []).some((m) => /secret path/.test(m.text));
  return { ok, found, day: g.clock.day };
});
check('continue restores Lyra\'s memories', restored.ok && restored.found, JSON.stringify(restored));
await page2.close();
await desktop.close();

// --- Phone ------------------------------------------------------------------------------
const phone = await browser.newContext({ ...devices['iPhone 13'] });
const mp = await phone.newPage();
watch(mp, 'phone');
await boot(mp);
await mp.screenshot({ path: 'screenshots/playtest-phone-title.png' });
await mp.evaluate(() => window.__game.newGame());
await mp.waitForFunction(() => window.__game.state === 'playing');
await mp.waitForTimeout(1200);
await mp.screenshot({ path: 'screenshots/playtest-phone-play.png' });
await mp.evaluate(() => window.__game.ui.chat.open());
await mp.waitForTimeout(400);
await mp.screenshot({ path: 'screenshots/playtest-phone-chat.png' });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('phone: no horizontal overflow', !overflow);
await phone.close();

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 30)) console.log(' - ' + e);
}
process.exit(failed.length || errors.length ? 1 : 0);
