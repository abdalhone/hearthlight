// What Hearthvale says about a death (DESIGN §29): the cry of someone who saw it, the
// finding of a body, the covering, grief, the funeral words, the watch's questions, the
// Moot, and Lyra. Each villager in their own voice where it matters (LORE §6, §11); ANY is
// the plain fallback. Placeholders as in village_life/voice.js: {who} the dead as the
// speaker names them, {WHO} shouted, {he} {him} {his} {He} {His}, {P} the player's name,
// {n} what the speaker calls the listener, {place}, {at}, {when}, {When}, {with}, {from}.
// Nothing here may say a truth LORE §9.10 keeps hidden.

import { fillLine } from '../ai/village_life/voice.js';

export const ANY = {
  alarm: ['Murder! MURDER! Help!', "They've killed {who}! Watch! THE WATCH!", '{WHO}! No— help! Somebody help!'],
  alarmGlimpse: ['Someone— someone struck {who} down! Help!', 'Help! Over there— someone with a blade!'],
  foundBody: ["It's {who}. Oh, no. No. It's {who}.", "Help! Over here! It's {who}— {he}'s not breathing!", "{WHO}! Someone get Rowan. Get Rowan now."],
  lakeGives: ["The lake's given someone back. Oh, flame. It's {who}."],
  cover: ['Somebody cover {him}. Please.', "Don't look. Here. My cloak."],
  wound: ['That was a blade. Somebody did this.', 'No beast did that. That was a blade.'],
  seenCarry: ["I saw {P} {when}, carrying something heavy toward {place}. Didn't think anything of it.", '{When} I saw someone lugging a bundle toward {place}. Looked like {P}.'],
  seenCarryClear: ['{P} was carrying {who}! I saw {him}! {WHO}!', "What are you carrying? That's— that's {who}! HELP!"],
  witnessTell: ['I saw it. {P} struck {who} down {at}.', 'I was there. I saw {P} do it.'],
  glimpseTell: ['I saw someone strike {who} {at}. In the dark. I think it was {P}.'],
  mournGreet: ["Not today. We buried {who} {when}.", "I can't talk. Not today. {who}…"],
  afraid: ['Stay away from me. I know what you did.', "Don't come near me. Murderer."],
  refuse: ["I'll not sell to you. Not after {who}.", 'Get out of my shop.'],
  heir: ["{who}'s work won't do itself.", "Someone has to keep {his} work going. It's me now."],
  undone: ["Nobody does what {who} did. Nobody can."],
  funeralWord: ['Rest now, {who}.', 'Go gently, {who}.'],
  mootNews: ["The Moot sat on {who} last night. They've doubled the night watch.", "The Moot met about {who}. Everyone's to keep their doors barred after the bell."],
};

export const LIFE = {
  hobb: {
    alarm: ['Well now— no. No! {WHO}! Somebody! Somebody, quick!'],
    foundBody: ["Oh, {who}. Oh, my dear. Somebody fetch the watch. I'll sit with {him}."],
    funeralWord: ["I've lit lamps for the dead before. Never thought I'd light one for you, {who}."],
    mournGreet: ["Forgive me. I'm not much company. {who}…"],
  },
  wenna: {
    alarm: ['What was that? Who fell? {WHO}?! Answer me!'],
    foundBody: ["Who's lying here? Let me— oh. Oh, no. It's {who}. I know {his} hands."],
    funeralWord: ['I sang at your naming, {who}. I never thought I would sing this.'],
  },
  elda: {
    alarm: ["Rowan! ROWAN! They've killed {who}!"],
    foundBody: ["{who}? Love? Oh, flame— oh, flame, no. ROWAN!"],
    cover: ['Here. My shawl. Nobody looks at {him} like this.'],
    funeralWord: ["I'll keep your bowl at the end of the bar, {who}. I'll keep it anyway."],
    mournGreet: ["Kettle's open. Don't ask me how I am."],
    refuse: ["Not in my Kettle. Not after {who}. Out."],
  },
  bram: {
    alarm: ['HEY! Stand away from {him}! WATCH!'],
    foundBody: ['…{who}. Get Rowan. Nobody touch {him}.'],
    funeralWord: ['Hmph. Good— good soul. Rest.'],
    refuse: ['No steel for you. Not ever. Get out of my forge.'],
  },
  pip: {
    alarm: ['{WHO}! Get up! GET UP! Somebody HELP!'],
    foundBody: ["{who}? {who}, wake up. Why won't {he} wake up?"],
    mournGreet: ["Is {who} really dead? Really really?"],
    afraid: ["Go away! Go AWAY! I'm telling Rowan!"],
  },
  rowan: {
    alarm: ['Murder! You— stand where you are! WYS!'],
    foundBody: ["{who}. Wys, keep everyone back. Nobody touches anything."],
    cover: ['Cover {him}. Then everyone back to their doors.'],
    wound: ['A blade. Somebody did this, and I will know who.'],
    funeralWord: ['I will find who did this, {who}. I swear it on the bell.'],
    afraid: ["Don't. Don't take one more step toward anyone."],
  },
  mira: {
    alarm: ["{who}! No, no, no— let me through! Let me SEE {him}!"],
    foundBody: ["Let me— I can— oh. Oh. There's nothing to do. There's nothing I can do."],
    funeralWord: ['I tried to be faster. I am sorry, {who}.'],
    refuse: ["I— no. I'll not sell to you. Please go."],
  },
  tobias: {
    alarm: ["Oh no, oh no— help! HELP! Somebody's killed {who}!"],
    foundBody: ["That's— that's {who}. I'm sorry. I'm so sorry. Somebody—"],
  },
  aveline: {
    alarm: ['Stop! In the name of every flame on that altar— stop!'],
    foundBody: ['{who}. Peace, child. Peace. Someone bring the watch, and a clean cloth.'],
    cover: ['A clean cloth. Gently. {He} was one of ours.'],
    funeralWord: ['We give back what the Hearth lent us. Go into the light, {who}. We will keep your flame a while.'],
  },
  garrick: {
    alarm: ['Murder! Murder in the lane! Somebody fetch the watch!'],
    foundBody: ["Oh, that's— that's {who}. Oh, I don't— Rowan! Somebody fetch Rowan!"],
    refuse: ["Nothing on my shelves for you, friend. Not one thing. Not ever."],
  },
  hess: {
    alarm: ['DROP IT. Drop the blade. Now.'],
    foundBody: ['Found {who}. Dead a while. Somebody fetch the captain.'],
    wound: ["Blade. Not claws. Somebody stood over {him} and did it."],
    funeralWord: ['Mm.'],
  },
  sabeth: {
    alarm: ["{who}! Hess! HESS!"],
    foundBody: ["It's {who}. Oh, it's {who}. Somebody get Hess."],
  },
  alder: {
    alarm: ['Murder! Witness it— everyone witness it! Watch!'],
    foundBody: ['{who}. This— this is a matter for the Moot. Fetch the captain at once.'],
    mootNews: ['The Moot has sat on {who}. The night watch is doubled, and every door is barred after the bell.'],
  },
  petra: {
    alarm: ["You murdering— somebody! SOMEBODY! They've done for {who}!"],
    foundBody: ["Eighty-four years and I've never— {who}. Somebody get the boy with the sword. Rowan."],
    funeralWord: ["I caught half of you lot, and I'll bury all of you, it seems. Rest, {who}."],
  },
  tilly: {
    alarm: ["HEY! Get away from {him}! WATCH! WYS!"],
    foundBody: ["{who}? No. No, no. Somebody— I'm getting Rowan. Don't move {him}."],
    heir: ["The forge stays lit. {He}'d want it lit.", "Hinges, nails, ferrules. Same as if {he} were here. {He}'s not here."],
  },
  tansy: {
    alarm: ['{WHO}! HESS! Somebody! They— they killed {him}!'],
    foundBody: ["Oh— oh no. That's {who}. I'll get Hess. I'll get the captain. Stay there."],
  },
  corran: {
    alarm: ['Oi! OI! Help! Help here!'],
    foundBody: ["That's {who}. Poor soul. Somebody fetch the watch."],
    lakeGives: ['The lake gives back what it takes. Always does. Oh. Oh, {who}.'],
  },
  wys: {
    alarm: ['Halt! HALT! Murder— Captain! CAPTAIN!'],
    foundBody: ["Citizen— {who}? Oh, flame. Captain! Captain, it's {who}!"],
    afraid: ['Stay back! I— I will use this!'],
  },
};

// The watch's questions (DESIGN §29): the one who leads the investigation asks.
export const WATCH = {
  rowan: {
    open: ["We found {who}. I'm asking everyone the same questions. You first.", "{who} is dead. A blade. I'm asking questions, and you're going to answer them."],
    lastSeen: ['When did you last see {who}?'],
    near: ['{from} saw you {at}, {when}. What were you doing there?'],
    carry: ['{from} saw you carrying something heavy toward {place}, {when}. What was it?'],
    with: ['{from} saw you with {who} {when}. Where did {he} go after?'],
    caught: ['Odd. {from} says otherwise.', "That's not what {from} saw."],
    deflect: ["I didn't ask what you thought of my questions.", 'Answer the question.'],
    honest: ['Hm. Thank you for the straight answer.', 'All right.'],
    confess: ["…Thank you for not making me drag it out of you. Hands where I can see them."],
    free: ["That's all for now. Don't leave the valley.", "Don't leave the bell-reach. I'll know if you do."],
    arrest: ["You're coming to the guardhouse. The Moot will hear this.", "That's enough. You'll come with me. Now."],
  },
  wys: {
    open: ["Citizen. I— the captain would want me to ask. About {who}."],
    lastSeen: ['When did you— when did you last see {who}?'],
    near: ['{from} says you were {at}, {when}. Why?'],
    carry: ['{from} saw you carrying something. Toward {place}. {When}. What was it?'],
    with: ['{from} saw you with {who} {when}. What happened after?'],
    caught: ["That's— no. {from} says different."],
    deflect: ['Just— just answer. Please.'],
    honest: ['Right. Right. Thank you.'],
    confess: ['…You— oh. Oh. Hands. Show me your hands.'],
    free: ["That's— that's all. Don't go anywhere. Please."],
    arrest: ["You're coming with me. To the guardhouse. Now. I mean it."],
  },
  hess: {
    open: ['{who} is dead. You and I are going to talk.'],
    lastSeen: ['Last time you saw {who}. When.'],
    near: ['{from} saw you {at}, {when}. Why.'],
    carry: ['{from} saw you carrying something heavy toward {place}. What.'],
    with: ['You were with {who} {when}. Then what.'],
    caught: ['Liar. {from} saw.'],
    deflect: ['Answer.'],
    honest: ['Mm.'],
    confess: ['Mm. Hands.'],
    free: ["Don't leave. I track for a living."],
    arrest: ["You're coming with me."],
  },
  alder: {
    open: ['With the watch as it is, the Moot must ask. Regarding {who}.'],
    lastSeen: ['For the record: when did you last see {who}?'],
    near: ['{from} attests you were {at}, {when}. Explain.'],
    carry: ['{from} attests you carried something toward {place}, {when}. What was it?'],
    with: ['{from} attests you were with {who} {when}. And after?'],
    caught: ['That is not consistent with what {from} attests.'],
    deflect: ['The question stands.'],
    honest: ['Noted.'],
    confess: ['…Noted. The Moot will sit.'],
    free: ['That will do for the record. You will not leave the bell-reach.'],
    arrest: ['The Moot will hear this. You will come with me.'],
  },
};

// The player's answers, by kind. {where} is a real place they could name.
export const ANSWERS = {
  truth: (where, when) => `${when ? `${cap(when)}, ` : ''}${where}.`,
  lieNever: () => "I haven't seen them in days.",
  lieElsewhere: (alibi) => `I was ${alibi} all day.`,
  excuse: (place) => (/(wood|meadow|glade)/.test(place) ? 'Gathering herbs.' : /(lake|dock)/.test(place) ? 'Fishing.' : 'Just walking.'),
  firewood: () => 'Firewood.',
  deflect: () => 'Why are you asking me?',
  dunno: () => "I don't know what they saw.",
  confess: () => 'I killed them.',
};

// The Moot sits (the trial). The chair speaks; the watch tells what it knows.
export const MOOT = {
  open: {
    alder: ['The Moot sits. We are here because {who} is dead.', 'The stranger under the hearthwatch stands accused of {his} death.'],
    elda: ["The Moot sits. Alder's not here to say it properly, so I'm saying it. {who} is dead."],
    petra: ["The Moot sits, and I'm the oldest thing in it, so I'll talk. {who} is dead."],
    aveline: ['The Moot sits. We are gathered because {who} has died by a blade.'],
    hobb: ["Well now. The Moot sits. {who} is dead, and we have to say why."],
  },
  guilty: {
    alder: ['The Moot finds the stranger guilty of the death of {who}.', 'The sentence is the oldest one we have. Outside.'],
    elda: ['Guilty. And the sentence is the old one. Outside.'],
    petra: ['Guilty, and no mistake. Outside with you.'],
    aveline: ['Guilty. May the Hearth have more mercy than we can. Outside.'],
    hobb: ["Guilty. I'm sorry. Outside. That's the old law."],
  },
  notProven: {
    alder: ['The Moot cannot find it proven. You are free to go. You are not free of us.'],
    elda: ["We can't prove it. Go on, then. Everyone will be watching you."],
    petra: ["Can't prove it. Doesn't mean we don't know. Get out of my sight."],
    aveline: ['It is not proven. Go. And if there is anything you need to say, the chapel is open.'],
    hobb: ["We can't say you did it. Go on home. Nobody will forget, mind."],
  },
  outside: [
    'Your flame on the altar is put out. The bell-reach is closed to you for three days.',
    'The watch will walk you to the road. Come back inside the bell before your time, and you will be driven out.',
  ],
};

// Lyra (DESIGN §19.7 at its gravest; §29: she weighs suspicion with all she knows).
export const LYRA = {
  witness: ["NO! What did you— {WHO}! What did you DO?", "You— you killed {him}. You killed {who}. Get away. GET AWAY FROM ME!"],
  hears: ["They say you killed {who}. {from} saw it. Don't— don't come near me.", "{from} saw you kill {who}. I can't look at you."],
  grief: ["{who} is dead. Somebody killed {him}. I need a minute. I need— I need a minute.", "They found {who}. I keep thinking I'll see {him} in the lane."],
  griefParent: ["{who}. That's my— that's my {rel}. Somebody killed my {rel}.", 'Not {who}. Not {who}. Please.'],
  ask: ["Look at me. Did you have anything to do with {who}? Tell me the truth. Just once, the truth.", "I have to ask. {who}. Was it you?"],
  believes: ["I don't need the Moot to tell me. I know what I've seen of you, and I know what they saw. It was you.", "Everything I know points one way. It was you. Don't speak to me."],
  doubts: ["Rowan's asking about you. I told him what I know, which is nothing. Don't make me sorry.", "People are saying things about you. I don't believe them. Yet."],
  confessed: ["You did. You actually— Thank you for not lying to me. It's the only thing you've done right. Stay away from me.", "…That's the truth, then. I'll never forgive it. Never."],
  denied: ["All right. I'm choosing to believe you. Don't make me a fool.", "…All right. I hope that's true."],
  caughtLie: ["You lied to me about {who}. You looked me in the eye and lied.", "You told me you hadn't seen {who}. {from} saw you with {him}."],
  defends: ["You're wrong about them, Captain. I've no proof. Neither have you.", "I don't believe it. Ask me again when you have more than gossip."],
  trial: ["I won't speak for you. I won't speak against you. I'll say what I saw. That's all.", "Tell them the truth. Whatever it is."],
  funeral: ['I keep looking for {him} in the crowd.', "{He} should be here. That's all I can think. {He} should be here."],
};

export const FUNERAL = {
  narrate: ['The chapel bell rings, slow, once for every year {who} lived.', 'They lay {who} beside the others in the chapel yard, under the yews.'],
};

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pickFrom(list, rng) {
  if (!Array.isArray(list) || !list.length) return null;
  const r = typeof rng === 'function' ? rng : Math.random;
  return list[Math.floor(r() * list.length)];
}

// One line for a villager, most particular first, filled for them.
export function murderLine(speaker, key, vars = {}, rng = null) {
  const own = LIFE[speaker]?.[key];
  const list = own?.length ? own : ANY[key];
  return fillLine(pickFrom(list, rng), speaker, vars);
}

export function watchLine(speaker, key, vars = {}, rng = null) {
  const bank = WATCH[speaker] || WATCH.rowan;
  return fillLine(pickFrom(bank[key] || WATCH.rowan[key], rng), speaker, vars);
}

export function mootLines(chair, key, vars = {}) {
  const bank = MOOT[key];
  const list = Array.isArray(bank) ? bank : bank?.[chair] || bank?.alder || [];
  return list.map((l) => fillLine(l, chair, vars)).filter(Boolean);
}

export function lyraLine(key, vars = {}, rng = null) {
  return fillLine(pickFrom(LYRA[key], rng), 'lyra', vars);
}
