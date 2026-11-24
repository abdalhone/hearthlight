// Bind and ward (DESIGN §22.5): a bind holds what it closes on (rooted, no blows, no
// weaves) for a time its essences set, bosses resist it with diminishing returns, and a
// bind on a villager or Lyra is an attack; a ward takes blows until its strength is
// spent, stops foes' arrows, bolts, weaves and globs (light turns them back, wind turns
// them aside), answers whoever strikes it, and its essences and twists flavor it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, step, run, resetArena } from './magic_helpers.mjs';
import { compileWeave } from '../src/magic/compile.js';
import { bindFlavor, wardFlavor, BIND_FLAVORS, WARD_FLAVORS, Shapes } from '../src/magic/shapes.js';
import { Essences } from '../src/magic/essences.js';
import { Twists } from '../src/magic/twists.js';
import { Projectile } from '../src/entities/projectiles.js';
import { Hazard } from '../src/bosses/hazards.js';
import { aimsAtSpot, previewOf, SHAPE_INFO } from '../src/ui/weave_meta.js';
import { SHAPE_GLYPHS } from '../src/ui/weave_icons.js';
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { generateWorld } from '../src/world/worldgen.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Combat } from '../src/entities/combat.js';
import { Magic } from '../src/magic/magic.js';
import { BossManager } from '../src/bosses/manager.js';

function arena(opts = {}) {
  const g = makeGame({ foes: 3, log: true, ...opts });
  g.magic.unlockAll();
  return g;
}

const free = { free: true };
const bound = (g, a) => g.magic.status.has(a, 'bound');
const hold = (g, a) => g.magic.status.get(a, 'bound')?.t ?? 0;

// Cast a bind at a foe and run until the ring has closed.
function bindAt(g, foe, weave = { shape: 'bind', essences: ['raw'] }) {
  const r = g.magic.cast(g.player, weave, { x: foe.x, y: foe.y, target: foe }, free);
  assert.ok(r.ok, r.message);
  for (let i = 0; i < 90 && !bound(g, foe); i++) step(g);
  return r;
}

function wardOn(g, who = g.player, weave = { shape: 'ward', essences: ['raw'] }) {
  const aim = who === g.player ? null : { x: who.x, y: who.y - 6, target: who };
  const r = g.magic.cast(g.player, weave, aim, free);
  assert.ok(r.ok, r.message);
  step(g);
  step(g);
  return g.magic.wardOn(who);
}

// ================================================================== the shapes

test('bind and ward are plain registry entries that compile with every essence and twist', () => {
  for (const s of ['bind', 'ward']) {
    assert.ok(Shapes.has(s), s);
    for (const e of Essences.ids()) {
      for (const t of [null, ...Twists.ids()]) {
        const p = compileWeave({ shape: s, essences: [e], twists: t ? [t] : [] });
        assert.ok(p.ok, `${s}/${e}/${t}: ${p.reason}`);
        assert.ok(p.cost > 0 && p.dmg > 0 && p.cooldown > 0, `${s}/${e}/${t} numbers`);
        assert.ok(/ring|ward/i.test(p.description), `${s} says what it is: ${p.description}`);
      }
    }
  }
  assert.equal(compileWeave({ shape: 'bind', essences: ['fire'] }).name, 'Ember Bind');
  assert.equal(compileWeave({ shape: 'ward', essences: ['frost'] }).name, 'Rime Ward');
  // Twists that mean something else on a shield say so.
  assert.match(compileWeave({ shape: 'ward', essences: ['raw'], twists: ['linger'] }).description, /lasts longer/);
  assert.match(compileWeave({ shape: 'ward', essences: ['raw'], twists: ['burst'] }).description, /bursts when it breaks/);
  assert.match(compileWeave({ shape: 'ward', essences: ['raw'], twists: ['orbit'] }).description, /ring of small shields/);
  assert.match(compileWeave({ shape: 'ward', essences: ['raw'], twists: ['bounce'] }).description, /turns missiles back/);
  assert.match(compileWeave({ shape: 'bolt', essences: ['raw'], twists: ['linger'] }).description, /lingering patch/, 'other shapes keep the twist words');
  const plain = compileWeave({ shape: 'ward', essences: ['raw'] });
  assert.ok(compileWeave({ shape: 'ward', essences: ['raw'], twists: ['linger'] }).life > plain.life * 1.5, 'linger: a longer ward');
  assert.ok(compileWeave({ shape: 'ward', essences: ['earth'] }).shield > plain.shield * 1.4, 'earth: a stronger ward');
  assert.ok(compileWeave({ shape: 'ward', essences: ['iron'], twists: ['big'] }).radius > plain.radius * 1.3, 'big: wider');
  // Every essence has a flavor for both, and blends keep every gift.
  for (const e of Essences.ids()) assert.ok(BIND_FLAVORS[e] && WARD_FLAVORS[e], e);
  const f = wardFlavor({ essences: ['light', 'water'] });
  assert.ok(f.reflect && f.heal > 0);
  assert.deepEqual(bindFlavor({ essences: ['nature', 'song'] }).after, ['rooted', 'lulled']);
});

test('the interface knows both: glyphs, words, aim previews aimed at a spot', () => {
  for (const s of ['bind', 'ward']) {
    assert.ok(SHAPE_GLYPHS[s]?.length === 11 && SHAPE_GLYPHS[s].every((r) => r.length === 11), `${s} glyph`);
    assert.ok(SHAPE_INFO[s]?.desc);
  }
  const bp = previewOf(compileWeave({ shape: 'bind', essences: ['raw'] }), { shape: 'bind' });
  const wp = previewOf(compileWeave({ shape: 'ward', essences: ['raw'] }), { shape: 'ward' });
  assert.equal(bp.type, 'bind');
  assert.equal(wp.type, 'shield');
  assert.ok(aimsAtSpot(bp) && aimsAtSpot(wp));
});

// ================================================================== bind

test('a bind closes on its mark: rooted, no blows, no weaves, then it lets go', () => {
  const g = arena();
  const foe = g.foes[0];
  foe.x = g.player.x + 60;
  foe.y = g.player.y;
  bindAt(g, foe);
  assert.ok(bound(g, foe), 'held');
  step(g);
  assert.ok(foe.rootTime > 0 && foe.statusFlags.disabled, 'rooted and still');
  const ev = g.events.find((e) => e.type === 'bind');
  assert.ok(ev && ev.payload.target === foe && ev.payload.source === g.player && ev.payload.seconds > 1.5);
  assert.ok(g.magic.bodies.some((b) => b.active && b.kind === 'bind' && b.target === foe), 'a ring at its feet');
  // No blows, no arrows, no weaves.
  g.combat.t = 999;
  assert.equal(g.combat.melee(foe, { target: g.player }), false);
  assert.equal(g.combat.shoot(foe, g.player.x, g.player.y, 'arrow'), null);
  assert.equal(g.magic.cast(foe, { shape: 'bolt', essences: ['fire'] }, { x: g.player.x, y: g.player.y }).reason, 'disabled');
  // It cannot walk away.
  const x0 = foe.x;
  foe.moveIntent = { x: 1, y: 0 };
  run(g, 0.5);
  assert.ok(Math.abs(foe.x - x0) < 1, 'stays put');
  // And then it is free again.
  run(g, 4);
  assert.ok(!bound(g, foe), 'let go');
  assert.ok(!g.magic.bodies.some((b) => b.active && b.kind === 'bind'), 'the ring is gone');
});

test('essences flavor a bind: frost holds longer, fire bites, nature leaves vines, song a lull', () => {
  const g = arena();
  const foe = g.foes[0];
  const secs = {};
  for (const e of ['raw', 'frost', 'fire', 'nature', 'song']) {
    resetArena(g);
    foe.x = g.player.x + 50;
    foe.y = g.player.y;
    bindAt(g, foe, { shape: 'bind', essences: [e] });
    secs[e] = hold(g, foe);
    const hp = foe.hp;
    run(g, 1.6);
    if (e === 'fire') assert.ok(foe.hp < hp, 'a fire ring burns while it holds');
    if (e === 'raw') assert.equal(foe.hp, hp, 'a plain Stillring holds without hurting');
    for (let i = 0; i < 400 && bound(g, foe); i++) step(g);
    run(g, 0.1);
    if (e === 'nature') assert.ok(g.magic.status.has(foe, 'rooted'), 'vines keep its feet');
    if (e === 'song') assert.ok(g.magic.status.has(foe, 'lulled'), 'a song lull');
  }
  assert.ok(secs.frost > secs.raw * 1.3, `frost holds longer (${secs.frost} vs ${secs.raw})`);
  assert.ok(secs.fire < secs.raw, 'fire holds a little less');
  assert.ok(secs.song > secs.raw, 'song holds longer');
});

test('every twist binds in its own way: many rings, bursts, chains, a patch that grips the feet', () => {
  const g = arena({ foes: 4 });
  const near = (i, dx, dy) => {
    g.foes[i].x = g.player.x + dx;
    g.foes[i].y = g.player.y + dy;
  };
  resetArena(g);
  near(0, 70, 0);
  near(1, 76, -26);
  near(2, 76, 26);
  near(3, 300, 300);
  g.magic.cast(g.player, { shape: 'bind', essences: ['raw'], twists: ['multishot'] }, { x: g.foes[0].x, y: g.foes[0].y, target: g.foes[0] }, free);
  run(g, 0.7);
  assert.equal([0, 1, 2].filter((i) => bound(g, g.foes[i])).length, 3, 'three rings, three held');
  resetArena(g);
  near(0, 70, 0);
  near(1, 82, 12);
  near(2, 300, -300);
  near(3, 300, 300);
  g.magic.cast(g.player, { shape: 'bind', essences: ['raw'], twists: ['burst'] }, { x: g.foes[0].x, y: g.foes[0].y, target: g.foes[0] }, free);
  run(g, 0.8);
  assert.ok(bound(g, g.foes[0]) && bound(g, g.foes[1]), 'the burst holds its neighbour too');
  assert.ok(hold(g, g.foes[1]) < hold(g, g.foes[0]), 'a child holds for less');
});

test('bosses resist: a shorter hold, halved each time, shrugged off after three, forgotten in time', () => {
  const g = arena();
  const boss = g.foes[0];
  boss.boss = true;
  boss.superArmor = true;
  const holds = [];
  for (let k = 0; k < 4; k++) {
    resetArena(g);
    boss._bindDR = holds.length ? boss._bindDR : null;
    boss.x = g.player.x + 60;
    boss.y = g.player.y;
    const dr = boss._bindDR;
    g.magic.cast(g.player, { shape: 'bind', essences: ['raw'] }, { x: boss.x, y: boss.y, target: boss }, free);
    let h = 0;
    for (let i = 0; i < 90; i++) {
      step(g);
      h = Math.max(h, hold(g, boss));
    }
    holds.push(Math.round(h * 100) / 100);
    if (!boss._bindDR) boss._bindDR = dr;
  }
  assert.ok(holds[0] > 0.8 && holds[0] < 1.6, `a boss holds for less (${holds})`);
  assert.ok(holds[1] < holds[0] * 0.65 && holds[2] < holds[1] * 0.65, `halved each time (${holds})`);
  assert.equal(holds[3], 0, `then shrugged off (${holds})`);
  assert.ok(g.events.some((e) => e.type === 'bind' && e.payload.resisted));
  // A while later it holds again.
  g.magic.t += 20;
  resetArena(g);
  boss.x = g.player.x + 60;
  boss.y = g.player.y;
  bindAt(g, boss);
  assert.ok(bound(g, boss), 'forgotten after a quiet spell');
});

test('binding a villager or Lyra is an attack: a crime, a blow she feels', () => {
  const g = arena();
  const v = g.villager;
  v.x = g.player.x + 50;
  v.y = g.player.y;
  g.combat.isLawful = (a) => a === v;
  bindAt(g, v);
  assert.ok(bound(g, v), 'aimed at on purpose, it lands');
  assert.ok(g.player.crime, 'and it is a crime');
  assert.ok(g.events.some((e) => e.type === 'damage' && e.payload.target === v && e.payload.source === g.player));
  const l = g.companion;
  l.x = g.player.x - 50;
  l.y = g.player.y;
  bindAt(g, l);
  assert.ok(bound(g, l));
  assert.ok(g.events.some((e) => e.type === 'damage' && e.payload.target === l && e.payload.source === g.player), 'Lyra hears it as a blow');
  assert.ok(g.events.some((e) => e.type === 'bind' && e.payload.target === l));
  // A bind aimed at a wolf never closes on a friend standing by.
  resetArena(g);
  g.events.length = 0;
  const foe = g.foes[0];
  foe.x = g.player.x + 70;
  foe.y = g.player.y;
  v.x = g.player.x + 35;
  v.y = g.player.y;
  bindAt(g, foe);
  assert.ok(!bound(g, v) && bound(g, foe));
});

// ================================================================== ward

test('a ward takes blows until its strength is spent, then breaks', () => {
  const g = arena();
  const P = g.player;
  const w = wardOn(g);
  assert.ok(w && w.shield > 15, 'a ward on the caster');
  assert.ok(g.events.some((e) => e.type === 'ward' && e.payload.bearer === P));
  const hp = P.hp;
  P.invuln = 0;
  assert.equal(g.combat.damage(g.foes[0], P, 8, { kind: 'melee' }), 0, 'a blow it takes whole');
  assert.equal(P.hp, hp);
  const dmg = g.events.find((e) => e.type === 'damage' && e.payload.target === P);
  assert.ok(dmg && dmg.payload.amount === 0 && dmg.payload.absorbed > 0, 'everyone still hears the blow');
  P.invuln = 0;
  const big = g.combat.damage(g.foes[0], P, 60, { kind: 'melee' });
  assert.ok(big > 0 && big < 60 - 5, 'a big blow breaks through what is left');
  step(g);
  assert.ok(!g.magic.wardOn(P), 'broken');
  assert.ok(g.events.some((e) => e.type === 'ward_broken'));
});

test('ward essences: earth weighs and holds more, water heals, dark drinks, fire burns whoever strikes', () => {
  const g = arena();
  const P = g.player;
  const foe = g.foes[0];
  resetArena(g);
  wardOn(g, P, { shape: 'ward', essences: ['earth'] });
  run(g, 0.6);
  assert.ok(g.magic.status.has(P, 'braced'), 'earth weighs on its bearer');
  const s0 = g.magic.wardOn(P).shield;
  resetArena(g);
  const w = wardOn(g, P, { shape: 'ward', essences: ['raw'] });
  assert.ok(s0 > w.shield * 1.4, 'and holds more');
  assert.ok(!g.magic.status.has(P, 'braced'));
  resetArena(g);
  P.hp = P.maxHp * 0.5;
  wardOn(g, P, { shape: 'ward', essences: ['water'] });
  run(g, 3);
  assert.ok(P.hp > P.maxHp * 0.5, 'water heals a little');
  resetArena(g);
  wardOn(g, P, { shape: 'ward', essences: ['fire'] });
  foe.x = P.x + 14;
  foe.y = P.y;
  const fhp = foe.hp;
  P.invuln = 0;
  g.combat.damage(foe, P, 6, { kind: 'melee' });
  run(g, 0.3);
  assert.ok(foe.hp < fhp && g.magic.status.has(foe, 'burning'), 'fire burns whoever strikes it');
  resetArena(g);
  P.hp = P.maxHp * 0.5;
  wardOn(g, P, { shape: 'ward', essences: ['dark'] });
  const h0 = P.hp;
  P.invuln = 0;
  g.combat.damage(foe, P, 10, { kind: 'melee' });
  run(g, 0.6);
  assert.ok(P.hp > h0, 'dark drinks a little');
});

test('a ward aimed at a friend shields them; song covers friends near; multishot shields more', () => {
  const g = arena();
  const P = g.player;
  const l = g.companion;
  l.x = P.x - 40;
  l.y = P.y;
  assert.ok(wardOn(g, l), 'a ward on Lyra');
  assert.ok(!g.magic.wardOn(P), 'not on the caster');
  l.invuln = 0;
  assert.equal(g.combat.damage(g.foes[0], l, 6, { kind: 'melee' }), 0);
  resetArena(g);
  l.x = P.x - 20;
  l.y = P.y;
  wardOn(g, P, { shape: 'ward', essences: ['song'] });
  l.invuln = 0;
  assert.equal(g.combat.damage(g.foes[0], l, 5, { kind: 'melee' }), 0, 'a song ward shields a friend beside its bearer');
  resetArena(g);
  l.x = P.x - 30;
  l.y = P.y;
  g.villager.x = P.x + 30;
  g.villager.y = P.y;
  g.magic.cast(P, { shape: 'ward', essences: ['raw'], twists: ['multishot'] }, null, free);
  run(g, 0.3);
  assert.ok(g.magic.wardOn(P) && g.magic.wardOn(l) && g.magic.wardOn(g.villager), 'three friends, three wards');
  // Homing: the friend hurt worst.
  resetArena(g);
  l.hp = l.maxHp * 0.3;
  g.magic.cast(P, { shape: 'ward', essences: ['raw'], twists: ['homing'] }, null, free);
  run(g, 0.2);
  assert.ok(g.magic.wardOn(l), 'finds whoever needs it most');
});

test('a ward stops arrows; light turns them back on the archer; wind turns them aside', () => {
  const g = arena();
  const P = g.player;
  const archer = g.foes[0];
  archer.faction = 'bandit';
  const shoot = () => {
    const p = new Projectile(g, { kind: 'arrow', owner: archer, target: P, x: P.x + 60, y: P.y, vx: -230, vy: 0, damage: 6 });
    g.entities.add(p);
    return p;
  };
  for (const [ess, how] of [
    ['raw', 'block'],
    ['light', 'reflect'],
    ['wind', 'deflect'],
  ]) {
    resetArena(g);
    archer.x = P.x + 100;
    archer.y = P.y;
    g.events.length = 0;
    wardOn(g, P, { shape: 'ward', essences: [ess] });
    const w = g.magic.wardOn(P);
    const s0 = w.shield;
    const hp = P.hp;
    const ahp = archer.hp;
    const arrow = shoot();
    run(g, 0.8);
    const ev = g.events.find((e) => e.type === 'damage' && e.payload.target === P);
    assert.equal(P.hp, hp, `${ess}: the arrow never reaches the bearer`);
    assert.ok(!ev || ev.payload.amount === 0, `${ess}: no wound`);
    assert.ok(w.shield < s0, `${ess}: stopping it cost the ward`);
    if (how === 'block') assert.ok(arrow.removed || arrow.state !== 'fly', 'blocked');
    if (how === 'reflect') assert.ok(archer.hp < ahp, 'light sends it back into the archer');
    if (how === 'deflect') assert.ok(Math.abs(arrow.vy) > 50 || arrow.removed, 'wind turned it aside');
  }
});

test("a ward stops foes' weaves and a boss's glob; the wall-like block costs strength", () => {
  const g = arena();
  const P = g.player;
  const caster = g.foes[1];
  caster.faction = 'monster';
  caster.x = P.x + 90;
  caster.y = P.y;
  const w = wardOn(g);
  const s0 = w.shield;
  const hp = P.hp;
  g.magic.cast(caster, { shape: 'bolt', essences: ['fire'] }, { x: P.x, y: P.y, target: P });
  run(g, 0.8);
  assert.equal(P.hp, hp, "a foe's bolt is stopped");
  assert.ok(w.shield < s0);
  // A boss's drifting bubble pops on it.
  const owner = g.foes[2];
  owner.atk = 10;
  const bub = g.entities.add(new Hazard(g, { kind: 'bubble', owner, x: P.x + 30, y: P.y, r: 8, life: 4, speed: 30, target: P, mul: 0.5 }));
  run(g, 1.2);
  assert.ok(bub.done, 'the bubble popped on the ward');
  assert.equal(P.hp, hp);
});

test('ward twists: burst explodes when it breaks, orbit circles three small shields that bump foes', () => {
  const g = arena();
  const P = g.player;
  const foe = g.foes[0];
  foe.x = P.x + 18;
  foe.y = P.y;
  const w = wardOn(g, P, { shape: 'ward', essences: ['storm'], twists: ['burst'] });
  w.shield = 1;
  P.invuln = 0;
  const fhp = foe.hp;
  g.combat.damage(foe, P, 9, { kind: 'melee' });
  run(g, 0.4);
  assert.ok(g.events.some((e) => e.type === 'ward_broken'));
  assert.ok(foe.hp < fhp, 'the break bursts on whoever is near');
  resetArena(g);
  foe.x = P.x + 17;
  foe.y = P.y - 6;
  const w2 = wardOn(g, P, { shape: 'ward', essences: ['iron'], twists: ['orbit'] });
  const plates = g.magic.wardPlates(w2, new Float32Array(6));
  assert.ok(plates.every(Number.isFinite));
  const hp2 = foe.hp;
  run(g, 2);
  assert.ok(foe.hp < hp2, 'the small shields bump a foe beside the bearer');
});

test('a second ward thickens the first; another weave takes its place', () => {
  const g = arena();
  const P = g.player;
  const w = wardOn(g);
  const s = w.shield;
  wardOn(g);
  assert.equal(g.magic.bodies.filter((b) => b.active && b.kind === 'ward' && b.target === P).length, 1, 'one ward to a bearer');
  assert.ok(w.shield > s, 'thicker');
  wardOn(g, P, { shape: 'ward', essences: ['frost'] });
  const now = g.magic.wardOn(P);
  assert.ok(now !== w && now.plan.essences.includes('frost'), 'a different ward takes its place');
});

// ================================================================== a real boss

test('a real boss is held by a bind (its blows wait), and a ward stops its hazards', () => {
  const W = generateWorld({ bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 0, hour: 8 }, entities: { list: [], nearest: () => null } }, 20261123);
  const g = {
    bus: new EventBus(),
    rng: new RNG(11),
    flags: {},
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: {},
    clock: { t: 0, hour: 22, day: 1, isNight: true, update(dt) { this.t += dt; } },
    particles: { emit() {} },
    camera: { shake() {}, x: -9999, y: -9999, vw: 10, vh: 10 },
    lighting: { flash() {} },
    bubbles: { say() {}, number() {}, icon() {}, clear() {} },
    ui: { toast() {} },
    audio: { play() {}, setMusic() {} },
  };
  g.map = W.map;
  g.objects = W.objects;
  g.locations = W.locations;
  g.spawns = W.spawns;
  g.isBlockedTile = (tx, ty, a) => g.map.isSolidTile(tx, ty, a) || g.objects.isBlockingTile(tx, ty, a);
  g.entities = new EntityManager(g);
  g.combat = new Combat(g);
  g.combat.random = () => 0.5;
  g.magic = new Magic(g);
  g.magic.unlockAll();
  g.bosses = new BossManager(g);
  g.bosses.onWorldBuilt();
  const id = 'mother_of_slimes';
  const b = g.bosses.get(id);
  const a = g.bosses.arenas[id];
  const P = g.entities.add(new Actor(g, { id: 'player', name: 'You', faction: 'player', maxHp: 5000, atk: 10, x: a.x, y: a.y, radius: 5 }));
  g.player = P;
  let spot = null;
  for (let k = 0; k < 24 && !spot; k++) {
    const ang = (k / 24) * Math.PI * 2;
    const x = a.x + Math.cos(ang) * a.r * 0.5;
    const y = a.y + Math.sin(ang) * a.r * 0.5;
    if (!g.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), null) && Math.hypot(x - b.x, y - b.y) > 40) spot = { x, y };
  }
  P.x = spot.x;
  P.y = spot.y;
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      g.time += 1 / 30;
      g.clock.update(1 / 30);
      g.entities.update(1 / 30);
      g.combat.update(1 / 30);
      g.bosses.update(1 / 30);
      g.magic.update(1 / 30);
    }
  };
  for (let i = 0; i < 30 && !g.bosses.active; i++) tick(1);
  assert.equal(g.bosses.active?.id, id, 'the fight began');
  tick(60);
  // Bind her: while held, her clock of blows waits and she does not move.
  P.x = b.x - 60;
  P.y = b.y;
  g.magic.cast(P, { shape: 'bind', essences: ['frost'] }, { x: b.x, y: b.y, target: b }, { free: true });
  let held = false;
  for (let i = 0; i < 30 && !held; i++) {
    tick(1);
    held = g.magic.status.has(b, 'bound');
  }
  assert.ok(held, 'the boss is held');
  const move = b.move ? { name: b.move.name, t: b.move.t } : null;
  const at = { x: b.x, y: b.y };
  tick(8);
  if (move && b.move) assert.ok(b.move.t <= move.t + 1e-6, 'a blow being wound up waits');
  assert.ok(Math.hypot(b.x - at.x, b.y - at.y) < 2, 'she stays where the ring holds her');
  // A ward over the player through the rest of the fight: her globs and bubbles are stopped.
  tick(90);
  let taken = 0;
  let blocked = 0;
  g.bus.on('damage', (p) => {
    if (p.target === P) taken += p.amount;
  });
  g.bus.on('*', (type) => {
    if (type === 'ward_broken') blocked++;
  });
  let wardTime = 0;
  for (let i = 0; i < 30 * 30; i++) {
    if (!g.magic.wardOn(P)) g.magic.cast(P, { shape: 'ward', essences: ['iron'] }, null, { free: true });
    if (g.magic.wardOn(P)) wardTime++;
    P.hp = P.maxHp;
    tick(1);
  }
  assert.ok(wardTime > 800, 'warded nearly all the time');
  assert.ok(taken < 200, `the ward took most of it (${taken} through)`);
});
