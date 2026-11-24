import { TILE, FACTION } from '../core/constants.js';
import { dirFromVec, vecFromDir, norm } from '../core/math.js';
import { Inventory } from './items.js';
import { drawCharacter } from '../art/characters_art.js';
import { SHADOW } from '../art/palette.js';

let nextId = 1;
export const newId = (prefix = 'e') => `${prefix}${nextId++}`;

// How each faction regards each other faction by default.
// 'ally' = never attack, 'neutral' = attack only in attack mode or when provoked,
// 'hostile' = attack on sight. Personal relationships (Lyra's mind) can override.
export const FACTION_RELATIONS = {
  player: { player: 'ally', villager: 'ally', guard: 'ally', wildlife: 'neutral', monster: 'hostile', bandit: 'hostile', undead: 'hostile' },
  villager: { player: 'ally', villager: 'ally', guard: 'ally', wildlife: 'neutral', monster: 'hostile', bandit: 'hostile', undead: 'hostile' },
  guard: { player: 'ally', villager: 'ally', guard: 'ally', wildlife: 'neutral', monster: 'hostile', bandit: 'hostile', undead: 'hostile' },
  wildlife: { player: 'neutral', villager: 'neutral', guard: 'neutral', wildlife: 'neutral', monster: 'neutral', bandit: 'neutral', undead: 'neutral' },
  monster: { player: 'hostile', villager: 'hostile', guard: 'hostile', wildlife: 'neutral', monster: 'ally', bandit: 'neutral', undead: 'neutral' },
  bandit: { player: 'hostile', villager: 'hostile', guard: 'hostile', wildlife: 'neutral', monster: 'neutral', bandit: 'ally', undead: 'hostile' },
  undead: { player: 'hostile', villager: 'hostile', guard: 'hostile', wildlife: 'hostile', monster: 'neutral', bandit: 'hostile', undead: 'ally' },
};

export function factionRelation(a, b) {
  return FACTION_RELATIONS[a]?.[b] ?? 'neutral';
}

// Map an actor state to the character animation that shows it.
export function animForState(state) {
  switch (state) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'attack':
      return 'attack';
    case 'cast':
      return 'cast';
    case 'hurt':
      return 'hurt';
    case 'downed':
    case 'dead':
      return 'down';
    case 'work':
      return 'work';
    case 'sit':
      return 'sit';
    case 'sleep':
      return 'sleep';
    default:
      return 'idle';
  }
}

export class Entity {
  constructor(game, o = {}) {
    this.game = game;
    this.id = o.id ?? newId('e');
    this.type = 'entity';
    this.x = o.x ?? 0; // world pixels; for actors this is the point between the feet
    this.y = o.y ?? 0;
    this.z = 0; // height above ground (hops, bounces), drawn as an upward offset
    this.radius = o.radius ?? 5; // half-width of the feet collision box
    this.solid = o.solid ?? true; // pushes other solid entities apart
    this.dead = false;
    this.removed = false; // set true to have the manager drop it at the end of the step
    this.tags = new Set(o.tags || []);
    this.age = 0;
  }

  get sortY() {
    return this.y;
  }

  get tx() {
    return Math.floor(this.x / TILE);
  }

  get ty() {
    return Math.floor(this.y / TILE);
  }

  distTo(e) {
    return Math.hypot(e.x - this.x, e.y - this.y);
  }

  distToPoint(x, y) {
    return Math.hypot(x - this.x, y - this.y);
  }

  update(dt) {
    this.age += dt;
  }

  // Draw into the low-res world buffer. (ox, oy) is the camera's top-left in world pixels.
  draw(ctx, ox, oy, time) {}

  // Interaction hooks (see core/interact.js). Override in subclasses.
  canInteract(actor) {
    return false;
  }

  interactLabel(actor) {
    return '';
  }

  interact(actor) {}

  serialize() {
    return { id: this.id, x: this.x, y: this.y };
  }
}

export class Actor extends Entity {
  constructor(game, o = {}) {
    super(game, o);
    this.type = 'actor';
    this.name = o.name ?? 'Someone';
    this.kind = o.kind ?? 'human'; // human | animal | monster | undead
    this.faction = o.faction ?? FACTION.VILLAGER;
    this.maxHp = o.maxHp ?? 30;
    this.hp = o.hp ?? this.maxHp;
    this.atk = o.atk ?? 4;
    this.def = o.def ?? 0;
    this.speed = o.speed ?? 60; // pixels per second at a walk
    this.level = o.level ?? 1;
    this.xp = o.xp ?? 0;
    this.dir = o.dir ?? 'down';
    this.facing = vecFromDir(this.dir);
    this.state = 'idle';
    this.stateTime = 0;
    this.animTime = 0;
    this.lockTime = 0; // while > 0, the state is held and the actor cannot move
    this.rootTime = 0; // while > 0, rooted in place (Lyra's Binding Light) but can still act
    this.moveIntent = { x: 0, y: 0 }; // set by controllers each step; length <= 1
    this.speedMul = 1; // running, slows
    this.knock = { x: 0, y: 0 }; // knockback velocity (px/s), decays
    this.invuln = 0;
    this.flash = 0;
    this.attackCd = 0;
    this.downed = false; // knocked out (player and companion only); can be revived
    this.inventory = o.inventory instanceof Inventory ? o.inventory : new Inventory(o.inventory);
    this.controller = o.controller ?? null; // { update(actor, dt) }
    this.spriteKey = o.spriteKey ?? 'villager';
    this.perceptionRadius = o.perceptionRadius ?? 128;
    this.lastAttacker = null;
    this.lastAttackedAt = -Infinity;
    this.flying = o.flying ?? false; // ignores water and low obstacles (bats)
    this.moved = 0; // distance moved last step (for footsteps / anim)
    this.light = o.light ?? null; // optional {r, color, intensity} emitted every frame
  }

  isAlive() {
    return !this.dead && !this.downed && this.hp > 0;
  }

  setState(state, lock = 0) {
    if (this.state !== state) {
      this.state = state;
      this.stateTime = 0;
      this.animTime = 0;
    }
    if (lock > 0) this.lockTime = Math.max(this.lockTime, lock);
  }

  faceToward(x, y) {
    const v = norm(x - this.x, y - this.y);
    if (v.x || v.y) {
      this.facing = v;
      this.dir = dirFromVec(v.x, v.y, this.dir);
    }
  }

  faceDir(dir) {
    this.dir = dir;
    this.facing = vecFromDir(dir);
  }

  update(dt) {
    super.update(dt);
    this.stateTime += dt;
    this.animTime += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 6);
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.lockTime > 0) this.lockTime -= dt;
    if (this.rootTime > 0) this.rootTime = Math.max(0, this.rootTime - dt);

    if (this.isAlive() && this.controller) this.controller.update(this, dt);
    if (!this.isAlive()) this.moveIntent = { x: 0, y: 0 };

    // Movement: intent (unless locked) + knockback.
    let vx = this.knock.x;
    let vy = this.knock.y;
    const mi = this.moveIntent;
    const moving = this.lockTime <= 0 && this.rootTime <= 0 && (Math.abs(mi.x) > 0.01 || Math.abs(mi.y) > 0.01);
    if (moving) {
      const s = this.speed * this.speedMul;
      vx += mi.x * s;
      vy += mi.y * s;
      this.facing = norm(mi.x, mi.y);
      this.dir = dirFromVec(mi.x, mi.y, this.dir);
    }
    const bx = this.x;
    const by = this.y;
    if (vx || vy) this.game.entities.moveActor(this, vx * dt, vy * dt);
    this.moved = Math.hypot(this.x - bx, this.y - by);
    // Knockback friction.
    const k = Math.pow(0.0008, dt);
    this.knock.x *= k;
    this.knock.y *= k;
    if (Math.abs(this.knock.x) < 2) this.knock.x = 0;
    if (Math.abs(this.knock.y) < 2) this.knock.y = 0;

    // Locomotion state, unless an action holds the state.
    if (this.isAlive() && this.lockTime <= 0) {
      if (moving && this.moved > 0.01) {
        if (this.state !== 'walk') this.setState('walk');
      } else if (this.state === 'walk' || this.state === 'attack' || this.state === 'cast' || this.state === 'hurt') {
        this.setState('idle');
      }
    }

  }

  // Light this actor emits, collected by the renderer each frame (see render/lighting.js).
  getLight(time) {
    if (!this.light || !this.isAlive()) return null;
    return { x: this.x, y: this.y - 8, ...this.light };
  }

  draw(ctx, ox, oy, time) {
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    if (!this.flying || this.z < 1) {
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(sx, sy, this.radius + 1, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawCharacter(ctx, this.game.atlas, this.spriteKey, animForState(this.state), this.dir, this.animTime, sx, sy - Math.round(this.z), {
      flash: this.flash,
      alpha: this.invuln > 0 && !this.downed ? (Math.floor(this.invuln * 20) % 2 ? 0.55 : 1) : 1,
      state: this.state,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      hp: this.hp,
      maxHp: this.maxHp,
      level: this.level,
      xp: this.xp,
      dir: this.dir,
      downed: this.downed,
      inventory: this.inventory.serialize(),
    };
  }

  deserialize(d) {
    if (!d) return;
    for (const k of ['x', 'y', 'hp', 'maxHp', 'level', 'xp', 'dir', 'downed']) if (d[k] != null) this[k] = d[k];
    if (d.inventory) this.inventory.deserialize(d.inventory);
    this.facing = vecFromDir(this.dir);
  }
}
