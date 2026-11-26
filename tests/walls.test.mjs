// Walls stop attacks (DESIGN §31.1): the sword, every weave body and the beam use the
// projectiles' own tile test, so nobody is hit through a wall or a closed door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Combat } from '../src/entities/combat.js';
import { Player } from '../src/entities/player.js';
import { TILE } from '../src/core/constants.js';
import { wallBetween, canReach } from '../src/world/walls.js';
import { makeGame as makeArena, run, resetArena } from './magic_helpers.mjs';

// A 20 x 20 room with one wall row at ty = 10 (x 2..17) and a door at tx = 9.
function room(door = { open: false }) {
  const wall = (tx, ty) => tx < 0 || ty < 0 || tx >= 20 || ty >= 20 || (ty === 10 && tx >= 2 && tx <= 17 && tx !== 9);
  const solid = (tx, ty) => wall(tx, ty) || (tx === 9 && ty === 10 && !door.open);
  const game = {
    bus: new EventBus(),
    clock: { t: 0, daylight: 1 },
    time: 0,
    hitStop: 0,
    settings: {},
    map: { blocksProjectile: wall, isSolidTile: solid },
    objects: { doorAt: (tx, ty) => (tx === 9 && ty === 10 ? { objType: 'door', isOpen: door.open, state: { open: door.open } } : null) },
    isBlockedTile: solid,
    particles: { emit() {} },
    camera: { shake() {} },
    lighting: { flash() {} },
    bubbles: { number() {} },
    audio: { play() {} },
    ui: { toast() {} },
    input: { moveVector: () => ({ x: 0, y: 0 }), pressed: () => false, down: () => false, endFrame() {} },
  };
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = () => 0.5;
  return game;
}

test('wallBetween walks every tile on the line; end tiles, open doors and clear lines pass', () => {
  const door = { open: false };
  const g = room(door);
  const y = (ty) => ty * TILE + TILE / 2;
  // Straight across the wall row.
  assert.equal(wallBetween(g, 5 * TILE, y(8), 5 * TILE, y(12)), true);
  // Along it, on one side.
  assert.equal(wallBetween(g, 3 * TILE, y(11), 16 * TILE, y(11)), false);
  // Round the end of the wall.
  assert.equal(wallBetween(g, 18.5 * TILE, y(8), 18.5 * TILE, y(12)), false);
  // A shallow diagonal that clips the wall row.
  assert.equal(wallBetween(g, 2 * TILE, y(9) + 7, 12 * TILE, y(11) - 7), true);
  // Through the doorway: shut, then open.
  assert.equal(wallBetween(g, 9.5 * TILE, y(8), 9.5 * TILE, y(12)), true);
  door.open = true;
  assert.equal(wallBetween(g, 9.5 * TILE, y(8), 9.5 * TILE, y(12)), false);
  // Points standing in a wall tile do not block themselves (a body hugging a wall).
  assert.equal(wallBetween(g, 5 * TILE, 10 * TILE + 2, 5 * TILE, y(12)), false);
  // No map: nothing blocks.
  assert.equal(wallBetween({}, 0, 0, 100, 100), false);
});

test('the sword never reaches through a wall, even when the foe is inside its range', () => {
  const g = room();
  const p = g.entities.add(new Player(g, { x: 6 * TILE, y: 11 * TILE + 4 }));
  g.player = p;
  const wolf = g.entities.add(new Actor(g, { x: 6 * TILE, y: 10 * TILE - 3, faction: 'monster', maxHp: 100 }));
  wolf.species = 'wolf';
  p.faceDir('up');
  assert.ok(Math.hypot(wolf.x - p.x, wolf.y - p.y) < 25, 'inside the first swing\'s reach');
  assert.equal(canReach(g, p, wolf), false);
  g.combat.melee(p, { range: 25, arc: 2.7, cooldown: 0 });
  assert.equal(wolf.hp, 100, 'not hit through the wall');
  assert.equal(g.combat.lastMeleeHits, 0);
  // The same distance in the open: hit.
  wolf.y = p.y - (p.y - wolf.y);
  wolf.x = 18.5 * TILE;
  p.x = 18.5 * TILE;
  g.combat.melee(p, { range: 25, arc: 2.7, cooldown: 0 });
  assert.ok(wolf.hp < 100, 'hit round the end of the wall');
});

test('a wolf cannot bite through a wall either', () => {
  const g = room();
  const p = g.entities.add(new Player(g, { x: 5 * TILE, y: 11 * TILE + 4 }));
  g.player = p;
  const wolf = g.entities.add(new Actor(g, { x: 5 * TILE, y: 10 * TILE - 3, faction: 'monster', maxHp: 100, atk: 6 }));
  wolf.faceDir('down');
  g.combat.melee(wolf, { target: p, range: 26, kind: 'bite', cooldown: 0 });
  assert.equal(p.hp, p.maxHp);
});

// The weave arena with a wall column at tx = 13 (y 5..25) between the player (tx 10) and
// the foes (tx 16+).
function walledArena(opts = {}) {
  const g = makeArena({ foes: 1, party: false, ...opts });
  const base = g.map.blocksProjectile;
  const wall = (tx, ty) => base(tx, ty) || (tx === 13 && ty >= 5 && ty <= 25);
  g.map.blocksProjectile = wall;
  g.map.isSolidTile = wall;
  g.isBlockedTile = wall;
  g.magic.unlockAll();
  return g;
}

function hits(g, weave, aim, foePos, secs = 0.8) {
  resetArena(g);
  const foe = g.foes[0];
  foe.x = foePos.x;
  foe.y = foePos.y;
  const hp = foe.hp;
  const r = g.magic.cast(g.player, weave, aim, { free: true });
  assert.ok(r.ok, `cast ${weave.shape}: ${r.reason || ''}`);
  run(g, secs);
  return hp - foe.hp;
}

test('a nova, a strike, a blast and a bomb all stop at the wall', () => {
  const g = walledArena();
  const p = g.player;
  // The foe stands just beyond the wall, well inside each weave's reach.
  const behind = { x: 14 * TILE + 6, y: p.y };
  for (const shape of ['nova', 'strike', 'blast', 'throw']) {
    p.x = 12 * TILE + 8;
    const aimBehind = { x: behind.x, y: behind.y };
    const through = hits(g, { shape, essences: ['raw'] }, aimBehind, behind);
    assert.equal(through, 0, `${shape} reached through the wall`);
    p.x = 10 * TILE;
    p.y = 15 * TILE;
    const clear = { x: p.x + (behind.x - (12 * TILE + 8)), y: p.y };
    const landed = hits(g, { shape, essences: ['raw'] }, clear, clear);
    assert.ok(landed > 0, `${shape} should land in the open (dealt ${landed})`);
  }
});

test('a beam stops at the wall and never touches a foe on the far side', () => {
  const g = walledArena();
  const m = g.magic;
  const p = g.player;
  p.x = 12 * TILE;
  resetArena(g);
  p.x = 12 * TILE;
  const foe = g.foes[0];
  foe.x = 14 * TILE + 8;
  foe.y = p.y;
  const r = m.castStart(p, { shape: 'beam', essences: ['raw'] }, { x: foe.x, y: foe.y }, { free: true });
  assert.ok(r.ok, r.reason);
  run(g, 1.2);
  m.castRelease(p, { x: foe.x, y: foe.y });
  run(g, 0.2);
  assert.equal(foe.hp, foe.maxHp, 'the ray ends at the wall');
});

test('bolts do not seek, chain or ricochet to a foe behind a wall', () => {
  const g = walledArena({ foes: 2 });
  const m = g.magic;
  resetArena(g);
  const p = g.player;
  const [a, b] = g.foes;
  // One foe in the open to the north; a nearer one behind the wall to the east.
  a.x = p.x;
  a.y = p.y - 75;
  b.x = 14 * TILE + 4;
  b.y = p.y;
  assert.ok(Math.hypot(b.x - p.x, b.y - p.y) < 75);
  const pick = m.nearestFoe({ cast: { caster: p } }, p.x, p.y, 200, null);
  assert.equal(pick, a, 'the one in the open, never the one behind the wall');
});

// Round 14b (V-16, DESIGN §35.6): nothing hits through walls: bosses, creatures, rubble.
import { T } from '../src/world/tiles.js';
import { blowTile, BLOCKS_BLOW } from '../src/world/walls.js';
import { strike as bossStrike, hitShape } from '../src/bosses/kit.js';

// The room, plus a one-tile heap of rubble at (5, 14) and a ruin wall tile at (12, 14).
function rubbleRoom() {
  const g = room();
  const base = g.map.blocksProjectile;
  g.map.tileAt = (tx, ty) => (tx === 5 && ty === 14 ? T.RUBBLE : tx === 12 && ty === 14 ? T.RUIN_WALL : 0);
  g.map.blocksProjectile = (tx, ty) => base(tx, ty) || (tx === 12 && ty === 14);
  return g;
}

test('a heap of rubble stops a blade or a skeleton’s reach, not an arrow', () => {
  const g = rubbleRoom();
  assert.ok(BLOCKS_BLOW.has(T.RUBBLE));
  assert.equal(blowTile(g, 5, 14), true);
  const p = g.entities.add(new Player(g, { x: 5 * TILE + 8, y: 15 * TILE + 6 }));
  g.player = p;
  const skel = g.entities.add(new Actor(g, { x: 5 * TILE + 8, y: 13 * TILE + 8, faction: 'undead', maxHp: 50, atk: 8 }));
  skel.faceDir('down');
  // 30 px apart, the rubble between: the reach (28) would cross it, the rule does not.
  assert.equal(canReach(g, skel, p, skel.x, skel.y, { melee: true }), false);
  assert.equal(canReach(g, skel, p), true, 'an arrow flies over it');
  g.combat.melee(skel, { target: p, range: 34, kind: 'bite', cooldown: 0 });
  assert.equal(p.hp, p.maxHp, 'no blow across the rubble');
  // Across a one-tile ruin wall: nothing either way.
  const q = g.entities.add(new Actor(g, { x: 12 * TILE + 8, y: 13 * TILE + 6, faction: 'undead', maxHp: 50, atk: 8 }));
  p.x = 12 * TILE + 8;
  p.y = 15 * TILE + 4;
  g.combat.melee(q, { target: p, range: 34, kind: 'bite', cooldown: 0 });
  assert.equal(p.hp, p.maxHp, 'no blow through a ruin wall');
});

test('a boss blow and a hazard land nothing through a wall', () => {
  const g = room();
  const p = g.entities.add(new Player(g, { x: 5 * TILE, y: 11 * TILE + 6 }));
  g.player = p;
  const boss = g.entities.add(new Actor(g, { x: 5 * TILE, y: 9 * TILE, faction: 'monster', maxHp: 400, atk: 14 }));
  boss.boss = true;
  const dealt = bossStrike(boss, p, { mul: 1 });
  assert.equal(dealt, 0, 'the slam stops at the wall');
  assert.equal(p.hp, p.maxHp);
  const n = hitShape(boss, { kind: 'circle', x: 5 * TILE, y: 9 * TILE + 8, r: 60 }, { mul: 1 });
  assert.equal(n, 0, 'a ring of fire round the boss reaches nobody behind the wall');
  // On the same side it lands.
  p.y = 9 * TILE + 14;
  assert.ok(bossStrike(boss, p, { mul: 1 }) > 0, 'in the open it lands');
});
