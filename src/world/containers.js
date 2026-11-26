import { TILE } from '../core/constants.js';
import { setLockedChestHandler } from './objects.js';
import { lyraOf } from '../core/people.js';
import { witnessesOf } from '../murder/witness.js';
import { hears, LOUD } from '../ai/hearing.js';
import { wallBetween } from './walls.js';

// Chests you could not open (DESIGN §32.6, round 14: "There is a chest that I cannot
// open."). The audit found four: Lyra's trunk ("locked, and it is not yours": no way in),
// Rowan's footlocker and the Reeds' linen chest (chest-shaped props that did nothing at
// all), and the crates and barrels that look like storage but are furniture. Every real
// container now has a way in:
//   - a key someone has: Rowan gives his to whoever holds the line with him (the spear
//     drill), Lyra keeps hers and opens her trunk herself for someone she trusts;
//   - a heavy blow: without the key you may force any lock (at the chest with the use
//     button, or a Strike or heavy weave on it, round 14b). If the chest is someone's,
//     that is theft;
//   - an open lid: the linen chest is not locked, but it is the Reeds'; take from it and
//     that is theft too.
// Theft only if SEEN (round 14b, decision D10; DESIGN §35.3): theftIfSeen asks the shared
// sight rule (murder/witness.js) who saw the hand in the chest or the pockets. Seen: the
// 'theft' crime with its witnesses (never an assault; the village's 'stole' news, Lyra's
// 'stole' deed only if she is one of them). Unseen: no crime and no toast; the owner, when
// they next see their chest, finds goods missing and is uneasy. Every item taken is written
// on the provenance ledger (game.provenance) either way. A dead Lyra neither opens nor
// guards her trunk: it passes to her mother (murder/data.js KEEPSAKES).
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
  if (id === 'lyra') return lyraOf(game);
  return game.entities?.get?.(id) || null;
}

function lyraDead(game) {
  try {
    return !!game.murder?.isDead?.('lyra');
  } catch {
    return false;
  }
}

// Who owns it now: a dead Lyra's trunk is her mother's (her keepsakes go to her family).
export function ownerOf(game, chest) {
  const o = chest?.owner;
  if (o === 'lyra' && lyraDead(game)) return 'wenna';
  return o;
}

function day(game) {
  return game.clock?.day ?? 1;
}

// Did anyone see the stranger's hand in it (DESIGN §35.3)? Writes every item to the
// provenance ledger; a seen theft is a 'theft' crime with its witnesses (and, from a body,
// a 'searched' clue for the watch). -> the witnesses' ids ([] when unseen).
// o: { actor, owner, object, how: 'chest' | 'forced' | 'body', itemId, qty, dead, x, y }
export function theftIfSeen(game, o) {
  const actor = o.actor || game.player;
  if (!actor) return [];
  const exclude = [o.owner, 'player'].filter(Boolean);
  let seen = [];
  try {
    seen = witnessesOf(game, actor.x, actor.y, { exclude }).map((w) => w.id);
  } catch {
    seen = [];
  }
  if (o.itemId && o.qty > 0) {
    try {
      game.provenance?.add?.(o.itemId, o.qty, { owner: o.owner || null, how: o.how || 'chest', day: day(game), seenBy: seen });
    } catch {
      /* the ledger is optional */
    }
  }
  if (!seen.length) return seen;
  const key = `${o.object || o.owner}:${day(game)}`;
  const told = (game._theftsTold ||= new Set());
  if (!told.has(key)) {
    told.add(key);
    game.bus?.emit?.('crime', { actor, victim: personOf(game, o.owner), kind: 'theft', object: o.object || null, owner: o.owner || null, witnesses: seen, dead: !!o.dead, how: o.how || 'chest' });
  }
  if (o.dead) {
    const rec = game.murder?.dead?.[o.owner];
    if (rec && Array.isArray(rec.clues) && !rec.clues.some((c) => c.kind === 'searched' && c.by === seen[0])) rec.clues.push({ kind: 'searched', by: seen[0], t: Math.round(game.clock?.t ?? 0), place: game.locations?.at?.(actor.x, actor.y)?.id || null, clarity: 'clear' });
  }
  return seen;
}

function lyraTrust(game) {
  try {
    const s = lyraOf(game)?.mind?.autonomy?.stats?.();
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
  const keeper = chest.keeper === 'lyra' && lyraDead(game) ? null : chest.keeper;
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
  const owner = chest.owner && chest.owner !== 'player' && !chest.loot ? ownerOf(game, chest) : null;
  const whose = owner ? NAMES[owner] || game.entities?.get?.(owner)?.name?.split(' ')[0] || owner : null;
  const text = `${chest.lockedText || `${chest.name} is locked.`} You could force the lock with a heavy blow${whose ? `, but it is ${whose}'s: if anyone sees you, that is theft.` : '.'}`;
  const ui = game.ui;
  if (typeof ui?.confirm !== 'function') {
    toast(game, text);
    return;
  }
  ui.confirm({ title: chest.name, text, yes: 'Force the lock', no: 'Leave it', danger: !!owner }).then((ok) => {
    if (ok) forceChest(game, chest, actor);
  });
}

// Break the lock: it opens for good. The blow is a sound (heard by the hearing rule: what
// and where, never who); if it is someone's and anyone SEES it, that is theft.
// opts.open: open the chest panel after (at the chest with the use button; a weave's blow
// from across the room does not).
export function forceChest(game, chest, actor, { open = true } = {}) {
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
  const owner = chest.owner && chest.owner !== 'player' && !chest.loot ? ownerOf(game, chest) : null;
  let seen = [];
  if (owner) {
    seen = theftIfSeen(game, { actor, owner, object: chest.id, how: 'forced' });
    chest.state.stolenFrom = true;
    // Heard, not seen: a crack of wood somewhere (uneasy, of a place, never of a who).
    for (const e of game.entities?.all?.() || []) {
      if (!e?.profile || typeof e.unease !== 'function' || seen.includes(e.id)) continue;
      try {
        if (hears(game, e, chest.x, chest.y, LOUD.blow)) e.unease(chest.x, chest.y);
      } catch {
        /* ears are optional */
      }
    }
  }
  game.bus?.emit?.('chest_forced', { chest, actor, owner, witnesses: seen });
  const whose = owner ? NAMES[owner] || game.entities?.get?.(owner)?.name?.split(' ')[0] || owner : null;
  toast(game, owner ? (seen.length ? `The hasp gives. This is ${whose}'s, and you were seen.` : `The hasp gives. This is ${whose}'s.`) : 'The hasp gives.', owner && seen.length ? 'warn' : 'info');
  if (open) chest.interact(actor);
}

// Taking from someone's chest, or from the pockets of the dead: theft if seen (D10).
export function onContainerEvent(game, type, p) {
  if (type !== 'item_gained' || p?.from !== 'chest') return;
  const chest = p.chest || game.ui?.chest?.chest || null;
  if (!chest || chest.loot || !chest.owner || chest.owner === 'player') return;
  const owner = chest.body ? chest.owner : ownerOf(game, chest);
  chest.state.takenDay = day(game);
  chest.markDirty?.();
  theftIfSeen(game, { actor: p.actor || game.player, owner, object: chest.id, how: chest.body ? 'body' : chest.state.forced ? 'forced' : 'chest', itemId: p.itemId, qty: p.qty || 1, dead: !!chest.body });
  // Unseen from a living owner's chest: they will find it short.
  if (!chest.body) chest.state.missingSince = chest.state.missingSince ?? day(game);
}

// The owner finds goods missing (round 14b, D10): uneasy, no crime, no toast. Called from
// the blood plugin's slow tick: an owner who can see their chest notices once.
export function ownersNotice(game) {
  for (const o of game.objects?.all?.() || []) {
    const st = o?.state;
    if (!st || st.missingSince == null || st.missingNoticed || !o.owner) continue;
    const owner = personOf(game, ownerOf(game, o));
    if (!owner || owner.dead || typeof owner.isAlive !== 'function' || !owner.isAlive()) continue;
    if (Math.hypot(owner.x - o.x, owner.y - o.y) > 48) continue;
    if (wallBetween(game, owner.x, owner.y - 3, o.x, o.y - 3)) continue;
    st.missingNoticed = day(game);
    o.markDirty?.();
    try {
      owner.unease?.(o.x, o.y);
      owner.missingGoods = { day: day(game), object: o.id };
      owner.say?.(`Someone's been in my ${String(o.name || 'chest').toLowerCase()}.`, { kind: 'say' });
    } catch {
      /* words are decoration */
    }
    game.bus?.emit?.('goods_missing', { owner: owner.id, object: o.id });
  }
}

// A blow on a locked chest (round 14b leftover): a Strike's fist or a heavy weave forces it
// (D10: a heavy blow is a way in), the same as forcing it by hand, its contents left
// exactly where they were. Anything lighter (a sword, a bolt) gets a word, not nothing.
// blow: { source, heavy, punch }. -> 'forced' | 'iron' | null
export function blowAtChest(game, chest, blow = {}) {
  if (!chest || chest.removed || !chest.inventory) return null;
  const src = blow.source || null;
  if (src && src !== game.player && src.id !== 'player') return null;
  if (!chest.state?.locked) return null;
  if (blow.heavy || blow.punch) {
    forceChest(game, chest, src || game.player, { open: false });
    return 'forced';
  }
  const t = game.time ?? 0;
  if (t - (chest._ironAt ?? -Infinity) > 4) {
    chest._ironAt = t;
    toast(game, 'Iron-bound. A heavier blow would break the hasp, or force the lock by hand.', 'info');
  }
  return 'iron';
}

// Every locked chest a blow at (x, y) with reach r lands on, with no wall in between.
export function blowAtChests(game, x, y, r, blow = {}) {
  const out = [];
  let list = [];
  try {
    list = game.objects?.inRadius?.(x, y, r + 12, (o) => !!o?.inventory && o.state?.locked && !o.removed) || [];
  } catch {
    list = [];
  }
  for (const o of list) {
    if (Math.hypot(o.x - x, o.y - y) > r + 10) continue;
    if (wallBetween(game, x, y - 3, o.x, o.y - 3)) continue;
    const res = blowAtChest(game, o, blow);
    if (res) out.push(res);
  }
  return out;
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
