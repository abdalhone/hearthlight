// The companion role (round 14b, DESIGN §34.1; the author: "I don't need to have Lyra as my
// companion forever … I want to be able to take anyone as my companion"). One role, held by
// one adult at a time, or by nobody when you walk alone. `game.party`.
//
//   holder                 the entity holding the role now, or null (walking alone)
//   holderId               its id (saved)
//   isCompanion(e)         is `e` (entity or id) the one holding the role?
//   canHold(e)             a person (Lyra or a villager), alive, present in the world, an
//                          adult (src/core/people.js isMinor: never a child), not the player
//   canTake(e)             may `e` take the role now (it is free, or theirs)? Lyra's own plans
//                          ask this before she comes back on her own (autonomy, feature-detected)
//   weighJoin(e)           the game's verdict on asking them along -> { decision, why, line,
//                          terms, narration } (Lyra: her own mind's verdict on 'rejoin')
//   invite(e, {text, by})  ask them along: their own mind decides; on yes they take the role
//   take(e, {why, by})     give them the role (one at a time: the holder before is released
//                          with why 'replaced'); a villager gets a CompanionDuty (npc.duty)
//   release(why, {line})   the holder steps out: dismissed, left, gone, died, downed, night,
//                          hurt, fear, work, opinion, grievance, replaced
//   ask(cmdId)             the Ask bar's five orders, to whoever holds the role ->
//                          { ok, refused, verdict: { decision, message }, message }
//                          (alone: { ok: false, alone: true })
//   onVillagerAct(e, act)  the chat's `act` field (join, leave, follow, wait, fight, hold_back):
//                          a join is never taken on trust, it is weighed again (contract §33)
//   update(dt)             the catch-up watchdog (a holder far behind and out of sight)
//   serialize() / deserialize(d)
//
// Vocabulary (round 14b): game.companion and game.lyra mean Lyra the PERSON; the ROLE is
// game.party.holder. Never read the holder where Lyra's own mind is meant. Helpers below:
// holderOf(game), isParty(game, e), isLyra(game, e), lyraDead(game).
//
// Bus events out: companion_changed { from, to, why, by } (ids or null).
// In: companionship_changed (Lyra's autonomy: together/wary take the role for her when it
// is free; apart, left or gone release it when she holds it; back on her own while someone
// else walks with you, she goes her own way again: "You walk with Bram now"),
// villager_killed / villager_died (the holder's death releases the role), crime (a villager
// companion who sees you hurt or kill someone walks off), new_day (the village knows where
// they are).

import { COMPANION_ID, PLAYER_ID, TILE } from './constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isMinor, lyraOf } from './people.js';
import { attachDuty, detachDuty, weighJoin as weighVillager, orderOfAct } from '../entities/npc_companion.js';
import { companionLine } from '../entities/npc_companion_lines.js';

const WITH_YOU = new Set(['together', 'wary']);
const ACCEPTED = new Set(['accept', 'accept_conditional']);
// Lyra's orders by Ask-bar id (the same requests the HUD has always put to her).
const LYRA_ORDERS = {
  follow: { action: 'follow', args: { target: 'player' } },
  stay: { action: 'stay', args: {} },
  attack: { action: 'set_combat_mode', args: { value: 'attack' } },
  defend: { action: 'set_combat_mode', args: { value: 'defend' } },
  passive: { action: 'set_combat_mode', args: { value: 'passive' } },
};
export const CATCH_UP_TILES = 40; // a holder this far behind, out of sight, for a while: catch up
const CATCH_UP_AFTER = 4; // seconds

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function firstName(e) {
  return String(e?.name || e?.id || '').split(' ')[0];
}

// Lyra's companionship as her mind holds it ('together' when there is no mind yet).
export function lyraCompanionship(game) {
  if (game?.flags?.lyra_gone) return 'gone';
  const m = lyraOf(game)?.mind;
  let s = safe(() => m?.companionship ?? m?.autonomy?.companionship, null);
  if (s && typeof s === 'object') s = s.state;
  return typeof s === 'string' ? s : 'together';
}

// Is Lyra dead (killed, or gone from the world for good)? Every companion site asks this.
export function lyraDead(game) {
  if (game?.flags?.lyra_dead) return true;
  if (safe(() => game?.murder?.isDead?.(COMPANION_ID), false)) return true;
  const L = lyraOf(game);
  return !!(L && L.dead && !L.downed);
}

export function isLyra(game, e) {
  if (!e) return false;
  if (typeof e === 'string') return e === COMPANION_ID;
  return e === lyraOf(game) || e.id === COMPANION_ID;
}

// Whoever holds the companion role now, or null. A game without a party (old tests, a bare
// harness) reads Lyra while she walks with you.
export function holderOf(game) {
  if (!game) return null;
  if (game.party && 'holderId' in game.party) return safe(() => game.party.holder, null);
  const L = lyraOf(game);
  if (!L || L.removed || lyraDead(game)) return null;
  return WITH_YOU.has(lyraCompanionship(game)) ? L : null;
}

// The player or whoever walks with them (shared xp, friendly fire, "near your companion").
export function isParty(game, e) {
  if (!e) return false;
  if (e === game?.player || e.id === PLAYER_ID) return true;
  const h = holderOf(game);
  return !!h && (e === h || e.id === h.id);
}

export class Party {
  constructor(game) {
    this.game = game;
    this.holderId = null;
    this._offs = [];
    this._inviting = null; // Lyra asked back: her "yes" takes the role even from another
    this._behindT = 0;
    const bus = game?.bus;
    if (bus?.on) {
      this._offs.push(bus.on('companionship_changed', (p) => safe(() => this.onCompanionship(p))));
      this._offs.push(bus.on('villager_killed', (p) => safe(() => this.onDeath(p))));
      this._offs.push(bus.on('villager_died', (p) => safe(() => this.onDeath(p))));
      this._offs.push(bus.on('crime', (p) => safe(() => this.onCrime(p))));
      this._offs.push(bus.on('new_day', () => safe(() => this.markAway())));
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

  isLyra(e) {
    return isLyra(this.game, e);
  }

  // A person, alive, present, an adult, not the player.
  canHold(e) {
    e = this.entity(e);
    if (!e || e.removed || e.dead || e.absent) return false;
    if (e === this.game?.player || e.id === PLAYER_ID) return false;
    const lyra = e === lyraOf(this.game) || e.id === COMPANION_ID;
    const person = lyra || (VILLAGERS.includes(e.id) && !!e.profile);
    if (!person) return false;
    if (lyra && lyraDead(this.game)) return false;
    if (typeof e.isAlive === 'function' && !e.isAlive() && !e.downed) return false;
    if (safe(() => this.game?.murder?.isDead?.(e.id), false)) return false;
    return !isMinor(this.game, e);
  }

  // The role is free, or already theirs.
  canTake(e) {
    e = this.entity(e);
    if (!e || !this.canHold(e)) return false;
    return !this.holderId || this.isCompanion(e) || this._inviting === e.id;
  }

  // Set the holder (the one place it changes) and say so.
  set(id, why = '', by = null) {
    const from = this.holderId || null;
    const to = id || null;
    if (from === to) return false;
    this.holderId = to;
    safe(() => this.game?.bus?.emit?.('companion_changed', { from, to, why, by }));
    return true;
  }

  // ---------------------------------------------------------------- asking along

  // The game's verdict on asking `e` along (a villager), or Lyra's own mind's ('rejoin').
  weighJoin(e, opts = {}) {
    e = this.entity(e);
    if (!e) return { decision: 'refuse', why: 'cannot', line: '', terms: null, narration: true };
    if (this.isLyra(e)) return this.weighLyra(e);
    if (!this.canHold(e) && !isMinor(this.game, e)) {
      const v = weighVillager(this.game, e, opts);
      return v.decision === 'refuse' ? v : { decision: 'refuse', why: 'cannot', line: `${firstName(e)} cannot come with you now.`, terms: null, narration: true };
    }
    return weighVillager(this.game, e, opts);
  }

  weighLyra(L) {
    const name = firstName(L) || 'Lyra';
    if (lyraDead(this.game)) return { decision: 'refuse', why: 'dead', line: `${name} is dead.`, terms: null, narration: true };
    if (this.isCompanion(L)) return { decision: 'accept', why: 'already', line: '', terms: null };
    const state = lyraCompanionship(this.game);
    if (state === 'gone') return { decision: 'refuse', why: 'gone', line: '', terms: null };
    const mind = L.mind;
    const verdict = safe(() => mind?.evaluateRequest?.({ action: 'rejoin', args: { target: null, value: null, amount: null }, source: 'player', preview: true }), null);
    if (verdict?.decision && !ACCEPTED.has(verdict.decision)) return { decision: 'refuse', why: 'her_choice', line: verdict.message || '', terms: null };
    return { decision: verdict?.decision || 'accept', why: 'her_choice', line: verdict?.message || '', terms: null };
  }

  // Ask someone along. Their own mind decides; on yes they take the role.
  // -> { decision, why, line, terms, narration, ok }
  invite(e, { text = '', by = PLAYER_ID } = {}) {
    e = this.entity(e);
    if (!e) return { decision: 'refuse', why: 'cannot', line: '', ok: false, narration: true };
    if (this.isLyra(e)) return this.inviteLyra(e, { by });
    const v = this.weighJoin(e, { text });
    if (ACCEPTED.has(v.decision) && v.why !== 'already') {
      const ok = this.take(e, { why: 'invited', by, terms: v.terms });
      return { ...v, ok };
    }
    return { ...v, ok: v.why === 'already' };
  }

  // Asking Lyra back from her People page: her own will answers (autonomy.rejoin), and her
  // "yes" takes the role even while someone else holds it (they go home, 'replaced').
  inviteLyra(L, { by = PLAYER_ID } = {}) {
    const pre = this.weighLyra(L);
    if (pre.decision === 'refuse' || pre.why === 'already') return { ...pre, ok: pre.why === 'already' };
    const state = lyraCompanionship(this.game);
    if (WITH_YOU.has(state)) {
      const ok = this.take(L, { why: 'invited', by });
      return { ...pre, ok };
    }
    const will = L.mind?.autonomy;
    if (typeof will?.rejoin !== 'function') return { ...pre, decision: 'refuse', ok: false };
    this._inviting = L.id;
    let r = null;
    try {
      r = safe(() => will.rejoin({ asked: true }), null);
    } finally {
      this._inviting = null;
    }
    const ok = !!r?.ok && this.isCompanion(L);
    return { decision: ok ? 'accept' : 'refuse', why: 'her_choice', line: r?.message || pre.line || '', terms: null, ok, refused: !!r?.refused };
  }

  // Give `e` the role. One at a time: whoever held it before is released ('replaced').
  take(e, { why = 'invited', by = PLAYER_ID, terms = null, duty = null } = {}) {
    e = this.entity(e);
    if (!e || !this.canHold(e)) return false;
    if (this.isCompanion(e)) return true;
    const prev = this.holder;
    if (prev) this.release('replaced', { by, next: e });
    if (!this.isLyra(e)) {
      attachDuty(this.game, e, duty || { terms });
      this.markAway(e);
      // Talking with whoever is beside them is over: they walk with you now.
      safe(() => this.game.village?.endTalk?.(e));
    }
    this.set(e.id, why, by);
    return true;
  }

  // The holder steps out of the role. -> true when someone was released.
  release(why = 'dismissed', { line = '', by = PLAYER_ID, next = null, quiet = false } = {}) {
    const h = this.holder || this.entity(this.holderId);
    if (!h) {
      if (this.holderId) this.set(null, why, by);
      return false;
    }
    const g = this.game;
    this.set(null, why, by);
    if (this.isLyra(h)) {
      // Lyra goes her own way (she is not ours to send anywhere): the role's end is her
      // companionship's 'apart', by agreement.
      if ((why === 'dismissed' || why === 'replaced') && WITH_YOU.has(lyraCompanionship(g))) {
        safe(() => h.mind?.autonomy?.leavePlayer?.('apart', '', { asked: true }));
        if (why === 'replaced' && next && !quiet) this.sayNear(h, companionLine('lyra', 'lyra_back', { name: firstName(next) }) || `You walk with ${firstName(next)} now.`);
      }
      return true;
    }
    detachDuty(h);
    safe(() => g.villageLife?.markBack?.(h.id, { stay: true }));
    const words = line || (quiet ? '' : companionLine(h.id, why === 'replaced' ? 'replaced' : why === 'dismissed' ? 'dismissed' : `leave_${why}`, { name: firstName(h) }));
    if (words && !quiet) this.sayNear(h, words);
    if (why === 'gone') safe(() => g.village?.noteCutTies?.(h.id));
    return true;
  }

  // A line in their voice: a bubble over them, and in the chat as theirs (ui.personSays).
  sayNear(e, text) {
    const g = this.game;
    if (!text || !e) return;
    if (typeof g.ui?.personSays === 'function') {
      safe(() => g.ui.personSays(e, text));
      return;
    }
    if (typeof e.say === 'function' && !this.isLyra(e)) safe(() => e.say(text, { kind: 'say', target: g.player }));
    else safe(() => g.bubbles?.say?.(e, text, { kind: 'say' }));
  }

  // ---------------------------------------------------------------- orders

  // The Ask bar's orders, to whoever holds the role. Lyra weighs them in her own mind
  // (a wary Lyra may say no); a villager answers through their duty.
  ask(cmdId, args = {}) {
    const h = this.holder;
    if (!h) return { ok: false, alone: true, refused: false, verdict: null, message: '' };
    if (this.isLyra(h)) return this.askLyra(h, cmdId, args);
    const duty = h.duty;
    if (!duty?.request) return { ok: false, refused: false, verdict: null, message: '' };
    return duty.request(cmdId);
  }

  askLyra(L, cmdId, extra = {}) {
    const g = this.game;
    const o = LYRA_ORDERS[cmdId] || { action: cmdId, args: extra };
    const args = { target: null, value: null, amount: null, ...o.args, ...extra };
    const verdict = safe(() => L.mind?.evaluateRequest?.({ action: o.action, args, source: 'player' }), null);
    if (verdict?.decision && !ACCEPTED.has(verdict.decision)) return { ok: false, refused: true, verdict, message: verdict.message || '' };
    const r = safe(() => g.actions?.run?.(o.action, o.args, 'player'), null) || { ok: false, message: '' };
    if (verdict && r.verdict === undefined) r.verdict = verdict;
    return r;
  }

  // What the chat's mind chose to do (contract §33: `act`). A join is weighed by the game,
  // never taken on a mind's word; leave releases; the rest are orders to the holder.
  onVillagerAct(e, act, reply = null) {
    e = this.entity(e);
    if (!e || !act) return null;
    if (act === 'join') {
      if (this.isCompanion(e)) return { decision: 'accept', why: 'already', ok: true };
      if (this.isLyra(e)) return this.inviteLyra(e, {});
      const v = this.weighJoin(e);
      if (!ACCEPTED.has(v.decision)) return { ...v, ok: false };
      return { ...v, ok: this.take(e, { why: 'invited', by: PLAYER_ID, terms: v.terms }) };
    }
    if (!this.isCompanion(e)) return null;
    if (act === 'leave') {
      this.release(this.isLyra(e) ? 'left' : 'left', { line: reply?.say ? '' : undefined, by: e.id, quiet: !!reply?.say });
      return { ok: true };
    }
    const cmd = orderOfAct(act);
    if (!cmd) return null;
    if (this.isLyra(e)) return null; // her own will already acted on her words
    return e.duty?.request?.(cmd) || null;
  }

  // ---------------------------------------------------------------- the world

  onCompanionship(p) {
    const state = p?.state;
    if (!state) return;
    const L = lyraOf(this.game);
    if (!L) return;
    if (WITH_YOU.has(state)) {
      if (this._inviting === L.id) {
        this.take(L, { why: 'invited', by: PLAYER_ID });
        return;
      }
      if (!this.holderId && this.canHold(L)) {
        this.set(L.id, 'together', COMPANION_ID);
        return;
      }
      // Back by her own plans while someone else walks with you: she sees, and goes her
      // own way again (she is not anyone's second).
      const h = this.holder;
      if (h && !this.isLyra(h) && !this._bouncing) {
        this._bouncing = true;
        try {
          safe(() => L.mind?.autonomy?.leavePlayer?.('apart', '', { asked: true }));
          const line = companionLine('lyra', 'lyra_back', { name: firstName(h) });
          const P = this.game.player;
          if (P && Math.hypot(P.x - L.x, P.y - L.y) < 12 * TILE) this.sayNear(L, line);
        } finally {
          this._bouncing = false;
        }
      }
    } else if (this.holderId === L.id) this.set(null, state, COMPANION_ID);
  }

  // Is this the bounce above (Lyra together for a moment while another holds the role)?
  // The UI asks so it says nothing about a return that is not one.
  bouncing(state = lyraCompanionship(this.game)) {
    const h = this.holder;
    return WITH_YOU.has(state) && !!h && !this.isLyra(h) && this._inviting !== COMPANION_ID;
  }

  onDeath(p) {
    const id = p?.id ?? p?.entity?.id;
    if (id === COMPANION_ID && this.game?.flags) this.game.flags.lyra_dead = true;
    if (!id || id !== this.holderId) return;
    const h = this.holder;
    if (h && !this.isLyra(h)) detachDuty(h);
    this.set(null, 'died', null);
  }

  // A villager companion who SEES you hurt or kill someone will not walk with you after it
  // (sight rule, src/ai/sight.js through npc.canSee). Lyra's own will handles her.
  onCrime(p) {
    const h = this.holder;
    if (!h || this.isLyra(h)) return;
    const g = this.game;
    const actor = p?.actor;
    if (!actor || (actor !== g.player && actor.id !== PLAYER_ID)) return;
    const victim = p?.victim;
    const kind = String(p?.kind || '');
    if (!['assault', 'knockout', 'murder'].includes(kind)) return;
    const onThem = victim === h || victim?.id === h.id;
    const witnesses = Array.isArray(p?.witnesses) ? p.witnesses : null;
    const saw = onThem || (witnesses ? witnesses.includes(h.id) : !!(victim && safe(() => h.canSee?.(victim), false)));
    if (!saw) return;
    const line = companionLine(h.id, 'leave_fear', { name: firstName(h) });
    this.release(onThem || kind === 'murder' ? 'gone' : 'fear', { line, by: h.id });
  }

  // The village knows where a companion is (so §28's missing chain does not start).
  markAway(e = this.holder) {
    if (!e || this.isLyra(e)) return;
    const vl = this.game?.villageLife;
    if (!vl?.markAway) return;
    safe(() => vl.markAway(e.id, { place: 'kings_road', hours: 26, reason: 'companion', witnesses: [] }));
  }

  // Each step (the party slot plugin): a holder far behind and out of sight catches up.
  // A villager's duty does this itself; this watches Lyra while she follows.
  update(dt) {
    const g = this.game;
    const h = this.holder;
    const P = g?.player;
    if (!h || !P || !this.isLyra(h) || g.state !== 'playing') {
      this._behindT = 0;
      return;
    }
    const d = Math.hypot(h.x - P.x, h.y - P.y);
    const beh = h.behavior;
    const dir = beh?.directive?.type || 'follow';
    const busy = h.downed || h.carriedBy || h.carrying || dir !== 'follow' || safe(() => beh?.inCombat?.(), false);
    if (d < CATCH_UP_TILES * TILE || busy || onScreen(g, h.x, h.y)) {
      this._behindT = 0;
      return;
    }
    this._behindT += dt;
    if (this._behindT < CATCH_UP_AFTER) return;
    this._behindT = 0;
    const st = beh?.steering;
    if (st?.teleportNear) safe(() => st.teleportNear(P));
  }

  // ---------------------------------------------------------------- saves

  serialize() {
    const h = this.holder;
    const duty = h && !this.isLyra(h) ? safe(() => h.duty?.serialize?.(), null) : null;
    return { v: 2, holderId: this.holderId || null, duty };
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
    // A villager companion picks their duty back up where it was.
    const prev = this.holder;
    if (prev && !this.isLyra(prev) && prev.id !== id) detachDuty(prev);
    const e = id ? this.entity(id) : null;
    if (e && !this.isLyra(e)) {
      attachDuty(this.game, e, d?.duty && typeof d.duty === 'object' ? d.duty : {});
      this.markAway(e);
    }
    const from = this.holderId || null;
    this.holderId = id;
    if (from !== id) safe(() => this.game?.bus?.emit?.('companion_changed', { from, to: id, why: 'loaded', by: null }));
  }

  destroy() {
    for (const off of this._offs) safe(() => off?.());
    this._offs.length = 0;
  }
}

function onScreen(game, x, y, margin = 16) {
  const c = game?.camera;
  if (!c || !c.vw || !c.vh) return false;
  return x >= c.x - margin && y >= c.y - margin && x <= c.x + c.vw + margin && y <= c.y + c.vh + margin * 2;
}

// game.party, built once the world's people exist (game.buildWorld, after the NPCs).
export function installParty(game) {
  if (!game) return null;
  if (game.party instanceof Party) return game.party;
  game.party = new Party(game);
  game.party.start();
  return game.party;
}

// The party's slot plugin (src/core/plugins/party.js): steps the catch-up watchdog.
export const partyPlugin = {
  id: 'party',
  name: 'Party',
  description: 'Whoever walks with you: the companion role',
  update(dt, ctx) {
    ctx?.game?.party?.update?.(dt);
  },
};
