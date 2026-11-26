// Plugin slot for workstream soul (r14b/soul): the Unkindling (game.unkindle), its discovery and its tally.
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
//
// Soul's two (DESIGN §37):
//   unkindlePlugin  game.unkindle (src/magic/unkindle.js): the gift, the hold, what was done;
//                   stepped with the world, saved as plugins.unkindle
//   installSoul     after murder and village life: the village's side (src/murder/unkindled.js:
//                   murder.onFound for cause 'unkindled', the night's fear), and in a browser
//                   the look (src/render/unkindle_fx.js) and the controls and sound
//                   (src/ui/unkindle_view.js)

import { Unkindle } from '../../magic/unkindle.js';
import { Hollow } from '../../murder/unkindled.js';
import { UnkindleFx } from '../../render/unkindle_fx.js';
import { UnkindleView } from '../../ui/unkindle_view.js';

function ensure(game) {
  if (!game) return null;
  if (!(game.unkindle instanceof Unkindle)) game.unkindle = new Unkindle(game);
  return game.unkindle;
}

// Everything the Unkindling needs, on any game (the real one, or a test's): idempotent.
export function installUnkindle(game, { fx = true, view = true } = {}) {
  const unk = ensure(game);
  if (!unk) return null;
  if (!unk.village) unk.village = new Hollow(game, unk);
  unk.village.install();
  if (fx && !unk.fx && game.renderer && game.pixelFx) {
    unk.fx = new UnkindleFx(game);
    unk.fx.install();
  }
  if (view && !unk.view && typeof document !== 'undefined' && game.ui?.root) unk.view = new UnkindleView(game, unk);
  return unk;
}

export const unkindlePlugin = {
  id: 'unkindle',
  name: 'The Unkindling',
  description: 'A dark gift of the pact: the flame put out from the inside (DESIGN §37).',
  install(ctx) {
    ensure(ctx?.game);
  },
  update(dt, ctx) {
    const unk = ctx?.game?.unkindle;
    if (!unk) return;
    unk.update(dt);
    unk.village?.update?.(dt);
  },
  serialize(ctx) {
    return ctx?.game?.unkindle?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    ensure(ctx?.game)?.deserialize?.(d);
  },
};

export function installSoul(game) {
  installUnkindle(game);
}

export default [unkindlePlugin, installSoul];
