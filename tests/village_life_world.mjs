// A real Hearthvale for village-life tests (no browser): the generated world, all eighteen
// villagers on their schedules with the real pathfinder, the village's social life, the
// player and Lyra as plain actors, and game.villageLife.
import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Inventory } from '../src/entities/items.js';
import { NPC } from '../src/entities/npc.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { resetPathBudget } from '../src/entities/npc_walker.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { Village } from '../src/ai/social/village.js';
import { VillageLife } from '../src/ai/village_life/village_life.js';

export function makeWorld({ hour = 6, seed = 20261123, lyra = true, player = true, settings = {}, claude = null } = {}) {
  resetPathBudget();
  const said = [];
  const toasts = [];
  const game = {
    time: 0,
    seed,
    bus: new EventBus(),
    rng: new RNG(seed),
    settings: { playerName: 'Wren', companionName: 'Lyra', villageAi: 'player', showThoughts: true, ...settings },
    flags: {},
    state: 'playing',
    bubbles: { say: (e, text) => said.push({ who: e.id, text, t: game.clock.t }), icon() {}, thought() {}, number() {} },
    particles: { emit() {} },
    ui: { toast: (text, kind) => toasts.push({ text, kind, t: game.clock.t }) },
    said,
    toasts,
  };
  game.clock = new GameClock(game);
  game.clock.weather.timer = 1e9;
  game.clock.skipTo?.(hour);
  if (!game.clock.skipTo) game.clock.t = (hour / 24) * 900;
  game.entities = new EntityManager(game);
  const world = generateWorld(game, seed);
  game.map = world.map;
  game.objects = world.objects;
  game.locations = world.locations;
  game.pathfinder = new Pathfinder(game);
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  game.combat = { hasCrime: () => false, isHostile: () => false };
  if (player) {
    const p = new Actor(game, { id: 'player', name: 'Wren', faction: 'player', maxHp: 60, speed: 78, spriteKey: 'player', x: 2480, y: 1840 });
    p.inventory = new Inventory();
    game.player = game.entities.add(p);
  }
  if (lyra) {
    const l = new Actor(game, { id: 'lyra', name: 'Lyra', faction: 'player', maxHp: 60, speed: 70, spriteKey: 'lyra', x: 2500, y: 1840 });
    l.inventory = new Inventory();
    const mem = [];
    const sayings = [];
    l.mind = {
      companionship: 'together',
      memories: mem,
      sayings,
      learned: [],
      deeds: [],
      feelings: [],
      say(text, o = {}) {
        sayings.push({ text, o, t: game.clock.t });
        said.push({ who: 'lyra', text, t: game.clock.t });
      },
      isSpeaking: () => false,
      remember(text, o) {
        mem.push({ text, ...o });
        return { text };
      },
      learn(subject, text, o) {
        this.learned.push({ subject, text, o });
      },
      feel(name, amount, cause) {
        this.feelings.push({ name, amount, cause });
      },
      recordDeed(deed, o) {
        this.deeds.push({ deed, ...o });
      },
      addThought() {},
      addConversation() {},
      relationships: { get: () => null },
    };
    game.companion = game.entities.add(l);
  }
  for (const n of world.spawns.npcs || []) {
    const profile = NPC_PROFILES.find((p) => p.id === n.id);
    if (profile) game.entities.add(new NPC(game, profile, { x: n.x, y: n.y }));
  }
  game.village = new Village(game);
  game.villageLife = new VillageLife(game, { claude: claude || {} });
  return game;
}

// Run the world: entities, the village and village life, at a coarse step.
export function run(game, seconds, dt = 0.1, onStep = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.time += dt;
    game.clock.update(dt);
    game.entities.update(dt);
    game.village.update(dt);
    game.villageLife.update(dt);
    if (onStep && onStep(game) === true) return true;
  }
  return false;
}

export function runUntilHour(game, hour, dt = 0.1, onStep = null) {
  const target = Math.floor(game.clock.t / 900) * 900 + (hour / 24) * 900;
  const secs = Math.max(0, target - game.clock.t);
  return run(game, secs, dt, onStep);
}
