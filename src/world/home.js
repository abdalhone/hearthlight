// Finding home (r13; the author: "I'm not able to find my bed"): the player's own bed in
// the Wayhouse, where it is from anywhere in words, and the questions that ask for it.
// Pure apart from reading game.objects / game.locations; used by the Home pointer
// (src/ui/home_pointer.js), Lyra (src/ai/plugins/home_plugin.js) and the villagers
// (src/ai/social/player_talk.js), so all of them say the same thing.

import { TILE } from '../core/constants.js';

export const HOME_BED_ID = 'home_bed';
export const HOME_ID = 'player_home';

// The player's bed (the one marked "Your bed"), or null in a world without one.
export function homeBed(game) {
  const objs = game?.objects;
  if (!objs) return null;
  let b = null;
  try {
    b = objs.get?.(HOME_BED_ID) || null;
  } catch {
    b = null;
  }
  if (b && !b.removed) return b;
  const list = objs.list || [];
  for (const o of list) if (o && !o.removed && o.objType === 'bed' && o.owner === 'player') return o;
  return null;
}

// "where is my bed", "where do I sleep", "how do I get home", "I can't find my bed"…
const ASK = [
  /\bwhere(?:'s| is| are|abouts is)? (?:my|our|the stranger's|your guest's) (?:bed|room|house|home|cottage|place|wayhouse)\b/i,
  /\bwhere(?:'s| is) (?:the )?(?:wayhouse|way house)\b/i,
  /\bwhere (?:do|did|can|should|am) i (?:sleep|live|stay|rest|supposed to sleep|meant to sleep|lay my head)\b/i,
  /\bwhere (?:is|'s) (?:home|my home)\b/i,
  /\b(?:how|which way) (?:do|can|would) i (?:get|go|find my way|walk) (?:back )?(?:home|to (?:my|our) (?:bed|house|cottage|room|home)|to the wayhouse)\b/i,
  /\b(?:can'?t|cannot|can not|could(?:n'?t| not)|don'?t know|do not know) (?:find|see|remember|where) (?:is )?(?:my|our) (?:bed|room|house|home|cottage|way home)\b/i,
  /\bi(?:'m| am) lost\b.*\b(?:home|bed)\b|\b(?:home|bed)\b.*\bi(?:'m| am) lost\b/i,
  /\b(?:show|tell|take|lead|walk) me (?:the way )?(?:home|to (?:my|our) (?:bed|house|cottage|room|home))\b/i,
  /\bwhich (?:bed|one) is mine\b/i,
  /\bwhere can i (?:sleep|rest|lie down)\b/i,
];

export function asksForHome(text) {
  const t = String(text || '').replace(/[’‘]/g, "'");
  return ASK.some((re) => re.test(t));
}

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
// Screen y grows downward (south).
export function compass(dx, dy) {
  if (!dx && !dy) return 'here';
  const a = Math.atan2(dy, dx);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return DIRS[i];
}

// What anyone can say about the way there, from `from` ({x, y}; the asker or the player).
// { ok, inside, near, dir, tiles, place, line } — `line` is the plain fact, in no voice.
export function homeFacts(game, from = game?.player) {
  const bed = homeBed(game);
  if (!bed) return { ok: false };
  const home = game?.locations?.get?.(HOME_ID) || null;
  const place = 'the Wayhouse';
  const f = from || bed;
  const here = safeAt(game, f.x, f.y);
  const inside = !!here && (here.id === HOME_ID || here.parent === HOME_ID);
  const c = home?.center || { x: bed.x, y: bed.y };
  const dx = c.x - f.x;
  const dy = c.y - f.y;
  const tiles = Math.round(Math.hypot(dx, dy) / TILE);
  const dir = compass(dx, dy);
  const near = tiles <= 6 ? 'right there' : tiles <= 14 ? 'a few steps' : tiles <= 40 ? 'a short walk' : 'across the village';
  // "a few steps north", "a short walk south-east", "north-west, across the village".
  const where = tiles <= 6 ? `right there to the ${dir}` : tiles <= 40 ? `${near} ${dir}` : `${dir}, across the village`;
  const bedWhere = 'the bed on the left as you come in, with your chest beside it';
  const line = inside ? `Your bed is right here in the Wayhouse: ${bedWhere}.` : `Your bed is in the Wayhouse, your cottage off the square's south-east corner, toward the road, with Hobb's lamp by the door: ${where} from here. Inside, it is ${bedWhere}.`;
  return { ok: true, bed, inside, dir, tiles, near, where, place, bedWhere, line };
}

function safeAt(game, x, y) {
  try {
    return game?.locations?.at?.(x, y) || null;
  } catch {
    return null;
  }
}

// The way home in someone's own words. who: 'lyra' or a villager id; `seed` varies it.
export function wayHomeLine(game, from, who = 'lyra', seed = 0) {
  const f = homeFacts(game, from);
  if (!f.ok) return null;
  if (who === 'lyra') {
    if (f.inside) return "You're standing in it. Yours is the bed on the left as you come in, by the chest. Mine's the far one, and I'd like it to stay mine.";
    const pick = [
      `Your bed? In the Wayhouse, our cottage: ${f.where}. The thatched one with Hobb's lamp by the door. Yours is on the left as you come in, by the chest. Follow the mark.`,
      `The Wayhouse, ${f.where}. Hobb's lamp hangs by the door. Your bed's the one on the left, chest beside it. Follow the mark if you lose the lane.`,
    ];
    return pick[Math.abs(seed | 0) % pick.length];
  }
  if (f.inside) return 'You are in it. The bed on the left as you come in is yours.';
  const pick = [
    `The Wayhouse, ${f.where}: the thatched cottage off the square's south-east corner, Hobb's lamp by the door. Yours is the bed on the left as you go in.`,
    `You sleep at the Wayhouse. ${cap(f.where)}; look for the lamp Hobb hung by the door. Your bed is the left one, with a chest beside it.`,
    `Lost your way? The Wayhouse, ${f.where}. Thatched roof, a lamp by the door. The left-hand bed is yours.`,
  ];
  let h = Math.abs(seed | 0);
  for (const ch of String(who)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pick[h % pick.length];
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
