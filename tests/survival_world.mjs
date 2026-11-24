// A headless Hearthvale for the survival tests (DESIGN §27): the real world, the real
// player, Lyra (mind, autonomy, behavior), all eighteen villagers, combat, the plugins and
// game.survival, with the browser-only parts stubbed.

import { EventBus } from '../src/core/events.js';
import { RNG } from '../src/core/rng.js';
import { GameClock } from '../src/core/time.js';
import { TILE, DAY_SECONDS } from '../src/core/constants.js';
import { generateWorld } from '../src/world/worldgen.js';
import { Pathfinder } from '../src/world/pathfind.js';
import { EntityManager } from '../src/entities/manager.js';
import { Actor } from '../src/entities/entity.js';
import { Player } from '../src/entities/player.js';
import { Companion } from '../src/entities/companion.js';
import { NPC } from '../src/entities/npc.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { Combat } from '../src/entities/combat.js';
import { Interactions } from '../src/core/interact.js';
import { ActionRegistry } from '../src/ai/brain/actions.js';
import { PluginRegistry } from '../src/ai/plugins/registry.js';
import { BUILTIN_PLUGINS } from '../src/ai/plugins/index.js';
import { Brain } from '../src/ai/brain/brain.js';
import { Survival } from '../src/survival/survival.js';
import { resetPathBudget } from '../src/entities/npc_walker.js';

export const SEED = 20261123;

export function fakeInput() {
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
    uiPressed: () => false,
    consume() {},
    endFrame: () => pressed.clear(),
  };
}

export function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    _m: m,
  };
}

export function makeGame({ hour = 12, seed = SEED, settings = {} } = {}) {
  const game = {};
  game.bus = new EventBus();
  game.events = [];
  game.bus.on('*', (type, p) => game.events.push({ type, p }));
  game.rng = new RNG(11);
  game.seed = seed;
  game.time = 0;
  game.state = 'playing';
  game.paused = false;
  game.hitStop = 0;
  game.timeScale = 1;
  game.flags = {};
  game.settings = { playerName: 'Ash', companionName: 'Lyra', reduceMotion: false, deathMode: 'final', ...settings };
  game.runtime = { hostPresent: false, sample: null, tts: null, onChange() {}, disable() {} };
  game.clock = new GameClock(game);
  game.clock.t = (hour / 24) * DAY_SECONDS;
  game.clock.weather.timer = 1e9;
  game.toasts = [];
  game.said = [];
  game.ui = {
    toast: (text, kind, opts) => game.toasts.push({ text, kind, opts }),
    fadeOut: () => Promise.resolve(),
    fadeIn: () => Promise.resolve(),
    isModalOpen: () => false,
    chat: { messages: [], addMessage(m) { this.messages.push(m); }, open() {}, setThinking() {}, isOpen: () => false },
    showDiary() {},
    setInteractPrompt() {},
  };
  game.bubbles = { say(e, t) { game.said.push({ who: e?.id, text: t }); }, icon() {}, thought() {}, number() {}, clear() {}, update() {} };
  game.particles = { emit() {}, update() {} };
  game.lighting = { flash() {}, update() {} };
  game.audio = { play() {}, heartbeat() { game.beats = (game.beats || 0) + 1; }, update() {} };
  game.camera = { x: 0, y: 0, vw: 400, vh: 240, shake() {}, snap() {}, follow() {} };
  game.input = fakeInput();
  const world = generateWorld(game, seed);
  game.map = world.map;
  game.objects = world.objects;
  game.locations = world.locations;
  game.spawns = world.spawns;
  game.pathfinder = new Pathfinder(game);
  game.isBlockedTile = (tx, ty, a) => game.map.isSolidTile(tx, ty, a) || game.objects.isBlockingTile(tx, ty, a);
  game.entities = new EntityManager(game);
  game.combat = new Combat(game);
  game.combat.random = () => 0.5;
  game.interactions = new Interactions(game);
  game.actions = new ActionRegistry(game);
  game.plugins = new PluginRegistry(game);
  for (const p of BUILTIN_PLUGINS) game.plugins.register(p);
  game.survival = new Survival(game);
  game.survival.fast = true;
  game.player = game.entities.add(new Player(game, { ...world.spawns.player }));
  game.companion = game.entities.add(new Companion(game, { ...world.spawns.companion }));
  for (const n of world.spawns.npcs || []) {
    const profile = NPC_PROFILES.find((p) => p.id === n.id);
    if (profile) game.entities.add(new NPC(game, profile, { x: n.x, y: n.y }));
  }
  game.brain = new Brain(game);
  game.brain.localDelay = false;
  game.plugins.installAll();
  game.brain.init();
  game.bus.emit('game_start', { loaded: false });
  resetPathBudget();
  return game;
}

// Run the world like game.update does: everything but rendering.
export function step(game, seconds, dt = 1 / 20) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (game.state !== 'playing') break;
    game.time += dt;
    game.survival.realtime(dt);
    const w = dt * (game.timeScale ?? 1);
    game.clock.update(w);
    game.entities.update(w);
    game.objects.update(w);
    game.combat.update(w);
    game.survival.update(w);
    game.plugins.update(w);
    game.brain.update(w);
    const p = game.player;
    game.camera.x = p.x - game.camera.vw / 2;
    game.camera.y = p.y - game.camera.vh / 2;
    game.input.endFrame();
  }
}

// Step until cond() holds (or the time runs out). Returns the seconds it took, or -1.
export function stepUntil(game, cond, max = 120, dt = 1 / 20) {
  let t = 0;
  while (t < max) {
    if (cond()) return t;
    step(game, dt, dt);
    t += dt;
    if (game.state !== 'playing' && !cond()) return -1;
  }
  return cond() ? t : -1;
}

export function px(tx) {
  return tx * TILE + TILE / 2;
}

export function placeAt(game, a, x, y) {
  a.x = x;
  a.y = y;
  if (a.walker?.stop) a.walker.stop();
  a.behavior?.steering?.reset?.();
}

// Everyone in the village sent home and to bed (so a test decides who is near).
export function villagers(game) {
  return game.entities.all().filter((e) => e instanceof NPC);
}

export function wolf(game, x, y, id = 'test_wolf') {
  const w = new Actor(game, { id, name: 'Wolf', faction: 'monster', maxHp: 30, atk: 8, x, y });
  w.species = 'wolf';
  return game.entities.add(w);
}

export function events(game, type) {
  return game.events.filter((e) => e.type === type).map((e) => e.p);
}
