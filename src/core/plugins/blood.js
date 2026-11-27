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
import { Occupation, ScorchLayer } from '../../world/occupation.js';
import { LockLayer } from '../../render/lock_layer.js';
import { installFinisherView } from '../../ui/finisher_view.js';

// Blows on locked chests (a Strike or a heavy weave forces the hasp; lighter blows get a
// word), and owners who find their chest short (theft unseen, D10).
function installChests(game) {
  game.chestBlow = (x, y, r, blow) => {
    const out = blowAtChests(game, x, y, r, blow);
    if (blow?.fire) game.occupation?.fireAt?.(x, y, r, blow);
    return out;
  };
}

// The village under the stranger's hand (round 14b, V-19): burned stores, taken houses,
// children who hide and are taken away. Saved with the plugins.
const occupationPlugin = {
  id: 'occupation',
  name: 'The village under your hand',
  description: 'Burned stores, claimed houses, children hiding and taken away (round 14b).',
  install(ctx) {
    const g = ctx?.game;
    if (!g || g.occupation) return;
    g.occupation = new Occupation(g);
    try {
      g.entities?.add?.(new ScorchLayer(g));
    } catch (err) {
      console.warn('[blood] the scorch layer failed', err);
    }
    if (this._pending !== undefined) {
      g.occupation.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx?.game?.occupation?.update?.(dt);
  },
  serialize(ctx) {
    return ctx?.game?.occupation?.serialize?.() ?? null;
  },
  deserialize(data, ctx) {
    if (ctx?.game?.occupation) ctx.game.occupation.deserialize(data);
    else this._pending = data;
  },
};

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

// Round 15 (DESIGN §40.3): the finisher's killing scene on the page (bars, close-in, skip).
function installFinisherScene(game) {
  try {
    installFinisherView(game);
  } catch (err) {
    console.warn('[blood] the finisher scene view failed', err);
  }
}

export default [installChests, chestsPlugin, installLockOn, lockPlugin, occupationPlugin, installFinisherScene];
