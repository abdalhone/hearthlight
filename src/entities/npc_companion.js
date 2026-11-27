// A villager walking with the stranger as their companion (round 14b, DESIGN §34.2; the
// author: "I want to be able to take anyone as my companion"). Two parts:
//
//   weighJoin(game, npc)  -> { decision: 'accept'|'accept_conditional'|'refuse', why, line,
//                             terms, narration }
//     The GAME decides whether they come (opinion, grievance, fear, the watch, the hour, a
//     post they keep, age and health), before any mind words it (contract §33: an invite is
//     decided before it is worded). A child is refused by the game itself ("Pip is a child").
//
//   CompanionDuty         npc.duty while they hold the role (game.party.take attaches it,
//                         release removes it). Its step() runs through the NPC's F5 hook,
//                         before their routine: follow two or three tiles behind, wait where
//                         asked, step out of the sword arc, fight what threatens you both
//                         (startFight anchored on the player, leash 200 px), catch up when
//                         far behind and out of sight, and decide to go home (bedtime, hurt,
//                         a grievance, fear, too long from work). request(cmd) answers the
//                         Ask bar in the shape the UI shows: { ok, refused, verdict, message }.
//
// Nothing here is Lyra: she keeps her own Behavior and mind (game.companion), and the role is
// game.party.holder. Only the five orders of the Ask bar exist for a villager: no jobs.

import { TILE, PLAYER_ID, DAY_SECONDS } from '../core/constants.js';
import { entryAt } from './npc_schedule.js';
import { isMinor, lifeStage } from '../core/people.js';
import { companionLine } from './npc_companion_lines.js';
import { swordArcPush } from '../ai/behavior/safety.js';
import { seesActor } from '../ai/sight.js';

export const FOLLOW_NEAR = 30; // px: close enough, stand
export const FOLLOW_FAR = 48; // px: start walking again
export const CATCH_UP_TILES = 30; // more than this behind and out of sight: they catch up
// A companion's top run (px/s): Lyra's own (80 × 1.6, her steering's run), which is where the
// stat points' speed ceiling sits (999 Grace walks at ~129 px/s, progression/attributes.js).
// Behind you, anyone you walk with runs as fast as you go, up to this (Version 12, DESIGN §39.4).
export const TOP_RUN = 128;
export const FOE_RANGE = 150; // px around them or you
export const FIGHT_LEASH = 200; // px from the player
export const ACCEPT_AT = 65;
export const CONDITIONAL_AT = 50;
export const LEAVE_OPINION = 35;
export const LEAVE_HP = 0.3;
export const WORK_HOURS_AWAY = 6; // game hours of missed work before they go back

// Posts kept: the watch while on watch, Elda while Pip is in her care.
const POSTS = {
  rowan: (entry) => entry?.activity === 'patrol' || entry?.activity === 'work',
  wys: (entry) => entry?.activity === 'patrol',
  elda: () => true,
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function firstName(e) {
  return String(e?.name || e?.id || 'They').split(' ')[0];
}

function hourOf(game) {
  const h = game?.clock?.hour;
  return Number.isFinite(h) ? h : 12;
}

// Their own day as the profile has it (not what an errand or the role bends it into).
export function ownEntry(game, npc) {
  return safe(() => entryAt(npc.profile?.schedule || [], hourOf(game)), null);
}

// How well they fight: 2 trained (the watch, the huntress, any profile with combat stats),
// 1 able (an adult, or a strong build), 0 none (the old, the frail, the chapel's keeper).
export function fightAbility(game, npc) {
  const p = npc?.profile;
  if (p?.combat || p?.hunter || npc?.isGuard || npc?.faction === 'guard') return 2;
  const stage = lifeStage(game, npc);
  if (stage === 'elder' || stage === 'frail') return 0;
  if (/chapel/i.test(String(p?.role || ''))) return 0;
  return 1;
}

// Will they take "Fight" (go at anything unfriendly) rather than only defend?
export function isFighter(game, npc) {
  const b = npc?.profile?.appearance?.build;
  return fightAbility(game, npc) >= 2 || (fightAbility(game, npc) >= 1 && (b === 'big' || b === 'broad'));
}

function heShe(npc) {
  const p = npc?.profile;
  const pro = p?.pronoun || p?.pronouns;
  if (typeof pro === 'string') return /^she/i.test(pro) ? 'She' : /^they/i.test(pro) ? 'They' : 'He';
  return p?.appearance?.skirt ? 'She' : 'He';
}

function knowsWanted(game, npc) {
  const P = game?.player;
  if (!P) return false;
  if (!safe(() => game.combat?.hasCrime?.(P), false)) return false;
  if (typeof npc.knowsWanted === 'function') return !!safe(() => npc.knowsWanted(P), false);
  return true;
}

// The game's verdict on "Will you travel with me?". Pure apart from reading the world.
export function weighJoin(game, npc, { rand } = {}) {
  const out = (decision, why, kind, extra = {}) => {
    const line = extra.line ?? companionLine(npc?.id, kind, { name: firstName(npc) }, rand);
    return { decision, why, line, terms: extra.terms || null, narration: !!extra.narration, score: extra.score ?? null };
  };
  if (!npc || npc.removed || npc.dead || npc.absent) return out('refuse', 'cannot', 'refuse_cannot', { line: 'There is nobody here to ask.', narration: true });
  if (npc === game?.player || npc.id === PLAYER_ID) return out('refuse', 'cannot', 'refuse_cannot', { line: '', narration: true });
  // Children: the game's own answer, not theirs (D1).
  if (isMinor(game, npc)) return out('refuse', 'child', 'refuse_child', { line: `${firstName(npc)} is a child. Children do not go on the road with you.`, narration: true });
  if (npc.downed || (typeof npc.isAlive === 'function' && !npc.isAlive())) return out('refuse', 'cannot', 'refuse_cannot', { line: `${firstName(npc)} is in no state to go anywhere.`, narration: true });
  if (safe(() => game.murder?.isDead?.(npc.id), false)) return out('refuse', 'cannot', 'refuse_cannot', { line: '', narration: true });
  if (game?.party?.isCompanion?.(npc)) return out('accept', 'already', 'ok_follow');

  const opinion = Number.isFinite(npc.opinionOfPlayer) ? npc.opinionOfPlayer : 30;
  const fear = safe(() => game.murder?.fearOf?.(npc), null);
  if (fear) return out('refuse', 'fear', 'refuse_fear');
  if (knowsWanted(game, npc)) return out('refuse', 'wanted', 'refuse_wanted');
  const st = safe(() => game.village?.standing?.(npc.id), null);
  const g = st?.grievance;
  if ((g && g.fresh && (g.weight ?? 0) >= 6) || npc.wrongedDay === game?.clock?.day) return out('refuse', 'grievance', 'refuse_grievance');
  const hour = hourOf(game);
  const entry = ownEntry(game, npc);
  if (entry?.activity === 'sleep' || hour >= 21 || hour < 6) return out('refuse', 'night', 'refuse_night');
  const post = POSTS[npc.id];
  if (post && post(entry)) return out('refuse', 'duty', 'refuse_duty');
  const stage = lifeStage(game, npc);
  if (stage === 'frail') return out('refuse', 'frail', 'refuse_frail');
  if (Number(npc.maxHp) > 0 && npc.hp / npc.maxHp < 0.5) return out('refuse', 'hurt', 'refuse_hurt');

  const fam = Number.isFinite(npc.familiarity) ? npc.familiarity : 0;
  const working = entry?.activity === 'work';
  let score = opinion + fam * 0.15;
  if (stage === 'elder') score -= 10;
  if (fightAbility(game, npc) >= 2) score += 5;
  const busy = working ? 15 : 0;
  if (score - busy >= ACCEPT_AT) return out('accept', 'yes', 'accept', { score: score - busy });
  if (score - busy >= CONDITIONAL_AT) return out('accept_conditional', 'yes', 'conditional', { terms: { untilDark: true }, score: score - busy });
  if (working && score >= CONDITIONAL_AT) return out('refuse', 'busy', 'refuse_busy', { score: score - busy });
  return out('refuse', 'opinion', 'refuse_opinion', { score });
}

// The five Ask-bar orders and what each sets.
const ORDERS = {
  follow: { directive: 'follow' },
  stay: { directive: 'stay' },
  attack: { stance: 'attack' },
  defend: { stance: 'defend' },
  passive: { stance: 'passive' },
};
// Words from the chat's `act` field (contract §33) mapped onto the orders.
const ACT_ORDER = { follow: 'follow', wait: 'stay', fight: 'attack', hold_back: 'passive' };

export class CompanionDuty {
  constructor(game, npc, { directive = 'follow', stance = 'defend', terms = null, since = null, workAway = 0 } = {}) {
    this.game = game;
    this.npc = npc;
    this.directive = directive === 'stay' ? 'stay' : 'follow';
    this.stance = ['attack', 'defend', 'passive'].includes(stance) ? stance : 'defend';
    this.terms = terms && typeof terms === 'object' ? { ...terms } : null;
    this.since = Number.isFinite(since) ? since : (game?.clock?.t ?? 0);
    this.waitAt = null;
    this.workAway = Number(workAway) || 0; // game hours of their own work missed
    this.checkT = 1 + Math.random();
    this.lastHourT = game?.clock?.t ?? 0;
    this.moving = false;
    this.arc = { x: 0, y: 0 };
    this.ended = false;
  }

  // A villager's status line under the HUD card ("Following you", "Waiting", "Fighting").
  status() {
    const n = this.npc;
    if (n?.downed) return 'down';
    if (n?.mode === 'fight') return 'fighting';
    if (this.directive === 'stay') return 'waiting';
    return 'following';
  }

  // The F5 hook: anything but undefined means the duty took this beat.
  step(npc, dt, tick) {
    if (this.ended) return undefined;
    const g = this.game;
    const P = g?.player;
    if (!P || P.removed) return undefined;
    // Downed and taken to Mira's cot: the survival rules hold them; the walk is over.
    if (npc.mode === 'patient') {
      safe(() => g.party?.release?.('downed', { by: npc.id, quiet: true }));
      return undefined;
    }
    if (npc.mode === 'flee' || npc.mode === 'help' || npc.mode === 'rescue') return undefined;
    if (npc.mode !== 'duty') npc.mode = 'duty';
    if (npc.r) npc.r.key = null; // their day resumes from scratch when the duty ends
    npc.wake?.();
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 2;
      // The village knows where they are (a new day ends every 'away'; mark it again).
      if (g.villageLife?.absences && !safe(() => g.villageLife.absences.get(npc.id), null)) safe(() => g.party?.markAway?.(npc));
      const leave = this.wantsToLeave();
      if (leave) {
        safe(() => g.party?.release?.(leave.why, { line: leave.line, by: npc.id }));
        return true;
      }
    }
    // Something threatening you both, seen with their own eyes.
    if (tick && this.canFight()) {
      const foe = this.foe();
      if (foe) {
        this.engage(foe);
        return true;
      }
    }
    // Out of the sword arc first.
    if (swordArcPush(g, npc, this.arc)) {
      npc.walker?.stop?.();
      npc.moveIntent.x = this.arc.x;
      npc.moveIntent.y = this.arc.y;
      npc.speedMul = 1.6;
      return true;
    }
    if (this.directive === 'stay') return this.waitStep(npc, P);
    return this.followStep(npc, P, dt, tick);
  }

  waitStep(npc, P) {
    const at = this.waitAt || (this.waitAt = { x: npc.x, y: npc.y });
    const d = Math.hypot(npc.x - at.x, npc.y - at.y);
    if (d > 12) {
      npc.speedMul = 1.2;
      if (!npc.walker.active) npc.walker.goTo(at.x, at.y);
      npc.walker.step(1 / 30);
      return true;
    }
    npc.walker.stop();
    npc.speedMul = 1;
    if (Math.hypot(P.x - npc.x, P.y - npc.y) < 160) npc.faceToward?.(P.x, P.y);
    return true;
  }

  followStep(npc, P, dt, tick) {
    const g = this.game;
    const d = Math.hypot(P.x - npc.x, P.y - npc.y);
    if (d > CATCH_UP_TILES * TILE && !onScreen(g, npc.x, npc.y, 24) && this.catchUp(npc, P)) return true;
    if (!this.moving && d > FOLLOW_FAR) this.moving = true;
    else if (this.moving && d < FOLLOW_NEAR) this.moving = false;
    if (!this.moving) {
      npc.walker.stop();
      npc.speedMul = 1;
      if (d < 120) npc.faceToward?.(P.x, P.y);
      return true;
    }
    // Keep up with someone who walks twice as fast as a smith: run when far behind. Behind a
    // faster stranger (Grace points, boots, a haste), run as fast as they go, a little more to
    // close the gap, up to Lyra's own top run (TOP_RUN), as she does (Version 12, §39.4).
    const own = Math.max(1, Number(npc.speed) || 40);
    const pace = Math.max(0, Number(P.speed) || 0);
    const catchUp = d > 4 * TILE ? Math.min(TOP_RUN, pace * (d > 12 * TILE ? 1.15 : 1.05)) / own : 0;
    npc.speedMul = Math.max(d > 12 * TILE ? 2.3 : d > 4 * TILE ? 2 : 1.6, catchUp);
    const spot = this.slot(P);
    const goal = npc.walker.goal;
    if (tick || !goal || Math.hypot(goal.x - spot.x, goal.y - spot.y) > 24) npc.walker.goTo(spot.x, spot.y);
    const res = npc.walker.step(dt);
    if (res === 'stuck' && tick) npc.walker.goTo(P.x, P.y);
    return true;
  }

  // A spot a little behind the player, on whichever side they already are.
  slot(P) {
    const fx = P.facing?.x ?? 0;
    const fy = P.facing?.y ?? 1;
    const n = Math.hypot(fx, fy) || 1;
    return { x: P.x - (fx / n) * 22, y: P.y - (fy / n) * 22 };
  }

  // Far behind and out of sight: they arrive from the direction they were in, on a walkable
  // tile out of view when one exists (as Lyra does, DESIGN §10).
  catchUp(npc, P) {
    const g = this.game;
    const base = Math.atan2(npc.y - P.y, npc.x - P.x);
    for (const r of [11, 9, 7, 4]) {
      for (const o of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
        const x = P.x + Math.cos(base + o) * r * TILE;
        const y = P.y + Math.sin(base + o) * r * TILE;
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        if (safe(() => g.isBlockedTile?.(tx, ty, npc), true)) continue;
        const cx = tx * TILE + TILE / 2;
        const cy = ty * TILE + TILE / 2;
        if (r > 4 && onScreen(g, cx, cy, 8)) continue;
        npc.x = cx;
        npc.y = cy;
        npc.walker.stop();
        this.moving = true;
        return true;
      }
    }
    return false;
  }

  // The nearest thing hostile to the player or to them, within reach, that they can see.
  foe() {
    const g = this.game;
    const npc = this.npc;
    const P = g.player;
    const list = g.entities?.list || safe(() => g.entities?.all?.(), []) || [];
    let best = null;
    let bd = Infinity;
    for (const e of list) {
      if (!e || e === npc || e === P || e.type !== 'actor' || e.removed || e.dead || e.downed) continue;
      if (e.profile || e.id === 'lyra') continue; // never a person of the village on their own say
      if (typeof e.isAlive === 'function' && !e.isAlive()) continue;
      const dn = Math.hypot(e.x - npc.x, e.y - npc.y);
      const dp = Math.hypot(e.x - P.x, e.y - P.y);
      const d = Math.min(dn, dp);
      if (d > FOE_RANGE || d >= bd) continue;
      const hostile = safe(() => g.combat?.isHostile?.(e, P), false) || safe(() => g.combat?.isHostile?.(e, npc), false);
      if (!hostile) continue;
      if (this.stance === 'defend' && dp > 90 && dn > 90) continue; // only what comes at you
      if (!this.sees(e)) continue;
      best = e;
      bd = d;
    }
    return best;
  }

  canFight() {
    return this.stance !== 'passive' && fightAbility(this.game, this.npc) >= 1;
  }

  // Into the fight beside you: provoked by the foe (so the fight holds against an animal
  // that went for you, not only against monsters) and leashed to you.
  engage(foe) {
    const npc = this.npc;
    const P = this.game.player;
    this.provoke(foe);
    npc.startFight(foe, { anchor: P, leash: FIGHT_LEASH });
  }

  provoke(foe) {
    const npc = this.npc;
    npc.provokedBy = foe;
    npc.provokedMode = 'fight';
    npc.provokedAt = safe(() => this.game.combat?.now?.(), null) ?? this.game.time ?? 0;
  }

  // Runs before the NPC's own perceive (attachDuty): in a fight beside you they hold their
  // ground instead of fleeing; out of one, they take on what threatens you first.
  // -> true when it took the beat (their own perceive is skipped).
  beforePerceive() {
    if (this.ended) return false;
    const npc = this.npc;
    if (npc.carrying || npc.mode === 'patient' || npc.mode === 'rescue') return false;
    if (npc.mode === 'fight') {
      const t = npc.fightTarget;
      if (t && t !== this.game.player && !t.removed && !t.dead) {
        this.provoke(t);
        return true;
      }
      return false;
    }
    if (npc.mode === 'flee' || npc.mode === 'help') return false;
    if (!this.canFight()) return false;
    const foe = this.foe();
    if (!foe) return false;
    this.engage(foe);
    return true;
  }

  sees(e) {
    const g = this.game;
    if (!g.map?.buildingAt) return true;
    return !!safe(() => seesActor(g, this.npc, e), true);
  }

  // Should they go home now? -> { why, line } | null (checked every couple of seconds).
  wantsToLeave() {
    const g = this.game;
    const npc = this.npc;
    const t = g?.clock?.t ?? 0;
    const hrs = (t - this.lastHourT) / (g?.clock?.secondsPerHour || DAY_SECONDS / 24);
    this.lastHourT = t;
    const entry = ownEntry(g, npc);
    if (entry?.activity === 'work' && hrs > 0 && hrs < 6) this.workAway += hrs;
    const say = (why, kind) => ({ why, line: companionLine(npc.id, kind, { name: firstName(npc) }) });
    const hour = hourOf(g);
    if (entry?.activity === 'sleep' || hour >= 22 || hour < 5) return say('night', 'leave_night');
    if (this.terms?.untilDark && g?.clock?.isNight) return say('night', 'leave_night');
    if (npc.mode !== 'fight' && Number(npc.maxHp) > 0 && npc.hp / npc.maxHp < LEAVE_HP) return say('hurt', 'leave_hurt');
    if (Number.isFinite(npc.opinionOfPlayer) && npc.opinionOfPlayer < LEAVE_OPINION) return say('opinion', 'leave_opinion');
    const st = safe(() => g.village?.standing?.(npc.id), null);
    if ((st?.grievance?.fresh && (st.grievance.weight ?? 0) >= 6) || npc.wrongedDay === g?.clock?.day) return say('grievance', 'leave_grievance');
    if (safe(() => g.murder?.fearOf?.(npc), null)) return say('fear', 'leave_fear');
    if (knowsWanted(g, npc)) return say('fear', 'leave_fear');
    if (this.workAway > WORK_HOURS_AWAY) return say('work', 'leave_work');
    return null;
  }

  // An order from the Ask bar (or the chat's act). -> { ok, refused, verdict, message }
  request(cmd) {
    const id = ACT_ORDER[cmd] || cmd;
    const o = ORDERS[id];
    const npc = this.npc;
    const name = firstName(npc);
    const answer = (decision, kind) => {
      const message = companionLine(npc.id, kind, { name });
      return { ok: decision !== 'refuse', refused: decision === 'refuse', verdict: { decision, message }, message };
    };
    if (!o) return answer('refuse', 'no_any');
    if (o.directive) {
      this.directive = o.directive;
      this.waitAt = o.directive === 'stay' ? { x: npc.x, y: npc.y } : null;
      return answer('accept', `ok_${id}`);
    }
    if (o.stance !== 'passive' && fightAbility(this.game, npc) < 1) {
      this.stance = 'passive';
      return answer('accept_conditional', 'no_fight');
    }
    if (o.stance === 'attack' && !isFighter(this.game, npc)) {
      this.stance = 'defend';
      return answer('accept_conditional', 'no_attack');
    }
    this.stance = o.stance;
    if (o.stance === 'passive' && npc.mode === 'fight') safe(() => npc.endFight(npc.fightTarget));
    return answer('accept', `ok_${id}`);
  }

  // The duty ends: their day picks up where it is.
  end() {
    if (this.ended) return;
    this.ended = true;
    const npc = this.npc;
    if (npc.duty === this) npc.duty = null;
    if (npc.mode === 'duty') npc.mode = 'routine';
    npc.speedMul = 1;
    safe(() => npc.walker?.stop?.());
    if (npc.r) npc.r.key = null;
  }

  serialize() {
    return { directive: this.directive, stance: this.stance, terms: this.terms, since: this.since, workAway: Math.round(this.workAway * 10) / 10 };
  }

  static from(game, npc, d = {}) {
    return new CompanionDuty(game, npc, d || {});
  }
}

// Put a duty on a villager (game.party.take does this). Their own perceive is wrapped so
// the duty speaks first; detachDuty puts it back.
export function attachDuty(game, npc, opts = {}) {
  if (!npc) return null;
  if (npc.duty && !npc.duty.ended) npc.duty.end();
  const duty = opts instanceof CompanionDuty ? opts : new CompanionDuty(game, npc, opts);
  npc.duty = duty;
  if (!npc._ownPerceive) {
    const own = npc.perceive;
    npc._ownPerceive = own;
    npc.perceive = function perceiveWithDuty() {
      const d = this.duty;
      if (d && !d.ended && d.beforePerceive()) return undefined;
      return own.call(this);
    };
  }
  return duty;
}

export function detachDuty(npc) {
  if (!npc) return;
  npc.duty?.end?.();
  npc.duty = null;
  if (npc._ownPerceive) {
    if (Object.prototype.hasOwnProperty.call(npc, 'perceive')) delete npc.perceive;
    npc._ownPerceive = null;
  }
}

export function orderOfAct(act) {
  return ACT_ORDER[act] || (ORDERS[act] ? act : null);
}

export function pronounOf(npc) {
  return heShe(npc);
}

function onScreen(game, x, y, margin = 16) {
  const c = game?.camera;
  if (!c || !c.vw || !c.vh) return false;
  return x >= c.x - margin && y >= c.y - margin && x <= c.x + c.vw + margin && y <= c.y + c.vh + margin * 2;
}
