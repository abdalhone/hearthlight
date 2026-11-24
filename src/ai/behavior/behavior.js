import { TILE, PLAYER_ID } from '../../core/constants.js';
import { itemDef, resolveItemId } from '../../entities/items.js';
import { resolveEntity, resolveLocation, normalizeRef } from '../resolve.js';
import { Steering } from './steering.js';
import { CombatAI, selectTarget, isFriend, isThreat, isInnocent, canHarm, ATTACK_RADIUS, STANCES, SELF_DEFENSE_SECONDS } from './combat_ai.js';
import { JobRunner, DIRECTIVE_JOBS } from './jobs.js';
import { IdleLife } from './idle.js';
import { OwnLife, OWN_DIRECTIVES } from './own_life.js';
import {
  LOW_HP_DISENGAGE,
  DISENGAGE_RECOVER,
  companionshipOf,
  isTogether,
  need,
  inBounds,
  dangerousPlaceAt,
  isTooRisky,
  asLocation,
  chooseSafePlace,
  threatsNear,
  fightWinnable,
  lovedDownedNearby,
  swordArcPush,
  inSwordArc,
  openSpotAway,
  allowedAt,
} from './safety.js';
import { runTask, endTask, taskStatus, EMOTES, resolveEmote, handItems } from './tasks.js';
import { say } from './lines.js';
import { line, rand, chance, clamp, dist, tileOf, tileCenter, walkable, nearestWalkable, isActorAlive, lineOfSight, clearShot, nameOf, relOf, goalPhrase, placePhrase, objectName, safe } from './util.js';

// Lyra's body-level mind: her standing order (directive), combat stance, and the
// priority list that runs every step (DESIGN §10, §16.5):
//   1 downed (handled by the Companion) · 2 self-preservation (running, leaving,
//   getting out of a fight she is losing) and survival (potions, healing herself) ·
//   3 support · 4 combat per stance · critical needs · tasks (interact, give, sit,
//   sleep, emote) · 5 the directive · 6 idle life.
// Standing orders persist until changed; she never asks permission per enemy. Her
// own life (independent, flee, leave, keep_away, wait_outside) lives in own_life.js.

export const DIRECTIVE_TYPES = ['follow', 'stay', 'wait', 'goto', 'job', 'guard', 'patrol', 'explore', 'free', ...OWN_DIRECTIVES];
export const BIND_COOLDOWN = 20;
export const BIND_SECONDS = 3;
const BIND_RANGE = 140;
export const FOLLOW_DISTANCES = ['close', 'normal', 'far'];
export const HEAL_COOLDOWN = 12;
export const LOW_HP = 0.35;
const SUPPORT_HP = 0.5;
const PLAYER_IDLE_LIFE = 6; // seconds the player stands still before her idle life starts
// She fights back (DESIGN §16.6, r8): with everything she has, until they fall.
const FIGHT_BIND_CD = 9; // the Stillring comes round faster when she fights for her life
const FIGHT_HELP_GAP = 12; // she shouts for the watch again this often while nobody comes
const FIGHT_LET_GO = 6; // seconds out of reach (they ran) before she lets them go
const FIGHT_FAR = 18 * TILE;
const FIGHT_HIT_STOP = 0.32; // the blow that drops them
const AFTER_STAND = 3.2 * TILE; // where she stands while they lie there
const AFTER_MAX = 150; // seconds she keeps watch over the fallen
const FOLLOW_DEFAULT = Object.freeze({ type: 'follow', target: 'player', distance: 'normal' });

const STANCE_WORDS = {
  attack: 'attack',
  aggressive: 'attack',
  offensive: 'attack',
  offense: 'attack',
  aggro: 'attack',
  hunt: 'attack',
  kill: 'attack',
  defend: 'defend',
  defensive: 'defend',
  defense: 'defend',
  defence: 'defend',
  protect: 'defend',
  guard: 'defend',
  passive: 'passive',
  peaceful: 'passive',
  pacifist: 'passive',
  calm: 'passive',
  hold: 'passive',
  self: 'self_defense',
  selfdefense: 'self_defense',
  selfdefence: 'self_defense',
};

export function normalizeStance(mode) {
  if (!mode) return null;
  const n = String(mode)
    .toLowerCase()
    .replace(/self[\s_-]*defen[cs]e/g, 'selfdefense')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\b(mode|stance|be|go|get|set|to)\b/g, ' ')
    .trim()
    .split(/\s+/)[0];
  return STANCE_WORDS[n] || null;
}

// Directives are plain data (saved, shown, sent to Claude): never live entities.
function plainDirective(d) {
  if (!d || typeof d !== 'object') return null;
  return JSON.parse(JSON.stringify(d));
}

export class Behavior {
  constructor(game, actor) {
    this.game = game;
    this.actor = actor;
    this.directive = { ...FOLLOW_DEFAULT };
    this.stance = 'defend';
    this.t = 0;
    this.steering = new Steering(game, actor);
    this.combatAI = new CombatAI(this);
    this.jobs = new JobRunner(this);
    this.idle = new IdleLife(this);
    this.task = null;
    this.target = null;
    this.focusTarget = null;
    this.memory = new Map(); // entity -> { vsPlayer, vsSelf, byPlayer } (behavior time)
    this.healCd = 0;
    this.potionCd = 0;
    this.eatCd = 0;
    this.retreatT = 0;
    this.scanT = 0;
    this.memoryT = 0;
    this.pendingVictory = false;
    this.barkAt = -99;
    this.lastSpokeAt = -99;
    this.brainSpokeAt = -99;
    this.speaking = false;
    this.errAt = -99;
    this.playerIdleT = 0;
    this.playerSpeed = 0;
    this.pfx = 0; // player's recent heading
    this.pfy = 1;
    this.px = NaN;
    this.py = NaN;
    this.waitLeft = 0;
    this.goal = null; // resolved goto / guard target
    this.patrol = null; // { points, i, pauseT }
    this.explore = null; // { loc, point, visited, goal, pauseT, seen }
    this.bedFailedAt = -999;
    this.gotoBlockedT = 0;
    this.holdReturning = false;
    this.freeReturning = false;
    // Her own life and self-preservation (DESIGN §16).
    this.own = new OwnLife(this);
    this.idleAnchor = null; // where her own-life idling centers
    this.disengaging = null; // { t, clearT, dest, repickT } while getting out of a losing fight
    this.coverSaidAt = -99;
    this.bindCd = 0;
    this.bound = null; // { target, fxT } while Binding Light holds someone
    this.lastPlayerHitAt = -99;
    this.deliberateHits = [0, 0, 0, 0].map(() => -99); // ring of times the player hit her on purpose
    this.hitI = 0;
    this.autoSD = null; // { prev, until } while self-defense was switched on by being attacked
    this.fightBack = null; // { target, t, ... } while she fights someone until they fall (§16.6)
    this.afterFight = null; // { target, t, ... } while they lie where she put them
    this.riskT = 0;
    this.riskSaidAt = -99;
    this.tendT = 2;
    this.restAt = -99;
    this.starveSaidAt = -99;
    this.lastSpeechText = '';
    this.lastSpeechAt = -99;
    this.sleepPos = null;
    this.arcPush = { x: 0, y: 0 };
    this.threatBuf = [];
    this.subscribe();
  }

  // --- wiring ---

  subscribe() {
    const bus = this.game.bus;
    if (!bus?.on) return;
    bus.on('damage', (p) => this.onDamage(p));
    bus.on('attack', (p) => this.onAttack(p));
    bus.on('death', (p) => this.onDeath(p));
    bus.on('downed', (p) => {
      if (p?.entity === this.actor) this.onDowned();
      else if (this.fightBack && p?.entity === this.fightBack.target) this.onFoeDropped(p.by);
    });
    bus.on('revived', (p) => p?.entity === this.actor && this.onRevived(p.by));
    bus.on('player_wake', () => this.onPlayerWake());
    bus.on('player_sleep', () => this.onPlayerSleep());
    bus.on('speech', (p) => {
      if (p?.speaker !== this.actor) return;
      if (!this.speaking) this.brainSpokeAt = this.t;
      this.lastSpeechText = p.text || '';
      this.lastSpeechAt = this.t;
    });
  }

  rec(e) {
    let r = this.memory.get(e);
    if (!r) {
      r = { vsPlayer: -99, vsSelf: -99, byPlayer: -99 };
      this.memory.set(e, r);
    }
    return r;
  }

  onDamage(p) {
    const src = p?.source;
    const tgt = p?.target;
    if (!src || !tgt || src === tgt || src.type !== 'actor') return;
    const player = this.game.player;
    if (tgt === player && src !== this.actor) this.rec(src).vsPlayer = this.t;
    if (tgt === this.actor) {
      // A weave that caught her on its way to something else is no attack on her.
      if (src === player && p.accident) {
        this.lastPlayerHitAt = this.t;
        this.scanT = 0;
        return;
      }
      this.rec(src).vsSelf = this.t;
      if (src === player) this.onHitByPlayer(p);
      // Woken or startled out of a seat by a hit.
      if (this.task && (this.task.kind === 'sleep' || this.task.kind === 'sit')) this.cancelTask();
      this.idle.reset();
    }
    if (src === player && tgt !== this.actor) this.rec(tgt).byPlayer = this.t;
    this.scanT = 0;
  }

  // The player's sword hit her. An accident when something hostile is right next to
  // her and it is the first hit in 8 s (DESIGN §16.2); otherwise on purpose. Being hit
  // on purpose again (or at all, once she has left) switches self-defense on.
  onHitByPlayer(p = {}) {
    const accident = !p.deliberate && this.hostileWithin(48) && this.t - this.lastPlayerHitAt > 8;
    this.lastPlayerHitAt = this.t;
    if (accident) return;
    this.deliberateHits[this.hitI] = this.t;
    this.hitI = (this.hitI + 1) % this.deliberateHits.length;
    let recent = 0;
    for (const h of this.deliberateHits) if (this.t - h < 20) recent++;
    const s = companionshipOf(this.game);
    if (recent >= 2 || s === 'left' || s === 'gone') this.enterSelfDefense();
  }

  // ------------------------------------------------------------------ fighting back

  // DESIGN §16.6 (r8; the author: "she can fight me until I die"): someone came at her
  // meaning it — the player, again and again — and her mind chose to stand rather than
  // run. She turns and fights with everything she has: the Stillring to hold them, bolts,
  // staff strikes when they close in, cover and her own healing when she is hurt, and she
  // shouts for the watch until someone comes. It ends when they fall (she never finishes
  // them; §27 takes it from there), when they run out of reach, or when she breaks off.
  startFightBack(target, opts = {}) {
    const g = this.game;
    const a = this.actor;
    if (!target || target.type !== 'actor' || !isActorAlive(target) || a.downed) return { ok: false };
    if (this.fightBack?.target === target) return { ok: true, already: true };
    this.cancelTask();
    this.idle.reset();
    this.disengaging = null;
    this.retreatT = 0;
    this.afterFight = null;
    this.steering.reset();
    if (this.stance !== 'self_defense') this.setStance('self_defense');
    this.autoSD = null;
    this.fightBack = { target, t: 0, farT: 0, helpT: opts.calledHelp ? FIGHT_HELP_GAP : 0, lineT: 5 + rand() * 3, coverT: 0, coverCd: 4, cover: null, hurtSaid: false, askedBreak: false, lastStand: !!opts.lastStand, reason: opts.reason || 'attacked', downedBy: null };
    this.focusTarget = target;
    this.target = target;
    a.faceToward(target.x, target.y);
    safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'anger'));
    // The Stillring first, if they are in reach: hold them, then turn on them.
    this.bindCd = 0;
    const bound = this.bind(target);
    this.bindCd = bound.ok ? FIGHT_BIND_CD : 0.6;
    // What she says as she turns comes a beat after whatever she just said.
    if (opts.say !== false) this.fightBack.pendingLine = { at: this.t + (bound.ok ? 1.6 : 0.8), text: opts.line || say.fightBackStart() };
    safe('bus.emit', () => g.bus?.emit?.('lyra_fight', { phase: 'start', target, reason: this.fightBack.reason }));
    return { ok: true };
  }

  fightingBack(e = null) {
    return !!this.fightBack && (!e || this.fightBack.target === e);
  }

  // Survival asks before sending her to the one she just fought down (§27): she holds
  // back and sends for Mira and the watch, until she relents.
  holdsBackFrom(fallen) {
    if (fallen && this.fightBack?.target === fallen) return true;
    const af = this.afterFight;
    return !!af && !af.relented && af.target === fallen;
  }

  endFightBack(reason = 'over') {
    const fb = this.fightBack;
    if (!fb) return;
    const g = this.game;
    const T = fb.target;
    this.fightBack = null;
    this.focusTarget = null;
    this.target = null;
    this.steering.reset();
    const fallen = reason === 'fallen';
    if (fallen) this.afterFight = { target: T, t: 0, said: !!fb.droppedSaid, fetched: false, relented: false, byHer: fb.downedBy === this.actor };
    else if (reason === 'fled') this.say(say.fightBackLetGo(), { force: true, kind: 'shout' });
    // Her stance comes back down once nobody is left to fight; her mind decides the rest.
    this.autoSD = { prev: 'defend', until: this.t + (fallen ? 4 : 10), quiet: fallen };
    safe('bus.emit', () => g.bus?.emit?.('lyra_fight', { phase: 'end', target: T, reason, byHer: fb.downedBy === this.actor, seconds: Math.round(fb.t) }));
  }

  // The fight-back blow that drops them: a beat of stillness, then her words.
  onFoeDropped(by) {
    const fb = this.fightBack;
    if (!fb) return;
    const g = this.game;
    const a = this.actor;
    const src = by && by.type === 'projectile' ? by.owner : by;
    fb.downedBy = src || null;
    if (src === a) {
      g.hitStop = Math.max(g.hitStop || 0, FIGHT_HIT_STOP);
      safe('camera.shake', () => g.camera?.shake?.(3, 0.3));
      safe('lighting.flash', () => g.lighting?.flash?.({ x: fb.target.x, y: fb.target.y - 8, r: 70, color: '#cbbcff', intensity: 1, duration: 0.5 }));
    }
    fb.droppedSaid = this.say(say.fightBackDropped(), { force: true, kind: 'say' });
  }

  fightBackStep(dt) {
    const fb = this.fightBack;
    const g = this.game;
    const a = this.actor;
    const T = fb.target;
    fb.t += dt;
    if (!T || T.removed || T.dead) {
      this.endFightBack('gone');
      return false;
    }
    const fallen = !!(T.downed || safe('survival.isFallen', () => g.survival?.isFallen?.(T), false));
    if (fallen) {
      this.endFightBack('fallen');
      return false;
    }
    const d = dist(a.x, a.y, T.x, T.y);
    fb.farT = d > FIGHT_FAR ? fb.farT + dt : 0;
    if (fb.farT > FIGHT_LET_GO) {
      this.endFightBack('fled');
      return false;
    }
    const frac = a.maxHp > 0 ? a.hp / a.maxHp : 1;
    // Badly hurt mid-fight, she weighs it again: break off and run, or a last stand.
    if (frac < 0.25 && !fb.askedBreak) {
      fb.askedBreak = true;
      const choice = safe('autonomy.fightOrFlee', () => a.mind?.autonomy?.fightOrFlee?.('hurt', { midFight: true }), 'fight');
      if (choice === 'flee') {
        if (this.fightBack) this.endFightBack('broke');
        return false;
      }
      fb.lastStand = true;
      if (!fb.hurtSaid) fb.hurtSaid = this.say(say.fightBackHurt(), { force: true, kind: 'say' });
    }
    // She shouts for the watch until someone comes (her mind's call carries her reasons).
    fb.helpT -= dt;
    if (fb.helpT <= 0) {
      fb.helpT = FIGHT_HELP_GAP;
      safe('autonomy.callForHelp', () => a.mind?.autonomy?.callForHelp?.(T, { reason: 'attacked', severity: 3 }));
    }
    // Hurt: a potion, or her own lumencraft from behind cover.
    if (frac < 0.4 && this.potionCd <= 0 && a.inventory?.has?.('potion')) {
      this.potionCd = 6;
      if (this.consume('potion')) return true;
    }
    if (this.coverStep(dt, fb, T, d, frac)) return true;
    // The Stillring first: hold them, then strike.
    if (this.bindCd <= 0 && d < BIND_RANGE && !(T.rootTime > 0.4)) {
      const r = this.bind(T);
      if (r.ok) {
        this.bindCd = FIGHT_BIND_CD;
        return true;
      }
      this.bindCd = 0.8;
    }
    if (fb.pendingLine && this.t >= fb.pendingLine.at) {
      this.say(fb.pendingLine.text, { force: true, kind: 'shout', target: T });
      fb.pendingLine = null;
    }
    fb.lineT -= dt;
    if (fb.lineT <= 0) {
      fb.lineT = 7 + rand() * 5;
      this.say(say.fightBackMid(), { kind: 'shout', target: T });
    }
    this.target = T;
    this.focusTarget = T;
    this.combatAI.fight(T, dt, { fierce: true, stayOut: false });
    return true;
  }

  // Cover (hurt, and they are out of reach of a staff): a spot a few steps away where a
  // wall or a trunk stands between them; she heals there, then comes back out.
  coverStep(dt, fb, T, d, frac) {
    const g = this.game;
    const a = this.actor;
    fb.coverCd -= dt;
    if (fb.cover) {
      fb.coverT += dt;
      const c = fb.cover;
      const arrived = this.steering.moveTo(c.x, c.y, dt, { arrive: 6, run: 1.35 }) === 'arrived';
      if (arrived) {
        this.steering.stop();
        a.faceToward(T.x, T.y);
        if (this.healCd <= 0) {
          const amt = this.castHeal(a);
          this.healCd = amt != null ? HEAL_COOLDOWN * 0.7 : 2;
        }
      }
      const exposed = lineOfSight(g, a.x, a.y - 8, T.x, T.y - 8) && arrived;
      if (fb.coverT > 3.5 || d < 34 || (exposed && fb.coverT > 1)) {
        fb.cover = null;
        fb.coverCd = 9;
      }
      return !!fb.cover;
    }
    if (fb.coverCd > 0 || frac >= 0.5 || d < 48 || this.healCd > 0) return false;
    const spot = this.findCover(T);
    fb.coverCd = spot ? 9 : 3;
    if (!spot) return false;
    fb.cover = spot;
    fb.coverT = 0;
    this.say(say.fightBackCover(), { kind: 'say' });
    return true;
  }

  findCover(T) {
    const g = this.game;
    const a = this.actor;
    let best = null;
    let bestS = -Infinity;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      for (const r of [22, 36, 50]) {
        const x = a.x + Math.cos(ang) * r;
        const y = a.y + Math.sin(ang) * r;
        if (!walkable(g, tileOf(x), tileOf(y), a)) continue;
        if (lineOfSight(g, x, y - 8, T.x, T.y - 8)) continue;
        if (!lineOfSight(g, a.x, a.y - 4, x, y - 4)) continue;
        const away = dist(x, y, T.x, T.y) - dist(a.x, a.y, T.x, T.y);
        const s = away * 0.5 - r * 0.4;
        if (s > bestS) {
          bestS = s;
          best = { x, y };
        }
      }
    }
    return best;
  }

  // After the fight (§27 takes the fall): she stands off, says it is over, and sends for
  // Mira and the watch. She never finishes them. If nobody comes and their time runs
  // short, she comes herself (LORE §7: she never leaves a living person to die when she
  // could carry them).
  afterFightStep(dt) {
    const af = this.afterFight;
    const g = this.game;
    const a = this.actor;
    const T = af.target;
    af.t += dt;
    const sv = g.survival;
    const rec = safe('survival.falls', () => sv?.falls?.get?.(T), null);
    if (!T || T.removed || T.dead || !rec || af.t > AFTER_MAX || af.relented) {
      this.afterFight = null;
      return false;
    }
    if (!af.said && af.t > 0.9) af.said = this.say(say.fightBackDropped(), { force: true, kind: 'say' }) || true;
    if (!af.fetched && af.t > 2.6) {
      af.fetched = true;
      this.say(say.fightBackFetch(), { force: true, kind: 'shout' });
      // Her shout carries further than a fallen stranger's call.
      safe('survival.alert', () => sv?.alert?.(rec, 460, { from: a }));
      safe('bus.emit', () => g.bus?.emit?.('lyra_fight', { phase: 'fetch', target: T }));
    }
    // Nobody else has come, and their time is running short: she relents.
    const others = [...(rec.responders || [])].some((e) => e !== a);
    if (af.fetched && !others && !rec.carrier && rec.left < rec.window * 0.45) {
      af.relented = true;
      this.say(say.fightBackRelent(), { force: true, kind: 'say' });
      safe('survival.assignJob', () => sv?.assignJob?.(a, rec, 'lyra'));
      safe('bus.emit', () => g.bus?.emit?.('lyra_fight', { phase: 'relent', target: T }));
      this.afterFight = null;
      return false;
    }
    // Keep a few steps off, facing them.
    const d = dist(a.x, a.y, T.x, T.y);
    if (d < AFTER_STAND - 8) {
      const ux = (a.x - T.x) / (d || 1);
      const uy = (a.y - T.y) / (d || 1);
      if (walkable(g, tileOf(a.x + ux * 12), tileOf(a.y + uy * 12), a)) this.steering.setIntent(ux, uy, 0.8, 1);
      else this.steering.stop();
    } else if (d > AFTER_STAND * 2.5) {
      this.steering.moveTo(T.x, T.y, dt, { arrive: AFTER_STAND });
    } else this.steering.stop();
    a.faceToward(T.x, T.y);
    return true;
  }

  hostileWithin(r) {
    const g = this.game;
    const a = this.actor;
    const list = g.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === a || e === g.player || e.type !== 'actor' || !isActorAlive(e)) continue;
      if (Math.abs(e.x - a.x) > r || Math.abs(e.y - a.y) > r) continue;
      if (dist(a.x, a.y, e.x, e.y) <= r && isThreat(g, a, e) && !isFriend(g, a, e)) return true;
    }
    return false;
  }

  enterSelfDefense() {
    if (this.stance !== 'self_defense') {
      const prev = this.stance;
      this.setStance('self_defense');
      this.autoSD = { prev, until: this.t + 15 };
      this.bark(say.selfDefense(), 'shout', 3);
    } else if (this.autoSD) this.autoSD.until = this.t + 15;
  }

  // Self-defense she switched on herself ends once nobody has hit her for a while.
  updateSelfDefense() {
    const sd = this.autoSD;
    if (!sd) return;
    if (this.stance !== 'self_defense') {
      this.autoSD = null;
      return;
    }
    if (this.t < sd.until) return;
    this.autoSD = null;
    this.setStance(sd.prev || 'defend');
    const p = this.game.player;
    if (!sd.quiet && p && dist(this.actor.x, this.actor.y, p.x, p.y) < 10 * TILE) this.say(say.selfDefenseOver());
  }

  // Is she fighting `e` because `e` attacked her? (For combat's friendly-fire rules.)
  isDefendingAgainst(e) {
    if (!e || this.stance !== 'self_defense') return false;
    const r = this.memory.get(e);
    if (r && this.t - r.vsSelf < SELF_DEFENSE_SECONDS) return true;
    // The combat rules remember who hurt her for longer than her own heat of the moment.
    const c = this.game.combat;
    return typeof c?.isSelfDefense === 'function' && !!safe('combat.isSelfDefense', () => c.isSelfDefense(this.actor, e), false);
  }

  // The player is a danger to her right now: she has left them, is running from
  // them or keeping away from them, or they are attacking her.
  playerIsDanger() {
    const g = this.game;
    const p = g.player;
    if (!p) return false;
    const s = companionshipOf(g);
    if (s === 'left' || s === 'gone') return true;
    const d = this.directive;
    if ((d.type === 'flee' || d.type === 'keep_away') && (d.from === 'player' || d.from === p.id)) return true;
    if (this.isDefendingAgainst(p)) return true;
    for (let i = 0; i < this.deliberateHits.length; i++) if (this.t - this.deliberateHits[i] < 6) return true;
    return false;
  }

  // Does she want the player's company at the moment?
  playerWelcome() {
    const s = companionshipOf(this.game);
    return s !== 'left' && s !== 'gone' && !this.playerIsDanger();
  }

  // Who she is most likely running from: the player when they are the danger, else
  // whoever she is fighting or whatever threatens her most closely.
  likelyThreat() {
    const g = this.game;
    const a = this.actor;
    if (g.player && this.playerIsDanger()) return g.player;
    if (this.currentTarget) return this.currentTarget;
    const att = a.lastAttacker;
    if (att && att !== g.player && isActorAlive(att) && (g.clock?.t ?? 0) - (a.lastAttackedAt ?? -99) < 10) return att;
    return this.nearestThreat();
  }

  onAttack(p) {
    const att = p?.attacker;
    const tgt = p?.target;
    if (!att || !tgt) return;
    if (tgt === this.game.player && att !== this.actor) this.rec(att).vsPlayer = this.t;
    if (tgt === this.actor && att !== this.game.player) this.rec(att).vsSelf = this.t;
  }

  onDeath(p) {
    const e = p?.entity;
    if (!e) return;
    this.memory.delete(e);
    if (this.focusTarget === e) this.focusTarget = null;
    if (this.target === e) {
      this.target = null;
      this.scanT = 0;
      this.pendingVictory = p.killer === this.actor || p.killer === this.game.player;
    }
  }

  onDowned() {
    // Knocked down mid-fight: the fight is over (her mind takes it from there).
    if (this.fightBack) this.endFightBack('downed');
    this.afterFight = null;
    this.cancelTask();
    this.idle.reset();
    this.target = null;
    this.focusTarget = null;
    this.retreatT = 0;
    this.steering.reset();
    this.steering.stop();
  }

  onRevived() {
    this.steering.reset();
    this.scanT = 0;
    this.disengaging = null;
  }

  // The player's sleep moves Lyra to their side; living apart she wakes where she slept.
  onPlayerSleep() {
    const a = this.actor;
    this.sleepPos = this.livingApart() ? { x: a.x, y: a.y } : null;
  }

  onPlayerWake() {
    const a = this.actor;
    if (this.task?.kind === 'sleep') {
      endTask(this, this.task, !!this.sleepPos);
      this.task = null;
    }
    if (this.sleepPos) {
      const bed = this.lyraBed();
      const spot = bed ? nearestWalkable(this.game, bed.x, bed.y + 8, 2, a) : null;
      a.x = spot?.x ?? this.sleepPos.x;
      a.y = spot?.y ?? this.sleepPos.y;
      this.sleepPos = null;
    }
    this.idle.reset();
    this.steering.reset();
    this.px = NaN;
  }

  // Not traveling with the player right now (her own day, leaving, keeping away).
  livingApart() {
    const t = this.directive.type;
    return t === 'independent' || t === 'leave' || t === 'keep_away' || t === 'flee' || !isTogether(this.game);
  }

  // --- speech ---

  // A short line over her head. Non-forced lines yield to chat replies and to
  // each other; forced ones (deliveries, refusals mid-task) always show.
  say(text, opts = {}) {
    if (!text) return false;
    const now = this.t;
    // The same words from her twice in a row (an order's answer echoed by two systems).
    if (text === this.lastSpeechText && now - this.lastSpeechAt < 3) return false;
    if (!opts.force) {
      if (now - this.lastSpokeAt < 4 || now - this.brainSpokeAt < 6) return false;
      if (this.game.brain?.busy) return false;
    }
    this.lastSpokeAt = now;
    const kind = opts.kind || 'say';
    safe('bubbles.say', () => this.game.bubbles?.say?.(this.actor, text, { kind }));
    this.speaking = true;
    try {
      this.game.bus?.emit?.('speech', { speaker: this.actor, text, target: opts.target ?? null, kind: kind === 'say' ? 'bark' : kind });
    } finally {
      this.speaking = false;
    }
    return true;
  }

  bark(text, kind = 'shout', every = 10) {
    if (this.t - this.barkAt < every) return false;
    if (this.say(text, { kind })) {
      this.barkAt = this.t;
      return true;
    }
    return false;
  }

  // --- main step (the actor's controller) ---

  update(a, dt) {
    this.t += dt;
    this.trackPlayer(dt);
    this.combatAI.tick(dt);
    if (this.healCd > 0) this.healCd -= dt;
    if (this.potionCd > 0) this.potionCd -= dt;
    if (this.eatCd > 0) this.eatCd -= dt;
    if (this.retreatT > 0) this.retreatT -= dt;
    if (this.bindCd > 0) this.bindCd -= dt;
    this.memoryT -= dt;
    if (this.memoryT <= 0) this.pruneMemory();
    try {
      this.updateSelfDefense();
      this.think(dt);
      this.keepOutOfSwing();
      this.updateBound(dt);
    } catch (err) {
      this.steering.stop();
      if (this.t - this.errAt > 5) {
        this.errAt = this.t;
        console.error('[behavior] step failed', err);
      }
    }
    this.steering.updateDoors(dt);
  }

  // Never stand where the player's sword is about to land (DESIGN §16.7).
  keepOutOfSwing() {
    const a = this.actor;
    if (a.downed || a.lockTime > 0 || this.task?.kind === 'sleep') return;
    if (!swordArcPush(this.game, a, this.arcPush)) return;
    if (this.task?.kind === 'sit' || this.task?.kind === 'emote') this.cancelTask();
    const mi = a.moveIntent;
    let x = mi.x * 0.4 + this.arcPush.x;
    let y = mi.y * 0.4 + this.arcPush.y;
    const l = Math.hypot(x, y) || 1;
    mi.x = x / l;
    mi.y = y / l;
    a.speedMul = Math.max(a.speedMul || 1, 1.15);
  }

  // Binding Light's glow while it holds someone.
  updateBound(dt) {
    const bd = this.bound;
    if (!bd) return;
    const t = bd.target;
    if (!t || t.removed || t.dead || !(t.rootTime > 0)) {
      this.bound = null;
      return;
    }
    bd.fxT -= dt;
    if (bd.fxT <= 0) {
      bd.fxT = 0.22;
      const ang = this.t * 5;
      const g = this.game;
      safe('particles.emit', () => g.particles?.emit?.('magic', t.x + Math.cos(ang) * 9, t.y - 2 + Math.sin(ang) * 4, { count: 1 }));
    }
  }

  think(dt) {
    const a = this.actor;
    if (this.task?.kind === 'emote') {
      if (!this.target && !this.anyThreatClose()) {
        if (runTask(this, this.task, dt) === 'done') this.task = null;
        return;
      }
      this.cancelTask();
    }
    // Let a swing, a cast or a flinch play out.
    if (a.lockTime > 0 && (a.state === 'attack' || a.state === 'cast' || a.state === 'hurt')) {
      this.steering.stop();
      return;
    }
    // Fighting for her life (§16.6): nothing else until they fall, run, or she breaks off.
    if (this.fightBack && this.fightBackStep(dt)) return;
    // Someone fell (§27): she comes, whatever is between them (LORE §7: she never leaves a
    // living person to die when she could carry them), or she lies abed at Mira's. While
    // something is still standing over them, her own fighting sense runs instead.
    if (this.game.survival?.stepActor?.(a, dt)) return;
    // The one she fought lies where she put them: she keeps her distance and sends for help.
    if (this.afterFight && this.afterFightStep(dt)) return;
    if (this.survival(dt)) return;
    if (this.preserve(dt)) return;
    if (this.support(dt)) return;
    if (this.combat(dt)) return;
    if (this.tendNeeds(dt)) return;
    if (this.task) {
      const r = runTask(this, this.task, dt);
      if (r === 'done') this.task = null;
      else if (!this.taskShouldYield()) return;
      else this.cancelTask();
    }
    const busy = this.runDirective(dt);
    if (busy) {
      if (this.idle.active) this.idle.reset();
      return;
    }
    this.idleLife(dt);
  }

  trackPlayer(dt) {
    const p = this.game.player;
    if (!p) return;
    if (Number.isNaN(this.px)) {
      this.px = p.x;
      this.py = p.y;
      return;
    }
    const dx = p.x - this.px;
    const dy = p.y - this.py;
    const moved = Math.hypot(dx, dy);
    this.px = p.x;
    this.py = p.y;
    const speed = Math.min(220, dt > 0 ? moved / dt : 0);
    this.playerSpeed += (speed - this.playerSpeed) * Math.min(1, dt * 8);
    if (moved > 0.25 && moved < 40) {
      this.playerIdleT = 0;
      const k = Math.min(1, dt * 10);
      this.pfx += (dx / moved - this.pfx) * k;
      this.pfy += (dy / moved - this.pfy) * k;
      const l = Math.hypot(this.pfx, this.pfy) || 1;
      this.pfx /= l;
      this.pfy /= l;
    } else this.playerIdleT += dt;
  }

  pruneMemory() {
    this.memoryT = 3;
    for (const [e, r] of this.memory) {
      if (!isActorAlive(e) || Math.max(r.vsPlayer, r.vsSelf, r.byPlayer) < this.t - 20) this.memory.delete(e);
    }
  }

  // --- 2 survival ---

  survival() {
    const a = this.actor;
    const frac = a.maxHp > 0 ? a.hp / a.maxHp : 1;
    if (frac >= LOW_HP) {
      if (frac < 0.5 && !this.target && this.eatCd <= 0) {
        this.eatCd = 20;
        const food = this.bestFood(false);
        if (food) this.consume(food);
      }
      return false;
    }
    if (this.potionCd <= 0 && a.inventory?.has?.('potion')) {
      this.potionCd = 5;
      if (this.consume('potion')) {
        this.bark(say.drinkPotion(), 'shout', 4);
        return true;
      }
    }
    if (this.healCd <= 0) {
      const amt = this.castHeal(a);
      if (amt != null) {
        this.healCd = HEAL_COOLDOWN;
        this.bark(say.healSelf(), 'say', 4);
        return true;
      }
    }
    return false;
  }

  // --- 2b self-preservation (DESIGN §16.5): overrides every order ---

  // In a fight under 30% HP she gets out, attack mode or not, unless someone she
  // loves is down beside her and the fight still looks winnable.
  preserve(dt) {
    const g = this.game;
    const a = this.actor;
    if (this.own.exclusive()) return false;
    const frac = a.maxHp > 0 ? a.hp / a.maxHp : 1;
    const ds = this.disengaging;
    if (ds) {
      ds.t += dt;
      const threats = threatsNear(g, a, 170, this.threatBuf);
      ds.clearT = threats.length ? 0 : ds.clearT + dt;
      if ((frac >= DISENGAGE_RECOVER && !threats.length) || ds.clearT > 3 || ds.t > 45) {
        this.disengaging = null;
        this.steering.reset();
        this.say(say.disengageOver());
        return false;
      }
      this.runFromThreats(dt, threats, ds);
      return true;
    }
    if (frac >= LOW_HP_DISENGAGE) return false;
    const threats = threatsNear(g, a, 150, this.threatBuf);
    const fighting = !!this.currentTarget;
    if (!fighting && !threats.length) return false;
    const loved = lovedDownedNearby(g, a);
    if (loved && fightWinnable(g, a, threats)) {
      if (this.t - this.coverSaidAt > 15) {
        this.coverSaidAt = this.t;
        this.bark(say.coverLoved(nameOf(g, loved)), 'shout', 3);
      }
      return false;
    }
    this.disengaging = { t: 0, clearT: 0, dest: null, repickT: 0 };
    this.target = null;
    this.focusTarget = null;
    this.retreatT = 0;
    this.cancelTask();
    this.idle.reset();
    this.steering.reset();
    this.bark(say.disengage(), 'shout', 2);
    g.bus?.emit?.('self_preservation', { actor: a, reason: 'low_hp', stance: this.stance, directive: plainDirective(this.directive) });
    return true;
  }

  // Get clear of `threats`: away from the closest first, then toward safety (the
  // player when she trusts them and they are clear of it, else guards, the inn, the chapel).
  runFromThreats(dt, threats, ds) {
    const g = this.game;
    const a = this.actor;
    let near = null;
    let nd = Infinity;
    for (const e of threats) {
      const d = dist(a.x, a.y, e.x, e.y);
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    if (this.potionCd <= 0 && a.inventory?.has?.('potion')) {
      this.potionCd = 5;
      if (this.consume('potion')) return;
    }
    if (this.healCd <= 0 && nd > 40) {
      const amt = this.castHeal(a);
      this.healCd = amt != null ? HEAL_COOLDOWN : 2;
      if (amt != null) return;
    }
    ds.repickT -= dt;
    if (!ds.dest || ds.repickT <= 0) {
      ds.repickT = 1.5;
      ds.dest = this.safetyPoint(near);
    }
    if (near && nd < 56) {
      const spot = openSpotAway(g, a, near.x, near.y, 88);
      if (spot) {
        this.steering.moveTo(spot.x, spot.y, dt, { arrive: 6, run: 1.45 });
        return;
      }
    }
    if (ds.dest) {
      const r = this.steering.moveTo(ds.dest.x, ds.dest.y, dt, { arrive: 20, run: 1.4, maxNodes: 12000 });
      if (r !== 'moving') this.steering.stop();
    } else this.steering.stop();
  }

  safetyPoint(threat) {
    const g = this.game;
    const a = this.actor;
    const p = g.player;
    if (p && p !== a && isActorAlive(p) && this.playerWelcome() && (!threat || dist(p.x, p.y, threat.x, threat.y) > 48)) {
      // Behind the player, as seen from the threat.
      if (!threat) return { x: p.x, y: p.y };
      const ux = p.x - threat.x;
      const uy = p.y - threat.y;
      const l = Math.hypot(ux, uy) || 1;
      return nearestWalkable(g, p.x + (ux / l) * 24, p.y + (uy / l) * 24, 2, a) || { x: p.x, y: p.y };
    }
    return chooseSafePlace(g, a, threat);
  }

  // --- critical needs: she stops and tends to herself ---

  tendNeeds(dt) {
    this.tendT -= dt;
    if (this.tendT > 0) return false;
    this.tendT = 2;
    const g = this.game;
    const d = this.directive;
    if (d.type === 'flee' || (d.type === 'leave' && d.mode === 'gone')) return false;
    if (need(g, 'hunger') < 0.1) {
      if (this.eatOwnFood()) this.say(say.starving());
      else if (this.t - this.starveSaidAt > 120) {
        this.starveSaidAt = this.t;
        this.say(say.starvingNoFood());
      }
    }
    if (this.task?.tend) return false;
    if (need(g, 'energy') < 0.1 && this.t - this.restAt > 90 && !this.anyThreatClose() && this.task?.kind !== 'sleep') {
      this.restAt = this.t;
      this.startSit(null, 90);
      if (this.task) this.task.tend = true;
      this.say(say.exhausted(), { force: true });
      return true;
    }
    return false;
  }

  // Eat from her own pack (the mind picks what she likes; else the sensible choice).
  eatOwnFood() {
    const m = this.actor.mind;
    if (typeof m?.tryEat === 'function') {
      const id = safe('mind.tryEat', () => m.tryEat({ force: true }), null);
      if (id) return id;
    }
    const food = this.bestFood(false);
    return food && this.consume(food) ? food : null;
  }

  // --- 3 support ---

  support(dt) {
    if (this.healCd > 0) return false;
    const g = this.game;
    const a = this.actor;
    const p = g.player;
    if (!p || p === a || !isActorAlive(p) || !(p.maxHp > 0) || p.hp / p.maxHp >= SUPPORT_HP) return false;
    if (this.own.exclusive() || !this.playerWelcome()) return false;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d > 300) return false;
    if (d > 110 || !clearShot(g, a, p)) {
      this.steering.moveTo(p.x, p.y, dt, { arrive: 50, run: 1.35 });
      return true;
    }
    a.faceToward(p.x, p.y);
    const amt = this.castHeal(p);
    this.healCd = amt != null ? HEAL_COOLDOWN : 3;
    if (amt != null) this.bark(say.healPlayer(), 'say', 3);
    return amt != null;
  }

  castHeal(target) {
    const g = this.game;
    const a = this.actor;
    const c = g.combat;
    if (c && typeof c.castHeal === 'function') {
      const amt = safe('combat.castHeal', () => c.castHeal(a, target), null);
      return amt == null ? null : amt;
    }
    if (c && typeof c.heal === 'function') {
      // Without the spell, a plain heal plus the green shimmer.
      const amt = safe('combat.heal', () => c.heal(a, target, Math.round(10 + (a.level || 1) * 2)), null);
      safe('particles.emit', () => g.particles?.emit?.('heal', target.x, target.y - 10, { count: 10 }));
      return amt;
    }
    return null;
  }

  // Eat or drink from her pack. Returns true when something was consumed.
  consume(itemId) {
    const g = this.game;
    const a = this.actor;
    if (!a.inventory?.has?.(itemId)) return false;
    const c = g.combat;
    if (c && typeof c.useItem === 'function') return !!safe('combat.useItem', () => c.useItem(a, itemId), false);
    const def = itemDef(itemId);
    if (!def?.heal) return false;
    a.inventory.remove(itemId, 1);
    a.hp = Math.min(a.maxHp, a.hp + def.heal);
    g.bus?.emit?.('item_used', { actor: a, itemId });
    return true;
  }

  // The food she'd reach for: enough to matter, without wasting the good stuff.
  bestFood(allowPotion) {
    const a = this.actor;
    const missing = (a.maxHp || 0) - (a.hp || 0);
    let best = null;
    let bestScore = -Infinity;
    for (const { id, qty } of a.inventory?.list?.() || []) {
      const def = itemDef(id);
      if (!def?.heal || qty <= 0) continue;
      if (def.type === 'potion' && !allowPotion) continue;
      if (def.type !== 'food' && def.type !== 'potion') continue;
      // Prefer food that heals about what is missing; raw fish only as a last resort.
      let score = -Math.abs(def.heal - missing) - (def.value || 0) * 0.3;
      if (id === 'raw_fish') score -= 30;
      if (id === 'honey_cake') score -= 8; // saved for a treat
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  // --- 4 combat ---

  anyThreatClose() {
    const g = this.game;
    const a = this.actor;
    const list = g.entities?.list || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === a || e.type !== 'actor' || !isActorAlive(e)) continue;
      if (Math.abs(e.x - a.x) > 70 || Math.abs(e.y - a.y) > 70) continue;
      if (!isFriend(g, a, e) && isThreat(g, a, e)) return true;
    }
    return false;
  }

  combatAnchor() {
    const d = this.directive;
    const g = this.game;
    switch (d.type) {
      case 'independent':
      case 'leave':
        return this.idleAnchor || this.actor;
      case 'keep_away':
      case 'wait_outside':
        return this.actor;
      case 'follow':
        return this.followTarget() || this.actor;
      case 'stay':
      case 'wait':
        return { x: d.x ?? this.actor.x, y: d.y ?? this.actor.y };
      case 'guard':
        return this.guardPoint() || this.actor;
      case 'free':
        return g.player || null;
      default:
        return null;
    }
  }

  guardPoint() {
    const d = this.directive;
    if (d.type !== 'guard') return null;
    if (d.target) {
      const e = d.target === 'player' ? this.game.player : this.game.entities?.get?.(d.target);
      return e && isActorAlive(e) ? e : null;
    }
    return { x: d.x, y: d.y };
  }

  leash() {
    const d = this.directive;
    if (d.type === 'guard') return (d.radius || 96) + 100;
    if (d.type === 'stay' || d.type === 'wait') return 200;
    return 230;
  }

  pickTarget() {
    const g = this.game;
    const a = this.actor;
    const prev = this.target;
    if (this.focusTarget && (!isActorAlive(this.focusTarget) || dist(a.x, a.y, this.focusTarget.x, this.focusTarget.y) > 450)) this.focusTarget = null;
    const gp = this.guardPoint();
    const guarding = this.directive.type === 'guard';
    const radius = guarding ? Math.max(ATTACK_RADIUS, this.directive.radius || 0) : ATTACK_RADIUS;
    // Attack mode is an order for when she travels with the player; living her own
    // day she only fights what threatens her.
    const ownDay = this.directive.type === 'independent' || this.directive.type === 'leave';
    let t = selectTarget({
      game: g,
      self: a,
      stance: ownDay && this.stance === 'attack' ? 'defend' : this.stance,
      player: g.player,
      now: this.t,
      memory: this.memory,
      current: prev,
      focus: this.focusTarget,
      center: gp || a,
      radius,
      guardRadius: guarding ? this.directive.radius || 96 : 0,
    });
    // Do not chase far from where her orders keep her (focus targets excepted).
    const anchor = this.combatAnchor();
    if (t && t !== this.focusTarget && anchor && dist(anchor.x, anchor.y, t.x, t.y) > this.leash()) {
      const r = this.memory.get(t);
      const hittingHer = r && this.t - r.vsSelf < 6 && dist(a.x, a.y, t.x, t.y) < 160;
      if (!hittingHer) t = null;
    }
    // Nor into a place too dangerous for her (§16.5): from outside she shoots what she
    // can see in range, and lets the rest go.
    if (t && !allowedAt(g, a, t.x, t.y) && (dist(a.x, a.y, t.x, t.y) > 120 || !clearShot(g, a, t))) t = null;
    this.target = t;
    if (t && !prev) this.onCombatStart(t);
    if (!t && prev) this.onCombatEnd();
  }

  onCombatStart(t) {
    this.idle.reset();
    if (this.task && this.task.kind !== 'interact' && this.task.kind !== 'give') this.cancelTask();
    this.pendingVictory = false;
    if (chance(0.55)) this.bark(say.combatStart(nameOf(this.game, t)), 'shout', 12);
  }

  onCombatEnd() {
    this.steering.reset();
    if (this.pendingVictory && !this.anyThreatClose() && chance(0.5)) this.bark(say.victory(), 'say', 8);
    this.pendingVictory = false;
  }

  combat(dt) {
    const g = this.game;
    const a = this.actor;
    if (this.own.exclusive()) {
      this.target = null;
      return false;
    }
    if (this.retreatT > 0) {
      const p = g.player;
      if (p && p !== a) {
        const r = this.steering.moveTo(p.x, p.y, dt, { arrive: 18, run: 1.45 });
        if (r === 'arrived' && this.retreatT > 1) this.retreatT = 1;
      } else this.steering.stop();
      this.target = null;
      return true;
    }
    this.scanT -= dt;
    if (this.scanT <= 0 || (this.target && !isActorAlive(this.target))) {
      this.scanT = 0.2;
      this.pickTarget();
    }
    if (!this.target) {
      if (this.stance === 'passive' && this.combatAI.keepAway(dt)) return true;
      return false;
    }
    // Someone she trusted turned on her: Binding Light first, then she answers.
    if (this.target === g.player && this.bindCd <= 0 && dist(a.x, a.y, g.player.x, g.player.y) < BIND_RANGE) {
      const r = this.bind(g.player);
      if (r.ok) return true;
    }
    this.combatAI.fight(this.target, dt, { stayOut: !allowedAt(g, a, this.target.x, this.target.y) });
    return true;
  }

  // Called by the combat AI after a bolt or a stab lands in the world.
  noteAttack() {
    this.idle.reset();
  }

  // --- tasks ---

  taskShouldYield() {
    const t = this.task;
    if (!t || t.kind !== 'sit' || t.phase !== 'seated' || t.tend) return false;
    const d = this.directive;
    if (d.type === 'follow') {
      const target = this.followTarget();
      if (!target) return false;
      const dd = dist(this.actor.x, this.actor.y, target.x, target.y);
      return dd > 5 * TILE || (target === this.game.player && this.playerIdleT < 0.2 && this.playerSpeed > 30 && dd > 3 * TILE);
    }
    if (d.type === 'job' || d.type === 'goto' || d.type === 'patrol' || d.type === 'explore') return t.t > 8;
    return false;
  }

  cancelTask(restore = true) {
    if (!this.task) return;
    endTask(this, this.task, restore);
    this.task = null;
    this.steering.stop();
  }

  startSit(fire = null, maxTime = 0) {
    this.cancelTask();
    this.idle.reset();
    this.task = { kind: 'sit', fire, phase: 'walk', spot: null, t: 0, maxTime };
  }

  startSleep(bed) {
    this.cancelTask();
    this.idle.reset();
    this.task = { kind: 'sleep', bed, phase: 'walk' };
  }

  // Bedtime from 7 PM; once asleep she stays down until 6 AM.
  isBedtime(asleep = false) {
    const h = this.game.clock?.hour;
    if (!Number.isFinite(h)) return false;
    return asleep ? h >= 19 || h < 6 : h >= 19 || h < 5.5;
  }

  // Her bed: the one her plans name (her own at the cottage while she trusts the
  // player, a room at the Ember Kettle otherwise), else her cottage bed.
  lyraBed() {
    const g = this.game;
    const a = this.actor;
    const at = a.mind?.agenda?.sleepAt;
    return (
      (at ? safe('objects.get', () => g.objects?.get?.(at)) : null) ||
      safe('objects.get', () => g.objects?.get?.('lyra_bed')) ||
      safe('objects.nearest', () => g.objects?.nearest?.((o) => o.objType === 'bed' && /lyra/i.test(`${o.id} ${o.name}`), a.x, a.y, Infinity)) ||
      null
    );
  }

  // --- 5 directives ---

  followTarget() {
    const d = this.directive;
    const key = d.type === 'guard' ? d.target : d.target ?? 'player';
    if (!key || key === 'player' || key === PLAYER_ID) return this.game.player || null;
    const e = this.game.entities?.get?.(key);
    return e && isActorAlive(e) ? e : null;
  }

  runDirective(dt) {
    const d = this.directive;
    switch (d.type) {
      case 'follow':
        if (this.followRisk(dt)) return true;
        return this.doFollow(dt, d.distance);
      case 'independent':
      case 'flee':
      case 'leave':
      case 'keep_away':
      case 'wait_outside': {
        const busy = this.own.run(dt);
        if (!busy) this.idleAnchor = this.game.player || this.actor;
        return busy;
      }
      case 'stay':
        return this.doHold(d.x, d.y, dt);
      case 'wait':
        this.waitLeft -= dt;
        if (this.waitLeft <= 0) {
          this.setDirective(d.then || FOLLOW_DEFAULT, { quiet: true });
          this.say(say.waitOver());
          return true;
        }
        return this.doHold(d.x, d.y, dt);
      case 'goto':
        return this.doGoto(dt);
      case 'job':
        return this.doJob(dt);
      case 'guard':
        return this.doGuard(dt);
      case 'patrol':
        return this.doPatrol(dt);
      case 'explore':
        return this.doExplore(dt);
      case 'free':
        return this.doFree(dt);
      default:
        this.directive = { ...FOLLOW_DEFAULT };
        return false;
    }
  }

  // Following the player into a place too dangerous for her: she stops at the
  // entrance and waits outside, and says so (DESIGN §16.5).
  followRisk(dt) {
    this.riskT -= dt;
    if (this.riskT > 0) return false;
    this.riskT = 0.5;
    const g = this.game;
    const a = this.actor;
    const target = this.followTarget();
    if (!target || target !== g.player) return false;
    const loc = dangerousPlaceAt(g, target.x, target.y);
    if (!loc || inBounds(loc, a.x, a.y) || !isTooRisky(g, a, loc)) return false;
    const r = this.setDirective({ type: 'wait_outside', location: loc.id, then: plainDirective(this.directive), risky: true }, { quiet: true });
    if (!r.ok) return false;
    if (this.t - this.riskSaidAt > 25) {
      this.riskSaidAt = this.t;
      this.say(r.message, { force: true });
    }
    return true;
  }

  doFollow(dt, distance = 'normal') {
    const g = this.game;
    const target = this.followTarget();
    if (!target) {
      if (this.directive.target && this.directive.target !== 'player') this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
      this.steering.stop();
      return false;
    }
    const isPlayer = target === g.player;
    const idleT = isPlayer ? this.playerIdleT : (target.moved || 0) < 0.05 ? 2 : 0;
    if (isPlayer && idleT > PLAYER_IDLE_LIFE && this.idle.active) return false;
    const heading = isPlayer && Math.hypot(this.pfx, this.pfy) > 0.5;
    const info = {
      idle: idleT > 0.9,
      speed: isPlayer ? this.playerSpeed : (target.speed || 60) * (target.speedMul || 1),
      fx: heading ? this.pfx : target.facing?.x ?? 0,
      fy: heading ? this.pfy : target.facing?.y ?? 1,
    };
    const r = this.steering.follow(target, distance, dt, info);
    if (r === 'idle') {
      if (isPlayer && idleT > PLAYER_IDLE_LIFE) return false;
      // Settled beside you: look the way you look.
      if (idleT > 1.2 && idleT < 1.25) this.actor.faceDir?.(target.dir || 'down');
    }
    return true;
  }

  doHold(x, y, dt) {
    const a = this.actor;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // Her post is where the player is swinging: hold beside it, not in it.
    if (inSwordArc(this.game, x, y) && !inSwordArc(this.game, a.x, a.y)) {
      this.steering.stop();
      return false;
    }
    if (dist(a.x, a.y, x, y) > 10 || (this.holdReturning && dist(a.x, a.y, x, y) > 3)) {
      this.holdReturning = true;
      const r = this.steering.moveTo(x, y, dt, { arrive: 3 });
      if (r === 'moving') return true;
    }
    this.holdReturning = false;
    this.steering.stop();
    return false;
  }

  doGoto(dt) {
    const d = this.directive;
    const goal = this.goal;
    const a = this.actor;
    if (!goal) {
      this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
      return true;
    }
    if (goal.entity) {
      if (goal.entity.removed || (goal.entity.type === 'actor' && !isActorAlive(goal.entity))) {
        this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
        return true;
      }
      goal.x = goal.entity.x;
      goal.y = goal.entity.y;
    }
    const arrive = goal.entity ? 22 : goal.object ? 6 : 10;
    const near = goal.location ? this.inLocation(goal.location) && dist(a.x, a.y, goal.x, goal.y) < 3 * TILE : false;
    const gx = goal.sx ?? goal.x;
    const gy = goal.sy ?? goal.y;
    const r = near ? 'arrived' : this.steering.moveTo(gx, gy, dt, { arrive, run: dist(a.x, a.y, gx, gy) > 12 * TILE ? 1.2 : 1, ignore: goal.entity || null, maxNodes: 12000 });
    if (r === 'arrived') {
      this.steering.stop();
      const then = d.then || 'stay';
      if (then === 'follow') this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
      else if (then === 'return') this.setDirective(d.prev || FOLLOW_DEFAULT, { quiet: true });
      else this.setDirective({ type: 'stay', x: a.x, y: a.y }, { quiet: true });
      return true;
    }
    if (r === 'locked' || r === 'blocked' || r === 'stuck') {
      this.gotoBlockedT += dt;
      if (r === 'locked' || this.gotoBlockedT > 4) {
        const place = goalPhrase(this.game, goal);
        const f = this.steering.failure;
        this.say(f?.reason === 'locked' ? say.locked(f.door, place) : say.unreachable(place), { force: true });
        this.setDirective(d.then === 'stay' ? { type: 'stay', x: a.x, y: a.y } : { ...FOLLOW_DEFAULT }, { quiet: true });
      }
    } else this.gotoBlockedT = 0;
    return true;
  }

  inLocation(loc) {
    const b = loc?.bounds;
    if (!b) return false;
    const tx = this.actor.x / TILE;
    const ty = this.actor.y / TILE;
    return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  }

  doJob(dt) {
    if (!this.jobs.active) {
      this.onJobEnded(false);
      return true;
    }
    this.jobs.update(dt);
    return true;
  }

  // Called by the job runner when a job finishes or fails: back to the order before it.
  onJobEnded() {
    const d = this.directive;
    if (d.type !== 'job') return;
    const then = d.then && d.then.type !== 'job' ? d.then : FOLLOW_DEFAULT;
    this.setDirective(then, { quiet: true, keepJob: true });
  }

  doGuard(dt) {
    const d = this.directive;
    if (d.target) {
      const e = this.followTarget();
      if (!e) {
        this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
        return true;
      }
      const isPlayer = e === this.game.player;
      const r = this.steering.follow(e, 'close', dt, {
        idle: isPlayer ? this.playerIdleT > 0.9 : (e.moved || 0) < 0.05,
        speed: isPlayer ? this.playerSpeed : e.speed || 60,
        fx: e.facing?.x ?? 0,
        fy: e.facing?.y ?? 1,
      });
      return r !== 'idle' || !(isPlayer && this.playerIdleT > PLAYER_IDLE_LIFE);
    }
    // Hold near the post; idle life (looking around) reads as keeping watch.
    const a = this.actor;
    const r = d.radius || 96;
    if (dist(a.x, a.y, d.x, d.y) > Math.min(40, r * 0.35)) {
      const m = this.steering.moveTo(d.x, d.y, dt, { arrive: 6 });
      if (m === 'moving') return true;
    }
    this.steering.stop();
    return false;
  }

  doPatrol(dt) {
    const pt = this.patrol;
    if (!pt || !pt.points?.length) {
      this.setDirective({ type: 'stay', x: this.actor.x, y: this.actor.y }, { quiet: true });
      return true;
    }
    if (pt.pauseT > 0) {
      const before = pt.pauseT;
      pt.pauseT -= dt;
      this.steering.stop();
      if (before > 0.7 && pt.pauseT <= 0.7) this.actor.faceDir?.(['left', 'right', 'up', 'down'][Math.floor(Math.random() * 4)]);
      return true;
    }
    const p = pt.points[pt.i % pt.points.length];
    const r = this.steering.moveTo(p.x, p.y, dt, { arrive: 8, speed: 0.85 });
    if (r !== 'moving') {
      pt.i = (pt.i + 1) % pt.points.length;
      pt.pauseT = r === 'arrived' ? rand(1.4, 3) : 0.2;
    }
    return true;
  }

  doExplore(dt) {
    const ex = this.explore;
    const a = this.actor;
    if (!ex) {
      this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
      return true;
    }
    if (ex.pauseT > 0) {
      const before = ex.pauseT;
      ex.pauseT -= dt;
      this.steering.stop();
      if (before > 0.9 && ex.pauseT <= 0.9) a.faceDir?.(['left', 'right', 'up', 'down'][Math.floor(Math.random() * 4)]);
      return true;
    }
    if (ex.visited >= ex.goal) return this.finishExplore();
    if (!ex.point) ex.point = this.explorePoint(ex);
    if (!ex.point) return this.finishExplore();
    const r = this.steering.moveTo(ex.point.x, ex.point.y, dt, { arrive: 10, speed: 0.9, maxNodes: 12000 });
    if (r === 'moving') return true;
    ex.visited++;
    ex.point = null;
    ex.pauseT = r === 'arrived' ? rand(1.2, 2.4) : 0.1;
    if (r === 'arrived') this.noteSights(ex);
    return true;
  }

  explorePoint(ex) {
    const g = this.game;
    const a = this.actor;
    const b = ex.loc?.bounds;
    if (!b) return null;
    for (let i = 0; i < 14; i++) {
      const tx = Math.floor(b.x + 1 + Math.random() * Math.max(1, b.w - 2));
      const ty = Math.floor(b.y + 1 + Math.random() * Math.max(1, b.h - 2));
      if (!walkable(g, tx, ty, a)) continue;
      const x = tileCenter(tx);
      const y = tileCenter(ty);
      if (dist(a.x, a.y, x, y) < 4 * TILE && i < 10) continue;
      return { x, y };
    }
    return ex.loc.center ? { x: ex.loc.center.x, y: ex.loc.center.y } : null;
  }

  // Remember what she saw, to report when she's done.
  noteSights(ex) {
    const g = this.game;
    const a = this.actor;
    const found = safe('objects.inRadius', () => g.objects?.inRadius?.(a.x, a.y, 7 * TILE, (o) => !!SIGHT_WORDS[o.objType]), []) || [];
    for (const o of found) {
      const k = SIGHT_WORDS[o.objType];
      ex.seen[k] = (ex.seen[k] || 0) + 1;
    }
  }

  finishExplore() {
    const ex = this.explore;
    const place = placePhrase(ex.loc);
    const best = Object.entries(ex.seen).sort((p, q) => q[1] - p[1])[0];
    const found = best ? `I spotted ${best[0]}, if we need them.` : '';
    this.say(say.exploreDone(place, found), { force: true });
    this.setDirective({ ...FOLLOW_DEFAULT }, { quiet: true });
    return true;
  }

  doFree(dt) {
    const g = this.game;
    const a = this.actor;
    const p = g.player;
    if (g.clock?.isNight && this.t - this.bedFailedAt > 60) {
      const bed = this.lyraBed();
      if (bed) {
        this.startSleep(bed);
        return true;
      }
      this.bedFailedAt = this.t;
    }
    if (p && p !== a && (this.freeReturning || dist(a.x, a.y, p.x, p.y) > 10 * TILE)) {
      this.freeReturning = true;
      const r = this.steering.moveTo(p.x, p.y, dt, { arrive: 4 * TILE, run: dist(a.x, a.y, p.x, p.y) > 20 * TILE ? 1.35 : 1, maxNodes: 12000 });
      if (r === 'moving') return true;
      this.freeReturning = false;
    }
    return false;
  }

  // --- 6 idle life ---

  idleLife(dt) {
    const d = this.directive;
    const own = d.type === 'independent' || d.type === 'leave' || d.type === 'keep_away';
    const mode = d.type === 'free' ? 'free' : d.type === 'follow' || (d.type === 'guard' && d.target) ? 'follow' : own ? 'own' : 'stay';
    if (mode === 'follow' && this.playerIdleT < PLAYER_IDLE_LIFE) {
      this.idle.reset();
      return;
    }
    this.idle.update(dt, mode);
  }

  // --- public interface (DESIGN §10) ---

  setDirective(input, opts = {}) {
    const g = this.game;
    const a = this.actor;
    const d = input && typeof input === 'object' ? input : { type: input };
    if (!DIRECTIVE_TYPES.includes(d.type)) return { ok: false, message: "I'm not sure what you'd like me to do." };
    const prev = this.directive;
    let next;
    let message = '';
    let goal = null;
    let patrol = null;
    let explore = null;
    let ownState = null;
    // Self-preservation outranks orders: she will not walk into a place whose risk is
    // over her limit; she goes as far as the entrance and waits there instead.
    if (!opts.restoring && ['goto', 'explore', 'patrol', 'guard'].includes(d.type)) {
      const risky = this.riskyDestination(d);
      if (risky) {
        const w = this.setDirective({ type: 'wait_outside', location: risky.id, risky: true, then: plainDirective(prev.type === 'follow' ? prev : FOLLOW_DEFAULT) }, { quiet: true });
        return { ok: false, message: say.riskRefuse(placePhrase(risky)), waitingOutside: !!w.ok };
      }
    }
    switch (d.type) {
      case 'follow': {
        const ref = d.target ?? 'player';
        const ent = ref === 'player' || ref === PLAYER_ID ? g.player : resolveEntity(g, ref, a);
        if (!ent) return { ok: false, message: say.noSuchTarget(String(ref)) };
        if (ent === a) return { ok: false, message: "Follow myself? I'd just walk in circles." };
        if (ent.type !== 'actor') return { ok: false, message: `I can't follow ${nameOf(g, ent)}.` };
        const distance = FOLLOW_DISTANCES.includes(d.distance) ? d.distance : 'normal';
        const isPlayer = ent === g.player;
        if (!opts.quiet && prev.type === 'follow' && prev.target === (isPlayer ? 'player' : ent.id) && prev.distance === distance && !this.task) {
          return { ok: true, message: isPlayer ? say.alreadyFollowing() : say.follow(distance, nameOf(g, ent)) };
        }
        next = { type: 'follow', target: isPlayer ? 'player' : ent.id, distance };
        message = say.follow(distance, isPlayer ? null : nameOf(g, ent));
        break;
      }
      case 'stay': {
        const x = Number.isFinite(d.x) ? d.x : a.x;
        const y = Number.isFinite(d.y) ? d.y : a.y;
        next = { type: 'stay', x: Math.round(x), y: Math.round(y) };
        message = say.stay();
        break;
      }
      case 'wait': {
        const seconds = clamp(Number.isFinite(d.seconds) && d.seconds > 0 ? d.seconds : 30, 3, 900);
        let then = d.then;
        if (!then) then = prev.type === 'wait' ? prev.then : prev.type === 'job' ? this.jobSnapshot(prev) : prev;
        if (!then || then.type === 'wait') then = { ...FOLLOW_DEFAULT };
        next = {
          type: 'wait',
          seconds,
          then: plainDirective(then),
          x: Math.round(Number.isFinite(d.x) ? d.x : a.x),
          y: Math.round(Number.isFinite(d.y) ? d.y : a.y),
        };
        this.waitLeft = Number.isFinite(d.remaining) ? clamp(d.remaining, 0, seconds) : seconds;
        message = say.wait(seconds);
        break;
      }
      case 'goto': {
        goal = this.resolveGoal(d.target);
        if (!goal) return { ok: false, message: say.unknownPlace(d.target == null ? 'there' : String(d.target)) };
        if (goal.entity === a) return { ok: false, message: "I'm already where I am. Very zen of me." };
        const then = ['stay', 'follow', 'return'].includes(d.then) ? d.then : 'stay';
        const place = goalPhrase(g, goal);
        if (!opts.restoring && g.pathfinder && !this.steering.plan(goal.sx ?? goal.x, goal.sy ?? goal.y, { maxNodes: 12000 })) {
          const f = this.steering.failure;
          this.steering.reset();
          return { ok: false, message: f?.reason === 'locked' ? say.locked(f.door, place) : say.unreachable(place) };
        }
        next = { type: 'goto', target: goal.ref, then };
        if (then === 'return') next.prev = plainDirective(prev.type === 'goto' ? prev.prev || FOLLOW_DEFAULT : prev);
        message = goal.entity === g.player ? say.comeHere() : say.goto(place, then);
        break;
      }
      case 'job': {
        const jobPlace = !opts.restoring && d.targetRef ? asLocation(g, d.targetRef) : null;
        if (jobPlace && !inBounds(jobPlace, a.x, a.y) && isTooRisky(g, a, jobPlace)) return { ok: false, message: say.riskRefuse(placePhrase(jobPlace)) };
        if (DIRECTIVE_JOBS.includes(d.job)) {
          const alt = d.job === 'patrol' ? { type: 'patrol', location: d.targetRef || null } : d.targetRef ? { type: 'guard', target: d.targetRef } : { type: 'guard' };
          return this.setDirective(alt, opts);
        }
        const snapshot = this.jobs.active ? this.jobs.serialize() : null;
        const r = this.jobs.start({
          job: d.job,
          amount: d.amount,
          deliverTo: d.deliverTo,
          targetRef: d.targetRef ?? null,
          count: d.count,
          gathered: d.gathered,
          resume: !!d.resume,
          quiet: !!d.quiet,
        });
        if (!r.ok) {
          if (snapshot) this.jobs.restore(snapshot);
          return r;
        }
        let then = d.then;
        if (!then) then = prev.type === 'job' || prev.type === 'wait' ? prev.then : prev;
        if (!then || ['stay', 'wait', 'goto', 'job'].includes(then.type)) then = { ...FOLLOW_DEFAULT };
        next = {
          type: 'job',
          job: this.jobs.job.id,
          amount: this.jobs.amount,
          deliverTo: this.jobs.deliverTo,
          targetRef: d.targetRef ?? null,
          then: plainDirective(then),
        };
        message = r.message;
        if (snapshot && prev.type === 'job' && !opts.restoring) g.bus?.emit?.('job_failed', { actor: a, job: snapshot.job, reason: 'Switched to another job.', stopped: true });
        break;
      }
      case 'guard': {
        const radius = clamp(Number.isFinite(d.radius) && d.radius > 0 ? d.radius : 96, 32, 320);
        if (d.target) {
          const ent = d.target === 'player' || d.target === PLAYER_ID ? g.player : resolveEntity(g, d.target, a);
          if (ent && ent.type === 'actor') {
            if (ent === a) return { ok: false, message: 'Guard myself? I do that anyway.' };
            next = { type: 'guard', target: ent === g.player ? 'player' : ent.id, radius };
            message = ent === g.player ? say.guardYou() : say.guardPerson(nameOf(g, ent));
            break;
          }
          goal = this.resolveGoal(d.target);
          if (!goal) return { ok: false, message: say.unknownPlace(String(d.target)) };
          const lb = goal.location?.bounds;
          const r = lb ? clamp((Math.max(lb.w, lb.h) * TILE) / 2, 80, 220) : radius;
          next = { type: 'guard', x: Math.round(goal.x), y: Math.round(goal.y), radius: Number.isFinite(d.radius) ? radius : r, label: goal.location?.id || null };
          message = say.guardPlace(goalPhrase(g, goal));
          goal = null;
          break;
        }
        const x = Number.isFinite(d.x) ? d.x : a.x;
        const y = Number.isFinite(d.y) ? d.y : a.y;
        next = { type: 'guard', x: Math.round(x), y: Math.round(y), radius };
        if (d.label) next.label = d.label;
        message = d.label ? say.guardPlace(placePhrase(safe('locations.get', () => g.locations?.get?.(d.label)))) : say.guardHere();
        break;
      }
      case 'patrol': {
        let loc = null;
        let points = Array.isArray(d.points) ? d.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) : [];
        if (points.length < 2) {
          loc = d.location ? resolveLocation(g, d.location) : safe('locations.at', () => g.locations?.at?.(a.x, a.y));
          if (d.location && !loc) return { ok: false, message: say.unknownPlace(String(d.location)) };
          points = this.patrolPoints(loc);
        } else if (d.location) loc = resolveLocation(g, d.location);
        if (points.length < 2) return { ok: false, message: "I can't find a sensible route to walk here." };
        next = { type: 'patrol', points, location: loc?.id || null };
        patrol = { points, i: Number.isFinite(d.index) ? d.index % points.length : this.nearestIndex(points), pauseT: 0 };
        message = say.patrol(loc ? placePhrase(loc) : { name: 'the area' });
        break;
      }
      case 'explore': {
        const loc = d.location ? resolveLocation(g, d.location) : safe('locations.at', () => g.locations?.at?.(a.x, a.y));
        if (!loc) return { ok: false, message: d.location ? say.unknownPlace(String(d.location)) : "Explore where? Name a place and I'm off." };
        next = { type: 'explore', location: loc.id };
        explore = { loc, point: null, visited: Number.isFinite(d.visited) ? d.visited : 0, goal: 8, pauseT: 0, seen: {} };
        message = say.explore(placePhrase(loc));
        break;
      }
      case 'free':
        next = { type: 'free' };
        message = say.free();
        break;
      default: {
        if (!OWN_DIRECTIVES.includes(d.type)) return { ok: false, message: "I'm not sure what you'd like me to do." };
        const r = this.own.setup(d, prev);
        if (!r.ok) return r;
        next = r.next;
        message = r.message;
        ownState = r.state;
      }
    }

    // Commit.
    if (prev.type === 'job' && next.type !== 'job' && this.jobs.active && !opts.keepJob) {
      const snap = this.jobs.serialize();
      this.jobs.stop();
      if (next.type !== 'wait' && !opts.restoring) g.bus?.emit?.('job_failed', { actor: a, job: snap?.job ?? prev.job, reason: 'Stopped to do something else.', stopped: true });
    }
    // Her mind revising her day re-issues the same kind of directive: she carries on
    // with what she is doing (a job half done, a seat by the fire) instead of starting over.
    const carry = this.own.canCarry(prev, next);
    if (carry) {
      if (this.task && !this.task.own) this.cancelTask();
    } else {
      this.own.clear();
      this.cancelTask();
      this.idle.reset();
      if (next.type !== 'goto') this.steering.reset();
      this.steering.stop();
    }
    this.directive = next;
    this.goal = goal;
    this.patrol = patrol;
    this.explore = explore;
    if (ownState) this.own.begin(ownState, carry);
    if (!carry) this.idleAnchor = null;
    this.gotoBlockedT = 0;
    this.holdReturning = false;
    this.freeReturning = false;
    if (!opts.silent) g.bus?.emit?.('directive_changed', { directive: plainDirective(next), previous: plainDirective(prev) });
    return { ok: true, message };
  }

  // The dangerous place a goto/explore/patrol/guard order would take her into, when
  // it is over her limit and she is not in it already; else null.
  riskyDestination(d) {
    const g = this.game;
    const a = this.actor;
    let loc = null;
    if (d.type === 'explore' || d.type === 'patrol') loc = d.location ? asLocation(g, d.location) : null;
    else {
      const ref = d.target;
      if (ref == null || ref === '' || (d.type === 'guard' && (ref === 'player' || ref === PLAYER_ID))) return null;
      const goal = safe('resolveGoal', () => this.resolveGoal(ref), null);
      if (!goal) return null;
      if (goal.entity && goal.entity.type === 'actor') return null; // going to someone, not somewhere
      loc = goal.location && (goal.location.danger || 0) >= 1 ? goal.location : dangerousPlaceAt(g, goal.x, goal.y);
    }
    if (!loc || inBounds(loc, a.x, a.y)) return null;
    return isTooRisky(g, a, loc) ? loc : null;
  }

  // The job directive as it stands now, with progress, so a wait can resume it.
  jobSnapshot(prev) {
    const s = this.jobs.serialize();
    if (!s) return { ...FOLLOW_DEFAULT };
    return { type: 'job', ...s, then: prev.then, resume: true };
  }

  nearestIndex(points) {
    const a = this.actor;
    let bi = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  }

  // A loop of walkable points around a location (or around her when it's unknown).
  patrolPoints(loc) {
    const g = this.game;
    const a = this.actor;
    const out = [];
    const frames = [];
    if (loc?.bounds) {
      const b = loc.bounds;
      const cx = (b.x + b.w / 2) * TILE;
      const cy = (b.y + b.h / 2) * TILE;
      const rx = Math.max(2, b.w * 0.3) * TILE;
      const ry = Math.max(2, b.h * 0.3) * TILE;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        frames.push([cx + Math.cos(ang) * rx, cy + Math.sin(ang) * ry]);
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
        frames.push([a.x + Math.cos(ang) * 5 * TILE, a.y + Math.sin(ang) * 5 * TILE]);
      }
    }
    for (const [x, y] of frames) {
      const s = nearestWalkable(g, x, y, 4, a);
      if (s && !out.some((p) => p.x === Math.round(s.x) && p.y === Math.round(s.y))) out.push({ x: Math.round(s.x), y: Math.round(s.y) });
    }
    return out;
  }

  // Resolve a place/person/object reference into a goal:
  // { kind, x, y, sx?, sy? (stand spot), entity?, location?, object?, ref (string to save) }
  resolveGoal(ref) {
    const g = this.game;
    const a = this.actor;
    if (ref == null || ref === '') return null;
    if (typeof ref === 'object') {
      if (ref.objType) return this.objectGoal(ref);
      if (ref.bounds) return this.locationGoal(ref);
      if (ref.type === 'actor' || ref.type === 'pickup') return { kind: 'entity', entity: ref, x: ref.x, y: ref.y, ref: ref.id };
      if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) return { kind: 'point', x: ref.x, y: ref.y, ref: `${Math.round(ref.x)},${Math.round(ref.y)}` };
      return null;
    }
    const raw = String(ref).trim();
    const n = normalizeRef(raw);
    const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { kind: 'point', x: parseFloat(m[1]), y: parseFloat(m[2]), ref: `${m[1]},${m[2]}` };
    if (/^(here|this spot|this place|right here|spot|place)$/.test(n)) return { kind: 'point', x: a.x, y: a.y, ref: `${Math.round(a.x)},${Math.round(a.y)}` };
    if (/^(me|myself|us|player|you know who)$/.test(n) && g.player) return { kind: 'entity', entity: g.player, x: g.player.x, y: g.player.y, ref: 'player' };
    if (/^(home|my home|our home|cottage|my house|our house|my cottage|our cottage)$/.test(n)) {
      const home = safe('locations.get', () => g.locations?.get?.('player_home'));
      if (home) return this.locationGoal(home);
    }
    const obj = safe('objects.get', () => g.objects?.get?.(raw));
    if (obj) return this.objectGoal(obj);
    const direct = g.entities?.get?.(raw);
    if (direct && !direct.removed) return { kind: 'entity', entity: direct, x: direct.x, y: direct.y, ref: direct.id };
    const loc = safe('locations.find', () => g.locations?.get?.(raw) || resolveLocation(g, raw));
    const ent = resolveEntity(g, raw, a);
    // A named person beats a loose place match ("Bram" is Bram, not his smithy).
    if (ent && ent !== a && (!loc || (ent.name && normalizeRef(ent.name).includes(n)))) return { kind: 'entity', entity: ent, x: ent.x, y: ent.y, ref: ent.id };
    if (loc) return this.locationGoal(loc);
    const word = safe('objects.findByWord', () => g.objects?.findByWord?.(n, a.x, a.y));
    if (word) return this.objectGoal(word);
    return null;
  }

  locationGoal(loc) {
    const c = loc.center || { x: (loc.bounds.x + loc.bounds.w / 2) * TILE, y: (loc.bounds.y + loc.bounds.h / 2) * TILE };
    return { kind: 'location', location: loc, x: c.x, y: c.y, ref: loc.id };
  }

  objectGoal(o) {
    const g = this.game;
    const a = this.actor;
    const tx = o.tx ?? tileOf(o.x);
    const ty = o.ty ?? tileOf(o.y - 1);
    const s = !o.solid && o.objType !== 'door' && walkable(g, tx, ty, a) ? { x: tileCenter(tx), y: tileCenter(ty) } : nearestWalkable(g, tileCenter(tx), tileCenter(ty + 1), 2, a);
    return { kind: 'object', object: o, x: o.x, y: o.y, sx: s?.x, sy: s?.y, ref: o.id };
  }

  setStance(mode) {
    const m = normalizeStance(mode);
    if (!m) return { ok: false, message: say.stanceUnknown() };
    const prev = this.stance;
    if (m === prev) return { ok: true, message: say.stanceSame(m) };
    this.stance = m;
    if (m !== 'self_defense') this.autoSD = null;
    if (m === 'passive' || m === 'self_defense') {
      this.focusTarget = null;
      this.target = null;
    }
    this.scanT = 0;
    this.game.bus?.emit?.('stance_changed', { stance: m, previous: prev });
    return { ok: true, message: say.stance(m) };
  }

  focus(entityOrRef) {
    const g = this.game;
    const a = this.actor;
    let e = null;
    if (entityOrRef && typeof entityOrRef === 'object') e = entityOrRef;
    else if (entityOrRef != null && String(entityOrRef).trim()) e = resolveEntity(g, String(entityOrRef), a);
    else e = this.nearestThreat();
    const label = entityOrRef && typeof entityOrRef !== 'object' ? String(entityOrRef) : 'anything';
    if (!e) return { ok: false, message: entityOrRef ? say.noSuchTarget(label) : say.nothingToFight() };
    if (e === a) return { ok: false, message: say.refuseSelf() };
    if (e.type !== 'actor' || !isActorAlive(e)) return { ok: false, message: say.noSuchTarget(nameOf(g, e)) };
    if (isFriend(g, a, e)) {
      if (e === g.player) return { ok: false, message: say.refusePlayer() };
      const rel = relOf(g, e);
      if (Array.isArray(rel?.tags) && rel.tags.includes('pet')) return { ok: false, message: say.refusePet(nameOf(g, e)) };
      return { ok: false, message: say.refuseFriend(nameOf(g, e)) };
    }
    // Villagers and pets she will not raise a hand against unless they struck first.
    if (!canHarm(g, a, e)) return { ok: false, message: say.refuseInnocent(nameOf(g, e)) };
    if (dist(a.x, a.y, e.x, e.y) > 420) return { ok: false, message: say.tooFar(nameOf(g, e)) };
    if (!allowedAt(g, a, e.x, e.y) && (dist(a.x, a.y, e.x, e.y) > 120 || !clearShot(g, a, e))) {
      const place = dangerousPlaceAt(g, e.x, e.y);
      return { ok: false, message: say.riskRefuse(placePhrase(place)) };
    }
    this.cancelTask();
    this.idle.reset();
    const hadTarget = !!this.target;
    this.focusTarget = e;
    this.target = e;
    this.retreatT = 0;
    this.scanT = 0.2;
    if (!hadTarget) this.pendingVictory = false;
    return { ok: true, message: say.focus(nameOf(g, e)) };
  }

  nearestThreat() {
    const g = this.game;
    const a = this.actor;
    return g.entities?.nearest?.(a.x, a.y, 220, (e) => e !== a && e.type === 'actor' && isActorAlive(e) && !isFriend(g, a, e) && isThreat(g, a, e)) || null;
  }

  clearFocus() {
    if (this.target === this.focusTarget) this.target = null;
    this.focusTarget = null;
    this.scanT = 0;
  }

  retreat() {
    // When the player is the danger, regrouping with them is no retreat: she runs.
    if (this.playerIsDanger() && this.game.player) return this.setDirective({ type: 'flee', from: 'player' });
    this.clearFocus();
    this.target = null;
    this.cancelTask();
    this.idle.reset();
    const d = this.directive;
    const withPlayer = (d.type === 'follow' && (d.target ?? 'player') === 'player') || (d.type === 'guard' && d.target === 'player');
    if (!withPlayer && d.type !== 'job') this.setDirective({ type: 'follow', target: 'player', distance: 'close' }, { quiet: true });
    this.retreatT = 6;
    this.steering.reset();
    return { ok: true, message: say.retreat() };
  }

  // Binding Light (DESIGN §16.9): roots someone in place for 3 s; 20 s cooldown.
  bind(ref = null) {
    const g = this.game;
    const a = this.actor;
    let t = null;
    if (ref && typeof ref === 'object') t = ref;
    else if (ref != null && String(ref).trim()) t = resolveEntity(g, String(ref), a);
    else t = this.likelyThreat();
    if (!t || t.type !== 'actor' || !isActorAlive(t)) return { ok: false, message: ref ? say.noSuchTarget(String(ref)) : say.noBindTarget() };
    if (t === a) return { ok: false, message: say.refuseSelf() };
    const who = nameOf(g, t);
    if (this.bindCd > 0) return { ok: false, message: say.bindCooldown(this.bindCd) };
    if (t !== g.player && isInnocent(g, a, t) && !this.isDefendingAgainst(t) && !(t.target && t.target.type === 'actor')) return { ok: false, message: say.bindRefuse(who) };
    if (dist(a.x, a.y, t.x, t.y) > BIND_RANGE || !(clearShot(g, a, t) || lineOfSight(g, a.x, a.y - 8, t.x, t.y - 8))) return { ok: false, message: say.bindTooFar(who) };
    t.rootTime = Math.max(t.rootTime || 0, BIND_SECONDS);
    this.bindCd = BIND_COOLDOWN;
    this.bound = { target: t, fxT: 0 };
    a.faceToward(t.x, t.y);
    a.setState('cast', 0.45);
    this.steering.stop();
    // A ring of arcane light around their feet, a flash, a chime.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      safe('particles.emit', () => g.particles?.emit?.('magic', t.x + Math.cos(ang) * 11, t.y - 2 + Math.sin(ang) * 5, { count: 2 }));
    }
    safe('particles.emit', () => g.particles?.emit?.('magic', a.x + (t.x - a.x) * 0.1, a.y - 14, { count: 6 }));
    safe('lighting.flash', () => g.lighting?.flash?.({ x: t.x, y: t.y - 8, r: 52, color: '#b9a6ff', intensity: 1, duration: 0.6 }));
    safe('audio.play', () => g.audio?.play?.('magic', { x: t.x, y: t.y }));
    safe('bubbles.icon', () => g.bubbles?.icon?.(t, '!'));
    const text = say.bind(who);
    this.say(text, { force: true, kind: 'shout', target: t });
    g.bus?.emit?.('bind', { source: a, target: t, seconds: BIND_SECONDS });
    if (t === g.player || t.profile) {
      safe('mind.remember', () =>
        a.mind?.remember?.(t === g.player ? 'I had to bind you with Binding Light to stop you.' : `I bound ${t.name || who} with Binding Light.`, { importance: 6, about: [t.id], type: 'event', tags: ['binding_light'] }),
      );
    }
    return { ok: true, message: text };
  }

  // A sharp warning (DESIGN §16.9): a shouted bubble, a speech event, a memory.
  warn(ref = null, text = null) {
    const g = this.game;
    const a = this.actor;
    let t = null;
    if (ref && typeof ref === 'object') t = ref;
    else if (ref != null && String(ref).trim()) t = resolveEntity(g, String(ref), a);
    else t = g.player;
    if (!t || t.type !== 'actor') return { ok: false, message: say.noSuchTarget(String(ref ?? 'them')) };
    if (t === a) return { ok: false, message: "Warn myself? Consider me warned." };
    const who = nameOf(g, t);
    const words = String(text || '').trim().slice(0, 140) || (t === g.player ? say.warnPlayer() : say.warnOther(who));
    a.faceToward(t.x, t.y);
    safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'anger'));
    this.say(words, { force: true, kind: 'shout', target: t });
    safe('mind.remember', () => a.mind?.remember?.(`I warned ${t === g.player ? 'you' : t.name || who}: "${words}"`, { importance: 6, about: [t.id], type: 'event', tags: ['warning'] }));
    return { ok: true, message: words };
  }

  emote(name) {
    const key = resolveEmote(name);
    if (key === 'sit') return this.sit();
    const def = key ? EMOTES[key] : null;
    if (!def) return { ok: false, message: say.emoteUnknown(String(name ?? '')) };
    this.cancelTask();
    this.idle.reset();
    this.task = { kind: 'emote', name: key, def, t: 0 };
    return { ok: true, message: line(`emote.${key}`, def.line) };
  }

  // Sit down where she is, or by a fire/bench close by.
  sit() {
    const g = this.game;
    const a = this.actor;
    const fire = safe('objects.nearest', () => g.objects?.nearest?.((o) => o.objType === 'campfire' || o.objType === 'hearth', a.x, a.y, 6 * TILE));
    const seat = fire ? null : safe('objects.nearest', () => g.objects?.nearest?.((o) => o.objType === 'chair' || o.objType === 'bench', a.x, a.y, 4 * TILE));
    this.startSit(fire || null, 0);
    if (seat) this.task.spot = nearestWalkable(g, seat.x, seat.y - 4, 1, a) || { x: a.x, y: a.y };
    return { ok: true, message: say.sit(!!fire) };
  }

  // Go to her bed and sleep (night only).
  goToSleep() {
    if (!this.isBedtime()) return { ok: false, message: say.sleepNotTired() };
    const bed = this.lyraBed();
    if (!bed) return { ok: false, message: say.sleepNoBed() };
    this.startSleep(bed);
    return { ok: true, message: say.goingToBed() };
  }

  interactWith(objectOrEntity, op = null) {
    const g = this.game;
    const a = this.actor;
    let t = objectOrEntity;
    if (!t || typeof t !== 'object') {
      const goal = this.resolveGoal(t);
      t = goal?.object || goal?.entity || null;
    }
    if (!t) return { ok: false, message: say.cantFind(typeof objectOrEntity === 'string' ? objectOrEntity : null) };
    if (t === a) return { ok: false, message: "I'm right here. Fully interacted with." };
    this.cancelTask();
    this.idle.reset();
    const name = t.objType ? objectName(t) : nameOf(g, t);
    const label = t.objType === 'door' ? (op === 'close' ? 'closing the door' : 'getting the door') : `heading to ${name}`;
    this.task = { kind: 'interact', target: t, op, label };
    if (t.objType === 'door') return { ok: true, message: say.doorWill(op !== 'close') };
    return { ok: true, message: say.interactAck(name) };
  }

  // Walk to someone and hand over items from her pack.
  giveItem(toRef, itemRef, qty = 1) {
    const g = this.game;
    const a = this.actor;
    const to = !toRef || toRef === 'player' ? g.player : typeof toRef === 'object' ? toRef : resolveEntity(g, toRef, a);
    if (!to || to.type !== 'actor') return { ok: false, message: say.noSuchTarget(String(toRef ?? 'them')) };
    if (to === a) return { ok: false, message: 'Give it to myself? Done. That was easy.' };
    if (!itemRef) return { ok: false, message: a.inventory?.isEmpty?.() ? say.giveNothing() : say.giveWhat() };
    const n = Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1;
    if (/^(everything|all|all of it|it all|your stuff|everything you have)$/i.test(String(itemRef).trim())) return this.giveEverything(to);
    const itemId = resolveItemId(itemRef);
    if (!itemId) return { ok: false, message: `I don't know what "${itemRef}" is.` };
    const have = a.inventory?.count?.(itemId) || 0;
    if (!have) return { ok: false, message: say.noItem(itemId) };
    if (n >= 999) return this.giveItem(to, itemId, have); // "all your wood"
    const who = nameOf(g, to);
    if (dist(a.x, a.y, to.x, to.y) <= 40) {
      a.faceToward(to.x, to.y);
      const given = handItems(this, to, itemId, n, false);
      return { ok: true, message: given < n ? say.givePartial(itemId, given, n) : say.giveOk(itemId, given, who) };
    }
    this.cancelTask();
    this.idle.reset();
    this.task = { kind: 'give', to, itemId, qty: n };
    return { ok: true, message: have < n ? say.givePartial(itemId, have, n) : say.giveComing(who) };
  }

  giveEverything(to) {
    const a = this.actor;
    const g = this.game;
    const items = (a.inventory?.list?.() || []).filter((i) => i.id !== 'coin' && itemDef(i.id)?.type !== 'quest');
    if (!items.length) return { ok: false, message: say.giveNothing() };
    if (dist(a.x, a.y, to.x, to.y) > 40) {
      this.cancelTask();
      this.task = { kind: 'give', to, itemId: items[0].id, qty: items[0].qty };
      return { ok: true, message: say.giveComing(nameOf(g, to)) };
    }
    for (const it of items) handItems(this, to, it.id, it.qty, false);
    return { ok: true, message: 'Here — everything in my pack. Travel light, they say.' };
  }

  // Eat or drink something from her pack ("eat something" when no item is named).
  eat(itemRef) {
    const a = this.actor;
    const vague = itemRef == null || /^(something|anything|food|a snack|snack|some food)$/i.test(String(itemRef).trim());
    let id = vague ? null : resolveItemId(itemRef);
    if (!vague && !id) return { ok: false, message: `I don't know what "${itemRef}" is.` };
    if (!id) id = this.bestFood(a.hp < a.maxHp * LOW_HP);
    if (!id) return { ok: false, message: say.nothingToEat() };
    const def = itemDef(id);
    if (!a.inventory?.has?.(id)) return { ok: false, message: say.noItem(id) };
    if (!def || (def.type !== 'food' && def.type !== 'potion')) return { ok: false, message: say.notFood(id) };
    if (!this.consume(id)) return { ok: false, message: say.notFood(id) };
    return { ok: true, message: say.ate(id) };
  }

  // Collect nearby pickups (optionally only one kind of item); she keeps them.
  pickUp(itemRef = null) {
    const vague = !itemRef || /^(it|that|this|those|them|everything|all|stuff|loot|the loot|things|that up|it up)$/i.test(String(itemRef).trim());
    const lootRef = vague ? null : itemRef;
    const r = this.setDirective({ type: 'job', job: 'collect_loot', deliverTo: 'keep', targetRef: lootRef, quiet: true });
    if (!r.ok && lootRef) return { ok: false, message: say.nothingToPickUp(resolveItemId(lootRef)) };
    return r;
  }

  startJob(spec) {
    return this.setDirective({ type: 'job', ...spec });
  }

  stopJob() {
    if (this.directive.type !== 'job' || !this.jobs.active) {
      if (this.directive.type === 'wait' && this.directive.then?.type === 'job') {
        this.directive.then = { ...FOLLOW_DEFAULT };
        return { ok: true, message: say.jobStopped('job') };
      }
      return { ok: false, message: say.noJob() };
    }
    const label = this.jobs.job?.label || 'work';
    const snap = this.jobs.serialize();
    this.jobs.stop();
    this.game.bus?.emit?.('job_failed', { actor: this.actor, job: snap?.job ?? null, reason: 'Stopped on request.', stopped: true });
    const then = this.directive.then && this.directive.then.type !== 'job' ? this.directive.then : FOLLOW_DEFAULT;
    this.setDirective(then, { quiet: true, keepJob: true });
    return { ok: true, message: say.jobStopped(label) };
  }

  comeHere() {
    const p = this.game.player;
    if (!p) return { ok: false, message: "I can't see you!" };
    if (dist(this.actor.x, this.actor.y, p.x, p.y) < 30 && this.directive.type === 'follow') return { ok: true, message: "I'm right here!" };
    const r = this.setDirective({ type: 'goto', target: 'player', then: 'follow' });
    if (r.ok) r.message = say.comeHere();
    return r;
  }

  get currentTarget() {
    return this.target && isActorAlive(this.target) ? this.target : null;
  }

  // The active job as plain data ({ job, amount, deliverTo, count, ... }) or null.
  get job() {
    return this.jobs.active ? this.jobs.serialize() : null;
  }

  status() {
    const g = this.game;
    const a = this.actor;
    if (a.downed) return 'downed';
    if (this.task?.kind === 'sleep' && this.task.phase === 'asleep') return 'sleeping';
    if (this.disengaging) return 'getting out of the fight';
    if (this.retreatT > 0) return 'retreating';
    const t = this.currentTarget;
    if (t) return `fighting ${nameOf(g, t)}`;
    if (this.task) {
      const s = taskStatus(this, this.task);
      if (s) return s;
    }
    // The standing order always leads; a small idle flourish may trail it.
    const d = this.directive;
    const extra = this.idle.flourish();
    const withIdle = (s) => (extra && extra !== s ? `${s}, ${extra}` : s);
    switch (d.type) {
      case 'follow': {
        const who = this.followTarget();
        return withIdle(!who || who === g.player ? 'following you' : `following ${nameOf(g, who)}`);
      }
      case 'stay':
        return withIdle('holding position');
      case 'wait':
        return withIdle(`waiting (${Math.max(0, Math.ceil(this.waitLeft))} s)`);
      case 'goto':
        return this.goal?.entity === g.player ? 'coming to you' : `heading ${goalPhrase(g, this.goal).to}`;
      case 'job':
        return this.jobs.status() || 'working';
      case 'guard': {
        if (d.target === 'player') return withIdle('guarding you');
        if (d.target) return withIdle(`guarding ${nameOf(g, g.entities?.get?.(d.target))}`);
        if (d.label) return withIdle(`guarding ${placePhrase(safe('locations.get', () => g.locations?.get?.(d.label))).name}`);
        return withIdle('standing guard');
      }
      case 'patrol': {
        const loc = d.location ? safe('locations.get', () => g.locations?.get?.(d.location)) : null;
        return loc ? `patrolling ${placePhrase(loc).name}` : 'patrolling';
      }
      case 'explore':
        return `exploring ${placePhrase(this.explore?.loc).name}`;
      case 'free':
        return extra ? `free time, ${extra}` : 'free time, staying near you';
      case 'independent':
      case 'leave':
      case 'keep_away':
      case 'wait_outside':
        return withIdle(this.own.status() || 'living her own day');
      case 'flee':
        return this.own.status() || 'running for safety';
      default:
        return 'thinking';
    }
  }

  serialize() {
    const d = this.directive;
    // Self-defense she switched on in the heat of a fight is not a standing stance.
    const stance = this.autoSD ? this.autoSD.prev || 'defend' : this.stance;
    const out = { v: 1, stance, directive: plainDirective(d) };
    if (d.type === 'job') out.job = this.jobs.serialize();
    if (d.type === 'wait') out.waitLeft = Math.round(this.waitLeft * 10) / 10;
    if (d.type === 'patrol' && this.patrol) out.patrolIndex = this.patrol.i;
    if (d.type === 'explore' && this.explore) out.exploreVisited = this.explore.visited;
    return out;
  }

  deserialize(data) {
    if (!data || typeof data !== 'object') return;
    if (STANCES.includes(data.stance)) this.stance = data.stance;
    const d = data.directive;
    if (!d || !DIRECTIVE_TYPES.includes(d.type)) return;
    const opts = { quiet: true, silent: true, restoring: true };
    let r;
    if (d.type === 'job') {
      const j = data.job || d;
      r = this.setDirective({ ...d, ...j, type: 'job', job: j.job || d.job, resume: true }, opts);
      if (r.ok && j.delivering) this.jobs.beginDeliver();
    } else if (d.type === 'wait') {
      r = this.setDirective({ ...d, remaining: data.waitLeft }, opts);
    } else if (d.type === 'patrol') {
      r = this.setDirective({ ...d, index: data.patrolIndex }, opts);
    } else if (d.type === 'explore') {
      r = this.setDirective({ ...d, visited: data.exploreVisited }, opts);
    } else {
      r = this.setDirective(d, opts);
    }
    if (!r?.ok) this.setDirective({ ...FOLLOW_DEFAULT }, opts);
  }
}

const SIGHT_WORDS = {
  herb: 'herb patches',
  moonpetal: 'moonpetals',
  berry_bush: 'berry bushes',
  ore: 'iron ore',
  ore_iron: 'iron ore',
  crystal: 'glow crystals',
  chest: 'a chest',
  campfire: 'an old campfire',
};
