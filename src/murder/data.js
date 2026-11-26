// Plain data behind DESIGN §29: who takes over whose work, who stands in for whom, who
// leads the watch and the Moot and says the words at a funeral, where a body can be
// hidden, and the numbers the system runs on.
//
// Who can never be killed is no longer a list (round 14b, DESIGN §35.1): a child is a
// child by age (src/core/people.js isMinor, under 16), and every adult can die, Lyra and
// any companion included.

import { TILE } from '../core/constants.js';

export const HOUR = 37.5; // game seconds per in-game hour
export const DAY = 900;

export const FINISH_HOLD = 1.5; // seconds the strike is held before it falls
export const FINISH_REACH = 28; // px from the player to the fallen
export const FINISH_CANCEL = 40; // px: step further away and the blow is not struck

// Wanted for murder: the watch hunts the player for this long unless the Moot sits first.
export const MURDER_WANTED = 3 * DAY;
// Outside (the Moot's sentence): the bell-reach is closed to the stranger this long.
export const OUTSIDE_DAYS = 3;

// Suspicion levels (a belief, not a certainty).
export const LEVELS = [
  { id: 'none', min: 0, label: 'none' },
  { id: 'low', min: 0.15, label: 'a little' },
  { id: 'some', min: 0.35, label: 'some' },
  { id: 'strong', min: 0.6, label: 'strong' },
  { id: 'certain', min: 0.86, label: 'certain' },
];

export function levelOf(s) {
  let out = LEVELS[0];
  for (const l of LEVELS) if (s >= l.min) out = l;
  return out.id;
}

// Who leads an investigation, says the words at a funeral, and keeps the Moot, in order.
export const INVESTIGATORS = ['rowan', 'wys', 'hess', 'alder'];
export const OFFICIANTS = ['aveline', 'petra', 'hobb', 'alder', 'elda'];
export const MOOT_CHAIR = ['alder', 'elda', 'petra', 'aveline', 'hobb'];
// Heads of a household with a flame on the altar: they sit in the Moot (LORE §5).
export const MOOT_HEADS = ['alder', 'elda', 'bram', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'hess', 'sabeth', 'corran', 'hobb', 'petra', 'wys'];

// The dead person's work: who takes it on (village_life's COVER keeps their hours), and
// whether their shop or forge passes too. Missing from here: the work stays undone.
export const HEIRS = {
  bram: { by: 'tilly', shop: true, forge: true, work: 'the forge' },
  elda: { by: 'sabeth', shop: true, work: 'the Kettle' },
  garrick: { by: 'alder', shop: true, work: "Gale's Goods" },
  mira: { by: 'aveline', shop: true, work: "Mira's shelves" },
  rowan: { by: 'wys', work: 'the watch' },
  wys: { by: 'rowan', work: "Wys's rounds" },
  hobb: { by: 'wys', work: 'the lamp-round' },
  wenna: { by: 'hobb', work: 'the hives' },
  aveline: { by: 'petra', work: 'the flames' },
  tobias: { by: 'tansy', work: 'the farm' },
  hess: { by: 'tansy', work: "the wardrunner's road" },
  sabeth: { by: 'hess', work: 'the vats' },
  alder: { by: 'petra', work: "the Reeve's ledger" },
  tilly: { by: 'bram', work: 'her half of the forge' },
  // Lyra (round 14b): her father takes back the far lamps she lit before him.
  lyra: { by: 'hobb', work: 'the far lamps' },
};
// Work nobody takes on: it stays undone, and the village feels it.
export const UNDONE = {
  corran: 'Nobody fishes Mirror Lake now. The dock is quiet in the mornings.',
  petra: "Nobody sits on the bench outside the Kettle now. Nobody says the rude thing.",
};

// Who gives a dead villager's missions instead (DESIGN §29: a graceful alternative).
// The notice board takes whatever nobody alive can.
export const STAND_INS = {
  bram: ['tilly'],
  tilly: ['bram'],
  aveline: ['petra', 'mira', 'hobb'],
  mira: ['aveline', 'elda'],
  hobb: ['wenna', 'sabeth'],
  wenna: ['hobb', 'sabeth'],
  rowan: ['wys', 'hess'],
  wys: ['rowan', 'hess'],
  hess: ['tansy', 'rowan'],
  corran: ['pip', 'hobb'],
  tansy: ['tobias', 'hess'],
  pip: ['elda', 'tansy'],
  sabeth: ['hess', 'wenna'],
  alder: ['petra', 'elda'],
  tobias: ['tansy'],
  elda: ['sabeth', 'pip'],
  garrick: ['alder', 'elda'],
  petra: ['alder', 'wenna'],
  // Lyra's own missions are hers alone (her lessons, her waystone, her oath): they close
  // with her (missions/system.js); a step that waits on a word to her passes.
  lyra: [],
};

// What Lyra leaves (round 14b): her trunk at the chandlery goes to her mother.
export const KEEPSAKES = { lyra: { trunk: 'wenna' } };

// Who might know Maren's story when Sister Aveline is gone (her pupil, her Sunday friend).
export const MAREN_KEEPERS = ['petra', 'mira', 'elda', 'hobb'];

// Where a body can be hidden: the lake gives it back after days, the deep woods keep it
// until a search or a hunter stumbles on it, the ruins keep it.
export const HIDE = {
  lake: { label: (n) => `Sink ${n} in the lake`, returnDays: [2, 4] },
  woods: { label: (n) => `Hide ${n} in the undergrowth`, findChance: { tracker: 0.5, other: 0.18 }, hunterDaily: 0.12 },
  ruins: { label: (n) => `Leave ${n} in the ruins` },
  stream: { label: (n) => `Leave ${n} in the stream` },
};
const DEEP_WOODS_TY = 24; // whisperwood north of this row is deep: nobody walks it on an errand

// What kind of hiding place the point (x, y) is, or null for the open ground.
export function hidingPlace(game, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const map = game?.map;
  const L = game?.locations;
  const inLoc = (id) => {
    const b = L?.get?.(id)?.bounds;
    return !!b && tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  };
  // Water within a step of the player: the lake if it is Mirror Lake, else the stream.
  let water = null;
  for (let dy = -1; dy <= 1 && !water; dy++) {
    for (let dx = -1; dx <= 1 && !water; dx++) {
      try {
        if (map?.isWater?.(tx + dx, ty + dy)) water = { tx: tx + dx, ty: ty + dy };
      } catch {
        /* no map */
      }
    }
  }
  if (water) {
    const b = L?.get?.('mirror_lake')?.bounds;
    const lake = !!b && water.tx >= b.x && water.ty >= b.y && water.tx < b.x + b.w && water.ty < b.y + b.h;
    return { kind: lake ? 'lake' : 'stream', x: water.tx * TILE + TILE / 2, y: water.ty * TILE + TILE / 2, place: lake ? 'mirror_lake' : null };
  }
  if (inLoc('sunken_ruins')) return { kind: 'ruins', x, y, place: 'sunken_ruins' };
  if ((inLoc('whisperwood') || inLoc('moonpetal_glade')) && ty < DEEP_WOODS_TY && !inLoc('wenna_hives')) return { kind: 'woods', x, y, place: 'whisperwood' };
  return null;
}

// The chapel yard: the quiet lawn behind the chapel (north of its altar wall), then the
// grass on its east side. Tile offsets from the chapel's north-west corner; a grave never
// goes on a path, a wall or anything standing.
export const GRAVE_SPOTS = [
  [2, -2],
  [4, -2],
  [6, -2],
  [8, -2],
  [10, -2],
  [2, -4],
  [4, -4],
  [6, -4],
  [8, -4],
  [10, -4],
  [13, 1],
  [15, 1],
  [13, 3],
  [15, 3],
  [17, 1],
  [17, 3],
  [13, 5],
  [15, 5],
];
