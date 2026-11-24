// Written content for the interface: orders, jobs, Lyra's acknowledgements, quick
// replies, the How to play page. Pure data + small pure pickers (unit-tested).

// The command bar. `key` is the hotkey digit; `run` is the action call.
export const COMMANDS = [
  { id: 'follow', label: 'Follow', icon: 'boots', key: '1', action: 'follow', args: { target: 'player' }, hint: 'Lyra follows you' },
  { id: 'stay', label: 'Stay', icon: 'flag', key: '2', action: 'stay', args: {}, hint: 'Lyra holds this spot' },
  { id: 'attack', label: 'Attack', icon: 'sword', key: '3', action: 'set_combat_mode', args: { value: 'attack' }, hint: 'Attack mode: she engages anything that is not a friend' },
  { id: 'defend', label: 'Defend', icon: 'shield', key: '4', action: 'set_combat_mode', args: { value: 'defend' }, hint: 'Defend: she fights what threatens you or her' },
  { id: 'passive', label: 'Passive', icon: 'feather', key: '5', action: 'set_combat_mode', args: { value: 'passive' }, hint: 'Passive: she avoids fights but still heals' },
];

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

// Quick replies under the chat field.
export const CHIPS = ['Follow me', 'Attack mode', 'How are you?', "What's next?", 'Stay here', 'Tell me about Maren'];

// What she says when an order from the command bar succeeds and the action itself
// returned no words. Several per order so she never sounds like a machine.
export const ACK_LINES = {
  follow: ['Right behind you.', "Lead on. I've got your back.", 'Coming! Try not to walk into anything.', 'After you, partner.'],
  stay: ["I'll hold here.", "Fine, I'll keep this spot warm.", 'Staying put. Call if you need me.', "Here I'll stay. Don't be long."],
  attack: ['Attack mode. Anything unfriendly is fair game.', 'Gloves off. Let them come.', "Bolts ready. If it isn't a friend, it's a target."],
  defend: ["I'll guard you. Anything that comes at us answers to me.", 'Defensive. I fight only what threatens us.', 'Covering you.'],
  passive: ["No fighting. I'll keep my distance and my healing ready.", 'Hands off the bolts. Understood.', "Peaceful it is. I'll still patch you up."],
  job: ['On it.', 'Leave it to me.', 'Consider it done. Eventually.', 'A bit of honest work. I can do that.'],
  stop_job: ['Putting it down.', 'Done for now.', 'Fine by me. My arms needed a rest.'],
};

const lastAck = new Map();
// Pick a line for an order, never the same one twice in a row. `rand` is 0..1.
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
      ['Interact', 'E · X button · the hand button: talk, open doors and chests, read signs'],
      ['Pause', 'Esc · Start button · the pause icon'],
    ],
  },
  {
    title: 'Talking with Lyra',
    text:
      'Press T or Enter (Y on a gamepad) to talk. Say anything: ask how she feels, what she thinks of someone, or give orders in plain words like "follow me", "chop five wood" or "stay here and guard the door". She has her own mind, so she may tease you, refuse what goes against her values, or bring up something she remembers.',
  },
  {
    title: 'Orders',
    rows: [
      ['1 Follow', 'She walks with you.'],
      ['2 Stay', 'She holds her position.'],
      ['3 Attack mode', 'She engages every creature that is not a friend nearby, without asking.'],
      ['4 Defend', 'She fights only what threatens you or her.'],
      ['5 Passive', 'She keeps out of fights but still heals you.'],
      ['Jobs', 'Chop wood, gather herbs, fish, mine, forage, cook or collect loot, delivered to you or the cottage chest.'],
    ],
  },
  {
    title: 'Her mind',
    text:
      'Tab or M opens Lyra\'s Mind: her mood and needs, the people she knows and what she thinks of them, her memories, her diary, her goals and her soul. Mark someone as a friend or an enemy there and her attack mode respects it. You can export her whole mind as a file and bring it back later.',
  },
  {
    title: 'Days and nights',
    text:
      'A day lasts about fifteen minutes. Wolves grow bolder at night and moonpetals only open after dark. Sleep in your cottage bed after 6 PM to skip to morning; Lyra writes in her diary while you rest, and the game saves.',
  },
  {
    title: 'Saving',
    text:
      'The game saves on its own every minute, when you sleep and when quests move forward. When played on claude.ai it can also keep a copy in your account, so your journey follows you between devices.',
  },
];

export const TITLE_TAGLINES = [
  'A tale of Hearthvale, and of the friend who walks beside you.',
  'Some lights are carried. Some walk beside you.',
  'The ruins are quiet. Lyra is not.',
];

export const CONTROLS_SUMMARY = [
  ['WASD / Arrows', 'Move'],
  ['J / Space', 'Attack'],
  ['K / Shift', 'Dodge'],
  ['E', 'Interact'],
  ['T / Enter', 'Talk to Lyra'],
  ['Tab / M', "Lyra's mind"],
  ['I', 'Inventory'],
  ['1 – 5', 'Orders'],
  ['Esc', 'Pause / close'],
];

// Lines for the reset confirmation and data tab, kept here with the rest of the voice.
export const RESET_WARNING =
  'She will forget everything: every memory, every person, every diary page, and how she feels about you. This cannot be undone. Export her mind first if you might want her back.';
