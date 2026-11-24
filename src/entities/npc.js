import { Actor } from './entity.js';
import { FACTION, TILE } from '../core/constants.js';
import { entryAt, adjustForWeather } from './npc_schedule.js';
import { Walker } from './npc_walker.js';
import { now, rand, hostileTo, alive, walkLine, speak, pickLine } from './creature_util.js';
import * as D from './npc_dialogue.js';

// Villagers of Hearthvale. Each one lives by the 24-hour schedule in its profile
// (npc_data.js): walks there with the pathfinder (opening doors and closing them
// behind), then works, eats, prays, patrols, socializes or sleeps. Around that
// routine they react: they greet the player, talk to Lyra (and about her when she
// lives apart), chat with each other, flee from monsters (guards fight them), and
// flee and shout when the player commits a crime (guards fight the player while
// combat says the guard is hostile to them). Villagers are never killed: combat
// knocks them out, they get up after 30 s at half health and go home shaken for
// the rest of the day.

export const KNOCKOUT_SECONDS = 30;
export const SIGHT = 150; // how far a villager sees a crime or a threat (px)
const THREAT_RADIUS = 96; // monsters closer than this send villagers running
const GUARD_RADIUS = 170; // guards engage hostiles this close
const GUARD_CRIME_HEAR = 420; // guards come running to a crime this far away
const GUARD_LEASH = 300; // and give up the chase this far from their post
const SAY_GAP = 6; // seconds between ambient lines from any two villagers

const WORK_OBJECTS = {
  bram: ['anvil', 'forge'],
  elda: ['hearth', 'campfire', 'barrel', 'table'],
  mira: ['shelf', 'table', 'barrel'],
  aveline: ['altar'],
  garrick: ['shelf', 'crate', 'barrel', 'table'],
  tobias: ['crop'],
  rowan: ['table', 'crate'],
};

// Is the actor (the player by default) wanted for a crime right now?
export function crimeActive(game, actor = game?.player) {
  if (!actor) return false;
  try {
    if (game?.combat?.hasCrime) return !!game.combat.hasCrime(actor);
  } catch {
    /* fall back to the field */
  }
  const c = actor.crime;
  if (!c) return false;
  if (c.active === false) return false;
  return !Number.isFinite(c.until) || c.until > now(game);
}

// Lyra's companionship state ('together' | 'wary' | 'apart' | 'left' | 'gone').
export function companionshipOf(game) {
  const m = game?.companion?.mind;
  const s = m?.companionship ?? m?.autonomy?.companionship;
  return typeof s === 'string' ? s : 'together';
}

// Today's crimes in the village, shared by every villager of one game.
function crimeLog(game) {
  const day = game?.clock?.day ?? 1;
  let log = game._npcCrimeLog;
  if (!log || log.day !== day) log = game._npcCrimeLog = { day, assaults: 0, knockouts: 0, victims: new Set(), seen: new WeakSet() };
  return log;
}

const NPC_CONTROLLER = {
  update(npc, dt) {
    npc.think(dt);
  },
};

export class NPC extends Actor {
  constructor(game, profile, o = {}) {
    const c = profile.combat || {};
    const child = profile.appearance?.build === 'child';
    const big = profile.appearance?.build === 'big';
    super(game, {
      id: profile.id,
      name: profile.name,
      kind: 'human',
      faction: profile.faction || FACTION.VILLAGER,
      spriteKey: profile.spriteKey || profile.id,
      maxHp: c.maxHp ?? (child ? 26 : big ? 50 : 36),
      atk: c.atk ?? 3,
      def: c.def ?? 0,
      speed: profile.speed ?? (child ? 46 : profile.faction === 'guard' ? 50 : 40),
      radius: 5,
      perceptionRadius: SIGHT,
      ...o,
    });
    this.profile = profile;
    this.role = profile.role;
    this.essential = true; // never killed (combat downs them instead)
    this.downable = true;
    this.isGuard = this.faction === FACTION.GUARD;
    this.activity = 'idle';
    this.activityAt = null;
    this.opinionOfPlayer = clamp(profile.startOpinion ?? 30, 0, 100);
    this.familiarity = 0; // with the player, 0..100 (gates facts)
    this.told = new Set(); // fact ids told to the player
    this.mode = 'routine'; // routine | flee | fight | downed
    this.controller = NPC_CONTROLLER;
    this.walker = new Walker(game, this, { doors: true, arriveDist: 3 });
    this.anchor = { x: this.x, y: this.y }; // where the world put them (fallback spot)
    this.r = { key: null, entry: null, phase: 'stay', t: 0, spot: null, sub: 'idle', subT: 0, subDur: 1, walking: false };
    this.jitter = hashId(profile.id);
    this.thinkT = this.jitter * 0.3;
    this.socialT = 1 + this.jitter * 2;
    // Reactions and memory of the day.
    this.fleeFrom = null;
    this.fleeUntil = 0;
    this.fleeHome = false;
    this.fightTarget = null;
    this.post = null;
    this.windup = 0;
    this.attackReadyAt = 0;
    this.downedFor = 0;
    this.shakenDay = -1;
    this.coldDay = -1;
    this.wrongedDay = -1;
    this.giftDay = -1;
    this.giftsToday = 0;
    this.talkDay = -1;
    this.talkFamToday = 0;
    this.talkingUntil = -Infinity;
    this.greetedAt = -Infinity;
    this.ambientAt = -Infinity;
    this.lyraAt = -Infinity;
    this.shoutAt = -Infinity;
    this.chatAt = -Infinity;
    this.roomDay = -1;
    this.pendingSay = null;
    this._objCache = new Map();
    this._offs = [];
    const bus = game.bus;
    if (bus?.on) {
      this._offs.push(bus.on('crime', (p) => this.onCrime(p)));
      this._offs.push(bus.on('speech', (p) => {
        if (p && p.target === this && p.speaker !== this) this.hears(p.speaker, p.text);
      }));
      this._offs.push(bus.on('entity_removed', (p) => {
        if (p?.entity === this) for (const off of this._offs) off?.();
      }));
    }
  }

  get shortName() {
    return D.firstName(this);
  }

  // ------------------------------------------------------------ main loop

  update(dt) {
    super.update(dt);
    if (this.downed) {
      this.downedFor += dt;
      if (this.downedFor >= KNOCKOUT_SECONDS) this.getUp();
      return;
    }
    // Hit to zero by something that does not know villagers only get knocked out.
    if (this.hp <= 0 && !this.dead) this.knockOut(this.lastAttacker || null);
    if (this.pendingSay && now(this.game) >= this.pendingSay.at) {
      const s = this.pendingSay;
      this.pendingSay = null;
      this.say(s.text, { kind: s.kind, target: s.target });
    }
  }

  think(dt) {
    this.thinkT -= dt;
    let tick = false;
    if (this.thinkT <= 0) {
      tick = true;
      this.thinkT = 0.33 + this.jitter * 0.1;
      this.perceive();
    }
    if (this.mode === 'flee') return this.fleeStep(dt, tick);
    if (this.mode === 'fight') return this.fightStep(dt, tick);
    // Someone is talking to us: stand still and look at them.
    const p = this.game.player;
    if (now(this.game) < this.talkingUntil && p && this.distTo(p) < 56) {
      this.walker.stop();
      if (this.state !== 'sleep' && this.state !== 'sit') this.faceToward(p.x, p.y);
      return;
    }
    this.routine(dt, tick);
    this.socialT -= dt;
    if (tick && this.socialT <= 0) {
      this.socialT = 0.9 + this.jitter * 0.4;
      this.social();
    }
  }

  // ------------------------------------------------------------ schedule

  currentEntry() {
    const g = this.game;
    const clock = g.clock;
    const hour = clock?.hour ?? 12;
    const p = this.profile;
    let e = entryAt(p.schedule, hour) || { activity: 'wander', at: p.home };
    // Knocked out today: home for the rest of the day.
    if (this.shakenDay === (clock?.day ?? 1)) e = { activity: hour >= 20 || hour < 6 ? 'sleep' : 'rest', at: p.home };
    const w = clock?.weather;
    const raining = !!w && w.type === 'rain' && (w.intensity ?? 1) > 0.3;
    e = adjustForWeather(e, { raining, night: !!clock?.isNight, home: p.home, isIndoor: (id) => !!g.locations?.get?.(id)?.indoor });
    return e;
  }

  locFor(id) {
    const L = this.game.locations;
    return L?.get?.(id) || L?.get?.(this.profile.home) || null;
  }

  routine(dt, tick) {
    const r = this.r;
    if (tick || !r.key) {
      const e = this.currentEntry();
      const key = `${e.activity}@${e.at}`;
      if (key !== r.key) this.beginEntry(e, key);
    }
    r.t += dt;
    if (r.phase === 'travel') {
      const res = this.walker.step(dt);
      if (res === 'arrived' || res === 'idle') this.arrive();
      else if (res === 'stuck') this.onStuck();
      return;
    }
    this.perform(dt, tick);
  }

  beginEntry(e, key) {
    const r = this.r;
    r.key = key;
    r.entry = e;
    this.activity = e.activity;
    this.activityAt = e.at;
    this.wake();
    const spot = this.spotFor(e);
    r.spot = spot;
    r.t = 0;
    r.sub = 'idle';
    r.subT = 0;
    r.subDur = 0.5;
    r.walking = false;
    if (!spot || this.distToPoint(spot.x, spot.y) < 4) {
      this.arrive();
      return;
    }
    // Nobody watches villagers walk across the far side of the map: skip the trip.
    if (!this.visibleToPlayer(160) && this.farFromPlayer(520)) {
      this.x = spot.x;
      this.y = spot.y;
      this.arrive();
      return;
    }
    r.phase = 'travel';
    this.walker.goTo(spot.x, spot.y);
  }

  onStuck() {
    const r = this.r;
    if (!this.visibleToPlayer(64) && r.spot) {
      this.x = r.spot.x;
      this.y = r.spot.y;
      this.arrive();
      return;
    }
    // Try another spot for the same activity.
    const spot = this.spotFor(r.entry || this.currentEntry(), true);
    r.spot = spot;
    if (spot) this.walker.goTo(spot.x, spot.y);
    else this.arrive();
  }

  arrive() {
    const r = this.r;
    r.phase = 'stay';
    r.t = 0;
    r.sub = 'idle';
    r.subT = 0;
    r.subDur = 0.8 + rand(this.game) * 1.5;
    r.walking = false;
    this.walker.stop();
    const s = r.spot;
    if (s?.face) this.faceDir(s.face);
    else if (s?.lookAt) this.faceToward(s.lookAt.x, s.lookAt.y);
    const a = this.activity;
    if (a === 'sleep') this.setState('sleep', 0.8);
    else if (a === 'eat' || a === 'rest') this.setState('sit', 0.8);
  }

  wake() {
    if (this.state === 'sleep' || this.state === 'sit' || this.state === 'work') {
      this.lockTime = 0;
      this.setState('idle');
    }
  }

  // Where to stand for an activity: a bed, a workbench, a seat, the altar, a crop,
  // or a free floor tile inside the place.
  spotFor(e, reroll = false) {
    const loc = this.locFor(e.at);
    if (!loc) return { x: this.anchor.x + (reroll ? (rand(this.game) - 0.5) * 32 : 0), y: this.anchor.y };
    const id = this.profile.id;
    const salt = reroll ? Math.floor(rand(this.game) * 97) : 0;
    switch (e.activity) {
      case 'sleep': {
        const bed = this.objectsIn(loc, ['bed']).find((o) => (o.owner ?? o.state?.owner) === id);
        if (bed) return { x: bed.x, y: bed.y - 6, face: 'down' };
        return this.floorSpot(loc, 11 + salt);
      }
      case 'work':
      case 'farm': {
        const types = WORK_OBJECTS[id] || (e.activity === 'farm' ? ['crop'] : null);
        if (types) {
          const objs = this.objectsIn(loc, types);
          if (objs.length) {
            const o = objs[(Math.floor(this.jitter * 7) + salt + (e.activity === 'farm' ? Math.floor(rand(this.game) * objs.length) : 0)) % objs.length];
            return this.besideObject(o);
          }
        }
        return this.floorSpot(loc, 3 + salt);
      }
      case 'eat':
      case 'rest': {
        const seats = this.objectsIn(loc, ['chair', 'table']);
        if (seats.length) {
          const o = seats[(Math.floor(this.jitter * 13) + salt) % seats.length];
          const sp = this.besideObject(o, true);
          if (sp) return sp;
        }
        return this.floorSpot(loc, 5 + salt);
      }
      case 'pray': {
        const altar = this.objectsIn(loc, ['altar'])[0];
        if (altar) {
          const dx = Math.round((this.jitter - 0.5) * 3) * TILE;
          const s = this.freeNear(altar.x + dx, altar.y + TILE * 2);
          if (s) return { ...s, face: 'up' };
        }
        return { ...this.floorSpot(loc, 7 + salt), face: 'up' };
      }
      default:
        return this.floorSpot(loc, Math.floor(rand(this.game) * 1000));
    }
  }

  objectsIn(loc, types) {
    const key = `${loc.id}|${types.join(',')}`;
    let list = this._objCache.get(key);
    if (list) return list;
    list = [];
    const all = this.game.objects?.all?.() || [];
    const b = loc.bounds;
    for (const o of all) {
      if (!types.includes(o.objType)) continue;
      const tx = o.tx ?? Math.floor(o.x / TILE);
      const ty = o.ty ?? Math.floor(o.y / TILE);
      if (tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h) list.push(o);
    }
    this._objCache.set(key, list);
    return list;
  }

  // A walkable spot next to an object (below it first: we face it from the front).
  besideObject(o, sit = false) {
    const tries = [
      [0, 1, 'up'],
      [-1, 0, 'right'],
      [1, 0, 'left'],
      [0, -1, 'down'],
    ];
    const tx = o.tx ?? Math.floor(o.x / TILE);
    const ty = o.ty ?? Math.floor(o.y / TILE);
    for (const [dx, dy, face] of tries) {
      if (!this.tileFree(tx + dx, ty + dy)) continue;
      return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 + 2, face, object: o, sit };
    }
    return null;
  }

  tileFree(tx, ty) {
    const g = this.game;
    try {
      if (g.isBlockedTile?.(tx, ty, this)) return false;
      if (g.objects?.doorAt?.(tx, ty)) return false;
    } catch {
      return false;
    }
    return true;
  }

  freeNear(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.tileFree(tx + dx, ty + dy)) return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 + 2 };
        }
      }
    }
    return null;
  }

  // A free floor tile inside a place, chosen by a salted hash (stable per villager).
  floorSpot(loc, salt = 0) {
    const b = loc.bounds;
    const inset = loc.indoor ? 1 : 0;
    const w = Math.max(1, b.w - inset * 2);
    const h = Math.max(1, b.h - inset * 2);
    // Big outdoor places: stay near where we are, or near the place's center.
    const big = !loc.indoor && w * h > 400;
    for (let k = 0; k < 16; k++) {
      const u = hash01(this.jitter * 9973 + salt * 31 + k * 7.3);
      const v = hash01(this.jitter * 7919 + salt * 17 + k * 3.1 + 0.5);
      let tx;
      let ty;
      if (big) {
        const cx = this.r.phase === 'stay' && this.r.entry?.at === loc.id ? this.x : loc.center.x;
        const cy = this.r.phase === 'stay' && this.r.entry?.at === loc.id ? this.y : loc.center.y;
        tx = Math.floor(cx / TILE + (u - 0.5) * 14);
        ty = Math.floor(cy / TILE + (v - 0.5) * 10);
        if (tx < b.x || ty < b.y || tx >= b.x + b.w || ty >= b.y + b.h) continue;
      } else {
        tx = b.x + inset + Math.floor(u * w);
        ty = b.y + inset + Math.floor(v * h);
      }
      if (this.tileFree(tx, ty)) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 + 2 };
    }
    return { x: loc.center.x, y: loc.center.y };
  }

  // Doing the activity once there.
  perform(dt, tick) {
    const r = this.r;
    const a = this.activity;
    const g = this.game;
    r.subT += dt;
    if (r.walking) {
      const res = this.walker.step(dt, r.walkMul || 1);
      if (res === 'arrived' || res === 'idle' || res === 'stuck') {
        r.walking = false;
        r.sub = 'idle';
        r.subT = 0;
        r.subDur = 1 + rand(g) * 3;
        if (r.lookDir) this.faceDir(r.lookDir);
      }
      return;
    }
    switch (a) {
      case 'sleep':
        this.setState('sleep', 0.8);
        if (tick && rand(g) < 0.02 && this.visibleToPlayer(0)) this.icon('zzz');
        return;
      case 'eat':
      case 'rest':
        this.setState('sit', 0.8);
        return;
      case 'pray':
        if (r.sub === 'kneel') {
          this.setState('sit', 0.5);
          if (r.subT > r.subDur) this.nextSub('idle', 4 + rand(g) * 5);
        } else if (r.subT > r.subDur) {
          this.faceDir('up');
          this.nextSub('kneel', 5 + rand(g) * 6);
        }
        return;
      case 'work':
      case 'farm':
        return this.performWork(dt, tick);
      case 'patrol':
        if (r.subT > r.subDur) {
          // Walk to the next point, then stand and look around.
          const loc = this.locFor(r.entry?.at);
          const s = loc ? this.floorSpot(loc, Math.floor(rand(g) * 1000)) : null;
          if (s) this.walkTo(s, 0.9);
          r.subDur = 2 + rand(g) * 3;
          r.subT = 0;
        } else if (tick && rand(g) < 0.15) this.faceDir(DIR_CYCLE[Math.floor(rand(g) * 4)]);
        return;
      default:
        return this.performWander(dt, tick);
    }
  }

  performWork(dt, tick) {
    const r = this.r;
    const g = this.game;
    // Only people with a tool in hand (hammer, hoe, ladle) swing it; shopkeepers and
    // the sister tend their place instead.
    const hands = !!this.profile.appearance?.workTool;
    if (r.sub === 'work' && !hands) r.sub = 'tend';
    if (r.sub === 'tend') {
      if (tick && rand(g) < 0.08) this.faceDir(DIR_CYCLE[Math.floor(rand(g) * 4)]);
      if (r.subT > r.subDur) this.nextSub('pause', 0.5);
      return;
    }
    if (r.sub === 'work') {
      if (this.state !== 'work') this.setState('work', 0.6);
      else this.lockTime = Math.max(this.lockTime, 0.3);
      // Sparks off the anvil, while someone can see them.
      if (this.profile.id === 'bram' && tick && this.visibleToPlayer(0) && rand(g) < 0.5) {
        try {
          const f = this.facing;
          g.particles?.emit?.('spark', this.x + f.x * 10, this.y + f.y * 6 - 8, { count: 3, color: '#ffb047', speed: 40, life: 0.35 });
        } catch {
          /* cosmetic */
        }
      }
      if (r.subT > r.subDur) {
        this.lockTime = 0;
        this.setState('idle');
        this.nextSub('pause', 1.2 + rand(g) * 2.5);
      }
      return;
    }
    if (r.subT > r.subDur) {
      // Farmers and shopkeepers move between jobs; smiths stay at the anvil.
      const roams = this.activity === 'farm' || ['garrick', 'mira', 'elda', 'tobias'].includes(this.profile.id);
      if (roams && rand(g) < 0.35) {
        const s = this.spotFor(r.entry || this.currentEntry(), true);
        if (s && this.distToPoint(s.x, s.y) > 6) {
          this.walkTo(s, 0.85, s.face);
          return;
        }
      }
      if (r.spot?.face) this.faceDir(r.spot.face);
      this.nextSub('work', 2.4 + rand(g) * 3);
    }
  }

  performWander(dt, tick) {
    const r = this.r;
    const g = this.game;
    if (r.subT <= r.subDur) {
      if (this.activity === 'socialize' && tick && rand(g) < 0.2) {
        const other = this.nearestPerson(48);
        if (other) this.faceToward(other.x, other.y);
      }
      return;
    }
    // Pip trails the stray cat when it is around.
    if (this.profile.id === 'pip') {
      const cat = g.entities?.nearest?.(this.x, this.y, 170, (e) => e.species === 'cat' && alive(e));
      if (cat && rand(g) < 0.7) {
        this.walkTo({ x: cat.x + (rand(g) - 0.5) * 24, y: cat.y + 10 }, 1.1);
        r.subDur = 0.8 + rand(g) * 1.5;
        r.subT = 0;
        return;
      }
    }
    const loc = this.locFor(r.entry?.at);
    const s = loc ? this.floorSpot(loc, Math.floor(rand(g) * 1000)) : null;
    if (s && this.distToPoint(s.x, s.y) > 6) this.walkTo(s, this.activity === 'socialize' ? 0.7 : 0.8);
    r.subDur = (this.activity === 'socialize' ? 4 : 2) + rand(g) * 5;
    r.subT = 0;
  }

  nextSub(sub, dur) {
    const r = this.r;
    r.sub = sub;
    r.subT = 0;
    r.subDur = dur;
  }

  walkTo(spot, mul = 1, lookDir = null) {
    const r = this.r;
    this.wake();
    r.walking = true;
    r.walkMul = mul;
    r.lookDir = lookDir;
    this.walker.goTo(spot.x, spot.y);
  }

  // ------------------------------------------------------------ perception

  perceive() {
    const g = this.game;
    const p = g.player;
    const list = g.entities?.list || g.entities?.all?.() || [];
    let threat = null;
    let td = Infinity;
    let foe = null;
    let fd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this || e.type !== 'actor' || e.removed || e.dead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > GUARD_RADIUS * GUARD_RADIUS) continue;
      if (!alive(e)) continue;
      if (this.isGuard) {
        if (d2 < fd && hostileTo(g, this, e) && this.canSee(e)) {
          foe = e;
          fd = d2;
        }
      } else if (e !== p && d2 < THREAT_RADIUS * THREAT_RADIUS && d2 < td && hostileTo(g, e, this) && this.canSee(e)) {
        threat = e;
        td = d2;
      }
    }
    if (this.isGuard) {
      if (foe && this.mode !== 'fight') this.startFight(foe);
      else if (foe && this.mode === 'fight' && this.fightTarget !== foe && !alive(this.fightTarget)) this.fightTarget = foe;
      return;
    }
    // The player is wanted: keep clear of them.
    if (p && alive(p) && crimeActive(g, p) && this.distTo(p) < SIGHT && this.canSee(p)) {
      if (this.mode !== 'flee' || this.fleeFrom !== p) this.startFlee(p, 8, 'crime');
      else this.fleeUntil = Math.max(this.fleeUntil, now(g) + 4);
      return;
    }
    if (threat) {
      if (this.mode !== 'flee' || this.fleeFrom !== threat) this.startFlee(threat, 6, 'flee');
      else this.fleeUntil = Math.max(this.fleeUntil, now(g) + 3);
    }
  }

  // Same space: both outside, or both inside the same building.
  canSee(e) {
    const map = this.game.map;
    if (!map?.buildingAt) return true;
    try {
      const a = map.buildingAt(Math.floor(this.x / TILE), Math.floor(this.y / TILE));
      const b = map.buildingAt(Math.floor(e.x / TILE), Math.floor(e.y / TILE));
      return (a?.id ?? null) === (b?.id ?? null);
    } catch {
      return true;
    }
  }

  isWantedNear(player = this.game.player) {
    return !!player && crimeActive(this.game, player) && this.distTo(player) < SIGHT;
  }

  crimeActive() {
    return crimeActive(this.game);
  }

  crimeToday() {
    const log = this.game._npcCrimeLog;
    const day = this.game.clock?.day ?? 1;
    return log && log.day === day && (log.assaults || log.knockouts) ? log : null;
  }

  lyraState() {
    return companionshipOf(this.game);
  }

  // ------------------------------------------------------------ fleeing

  startFlee(from, seconds, shout = 'flee') {
    const g = this.game;
    this.mode = 'flee';
    this.fleeFrom = from;
    this.fleeUntil = now(g) + seconds;
    this.wake();
    this.walker.stop();
    this.r.walking = false;
    // Run home if home is not past the danger; otherwise just away.
    const home = this.locFor(this.profile.home);
    this.fleeHome = false;
    if (home) {
      const hx = home.center.x - this.x;
      const hy = home.center.y - this.y;
      const fx = from.x - this.x;
      const fy = from.y - this.y;
      const hl = Math.hypot(hx, hy) || 1;
      const fl = Math.hypot(fx, fy) || 1;
      if ((hx * fx + hy * fy) / (hl * fl) < 0.2 && hl < 700) {
        this.fleeHome = true;
        this.walker.goTo(home.center.x, home.center.y);
      }
    }
    if (now(g) - this.shoutAt > 5) {
      this.shoutAt = now(g);
      const list = shout === 'crime' ? this.profile.crime : this.profile.flee;
      this.say(pickLine(g, list) || 'Help!', { kind: 'shout', target: from });
      this.icon('!');
    }
  }

  fleeStep(dt, tick) {
    const g = this.game;
    const from = this.fleeFrom;
    if (tick) {
      const gone = !from || !alive(from) || from.removed;
      const far = from ? this.distTo(from) > 130 : true;
      if (gone || (now(g) > this.fleeUntil && far)) return this.endFlee();
    }
    this.speedMul = 1.75;
    if (this.fleeHome) {
      const res = this.walker.step(dt);
      if (res === 'arrived' || res === 'idle') {
        // Safe inside: stay put and peek at the door.
        this.moveIntent.x = 0;
        this.moveIntent.y = 0;
        this.fleeHome = 'there';
      } else if (res === 'stuck') this.fleeHome = false;
      return;
    }
    if (from) this.steerAway(from.x, from.y, 1);
  }

  steerAway(x, y, mul) {
    let dx = this.x - x;
    let dy = this.y - y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    for (const a of [0, 0.8, -0.8, 1.6, -1.6]) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ux = dx * ca - dy * sa;
      const uy = dx * sa + dy * ca;
      if (!walkLine(this.game, this, this.x, this.y, this.x + ux * 16, this.y + uy * 16)) continue;
      this.moveIntent.x = ux * mul;
      this.moveIntent.y = uy * mul;
      return;
    }
    this.moveIntent.x = dx * mul;
    this.moveIntent.y = dy * mul;
  }

  endFlee() {
    this.mode = 'routine';
    this.fleeFrom = null;
    this.fleeHome = false;
    this.speedMul = 1;
    this.walker.stop();
    this.r.key = null; // replan from wherever we ran to
  }

  // ------------------------------------------------------------ guards

  startFight(target) {
    const g = this.game;
    this.mode = 'fight';
    this.fightTarget = target;
    if (!this.post) this.post = { x: this.x, y: this.y };
    this.wake();
    this.walker.stop();
    this.r.walking = false;
    this.windup = 0;
    if (now(g) - this.shoutAt > 6) {
      this.shoutAt = now(g);
      const isPlayer = target === g.player;
      this.say(pickLine(g, isPlayer ? this.profile.crime : this.profile.fight) || 'Halt!', { kind: 'shout', target });
    }
  }

  fightStep(dt, tick) {
    const g = this.game;
    const t = this.fightTarget;
    if (tick) {
      const valid = t && alive(t) && hostileTo(g, this, t);
      const tooFar = !t || this.distTo(t) > 260 || (this.post && Math.hypot(this.x - this.post.x, this.y - this.post.y) > GUARD_LEASH);
      if (!valid || tooFar) return this.endFight(t);
    }
    if (!t) return this.endFight(null);
    if (this.windup > 0) {
      this.windup -= dt;
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      this.faceToward(t.x, t.y);
      this.flash = Math.max(this.flash, 0.25 + 0.25 * Math.sin(this.age * 26));
      if (this.windup <= 0) {
        try {
          g.combat?.melee?.(this, { target: t, arc: 1.8, range: 26, damageMul: 1, knockback: 120, kind: 'melee', cooldown: 0.05, lock: 0.25 });
        } catch {
          /* a missed swing */
        }
        this.attackReadyAt = now(g) + 1.05;
      }
      return;
    }
    const d = this.distTo(t);
    this.speedMul = 1.35;
    if (d <= 20 + (t.radius ?? 4)) {
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      this.faceToward(t.x, t.y);
      if (now(g) >= this.attackReadyAt && this.lockTime <= 0) {
        this.windup = 0.32;
        this.setState('attack', 0.36);
        this.animTime = 0;
      }
      return;
    }
    if (tick) this._clear = walkLine(g, this, this.x, this.y, t.x, t.y);
    if (this._clear !== false) {
      this.walker.stop();
      const k = 1 / (d || 1);
      this.moveIntent.x = (t.x - this.x) * k;
      this.moveIntent.y = (t.y - this.y) * k;
    } else {
      if (tick || !this.walker.active) this.walker.goTo(t.x, t.y);
      this.walker.step(dt);
    }
  }

  endFight(target) {
    const g = this.game;
    const wasPlayer = target && target === g.player;
    this.mode = 'routine';
    this.fightTarget = null;
    this.post = null;
    this.windup = 0;
    this.speedMul = 1;
    this.walker.stop();
    this.r.key = null;
    if (this.isAlive() && now(g) - this.shoutAt > 3) {
      this.shoutAt = now(g);
      const list = wasPlayer ? this.profile.crimeOver : this.profile.fightReturn;
      if (list?.length) this.pendingSay = { at: now(g) + 0.6, text: pickLine(g, list), kind: 'say', target: wasPlayer ? target : null };
    }
  }

  // ------------------------------------------------------------ crimes

  onCrime(p) {
    const g = this.game;
    if (!p || !p.actor || p.actor === this) return;
    const actor = p.actor;
    const victim = p.victim;
    const kind = p.kind === 'knockout' ? 'knockout' : 'assault';
    const day = g.clock?.day ?? 1;
    const log = crimeLog(g);
    if (!log.seen.has(p)) {
      log.seen.add(p);
      if (kind === 'knockout') log.knockouts++;
      else log.assaults++;
      if (victim?.id) log.victims.add(victim.id);
    }
    const isPlayer = actor === g.player || actor.id === 'player';
    const isVictim = victim === this;
    const sees = isVictim || (this.isAlive() && this.distTo(actor) <= SIGHT && this.canSee(actor));
    if (isPlayer) {
      // Word travels: everyone is cool toward the player for the rest of the day.
      this.coldDay = day;
      if (isVictim) {
        this.wrongedDay = day;
        this.adjustOpinion(kind === 'knockout' ? -35 : -20, `${kind} by the player`);
      } else if (sees) this.adjustOpinion(kind === 'knockout' ? -14 : -7, `saw the player's ${kind}`);
      else this.adjustOpinion(kind === 'knockout' ? -3 : -1, 'heard about a crime');
    }
    if (!this.isAlive()) return;
    if (this.isGuard) {
      const hears = this.distTo(actor) <= GUARD_CRIME_HEAR || sees;
      if (hears && hostileTo(g, this, actor)) this.startFight(actor);
      return;
    }
    if (sees) this.startFlee(actor, isVictim ? 14 : 10, 'crime');
  }

  adjustOpinion(delta, reason = '') {
    const before = this.opinionOfPlayer;
    this.opinionOfPlayer = clamp(before + (Number(delta) || 0), 0, 100);
    this._lastOpinionReason = reason;
    return this.opinionOfPlayer - before;
  }

  opinionLabel() {
    const o = this.opinionOfPlayer;
    if (o < 15) return 'Hostile';
    if (o < 30) return 'Wary';
    if (o < 50) return 'Neutral';
    if (o < 75) return 'Friendly';
    return 'Fond';
  }

  // ------------------------------------------------------------ knocked out

  knockOut(by = null) {
    const g = this.game;
    if (this.downed || this.dead) return;
    let ok = false;
    try {
      ok = !!g.combat?.down?.(this, by);
    } catch {
      ok = false;
    }
    if (!ok && !this.downed) {
      this.hp = 0;
      this.downed = true;
      this.setState('downed');
      g.bus?.emit?.('downed', { entity: this, by });
      this.onDowned(by);
    }
  }

  // combat.down() calls this.
  onDowned(by) {
    this.mode = 'downed';
    this.downedFor = 0;
    this.walker.stop();
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    this.fleeFrom = null;
    this.fightTarget = null;
    this.windup = 0;
    this.pendingSay = null;
  }

  getUp() {
    const g = this.game;
    if (!this.downed) return;
    let ok = false;
    try {
      ok = !!g.combat?.revive?.(this, this, 0.5);
    } catch {
      ok = false;
    }
    if (!ok && this.downed) {
      this.downed = false;
      this.hp = Math.max(1, Math.round(this.maxHp * 0.5));
      this.setState('idle');
      g.bus?.emit?.('revived', { entity: this, by: this });
      this.onRevived(this);
    }
  }

  // combat.revive() calls this.
  onRevived(by) {
    const g = this.game;
    this.downedFor = 0;
    this.mode = 'routine';
    this.shakenDay = g.clock?.day ?? 1;
    this.r.key = null;
    this.speedMul = 1;
    const helper = by && by !== this ? by : null;
    if (helper && (helper === g.player || helper.id === 'player') && this.wrongedDay !== this.shakenDay) {
      this.adjustOpinion(4, 'helped up');
      this.pendingSay = { at: now(g) + 0.5, text: pickLine(g, this.profile.helped) || 'Thank you.', kind: 'say', target: helper };
    } else {
      this.pendingSay = { at: now(g) + 0.8, text: pickLine(g, this.profile.shaken) || '...', kind: 'say', target: null };
    }
  }

  // ------------------------------------------------------------ social life

  social() {
    const g = this.game;
    const t = now(g);
    if (this.mode !== 'routine' || !this.isAlive()) return;
    const asleep = this.state === 'sleep';
    const p = g.player;
    const lyra = g.companion;
    const day = g.clock?.day ?? 1;
    const village = g.village;
    if (this.profile.id === 'elda') this.maybeRentRoom();
    if (this.profile.id === 'tobias') this.shooBoars();
    if (asleep) return;
    // In a conversation the village is playing: stand still and face them.
    if (village?.isTalking?.(this)) {
      const other = village.partnerOf?.(this);
      if (this.r.phase !== 'travel') {
        if (this.r.walking) {
          this.walker.stop();
          this.r.walking = false;
        }
        this.r.subT = 0;
        if (other && this.state !== 'sit') this.faceToward(other.x, other.y);
      }
      return;
    }
    const quiet = t - (g._npcSayAt ?? -Infinity) < SAY_GAP;
    // Lyra nearby.
    if (lyra && alive(lyra) && this.distTo(lyra) < 56 && t - this.lyraAt > 75 && !quiet && this.canSee(lyra)) {
      const st = companionshipOf(g);
      const alone = st === 'apart' || st === 'left' || (p && Math.hypot(p.x - lyra.x, p.y - lyra.y) > 220);
      // On her own, she and the people she knows talk properly (the village plays it).
      if (alone && village?.requestChat && rand(g) < 0.5) {
        this.lyraAt = t;
        if (village.requestChat(this, lyra)) return;
      }
      let list = this.profile.lyra;
      let extra = null;
      if (alone && st !== 'together' && st !== 'wary' && this.profile.lyraAlone?.length) list = this.profile.lyraAlone;
      else if (this.profile.trick?.length && rand(g) < 0.7) {
        list = this.profile.trick;
        extra = this.profile.trickRequest || 'magic_trick';
      }
      if (list?.length) {
        this.lyraAt = t;
        g._npcSayAt = t;
        this.faceToward(lyra.x, lyra.y);
        this.say(pickLine(g, list), { target: lyra, request: extra });
        return;
      }
    }
    if (!p || !alive(p)) return;
    const dp = this.distTo(p);
    // Greeting the player as they walk up.
    if (dp < 44 && t - this.greetedAt > 140 && !quiet && this.canSee(p)) {
      this.greetedAt = t;
      g._npcSayAt = t;
      this.faceToward(p.x, p.y);
      this.say(D.greetingFor(this, p), { target: p });
      return;
    }
    // Word about Lyra when she is not with the player (once a day each).
    if (dp < 80 && this._aboutLyraDay !== day && !quiet && rand(g) < 0.3) {
      const l = D.aboutLyraLine(this);
      if (l) {
        this._aboutLyraDay = day;
        g._npcSayAt = t;
        this.say(l, { target: p });
        return;
      }
    }
    // Ambient chatter while the player is around to hear it. Talk between neighbours goes
    // through the village (both voices, their bond, their news); a lone line otherwise.
    if (dp < 130 && t - this.ambientAt > 40 + this.jitter * 30 && !quiet && this.visibleToPlayer(0)) {
      this.ambientAt = t;
      const other = this.activity === 'socialize' || this.activity === 'eat' || this.activity === 'work' ? this.nearestPerson(48, true) : null;
      if (other && rand(g) < 0.7 && this.chatWith(other)) return;
      g._npcSayAt = t;
      const k = g.clock?.weather?.type === 'rain' ? 'rain' : g.clock?.isNight ? 'night' : 'day';
      const tone = D.dialogueTone(this, p);
      const l = tone === 'cold' || tone === 'wronged' ? null : pickLine(g, this.profile.lines?.[k] || this.profile.lines?.day);
      if (l) this.say(l);
    }
  }

  // Talk with a neighbour. Returns true when a conversation started.
  chatWith(other) {
    const g = this.game;
    if (!other || other === this) return false;
    if (g.village?.requestChat) return !!g.village.requestChat(this, other);
    // Without a village (tests, or a world built without plugins): a line each way.
    const p = this.profile;
    this.faceToward(other.x, other.y);
    g._npcSayAt = now(g);
    const pair = p.pairs?.[other.id];
    const text = pair?.length && rand(g) < 0.6 ? pickLine(g, pair) : (pickLine(g, p.chatter) || 'Hello, {name}.').replace(/\{name\}/g, D.firstName(other));
    this.say(text, { target: other });
    if (other instanceof NPC && other.isAlive() && other.state !== 'sleep' && rand(g) < 0.55) {
      const op = other.profile;
      const back = op.pairs?.[p.id]?.length ? pickLine(g, op.pairs[p.id]) : (pickLine(g, op.chatter) || 'Mm.').replace(/\{name\}/g, D.firstName(this));
      other.faceToward(this.x, this.y);
      other.pendingSay = { at: now(g) + 1.8, text: back, kind: 'say', target: this };
    }
    return true;
  }

  nearestPerson(r, npcOnly = false) {
    const g = this.game;
    return g.entities?.nearest?.(this.x, this.y, r, (e) => e !== this && e.type === 'actor' && alive(e) && !e.species && (!npcOnly || e instanceof NPC)) || null;
  }

  // Elda keeps a room for Lyra when she is living apart from the player.
  maybeRentRoom() {
    const g = this.game;
    const lyra = g.companion;
    const day = g.clock?.day ?? 1;
    if (!lyra || !alive(lyra) || this.roomDay === day || this.state === 'sleep') return;
    const st = companionshipOf(g);
    if (st !== 'apart' && st !== 'left') return;
    const h = g.clock?.hour ?? 12;
    if (!(h >= 17 || h < 3)) return;
    let at = null;
    try {
      at = g.locations?.at?.(lyra.x, lyra.y);
    } catch {
      at = null;
    }
    if (at?.id !== 'ember_kettle' && at?.parent !== 'ember_kettle') return;
    if (this.distTo(lyra) > 200) return;
    this.rentRoom(lyra);
  }

  rentRoom(lyra) {
    const g = this.game;
    const room = this.profile.rooms?.lyra;
    if (!room || !lyra) return null;
    const day = g.clock?.day ?? 1;
    const agenda = lyra.mind?.agenda ?? lyra.mind?.autonomy?.agenda;
    let paid = false;
    if (agenda && Number.isFinite(agenda.purse) && agenda.purse >= room.price) {
      agenda.purse -= room.price;
      paid = true;
    } else if (lyra.inventory?.count?.('coin') >= room.price) {
      lyra.inventory.remove('coin', room.price);
      paid = true;
    }
    this.roomDay = day;
    const info = { day, paid, price: room.price, bed: room.bed, npc: this.id };
    if (g.flags) g.flags.lyra_inn_room = { day, paid, price: room.price, bed: room.bed };
    this.faceToward(lyra.x, lyra.y);
    this.say(pickLine(g, paid ? room.paid : room.credit) || 'Your room is ready.', { target: lyra });
    try {
      g.bus?.emit?.('room_rented', { npc: this, actor: lyra, price: room.price, paid, bedId: room.bed });
    } catch {
      /* listeners must not break the inn */
    }
    return info;
  }

  // Tobias chases boars off his field (they run; he is not a fighter).
  shooBoars() {
    const g = this.game;
    const t = now(g);
    if (t - (this._shooAt ?? -Infinity) < 6 || this.state === 'sleep') return;
    const boar = g.entities?.nearest?.(this.x, this.y, 72, (e) => e.species === 'boar' && alive(e) && !e.target);
    if (!boar) return;
    this._shooAt = t;
    this.faceToward(boar.x, boar.y);
    this.setState('attack', 0.3);
    this.animTime = 0;
    boar.scare?.(this, 5);
    this.say(pickLine(g, this.profile.shoo) || 'Shoo!', { kind: 'shout', target: boar });
  }

  // ------------------------------------------------------------ talking

  say(text, opts = {}) {
    if (!text) return;
    this._lastLine = text;
    const g = this.game;
    const kind = opts.kind || 'say';
    try {
      g.bubbles?.say?.(this, text, opts.duration ? { kind, duration: opts.duration } : { kind });
    } catch {
      /* bubbles are cosmetic */
    }
    try {
      const payload = { speaker: this, text, target: opts.target || null, kind };
      if (opts.request) payload.request = opts.request;
      g.bus?.emit?.('speech', payload);
    } catch {
      /* listeners must not break the speaker */
    }
  }

  icon(name) {
    try {
      this.game.bubbles?.icon?.(this, name);
    } catch {
      /* cosmetic */
    }
  }

  // Someone spoke to this villager. Returns the reply (also said aloud) or null.
  // Villagers talking among themselves (and with Lyra in a village conversation) answer
  // through the village, which writes both sides; this only answers the player and Lyra.
  hears(speaker, text) {
    const g = this.game;
    if (!speaker || speaker === this || !this.isAlive()) return null;
    const fromPlayer = speaker === g.player;
    const fromLyra = speaker === g.companion;
    if (!fromPlayer && !fromLyra) return null;
    if (g.village?.isTalking?.(this)) return null;
    const t = String(text || '').toLowerCase();
    if (this.state === 'sleep') {
      if (rand(g) < 0.3) this.pendingSay = { at: now(g) + 0.7, text: pickLine(g, this.profile.sleepy) || 'Mmh...', kind: 'say', target: speaker };
      return null;
    }
    if (this.mode !== 'routine') return null;
    if (now(g) - (this._heardAt ?? -Infinity) < 5) return null;
    this._heardAt = now(g);
    this.faceToward(speaker.x, speaker.y);
    const first = D.firstName(this).toLowerCase().split(' ').pop();
    let reply = null;
    if (/\bmaren\b/.test(t) && this.profile.knows?.maren) reply = this.profile.knows.maren;
    else if (new RegExp(`\\b(hello|hi|hey|good (morning|evening|day)|${escapeRe(first)})\\b`).test(t)) {
      reply = fromPlayer ? D.greetingFor(this, speaker) : pickLine(g, this.profile.lyra);
    }
    if (reply) this.pendingSay = { at: now(g) + 0.8, text: reply, kind: 'say', target: speaker };
    return reply;
  }

  getDialogue(player) {
    return D.getDialogue(this, player);
  }

  chooseOption(id, player) {
    return D.chooseOption(this, id, player);
  }

  receiveGift(itemId, giver) {
    return D.receiveGift(this, itemId, giver);
  }

  refusesTrade(player = this.game.player) {
    return D.refusesTrade(this, player);
  }

  // ------------------------------------------------------------ interaction

  canInteract(actor) {
    return !!actor && actor === this.game.player && !this.dead && !this.removed;
  }

  interactLabel() {
    const n = this.shortName;
    if (this.downed) return `Help ${n} up`;
    if (this.state === 'sleep') return `Wake ${n}`;
    return `Talk to ${n}`;
  }

  interact(actor) {
    const g = this.game;
    if (this.downed) return this.helpUp(actor);
    if (this.mode === 'flee' && this.fleeFrom === actor) {
      this.say(pickLine(g, this.profile.crime) || 'Stay back!', { kind: 'shout', target: actor });
      return;
    }
    this.talkingUntil = now(g) + 10;
    if (this.state !== 'sleep') this.faceToward(actor.x, actor.y);
    try {
      g.ui?.openDialog?.(this);
    } catch (err) {
      console.error('[npc] dialog failed', err);
    }
  }

  helpUp(actor) {
    const g = this.game;
    let ok = false;
    try {
      ok = !!g.combat?.revive?.(this, actor, 0.5);
    } catch {
      ok = false;
    }
    if (!ok && this.downed) {
      this.downed = false;
      this.hp = Math.max(1, Math.round(this.maxHp * 0.5));
      this.setState('idle');
      g.bus?.emit?.('revived', { entity: this, by: actor });
      this.onRevived(actor);
    }
  }

  // ------------------------------------------------------------ helpers

  visibleToPlayer(margin = 0) {
    const cam = this.game.camera;
    if (!cam || !Number.isFinite(cam.vw)) {
      const p = this.game.player;
      return !!p && Math.abs(p.x - this.x) < 220 + margin && Math.abs(p.y - this.y) < 140 + margin;
    }
    return this.x > cam.x - margin && this.x < cam.x + cam.vw + margin && this.y > cam.y - margin && this.y < cam.y + cam.vh + margin + 24;
  }

  farFromPlayer(d) {
    const p = this.game.player;
    return !p || Math.abs(p.x - this.x) > d || Math.abs(p.y - this.y) > d;
  }

  // A guard's lantern on night patrol: one warm moving light in the dark.
  getLight(time) {
    if (!this.isGuard || !this.isAlive() || !this.game.clock?.isNight) return null;
    if (this.activity !== 'patrol' && this.mode !== 'fight') return null;
    if (this.game.map?.isIndoors?.(this.x, this.y)) return null;
    const flick = 0.92 + 0.08 * Math.sin((time || 0) * 9 + this.jitter * 5);
    return { x: this.x + this.facing.x * 5, y: this.y - 8, r: 46, color: '#ffb35c', intensity: 0.7 * flick };
  }

  serialize() {
    return {
      ...super.serialize(),
      opinion: this.opinionOfPlayer,
      familiarity: this.familiarity,
      told: [...this.told],
      coldDay: this.coldDay,
      shakenDay: this.shakenDay,
      wrongedDay: this.wrongedDay,
      giftDay: this.giftDay,
      giftsToday: this.giftsToday,
      talkDay: this.talkDay,
      talkFamToday: this.talkFamToday,
      roomDay: this.roomDay,
      downedFor: this.downedFor,
    };
  }

  deserialize(d) {
    if (!d) return;
    super.deserialize(d);
    if (Number.isFinite(d.opinion)) this.opinionOfPlayer = clamp(d.opinion, 0, 100);
    if (Number.isFinite(d.familiarity)) this.familiarity = clamp(d.familiarity, 0, 100);
    if (Array.isArray(d.told)) this.told = new Set(d.told.filter((x) => typeof x === 'string'));
    for (const k of ['coldDay', 'shakenDay', 'wrongedDay', 'giftDay', 'giftsToday', 'talkDay', 'talkFamToday', 'roomDay', 'downedFor']) {
      if (Number.isFinite(d[k])) this[k] = d[k];
    }
    if (this.downed) {
      this.mode = 'downed';
      this.setState('downed');
    }
    this.anchor = { x: this.x, y: this.y };
    this.r.key = null;
  }
}

const DIR_CYCLE = ['down', 'left', 'right', 'up'];

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function hashId(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function hash01(x) {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
