// The five bosses (DESIGN §22.3): each spawns in its arena, fights for simulated minutes
// without an error, can be beaten, emits boss_started / boss_defeated, drops the right
// glyph-shards (which unlock through game.magic, or wait in flags.pendingUnlocks), and
// resets to full strength when the player is knocked out. Arenas are reachable on foot
// from the village. The intros are valid story scripts that say nothing LORE hides.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Combat } from '../src/entities/combat.js';
import { spawnCreature } from '../src/entities/monsters.js';
import { BossManager } from '../src/bosses/manager.js';
import { BOSSES, BOSS_IDS, revealLine } from '../src/bosses/defs.js';
import { isBoss } from '../src/bosses/boss.js';
import { inShape } from '../src/bosses/kit.js';
import { dropGlyphShard as dropFromPickups } from '../src/entities/pickups.js';
import { grantGlyph } from '../src/bosses/shard.js';
import { BOSS_ART, paintBossFrame, glyphBitmap } from '../src/art/bosses_art.js';
import { BOSS_SCRIPTS, BOSS_INTRO, LYRA_BOSS_LINES, bossSpokenLines, registerBossScripts } from '../src/story/scripts_bosses.js';
import { SCRIPTS, validateStep } from '../src/story/scripts.js';
import { PANELS } from '../src/story/panels.js';

const SEED = 20261123;
const DT = 1 / 30;

const REWARDS = {
  varek: [
    ['essence', 'fire'],
    ['twist', 'volley'],
  ],
  greyjaw: [
    ['essence', 'wind'],
    ['twist', 'swift'],
  ],
  mother_of_slimes: [
    ['essence', 'poison'],
    ['twist', 'split'],
  ],
  lakes_hum: [
    ['essence', 'water'],
    ['twist', 'bounce'],
  ],
  bone_warden: [
    ['essence', 'dark'],
    ['twist', 'chain'],
  ],
};

// ---------------------------------------------------------------- a real world, a light game

let WORLD = null;
function world() {
  if (!WORLD) {
    const g = { bus: new EventBus(), rng: new RNG(7), flags: {}, time: 0, clock: { t: 0, hour: 8 }, entities: { list: [], nearest: () => null } };
    WORLD = generateWorld(g, SEED);
  }
  return WORLD;
}

function makeGame({ hour = 22, magic = true } = {}) {
  const W = world();
  const game = {
    bus: new EventBus(),
    rng: new RNG(11),
    flags: {},
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: {},
    clock: {
      t: 0,
      hour,
      day: 1,
      get isNight() {
        return this.hour >= 20.5 || this.hour < 5;
      },
      update(dt) {
        this.t += dt;
      },
    },
    particles: { emit() {} },
    camera: { shake() {}, x: -9999, y: -9999, vw: 10, vh: 10 },
    lighting: { flash() {} },
    bubbles: { say() {}, number() {}, icon() {}, clear() {} },
    ui: { toast() {} },
    audio: { play() {}, setMusic() {} },
  };
  game.map = W.map;
  game.objects = W.objects;
  game.locations = W.locations;
  game.spawns = W.spawns;
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = () => 0.5;
  game.pathfinder = new Pathfinder(game);
  if (magic) {
    game.unlocks = [];
    game.magic = {
      unlocked: { shapes: new Set(['bolt']), essences: new Set(), twists: new Set() },
      unlock(kind, id, source) {
        game.unlocks.push({ kind, id, source });
        this.unlocked[`${kind}s`]?.add(id);
        game.bus.emit('magic_unlocked', { kind, id, source });
      },
    };
  }
  game.bosses = new BossManager(game);
  for (const c of W.spawns.creatures) if (c.species === 'bandit_chief') spawnCreature(game, c.species, c.x, c.y, c.opts || {});
  game.bosses.onWorldBuilt();
  return game;
}

function addPlayer(game, x, y) {
  const p = game.entities.add(new Actor(game, { id: 'player', name: 'You', faction: 'player', maxHp: 120, atk: 10, x, y, radius: 5 }));
  game.player = p;
  return p;
}

function step(game, dt = DT) {
  game.time += dt;
  game.clock.update(dt);
  game.entities.update(dt);
  game.combat.update(dt);
  game.bosses.update(dt);
}

function events(game) {
  const out = [];
  game.bus.on('*', (type, payload) => out.push({ type, payload }));
  return out;
}

// Catch console.error from anything the fight touches.
function watchErrors() {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.map(String).join(' '));
  return {
    errs,
    restore() {
      console.error = orig;
    },
  };
}

// Put the player at the arena's edge, inside it, and let the manager start the fight.
function enterArena(game, id) {
  const a = game.bosses.arenas[id];
  const b = game.bosses.get(id);
  let spot = null;
  for (let k = 0; k < 24 && !spot; k++) {
    const ang = (k / 24) * Math.PI * 2;
    for (const f of [0.6, 0.45, 0.3, 0.75]) {
      const x = a.x + Math.cos(ang) * a.r * f;
      const y = a.y + Math.sin(ang) * a.r * f;
      if (!game.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), null) && Math.hypot(x - b.x, y - b.y) > 40) {
        spot = { x, y };
        break;
      }
    }
  }
  const p = game.player || addPlayer(game, spot.x, spot.y);
  p.x = spot.x;
  p.y = spot.y;
  for (let i = 0; i < 30 && !game.bosses.active; i++) step(game);
  return p;
}

// ---------------------------------------------------------------- tests

test('every boss is defined with its reward and placed in its arena', () => {
  const g = makeGame();
  assert.deepEqual(BOSS_IDS.sort(), Object.keys(REWARDS).sort());
  for (const id of BOSS_IDS) {
    assert.deepEqual(BOSSES[id].rewards, REWARDS[id], `${id} rewards`);
    const b = g.bosses.get(id);
    assert.ok(b && isBoss(b), `${id} spawned`);
    const a = g.bosses.arenas[id];
    assert.ok(a && a.r > 60, `${id} has an arena`);
    assert.ok(Math.hypot(b.home.x - a.x, b.home.y - a.y) < a.r + 32, `${id} lives in its arena`);
    assert.ok(Number.isFinite(b.maxHp) && b.maxHp >= 300, `${id} is tough`);
  }
  // Varek took the bandit chief's place: one chief, and he is the boss.
  const chiefs = g.entities.all().filter((e) => e.species === 'bandit_chief' && !e.removed);
  assert.equal(chiefs.length, 1);
  assert.ok(isBoss(chiefs[0]) && chiefs[0].id === 'varek');
  // The ruins key is still in the bandits' chest.
  assert.equal(g.objects.get('bandit_chest').inventory.count('ruins_key'), 1);
});

test('worldgen gives every arena, open ground at each center, the lake its rise spots', () => {
  const W = world();
  for (const id of BOSS_IDS) {
    const a = W.spawns.bosses[id];
    assert.ok(a && a.center && a.r > 0 && a.home, `${id} arena`);
  }
  const g = makeGame();
  const open = (p) => !g.isBlockedTile(Math.floor(p.x / 16), Math.floor(p.y / 16), null);
  for (const id of ['varek', 'greyjaw', 'mother_of_slimes', 'bone_warden', 'lakes_hum']) assert.ok(open(W.spawns.bosses[id].center), `${id} center is walkable`);
  const spots = W.spawns.bosses.lakes_hum.spots;
  assert.ok(spots.length >= 6, 'rise spots all round the island');
  for (const s of spots) assert.ok(W.map.isWater(Math.floor(s.x / 16), Math.floor(s.y / 16)), 'each spot is in the water');
});

test('every arena is reachable on foot from the village (the ruins with the key)', () => {
  const g = makeGame();
  const sq = g.locations.get('town_square').center;
  const walker = new Actor(g, { id: 'walker', faction: 'player', x: sq.x, y: sq.y, inventory: { ruins_key: 1 } });
  for (const id of BOSS_IDS) {
    const a = g.bosses.arenas[id];
    const path = g.pathfinder.find(sq.x, sq.y, a.x, a.y, { actor: walker, maxNodes: 60000 });
    assert.ok(path && path.length > 1, `a path to ${id}`);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - a.x, end.y - a.y) < 24, `${id}: the path ends in the arena`);
  }
});

test('entering an arena starts the fight: boss_started, the boss engages', () => {
  const g = makeGame();
  const log = events(g);
  enterArena(g, 'mother_of_slimes');
  assert.equal(g.bosses.active?.id, 'mother_of_slimes');
  const started = log.find((e) => e.type === 'boss_started');
  assert.ok(started && started.payload.id === 'mother_of_slimes');
  assert.equal(g.bosses.status('mother_of_slimes'), 'fighting');
  for (let i = 0; i < 120; i++) step(g);
  const b = g.bosses.get('mother_of_slimes');
  assert.ok(b.target === g.player, 'she is fighting the player');
});

for (const id of BOSS_IDS) {
  test(`${id}: three simulated minutes of fighting, no errors, sane numbers`, () => {
    const g = makeGame({ hour: 22 });
    const w = watchErrors();
    try {
      const p = enterArena(g, id);
      assert.equal(g.bosses.active?.id, id, 'fight started');
      const b = g.bosses.get(id);
      const a = g.bosses.arenas[id];
      const seen = new Set();
      let maxHaz = 0;
      let maxAdds = 0;
      for (let i = 0; i < 180 * 30; i++) {
        const t = i * DT;
        // The player keeps moving round the arena, and never dies (we are testing the boss).
        const ang = t * 0.5;
        const tx = a.x + Math.cos(ang) * a.r * 0.45;
        const ty = a.y + Math.sin(ang) * a.r * 0.45;
        const d = Math.hypot(tx - p.x, ty - p.y) || 1;
        p.moveIntent = { x: (tx - p.x) / d, y: (ty - p.y) / d };
        p.hp = p.maxHp;
        // Chip at the boss now and then so its phases come.
        if (i % 45 === 0 && b.mode === 'fight' && b.hp > b.maxHp * 0.3) g.combat.damage(p, b, 14, { kind: 'magic' });
        step(g);
        if (b.move) seen.add(b.move.name);
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.hp), 'no NaN');
        const haz = g.entities.all().filter((e) => e.type === 'hazard').length;
        maxHaz = Math.max(maxHaz, haz);
        maxAdds = Math.max(maxAdds, b.adds.size);
      }
      assert.equal(g.bosses.active?.id, id, 'still fighting');
      assert.ok(b.phase >= 2, `${id} reached phase 2`);
      assert.ok(seen.size >= 3, `${id} used several moves: ${[...seen].join(', ')}`);
      assert.ok(maxHaz < 60, `hazards stay bounded (${maxHaz})`);
      assert.ok(maxAdds <= 6, `adds stay bounded (${maxAdds})`);
      if (!b.flying) assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < a.r + 120, `${id} stays near its arena`);
      assert.deepEqual(w.errs, [], `no errors: ${w.errs.slice(0, 3).join(' | ')}`);
    } finally {
      w.restore();
    }
  });
}

for (const id of BOSS_IDS) {
  test(`${id}: can be beaten, emits boss_defeated, drops its glyph-shards, and they unlock`, () => {
    const g = makeGame({ hour: 22 });
    const log = events(g);
    const p = enterArena(g, id);
    const b = g.bosses.get(id);
    // Keep striking with weaves (they also crack the Warden's shield) until it falls.
    for (let i = 0; i < 300 * 30 && !log.some((e) => e.type === 'boss_defeated'); i++) {
      p.hp = p.maxHp;
      if (i % 6 === 0 && b.mode === 'fight') g.combat.damage(p, b, 40, { kind: 'magic', heavy: true });
      step(g);
    }
    const def = log.find((e) => e.type === 'boss_defeated');
    assert.ok(def && def.payload.id === id, `${id} defeated`);
    assert.ok(g.flags.bosses[id].defeated, 'saved as defeated');
    // Let the defeat play out (Varek walks off; the rest fall), from a step back.
    const stand = { x: p.x, y: p.y };
    p.x = b.x + 90;
    p.y = b.y + 90;
    for (let i = 0; i < 10 * 30; i++) {
      p.hp = p.maxHp;
      step(g);
    }
    p.x = stand.x;
    p.y = stand.y;
    assert.ok(b.removed || b.dead, `${id} is gone from the world`);
    assert.equal(g.bosses.active, null, 'the fight is over');
    const deaths = log.filter((e) => e.type === 'death' && e.payload.entity === b);
    if (BOSSES[id].yields) {
      assert.equal(deaths.length, 0, 'Varek is beaten, not killed');
      assert.ok(g.flags.varek_beaten, 'the village can know he was beaten');
    } else assert.equal(deaths.length, 1, `${id} died once`);
    const shards = g.entities.all().filter((e) => e.type === 'glyph' && !e.removed);
    assert.deepEqual(
      shards.map((s) => [s.kind, s.glyphId]).sort(),
      REWARDS[id].slice().sort(),
      `${id} dropped its shards`,
    );
    // Walk over them.
    for (const s of shards) {
      for (let i = 0; i < 60 && !s.collected; i++) {
        p.x = s.x;
        p.y = s.y + 4;
        step(g);
      }
      assert.ok(s.collected, 'picked up');
    }
    assert.deepEqual(
      g.unlocks.map((u) => [u.kind, u.id, u.source]).sort(),
      REWARDS[id].map(([k, gid]) => [k, gid, `boss:${id}`]).sort(),
      'unlocked through game.magic.unlock',
    );
    assert.equal(log.filter((e) => e.type === 'glyph_shard').length, 2, 'two reveals');
    assert.ok(Object.values(g.flags.bosses[id].shards).every((v) => v === 'taken'));
  });
}

test('losing resets the boss: the player knocked out, full health, home, no hazards, no adds', () => {
  const g = makeGame({ hour: 22 });
  const log = events(g);
  const p = enterArena(g, 'varek');
  const b = g.bosses.get('varek');
  for (let i = 0; i < 40 * 30; i++) {
    if (i % 10 === 0 && b.hp > b.maxHp * 0.4) g.combat.damage(p, b, 20, { kind: 'magic' });
    p.hp = p.maxHp;
    step(g);
  }
  assert.ok(b.hp < b.maxHp * 0.6 && b.phase === 2, 'hurt and in phase 2');
  g.combat.down(p, b);
  step(g);
  const reset = log.find((e) => e.type === 'boss_reset');
  assert.ok(reset && reset.payload.reason === 'player_down');
  assert.equal(g.bosses.active, null);
  assert.equal(b.hp, b.maxHp);
  assert.equal(b.phase, 1);
  assert.equal(b.mode, 'idle');
  assert.ok(Math.hypot(b.x - b.home.x, b.y - b.home.y) < 1, 'back home');
  assert.equal(g.entities.all().filter((e) => e.type === 'hazard' && !e.removed && e.owner === b).length, 0);
  assert.equal(b.adds.size, 0);
  assert.ok(!g.flags.bosses?.varek?.defeated);
  // And the next try works: back up, back in.
  g.combat.revive(p, null, 1);
  enterArena(g, 'varek');
  assert.equal(g.bosses.active?.id, 'varek');
});

test('walking away ends the fight and the boss mends', () => {
  const g = makeGame({ hour: 22 });
  const log = events(g);
  const p = enterArena(g, 'bone_warden');
  const b = g.bosses.get('bone_warden');
  g.combat.damage(p, b, 60, { kind: 'magic' });
  p.x = b.home.x + 600;
  p.y = b.home.y - 300;
  for (let i = 0; i < 8 * 30; i++) step(g);
  assert.ok(log.some((e) => e.type === 'boss_reset' && e.payload.reason === 'left'));
  assert.equal(b.hp, b.maxHp);
});

test('a beaten boss stays beaten after a load; untaken shards wait in its arena', () => {
  const g = makeGame();
  g.flags.bosses = { greyjaw: { defeated: true, day: 2, shards: { 'essence:wind': 'taken', 'twist:swift': 'dropped' } } };
  g.bosses.afterLoad();
  assert.equal(g.bosses.status('greyjaw'), 'defeated');
  assert.ok(!g.entities.all().some((e) => e.id === 'greyjaw' && !e.removed));
  const left = g.entities.all().filter((e) => e.type === 'glyph');
  assert.deepEqual(
    left.map((s) => [s.kind, s.glyphId]),
    [['twist', 'swift']],
  );
});

test('Greyjaw keeps the dark: gone by day, out at night', () => {
  const g = makeGame({ hour: 12 });
  const b = g.bosses.get('greyjaw');
  assert.equal(b.mode, 'hidden');
  assert.ok(b.veiled && b.faction === 'wildlife', 'nobody hunts a shape that is not there');
  addPlayer(g, 0, 0);
  g.clock.hour = 21;
  for (let i = 0; i < 10; i++) step(g);
  assert.equal(b.mode, 'idle');
  assert.ok(!b.veiled && b.faction === 'monster');
});

test('the Bone Warden\'s shield turns plain cuts and cracks under heavy blows and weaves', () => {
  const g = makeGame();
  const p = enterArena(g, 'bone_warden');
  const b = g.bosses.get('bone_warden');
  b.mem.shield = { pips: 6, max: 6, t: 0, flash: 0 };
  const hp = b.hp;
  assert.equal(g.combat.damage(p, b, 30, { kind: 'melee' }), 0, 'a plain cut glances off');
  assert.equal(b.hp, hp);
  assert.equal(b.mem.shield.pips, 6);
  g.combat.damage(p, b, 30, { kind: 'melee', heavy: true });
  assert.equal(b.mem.shield.pips, 4, 'a heavy blow cracks it twice');
  for (let i = 0; i < 4; i++) {
    b.invuln = 0;
    g.combat.damage(p, b, 10, { kind: 'magic' });
  }
  assert.equal(b.mem.shield, null, 'broken');
  assert.ok(b.mem.stagger > b.t, 'staggered');
  b.invuln = 0;
  const before = b.hp;
  const dealt = g.combat.damage(p, b, 20, { kind: 'melee', exact: true });
  assert.ok(dealt > 20 - b.def, `staggered, it takes more (${dealt})`);
  assert.ok(b.hp < before);
});

test('the Lake\'s Hum cannot be hurt under the water', () => {
  const g = makeGame();
  const p = enterArena(g, 'lakes_hum');
  const b = g.bosses.get('lakes_hum');
  b.mem.stage = 'below';
  b.setVeiled(true);
  assert.equal(g.combat.damage(p, b, 50, { kind: 'magic' }), 0);
  b.mem.stage = 'up';
  b.setVeiled(false);
  b.invuln = 0;
  assert.ok(g.combat.damage(p, b, 50, { kind: 'magic' }) > 0);
});

test('Lyra decides for herself: she joins, or she holds back and says so', () => {
  for (const decision of ['accept', 'refuse']) {
    const g = makeGame();
    const a = g.bosses.arenas.mother_of_slimes;
    const said = [];
    const ran = [];
    const lyra = g.entities.add(new Actor(g, { id: 'lyra', name: 'Lyra', faction: 'player', maxHp: 50, x: a.x, y: a.y + a.r - 10 }));
    lyra.mind = { companionship: 'together', evaluateRequest: () => ({ decision, risk: 0.3 }), say: (t) => said.push(t) };
    g.companion = lyra;
    g.actions = { run: (name, args, src) => ran.push([name, args, src]) };
    const log = events(g);
    enterArena(g, 'mother_of_slimes');
    for (let i = 0; i < 40; i++) step(g);
    if (decision === 'accept') {
      assert.equal(g.bosses.active.lyra, 'joined');
      assert.ok(ran.some(([n, args, src]) => n === 'attack' && args.target === 'mother_of_slimes' && src === 'self'));
      assert.ok(said.includes(LYRA_BOSS_LINES.join.mother_of_slimes));
    } else {
      assert.equal(g.bosses.active.lyra, 'declined');
      assert.ok(log.some((e) => e.type === 'boss_lyra_declined'));
      assert.ok(said.includes(LYRA_BOSS_LINES.decline.mother_of_slimes));
    }
  }
});

test('without the magic runtime, shards wait in flags.pendingUnlocks', () => {
  const g = makeGame({ magic: false });
  addPlayer(g, 100, 100);
  assert.equal(grantGlyph(g, 'essence', 'fire', 'boss:varek'), 'pending');
  assert.equal(grantGlyph(g, 'essence', 'fire', 'boss:varek'), 'known');
  assert.deepEqual(g.flags.pendingUnlocks, [{ kind: 'essence', id: 'fire', source: 'boss:varek' }]);
  const s = dropFromPickups(g, 'twist', 'chain', 100, 100, { source: 'boss:bone_warden', collectDelay: 0 });
  for (let i = 0; i < 20 && !s.collected; i++) step(g);
  assert.ok(s.collected);
  assert.equal(g.flags.pendingUnlocks.length, 2);
  assert.equal(revealLine('essence', 'fire'), 'You can weave fire');
});

test('markers and hits agree: a circle, a line and a cone', () => {
  const e = (x, y) => ({ x, y, radius: 5 });
  assert.ok(inShape({ kind: 'circle', x: 0, y: 0, r: 30 }, e(31, 0)));
  assert.ok(!inShape({ kind: 'circle', x: 0, y: 0, r: 30 }, e(40, 0)));
  assert.ok(inShape({ kind: 'line', x: 0, y: 0, angle: 0, len: 100, w: 20 }, e(80, 9)));
  assert.ok(!inShape({ kind: 'line', x: 0, y: 0, angle: 0, len: 100, w: 20 }, e(80, 20)));
  assert.ok(inShape({ kind: 'cone', x: 0, y: 0, angle: 0, range: 40, arc: 1.6 }, e(30, 10)));
  assert.ok(!inShape({ kind: 'cone', x: 0, y: 0, angle: 0, range: 40, arc: 1.6 }, e(-30, 0)));
});

// ---------------------------------------------------------------- art and story

test('every boss frame paints, fits its frame, and stands on its anchor', () => {
  for (const [id, art] of Object.entries(BOSS_ART)) {
    for (const v of art.variants) {
      for (const [anim, [n]] of Object.entries(art.anims)) {
        for (let f = 0; f < n; f++) {
          const sp = paintBossFrame(id, anim, f, v);
          assert.equal(sp.w, art.w);
          assert.equal(sp.h, art.h);
          const px = sp.render();
          let count = 0;
          let low = 0;
          for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (px[(y * sp.w + x) * 4 + 3] > 0) {
            count++;
            if (y > low) low = y;
          }
          assert.ok(count > 60, `${id} ${anim}:${f} has pixels`);
          if (anim !== 'rise' && anim !== 'sink') assert.ok(Math.abs(low - art.oy) <= 4, `${id} ${anim}:${f} stands on its anchor (${low} vs ${art.oy})`);
        }
      }
    }
  }
  for (const id of ['fire', 'wind', 'poison', 'water', 'dark', 'volley', 'swift', 'split', 'bounce', 'chain']) assert.ok(glyphBitmap('x', id).some((v) => v), `glyph ${id}`);
});

const HIDDEN = [
  /\bKeepers?\b (of|in) the Song/i,
  /sang themselves|held out of time|struck through/i,
  /maren (is|was) (alive|singing|held)|joined the (song|verse)|cut her own name/i,
  /varek coll|sabeth'?s brother|her brother,? varek|brindlecombe/i,
  /rowan'?s spear|took (his|varek'?s) eye/i,
  /drowned verse-house|verse-house under|waygate/i,
  /the song is failing|verse by verse/i,
  /blue crystal|weeping cut|the cut\b/i,
  /garrick (pays|paid)|purse/i,
];

test('the boss intros are valid scenes, keyed, and say nothing LORE hides', () => {
  for (const [id, script] of Object.entries(BOSS_SCRIPTS)) {
    assert.ok(script.title);
    let n = 0;
    for (const st of script.steps) {
      assert.equal(validateStep(st, PANELS), null, `${id}: ${JSON.stringify(st)}`);
      if (st.say != null || st.narrate != null) {
        assert.equal(st.key, `${id}.${String(n).padStart(2, '0')}`);
        n++;
      }
    }
    assert.ok(n >= 2 && n <= 5, `${id} has 2–4 lines (${n})`);
  }
  const lines = bossSpokenLines();
  for (const l of lines) {
    assert.ok(['narrator', 'lyra', 'varek', 'corran'].includes(l.speaker), l.speaker);
    for (const re of HIDDEN) assert.doesNotMatch(l.text, re, l.key);
  }
  const flat = [];
  const walk = (o) => (typeof o === 'string' ? flat.push(o) : o && typeof o === 'object' && Object.values(o).forEach(walk));
  walk(LYRA_BOSS_LINES);
  for (const t of flat) for (const re of HIDDEN) assert.doesNotMatch(t, re, t);
  // Lyra never threatens to leave over a fight (DESIGN §19).
  for (const t of flat) assert.doesNotMatch(t, /\b(leave you|walk away|go home without)\b/i, t);
  // Every boss has an intro, and the director can find it.
  const scripts = {};
  registerBossScripts(scripts);
  for (const id of BOSS_IDS) assert.ok(scripts[BOSS_INTRO[id]], `${id} intro registered`);
  assert.ok(SCRIPTS.boss_varek, 'the manager registered the intros with the story');
});
