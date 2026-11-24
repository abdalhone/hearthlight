// The Maren arc: stage definitions, Maren's journal, what villagers know, and what
// Lyra says at each turn. Pure content and small pure helpers; the quest plugin
// drives it.

export const QUEST_ID = 'maren';
export const QUEST_NAME = 'The Candle and the Gate';

export const STAGES = [
  { id: 'settle', title: 'A Bed in Hearthvale', text: 'Settle into Hearthvale — meet the villagers.' },
  { id: 'ask_aveline', title: 'The Candle in the Window', text: 'Ask Sister Aveline about Maren.' },
  { id: 'find_key', title: 'The Locked Gate', text: 'The ruins gate is locked. The bandits northeast may have the key.' },
  { id: 'enter_ruins', title: 'Into the Sunken Ruins', text: 'Search the Sunken Ruins.' },
  { id: 'find_journal', title: 'Deep Stone', text: 'Find a sign of Maren deep in the ruins.' },
  { id: 'read_journal', title: "Maren's Journal", text: 'Let Lyra read the journal.' },
  { id: 'waygate', title: 'The Old Waygate', text: 'Maren went north through the old waygate. To be continued…' },
];

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

export function stageIndex(stage) {
  if (Number.isFinite(stage)) return Math.max(0, Math.min(STAGES.length - 1, stage | 0));
  return STAGE_INDEX[stage] ?? 0;
}

// What she says when a stage begins. {P} is the player's name. Lyra has known Maren
// thirteen years and Aveline all her life: she knows Aveline saw Maren go, and suspects
// Aveline knows something she hasn't said (LORE §7). Aveline never tells her Maren's
// message (LORE §9.10): she may tell the stranger first.
export const STAGE_LINES = {
  ask_aveline: [
    '{P}, can I ask you something?',
    'Maren went over the ruins wall at midsummer and never came back. Sister Aveline saw her go.',
    "Aveline knows something about Maren she hasn't said. I can feel it. And I keep finding reasons not to ask.",
    "Will you ask her? Or come with me when I do. I'd rather not hear it alone.",
  ],
  find_key: [
    'A lantern and a coil of rope, at dusk, toward the ruins. That much I knew. Aveline says it the same way every time.',
    "The gate's been locked by the chapel's order for a hundred and ten years, and the bandits took the key from the lodge this spring.",
    "I've climbed that wall once. Never again without the key: a gate is a way out you can run through. Wicks and ashes. North-east, then.",
  ],
  find_key_told: [
    'You asked Aveline about Maren? Thank you. Tell me everything.',
    'The gate, then. Locked a hundred and ten years, and the bandits have the key.',
    "North-east, then. I'll bring every spark I've got.",
  ],
  enter_ruins: [
    "The key. Rusted, and older than the chapel's seal on it. That's it. That's really it.",
    'My hands are shaking. Ignore them.',
    'The Sunken Ruins are south-west, past the marsh. Whenever you are ready. Soon would be good.',
  ],
  find_journal: [
    "Cold in here. The kind of cold that's been waiting for someone.",
    "Maren came through here. Her chalk-marks are on the stones; she always left them neater than she found them.",
    "If she left anything, it'll be at the bottom of the stair. Stay close.",
  ],
  read_journal: ["That's... that's her journal. That's Maren's.", 'Would you let me read it? Please.'],
};

// Maren's journal, as found at the foot of the stair in the Sunken Ruins. It tells exactly
// what LORE §9.2 "What the journal says" tells, and no more: the stones of this verse are
// failing; the waygate is alive and its verse runs north, to the Crown Ring and past it
// into the Pale; she meant to go through; the wrist with a ring around it; one last line.
// ("Little lamp" belongs to the unfinished letter in Elda's strongbox, not to this.)
export const MAREN_JOURNAL = [
  {
    date: 'Spring, the top room at the Kettle',
    text: "The rubbings from the upper halls again, by bad candlelight. I have read these carvings for nineteen years and only now see what they say. The stones of this verse are failing, one by one.",
  },
  {
    date: 'Midsummer eve',
    text: 'Paid Elda a month ahead. Rope, oil and a hooded lantern from Garrick, at full price, which made him suspicious. Salve from Mira. Turnips from Tobias, for a long walk. Bram sharpened the silver chisel and asked nothing, bless him. Tomorrow is her birthday. I have promised supper.',
  },
  {
    date: 'Midsummer, the foot of the stair',
    text: "The waygate is alive. Not sleeping, not dead: alive, and humming under my hand. Its verse runs north, from here to the Crown Ring, and past the Ring into the Pale. I have come too far to stand at the edge of it. I mean to go through.",
  },
  {
    date: 'The last page',
    text: "A drawing in ink: a wrist, with a thin ring drawn around it. Beside it, in Lanternwright script, the words 'where the Song lets go'. Under it, one line in her plain hand: \"If someone comes out, I hope whoever it is is kind.\"",
  },
];

export function journalText() {
  return MAREN_JOURNAL.map((e) => `${e.date}\n${e.text}`).join('\n\n');
}

// Lyra reading it, line by line (spoken over a few seconds). She concludes what anyone
// reading it would: Maren went north through the old waygate (LORE §9.2).
export const READ_LINES = [
  "It's her hand. Wicks and ashes. It's really her hand.",
  "'The stones of this verse are failing.' The hitch in the Wellstone's hum. She knew. She knew and she didn't tell me.",
  "'From here to the Crown Ring, and past the Ring into the Pale.' She went through. North, through the old waygate.",
  "And the last page. A wrist with a ring around it. 'Where the Song lets go.' ...{P}. Your wrist.",
  "'If someone comes out, I hope whoever it is is kind.' Someone came out. I carried them down the mountain. I don't know what that makes us yet.",
];

export const REREAD_LINES = [
  "'If someone comes out, I hope whoever it is is kind.' I keep reading that line.",
  "North, through the waygate, past the Crown Ring into the Pale. Hold on, Maren. I'm not done being angry at you.",
];

// What each villager saw of Maren's last days (LORE §9.2, "Known"), used when their
// profile has no Maren facts. npc: their lines to Lyra; learned: what Lyra writes down.
// Never anyone's secret: not Aveline's message, not the letter in Elda's strongbox.
export const MAREN_TESTIMONY = {
  aveline: {
    npc: [
      'Nineteen years of late nights by these candles, child. Old gates, old gods and older mistakes. She was my friend.',
      'At midsummer, at dusk, I saw her walk toward the Sunken Ruins with a lantern and a coil of rope. I did not stop her. I am not sure anyone could have.',
      "The gate has been locked by the chapel's order for a hundred and ten years, and the bandits took its key from the lodge this spring. Captain Rowan believes it is at their camp.",
    ],
    learned: 'Aveline saw Maren walk toward the ruins at dusk at midsummer with a lantern and a coil of rope. The gate key was taken by the bandits this spring; Rowan thinks it is at their camp.',
    lyra: "Thank you, Sister. ...If there's more, I'm listening. Whenever you're ready.",
  },
  elda: {
    npc: ["She paid me a month ahead, love. A month! As if she meant to be back for it. Her room's as she left it. I dust it Sundays."],
    learned: 'Maren paid Elda a month ahead at the Kettle before she went, as if she meant to come back.',
    lyra: "Paying ahead so nobody's out of pocket. That is so exactly her.",
  },
  rowan: {
    npc: [
      'The wardwright went over the ruins wall alone. Against the second law, and against my advice. She thanked me for the advice.',
      "Then the bandits raided the ruins-keeper's lodge and took the gate key. I haven't the watchmen to take it back.",
    ],
    learned: "The bandits took the ruins gate key from the ruins-keeper's lodge; it is probably at their camp in the north-east.",
    lyra: "Then we'll take it back, Captain. And I'll tell you first, this time.",
  },
  garrick: {
    npc: ["The day before, she bought rope, lamp oil and a hooded miner's lantern. Paid full price, my friend. Nobody pays full price. I should have asked why."],
    learned: "Maren bought rope, lamp oil and a hooded miner's lantern from Garrick the day before she went, and paid full price.",
    lyra: 'Full price. She was in a hurry. Or saying goodbye.',
  },
  bram: {
    npc: ["Sharpened her a silver chisel. 'For cutting runes out of old stone.' Hmph. Didn't ask."],
    learned: "Bram sharpened a silver chisel for Maren, 'for cutting runes out of old stone'.",
    lyra: 'Runes out of old stone. ...Thank you, Bram.',
  },
  mira: {
    npc: ["She bought my strongest moonpetal salve. 'For cold hands in deep places.' And she asked me what grows on the far side of the old waygate. I didn't know it had a far side. Sorry."],
    learned: "Maren bought Mira's strongest moonpetal salve 'for cold hands in deep places', and asked what grows on the far side of the old waygate.",
    lyra: "The far side. She meant to go through something. Thank you, Mira.",
  },
  tobias: {
    npc: ["She bought a sack of turnips. 'For a long walk,' she said. Oh dear. And that same night the blue lights started in the ruins. I saw them from the field."],
    learned: "Maren bought a sack of turnips from Tobias 'for a long walk', and the blue lights began in the ruins that same night.",
    lyra: 'A long walk. With turnips. That is so exactly her it hurts.',
  },
  pip: {
    npc: ['She could make a coin float! She said she\'d teach me a real one when I\'m bigger, same as you. Is she coming back? Lyra? Is she?'],
    learned: 'Maren promised Pip a real spell when he is older. He misses her too.',
    lyra: "I don't know yet, Sprout. I'm finding out.",
  },
  // Round three's ten (LORE §6): everyone knew Maren nineteen years; none of them knows why she went.
  hobb: {
    npc: ['Well now. She promised you supper that night, Star. Nineteen years, and she never once broke a promise to your mother.'],
    learned: 'Da says Maren never broke a promise to Mam in nineteen years, until midsummer.',
    lyra: 'I know, Da. That is what frightens me.',
  },
  wenna: {
    npc: ["That woman never did a thing by accident. Whatever she went in for, she went in meaning to. And don't you dare go in after her in the dark, Lyra Ambrel."],
    learned: 'Mam thinks Maren went into the ruins meaning to.',
    lyra: 'Not in the dark, Mam. With a key, and a gate I can run through.',
  },
  hess: {
    npc: ["Mm. Her notes said 'the other end'. We went. Found that one instead, two days after she went in. I don't like a trail that crosses itself."],
    learned: 'Hess does not like that the stranger lay in the Crown Ring two days after Maren went in.',
    lyra: "Neither do I. That's why I took the key.",
  },
  sabeth: {
    npc: ["She'd sit by my vats some evenings and let me talk. She listened the way you do, sister. I miss it."],
    learned: 'Beth misses the evenings Maren sat by her vats.',
    lyra: "So do I, Beth. Come and listen to me instead. I'm worse at it.",
  },
  alder: {
    npc: ["In the Moot's view the wardwright's absence is a grave difficulty. And, if I may say so outside the Moot, a grief. She paid a month ahead at the Kettle; it is in the ledger."],
    learned: "Alder grieves Maren in his way. The Moot's ledger shows she paid a month ahead at the Kettle.",
    lyra: "Thank you, Reeve. That's the kindest thing you've said to me in a year.",
  },
  petra: {
    npc: ["The ruins took Maren and the mountain gave us your stranger, kicker. An even trade? We'll see."],
    learned: 'Petra calls it a trade: the ruins took Maren, the mountain gave the stranger.',
    lyra: "It's not a trade, Petra. Nobody asked me.",
  },
  tilly: {
    npc: ["Bram sharpened her a silver chisel and wouldn't let me touch it. Silver! For stone! It'd be blunt in a week. She didn't mean to use it long, did she."],
    learned: "Tilly saw the silver chisel Bram sharpened for Maren, and thinks it wasn't meant to last.",
    lyra: "Maybe not, Copper. Maybe she only needed it once.",
  },
  tansy: {
    npc: ['She knew more about the old stones than anyone, and she went in anyway. So knowing doesn\'t keep you out, does it.'],
    learned: "Tansy thinks knowing wasn't what kept anyone out of the ruins.",
    lyra: 'No. Judgment does. Hers or yours.',
  },
  corran: {
    npc: ["Hm-hmm. The night the blue lights came up in the ruins I was out on the water. Saw them from the lake. Still water keeps its counsel."],
    learned: 'Corran saw the blue lights come up in the ruins from the lake, the night Maren went in.',
    lyra: 'Thank you, Corran. From the dock is close enough for me.',
  },
  wys: {
    npc: ["Cit — Lyra. The Captain says she went over the wall against the second law. I'd have stopped her. Probably. If I'd been there. Sorry."],
    learned: 'Wys was not on watch at the ruins the night Maren went over the wall.',
    lyra: 'Nobody could have stopped her, Watchman. Not even me.',
  },
};

export const MAREN_OPENERS = [
  "Tell me again what you saw of Maren, those last days before midsummer. Anything. Even the small things.",
  "Can I ask about Maren? Not who she was. What she did, the week she went.",
];

// "Who is Maren?" / "What happened to Maren?" in her voice, by quest stage.
export function marenAnswer(stage, { what = false } = {}) {
  const who =
    "Maren Ashgrove. My teacher, and Hearthvale's wardwright for nineteen years. She came out of the Kettle in her nightgown the night I lit the square and said, 'There goes my quiet old age.' Grey cloak, ink on her fingers, laughs like a kettle coming to the boil. The mother I chose, beside the one I was born to.";
  const status = [
    'Maren went over the ruins wall at midsummer and never came back. Sister Aveline saw her go. That was my birthday.',
    "She went over the ruins wall at midsummer and never came back. Sister Aveline saw her go, and I think Aveline knows something she hasn't said.",
    "Aveline saw her walk toward the ruins at dusk with a lantern and a rope. The gate's locked, and the bandits up north-east have the key.",
    'We have the key now. Whatever happened to her happened past that gate.',
    'She came through here. Her chalk-marks are on the stones. Deeper.',
    'We found her journal. Please, let me read it.',
    'She went north through the old waygate, toward the Crown Ring and past it into the Pale. She meant to go through. That is enough to walk on.',
  ][stageIndex(stage)];
  return what ? status : `${who} ${status}`;
}

// What she thinks about the arc while walking around (used by spontaneous thoughts).
export const STAGE_THOUGHTS = {
  settle: ['Three months since midsummer. You promised to come to supper, Maren.', 'Nineteen years in this valley and nobody knows where she went. Somebody saw something.'],
  ask_aveline: ["Sister Aveline knows something she hasn't said. And I keep finding reasons not to ask, in case she says the thing I'm afraid of.", 'The road-candle in the chapel window. Aveline keeps it for whoever is still on the road. Maren is on some road.'],
  find_key: ["A locked gate and a key in a bandit's pocket. Maren would call this 'a reasonable obstacle'. I call it bandits.", "I climbed that wall once. Not again. A gate is a way out you can run through; a rope isn't."],
  enter_ruins: ['The key is heavier than it looks. Or my hands are lighter.', 'The Sunken Ruins. Maren walked in there with a lantern and a joke, I bet.'],
  find_journal: ['Her chalk-marks are everywhere down here. Neat little lines. She was here. She was really here.', "Deeper. Whatever's humming down there, it's under my skin now."],
  read_journal: ["Her journal's right there. I'm almost scared to open it.", 'Her handwriting on the cover. I would know it anywhere.'],
  waygate: ["North. The Pale Reach. I've never been so far. She'll want honey cakes.", "'Keep your own wick.' I am, Maren. I'm coming anyway."],
};
