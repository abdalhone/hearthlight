// The boss actor. One class for all five: the numbers come from defs.js, the fighting
// from a brain (src/bosses/ai_*.js), the look from src/art/bosses_art.js. It is a
// Creature, so the rest of the game (Lyra's targeting, combat, perception, barks)
// treats it as one, but it runs its own controller:
//
//   mode: 'idle' (at home, waiting) | 'hidden' (not out right now: Greyjaw by day, the
//         Lake's Hum below) | 'fight' | 'defeat' (beaten: plays out, then dies or yields)
//         | 'gone' (removed) | 'reset' (one frame while it snaps back after a lost fight)
//
// A brain is { moves: {name: spec}, init(b), update(b, dt), onPhase(b, phase),
//              onHurt?(b, src, dealt, kind), hitMul?(b, src, amount, opts), defeat?(b, dt),
//              drawOver?(ctx, b, x, y, time), light?(b) }
// A move spec is { windup, active, recover (seconds or (b, m) => seconds),
//                  anim: {windup, active, recover}, begin(b, m), windupTick(b, m, dt, k),
//                  strike(b, m), activeTick(b, m, dt, k), end(b, m), cooldown, invuln }

import { Creature } from '../entities/monsters.js';
import { Actor } from '../entities/entity.js';
import { alive, speak, pickLine } from '../entities/creature_util.js';
import { drawBossSprite, bossAnimInfo } from '../art/bosses_art.js';
import { updateMarkers, drawMarkers, clearMarkers, pickFoe, stop, particles, flashLight, sound } from './kit.js';
import { clearHazards } from './hazards.js';

const TAU = Math.PI * 2;

// A boss defends (round 15, DESIGN §22.3; the author: "bosses are too easy … I killed her in 2
// hits … make it have a really good damage and a really good defense"). On top of its armour
// (`def`: combat takes it off every blow, never below the armour floor's share) and its
// resistances (`resist` by damage type, read by combat.resistMul):
//   - the blow cap: one blow takes at most BLOW_SHARE of its health, whatever the charge, the
//     crit or the twists (combat.damage asks capBlow after armour, crits and wards);
//   - the guard: when one hand has struck it for GUARD_AT of its health inside about
//     GUARD_TAU seconds, it raises a guard for GUARD_TIME seconds (a shimmer of its own colour,
//     "guarded" over it): what lands meanwhile is GUARD_MUL of the blow. Struck as hard again
//     while it guards (what gets through counts), it holds the guard GUARD_LONGER more, up to
//     GUARD_MAX: pressing it only makes it hold. When the guard falls the slate is clean: an
//     opening to strike. A guard raised again inside GUARD_AGAIN seconds of the last starts
//     GUARD_LONGER longer.
// Each hand counts on its own, so a companion's blows add to yours. No time limit, no enrage:
// the length of a fight comes from its strength (health, armour, guard) and its blows.
export const BLOW_SHARE = 0.03;
export const GUARD_AT = 0.04;
export const GUARD_TAU = 2.2; // s: how fast a hand's recent harm fades
export const GUARD_TIME = 3;
export const GUARD_MUL = 0.12;
export const GUARD_AGAIN = 6;
export const GUARD_LONGER = 1.2;
export const GUARD_MAX = 6;

export class Boss extends Creature {
  constructor(game, info, brain, o = {}) {
    super(game, info.base || 'bandit_chief', { id: info.entityId, name: info.name, x: o.x, y: o.y, home: o.home || { x: o.x, y: o.y } });
    this.info = info;
    this.bossId = info.id;
    this.boss = true;
    this.species = info.species;
    this.kind = info.kind;
    this.faction = info.faction;
    this.baseFaction = info.faction;
    this.maxHp = info.hp;
    this.hp = info.hp;
    this.atk = info.atk;
    this.def = info.def;
    this.resist = info.resist ? { ...info.resist } : null;
    this.guardT = 0; // the guard (round 15): seconds it still holds
    this.guardUp = false;
    this.guardEnd = -99; // the fight clock when the last guard fell
    this.guardLen = GUARD_TIME;
    this.struck = new Map(); // hand -> { harm, t }: recent harm from each hand, fading
    this.speed = info.speed;
    this.baseSpeed = info.speed;
    this.radius = info.radius;
    this.mass = info.mass ?? 3;
    this.xpValue = info.xp;
    this.drops = [];
    this.threat = 3;
    this.aggroRadius = 0; // the manager starts fights, not proximity scans
    this.leashRadius = 9999;
    this.superArmor = true;
    this.essential = false;
    this.flying = !!info.flying;
    this.perceptionRadius = 200;
    this.spriteKey = `boss:${info.id}`;
    this.controller = BOSS_CONTROLLER;
    this.brain = brain;
    this.arena = o.arena || { x: this.x, y: this.y, r: 120 };
    this.mode = o.mode || 'idle';
    this.phase = 1;
    this.markers = [];
    this.move = null;
    this.cd = Object.create(null);
    this.t = 0; // the fight's clock
    this.anim = 'idle';
    this.animT = 0;
    this.animSpeed = 1;
    this.faceX = 1;
    this.adds = new Set();
    this.mem = Object.create(null); // brain scratch
    this.defeatT = 0;
    this.killer = null;
    this.hitStreak = 0; // recent damage, for brains that retreat when pressed
    this.hitStreakT = 0;
    this.lastBarkAt = -99;
    this.glow = 0; // a soft halo the brain may raise (fire axe, lantern)
    this.alpha = 1;
    this.veiled = false; // out of sight: not drawn, not solid (never `hidden`: the renderer would skip its markers)
    this.z = 0;
    try {
      brain?.init?.(this);
    } catch (err) {
      console.error('[boss] brain init failed', info.id, err);
    }
    if (this.mode === 'hidden') this.setVeiled(true);
  }

  // Out of sight (Greyjaw by day, the Lake's Hum under the water). Outside a fight it is
  // also nobody's enemy, so nothing hunts a shape that is not there.
  setVeiled(on) {
    this.veiled = !!on;
    this.solid = !on;
    if (this.mode === 'defeat' || this.mode === 'gone') return;
    this.faction = on && this.mode !== 'fight' ? 'wildlife' : this.baseFaction;
  }

  // Beaten, or not out right now: nobody's target, nothing a blow can find.
  isAlive() {
    if (this.mode === 'defeat' || this.mode === 'gone') return false;
    if (this.veiled && this.mode !== 'fight') return false;
    return super.isAlive();
  }

  // ------------------------------------------------------------ the frame

  update(dt) {
    // Skip Creature.update: bosses keep their own telegraph glow.
    Actor.prototype.update.call(this, dt);
    if (this.mode === 'defeat') {
      // Not "alive" any more, so no controller runs: the defeat plays out from here,
      // walking (Varek leaving) included.
      this.updateDefeat(dt);
      const mi = this.moveIntent;
      if (this.mode === 'defeat' && (mi.x || mi.y)) {
        const s = this.speed * (this.speedMul || 1) * dt;
        this.game.entities?.moveActor?.(this, mi.x * s, mi.y * s);
        if (Math.abs(mi.x) > 0.15) this.faceX = mi.x < 0 ? -1 : 1;
      }
    }
    this.animT += dt * this.animSpeed;
    if (this.guardUp) {
      this.guardT -= dt;
      if (this.guardT <= 0 || this.mode !== 'fight') this.dropGuard();
    }
    updateMarkers(this, dt);
    if (this.hitStreakT > 0) {
      this.hitStreakT -= dt;
      if (this.hitStreakT <= 0) this.hitStreak = 0;
    }
    if (this.telegraph > 0 && !(this.move && this.move.stage === 'windup')) this.telegraph = Math.max(0, this.telegraph - dt * 4);
    for (const a of this.adds) if (!a || a.removed || a.dead) this.adds.delete(a);
    try {
      this.brain?.tick?.(this, dt);
    } catch {
      /* ambience only */
    }
  }

  think(dt) {
    if (this.mode === 'hidden' || this.mode === 'gone') {
      stop(this);
      return;
    }
    if (this.mode === 'defeat') return this.updateDefeat(dt);
    if (this.mode !== 'fight') {
      stop(this);
      this.brain?.idle?.(this, dt);
      if (this.anim !== 'idle' && !this.brain?.idle) this.setAnim('idle');
      return;
    }
    this.t += dt;
    pickFoe(this);
    // Held by a bind, frozen, stunned (weaves, DESIGN §22.1/§22.5; bosses resist and it
    // never lasts): nothing moves, and a blow being wound up waits where it was.
    if (this.statusFlags?.disabled) {
      stop(this);
      return;
    }
    if (this.move) return this.runMove(dt);
    this._posed = false;
    try {
      this.brain?.update?.(this, dt);
    } catch (err) {
      stop(this);
      if (!this._brainWarned) {
        this._brainWarned = true;
        console.error('[boss] brain failed', this.bossId, err);
      }
    }
    if (!this.move && !this._posed) {
      // Walk and stand; a one-shot (a stumble) finishes first. A brain's own pose
      // (a kneel, a stagger) holds for as long as the brain keeps asking for it.
      const moving = Math.abs(this.moveIntent.x) + Math.abs(this.moveIntent.y) > 0.05;
      const want = moving ? 'move' : 'idle';
      const info = this.animInfo();
      const playing = info && !info.loop && this.animT < info.duration && this.anim !== 'idle' && this.anim !== 'move';
      if (this.anim !== want && !playing) this.setAnim(want);
    }
  }

  // Hold a pose this frame (the brain calls it every frame it wants the pose).
  pose(name) {
    this._posed = true;
    if (this.anim !== name) this.setAnim(name);
  }

  setAnim(name, restart = false) {
    if (this.anim === name && !restart) return;
    this.anim = name;
    this.animT = 0;
  }

  // ------------------------------------------------------------ moves

  ready(name) {
    return this.t >= (this.cd[name] ?? 0);
  }

  cool(name, seconds) {
    this.cd[name] = this.t + seconds;
  }

  startMove(name, data = {}) {
    const spec = this.brain?.moves?.[name];
    if (!spec) return false;
    stop(this);
    this.walker?.stop?.();
    const m = { name, spec, stage: 'windup', t: 0, data, hitSet: new Set() };
    m.dur = this.stageTime(spec.windup, m, 0.5);
    this.move = m;
    if (spec.cooldown != null) this.cool(name, typeof spec.cooldown === 'function' ? spec.cooldown(this, m) : spec.cooldown);
    this.setAnim(spec.anim?.windup || 'telegraph', true);
    this.telegraph = m.dur > 0 ? 0.2 : 0;
    if (spec.invuln) this.invuln = Math.max(this.invuln, 99);
    try {
      spec.begin?.(this, m);
    } catch (err) {
      console.error('[boss] move begin failed', name, err);
    }
    return true;
  }

  stageTime(v, m, fallback) {
    const s = typeof v === 'function' ? v(this, m) : v;
    return Number.isFinite(s) ? Math.max(0, s) : fallback;
  }

  runMove(dt) {
    const m = this.move;
    const spec = m.spec;
    m.t += dt;
    const k = m.dur > 0 ? Math.min(1, m.t / m.dur) : 1;
    try {
      if (m.stage === 'windup') {
        this.telegraph = 0.2 + 0.8 * k;
        spec.windupTick?.(this, m, dt, k);
        if (this.move !== m) return;
        if (m.t >= m.dur) {
          this.telegraph = 0;
          m.stage = 'active';
          m.t = 0;
          m.dur = this.stageTime(spec.active, m, 0);
          this.setAnim(spec.anim?.active || 'attack', true);
          spec.strike?.(this, m);
          if (this.move !== m) return; // the blow ended the fight (or the move)
        }
      } else if (m.stage === 'active') {
        spec.activeTick?.(this, m, dt, k);
        if (this.move !== m) return;
        if (m.t >= m.dur || m.endActive) {
          m.stage = 'recover';
          m.t = 0;
          m.dur = this.stageTime(spec.recover, m, 0.4);
          const ra = spec.anim?.recover;
          if (ra) this.setAnim(ra, true);
          spec.recoverBegin?.(this, m);
        }
      } else {
        spec.recoverTick?.(this, m, dt, k);
        if (m.t >= m.dur) this.endMove();
      }
    } catch (err) {
      console.error('[boss] move failed', m.name, err);
      this.endMove();
    }
  }

  endMove() {
    const m = this.move;
    if (!m) return;
    this.move = null;
    this.telegraph = 0;
    if (m.spec.invuln && this.mode === 'fight') this.invuln = 0;
    clearMarkers(this);
    try {
      m.spec.end?.(this, m);
    } catch (err) {
      console.error('[boss] move end failed', m.name, err);
    }
    stop(this);
  }

  // ------------------------------------------------------------ talking

  bark(text, kind = 'shout', gap = 4) {
    if (!text) return;
    const line = Array.isArray(text) ? pickLine(this.game, text) : text;
    if (this.t - this.lastBarkAt < gap && gap > 0) return;
    this.lastBarkAt = this.t;
    speak(this.game, this, line, kind, this.target || null, 2.6);
  }

  // ------------------------------------------------------------ damage hooks

  // combat.damage asks first (through the manager's hook): returns the amount that lands.
  // 0 means it was turned aside (a shield, a body underwater).
  hitMul(source, amount, opts) {
    this.lastHit = opts || null; // brains read it in onHurt (was it a burn ticking, a heavy blow?)
    if (this.mode !== 'fight') return this.mode === 'idle' ? amount : 0;
    const b = this.brain;
    let a = b?.hitMul ? b.hitMul(this, source, amount, opts || {}) : amount;
    // Guarded (round 15): a share of the blow gets through.
    if (a > 0 && this.guardT > 0) a *= GUARD_MUL;
    return a;
  }

  // The most one blow may take (round 15), asked by combat.damage after armour and crits.
  capBlow(dealt) {
    if (!(dealt > 0)) return dealt;
    return Math.min(dealt, Math.max(1, Math.ceil(this.maxHp * BLOW_SHARE)));
  }

  guarded() {
    return this.guardT > 0;
  }

  // One hand's harm, fading; past GUARD_AT of its health the guard goes up.
  noteHarm(source, dealt) {
    if (!(dealt > 0) || this.mode !== 'fight') return;
    const hand = source && source.type === 'projectile' ? source.owner || source : source || this;
    const now = this.t;
    const rec = this.struck.get(hand) || { harm: 0, t: now };
    rec.harm = rec.harm * Math.exp(-Math.max(0, now - rec.t) / GUARD_TAU) + dealt;
    rec.t = now;
    this.struck.set(hand, rec);
    if (rec.harm < this.maxHp * GUARD_AT) return;
    if (this.guardUp) {
      // Pressed while it guards: it holds on longer.
      this.guardT = Math.min(GUARD_MAX, this.guardT + GUARD_LONGER);
      rec.harm = 0;
      return;
    }
    this.raiseGuard(hand);
  }

  raiseGuard(hand = null) {
    const again = this.t - this.guardEnd < GUARD_AGAIN;
    this.guardLen = again ? Math.min(GUARD_MAX, this.guardLen + GUARD_LONGER) : GUARD_TIME;
    this.guardT = this.guardLen;
    this.guardUp = true;
    this.struck.clear(); // only what gets through the guard counts toward holding it longer
    sound(this, 'boss_clang', { pitch: 0.6, volume: 0.7 });
    particles(this, 'spark', this.x, this.y - 12, { count: 10, color: this.info.accent || '#cfe0ff', speed: 60, life: 0.4 });
    try {
      this.game.bubbles?.number?.(this.x, this.y - 30, 'guarded', this.info.accent || '#9fc8ff', { kind: 'damage' });
    } catch {
      /* cosmetic */
    }
    this.game.bus?.emit?.('boss_guard', { id: this.bossId, boss: this, on: true, seconds: this.guardT, by: hand && hand !== this ? hand : null });
  }

  dropGuard() {
    const was = this.guardUp;
    this.guardUp = false;
    this.guardT = 0;
    this.guardEnd = this.t;
    this.struck.clear(); // a clean slate: the opening
    if (was) this.game.bus?.emit?.('boss_guard', { id: this.bossId, boss: this, on: false });
  }

  onHurt(source, dealt, kind) {
    super.onHurt(source);
    if (this.mode === 'defeat' || this.mode === 'gone') return;
    this.noteHarm(source, dealt);
    // Struck before the fight began: the manager starts it.
    if (this.mode === 'idle' && source) {
      try {
        this.game.bosses?.provoked?.(this, source);
      } catch {
        /* the fight still happens through the arena */
      }
    }
    this.hitStreak += dealt || 0;
    this.hitStreakT = 3;
    try {
      this.brain?.onHurt?.(this, source, dealt, kind);
    } catch (err) {
      console.error('[boss] onHurt failed', err);
    }
    if (this.hp <= 0) {
      // Never dies mid-blow: the defeat plays out first (and some are only beaten).
      this.hp = 1;
      this.beginDefeat(source && source.type === 'projectile' ? source.owner : source);
      return;
    }
    const marks = this.info.phases || [];
    const frac = this.hp / this.maxHp;
    if (this.phase <= marks.length && frac <= marks[this.phase - 1]) {
      this.phase++;
      try {
        this.brain?.onPhase?.(this, this.phase);
      } catch (err) {
        console.error('[boss] onPhase failed', err);
      }
      this.game.bosses?.onPhase?.(this, this.phase);
    }
  }

  beginDefeat(killer) {
    if (this.mode === 'defeat') return;
    this.killer = killer || this.lastAttacker || null;
    if (this.killer?.type === 'projectile') this.killer = this.killer.owner || null;
    if (this.move) this.endMove();
    clearMarkers(this);
    clearHazards(this.game, this);
    this.mode = 'defeat';
    this.defeatT = 0;
    this.invuln = 999;
    this.telegraph = 0;
    this.faction = 'wildlife'; // nobody keeps swinging at the beaten
    this.provokedBy = null;
    this.target = null;
    stop(this);
    this.setAnim('defeat', true);
    this.game.hitStop = Math.max(this.game.hitStop || 0, 0.18);
    flashLight(this, this.x, this.y - 16, 90, this.info.accent || '#ffffff', 0.9, 0.5);
    particles(this, 'hit', this.x, this.y - 14, { count: 16, color: '#ffffff', speed: 90, life: 0.4 });
    sound(this, 'boss_down', { volume: 1 });
    for (const a of this.adds) {
      if (!a || a.removed || a.dead) continue;
      try {
        a.scare?.(this.game.player, 8);
        if (a.ai) a.ai.state = 'idle';
        a.target = null;
      } catch {
        /* adds scatter on their own */
      }
    }
    try {
      this.brain?.onDefeat?.(this);
    } catch (err) {
      console.error('[boss] onDefeat failed', err);
    }
    this.game.bosses?.onDefeatBegin?.(this);
  }

  updateDefeat(dt) {
    this.defeatT += dt;
    stop(this);
    let done = false;
    try {
      done = this.brain?.defeat ? !!this.brain.defeat(this, dt) : this.defeatT >= 2.2;
    } catch (err) {
      console.error('[boss] defeat failed', err);
      done = true;
    }
    if (done && this.mode === 'defeat') this.finishDefeat();
  }

  finishDefeat() {
    const g = this.game;
    this.mode = 'gone';
    g.bosses?.onDefeated?.(this);
    if (this.info.yields) {
      // People are beaten, not killed: they leave on their own feet (the brain walked them off).
      g.entities?.remove?.(this);
      return;
    }
    this.invuln = 0;
    this.hp = 1;
    try {
      g.combat?.kill?.(this, this.killer);
    } catch (err) {
      console.error('[boss] kill failed', err);
      g.entities?.remove?.(this);
    }
  }

  // Back to the start, full health (the player lost, or walked away).
  reset() {
    if (this.move) this.endMove();
    clearMarkers(this);
    clearHazards(this.game, this);
    for (const a of this.adds) {
      if (a && !a.removed && !a.dead) a.removed = true;
    }
    this.adds.clear();
    this.mode = 'idle';
    this.hp = this.maxHp;
    this.phase = 1;
    this.cd = Object.create(null);
    this.t = 0;
    this.invuln = 0;
    this.telegraph = 0;
    this.faction = this.baseFaction;
    this.speed = this.baseSpeed;
    this.target = null;
    this.provokedBy = null;
    this.hitStreak = 0;
    this.glow = 0;
    this.alpha = 1;
    this.z = 0;
    this.guardT = 0;
    this.guardUp = false;
    this.guardEnd = -99;
    this.guardLen = GUARD_TIME;
    this.struck.clear();
    this.mem = Object.create(null);
    this.knock.x = 0;
    this.knock.y = 0;
    this.x = this.home.x;
    this.y = this.home.y;
    this.setVeiled(false);
    this.setAnim('idle', true);
    try {
      this.brain?.init?.(this);
    } catch (err) {
      console.error('[boss] brain init failed', err);
    }
  }

  // ------------------------------------------------------------ drawing

  drawShadow(ctx, ox, oy, time) {
    if (this.markers.length) drawMarkers(ctx, this.markers, ox, oy, time);
    if (this.veiled) {
      try {
        this.brain?.drawHidden?.(ctx, this, ox, oy, time);
      } catch {
        /* decoration only */
      }
      return;
    }
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const r = (this.info.shadow ?? this.radius + 5) * (this.z > 0 ? Math.max(0.5, 1 - this.z / 50) : 1);
    ctx.globalAlpha = 0.38 * this.alpha;
    ctx.fillStyle = '#100a1c';
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, Math.max(2, r * 0.36), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  draw(ctx, ox, oy, time) {
    if (this.veiled || this.alpha <= 0.01) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy - (this.z || 0));
    // A wind-up pulses, never so white the pose underneath stops reading.
    const flash = Math.max(this.flash || 0, this.telegraph > 0 ? this.telegraph * (0.14 + 0.14 * Math.sin(time * 22)) : 0);
    const blink = this.invuln > 0 && this.invuln < 50 && this.mode === 'fight' ? (Math.floor(this.invuln * 20) % 2 ? 0.7 : 1) : 1;
    try {
      this.brain?.drawUnder?.(ctx, this, sx, sy, time);
    } catch {
      /* decoration only */
    }
    drawBossSprite(ctx, this.game.atlas, this.bossId, this.anim, this.animT, sx, sy, {
      flip: this.faceX < 0,
      flash,
      alpha: this.alpha * blink,
      variant: this.variant || null,
    });
    try {
      this.brain?.drawOver?.(ctx, this, sx, sy, time);
    } catch {
      /* decoration only */
    }
    if (this.guardT > 0 && this.mode === 'fight') drawGuard(ctx, this, sx, sy, time);
  }

  getLight(time) {
    if (this.veiled || this.mode === 'gone') return null;
    let L = null;
    try {
      L = this.brain?.light?.(this, time) || null;
    } catch {
      L = null;
    }
    // A wind-up glows in the boss's own color: the tell you can see from across the arena.
    if (this.telegraph > 0.05 && this.mode === 'fight') {
      const T = this._tlight || (this._tlight = { x: 0, y: 0, r: 46, color: this.info.accent || '#ff6b5e', intensity: 0, flicker: 0 });
      T.x = this.x;
      T.y = this.y - 14 - (this.z || 0);
      T.intensity = 0.25 + 0.55 * this.telegraph * (0.75 + 0.25 * Math.sin((time || 0) * 22));
      const list = this._lights || (this._lights = []);
      list.length = 0;
      if (Array.isArray(L)) list.push(...L);
      else if (L) list.push(L);
      list.push(T);
      return list;
    }
    return L;
  }

  animInfo(name = this.anim) {
    return bossAnimInfo(this.game.atlas, this.bossId, name);
  }

  // Has the current (non-looping) anim played through?
  animDone() {
    const info = this.animInfo();
    if (!info) return true;
    return !info.loop && this.animT >= info.duration;
  }

  serialize() {
    return { id: this.id, bossId: this.bossId, x: this.x, y: this.y };
  }
}

// The guard (round 15): a ring of the boss's own colour round its body, pulsing, thinning in
// its last second; readable on a phone's small screen as a bright outline.
function drawGuard(ctx, b, sx, sy, time) {
  const r = (b.radius || 10) + 6;
  const fade = Math.min(1, b.guardT / 0.8);
  const pulse = 0.55 + 0.25 * Math.sin((time || 0) * 9);
  ctx.save();
  ctx.globalAlpha = 0.85 * fade * pulse;
  ctx.strokeStyle = b.info?.accent || '#9fc8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(sx, sy - r * 0.75, r, r * 1.05, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.18 * fade;
  ctx.fillStyle = b.info?.accent || '#9fc8ff';
  ctx.fill();
  ctx.globalAlpha = 0.9 * fade;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const a = (time || 0) * 2.2 + (i * TAU) / 4;
    ctx.fillRect(Math.round(sx + Math.cos(a) * r) - 1, Math.round(sy - r * 0.75 + Math.sin(a) * r * 1.05) - 1, 2, 2);
  }
  ctx.restore();
}

const BOSS_CONTROLLER = {
  update(b, dt) {
    try {
      b.think(dt);
    } catch (err) {
      stop(b);
      if (!b._thinkWarned) {
        b._thinkWarned = true;
        console.error('[boss] think failed', b.bossId, err);
      }
    }
  },
};

export function isBoss(e) {
  return !!e && e.boss === true && typeof e.hitMul === 'function';
}

export { alive };
