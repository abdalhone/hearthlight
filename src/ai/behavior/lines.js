import { line, cap, durationWords, qtyPhrase, itemsPhrase, itemWord, numberWord } from './util.js';

// Everything Lyra says from her body-level behavior: acknowledgements, refusals,
// barks, job chatter. Warm, quick, a little teasing; first person, short.
// Each function returns one line, varied so repeats do not sound canned.

export const say = {
  follow(distance = 'normal', who = null) {
    if (who && who !== 'you') return line('follow.other', [`I'll follow ${who}.`, `Keeping pace with ${who}.`, `Right behind ${who}.`]);
    if (distance === 'close') return line('follow.close', ['Sticking close.', 'Right at your elbow.', 'Close as your shadow.']);
    if (distance === 'far') return line('follow.far', ["I'll hang back and watch the edges.", 'Giving you room. I can still see you.', "I'll trail a little behind and keep an eye out."]);
    return line('follow', ['Right behind you.', 'Lead the way.', 'After you, traveler.', "I'm with you."]);
  },
  alreadyFollowing() {
    return line('follow.same', ["Already on your heels.", "I haven't gone anywhere, I promise.", 'Still right here behind you.']);
  },
  stay() {
    return line('stay', ["I'll hold here.", 'Not moving an inch.', "Planted. Don't be long.", "I'll keep this spot warm."]);
  },
  stayAt(place) {
    return line('stay.at', [`I'll head ${place.to} and wait there.`, `${cap(place.name)} it is. I'll hold there.`]);
  },
  wait(seconds) {
    const d = durationWords(seconds);
    return line('wait', [`I'll wait ${d}, then catch up.`, `${cap(d)}. After that I come looking for you.`, `Waiting ${d}. Counting, too.`]);
  },
  waitOver() {
    return line('wait.over', ['Time is up. Coming!', "That's long enough. I'm back.", 'Done waiting.']);
  },
  comeHere() {
    return line('come', ['Coming!', 'On my way.', 'Right there in a heartbeat.']);
  },
  goto(place, then) {
    if (then === 'follow') return line('goto.f', [`I'll swing by ${place.name}, then catch up.`, `Quick trip ${place.to}. Back soon.`]);
    if (then === 'return') return line('goto.r', [`There and back ${place.to}.`, `I'll pop over ${place.to} and come right back.`]);
    return line('goto', [`Heading ${place.to}.`, `Off ${place.to}.`, `${cap(place.name)}? On my way.`]);
  },
  arrived(place) {
    return line('arrived', [`Here ${place.at}.`, 'Made it.', `${cap(place.name)}. Now what?`]);
  },
  unknownPlace(ref) {
    return line('unknown.place', [`Where's "${ref}"? I don't know that place.`, `I'm not sure where "${ref}" is. Point me somewhere I know?`]);
  },
  unreachable(place) {
    return line('unreachable', [`I can't find a way ${place.to} from here.`, `There's no path ${place.to} that I can see.`]);
  },
  locked(door, place = null) {
    const d = door ? doorWord(door) : 'the door';
    if (place) return line('locked.place', [`I can't reach ${place.name} — ${d} is locked.`, `${cap(d)} is locked. No getting ${place.to} without the key.`]);
    return line('locked', [`${cap(d)} is locked.`, `Locked. Whatever key fits ${d}, I don't have it.`]);
  },
  lockedPlayerHasKey(door) {
    return `${cap(doorWord(door))} is locked — but you've got the key. Want to do the honors?`;
  },

  // --- stances ---
  stance(mode) {
    if (mode === 'attack') return line('st.a', ["Attack mode. Anything that isn't a friend is fair game.", "Gloves off. If it isn't a friend, it's a target.", 'Understood. Nothing hostile walks away from us.']);
    if (mode === 'passive') return line('st.p', ["Holding my fire. I'll still patch you up.", "No fighting, then. I'll keep clear and keep you mended.", 'Staff down. Healing only.']);
    if (mode === 'self_defense') return line('st.s', ["Only whoever comes at me. Nobody else.", "I'll defend myself. That's all.", 'I fight back. I don\'t start things.']);
    return line('st.d', ["I've got your back. Anything that comes at you answers to me.", "Defending. I'll keep the nasty things off you.", 'Guarding you. I only bite if they bite first.']);
  },
  stanceSame(mode) {
    if (mode === 'attack') return 'Already in attack mode — and enjoying it a little too much.';
    if (mode === 'passive') return "I'm already holding my fire.";
    if (mode === 'self_defense') return "I'm already minding my own back.";
    return "I'm already watching your back.";
  },
  stanceUnknown() {
    return 'Attack, defend, passive or self-defense — those are my moods in a fight.';
  },

  // --- combat orders ---
  focus(name) {
    return line('focus', [`On it — ${name} is mine!`, `Marking ${name}.`, `${cap(name)}? With pleasure.`]);
  },
  refuseFriend(name) {
    return line('ref.friend', [`Attack ${name}? No. ${cap(name)} is a friend, and I don't turn on friends.`, `I won't hurt ${name}. Not for anything.`, `${cap(name)}? Never. ${cap(name)} is one of ours.`]);
  },
  refusePlayer() {
    return line('ref.player', ['Attack you? Not a chance. Who would I follow around then?', "Hurt you? You're the one person I'd never aim at.", "Nice try. I'm not pointing a bolt at you."]);
  },
  refusePet(name) {
    return line('ref.pet', [`${cap(name)}? Absolutely not. ${cap(name)} is ours to protect.`, `Hurt ${name}? Over my cold, enchanted body.`]);
  },
  refuseInnocent(name) {
    return line('ref.innocent', [
      `${cap(name)} hasn't lifted a finger against me. I won't be the one who starts it.`,
      `No. Whatever ${name} did to you, I don't hurt people who haven't hurt me.`,
      `I'm not turning my magic on ${name}. Not unless ${name} comes at me first.`,
    ]);
  },
  refuseSelf() {
    return "Attack myself? I'd rather not. I've grown attached.";
  },
  noSuchTarget(ref) {
    return line('no.target', [`I don't see ${ref} anywhere near.`, `${cap(ref)}? Where? I can't spot it.`]);
  },
  nothingToFight() {
    return line('no.fight', ["There's nothing here to fight. Not that I can see.", 'All quiet. Nothing to aim at.']);
  },
  tooFar(name) {
    return `${cap(name)} is too far off for me to reach.`;
  },
  retreat() {
    return line('retreat', ['Falling back to you!', 'Pulling back!', 'Coming to you — cover me!']);
  },

  // --- area orders ---
  guardPlace(place) {
    return line('guard.p', [`I'll keep watch over ${place.name}.`, `Nothing gets past me ${place.at}.`]);
  },
  guardYou() {
    return line('guard.you', ["I'll stay at your side and keep you safe.", 'Guarding you. Anything that wants you goes through me first.']);
  },
  guardPerson(name) {
    return line('guard.who', [`I'll watch over ${name}.`, `${cap(name)} is under my protection now.`]);
  },
  guardHere() {
    return line('guard.here', ["I'll guard this spot.", 'Standing watch right here.']);
  },
  patrol(place) {
    return line('patrol', [`I'll walk the rounds of ${place.name}.`, `Patrolling ${place.name}. I'll shout if anything stirs.`]);
  },
  explore(place) {
    return line('explore', [`Let's see what ${place.name} is hiding.`, `Exploring ${place.name}. I'll be careful — mostly.`, `Scouting ${place.name}. Back with stories.`]);
  },
  exploreDone(place, found) {
    if (found) return line('explore.done.f', [`${cap(place.name)} is mapped in my head now. ${found}`, `Done scouting ${place.name}. ${found}`]);
    return line('explore.done', [`${cap(place.name)} is quiet. Nothing worth reporting.`, `I've seen ${place.name} end to end. Peaceful, for now.`]);
  },
  free() {
    return line('free', ["Free time? Don't mind if I do. I won't stray far.", "My own whims, then. I'll be close if you need me.", "I'll potter about. Whistle if you want me."]);
  },

  // --- emotes and small things ---
  emoteUnknown(name) {
    return `"${name}"? I don't think my body bends that way.`;
  },
  sit(fire) {
    if (fire) return line('sit.fire', ["I'll sit by the fire a while.", 'Ooh, warmth. Sitting.']);
    return line('sit', ['Sitting.', 'Gladly. My feet thank you.', "I'll take a seat."]);
  },
  sleepNotTired() {
    return line('sleep.no', ["Sleep now? The sun's still up!", "I'm wide awake. Ask me again after dark."]);
  },
  sleepNoBed() {
    return "I can't find my bed from here. I'll keep going a while longer.";
  },
  goingToBed() {
    return line('sleep', ['Off to bed. Wake me if anything growls.', 'Goodnight. Try not to miss me.', "I'm turning in. Don't wander off without me."]);
  },

  // --- items ---
  noItem(id) {
    return line('no.item', [`I don't have any ${itemWord(id, 2)} on me.`, `No ${itemWord(id, 2)}, sorry. My pack's not that deep.`]);
  },
  givePartial(id, have, want) {
    return `I only have ${qtyPhrase(id, have)}, not ${numberWord(want)}. Here's what I've got.`;
  },
  giveOk(id, qty, who) {
    if (who === 'you') return line('give.you', [`Here — ${qtyPhrase(id, qty)}.`, `${cap(qtyPhrase(id, qty))}, as asked.`, `Catch! ${cap(qtyPhrase(id, qty))}.`]);
    return line('give.who', [`I'll give ${who} ${qtyPhrase(id, qty)}.`, `${cap(qtyPhrase(id, qty))} for ${who}, coming up.`]);
  },
  giveComing(who) {
    return who === 'you' ? 'Coming over with it.' : `I'll bring it over to ${who}.`;
  },
  giveWhat() {
    return 'Give you what? Name it and it is yours, if I have it.';
  },
  giveNothing() {
    return "My pack's empty. Nothing to give but my charm.";
  },
  nothingToEat() {
    return line('no.food', ["I've nothing to eat. Not even a crumb. Got any berries?", 'My food bag is empty. Bread would be lovely.']);
  },
  notFood(id) {
    return `Eat ${qtyPhrase(id, 1)}? I could try, but Bram would never let me live it down.`;
  },
  ate(id) {
    if (id === 'honey_cake') return "Honey cake. Oh, that's the good stuff.";
    if (id === 'potion') return 'Potion down. Bitter, but it works.';
    return line('ate', [`Mm. ${cap(qtyPhrase(id, 1))} — just what I needed.`, `Thanks, ${itemWord(id, 1)}. Much better.`]);
  },
  nothingToPickUp(id) {
    if (id) return `I don't see any ${itemWord(id, 2)} lying around.`;
    return line('no.pickup', ["I don't see anything to pick up around here.", 'Nothing on the ground worth having.']);
  },
  pickingUp() {
    return line('pickup', ["I'll grab it.", 'Got it — one moment.', 'Mine now. I mean ours.']);
  },

  // --- doors and objects ---
  noDoor() {
    return "I don't see a door nearby.";
  },
  doorAlready(open) {
    return open ? "It's already open." : "It's already shut.";
  },
  doorWill(open) {
    return open ? line('door.o', ["I'll get the door.", 'Door coming right up.']) : line('door.c', ["I'll shut it.", 'Closing it behind us.']);
  },
  cantFind(ref) {
    return `I can't find ${ref ? `"${ref}"` : 'that'} nearby.`;
  },
  interactAck(name) {
    return line('interact', [`I'll see to ${name}.`, `Heading over to ${name}.`]);
  },
  homeBed() {
    return "That's your bed. I'm not about to steal it.";
  },
  chestDeposit(phrase) {
    return `Stashed ${phrase} in the chest.`;
  },
  chestPeek(contents) {
    return contents === 'nothing' ? 'The chest is empty. Echoey, even.' : `Inside: ${contents}.`;
  },
  readSign(text) {
    return `It says: "${text}"`;
  },
  wellLine() {
    return line('well', ['Cold, sweet water. Lovely.', 'I can see my reflection. Still got it.']);
  },
  altarLine() {
    return line('altar', ['A quiet word for Maren. Wherever she is.', 'Hearth keep us warm and our friends close.']);
  },
  lookAt(name) {
    return line('look', [`${cap(name)}. Hm.`, `Nice ${name.replace(/^the /, '')}.`, `I've seen worse ${name.replace(/^the /, '')}s.`]);
  },
  greet(name) {
    return line('greet', [`Hello, ${name}!`, `Good to see you, ${name}.`, `${cap(name)}! How are you keeping?`]);
  },

  // --- jobs ---
  jobStart(job, amount, deliverTo) {
    const what = job.noun ? amountNoun(job, amount) : null;
    const where = deliverTo === 'chest' ? ' for the chest at home' : '';
    switch (job.id) {
      case 'chop_wood':
        return line('j.chop', [`${cap(what)}, coming up${where}.`, `I'll find a good tree. ${cap(what)}${where}.`, `Chopping ${what}. Stand back from the falling bits.`]);
      case 'gather_herbs':
        return line('j.herb', [`Herb-picking! ${cap(what)}${where}.`, `I'll gather ${what}. My favorite kind of errand.`]);
      case 'forage':
        return line('j.forage', [`Foraging it is. I'll find us something good.`, `I'll see what the hedges are hiding.`]);
      case 'mine_ore':
        return line('j.mine', [`Mining. ${cap(what)}${where}.`, `I'll crack some rocks. ${cap(what)}, give or take.`]);
      case 'fish':
        return line('j.fish', [`Fishing! I'll stay on the dry side of the water, thank you.`, `${cap(what)}. Not too close to the edge, though.`]);
      case 'farm':
        return line('j.farm', ["I'll help bring in Tobias's harvest.", "Harvest time. Tobias will be thrilled."]);
      case 'cook':
        return line('j.cook', ["Something warm, coming up. I'll find a fire.", "Cooking! Prepare to be impressed. Or fed, at least."]);
      case 'collect_loot':
        return line('j.loot', ["I'll gather up whatever's lying around.", 'Collecting the spoils.']);
      default:
        return 'On it.';
    }
  },
  jobBusy(label) {
    return `I'm already ${label}. Want me to switch?`;
  },
  jobUnknown(ref) {
    return `"${ref}"? I can chop wood, gather herbs, forage, mine, fish, farm, cook or collect loot.`;
  },
  jobStopped(label) {
    return line('j.stop', [`Stopping. I'll put the ${label.replace(/^(\w+ing )/, '')} down.`, 'Alright, done for now.', 'Tools down.']);
  },
  noJob() {
    return "I'm not working on anything right now.";
  },
  noTargets(job) {
    switch (job.id) {
      case 'chop_wood':
        return "I can't find a tree I can reach from here. Whisperwood is thick with them.";
      case 'gather_herbs':
        return "No herbs I can reach nearby. Whisperwood's the place for them.";
      case 'forage':
        return 'Nothing to forage around here. The forest edge would be better.';
      case 'mine_ore':
        return "There's no ore or stone I can reach. Stonecut Quarry, northwest, is the place.";
      case 'fish':
        return "I can't find a safe bit of shore to fish from. Mirror Lake has a dock.";
      case 'farm':
        return "None of Tobias's crops are ripe yet. Give them a day.";
      case 'collect_loot':
        return "There's nothing lying around to collect.";
      default:
        return "I can't find anything to work on from here.";
    }
  },
  noFire() {
    return "There's no fire close enough to cook on. The Ember Kettle's hearth would do, or a campfire.";
  },
  noIngredients(what) {
    if (what) return `I don't have any ${what} to cook. Bring me some and I'll make it sing.`;
    return "I've nothing to cook. Bring me fish, turnips or wheat and I'll make something good.";
  },
  jobDelivered(items, to) {
    const phrase = itemsPhrase(items);
    if (to === 'chest') return line('j.chest', [`Stored ${phrase} in the chest at home.`, `${cap(phrase)}, tucked away in the chest.`]);
    return line('j.deliver', [`Here — ${phrase}, fresh from the job!`, `${cap(phrase)} for you. Told you I'd be quick.`, `All yours: ${phrase}.`]);
  },
  jobDeliveredTo(items, who) {
    const phrase = itemsPhrase(items);
    return line('j.sell', [`Here you are, ${who} — ${phrase}, fresh.`, `${cap(phrase)}, as promised, ${who}.`, `For you, ${who}: ${phrase}. Fair price, mind.`]);
  },
  jobKept(items) {
    return line('j.keep', [`Done! I'll hold on to ${itemsPhrase(items)} for you.`, `Finished. ${cap(itemsPhrase(items))} in my pack.`]);
  },
  jobDoneNothing(job) {
    return `I couldn't get any ${job.noun || 'of it'} this time. Sorry.`;
  },
  jobPartial(job, count, amount) {
    return `I only managed ${numberWord(count)} of ${numberWord(amount)} — there's no more I can reach.`;
  },
  cooked(id) {
    return line('cooked', [`${cap(qtyPhrase(id, 1))}, done to perfection.`, 'Smells wonderful, if I say so myself.']);
  },
  fishCatch() {
    return line('fish.catch', ['Got one!', 'Ha! A fat one.', 'Fish on!']);
  },
  fishMiss() {
    return line('fish.miss', ['Nibble... no.', 'Clever fish.', 'Next time, fishy.']);
  },
  edgeNerves() {
    return line('fish.edge', ['Not too close to the edge...', 'Deep water. Lovely. Totally fine.']);
  },

  // --- combat and support barks ---
  combatStart(name) {
    return line('c.start', ['Stay behind me!', 'Here they come!', `${cap(name)}! I see it.`, 'Steady now.', `Watch out — ${name}!`]);
  },
  healPlayer() {
    return line('c.heal', ["Hold still — I've got you.", 'Mending you!', "Breathe. Here's some light."]);
  },
  healSelf() {
    return line('c.self', ['Patching myself up...', 'Ow. One moment.', 'Just a scratch. Just a big scratch.']);
  },
  drinkPotion() {
    return line('c.potion', ['Drinking — cover me!', 'Potion time!']);
  },
  fallingBack() {
    return line('c.fall', ["I'm hurt — falling back to you!", 'Too hot for me — coming to you!']);
  },
  victory() {
    return line('c.win', ['That settles that.', 'Clear!', "And stay down.", 'All clear. You alright?']);
  },
  downed() {
    return line('downed', ["I'm down... help me up?", "Ugh... can't stand... a hand?"]);
  },
  revived(byPlayer) {
    if (byPlayer) return line('revived', ['You came back for me. Thank you.', 'Up again. I owe you twice now.']);
    return line('revived.self', ['Up again. Ow.', "I'm alright. Mostly."]);
  },
  catPet() {
    return line('cat', ['Hello, little shadow.', 'Who keeps following Pip around? You do.', 'Soft. So soft.']);
  },
  flower() {
    return line('flower', ['For my hair, I think.', 'Pretty one.', 'Maren used to press these in her books.']);
  },

  // --- her own life (DESIGN §16) ---
  ownDay() {
    return line('own.day', ["I've got my own day to see to.", "I'll get on with my day. You know where to find me.", 'My own plans, then. See you around, traveler.']);
  },
  planNext(label, place, together) {
    const where = place ? ` ${place.at}` : '';
    if (together) {
      return line('own.plan.t', [
        `I'm ${label}${label.includes(' at ') || label.includes(' in ') ? '' : where} for a while. Come if you like.`,
        `Time for me to be ${label}. Tag along, or catch me later.`,
        `I'll be ${label}. You're welcome to join me.`,
      ]);
    }
    return line('own.plan', [`I'm off — ${label}.`, `${cap(label)}, if anyone asks.`, `Off I go. ${cap(label)}.`]);
  },
  askAboutMaren(name) {
    return line('own.maren', [
      `${cap(name)}, about Maren — did she say anything, anything at all, before she went?`,
      `Tell me again what Maren carried when you last saw her, ${name}. Every little thing.`,
      `I keep thinking I missed something. Did Maren ever mention the old waygate to you, ${name}?`,
    ]);
  },
  tooRiskyToday(place) {
    return line('own.risky', [`${cap(place.name)}? Not on my own, not today. I'll stay where it's safe.`, `I'm not walking into ${place.name} alone right now. Another time.`]);
  },

  // --- self-preservation ---
  disengage() {
    return line('sp.out', ["I can't — I'm too hurt! I'm getting out!", 'Enough, I have to get clear of this!', "I'm done — falling back before it finishes me!"]);
  },
  disengageOver() {
    return line('sp.over', ["...Alright. I'm alright. Breathing.", 'Safe. For now. Give me a moment.', "That was too close. I'm still here."]);
  },
  coverLoved(name) {
    return line('sp.cover', [`I won't leave ${name} lying there!`, `Get up, ${name} — I've got you covered!`, `Not while ${name} is down. Not a chance.`]);
  },
  riskRefuse(place) {
    return line('sp.risk', [
      `I'm not going into ${place.name} like this. I'll wait outside.`,
      `${cap(place.name)}? Not now — I'll wait out here. Shout if you need me.`,
      `No. ${cap(place.name)} is too much for me right now. I'll keep watch from out here.`,
    ]);
  },
  waitOutside(place, risky) {
    if (risky) return say.riskRefuse(place);
    return line('wait.out', [`I'll wait outside ${place.name}.`, `I'll be right out here, by ${place.name}.`, `Go on in. I'll wait by the door.`]);
  },
  waitOutsideOver() {
    return line('wait.out.over', ['There you are. In one piece, too.', "You're back. Good. Let's go.", 'Finally! I was starting to count the stones.']);
  },
  starving() {
    return line('need.food', ["I need to eat. Now. Everything else can wait.", "I'm starving — I'm stopping to eat.", "My stomach is louder than the wolves. Food first."]);
  },
  starvingNoFood() {
    return line('need.nofood', ["I'm so hungry I can't think, and my pack's empty.", "I need a proper meal. Soon. I mean it."]);
  },
  exhausted() {
    return line('need.rest', ["I have to sit. Just for a minute. My legs are done.", "I'm dead on my feet. Resting — don't argue.", 'Give me a moment. I can barely stand.']);
  },

  // --- flee, leave, keep away ---
  flee(from, place) {
    if (from === 'you') return line('flee.you', ['Stay away from me!', "I'm going. Don't follow me.", 'No — not again. I\'m leaving.']);
    if (place) return line('flee.to', [`Run! I'm making for ${place}!`, `Too many — I'm heading for ${place}!`]);
    return line('flee', ['Run!', "I'm getting out of here!", 'Not this fight — go!']);
  },
  fleeNowhere() {
    return "There's nothing to run from, and nowhere I'd rather be.";
  },
  fleeSafe(fromPlayer, place) {
    if (fromPlayer) return line('flee.safe.you', ['...Safe. Keep your distance from me.', "I'm safe here. Don't come near me right now.", 'Here, then. Leave me be for a while.']);
    if (place) return line('flee.safe.to', [`Made it to ${place.name}. Breathe, Lyra.`, `Safe ${place.at}. That was close.`]);
    return line('flee.safe', ['I think I lost it.', "Clear. My heart's still racing.", 'Safe. For now.']);
  },
  leave(mode) {
    if (mode === 'gone') return line('leave.gone', ["Goodbye. Don't follow me.", "I'm done. I'm leaving Hearthvale. Goodbye.", 'This is where we part. For good.']);
    if (mode === 'left') return line('leave.left', ["I need to be away from you. Don't follow me.", "I'm going my own way. Leave me be.", "I can't travel with you. Not now."]);
    return line('leave.apart', ["I'll go my own way for a while. Find me if you need me.", 'I have my own day to live. See you around.', "Let's split up for now. I'll be about the village."]);
  },
  keepAway(name, tiles) {
    if (name === 'you') return line('keep.you', ["Stay back. I mean it.", "Not so close. Give me room.", "Keep your distance — and I'll keep mine."]);
    return line('keep.other', [`I'll keep clear of ${name}.`, `Staying well away from ${name}.`]);
  },

  // --- Binding Light and warnings ---
  bind(name) {
    if (name === 'you') return line('bind.you', ['Binding Light — hold still!', "Don't move. I mean it.", 'Stay right there!']);
    return line('bind', [`Binding Light! ${cap(name)} isn't going anywhere.`, `Hold, ${name}!`, `Rooted! Hit ${name} while it's stuck!`]);
  },
  bindCooldown(seconds) {
    return `Binding Light isn't ready — ${Math.max(1, Math.ceil(seconds))} more seconds.`;
  },
  bindRefuse(name) {
    return line('bind.no', [`Bind ${name}? ${cap(name)} has done nothing to deserve it.`, `I won't use my magic on ${name}. Not without a reason.`]);
  },
  bindTooFar(name) {
    return `${cap(name)} is too far for Binding Light. I need to be closer.`;
  },
  noBindTarget() {
    return "There's nobody here I need to bind.";
  },
  warnPlayer() {
    return line('warn.you', ['Stop! What are you doing?!', "Don't. Don't you dare.", "Put the sword down. Now.", 'Enough! Back off!']);
  },
  warnOther(name) {
    return line('warn.other', [`Back off, ${name}! I'm warning you.`, `${cap(name)} — one more step and you'll regret it.`, `Stay away, ${name}!`]);
  },
  selfDefense() {
    return line('sd', ["You want a fight? Fine!", "Hit me again and see what happens!", "That's it — I'm defending myself!"]);
  },
  selfDefenseOver() {
    return line('sd.over', ["...Done. Don't make me do that again.", "Enough. I'm done fighting you."]);
  },
};

function doorWord(door) {
  const n = String(door?.name || '').trim();
  if (!n || /^door$/i.test(n) || n === door?.objType) return 'the door';
  return `the ${n.replace(/^the\s+/i, '').toLowerCase()}`;
}

function amountNoun(job, amount) {
  const unit = job.unit || [job.noun, job.noun];
  if (!amount || !Number.isFinite(amount)) return `some ${unit[1]}`;
  return `${numberWord(amount)} ${amount === 1 ? unit[0] : unit[1]}`;
}
