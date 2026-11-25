import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, placeAt, wolf, villagers } from './survival_world.mjs';
import { TILE } from '../src/core/constants.js';
import { CRAWL_SPEED, CRAWL_BUDGET, NPC_CRAWL, RATE } from '../src/survival/constants.js';
import { paintHumanoid, CRAWL_ANIM, CRAWL_STEP, FRAME } from '../src/art/characters_humanoid.js';
import { PRESET_APPEARANCES } from '../src/art/characters_appearance.js';

// A heavier death (DESIGN §27, round 14): the countdown you can read, the crawl, the
// ember-ring your coins stay in, and the last stand.

const at = (g, id) => g.locations.get(id).center;

function alone(g) {
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  g.survival.lyraForVillager = () => {};
}

function banish(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    placeAt(g, v, 141 * TILE, 101 * TILE);
    v.think = () => {};
  }
}

function lyraAway(g, x, y) {
  const L = g.companion;
  placeAt(g, L, x, y);
  L.behavior.setDirective({ type: 'stay', x, y });
}

function fell(g) {
  const P = g.player;
  const w = wolf(g, P.x + 12, P.y);
  g.combat.damage(w, P, 999);
  w.removed = true;
  return g.survival.fallOf(P);
}

// ---------------------------------------------------------------- D2: the crawl

function opaque(sp) {
  const px = sp.render();
  const out = [];
  for (let i = 0; i < FRAME * FRAME; i++) if (px[i * 4 + 3] > 0) out.push(i);
  return { px, set: out };
}

test('the crawl is painted in every direction: four distinct frames, arms reaching past the head, lower than standing', () => {
  for (const key of ['player', 'lyra', 'villager']) {
    const a = { ...PRESET_APPEARANCES[key], key };
    for (const dir of ['down', 'left', 'right', 'up']) {
      const frames = [];
      for (let f = 0; f < CRAWL_ANIM.frames; f++) frames.push(opaque(paintHumanoid(a, 'crawl', dir, f)));
      for (const fr of frames) assert.ok(fr.set.length > 120, `${key} ${dir}: a whole body (${fr.set.length} px)`);
      const sig = frames.map((fr) => fr.set.join(','));
      assert.equal(new Set(sig).size, CRAWL_ANIM.frames, `${key} ${dir}: every frame differs (the limbs move)`);
      const lying = opaque(paintHumanoid(a, 'down', dir, 0)).set.join(',');
      assert.ok(!sig.includes(lying), `${key} ${dir}: not the plain lying pose`);
      const standing = opaque(paintHumanoid(a, 'idle', dir, 0));
      const top = (fr) => Math.floor(fr.set[0] / FRAME);
      if (dir === 'up' || dir === 'down') {
        // Laid on the ground: the body takes less height than standing.
        for (const fr of frames) assert.ok(top(fr) > top(standing) + 1, `${key} ${dir}: lower than standing (${top(fr)} vs ${top(standing)})`);
      } else {
        // Laid along the ground: wider than tall.
        for (const fr of frames) {
          const xs = fr.set.map((i) => i % FRAME);
          const ys = fr.set.map((i) => Math.floor(i / FRAME));
          assert.ok(Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys), `${key} ${dir}: lying along the ground`);
        }
      }
    }
  }
});

test('the player drags themselves: slow, the frame follows the distance, blood smears behind; carried or revived, the pose is gone', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  banish(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraAway(g, m.x + 900, m.y);
  const rec = fell(g);
  assert.equal(P.crawlPose, null, 'lying still: the fallen pose');
  const marks0 = g.survival.trail.marks.length;
  assert.ok(marks0 >= 1, 'a pool where they fell');
  step(g, 2.5); // the slow-motion beat passes
  g.input.move = { x: 1, y: 0 };
  const x0 = P.x;
  const frames = new Set();
  for (let i = 0; i < 40; i++) {
    step(g, 0.05);
    if (P.crawlPose) frames.add(P.crawlPose.frame);
  }
  const moved = P.x - x0;
  assert.ok(moved > 0.8 * 2 * CRAWL_SPEED && moved < 1.1 * 2 * CRAWL_SPEED, `about ${CRAWL_SPEED} px a second (${moved.toFixed(1)} in 2 s)`);
  assert.ok(CRAWL_SPEED * 4 < (P.speed || 60), 'far slower than walking');
  assert.equal(frames.size, CRAWL_ANIM.frames, 'the whole cycle plays');
  assert.equal(P.crawlPose.frame, Math.floor(rec.crawled / CRAWL_STEP) % CRAWL_ANIM.frames, 'the frame is the distance');
  assert.equal(P.dir, 'right', 'facing the way they crawl');
  assert.ok(g.survival.trail.marks.length >= marks0 + Math.floor(moved / 3), `a smear behind them (${g.survival.trail.marks.length - marks0} marks)`);
  assert.ok(g.survival.trail.marks.every((mk) => mk.x <= P.x + 1), 'the smear is behind, not ahead');
  assert.equal(g.survival.rateOf(rec), RATE.crawling, 'crawling opens the wound');
  // Stop: the pose holds (face down) and the drain eases.
  g.input.move = { x: 0, y: 0 };
  step(g, 0.2);
  assert.ok(P.crawlPose, 'still face down where they stopped');
  assert.equal(g.survival.rateOf(rec), RATE.alone);
  // Out of room: no further.
  g.input.move = { x: 0, y: 1 };
  step(g, 12);
  assert.ok(rec.crawled <= CRAWL_BUDGET + 0.5, `only a little (${rec.crawled.toFixed(1)})`);
  // Revived: back on their feet, the crawl pose cleared.
  g.input.move = { x: 0, y: 0 };
  g.combat.revive(P, null, 0.5);
  step(g, 0.1);
  assert.ok(!P.downed);
  assert.equal(P.crawlPose, null);
});

test('a villager on the ground drags themselves away from whoever stands over them, slower still, and leaves blood', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  const m = at(g, 'south_meadow');
  banish(g, ['hobb']);
  lyraAway(g, m.x + 1200, m.y);
  placeAt(g, g.player, m.x - 400, m.y);
  const hobb = g.entities.get('hobb');
  placeAt(g, hobb, m.x, m.y);
  hobb.think = () => {};
  const w = wolf(g, m.x + 14, m.y);
  w.think = () => {};
  w.update = () => {};
  g.combat.damage(w, hobb, 999);
  assert.ok(hobb.downed, 'down');
  const rec = g.survival.fallOf(hobb);
  assert.ok(rec);
  const d0 = Math.hypot(hobb.x - w.x, hobb.y - w.y);
  step(g, 3);
  const d1 = Math.hypot(hobb.x - w.x, hobb.y - w.y);
  assert.ok(d1 > d0 + 0.6 * 3 * CRAWL_SPEED * NPC_CRAWL, `away from the wolf (${d0.toFixed(1)} -> ${d1.toFixed(1)})`);
  assert.ok(d1 - d0 < 3 * CRAWL_SPEED * NPC_CRAWL + 2, 'slowly');
  assert.ok(hobb.crawlPose && Number.isInteger(hobb.crawlPose.frame), 'in the crawl');
  assert.ok(g.survival.trail.marks.length > 4, 'blood behind them');
  step(g, 20);
  assert.ok(rec.crawled <= CRAWL_BUDGET + 0.5, 'a little, then no further');
  // Nobody over them: they lie still.
  w.removed = true;
  const x = hobb.x;
  rec.crawled = 0;
  step(g, 2);
  assert.ok(Math.abs(hobb.x - x) < 0.01, 'no danger, no crawl');
});

// ---------------------------------------------------------------- D1: the countdown

test('the countdown: seconds left and how fast they go; the heart races as the window closes, then falters', () => {
  const g = makeGame({ hour: 14 });
  alone(g);
  banish(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  placeAt(g, P, m.x, m.y);
  lyraAway(g, m.x + 900, m.y);
  const rec = fell(g);
  step(g, 2.5);
  let cd = g.survival.countdown(P);
  assert.ok(Math.abs(cd.left - rec.left) < 1e-9 && cd.window === rec.window && Math.abs(cd.frac - rec.left / rec.window) < 1e-9);
  assert.equal(cd.rate, RATE.alone);
  assert.equal(cd.help, null, 'nobody is with you');
  g.input.move = { x: 1, y: 0 };
  step(g, 0.3);
  assert.equal(g.survival.countdown(P).rate, RATE.crawling, 'crawling: faster');
  g.input.move = { x: 0, y: 0 };
  // The heart: slow and steady with most of the window left, racing near the end, then
  // faltering (weaker, uneven, some beats missing) in the last stretch.
  const bpmAt = (left) => {
    rec.left = left;
    g.survival.realtime(0.01);
    return g.survival.heart.bpm;
  };
  const early = bpmAt(rec.window * 0.95);
  const mid = bpmAt(rec.window * 0.5);
  const late = bpmAt(rec.window * 0.15);
  assert.ok(early < mid && mid < late, `the heart speeds up (${early.toFixed(0)} < ${mid.toFixed(0)} < ${late.toFixed(0)})`);
  assert.ok(early < 80 && late > 130, 'from a resting beat to racing');
  bpmAt(rec.window * 0.03);
  assert.ok(g.survival.heart.falter > 0.5, 'it falters at the very end');
  // Beats in 10 s of real time, early vs late: more of them as it closes.
  const count = (left) => {
    rec.left = left;
    const b0 = g.survival.heart.beats;
    for (let i = 0; i < 200; i++) {
      rec.left = left;
      g.survival.realtime(0.05);
    }
    return g.survival.heart.beats - b0;
  };
  const slow = count(rec.window * 0.9);
  const fast = count(rec.window * 0.2);
  assert.ok(fast > slow * 1.6, `you hear it race (${slow} beats in 10 s, then ${fast})`);
  assert.ok(!g.survival.countdown(g.companion), 'only for someone fallen');
});

test('the countdown shows who is saving you and how far along: a salve kneeling, the carry to a cot with its distance closing', () => {
  // Mira kneels with her salves: progress fills.
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const sq = at(g, 'town_square');
  banish(g, ['mira']);
  lyraAway(g, 20 * TILE, 20 * TILE);
  g.companion.mind.autonomy.companionship = 'gone';
  placeAt(g, P, sq.x, sq.y);
  const mira = g.entities.get('mira');
  placeAt(g, mira, sq.x + 60, sq.y);
  step(g, 0.3);
  fell(g);
  let seen = [];
  for (let i = 0; i < 400 && g.survival.isFallen(P); i++) {
    step(g, 0.05);
    const h = g.survival.countdown(P)?.help;
    if (h) seen.push({ kind: h.kind, p: h.progress, who: h.who?.id });
  }
  const salve = seen.filter((x) => x.kind === 'salve');
  assert.ok(salve.length > 5, 'Mira is dressing the wound');
  assert.equal(salve[0].who, 'mira');
  assert.ok(salve.at(-1).p > salve[0].p && salve.at(-1).p > 0.8, 'and it fills');

  // Rowan carries: the bar fills and the time to the cot shrinks; slower drain on his shoulders.
  const g2 = makeGame({ hour: 14 });
  const P2 = g2.player;
  const sq2 = at(g2, 'town_square');
  lyraAway(g2, 20 * TILE, 20 * TILE);
  g2.companion.mind.autonomy.companionship = 'gone';
  placeAt(g2, g2.entities.get('mira'), 25 * TILE, 53 * TILE);
  banish(g2, ['rowan', 'mira']);
  const rowan = g2.entities.get('rowan');
  placeAt(g2, rowan, sq2.x + 100, sq2.y);
  placeAt(g2, P2, sq2.x, sq2.y);
  step(g2, 0.3);
  fell(g2);
  const carry = [];
  for (let i = 0; i < 1600 && g2.survival.isFallen(P2); i++) {
    step(g2, 0.05);
    const cd = g2.survival.countdown(P2);
    if (cd?.help?.kind === 'carry') carry.push({ p: cd.help.progress, eta: cd.help.eta, to: cd.help.to, rate: cd.rate });
  }
  assert.ok(carry.length > 20, `carried (${carry.length} samples)`);
  assert.equal(carry[0].to, 'sickroom');
  assert.equal(carry[0].rate, RATE.carried, 'held tight: slower');
  assert.ok(carry.at(-1).p > 0.85, `nearly there at the end (${carry.at(-1).p.toFixed(2)})`);
  const timed = carry.filter((c) => Number.isFinite(c.eta));
  assert.ok(timed.length > 10 && timed.at(-1).eta < timed[0].eta - 5, `the time to the cot shrinks (${timed[0].eta.toFixed(1)} s -> ${timed.at(-1).eta.toFixed(1)} s)`);
  // never goes backwards by much (roads bend)
  for (let i = 1; i < carry.length; i++) assert.ok(carry[i].p >= carry[i - 1].p - 0.05, 'progress only grows');
});

// ---------------------------------------------------------------- D3: the ember-ring

async function dieAt(g, x, y) {
  const P = g.player;
  placeAt(g, P, x, y);
  P.invuln = 0;
  assert.ok(fell(g), 'down');
  step(g, g.survival.fallOf(P).window + 2, 0.1);
  await g.survival.pending;
}

test('death costs everything you carry: the coins stay where you fell in an ember-ring; walk back and take them', async () => {
  const g = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g);
  banish(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  lyraAway(g, m.x + 900, m.y);
  P.inventory.add('coin', 57 - P.gold);
  assert.equal(P.gold, 57);
  await dieAt(g, m.x, m.y);
  const died = g.events.filter((e) => e.type === 'player_died').at(-1).p;
  assert.equal(died.mode, 'home');
  assert.equal(died.ring.coins, 57);
  assert.equal(P.gold, 0, 'nothing in your purse');
  const ring = g.survival.ring;
  assert.ok(ring && ring.coins === 57, 'an ember-ring holds them');
  assert.ok(Math.hypot(ring.x - m.x, ring.y - m.y) < 30, 'where you fell');
  assert.ok(g.entities.get(ring.id) === ring, 'in the world');
  assert.ok(ring.getLight(1), 'it glows at night');
  assert.ok(g.toasts.some((t) => /57 coins, lies where you fell/.test(t.text) && /ring of embers/.test(t.text)), 'the waking words say so');
  assert.deepEqual(g.survival.mapMarks().map((k) => [k.kind, k.coins]), [['ember_ring', 57]], 'a mark for the map');
  assert.match(g.survival.promptContext(), /57\) still lies where they died/, 'Lyra knows');
  // Saved with the game and back on load.
  const saved = g.survival.serialize();
  assert.equal(saved.ring.coins, 57);
  assert.ok(JSON.stringify(saved.ring).length < 160, 'small');
  const g2 = makeGame({ hour: 14 });
  g2.survival.deserialize(JSON.parse(JSON.stringify(saved)));
  assert.equal(g2.survival.ring?.coins, 57);
  assert.ok(g2.entities.get(g2.survival.ring.id));
  // Not from home: too far to take.
  assert.equal(g.survival.takeRing(P), false);
  assert.ok(!g.interactions.best(P) || g.interactions.best(P).target !== ring);
  // Walk back: the prompt offers it; E takes it.
  placeAt(g, P, ring.x, ring.y + 10);
  step(g, 0.2);
  const best = g.interactions.best(P);
  assert.equal(best?.target, ring);
  assert.equal(best.label, 'Take back your 57 coins');
  assert.ok(g.interactions.tryInteract(P));
  assert.equal(P.gold, 57, 'all of it back');
  assert.equal(g.survival.ring, null);
  step(g, 0.1);
  assert.ok(!g.entities.get(ring.id), 'the embers are gone');
  assert.equal(g.events.filter((e) => e.type === 'ember_ring_taken').length, 1);
  assert.equal(g.survival.serialize().ring, undefined);
});

test('die again before you reach the embers and those coins are gone for good; die with nothing and there is no ring; the end leaves none', async () => {
  const g = makeGame({ hour: 14, settings: { deathMode: 'home' } });
  alone(g);
  banish(g);
  const P = g.player;
  const m = at(g, 'south_meadow');
  lyraAway(g, m.x + 900, m.y);
  P.inventory.add('coin', 40 - P.gold);
  await dieAt(g, m.x, m.y);
  const first = g.survival.ring;
  assert.equal(first.coins, 40);
  // Earn a little more and die somewhere else before going back.
  P.inventory.add('coin', 9);
  const sq = at(g, 'town_square');
  await dieAt(g, sq.x + 200, sq.y + 60);
  assert.ok(first.taken, 'the first ring went out');
  assert.equal(g.events.filter((e) => e.type === 'ember_ring_lost').at(-1).p.coins, 40);
  const second = g.survival.ring;
  assert.ok(second && second !== first && second.coins === 9, 'a new ring holds only what you had this time');
  assert.ok(g.toasts.some((t) => /before have gone out: those 40 coins are gone for good/.test(t.text)));
  step(g, 0.1);
  assert.ok(!g.entities.all().includes(first), 'the old embers are gone from the world');
  // Die again with an empty purse: the ring goes out, and no new one.
  await dieAt(g, m.x - 100, m.y);
  assert.equal(P.gold, 0);
  assert.equal(g.survival.ring, null, 'nothing carried, nothing left');
  // The end of the story: no ring (there is nobody to come back for it).
  const g3 = makeGame({ hour: 14 });
  alone(g3);
  banish(g3);
  lyraAway(g3, m.x + 900, m.y);
  g3.player.inventory.add('coin', 20);
  placeAt(g3, g3.player, m.x, m.y);
  fell(g3);
  step(g3, g3.survival.fallOf(g3.player).window + 2, 0.1);
  assert.equal(g3.state, 'dead');
  assert.equal(g3.survival.ring, null);
});

test('a rescue is not a death: carried to the sickroom, your coins stay in your purse (less Mira\'s bill)', async () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const sq = at(g, 'town_square');
  lyraAway(g, 20 * TILE, 20 * TILE);
  g.companion.mind.autonomy.companionship = 'gone';
  placeAt(g, g.entities.get('mira'), 25 * TILE, 53 * TILE);
  banish(g, ['rowan', 'mira']);
  placeAt(g, g.entities.get('rowan'), sq.x + 100, sq.y);
  placeAt(g, P, sq.x, sq.y);
  step(g, 0.3);
  const coins = P.gold;
  fell(g);
  for (let i = 0; i < 1600 && g.survival.isFallen(P); i++) step(g, 0.05);
  await g.survival.pending;
  assert.ok(!P.downed);
  assert.equal(g.survival.ring, null, 'no embers: you did not die');
  assert.ok(P.gold > 0 && P.gold >= coins - 15);
});

// ---------------------------------------------------------------- D4: the last stand

import { installProgression, BOSS_SECOND_PRICES } from '../src/progression/index.js';
import { Prices, LAST_STAND_SECONDS } from '../src/magic/prices.js';
import { lightKeptFlame } from '../src/survival/kept_flame.js';

function withPrices(opts = {}) {
  const g = makeGame({ hour: 14, ...opts });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  alone(g);
  banish(g);
  const m = at(g, 'south_meadow');
  lyraAway(g, m.x + 900, m.y);
  placeAt(g, g.player, m.x, m.y);
  return g;
}

function run(g, seconds, dt = 0.1) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    if (g.state !== 'playing') break;
    step(g, dt, dt);
    g.stats.update(dt);
    g.prices.update(dt);
  }
}

test('the Last Stand says its price in full, and only a yes in the game\'s own dialog takes it up; it can be put out while held', async () => {
  const d = Prices.get('laststand');
  assert.match(d.costText, /die for good/);
  assert.match(d.costText, /no kept flame/);
  assert.match(d.costText, /no rescue/);
  assert.match(d.costText, /waking at home/);
  assert.match(d.gainText, /one minute/);
  const g = withPrices();
  const asked = [];
  let answer = false;
  g.ui.confirm = (o) => {
    asked.push(o);
    return Promise.resolve(answer);
  };
  const P = g.player;
  g.prices.pay(P, { priceDefs: [d] });
  assert.equal(asked.length, 1, 'asked');
  assert.equal(asked[0].danger, true);
  assert.match(asked[0].text, /die for good/);
  assert.match(asked[0].text, /No kept flame/);
  assert.match(asked[0].text, /this save closes/);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(g.prices.state.laststand, null, 'no: not taken up');
  answer = true;
  g.prices.pay(P, { priceDefs: [d] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(g.prices.state.laststand, 'armed', 'yes: held');
  const chip = g.prices.timers(P).find((m) => m.price === 'laststand');
  assert.ok(chip && chip.tap === 'douse', 'a mark on the HUD, tap to put it out');
  assert.ok(g.events.some((e) => e.type === 'price_paid' && e.p.price === 'laststand' && e.p.first), 'Lyra hears of it');
  g.prices.pay(P, { priceDefs: [d] });
  assert.equal(asked.length, 2, 'held already: not asked again');
  assert.ok(g.prices.douse('laststand'));
  assert.equal(g.prices.state.laststand, null);
  assert.ok(!g.prices.timers(P).some((m) => m.price === 'laststand'));
  // "Try all magic" cannot lend it.
  g.magic = { realUnlocked: { prices: new Set() } };
  g.prices.pay(P, { priceDefs: [d] });
  assert.equal(asked.length, 2, 'not offered on a borrowed weave');
  assert.ok(g.toasts.some((t) => /cannot be borrowed/.test(t.text)));
});

test('held when the window closes: you rise for a minute, burning and unstoppable, then die for good (flame or home, it ends)', async () => {
  for (const mode of ['flame', 'home']) {
    const g = withPrices(mode === 'home' ? { settings: { deathMode: 'home' } } : {});
    const P = g.player;
    if (mode === 'flame') {
      P.inventory.add('coin', 200);
      assert.ok(lightKeptFlame(g, P).ok);
    }
    g.prices.armLastStand(P);
    const atk0 = g.stats.get(P, 'atk');
    const rec = fell(g);
    run(g, rec.window + 1);
    assert.ok(!P.downed && P.hp === P.maxHp, `${mode}: risen, whole`);
    assert.ok(g.prices.burning(), 'burning');
    assert.ok(Math.abs(g.prices.lastStandLeft() - LAST_STAND_SECONDS) < 1.5);
    assert.ok(g.stats.get(P, 'atk') >= atk0 * 2.4, `far stronger (${atk0} -> ${g.stats.get(P, 'atk')})`);
    assert.ok(!g.survival.isFallen(P));
    assert.equal(g.survival.ring, null, 'no ember-ring: nobody comes back for it');
    assert.ok(g.events.some((e) => e.type === 'price_triggered' && e.p.price === 'laststand'));
    // Nothing puts them down for the minute.
    const w = wolf(g, P.x + 10, P.y);
    g.combat.damage(w, P, 9999);
    assert.ok(!P.downed && P.hp >= 1, 'cannot fall');
    w.removed = true;
    run(g, 30);
    assert.ok(g.prices.lastStandLeft() < 31 && g.prices.lastStandLeft() > 28);
    const timer = g.prices.timers(P).find((m) => m.id === 'price:laststand:cost');
    assert.ok(timer && Math.abs(timer.left - g.prices.lastStandLeft()) < 0.01, 'the HUD counts it down');
    run(g, 32);
    assert.equal(g.state, 'dead', `${mode}: the story ends`);
    const died = g.events.filter((e) => e.type === 'player_died').at(-1).p;
    assert.equal(died.mode, 'final');
    assert.equal(died.cause, 'laststand');
    const memorial = await g.survival.pending;
    assert.match(memorial.cause, /one last burning minute/);
    if (mode === 'flame') assert.ok(g.flags.keptFlame, 'the flame was not spent: it could not help');
  }
});

test('while down with it held you may choose to rise at once; lastlight saves you first; berserk\'s end cannot fell you while you burn; a save keeps the minute', () => {
  const g = withPrices();
  const P = g.player;
  g.prices.armLastStand(P);
  const rec = fell(g);
  run(g, 3);
  assert.ok(rec && g.survival.isFallen(P));
  assert.ok(g.survival.riseInstead(P, 'chosen'));
  assert.ok(!P.downed && g.prices.burning());
  assert.ok(!g.survival.isFallen(P), 'the fall is over');
  // Berserk ending mid-burn: the heart has nothing left to give out.
  g.prices.state.berserk = { t: 0.05 };
  run(g, 0.3);
  assert.ok(!P.downed, 'berserk ends; the fire burns on');
  // Saved mid-burn: the minute goes on after a reload.
  run(g, 10);
  const saved = JSON.parse(JSON.stringify(g.prices.serialize()));
  assert.ok(saved.laststand > 45 && saved.laststand < 51, `${saved.laststand} s saved`);
  const g2 = withPrices();
  g2.prices.deserialize(saved);
  assert.ok(g2.prices.burning() && Math.abs(g2.prices.lastStandLeft() - saved.laststand) < 0.01);

  // Lastlight and the last stand both held: lastlight holds the wound shut first.
  const g3 = withPrices();
  const P3 = g3.player;
  g3.prices.state.lastlight = 'armed';
  g3.prices.armLastStand(P3);
  const w = wolf(g3, P3.x + 10, P3.y);
  g3.combat.damage(w, P3, 9999);
  assert.ok(!P3.downed, 'lastlight caught the fall');
  assert.equal(g3.prices.state.lastlight, 'used');
  assert.equal(g3.prices.state.laststand, 'armed', 'the last stand is still held');
});

test('the Bone Warden carries the Last Stand: a second shard beside its own, never at the start', () => {
  assert.deepEqual(BOSS_SECOND_PRICES.bone_warden_laststand, { boss: 'bone_warden', id: 'laststand' });
  const g = withPrices();
  const known = new Set();
  g.magic = { unlocked: { prices: known }, realUnlocked: { prices: known }, unlock: (k, id) => known.add(id) };
  assert.ok(!known.has('laststand'), 'not at the start');
  g.bus.emit('boss_defeated', { id: 'bone_warden', boss: { x: g.player.x, y: g.player.y - 40 } });
  const shards = g.entities.all().filter((e) => e.glyphId);
  assert.deepEqual(shards.map((s) => s.glyphId).sort(), ['laststand', 'overdraw']);
  assert.equal(g.flags.price_shard_bone_warden_laststand, 'dropped');
  assert.equal(g.flags.price_shard_bone_warden, 'dropped');
});
