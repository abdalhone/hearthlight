import { Actor, animForState } from './entity.js';
import { FACTION, PLAYER_ID } from '../core/constants.js';
import { dirFromVec } from '../core/math.js';
import { drawCharacter } from '../art/characters_art.js';
import { SHADOW } from '../art/palette.js';
import { itemDef } from './items.js';
import { dropItem } from './pickups.js';
import { xpToNext, LEVEL_ATK } from './combat.js';
import { slashSprite, SLASH_FRAMES } from './combat_fx.js';

// The player: 8-way movement with a touch of momentum, a three-hit sword combo,
// a dodge roll, interaction, harvesting with the sword, and waking up at home
// after being knocked out. Contract in DESIGN.md ("Player", §16.7).
// The sword spares no one it touches (combat.canHarm): auto-aim only ever turns the
// blade toward fair game, so hurting a friend takes a deliberate swing at them.

export const PLAYER_BASE = Object.freeze({ maxHp: 60, atk: 6, def: 0, speed: 76 });
export const STARTING_INVENTORY = Object.freeze({ potion: 2, bread: 2, coin: 30 });

const ACCEL = 820; // px/s^2 when starting to move
const DECEL = 1100; // px/s^2 when letting go
const TURN = 1900; // px/s^2 when reversing, so turns feel snappy

// The sword combo: each hit is wider, heavier and pushes harder; the third launches.
export const COMBO = [
  { mul: 1.0, arc: 1.8, range: 20, knock: 110, lock: 0.24, lunge: 50, launch: 0, heavy: false, pitch: 1.0, frame: 0.032 },
  { mul: 1.15, arc: 2.1, range: 22, knock: 150, lock: 0.24, lunge: 60, launch: 0, heavy: false, pitch: 1.12, frame: 0.032 },
  { mul: 1.7, arc: 2.7, range: 25, knock: 330, lock: 0.36, lunge: 90, launch: 120, heavy: true, pitch: 0.85, frame: 0.045 },
];
const COMBO_WINDOW = 0.45; // after a swing ends, how long the next press still continues the combo
const CHAIN_AT = 0.7; // fraction of a swing after which a buffered press chains immediately
const FINISHER_REST = 0.2; // breath after the third hit
const ATTACK_BUFFER = 0.25; // presses during a swing or roll are remembered this long

export const ROLL = Object.freeze({ time: 0.32, speed: 190, iframes: 0.3, cooldown: 0.8 });

const WORK_SWING_SECONDS = 1; // each swing at a tree or rock counts as this much work
const GENTLE_WORK = new Set(['herb', 'moonpetal', 'berry_bush', 'crop']); // picked by hand in one go
const WORK_FX = {
  tree: { particles: 'wood_chip', color: '#ad7a48', sound: 'chop', extra: 'leaf', extraColor: '#6fa34c', height: 12 },
  rock: { particles: 'stone_chip', color: '#9593a6', sound: 'mine', height: 6 },
  ore: { particles: 'stone_chip', color: '#9aa0ad', sound: 'mine', extra: 'spark', extraColor: '#ffb047', height: 6 },
  crystal: { particles: 'stone_chip', color: '#a995ff', sound: 'mine', extra: 'sparkle', extraColor: '#ddd2ff', height: 8 },
};
const WORK_FX_GENTLE = { particles: 'leaf', color: '#6fa34c', sound: 'pickup', height: 4 };

const DOWN_FADE_DELAY = 1.3; // let the fall read before the screen goes dark
const WAKE_HP = 0.5;
const COIN_LOSS = 0.1;
const STAND_OFFSETS = [
  [0, 14],
  [14, 2],
  [-14, 2],
  [0, 26],
  [16, 14],
  [-16, 14],
  [0, -18],
  [26, 0],
  [-26, 0],
  [0, 40],
];

// Shared controller: the base Actor calls it each step while the player is up.
const PLAYER_CONTROLLER = {
  update(p, dt) {
    p.control(dt);
  },
};

export class Player extends Actor {
  constructor(game, o = {}) {
    super(game, {
      id: PLAYER_ID,
      name: game.settings?.playerName || 'Traveler',
      kind: 'human',
      faction: FACTION.PLAYER,
      ...PLAYER_BASE,
      spriteKey: 'player',
      perceptionRadius: 160,
      inventory: { ...STARTING_INVENTORY },
      ...o,
    });
    this.baseAtk = this.atk;
    this.controller = PLAYER_CONTROLLER;
    this.vel = { x: 0, y: 0 };
    this._inX = 0;
    this._inY = 0;

    this.combo = 0; // index of the next combo hit
    this.comboTimer = 0;
    this.comboRest = 0;
    this.attackBuffer = 0;
    this.swing = null; // active slash effect { step, t, lock, frame, angle, ccw, kind }
    this._swingLock = 0.24; // lock time of the swing in progress
    this._heldAttack = false;
    this._heldDodge = false;

    this.rolling = false;
    this.rollT = 0;
    this.rollDirX = 0;
    this.rollDirY = 1;
    this.dodgeCd = 0;
    this.ghosts = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, dir: 'down', anim: 0, a: 0 }));
    this.ghostT = 0;
    this.ghostIdx = 0;
    this.hurtBlink = 0;

    this.workBar = null; // { progress, t } shown above the head while harvesting
    this.stepDist = 0;
    this.stepIndex = 0;
    this._lastX = this.x;
    this._lastY = this.y;
    this._promptT = 0;
    this._prompt = null;
    this._down = null; // knocked-out sequence
    this._light = { x: 0, y: 0, r: 72, color: '#ffb047', intensity: 0.85, flicker: 0.12 };
    this._bindLight = { x: 0, y: 0, r: 34, color: '#b9a6ff', intensity: 0.7, flicker: 0.2 };
    this._rootShown = 0; // seconds the binding ring has been visible (for its fade-in)
    // { level 1|2, kind 'assault'|'knockout', until (game.clock.t), victimId, since, t } while wanted.
    this.crime = null;
    try {
      game.bus?.on?.('settings_changed', (p) => {
        if (p?.key === 'playerName' && p.value) this.name = String(p.value).slice(0, 24);
      });
    } catch {
      /* a bus is optional in tests */
    }
  }

  get rooted() {
    return this.rootTime > 0;
  }

  // Coins are the source of truth; gold mirrors them.
  get gold() {
    return this.inventory.count('coin');
  }

  set gold(v) {
    const want = Math.max(0, Math.floor(Number(v) || 0));
    const have = this.inventory.count('coin');
    if (want > have) this.inventory.add('coin', want - have);
    else if (want < have) this.inventory.remove('coin', have - want);
  }

  get xpNext() {
    return xpToNext(this.level);
  }

  // The best weapon carried adds to sword damage.
  get weaponBonus() {
    let best = 0;
    for (const id of this.inventory.items.keys()) {
      const d = itemDef(id);
      if (d && d.type === 'weapon' && d.atk > best) best = d.atk;
    }
    return best;
  }

  get attackPower() {
    const weak = this.game.survival?.mul?.(this, 'atk') ?? 1; // bruised, mending, flame-thin (§27)
    return Math.max(1, Math.round((this.atk + this.weaponBonus) * weak));
  }

  // Fall now, whatever your health (DESIGN §25/§27): berserk's end calls
  // fall({ window: 30, cause: 'berserk' }). The bleed-out window starts at once.
  fall(opts = {}) {
    if (this.downed || this.dead) return false;
    this._fallOpts = { ...opts };
    this.hp = 0;
    const c = this.game.combat;
    if (c?.down) return !!c.down(this, opts.by || null);
    this.downed = true;
    this.setState('downed');
    this.game.bus?.emit?.('downed', { entity: this, by: opts.by || null });
    this.onDowned(opts.by || null);
    return true;
  }

  // ------------------------------------------------------------ step

  update(dt) {
    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    if (this.comboRest > 0) this.comboRest -= dt;
    if (this.attackBuffer > 0) this.attackBuffer -= dt;
    if (this.hurtBlink > 0) this.hurtBlink -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t >= this.swing.frame * SLASH_FRAMES) this.swing = null;
    }
    if (this.workBar) {
      this.workBar.t -= dt;
      if (this.workBar.t <= 0) this.workBar = null;
    }
    this._rootShown = this.rootTime > 0 ? this._rootShown + dt : 0;
    if (this.rootTime > 0) {
      // Held in place means held: blows land, but do not shove you out of the light.
      this.knock.x = 0;
      this.knock.y = 0;
    }
    super.update(dt);
    this._afterMove(dt);
    if (this.downed) this._tickDown(dt);
    this._updatePrompt(dt);
  }

  // Called by the base Actor (through the controller) only while the player is up.
  control(dt) {
    const g = this.game;
    const input = g.input;
    const canAct = !!input && g.state === 'playing' && !g.paused && !this._modalOpen();
    let mx = 0;
    let my = 0;
    // Presses are read from both the input's edge flags and the rising edge of the held
    // state: edges raised during a hit-stop freeze are cleared before the world resumes.
    const atkHeld = !!input?.down?.('attack');
    const dodgeHeld = !!input?.down?.('dodge');
    const atkPress = !!input?.pressed('attack') || (atkHeld && !this._heldAttack);
    const dodgePress = !!input?.pressed('dodge') || (dodgeHeld && !this._heldDodge);
    this._heldAttack = atkHeld;
    this._heldDodge = dodgeHeld;
    // Someone on your shoulders (§27): no sword, no roll; interact lays them down.
    const carrying = !!this.carrying;
    // Binding Light holds the body in place mid-roll; the sword arm stays free.
    if (this.rolling && this.rootTime > 0) this._endRoll();
    if (canAct) {
      const mv = input.moveVector();
      mx = mv?.x || 0;
      my = mv?.y || 0;
      if (dodgePress && !carrying) this.tryDodge(mx, my);
      if (carrying) this.attackBuffer = 0;
      else if (atkPress) this.attackBuffer = ATTACK_BUFFER;
      // Holding the button keeps swinging once each swing finishes (chopping, phones).
      else if (atkHeld && this.lockTime <= 0 && !this.rolling) this.attackBuffer = Math.max(this.attackBuffer, 0.05);
      if (input.pressed('interact') && !this.rolling) {
        if (!(carrying && g.survival?.carrierInteract?.(this))) this.tryInteract();
      }
    } else {
      this.attackBuffer = 0; // a press made just before a menu opened must not swing after it
    }
    this._inX = mx;
    this._inY = my;
    if (this.attackBuffer > 0 && this._canSwing()) {
      this.attackBuffer = 0;
      this.attack();
    }
    if (this.rolling) {
      this._rollStep(dt);
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      return;
    }
    this._accelerate(dt, mx, my);
  }

  _modalOpen() {
    try {
      return !!this.game.ui?.isModalOpen?.();
    } catch {
      return false;
    }
  }

  _accelerate(dt, mx, my) {
    const max = this.speed * (this.speedMul || 1) * (this.game.survival?.speedFactor?.(this) ?? 1);
    const v = this.vel;
    let tx = 0;
    let ty = 0;
    let rate = DECEL;
    if (this.rootTime > 0) {
      // Rooted: no drift, and no stored momentum to lurch with when the light fades.
      v.x = 0;
      v.y = 0;
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      return;
    }
    if (this.lockTime > 0) {
      rate = DECEL * 2; // planted while swinging or staggered
    } else if (mx || my) {
      tx = mx * max;
      ty = my * max;
      rate = v.x * tx + v.y * ty < 0 ? TURN : ACCEL;
    }
    const dx = tx - v.x;
    const dy = ty - v.y;
    const d = Math.hypot(dx, dy);
    const step = rate * dt;
    if (d <= step) {
      v.x = tx;
      v.y = ty;
    } else {
      v.x += (dx / d) * step;
      v.y += (dy / d) * step;
    }
    const mi = this.moveIntent;
    mi.x = max > 0 ? v.x / max : 0;
    mi.y = max > 0 ? v.y / max : 0;
  }

  _afterMove(dt) {
    // Face the stick at once, even while the body is still turning around.
    if ((this._inX || this._inY) && this.lockTime <= 0 && !this.rolling && this.isAlive()) {
      const l = Math.hypot(this._inX, this._inY);
      this.facing.x = this._inX / l;
      this.facing.y = this._inY / l;
      this.dir = dirFromVec(this._inX, this._inY, this.dir);
    }
    const dx = this.x - this._lastX;
    const dy = this.y - this._lastY;
    this._lastX = this.x;
    this._lastY = this.y;
    const d = Math.hypot(dx, dy);
    // Footsteps follow distance walked (so they speed up and slow down with the body).
    if (d > 0 && d < 8 && this.isAlive() && !this.rolling && this.z <= 0 && this.state === 'walk') {
      this.stepDist += d;
      if (this.stepDist >= 15) {
        this.stepDist = 0;
        this.stepIndex++;
        this._footstep();
      }
    }
    for (const gh of this.ghosts) if (gh.a > 0) gh.a = Math.max(0, gh.a - dt * 2.6);
  }

  _footstep() {
    const g = this.game;
    try {
      g.audio?.play?.('step', { x: this.x, y: this.y, volume: 0.35, pitch: 0.9 + Math.random() * 0.2 });
      if (this.stepIndex % 2 === 0) {
        g.particles?.emit?.('dust', this.x, this.y, { count: 2, speed: 10, life: 0.35, dir: { x: -this.facing.x, y: -this.facing.y } });
      }
    } catch {
      /* effects are optional */
    }
  }

  // ------------------------------------------------------------ sword

  _canSwing() {
    if (this.rolling || this.comboRest > 0 || !this.isAlive()) return false;
    if (this.lockTime <= 0) return true;
    // Chain the next hit once the current swing is mostly through.
    return this.state === 'attack' && this.stateTime >= this._swingLock * CHAIN_AT;
  }

  // One press of the attack button: fight what is in front, else work a tree or rock,
  // else swing at the air (which still hits anything that wanders into the arc).
  attack() {
    if (!this.isAlive()) return false;
    const reach = COMBO[this.combo].range + 10;
    const foe = this._findFoe(reach, true);
    if (!foe) {
      const obj = this._findWorkTarget();
      if (obj) return this._workSwing(obj);
    }
    return this._swordSwing(foe || this._findFoe(reach, false));
  }

  _swordSwing(target) {
    const g = this.game;
    if (this.comboTimer <= 0) this.combo = 0;
    const step = this.combo;
    const c = COMBO[step];
    let lunge = this.rootTime > 0 ? 0 : c.lunge;
    if (target) {
      this.faceToward(target.x, target.y);
      // Do not shove into an enemy that is already in your face.
      const d = this.distTo(target);
      lunge *= Math.max(0, Math.min(1, (d - 10) / 12));
    }
    this.lockTime = 0;
    let ok = false;
    try {
      ok = !!g.combat?.melee?.(this, {
        target,
        arc: c.arc,
        range: c.range,
        damageMul: c.mul,
        knockback: c.knock,
        launch: c.launch,
        heavy: c.heavy,
        lock: c.lock,
        cooldown: 0.08,
        silent: true,
      });
    } catch (err) {
      console.warn('[player] melee failed', err);
    }
    if (!ok) {
      this.setState('attack', c.lock);
      this.stateTime = 0;
      this.animTime = 0;
    }
    try {
      g.audio?.play?.('swing', { x: this.x, y: this.y, pitch: c.pitch, volume: step === 2 ? 1 : 0.8 });
    } catch {
      /* effects are optional */
    }
    this.knock.x += this.facing.x * lunge;
    this.knock.y += this.facing.y * lunge;
    this.vel.x = 0;
    this.vel.y = 0;
    this.swing = { step, t: 0, lock: c.lock, frame: c.frame, angle: Math.atan2(this.facing.y, this.facing.x), ccw: step === 1, kind: 'sword' };
    this._swingLock = c.lock;
    this.stateTime = 0;
    if (step === COMBO.length - 1) {
      this.combo = 0;
      this.comboTimer = 0;
      this.comboRest = c.lock + FINISHER_REST;
    } else {
      this.combo = step + 1;
      this.comboTimer = c.lock + COMBO_WINDOW;
    }
    return true;
  }

  // Nearest creature in front worth turning the blade toward. fightingOnly: enemies, or
  // creatures already in a fight with the player (so a chase is not interrupted by a tree).
  // Otherwise also game animals. Never people or pets: the sword still hits them if they
  // stand in the arc, but it never seeks them out.
  _findFoe(reach, fightingOnly) {
    const g = this.game;
    const combat = g.combat;
    if (!combat?.canHarm) return null;
    const fx = this.facing.x;
    const fy = this.facing.y;
    const list = g.entities?.all?.() || [];
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this || e.type !== 'actor' || e.removed || !e.isAlive()) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (dx > reach + 8 || dx < -reach - 8 || dy > reach + 8 || dy < -reach - 8) continue;
      const d = Math.hypot(dx, dy);
      if (d > reach + (e.radius ?? 5)) continue;
      const front = d < 8 ? 1 : (dx * fx + dy * fy) / d;
      if (front < 0.25) continue;
      if (!combat.canHarm(this, e, false)) continue;
      const fighting = !!(combat.isHostile?.(this, e) || e.provokedBy === this);
      if (fightingOnly ? !fighting : !fighting && !this._isGame(e)) continue;
      const score = d - front * 10;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  // Animals that are fair to hunt: creatures, but not pets, Pip's cat or anyone's person.
  _isGame(e) {
    if (!e.species || e === this.game.companion) return false;
    const combat = this.game.combat;
    try {
      if (combat?.isProtected?.(e) || combat?.isLawful?.(e)) return false;
    } catch {
      return false;
    }
    return true;
  }

  // Where the next swing would land, for anyone who wants to stay out of it (Lyra steps
  // aside, villagers flinch). Returns one reused object: { x, y, fx, fy, range, arc, active },
  // `active` while a swing is in progress or the attack button is held.
  swingZone() {
    const z = this._zone || (this._zone = { x: 0, y: 0, fx: 0, fy: 1, range: 0, arc: 0, active: false });
    const c = COMBO[this.combo] || COMBO[0];
    z.x = this.x;
    z.y = this.y;
    z.fx = this.facing.x;
    z.fy = this.facing.y;
    z.range = c.range + 6;
    z.arc = c.arc;
    z.active = this.isAlive() && (!!this.swing || this.state === 'attack' || this._heldAttack || this.attackBuffer > 0);
    return z;
  }

  // ------------------------------------------------------------ harvesting

  _findWorkTarget() {
    const objs = this.game.objects;
    if (!objs?.inRadius) return null;
    let list;
    try {
      list = objs.inRadius(this.x, this.y, 34);
    } catch {
      return null;
    }
    const fx = this.facing.x;
    const fy = this.facing.y;
    let best = null;
    let bestScore = Infinity;
    for (const o of list || []) {
      if (!o || o.objType === 'fishing_spot' || typeof o.canWork !== 'function' || typeof o.work !== 'function') continue;
      const dx = o.x - this.x;
      const dy = o.y - 4 - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 26) continue;
      const front = d < 6 ? 1 : (dx * fx + dy * fy) / d;
      if (front < 0.3) continue;
      let ok = false;
      try {
        ok = !!o.canWork(this);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      const score = d - front * 8;
      if (score < bestScore) {
        best = o;
        bestScore = score;
      }
    }
    return best;
  }

  // Chop, mine or pick through the object's work API. Trees and rocks take a few
  // swings; herbs, flowers, berries and ripe crops come away in one.
  _workSwing(obj) {
    const g = this.game;
    const gentle = GENTLE_WORK.has(obj.objType);
    this.faceToward(obj.x, obj.y - 4);
    this.vel.x = 0;
    this.vel.y = 0;
    this.lockTime = 0;
    if (gentle) {
      this.setState('work', 0.36);
    } else {
      this.setState('attack', 0.26);
      this.swing = { step: 0, t: 0, lock: 0.26, frame: 0.032, angle: Math.atan2(this.facing.y, this.facing.x), ccw: false, kind: 'work' };
    }
    this._swingLock = gentle ? 0.36 : 0.26;
    this.stateTime = 0;
    this.animTime = 0;
    const secs = gentle ? Math.max(0.1, Number(obj.workSeconds) || 1) + 0.05 : WORK_SWING_SECONDS;
    let res = null;
    let spent = 0;
    try {
      // Small steps, as a job would call it each frame, so any work() implementation agrees.
      while (spent < secs - 1e-6) {
        const st = Math.min(0.1, secs - spent);
        res = obj.work(this, st);
        spent += st;
        if (!res || res.done) break;
      }
    } catch (err) {
      console.warn('[player] work failed', err);
      res = null;
    }
    const fx = gentle ? WORK_FX_GENTLE : WORK_FX[obj.objType] || WORK_FX.rock;
    try {
      const px = obj.x;
      const py = obj.y - fx.height;
      g.particles?.emit?.(fx.particles, px, py, { count: 5, color: fx.color, speed: 45, life: 0.5, dir: { x: -this.facing.x, y: -this.facing.y } });
      if (fx.extra) g.particles?.emit?.(fx.extra, px, py - 4, { count: 2, color: fx.extraColor, speed: 25, life: 0.8 });
      g.audio?.play?.(fx.sound, { x: px, y: py, pitch: 0.92 + Math.random() * 0.16 });
    } catch {
      /* effects are optional */
    }
    if (res && !res.failed) {
      const progress = res.done ? 1 : Math.max(0, Math.min(1, Number(res.progress) || 0));
      this.workBar = { progress, t: res.done ? 0.6 : 1.5 };
    }
    if (res?.done && Array.isArray(res.items)) {
      // Drop the harvest between the object and the player; the magnet brings it in.
      const x = (obj.x + this.x) / 2;
      const y = (obj.y + this.y) / 2;
      for (const it of res.items) {
        if (!it?.id) continue;
        dropItem(g, it.id, Math.max(1, Math.floor(it.qty) || 1), x, y);
      }
    }
    return true;
  }

  // ------------------------------------------------------------ dodge roll

  tryDodge(mx = 0, my = 0) {
    if (this.dodgeCd > 0 || this.rolling || !this.isAlive()) return false;
    if (this.rootTime > 0) {
      this._strain();
      return false;
    }
    if (this.lockTime > 0) {
      // Roll out of a swing or a stagger once it has landed; never out of sitting or casting.
      const cancellable = this.state === 'attack' || this.state === 'hurt' || this.state === 'work';
      if (!cancellable || this.stateTime < 0.1) return false;
    }
    let dx = mx;
    let dy = my;
    let l = Math.hypot(dx, dy);
    if (l < 0.2) {
      dx = this.facing.x;
      dy = this.facing.y;
      l = Math.hypot(dx, dy) || 1;
    }
    dx /= l;
    dy /= l;
    this.rolling = true;
    this.rollT = 0;
    this.rollDirX = dx;
    this.rollDirY = dy;
    this.dodgeCd = ROLL.cooldown;
    this.invuln = Math.max(this.invuln, ROLL.iframes);
    this.setState('walk');
    this.lockTime = ROLL.time;
    this.stateTime = 0;
    this.animTime = 0;
    this.facing.x = dx;
    this.facing.y = dy;
    this.dir = dirFromVec(dx, dy, this.dir);
    this.swing = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.attackBuffer = 0;
    this.workBar = null;
    this.knock.x = 0;
    this.knock.y = 0;
    this.vel.x = dx * this.speed * 0.7;
    this.vel.y = dy * this.speed * 0.7;
    this.ghostT = 0;
    const g = this.game;
    try {
      g.particles?.emit?.('dust', this.x - dx * 4, this.y, { count: 6, speed: 26, life: 0.45, dir: { x: -dx, y: -dy } });
      g.audio?.play?.('dodge', { x: this.x, y: this.y });
    } catch {
      /* effects are optional */
    }
    return true;
  }

  _rollStep(dt) {
    this.rollT += dt;
    const k = Math.min(1, this.rollT / ROLL.time);
    const sp = ROLL.speed * (1 - k * k) + 24; // burst, then ease out
    this.game.entities?.moveActor?.(this, this.rollDirX * sp * dt, this.rollDirY * sp * dt);
    this.z = Math.sin(k * Math.PI) * 3;
    this.ghostT -= dt;
    if (this.ghostT <= 0) {
      this.ghostT = 0.05;
      const gh = this.ghosts[this.ghostIdx++ % this.ghosts.length];
      gh.x = this.x;
      gh.y = this.y;
      gh.z = this.z;
      gh.dir = this.dir;
      gh.anim = this.animTime * 2.2;
      gh.a = 0.4;
    }
    if (k >= 1) this._endRoll();
  }

  _endRoll() {
    this.rolling = false;
    this.z = 0;
    this.lockTime = 0;
    try {
      this.game.particles?.emit?.('dust', this.x, this.y, { count: 3, speed: 14, life: 0.35 });
    } catch {
      /* effects are optional */
    }
  }

  // Trying to roll out of Binding Light: the ring flares and holds.
  _strain() {
    const g = this.game;
    try {
      g.particles?.emit?.('magic', this.x, this.y - 2, { count: 4, color: '#ddd2ff', speed: 18, life: 0.4 });
      g.audio?.play?.('magic', { x: this.x, y: this.y, volume: 0.4, pitch: 1.3 });
    } catch {
      /* effects are optional */
    }
  }

  // ------------------------------------------------------------ interaction

  tryInteract() {
    try {
      return !!this.game.interactions?.tryInteract?.(this);
    } catch (err) {
      console.warn('[player] interact failed', err);
      return false;
    }
  }

  // Keep the HUD's "E · Talk to Bram" prompt in step with what is in reach.
  _updatePrompt(dt) {
    this._promptT -= dt;
    if (this._promptT > 0) return;
    this._promptT = 0.12;
    const g = this.game;
    let label = '';
    const own = g.survival?.promptFor?.(this); // "Call for help", "Lay Lyra in the cot"…
    if (own != null && g.state === 'playing') label = own;
    else if (this.isAlive() && !this.rolling && g.state === 'playing') {
      try {
        label = g.interactions?.best?.(this)?.label || '';
      } catch {
        label = '';
      }
    }
    if (label === this._prompt) return;
    this._prompt = label;
    try {
      g.ui?.setInteractPrompt?.(label);
    } catch {
      /* the HUD is optional */
    }
  }

  // ------------------------------------------------------------ hooks from combat

  onHurt() {
    this.swing = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.attackBuffer = 0;
    this.workBar = null;
    this.vel.x = 0;
    this.vel.y = 0;
    this.hurtBlink = this.invuln;
  }

  onDowned(by) {
    if (this._down) return;
    // Beaten by the guard while wanted: the matter is settled where you fell.
    const arrested = !!by && by.faction === 'guard' && !!this.crime;
    if (arrested) {
      try {
        if (!this.game.combat?.clearCrime?.(this, 'arrested')) this.crime = null;
      } catch {
        this.crime = null;
      }
    }
    // Death is dangerous (§27): you lie where you fell, bleeding, and game.survival decides
    // who comes. Without it (tests, older builds) you wake at home as before.
    if (this.game.survival) {
      this.rolling = false;
      this.swing = null;
      this.combo = 0;
      this.attackBuffer = 0;
      this.workBar = null;
      this.z = 0;
      this.vel.x = 0;
      this.vel.y = 0;
      if (this.carrying) this.game.survival.endCarry?.(this);
      return;
    }
    this._down = { t: 0, fading: false, woke: false, by: by || null, arrested };
    this.rolling = false;
    this.swing = null;
    this.combo = 0;
    this.attackBuffer = 0;
    this.workBar = null;
    this.z = 0;
    this.vel.x = 0;
    this.vel.y = 0;
  }

  // Helped up on the spot before the screen went dark: no trip home.
  onRevived() {
    if (this._down && !this._down.fading) this._down = null;
  }

  _tickDown(dt) {
    if (this.game.survival) return; // the bleed-out window runs in game.survival (§27)
    if (!this._down) this.onDowned(null); // e.g. a save loaded while knocked out
    const d = this._down;
    d.t += dt;
    if (!d.fading && d.t >= DOWN_FADE_DELAY) {
      d.fading = true;
      let p = null;
      try {
        p = this.game.ui?.fadeOut?.(1);
      } catch {
        p = null;
      }
      Promise.resolve(p).then(
        () => this._wakeAtHome(d),
        () => this._wakeAtHome(d),
      );
    }
    // If the fade never resolves, wake anyway rather than stay stuck in the dark.
    if (d.fading && !d.woke && d.t >= DOWN_FADE_DELAY + 4) this._wakeAtHome(d);
  }

  _wakeAtHome(d) {
    if (!d || d.woke || this._down !== d) return;
    d.woke = true;
    this._down = null;
    const g = this.game;
    const lost = Math.floor(this.gold * COIN_LOSS);
    if (lost > 0) this.inventory.remove('coin', lost);
    const home = this._homeSpot();
    this.x = home.x;
    this.y = home.y;
    this._lastX = this.x;
    this._lastY = this.y;
    this.knock.x = 0;
    this.knock.y = 0;
    this.vel.x = 0;
    this.vel.y = 0;
    this.z = 0;
    this.downed = false;
    this.hp = Math.max(1, Math.round(this.maxHp * WAKE_HP));
    this.setState('idle');
    this.lockTime = 0;
    this.flash = 0;
    this.faceDir('down');
    this.invuln = 2;
    this.hurtBlink = 0;
    g.combat?.downedAt?.delete?.(this);

    // Lyra comes home too, if she is still traveling with you and was there: she carried
    // you, or a patrol carried you both. She does not carry someone she was fighting off.
    const lyra = g.companion;
    let carrier = null;
    let bothDown = false;
    if (this._lyraWouldCarry(lyra, d.by)) {
      bothDown = !!lyra.downed;
      if (bothDown) {
        try {
          g.combat?.revive?.(lyra, null, WAKE_HP);
        } catch (err) {
          console.warn('[player] could not revive Lyra', err);
        }
      } else {
        carrier = lyra;
      }
      const spot = this._findStandSpot(home.x, home.y, home, lyra) || { x: home.x + 14, y: home.y };
      lyra.x = spot.x;
      lyra.y = spot.y;
      if (lyra.knock) {
        lyra.knock.x = 0;
        lyra.knock.y = 0;
      }
      lyra.faceToward?.(this.x, this.y);
      // The fight she was in is miles away now.
      try {
        lyra.behavior?.clearFocus?.();
      } catch {
        /* behavior is optional */
      }
    }
    try {
      g.camera?.snap?.();
    } catch {
      /* camera is optional */
    }
    g.bus?.emit('revived', { entity: this, by: carrier });

    let text = 'You wake in your own bed, bruised but breathing.';
    if (d.arrested) {
      text = `${d.by?.name || 'The guard'} hauled you home to sleep it off. ${text} The matter is settled, this time.`;
    } else if (carrier) text = `${carrier.name || 'Lyra'} carried you home. ${text}`;
    else if (bothDown) text = `Captain Rowan's patrol found you both on the road and carried you home. ${text}`;
    else text = `Someone from the village found you and carried you home. ${text}`;
    const coins = `${lost} ${lost === 1 ? 'coin' : 'coins'}`;
    if (lost > 0) text += d.arrested ? ` The guard kept ${coins} as a fine.` : ` ${coins} went missing on the way.`;
    try {
      g.ui?.toast?.(text, 'warn', { key: 'wake', title: 'Knocked out' });
      const p = g.ui?.fadeIn?.(1.2);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* the UI is optional */
    }
  }

  // Lyra only carries you home while she still travels with you (§16.3), was close enough
  // to see you fall, and was not the one you were fighting.
  _lyraWouldCarry(lyra, downedBy) {
    const g = this.game;
    if (!lyra || lyra.removed || lyra.dead || lyra === downedBy) return false;
    if (g.flags?.lyra_gone) return false;
    let state = 'together';
    try {
      state = lyra.mind?.companionship ?? lyra.mind?.autonomy?.companionship ?? 'together';
    } catch {
      state = 'together';
    }
    if (state !== 'together' && state !== 'wary') return false;
    return Math.hypot(lyra.x - this.x, lyra.y - this.y) < 480;
  }

  _homeSpot() {
    const g = this.game;
    let bed = null;
    try {
      bed = g.objects?.get?.('home_bed') || null;
    } catch {
      bed = null;
    }
    if (bed) return this._findStandSpot(bed.x, bed.y, null, this) || { x: bed.x, y: bed.y + 14 };
    const sp = g.spawns?.player;
    if (sp) return { x: sp.x, y: sp.y };
    return { x: this.x, y: this.y };
  }

  _findStandSpot(x, y, avoid, who) {
    for (const [ox, oy] of STAND_OFFSETS) {
      const cx = x + ox;
      const cy = y + oy;
      if (avoid && Math.hypot(cx - avoid.x, cy - avoid.y) < 10) continue;
      let blocked = false;
      try {
        blocked = !!this.game.entities?.blockedAt?.(who || this, cx, cy);
      } catch {
        blocked = false;
      }
      if (!blocked) return { x: cx, y: cy };
    }
    return null;
  }

  // ------------------------------------------------------------ light and drawing

  // A lantern lights the way at night; without one, a faint glow keeps you visible.
  getLight(time = 0) {
    if (this.dead) return null;
    if (this.rootTime > 0 && !this.downed) {
      // Binding Light glows in Lyra's arcane violet around the feet, day or night.
      const B = this._bindLight;
      B.x = this.x;
      B.y = this.y - 2;
      B.intensity = 0.55 + 0.2 * Math.sin(time * 9);
      return B;
    }
    const day = this.game.clock?.daylight ?? 1;
    if (day > 0.6) return null;
    const L = this._light;
    L.x = this.x;
    L.y = this.y - 10;
    if (this.inventory.has('lantern')) {
      L.r = 76;
      L.color = '#ffb047';
      L.intensity = 0.9;
      L.flicker = 0.15;
    } else {
      L.r = 30;
      L.color = '#f4ead7';
      L.intensity = 0.22;
      L.flicker = 0;
    }
    return L;
  }

  draw(ctx, ox, oy, time) {
    const atlas = this.game.atlas;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const hz = Math.round(this.z || 0);
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(3, this.radius + 1 - hz * 0.5), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    for (const gh of this.ghosts) {
      if (gh.a <= 0.02) continue;
      drawCharacter(ctx, atlas, this.spriteKey, 'walk', gh.dir, gh.anim, Math.round(gh.x - ox), Math.round(gh.y - oy - gh.z), {
        alpha: gh.a,
        flash: 0.7,
        state: 'walk',
      });
    }

    const bound = this.rootTime > 0 && !this.downed;
    if (bound) this._drawBinding(ctx, sx, sy, time, false);
    const sw = this.swing;
    const slashBehind = sw && this.dir === 'up';
    if (slashBehind) this._drawSlash(ctx, sx, sy - hz);
    const blink = this.hurtBlink > 0 && !this.rolling && !this.downed;
    drawCharacter(ctx, atlas, this.spriteKey, animForState(this.state), this.dir, this.rolling ? this.animTime * 2.2 : this.animTime, sx, sy - hz, {
      flash: this.flash,
      alpha: blink ? (Math.floor(this.hurtBlink * 20) % 2 ? 0.5 : 1) : 1,
      state: this.state,
    });
    if (sw && !slashBehind) this._drawSlash(ctx, sx, sy - hz);
    if (bound) this._drawBinding(ctx, sx, sy, time, true);
    if (this.workBar) this._drawWorkBar(ctx, sx, sy - hz);
  }

  // Lyra's Binding Light: a spinning ring of arcane light with brighter runes at the feet,
  // and bands of light wrapping the shins. The back half of the ring is drawn before the
  // body and the front half after, so it reads as circling the player. Plain rects only.
  _drawBinding(ctx, sx, sy, time, front) {
    const grow = Math.min(1, this._rootShown / 0.18);
    const fade = Math.min(1, this.rootTime / 0.35);
    const a = grow * fade;
    if (a <= 0.02) return;
    const rx = 5 + 6 * grow;
    const ry = rx * 0.45;
    const spin = time * 2.4;
    const prev = ctx.globalAlpha;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const s = Math.sin(ang);
      if (front ? s < 0 : s >= 0) continue;
      const x = Math.round(sx + Math.cos(ang) * rx);
      const y = Math.round(sy + s * ry);
      // Runes ride around the ring; the ring itself shimmers between them.
      const u = (((ang - spin) / (Math.PI * 2)) % 1 + 1) % 1;
      const rune = (u * 5) % 1 < 0.2;
      ctx.globalAlpha = prev * a * (front ? 1 : 0.65);
      ctx.fillStyle = rune ? '#ffffff' : '#a995ff';
      ctx.fillRect(x, y, 1, 1);
      if (rune) {
        ctx.globalAlpha = prev * a * (front ? 0.8 : 0.5);
        ctx.fillStyle = '#ddd2ff';
        ctx.fillRect(x, y - 1, 1, 1);
      }
    }
    if (front) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 11);
      ctx.globalAlpha = prev * a * pulse;
      ctx.fillStyle = '#ddd2ff';
      ctx.fillRect(sx - 4, sy - 3, 9, 1);
      ctx.globalAlpha = prev * a * pulse * 0.6;
      ctx.fillStyle = '#a995ff';
      ctx.fillRect(sx - 3, sy - 7, 7, 1);
      // Motes rising off the ring.
      ctx.globalAlpha = prev * a * 0.8;
      ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.9 + k / 3) % 1;
        const mx = Math.round(sx + Math.cos(spin * 0.7 + k * 2.1) * rx * 0.8);
        ctx.fillRect(mx, Math.round(sy - ph * 14), 1, 1);
      }
    }
    ctx.globalAlpha = prev;
  }

  _drawSlash(ctx, sx, sy) {
    const sw = this.swing;
    const f = Math.floor(sw.t / sw.frame);
    if (f >= SLASH_FRAMES) return;
    const spr = slashSprite(sw.kind === 'work' ? 0 : sw.step, sw.angle, f, sw.ccw);
    ctx.drawImage(spr.canvas, sx - spr.cx, sy - 9 - spr.cy);
  }

  _drawWorkBar(ctx, sx, sy) {
    const p = this.workBar.progress;
    const w = 14;
    const x = sx - 7;
    const y = sy - 31;
    ctx.fillStyle = '#1a1423';
    ctx.fillRect(x - 1, y - 1, w + 2, 4);
    ctx.fillStyle = '#3a3849';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = p >= 1 ? '#9ff0b8' : '#ffb047';
    ctx.fillRect(x, y, Math.max(1, Math.round(w * p)), 2);
  }

  // ------------------------------------------------------------ saving

  serialize() {
    const out = super.serialize();
    const c = this.crime;
    if (c) out.crime = { level: c.level, kind: c.kind, until: c.until, victimId: c.victimId ?? null, since: c.since ?? c.t ?? 0 };
    return out;
  }

  deserialize(d) {
    super.deserialize(d);
    if (!d) return;
    const c = d.crime;
    this.crime =
      c && Number.isFinite(c.until)
        ? { level: c.level === 2 ? 2 : 1, kind: c.kind === 'knockout' ? 'knockout' : 'assault', until: c.until, victimId: c.victimId ?? null, since: c.since ?? 0, t: c.since ?? 0 }
        : null;
    // Attack is not saved; it follows from the level.
    this.atk = this.baseAtk + (Math.max(1, this.level || 1) - 1) * LEVEL_ATK;
    if (!this.downed && this.hp <= 0) this.hp = Math.max(1, Math.round(this.maxHp * WAKE_HP));
    this._lastX = this.x;
    this._lastY = this.y;
    this.vel.x = 0;
    this.vel.y = 0;
  }
}
