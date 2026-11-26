// Plugin slot for workstream party (r14b/party): the companion role, the People view, a companion of any adult.
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
export default [];
