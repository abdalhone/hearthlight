// Lines for Lyra's own will (DESIGN §16): refusals, conditions, counter-offers, fear,
// anger, hurt, warnings, leaving, coming back, apologies, wariness. Same grammar as
// lines.js; entries may also filter on `state` (companionship: together | wary | apart |
// left | gone), minTrust/maxTrust and minFear/maxFear toward the player.

const GUARDED = ['wary', 'left'];
const CLOSE = ['together', 'apart'];

export const WILL_LINES = {
  // ------------------------------------------------------------ refusals
  refuse_generic: [
    'No. {reason}.',
    "I'm not doing that. {reason}.",
    'Not this time. {reason}.',
    { t: "I'd rather not, {you}. {reason}.", trait: 'warm', maxFear: 30, state: CLOSE },
    { t: 'Tides, no. {reason}.', trait: 'playful', state: CLOSE },
    { t: "No. And that's the end of it. {reason}.", state: GUARDED },
    { t: 'Ask someone else. {reason}.', trait: 'prickly' },
    { t: "I hear you. The answer's still no. {reason}.", trait: 'steady' },
    { t: "Mm. No. {reason}. Try me with something better.", trait: 'playful', mood: ['happy', 'calm'], state: CLOSE },
  ],
  refuse_noreason: [
    "No. I don't want to.",
    'Not today.',
    "I'm going to say no to that one.",
    { t: "No. I don't owe you a reason.", state: GUARDED },
    { t: 'Mm. No. Next question.', trait: 'playful', state: CLOSE },
    { t: "I'd rather not, {you}. Let it go.", trait: 'warm', state: CLOSE },
    "That's a no from me.",
  ],
  refuse_danger: [
    'Walk into that? No. {reason}.',
    "That's how people end up as a story Elda tells at closing time. No. {reason}.",
    { t: 'I like breathing, {you}. {reason}.', trait: 'playful' },
    'Not with my life on the line. {reason}.',
    { t: "I didn't cross the sea to die in a ditch for you. {reason}.", state: GUARDED },
    { t: "Maren taught me the difference between brave and stupid. That's the stupid one. {reason}.", trait: 'bookish' },
    { t: 'No. {reason}. Find someone else to throw at it.', mood: ['angry', 'tense'] },
  ],
  refuse_tired: [
    'Not tonight — I can barely stand. {reason}.',
    "I'm running on nothing, {you}. {reason}.",
    { t: "If I swing a bow now I'll hit myself. {reason}.", trait: 'playful' },
    'Ask me after I sleep. {reason}.',
    { t: 'No. {reason}. I need rest, not orders.', state: GUARDED },
  ],
  refuse_hungry: [
    "After I eat. I mean it. {reason}.",
    { t: 'Feed me first. Then we talk. {reason}.', trait: 'playful' },
    "I'm not working on an empty stomach. {reason}.",
    { t: "Honey cake, then heroics. That's the order. {reason}.", trait: 'playful', state: CLOSE },
  ],
  refuse_hurt: [
    "Look at me — I'm bleeding. No fighting. {reason}.",
    "Not like this. I'm hurt. {reason}.",
    { t: "One more hit and I'm on the ground. No. {reason}.", mood: ['tense', 'low'] },
    { t: 'Patch me up first, then ask again. {reason}.', trait: 'warm', state: CLOSE },
  ],
  refuse_values: [
    "I won't hurt them. Don't ask me again. {reason}.",
    'No. That goes against everything I am. {reason}.',
    { t: "I'm not that kind of person. I thought you knew that. {reason}.", state: CLOSE },
    { t: "Absolutely not. {reason}. I'm starting to wonder about you.", state: GUARDED },
    { t: "There's a line, {you}. That's on the wrong side of it. {reason}.", trait: 'steady' },
    "No. I don't do cruelty, not for anyone. {reason}.",
  ],
  refuse_trust: [
    "I don't trust you enough for that. Not anymore. {reason}.",
    'You want me to turn my back on you? After that? {reason}.',
    { t: 'Earn it back first. {reason}.', state: GUARDED },
    "Trust isn't something you get to order. {reason}.",
    { t: "Not yet. Give me time. {reason}.", trait: 'warm' },
  ],
  refuse_fear: [
    "Stay where you are. I'm not going anywhere with you. {reason}.",
    "No. I'm keeping my distance. {reason}.",
    { t: "Don't come closer. I mean it. {reason}.", minFear: 40 },
    'I can still feel that blade. No. {reason}.',
  ],
  refuse_pushed: [
    'I already said no. {reason}.',
    'Asking again won\'t change it. {reason}.',
    { t: 'No means no the second time too, {you}.', trait: 'playful', state: CLOSE },
    { t: "Stop. I heard you the first time. {reason}.", mood: ['angry', 'tense', 'calm'] },
    'Same answer. {reason}.',
  ],
  refuse_left: [
    "We're not traveling together anymore. You don't get to ask me for things.",
    "No. I'm done taking requests from you.",
    'You lost the right to ask me that.',
    "I'm not yours to order around. I never was.",
    'No. Go away.',
  ],
  refuse_and_act: [
    'No. And stay back.',
    "No — and don't you dare try it again.",
    "That's it. Don't move.",
    { t: "No! Get away from me.", minFear: 40 },
    'Not happening. Back off. Now.',
  ],
  refuse_offer: [
    "Keep your coin. It's not about money. {reason}.",
    "Money doesn't change it. {reason}.",
    { t: "You can't buy this one, {you}. {reason}.", trait: 'playful', state: CLOSE },
    "No amount of coin makes that a good idea. {reason}.",
  ],

  // ------------------------------------------------ conditions and counters
  accept_condition: [
    'Fine — {condition}.',
    'Alright. On one condition: {condition}.',
    { t: "I'll do it. But {condition}. That's the deal.", trait: 'steady' },
    { t: 'Deal, if {condition}. Shake on it?', trait: 'playful' },
    { t: 'Okay. {condition}, though. I mean it.', state: GUARDED },
  ],
  counter_offer: [
    "Not that. But I'll {counter}, if you like.",
    'How about this instead: I {counter}.',
    "No. I could {counter}, though.",
    { t: 'Counter-offer: I {counter}. Take it or leave it.', trait: 'playful' },
    { t: "I won't do that. I'll {counter}. That's as far as I go.", state: GUARDED },
    { t: 'Let me {counter} instead. It makes more sense, trust me.', trait: 'warm', state: CLOSE },
  ],
  counter_taken: ['Good. Then that\'s what we do.', 'Deal.', { t: 'See? Compromise. Look at us.', trait: 'playful' }, 'Alright. Off I go.'],
  counter_declined: ['Suit yourself.', 'Your loss.', { t: "Fine. The offer's on the table if you change your mind.", trait: 'warm' }, 'Then we stay as we are.'],
  accept_paid: [
    '{coins} coins? Done. You pay when it\'s done.',
    "For {coins} coins, I'll do it. I'll hold you to that.",
    { t: 'Now you\'re speaking my language. {coins} coins, and I\'m yours for the job.', trait: 'playful' },
    { t: 'Fair pay. {coins} coins. Shake on it.', trait: 'diligent' },
    '{coins} coins it is. My purse thanks you.',
  ],
  accept_share: [
    'Half is mine, then. Deal.',
    { t: "A fair share? Now we're partners.", trait: 'warm' },
    { t: 'Split down the middle. I\'m counting, you know.', trait: 'playful' },
    "Fine. Half the take is mine.",
  ],
  offer_nothing: [
    'Pay me for what?',
    { t: "Coins for nothing? I'm not complaining, but what's it for?", trait: 'playful' },
    'Keep it until you have something to ask.',
  ],
  why_refused: ['Because {reasons}.', '{reasons}. That\'s why.', 'You want the truth? {reasons}.', { t: 'Simple: {reasons}.', trait: 'steady' }],
  why_refused_none: ["I said no. I'm allowed to.", "Because I didn't want to. That's reason enough.", { t: "Do I need a better reason than 'no'?", trait: 'playful' }],

  // ---------------------------------------------------- how she sees you
  trust_player_high: [
    'I do. More than I expected to.',
    { t: "With my life. Don't make a big thing of it.", trait: 'playful' },
    "Yes. You've earned it, road by road.",
  ],
  trust_player_mid: [
    "Mostly. Don't make me regret it.",
    "I'm getting there. Slowly.",
    { t: 'Trust you? Most days. Ask me again after the ruins.', trait: 'playful' },
  ],
  trust_player_low: [
    "Not right now. You'll have to earn it back.",
    "No. Not after what you did.",
    { t: "I want to. That's not the same thing.", trait: 'warm' },
  ],
  fear_player_none: [
    'Afraid of you? Ha. No.',
    { t: "You? You fall over your own feet. No.", trait: 'playful' },
    "No. Should I be?",
  ],
  fear_player_some: [
    '...A little. After what happened.',
    "I keep one eye on your sword hand now. So — yes, a little.",
    'Some. I hate that I am.',
  ],
  fear_player_high: [
    'Yes. Is that what you wanted to hear?',
    "Yes. So keep your distance.",
    "I'm afraid of you. I never thought I'd say that.",
  ],
  plan_report: ['Today? {plan}', "Here's my day: {plan}", { t: "I've got plans of my own, you know. {plan}", trait: 'playful' }, '{plan}'],
  plan_none: ["No plan. I'm letting the day decide.", 'Nothing fixed. I go where I\'m needed — or wanted.', { t: 'A plan? I have a vague intention and a sandwich.', trait: 'playful' }],
  why_left: [
    'You know why. {reason}',
    "Because I couldn't trust you anymore. {reason}",
    'I left because staying hurt more. {reason}',
  ],
  why_left_none: ["You know why.", "Think about it. You'll get there.", "I'm not explaining it twice."],

  // --------------------------------------------------- state-specific talk
  wary_reply: [
    "I'm listening. From over here.",
    'Say what you need to say.',
    "Mm. Go on. I'm keeping my distance, that's all.",
    { t: 'Talk. I\'ll decide what I think after.', trait: 'steady' },
    "Careful, {player}. I'm watching how you act, not what you say.",
  ],
  wary_greet: [
    'Hello. ...Keep your hands where I can see them.',
    "Hi. I'm still here. Don't read too much into it.",
    '{player}.',
    { t: 'Oh. It\'s you. Hello.', trait: 'prickly' },
  ],
  left_reply: [
    'I have nothing to say to you.',
    "We're done talking.",
    'Leave me be.',
    "Don't. Just don't.",
    "I heard you. I'm not answering.",
    { t: 'Go away, {player}.', minFear: 30 },
    'Whatever it is, the answer is no.',
  ],
  left_greet: ["Don't.", '...', "What do you want?", "I'm not ready to talk to you."],
  apart_greet: [
    'Oh — hello! Fancy meeting you here.',
    "Hey, {you}. I'm busy with my own day, but hello.",
    { t: "There you are. I was hoping I'd run into you.", minBond: 2 },
    "Hi. I've been keeping busy. You?",
  ],

  flirt_wary: [
    'Not now. Not after that.',
    "Don't. You don't get to sweet-talk your way past what happened.",
    { t: 'Save the charm. I want to see how you act.', trait: 'steady' },
    "...No. I'm not in the mood for that from you.",
  ],
  compliment_wary: [
    "Nice words. I'm watching what you do, though.",
    'Thank you. That doesn\'t fix anything.',
    { t: 'Kind of you. Ask me again in a few days.', trait: 'warm' },
  ],
  opinion_player_wary: [
    "Honestly? I don't know anymore. You scared me.",
    "I'm still deciding. You'll have to show me who you are.",
    { t: "I liked who I thought you were. I'm waiting to see if that's who you are.", trait: 'bookish' },
  ],
  not_avoiding: ["Avoiding you? I'm right here.", "I'm not. ...Am I? I didn't mean to be.", { t: "You're imagining things. Mostly.", trait: 'playful' }],
  plan_now: ['Right now, {plan}.', '{plan}, at the moment.'],

  // --------------------------------------------------------- apologies
  apology_reject: [
    "Sorry doesn't unbreak it.",
    'Words are cheap, {player}. Show me.',
    'You said that last time.',
    { t: "I want to believe you. I don't. Not yet.", trait: 'warm' },
    "Don't. You don't get to make it small with one word.",
  ],
  apology_wary: [
    "I hear you. I'm keeping my distance a while longer.",
    "Thank you for saying it. I'm still watching.",
    { t: "Okay. That helps a little. Don't make me regret it.", trait: 'warm' },
    "Noted. Prove it, and we'll see.",
  ],
  apology_believed_left: [
    "...I believe you. That doesn't mean I'm coming back tonight.",
    "Alright. I think you mean it. Give me time.",
    { t: "I believe you. I'm still sleeping at the Kettle for now.", trait: 'steady' },
    "That sounded true. I'll think about it. Properly.",
  ],
  apology_repeat: [
    'You keep apologizing and doing it again.',
    "Stop saying sorry. Stop doing the thing.",
    "I've heard that word from you enough today.",
  ],

  // ------------------------------------------------------------ deeds (barks)
  deed_hit_accident: [
    'Ow! Watch your swing!',
    "Hey — that was my arm!",
    'Mind the blade, {you}!',
    { t: "Careful! I'm on your side, remember?", trait: 'warm' },
    { t: 'Ow! Aim for the monsters. The ones with teeth.', trait: 'playful' },
  ],
  deed_hit: [
    'What are you doing?!',
    'Did you just— are you out of your mind?',
    "Stop! It's me!",
    "Don't you ever do that again.",
    { t: 'You hit me. You actually hit me.', mood: ['low', 'tense', 'calm'] },
  ],
  deed_hit_again: [
    "That's it. Stay there.",
    'No more. I warned you.',
    "Again?! I'm done.",
    'You will not touch me again.',
  ],
  deed_protected: [
    'You came for me. Thank you.',
    "That was close. Thanks for having my back.",
    { t: 'My hero. Don\'t let it go to your head.', trait: 'playful' },
    { t: "I saw that. I won't forget it.", trait: 'steady' },
  ],
  deed_kindness: [
    'That was kind of you.',
    { t: "Huh. You've got a good heart under all that road dust.", trait: 'playful' },
    'Thank you for that. Really.',
    { t: "That's the person I want to travel with.", minBond: 2 },
  ],
  deed_killed_harmless: [
    'Was that necessary?',
    "It wasn't hurting anyone.",
    "...We didn't need the meat.",
    { t: 'Poor thing. It was just trying to live.', trait: 'warm' },
  ],
  deed_attacked_villager: [
    'Stop! What are you doing?!',
    "They're a villager! Put it down!",
    'Have you lost your mind?! Stop!',
    "Get away from them! Now!",
  ],
  deed_reckless: [
    'You nearly got me killed back there.',
    "I'm not your shield, {player}.",
    { t: 'Next time you pick a fight, pick one we can win.', trait: 'playful' },
    'I almost died for that order. Think about it.',
  ],
  deed_broke_promise: ['You promised.', 'So much for your word.', "I'll remember that you said it. And that you didn't.", { t: 'A promise is a promise, {player}. Was.', trait: 'steady' }],
  deed_kept_promise: ["You kept your word. I'll remember that.", { t: 'You actually did it. Huh. Thank you.', trait: 'playful' }, 'Thank you. You did what you said.', { t: 'A person of their word. Rare as moonpetals.', trait: 'bookish' }],
  deed_respected_refusal: ['Thank you for not pushing.', { t: 'You let it go. I noticed.', trait: 'steady' }, 'You took no for an answer. That matters.', { t: "Thanks. I know you wanted it.", trait: 'warm' }],
  deed_pushed: ['I already said no.', "Asking again won't change it.", { t: "Pushing me? Really?", mood: ['angry', 'tense', 'calm'] }, 'Stop pushing.'],
  deed_stole: ['Put that back. We are not thieves.', "That isn't yours.", { t: "I didn't see that. I'm going to pretend I didn't see that. Put it back.", trait: 'playful' }, 'Stealing? From people who fed us?'],
  deed_abandoned: ['You left me lying there.', { t: 'Nobody came. You were right there, and nobody came.', mood: ['low', 'tense', 'calm'] }, 'I woke up alone. Remember that.', "You walked away while I was down. I won't forget it."],

  // ---------------------------------------------------- companionship shifts
  became_wary: [
    "I'll walk with you. But not close.",
    "I'm still here. I'm just watching you now.",
    'Give me some room. I need to think about who you are.',
    { t: "Something's changed. I'm keeping my distance for a while.", trait: 'steady' },
  ],
  trust_regained: [
    "...Fine. You're forgiven. Mostly.",
    "Alright. I'll stop watching your sword hand.",
    { t: "You've been good lately. I noticed. Come on, then.", trait: 'warm' },
    'Okay. We\'re alright again. Don\'t waste it.',
  ],
  going_apart: [
    "I'm going to live my own day for a while. You know where to find me.",
    "I've got things to do. Come find me later, if you like.",
    { t: "I'm off on my own business. Don't burn the cottage down.", trait: 'playful' },
    "We'll go our own ways for now. It's not goodbye.",
  ],
  leaving: [
    "I'm done. Don't follow me.",
    "I can't travel with someone I'm afraid of. Goodbye.",
    "I'm leaving. If you ever want to fix this, you'll have to mean it.",
    "That's enough. I'm going.",
  ],
  gone_farewell: [
    'Goodbye, {player}. I hope you become someone better.',
    "I'm leaving Hearthvale. Don't come after me.",
    "This is where I go. Don't follow.",
    'I stood beside you once. Never again. Goodbye.',
  ],
  returning: [
    "...Alright. Let's try this again. Slowly.",
    "I'm coming back. Don't make me regret it.",
    { t: 'I missed this. A little. Don\'t gloat.', trait: 'playful' },
    'Okay. Together again. Carefully.',
  ],
  crime_warning: [
    "What have you done?! The guards will be after you!",
    "You attacked them. I can't believe you attacked them.",
    "Stop! This isn't who we are!",
    'Put it down! Rowan will hang you for this!',
  ],
  promise_made: ["I'll hold you to that.", 'A promise, then. I keep count.', { t: 'Promise noted. In ink.', trait: 'bookish' }, "Good. Don't forget it."],
  gift_cold: [
    "...Thank you. It doesn't change anything.",
    "I'll take it. Don't read into that.",
    'Fine. Leave it there.',
    "You can't buy your way back. But thank you.",
  ],
  fear_bark: ['Stay back.', "Don't come closer.", 'Keep your distance.', 'Not one more step.'],
  wary_idle: [
    "I'm watching you.",
    'Keep your blade sheathed near me.',
    "I haven't forgotten.",
    { t: 'Still deciding about you.', trait: 'steady' },
  ],

  thought_doubt: [
    "Sorry. They always have a sorry ready.",
    "I want to believe it. That's the dangerous part.",
    'Words cost nothing. We\'ll see.',
  ],
  thought_refusal: [
    "No. I don't have to explain myself to anyone.",
    'They can be annoyed. I can live with annoyed.',
    'My life, my call.',
    { t: 'I hope they understand. If not — that is theirs to carry.', trait: 'warm' },
  ],

  // -------------------------------------------------- acks for her own will
  ack_rejoin: ["...Alright. I'll come with you again.", "Fine. Together, then. For now.", { t: 'I was getting bored without you anyway.', trait: 'playful' }],
  ack_part_ways: ['Alright. I have my own things to see to.', "Fair. I'll be around the village.", { t: "Finally, a day off. Don't miss me too much.", trait: 'playful' }],
  ack_promise: ["I'll hold you to that.", 'A promise. I keep count, you know.', { t: 'Promise noted. In ink.', trait: 'bookish' }],
  ack_flee: ['Running — not arguing!', 'Getting out of here!', 'Away. Now.'],
  ack_keep_distance: ["I'll keep my distance.", 'Giving you room.'],
  ack_warn: ["Consider yourself warned.", "I've said it. Listen this time."],
  ack_wait_outside: ["I'll wait outside.", "I'm not going in there. I'll wait here."],
};
