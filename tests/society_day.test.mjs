import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, events } from './society_world.mjs';
import { homeBed } from '../src/world/home.js';
import { Game } from '../src/core/game.js';

// Round 14b leftover (V11 seams check): "Sleep never sends new_day. The village, quest and
// murder listeners miss a day turned by sleep." A night slept through midnight is a day
// like any other: every new_day listener runs exactly once.

function spy(obj, key, counts, name) {
  const f = obj[key];
  obj[key] = function (...a) {
    counts[name] = (counts[name] || 0) + 1;
    return f.apply(this, a);
  };
}

test('sleeping through midnight runs every new_day listener exactly once', async () => {
  const g = makeGame({ hour: 22 });
  const P = g.player;
  const bed = homeBed(g);
  P.x = bed.x + 16;
  P.y = bed.y - 4;
  const counts = {};
  spy(g.murder, 'onNewDay', counts, 'murder');
  spy(g.village, 'morning', counts, 'village');
  const auto = g.companion.mind?.autonomy;
  const plans = [];
  if (auto) {
    const f = auto.planDay;
    auto.planDay = function (why, ...a) {
      plans.push(why);
      return f.call(this, why, ...a);
    };
  }
  Object.assign(g, { audio: { play() {} }, save: { save: async () => {} } });
  g.brain.reflect = async () => null;
  const day = g.clock.day;
  const ok = await Game.prototype.sleep.call(g, bed);
  assert.equal(ok, true);
  assert.equal(g.clock.day, day + 1, 'a new morning');
  const nd = events(g, 'new_day');
  assert.equal(nd.length, 1, 'one new_day for the one midnight crossed');
  assert.equal(nd[0].day, day + 1);
  assert.equal(counts.murder, 1, "the murder's morning (Hess walks the woods) ran once");
  assert.equal(counts.village, 1, "the village's morning (grievances, rumours) ran once");
  if (auto) assert.equal(plans.filter((w) => w === 'new_day').length, 1, "Lyra planned the new day once");
  assert.equal(g.calendar.lastDay, day + 1, 'the calendar turned to the new day');
  // The quests heard it too (stage 0 advances on day 2).
  const quest = g.plugins.get('quest');
  assert.ok(quest, 'the quest plugin is there');
  // Nothing fires the same day twice: stepping on through the morning adds no new_day.
  g.clock.update(1);
  assert.equal(events(g, 'new_day').length, 1, 'the frame clock does not fire it again');
});

test('a sleep that starts after midnight crosses no midnight and sends no new_day of its own', async () => {
  const g = makeGame({ hour: 2 });
  const bed = homeBed(g);
  g.player.x = bed.x + 16;
  g.player.y = bed.y - 4;
  Object.assign(g, { audio: { play() {} }, save: { save: async () => {} } });
  g.brain.reflect = async () => null;
  const day = g.clock.day;
  await Game.prototype.sleep.call(g, bed);
  assert.equal(g.clock.day, day, 'same day, morning');
  assert.equal(events(g, 'new_day').length, 0);
});

test('skipDays crosses each midnight once, in order', () => {
  const g = makeGame({ hour: 12 });
  const day = g.clock.day;
  g.clock.skipDays(3);
  assert.deepEqual(events(g, 'new_day').map((p) => p.day), [day + 1, day + 2, day + 3]);
  assert.equal(Math.round(g.clock.hour), 12);
});
