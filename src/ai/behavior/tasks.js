import { TILE } from '../../core/constants.js';
import { ITEMS } from '../../entities/items.js';
import { say } from './lines.js';
import { need } from './safety.js';
import { rand, dist, tileOf, tileCenter, walkable, standSpotFor, isActorAlive, nameOf, objectName, itemsPhrase, safe } from './util.js';

// Short things Lyra does on top of her standing order: walk to an object and use
// it, hand someone an item, sit, sleep in her bed, play an emote. A task pauses the
// directive and ends on its own (or when a new order arrives).

export const EMOTES = {
  wave: { dur: 1.0, anim: 'cast', lock: true, face: 'player', line: ['Hello there!', 'Hi!', 'Over here!'] },
  laugh: { dur: 1.4, hop: [2, 7], icon: 'note', line: ["Hah! You're terrible.", 'Hahaha!', 'Oh, that got me.'] },
  bow: { dur: 1.2, anim: 'work', face: 'player', line: ["A proper Sheaf Moot bow. Don't get used to it.", 'Milady. Milord. Whichever.'] },
  dance: { dur: 2.8, hop: [3, 5], spin: 0.28, icon: 'note', particle: 'note', line: ["Don't laugh. ...Fine, you can laugh.", 'Sheaf Moot reel! Keep up!'] },
  hug: { dur: 1.8, approach: true, icon: 'heart', particle: 'heart', feel: ['affection', 0.12], line: ['Come here, you.', 'Mm. Thank you for that.'] },
  think: { dur: 1.9, icon: '...', line: ['Hmm... let me think.', 'Thinking. Give me a moment.'] },
  cheer: { dur: 1.5, hop: [4, 6], anim: 'cast', lock: true, icon: '!', particle: 'sparkle', line: ['Huzzah!', 'Yes! Ha!'] },
  shrug: { dur: 1.0, icon: '?', line: ['Who knows?', 'Your guess is as good as mine.'] },
  cry: { dur: 2.8, icon: 'sweat', line: ["I'm fine. It's just... dust.", '*sniff*'], kind: 'whisper' },
  angry: { dur: 1.4, hop: [2, 9], anim: 'attack', lock: true, icon: 'anger', line: ['Grr. There. Terrifying, yes?', 'Hmph!'] },
};

const EMOTE_ALIASES = {
  hi: 'wave',
  hello: 'wave',
  wave_hello: 'wave',
  greet: 'wave',
  giggle: 'laugh',
  chuckle: 'laugh',
  curtsy: 'bow',
  curtsey: 'bow',
  boogie: 'dance',
  jig: 'dance',
  embrace: 'hug',
  cuddle: 'hug',
  ponder: 'think',
  hmm: 'think',
  celebrate: 'cheer',
  yay: 'cheer',
  hooray: 'cheer',
  sob: 'cry',
  weep: 'cry',
  mad: 'angry',
  rage: 'angry',
  scowl: 'angry',
  sit_down: 'sit',
};

// 'waves' -> 'wave', 'a hug' -> 'hug', 'sit' -> 'sit'; null when unknown.
export function resolveEmote(name) {
  if (!name) return null;
  let n = String(name).toLowerCase().trim().replace(/^(a|an|the|do a|do the|give a|give me a)\s+/, '').replace(/\s+/g, '_');
  if (n === 'sit') return 'sit';
  if (EMOTES[n]) return n;
  if (EMOTE_ALIASES[n]) return EMOTE_ALIASES[n];
  const s = n.replace(/(ing|s|es)$/, '');
  if (EMOTES[s]) return s;
  if (EMOTES[`${s}e`]) return `${s}e`;
  if (EMOTE_ALIASES[s]) return EMOTE_ALIASES[s];
  return null;
}

const HARVEST_JOB = {
  tree: 'chop_wood',
  rock: 'mine_ore',
  ore: 'mine_ore',
  ore_iron: 'mine_ore',
  crystal: 'mine_ore',
  herb: 'gather_herbs',
  moonpetal: 'gather_herbs',
  berry_bush: 'forage',
  crop: 'farm',
};

export function jobForObject(o) {
  return HARVEST_JOB[o?.objType] || null;
}

// --- task runner ---

// Returns 'running' | 'done'.
export function runTask(b, task, dt) {
  switch (task.kind) {
    case 'emote':
      return runEmote(b, task, dt);
    case 'interact':
      return runInteract(b, task, dt);
    case 'give':
      return runGive(b, task, dt);
    case 'sit':
      return runSit(b, task, dt);
    case 'sleep':
      return runSleep(b, task, dt);
    default:
      return 'done';
  }
}

// Undo whatever pose the task left her in. restore=false keeps her position
// (the game moved her, e.g. when the player slept).
export function endTask(b, task, restore = true) {
  const a = b.actor;
  if (!task) return;
  if (task.kind === 'emote') {
    a.z = 0;
    if (a.state === 'work' || a.state === 'sit') a.setState('idle');
  }
  if (task.kind === 'sit' && a.state === 'sit') a.setState('idle');
  if (task.kind === 'sleep' && task.phase === 'asleep') {
    if (restore && task.standX != null) {
      a.x = task.standX;
      a.y = task.standY;
    }
    a.lockTime = 0;
    a.setState('idle');
  }
}

export function taskStatus(b, task) {
  switch (task.kind) {
    case 'emote':
      return '';
    case 'interact':
      return task.label || '';
    case 'give':
      return task.to === b.game.player ? 'bringing you something' : `bringing ${nameOf(b.game, task.to)} a gift`;
    case 'sit':
      if (task.tend) return 'catching her breath';
      if (task.lookUp) return 'watching the stars';
      return task.fire ? 'warming up by the fire' : 'sitting down';
    case 'sleep':
      return task.phase === 'asleep' ? 'sleeping' : 'heading to bed';
    default:
      return '';
  }
}

// --- emotes ---

function runEmote(b, task, dt) {
  const g = b.game;
  const a = b.actor;
  const def = task.def;
  const p = g.player;
  if (def.approach && !task.reached) {
    if (!p) return 'done';
    const r = b.steering.moveTo(p.x, p.y, dt, { arrive: 13, run: 1.1 });
    if (r === 'moving') return 'running';
    task.reached = true;
    if (r !== 'arrived') return 'done';
  }
  b.steering.stop();
  if (task.t === 0) {
    if (def.face === 'player' || def.approach) p && a.faceToward(p.x, p.y);
    if (def.icon) safe('bubbles.icon', () => g.bubbles?.icon?.(a, def.icon));
    if (def.anim) a.setState(def.anim, def.lock ? def.dur : 0);
    if (def.feel) safe('mind.feel', () => a.mind?.feel?.(def.feel[0], def.feel[1], `${task.name} with the player`));
  }
  task.t += dt;
  if (def.hop) a.z = Math.abs(Math.sin(task.t * Math.PI * def.hop[1] * 0.5)) * def.hop[0];
  if (def.spin) {
    task.spinT = (task.spinT || 0) - dt;
    if (task.spinT <= 0) {
      task.spinT = def.spin;
      task.dirI = ((task.dirI || 0) + 1) % 4;
      a.faceDir?.(['down', 'right', 'up', 'left'][task.dirI]);
    }
  }
  if (def.particle) {
    task.fxT = (task.fxT || 0) - dt;
    if (task.fxT <= 0) {
      task.fxT = 0.5;
      safe('particles.emit', () => g.particles?.emit?.(def.particle, a.x, a.y - 22, { count: 2 }));
    }
  }
  if (def.anim && !def.lock && a.state !== def.anim) a.setState(def.anim);
  if (task.t >= def.dur) {
    endTask(b, task);
    return 'done';
  }
  return 'running';
}

// --- interact ---

function runInteract(b, task, dt) {
  const g = b.game;
  const a = b.actor;
  const t = task.target;
  if (!t || t.removed || t.dead) return 'done';
  if (!task.stand) {
    task.stand = t.objType ? standSpotFor(g, t, a.x, a.y, a) || { x: t.x, y: t.y + 10 } : { x: t.x, y: t.y };
  }
  const isEntity = !t.objType;
  const goalX = isEntity ? t.x : task.stand.x;
  const goalY = isEntity ? t.y : task.stand.y;
  const close = isEntity ? dist(a.x, a.y, t.x, t.y) < 20 : dist(a.x, a.y, task.stand.x, task.stand.y) < 6 || dist(a.x, a.y, t.x, t.y) < 22;
  if (!close) {
    const r = b.steering.moveTo(goalX, goalY, dt, { arrive: isEntity ? 18 : 4, run: dist(a.x, a.y, goalX, goalY) > 8 * TILE ? 1.25 : 1, ignore: isEntity ? t : null });
    if (r === 'moving') {
      task.blockedT = 0;
      return 'running';
    }
    if (r !== 'arrived') {
      task.blockedT = (task.blockedT || 0) + dt;
      if (r === 'locked') {
        b.say(say.locked(b.steering.failure?.door), { force: true });
        return 'done';
      }
      if (task.blockedT > 2) {
        b.say(`I can't get to ${isEntity ? nameOf(g, t) : objectName(t)} from here.`, { force: true });
        return 'done';
      }
      return 'running';
    }
  }
  b.steering.stop();
  a.faceToward(t.x, t.y - 4);
  useThing(b, t, task.op);
  return 'done';
}

// What "using" each kind of thing means for Lyra. She never calls interact() on
// objects whose interaction is meant for the player (chests open the player's UI,
// beds put the whole game to sleep).
function useThing(b, t, op) {
  const g = b.game;
  const a = b.actor;
  if (!t.objType) return useEntity(b, t);
  const type = t.objType;
  if (type === 'door') {
    const open = op === 'open' ? true : op === 'close' ? false : !isOpenDoor(t);
    if (open) {
      if (isOpenDoor(t)) return;
      const ok = safe('door.open', () => t.open(a), false);
      if (!ok) b.say(g.player?.inventory?.has?.(t.state?.keyId) ? say.lockedPlayerHasKey(t) : say.locked(t), { force: true });
    } else if (isOpenDoor(t)) safe('door.close', () => t.close(a));
    return;
  }
  if (type === 'chest') {
    const inv = t.inventory;
    if (!inv) return;
    const moved = [];
    for (const { id, qty } of a.inventory.list()) {
      if (ITEMS[id]?.type !== 'material') continue;
      const n = a.inventory.transfer(inv, id, qty);
      if (n) moved.push({ id, qty: n });
    }
    if (moved.length) b.say(say.chestDeposit(itemsPhrase(moved)), { force: true });
    else b.say(say.chestPeek(safe('chest.describe', () => inv.describe(), 'nothing')), { force: true });
    return;
  }
  if (type === 'bed') {
    const mine = t.id === 'lyra_bed' || /lyra/i.test(String(t.name || ''));
    if (!mine) return b.say(say.homeBed(), { force: true });
    if (b.isBedtime()) b.startSleep(t);
    else b.say(say.sleepNotTired(), { force: true });
    return;
  }
  if (type === 'campfire' || type === 'hearth') {
    b.startSit(t);
    return;
  }
  if (type === 'well') return b.say(say.wellLine(), { force: true });
  if (type === 'sign' || type === 'notice_board') {
    const text = String(t.text || t.state?.text || t.message || t.description || '').trim();
    b.say(text ? say.readSign(text.length > 90 ? `${text.slice(0, 87)}...` : text) : 'The writing has worn away.', { force: true });
    return;
  }
  if (type === 'altar') {
    b.emote('think');
    b.say(say.altarLine(), { force: true, kind: 'whisper' });
    return;
  }
  if (type === 'journal') {
    safe('journal.interact', () => t.interact(a));
    return;
  }
  if (type === 'fishing_spot') {
    b.startJob({ job: 'fish', amount: 3, deliverTo: 'keep' });
    return;
  }
  const job = jobForObject(t);
  if (job) {
    const r = b.startJob({ job, amount: 1, deliverTo: 'keep', targetRef: t.id, quiet: true });
    if (!r.ok) b.say(r.message, { force: true });
    return;
  }
  b.say(say.lookAt(objectName(t)), { force: true });
}

function isOpenDoor(d) {
  return typeof d.isOpen === 'boolean' ? d.isOpen : !!d.state?.open;
}

function useEntity(b, e) {
  const g = b.game;
  const a = b.actor;
  if (e.type === 'pickup') {
    if (typeof e.collect === 'function') safe('pickup.collect', () => e.collect(a));
    else {
      a.inventory.add(e.itemId, e.qty ?? 1);
      e.removed = true;
      g.bus?.emit?.('item_gained', { actor: a, itemId: e.itemId, qty: e.qty ?? 1, from: 'pickup' });
    }
    return;
  }
  if (e.species === 'cat') {
    b.idle.petNow(e);
    return;
  }
  if (e === g.player) {
    b.emote('wave');
    return;
  }
  if (e.type === 'actor' && isActorAlive(e)) {
    b.emote('wave');
    b.say(say.greet(nameOf(g, e)), { force: true });
  }
}

// --- give ---

function runGive(b, task, dt) {
  const g = b.game;
  const a = b.actor;
  const to = task.to;
  if (!to || to.removed || !isActorAlive(to)) return 'done';
  const d = dist(a.x, a.y, to.x, to.y);
  if (d > 22) {
    const r = b.steering.moveTo(to.x, to.y, dt, { arrive: 20, run: d > 8 * TILE ? 1.35 : 1.05, ignore: to });
    if (r === 'moving') {
      task.blockedT = 0;
      return 'running';
    }
    if (r !== 'arrived') {
      task.blockedT = (task.blockedT || 0) + dt;
      if (task.blockedT > 4) {
        b.say(`I can't reach ${nameOf(g, to)} from here.`, { force: true });
        return 'done';
      }
      return 'running';
    }
  }
  b.steering.stop();
  a.faceToward(to.x, to.y);
  handItems(b, to, task.itemId, task.qty, true);
  return 'done';
}

// Hand items to someone standing next to her. Returns how many changed hands.
export function handItems(b, to, itemId, qty, speak) {
  const g = b.game;
  const a = b.actor;
  const have = a.inventory.count(itemId);
  const n = Math.min(have, qty);
  if (n <= 0) {
    if (speak) b.say(say.noItem(itemId), { force: true });
    return 0;
  }
  const isPlayer = to === g.player;
  if (isPlayer || typeof to.receiveGift !== 'function') {
    if (to.inventory) a.inventory.transfer(to.inventory, itemId, n);
    else a.inventory.remove(itemId, n);
    g.bus?.emit?.('item_given', { from: a, to, itemId, qty: n });
    g.bus?.emit?.('item_gained', { actor: to, itemId, qty: n, from: 'gift' });
  } else {
    // NPC gifts: the giver removes the item, the villager reacts in their own words.
    a.inventory.remove(itemId, n);
    g.bus?.emit?.('item_given', { from: a, to, itemId, qty: n });
    const r = safe('npc.receiveGift', () => to.receiveGift(itemId, a));
    const reply = r?.lines?.[0];
    if (reply) safe('bubbles.say', () => (typeof to.say === 'function' ? to.say(reply, { kind: 'say' }) : g.bubbles?.say?.(to, reply)));
  }
  safe('audio.play', () => g.audio?.play?.('pickup', { x: to.x, y: to.y }));
  if (speak) {
    if (n < qty) b.say(say.givePartial(itemId, n, qty), { force: true });
    else b.say(say.giveOk(itemId, n, nameOf(g, to)), { force: true });
  }
  return n;
}

// --- sit ---

function runSit(b, task, dt) {
  const g = b.game;
  const a = b.actor;
  if (task.phase === 'walk') {
    if (!task.spot) {
      task.spot = task.fire ? fireSeat(g, task.fire, a) : { x: a.x, y: a.y };
      if (!task.spot) task.spot = { x: a.x, y: a.y };
    }
    const r = b.steering.moveTo(task.spot.x, task.spot.y, dt, { arrive: 4, speed: 0.9 });
    if (r === 'moving') return 'running';
    task.phase = 'seated';
    task.t = 0;
  }
  b.steering.stop();
  if (task.fire) a.faceToward(task.fire.x, task.fire.y);
  else if (task.lookUp && a.dir !== 'up') a.faceDir?.('up');
  if (a.state !== 'sit') a.setState('sit');
  task.t = (task.t || 0) + dt;
  // Sitting down because she was exhausted: up again once she has her legs back.
  const rested = task.tend && task.t > 12 && need(g, 'energy') >= 0.4;
  if (rested || (task.maxTime && task.t > task.maxTime)) {
    endTask(b, task);
    return 'done';
  }
  return 'running';
}

// A walkable spot about a tile and a half from a fire, nearest to her.
export function fireSeat(g, fire, a) {
  const ftx = fire.tx ?? tileOf(fire.x);
  const fty = fire.ty ?? tileOf(fire.y - 1);
  let best = null;
  let bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const r = Math.hypot(dx, dy);
      if (r < 1 || r > 2.3) continue;
      if (!walkable(g, ftx + dx, fty + dy, a)) continue;
      const x = tileCenter(ftx + dx);
      const y = tileCenter(fty + dy);
      const d = dist(a.x, a.y, x, y) + (r < 1.5 ? 6 : 0);
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  }
  return best;
}

// --- sleep ---

function runSleep(b, task, dt) {
  const g = b.game;
  const a = b.actor;
  const bed = task.bed;
  if (task.phase === 'walk') {
    if (!bed || bed.removed) return 'done';
    if (!task.stand) task.stand = standSpotFor(g, bed, a.x, a.y, a) || { x: bed.x, y: bed.y + 10 };
    const r = b.steering.moveTo(task.stand.x, task.stand.y, dt, { arrive: 4, run: dist(a.x, a.y, bed.x, bed.y) > 10 * TILE ? 1.2 : 1 });
    if (r === 'moving') {
      task.blockedT = 0;
      return 'running';
    }
    if (r !== 'arrived') {
      task.blockedT = (task.blockedT || 0) + dt;
      if (task.blockedT > 3) {
        b.bedFailedAt = b.t;
        return 'done';
      }
      return 'running';
    }
    // Lie down in the bed itself; remember where to step back out.
    task.standX = a.x;
    task.standY = a.y;
    a.x = bed.x;
    a.y = bed.y - 3;
    a.faceDir?.('down');
    a.setState('sleep');
    task.phase = 'asleep';
    task.zT = 1;
  }
  b.steering.stop();
  a.lockTime = Math.max(a.lockTime || 0, 0.25);
  if (a.state !== 'sleep') a.setState('sleep');
  task.zT -= dt;
  if (task.zT <= 0) {
    task.zT = rand(3.5, 5);
    safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'zzz'));
  }
  if (!b.isBedtime(true)) {
    endTask(b, task);
    return 'done';
  }
  return 'running';
}

