// Silence is a choice made after hearing (DESIGN §23.3). The author: "make them able to
// choose to not respond to me but they have to get my msg so they get it and decide to not
// answer". Every word the player says reaches the person, goes into their memory and their
// conversation, and into their Claude prompt or local rules. Then they choose. When they
// choose to say nothing, the player sees it done: a visible act in the chat ("Elda hears
// you. She says nothing and turns away."), never an empty screen, a lock, a "didn't catch
// that" or a failure.

import { pronoun } from './village_life/errands_data.js';

const ACTS = {
  // Cold, wronged, done with the player.
  cold: ['{N} hears you. {He} says nothing and turns away.', '{N} hears you, and looks straight past you without a word.', '{N} hears every word. {He} says nothing, and goes back to what {he} was doing.'],
  // In terror of the player: too frightened to speak.
  afraid: ['{N} hears you. {He} says nothing; {he} only backs away, shaking.', '{N} stares at you, white to the lips, and says nothing at all.', '{N} hears you. {He} presses a hand to {his} mouth and backs off without a word.'],
  // Lyra, who has cut the player out of her life (or broken off): she heard it.
  gone: ['{N} hears you. She says nothing, and looks away.', '{N} hears you. She turns her back without a word.', '{N} hears every word. She says nothing.'],
  // Heard, and no answer could be found for the player in time: still a person who heard.
  heard: ['{N} hears you, and takes a moment over it without a word.', '{N} hears you. {He} looks at you a while, and says nothing yet.'],
  // Asleep: the words reach them, as far as words reach a sleeper.
  asleep: ['{N} stirs at your voice, mumbles, and sleeps on.', '{N} turns over in {his} sleep. Some of it reaches {him}.'],
};

// What they do instead of words, or with them (round 14b, DESIGN §33.3: a reply's
// `action`): shown as a narration row, and done in the world by the caller.
export const ACTIONS = Object.freeze(['turn_away', 'walk_off', 'flee', 'glare', 'cry', 'shove_past', 'keep_distance']);
const DOES = {
  turn_away: ['{N} turns away from you.', '{N} turns {his} back on you.'],
  walk_off: ['{N} walks off without looking back.', '{N} leaves you standing there.'],
  flee: ['{N} backs away from you, then runs.', '{N} bolts.'],
  glare: ['{N} glares at you.', '{N} gives you a long, hard look.'],
  cry: ['{N} is crying.', '{N} covers {his} face, crying.'],
  shove_past: ['{N} shoves past you.', '{N} pushes past you and goes.'],
  keep_distance: ['{N} keeps {his} distance.', '{N} steps back, out of your reach.'],
};

export function normalizeAction(a) {
  const k = String(a || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return ACTIONS.includes(k) ? k : null;
}

// The narration for an action ('turn_away', …), or ''. silent: they said nothing, so the
// row reads as hearing first ("Bram says nothing. He turns away.").
export function actionText(id, name, action, { silent = false, n = 0 } = {}) {
  const k = normalizeAction(action);
  if (!k) return '';
  const N = String(name || 'They').trim() || 'They';
  const P = (form) => pronoun(id, form);
  const fill = (t) =>
    t
      .replace(/\{N\}/g, N)
      .replace(/\{He\}/g, P('He'))
      .replace(/\{he\}/g, P('he'))
      .replace(/\{his\}/g, P('his'))
      .replace(/\{him\}/g, P('him'));
  const list = DOES[k];
  const does = fill(list[Math.abs(Math.floor(n)) % list.length]);
  if (!silent) return does;
  const rest = does.replace(new RegExp(`^${N.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`), '');
  return `${N} hears you. ${P('He')} says nothing, and ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`.replace(/\.\s*$/, '.');
}

// What the player sees instead of words. kind: 'cold' | 'afraid' | 'gone'; n turns the
// wording so the same act is not written twice in a row.
export function silenceAct(id, name, { kind = 'cold', n = 0 } = {}) {
  const list = ACTS[kind] || ACTS.cold;
  const N = String(name || 'They').trim() || 'They';
  const P = (form) => pronoun(id, form);
  return list[Math.abs(Math.floor(n)) % list.length]
    .replace(/\{N\}/g, N)
    .replace(/\{He\}/g, P('He'))
    .replace(/\{he\}/g, P('he'))
    .replace(/\{his\}/g, P('his'))
    .replace(/\{him\}/g, P('him'));
}

// The act as the body shows it: they turn their back on the player.
export function turnAway(e, from) {
  if (!e || !from) return;
  try {
    e.faceToward?.(e.x * 2 - from.x, e.y * 2 - from.y);
  } catch {
    /* cosmetic */
  }
}
