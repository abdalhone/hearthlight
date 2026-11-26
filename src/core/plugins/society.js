// Plugin slot for workstream society (r14b/society): reputation, the villain path (game.villain), aging, the shop.
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
import { reputationPlugin } from '../../society/reputation.js';
import { villainPlugin, installVillainHooks } from '../../story/villain.js';
import { agingPlugin, installAging } from '../../world/aging.js';
import { tradePlugin } from '../../world/trade.js';

export default [reputationPlugin, villainPlugin, agingPlugin, tradePlugin, installVillainHooks, installAging];
