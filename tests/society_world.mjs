// A headless Hearthvale for the society tests (round 14b, DESIGN §36): the murder world
// (the real player, Lyra, the eighteen, village life, game.murder) plus the calendar and
// every society plugin and installer, as game.js registers them through its slot.

import { makeGame as makeMurderGame } from './murder_world.mjs';
import { calendarPlugin } from '../src/world/calendar.js';
import SOCIETY from '../src/core/plugins/society.js';

export * from './murder_world.mjs';

export function makeGame(opts = {}) {
  const g = makeMurderGame(opts);
  g.plugins.register(calendarPlugin);
  for (const p of SOCIETY) {
    if (typeof p === 'function') p(g);
    else if (p) g.plugins.register(p);
  }
  g.calendar?.update?.();
  return g;
}
