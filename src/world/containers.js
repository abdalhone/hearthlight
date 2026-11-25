import { TILE } from '../core/constants.js';
import { setLockedChestHandler } from './objects.js';

// Chests you could not open (DESIGN §32.6, round 14: "There is a chest that I cannot
// open."). The audit found four: Lyra's trunk ("locked, and it is not yours": no way in),
// Rowan's footlocker and the Reeds' linen chest (chest-shaped props that did nothing at
// all), and the crates and barrels that look like storage but are furniture. Every real
// container now has a way in:
//   - a key someone has: Rowan gives his to whoever holds the line with him (the spear
//     drill), Lyra keeps hers and opens her trunk herself for someone she trusts;
//   - a heavy blow: without the key you may force any lock. If the chest is someone's,
//     that is theft (the 'crime' event: Lyra and the village hear of it as such);
//   - an open lid: the linen chest is not locked, but it is the Reeds'; take from it and
//     that is theft too.
// The crates, barrels, nightstands and shelves stay furniture; the ones worth a look say
// what is in them.

export const CONTAINERS = {
  lyra_trunk: {
    tx: 75,
    ty: 44,
    name: "Lyra's trunk",
    variant: 'trunk',
    owner: 'lyra',
    keeper: 'lyra',
    locked: true,
    keyId: 'lyra_trunk_key',
    lockedText: "Lyra's old trunk from the chandlery, Hobb's road-warden mark burned into the lid. It is locked, and Lyra keeps the key.",
    items: { candle: 3, wool_cloak: 1, coin: 4 },
    inside: "Under her spare cloak: a bundle of letters in Maren's hand, tied with violet thread, and a child's drawing of a lamp. You read the first line of the top letter and put it back.",
    replaces: { objType: 'trunk', tx: 75, ty: 44 },
  },
  guard_footlocker: {
    tx: 64,
    ty: 67,
    name: 'Footlocker',
    variant: 'trunk',
    owner: 'rowan',
    keeper: 'rowan',
    locked: true,
    keyId: 'guard_key',
    lockedText: "The watch's footlocker: spare kit, kept locked. Rowan carries the key on his belt, and gives it to the people he trusts with the watch.",
    items: { potion: 2, bread: 2, coin: 12 },
    replaces: { objType: 'trunk', tx: 64, ty: 67 },
  },
  reed_linen_chest: {
    tx: 28,
    ty: 49,
    name: 'Linen chest',
    variant: 'trunk',
    owner: 'tobias',
    locked: false,
    items: { wool_cloak: 1, wheat: 3 },
    replaces: { objType: 'trunk', tx: 28, ty: 49 },
  },
};

const TRUST_TO_SHOW = 60; // Lyra opens her trunk for someone she trusts this much

const NAMES = { lyra: 'Lyra', rowan: 'Captain Rowan', tobias: 'Tobias' };

function personOf(game, id) {
  if (!id) return null;
  if (id === 'lyra') return game.companion || null;
  return game.entities?.get?.(id) || null;
}

function lyraTrust(game) {
  try {
    const s = game.companion?.mind?.autonomy?.stats?.();
    return Number.isFinite(s?.trust) ? s.trust : null;
  } catch {
    return null;
  }
}

function toast(game, text, kind = 'info') {
  try {
    game.ui?.toast?.(text, kind);
  } catch {
    /* ui optional */
  }
}

// A locked chest, no key in hand: its keeper may open it, else you may force it.
export function lockedChest(game, chest, actor) {
  const keeper = chest.keeper;
  if (keeper === 'lyra') {
    const c = game.companion;
    const near = c && !c.removed && !c.dead && Math.hypot(c.x - chest.x, c.y - chest.y) < 5 * TILE;
    const t = lyraTrust(game);
    if (near && t != null && t >= TRUST_TO_SHOW) {
      chest.state.locked = false;
      chest.markDirty();
      toast(game, 'Lyra kneels and turns her key. "It\'s not a secret. It\'s just mine. ...Go on."', 'good');
      game.bus?.emit?.('chest_shown', { chest, by: 'lyra', actor });
      chest.interact(actor);
      return;
    }
    if (near) toast(game, t != null && t < 25 ? '"Don\'t touch that."' : '"That\'s mine. Not yet."', 'info');
  }
  const owner = chest.owner && chest.owner !== 'player' && !chest.loot ? chest.owner : null;
  const whose = owner ? NAMES[owner] || owner : null;
  const text = `${chest.lockedText || `${chest.name} is locked.`} You could force the lock with a heavy blow${whose ? `, but it is ${whose}'s, and that is theft: ${owner === 'lyra' ? 'she will know' : 'word will get round'}.` : '.'}`;
  const ui = game.ui;
  if (typeof ui?.confirm !== 'function') {
    toast(game, text);
    return;
  }
  ui.confirm({ title: chest.name, text, yes: 'Force the lock', no: 'Leave it', danger: !!owner }).then((ok) => {
    if (ok) forceChest(game, chest, actor);
  });
}

// Break the lock: it opens for good, and if it is someone's, that is theft.
export function forceChest(game, chest, actor) {
  chest.state.locked = false;
  chest.state.forced = true;
  chest.markDirty();
  try {
    game.audio?.play?.('hit', { x: chest.x, y: chest.y, pitch: 0.7 });
    game.particles?.emit?.('wood_chip', chest.x, chest.y - 6, { count: 8 });
    game.camera?.shake?.(1.5, 0.15);
  } catch {
    /* effects optional */
  }
  const owner = chest.owner && chest.owner !== 'player' && !chest.loot ? chest.owner : null;
  if (owner) {
    const victim = personOf(game, owner);
    game.bus?.emit?.('crime', { actor, victim, kind: 'theft', object: chest.id, owner });
    chest.state.stolenFrom = true;
  }
  game.bus?.emit?.('chest_forced', { chest, actor, owner });
  toast(game, owner ? `The hasp gives. This is ${NAMES[owner] || owner}'s.` : 'The hasp gives.', owner ? 'warn' : 'info');
  chest.interact(actor);
}

// Taking from someone's open chest is theft too (once a day per chest).
export function onContainerEvent(game, type, p) {
  if (type !== 'item_gained' || p?.from !== 'chest') return;
  const chest = p.chest || game.ui?.chest?.chest || null;
  if (!chest || chest.loot || !chest.owner || chest.owner === 'player') return;
  const day = game.clock?.day ?? 1;
  if (chest.state.takenDay === day) return;
  chest.state.takenDay = day;
  chest.markDirty?.();
  if (chest.state.forced) return; // already counted when the lock broke
  game.bus?.emit?.('crime', { actor: p.actor || game.player, victim: personOf(game, chest.owner), kind: 'theft', object: chest.id, owner: chest.owner });
}

// What the first look inside shows (a line, once).
export function onChestOpened(game, chest) {
  const def = CONTAINERS[chest.id];
  if (def?.inside && !chest.state.seenInside) {
    chest.state.seenInside = true;
    chest.markDirty();
    toast(game, def.inside, 'info');
  }
}

setLockedChestHandler((game, chest, actor) => lockedChest(game, chest, actor));
