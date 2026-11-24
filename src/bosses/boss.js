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

  // ------------------------------------------------------------ the frame

  update(dt) {
    // Skip Creature.update: bosses keep their own telegraph glow.
    Actor.prototype.update.call(this, dt);
    this.animT += dt * this.animSpeed;
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
    if (this.mode !== 'fight') return this.mode === 'idle' ? amount : 0;
    const b = this.brain;
    if (b?.hitMul) return b.hitMul(this, source, amount, opts || {});
    return amount;
  }

  onHurt(source, dealt, kind) {
    super.onHurt(source);
    if (this.mode === 'defeat' || this.mode === 'gone') return;
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
    const flash = Math.max(this.flash || 0, this.telegraph > 0 ? this.telegraph * (0.3 + 0.3 * Math.sin(time * 26)) : 0);
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
  }

  getLight(time) {
    if (this.veiled || this.mode === 'gone') return null;
    let L = null;
    try {
      L = this.brain?.light?.(this, time) || null;
    } catch {
      L = null;
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
