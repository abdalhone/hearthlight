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
  NPC_CRAWL,
  SMEAR_EVERY,
  HEART_BPM,
  REVIVE_SECONDS,
  LIFT_SECONDS,
  LAY_SECONDS,
} from './constants.js';
import { CALL_LINES, LYRA_CARRIED, LYRA_POTION, lyraTone, pickLine } from './lines.js';
import { stepJob, newJob, canRespond, roleFor, countRoles, isLyra, isPlayer, isVillager, speak, lineFor, stopFeet, nearestCarrier, knowsWantedFallen } from './rescue.js';
import { startCarry, endCarry, syncCarries } from './carry.js';
import { tendPlayer, wakeHome, flameReturn, finalDeath, admitPatient, releasePatient, carriedOff } from './outcomes.js';
import { hasKeptFlame } from './kept_flame.js';
import { placeName, placePhrase } from './epitaph.js';
import { BloodTrail } from './trail.js';
import { EmberRing } from './ember_ring.js';
import { hears } from '../ai/hearing.js';
import { ensureCrawl } from '../art/characters_art.js';
import { CRAWL_STEP, CRAWL_ANIM } from '../art/characters_humanoid.js';

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
//   survival.ring                      the ember-ring the player's coins lie in (or null)
//   survival.mapMarks()                [{ kind: 'ember_ring', x, y, label, color }] for maps
//   events: fallen, fall_call, rescuer_coming, carried, set_down, delivered, patient,
//           fall_resolved, player_tended, player_died {mode, ring}, life_closed, flame_returned,
//           ember_ring {coins, lost}, ember_ring_taken {coins}, ember_ring_lost {coins, why}

const PLAYER_ID = 'player';

// Water underfoot, fords included (map.isWet; older maps only know deep water).
function wetAt(g, tx, ty) {
  const m = g.map;
  return !!(m?.isWet ? m.isWet(tx, ty) : m?.isWater?.(tx, ty));
}

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
    this.trail = new BloodTrail(game); // blood where people fall and drag themselves (§27)
    this.ring = null; // the ember-ring the player's coins lie in since they last died (§27)
    this._ringN = 0;
    // What Lyra's mind is told while someone lies bleeding (her prompt, through a plugin).
    try {
      game.plugins?.register?.({ id: 'survival', name: 'Someone fell', description: 'Falls, rescues and the sickroom (DESIGN §27)', promptContext: () => this.promptContext() });
    } catch {
      /* plugins are optional */
    }
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
      if (wetAt(g, tx, ty)) return true;
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
    // The watch takes someone wanted to the cell; Lyra and the rest take them to Mira's.
    if (job?.role === 'arrest' || (rec?.wanted && job?.rescuer?.isGuard && knowsWantedFallen(this, job.rescuer, rec))) bed = safe(() => g.objects?.get?.(CELL_BED));
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
      where: placePhrase(g, actor.x, actor.y),
      lyraAt: (opts.t || 0) + 9,
    };
    // Falling into water: the body is pulled to the nearest bank, cold and soaked.
    if (safe(() => wetAt(g, Math.floor(actor.x / TILE), Math.floor(actor.y / TILE)), false) || opts.wet) {
      rec.wet = true;
      const s = this.freeSpotNear(actor.x, actor.y);
      if (s) {
        actor.x = s.x;
        actor.y = s.y;
      }
    }
    rec.fellAt = { x: actor.x, y: actor.y }; // where they went down (a carry may move them on)
    this.falls.set(actor, rec);
    // The crawl is painted the first time this body needs it (off the boot path), and the
    // blood starts where they went down.
    if (!actor.species) safe(() => ensureCrawl(g.atlas, actor.spriteKey || actor.id));
    actor.crawlPose = null;
    if (!opts.load && !rec.wet) safe(() => this.trail.pool(actor.x, actor.y - 3, 1));
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
    if (isPlayer(this, e) && !this._quiet) {
      this.addCondition('bruised');
      try {
        this.game.ui?.toast?.(`Back on your feet${p.by && p.by !== e ? `, thanks to ${p.by.name || 'someone'}` : ''}. Bruised: weaker for a few minutes.`, 'warn', { key: 'wake', title: 'Bruised' });
      } catch {
        /* the UI is optional */
      }
    }
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
    actor.crawlPose = null;
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
    // She holds back from the one she just fought down (DESIGN §16.6): she sends for Mira
    // and the watch instead, and comes herself only if nobody does (behavior relents).
    if (lyra && canRespond(this, lyra) && !safe(() => !!lyra.behavior?.holdsBackFrom?.(F), false)) {
      const cs = companionshipOf(lyra);
      const apart = cs === 'left' || cs === 'gone';
      const ears = apart ? LYRA_HEARS_APART : LYRA_HEARS;
      const d = Math.min(dist(lyra, F), Math.hypot(lyra.x - ox, lyra.y - oy));
      // Cut off, only her ears tell her: walls muffle a shout (DESIGN §29.4).
      const heard = !apart || sight || !!safe(() => hears(g, lyra, ox, oy, Math.max(ears, radius)), true);
      if (forced || (d <= Math.max(ears, radius) && heard)) this.assignJob(lyra, rec, 'lyra');
    }
    const counts = countRoles(this, rec);
    const list = [];
    for (const e of g.entities?.all?.() || []) {
      if (!isVillager(e) || !canRespond(this, e)) continue;
      const d = Math.hypot(e.x - ox, e.y - oy);
      let reach = radius * (e.state === 'sleep' ? ASLEEP_EAR : 1);
      // The watch looking for a stranger they KNOW is wanted (round 14b, per knower) finds
      // them from far off; a guard who knows nothing of it hears a shout like anyone.
      const hunting = rec.wanted && e.isGuard && knowsWantedFallen(this, e, rec);
      if (hunting) reach = Math.max(reach, GUARD_HEARS_WANTED);
      if (!forced && d > reach) continue;
      if (sight && !hunting && typeof e.canSee === 'function' && !e.canSee(F)) continue;
      // A shout is heard by the one rule for ears (DESIGN §29.4): a wall muffles it hard.
      if (!forced && !sight && !hunting && !safe(() => hears(g, e, ox, oy, radius), true)) continue;
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
        g.audio?.play?.('heal', { x: target.x, y: target.y });
        // (pixelfx plays the revival on the 'revived' event; the old shimmer only without it)
        if (!g.pixelFx?.has?.('heal')) g.particles?.emit?.('heal', target.x, target.y - 8, { count: 10, color: '#9ff0b8', speed: 24, life: 0.8 });
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
    // A body on your shoulders (DESIGN §29): hidden, or laid down; never a sickroom cot.
    if (c.carried?.dead) return !!this.game.murder?.carrierInteract?.(player) || (endCarry(this, player), true);
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
    // Fallen: the fall's own panel has the Call for help button (E and H call too).
    if (this.falls.has(player)) return '';
    const c = this.carries.get(player);
    if (!c) return null;
    if (c.carried?.dead) return this.game.murder?.promptFor?.(player) ?? 'Put them down';
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
      this.rescuedBy(carrier, rec);
      tendPlayer(this, carrier, bed, { arrested: job?.role === 'arrest' || (!!rec?.wanted && !!carrier.isGuard && knowsWantedFallen(this, carrier, rec)) });
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

  // Someone carried the player in: Lyra remembers it (hers, or someone else's), the one who
  // did it thinks a little more of the stranger they saved, and the village talks.
  rescuedBy(carrier, rec) {
    const g = this.game;
    if (!carrier) return;
    if (isLyra(this, carrier)) {
      this.lyraRemembers(g.player, 'carried');
      return;
    }
    if (isVillager(carrier)) {
      safe(() => carrier.adjustOpinion?.(3, 'carried them in'));
      carrier.familiarity = Math.min(100, (carrier.familiarity || 0) + 6);
      safe(() => g.village?.addRumor?.('rescued_stranger', { victim: carrier.id, witnesses: [carrier.id, 'mira', ...(g.village?.witnessesNear?.(carrier.x, carrier.y) || [])], source: carrier.id }));
      const lyra = g.companion;
      if (rec?.lyraCame && lyra?.mind) {
        const P = g.player?.name && g.player.name !== 'Traveler' ? g.player.name : 'the stranger';
        safe(() => lyra.mind.remember(`${P} went down ${rec.where}, bleeding. ${carrier.name} carried them to Mira's and I walked beside them the whole way.`, { importance: 7, about: [PLAYER_ID, carrier.id], tags: ['rescue'], emotion: 'fear' }));
      }
    }
  }

  // The magic runtime's hook (§22): a healing weave on someone lying downed revives them.
  reviveWith(target, by, how = 'weave', frac = 0.35) {
    if (!target?.downed) return false;
    this.reviveFall(target, by, frac);
    this.game.bus?.emit?.('revived_with', { entity: target, by, how });
    return true;
  }

  // Lyra's memory of a rescue she did.
  lyraRemembers(F, kind) {
    const lyra = this.game.companion;
    const mind = lyra?.mind;
    if (!mind) return;
    const named = this.game.player?.name && this.game.player.name !== 'Traveler' ? this.game.player.name : null;
    const P = named || 'The stranger';
    const where = this.falls.get(F)?.where || placePhrase(this.game, F.x, F.y);
    let text = '';
    if (kind === 'warmth') text = isPlayer(this, F) ? `${P} went down ${where}. I gave them my warmth to get them up. I'm cold to the bone, and I don't care.` : `I gave ${F.name} some of my warmth to get them up.`;
    else if (kind === 'carried') text = `${P} went down ${where}, bleeding. I carried them to Mira's. I didn't stop once.`;
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
    if (this.game.stats?.foldsSurvival) return 1; // the stat pipeline folds weakness in (§26)
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
    return this.activeConditions().map((c) => ({ source: `survival:${c.id}`, label: CONDITIONS[c.id].label, until: c.until, seconds: CONDITIONS[c.id].seconds, mul: { atk: CONDITIONS[c.id].atk, speed: CONDITIONS[c.id].speed }, hpCap: CONDITIONS[c.id].hpCap }));
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
    // The heart races as the window closes, then falters: beats come unevenly and weaker,
    // some do not come at all.
    const frac = Math.max(0, rec.left / rec.window);
    const falter = frac < HEART_BPM.falter ? 1 - frac / HEART_BPM.falter : 0;
    h.bpm = HEART_BPM.start + (HEART_BPM.end - HEART_BPM.start) * (1 - frac) - 40 * falter;
    h.falter = falter;
    const before = h.phase;
    h.phase += (dt * h.bpm) / 60;
    if (Math.floor(h.phase) !== Math.floor(before)) {
      const skip = falter > 0 && this.rand() < 0.3 * falter;
      if (!skip) {
        h.beats++;
        h.pulse = 1 - 0.45 * falter;
        try {
          g.audio?.heartbeat?.((0.5 + 0.5 * (1 - frac)) * (1 - 0.5 * falter), h.bpm);
        } catch {
          /* sound is optional */
        }
      }
      // A faltering heart does not keep time.
      if (falter > 0) h.phase += (this.rand() - 0.5) * 0.35 * falter;
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
        else this.holdPatient(a, p); // nothing nudges them out of the cot (a swing, a crowd)
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
      F.crawlPose = null;
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
    if (F.carriedBy) F.crawlPose = null;
    else if (player) this.crawl(rec, dt);
    else this.crawlAway(rec, dt);
    if (player && !F.carriedBy) {
      try {
        if (g.input?.pressed?.('interact') && g.state === 'playing' && !g.paused) this.callForHelp(F);
      } catch {
        /* input is optional */
      }
    }
    if (rec.grave) return;
    rec.left -= dt * this.rateOf(rec);
    if (player) {
      // Whoever walks by and sees you lying there comes, call or no call.
      rec.lookT = (rec.lookT ?? 1) - dt;
      if (rec.lookT <= 0 && !F.carriedBy) {
        rec.lookT = 1;
        this.alert(rec, SEE_RADIUS, { sight: true });
      }
      this.patrol(rec);
    }
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
    this.drag(rec, mx / l, my / l, CRAWL_SPEED * Math.min(1, l), dt);
  }

  // Drag a fallen body along the ground by (ux, uy) at `speed` px/s: the crawl frame
  // follows the distance (so the hands never slide), and blood smears behind it.
  drag(rec, ux, uy, speed, dt) {
    const g = this.game;
    const F = rec.actor;
    const room = Math.max(0, CRAWL_BUDGET - rec.crawled);
    const step = Math.min(room, speed * dt);
    if (step <= 0) return 0;
    const bx = F.x;
    const by = F.y;
    try {
      g.entities?.moveActor?.(F, ux * step, uy * step);
    } catch {
      F.x += ux * step;
      F.y += uy * step;
    }
    const moved = Math.hypot(F.x - bx, F.y - by);
    if (moved <= 0.01) return 0;
    const before = rec.crawled;
    rec.crawled += moved;
    rec.crawling = true;
    const dir = Math.abs(ux) > Math.abs(uy) ? (ux < 0 ? 'left' : 'right') : uy < 0 ? 'up' : 'down';
    F.faceDir?.(dir);
    F.crawlPose = { frame: Math.floor(rec.crawled / CRAWL_STEP) % CRAWL_ANIM.frames };
    // A smear every few pixels, from the middle of the body (it is left behind as they go).
    if (Math.floor(rec.crawled / SMEAR_EVERY) !== Math.floor(before / SMEAR_EVERY)) {
      const off = dir === 'left' || dir === 'right' ? 6 : dir === 'up' ? 9 : 4;
      safe(() => this.trail.smear(F.x - ux * 2, F.y - off, ux, uy));
    }
    if (Math.floor(rec.crawled / 6) !== Math.floor(before / 6)) {
      try {
        g.particles?.emit?.('dust', F.x, F.y, { count: 1, speed: 8, life: 0.4 });
      } catch {
        /* cosmetic */
      }
    }
    return moved;
  }

  // Villagers and Lyra on the ground drag themselves away from whoever is still standing
  // over them (the one who put them down first), a little, while nobody kneels with them.
  crawlAway(rec, dt) {
    const F = rec.actor;
    if (rec.crawled >= CRAWL_BUDGET || rec.grave || rec.stanchers.size) return;
    rec.threatT = (rec.threatT ?? 0) - dt;
    if (rec.threatT <= 0) {
      rec.threatT = 0.4;
      const by = rec.by && !rec.by.removed && !rec.by.dead && !rec.by.downed && rec.by.type === 'actor' ? rec.by : null;
      rec.threat = by && dist(by, F) < DANGER_RADIUS ? by : this.dangerNear(F, F);
    }
    const T = rec.threat;
    if (!T || T.removed || T.downed || dist(T, F) > DANGER_RADIUS) return;
    let ux = F.x - T.x;
    let uy = F.y - T.y;
    const d = Math.hypot(ux, uy) || 1;
    ux /= d;
    uy /= d;
    const speed = CRAWL_SPEED * NPC_CRAWL;
    if (this.drag(rec, ux, uy, speed, dt) > 0) return;
    // Pinned against a wall: try along it.
    if (this.drag(rec, -uy, ux, speed, dt) > 0) return;
    this.drag(rec, uy, -ux, speed, dt);
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
    this.assignJob(guard, rec, rec.wanted && knowsWantedFallen(this, guard, rec) ? 'arrest' : 'carry', { forced: true });
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

  // The player's window closed: the last stand if it is held (§25), else the kept flame,
  // home (the soft setting), or the end.
  die(rec) {
    const g = this.game;
    const P = rec.actor;
    if (P.carriedBy) {
      const carrier = P.carriedBy;
      rec.carrierName = carrier.name;
      endCarry(this, carrier);
    }
    if (safe(() => g.prices?.lastStandArmed?.(), false) && this.riseInstead(P, 'death')) return null;
    this.resolveFall(P, 'died');
    const mode = g.settings?.deathMode === 'home' ? 'home' : hasKeptFlame(g) ? 'flame' : 'final';
    rec.savedIds = [...this.saved];
    // Coming back costs everything you carried: the coins stay here, in the embers.
    if (mode !== 'final') rec.ring = this.dropRing(P, rec);
    if (mode === 'home') return wakeHome(this, rec);
    if (mode === 'flame') return flameReturn(this, rec);
    return finalDeath(this, rec);
  }

  // ---------------------------------------------------------------- the last stand

  // Rise from the ground burning (§25 laststand): when the window closes with it held, or
  // when the player chooses it while down (the countdown's Rise button).
  riseInstead(P = this.game.player, how = 'chosen') {
    const g = this.game;
    if (!P || !safe(() => g.prices?.lastStandArmed?.(), false)) return false;
    if (P.carriedBy) endCarry(this, P.carriedBy);
    const ok = !!safe(() => g.prices.riseLastStand(P, how), false);
    if (ok && this.falls.has(P)) this.resolveFall(P, 'laststand');
    if (ok) {
      // Whoever was on their way sees them get up, and burn.
      const lyra = g.companion;
      if (lyra && !lyra.downed && dist(lyra, P) < 260) speak(this, lyra, 'What did you do? Your eyes—', 'shout');
    }
    return ok;
  }

  // The minute is over: the story ends, whatever flame burns and whatever was chosen in
  // Settings. The memorial says how.
  burnOut(P = this.game.player) {
    const g = this.game;
    if (!P || g.state === 'dead') return null;
    if (this.falls.has(P)) this.resolveFall(P, 'died');
    if (P.carriedBy) endCarry(this, P.carriedBy);
    P.hp = 0;
    P.downed = true;
    P.setState?.('downed');
    safe(() => g.particles?.emit?.('smoke', P.x, P.y - 8, { count: 8 }));
    safe(() => g.particles?.emit?.('ember', P.x, P.y - 6, { count: 12 }));
    const rec = {
      actor: P,
      kind: 'player',
      window: 1,
      left: 0,
      t: 0,
      cause: 'laststand',
      by: null,
      crawled: 0,
      responders: new Set(),
      stanchers: new Set(),
      anyoneCame: false,
      place: placeName(g, P.x, P.y),
      where: placePhrase(g, P.x, P.y),
      savedIds: [...this.saved],
      lyraCame: !!g.companion && !g.companion.downed && dist(g.companion, P) < 260,
    };
    return finalDeath(this, rec);
  }

  // ---------------------------------------------------------------- the ember-ring

  // Death takes everything you carry (§27, round 14): every coin stays where you fell, in a
  // ring of embers you can walk back to; a ring you never went back for goes out, its
  // coins with it. -> { coins, lost, where }
  dropRing(P, rec = null) {
    const g = this.game;
    const lost = this.ring && !this.ring.taken ? this.ring.coins : 0;
    if (this.ring) this.putOutRing('died again');
    const coins = Math.max(0, Math.floor(P?.inventory?.count?.('coin') ?? 0));
    if (coins <= 0) return { coins: 0, lost, where: '' };
    P.inventory.remove('coin', coins);
    const spot = this.freeSpotNear(P.x, P.y) || { x: P.x, y: P.y };
    // The ring lies where the body was when it died. Carried part of the way (and died in
    // someone's arms), that is not where they fell: name the place it really is.
    const fell = rec?.fellAt;
    const moved = !!fell && Math.hypot(spot.x - fell.x, spot.y - fell.y) > 6 * TILE;
    const where = !moved && rec?.where ? rec.where : placePhrase(g, spot.x, spot.y);
    const place = !moved && rec?.place ? rec.place : placeName(g, spot.x, spot.y);
    this.placeRing({ x: spot.x, y: spot.y, coins, day: g.clock?.day ?? 1, where, place });
    g.bus?.emit?.('ember_ring', { coins, lost, x: spot.x, y: spot.y, where, moved });
    return { coins, lost, where, moved };
  }

  placeRing(o) {
    const g = this.game;
    const ring = new EmberRing(g, o);
    ring.id = `ember_ring_${++this._ringN}`; // a fresh id: the last one may not be swept up yet
    this.ring = g.entities?.add ? g.entities.add(ring) : ring;
    return this.ring;
  }

  // The ring goes out: the coins in it are gone for good.
  putOutRing(why = 'died again') {
    const r = this.ring;
    if (!r) return 0;
    this.ring = null;
    r.taken = true;
    safe(() => this.game.entities?.remove?.(r));
    this.game.bus?.emit?.('ember_ring_lost', { coins: r.coins, why });
    return r.coins;
  }

  // The player walked back and took it (the ring's interact; E or the hand button).
  takeRing(actor = this.game.player) {
    const g = this.game;
    const r = this.ring;
    if (!r || r.taken || !actor || actor !== g.player || actor.downed || actor.dead) return false;
    if (Math.hypot(actor.x - r.x, actor.y - r.y) > 48) return false;
    r.taken = true;
    this.ring = null;
    actor.inventory?.add?.('coin', r.coins);
    safe(() => g.entities?.remove?.(r));
    safe(() => g.audio?.play?.('coin', { x: r.x, y: r.y, volume: 0.9 }));
    safe(() => g.particles?.emit?.('levelup', r.x, r.y - 4, { count: 18, color: '#ffb047', speed: 40, life: 0.9 }));
    safe(() => g.lighting?.flash?.({ x: r.x, y: r.y - 4, r: 70, color: '#ffb047', intensity: 0.9, duration: 0.6 }));
    actor.setState?.('work', 0.35);
    safe(() => g.ui?.toast?.(`You take back your ${r.coins} ${r.coins === 1 ? 'coin' : 'coins'} from the embers.`, 'info', { key: 'ring', title: 'Recovered' }));
    g.bus?.emit?.('ember_ring_taken', { coins: r.coins, x: r.x, y: r.y });
    if (g.save) g.save.pending = g.save.pending || 'auto';
    return true;
  }

  // For a map or a compass: where the ring is.
  mapMarks() {
    const r = this.ring;
    if (!r || r.taken) return [];
    return [{ kind: 'ember_ring', x: r.x, y: r.y, label: `Your ${r.coins} ${r.coins === 1 ? 'coin' : 'coins'}`, color: '#ff8a3a', coins: r.coins, where: r.where }];
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

  promptContext() {
    const g = this.game;
    const P = g.player;
    const L = g.companion;
    const out = [];
    const name = P?.name && P.name !== 'Traveler' ? P.name : 'The stranger';
    const rec = P && this.falls.get(P);
    if (rec) {
      const who = rec.carrier ? ` ${rec.carrier === L ? 'You are' : `${rec.carrier.name} is`} carrying them to Mira's.` : '';
      out.push(`${name} is lying on the ground ${rec.where}, bleeding out: about ${Math.max(0, Math.ceil(rec.left))} seconds before they die.${who}${hasKeptFlame(g) ? ' A kept flame burns for them at the chapel.' : ' No flame is kept for them: if they die, they are gone.'}`);
    }
    const mine = L && this.patients.get(L);
    if (mine) out.push(`You are lying in a cot at Mira's, mending${mine.savedBy === PLAYER_ID ? `; ${name.toLowerCase() === 'the stranger' ? 'the stranger' : name} carried you here` : ''}.`);
    if (this.ring && !this.ring.taken) out.push(`Everything ${name === 'The stranger' ? 'the stranger' : name} carried in coin (${this.ring.coins}) still lies where they died, ${this.ring.where}, in a ring of embers; they can walk back for it, but if they die first it is gone.`);
    const weak = this.activeConditions().map((c) => CONDITIONS[c.id].label.toLowerCase());
    if (weak.length && !rec) out.push(`${name} is ${weak.join(' and ')} after a bad fall.`);
    return out.join(' ');
  }

  // Draw list for the renderer: everyone being carried, over their carrier's shoulders.
  drawables() {
    const out = this._drawables;
    out.length = 0;
    if (this.trail.marks.length) out.push(this.trail);
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

  // The countdown's numbers (ui/death_view.js): seconds left, how fast they drain now,
  // and who is helping with how far along it is.
  //   { left, window, frac, rate, help: null | { kind: 'carry'|'lay'|'salve'|'warmth'|'lift'|'stanch',
  //     who, progress 0..1, eta (s, carrying only), to ('sickroom'|'chapel'|'cell') } }
  countdown(actor = this.game.player) {
    const rec = this.falls.get(actor);
    if (!rec) return null;
    const out = { left: Math.max(0, rec.left), window: rec.window, frac: Math.max(0, rec.left / rec.window), rate: this.rateOf(rec), crawling: rec.crawling, help: null };
    const carrier = actor.carriedBy;
    if (carrier) {
      const job = this.jobs.get(carrier);
      const d = job?.dest;
      const id = d?.bed?.id || '';
      const to = id === 'cell_cot' ? 'cell' : id === 'infirmary_cot' ? 'chapel' : 'sickroom';
      if (job?.phase === 'lay') return { ...out, help: { kind: 'lay', who: carrier, progress: Math.min(1, job.t / LAY_SECONDS), eta: Math.max(0, LAY_SECONDS - job.t), to } };
      let progress = 0;
      let eta = null;
      if (d) {
        const left = Math.hypot(d.x - carrier.x, d.y - carrier.y) * 1.15; // roads bend
        if (!(job.total > 0) || left > job.total) job.total = left;
        progress = job.total > 0 ? Math.max(0, Math.min(1, 1 - left / job.total)) : 0;
        const v = (carrier.speed || 50) * CARRY_SPEED * this.carryBonus(carrier);
        eta = v > 0 ? left / v + LAY_SECONDS : null;
      }
      return { ...out, help: { kind: 'carry', who: carrier, progress, eta, to } };
    }
    let best = null;
    for (const a of rec.responders) {
      const j = this.jobs.get(a);
      if (!j) continue;
      if (j.phase === 'kneel' && (j.mode === 'salve' || j.mode === 'warmth')) {
        best = { kind: j.mode, who: a, progress: Math.min(1, j.t / REVIVE_SECONDS) };
        break;
      }
      if (j.phase === 'lift') best = { kind: 'lift', who: a, progress: Math.min(1, j.t / LIFT_SECONDS) };
      else if (j.phase === 'kneel' && !best) best = { kind: 'stanch', who: a, progress: 0 };
    }
    out.help = best;
    return out;
  }

  // How fast the window drains right now (1 = a second a second).
  rateOf(rec) {
    const F = rec.actor;
    let rate = RATE.alone;
    if (F.carriedBy) rate = RATE.carried;
    else if (rec.stanchers.size) rate = RATE.stanched;
    else if (rec.crawling) rate = RATE.crawling;
    if (rec.wet && !F.carriedBy) rate *= RATE.water;
    return rate;
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
    return { falls, patients, conditions: this.conditions.map((c) => ({ id: c.id, until: Math.round(c.until) })), saved: this.saved.slice(-40), ring: this.ring && !this.ring.taken ? this.ring.serialize() : undefined };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const g = this.game;
    this.conditions = Array.isArray(d.conditions) ? d.conditions.filter((c) => CONDITIONS[c?.id] && Number.isFinite(c.until)).map((c) => ({ id: c.id, until: c.until })) : [];
    this.saved = Array.isArray(d.saved) ? d.saved.filter((x) => typeof x === 'string') : [];
    if (this.ring) {
      this.ring.taken = true;
      safe(() => g.entities?.remove?.(this.ring));
      this.ring = null;
    }
    const r = d.ring;
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number(r.coins) > 0) this.placeRing({ x: r.x, y: r.y, coins: Number(r.coins), day: r.day, where: String(r.where || ''), place: String(r.place || '') });
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
