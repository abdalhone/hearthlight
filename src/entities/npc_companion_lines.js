// What a villager says when the stranger asks them along, and while they walk with them
// (round 14b, DESIGN §34.2). The GAME decides (npc_companion.js weighJoin and the duty);
// these only word it. Every line is in the villager's own voice where one is written here,
// else a plain line any adult of Hearthvale could say. `{P}` is what they call the player.
//
// Kinds:
//   accept, conditional, refuse_<why>      the answer to "Will you travel with me?"
//   leave_<why>                            walking off on their own (bedtime, hurt, fear …)
//   ok_<cmd>, no_<cmd>                     an order from the Ask bar (follow, stay, fight …)
//   dismissed                              "Go home, thank you"
//   lyra_back                              Lyra, coming back while someone else walks with you
//
// Nothing here threatens the player (CLAUDE.md: Lyra, and everyone, lives for themselves).

const GENERIC = {
  accept: ['All right. I will walk with you a while.', 'Why not. Lead the way.', 'I could use the air. I will come.'],
  conditional: ['For a while, then. I am home by dark.', 'I will come, but I keep my own counsel, and I go home at nightfall.', 'Some of the way. Not into anything foolish.'],
  refuse_child: [],
  refuse_opinion: ['I hardly know you. No.', 'Not with you. Not yet.', 'I would rather not.'],
  refuse_grievance: ['After what you did? No.', 'Not today. Not after that.', 'You know why not.'],
  refuse_fear: ['No. Please, no.', 'I cannot. I will not.', 'Stay away from me.'],
  refuse_wanted: ['The watch is looking for you. I am not walking beside that.', 'Not while you have blood on your name.'],
  refuse_night: ['At this hour? I am for my bed.', 'It is late. Ask me in daylight.'],
  refuse_duty: ['I have my post. I cannot leave it.', 'Someone has to keep this place. Not today.'],
  refuse_frail: ['These legs would never keep up with you.', 'I am too old for the road, love.'],
  refuse_hurt: ['Look at me. I can barely stand.', 'Not like this. Let me mend first.'],
  refuse_busy: ['I have work that will not do itself.', 'Not now. Too much to do.'],
  refuse_cannot: [],
  leave_night: ['It is late. I am going home. Thank you for the company.', 'Bed for me. Walk safe.'],
  leave_hurt: ['I am done in. I am going home to mend.', 'That is enough for me. I need a healer.'],
  leave_opinion: ['I have had enough of this. I am going home.', 'I am going back. This is not for me.'],
  leave_grievance: ['No. I am done walking with you.', 'I am going home. Do not follow me.'],
  leave_fear: ['I cannot stay with you after that.', 'No. I am going. I saw what you did.'],
  leave_work: ['I have been away too long. My work is waiting.', 'I have to get back. Thank you for this.'],
  leave_far: ['This is far enough for me. I am turning back.'],
  dismissed: ['All right. Home it is.', 'Back to it, then. Thank you.', 'Fair enough. Walk safe.'],
  replaced: ['Fine. I will head home.', 'Go on, then. I will find my own way back.'],
  ok_follow: ['Lead on.', 'Right behind you.', 'Coming.'],
  ok_stay: ['I will wait here.', 'Here, then. Do not be long.'],
  ok_attack: ['If it comes at us, I hit it.', 'Fine. I will fight.'],
  ok_defend: ['I will cover us both.', 'I will fight what threatens us. Nothing more.'],
  ok_passive: ['Good. I would rather not fight at all.', 'I will keep out of it.'],
  no_attack: ['I am no soldier. I will stand by you if something comes at us, no more.'],
  no_fight: ['I am no fighter. I will keep behind you and out of the way.'],
  no_any: ['No. Not that.'],
  lyra_back: ['You walk with {name} now.'],
};

// A few of the eighteen in their own words (the rest use GENERIC).
const OWN = {
  bram: {
    accept: ['Hmph. Fine. The forge can wait an hour.', 'Hmph. I will walk with you. Keep up.'],
    conditional: ['Till dark. Then the forge. Hmph.'],
    refuse_opinion: ['Hmph. No.', 'I do not walk with strangers.'],
    refuse_busy: ['The iron is hot. Not now.'],
    leave_night: ['Hmph. Late. Forge, then bed.'],
    dismissed: ['Hmph. Back to the anvil.'],
    ok_follow: ['Hmph. Lead on.'],
    ok_attack: ['Good. My hammer is bored.'],
  },
  elda: {
    accept: ['Oh, go on then. The kitchen will survive me for an afternoon.'],
    refuse_duty: ['And leave Pip and the Kettle? Not a chance, love.'],
    leave_night: ['Supper will not cook itself, love. Home I go.'],
  },
  mira: {
    accept: ['All right. Someone should keep you in one piece.'],
    refuse_busy: ['I have salves on the fire. Another time.'],
  },
  rowan: {
    refuse_duty: ['I am the watch. The watch does not wander off.'],
  },
  wys: {
    refuse_duty: ['I... I cannot leave my post. The captain would have my head.'],
    accept: ['Me? Really? All right. I will try not to freeze.'],
  },
  hess: {
    accept: ['I know the woods better than you. I will come.'],
    ok_attack: ['Arrows first. Questions later.'],
  },
  tilly: {
    accept: ['Really? Yes! Let me grab my apron. ...No, leave it. Let us go.'],
  },
};

const LAST = new Map();

function pick(list, rand) {
  if (!list || !list.length) return '';
  let i = Math.floor((rand ?? Math.random()) * list.length) % list.length;
  const key = list[0];
  if (list.length > 1 && LAST.get(key) === i) i = (i + 1) % list.length;
  LAST.set(key, i);
  return list[i];
}

function fill(text, vars = {}) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// A line of `kind` for villager `id`, filled with `vars`. '' when there is none.
export function companionLine(id, kind, vars = {}, rand) {
  const own = OWN[id]?.[kind];
  const list = own?.length ? own : GENERIC[kind];
  return fill(pick(list, rand), vars);
}

export const COMPANION_LINE_KINDS = Object.freeze(Object.keys(GENERIC));
