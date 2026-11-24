// Portraits and item icons for the DOM, cached as data URLs so panels can be rebuilt
// cheaply. Calls into the art modules are guarded: a missing sprite falls back to a
// drawn placeholder instead of breaking the panel.

import { portrait, ensureCharacter, hasCharacter } from '../art/characters_art.js';
import { itemIcon } from '../art/items_art.js';
import { canvasUrl } from './dom.js';
import { iconUrl } from './icons.js';

const portraits = new Map();
const items = new Map();

// People who live in her memory but not in the world (her mentor walked into the
// ruins months ago). Their faces are painted with the same generator as everyone else,
// from how the story describes them, the first time a panel needs one.
export const ABSENT_LOOKS = Object.freeze({
  // "Grey cloak, ink-stained fingers, a laugh like a kettle coming to the boil."
  maren: {
    skin: 'light',
    hair: 'grey',
    hairStyle: 'bun',
    outfit: 'robe',
    top: 'charcoal',
    bottom: 'charcoal',
    accent: 'silver',
    cloak: 'charcoal',
    cloakTrim: 'silver',
    held: 'book',
    build: 'normal',
    eyes: '#6f93b8',
  },
});

export function portraitUrl(game, key, expression = 'neutral') {
  const k = `${key}|${expression}`;
  let u = portraits.get(k);
  if (u !== undefined) return u;
  u = '';
  try {
    const look = ABSENT_LOOKS[key];
    if (look && game.atlas && !hasCharacter(game.atlas, key)) ensureCharacter(game.atlas, key, look);
    const c = portrait(game.atlas, key, expression);
    if (c && c.width) u = canvasUrl(c);
  } catch {
    u = '';
  }
  if (!u && expression !== 'neutral') u = portraitUrl(game, key, 'neutral');
  portraits.set(k, u);
  return u;
}

// The portrait key for someone in her relationships: creatures by species, groups and
// people without a face of their own get none (the panel draws their initial).
export function personArtKey(game, rel) {
  if (!rel || !rel.id) return null;
  if (rel.kind === 'group') return null;
  if (rel.species) return String(rel.species);
  const id = String(rel.id);
  if (id === 'player' || id === 'lyra' || ABSENT_LOOKS[id]) return id;
  let e = null;
  try {
    e = game.entities?.get?.(id) || null;
  } catch {
    e = null;
  }
  if (e) return e.spriteKey || e.species || id;
  return rel.npc ? id : null;
}

export function itemIconUrl(game, id) {
  let u = items.get(id);
  if (u !== undefined) return u;
  u = '';
  try {
    const c = itemIcon(game.atlas, id);
    if (c && c.width) u = canvasUrl(c);
  } catch {
    u = '';
  }
  if (!u) u = id === 'coin' ? iconUrl('coin') : iconUrl('bag');
  items.set(id, u);
  return u;
}

// Art can be re-registered (e.g. after the player renames someone); drop stale copies.
export function clearArtCache() {
  portraits.clear();
  items.clear();
}
