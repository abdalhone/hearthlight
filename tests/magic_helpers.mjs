// A small arena for the Weave's tests: a walled 40 x 30 tile room with a pillar, the real
// entity manager and combat, the player, Lyra, a villager and a few dummy foes.
import { EventBus } from '../src/core/events.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Combat } from '../src/entities/combat.js';
import { Magic } from '../src/magic/magic.js';
import { TILE } from '../src/core/constants.js';

export const W = 40;
export const H = 30;

function solid(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
  if (tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1) return true;
  return tx >= 30 && tx <= 31 && ty >= 8 && ty <= 11; // a pillar
}

export function makeGame(opts = {}) {
  const game = {
    bus: new EventBus(),
    clock: { t: 0, daylight: 1, isNight: false },
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: {},
    flags: {},
    map: { w: W, h: H, blocksProjectile: solid, isSolidTile: solid, isWater: () => false, tileAt: () => 1 },
    objects: { doorAt: () => null, isBlockingTile: () => false },
    isBlockedTile: (tx, ty) => solid(tx, ty),
    particles: { emit() {} },
    camera: { shake() {}, x: 0, y: 0, vw: 480, vh: 270 },
    lighting: { flash() {} },
    bubbles: { number() {} },
    audio: { play() {} },
    ui: { toast() {} },
    events: [],
  };
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = () => 0.5; // no crits, no variance
  const player = game.entities.add(new Actor(game, { id: 'player', name: 'Traveler', faction: 'player', x: 10 * TILE, y: 15 * TILE, maxHp: 80 }));
  game.player = player;
  if (opts.party !== false) {
    game.companion = game.entities.add(new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', x: 8 * TILE, y: 13 * TILE, maxHp: 60 }));
    const v = new Actor(game, { id: 'bram', name: 'Bram Ironhand', faction: 'villager', x: 8 * TILE, y: 17 * TILE, maxHp: 50 });
    v.profile = { id: 'bram' };
    game.villager = game.entities.add(v);
  }
  game.foes = [];
  const n = opts.foes ?? 4;
  for (let i = 0; i < n; i++) {
    const f = new Actor(game, { id: `foe${i}`, name: 'Wolf', faction: 'monster', kind: 'monster', x: (16 + (i % 3) * 3) * TILE, y: (13 + Math.floor(i / 3) * 3 + (i % 2)) * TILE, maxHp: opts.foeHp ?? 5000 });
    f.species = 'wolf';
    game.foes.push(game.entities.add(f));
  }
  game.magic = new Magic(game);
  game.entities.add(game.magic.layer);
  if (opts.log) game.bus.on('*', (type, payload) => game.events.push({ type, payload }));
  return game;
}

// One fixed step of the world the way game.update runs it.
export function step(game, dt = 1 / 60) {
  game.time += dt;
  game.clock.t += dt;
  game.entities.update(dt);
  game.combat.update(dt);
  game.magic.update(dt);
}

export function run(game, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(game, dt);
}

// Put the arena back: foes healed and home, statuses and bodies gone, mana full.
export function resetArena(game) {
  const m = game.magic;
  for (const b of m.bodies) if (b.active) m.end(b, 'dismiss');
  m.update(1 / 60);
  m.pending.length = 0;
  m.holds.clear();
  m.movers.length = 0;
  m.decals.length = 0;
  const all = game.entities.all();
  for (const a of all) {
    if (a.type !== 'actor') continue;
    m.status.clear(a);
    a.statusImmune = null;
    a.reactAt = null;
    a.dead = false;
    a.downed = false;
    a.hp = a.maxHp;
    a.invuln = 0;
    a.lockTime = 0;
    a.rootTime = 0;
    a.knock.x = 0;
    a.knock.y = 0;
    a.z = 0;
    a.state = 'idle';
  }
  game.foes.forEach((f, i) => {
    f.x = (16 + (i % 3) * 3) * TILE;
    f.y = (13 + Math.floor(i / 3) * 3 + (i % 2)) * TILE;
    f.removed = false;
    f.solid = true;
    f.provokedBy = null;
    if (!game.entities.byId.has(f.id)) game.entities.add(f);
  });
  game.player.x = 10 * TILE;
  game.player.y = 15 * TILE;
  game.player.crime = null;
  if (game.companion) {
    game.companion.x = 8 * TILE;
    game.companion.y = 13 * TILE;
  }
  if (game.villager) {
    game.villager.x = 8 * TILE;
    game.villager.y = 17 * TILE;
  }
  m.mana.cur = m.mana.max;
  m.resetCooldowns();
  game.combat.dying.length = 0;
}

// Every finite-number field we care about, on every live body and actor.
export function assertSane(game, assert, label) {
  for (const b of game.magic.bodies) {
    if (!b.active) continue;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'r', 'angle', 'age', 'dmg']) {
      if (!Number.isFinite(b[k])) assert.fail(`${label}: body ${b.kind}/${b.mode} has ${k} = ${b[k]}`);
    }
    if (b.kind === 'beam') for (let i = 0; i < b.npts * 2; i++) if (!Number.isFinite(b.pts[i])) assert.fail(`${label}: beam point NaN`);
  }
  for (const a of game.entities.all()) {
    if (a.type !== 'actor') continue;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.hp)) assert.fail(`${label}: actor ${a.id} at ${a.x},${a.y} hp ${a.hp}`);
  }
}

export const AIM = { x: 17 * TILE, y: 14 * TILE };
