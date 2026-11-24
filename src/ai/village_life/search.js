// The watch organising a search (DESIGN §28): who leads, who goes, and where each one
// looks. Places come in the order a sensible captain would send people: where the missing
// person was last seen, their home and work and haunts, then the edges of the bell-reach.
// Nobody is sent past the ward, children are not sent out after dark, and the frail ask
// and wait rather than search.

import { OUTSKIRTS, BEYOND_WARD, WATCH, TRACKERS, NO_SEARCH, CHILDREN } from './errands_data.js';

export const SEARCH_SECONDS = 24; // clock seconds spent searching one place (about 40 game minutes)
export const MAX_SEARCHERS = 5;

// Who takes charge: the captain, else Wys, else the Reeve, else Hess.
export function searchLeader(life, about) {
  for (const id of [...WATCH, 'alder', 'hess']) {
    if (id === about) continue;
    const e = life.entity(id);
    if (e && life.available(e, { evenAsleep: false })) return id;
  }
  return null;
}

// Places to search, best first, not yet searched.
export function searchPlaces(life, kase) {
  const about = kase.about;
  const out = [];
  const seen = new Set(Object.keys(kase.searched || {}));
  const add = (id) => {
    if (!id || seen.has(id) || BEYOND_WARD.has(id) || id === 'hearthvale') return;
    if (!life.game?.locations?.get?.(id)) return;
    seen.add(id);
    out.push(id);
  };
  const last = life.cases.lastKnown(kase);
  if (last?.heading) add(last.heading);
  if (last?.place) add(last.place);
  for (const r of (kase.reports || []).slice().reverse()) {
    if (r.heading) add(r.heading);
    if (r.place && r.kind !== 'checked') add(r.place);
  }
  const p = life.profile(about);
  if (p?.home) add(p.home);
  if (p?.work) add(p.work);
  for (const e of p?.schedule || []) add(e.at);
  for (const id of OUTSKIRTS) add(id);
  return out;
}

// Who goes out: the watch, Hess the tracker, whoever raised the alarm if they care, and
// those who love the missing person most.
export function chooseSearchers(life, kase, leader) {
  const about = kase.about;
  const hour = life.hour();
  const ok = (id) => {
    if (!id || id === about || NO_SEARCH.has(id)) return false;
    if (CHILDREN.has(id) && (hour >= 18 || hour < 7)) return false;
    const e = life.entity(id);
    return !!e && life.available(e);
  };
  const out = [];
  const add = (id) => {
    if (out.length < MAX_SEARCHERS && !out.includes(id) && ok(id)) out.push(id);
  };
  add(leader);
  for (const id of WATCH) add(id);
  for (const id of TRACKERS) if (!CHILDREN.has(id)) add(id);
  if (kase.alarmBy && life.care(kase.alarmBy, about) >= 0.5) add(kase.alarmBy);
  const close = life
    .villagers()
    .map((e) => e.id)
    .filter((id) => life.care(id, about) >= 0.7)
    .sort((a, b) => life.care(b, about) - life.care(a, about));
  for (const id of close) add(id);
  return out;
}
