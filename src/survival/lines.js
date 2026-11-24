// What people say when someone falls (DESIGN §27). Lyra's words depend on everything
// between her and the stranger (LORE §7: she never leaves a living person to die when she
// could carry them; how she speaks to them while she does it is her own business).
// Villagers speak in their LORE §6 voices. {P} is how the speaker names the player.

const PLAYER_ID = 'player';

// How Lyra sounds right now: 'warm' | 'steady' | 'guarded' | 'cold'.
export function lyraTone(lyra) {
  const mind = lyra?.mind;
  let state = 'together';
  try {
    state = mind?.companionship ?? mind?.autonomy?.companionship ?? 'together';
  } catch {
    state = 'together';
  }
  if (state === 'left' || state === 'gone') return 'cold';
  let rel = null;
  try {
    rel = mind?.relationships?.get?.(PLAYER_ID) || null;
  } catch {
    rel = null;
  }
  const trust = num(rel?.trust, 50);
  const aff = num(rel?.affinity, 20);
  const fear = num(rel?.fear, 0);
  if (state === 'wary' || state === 'apart' || fear > 35 || trust < 25) return 'guarded';
  if (aff >= 40 && trust >= 50) return 'warm';
  return 'steady';
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export const LYRA_LINES = {
  warm: {
    see: ['No. No, no, no. {P}! I’m coming!', '{P}! Stay down, I’m coming!', 'Don’t you dare. I’m coming!'],
    arrive: ['Look at me. Look at me. You’re not doing this today.', 'Hey. Hey. I’m here. I’ve got you.', 'Eyes open. Stay with me.'],
    warmth: ['Hold still. This will be cold for me and warm for you.', 'Take it. Take the warmth, I’ve got plenty.'],
    warmthDone: ['There. Breathe. Slowly.', 'Up. Slowly. You’re all right.'],
    lift: ['Up you come. Don’t you dare die on my back.', 'Arm round my neck. That’s it.', 'I carried you down a mountain once. This is nothing.'],
    carry: ['Mira’s is close. Keep breathing. That’s all you have to do.', 'Talk to me. Tell me something stupid.', 'You’re heavier than you look, you know.', 'Stay with me. Stay with me.', 'Nearly there. Nearly. Breathe.', 'If you die on me I will never forgive you.'],
    escort: ['Careful with them! Careful!', 'I’m right here. Right here.', 'Keep breathing. Keep breathing.'],
    lay: ['Mira! Mira, the green book!', 'Here. Here. Lie still. You made it.'],
    fight: ['Get away from them!', 'Not them. Not today!'],
  },
  steady: {
    see: ['{P}! Hold on!', 'Down? Stay there, I’m coming!', 'Hang on! I’m on my way!'],
    arrive: ['I’m here. Don’t move.', 'Easy. Let me look.', 'You’re all right. You’re all right.'],
    warmth: ['Hold still. I can spare a little warmth.', 'This will sting, then it won’t.'],
    warmthDone: ['There. Up, slowly.', 'That’ll hold you. Up.'],
    lift: ['Up you come. On my shoulders.', 'Hold on to me. Here we go.'],
    carry: ['Mira will know what to do. Hold on.', 'Keep breathing. We’re close.', 'Don’t sleep. Talk to me.', 'Nearly there.'],
    escort: ['Mind their head!', 'I’m right beside you.'],
    lay: ['Mira! Someone’s hurt!', 'Here. Lie still.'],
    fight: ['Back off!', 'Leave them alone!'],
  },
  guarded: {
    see: ['{P}? Stay down. I’m coming.', 'Don’t move. I’m coming.'],
    arrive: ['Don’t move. I’ve got you.', 'Breathe. That’s it.', 'We’re not done talking, you and me. So don’t die.'],
    warmth: ['Hold still. Just this once.'],
    warmthDone: ['There. You’re up. Go carefully.'],
    lift: ['Up. Don’t make this harder.', 'On my shoulders. Quiet now.'],
    carry: ['Breathe. Just breathe.', 'Mira’s. Then we’ll see.', 'Don’t talk. Save it.'],
    escort: ['Careful with them.'],
    lay: ['Mira. They need you.'],
    fight: ['Back off!'],
  },
  cold: {
    see: ['…Of course it’s you.', 'Stay there.'],
    arrive: ['Don’t talk. I’m not doing this for you.', 'Don’t look at me like that.'],
    warmth: ['Hold still.'],
    warmthDone: ['Get up. Go.'],
    lift: ['I don’t leave people to die. That’s all this is.', 'Up. Don’t read anything into it.'],
    carry: ['Quiet.', 'Don’t read anything into this.', 'Mira’s. Then we’re done.', 'Breathe. I said breathe.'],
    escort: ['Careful.'],
    lay: ['Mira. Patch them up. Don’t tell them I stayed.', 'Here. Mira’s now.'],
    fight: ['Back off.'],
  },
};

// Lyra herself, when the player carries or revives her.
export const LYRA_CARRIED = {
  warm: ['…you came back for me.', 'You’re carrying me? You’re ridiculous. Thank you.', 'Don’t drop me. Please.'],
  steady: ['…you came back.', 'Mira’s. Please.', 'Thank you. Don’t drop me.'],
  guarded: ['…you came back for me?', 'Put me— no. Don’t. Thank you.'],
  cold: ['…Put me— no. Don’t.', 'Why are you doing this.'],
};

export const LYRA_POTION = {
  warm: ['Oh, that’s horrible. Thank you.', 'You’re wasting a good potion on me. Thank you.'],
  steady: ['Thanks. That tastes awful.', 'I owe you one.'],
  guarded: ['…Thank you.', 'I didn’t think you’d stop.'],
  cold: ['…Thank you.', 'I won’t forget it. That’s all.'],
};

// Villagers coming for someone who fell, in their own voices (LORE §6).
export const VILLAGER_LINES = {
  rowan: { see: ['Stay down! Watch, to me!', 'Man down! Hold on!'], lift: ['I’ve got you. On my shoulder — up.'], carry: ['Hold on. Mira’s is two streets.', 'Stay awake. That’s an order.'], arrest: ['You’re coming with me. Alive, if I can manage it.'] },
  wys: { see: ['Hang on, hang on!', 'Captain! Over here!'], lift: ['Oof — right. Up.'], carry: ['Nearly there, nearly there.', 'Don’t die on my watch, please.'], arrest: ['Cell first. Then Mira. Rules.'] },
  hess: { see: ['Don’t you die out here.', 'Down! I see you!'], lift: ['Like the mountain, then.'], carry: ['You owe me twice now.', 'Breathe. Count with me.'] },
  bram: { see: ['Easy! I’m coming!'], lift: ['Up. I’ve lifted worse at the forge.'], carry: ['Easy, now. Easy.', 'Mira’ll set you right.'] },
  tilly: { see: ['Oh no — hold on!'], lift: ['I’ve got you! I — I’ve got you.'], carry: ['You’re heavier than an anvil. Hold on.'] },
  tobias: { see: ['Oh dear, oh dear — I’m coming!'], lift: ['Up we get. Oh, dear.'], carry: ['Nearly at Mira’s. Nearly.'] },
  garrick: { see: ['Easy, friend! Help’s coming!'], lift: ['No charge for this one. Up!'], carry: ['Best delivery I ever made, this.'] },
  sabeth: { see: ['Stay there! I’m coming!'], lift: ['Lean on me. All your weight. Go on.'], carry: ['Mira’s. Keep your eyes open.'] },
  mira: { see: ['Oh — oh no. I’m coming!'], arrive: ['Let me — let me see. Sorry. Hold still.'], revive: ['There. Breathe. That’s silverleaf; it stings.', 'Sorry — this will sting. There.'] },
  elda: { see: ['Oh, my dear! Someone fetch Mira!'], tend: ['Press here, love. Hold it. Help’s coming.', 'Stay with me, sweetheart.'] },
  aveline: { see: ['Child! Be still.'], tend: ['Be still, child. Breathe with me.', 'A candle does not ask the dark for permission. Breathe.'] },
  hobb: { see: ['Here! Someone’s down!'], tend: ['Steady, lad. Steady. I’ve called for help.'] },
  wenna: { see: ['Who’s that? Who’s down?'], tend: ['Give me your hand, love. There.'] },
  petra: { see: ['Well, don’t just stand there! Someone’s down!'], tend: ['I’ve caught babies with more fuss than this. Breathe.'] },
  corran: { see: ['Ho! Someone’s down!'], tend: ['Easy now. The lake’s seen worse.'] },
  alder: { see: ['Good heavens — help! Help here!'], tend: ['Hold on. The watch is coming. Hold on.'] },
  pip: { see: ['I’ll get help! I’ll get Rowan!'], fetch: ['Quick! Quick, somebody’s hurt!'] },
  tansy: { see: ['I’ll fetch the watch!'], fetch: ['Someone’s down! Come quick!'] },
};

export const TENDER_SHOUTS = ['Help! Someone help!', 'Over here! Someone’s down!', 'We need a pair of arms here!'];

// The player's own shout.
export const CALL_LINES = ['Help!', 'Help… someone…', 'Help me!', 'Anyone…!'];

// When the player wakes in the sickroom: Mira's first words.
export const MIRA_WAKE = [
  'You’re awake. Good. Sorry — good. Don’t get up too fast.',
  'Oh! You’re awake. Lie still a moment. You lost a lot of blood.',
  'There you are. Slowly. The stitches will pull for a day.',
];

// Lyra at the bedside when she carried the player in.
export const LYRA_BEDSIDE = {
  warm: ['You scared me. Don’t do that again.', 'Morning. You look terrible. I’m so glad.'],
  steady: ['You’re awake. Good.', 'Took you long enough.'],
  guarded: ['You’re awake. Good. Mira says you’ll mend.'],
  cold: [],
};

// A villager the player carried to safety, when they come round.
export const SAVED_BY_PLAYER = ['You carried me. I won’t forget it.', 'They tell me you carried me here. Thank you.', 'I owe you my life, I think. Thank you.'];

export function pickLine(list, rng) {
  if (!Array.isArray(list) || !list.length) return '';
  const r = typeof rng?.next === 'function' ? rng.next() : typeof rng?.random === 'function' ? rng.random() : Math.random();
  return list[Math.floor(r * list.length) % list.length];
}

export function fillName(text, name) {
  return String(text || '').replace(/\{P\}/g, name || 'you');
}
