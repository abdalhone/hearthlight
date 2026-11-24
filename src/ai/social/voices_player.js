// What each of the eighteen says to the player's face about what the village has heard
// (DESIGN §19.3 gossip, §19.7 consequences). {you} is the news as a clause said to the
// player ("you pulled a wolf off Tansy"), {lyra} is Lyra as the speaker names her.
//
//   good   news of something kind or brave the player did
//   bad    news of something wrong
//   grave  the player hurt Lyra, and this person loves her
//   cold   short answers while it is still raw
//   mend   an apology or a gift taken, a little: it is a start, not forgiveness
//   barred (Elda, Rowan, Wys) the player is not welcome at the Kettle for now

export const TO_YOU = {
  hobb: {
    good: ['Well now. Heard {you}. That’s a lamp lit, that is.', 'Heard {you}. Good. Everyone found deserves a lamp, and you’re earning yours.'],
    bad: ['Heard {you}. Every wick wants trimming. Yours is smoking.', 'Well now. Heard {you}. I’d hoped better.'],
    grave: ['That was my Star. You’ll not stand on my lane.', 'I lit a lamp for you. I’m letting it go out.'],
    cold: ['Mm.', 'I’ve lamps to see to.'],
    mend: ['Well now. A wick can be trimmed. It takes a while to burn clean.', 'Mm. I heard you. Lamps don’t relight themselves. Keep at it.'],
  },
  wenna: {
    good: ['I heard {you}. Come here. Let me hear you. Hm. You’ll do.', 'Heard {you}. Good. Don’t let it go to your head, there’s not much room in there.'],
    bad: ['I heard {you}. I’m blind, not deaf.', 'Heard {you}. Hm. I don’t like the sound of you today.'],
    grave: ['You put your hands on my daughter. Stand where I can hear you, so I know where not to be.', 'I know your feet now. I’ll know them coming, and I’ll be gone.'],
    cold: ['No.', 'Go away. I’m listening to my bees.'],
    mend: ['Sorry’s a word. Words are cheap; I sing them for nothing. Show me.', 'Hm. You sound like you mean it. I’ll decide when I’ve heard more.'],
  },
  elda: {
    good: ['Oh, I heard {you}! Sit, sit, have something, you’ve earned it.', 'Heard {you}, love. Well! There’s a honey cake in it for you.'],
    bad: ['I heard {you}. I’m not cross. I’m disappointed, which is worse, ask Pip.', 'Heard {you}. Oh, love. Oh dear.'],
    grave: ['I fed that girl from the time she could walk. Don’t you sit at my tables.', 'You’ll get nothing from my kitchen. Not a crust.'],
    cold: ['I’m busy, love. Very busy. Elsewhere.', 'Mm-hm.'],
    mend: ['Well. I heard you. A kettle takes a while to cool, and longer to warm again.', 'That’s a start, love. Only a start, mind.'],
    barred: ['Not tonight, love. Not after what you did. The door’s that way.', 'You’re not welcome at my hearth just now. The Captain agrees, and so do I.'],
  },
  bram: {
    good: ['Hmph. Heard {you}. Good.', 'Heard {you}. Hmph. Keep your edge.'],
    bad: ['Heard {you}. Hmph. Bad.', 'Hmph. Heard {you}. Not in my forge, you don’t.'],
    grave: ['Hmph. The mage is a friend of this forge. You are not. Out.', 'Hmph. Out of my forge.'],
    cold: ['Hmph.', 'Busy.'],
    mend: ['Hmph. Iron mends if you work it. Slowly.', 'Hmph. We’ll see.'],
  },
  pip: {
    good: ['Did you REALLY? Everyone says {you}! WHOA.', 'Tansy says {you}! Is it true? Can you show me?'],
    bad: ['Everyone says {you}. Is that true? Elda says don’t go near you.', 'Did you? Everyone says {you}. That’s bad.'],
    grave: ['You hurt Lyra. I’m not talking to you. CAPTAIN!', 'Go away! You hurt Lyra! Biscuit doesn’t like you either!'],
    cold: ['I’m not allowed to talk to you.', 'Elda says no.'],
    mend: ['...Are you sorry? Really sorry? Okay. Maybe.', 'Okay. But I’m watching you. Biscuit too.'],
  },
  rowan: {
    good: ['Citizen. I heard {you}. That’s noted. Well done.', 'Word is {you}. Good. The watch could use more like that.'],
    bad: ['Citizen. Word is {you}. That’s noted.', 'I heard {you}. Don’t make me write it down twice.'],
    grave: ['There is no blood inside the bell-reach. You know that law now. Keep away from her.', 'Citizen. I’m watching you. Every step.'],
    cold: ['Move along, citizen.', 'Noted. Move along.'],
    mend: ['Noted, citizen. Amends are made with time, not words. Keep making them.', 'Noted. That counts for something. Not much yet.'],
    barred: ['Not the Kettle, citizen. Not for a while. Elda’s asked, and I agree.', 'The Kettle’s closed to you for now. Walk on.'],
  },
  mira: {
    good: ['Oh! I heard {you}. That’s — that was kind. Sorry. Good.', 'I heard {you}. I wrote it in the green book. Sorry. I mean, well done.'],
    bad: ['I heard {you}. Oh no.', 'Oh. I heard {you}. I — I don’t know what to say.'],
    grave: ['I sat up three nights with her once. Please go.', 'I don’t — please don’t come in. Please.'],
    cold: ['Sorry. I’m busy. Very busy.', 'Oh. I — no.'],
    mend: ['...Thank you for saying it. Things heal slowly. Most things.', 'Oh. That’s — that’s a start. Slowly. Like a salve.'],
  },
  tobias: {
    good: ['Oh! I heard {you}! Have a turnip. Have two.', 'Heard {you}. That’s — thank you. On behalf of everyone, if it’s not too much.'],
    bad: ['Oh dear. I heard {you}. Oh dear, oh dear.', 'I heard {you}. I’m sure there’s a reason. Is there a reason?'],
    grave: ['I’m sorry, I — I’d rather you kept off the farm. If it’s not too much trouble.', 'Tansy’s told me what you did. Please keep away from my girl.'],
    cold: ['Oh. I — the furrows need me. Sorry.', 'Sorry. Busy. Very sorry.'],
    mend: ['Oh. Well. That’s — that’s good of you to say. These things take a season.', 'Thank you. I’ll tell Tansy. She won’t believe it, but I’ll tell her.'],
  },
  aveline: {
    good: ['I heard {you}. Go gently, child. You are doing well.', 'Word is {you}. The candles were bright this morning. I wondered why.'],
    bad: ['I heard {you}. Sit, if you like. We should talk about it.', 'Mm. I heard {you}. Everyone falls, child. The question is the getting up.'],
    grave: ['I have been to war, child. I know what a raised hand is. Leave her be.', 'The flame you were given was lit from the road-candle. Do not make me sorry for it.'],
    cold: ['Not today, child.', 'The candles need me.'],
    mend: ['Mm. Penance is long, child. You have begun it.', 'I heard you. So did the flame. Keep walking that way.'],
  },
  garrick: {
    good: ['Ha! Heard {you}! Good for business, a hero in the village. Discount? Small one.', 'Word on the road is {you}. Ha! You’ll be in a song by Saltmere.'],
    bad: ['Heard {you}. Bad for business, that. Bad for yours, mostly.', 'Ha. Word is {you}. People talk, my friend. I sell to people.'],
    grave: ['Shop’s shut. For you, it’s shut.', 'Not for sale. Nothing. Not to you.'],
    cold: ['Busy, busy. Ledgers.', 'Ha. No.'],
    mend: ['Ha. Sorry’s good. Coin’s better. Time’s best. We’ll see.', 'Well. That’s a fair opening offer. I’m still haggling.'],
  },
  hess: {
    good: ['Mm. Heard {you}. Good.', 'Heard {you}. Mm. Clean work.'],
    bad: ['Mm. Heard {you}.', 'Heard {you}. Mm. Don’t.'],
    grave: ['Touch her again and I’ll know where you sleep. I always know.', 'Mm. Stay downwind of me.'],
    cold: ['Mm.', 'No.'],
    mend: ['Mm. Tracks go both ways. Keep walking this one.', 'Mm. Heard.'],
  },
  sabeth: {
    good: ['I heard {you}. Hold still, there’s a thread. There. You’re looking well.', 'Heard {you}. Good. That’s a good hem on you.'],
    bad: ['I heard {you}. That’s a hard thing.', 'Heard {you}. Hm. Mind how you go.'],
    grave: ['She’s my sister. Don’t come to the vats.', 'I’ve seen what a blade does. Keep yours away from her.'],
    cold: ['Busy. The vats.', 'Not now.'],
    mend: ['Hm. Dye doesn’t wash out in a day. Keep rinsing.', 'I heard you. I’ll tell her you said it. She’ll decide.'],
  },
  alder: {
    good: ['Ahem. I heard {you}. The Moot will note it. Favourably.', 'Ah. Word is {you}. Commendable. Procedurally commendable.'],
    bad: ['Ahem. Word is {you}. That is a matter for the Moot.', 'I heard {you}. I shall have to note it. In the ledger.'],
    grave: ['Striking a neighbour thins the ward for everyone. The Moot will hear of it. It has.', 'Ahem. Keep your distance. That is not a request.'],
    cold: ['Ahem. Not now.', 'I am occupied.'],
    mend: ['Ahem. Amends are noted. In the ledger. The page is long.', 'The Moot weighs amends. Slowly. As it weighs everything.'],
  },
  petra: {
    good: ['Heard {you}! Ha! Come here, let me see your face. Good face.', 'Pfah. Heard {you}. I’d have done it better at your age, but well done.'],
    bad: ['Heard {you}. Pfah. Bad business.', 'Heard {you}. I caught that girl with these hands. Mind yours.'],
    grave: ['I caught that girl with these two hands. Get out of my sight, duckling.', 'Pfah. Eighty-four and I’d still swing for you.'],
    cold: ['Pfah.', 'Go away. I’m old, not stupid.'],
    mend: ['Pfah. Sorry. Bring brandy, and keep saying it.', 'Hm. Good. Now do it for a month.'],
  },
  tilly: {
    good: ['Oi! Heard {you}! Brilliant!', 'Ha! Everyone says {you}. Want to see the new hinge?'],
    bad: ['Oi. Heard {you}. That’s rotten.', 'Heard {you}. Ugh.'],
    grave: ['Oi. Stay out of the forge. I mean it.', 'Say that to my hammer. No, don’t. Just go.'],
    cold: ['Busy.', 'Oi. No.'],
    mend: ['Huh. Okay. Okay. Still cross, though.', 'Fine. Fine! Just — do better.'],
  },
  tansy: {
    good: ['Heard {you}. Huh. Okay. Not bad, for an outsider.', 'Everyone says {you}. Whatever. ...Was it a big one?'],
    bad: ['Heard {you}. Typical.', 'Ugh. Heard {you}.'],
    grave: ['Wow. Even I didn’t think you’d do that.', 'Get away from me. And Pip.'],
    cold: ['What.', 'No.'],
    mend: ['Whatever. Fine. Still watching you.', 'Huh. Okay. Don’t make it weird.'],
  },
  corran: {
    good: ['Hm-hmm. Heard {you}. Still water likes that.', 'Heard {you}. Hm-hmm. Good current, that.'],
    bad: ['Hm. Heard {you}. That’s a bad current.', 'Hm-hmm. Heard {you}. Lake’s heard worse. Not much worse.'],
    grave: ['I pulled that girl out of the lake. Stay off my dock.', 'Hm. Still water. Stay away from it.'],
    cold: ['Hm.', 'Nets need mending.'],
    mend: ['Hm-hmm. Tides turn. Slowly.', 'Hm. Heard you. Lake keeps its counsel. So will I, for now.'],
  },
  wys: {
    good: ['Citizen! I heard {you}! That’s — very good. I’ll tell the Captain!', 'Heard {you}! Good work, citizen. Very good. Not as good as — never mind.'],
    bad: ['Citizen! Word is {you}. I’ll tell the Captain!', 'That’s — I heard {you}! That’s not allowed!'],
    grave: ['You hurt her. Stay back. I’m on duty. I’m very on duty.', 'Halt! I mean — keep away from her. Citizen.'],
    cold: ['Move along, citizen.', 'On duty.'],
    mend: ['Oh. Well. That’s — noted. I’ll tell the Captain.', 'That’s good, citizen. Keep — keep doing that.'],
    barred: ['Halt! Not the Kettle, citizen. Captain’s orders.', 'You can’t go in. Captain says. Sorry. Not sorry. Halt.'],
  },
};

// A fitting answer when someone has no line of their own for something.
export const FALLBACK_TO_YOU = {
  good: ['Heard {you}. Good.'],
  bad: ['Heard {you}. Hm.'],
  grave: ['Keep away from her.'],
  cold: ['Not now.'],
  mend: ['Hm. We’ll see.'],
  barred: ['Not here. Not for a while.'],
};
