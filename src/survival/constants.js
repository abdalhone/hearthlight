// Numbers and rosters for falling, rescue and death (DESIGN §27). Plain data so the
// tests, the UI and the other systems read the same values.

// Bleed-out windows, in game seconds (one per real second at normal speed).
export const PLAYER_WINDOW = 75; // §27: Resolve lengthens it (game.stats 'bleedout')
export const BERSERK_WINDOW = 30; // §25: the heart gives out at the end of berserk
export const LYRA_WINDOW = 90;
export const VILLAGER_WINDOW = 75;

// How fast the window drains, by what is happening to the fallen.
export const RATE = Object.freeze({
  alone: 1,
  crawling: 1.6, // dragging yourself along opens the wound
  stanched: 0.5, // someone kneels and presses on it
  carried: 0.6, // held tight on someone's shoulders
  water: 1.8, // cold water steals warmth fast
});

export const CRAWL_SPEED = 9; // px per second
export const CRAWL_BUDGET = 72; // px: "a little" (four and a half tiles)
export const CALL_COOLDOWN = 3; // seconds between shouts
export const CALL_RADIUS = 360; // px a shout for help carries
export const SEE_RADIUS = 160; // px within which people see someone fall
export const LYRA_HEARS = 1000; // px: she keeps an eye on the stranger she travels with
export const LYRA_HEARS_APART = 480; // px: once she has cut them off, only her ears
export const GUARD_HEARS_WANTED = 1400; // px: the watch is already looking for them
export const ASLEEP_EAR = 0.35; // a sleeper hears a shout this much less far

// Slow motion when the player falls (real seconds).
export const SLOWMO_SCALE = 0.22;
export const SLOWMO_HOLD = 0.45;
export const SLOWMO_RAMP = 1.4;

// Rescue.
export const ARRIVE_DIST = 14; // px from the fallen to kneel
export const REVIVE_SECONDS = 2.6; // kneeling with salve or warmth
export const LIFT_SECONDS = 1.1; // getting someone onto your shoulders
export const LAY_SECONDS = 1.2; // laying them on a cot
export const RUN = 1.55; // speed multiplier running to the fallen
export const CARRY_SPEED = 0.6; // speed multiplier while carrying
export const DANGER_RADIUS = 90; // a hostile this close to the fallen means a fight first
export const STUCK_TELEPORT = 4; // seconds stuck off screen before a rescuer is moved on

// Who does what (LORE §6). Mira has the salves; carriers are strong enough to carry a
// grown body across the village; tenders kneel, press on the wound and shout for help;
// children run for someone who can carry.
export const REVIVERS = new Set(['mira']);
export const CARRIERS = new Set(['rowan', 'wys', 'hess', 'bram', 'tilly', 'tobias', 'garrick', 'sabeth']);
export const TENDERS = new Set(['elda', 'aveline', 'hobb', 'wenna', 'petra', 'corran', 'alder']);
export const FETCHERS = new Set(['pip', 'tansy']);
export const FIGHTERS = new Set(['rowan', 'wys', 'hess']);
export const MAX_ROLE = Object.freeze({ revive: 1, carry: 2, tend: 2, fetch: 1 });

// Places of healing, nearest free first; the cell when the watch carries someone wanted.
export const SICKBEDS = ['sickbed_1', 'sickbed_2', 'infirmary_cot'];
export const CELL_BED = 'cell_cot';

// After a rescue.
export const TENDED_HOURS = 6; // wake this many hours later in the sickroom
export const TENDED_HP = 0.6;
export const MIRA_BILL = 15;
export const MIRA_SALVE = 8; // reviving on the spot costs less than a night's tending
export const WARMTH_HP = 0.28; // Lyra's lent warmth gets you up, barely
export const WARMTH_COST = 0.25; // of her own max HP (lamp-chill)
export const SALVE_HP = 0.4;
export const POTION_REVIVE_HP = 0.45;
export const PATIENT_SECONDS = 75; // someone the player carried in rests this long
export const OUT_FOR_A_DAY = 900; // game seconds: nobody came in time

// Death.
export const FLAME_PRICE = 60;
export const FLAME_COIN_LOSS = 0.4;
export const HOME_COIN_LOSS = 0.1;
export const HOME_WAKE_HP = 0.5;
export const FLAME_WAKE_HP = 0.5;
export const PAST_LIVES_KEY = 'hearthlight.pastlives.v1';
export const PAST_LIVES_MAX = 12;

// Weakness after a fall, as multipliers on the player (DESIGN §26's pipeline when present).
export const CONDITIONS = Object.freeze({
  bruised: { label: 'Bruised', seconds: 300, atk: 0.85, speed: 0.92, hpCap: 0.7, text: 'Back on your feet, barely. Hits harder on you; you hit softer.' },
  mending: { label: 'Mending', seconds: 900, atk: 0.85, speed: 0.9, hpCap: 0.8, text: "Mira's stitches pull. A day before you are yourself again." },
  flame_thin: { label: 'Flame-thin', seconds: 900, atk: 0.75, speed: 0.88, hpCap: 0.65, text: 'You died this morning. Something of you has not come back yet.' },
});

export const DEATH_MODES = Object.freeze(['final', 'home']);
