import { hasRumor, rumorFor } from '../world/boss_trails.js';
import { ASK_TOPICS } from './npc_data.js';
import { factTellable } from './npc_data_more.js';
import { GONE_STAYS, UNEASY_LINES } from './npc_lines.js';
import { placePhrase } from '../ai/village_life/errands_data.js';
import { itemName } from './items.js';
import { pickLine, now, rand } from './creature_util.js';
import { hasKeptFlame, flamePrice, lightKeptFlame } from '../survival/kept_flame.js';
import { lyraOf } from '../core/people.js';
import { isMerchant, stance as tradeStance } from '../world/trade.js';

// Villager dialogue: what they say when the player walks up, the options they offer,
// what they answer, how they take gifts. Pure functions over an NPC (npc.js wires
// them to its methods) so the tone rules can be tested without a world.
//
// Tone, most urgent first:
//   afraid   the player is wanted right now and close: they want them gone
//   wronged  the player hit or knocked out this villager today
//   cold     the player hurt someone in the village today (word travels)
//   shaken   knocked out today (by anyone): short, tired answers
//   sleepy   woken up
//   warm / normal / wary   by opinion

const OPEN_DIALOGUE_SECONDS = 10;
// Friendship takes days, not one long conversation: what chatting, asking and gifts add
// to a villager's familiarity with the player is capped per day, so the secrets kept for
// friends (LORE §9.10) cannot be had by clicking through every question at once.
const FAMILIARITY_PER_DAY = 12;

export function befriend(npc, n) {
  const day = npc.game?.clock?.day ?? 1;
  if (npc.famDay !== day) {
    npc.famDay = day;
    npc.famToday = 0;
  }
  const k = Math.max(0, Math.min(n, FAMILIARITY_PER_DAY - (npc.famToday || 0)));
  npc.famToday = (npc.famToday || 0) + k;
  npc.familiarity = Math.min(100, (npc.familiarity || 0) + k);
  return k;
}

export function firstName(npc) {
  const parts = String(npc?.name || '').replace(/"[^"]*"\s*/g, '').trim().split(/\s+/);
  if (!parts[0]) return 'them';
  if ((parts[0] === 'Captain' || parts[0] === 'Sister') && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

export function dialogueTone(npc, player) {
  const g = npc.game;
  const day = g.clock?.day ?? 1;
  if (npc.isWantedNear?.(player)) return 'afraid';
  // A known killer (DESIGN §29): the frightened back away; the rest are hurt and cold.
  const mt = g.murder?.toneFor?.(npc);
  if (mt) return mt;
  if (npc.wrongedDay === day) return 'wronged';
  if (npc.coldDay === day) return 'cold';
  if (npc.shakenDay === day) return 'shaken';
  if (npc.state === 'sleep' || npc.activity === 'sleep') return 'sleepy';
  const o = npc.opinionOfPlayer;
  if (o >= 70) return 'warm';
  if (o < 20) return 'wary';
  return 'normal';
}

function timeKey(g) {
  const w = g.clock?.weather;
  if (w && w.type === 'rain' && (w.intensity ?? 1) > 0.25) return 'rain';
  const h = g.clock?.hour ?? 12;
  if (g.clock?.isNight || h >= 20 || h < 5) return 'night';
  return 'day';
}

function line(npc, list, fallback) {
  return pickLine(npc.game, list, npc._lastLine) || fallback;
}

export function greetingFor(npc, player, tone = dialogueTone(npc, player)) {
  const p = npc.profile;
  switch (tone) {
    case 'afraid':
      return line(npc, p.crime, 'Stay away from me!');
    case 'wronged':
      return line(npc, p.wronged || p.cold, 'Leave me alone.');
    case 'cold':
      return line(npc, p.cold, '...What do you want?');
    case 'shaken':
      return line(npc, p.shaken, 'Not today.');
    case 'sleepy':
      return line(npc, p.sleepy, 'Mmh...?');
    default:
      return uneasyLine(npc) || line(npc, p.greetings, 'Hello.');
  }
}

// Heard a cry today and never saw what it was (DESIGN §29.4): it is on their mind. Of a
// place, never of a person.
function uneasyLine(npc) {
  const u = npc.uneasy;
  const g = npc.game;
  if (!u || u.day !== (g?.clock?.day ?? 1) || rand(g) >= 0.5) return null;
  const phrase = u.place ? placePhrase(u.place, g?.locations?.get?.(u.place)?.name || '') : '';
  const l = pickLine(g, phrase ? UNEASY_LINES.place : UNEASY_LINES.nowhere);
  return l ? l.replace(/\{place\}/g, phrase) : null;
}

// Lines about Lyra when she is living apart from the player, has left them, or is gone.
export function aboutLyraLine(npc) {
  const st = npc.lyraState?.() || 'together';
  const lists = npc.profile.aboutLyra;
  if (!lists || st === 'together' || st === 'wary') return null;
  if (st === 'gone' && GONE_STAYS[npc.profile.id]) return pickLine(npc.game, GONE_STAYS[npc.profile.id]);
  return pickLine(npc.game, lists[st] || lists.apart);
}

// Family and close friends say how she is even while she travels with the player.
function nearLyraLine(npc) {
  const st = npc.lyraState?.() || 'together';
  const lists = npc.profile.aboutLyra;
  if (!lists || (st !== 'together' && st !== 'wary')) return null;
  return pickLine(npc.game, lists[st] || lists.together);
}

export function mainOptions(npc, player, tone = dialogueTone(npc, player)) {
  const p = npc.profile;
  if (tone === 'afraid') return [{ id: 'bye', label: 'Back away' }];
  const opts = [{ id: 'talk', label: tone === 'sleepy' ? "Sorry, I'll let you sleep" : 'Chat' }];
  if (tone === 'sleepy') return [opts[0], { id: 'bye', label: 'Goodbye' }];
  // Missions (DESIGN §22.3): "Need a hand?", a talk step, a turn-in. Not from someone the
  // player hurt or frightened today.
  if (tone === 'normal' || tone === 'warm' || tone === 'wary') {
    let mo = [];
    try {
      mo = npc.game?.missions?.npcOptions?.(npc) || [];
    } catch {
      mo = [];
    }
    opts.push(...mo);
  }
  opts.push({ id: 'ask', label: 'Ask about…' });
  // What is out there (DESIGN §32.4): a boss they know of goes on your map, else the roads.
  if (hasRumor(p.id) && tone !== 'wronged' && tone !== 'cold') opts.push({ id: 'rumor', label: 'Heard anything out there?' });
  opts.push({ id: 'gift', label: 'Give a gift' });
  // The four merchants and any shop (round 14b, S-17: src/world/trade.js); a refusal is said
  // when it is chosen, never a missing option.
  if (isMerchant(npc)) opts.push({ id: 'shop', label: p.id === 'elda' ? 'Food and drink' : 'Trade' });
  // The kept flame (DESIGN §27): Sister Aveline relights the stranger's family flame.
  if (p.id === 'aveline' && tone !== 'wronged') opts.push({ id: 'flame', label: hasKeptFlame(npc.game) ? 'Your flame on the altar' : 'Ask about a kept flame' });
  const owed = Number(npc.game?.flags?.miraOwed) || 0;
  if (p.id === 'mira' && owed > 0) opts.push({ id: 'pay_mira', label: `Pay what you owe (${owed})` });
  // Stats and gear (DESIGN §26): Bram's forge; the chapel's quiet hour to start over.
  if (p.id === 'bram' && npc.game?.gear && tone !== 'wronged' && tone !== 'cold') opts.push({ id: 'forge', label: 'The forge' });
  if (p.id === 'aveline' && npc.game?.progression?.spent?.() > 0 && tone !== 'wronged') opts.push({ id: 'respec', label: 'Ask to start over' });
  opts.push({ id: 'bye', label: 'Goodbye' });
  return opts;
}

// Aveline's rite: what a kept flame is, its price, and lighting it. One at a time.
function flameRite(npc, key, player, opts) {
  const g = npc.game;
  const price = flamePrice(g);
  // The Moot put the stranger's flame out (DESIGN §29): not relit for a long while.
  if (g.murder?.flameBarred?.()) return { lines: ['The Moot put your flame out, child, and I will not light it again. Not yet. Perhaps not ever.'], options: opts.filter((o) => o.id !== 'flame') };
  if (hasKeptFlame(g)) {
    return {
      lines: ['It burns, child. Third from the left, beside the Wayhouse road-candle. I trim it myself.', 'If the dark takes you before your time, it will bring you back to this chapel at dawn — once. Then it is spent, and you must ask again.'],
      options: opts,
    };
  }
  if (key === 'flame:light') {
    const r = lightKeptFlame(g, player);
    if (!r.ok && r.reason === 'coin') return { lines: [`The wax is Hobb's and the rite is old, and both cost ${price} coin. You have ${r.coins ?? 0}. Come back when you can; I will be here.`], options: opts };
    if (!r.ok) return { lines: ['Not now, child.'], options: opts };
    try {
      g.particles?.emit?.('sparkle', npc.x, npc.y - 18, { count: 10, color: '#ffe08a', speed: 18, life: 0.9 });
      g.audio?.play?.('heal', { x: npc.x, y: npc.y, pitch: 0.8 });
      g.ui?.toast?.(`A kept flame burns for you on the chapel altar. If you die, it brings you back once. (${price} coins)`, 'good', { key: 'flame', title: 'The kept flame' });
    } catch {
      /* cosmetic */
    }
    return {
      lines: ['Hold out your hand. Closer. There.', 'I lit it from the road-candle, the one that leaned toward you the night they carried you in. It will burn for you now.', 'One flame, one return. Try not to need it.'],
      options: opts,
    };
  }
  return {
    lines: [
      'Every household keeps a flame on this altar, child. It holds the ward up, and it holds them.',
      'For you I can do a little more: a flame kept in your name, lit from the road-candle. If the dark takes you before your time, it brings you back here at dawn. Once. Then it is spent.',
      `The wax is Hobb's and the rite is old. ${price} coin. Without it, if you fall and nobody reaches you, there is no coming back.`,
    ],
    options: [
      { id: 'flame:light', label: `Light it (${price} coins)` },
      { id: 'back', label: 'Not today' },
    ],
  };
}

// The chapel's quiet hour (DESIGN §26): the points a life has spent, given back to spend
// again, for the price of the candles.
function quietHour(npc, key, player, opts) {
  const g = npc.game;
  const pr = g?.progression;
  if (!pr) return { lines: ['Not now, child.'], options: opts };
  const cost = pr.respecCost();
  if (key === 'respec:yes') {
    const r = pr.respec();
    if (!r.ok) return { lines: [r.cost ? `The candles are Hobb's, child, and they cost ${cost} coin. Come back when you can.` : 'There is nothing to undo, child.'], options: opts };
    try {
      g.audio?.play?.('heal', { x: npc.x, y: npc.y, pitch: 0.7 });
      g.ui?.toast?.(`Your points are yours to spend again (${cost} coins). Open your character sheet (C).`, 'good');
    } catch {
      /* cosmetic */
    }
    return { lines: ['Sit. Breathe. Let what you made of yourself go quiet for a while.', 'There. You are still you. Only the choices are open again.'], options: opts.filter((o) => o.id !== 'respec') };
  }
  return {
    lines: ['Start over? Not your life, child — only what you have made of your hands and your heart since you came.', `An hour in the quiet, and the candles burning. ${cost} coin. Afterwards you choose again.`],
    options: [
      { id: 'respec:yes', label: `Sit the quiet hour (${cost} coins)` },
      { id: 'back', label: 'Not today' },
    ],
  };
}

// Paying Mira back for the tending you could not pay for at the time.
function payMira(npc, player, opts) {
  const g = npc.game;
  const owed = Number(g.flags?.miraOwed) || 0;
  const have = player?.inventory?.count?.('coin') ?? 0;
  const pay = Math.min(owed, have);
  if (pay <= 0) return { lines: ["Oh — no, not now. When you can. Really. Sorry."], options: opts };
  player.inventory.remove('coin', pay);
  g.flags.miraOwed = owed - pay;
  npc.adjustOpinion?.(3, 'paid her back');
  return { lines: [pay < owed ? `Oh! Thank you. That's ${pay}. The rest whenever. Sorry.` : "Oh! You didn't have to — thank you. We're square. Sorry. Good."], options: mainOptions(npc, player) };
}

// Topics this villager can speak to: the shared list, filtered to ones they have
// something for (facts, or an opinion of the person asked about).
export function topicOptions(npc) {
  const p = npc.profile;
  const out = [];
  for (const t of ASK_TOPICS) {
    const has = p.facts.some((f) => t.factTopics.includes(f.topic)) || (t.id === 'lyra' && p.knows?.lyra) || (t.id === 'maren' && p.knows?.maren) || (t.id === 'people' && p.knows);
    if (has) out.push({ id: `ask:${t.id}`, label: t.label });
  }
  out.push({ id: '__back', label: 'Never mind' });
  return out;
}

export function getDialogue(npc, player) {
  const g = npc.game;
  npc.talkingUntil = now(g) + OPEN_DIALOGUE_SECONDS;
  const tone = dialogueTone(npc, player);
  const lines = [greetingFor(npc, player, tone)];
  if (tone !== 'afraid' && tone !== 'sleepy') {
    const about = aboutLyraLine(npc);
    const day = g.clock?.day ?? 1;
    if (about && npc._aboutLyraDay !== day) {
      npc._aboutLyraDay = day;
      lines.push(about);
    }
  }
  npc._lastLine = lines[0];
  return { lines, options: mainOptions(npc, player, tone) };
}

export function chooseOption(npc, id, player) {
  const g = npc.game;
  npc.talkingUntil = now(g) + OPEN_DIALOGUE_SECONDS;
  const p = npc.profile;
  const tone = dialogueTone(npc, player);
  const opts = mainOptions(npc, player, tone);
  const key = String(id || '');
  if (key === 'bye' || key === 'goodbye') {
    npc.talkingUntil = now(g) + 1;
    const l = tone === 'afraid' || tone === 'wronged' || tone === 'cold' ? null : line(npc, p.farewells, 'Take care.');
    return { lines: l ? [l] : [], close: true };
  }
  if (key === '__back' || key === 'back') return { lines: ['Anything else?'], options: opts };
  if (key.startsWith('mission:')) {
    let r = null;
    try {
      r = g.missions?.npcChoose?.(npc, key);
    } catch (err) {
      console.error('[npc] mission option failed', err);
    }
    return { lines: r?.lines?.length ? r.lines : ['…'], options: r?.options || mainOptions(npc, player, dialogueTone(npc, player)) };
  }
  if (tone === 'afraid') return { lines: [line(npc, p.crime, 'Get away from me!')], options: opts };
  if (key === 'talk') return { lines: talkLines(npc, player, tone), options: opts };
  if (key === 'ask') {
    if (tone === 'wronged' || tone === 'sleepy') return { lines: [greetingFor(npc, player, tone)], options: opts };
    return { lines: [line(npc, p.askPrompt, 'What do you want to know?')], options: topicOptions(npc) };
  }
  if (key.startsWith('ask:')) {
    const r = answerTopic(npc, key.slice(4), player);
    return { lines: r.lines, options: topicOptions(npc) };
  }
  if (key === 'gift') {
    if (tone === 'wronged') return { lines: [line(npc, p.wronged, "I don't want anything from you.")], options: opts };
    return { lines: [p.id === 'pip' ? 'For me? Is it a treasure?' : tone === 'cold' ? "...What is it?" : 'Oh? For me?'], open: 'gift', options: opts };
  }
  if (key === 'rumor') {
    const r = rumorFor(g, p.id);
    return { lines: r?.lines?.length ? r.lines : ['Nothing new. Ask me again in a day or two.'], options: opts };
  }
  if (key === 'flame' || key.startsWith('flame:')) return flameRite(npc, key, player, opts);
  if (key === 'pay_mira') return payMira(npc, player, opts);
  if (key === 'forge') {
    if (refusesTrade(npc, player)) return { lines: [line(npc, p.refuse?.length ? p.refuse : p.cold, 'Not today.')], options: opts.filter((o) => o.id !== 'forge') };
    return { lines: [tone === 'warm' ? 'Show me. Hmph. Good steel, bad edge. Leave it.' : 'Ore. Crystal. Coin. Then we talk.'], open: 'forge', options: opts };
  }
  if (key === 'respec' || key === 'respec:yes') return quietHour(npc, key, player, opts);
  if (key === 'shop') {
    if (!isMerchant(npc)) return { lines: ["I've nothing to sell, I'm afraid."], options: opts };
    if (refusesTrade(npc, player)) return { lines: [refuseLine(npc)], options: opts };
    return { lines: [shopLine(npc, tone)], open: 'shop', options: opts };
  }
  return { lines: ['…'], options: opts };
}

// Their refusal, in their own words, by why (round 14b: a refusal is always their line).
function refuseLine(npc) {
  const g = npc.game;
  const p = npc.profile;
  const why = tradeStance(g, npc).why;
  if (why === 'kin') return 'You killed one of mine. You will never buy so much as a crust from me. Get out.';
  if (why === 'butcher') return pickLine(g, ['I know what they call you. No. Not for any coin.', 'Butcher. Get out of my door.']) || 'No.';
  if (why === 'suspect') return 'Not while the watch is asking about you. Not today.';
  if (why === 'fresh') return pickLine(g, ['With blood still on your hands? Not today. Maybe not ever.', 'I know what you did. Get out of my shop.']) || 'No.';
  return line(npc, p.refuse?.length ? p.refuse : p.cold, 'Not today.');
}

function shopLine(npc, tone) {
  const p = npc.profile;
  if (tone === 'cold') return "Coin first. And make it quick.";
  switch (p.id) {
    case 'bram':
      return 'Steel, or ore to sell. Hmph. Pick.';
    case 'elda':
      return "Bread's fresh, stew's hot, and the honey cakes won't last, love.";
    case 'garrick':
      return 'Feast your eyes, my friend! Everything priced to move. Mostly.';
    case 'hobb':
      return "Candles from Wenna's wax, and a lantern or two. Well now. Mind the drips.";
    case 'wenna':
      return "Linden honey. Last pull before the hives are wrapped. Don't haggle; I can hear you thinking it.";
    case 'hess':
      return 'Venison. Pelts. I buy tusk and antler. Mm.';
    case 'sabeth':
      return "Cloaks, and I'll take dye-plants in trade. Hold still while you look; you've a thread loose.";
    case 'tansy':
      return "Eggs. Three coppers. Don't tell Duchess.";
    case 'corran':
      return "Fish this morning's, eel from the shed. Hm-hmm. I'll buy what you catch, too.";
    case 'mira':
      return "Potions, tonics, salves. Sorry, the bark one is bitter. It works, though. And I'll buy herbs, if you've any.";
    default:
      return 'Take a look.';
  }
}

function talkLines(npc, player, tone) {
  const g = npc.game;
  const p = npc.profile;
  const out = [];
  if (tone === 'sleepy') {
    out.push(line(npc, p.sleepy, 'Zzz...'));
    return out;
  }
  if (tone === 'wronged' || tone === 'cold' || tone === 'shaken') {
    out.push(greetingFor(npc, player, tone));
    return out;
  }
  const k = timeKey(g);
  out.push(line(npc, p.lines?.[k] || p.lines?.day, 'Lovely weather.'));
  // Now and then, a word about a neighbor.
  const knows = p.knows || {};
  const ids = Object.keys(knows).filter((id) => id !== 'maren');
  if (ids.length && rand(g) < 0.35) {
    const id = ids[Math.floor(rand(g) * ids.length)];
    const who = g.entities?.get?.(id);
    const name = id === 'lyra' ? lyraOf(g)?.name || 'Lyra' : who ? firstName(who) : id.charAt(0).toUpperCase() + id.slice(1);
    out.push(`${name}? ${knows[id]}`);
  }
  npc._lastLine = out[0];
  const day = g.clock?.day ?? 1;
  if (npc.talkDay !== day) {
    npc.talkDay = day;
    npc.talkFamToday = 0;
    npc.adjustOpinion?.(1, 'chat');
  }
  if ((npc.talkFamToday || 0) < 8) {
    npc.talkFamToday = (npc.talkFamToday || 0) + 3;
    befriend(npc, 3);
  }
  return out;
}

// How much this villager is willing to share: familiarity, softened by liking.
export function shareLevel(npc) {
  const o = npc.opinionOfPlayer;
  return (npc.familiarity || 0) + (o >= 70 ? 15 : o >= 50 ? 6 : o < 20 ? -20 : 0);
}

// Answer a question about a topic: the next untold fact the player has earned.
export function answerTopic(npc, topicId, player) {
  const g = npc.game;
  const p = npc.profile;
  const t = ASK_TOPICS.find((x) => x.id === topicId) || { id: topicId, factTopics: [topicId] };
  try {
    g.bus?.emit('npc_topic', { npc, topic: t.id, player: player || g.player || null });
  } catch {
    /* listeners must not break the conversation */
  }
  befriend(npc, 2);
  const lines = [];
  if (t.id === 'lyra') {
    const about = aboutLyraLine(npc) || nearLyraLine(npc);
    if (about) lines.push(about);
  }
  const level = shareLevel(npc);
  // LORE §9.10: some truths are not told to the player until the story reveals them.
  const pool = p.facts.filter((f) => t.factTopics.includes(f.topic) && factTellable(f, 'player', g.flags));
  const next = pool.find((f) => !npc.told.has(f.id) && f.minFamiliarity <= level);
  if (next) {
    npc.told.add(next.id);
    lines.push(next.say || next.text);
    return { lines, fact: next };
  }
  const locked = pool.some((f) => !npc.told.has(f.id) && f.minFamiliarity > level);
  if (t.id === 'people' && p.knows) {
    const ids = Object.keys(p.knows).filter((id) => id !== 'lyra' && id !== 'maren');
    if (ids.length) {
      const id = ids[(npc._peopleIdx = ((npc._peopleIdx ?? -1) + 1) % ids.length)];
      const who = g.entities?.get?.(id);
      lines.push(`${who ? firstName(who) : id.charAt(0).toUpperCase() + id.slice(1)}? ${p.knows[id]}`);
      return { lines, fact: null };
    }
  }
  const opinion = t.id === 'lyra' ? p.knows?.lyra : t.id === 'maren' ? p.knows?.maren : null;
  if (opinion && !lines.length) lines.push(opinion);
  else if (opinion && rand(g) < 0.5) lines.push(opinion);
  lines.push(line(npc, locked ? p.notYet : p.noMore, locked ? 'Ask me again some other time.' : "That's all I know."));
  return { lines, fact: null };
}

// Shops turn away someone who hurt people here today.
export function refusesTrade(npc, player) {
  const g = npc.game;
  const day = g.clock?.day ?? 1;
  if (!isMerchant(npc)) return true;
  // What they know of the stranger's killings, graded (round 14b, S-19: src/world/trade.js
  // stance): kin refuse, others charge a blood price, after the Butcher all refuse but a
  // fence. Not to someone the family believes did it (DESIGN §29).
  if (tradeStance(g, npc).refuse) return true;
  // Only what this shopkeeper knows: a wanted stranger, a crime today they saw or were told
  // of (DESIGN §29.4: the news travels by meeting, not on the wind).
  const knows = npc.knowsWanted ? npc.knowsWanted(player) : npc.crimeActive?.();
  if (npc.isWantedNear?.(player) || knows) return true;
  if (npc.wrongedDay === day) return true;
  const rec = npc.crimeToday?.();
  if (!rec || (npc.knowsCrimeToday && !npc.knowsCrimeToday())) return false;
  if (rec.knockouts > 0) return true;
  return npc.opinionOfPlayer < 45;
}

// The UI already took the item. Returns { lines, liked: -1 | 0 | 1 }.
export function receiveGift(npc, itemId, giver) {
  const g = npc.game;
  const p = npc.profile;
  const liked = p.likes?.includes(itemId) ? 1 : p.dislikes?.includes(itemId) ? -1 : 0;
  const fromPlayer = !giver || giver === g.player || giver.id === 'player';
  const day = g.clock?.day ?? 1;
  const tone = fromPlayer ? dialogueTone(npc, g.player) : 'normal';
  let text;
  if (fromPlayer && (tone === 'wronged' || tone === 'cold' || tone === 'afraid')) {
    text = liked > 0 ? "...Thank you. It doesn't undo what happened." : "...Fine. Leave it there.";
  } else {
    const list = liked > 0 ? p.gift?.liked : liked < 0 ? p.gift?.disliked : p.gift?.neutral;
    text = pickLine(g, list) || (liked > 0 ? 'Oh, thank you!' : liked < 0 ? 'Oh. Um. Thanks.' : 'Thank you.');
  }
  if (fromPlayer) {
    if (npc.giftDay !== day) {
      npc.giftDay = day;
      npc.giftsToday = 0;
    }
    // The first gift of the day means the most.
    const k = npc.giftsToday === 0 ? 1 : npc.giftsToday === 1 ? 0.5 : 0.2;
    npc.giftsToday++;
    const base = liked > 0 ? 8 : liked < 0 ? -4 : 2;
    const soured = tone === 'wronged' || tone === 'cold' || tone === 'afraid';
    npc.adjustOpinion?.(Math.round(base * k * (soured && base > 0 ? 0.5 : 1)), `gift ${itemId}`);
    befriend(npc, liked > 0 ? 6 : 3);
  } else if (giver) {
    // Lyra (or someone else) handing things over: say it aloud for everyone to hear.
    const who = giver.name ? String(giver.name).split(' ')[0] : '';
    npc.say?.(who && liked >= 0 ? `${text.replace(/[.!]$/, '')}, ${who}!` : text, { target: giver });
  }
  npc._lastGift = { itemId, liked, day, from: giver?.id ?? 'player', name: itemName(itemId) };
  return { lines: [text], liked };
}
