// Villagers fight back (round 14b, item 8; DESIGN §35.2; the author: "the people should
// fight me, not just let me kill their whole village"). Until now only the watch and Hess
// ever raised a hand. A defender is anyone who will stand between the stranger and the one
// they are hurting: the watch, Hess, and the strong grown people of Hearthvale who own a
// tool and the nerve to use it (Bram's hammer, Tobias's pitchfork, Garrick's cudgel,
// Sabeth's paddle, Tilly's tongs).
//
// What a defender knows is their own (DESIGN §29.4): they fight only someone they KNOW did
// it (they saw the blow, came and saw who, or were told face to face). A cry they only heard
// brings them to look, never to fight a who. Never for a theft, never for an accident.
//
//   DEFENDER_COMBAT[id]          stats and the tool a defender fights with (read in place of
//                                profile.combat by npc.js; the profiles are never edited)
//   DEFENDER_LINES[id]           what they shout as they come at the stranger (npc.js reads
//                                these beside T's RESPONSE_LINES)
//   isDefender(game, npc)        will they fight for someone right now?
//   defendsAgainst(kind)         is this crime one a defender fights over?
//
// Pure apart from reading the game.

import { lifeStage, isMinor } from '../core/people.js';

// Stats for the villagers who fight back (the guards and Hess keep their own profiles).
// `tool` is what they swing (for their lines and the finisher's scene); `reach` its length.
export const DEFENDER_COMBAT = Object.freeze({
  bram: Object.freeze({ maxHp: 58, atk: 6, def: 2, tool: 'hammer', reach: 26 }),
  tobias: Object.freeze({ maxHp: 46, atk: 5, def: 1, tool: 'pitchfork', reach: 30 }),
  garrick: Object.freeze({ maxHp: 42, atk: 4, def: 1, tool: 'cudgel', reach: 24 }),
  sabeth: Object.freeze({ maxHp: 42, atk: 4, def: 1, tool: 'paddle', reach: 26 }),
  tilly: Object.freeze({ maxHp: 40, atk: 5, def: 1, tool: 'tongs', reach: 24 }),
});

// Ages a defender fights at (17 to 65): older or younger, they shout and keep clear.
export const DEFEND_AGE = Object.freeze({ from: 17, to: 65 });

// Their own words (round 14b): non-guards had none for a fight. `answer` when they come at
// the stranger for someone hurt, `hold` when they stand in the way, `over` when it ends.
export const DEFENDER_LINES = Object.freeze({
  bram: { answer: ['Get AWAY from them!', 'Put it down. Now.', "Not in my village, you don't!"], hold: ['Back off. I mean it.', "Step back. I've a hammer and a long memory."], over: ["Don't come back here.", "That's the end of it."] },
  tobias: { answer: ['Leave them be!', "Off! Get off them!", "You'll answer for that!"], hold: ["Stay back. I'm warning you.", "Don't you take one more step."], over: ['Go on. Get gone.'] },
  garrick: { answer: ["Oi! That's enough!", "Back off, or so help me!"], hold: ['Easy now. Easy. Step back.'], over: ["And stay out of my shop."] },
  sabeth: { answer: ['Leave them ALONE!', "You won't touch them again!"], hold: ["Don't. Don't you dare."], over: ['Go. Just go.'] },
  tilly: { answer: ["Hey! Get off them!", "Try that on me, then!"], hold: ["Back. Off."], over: ['Yeah. Run.'] },
  any: { answer: ['Leave them be!', 'Get away from them!'], hold: ['Stay back!'], over: ['Go on. Get gone.'] },
});

// Crimes worth a fight: a blow, a knock-down, a killing. Never a theft, never an accident.
const FIGHT_OVER = new Set(['assault', 'knockout', 'murder', 'attacked_villager', 'downed_villager', 'hit_lyra', 'downed_lyra']);
export function defendsAgainst(kind) {
  return FIGHT_OVER.has(kind);
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// Will this villager fight for someone right now? The watch and Hess always may (their own
// rules decide whom); the strong grown villagers of DEFENDER_COMBAT when they are of an
// age to (17–65), on their feet, and not terrified of the stranger (a killing seen today,
// or the dread of several).
export function isDefender(game, npc) {
  if (!npc || npc.dead || npc.downed || npc.absent) return false;
  if (npc.isGuard || npc.profile?.hunter) return true;
  const id = npc.profile?.id ?? npc.id;
  if (!DEFENDER_COMBAT[id]) return false;
  if (isMinor(game, npc)) return false;
  const stage = lifeStage(game, npc);
  if (stage && stage !== 'adult') return false;
  const age = safe(() => game?.calendar?.ageOf?.(id), null) ?? npc.profile?.age;
  if (Number.isFinite(age) && (age < DEFEND_AGE.from || age > DEFEND_AGE.to)) return false;
  if (safe(() => game?.murder?.fearOf?.(npc), null)) return false;
  return true;
}

export function defenderLine(id, kind, rng = Math.random) {
  const own = DEFENDER_LINES[id]?.[kind];
  const list = own?.length ? own : DEFENDER_LINES.any[kind] || [];
  if (!list.length) return null;
  return list[Math.floor((typeof rng === 'function' ? rng() : Math.random()) * list.length) % list.length];
}
