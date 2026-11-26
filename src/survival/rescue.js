import { Walker } from '../entities/npc_walker.js';
import { TILE } from '../core/constants.js';
import {
  ARRIVE_DIST,
  REVIVE_SECONDS,
  LIFT_SECONDS,
  LAY_SECONDS,
  RUN,
  CARRY_SPEED,
  STUCK_TELEPORT,
  FIGHTERS,
  REVIVERS,
  CARRIERS,
  TENDERS,
  FETCHERS,
  MAX_ROLE,
  WARMTH_HP,
  WARMTH_COST,
  SALVE_HP,
  MIRA_SALVE,
} from './constants.js';
import { LYRA_LINES, VILLAGER_LINES, TENDER_SHOUTS, lyraTone, pickLine, fillName } from './lines.js';

// Rescue duty (DESIGN §27): one job per rescuer. A rescuer runs to the fallen from wherever
// they are (their own feet: Lyra's steering, a villager's walker), fights or keeps clear
// of whatever is still there, then revives on the spot (Mira's salve, Lyra's warmth),
// kneels and presses on the wound and shouts for help, or lifts them and carries them to a
// place of healing. Children run for someone who can carry.
//
// job = { rescuer, fall, role: 'lyra'|'revive'|'carry'|'tend'|'fetch'|'arrest',
//         phase: 'go'|'kneel'|'lift'|'carry'|'lay'|'escort'|'fetch', t, mode, dest,
//         target, lineT, stuckT, walker }

export function isLyra(sv, a) {
  return !!a && (a === sv.game.companion || a.id === 'lyra');
}

export function isPlayer(sv, a) {
  return !!a && (a === sv.game.player || a.id === 'player');
}

export function isVillager(a) {
  return !!a && !!a.profile && !a.species;
}

function rand(sv) {
  const r = sv.game.rng;
  return r && typeof r.next === 'function' ? r.next() : Math.random();
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Someone who could answer a call right now.
export function canRespond(sv, a) {
  if (!a || a.removed || a.dead || a.downed || !(a.hp > 0)) return false;
  if (sv.jobs.has(a) || sv.patients.has(a) || a.carrying || a.carriedBy) return false;
  if (sv.falls.has(a)) return false;
  if (isVillager(a)) {
    const m = a.mode;
    if (m === 'downed' || m === 'patient' || m === 'rescue') return false;
  }
  return true;
}

// The part a villager plays for this fall, or null.
// Does this villager know the fallen player is wanted (round 14b, per knower: DESIGN
// §35.2)? Only one who knows comes to arrest; the rest come to help as for anyone.
export function knowsWantedFallen(sv, npc, rec) {
  if (!rec?.wanted) return false;
  if (typeof npc?.knowsWanted !== 'function') return true;
  try {
    return !!npc.knowsWanted(rec.actor);
  } catch {
    return true;
  }
}

export function roleFor(sv, npc, rec, counts) {
  const id = npc.profile?.id || npc.id;
  const full = (role) => (counts?.[role] || 0) >= (MAX_ROLE[role] ?? 1);
  if (rec.wanted && knowsWantedFallen(sv, npc, rec)) {
    if (npc.isGuard) return full('carry') ? null : 'arrest';
    if (FETCHERS.has(id) && !full('fetch')) return 'fetch';
    return null;
  }
  if (REVIVERS.has(id) && !full('revive')) return 'revive';
  if (CARRIERS.has(id) || npc.isGuard) {
    if (!full('carry')) return 'carry';
    return full('tend') ? null : 'tend';
  }
  if (FETCHERS.has(id)) return full('fetch') ? null : 'fetch';
  if (TENDERS.has(id) || REVIVERS.has(id)) return full('tend') ? null : 'tend';
  return full('tend') ? null : 'tend';
}

export function countRoles(sv, rec) {
  const c = {};
  for (const a of rec.responders) {
    const j = sv.jobs.get(a);
    if (!j) continue;
    const r = j.role === 'arrest' ? 'carry' : j.role;
    c[r] = (c[r] || 0) + 1;
  }
  return c;
}

// Lyra can lend her warmth (LORE §2, lumencraft): only while she has warmth to spare, the
// fall is not past saving on the spot, and she has not cut them out of her life.
export function canLendWarmth(sv, lyra, rec) {
  if (!rec || rec.cause === 'berserk' || rec.wet || rec.grave) return false;
  if (!(lyra.maxHp > 0) || lyra.hp / lyra.maxHp < 0.45) return false;
  if (rec.left < rec.window * 0.35) return false;
  return lyraTone(lyra) !== 'cold';
}

// ---------------------------------------------------------------- speech

export function speak(sv, a, text, kind = 'say') {
  if (!a || !text) return false;
  const g = sv.game;
  const t = fillName(text, nameForSpeaker(sv, a));
  try {
    if (isLyra(sv, a) && a.behavior?.say) return a.behavior.say(t, { force: true, kind });
    if (typeof a.say === 'function' && !isPlayer(sv, a)) {
      a.say(t, { kind });
      return true;
    }
    g.bubbles?.say?.(a, t, { kind });
    g.bus?.emit?.('speech', { speaker: a, text: t, target: null, kind });
    return true;
  } catch {
    return false;
  }
}

function nameForSpeaker(sv, a) {
  const P = sv.game.player;
  if (!P) return 'you';
  return P.name && P.name !== 'Traveler' ? P.name : isLyra(sv, a) ? 'Hey' : 'stranger';
}

export function lineFor(sv, a, kind) {
  if (isLyra(sv, a)) {
    const tone = lyraTone(a);
    return pickLine(LYRA_LINES[tone]?.[kind] || LYRA_LINES.steady[kind], sv.game.rng);
  }
  const id = a.profile?.id || a.id;
  const own = VILLAGER_LINES[id];
  if (own?.[kind]) return pickLine(own[kind], sv.game.rng);
  if (kind === 'tend' || kind === 'shout') return pickLine(TENDER_SHOUTS, sv.game.rng);
  return '';
}

// ---------------------------------------------------------------- feet

function walkerFor(sv, job) {
  const a = job.rescuer;
  if (a.walker instanceof Walker) return a.walker;
  if (!job.walker) job.walker = new Walker(sv.game, a, { doors: true, arriveDist: 3 });
  return job.walker;
}

export function stopFeet(sv, job) {
  const a = job.rescuer;
  if (a.moveIntent) {
    a.moveIntent.x = 0;
    a.moveIntent.y = 0;
  }
  try {
    if (isLyra(sv, a)) a.behavior?.steering?.stop?.();
    else (a.walker instanceof Walker ? a.walker : job.walker)?.stop?.();
  } catch {
    /* feet are best effort */
  }
  a.speedMul = 1;
}

// Walk toward (x, y). 'arrived' when within `arrive` px.
export function moveToward(sv, job, x, y, dt, run, arrive) {
  const a = job.rescuer;
  if (Math.hypot(x - a.x, y - a.y) <= arrive) {
    stopFeet(sv, job);
    job.stuckT = 0;
    return 'arrived';
  }
  let res = 'moving';
  const steer = isLyra(sv, a) ? a.behavior?.steering : null;
  try {
    if (steer?.moveTo) {
      res = steer.moveTo(x, y, dt, { arrive, run, slow: false });
    } else {
      const w = walkerFor(sv, job);
      if (!w.goal || Math.hypot(w.goal.x - x, w.goal.y - y) > 6) w.goTo(x, y);
      a.speedMul = run;
      res = w.step(dt);
    }
  } catch {
    res = 'stuck';
  }
  trackStuck(sv, job, dt, x, y, res);
  return res === 'arrived' && Math.hypot(x - a.x, y - a.y) <= arrive + 4 ? 'arrived' : res === 'arrived' ? 'moving' : res;
}

// A rescuer who has not got anywhere for a while is moved on: off screen at once, on
// screen they first slip through whoever is in the way.
function trackStuck(sv, job, dt, gx, gy, res) {
  const a = job.rescuer;
  job.sampleT = (job.sampleT || 0) + dt;
  if (job.sampleT < 0.5) return;
  const moved = Math.hypot(a.x - (job.sx ?? a.x), a.y - (job.sy ?? a.y));
  job.sampleT = 0;
  job.sx = a.x;
  job.sy = a.y;
  if (moved > 2.5 && res !== 'stuck' && res !== 'blocked' && res !== 'locked') {
    job.stuckT = 0;
    return;
  }
  job.stuckT = (job.stuckT || 0) + 0.5;
  if (job.stuckT >= 1.5) {
    a.solid = false;
    a._svSlip = 1.5;
  }
  const carryingPlayer = a.carrying && isPlayer(sv, a.carrying);
  const seen = sv.visible(a) || carryingPlayer;
  if (job.stuckT >= (seen ? STUCK_TELEPORT * 2.5 : STUCK_TELEPORT)) {
    const spot = sv.freeSpotNear(gx, gy) || { x: gx, y: gy };
    a.x = spot.x;
    a.y = spot.y;
    job.stuckT = 0;
    if (a.walker?.stop) a.walker.stop();
    a.behavior?.steering?.reset?.();
  }
}

// ---------------------------------------------------------------- the job

export function newJob(sv, rescuer, rec, role) {
  return { rescuer, fall: rec, role, phase: role === 'fetch' ? 'fetch' : 'go', t: 0, mode: null, dest: null, target: null, lineT: 5 + rand(sv) * 2, stuckT: 0, walker: null, sampleT: 0 };
}

// Drive one step of a job. Returns true when the job moved the rescuer this step;
// false hands the step back to the rescuer's own mind (Lyra fighting off what is there).
export function stepJob(sv, job, dt) {
  const a = job.rescuer;
  const rec = job.fall;
  const F = rec?.actor;
  job.t += dt;
  if (a._svSlip > 0) {
    a._svSlip -= dt;
    if (a._svSlip <= 0) a.solid = true;
  }
  if (!F || F.removed) {
    sv.endJob(job);
    return false;
  }
  switch (job.phase) {
    case 'go':
      return goStep(sv, job, rec, F, dt);
    case 'kneel':
      return kneelStep(sv, job, rec, F, dt);
    case 'lift':
      return liftStep(sv, job, rec, F, dt);
    case 'carry':
      return carryStep(sv, job, rec, F, dt);
    case 'lay':
      return layStep(sv, job, rec, F, dt);
    case 'escort':
      return escortStep(sv, job, rec, F, dt);
    case 'fetch':
      return fetchStep(sv, job, rec, F, dt);
    default:
      sv.endJob(job);
      return false;
  }
}

function goStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  if (!sv.falls.has(F)) {
    sv.endJob(job);
    return false;
  }
  if (rec.carrier && rec.carrier !== a) return becomeEscortOrLeave(sv, job);
  const foe = sv.dangerNear(F, a);
  if (foe) {
    // Lyra's own combat sense takes over; the watch and Hess fight it off; the rest keep clear.
    if (isLyra(sv, a)) {
      if (!job.foughtSaid && sv.visible(a)) {
        job.foughtSaid = true;
        speak(sv, a, lineFor(sv, a, 'fight'), 'shout');
      }
      return false;
    }
    const id = a.profile?.id || a.id;
    if ((FIGHTERS.has(id) || a.isGuard) && typeof a.startFight === 'function') {
      a.post = { x: a.x, y: a.y };
      try {
        a.startFight(foe);
      } catch {
        /* the fight is theirs to start */
      }
      return true;
    }
    const dx = a.x - foe.x;
    const dy = a.y - foe.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 130) moveToward(sv, job, foe.x + (dx / d) * 140, foe.y + (dy / d) * 140, dt, 1.3, 10);
    else stopFeet(sv, job);
    a.faceToward?.(F.x, F.y);
    return true;
  }
  const side = a.x <= F.x ? -11 : 11;
  if (moveToward(sv, job, F.x + side, F.y + 2, dt, RUN, ARRIVE_DIST) === 'arrived') arrive(sv, job, rec, F);
  return true;
}

function becomeEscortOrLeave(sv, job) {
  if (isLyra(sv, job.rescuer)) {
    job.phase = 'escort';
    job.t = 0;
    return true;
  }
  sv.endJob(job);
  return false;
}

export function arrive(sv, job, rec, F) {
  const a = job.rescuer;
  a.faceToward?.(F.x, F.y);
  rec.anyoneCame = true;
  if (isLyra(sv, a)) rec.lyraCame = true;
  let action = 'stanch';
  if (job.role === 'lyra') action = canLendWarmth(sv, a, rec) ? 'warmth' : 'lift';
  else if (job.role === 'revive') action = 'salve';
  else if (job.role === 'carry' || job.role === 'arrest') action = 'lift';
  if (action === 'lift' && rec.carrier) return becomeEscortOrLeave(sv, job);
  // Someone is already getting them up on the spot: kneel and press on the wound instead.
  if (action === 'lift' && someoneReviving(sv, rec, job)) action = 'stanch';
  if (action === 'lift') {
    job.phase = 'lift';
    job.t = 0;
    rec.stanchers.add(a);
    a.setState?.('work', LIFT_SECONDS);
    speak(sv, a, lineFor(sv, a, job.role === 'arrest' ? 'arrest' : 'lift') || lineFor(sv, a, 'lift'));
    return;
  }
  job.phase = 'kneel';
  job.mode = action;
  job.t = 0;
  rec.stanchers.add(a);
  a.setState?.('work', 0.5);
  if (action === 'warmth') speak(sv, a, lineFor(sv, a, 'warmth'));
  else if (action === 'salve') speak(sv, a, lineFor(sv, a, 'arrive') || lineFor(sv, a, 'revive'));
  else speak(sv, a, lineFor(sv, a, 'tend'));
}

function kneelStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  if (!sv.falls.has(F)) {
    sv.endJob(job);
    return false;
  }
  if (rec.carrier) return becomeEscortOrLeave(sv, job);
  if (dist(a, F) > 30) {
    job.phase = 'go';
    rec.stanchers.delete(a);
    return true;
  }
  stopFeet(sv, job);
  a.faceToward?.(F.x, F.y);
  if (a.state !== 'work') a.setState?.('work', 0.3);
  if (job.mode === 'warmth' || job.mode === 'salve') {
    if (job.t >= REVIVE_SECONDS) doRevive(sv, job, rec, F);
    else if (sv.visible(F) && Math.floor(job.t * 4) !== Math.floor((job.t - dt) * 4)) {
      const color = job.mode === 'warmth' ? '#b9a6ff' : '#9ff0b8';
      try {
        sv.game.particles?.emit?.(job.mode === 'warmth' ? 'magic' : 'heal', F.x, F.y - 6, { count: 2, color, speed: 14, life: 0.7 });
      } catch {
        /* cosmetic */
      }
    }
    return true;
  }
  // Pressing on the wound, and shouting for someone who can carry.
  job.lineT -= dt;
  if (job.lineT <= 0) {
    job.lineT = 7 + rand(sv) * 3;
    speak(sv, a, pickLine(TENDER_SHOUTS, sv.game.rng), 'shout');
    sv.alert(rec, 320, { from: a });
  }
  return true;
}

// Is another rescuer kneeling with salve or warmth right now?
function someoneReviving(sv, rec, job) {
  for (const r of rec.responders) {
    const j = sv.jobs.get(r);
    if (j && j !== job && j.phase === 'kneel' && (j.mode === 'warmth' || j.mode === 'salve')) return true;
  }
  return false;
}

function doRevive(sv, job, rec, F) {
  const a = job.rescuer;
  const g = sv.game;
  const warmth = job.mode === 'warmth';
  rec.stanchers.delete(a);
  sv.reviveFall(F, a, warmth ? WARMTH_HP : SALVE_HP, { via: warmth ? 'warmth' : 'salve' });
  if (warmth) {
    a.hp = Math.max(1, Math.round(a.hp - a.maxHp * WARMTH_COST));
    try {
      g.lighting?.flash?.({ x: F.x, y: F.y - 8, r: 60, color: '#b9a6ff', intensity: 0.8, duration: 0.6 });
    } catch {
      /* cosmetic */
    }
    sv.lyraRemembers(F, 'warmth');
    speak(sv, a, lineFor(sv, a, 'warmthDone'));
  } else {
    if (isPlayer(sv, F)) sv.bill(MIRA_SALVE, 'salve');
    speak(sv, a, lineFor(sv, a, 'revive'));
  }
  sv.endJob(job);
}

function liftStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  if (!sv.falls.has(F) && !rec.grave) {
    sv.endJob(job);
    return false;
  }
  if (rec.carrier && rec.carrier !== a) return becomeEscortOrLeave(sv, job);
  stopFeet(sv, job);
  a.faceToward?.(F.x, F.y);
  if (someoneReviving(sv, rec, job)) {
    job.phase = 'kneel';
    job.mode = 'stanch';
    job.t = 0;
    return true;
  }
  if (job.t < LIFT_SECONDS) return true;
  rec.stanchers.delete(a);
  if (!sv.startCarry(a, F, job)) {
    sv.endJob(job);
    return false;
  }
  job.phase = 'carry';
  job.t = 0;
  job.lineT = 3 + rand(sv) * 2;
  return true;
}

function carryStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  if (a.carrying !== F) {
    sv.endJob(job);
    return false;
  }
  if (!job.dest) job.dest = sv.pickDestination(F, job);
  const d = job.dest;
  if (!d) {
    stopFeet(sv, job);
    return true;
  }
  job.lineT -= dt;
  if (job.lineT <= 0) {
    job.lineT = 5.5 + rand(sv) * 2.5;
    if (sv.visible(a)) speak(sv, a, lineFor(sv, a, 'carry'));
  }
  const speed = CARRY_SPEED * (sv.carryBonus(a) || 1);
  if (moveToward(sv, job, d.x, d.y, dt, speed, 7) === 'arrived') {
    job.phase = 'lay';
    job.t = 0;
    a.faceToward?.(d.bed?.x ?? d.x, (d.bed?.y ?? d.y) - 10);
    a.setState?.('work', LAY_SECONDS);
    speak(sv, a, lineFor(sv, a, 'lay'));
  }
  return true;
}

function layStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  stopFeet(sv, job);
  if (a.carrying !== F) {
    sv.endJob(job);
    return false;
  }
  if (job.t < LAY_SECONDS) return true;
  sv.deliver(a, job.dest, job);
  sv.endJob(job);
  return true;
}

function escortStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  const carrier = F.carriedBy;
  if (!carrier || (!sv.falls.has(F) && !rec.grave)) {
    sv.endJob(job);
    return false;
  }
  const side = a.x <= carrier.x ? -16 : 16;
  moveToward(sv, job, carrier.x + side, carrier.y + 4, dt, 1.25, 12);
  job.lineT -= dt;
  if (job.lineT <= 0) {
    job.lineT = 6.5 + rand(sv) * 3;
    if (sv.visible(a)) speak(sv, a, lineFor(sv, a, 'escort'));
  }
  return true;
}

function fetchStep(sv, job, rec, F, dt) {
  const a = job.rescuer;
  if (!sv.falls.has(F)) {
    sv.endJob(job);
    return false;
  }
  let T = job.target;
  if (!T || !canRespond(sv, T)) T = job.target = sv.fetchTarget(a, rec);
  if (!T) {
    // Nobody to fetch: stay and press on the wound instead.
    job.role = 'tend';
    job.phase = 'go';
    return true;
  }
  if (moveToward(sv, job, T.x, T.y + 4, dt, RUN, 26) === 'arrived') {
    a.faceToward?.(T.x, T.y);
    speak(sv, a, lineFor(sv, a, 'fetch') || 'Quick! Someone’s down!', 'shout');
    const counts = countRoles(sv, rec);
    const role = isLyra(sv, T) ? 'lyra' : roleFor(sv, T, rec, counts) || 'carry';
    sv.assignJob(T, rec, role, { forced: true });
    sv.endJob(job);
  }
  return true;
}

// Whoever a child should run for: the nearest free pair of strong arms in the village.
export function nearestCarrier(sv, from, rec, max = 1600) {
  let best = null;
  let bd = max;
  for (const e of sv.game.entities?.all?.() || []) {
    if (!isVillager(e) || e === from || !canRespond(sv, e)) continue;
    const id = e.profile?.id || e.id;
    if (rec.wanted ? !e.isGuard : !(CARRIERS.has(id) || e.isGuard || REVIVERS.has(id))) continue;
    const d = dist(e, from);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export const _test = { TILE };
