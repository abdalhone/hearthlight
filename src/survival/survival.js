import { TILE } from '../core/constants.js';
import {
  PLAYER_WINDOW,
  LYRA_WINDOW,
  VILLAGER_WINDOW,
  RATE,
  CRAWL_SPEED,
  CRAWL_BUDGET,
  CALL_COOLDOWN,
  CALL_RADIUS,
  SEE_RADIUS,
  LYRA_HEARS,
  LYRA_HEARS_APART,
  GUARD_HEARS_WANTED,
  ASLEEP_EAR,
  SLOWMO_SCALE,
  SLOWMO_HOLD,
  SLOWMO_RAMP,
  DANGER_RADIUS,
  SICKBEDS,
  CELL_BED,
  CONDITIONS,
  PATIENT_SECONDS,
  OUT_FOR_A_DAY,
  POTION_REVIVE_HP,
  CARRY_SPEED,
} from './constants.js';
import { CALL_LINES, LYRA_CARRIED, LYRA_POTION, lyraTone, pickLine } from './lines.js';
import { stepJob, newJob, canRespond, roleFor, countRoles, isLyra, isPlayer, isVillager, speak, lineFor, stopFeet, nearestCarrier } from './rescue.js';
import { startCarry, endCarry, syncCarries } from './carry.js';
import { tendPlayer, wakeHome, flameReturn, finalDeath, admitPatient, releasePatient, carriedOff } from './outcomes.js';
import { hasKeptFlame } from './kept_flame.js';
import { placeName } from './epitaph.js';

// Death is dangerous (DESIGN §27). `game.survival` owns every fall in the world: the
// player's bleed-out window and the cinematic around it, Lyra's and the villagers' own
// windows, who comes (and how), carrying, the sickroom, the kept flame and the end.
// Nothing here pauses the world: everyone else keeps living while someone lies bleeding.
//
// Hooks for other systems:
//   player.fall({ window, cause })     fall now (berserk's end: { window: 30, cause: 'berserk' })
//   game.stats?.get(player, 'bleedout')   seconds of bleed-out window (default 75)
//   game.stats?.get(actor, 'carrySpeed')  multiplier on carrying speed (Resolve)
//   survival.isFallen(actor), .fallOf(actor), .modifiers(actor), .mul(actor, 'atk'|'speed')
//   events: fallen, fall_call, rescuer_coming, carried, set_down, delivered, patient,
//           fall_resolved, player_tended, player_died {mode}, life_closed, flame_returned

const PLAYER_ID = 'player';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function companionshipOf(lyra) {
  return safe(() => lyra?.mind?.companionship ?? lyra?.mind?.autonomy?.companionship, 'together') || 'together';
}

export class Survival {
  constructor(game) {
    this.game = game;
    this.falls = new Map(); // actor -> fall record
    this.jobs = new Map(); // rescuer -> job
    this.carries = new Map(); // carrier -> carry
    this.patients = new Map(); // actor -> { bed, until, kind, savedBy }
    this.reserved = new Map(); // bed id -> carrier heading there
    this.conditions = []; // the player's weaknesses: [{ id, until }]
    this.saved = []; // ids of people the player carried or revived (the memorial counts them)
    this.slowmo = null; // { t } real seconds since the player fell
    this.heart = { phase: 0, bpm: 72, pulse: 0, beats: 0 };
    this.pending = null; // the outcome sequence in progress (a promise)
    this.memorial = null;
    this.fast = false; // tests: skip real-time waits
    this._quiet = false;
    this._drawables = [];
    const bus = game.bus;
    if (bus?.on) {
      bus.on('downed', (p) => this.onDowned(p));
      bus.on('revived', (p) => this.onRevived(p));
      bus.on('game_start', (p) => this.onGameStart(p));
      bus.on('player_wake', () => this.onPlayerWake());
    }
  }

  // ---------------------------------------------------------------- queries

  owns(actor) {
    return !!actor && (this.falls.has(actor) || this.patients.has(actor));
  }

  isFallen(actor) {
    return !!actor && this.falls.has(actor);
  }

  fallOf(actor) {
    return this.falls.get(actor) || null;
  }

  jobFor(actor) {
    return this.jobs.get(actor) || null;
  }

  now() {
    return this.game.clock?.t ?? 0;
  }

  rand() {
    const r = this.game.rng;
    return r && typeof r.next === 'function' ? r.next() : Math.random();
  }

  visible(a, margin = 24) {
    const cam = this.game.camera;
    if (!a || !cam || !Number.isFinite(cam.vw)) return false;
    return a.x >= cam.x - margin && a.x <= cam.x + cam.vw + margin && a.y >= cam.y - margin && a.y <= cam.y + cam.vh + margin;
  }

  defaultWindow(actor) {
    if (isPlayer(this, actor)) {
      const s = safe(() => this.game.stats?.get?.(actor, 'bleedout'));
      return Number.isFinite(s) && s > 0 ? s : PLAYER_WINDOW;
    }
    return isLyra(this, actor) ? LYRA_WINDOW : VILLAGER_WINDOW;
  }

  carryBonus(a) {
    const s = safe(() => this.game.stats?.get?.(a, 'carrySpeed'));
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  // A hostile still standing over the fallen.
  dangerNear(F, rescuer) {
    const g = this.game;
    const list = g.entities?.all?.() || [];
    let best = null;
    let bd = DANGER_RADIUS;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === F || e === rescuer || e.type !== 'actor' || e.removed || e.dead || e.downed) continue;
      if (!(e.hp > 0)) continue;
      const d = Math.hypot(e.x - F.x, e.y - F.y);
      if (d > bd) continue;
      let hostile = false;
      try {
        hostile = g.combat?.isHostile ? g.combat.isHostile(e, rescuer) : false;
      } catch {
        hostile = false;
      }
      // The watch carrying someone wanted is not in danger from the player lying there.
      if (hostile && isPlayer(this, e)) hostile = false;
      if (hostile) {
        best = e;
        bd = d;
      }
    }
    return best;
  }

  blockedAt(px, py) {
    const g = this.game;
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    try {
      if (g.isBlockedTile?.(tx, ty, null)) return true;
      if (g.objects?.doorAt?.(tx, ty)) return true;
      if (g.map?.isWater?.(tx, ty)) return true;
    } catch {
      return false;
    }
    return false;
  }

  // The nearest walkable, dry spot to (x, y): ring search over tiles.
  freeSpotNear(x, y) {
    if (!this.blockedAt(x, y)) return { x, y };
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = (tx + dx) * TILE + TILE / 2;
          const cy = (ty + dy) * TILE + TILE / 2 + 2;
          if (!this.blockedAt(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return null;
  }

  bedTaken(bed) {
    if (!bed) return true;
    for (const p of this.patients.values()) if (p.bed === bed) return true;
    const r = this.reserved.get(bed.id);
    return !!r && !r.removed && r.carrying;
  }

  freeBed(ids) {
    for (const id of ids) {
      const b = safe(() => this.game.objects?.get?.(id));
      if (b && !b.removed && !this.bedTaken(b)) return b;
    }
    return null;
  }

  ownBed(actor) {
    const g = this.game;
    if (isLyra(this, actor)) return safe(() => g.objects?.get?.('lyra_inn_bed') || g.objects?.get?.('lyra_bed'));
    const b = safe(() => actor.ownBed?.());
    if (b) return b;
    return safe(() => (g.objects?.all?.() || []).find((o) => o.objType === 'bed' && o.owner === actor.id)) || null;
  }

  // Where a carrier takes someone: the nearest free cot of the sickroom (or the chapel's),
  // the guardhouse cell for someone the watch wants. { bed, x, y } beside it.
  pickDestination(F, job) {
    const g = this.game;
    const rec = this.falls.get(F);
    let bed = null;
    if (job?.role === 'arrest' || rec?.wanted) bed = safe(() => g.objects?.get?.(CELL_BED));
    if (!bed) {
      const from = job?.rescuer || F;
      let best = null;
      let bd = Infinity;
      for (const id of SICKBEDS) {
        const b = safe(() => g.objects?.get?.(id));
        if (!b || b.removed || this.bedTaken(b)) continue;
        const d = dist(b, from) + (id === 'infirmary_cot' ? 160 : 0);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      bed = best || this.ownBed(F) || safe(() => g.objects?.get?.(SICKBEDS[0]));
    }
    if (!bed) return null;
    if (job?.rescuer) this.reserved.set(bed.id, job.rescuer);
    const s = bed.sleepSpot || { x: bed.x + TILE, y: bed.y - 6 };
    const spot = this.freeSpotNear(s.x, s.y + 2) || s;
    return { bed, x: spot.x, y: spot.y };
  }

  fetchTarget(from, rec) {
    const c = nearestCarrier(this, from, rec);
    if (c) return c;
    const lyra = this.game.companion;
    return lyra && canRespond(this, lyra) ? lyra : null;
  }

  // ---------------------------------------------------------------- falling

  // Someone hit 0 HP and lies on the ground, alive. Returns the fall record.
  fall(actor, opts = {}) {
    if (!actor || actor.removed || actor.dead) return null;
    const existing = this.falls.get(actor);
    if (existing) return existing;
    const g = this.game;
    const player = isPlayer(this, actor);
    const window = Number.isFinite(opts.window) && opts.window > 0 ? opts.window : this.defaultWindow(actor);
    const by = opts.by && opts.by.type === 'projectile' ? opts.by.owner || null : opts.by || null;
    const rec = {
      actor,
      kind: player ? 'player' : isLyra(this, actor) ? 'lyra' : 'villager',
      window,
      left: Number.isFinite(opts.left) ? Math.min(window, opts.left) : window,
      t: opts.t || 0,
      cause: opts.cause || 'wounds',
      by,
      wanted: !!opts.wanted,
      crawled: opts.crawled || 0,
      crawling: false,
      calls: 0,
      lastCall: -Infinity,
      responders: new Set(),
      stanchers: new Set(),
      carrier: null,
      carrierName: null,
      anyoneCame: false,
      lyraCame: false,
      wet: false,
      grave: !!opts.grave,
      patrol: null,
      place: placeName(g, actor.x, actor.y),
      lyraAt: (opts.t || 0) + 9,
    };
    // Falling into water: the body is pulled to the nearest bank, cold and soaked.
    if (safe(() => g.map?.isWater?.(Math.floor(actor.x / TILE), Math.floor(actor.y / TILE)), false) || opts.wet) {
      rec.wet = true;
      const s = this.freeSpotNear(actor.x, actor.y);
      if (s) {
        actor.x = s.x;
        actor.y = s.y;
      }
    }
    this.falls.set(actor, rec);
    if (player) {
      this.slowmo = opts.load ? null : { t: 0 };
      rec.wanted = rec.wanted || !!opts.wanted;
      g.bus?.emit?.('fallen', { entity: actor, by, window, cause: rec.cause });
      if (!opts.load) {
        // The fall is saved at once: closing the page does not escape it.
        if (g.save) g.save.pending = g.save.pending || 'fall';
        this.alert(rec, SEE_RADIUS, { sight: true });
      }
    } else {
      g.bus?.emit?.('fallen', { entity: actor, by, window, cause: rec.cause });
    }
    return rec;
  }

  onDowned(p) {
    const e = p?.entity;
    if (!e || e.species) return;
    const g = this.game;
    if (isPlayer(this, e)) {
      const opts = e._fallOpts || {};
      e._fallOpts = null;
      const wanted = safe(() => (g.combat?.hasCrime ? g.combat.hasCrime(e) : !!e.crime), false);
      this.fall(e, { ...opts, by: p.by, wanted });
      return;
    }
    if (isLyra(this, e) || isVillager(e)) {
      // Whoever they were carrying goes down with them.
      if (e.carrying) endCarry(this, e);
      const j = this.jobs.get(e);
      if (j) this.endJob(j);
      this.fall(e, { by: p.by });
    }
  }

  onRevived(p) {
    const e = p?.entity;
    if (!e) return;
    const rec = this.falls.get(e);
    if (!rec) return;
    this.resolveFall(e, 'revived');
    if (isPlayer(this, e) && !this._quiet) this.addCondition('bruised');
    if (p.by && isPlayer(this, p.by) && !isPlayer(this, e) && !this.saved.includes(e.id)) this.saved.push(e.id);
  }

  // Revive through combat (its effects and event), with a fallback.
  reviveFall(F, by, frac) {
    const g = this.game;
    let ok = false;
    try {
      ok = !!g.combat?.revive?.(F, by, frac);
    } catch {
      ok = false;
    }
    if (!ok && F.downed) {
      F.downed = false;
      F.hp = Math.max(1, Math.round(F.maxHp * frac));
      F.setState?.('idle');
      g.bus?.emit?.('revived', { entity: F, by });
    }
    if (this.falls.has(F)) this.resolveFall(F, 'revived');
    return true;
  }

  // The fall is over (revived, tended, admitted, dead). Everyone on it stands down.
  resolveFall(actor, how, { keepCarry = false } = {}) {
    const rec = this.falls.get(actor);
    if (!rec) return null;
    this.falls.delete(actor);
    for (const r of [...rec.responders]) {
      const j = this.jobs.get(r);
      if (j && j.fall === rec && j.phase !== 'lay') this.endJob(j);
    }
    rec.responders.clear();
    rec.stanchers.clear();
    if (!keepCarry && actor.carriedBy && how !== 'patient' && how !== 'tended') endCarry(this, actor.carriedBy);
    if (isPlayer(this, actor)) {
      this.slowmo = null;
      this.game.timeScale = 1;
    }
    this.game.bus?.emit?.('fall_resolved', { entity: actor, how });
    return rec;
  }

  // ---------------------------------------------------------------- calling and coming

  // The player shouts for help: everyone in earshot hears, Lyra from farther.
  callForHelp(actor = this.game.player) {
    const rec = this.falls.get(actor);
    if (!rec || actor.carriedBy) return 0;
    const t = rec.t;
    if (t - rec.lastCall < CALL_COOLDOWN) return 0;
    rec.lastCall = t;
    rec.calls++;
    const g = this.game;
    const text = pickLine(CALL_LINES, g.rng);
    try {
      g.bubbles?.say?.(actor, text, { kind: 'shout' });
      g.bus?.emit?.('speech', { speaker: actor, text, target: null, kind: 'shout' });
      g.audio?.play?.('hurt', { x: actor.x, y: actor.y, volume: 0.6, pitch: 0.7 });
    } catch {
      /* cosmetic */
    }
    const before = rec.responders.size;
    this.alert(rec, CALL_RADIUS);
    g.bus?.emit?.('fall_call', { entity: actor, x: actor.x, y: actor.y, calls: rec.calls });
    return rec.responders.size - before;
  }

  // Send whoever hears or sees to the fallen player.
  alert(rec, radius, { from = null, forced = false, sight = false } = {}) {
    const g = this.game;
    const F = rec.actor;
    if (!isPlayer(this, F)) return;
    const ox = from?.x ?? F.x;
    const oy = from?.y ?? F.y;
    const lyra = g.companion;
    if (lyra && canRespond(this, lyra)) {
      const cs = companionshipOf(lyra);
      const ears = cs === 'left' || cs === 'gone' ? LYRA_HEARS_APART : LYRA_HEARS;
      const d = Math.min(dist(lyra, F), Math.hypot(lyra.x - ox, lyra.y - oy));
      if (forced || d <= Math.max(ears, radius)) this.assignJob(lyra, rec, 'lyra');
    }
    const counts = countRoles(this, rec);
    const list = [];
    for (const e of g.entities?.all?.() || []) {
      if (!isVillager(e) || !canRespond(this, e)) continue;
      const d = Math.hypot(e.x - ox, e.y - oy);
      let reach = radius * (e.state === 'sleep' ? ASLEEP_EAR : 1);
      if (rec.wanted && e.isGuard) reach = Math.max(reach, GUARD_HEARS_WANTED);
      if (!forced && d > reach) continue;
      if (sight && !rec.wanted && typeof e.canSee === 'function' && !e.canSee(F)) continue;
      list.push([d, e]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, e] of list) {
      const role = roleFor(this, e, rec, counts);
      if (!role) continue;
      if (this.assignJob(e, rec, role, { forced })) {
        const k = role === 'arrest' ? 'carry' : role;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
  }

  assignJob(actor, rec, role, { forced = false } = {}) {
    if (!canRespond(this, actor) || !this.falls.has(rec.actor)) return null;
    const g = this.game;
    const job = newJob(this, actor, rec, role);
    if (role === 'fetch') job.target = this.fetchTarget(actor, rec);
    this.jobs.set(actor, job);
    rec.responders.add(actor);
    if (isVillager(actor)) {
      safe(() => actor.wake?.());
      if (actor.mode === 'help') safe(() => actor.endHelp?.(true));
      safe(() => actor.walker?.stop?.());
      actor.fleeFrom = null;
      actor.mode = 'rescue';
      safe(() => actor.icon?.('!'));
    } else if (isLyra(this, actor)) {
      safe(() => actor.behavior?.cancelTask?.());
    }
    if (isLyra(this, actor) || this.visible(actor, 80) || forced) speak(this, actor, lineFor(this, actor, role === 'fetch' ? 'see' : 'see'), 'shout');
    g.bus?.emit?.('rescuer_coming', { rescuer: actor, entity: rec.actor, role });
    return job;
  }

  endJob(job) {
    if (!job) return;
    const a = job.rescuer;
    if (this.jobs.get(a) === job) this.jobs.delete(a);
    job.fall?.responders?.delete(a);
    job.fall?.stanchers?.delete(a);
    for (const [id, r] of this.reserved) if (r === a && !a.carrying) this.reserved.delete(id);
    stopFeet(this, job);
    if (a._svSlip > 0) {
      a._svSlip = 0;
      a.solid = true;
    }
    if (isVillager(a)) {
      if (a.mode === 'rescue') a.mode = 'routine';
      if (a.r) a.r.key = null;
    }
    if (a.state === 'work' && !a.downed) a.setState?.('idle');
  }

  // Called by a rescuer's own controller (a villager's think, Lyra's behavior) each step.
  // Returns true when survival moved them this step.
  stepActor(actor, dt) {
    const p = this.patients.get(actor);
    if (p) {
      this.holdPatient(actor, p);
      return true;
    }
    const job = this.jobs.get(actor);
    if (!job) return false;
    try {
      return stepJob(this, job, dt);
    } catch (err) {
      console.error('[survival] rescue step failed', err);
      this.endJob(job);
      return false;
    }
  }

  holdPatient(actor, p) {
    const lie = p.bed?.lie || p.bed;
    if (lie) {
      actor.x = lie.x;
      actor.y = lie.y;
    }
    if (actor.moveIntent) {
      actor.moveIntent.x = 0;
      actor.moveIntent.y = 0;
    }
    if (actor.state !== 'sleep') actor.setState?.('sleep');
  }

  // ---------------------------------------------------------------- the player's hands

  // Interacting with someone lying downed: a potion if the player has one, else pick them up.
  interactDowned(target, player = this.game.player) {
    if (!target || !player || !target.downed || target.carriedBy || player.carrying || player.downed) return false;
    const g = this.game;
    const tone = isLyra(this, target) ? lyraTone(target) : null;
    if (player.inventory?.has?.('potion')) {
      player.inventory.remove('potion', 1);
      try {
        g.bus?.emit?.('item_used', { actor: player, itemId: 'potion', target });
        g.audio?.play?.('heal', { x: target.x, y: target.y });
      } catch {
        /* cosmetic */
      }
      this.reviveFall(target, player, POTION_REVIVE_HP);
      if (tone) setTimeout(() => speak(this, target, pickLine(LYRA_POTION[tone], g.rng)), 700);
      return true;
    }
    if (!this.falls.has(target)) this.fall(target, {});
    const c = startCarry(this, player, target, null);
    if (!c) return false;
    player.setState?.('work', 0.45);
    if (tone) speak(this, target, pickLine(LYRA_CARRIED[tone], g.rng), 'whisper');
    return true;
  }

  downedLabel(target, player = this.game.player) {
    if (!target?.downed) return null;
    const name = target.name?.split(' ')[0] || 'them';
    if (player?.inventory?.has?.('potion')) return `Give ${name} a potion`;
    return `Carry ${name}`;
  }

  // The cot within reach of the player, free for someone to be laid in.
  cotInReach(player) {
    const g = this.game;
    let best = null;
    let bd = 30;
    for (const id of [...SICKBEDS, CELL_BED]) {
      const b = safe(() => g.objects?.get?.(id));
      if (!b || this.bedTaken(b)) continue;
      const d = Math.hypot(b.x - player.x, b.y - 8 - player.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // Interact while carrying: lay them in a cot when one is in reach, else put them down.
  carrierInteract(player = this.game.player) {
    const c = this.carries.get(player);
    if (!c) return false;
    const bed = this.cotInReach(player);
    if (bed) {
      this.deliver(player, { bed, x: player.x, y: player.y }, null);
      return true;
    }
    endCarry(this, player);
    player.setState?.('work', 0.35);
    return true;
  }

  promptFor(player = this.game.player) {
    if (!player) return null;
    if (this.falls.has(player)) return player.carriedBy ? '' : 'Call for help';
    const c = this.carries.get(player);
    if (!c) return null;
    const name = c.carried.name?.split(' ')[0] || 'them';
    return this.cotInReach(player) ? `Lay ${name} in the cot` : `Put ${name} down`;
  }

  // Movement multiplier for the player: carrying slows you, weakness slows you.
  speedFactor(actor) {
    let k = this.mul(actor, 'speed');
    if (actor?.carrying) k *= CARRY_SPEED * this.carryBonus(actor);
    return k;
  }

  startCarry(carrier, carried, job) {
    return startCarry(this, carrier, carried, job);
  }

  endCarry(carrier, opts) {
    return endCarry(this, carrier, opts);
  }

  // Someone reached a cot with the fallen on their shoulders.
  deliver(carrier, dest, job) {
    const c = this.carries.get(carrier);
    if (!c || !dest?.bed) return false;
    const g = this.game;
    const F = c.carried;
    const bed = dest.bed;
    const rec = this.falls.get(F);
    endCarry(this, carrier, { at: bed.lie || { x: bed.x, y: bed.y - 6 } });
    this.reserved.delete(bed.id);
    g.bus?.emit?.('delivered', { carrier, entity: F, bed });
    if (isPlayer(this, F)) {
      tendPlayer(this, carrier, bed, { arrested: !!rec?.wanted || job?.role === 'arrest' });
      return true;
    }
    const grave = !!rec?.grave;
    admitPatient(this, F, bed, { seconds: grave ? OUT_FOR_A_DAY : PATIENT_SECONDS, savedBy: carrier, kind: grave ? 'grave' : 'recover' });
    if (isPlayer(this, carrier)) this.thankPlayer(F, bed);
    return true;
  }

  // The player carried someone in: they remember it, and so does the village.
  thankPlayer(F, bed) {
    const g = this.game;
    if (!this.saved.includes(F.id)) this.saved.push(F.id);
    if (isLyra(this, F)) {
      const mind = F.mind;
      const P = g.player?.name && g.player.name !== 'Traveler' ? g.player.name : 'the stranger';
      safe(() => mind?.remember?.(`I went down, and ${P} carried me to Mira's on their back. I felt every step. I won't forget it.`, { importance: 8, about: [PLAYER_ID], tags: ['rescue', 'carried'], emotion: 'gratitude' }));
      safe(() => mind?.relationships?.adjust?.(PLAYER_ID, { affinity: 5, trust: 4 }, 'carried me to safety'));
      safe(() => g.village?.addRumor?.('carried_lyra', { victim: 'lyra', witnesses: ['lyra', 'mira', ...(g.village?.witnessesNear?.(bed.x, bed.y) || [])], source: 'mira' }));
      return;
    }
    if (isVillager(F)) {
      safe(() => F.adjustOpinion?.(15, 'carried me to safety'));
      F.savedBy = PLAYER_ID;
      safe(() => g.village?.addRumor?.('carried_villager', { victim: F.id, witnesses: [F.id, ...(g.village?.witnessesNear?.(bed.x, bed.y) || [])] }));
      safe(() => g.village?.amend?.(F.id, 'help'));
      const lyra = g.companion;
      if (lyra?.mind && dist(lyra, F) < 400) safe(() => lyra.mind.remember(`${g.player?.name || 'The stranger'} carried ${F.name} to Mira's when they were down.`, { importance: 6, about: [PLAYER_ID, F.id], tags: ['kindness'] }));
    }
  }

  // Lyra's memory of a rescue she did.
  lyraRemembers(F, kind) {
    const lyra = this.game.companion;
    const mind = lyra?.mind;
    if (!mind) return;
    const P = this.game.player?.name && this.game.player.name !== 'Traveler' ? this.game.player.name : 'the stranger';
    const where = this.falls.get(F)?.place || placeName(this.game, F.x, F.y);
    let text = '';
    if (kind === 'warmth') text = isPlayer(this, F) ? `${P} went down in ${where}. I gave them my warmth to get them up. I'm cold to the bone, and I don't care.` : `I gave ${F.name} some of my warmth to get them up.`;
    else if (kind === 'carried') text = `${P} went down in ${where}, bleeding. I carried them to Mira's. I didn't stop once.`;
    else if (kind === 'flame') text = `${P} died. The flame Aveline kept for them brought them back at dawn. I don't know what to do with that.`;
    if (!text) return;
    safe(() => mind.remember(text, { importance: kind === 'flame' ? 9 : 7, about: [PLAYER_ID], tags: ['rescue', kind], emotion: kind === 'flame' ? 'fear' : 'relief' }));
    if (kind !== 'flame') safe(() => mind.relationships?.adjust?.(PLAYER_ID, { affinity: 2, familiarity: 3 }, 'I saved them'));
  }

  // Mira's bill: paid from the player's coin, the rest owed.
  bill(amount, why = 'tending', { quiet = false } = {}) {
    const P = this.game.player;
    const have = P?.inventory?.count?.('coin') ?? 0;
    const paid = Math.min(have, amount);
    if (paid > 0) P.inventory.remove('coin', paid);
    const owed = amount - paid;
    const flags = (this.game.flags ||= {});
    if (owed > 0) flags.miraOwed = (Number(flags.miraOwed) || 0) + owed;
    if (!quiet) {
      try {
        this.game.ui?.toast?.(`Mira: ${amount} coins for the ${why}.${owed > 0 ? ` You owe her ${owed}. "Pay when you can. Sorry."` : ''}`, 'info', { key: 'bill' });
      } catch {
        /* the UI is optional */
      }
    }
    return { paid, owed };
  }

  // ---------------------------------------------------------------- weakness

  addCondition(id) {
    const def = CONDITIONS[id];
    if (!def) return;
    const until = this.now() + def.seconds;
    const have = this.conditions.find((c) => c.id === id);
    if (have) have.until = Math.max(have.until, until);
    else this.conditions.push({ id, until });
    this.game.bus?.emit?.('condition', { id, label: def.label, until });
  }

  activeConditions() {
    const t = this.now();
    return this.conditions.filter((c) => c.until > t && CONDITIONS[c.id]);
  }

  // Multiplier on 'atk' | 'speed' for the player from weaknesses.
  mul(actor, stat) {
    if (!isPlayer(this, actor)) return 1;
    let k = 1;
    for (const c of this.activeConditions()) k *= CONDITIONS[c.id][stat] ?? 1;
    return k;
  }

  hpCap(actor) {
    if (!isPlayer(this, actor)) return 1;
    let cap = 1;
    for (const c of this.activeConditions()) cap = Math.min(cap, CONDITIONS[c.id].hpCap ?? 1);
    return cap;
  }

  // Timed modifiers in the §26 shape, for a stats pipeline to fold in.
  modifiers(actor) {
    if (!isPlayer(this, actor)) return [];
    return this.activeConditions().map((c) => ({ source: `survival:${c.id}`, label: CONDITIONS[c.id].label, until: c.until, mul: { atk: CONDITIONS[c.id].atk, speed: CONDITIONS[c.id].speed }, hpCap: CONDITIONS[c.id].hpCap }));
  }

  // ---------------------------------------------------------------- time

  // Real seconds (the world may be slowed): the slow-motion beat and the heart.
  realtime(dt) {
    const g = this.game;
    if (this.slowmo) {
      const s = this.slowmo;
      s.t += dt;
      const reduce = !!g.settings?.reduceMotion;
      const k = reduce ? 1 : s.t < SLOWMO_HOLD ? SLOWMO_SCALE : Math.min(1, SLOWMO_SCALE + ((s.t - SLOWMO_HOLD) / SLOWMO_RAMP) * (1 - SLOWMO_SCALE));
      g.timeScale = k;
      if (k >= 1) this.slowmo = null;
    } else if (g.timeScale !== 1 && g.timeScale != null && !this.falls.has(g.player)) g.timeScale = 1;
    const rec = this.falls.get(g.player);
    const h = this.heart;
    if (!rec) {
      h.pulse = Math.max(0, h.pulse - dt * 3);
      return;
    }
    const frac = Math.max(0, rec.left / rec.window);
    h.bpm = 44 + 66 * frac;
    const before = h.phase;
    h.phase += (dt * h.bpm) / 60;
    if (Math.floor(h.phase) !== Math.floor(before)) {
      h.beats++;
      h.pulse = 1;
      try {
        g.audio?.heartbeat?.(0.5 + 0.5 * (1 - frac));
      } catch {
        /* sound is optional */
      }
    } else h.pulse = Math.max(0, h.pulse - dt * 4);
  }

  update(dt) {
    const g = this.game;
    // Carried bodies follow their carriers.
    syncCarries(this, dt);
    for (const rec of [...this.falls.values()]) this.tickFall(rec, dt);
    // Rescuers a fight or a fright took away come back to the job once it is over.
    for (const [a, job] of this.jobs) {
      if (a.removed || a.dead || a.downed) {
        this.endJob(job);
        continue;
      }
      if (isVillager(a) && a.mode === 'routine') a.mode = 'rescue';
    }
    // Patients rest until they are well.
    if (this.patients.size) {
      const t = this.now();
      for (const [a, p] of [...this.patients]) {
        if (a.removed) {
          this.patients.delete(a);
          continue;
        }
        if (t >= p.until) releasePatient(this, a);
      }
    }
    // Weakness caps the player's health.
    const P = g.player;
    if (P && !P.downed && this.conditions.length) {
      const cap = this.hpCap(P);
      if (cap < 1 && P.hp > Math.ceil(P.maxHp * cap)) P.hp = Math.max(1, Math.ceil(P.maxHp * cap));
      const t = this.now();
      if (this.conditions.some((c) => c.until <= t)) this.conditions = this.conditions.filter((c) => c.until > t);
    }
  }

  tickFall(rec, dt) {
    const g = this.game;
    const F = rec.actor;
    if (F.removed || F.dead) {
      this.falls.delete(F);
      return;
    }
    if (!F.downed) {
      this.resolveFall(F, 'revived');
      return;
    }
    rec.t += dt;
    if (F.state !== 'downed' && !F.carriedBy) F.setState?.('downed');
    const player = isPlayer(this, F);
    rec.crawling = false;
    if (player && !F.carriedBy) this.crawl(rec, dt);
    if (player && !F.carriedBy) {
      try {
        if (g.input?.pressed?.('interact') && g.state === 'playing' && !g.paused) this.callForHelp(F);
      } catch {
        /* input is optional */
      }
    }
    if (rec.grave) return;
    let rate = RATE.alone;
    if (F.carriedBy) rate = RATE.carried;
    else if (rec.stanchers.size) rate = RATE.stanched;
    else if (rec.crawling) rate = RATE.crawling;
    if (rec.wet && !F.carriedBy) rate *= RATE.water;
    rec.left -= dt * rate;
    if (player) this.patrol(rec);
    else if (!isLyra(this, F) && rec.t >= rec.lyraAt) this.lyraForVillager(rec);
    if (rec.left <= 0) this.expire(rec);
  }

  crawl(rec, dt) {
    const g = this.game;
    const F = rec.actor;
    if (rec.crawled >= CRAWL_BUDGET || g.state !== 'playing' || g.paused) return;
    const modal = safe(() => g.ui?.isModalOpen?.(), false);
    if (modal || g.input?.enabled === false) return;
    const mv = safe(() => g.input?.moveVector?.());
    const mx = mv?.x || 0;
    const my = mv?.y || 0;
    const l = Math.hypot(mx, my);
    if (l < 0.2) return;
    const sp = CRAWL_SPEED * Math.min(1, l);
    const bx = F.x;
    const by = F.y;
    try {
      g.entities?.moveActor?.(F, (mx / l) * sp * dt, (my / l) * sp * dt);
    } catch {
      F.x += (mx / l) * sp * dt;
      F.y += (my / l) * sp * dt;
    }
    const moved = Math.hypot(F.x - bx, F.y - by);
    if (moved > 0.01) {
      rec.crawled += moved;
      rec.crawling = true;
      F.faceDir?.(Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 'left' : 'right') : my < 0 ? 'up' : 'down');
      if (Math.floor(rec.crawled / 6) !== Math.floor((rec.crawled - moved) / 6)) {
        try {
          g.particles?.emit?.('dust', F.x, F.y, { count: 1, speed: 8, life: 0.4 });
        } catch {
          /* cosmetic */
        }
      }
    }
  }

  // Nobody near: a patrol of the watch may come by, or not (§27). Inside the ward by day it
  // is likely; at night less so; far out in the wilds, never.
  patrol(rec) {
    if (rec.patrol?.pending && rec.t >= rec.patrol.at) {
      rec.patrol.pending = false;
      if (!rec.responders.size && !rec.carrier) this.patrolArrives(rec);
      return;
    }
    if (rec.patrol || rec.t < 8 || rec.responders.size) return;
    const g = this.game;
    const F = rec.actor;
    const loc = safe(() => g.locations?.at?.(F.x, F.y));
    const danger = loc?.danger ?? 2;
    const night = !!safe(() => g.clock?.isNight ?? g.clock?.phase === 'night', false);
    const chance = danger <= 1 ? (night ? 0.35 : 0.75) : danger === 2 && !night ? 0.2 : 0;
    const roll = this.rand();
    rec.patrol = { rolled: true, ok: roll < chance, at: rec.t + 10 + this.rand() * 12 };
    if (!rec.patrol.ok) return;
    rec.patrol.pending = true;
  }

  // A patrol that was going to come arrives at the edge of the view.
  patrolArrives(rec) {
    const g = this.game;
    const F = rec.actor;
    let guard = null;
    let bd = Infinity;
    for (const e of g.entities?.all?.() || []) {
      if (!isVillager(e) || !e.isGuard || !canRespond(this, e)) continue;
      const d = dist(e, F);
      if (d < bd) {
        bd = d;
        guard = e;
      }
    }
    if (!guard) return;
    if (bd > 420) {
      const ang = this.rand() * Math.PI * 2;
      const s = this.freeSpotNear(F.x + Math.cos(ang) * 200, F.y + Math.sin(ang) * 140) || this.freeSpotNear(F.x + 120, F.y);
      if (s) {
        guard.x = s.x;
        guard.y = s.y;
        safe(() => guard.leaveBed?.());
      }
    }
    this.assignJob(guard, rec, rec.wanted ? 'arrest' : 'carry', { forced: true });
    try {
      g.ui?.toast?.(`${guard.name || 'A patrol'} was walking the bounds and heard you.`, 'info', { key: 'patrol' });
    } catch {
      /* the UI is optional */
    }
  }

  // "She never leaves a living person to die when she could carry them" (LORE §7): a
  // villager lying alone near Lyra gets her, if nobody else has come.
  lyraForVillager(rec) {
    rec.lyraAt = rec.t + 6;
    const g = this.game;
    const lyra = g.companion;
    if (!lyra || !canRespond(this, lyra) || rec.carrier) return;
    const tending = [...(g.entities?.all?.() || [])].some((e) => isVillager(e) && e.mode === 'help' && e.help?.victim === rec.actor);
    if (tending) return;
    if (dist(lyra, rec.actor) > 320) return;
    // Not into the middle of a crime the player is committing.
    if (rec.by && isPlayer(this, rec.by)) return;
    this.assignJob(lyra, rec, 'lyra');
  }

  // The window closed.
  expire(rec) {
    const F = rec.actor;
    rec.left = 0;
    if (isPlayer(this, F)) {
      this.die(rec);
      return;
    }
    carriedOff(this, rec);
  }

  // The player's window closed: the kept flame, home (the soft setting), or the end.
  die(rec) {
    const g = this.game;
    const P = rec.actor;
    if (P.carriedBy) {
      const carrier = P.carriedBy;
      rec.carrierName = carrier.name;
      endCarry(this, carrier);
    }
    this.resolveFall(P, 'died');
    const mode = g.settings?.deathMode === 'home' ? 'home' : hasKeptFlame(g) ? 'flame' : 'final';
    rec.savedIds = [...this.saved];
    if (mode === 'home') return wakeHome(this, rec);
    if (mode === 'flame') return flameReturn(this, rec);
    return finalDeath(this, rec);
  }

  // ---------------------------------------------------------------- events

  onGameStart(p) {
    const g = this.game;
    // Anyone lying downed without a record (an older save) gets one now.
    for (const e of g.entities?.all?.() || []) {
      if (e.type !== 'actor' || !e.downed || e.dead || e.species || this.falls.has(e)) continue;
      if (isPlayer(this, e) || isLyra(this, e) || isVillager(e)) this.fall(e, { load: true });
    }
    // Calls already made are heard again.
    const rec = this.falls.get(g.player);
    if (rec && p?.loaded) this.alert(rec, CALL_RADIUS);
  }

  onPlayerWake() {
    // A night's sleep is longer than any short rest in a cot.
    for (const [a, p] of [...this.patients]) if (p.kind !== 'grave') releasePatient(this, a);
  }

  // Draw list for the renderer: everyone being carried, over their carrier's shoulders.
  drawables() {
    const out = this._drawables;
    out.length = 0;
    for (const c of this.carries.values()) out.push(c.drawable);
    return out;
  }

  // What the screen should look like right now (render/death_fx.js reads this).
  fxState() {
    const g = this.game;
    const rec = this.falls.get(g.player);
    if (!rec) return null;
    return { frac: Math.max(0, rec.left / rec.window), carried: !!g.player.carriedBy, pulse: this.heart.pulse, t: rec.t, wet: rec.wet };
  }

  // A real-time pause inside an outcome (the flame's moment on a black screen).
  wait(seconds) {
    if (this.fast || typeof setTimeout !== 'function') return Promise.resolve();
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  // ---------------------------------------------------------------- saving

  serialize() {
    const falls = [];
    for (const rec of this.falls.values()) {
      if (!rec.actor?.id) continue;
      falls.push({ id: rec.actor.id, window: Math.round(rec.window * 10) / 10, left: Math.round(rec.left * 10) / 10, t: Math.round(rec.t * 10) / 10, cause: rec.cause, wanted: rec.wanted || undefined, crawled: Math.round(rec.crawled), wet: rec.wet || undefined, grave: rec.grave || undefined });
    }
    const patients = [];
    for (const [a, p] of this.patients) if (a?.id && p.bed?.id) patients.push({ id: a.id, bed: p.bed.id, until: Math.round(p.until), kind: p.kind, savedBy: p.savedBy || undefined });
    return { falls, patients, conditions: this.conditions.map((c) => ({ id: c.id, until: Math.round(c.until) })), saved: this.saved.slice(-40) };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const g = this.game;
    this.conditions = Array.isArray(d.conditions) ? d.conditions.filter((c) => CONDITIONS[c?.id] && Number.isFinite(c.until)).map((c) => ({ id: c.id, until: c.until })) : [];
    this.saved = Array.isArray(d.saved) ? d.saved.filter((x) => typeof x === 'string') : [];
    for (const f of Array.isArray(d.falls) ? d.falls : []) {
      const a = g.entities?.get?.(f.id);
      if (!a || !a.downed) continue;
      this.falls.delete(a);
      const rec = this.fall(a, { window: f.window, left: f.left, t: f.t, cause: f.cause, wanted: f.wanted, crawled: f.crawled, wet: false, grave: f.grave, load: true });
      if (rec) rec.wet = !!f.wet;
    }
    for (const p of Array.isArray(d.patients) ? d.patients : []) {
      const a = g.entities?.get?.(p.id);
      const bed = safe(() => g.objects?.get?.(p.bed));
      if (!a || !bed) continue;
      a.downed = false;
      if (!(a.hp > 0)) a.hp = Math.max(1, Math.round(a.maxHp * 0.25));
      admitPatient(this, a, bed, { seconds: Math.max(1, (Number(p.until) || 0) - this.now()), kind: p.kind || 'recover', savedBy: p.savedBy || null });
    }
  }
}
