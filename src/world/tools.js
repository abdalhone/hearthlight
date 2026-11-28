// Tools (round 15, item 9; DESIGN §40.9; the author: "I can like break iron without any
// specialized tools. Why is that?"). Iron yields only to the tool made for it:
//   - an iron ore vein (objects.js Rock, objType 'ore') is mined only with a pickaxe in the
//     pack; bare hands and the sword ring off it, and so does every weave (breakables.js);
//   - an iron-bound hasp (a locked chest, containers.js) breaks only to a pickaxe at the chest
//     (or opens to its key); no blow, blade or weave forces it.
// Plain rock, glow crystal and wood stay as they were (the hands and the sword work them).
//
// Where a pickaxe comes from: Bram sells them at the smithy (trade.js WARES), and the
// quarrymen keep a spare in the tool chest by the ore cart at Stonecut Quarry (worldgen,
// 'quarry_tools', a loot chest: taking it is no theft), so Bram's ore errands can be done on
// the day they are given.
//
// Only the player carries tools as items. Everyone else who digs (Bram and Tilly at the
// quarry, Lyra on Bram's errand, a companion sent to dig) works with their own pick, which the
// village does not count: `hasTool` is true for them.

// What each iron thing asks for, by object type.
export const TOOL_FOR = { ore: 'pickaxe', hasp: 'pickaxe' };

// The words the world says when you try iron without the tool.
export const NEED = {
  ore: 'You need a pickaxe for iron. Bram sells them at the smithy, and the quarrymen keep a spare in the tool chest by the ore cart.',
  ring: 'Iron ore. Your blade only rings off it: you need a pickaxe for iron.',
  weave: 'Iron ore does not break for a weave: you need a pickaxe for iron.',
  hasp: 'Iron-bound: no blow, blade or weave breaks the hasp. A pickaxe would, at the chest, or its key.',
};

function playerLike(game, actor) {
  return !!actor && (actor === game?.player || actor.id === 'player');
}

// Does this actor have the tool? The player: in the pack. Anyone else: their own.
export function hasTool(game, actor, tool) {
  if (!tool) return true;
  if (!playerLike(game, actor)) return true;
  const inv = actor?.inventory;
  try {
    if (typeof inv?.has === 'function') return !!inv.has(tool);
    if (typeof inv?.count === 'function') return inv.count(tool) > 0;
  } catch {
    /* no pack: no tool */
  }
  return false;
}

// The tool this object asks of this actor and does not have, or null.
export function missingTool(game, actor, kind) {
  const tool = TOOL_FOR[kind];
  return tool && !hasTool(game, actor, tool) ? tool : null;
}

// A word, at most every few seconds per key (a held button or a beam does not drum it).
export function sayNeed(game, key, text = NEED[key]) {
  if (!text) return;
  const t = game?.time ?? 0;
  const told = game ? (game._toolsTold ||= {}) : {};
  if (t - (told[key] ?? -Infinity) < 4) return;
  told[key] = t;
  try {
    game?.ui?.toast?.(text, 'info', { key: `tool_${key}` });
  } catch {
    /* ui optional */
  }
}
