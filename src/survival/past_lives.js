import { PAST_LIVES_KEY, PAST_LIVES_MAX } from './constants.js';

// Past lives (DESIGN §27): a story that ended in death without a kept flame is closed for
// good; its memorial is kept here and listed on the title screen. Stored in this browser
// (localStorage, wrapped: a blocked store simply keeps nothing). The closed save itself
// carries the memorial too, so the cloud copy can never be continued either.

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readPastLives(store = storage()) {
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(PAST_LIVES_KEY) || '[]');
    return Array.isArray(list) ? list.filter((m) => m && typeof m === 'object' && m.name) : [];
  } catch {
    return [];
  }
}

// Newest first; the same life (by id) is never listed twice.
export function addPastLife(memorial, store = storage()) {
  if (!memorial || !store) return readPastLives(store);
  const list = readPastLives(store).filter((m) => m.id !== memorial.id);
  list.unshift(memorial);
  if (list.length > PAST_LIVES_MAX) list.length = PAST_LIVES_MAX;
  try {
    store.setItem(PAST_LIVES_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked or full: the memorial still shows this once */
  }
  return list;
}

// A save whose life has ended. It can be read (for its memorial) but never continued.
export function isClosedSave(d) {
  return !!d && typeof d === 'object' && (d.closed === true || d.flags?.life_closed === true);
}
