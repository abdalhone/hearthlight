import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, events } from './society_world.mjs';
import { Calendar, seasonOf, midsummer, birthdayOf, baseAge, ageWords } from '../src/world/calendar.js';
import { lifeStage, isMinor } from '../src/core/people.js';
import { chanceOf } from '../src/world/aging.js';
import { DAY_SECONDS } from '../src/core/constants.js';

// People age (round 14b, S-18; DESIGN §36.3): seasons and a year label, a pace that keeps
// ages, the dead stop aging, Lyra's birthday at midsummer, children grow up, and old age
// through murder.die (no alarm, no case, no Moot, nothing counted as a killing).

function onDay(day, settings = {}) {
  const g = { clock: { day }, settings, entities: { get: () => null, all: () => [] }, bus: { emit() {} }, ui: { toast() {} } };
  g.calendar = new Calendar(g);
  return g;
}

test('day 1 is early autumn, year 1; four seasons a year, each early, mid and late', () => {
  const g = onDay(1);
  assert.equal(g.calendar.dateLabel(), 'Day 1, early autumn, year 1');
  assert.deepEqual(seasonOf(1, 12), { index: 0, name: 'autumn', part: 'early' });
  assert.equal(seasonOf(4, 12).name, 'winter');
  assert.equal(seasonOf(11, 12).name, 'summer');
  g.clock.day = 11;
  assert.equal(g.calendar.seasonName(), 'midsummer');
  g.clock.day = 13;
  assert.equal(g.calendar.dateLabel(), 'Day 13, early autumn, year 2');
  assert.equal(seasonOf(1, 48).name, 'autumn');
  assert.equal(seasonOf(13, 48).name, 'winter');
});

test("Lyra's birthday is at midsummer (LORE §7), whatever the pace", () => {
  assert.equal(birthdayOf('lyra', 12), midsummer(12));
  assert.equal(seasonOf(midsummer(12), 12).name, 'summer');
  assert.equal(seasonOf(midsummer(48), 48).part, 'mid');
  const g = onDay(midsummer(12));
  assert.equal(g.calendar.ageOf('lyra'), 25, 'she turns twenty-five at the first midsummer');
  assert.equal(g.calendar.isBirthday('lyra'), true);
});

test('a pace change keeps every age; birthdays after it go at the new pace', () => {
  const g = onDay(30);
  g.calendar.update();
  const before = { pip: g.calendar.ageOf('pip'), hobb: g.calendar.ageOf('hobb'), lyra: g.calendar.ageOf('lyra') };
  g.settings.yearDays = 48;
  g.calendar.update();
  assert.equal(g.calendar.yearDays(), 48);
  for (const [id, a] of Object.entries(before)) assert.equal(g.calendar.ageOf(id), a, `${id} the same age`);
  g.clock.day = 30 + 48;
  assert.equal(g.calendar.ageOf('pip'), before.pip + 1, 'one birthday in the next 48 days');
  // Saved and loaded: the anchors hold.
  const data = g.calendar.serialize();
  const g2 = onDay(30 + 48, { yearDays: 48 });
  g2.calendar.deserialize(data);
  g2.calendar.update();
  assert.equal(g2.calendar.ageOf('pip'), before.pip + 1);
  // An old save (round 14a: only `celebrated`) reads at twelve days a year.
  const g3 = onDay(25, { yearDays: 12 });
  g3.calendar.deserialize({ celebrated: { pip: 3 } });
  g3.calendar.update();
  assert.equal(g3.calendar.ageOf('pip'), baseAge('pip') + 2);
});

test('the dead stop aging and get no birthday', () => {
  const g = onDay(1);
  g.murder = { dead: { corran: { id: 'corran', day: 3 } } };
  g.clock.day = 3 + 12 * 3;
  assert.equal(g.calendar.ageOf('corran'), g.calendar.ageOf('corran', 3), 'Corran keeps the age he died at');
  const toasts = [];
  g.ui.toast = (t) => toasts.push(t);
  g.calendar.lastDay = g.clock.day - 1;
  g.clock.day = 3 + 12 * 3 + 12; // every birthday in a year goes by
  for (let d = g.clock.day - 12; d <= g.clock.day; d++) {
    const keep = g.clock.day;
    g.clock.day = d;
    g.calendar.update();
    g.clock.day = keep;
  }
  assert.ok(!toasts.some((t) => /Corran/.test(t)), 'no birthday for the dead');
});

test('children grow up: Pip child to teen to adult; Tansy an adult at sixteen ("Tansy is sixteen today"), never killable before', () => {
  const g = makeGame({ hour: 12 });
  assert.equal(lifeStage(g, 'pip'), 'child');
  assert.equal(isMinor(g, 'tansy'), true);
  assert.equal(g.murder.canKill(g.entities.get('tansy')), false);
  // Tansy's sixteenth birthday.
  const tb = birthdayOf('tansy');
  const day = tb === 1 ? 13 : tb;
  g.clock.t = (day - 1) * DAY_SECONDS + 9 * (DAY_SECONDS / 24);
  step(g, 0.2);
  assert.equal(g.calendar.ageOf('tansy'), 16);
  assert.equal(isMinor(g, 'tansy'), false, 'an adult to every system');
  assert.ok(g.toasts.some((t) => /Tansy is sixteen today/.test(t.text)));
  assert.ok(events(g, 'birthday').some((p) => p.id === 'tansy' && p.adult));
  // Pip: child at 9, teen at 13, adult at 16.
  const pb = birthdayOf('pip');
  const pipDay = (n) => (pb === 1 ? 1 + 12 * n : pb + 12 * (n - 1));
  g.clock.t = (pipDay(4) - 1) * DAY_SECONDS + 9 * (DAY_SECONDS / 24);
  step(g, 0.2);
  assert.equal(g.calendar.ageOf('pip'), 13);
  assert.equal(lifeStage(g, 'pip'), 'teen');
  g.clock.t = (pipDay(7) - 1) * DAY_SECONDS + 9 * (DAY_SECONDS / 24);
  step(g, 0.2);
  assert.equal(lifeStage(g, 'pip'), 'adult');
  // Back to the first morning (other tests read the canon ages).
  g.clock.t = 9 * (DAY_SECONDS / 24);
  g.calendar.lastDay = null;
  g.calendar.update();
});

test('the stranger: Petra reckons five-and-twenty, and the waking morning is their birthday', () => {
  const g = makeGame({ hour: 9 });
  g.bus.emit('game_start', { loaded: false });
  assert.equal(g.calendar.ageOf('player'), 25);
  assert.equal(isMinor(g, g.player), false);
  assert.equal(ageWords(25), 'twenty-five');
  g.clock.t += 12 * DAY_SECONDS;
  step(g, 0.2);
  assert.equal(g.calendar.ageOf('player'), 26);
  assert.ok(g.toasts.some((t) => /Your birthday, by Petra's reckoning: twenty-six/.test(t.text)));
  g.clock.t = 9 * (DAY_SECONDS / 24);
  g.calendar.lastDay = null;
  g.calendar.update();
});

test('briefLine and the prompt carry the date and the age', () => {
  const g = makeGame({ hour: 9 });
  const line = g.calendar.briefLine('hobb');
  assert.match(line, /Day 1, early autumn, year 1/);
  assert.match(line, /You are 79/);
  assert.ok(line.length <= 200);
  assert.match(g.calendar.promptContext(), /early autumn/);
});

test('old age: the daily chance rises with age, never before 77; nobody in the first year; never a child', () => {
  assert.equal(chanceOf(76), 0);
  assert.ok(chanceOf(77) > 0 && chanceOf(85) > chanceOf(80));
  const g = makeGame({ hour: 9 });
  g.aging.onNewDay(5);
  assert.deepEqual(g.aging.failing, {}, 'not in the first year');
  assert.equal(g.aging.begin('pip'), false, 'never a child');
  g.settings.oldAge = false;
  for (let d = 13; d < 400; d++) g.aging.onNewDay(d);
  assert.deepEqual(g.aging.failing, {}, 'switched off: nobody');
});

test('a death of age: failing at home, then die() in the night; found by kin; a funeral, no case, no Moot, no alarm, no kill counted; reads "died" after a reload', () => {
  const g = makeGame({ hour: 12 });
  for (const v of g.entities.all()) if (v.profile && v.id !== 'corran' && v.id !== 'wenna') v.think = () => {};
  g.villain.seal('after');
  const corran = g.entities.get('corran');
  // Wenna asleep beside him in the same room: no witness, no alarm.
  const wenna = g.entities.get('wenna');
  put(corran, px(30), px(30));
  put(wenna, px(31), px(30));
  assert.equal(g.aging.begin('corran'), true);
  assert.equal(g.aging.entryFor(corran, null, 12).at, corran.profile.home, 'abed at home');
  // The night after: he dies in the small hours.
  g.clock.t = g.clock.day * DAY_SECONDS + 2 * (DAY_SECONDS / 24);
  step(g, 2.5);
  const rec = g.murder.dead.corran;
  assert.ok(rec, 'he died');
  assert.equal(rec.natural, true);
  assert.equal(rec.cause, 'age');
  assert.equal(rec.by, null);
  assert.equal(events(g, 'villager_killed').length, 0, 'no killing');
  assert.equal(events(g, 'villager_died').length, 1);
  assert.equal(g.murder.isWanted(), false);
  assert.equal(g.player.crime ?? null, null);
  assert.ok(!rec.alarm, 'no alarm');
  assert.deepEqual(g.villain.state.kills, [], 'nothing for the tempter');
  assert.equal(g.reputation.counts().killedKnown + g.reputation.counts().killedSecret, 0, 'nothing for the reputation');
  // Morning: found by his own (or Mira), no case, a funeral, no Moot.
  g.clock.t = g.clock.day * DAY_SECONDS - DAY_SECONDS + 7.5 * (DAY_SECONDS / 24);
  step(g, 2.5);
  assert.ok(rec.foundAt != null, 'found in the morning');
  assert.ok(!g.murder.cases.corran, 'no case');
  assert.ok(g.murder.funerals.some((f) => f.about === 'corran'), 'a funeral');
  assert.ok(!g.murder.moots.some((x) => x.about === 'corran'), 'no Moot');
  assert.ok(g.villageLife.events.some((e) => /died of old age/.test(e.text)));
  assert.match(g.murder.epitaph('corran'), /Died of old age/);
  // Saved and loaded: he reads 'died' (cause age), still natural.
  const data = g.murder.serialize();
  const g2 = makeGame({ hour: 12 });
  g2.murder.deserialize(JSON.parse(JSON.stringify(data)));
  assert.equal(g2.entities.get('corran').absent.cause, 'age');
  assert.equal(g2.murder.dead.corran.natural, true);
});

test('Hobb, Wenna and Petra are spared while the Maren thread is open', () => {
  const g = makeGame({ hour: 12 });
  assert.equal(g.aging.spared('petra'), true);
  assert.equal(g.aging.spared('corran'), false);
});

import { ageLook, lookKey, applyAgeLooks } from '../src/art/age_look.js';
import { profileById } from '../src/entities/npc_data.js';

test('ageLook: grey hair, wrinkles from fifty, a stoop at seventy-five, bent at eighty-five; a child grows a grown build', () => {
  const bram = profileById('rowan').appearance; // Rowan, 38, auburn
  const b55 = ageLook(bram, 55, 38);
  assert.ok(Array.isArray(b55.hair), 'greying at fifty-five (his own colour mixed with grey)');
  assert.equal(b55.wrinkles, true, 'lines from fifty');
  const b70 = ageLook(bram, 70, 38);
  assert.equal(b70.hair, 'grey', 'grey at seventy');
  const b76 = ageLook(bram, 76, 38);
  assert.equal(b76.posture, 'stooped');
  assert.equal(ageLook(bram, 86, 38).posture, 'bent');
  assert.equal(ageLook(bram, 86, 38).hair, 'silver');
  assert.equal(lookKey(bram, 38, 38), '', 'the canon look at the canon age');
  assert.equal(ageLook(profileById('hobb').appearance, 90, 79).hair, 'white', 'white hair stays white');
  const pip = profileById('pip').appearance; // 9, build child
  assert.equal(ageLook(pip, 13, 9).build, 'teen');
  assert.equal(ageLook(pip, 16, 9).build, 'slim');
  assert.equal(ageLook(pip, 16, 9).eyeStyle, 'small');
  assert.equal(ageLook(pip, 10, 9).build, 'child');
  // Hair already white never darkens; a younger age changes nothing.
  assert.deepEqual(ageLook(bram, 30, 38), bram);
});

test('applyAgeLooks points a grown villager at their new look and gives a grown child a grown body', () => {
  const g = makeGame({ hour: 9 });
  const pip = g.entities.get('pip');
  const ages = { pip: 16, hobb: 86 };
  const changed = applyAgeLooks(g, { baseAgeOf: (id) => profileById(id)?.age ?? (id === 'hobb' ? 79 : null), ageOf: (id) => ages[id] ?? profileById(id)?.age, stageOf: (id) => (ages[id] >= 16 ? 'adult' : 'child') });
  assert.ok(changed.includes('pip'));
  assert.match(pip.spriteKey, /^pip~/);
  assert.equal(pip.maxHp, 36, 'a grown body');
  assert.match(g.entities.get('hobb').spriteKey, /^hobb~.*b/, 'Hobb bent at eighty-six');
});

import { uneasePlugin } from '../src/society/unease.js';

test("roles grow with the child; a day's unease is kept for that day only", () => {
  const g = makeGame({ hour: 9 });
  const pip = g.entities.get('pip');
  assert.equal(pip.profile.role, 'orphan child');
  const pb = birthdayOf('pip');
  const pipDay = (n) => (pb === 1 ? 1 + 12 * n : pb + 12 * (n - 1));
  g.clock.t = (pipDay(4) - 1) * DAY_SECONDS + 9 * (DAY_SECONDS / 24);
  step(g, 0.2);
  assert.equal(pip.profile.role, 'potboy at the Ember Kettle');
  g.clock.t = 9 * (DAY_SECONDS / 24);
  g.calendar.lastDay = null;
  g.calendar.update();
  assert.equal(pip.profile.role, 'orphan child', 'back to the canon on the first morning');
  // Unease: saved for its day.
  const elda = g.entities.get('elda');
  elda.uneasy = { day: g.clock.day, place: 'ember_kettle', t: 10 };
  const data = uneasePlugin.serialize({ game: g });
  assert.deepEqual(Object.keys(data), ['elda']);
  elda.uneasy = null;
  uneasePlugin.deserialize(data, { game: g });
  assert.equal(elda.uneasy.place, 'ember_kettle');
  elda.uneasy = null;
  g.clock.t += DAY_SECONDS;
  uneasePlugin.deserialize(data, { game: g });
  assert.equal(elda.uneasy, null, 'a day old: dropped');
});
