import { PLAYER_ID } from '../../core/constants.js';
import { resolveEntity } from '../resolve.js';
import { normName, firstName, cap, shorten, pick, joinList, playerRef, lowerFirst, timeAgo, itemPhrase, firstSentence } from './text.js';
import { bondOf } from './relationships.js';
import { activeGoals } from './goals.js';
import { FOOD_PREFERENCE } from './needs.js';
import { itemName } from '../../entities/items.js';
import { CLOSED_PEOPLE, GUARDED_LIFE } from './soul.js';

const bondLevelOf = (mind) => bondOf(mind.relationships.get(PLAYER_ID)).level;

// What she says of someone she does not talk about yet (soul.js CLOSED_PEOPLE), or null.
export function closedAbout(mind, id) {
  const c = CLOSED_PEOPLE[id];
  if (!c) return null;
  return bondLevelOf(mind) >= c.openAtBond ? null : c.line;
}

// A life memory as she would tell it to the player now: the parts she keeps for a deep
// bond (soul.js GUARDED_LIFE) come out as the village's version until then.
export function lifeText(mind, id, text) {
  const g = GUARDED_LIFE[id];
  return g && bondLevelOf(mind) < g.openAtBond ? g.text : text;
}

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
    return "I carried you down a mountain and you've been awake six days. Give it time.";
  }
  if (verb === 'love') {
    if (a >= 75 && lvl >= 4) return "...Yes. Don't make me say it twice; I'll go red as a radish.";
    if (a >= 45) return "Careful. I'm fond of you, more than I planned. Let's not rush the rest.";
    return "Love? You've been awake six days. Buy me a honey cake first.";
  }
  const opinion = rel.opinion || ctx.mind.relationships.composeOpinion(rel);
  // "What do you think of me?" gets her opinion; "do you like me?" gets an answer first.
  if (verb === 'think') return a <= -10 ? `Not much, lately. ${opinion}` : opinion;
  const lead = a >= 15 ? 'Yes.' : a <= -10 ? 'Not much, lately.' : "I'm deciding.";
  return `${lead} ${opinion}`;
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
      parts.push(pick(['Pretty good, actually.', "Content. Flame's lit, as Da says."], ctx.game?.rng));
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
  return "Not a bit. I could walk to Saltmere and back. Well. Halfway.";
}

// "Are you scared?" is about now; "what are you afraid of?" is about her life (LORE §7,
// "Dreams and fears"). She has never once admitted she is afraid of deep water: that is a
// secret she tells at a deep bond, so until then it stays off the list.
export function fearAnswer(ctx, { what = false } = {}) {
  const mind = ctx.mind;
  const f = mind.emotions.fear;
  const now = f > 0.35 ? "Right now? Yes. A little. Don't let go of your sword." : 'Not right now. Ask me again at the ruins gate.';
  if (!what) return now;
  const told = bondOf(mind.relationships.get(PLAYER_ID)).level >= 4;
  const list = 'Sickbeds. Losing Mam and Da. Being too late again, for anyone. Finding Maren dead.';
  return `${list}${told ? ' And deep water. Since the ice. ...There. Now you know.' : ' Marrying a stone, some days.'}${f > 0.35 ? ' And right now, a little, whatever is out there.' : ''}`;
}

export function wantAnswer(ctx) {
  const mind = ctx.mind;
  const goals = activeGoals(mind.goals);
  const top = goals[0];
  const parts = [];
  if (top?.id === 'find_maren' || top?.id === 'follow_maren' || top?.source === 'quest') parts.push(`To find Maren. Everything else comes after that.`);
  else if (top) parts.push(`${cap(lowerFirst(toListener(top.text).replace(/[.!]$/, '')))}.`);
  const second = goals.find((g) => g !== top && g.source !== 'quest' && g.id !== 'find_maren');
  if (second) parts.push(`And ${lowerFirst(toListener(second.text).replace(/[.!]$/, ''))}.`);
  const pressing = mind.needsEngine.pressing(0.35);
  if (pressing === 'hunger') parts.push('Right now, though? Food.');
  else if (pressing === 'energy') parts.push('Right now, though? Sleep.');
  else if (pressing === 'fun') parts.push('Right now, somewhere I have never been.');
  else if (pressing === 'social') parts.push('Right now, just talk to me for a bit.');
  // Her calling first (LORE §7: the dead waystones, all the way to the sea), then Pip.
  const dream = mind.soul.dreams?.find((d) => /waystone/i.test(d)) || mind.soul.dreams?.find((d) => /teach/i.test(d));
  if (dream && parts.length < 3) parts.push(`One day: ${lowerFirst(String(dream).replace(/[.!]$/, ''))}.`);
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
  if (/first meeting/.test(q)) return FIRST_MEETING;
  let hits;
  if (/^(today|this morning|this afternoon|tonight)$/i.test(q)) hits = mind.memory.ofDay(ctx.game?.clock?.day ?? 1).slice(0, 3).map((m) => ({ store: 'episode', ref: m, text: m.text }));
  else if (/^yesterday$/i.test(q)) hits = mind.memory.ofDay((ctx.game?.clock?.day ?? 1) - 1).slice(0, 3).map((m) => ({ store: 'episode', ref: m, text: m.text }));
  else hits = mind.recall(q, { limit: 3, stores: ['episode', 'life'] }).filter((h) => h.relevance > 0.1 || h.store === 'episode');
  if (!hits.length) {
    const who = resolvePerson(ctx, q.replace(/^(about|of)\s+/i, ''));
    if (who?.rel && !who.player) return `I know ${firstName(who.name)}, but nothing in particular stands out yet.`;
    if (/^(today|yesterday)/i.test(q)) return 'Not much worth writing down. Which is its own kind of nice.';
    return pick(['Hm. Nothing comes to mind about that.', "I'm drawing a blank. Remind me?"], ctx.game?.rng);
  }
  const first = hits[0];
  const opener = lead ? pick(['I remember.', 'Of course I remember.', 'Mm.'], ctx.game?.rng) : '';
  if (first.store === 'life') return shorten(`${opener} ${toListener(firstPerson(lifeText(mind, first.ref?.id, first.text), mind.name), { aboutPlayer: aboutPlayerOnly(first.ref) })}`.trim(), 420);
  const m = first.ref;
  const when = m.day > 0 ? timeAgo(ctx.game, m.t) : m.when || '';
  const startsWithTime = /^(two days ago|six days ago|three months ago|on the fortieth night|yesterday|today|the morning|the night|my first|maren's last)/i.test(m.text);
  let out = `${opener} ${!startsWithTime && when && when !== 'a little while ago' ? `${cap(when)}: ` : ''}${m.text}`.trim();
  const second = hits[1];
  if (second && second.store === 'episode' && out.length < 220) out += ` And ${lowerFirst(shorten(second.text, 150))}`;
  return shorten(out, 420);
}

// "How did we meet?": the mountain first, then the wolves (LORE §8, §7 "This year").
const FIRST_MEETING =
  "Depends what you call meeting. Hess and I found you in the Crown Ring on the Hollowcrown three months ago, asleep in a circle of melted snow, and carried you down. You slept eighty-one days. The first time you were awake for it: two days ago, wolves on the King's Road, and you stood beside me. I noticed.";

// Her life story names the player "the stranger"; told to the player, it is "you". With
// `aboutPlayer` (a memory whose people include the player and no one else spoken of as
// "they"), the player's they/them/their become you/your too.
export function toListener(text, { aboutPlayer = false } = {}) {
  let t = String(text || '')
    .replace(/\b[Ww]ho is the stranger from the mountain\?/g, 'who you are, and where you came from.')
    .replace(/\bthe stranger's\b/g, 'your')
    .replace(/\bThe stranger's\b/g, 'Your')
    .replace(/\bthe stranger\b/g, 'you')
    .replace(/\bThe stranger\b/g, 'You');
  if (aboutPlayer) {
    t = t
      .replace(/\bthey were\b/g, 'you were')
      .replace(/\bThey were\b/g, 'You were')
      .replace(/\bthem\b/g, 'you')
      .replace(/\btheir\b/g, 'your')
      .replace(/\bTheir\b/g, 'Your')
      .replace(/\bthey\b/g, 'you')
      .replace(/\bThey\b/g, 'You');
  }
  // "you was", "you lives" never stand: keep the grammar of the second person.
  const VERB = { was: 'were', is: 'are', has: 'have', does: 'do', lives: 'live', sleeps: 'sleep', wakes: 'wake', stands: 'stand', knows: 'know', says: 'say', remembers: 'remember', comes: 'come', moves: 'move' };
  return t.replace(/\b([Yy]ou) (was|is|has|does|lives|sleeps|wakes|stands|knows|says|remembers|comes|moves)\b/g, (m, y, v) => `${y} ${VERB[v]}`);
}

const aboutPlayerOnly = (ref) => Array.isArray(ref?.people) && ref.people.includes('player');

// Whole sentences under a length, never a word cut in half.
function clipSentences(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const parts = t.match(/[^.!?]+[.!?]+["')]*\s*/g) || [t];
  let out = '';
  for (const p of parts) {
    if ((out + p).trim().length > max) break;
    out += p;
  }
  return out.trim() || shorten(t, max);
}

// "Tell me about your parents": who they are to her, from her own people (LORE §7).
function parentsAnswer(mind, query) {
  // The memory plugin adds "mother father" to every family question; read what was asked.
  const q = String(query || '').replace(/\s+mother father$/, '');
  const op = (id, fallback) => mind.relationships.get(id)?.opinion || fallback;
  if (/\b(?:brothers?|sisters?|siblings?)\b/.test(q)) {
    return "No brothers or sisters living. Mam and Da buried three babies before me: Ansel, Bee and little Jem. And there's Beth, who came in out of the grey and got put in my bed. She's my sister, whatever the flame-count says.";
  }
  const da = op('hobb', "My father's lit every lamp in this valley for forty-one years and still can't find his spectacles.");
  const mam = op('wenna', 'Seventy-six, nearly blind, and still the fiercest person in this valley.');
  if (/\b(?:father|dad|da|pa)\b/.test(q) && !/\b(?:mother|mum|mom|mam|ma|parents?)\b/.test(q)) return `${da} He's at the chandlery on Lamplight Lane, or up a ladder.`;
  if (/\b(?:mother|mum|mom|mam|ma)\b/.test(q) && !/\b(?:father|dad|da|pa|parents?)\b/.test(q)) return `${mam} Go and say hello; she'll want to touch your face.`;
  return shorten(`My parents are on Lamplight Lane. Da's the lamplighter, Mam keeps the bees; they were fifty-five and fifty-two when I came along, after three babies they buried. ${firstSentence(da, 160)} Go and say hello. Mam will want to touch your face.`, 460);
}

// Story text about her may be written about "Lyra"; she tells it as her own. "Lyra's" ->
// "my", "Lyra and Hess" -> "Hess and I", "Lyra lights" -> "I light", a sentence that starts
// with her -> "I", anywhere else -> "me". (Story texts about her use her name, not "she".)
const FIRST_VERB = { has: 'have', is: 'am', was: 'was', does: 'do', goes: 'go' };
function firstPersonVerb(v) {
  if (FIRST_VERB[v]) return FIRST_VERB[v];
  if (/^[ldt]ies$/.test(v)) return v.slice(0, -1);
  if (/ies$/.test(v)) return `${v.slice(0, -3)}y`;
  if (/(?:ch|sh|ss|x|z|o)es$/.test(v)) return v.slice(0, -2);
  if (/[^s]s$/.test(v)) return v.slice(0, -1);
  return v;
}
export function firstPerson(text, name = 'Lyra') {
  const n = String(name || 'Lyra').replace(/[.*+?^${}()|[\]\\]/g, '');
  // Her name in quotes is a name ("lamplighters call it 'Lyra'"), not her.
  const bare = `(?<!['"\u2018\u201c])\\b${n}`;
  const NOT_VERB = '(?!(?:as|us|plus|thus|less|unless|across|perhaps|included)\\b)';
  return String(text || '')
    .replace(new RegExp(`\\b${n} Ambrel\\b`, 'g'), n)
    .replace(new RegExp(`${bare}'s\\b`, 'g'), 'my')
    .replace(new RegExp(`${bare} and ([A-Z][a-z]+)\\b`, 'g'), '$1 and I')
    .replace(new RegExp(`${bare} ${NOT_VERB}(has|is|was|does|goes|[a-z]+s)\\b`, 'g'), (m, v) => `I ${firstPersonVerb(v)}`)
    // "Lyra climbed", "Lyra heard", "Lyra can": the past and the modals keep their form
    // (but "everyone born here, Lyra included" is "me included").
    .replace(new RegExp(`${bare} ${NOT_VERB}(can|could|will|would|should|must|might|may|did|had|[a-z]+ed|came|went|took|saw|lit|found|heard|knew|left|got|paid|made|said|told|sat|ran|fell|bit|kept|felt|held|met|put|stood|thought|wrote|gave|brought|bought|caught|lent|spent|swore|wore|chose|rode|won|lost)\\b`, 'g'), 'I $1')
    .replace(new RegExp(`(^|[.!?]\\s+)${n}\\b(?!['"\u2019\u201d])`, 'g'), '$1I')
    .replace(new RegExp(`${bare}\\b(?!['"\u2019\u201d])`, 'g'), 'me')
    .replace(/(^|[.!?]\s+)(my|me)\b/g, (m, a, w) => `${a}${w === 'my' ? 'My' : 'Me'}`);
}

// "Tell me about your childhood / your brother / where did you grow up": her life story.
export function lifeAnswer(ctx, topic) {
  const mind = ctx.mind;
  const q = String(topic || '').trim();
  if (/\b(?:parents?|mother|father|mum|mom|dad|mam|da|siblings?|brothers?|sister)\b/i.test(q) && !/\bborn\b/i.test(q)) return parentsAnswer(mind, q.toLowerCase());
  let hits = q ? mind.recall(q, { limit: 2, stores: ['life'] }).filter((h) => h.relevance > 0.1) : [];
  if (!hits.length && /child|grow|young|hearthvale|lamplight|chandlery|home|from|born|family|parents|mother|father|mam|da\b/i.test(q)) {
    hits = (mind.life || []).slice(0, 2).map((e) => ({ store: 'life', ref: e, text: e.text, label: e.title }));
  }
  if (!hits.length) return null;
  const [a, b] = hits;
  let out = toListener(firstPerson(lifeText(mind, a.ref?.id, a.text), mind.name), { aboutPlayer: aboutPlayerOnly(a.ref) });
  if (b && out.length < 200) out += ` ${toListener(firstPerson(firstSentence(lifeText(mind, b.ref?.id, b.text), 160), mind.name), { aboutPlayer: aboutPlayerOnly(b.ref) })}`;
  const tender = (a.ref?.feeling === 'sadness' || a.ref?.importance >= 9) && mind.relationships.bond(PLAYER_ID).level < 2;
  if (tender) out += " ...I don't usually tell people that.";
  return shorten(out, 460);
}

// "What do you know about the waygates / Bram / the bandits?"
// `define`: a "what is X?" question, where the lore of X comes before her memory of it.
export function knowAnswer(ctx, topic, { define = false } = {}) {
  const mind = ctx.mind;
  const q = String(topic || '').trim().replace(/[?.!]+$/, '');
  if (!q) return null;
  const who = resolvePerson(ctx, q);
  if (who?.player) return playerAnswer(ctx, 'think');
  if (who && !who.group && !who.self) {
    const closed = closedAbout(mind, who.id);
    if (closed) return closed;
    const d = mind.dossier(who.id);
    if (d) {
      const n = firstName(d.name);
      const told = [...d.notes.filter((x) => x.source !== 'self').map((x) => x.text), ...d.facts.filter((f) => f.source !== 'lore').map((f) => f.text)];
      const parts = [];
      if (d.role && !/^lyra/i.test(d.role)) {
        const role = String(d.role) === 'mentor' ? 'my teacher' : String(d.role);
        parts.push(`${n}, ${/^(?:the|a|an|my|her|his|our)\b/i.test(role) ? role : `the ${role}`}.`);
      }
      if (told.length) parts.push(`${told.length > 1 ? 'What I know: ' : ''}${told.slice(-2).join(' ')}`);
      else if (d.lore) parts.push(firstPerson(d.lore, mind.name));
      if (d.opinion) parts.push(shorten(d.opinion, 160));
      if (parts.length) return clipSentences(toListener(parts.join(' ')), 380);
    }
  }
  for (const id of Object.keys(CLOSED_PEOPLE)) {
    if (new RegExp(`\\b${id}\\b`, 'i').test(q)) {
      const closed = closedAbout(mind, id);
      if (closed) return closed;
    }
  }
  const look = mind.loreLookup(q);
  if (!look.entries.length && !look.questions.length) return pick(["Not much, honestly. Somebody in this valley will know; I could ask around.", "Less than I'd like. Ask me again once I've asked around."], ctx.game?.rng);
  const parts = [];
  // What she knows by that very name comes first (her own memory of the Weeping Cut before
  // the history of it); then one answer, and a second only when the first is short.
  const key = (t) => String(t || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/^(?:the|a|an) /, '').replace(/\s+/g, ' ').trim();
  const qk = key(q);
  // The valley's history is told in the present tense of a chronicle; what she knows of the
  // thing itself comes first.
  // A chronicle line about her ("eleven-year-old Lyra lights...") comes after her own memory.
  const entryOf = (e) => (e.loreId && e.kind !== 'life' ? mind.lorebook?.get?.(e.loreId) : null);
  const chronicle = (e) => {
    const le = entryOf(e);
    if (le?.kind !== 'timeline') return 0;
    return new RegExp(`\\b${mind.name || 'Lyra'}\\b`).test(e.text) ? 3 : 0.5;
  };
  const rank = (e) => chronicle(e) + rankOf(e);
  const rankOf = (e) => {
    const k = key(e.subject).replace(/^(?:the|a|an) /, '');
    const life = e.kind === 'life';
    // Named by one of its aliases ("moonpetals" is Greenwit's): as good as its title.
    if (!life && (entryOf(e)?.aliases || []).some((a) => key(a).replace(/s$/, '') === qk.replace(/s$/, ''))) return 1;
    if (k && k === qk) return life ? (define ? 2.5 : 0) : 1;
    if (k && qk.length >= 4 && k.includes(qk)) return life ? 3 : 2;
    return 4;
  };
  const entries = look.entries.map((e, i) => ({ e, r: rank(e), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e);
  const shown = entries[0] && entries[0].text.length < 140 ? entries.slice(0, 2) : entries.slice(0, 1);
  for (const e of shown) {
    const life = e.kind === 'life' ? (mind.life || []).find((l) => l.id === e.loreId) : null;
    const said = life ? lifeText(mind, life.id, e.text) : e.text;
    // Her life memories with the stranger in them, and the lore of the stranger itself, speak
    // of the player as "they": told to the player, that is "you".
    const aboutPlayer = life ? aboutPlayerOnly(life) : (entryOf(e)?.tags || []).includes('player');
    const text = toListener(firstPerson(clipSentences(said, shown.length > 1 ? 200 : 300), mind.name), { aboutPlayer });
    if (e.kind === 'theory') parts.push(`I think ${lowerFirst(text.replace(/[.!]+$/, ''))}, but I can't prove it.`);
    else if (e.kind === 'rumor') parts.push(`I've heard ${lowerFirst(text.replace(/[.!]+$/, ''))}. Only a rumor.`);
    else if (e.source === 'told' && e.from) parts.push(`${firstName(mind.relationships.get(e.from)?.name || e.from)} told me ${lowerFirst(text)}`);
    else parts.push(text);
  }
  // The open question she keeps coming back to, when it is about what was asked.
  const qn = look.questions.find((x) => [x.question, ...(x.clues || [])].some((t) => key(t).includes(qk)));
  if (qn) parts.push(`And I keep coming back to one question: ${toListener(lowerFirst(String(qn.question).replace(new RegExp(`^Is ${mind.name || 'Lyra'}\\b`), 'am I')))}`);
  return shorten(parts.join(' '), 460);
}
