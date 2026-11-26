import { Actor, factionRelation } from './entity.js';
import { FACTION, TILE } from '../core/constants.js';
import { entryAt, adjustForWeather } from './npc_schedule.js';
import { Walker } from './npc_walker.js';
import { now, rand, hostileTo, alive, walkLine, speak, pickLine } from './creature_util.js';
import * as D from './npc_dialogue.js';
import { NPC_PROFILES } from './npc_data.js';
import { RESPONSE_LINES, HEAR_LINES } from './npc_lines.js';
import { look } from '../murder/witness.js';
import { hears, cryLoudness, hearsWords, placeOfSound, LOUD, isSilenced, voiceOf } from '../ai/hearing.js';
import { placePhrase } from '../ai/village_life/errands_data.js';
import { isMinor, lyraOf } from '../core/people.js';
import { DEFENDER_COMBAT, isDefender, defenderLine, defendsAgainst } from './defenders.js';

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
const GUARD_LEASH = 300; // and give up the chase this far from their post
const SAY_GAP = 6; // seconds between ambient lines from any two villagers
const HUNT_RADIUS = 150; // Hess takes on hostile creatures this close (DESIGN §19.1)
const BOW_RANGE = 140; // and looses arrows from this far
const SHOT_GAP = 1.35;

// Places another branch builds (DESIGN §19.2): where to go while one is missing, so a
// schedule never points at nothing and the villagers still work on their own.
export const PLACE_FALLBACK = {
  chandlery: 'ember_kettle',
  lamplight_lane: 'town_square',
  ashby_house: 'ember_kettle',
  dye_cottage: 'ember_kettle',
  weavers_row: 'town_square',
  net_shed: 'mirror_lake',
  wenna_hives: 'whisperwood',
};

// Things a villager sits on rather than beside.
const SEATS = new Set(['bench', 'chair', 'stool', 'pew']);
// The lamplighter's round covers the square and the lanes (LORE §5).
const LAMP_AREAS = ['town_square', 'lamplight_lane', 'weavers_row'];

// The village answering a call for help (DESIGN §19.7).
const TENDERS = new Set(['mira', 'hobb', 'wenna', 'elda', 'aveline']); // heal, help up, walk home
// How far a cry carries, and what it tells, is the one rule for ears (src/ai/hearing.js,
// DESIGN §29.4): open air by severity (300 / 440 / 600 px), muffled hard by a wall, a little
// further through an open door, less to a sleeper; it tells what and where, never who.
const SEEN_NEAR = 96; // px: the one seen this close to the hurt is the one who did it
// The village's news of the stranger's crimes (src/ai/social/rumors.js kinds).
const CRIME_NEWS = new Set(['attacked_villager', 'downed_villager', 'hit_lyra', 'downed_lyra', 'murder', 'lethal_attack']);
const TELL_REACH = 44; // px: the hurt tell who did it to whoever reaches them (murder.js)
const HELP_SECONDS = 45; // the longest anyone stays on one call
// What a villager yelps when the stranger's weave catches them by accident.
const ACCIDENT_YELPS = ['Oi! Mind where that goes!', 'Ow! Watch it!', 'Careful with that!', 'Hey! Not at me!'];
const DANGER_NEAR = 84; // an attacker this close to the victim keeps carers back

const WORK_OBJECTS = {
  bram: ['anvil', 'forge'],
  elda: ['hearth', 'campfire', 'barrel', 'table'],
  mira: ['shelf', 'table', 'barrel'],
  aveline: ['altar'],
  garrick: ['shelf', 'crate', 'barrel', 'table'],
  tobias: ['crop'],
  rowan: ['table', 'crate'],
  tilly: ['anvil', 'forge', 'table'], // Tilly works the smithy alongside Bram
};

// Has this villager watched the stranger kill (terror now, or dread of them for good)?
function fearsStranger(game, npc) {
  try {
    return !!game?.murder?.fearOf?.(npc);
  } catch {
    return false;
  }
}

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
// The props of a place still standing: a fence or barrel the player smashed is rubble until
// it is mended (world/breakables.js), so nobody leans on it or works at it meanwhile.
function whole(list) {
  return list.some((o) => o.state?.broken) ? list.filter((o) => !o.state?.broken) : list;
}

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
    // Frozen or stunned by a weave (DESIGN §22.1): the day waits until it wears off.
    if (npc.statusFlags?.disabled) {
      npc.moveIntent.x = 0;
      npc.moveIntent.y = 0;
      return;
    }
    npc.think(dt);
  },
};

export class NPC extends Actor {
  constructor(game, profile, o = {}) {
    // A defender's stats (round 14b, src/entities/defenders.js) when the profile has none.
    const c = profile.combat || DEFENDER_COMBAT[profile.id] || {};
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
    this.fightAnchor = null; // what a fight's leash is measured from, when not the post (startFight)
    this.fightLeash = null;
    this.duty = null; // a companion's duty: { step(npc, dt, tick) } (round 14b, party)
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
    this.help = null; // answering a call for help: { victim, attacker, role, phase, ... }
    this.inBed = null; // the bed they are lying in
    this.seat = null; // { obj, i, x, y, from } the bench or chair they sit on
    this.shootReadyAt = 0;
    this._objCache = new Map();
    this._offs = [];
    const bus = game.bus;
    if (bus?.on) {
      installVillageHooks(game);
      this._offs.push(bus.on('call_for_help', (p) => this.onCallForHelp(p)));
      this._offs.push(bus.on('damage', (p) => {
        if (p && p.target === this) this.onHurt(p);
      }));
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

  // Gone from the village's life (DESIGN §28/§29, village_life.markGone): out of every
  // routine, conversation and sighting until they come back.
  isAlive() {
    return !this.absent && super.isAlive();
  }

  // ------------------------------------------------------------ main loop

  update(dt) {
    if (this.absent) return;
    super.update(dt);
    if (this.slipT > 0) {
      this.slipT -= dt;
      if (this.slipT <= 0) this.solid = true;
    }
    if (this.downed) {
      this.downedFor += dt;
      // With game.survival (§27) a villager lies with a window of their own until someone
      // helps them up or carries them in; otherwise they get up alone after 30 s.
      if (this.downedFor >= KNOCKOUT_SECONDS && !this.game.survival?.owns?.(this)) this.getUp();
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
    // Answering someone who fell, or resting in a sickroom cot (§27, src/survival).
    if (this.mode === 'rescue' || this.mode === 'patient') {
      if (this.game.survival?.stepActor?.(this, dt)) return;
      if (this.mode === 'rescue' || this.mode === 'patient') this.mode = 'routine';
    }
    if (this.mode === 'flee') return this.fleeStep(dt, tick);
    if (this.mode === 'fight') return this.fightStep(dt, tick);
    if (this.mode === 'help') return this.helpStep(dt, tick);
    // Someone is talking to us: stand still and look at them.
    const p = this.game.player;
    if (now(this.game) < this.talkingUntil && p && this.distTo(p) < 56) {
      this.walker.stop();
      if (this.state !== 'sleep' && this.state !== 'sit') this.faceToward(p.x, p.y);
      return;
    }
    // A duty (round 14b, DESIGN §34.1: walking with the stranger as their companion) runs
    // before the day's routine: a step that returns anything but undefined took this beat.
    if (this.duty?.step?.(this, dt, tick) !== undefined) return;
    this.routine(dt, tick);
    this.socialT -= dt;
    if (tick && this.socialT <= 0) {
      this.socialT = 0.9 + this.jitter * 0.4;
      this.social();
    }
  }

  // Let others pass through for a moment (the walker calls this when a crowd jams).
  slipThrough(seconds = 1.5) {
    this.solid = false;
    this.slipT = Math.max(this.slipT || 0, seconds);
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
    // An errand, a search, minding someone's shop (DESIGN §28): the village's day bends theirs.
    if (this.shakenDay !== (clock?.day ?? 1) && g.villageLife?.entryFor) {
      try {
        const o = g.villageLife.entryFor(this, e, hour);
        if (o) e = o;
      } catch (err) {
        console.warn('[npc] village life entry failed', err);
      }
    }
    // A funeral, the Moot, mourning, the watch looking for someone (DESIGN §29).
    if (g.murder?.entryFor) {
      try {
        const o = g.murder.entryFor(this, e, hour);
        if (o) e = o;
      } catch (err) {
        console.warn('[npc] murder entry failed', err);
      }
    }
    return e;
  }

  // A place by id, else what stands in for it, else home, else the square.
  locFor(id) {
    const L = this.game.locations;
    if (!L?.get) return null;
    const home = this.profile.home;
    return L.get(id) || L.get(PLACE_FALLBACK[id]) || L.get(home) || L.get(PLACE_FALLBACK[home]) || L.get('town_square') || null;
  }

  routine(dt, tick) {
    const r = this.r;
    if (tick || !r.key) {
      const e = this.currentEntry();
      const key = e.vl ? `vl:${e.vl}` : `${e.activity}@${e.at}`;
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
    r.lamp = null;
    r.lampIdx = 0;
    r.lampPhase = null;
    r.roundDone = false;
    this.speedMul = 1;
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
    if (a === 'sleep') {
      // Into their own bed, the way it lies (DESIGN §19.8); with no bed, they doze in a
      // chair by the hearth. Nobody lies down on a floor.
      if (s?.bed && !s.bed.removed) this.getIntoBed(s.bed, s);
      else if (s?.seat) this.sitOn(s.seat, s);
      this.setState(this.inBed ? 'sleep' : 'sit', 0.8);
      return;
    }
    if (s?.seat) this.sitOn(s.seat, s);
    if (a === 'eat' || a === 'rest' || this.seat || (s?.sit && r.entry?.pose === 'sit')) this.setState('sit', 0.8);
  }

  wake() {
    this.leaveBed();
    this.leaveSeat();
    if (this.state === 'sleep' || this.state === 'sit' || this.state === 'work') {
      this.lockTime = 0;
      this.setState('idle');
    }
  }

  // ------------------------------------------------------------ beds and seats

  // Their own bed, wherever the world put it (a back room, a loft, the second cot).
  ownBed() {
    const g = this.game;
    const b = this._bed;
    if (b && !b.removed) return b;
    const t = now(g);
    if (b === null && t - (this._bedAt ?? -Infinity) < 20) return null;
    this._bedAt = t;
    const id = this.profile.id;
    const all = g.objects?.all?.() || [];
    this._bed = all.find((o) => o.objType === 'bed' && !o.removed && (o.owner ?? o.state?.owner) === id) || null;
    return this._bed;
  }

  // The free floor beside a bed where its sleeper steps in and out.
  bedSide(bed) {
    const ss = bed.sleepSpot;
    if (ss && this.tileFree(Math.floor(ss.x / TILE), Math.floor(ss.y / TILE))) return { x: ss.x, y: ss.y };
    const f = bed.footprint || { x: bed.tx, y: bed.ty - 1, w: 1, h: 2 };
    for (const [tx, ty] of [
      [f.x + f.w, f.y + f.h - 1],
      [f.x - 1, f.y + f.h - 1],
      [f.x + f.w, f.y],
      [f.x - 1, f.y],
      [f.x, f.y + f.h],
    ]) {
      if (this.tileFree(tx, ty)) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 + 2 };
    }
    return this.freeNear(bed.x, bed.y + TILE) || { x: bed.x, y: bed.y + TILE };
  }

  getIntoBed(bed, from) {
    this.leaveSeat();
    this.inBed = bed;
    this._bedOut = from ? { x: from.x, y: from.y } : this.bedSide(bed);
    // Lying along the bed, head on the pillow: the renderer draws sleepers with their bed.
    this.x = bed.x;
    this.y = bed.y - 4;
    this.faceDir('down');
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
  }

  leaveBed() {
    const bed = this.inBed;
    if (!bed) return;
    this.inBed = null;
    const out = this._bedOut || this.bedSide(bed);
    this.x = out.x;
    this.y = out.y;
  }

  // A place to sit on a bench, chair, stool or pew: one seat per tile of its footprint.
  seatOn(o) {
    const f = o.footprint || { x: o.tx ?? Math.floor(o.x / TILE), y: o.ty ?? Math.floor(o.y / TILE), w: 1, h: 1 };
    const sitters = (o._sitters ||= []);
    const n = Math.max(1, f.w);
    const start = Math.floor(this.jitter * n);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const who = sitters[i];
      if (who && who !== this && !who.removed && who.seat?.obj === o) continue;
      const approach = this.besideObject({ tx: f.x + i, ty: f.y + f.h - 1 }) || this.freeNear(o.x, o.y + TILE);
      if (!approach) return null;
      return { ...approach, face: 'down', sit: true, seat: { obj: o, i, x: (f.x + i) * TILE + TILE / 2, y: o.y + 1 } };
    }
    return null;
  }

  sitOn(seat, from) {
    const o = seat.obj;
    const sitters = (o._sitters ||= []);
    const who = sitters[seat.i];
    if (who && who !== this && who.seat?.obj === o) return false; // taken while we walked
    sitters[seat.i] = this;
    this.seat = { ...seat, from: from ? { x: from.x, y: from.y } : { x: this.x, y: this.y } };
    this.x = seat.x;
    this.y = seat.y;
    this.faceDir('down');
    return true;
  }

  leaveSeat() {
    const s = this.seat;
    if (!s) return;
    this.seat = null;
    if (s.obj?._sitters?.[s.i] === this) s.obj._sitters[s.i] = null;
    if (s.from) {
      this.x = s.from.x;
      this.y = s.from.y;
    }
  }

  // Where to stand for an activity: a bed, a workbench, a seat, the altar, a crop,
  // or a free floor tile inside the place.
  spotFor(e, reroll = false) {
    if (e.spot && !reroll) return e.spot;
    const loc = this.locFor(e.at);
    if (!loc) return { x: this.anchor.x + (reroll ? (rand(this.game) - 0.5) * 32 : 0), y: this.anchor.y };
    const id = this.profile.id;
    const salt = reroll ? Math.floor(rand(this.game) * 97) : 0;
    // A schedule entry may name what to stand at or sit on (npc_data_more.js `near`).
    if (e.near?.length && e.activity !== 'sleep') {
      const objs = whole(this.objectsIn(loc, e.near));
      if (objs.length) {
        const o = objs[(Math.floor(this.jitter * 11) + salt) % objs.length];
        const sp = e.pose === 'sit' && SEATS.has(o.objType) ? this.seatOn(o) : this.besideObject(o, e.pose === 'sit');
        if (sp) return sp;
      }
    }
    switch (e.activity) {
      case 'sleep': {
        const bed = this.ownBed();
        if (bed) return { ...this.bedSide(bed), bed, face: 'down' };
        // No bed of their own (DESIGN §19.8): home, and doze in a chair by the hearth.
        const home = this.locFor(this.profile.home) || loc;
        const fire = this.objectsIn(home, ['hearth', 'campfire'])[0];
        const chairs = this.objectsIn(home, ['chair', 'bench', 'stool']);
        if (chairs.length) {
          const near = fire ? chairs.slice().sort((a, b) => Math.hypot(a.x - fire.x, a.y - fire.y) - Math.hypot(b.x - fire.x, b.y - fire.y)) : chairs;
          for (const c of near) {
            const sp = this.seatOn(c);
            if (sp) return sp;
          }
        }
        if (fire) {
          const sp = this.besideObject(fire, true);
          if (sp) return { ...sp, sit: true };
        }
        return { ...this.floorSpot(home, 11 + salt), sit: true };
      }
      case 'lamps':
        return null; // the round walks itself (performLamps)
      case 'work':
      case 'farm': {
        const types = WORK_OBJECTS[id] || (e.activity === 'farm' ? ['crop'] : null);
        if (types) {
          const objs = whole(this.objectsIn(loc, types));
          if (objs.length) {
            const o = objs[(Math.floor(this.jitter * 7) + salt + (e.activity === 'farm' ? Math.floor(rand(this.game) * objs.length) : 0)) % objs.length];
            // An object hemmed in on every side: work on the floor nearby, never "work"
            // from wherever they happened to be standing (Aveline stayed at the Kettle).
            const sp = this.besideObject(o);
            if (sp) return sp;
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
        this.setState(this.inBed ? 'sleep' : 'sit', 0.8);
        if (tick && rand(g) < 0.02 && this.visibleToPlayer(0)) this.icon('zzz');
        return;
      case 'eat':
      case 'rest':
        this.setState('sit', 0.8);
        return;
      case 'lamps':
        return this.performLamps(dt, tick);
      case 'errand':
        return this.performErrand(dt, tick);
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
    // Work done sitting (the ledger, sewing, mending nets): stay in the seat.
    if (r.entry?.pose === 'sit') {
      this.setState('sit', 0.8);
      if (tick && !this.seat && rand(g) < 0.04 && r.spot?.object) this.faceToward(r.spot.object.x, r.spot.object.y);
      return;
    }
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

  // On an errand (DESIGN §28): at the counter, at someone's elbow, or waiting for someone.
  performErrand(dt, tick) {
    const look = this.r.entry?.lookAt;
    if (tick && look && Number.isFinite(look.x) && !look.removed) this.faceToward(look.x, look.y);
    else if (tick && !look && this.r.subT > this.r.subDur) {
      this.faceDir(DIR_CYCLE[Math.floor(rand(this.game) * 4)]);
      this.nextSub('idle', 1.5 + rand(this.game) * 2.5);
    }
  }

  performWander(dt, tick) {
    const r = this.r;
    const g = this.game;
    // Socializing on a bench (Hobb and Wenna at dusk, Petra passing judgment): stay put.
    if (r.entry?.pose === 'sit' && (this.seat || r.spot?.sit)) {
      this.setState('sit', 0.8);
      if (tick && rand(g) < 0.12) {
        const other = this.nearestPerson(40);
        if (other && !this.seat) this.faceToward(other.x, other.y);
      }
      return;
    }
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

  // ------------------------------------------------------------ the lamp-round

  // The street lamps in the order the lamplighter walks them: the world's own `round`
  // numbers when it has them (DESIGN §19.2), otherwise the lamps of the square and the
  // lanes, nearest first from the chapel.
  lampRoute() {
    const g = this.game;
    const day = g.clock?.day ?? 1;
    if (this._lampRoute && this._lampRouteDay === day) return this._lampRoute;
    const all = (g.objects?.all?.() || []).filter((o) => o.objType === 'lamp' && !o.removed && !o.alwaysLit && o.kind !== 'candles');
    let list = all.filter((o) => Number.isFinite(o.round)).sort((a, b) => a.round - b.round);
    if (!list.length) {
      const areas = LAMP_AREAS.map((id) => g.locations?.get?.(id)).filter(Boolean);
      const inArea = (o) => (o.area && LAMP_AREAS.includes(o.area)) || areas.some((L) => inBounds(L, o));
      const left = all.filter(inArea);
      const start = g.locations?.get?.('chapel')?.center || areas[0]?.center || { x: this.x, y: this.y };
      let cx = start.x;
      let cy = start.y;
      while (left.length) {
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < left.length; i++) {
          const d = Math.hypot(left[i].x - cx, left[i].y - cy);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        const o = left.splice(bi, 1)[0];
        list.push(o);
        cx = o.x;
        cy = o.y;
      }
    }
    this._lampRoute = list;
    this._lampRouteDay = day;
    return list;
  }

  lampSpot(lamp) {
    const tx = lamp.tx ?? Math.floor(lamp.x / TILE);
    const ty = lamp.ty ?? Math.floor(lamp.y / TILE);
    for (const [dx, dy] of [
      [0, 1],
      [-1, 1],
      [1, 1],
      [-1, 0],
      [1, 0],
    ]) {
      if (this.tileFree(tx + dx, ty + dy)) return { x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 + 2 };
    }
    return this.freeNear(lamp.x, lamp.y + TILE) || { x: lamp.x, y: lamp.y + TILE };
  }

  // Light one lamp: the world's own lamp.light() when it has one, else the contract
  // fields (state.lit and a 'lamp_lit' event). Returns true when it was dark.
  lightLamp(lamp) {
    if (!lamp || lamp.removed) return false;
    if (typeof lamp.light === 'function') return !!lamp.light(this);
    if (lamp.state?.lit) return false;
    lamp.state = { ...(lamp.state || {}), lit: true };
    lamp.markDirty?.();
    try {
      this.game.bus?.emit?.('lamp_lit', { id: lamp.id, lamp, by: this });
    } catch {
      /* listeners must not stop the round */
    }
    return true;
  }

  performLamps(dt, tick) {
    const r = this.r;
    const g = this.game;
    // Slow everywhere else, brisk on his round: forty-one years and never late.
    this.speedMul = r.roundDone ? 1 : 1.3;
    const route = this.lampRoute();
    const seen = this.visibleToPlayer(48);
    if (!r.lamp) {
      while (r.lampIdx < route.length && (route[r.lampIdx].removed || route[r.lampIdx].state?.lit)) {
        // Someone young and quick got there first. He notices, and says it was the wind.
        if (seen && route[r.lampIdx].far && !r.windSaid) {
          r.windSaid = true;
          this.say(pickLine(g, this.profile.lampAlreadyLit) || 'Lit already.');
        }
        r.lampIdx++;
      }
      if (r.lampIdx >= route.length) {
        // The round is done: back to the bench by the chandlery until the schedule moves on.
        if (!r.roundDone) {
          r.roundDone = true;
          const spot = this.spotFor({ activity: 'socialize', at: 'lamplight_lane', near: ['bench'], pose: 'sit' });
          r.entry = { ...r.entry, activity: 'socialize', at: 'lamplight_lane', near: ['bench'], pose: 'sit', doing: 'on the bench with Wenna, the lamps all lit' };
          this.activity = 'socialize';
          r.spot = spot;
          if (spot) {
            r.phase = 'travel';
            this.walker.goTo(spot.x, spot.y);
          }
        }
        return;
      }
      r.lamp = route[r.lampIdx];
      r.lampPhase = 'go';
      const spot = this.lampSpot(r.lamp);
      if (!seen && this.farFromPlayer(420)) {
        // Off-screen the round keeps a lamplighter's pace without the walking.
        if (r.subT < 2.2) {
          r.lamp = null;
          return;
        }
        this.x = spot.x;
        this.y = spot.y;
      } else if (this.distToPoint(spot.x, spot.y) > 4) {
        this.walkTo(spot, 1);
        return;
      }
    }
    const lamp = r.lamp;
    if (r.lampPhase === 'go') {
      if (lamp.state?.lit) {
        if (seen && lamp.far && rand(g) < 0.6) this.say(pickLine(g, this.profile.lampAlreadyLit) || 'Lit already.');
        r.lamp = null;
        r.lampIdx++;
        r.subT = 0;
        return;
      }
      this.faceToward(lamp.x, lamp.y - 24);
      this.setState('work', 1.0);
      this.animTime = 0;
      r.lampPhase = 'raise';
      r.subT = 0;
      return;
    }
    if (r.lampPhase === 'raise' && r.subT > 0.85) {
      this.lightLamp(lamp);
      if (seen && rand(g) < 0.22 && now(g) - (g._npcSayAt ?? -Infinity) > SAY_GAP) {
        g._npcSayAt = now(g);
        this.say(pickLine(g, this.profile.lampLines) || 'There. Lit.');
      }
      r.lamp = null;
      r.lampPhase = null;
      r.lampIdx++;
      r.subT = 0;
    }
  }

  // ------------------------------------------------------------ perception

  perceive() {
    const g = this.game;
    const p = g.player;
    // Someone on their shoulders, or abed in the sickroom: they do not stop for a fight.
    if (this.carrying || this.mode === 'patient') return;
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
        // The stranger is struck only by a watchman who knows they are wanted (§29.4).
        if (d2 < fd && hostileTo(g, this, e) && (e !== p || this.knowsWanted(p) || !crimeActive(g, p)) && this.canSee(e)) {
          foe = e;
          fd = d2;
        }
      } else if (this.profile.hunter && e !== p && e.species && d2 < HUNT_RADIUS * HUNT_RADIUS && d2 < fd && huntable(e) && this.canSee(e)) {
        foe = e;
        fd = d2;
      } else if (e !== p && d2 < THREAT_RADIUS * THREAT_RADIUS && d2 < td && hostileTo(g, e, this) && this.canSee(e)) {
        threat = e;
        td = d2;
      }
    }
    if (this.isGuard || (this.profile.hunter && foe)) {
      if (foe && this.mode !== 'fight' && this.state !== 'sleep') this.startFight(foe);
      else if (foe && this.mode === 'fight' && this.fightTarget !== foe && !alive(this.fightTarget)) this.fightTarget = foe;
      return;
    }
    if (this.profile.hunter && this.mode === 'fight') return;
    // A defender in a fight stays in it (round 14b): it ends by its own leash and nerve.
    const civil = this.isCivilDefender();
    if (civil && this.mode === 'fight') return;
    // A defender takes on a beast that comes into the village (not out in the wilds, not
    // asleep): Bram's hammer at the wolf in the square, the rest run.
    if (civil && threat && threat.species && this.state !== 'sleep' && td < 70 * 70 && this.inVillage(threat)) {
      this.post = { x: this.x, y: this.y };
      this.startFight(threat, { leash: 160 });
      return;
    }
    // Carers stay with the hurt even with the culprit about, unless they come close.
    const steadfast = this.mode === 'help' && this.help && this.help.role !== 'shout';
    // The player is wanted: keep clear of them.
    if (p && alive(p) && this.distTo(p) < (steadfast ? 44 : SIGHT) && this.knowsWanted(p) && this.canSee(p)) {
      if (this.mode !== 'flee' || this.fleeFrom !== p) this.startFlee(p, 8, 'crime');
      else this.fleeUntil = Math.max(this.fleeUntil, now(g) + 4);
      return;
    }
    if (threat) {
      if (this.mode !== 'flee' || this.fleeFrom !== threat) this.startFlee(threat, 6, 'flee');
      else this.fleeUntil = Math.max(this.fleeUntil, now(g) + 3);
    }
  }

  // Inside the village's own bounds (a place of danger 1 or less): where its people stand up
  // to a beast rather than run.
  inVillage(e) {
    try {
      const loc = this.game.locations?.at?.(e.x, e.y);
      return !!loc && (loc.danger ?? 2) <= 1;
    } catch {
      return false;
    }
  }

  // The one rule for eyes (DESIGN §29.2, murder/witness.js): the same space, range for
  // the light, and no wall or house in the way.
  canSee(e) {
    if (!e) return false;
    if (!this.game.map?.buildingAt) return true;
    try {
      return !!look(this.game, this, e.x, e.y);
    } catch {
      return true;
    }
  }

  isWantedNear(player = this.game.player) {
    return !!player && this.knowsWanted(player) && this.distTo(player) < SIGHT;
  }

  // Does this villager know the stranger is wanted (DESIGN §29.4)? The record (player.crime)
  // is the watch's; what a villager knows is their own: the bell (a killing told to the
  // watch, the Moot's sentence) reaches everyone; a blow is known to those who saw it, came
  // and saw who, were told by the hurt one, or had it from someone face to face (the village's
  // news, rumors.js). Without the village's news (a bare world): the record is all there is.
  knowsWanted(actor = this.game.player) {
    const g = this.game;
    if (!actor || !crimeActive(g, actor)) return false;
    const c = actor.crime;
    if (c && (c.kind === 'murder' || c.kind === 'outside')) return true;
    if (!g.village?.rumors?.list) return true;
    if (this.help?.attacker === actor || this.fightTarget === actor || this.fleeFrom === actor) return true;
    return this.knowsCrimeToday();
  }

  // Has news of a crime of the stranger's today reached this villager (seen or told)?
  knowsCrimeToday() {
    const g = this.game;
    const list = g.village?.rumors?.list;
    if (!list) return !!this.crimeToday();
    const day = g.clock?.day ?? 1;
    return list.some((r) => r.day === day && r.about === 'player' && CRIME_NEWS.has(r.kind) && r.heardBy.includes(this.id));
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

  // opts.to: run to someone (a witness to a killing runs for the watch, DESIGN §29.3),
  // not simply away; opts.quiet: no fresh cry (they are already screaming).
  startFlee(from, seconds, shout = 'flee', opts = {}) {
    const g = this.game;
    if (this.help && this.help.role === 'shout') this.help = null;
    this.mode = 'flee';
    this.fleeFrom = from;
    this.fleeUntil = now(g) + seconds;
    this.wake();
    this.walker.stop();
    this.r.walking = false;
    // Run home if home is not past the danger; otherwise just away.
    const home = this.locFor(this.profile.home);
    this.fleeHome = false;
    this.fleeTo = null;
    if (opts?.to && Number.isFinite(opts.to.x)) {
      this.fleeTo = opts.to;
      this.fleeHome = 'to';
      this.walker.goTo(opts.to.x, opts.to.y);
    } else if (home) {
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
    if (!opts?.quiet && now(g) - this.shoutAt > 5) {
      this.shoutAt = now(g);
      const list = shout === 'crime' ? this.profile.crime : this.profile.flee;
      this.say(pickLine(g, list) || 'Help!', { kind: 'shout', target: from });
      this.icon('!');
    }
  }

  fleeStep(dt, tick) {
    const g = this.game;
    const from = this.fleeFrom;
    // Running to someone (the watch): on until there, whoever is behind.
    if (this.fleeHome === 'to' && this.fleeTo) {
      this.speedMul = 1.75;
      const to = this.fleeTo.entity && !this.fleeTo.entity.removed ? this.fleeTo.entity : this.fleeTo;
      if (Math.hypot(to.x - this.x, to.y - this.y) < 40 || now(g) > this.fleeUntil) return this.endFlee();
      if (tick && this.fleeTo.entity && Math.hypot(this.fleeTo.x - to.x, this.fleeTo.y - to.y) > 48) {
        this.fleeTo = { x: to.x, y: to.y, entity: this.fleeTo.entity };
        this.walker.goTo(to.x, to.y);
      }
      const res = this.walker.step(dt);
      if (res === 'arrived' || res === 'idle') return this.endFlee();
      if (res === 'stuck') this.fleeHome = false;
      return;
    }
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
    this.fleeTo = null;
    this.speedMul = 1;
    this.walker.stop();
    this.r.key = null; // replan from wherever we ran to
    // Back to the person they were going to help, if that still needs doing; never back to
    // the feet of a stranger they watched kill (DESIGN §29.3).
    const h = this.help;
    const g = this.game;
    const afraid = !!h?.attacker && (h.attacker === g?.player || h.attacker.id === 'player') && fearsStranger(g, this);
    if (h && !afraid && h.role !== 'shout' && now(g) < h.until && h.victim && !h.victim.removed) {
      this.mode = 'help';
      h.phase = h.phase === 'care' ? 'go' : h.phase;
    } else this.help = null;
  }

  // ------------------------------------------------------------ guards

  // opts.anchor: what the leash is measured from instead of the post (a point or an entity
  // that moves, like the player a companion guards); opts.leash: px instead of GUARD_LEASH
  // (round 14b, DESIGN §34.1). Both last until the fight ends.
  startFight(target, { anchor = null, leash = null } = {}) {
    const g = this.game;
    if (this.mode === 'help') this.endHelp(true);
    this.mode = 'fight';
    this.fightTarget = target;
    this.fightAnchor = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : null;
    this.fightLeash = Number.isFinite(leash) && leash > 0 ? leash : null;
    if (!this.post) this.post = { x: this.x, y: this.y };
    this.wake();
    this.walker.stop();
    this.r.walking = false;
    this.windup = 0;
    this.freezeT = 0;
    const c = this.profile.combat;
    // Wys froze at the wolf last month (LORE §6). Sometimes, at dusk, he still does.
    if (c?.freezeVs?.includes(target?.species) && (g.clock?.isNight || (g.clock?.hour ?? 12) > 17.5) && rand(g) < 0.5) {
      this.freezeT = (c.freeze || 0.9) * 2;
      this.icon('sweat');
    }
    if (target === g.player && (this.profile.hunter || this.isCivilDefender())) this.provoke(target, { known: true });
    if (now(g) - this.shoutAt > 6) {
      this.shoutAt = now(g);
      const isPlayer = target === g.player;
      const own = isPlayer && this.isCivilDefender() ? defenderLine(this.profile.id, 'answer', () => rand(g)) : null;
      this.say(own || pickLine(g, isPlayer ? this.profile.crime : this.profile.fight) || 'Halt!', { kind: 'shout', target });
    }
  }

  // A villager who fights back without being of the watch or a huntress (round 14b,
  // src/entities/defenders.js): Bram, Tobias, Garrick, Sabeth, Tilly, of an age to.
  isCivilDefender() {
    return !this.isGuard && !this.profile.hunter && isDefender(this.game, this);
  }

  // Hess is not of the watch: combat lets her strike the player only while the player is
  // wanted for hurting someone, through the same 'provoked' rule creatures use. A defender
  // (round 14b) the same, for as long as they defend someone from a stranger they KNOW did
  // it (`known`: they saw it, came and saw, or were told face to face): what they know is
  // their own, whatever the watch's record says (DESIGN §29.4, §35.2).
  provoke(target, { known = false } = {}) {
    const g = this.game;
    if (target !== g.player) return;
    if (!crimeActive(g, target) && !(known && this.isCivilDefender())) return;
    this.provokedBy = target;
    this.provokedMode = 'fight';
    this.provokedAt = g.combat?.now?.() ?? now(g);
  }

  fightStep(dt, tick) {
    const g = this.game;
    const t = this.fightTarget;
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      if (t) this.faceToward(t.x, t.y);
      return;
    }
    if (tick && t && t === g.player && (this.profile.hunter || (this.isCivilDefender() && this.provokedBy === t))) this.provoke(t, { known: true });
    // Terrified, or knocked out of their nerve (round 14b): a defender stops.
    if (tick && t === g.player && !this.isGuard && !this.profile.hunter && DEFENDER_COMBAT[this.profile.id] && !isDefender(g, this)) return this.endFight(t);
    if (tick) {
      const valid = t && alive(t) && (hostileTo(g, this, t) || (this.profile.hunter && t.species && huntable(t)));
      // Running in from afar to answer a call, the usual leash waits until they arrive.
      const rushing = now(g) < (this.rushUntil ?? 0) && t && this.distTo(t) > 90;
      const at = this.fightAnchor ?? this.post;
      // The posse hunting a known killer (round 14b, murder/hunt.js): the leash is lifted.
      const chase = t ? g.murder?.chaseOf?.(this, t) : null;
      const far = chase?.far ?? 260;
      const leash = chase?.leash ?? this.fightLeash ?? GUARD_LEASH;
      const tooFar = !t || (!rushing && (this.distTo(t) > far || (at && Math.hypot(this.x - at.x, this.y - at.y) > leash)));
      if (!valid || tooFar) {
        // Lost them: where they were last seen is where the hunt looks next.
        if (t && chase && valid) g.murder?.lostSight?.(this, t);
        return this.endFight(t);
      }
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
    // A huntress keeps her distance and uses the bow.
    if (this.profile.hunter && d > 34 && d < BOW_RANGE && (tick ? (this._clear = walkLine(g, this, this.x, this.y, t.x, t.y)) : this._clear) !== false) {
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      this.faceToward(t.x, t.y);
      if (now(g) >= this.shootReadyAt && this.lockTime <= 0) {
        this.shootReadyAt = now(g) + SHOT_GAP;
        this.setState('attack', 0.3);
        this.animTime = 0;
        try {
          g.combat?.shoot?.(this, t.x, t.y - 6, 'arrow', { target: t, damageMul: 1 });
        } catch {
          /* a wasted arrow */
        }
      }
      return;
    }
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
    // Back to the duty they were on (a companion), else the day's routine.
    this.mode = this.duty ? 'duty' : 'routine';
    this.fightTarget = null;
    this.fightAnchor = null;
    this.fightLeash = null;
    this.post = null;
    this.windup = 0;
    this.speedMul = 1;
    this.walker.stop();
    this.r.key = null;
    if (this.isAlive() && now(g) - this.shoutAt > 3) {
      this.shoutAt = now(g);
      const own = wasPlayer && DEFENDER_COMBAT[this.profile.id] && !this.isGuard ? defenderLine(this.profile.id, 'over', () => rand(g)) : null;
      const list = wasPlayer ? this.profile.crimeOver : this.profile.fightReturn;
      if (own) this.pendingSay = { at: now(g) + 0.6, text: own, kind: 'say', target };
      else if (list?.length) this.pendingSay = { at: now(g) + 0.6, text: pickLine(g, list), kind: 'say', target: wasPlayer ? target : null };
    }
    // A defender's fight is over: they let it go (combat's 'provoked' with it).
    if (wasPlayer && this.provokedBy === target && !this.profile.hunter) {
      this.provokedBy = null;
      this.provokedMode = null;
    }
  }

  // ------------------------------------------------------------ crimes

  onCrime(p) {
    const g = this.game;
    if (!p || !p.actor || p.actor === this) return;
    const actor = p.actor;
    const victim = p.victim;
    // A theft is its own, lighter crime (round 14b, DESIGN §35.3): never a fight, never an
    // assault, and known only to those who saw it (containers.js and the body's pockets
    // emit it only with witnesses).
    if (p.kind === 'theft' || p.kind === 'arson') return this.onTheft(p);
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
    // Saw it: the crime's own screen when there is one (murder.sawBlow: who saw the blow as
    // it fell, or, for a blow told later, the one it was told to), and the stranger in sight
    // now. Seeing the stranger at the moment a crime is told elsewhere is not seeing it.
    let screened = null;
    try {
      screened = victim ? (g.murder?.sawBlow?.(this.id, victim) ?? null) : null;
    } catch {
      screened = null;
    }
    const sees = isVictim || (screened !== false && this.isAlive() && this.distTo(actor) <= SIGHT && this.canSee(actor));
    // Ears (DESIGN §29.4): a blow and a cry where it fell, by the one rule (walls muffle it,
    // a shut house keeps it in). A theft makes no sound; the bell's 'murder' is news, not a
    // noise. Hearing tells what and where, never who: no opinion, no fight, no flight.
    // A crime told later (the hurt one's words, murder.reveal) is no sound at all.
    let told = false;
    try {
      told = !!victim && !!g.murder?.toldNow?.(victim);
    } catch {
      told = false;
    }
    // A victim held silent (round 14b, §37.2) makes neither cry nor sound: loudness 0.
    const loud = told ? 0 : voiceOf(g, victim, p.kind === 'knockout' ? LOUD.scream : p.kind === 'assault' ? LOUD.blow : 0);
    const at = victim && Number.isFinite(victim.x) ? victim : actor;
    const heard = !sees && loud > 0 ? hears(g, this, at.x, at.y, loud) : null;
    if (isPlayer) {
      if (isVictim) {
        this.coldDay = day;
        this.wrongedDay = day;
        this.adjustOpinion(kind === 'knockout' ? -35 : -20, `${kind} by the player`);
      } else if (sees) {
        this.coldDay = day;
        this.adjustOpinion(kind === 'knockout' ? -14 : -7, `saw the player's ${kind}`);
      } else if (heard) this.unease(at.x, at.y);
      // Everyone else: nothing yet. The news travels by meeting (the village's rumors,
      // DESIGN §29.2), and moves them when it reaches them.
    }
    if (!this.isAlive()) return;
    if (this.isGuard) {
      // The watch strikes what it sees. Heard only, they go to the place (the victim's own
      // cry, onCallForHelp) and act on what they find there.
      if (sees && hostileTo(g, this, actor)) this.startFight(actor);
      return;
    }
    // Hess answers a crime like the watch does, when she sees it.
    if (this.profile.hunter && isPlayer && sees && this.state !== 'sleep') {
      this.post = { x: this.x, y: this.y };
      this.startFight(actor);
      return;
    }
    // A defender who SAW it (round 14b, DESIGN §35.2) comes at the stranger for the one hurt;
    // the one hurt fights back too if they are a defender. Heard only: nothing here (the
    // cry brings them to look, onCallForHelp).
    if (isPlayer && sees && this.state !== 'sleep' && this.isCivilDefender() && defendsAgainst(kind)) {
      this.post = { x: this.x, y: this.y };
      this.rushUntil = now(g) + 12;
      this.startFight(actor);
      return;
    }
    // Witnesses run; a carer on the way to the hurt runs too, and comes back once clear.
    if (sees) this.startFlee(actor, isVictim ? 14 : 10, 'crime');
  }

  // A theft (round 14b, DESIGN §35.3): those who saw it think less of the stranger, the one
  // robbed most. Nobody fights over it or runs from it; it is not counted with the blows of
  // the day. The news goes on by meeting (village.js: 'stole', 'robbed_the_dead').
  onTheft(p) {
    const g = this.game;
    const actor = p.actor;
    if (!(actor === g.player || actor?.id === 'player') || !this.isAlive()) return;
    const witnesses = Array.isArray(p.witnesses) ? p.witnesses : null;
    const owner = p.owner || p.victim?.id || null;
    const robbed = owner === this.profile.id;
    const sawIt = witnesses ? witnesses.includes(this.id) : false;
    if (!sawIt && !robbed) return;
    if (sawIt) {
      this.coldDay = g.clock?.day ?? 1;
      const arson = p.kind === 'arson';
      this.adjustOpinion(arson ? -25 : robbed ? -12 : p.dead ? -10 : -5, arson ? 'saw the stranger set a fire' : p.dead ? 'saw the stranger rob the dead' : 'saw the stranger steal');
      if (now(g) - this.shoutAt > 4) {
        this.shoutAt = now(g);
        this.say(arson ? 'FIRE! They set it alight! FIRE!' : p.dead ? 'Are you— are you going through their pockets?' : robbed ? "That's MINE. Put it back!" : 'Hey! That is not yours!', { kind: 'shout', target: actor });
      }
      this.faceToward(actor.x, actor.y);
    } else if (robbed) this.wrongedDay = g.clock?.day ?? 1;
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
    this.leaveBed();
    this.leaveSeat();
    this.help = null;
    this.mode = 'downed';
    this.downedFor = 0;
    this.walker.stop();
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    this.fleeFrom = null;
    this.fightTarget = null;
    this.windup = 0;
    this.pendingSay = null;
    // Knocked down: the whole lane hears about it (DESIGN §19.7).
    this.callForHelp(attackerOf(by), 3);
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

  // ------------------------------------------------------------ the village answers

  // Hit by anyone: the victim cries out, and the people in earshot answer (DESIGN §19.7).
  onHurt(p) {
    const g = this.game;
    const src = attackerOf(p.source);
    if (!src || src === this || this.downed) return;
    // Caught by the stranger's weave meant for something else: a yelp, not a call to arms.
    if (p.accident) {
      const t0 = now(g);
      if (t0 - (this._yelpAt ?? -Infinity) > 5 && !isSilenced(g, this)) {
        this._yelpAt = t0;
        try {
          g.bubbles?.say?.(this, ACCIDENT_YELPS[Math.floor(Math.random() * ACCIDENT_YELPS.length)], { kind: 'shout' });
        } catch {
          /* words are decoration */
        }
      }
      return;
    }
    const t = now(g);
    const sev = this.hp <= this.maxHp * 0.4 ? 2 : 1;
    if (t - (this._hurtCallAt ?? -Infinity) < 6 && sev <= (this._hurtCallSev ?? 0)) return;
    this._hurtCallAt = t;
    this._hurtCallSev = sev;
    this.callForHelp(src, sev);
  }

  callForHelp(attacker, severity = 1) {
    const g = this.game;
    // Held silent (the Unkindling's hold, a silent killing): no call for help at all.
    if (isSilenced(g, this)) return;
    try {
      g.bus?.emit?.('call_for_help', { victim: this, attacker: attacker || null, x: this.x, y: this.y, severity });
    } catch {
      /* listeners must not break the victim */
    }
  }

  // Is this villager family to `id` (either side of the bond)?
  isKinOf(id) {
    if (!id) return false;
    const f = this.profile.family;
    const mine = f && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => f[k]?.includes(id));
    if (mine) return true;
    const other = NPC_PROFILES.find((q) => q.id === id)?.family;
    return !!other && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => other[k]?.includes(this.profile.id));
  }

  // call_for_help { victim, attacker, x, y, severity } — from a villager, or from Lyra's
  // mind/behavior. Each villager who HEARS it (the one rule for ears, src/ai/hearing.js:
  // walls muffle, sleep dulls) picks a part: fight, tend, shield a child, fetch the watch,
  // come to look, or shout and keep clear. A cry tells what and where, never who
  // (DESIGN §29.4): who did it is known only to those who see it (or come and see), or to
  // whom the hurt say it close by. `forced`: someone ran to them with it, face to face; the
  // attacker in it is the one the teller knew (p.culprit: the one who really did it).
  onCallForHelp(p, forced = false) {
    const g = this.game;
    // Lyra's mind calls with ids (victim 'lyra', attacker 'player' or an id) and the
    // entities beside them; villagers call with entities. Either way, find who is who.
    const victim = callEntity(g, p?.victimEntity, p?.victim);
    const who = callEntity(g, p?.attackerEntity, p?.attacker);
    if (!victim || victim === this || who === this || victim.removed) return;
    if (!this.isAlive() || this.downed || this.mode === 'downed') return;
    if (this.mode === 'rescue' || this.mode === 'patient') return; // already carrying someone in (§27)
    // A witness running for the watch with a killing to tell keeps running (DESIGN §29.3):
    // another cry does not turn her aside before the watch has heard it from her.
    if (!forced && this.mode === 'flee' && this.fleeHome === 'to' && this.terror && !this.isGuard) return;
    const real = callEntity(g, p?.culpritEntity, p?.culprit) || who;
    const culprit = real && real !== victim && real !== this && !real.removed ? attackerOf(real) : null;
    const sev = Math.max(1, Math.min(3, Math.round(Number(p.severity) || 1)));
    const x = Number.isFinite(p.x) ? p.x : victim.x;
    const y = Number.isFinite(p.y) ? p.y : victim.y;
    const d = Math.hypot(this.x - x, this.y - y);
    const kin = this.isKinOf(victim.id);
    // Kin know the voice from further off.
    // A cry from someone held silent is no cry (loudness 0, round 14b §37.2); told face to
    // face is words, not their voice.
    const how = forced ? 'told' : hears(g, this, x, y, voiceOf(g, victim, cryLoudness(sev)), { mul: kin && sev >= 2 ? 1.8 : 1 });
    if (!how) return;
    // Who did it, as far as this one knows: the teller's word, or their own eyes and ears.
    const told = forced && who && who !== victim && !who.removed ? attackerOf(who) : null;
    const attacker = forced ? told : this.knowsWho(victim, culprit);
    // Someone hurt, nobody they could name: uneasy for the day (of a place, not a person).
    if (!attacker && culprit && isPerson(g, culprit)) this.unease(x, y);
    const t = now(g);
    const h = this.help;
    if (this.mode === 'help' && h && h.victim === victim) {
      // Already on it: the news is worse, or the culprit has changed.
      if (attacker) h.attacker = attacker;
      if (culprit) h.culprit = culprit;
      h.sev = Math.max(h.sev, sev);
      h.lastCall = t;
      h.until = Math.max(h.until, t + 20);
      if (forced && (h.role === 'shout' || h.role === 'look') && (this.isGuard || this.profile.hunter)) this.startHelp(victim, h.attacker, sev, x, y, d, true, { culprit: h.culprit, how });
      // The watch and Hess, already on their way: once the one doing it is someone they
      // would strike (wanted for it, or a beast), they stop shouting or tending and join
      // the fight (DESIGN §16.6: Lyra calls the watch on the one who came at her).
      else if (h.role !== 'fight' && h.attacker && (this.isGuard || this.profile.hunter) && helpRole(this, { victim, attacker: h.attacker, sev, d, incident: incidentFor(g, victim), game: g, forced }) === 'fight') {
        const keep = h.culprit;
        this.endHelp(true);
        this.startHelp(victim, attacker || keep, sev, x, y, d, forced, { culprit: keep, how });
      }
      return;
    }
    if (this.mode === 'fight' && this.fightTarget && alive(this.fightTarget) && this.fightTarget !== attacker) return;
    if (this.mode === 'fight' && this.fightTarget === attacker) return;
    this.startHelp(victim, attacker, sev, x, y, d, forced, { culprit, how });
  }

  // Who did it, as this villager knows it right now (DESIGN §29.4). A beast's snarl or a
  // bandit's yell says what it is. A person is known only by eyes (the sight rule: seen at
  // the hurt one's side, or the blow itself seen) or by the hurt one's own words, close by
  // and through no wall. A cry alone never names anyone.
  knowsWho(victim, culprit) {
    if (!culprit || !victim) return null;
    const g = this.game;
    if (!isPerson(g, culprit)) return culprit;
    if (this.canSee(culprit) && Math.hypot(culprit.x - victim.x, culprit.y - victim.y) <= SEEN_NEAR) return culprit;
    let saw = null;
    try {
      saw = g.murder?.sawBlow?.(this.id, victim) ?? null;
    } catch {
      saw = null;
    }
    if (saw === true) return culprit;
    if (!victim.dead && !isSilenced(g, victim) && hearsWords(g, this, victim, TELL_REACH)) return culprit;
    return null;
  }

  // Heard a crime, saw nothing (DESIGN §29.4): uneasy for the day. No opinion of anyone.
  unease(x, y) {
    const g = this.game;
    this.uneasy = { day: g.clock?.day ?? 1, place: placeOfSound(g, x, y), t: now(g) };
  }

  // Now they know who (they came and saw, or the hurt told them): the news is theirs as if
  // they had seen it, through the village's own news (rumors: their opinion moves, and they
  // carry it on face to face).
  learnWho(victim, attacker) {
    const g = this.game;
    if (!attacker || !(attacker === g.player || attacker.id === 'player') || !victim?.id) return;
    const lyra = victim.id === 'lyra' || victim === g.companion;
    const down = !!victim.downed || !!victim.dead;
    const kind = lyra ? (down ? 'downed_lyra' : 'hit_lyra') : down ? 'downed_villager' : 'attacked_villager';
    if (victim.dead) return; // a killing has its own knowing (murder.js: found, over the body)
    try {
      g.village?.addRumor?.(kind, { victim: lyra ? null : victim.id, witnesses: [this.id], saw: [this.id] });
    } catch {
      /* the news is decoration to the help */
    }
    if (!g.village?.addRumor && this.profile) this.adjustOpinion(down ? -14 : -7, 'saw who did it');
  }

  startHelp(victim, attacker, sev, x, y, d, forced = false, { culprit = attacker, how = forced ? 'told' : 'clear' } = {}) {
    const g = this.game;
    const t = now(g);
    const inc = incidentFor(g, victim);
    // Heard someone hurt, and no idea who: a person did it, not a beast they could hear.
    const heardOnly = !attacker && !!culprit && isPerson(g, culprit);
    const role = helpRole(this, { victim, attacker, sev, d, incident: inc, game: g, forced, heardOnly });
    if (!role) return;
    if (role === 'fight') {
      this.wake();
      this.post = { x, y };
      this.mode = 'routine';
      this.rushUntil = t + 25;
      this.startFight(attacker);
      this.sayHelp('answer', victim, true);
      return;
    }
    if (role === 'flee') {
      this.wake();
      if (attacker) this.startFlee(attacker, 10, attacker === g.player ? 'crime' : 'flee');
      else if (heardOnly) this.sayHeard(x, y, how);
      else this.sayHelp('shout', victim, true);
      return;
    }
    this.wake();
    this.leaveBed();
    this.leaveSeat();
    this.walker.stop();
    this.r.walking = false;
    this.fleeFrom = null;
    this.mode = 'help';
    this.help = { victim, attacker, culprit: culprit || attacker || null, how, role, sev, phase: 'go', t: 0, at: t, lastCall: t, until: t + HELP_SECONDS, x, y, child: null, guard: null, said: false };
    inc.responders.set(this.id, role);
    const h = this.help;
    if (role === 'shield') {
      h.child = nearestChild(this, 110);
      if (h.child) inc.shielded.add(h.child.id);
    }
    if (role === 'fetch') {
      inc.fetcher = this;
      h.guard = nearestGuard(g, this);
    }
    // The first words: by name when it is someone they love (and they could tell the voice).
    const special = victim.id === 'lyra' && (how !== 'muffled' || this.isKinOf('lyra')) ? this.profile.rescue?.lyra : null;
    const wanted = attacker && attacker === g.player && crimeActive(g, attacker);
    if (special?.length && (role === 'tend' || role === 'confront')) this.sayLine(special, victim, 'shout');
    else if (wanted && (role === 'tend' || role === 'shout')) this.sayLine(this.profile.crime, attacker, 'shout');
    else if (heardOnly && role !== 'fetch') this.sayHeard(x, y, how);
    else this.sayHelp(role === 'tend' ? 'shout' : role === 'confront' ? 'answer' : role, victim, true);
    this.icon(heardOnly ? '?' : '!');
  }

  // What someone who only heard it says (DESIGN §29.4): what and where, never who.
  sayHeard(x, y, how = 'clear') {
    const g = this.game;
    const place = placeOfSound(g, x, y);
    const own = HEAR_LINES[this.profile.id] || {};
    const any = HEAR_LINES.any;
    const muffled = how === 'muffled';
    let list = muffled ? own.muffled || any.muffled : own.clear || any.clear;
    if (!place) {
      const plain = (list || []).filter((l) => !/\{place\}/i.test(l));
      list = plain.length ? plain : muffled ? any.mutedNowhere : any.clearNowhere;
    }
    const phrase = place ? placePhrase(place, g.locations?.get?.(place)?.name || '') : '';
    const fill = (l) => l.replace(/\{place\}/g, phrase).replace(/\{Place\}/g, phrase.charAt(0).toUpperCase() + phrase.slice(1));
    const t = now(g);
    if (t - this.shoutAt < 2.5) return;
    const l = pickLine(g, list);
    if (!l) return;
    this.shoutAt = t;
    this.faceToward(x, y);
    this.say(fill(l), { kind: muffled ? 'say' : 'shout', target: null });
  }

  sayHelp(kind, about, shout = false) {
    const g = this.game;
    const own = this.profile;
    const res = RESPONSE_LINES[own.id] || {};
    let list = res[kind];
    if (kind === 'tend') list = (about?.id === 'lyra' ? own.tend?.lyra : own.tend?.other) || res.tend;
    if (kind === 'answer') list = res.answer || own.fight || own.crime;
    if (kind === 'shout') list = res.shout || own.crime || own.flee;
    if (!list?.length) list = own.flee;
    this.sayLine(list, about, shout ? 'shout' : 'say');
  }

  sayLine(list, target, kind = 'say') {
    const g = this.game;
    const t = now(g);
    if (t - this.shoutAt < 2.5) return;
    const l = pickLine(g, list);
    if (!l) return;
    this.shoutAt = t;
    this.say(l, { kind, target: target || null });
  }

  helpStep(dt, tick) {
    const g = this.game;
    const h = this.help;
    const t = now(g);
    if (!h || !h.victim || h.victim.removed || t > h.until) return this.endHelp();
    h.t += dt;
    const v = h.victim;
    // Heard it, did not know who (DESIGN §29.4): coming closer, they may see now, or the
    // hurt one may tell them. Then they know, and answer as one who knows.
    if (tick && !h.attacker && h.culprit && !h.culprit.removed && isPerson(g, h.culprit)) {
      const k = this.knowsWho(v, h.culprit);
      if (k) {
        h.attacker = k;
        this.learnWho(v, k);
        const role = helpRole(this, { victim: v, attacker: k, sev: h.sev, d: this.distTo(v), incident: incidentFor(g, v), game: g });
        if (role && role !== h.role) {
          const keep = { x: h.x, y: h.y, sev: h.sev };
          this.endHelp(true);
          return this.startHelp(v, k, keep.sev, keep.x, keep.y, this.distTo(v), false, { culprit: k, how: 'saw' });
        }
        // Same part to play, but now they know whose doing it is, and say so.
        if (k === g.player && crimeActive(g, k)) this.sayLine(this.profile.crime, k, 'shout');
      }
    }
    // A cry, and then a death: the helper comes upon a body (murder.js decides what is found).
    if (v.dead) return this.cameUponBody(dt, tick, h, v);
    const a = h.attacker && alive(h.attacker) && !h.attacker.removed && !h.attacker.downed ? h.attacker : null;
    // Danger: whoever did it is still at the victim's side, and recently at it.
    const danger = !!a && Math.hypot(a.x - v.x, a.y - v.y) < DANGER_NEAR && (t - h.lastCall < 14 || hostileTo(g, a, v) || crimeActive(g, a));
    switch (h.role) {
      case 'tend':
        return this.tendStep(dt, tick, h, v, a, danger);
      case 'shield':
        return this.shieldStep(dt, tick, h, a);
      case 'confront':
        return this.confrontStep(dt, tick, h, v, a, danger);
      case 'fetch':
        return this.fetchStep(dt, tick, h, v);
      case 'look':
        return this.lookStep(dt, tick, h, v);
      default:
        return this.shoutStep(dt, tick, h, v, a);
    }
  }

  // Heard a person hurt and saw nothing (DESIGN §29.4): go toward the sound until it is in
  // sight, then act on what is there. The hurt one down: a carer tends them, the rest stand
  // by. The one who did it in plain sight: now they know (helpStep above). Nothing to see:
  // they look a while and go back to their day.
  lookStep(dt, tick, h, v) {
    const g = this.game;
    const dv = this.distTo(v);
    if (h.phase === 'go') {
      const seen = dv < 72 && this.canSee(v);
      // Whoever did it may still be there, and they do not know who (round 14b leftover):
      // they stop short (at the door, or a way off in the open) until they see who.
      if (!seen && this.heardRisk(h, v) && dv < DANGER_NEAR + 40) return this.holdBack(tick, v);
      if (!seen && this.helpMove(dt, v.x + (this.x < v.x ? -16 : 16), v.y + 4, 1.4, 24, tick) !== 'arrived') return;
      h.phase = 'there';
      h.t = 0;
      this.walker.stop();
      this.speedMul = 1;
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      this.faceToward(v.x, v.y);
      const carer = TENDERS.has(this.profile.id) || this.isKinOf(v.id) || !!RESPONSE_LINES[this.profile.id]?.tend || !!this.profile.tend;
      if ((v.downed || (v.hp ?? 1) < (v.maxHp ?? 1)) && carer && !this.isGuard) {
        h.role = 'tend';
        h.phase = 'go';
        incidentFor(g, v).responders.set(this.id, 'tend');
      }
      return;
    }
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    if (tick) this.faceToward(v.x, v.y);
    if (h.t > (this.isGuard ? 8 : 4) + this.jitter * 3) this.endHelp();
  }

  // Came to a cry and found a body: they look on it (murder.bodySeen: found, and the one
  // standing over it is seen there), and the help is over.
  cameUponBody(dt, tick, h, v) {
    const g = this.game;
    const dv = this.distTo(v);
    if (h.t > 30) return this.endHelp();
    if (dv > 60 || !this.canSee(v)) {
      this.helpMove(dt, v.x + (this.x < v.x ? -18 : 18), v.y + 4, 1.3, 30, tick);
      return;
    }
    this.walker.stop();
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    this.faceToward(v.x, v.y);
    try {
      g.murder?.bodySeen?.(this.id, v.id, g.locations?.at?.(v.x, v.y)?.id || null);
    } catch {
      /* the finding is murder.js's to decide */
    }
    this.endHelp();
  }

  // Walk (or hurry) toward a point, re-planning now and then. 'arrived' when close.
  helpMove(dt, x, y, run, arrive = 8, tick = false) {
    if (this.distToPoint(x, y) <= arrive) {
      this.walker.stop();
      this.speedMul = 1;
      return 'arrived';
    }
    this.speedMul = run;
    if (tick || !this.walker.active) this.walker.goTo(x, y);
    const res = this.walker.step(dt);
    if (res === 'stuck' && !this.visibleToPlayer(32)) {
      this.x = x;
      this.y = y + 2;
      return 'arrived';
    }
    return 'moving';
  }

  // Heard someone hurt, not who did it, and that one may still be at their side (round 14b
  // leftover: "a carer who only heard walks straight into the fight").
  heardRisk(h, v) {
    const c = h?.culprit;
    if (!c || h.attacker || c.removed || !alive(c) || c.downed || !isPerson(this.game, c)) return false;
    return Math.hypot(c.x - v.x, c.y - v.y) < DANGER_NEAR;
  }

  holdBack(tick, v) {
    this.walker.stop();
    this.speedMul = 1;
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    if (tick) this.faceToward(v.x, v.y);
  }

  tendStep(dt, tick, h, v, a, danger) {
    const g = this.game;
    const t = now(g);
    const dv = this.distTo(v);
    if (h.phase === 'go') {
      if (!danger && this.heardRisk(h, v) && dv < DANGER_NEAR + 40) return this.holdBack(tick, v);
      if (danger && dv < DANGER_NEAR + 40) {
        // Close enough to call out, too close to the trouble to go in.
        this.walker.stop();
        this.speedMul = 1;
        this.faceToward(v.x, v.y);
        if (tick && rand(g) < 0.08) this.sayHelp('shout', v, true);
        return;
      }
      const side = v.x >= this.x ? -12 : 12;
      if (this.helpMove(dt, v.x + side, v.y + 3, 1.5, 10, tick) !== 'arrived') return;
      h.phase = 'care';
      h.t = 0;
      this.faceToward(v.x, v.y);
      this.setState('work', 1.1);
      this.animTime = 0;
      this.sayHelp('tend', v);
      return;
    }
    if (h.phase === 'care') {
      this.faceToward(v.x, v.y);
      if (dv > 30) {
        h.phase = 'go';
        return;
      }
      if (h.t < 1.1) return;
      const c = g.combat;
      let ok = false;
      try {
        if (v.downed) {
          ok = c?.revive ? !!c.revive(v, this, 0.4) : false;
          if (!ok && typeof v.helpUp === 'function') {
            v.helpUp(this);
            ok = true;
          }
        } else {
          const share = this.profile.id === 'mira' ? 0.35 : 0.2;
          ok = (c?.heal?.(this, v, Math.max(4, Math.round((v.maxHp || 30) * share))) || 0) > 0 || true;
        }
      } catch {
        ok = false;
      }
      if (ok) {
        try {
          if (this.visibleToPlayer(0)) g.particles?.emit?.('heal', v.x, v.y - 10, { count: 6 });
        } catch {
          /* cosmetic */
        }
        try {
          g.bus?.emit?.('tended', { npc: this, victim: v, attacker: h.attacker || null });
        } catch {
          /* listeners must not break the carer */
        }
      }
      h.phase = 'escort';
      h.t = 0;
      h.escortUntil = t + 22;
      const home = homeOf(g, v);
      try {
        g.bus?.emit?.('escort', { npc: this, victim: v, to: home?.id ?? null });
      } catch {
        /* nobody has to listen */
      }
      const lines = RESPONSE_LINES[this.profile.id]?.escort;
      if (lines?.length) this.pendingSay = { at: t + 1.6, text: pickLine(g, lines), kind: 'say', target: v };
      return;
    }
    // Walking them home: keep at their side until they are in, or a while has passed.
    if (t > (h.escortUntil ?? 0) || (v.state === 'sleep' && dv < 40)) return this.endHelp();
    if (danger) {
      h.phase = 'go';
      return;
    }
    const want = dv > 22;
    if (want) this.helpMove(dt, v.x + (this.x < v.x ? -14 : 14), v.y + 2, dv > 80 ? 1.4 : 1.05, 6, tick);
    else {
      this.walker.stop();
      this.speedMul = 1;
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      if (tick && rand(g) < 0.2) this.faceToward(v.x, v.y);
    }
  }

  // Stand between a child and the trouble while the child gets away.
  shieldStep(dt, tick, h, a) {
    const c = h.child;
    if (!c || !alive(c) || !a || h.t > 14 || this.distTo(a) > 260) return this.endHelp();
    const dx = a.x - c.x;
    const dy = a.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const gx = c.x + (dx / d) * 16;
    const gy = c.y + (dy / d) * 16;
    if (this.helpMove(dt, gx, gy, 1.5, 6, tick) === 'arrived') {
      this.moveIntent.x = 0;
      this.moveIntent.y = 0;
      this.faceToward(a.x, a.y);
    }
  }

  // A fighter facing someone combat does not (yet) let them strike: step in the way and warn.
  confrontStep(dt, tick, h, v, a, danger) {
    const g = this.game;
    if (!a || h.t > 16 || (!danger && h.t > 6)) return this.endHelp();
    if (hostileTo(g, this, a) || (this.profile.hunter && crimeActive(g, a)) || (this.isCivilDefender() && (danger || h.sev >= 2))) {
      this.post = { x: this.x, y: this.y };
      this.mode = 'routine';
      this.help = null;
      return this.startFight(a);
    }
    const dx = a.x - v.x;
    const dy = a.y - v.y;
    const d = Math.hypot(dx, dy) || 1;
    const gx = v.x + (dx / d) * Math.min(18, d * 0.5);
    const gy = v.y + (dy / d) * Math.min(18, d * 0.5);
    if (this.helpMove(dt, gx, gy, 1.5, 6, tick) === 'arrived') {
      this.faceToward(a.x, a.y);
      if (tick && rand(g) < 0.1) this.sayLine(this.profile.crime, a, 'shout');
    }
  }

  // Run for the watch and bring them.
  fetchStep(dt, tick, h, v) {
    const g = this.game;
    let G = h.guard;
    if (!G || !alive(G) || G.downed) G = h.guard = nearestGuard(g, this);
    if (!G) return this.endHelp();
    if (G.mode === 'fight' || (G.mode === 'help' && G.help?.victim === v)) return this.endHelp();
    if (this.helpMove(dt, G.x, G.y + 4, 1.6, 40, tick) === 'arrived' || h.t > 25) {
      this.faceToward(G.x, G.y);
      const lead = RESPONSE_LINES[this.profile.id]?.fetch;
      if (lead?.length) this.say(`${D.firstName(G)}! ${D.firstName(v) === 'them' ? 'Quick' : D.firstName(v)} — over there!`, { kind: 'shout', target: G });
      // Told face to face: who did it, if they knew; where, either way.
      G.onCallForHelp({ victim: v, attacker: h.attacker, culpritEntity: h.culprit || h.attacker || null, x: h.x, y: h.y, severity: Math.max(2, h.sev) }, true);
      this.endHelp();
    }
  }

  // Raise the alarm, look, and keep clear of the trouble.
  shoutStep(dt, tick, h, v, a) {
    if (a && this.distTo(a) < 110) {
      this.help = null;
      this.mode = 'routine';
      return this.startFlee(a, 7, 'flee');
    }
    this.walker.stop();
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    this.faceToward(v.x, v.y);
    if (h.t > 4 + this.jitter * 3) this.endHelp();
  }

  endHelp(quiet = false) {
    const g = this.game;
    const h = this.help;
    if (h) {
      const inc = g._helpIncidents?.get(h.victim);
      inc?.responders.delete(this.id);
      if (inc?.fetcher === this) inc.fetcher = null;
    }
    this.help = null;
    if (this.mode === 'help') this.mode = 'routine';
    this.speedMul = 1;
    this.walker.stop();
    this.r.key = null;
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
    // A conversation is playing near the player: nobody talks over it.
    if (village?.playing) return;
    const quiet = t - (g._npcSayAt ?? -Infinity) < SAY_GAP;
    // Lyra nearby (not small talk in the minutes after somebody hurt her).
    const shaken = lyra && g._helpIncidents?.get?.(lyra) && t - g._helpIncidents.get(lyra).t < 150;
    if (lyra && alive(lyra) && !shaken && this.distTo(lyra) < 56 && t - this.lyraAt > 75 && !quiet && this.canSee(lyra)) {
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
    if (dp < 80 && this._aboutLyraDay !== day && !quiet && !village?.wantsSlot?.() && rand(g) < 0.3) {
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
      const other = this.nearestPerson(48, true);
      if (other && rand(g) < 0.8 && this.chatWith(other)) return;
      // A conversation is waiting for this quiet moment: leave it to them.
      if (village?.wantsSlot?.()) return;
      g._npcSayAt = t;
      const k = g.clock?.weather?.type === 'rain' ? 'rain' : g.clock?.isNight ? 'night' : 'day';
      const tone = D.dialogueTone(this, p);
      // An owner by their burned shop says so, never their wares (occupation.burnedLine).
      const burnt = g.occupation?.burnedLine?.(this) || null;
      const l = burnt || (tone === 'cold' || tone === 'wronged' ? null : pickLine(g, this.profile.lines?.[k] || this.profile.lines?.day));
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
    // Held silent (round 14b, DESIGN §37.2): no word, no cry, no scream reaches anyone.
    if (isSilenced(this.game, this)) return;
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
    let d = D.getDialogue(this, player);
    try {
      d = this.game.murder?.decorateDialogue?.(this, d) || d;
    } catch {
      /* grief is optional */
    }
    return this.withLifeOptions(d);
  }

  chooseOption(id, player) {
    const key = String(id || '');
    // A death in the village (DESIGN §29): giving yourself up, the watch's questions.
    if (key.startsWith('murder:')) {
      let r = null;
      try {
        r = this.game.murder?.dialogOption?.(this, key) || null;
      } catch (err) {
        console.warn('[npc] murder option failed', err);
      }
      if (r) return r;
    }
    // Their day (DESIGN §28): "What's wrong?", "Have you seen Garrick?", answering their question.
    if (key.startsWith('life:')) {
      let r = null;
      try {
        r = this.game.villageLife?.dialogOption?.(this, key) || null;
      } catch (err) {
        console.warn('[npc] village life option failed', err);
      }
      if (r?.lines?.length) {
        const back = D.chooseOption(this, '__back', player);
        return this.withLifeOptions({ lines: r.lines, options: back.options });
      }
    }
    return this.withLifeOptions(D.chooseOption(this, id, player));
  }

  withLifeOptions(d) {
    if (!d || !Array.isArray(d.options) || d.close) return d;
    let extra = [];
    try {
      extra = this.game.villageLife?.dialogOptions?.(this) || [];
    } catch {
      extra = [];
    }
    try {
      extra = [...(this.game.murder?.dialogOptions?.(this) || []), ...extra];
    } catch {
      /* optional */
    }
    if (!extra.length) return d;
    const ids = new Set(d.options.map((o) => o.id));
    return { ...d, options: [...extra.filter((o) => !ids.has(o.id)), ...d.options] };
  }

  receiveGift(itemId, giver) {
    return D.receiveGift(this, itemId, giver);
  }

  refusesTrade(player = this.game.player) {
    return D.refusesTrade(this, player);
  }

  // ------------------------------------------------------------ interaction

  canInteract(actor) {
    if (this.carriedBy) return false;
    // The dead lie where they fell (DESIGN §29): a body can be knelt by or lifted.
    if (this.dead) return !!this.game.murder?.bodyCanInteract?.(this, actor);
    return !!actor && actor === this.game.player && !this.dead && !this.removed && !this.absent;
  }

  interactLabel() {
    const n = this.shortName;
    if (this.dead) return this.game.murder?.bodyLabel?.(this, this.game.player) || '';
    if (this.downed) return this.game.survival?.downedLabel?.(this, this.game.player) || `Help ${n} up`;
    if (this.state === 'sleep') return `Wake ${n}`;
    return `Talk to ${n}`;
  }

  interact(actor) {
    const g = this.game;
    if (this.dead) {
      g.murder?.bodyInteract?.(this, actor);
      return;
    }
    if (this.downed) {
      // A potion, or carry them to Mira's (§27); the old hand up without game.survival.
      if (g.survival) {
        g.survival.interactDowned?.(this, actor);
        return;
      }
      return this.helpUp(actor);
    }
    // Running from the player: never a shout-only lock (round 14b T-A4). The chat opens to
    // them; they hear it and answer in fear as they run (village.playerSays), until they
    // are out of earshot.
    if (this.mode === 'flee' && this.fleeFrom === actor) {
      if (actor === g.player && typeof g.ui?.talkTo === 'function') {
        try {
          g.ui.talkTo(this.id);
          return;
        } catch {
          /* fall through to the shout */
        }
      }
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
      // Heard a crime today, saw nothing (round 14b leftover: kept for the day; talk's
      // prompts read it): { day, place, t }.
      uneasy: this.uneasy && this.uneasy.day === (this.game.clock?.day ?? 1) ? { ...this.uneasy } : undefined,
      missingGoods: this.missingGoods && this.missingGoods.day === (this.game.clock?.day ?? 1) ? { ...this.missingGoods } : undefined,
      hideUntil: Number.isFinite(this.hideUntil) && this.hideUntil > (this.game.clock?.t ?? 0) ? this.hideUntil : undefined,
    };
  }

  deserialize(d) {
    if (!d) return;
    super.deserialize(d);
    if (Number.isFinite(d.opinion)) this.opinionOfPlayer = clamp(d.opinion, 0, 100);
    if (Number.isFinite(d.familiarity)) this.familiarity = clamp(d.familiarity, 0, 100);
    if (Array.isArray(d.told)) this.told = new Set(d.told.filter((x) => typeof x === 'string'));
    for (const k of ['coldDay', 'shakenDay', 'wrongedDay', 'giftDay', 'giftsToday', 'talkDay', 'talkFamToday', 'roomDay', 'downedFor', 'hideUntil']) {
      if (Number.isFinite(d[k])) this[k] = d[k];
    }
    // The day's unease and goods found missing, only for the day they were had.
    const today = this.game.clock?.day ?? 1;
    if (d.uneasy && Number.isFinite(d.uneasy.day) && d.uneasy.day === today) this.uneasy = { day: d.uneasy.day, place: typeof d.uneasy.place === 'string' ? d.uneasy.place : null, t: Number(d.uneasy.t) || 0 };
    if (d.missingGoods && d.missingGoods.day === today) this.missingGoods = { day: d.missingGoods.day, object: String(d.missingGoods.object || '') };
    if (this.downed) {
      this.mode = 'downed';
      this.setState('downed');
    }
    // Saved while lying in a bed (or sitting on a bench): start beside it, on free floor.
    if (!this.tileFree(Math.floor(this.x / TILE), Math.floor(this.y / TILE))) {
      const f = this.freeNear(this.x, this.y + TILE);
      if (f) {
        this.x = f.x;
        this.y = f.y;
      }
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

function inBounds(loc, o) {
  const b = loc?.bounds;
  if (!b) return false;
  const tx = o.tx ?? Math.floor(o.x / TILE);
  const ty = o.ty ?? Math.floor(o.y / TILE);
  return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
}

// The actor behind a hit: an arrow's archer, a bolt's caster.
// Who a call for help names: the entity itself, or its id ('player', 'lyra', a villager's).
function callEntity(g, ent, ref) {
  if (ent && typeof ent === 'object') return ent;
  if (ref && typeof ref === 'object') return ref;
  if (typeof ref !== 'string' || !ref) return null;
  if (ref === 'player') return g?.player || null;
  if (ref === 'lyra' && lyraOf(g)) return lyraOf(g);
  try {
    return g?.entities?.get?.(ref) || null;
  } catch {
    return null;
  }
}

// A person (the player, Lyra, a villager) is a WHO: known by eyes or words. A beast or a
// bandit is a WHAT: its snarl or its yell tells those who hear it (DESIGN §29.4).
function isPerson(g, e) {
  if (!e) return false;
  if (e === g?.player || e.id === 'player' || e === g?.companion || e.id === 'lyra') return true;
  return !!e.profile && !e.species;
}

function attackerOf(src) {
  if (!src) return null;
  if (src.type === 'projectile') return src.owner || null;
  return src.type === 'actor' ? src : src.owner || null;
}

// Creatures Hess will take on: monsters, bandits, the dead. Never wildlife, cats or people.
function huntable(e) {
  if (!e || !e.species || e.species === 'cat') return false;
  return factionRelation('villager', e.faction) === 'hostile';
}

// A child by age, the one rule (src/core/people.js isMinor: under 16 by the calendar; the
// build only while the age is unknown). Tansy (build 'teen') is an adult at 16.
function isChild(npc) {
  return isMinor(npc?.game, npc);
}

function nearestChild(npc, r) {
  const g = npc.game;
  return g.entities?.nearest?.(npc.x, npc.y, r, (e) => e !== npc && e instanceof NPC && isChild(e) && alive(e)) || null;
}

function nearestGuard(g, from) {
  return g.entities?.nearest?.(from.x, from.y, 4000, (e) => e instanceof NPC && e.isGuard && alive(e) && !e.downed) || null;
}

function homeOf(g, actor) {
  const L = g.locations;
  if (!L?.get || !actor) return null;
  if (actor.id === 'lyra') return L.get('chandlery') || L.get('ember_kettle') || null;
  const home = actor.profile?.home;
  return (home && (L.get(home) || L.get(PLACE_FALLBACK[home]))) || null;
}

// One shared record per victim, so the village splits the work (one fetcher, each child
// shielded once) instead of everyone doing the same thing.
function incidentFor(g, victim) {
  const t = now(g);
  let map = g._helpIncidents;
  if (!map) map = g._helpIncidents = new Map();
  for (const [k, v] of map) if (t - v.t > 90) map.delete(k);
  let inc = map.get(victim);
  if (!inc) map.set(victim, (inc = { t, responders: new Map(), fetcher: null, shielded: new Set() }));
  inc.t = t;
  return inc;
}

// Which part a villager plays in a call for help (DESIGN §19.7). Pure apart from looking
// around: ctx = { victim, attacker, sev, d (distance to the victim), incident, game, forced }.
//   fight     guards and Hess, against an attacker combat lets them strike
//   confront  guards and Hess, stepping in the way of the player when it is not (yet) a crime
//   tend      Mira, the Ambrels, Elda, Aveline, and family of the victim: heal, help up, walk home
//   shield    an adult with Pip or Tansy close by: stand between the child and the trouble
//   fetch     one villager runs for the watch when no guard is near
//   look      heard a person hurt and saw nothing (DESIGN §29.4): go and see, then act on
//             what they find (the watch included: they strike only what they see)
//   flee      children, and anyone with the trouble on top of them
//   shout     everyone else: raise the alarm, look, keep clear
// ctx.heardOnly: they heard a person hurt and do not know who did it (attacker is null).
export function helpRole(npc, ctx) {
  const g = ctx.game || npc.game;
  const { victim, attacker, sev = 1, d = 0, incident = null, forced = false, heardOnly = false } = ctx;
  const id = npc.profile?.id;
  const fighter = npc.isGuard || !!npc.profile?.hunter;
  // A villager who fights back (round 14b, DESIGN §35.2): never a child, an elder, the
  // terrified or the downed (src/entities/defenders.js).
  const civil = !fighter && isDefender(g, npc);
  const playerDid = !!attacker && (attacker === g?.player || attacker.id === 'player');
  const close = attacker ? Math.hypot(npc.x - attacker.x, npc.y - attacker.y) : Infinity;
  if (fighter && attacker) {
    if (hostileTo(g, npc, attacker) || (npc.profile?.hunter && attacker.species && huntable(attacker))) return 'fight';
    if (playerDid && npc.profile?.hunter && crimeActive(g, attacker)) return 'fight';
    if (playerDid && (sev >= 2 || forced || d < 140)) return 'confront';
  }
  // A defender who KNOWS who hurt them (`attacker` is only ever the one this villager knows:
  // saw, came and saw, or was told): the one at it now, or a beast in the village.
  if (civil && attacker && attacker !== victim) {
    // A child close by and nobody between them and the trouble: that first.
    const child = incident ? nearestChild(npc, 110) : null;
    if (child && !incident.shielded.has(child.id) && child !== victim) return 'shield';
    if (attacker.species && hostileTo(g, attacker, npc)) return 'fight';
    if (playerDid) return sev >= 2 || victim?.downed || forced || d < 140 ? 'fight' : 'confront';
  }
  if (fighter && !attacker) return heardOnly ? 'look' : victim?.downed || sev >= 2 ? 'tend' : 'shout';
  if (isChild(npc)) return 'flee';
  // A witness in terror of the stranger (a killing seen, DESIGN §29.3) keeps clear of them:
  // never kneels to tend, shields or fetches at their feet.
  if (playerDid && fearsStranger(g, npc)) return 'flee';
  const kin = npc.isKinOf?.(victim?.id);
  if ((TENDERS.has(id) || kin) && (sev >= 2 || d < 260 || kin || victim?.downed)) return 'tend';
  if (attacker && incident) {
    const child = nearestChild(npc, 110);
    if (child && !incident.shielded.has(child.id) && child !== victim) return 'shield';
  }
  if (RESPONSE_LINES[id]?.tend && d < 200 && (sev >= 2 || victim?.downed)) return 'tend';
  if (attacker && close < 60) return 'flee';
  if ((attacker || heardOnly) && incident && !incident.fetcher && sev >= 2) {
    const G = nearestGuard(g, npc);
    const guardNear = G && Math.hypot(G.x - victim.x, G.y - victim.y) < 240;
    if (G && !guardNear && G.mode !== 'fight') return 'fetch';
  }
  // One knock from afar is not everyone's business.
  if (sev <= 1 && d > 160 && !forced) return null;
  // A scream close by, nobody knows whose doing: some go to see.
  if (heardOnly && sev >= 2 && d < 200) return 'look';
  return 'shout';
}

// Hooks every villager shares, installed once per game: Lyra's own hurts reach the village
// even before her mind calls out (a fallback; her call_for_help refreshes the same answer),
// and villagers the world did not place yet are put at home when the game starts.
function installVillageHooks(game) {
  if (game._villageHooks || !game.bus?.on) return;
  game._villageHooks = true;
  const bus = game.bus;
  const lastCall = { t: -Infinity, sev: 0 };
  const alarm = (victim, attacker, sev) => {
    // Held silent: no alarm goes up from them (round 14b, DESIGN §37.2).
    if (isSilenced(game, victim)) return;
    const t = now(game);
    if (t - lastCall.t < 5 && sev <= lastCall.sev) return;
    lastCall.t = t;
    lastCall.sev = sev;
    const p = { victim, attacker, x: victim.x, y: victim.y, severity: sev };
    for (const e of game.entities?.all?.() || []) if (e instanceof NPC && !e.removed) e.onCallForHelp(p);
  };
  bus.on('damage', (p) => {
    const lyra = game.companion;
    if (!p || !lyra || p.target !== lyra || p.accident) return;
    const src = attackerOf(p.source);
    if (!src || src === lyra) return;
    const f = lyra.maxHp ? lyra.hp / lyra.maxHp : 1;
    alarm(lyra, src, f < 0.35 ? 3 : f < 0.7 ? 2 : 1);
  });
  bus.on('downed', (p) => {
    const lyra = game.companion;
    if (p?.entity && p.entity === lyra) alarm(lyra, attackerOf(p.by), 3);
  });
  bus.on('game_start', () => ensureVillagers(game));
}

// Put any villager whose profile exists but whom the world did not place at their home
// (or what stands in for it), so all eighteen live in the village. Returns those added.
export function ensureVillagers(game, profiles = NPC_PROFILES) {
  const ents = game?.entities;
  const L = game?.locations;
  if (!ents?.add || !L?.get) return [];
  const added = [];
  for (const p of profiles) {
    if (ents.get?.(p.id)) continue;
    const loc = L.get(p.home) || L.get(PLACE_FALLBACK[p.home]) || L.get('town_square');
    if (!loc?.center) continue;
    const spot = freeSpotNear(game, loc.center.x, loc.center.y, hashId(p.id)) || loc.center;
    try {
      added.push(ents.add(new NPC(game, p, { x: spot.x, y: spot.y })));
    } catch (err) {
      console.error('[npc] could not place', p.id, err);
    }
  }
  return added;
}

function freeSpotNear(game, x, y, salt) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  for (let r = 0; r <= 4; r++) {
    for (let k = 0; k < 8; k++) {
      const a = (salt * 6.28 + k * 0.785) % 6.283;
      const cx = tx + Math.round(Math.cos(a) * r);
      const cy = ty + Math.round(Math.sin(a) * r);
      let blocked = false;
      try {
        blocked = !!game.isBlockedTile?.(cx, cy, null) || !!game.objects?.doorAt?.(cx, cy);
      } catch {
        blocked = true;
      }
      if (!blocked) return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 + 2 };
    }
  }
  return null;
}

