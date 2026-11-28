// Pure formatting and data-shaping helpers for the UI. No DOM access here, so the
// logic is unit-tested under node (tests/ui.test.mjs).

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

export function fmtInt(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? `-${s}` : s;
}

// "42/60" with both sides rounded up so a sliver of health never reads as 0.
export function hpText(hp, max) {
  const h = Math.max(0, Math.ceil(Number(hp) || 0));
  const m = Math.max(1, Math.ceil(Number(max) || 1));
  return `${Math.min(h, m)}/${m}`;
}

// Fraction for a bar, safe against zero / missing maxima.
export function frac(v, max) {
  const m = Number(max);
  if (!(m > 0)) return 0;
  return clamp01((Number(v) || 0) / m);
}

// Percentage string for CSS widths, quantized to whole percents so the DOM is only
// touched when the visible bar actually changes.
export function pctStr(v, max) {
  return `${Math.round(frac(v, max) * 100)}%`;
}

export function truncate(text, n = 80) {
  const s = String(text ?? '');
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export function capitalize(s) {
  const t = String(s ?? '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// Bytes as a short human label: 812 B, 12.4 KB, 1.2 MB.
export function bytesLabel(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// UTF-8 byte length of a string without TextEncoder (works everywhere, no allocation).
export function utf8Bytes(str) {
  const s = String(str ?? '');
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// Importance 1..10 -> 1..5 filled stars.
export function importanceStars(importance) {
  const v = Number(importance) || 1;
  return Math.max(1, Math.min(5, Math.round(v / 2)));
}

export function starString(importance) {
  const n = importanceStars(importance);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// "today", "yesterday", or "Day 3" relative to the current day.
export function dayLabel(day, today) {
  const d = Math.floor(Number(day) || 0);
  const t = Math.floor(Number(today) || 0);
  if (!d) return 'Before you met';
  if (t && d === t) return `Today · Day ${d}`;
  if (t && d === t - 1) return `Yesterday · Day ${d}`;
  return `Day ${d}`;
}

const STANCE_LABELS = { attack: 'attack mode', defend: 'defending', passive: 'passive', self_defense: 'defending herself' };
export function stanceLabel(stance) {
  return STANCE_LABELS[stance] || 'defending';
}

// The status line under Lyra's portrait: "following you · attack mode". The HUD shows
// the stance in its own badge, so it asks for the status alone (`bare`).
export function lyraStatusLine(status, stance, downed = false, bare = false) {
  if (downed) return 'knocked out · needs help';
  const s = String(status || '').trim() || 'nearby';
  return bare ? s : `${s} · ${stanceLabel(stance)}`;
}

// Weather + time of day -> icon key in icons.js.
export function weatherIconKey(type, isNight) {
  switch (type) {
    case 'rain':
      return 'rain';
    case 'fog':
      return 'fog';
    case 'cloudy':
      return isNight ? 'cloud_night' : 'cloud';
    default:
      return isNight ? 'moon' : 'sun';
  }
}

const WEATHER_WORDS = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog' };
export function weatherLabel(type, isNight) {
  if ((type === 'clear' || !type) && isNight) return 'Starlit';
  return WEATHER_WORDS[type] || 'Clear';
}

// Which game-drawn face (src/art/faces_art.js) shows a mood (round 15, item 2: never the
// phone's own emoji). The mind names its mood (emotions.js `mood().face`); a label from
// anywhere else (a villager's chat mood, an old save) is read by its words. Nothing known:
// 'neutral', never a delighted default.
export const MOOD_FACE = Object.freeze({
  delighted: 'delighted',
  cheerful: 'delighted',
  happy: 'happy',
  lively: 'lively',
  content: 'content',
  calm: 'calm',
  'at ease': 'calm',
  relieved: 'relieved',
  affectionate: 'affectionate',
  fascinated: 'fascinated',
  curious: 'curious',
  proud: 'proud',
  flustered: 'flustered',
  startled: 'startled',
  shocked: 'shocked',
  horrified: 'terrified',
  terrified: 'terrified',
  afraid: 'afraid',
  shaken: 'afraid',
  uneasy: 'uneasy',
  'on edge': 'on_edge',
  restless: 'restless',
  troubled: 'uneasy',
  wary: 'uneasy',
  guarded: 'guarded',
  sad: 'sad',
  gloomy: 'sad',
  'heavy-hearted': 'sad',
  heartsick: 'heartsick',
  grieving: 'grieving',
  hurt: 'hurt',
  miserable: 'miserable',
  distressed: 'distressed',
  angry: 'angry',
  furious: 'furious',
  cold: 'cold',
  exhausted: 'exhausted',
  starving: 'starving',
  neutral: 'neutral',
  quiet: 'blank',
});
const MOOD_WORDS = [
  [/terrif|horrif|panic/, 'terrified'],
  [/shock|aghast/, 'shocked'],
  [/fear|afraid|scared|anxious|nervous|worried|frighten/, 'afraid'],
  [/uneasy|tense|wary|troubl/, 'uneasy'],
  [/griev|mourn|bereav/, 'grieving'],
  [/heartbr|heartsick|weep|tear/, 'heartsick'],
  [/sad|melanch|gloom|lonely|wistful|low/, 'sad'],
  [/furious|rage|livid/, 'furious'],
  [/anger|angry|irritat|annoy|frustrat|cross/, 'angry'],
  [/cold|hostile|bitter/, 'cold'],
  [/hurt|wounded|pain/, 'hurt'],
  [/love|affection|tender|fond|warm/, 'affectionate'],
  [/joy|happy|cheer|elat|delight|playful|giddy|glad/, 'happy'],
  [/content|peace|serene|relax|calm/, 'calm'],
  [/proud|confident|triumph/, 'proud'],
  [/curious|intrigued|wonder/, 'curious'],
  [/surprise|startl|amazed/, 'startled'],
  [/tired|sleepy|exhaust|weary|drained/, 'exhausted'],
  [/embarrass|flustered|shy/, 'flustered'],
  [/hungry|starv/, 'starving'],
  [/bored|flat|guarded/, 'guarded'],
];

export function moodFace(mood) {
  if (mood && typeof mood === 'object' && typeof mood.face === 'string' && mood.face) return mood.face;
  const label = String((mood && typeof mood === 'object' ? mood.label : mood) || '')
    .toLowerCase()
    .trim();
  if (!label) return 'neutral';
  if (MOOD_FACE[label]) return MOOD_FACE[label];
  for (const [re, f] of MOOD_WORDS) if (re.test(label)) return f;
  return 'neutral';
}

// A villager's face toward you by where they stand with you (opinion level key).
export const STANDING_FACE = Object.freeze({ fond: 'happy', friendly: 'content', neutral: 'neutral', wary: 'uneasy', hostile: 'angry' });
export function standingFace(key) {
  return STANDING_FACE[key] || 'neutral';
}

// Pick the portrait expression that best shows how she feels right now.
// Strong emotions win; otherwise low energy reads as sleepy; otherwise the mood's valence.
export function moodToExpression(mood, emotions, needs) {
  const em = emotions && typeof emotions === 'object' ? emotions : {};
  const ranked = [
    ['anger', 'angry'],
    ['fear', 'worried'],
    ['sadness', 'sad'],
    ['surprise', 'surprised'],
    ['affection', 'love'],
    ['joy', 'happy'],
    ['embarrassment', 'worried'],
  ];
  let best = null;
  let bestV = 0.42;
  for (const [k, expr] of ranked) {
    const v = Number(em[k]) || 0;
    if (v > bestV) {
      bestV = v;
      best = expr;
    }
  }
  if (best) return best;
  const energy = needs && typeof needs === 'object' ? Number(needs.energy) : NaN;
  if (Number.isFinite(energy) && energy < 0.22) return 'sleepy';
  const label = String(mood?.label || '').toLowerCase();
  if (/tired|sleepy|weary|exhaust/.test(label)) return 'sleepy';
  const val = Number(mood?.valence);
  if (Number.isFinite(val)) {
    if (val > 0.35) return 'happy';
    if (val < -0.45) return 'sad';
    if (val < -0.2) return 'worried';
  }
  return 'neutral';
}

// Bond level 0..5 -> pips "●●●○○" style counts are drawn in CSS; this names them.
export const BOND_LABELS = ['Stranger', 'Acquaintance', 'Companion', 'Friend', 'Close friend', 'Kindred spirit'];
export function bondLabel(level) {
  const l = Math.max(0, Math.min(5, Math.round(Number(level) || 0)));
  return BOND_LABELS[l];
}

// Affinity -100..100 in words, for the People tab.
export function affinityWords(a) {
  const v = Number(a) || 0;
  if (v >= 70) return 'adores';
  if (v >= 40) return 'is fond of';
  if (v >= 15) return 'likes';
  if (v > -15) return 'feels neutral about';
  if (v > -40) return 'is wary of';
  if (v > -70) return 'dislikes';
  return 'despises';
}

// Return the array a store exposes, whatever it calls it. Mind stores are written
// in parallel by another module, so the UI accepts the common shapes.
export function listFrom(store, names = ['all', 'list', 'entries', 'items']) {
  if (!store) return [];
  if (Array.isArray(store)) return store;
  if (store instanceof Map) return [...store.values()];
  for (const n of names) {
    const v = store[n];
    if (typeof v === 'function') {
      try {
        const r = v.call(store);
        if (Array.isArray(r)) return r;
        if (r && typeof r[Symbol.iterator] === 'function') return [...r];
      } catch {
        /* try the next shape */
      }
    } else if (Array.isArray(v)) return v;
    else if (v instanceof Map) return [...v.values()];
  }
  return [];
}

// Memories matching a search query (words must all appear somewhere in the entry),
// newest first. Searches text, tags, people and place.
export function filterMemories(list, query = '') {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const m of list || []) {
    if (!m || !m.text) continue;
    if (words.length) {
      const hay = [m.text, ...(m.tags || []), ...(m.about || []), m.location || '', m.type || '']
        .join(' ')
        .toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(m);
  }
  out.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0) || (Number(b.day) || 0) - (Number(a.day) || 0));
  return out;
}

// [{day, items}] with the newest day first; entries keep their incoming order.
export function groupByDay(list) {
  const map = new Map();
  for (const m of list || []) {
    const d = Math.floor(Number(m?.day) || 0);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(m);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([day, items]) => ({ day, items }));
}

const TYPE_ORDER = { potion: 0, food: 1, gift: 2, material: 3, weapon: 4, gear: 4, tool: 5, key: 6, quest: 7, letter: 7, currency: 8 };
// Inventory list order: useful things first, then by name.
export function sortItems(list) {
  return [...(list || [])].sort((a, b) => {
    const ta = TYPE_ORDER[a.def?.type] ?? 9;
    const tb = TYPE_ORDER[b.def?.type] ?? 9;
    if (ta !== tb) return ta - tb;
    return String(a.def?.name || a.id).localeCompare(String(b.def?.name || b.id));
  });
}

// Items the player may offer as gifts (no coins, keys or quest items).
export function isGiftable(def) {
  if (!def) return false;
  return !['currency', 'key', 'quest', 'letter'].includes(def.type);
}

export function isUsable(def) {
  return !!def && (def.type === 'food' || def.type === 'potion') && Number(def.heal) > 0;
}

// Short stable hash of a string (FNV-1a, 32 bit), as 8 hex digits.
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Pitch multiplier for a speaker's dialog blips, stable per speaker.
export function voicePitch(id) {
  const h = parseInt(hash32(id).slice(0, 4), 16) / 0xffff;
  return 0.8 + h * 0.45;
}

// Join a toast for repeated pickups: "+5 Wood".
export function gainText(qty, name) {
  const q = Math.max(1, Math.round(Number(qty) || 1));
  return `+${q} ${name}`;
}

// Escape-free safe text for attributes / labels: collapse whitespace, cap length.
export function cleanLine(text, n = 400) {
  return truncate(String(text ?? '').replace(/\s+/g, ' ').trim(), n);
}

// Normalize a list editor's text ("a, b\nc") into a trimmed list.
export function parseList(text) {
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24);
}

export function listToText(list) {
  return (Array.isArray(list) ? list : []).map((s) => (typeof s === 'string' ? s : s?.text || '')).filter(Boolean).join('\n');
}
