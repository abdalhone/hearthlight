// Plugin slot for workstream blood (r14b/blood): game.lock (lock-on), occupation, finishers, the hunt, looting.
// Round 14b, DESIGN §33 (F10): game.js registers every slot once, in one loop, so no
// workstream edits game.js to add a plugin. Owned by that workstream alone.
//
// Each entry is either
//   - a plugin object (src/ai/plugins/registry.js shape: id, install, update, onEvent,
//     promptContext, serialize/deserialize, and optionally `order`: a number, lower
//     restores first; default 0), registered when the Game is built, installed with the
//     world (before village life, murder and party exist: reach those lazily, or on the
//     'game_start' event); or
//   - an installer function (game) => void, run at the end of game.buildWorld, after village
//     life, murder and party exist and before a save is applied.

import { blowAtChests, ownersNotice } from '../../world/containers.js';
import { installLock } from '../lock_on.js';
import { LockLayer } from '../../render/lock_layer.js';

// Blows on locked chests (a Strike or a heavy weave forces the hasp; lighter blows get a
// word), and owners who find their chest short (theft unseen, D10).
function installChests(game) {
  game.chestBlow = (x, y, r, blow) => blowAtChests(game, x, y, r, blow);
}

const chestsPlugin = {
  id: 'blood_chests',
  name: 'Theft unseen, found later',
  description: 'An owner who finds goods missing from their chest is uneasy (round 14b, D10).',
  _t: 0,
  update(dt, ctx) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 1.5;
    const g = ctx?.game;
    if (g) ownersNotice(g);
  },
};

// Lock-on (round 14b, item 14): game.lock, its reticle, and its controls read each frame.
function installLockOn(game) {
  installLock(game);
  try {
    game.entities?.add?.(new LockLayer(game));
  } catch (err) {
    console.warn('[blood] the lock reticle failed', err);
  }
}

const lockPlugin = {
  id: 'blood_lock',
  name: 'Lock-on',
  description: 'Middle mouse, G or R3 lock on; the wheel cycles; weaves and the sword aim at the lock (round 14b).',
  update(dt, ctx) {
    ctx?.game?.lock?.update?.(dt);
  },
};

export default [installChests, chestsPlugin, installLockOn, lockPlugin];
