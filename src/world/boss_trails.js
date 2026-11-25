import { TILE } from '../core/constants.js';

// Bosses you can find (DESIGN §32.4, round 14: "the first boss, it's really hard to get.
// Before I didn't see any bosses. I just walked around and saw them."). Every boss now
// leaves a trail you can follow before you ever meet it:
//   - people talk: the villagers who would know say so ("Heard anything out there?");
//   - the notice board warns of three of them from the first morning;
//   - the world shows it: slime smears up the quarry trail, claw-scored trunks on the
//     way to the den, the bandits' toll board on the shore trail, the dock that thrums at
//     night, bones scattered at the ruins gate (look at one and you know what it means);
//   - and once you have heard of a boss it has a mark on your map (ui/world_map.js), the
//     first one (the Mother of Slimes, the nearest and the slowest) from the first day.
// The hearing itself lives in game.travel (travel.js: hear / known); this module holds
// what is said and where the signs stand, and decides when a boss becomes known.

export const FIRST_BOSS = 'mother_of_slimes';

export const TRAILS = {
  mother_of_slimes: {
    name: 'The Mother of Slimes',
    where: "the deepest rain-pool in Stonecut Quarry, up the quarry trail from Reed Farm",
    place: 'stonecut_quarry',
    signs: [
      [30, 51],
      [28, 42],
      [26, 34],
      [22, 25],
    ],
    sign: { objType: 'trail_slime', name: 'Slime trail', text: "A smear of glistening slime as wide as a cart, dragged up the quarry trail and back. Whatever made it is far bigger than the slimes in the shallows. It came from the quarry's deepest rain-pool." },
    tellers: {
      tilly: "There's a SLIME in the quarry the size of a CART. I named it the Mother. The deepest pool, up the trail past the farm. Da won't let me go.",
      bram: "Hmph. Something big in the quarry's deep pool. Ate my ore-cart's wheel. The quarry trail, past Reed Farm.",
      tansy: "Slime trails on the quarry trail every morning now. Big ones. Up past our north field. Dad says don't. I say don't too.",
      tobias: "Something drags itself down from the quarry at night and back by morning. You can see the trail it leaves. I don't go up there any more.",
    },
  },
  varek: {
    name: 'Varek One-Eye',
    where: "the bandit camp on the hill north-east of Mirror Lake, up the shore trail past the dock",
    place: 'bandit_camp',
    signs: [[118, 37]],
    sign: { objType: 'sign', name: 'Toll board', text: 'A board nailed to a pine on the shore trail, in a careful hand: "TOLL. Pay at the hill. No one is hurt who pays." Under it, a knot of grey wool. The camp is up the trail, on the hill above the lake.' },
    tellers: {
      rowan: "Varek One-Eye and his crew. The camp's on the hill north-east of the lake, up the shore trail past Corran's dock. Do not go up there on your own.",
      wys: 'The bandits! On the hill past the lake! I have their camp circled on the map. Three times. Citizen.',
      garrick: "The toll on the hill. Polite robbery, but robbery. Their camp's up the shore trail, past the dock. One eye, that one, and he never misses with it.",
      elda: "Rowan's bandits are up on the hill past the lake, love. They come down for the road, not for us. So far.",
    },
  },
  greyjaw: {
    name: 'Greyjaw',
    where: 'a den in the deep wood north of Berry Hollow, in Whisperwood; it hunts only after dark',
    place: 'whisperwood',
    signs: [
      [103, 18],
      [100, 12],
    ],
    sign: { objType: 'trail_claws', name: 'Scored trunk', text: "Four claw-gouges in the bark, higher than your head, and grey hair caught in the sap. Something marks this trail as its own. The marks run north, toward a den past Berry Hollow. Hess says it only hunts after dark." },
    tellers: {
      hess: "A grey wolf, big as a pony. Its den's in the deep wood north of Berry Hollow. Only hunts after dark. Its claw marks are on the trees along the trail; read them and turn round.",
      tobias: "Lost two ewes this month. Hess says it's the grey one, up past Berry Hollow. Comes out at night.",
      rowan: "Hess has a grey wolf north of Berry Hollow. If she says it's big, it's big. Not at night.",
      pip: "There's a WOLF in the wood that's as big as a HORSE and it's grey and it only comes out at NIGHT. Hess saw it. North of the berry bushes.",
    },
  },
  lakes_hum: {
    name: "The Lake's Hum",
    where: 'under the island in the middle of Mirror Lake, off the end of the dock',
    place: 'mirror_lake',
    signs: [[121, 51]],
    sign: { objType: 'trail_hum', name: 'Humming planks', text: 'The end of the dock thrums under your boots, a note too low to hear, only feel. It comes from the water round the island, and the fish have gone from it.' },
    tellers: {
      corran: "Lake's been humming at night. Round the island. Fish won't bite within a cast of it. Something's down there.",
      elda: "Corran says the lake hums round the island at night. Corran says a lot of things. But he's stopped fishing there.",
      pip: 'The lake SINGS at night! By the island! Corran says don\'t listen. I listened.',
      mira: "The lake-wort by the island has gone black at the roots. Something in the water there is wrong.",
    },
  },
  bone_warden: {
    name: 'The Bone Warden',
    where: "the lower hall of the Sunken Ruins, south-west of Reed Farm, behind the iron-bound gate",
    place: 'sunken_ruins',
    signs: [
      [21, 89],
      [28, 90],
    ],
    sign: { objType: 'trail_bones', name: 'Scattered bones', text: "Bones by the ruins gate, old and dry, and some not so old. Things walk in the ruins' halls, and something at the bottom of the stair keeps them walking." },
    tellers: {
      aveline: 'The Sunken Ruins. Things walk the lower hall, and something at the bottom of the stair keeps them walking. The gate is south-west of the farm. Not after dark.',
      mira: "Skeletons in the ruins, and something below them. Aveline won't say what. South-west of the farm, by the marsh.",
      petra: "The ruins, duckling. South-west, past the farm. They took Maren. Something at the bottom keeps the dead on their feet.",
    },
  },
};

// What villagers say of the roads beyond the vale (once they have told you their boss).
export const ROAD_TALK = {
  garrick: "West, the King's Road runs past a dead waystone and the Long Mile, which still burns, to a fork: Saltmere one way, Brindlecombe the other. East it bends round the lake to the Cinderwick fork. Mind the hill above it.",
  hess: "The Crown path starts at the heart of Whisperwood and climbs a day and a half to the ring. Camp at the treeline, by the tarn; my lean-to's still there. Not at night. Not without a candle.",
  petra: "Brindlecombe. A day and a half west, past the fork. Doors still open. Don't go in the houses, duckling. Or do, and come back and tell me.",
  sabeth: 'Brindlecombe. West, past the Long Mile, up the old lane at the fork. I have not been back. I will not go back.',
  hobb: "The waystones. One in three still burns. The Long Mile does, west, and the fork's, east; you can sleep under those. The one a mile out was dead till Lyra lit it.",
  corran: "Road round the lake goes up to the fork. Carters sleep under the burning stone there. North of it, the Owlsend track. Nobody's come down it since midsummer.",
  rowan: "Past the fork the bandits watch both roads from a lookout on the hill. If you go east, go by day.",
  elda: "Carters from Cinderwick used to stop at the fork and come on here for supper. The oil track's buried now. I miss the gossip.",
  alder: "Brindlecombe is a dead village. There is nothing there for you. Leave it.",
  tobias: "The road west's bad past the ford. Turned boars on the heath. I'd not go without Hess.",
  tansy: "Hess took me to the Long Mile once. The stone burns. You can feel it on your face. Then we came straight back.",
  wenna: 'The mountain gives and the mountain takes, and it never gives for nothing. That is all I will say of the Hollowcrown.',
  bram: "Cinderwick oil. Best there is. The track's buried in shale since spring, east past the fork.",
  aveline: 'The Crown Ring is where they found you. Lyra and Hess. Up the Crown path, above the trees. Nine stones.',
  wys: 'There is a LOOKOUT on the hill above the fork. I have marked it. On the map. Citizen.',
  mira: 'Moonpetals grow at a marker stone up the Crown path, in the deep wood. Bring me some, if you go.',
  pip: 'The Crown Ring is where you FELL OUT OF THE SKY. Tilly says. It\'s up the mountain. Can I come?',
  tilly: "Cinderwick's got a fire that's been burning two hundred years. TWO HUNDRED. East past the fork. I'm going one day.",
};

// Every boss's arena center in world px (worldgen's spawns.bosses, else the boss def).
export function bossPoint(game, id) {
  const w = game?.spawns?.bosses?.[id] || game?.world?.spawns?.bosses?.[id];
  if (w?.center) return { x: w.center.x, y: w.center.y };
  try {
    const a = game?.bosses?.arenaFor?.(id);
    if (a) return { x: a.x, y: a.y };
  } catch {
    /* no boss manager */
  }
  return null;
}

// Map marks for the bosses you have heard of.
export function bossMarks(game) {
  const t = game?.travel;
  if (!t) return [];
  const out = [];
  for (const id of Object.keys(TRAILS)) {
    if (!t.known(id)) continue;
    const pt = bossPoint(game, id);
    if (!pt) continue;
    const slain = !!(game.bosses?.isDefeated?.(id) || game.flags?.[`boss_${id}_defeated`] || game.flags?.[`${id}_defeated`]);
    out.push({ kind: 'boss', id, x: pt.x, y: pt.y, label: TRAILS[id].name, slain });
  }
  return out;
}

// The trail signs the world builds into the vale (worldgen.js calls this).
export function trailSigns() {
  const out = [];
  for (const [boss, T] of Object.entries(TRAILS)) {
    T.signs.forEach(([tx, ty], k) => out.push({ boss, tx, ty, id: `trail_${boss}_${k + 1}`, ...T.sign }));
  }
  return out;
}

// The rumor a villager tells when asked "Heard anything out there?": the first boss of
// theirs you have not heard of (and it goes on your map), else the roads beyond the vale.
export function rumorFor(game, npcId) {
  const t = game?.travel;
  for (const [id, T] of Object.entries(TRAILS)) {
    const line = T.tellers[npcId];
    if (!line || t?.known(id)) continue;
    t?.hear(id, npcId);
    return { lines: [line, `(Marked on your map: ${T.name}.)`], boss: id };
  }
  if (ROAD_TALK[npcId]) return { lines: [ROAD_TALK[npcId]], boss: null };
  for (const [id, T] of Object.entries(TRAILS)) if (T.tellers[npcId]) return { lines: [T.tellers[npcId]], boss: id };
  return null;
}

export function hasRumor(npcId) {
  return !!ROAD_TALK[npcId] || Object.values(TRAILS).some((T) => !!T.tellers[npcId]);
}

// Hooks into the world's events: what you read and look at, missions offered, places
// seen. Installed by travel.js's plugin.
export function onTrailEvent(game, type, p) {
  const t = game?.travel;
  if (!t) return;
  if (type === 'object_looked' || type === 'sign_read') {
    const o = p?.obj || p?.sign;
    if (!o) return;
    if (o.trailBoss && t.hear(o.trailBoss, 'sign')) note(game, o.trailBoss);
    // The notice board warns of the quarry pools, the camp and the ruins.
    if (o.id === 'notice_board') {
      let n = 0;
      for (const id of ['mother_of_slimes', 'varek', 'bone_warden']) if (t.hear(id, 'board')) n++;
      if (n) toast(game, 'Marked on your map: what the notice board warns of (N, or Menu → Map).');
    }
  } else if (type === 'mission_offered' || type === 'mission_accepted') {
    const m = game.missions?.get?.(p?.id || p?.mission?.id);
    for (const o of m?.objectives || []) {
      const tg = String(o.target || '');
      if (tg.startsWith('boss:') && t.hear(tg.slice(5), 'mission')) note(game, tg.slice(5));
    }
  } else if (type === 'mission_completed') {
    // After the first lesson the village starts talking about the Mother of Slimes.
    if ((p?.id || p?.mission?.id) === 'first_spark' && t.hear(FIRST_BOSS, 'village')) note(game, FIRST_BOSS, true);
  }
}

// Seeing an arena from close by is hearing of it too (every half second or so).
export function checkSight(game) {
  const t = game?.travel;
  const pl = game?.player;
  if (!t || !pl) return;
  for (const id of Object.keys(TRAILS)) {
    if (t.known(id)) continue;
    const pt = bossPoint(game, id);
    if (pt && Math.hypot(pt.x - pl.x, pt.y - pl.y) < 14 * TILE && t.hear(id, 'seen')) note(game, id);
  }
}

function note(game, id, first = false) {
  const T = TRAILS[id];
  if (!T) return;
  toast(game, first ? `The village is talking about ${T.name}: ${T.where}. Marked on your map.` : `Marked on your map: ${T.name}, ${T.where}.`);
}

function toast(game, text) {
  try {
    game.ui?.toast?.(text, 'quest');
  } catch {
    /* ui optional */
  }
}
