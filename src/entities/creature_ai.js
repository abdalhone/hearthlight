import { now, rand, inVillage, hostileTo, alive, walkLine, sightLine, speak, pickLine } from './creature_util.js';

// Creature minds. Every creature runs one state machine picked by its species'
// `ai`; states live in creature.ai = { state, t, dur, ... } and creature.target.
//
//   idle/wander -> notice -> chase -> windup -> recover -> chase ... -> return (leash)
//   skittish:  graze/wander -> alert -> flee
//   charger (boar): graze; once provoked: windup (paws the ground) -> charge -> recover
//   flyer (bat): flutter -> chase (orbit) -> windup (climb) -> dive -> retreat
//   archer: kite at a distance -> windup (draw) -> shoot -> kite
//   chief: melee + a heavy slam with a marked ground ring
//
// Target selection always goes through combat.isHostile (crimes, provocation).
// Creatures far from the player go dormant so a big world stays cheap.

const DORMANT_DIST = 640;
const THINK = 0.3;
const BARK_GAP = 3; // seconds between any two bandit barks
let lastBarkAt = -Infinity;

export function runCreatureAI(c, dt) {
  // Frozen, stunned or staggered by a weave: no thinking, no moving (DESIGN §22.1).
  if (c.statusFlags?.disabled) {
    stopMove(c);
    return;
  }
  const ai = c.ai;
  ai.t += dt;
  c.thinkT -= dt;
  let think = false;
  if (c.thinkT <= 0) {
    think = true;
    c.thinkT = THINK + c.jitter * 0.15;
  }
  if (think && dormant(c)) {
    c.thinkT = 1 + c.jitter * 0.5;
    stopMove(c);
    if (ai.state !== 'return') {
      if (c.target) c.target = null;
      if (ai.state !== 'idle') setAI(c, 'idle', 2);
      return;
    }
  }
  if (c.spec.hops) hopZ(c);
  switch (c.spec.ai) {
    case 'skittish':
      return aiSkittish(c, dt, think);
    case 'pet':
      return aiPet(c, dt, think);
    case 'charger':
      return aiCharger(c, dt, think);
    case 'flyer':
      return aiFlyer(c, dt, think);
    case 'archer':
      return aiArcher(c, dt, think);
    case 'chief':
      return aiMelee(c, dt, think, true);
    default:
      return aiMelee(c, dt, think, false);
  }
}

// ---------------------------------------------------------------- basics

export function setAI(c, state, dur = 0) {
  const ai = c.ai;
  ai.state = state;
  ai.t = 0;
  ai.dur = dur;
}

function stopMove(c) {
  c.moveIntent.x = 0;
  c.moveIntent.y = 0;
}

function dormant(c) {
  const p = c.game.player;
  if (!p || c.target) return false;
  return Math.abs(p.x - c.x) > DORMANT_DIST || Math.abs(p.y - c.y) > DORMANT_DIST;
}

function distTo(c, e) {
  return Math.hypot(e.x - c.x, e.y - c.y);
}

function homeDist(c) {
  return Math.hypot(c.home.x - c.x, c.home.y - c.y);
}

function aggroRange(c) {
  const g = c.game;
  let r = c.aggroRadius || 0;
  if (c.spec.nightAggro && g.clock?.isNight) r *= c.spec.nightAggro;
  return r;
}

// Steer straight at a point. `mul` is the intent length (walk speed fraction).
// Wild creatures refuse to step into the village.
function steer(c, x, y, mul = 1) {
  const dx = x - c.x;
  const dy = y - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) {
    stopMove(c);
    return false;
  }
  const ux = dx / d;
  const uy = dy / d;
  if (!c.villager && inVillage(c.game, c.x + ux * 12, c.y + uy * 12) && !inVillage(c.game, c.x, c.y)) {
    stopMove(c);
    return false;
  }
  c.moveIntent.x = ux * mul;
  c.moveIntent.y = uy * mul;
  return true;
}

// Run away from a point; slide along walls by trying turned directions.
function steerAway(c, x, y, mul = 1) {
  let dx = c.x - x;
  let dy = c.y - y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const tries = c.ai.awayTurn ? [c.ai.awayTurn, 0, -c.ai.awayTurn] : [0, 0.9, -0.9];
  for (const a of tries) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ux = dx * ca - dy * sa;
    const uy = dx * sa + dy * ca;
    const px = c.x + ux * 14;
    const py = c.y + uy * 14;
    if (!walkLine(c.game, c, c.x, c.y, px, py)) continue;
    if (!c.villager && inVillage(c.game, px, py) && !inVillage(c.game, c.x, c.y)) continue;
    c.moveIntent.x = ux * mul;
    c.moveIntent.y = uy * mul;
    c.ai.awayTurn = a;
    return true;
  }
  c.ai.awayTurn = rand(c.game) < 0.5 ? 1.6 : -1.6;
  c.moveIntent.x = dx * mul;
  c.moveIntent.y = dy * mul;
  return false;
}

// Chase with a direct line when it is clear, the pathfinder otherwise.
function chaseStep(c, t, dt, think, mul = 1, ox = 0, oy = 0) {
  const gx = t.x + ox;
  const gy = t.y + oy;
  if (think) c.ai.clear = walkLine(c.game, c, c.x, c.y, gx, gy);
  if (c.ai.clear !== false) {
    c.walker.stop();
    return steer(c, gx, gy, mul);
  }
  if (think || !c.walker.active) c.walker.goTo(gx, gy);
  const r = c.walker.step(dt, mul);
  if (r === 'stuck') c.ai.clear = true;
  if (!c.villager && inVillage(c.game, c.x + c.moveIntent.x * 12, c.y + c.moveIntent.y * 12) && !inVillage(c.game, c.x, c.y)) {
    stopMove(c);
    return false;
  }
  return true;
}

function hopZ(c) {
  const moving = Math.abs(c.moveIntent.x) + Math.abs(c.moveIntent.y) > 0.05 && c.lockTime <= 0;
  if (moving) {
    const ph = (c.age * (c.species === 'rabbit' ? 3.4 : 2.2) + c.jitter) % 1;
    c.z = Math.sin(ph * Math.PI) * (c.species === 'rabbit' ? 4 : 2.5);
  } else if (c.z > 0 && !c.flying) {
    c.z = Math.max(0, c.z - 0.6);
  }
}

// Slimes and rabbits move in hops: intent pulses on and off.
function hopGate(c) {
  if (!c.spec.hops) return 1;
  const ph = (c.age * (c.species === 'rabbit' ? 3.4 : 2.2) + c.jitter) % 1;
  return ph < 0.62 ? 1 : 0;
}

function provoker(c) {
  const p = c.provokedBy;
  if (!p || !alive(p)) return null;
  if (now(c.game) - (c.provokedAt ?? -Infinity) > 45) return null;
  return p;
}

// The best hostile target in range (provokers first, then the nearest).
export function scanTarget(c, radius) {
  const g = c.game;
  const pv = provoker(c);
  if (pv && c.provokedMode !== 'flee' && hostileTo(g, c, pv) && distTo(c, pv) < Math.max(radius * 2, 180)) return pv;
  if (!(radius > 0)) return null;
  const list = g.entities?.list || g.entities?.all?.() || [];
  let best = null;
  let bd = radius * radius;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === c || e.type !== 'actor' || e.removed || e.dead) continue;
    const dx = e.x - c.x;
    const dy = e.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bd) continue;
    if (!alive(e)) continue;
    if (!c.villager && inVillage(g, e.x, e.y)) continue;
    if (!hostileTo(g, c, e)) continue;
    best = e;
    bd = d2;
  }
  return best;
}

function targetValid(c, t) {
  if (!t || !alive(t)) return false;
  if (!hostileTo(c.game, c, t)) return false;
  if (!c.villager && inVillage(c.game, t.x, t.y)) return false;
  const keep = Math.max(aggroRange(c) * 2.4, 170);
  return distTo(c, t) <= keep;
}

function leashBroken(c) {
  return homeDist(c) > c.leashRadius;
}

function engage(c, t, notice = 0.35) {
  c.target = t;
  c.walker.stop();
  setAI(c, 'notice', notice);
  c.faceToward(t.x, t.y);
  try {
    c.game.bubbles?.icon?.(c, '!');
  } catch {
    /* cosmetic */
  }
  bark(c, t);
  if (c.spec.pack) alertPack(c, t);
}

function bark(c, t) {
  const lines = c.spec.barks;
  if (!lines || c.barkT > now(c.game)) return;
  const tt = now(c.game);
  if (tt - lastBarkAt < BARK_GAP) return;
  if (rand(c.game) > 0.6) return;
  lastBarkAt = tt;
  c.barkT = tt + 10 + rand(c.game) * 8;
  speak(c.game, c, pickLine(c.game, lines), 'shout', t, 2.2);
}

// One wolf notices, the pack comes.
function alertPack(c, t) {
  const list = c.game.entities?.list || [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (w === c || w.species !== c.species || w.target || !alive(w)) continue;
    if (Math.hypot(w.x - c.x, w.y - c.y) > 180) continue;
    if (!hostileTo(c.game, w, t)) continue;
    w.target = t;
    w.walker?.stop();
    setAI(w, 'notice', 0.25 + rand(c.game) * 0.5);
  }
}

function disengage(c) {
  c.target = null;
  c.holdFrame = null;
  c.telegraph = 0;
  c.slamAt = null;
  c.speedMul = 1;
  if (homeDist(c) > 40) {
    setAI(c, 'return', 0);
    c.walker.goTo(c.home.x, c.home.y);
  } else setAI(c, 'idle', 1 + rand(c.game) * 2);
}

function returnStep(c, dt, think) {
  c.speedMul = 1.1;
  // Licks its wounds on the way home (not while someone is still hitting it).
  if (now(c.game) - (c.ai.hurtT ?? -Infinity) > 3) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.06 * dt);
  if (!c.walker.active) c.walker.goTo(c.home.x, c.home.y);
  const r = c.walker.step(dt, 0.85);
  if (r === 'arrived' || homeDist(c) < 20) {
    c.speedMul = 1;
    setAI(c, 'idle', 1 + rand(c.game) * 2);
  } else if (r === 'stuck') {
    // Cannot get back: this is home now.
    c.home.x = c.x;
    c.home.y = c.y;
    c.speedMul = 1;
    setAI(c, 'idle', 2);
  }
  if (think) {
    const pv = provoker(c);
    if (pv && c.provokedMode !== 'flee' && hostileTo(c.game, c, pv) && distTo(c, pv) < 90) engage(c, pv, 0.2);
  }
}

function wanderStep(c, dt, think, radius = 56, mul = 0.42) {
  const ai = c.ai;
  if (ai.state === 'idle') {
    stopMove(c);
    if (ai.t >= ai.dur) {
      const p = wanderPoint(c, radius);
      if (p) {
        ai.tx = p.x;
        ai.ty = p.y;
        setAI(c, 'wander', 2.5 + rand(c.game) * 3);
      } else setAI(c, 'idle', 1.5);
    }
    return;
  }
  // wander
  const d = Math.hypot(ai.tx - c.x, ai.ty - c.y);
  if (d < 4 || ai.t >= ai.dur || (ai.t > 0.6 && c.moved < 0.02 && c.lockTime <= 0)) {
    stopMove(c);
    setAI(c, 'idle', 1.2 + rand(c.game) * 3.5);
    return;
  }
  steer(c, ai.tx, ai.ty, mul * hopGate(c));
}

function wanderPoint(c, radius) {
  const g = c.game;
  for (let k = 0; k < 6; k++) {
    const a = rand(g) * Math.PI * 2;
    const r = radius * (0.3 + 0.7 * rand(g));
    const x = c.home.x + Math.cos(a) * r;
    const y = c.home.y + Math.sin(a) * r;
    if (!c.villager && inVillage(g, x, y)) continue;
    if (c.villager && !inVillage(g, x, y) && inVillage(g, c.home.x, c.home.y)) continue;
    if (!c.flying && !walkLine(g, c, c.x, c.y, x, y)) continue;
    return { x, y };
  }
  return null;
}

function attackReady(c) {
  return now(c.game) >= (c.ai.readyAt ?? 0);
}

function startWindup(c, dur) {
  stopMove(c);
  c.walker.stop();
  c.faceToward(c.target.x, c.target.y);
  setAI(c, 'windup', dur);
  c.setState('attack', dur + 0.05);
  c.animTime = 0;
  c.holdFrame = 0;
  c.telegraph = 0.2;
}

function strike(c, opts) {
  const g = c.game;
  const t = c.target;
  c.holdFrame = null;
  c.telegraph = 0;
  c.animTime = 0;
  c.stateTime = 0;
  if (t) c.faceToward(t.x, t.y);
  const atk = c.spec.attack;
  if (atk.lunge && t) {
    const d = distTo(c, t) || 1;
    c.knock.x += ((t.x - c.x) / d) * atk.lunge;
    c.knock.y += ((t.y - c.y) / d) * atk.lunge;
  }
  try {
    g.combat?.melee?.(c, {
      target: t || undefined,
      arc: atk.arc,
      range: atk.range + 6 + (t?.radius ?? 4),
      damageMul: atk.damageMul,
      knockback: atk.knockback,
      kind: atk.kind,
      cooldown: 0.05,
      lock: 0.2,
      ...opts,
    });
  } catch (err) {
    if (!c._meleeWarned) {
      c._meleeWarned = true;
      console.error('[creature] melee failed', err);
    }
  }
  c.setState('attack', Math.max(0.22, atk.recover));
}

// ---------------------------------------------------------------- melee (+ chief)

function aiMelee(c, dt, think, chief) {
  const ai = c.ai;
  const atk = c.spec.attack;
  const enraged = chief && c.hp < c.maxHp * 0.4;
  if (enraged && !ai.enraged) {
    ai.enraged = true;
    speak(c.game, c, 'Enough! Now you bleed!', 'shout', c.target, 2.4);
  }
  const speedK = enraged ? 1.15 : 1;
  switch (ai.state) {
    case 'idle':
    case 'wander': {
      c.speedMul = 1;
      if (think) {
        const t = scanTarget(c, aggroRange(c));
        if (t) return engage(c, t);
      }
      return wanderStep(c, dt, think, Math.min(70, c.leashRadius * 0.35), c.species === 'skeleton' ? 0.35 : 0.42);
    }
    case 'notice': {
      stopMove(c);
      if (!c.target || !alive(c.target)) return disengage(c);
      c.faceToward(c.target.x, c.target.y);
      if (ai.t >= ai.dur) setAI(c, 'chase', 0);
      return;
    }
    case 'chase': {
      const t = c.target;
      if (think && !targetValid(c, t)) return disengage(c);
      if (!t) return disengage(c);
      if (leashBroken(c)) return disengage(c);
      if (c.spec.fleeBelow && c.hp < c.maxHp * c.spec.fleeBelow && !ai.fled) {
        ai.fled = true;
        ai.from = t;
        c.target = null;
        setAI(c, 'flee', 3.5);
        return;
      }
      const d = distTo(c, t);
      if (chief && attackReady(c) && now(c.game) >= (ai.slamReadyAt ?? 2) && d < 54) return startSlam(c, enraged);
      if (d <= atk.range + (t.radius ?? 4) && attackReady(c)) return startWindup(c, atk.windup * (enraged ? 0.75 : 1));
      c.speedMul = (c.spec.chase || 1.2) * speedK * (c.spec.nightAggro && c.game.clock?.isNight ? 1.08 : 1);
      // Pack hunters fan out around the prey instead of queueing behind each other.
      let ox = 0;
      let oy = 0;
      if (c.spec.pack && d > 30) {
        const k = Math.min(22, d * 0.4) * ai.flankSign;
        ox = (-(t.y - c.y) / d) * k;
        oy = ((t.x - c.x) / d) * k;
      }
      if (d <= atk.range + (t.radius ?? 4)) {
        stopMove(c);
        c.faceToward(t.x, t.y);
        return;
      }
      chaseStep(c, t, dt, think, hopGate(c), ox, oy);
      return;
    }
    case 'windup': {
      stopMove(c);
      c.telegraph = Math.min(1, 0.2 + ai.t / Math.max(0.05, ai.dur));
      if (c.target) c.faceToward(c.target.x, c.target.y);
      if (ai.t >= ai.dur) {
        strike(c);
        ai.readyAt = now(c.game) + atk.cooldown * (enraged ? 0.75 : 1) * (0.85 + rand(c.game) * 0.3);
        setAI(c, 'recover', atk.recover);
      }
      return;
    }
    case 'slam': {
      stopMove(c);
      const s = c.slamAt;
      if (s) s.t = ai.t;
      c.telegraph = Math.min(1, ai.t / Math.max(0.05, ai.dur));
      if (ai.t >= ai.dur) doSlam(c, enraged);
      return;
    }
    case 'recover': {
      stopMove(c);
      if (ai.t >= ai.dur) {
        c.slamAt = null;
        if (c.target && targetValid(c, c.target)) setAI(c, 'chase', 0);
        else disengage(c);
      }
      return;
    }
    case 'flee': {
      const from = ai.from;
      c.speedMul = (c.spec.chase || 1.2) * 1.1;
      if (!from || !alive(from) || ai.t >= ai.dur) {
        c.speedMul = 1;
        ai.from = null;
        setAI(c, 'return', 0);
        c.walker.goTo(c.home.x, c.home.y);
        return;
      }
      steerAway(c, from.x, from.y, 1);
      return;
    }
    case 'return':
      return returnStep(c, dt, think);
    default:
      setAI(c, 'idle', 1);
  }
}

function startSlam(c, enraged) {
  const sl = c.spec.slam;
  const dur = sl.windup * (enraged ? 0.75 : 1);
  stopMove(c);
  c.walker.stop();
  c.faceToward(c.target.x, c.target.y);
  setAI(c, 'slam', dur);
  c.setState('attack', dur + 0.05);
  c.animTime = 0;
  c.holdFrame = 0;
  c.slamAt = { x: c.x, y: c.y, r: sl.radius, t: 0, dur };
  if (rand(c.game) < 0.5) bark(c, c.target);
}

function doSlam(c, enraged) {
  const g = c.game;
  const sl = c.spec.slam;
  c.holdFrame = null;
  c.telegraph = 0;
  c.animTime = 0;
  try {
    g.combat?.melee?.(c, { arc: Math.PI * 2, range: sl.radius + 4, damageMul: sl.damageMul, knockback: sl.knockback, heavy: true, launch: 90, kind: 'melee', cooldown: 0.05, lock: 0.3 });
  } catch {
    /* the slam still lands visually */
  }
  try {
    g.camera?.shake?.(4, 0.35);
    g.particles?.emit?.('dust', c.x, c.y, { count: 18, speed: 70, life: 0.6 });
    g.lighting?.flash?.({ x: c.x, y: c.y - 4, r: 48, color: '#ffb047', intensity: 0.35, duration: 0.18 });
    g.audio?.play?.('slam', { x: c.x, y: c.y });
  } catch {
    /* cosmetic */
  }
  c.setState('attack', sl.recover);
  c.slamAt = null;
  c.ai.slamReadyAt = now(g) + sl.cooldown * (enraged ? 0.7 : 1);
  c.ai.readyAt = now(g) + 0.6;
  setAI(c, 'recover', sl.recover);
}

// ---------------------------------------------------------------- charger (boar)

function aiCharger(c, dt, think) {
  const ai = c.ai;
  const atk = c.spec.attack;
  switch (ai.state) {
    case 'idle':
    case 'wander': {
      c.speedMul = 1;
      if (think) {
        const pv = provoker(c);
        if (pv && c.provokedMode !== 'flee' && hostileTo(c.game, c, pv)) return engage(c, pv, 0.25);
        if (scared(c)) {
          ai.from = c.scaredOf;
          setAI(c, 'flee', 2.5);
          return;
        }
      }
      return wanderStep(c, dt, think, 48, 0.35);
    }
    case 'notice':
      stopMove(c);
      if (!c.target) return disengage(c);
      c.faceToward(c.target.x, c.target.y);
      if (ai.t >= ai.dur) setAI(c, 'chase', 0);
      return;
    case 'chase': {
      const t = c.target;
      if ((think && !targetValid(c, t)) || !t || leashBroken(c)) return disengage(c);
      const d = distTo(c, t);
      if (attackReady(c) && d < 92 && d > 18 && walkLine(c.game, c, c.x, c.y, t.x, t.y)) {
        startWindup(c, atk.windup);
        setAI(c, 'paw', atk.windup);
        return;
      }
      if (d <= atk.range + (t.radius ?? 4) && attackReady(c)) return startWindup(c, 0.35);
      c.speedMul = 1.3;
      chaseStep(c, t, dt, think, 1);
      return;
    }
    case 'paw': {
      // Pawing the ground: the tell before the charge.
      stopMove(c);
      c.telegraph = Math.min(1, ai.t / ai.dur);
      if (c.target) c.faceToward(c.target.x, c.target.y);
      if (ai.t >= ai.dur) {
        c.holdFrame = null;
        c.telegraph = 0;
        const t = c.target;
        const d = t ? distTo(c, t) || 1 : 1;
        ai.cx = t ? (t.x - c.x) / d : c.facing.x;
        ai.cy = t ? (t.y - c.y) / d : c.facing.y;
        ai.hit = false;
        c.lockTime = 0;
        c.setState('walk');
        setAI(c, 'charge', 0.95);
      }
      return;
    }
    case 'charge': {
      c.speedMul = c.spec.charge || 4;
      c.moveIntent.x = ai.cx;
      c.moveIntent.y = ai.cy;
      const t = c.target;
      if (!ai.hit && t && alive(t) && distTo(c, t) < (t.radius ?? 4) + c.radius + 7) {
        ai.hit = true;
        try {
          c.game.combat?.melee?.(c, { target: t, arc: Math.PI, range: 26, damageMul: atk.damageMul, knockback: atk.knockback, kind: 'melee', cooldown: 0.05, heavy: true });
        } catch {
          /* a missed tusk is still a charge */
        }
      }
      const blocked = ai.t > 0.12 && c.moved < 0.4;
      if (ai.t >= ai.dur || blocked || ai.hit) {
        c.speedMul = 1;
        stopMove(c);
        if (blocked) {
          // Ran into a wall: dazed for a moment (an opening).
          try {
            c.game.camera?.shake?.(1.5, 0.15);
            c.game.particles?.emit?.('dust', c.x + ai.cx * 6, c.y + ai.cy * 6, { count: 8, speed: 40, life: 0.5 });
          } catch {
            /* cosmetic */
          }
        }
        ai.readyAt = now(c.game) + atk.cooldown;
        c.setState('idle', blocked ? 1.3 : atk.recover);
        setAI(c, 'recover', blocked ? 1.3 : atk.recover);
      }
      return;
    }
    case 'windup':
      stopMove(c);
      c.telegraph = Math.min(1, ai.t / Math.max(0.05, ai.dur));
      if (ai.t >= ai.dur) {
        strike(c);
        ai.readyAt = now(c.game) + atk.cooldown;
        setAI(c, 'recover', atk.recover);
      }
      return;
    case 'recover':
      stopMove(c);
      if (ai.t >= ai.dur) {
        if (c.target && targetValid(c, c.target)) setAI(c, 'chase', 0);
        else disengage(c);
      }
      return;
    case 'flee':
      return fleeStep(c, dt, 'return');
    case 'return':
      return returnStep(c, dt, think);
    default:
      setAI(c, 'idle', 1);
  }
}

function scared(c) {
  return !!c.scaredOf && now(c.game) < c.scaredUntil && alive(c.scaredOf);
}

function fleeStep(c, dt, after = 'idle') {
  const ai = c.ai;
  const from = ai.from;
  c.speedMul = c.spec.flee || 2;
  if (!from || !alive(from) || ai.t >= ai.dur) {
    c.speedMul = 1;
    ai.from = null;
    stopMove(c);
    if (after === 'return' && homeDist(c) > 60) {
      setAI(c, 'return', 0);
      c.walker.goTo(c.home.x, c.home.y);
    } else setAI(c, 'idle', 0.8 + rand(c.game) * 1.5);
    return;
  }
  steerAway(c, from.x, from.y, hopGate(c));
}

// ---------------------------------------------------------------- skittish wildlife

// Who scares a deer, rabbit or chicken: people on foot, predators, whoever hurt it.
function scaryNear(c, radius) {
  const g = c.game;
  const pv = provoker(c);
  if (pv && distTo(c, pv) < radius * 2.2) return pv;
  if (scared(c)) return c.scaredOf;
  const list = g.entities?.list || [];
  let best = null;
  let bd = radius * radius;
  const calm = c.species === 'chicken';
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === c || e.type !== 'actor' || e.removed || e.dead) continue;
    const dx = e.x - c.x;
    const dy = e.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bd) continue;
    if (e.species === c.species || !alive(e)) continue;
    const predator = hostileTo(g, e, c);
    const person = e.faction === 'player' || e.faction === 'villager' || e.faction === 'guard' || e.faction === 'bandit';
    if (!predator && !person) continue;
    // Chickens only scatter from someone rushing at them.
    if (calm && !predator && (e.moved ?? 0) < 0.9) continue;
    // Anyone sneaking (moving slowly) gets closer before the deer bolts.
    if (!predator && !calm && (e.moved ?? 0) < 0.4 && d2 > bd * 0.35) continue;
    best = e;
    bd = d2;
  }
  return best;
}

function aiSkittish(c, dt, think) {
  const ai = c.ai;
  switch (ai.state) {
    case 'idle':
    case 'wander': {
      c.speedMul = 1;
      if (think) {
        const s = scaryNear(c, c.spec.fleeRadius || 50);
        if (s) {
          ai.from = s;
          c.faceToward(s.x, s.y);
          setAI(c, c.species === 'deer' ? 'alert' : 'flee', c.species === 'deer' ? 0.35 : 1.6 + rand(c.game) * 1.4);
          return;
        }
      }
      // Grazing: long pauses, short walks.
      return wanderStep(c, dt, think, c.species === 'chicken' ? 40 : 60, c.species === 'chicken' ? 0.5 : 0.38);
    }
    case 'alert':
      stopMove(c);
      if (ai.from) c.faceToward(ai.from.x, ai.from.y);
      if (ai.t >= ai.dur) setAI(c, 'flee', 2 + rand(c.game) * 1.5);
      return;
    case 'flee': {
      if (think && ai.t > 1 && ai.from && distTo(c, ai.from) > (c.spec.fleeRadius || 50) * 2.4) ai.t = ai.dur;
      return fleeStep(c, dt, 'return');
    }
    case 'return':
      if (think) {
        const s = scaryNear(c, c.spec.fleeRadius || 50);
        if (s) {
          ai.from = s;
          setAI(c, 'flee', 2);
          return;
        }
      }
      return returnStep(c, dt, false);
    default:
      setAI(c, 'idle', 1);
  }
}

// ---------------------------------------------------------------- the cat

function aiPet(c, dt, think) {
  const ai = c.ai;
  const g = c.game;
  const night = !!g.clock?.isNight;
  if (think && ai.state !== 'flee') {
    const s = scaryNear(c, c.spec.fleeRadius || 40);
    if (s && (hostileTo(g, s, c) || s === provoker(c) || s === c.scaredOf)) {
      ai.from = s;
      c.lockTime = 0;
      setAI(c, 'flee', 2.5);
      return;
    }
  }
  switch (ai.state) {
    case 'idle':
    case 'wander': {
      c.speedMul = 1;
      if (think && ai.state === 'idle' && ai.t >= ai.dur) {
        const r = rand(g);
        if (night && r < 0.6) {
          setAI(c, 'nap', 20 + rand(g) * 30);
          c.setState('sleep', 1);
          return;
        }
        const pip = g.entities?.get?.('pip');
        if (pip && alive(pip) && distTo(c, pip) < 150 && r < 0.45) {
          ai.follow = pip;
          setAI(c, 'follow', 6 + rand(g) * 8);
          return;
        }
        const lyra = g.companion;
        if (lyra && alive(lyra) && distTo(c, lyra) < 90 && (lyra.moved ?? 0) < 0.2 && r < 0.6) {
          ai.follow = lyra;
          setAI(c, 'follow', 4 + rand(g) * 4);
          return;
        }
        if (r < 0.75) {
          setAI(c, 'loaf', 5 + rand(g) * 9);
          c.setState('sit', 1);
          return;
        }
      }
      return wanderStep(c, dt, think, 80, 0.45);
    }
    case 'loaf':
    case 'nap':
      stopMove(c);
      c.setState(ai.state === 'nap' ? 'sleep' : 'sit', 0.5);
      if (ai.t >= ai.dur || (ai.state === 'nap' && !night && ai.t > 4)) {
        c.lockTime = 0;
        c.setState('idle');
        setAI(c, 'idle', 1 + rand(g) * 3);
      }
      return;
    case 'follow': {
      const f = ai.follow;
      if (!f || !alive(f) || ai.t >= ai.dur) {
        ai.follow = null;
        setAI(c, 'idle', 2 + rand(g) * 3);
        return;
      }
      const d = distTo(c, f);
      if (d < 18) {
        stopMove(c);
        c.faceToward(f.x, f.y);
        return;
      }
      c.speedMul = d > 60 ? 1.6 : 1;
      steer(c, f.x, f.y, d > 40 ? 1 : 0.6);
      return;
    }
    case 'flee':
      return fleeStep(c, dt, 'return');
    case 'return':
      return returnStep(c, dt, false);
    default:
      setAI(c, 'idle', 1);
  }
}

// ---------------------------------------------------------------- bats

function aiFlyer(c, dt, think) {
  const ai = c.ai;
  const g = c.game;
  // Wings never stop: a slow bob plus the flight state's height.
  const base = ai.state === 'windup' ? 16 : ai.state === 'dive' ? 5 : 9;
  ai.zt = (ai.zt ?? 9) + (base - (ai.zt ?? 9)) * Math.min(1, dt * 6);
  c.z = ai.zt + Math.sin(c.age * 7 + c.jitter * 9) * 1.6;
  switch (ai.state) {
    case 'idle':
    case 'wander': {
      c.speedMul = 1;
      if (think) {
        const t = scanTarget(c, aggroRange(c));
        if (t) return engage(c, t, 0.2);
      }
      // Erratic loops around the roost.
      const k = c.age * 0.9 + c.jitter * 20;
      steer(c, c.home.x + Math.sin(k) * 42 + Math.sin(k * 2.3) * 10, c.home.y + Math.cos(k * 1.3) * 26, 0.55);
      return;
    }
    case 'notice':
      if (ai.t >= ai.dur) setAI(c, 'chase', 0);
      stopMove(c);
      return;
    case 'chase': {
      const t = c.target;
      if ((think && !targetValid(c, t)) || !t || leashBroken(c)) return disengage(c);
      const d = distTo(c, t);
      if (attackReady(c) && d < 46) {
        stopMove(c);
        c.faceToward(t.x, t.y);
        setAI(c, 'windup', c.spec.attack.windup);
        c.telegraph = 0.2;
        return;
      }
      // Orbit the prey, closing in.
      const a = Math.atan2(c.y - t.y, c.x - t.x) + 0.9 * ai.flankSign * dt * 2;
      const r = 30;
      c.speedMul = c.spec.chase || 1.2;
      steer(c, t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, 1);
      return;
    }
    case 'windup':
      stopMove(c);
      c.telegraph = Math.min(1, 0.2 + ai.t / Math.max(0.05, ai.dur));
      if (ai.t >= ai.dur) {
        c.telegraph = 0;
        const t = c.target;
        ai.tx = t ? t.x : c.x;
        ai.ty = t ? t.y : c.y;
        ai.hit = false;
        setAI(c, 'dive', 0.5);
      }
      return;
    case 'dive': {
      const t = c.target;
      c.speedMul = 2.6;
      steer(c, ai.tx, ai.ty, 1);
      if (!ai.hit && t && alive(t) && distTo(c, t) < c.spec.attack.range + (t.radius ?? 4)) {
        ai.hit = true;
        c.setState('attack', 0.25);
        c.animTime = 0;
        try {
          g.combat?.melee?.(c, { target: t, arc: c.spec.attack.arc, range: c.spec.attack.range + 8, damageMul: 1, knockback: c.spec.attack.knockback, kind: 'bite', cooldown: 0.05 });
        } catch {
          /* missed */
        }
      }
      if (ai.hit || ai.t >= ai.dur) {
        ai.readyAt = now(g) + c.spec.attack.cooldown * (0.8 + rand(g) * 0.4);
        ai.from = t || null;
        setAI(c, 'retreat', 0.7);
      }
      return;
    }
    case 'retreat':
      c.speedMul = 1.6;
      if (ai.from) steerAway(c, ai.from.x, ai.from.y, 1);
      else stopMove(c);
      if (ai.t >= ai.dur) setAI(c, c.target ? 'chase' : 'idle', 0.5);
      return;
    case 'return':
      c.speedMul = 1.2;
      steer(c, c.home.x, c.home.y, 1);
      if (homeDist(c) < 20) setAI(c, 'idle', 1);
      return;
    case 'flee':
      return fleeStep(c, dt, 'return');
    default:
      setAI(c, 'idle', 1);
  }
}

// ---------------------------------------------------------------- archers

function aiArcher(c, dt, think) {
  const ai = c.ai;
  const g = c.game;
  const atk = c.spec.attack;
  const [near, far] = c.spec.keep || [70, 125];
  switch (ai.state) {
    case 'idle':
    case 'wander':
      c.speedMul = 1;
      if (think) {
        const t = scanTarget(c, aggroRange(c));
        if (t) {
          engage(c, t, 0.3);
          ai.readyAt = Math.max(ai.readyAt ?? 0, now(g) + 0.4);
          return;
        }
      }
      return wanderStep(c, dt, think, 40, 0.35);
    case 'notice':
      stopMove(c);
      if (!c.target) return disengage(c);
      c.faceToward(c.target.x, c.target.y);
      if (ai.t >= ai.dur) setAI(c, 'chase', 0);
      return;
    case 'chase': {
      const t = c.target;
      if ((think && !targetValid(c, t)) || !t || leashBroken(c)) return disengage(c);
      const d = distTo(c, t);
      trackVelocity(c, t, dt);
      if (think) ai.sight = sightLine(g, c.x, c.y - 8, t.x, t.y - 8);
      // Cornered: a quick dagger jab.
      if (d < 20 && attackReady(c)) {
        startWindup(c, 0.3);
        ai.jab = true;
        return;
      }
      // Back off first; shoot from up close only when there is nowhere left to go.
      if (d < near * 0.75) ai.backT = (ai.backT || 0) + dt;
      else ai.backT = 0;
      const cornered = ai.backT > 1.6;
      if (attackReady(c) && d <= atk.range && ai.sight !== false && d > 26 && (d >= near * 0.75 || cornered)) {
        stopMove(c);
        c.walker.stop();
        c.faceToward(t.x, t.y);
        setAI(c, 'draw', atk.windup);
        c.setState('attack', atk.windup + 0.05);
        c.animTime = 0;
        c.holdFrame = 1;
        c.telegraph = 0.15;
        return;
      }
      c.speedMul = 1;
      if (d < near) steerAway(c, t.x, t.y, 1);
      else if (d > far || ai.sight === false) chaseStep(c, t, dt, think, 0.9);
      else {
        // Strafe sideways while waiting for the next shot.
        if (ai.t > (ai.strafeT ?? 0)) {
          ai.strafe = rand(g) < 0.5 ? 1 : -1;
          ai.strafeT = ai.t + 1.2 + rand(g) * 1.6;
        }
        const s = ai.strafe || 1;
        const px = -(t.y - c.y) / d;
        const py = (t.x - c.x) / d;
        if (walkLine(g, c, c.x, c.y, c.x + px * s * 12, c.y + py * s * 12)) steer(c, c.x + px * s * 10, c.y + py * s * 10, 0.45);
        else ai.strafe = -s;
        c.faceToward(t.x, t.y);
      }
      return;
    }
    case 'draw': {
      stopMove(c);
      const t = c.target;
      c.telegraph = Math.min(1, 0.15 + ai.t / Math.max(0.05, ai.dur));
      if (t) {
        trackVelocity(c, t, dt);
        c.faceToward(t.x, t.y);
      }
      if (ai.t >= ai.dur) {
        c.holdFrame = null;
        c.telegraph = 0;
        c.animTime = 0;
        if (t && alive(t)) {
          // Lead a moving target a little.
          const lead = Math.min(0.45, distTo(c, t) / 260);
          const tx = t.x + (ai.vx || 0) * lead;
          const ty = t.y - 6 + (ai.vy || 0) * lead;
          try {
            g.combat?.shoot?.(c, tx, ty, 'arrow', { target: t });
          } catch (err) {
            if (!c._shootWarned) {
              c._shootWarned = true;
              console.error('[creature] shoot failed', err);
            }
          }
        }
        c.setState('attack', atk.recover);
        ai.readyAt = now(g) + atk.cooldown * (0.85 + rand(g) * 0.3);
        setAI(c, 'recover', atk.recover);
      }
      return;
    }
    case 'windup':
      stopMove(c);
      c.telegraph = Math.min(1, ai.t / Math.max(0.05, ai.dur));
      if (ai.t >= ai.dur) {
        strike(c, { damageMul: 0.6, kind: 'melee', range: 22, knockback: 80 });
        ai.jab = false;
        ai.readyAt = now(g) + 1;
        setAI(c, 'recover', 0.35);
      }
      return;
    case 'recover':
      stopMove(c);
      if (ai.t >= ai.dur) {
        if (c.target && targetValid(c, c.target)) setAI(c, 'chase', 0);
        else disengage(c);
      }
      return;
    case 'return':
      return returnStep(c, dt, think);
    default:
      setAI(c, 'idle', 1);
  }
}

function trackVelocity(c, t, dt) {
  const ai = c.ai;
  if (ai.lastTx != null && dt > 0) {
    const k = Math.min(1, dt * 6);
    ai.vx = (ai.vx || 0) + ((t.x - ai.lastTx) / dt - (ai.vx || 0)) * k;
    ai.vy = (ai.vy || 0) + ((t.y - ai.lastTy) / dt - (ai.vy || 0)) * k;
  }
  ai.lastTx = t.x;
  ai.lastTy = t.y;
}

export const CREATURE_AI_STATES = ['idle', 'wander', 'notice', 'chase', 'windup', 'recover', 'slam', 'paw', 'charge', 'flee', 'alert', 'return', 'loaf', 'nap', 'follow', 'dive', 'retreat', 'draw'];
