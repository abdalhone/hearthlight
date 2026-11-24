// Portraits and item icons for the DOM, cached as data URLs so panels can be rebuilt
// cheaply. Calls into the art modules are guarded: a missing sprite falls back to a
// drawn placeholder instead of breaking the panel.

import { portrait } from '../art/characters_art.js';
import { itemIcon } from '../art/items_art.js';
import { canvasUrl } from './dom.js';
import { iconUrl } from './icons.js';

const portraits = new Map();
const items = new Map();

export function portraitUrl(game, key, expression = 'neutral') {
  const k = `${key}|${expression}`;
  let u = portraits.get(k);
  if (u !== undefined) return u;
  u = '';
  try {
    const c = portrait(game.atlas, key, expression);
    if (c && c.width) u = canvasUrl(c);
  } catch {
    u = '';
  }
  if (!u && expression !== 'neutral') u = portraitUrl(game, key, 'neutral');
  portraits.set(k, u);
  return u;
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
