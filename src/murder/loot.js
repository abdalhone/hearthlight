// Loot the dead (round 14b, item 9; DESIGN §35.3; the author: "I wish I'm able to loot the
// villagers when I kill them"). A body can be searched: their pockets open in the chest
// panel (ChestPanel takes any { name, inventory }). What they carried is rolled once, at the
// death (carry_data.js), into their own inventory, so the save keeps it; Lyra's pack is her
// own inventory.
//
// Theft only if seen (decision D10, the shared sight rule): every hand in a body's pockets
// or an owned chest goes through containers.js theftIfSeen. Seen: a 'theft' crime with its
// witnesses (the village's 'robbed_the_dead' / 'stole' news, never an assault) and, for a
// body, a 'searched' clue for the watch. Unseen: nothing, but the goods are on the
// provenance ledger (game.provenance) for whoever buys them.

import { CARRY } from './carry_data.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// Roll what they carried into their inventory, once (rec.looted marks it rolled).
export function rollLoot(m, v, rec) {
  if (!v || !rec || rec.loot) return;
  const inv = v.inventory;
  if (!inv?.add) return;
  const table = CARRY[v.id] || CARRY.default;
  const rng = m.rng();
  const got = {};
  for (const [id, n] of Object.entries(table)) {
    const q = Array.isArray(n) ? n[0] + Math.floor(rng() * (n[1] - n[0] + 1)) : n;
    if (q > 0 && !(id !== 'coin' && inv.count?.(id) >= q)) {
      inv.add(id, q);
      got[id] = q;
    }
  }
  rec.loot = { rolled: true, items: got };
}

// The pockets as a container the chest panel opens.
export function pocketsOf(m, v) {
  const rec = m.dead[v?.id];
  if (!rec || !v?.inventory) return null;
  const first = (v.name || m.name(v.id) || 'them').split(' ')[0];
  const isLyra = m.isLyra?.(v);
  rec.pockets = rec.pockets || {};
  return {
    id: `body:${v.id}`,
    objType: 'body',
    name: isLyra ? `${first}'s pack` : `${first}'s pockets`,
    inventory: v.inventory,
    owner: v.id,
    body: true,
    x: v.x,
    y: v.y,
    state: rec.pockets,
    markDirty() {},
  };
}

// Search: open the pockets. Returns the container (or null).
export function search(m, v, actor) {
  const rec = m.dead[v?.id];
  if (!rec || !actor) return null;
  const pockets = pocketsOf(m, v);
  if (!pockets) return null;
  rec.searched = rec.searched || { t: Math.round(m.now()), place: m.placeOf(v) };
  safe(() => actor.setState?.('work', 0.5));
  safe(() => actor.faceToward?.(v.x, v.y));
  m.emit('body_searched', { id: v.id, actor });
  const ui = m.game?.ui;
  if (typeof ui?.openChest === 'function') safe(() => ui.openChest(pockets));
  return pockets;
}

// What the finder notices about a body someone went through unseen: turned-out pockets.
export function emptyPocketsNote(m, rec) {
  if (!rec?.searched) return '';
  return 'Their pockets have been turned out.';
}
