// V12 merge, seam 10: a Version 11 save (2634ca5) and a round 14b save (aee713c), made in
// their real builds, load in the merged build: stats on the new numbers, the wound kept,
// party, murder records, ages, soul bar and pact intact; Free on/off, Reset and respec exact.
// The old builds are made once:  for v in 2634ca5 aee713c; do mkdir -p $DIR/old_$v &&
//   git archive $v | tar -x -C $DIR/old_$v && ln -s $PWD/node_modules $DIR/old_$v/ &&
//   (cd $DIR/old_$v && node scripts/build.mjs); done
// then: V12_OLD_BUILDS=$DIR node scripts/v12_saves_check.mjs   (each save is left there as
// save_<ver>.json; tests/fixtures/save_<ver>.json.gz are two of them, for the unit test).
import { createRequire } from 'node:module';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const S = process.env.V12_OLD_BUILDS || '/tmp/v12-old-builds'; // old_2634ca5/ and old_aee713c/: git archive + node scripts/build.mjs
const require = createRequire(`${REPO}/package.json`);
const { chromium } = require('playwright');
const { pointsEffect, ATTR_IDS } = await import(`${REPO}/src/progression/attributes.js`);
const browser = await chromium.launch();
const results = [];
const ok = (c, label, info = '') => {
  results.push({ ok: !!c, label, info });
  console.log(`${c ? 'ok  ' : 'FAIL'} ${label} ${info}`);
};

async function open(root) {
  const { startServer } = await import(`${root}/scripts/serve.mjs?${Math.random()}`);
  const server = await startServer(0);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const url = `http://localhost:${server.address().port}/dist/index.html`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 90000 });
  return { server, ctx, page, errors, url };
}

async function makeSave(root, { free = false, r14b = false } = {}) {
  const o = await open(root);
  await o.page.evaluate(() => window.__game.newGame());
  await o.page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 90000 });
  await o.page.waitForTimeout(800);
  const before = await o.page.evaluate(async ({ free, r14b }) => {
    const g = window.__game;
    try { g.story?.skip?.(); } catch {}
    const P = g.player;
    while (P.level < 15) g.combat.giveXp(P, Math.max(1, g.combat.xpToNext(P.level) - (P.xp || 0)));
    const pr = g.progression;
    pr.spend('might', 20);
    pr.spend('vitality', 12);
    pr.spend('focus', 10);
    P.inventory.add('steel_sword', 1);
    g.gear.equip('steel_sword');
    if (free) {
      pr.startFree();
      pr.spend('grace', 200);
      pr.spend('weave', 37);
    }
    g.stats.refresh(P);
    // A murder on record: Garrick, downed and killed.
    const gar = g.entities.get('garrick');
    gar.hp = 1;
    g.combat.damage(P, gar, 999, { exact: true, crit: false });
    const rec = g.murder?.kill?.(gar, P);
    const out = { murdered: !!rec };
    if (r14b) {
      const bram = g.entities.get('bram');
      bram.opinionOfPlayer = 85;
      bram.x = P.x + 14; bram.y = P.y;
      out.invite = g.party?.invite?.(bram)?.ok ?? null;
      out.holder = g.party?.holderId ?? null;
      out.pact = g.villain?.seal?.('after') ?? null;
      out.learned = !!g.unkindle?.learned;
      if (g.unkindle?.coldfire) { g.unkindle.coldfire.bar = 40; out.bar = g.unkindle.coldfire.bar; out.mark = g.unkindle.coldfire.mark; }
    }
    out.ages = {};
    for (const id of ['tansy', 'pip', 'elda', 'bram']) out.ages[id] = g.calendar?.ageOf?.(id) ?? null;
    g.magic.mana.cur = 30;
    P.hp = Math.round(P.maxHp * 0.7);
    const v = g.stats.all(P);
    await g.save.save('manual');
    return { ...out, level: P.level, points: { ...pr.points }, free: !!pr.free, maxHp: P.maxHp, hp: P.hp, atk: v.atk, mana: g.magic.mana.max, manaCur: g.magic.mana.cur, speed: P.speed, dead: Object.keys(g.murder?.dead || {}), save: localStorage.getItem('hearthlight.save.v1') };
  }, { free, r14b });
  ok(o.errors.length === 0, `${root.split('_').pop()}: the old build made its save with no page errors`, o.errors.join(' | '));
  await o.ctx.close();
  o.server.close();
  return before;
}

async function loadInNew(save, root = REPO) {
  const o = await open(root);
  await o.page.evaluate((s) => localStorage.setItem('hearthlight.save.v1', s), save);
  await o.page.reload({ waitUntil: 'load' });
  await o.page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 90000 });
  // The mana and health the moment the save is applied (before a frame of regen).
  o.atLoad = await o.page.evaluate(async () => {
    const g = window.__game;
    await g.continueGame();
    return { manaCur: g.magic.mana.cur, mana: g.magic.mana.max, hp: g.player.hp, maxHp: g.player.maxHp };
  });
  await o.page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 90000 });
  await o.page.waitForTimeout(1000);
  return o;
}

const read = (page) => page.evaluate(() => {
  const g = window.__game;
  const P = g.player;
  const pr = g.progression;
  const v = g.stats.all(P);
  const ages = {};
  for (const id of ['tansy', 'pip', 'elda', 'bram']) ages[id] = g.calendar?.ageOf?.(id) ?? null;
  return { level: P.level, points: { ...pr.points }, free: !!pr.free, unspent: pr.unspent(), maxHp: P.maxHp, hp: P.hp, atk: v.atk, mana: g.magic.mana.max, manaCur: g.magic.mana.cur, speed: P.speed, contrib: pr.pointsContribution(P), holder: g.party?.holderId ?? null, dead: Object.keys(g.murder?.dead || {}), garrickDead: !!g.entities.get('garrick')?.dead, ages, pact: g.villain?.state?.pact ?? null, learned: !!g.unkindle?.learned, bar: g.unkindle?.coldfire?.bar ?? null, mark: g.unkindle?.coldfire?.mark ?? null };
});

const expectFor = (points) => {
  const out = { add: {}, pct: {} };
  for (const id of ATTR_IDS) {
    const c = pointsEffect(id, points[id] || 0);
    for (const part of ['add', 'pct']) for (const [k, x] of Object.entries(c?.[part] || {})) out[part][k] = (out[part][k] || 0) + x;
  }
  return out;
};
const close = (a, b) => Object.keys(b.add).every((k) => Math.abs((a.add?.[k] || 0) - b.add[k]) < 1e-9) && Object.keys(b.pct).every((k) => Math.abs((a.pct?.[k] || 0) - b.pct[k]) < 1e-9);

for (const [ver, r14b] of [['2634ca5', false], ['aee713c', true]]) {
  const root = `${S}/old_${ver}`;
  const old = await makeSave(root, { r14b });
  (await import('node:fs')).writeFileSync(`${S}/save_${ver}.json`, old.save);
  console.log(ver, 'old numbers', JSON.stringify({ ...old, save: undefined }));
  const o = await loadInNew(old.save);
  const now = await read(o.page);
  console.log(ver, 'new numbers', JSON.stringify({ ...now, contrib: undefined }));
  ok(now.level === 15, `${ver}: level kept`, `${now.level}`);
  ok(JSON.stringify(now.points) === JSON.stringify(old.points), `${ver}: points kept by id`, JSON.stringify(now.points));
  ok(close(now.contrib, expectFor(now.points)), `${ver}: the points follow the new curves`);
  ok(now.maxHp >= old.maxHp && now.atk >= old.atk && now.mana >= old.mana, `${ver}: health ${old.maxHp}→${now.maxHp}, sword ${old.atk.toFixed(1)}→${now.atk.toFixed(1)}, mana ${old.mana}→${now.mana}`);
  ok(o.atLoad.manaCur <= o.atLoad.mana && Math.abs(o.atLoad.manaCur - old.manaCur) < 0.01, `${ver}: mana fill kept at load (${old.manaCur} → ${o.atLoad.manaCur.toFixed(2)} of ${o.atLoad.mana}; ${now.manaCur.toFixed(1)} a second of regen later)`);
  ok(Math.abs(o.atLoad.hp - old.hp) < 0.01 && o.atLoad.hp <= o.atLoad.maxHp, `${ver}: wound kept at load (${old.hp} → ${o.atLoad.hp} of ${o.atLoad.maxHp})`);
  ok(now.hp <= now.maxHp && now.hp >= old.hp - 1, `${ver}: wound kept (${old.hp} of ${old.maxHp} → ${now.hp} of ${now.maxHp})`);
  ok(old.murdered && now.dead.includes('garrick') && now.garrickDead, `${ver}: the murder record and Garrick's death kept`, JSON.stringify(now.dead));
  ok(JSON.stringify(now.ages) === JSON.stringify(old.ages), `${ver}: ages kept`, JSON.stringify(now.ages));
  if (r14b) {
    ok(old.holder === 'bram' && now.holder === 'bram', `${ver}: Bram still walks with you`, `${old.holder} → ${now.holder}`);
    ok(old.pact && now.pact === 'after', `${ver}: the pact kept`, `${now.pact}`);
    ok(now.learned && Math.abs(now.bar - old.bar) < 1, `${ver}: the Unkindling and the soul bar kept (${old.bar} → ${now.bar})`);
  }
  // Reset stat points, clicked through Settings → Game.
  const reset = await o.page.evaluate(async () => {
    const g = window.__game;
    g.ui.openSettings?.('game') ?? g.ui.openSettings?.();
    await new Promise((r) => setTimeout(r, 300));
    const row = document.querySelector('.set-row[data-action="resetPoints"] button');
    if (!row) return { found: false };
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    const yes = [...document.querySelectorAll('button')].find((b) => /Reset them/.test(b.textContent));
    yes?.click();
    await new Promise((r) => setTimeout(r, 300));
    g.ui.closeAll?.();
    return { found: true, yes: !!yes, spent: g.progression.spent(), unspent: g.progression.unspent(), maxHp: g.player.maxHp };
  });
  ok(reset.found && reset.spent === 0 && reset.unspent === 42, `${ver}: Settings → Reset stat points gives all 42 back`, JSON.stringify(reset));
  const resp = await o.page.evaluate(() => {
    const g = window.__game;
    const pr = g.progression;
    pr.spend('weave', 30);
    pr.spend('focus', 12);
    g.player.inventory.add('coin', 2000);
    const coins = g.player.inventory.count?.('coin');
    const r = pr.respec();
    return { r, coins, after: g.player.inventory.count?.('coin'), spent: pr.spent(), unspent: pr.unspent() };
  });
  ok(resp.r.ok && resp.spent === 0 && resp.unspent === 42 && resp.coins - resp.after === resp.r.cost, `${ver}: chapel respec gives back 42 for ${resp.r.cost} coins`, JSON.stringify(resp));
  const fr = await o.page.evaluate(() => {
    const g = window.__game;
    const pr = g.progression;
    pr.spend('might', 20);
    pr.spend('vitality', 22);
    const real = { ...pr.points };
    pr.startFree();
    pr.spend('grace', 300);
    pr.spend('focus', 999);
    const fast = g.player.speed;
    pr.endFree();
    return { real, back: { ...pr.points }, fast, unspent: pr.unspent() };
  });
  ok(JSON.stringify(fr.real) === JSON.stringify(fr.back) && fr.unspent === 0 && fr.fast > 120, `${ver}: Free on then off gives back the real points exactly`, JSON.stringify(fr));
  ok(o.errors.length === 0, `${ver}: no page errors in the merged build`, o.errors.join(' | '));
  await o.ctx.close();
  o.server.close();
}
// A round 14b save made with Free stat points on.
{
  const old = await makeSave(`${S}/old_aee713c`, { free: true, r14b: true });
  const o = await loadInNew(old.save);
  const now = await read(o.page);
  ok(now.free && now.points.grace === 200 && now.points.weave === 37, 'aee713c free save: free points kept', JSON.stringify(now.points));
  ok(close(now.contrib, expectFor(now.points)), 'aee713c free save: free points follow the new curves');
  const off = await o.page.evaluate(() => {
    const g = window.__game;
    g.progression.endFree();
    return { points: { ...g.progression.points }, free: g.progression.free, unspent: g.progression.unspent() };
  });
  ok(!off.free && off.points.grace === 0 && off.points.weave === 0 && off.points.might === 20 && off.points.vitality === 12 && off.points.focus === 10 && off.unspent === 0, 'aee713c free save: Free off gives back the real points exactly', JSON.stringify(off));
  ok(o.errors.length === 0, 'aee713c free save: no page errors', o.errors.join(' | '));
  await o.ctx.close();
  o.server.close();
}
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} ok`);
process.exit(0);
