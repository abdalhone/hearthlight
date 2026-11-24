// Static data behind Lyra's own will (DESIGN §16): the deed table, how each kind of
// deed moves her feelings about the player, how she sorts requests, the work she can
// do for coin, and her long-term goals. Plain data so tests and the UI can read it.

// Deeds she can see the player do (§16.2). severity is the default; `kind` picks the
// feeling profile below; `violent` deeds feed the gone/left rules of §16.6; `grave`
// deeds are never cushioned by existing trust and never fade by themselves.
export const DEEDS = {
  protected_lyra: { severity: 2, kind: 'care', text: 'Cut down something that was hurting me.' },
  revived_lyra: { severity: 3, kind: 'care', text: 'Got me back on my feet when I was down.' },
  gift_liked: { severity: 1, kind: 'gift', text: 'Gave me something I liked.' },
  gift_loved: { severity: 2, kind: 'gift', text: 'Gave me something I love.' },
  gift_disliked: { severity: -1, kind: 'slight', text: 'Gave me something I can’t stand.' },
  kept_promise: { severity: 2, kind: 'honesty', text: 'Kept a promise.' },
  broke_promise: { severity: -2, kind: 'honesty', text: 'Broke a promise.' },
  respected_refusal: { severity: 1, kind: 'respect', text: 'Took my no for an answer.' },
  pushed_after_refusal: { severity: -1, kind: 'respect', text: 'Kept pushing after I said no.' },
  kindness: { severity: 1, kind: 'kindness', text: 'Was kind to someone who needed it.' },
  reckless_order: { severity: -1, kind: 'danger', text: 'Sent me into a fight that nearly finished me.' },
  hit_lyra_accident: { severity: -0.5, kind: 'danger', text: 'Clipped me with a sword in a fight.' },
  hit_lyra: { severity: -3, kind: 'violence', violent: true, grave: true, text: 'Struck me with a sword, and meant it.' },
  downed_lyra: { severity: -10, kind: 'violence', violent: true, grave: true, text: 'Knocked me out cold.' },
  abandoned_downed: { severity: -3, kind: 'betrayal', grave: true, text: 'Left me lying knocked out.' },
  killed_harmless: { severity: -1, kind: 'cruelty', text: 'Killed an animal that was no threat to anyone.' },
  attacked_villager: { severity: -3, kind: 'violence', violent: true, grave: true, text: 'Attacked one of the villagers.' },
  downed_villager: { severity: -5, kind: 'violence', violent: true, grave: true, text: 'Beat one of the villagers senseless.' },
  attacked_guard: { severity: -2, kind: 'violence', violent: true, text: 'Attacked one of the guard.' },
  stole: { severity: -2, kind: 'dishonesty', text: 'Stole.' },
  lied: { severity: -2, kind: 'dishonesty', text: 'Lied to me.' },
};

export const DEED_IDS = Object.keys(DEEDS);

// Per unit of severity. Negative deeds subtract trust/affinity/respect and add fear
// (scaled by neuroticism); positive deeds add and soothe fear.
export const DEED_KINDS = {
  care: { trust: 4.5, affinity: 3, respect: 1.5, fear: 3 },
  gift: { trust: 1.5, affinity: 3.5, respect: 0.3, fear: 1 },
  slight: { trust: 1, affinity: 3, respect: 0.5, fear: 0 },
  honesty: { trust: 4, affinity: 1.5, respect: 2, fear: 0 },
  respect: { trust: 2.5, affinity: 1, respect: 2.5, fear: 1 },
  kindness: { trust: 1.5, affinity: 2, respect: 2, fear: 0.5 },
  danger: { trust: 3, affinity: 1, respect: 1.5, fear: 2.5 },
  violence: { trust: 4.5, affinity: 3, respect: 2, fear: 6 },
  betrayal: { trust: 5, affinity: 3, respect: 2, fear: 2 },
  cruelty: { trust: 2, affinity: 3, respect: 3, fear: 1 },
  dishonesty: { trust: 5, affinity: 2, respect: 2.5, fear: 0 },
};

// Repeated good deeds of one kind count for less: window in game seconds.
export const DEED_REPEAT_WINDOW = {
  protected_lyra: 90,
  revived_lyra: 300,
  gift_liked: 900,
  gift_loved: 900,
  kindness: 900,
  respected_refusal: 300,
  kept_promise: 120,
};

export const HARMLESS_SPECIES = new Set(['rabbit', 'deer', 'chicken', 'cat']);
// Animals she will hunt for the pot when she agrees; hens belong to the farm, the cat to Pip.
export const GAME_SPECIES = new Set(['rabbit', 'deer']);
export const PET_SPECIES = new Set(['cat']);

// Where she runs when someone is the danger (§16.6): the guards, the inn, the chapel.
export const SAFE_PLACES = ['guardhouse', 'ember_kettle', 'chapel'];

export const STATES = ['together', 'wary', 'apart', 'left', 'gone'];

// Thresholds of §16.3, plus hysteresis so she does not flap between states.
export const T = {
  waryTrust: 25,
  waryFear: 35,
  calmTrust: 30, // wary -> together
  calmFear: 28,
  leftFear: 60,
  leftTrust: 10,
  amendsTrust: 35,
  amendsFear: 30,
  homeTrust: 50, // sleeps in the cottage
  homeFear: 20,
  startTrust: 32, // a new game: she owes the player her life, enough to travel together
};

// Request categories (§16.4) for every action of DESIGN §12 and §16.9.
export const ACTION_CATEGORY = {
  set_combat_mode: 'stance', // 'attack' is reclassified as risky combat
  attack: 'combat',
  bind: 'combat',
  guard: 'combat',
  patrol: 'combat',
  explore: 'combat',
  goto: 'move', // reclassified as risky when the place is dangerous
  start_job: 'work',
  stop_job: 'work_stop',
  follow: 'move',
  stay: 'move',
  wait: 'move',
  come_here: 'move',
  retreat: 'safe',
  flee: 'safe',
  keep_distance: 'safe',
  wait_outside: 'safe',
  free_will: 'free',
  emote: 'trivial',
  sit: 'trivial',
  open_door: 'trivial',
  close_door: 'trivial',
  pick_up: 'trivial',
  interact: 'trivial',
  warn: 'social',
  give_item: 'belongings',
  use_item: 'belongings',
  talk_to: 'social',
  sleep: 'sleep',
  rejoin: 'companionship',
  leave_player: 'companionship',
  set_plan: 'plan',
  set_relationship: 'opinion',
};

// Actions whose `amount` means nothing else, so a number there is coin offered.
export const AMOUNT_IS_PAY = new Set([
  'follow', 'stay', 'come_here', 'goto', 'set_combat_mode', 'attack', 'bind', 'patrol', 'explore',
  'talk_to', 'sleep', 'rejoin', 'set_plan', 'interact', 'pick_up', 'emote', 'sit', 'free_will', 'use_item',
]);

// What jobs feel like to her: a small like/dislike, and whether they are dull.
export const JOB_TASTE = {
  gather_herbs: { taste: 0.08, label: 'gathering herbs' },
  forage: { taste: 0.04, label: 'foraging' },
  cook: { taste: 0.05, label: 'cooking' },
  farm: { taste: 0, label: 'helping on the farm' },
  fish: { taste: -0.1, label: 'fishing', why: 'deep water' },
  chop_wood: { taste: -0.06, label: 'chopping wood', dull: true },
  mine_ore: { taste: -0.06, label: 'mining', dull: true },
  collect_loot: { taste: -0.04, label: 'collecting loot', dull: true },
  patrol: { taste: -0.02, label: 'patrolling' },
  guard: { taste: -0.02, label: 'standing guard' },
};

// Work she can do for coin in Hearthvale (DESIGN §10 jobs, §7 villagers).
export const COIN_JOBS = [
  { id: 'herbs_mira', job: 'gather_herbs', npc: 'mira', at: 'whisperwood', deliverAt: 'herbalist', items: ['herb', 'moonpetal'], rate: 3, amount: 5, pref: 1.0, label: 'gather herbs for Mira' },
  { id: 'farm_tobias', job: 'farm', npc: 'tobias', at: 'reed_farm', deliverAt: 'farmhouse', items: ['turnip', 'wheat'], rate: 2, amount: 6, pref: 0.85, label: 'help Tobias bring in his field' },
  { id: 'fish_elda', job: 'fish', npc: 'elda', at: 'mirror_lake', deliverAt: 'ember_kettle', items: ['raw_fish'], rate: 4, amount: 4, pref: 0.45, label: 'fish for Elda’s kitchen' },
  { id: 'wood_elda', job: 'chop_wood', npc: 'elda', at: 'whisperwood', deliverAt: 'ember_kettle', items: ['wood'], rate: 2, amount: 6, pref: 0.55, label: 'split firewood for the Kettle' },
  { id: 'ore_bram', job: 'mine_ore', npc: 'bram', at: 'stonecut_quarry', deliverAt: 'smithy', items: ['iron_ore', 'stone'], rate: 4, amount: 4, pref: 0.6, label: 'dig ore for Bram' },
];

// Her long-term goals (§16.1); weights drift with her situation (see agenda).
export const BASE_GOALS = [
  { id: 'survive', text: 'Stay alive', weight: 1 },
  { id: 'find_maren', text: 'Find Maren', weight: 0.9 },
  { id: 'protect_loved', text: 'Keep the people I love safe', weight: 0.7 },
  { id: 'earn_keep', text: 'Earn my keep', weight: 0.5 },
  { id: 'belong', text: 'Belong somewhere', weight: 0.5 },
  { id: 'grow_magic', text: 'Grow my magic', weight: 0.45 },
  { id: 'small_joys', text: 'Small joys: moonpetals, stars, honey cakes, rain on the roof', weight: 0.35 },
];

// Meals and rooms at the Ember Kettle.
export const PRICES = { meal: 5, honey_cake: 12, room: 6 };

// Gift tastes when the soul has none (2 loved, 1 liked, 0 polite, -1 disliked).
export const DEFAULT_GIFT_TASTES = {
  moonpetal: 2, honey_cake: 2, crystal: 1, lantern: 1, cooked_fish: 1, stew: 1, bread: 1, berries: 1, potion: 1,
  coin: 1, herb: 0, turnip: 0, wheat: 0, wood: 0, stone: 0, iron_ore: 0, iron_sword: 0,
  raw_fish: -1, slime_gel: -1, bone: -1, wolf_pelt: -1,
};

// Words that tie a request to Maren (her strongest goal).
export const MAREN_PLACES = new Set(['sunken_ruins', 'chapel']);
