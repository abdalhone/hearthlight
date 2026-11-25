import { EventBus } from './events.js';
import { RNG } from './rng.js';
import { Loop } from './loop.js';
import { GameClock } from './time.js';
import { loadSettings, saveSettings, loadApiKey } from './settings.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { SaveManager } from './save.js';
import { Interactions } from './interact.js';

import { Atlas } from '../art/atlas.js';
import { registerTileArt } from '../art/tiles_art.js';
import { registerPropArt } from '../art/props_art.js';
import { registerCharacterArt } from '../art/characters_art.js';
import { registerItemArt } from '../art/items_art.js';
import { registerFxArt } from '../art/fx_art.js';
import { registerBossArt } from '../art/bosses_art.js';

import { Renderer } from '../render/renderer.js';
import { Lighting } from '../render/lighting.js';
import { Particles } from '../render/particles.js';
import { Bubbles } from '../render/bubbles.js';
import { Weather } from '../render/weather.js';
import { installPixelFx } from '../render/pixel_fx_play.js';

import { generateWorld } from '../world/worldgen.js';
import { Pathfinder } from '../world/pathfind.js';

import { EntityManager } from '../entities/manager.js';
import { Player } from '../entities/player.js';
import { Companion } from '../entities/companion.js';
import { NPC } from '../entities/npc.js';
import { NPC_PROFILES } from '../entities/npc_data.js';
import { spawnCreature } from '../entities/monsters.js';
import { Spawner } from '../entities/spawner.js';
import { Combat } from '../entities/combat.js';
import { Magic } from '../magic/magic.js';
import { installProgression, saveProgression, loadProgression } from '../progression/index.js';

import { ActionRegistry } from '../ai/brain/actions.js';
import { PluginRegistry } from '../ai/plugins/registry.js';
import { BUILTIN_PLUGINS } from '../ai/plugins/index.js';
import { Brain } from '../ai/brain/brain.js';
import { VillageLife } from '../ai/village_life/village_life.js';

import { ClaudeRuntime } from '../platform/claude_runtime.js';
import { UI } from '../ui/ui.js';
import { StoryDirector } from '../story/director.js';
import { missionsPlugin, ensureMissions } from '../missions/plugin.js';
import { BossManager } from '../bosses/manager.js';
import { Survival } from '../survival/survival.js';
import { installDeathView } from '../ui/death_view.js';
import { Murder } from '../murder/murder.js';
import { MurderView } from '../ui/murder_view.js';

export const SAVE_VERSION = 1;

// The game: owns every system and runs them in a fixed order each step.
// Everything receives `game` and reaches other systems through it (see DESIGN.md).
export class Game {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.apiKey = loadApiKey();
    this.bus = new EventBus();
    this.seed = 20261123;
    this.rng = new RNG(this.seed);
    this.time = 0; // real seconds since boot; drives animations
    this.state = 'boot'; // boot | title | playing | sleeping | cutscene (a story scene plays; the world is frozen)
    this.paused = false; // set by the UI while a pause/settings menu is open
    this.hitStop = 0; // seconds of frozen action after a heavy hit (combat sets it; world freezes, UI keeps running)
    this.timeScale = 1; // the world's pace (survival slows it for a beat when the player falls)
    this.flags = {}; // story flags: { journal_found: true, ... }

    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.uiRoot = document.createElement('div');
    this.uiRoot.id = 'ui-root';
    root.append(this.canvas, this.uiRoot);

    this.runtime = new ClaudeRuntime();
    this.clock = new GameClock(this);
    this.atlas = new Atlas();
    this.camera = new Camera(this);
    this.lighting = new Lighting(this);
    this.particles = new Particles(this);
    this.bubbles = new Bubbles(this);
    this.weather = new Weather(this);
    // pixelfx effects in the world buffer (DESIGN §30): hits, statuses, deaths, pickups, critters.
    this.pixelFx = installPixelFx(this);
    this.renderer = new Renderer(this, this.canvas);
    this.input = new Input(this);
    this.audio = new Audio(this);
    this.entities = new EntityManager(this);
    this.combat = new Combat(this);
    // The Weave (DESIGN §22): spells, statuses, mana and slots. Its look comes from
    // game.magicFx when the fx layer is present (src/magic/fx.js), else a plain fallback.
    this.magic = new Magic(this);
    // Stats, levels and points, gear and prices (DESIGN §25–26): game.stats,
    // game.progression, game.gear, game.prices.
    installProgression(this);
    this.interactions = new Interactions(this);
    this.actions = new ActionRegistry(this);
    this.plugins = new PluginRegistry(this);
    for (const p of BUILTIN_PLUGINS) this.plugins.register(p);
    this.plugins.register(missionsPlugin); // missions (DESIGN §22.3); saved with the plugins
    ensureMissions(this); // game.missions
    this.brain = new Brain(this);
    this.save = new SaveManager(this);
    this.ui = new UI(this, this.uiRoot);
    this.story = new StoryDirector(this); // cutscenes, the prologue, story scenes, the Book of Halcyre
    this.bosses = new BossManager(this); // the five bosses, their arenas, fights and glyph-shards (§22.3)
    this.survival = new Survival(this); // falling, rescue, the sickroom, the kept flame, death (DESIGN §27)
    installDeathView(this); // its screens: the countdown ring, Call for help, the memorial

    // World pieces, created by buildWorld().
    this.map = null;
    this.objects = null;
    this.locations = null;
    this.pathfinder = null;
    this.spawner = null;
    this.spawns = null;
    this.player = null;
    this.companion = null;

    this.loop = new Loop(
      (dt) => this.update(dt),
      (alpha, frameDt) => this.render(alpha, frameDt),
    );
  }

  async boot() {
    try {
      await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
    } catch {
      /* fonts are optional */
    }
    const steps = [
      ['tiles', () => registerTileArt(this.atlas, this.rng.fork(1))],
      ['props', () => registerPropArt(this.atlas, this.rng.fork(2))],
      ['characters', () => registerCharacterArt(this.atlas, this.rng.fork(3))],
      ['items', () => registerItemArt(this.atlas, this.rng.fork(4))],
      ['fx', () => registerFxArt(this.atlas, this.rng.fork(5))],
      ['bosses', () => registerBossArt(this.atlas)],
    ];
    for (const [name, fn] of steps) {
      try {
        fn();
      } catch (err) {
        console.error(`[boot] ${name} art failed`, err);
      }
    }
    try {
      await this.save.init();
    } catch (err) {
      console.error('[boot] save init failed', err);
    }
    this.brain.init();
    this.ui.init();
    this.state = 'title';
    this.ui.showTitle();
    this.loop.start();
    if (typeof window !== 'undefined') window.__game = this; // for debugging and automated tests
    this.bus.emit('booted', {});
  }

  // Build the world, the player, Lyra, villagers and starting creatures.
  // A world is built once per page load; "quit to title" reloads the page.
  buildWorld() {
    const world = generateWorld(this, this.seed);
    this.map = world.map;
    this.objects = world.objects;
    this.locations = world.locations;
    this.spawns = world.spawns;
    this.pathfinder = new Pathfinder(this);

    this.player = this.entities.add(new Player(this, { ...world.spawns.player }));
    this.companion = this.entities.add(new Companion(this, { ...world.spawns.companion }));
    for (const n of world.spawns.npcs || []) {
      const profile = NPC_PROFILES.find((p) => p.id === n.id);
      if (profile) this.entities.add(new NPC(this, profile, { x: n.x, y: n.y }));
    }
    for (const c of world.spawns.creatures || []) {
      try {
        spawnCreature(this, c.species, c.x, c.y, c.opts || {});
      } catch (err) {
        console.error('[world] spawn failed', c, err);
      }
    }
    this.spawner = new Spawner(this, world.spawns.spawnZones || []);
    // Weaves draw through one layer entity: ground marks under everyone, spells over them.
    this.entities.add(this.magic.layer);
    this.bosses?.onWorldBuilt();
    this.plugins.installAll();
    // Errands, sightings, problems and the missing (DESIGN §28): after the village exists.
    try {
      this.villageLife = new VillageLife(this);
    } catch (err) {
      console.error('[world] village life failed to start', err);
      this.villageLife = null;
    }
    // Killing, witnesses, bodies and what the village can know (DESIGN §29).
    try {
      this.murder = new Murder(this);
      this.murder.view = new MurderView(this);
      this.entities.add(this.murder.layer);
    } catch (err) {
      console.error('[world] murder failed to start', err);
      this.murder = null;
    }
    this.camera.follow(this.player);
    this.camera.snap();
  }

  // opts.prologue: play the prologue first (the title's New game does; automated tests
  // calling newGame() directly start straight in play).
  newGame(opts = {}) {
    if (this.map) {
      location.reload();
      return;
    }
    this.buildWorld();
    this.state = 'playing';
    this.bus.emit('game_start', { loaded: false });
    if (opts.prologue) this.story?.playPrologue({ world: true });
  }

  async continueGame() {
    const data = await this.save.load();
    if (!data) {
      this.newGame();
      return false;
    }
    if (this.map) {
      location.reload();
      return false;
    }
    this.buildWorld();
    try {
      this.deserialize(data);
    } catch (err) {
      console.error('[game] could not apply save', err);
      this.ui.toast('That save could not be fully loaded. Some progress may be missing.', 'warn');
    }
    this.state = 'playing';
    this.camera.snap();
    this.bus.emit('game_start', { loaded: true });
    return true;
  }

  setSetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    this.bus.emit('settings_changed', { key, value });
  }

  isBlockedTile(tx, ty, actor = null) {
    return this.map.isSolidTile(tx, ty, actor) || this.objects.isBlockingTile(tx, ty, actor);
  }

  // Sleep until morning (beds call this). Heals everyone, lets Lyra reflect on the day.
  async sleep(bed = null) {
    if (this.state !== 'playing') return false;
    const h = this.clock.hour;
    if (h >= 6 && h < 18) {
      this.ui.toast("It's too early to sleep. Beds work from 6 PM.", 'info');
      return false;
    }
    this.state = 'sleeping';
    this.bus.emit('player_sleep', { bed });
    this.audio.play('sleep');
    await this.ui.fadeOut(1.2);
    this.clock.skipTo(7);
    for (const a of [this.player, this.companion]) {
      if (!a) continue;
      a.hp = a.maxHp;
      a.downed = false;
      if (a.state === 'downed') a.setState('idle');
    }
    if (this.companion && bed) {
      this.companion.x = this.player.x + 14;
      this.companion.y = this.player.y + 4;
    }
    let reflection = null;
    try {
      reflection = await this.brain.reflect('sleep');
    } catch (err) {
      console.error('[game] reflection failed', err);
    }
    this.bus.emit('player_wake', { day: this.clock.day, reflection });
    this.state = 'playing';
    await this.save.save('sleep');
    await this.ui.fadeIn(1.2);
    return true;
  }

  update(dt) {
    this.time += dt;
    this.input.update(dt);
    this.story?.update(dt);
    if (this.state === 'playing' && !this.paused && this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.camera.update(dt);
    } else if (this.state === 'playing' && !this.paused) {
      this.survival?.realtime(dt);
      const wdt = dt * (this.timeScale ?? 1); // the world's step (slowed for a beat when the player falls)
      this.clock.update(wdt);
      this.entities.update(wdt);
      this.objects.update(wdt);
      this.map.update(wdt);
      this.combat.update(wdt);
      this.survival?.update(wdt);
      this.magic.update(wdt);
      this.stats?.update(wdt);
      this.prices?.update(wdt);
      this.spawner.update(wdt);
      this.bosses?.update(wdt);
      this.plugins.update(wdt);
      this.villageLife?.update(wdt);
      this.murder?.update(wdt);
      this.brain.update(wdt);
      this.lighting.update(wdt);
      this.particles.update(wdt);
      this.pixelFx.update(wdt);
      this.pixelFx.director?.update(wdt);
      this.weather.update(wdt);
      this.bubbles.update(dt);
      this.camera.update(dt);
      this.save.update(dt);
    } else if (this.state === 'title' || this.state === 'sleeping') {
      this.particles.update(dt);
      this.bubbles.update(dt);
    } else if (this.state === 'cutscene') {
      // The world is frozen under a scene; only its light, air and speech marks live on.
      this.lighting.update(dt);
      this.particles.update(dt);
      this.weather.update(dt);
      this.bubbles.update(dt);
    }
    this.audio.update(dt);
    this.ui.update(dt);
    this.input.endFrame();
  }

  render(alpha, frameDt) {
    // A painted story panel covers the whole screen: no need to draw the world under it.
    if (!this.story?.coversScreen()) this.renderer.render(alpha, frameDt);
    this.story?.render();
  }

  serialize() {
    const npcs = {};
    for (const e of this.entities.all()) {
      if (e instanceof NPC) npcs[e.id] = e.serialize();
    }
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed: this.seed,
      clock: this.clock.serialize(),
      flags: { ...this.flags },
      player: this.player?.serialize(),
      companion: this.companion?.serialize(),
      npcs,
      objects: this.objects?.serialize(),
      spawner: this.spawner?.serialize(),
      plugins: this.plugins.serialize(),
      brain: this.brain.serialize?.() ?? null,
      magic: this.magic?.serialize?.() ?? null,
      survival: this.survival?.serialize?.() ?? null,
      progression: saveProgression(this),
      villageLife: this.villageLife?.serialize?.() ?? null,
      murder: this.murder?.serialize?.() ?? null,
    };
  }

  deserialize(d) {
    if (!d) return;
    this.clock.deserialize(d.clock);
    this.flags = { ...(d.flags || {}) };
    this.objects?.deserialize(d.objects);
    this.player?.deserialize(d.player);
    loadProgression(this, d.progression);
    this.magic?.deserialize?.(d.magic);
    this.companion?.deserialize(d.companion);
    for (const [id, nd] of Object.entries(d.npcs || {})) this.entities.get(id)?.deserialize?.(nd);
    this.spawner?.deserialize(d.spawner);
    this.plugins.deserialize(d.plugins);
    this.brain.deserialize?.(d.brain);
    this.survival?.deserialize?.(d.survival);
    try {
      this.villageLife?.deserialize?.(d.villageLife);
    } catch (err) {
      console.error('[game] village life could not be restored', err);
    }
    try {
      this.murder?.deserialize?.(d.murder);
    } catch (err) {
      console.error('[game] the dead could not be restored', err);
    }
  }
}
