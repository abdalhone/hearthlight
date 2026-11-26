// Shared pieces every boss is made of: telegraph markers (what the player reads), area
// hits (what lands exactly where the marker said), steering inside an arena, and adds.
// Markers and hits use the same world-pixel shapes, so a marker never lies: if your feet
// are outside the drawn shape when it fills, the blow misses.

import { alive, hostileTo, walkLine, rand } from '../entities/creature_util.js';
import { wallBetween } from '../world/walls.js';

export const DANGER = '#ff6b5e';
export const DANGER_EDGE = '#ffd0a0';

// ---------------------------------------------------------------- markers

// kind: 'circle' {x,y,r} | 'line' {x,y,angle,len,w} | 'cone' {x,y,angle,range,arc}
//       'ring' {x,y,r} (an expanding wave to come) | 'arc' {x,y,r,a0,a1,w} (a sweep)
// t/dur drive the fill; follow: an entity the marker's origin sticks to.
export function addMarker(b, m) {
  const mk = { t: 0, dur: 0.8, color: b.info?.markColor || DANGER, edge: DANGER_EDGE, ...m };
  b.markers.push(mk);
  return mk;
}

export function clearMarkers(b) {
  b.markers.length = 0;
}

export function updateMarkers(b, dt) {
  const list = b.markers;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    m.t += dt;
    if (m.follow && !m.follow.removed) {
      m.x = m.follow.x + (m.fx || 0);
      m.y = m.follow.y + (m.fy || 0);
    }
    if (m.life != null && m.t >= m.life) list.splice(i, 1);
  }
}

// Ground markers in the low-res buffer, before anything stands on them.
export function drawMarkers(ctx, list, ox, oy, time) {
  for (let i = 0; i < list.length; i++) drawMarker(ctx, list[i], ox, oy, time);
  ctx.globalAlpha = 1;
}

export function drawMarker(ctx, m, ox, oy, time) {
  const k = Math.max(0, Math.min(1, m.t / Math.max(0.05, m.dur)));
  const pulse = 0.5 + 0.5 * Math.sin(time * 16);
  const x = m.x - ox;
  const y = m.y - oy;
  ctx.fillStyle = m.color;
  ctx.strokeStyle = m.edge;
  ctx.lineWidth = 1;
  switch (m.kind) {
    case 'circle': {
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.22 + 0.22 * k;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, m.r * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.4 * pulse * k;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'ring': {
      // A wave will roll outward: show the band it will sweep.
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * k;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, m.r * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'line': {
      const ca = Math.cos(m.angle);
      const sa = Math.sin(m.angle);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(m.angle);
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, -m.w / 2, m.len, m.w);
      ctx.globalAlpha = 0.25 + 0.2 * k;
      ctx.fillRect(0, -m.w / 2, m.len * k, m.w);
      ctx.globalAlpha = 0.5 + 0.4 * pulse * k;
      ctx.strokeRect(0.5, -m.w / 2 + 0.5, m.len - 1, m.w - 1);
      // Chevrons along the path say which way it comes.
      ctx.globalAlpha = 0.35 + 0.4 * k;
      ctx.beginPath();
      const step = 14;
      const off = (time * 30) % step;
      for (let d = off + 6; d < m.len - 4; d += step) {
        ctx.moveTo(d - 3, -3);
        ctx.lineTo(d, 0);
        ctx.lineTo(d - 3, 3);
      }
      ctx.stroke();
      ctx.restore();
      void ca;
      void sa;
      break;
    }
    case 'cone': {
      const a0 = m.angle - m.arc / 2;
      const a1 = m.angle + m.arc / 2;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, m.range, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.24 + 0.22 * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, Math.max(1, m.range * k), a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.4 * pulse * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, m.range, a0, a1);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'arc': {
      // A sweeping beam: the band it will cover.
      ctx.globalAlpha = 0.18 + 0.2 * k;
      ctx.lineWidth = m.w;
      ctx.strokeStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, y, m.r, m.a0, m.a1, m.a1 < m.a0);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = m.edge;
      ctx.globalAlpha = 0.5 + 0.4 * pulse * k;
      ctx.beginPath();
      ctx.arc(x, y, m.r + m.w / 2, m.a0, m.a1, m.a1 < m.a0);
      ctx.stroke();
      break;
    }
    case 'arrows': {
      // The tide: a field of arrows showing where everything will be pushed.
      const ca = Math.cos(m.angle);
      const sa = Math.sin(m.angle);
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.beginPath();
      const span = m.r;
      const step = 22;
      const shift = (time * 26) % step;
      for (let u = -span; u <= span; u += step) {
        for (let v = -span; v <= span; v += step) {
          if (u * u + v * v > span * span) continue;
          const px = x + ca * (u + shift) - sa * v;
          const py = y + sa * (u + shift) + ca * v;
          ctx.moveTo(px - ca * 4 - sa * 3, py - sa * 4 + ca * 3);
          ctx.lineTo(px, py);
          ctx.lineTo(px - ca * 4 + sa * 3, py - sa * 4 - ca * 3);
        }
      }
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- geometry

export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

// Is the actor's body (feet circle) inside the shape?
export function inShape(m, e) {
  const r = e.radius ?? 5;
  switch (m.kind) {
    case 'circle':
      return Math.hypot(e.x - m.x, e.y - m.y) <= m.r + r * 0.6;
    case 'line': {
      const x1 = m.x + Math.cos(m.angle) * m.len;
      const y1 = m.y + Math.sin(m.angle) * m.len;
      return segDist(e.x, e.y, m.x, m.y, x1, y1) <= m.w / 2 + r * 0.6;
    }
    case 'cone': {
      const d = Math.hypot(e.x - m.x, e.y - m.y);
      if (d > m.range + r * 0.6) return false;
      if (d < 6) return true;
      let da = Math.atan2(e.y - m.y, e.x - m.x) - m.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      return Math.abs(da) <= m.arc / 2 + Math.atan2(r * 0.6, d);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- hitting

// Damage everyone hostile to the boss inside a shape, once per `hitSet`.
// opts: { mul, kind, knockback, launch, heavy, hitSet, push (dir {x,y} overrides away-from-origin), scaleOthers }
export function hitShape(b, shape, opts = {}) {
  const g = b.game;
  const list = g.entities?.all?.() || g.entities?.list || [];
  let hits = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === b || e.type !== 'actor' || e.removed || !alive(e)) continue;
    if (opts.hitSet && opts.hitSet.has(e)) continue;
    if (!hostileTo(g, b, e)) continue;
    if (!inShape(shape, e)) continue;
    opts.hitSet?.add(e);
    if (strike(b, e, opts, shape) > 0) hits++;
  }
  return hits;
}

export function strike(b, e, opts = {}, shape = null) {
  const g = b.game;
  let dx;
  let dy;
  if (opts.push) {
    dx = opts.push.x;
    dy = opts.push.y;
  } else {
    const ox = shape?.x ?? b.x;
    const oy = shape?.y ?? b.y;
    dx = e.x - ox;
    dy = e.y - oy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
  }
  // Nothing hits through a wall (round 14b, DESIGN §35.6): a slam, a sweep or a hazard lands
  // only where a straight line from where it came reaches without a wall or a shut door.
  const fx = shape?.x ?? b.x;
  const fy = shape?.y ?? b.y;
  try {
    if (wallBetween(g, fx, fy - 3, e.x, e.y - 3)) return 0;
  } catch {
    /* no map: as before */
  }
  // Lyra cannot read a marker the way a player can: blows that find her land softer.
  const isPlayer = e === g.player;
  const mul = (opts.mul ?? 1) * (isPlayer ? 1 : opts.othersMul ?? 0.75);
  let dealt = 0;
  try {
    dealt =
      g.combat?.damage?.(b, e, (b.atk || 8) * mul, {
        kind: opts.kind || 'melee',
        knockback: opts.knockback ?? 140,
        launch: opts.launch || 0,
        heavy: !!opts.heavy,
        dirX: dx,
        dirY: dy,
      }) || 0;
  } catch (err) {
    if (!b._strikeWarned) {
      b._strikeWarned = true;
      console.error('[boss] strike failed', err);
    }
  }
  return dealt;
}

// ---------------------------------------------------------------- targets and steering

// Who the boss is fighting: the player first, then whoever else stands in the arena.
export function pickFoe(b) {
  const g = b.game;
  const a = b.arena;
  const reach = (a?.r || 120) + 72;
  const cur = b.target;
  const p = g.player;
  const pOk = p && alive(p) && hostileTo(g, b, p) && (!a || Math.hypot(p.x - a.x, p.y - a.y) < reach);
  // The player is who it came for: it turns on someone else only while they are much
  // closer (Lyra in its face), and back to the player the moment that stops.
  if (pOk && cur !== p) {
    const dc = cur && alive(cur) && hostileTo(g, b, cur) ? dist(b, cur) : Infinity;
    if (!(dc < 34 && dc < dist(b, p) * 0.45)) {
      b.target = p;
      return p;
    }
  }
  if (cur && alive(cur) && hostileTo(g, b, cur) && (!a || Math.hypot(cur.x - a.x, cur.y - a.y) < reach)) return cur;
  let best = null;
  let bd = Infinity;
  const list = g.entities?.all?.() || g.entities?.list || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === b || e.type !== 'actor' || e.removed || !alive(e)) continue;
    if (a && Math.hypot(e.x - a.x, e.y - a.y) > reach) continue;
    if (!hostileTo(g, b, e)) continue;
    const d = dist(b, e) * (e === g.player ? 0.7 : 1);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  b.target = best;
  return best;
}

export function stop(b) {
  b.moveIntent.x = 0;
  b.moveIntent.y = 0;
}

// Head for a point; slides along walls (the mover does), detours when stuck.
export function steerTo(b, x, y, mul = 1) {
  const dx = x - b.x;
  const dy = y - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) {
    stop(b);
    return true;
  }
  let ux = dx / d;
  let uy = dy / d;
  if (b._stuckT > 0.5) {
    // Blocked: try a side step for a moment.
    const s = b._detour || (b._detour = rand(b.game) < 0.5 ? 1 : -1);
    const ax = ux * 0.35 - uy * s;
    const ay = uy * 0.35 + ux * s;
    const l = Math.hypot(ax, ay) || 1;
    ux = ax / l;
    uy = ay / l;
    if (b._stuckT > 1.4) {
      b._stuckT = 0;
      b._detour = -s;
    }
  }
  b.moveIntent.x = ux * mul;
  b.moveIntent.y = uy * mul;
  b.faceX = ux < -0.15 ? -1 : ux > 0.15 ? 1 : b.faceX;
  return false;
}

// Keep a distance band from the target, circling while there.
export function orbit(b, t, radius, mul = 1, dir = 1) {
  const a = Math.atan2(b.y - t.y, b.x - t.x) + 0.7 * dir;
  const x = t.x + Math.cos(a) * radius;
  const y = t.y + Math.sin(a) * radius;
  return steerTo(b, x, y, mul);
}

export function faceTarget(b, t) {
  if (!t) return;
  b.faceX = t.x < b.x - 1 ? -1 : t.x > b.x + 1 ? 1 : b.faceX;
  b.faceToward(t.x, t.y);
}

// A point inside the arena (clear of walls), around a center.
export function arenaPoint(b, cx, cy, rMin, rMax) {
  const g = b.game;
  for (let k = 0; k < 10; k++) {
    const a = rand(g) * Math.PI * 2;
    const r = rMin + (rMax - rMin) * rand(g);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (!b.flying && !walkLine(g, b, b.x, b.y, x, y)) continue;
    if (!b.flying && blockedPoint(g, x, y, b)) continue;
    return { x, y };
  }
  return { x: cx, y: cy };
}

export function blockedPoint(g, x, y, actor = null) {
  try {
    return !!g.isBlockedTile?.(Math.floor(x / 16), Math.floor(y / 16), actor);
  } catch {
    return false;
  }
}

// Dash along a direction with collision; returns true when something stopped it.
export function dashStep(b, ux, uy, speed, dt) {
  const bx = b.x;
  const by = b.y;
  b.game.entities?.moveActor?.(b, ux * speed * dt, uy * speed * dt);
  const moved = Math.hypot(b.x - bx, b.y - by);
  return moved < speed * dt * 0.35;
}

// ---------------------------------------------------------------- effects

export function fx(b, fn) {
  try {
    fn(b.game);
  } catch {
    /* effects are cosmetic */
  }
}

export function shake(b, s, t) {
  fx(b, (g) => g.camera?.shake?.(s, t));
}

export function flashLight(b, x, y, r, color, intensity = 0.6, duration = 0.2) {
  fx(b, (g) => g.lighting?.flash?.({ x, y, r, color, intensity, duration }));
}

export function particles(b, type, x, y, opts) {
  fx(b, (g) => g.particles?.emit?.(type, x, y, opts));
}

export function sound(b, name, opts = {}) {
  fx(b, (g) => {
    const s = g.bosses?.sfx;
    if (s && s.has(name)) s.play(name, opts);
    else g.audio?.play?.(name, { x: b.x, y: b.y, ...opts });
  });
}
