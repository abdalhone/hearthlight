// Offline language understanding for Lyra.
//
// parseMessage(text, env) splits the player's message into clauses ("follow me and
// kill anything that isn't a friend" -> two clauses), then for each clause tries the
// plugins' intents in registration order (DESIGN §11 shape) and then the built-in
// intents below. The result says, per clause, which intent matched, the slots it
// extracted, the actions to run and whether it is a clear command (run at once).
//
// Built-in patterns run on a "core" form of the clause: lowercased, contractions
// expanded, politeness and Lyra's name stripped ("Lyra, could you please chop some
// wood?" -> "chop some wood").

import { resolveItemId } from '../../entities/items.js';
import { companionshipOf } from './her_state.js';

export const COMMAND_THRESHOLD = 0.8;

// Actions whose `amount` means nothing, so a coin offer can ride on it (DESIGN §16.4).
export const AMOUNT_FREE = new Set([
  'follow', 'stay', 'come_here', 'goto', 'set_combat_mode', 'attack', 'retreat', 'patrol', 'explore', 'free_will', 'emote',
  'sit', 'open_door', 'close_door', 'pick_up', 'interact', 'sleep', 'talk_to', 'rejoin', 'read_journal', 'stop_job', 'use_item',
  'wait_outside', 'flee',
]);

// ------------------------------------------------------------------ normalizing

const CONTRACTIONS = [
  [/\bwhat'?s\b/g, 'what is'],
  [/\bwhere'?s\b/g, 'where is'],
  [/\bwho'?s\b/g, 'who is'],
  [/\bhow'?s\b/g, 'how is'],
  [/\bwhen'?s\b/g, 'when is'],
  [/\bthat'?s\b/g, 'that is'],
  [/\bthere'?s\b/g, 'there is'],
  [/\bhere'?s\b/g, 'here is'],
  [/\bit'?s\b/g, 'it is'],
  [/\blet'?s\b/g, 'let us'],
  [/\bcan'?t\b/g, 'cannot'],
  [/\bwon'?t\b/g, 'will not'],
  [/\bain'?t\b/g, 'is not'],
  [/\bshan't\b/g, 'shall not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\bdont\b/g, 'do not'],
  [/\bdoesnt\b/g, 'does not'],
  [/\bisnt\b/g, 'is not'],
  [/\barent\b/g, 'are not'],
  [/\bdidnt\b/g, 'did not'],
  [/\bi'?m\b/g, 'i am'],
  [/\bim\b/g, 'i am'],
  [/\b(you|we|they)'re\b/g, '$1 are'],
  [/\byoure\b/g, 'you are'],
  [/\b(i|you|we|they)'ve\b/g, '$1 have'],
  [/\b(i|you|we|they|she|he|it)'ll\b/g, '$1 will'],
  [/\b(i|you|we|they|she|he)'d\b/g, '$1 would'],
  [/\b(he|she)'s\b/g, '$1 is'],
  [/\bwanna\b/g, 'want to'],
  [/\bgonna\b/g, 'going to'],
  [/\bgotta\b/g, 'got to'],
  [/\bgimme\b/g, 'give me'],
  [/\blemme\b/g, 'let me'],
  [/\bya\b/g, 'you'],
  [/\bu\b/g, 'you'],
  [/\bur\b/g, 'your'],
  [/\br\b/g, 'are'],
  [/\bpl[sz]\b/g, 'please'],
  [/\bthx\b/g, 'thanks'],
  [/\bty\b/g, 'thank you'],
  [/\bcuz\b/g, 'because'],
  [/\bok+ay\b/g, 'okay'],
];

// Lowercase, straighten quotes, expand contractions, drop stray punctuation.
export function normalize(text) {
  let s = String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, ' - ');
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  return s
    .replace(/["()[\]{}*_~]/g, ' ')
    .replace(/[!?.;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that can start a new clause after "and", "then", a comma...
const STARTERS = [
  'follow', 'come', 'stay', 'wait', 'hold', 'stop', 'quit', 'halt', 'go', 'head', 'run', 'walk', 'move', 'return',
  'attack', 'kill', 'fight', 'shoot', 'hit', 'strike', 'slay', 'destroy', 'defend', 'guard', 'protect', 'watch',
  'patrol', 'explore', 'scout', 'search', 'chop', 'cut', 'gather', 'pick', 'collect', 'mine', 'dig', 'fish',
  'forage', 'cook', 'bake', 'make', 'farm', 'harvest', 'bring', 'give', 'hand', 'pass', 'take', 'put', 'store',
  'keep', 'use', 'eat', 'drink', 'open', 'close', 'shut', 'sit', 'sleep', 'rest', 'dance', 'wave', 'laugh', 'bow',
  'hug', 'cheer', 'shrug', 'talk', 'speak', 'chat', 'tell', 'ask', 'say', 'remember', 'forget', 'set', 'switch',
  'stick', 'retreat', 'fall', 'grab', 'find', 'help', 'heal', 'read', 'look', 'check', 'let us', 'let me', 'please',
  'do not', 'never', 'always', 'try', 'what', 'where', 'who', 'how', 'why', 'when', 'which', 'are you', 'is it',
  'can you', 'could you', 'would you', 'will you', 'can i', 'do you', 'did you', 'have you', 'should we',
  'thank', 'thanks', 'sorry', 'i love', 'i hate', 'i like', 'i think', 'i want', 'i need', 'i am', 'i feel',
  'be', 'get back', 'loot', 'scavenge', 'light', 'leave', 'treat', 'mark', 'escort', 'meet',
  "don't", 'dont', "let's", 'lets', "what's", "where's", "who's", "how's", "i'm",
];
const STARTER_RE = STARTERS.map((w) => w.replace(/ /g, '\\s+')).join('|');
const SPLIT_RE = new RegExp(
  `\\s*,\\s*(?:and then\\s+|and also\\s+|and\\s+|then\\s+|but\\s+|also\\s+|plus\\s+)?(?=(?:${STARTER_RE})\\b)` +
    `|\\s+(?:and then|and also|and after that|after that|afterwards|and|then|but|also|plus)\\s+(?=(?:${STARTER_RE})\\b)`,
  'gi',
);

// Split a message into clauses. Each: { text, question }.
export function splitClauses(text) {
  const src = String(text ?? '')
    .replace(/\r?\n+/g, '. ')
    .trim();
  if (!src) return [];
  const out = [];
  const sentences = src.match(/[^.!?;]+(?:[.!?;]+|$)/g) || [src];
  for (const sentence of sentences) {
    const question = /\?\s*$/.test(sentence);
    const body = sentence.replace(/[.!?;]+\s*$/, '').trim();
    if (!body) continue;
    // Split on the normalized-ish string but keep raw slices: work on a version with
    // straight quotes so "isn't" splits the same as "is not".
    const parts = body.split(SPLIT_RE).map((p) => p && p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) out.push({ text: parts[i], question: question && i === parts.length - 1 ? true : question && /^(what|where|who|how|why|when|which|are|is|do|did|can|could|would|will|have|should)\b/i.test(parts[i]) });
  }
  return out;
}

const POLITE_HEAD =
  /^(?:(?:please|kindly|just|now|ok|okay|alright|all right|right|so|well|um+|uh+|hey|oh|and|then|also|but|yes|yeah)\b[ ,]*)+/;
const MODAL_HEAD =
  /^(?:(?:would|do) you (?:like|want|mind) to|(?:can|could|would|will|wo) you(?: please| maybe| kindly)?|i (?:want|need|would like) you to|shall we|we should|we could|we need to|maybe you could|how about you|go ahead and|why do not you|why not|try to|try and|you should|you can|you must|you need to|you have to|i order you to|i command you to|i would like you to|be a dear and|do me a favou?r and)\s+/;
const POLITE_TAIL = /[ ,]+(?:please|for now|right now|now|quickly|asap|ok|okay|alright|will you|would you|thanks|thank you)$/;

function stripAddress(raw, names) {
  let s = String(raw).trim();
  let greeted = false;
  const nameAlt = names.map(escapeRe).join('|');
  const head = new RegExp(`^(?:(hey|hi|hello|yo|ok|okay|oh|so|um|well|listen)[, ]+)?(?:${nameAlt})\\b[,.!:]?\\s+(?=\\S)`, 'i');
  const m = s.match(head);
  if (m) {
    greeted = !!m[1] && /^(hey|hi|hello|yo)$/i.test(m[1]);
    s = s.slice(m[0].length);
  }
  s = s.replace(new RegExp(`[, ]+(?:${nameAlt})[.!?]*$`, 'i'), '');
  return { text: s.trim(), greeted };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function coreForm(norm) {
  let s = norm;
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(POLITE_HEAD, '').replace(MODAL_HEAD, '').replace(POLITE_TAIL, '').trim();
    if (s === before) break;
  }
  return s;
}

// ---------------------------------------------------------------- quantities

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, couple: 2, few: 3, several: 4, dozen: 12, bunch: 6,
  lots: 10, lot: 10, plenty: 10, many: 8, handful: 4, pair: 2, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  'a hundred': 100, 'one hundred': 100,
};

// "5", "five", "a few", "a couple of", "a dozen" -> number; "some"/"any" -> null.
export function parseNumber(word) {
  if (word == null) return null;
  const w = String(word).trim().toLowerCase().replace(/^(?:a|an)\s+(?=\w)/, '').replace(/\s+of$/, '');
  if (/^\d+(?:\.\d+)?$/.test(w)) return parseFloat(w);
  if (w in NUMBER_WORDS) return NUMBER_WORDS[w];
  if (/^(?:a|an)$/.test(String(word).trim())) return 1;
  return null;
}

// ------------------------------------------------------------------ coin offers

const OFFER_N = '(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|(?:a |one )?hundred|a few|a couple(?: of)?|some)';
const COIN = '(?:gold coins?|gold pieces?|silver coins?|coins?|gold|silver|crowns?)';
const LEAD = "^\\s*(?:(?:ok(?:ay)?|look|listen|fine|alright|all right|hey|so|well|lyra)[,!.]?\\s+)*";
const ILL = "(?:i(?:'ll| will| can| could|'d| would| shall)?|let me|how about (?:i|we))";
const LINK = "(?:to|if you(?:'ll| will)?|for|and you|so (?:that )?you(?:'ll| will| can)?|in exchange for|if)\\s+(?:you\\s+)?";
const OFFER_PATTERNS = [
  // "I'll pay you 10 coins to chop wood" / "I'll give you 5 gold if you follow me"
  { re: new RegExp(`${LEAD}${ILL}\\s+(?:pay|give|offer|tip|hand)\\s+you\\s+(?:${OFFER_N}\\s+)?${COIN}\\s+${LINK}`, 'i'), where: 'head' },
  // "I'll pay you to guard Pip"
  { re: new RegExp(`${LEAD}${ILL}\\s+pay\\s+you\\s+(?:well\\s+)?${LINK}`, 'i'), where: 'head' },
  // "10 coins to chop wood" / "20 gold if you come"
  { re: new RegExp(`${LEAD}${OFFER_N}\\s+${COIN}\\s+(?:to|if you(?:'ll| will)?|for)\\s+`, 'i'), where: 'head' },
  // "here's 10 coins, now chop wood"
  { re: new RegExp(`${LEAD}here(?:'s| is| are)\\s+${OFFER_N}\\s+${COIN}[,.!]?\\s*(?:now\\s+|so\\s+|to\\s+|go\\s+)?`, 'i'), where: 'head', paid: true },
  // "we'll split it, so help me" / "half is yours if you ..."
  { re: new RegExp(`${LEAD}(?:we(?:'ll| will| can)? split (?:it|the loot|the take|the coins?)(?: fifty[- ]fifty| evenly| down the middle)?|half (?:of it )?is yours)[,.!]?\\s+(?:if you\\s+|so\\s+|now\\s+)?`, 'i'), where: 'head', share: true },
  // "chop wood and I'll pay you 10 coins" / "chop wood for 10 coins"
  { re: new RegExp(`[,\\s]+(?:and\\s+)?(?:(?:i(?:'ll| will)\\s+(?:pay|give)\\s+you)|for)\\s+${OFFER_N}\\s+${COIN}(?:\\s+(?:for it|for that|for your trouble))?\\s*[.!?]*$`, 'i'), where: 'tail' },
  // "chop wood and I'll pay you"
  { re: /[,\s]+(?:and\s+)?i(?:'ll| will)\s+(?:pay you|pay|make it worth your while|reward you)(?:\s+(?:for it|well|for your trouble))?\s*[.!?]*$/i, where: 'tail' },
  // "chop wood, you can keep half"
  { re: /[,\s]+(?:and\s+)?(?:you can keep half|half (?:of it )?is yours|we(?:'ll| will| can)? split (?:it|the loot|the take|the coins?|everything|whatever we (?:get|find))(?: with you)?(?: fifty[- ]fifty| evenly| down the middle)?|i(?:'ll| will) split it with you|you get half|you can have half)\s*[.!?]*$/i, where: 'tail', share: true },
  // the whole message is an offer: "I'll pay you 10 coins", "how about 20 gold?", "10 coins?"
  { re: new RegExp(`${LEAD}(?:(?:${ILL}\\s+)?(?:pay|give|offer|tip)\\s+you|how about|what about|what if i (?:paid|gave) you|for)\\s+(?:${OFFER_N}\\s+)?${COIN}(?:\\s+(?:for it|for that|then|instead|now))?\\s*[.!?]*$`, 'i'), where: 'all' },
  { re: new RegExp(`${LEAD}${ILL}\\s+pay\\s+you(?:\\s+(?:for it|for that|well|then))?\\s*[.!?]*$`, 'i'), where: 'all' },
  { re: new RegExp(`^\\s*${OFFER_N}\\s+${COIN}\\s*[?!.]*$`, 'i'), where: 'all' },
];

function offerAmount(m) {
  for (let i = 1; i < m.length; i++) {
    if (!m[i]) continue;
    const n = parseNumber(m[i].trim().replace(/^(?:a|one) hundred$/, 'hundred'));
    if (n != null) return Math.max(1, Math.min(9999, Math.round(n)));
  }
  return null;
}

// Find a coin offer or a fair-share offer in a message. Returns { offer, rest }:
// offer = { coins, share, paid, text } or null; rest = the message without the offer.
export function detectOffer(text) {
  const src = String(text ?? '');
  const flat = src.replace(/[‘’ʼ`´]/g, "'");
  for (const p of OFFER_PATTERNS) {
    const m = p.re.exec(flat);
    if (!m) continue;
    let rest;
    if (p.where === 'head') rest = src.slice(m.index + m[0].length);
    else if (p.where === 'tail') rest = src.slice(0, m.index);
    else rest = '';
    rest = rest.replace(/^[\s,.;:!-]+/, '').trim();
    if (p.where === 'head' && !rest) continue;
    const coins = p.share ? null : offerAmount(m);
    return { offer: { coins, share: !!p.share, paid: !!p.paid, text: m[0].trim() }, rest };
  }
  return { offer: null, rest: src };
}

const QTY_HEAD =
  /^(?:(\d+)|(a couple(?: of)?|a few|a dozen|a lot of|lots of|a bunch of|a handful of|plenty of|a pair of|several|many|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|a|an)|(some|any|more|your|my|the|all(?: of)?(?: your| the| my)?|those|these|that|this|our))\s+/;

// "3 iron ore" -> { qty: 3, item: 'iron_ore', raw: 'iron ore' }
export function extractQuantityItem(phrase) {
  let s = String(phrase || '').trim().toLowerCase();
  let qty = null;
  let all = false;
  for (let i = 0; i < 3; i++) {
    const m = s.match(QTY_HEAD);
    if (!m) break;
    if (m[1]) qty = parseInt(m[1], 10);
    else if (m[2]) qty = parseNumber(m[2]);
    else if (/^all/.test(m[3])) all = true;
    s = s.slice(m[0].length);
  }
  s = s.replace(/\b(?:pieces? of|bundles? of|stacks? of|bits? of|bottles? of|loaves? of)\s+/, '').replace(/[.!?,]+$/, '').trim();
  let item = null;
  if (/^(?:money|gold|coins?|silver|cash)$/.test(s)) item = 'coin';
  else if (/^(?:something to eat|food|a snack|snack|something)$/.test(s)) item = null;
  else if (/^(?:a )?(?:health|healing|heal) potions?$/.test(s)) item = 'potion';
  else item = s ? resolveItemId(s) : null;
  return { qty, all, item, raw: s };
}

function findQuantity(text) {
  const m = String(text).match(
    /\b(\d+|a couple(?: of)?|a few|a dozen|a lot of|lots of|a bunch of|a handful of|plenty of|several|many|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/,
  );
  return m ? parseNumber(m[1]) : null;
}

// ------------------------------------------------------------------ references

const DETERMINER = /^(?:the|that|this|those|these|a|an|my|our|your|some|one of the|one of those)\s+/;

export function cleanRef(s) {
  let t = String(s || '')
    .toLowerCase()
    .replace(/[.!?,]+$/, '')
    .trim();
  for (let i = 0; i < 3; i++) t = t.replace(DETERMINER, '');
  // "the sunken ruins with me tonight" -> "sunken ruins": company and time are not the place.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t
      .replace(/\s+(?:over there|over here|there|here|now|right now|for me|please|quickly|first|real quick|with me|with us|together|alone|tonight|today|tomorrow|this (?:morning|afternoon|evening)|at (?:night|dawn|dusk)|for (?:a bit|a while|now)|later|soon|again)$/, '')
      .trim();
    if (t === before) break;
  }
  return t;
}

function whoRef(s, env, fallback = null) {
  const t = cleanRef(s);
  if (!t) return fallback;
  if (/^(?:me|us|myself|ourselves|the player)$/.test(t)) return 'player';
  if (/^(?:you|yourself)$/.test(t)) return 'lyra';
  if (/^(?:him|her|them|he|she|they)$/.test(t)) return env.lastPerson || fallback;
  return t;
}

const ANYONE = /^(?:anything|everything|everyone|everybody|anyone|anybody|all|all of them|any of them|whatever|every\w*|any\w*|all \w+|on sight)\b/;
const ENEMY_PRONOUN = /^(?:it|them|that|that one|this one|those|the enemy|enemies|the enemies|that thing|this thing)$/;

// ------------------------------------------------------------------ built-ins

const JOB_VERBS = '(?:gather|pick|collect|get|find|look for|search for|hunt for|harvest|grab|fetch|bring|go pick|go get|gimme)';
const QTY = '(?:me |us )?(?:some |a few |a couple(?: of)? |more |a lot of |lots of |a bunch of |a handful of |plenty of |several |\\d+ |one |two |three |four |five |six |seven |eight |nine |ten |twelve |twenty |a |an )?';

const JOBS = [
  ['collect_loot', [
    /^(?:collect|gather|pick up|grab|get|take|scoop up|loot|pick) (?:up )?(?:the |all the |all of the |any |that |those )?(?:loot|drops|dropped items|items|stuff|spoils|goods|treasure|things they dropped)\b/,
    /^loot(?: (?:the|those|that|them|it|bodies|corpses|everything|the area|area|the bodies))?$/,
    /^(?:collect|gather) (?:it all|everything)$/,
  ]],
  ['forage', [
    /^(?:forage|go foraging|scavenge|do some foraging)\b/,
    new RegExp(`^${JOB_VERBS} ${QTY}(?:wild )?(?:berries|food|mushrooms|fruit|something to eat|berries and herbs|herbs and berries)\\b`),
  ]],
  ['gather_herbs', [
    new RegExp(`^${JOB_VERBS} ${QTY}(?:healing |wild )?(?:herbs?|silverleaf|moonpetals?|moon petals?|flowers?|plants?)\\b`),
    /^(?:herbalism|go herbing|herb gathering)\b/,
  ]],
  ['chop_wood', [
    new RegExp(`^(?:chop|cut|fell|split|gather|collect|get|harvest|fetch|bring|go chop|go cut|gimme)(?: down)? ${QTY}(?:pieces of |bundles of |logs of |more )?(?:wood|logs?|lumber|firewood|timber|trees?|kindling)\\b`),
    /^(?:woodcutting|lumberjacking|do some woodcutting|go woodcutting|chop|chop chop)$/,
  ]],
  ['mine_ore', [
    new RegExp(`^(?:mine|dig|quarry|gather|collect|get|harvest|fetch|bring|break|smash|go mine)(?: for| up)? ${QTY}(?:iron |glow )?(?:ore|iron|stones?|rocks?|crystals?|minerals?|metal)\\b`),
    /^(?:mining|go mining|do some mining|mine)$/,
  ]],
  ['fish', [
    /^(?:fish|go fish|go fishing|do some fishing|cast a line|fishing|go catch some fish)\b/,
    new RegExp(`^(?:catch|get|bring|fetch|reel in|land|go catch) ${QTY}(?:fish|fishes|trout|perch|supper from the lake)\\b`),
  ]],
  ['farm', [
    /^(?:farm|go farming|do some farming|work the (?:farm|fields?)|tend the (?:crops|field|farm|garden))\b/,
    /^(?:help|assist) (?:tobias|the farmer|on the farm|out on the farm|with the (?:crops|harvest|farm|field))\b/,
    /^(?:harvest|pick|gather|collect|bring in) (?:the |some |\d+ )?(?:crops|turnips?|wheat|harvest|field)\b/,
  ]],
  ['cook', [
    /^(?:cook|make|prepare|fix|whip up|grill|roast|bake|brew) (?:us |me )?(?:some |a |an |the |up )?(?:dinner|supper|lunch|breakfast|food|meal|stew|bread|fish|something(?: to eat)?|soup|turnips?|the fish)\b/,
    /^(?:cook|cooking|start cooking|do some cooking|cook something|cook it|cook them|cook that|cook those)$/,
  ]],
];

const ITEM_FOR_JOB = { wood: 'chop_wood', herb: 'gather_herbs', moonpetal: 'gather_herbs', berries: 'forage', stone: 'mine_ore', iron_ore: 'mine_ore', crystal: 'mine_ore', raw_fish: 'fish' };

function deliverFrom(text, forMe) {
  if (/\b(?:in|into) (?:the |our |my )?(?:home )?chest\b|\bstore (?:it|them)\b|\bbring (?:it|them|everything) home\b/.test(text)) return 'chest';
  if (/\bkeep (?:it|them|those|everything)\b/.test(text)) return 'keep';
  if (forMe || /^(?:bring|fetch|get|gimme|catch|gather|collect|pick|find|grab|chop|cut|mine|dig) me\b/.test(text) || /\bto me\b|\bbring (?:it|them) (?:back )?(?:here|over)\b/.test(text)) return 'player';
  return null;
}

function act(name, target = null, value = null, amount = null) {
  return { name, args: { target, value, amount } };
}

const EMOTE_WORDS = {
  dance: 'dance', wave: 'wave', laugh: 'laugh', bow: 'bow', curtsy: 'bow', hug: 'hug', cheer: 'cheer', celebrate: 'cheer',
  shrug: 'shrug', cry: 'cry', think: 'think', ponder: 'think', sit: 'sit', angry: 'angry', mad: 'angry',
};

const EMOTIONS = {
  happy: 'joy', cheerful: 'joy', excited: 'joy', sad: 'sadness', angry: 'anger', mad: 'anger', grumpy: 'anger',
  scared: 'fear', afraid: 'fear', surprised: 'surprise', proud: 'pride', curious: 'curiosity', embarrassed: 'embarrassment',
  shy: 'embarrassment', loving: 'affection', calm: 'trust',
};

const FEELINGS = {
  sad: 'sad', down: 'sad', upset: 'sad', depressed: 'sad', miserable: 'sad', lonely: 'lonely', alone: 'lonely',
  tired: 'tired', exhausted: 'tired', sleepy: 'tired', hungry: 'hungry', starving: 'hungry', scared: 'scared',
  afraid: 'scared', frightened: 'scared', nervous: 'scared', worried: 'scared', anxious: 'scared', happy: 'happy',
  glad: 'happy', great: 'happy', good: 'happy', excited: 'happy', bored: 'bored', hurt: 'hurt', injured: 'hurt',
  wounded: 'hurt', sick: 'hurt', cold: 'tired', lost: 'scared', angry: 'sad', mad: 'sad', frustrated: 'sad',
};

const REL_TAGS = { friend: 'friend', friends: 'friend', ally: 'friend', allies: 'friend', enemy: 'enemy', enemies: 'enemy', foe: 'enemy', foes: 'enemy', rival: 'rival', pet: 'pet', family: 'family', crush: 'crush', mentor: 'mentor' };
const REL_AMOUNT = { friend: 10, enemy: -20, rival: -5, pet: 8, family: 15, crush: 5, mentor: 8 };
const NOT_A_PERSON = /^(?:you|i|it|that|this|he|she|there|who|what|which|everyone|everybody|it all|we|they|the weather|today|tonight)$/;

// Built-in intents. kind: command | question | social | modifier.
// slots(m, c) -> object, or null to reject the match. acts(s, c) -> actions.
export const BUILTIN_INTENTS = [
  // ------------------------------------------------------- modifiers (attach to the clause before)
  {
    id: 'mod.deliver', kind: 'modifier', confidence: 0.9,
    patterns: [
      /^(?:bring|give|hand|deliver|carry|take) (?:it|them|those|that|everything|it all|the \w+|what you (?:get|find|gather|chop|catch|collect|mine))(?: back)? to me\b/,
      /^(?:bring|take|carry) (?:it|them|everything|it all) (?:back )?home\b/,
      /^(?:put|store|stash|leave|stow|drop) (?:it|them|those|everything|it all)(?: \w+)? (?:in|into) (?:the |our |my )?(?:home )?chest\b/,
      /^(?:keep|hold on to|hang on to) (?:it|them|those|everything|it all)$/,
      /^for me$/,
    ],
    slots: (m, c) => ({ deliver: deliverFrom(c.core, /^for me$/.test(c.core)) || (/home|chest/.test(c.core) ? 'chest' : 'player') }),
  },
  {
    id: 'mod.then', kind: 'modifier', confidence: 0.85,
    patterns: [/^(?:wait|stay|hold)(?: (?:there|for me|for me there|there for me|until i come|until i get there))*$/, /^(?:come back|return|come right back|come back to me|then come back)$/],
    slots: (m, c) => ({ then: /back|return/.test(c.core) ? 'return' : 'stay' }),
  },

  // ------------------------------------------------------- social that must win early
  {
    id: 'social.flirt', kind: 'social', confidence: 0.85,
    patterns: [
      /\b(?:i love you|i am in love with you|i have fallen for you|marry me|will you marry|kiss me|can i kiss you|give me a kiss|be my (?:girlfriend|partner|wife|love|valentine|lady)|go out with me|date me|go on a date|i have (?:a crush|feelings) (?:on|for) you|do you love me|i adore you|you are my (?:everything|girl|love)|i fancy you|i like you(?: a lot| so much| more than)|i really like you|you are cute|you are hot|you are sexy|hold (?:my|your) hand|cuddle)\b/,
      /^(?:you are|you look) (?:so |really |very |absolutely |quite )?(?:beautiful|pretty(?! (?:good|bad|great|well|strong|fast|much|sure|tough|cool|smart|brave))|cute|gorgeous|hot|sexy|lovely|stunning|adorable|radiant|perfect)\b/,
      /^(?:my love|sweetheart|darling|babe|honey)$/,
    ],
  },
  {
    id: 'social.insult', kind: 'social', confidence: 0.85,
    patterns: [
      /\byou are (?:so |such an? |a |an |really |very |completely |totally |the most )?(?:stupid|dumb|useless|idiot|annoying|ugly|worthless|pathetic|terrible|awful|the worst|slow|lame|a joke|weak|boring|trash|garbage|a failure|incompetent|dense|moron|fool|creepy|a waste|a burden|a disappointment)\b/,
      /\b(?:shut up|i hate you|you suck|screw you|damn you|nobody likes you|i do not like you|you are fired|piece of (?:junk|trash)|go to hell|get lost)\b/,
      /^(?:idiot|moron|stupid|dumb|useless|loser|fool|dumbass|you idiot|you fool|you moron|bitch|ugh you)$/,
      /^(?:go away|leave me alone|i do not need you|i never needed you)$/,
    ],
    slots: (m, c) => ({ mild: /^(?:go away|leave me alone|get lost)$/.test(c.core), harsh: /\b(?:hate|worthless|trash|garbage|hell|bitch|dumbass|nobody likes)\b/.test(c.core) }),
  },
  {
    id: 'ask.ai', kind: 'question', confidence: 0.85,
    patterns: [
      /\b(?:are you|you are|r you) (?:an? |just an? |really an? |actually an? )?(?:ai|a\.i|robot|bot|chatbot|program|machine|computer|npc|artificial|language model|simulation|algorithm|real person|human|real)\b/,
      /\b(?:artificial intelligence|language model|chatbot|is this a game|are we in a game|video game character|game character)\b/,
    ],
  },

  // ------------------------------------------------------- commands
  {
    // "come back" means rejoin only while she lives apart from the player.
    id: 'cmd.rejoin', kind: 'command', command: true, confidence: 0.88,
    patterns: [
      /^(?:come back(?: to me| with me| home)?|please come back|will you come back(?: to me)?|come with me again|travel with me again|travel together again|join me again|rejoin me|rejoin|let us travel together again|be my companion again|i want you back|walk with me again|can we start over|let us start over|can we try again|let us try again|come home)$/,
    ],
    slots(m, c, env) {
      const apart = env.companionship === 'apart' || env.companionship === 'left';
      const explicit = /\bagain\b|rejoin|start over|want you back|companion/.test(c.core);
      return apart || explicit ? { apart } : null;
    },
    acts: (s) => [s.apart ? act('rejoin') : act('follow', 'player')],
  },
  {
    id: 'cmd.part_ways', kind: 'command', command: true, confidence: 0.86,
    patterns: [
      /^(?:let us|we should|we could|maybe we should|i think we should) (?:split up|part ways|go our (?:own|separate) ways|spend (?:some )?time apart|take a break from each other)(?: for (?:a while|now|today|a bit|a few days))?$/,
      /^(?:go (?:live|have) your own (?:life|day)|go your own way|you should go your own way|i want to be alone for a while|i need (?:some )?time alone|take (?:the|a) day for yourself|go do your own thing for (?:a while|today|now))$/,
    ],
    acts: () => [act('leave_player', null, 'apart')],
  },
  {
    id: 'cmd.promise', kind: 'command', command: true, confidence: 0.85,
    patterns: [/^i (?:promise|give you my word)(?: you)?(?: that)?\s+(?<text>.{3,})$/],
    slots: (m) => {
      const text = m.groups.text.replace(/^(?:i will|to|i am going to)\s+/, '').trim();
      return text.length >= 3 ? { text } : null;
    },
    acts: (s) => [act('promise', 'player', s.text)],
  },
  {
    id: 'cmd.follow_close', kind: 'command', command: true, confidence: 0.9,
    patterns: [
      /^(?:stay|stick|keep|remain) (?:close|near|nearby|by me|by my side|at my side|with me|right behind me|behind me|on my heels)(?: to me)?$/,
      /^(?:do not|never) (?:wander|stray|get lost)(?: off| far| away)?$/,
      /^follow (?:me )?(?:closely|close)$/,
    ],
    acts: () => [act('follow', 'player', 'close')],
  },
  {
    id: 'cmd.follow_far', kind: 'command', command: true, confidence: 0.88,
    patterns: [/^(?:keep|stay|hang) (?:your distance|back|a bit back|further back|farther back|a little back)$/, /^give me (?:some )?(?:space|room)$/, /^follow (?:me )?(?:from a distance|at a distance|from afar|from far away)$/],
    acts: () => [act('follow', 'player', 'far')],
  },
  {
    id: 'cmd.sleep', kind: 'command', command: true, confidence: 0.88,
    patterns: [/^(?:go to (?:bed|sleep)|get (?:some )?sleep|go sleep|sleep|time (?:for|to) (?:bed|sleep)|bedtime|hit the (?:sack|hay)|turn in(?: for the night)?|go (?:and )?sleep(?: now)?|you should sleep|go get some sleep)$/],
    acts: () => [act('sleep')],
  },
  {
    id: 'cmd.home', kind: 'command', command: true, confidence: 0.88,
    patterns: [/^(?:go|head|run|walk|return|get|hurry)(?: on| back)? home(?: now)?$/, /^(?:go|head) back to (?:the )?(?:cottage|house|home)$/],
    acts: () => [act('goto', 'player_home', 'stay')],
  },
  {
    id: 'cmd.job', kind: 'command', command: true, confidence: 0.87,
    test(c) {
      const t = c.core.replace(/^(?:go|go and|start|begin|keep|try|get to|do some|then)\s+(?=\w)/, '');
      for (const [job, res] of JOBS) {
        for (const re of res) {
          const m = re.exec(t) || re.exec(c.core);
          if (m) return { m, slots: { job, amount: findQuantity(t), deliver: deliverFrom(t, c.forMe), text: t } };
        }
      }
      return null;
    },
    acts(s, c, env) {
      // "Bring me some wood" when she already carries wood: hand it over instead.
      if (s.deliver === 'player' && /^(?:bring|fetch|get|gimme|give)\b/.test(s.text)) {
        const { item } = extractQuantityItem(s.text.replace(/^(?:bring|fetch|get|gimme|give)(?: me| us)?\s+/, ''));
        const have = item ? env.inventory?.count?.(item) ?? 0 : 0;
        if (item && ITEM_FOR_JOB[item] && have >= (s.amount || 1)) return [act('give_item', 'player', item, s.amount || have)];
      }
      return [act('start_job', s.deliver, s.job, s.amount)];
    },
  },
  {
    id: 'cmd.stop', kind: 'command', command: true, confidence: 0.88,
    patterns: [
      /^(?:stop|quit|cease|finish|end|drop|abandon|leave|pause) (?:the |your |that |this )?(?:job|work|working|task|chopping|cutting|gathering|fishing|mining|foraging|cooking|farming|collecting|looting|patrolling|patrol|guarding|it|that|what you are doing)$/,
      /^(?:that is enough|enough|that will do|that is plenty|stop|you can stop|okay stop|knock it off|stop it|enough for now|that is enough for today)(?: (?:wood|fish|herbs|ore|now|for now|for today|work|working))?$/,
    ],
    acts: (s, c, env) => [env.directiveType === 'job' || /job|work|chopping|cutting|gathering|fishing|mining|foraging|cooking|farming|collecting|looting/.test(c.core) ? act('stop_job') : act('stay')],
  },
  {
    id: 'cmd.stay_place', kind: 'command', command: true, confidence: 0.86,
    patterns: [/^(?:stay|wait|remain|stand|camp|hold position) (?:for me )?(?:at|in|by|near|inside|outside|beside|next to) (?<place>.+)$/],
    slots: (m) => (/\bmode\b|\bline\b|\bformation\b|\bcharacter\b/.test(m.groups.place) ? null : { place: cleanRef(m.groups.place) }),
    acts: (s) => [act('stay', s.place)],
  },
  {
    id: 'cmd.stay', kind: 'command', command: true, confidence: 0.9,
    patterns: [
      /^(?:stay|remain|halt|freeze|stay put)(?: (?:here|there|put|still|back|right there|right here|where you are|for me|here for me|for a bit|for a while|a while))*$/,
      /^(?:wait|hold|stand)(?: (?:here|there|still|position|your ground|fast|right there|right here|where you are|for me|here for me|the line|this spot|this position))+$/,
      /^(?:hold (?:position|here|this position|the line|the fort|your ground)|stand your ground|do not move|stay where you are|stop following(?: me)?|do not follow me|stay behind|stay back|guard this spot|hold this spot|keep this spot)$/,
    ],
    acts: () => [act('stay')],
  },
  {
    id: 'cmd.wait', kind: 'command', command: true, confidence: 0.88,
    patterns: [
      /^(?:wait|hang on|hold on|pause|give me|wait for)(?: for)? (?<n>\d+|a|an|one|two|three|five|ten|fifteen|twenty|thirty|a few|a couple(?: of)?)? ?(?<unit>seconds?|secs?|minutes?|mins?|moments?|bit|while)$/,
      /^(?:wait|hang on|hold on|one moment|just a moment|one sec|one second|wait up|hang on a sec|give me a (?:sec|second|moment|minute)|wait a (?:sec|second|moment|minute|bit))$/,
    ],
    slots(m) {
      const n = m.groups?.n ? parseNumber(m.groups.n) ?? 1 : null;
      const unit = m.groups?.unit || '';
      let secs = 30;
      if (/^min/.test(unit)) secs = (n || 1) * 60;
      else if (/^sec/.test(unit)) secs = n || 10;
      else if (/^(?:moment|bit)/.test(unit)) secs = 15 * (n || 1);
      else if (/while/.test(unit)) secs = 60;
      return { seconds: Math.max(3, Math.min(300, secs)) };
    },
    acts: (s) => [act('wait', null, null, s.seconds)],
  },
  {
    id: 'cmd.mode_attack', kind: 'command', command: true, confidence: 0.92,
    patterns: [
      /^(?:attack|aggressive|offensive|combat|battle|fight|kill|war|hunt|berserk|hunter|aggro) mode$/,
      /^(?:switch|go|set|change|put|turn|stay|remain|keep|get)(?: yourself| it)?(?: to| into| in| on| back to)? (?:attack|aggressive|offensive|fight|kill|hunt|combat)(?: mode)?$/,
      /^(?:be|get|turn|go|stay|act) (?:aggressive|hostile|violent|on the offensive|offensive|dangerous)$/,
      /^(?:kill|attack|fight|destroy|slay|shoot|hit|take out|clear out|wipe out|hunt|murder|engage|eliminate) (?:anything|everything|every\w*|any\w*|all(?: of)?(?: the)?(?: enemies| monsters| hostiles| them| creatures)?|whatever|all hostiles|on sight)\b/,
      /^(?:weapons free|go wild|no mercy|show no mercy|take no prisoners|let loose|cut loose|go all out|attack on sight|kill on sight|shoot on sight|open fire|fire at will)$/,
      /^(?:clear|cleanse|purge) (?:the |this |that )?(?:area|place|camp|ruins|road|woods|forest|quarry|meadow|path)$/,
    ],
    acts: () => [act('set_combat_mode', null, 'attack')],
  },
  {
    id: 'cmd.mode_defend', kind: 'command', command: true, confidence: 0.9,
    patterns: [
      /^(?:defend|defense|defence|defensive|guard|protect|normal|default)(?: mode)?$/,
      /^(?:switch|go|set|change|put|turn|stay|get)(?: yourself)?(?: back)?(?: to| into| in| on)? (?:defen[cs]e|defend|defensive|guard|normal|default)(?: mode)?$/,
      /^(?:be|play|stay|act) (?:defensive|careful in fights)$/,
      /^(?:cover me|watch my back|have my back|protect me|keep me safe|defend me|got my back|guard me|look after me|keep watch over me)$/,
      /^(?:only fight|fight only) (?:if|when|back)\b/,
    ],
    acts: () => [act('set_combat_mode', null, 'defend')],
  },
  {
    id: 'cmd.mode_passive', kind: 'command', command: true, confidence: 0.9,
    patterns: [
      /^(?:passive|peaceful|pacifist|peace|stealth|sneaky|non-?violent)(?: mode)?$/,
      /^(?:switch|go|set|change|put|turn|stay|get)(?: yourself)?(?: to| into| in| on)? (?:passive|peaceful|pacifist|stealth)(?: mode)?$/,
      /^(?:do not|never|stop|quit|cease) (?:fight|fighting|attack|attacking|kill|killing|shoot|shooting|hurt|hurting|combat)(?: anything| anyone| anybody| everything| at all)?$/,
      /^(?:hold your fire|cease fire|ceasefire|stand down|weapons down|lower your weapons?|put (?:your|the) weapons? away|be peaceful|no (?:more )?fighting|make peace|calm down|chill|stay out of (?:fights|trouble)|avoid (?:fights|fighting|combat))$/,
      /^(?:be|stay|go) (?:passive|peaceful|quiet|stealthy|sneaky)$/,
    ],
    acts: () => [act('set_combat_mode', null, 'passive')],
  },
  {
    id: 'cmd.spare', kind: 'command', command: true, confidence: 0.86,
    patterns: [/^(?:do not|never|stop|quit) (?:attack|attacking|hurt|hurting|kill|killing|shoot|shooting|fight|fighting|harm|harming) (?<who>.+)$/, /^(?:leave|let) (?<who>.+?) (?:alone|be|go)$/, /^spare (?<who>.+)$/],
    slots: (m, c, env) => {
      const who = whoRef(m.groups.who, env);
      return !who || ANYONE.test(who) || who === 'player' || who === 'lyra' ? null : { who };
    },
    acts: (s) => [act('set_relationship', s.who, 'friend', 5)],
  },
  {
    id: 'cmd.attack', kind: 'command', command: true, confidence: 0.86,
    patterns: [
      /^(?:attack|kill|shoot|hit|fight|strike|slay|destroy|take out|take down|go after|charge|blast|zap|engage|focus(?: on)?|target|sic|hunt down|deal with|get rid of|finish off|finish) (?<who>.+)$/,
      /^(?:attack|charge|fight|get them|get em|sic em|kill it|kill them|shoot it|shoot them|fire|shoot|engage|help me fight|fight back)$/,
    ],
    slots(m, c, env) {
      if (!m.groups?.who) return { who: env.lastEnemy || 'nearest enemy' };
      let who = cleanRef(m.groups.who);
      if (!who || ANYONE.test(who)) return null;
      if (/\b(?:mode|wood|tree|herb|ore|rock|fish)\b/.test(who)) return null;
      if (ENEMY_PRONOUN.test(who)) who = env.lastEnemy || 'nearest enemy';
      else who = whoRef(who, env, 'nearest enemy');
      return { who };
    },
    acts: (s) => [act('attack', s.who)],
  },
  {
    id: 'cmd.retreat', kind: 'command', command: true, confidence: 0.88,
    patterns: [/^(?:retreat|fall back|back off|back away|disengage|run away|run|flee|get out of (?:there|here)|pull back|withdraw|regroup|get back to me|get back here|escape|get away from (?:it|them|there)|run for it|break off|get out)$/],
    acts: () => [act('retreat')],
  },
  {
    id: 'cmd.guard', kind: 'command', command: true, confidence: 0.85,
    patterns: [
      /^(?:guard|protect|defend|watch over|keep watch over|look after|keep an eye on|watch out for) (?<who>.+)$/,
      /^keep (?<who>.+?) safe$/,
      /^(?:keep watch|stand guard|keep guard|be on guard|be on watch|stand watch|keep a lookout|be the lookout|guard here|guard this (?:area|place|spot))$/,
    ],
    slots(m, c, env) {
      if (!m.groups?.who) return { who: null };
      const who = whoRef(m.groups.who, env);
      if (!who || /\b(?:going|it up|quiet|calm|moving|up|still|following|it)$/.test(who)) return null;
      if (/^(?:this|the) (?:area|place|spot)$/.test(cleanRef(m.groups.who)) || who === 'here') return { who: null };
      return { who };
    },
    acts: (s) => [act('guard', s.who)],
  },
  {
    id: 'cmd.patrol', kind: 'command', command: true, confidence: 0.85,
    patterns: [/^(?:patrol|walk the (?:rounds|perimeter)|do (?:the |your )?rounds|sweep|keep patrolling)(?: (?:the |around |around the |through the |through )?(?<place>.+))?$/],
    slots: (m) => ({ place: m.groups?.place ? cleanRef(m.groups.place) : null }),
    acts: (s) => [act('patrol', s.place)],
  },
  {
    id: 'cmd.explore', kind: 'command', command: true, confidence: 0.84,
    patterns: [/^(?:explore|scout|investigate|survey|check out|look around|have a look around|wander around|poke around|scout out|scout ahead|search)(?: (?:the |in |around |around the |out |out the |ahead |through |through the )?(?<place>.+))?$/],
    slots: (m) => ({ place: m.groups?.place && !/^(?:here|around|ahead|the area|this place)$/.test(m.groups.place) ? cleanRef(m.groups.place) : null }),
    acts: (s) => [act('explore', s.place)],
  },
  {
    id: 'cmd.free', kind: 'command', command: true, confidence: 0.86,
    patterns: [/^(?:do (?:whatever|what) you (?:want|like|wish|please|feel like)|you are free(?: to go)?|free will|go free|do your (?:own )?thing|be free|you are dismissed|dismissed|at ease|go have fun|off you go|have fun|go play|enjoy yourself|you can go|you may go|suit yourself|take a break|take the day off|you are off duty|free time)$/],
    acts: () => [act('free_will')],
  },
  {
    id: 'cmd.emote', kind: 'command', command: true, confidence: 0.86,
    patterns: [
      /^(?<e>dance|wave|laugh|bow|curtsy|cheer|celebrate|shrug|cry|ponder)(?: (?:for me|a little|at me|to me|with me|again))?$/,
      /^(?:do a|show me (?:your|a)|give me a|let me see (?:your|a)) (?<e>dance|bow|wave|cheer|curtsy|shrug|hug)$/,
      /^(?:hug me|give me a hug|(?:can i|let me) (?:have|get) a hug|come here and hug me|hug|hugs|bring it in|group hug)$/,
      /^(?:take a bow|do a victory dance|wave (?:at|to) (?:me|them|him|her|\w+))$/,
    ],
    slots(m, c) {
      const word = m.groups?.e || (/hug|bring it in/.test(c.core) ? 'hug' : /bow/.test(c.core) ? 'bow' : /dance/.test(c.core) ? 'dance' : /wave/.test(c.core) ? 'wave' : 'cheer');
      return { emote: EMOTE_WORDS[word] || word };
    },
    acts: (s) => [act('emote', null, s.emote)],
  },
  {
    id: 'cmd.sit', kind: 'command', command: true, confidence: 0.86,
    patterns: [/^(?:sit|sit down|take a seat|have a seat|rest|relax|rest a bit|rest a while|take a load off|catch your breath|rest your feet|sit (?:by|at|near|with) (?:the )?(?:fire|campfire|hearth|me|us)|rest (?:by|at|near) the (?:fire|campfire|hearth))$/],
    acts: () => [act('sit')],
  },
  {
    id: 'cmd.door', kind: 'command', command: true, confidence: 0.86,
    patterns: [/^(?<verb>open|unlock|close|shut|lock) (?:the |that |this |up )?(?<door>(?:ruins |front |cottage |inn |chapel )?(?:door|gate))$/],
    slots: (m) => ({ verb: /^(?:open|unlock)$/.test(m.groups.verb) ? 'open_door' : 'close_door', door: m.groups.door }),
    acts: (s) => [act(s.verb, s.door)],
  },
  {
    id: 'cmd.read_journal', kind: 'command', command: true, confidence: 0.9,
    patterns: [/^(?:read|open|look at|look through|check|study) (?:the |maren'?s |maren |her |this |that )?(?:journal|notebook|book)\b/],
    acts: () => [act('read_journal')],
  },
  {
    id: 'cmd.pickup', kind: 'command', command: true, confidence: 0.84,
    patterns: [
      /^(?:pick (?:it|that|them|those|this|everything|it all|that stuff|all that) up|pick (?:it|them) all up)$/,
      /^(?:pick up|grab|take|collect) (?:the |that |those |this |these )(?<item>[a-z' ]+)$/,
      /^pick up (?<item>[a-z' ]+)$/,
    ],
    slots: (m) => {
      const raw = m.groups?.item ? cleanRef(m.groups.item) : null;
      return { item: raw ? resolveItemId(raw) || raw : null };
    },
    acts: (s) => [act('pick_up', s.item)],
  },
  {
    id: 'cmd.give', kind: 'command', command: true, confidence: 0.84,
    patterns: [
      /^(?:give|hand|pass|toss|throw|lend|bring|spare|slip) (?<who>me|us|him|her|them|[a-z]+) (?<rest>(?:a|an|some|your|all|one|two|three|four|five|\d+|the|that|those|this|any|more|my)\b.+|(?:potions?|wood|bread|stew|fish|coins?|gold|money|herbs?|berries|honey cakes?|ore|iron ore|stone|crystals?|food|moonpetals?|turnips?|wheat).*)$/,
      /^(?:give|hand|pass|bring|take|deliver) (?<rest>.+?) (?:to|for) (?<who>.+)$/,
      /^(?:can|could|may) i (?:have|get|borrow|take) (?<rest>.+)$/,
      /^(?:i need|i want|i could use|i would like) (?<rest>(?:a |an |some |your |\d+ )?(?:potion|health potion|healing potion|potions|food|something to eat|bread|fish|stew|honey cake|berries|wood|herbs?|coins?|money|gold|cooked fish))$/,
    ],
    slots(m, c, env) {
      const who = m.groups.who ? whoRef(m.groups.who, env, 'player') : 'player';
      if (who === 'lyra') return null;
      const { qty, item, raw, all } = extractQuantityItem(m.groups.rest);
      if (!raw || /^(?:it|that|this|them|those|these|everything|something|over)$/.test(raw) || /^over\b/.test(raw)) return null;
      let it = item;
      if (!it && /something to eat|food|snack/.test(raw)) it = bestFood(env.inventory);
      return { who, item: it || raw, qty: all ? null : qty };
    },
    acts: (s) => [act('give_item', s.who, s.item, s.qty)],
  },
  {
    id: 'cmd.heal_me', kind: 'command', command: true, confidence: 0.84,
    patterns: [/^(?:heal|patch|fix) (?:me|me up|my wounds|us|us up)$/, /^(?:i need|need) (?:healing|a heal|to heal|some healing|a potion)$/],
    acts: (s, c, env) => (env.inventory?.count?.('potion') ? [act('give_item', 'player', 'potion', 1)] : []),
  },
  {
    id: 'cmd.use', kind: 'command', command: true, confidence: 0.84,
    patterns: [
      /^(?:drink|quaff|chug|sip) (?:a |an |the |your |some |one )?(?<item>[a-z' ]+)$/,
      /^(?:eat) (?:a |an |the |your |some |one )?(?<item>[a-z' ]+)$/,
      /^(?:heal yourself|patch yourself up|use a potion|take a potion|drink something|eat something|grab a bite|have a bite|have something to eat|drink a potion|eat up|eat|drink)$/,
      /^use (?:a |an |the |your |some |one )?(?<item>potion|healing potion|health potion|bread|stew|berries|honey cake|cooked fish|grilled fish|turnip|fish)$/,
    ],
    slots(m, c, env) {
      const raw = m.groups?.item ? cleanRef(m.groups.item) : null;
      let item = raw ? resolveItemId(raw) : null;
      if (!item) item = /potion|heal|drink/.test(c.core) ? 'potion' : bestFood(env.inventory);
      return { item };
    },
    acts: (s) => [act('use_item', null, s.item)],
  },
  {
    id: 'cmd.interact', kind: 'command', command: true, confidence: 0.82,
    patterns: [/^(?:use|light|ring|pull|push|touch|activate|inspect|examine|open|check|search|read) (?:the |that |this )?(?<obj>well|campfire|fire|anvil|forge|altar|sign|notice board|board|chest|bed|lamp|lantern|statue|barrel|crate|bell|lever|hearth|table)$/],
    slots: (m) => ({ obj: m.groups.obj }),
    acts: (s) => [act('interact', s.obj)],
  },
  {
    id: 'cmd.talk', kind: 'command', command: true, confidence: 0.86,
    patterns: [
      /^(?:talk|speak|chat|go talk|go speak|go chat|have a word|have a chat|catch up) (?:to|with) (?<who>[a-z' ]+?)(?: about (?<topic>.+))?$/,
      /^(?:say (?:hi|hello|good morning|goodbye) to|greet|introduce yourself to|go meet|go say hi to) (?<who>[a-z' ]+)$/,
      /^ask (?<who>[a-z']+(?: [a-z']+)?) (?:about|for|regarding|if|whether) (?<topic>.+)$/,
    ],
    slots(m, c, env) {
      const who = whoRef(m.groups.who, env);
      if (!who || who === 'player' || who === 'lyra' || NOT_A_PERSON.test(who)) return null;
      return { who, topic: m.groups.topic ? cleanRef(m.groups.topic) : null };
    },
    acts: (s) => [act('talk_to', s.who, s.topic)],
  },
  {
    id: 'cmd.relationship', kind: 'command', command: true, confidence: 0.85,
    patterns: [
      /^(?<who>[a-z' ]{2,30}?) (?:is|are) (?:a |an |my |our |your |the )?(?<tag>friend|friends|ally|allies|enemy|enemies|foe|foes|rival|pet|family|mentor)$/,
      /^(?:treat|consider|mark|count|think of|regard) (?<who>[a-z' ]+?) (?:as )?(?:a |an |our |my )?(?<tag>friend|enemy|ally|foe|rival|pet|family)$/,
      /^(?:befriend|make friends with) (?<who>[a-z' ]+)$/,
      /^(?:do not|never) trust (?<who>[a-z' ]+)$/,
      /^(?:adopt|name) (?<who>the cat|that cat|the dog|that dog|the rabbit|the chicken|it)$/,
    ],
    slots(m, c, env) {
      const who = whoRef(m.groups.who, env);
      if (!who || NOT_A_PERSON.test(who) || who === 'lyra' || who === 'player') return null;
      let tag = m.groups.tag ? REL_TAGS[m.groups.tag] : /^(?:befriend|make friends)/.test(c.core) ? 'friend' : /^(?:adopt|name)/.test(c.core) ? 'pet' : null;
      let amount = tag ? REL_AMOUNT[tag] : -10;
      if (/^(?:do not|never) trust/.test(c.core)) {
        tag = null;
        amount = -10;
      }
      return { who: cleanRef(who), tag, amount };
    },
    acts: (s) => [act('set_relationship', s.who, s.tag, s.amount)],
  },
  {
    id: 'cmd.remember', kind: 'command', command: true, confidence: 0.84,
    patterns: [/^(?:remember|note|keep in mind|do not forget|never forget|make a note|write down|take note|mark down|note down)(?: that| this| of| to)?[:,]? (?<text>.{3,})$/],
    slots(m, c, env) {
      if (c.question) return null;
      const text = m.groups.text.trim();
      if (/^(?:when|the time|how|what|that time|me)\b/.test(text)) return null;
      const about = (env.knownNames || []).find((n) => new RegExp(`\\b${escapeRe(n)}\\b`).test(text)) || null;
      return { text, about };
    },
    acts: (s) => [act('remember', s.about, s.text, 6)],
  },
  {
    id: 'cmd.forget', kind: 'command', command: true, confidence: 0.84,
    patterns: [/^(?:forget|forget about|erase|delete the memory of|disregard what i said about) (?<text>.{3,})$/],
    slots: (m) => (/^(?:it|that|this|about it|it all|everything|that one)$/.test(m.groups.text.trim()) ? null : { text: m.groups.text.trim() }),
    acts: (s) => [act('forget', null, s.text)],
  },
  {
    id: 'cmd.goal', kind: 'command', command: true, confidence: 0.84,
    patterns: [
      /^(?:set|add|make|give yourself)(?: a| yourself a| it)? (?:new |personal )?goal(?: to| of|:)? (?<goal>.{3,})$/,
      /^(?:your (?:new )?goal is(?: to)?|your mission is(?: to)?|your task is(?: to)?|make it your goal to|make it a goal to|i want you to aim to) (?<goal>.{3,})$/,
    ],
    slots: (m) => ({ goal: m.groups.goal.trim() }),
    acts: (s) => [act('set_goal', null, s.goal, 0.6)],
  },
  {
    id: 'cmd.complete_goal', kind: 'command', command: true, confidence: 0.82,
    patterns: [/^(?:mark|cross off|tick off|consider) (?<goal>.+?) (?:as )?(?:done|complete|completed|finished)$/, /^(?:you (?:have |already )?(?:finished|completed|achieved)) (?:your goal (?:to |of )?)?(?<goal>.{3,})$/],
    slots: (m) => ({ goal: m.groups.goal.trim() }),
    acts: (s) => [act('complete_goal', null, s.goal)],
  },
  {
    id: 'cmd.express', kind: 'command', command: true, confidence: 0.82,
    patterns: [/^(?:look|be|act|get|show me (?:you are |that you are )?|show|pretend to be|make a) (?<emo>happy|sad|angry|mad|scared|afraid|surprised|proud|curious|embarrassed|shy|excited|cheerful|grumpy|loving)(?: face)?$/],
    slots: (m) => ({ emotion: EMOTIONS[m.groups.emo] || 'joy' }),
    acts: (s) => [act('express', null, s.emotion, 0.6)],
  },
  {
    id: 'cmd.follow', kind: 'command', command: true, confidence: 0.9,
    patterns: [
      /^(?:follow|accompany|escort|tail|shadow)(?: (?<who>.+?))?$/,
      /^(?:come|walk|tag along|stick|go|travel|ride) (?:with|along with|alongside) (?<who2>me|us)$/,
      // An invitation with a destination ("come with me to the forest?") is still company.
      /^(?:come|walk|tag along|go|travel|ride) (?:with|along with) (?<who3>me|us) (?:to|into|towards?|through|as far as|down to|up to|out to) (?<dest>.+)$/,
      /^(?:come on|come along|let us go|let us move|let us head out|let us get going|let us roll|move out|on me|with me|keep up|stay with me|you are with me|let us be off|onward|forward|let us move on|follow my lead|tag along|come with)$/,
    ],
    slots(m, c, env) {
      const raw = (m.groups?.who || m.groups?.who2 || m.groups?.who3 || 'me').replace(/\s+(?:closely|close|from a distance|at a distance|from afar|from behind)$/, '') || 'me';
      if (/^(?:the |that )?(?:road|path|river|stream|trail)\b/.test(raw)) return null;
      const who = whoRef(raw, env, 'player');
      if (who === 'lyra') return null;
      const distance = /\bclose(?:ly)?\b/.test(c.core) ? 'close' : /\b(?:distance|afar|far)\b/.test(c.core) ? 'far' : null;
      return { who, distance };
    },
    acts: (s) => [act('follow', s.who, s.distance)],
  },
  {
    id: 'cmd.come', kind: 'command', command: true, confidence: 0.9,
    patterns: [/^(?:come|get|run|hurry|walk|move|head) (?:over )?(?:here|to me|back here|back to me|over to me|over|back|this way)$/, /^(?:over here|here|to me|come back|get over here|come here|come|this way|hither|on me now|back to me)$/],
    acts: () => [act('come_here')],
  },
  {
    id: 'cmd.goto', kind: 'command', command: true, confidence: 0.86,
    patterns: [
      /^(?:go|head|run|walk|travel|get|move|make your way|hurry|sneak|return|proceed|wander|set off|lead (?:me|us)|take (?:me|us)) (?:back |over |on |ahead |up |down |on over |back over )?(?:to|into|towards?|toward|for|inside|in|over to|down to|up to|out to) (?<place>.+)$/,
      /^(?:meet me|wait for me|find me|join me) (?:at|in|by|near) (?<place>.+)$/,
      /^(?:let us|we should|shall we|we could|why do not we|how about we) (?:go|head|walk|travel|make our way|get) (?:back |over |on |down |up )?(?:to|into|towards?|toward|over to|down to|up to|out to) (?<place>.+)$/,
      /^(?:go|head) (?<place>(?:inside|outside|indoors|outdoors))$/,
    ],
    slots(m, c, env) {
      const place = cleanRef(m.groups.place);
      if (!place || /^(?:bed|sleep|work|war|it|that|there)$/.test(place)) return null;
      const who = whoRef(place, env, null);
      const together = /^(?:return|lead|take|let us|we should|shall we|we could|why do not we|how about we)\b/.test(c.core) || /^(?:let us|we should|shall we|we could|why do not we|how about we)\b/.test(c.norm);
      return { place: who === 'player' ? 'player' : place, then: /^(?:meet me|wait for me|find me|join me)/.test(c.core) ? 'stay' : together ? 'follow' : 'stay' };
    },
    acts: (s) => [s.place === 'player' ? act('come_here') : act('goto', s.place, s.then)],
  },

  // ------------------------------------------------------- questions
  {
    id: 'ask.plan', kind: 'question', confidence: 0.86,
    patterns: [/^(?:what (?:is|are) your plans?(?:(?: for)? (?:today|tonight|the day|this morning|this afternoon|this evening))?|what is the plan(?: for)?(?: today| tonight)?|what are you (?:doing|up to|planning) (?:today|tonight|this morning|this afternoon|this evening|later)|what will you do (?:today|tonight|later)|do you have (?:any )?plans(?: today| for today| tonight)?|what is on your (?:agenda|schedule)(?: today)?|where are you (?:going|headed) (?:today|tonight|later)|what is your day like)$/],
  },
  {
    id: 'ask.fear_me', kind: 'question', confidence: 0.87,
    patterns: [/^(?:are you (?:still )?(?:afraid|scared|frightened) of me|do you fear me|do i (?:scare|frighten) you|am i scaring you)$/],
  },
  {
    id: 'ask.trust_me', kind: 'question', confidence: 0.87,
    patterns: [/^(?:do you (?:still )?trust me|can you trust me|do you believe me|are we (?:still )?(?:ok|okay|good|alright|all right))$/],
  },
  {
    id: 'ask.why_left', kind: 'question', confidence: 0.86,
    patterns: [/^(?:why did you (?:leave|go|walk away)(?: me)?|why are you (?:leaving|avoiding me|so distant|keeping your distance|angry with me|upset with me|mad at me|acting like this)|why do you keep (?:watching|avoiding) me|what did i do(?: wrong)?|are you (?:angry|mad|upset) (?:at|with) me)$/],
  },
  {
    // Only means something right after she said no.
    id: 'ask.why_refused', kind: 'question', confidence: 0.86,
    patterns: [/^(?:why not|why|why no|why will you not|why would you not|why did you (?:refuse|say no)|why are you refusing|what is wrong with that|why can you not|how come|but why)$/],
    slots: (m, c, env) => (env.recentRefusal ? {} : null),
  },
  {
    id: 'ask.feelings', kind: 'question', confidence: 0.88,
    patterns: [
      /^(?:how (?:are|is) (?:you|lyra)(?: (?:doing|feeling|holding up|keeping|today|now|tonight|lately|these days|after that))*|how do you feel(?: now| today)?|how (?:is it going|are things|have you been|is life|are you holding up|is everything)|is (?:something|anything|everything) (?:wrong|okay|alright|ok)|what is (?:wrong|the matter|bothering you|eating you|up with you)|feeling (?:ok|okay|alright|better|good)|what is up|whats up|wassup|you good|you alright|you okay|you ok|how are we doing)$/,
      /^(?:are you|you) (?:ok|okay|alright|all right|fine|good|well|doing ok|doing okay|doing alright|holding up)(?: now| there)?$/,
      /^(?:are you|you|do you feel|are you feeling|you feeling) (?:very |a bit |so |really )?(?<state>hurt|injured|wounded|tired|sleepy|exhausted|hungry|starving|scared|afraid|frightened|happy|sad|angry|mad|lonely|bored|cold|upset|worried|nervous|ready|excited)$/,
    ],
    slots: (m) => ({ state: m.groups?.state || null }),
  },
  {
    id: 'ask.thoughts', kind: 'question', confidence: 0.86,
    patterns: [/^(?:what are you thinking(?: about)?|what is on your mind|penny for your thoughts|what are you pondering|what are you daydreaming about|what is going through your head|thoughts|what do you think about all this|what do you make of (?:all )?this)$/],
  },
  {
    id: 'ask.opinion', kind: 'question', confidence: 0.86,
    patterns: [
      /^(?:what do you think (?:of|about)|how do you feel about|what is your opinion (?:of|on|about)|your opinion (?:of|on)|thoughts on|what about|what do you make of|how do you like|do you (?:like|trust|hate|dislike|care about|know|love|admire|respect|fear)) (?<who>.+)$/,
      /^(?:is|are) (?<who>[a-z' ]+?) (?:nice|good|trustworthy|a good person|kind|mean|dangerous|ok|okay|friendly|reliable|a friend|your friend|cool|weird|strange|someone we can trust)$/,
      /^(?:are we|am i) (?<who2>friends|close|ok|okay|good|your friend|special to you)$/,
      /^(?:what am i to you|what are we|how do we stand|where do we stand)$/,
    ],
    slots(m, c, env) {
      if (m.groups?.who2 || /^(?:what am i|what are we|how do we|where do we)/.test(c.core)) return { who: 'player' };
      const who = whoRef(m.groups.who, env);
      if (!who) return null;
      return { who, verb: (c.core.match(/^do you (like|trust|hate|dislike|care about|know|love|admire|respect|fear)/) || [])[1] || null };
    },
  },
  {
    id: 'ask.memory', kind: 'question', confidence: 0.86,
    patterns: [
      /^(?:do|can|did) you (?:still )?remember (?<topic>.+)$/,
      /^(?:remember|recall) (?:when|the time|that time|how) (?<topic2>.+)$/,
      /^what do you remember(?: about (?<topic3>.+))?$/,
      /^(?:remind me (?:about|of|what) (?<topic4>.+))$/,
      /^(?:what was|tell me about) (?:the time|that time) (?<topic5>.+)$/,
    ],
    slots: (m) => ({ topic: cleanRef(m.groups?.topic || m.groups?.topic2 || m.groups?.topic3 || m.groups?.topic4 || m.groups?.topic5 || '') || null }),
  },
  {
    id: 'ask.today', kind: 'question', confidence: 0.86,
    patterns: [/^(?:what (?:happened|did we do|have we done|did you do|did you see|did you learn)(?: today| so far| recently| lately| yesterday| last night)?|how was (?:your|our|the) day|how (?:has|was) today|what is new|anything new|tell me about (?:your|our|the) day|summarize (?:today|the day)|any news|what is the news)$/],
  },
  {
    id: 'ask.status', kind: 'question', confidence: 0.86,
    patterns: [
      /^(?:what are you (?:doing|up to|working on|busy with)|what is your (?:status|current (?:order|task|job|mode))|what are your (?:orders|current orders)|what (?:mode|stance) are you(?: in)?|status|report|status report|sitrep|where are you going|what were you doing|what is your (?:task|job|plan right now|order)|are you (?:following me|fighting|working|busy|in attack mode|on a job))$/,
    ],
  },
  {
    id: 'ask.inventory', kind: 'question', confidence: 0.86,
    patterns: [
      /^(?:what (?:do you have|are you (?:carrying|holding)|have you got|is in your (?:bag|pack|pockets?|inventory|satchel|pouch)|do you carry)|show me (?:your )?(?:bag|pack|inventory|items|what you have)|(?:your )?inventory|check your (?:bag|pack|inventory|pockets))$/,
      /^(?:do you have|have you got|got|are you carrying) (?:any |a |an |some )?(?<item>[a-z' ]+?)$/,
      /^how (?:many|much) (?<item2>[a-z' ]+?) (?:do you have|have you got|are you carrying|you got|do you carry|do we have)$/,
    ],
    slots(m) {
      const raw = m.groups?.item || m.groups?.item2 || null;
      if (!raw) return { item: null, raw: null };
      const { item } = extractQuantityItem(raw);
      return { item, raw: cleanRef(raw) };
    },
  },
  {
    id: 'ask.time', kind: 'question', confidence: 0.88,
    patterns: [/^(?:what time is it(?: now)?|what is the time|what hour is it|what day is it|how late is it|is it (?:late|night|day|morning|evening|early|dark)(?: yet)?|what time of day is it|time|how long until (?:night|dark|morning|dawn|sunrise|sunset)|do you know (?:the|what) time(?: it is)?)$/],
  },
  {
    id: 'ask.weather', kind: 'question', confidence: 0.86,
    patterns: [/^(?:how is the weather|what is the weather(?: like)?|is it (?:raining|going to rain|foggy|cloudy|clear|sunny|cold|warm)|will it rain|nice weather|weather|lovely weather|what a storm|nice day(?: today)?|lovely day)$/],
  },
  {
    id: 'ask.where', kind: 'question', confidence: 0.86,
    patterns: [/^(?:where are we(?: now)?|where am i|what is this place|what place is this|where is this|what is here|tell me about this place|what do you know about this place|describe this place|what do you think of this place|what is around here|anything interesting (?:here|around here))$/],
  },
  {
    id: 'ask.past', kind: 'question', confidence: 0.86,
    test(c) {
      const t = c.core;
      const table = [
        ['secret', /^(?:tell me a secret|do you have (?:a|any) secrets?|what are you hiding|what is your secret|share a secret)$/],
        ['family', /^(?:tell me about|do you have|what about|what happened to|who is|who was|who are|where are|where is|how are) (?:a |any |your )?(?:family|siblings|brother|little brother|sister|parents|folks|mother|father|mom|dad|mum|mam|da|ma|pa)$|^(?:do you have (?:any )?(?:brothers|sisters|siblings|kids|children))$|^(?:are your parents (?:alive|still alive|here|in hearthvale|around)|do your parents live (?:here|in hearthvale|nearby)|where do your parents live|what do your parents do|who are your folks)$/],
        ['maren', /^(?:who is maren(?: ashgrove)?|tell me about maren|who is your (?:mentor|teacher|master)|what happened to maren|where is maren|tell me about your (?:mentor|teacher)|why are you looking for maren|what was maren like|is maren alive|do you think maren is alive)$/],
        ['meet', /^(?:how did we meet|when did we meet|do you remember how we met|where did we meet|why do you (?:follow|travel with|stay with) me|why are you with me|why did you join me|how did you find me|where did you find me|who found me|how was i found|where was i found|where did i come from|where do i come from|how did i get here|how did i get to hearthvale|what happened to me|why was i asleep|why did i sleep so long|why do i not remember anything|who am i|what do you know about me|tell me how you found me|tell me about the mountain|what happened on the mountain)$/],
        ['glasswater', /^(?:tell me about|what are|what is|where are|where is|have you been to|did you grow up (?:on|in)|are you from) (?:the )?(?:glasswater isles|glasswater|isles|islands|glasswater islands)(?: like)?$|^(?:are you from (?:the )?(?:islands|isles|sea|coast))$/],
        ['origin', /^(?:where are you from|where do you come from|where did you grow up|where is your home|where were you born|where do you live|tell me about (?:your )?(?:home|homeland|hometown|your village|hearthvale|the chandlery|lamplight lane)|what is (?:your home|hearthvale|your village) like|are you from (?:here|hearthvale)|were you born here|did you grow up here)$/],
        ['leave', /^(?:(?:are|were) you (?:going to|gonna|ever going to|planning to|thinking of|thinking about) leav(?:e|ing)|(?:will|would|could|do) you (?:ever )?(?:want to )?leave|do you want to leave|have you (?:ever )?thought (?:of|about) leaving|why (?:don't|do not) you leave) (?:hearthvale|the village|the valley|home|your village|your home|this village|this place)$/],
        ['self', /^(?:tell me about yourself|who are you|what is your story|tell me your story|what is your (?:past|history|background)|tell me about your (?:past|life|childhood)|describe yourself|what are you like|what kind of person are you)$/],
        ['age', /^(?:how old are you|what is your age|when is your birthday)$/],
        ['name', /^(?:what is your (?:full )?name|what are you called|who are you called|what should i call you|is lyra your real name)$/],
        ['why', /^(?:why are you (?:here|in hearthvale)|why did you come(?: here| to hearthvale)?|what brought you (?:here|to hearthvale)|what are you doing (?:here|in hearthvale)|why do you (?:live|stay) (?:here|in hearthvale)|why did you take the hearthwatch|why are you watching me|why do you have the key)$/],
        ['magic', /^(?:(?:tell me about|how does|explain) (?:your )?magic(?: work)?|how do you do magic|teach me (?:magic|a spell)|are you a (?:mage|witch|wizard|ranger|sorceress|lumencrafter)|what is an arcane\s+ranger|what can your magic do|show me (?:some )?magic|where did you learn magic|what (?:kind of |sort of )?magic (?:do you (?:use|do|have|know|cast|practice)|is (?:that|yours|your magic))|what kind of mage are you|what are your spells|what spells (?:do you know|can you cast)|what is (?:a |an )?lumencraft(?:er)?|what is your magic(?: called)?|how does lumencraft work|what is lamp chill|why are you always cold)$/],
        ['likes', /^(?:what do you (?:like|love|enjoy)(?: doing| to do)?|what makes you happy|what are your (?:likes|hobbies|interests)|what is your hobby|what do you do for fun)$/],
        ['dislikes', /^(?:what do you (?:hate|dislike|not like|despise)|what annoys you|what makes you angry|what are your dislikes|what bothers you)$/],
        ['fears', /^(?:what are you (?:afraid|scared) of|what scares you|what do you fear|are you afraid of anything|can you swim|what is your (?:fear|greatest fear|weakness)|what are your fears)$/],
        ['dreams', /^(?:what do you (?:dream (?:of|about)|wish for|hope for|want (?:most|in life|to do with your life))|what is your dream|what are your dreams|what do you want to be|what would you do if you found maren)$/],
        ['values', /^(?:what do you (?:believe in|value|stand for)|what matters to you|what are your values|what is important to you)$/],
        ['favorite', /^what is your fav(?:ou?rite|e) (?<fav>[a-z ]+)$/],
      ];
      for (const [topic, re] of table) {
        const m = re.exec(t);
        if (m) return { m, slots: { topic, fav: m.groups?.fav || null } };
      }
      // Questions the modal head would otherwise turn into orders ("would you ever leave the
      // village?", "can you swim?"): read them whole.
      const n = String(c.norm || '').replace(/[?!.]+$/, '').trim();
      if (/^(?:will|would|could|can|do) you (?:ever )?(?:want to )?leave (?:hearthvale|the village|the valley|home|your village|your home|this village)$/.test(n)) return { m: [n], slots: { topic: 'leave', fav: null } };
      if (/^(?:can|could|do) you swim$/.test(n)) return { m: [n], slots: { topic: 'fears', fav: null } };
      return null;
    },
  },
  {
    id: 'ask.quest', kind: 'question', confidence: 0.85,
    patterns: [/^(?:what (?:should|do|can|shall) (?:we|i) do(?: now| next| today| here| about maren)?|what now|what next|what is next|what is (?:our|the) (?:plan|goal|quest|mission|objective|next step)|where (?:should|do|shall) (?:we|i) go(?: next| now)?|any (?:ideas|plans|suggestions)|what are we (?:doing|looking for)|what is the plan|i am (?:lost|stuck)|help me|what do we do|how can i help(?: you)?|how do (?:i|we) (?:help you|find maren)|how do we get into the ruins|what is the quest)$/],
  },
  {
    id: 'ask.goals', kind: 'question', confidence: 0.85,
    patterns: [/^(?:what are your goals|what is your goal|what are you (?:working towards|hoping for|trying to do)|what do you want to do(?: next)?|what are you after)$/],
  },
  {
    id: 'ask.can_do', kind: 'question', confidence: 0.85,
    patterns: [/^(?:what can you do|what are you able to do|help|commands|what do you know how to do|what are your (?:skills|abilities|talents)|how do i (?:give you orders|command you|talk to you)|what can i ask you(?: to do)?|what orders can you take)$/],
  },
  {
    id: 'ask.who', kind: 'question', confidence: 0.84,
    patterns: [/^(?:who (?:is|are|was)|tell me about|what do you know about|have you met|what is the deal with|what is the story with|do you know anything about|who lives in|who runs) (?<topic>.+)$/],
    slots: (m, c, env) => {
      const topic = cleanRef(m.groups.topic);
      return topic && !/^(?:you|yourself|me)$/.test(topic) ? { topic: whoRef(topic, env, topic) } : null;
    },
  },
  {
    id: 'ask.where_is', kind: 'question', confidence: 0.84,
    patterns: [/^(?:where (?:is|are|can i find|do i find|would i find|could i find|might i find)|how do (?:i|we) get to|which way (?:is|to)|how far is|how far to|where does) (?<topic>.+?)(?: live| work| from here)?$/],
    slots: (m) => ({ topic: cleanRef(m.groups.topic) }),
  },
  {
    id: 'ask.what_is', kind: 'question', confidence: 0.8,
    patterns: [/^what (?:is|are) (?:a |an |the )?(?<topic>[a-z' ]{3,40})$/],
    slots: (m) => (/^(?:this|that|it|up|wrong|happening|going on|next|new)$|^(?:my|our|your)\b/.test(m.groups.topic) ? null : { topic: cleanRef(m.groups.topic) }),
  },

  // ------------------------------------------------------- social
  {
    id: 'social.greet', kind: 'social', confidence: 0.85,
    patterns: [/^(?:hi|hello|hey|heya|hiya|howdy|greetings|yo|hullo|hallo|good (?:morning|afternoon|evening|day)|morning|evening|afternoon|well met|salutations|sup|hey hey|hello hello|hey you|oh hi)(?: there)?(?: (?:friend|you|again|buddy|pal|partner|stranger|beautiful|sunshine))?$/],
    slots: (m, c) => ({ part: /morning/.test(c.core) ? 'morning' : /evening/.test(c.core) ? 'evening' : /afternoon/.test(c.core) ? 'afternoon' : null }),
  },
  { id: 'social.goodnight', kind: 'social', confidence: 0.86, patterns: [/^(?:good ?night|night night|nighty night|sleep (?:well|tight)|sweet dreams|nite|night)$/] },
  {
    id: 'social.farewell', kind: 'social', confidence: 0.85,
    patterns: [/^(?:bye|bye bye|goodbye|good bye|farewell|see you(?: later| soon| around| tomorrow)?|see ya|later|catch you later|i am (?:leaving|off|going)|take care|cya|so long|until later|i have to go|i must go|talk later|talk to you later|ttyl)$/],
  },
  {
    id: 'social.thanks', kind: 'social', confidence: 0.86,
    patterns: [/^(?:thanks?|thank you|thanks so much|thank you so much|thanks a lot|thank you very much|thanks again|cheers|much appreciated|i appreciate (?:it|that|you|your help)|appreciate it|many thanks|you are a lifesaver|you saved me|thank you for (?<for>.+)|thanks for (?<for2>.+))$/],
  },
  {
    id: 'social.praise', kind: 'social', confidence: 0.85,
    patterns: [/^(?:good (?:job|work|shot|fighting|hustle|going)|well done|nice (?:job|work|shot|going|moves|aim|fighting|hit|throw|spell)|great (?:job|work|shot|teamwork|fighting)|excellent(?: work)?|bravo|impressive|amazing (?:work|job|shot)|you did (?:great|well|good|amazing|it)|that was (?:amazing|awesome|great|impressive|incredible|cool|brilliant)|nicely done|perfect|awesome|you are (?:a )?(?:great|good|amazing|excellent) (?:fighter|shot|archer|mage|ranger|cook|companion|partner|friend)|we did it|we make a good team|good teamwork)$/],
  },
  {
    id: 'social.compliment', kind: 'social', confidence: 0.82,
    patterns: [
      /^(?:you are|you seem|you look) (?:so |really |very |such a |quite |pretty |the )?(?:amazing|awesome|great|wonderful|smart|clever|brave|strong|funny|kind|sweet|cool|incredible|the best|best|talented|wise|nice|lovely|good|tough|fierce|skilled|reliable|helpful|a good friend|my best friend|special|interesting|fun)\b/,
      /^(?:i like|i love|nice|lovely|great|cool) (?:your|the way you) (?:hair|eyes|cloak|magic|smile|laugh|voice|style|outfit|bow|spells?|freckles|jokes|attitude|company|stories)$/,
      /^(?:i am glad (?:you are here|you are with me|i met you|we met)|i am lucky to have you|glad to have you|you are the best|best companion ever|you are my (?:best )?friend|we are (?:friends|a team|partners|a good team)|i trust you)$/,
    ],
  },
  {
    id: 'social.apology', kind: 'social', confidence: 0.86,
    patterns: [
      /^(?:sorry|so sorry|i am sorry|i am so sorry|i apologi[sz]e|my bad|forgive me|i did not mean (?:it|that)|i was wrong|my apologies|apologies|oops|i am sorry for (?:what i said|that|earlier|being rude|being mean))(?: lyra)?$/,
      /^(?:i am (?:so |really |truly |very |deeply )?sorry(?: for .{1,60})?|please forgive me|forgive me(?: please)?|can you forgive me|will you forgive me|it was an accident|that was an accident|i did not mean to(?: .{1,50})?|it will not happen again|i will never do (?:it|that) again|i messed up|i was wrong(?: .{1,50})?|i regret (?:it|that|what i did))$/,
    ],
    slots: (m, c) => ({ accident: /accident|did not mean/.test(c.core), vow: /never|not happen again/.test(c.core) }),
  },
  { id: 'social.joke', kind: 'social', confidence: 0.86, patterns: [/\b(?:tell (?:me |us )?(?:a |another )?joke|know any jokes|make me laugh|say something funny|another joke|got any jokes|cheer me up|be funny)\b/, /^joke$/] },
  { id: 'social.story', kind: 'social', confidence: 0.85, patterns: [/\b(?:tell (?:me |us )?(?:a |another )?story|story time|know any stories|tell me something interesting|entertain me|tell me a tale|tell me about the old days)\b/] },
  { id: 'social.song', kind: 'social', confidence: 0.85, patterns: [/^(?:sing(?: me)?(?: a song| something| for me| us a song)?|can you sing|do you sing|hum something|hum a tune|play (?:a song|some music)|sing again)$/] },
  { id: 'social.laugh', kind: 'social', confidence: 0.82, patterns: [/^(?:ha(?:ha)+h?|he(?:he)+|lol|lmao|rofl|lmfao|hah|heh|that is (?:funny|hilarious)|so funny|good one|you are (?:so )?funny|haha good one|very funny|nice one|xd)$/] },
  { id: 'social.careful', kind: 'social', confidence: 0.82, patterns: [/^(?:be careful|careful|watch out|look out|stay safe|be safe|take care of yourself|watch your step|mind yourself|do not die|do not get hurt)$/] },
  { id: 'social.quiet', kind: 'social', confidence: 0.82, patterns: [/^(?:be quiet|quiet|hush|shh+|silence|stop talking|quiet down|keep it down|zip it|less talking)$/] },
  {
    id: 'social.player_feeling', kind: 'social', confidence: 0.84,
    patterns: [/^(?:i am|i feel|i am feeling|feeling|i am so|i am really|i am very|i am kind of|i am a bit|i feel so|i am getting|i am a little) (?<feel>sad|down|upset|depressed|miserable|lonely|alone|tired|exhausted|sleepy|hungry|starving|scared|afraid|frightened|nervous|worried|anxious|happy|glad|great|good|excited|bored|hurt|injured|wounded|sick|cold|lost|angry|mad|frustrated)$/],
    slots: (m) => ({ feeling: FEELINGS[m.groups.feel] || 'sad', word: m.groups.feel }),
  },
  {
    id: 'social.set_name', kind: 'social', confidence: 0.86,
    patterns: [/^(?:my name is|call me|i am called|you can call me|name is|i go by|my name's) (?<name>[a-z][a-z'-]{0,15}(?: [a-z][a-z'-]{0,15})?)$/],
    slots: (m) => ({ name: m.groups.name.replace(/\b\w/g, (ch) => ch.toUpperCase()) }),
  },
  { id: 'social.my_name', kind: 'social', confidence: 0.86, patterns: [/^(?:what is my name|do you (?:know|remember) my name|who am i|say my name)$/] },
  { id: 'social.yes', kind: 'social', confidence: 0.8, patterns: [/^(?:yes|yeah|yep|yup|yes please|sure|ok|okay|alright|all right|fine|of course|certainly|absolutely|definitely|agreed|right|indeed|sounds good|deal|got it|understood|cool|nice|great|k|kk|good|very well|aye|true)$/] },
  { id: 'social.no', kind: 'social', confidence: 0.8, patterns: [/^(?:no|nope|nah|not really|no thanks|no thank you|never|no way|i do not think so|not now|maybe later|never mind|nevermind|forget it|nothing)$/] },
  { id: 'social.name_call', kind: 'social', confidence: 0.8, patterns: [/^(?:lyra|psst|oi|excuse me|hey you|listen)$/] },
];

export function bestFood(inv) {
  if (!inv?.count) return 'berries';
  for (const id of ['potion', 'stew', 'cooked_fish', 'honey_cake', 'bread', 'turnip', 'berries']) if (inv.count(id) > 0) return id;
  return 'berries';
}

// ------------------------------------------------------------------ parsing

function execPattern(re, s) {
  if (!re || typeof re.exec !== 'function' || !s) return null;
  if (re.global || re.sticky) re.lastIndex = 0;
  try {
    return re.exec(s);
  } catch {
    return null;
  }
}

function validActions(list, env) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const a of list) {
    if (!a || typeof a.name !== 'string') continue;
    if (env.has && !env.has(a.name)) return null; // a missing action disqualifies the intent
    out.push({ name: a.name, args: a.args ? { ...a.args } : { target: a.target ?? null, value: a.value ?? null, amount: a.amount ?? null } });
  }
  return out;
}

// Plugin intents (DESIGN §11). Also accepts the older { action: 'name' | fn, reply } form.
function matchPlugin(c, env) {
  for (const intent of env.intents || []) {
    const patterns = Array.isArray(intent.patterns) ? intent.patterns : intent.pattern ? [intent.pattern] : [];
    for (const re of patterns) {
      const m = execPattern(re, c.raw) || execPattern(re, c.norm) || execPattern(re, c.core);
      if (!m) continue;
      let actions = [];
      try {
        if (typeof intent.actions === 'function') actions = intent.actions(m, env.ctx) || [];
        else if (typeof intent.action === 'string') actions = [{ name: intent.action, args: { ...(m.groups || {}) } }];
        else if (typeof intent.action === 'function') actions = intent.action(m, c.raw, env.ctx) || [];
      } catch (err) {
        env.onError?.(intent, err);
        continue;
      }
      const valid = validActions(actions, env);
      if (!valid) continue;
      const answer =
        typeof intent.answer === 'function'
          ? (results) => intent.answer(m, env.ctx, results)
          : typeof intent.reply === 'function'
            ? (results) => intent.reply(m, env.ctx, results)
            : typeof intent.reply === 'string'
              ? () => intent.reply
              : null;
      const command = !!intent.command;
      return {
        id: intent.id || `${intent.plugin || 'plugin'}.intent`,
        source: 'plugin',
        plugin: intent.plugin || null,
        kind: command ? 'command' : valid.length ? 'command' : 'question',
        command,
        confidence: Number.isFinite(intent.confidence) ? intent.confidence : 0.85,
        match: m,
        slots: { ...(m.groups || {}) },
        actions: valid,
        answer,
      };
    }
  }
  return null;
}

// "What is the Wellstone?" / "what's a wardstone?" / "tell me about the Drift": words of the
// world's lore (story.js `world` entries by title or alias, and the titles of its places and
// its history: "the Sunken Ruins", "the Greywinter") are answered from what she knows (the
// memory plugin's mem.know, LORE's telling) before a place or an item with a similar name
// catches them. People keep their own questions.
const LORE_Q = /^(?:what (?:is|are|was|were) (?:a |an |the )?(?<q>[a-z', -]{3,40})|tell me about (?:a |an |the )?(?<q2>[a-z', -]{3,40}))$/;
function loreTermKey(t) {
  return String(t || '').toLowerCase().replace(/[“”"'’]/g, '').replace(/^(?:the|a|an) /, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().replace(/(?:es|s)$/, '');
}
const loreTermCache = new WeakMap();
function loreTerms(lb) {
  let set = loreTermCache.get(lb);
  if (set) return set;
  set = new Set();
  for (const e of lb.all?.('world') || []) {
    for (const t of [e.title, ...(e.aliases || []), ...String(e.title).split(/ and |, /)]) {
      const k = loreTermKey(t);
      if (k.length >= 3) set.add(k);
    }
  }
  for (const e of [...(lb.all?.('place') || []), ...(lb.all?.('timeline') || [])]) {
    for (const t of [e.title, e.locationId && e.locationId !== 'hearthvale' ? String(e.locationId).replace(/_/g, ' ') : null]) {
      const k = loreTermKey(t);
      if (k.length >= 3 && !/^(?:now|three years ago|player home)$/.test(k)) set.add(k);
    }
  }
  loreTermCache.set(lb, set);
  return set;
}
// Something she knows by name that is not a person ("tell me about the wolves" -> her memory
// of the wolves on the King's Road): what she knows, told in her voice, rather than a raw note.
function knownByName(mind, lb, q) {
  const k = loreTermKey(q);
  if (k.length < 4 || typeof mind?.loreLookup !== 'function') return false;
  try {
    return mind.loreLookup(q).entries.some((e) => {
      if (e.kind !== 'life' && lb.get?.(e.loreId)?.kind === 'person') return false;
      return loreTermKey(e.subject).includes(k);
    });
  } catch {
    return false;
  }
}
const BRIGHTBORN_Q = /^(?:are you (?:brightborn|drift[ -]?touched|a changeling|touched by the drift)|is it true you are (?:brightborn|drift[ -]?touched)|why is your hair blue|why is your (?:magic|light) (?:violet|purple))$/;
function matchLoreQuestion(c, env) {
  // Her own life has its own answers ("tell me about Glasswater": Maren's home, not hers).
  if (BUILTIN_INTENTS.find((i) => i.id === 'ask.past')?.test?.(c)) return null;
  const bright = BRIGHTBORN_Q.test(c.core);
  const m = bright ? Object.assign([c.core], { groups: { q: 'is lyra brightborn' } }) : LORE_Q.exec(c.core);
  if (!m) return null;
  const q = (m.groups.q || m.groups.q2 || '').trim();
  if (!q || /^(?:your|my|our|this|that|it)\b/.test(q)) return null;
  const lb = env.ctx?.mind?.lorebook;
  const know = (env.intents || []).find((i) => i && i.id === 'mem.know' && typeof i.answer === 'function');
  if (!lb || !know) return null;
  if (!bright && !loreTerms(lb).has(loreTermKey(q)) && !knownByName(env.ctx.mind, lb, q)) return null;
  const match = Object.assign([c.raw], { groups: { q, mode: !bright && /^what /.test(c.core) ? 'what' : null } });
  return {
    id: 'mem.know', source: 'plugin', plugin: know.plugin || 'memory', kind: 'question', command: false,
    confidence: 0.85, match, slots: { q }, actions: [], answer: (results) => know.answer(match, env.ctx, results),
  };
}

function canModify(id, prev) {
  const acts = prev?.intent?.actions || [];
  if (id === 'mod.deliver') return acts.some((a) => a.name === 'start_job');
  if (id === 'mod.then') return acts.some((a) => a.name === 'goto');
  return false;
}

function matchBuiltin(c, env, prev, { modifiersOnly = false } = {}) {
  for (const intent of BUILTIN_INTENTS) {
    if (intent.kind === 'modifier') {
      if (!canModify(intent.id, prev)) continue;
    } else if (modifiersOnly) continue;
    let m = null;
    let slots = null;
    if (intent.test) {
      const r = intent.test(c, env);
      if (!r) continue;
      m = r.m;
      slots = r.slots;
    } else {
      for (const re of intent.patterns) {
        m = execPattern(re, c.core);
        if (m) break;
      }
      if (!m) continue;
      slots = intent.slots ? intent.slots(m, c, env) : { ...(m.groups || {}) };
      if (slots === null) continue;
    }
    let actions = [];
    if (intent.acts) {
      actions = validActions(intent.acts(slots, c, env), env);
      if (!actions) continue;
    }
    return { id: intent.id, source: 'builtin', kind: intent.kind, command: !!intent.command, confidence: intent.confidence ?? 0.85, match: m, slots, actions, answer: null };
  }
  return null;
}

// Apply a modifier clause ("and bring it to me", "and wait there") to the clause before it.
function applyModifier(mod, prev) {
  if (mod.id === 'mod.deliver') {
    const job = prev.intent.actions.find((a) => a.name === 'start_job');
    job.args.target = mod.slots.deliver;
    prev.intent.slots.deliver = mod.slots.deliver;
  } else if (mod.id === 'mod.then') {
    const go = prev.intent.actions.find((a) => a.name === 'goto');
    go.args.value = mod.slots.then;
  }
}

// Run only the built-in intents on an already-parsed clause (used when a plugin
// question matched but offered no answer).
export function matchBuiltinClause(clause, env = {}) {
  const c = { raw: clause.text, norm: clause.norm, core: clause.core, forMe: clause.forMe, question: clause.question };
  return matchBuiltin(c, env, null);
}

function headAddress(text, names) {
  const nameAlt = names.map(escapeRe).join('|');
  const re = new RegExp(`^\\s*(?:(hey|hi|hello|yo|ok|okay|oh|so|um|well|listen)[, ]+)?(?:${nameAlt})\\b[,.!:]?\\s+(?=\\S)`, 'i');
  const m = String(text).match(re);
  if (!m) return { text: String(text), greeted: false };
  return { text: String(text).slice(m[0].length), greeted: !!m[1] && /^(hey|hi|hello|yo)$/i.test(m[1]) };
}

// Parse the player's message. env: { intents, ctx, has(name), inventory, directiveType,
// knownNames, names (Lyra's names), lastPerson, onError }.
export function parseMessage(text, env = {}) {
  const names = (env.names && env.names.length ? env.names : ['lyra']).map((n) => String(n).toLowerCase());
  const head = headAddress(text, names);
  const { offer, rest } = detectOffer(head.text);
  const pieces = splitClauses(rest);
  const clauses = [];
  let greeted = head.greeted;
  let prev = null;
  for (const piece of pieces) {
    const addr = stripAddress(piece.text, names);
    greeted = greeted || addr.greeted;
    const raw = addr.text.replace(/[.!?;,]+$/, '').trim();
    if (!raw) continue;
    const norm = normalize(raw);
    const keepsForMe = /^(?:wait|stay|hold|stand|remain|look|care|watch)\b/.test(norm);
    const forMe = !keepsForMe && /\bfor me\b/.test(norm) && !/^for me$/.test(norm);
    const core = coreForm(forMe ? norm.replace(/\s*\bfor me\b\s*/, ' ').trim() : norm) || norm;
    const question = piece.question || /^(?:what|where|who|how|why|when|which|are you|is it|do you|did you|have you|can i|should|would you|will you|is there|are there)\b/.test(norm);
    const c = { raw, norm, core, forMe, question };
    // Linking clauses ("...and bring it to me") attach to the clause before them.
    const mod = prev ? matchBuiltin(c, env, prev, { modifiersOnly: true }) : null;
    if (mod) {
      applyModifier(mod, prev);
      continue;
    }
    // A question about a word of the lore is answered from her knowledge first, before a
    // plugin reads "Mirror Lake" as a person or a place handler gives its plain description.
    let intent = matchLoreQuestion(c, env);
    if (!intent) intent = matchPlugin(c, env);
    if (!intent) intent = matchBuiltin(c, env, null);
    const clause = { text: raw, norm, core, question, forMe, intent };
    // Remember who was mentioned so "talk to him" works in the next clause.
    const who = intent?.slots?.who;
    if (typeof who === 'string' && who !== 'player' && who !== 'lyra' && who !== 'nearest enemy') {
      if (intent.id === 'cmd.attack') env.lastEnemy = who;
      else env.lastPerson = who;
    }
    clauses.push(clause);
    prev = clause;
  }
  // A coin offer rides on every request whose amount means nothing (DESIGN §16.4).
  if (offer?.coins) {
    for (const cl of clauses) for (const a of cl.intent?.actions || []) if (AMOUNT_FREE.has(a.name) && a.args.amount == null) a.args.amount = offer.coins;
  }
  if (!clauses.length && greeted) {
    clauses.push({ text: String(text), norm: normalize(text), core: 'hi', question: false, forMe: false, intent: { id: 'social.greet', source: 'builtin', kind: 'social', command: false, confidence: 0.85, match: null, slots: {}, actions: [], answer: null } });
  }
  const commands = clauses.filter((cl) => cl.intent && cl.intent.command && cl.intent.confidence >= COMMAND_THRESHOLD && cl.intent.actions.length);
  return {
    text: String(text ?? ''),
    clauses,
    commands,
    greeted,
    offer,
    isQuestion: clauses.some((cl) => cl.question),
    understood: clauses.length > 0 && clauses.every((cl) => !!cl.intent),
  };
}

// Build the NLU environment from the game.
export function nluEnv(game) {
  const ctx = game?.plugins?.ctx || {};
  let intents = [];
  try {
    intents = game?.plugins?.intents?.() || [];
  } catch {
    intents = [];
  }
  const companion = game?.companion || null;
  const names = ['lyra'];
  const cn = String(game?.settings?.companionName || '').toLowerCase().trim();
  if (cn && cn !== 'lyra') names.push(cn);
  const knownNames = [];
  try {
    for (const r of companion?.mind?.relationships?.all?.() || []) {
      if (r?.name) knownNames.push(String(r.name).toLowerCase().split(/\s+/)[0]);
    }
  } catch {
    /* relationships not ready */
  }
  for (const n of ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'gale', 'maren']) if (!knownNames.includes(n)) knownNames.push(n);
  return {
    intents,
    ctx,
    has: (name) => !!game?.actions?.has?.(name),
    inventory: companion?.inventory || null,
    directiveType: companion?.behavior?.directive?.type || null,
    knownNames,
    names,
    companionship: companionshipOf(game),
    recentRefusal: !!game?.brain?.recentRefusal?.(),
    onError: (intent, err) => console.error(`[nlu] intent ${intent?.id} failed`, err),
  };
}
