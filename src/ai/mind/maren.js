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

// What she says when a stage begins. {P} is the player's name.
export const STAGE_LINES = {
  ask_aveline: [
    '{P}, can I ask you something?',
    'Maren came to Hearthvale three months ago, and then her letters just stopped.',
    'She wrote that the chapel keeps a candle in the window. Sister Aveline might know where she went.',
    "Will you come with me? I'd rather not hear it alone.",
  ],
  find_key: [
    'She walked to the Sunken Ruins and never came back. Aveline kept the candle burning for her all this time.',
    "And the gate's been locked since spring. The bandits up north-east took the warden's key.",
    "Bandits. Of course it's bandits. Tides take them. North-east, then.",
  ],
  find_key_told: [
    'You asked Aveline about Maren? Thank you. Tell me everything.',
    'The Sunken Ruins... and the gate is locked, and the bandits have the key?',
    "North-east, then. I'll bring every spark I've got.",
  ],
  enter_ruins: [
    "The key. Rusted, stamped with the ruins' crest. That's it, that's really it.",
    'My hands are shaking. Ignore them.',
    'The Sunken Ruins are south-west. Whenever you are ready. Soon would be good.',
  ],
  find_journal: [
    "Cold in here. The kind of cold that's been waiting for someone.",
    "Maren came through here. Her wards are in the stones; she always leaves them neater than she found them.",
    "If she left anything, it'll be deeper. Stay close.",
  ],
  read_journal: ["That's... that's her journal. That's Maren's.", 'Would you let me read it? Please.'],
};

// Maren's journal, as found in the deepest room of the Sunken Ruins.
export const MAREN_JOURNAL = [
  {
    date: 'Hearthvale, 3rd of Thawmonth',
    text: "Arrived in the rain. The chapel keeps a candle in its window for travelers; Sister Aveline says it has not gone out in sixty years. I like her already. She makes terrible tea, which is a mark of honesty. Elda at the inn sold me four honey cakes and the life story of every soul in the valley. I ate two before supper. Lyra would be appalled. She would have eaten three.",
  },
  {
    date: '9th of Thawmonth',
    text: 'The Sunken Ruins are older than anyone here believes. Lanternwright work under the moss: a waygate hall, half drowned, its ring still humming. They never truly closed it. And the hum is wrong. Too low, too slow, like something breathing on the far side. I have set wards. I have not told the Captain; he has bandits enough to worry about.',
  },
  {
    date: '15th of Thawmonth',
    text: 'Louder. My wards are being tested from the other side, gently, the way a hand tries a door in the dark. The gate does not open on a place so much as a promise: north, to the Pale Reach, where the Lanternwrights sang to sleep the thing they could not kill. It is waking. I am nearly sure of it now.',
  },
  {
    date: '16th of Thawmonth',
    text: 'I asked the old warden at the toll-house to lock the ruins gate behind me and keep the key until I come out. Nobody should wander in while the stones hum like this. If anyone finds these pages before I return: do not follow without light. Bring a lamp, a friend, and more courage than sense.',
  },
  {
    date: '17th of Thawmonth, late',
    text: "Little lamp, if this reaches you (and of course it will; you have never once done as you were told), don't grieve yet. I am going north through the old waygate to sing the old thing back to sleep before it opens its eyes. I am not afraid. I am a little afraid. Light for the lost first, fire for the wicked last. You were always the best thing I ever made. Bring honey cakes. M.",
  },
];

export function journalText() {
  return MAREN_JOURNAL.map((e) => `${e.date}\n${e.text}`).join('\n\n');
}

// Lyra reading it, line by line (spoken over a few seconds).
export const READ_LINES = [
  "It's her hand. Gods. It's really her hand.",
  "'Bring a lamp, a friend, and more courage than sense.' That's her. That's exactly her.",
  'North. Through the old waygate, to sing something back to sleep. Alone. Of course alone.',
  'But she was alive when she wrote this. Alive, and not afraid. ...A little afraid.',
  "{P}. Thank you. I couldn't have walked into that place without you, and I'm not going north without you either. If you'll come.",
];

export const REREAD_LINES = [
  "'You were always the best thing I ever made.' I keep reading that line.",
  'North, through the waygate. We will follow, Maren. Hold on.',
];

// What each villager knows about Maren, used when their profile has no Maren facts.
// npc: their lines; learned: what Lyra writes down.
export const MAREN_TESTIMONY = {
  aveline: {
    npc: [
      'Maren Ashgrove. Yes. She sat in the third pew most evenings and asked me about the old stones.',
      'The last morning, she asked me to keep the candle burning, and walked toward the Sunken Ruins. She did not come back.',
      'The ruins gate has been locked since spring. Captain Rowan believes the bandits in the north-east took the warden\'s key.',
    ],
    learned: 'Maren asked Aveline to keep the chapel candle burning, then walked to the Sunken Ruins and never came back. The gate is locked; the bandits may have the warden\'s key.',
    lyra: "Thank you, Sister. For the candle, too. I'll bring her back to see it.",
  },
  elda: {
    npc: ["A grey cloak and a laugh you could hear from the cellar? Bought four honey cakes and asked me all about the old ruins. Lovely woman. Terrible at eating slowly."],
    learned: 'Maren bought honey cakes at the Ember Kettle and asked Elda about the Sunken Ruins.',
    lyra: 'That is her. That is so exactly her.',
  },
  rowan: {
    npc: [
      'Your teacher went into the Sunken Ruins against my advice.',
      "Then the bandits raided the warden's toll-house by the ruins and took the gate key. I haven't the soldiers to take it back.",
    ],
    learned: "The bandits took the ruins gate key from the warden's toll-house; it is probably at their camp in the north-east.",
    lyra: "Then I'll take them back for you, Captain. With help.",
  },
  garrick: {
    npc: ['Grey cloak, ink on her fingers? Asked me about the old road north, past the ruins. Told her nobody has walked it in a hundred years. She smiled like that was the point.'],
    learned: 'Maren asked Garrick about the old road north, past the Sunken Ruins.',
    lyra: "North. She always did love a road nobody uses.",
  },
  bram: {
    npc: ["She had me mend a lantern hook. Paid double and wouldn't say why it had to hold through 'a long dark'."],
    learned: "Maren had Bram mend a lantern hook to hold through 'a long dark'.",
    lyra: 'A long dark. Tides. Thank you, Bram.',
  },
  mira: {
    npc: ["She bought every sprig of silverleaf I had. She said she'd need it where she was going. I thought she meant the road."],
    learned: 'Maren bought all of Mira\'s silverleaf, saying she would need it where she was going.',
    lyra: 'Silverleaf. For wounds. ...Thank you, Mira.',
  },
  tobias: {
    npc: ["After she came, I saw lights out by the Sunken Ruins some nights. Blue ones, moving. I didn't go and look. I'm not brave like that."],
    learned: 'Tobias saw blue lights moving in the Sunken Ruins at night after Maren arrived.',
    lyra: "Blue. That's warding light. She was working down there.",
  },
  pip: {
    npc: ['The lady in the grey cloak? She showed me how to make a coin float! Then she went to the scary ruins. Is she your friend? Is she coming back?'],
    learned: 'Maren showed Pip how to float a coin, then went to the Sunken Ruins.',
    lyra: "She's my friend. And I'm going to find out, Pip. Promise.",
  },
};

export const MAREN_OPENERS = [
  "I'm looking for a woman called Maren Ashgrove. Grey cloak, ink-stained fingers. She came through about three months ago.",
  "Can I ask you about Maren Ashgrove? My teacher. She came to Hearthvale this spring and then... nothing.",
];

// "Who is Maren?" / "What happened to Maren?" in her voice, by quest stage.
export function marenAnswer(stage, { what = false } = {}) {
  const who =
    "Maren Ashgrove. My teacher. She found me lighting harbor lamps on Kettlewake and taught me what my fire was for. Grey cloak, ink on her fingers, laughs like a kettle coming to the boil. The closest thing to a mother I ever chose.";
  const status = [
    'She came to Hearthvale three months ago, chasing something under the Sunken Ruins. One letter, then nothing. Her letter mentioned the chapel\'s candle; Sister Aveline might know more.',
    "She came here three months ago and the letters stopped. Her letter mentioned the chapel. I need to ask Sister Aveline about her.",
    "Aveline saw her walk toward the Sunken Ruins. The gate's been locked since spring, and the bandits up north-east have the key.",
    'We have the key now. Whatever happened to her happened in the Sunken Ruins.',
    'She went into these ruins. I can feel her wards in the stones. Deeper.',
    'We found her journal. Please, let me read it.',
    'She went north through the old waygate, to sing something old back to sleep. She was alive when she wrote that. That is enough to walk on.',
  ][stageIndex(stage)];
  return what ? status : `${who} ${status}`;
}

// What she thinks about the arc while walking around (used by spontaneous thoughts).
export const STAGE_THOUGHTS = {
  settle: ["Maren, where are you? Three months is too long for one of your 'little detours'.", 'Everyone here has known Maren for a week or a minute. Somebody saw something.'],
  ask_aveline: ["Sister Aveline might know. And I keep finding reasons not to ask, in case she says the thing I'm afraid of.", 'The candle in the chapel window. Maren wrote about that candle.'],
  find_key: ["A locked gate and a key in a bandit's pocket. Maren would call this 'a reasonable obstacle'. I call it bandits.", 'North-east, the bandit camp. I keep looking that way.'],
  enter_ruins: ['The key is heavier than it looks. Or my hands are lighter.', 'The Sunken Ruins. Maren walked in there with a lamp and a joke, I bet.'],
  find_journal: ['Her wards are everywhere down here. Neat little knots of light. She was here. She was really here.', "Deeper. Whatever's humming down there, it's under my skin now."],
  read_journal: ["Her journal's right there. I'm almost scared to open it.", 'Her handwriting on the cover. I would know it anywhere.'],
  waygate: ["North. The Pale Reach. I've never been so far. She'll need honey cakes.", "'Light for the lost first.' Hold on, Maren. We're coming."],
};
