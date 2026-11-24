import { Actor } from './entity.js';
import { FACTION } from '../core/constants.js';
import { drawCharacter } from '../art/characters_art.js';
import { Walker } from './npc_walker.js';
import { runCreatureAI } from './creature_ai.js';
import { inVillage, villageRect, hostileTo } from './creature_util.js';

export { inVillage, villageRect, hostileTo };

// Creatures: the species table, the Creature actor and spawnCreature().
// Stats are tuned against the player (60 HP, ~6 atk) and Lyra (50 HP, ~7 atk):
// a slime dies in three swings, a wolf pack is a real fight, the bandit chief
// needs both of you. Every attack is telegraphed (a held wind-up pose and a
// pulsing flash; the chief's slam also marks the ground) so it can be dodged.
//
// species fields:
//   name, kind, faction, hp, atk, def, speed (px/s walking), xp, drops [[itemId, chance, qty?]]
//   aggroRadius (px; 0 = never starts a fight), leashRadius (px from home), threat 0..3
//   ai: 'melee' | 'charger' | 'skittish' | 'pet' | 'flyer' | 'archer' | 'chief'
//   attack: { range, windup, recover, cooldown, damageMul, knockback, lunge, kind, arc }
//   chase (speed multiplier when hunting), flee (multiplier when running), fleeRadius,
//   radius (feet), flying, village (lives in the village), nightAggro (multiplier), pack

const A = (o) => ({ range: 16, windup: 0.4, recover: 0.45, cooldown: 1.1, damageMul: 1, knockback: 90, lunge: 0, kind: 'melee', arc: 1.6, ...o });

export const SPECIES = {
  slime: {
    name: 'Slime',
    kind: 'monster',
    faction: FACTION.MONSTER,
    hp: 16,
    atk: 4,
    def: 0,
    speed: 30,
    xp: 4,
    drops: [['slime_gel', 0.75], ['slime_gel', 0.2]],
    aggroRadius: 72,
    leashRadius: 150,
    threat: 1,
    ai: 'melee',
    chase: 1.25,
    attack: A({ range: 14, windup: 0.5, recover: 0.6, cooldown: 1.4, lunge: 120, kind: 'bite', arc: 1.8, knockback: 70 }),
    radius: 5,
    hops: true,
    spriteKey: 'slime',
  },
  wolf: {
    name: 'Wolf',
    kind: 'animal',
    faction: FACTION.MONSTER,
    hp: 26,
    atk: 6,
    def: 1,
    speed: 56,
    xp: 9,
    drops: [['wolf_pelt', 0.55], ['bone', 0.25]],
    aggroRadius: 112,
    leashRadius: 260,
    threat: 2,
    ai: 'melee',
    chase: 1.45,
    nightAggro: 1.35,
    pack: true,
    fleeBelow: 0.22,
    attack: A({ range: 15, windup: 0.36, recover: 0.5, cooldown: 1.15, lunge: 150, kind: 'bite', arc: 1.4, knockback: 80 }),
    radius: 6,
    spriteKey: 'wolf',
  },
  boar: {
    name: 'Boar',
    kind: 'animal',
    faction: FACTION.WILDLIFE,
    hp: 32,
    atk: 8,
    def: 2,
    speed: 36,
    xp: 10,
    drops: [['bone', 0.4]],
    aggroRadius: 0,
    leashRadius: 220,
    threat: 2,
    ai: 'charger',
    charge: 4.2,
    attack: A({ range: 14, windup: 0.75, recover: 0.9, cooldown: 1.6, damageMul: 1.25, knockback: 200, kind: 'melee', arc: 1.4 }),
    radius: 6,
    spriteKey: 'boar',
  },
  deer: {
    name: 'Deer',
    kind: 'animal',
    faction: FACTION.WILDLIFE,
    hp: 16,
    atk: 0,
    def: 0,
    speed: 42,
    xp: 3,
    drops: [['bone', 0.2]],
    aggroRadius: 0,
    leashRadius: 300,
    threat: 0,
    ai: 'skittish',
    flee: 2.3,
    fleeRadius: 72,
    radius: 6,
    spriteKey: 'deer',
  },
  rabbit: {
    name: 'Rabbit',
    kind: 'animal',
    faction: FACTION.WILDLIFE,
    hp: 5,
    atk: 0,
    def: 0,
    speed: 38,
    xp: 1,
    drops: [],
    aggroRadius: 0,
    leashRadius: 240,
    threat: 0,
    ai: 'skittish',
    flee: 2.7,
    fleeRadius: 52,
    hops: true,
    radius: 3,
    spriteKey: 'rabbit',
  },
  chicken: {
    name: 'Chicken',
    kind: 'animal',
    faction: FACTION.WILDLIFE,
    hp: 5,
    atk: 0,
    def: 0,
    speed: 26,
    xp: 1,
    drops: [],
    aggroRadius: 0,
    leashRadius: 110,
    threat: 0,
    ai: 'skittish',
    flee: 2.1,
    fleeRadius: 24,
    village: true,
    radius: 3,
    spriteKey: 'chicken',
  },
  cat: {
    name: 'Cat',
    kind: 'animal',
    faction: FACTION.WILDLIFE,
    hp: 18,
    atk: 0,
    def: 0,
    speed: 38,
    xp: 0,
    drops: [],
    aggroRadius: 0,
    leashRadius: 200,
    threat: 0,
    ai: 'pet',
    flee: 2.2,
    fleeRadius: 40,
    village: true,
    pet: true,
    radius: 3,
    spriteKey: 'cat',
  },
  bat: {
    name: 'Cave Bat',
    kind: 'animal',
    faction: FACTION.MONSTER,
    hp: 10,
    atk: 4,
    def: 0,
    speed: 62,
    xp: 5,
    drops: [['crystal', 0.06], ['bone', 0.15]],
    aggroRadius: 104,
    leashRadius: 200,
    threat: 1,
    ai: 'flyer',
    chase: 1.2,
    flying: true,
    attack: A({ range: 13, windup: 0.42, recover: 0.7, cooldown: 1.5, kind: 'bite', arc: 2.2, knockback: 40 }),
    radius: 4,
    spriteKey: 'bat',
  },
  skeleton: {
    name: 'Skeleton',
    kind: 'undead',
    faction: FACTION.UNDEAD,
    hp: 34,
    atk: 7,
    def: 2,
    speed: 32,
    xp: 14,
    drops: [['bone', 0.85, [1, 2]], ['coin', 0.5, [1, 4]], ['crystal', 0.08]],
    aggroRadius: 96,
    leashRadius: 200,
    threat: 2,
    ai: 'melee',
    chase: 1.35,
    attack: A({ range: 17, windup: 0.55, recover: 0.55, cooldown: 1.3, kind: 'melee', arc: 1.7, knockback: 100 }),
    radius: 5,
    spriteKey: 'skeleton',
  },
  bandit: {
    name: 'Bandit',
    kind: 'human',
    faction: FACTION.BANDIT,
    hp: 40,
    atk: 7,
    def: 1,
    speed: 48,
    xp: 16,
    drops: [['coin', 0.9, [2, 6]], ['bread', 0.3], ['potion', 0.1]],
    aggroRadius: 120,
    leashRadius: 230,
    threat: 2,
    ai: 'melee',
    chase: 1.4,
    attack: A({ range: 18, windup: 0.42, recover: 0.45, cooldown: 1.0, kind: 'melee', arc: 1.8, knockback: 110, lunge: 60 }),
    radius: 5,
    barks: ['Fresh meat!', 'Get them!', 'Your purse or your teeth!', 'Nobody walks out of here!', 'Cut them down!'],
    spriteKey: 'bandit',
  },
  bandit_archer: {
    name: 'Bandit Archer',
    kind: 'human',
    faction: FACTION.BANDIT,
    hp: 28,
    atk: 6,
    def: 0,
    speed: 50,
    xp: 16,
    drops: [['coin', 0.9, [2, 5]], ['wood', 0.3]],
    aggroRadius: 150,
    leashRadius: 240,
    threat: 2,
    ai: 'archer',
    ranged: true,
    keep: [72, 128],
    attack: A({ range: 150, windup: 0.6, recover: 0.35, cooldown: 1.9, kind: 'arrow', knockback: 60 }),
    radius: 5,
    barks: ['Hold still!', 'Feather them!', 'One clean shot...', 'Keep your distance, fool!'],
    spriteKey: 'bandit_archer',
  },
  bandit_chief: {
    name: 'Varek One-Eye',
    kind: 'human',
    faction: FACTION.BANDIT,
    hp: 130,
    atk: 12,
    def: 3,
    speed: 40,
    xp: 60,
    drops: [['coin', 1, [15, 25]], ['potion', 1], ['iron_sword', 0.35]],
    aggroRadius: 120,
    leashRadius: 170,
    threat: 3,
    ai: 'chief',
    chase: 1.3,
    superArmor: true,
    attack: A({ range: 22, windup: 0.5, recover: 0.6, cooldown: 1.3, damageMul: 1, knockback: 140, kind: 'melee', arc: 2.0, lunge: 50 }),
    slam: { windup: 1.0, radius: 36, damageMul: 1.6, knockback: 230, cooldown: 5.5, recover: 1.0 },
    radius: 7,
    barks: ['Varek takes what he wants!', 'Come here, little hero!', 'I will split you like kindling!', 'You should have stayed in your village!'],
    spriteKey: 'bandit_chief',
  },
};

// The look of each sprite variant: which atlas key a creature draws with.
const VARIANT_BY_PLACE = { mirror_lake: 'slime_blue', stonecut_quarry: 'slime_rose' };

function hashXY(x, y) {
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function pickSpriteKey(game, species, x, y, opts = {}) {
  const spec = SPECIES[species];
  if (opts.variant) return opts.variant;
  if (!spec) return species;
  if (species === 'slime') {
    let loc = null;
    try {
      loc = game?.locations?.at?.(x, y);
    } catch {
      loc = null;
    }
    const id = loc?.id;
    return VARIANT_BY_PLACE[id] || VARIANT_BY_PLACE[loc?.parent] || 'slime';
  }
  if (species === 'wolf') return opts.night || hashXY(x, y) < 0.3 ? 'wolf_dark' : 'wolf';
  if (species === 'chicken') return hashXY(x, y) < 0.45 ? 'chicken_brown' : 'chicken';
  return spec.spriteKey;
}

let creatureSeq = 1;

export class Creature extends Actor {
  constructor(game, species, o = {}) {
    const spec = SPECIES[species] || SPECIES.slime;
    const sp = SPECIES[species] ? species : 'slime';
    super(game, {
      id: o.id ?? `${sp}_${creatureSeq++}`,
      name: o.name ?? spec.name,
      kind: spec.kind,
      faction: spec.faction,
      maxHp: spec.hp,
      atk: spec.atk,
      def: spec.def,
      speed: spec.speed,
      radius: spec.radius ?? 5,
      flying: !!spec.flying,
      perceptionRadius: Math.max(80, spec.aggroRadius || 0, spec.fleeRadius || 0),
      spriteKey: o.spriteKey ?? pickSpriteKey(game, sp, o.x ?? 0, o.y ?? 0, o),
      x: o.x,
      y: o.y,
    });
    this.type = 'actor';
    this.species = sp;
    this.spec = spec;
    this.drops = spec.drops.map((d) => d.slice());
    this.xpValue = spec.xp;
    this.home = o.home ? { x: o.home.x, y: o.home.y } : { x: this.x, y: this.y };
    this.aggroRadius = spec.aggroRadius;
    this.leashRadius = spec.leashRadius;
    this.threat = spec.threat;
    this.ranged = !!spec.ranged;
    this.superArmor = !!spec.superArmor;
    this.pet = !!spec.pet;
    this.spawnZone = o.spawnZone ?? null;
    this.nightCreature = !!o.night;
    // Wild things keep out of the village unless they were born in it.
    this.villager = !!spec.village || inVillage(game, this.home.x, this.home.y);
    this.target = null;
    this.ai = { state: 'idle', t: 0, dur: 1, target: null, tx: 0, ty: 0, flankSign: (creatureSeq & 1) ? 1 : -1 };
    this.jitter = hashXY(this.home.x + creatureSeq, this.home.y);
    this.thinkT = this.jitter * 0.4;
    this.holdFrame = null; // a held anim frame (wind-up poses)
    this.telegraph = 0; // 0..1 wind-up glow
    this.slamAt = null; // { x, y, r, t, dur } the chief's marked ground
    this.walker = new Walker(game, this, { doors: false, arriveDist: 4 });
    this.provokedBy = null;
    this.provokedAt = -Infinity;
    this.provokedMode = null;
    this.scaredOf = null;
    this.scaredUntil = 0;
    this.barkT = 4 + this.jitter * 6;
    this.controller = CREATURE_CONTROLLER;
    if (spec.flying) this.z = 8;
    if (o.hpMul) {
      this.maxHp = Math.round(this.maxHp * o.hpMul);
      this.hp = this.maxHp;
    }
  }

  get aiState() {
    return this.ai.state;
  }

  update(dt) {
    super.update(dt);
    // The wind-up glow fades once the blow has landed.
    if (this.telegraph > 0 && this.ai.state !== 'windup' && this.ai.state !== 'slam') this.telegraph = Math.max(0, this.telegraph - dt * 4);
  }

  // Combat hooks (combat.damage calls these when present).
  onHurt(source) {
    if (!source) return;
    const src = source.type === 'projectile' ? source.owner || null : source;
    if (!src || src === this) return;
    const now = this.game.clock?.t ?? 0;
    if (this.provokedBy !== src || now - this.provokedAt > 1) {
      this.provokedBy = src;
      this.provokedAt = now;
      if (!this.provokedMode) {
        const fights = this.spec.ai === 'charger' || this.spec.ai === 'melee' || this.spec.ai === 'chief' || this.spec.ai === 'archer' || this.spec.ai === 'flyer';
        this.provokedMode = fights ? 'fight' : 'flee';
      }
    }
    this.ai.hurtT = now;
  }

  // Make a creature run from someone for a while (a farmer waving a hoe at a boar).
  scare(from, seconds = 4) {
    if (!from) return;
    this.scaredOf = from;
    this.scaredUntil = (this.game.clock?.t ?? 0) + seconds;
    if (this.target === from) this.target = null;
  }

  canInteract() {
    return false;
  }

  draw(ctx, ox, oy, time) {
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const z = Math.round(this.z || 0);
    const spec = this.spec;
    // Ground shadow: shrinks as a flyer climbs.
    const sr = (spec.shadow ?? this.radius + 2) * (this.flying ? Math.max(0.45, 1 - z / 30) : 1);
    ctx.fillStyle = SHADOW_FILL;
    ctx.beginPath();
    ctx.ellipse(sx, sy, sr, Math.max(1.5, sr * 0.38), 0, 0, Math.PI * 2);
    ctx.fill();
    const slam = this.slamAt;
    if (slam) {
      // The chief's slam marks the ground: a ring that fills as the blow comes.
      const k = Math.min(1, slam.t / slam.dur);
      const cx = Math.round(slam.x - ox);
      const cy = Math.round(slam.y - oy);
      ctx.globalAlpha = 0.18 + 0.22 * k;
      ctx.fillStyle = SLAM_FILL;
      ctx.beginPath();
      ctx.ellipse(cx, cy, slam.r * k, slam.r * k * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(time * 18) * k;
      ctx.strokeStyle = SLAM_EDGE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, slam.r, slam.r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    let anim = animFor(this);
    const opts = DRAW_OPTS;
    opts.flash = Math.max(this.flash || 0, this.telegraph > 0 ? this.telegraph * (0.35 + 0.3 * Math.sin(time * 26)) : 0);
    opts.alpha = this.invuln > 0 && !this.dead ? (Math.floor(this.invuln * 20) % 2 ? 0.6 : 1) : 1;
    opts.frame = this.holdFrame;
    opts.state = this.state;
    drawCharacter(ctx, this.game.atlas, this.spriteKey, anim, this.dir, this.animTime, sx, sy - z, opts);
  }

  serialize() {
    return { ...super.serialize(), species: this.species, home: this.home, spawnZone: this.spawnZone };
  }
}

// One shared controller: the AI state lives on each creature.
const CREATURE_CONTROLLER = {
  update(c, dt) {
    try {
      runCreatureAI(c, dt);
    } catch (err) {
      c.moveIntent.x = 0;
      c.moveIntent.y = 0;
      if (!c._aiWarned) {
        c._aiWarned = true;
        console.error('[creature] AI failed', c.species, err);
      }
    }
  },
};

const DRAW_OPTS = { flash: 0, alpha: 1, frame: null, state: 'idle' };
const SHADOW_FILL = 'rgba(16, 10, 28, 0.35)';
const SLAM_FILL = '#ff6b5e';
const SLAM_EDGE = '#ffb047';

function animFor(c) {
  switch (c.state) {
    case 'walk':
    case 'run':
      return 'walk';
    case 'attack':
      return 'attack';
    case 'hurt':
      return 'hurt';
    case 'downed':
    case 'dead':
      return 'down';
    case 'sit':
      return 'sit';
    case 'sleep':
      return 'sleep';
    case 'cast':
      return 'cast';
    default:
      return c.flying ? 'walk' : 'idle';
  }
}

// Create a creature and add it to the world. Unknown species fall back to a slime
// (and say so) rather than throwing in the middle of world building.
export function spawnCreature(game, species, x, y, opts = {}) {
  if (!SPECIES[species]) console.warn(`[creatures] unknown species "${species}", spawning a slime`);
  const c = new Creature(game, species, { ...opts, x, y });
  return game.entities.add(c);
}
