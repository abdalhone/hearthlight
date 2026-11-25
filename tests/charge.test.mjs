// r12 (the author: "the skills doesn't have cooldown and I want it if I hold it it gets
// stronger and also can you add in the settings a thing that will reset states and a
// thing that gives me all the magic stuff to try it"): cooldowns you can feel, kept per
// weave; hold-to-charge on every weave but a beam (a tap stays a tap, a hold grows to a
// cap, mana x(1 + k) paid at the release and never more than there is); Reset stat
// points; and "Try all magic" — on, off, rewards earned meanwhile kept, saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step as magicStep, run, resetArena, AIM } from './magic_helpers.mjs';
import { installProgression, saveProgression, loadProgression } from '../src/progression/index.js';
import { compileWeave } from '../src/magic/compile.js';
import { Shapes } from '../src/magic/shapes.js';
import { Prices } from '../src/magic/prices.js';
import * as BAL from '../src/magic/balance.js';
import { unlockComponent } from '../src/missions/system.js';
import { grantGlyph } from '../src/bosses/shard.js';
import { castModeOf } from '../src/ui/weave_meta.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the numbers

test('cooldowns you can feel: Spark ~0.75 s (snappy), blast and strike ~1.5 s, nova ~3.5 s, rain and wall 6-7 s; bind, ward, summon as they were', () => {
  const cd = (shape) => compileWeave({ shape, essences: ['raw'] }).cooldown;
  assert.ok(cd('bolt') >= 0.7 && cd('bolt') <= 0.9, `bolt ${cd('bolt')}`);
  for (const s of ['blast', 'strike']) assert.ok(cd(s) >= 1.4 && cd(s) <= 1.8, `${s} ${cd(s)}`);
  assert.ok(cd('nova') >= 3.3 && cd('nova') <= 3.7, `nova ${cd('nova')}`);
  for (const s of ['rain', 'wall']) assert.ok(cd(s) >= 6 && cd(s) <= 7, `${s} ${cd(s)}`);
  for (const s of ['bind', 'ward', 'summon']) assert.ok(near(cd(s), Shapes.get(s).base.cooldown, 0.01), `${s} ${cd(s)} unchanged`);
  // The longer wait buys a little damage: a Spark hits ~9% harder than its bare base.
  const spark = compileWeave({ shape: 'bolt', essences: ['raw'] });
  assert.ok(spark.dmg >= Shapes.get('bolt').base.dmg * 1.05, `spark ${spark.dmg}`);
  assert.ok(spark.budget.buy > 1 && spark.budget.buy < 1.15, `buy ${spark.budget.buy}`);
  assert.equal(compileWeave({ shape: 'ward', essences: ['raw'] }).budget.buy, 1, 'nothing bought where nothing was stretched');
});

test('charge curve: 0 inside the tap dead zone, growing after it, full at CHARGE_TIME, faster with the charge twist', () => {
  assert.equal(BAL.chargeK(0), 0);
  assert.equal(BAL.chargeK(BAL.CHARGE_DEAD - 0.01), 0, 'a quick tap is not charged');
  const a = BAL.chargeK(0.6);
  const b = BAL.chargeK(1.0);
  assert.ok(a > 0 && b > a && b < 1, `${a} < ${b}`);
  assert.equal(BAL.chargeK(BAL.CHARGE_TIME), 1);
  assert.equal(BAL.chargeK(9), 1, 'capped');
  const twist = BAL.CHARGE_TIME * BAL.CHARGE_TWIST_TIME;
  assert.equal(BAL.chargeK(twist, twist), 1, 'the twist is full twice as soon');
  assert.ok(BAL.chargeK(0.6, BAL.CHARGE_TIME, 1.5) > a, 'cast speed charges faster');
  // Mana: x(1 + k); what the mana in hand can pay for is the cap.
  assert.equal(BAL.affordableK(40, 10), 1);
  assert.ok(near(BAL.affordableK(15, 10), 0.5));
  assert.equal(BAL.affordableK(8, 10), 0);
  assert.equal(BAL.affordableK(0, 0), 1, 'a free weave charges all the way');
  const plan = compileWeave({ shape: 'bolt', essences: ['raw'], twists: ['charge'] });
  assert.equal(plan.chargePower, BAL.CHARGE_TWIST_POWER);
  assert.equal(compileWeave({ shape: 'bolt', essences: ['raw'] }).chargePower, BAL.CHARGE_POWER);
  assert.ok(1 + BAL.CHARGE_POWER >= 2.4 && 1 + BAL.CHARGE_POWER <= 2.6, 'about 2.5x at full');
  assert.ok(1 + BAL.CHARGE_TWIST_POWER > 1 + BAL.CHARGE_POWER, 'the twist reaches higher');
});

// ---------------------------------------------------------------- the runtime

function arena() {
  const g = makeGame({ foes: 1 });
  g.magic.unlockAll();
  g.magic.addMaxMana(200);
  g.magic.mana.cur = g.magic.mana.max;
  return g;
}

// Press, hold `secs`, release at the foe: -> { res, k, mana, dealt }.
function holdCast(g, slot, secs) {
  const m = g.magic;
  const foe = g.foes[0];
  resetArena(g);
  m.mana.cur = m.mana.max;
  const hp = foe.hp;
  const s = m.castStart(g.player, slot, { x: foe.x, y: foe.y }, { charge: true });
  assert.ok(s.ok, s.message);
  if (secs > 0) run(g, secs);
  const k = m.holdOf(g.player)?.k ?? 0;
  const mana = m.mana.cur;
  const res = m.castRelease(g.player, { x: foe.x, y: foe.y });
  const paid = mana - m.mana.cur;
  run(g, 1.2);
  return { res, k, paid, dealt: hp - foe.hp };
}

test('a quick tap casts on release at k 0 and costs what it always did; a full hold hits ~2.5x for 2x mana', () => {
  const g = arena();
  const m = g.magic;
  m.setSlot(1, { shape: 'bolt', essences: ['raw'] });
  const cost = m.costOf(g.player, m.slotPlan(1));
  const tap = holdCast(g, 1, 0.05);
  assert.ok(tap.res.ok);
  assert.equal(tap.k, 0, 'k 0 inside the dead zone');
  assert.ok(near(tap.paid, cost, 0.05), `tap paid ${tap.paid} of ${cost}`);
  const mid = holdCast(g, 1, 0.8);
  assert.ok(mid.k > 0.3 && mid.k < 0.8, `k ${mid.k}`);
  assert.ok(near(mid.paid, cost * (1 + mid.k), 0.1), `paid ${mid.paid} = ${cost} x (1 + ${mid.k})`);
  const full = holdCast(g, 1, 1.6);
  assert.equal(full.k, 1);
  assert.ok(near(full.paid, cost * 2, 0.1), `full paid ${full.paid}`);
  assert.ok(full.dealt >= tap.dealt * 2.2 && full.dealt <= tap.dealt * 2.8, `full ${full.dealt} vs tap ${tap.dealt}`);
  assert.ok(mid.dealt > tap.dealt && mid.dealt < full.dealt, 'it grows');
  // The charged bolt flew bigger.
  resetArena(g);
  m.castStart(g.player, 1, AIM, { charge: true });
  run(g, 1.6);
  m.castRelease(g.player, AIM);
  const big = m.bodies.find((b) => b.kind === 'projectile' && b.active);
  assert.ok(big && near(big.r, m.slotPlan(1).radius * (1 + BAL.CHARGE_SIZE), 0.01) && big.charge === 1, `r ${big?.r}`);
});

test('the walk slows only past the dead zone; a cancelled charge costs nothing; no charge without opts.charge', () => {
  const g = arena();
  const m = g.magic;
  const P = g.player;
  m.castStart(P, 0, AIM, { charge: true });
  magicStep(g);
  assert.equal(P.castMoveMul ?? 1, 1, 'a tap does not slow the walk');
  assert.equal(m.holdOf(P).live, false);
  run(g, 0.3);
  assert.equal(m.holdOf(P).live, true);
  assert.equal(P.castMoveMul, BAL.CHARGE_MOVE);
  const mana = m.mana.cur;
  m.castCancel(P);
  assert.equal(m.mana.cur, mana, 'cancel is free');
  assert.equal(P.castMoveMul, 1);
  assert.equal(m.cooldownLeft(0), 0, 'and starts no cooldown');
  // Without opts.charge a tap weave stays a tap (it never charges).
  m.castStart(P, 0, AIM);
  run(g, 1.6);
  assert.equal(m.holdOf(P).mode, 'tap');
  assert.equal(m.holdOf(P).k, 0);
  m.castCancel(P);
});

test('charging stops growing at what the mana in hand can pay for (and the hold says so)', () => {
  const g = arena();
  const m = g.magic;
  m.setSlot(1, { shape: 'nova', essences: ['raw'] });
  const cost = m.costOf(g.player, m.slotPlan(1));
  m.mana.cur = cost * 1.4;
  m._regenWait = 99; // no regen during the test
  m.castStart(g.player, 1, AIM, { charge: true });
  run(g, 1.6);
  const h = m.holdOf(g.player);
  assert.ok(near(h.k, 0.4, 0.02), `capped at ${h.k}`);
  assert.equal(h.capped, true);
  const before = m.mana.cur;
  const r = m.castRelease(g.player, AIM);
  assert.ok(r.ok);
  assert.ok(before - m.mana.cur <= before + 1e-6 && m.mana.cur >= -1e-6, 'never more than there is');
  assert.ok(near(before - m.mana.cur, cost * 1.4, 0.1), `paid ${before - m.mana.cur}`);
});

test('cooldowns follow the weave: a second slot with the same weave waits too; moving it neither dodges nor inherits', () => {
  const g = arena();
  const m = g.magic;
  const P = g.player;
  m.setSlot(1, { shape: 'nova', essences: ['raw'] });
  m.setSlot(2, { shape: 'nova', essences: ['raw'] });
  m.setSlot(3, { shape: 'bolt', essences: ['fire'] });
  assert.ok(m.cast(P, 1, AIM).ok);
  const left = m.cooldownLeft(1);
  assert.ok(left > 3, `nova cooling ${left}`);
  assert.ok(near(m.cooldownLeft(2), left), 'the same weave in another slot waits as long');
  assert.equal(m.canCast(2).reason, 'cooldown');
  assert.equal(m.cooldownLeft(3), 0, 'another weave is free');
  // Re-slotting: the nova moved to slot 3 still cools; the bolt moved to 1 is ready.
  m.setSlot(3, { shape: 'nova', essences: ['raw'] });
  m.setSlot(1, { shape: 'bolt', essences: ['fire'] });
  assert.ok(m.cooldownLeft(3) > 3, 'moving a weave does not dodge its cooldown');
  assert.equal(m.cooldownLeft(1), 0, 'and a slot does not hand its timer on');
  assert.ok(m.cooldownFraction(3) > 0.9 && m.cooldownTotal(3) > 3);
  // A press while cooling: refused with 'cooldown' and a 'not ready' fizzle.
  const fizz = [];
  g.magicFx = { onEvent: (t, p) => t === 'fizzle' && fizz.push(p.reason) };
  assert.equal(m.castStart(P, 3, AIM, { charge: true }).reason, 'cooldown');
  assert.deepEqual(fizz, ['cooldown']);
  // It comes back, and says so once.
  const ready = [];
  g.bus.on('weave_ready', (p) => ready.push(p.key));
  run(g, 3.8);
  assert.equal(m.cooldownLeft(3), 0);
  assert.equal(ready.length, 1);
  g.magicFx = undefined;
});

test('a beam cancelled or let go cools by cooldownOf (cast speed counts); a failed release stops the charge swell', () => {
  const g = arena();
  const m = g.magic;
  const P = g.player;
  m.setSlot(1, { shape: 'beam', essences: ['raw'] });
  g.stats = { get: (a, id) => (id === 'castSpeed' ? 2 : 1) };
  m.castStart(P, 1, AIM, { charge: true });
  assert.equal(m.holdOf(P).mode, 'hold', 'a beam pours, it does not charge');
  run(g, 0.2);
  m.castCancel(P);
  const want = m.cooldownOf(P, m.slotPlan(1));
  assert.ok(near(m.cooldownLeft(1), want, 0.02) && want < m.slotPlan(1).cooldown, `${m.cooldownLeft(1)} = ${want}`);
  g.stats = null;
  // A charge whose release is refused (the game paused under it) stops its swell.
  m.resetCooldowns();
  const ev = [];
  g.magicFx = { onEvent: (t, p) => ev.push(`${t}${p.cancel ? ':cancel' : p.start ? ':start' : ''}`) };
  m.castStart(P, 0, AIM, { charge: true });
  run(g, 0.5);
  g.paused = true;
  const r = m.castRelease(P, AIM);
  g.paused = false;
  assert.equal(r.ok, false);
  assert.ok(ev.includes('charge:start') && ev.includes('charge:cancel'), ev.join());
  g.magicFx = undefined;
});

// The verifier's play pass: every press now goes through castStart/castRelease, so what
// the press knew about its aim must reach the release.
test('a tap let go after its press keeps its auto-aim: with no foe about, Lyra standing ahead is never "aimed at"', () => {
  const g = makeGame({ log: true, foes: 0 });
  const m = g.magic;
  const P = g.player;
  const lyra = g.companion;
  lyra.x = P.x + 25;
  lyra.y = P.y + 4;
  // Auto-aim with nobody to aim at: straight ahead, right through where she stands.
  const auto = { x: P.x + 140, y: P.y - 7 + 10, auto: true };
  assert.ok(m.castStart(P, 0, auto, { charge: true }).ok);
  magicStep(g);
  const r = m.castRelease(P);
  assert.ok(r.ok);
  run(g, 1);
  const hit = g.events.find((e) => e.type === 'damage' && e.payload.target === lyra);
  assert.ok(hit, 'the bolt still touches her');
  assert.equal(hit.payload.deliberate, false, 'but an auto-aimed tap is an accident, as an instant cast always was');
  assert.equal(hit.payload.accident, true);
});

test('a charge let go just as Lyra steps into its line is an accident; aimed at her for FRIEND_STEADY it is deliberate', () => {
  const g = makeGame({ log: true, foes: 0 });
  const m = g.magic;
  const P = g.player;
  const lyra = g.companion;
  // A dragged (not auto) aim far along a line that passes where she will stand.
  const aim = { x: P.x + 140, y: P.y - 7 + 10, auto: false };
  const away = () => {
    lyra.x = P.x - 10;
    lyra.y = P.y + 70;
  };
  const inLine = () => {
    lyra.x = P.x + 25;
    lyra.y = P.y + 4;
  };
  const onLyra = () => g.events.filter((e) => e.type === 'damage' && e.payload.target === lyra).pop();
  // She walks into the line 0.1 s before the release.
  away();
  m.castStart(P, 0, aim, { charge: true });
  run(g, 1.2);
  inLine();
  run(g, 0.1);
  let r = m.castRelease(P, aim);
  assert.ok(r.ok && r.cast.friendly === false, 'not aimed at her');
  run(g, 1);
  let hit = onLyra();
  assert.ok(hit, 'the charged bolt still hits her on its way');
  assert.equal(hit.payload.deliberate, false);
  // She stood in the line all along: aimed at her, on purpose.
  resetArena(g);
  m.resetCooldowns();
  g.events.length = 0;
  inLine();
  m.castStart(P, 0, aim, { charge: true });
  run(g, 1.2);
  r = m.castRelease(P, aim);
  assert.equal(r.cast.target, lyra);
  run(g, 1);
  hit = onLyra();
  assert.ok(hit && hit.payload.deliberate === true, 'a steady aim at her is a blow at her');
  // A quick tap aimed at her (no time to be steady) still counts, as an instant cast did.
  resetArena(g);
  m.resetCooldowns();
  g.events.length = 0;
  inLine();
  m.castStart(P, 0, aim, { charge: true });
  magicStep(g);
  r = m.castRelease(P, aim);
  assert.equal(r.cast.target, lyra);
});

test('one charge at a time: starting a second weave lets the first one go (it is cast)', () => {
  const g = arena();
  const m = g.magic;
  const P = g.player;
  m.setSlot(1, { shape: 'bolt', essences: ['fire'] });
  const casts = [];
  g.bus.on('spell_cast', (p) => casts.push({ slot: p.slot, k: p.chargeK }));
  m.castStart(P, 0, AIM, { charge: true });
  run(g, 0.8);
  m.castStart(P, 1, AIM, { charge: true });
  assert.equal(casts.length, 1);
  assert.equal(casts[0].slot, 0);
  assert.ok(casts[0].k > 0.3, 'with the charge it had');
  assert.equal(m.holdOf(P).plan.weave.shape, 'bolt');
  m.castRelease(P, AIM);
  assert.deepEqual(
    casts.map((c) => c.slot),
    [0, 1],
  );
});

test('a beam with the charge twist charges (castModeOf says so too)', () => {
  const plan = compileWeave({ shape: 'beam', essences: ['raw'], twists: ['charge'] });
  assert.equal(plan.input, 'charge');
  assert.equal(castModeOf(plan, plan.weave), 'charge');
  assert.equal(castModeOf(compileWeave({ shape: 'beam', essences: ['raw'] })), 'hold');
  assert.equal(castModeOf(compileWeave({ shape: 'bolt', essences: ['raw'] })), 'quick');
});

// ---------------------------------------------------------------- Reset stat points

function world() {
  const g = makeGame({ foes: 1 });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  return g;
}

test('Reset stat points: every spent point back, free; level, coin and the mission bonus stay; guarded', () => {
  const g = world();
  const P = g.player;
  const pr = g.progression;
  assert.equal(pr.resetPoints().ok, false, 'nothing spent');
  P.level = 4;
  pr.bonus = 2;
  P.inventory?.add?.('coin', 50);
  const coin = P.inventory?.count?.('coin') ?? 0;
  pr.spend('vitality', 3);
  pr.spend('weave', 2);
  const maxHp = P.maxHp;
  assert.equal(pr.spent(), 5);
  const ev = [];
  g.bus.on('respec', (p) => ev.push(p));
  P.downed = true;
  assert.match(pr.resetPoints().reason, /bleeding/);
  P.downed = false;
  const r = pr.resetPoints();
  assert.ok(r.ok);
  assert.equal(r.points, 5);
  assert.equal(pr.spent(), 0);
  assert.equal(pr.unspent(), 3 * 3 + 2, 'everything earned (levels and the mission bonus) is there to spend');
  assert.equal(P.level, 4);
  assert.equal(P.inventory?.count?.('coin') ?? 0, coin, 'free');
  assert.ok(P.maxHp < maxHp && P.hp <= P.maxHp, 'health settles into the new maximum');
  assert.equal(ev[0].free, true);
  g.player = null;
  assert.equal(pr.resetPoints().ok, false);
});

// ---------------------------------------------------------------- Try all magic

test('Try all magic: everything open over the real state; off brings the real unlocks, counts and weaves back', () => {
  const g = world();
  const m = g.magic;
  const log = [];
  g.bus.on('magic_unlocked', (p) => log.push(p));
  m.unlock('essence', 'fire', 'mission:x');
  m.setSlot(1, { name: 'Ember', shape: 'bolt', essences: ['fire'] });
  log.length = 0;
  const mana = m.mana.cur;
  assert.equal(m.startTrial(), true);
  assert.equal(m.startTrial(), false, 'once');
  assert.equal(m.unlocked.shapes.size, Shapes.ids().length);
  assert.equal(m.unlocked.prices.size, Prices.ids().length);
  assert.deepEqual([m.slotCount, m.essenceSlots, m.twistSlots], [BAL.SLOTS_MAX, BAL.ESSENCE_SLOTS_MAX, BAL.TWIST_SLOTS_MAX]);
  assert.equal(m.mana.cur, mana, 'no free mana');
  assert.equal(log.length, 0, 'nothing announced as found');
  assert.equal(m.sources['shape:nova'], 'trial');
  assert.equal(m.isEarned('shape', 'nova'), false);
  assert.equal(m.realUnlocked.shapes.has('nova'), false);
  // Weave with borrowed parts, in old and new slots.
  assert.ok(m.setSlot(0, { shape: 'nova', essences: ['frost', 'storm', 'fire'], twists: ['big', 'echo', 'split', 'linger'] }).ok);
  assert.ok(m.setSlot(5, { shape: 'rain', essences: ['water'] }).ok);
  assert.ok(m.setSlot(2, { shape: 'bolt', essences: ['fire'], twists: [] }).ok, 'a weave made of earned parts');
  assert.ok(m.cast(g.player, 0, AIM, { free: true }).ok);
  assert.equal(m.endTrial(), true);
  assert.equal(m.trial, null);
  assert.deepEqual([...m.unlocked.shapes], ['bolt']);
  assert.ok(m.unlocked.essences.has('fire'));
  assert.deepEqual([m.slotCount, m.essenceSlots, m.twistSlots], [BAL.SLOTS_START, BAL.ESSENCE_SLOTS_START, BAL.TWIST_SLOTS_START]);
  assert.equal(m.slots[0].name, 'Spark', 'the weave you had came back');
  assert.equal(m.slots[1].name, 'Ember');
  assert.equal(m.slots[2].essences[0], 'fire', 'a weave of earned parts stays');
  assert.equal(m.slots[5], null);
  assert.equal(m.trialDrafts.length, 2, 'the borrowed weaves wait in the Spellbook');
  assert.equal(m.sources['shape:nova'], undefined);
  assert.ok(m.compile(m.trialDrafts[0]).ok === false, 'not castable now');
});

test('Try all magic: a mission reward and a boss price earned mid-trial survive the end; a slot reward counts for real', () => {
  const g = world();
  const m = g.magic;
  const log = [];
  g.bus.on('magic_unlocked', (p) => log.push(p));
  m.startTrial();
  // A mission gives frost (the trial already shows it): it is real, and announced.
  unlockComponent(g, 'essence', 'frost', 'mission:m1');
  assert.ok(m.realUnlocked.essences.has('frost'));
  assert.ok(log.some((p) => p.id === 'frost' && p.source === 'mission:m1'), 'announced as a real find');
  // A slot reward while the trial shows six.
  assert.equal(m.unlockSlot(), true);
  assert.equal(m.slotCount, BAL.SLOTS_MAX, 'the trial still shows six');
  // Varek falls during the trial: his price still drops (the trial's open set does not hide it).
  g.bus.emit('boss_defeated', { id: 'varek', boss: { x: g.player.x, y: g.player.y } });
  assert.equal(g.flags.price_shard_varek, 'dropped');
  assert.equal(grantGlyph(g, 'price', 'berserk', 'boss:varek'), 'magic', 'picked up as a new find, not "known"');
  assert.ok(m.realUnlocked.prices.has('berserk'));
  m.endTrial();
  assert.ok(m.unlocked.essences.has('frost'), 'the mission reward stayed');
  assert.ok(m.unlocked.prices.has('berserk'), 'the boss price stayed');
  assert.equal(m.unlocked.prices.size, 1, 'only that one');
  assert.equal(m.slotCount, BAL.SLOTS_START + 1, 'the slot reward stayed');
  assert.equal(m.sources['essence:frost'], 'mission:m1');
});

test('Try all magic: saved without the borrowed parts; loading with it on keeps it on, and off restores', () => {
  const g = world();
  const m = g.magic;
  m.unlock('twist', 'swift', 'mission:x');
  m.startTrial();
  m.setSlot(4, { shape: 'orb', essences: ['dark'], twists: ['homing'] });
  const save = JSON.parse(JSON.stringify(m.serialize()));
  assert.deepEqual(save.unlocked.shapes, ['bolt'], 'the real sets on disk');
  assert.deepEqual(save.unlocked.twists, ['swift']);
  assert.equal(save.slotCount, BAL.SLOTS_START);
  assert.equal(save.slots[4], null);
  assert.equal(save.trial.slots[4].shape, 'orb');
  // Load into a fresh runtime.
  const g2 = world();
  const m2 = g2.magic;
  m2.deserialize(save);
  assert.ok(m2.trial, 'still on');
  assert.equal(m2.slots[4].shape, 'orb');
  assert.equal(m2.slotPlan(4).ok, true);
  assert.equal(m2.unlocked.shapes.size, Shapes.ids().length);
  m2.endTrial();
  assert.deepEqual([...m2.unlocked.shapes], ['bolt']);
  assert.ok(m2.unlocked.twists.has('swift'));
  assert.equal(m2.slots[4], null);
  assert.equal(m2.trialDrafts[0].shape, 'orb');
  // A save made with it off has no trial.
  const save2 = m2.serialize();
  assert.equal(save2.trial, null);
  assert.equal(save2.drafts[0].shape, 'orb', 'the drafts are kept with the game');
  const g3 = world();
  g3.magic.deserialize(JSON.parse(JSON.stringify(save2)));
  assert.equal(g3.magic.trial, null);
  assert.equal(g3.magic.trialDrafts.length, 1);
});

test('Try all magic: its end stops a borrowed running price and clears its modifiers; an earned one runs on', () => {
  const g = world();
  const m = g.magic;
  const P = g.player;
  P.fall = () => true;
  m.startTrial();
  m.mana.cur = m.mana.max;
  assert.ok(m.cast(P, { shape: 'bolt', essences: ['raw'], prices: ['glass'] }, AIM, { free: true }).ok);
  assert.ok(m.cast(P, { shape: 'bolt', essences: ['raw'], prices: ['berserk'] }, AIM, { free: true }).ok);
  assert.ok(g.prices.state.berserk, 'berserk runs');
  assert.ok(g.stats.modifiers(P).some((x) => x.source === 'price:glass'));
  const ended = [];
  g.bus.on('price_ended', (p) => ended.push(p.price));
  m.endTrial();
  assert.equal(g.prices.state.berserk, null, 'berserk ended with the trial');
  assert.ok(!g.stats.modifiers(P).some((x) => String(x.source).startsWith('price:')), 'no price modifier left');
  assert.deepEqual(ended.sort(), ['berserk', 'glass']);
  // An earned price keeps running through a trial's end.
  m.unlock('price', 'glass', 'boss:lakes_hum');
  m.startTrial();
  m.cast(P, { shape: 'bolt', essences: ['raw'], prices: ['glass'] }, AIM, { free: true });
  m.endTrial();
  assert.ok(g.stats.modifiers(P).some((x) => x.source === 'price:glass'), 'an earned price is not taken away');
});

test('Try all magic: a save through saveProgression/loadProgression and the magic save together come back whole', () => {
  const g = world();
  g.progression.bonus = 1;
  g.progression.spend('focus', 1);
  g.magic.startTrial();
  const prog = JSON.parse(JSON.stringify(saveProgression(g)));
  const mag = JSON.parse(JSON.stringify(g.magic.serialize()));
  const g2 = world();
  g2.magic.deserialize(mag);
  loadProgression(g2, prog);
  assert.ok(g2.magic.trial);
  assert.equal(g2.progression.points.focus, 1);
  assert.equal(g2.progression.resetPoints().points, 1);
});

test('Try all magic: a weave of borrowed parts counts for no mission objective and no first-sight line', async () => {
  const { weaveEarned, earnedPart } = await import('../src/missions/tracker.js');
  const g = world();
  const m = g.magic;
  m.unlock('essence', 'fire', 'mission:x');
  assert.equal(weaveEarned(g, { shape: 'nova', essences: ['frost'], twists: [] }), true, 'no trial: nothing is checked');
  m.startTrial();
  assert.equal(weaveEarned(g, { shape: 'bolt', essences: ['fire', 'raw'], twists: [] }), true);
  assert.equal(weaveEarned(g, { shape: 'nova', essences: ['fire'], twists: [] }), false, 'a borrowed shape');
  assert.equal(weaveEarned(g, { shape: 'bolt', essences: ['frost'], twists: [] }), false, 'a borrowed essence');
  assert.equal(weaveEarned(g, { shape: 'bolt', essences: ['raw'], twists: ['split'] }), false, 'a borrowed twist');
  assert.equal(earnedPart(g, 'essence', 'fire'), true);
  m.endTrial();
});
