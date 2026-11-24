import { FLAME_PRICE } from './constants.js';

// The kept flame (DESIGN §27, LORE §1 "Kept flame", §5): Sister Aveline can relight the
// stranger's family flame on the chapel altar from the road-candle. While it burns, a death
// is not the end: the flame is spent bringing them back. One at a time; a price for the
// candle, the wax and the rite. Stored in game.flags (saved with the game).

export function keptFlame(game) {
  const f = game?.flags?.keptFlame;
  return f && typeof f === 'object' ? f : null;
}

export function hasKeptFlame(game) {
  return !!keptFlame(game);
}

export function flamePrice(game) {
  // The second rite costs more: the wax is Hobb's, and he counts it.
  const spent = Number(game?.flags?.flamesSpent) || 0;
  return FLAME_PRICE + spent * 20;
}

// Pay and light it. Returns { ok, reason?, price }.
export function lightKeptFlame(game, player = game?.player) {
  const price = flamePrice(game);
  if (!game || !player) return { ok: false, reason: 'nobody', price };
  if (hasKeptFlame(game)) return { ok: false, reason: 'burning', price };
  const coins = player.inventory?.count?.('coin') ?? 0;
  if (coins < price) return { ok: false, reason: 'coin', price, coins };
  player.inventory.remove('coin', price);
  game.flags = game.flags || {};
  game.flags.keptFlame = { day: game.clock?.day ?? 1, price, by: 'aveline' };
  try {
    game.bus?.emit?.('kept_flame', { lit: true, price, player });
  } catch {
    /* listeners are optional */
  }
  return { ok: true, price };
}

// The flame brought them back: it is gone, and the next one costs more.
export function spendKeptFlame(game) {
  if (!hasKeptFlame(game)) return false;
  game.flags.keptFlame = null;
  game.flags.flamesSpent = (Number(game.flags.flamesSpent) || 0) + 1;
  try {
    game.bus?.emit?.('kept_flame', { lit: false, spent: true });
  } catch {
    /* listeners are optional */
  }
  return true;
}
