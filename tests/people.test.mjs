import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageOf, stageOfAge, lifeStage, isMinor, isAdult, canBeIntimate, lyraOf, MINOR_UNDER, INTIMATE_FROM } from '../src/core/people.js';
import { Calendar, firstBirthday, YEAR_DAYS } from '../src/world/calendar.js';

// Round 14b, decision D1 (DESIGN §34.2): one rule for who is a minor, by age, so a child
// grows up. The old rule (npc.js isChild) counted build 'teen' as a child at any age, and
// Tansy, build 'teen', would never have grown up.

// A game on a given day, with the real calendar.
function onDay(day) {
  const g = { clock: { day }, entities: { get: () => null, all: () => [] } };
  g.calendar = new Calendar(g);
  return g;
}

test('the cut-offs are one constant each: minors under 16, intimate acts from 18', () => {
  assert.equal(MINOR_UNDER, 16);
  assert.equal(INTIMATE_FROM, 18);
  assert.equal(stageOfAge(9), 'child');
  assert.equal(stageOfAge(12), 'child');
  assert.equal(stageOfAge(13), 'teen');
  assert.equal(stageOfAge(15), 'teen');
  assert.equal(stageOfAge(16), 'adult');
  assert.equal(stageOfAge(64), 'adult');
  assert.equal(stageOfAge(65), 'elder');
  assert.equal(stageOfAge(79), 'elder');
  assert.equal(stageOfAge(80), 'frail');
  assert.equal(stageOfAge(null), null);
});

test("today's ages give today's answers: Pip and Tansy are minors, Tilly and Wys adults", () => {
  const g = onDay(1);
  assert.equal(isMinor(g, 'pip'), true);
  assert.equal(isMinor(g, 'tansy'), true);
  assert.equal(isMinor(g, 'tilly'), false);
  assert.equal(isMinor(g, 'wys'), false);
  assert.equal(isAdult(g, 'tilly'), true);
  assert.equal(isAdult(g, 'pip'), false);
  assert.equal(lifeStage(g, 'pip'), 'child');
  assert.equal(lifeStage(g, 'tansy'), 'teen');
  assert.equal(lifeStage(g, 'petra'), 'frail');
  // Lyra is herself an adult (24 at the first morning); the stranger is never a minor.
  assert.equal(ageOf(g, 'lyra'), 24);
  assert.equal(isAdult(g, 'lyra'), true);
  const player = { id: 'player' };
  assert.equal(isMinor(g, player), false);
  assert.equal(isAdult(g, player), true);
  assert.equal(ageOf(g, player), null);
});

test('Tansy (build teen) is a minor at 15 and an adult at 16; never intimate at 16 or 17', () => {
  const first = firstBirthday('tansy');
  const before = onDay(first - 1);
  assert.equal(ageOf(before, 'tansy'), 15);
  assert.equal(isMinor(before, 'tansy'), true, 'a minor at 15');
  assert.equal(canBeIntimate(before, 'tansy'), false);
  const sixteen = onDay(first);
  assert.equal(ageOf(sixteen, 'tansy'), 16);
  assert.equal(isMinor(sixteen, 'tansy'), false, 'an adult to the game at 16, whatever her build');
  assert.equal(isAdult(sixteen, 'tansy'), true);
  assert.equal(lifeStage(sixteen, 'tansy'), 'adult');
  assert.equal(canBeIntimate(sixteen, 'tansy'), false, 'not intimate at 16');
  const seventeen = onDay(first + YEAR_DAYS);
  assert.equal(ageOf(seventeen, 'tansy'), 17);
  assert.equal(canBeIntimate(seventeen, 'tansy'), false, 'not intimate at 17');
  const eighteen = onDay(first + 2 * YEAR_DAYS);
  assert.equal(ageOf(eighteen, 'tansy'), 18);
  assert.equal(canBeIntimate(eighteen, 'tansy'), true, 'of age at 18');
  // Tilly is 17 at the first morning: an adult, not yet of age for an intimate act.
  assert.equal(canBeIntimate(onDay(1), 'tilly'), false);
  assert.equal(canBeIntimate(onDay(1), 'bram'), true);
});

test('an entity reads the same as its id; with no calendar the profile age decides; unknown age falls back to the build', () => {
  const g = { entities: { get: () => null } };
  assert.equal(isMinor(g, 'tansy'), true, 'profile age 15');
  const grown = { id: 'stranger_kid', profile: { id: 'stranger_kid', age: 30, appearance: { build: 'teen' } } };
  assert.equal(isMinor(g, grown), false, 'a teen build with a grown age is an adult');
  const unknown = { id: 'foundling', profile: { id: 'foundling', appearance: { build: 'child' } } };
  assert.equal(isMinor(g, unknown), true, 'age unknown: a child build counts as a child');
  assert.equal(canBeIntimate(g, unknown), false);
  // npc.isChild is the same rule now: a villager's profile age moved past 16 is no child.
  const tansy = { id: 'tansy', profile: { id: 'tansy', age: 16, appearance: { build: 'teen' } } };
  assert.equal(isMinor({}, tansy), false);
});

test('lyraOf is Lyra herself: game.lyra, else her entity, else game.companion', () => {
  const lyra = { id: 'lyra' };
  const bram = { id: 'bram' };
  assert.equal(lyraOf({ companion: lyra }), lyra);
  assert.equal(lyraOf({ entities: { get: (id) => (id === 'lyra' ? lyra : null) }, companion: bram }), lyra);
  assert.equal(lyraOf({ lyra, companion: bram }), lyra);
  assert.equal(lyraOf(null), null);
});

test("an actor's own `age` (seconds alive, for its animations) is never read as years", () => {
  const lyra = { id: 'lyra', age: 0.4 };
  const g = { entities: { get: (id) => (id === 'lyra' ? lyra : null) }, companion: lyra };
  assert.equal(ageOf(g, lyra), 24);
  assert.equal(isMinor(g, lyra), false);
  const bram = { id: 'bram', age: 3, profile: { id: 'bram', age: 38 } };
  assert.equal(ageOf({}, bram), 38);
});
