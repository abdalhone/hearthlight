// What is done stays done (round 14b follow-up, plan §13c; DESIGN §38.7). The author: "if I
// kill it, of course I can't continue with the other story path, because ... he's dead."
//
// A dead person stays dead, and everything that was theirs closes or passes on. The systems
// already do the passing (missions: murder.standIn; shops and work: grief's HEIRS; the Moot:
// chairOf and the living heads; juries: the living heads; Lyra's own missions close); this
// module says it, in one place, for the Missions journal and the toasts:
//
//   staysDone(game, id)   { id, name, cause, day, by, lines: [{ kind, text }] } or null
//                         kinds: 'mission' 'role' 'moot' 'bond' 'story'
//   staysDoneAll(game)    the same for everyone the village knows is dead, newest first
//   missionNote(game, m)  the journal's line on a mission whose giver is gone, or ''
//
// Only what the village KNOWS (murder.knownDead): a death nobody has found is not in the
// journal yet (the stranger may know; the page is the village's world as it stands).

import { HEIRS, UNDONE, MOOT_CHAIR, MOOT_HEADS, MAREN_KEEPERS, OFFICIANTS } from '../murder/data.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { profileById } from '../entities/npc_data.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function first(game, id) {
  if (id === 'lyra') return game?.settings?.companionName || 'Lyra';
  if (id === 'board') return 'the notice board';
  const n = safe(() => game.entities.get(id)?.profile?.name, null) || safe(() => profileById(id)?.name, null) || id;
  const parts = String(n).replace(/"[^"]*"\s*/g, '').trim().split(/\s+/);
  if ((parts[0] === 'Captain' || parts[0] === 'Sister') && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

function deadOf(game, id) {
  return !!game?.murder?.dead?.[id];
}

function alive(game, id) {
  if (deadOf(game, id)) return false;
  const e = safe(() => game.entities.get(id), null);
  return !!e && !e.removed && !e.absent && !e.dead;
}

function known(game, id) {
  const m = game?.murder;
  if (!m?.dead?.[id]) return false;
  return typeof m.knownDead === 'function' ? !!safe(() => m.knownDead(id), false) : true;
}

function kin(a, b) {
  const pa = safe(() => profileById(a)?.family, null);
  const pb = safe(() => profileById(b)?.family, null);
  const has = (f, id) => !!f && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => f[k]?.includes(id));
  return has(pa, b) || has(pb, a);
}

const titleOf = (m) => `“${m.title}”`;
const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Whoever takes a role first among `order`, as if `gone` were not there (the one who held it).
function heldBy(game, order, gone) {
  for (const id of order) if (id === gone || alive(game, id)) return id;
  return null;
}
function nowBy(game, order) {
  for (const id of order) if (alive(game, id)) return id;
  return null;
}

// The journal's line on one mission whose giver is gone: passed on, or ended.
export function missionNote(game, m) {
  const ms = game?.missions;
  if (!m || !ms || !m.giver || m.giver === 'board' || !known(game, m.giver)) return '';
  const to = safe(() => ms.giverOf(m), m.giver);
  const who = first(game, m.giver);
  const st = safe(() => ms.status(m.id), null);
  if (st === 'closed' || to === m.giver) return `${who} is dead. It ends here.`;
  return to === 'board' ? `${who} is dead. Nobody is left to ask: the notice board keeps it.` : `${who} is dead. ${first(game, to)} sees it done now.`;
}

export function staysDone(game, id) {
  const m = game?.murder;
  const rec = m?.dead?.[id];
  if (!rec || !known(game, id)) return null;
  const lines = [];
  const add = (kind, text) => text && lines.push({ kind, text });
  const name = first(game, id);
  // Missions: those already taken pass on or end; the rest wait with whoever stands in.
  const ms = game.missions;
  if (ms?.missions) {
    const theirs = ms.missions.filter((x) => x.giver === id);
    const later = [];
    for (const x of theirs) {
      const st = safe(() => ms.status(x.id), null);
      if (st === 'done') continue;
      if (st === 'active' || st === 'ready' || st === 'closed') add('mission', `${titleOf(x)}: ${missionNote(game, x).replace(/^.*? is dead\. /, '')}`);
      else later.push(x);
    }
    if (later.length) {
      const to = safe(() => ms.giverOf(later[0]), id);
      add('mission', to === id ? 'Their errands end with them.' : to === 'board' ? 'Their other errands wait on the notice board.' : `${first(game, to)} has their other errands now.`);
    }
    // A word someone was to carry to them: never given.
    for (const x of ms.missions) {
      const st = safe(() => ms.status(x.id), null);
      if (st !== 'active' && st !== 'ready') continue;
      if ((x.objectives || []).some((o) => o.type === 'talk' && o.target === id)) add('mission', `${titleOf(x)}: a word for ${name} will never be given.`);
    }
  }
  // Their work and their shop.
  const h = HEIRS[id];
  if (h) {
    if (alive(game, h.by)) add('role', `${first(game, h.by)} keeps ${h.work} now${h.shop ? ': the counter and the stock' : ''}.`);
    else add('role', UNDONE[id] || `Nobody keeps ${h.work} now.`);
  } else if (UNDONE[id]) add('role', UNDONE[id]);
  // The Moot: a seat, the chair, the rites.
  if (MOOT_HEADS.includes(id)) add('moot', 'Their seat at the Moot is empty: no vote of theirs at any trial again.');
  if (heldBy(game, MOOT_CHAIR, id) === id) {
    const c = nowBy(game, MOOT_CHAIR);
    add('moot', c ? `${first(game, c)} takes the chair at the Moot.` : 'Nobody is left to take the chair at the Moot.');
  }
  if (heldBy(game, OFFICIANTS, id) === id) {
    const o = nowBy(game, OFFICIANTS);
    if (o) add('role', `${first(game, o)} says the words over the dead now.`);
  }
  // Bonds: who is left to mourn them.
  const kinLeft = VILLAGERS.filter((x) => x !== id && alive(game, x) && kin(x, id));
  if (id === 'lyra') {
    const par = ['hobb', 'wenna'].filter((x) => alive(game, x));
    if (par.length) add('bond', `${list(par.map((x) => first(game, x)))} ${par.length > 1 ? 'have' : 'has'} lost their daughter.`);
  } else if (kinLeft.length) add('bond', `${list(kinLeft.map((x) => first(game, x)))} ${kinLeft.length > 1 ? 'mourn' : 'mourns'} them.`);
  // Story lines that were theirs.
  if (id === 'lyra') add('story', 'Her lessons, her waystone and her oath end with her. The story goes on without her.');
  if (id === 'aveline') {
    const k = nowBy(game, MAREN_KEEPERS);
    add('story', k ? `What Sister Aveline knew of Maren, ${first(game, k)} may know.` : "Maren's story has nobody left to tell it.");
  }
  if (id === 'petra') add('story', "Petra kept the Maren story longest. Some of it is gone with her.");
  if (id === 'hobb' || id === 'wenna') add('story', `Maren's thread loses ${name}'s part of it.`);
  // The pilgrim at the gate asked for them (§13c): it stays done, pact or no pact.
  const ask = (game.villain?.state?.asks || []).find((a) => a.kind === 'person' && a.target === id && a.state === 'done');
  if (ask) add('story', 'Isembard asked for this one. It stays done, whatever becomes of the pact.');
  const cause = rec.natural ? (rec.cause === 'age' ? 'Died of old age' : 'Died') : rec.cause === 'unkindled' && !rec.linked && !rec.knownKilling ? 'Died, and nobody knows how' : 'Killed';
  return { id, name, cause, day: rec.day ?? null, by: rec.by ?? null, lines };
}

export function staysDoneAll(game) {
  const dead = Object.values(game?.murder?.dead || {});
  return dead
    .filter((r) => r?.id && known(game, r.id))
    .sort((a, b) => (b.t ?? b.day ?? 0) - (a.t ?? a.day ?? 0))
    .map((r) => staysDone(game, r.id))
    .filter(Boolean);
}
