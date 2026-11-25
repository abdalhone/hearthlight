// Bodies: every live piece of a weave (a bolt, a ring, a beam, a familiar, a rune…). One
// pooled object type for all kinds; the kind picks the update below. Bodies are updated
// in fixed steps by the runtime (magic.js), collide with actors through its candidate
// list and with solid tiles through rt.wallAt, and hit through rt.hit (combat rules).
//
// Body fields (read by fx.js; the contract's list first):
//   kind 'projectile'|'area'|'beam'|'strike'|'summon'|'rune'|'wall'|'trail'|'bind'|'ward'
//              (bind: the ring holding a bound target; ward: a shield on its bearer)
//   x, y (ground position, world px), vx, vy, r, angle, age, life, owner, plan,
//   essences (ids), palette {core, glow, spark, deep}, gen
//   mode       projectile: 'fly' | 'orb' | 'lob' | 'fall' | 'arc' (a chain arc)
//              area: 'ring' | 'cone' | 'burst' | 'patch' | 'rain'
//   z          height for drawing (missiles fly at chest height, lobs arc, drops fall)
//   r0, r1, cur   area radii: start, end, current;  arc = cone half-angle
//   x2, y2, len   wall / trail segment;  pts, npts = beam polyline (x0,y0,x1,y1,…)
//   dmg, speed, range, traveled, pierceLeft, bounceLeft, homing, target
//   orbitT, orbitA, orbitR, spin, spiralAmp, spiralFreq, wobble   twist motion
//   armed (rune), held (beam), cast (the cast record), index (place in its emission)
//   target     bind: who it holds; ward: its bearer (homing missiles: their mark)
//   shield, shieldMax, hitT   a ward's strength left, at its raising, when it last took a blow
//   delay      seconds before it starts (staggered novas, punches)
//   seed       0..1, stable per body (for visual variety)
//   fxState    free slot for fx.js to keep per-body state (reset when the body is reused)
//   trail      Float32Array ring of recent positions (x, y pairs), trailN, trailI

const TAU = Math.PI * 2;
const EMPTY = Object.freeze([]);

export class Body {
  constructor() {
    this.hits = new Map(); // target -> last hit time (body.age), so areas hit once and ticks space out
    this.pts = new Float32Array(16);
    this.trail = new Float32Array(16);
    this.chainSeen = [];
    this.procs = {};
    this.procAt = {};
    this.reset();
  }

  reset() {
    this.active = false;
    this.ending = false;
    this.uid = 0;
    this.charge = 0; // the charge k it was cast with (0: a tap, a child, an echo)
    this.kind = 'projectile';
    this.mode = 'fly';
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.bx = 0;
    this.by = 0;
    this.px = 0;
    this.py = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.r = 4;
    this.angle = 0;
    this.age = 0;
    this.life = 1;
    this.delay = 0;
    this.owner = null;
    this.plan = null;
    this.cast = null;
    this.essences = EMPTY;
    this.palette = null;
    this.gen = 0;
    this.index = 0;
    this.dmg = 0;
    this.speed = 0;
    this.range = 0;
    this.traveled = 0;
    this.pierceLeft = 0;
    this.bounceLeft = 0;
    this.homing = 0;
    this.seekT = 0;
    this.target = null;
    this.tx = 0;
    this.ty = 0;
    this.ox = 0;
    this.oy = 0;
    this.x2 = 0;
    this.y2 = 0;
    this.len = 0;
    this.r0 = 0;
    this.r1 = 0;
    this.cur = 0;
    this.arc = 0;
    this.burstR = 0;
    this.pulseR = 0;
    this.tick = 0.5;
    this.tickT = 0;
    this.tickMul = 1;
    this.flight = 0;
    this.peak = 0;
    this.orbitT = 0;
    this.orbitA = 0;
    this.orbitR = 0;
    this.spin = 0;
    this.spiralAmp = 0;
    this.spiralFreq = 0;
    this.spiralPh = 0;
    this.spiralRain = false;
    this.wobble = 0;
    this.follow = false;
    this.followOwner = false;
    this.held = false;
    this.aimOffset = 0;
    this.armed = false;
    this.armT = 0;
    this.trigR = 0;
    this.aggro = 0;
    this.atkT = 0;
    this.atkCd = 1;
    this.atkRange = 50;
    this.slot = 0;
    this.drops = 0;
    this.dropR = 8;
    this.carry = null;
    this.chainLeft = 0;
    this.chainSeen.length = 0;
    this.npts = 0;
    this.trailN = 0;
    this.trailI = 0;
    this.trailT = 0;
    this.noHit = false;
    this.heavy = false;
    this.knockMul = 1;
    this.dashing = false;
    this.lastTx = -99999;
    this.lastTy = -99999;
    this.seed = 0;
    this.shield = 0;
    this.shieldMax = 0;
    this.hitT = -9;
    this.plateA = 0;
    this.braceT = 0;
    this.wardSeen = 0;
    this.fxState = null;
    this.why = '';
    this.hits.clear();
    for (const k in this.procs) this.procs[k] = 0;
    for (const k in this.procAt) this.procAt[k] = -1e9;
  }

  // Remember the last few positions (fx and the fallback draw streaks from them).
  pushTrail() {
    const t = this.trail;
    const i = this.trailI;
    t[i * 2] = this.x;
    t[i * 2 + 1] = this.y;
    this.trailI = (i + 1) % 8;
    if (this.trailN < 8) this.trailN++;
  }
}

// ------------------------------------------------------------------ geometry

const SEG = { d: 0, x: 0, y: 0, t: 0 };

// Distance from (px, py) to the segment (x1, y1)-(x2, y2); the closest point lands in SEG.
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  SEG.x = x1 + dx * t;
  SEG.y = y1 + dy * t;
  SEG.t = t;
  SEG.d = Math.hypot(px - SEG.x, py - SEG.y);
  return SEG.d;
}
export { SEG };

export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

// ------------------------------------------------------------------ hit flags (shared, read-only)

export const HIT = Object.freeze({});
export const HIT_HEAVY = Object.freeze({ heavy: true, knock: 1.5 });
export const HIT_TICK = Object.freeze({ tick: true });
export const HIT_PUNCH = Object.freeze({ heavy: true, knock: 2 });
export const HIT_POOL = Object.freeze({ pool: true }); // a full hit whose number is pooled (rain drops)
export const HIT_BITE = Object.freeze({ tick: true, dot: true }); // a bind's ring biting the one it holds

const alive = (a) => !a.removed && !a.dead && a.isAlive();

// Hit every candidate the cast may affect inside a circle (once per body unless `again`
// seconds have passed since that target's last hit from it). Returns targets hit.
export function hitCircle(rt, b, x, y, r, mul, flags, again = 0) {
  const list = rt.cands;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const rr = r + (a.radius ?? 5);
    const dx = a.x - x;
    const dy = a.y - y;
    if (dx > rr || dx < -rr || dy > rr || dy < -rr || dx * dx + dy * dy > rr * rr) continue;
    const last = b.hits.get(a);
    if (last !== undefined && (again <= 0 || b.age - last < again)) continue;
    if (!alive(a) || !rt.canAffect(b.cast, a)) continue;
    b.hits.set(a, b.age);
    rt.hit(b, a, mul, flags);
    n++;
    if (!b.active) break;
  }
  return n;
}

// ------------------------------------------------------------------ kinds

function launch(rt, b) {
  const aim = rt.aimOf(b.cast);
  let tx = aim.x;
  let ty = aim.y;
  const foe = b.plan.aimAssist || b.homing > 0 ? rt.nearestFoe(b, b.x, b.y, 160, null) : null;
  if (foe) {
    tx = foe.x;
    ty = foe.y;
    b.target = foe;
  }
  let a = Math.atan2(ty - b.y, tx - b.x);
  if (!Number.isFinite(a)) a = b.angle;
  b.angle = a;
  b.vx = Math.cos(a) * b.speed;
  b.vy = Math.sin(a) * b.speed;
  b.bx = b.x;
  b.by = b.y;
  b.spiralPh = 0;
  rt.fx('launch', { body: b });
}

function steer(b, dt) {
  const t = b.target;
  if (!t || t.removed || t.dead || (t.isAlive && !t.isAlive())) return;
  const want = Math.atan2(t.y - b.by, t.x - b.bx);
  const cur = Math.atan2(b.vy, b.vx);
  const d = angleDiff(want, cur);
  const turn = b.homing * dt;
  const a = cur + (d > turn ? turn : d < -turn ? -turn : d);
  const sp = Math.hypot(b.vx, b.vy) || b.speed;
  b.vx = Math.cos(a) * sp;
  b.vy = Math.sin(a) * sp;
}

// Missiles: bolts, orbs, split shards, familiar shots, chain arcs.
function updateMissile(rt, b, dt) {
  const o = b.owner;
  if (b.orbitT > 0) {
    b.orbitT -= dt;
    b.orbitA += dt * 6.5;
    const cx = o && !o.removed ? o.x : b.ox;
    const cy = o && !o.removed ? o.y : b.oy;
    b.x = cx + Math.cos(b.orbitA) * b.orbitR;
    b.y = cy + Math.sin(b.orbitA) * b.orbitR * 0.8;
    b.angle = b.orbitA + Math.PI / 2;
    if (!b.noHit) hitCircle(rt, b, b.x, b.y, b.r, 0.5, HIT, 0.6);
    if (b.orbitT <= 0 && b.active) launch(rt, b);
    return;
  }
  if (b.homing > 0) {
    b.seekT -= dt;
    if (b.seekT <= 0) {
      b.seekT = 0.15;
      const t = b.target;
      if (!t || t.removed || t.dead || (t.isAlive && !t.isAlive()) || (b.mode !== 'arc' && b.hits.has(t))) {
        b.target = b.mode === 'arc' ? null : rt.nearestFoe(b, b.bx + b.vx * 0.25, b.by + b.vy * 0.25, 150, null, b);
      }
    }
    steer(b, dt);
  }
  if (b.mode === 'arc' && !b.target) {
    rt.end(b, 'expire');
    return;
  }
  const sx = b.vx * dt;
  const sy = b.vy * dt;
  const dist = Math.hypot(sx, sy);
  const steps = Math.max(1, Math.ceil(dist / 4));
  const ux = dist > 0 ? sx / dist : 0;
  const uy = dist > 0 ? sy / dist : 0;
  for (let s = 0; s < steps; s++) {
    const pbx = b.bx;
    const pby = b.by;
    b.bx += sx / steps;
    b.by += sy / steps;
    if (b.spiralAmp > 0) {
      b.spiralPh += (b.spiralFreq * dt) / steps;
      const off = Math.sin(b.spiralPh) * b.spiralAmp;
      b.x = b.bx - uy * off;
      b.y = b.by + ux * off;
    } else {
      b.x = b.bx;
      b.y = b.by;
    }
    if (b.mode !== 'arc' && rt.wallAt(b.x, b.y)) {
      if (b.bounceLeft > 0) {
        b.bounceLeft--;
        const hx = rt.wallAt(b.bx, pby);
        const hy = rt.wallAt(pbx, b.by);
        if (hx || !hy) b.vx = -b.vx;
        if (hy || !hx) b.vy = -b.vy;
        b.bx = pbx;
        b.by = pby;
        b.x = pbx;
        b.y = pby;
        b.angle = Math.atan2(b.vy, b.vx);
        rt.fx('bounce', { body: b, x: b.x, y: b.y });
        break;
      }
      rt.end(b, 'wall');
      return;
    }
    if (b.noHit) continue;
    if (b.mode === 'arc') {
      const t = b.target;
      const rr = b.r + (t.radius ?? 5) + 2;
      if (Math.abs(t.x - b.x) <= rr && Math.abs(t.y - b.y) <= rr) {
        if (rt.canAffect(b.cast, t)) {
          b.hits.set(t, b.age);
          rt.hit(b, t, 1, HIT);
        }
        rt.end(b, 'hit');
        return;
      }
      continue;
    }
    if (b.mode === 'orb') continue; // orbs hurt by pulsing, below
    const list = rt.cands;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const rr = b.r + (a.radius ?? 5);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx > rr || dx < -rr || dy > rr || dy < -rr || dx * dx + dy * dy > rr * rr) continue;
      if (b.hits.has(a) || !alive(a) || !rt.canAffect(b.cast, a)) continue;
      b.hits.set(a, b.age);
      rt.hit(b, a, 1, b.heavy ? HIT_HEAVY : HIT);
      if (!b.active || b.ending) return;
      if (b.pierceLeft > 0) {
        b.pierceLeft--;
        continue;
      }
      if (b.bounceLeft > 0) {
        // Ricochet off the target toward the next foe.
        const next = rt.nearestFoe(b, a.x, a.y, 90, null, b);
        if (next) {
          b.bounceLeft--;
          const ang = Math.atan2(next.y - b.y, next.x - b.x);
          const sp = Math.hypot(b.vx, b.vy) || b.speed;
          b.vx = Math.cos(ang) * sp;
          b.vy = Math.sin(ang) * sp;
          b.angle = ang;
          b.target = b.homing > 0 ? next : b.target;
          rt.fx('bounce', { body: b, x: b.x, y: b.y });
          return;
        }
      }
      rt.end(b, 'hit');
      return;
    }
  }
  b.angle = Math.atan2(b.vy, b.vx);
  b.traveled += dist;
  if (b.mode === 'orb') {
    b.tickT -= dt;
    if (b.tickT <= 0) {
      b.tickT += b.tick;
      if (hitCircle(rt, b, b.x, b.y, b.pulseR, 1, HIT_TICK, b.tick * 0.9) > 0) rt.fx('pulse', { body: b });
      else rt.fx('pulse', { body: b, empty: true });
      if (!b.active) return;
    }
  }
  if (b.range > 0 && b.traveled >= b.range) rt.end(b, 'expire');
}

// A lobbed bomb: arcs to its spot, bursts, maybe hops on (bounce).
function updateLob(rt, b, dt) {
  const k = b.flight > 0 ? Math.min(1, (b.age - b.tickT) / b.flight) : 1;
  b.x = b.ox + (b.tx - b.ox) * k;
  b.y = b.oy + (b.ty - b.oy) * k;
  b.z = Math.sin(k * Math.PI) * b.peak + 6 * (1 - k);
  b.angle += dt * 9;
  if (k < 1) return;
  b.z = 0;
  rt.explode(b, b.x, b.y, b.burstR, 1, 'land', true);
  if (!b.active) return;
  if (b.bounceLeft > 0) {
    b.bounceLeft--;
    const a = Math.atan2(b.ty - b.oy, b.tx - b.ox);
    b.ox = b.x;
    b.oy = b.y;
    b.tx = b.x + Math.cos(a) * 42;
    b.ty = b.y + Math.sin(a) * 42;
    b.flight = 0.32;
    b.peak = 10;
    b.tickT = b.age;
    b.dmg *= 0.7;
    b.life = b.age + 2;
    return;
  }
  rt.end(b, 'land');
}

// A rain drop: falls on its spot and splashes.
function updateFall(rt, b, dt) {
  b.z -= b.vz * dt;
  if (b.z > 0) return;
  b.z = 0;
  hitCircle(rt, b, b.x, b.y, b.r1, 1, HIT_POOL);
  if (!b.active) return;
  rt.fx('impact', { body: b, x: b.x, y: b.y, r: b.r1 });
  rt.mark(b, b.x, b.y, b.r1 * 0.8, 0.25);
  rt.end(b, 'land');
}

function updateProjectile(rt, b, dt) {
  if (b.mode === 'lob') return updateLob(rt, b, dt);
  if (b.mode === 'fall') return updateFall(rt, b, dt);
  updateMissile(rt, b, dt);
  if (b.active) {
    b.trailT -= dt;
    if (b.trailT <= 0) {
      b.trailT = 0.03;
      b.pushTrail();
    }
  }
}

function followOwner(b) {
  const o = b.owner;
  if (!o || o.removed) return;
  b.x = o.x;
  b.y = o.y;
}

function updateArea(rt, b, dt) {
  if ((b.follow || b.followOwner) && b.age < b.life) followOwner(b);
  const k = Math.min(1, b.age / Math.max(0.01, b.life));
  switch (b.mode) {
    case 'ring': {
      b.cur = b.r0 + (b.r1 - b.r0) * (1 - (1 - k) * (1 - k));
      b.angle += b.spin * dt;
      hitCircle(rt, b, b.x, b.y, b.cur, 1, b.heavy ? HIT_HEAVY : HIT);
      break;
    }
    case 'cone': {
      b.cur = b.r0 + (b.r1 - b.r0) * Math.min(1, k * 1.6);
      b.angle += b.spin * dt;
      hitCone(rt, b, b.x, b.y, b.angle, b.arc, b.cur, 1, HIT);
      break;
    }
    case 'burst': {
      b.cur = b.r1 * Math.min(1, 0.45 + k * 1.4);
      if (!b.armed) {
        b.armed = true;
        hitCircle(rt, b, b.x, b.y, b.r1, 1, b.heavy ? HIT_HEAVY : HIT);
      }
      break;
    }
    case 'patch': {
      b.cur = b.r1 * Math.min(1, 0.4 + b.age * 4);
      b.tickT -= dt;
      if (b.tickT <= 0) {
        b.tickT += b.tick;
        hitCircle(rt, b, b.x, b.y, b.r1, b.tickMul, HIT_TICK, b.tick * 0.9);
      }
      break;
    }
    case 'rain': {
      b.cur = b.r1;
      if (b.drops <= 0) break;
      const every = (b.life * 0.85) / b.drops;
      b.tickT -= dt;
      while (b.tickT <= 0 && b.active) {
        b.tickT += every;
        let px;
        let py;
        if (b.spiralRain) {
          const ang = b.age * 9 + b.seed * TAU;
          const rr = b.r1 * (0.25 + 0.75 * ((b.age * 1.7) % 1));
          px = b.x + Math.cos(ang) * rr;
          py = b.y + Math.sin(ang) * rr * 0.8;
        } else {
          const ang = rt.random() * TAU;
          const rr = Math.sqrt(rt.random()) * b.r1;
          px = b.x + Math.cos(ang) * rr;
          py = b.y + Math.sin(ang) * rr * 0.8;
        }
        rt.spawnFrom(b, b.plan, 'projectile', { mode: 'fall', x: px, y: py, z: 90 + rt.random() * 30, vz: 320, r: 2 + b.plan.size, r1: b.dropR, dmg: b.dmg, life: 2 });
      }
      break;
    }
    default:
      break;
  }
}

// Everyone in a growing cone (blast, a strike's wave).
function hitCone(rt, b, x, y, ang, arc, r, mul, flags) {
  const list = rt.cands;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const rr = r + (a.radius ?? 5);
    const dx = a.x - x;
    const dy = a.y - y;
    if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
    const d = Math.hypot(dx, dy);
    if (d > rr || b.hits.has(a)) continue;
    if (d > 6) {
      const slack = Math.atan2(a.radius ?? 5, d);
      if (Math.abs(angleDiff(Math.atan2(dy, dx), ang)) > arc + slack) continue;
    }
    if (!alive(a) || !rt.canAffect(b.cast, a)) continue;
    b.hits.set(a, b.age);
    rt.hit(b, a, mul, flags);
    if (!b.active) return;
  }
}

// A punch: the fist lands first (heavy), then an impact wave rolls out in a cone.
function updateStrike(rt, b, dt) {
  if (b.follow) followOwner(b);
  if (!b.armed) {
    b.armed = true;
    const fx = b.x + Math.cos(b.angle) * b.r * 1.1;
    const fy = b.y + Math.sin(b.angle) * b.r * 1.1;
    hitCircle(rt, b, fx, fy, b.r, 1, HIT_PUNCH);
    if (!b.active) return;
    rt.fx('impact', { body: b, x: fx, y: fy, r: b.r });
  }
  const k = Math.min(1, b.age / Math.max(0.01, b.life));
  b.cur = b.r + (b.r1 - b.r) * k;
  hitCone(rt, b, b.x, b.y, b.angle, b.arc, b.cur, 0.55, HIT);
}

// March a ray from (x, y) along `ang` for `range` px, reflecting off walls up to `bounces`
// times. Fills b.pts / b.npts.
function traceBeam(rt, b, x, y, ang, range, bounces) {
  const pts = b.pts;
  let n = 0;
  pts[n++] = x;
  pts[n++] = y;
  let dx = Math.cos(ang);
  let dy = Math.sin(ang);
  let left = range;
  let cx = x;
  let cy = y;
  const step = 3;
  while (left > 0 && n < pts.length - 2) {
    const nx = cx + dx * step;
    const ny = cy + dy * step;
    if (rt.wallAt(nx, ny)) {
      if (bounces > 0) {
        bounces--;
        const hx = rt.wallAt(nx, cy);
        const hy = rt.wallAt(cx, ny);
        if (hx || !hy) dx = -dx;
        if (hy || !hx) dy = -dy;
        pts[n++] = cx;
        pts[n++] = cy;
        continue;
      }
      break;
    }
    cx = nx;
    cy = ny;
    left -= step;
  }
  pts[n++] = cx;
  pts[n++] = cy;
  b.npts = n >> 1;
}

function updateBeam(rt, b, dt) {
  const o = b.owner;
  if (!o || o.removed || o.dead || (o.isAlive && !o.isAlive())) {
    rt.end(b, 'dismiss');
    return;
  }
  b.x = o.x;
  b.y = o.y;
  if (b.held && b.cast && b.cast.holding === false) {
    b.held = false;
    b.life = Math.min(b.life, b.age + 0.12);
  }
  if (b.held) {
    const aim = rt.aimOf(b.cast);
    const want = Math.atan2(aim.y - o.y, aim.x - o.x) + b.aimOffset;
    if (Number.isFinite(want)) {
      const d = angleDiff(want, b.tx);
      const turn = 9 * dt;
      b.tx += d > turn ? turn : d < -turn ? -turn : d;
    }
  }
  b.tx += b.spin * dt;
  const ang = b.tx + (b.wobble ? Math.sin(b.age * 8 + b.seed * 6) * b.wobble : 0);
  b.angle = ang;
  traceBeam(rt, b, o.x + Math.cos(ang) * 6, o.y + Math.sin(ang) * 6, ang, b.range, b.bounceLeft);
  b.tickT -= dt;
  if (b.tickT > 0) return;
  b.tickT += b.tick;
  const list = rt.cands;
  const pts = b.pts;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const reach = b.r + (a.radius ?? 5);
    let hit = false;
    for (let s = 0; s < b.npts - 1 && !hit; s++) {
      const x1 = pts[s * 2];
      const y1 = pts[s * 2 + 1];
      const x2 = pts[s * 2 + 2];
      const y2 = pts[s * 2 + 3];
      if (a.x < Math.min(x1, x2) - reach || a.x > Math.max(x1, x2) + reach || a.y < Math.min(y1, y2) - reach || a.y > Math.max(y1, y2) + reach) continue;
      if (segDist(a.x, a.y, x1, y1, x2, y2) <= reach) hit = true;
    }
    if (!hit || !alive(a) || !rt.canAffect(b.cast, a)) continue;
    b.hits.set(a, b.age);
    rt.hit(b, a, 1, HIT_TICK);
    if (!b.active) return;
  }
}

function updateSummon(rt, b, dt) {
  const o = b.owner;
  if (!o || o.removed || o.dead) {
    rt.end(b, 'dismiss');
    return;
  }
  b.seekT -= dt;
  if (b.seekT <= 0) {
    b.seekT = 0.35;
    const t = b.target;
    const keep = t && !t.removed && !t.dead && t.isAlive?.() && rt.canAffect(b.cast, t) && Math.hypot(t.x - o.x, t.y - o.y) < b.aggro * 1.5;
    if (!keep) b.target = rt.nearestFoe(b, o.x, o.y, b.aggro, null);
  }
  const t = b.target;
  let gx;
  let gy;
  if (b.orbitR > 0) {
    b.orbitA += dt * 2.4;
    gx = o.x + Math.cos(b.orbitA) * b.orbitR;
    gy = o.y + Math.sin(b.orbitA) * b.orbitR * 0.8;
  } else if (t) {
    const d = Math.hypot(t.x - b.x, t.y - b.y) || 1;
    const want = b.atkRange * 0.75;
    gx = t.x - ((t.x - b.x) / d) * want;
    gy = t.y - ((t.y - b.y) / d) * want;
  } else {
    const f = o.facing || { x: 0, y: 1 };
    const side = b.slot % 2 ? -1 : 1;
    const back = Math.atan2(-f.y, -f.x) + side * (0.9 + 0.25 * Math.floor(b.slot / 2));
    gx = o.x + Math.cos(back) * (16 + b.slot * 3);
    gy = o.y + Math.sin(back) * (12 + b.slot * 3);
  }
  const dx = gx - b.x;
  const dy = gy - b.y;
  const d = Math.hypot(dx, dy);
  const sp = b.speed * (t ? 1.2 : d > 60 ? 2.2 : 1) * dt;
  if (d > 1) {
    const m = Math.min(d, sp);
    b.x += (dx / d) * m;
    b.y += (dy / d) * m;
    b.angle = Math.atan2(dy, dx);
  }
  b.z = 8 + Math.sin(b.age * 4 + b.seed * TAU) * 2;
  // Too far behind (the caster ran off or went through a door): catch up at once.
  if (Math.hypot(o.x - b.x, o.y - b.y) > 260) {
    b.x = o.x;
    b.y = o.y - 6;
  }
  b.atkT -= dt;
  if (!t || b.atkT > 0) return;
  const td = Math.hypot(t.x - b.x, t.y - b.y);
  if (td > b.atkRange + 6) return;
  b.atkT = b.atkCd;
  rt.familiarAttack(b, t);
}

function updateRune(rt, b, dt) {
  if (!b.armed) {
    b.armT -= dt;
    if (b.armT <= 0) {
      b.armed = true;
      rt.fx('armed', { body: b });
    }
    return;
  }
  b.seekT -= dt;
  if (b.seekT > 0) return;
  b.seekT = 0.08;
  if (b.homing > 0) {
    const f = rt.nearestFoe(b, b.x, b.y, 70, null);
    if (f) {
      const d = Math.hypot(f.x - b.x, f.y - b.y) || 1;
      b.x += ((f.x - b.x) / d) * Math.min(d, 26 * 0.08 * (1 + b.homing * 0.1));
      b.y += ((f.y - b.y) / d) * Math.min(d, 26 * 0.08 * (1 + b.homing * 0.1));
    }
  }
  const list = rt.cands;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const rr = b.trigR + (a.radius ?? 5);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy > rr * rr || !alive(a) || !rt.canAffect(b.cast, a)) continue;
    rt.explode(b, b.x, b.y, b.burstR, 1, 'trigger', true);
    if (!b.active) return;
    if (b.bounceLeft > 0) {
      b.bounceLeft--;
      b.armed = false;
      b.armT = 0.9;
      return;
    }
    rt.end(b, 'trigger');
    return;
  }
}

function wallEnds(b) {
  const c = Math.cos(b.angle) * b.len * 0.5;
  const s = Math.sin(b.angle) * b.len * 0.5;
  b.ox = b.x - c;
  b.oy = b.y - s;
  b.x2 = b.x + c;
  b.y2 = b.y + s;
}

function updateWall(rt, b, dt) {
  const o = b.owner;
  if (b.orbitR > 0 && o && !o.removed) {
    b.orbitA += b.spin * dt;
    b.x = o.x + Math.cos(b.orbitA) * b.orbitR;
    b.y = o.y + Math.sin(b.orbitA) * b.orbitR * 0.85;
    b.angle = b.orbitA + Math.PI / 2;
  } else if (b.wobble) {
    b.angle += Math.sin(b.age * 2.4) * b.wobble * dt;
  }
  wallEnds(b);
  const list = rt.cands;
  const reachW = b.r;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const reach = reachW + (a.radius ?? 5);
    if (a.x < Math.min(b.ox, b.x2) - reach || a.x > Math.max(b.ox, b.x2) + reach || a.y < Math.min(b.oy, b.y2) - reach || a.y > Math.max(b.oy, b.y2) + reach) continue;
    const d = segDist(a.x, a.y, b.ox, b.oy, b.x2, b.y2);
    if (d >= reach || !alive(a) || !rt.canAffect(b.cast, a)) continue;
    // Shove the foe out of the wall, then let it burn (or freeze, or…) on contact.
    let nx = a.x - SEG.x;
    let ny = a.y - SEG.y;
    let nl = Math.hypot(nx, ny);
    if (nl < 0.01) {
      nx = -Math.sin(b.angle);
      ny = Math.cos(b.angle);
      const side = (a.x - b.x) * nx + (a.y - b.y) * ny;
      if (side < 0) {
        nx = -nx;
        ny = -ny;
      }
      nl = 1;
    }
    rt.pushActor(a, (nx / nl) * (reach - d + 0.5), (ny / nl) * (reach - d + 0.5));
    const last = b.hits.get(a);
    if (last === undefined || b.age - last >= b.tick) {
      b.hits.set(a, b.age);
      rt.hit(b, a, last === undefined ? 1 : 0.6, last === undefined ? HIT : HIT_TICK);
      if (!b.active) return;
    }
  }
  rt.blockShots(b);
}

function updateTrail(rt, b, dt) {
  const o = b.owner;
  if (b.follow && b.dashing && o && !o.removed) {
    b.x2 = o.x;
    b.y2 = o.y;
  }
  b.len = Math.hypot(b.x2 - b.x, b.y2 - b.y);
  b.angle = b.len > 0.5 ? Math.atan2(b.y2 - b.y, b.x2 - b.x) : b.angle;
  const list = rt.cands;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const reach = b.r + (a.radius ?? 5);
    if (a.x < Math.min(b.x, b.x2) - reach || a.x > Math.max(b.x, b.x2) + reach || a.y < Math.min(b.y, b.y2) - reach || a.y > Math.max(b.y, b.y2) + reach) continue;
    if (segDist(a.x, a.y, b.x, b.y, b.x2, b.y2) > reach) continue;
    const last = b.hits.get(a);
    if (last !== undefined && b.age - last < b.tick) continue;
    if (!alive(a) || !rt.canAffect(b.cast, a)) continue;
    b.hits.set(a, b.age);
    rt.hit(b, a, last === undefined ? 1 : 0.4, last === undefined ? HIT : HIT_TICK);
    if (!b.active) return;
  }
}

// A bind's hold (DESIGN §22.5): the ring closes on its target's feet and stays there while
// the target is bound, biting now and then with its weave's essences.
function updateBind(rt, b, dt) {
  const t = b.target;
  if (!t || t.removed || t.dead || !alive(t)) {
    rt.end(b, 'free');
    return;
  }
  b.x = t.x;
  b.y = t.y;
  b.cur = b.r * (b.age < 0.22 ? 2.2 - 1.2 * (b.age / 0.22) : 1);
  if (b.age > 0.3 && !rt.status.has(t, 'bound')) {
    rt.end(b, 'free');
    return;
  }
  if (b.tickMul <= 0) return;
  b.tickT -= dt;
  if (b.tickT > 0) return;
  b.tickT += b.tick;
  if (rt.canAffect(b.cast, t)) rt.hit(b, t, b.tickMul, HIT_BITE);
}

// A ward (DESIGN §22.5) rides on its bearer; the runtime does the shielding (absorb, the
// shots it stops, its flavors) in wardStep.
function updateWard(rt, b, dt) {
  const t = b.target;
  if (!t || t.removed || t.dead || !alive(t)) {
    rt.end(b, 'break');
    return;
  }
  b.x = t.x;
  b.y = t.y;
  b.cur = b.r * (b.age < 0.18 ? 0.35 + 0.65 * (b.age / 0.18) : 1);
  rt.wardStep(b, dt);
}

export const KIND_UPDATE = {
  projectile: updateProjectile,
  area: updateArea,
  beam: updateBeam,
  strike: updateStrike,
  summon: updateSummon,
  rune: updateRune,
  wall: updateWall,
  trail: updateTrail,
  bind: updateBind,
  ward: updateWard,
};

export const KINDS = Object.keys(KIND_UPDATE);
