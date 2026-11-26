// The companion role (round 14b, DESIGN §34.1; the author: "I don't need to have Lyra as my
// companion forever … I want to be able to take anyone as my companion"). One role, held by
// one adult at a time, or by nobody when you walk alone. `game.party`.
//
// This is the base's minimal party (Step 0, F4): the role, who may hold it, the event, and
// Lyra kept in step with her own companionship. Workstream party (src/core/party.js is
// theirs from here) adds invite, take, release, ask, weighJoin and onVillagerAct on top of
// this API; every caller feature-detects them (`game.party?.invite?.(e)`).
//
//   holder                 the entity holding the role now, or null (walking alone)
//   holderId               its id (saved)
//   isCompanion(e)         is `e` (entity or id) the one holding the role?
//   canHold(e)             a person (Lyra or a villager), alive, present in the world, an
//                          adult (src/core/people.js isMinor: never a child), not the player
//   serialize() / deserialize(d)
//
// Vocabulary (round 14b): game.companion and game.lyra mean Lyra the PERSON; the ROLE is
// game.party.holder. Never read the holder where Lyra's own mind is meant.
//
// Bus events out: companion_changed { from, to, why, by } (ids or null; why is one of
// 'start', 'together', 'apart', 'left', 'gone', 'died', 'loaded', and whatever party adds).
// In: companionship_changed { state } (Lyra's autonomy): together/wary take the role for her
// when it is free; apart, left or gone release it when she holds it. villager_killed:
// the holder's death releases the role ('died').

import { COMPANION_ID, PLAYER_ID } from './constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isMinor, lyraOf } from './people.js';

const WITH_YOU = new Set(['together', 'wary']);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// Lyra's companionship as her mind holds it ('together' when there is no mind yet).
export function lyraCompanionship(game) {
  if (game?.flags?.lyra_gone) return 'gone';
  const m = lyraOf(game)?.mind;
  let s = safe(() => m?.companionship ?? m?.autonomy?.companionship, null);
  if (s && typeof s === 'object') s = s.state;
  return typeof s === 'string' ? s : 'together';
}

export class Party {
  constructor(game) {
    this.game = game;
    this.holderId = null;
    this._offs = [];
    const bus = game?.bus;
    if (bus?.on) {
      this._offs.push(bus.on('companionship_changed', (p) => safe(() => this.onCompanionship(p))));
      this._offs.push(bus.on('villager_killed', (p) => safe(() => this.onDeath(p))));
      this._offs.push(bus.on('villager_died', (p) => safe(() => this.onDeath(p))));
    }
  }

  // The start of a new game: Lyra holds the role while she walks with you.
  start() {
    if (this.holderId) return;
    const L = lyraOf(this.game);
    if (L && WITH_YOU.has(lyraCompanionship(this.game)) && this.canHold(L)) this.set(L.id, 'start', null);
  }

  entity(ref) {
    if (!ref) return null;
    if (typeof ref === 'object') return ref;
    if (ref === COMPANION_ID) return lyraOf(this.game);
    return safe(() => this.game?.entities?.get?.(ref), null);
  }

  get holder() {
    const e = this.entity(this.holderId);
    return e && !e.removed ? e : null;
  }

  isCompanion(e) {
    if (!e || !this.holderId) return false;
    const id = typeof e === 'string' ? e : e.id;
    return id === this.holderId;
  }

  // A person, alive, present, an adult, not the player.
  canHold(e) {
    e = this.entity(e);
    if (!e || e.removed || e.dead || e.absent) return false;
    if (e === this.game?.player || e.id === PLAYER_ID) return false;
    const person = e === lyraOf(this.game) || e.id === COMPANION_ID || (VILLAGERS.includes(e.id) && !!e.profile);
    if (!person) return false;
    if (typeof e.isAlive === 'function' && !e.isAlive() && !e.downed) return false;
    if (safe(() => this.game?.murder?.isDead?.(e.id), false)) return false;
    return !isMinor(this.game, e);
  }

  // Set the holder (the one place it changes) and say so. Party builds take/release on it.
  set(id, why = '', by = null) {
    const from = this.holderId || null;
    const to = id || null;
    if (from === to) return false;
    this.holderId = to;
    safe(() => this.game?.bus?.emit?.('companion_changed', { from, to, why, by }));
    return true;
  }

  onCompanionship(p) {
    const state = p?.state;
    if (!state) return;
    const L = lyraOf(this.game);
    if (!L) return;
    if (WITH_YOU.has(state)) {
      if (!this.holderId && this.canHold(L)) this.set(L.id, 'together', COMPANION_ID);
    } else if (this.holderId === L.id) this.set(null, state, COMPANION_ID);
  }

  onDeath(p) {
    const id = p?.id ?? p?.entity?.id;
    if (id && id === this.holderId) this.set(null, 'died', null);
  }

  serialize() {
    return { v: 1, holderId: this.holderId || null };
  }

  // Old saves have no party block: the holder is Lyra while her companionship is together
  // or wary (derived), else nobody.
  deserialize(d) {
    let id = null;
    if (d && typeof d === 'object' && 'holderId' in d) id = typeof d.holderId === 'string' ? d.holderId : null;
    else {
      const L = lyraOf(this.game);
      id = L && WITH_YOU.has(lyraCompanionship(this.game)) ? L.id : null;
    }
    if (id && !this.canHold(id)) id = null;
    const from = this.holderId || null;
    this.holderId = id;
    if (from !== id) safe(() => this.game?.bus?.emit?.('companion_changed', { from, to: id, why: 'loaded', by: null }));
  }

  destroy() {
    for (const off of this._offs) safe(() => off?.());
    this._offs.length = 0;
  }
}

// game.party, built once the world's people exist (game.buildWorld, after the NPCs).
export function installParty(game) {
  if (!game) return null;
  if (game.party instanceof Party) return game.party;
  game.party = new Party(game);
  game.party.start();
  return game.party;
}
