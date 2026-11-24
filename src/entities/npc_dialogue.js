import { ASK_TOPICS } from './npc_data.js';
import { factTellable } from './npc_data_more.js';
import { itemName } from './items.js';
import { pickLine, now, rand } from './creature_util.js';

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
      return line(npc, p.greetings, 'Hello.');
  }
}

// Lines about Lyra when she is living apart from the player, has left them, or is gone.
export function aboutLyraLine(npc) {
  const st = npc.lyraState?.() || 'together';
  const lists = npc.profile.aboutLyra;
  if (!lists || st === 'together' || st === 'wary') return null;
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
  opts.push({ id: 'ask', label: 'Ask about…' });
  opts.push({ id: 'gift', label: 'Give a gift' });
  if (p.shop && (p.shop.sells?.length || Object.keys(p.shop.buys || {}).length)) opts.push({ id: 'shop', label: p.id === 'elda' ? 'Food and drink' : 'Trade' });
  opts.push({ id: 'bye', label: 'Goodbye' });
  return opts;
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
  if (key === 'shop') {
    if (!p.shop) return { lines: ["I've nothing to sell, I'm afraid."], options: opts };
    if (refusesTrade(npc, player)) return { lines: [line(npc, p.refuse?.length ? p.refuse : p.cold, 'Not today.')], options: opts.filter((o) => o.id !== 'shop') };
    return { lines: [shopLine(npc, tone)], open: 'shop', options: opts };
  }
  return { lines: ['…'], options: opts };
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
    const name = id === 'lyra' ? g.companion?.name || 'Lyra' : who ? firstName(who) : id.charAt(0).toUpperCase() + id.slice(1);
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
    npc.familiarity = Math.min(100, (npc.familiarity || 0) + 3);
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
  npc.familiarity = Math.min(100, (npc.familiarity || 0) + 2);
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
  if (!npc.profile.shop) return true;
  if (npc.isWantedNear?.(player) || npc.crimeActive?.()) return true;
  if (npc.wrongedDay === day) return true;
  const rec = npc.crimeToday?.();
  if (!rec) return false;
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
    npc.familiarity = Math.min(100, (npc.familiarity || 0) + (liked > 0 ? 6 : 3));
  } else if (giver) {
    // Lyra (or someone else) handing things over: say it aloud for everyone to hear.
    const who = giver.name ? String(giver.name).split(' ')[0] : '';
    npc.say?.(who && liked >= 0 ? `${text.replace(/[.!]$/, '')}, ${who}!` : text, { target: giver });
  }
  npc._lastGift = { itemId, liked, day, from: giver?.id ?? 'player', name: itemName(itemId) };
  return { lines: [text], liked };
}
