// A headless Hearthvale for the murder tests (DESIGN §29): the survival world (the real
// player, Lyra with her mind, all eighteen villagers, combat, plugins, game.survival) plus
// the village's social life, its working day (game.villageLife) and game.murder.

import { makeGame as makeSurvivalGame, fakeInput } from './survival_world.mjs';
import { VillageLife } from '../src/ai/village_life/village_life.js';
import { Murder } from '../src/murder/murder.js';
import { TILE, DAY_SECONDS } from '../src/core/constants.js';
import { NPC } from '../src/entities/npc.js';

export { fakeInput };

export function makeGame({ hour = 12, settings = {} } = {}) {
  const g = makeSurvivalGame({ hour, settings });
  g.villageLife = new VillageLife(g);
  g.murder = new Murder(g);
  g.entities.add(g.murder.layer);
  g.flags.finisherWarned = true;
  return g;
}

export function step(game, seconds, dt = 1 / 20) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (game.state !== 'playing') break;
    game.time += dt;
    game.survival.realtime(dt);
    const w = dt * (game.timeScale ?? 1);
    game.hitStop = 0;
    game.clock.update(w);
    game.entities.update(w);
    game.objects.update(w);
    game.combat.update(w);
    game.survival.update(w);
    game.plugins.update(w);
    game.villageLife.update(w);
    game.murder.update(w);
    game.brain.update(w);
    const p = game.player;
    game.camera.x = p.x - game.camera.vw / 2;
    game.camera.y = p.y - game.camera.vh / 2;
    game.input.endFrame();
  }
}

// Jump the clock forward (no stepping): the whole village replans as if time passed.
export function skipHours(game, hours) {
  game.clock.t += (hours * DAY_SECONDS) / 24;
}

export function px(t) {
  return t * TILE + TILE / 2;
}

export function villagers(game) {
  return game.entities.all().filter((e) => e instanceof NPC);
}

export function put(a, x, y) {
  a.x = x;
  a.y = y;
  a.walker?.stop?.();
  if (a.r) a.r.key = null;
  a.behavior?.steering?.reset?.();
}

// Everyone not named is put to bed at home, far from (x, y): a quiet scene for a test.
export function clearScene(game, keep = []) {
  const far = { x: px(150), y: px(110) };
  for (const v of villagers(game)) {
    if (keep.includes(v.id)) continue;
    v.x = far.x + (Math.random() * 40 - 20);
    v.y = far.y + (Math.random() * 40 - 20);
    v.walker?.stop?.();
    if (v.r) v.r.key = null;
    v._testAway = true;
  }
  const L = game.companion;
  if (L && !keep.includes('lyra')) holdLyra(game, far.x, far.y + 60);
}

// Lyra away and still (her own feet would bring her back to the player).
export function holdLyra(game, x, y) {
  const L = game.companion;
  if (!L) return;
  L.x = x;
  L.y = y;
  if (L.controller) L._heldController = L.controller;
  L.controller = null;
  L.moveIntent.x = 0;
  L.moveIntent.y = 0;
}

export function freeLyra(game) {
  const L = game.companion;
  if (L?._heldController) L.controller = L._heldController;
}

// Down a villager the way a fight would (through combat), with the player's blade.
export function downBy(game, v, by = game.player) {
  v.hp = 1;
  game.combat.damage(by, v, 999, { exact: true, crit: false });
  return v.downed;
}

export function events(game, type) {
  return game.events.filter((e) => e.type === type).map((e) => e.p);
}
