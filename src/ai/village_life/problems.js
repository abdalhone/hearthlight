// A villager's problem (DESIGN §28): the errand that cannot be done, the person who is not
// where they should be, and everything the villager knows about it: where that person
// usually is at this hour, where they live, who saw them last (as far as the villager
// knows), who has already been asked, and which places have been checked. buildInput()
// turns that into the compact picture both reasoners decide from.

import { habitAt } from './errands.js';
import { OUTSKIRTS, BEYOND_WARD, WATCH, CHILDREN, NO_SEARCH } from './errands_data.js';
import { FAMILY_TAGS } from '../social/bonds_data.js';

export const ACTIONS = ['go', 'ask', 'search', 'wait', 'alarm', 'give_up', 'tell_lyra'];
export const MAX_STEPS = 12; // decisions per problem in a day before they give up
const HOUR = 37.5; // clock seconds in a game hour

let SEQ = 0;

export function newProblem({ owner, kind = 'absent', about = null, errand = null, expect = null, place = null, t = 0, day = 1, purpose = '', goods = '', shop = '', care = 0.5 }) {
  return {
    id: `p${++SEQ}_${owner}`,
    owner,
    kind, // absent | shut | item | blocked | worried
    about,
    errand, // errand instance id
    expect, // expectation key
    place,
    purpose,
    goods,
    shop,
    care,
    since: t,
    day,
    status: 'open', // open | resolved | given_up
    steps: 0,
    checked: place ? [place] : [],
    checkedAt: place ? { [place]: t } : {},
    asked: [],
    heard: [],
    belief: null,
    thought: '',
    said: '',
    history: [],
    due: t,
    awaiting: false,
    resolvedAt: null,
    resolution: '',
  };
}

export function restoreProblem(d) {
  if (!d || typeof d !== 'object' || typeof d.owner !== 'string') return null;
  const m = /^p(\d+)_/.exec(String(d.id || ''));
  if (m) SEQ = Math.max(SEQ, Number(m[1]));
  return {
    ...newProblem({ owner: d.owner }),
    ...d,
    checked: Array.isArray(d.checked) ? d.checked.filter((x) => typeof x === 'string') : [],
    asked: Array.isArray(d.asked) ? d.asked.filter((x) => typeof x === 'string') : [],
    heard: Array.isArray(d.heard) ? d.heard.filter((x) => x && typeof x === 'object').slice(-12) : [],
    history: Array.isArray(d.history) ? d.history.filter((x) => x && typeof x === 'object').slice(-16) : [],
    awaiting: false,
  };
}

// How much a cares about b, 0..1: family most, then friends, then workmates and neighbours.
export function careFor(life, a, b) {
  if (!a || !b || a === b) return 0;
  const bd = life.bond(a, b);
  if (bd?.tags?.some((t) => FAMILY_TAGS.has(t))) return 1;
  const aff = bd?.affinity ?? 0;
  let c = aff >= 60 ? 0.85 : aff >= 40 ? 0.7 : aff >= 20 ? 0.5 : 0.35;
  if (bd?.tags?.includes('apprentice') || bd?.tags?.includes('mentor') || bd?.tags?.includes('friend')) c = Math.max(c, 0.7);
  if (life.sameWork(a, b)) c = Math.max(c, 0.65);
  if (aff < -20) c = 0.2;
  return c;
}

// Who might know where `about` is, as the asker would guess: family and housemates,
// workmates, neighbours, friends, the watch, and whoever is close by.
export function askCandidates(life, prob, npc, { max = 6 } = {}) {
  const about = prob.about;
  const out = [];
  const asked = new Set(prob.asked);
  const t = life.now();
  const hour = life.hour();
  for (const e of life.villagers()) {
    const id = e.id;
    if (id === prob.owner || id === about || asked.has(id)) continue;
    if (!life.available(e)) continue;
    if (CHILDREN.has(id) && hour >= 20.5) continue;
    let score = 0;
    let why = '';
    const bd = about ? life.bond(id, about) : null;
    if (about && bd?.tags?.some((x) => FAMILY_TAGS.has(x))) {
      score += 3;
      why = `${life.name(about)}'s family`;
    } else if (about && life.sameHome(id, about)) {
      score += 2.8;
      why = `lives with ${life.name(about)}`;
    } else if (about && life.sameWork(id, about)) {
      score += 2.5;
      why = `works with ${life.name(about)}`;
    } else if (about && (bd?.affinity ?? 0) >= 50) {
      score += 1.6;
      why = `close to ${life.name(about)}`;
    } else if (about && life.neighbours(id, about)) {
      score += 1.4;
      why = `${life.name(about)}'s neighbour`;
    }
    if (WATCH.includes(id)) {
      score += 1.2;
      why ||= 'the watch sees everyone';
    }
    if (id === 'elda' || id === 'petra') {
      score += 0.8; // the innkeeper and the woman on the bench see the whole village go by
      why ||= id === 'elda' ? 'everyone passes through the Kettle' : 'sees everyone from her bench';
    }
    const d = Math.hypot(e.x - npc.x, e.y - npc.y);
    const near = d < 140 && life.sight.canSee(npc, e);
    if (near) {
      score += 2;
      why ||= 'right here';
    } else score += Math.max(0, 1 - d / 700);
    why ||= 'might have seen something';
    out.push({ id, name: life.name(id), why, near, d: Math.round(d), score, where: life.placeOf(e) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

// Where it is worth looking: where they usually are now, home, work, places someone saw
// them, then the edges of the village. Never past the ward.
export function placeCandidates(life, prob, { max = 7 } = {}) {
  const about = prob.about;
  const out = [];
  const seen = new Set();
  const checked = new Set(prob.checked);
  const t = life.now();
  const add = (id, why) => {
    if (!id || seen.has(id) || BEYOND_WARD.has(id) || id === 'hearthvale') return;
    seen.add(id);
    if (!life.game?.locations?.get?.(id)) return;
    out.push({ id, name: life.placeName(id), why, checked: checked.has(id) });
  };
  // Where they were meant to be, when it has been a while: they may be back.
  if (prob.place && t - (prob.checkedAt?.[prob.place] ?? prob.since) > 0.6 * HOUR) {
    add(prob.place, about ? `where ${life.name(about)} should have been; may be back by now` : 'where it went wrong');
    if (out.length && out[out.length - 1].id === prob.place) {
      out[out.length - 1].checked = false;
      out[out.length - 1].origin = true;
    }
  }
  if (about) {
    for (const h of prob.heard.slice().reverse()) {
      if (h.heading) add(h.heading, `${h.fromName || 'someone'} saw ${life.name(about)} heading there`);
      if (h.place && h.kind !== 'none') add(h.place, `${h.fromName || 'someone'} saw ${life.name(about)} there`);
    }
    const p = life.profile(about);
    const habit = p ? habitAt(p, life.hour()) : null;
    if (habit?.at) add(habit.at, `where ${life.name(about)} usually is at this hour`);
    if (p?.home) add(p.home, `${life.name(about)}'s home`);
    if (p?.work) add(p.work, `where ${life.name(about)} works`);
    for (const e of p?.schedule || []) add(e.at, `one of ${life.name(about)}'s haunts`);
  }
  for (const id of OUTSKIRTS) add(id, 'the edge of the village');
  // Unchecked first, in order.
  out.sort((a, b) => Number(a.checked) - Number(b.checked));
  return out.slice(0, max);
}

// "this morning" / "an hour ago" / "last night", from a clock time.
export function whenPhrase(t, now) {
  if (!Number.isFinite(t) || t < 0) return 'a long while';
  const day = Math.floor(t / 900);
  const today = Math.floor(now / 900);
  const h = ((t % 900) / 900) * 24;
  const ago = (now - t) / HOUR;
  if (day === today) {
    if (ago < 0.6) return 'just now';
    if (ago < 1.6) return 'an hour or so ago';
    if (h < 5) return 'in the night';
    if (h < 7.5) return 'first thing this morning';
    if (h < 11.5) return 'this morning';
    if (h < 14) return 'around noon';
    if (h < 18) return 'this afternoon';
    if (h < 21) return 'this evening';
    return 'tonight';
  }
  if (day === today - 1) return h >= 17 ? 'last night' : 'yesterday';
  return `${today - day} days ago`;
}

export function clockText(t) {
  const h24 = ((t % 900) / 900) * 24;
  const h = Math.floor(h24);
  const m = Math.floor((h24 - h) * 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// The compact picture a reasoner decides from.
export function buildInput(life, prob) {
  const npc = life.entity(prob.owner);
  const about = prob.about;
  const t = life.now();
  const hour = life.hour();
  const p = about ? life.profile(about) : null;
  const habit = p ? habitAt(p, hour) : null;
  const own = about ? life.sight.lastSeen(prob.owner, about) : null;
  const askable = npc ? askCandidates(life, prob, npc) : [];
  const places = placeCandidates(life, prob);
  const kase = about ? life.cases.get(about) : null;
  const lyra = life.game?.companion;
  const player = life.game?.player;
  const options = ['go', 'ask', 'wait', 'give_up'];
  const night = hour >= 20.5 || hour < 5.5;
  // Searching is for daylight (the watch and Hess carry lanterns), and not for the frail.
  const canSearch = !NO_SEARCH.has(prob.owner) && !(CHILDREN.has(prob.owner) && (hour >= 18 || hour < 7)) && (!night || WATCH.includes(prob.owner) || prob.owner === 'hess');
  if (about && canSearch) options.push('search');
  if (about) options.push('alarm');
  if (lyra && life.lyraTalks() && !prob.asked.includes('lyra')) options.push('tell_lyra');
  const playerNear = !!(npc && player && life.playerAskable(npc) && !prob.asked.includes('player'));
  if (playerNear) askable.unshift({ id: 'player', name: life.playerName(), why: 'right here; a stranger who gets about', near: true, d: Math.round(Math.hypot(player.x - npc.x, player.y - npc.y)), score: 2.5, where: life.placeOf(player) });
  const ent = about ? life.entity(about) : null;
  return {
    who: prob.owner,
    name: life.name(prob.owner),
    role: life.profile(prob.owner)?.role || '',
    voice: life.profile(prob.owner)?.voice || '',
    kind: prob.kind,
    about,
    aboutName: about ? life.name(about) : '',
    purpose: prob.purpose,
    goods: prob.goods,
    shop: prob.shop,
    here: life.placeOf(npc),
    hereName: life.placeName(life.placeOf(npc)),
    origin: prob.place || null,
    originName: prob.place ? life.placeName(prob.place) : null,
    originAgo: prob.place ? Math.round(((t - (prob.checkedAt?.[prob.place] ?? prob.since)) / HOUR) * 10) / 10 : 0,
    since: prob.since,
    sinceText: clockText(prob.since),
    elapsedH: Math.round(((t - prob.since) / HOUR) * 10) / 10,
    hour: Math.round(hour * 10) / 10,
    care: prob.care,
    steps: prob.steps,
    habitNow: habit?.at ? { id: habit.at, name: life.placeName(habit.at) } : null,
    home: p?.home ? { id: p.home, name: life.placeName(p.home) } : null,
    work: p?.work ? { id: p.work, name: life.placeName(p.work) } : null,
    ownSeenAgo: own ? Math.round(((t - own.t) / HOUR) * 10) / 10 : null,
    ownSeen: own ? { t: own.t, place: own.place, placeName: life.placeName(own.place), when: whenPhrase(own.t, t), with: own.with, withName: own.with ? life.nameFor(prob.owner, own.with) : null, heading: own.heading } : null,
    heard: prob.heard.slice(-5),
    checked: prob.checked.slice(),
    checkedAt: { ...(prob.checkedAt || {}) },
    asked: prob.asked.slice(),
    askable,
    places,
    options,
    expectedBackSoon: !!(about && life.expectedBackSoon(about, prob.place)),
    busyElsewhere: !!(ent && life.busyElsewhere(ent)),
    caseStatus: kase?.status || 'none',
    caseSearching: !!kase && (kase.status === 'search' || kase.status === 'missing'),
    watchKnows: !!kase && (kase.alarmAt != null || kase.status === 'search' || kase.status === 'missing'),
    isWatch: WATCH.includes(prob.owner),
    child: CHILDREN.has(prob.owner),
    night,
    joined: prob.history.some((h) => h.action === 'search'),
    lyraNear: !!(lyra && npc && Math.hypot(lyra.x - npc.x, lyra.y - npc.y) < 160),
    lyraAsked: prob.asked.includes('lyra'),
    belief: prob.belief,
  };
}
