// Round 15, the author's Version 12 playtest (DESIGN §40): the hands workstream.
//   6. "when I use a spell and I leave it, the highlight of where it would go or where I can aim it
//      stays on": the aim preview is drawn only while a weave is pressed or held, and goes the
//      moment the cast ends, is cancelled, refused, or let go by the runtime (a roll, a stun).
//   9. "I can like break iron without any specialized tools. Why is that?": iron needs a pickaxe.
//  11. "I cannot focus on a training dummy": the lock takes the dummy (and any hittable target).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { Weaving } from '../src/ui/weaving.js';
import { makeMagicStub } from './helpers/magic_stub.mjs';

// ---------------------------------------------------------------- 6: the aim preview

function bus() {
  const subs = new Map();
  return {
    on(t, fn) {
      if (!subs.has(t)) subs.set(t, []);
      subs.get(t).push(fn);
      return () => {};
    },
    emit(t, p) {
      for (const fn of subs.get(t) || []) fn(p);
    },
  };
}

// A small world for the weave controller (as tests/controls.test.mjs), with a mouse over the
// game (renderer.cssToWorld is the identity) and a foe in front: a fight, the mouse aiming.
function world(opts = {}) {
  const foes = [];
  const g = {
    state: 'playing',
    paused: false,
    hitStop: 0,
    time: 0,
    settings: { ...(opts.settings || {}) },
    bus: bus(),
    player: {
      x: 100,
      y: 100,
      facing: { x: 1, y: 0 },
      isAlive: () => true,
      faceToward(x, y) {
        const l = Math.hypot(x - this.x, y - this.y) || 1;
        this.facing = { x: (x - this.x) / l, y: (y - this.y) / l };
      },
    },
    companion: { id: 'lyra', type: 'actor', x: 130, y: 300, isAlive: () => true },
    entities: { all: () => [g.player, g.companion, ...foes] },
    combat: { isHostile: (a, b) => !!b.hostile },
    ui: { isModalOpen: () => false },
  };
  g.input = new Input(g);
  g.magic = makeMagicStub(g, opts);
  g.renderer = { cssToWorld: (x, y) => ({ x, y }) };
  g.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  g.addFoe = (x, y) => {
    const f = { type: 'actor', x, y, hostile: true, isAlive: () => true };
    foes.push(f);
    return f;
  };
  return g;
}

function step(g, w, n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    g.time += dt;
    w.update(dt);
    g.magic.update(dt);
    g.input.endFrame();
  }
}

// The mouse moves over the game (it keeps "aiming" for a few seconds after).
function mouseAt(g, x, y) {
  g.input._onPointerMove({ pointerType: 'mouse', clientX: x, clientY: y, target: g.canvas });
}

// What the aim layer would draw this frame: the casts' previews and the faint guide.
const drawn = (g, w) => w.aims.length + (w.hover && g.settings.aimGuideIdle === true ? 1 : 0);
const keyDown = (g, d) => g.input._onKeyDown({ code: `Digit${d}`, key: String(d), target: null, preventDefault() {} });
const keyUp = (g, d) => g.input._onKeyUp({ code: `Digit${d}`, key: String(d) });

test('6: a held key shows the aim, and the release clears it at once (keys 1-4 with the mouse)', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  mouseAt(g, 170, 96);
  keyDown(g, 1);
  step(g, w, 40);
  assert.equal(w.aims.length, 1, 'held past the tap: the aim shows');
  keyUp(g, 1);
  step(g, w);
  assert.equal(g.magic.released.length, 1, 'cast on the release');
  for (let i = 0; i < 180; i++) {
    mouseAt(g, 170 + (i % 9), 96 - (i % 5)); // the mouse keeps moving in the fight
    step(g, w);
    assert.equal(w.aims.length, 0, `no cast preview ${i} steps after the release`);
    assert.equal(w.hover, null, `no faint guide ${i} steps after the release (the author: "the highlight ... stays on")`);
  }
});

test('6: a click on a hotbar slot, held and dragged out to aim: nothing is drawn after the release', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  w.clickStart(0, 1);
  step(g, w, 30);
  mouseAt(g, 40, 30);
  step(g, w, 30);
  assert.equal(w.aims.length, 1);
  w.clickEnd(1);
  step(g, w);
  assert.equal(g.magic.released.length, 1);
  for (let i = 0; i < 150; i++) {
    mouseAt(g, 40 + (i % 7), 30);
    step(g, w);
    assert.equal(drawn(g, w), 0, `cleared ${i} steps after the click's release`);
    assert.equal(w.hover, null);
  }
});

test('6: the right button (the marked weave) and the pad trigger clear on the release too', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  mouseAt(g, 170, 96);
  g.input.setVirtual('cast', true);
  step(g, w, 40);
  assert.equal(w.aims.length, 1);
  g.input.setVirtual('cast', false);
  step(g, w);
  assert.equal(g.magic.released.length, 1);
  for (let i = 0; i < 60; i++) {
    mouseAt(g, 170, 96 + (i % 3));
    step(g, w);
    assert.equal(drawn(g, w), 0);
    assert.equal(w.hover, null);
  }
  // A pad: the right stick held over, the trigger pressed and let go.
  g.input.padAim = { x: 1, y: 0 };
  g.input.lastDevice = 'gamepad';
  g.magic.cooldowns.fill(0);
  g.input.setVirtual('cast', true);
  step(g, w, 40);
  assert.equal(w.aims.length, 1, 'the pad trigger shows its aim while held');
  g.input.setVirtual('cast', false);
  step(g, w);
  step(g, w, 30);
  assert.equal(w.aims.length, 0);
  assert.equal(w.hover, null, 'the stick still held over shows nothing once the cast is gone');
});

test('6: touch: a tap, a drag-aim, a full charge and a drag back to cancel each clear the moment the finger lifts', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  // tap
  w.touchStart(0, 1);
  step(g, w, 3);
  assert.equal(w.aims.length, 1, 'a finger on a button shows its aim');
  w.touchEnd(1);
  step(g, w);
  assert.equal(w.aims.length, 0);
  // drag to aim
  g.magic.cooldowns.fill(0);
  w.touchStart(0, 2);
  step(g, w);
  w.touchMove(2, -60, -40);
  step(g, w, 20);
  w.touchEnd(2);
  step(g, w);
  assert.equal(w.aims.length, 0);
  // hold to charge (full)
  g.magic.cooldowns.fill(0);
  g.magic.mana.cur = g.magic.mana.max;
  w.touchStart(1, 3);
  step(g, w, 120);
  assert.equal(w.aims.length, 1);
  assert.ok(w.aims[0].charge > 0.9);
  w.touchEnd(3);
  step(g, w);
  assert.equal(w.aims.length, 0);
  // drag back to cancel
  g.magic.cooldowns.fill(0);
  w.touchStart(0, 4);
  step(g, w);
  w.touchMove(4, 80, 0);
  step(g, w);
  w.touchMove(4, 3, 2);
  step(g, w);
  assert.ok(w.aims[0].cancel);
  w.touchEnd(4);
  step(g, w);
  assert.equal(w.aims.length, 0);
  assert.equal(w.casts.size, 0);
});

test('6: a press refused for mana or cooldown draws nothing, now or after', () => {
  const g = world({ mana: 1 });
  const w = new Weaving(g);
  g.addFoe(160, 100);
  mouseAt(g, 170, 96);
  keyDown(g, 1);
  step(g, w, 60);
  assert.equal(w.aims.length, 0, 'refused for mana: no preview while held');
  keyUp(g, 1);
  for (let i = 0; i < 60; i++) {
    mouseAt(g, 170, 96 + (i % 3));
    step(g, w);
    assert.equal(drawn(g, w), 0);
    assert.equal(w.hover, null, 'and no faint guide after the refusal');
  }
  // On cooldown.
  g.magic.mana.cur = g.magic.mana.max;
  g.magic.cooldowns[0] = 5;
  w.touchStart(0, 9);
  step(g, w, 30);
  assert.equal(w.aims.length, 0, 'refused for the cooldown: no preview under the finger');
  w.touchEnd(9);
  step(g, w, 5);
  assert.equal(w.aims.length, 0);
});

test('6: when the runtime lets a hold go (a roll breaks the charge, a stun), its preview goes with it, the finger or key still down', () => {
  for (const how of ['key', 'touch', 'click']) {
    const g = world();
    const w = new Weaving(g);
    g.addFoe(160, 100);
    mouseAt(g, 170, 96);
    if (how === 'key') keyDown(g, 1);
    else if (how === 'touch') w.touchStart(0, 5);
    else w.clickStart(0, 5);
    step(g, w, 50);
    assert.equal(w.aims.length, 1, `${how}: charging, the aim shows`);
    // The roll (magic.breakCast) or a freeze (interruptHold) ends the hold in the runtime.
    g.magic.castCancel(g.player);
    step(g, w);
    assert.equal(w.aims.length, 0, `${how}: the broken charge draws nothing (the author: "stays on")`);
    step(g, w, 60);
    assert.equal(w.aims.length, 0, `${how}: still nothing while the ${how} is held`);
    assert.equal(w.hover, null);
    const before = g.magic.released.length;
    if (how === 'key') keyUp(g, 1);
    else if (how === 'touch') w.touchEnd(5);
    else w.clickEnd(5);
    step(g, w, 3);
    assert.equal(g.magic.released.length, before, `${how}: letting go after the break casts nothing`);
    assert.equal(w.aims.length, 0);
  }
});

test('6: casting while planted (§14): the second press shows its aim only while held, and clears at its release', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  keyDown(g, 1);
  step(g, w, 2);
  keyUp(g, 1);
  step(g, w); // the first cast: a tap (the plant would hold the body now)
  g.magic.cooldowns.fill(0);
  keyDown(g, 2);
  step(g, w, 30);
  assert.equal(w.aims.length, 1);
  keyUp(g, 2);
  step(g, w);
  assert.equal(w.aims.length, 0);
  assert.equal(w.hover, null);
});

test('6: the faint guide between casts is an opt-in (Settings: Aim guide between casts), never an afterglow', () => {
  const g = world({ settings: { aimGuideIdle: true } });
  const w = new Weaving(g);
  // Walking about, nothing near: no guide even when opted in.
  mouseAt(g, 170, 96);
  step(g, w, 20);
  assert.equal(w.hover, null, 'no foe near: only the reticle');
  // A cast just now, nobody near: the old 2.5 s afterglow is gone.
  keyDown(g, 1);
  step(g, w, 2);
  keyUp(g, 1);
  step(g, w);
  for (let i = 0; i < 30; i++) {
    mouseAt(g, 170, 96 + (i % 3));
    step(g, w);
    assert.equal(w.hover, null, 'no afterglow after a cast');
  }
  // Opted in and a foe near: the faint guide shows while the mouse aims.
  g.addFoe(160, 100);
  step(g, w, 20);
  mouseAt(g, 170, 96);
  step(g, w);
  assert.ok(w.hover && w.hover.faint, 'opted in, in a fight: the faint guide');
  // Off (the default): never.
  const g2 = world();
  const w2 = new Weaving(g2);
  g2.addFoe(160, 100);
  for (let i = 0; i < 40; i++) {
    mouseAt(g2, 170, 96 + (i % 3));
    step(g2, w2);
    assert.equal(w2.hover, null);
  }
});

// ---------------------------------------------------------------- 11: lock-on

import { makeGame, placeAt, step as stepWorld } from './survival_world.mjs';
import { LockOn } from '../src/core/lock_on.js';
import { SPECIES, spawnCreature } from '../src/entities/monsters.js';
import { BossManager } from '../src/bosses/manager.js';
import { Tempter } from '../src/story/villain.js';

// The yard by the training dummy, with nobody else within the lock's reach.
function yard() {
  const g = makeGame({ hour: 12 });
  g.lock = new LockOn(g);
  const dummy = g.objects.all().find((o) => o.objType === 'dummy');
  const P = g.player;
  placeAt(g, P, dummy.x - 30, dummy.y);
  P.facing = { x: 1, y: 0 };
  for (const e of g.entities.all()) if (e !== P && e.type === 'actor' && Math.hypot(e.x - P.x, e.y - P.y) < 400) placeAt(g, e, e.x + 3000, e.y);
  return { g, P, dummy };
}

test('11: the training dummy locks: middle click on it, G with nobody else near, the phone\'s long press (the same nearest-in-front)', () => {
  const { g, P, dummy } = yard();
  const id = (e) => e?.id ?? null; // (compare ids: a failed match on the game graph would print all of it)
  assert.equal(g.lock.valid(dummy), true, 'the dummy is a target (the author: "I cannot focus on a training dummy")');
  assert.equal(id(g.lock.press({ x: dummy.x + 2, y: dummy.y - 16 })), dummy.id, 'a middle click on its straw chest');
  assert.equal(id(g.lock.target), dummy.id);
  g.lock.update(0.1);
  assert.equal(id(g.lock.target), dummy.id, 'it stays locked');
  g.lock.clear();
  assert.equal(id(g.lock.press()), dummy.id, 'G (and the long press on the sword button): the nearest in front');
  // A foe near comes first; the dummy is still in the cycle.
  const w = spawnCreature(g, 'bandit', P.x + 36, P.y + 24);
  g.lock.clear();
  assert.equal(id(g.lock.press()), id(w), 'a bandit beside the dummy: the fight first');
  const seen = new Set([id(g.lock.cycle(1)), id(g.lock.cycle(1))]);
  assert.ok(seen.has(dummy.id), 'the wheel reaches the dummy');
});

test('11: locked on the dummy, the weaves aim at it and the sword swings at it, not at a tree beside it', () => {
  const { g, P, dummy } = yard();
  g.lock.set(dummy);
  assert.equal(g.lock.aimTarget(200)?.id ?? null, dummy.id, 'every weave source aims at the lock (weaving.aimFor)');
  // Turn away from it: the attack turns back to the lock and the blow lands on the dummy.
  placeAt(g, P, dummy.x - 14, dummy.y + 2);
  P.facing = { x: -1, y: 0 };
  const hits = [];
  g.bus.on('dummy_hit', (p) => hits.push(p));
  P.attack();
  for (let i = 0; i < 20; i++) g.entities.update?.(1 / 60);
  assert.ok(P.facing.x > 0.5, 'the blade turned to the locked dummy behind');
  assert.ok(hits.length >= 1, 'and the blow landed on it');
});

test('11: every hittable target locks: each creature, the villagers, the tempter, each boss, the downed, the dummy', () => {
  const { g, P } = yard();
  const bad = [];
  for (const sp of Object.keys(SPECIES)) {
    const c = spawnCreature(g, sp, P.x + 40, P.y);
    if (!g.lock.valid(c)) bad.push(sp);
    g.entities.remove?.(c);
    c.removed = true;
  }
  const bram = g.entities.get('bram');
  placeAt(g, bram, P.x + 30, P.y);
  if (!g.lock.valid(bram)) bad.push('bram');
  const t = g.entities.add(new Tempter(g, { stand() {} }, P.x + 36, P.y - 10));
  if (!g.lock.valid(t)) bad.push('the tempter');
  g.bosses = new BossManager(g);
  g.bosses.onWorldBuilt();
  for (const b of g.entities.all().filter((e) => e.boss || e.def?.id)) {
    // The night's boss is not there by day, the Lake's Hum is under the water until its fight:
    // in its fight, each is there to hit, and to lock.
    b.mode = 'fight';
    b.hidden = false;
    placeAt(g, P, b.x - (b.radius || 8) - 24, b.y);
    for (const e of g.entities.all()) if (e !== P && e !== b && e.type === 'actor' && Math.hypot(e.x - P.x, e.y - P.y) < 60) placeAt(g, e, e.x + 3000, e.y);
    if (!g.lock.valid(b)) bad.push(`boss ${b.id}`);
    else if (g.lock.press({ x: b.x, y: b.y - 10 }) !== b) bad.push(`boss ${b.id} (click)`);
    g.lock.clear();
  }
  assert.deepEqual(bad, [], 'none refused');
});

// ---------------------------------------------------------------- 9: iron needs a pickaxe

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { strikeProp } from '../src/world/breakables.js';
import { blowAtChest, lockedChest } from '../src/world/containers.js';
import { shopOf, DAILY } from '../src/world/trade.js';
import { ITEMS } from '../src/entities/items.js';
import { MISSIONS } from '../src/missions/data.js';
import { Game } from '../src/core/game.js';

// At an iron ore vein in the quarry, nobody else near.
function quarry({ pick = false } = {}) {
  const g = makeGame({ hour: 10 });
  const ore = g.objects.all().find((o) => o.objType === 'ore' && !o.state.depleted);
  const P = g.player;
  placeAt(g, P, ore.x - 14, ore.y + 2);
  P.facing = { x: 1, y: 0 };
  for (const e of g.entities.all()) if (e !== P && e.type === 'actor' && Math.hypot(e.x - P.x, e.y - P.y) < 300) placeAt(g, e, e.x + 3000, e.y);
  if (pick) P.inventory.add('pickaxe', 1);
  return { g, P, ore };
}
const said = (g, re) => g.toasts.some((t) => re.test(t.text));

test('9: bare hands: the vein says what it needs ("Mine iron ore: needs a pickaxe"), the use button and the attack button give nothing', () => {
  const { g, P, ore } = quarry();
  assert.equal(ore.interactLabel(P), 'Mine iron ore: needs a pickaxe', 'the prompt names the tool before you try');
  assert.equal(ore.canInteract(P), true, 'the prompt still shows (so it can say so)');
  assert.equal(ore.canWork(P), false);
  ore.interact(P);
  assert.ok(said(g, /need a pickaxe for iron/i), 'the use button: the word, with where to get one');
  for (let i = 0; i < 8; i++) {
    P.attack();
    stepWorld(g, 0.5);
  }
  assert.equal(P.inventory.count('iron_ore'), 0, 'no ore by hand or by the sword (the author: "I can like break iron without any specialized tools")');
  assert.equal(ore.state.depleted, false, 'the vein is whole');
  assert.ok(said(g, /rings off it/i), 'the blade rings off it, and says so');
});

test('9: no weave breaks iron: a Strike, a heavy weave or a beam ring off the vein', () => {
  const { g, P, ore } = quarry();
  for (const blow of [{ punch: true, amount: 60 }, { heavy: true, amount: 60, charge: 1 }, { amount: 8, tick: true }]) {
    assert.equal(strikeProp(g, ore, { source: P, ...blow }), true, 'it takes the blow (a missile stops at it)');
    g.time += 5;
  }
  assert.equal(ore.state.depleted, false);
  assert.equal(P.inventory.count('iron_ore'), 0);
  assert.ok(said(g, /does not break for a weave/i));
});

test('9: with a pickaxe the vein is mined, by the use button and by the attack button', () => {
  const { g, P, ore } = quarry({ pick: true });
  assert.equal(ore.interactLabel(P), 'Mine iron ore (pickaxe)');
  ore.interact(P);
  stepWorld(g, 6);
  assert.ok(P.inventory.count('iron_ore') >= 1, 'mined with the use button');
  const ore2 = g.objects.all().find((o) => o.objType === 'ore' && !o.state.depleted && o !== ore);
  placeAt(g, P, ore2.x - 12, ore2.y + 2);
  P.facing = { x: 1, y: 0 };
  const before = g.entities.all().filter((e) => e.type === 'pickup' && e.itemId === 'iron_ore').length;
  for (let i = 0; i < 40 && !ore2.state.depleted; i++) {
    P.attack();
    stepWorld(g, 0.4);
  }
  assert.ok(ore2.state.depleted, 'the attack button swings the pick');
  const drops = g.entities.all().filter((e) => e.type === 'pickup' && e.itemId === 'iron_ore').length;
  assert.ok(drops > before || P.inventory.count('iron_ore') >= 2, 'and the ore comes away');
});

test('9: plain rock and crystal stay as they were; villagers who dig (Bram, Lyra on his errand) carry their own pick', () => {
  const { g, P } = quarry();
  const rock = g.objects.all().find((o) => o.objType === 'rock' && !o.state.depleted);
  assert.equal(rock.canWork(P), true, 'rock by hand');
  const crystal = g.objects.all().find((o) => o.objType === 'crystal');
  if (crystal) assert.equal(crystal.canWork(P), true, 'crystal by hand');
  const ore = g.objects.all().find((o) => o.objType === 'ore');
  for (const id of ['bram', 'tilly', 'lyra']) {
    const who = g.entities.get(id);
    if (who) assert.equal(ore.canWork(who), true, `${id} digs with their own pick`);
  }
});

test('9: an iron hasp breaks only to a pickaxe at the chest: no blow, no bare hands', async () => {
  const g = makeGame({ hour: 12 });
  const chest = g.objects.get('guard_footlocker');
  const P = g.player;
  placeAt(g, P, chest.x, chest.y + 14);
  for (const e of g.entities.all()) if (e !== P && e.type === 'actor' && Math.hypot(e.x - P.x, e.y - P.y) < 400) placeAt(g, e, e.x + 3000, e.y);
  let asked = 0;
  g.ui.confirm = async () => {
    asked++;
    return true;
  };
  g.ui.openChest = () => {};
  for (const blow of [{}, { heavy: true }, { punch: true }]) {
    assert.equal(blowAtChest(g, chest, { source: P, ...blow }), 'iron');
    g.time += 5;
  }
  lockedChest(g, chest, P);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 0, 'bare hands: no offer to force it, only the word');
  assert.ok(said(g, /pickaxe/));
  assert.equal(chest.state.locked, true);
  P.inventory.add('pickaxe', 1);
  lockedChest(g, chest, P);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(asked, 1, 'with a pickaxe: break the hasp?');
  assert.equal(chest.state.locked, false, 'the hasp gives to the pick');
});

test('9: a pickaxe is there in time: Bram sells it, and a spare lies in the quarry tool chest by the ore veins', () => {
  assert.equal(ITEMS.pickaxe?.type, 'tool');
  const g = makeGame({ hour: 10 });
  const bram = g.entities.get('bram');
  const ware = shopOf(g, bram).sells.find((s) => s.id === 'pickaxe');
  assert.ok(ware && ware.price > 0 && ware.price <= 30, 'Bram sells one, for less than the first errand pays in ore');
  assert.ok(DAILY.bram.pickaxe >= 1, 'and keeps them in stock');
  const box = g.objects.get('quarry_tools');
  assert.ok(box && box.loot && box.inventory.count('pickaxe') === 1, 'the quarrymen\'s spare: free to take');
  const veins = g.objects.all().filter((o) => o.objType === 'ore');
  assert.ok(veins.every((o) => Math.hypot(o.x - box.x, o.y - box.y) < 26 * 16), 'in the quarry, within reach of every vein');
  const path = g.pathfinder?.find?.(g.player.x, g.player.y, box.x, box.y + 12, g.player);
  assert.ok(!g.pathfinder?.find || (path && path.length), 'a path to it');
  // Every mission that asks for ore comes after the pickaxe can be had (the chest is there
  // from the start; Bram's shop from the start): none is offered before the quarry is open.
  const ore = Object.values(MISSIONS || {}).flatMap((m) => (m.objectives || []).filter((o) => o.item === 'iron_ore').map((o) => [m.id, o.count]));
  assert.ok(ore.length >= 2);
  const most = Math.max(...ore.map(([, c]) => c));
  assert.ok(veins.length >= most, `one round of the quarry's veins (${veins.length}, 1-2 ore each, back in 2 days) fills the biggest ore errand (${most})`);
});

test('9: old saves load: a round 14b save with ore in the pack and a mined-out vein; the tool chest is there in it', () => {
  const old = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/save_aee713c.json.gz', import.meta.url))).toString('utf8'));
  // What a player of that save might hold: ore, and a vein mined that morning.
  const g0 = makeGame({ hour: 10 });
  const vein = g0.objects.all().find((o) => o.objType === 'ore');
  old.objects = (old.objects || []).filter((d) => d.id !== vein.id && d.id !== 'quarry_tools');
  old.objects.push({ id: vein.id, state: { depleted: true, regrowAt: (old.clock?.t ?? 0) + 900 } });
  const inv = old.player.inventory;
  if (Array.isArray(inv)) inv.push({ id: 'iron_ore', qty: 3 });
  else if (inv && typeof inv === 'object') (inv.items || inv)['iron_ore'] = 3;
  const g = makeGame({ hour: 10 });
  const errors = [];
  const err = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    Game.prototype.deserialize.call(g, old);
  } finally {
    console.error = err;
  }
  assert.deepEqual(errors, [], 'nothing failed to restore');
  assert.equal(g.player.inventory.count('iron_ore'), 3, 'the ore in the pack');
  assert.equal(g.objects.get(vein.id).state.depleted, true, 'the mined-out vein stays mined out');
  assert.equal(g.objects.get('quarry_tools')?.inventory.count('pickaxe'), 1, 'the quarry tool chest, in a save from before it');
  // And it saves and loads again with the pick taken.
  g.objects.get('quarry_tools').takeAll(g.player);
  const again = g.objects.serialize();
  const g2 = makeGame({ hour: 10 });
  g2.objects.deserialize(again);
  assert.equal(g2.objects.get('quarry_tools').inventory.count('pickaxe'), 0, 'taken stays taken');
});
