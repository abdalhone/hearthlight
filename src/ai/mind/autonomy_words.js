import { resolveItemId, itemDef } from '../../entities/items.js';

// What the player's words mean for her will: apologies, promises, coin offers, a yes
// or a no to something she asked. Shared by the Autonomy (which hears every
// player_message) and the autonomy plugin's intents (which answer offline).

export const RE = {
  apology: /\b(?:i'?m|i am)\s+(?:so\s+|really\s+|truly\s+|very\s+|deeply\s+|terribly\s+)*sorry\b|\bforgive me\b|\bi apologi[sz]e\b|\bmy apologies\b|\bplease forgive\b|\bi was wrong\b/i,
  promise: /\bi (?:promise|swear)\b|\byou have my word\b|\bi give you my word\b/i,
  offer: /\b(?:i'?ll|i will|i can|let me|i'?d|i would|how about i)\s+(?:pay|give)\s+you\s+(\d{1,4})\s*(?:coins?|gold|silver)?\b/i,
  offer2: /\b(\d{1,4})\s*(?:coins?|gold|silver)\s+(?:if you|to|for)\b/i,
  yes: /^\s*(?:yes|yeah|yep|yup|ok|okay|sure|fine|deal|alright|all right|agreed|of course|i will|i can do that|you got it|absolutely|definitely|sounds good|i promise|will do)\b/i,
  no: /^\s*(?:no|nope|nah|not now|not today|maybe later|i can'?t|i won'?t|never|no way)\b/i,
  specifics: /\b(hit|hurt|struck|strike|sword|attack|knock|knocked|left you|leave you|abandon|lied|lie|steal|stole|promise|scared|frighten|bram|elda|pip|rowan|mira|tobias|aveline|garrick|cat|rabbit|deer)\b/i,
};

export function isApology(text) {
  return RE.apology.test(String(text || ''));
}

export function parseOffer(text) {
  const s = String(text || '');
  const m = s.match(RE.offer) || s.match(RE.offer2);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null;
}

const JOB_PATTERNS = [
  [/\b(?:chop|cut|split|gather|get|collect)\b[^.]*\b(?:wood|trees?|logs?|firewood|timber)\b|\bfirewood\b/, 'chop_wood'],
  [/\bherbs?\b|\bmoonpetals?\b/, 'gather_herbs'],
  [/\bforag|\bberries\b/, 'forage'],
  [/\b(?:mine|dig)\b|\bore\b|\bstone\b/, 'mine_ore'],
  [/\bfish/, 'fish'],
  [/\bfarm|\bharvest|\bcrops?\b|\bturnips?\b|\bwheat\b/, 'farm'],
  [/\bcook/, 'cook'],
  [/\bloot\b|\bdrops\b/, 'collect_loot'],
];

// "chop wood", "come with me", "explore the ruins" -> actions, for an offer like
// "I'll pay you 10 coins to chop wood". together: whether she travels with the player.
export function parseRequestText(rest, together = true) {
  const t = String(rest || '')
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .trim();
  if (!t) return [];
  const n = t.match(/\b(\d{1,3})\b/);
  const amount = n ? parseInt(n[1], 10) : null;
  for (const [re, job] of JOB_PATTERNS) {
    if (re.test(t)) {
      const deliver = /\bkeep\b|\bfor yourself\b/.test(t) ? 'keep' : /\bchest\b/.test(t) ? 'chest' : 'player';
      return [{ name: 'start_job', args: { target: deliver, value: job, amount } }];
    }
  }
  if (/\b(?:follow me|come with me|come along|travel with me|join me|come back)\b/.test(t)) {
    return [together ? { name: 'follow', args: { target: 'player', value: null, amount: null } } : { name: 'rejoin', args: { target: null, value: 'asked', amount: null } }];
  }
  if (/\battack mode\b|\bfight (?:everything|anything)\b|\bgo (?:aggressive|all out)\b/.test(t)) return [{ name: 'set_combat_mode', args: { target: null, value: 'attack', amount: null } }];
  let m;
  if ((m = t.match(/\b(?:attack|kill|fight|slay|hunt)\s+(?:the |that |those |this |a )?([\w' -]+)/))) return [{ name: 'attack', args: { target: m[1].trim(), value: /hunt/.test(t) ? 'food' : null, amount: null } }];
  if ((m = t.match(/\b(?:guard|protect|defend)\s+(?:the |that )?([\w' -]+)/))) return [{ name: 'guard', args: { target: m[1].trim(), value: null, amount: null } }];
  if ((m = t.match(/\b(?:explore|search|scout)\s+(?:the )?([\w' -]+)/))) return [{ name: 'explore', args: { target: m[1].trim(), value: null, amount: null } }];
  if ((m = t.match(/\b(?:go|come|walk|head)\s+(?:in)?to\s+(?:the )?([\w' -]+)/))) return [{ name: 'goto', args: { target: m[1].trim(), value: null, amount: null } }];
  if ((m = t.match(/\btalk to\s+([\w' -]+)/))) return [{ name: 'talk_to', args: { target: m[1].trim(), value: null, amount: null } }];
  if (/\bstay\b/.test(t)) return [{ name: 'stay', args: { target: null, value: null, amount: null } }];
  if (/\bwait\b/.test(t)) return [{ name: 'wait', args: { target: null, value: null, amount: amount } }];
  return [];
}

const FLIP = {
  "i'll": "you'll",
  'i will': 'you will',
  "i'm": "you're",
  'i am': 'you are',
  i: 'you',
  me: 'you',
  my: 'your',
  mine: 'yours',
  myself: 'yourself',
  "you'll": "I'll",
  "you're": "I'm",
  you: 'me',
  your: 'my',
  yours: 'mine',
  yourself: 'myself',
};

// The player's words seen from her side: "find Maren for you" -> "find Maren for me".
export function flipPerson(text) {
  return String(text || '').replace(/\b(i'll|i will|i'm|i am|you'll|you're|yourself|yours|your|you|myself|mine|my|me|i)\b/gi, (w) => FLIP[w.toLowerCase()] || w);
}

// What she asks of the player, from her side: "buy me a honey cake" -> a promise spec.
export function parseAskText(text, resolveLocation = null) {
  const t = String(text || '').toLowerCase().trim();
  let m;
  if ((m = t.match(/\bpay me\s+(\d{1,4})/))) return { kind: 'pay', params: { amount: parseInt(m[1], 10) }, what: `pay me ${m[1]} coins`, days: 2 };
  if ((m = t.match(/\b(?:buy|bring|get|give|fetch|find)\s+me\s+(?:a |an |some |the |another )?([a-z' ]+?)(?:\s+(?:tomorrow|today|tonight|later|soon))?(?=\s+(?:and|then|so|if|or|before|after)\b|\s*[.!?,;]|$)/))) {
    const itemId = resolveItemId(m[1]);
    if (itemId && itemDef(itemId)) return { kind: 'give', params: { itemId, qty: 1 }, what: `bring me ${withArticle(itemDef(itemId).name)}`, days: 2 };
  }
  if ((m = t.match(/\b(?:walk|take|come with|go with|bring)\s+me\s+to\s+(?:the\s+)?([a-z' ]+)/))) {
    const loc = resolveLocation ? resolveLocation(m[1].trim()) : null;
    if (loc) return { kind: 'visit', params: { at: loc.id }, what: `go with me to ${loc.name || loc.id}`, days: 1 };
  }
  if (/\b(?:don'?t|do not|never|stop|keep)\b[^.]*\b(?:hit|hurt|swing|attack|sword)\b/.test(t)) {
    return { kind: 'avoid', params: { deeds: ['hit_lyra', 'downed_lyra'] }, what: 'keep your sword away from me', days: 1 };
  }
  if (/\b(?:leave|don'?t hurt|stop hurting)\b[^.]*\b(?:villagers|people|anyone)\b/.test(t)) {
    return { kind: 'avoid', params: { deeds: ['attacked_villager', 'downed_villager', 'attacked_guard'] }, what: 'leave the villagers in peace', days: 2 };
  }
  return { kind: 'free', params: {}, what: t.replace(/[.!?]+$/, '').slice(0, 90) || 'do me a favor', days: 0 };
}

function withArticle(name) {
  const n = String(name || '').toLowerCase();
  if (/s$/.test(n)) return `some ${n}`;
  return /^[aeiou]/.test(n) ? `an ${n}` : `a ${n}`;
}

// A promise from free text -> { kind, params, what, days } (days until it is due).
// kinds: give {itemId, qty} | pay {amount} | avoid {deeds} | visit {at} | free {}
export function parsePromiseText(text, resolveLocation = null) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  let m;
  if ((m = t.match(/\b(?:pay|give)\s+you\s+(?:back\s+)?(\d{1,4})\s*(?:coins?|gold|silver)?/))) {
    const amount = parseInt(m[1], 10);
    return { kind: 'pay', params: { amount }, what: `pay me ${amount} coins`, days: 2 };
  }
  if ((m = t.match(/\b(?:bring|buy|get|give|find|fetch)\s+you\s+(?:a |an |some |the |your |another )?([a-z' ]+?)(?:\s+(?:tomorrow|today|tonight|later|soon|someday|again|back))?(?=\s+(?:and|then|so|if|or|before|after)\b|\s*[.!?,;]|$)/))) {
    const itemId = resolveItemId(m[1]);
    if (itemId && itemDef(itemId)) return { kind: 'give', params: { itemId, qty: 1 }, what: `bring me ${withArticle(itemDef(itemId).name)}`, days: 2 };
  }
  const neg = /\b(?:never|won'?t|will not|not going to|no more)\b/;
  if (neg.test(t) && /\b(?:hit|hurt|strike|attack|harm|swing at|knock)\b[^.]*\byou\b/.test(t)) {
    return { kind: 'avoid', params: { deeds: ['hit_lyra', 'downed_lyra'] }, what: 'never raise a sword to me again', days: 3 };
  }
  if (neg.test(t) && /\b(?:hit|hurt|attack|harm|fight)\b[^.]*\b(?:anyone|anybody|people|villagers|them|him|her|the village)\b/.test(t)) {
    return { kind: 'avoid', params: { deeds: ['attacked_villager', 'downed_villager', 'attacked_guard'] }, what: 'leave the villagers in peace', days: 3 };
  }
  if (neg.test(t) && /\b(?:leave|abandon)\b[^.]*\byou\b/.test(t)) {
    return { kind: 'avoid', params: { deeds: ['abandoned_downed'] }, what: 'never leave me lying hurt again', days: 5 };
  }
  if (neg.test(t) && /\blie\b|\blying\b/.test(t)) return { kind: 'avoid', params: { deeds: ['lied'] }, what: 'never lie to me again', days: 5 };
  if ((m = t.match(/\b(?:take|walk|bring|go with|come with)\s+you\s+to\s+(?:the\s+)?([a-z' ]+)/))) {
    const loc = resolveLocation ? resolveLocation(m[1].trim()) : null;
    if (loc) return { kind: 'visit', params: { at: loc.id }, what: `go with me to ${loc.name || loc.id}`, days: 1 };
  }
  if (/\bfind maren\b|\bhelp you find\b/.test(t)) return { kind: 'free', params: {}, what: 'help me find Maren', days: 0 };
  const rest = raw
    .replace(/^.*?\b(?:i promise|i swear|you have my word|i give you my word)\b[,:]?\s*(?:to\s+|that\s+|i'?ll\s+|i will\s+)?/i, '')
    .replace(/[.!]+$/, '')
    .trim()
    .slice(0, 90);
  return { kind: 'free', params: {}, what: flipPerson(rest) || 'keep your word', days: 0 };
}
