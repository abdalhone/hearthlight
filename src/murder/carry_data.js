// What the people of Hearthvale carry on them (round 14b, item 9; DESIGN §35.3): what is in
// their pockets when they die, and what a hand going through them finds. Id-keyed (no
// profile is edited this round). Rolled once, at the death, into the body's own inventory
// (saved with the villager). `coin: [min, max]`; the rest are fixed counts.
//   - a purse for everyone; tools of their trade; keys (Rowan's footlocker key is on his
//     belt; Lyra keeps the key to her trunk); a keepsake or two.

export const CARRY = Object.freeze({
  rowan: { coin: [5, 9], guard_key: 1, bread: 1 },
  wys: { coin: [2, 5], bread: 1 },
  hess: { coin: [2, 4], venison: 1 },
  bram: { coin: [8, 14], iron_ore: 1 },
  tilly: { coin: [2, 6], iron_ore: 1 },
  garrick: { coin: [14, 24] },
  elda: { coin: [6, 10], honey_cake: 1 },
  sabeth: { coin: [3, 6] },
  mira: { coin: [4, 8], herb: 3, potion: 1 },
  tobias: { coin: [2, 5], wheat: 2, turnip: 1 },
  aveline: { coin: [1, 3], candle: 2 },
  hobb: { coin: [3, 6], candle: 3 },
  wenna: { coin: [2, 5], honey: 2 },
  alder: { coin: [9, 15] },
  petra: { coin: [3, 7] },
  corran: { coin: [2, 5], raw_fish: 2, smoked_eel: 1 },
  // Lyra's own pack is her inventory; her key is on her.
  lyra: { coin: [3, 7], lyra_trunk_key: 1, candle: 1 },
  default: { coin: [1, 4] },
});
