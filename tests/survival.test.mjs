import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, stepUntil, placeAt, events, wolf, villagers, fakeStorage } from './survival_world.mjs';
import { TILE } from '../src/core/constants.js';
import { SaveManager, pickNewer } from '../src/core/save.js';
import { SAVE_KEY } from '../src/core/constants.js';
import { PLAYER_WINDOW, BERSERK_WINDOW, RATE, CRAWL_BUDGET, WARMTH_HP, POTION_REVIVE_HP, PATIENT_SECONDS, MIRA_BILL, MIRA_SALVE, CARRIERS } from '../src/survival/constants.js';
import { lightKeptFlame, hasKeptFlame } from '../src/survival/kept_flame.js';
import { readPastLives, isClosedSave } from '../src/survival/past_lives.js';
import { composeMemorial } from '../src/survival/epitaph.js';
import { lyraTone } from '../src/survival/lines.js';
import { chooseOption } from '../src/entities/npc_dialogue.js';

// Death is dangerous (DESIGN §27): falling and the bleed-out window, Lyra and the village
// coming, reviving or carrying to the sickroom, the kept flame, the end of a story, and the
// player carrying others in.

const at = (g, id) => g.locations.get(id).center;
const tileOf = (a) => ({ tx: Math.floor(a.x / TILE), ty: Math.floor(a.y / TILE) });

// Keep Lyra where she is (she follows the player otherwise, teleporting when far).
function lyraStays(g, x, y, state = null) {
  const L = g.companion;
  placeAt(g, L, x, y);
  L.behavior.setDirective({ type: 'stay', x, y });
  if (state) L.mind.autonomy.companionship = state;
}

// Nobody else in the world can hear: the window runs on its own.
function alone(g) {
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  g.survival.lyraForVillager = () => {};
}

function fell(g, by = null) {
  const P = g.player;
  const w = by || wolf(g, P.x + 12, P.y);
  g.combat.damage(w, P, 999);
  if (!by) w.removed = true;
  return g.survival.fallOf(P);
}

test('falling: a 75 s window that drains on its own, faster when crawling; Resolve and berserk change it', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraStays(g, m.x + 900, m.y);
  const rec = fell(g);
  assert.ok(P.downed && !P.dead, 'lying on the ground, alive');
  assert.ok(g.survival.isFallen(P));
  assert.equal(rec.window, PLAYER_WINDOW);
  assert.equal(events(g, 'fallen')[0].entity, P);
  // The slow-motion beat, then the world's pace again.
  g.survival.realtime(0.1);
  assert.ok(g.timeScale < 0.5, 'a beat of slow motion');
  for (let i = 0; i < 60; i++) g.survival.realtime(0.05);
  assert.equal(g.timeScale, 1);
  step(g, 20);
  assert.ok(Math.abs(rec.left - (PLAYER_WINDOW - 20)) < 0.6, `drains at one second per second (${rec.left})`);
  assert.ok(g.beats > 10, 'a heartbeat sounds through it');
  // Crawling: a little, and it costs.
  const x0 = P.x;
  g.input.move = { x: 1, y: 0 };
  const before = rec.left;
  step(g, 4);
  assert.ok(P.x > x0 + 20, 'crawled');
  assert.ok(before - rec.left > 4 * 1.4, 'crawling drains faster');
  step(g, 10);
  assert.ok(rec.crawled <= CRAWL_BUDGET + 1, 'only a little');
  g.input.move = { x: 0, y: 0 };
  assert.ok(P.downed);

  // Resolve (DESIGN §26) lengthens it through game.stats; berserk's end gives 30 s.
  const g2 = makeGame({ hour: 14 });
  alone(g2);
  g2.stats = { get: (a, k) => (k === 'bleedout' ? 110 : undefined) };
  assert.equal(fell(g2).window, 110);
  const g3 = makeGame({ hour: 14 });
  alone(g3);
  assert.equal(g3.player.fall({ window: 30, cause: 'berserk' }), true);
  const r3 = g3.survival.fallOf(g3.player);
  assert.equal(r3.window, BERSERK_WINDOW);
  assert.equal(r3.cause, 'berserk');
});

test('Lyra comes for the player and lends her warmth: up at last, bruised; it costs her', () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const L = g.companion;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraStays(g, m.x + 220, m.y);
  step(g, 0.5);
  const lyraHp = L.hp;
  fell(g);
  const job = g.survival.jobFor(L);
  assert.ok(job, 'she heard');
  assert.equal(job.role, 'lyra');
  const t = stepUntil(g, () => !g.survival.isFallen(P), 30);
  assert.ok(t > 0, 'she got there in time');
  assert.ok(!P.downed && P.hp === Math.round(P.maxHp * WARMTH_HP), `up on lent warmth (${P.hp})`);
  assert.ok(g.survival.activeConditions().some((c) => c.id === 'bruised'), 'bruised');
  assert.ok(P.attackPower < P.atk + P.weaponBonus, 'and weaker for it');
  assert.ok(L.hp < lyraHp, 'the warmth was hers');
  assert.ok(L.mind.memory.all().some((mm) => /warmth/.test(mm.text) && mm.about.includes('player')), 'she remembers it');
  assert.equal(events(g, 'revived').at(-1).by, L);
});

test('Lyra carries the player to the sickroom when it is past saving on the spot; they wake there hours later, with Mira’s bill', async () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const L = g.companion;
  const sq = at(g, 'town_square');
  // Everyone else is busy elsewhere; she is hurt (no warmth to spare) and has cut them off.
  for (const v of villagers(g)) placeAt(g, v, 141 * TILE, 101 * TILE);
  placeAt(g, P, sq.x, sq.y);
  lyraStays(g, sq.x + 200, sq.y, 'gone');
  L.hp = Math.round(L.maxHp * 0.3);
  assert.equal(lyraTone(L), 'cold');
  step(g, 0.3);
  const coins = P.gold;
  const hour = g.clock.hour;
  fell(g);
  let sawCarry = false;
  const t = stepUntil(
    g,
    () => {
      if (P.carriedBy === L) sawCarry = sawCarry || !!g.survival.fxState()?.carried;
      return !g.survival.isFallen(P);
    },
    70,
  );
  assert.ok(t > 0, 'carried in time');
  assert.ok(sawCarry, 'carried on her shoulders, letterboxed');
  assert.equal(events(g, 'carried')[0].carrier, L);
  const d = events(g, 'delivered')[0];
  assert.equal(d.carrier, L);
  assert.match(d.bed.id, /^sickbed_/);
  await g.survival.pending;
  assert.equal(g.state, 'playing');
  assert.ok(!P.downed && P.hp >= Math.round(P.maxHp * 0.5), 'tended');
  assert.equal(g.locations.at(P.x, P.y)?.id, 'herbalist', 'wakes at Fennick’s Herbs');
  assert.equal(P.gold, coins - MIRA_BILL, "Mira's bill");
  assert.ok(g.survival.activeConditions().some((c) => c.id === 'mending'), 'weak for a while');
  const later = (g.clock.hour - hour + 24) % 24;
  assert.ok(later >= 6, `hours later (${later.toFixed(1)})`);
  assert.ok(g.toasts.some((x) => /cot at Fennick's Herbs/.test(x.text) && /carried you here/.test(x.text)));
  assert.ok(g.said.some((s) => s.who === 'lyra' && /read anything|Quiet|not doing this for you|Mira's\. Then|don’t leave people|don't leave|Patch them up|Breathe/.test(s.text)), 'she speaks to them coldly, but she carries them');
});

test('a villager answers: Mira revives the player on the spot with her salves', () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const sq = at(g, 'town_square');
  for (const v of villagers(g)) placeAt(g, v, 141 * TILE, 101 * TILE);
  lyraStays(g, 20 * TILE, 20 * TILE, 'gone');
  placeAt(g, P, sq.x, sq.y);
  const mira = g.entities.get('mira');
  placeAt(g, mira, sq.x + 120, sq.y);
  step(g, 0.3);
  const coins = P.gold;
  fell(g);
  const job = g.survival.jobFor(mira);
  assert.equal(job?.role, 'revive', 'she saw it and came');
  assert.ok(stepUntil(g, () => !g.survival.isFallen(P), 30) > 0);
  assert.equal(events(g, 'revived').at(-1).by, mira);
  assert.equal(P.gold, coins - MIRA_SALVE, 'the salve costs a little');
  assert.equal(mira.mode, 'routine', 'back to her day');
});

test('villagers carry the player to the sickroom when Mira is away; calling for help brings them', async () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const sq = at(g, 'town_square');
  lyraStays(g, 20 * TILE, 20 * TILE, 'gone');
  placeAt(g, g.entities.get('mira'), 25 * TILE, 53 * TILE);
  for (const v of villagers(g)) if (v.id !== 'rowan' && v.id !== 'mira') placeAt(g, v, 141 * TILE, 101 * TILE);
  const rowan = g.entities.get('rowan');
  placeAt(g, rowan, sq.x + 280, sq.y);
  placeAt(g, P, sq.x, sq.y);
  step(g, 0.3);
  fell(g);
  assert.ok(!g.survival.jobFor(rowan), 'too far to see it');
  step(g, 0.5);
  g.input.press('interact');
  step(g, 0.1);
  assert.equal(events(g, 'fall_call').length, 1, 'a shout for help');
  assert.equal(g.survival.jobFor(rowan)?.role, 'carry', 'he heard');
  assert.ok(stepUntil(g, () => !g.survival.isFallen(P), 80) > 0, 'in time');
  const d = events(g, 'delivered')[0];
  assert.equal(d.carrier, rowan);
  assert.ok(CARRIERS.has(d.carrier.id));
  await g.survival.pending;
  assert.equal(g.locations.at(P.x, P.y)?.id, 'herbalist');
  assert.ok(g.toasts.some((x) => /Rowan/.test(x.text) && /carried you here/.test(x.text)));
  assert.equal(rowan.mode, 'routine');
  assert.ok(!rowan.carrying && !P.carriedBy);
});

test('nobody comes in time but a kept flame burns: back at the chapel at dawn, flame spent, coin lost, flame-thin', async () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const P = g.player;
  P.inventory.add('coin', 100);
  const aveline = g.entities.get('aveline');
  // The rite, through her dialogue: offer, price, light; one at a time.
  const offer = chooseOption(aveline, 'flame', P);
  assert.ok(offer.lines.join(' ').includes('coin'));
  assert.ok(offer.options.some((o) => o.id === 'flame:light'));
  chooseOption(aveline, 'flame:light', P);
  assert.ok(hasKeptFlame(g));
  assert.equal(lightKeptFlame(g, P).reason, 'burning', 'one at a time');
  const coins = P.gold;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraStays(g, m.x + 900, m.y);
  fell(g);
  step(g, PLAYER_WINDOW + 1, 0.1);
  assert.equal(events(g, 'player_died')[0].mode, 'flame');
  await g.survival.pending;
  assert.equal(g.state, 'playing');
  assert.ok(!P.downed && P.hp > 0);
  assert.ok(!hasKeptFlame(g), 'the flame is spent');
  assert.equal(g.flags.flamesSpent, 1);
  assert.ok(P.gold < coins, 'coin lost');
  assert.equal(g.locations.at(P.x, P.y)?.id, 'chapel', 'wakes at the chapel');
  assert.ok(g.clock.hour >= 6 && g.clock.hour < 6.5, 'at dawn');
  assert.ok(g.survival.activeConditions().some((c) => c.id === 'flame_thin'));
  assert.ok(g.village?.rumors?.list?.some((r) => r.kind === 'flame_spent'), 'the village knows');
});

test('nobody comes and no flame burns: the story ends; the save closes for good and moves to Past lives', async () => {
  const store = fakeStorage();
  globalThis.localStorage = store;
  try {
    const g = makeGame({ hour: 23 });
    alone(g);
    g.save = new SaveManager(g);
    g.serialize = () => ({ version: 1, savedAt: Date.now(), player: g.player.serialize(), flags: { ...g.flags } });
    const P = g.player;
    const m = at(g, 'whisperwood');
    placeAt(g, P, m.x, m.y);
    lyraStays(g, 141 * TILE, 101 * TILE);
    await g.save.save('manual');
    assert.ok(g.save.hasLocalSave(), 'a game to continue, before');
    fell(g);
    step(g, PLAYER_WINDOW + 1, 0.1);
    assert.equal(events(g, 'player_died')[0].mode, 'final');
    assert.equal(g.state, 'dead');
    const memorial = await g.survival.pending;
    assert.ok(memorial?.lyra?.text.length > 40, 'her last diary entry about them');
    assert.ok(memorial.village.length >= 3, 'what the village says');
    assert.match(memorial.cause, /bled out in Whisperwood, at night, alone/);
    assert.ok(g.companion.mind.diary.some((d) => d.text === memorial.lyra.text), 'it is in her diary');
    // The save: closed, never continued, from this device or any copy.
    assert.equal(g.save.hasLocalSave(), false);
    assert.equal(await g.save.hasSave(), false);
    assert.equal(await g.save.load(), null);
    const raw = JSON.parse(store.getItem(SAVE_KEY));
    assert.ok(isClosedSave(raw) && raw.memorial?.name === 'Ash');
    assert.equal(await g.save.save('manual'), false, 'nothing saves over the ending');
    const lives = readPastLives(store);
    assert.equal(lives.length, 1);
    assert.equal(lives[0].name, 'Ash');
    // An older live copy in the cloud does not bring it back.
    const cloudOld = { version: 1, savedAt: raw.savedAt - 5000, player: { id: 'player' } };
    assert.ok(isClosedSave(pickNewer(raw, cloudOld).data));
  } finally {
    delete globalThis.localStorage;
  }
});

test('"wake at home" (the softer setting): the old way, a little poorer', async () => {
  const g = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g);
  const P = g.player;
  const coins = P.gold;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraStays(g, m.x + 900, m.y);
  fell(g);
  step(g, PLAYER_WINDOW + 1, 0.1);
  assert.equal(events(g, 'player_died')[0].mode, 'home');
  await g.survival.pending;
  assert.equal(g.state, 'playing');
  assert.ok(!P.downed);
  assert.equal(P.gold, coins - Math.floor(coins * 0.1));
  assert.equal(g.locations.at(P.x, P.y)?.id, 'player_home');
});

test('the player rescues Lyra: carries her (slowly, no sword) to a sickroom cot; she remembers who saved her', () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const L = g.companion;
  const sq = at(g, 'town_square');
  for (const v of villagers(g)) placeAt(g, v, 141 * TILE, 101 * TILE);
  P.inventory.remove('potion', P.inventory.count('potion'));
  placeAt(g, P, sq.x, sq.y);
  lyraStays(g, sq.x + 14, sq.y);
  step(g, 0.3);
  const w = wolf(g, L.x + 10, L.y);
  g.combat.damage(w, L, 999);
  w.removed = true;
  assert.ok(L.downed && g.survival.isFallen(L), 'she has her own window');
  assert.equal(g.survival.fallOf(L).kind, 'lyra');
  assert.equal(L.interactLabel(P), 'Carry Lyra');
  P.faceToward(L.x, L.y);
  assert.ok(g.interactions.tryInteract(P));
  assert.equal(L.carriedBy, P, 'on your shoulders');
  assert.ok(g.survival.speedFactor(P) < 0.7, 'slow walk');
  assert.equal(g.survival.promptFor(P), 'Put Lyra down');
  // No sword while carrying.
  g.input.press('attack');
  step(g, 0.05);
  assert.equal(P.swing, null);
  // She is carried, not abandoned, however long the walk.
  step(g, 50, 0.1);
  assert.ok(!L.mind.autonomy.ledger?.some?.((d) => d.deed === 'abandoned_downed'));
  const cot = g.objects.get('sickbed_1');
  placeAt(g, P, cot.sleepSpot.x, cot.sleepSpot.y + 4);
  step(g, 0.1);
  assert.equal(g.survival.promptFor(P), 'Lay Lyra in the cot');
  g.input.press('interact');
  step(g, 0.1);
  assert.ok(!L.carriedBy && !L.downed, 'laid in the cot');
  assert.ok(g.survival.patients.has(L));
  assert.equal(L.state, 'sleep');
  assert.ok(Math.abs(L.x - cot.x) < 2, 'lying in it');
  assert.ok(L.mind.autonomy.ledger.some((d) => d.deed === 'revived_lyra'), 'a deed she counts');
  assert.ok(L.mind.memory.all().some((mm) => /carried me to Mira/.test(mm.text)), 'she remembers it');
  assert.ok(g.village?.rumors?.list?.some((r) => r.kind === 'carried_lyra'), 'and the village talks');
  step(g, PATIENT_SECONDS + 1, 0.1);
  assert.ok(!g.survival.patients.has(L), 'rested');
  assert.notEqual(L.state, 'sleep');
  assert.ok(L.hp >= Math.round(L.maxHp * 0.5));

  // With a potion, the player gets her up on the spot.
  const w2 = wolf(g, L.x + 10, L.y, 'wolf2');
  g.combat.damage(w2, L, 999);
  w2.removed = true;
  P.inventory.add('potion', 1);
  placeAt(g, P, L.x + 10, L.y);
  assert.equal(L.interactLabel(P), 'Give Lyra a potion');
  L.interact(P);
  assert.ok(!L.downed && L.hp === Math.round(L.maxHp * POTION_REVIVE_HP));
  assert.equal(P.inventory.count('potion'), 0);
});

test('the player carries a villager to Mira’s: they remember who saved them, and the village hears of it', () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const hobb = g.entities.get('hobb');
  const sq = at(g, 'town_square');
  for (const v of villagers(g)) if (v !== hobb) placeAt(g, v, 141 * TILE, 101 * TILE);
  lyraStays(g, 20 * TILE, 20 * TILE, 'gone');
  P.inventory.remove('potion', P.inventory.count('potion'));
  placeAt(g, hobb, sq.x, sq.y);
  placeAt(g, P, sq.x + 12, sq.y);
  step(g, 0.3);
  const w = wolf(g, hobb.x - 10, hobb.y);
  g.combat.damage(w, hobb, 999);
  w.removed = true;
  assert.ok(hobb.downed && g.survival.isFallen(hobb));
  const op = hobb.opinionOfPlayer;
  assert.equal(hobb.interactLabel(), 'Carry Hobb');
  hobb.interact(P);
  assert.equal(hobb.carriedBy, P);
  step(g, 5);
  assert.ok(hobb.downed, 'still down: nobody helped him up off your shoulders');
  const cot = g.objects.get('sickbed_2');
  placeAt(g, P, cot.sleepSpot.x, cot.sleepSpot.y + 4);
  assert.equal(g.survival.carrierInteract(P), true);
  assert.ok(g.survival.patients.has(hobb));
  assert.equal(hobb.savedBy, 'player');
  assert.ok(hobb.opinionOfPlayer >= op + 15, 'he remembers');
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'carried_villager' && r.victim === 'hobb'));
  step(g, PATIENT_SECONDS + 1.5, 0.1);
  assert.equal(hobb.mode, 'routine');
  assert.ok(g.said.some((s) => s.who === 'hobb' && /carried me|owe you|carried me here/.test(s.text)), 'he thanks you');
});

test('wanted when you fall: the watch carries you to the guardhouse cell, then Mira’s sickroom', async () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const sq = at(g, 'town_square');
  lyraStays(g, 20 * TILE, 20 * TILE, 'gone');
  for (const v of villagers(g)) if (!v.isGuard) placeAt(g, v, 141 * TILE, 101 * TILE);
  const rowan = g.entities.get('rowan');
  placeAt(g, rowan, sq.x + 200, sq.y + 40);
  const wys = g.entities.get('wys');
  placeAt(g, wys, 141 * TILE, 101 * TILE);
  placeAt(g, P, sq.x, sq.y);
  step(g, 0.3);
  P.crime = { level: 1, kind: 'assault', until: g.clock.t + 600, victimId: 'bram', since: g.clock.t, t: g.clock.t };
  const rec = fell(g);
  assert.ok(rec.wanted);
  assert.equal(g.survival.jobFor(rowan)?.role, 'arrest');
  assert.ok(stepUntil(g, () => !g.survival.isFallen(P), 80) > 0);
  assert.equal(events(g, 'delivered')[0].bed.id, 'cell_cot', 'the cell first');
  await g.survival.pending;
  assert.equal(P.crime, null, 'the matter is settled');
  assert.equal(g.locations.at(P.x, P.y)?.id, 'herbalist', 'then the sickroom');
  assert.ok(g.toasts.some((x) => /guardhouse cell/.test(x.text)));
});

test('edge cases: water pulls you to the bank; hostiles stop at a fallen body; both down — a patrol may come, or not', () => {
  // Water.
  const g = makeGame({ hour: 14 });
  alone(g);
  const P = g.player;
  let water = null;
  for (let ty = 40; ty < 70 && !water; ty++) for (let tx = 105; tx < 130 && !water; tx++) if (g.map.isWater(tx, ty) && !g.map.isWater(tx - 1, ty)) water = { tx, ty };
  assert.ok(water, 'the lake');
  P.x = water.tx * TILE + 8;
  P.y = water.ty * TILE + 8;
  const rec = fell(g);
  assert.ok(rec.wet);
  const t = tileOf(P);
  assert.ok(!g.map.isWater(t.tx, t.ty), 'pulled to the bank');
  const left = rec.left;
  const t0 = rec.t;
  step(g, 5);
  assert.ok(left - rec.left > (rec.t - t0) * RATE.water * 0.95, 'cold water steals the window faster');
  // Nothing can hurt the fallen.
  const w = wolf(g, P.x + 8, P.y, 'w_edge');
  assert.equal(g.combat.damage(w, P, 50), 0);

  // Both down, in the hem of the ward by day: a patrol finds you.
  const g2 = makeGame({ hour: 10 });
  const P2 = g2.player;
  const farm = at(g2, 'reed_farm');
  for (const v of villagers(g2)) placeAt(g2, v, 141 * TILE, 101 * TILE);
  placeAt(g2, P2, farm.x, farm.y);
  lyraStays(g2, farm.x + 16, farm.y);
  step(g2, 0.3);
  const wl = wolf(g2, g2.companion.x + 8, g2.companion.y, 'wl');
  g2.combat.damage(wl, g2.companion, 999);
  wl.removed = true;
  g2.rng = { next: () => 0.1, fork: () => g2.rng, pick: (a) => a[0] };
  fell(g2);
  assert.equal(g2.survival.jobs.size, 0, 'nobody near');
  assert.ok(stepUntil(g2, () => g2.survival.jobs.size > 0, 40) > 0, 'a patrol of the watch');
  const [guard] = [...g2.survival.jobs.keys()];
  assert.ok(guard.isGuard);
  // …or not: deep in the wood at night, nobody comes.
  const g3 = makeGame({ hour: 23 });
  const P3 = g3.player;
  const wood = at(g3, 'whisperwood');
  for (const v of villagers(g3)) placeAt(g3, v, 141 * TILE, 101 * TILE);
  placeAt(g3, P3, wood.x, wood.y);
  lyraStays(g3, wood.x + 16, wood.y);
  step(g3, 0.3);
  const w3 = wolf(g3, g3.companion.x + 8, g3.companion.y, 'w3');
  g3.combat.damage(w3, g3.companion, 999);
  w3.removed = true;
  fell(g3);
  step(g3, 40, 0.1);
  assert.equal(g3.survival.jobs.size, 0, 'nobody');
});

test('a save made while bleeding out keeps the fall; reloading does not escape it', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const m = at(g, 'south_meadow');
  placeAt(g, g.player, m.x, m.y);
  lyraStays(g, m.x + 900, m.y);
  const r0 = fell(g);
  step(g, 12);
  const left = r0.left;
  const data = JSON.parse(JSON.stringify({ player: g.player.serialize(), survival: g.survival.serialize() }));
  const g2 = makeGame({ hour: 14 });
  alone(g2);
  g2.player.deserialize(data.player);
  g2.survival.deserialize(data.survival);
  const rec = g2.survival.fallOf(g2.player);
  assert.ok(rec && g2.player.downed, 'still bleeding');
  assert.ok(left < PLAYER_WINDOW - 10 && Math.abs(rec.left - left) < 0.2, `the window goes on from where it was (${rec.left} vs ${left})`);
});

test('villagers and Lyra have windows of their own: nobody comes, and they are out for a day', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const hess = g.entities.get('hess');
  const wood = at(g, 'whisperwood');
  for (const v of villagers(g)) {
    if (v === hess) continue;
    placeAt(g, v, 141 * TILE, 101 * TILE);
    v.onCallForHelp = () => {}; // nobody hears her out there
  }
  placeAt(g, hess, wood.x, wood.y);
  placeAt(g, g.player, 20 * TILE, 100 * TILE);
  lyraStays(g, 20 * TILE, 20 * TILE);
  step(g, 0.3);
  const w = wolf(g, hess.x + 8, hess.y);
  g.combat.damage(w, hess, 999);
  w.removed = true;
  assert.ok(g.survival.isFallen(hess));
  step(g, 40, 0.1);
  assert.ok(hess.downed, 'no getting up alone at 30 s any more');
  step(g, 40, 0.1);
  const p = g.survival.patients.get(hess);
  assert.ok(p, 'carried off');
  assert.equal(p.kind, 'grave');
  assert.ok(p.until - g.clock.t > 800, 'out for a day');
  assert.match(p.bed.id, /^sickbed_/);
});

test('the memorial reads like her, and like the village', () => {
  const g = makeGame({ hour: 14 });
  const m = composeMemorial(g, { place: 'South Meadow', anyoneCame: false });
  assert.equal(m.name, 'Ash');
  assert.ok(m.lyra.text.includes('Ash'));
  assert.ok(m.village.some((v) => v.id === 'aveline' && /flame/.test(v.text)));
  assert.match(m.cause, /South Meadow/);
});
