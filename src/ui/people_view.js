// People (round 14b, DESIGN §34.5; the author: "edit that thing about Lyra's … you and her
// … how people sees you … Something I can see … Memories and knowledge and her life and
// diary. Some of them, yes, I want to see, and some of them I shouldn't be able to see.
// Soul, I shouldn't be able to edit souls."). Pure view-models, no DOM, unit-tested.
//
//   peopleList(game)            [{ id, name, kind: 'you'|'lyra'|'villager', portraitKey, age,
//                                 stage, holder, dead, sub }] You first, then Lyra (first
//                                 while she matters most, or as a memorial), the one who walks
//                                 with you, then everyone you have met
//   privacyOf(entry, ctx)       'visible' | 'private' (private by default):
//                                 memory    visible when it is about you AND she shared or cited it
//                                 secret    visible once told AND the bond reached revealAtBond
//                                 knowledge visible when you told her, someone told her, or it
//                                           is old lore; her theories and rumours stay hers
//                                 diary     visible once you read it (the morning page)
//   youPage(game)               how Hearthvale sees you: talk, each villager's view, titles
//   lyraPage(game, ctx)         you and her, how she sees you, her life, what she shares,
//                               what she keeps (counted), diary pages, "who she is" (read
//                               only), a memorial once she is dead
//   villagerPage(game, npc)     you and them, how they see you, their life
//   PEOPLE_SECTIONS             the page's sections (no Soul and no Data: nobody's soul is
//                               yours to edit)
//
// Left or gone, Lyra does not confide (item 4): nothing new becomes shared, no page pops up;
// what she shared before stays visible.

import { lyraOf, ageOf, lifeStage } from '../core/people.js';
import { holderOf, lyraDead, lyraCompanionship } from '../core/party.js';
import { companionshipLabel, companionshipBlurb, companionshipTone, playerRelation, trustWords, fearWords, ledgerEntries, ledgerViews, ledgerTally, promiseEntries, promiseViews, lifeTimeline, farewellText, knowledgeEntries, knowledgeKind, sourceLabel } from './lyra_view.js';
import { opinionLevel, rumorsAboutPlayer, villageFeeling, villagerRoster, firstName } from './village_view.js';
import { listFrom, truncate } from './format.js';

export const PEOPLE_SECTIONS = Object.freeze(['between', 'sees', 'life', 'shared', 'diary', 'who']);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function lyraName(game) {
  const L = lyraOf(game);
  return game?.settings?.companionName || L?.name || 'Lyra';
}

function isDeadPerson(game, e) {
  if (!e) return false;
  if (e.id === 'lyra') return lyraDead(game);
  return !!safe(() => game?.murder?.isDead?.(e.id), false) || (!!e.absent && /killed|died|dead|age|unkindled/.test(String(e.absent?.cause || '')));
}

// Has the player met this villager? (spoken with them, been told something, given a gift,
// or they hold the role now)
export function hasMet(game, npc) {
  if (!npc) return false;
  if (holderOf(game) === npc) return true;
  if (num(npc.familiarity) > 0 || npc.walkedWithPlayer) return true;
  if (npc.told?.size > 0) return true;
  if (npc.talkDay > 0 || npc.giftDay > 0 || npc._lastGift) return true;
  const talks = safe(() => game.village?.talks?.[npc.id], null);
  return Array.isArray(talks) ? talks.length > 0 : !!talks;
}

function villagers(game) {
  const list = safe(() => game.entities?.all?.(), []) || [];
  return list.filter((e) => e && e.profile && e.id !== 'lyra' && e.id !== 'player');
}

export function peopleList(game) {
  const out = [{ id: 'you', name: 'You', kind: 'you', portraitKey: 'player', age: null, stage: null, holder: false, dead: false, sub: 'How Hearthvale sees you' }];
  const L = lyraOf(game);
  const h = holderOf(game);
  if (L) {
    const dead = lyraDead(game);
    const cs = lyraCompanionship(game);
    out.push({ id: 'lyra', name: lyraName(game), kind: 'lyra', portraitKey: 'lyra', age: ageOf(game, L), stage: lifeStage(game, L), holder: h === L, dead, sub: dead ? 'In memory' : h === L ? 'Walks with you' : companionshipLabel(cs) });
  }
  const met = villagers(game).filter((v) => v === h || hasMet(game, v));
  met.sort((a, b) => (b === h) - (a === h) || num(b.familiarity) - num(a.familiarity) || String(a.name).localeCompare(String(b.name)));
  for (const v of met) {
    const dead = isDeadPerson(game, v);
    const lvl = opinionLevel(num(v.opinionOfPlayer, 30));
    out.push({ id: v.id, name: firstName(v.name), kind: 'villager', portraitKey: v.spriteKey || v.id, age: ageOf(game, v), stage: lifeStage(game, v), holder: v === h, dead, sub: dead ? 'In memory' : v === h ? 'Walks with you' : lvl?.label || '' });
  }
  return out;
}

// ---------- privacy ----------

// ctx: { shared: Set(ids or texts), cited: Set, read: Set(days), bond: number, told: Set(indices),
//        confides: bool (Lyra together, wary or apart) }
export function privacyOf(entry, ctx = {}) {
  if (!entry || typeof entry !== 'object') return 'private';
  const kind = entry.kind || 'memory';
  if (kind === 'diary') return ctx.read?.has?.(num(entry.day, -1)) ? 'visible' : 'private';
  if (kind === 'secret') {
    const told = ctx.told?.has?.(entry.index);
    return told && num(ctx.bond, 0) >= num(entry.revealAtBond, 9) ? 'visible' : 'private';
  }
  if (kind === 'knowledge') {
    const k = entry.entry || entry;
    const src = String(k.source || '');
    const kk = knowledgeKind(k);
    if (kk === 'theory' || kk === 'rumor') return 'private';
    if (src === 'player' || src === 'told' || kk === 'lore' || src === 'lore') return 'visible';
    return 'private';
  }
  // A memory: about you, and shared or cited.
  const m = entry.entry || entry;
  const about = Array.isArray(m.about) ? m.about : [];
  if (!about.includes('player')) return 'private';
  const id = m.id != null ? String(m.id) : null;
  const text = String(m.text || '');
  const hit = (set) => !!set && ((id && set.has(id)) || (text && set.has(text)));
  return hit(ctx.shared) || hit(ctx.cited) ? 'visible' : 'private';
}

// What the player has been shown of Lyra's mind: shared ids, the chat's cited memories, the
// pages read, the secrets told, her bond.
export function lyraContext(game, ui = null) {
  const L = lyraOf(game);
  const mind = L?.mind;
  const shared = new Set([...(mind?.shared || [])].map(String));
  const cs0 = lyraCompanionship(game);
  const confiding = cs0 !== 'left' && cs0 !== 'gone' && !lyraDead(game);
  const cited = new Set();
  for (const m of safe(() => ui?.chat?.messages, []) || []) {
    for (const r of m?.memories || []) {
      if (r?.id != null) cited.add(String(r.id));
      if (r?.text) cited.add(String(r.text));
      // What she cited while she still confided is shared for good (saved with her mind).
      if (confiding && r?.id != null && mind?.shared instanceof Set) mind.shared.add(String(r.id));
    }
  }
  const read = new Set((Array.isArray(game?.flags?.diary_read) ? game.flags.diary_read : []).map(Number));
  const told = new Set(Array.isArray(mind?.secretsRevealed) ? mind.secretsRevealed : []);
  const bond = num(safe(() => mind?.relationships?.bond?.('player')?.level, 0), 0);
  const cs = lyraCompanionship(game);
  return { shared, cited, read, told, bond, confides: cs !== 'left' && cs !== 'gone' };
}

function allMemories(mind) {
  const fromStore = listFrom(safe(() => mind?.memory, null), ['all', 'list', 'entries', 'items', 'memories']);
  if (fromStore.length) return fromStore;
  return Array.isArray(mind?.memories) ? mind.memories : [];
}

// ---------- You ----------

export function youPage(game) {
  const village = safe(() => game.village, null);
  const roster = safe(() => villagerRoster(game, lyraOf(game)?.mind), []) || [];
  const f = safe(() => villageFeeling(roster), null);
  const feeling = f ? { label: f.label || '', sentence: f.sentence || '', avg: f.avg } : null;
  const rumors = safe(() => rumorsAboutPlayer(village, 5), []) || [];
  const views = roster
    .filter((r) => r.opinionLevel)
    .map((r) => ({ id: r.id, name: r.first, label: r.opinionLevel.label, key: r.opinionLevel.key, opinion: r.opinion }))
    .sort((a, b) => num(b.opinion) - num(a.opinion));
  let titles = [];
  const t = safe(() => game.reputation?.titles?.({ knownTo: null }), null);
  if (Array.isArray(t)) titles = t.map((x) => (typeof x === 'string' ? x : x?.title || x?.name || '')).filter(Boolean);
  const wanted = !!safe(() => game.combat?.hasCrime?.(game.player), false);
  return { name: game?.settings?.playerName || 'You', feeling, rumors, views, titles, wanted };
}

// ---------- Lyra ----------

export function lyraPage(game, ctx = lyraContext(game)) {
  const L = lyraOf(game);
  const mind = L?.mind;
  const name = lyraName(game);
  const dead = lyraDead(game);
  const cs = lyraCompanionship(game);
  const today = num(game?.clock?.day, 0);
  const rel = playerRelation(mind);
  const ledger = safe(() => ledgerEntries(mind), []) || [];
  const tally = ledgerTally(ledger);
  const promises = safe(() => promiseViews(promiseEntries(mind), { lyraName: name, today }), []) || [];
  // What she shares, what she keeps.
  const mems = allMemories(mind);
  const shown = [];
  let kept = 0;
  for (const m of mems) {
    if (!m || !m.text) continue;
    if (privacyOf({ kind: 'memory', entry: m }, ctx) === 'visible') shown.push({ id: m.id ?? null, text: String(m.text), day: num(m.day ?? m.when?.day, null) });
    else kept++;
  }
  const know = safe(() => knowledgeEntries(mind), []) || [];
  const knowShown = [];
  let knowKept = 0;
  for (const k of know) {
    if (privacyOf({ kind: 'knowledge', entry: k }, ctx) === 'visible') knowShown.push({ text: String(k.text || k.fact || ''), source: sourceLabel(k) });
    else knowKept++;
  }
  const secrets = [];
  for (const [i, s] of (mind?.soul?.secrets || []).entries()) {
    if (privacyOf({ kind: 'secret', index: i, revealAtBond: s?.revealAtBond }, ctx) === 'visible') secrets.push(String(s.text || ''));
  }
  const diary = Array.isArray(mind?.diary) ? mind.diary.filter((e) => e && e.text) : [];
  const pages = diary.map((e) => ({ day: num(e.day, 0), text: String(e.text), read: privacyOf({ kind: 'diary', day: e.day }, ctx) === 'visible' }));
  const life = safe(() => lifeTimeline({ mind, soul: mind?.soul }), []) || [];
  // Goals she has said aloud to you (her own, or ones you suggested), never her private list.
  const goals = (Array.isArray(mind?.goals) ? mind.goals : listFrom(mind?.goals)).filter((g) => g && !g.done && (g.source === 'player' || g.said || g.public)).map((g) => String(g.text || ''));
  const soul = mind?.soul || {};
  // Who she is, from what she has shown (read only).
  const who = [soul.fullName && soul.fullName !== name ? `${soul.fullName}` : null, Number.isFinite(ageOf(game, L)) ? `${ageOf(game, L)} years old` : null, soul.role || soul.occupation || null, Array.isArray(soul.traits) ? soul.traits.slice(0, 5).join(', ') : null].filter(Boolean);
  const out = {
    id: 'lyra',
    name,
    dead,
    cs,
    holder: holderOf(game) === L,
    standing: { label: dead ? 'In memory' : companionshipLabel(cs), tone: dead ? 'grave' : companionshipTone(cs), blurb: dead ? '' : companionshipBlurb(cs) },
    rel: rel ? { trust: num(rel.trust), fear: num(rel.fear), affinity: num(rel.affinity), words: `She ${trustWords(rel.trust)}, and ${fearWords(rel.fear)}.` } : null,
    between: { tally, deeds: ledgerViews(ledger, today).slice(0, 12), promises: promises.slice(0, 8) },
    life: { timeline: life.slice(0, 14), goals: goals.slice(0, 6), now: dead ? '' : `${companionshipLabel(cs)}. ${companionshipBlurb(cs)}` },
    shared: { memories: shown.slice(-30).reverse(), kept, knowledge: knowShown.slice(0, 20), knowKept, secrets },
    diary: { read: pages.filter((p) => p.read).reverse(), closed: pages.filter((p) => !p.read).map((p) => p.day).reverse() },
    who,
    confides: ctx.confides,
    memorial: dead ? lyraMemorial(game) : null,
  };
  return out;
}

// Her memorial (item 7): her last diary page, her last words, how the village speaks of her.
export function lyraMemorial(game) {
  const L = lyraOf(game);
  const mind = L?.mind;
  const diary = Array.isArray(mind?.diary) ? mind.diary.filter((e) => e && e.text) : [];
  const last = diary[diary.length - 1] || null;
  const words = safe(() => farewellText(mind, game?.flags, 220), '') || '';
  const rec = safe(() => game.murder?.dead?.lyra, null);
  const rumors = listFrom(safe(() => game.village?.rumors, null), ['all', 'list', 'entries'])
    .filter((r) => r && r.text && (r.about === 'lyra' || (Array.isArray(r.about) && r.about.includes('lyra'))))
    .slice(-4)
    .map((r) => truncate(String(r.text), 180));
  const age = ageOf(game, L);
  return {
    line: `${lyraName(game)} is dead${Number.isFinite(age) ? `, at ${age}` : ''}${rec?.day ? `, on day ${rec.day}` : ''}.`,
    lastPage: last ? { day: num(last.day, 0), text: String(last.text) } : null,
    lastWords: words,
    village: rumors,
  };
}

// ---------- a villager ----------

export function villagerPage(game, npc) {
  if (!npc) return null;
  const p = npc.profile || {};
  const name = firstName(npc.name);
  const dead = isDeadPerson(game, npc);
  const opinion = num(npc.opinionOfPlayer, 30);
  const lvl = opinionLevel(opinion) || { label: 'Neutral', key: 'neutral' };
  const st = safe(() => game.village?.standing?.(npc.id), null);
  const facts = [];
  for (const id of npc.told || []) {
    const f = (p.facts || []).find((x) => x.id === id);
    if (f?.text) facts.push(String(f.text));
  }
  const talks = safe(() => game.village?.talks?.[npc.id], null);
  const nTalks = Array.isArray(talks) ? talks.length : 0;
  const g = st?.grievance;
  const gift = npc._lastGift ? `Last gift: ${npc._lastGift.name || npc._lastGift.itemId}${npc._lastGift.liked > 0 ? ' (they liked it)' : npc._lastGift.liked < 0 ? ' (not to their taste)' : ''}.` : '';
  const doing = safe(() => game.villageLife?.view?.()?.people?.find?.((x) => x.id === npc.id)?.doing, null);
  const age = ageOf(game, npc);
  const role = p.role ? String(p.role) : '';
  const holder = holderOf(game) === npc;
  return {
    id: npc.id,
    name,
    fullName: String(npc.name || name),
    dead,
    holder,
    age,
    stage: lifeStage(game, npc),
    standing: { label: dead ? 'In memory' : lvl.label, key: lvl.key, opinion, cold: !!st?.cold },
    between: { facts, talks: nTalks, grievance: g ? String(g.text || g.reason || g.kind || 'a wrong not forgotten') : '', fresh: !!g?.fresh, gift, familiarity: num(npc.familiarity) },
    // (Never the profile's private description: it holds secrets only its keepers know.)
    life: { role, age, home: p.home || '', doing: dead ? '' : holder ? 'walking with you' : doing || '' },
  };
}
