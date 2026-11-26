// Who a person is to the game by age (DESIGN §34.2, decision D1 of round 14b): one rule for
// "a child", read by every system that kills, takes a companion, aims a dark spell or
// allows an intimate act. Pure: it reads the game and never writes.
//
//   ageOf(game, who)          a person's age today (the calendar's, else the profile's), or
//                             null when unknown (the stranger does not know their own age)
//   stageOfAge(age)           'child' <13, 'teen' 13–15, 'adult' 16–64, 'elder' 65–79,
//                             'frail' 80+ (null for an unknown age)
//   lifeStage(game, who)      the same, for a person
//   isMinor(game, who)        under MINOR_UNDER (16): never killable, never a companion, never
//                             the Unkindling's target, never hurt when a village is emptied
//   isAdult(game, who)        a person who is not a minor
//   canBeIntimate(game, who)  INTIMATE_FROM (18) and over: the floor for a kiss, a held hand
//                             and every other intimate act (D1, the critic's addition)
//   lyraOf(game)              Lyra herself (game.lyra, else the entity with her id, else
//                             game.companion): never "whoever is your companion now"
//
// `who` is an entity or an id. The age comes from the calendar (src/world/calendar.js:
// everyone grows a year older on their birthday) and falls back to the profile's age.
// Build 'child' or 'teen' counts only while the age is unknown: Tansy (build 'teen') is a
// minor at 15 and an adult at 16, as the calendar says (the old rule kept her a child
// forever). The player is a grown stranger: never a minor, of an age to be intimate.

import { COMPANION_ID, PLAYER_ID } from './constants.js';
import { NPC_PROFILES } from '../entities/npc_data.js';
import { baseAge } from '../world/calendar.js';

export const MINOR_UNDER = 16; // the one cut-off (raise it to 18 here and every rule follows)
export const INTIMATE_FROM = 18;

const STAGES = [
  [13, 'child'],
  [16, 'teen'],
  [65, 'adult'],
  [80, 'elder'],
  [Infinity, 'frail'],
];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function idOf(who) {
  if (!who) return null;
  if (typeof who === 'string') return who;
  return who.profile?.id ?? who.id ?? null;
}

function isPlayerRef(game, who) {
  if (!who) return false;
  if (who === PLAYER_ID) return true;
  return typeof who === 'object' && (who === game?.player || who.id === PLAYER_ID);
}

function profileOf(game, who, id) {
  if (who && typeof who === 'object' && who.profile) return who.profile;
  const e = id ? safe(() => game?.entities?.get?.(id), null) : null;
  if (e?.profile) return e.profile;
  return id ? NPC_PROFILES.find((p) => p.id === id) || null : null;
}

// Lyra the person, wherever the game keeps her (round 14b: game.companion still means
// Lyra this round; the companion ROLE is game.party.holder).
export function lyraOf(game) {
  if (!game) return null;
  return safe(() => game.lyra, null) || safe(() => game.entities?.get?.(COMPANION_ID), null) || game.companion || null;
}

export function ageOf(game, who) {
  if (!who || isPlayerRef(game, who)) return null;
  const id = idOf(who);
  const cal = id ? safe(() => game?.calendar?.ageOf?.(id), null) : null;
  if (Number.isFinite(cal)) return cal;
  const p = profileOf(game, who, id);
  if (Number.isFinite(p?.age)) return p.age;
  // (Never entity.age: on an actor that is seconds alive, for its animations.)
  const b = id ? baseAge(id) : null;
  return Number.isFinite(b) ? b : null;
}

export function stageOfAge(age) {
  if (!Number.isFinite(age)) return null;
  for (const [under, stage] of STAGES) if (age < under) return stage;
  return 'frail';
}

export function lifeStage(game, who) {
  return stageOfAge(ageOf(game, who));
}

function childBuild(game, who) {
  const a = profileOf(game, who, idOf(who))?.appearance;
  return a?.build === 'child' || a?.build === 'teen';
}

export function isMinor(game, who) {
  if (!who || isPlayerRef(game, who)) return false;
  const age = ageOf(game, who);
  if (Number.isFinite(age)) return age < MINOR_UNDER;
  return childBuild(game, who);
}

// A person (not a beast, not a thing) who is not a minor.
export function isAdult(game, who) {
  if (!who) return false;
  if (isPlayerRef(game, who)) return true;
  const id = idOf(who);
  const person = id === COMPANION_ID || !!profileOf(game, who, id) || (typeof who === 'object' && !who.species && who.kind === 'human');
  return person && !isMinor(game, who);
}

export function canBeIntimate(game, who) {
  if (!who) return false;
  if (isPlayerRef(game, who)) return true;
  const age = ageOf(game, who);
  return Number.isFinite(age) && age >= INTIMATE_FROM;
}
