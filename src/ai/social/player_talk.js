// The player says anything to any villager (DESIGN §19.3 "Talking to anyone", §23 "talk
// to them like I talk with this girl"): the local understanding of what was said, and the
// villager's answer in their own voice. Claude does this better when it is available;
// this is what the village says without it, and it has to be good on its own: "oh hello,
// how are you?" gets a warm, in-character answer, they ask things back, learn the
// player's name once it is told, and bring up what was said last time.
//
// What each villager keeps of the player lives on the village as `v.you` (saved with it):
//   names  {npcId: the name the player told them}
//   notes  {npcId: [{ text, day, t, w }]}  what they remember, as a clause said to the
//          player ("you asked me about the bandits"), weight w
//   asked  {npcId: [question indices already asked]}
//   chats  {npcId: [{ from: 'player'|'npc'|'system', text, day, t }]} the chat history

import { voiceOf, say, topicPool, rnd, thirdName, shortName, fill, varsFor } from './lines.js';
import { ALIASES } from './voices.js';
import { PEOPLE, VILLAGERS } from './bonds_data.js';
import { TO_YOU, FALLBACK_TO_YOU } from './voices_player.js';
import { WEEK_TOPICS } from './talk.js';
import { speakable } from './hidden.js';
import { asksForHome, wayHomeLine, homeFacts } from '../../world/home.js';
import { UNEASY_LINES } from '../../entities/npc_lines.js';
import { PLACE_PHRASE } from '../village_life/errands_data.js';

export const CHAT_CAP = 40; // messages kept per villager
const NOTE_CAP = 8;
const ASK_FRESH = 150; // real seconds a question they asked stays open
const DAY_T = 900;

// ---------------------------------------------------------------------------- their own words to you

// Per villager, in their LORE §6 voice ({n} is the player's name once they know it):
//   askName  how they ask the player's name
//   heard    when they learn it
//   again    the next time they meet, bringing up last time ({memory}: "you asked me about the bandits")
//   ask      questions they ask back: [question, if yes, if no, otherwise]
export const ASK_YOU = {
  hobb: {
    askName: ["Well now. I never asked. What do I call you? I've been saying 'our found one' to the lamps."],
    heard: ["{n}. Well now. I'll remember that. I forget my spectacles, not names.", '{n}. Good name. Burns steady.'],
    again: ["Well now, {n}. Last time {memory}. I've been turning it over.", "Back again. Last time {memory}, if I've got it right. I usually have."],
    ask: [
      ['Sleeping well at the Wayhouse? That lamp by your door burning right?', "Good. A lamp that burns right is half a night's sleep.", "Well now. I'll look at the wick tomorrow. Might be the wick.", 'Mm. Just so.'],
      ["Ever seen the sea, {n}? I never have. Meant to, for forty years.", "Have you now. Don't tell me what it's like. I'd like to see it myself.", 'No? Well now. Two of us, then.', 'Well now. One day.'],
    ],
  },
  wenna: {
    askName: ["What's your name? I won't call you 'the stranger'. It sounds like a song with a bad ending."],
    heard: ['{n}. Hm. It suits your feet.', '{n}. Good. Now I have a name to scold.'],
    again: ["I know those feet. Last time {memory}. Don't think I forgot.", "{n}. Last time {memory}. I've been thinking about it, and I'm still right."],
    ask: [
      ["Have you been near my hives? The bees are cross today, and they don't get cross for nothing.", 'I knew it. They can smell a stranger. Walk slow next time.', "No? Then it's the weather. They're never wrong about weather.", "Hm. We'll see what the bees say."],
      ['Do you sing? Everyone should. The bees like it, and so do I, when it is in tune.', 'Good. Come and sing to the hives sometime. In tune, mind.', "Pity. Learn. It's not hard; I'm blind and I manage.", 'Hm.'],
    ],
  },
  elda: {
    askName: ["And what do I call you, love? I can't keep saying 'love'. Well, I can. I will, mind."],
    heard: ["{n}! Lovely. I'll put it on your bowl. Not really. Maybe.", "{n}. There. Now you're one of mine properly."],
    again: ["There you are, {n}! Last time {memory}, and I've not stopped thinking about it.", 'Oh, {n}, love. Last time {memory}. Don’t tell anyone I remember everything. I do.'],
    ask: [
      ['Have you eaten today? Truly, now.', "Good. Have a honey cake anyway, you're all bones.", "I knew it. Sit. Bread's warm, and it's five coppers, not six like some.", "Well, eat something, love. That's all I ask."],
      ['Are you settling in, love? Is the Wayhouse warm enough?', "Good. Good. You come to me if it isn't. I've blankets.", "Oh, love. Come and sit by my fire, then. It's never once gone out.", 'Mm-hm. You tell me if anything wants mending.'],
    ],
  },
  bram: {
    askName: ['Hmph. Name?'],
    heard: ['{n}. Hmph. Good.', '{n}. Right. Remembered.'],
    again: ['Hmph. {n}. Last time {memory}.', 'You again. Good. Last time {memory}. Hmph.'],
    ask: [
      ['That sword of yours. Oiled it?', 'Good.', "Hmph. Bring it in. I'll show you how. Once.", 'Hmph.'],
      ['Fire’s hot. You need anything mended?', "Bring it by. No charge. Don't argue.", 'Hmph. Good. Then go on.', 'Hmph. Say if you do.'],
    ],
  },
  pip: {
    askName: ["What's your NAME? Is it a knight name? Is it secret? You can tell me. I won't tell. Much."],
    heard: ["{n}! That's a GOOD name. I'm going to tell Biscuit.", "{n}! I'm putting it on a notice. Not a lost one. A good one."],
    again: ['{n}! You came back! Last time {memory}! I remember EVERYTHING.', 'Hi {n}! Last time {memory}. Did you think about it? I did.'],
    ask: [
      ["Have you seen Biscuit? He's ginger. He's not lost. Have you seen him?", "WHERE? No, don't tell me, I'll find him!", "Oh. He's probably at the Wayhouse again. He likes you, I think.", 'Okay! Tell me if you do!'],
      ['Can you do magic? Real magic? Not stick magic?', 'WHOA. Show me! Not now. Later. Promise!', "Oh. That's okay. Lyra says it takes years. I've got years.", 'Whoa. Maybe?'],
    ],
  },
  rowan: {
    askName: ['Citizen. For the record: your name?'],
    heard: ['{n}. Noted.', '{n}. On the record, then.'],
    again: ['Citizen. Last time {memory}. Noted at the time.', '{n}. Last time {memory}. I keep notes.'],
    ask: [
      ['Anything on the roads, citizen? Report.', "Noted. Thank you. I'll double the north watch.", 'Good. Quiet roads are the only kind I like.', 'Noted.'],
      ['Are you keeping inside the ward after dark?', 'Good. Keep it that way.', "Then you're a fool, citizen, and a lucky one so far. Don't test it.", 'See that you do.'],
    ],
  },
  mira: {
    askName: ["Sorry, I never — what's your name? I only ever wrote 'the patient' in the green book. Sorry."],
    heard: ["{n}. I'll write it in the green book. Properly this time.", "{n}. Oh, that's — that's nice. Sorry. It's a nice name."],
    again: ['Oh! {n}. Hello. Last time {memory}. Sorry, I remember things. It’s the book.', 'Hello again. Last time {memory}. I — I wrote it down. Sorry.'],
    ask: [
      ['Are you sleeping all right? After a sleep that long, nights can be strange.', "Good. That's — good. Chamomile, if it changes.", "I thought so. Lavender under the pillow. And come by; I'll make something gentle.", 'Mm. Come by if it gets worse. Please.'],
      ['Do you know your herbs at all? Silverleaf, for a start?', "Oh! Then you know it's not silverweed. Sorry. People say silverweed.", "That's all right. Silverleaf: pale underneath, and it smells of rain. That's a start.", "Oh. Well. It's silverleaf, not silverweed. That's the main thing."],
    ],
  },
  tobias: {
    askName: ["Oh dear, I never asked your name. If it's not too much trouble?"],
    heard: ["{n}. Oh, lovely. I'll tell Sir Barnaby. He's the scarecrow. He's a good listener.", '{n}! Well. Have a turnip, {n}.'],
    again: ["Oh! {n}. Last time {memory}. I've been fretting about it. Not in a bad way. Mostly.", 'Morning, {n}! Last time {memory}, didn’t you? I put it in my letter to June.'],
    ask: [
      ["Do you think it'll rain? Before the last sheaf's in, I mean.", "Oh dear. Oh dear oh dear. I'd best get the sheaves under cover.", "Oh, I do hope you're right. I'll tell the wheat.", "Oh dear. Well. We'll see."],
      ["Have you seen any boar tracks about? Real ones, I mean, not Pip's.", "Oh dear. Where? No, don't say. I'll ask Hess. Thank you.", "Oh, good. Good. That's a relief, if it's true.", 'Oh dear. Do tell me if you do.'],
    ],
  },
  aveline: {
    askName: ["What name do you go by, child? The chapel wrote only 'found on the Hollowcrown'."],
    heard: ['{n}. I will say it at the candles tonight.', '{n}. Thank you, child. A name is a small flame to carry.'],
    again: ['Peace on you, {n}. Last time {memory}. I have kept it with me.', '{n}. Last time {memory}. I have been listening to it since.'],
    ask: [
      ['Do you dream, child? Since the long sleep?', 'Then you carry more than the road with you. Tell me when you are ready.', 'Sometimes the dark keeps its counsel. That is a mercy too.', 'Take your time. I am not going anywhere.'],
      ['Have you sat with the flames on the altar yet?', 'Good. A candle does not ask the dark for permission.', 'Come at dusk. There is a flame for the Wayhouse. It is yours while you stay.', 'When you are ready, child.'],
    ],
  },
  garrick: {
    askName: ['My friend! And your name? For the ledger. And for my memoirs.'],
    heard: ['{n}! A fine name! A name that buys things!', "{n}. Splendid. I'll remember it. I'll mispronounce it at first, but I'll remember it."],
    again: ['My friend {n}! Last time {memory}! I remember all my best customers.', "{n}! Last time {memory}. I've been telling people. With improvements."],
    ask: [
      ["Tell me, my friend, where are you headed? Every road's a market.", 'Ha! Mind the fork. Bad tolls these days. Buy a lantern first.', 'Staying put? Wise. Roads are expensive. So are lanterns, but buy one.', 'Ha! A traveller of mystery. Good for business.'],
      ['Need anything? Rope, potions, the finest lanterns in the valley?', 'Excellent! Step this way. Prices fair, mostly.', "Not yet, you mean. I'll wait. I'm very patient. For a merchant.", "Ha! I'll take that as a maybe."],
    ],
  },
  hess: {
    askName: ['Name.'],
    heard: ['{n}. Mm.', '{n}. Right.'],
    again: ['Mm. {n}. Last time {memory}.', '{n}. Last time {memory}. I remember tracks. And talk.'],
    ask: [
      ['You been past the hem?', "Mm. Don't go alone. Wolves are bold this autumn.", 'Good. Keep it that way, till you know the wind.', 'Mm.'],
      ['Can you track?', "Mm. We'll see.", 'Thought not. Watch the ground, not the trees.', 'Mm.'],
    ],
  },
  sabeth: {
    askName: ['I never asked your name. I sewed your first clean clothes and never asked. What is it?'],
    heard: ["{n}. Good. I'll stitch it in your collar next time. Small.", '{n}. There. Now you belong a little more.'],
    again: ["There you are, {n}. Last time {memory}. Hold still, you've a thread loose.", "{n}. Last time {memory}. I've thought about it at the vats."],
    ask: [
      ['Is it getting easier? Being here, I mean. Being from outside.', 'Good. It does. I promise it does.', 'Give it a winter. It took me one. Then it was home.', 'It will. I came in from outside too.'],
      ['What colour would you have, if I made you a cloak?', "Good choice. I'll think on it. No promises; the vats have their moods.", "Nothing? Everyone has a colour. I'll find yours.", "Hm. I'll find your colour."],
    ],
  },
  alder: {
    askName: ['Ahem. For the register: your name, if you would.'],
    heard: ['{n}. Registered. Thank you.', 'Ahem. {n}. I shall enter it properly.'],
    again: ['Ah. {n}. Last time {memory}. It is in my notes.', 'Ahem. {n}. Last time {memory}. Is this official business? No? Good.'],
    ask: [
      ['Is this official business?', 'Ah. Then we must do it properly. Later. With the ledger.', 'Good. Good day, then. That is to say: good day.', 'Ahem. I shall assume not.'],
      ['Are you finding yourself useful? The Moot likes useful.', 'Excellent. I shall make a note.', 'Ahem. That is a matter for improvement.', 'Ahem. Noted.'],
    ],
  },
  petra: {
    askName: ["What's your name, duckling? I like to know who I'm insulting."],
    heard: ["{n}. Pfah. I've heard worse. I've named worse.", "{n}. I'll remember it. I remember everyone's. And how they were born."],
    again: ["Duckling! Last time {memory}. I don't forget. Wenna does. I don't.", "Come here, {n}. Last time {memory}. I've told everyone. Well. Some."],
    ask: [
      ["Are you courting anyone yet, duckling? I'm taking bets.", "Ha! Who? No, don't tell me. I'll find out. I always do.", 'Pfah. Give it time. Hearthvale works on everyone.', "Ha! I'll put you down as 'thinking about it'."],
      ["Do you want to know how I'd guess you were born?", "Sit down, then. Feet first. I'd put money on it.", "Pfah. Your loss. It's a good story. I'd make it a good story.", 'Ha! Another time, duckling.'],
    ],
  },
  tilly: {
    askName: ["Oi. What's your name? I'm not calling you 'the stranger', it's boring."],
    heard: ["{n}! Brilliant. I'll scratch it on the hammer-throw board. So you can lose to me.", '{n}. Right. Got it. Burnt it in. Ha.'],
    again: ['Oi, {n}! Last time {memory}. I remember. Brilliantly.', '{n}! Last time {memory}. I told Bram. He said hmph.'],
    ask: [
      ['Can I see the sword? Look, not touch. Promise.', 'YES. ...Huh. Huh! Bram has to see this.', "Fine. Fine! One day. I'm patient. I'm not.", "I'm asking again tomorrow."],
      ['Are you entering the hammer-throw?', "Brilliant. I'll beat you. Nicely.", 'Coward. Kidding. Mostly.', "Think about it. I'll be watching the line. Unlike Wys."],
    ],
  },
  tansy: {
    askName: ["What's your name, anyway?"],
    heard: ["{n}. Fine. Whatever. I'll remember it.", "{n}. Okay. Better than 'the stranger'."],
    again: ["{n}. Last time {memory}. Don't think I forgot.", 'Oh. {n}. Last time {memory}. Whatever.'],
    ask: [
      ["What's it like outside the valley? Really like?", "...Huh. Tell me more sometime. When Pip's not listening.", "You don't know either? Typical.", 'Huh.'],
      ["Have you seen Duchess? She's called a Moot again.", "Where? Ugh. She'll be on the ledger. Again.", "Good. Maybe it's a quiet Moot.", "Whatever. She'll turn up."],
    ],
  },
  corran: {
    askName: ['Hm-hmm. What do they call you? Names float. I like to know which way.'],
    heard: ["{n}. Hm-hmm. The lake'll remember it, even if I don't.", '{n}. Good. A name like a still morning.'],
    again: ['Hm-hmm. {n}. Last time {memory}. Still water keeps things.', "{n}. Last time {memory}. Hm-hmm. I've been chewing on it."],
    ask: [
      ['Do you fish? Hm-hmm.', 'Good. Come down at dawn. Bring patience.', "Hm. You should. It's the only thing that makes sense of the lake.", 'Hm-hmm.'],
      ['Been down to the lake lately?', 'Hm-hmm. Quiet, was it? It mostly is.', "Hm. Come and stand on the dock sometime. It's restful.", 'Hm-hmm.'],
    ],
  },
  wys: {
    askName: ['Citizen! Name, please. For the — for the watch. Officially.'],
    heard: ['{n}. Noted! Officially. In my head.', "{n}. Right. I'll — I'll write it down. Later. On duty."],
    again: ['Citizen! {n}. Last time {memory}. I noted it. Officially.', "{n}. Last time {memory}. I've been — on duty. Thinking about it. On duty."],
    ask: [
      ['Is — is Lyra with you today?', "Oh. Right. Good. I mean, noted. If she's — never mind.", 'Oh. Right. No reason. On duty. Carry on.', 'Right. Noted. Officially.'],
      ['Anything suspicious to report, citizen?', "Really? Where? Is it a hen? It's usually a hen.", "Good. Very good. I'll keep watching. Very alert.", 'Noted! Very alert.'],
    ],
  },
};

// "What's my name?" when they do and do not know it, and what any of them says when
// someone with no line of their own needs one.
const NAME_KNOWN = ['{n}. You told me.', "{n}. I've not forgotten."];
const NAME_UNKNOWN = ["You've never said.", "You never told me. I'd remember."];

// How the remembered things read in "Last time {memory}."
const TOPIC_PHRASES = {
  bandits: 'the bandits',
  stone: 'the stone question',
  ward: 'the ward',
  harvest: 'the harvest',
  dance: 'the Sheaf Moot dance',
  contests: 'the contests',
  stones: 'the stones game',
  duchess: 'Duchess',
  oil: 'the price of oil',
  far_lamps: 'the far lamps',
  well_cap: 'the well-cap',
  notices: "Pip's notices",
  bets: "Petra's bets",
  owlsend: 'Owlsend',
  weather: 'the weather',
};
const INTENT_NOTES = {
  compliment: ['you said something kind', 2],
  thanks: ['you thanked me', 1],
  apology: ['you said sorry', 2],
  insult: ['you were rude to me', 3],
  threat: ['you threatened me', 4],
  flirt: ['you flirted with me, I think', 2],
  news: ['you asked me for the news', 1],
  aboutme: ['you asked what I make of you', 1.5],
  whoami: ['you asked about me', 1],
  work: ['you asked about my work', 1],
};

const RE = {
  greet: /\b(hi|hello|hey|hiya|howdy|greetings|good (?:morning|afternoon|evening|day)|morning|evening|well met|ho there|salutations)\b|^yo\b/i,
  howare: /\bhow(?:'s| is| are|'re)? (?:you|ya|it going|things|life|are things|have you been|you been|do you do|you doing|goes it|fare you|are you keeping|is your day|was your day)\b|\bhow (?:you|ya) doin(?:g|')?\b|\bhow goes\b|\bwhat'?s up\b|\bare you (?:well|ok(?:ay)?|alright|all right)\b|\byou (?:ok(?:ay)?|alright|all right|well)\?/i,
  thanks: /\b(thanks|thank you|thank ye|thankyou|cheers|much obliged|grateful|appreciate it)\b/i,
  apology: /\b(sorry|apologi[sz]e|apology|forgive me|my fault|i was wrong|i didn'?t mean|i regret|i shouldn'?t have|make (?:it )?(?:up|amends))\b/i,
  threat: /\b(i(?:'ll| will| am going to|'m going to|'m gonna| gonna| shall) (?:kill|hurt|hit|stab|burn|beat|end|smash|rob|cut|break|get) (?:you|every one of you|everyone of you|all of you|the lot of you|everyone|every last one)|kill you|kill (?:you all|all of you|every one of you|everyone)|you(?:'re| are) dead|watch your back|or else|i'?ll burn (?:this|your)|i'?ll make you pay)\b/i,
  insult: /\b(idiot|stupid|fool(?:ish)?|ugly|hate you|shut up|useless|pathetic|dumb|moron|loser|old (?:hag|crow|fool|goat)|you stink|you smell|worthless|bastard|damn you|get lost|annoying|boring|coward|liar|cheat|fraud|crook)\b/i,
  compliment: /\b(you(?:'re| are) (?:so |very |really |such )?(?:a |an )?(?:great|amazing|kind|lovely|wonderful|beautiful|pretty|handsome|clever|smart|brave|the best|cool|nice|funny|wise|strong|talented|sweet|awesome|brilliant|good (?:person|man|woman|friend|cook|smith|captain|healer|farmer|soul))|i (?:like|love|admire) (?:you|your|it here|this place)|love your|(?:nice|lovely|beautiful|fine|wonderful|great|cosy|cozy|pretty|amazing|excellent|good|best) (?:hat|shop|forge|place|inn|kettle|chapel|work|hair|cakes?|honey ?cakes?|bread|stew|honey|bees|hives|lamps?|garden|hens|chickens|boat|dock|farm|turnips?|sword|blades?|potions?|herbs|candles|smile|voice|cloak|eyes|smith(?:ing)?|cooking)|(?:this|your) (?:shop|inn|forge|place|stew|bread|cake|honey|farm|chapel) is (?:so |very |really )?(?:lovely|great|wonderful|nice|amazing|the best|beautiful|cosy|cozy|excellent|perfect)|good (?:job|work)|well done|you look (?:nice|well|great|lovely|good|wonderful)|best (?:cakes?|smith|bread|honey|stew|cook))\b/i,
  flirt: /\b(marry me|kiss me|kiss you|go out with me|date me|you(?:'re| are) (?:cute|hot|gorgeous|beautiful)|be mine|i fancy you|i love you|sweetheart|darling)\b/i,
  farewell: /\b(bye|goodbye|good-bye|farewell|see you|see ya|good night|goodnight|take care|later|i must go|got to go|gotta go)\b/i,
  news: /\b(news|gossip|what'?s new|anything new|heard anything|rumou?rs?|what'?s happening|what'?s going on|what have you heard|tell me something)\b/i,
  work: /\b(what do you do|your (?:job|work|trade)|what are you (?:doing|making|working on|up to)|how'?s (?:work|business|the (?:forge|shop|inn|farm|harvest|fishing|bees|hives|dyeing|chapel|watch))|need (?:any )?help|can i help|anything i can do)\b/i,
  whoami: /\b(who are you|what'?s your name|tell me about yourself|introduce yourself|what are you like)\b/i,
  aboutme: /\bwhat do you (?:think|make) of me\b|\bdo you like me\b|\bwhat do (?:people|they|you all) (?:think|say) (?:of|about) me\b/i,
  yes: /^(?:yes|yeah|yep|yup|sure|of course|okay|ok|aye|indeed|right|i have|i do|i did|i am|i will|always|a little|a bit|definitely|certainly|absolutely)\b/i,
  no: /^(?:no|nope|nah|never|not really|not yet|not at all|not much|i haven'?t|i don'?t|i didn'?t|i'?m not|i can'?t|i won'?t|i do not|i have not|i am not|i did not|i cannot|i can not|none|nothing|hardly)\b/i,
  myname: /\b(?:what'?s|what is|do you (?:know|remember)|you (?:know|remember)) my name\b|\bwho am i\b|\bremember me\??$/i,
};

// Words that follow "I'm" or "I am" but are not names.
const NOT_NAMES = new Set(
  'bye goodbye hi hello hey yes no yeah nope nah thanks thank maybe later why what who how nothing never hmm um uh huh fine good well ok okay sorry here new back the a an not so very just going tired hungry lost sure glad happy sad angry afraid scared from just only also still really looking trying fine new alright all right ready busy done home leaving off on in at with your you yours his her their a looking sick hurt cold hot thirsty bored curious interested listening serious kidding joking teasing human alive dead nobody somebody someone noone no one traveler traveller stranger friend friendly hero knight mage great ok sorry well'.split(' '),
);

// The name the player gives in a line, if they give one: "I'm Wren", "my name is Wren",
// "call me Wren", "name's Wren". After a villager asked for it, a bare name counts too.
export function detectName(text, { asked = false } = {}) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return null;
  const ok = (w, strict) => {
    if (!w) return null;
    const n = w.replace(/[^A-Za-z'\-À-ÿ]/g, '');
    if (n.length < 2 || n.length > 20 || NOT_NAMES.has(n.toLowerCase())) return null;
    if (strict && !/^[A-ZÀ-Þ]/.test(n)) return null;
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  let m = t.match(/\b(?:my name(?:'s| is)|name'?s|call me|i'?m called|they call me|i go by|it'?s)\s+([A-Za-zÀ-ÿ'-]+)/i);
  if (m && !/^it'?s/i.test(m[0])) return ok(m[1], false);
  if (m && asked) return ok(m[1], false);
  m = t.match(/(?:^|[,.!]\s*|\b(?:hi|hello|hey|greetings),?\s+)(?:i'?m|i am)\s+([A-Za-zÀ-ÿ'-]+)\s*[.!,]?\s*(?:$|[,.!]|\band\b|\bhow\b|\bnice\b|\bpleased\b)/i);
  if (m) return ok(m[1], !asked);
  if (asked) {
    const bare = t.replace(/^(?:oh|um+|uh|well|it'?s|i'?m|i am)[\s,]+/i, '').replace(/[.!]+$/, '').trim();
    // A bare word is a name only when it is not also a hello, a thanks, a yes or a goodbye.
    if (/^[A-Za-zÀ-ÿ'-]{2,20}$/.test(bare) && !Object.values(RE).some((re) => re.test(bare)) && !NOT_NAMES.has(bare.toLowerCase())) return ok(bare, false);
  }
  return null;
}

// ---------------------------------------------------------------------------- what they keep of you

export function emptyYou() {
  return { names: {}, notes: {}, asked: {}, chats: {} };
}

export function youOf(v) {
  if (!v) return emptyYou();
  if (!v.you || typeof v.you !== 'object') v.you = emptyYou();
  for (const k of ['names', 'notes', 'asked', 'chats']) if (!v.you[k] || typeof v.you[k] !== 'object') v.you[k] = {};
  return v.you;
}

const str = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// A saved `you` made safe: only known villagers, capped lists, clean strings.
export function cleanYou(d) {
  const out = emptyYou();
  if (!d || typeof d !== 'object') return out;
  for (const id of VILLAGERS) {
    const name = str(d.names?.[id], 20);
    if (name && /^[A-Za-zÀ-ÿ'-]{2,20}$/.test(name)) out.names[id] = name;
    const notes = Array.isArray(d.notes?.[id]) ? d.notes[id] : [];
    const n = notes
      .filter((x) => x && typeof x.text === 'string' && speakable(x.text))
      .slice(-NOTE_CAP)
      .map((x) => ({ text: str(x.text, 120), day: Number(x.day) || 1, t: Number(x.t) || 0, w: Math.max(0, Math.min(5, Number(x.w) || 1)) }));
    if (n.length) out.notes[id] = n;
    const asked = Array.isArray(d.asked?.[id]) ? d.asked[id].filter((i) => Number.isInteger(i) && i >= 0 && i < 8) : [];
    if (asked.length) out.asked[id] = [...new Set(asked)];
    const chat = Array.isArray(d.chats?.[id]) ? d.chats[id] : [];
    const c = chat
      .filter((m) => m && ['player', 'npc', 'system'].includes(m.from) && typeof m.text === 'string' && m.text.trim())
      .slice(-CHAT_CAP)
      .map((m) => ({ from: m.from, text: str(m.text, 400), day: Number(m.day) || 1, t: Number(m.t) || 0 }));
    if (c.length) out.chats[id] = c;
  }
  return out;
}

export function knownName(v, id) {
  return youOf(v).names[id] || '';
}

export function learnName(v, id, name) {
  const n = str(name, 20);
  if (!n || !VILLAGERS.includes(id)) return false;
  const you = youOf(v);
  const was = you.names[id];
  you.names[id] = n;
  return was !== n;
}

export function notesOf(v, id) {
  return youOf(v).notes[id] || [];
}

// They remember something about the player: a clause said to them ("you asked me about
// the bandits"), weighted. The same thing on the same day is one memory.
export function addNote(v, id, text, w = 1) {
  const clause = str(text, 120)
    .replace(/[.!?]+$/, '')
    .replace(/^You\b/, 'you');
  if (!clause || !VILLAGERS.includes(id) || !speakable(clause) || /[{}<>]/.test(clause)) return null;
  const you = youOf(v);
  const list = (you.notes[id] ||= []);
  const day = v?.day?.() ?? 1;
  const t = Math.round(v?.now?.() ?? 0);
  const same = list.find((n) => n.text === clause);
  if (same) {
    same.t = t;
    same.day = day;
    same.w = Math.max(same.w, w);
    list.splice(list.indexOf(same), 1);
    list.push(same);
    return same;
  }
  const note = { text: clause, day, t, w };
  list.push(note);
  if (list.length > NOTE_CAP) {
    // The lightest old memory goes first.
    let drop = 0;
    for (let i = 1; i < list.length - 1; i++) if (list[i].w < list[drop].w || (list[i].w === list[drop].w && list[i].t < list[drop].t)) drop = i;
    list.splice(drop, 1);
  }
  return note;
}

// The thing worth bringing up from an earlier meeting (another day, or long enough ago).
export function lastTimeNote(v, id) {
  const now = v?.now?.() ?? 0;
  const day = v?.day?.() ?? 1;
  let best = null;
  for (const n of notesOf(v, id)) {
    if (n.day >= day && now - n.t < DAY_T * 0.3) continue;
    if (!best || n.w + n.t / 9000 > best.w + best.t / 9000) best = n;
  }
  return best;
}

export function chatOf(v, id) {
  return youOf(v).chats[id] || [];
}

// One line of a villager's chat history (the chat panel and the dialog both write here).
export function recordChat(v, id, { from, text }) {
  const t = str(text, 400);
  if (!t || !VILLAGERS.includes(id) || !['player', 'npc', 'system'].includes(from)) return null;
  const list = (youOf(v).chats[id] ||= []);
  const m = { from, text: t, day: v?.day?.() ?? 1, t: Math.round(v?.now?.() ?? 0) };
  list.push(m);
  if (list.length > CHAT_CAP) list.splice(0, list.length - CHAT_CAP);
  return m;
}

// The last few exchanges as the villager remembers them, oldest first: [{you, they}].
export function recentExchanges(v, id, max = 5) {
  const out = [];
  let cur = null;
  for (const m of chatOf(v, id)) {
    if (m.from === 'player') {
      cur = { you: m.text, they: '', day: m.day };
      out.push(cur);
    } else if (m.from === 'npc' && cur) cur.they = cur.they ? `${cur.they} ${m.text}` : m.text;
  }
  return out.slice(-max);
}

// A question they asked the player, still waiting for an answer.
function openQuestion(v, id) {
  const q = v?.pendingAsk?.[id];
  if (!q) return null;
  const now = v?.game?.time ?? 0;
  if (now - q.at > ASK_FRESH) return null;
  return q;
}

function setQuestion(v, id, q) {
  if (!v) return;
  v.pendingAsk ||= {};
  if (q) v.pendingAsk[id] = { ...q, at: v.game?.time ?? 0 };
  else delete v.pendingAsk[id];
}

// Topic words -> the voice banks' topic keys.
const TOPIC_WORDS = [
  ['bandits', /\b(bandits?|varek|one-eyed|outlaws?|toll|the fork|camp)\b/i],
  ['maren', /\b(maren|wardwright|your teacher)\b/i],
  ['stone', /\b(marry(?:ing)? the stone|the stone question|wedd(?:ed|ing) to the stone|wardstone)\b/i],
  ['ward', /\b(the ward|ward\b|wellstone|bell-?reach|the hum|slimes?)\b/i],
  ['harvest', /\b(harvest|sheaf|wheat|turnips?|crops?)\b/i],
  ['dance', /\b(dance|dancing|sheaf moot|the moot|festival)\b/i],
  ['contests', /\b(hammer-?throw|contests?|ribbon|biggest turnip)\b/i],
  ['stones', /\b(game of stones|stones score|stones game|play stones)\b/i],
  ['duchess', /\b(duchess|hens?|chickens?)\b/i],
  ['oil', /\b(lamp-?oil|oil|cinderwick|prices?)\b/i],
  ['far_lamps', /\b(far lamps|lamps lit early|who lights the lamps)\b/i],
  ['well_cap', /\b(well-?cap|hinge)\b/i],
  ['notices', /\b(notices?|notice board|biscuit)\b/i],
  ['bets', /\b(bets?|betting|wager)\b/i],
  ['owlsend', /\b(owlsend)\b/i],
  ['weather', /\b(weather|rain(?:ing)?|fog(?:gy)?|sunny|cold today|storm)\b/i],
  ['stranger', /\b(the stranger|strangers?|the mountain|hollowcrown|the wayhouse)\b/i],
];

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let PERSON_RES = null;
function personRes() {
  if (PERSON_RES) return PERSON_RES;
  PERSON_RES = [];
  for (const id of PEOPLE) {
    const names = [...new Set([shortName(id), id, ...(ALIASES[id] || []).filter((a) => !/^(the|my|that|master|captain|da|gran|kicker)\b/i.test(a) || /^the (captain|reeve|sister)$/i.test(a))])];
    PERSON_RES.push([id, new RegExp(`\\b(?:${names.map(ESC).join('|')})\\b`, 'i')]);
  }
  return PERSON_RES;
}

// What the player said, understood well enough to answer.
export function understand(text, { selfId = null, locations = null, askedName = false } = {}) {
  const t = String(text || '').trim();
  const intents = new Set();
  for (const [k, re] of Object.entries(RE)) if (re.test(t)) intents.add(k);
  const name = detectName(t, { asked: askedName });
  if (name) intents.add('name');
  // "Thank you, I'm fine" is thanks, not a greeting; "good morning" is a greeting, not praise.
  if (intents.has('threat')) intents.delete('insult');
  const question = /\?\s*$/.test(t) || /^(what|who|where|why|how|when|do|does|did|is|are|can|could|would|will|have|has|tell me|know)\b/i.test(t);
  let person = null;
  for (const [id, re] of personRes()) {
    if (id === selfId) continue;
    // "I'm Wren" names the player, not a villager who happens to share the name.
    if (name && re.test(name) && !re.test(t.replace(new RegExp(name, 'i'), ''))) continue;
    if (re.test(t)) {
      person = id;
      break;
    }
  }
  if (!person && /\bmaren\b/i.test(t)) person = 'maren';
  let topic = null;
  for (const [k, re] of TOPIC_WORDS) {
    if (re.test(t)) {
      topic = k;
      break;
    }
  }
  if (topic === 'maren') {
    person = 'maren';
    topic = null;
  }
  let place = null;
  if (!person && !topic && locations?.find && /\b(about|where|what'?s|the)\b/i.test(t)) {
    const m = t.match(/\babout (?:the )?([a-z' -]{3,30})\??$/i) || t.match(/\bwhere(?:'s| is) (?:the )?([a-z' -]{3,30})\??$/i) || t.match(/\bwhat(?:'s| is) (?:the )?([a-z' -]{3,30})\??$/i);
    if (m) {
      try {
        place = locations.find(m[1]) || null;
      } catch {
        place = null;
      }
    }
  }
  return { text: t, intents, question, person, topic, place, name, empty: !t };
}

// The answer, local. v: the Village. Returns { lines, mood, delta, intent, told?: factIds,
// mentioned?: rumorIds, name?: the name they learned, note?: what they will remember }.
export function localReply(v, npc, text) {
  const g = v.game;
  const id = npc.id;
  const voice = voiceOf(id) || {};
  const ask = ASK_YOU[id] || null;
  const rng = g?.rng;
  const open = openQuestion(v, id);
  const u = understand(text, { selfId: id, locations: g?.locations, askedName: open?.kind === 'name' });
  const st = v.standing(id);
  // They call the player by name once the player has told them it.
  let known = knownName(v, id);
  const vars = () => ({ ...varsFor(id, 'player', { playerName: known, knowsPlayer: !!known }) });
  const P = (pool, o = {}) => say(pool, id, 'player', { rng, extra: { playerName: known, knowsPlayer: !!known }, avoid: v.recentPlayerLines(id), ...o });
  const lines = [];
  let mood = st.opinion >= 70 ? 'warm' : st.opinion < 20 ? 'wary' : 'neutral';
  let delta = 0;
  let intent = 'unknown';
  const told = [];
  const mentioned = [];
  let learned = null;
  // Side effects wait until the village knows whose words were used (applyTurn).
  const effects = { question: undefined, recalled: false, barredSaid: false, asked: null };
  const asleep = npc.state === 'sleep' || npc.activity === 'sleep';
  if (asleep) {
    // Asleep: a mumble, or nothing at all.
    const recent = v.recentPlayerLines(id);
    const fresh = (list) => (Array.isArray(list) ? list.filter((x) => !recent.has(x)) : []);
    const mumble = fresh(npc.profile?.sleepy);
    const l = rnd(rng) < 0.4 || !mumble.length ? pickProfile(fresh(SNORES).length ? fresh(SNORES) : SNORES, rng) : pickProfile(mumble, rng);
    return { lines: [l], mood: 'sleepy', delta: 0, intent: 'asleep' };
  }

  // "Where's my bed?" (r13): anyone in the village can say. The way is marked once the
  // answer is given (village.playerSays: not if they chose to say nothing).
  const home = !/\b(?:kill|hurt|burn)\b/i.test(text) && asksForHome(text) ? wayHomeLine(g, npc, id, v.day?.() || 0) : null;
  if (home) return { lines: [home], mood, delta: 0, intent: 'home', homeFact: homeFacts(g, npc).line, told: [], mentioned: [] };

  // "What were you just saying?" (DESIGN §23.1): what they really said today, aloud or over
  // their head, to the player or to anyone — the bubble and the chat are one memory.
  const recall = recallSaid(g, npc, text, v);
  if (recall) return { lines: [recall], mood, delta: 0, intent: 'recall', told: [], mentioned: [] };

  // Their day (DESIGN §28): "what's wrong?", "have you seen Garrick?", an answer to their
  // own question — from what they really know.
  let life = null;
  try {
    life = g?.villageLife?.answerPlayer?.(npc, u, text) || null;
  } catch {
    life = null;
  }
  if (life?.lines?.length && !u.intents.has('threat') && !u.intents.has('insult')) {
    const said = life.lines.filter((l) => typeof l === 'string' && l.trim() && speakable(l));
    if (said.length) return { lines: said, mood: life.mood || mood, delta: 0, intent: life.intent || 'life', told: [], mentioned: [] };
  }

  // Raw: they have heard what the player did to someone they love.
  const grave = st.grievance && st.grievance.grave && st.grievance.fresh;
  const toYou = TO_YOU[id] || {};
  const fallback = FALLBACK_TO_YOU;
  const barredHere = !!toYou.barred && st.barredFrom?.includes?.('ember_kettle') && youOf(v).barredSaid?.[id] !== v.day();
  const answering = open && open.kind === 'q' && !u.question && !u.person && !u.topic && !u.name && !['threat', 'insult', 'apology', 'news', 'howare', 'aboutme', 'myname'].some((k) => u.intents.has(k)) && u.text.length <= 140;
  if (u.intents.has('threat')) {
    intent = 'threat';
    delta = -12;
    mood = 'angry';
    lines.push(P(voice.reply?.threat) || P(voice.no) || 'Get away from me.');
  } else if (u.intents.has('apology')) {
    intent = 'apology';
    if (st.grievance || st.opinion < 35) {
      lines.push(P(toYou.mend || fallback.mend) || P(voice.reply?.apology));
      delta = 0; // amends are applied by the village, slowly
      mood = st.opinion < 20 ? 'wary' : 'neutral';
    } else {
      lines.push(P(voice.reply?.apology) || P(voice.short));
      delta = 0.5;
      mood = 'warm';
    }
  } else if (grave && !u.intents.has('thanks')) {
    intent = u.intents.has('insult') ? 'insult' : 'cold';
    delta = u.intents.has('insult') ? -6 : 0;
    mood = 'angry';
    lines.push(P(st.grievance.victim === 'lyra' && toYou.grave ? toYou.grave : toYou.cold || fallback.cold) || P(toYou.cold || fallback.cold));
  } else if (u.intents.has('insult')) {
    intent = 'insult';
    delta = -6;
    mood = 'angry';
    lines.push(P(voice.reply?.insult) || P(voice.no));
  } else if (barredHere) {
    // Not welcome at the Kettle: those who barred them say so, once, in their own words.
    intent = 'cold';
    mood = 'wary';
    effects.barredSaid = true;
    lines.push(P(toYou.barred));
  } else if (u.intents.has('flirt')) {
    intent = 'flirt';
    delta = st.opinion >= 60 ? 0.5 : -1;
    mood = 'amused';
    lines.push(P(voice.reply?.flirt) || P(voice.tease) || P(voice.short));
  } else if (st.cold && !u.intents.has('thanks') && !u.intents.has('compliment')) {
    intent = 'cold';
    mood = 'wary';
    lines.push(P(toYou.cold || fallback.cold));
  } else if (u.name) {
    // The player tells them their name: they keep it, and use it.
    intent = 'name';
    const again = known && known.toLowerCase() === u.name.toLowerCase();
    learned = u.name;
    known = u.name;
    delta = again ? 0 : 1;
    mood = st.opinion >= 40 ? 'warm' : 'neutral';
    lines.push(again ? fill(pickProfile(NAME_KNOWN, rng), vars()) : P(ask?.heard) || fill(`{n}. ${pickProfile(voice.short, rng) || 'Good.'}`, vars()));
    if (u.intents.has('howare')) lines.push(P(v.howAreYou(id)) || P(voice.short));
  } else if (answering) {
    // An answer to what they asked.
    intent = 'answer';
    delta = 0.5;
    mood = st.opinion >= 45 ? 'warm' : 'neutral';
    const q = ask?.ask?.[open.i];
    const which = u.intents.has('no') ? 2 : u.intents.has('yes') ? 1 : 3;
    lines.push((q && fill(q[which] || q[3], vars())) || P(voice.short));
  } else if (u.intents.has('myname')) {
    intent = 'myname';
    lines.push(known ? fill(pickProfile(NAME_KNOWN, rng), vars()) : `${pickProfile(voice.short, rng) || ''} ${pickProfile(NAME_UNKNOWN, rng)}`.trim());
    if (!known && ask?.askName) {
      const l = P(ask.askName);
      if (l) {
        lines.push(l);
        effects.question = { kind: 'name' };
      }
    }
  } else if (u.intents.has('howare')) {
    intent = 'howare';
    delta = 1;
    mood = st.opinion >= 45 ? 'warm' : 'neutral';
    const how = P(v.howAreYou(id)) || P(voice.short) || 'Well enough.';
    if (u.intents.has('greet') && rnd(rng) < 0.75) {
      const hello = P(voice.helloTo?.player || voice.hello, {}) || null;
      // A hello that asks back, or says the same thing as the answer, is left out.
      if (hello && !/\bhow (?:are|is)\b|\byou\?/i.test(hello) && !overlaps(hello, how)) lines.push(hello);
    }
    lines.push(how);
    // They heard a scream today and never saw what it was (DESIGN §29.4; npc.uneasy, saved by
    // blood): it is on their mind. Of a place, never a person.
    const ue = uneasyNow(v, npc, rng);
    if (ue && lines.length < 3) lines.push(ue);
  } else if (u.intents.has('aboutme')) {
    intent = 'aboutme';
    lines.push(opinionOfYou(v, npc, P, voice, toYou, st));
  } else if (u.person) {
    intent = 'person';
    const r = aboutPerson(v, npc, u.person, P, voice);
    if (r.line) lines.push(r.line);
    if (r.topicAsked) v.emitTopic(npc, r.topicAsked);
  } else if (u.topic === 'stranger') {
    intent = 'aboutme';
    lines.push(opinionOfYou(v, npc, P, voice, toYou, st));
  } else if (u.topic) {
    intent = 'topic';
    const r = aboutTopic(v, npc, u.topic, P, voice, st);
    if (r.line) lines.push(r.line);
    told.push(...(r.told || []));
    v.emitTopic(npc, u.topic);
  } else if (u.intents.has('news')) {
    intent = 'news';
    const r = news(v, npc, P, voice, st);
    lines.push(...r.lines);
    mentioned.push(...r.mentioned);
  } else if (u.intents.has('thanks')) {
    intent = 'thanks';
    delta = 1;
    mood = 'warm';
    lines.push(P(voice.reply?.thanks) || P(voice.yes));
  } else if (u.intents.has('compliment')) {
    intent = 'compliment';
    delta = 2;
    mood = 'happy';
    lines.push(P(voice.reply?.compliment) || P(voice.warm));
  } else if (u.intents.has('work')) {
    intent = 'work';
    lines.push(P(topicPool(id, 'work')) || P(voice.about?.own) || P(voice.short));
  } else if (u.intents.has('whoami')) {
    intent = 'whoami';
    lines.push(introduce(v, npc, P, voice));
  } else if (u.place) {
    intent = 'place';
    lines.push(aboutPlace(npc, u.place, P, voice));
  } else if (u.intents.has('farewell')) {
    intent = 'farewell';
    lines.push(P(voice.reply?.farewell) || P(voice.bye));
  } else if (u.intents.has('greet')) {
    intent = 'greet';
    delta = 0.5;
    mood = st.opinion >= 45 ? 'warm' : 'neutral';
    lines.push(P(voice.helloTo?.player || voice.hello) || P(voice.short));
  } else if (u.intents.has('yes') || u.intents.has('no')) {
    intent = 'ack';
    lines.push(P(voice.short) || P(voice.yes));
  } else {
    intent = 'unknown';
    // Something they have a line about, if any word in it touches one of their topics; never
    // the same shrug twice in a day while they have another (DESIGN §23.1).
    const recent = v.recentPlayerLines(id);
    let l = null;
    for (const pool of [voice.reply?.unknown, SHRUGS_MORE[id], voice.short, voice.yes, SHRUGS_ANY]) {
      const c = Array.isArray(pool) ? P(pool) : null;
      if (c && !recent.has(c)) {
        l = c;
        break;
      }
    }
    lines.push(l || P(voice.reply?.unknown) || P(voice.short));
  }
  // Whatever they asked has had its turn: answered, or talked past.
  if (open && intent !== 'myname') effects.question = null;

  const warmish = !['threat', 'insult', 'cold', 'farewell', 'apology', 'flirt'].includes(intent) && !st.cold && !grave;
  // Meeting again: they bring up last time (once a day).
  if (warmish && ['greet', 'howare', 'name'].includes(intent) && lines.length < 3) {
    const note = lastTimeNote(v, id);
    const said = youOf(v).recalled || {};
    if (note && said[id] !== v.day() && ask?.again) {
      // Not two lines opening on the same word ("Well now. … Well now, …").
      const first = (t) => String(t || '').trim().split(/[\s,.!?…—-]+/)[0].toLowerCase();
      const fresh = ask.again.filter((x) => first(x) !== first(lines[0]));
      const l = say(fresh.length ? fresh : ask.again, id, 'player', { rng, vars: { ...vars(), memory: note.text } });
      if (l) {
        lines.splice(Math.min(1, lines.length), 0, l);
        effects.recalled = true;
      }
    }
  }

  // News about the player they have not raised with them yet comes up now.
  if (!['threat', 'insult', 'cold', 'news', 'farewell', 'apology', 'name', 'answer'].includes(intent) && lines.length < 3) {
    const r = v.playerNews(id);
    if (r) {
      const clause = v.rumors.renderYou(r, id);
      const pool = r.valence >= 0.15 ? toYou.good || fallback.good : r.valence <= -0.15 ? toYou.bad || fallback.bad : null;
      const l = clause && pool ? fill(pickFresh(pool, rng, lines), { you: clause }) : null;
      if (l) {
        lines.push(l);
        mentioned.push(r.id);
        if (r.valence < 0 && mood === 'warm') mood = 'neutral';
      }
    }
  }

  // And they ask something back, now and then: the player's name first, then their own questions.
  if (warmish && lines.length < 3 && !effects.recalled && intent !== 'myname' && (!open || effects.question === null) && st.opinion >= 22) {
    const q = askBack(v, id, ask, { known, intent, rng, exchanges: Math.max(chatOf(v, id).filter((m) => m.from === 'player').length, v.talks?.[id]?.length || 0), vars: vars() });
    if (q && !overlaps(q.line, lines.join(' '))) {
      lines.push(freshOpening(q.line, lines));
      effects.question = q.q;
      if (q.q.kind === 'q') effects.asked = q.q.i;
    }
  }
  let out = lines.filter((l) => typeof l === 'string' && l.trim() && speakable(l));
  // Nothing they already said today, to anyone (DESIGN §23.1): a repeated sentence goes,
  // and a line that is all repeat goes too while there is something else to say.
  const said = g?.saidToday;
  if (said && out.length) {
    out = out.map((l) => said.dropRepeats(id, l));
    const freshLines = out.filter((l) => !said.repeats(id, l));
    if (freshLines.length) out = freshLines;
  }
  if (!out.length) out.push(fill(pickProfile(voice.short, rng) || 'Hm.', {}) || 'Hm.');
  const note = INTENT_NOTES[intent] ? INTENT_NOTES[intent] : intent === 'topic' && TOPIC_PHRASES[u.topic] ? [`you asked me about ${TOPIC_PHRASES[u.topic]}`, 2] : intent === 'person' && u.person ? [`you asked me about ${u.person === 'maren' ? 'Maren' : thirdName(id, u.person)}`, u.person === 'maren' ? 2.5 : 1.5] : learned ? ['you told me your name', 1] : null;
  return { lines: out, mood, delta, intent, told, mentioned, name: learned, note: note ? { text: note[0], w: note[1] } : null, effects };
}

// What the player said that is worth repeating: the villager tells it on (DESIGN §23
// "they talk about it to others"). A clause for the village, and the same said back to
// the player's face by whoever hears it. Once a day per villager and kind.
const WORD_GETS_ROUND = {
  insult: { text: '{stranger} was rude to {v}', you: 'you were rude to {v}', valence: -0.35, severity: 0.3 },
  compliment: { text: '{stranger} had kind words for {v}', you: 'you had kind words for {v}', valence: 0.25, severity: 0.2 },
  flirt: { text: '{stranger} has been sweet-talking {v}', you: "you've been sweet-talking {v}", valence: 0.05, severity: 0.3 },
  maren: { kind: 'maren_asking' },
};

export function spreadWord(v, e, local) {
  if (!v?.rumors || !e?.id || !local) return null;
  const id = e.id;
  const key = local.intent === 'person' && local.note && /Maren/.test(local.note.text) ? 'maren' : local.intent;
  const def = WORD_GETS_ROUND[key];
  if (!def) return null;
  const you = youOf(v);
  const day = v.day?.() ?? 1;
  const seen = (you.rumored ||= {});
  const tag = `${id}:${key}`;
  if (seen[tag] === day) return null;
  seen[tag] = day;
  // Those who heard the words themselves: close, and no wall between (src/ai/hearing.js).
  const near = (v.witnessesNear?.(e.x, e.y, 90, { words: true }) || []).filter((w) => w !== id);
  if (def.kind) return v.addRumor?.(def.kind, { witnesses: [id, ...near] }) || null;
  const r = v.rumors.add({ kind: `said_${key}`, text: def.text, you: def.you, valence: def.valence, severity: def.severity, source: id, victim: id, heardBy: [id, ...near], t: v.now?.() ?? 0, day });
  if (!r) return null;
  for (const w of near) v.onHeard?.(w, r, id, { witness: true });
  v.emit?.('rumor', { rumor: r });
  return r;
}

// After a turn: the local answer's own bookkeeping, when its words were the ones said.
// (With Claude's words, only what the player said counts: the name and the memory.)
export function applyTurn(v, id, local, { source = 'local', asked = null } = {}) {
  spreadWord(v, v?.entity?.(id), local);
  const fx = local?.effects;
  if (source === 'local' && fx) {
    if (fx.question !== undefined) setQuestion(v, id, fx.question);
    if (fx.asked != null) {
      const list = (youOf(v).asked[id] ||= []);
      if (!list.includes(fx.asked)) list.push(fx.asked);
    }
    if (fx.recalled) (youOf(v).recalled ||= {})[id] = v.day();
    if (fx.barredSaid) (youOf(v).barredSaid ||= {})[id] = v.day();
    return;
  }
  // Claude answered: a question it asked back stays open for the next line.
  setQuestion(v, id, asked ? { kind: asked === 'name' ? 'name' : 'claude' } : null);
}

const SNORES = ['Zzz…', 'Mmh… zzz…', '…'];

// More ways of not knowing (round 14b, the leftovers: villagers shrugged the same way too
// often offline). Each in their own voice; then anyone's.
const SHRUGS_MORE = {
  hobb: ["Couldn't tell you. My lamps know more than I do some nights.", "Hm. That one's past me, I'm afraid."],
  wenna: ["The bees don't gossip about that. Neither do I.", "No. And don't make that face."],
  elda: ["Not a clue, love. Want tea while you wonder?", "You've stumped me, and that takes doing."],
  bram: ['No.', "Hmph. Wouldn't know."],
  pip: ["I don't know! Is it a secret? I'm good at secrets.", 'Huh? Ask me something about owls.'],
  rowan: ['Not something I can speak to.', "I'd be guessing, and the watch doesn't guess."],
  mira: ['I really don\'t know. Sorry. Is it — sorry.', "I couldn't tell you. I'd only worry."],
  tobias: ["Couldn't say. Ground doesn't tell me that sort of thing.", "Can't help you there, I'm afraid."],
  aveline: ['Some questions are better carried than answered, child.', 'I do not know. I am at peace with that.'],
  garrick: ["Haven't heard. And I hear most things, eventually.", "Not my trade. Yet."],
  hess: ['No.', "Not in the woods, so I don't know it."],
  sabeth: ["Couldn't tell you, dear. Ask me about wool.", 'No idea. Mind your hem.'],
  alder: ['I could not say.', 'That is not recorded anywhere I keep.'],
  petra: ["No idea, and I've lived longer than most.", "Pfah. Couldn't say."],
  tilly: ["No clue! Ask me about the forge.", "Dunno, honestly."],
  tansy: ["Dunno. Ask the chickens.", 'No idea.'],
  corran: ["Hm. The lake doesn't say.", "Couldn't tell you. Hm-hmm."],
  wys: ["I'd have to ask the Captain.", "Not sure, citizen. Honestly."],
};
const SHRUGS_ANY = ["I'd only be guessing.", 'No idea, truly.', 'Ask me something easier.', "That's beyond me.", 'Hm. No.'];

// The scream they heard today, of a place and never a person (DESIGN §29.4), or null.
function uneasyNow(v, npc, rng) {
  const u = npc?.uneasy;
  const g = v?.game;
  if (!u || (u.day != null && u.day !== (g?.clock?.day ?? v?.day?.()))) return null;
  const name = u.place ? g?.locations?.get?.(u.place)?.name || '' : '';
  const phrase = u.place ? PLACE_PHRASE?.[u.place] || (name ? `the ${name.replace(/^the\s+/i, '')}` : '') : '';
  const list = phrase ? UNEASY_LINES.place : UNEASY_LINES.nowhere;
  const l = list[Math.floor(rnd(rng) * list.length)] || list[0];
  return l.replace(/\{place\}/g, phrase.replace(/^(?:at|in|by|on) /, ''));
}

// A question back to the player, or null. Their name first (once they have talked a little),
// then the villager's own questions, each asked once.
function askBack(v, id, ask, { known, intent, rng, exchanges, vars }) {
  if (!ask) return null;
  const chance = intent === 'howare' || intent === 'greet' ? 0.55 : intent === 'answer' || intent === 'name' ? 0.3 : ['unknown', 'ack', 'thanks', 'compliment', 'work', 'whoami'].includes(intent) ? 0.35 : 0.2;
  if (rnd(rng) >= chance) return null;
  if (!known && ask.askName && exchanges >= 1 && intent !== 'name') {
    const line = say(ask.askName, id, 'player', { rng, vars });
    if (line) return { line, q: { kind: 'name' } };
  }
  const asked = youOf(v).asked[id] || [];
  const free = (ask.ask || []).map((q, i) => i).filter((i) => !asked.includes(i));
  if (!free.length) return null;
  const i = free[Math.floor(rnd(rng) * free.length)];
  const line = fill(ask.ask[i][0], vars);
  if (!line) return null;
  return { line, q: { kind: 'q', i } };
}

// "Oi! … Oi. What's your name?": a short opening word already said is dropped.
function freshOpening(line, said) {
  const first = (t) => String(t || '').trim().split(/[\s,.!?…—-]+/)[0].toLowerCase();
  const f = first(line);
  if (!f || !said.some((l) => first(l) === f)) return line;
  const m = line.match(/^\s*[^.!?,]{1,12}[.!,]\s+(\S.*)$/);
  if (!m) return line;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1);
}

// Do two lines share three words in a row?
function overlaps(a, b) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  const wa = words(a);
  const tri = new Set();
  for (let i = 0; i + 2 < wa.length; i++) tri.add(`${wa[i]} ${wa[i + 1]} ${wa[i + 2]}`);
  const wb = words(b);
  for (let i = 0; i + 2 < wb.length; i++) if (tri.has(`${wb[i]} ${wb[i + 1]} ${wb[i + 2]}`)) return true;
  return false;
}

// "What were you just saying?" / "what did you say to Pip?": the last line they said today
// (to that person, if one is named), quoted back, or null when the question is something else.
const RECALL_RE = /\b(?:what (?:were|was) you (?:just )?(?:saying|talking about|on about|telling \w+)|what did you (?:just )?(?:say|tell)|what was that you said|say that again|what did you say)\b/i;
function recallSaid(g, npc, text, v = null) {
  if (!RECALL_RE.test(String(text || ''))) return null;
  const said = g?.saidToday;
  const day = g?.clock?.day;
  const lines = [...(said?.today?.(npc.id) || [])];
  // Their answers in this talk count too (to the player), whichever route noted them.
  for (const x of v?.talks?.[npc.id] || []) if (x.day == null || x.day === v.day?.() || x.day === day) for (const l of x.they || []) lines.push({ t: x.t ?? 0, text: l, to: 'player' });
  lines.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const m = /\bto (\w+)\b/i.exec(String(text));
  const to = m ? String(m[1]).toLowerCase() : null;
  const pick = [...lines].reverse().find((l) => (!to || to === 'me' || String(l.to || '').toLowerCase() === to) && l.text);
  if (!pick) return to && to !== 'me' ? `I haven't said a word to ${to.charAt(0).toUpperCase()}${to.slice(1)} today.` : 'Nothing worth repeating.';
  const q = String(pick.text).trim();
  return `I said, “${q}”`;
}

// A line from the pool that does not open on the same word as one already said
// ("Citizen. ... Citizen. Word is ...").
function pickFresh(list, rng, said) {
  const first = (t) => String(t || '').trim().split(/[\s,.!?…—-]+/)[0].toLowerCase();
  const used = new Set(said.map(first));
  const ok = (list || []).filter((l) => !used.has(first(l)));
  return pickProfile(ok.length ? ok : list, rng);
}

function pickProfile(list, rng) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(rnd(rng) * list.length)];
}

// "What do you think of me?": what they make of the player, to their face.
function opinionOfYou(v, npc, P, voice, toYou, st) {
  if (st.grievance?.grave && st.grievance.fresh) return P(st.grievance.victim === 'lyra' && toYou.grave ? toYou.grave : toYou.cold || FALLBACK_TO_YOU.cold);
  const stance = st.opinion >= 60 ? 'good' : st.opinion < 28 || st.cold ? 'bad' : 'mid';
  const think = toYou.think || FALLBACK_TO_YOU.think;
  return P(think[stance]) || P(think.mid) || P(voice.short);
}

function aboutPerson(v, npc, who, P, voice) {
  const id = npc.id;
  if (who === 'maren') {
    const l = P(topicPool(id, 'maren')) || (npc.profile?.knows?.maren && speakable(npc.profile.knows.maren) ? npc.profile.knows.maren : null) || P(voice.reply?.unknown);
    return { line: l, topicAsked: 'maren' };
  }
  if (who === 'player') return { line: P(voice.short) };
  if (who === 'lyra') {
    const pool = topicPool(id, 'lyra');
    const l = P(pool);
    if (l) return { line: l, topicAsked: 'lyra' };
  }
  const bond = v.bond(id, who);
  const aff = bond?.affinity ?? 0;
  const knows = npc.profile?.knows?.[who];
  if (typeof knows === 'string' && knows && speakable(knows) && rnd(v.game?.rng) < 0.55) return { line: knows };
  const kind = aff >= 60 ? 'love' : aff >= 25 ? 'like' : aff >= -10 ? 'meh' : 'dislike';
  const pool = voice.people?.[kind] || voice.people?.meh;
  const line = pool ? say(pool, id, 'player', { rng: v.game?.rng, vars: { ...varsFor(id, 'player'), who: thirdName(id, who) } }) : null;
  return { line: line || P(voice.reply?.unknown) };
}

function aboutTopic(v, npc, topic, P, voice, st) {
  const id = npc.id;
  const fact = v.factFor(npc, topic);
  if (fact) return { line: fact.line, told: [fact.id] };
  const stance = st.opinion >= 60 ? 'good' : st.opinion < 30 ? 'bad' : 'mid';
  const pool = topicPool(id, topic, { weather: v.weatherKey(), stance });
  // Said to the player, "the stranger" lines about them become about them to their face.
  const l = pool ? say(pool, id, 'player', { rng: v.game?.rng, extra: { aboutPlayer: topic === 'stranger', playerName: '' }, vars: { ...varsFor(id, 'player'), stranger: 'you', P: 'you' } }) : null;
  return { line: l || P(voice.reply?.unknown) };
}

function news(v, npc, P, voice, st) {
  const id = npc.id;
  const out = { lines: [], mentioned: [] };
  const r = v.playerNews(id);
  if (r) {
    const clause = v.rumors.renderYou(r, id);
    const toYou = TO_YOU[id] || {};
    const pool = r.valence >= 0 ? toYou.good || FALLBACK_TO_YOU.good : toYou.bad || FALLBACK_TO_YOU.bad;
    const l = clause ? fill(pickProfile(pool, v.game?.rng), { you: clause }) : null;
    if (l) {
      out.lines.push(l);
      out.mentioned.push(r.id);
      return out;
    }
  }
  const other = v.rumors.tellable(id, 'player', v.now()).find((x) => x.about !== 'player');
  if (other) {
    const clause = v.rumors.render(other, id, { stranger: 'you' });
    const l = clause ? say(voice.rumor?.tell, id, 'player', { rng: v.game?.rng, vars: { ...varsFor(id, 'player'), rumor: clause } }) : null;
    if (l) {
      out.lines.push(l);
      out.mentioned.push(other.id);
      return out;
    }
  }
  // What the whole village is on about this week.
  const topics = WEEK_TOPICS.filter((k) => voice.about?.[k]);
  for (let i = 0; i < 3 && topics.length; i++) {
    const k = topics[Math.floor(rnd(v.game?.rng) * topics.length)];
    const l = P(topicPool(id, k));
    if (l) {
      out.lines.push(l);
      return out;
    }
  }
  out.lines.push(P(voice.about?.own) || P(voice.short));
  return out;
}

function introduce(v, npc, P, voice) {
  const own = P(topicPool(npc.id, 'work')) || P(voice.about?.own);
  const name = shortName(npc.id);
  const hello = P(voice.hello);
  if (own) return own;
  return hello || `${name}.`;
}

function aboutPlace(npc, loc, P, voice) {
  const d = String(loc?.description || '').split(/(?<=[.!?])\s/)[0];
  if (!d) return P(voice.reply?.unknown) || P(voice.short);
  const lead = P(voice.short) || '';
  return `${lead} ${d}`.trim();
}
