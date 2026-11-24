import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import {
  Combat,
  xpToNext,
  LEVEL_HP,
  LEVEL_ATK,
  SELF_REVIVE_SECONDS,
  ASSAULT_SECONDS,
  CRIME_EVENT_GAP,
  NPC_REVIVE_FALLBACK,
} from '../src/entities/combat.js';
import { DAY_SECONDS } from '../src/core/constants.js';
import { Player, COMBO, STARTING_INVENTORY } from '../src/entities/player.js';
import { Pickup, dropItem, pickupToastText } from '../src/entities/pickups.js';
import { Projectile } from '../src/entities/projectiles.js';
import { ITEMS } from '../src/entities/items.js';
import { PAINTED_ICONS, itemIconIds } from '../src/art/items_art.js';

// ---------------------------------------------------------------- a small fake game

function fakeInput() {
  const pressed = new Set();
  return {
    move: { x: 0, y: 0 },
    enabled: true,
    moveVector() {
      return this.move;
    },
    pressed: (a) => pressed.has(a),
    down: () => false,
    press: (a) => pressed.add(a),
    endFrame: () => pressed.clear(),
  };
}

function makeGame() {
  const game = {
    bus: new EventBus(),
    clock: { t: 0, daylight: 1 },
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: {},
    toasts: [],
    sounds: [],
    numbers: [],
    map: { blocksProjectile: () => false },
    objects: null,
    spawns: { player: { x: 50, y: 50 } },
    isBlockedTile: () => false,
    input: fakeInput(),
    interactions: { tryInteract: () => false, best: () => null },
    particles: { emit() {} },
    camera: { shake() {}, snap() {} },
    lighting: { flash() {} },
  };
  game.ui = {
    toast: (text, kind) => game.toasts.push({ text, kind }),
    isModalOpen: () => false,
    setInteractPrompt() {},
    fadeOut: () => Promise.resolve(),
    fadeIn: () => Promise.resolve(),
  };
  game.audio = { play: (name) => game.sounds.push(name) };
  game.bubbles = { number: (x, y, text) => game.numbers.push(text) };
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = () => 0.5; // no crits, no damage variance
  return game;
}

function log(game) {
  const out = [];
  game.bus.on('*', (type, payload) => out.push({ type, payload }));
  return out;
}

const of = (events, type) => events.filter((e) => e.type === type).map((e) => e.payload);

function actor(game, o = {}) {
  return game.entities.add(new Actor(game, { x: 100, y: 100, ...o }));
}

function addPlayer(game, o = {}) {
  const p = game.entities.add(new Player(game, { x: 100, y: 100, ...o }));
  game.player = p;
  return p;
}

function addLyra(game, o = {}) {
  const l = actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', maxHp: 50, atk: 7, ...o });
  game.companion = l;
  return l;
}

function step(game, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.clock.t += dt;
    game.entities.update(dt);
    game.combat.update(dt);
    game.input.endFrame();
  }
}

function press(game, action) {
  game.input.press(action);
  step(game, 1 / 60);
}

const flushPromises = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------- damage math

test('damage subtracts defense, never drops below 1, and crits multiply', () => {
  const g = makeGame();
  const ev = log(g);
  const src = actor(g, { faction: 'player', atk: 10, x: 80 });
  const wolf = actor(g, { faction: 'monster', def: 2, maxHp: 50 });
  assert.equal(g.combat.damage(src, wolf, 10), 8);
  assert.equal(wolf.hp, 42);
  assert.equal(g.combat.damage(src, wolf, 10), 0, 'i-frames block an immediate second hit');
  wolf.invuln = 0;
  assert.equal(g.combat.damage(src, wolf, 10, { crit: true }), 13); // 10 * 1.5 - 2
  const dmg = of(ev, 'damage');
  assert.equal(dmg.length, 2);
  assert.deepEqual(Object.keys(dmg[1]).sort(), ['amount', 'crit', 'kind', 'source', 'target']);
  assert.equal(dmg[1].crit, true);
  assert.equal(dmg[0].kind, 'melee');
  assert.equal(dmg[0].source, src);

  const golem = actor(g, { faction: 'monster', def: 40 });
  assert.equal(g.combat.damage(src, golem, 10), 1);

  // A natural 10% crit roll (and the +/-10% variance) when not forced.
  g.combat.random = () => 0.05;
  wolf.invuln = 0;
  const before = wolf.hp;
  const dealt = g.combat.damage(src, wolf, 10);
  assert.equal(dealt, Math.round(10 * 0.91 * 1.5 - 2));
  assert.equal(wolf.hp, before - dealt);
  assert.equal(of(ev, 'damage').at(-1).crit, true);
  assert.ok(wolf.knock.x === 0 || Number.isFinite(wolf.knock.x));
});

test('heavy hits freeze the world briefly and knock targets back', () => {
  const g = makeGame();
  const src = actor(g, { faction: 'player', x: 80 });
  const slime = actor(g, { faction: 'monster', maxHp: 99 });
  g.combat.damage(src, slime, 5, { knockback: 200 });
  assert.equal(g.hitStop, 0, 'a light hit does not freeze');
  assert.ok(slime.knock.x > 150, 'pushed away from the source');
  slime.invuln = 0;
  g.combat.damage(src, slime, 5, { heavy: true });
  assert.ok(g.hitStop >= 0.05);
});

// ---------------------------------------------------------------- who may hit whom

test('friendly fire: the player\'s sword hits everyone in its arc, Lyra and villagers included', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const lyra = addLyra(g, { x: 112, y: 100 });
  const villager = actor(g, { faction: 'villager', x: 114, y: 96, maxHp: 40 });
  const guard = actor(g, { faction: 'guard', x: 114, y: 104, maxHp: 40 });
  const slime = actor(g, { faction: 'monster', x: 113, y: 102, maxHp: 40 });
  const behind = actor(g, { faction: 'villager', x: 80, y: 100, maxHp: 40 });
  p.faceDir('right');
  assert.equal(g.combat.melee(p, { arc: 2, range: 30 }), true);
  assert.equal(g.combat.lastMeleeHits, 4);
  for (const hit of [lyra, villager, guard, slime]) assert.ok(hit.hp < hit.maxHp, `${hit.faction} was hit`);
  assert.equal(behind.hp, 40, 'nobody behind the swing is touched');
  // The damage payload stays exact so Lyra can tell an accident from an attack.
  const onLyra = of(ev, 'damage').find((d) => d.target === lyra);
  assert.deepEqual(Object.keys(onLyra).sort(), ['amount', 'crit', 'kind', 'source', 'target']);
  assert.equal(onLyra.source, p);
  assert.equal(onLyra.kind, 'melee');
  assert.equal(onLyra.amount, lyra.maxHp - lyra.hp);
  // A direct call from the player is not filtered either.
  behind.invuln = 0;
  assert.ok(g.combat.damage(p, behind, 5) > 0);
});

test('auto-aim turns the blade toward foes and game, never toward friends', () => {
  const g = makeGame();
  const p = addPlayer(g);
  addLyra(g, { x: 100, y: 116 });
  const villager = actor(g, { faction: 'villager', x: 116, y: 100, maxHp: 40 });
  p.faceDir('up');
  press(g, 'attack');
  assert.equal(p.dir, 'up', 'swinging near friends does not snap toward them');
  assert.equal(villager.hp, 40);
  step(g, 0.6);
  const rabbit = actor(g, { faction: 'wildlife', x: p.x - 12, y: p.y - 6, maxHp: 10 });
  rabbit.species = 'rabbit';
  press(g, 'attack');
  assert.equal(p.dir, 'left', 'game animals in front draw the blade');
  assert.ok(rabbit.hp < 10);
});

test('Lyra spares the player and villagers, but may strike back at whoever hurt her', () => {
  const g = makeGame();
  const p = addPlayer(g, { x: 112 });
  const lyra = addLyra(g, { x: 100, y: 100 });
  const villager = actor(g, { faction: 'villager', x: 100, y: 112, maxHp: 30 });
  const cat = actor(g, { faction: 'wildlife', x: 88, y: 100, maxHp: 10 });
  cat.species = 'cat';
  assert.equal(g.combat.damage(lyra, p, 10), 0, 'she cannot hurt the player unprovoked');
  assert.equal(g.combat.canHarm(lyra, villager, true), false, 'nor a villager, even on purpose');
  assert.equal(g.combat.canHarm(lyra, cat, true), false, 'nor the cat');
  // The player hits her: self-defense makes the player a valid chosen target (§16.5)...
  assert.ok(g.combat.damage(p, lyra, 5) > 0);
  assert.equal(g.combat.canHarm(lyra, p, false), false, 'never by accident');
  assert.equal(g.combat.canHarm(lyra, p, true), true);
  assert.ok(g.combat.damage(lyra, p, 6) > 0);
  // ...for a while.
  g.clock.t += 61;
  p.invuln = 0;
  assert.equal(g.combat.damage(lyra, p, 6), 0, 'the window closes');
});

test('other attackers hit enemies, or the target they chose, never allies', () => {
  const g = makeGame();
  const p = addPlayer(g, { x: 120 });
  const lyra = addLyra(g, { x: 100, y: 100 });
  const deer = actor(g, { faction: 'wildlife', x: 112, y: 100, maxHp: 40 });
  deer.species = 'deer';
  const slime = actor(g, { faction: 'monster', x: 113, y: 104, maxHp: 40 });
  lyra.faceDir('right');
  g.combat.melee(lyra, { arc: 2, range: 20 });
  assert.equal(deer.hp, 40, 'neutral wildlife is not caught in a non-player swing');
  assert.ok(slime.hp < 40);
  assert.equal(p.hp, p.maxHp);

  g.combat.update(1);
  g.combat.melee(lyra, { target: deer, arc: 1.2, range: 20 });
  assert.ok(deer.hp < 40, 'an explicit target can be wildlife');

  const wolf = actor(g, { faction: 'monster', x: 140, y: 100, maxHp: 40 });
  wolf.species = 'wolf';
  const rabbit = actor(g, { faction: 'wildlife', x: 128, y: 100, maxHp: 10 });
  wolf.faceDir('left');
  g.combat.melee(wolf, { arc: 2.4, range: 22, kind: 'bite' });
  assert.ok(p.hp < p.maxHp, 'monsters bite the player');
  assert.equal(rabbit.hp, 10, 'monsters leave neutral rabbits alone');

  const b1 = actor(g, { faction: 'bandit', x: 300, y: 300 });
  const b2 = actor(g, { faction: 'bandit', x: 310, y: 300, maxHp: 20 });
  g.combat.melee(b1, { target: b2 });
  assert.equal(b2.hp, 20, 'allies are spared even when targeted');
});

test('melee has its own cooldown but respects a cooldown set by the caller', () => {
  const g = makeGame();
  const wolf = actor(g, { faction: 'monster' });
  assert.equal(g.combat.melee(wolf), true);
  assert.equal(g.combat.melee(wolf), false, 'no per-frame swings');
  g.combat.update(0.5);
  wolf.attackCd = 1.2; // the creature AI set its own cooldown just before swinging
  assert.equal(g.combat.melee(wolf), true);
  assert.ok(wolf.attackCd >= 1.2);
});

test('wildlife hit by anyone fights back if boar or wolf, otherwise flees', () => {
  const g = makeGame();
  const p = addPlayer(g);
  const boar = actor(g, { faction: 'wildlife', x: 120, maxHp: 50 });
  boar.species = 'boar';
  const deer = actor(g, { faction: 'wildlife', x: 130, maxHp: 50 });
  deer.species = 'deer';
  assert.equal(g.combat.isHostile(boar, p), false);
  g.combat.damage(p, boar, 5);
  g.combat.damage(p, deer, 5);
  assert.equal(boar.provokedBy, p);
  assert.equal(boar.provokedMode, 'fight');
  assert.equal(deer.provokedMode, 'flee');
  assert.equal(g.combat.isHostile(boar, p), true);
  assert.equal(g.combat.isHostile(deer, p), false);
  assert.equal(g.combat.canHarm(boar, p, false), true, 'a provoked boar may gore its attacker');
});

// ---------------------------------------------------------------- projectiles

test('bolts pass the owner and allies and hit the first enemy in line', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g, { x: 120, y: 100 });
  const lyra = addLyra(g, { x: 100, y: 100 });
  const villager = actor(g, { faction: 'villager', x: 140, y: 100, maxHp: 30 });
  const slime = actor(g, { faction: 'monster', x: 180, y: 100, maxHp: 40 });
  const bolt = g.combat.shoot(lyra, slime.x, slime.y, 'bolt', { target: slime });
  assert.ok(bolt instanceof Projectile);
  assert.equal(bolt.type, 'projectile');
  assert.equal(of(ev, 'attack').at(-1).kind, 'bolt');
  step(g, 1);
  assert.ok(bolt.removed);
  assert.equal(p.hp, p.maxHp);
  assert.equal(villager.hp, 30);
  assert.equal(slime.hp, 40 - 7);
  const hit = of(ev, 'damage').at(-1);
  assert.equal(hit.kind, 'bolt');
  assert.equal(hit.source, lyra);
});

test('arrows stick in walls and then disappear', () => {
  const g = makeGame();
  g.map.blocksProjectile = (tx) => tx >= 12;
  const archer = actor(g, { faction: 'bandit', x: 100, y: 100 });
  const arrow = g.combat.shoot(archer, 300, 100, 'arrow');
  step(g, 0.5);
  assert.equal(arrow.state, 'stuck');
  assert.ok(arrow.x < 12 * 16);
  assert.ok(!arrow.removed);
  step(g, 1.5);
  assert.ok(arrow.removed);
});

// ---------------------------------------------------------------- death, loot, xp

test('kill drops loot, gives xp to the killer, fades and is removed', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const slime = actor(g, { faction: 'monster', x: 120, maxHp: 3 });
  slime.species = 'slime';
  slime.drops = [
    ['slime_gel', 1, 2],
    ['coin', 0.9, [1, 3]],
    ['bone', 0.1],
  ];
  slime.xpValue = 7;
  g.combat.damage(p, slime, 10);
  assert.equal(slime.dead, true);
  assert.equal(slime.state, 'dead');
  const death = of(ev, 'death')[0];
  assert.equal(death.entity, slime);
  assert.equal(death.killer, p);
  const loot = g.entities.all().filter((e) => e.type === 'pickup');
  assert.deepEqual(loot.map((e) => [e.itemId, e.qty]).sort(), [
    ['coin', 2],
    ['slime_gel', 2],
  ]);
  assert.equal(p.xp, 7);
  step(g, 0.5);
  assert.ok(slime.deathAlpha < 1 && slime.deathAlpha > 0, 'fading');
  step(g, 0.5);
  assert.equal(g.entities.get(slime.id), null, 'removed after the fade');
});

test('villagers and guards are knocked out at 0 HP, never killed', () => {
  const g = makeGame();
  const ev = log(g);
  const bandit = actor(g, { faction: 'bandit', x: 80 });
  const elda = actor(g, { name: 'Elda Thornbury', faction: 'villager', maxHp: 20 });
  elda.profile = { id: 'elda' };
  const rowan = actor(g, { name: 'Captain Rowan Vale', faction: 'guard', x: 140, maxHp: 20 });
  g.combat.damage(bandit, elda, 100);
  assert.equal(elda.dead, false);
  assert.equal(elda.downed, true);
  assert.equal(elda.hp, 0);
  assert.equal(elda.state, 'downed');
  assert.deepEqual(of(ev, 'downed')[0], { entity: elda, by: bandit });
  assert.equal(g.combat.kill(rowan, bandit), false, 'kill() knocks guards out too');
  assert.equal(rowan.downed, true);
  assert.equal(of(ev, 'death').length, 0);
  assert.equal(of(ev, 'crime').length, 0, 'only the player commits crimes');
  // Their own logic helps them up after 30 s; combat only catches a forgotten one.
  step(g, 30);
  assert.equal(g.combat.revive(elda, elda, 0.5), true);
  assert.equal(elda.hp, 10);
  step(g, 12);
  assert.equal(rowan.downed, false, 'safety net');
});

test('a villager loaded from a save while knocked out still gets up', () => {
  const g = makeGame();
  const tobias = actor(g, { name: 'Tobias Reed', faction: 'villager', maxHp: 30 });
  tobias.deserialize({ hp: 0, downed: true });
  tobias.setState('downed');
  step(g, NPC_REVIVE_FALLBACK + 1.5);
  assert.equal(tobias.downed, false);
  assert.equal(tobias.hp, 15);
});

test('hurting a villager is a crime: one event per victim, knockout escalates', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const elda = actor(g, { name: 'Elda Thornbury', faction: 'villager', x: 116, maxHp: 40 });
  elda.profile = { id: 'elda' };
  g.clock.t = 100;
  for (let i = 0; i < 3; i++) {
    elda.invuln = 0;
    g.combat.damage(p, elda, 5);
  }
  assert.ok(elda.hp > 0);
  let crimes = of(ev, 'crime');
  assert.equal(crimes.length, 1, 'three hits, one crime');
  assert.deepEqual(crimes[0], { actor: p, victim: elda, kind: 'assault' });
  assert.equal(p.crime.kind, 'assault');
  assert.equal(p.crime.level, 1);
  assert.equal(p.crime.until, 100 + ASSAULT_SECONDS);
  assert.ok(g.toasts.some((t) => t.kind === 'warn' && t.text.includes('Elda')));
  // After the quiet window, another blow is reported again.
  g.clock.t += CRIME_EVENT_GAP + 1;
  elda.invuln = 0;
  g.combat.damage(p, elda, 5);
  assert.equal(of(ev, 'crime').length, 2);
  // Knocking her out: downed, not dead; a knockout lasts the rest of the day.
  elda.invuln = 0;
  g.combat.damage(p, elda, 999);
  assert.equal(elda.downed, true);
  assert.equal(elda.dead, false);
  crimes = of(ev, 'crime');
  assert.equal(crimes.length, 3);
  assert.equal(crimes[2].kind, 'knockout');
  assert.equal(p.crime.kind, 'knockout');
  assert.equal(p.crime.level, 2);
  assert.equal(p.crime.until, DAY_SECONDS, 'until midnight of day 1');
  assert.equal(of(ev, 'downed').at(-1).by, p);
  // Hurting Lyra or a creature is not a crime.
  const lyra = addLyra(g, { x: 90 });
  const wolf = actor(g, { faction: 'monster', x: 120, y: 120 });
  g.combat.damage(p, lyra, 3);
  g.combat.damage(p, wolf, 3);
  assert.equal(of(ev, 'crime').length, 3);
});

test('guards are hostile to the player only while a crime is active', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const rowan = actor(g, { name: 'Captain Rowan Vale', faction: 'guard', x: 116, maxHp: 60 });
  const bram = actor(g, { name: 'Bram Ironhand', faction: 'villager', x: 140, maxHp: 40 });
  const lyra = addLyra(g, { x: 90 });
  assert.equal(g.combat.isHostile(rowan, p), false);
  assert.equal(g.combat.canHarm(rowan, p, true), false, 'a calm guard never hurts the player');
  g.clock.t = 500;
  g.combat.damage(p, bram, 4);
  assert.equal(g.combat.hasCrime(p), true);
  assert.equal(g.combat.isHostile(rowan, p), true);
  assert.equal(g.combat.isHostile(p, rowan), true);
  assert.equal(g.combat.isHostile(rowan, lyra), false, 'Lyra is not wanted');
  assert.equal(g.combat.isHostile(bram, p), false, 'villagers flee, they do not fight');
  assert.ok(g.combat.damage(rowan, p, 5) > 0, 'the guard may strike the wanted player');
  step(g, ASSAULT_SECONDS + 0.5);
  assert.equal(g.combat.hasCrime(p), false);
  assert.equal(p.crime, null, 'cleared once it runs out');
  assert.equal(g.combat.isHostile(rowan, p), false, 'guards calm down');
  assert.ok(g.toasts.some((t) => t.text.includes('stopped looking')));
  assert.equal(of(ev, 'crime').length, 1);
  assert.deepEqual(of(ev, 'crime_cleared'), [{ actor: p, reason: 'expired' }]);
});

test('a crime survives a save, and being beaten by the guard settles it', async () => {
  const g = makeGame();
  const ev = log(g);
  g.objects = { get: (id) => (id === 'home_bed' ? { x: 400, y: 300 } : null), inRadius: () => [] };
  const p = addPlayer(g);
  const rowan = actor(g, { name: 'Captain Rowan Vale', faction: 'guard', x: 116, maxHp: 60 });
  const mira = actor(g, { name: 'Mira Fennick', faction: 'villager', x: 84, maxHp: 30 });
  g.clock.t = 100;
  g.combat.damage(p, mira, 4);
  const saved = JSON.parse(JSON.stringify(p.serialize()));
  assert.equal(saved.crime.kind, 'assault');
  const g2 = makeGame();
  const p2 = addPlayer(g2);
  g2.clock.t = 120;
  p2.deserialize(saved);
  assert.equal(g2.combat.hasCrime(p2), true);

  g.combat.damage(rowan, p, 999);
  assert.equal(p.downed, true);
  assert.equal(p.crime, null, 'the matter is settled where you fell');
  assert.equal(of(ev, 'crime_cleared').at(-1).reason, 'arrested');
  assert.equal(g.combat.isHostile(rowan, p), false);
  step(g, 1.5);
  await flushPromises();
  assert.equal(p.downed, false);
  assert.ok(g.toasts.some((t) => t.text.includes('Captain Rowan Vale hauled you home')));
});

test('when Lyra lands the killing blow the player gets the xp too', () => {
  const g = makeGame();
  const p = addPlayer(g, { x: 60 });
  const lyra = addLyra(g);
  const wolf = actor(g, { faction: 'monster', x: 120, maxHp: 2 });
  wolf.xpValue = 10;
  g.combat.damage(lyra, wolf, 50);
  assert.equal(lyra.xp, 10);
  assert.equal(p.xp, 10);
  // What she hunts alone, far from you, is hers.
  const far = actor(g, { faction: 'monster', x: 2000, maxHp: 2 });
  far.xpValue = 6;
  g.combat.damage(lyra, far, 50);
  assert.equal(lyra.xp, 16);
  assert.equal(p.xp, 10);
});

test('level ups raise max HP and attack, heal fully, emit and show a banner', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  p.hp = 5;
  const gained = g.combat.giveXp(p, xpToNext(1) + xpToNext(2) + 3);
  assert.equal(gained, 2);
  assert.equal(p.level, 3);
  assert.equal(p.xp, 3);
  assert.equal(p.maxHp, 60 + 2 * LEVEL_HP);
  assert.equal(p.atk, 6 + 2 * LEVEL_ATK);
  assert.equal(p.hp, p.maxHp);
  assert.deepEqual(
    of(ev, 'level_up').map((e) => [e.entity, e.level]),
    [
      [p, 2],
      [p, 3],
    ],
  );
  assert.equal(g.numbers.filter((n) => n === 'LEVEL UP!').length, 2, 'a banner rises for each level');
  assert.equal(g.toasts.length, 0, 'the HUD words level_up itself');
  assert.equal(p.xpNext, xpToNext(3));
  assert.ok(xpToNext(2) > xpToNext(1));
});

// ---------------------------------------------------------------- knock-outs

test('the player and Lyra are downed, never killed, and can be revived', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const lyra = addLyra(g, { x: 140 });
  const skeleton = actor(g, { faction: 'undead', x: 160 });
  g.combat.damage(skeleton, lyra, 999);
  assert.equal(lyra.downed, true);
  assert.equal(lyra.dead, false);
  assert.equal(lyra.state, 'downed');
  assert.deepEqual(of(ev, 'downed')[0], { entity: lyra, by: skeleton });
  assert.equal(of(ev, 'death').length, 0);
  assert.equal(g.combat.revive(lyra, p, 0.5), true);
  assert.equal(lyra.downed, false);
  assert.equal(lyra.hp, 25);
  assert.deepEqual(of(ev, 'revived')[0], { entity: lyra, by: p });
  assert.equal(g.combat.revive(lyra, p, 0.5), false, 'only the downed can be revived');
});

test('Lyra gets up on her own after 60 seconds at 15% HP', () => {
  const g = makeGame();
  const ev = log(g);
  addPlayer(g);
  const lyra = addLyra(g);
  g.combat.down(lyra, null);
  for (let i = 0; i < SELF_REVIVE_SECONDS - 1; i++) g.combat.update(1);
  assert.equal(lyra.downed, true);
  g.combat.update(1.01);
  assert.equal(lyra.downed, false);
  assert.equal(lyra.hp, Math.round(50 * 0.15));
  assert.equal(of(ev, 'revived')[0].by, lyra);
});

test('a downed player wakes in the cottage bed at half HP, 10% of coins lighter', async () => {
  const g = makeGame();
  const ev = log(g);
  g.objects = { get: (id) => (id === 'home_bed' ? { x: 400, y: 300 } : null), inRadius: () => [] };
  const p = addPlayer(g);
  const lyra = addLyra(g, { x: 130 });
  const wolf = actor(g, { faction: 'monster', x: 120 });
  assert.equal(p.gold, 30);
  g.combat.damage(wolf, p, 999);
  assert.equal(p.downed, true);
  assert.equal(of(ev, 'downed')[0].entity, p);
  step(g, 1.5);
  await flushPromises();
  assert.equal(p.downed, false);
  assert.equal(p.hp, 30);
  assert.equal(p.gold, 27);
  assert.ok(Math.hypot(p.x - 400, p.y - 300) < 30, 'standing by the bed');
  assert.ok(Math.hypot(lyra.x - p.x, lyra.y - p.y) < 40, 'Lyra brought you home');
  const rev = of(ev, 'revived').find((e) => e.entity === p);
  assert.equal(rev.by, lyra);
  assert.ok(g.toasts.some((t) => t.text.includes('carried you home') && t.text.includes('3 coins')));
});

// ---------------------------------------------------------------- items

test('useItem heals by the item, consumes one and emits item_used', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  p.hp = 10;
  assert.equal(g.combat.useItem(p, 'potion'), true);
  assert.equal(p.hp, 10 + ITEMS.potion.heal);
  assert.equal(p.inventory.count('potion'), 1);
  assert.deepEqual(of(ev, 'item_used')[0], { actor: p, itemId: 'potion' });
  assert.deepEqual(of(ev, 'heal')[0], { source: p, target: p, amount: ITEMS.potion.heal });
  assert.equal(g.combat.useItem(p, 'wood'), false, 'not edible');
  assert.equal(g.combat.useItem(p, 'honey_cake'), false, 'not carried');
  p.hp = p.maxHp;
  assert.equal(g.combat.useItem(p, 'potion'), false, 'no wasted potions at full health');
  assert.equal(p.inventory.count('potion'), 1);
  assert.equal(g.combat.useItem(p, 'bread'), true, 'food can always be eaten');
  assert.equal(p.inventory.count('bread'), 1);
});

test('castHeal restores HP with a heal event from the caster', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const lyra = addLyra(g);
  p.hp = 10;
  const healed = g.combat.castHeal(lyra, p);
  assert.ok(healed > 15);
  assert.equal(p.hp, 10 + healed);
  assert.equal(lyra.state, 'cast');
  assert.deepEqual(of(ev, 'heal')[0], { source: lyra, target: p, amount: healed });
  assert.equal(g.combat.heal(lyra, p, 9999), p.maxHp - (10 + healed), 'clamped to max HP');
});

// ---------------------------------------------------------------- pickups

test('walking near a pickup pulls it in and collects it with a toast', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  const pick = dropItem(g, 'wood', 2, 112, 102, { pop: false });
  assert.ok(pick instanceof Pickup);
  step(g, 1.2);
  assert.ok(pick.removed);
  assert.equal(p.inventory.count('wood'), 2);
  const gained = of(ev, 'item_gained')[0];
  assert.deepEqual(gained, { actor: p, itemId: 'wood', qty: 2, from: 'pickup' });
  assert.ok(g.toasts.some((t) => t.text === '+2 Wood'));
  assert.equal(pickupToastText('coin', 5), '+5 coins');

  // Loot that pops out of a kill lands close enough to be pulled in.
  for (let i = 0; i < 20; i++) dropItem(g, 'coin', 1, 104, 100);
  step(g, 2);
  assert.equal(p.inventory.count('coin'), 30 + 20);
});

test('Lyra collects a pickup on purpose; it cannot be collected twice; it despawns after 5 minutes', () => {
  const g = makeGame();
  const lyra = addLyra(g);
  const a = dropItem(g, 'berries', 3, 300, 300);
  assert.equal(a.collect(lyra), true);
  assert.equal(a.collect(lyra), false);
  assert.equal(lyra.inventory.count('berries'), 3);
  const b = dropItem(g, 'stone', 1, 600, 600);
  b.age = 299.9;
  step(g, 0.2);
  assert.ok(b.removed);
});

// ---------------------------------------------------------------- the player

test('the player starts with potions, bread and 30 coins; gold mirrors coins', () => {
  const g = makeGame();
  const p = addPlayer(g);
  for (const [id, n] of Object.entries(STARTING_INVENTORY)) assert.equal(p.inventory.count(id), n);
  assert.equal(p.gold, 30);
  p.gold = 12;
  assert.equal(p.inventory.count('coin'), 12);
  p.gold += 5;
  assert.equal(p.inventory.count('coin'), 17);
  p.inventory.add('iron_sword');
  assert.equal(p.attackPower, p.atk + ITEMS.iron_sword.atk);
});

test('the sword combo grows with each hit and the finisher launches', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  p.faceDir('right');
  const dummy = actor(g, { faction: 'monster', x: 116, y: 100, maxHp: 999 });
  const hits = [];
  for (let i = 0; i < 3; i++) {
    dummy.x = 116;
    dummy.y = 100;
    dummy.knock.x = dummy.knock.y = 0;
    dummy.invuln = 0;
    press(g, 'attack');
    const d = of(ev, 'damage').at(-1);
    hits.push({ amount: d.amount, knock: dummy.knock.x, z: dummy.z });
    step(g, 0.35);
  }
  assert.equal(of(ev, 'damage').length, 3);
  assert.deepEqual(
    hits.map((h) => h.amount),
    COMBO.map((c) => Math.round(6 * c.mul)),
  );
  assert.ok(hits[2].knock > hits[0].knock * 2, 'the finisher knocks enemies flying');
  assert.equal(hits[0].z, 0);
  assert.ok(hits[2].z > 0, 'the finisher lifts the enemy off the ground');
  step(g, 0.3);
  assert.equal(dummy.z, 0, 'and it lands again');
  assert.ok(of(ev, 'attack').every((a) => a.attacker === p && a.kind === 'melee'));
});

test('attacking with no enemy in front works the tree in front', () => {
  const g = makeGame();
  const p = addPlayer(g);
  p.faceDir('right');
  let progress = 0;
  let given = false;
  const tree = {
    objType: 'tree',
    x: 116,
    y: 104,
    workSeconds: 3,
    canWork: () => progress < 1,
    work(actor, dt) {
      progress += dt / 3;
      if (progress >= 1 - 1e-9 && !given) {
        given = true;
        return { done: true, progress: 1, items: [{ id: 'wood', qty: 3 }] };
      }
      return { done: false, progress };
    },
  };
  g.objects = { inRadius: () => [tree], get: () => null };
  press(g, 'attack');
  assert.ok(Math.abs(progress - 1 / 3) < 1e-6, 'one swing is one second of work');
  assert.equal(p.workBar.progress, progress);
  step(g, 0.4);
  press(g, 'attack');
  step(g, 0.4);
  press(g, 'attack');
  assert.equal(given, true);
  step(g, 1.5);
  assert.equal(p.inventory.count('wood'), 3);
});

test('holding attack keeps the combo going', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  p.faceDir('right');
  g.input.down = (a) => a === 'attack';
  step(g, 1.2);
  const swings = of(ev, 'attack').filter((a) => a.attacker === p).length;
  assert.ok(swings >= 3 && swings <= 5, `swings while held: ${swings}`);
  g.input.down = () => false;
  step(g, 1);
  assert.equal(of(ev, 'attack').filter((a) => a.attacker === p).length, swings, 'stops when released');
});

test('a press made during hit-stop is not lost', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  let held = false;
  g.input.down = (a) => a === 'attack' && held;
  // The key goes down while the world is frozen: its edge flag is cleared unseen.
  held = true;
  g.input.endFrame();
  step(g, 1 / 60);
  assert.equal(of(ev, 'attack').length, 1);
  held = false;
});

test('the dodge roll moves, grants i-frames and has a cooldown', () => {
  const g = makeGame();
  const p = addPlayer(g);
  const wolf = actor(g, { faction: 'monster', x: 60 });
  g.input.move = { x: 1, y: 0 };
  press(g, 'dodge');
  assert.equal(p.rolling, true);
  assert.equal(g.combat.damage(wolf, p, 10), 0, 'invulnerable while rolling');
  step(g, 0.4);
  assert.equal(p.rolling, false);
  assert.ok(p.x > 130, `rolled forward (x=${p.x.toFixed(1)})`);
  press(g, 'dodge');
  assert.equal(p.rolling, false, 'still cooling down');
  step(g, 0.5);
  press(g, 'dodge');
  assert.equal(p.rolling, true);
});

test('a rooted player cannot move or dodge, but can still turn and swing', () => {
  const g = makeGame();
  const ev = log(g);
  const p = addPlayer(g);
  p.rootTime = 3; // Lyra's Binding Light
  g.input.move = { x: 1, y: 0 };
  press(g, 'dodge');
  assert.equal(p.rolling, false, 'no rolling out of Binding Light');
  step(g, 0.5);
  assert.equal(p.x, 100, 'held in place');
  assert.equal(p.dir, 'right', 'but free to turn');
  const slime = actor(g, { faction: 'monster', x: 114, y: 100, maxHp: 40 });
  press(g, 'attack');
  assert.ok(slime.hp < 40, 'and to fight');
  assert.ok(of(ev, 'attack').some((a) => a.attacker === p));
  assert.equal(p.x, 100, 'the swing does not lunge');
  // Rooted mid-roll: the roll stops where it is.
  step(g, 3);
  assert.equal(p.rootTime, 0);
  press(g, 'dodge');
  assert.equal(p.rolling, true);
  p.rootTime = 1;
  step(g, 1 / 60);
  assert.equal(p.rolling, false);
  const x = p.x;
  step(g, 0.5);
  assert.equal(p.x, x);
  step(g, 1);
  g.input.move = { x: 1, y: 0 };
  step(g, 0.3);
  assert.ok(p.x > x, 'moves again once the light fades');
});

test('Lyra\'s bolts fly past the player on their way to the enemy', () => {
  const g = makeGame();
  const p = addPlayer(g, { x: 130, y: 100 });
  const lyra = addLyra(g, { x: 100, y: 100 });
  const wolf = actor(g, { faction: 'monster', x: 190, y: 100, maxHp: 40 });
  g.combat.damage(p, lyra, 2); // even right after the player hurt her
  g.combat.shoot(lyra, wolf.x, wolf.y, 'bolt', { target: wolf });
  step(g, 1);
  assert.equal(p.hp, p.maxHp);
  assert.ok(wolf.hp < 40);
});

test('if Lyra has left you, a villager carries you home instead', async () => {
  const g = makeGame();
  g.objects = { get: (id) => (id === 'home_bed' ? { x: 400, y: 300 } : null), inRadius: () => [] };
  const p = addPlayer(g);
  const lyra = addLyra(g, { x: 130 });
  lyra.mind = { companionship: 'left' };
  const wolf = actor(g, { faction: 'monster', x: 120 });
  g.combat.damage(wolf, p, 999);
  step(g, 1.5);
  await flushPromises();
  assert.equal(p.downed, false);
  assert.equal(lyra.x, 130, 'she stays where she was');
  assert.ok(g.toasts.some((t) => t.text.includes('Someone from the village found you')));
});

test('movement accelerates and decelerates instead of snapping', () => {
  const g = makeGame();
  const p = addPlayer(g);
  g.input.move = { x: 1, y: 0 };
  step(g, 1 / 60);
  const first = p.x - 100;
  assert.ok(first > 0 && first < p.speed / 60, 'starts below full speed');
  step(g, 0.5);
  assert.ok(Math.abs(p.vel.x - p.speed) < 1e-6, 'reaches full speed');
  g.input.move = { x: 0, y: 0 };
  const x0 = p.x;
  step(g, 1 / 60);
  assert.ok(p.x > x0, 'glides a little after letting go');
  step(g, 0.3);
  assert.equal(p.vel.x, 0);
});

// ---------------------------------------------------------------- icons

test('every item has a painted icon', () => {
  for (const id of Object.keys(ITEMS)) assert.ok(PAINTED_ICONS.includes(id), `icon for ${id}`);
  assert.ok(PAINTED_ICONS.includes('unknown'));
  assert.ok(itemIconIds().includes('unknown'));
});
