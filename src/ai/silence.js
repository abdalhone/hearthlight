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
};

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
    .replace(/\{his\}/g, P('his'));
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
