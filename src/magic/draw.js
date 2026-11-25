import { Entity } from '../entities/entity.js';
import { MAX_LIGHTS } from './balance.js';

// The plain look of the Weave: glowing discs, rings, wedges and lines in each weave's
// palette, status marks on actors, lights through getLight. It keeps the game playable
// and readable before r4/fx lands; fx.js replaces any part of it via game.magicFx
// (see magic.js). Also the MagicLayer: one entity in the entity list that the renderer
// draws like any other (drawShadow = ground layer under everyone, draw = bodies over
// everyone, getLight = the weave's lights), so no renderer change is needed.

const TAU = Math.PI * 2;

export class MagicLayer extends Entity {
  constructor(magic) {
    super(magic.game, { id: 'magic_layer', solid: false, radius: 0 });
    this.type = 'magic';
    this.magic = magic;
  }

  // Drawn after every actor and prop in view (spells read on top of the world).
  get sortY() {
    return this.y + 1e6;
  }

  // Sit at the middle of the view so the renderer's culling always keeps the layer.
  follow(game) {
    const c = game.camera;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
      this.x = c.x + (c.vw || 0) / 2;
      this.y = c.y + (c.vh || 0) / 2;
    } else if (game.player) {
      this.x = game.player.x;
      this.y = game.player.y;
    }
  }

  update() {}

  isAlive() {
    return false;
  }

  canInteract() {
    return false;
  }

  drawShadow(ctx, ox, oy, time) {
    this.magic.drawGround(ctx, ox, oy, time);
  }

  draw(ctx, ox, oy, time) {
    this.magic.drawBodies(ctx, ox, oy, time);
  }

  getLight(time) {
    return this.magic.getLights(time);
  }

  serialize() {
    return null;
  }
}

// ------------------------------------------------------------------ primitives

function disc(ctx, x, y, r, color, alpha = 1) {
  if (r <= 0.5) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), r, 0, TAU);
  ctx.fill();
}

function ring(ctx, x, y, r, color, alpha, width = 1, squash = 0.62) {
  if (r <= 0.5) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), r, r * squash, 0, 0, TAU);
  ctx.stroke();
}

function blob(ctx, x, y, r, color, alpha, squash = 0.62) {
  if (r <= 0.5) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y), r, r * squash, 0, 0, TAU);
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, color, alpha, width) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function inView(b, ox, oy, w, h, m = 80) {
  return b.x > ox - m && b.x < ox + w + m && b.y > oy - m && b.y < oy + h + m * 1.5;
}

// ------------------------------------------------------------------ ground layer

export function drawGround(magic, ctx, ox, oy, time) {
  const w = ctx.canvas?.width ?? 480;
  const h = ctx.canvas?.height ?? 270;
  const prevOp = ctx.globalCompositeOperation;
  // Terrain marks: scorch, puddles, rime, blooms…
  for (const d of magic.decals) {
    if (d.x < ox - 40 || d.x > ox + w + 40 || d.y < oy - 40 || d.y > oy + h + 40) continue;
    const fade = Math.min(1, (d.life - d.t) / 2) * Math.min(1, d.t * 8);
    drawDecal(ctx, d, d.x - ox, d.y - oy, fade, time);
  }
  for (const b of magic.bodies) {
    if (!b.active || b.delay > 0 || !inView(b, ox, oy, w, h)) continue;
    const p = b.palette;
    const x = b.x - ox;
    const y = b.y - oy;
    if (b.kind === 'area' && b.mode === 'patch') {
      const k = Math.min(1, (b.life - b.age) / 0.6);
      blob(ctx, x, y, b.cur, p.deep, 0.32 * k);
      ctx.globalCompositeOperation = 'lighter';
      blob(ctx, x, y, b.cur * 0.7, p.glow, (0.12 + 0.06 * Math.sin(time * 6 + b.seed * 9)) * k);
      ctx.globalCompositeOperation = prevOp;
      ring(ctx, x, y, b.cur, p.glow, 0.5 * k);
    } else if (b.kind === 'area' && b.mode === 'rain') {
      const k = Math.min(1, (b.life - b.age) / 0.3, b.age / 0.15);
      blob(ctx, x, y, b.r1, p.deep, 0.16 * k);
      ring(ctx, x, y, b.r1, p.glow, 0.55 * k);
    } else if (b.kind === 'rune') {
      drawRune(ctx, b, x, y, time);
    } else if (b.kind === 'projectile' && (b.mode === 'lob' || b.mode === 'fall')) {
      // A shadow and a target ring where it will land.
      const tx = (b.mode === 'lob' ? b.tx : b.x) - ox;
      const ty = (b.mode === 'lob' ? b.ty : b.y) - oy;
      const rr = b.mode === 'lob' ? b.burstR : b.r1;
      ring(ctx, tx, ty, rr, p.glow, 0.35 + 0.2 * Math.sin(time * 14));
      blob(ctx, x, y, Math.max(2, b.r), '#000000', 0.25);
    } else if (b.kind === 'wall') {
      line(ctx, b.ox - ox, b.oy - oy + 2, b.x2 - ox, b.y2 - oy + 2, '#000000', 0.22, b.r * 2 + 2);
    } else if (b.kind === 'summon') {
      blob(ctx, x, y + 1, b.r * 0.9, '#000000', 0.22);
    } else if (b.kind === 'area' && (b.mode === 'ring' || b.mode === 'burst')) {
      const k = 1 - Math.min(1, b.age / b.life);
      blob(ctx, x, y, b.cur, p.deep, 0.18 * k);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prevOp;
}

function drawDecal(ctx, d, x, y, a, time) {
  const p = d.palette;
  switch (d.mark) {
    case 'scorch':
    case 'char':
    case 'blight':
      blob(ctx, x, y, d.r, '#1c1418', 0.38 * a);
      blob(ctx, x, y, d.r * 0.5, p.deep, 0.25 * a);
      break;
    case 'puddle':
      blob(ctx, x, y, d.r, p.deep, 0.42 * a);
      blob(ctx, x - d.r * 0.2, y - 1, d.r * 0.45, p.spark, 0.3 * a);
      break;
    case 'glaze':
    case 'rime':
      blob(ctx, x, y, d.r, p.glow, 0.32 * a);
      ring(ctx, x, y, d.r, p.core, 0.45 * a);
      break;
    case 'bloom':
    case 'sprout':
      for (let i = 0; i < 5; i++) {
        const ang = d.seed * 9 + i * 1.3;
        const px = Math.round(x + Math.cos(ang) * d.r * 0.7);
        const py = Math.round(y + Math.sin(ang) * d.r * 0.45);
        ctx.globalAlpha = a;
        ctx.fillStyle = i % 2 ? p.glow : p.core;
        ctx.fillRect(px, py, 1, 1);
        ctx.fillStyle = p.deep;
        ctx.fillRect(px, py + 1, 1, 1);
      }
      break;
    case 'ooze':
      blob(ctx, x, y, d.r, p.glow, 0.28 * a);
      blob(ctx, x + 2, y, d.r * 0.3, p.spark, 0.4 * a * (0.6 + 0.4 * Math.sin(time * 5 + d.seed * 7)));
      break;
    case 'glow':
      blob(ctx, x, y, d.r, p.glow, 0.18 * a);
      break;
    case 'crack':
      line(ctx, x - d.r, y, x + d.r * 0.3, y - 1, '#2b1d14', 0.5 * a, 1);
      line(ctx, x + d.r * 0.3, y - 1, x + d.r * 0.8, y + 2, '#2b1d14', 0.5 * a, 1);
      break;
    case 'filings':
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.6 * a;
        ctx.fillStyle = p.glow;
        ctx.fillRect(Math.round(x + Math.cos(d.seed * 7 + i * 2) * d.r * 0.6), Math.round(y + Math.sin(d.seed * 5 + i * 2) * d.r * 0.4), 1, 1);
      }
      break;
    case 'steam':
      blob(ctx, x, y - 2, d.r * 0.7, '#e8eef2', 0.2 * a);
      break;
    default:
      blob(ctx, x, y, d.r, p.deep, 0.2 * a);
  }
}

function drawRune(ctx, b, x, y, time) {
  const p = b.palette;
  const fade = Math.min(1, (b.life - b.age) / 0.5, b.age / 0.2);
  const armed = b.armed;
  const pulse = armed ? 0.55 + 0.25 * Math.sin(time * 5 + b.seed * 9) : 0.3;
  const r = b.trigR + 2;
  blob(ctx, x, y, r, p.deep, 0.3 * fade);
  ring(ctx, x, y, r, p.glow, pulse * fade, 1);
  ring(ctx, x, y, r * 0.55, p.spark, pulse * 0.8 * fade, 1);
  // A turning three-point glyph.
  const spin = time * (armed ? 1.4 : 0.4) + b.seed * 6;
  ctx.globalAlpha = pulse * fade;
  ctx.strokeStyle = p.core;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 3; i++) {
    const a = spin + (i / 3) * TAU;
    const px = x + Math.cos(a) * r * 0.8;
    const py = y + Math.sin(a) * r * 0.5;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ------------------------------------------------------------------ bodies

export function drawBodies(magic, ctx, ox, oy, time) {
  const fx = magic.game.magicFx;
  const prevOp = ctx.globalCompositeOperation;
  if (fx?.drawLayer) {
    try {
      fx.drawLayer(ctx, ox, oy, time, magic);
    } catch (err) {
      magic.warn('fx drawLayer', err);
    }
  } else {
    const w = ctx.canvas?.width ?? 480;
    const h = ctx.canvas?.height ?? 270;
    const own = typeof fx?.drawBody === 'function';
    for (const b of magic.bodies) {
      if (!b.active || b.delay > 0) continue;
      if (b.kind !== 'beam' && b.kind !== 'wall' && b.kind !== 'trail' && !inView(b, ox, oy, w, h)) continue;
      try {
        if (own) fx.drawBody(ctx, b, ox, oy, time);
        else drawBody(ctx, b, ox, oy, time);
      } catch (err) {
        magic.warn(own ? 'fx drawBody' : 'draw body', err);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prevOp;
    }
  }
  if (fx?.drawStatuses) {
    try {
      fx.drawStatuses(ctx, ox, oy, time, magic);
    } catch (err) {
      magic.warn('fx drawStatuses', err);
    }
  } else drawStatuses(magic, ctx, ox, oy, time);
  drawHolds(magic, ctx, ox, oy, time);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prevOp;
}

export function drawBody(ctx, b, ox, oy, time) {
  const p = b.palette;
  const x = b.x - ox;
  const y = b.y - oy;
  const op = ctx.globalCompositeOperation;
  switch (b.kind) {
    case 'projectile': {
      const zy = y - b.z;
      if (b.mode === 'fall') {
        line(ctx, x, zy - 9, x, zy, p.glow, 0.8, Math.max(1, b.r * 0.8));
        disc(ctx, x, zy, Math.max(1, b.r * 0.7), p.core, 1);
        break;
      }
      // A streak through the last few positions.
      if (b.trailN > 1) {
        let px = x;
        let py = zy;
        for (let i = 1; i < b.trailN; i++) {
          const j = (b.trailI - i + 16) % 8;
          const tx = b.trail[j * 2] - ox;
          const ty = b.trail[j * 2 + 1] - oy - b.z;
          line(ctx, px, py, tx, ty, i < 3 ? p.glow : p.deep, 0.7 * (1 - i / b.trailN), Math.max(1, b.r * (1.3 - i / b.trailN)));
          px = tx;
          py = ty;
        }
      }
      const pulse = b.mode === 'orb' ? 1 + 0.15 * Math.sin(time * 10 + b.seed * 6) : 1;
      ctx.globalCompositeOperation = 'lighter';
      disc(ctx, x, zy, b.r * 1.9 * pulse, p.glow, b.mode === 'orb' ? 0.35 : 0.3);
      ctx.globalCompositeOperation = op;
      disc(ctx, x, zy, b.r * pulse, p.deep, 0.9);
      disc(ctx, x, zy, Math.max(1, b.r * 0.65 * pulse), p.glow, 1);
      disc(ctx, x - b.r * 0.2, zy - b.r * 0.2, Math.max(0.5, b.r * 0.35), p.core, 1);
      if (b.mode === 'orb' && b.tick > 0) {
        const k = 1 - Math.max(0, b.tickT) / b.tick;
        ring(ctx, x, y, b.pulseR * k, p.glow, 0.5 * (1 - k), 1);
      }
      if (b.mode === 'lob') {
        const s = b.angle;
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.core;
        ctx.fillRect(Math.round(x + Math.cos(s) * b.r), Math.round(zy + Math.sin(s) * b.r), 1, 1);
      }
      break;
    }
    case 'area': {
      const k = Math.min(1, b.age / Math.max(0.01, b.life));
      if (b.mode === 'ring') {
        ctx.globalCompositeOperation = 'lighter';
        ring(ctx, x, y, b.cur, p.glow, 0.85 * (1 - k * 0.7), 3);
        ctx.globalCompositeOperation = op;
        ring(ctx, x, y, b.cur, p.core, 0.9 * (1 - k), 1);
        ring(ctx, x, y, b.cur * 0.82, p.spark, 0.5 * (1 - k), 1);
      } else if (b.mode === 'cone') {
        drawWedge(ctx, x, y - 4, b.angle, b.arc, b.cur, p, 1 - k);
      } else if (b.mode === 'burst') {
        ctx.globalCompositeOperation = 'lighter';
        blob(ctx, x, y - 3, b.cur, p.glow, 0.55 * (1 - k), 0.8);
        ctx.globalCompositeOperation = op;
        blob(ctx, x, y - 3, b.cur * 0.55 * (1 - k), p.core, 0.9 * (1 - k), 0.8);
        ring(ctx, x, y, b.cur, p.spark, 0.8 * (1 - k), 1);
      }
      break;
    }
    case 'strike': {
      const k = Math.min(1, b.age / Math.max(0.01, b.life));
      const fx = x + Math.cos(b.angle) * b.r * 1.1;
      const fy = y - 8 + Math.sin(b.angle) * b.r * 0.8;
      if (k < 0.45) {
        ctx.globalCompositeOperation = 'lighter';
        disc(ctx, fx, fy, b.r * (0.8 + k), p.glow, 0.7 * (1 - k * 2));
        ctx.globalCompositeOperation = op;
        disc(ctx, fx, fy, b.r * 0.45, p.core, 1 - k * 2);
      }
      drawWedge(ctx, x, y - 4, b.angle, b.arc, b.cur, p, (1 - k) * 0.8, true);
      break;
    }
    case 'beam': {
      if (b.npts < 2) break;
      const flick = 0.85 + 0.15 * Math.sin(time * 40 + b.seed * 9);
      const fade = Math.min(1, (b.life - b.age) / 0.12, b.age / 0.05);
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      polyline(ctx, b, ox, oy + 8, p.glow, 0.45 * fade, (b.r * 2 + 3) * flick);
      ctx.globalCompositeOperation = op;
      polyline(ctx, b, ox, oy + 8, p.glow, 0.9 * fade, Math.max(1, b.r * 1.2 * flick));
      polyline(ctx, b, ox, oy + 8, p.core, fade, Math.max(1, b.r * 0.5));
      ctx.lineCap = 'butt';
      const n = b.npts - 1;
      disc(ctx, b.pts[n * 2] - ox, b.pts[n * 2 + 1] - oy - 8, b.r * 1.4 * flick, p.core, 0.8 * fade);
      break;
    }
    case 'summon': {
      const zy = y - b.z;
      const fade = Math.min(1, (b.life - b.age) / 0.5, b.age / 0.3);
      const form = b.plan.familiar?.form || 'wisp';
      ctx.globalCompositeOperation = 'lighter';
      disc(ctx, x, zy, b.r * 2, p.glow, 0.25 * fade);
      ctx.globalCompositeOperation = op;
      if (form === 'golem' || form === 'sentinel') {
        // A squat block of a body with stubby arms.
        const s = Math.round(b.r * 1.4);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.deep;
        ctx.fillRect(Math.round(x - s), Math.round(zy - s), s * 2, s * 2);
        ctx.fillRect(Math.round(x - s - 2), Math.round(zy - 1), 2, 4);
        ctx.fillRect(Math.round(x + s), Math.round(zy - 1), 2, 4);
        ctx.fillStyle = p.glow;
        ctx.fillRect(Math.round(x - s + 1), Math.round(zy - s + 1), s * 2 - 2, s - 1);
      } else if (form === 'bird') {
        const flap = Math.sin(b.age * 18) * 2;
        line(ctx, x - b.r - 3, zy - 1 - flap, x, zy, p.glow, fade, 2);
        line(ctx, x + b.r + 3, zy - 1 - flap, x, zy, p.glow, fade, 2);
        disc(ctx, x, zy, b.r * 0.8, p.deep, fade);
        disc(ctx, x, zy - 1, b.r * 0.55, p.glow, fade);
      } else {
        // An orb with a wisp of a tail behind it.
        for (let k = 3; k >= 1; k--) disc(ctx, x - Math.cos(b.angle) * k * 2.2, zy - Math.sin(b.angle) * k * 1.4 + k * 0.6, b.r * (1 - k * 0.22), p.deep, 0.5 * fade);
        disc(ctx, x, zy, b.r, p.deep, fade);
        disc(ctx, x, zy - 1, b.r * 0.7, p.glow, fade);
      }
      // Eyes that look where it is heading.
      const ex = Math.cos(b.angle) * 1.5;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.core;
      ctx.fillRect(Math.round(x - 2 + ex), Math.round(zy - 2), 1, 1);
      ctx.fillRect(Math.round(x + 1 + ex), Math.round(zy - 2), 1, 1);
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + i * 2.1 + b.seed * 6;
        ctx.fillStyle = i ? p.spark : p.core;
        ctx.fillRect(Math.round(x + Math.cos(a) * (b.r + 3)), Math.round(zy + Math.sin(a) * (b.r + 1)), 1, 1);
      }
      break;
    }
    case 'wall': {
      const fade = Math.min(1, (b.life - b.age) / 0.5, b.age / 0.15);
      const rise = Math.min(1, b.age / 0.18);
      const n = Math.max(2, Math.round(b.len / 4));
      const hgt = Math.round((7 + b.r) * rise);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = Math.round(b.ox + (b.x2 - b.ox) * t - ox);
        const py = Math.round(b.oy + (b.y2 - b.oy) * t - oy);
        const hh = hgt - ((i * 7 + Math.floor(b.seed * 5)) % 3);
        ctx.globalAlpha = 0.92 * fade;
        ctx.fillStyle = p.deep;
        ctx.fillRect(px - 2, py - hh, 4, hh);
        ctx.fillStyle = p.glow;
        ctx.fillRect(px - 1, py - hh, 2, Math.max(1, hh - 2));
        ctx.fillStyle = p.core;
        ctx.fillRect(px - 1, py - hh, 1, 1);
      }
      break;
    }
    case 'trail': {
      const k = Math.min(1, b.age / Math.max(0.01, b.life));
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      line(ctx, x, y - 4, b.x2 - ox, b.y2 - oy - 4, p.glow, 0.5 * (1 - k), b.r * 2);
      ctx.globalCompositeOperation = op;
      line(ctx, x, y - 4, b.x2 - ox, b.y2 - oy - 4, p.core, 0.8 * (1 - k), Math.max(1, b.r * 0.6));
      ctx.lineCap = 'butt';
      break;
    }
    case 'bind': {
      // A ring at the feet, bands on the shins.
      const r = b.cur || b.r;
      ring(ctx, x, y, r, p.glow, 0.9, 2, 0.42);
      ring(ctx, x, y, r, p.core, 1, 1, 0.42);
      ring(ctx, x, y - 4, Math.max(3, r * 0.45), p.spark, 0.7, 1, 0.45);
      break;
    }
    case 'ward': {
      // A pale dome over the bearer, rimmed in its colour.
      const r = b.cur || b.r;
      const s = b.shieldMax > 0 ? Math.max(0.3, Math.min(1, b.shield / b.shieldMax)) : 1;
      blob(ctx, x, y - 9, r, p.glow, 0.14 * s, 1.08);
      ring(ctx, x, y - 9, r, p.core, 0.7 * s, 1, 1.08);
      break;
    }
    default:
      disc(ctx, x, y, b.r, p.glow, 0.8);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = op;
}

function polyline(ctx, b, ox, oy, color, alpha, width) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(b.pts[0] - ox, b.pts[1] - oy);
  for (let i = 1; i < b.npts; i++) ctx.lineTo(b.pts[i * 2] - ox, b.pts[i * 2 + 1] - oy);
  ctx.stroke();
}

function drawWedge(ctx, x, y, ang, arc, r, p, a, hollow = false) {
  if (r <= 1 || a <= 0.01) return;
  const op = ctx.globalCompositeOperation;
  if (!hollow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 * a;
    ctx.fillStyle = p.glow;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.ellipse(x, y, r, r * 0.75, 0, ang - arc, ang + arc);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = op;
  }
  ctx.globalAlpha = 0.85 * a;
  ctx.strokeStyle = p.core;
  ctx.lineWidth = hollow ? 2 : 1;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.75, 0, ang - arc, ang + arc);
  ctx.stroke();
}

// ------------------------------------------------------------------ statuses and holds

export function drawStatuses(magic, ctx, ox, oy, time) {
  const w = ctx.canvas?.width ?? 480;
  const h = ctx.canvas?.height ?? 270;
  for (const a of magic.status.afflicted) {
    const l = a.magicStatus;
    if (!l || !l.length || a.removed || a.dead) continue;
    const x = Math.round(a.x - ox);
    const y = Math.round(a.y - oy - (a.z || 0));
    if (x < -20 || x > w + 20 || y < -40 || y > h + 40) continue;
    for (let i = 0; i < l.length; i++) drawStatus(ctx, l[i], x, y, time, i, a);
  }
  ctx.globalAlpha = 1;
}

function drawStatus(ctx, s, x, y, time, i, a) {
  const c = s.def.color;
  const ph = time * 6 + i * 1.7 + (a.radius || 5);
  const fade = Math.min(1, s.t / 0.3);
  ctx.globalAlpha = fade;
  switch (s.def.overlay) {
    case 'ice': {
      // A block of ice around the body: pale, jagged on top, one bright edge.
      const w = Math.max(10, (a.radius || 5) * 2 + 4);
      const h = 20;
      const x0 = Math.round(x - w / 2);
      const y0 = y - h;
      ctx.globalAlpha = 0.4 * fade;
      ctx.fillStyle = '#bfe9ff';
      ctx.fillRect(x0, y0 + 2, w, h - 2);
      ctx.fillRect(x0 + 1, y0, 3, 2);
      ctx.fillRect(x0 + w - 5, y0 + 1, 3, 1);
      ctx.fillRect(x0 + (w >> 1) - 1, y0 - 1, 3, 3);
      ctx.globalAlpha = 0.6 * fade;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0 + 2, y0 + 3, 1, h - 7);
      ctx.fillRect(x0 + 3, y0 + 3, 2, 1);
      ctx.fillRect(x0 + w - 4, y0 + 6, 1, 3);
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = '#6fb6e6';
      ctx.fillRect(x0, y - 1, w, 1);
      ctx.fillRect(x0 + w - 1, y0 + 2, 1, h - 3);
      break;
    }
    case 'flame':
      for (let k = 0; k < 3; k++) {
        const fy = y - 6 - ((time * 22 + k * 5) % 14);
        ctx.fillStyle = k ? c : '#fff4c0';
        ctx.fillRect(Math.round(x - 4 + k * 4 + Math.sin(ph + k) * 1.2), Math.round(fy), 1, 2);
      }
      break;
    case 'drip':
      ctx.fillStyle = c;
      ctx.fillRect(x - 5, Math.round(y - 14 + ((time * 14) % 12)), 1, 2);
      ctx.fillRect(x + 4, Math.round(y - 10 + ((time * 14 + 6) % 10)), 1, 2);
      break;
    case 'rime':
      ctx.fillStyle = c;
      for (let k = 0; k < s.stacks + 1; k++) ctx.fillRect(x - 6 + k * 4, y - 1 - (k % 2), 2, 1);
      ring(ctx, x, y, 7, c, 0.6 * fade);
      break;
    case 'sparks':
      ctx.fillStyle = (Math.floor(time * 20) % 2 ? '#ffffff' : c);
      ctx.fillRect(Math.round(x + Math.sin(time * 31) * 6), Math.round(y - 10 + Math.cos(time * 27) * 7), 1, 1);
      ctx.fillRect(Math.round(x + Math.cos(time * 23) * 6), Math.round(y - 12 + Math.sin(time * 19) * 6), 1, 1);
      break;
    case 'stars':
      for (let k = 0; k < 3; k++) {
        const an = time * 7 + (k / 3) * TAU;
        ctx.fillStyle = k ? c : '#ffffff';
        ctx.fillRect(Math.round(x + Math.cos(an) * 6), Math.round(y - 24 + Math.sin(an) * 2), 1, 1);
      }
      break;
    case 'vines':
      ctx.fillStyle = c;
      for (let k = -1; k <= 1; k++) {
        ctx.fillRect(x + k * 4, y - 3 - Math.abs(k), 1, 3 + Math.abs(k));
      }
      ring(ctx, x, y, 6, '#2f7a3a', 0.8 * fade);
      break;
    case 'bubbles':
      for (let k = 0; k < Math.min(3, s.stacks); k++) {
        const by = y - 8 - ((time * 10 + k * 7) % 16);
        ring(ctx, x - 3 + k * 3, by, 1.2, c, 0.9 * fade, 1, 1);
      }
      break;
    case 'glare':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 25, 3, 1);
      ctx.fillRect(x, y - 26, 1, 3);
      break;
    case 'wisps':
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x - 3 + Math.sin(ph) * 2), Math.round(y - 8 - ((time * 9) % 12)), 1, 2);
      ctx.fillRect(Math.round(x + 3 + Math.cos(ph) * 2), Math.round(y - 6 - ((time * 9 + 5) % 12)), 1, 2);
      break;
    case 'cracks':
      ctx.fillStyle = c;
      ctx.fillRect(x - 3, y - 12, 1, 3);
      ctx.fillRect(x - 2, y - 10, 2, 1);
      ctx.fillRect(x + 2, y - 8, 1, 3);
      break;
    case 'hearts': {
      const hy = Math.round(y - 27 + Math.sin(time * 4) * 1.5);
      ctx.fillStyle = c;
      ctx.fillRect(x - 2, hy, 2, 1);
      ctx.fillRect(x + 1, hy, 2, 1);
      ctx.fillRect(x - 2, hy + 1, 5, 1);
      ctx.fillRect(x - 1, hy + 2, 3, 1);
      ctx.fillRect(x, hy + 3, 1, 1);
      break;
    }
    case 'mud':
      blob(ctx, x, y, 7, c, 0.55 * fade);
      break;
    case 'steam':
      blob(ctx, x + Math.sin(ph) * 3, y - 14 - ((time * 8) % 6), 3, c, 0.35 * fade, 1);
      break;
    case 'gust':
      ring(ctx, x, y - 6, 5 + ((time * 30) % 4), c, 0.6 * fade, 1, 0.5);
      break;
    case 'none':
      break;
    case 'pin':
      ring(ctx, x, y, 5 + ((time * 40) % 3), c, 0.7 * fade, 1, 0.5);
      break;
    default:
      ring(ctx, x, y, 6, c, 0.6 * fade);
  }
}

function drawHolds(magic, ctx, ox, oy, time) {
  if (!magic.holds.size) return;
  for (const [c, h] of magic.holds) {
    if (!c || c.removed || h.mode === 'tap' || h.live === false) continue;
    const p = h.plan.palette;
    const x = c.x - ox;
    const y = c.y - oy;
    const k = h.k;
    const full = k >= 1 && h.mode === 'charge';
    ring(ctx, x, y, 6 + k * 8, full ? p.core : p.glow, 0.5 + 0.4 * (full ? Math.abs(Math.sin(time * 12)) : k), full ? 2 : 1);
    const n = Math.round(3 + k * 5);
    for (let i = 0; i < n; i++) {
      const a = time * 5 + (i / n) * TAU;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = i % 2 ? p.spark : p.core;
      ctx.fillRect(Math.round(x + Math.cos(a) * (10 - k * 4)), Math.round(y - 10 + Math.sin(a) * (5 - k * 2)), 1, 1);
    }
  }
}

// ------------------------------------------------------------------ lights

const LIGHTS = [];
const OUT = [];
function light(i) {
  let l = LIGHTS[i];
  if (!l) LIGHTS[i] = l = { x: 0, y: 0, r: 0, color: '#ffffff', intensity: 0, flicker: 0, glow: 1 };
  return l;
}

export function collectLights(magic, time) {
  OUT.length = 0;
  let n = 0;
  const push = (x, y, r, color, intensity, flicker = 0.15) => {
    if (n >= MAX_LIGHTS || !(r > 1) || !(intensity > 0.02)) return;
    const l = light(n++);
    l.x = x;
    l.y = y;
    l.r = r;
    l.color = color;
    l.intensity = Math.min(1, intensity);
    l.flicker = flicker;
    l.glow = 1;
    OUT.push(l);
  };
  for (const b of magic.bodies) {
    if (n >= MAX_LIGHTS) break;
    if (!b.active || b.delay > 0) continue;
    const L = b.plan.light;
    const k = Math.min(1, b.age / Math.max(0.01, b.life));
    switch (b.kind) {
      case 'projectile':
        if (b.mode === 'fall' && b.index % 3) break;
        push(b.x, b.y - b.z, Math.min(70, L.radius * (0.5 + b.r * 0.08)), L.color, b.mode === 'orb' ? 0.8 : 0.7);
        break;
      case 'area':
        if (b.mode === 'patch') push(b.x, b.y, b.r1 * 1.8, L.color, 0.32);
        else if (b.mode === 'rain') push(b.x, b.y, b.r1 * 1.5, L.color, 0.25);
        else push(b.x, b.y - 4, Math.max(28, b.cur * 1.5), L.color, 0.9 * (1 - k));
        break;
      case 'strike':
        push(b.x, b.y - 6, Math.max(26, b.cur * 1.4), L.color, 0.8 * (1 - k));
        break;
      case 'beam': {
        const m = b.npts - 1;
        if (m < 1) break;
        for (let i = 0; i <= 2; i++) {
          const s = Math.min(m, Math.round((i / 2) * m));
          push(b.pts[s * 2], b.pts[s * 2 + 1] - 8, L.radius * 0.9, L.color, 0.7, 0.3);
        }
        break;
      }
      case 'summon':
        push(b.x, b.y - b.z, 34, L.color, 0.6);
        break;
      case 'rune':
        push(b.x, b.y, 26, L.color, b.armed ? 0.3 + 0.12 * Math.sin(time * 5 + b.seed * 9) : 0.12, 0);
        break;
      case 'wall':
        push(b.ox, b.oy - 6, 30, L.color, 0.45);
        push(b.x2, b.y2 - 6, 30, L.color, 0.45);
        break;
      case 'trail':
        push((b.x + b.x2) / 2, (b.y + b.y2) / 2 - 4, 34, L.color, 0.5 * (1 - k));
        break;
      case 'bind':
        push(b.x, b.y - 4, 28, L.color, 0.5);
        break;
      case 'ward':
        push(b.x, b.y - 9, Math.max(30, (b.cur || b.r) * 2.6), L.color, 0.4);
        break;
      default:
        break;
    }
  }
  return OUT;
}

// ------------------------------------------------------------------ the plain effects

const PARTICLE_OK = new Set(['dust', 'hit', 'spark', 'leaf', 'stone_chip', 'magic', 'heal', 'smoke', 'splash', 'ember', 'poof', 'note', 'sparkle', 'heart']);

function emit(g, type, x, y, opts) {
  if (!PARTICLE_OK.has(type)) type = 'magic';
  g.particles?.emit?.(type, x, y, opts);
}

export function fallbackFx(magic, type, p) {
  const g = magic.game;
  switch (type) {
    case 'cast': {
      const plan = p.plan;
      const x = p.x + Math.cos(p.angle) * 7;
      const y = p.y + Math.sin(p.angle) * 4;
      emit(g, plan.fallbackParticles[0], x, y, { count: 4, color: [plan.palette.glow, plan.palette.core], dir: { x: Math.cos(p.angle), y: Math.sin(p.angle) }, speed: [20, 50], life: [0.2, 0.4], z: 10 });
      g.lighting?.flash?.({ x, y: y - 10, r: 34, color: plan.light.color, intensity: 0.6, duration: 0.16 });
      g.audio?.play?.(plan.shape === 'bolt' || plan.kind === 'projectile' ? 'bolt' : 'magic', { x: p.x, y: p.y, volume: 0.55, pitch: 0.9 + magic.random() * 0.25 });
      break;
    }
    case 'hit': {
      const b = p.body;
      if (p.tick && magic.random() > 0.35) break;
      const parts = b.plan.fallbackParticles;
      emit(g, parts[(b.index + (b.uid & 3)) % parts.length], p.x, p.y - 8, { count: p.tick ? 2 : 5, color: [b.palette.glow, b.palette.spark, b.palette.core], speed: [20, 60], life: [0.2, 0.45] });
      break;
    }
    case 'explode': {
      const b = p.body;
      const parts = b.plan.fallbackParticles;
      for (let i = 0; i < parts.length; i++) emit(g, parts[i], p.x, p.y - 4, { count: Math.round(6 + p.r * 0.2), color: [b.palette.glow, b.palette.core, b.palette.spark], speed: [30, 30 + p.r * 2], life: [0.25, 0.6] });
      g.lighting?.flash?.({ x: p.x, y: p.y - 6, r: p.r * 2.2, color: b.plan.light.color, intensity: 0.85, duration: 0.3 });
      if (p.r > 20 || b.heavy) g.camera?.shake?.(1.4, 0.12);
      g.audio?.play?.('bolt_hit', { x: p.x, y: p.y, volume: 0.8, pitch: 0.7 });
      break;
    }
    case 'end': {
      const b = p.body;
      if (b.kind === 'projectile' && p.why === 'wall') emit(g, 'spark', b.x, b.y - b.z, { count: 3, color: b.palette.glow, speed: [20, 50], life: 0.25 });
      if (b.kind === 'summon') emit(g, 'poof', b.x, b.y - b.z, { count: 8, color: [b.palette.glow, b.palette.deep], speed: [10, 30] });
      break;
    }
    case 'reaction': {
      const r = p.reaction;
      g.lighting?.flash?.({ x: p.x, y: p.y - 8, r: 70, color: r.color || '#ffffff', intensity: 0.9, duration: 0.35 });
      emit(g, 'spark', p.x, p.y - 8, { count: 12, color: [r.color || '#ffffff', '#ffffff'], speed: [30, 90], life: [0.3, 0.6] });
      g.camera?.shake?.(1.6, 0.15);
      break;
    }
    case 'status': {
      const t = p.target;
      emit(g, 'sparkle', t.x, t.y - 10, { count: 3, color: p.def.color, speed: [5, 20], life: 0.4 });
      break;
    }
    case 'dash':
      emit(g, 'dust', p.caster.x, p.caster.y, { count: 6, speed: [20, 40], life: 0.4, dir: { x: -Math.cos(p.angle), y: -Math.sin(p.angle) } });
      g.audio?.play?.('dodge', { x: p.caster.x, y: p.caster.y });
      break;
    case 'block':
      emit(g, 'spark', p.x, p.y - 6, { count: 5, color: p.body.palette.core, speed: [30, 60], life: 0.3 });
      break;
    case 'impact':
      emit(g, p.body.plan.fallbackParticles[0], p.x, p.y, { count: 2, color: p.body.palette.glow, speed: [10, 30], life: 0.3 });
      break;
    case 'link':
      if (p.from && p.to) {
        for (let i = 1; i < 4; i++) {
          const k = i / 4;
          emit(g, 'spark', p.from.x + (p.to.x - p.from.x) * k, p.from.y + (p.to.y - p.from.y) * k - 8, { count: 1, color: p.color || '#fff07a', speed: [5, 15], life: 0.25 });
        }
      }
      break;
    case 'charge':
      if (p.full) g.lighting?.flash?.({ x: p.caster.x, y: p.caster.y - 10, r: 40, color: p.plan.light.color, intensity: 0.7, duration: 0.25 });
      break;
    case 'fizzle':
      if (p.caster && p.reason === 'mana') emit(g, 'poof', p.caster.x, p.caster.y - 10, { count: 4, color: '#8e8a95', speed: [5, 15], life: 0.3 });
      break;
    default:
      break;
  }
}
