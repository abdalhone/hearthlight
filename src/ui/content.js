// Written content for the interface: requests, jobs, Lyra's answers, quick
// replies, the How to play page. Pure data + small pure pickers (unit-tested).

// The "Ask Lyra" bar. Every button is a request she weighs (DESIGN.md §16.4): it runs
// game.actions.run(action, args, 'player') and she answers. `key` is its hotkey: Alt
// (Option) + the digit, since the plain number row casts weaves (§22.4).
export const COMMANDS = [
  { id: 'follow', label: 'Follow', icon: 'boots', key: 'Alt 1', action: 'follow', args: { target: 'player' }, hint: 'Ask her to walk with you' },
  { id: 'stay', label: 'Wait', icon: 'flag', key: 'Alt 2', action: 'stay', args: {}, hint: 'Ask her to wait here' },
  { id: 'attack', label: 'Fight', icon: 'sword', key: 'Alt 3', action: 'set_combat_mode', args: { value: 'attack' }, hint: 'Ask her to fight anything that is not a friend' },
  { id: 'defend', label: 'Defend', icon: 'shield', key: 'Alt 4', action: 'set_combat_mode', args: { value: 'defend' }, hint: 'Ask her to fight only what threatens you both' },
  { id: 'passive', label: 'Hold back', icon: 'feather', key: 'Alt 5', action: 'set_combat_mode', args: { value: 'passive' }, hint: 'Ask her to stay out of fights' },
];

// Asking her to travel with you again, once she is apart or has left (§16.3).
export const REJOIN = { id: 'rejoin', label: 'Ask her to come back', short: 'Ask back', icon: 'heart_arcane', action: 'rejoin', hint: 'Ask her to travel with you again', fallbackMessage: 'Will you travel with me again?' };

export const JOBS = [
  { id: 'chop_wood', label: 'Chop wood', icon: 'axe', amount: 5, note: 'Oaks and pines in the Whisperwood' },
  { id: 'gather_herbs', label: 'Gather herbs', icon: 'feather', amount: 4, note: 'Moonpetals too, after dark' },
  { id: 'fish', label: 'Fish', icon: 'rain', amount: 3, note: 'The dock at Mirror Lake' },
  { id: 'mine_ore', label: 'Mine ore', icon: 'gear', amount: 4, note: 'Stone and iron at the quarry' },
  { id: 'forage', label: 'Forage', icon: 'heart', amount: 5, note: 'Berries and wild herbs' },
  { id: 'cook', label: 'Cook', icon: 'sun', amount: 2, note: 'Needs a campfire or hearth' },
  { id: 'collect_loot', label: 'Collect loot', icon: 'coin', amount: null, note: 'Sweeps up nearby drops' },
];

export const DELIVER_OPTIONS = [
  { id: 'player', label: 'To you' },
  { id: 'chest', label: 'To the chest' },
  { id: 'keep', label: 'She keeps it' },
];

// Quick replies under the chat field: things you might say to a friend, not commands.
export const CHIPS = ['How are you?', 'Will you come with me?', "What's on your mind?", 'What do you think of me?', 'Tell me about Maren', 'What are your plans today?'];

// What she says when she agrees to a request and the action itself returned no
// words. She agrees because she chooses to: never "yes, master".
export const ACK_LINES = {
  follow: ["All right, I'll walk with you.", "Lead on. I'll say so if I don't like where we're going.", "Fine. Two pairs of eyes beat one.", 'Coming. Try not to walk into anything.'],
  stay: ["I'll wait here. Not forever.", "Fine. I'll keep this spot warm.", "I'll stay. Call if you need me.", 'Here, then. Be quick about it.'],
  attack: ["All right. Anything unfriendly is fair game.", "If it isn't a friend, it answers to my bolts.", "Gloves off, then. I'll pull back if it turns ugly."],
  defend: ["I'll fight what comes at us. Nothing more.", 'Defensive suits me. I fight only what threatens us.', "I'll cover us both."],
  passive: ["Good. I'd rather not fight at all. I'll keep my healing ready.", 'No bolts, then. I can live with that.', "Peaceful it is. I'll still patch you up."],
  job: ["I'll do it. My share of it is mine, mind.", "Honest work. I don't mind that.", "All right. It's not as if the wood chops itself.", "Fine. Call it a favor you owe me."],
  stop_job: ["Putting it down.", 'Done for now. My arms thank you.', 'Fine by me.'],
  rejoin: ["All right. Let's try this again.", "I'll walk with you. Don't make me regret it."],
  give: ['Here. Take care of it.', "Fine, it's yours. You owe me one.", 'Catch.'],
  use: ['Thank you. I needed that.', "Don't mind if I do."],
  counter: ['Good. That I can do.', 'See? We can agree on things.'],
  // Only when a refusal arrives without words of its own.
  refused: ['No. Not this time.', "I'd rather not.", 'Not today.', "That's a no from me."],
  failed: ["I can't, not right now.", "That isn't going to work from here.", "I tried. It won't happen."],
};

const lastAck = new Map();
// Pick a line, never the same one twice in a row. `rand` is 0..1.
export function pickAck(kind, rand = Math.random()) {
  const list = ACK_LINES[kind];
  if (!list || !list.length) return '';
  let i = Math.floor(rand * list.length) % list.length;
  if (list.length > 1 && lastAck.get(kind) === i) i = (i + 1) % list.length;
  lastAck.set(kind, i);
  return list[i];
}

// One icon for each place you can go, the same on the title, in the menu and on the HUD
// (DESIGN §24). 'spellbook' is the Spellbook's own painted icon (weave_icons.js).
export const MENU_ICONS = Object.freeze({
  resume: 'send',
  continue: 'send',
  newGame: 'sun',
  prologue: 'star',
  book: 'book',
  pastLives: 'flame',
  settings: 'gear',
  howTo: 'hand',
  spellbook: 'spellbook',
  missions: 'scroll',
  lyra: 'mind',
  character: 'shield',
  inventory: 'bag',
  village: 'people',
  save: 'feather',
  quit: 'moon',
});

// The controls, once, for every device (DESIGN §22.4, §24). How to play shows them for
// the device in hand (Touch, Keyboard & mouse or Gamepad); Settings → Controls links
// there instead of repeating them. `null`: that device has no way to do it.
export const CONTROL_DEVICES = [
  { id: 'touch', label: 'Touch' },
  { id: 'keys', label: 'Keyboard & mouse' },
  { id: 'pad', label: 'Gamepad' },
];

export const CONTROLS = [
  { id: 'move', what: 'Move', keys: 'WASD or the arrow keys', pad: 'Left stick or d-pad', touch: 'Put your left thumb down anywhere on the left side and slide' },
  { id: 'sword', what: 'Sword', keys: 'Left click (toward the mouse), J or Space', pad: 'A', touch: 'The sword button; drag it to aim the swing' },
  { id: 'dodge', what: 'Dodge roll', keys: 'K or Shift', pad: 'B', touch: 'The swirl button beside the sword' },
  { id: 'weave', what: 'Cast a weave', keys: '1 – 6 toward the mouse: tap to cast, hold to charge it stronger and let go (a beam pours while held)', pad: 'RT, aimed with the right stick: tap, or hold to charge', touch: 'Tap a weave button to cast at the nearest foe; hold it to charge it stronger; drag from it to aim, let go to cast, drag back onto it to cancel' },
  { id: 'choose', what: 'Choose a weave', keys: 'Mouse wheel, Q / R or a click on its slot; right click casts it', pad: 'LT / RB', touch: 'No choosing: every round button is one weave (its name on it, its mana on its corner)' },
  { id: 'spellbook', what: 'Spellbook', keys: 'B', pad: 'Start, then Spellbook', touch: 'Menu → Spellbook, or the + New weave button' },
  { id: 'interact', what: 'Talk to someone, open, pick up', keys: 'E', pad: 'X', touch: 'The round button above the sword: it says what it does (Talk, Open…)' },
  { id: 'listen', what: 'Listen in', keys: 'L', pad: null, touch: 'Tap “Listen in” when two villagers talk nearby' },
  { id: 'talk', what: 'Chat with Lyra or anyone near', keys: 'T or Enter', pad: 'Y', touch: 'The Talk button above the sword, when nothing else is near' },
  { id: 'ask', what: 'Ask Lyra for help', keys: 'Alt + 1 – 5, or Ask in her Mind', pad: null, touch: 'Tap her portrait: the Ask row is at the top' },
  { id: 'mind', what: "Lyra's mind", keys: 'Tab or M, or a click on her portrait', pad: 'Back', touch: 'Tap her portrait' },
  { id: 'inventory', what: 'Bag', keys: 'I', pad: 'LB', touch: 'Menu → Bag' },
  { id: 'help', what: 'Call for help when you fall', keys: 'E or H', pad: 'X', touch: 'The Call for help button' },
  { id: 'menu', what: 'Menu (pause)', keys: 'Esc', pad: 'Start', touch: 'The Menu button, top right' },
  { id: 'close', what: 'Close a panel', keys: 'Esc, the ✕, or a click beside it', pad: 'B', touch: 'The ✕, a tap beside it, or your phone’s back gesture' },
];

// The rows of CONTROLS one device can use, as [what, how].
export function controlsFor(device) {
  const out = [];
  for (const c of CONTROLS) if (c[device]) out.push([c.what, c[device]]);
  return out;
}

// How to play: what the game is about. The first section is the controls table above.
export const HOW_TO_PLAY = [
  { id: 'controls', title: 'Controls', controls: true },
  {
    id: 'weaving',
    title: 'Weaving',
    text:
      'You can do something no one in Hearthvale can: shape raw Drift with your hands. The village calls it weaving. A weave is a shape (how it leaves your hands), up to two essences (what it is made of: fire, frost, storm…) and up to two twists (how it behaves: split, bounce, homing…). You start with a small bolt of raw weave; every new shape, essence and twist is found through people who need a hand and the great foes around the valley. Make and name weaves in the Spellbook (Menu → Spellbook): 1 pick a shape, 2 add essences, 3 add twists; every change is saved onto your weave buttons at once. A cast costs mana, the blue bar, which fills again by itself. Hold a weave instead of tapping it and it gathers: let go and it flies up to two and a half times as strong and a little bigger, for up to twice the mana (a beam pours instead, and the charge twist gathers twice as fast and hits harder still). After a cast each weave needs a moment before it comes again, longer for the big ones: its button darkens, counts down the seconds and flashes when it is ready. To try every part before you have found it, Settings → Game → Try all magic; to spend your stat points again, Reset stat points beside it.',
  },
  {
    id: 'lyra',
    title: 'Lyra lives for herself',
    text:
      'Lyra and Hess carried you down off the Hollowcrown; you slept eighty-one days. When you woke, Lyra took the hearthwatch for reasons of her own: the stipend, a second blade for the ruins, and whatever ties you to Maren, the teacher who walked into the Sunken Ruins and never came back. She travels with you because she chooses to, while it is good for her. She weighs everything you ask, and she watches what you do. Treat her well and she will trust you. Hurt her, frighten her or harm the people she loves, and she will stop you, run to her people or shout for help. Hearthvale is her home: she never leaves it, and the village stands with her.',
  },
  {
    id: 'talking',
    title: 'Talking',
    text:
      'Open the chat and say anything: ask how she feels, what she thinks of someone, what she remembers. Ask for help in plain words, like "would you chop some wood?" or "stay here and keep watch", and offer her a fair share if you want a yes. The "To:" row at the top of the chat lets you speak to any villager within earshot the same way; tap someone in the world to pick them. Small tags under her replies show what she remembered while she answered.',
  },
  {
    id: 'asking',
    title: 'Asking her for help',
    rows: [
      ['Follow', 'Ask her to walk with you.'],
      ['Wait', 'Ask her to wait where she is.'],
      ['Fight', 'Ask her to engage every creature nearby that is not a friend. Once she agrees, she does not ask again for each one.'],
      ['Defend', 'Ask her to fight only what threatens you or her.'],
      ['Hold back', 'Ask her to keep out of fights. She still heals.'],
      ['Jobs', 'Chopping, gathering, fishing, mining, foraging, cooking or collecting loot, delivered to you or the cottage chest.'],
    ],
  },
  {
    id: 'village',
    title: 'The village',
    text:
      'Of the hundred and fifty people in Hearthvale, eighteen are yours to know, and they live their own lives: they work, eat at the Kettle, talk to each other, gossip, and remember what you do. Walk up to anyone to talk; when two of them are talking nearby, you can listen in. In the morning, "While you slept" tells you what went on in the village overnight. Villagers with a gold ! over their heads have work for you; the Missions journal keeps track of it.',
  },
  {
    id: 'mind',
    title: 'Her mind',
    text:
      "Lyra's Mind shows her mood and plans, how she sees you and what she has seen you do, the people she knows, her memories, what she knows of the world, her life before you met, her diary, her goals and her soul. You can export her whole mind as a file and bring it back later.",
  },
  {
    id: 'falling',
    title: 'Falling, and death',
    text:
      'At no health you fall and lie bleeding. Call for help: Lyra and anyone in earshot may come, help you up or carry you to Mira in time. If nobody does, you die, and unless Sister Aveline keeps a flame for you at the chapel, your story ends for good: the save moves to Past lives. You can carry the fallen too. Settings → Game can soften death to waking at home.',
  },
  {
    id: 'days',
    title: 'Days and nights',
    text:
      'A day lasts about fifteen minutes. Wolves grow bolder at night and moonpetals only open after dark. Sleep in your bed after 6 PM to skip to morning; Lyra writes in her diary while you rest, and the game saves. She sleeps in the spare bed only while she trusts you; otherwise she keeps her old room at the Ember Kettle.',
  },
  {
    id: 'saving',
    title: 'Saving',
    text:
      'The game saves on its own every minute, when you sleep and when missions move forward; Menu → Save saves right away. When played on claude.ai it can also keep a copy in your account, so your journey follows you between devices.',
  },
];

export const TITLE_TAGLINES = [
  'A tale of Hearthvale, and of a friend who walks beside you by choice.',
  'Some lights are carried. Some walk beside you.',
  'The ruins are quiet. Lyra is not.',
];

// Lines for the reset confirmation and data tab, kept here with the rest of the voice.
export const RESET_WARNING =
  'She will forget everything: every memory, every person, every diary page, and how she feels about you. This cannot be undone. Export her mind first if you might want her back.';
