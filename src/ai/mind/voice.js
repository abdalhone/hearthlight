import { PLAYER_ID } from '../../core/constants.js';
import { resolveEntity } from '../resolve.js';
import { normName, firstName, cap, shorten, pick, joinList, playerRef, lowerFirst, timeAgo, itemPhrase } from './text.js';
import { bondOf } from './relationships.js';
import { activeGoals } from './goals.js';
import { FOOD_PREFERENCE } from './needs.js';
import { itemName } from '../../entities/items.js';

// Shared by the mind's plugins: who a phrase refers to, and answers in Lyra's voice
// built from her real state (mood, needs, goals, memories, relationships).

// "the bandits", "wolves", "the deer": whole kinds of creature.
const GROUPS = [
  { re: /^(bandits?|outlaws?|brigands?|raiders?|thieves|thief)$/, key: 'faction:bandit', name: 'Bandits', faction: 'bandit' },
  { re: /^(wolf|wolves)$/, key: 'species:wolf', name: 'Wolves', species: 'wolf' },
  { re: /^slimes?$/, key: 'species:slime', name: 'Slimes', species: 'slime' },
  { re: /^boars?$/, key: 'species:boar', name: 'Boars', species: 'boar' },
  { re: /^deers?$/, key: 'species:deer', name: 'Deer', species: 'deer' },
  { re: /^(rabbits?|bunn(y|ies))$/, key: 'species:rabbit', name: 'Rabbits', species: 'rabbit' },
  { re: /^(chickens?|hens?)$/, key: 'species:chicken', name: 'Chickens', species: 'chicken' },
  { re: /^(cats?|kitt(y|ies)|kittens?)$/, key: 'species:cat', name: 'Cats', species: 'cat' },
  { re: /^bats?$/, key: 'species:bat', name: 'Bats', species: 'bat' },
  { re: /^(skeletons?|undead|the dead)$/, key: 'faction:undead', name: 'The undead', faction: 'undead' },
  { re: /^(monsters?|beasts?)$/, key: 'faction:monster', name: 'Monsters', faction: 'monster' },
  { re: /^(animals?|wildlife|critters?|creatures?)$/, key: 'faction:wildlife', name: 'Wild animals', faction: 'wildlife' },
  { re: /^(villagers?|townsfolk|towns?people|locals?|village)$/, key: 'faction:villager', name: 'Villagers', faction: 'villager' },
  { re: /^(guards?|soldiers?|watch(men)?)$/, key: 'faction:guard', name: 'Guards', faction: 'guard' },
];

const PLURALISH = /(s|ies|ves|deer|undead|wildlife|folk|people|men|the dead|village)$/;

export function groupFor(text) {
  const n = normName(text).replace(/^(the|all|all the|any|every|those|these|our|my)\s+/, '');
  for (const g of GROUPS) if (g.re.test(n)) return { ...g, plural: PLURALISH.test(n) };
  return null;
}

// Resolve a loose reference to someone Lyra could have feelings about.
// Returns { player, self, group, entity, rel, id, name } or null.
export function resolvePerson(ctx, ref) {
  const g = ctx?.game;
  const mind = ctx?.mind;
  if (!ref || !mind) return null;
  if (typeof ref === 'object' && ref.id) {
    const rel = mind.relationships.map.get(ref.id) || null;
    return { entity: ref, rel, id: ref.id, name: ref.name || ref.id, player: ref.id === PLAYER_ID };
  }
  const raw = String(ref).trim();
  const n = normName(raw).replace(/^(the|a|an|that|this|our|my|your)\s+/, '');
  if (!n) return null;
  if (/^(me|myself|player|us|you know who)$/.test(n)) return { player: true, id: PLAYER_ID, entity: g?.player || null, rel: mind.relationships.get(PLAYER_ID), name: playerRef(g) };
  const self = normName(mind.name);
  if (/^(you|yourself|lyra|companion|her)$/.test(n) || n === self) return { self: true, id: ctx.companion?.id || 'lyra', entity: ctx.companion || null, rel: null, name: mind.name };
  const group = groupFor(n);
  if (group && group.plural) return { group, id: group.key, name: group.name, rel: mind.relationships.get(group.key) };
  let rel = mind.relationships.get(raw) || mind.relationships.get(n);
  if (rel && rel.kind === 'group') return { group: groupFor(rel.name) || { key: rel.id, name: rel.name }, id: rel.id, name: rel.name, rel };
  let entity = null;
  try {
    entity = rel ? g?.entities?.get?.(rel.id) || null : resolveEntity(g, raw, ctx.companion);
  } catch {
    entity = null;
  }
  if (entity && entity.type !== 'actor') entity = null;
  if (entity) {
    if (entity.id === PLAYER_ID) return { player: true, id: PLAYER_ID, entity, rel: mind.relationships.get(PLAYER_ID), name: playerRef(g) };
    if (entity === ctx.companion) return { self: true, id: entity.id, entity, rel: null, name: mind.name };
    rel = rel || mind.relationships.map.get(entity.id) || null;
    return { entity, rel, id: entity.id, name: entity.name || raw };
  }
  if (rel) return { entity: null, rel, id: rel.id, name: rel.name };
  if (group) return { group, id: group.key, name: group.name, rel: mind.relationships.get(group.key) };
  return null;
}

// ---------------------------------------------------------------- relationships

export function opinionAnswer(ctx, ref) {
  const mind = ctx.mind;
  const who = resolvePerson(ctx, ref);
  if (!who) return null;
  if (who.player) return playerAnswer(ctx, 'think');
  if (who.self) return "Me? I'm a work in progress. Ask me again when I've found Maren.";
  if (who.group) {
    const tags = who.rel?.tags || [];
    if (tags.includes('enemy')) return `${who.name}? Enemies, every one. I'll not lose sleep over them.`;
    if (tags.includes('friend') || tags.includes('pet')) return `${who.name}? Friends. I won't raise a hand to them.`;
    if (who.group.faction === 'bandit') return "Bandits? Thieves who'd knife a farmer for his boots. I've no love for them.";
    if (who.group.species === 'wolf') return "Wolves and I have history. Two days of it, and I'd like no more.";
    if (who.group.faction === 'villager') return "The folk of Hearthvale? Good people. I'd stand between them and anything.";
    return `${who.name}? I don't think much about them either way.`;
  }
  const rel = who.rel;
  const name = firstName(who.name);
  if (!rel || (rel.firstMet == null && !rel.absent)) {
    const role = who.entity?.role || who.entity?.profile?.role;
    return `I haven't properly met ${name} yet.${role ? ` The ${String(role).toLowerCase()}, I'm told.` : ''} Introduce me?`;
  }
  return rel.opinion || mind.relationships.composeOpinion(rel);
}

export function playerAnswer(ctx, verb = 'like') {
  const rel = ctx.mind.relationships.get(PLAYER_ID);
  if (!rel) return null;
  const a = rel.affinity;
  const t = rel.trust;
  const lvl = bondOf(rel).level;
  if (verb === 'trust') {
    if (t >= 65) return 'With my life. I already have, more than once.';
    if (t >= 40) return "More every day. You've earned most of it.";
    if (t >= 20) return "I'm learning to. You make it easy, mostly.";
    return 'Not yet. Give me reasons, and I will.';
  }
  if (verb === 'friends') {
    if (lvl >= 3) return 'Friends? Of course we are. Keep up.';
    if (lvl === 2) return "We're getting there. I'd say companions, and I don't say that lightly.";
    if (a < -10) return "Right now? I'm not sure. Ask me after you've given me a reason.";
    return "We met two days ago over a pile of wolves. I'd like us to be. Give it time.";
  }
  if (verb === 'love') {
    if (a >= 75 && lvl >= 4) return "...Yes. Don't make me say it twice; I'll go red as a radish.";
    if (a >= 45) return "Careful. I'm fond of you, more than I planned. Let's not rush the rest.";
    return "Love? We've known each other a handful of days. Buy me a honey cake first.";
  }
  const lead = a >= 15 ? 'Yes.' : a <= -10 ? 'Not much, lately.' : "I'm deciding.";
  return `${lead} ${rel.opinion || ctx.mind.relationships.composeOpinion(rel)}`;
}

export function friendsAnswer(ctx, kind = 'friends') {
  const mind = ctx.mind;
  const people = mind.relationships.people().filter((r) => r.id !== PLAYER_ID && (r.firstMet != null || r.absent));
  if (kind === 'enemies') {
    const enemies = mind.relationships.all().filter((r) => r.tags.includes('enemy') || r.affinity <= -40);
    if (!enemies.length) return "Enemies? Bandits, in general. Nobody with a name, yet. Let's keep it that way.";
    return `${joinList(enemies.map((r) => (r.kind === 'group' ? r.name.toLowerCase() : firstName(r.name))))}. I keep an eye on them.`;
  }
  if (kind === 'trust') {
    const top = [...people].sort((x, y) => y.trust - x.trust).slice(0, 3);
    return `Maren, always. After her? ${joinList(top.filter((r) => r.id !== 'maren').map((r) => firstName(r.name))) || 'You'}. And you, more than you'd think.`;
  }
  if (kind === 'dislike') {
    const low = people.filter((r) => r.affinity < 5).sort((x, y) => x.affinity - y.affinity);
    if (!low.length) return "Nobody here, honestly. Ask me again after I've met Garrick's prices.";
    return `${firstName(low[0].name)}, if I had to pick. ${shorten(low[0].opinion || '', 120)}`;
  }
  const friends = people.filter((r) => r.id !== 'maren' && (bondOf(r).level >= 3 || r.tags.includes('friend')));
  const liked = people.filter((r) => r.id !== 'maren' && r.affinity >= 15).sort((x, y) => y.affinity - x.affinity);
  if (friends.length) return `${joinList(friends.slice(0, 4).map((r) => firstName(r.name)))}. And you, obviously. Maren most of all, wherever she is.`;
  if (liked.length) return `I'm fond of ${joinList(liked.slice(0, 3).map((r) => firstName(r.name)))}. Friends takes longer. You're closest, after Maren.`;
  return "Maren. You, I think. Everyone else here I've only just met.";
}

// "Bram: Friend (bond 46); affinity 40, trust 35, respect 50. Tags: friend. Opinion: ..."
export function relLine(rel, { opinion = true } = {}) {
  const b = bondOf(rel);
  const parts = [`${rel.name}${rel.id !== rel.name ? ` (${rel.id}${rel.role ? `, ${rel.role}` : ''})` : ''}: ${b.label}; affinity ${Math.round(rel.affinity)}, trust ${Math.round(rel.trust)}, respect ${Math.round(rel.respect)}`];
  if (rel.fear >= 20) parts.push(`fear ${Math.round(rel.fear)}`);
  if (rel.tags.length) parts.push(`tags ${rel.tags.join('/')}`);
  let s = parts.join(', ');
  if (opinion && rel.opinion) s += `. "${shorten(rel.opinion, 130)}"`;
  return s;
}

// ---------------------------------------------------------------- feelings

const EMOTION_WORDS = {
  joy: 'happy',
  sadness: 'sad',
  fear: 'scared',
  anger: 'angry',
  trust: 'safe',
  surprise: 'startled',
  affection: 'fond of everyone',
  curiosity: 'curious',
  pride: 'proud',
  embarrassment: 'embarrassed',
};

export function feelingsAnswer(ctx) {
  const mind = ctx.mind;
  const m = mind.mood();
  const dom = mind.affect.dominant();
  const pressing = mind.needsEngine.pressing(0.3);
  const P = playerRef(ctx.game);
  const parts = [];
  switch (m.label) {
    case 'delighted':
    case 'cheerful':
    case 'happy':
      parts.push(pick(['Honestly? Good. Really good.', "Happy. Don't tell anyone; I have a reputation."], ctx.game?.rng));
      break;
    case 'content':
    case 'lively':
    case 'at ease':
      parts.push(pick(['Pretty good, actually.', "Content. Calm water, as we'd say at home."], ctx.game?.rng));
      break;
    case 'curious':
    case 'fascinated':
      parts.push('Curious. This valley keeps handing me questions.');
      break;
    case 'affectionate':
      parts.push("Soft, if you must know. It's the company.");
      break;
    case 'proud':
      parts.push("Proud of us, honestly. We're good at this.");
      break;
    case 'afraid':
    case 'terrified':
    case 'on edge':
      parts.push(`Scared, if I'm honest. Stay close, ${P}.`);
      break;
    case 'angry':
    case 'furious':
      parts.push("Angry. Give me a minute and I'll be precise about it.");
      break;
    case 'sad':
    case 'heartsick':
    case 'gloomy':
    case 'miserable':
      parts.push(pick(["Heavy. Thinking about Maren too much.", "A bit low. It'll pass. It always does."], ctx.game?.rng));
      break;
    case 'flustered':
      parts.push("Flustered. Don't look at me like that.");
      break;
    case 'startled':
      parts.push('Still jumpy. My heart thinks we are being chased.');
      break;
    case 'exhausted':
      parts.push('Exhausted. My bones have opinions.');
      break;
    case 'starving':
      parts.push('Starving. Ask me again after food.');
      break;
    default:
      parts.push(`${cap(m.label)}, I think.`);
  }
  if (dom.excess > 0.2 && EMOTION_WORDS[dom.name] && !parts[0].toLowerCase().includes(EMOTION_WORDS[dom.name].split(' ')[0])) {
    const cause = lastEmotionCause(mind, dom.name);
    if (cause) parts.push(`A little ${EMOTION_WORDS[dom.name]}, after ${cause}.`);
  }
  if (pressing === 'hunger') parts.push(mind.hasFood?.() ? 'And hungry; I should eat something.' : "And hungry. I'm out of food, if you're offering.");
  else if (pressing === 'energy') parts.push('And tired. A bed would not go amiss.');
  else if (pressing === 'social') parts.push("And glad you asked. It's been quiet.");
  else if (pressing === 'fun') parts.push("A bit restless, too. Let's go somewhere new.");
  else if (pressing === 'safety') parts.push("I don't like it here.");
  const o = ctx.companion;
  if (o?.maxHp && o.hp < o.maxHp * 0.4) parts.push('Also bleeding a bit. Nothing a mending charm will not fix.');
  return parts.join(' ');
}

function lastEmotionCause(mind, name) {
  const mem = [...mind.memory.all()].reverse().find((m) => m.emotion === name && mind.now() - m.t < 300);
  return mem?.gist || null;
}

export function hungerAnswer(ctx) {
  const mind = ctx.mind;
  const h = mind.needs.hunger;
  const inv = ctx.companion?.inventory;
  const food = inv ? FOOD_PREFERENCE.find((id) => inv.has(id)) : null;
  if (h < 0.3) return food ? `Starving. I've ${itemPhrase(food, itemName(food))} in my satchel; I'll eat it now, if that's all right.` : "Starving, and my satchel's empty. A honey cake would save a life. Mine.";
  if (h < 0.55) return food ? `I could eat. There's ${itemPhrase(food, itemName(food))} in my satchel for later.` : 'I could eat. Not urgent. Yet.';
  return pick(["No, I'm fine. Ask me again in an hour; the answer will change.", 'Full, for once. Elda would be proud.'], ctx.game?.rng);
}

export function tiredAnswer(ctx) {
  const e = ctx.mind.needs.energy;
  const night = !!ctx.game?.clock?.isNight;
  if (e < 0.25) return night ? "Dead on my feet. Let's go home and sleep." : "Dead on my feet. I'll keep going, but I'm not going to be pleasant about it.";
  if (e < 0.5) return 'A little worn. A sit by a fire would fix me.';
  return "Not a bit. I could walk to the Isles and back. Well. Halfway.";
}

export function fearAnswer(ctx) {
  const mind = ctx.mind;
  const fears = mind.soul.fears || [];
  const f = mind.emotions.fear;
  const now = f > 0.35 ? "Right now? Yes. A little. Don't let go of your sword." : 'Not right now.';
  return `${now} Deep, dark water scares me. Losing people scares me more. ${fears.includes('that Maren is already dead') ? "And that I'm too late for Maren." : ''}`.trim();
}

export function wantAnswer(ctx) {
  const mind = ctx.mind;
  const goals = activeGoals(mind.goals);
  const top = goals[0];
  const parts = [];
  if (top?.id === 'find_maren' || top?.id === 'follow_maren' || top?.source === 'quest') parts.push(`To find Maren. Everything else comes after that.`);
  else if (top) parts.push(`${cap(lowerFirst(top.text.replace(/[.!]$/, '')))}.`);
  const second = goals.find((g) => g !== top && g.source !== 'quest' && g.id !== 'find_maren');
  if (second) parts.push(`And ${lowerFirst(second.text.replace(/[.!]$/, ''))}.`);
  const pressing = mind.needsEngine.pressing(0.35);
  if (pressing === 'hunger') parts.push('Right now, though? Food.');
  else if (pressing === 'energy') parts.push('Right now, though? Sleep.');
  else if (pressing === 'fun') parts.push('Right now, somewhere I have never been.');
  else if (pressing === 'social') parts.push('Right now, just talk to me for a bit.');
  const dream = mind.soul.dreams?.find((d) => /teach/i.test(d));
  if (dream && parts.length < 3) parts.push(`One day: ${lowerFirst(dream)}.`);
  return parts.join(' ');
}

export function thinkingAnswer(ctx) {
  const mind = ctx.mind;
  const last = mind.thoughts[mind.thoughts.length - 1];
  if (last && mind.now() - last.t < 600) return `Honestly? ${last.text}`;
  return wantAnswer(ctx);
}

// ---------------------------------------------------------------- memories

export function memoryAnswer(ctx, query, { lead = true } = {}) {
  const mind = ctx.mind;
  const q = String(query || '').trim();
  let mems;
  if (/^(today|this morning|this afternoon|tonight)$/i.test(q)) mems = mind.memory.ofDay(ctx.game?.clock?.day ?? 1).slice(0, 3);
  else if (/^yesterday$/i.test(q)) mems = mind.memory.ofDay((ctx.game?.clock?.day ?? 1) - 1).slice(0, 3);
  else mems = mind.recall(q, { limit: 3 });
  if (!mems.length) {
    const who = resolvePerson(ctx, q.replace(/^(about|of)\s+/i, ''));
    if (who?.rel && !who.player) return `I know ${firstName(who.name)}, but nothing in particular stands out yet.`;
    if (/^(today|yesterday)/i.test(q)) return 'Not much worth writing down. Which is its own kind of nice.';
    return pick(['Hm. Nothing comes to mind about that.', "I'm drawing a blank. Remind me?"], ctx.game?.rng);
  }
  const first = mems[0];
  const when = first.day > 0 ? timeAgo(ctx.game, first.t) : first.when || '';
  const opener = lead ? pick(['I remember.', 'Of course I remember.', 'Mm.'], ctx.game?.rng) : '';
  const startsWithTime = /^(two days ago|yesterday|today|the morning|the night|my first|maren's last)/i.test(first.text);
  let out = `${opener} ${!startsWithTime && when && when !== 'a little while ago' ? `${cap(when)}: ` : ''}${first.text}`.trim();
  if (mems[1] && out.length < 220) out += ` And ${lowerFirst(shorten(mems[1].text, 150))}`;
  return shorten(out, 420);
}
