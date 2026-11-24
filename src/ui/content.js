// Written content for the interface: requests, jobs, Lyra's answers, quick
// replies, the How to play page. Pure data + small pure pickers (unit-tested).

// The "Ask Lyra" bar. Every button is a request she weighs (DESIGN.md §16.4): it runs
// game.actions.run(action, args, 'player') and she answers. `key` is the hotkey digit.
export const COMMANDS = [
  { id: 'follow', label: 'Follow', icon: 'boots', key: '1', action: 'follow', args: { target: 'player' }, hint: 'Ask her to walk with you' },
  { id: 'stay', label: 'Wait', icon: 'flag', key: '2', action: 'stay', args: {}, hint: 'Ask her to wait here' },
  { id: 'attack', label: 'Fight', icon: 'sword', key: '3', action: 'set_combat_mode', args: { value: 'attack' }, hint: 'Ask her to fight anything that is not a friend' },
  { id: 'defend', label: 'Defend', icon: 'shield', key: '4', action: 'set_combat_mode', args: { value: 'defend' }, hint: 'Ask her to fight only what threatens you both' },
  { id: 'passive', label: 'Hold back', icon: 'feather', key: '5', action: 'set_combat_mode', args: { value: 'passive' }, hint: 'Ask her to stay out of fights' },
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

export const HOW_TO_PLAY = [
  {
    title: 'Getting around',
    rows: [
      ['Move', 'WASD or arrow keys · left stick · touch the left half of the screen'],
      ['Attack', 'J or Space · A button · the sword button'],
      ['Dodge roll', 'K or Shift · B button · the swirl button (a moment of safety)'],
      ['Interact', 'E · X button · the hand button: talk to villagers, open doors and chests, read signs'],
      ['Listen in', 'L · tap "Listen in" when two villagers are talking nearby'],
      ['Pause', 'Esc · Start button · the pause icon'],
    ],
  },
  {
    title: 'Lyra lives for herself',
    text:
      'Lyra and Hess carried you down off the Hollowcrown; you slept eighty-one days. When you woke, Lyra took the hearthwatch for reasons of her own: the stipend, a second blade for the ruins, and whatever ties you to Maren, the teacher who walked into the Sunken Ruins and never came back. She travels with you because she chooses to, while it is good for her. She weighs everything you ask, and she watches what you do. Treat her well and she will trust you. Hurt her, frighten her or harm the people she loves, and she will stop you, run to her people or shout for help. Hearthvale is her home: she never leaves it, and the village stands with her.',
  },
  {
    title: 'The village',
    text:
      'Eighteen people live in Hearthvale, and they live their own lives: they work, eat at the Kettle, talk to each other, gossip, and remember what you do. Walk up to anyone and press E (or tap the hand) to talk; type anything into "Say something…" and they answer in their own way. When two of them are talking nearby, press L or tap "Listen in". In the morning, "While you slept" tells you what went on in the village overnight.',
  },
  {
    title: 'Talking with her',
    text:
      'Press T or Enter (Y on a gamepad) to talk. Say anything: ask how she feels, what she thinks of someone, what she remembers. Ask for help in plain words, like "would you chop some wood?" or "stay here and keep watch". Offer her a fair share if you want a yes. Under her replies, small tags show what she remembered while she answered; tap one to see it.',
  },
  {
    title: 'Asking her for help',
    rows: [
      ['1 Follow', 'Ask her to walk with you.'],
      ['2 Wait', 'Ask her to wait where she is.'],
      ['3 Fight', 'Ask her to engage every creature nearby that is not a friend. Once she agrees, she does not ask again for each one.'],
      ['4 Defend', 'Ask her to fight only what threatens you or her.'],
      ['5 Hold back', 'Ask her to keep out of fights. She still heals.'],
      ['Jobs', 'Chopping, gathering, fishing, mining, foraging, cooking or collecting loot, delivered to you or the cottage chest.'],
    ],
  },
  {
    title: 'Her mind',
    text:
      'Tab or M opens Lyra\'s Mind: her mood and plans, how she sees you and what she has seen you do, the people she knows, her memories, what she knows of the world, her life before you met, her diary, her goals and her soul. You can export her whole mind as a file and bring it back later.',
  },
  {
    title: 'Days and nights',
    text:
      'A day lasts about fifteen minutes. Wolves grow bolder at night and moonpetals only open after dark. Sleep in your bed after 6 PM to skip to morning; Lyra writes in her diary while you rest, and the game saves. She sleeps in the spare bed only while she trusts you; otherwise she keeps her old room at the Ember Kettle.',
  },
  {
    title: 'Saving',
    text:
      'The game saves on its own every minute, when you sleep and when quests move forward. When played on claude.ai it can also keep a copy in your account, so your journey follows you between devices.',
  },
];

export const TITLE_TAGLINES = [
  'A tale of Hearthvale, and of a friend who walks beside you by choice.',
  'Some lights are carried. Some walk beside you.',
  'The ruins are quiet. Lyra is not.',
];

export const CONTROLS_SUMMARY = [
  ['WASD / Arrows', 'Move'],
  ['J / Space', 'Attack'],
  ['K / Shift', 'Dodge'],
  ['E', 'Interact / talk to villagers'],
  ['L', 'Listen in'],
  ['T / Enter', 'Talk to Lyra'],
  ['Tab / M', "Lyra's mind"],
  ['I', 'Inventory'],
  ['1 – 5', 'Ask Lyra'],
  ['Esc', 'Pause / close'],
];

// Lines for the reset confirmation and data tab, kept here with the rest of the voice.
export const RESET_WARNING =
  'She will forget everything: every memory, every person, every diary page, and how she feels about you. This cannot be undone. Export her mind first if you might want her back.';
