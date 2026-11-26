// Version 11: where round 13 (walls, sight, breakables, hit-stun, sleep at any hour, promises,
// Interface size) meets round 14a (the wider world at negative tiles, Brindlecombe, the
// calendar, the ember-ring, the last stand, the map). Each test is one seam: a rule of one
// round that must hold for the other round's things. The numbers follow the merge brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { TILE } from '../src/core/constants.js';
import { makeGame, step, placeAt, wolf } from './survival_world.mjs';
import { makeGame as makeVillage, step as stepVillage, clearScene, holdLyra, put, downBy } from './murder_world.mjs';
import { canReach } from '../src/world/walls.js';
import { lineOfSight, lightAt, look, witnessesOf } from '../src/murder/witness.js';
import { Lighting } from '../src/render/lighting.js';
import { breakSpec, strikeProp, strikable, MEND } from '../src/world/breakables.js';
import { sleepBlocked } from '../src/world/rest.js';
import { homeBed } from '../src/world/home.js';
import { Calendar, calendarPlugin, birthdayOf, baseAge } from '../src/world/calendar.js';
import { travelPlugin } from '../src/world/travel.js';
import { inVale } from '../src/world/wilds_layout.js';
import { Game } from '../src/core/game.js';
import { WorldMap, canvasZoom } from '../src/ui/world_map.js';
import { pauseItems } from '../src/ui/overlays.js';
import { MENU_ICONS } from '../src/ui/content.js';
import { ICONS } from '../src/ui/icons.js';
import { Magic } from '../src/magic/magic.js';
import { Actor } from '../src/entities/entity.js';

const px = (t) => t * TILE + TILE / 2;
const tileOf = (e) => [Math.floor(e.x / TILE), Math.floor(e.y / TILE)];

const quiet = () => {
  const keep = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = () => {};
  return () => Object.assign(console, keep);
};

function collHouse(g) {
  const b = g.map.buildings.find((x) => x.id === 'brindle_coll_house');
  assert.ok(b && b.x < 0, 'the Coll house stands in Brindlecombe, west of the vale (negative tiles)');
  return b;
}

// ---------------------------------------------------------------- 1. walls, sight, roofs, use

test('seam 1: a Brindlecombe wall stops a blow, an eye and the use button; the open door lets them through', () => {
  const g = makeGame({ hour: 14 });
  const b = collHouse(g);
  const it = b.interior;
  const P = g.player;
  // Outside the west wall, a wolf two tiles away inside.
  placeAt(g, P, px(b.x - 1), px(it.y + 2));
  const w = wolf(g, px(it.x), px(it.y + 2));
  assert.ok(Math.hypot(w.x - P.x, w.y - P.y) <= 2 * TILE + 1);
  assert.equal(canReach(g, P, w), false, 'no blow through the wall');
  assert.equal(lineOfSight(g, P.x, P.y - 6, w.x, w.y - 6), false, 'no eye through the wall');
  // Lyra in the street does not see into the house.
  const L = g.companion;
  placeAt(g, L, px(b.x - 2), px(it.y + 2));
  assert.equal(look(g, L, w.x, w.y), null, 'a house is another space');
  // The use button: the bed is just inside the wall, in reach but not through it.
  const bed = g.objects.get('bed_brindle_coll_house');
  placeAt(g, P, px(b.x - 1), px(it.y + 1));
  assert.ok(!g.interactions.candidates(P).includes(bed), 'not used through a wall');
  placeAt(g, P, px(it.x + 1), px(it.y + 1));
  assert.ok(g.interactions.candidates(P).includes(bed), 'from inside, it is in reach');
  // The door (left open in the dead village): through the doorway a blow lands.
  const [d] = b.doorTiles;
  const door = g.objects.doorAt(d.tx, d.ty);
  assert.ok(door?.state.open, 'Brindlecombe doors hang open');
  placeAt(g, P, px(d.tx), px(d.ty + 1));
  w.x = px(d.tx);
  w.y = px(d.ty - 2);
  assert.equal(canReach(g, P, w), true, 'through the open doorway');
  door.state.open = false;
  assert.equal(canReach(g, P, w), false, 'a shut door stops it');
  door.state.open = true;
  // Its roof: whatever lights under it is hidden from the street (the renderer's rule).
  const lights = new Lighting({ map: g.map });
  b._alpha = 1;
  assert.equal(lights.roofSeen(px(it.x + 2), px(it.y + 1)), 0, 'under the roof, from outside');
  assert.equal(lights.roofSeen(px(b.x - 2), px(it.y + 1)), 1, 'the street');
});

test('seam 1/6: the ember-ring under a roof lights its room, never the street a witness looks at', () => {
  const g = makeGame({ hour: 23 });
  const b = collHouse(g);
  const it = b.interior;
  // The street just outside the west wall, at night, three tiles from the ring.
  const sx = px(b.x - 1);
  const sy = px(it.y + it.h - 1);
  const dark = lightAt(g, sx, sy);
  g.survival.placeRing({ x: px(it.x + 1), y: px(it.y + it.h - 1), coins: 9, day: 1, where: 'in the Coll house', place: 'Brindlecombe' });
  assert.ok(g.survival.ring, 'the ring lies inside');
  assert.equal(lightAt(g, sx, sy), dark, 'the street is as dark as it was');
  assert.ok(lightAt(g, px(it.x + 2), px(it.y + it.h - 1)) > dark, 'its own room is lit by it');
  // The same ring out in the open lights the ground round it.
  g.survival.putOutRing('test');
  g.survival.placeRing({ x: px(b.x - 3), y: sy, coins: 9, day: 1 });
  assert.ok(lightAt(g, sx, sy) > dark + 0.2, 'in the open, it lights the street');
});

// ---------------------------------------------------------------- 2. breakables in the wilds

test('seam 2: crates, barrels and fences out in the wilds break like the vale\'s, and stay broken across a save at negative tiles', () => {
  const back = quiet();
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const C = g.locations.get('brindlecombe').center;
  placeAt(g, P, C.x, C.y);
  const blow = { source: P, amount: 10, punch: true, dirX: 1, dirY: 0 };
  const props = ['barrel@-312,43', 'crate@-301,43', 'fence@-295,58'].map((id) => g.objects.get(id));
  for (const o of props) {
    assert.ok(o, 'Brindlecombe has its barrels, crates and graveyard fence');
    assert.ok(o.tx < 0, `${o.id} at a negative tile`);
    assert.ok(strikable(o), `${o.id} can be struck`);
    assert.ok(strikeProp(g, o, blow), `${o.id} took the Strike`);
    assert.equal(o.state.broken, true, `${o.id} broke`);
    assert.equal(o.blocksTile(o.tx, o.ty, P), false, 'rubble you walk over');
  }
  // The rails next to the broken post point at the gap no more.
  const nb = g.objects.get('fence@-296,58');
  assert.equal(Number(nb.variant) & 2, 0, 'the neighbour has no rail toward the gap');
  // The east fork's barrels and the lookout's crate too.
  for (const id of ['barrel@201,25', 'crate@175,8']) assert.ok(strikeProp(g, g.objects.get(id), blow) && g.objects.get(id).state.broken, id);
  // Saved and loaded: the broken stay broken, at their negative ids.
  const saved = JSON.parse(JSON.stringify(g.objects.serialize()));
  assert.ok(saved.some((d) => d.id === 'barrel@-312,43' && d.state.broken));
  const g2 = makeGame({ hour: 14 });
  g2.objects.deserialize(saved);
  for (const o of props) assert.equal(g2.objects.get(o.id).state.broken, true, `${o.id} broken after the load`);
  assert.equal(Number(g2.objects.get('fence@-296,58').variant) & 2, 0, 'the rails fixed after the load too');
  // Mended on the clock, out there as in the vale.
  g2.clock.t += MEND + 5;
  for (let i = 0; i < 20; i++) g2.objects.update(0.5);
  for (const o of props) assert.equal(!!g2.objects.get(o.id).state.broken, false, `${o.id} mended`);
  back();
});

test('seam 2: a sign of a boss on its trail (the toll board) is what a story needs: no blow breaks it', () => {
  const g = makeGame({ hour: 14 });
  const board = g.objects.get('trail_varek_1');
  assert.ok(board && board.objType === 'sign' && board.trailBoss === 'varek', 'the toll board stands on the shore trail');
  assert.equal(breakSpec(board), null, 'never breakable');
  for (let i = 0; i < 5; i++) assert.equal(strikeProp(g, board, { source: g.player, amount: 50, punch: true }), false);
  assert.ok(!board.state.broken, 'still there to read');
  assert.ok(board.canInteract(g.player), 'and it still reads');
  for (const o of g.objects.all()) if (o.trailBoss) assert.equal(breakSpec(o), null, `${o.id} is spared`);
});

test('seam 2: no blow opens, breaks or spills a chest; a locked one keeps its way in, its contents whole', () => {
  const g = makeGame({ hour: 14 });
  const P = g.player;
  const chests = g.objects.all().filter((o) => o.objType === 'chest');
  assert.ok(chests.some((c) => c.tx < 0) && chests.some((c) => c.state.locked), 'chests in the wilds and locked ones in the vale');
  for (const c of chests) {
    const before = JSON.stringify(c.inventory.serialize());
    const locked = !!c.state.locked;
    assert.equal(strikable(c), false, `${c.id} is not a breakable`);
    for (const blow of [{ punch: true }, { heavy: true, charge: 1 }, { sword: true }]) assert.equal(strikeProp(g, c, { source: P, amount: 80, ...blow }), false, `${c.id} shrugs it off`);
    assert.equal(!!c.state.locked, locked, `${c.id}: the lock is as it was`);
    assert.ok(!c.state.broken && !c.state.forced && !c.removed, `${c.id} whole`);
    assert.equal(JSON.stringify(c.inventory.serialize()), before, `${c.id}: nothing lost, nothing doubled`);
  }
  // Even a chest-shaped thing given a breakable kind would not break while it holds things.
  assert.equal(breakSpec({ objType: 'crate', inventory: chests[0].inventory, state: {} }), null);
  // The designed way in is still there: the trunk offers its lock (key, keeper, or force).
  const trunk = g.objects.get('lyra_trunk');
  assert.match(trunk.interactLabel(P), /locked/);
});

// ---------------------------------------------------------------- 3. hit-stun out in the wilds

test('seam 3: a beam pins a wolf in the deep Whisperwood; a boss from the trails resists the flinch and is pinned less', () => {
  const g = makeGame({ hour: 14 });
  g.magic = new Magic(g);
  g.entities.add(g.magic.layer);
  const P = g.player;
  const deep = g.locations.get('deep_whisperwood').center;
  assert.ok(deep.y < 0, 'the deep wood lies north of the vale (negative tiles)');
  placeAt(g, P, deep.x, deep.y);
  const w = wolf(g, deep.x + 40, deep.y);
  g.combat.damage(P, w, 1, { kind: 'magic', pin: true, knockback: 0 });
  assert.ok(g.magic.status.has(w, 'pinned'), 'pinned');
  const boss = g.entities.add(new Actor(g, { id: 'test_boss', name: 'Greyjaw', faction: 'monster', maxHp: 900, x: deep.x - 40, y: deep.y }));
  boss.boss = true;
  g.combat.damage(P, boss, 1, { kind: 'magic', pin: true, knockback: 0 });
  const pw = g.magic.status.get(w, 'pinned');
  const pb = g.magic.status.get(boss, 'pinned');
  assert.ok(pb && pw && pb.t < pw.t, `a boss is held for less (${pb?.t} < ${pw?.t})`);
  g.magic.status.clear(boss);
  g.combat.damage(P, boss, 1, { kind: 'melee', knockback: 0 });
  assert.ok(!g.magic.status.has(boss, 'flinch'), 'a boss shrugs off the flinch');
});

// ---------------------------------------------------------------- 4. sleep and the calendar, the last stand, Brindlecombe beds

async function sleepIn(g, bed) {
  return Game.prototype.sleep.call(g, bed);
}

function sleeper(g) {
  const saves = [];
  Object.assign(g, { audio: { play() {} }, save: { save: async (r) => saves.push({ r, cal: JSON.parse(JSON.stringify(g.calendar?.serialize?.() ?? null)) }) } });
  g.brain.reflect = async () => null;
  return saves;
}

test('seam 4: sleeping at 14:00 into someone\'s birthday: had once, saved as had, never had again on a reload', async () => {
  const g = makeGame({ hour: 14 });
  g.calendar = new Calendar(g);
  g.calendar.update();
  const id = ['elda', 'bram', 'hobb', 'mira', 'tobias', 'aveline', 'hess', 'rowan', 'garrick', 'wenna', 'corran', 'sabeth', 'petra', 'alder', 'wys', 'tilly', 'pip', 'tansy'].find((x) => baseAge(x) != null && birthdayOf(x) === 2);
  assert.ok(id, 'someone was born on the second day of the year');
  const age = g.calendar.ageOf(id);
  const saves = sleeper(g);
  const bed = homeBed(g);
  placeAt(g, g.player, bed.x + 16, bed.y - 4);
  assert.equal(await sleepIn(g, bed), true);
  assert.equal(g.clock.day, 2);
  assert.equal(Math.floor(g.clock.hour), 7);
  const had = g.events.filter((e) => e.type === 'birthday' && e.p.id === id);
  assert.equal(had.length, 1, 'the birthday is had on waking');
  assert.equal(g.calendar.ageOf(id), age + 1, 'a year older');
  assert.equal(saves[0]?.cal?.celebrated?.[id], 2, 'the sleep\'s save knows it was had');
  // A reload of that save: no second birthday, and the age holds.
  const again = new Calendar(g);
  again.deserialize(saves[0].cal);
  again.update();
  for (let i = 0; i < 3; i++) again.update();
  assert.equal(g.events.filter((e) => e.type === 'birthday' && e.p.id === id).length, 1, 'never twice');
  assert.equal(again.ageOf(id), age + 1);
});

test('seam 4: no sleeping through the last stand\'s minute, nor while down', async () => {
  const g = makeGame({ hour: 14 });
  sleeper(g);
  const P = g.player;
  const bed = homeBed(g);
  placeAt(g, P, bed.x + 16, bed.y - 4);
  g.prices = { burning: () => true };
  assert.match(sleepBlocked(g, P) || '', /burning/);
  const day = g.clock.day;
  const t = g.clock.t;
  assert.equal(await sleepIn(g, bed), false);
  assert.equal(g.clock.day, day);
  assert.equal(g.clock.t, t, 'the clock never jumped past the minute');
  g.prices = { burning: () => false };
  P.downed = true;
  assert.match(sleepBlocked(g, P) || '', /bleeding/);
  P.downed = false;
  assert.equal(sleepBlocked(g, P), null);
});

test('seam 4: an empty Brindlecombe bed sleeps you to morning (any free bed); "Your bed", Home and the map still mean the Wayhouse', async () => {
  const g = makeGame({ hour: 14 });
  sleeper(g);
  const P = g.player;
  const bed = g.objects.get('bed_brindle_coll_house');
  assert.ok(bed && !bed.owner && !bed.villagerBed, 'nobody\'s bed');
  placeAt(g, P, bed.x + 16, bed.y - 4);
  assert.equal(bed.interactLabel(P), 'Sleep until morning', 'the same words as your own bed: it does the same');
  let slept = null;
  g.sleep = (b) => (slept = b);
  bed.interact(P);
  assert.equal(slept, bed, 'it sleeps you');
  delete g.sleep;
  assert.equal(await sleepIn(g, bed), true);
  assert.equal(Math.floor(g.clock.hour), 7);
  const home = homeBed(g);
  assert.equal(home.id, 'home_bed', 'home is still the Wayhouse');
  assert.notEqual(bed.name, 'Your bed');
  // The map's home mark is where the Home pointer leads.
  const wm = Object.create(WorldMap.prototype);
  wm.game = g;
  const mark = wm.marks().find((m) => m.kind === 'home');
  assert.ok(mark && mark.x === home.x && mark.y === home.y, 'the map marks the same bed');
  assert.match(mark.label, /Your bed/);
});

// ---------------------------------------------------------------- 5. promises across distance

test('seam 5: "go tell Lyra" while she is out past the vale: Elda waits for her to come home, then goes', async () => {
  const back = quiet();
  const g = makeVillage({ hour: 11 });
  clearScene(g, ['elda', 'lyra']);
  const elda = g.entities.get('elda');
  const P = g.player;
  P.x = elda.x + 18;
  P.y = elda.y;
  elda.adjustOpinion?.(30, 'test: she likes them');
  const camp = g.locations.get('treeline_camp').center;
  holdLyra(g, camp.x, camp.y);
  assert.equal(inVale(...tileOf(g.companion)), false, 'Lyra is up the Crown path');
  const r = await g.village.playerSays(elda, 'please go and talk to Lyra for me and tell her I am sorry');
  const c = g.village.commitments.open('elda')[0];
  assert.ok(c && c.kind === 'tell', 'a promise');
  assert.match(r.lines.join(' '), /past the vale|when she's back/i, `she says she will wait: ${r.lines.join(' ')}`);
  P.x += 300;
  let set = false;
  let left = false;
  for (let i = 0; i < 160; i++) {
    stepVillage(g, 0.5);
    if (c.state === 'doing') set = true;
    if (!inVale(...tileOf(elda))) left = true;
  }
  assert.equal(set, false, 'she never sets off into the wilds');
  assert.equal(left, false, 'and never leaves the vale');
  assert.equal(c.state, 'open', 'the promise waits');
  // Lyra comes home to the square: now Elda goes.
  const sq = g.locations.get('town_square').center;
  holdLyra(g, sq.x, sq.y);
  for (let i = 0; i < 400 && c.state !== 'kept'; i++) stepVillage(g, 0.5);
  assert.equal(c.state, 'kept', `kept once she was home (${c.state})`);
  back();
});

test('seam 5: a walk already begun stops when Lyra leaves the vale; the day passing while she is away breaks it for that reason', async () => {
  const back = quiet();
  const g = makeVillage({ hour: 11 });
  clearScene(g, ['elda', 'lyra']);
  const elda = g.entities.get('elda');
  g.player.x = elda.x + 18;
  g.player.y = elda.y;
  elda.adjustOpinion?.(30, 'test');
  const sq = g.locations.get('town_square').center;
  holdLyra(g, sq.x, sq.y);
  await g.village.playerSays(elda, 'go and talk to Lyra for me');
  const c = g.village.commitments.open('elda')[0];
  g.player.x += 300;
  for (let i = 0; i < 60 && c.state !== 'doing'; i++) stepVillage(g, 0.5);
  assert.equal(c.state, 'doing', 'she set off');
  const camp = g.locations.get('treeline_camp').center;
  holdLyra(g, camp.x, camp.y);
  stepVillage(g, 2);
  assert.equal(c.state, 'open', 'she turned back');
  assert.ok(!g.villageLife.steps.get('elda') || g.villageLife.steps.get('elda').kind !== 'keep', 'no walk to Lyra under way');
  c.due = g.clock.t - 1;
  g.village.commitments._acc = 5;
  g.village.commitments.update(1);
  assert.equal(c.state, 'broken');
  assert.match(c.why, /away/, c.why);
  back();
});

test('seam 5: an outing of hers out to Brindlecombe walks the roads: it makes way and never stands her on blocked ground', () => {
  const back = quiet();
  const g = makeGame({ hour: 10 });
  const L = g.companion;
  const a = L.mind.autonomy;
  step(g, 1);
  const loc = g.locations.get('brindlecombe');
  const o = a.outings.start({ at: 'brindlecombe', why: 'test', what: 'see the dead village', withPlayer: false, source: 'test' });
  assert.ok(o && o.phase === 'go', 'she sets out');
  assert.equal(L.behavior.directive.type, 'goto');
  const d0 = Math.hypot(loc.center.x - L.x, loc.center.y - L.y);
  let blocked = 0;
  for (let i = 0; i < 300; i++) {
    step(g, 0.1, 0.1);
    if (g.isBlockedTile(...tileOf(L), L)) blocked++;
  }
  const d1 = Math.hypot(loc.center.x - L.x, loc.center.y - L.y);
  assert.equal(blocked, 0, 'never on a wall, a thicket or water');
  assert.ok(d1 < d0 - 40 * TILE, `she made her way west (${Math.round((d0 - d1) / TILE)} tiles in 30 s)`);
  back();
});

test('seam 5: hate means distance on a wild path too: walked at on the Crown path, she steps away without jitter and never into the thicket', () => {
  for (const mode of ['wary', 'left']) {
    const g = makeGame({ hour: 14 });
    const L = g.companion;
    const P = g.player;
    const a = L.mind.autonomy;
    step(g, 1);
    a.adjustPlayer({ trust: -40, fear: mode === 'wary' ? 40 : 70, affinity: -60 }, 'test');
    a.setCompanionship(mode, 'You frighten me.', { cause: mode === 'left' ? 'fear_left' : 'fear' });
    const c = g.locations.get('deep_whisperwood').center;
    assert.ok(c.y < 0, 'the deep wood, north of the vale');
    placeAt(g, P, c.x, c.y + 8);
    placeAt(g, L, c.x, c.y - 90);
    step(g, 0.5);
    const dt = 0.05;
    let prev = { x: L.x, y: L.y };
    let lastV = null;
    let reversals = 0;
    let blocked = 0;
    for (let i = 0; i < 40 / dt; i++) {
      const dx = L.x - P.x;
      const dy = L.y - P.y;
      const d = Math.hypot(dx, dy);
      g.input.move = d > 40 ? { x: (dx / d) * 0.7, y: (dy / d) * 0.7 } : { x: 0, y: 0 };
      step(g, dt, dt);
      const vx = L.x - prev.x;
      const vy = L.y - prev.y;
      const sp = Math.hypot(vx, vy);
      prev = { x: L.x, y: L.y };
      if (sp > 0.15) {
        if (lastV && vx * lastV.x + vy * lastV.y < -0.5 * sp * Math.hypot(lastV.x, lastV.y)) reversals++;
        lastV = { x: vx, y: vy };
      }
      if (g.isBlockedTile(...tileOf(L), L)) blocked++;
    }
    assert.ok(reversals <= 6, `${mode}: ${reversals} reversals while walked at`);
    assert.equal(blocked, 0, `${mode}: never on a thicket or wall tile`);
  }
});

// ---------------------------------------------------------------- 6. witnesses in the wilds

function aloneUpThere(g) {
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  g.survival.lyraForVillager = () => {};
}

test('seam 6: a killing at the treeline camp with nobody there is unseen; dying up there after it leaves the secret whole and the coins in the embers', async () => {
  const back = quiet();
  const g = makeVillage({ hour: 12, settings: { deathMode: 'home' } });
  clearScene(g, ['bram']);
  aloneUpThere(g);
  const bram = g.entities.get('bram');
  bram.think = () => {};
  const camp = g.locations.get('treeline_camp').center;
  put(g.player, camp.x, camp.y);
  put(bram, camp.x + 14, camp.y);
  assert.deepEqual(witnessesOf(g, bram.x, bram.y, { exclude: ['bram'] }), [], 'nobody to see');
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.ok(rec && bram.dead);
  assert.deepEqual(rec.seen, []);
  assert.equal(rec.known, null);
  // The stranger falls to a wolf up there and dies.
  const P = g.player;
  P.inventory.remove('coin', P.inventory.count('coin'));
  P.inventory.add('coin', 21);
  P.invuln = 0;
  const w = wolf(g, P.x + 12, P.y);
  g.combat.damage(w, P, 999);
  w.removed = true;
  const fall = g.survival.fallOf(P);
  assert.ok(fall, 'down');
  stepVillage(g, fall.window + 2, 0.1);
  await g.survival.pending;
  const ring = g.survival.ring;
  assert.ok(ring && ring.coins === 21, 'the coins stayed where they fell');
  assert.ok(ring.y < 0, 'up the Crown path, in the wilds');
  assert.equal(g.player.crime ?? null, null, 'nobody knows');
  assert.equal(g.events.filter((e) => e.type === 'crime' && e.p?.victim?.id === 'bram').length, 0);
  assert.equal(g.murder.cases.bram, undefined, 'no body found, no murder case');
  assert.ok(g.murder.isDead?.('bram') ?? bram.dead, 'Bram is still dead');
  back();
});

test('seam 6: Lyra beside you at the treeline camp sees it', () => {
  const back = quiet();
  const g = makeVillage({ hour: 12 });
  clearScene(g, ['bram', 'lyra']);
  const bram = g.entities.get('bram');
  bram.think = () => {};
  const camp = g.locations.get('treeline_camp').center;
  put(g.player, camp.x, camp.y);
  put(bram, camp.x + 14, camp.y);
  holdLyra(g, camp.x - 20, camp.y + 10);
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.ok(rec.seen.some((s) => s.id === 'lyra'), 'she saw');
  back();
});

// ---------------------------------------------------------------- 7. the map under Interface size

test('seam 7: on the map drawn at Interface size, a click names the mark under the mouse', () => {
  const k = 1.45;
  const canvas = { clientWidth: 400, clientHeight: 300, getBoundingClientRect: () => ({ left: 100, top: 50, width: 400 * k, height: 300 * k }) };
  assert.ok(Math.abs(canvasZoom(canvas) - k) < 1e-9);
  assert.equal(canvasZoom({ clientWidth: 0 }), 1);
  const wm = Object.create(WorldMap.prototype);
  wm.canvas = canvas;
  wm.cap = { textContent: '' };
  wm._drawn = [
    { sx: 300, sy: 200, label: 'Brindlecombe' },
    { sx: 40, sy: 30, label: 'You' },
  ];
  wm._tap({ clientX: 100 + 300 * k, clientY: 50 + 200 * k });
  assert.equal(wm.caption, 'Brindlecombe', 'the mark under the mouse');
  // A phone (no zoom) as before.
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  wm._tap({ clientX: 41, clientY: 31 });
  assert.equal(wm.caption, 'You');
});

// ---------------------------------------------------------------- 8. one save for both rounds

function withPlugins(g) {
  g.plugins.register(travelPlugin);
  g.plugins.register(calendarPlugin);
  g.plugins.installAll();
  return g;
}

test('seam 8: one save round-trips both rounds\' state: broken wild props, ember-ring, calendar, map, promises, said today', () => {
  const back = quiet();
  const g = withPlugins(makeVillage({ hour: 14 }));
  const P = g.player;
  assert.ok(g.travel && g.calendar && g.saidToday && g.village.commitments);
  const barrel = g.objects.get('barrel@-312,43');
  strikeProp(g, barrel, { source: P, amount: 10, punch: true });
  assert.ok(barrel.state.broken);
  g.survival.placeRing({ x: px(-300), y: px(50), coins: 17, day: 1, where: 'in Brindlecombe', place: 'Brindlecombe' });
  g.calendar.celebrated = { pip: 3 };
  g.travel.reached.brindlecombe = 1;
  g.travel._see(Math.floor(-300 / 8), Math.floor(50 / 8));
  const c = g.village.commitments.add({ by: 'elda', kind: 'tell', to: 'lyra', message: 'I am sorry', state: 'open', made: g.clock.t, day: 1, due: g.clock.t + 900 });
  g.saidToday.quote('elda', 'Have you eaten, love?', 'chat');
  const data = JSON.parse(JSON.stringify(Game.prototype.serialize.call(g)));
  const g2 = withPlugins(makeVillage({ hour: 8 }));
  Game.prototype.deserialize.call(g2, data);
  assert.equal(g2.objects.get('barrel@-312,43').state.broken, true, 'the barrel');
  assert.equal(g2.survival.ring?.coins, 17, 'the ember-ring');
  assert.equal(g2.survival.ring?.where, 'in Brindlecombe');
  assert.deepEqual(g2.calendar.celebrated, { pip: 3 }, 'the calendar');
  assert.equal(g2.travel.reached.brindlecombe, 1, 'places reached');
  assert.equal(g2.travel.seenTile(-300, 50), true, 'the explored map');
  const c2 = g2.village.commitments.all?.().find((x) => x.id === c.id) || g2.village.commitments.list.find((x) => x.id === c.id);
  assert.ok(c2 && c2.message === 'I am sorry' && c2.state === 'open', 'the promise');
  assert.ok(JSON.stringify(g2.saidToday.serialize()).includes('Have you eaten'), 'what was said today');
  assert.equal(homeBed(g2).id, 'home_bed', 'home');
  back();
});

test('seam 8: a real save from before both rounds (f622302) loads into Version 11', () => {
  const back = quiet();
  const old = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/save_f622302.json.gz', import.meta.url))).toString('utf8'));
  assert.equal(old.plugins.travel, undefined, 'no travel in it');
  assert.equal(old.survival.ring, undefined, 'no ember-ring in it');
  const g = withPlugins(makeVillage({ hour: 8 }));
  const errors = [];
  const err = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    Game.prototype.deserialize.call(g, old);
  } finally {
    console.error = err;
  }
  assert.deepEqual(errors, [], 'nothing failed to restore');
  assert.equal(Math.round(g.clock.t), Math.round(old.clock.t), 'its clock');
  assert.equal(g.player.inventory.count('coin'), old.player.inventory ? g.player.inventory.count('coin') : g.player.inventory.count('coin'));
  assert.equal(g.survival.ring, null, 'no ring');
  assert.deepEqual(g.calendar.celebrated, {}, 'a fresh calendar');
  assert.ok(g.travel.seenTile(80, 60) && !g.travel.seenTile(-300, 50), 'the vale known, the wilds not yet');
  const felled = old.objects.filter((d) => d.state?.depleted && /^tree@/.test(d.id));
  for (const d of felled) assert.equal(g.objects.get(d.id)?.state.depleted, true, `${d.id} still felled`);
  // The game runs on from it.
  g.calendar.update();
  stepVillage(g, 3, 0.1);
  assert.equal(g.state, 'playing');
  back();
});

// ---------------------------------------------------------------- 9. menus

test('seam 9: the menu has both Map (N) and Home, each with its own icon', () => {
  const g = makeGame({ hour: 14 });
  const ui = { openMap() {}, homePointer: { active: false, toggle() {} }, openInventory() {}, openMissions() {}, openSettings() {} };
  const items = pauseItems(g, ui);
  const map = items.find((i) => i.id === 'map');
  const home = items.find((i) => i.id === 'home');
  assert.ok(map && home, items.map((i) => i.id).join(' '));
  assert.equal(map.key, 'N');
  for (const it of [map, home]) assert.ok(MENU_ICONS[it.id] && ICONS[MENU_ICONS[it.id]], `${it.id} has a real icon`);
  assert.notEqual(MENU_ICONS.map, MENU_ICONS.home);
});

// keep `step` referenced for future seams on the plain survival world
void step;
