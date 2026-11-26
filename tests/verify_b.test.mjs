import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame as makeMurderGame, step as stepWorld, px, put, villagers, events } from './murder_world.mjs';
import { Stats } from '../src/core/stats.js';

// The murder world with the game's stat pipeline on (game.js: every managed actor's speed is
// written from it every frame, so a pace changed by hand does not last a frame).
function makeGame(o) {
  const g = makeMurderGame(o);
  g.stats = new Stats(g);
  g.stats.manage(g.companion);
  return g;
}
function step(g, seconds, dt = 1 / 20) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepWorld(g, dt, dt);
    g.stats.update(dt);
  }
}

// Round 14b, independent verifier B: what playing the author's list by hand found.

// Item 11 (the author: "Layla … just runs away. And why can't I kill her?"). Struck once, Lyra
// leaves you, or keeps her distance, and steps away at up to 1.3 of her 80 px/s, ahead of the
// stranger's 76: she never fled (the only state that tired her), so a stranger who chased her
// across the meadow for 40 s never once came within a sword's reach. Running from the stranger
// tires her whatever her reason for keeping away.
for (const st of ['left', 'wary']) {
  test(`a Lyra who keeps away from you (${st}) tires when you chase her, and can be caught`, () => {
    const g = makeGame({ hour: 12 });
    for (const v of villagers(g)) {
      put(v, px(141), px(101));
      v.think = () => {};
    }
    const P = g.player;
    const L = g.companion;
    put(P, px(97), px(103));
    put(L, px(99), px(103));
    const a = L.mind.autonomy;
    if (st === 'wary') a.stats = () => ({ fear: 80, affinity: -50, trust: 0 });
    a.setCompanionship(st, 'struck');
    step(g, 1);
    let closest = Infinity;
    let windedAt = null;
    for (let t = 0; t < 40; t += 0.05) {
      const dx = L.x - P.x;
      const dy = L.y - P.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        P.x += (dx / d) * P.speed * 0.05;
        P.y += (dy / d) * P.speed * 0.05;
      }
      step(g, 0.05);
      if (windedAt == null && L._windedFrom != null) windedAt = t;
      if (windedAt != null && t > windedAt + 0.5 && L._windedFrom != null) assert.ok(L.speed < 60, `winded, her pace is down (${L.speed})`);
      if (windedAt != null && t > windedAt + 1) closest = Math.min(closest, Math.hypot(L.x - P.x, L.y - P.y));
    }
    assert.ok(windedAt != null && windedAt < 15, `she tires (winded at ${windedAt})`);
    assert.ok(events(g, 'winded').length >= 1);
    assert.ok(closest < 22, `the stranger comes within a sword's reach of her: ${closest.toFixed(1)} px`);
  });
}

test('Lyra walking her own way, nobody after her, never tires', () => {
  const g = makeGame({ hour: 12 });
  for (const v of villagers(g)) {
    put(v, px(141), px(101));
    v.think = () => {};
  }
  const P = g.player;
  const L = g.companion;
  put(P, px(20), px(20));
  put(L, px(99), px(103));
  L.mind.autonomy.setCompanionship('left', 'struck');
  step(g, 30);
  assert.equal(L._windedFrom ?? null, null);
});

// Item 11, played by hand: two sword blows and Lyra leaves you; her parting scene began (she
// walked up, spoke, and the chat opened to her with the keyboard in its field), and the
// stranger, still swinging, typed "jjjj" and "wasd" into it: no sword and no feet until it was
// closed. Struck while she says it, or fighting back, the scene is over (the letter is left on
// the table), and the chat it opens never takes the keys from someone moving or fighting.
test('struck during her parting words, the scene ends: the letter on the table, the chat never takes the keys of a fighting player', () => {
  const g = makeMurderGame({ hour: 11, settings: { partingScene: true } });
  const L = g.companion;
  const P = g.player;
  const sq = g.locations.get('town_square').center;
  put(P, sq.x, sq.y);
  put(L, sq.x + 3 * 16, sq.y);
  const a = L.mind.autonomy;
  let focus = null;
  g.ui.chat = { field: { blur: () => (focus = 'blurred') }, addMessage() {}, open() {} };
  g.ui.talkTo = (id) => {
    focus = id === 'lyra' ? 'field' : focus;
    return true;
  };
  // Moving (a key held) when the chat opens: the field gives the keys back.
  const held = new Set(['up']);
  g.input.down = (k) => held.has(k);
  a.recordDeed('hit_lyra', {});
  a.setCompanionship('left', 'You struck me with your sword.', { cause: 'violence' });
  assert.equal(a.parting.active, true, 'she walks up to say it');
  for (let i = 0; i < 40 && Math.hypot(L.x - P.x, L.y - P.y) > 2 * 16; i++) stepWorld(g, 0.5);
  stepWorld(g, 4);
  assert.equal(focus, 'blurred', 'the chat opened to her, but did not take the keys of someone moving');
  // A blow while she speaks: it is over.
  a.recordDeed('hit_lyra', {});
  stepWorld(g, 1);
  assert.equal(a.parting.active, false, 'struck mid-scene, the scene ends');
  assert.ok(g.flags.lyra_letter, 'the letter is left');
  assert.equal(P.inventory.count('lyra_letter'), 0, 'on the table, not handed over');
});

// Leftover (blood: "only a watch that knows arrests you"). Downed by a guard who never heard
// of your crime (you struck him; he struck back) is a fight, not an arrest: the watch's record
// stays. Downed by one who knows: settled where you fell, as before.
test('per knower: a guard who downs you without knowing you are wanted does not settle the crime', () => {
  const g = makeMurderGame({ hour: 12 });
  for (const v of villagers(g)) {
    put(v, px(141), px(101));
    v.think = () => {};
  }
  const rowan = g.entities.get('rowan');
  const P = g.player;
  const record = () => ({ level: 1, kind: 'assault', until: g.clock.t + 600, victimId: 'bram', since: g.clock.t, t: g.clock.t });
  P.crime = record();
  assert.equal(g.combat.knowsCrime(rowan, P), false, 'Rowan has not heard of it');
  P.onDowned(rowan);
  assert.ok(g.combat.hasCrime(P), 'the record stands: he did not arrest you');
  P._down = false;
  P.downed = false;
  P.crime = record();
  g.village.addRumor('attacked_villager', { victim: 'bram', witnesses: ['rowan'] });
  assert.equal(g.combat.knowsCrime(rowan, P), true, 'told: now he knows');
  P.onDowned(rowan);
  assert.equal(g.combat.hasCrime(P), false, 'downed by a guard who knows: arrested');
});

// The same rule for the words Claude is given: Lyra walking up to a villager is told they are
// "shaken" by your crime only if that villager knows of it.
test('per knower: a villager who never heard of your crime is not briefed as shaken by it', async () => {
  const { buildConversationTask } = await import('../src/ai/brain/prompt.js');
  const g = makeMurderGame({ hour: 12 });
  const elda = g.entities.get('elda');
  const P = g.player;
  P.crime = { level: 1, kind: 'assault', until: g.clock.t + 600, victimId: 'bram', since: g.clock.t, t: g.clock.t };
  const text = (t) => (typeof t === 'string' ? t : JSON.stringify(t));
  assert.ok(!/is shaken/.test(text(buildConversationTask(g, elda))), 'Elda has not heard');
  g.village.addRumor('attacked_villager', { victim: 'bram', witnesses: ['elda'] });
  assert.match(text(buildConversationTask(g, elda)), /is shaken/, 'told: now she is');
});

// Item 21 ("a burned store"), looked at: the general store burned at noon looked whole. Its
// scorch was drawn among the people and things, under the roof the map draws over them, so
// nothing showed; and Garrick stood at his door crying "Potions! Bread! Lanterns!" over his
// burned shop. The map lets a plugin draw on a roof (roofDecor); the occupation scorches a
// burned building's roof with it; and an owner whose shop burned says so instead of selling.
test('a burned store shows on its roof, and its owner does not cry his wares over it', async () => {
  const { Occupation } = await import('../src/world/occupation.js');
  const g = makeMurderGame({ hour: 12 });
  g.occupation = new Occupation(g);
  const occ = g.occupation;
  const st = g.locations.get('general_store');
  const bld = g.map.buildings.find((b) => b.x < st.bounds.x + st.bounds.w && b.x + b.w > st.bounds.x && b.y < st.bounds.y + st.bounds.h && b.y + b.h > st.bounds.y);
  assert.ok(bld, 'the store has a building on the map');
  const ctx = () => {
    const calls = [];
    return { calls, save() {}, restore() {}, fillRect: (...a) => calls.push(a), drawImage() {}, set globalAlpha(v) {}, get globalAlpha() { return 1; }, set fillStyle(v) {}, get fillStyle() { return ''; } };
  };
  assert.equal(typeof g.map.roofDecor, 'function', 'the occupation draws on roofs');
  const before = ctx();
  g.map.roofDecor(before, bld, { x: bld.x * 16, y: bld.y * 16 - 16, w: bld.w * 16, h: bld.h * 16 }, 0, 0, 1, 1);
  assert.equal(before.calls.length, 0, 'a whole roof is left alone');
  occ.burn('general_store', g.player);
  const after = ctx();
  g.map.roofDecor(after, bld, { x: bld.x * 16, y: bld.y * 16 - 16, w: bld.w * 16, h: bld.h * 16 }, 0, 0, 1, 1);
  assert.ok(after.calls.length > 40, `the burned roof is scorched (${after.calls.length} marks)`);
  // Garrick by his burned shop: his own words for it, never his wares.
  const garrick = g.entities.get('garrick');
  const line = occ.burnedLine?.(garrick);
  assert.ok(line && !/Potions|Buy something|Lanterns!/.test(line), `his line: ${line}`);
  assert.equal(occ.burnedLine?.(g.entities.get('bram')) ?? null, null, 'Bram\'s smithy stands');
});
