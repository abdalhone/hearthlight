import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, run, step, resetArena, AIM } from './magic_helpers.mjs';
import { SHAPES, Shapes } from '../src/magic/shapes.js';
import { ESSENCES, Essences } from '../src/magic/essences.js';
import { TWISTS, Twists } from '../src/magic/twists.js';
import { STATUSES, REACTIONS, Statuses } from '../src/magic/status.js';
import { compileWeave } from '../src/magic/compile.js';
import { weaveName, describeWeave } from '../src/magic/naming.js';
import { STARTER_WEAVE } from '../src/magic/magic.js';
import * as BAL from '../src/magic/balance.js';
import { TILE } from '../src/core/constants.js';

const SHAPE_IDS = ['bolt', 'blast', 'strike', 'throw', 'beam', 'nova', 'orb', 'summon', 'rune', 'rain', 'wall', 'dash'];
const ESSENCE_IDS = ['raw', 'fire', 'water', 'frost', 'storm', 'earth', 'wind', 'nature', 'poison', 'light', 'dark', 'iron', 'song'];
const TWIST_IDS = ['multishot', 'split', 'pierce', 'bounce', 'chain', 'homing', 'echo', 'big', 'swift', 'burst', 'linger', 'orbit', 'volley', 'spiral', 'leech', 'charge'];

// ---------------------------------------------------------------- registries

test('registries hold every fixed id, and every entry fills in completely', () => {
  for (const id of SHAPE_IDS) assert.ok(Shapes.has(id), `shape ${id}`);
  for (const id of ESSENCE_IDS) assert.ok(Essences.has(id), `essence ${id}`);
  for (const id of TWIST_IDS) assert.ok(Twists.has(id), `twist ${id}`);
  assert.equal(Object.keys(SHAPES).length, 13, 'twelve shapes, and the surge the prices brought (DESIGN §25)');
  assert.ok(Shapes.has('surge'));
  assert.equal(Object.keys(ESSENCES).length, 13);
  assert.equal(Object.keys(TWISTS).length, 16);
  for (const id of Essences.ids()) {
    const e = Essences.get(id);
    for (const k of ['core', 'glow', 'spark', 'deep']) assert.match(e.palette[k], /^#[0-9a-f]{6}$/i, `${id}.${k}`);
    assert.ok(e.light.radius > 0 && e.particle && e.damageType && e.tags.length, id);
    if (e.status) assert.ok(Statuses.has(e.status.id), `${id} status ${e.status.id}`);
  }
  for (const id of ['burning', 'soaked', 'chilled', 'frozen', 'shocked', 'staggered', 'knocked', 'rooted', 'poisoned', 'dazzled', 'drained', 'sundered', 'charmed']) assert.ok(STATUSES[id], id);
  for (const r of REACTIONS) {
    assert.equal(r.tags.length, 2, r.id);
    assert.equal(typeof r.effect, 'function', r.id);
  }
  const needed = [['wet', 'shock'], ['wet', 'cold'], ['fire', 'air'], ['fire', 'plant'], ['fire', 'wet'], ['earth', 'wet'], ['light', 'dark'], ['poison', 'fire'], ['metal', 'shock']];
  for (const [a, b] of needed) assert.ok(REACTIONS.some((r) => r.tags.includes(a) && r.tags.includes(b)), `${a}+${b}`);
});

// ---------------------------------------------------------------- compile

test('compile: numbers, palette, name, description and aim preview', () => {
  const p = compileWeave({ shape: 'bolt', essences: ['fire'], twists: ['multishot', 'split'] });
  assert.equal(p.ok, true);
  assert.equal(p.count, 3);
  assert.equal(p.name, 'Triple Splitting Ember Bolt');
  assert.equal(p.description, 'Fires 3 bolts of fire that split on impact.');
  assert.deepEqual(p.aim.type, 'line');
  assert.ok(p.aim.range > 100);
  for (const k of ['dmg', 'cost', 'cooldown', 'speed', 'radius', 'life']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, k);
  assert.ok(p.cost > compileWeave({ shape: 'bolt', essences: ['fire'] }).cost, 'twists cost more');
  assert.equal(p.palette.glow, Essences.get('fire').palette.glow);
  assert.equal(compileWeave({ shape: 'nova', essences: ['water'], twists: ['echo'] }).name, 'Echoing Tide Nova');
  const steam = compileWeave({ shape: 'throw', essences: ['fire', 'water'] });
  assert.match(steam.name, /Steam/);
  assert.notEqual(steam.palette.glow, Essences.get('fire').palette.glow, 'palettes blend');
  assert.deepEqual(steam.particles, ['flame', 'drop'], 'each essence keeps its particle style');
  assert.deepEqual(steam.dmgTypes.map((d) => d.type), ['fire', 'water']);
  assert.ok(steam.statuses.every((s) => s.potency < 1), 'statuses land at reduced potency');
  assert.equal(compileWeave({ shape: 'beam', essences: ['light'] }).input, 'hold');
  assert.equal(compileWeave({ shape: 'bolt', essences: ['light'], twists: ['charge'] }).input, 'charge');
  const aims = SHAPE_IDS.map((s) => compileWeave({ shape: s, essences: ['raw'] }).aim.type);
  for (const t of aims) assert.ok(['line', 'cone', 'circle', 'ring', 'arc', 'point'].includes(t), t);
  assert.match(describeWeave(compileWeave({ shape: 'summon', essences: ['earth'], twists: ['chain'] })), /golem.*\. It leaps from foe to foe\./i);
});

test('compile: unknown and locked ids are refused with a reason; slot limits hold', () => {
  const g = makeGame();
  const m = g.magic;
  assert.equal(compileWeave({ shape: 'laser', essences: ['fire'] }).ok, false);
  assert.match(compileWeave({ shape: 'bolt', essences: ['plasma'] }).reason, /no essence/i);
  assert.match(compileWeave({ shape: 'bolt', twists: ['wobble'] }).reason, /no twist/i);
  assert.match(compileWeave({ essences: ['fire'] }).reason, /shape/i);
  const locked = m.compile({ shape: 'bolt', essences: ['fire'] });
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'locked');
  assert.match(locked.reason, /fire/);
  assert.equal(m.compile({ shape: 'nova', essences: ['raw'] }).code, 'locked');
  assert.equal(m.compile(STARTER_WEAVE).ok, true);
  m.unlockAll();
  m.essenceSlots = 2;
  m.twistSlots = 2;
  assert.equal(m.compile({ shape: 'bolt', essences: ['fire', 'water', 'frost'] }).code, 'too_many');
  assert.equal(m.compile({ shape: 'bolt', twists: ['big', 'swift', 'split'] }).code, 'too_many');
  m.unlockEssenceSlot();
  m.unlockTwistSlot();
  assert.equal(m.compile({ shape: 'bolt', essences: ['fire', 'water', 'frost'], twists: ['big', 'swift', 'split'] }).ok, true);
  assert.equal(m.unlockEssenceSlot(), false, 'three essences at most');
  m.unlockTwistSlot();
  assert.equal(m.unlockTwistSlot(), false, 'four twists at most');
});

test('power budget: every plan sits inside the band around its shape', () => {
  for (const s of SHAPE_IDS) {
    for (const tw of [[], ['multishot'], ['volley', 'echo'], ['big', 'burst', 'split', 'chain']]) {
      const p = compileWeave({ shape: s, essences: ['fire', 'storm'], twists: tw });
      assert.ok(p.ok, `${s} ${tw}`);
      const ratio = p.value / p.cost;
      assert.ok(ratio <= p.budget.hi * 1.015 || p.cost >= BAL.COST_MAX, `${s} ${tw} too cheap: ${ratio} > ${p.budget.hi}`);
      assert.ok(ratio >= p.budget.lo * 0.985 || p.cost <= BAL.COST_MIN, `${s} ${tw} too weak: ${ratio} < ${p.budget.lo}`);
      assert.ok(p.cooldown >= BAL.COOLDOWN_MIN && p.cooldown <= BAL.COOLDOWN_MAX);
    }
  }
});

// ---------------------------------------------------------------- state

test('starting state: a bolt of raw weave called Spark, four slots, 40 mana', () => {
  const m = makeGame().magic;
  assert.deepEqual([...m.unlocked.shapes], ['bolt']);
  assert.deepEqual([...m.unlocked.essences], ['raw']);
  assert.equal(m.unlocked.twists.size, 0);
  assert.equal(m.slots[0].name, 'Spark');
  assert.equal(m.slots[0].shape, 'bolt');
  assert.deepEqual(m.slots[0].essences, ['raw']);
  assert.equal(m.slotCount, 4);
  assert.equal(m.slots.length, 6);
  assert.equal(m.essenceSlots, 2);
  assert.equal(m.twistSlots, 2);
  assert.deepEqual(m.mana, { cur: 40, max: 40 });
  assert.equal(m.slotPlan(0).name, 'Spark');
});

test('unlock goes through one door and is announced once', () => {
  const g = makeGame({ log: true });
  const m = g.magic;
  assert.equal(m.unlock('essence', 'fire', 'boss:varek'), true);
  assert.equal(m.unlock('essences', 'fire', 'again'), false);
  assert.equal(m.unlock('essence', 'plasma', 'x'), false);
  assert.equal(m.unlock('twist', 'volley', 'boss:varek'), true);
  const ev = g.events.filter((e) => e.type === 'magic_unlocked');
  assert.deepEqual(ev.map((e) => [e.payload.kind, e.payload.id, e.payload.source]), [
    ['essence', 'fire', 'boss:varek'],
    ['twist', 'volley', 'boss:varek'],
  ]);
  assert.ok(m.isUnlocked('essence', 'fire'));
  assert.equal(m.catalog().essences.find((e) => e.id === 'fire').unlocked, true);
  assert.equal(m.unlockSlot(), true);
  assert.equal(m.unlockSlot(), true);
  assert.equal(m.unlockSlot(), false);
  assert.equal(m.slotCount, 6);
});

test('casting spends mana, starts the slot cooldown and explains refusals', () => {
  const g = makeGame({ log: true });
  const m = g.magic;
  const p = g.player;
  assert.deepEqual(m.canCast(0).ok, true);
  const r = m.cast(p, 0, AIM);
  assert.equal(r.ok, true);
  assert.equal(r.plan.name, 'Spark');
  assert.ok(m.mana.cur < 40);
  assert.equal(m.canCast(0).reason, 'cooldown');
  assert.equal(m.cast(p, 0, AIM).reason, 'cooldown');
  assert.equal(m.canCast(1).reason, 'empty');
  assert.equal(m.canCast(4).reason, 'locked_slot');
  assert.ok(g.events.some((e) => e.type === 'spell_cast' && e.payload.plan.name === 'Spark' && e.payload.weave.shape === 'bolt'));
  assert.ok(g.events.some((e) => e.type === 'mana_changed'));
  run(g, 1);
  assert.equal(m.canCast(0).ok, true);
  m.mana.cur = 1;
  assert.equal(m.canCast(0).reason, 'mana');
  assert.equal(m.setSlot(1, { shape: 'nova' }).ok, false, 'locked shape refused');
  assert.equal(m.setSlot(5, STARTER_WEAVE).ok, false, 'locked slot refused');
  assert.equal(m.setSlot(1, { name: 'Mine', shape: 'bolt', essences: ['raw'] }).ok, true);
  assert.equal(m.slotPlan(1).name, 'Mine');
});

test('mana regenerates, grows with levels and missions', () => {
  const g = makeGame({ log: true });
  const m = g.magic;
  m.spendMana(30);
  assert.equal(m.mana.cur, 10);
  run(g, 3);
  assert.ok(m.mana.cur > 15, `regen ${m.mana.cur}`);
  m.addMaxMana(10);
  assert.equal(m.mana.max, 50);
  g.player.level = 3;
  g.bus.emit('level_up', { entity: g.player, level: 3 });
  assert.equal(m.mana.max, 50 + 2 * BAL.MANA_PER_LEVEL);
});

// ---------------------------------------------------------------- hits, statuses, reactions

test('a fire bolt hits a foe, burns it, and the burn is credited to the caster', () => {
  const g = makeGame({ log: true, foes: 1, foeHp: 30 });
  const m = g.magic;
  m.unlockAll();
  const foe = g.foes[0];
  foe.xpValue = 10;
  const r = m.cast(g.player, { shape: 'bolt', essences: ['fire'] }, { x: foe.x, y: foe.y });
  assert.ok(r.ok);
  run(g, 0.6);
  assert.ok(foe.hp < 30, 'hit');
  assert.ok(m.status.has(foe, 'burning') || foe.dead);
  assert.ok(g.events.some((e) => e.type === 'spell_hit' && e.payload.target === foe));
  assert.ok(g.events.some((e) => e.type === 'status_applied' && e.payload.status === 'burning'));
  const dmg = g.events.find((e) => e.type === 'damage' && e.payload.target === foe);
  assert.equal(dmg.payload.kind, 'magic');
  assert.equal(dmg.payload.damageType, 'fire');
  assert.equal(dmg.payload.source, g.player);
  for (let i = 0; i < 6 && !foe.dead; i++) {
    m.cooldowns.fill(0);
    m.mana.cur = 40;
    m.cast(g.player, { shape: 'bolt', essences: ['fire'] }, { x: foe.x, y: foe.y });
    run(g, 0.7);
  }
  run(g, 3);
  assert.ok(foe.dead, 'the foe burned down');
  const death = g.events.find((e) => e.type === 'death' && e.payload.entity === foe);
  assert.equal(death.payload.killer, g.player);
  assert.ok(g.player.xp > 0, 'xp to the weaver');
});

test('statuses: chill stacks into a freeze that stops a body, then a short immunity', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  const foe = g.foes[0];
  for (let i = 0; i < 2; i++) m.status.apply(foe, 'chilled', { src: g.player, power: 5 });
  assert.equal(m.status.get(foe, 'chilled').stacks, 2);
  assert.ok(foe.speed < 60 * 0.9, 'chill slows through the speed hook');
  m.status.apply(foe, 'chilled', { src: g.player, power: 5 });
  assert.ok(m.status.has(foe, 'frozen'));
  assert.ok(!m.status.has(foe, 'chilled'));
  step(g);
  assert.equal(foe.statusFlags.disabled, true);
  assert.ok(foe.lockTime > 0);
  assert.equal(g.combat.melee(foe, {}), false, 'a frozen body cannot swing');
  assert.equal(m.canCast(0, foe).reason, 'disabled');
  run(g, 2);
  assert.ok(!m.status.has(foe, 'frozen'));
  assert.equal(foe.statusFlags.disabled, false);
  assert.equal(foe.speed, 60, 'speed back to normal');
  assert.equal(m.status.apply(foe, 'frozen', { src: g.player }), null, 'immune for a moment');
  m.status.apply(foe, 'rooted', { src: g.player });
  step(g);
  assert.ok(foe.rootTime > 0);
  m.status.apply(foe, 'poisoned', { src: g.player, power: 10 });
  m.status.apply(foe, 'poisoned', { src: g.player, power: 10 });
  assert.equal(m.status.get(foe, 'poisoned').stacks, 2);
  const hp = foe.hp;
  run(g, 1.1);
  assert.ok(foe.hp < hp, 'poison ticks');
});

test('statuses work on bosses (shorter control) and never charm the party', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  const boss = g.foes[0];
  boss.superArmor = true;
  boss.boss = true;
  const s = m.status.apply(boss, 'stunned', { src: g.player });
  assert.ok(s.t < 0.5);
  assert.equal(m.status.apply(boss, 'charmed', { src: g.player, chance: 99 }), null);
  assert.equal(m.status.apply(g.companion, 'charmed', { src: g.foes[0] }), null);
  assert.equal(m.status.apply(g.player, 'charmed', { src: g.foes[0] }), null);
});

test('reactions fire by tag pairs: wet + shock stuns, wet + cold freezes, fire + wet steams', () => {
  const g = makeGame({ log: true, foes: 3 });
  const m = g.magic;
  const [a, b, c] = g.foes;
  // Far apart, so one reaction's spread does not touch the next test subject.
  a.x = 4 * TILE;
  a.y = 4 * TILE;
  b.x = 14 * TILE;
  b.y = 9 * TILE;
  c.x = 20 * TILE;
  c.y = 24 * TILE;
  m.status.apply(a, 'soaked', { src: g.player, power: 10 });
  m.status.apply(a, 'shocked', { src: g.player, power: 10 });
  assert.ok(g.events.some((e) => e.type === 'reaction' && e.payload.id === 'arc_shock'));
  assert.ok(m.status.has(a, 'stunned'));
  m.status.apply(b, 'soaked', { src: g.player, power: 10 });
  m.status.apply(b, 'chilled', { src: g.player, power: 10 });
  assert.ok(m.status.has(b, 'frozen'));
  m.status.apply(c, 'burning', { src: g.player, power: 10 });
  m.status.apply(c, 'soaked', { src: g.player, power: 10 });
  assert.ok(g.events.some((e) => e.type === 'reaction' && e.payload.id === 'scalding_steam'));
  assert.ok(m.status.has(c, 'blinded'));
  // A weave touching a status reacts too: a fire bolt on a frozen foe thaws it with a bang.
  m.unlockAll();
  const hp = b.hp;
  m.cast(g.player, { shape: 'bolt', essences: ['fire'] }, { x: b.x, y: b.y, target: b });
  run(g, 0.6);
  assert.ok(g.events.some((e) => e.type === 'reaction' && (e.payload.id === 'thaw' || e.payload.id === 'shatter')));
  assert.ok(b.hp < hp);
  // Reactions have cooldowns so they never storm.
  const n = g.events.filter((e) => e.type === 'reaction' && e.payload.target === a).length;
  m.status.apply(a, 'soaked', { src: g.player, power: 10 });
  m.status.apply(a, 'shocked', { src: g.player, power: 10 });
  assert.equal(g.events.filter((e) => e.type === 'reaction' && e.payload.target === a).length, n);
});

test('a song can charm a foe to fight for the weaver', () => {
  const g = makeGame({ foes: 2 });
  const m = g.magic;
  const [wolf, other] = g.foes;
  m.status.apply(wolf, 'charmed', { src: g.player, chance: 99 });
  assert.ok(m.status.has(wolf, 'charmed'));
  step(g);
  assert.equal(g.combat.isHostile(wolf, g.player), false);
  assert.equal(g.combat.isHostile(g.player, wolf), false);
  assert.equal(g.combat.isHostile(wolf, other), true);
  assert.equal(g.combat.isHostile(other, wolf), true);
  assert.equal(m.isFriendOfPlayer(wolf), true, "the player's weaves spare it");
  run(g, 5);
  assert.equal(g.combat.isHostile(wolf, g.player), true, 'it wears off');
});

// ---------------------------------------------------------------- rules of harm

test('friendly fire: an area weave aimed at a foe spares Lyra and villagers', () => {
  const g = makeGame({ log: true, foes: 1 });
  const m = g.magic;
  m.unlockAll();
  const foe = g.foes[0];
  // Everyone in the ring: the foe, Lyra and Bram.
  foe.x = g.player.x + 20;
  foe.y = g.player.y;
  g.companion.x = g.player.x - 20;
  g.companion.y = g.player.y;
  g.villager.x = g.player.x;
  g.villager.y = g.player.y + 20;
  m.cast(g.player, { shape: 'nova', essences: ['fire'] }, { x: foe.x, y: foe.y });
  run(g, 1);
  assert.ok(foe.hp < foe.maxHp);
  assert.equal(g.companion.hp, g.companion.maxHp);
  assert.equal(g.villager.hp, g.villager.maxHp);
  assert.ok(!g.player.crime);
  // An aim point next to Lyra but on the foe picks the foe.
  resetArena(g);
  foe.x = g.companion.x + 10;
  foe.y = g.companion.y;
  const r = m.cast(g.player, { shape: 'bolt', essences: ['raw'] }, { x: foe.x + 2, y: foe.y });
  assert.equal(r.cast.target, foe);
  assert.equal(r.cast.friendly, false);
});

test('friendly fire: aimed at Lyra on purpose it is an attack; bystanders are accidents', () => {
  const g = makeGame({ log: true, foes: 0 });
  const m = g.magic;
  m.unlockAll();
  const lyra = g.companion;
  lyra.x = g.player.x + 24;
  lyra.y = g.player.y;
  g.villager.x = g.player.x - 20;
  g.villager.y = g.player.y;
  const r = m.cast(g.player, { shape: 'nova', essences: ['raw'] }, { target: lyra });
  assert.equal(r.cast.friendly, true);
  run(g, 1);
  const hits = g.events.filter((e) => e.type === 'damage');
  const onLyra = hits.find((e) => e.payload.target === lyra);
  const onBram = hits.find((e) => e.payload.target === g.villager);
  assert.ok(onLyra, 'Lyra was hit');
  assert.equal(onLyra.payload.deliberate, true);
  assert.ok(onBram, 'the villager beside her was caught too');
  assert.equal(onBram.payload.deliberate, false);
  assert.ok(g.player.crime, 'hurting a villager is a crime, magic or not');
  // A bare aim point right on her also counts as aiming at her.
  resetArena(g);
  const r2 = m.cast(g.player, { shape: 'bolt', essences: ['raw'] }, { x: lyra.x, y: lyra.y });
  assert.equal(r2.cast.target, lyra);
  assert.equal(r2.cast.friendly, true);
  // Auto-aim never picks a friend.
  resetArena(g);
  const r3 = m.cast(g.player, { shape: 'bolt', essences: ['raw'] });
  assert.equal(r3.cast.friendly, false);
});

test("a foe's weave follows combat's rules: it hurts the player, never its own kind", () => {
  const g = makeGame({ foes: 2 });
  const m = g.magic;
  const [caster, ally] = g.foes;
  caster.x = g.player.x + 40;
  caster.y = g.player.y;
  ally.x = g.player.x + 20;
  ally.y = g.player.y + 2;
  const r = m.cast(caster, { shape: 'nova', essences: ['dark'] }, { x: g.player.x, y: g.player.y });
  assert.ok(r.ok, 'no mana or unlocks for other casters');
  run(g, 0.2);
  const r2 = m.cast(caster, { shape: 'bolt', essences: ['dark'] }, { x: g.player.x, y: g.player.y });
  assert.ok(r2.ok);
  run(g, 1);
  assert.ok(g.player.hp < g.player.maxHp, 'the player was hit');
  assert.equal(ally.hp, ally.maxHp, 'its packmate was spared');
});

// ---------------------------------------------------------------- shapes in play

test('held beam drains mana while held and stops on release; charge grows with the hold', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  m.unlockAll();
  m.addMaxMana(200);
  m.setSlot(1, { shape: 'beam', essences: ['light'] });
  const foe = g.foes[0];
  const s = m.castStart(g.player, 1, { x: foe.x, y: foe.y });
  assert.equal(s.mode, 'hold');
  const beam = m.bodies.find((b) => b.kind === 'beam');
  assert.ok(beam && beam.held);
  const before = m.mana.cur;
  run(g, 1);
  assert.ok(m.mana.cur < before - 5, 'drains per second');
  assert.ok(foe.hp < foe.maxHp, 'the beam burns');
  assert.ok(m.castHold(g.player, { x: foe.x, y: foe.y + 100 }));
  run(g, 0.3);
  assert.ok(beam.angle > 0.1, 'the beam follows the aim');
  m.castRelease(g.player);
  run(g, 0.3);
  assert.equal(m.bodies.filter((b) => b.kind === 'beam').length, 0);
  assert.ok(m.cooldowns[1] > 0);
  // Out of mana: the beam lets go by itself.
  m.cooldowns.fill(0);
  m.mana.cur = 8;
  m.castStart(g.player, 1, { x: foe.x, y: foe.y });
  run(g, 2);
  assert.equal(m.holdOf(g.player), null);

  // Charge: a full hold hits much harder than a tap.
  resetArena(g);
  m.setSlot(2, { shape: 'bolt', essences: ['raw'], twists: ['charge'] });
  const dmgOf = (hold) => {
    resetArena(g);
    const h0 = foe.hp;
    m.castStart(g.player, 2, { x: foe.x, y: foe.y });
    run(g, hold);
    const r = m.castRelease(g.player, { x: foe.x, y: foe.y });
    assert.ok(r.ok, r.message);
    run(g, 1);
    return h0 - foe.hp;
  };
  const tap = dmgOf(0.02);
  const full = dmgOf(1.4);
  assert.ok(full > tap * 2, `charged ${full} vs tap ${tap}`);
  // A held beam's echo that comes after the release is a quick beam, never a stuck one.
  resetArena(g);
  m.setSlot(3, { shape: 'beam', essences: ['fire'], twists: ['echo', 'volley'] });
  m.castStart(g.player, 3, { x: foe.x, y: foe.y });
  run(g, 0.05);
  m.castRelease(g.player);
  run(g, 3);
  assert.equal(m.bodies.filter((b) => b.kind === 'beam').length, 0, 'no beam left pouring');
  // Cancel costs nothing.
  resetArena(g);
  const mana = m.mana.cur;
  m.castStart(g.player, 2, AIM);
  m.castCancel(g.player);
  assert.equal(m.mana.cur, mana);
});

test('walls stop foes and their arrows; dash blinks with i-frames and leaves a trail', async () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  m.unlockAll();
  const foe = g.foes[0];
  foe.x = g.player.x + 60;
  foe.y = g.player.y;
  m.cast(g.player, { shape: 'wall', essences: ['earth'] }, { x: g.player.x + 40, y: g.player.y });
  const wall = m.bodies.find((b) => b.kind === 'wall');
  assert.ok(wall);
  // The foe walks into the wall and is held on its side.
  for (let i = 0; i < 90; i++) {
    foe.moveIntent = { x: -1, y: 0 };
    step(g);
  }
  assert.ok(foe.x > g.player.x + 40, `held back at ${foe.x - g.player.x}`);
  // A foe's arrow hits the wall, not the player.
  const { Projectile } = await import('../src/entities/projectiles.js');
  const arrow = g.entities.add(new Projectile(g, { kind: 'arrow', owner: foe, x: foe.x - 6, y: g.player.y, vx: -230, vy: 0, damage: 5 }));
  run(g, 0.5);
  assert.ok(arrow.removed || arrow.state !== 'fly');
  assert.equal(g.player.hp, g.player.maxHp);

  resetArena(g);
  const x0 = g.player.x;
  m.cast(g.player, { shape: 'dash', essences: ['fire'] }, { x: x0 + 200, y: g.player.y });
  assert.ok(g.player.invuln > 0, 'i-frames');
  run(g, 0.4);
  assert.ok(g.player.x > x0 + 50, `moved ${g.player.x - x0}`);
  const trail = m.bodies.find((b) => b.kind === 'trail');
  assert.ok(trail && Math.hypot(trail.x2 - trail.x, trail.y2 - trail.y) > 40);
  // Dashing into the outer wall stops at it.
  resetArena(g);
  m.cooldowns.fill(0);
  g.player.x = 2 * TILE;
  m.cast(g.player, { shape: 'dash', essences: ['raw'] }, { x: -200, y: g.player.y });
  run(g, 0.5);
  assert.ok(g.player.x >= TILE, 'never into the wall');
});

test('a familiar follows its caster and fights foes; runes wait for a foe to step close', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  m.unlockAll();
  const foe = g.foes[0];
  foe.x = g.player.x + 70;
  foe.y = g.player.y;
  m.cast(g.player, { shape: 'summon', essences: ['fire'] }, AIM);
  const fam = m.bodies.find((b) => b.kind === 'summon');
  assert.ok(fam);
  run(g, 3);
  assert.ok(foe.hp < foe.maxHp, 'the imp attacked');
  assert.ok(Math.hypot(fam.x - g.player.x, fam.y - g.player.y) < 150, 'it stays near');

  resetArena(g);
  foe.x = 20 * TILE;
  foe.y = 20 * TILE;
  m.cast(g.player, { shape: 'rune', essences: ['frost'] }, { x: 13 * TILE, y: 15 * TILE });
  run(g, 1);
  const rune = m.bodies.find((b) => b.kind === 'rune');
  assert.ok(rune && rune.armed);
  assert.equal(foe.hp, foe.maxHp);
  foe.x = rune.x + 4;
  foe.y = rune.y;
  run(g, 0.3);
  assert.ok(foe.hp < foe.maxHp, 'the rune burst');
  assert.ok(!m.bodies.some((b) => b.kind === 'rune' && b.active));
});

test('twists: multishot fans, split divides, chain jumps, echo and volley repeat, pierce passes', () => {
  const g = makeGame({ foes: 5, log: true });
  const m = g.magic;
  m.unlockAll();
  const casts = (w) => {
    resetArena(g);
    g.events.length = 0;
    const r = m.cast(g.player, w, AIM);
    assert.ok(r.ok, r.message);
    return r;
  };
  casts({ shape: 'bolt', essences: ['raw'], twists: ['multishot'] });
  assert.equal(m.bodies.filter((b) => b.kind === 'projectile').length, 3);
  casts({ shape: 'bolt', essences: ['raw'], twists: ['split'] });
  let shards = 0;
  for (let i = 0; i < 70; i++) {
    step(g);
    shards = Math.max(shards, m.bodies.filter((b) => b.gen === 1).length);
  }
  assert.equal(shards, 3, 'three shards');
  casts({ shape: 'bolt', essences: ['storm'], twists: ['chain'] });
  run(g, 1);
  const hitTargets = new Set(g.events.filter((e) => e.type === 'spell_hit').map((e) => e.payload.target));
  assert.ok(hitTargets.size >= 2, `chain reached ${hitTargets.size}`);
  casts({ shape: 'nova', essences: ['raw'], twists: ['echo'] });
  g.foes[0].x = g.player.x + 20;
  g.foes[0].y = g.player.y;
  run(g, 1);
  const novaHits = g.events.filter((e) => e.type === 'spell_hit' && e.payload.target === g.foes[0]);
  assert.deepEqual(novaHits.map((e) => e.payload.plan.gen), [0, 1], 'the nova, then its echo');
  casts({ shape: 'bolt', essences: ['raw'], twists: ['volley'] });
  g.foes[0].x = g.player.x + 40;
  g.foes[0].y = g.player.y;
  run(g, 0.6);
  assert.equal(g.events.filter((e) => e.type === 'spell_hit' && e.payload.target === g.foes[0]).length, 3, 'three in quick succession');
  casts({ shape: 'bolt', essences: ['iron'], twists: ['pierce'] });
  const bolt = m.bodies[0];
  assert.equal(bolt.pierceLeft, 3);
  // Leech heals the weaver.
  resetArena(g);
  g.player.hp = 40;
  m.cast(g.player, { shape: 'nova', essences: ['dark'], twists: ['leech'] }, AIM);
  g.foes[0].x = g.player.x + 10;
  g.foes[0].y = g.player.y;
  run(g, 1);
  assert.ok(g.player.hp > 40, 'leeched');
});

// ---------------------------------------------------------------- saving

test('save/load round-trips unlocks, slots, limits and mana', () => {
  const g = makeGame();
  const m = g.magic;
  m.unlock('essence', 'fire', 'boss:varek');
  m.unlock('twist', 'volley', 'boss:varek');
  m.unlock('shape', 'nova', 'mission:first_ring');
  m.unlockSlot();
  m.unlockEssenceSlot();
  m.addMaxMana(12);
  m.setSlot(2, { name: 'Fire Ring', shape: 'nova', essences: ['fire'], twists: ['volley'] });
  m.spendMana(20);
  const data = JSON.parse(JSON.stringify(m.serialize()));
  const g2 = makeGame();
  g2.magic.deserialize(data);
  const m2 = g2.magic;
  assert.deepEqual([...m2.unlocked.essences].sort(), ['fire', 'raw']);
  assert.deepEqual([...m2.unlocked.twists], ['volley']);
  assert.ok(m2.unlocked.shapes.has('nova'));
  assert.equal(m2.slotCount, 5);
  assert.equal(m2.essenceSlots, 3);
  assert.equal(m2.slots[2].name, 'Fire Ring');
  assert.deepEqual(m2.slots[2].twists, ['volley']);
  assert.equal(m2.slotPlan(2).name, 'Fire Ring');
  assert.equal(m2.slots[0].name, 'Spark');
  assert.equal(m2.mana.max, 52);
  assert.equal(Math.round(m2.mana.cur), Math.round(m.mana.cur));
  assert.equal(m2.sources['essence:fire'], 'boss:varek');
  // Junk in a save never breaks loading.
  const g3 = makeGame();
  g3.magic.deserialize({ unlocked: { essences: ['fire', 'plasma', 7] }, slots: [{ shape: 'laser' }, { shape: 'bolt', essences: ['nope'] }], slotCount: 99, mana: { cur: 'x' } });
  assert.deepEqual([...g3.magic.unlocked.essences].sort(), ['fire', 'raw']);
  assert.equal(g3.magic.slots[0], null);
  assert.deepEqual(g3.magic.slots[1].essences, ['raw']);
  assert.equal(g3.magic.slotCount, 6);
  g3.magic.deserialize(null);
});

// ---------------------------------------------------------------- open to new entries

test('a new essence, twist and status added at test time work with everything else', () => {
  Essences.register({
    id: 'ash',
    name: 'Ash',
    word: 'Cinder',
    noun: 'ash',
    palette: { core: '#f0e6dc', glow: '#9a8f86', spark: '#c8bdb2', deep: '#3d3631' },
    status: { id: 'smothered' },
    tags: ['ash', 'fire'],
  });
  Statuses.register({ id: 'smothered', tags: ['ash'], duration: 2, move: 0.7, color: '#9a8f86' });
  let updates = 0;
  Twists.register({ id: 'jitter', adj: 'Jittering', clause: ['jitters', 'jitter'], onUpdate(b) {
    updates++;
    if (b.kind === 'projectile' && b.mode === 'fly') b.vy += Math.sin(b.age * 40) * 4;
  } });
  try {
    const g = makeGame({ foes: 3 });
    const m = g.magic;
    m.unlockAll();
    assert.ok(m.isUnlocked('essence', 'ash'));
    for (const shape of Shapes.ids()) {
      resetArena(g);
      const p = m.compile({ shape, essences: ['ash', 'water'], twists: ['jitter', 'split'] });
      assert.ok(p.ok, `${shape}: ${p.reason}`);
      assert.match(p.name, /Jittering/);
      const r = m.cast(g.player, { shape, essences: ['ash', 'water'], twists: ['jitter', 'split'] }, AIM);
      assert.ok(r.ok, `${shape}: ${r.message}`);
      run(g, 2);
    }
    assert.ok(updates > 0);
    resetArena(g);
    g.foes[0].x = g.player.x + 30;
    g.foes[0].y = g.player.y;
    m.cast(g.player, { shape: 'nova', essences: ['ash'] }, AIM);
    run(g, 0.3);
    assert.ok(m.status.has(g.foes[0], 'smothered'));
  } finally {
    Essences.unregister('ash');
    Twists.unregister('jitter');
    Statuses.unregister('smothered');
  }
});

test('weave names come from the words alone', () => {
  const plan = { shapeDef: Shapes.get('orb'), essenceDefs: [Essences.get('frost'), Essences.get('water')], twistDefs: [Twists.get('homing')], count: 1 };
  assert.equal(weaveName(plan), 'Seeking Glacial Orb');
  assert.equal(weaveName({ shapeDef: Shapes.get('bolt'), essenceDefs: [Essences.get('raw')], twistDefs: [] }), 'Arcane Bolt');
});

// ---------------------------------------------------------------- the plain look

function stubCtx() {
  const calls = { n: 0, bad: 0 };
  const num = (...a) => {
    calls.n++;
    for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) calls.bad++;
  };
  return {
    calls,
    canvas: { width: 480, height: 270 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    fillRect: num,
    strokeRect: num,
    beginPath: num,
    closePath: num,
    moveTo: num,
    lineTo: num,
    arc: num,
    ellipse: num,
    fill: num,
    stroke: num,
  };
}

test('the fallback draws every kind, mode and status without a throw or a NaN, and lights each', () => {
  const g = makeGame({ foes: 4 });
  const m = g.magic;
  m.unlockAll();
  g.foes.forEach((f, i) => {
    f.x = g.player.x + 30 + i * 14;
    f.y = g.player.y - 10 + (i % 2) * 20;
  });
  const ctx = stubCtx();
  const draw = () => {
    m.layer.drawShadow(ctx, 0, 0, g.time);
    m.layer.draw(ctx, 0, 0, g.time);
    const lights = m.layer.getLight(g.time);
    for (const l of lights) assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y) && l.r > 0 && l.intensity >= 0, 'light');
    return lights.length;
  };
  let lit = 0;
  for (const shape of Shapes.ids()) {
    resetArena(g);
    g.foes.forEach((f, i) => {
      f.x = g.player.x + 30 + i * 14;
      f.y = g.player.y - 10 + (i % 2) * 20;
    });
    const w = { shape, essences: ['frost', 'storm'], twists: ['linger', 'spiral'] };
    if (shape === 'beam') m.castStart(g.player, w, { x: g.foes[0].x, y: g.foes[0].y });
    else m.cast(g.player, w, { x: g.foes[0].x, y: g.foes[0].y });
    for (let i = 0; i < 90; i++) {
      step(g);
      if (i % 3 === 0) lit = Math.max(lit, draw());
    }
    m.castRelease(g.player);
  }
  for (const id of Statuses.ids()) m.status.apply(g.foes[0], id, { src: g.player, ignoreImmunity: true, chance: 99 });
  m.castStart(g.player, { shape: 'bolt', essences: ['fire'], twists: ['charge'] }, AIM);
  run(g, 0.5);
  draw();
  m.castCancel(g.player);
  assert.ok(ctx.calls.n > 1000, 'it drew');
  assert.equal(ctx.calls.bad, 0, 'no NaN reached the canvas');
  assert.ok(lit > 0, 'weaves light the night');
  // The layer sits with the entities but is no one: never alive, never interactive.
  assert.equal(m.layer.isAlive(), false);
  assert.equal(m.layer.canInteract(), false);
  assert.ok(m.layer.sortY > 1e5);
});

test('a frozen or stunned caster cannot weave; a hold is broken by a stun', () => {
  const g = makeGame({ foes: 1 });
  const m = g.magic;
  m.unlockAll();
  m.castStart(g.player, { shape: 'beam', essences: ['raw'] }, AIM);
  assert.ok(m.holdOf(g.player));
  m.status.apply(g.player, 'stunned', { src: g.foes[0] });
  step(g);
  assert.equal(m.holdOf(g.player), null);
  assert.equal(m.cast(g.player, 0, AIM).reason, 'disabled');
  run(g, 2.5);
  assert.equal(m.cast(g.player, 0, AIM).ok, true);
});
