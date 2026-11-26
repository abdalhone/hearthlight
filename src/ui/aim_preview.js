// The aim preview (DESIGN.md §22.4): drawn in the world, on the full-resolution canvas
// after the light map (so it reads at night) and before speech bubbles. It shows the
// plan's preview descriptor — a line with its length, a cone, the circle where a lobbed
// weave lands, the ring around you, a strike's arc — in the weave's own colours, plus
// a subtle reticle under the mouse. The renderer calls game.aimPreview.draw(ctx, r).

import { isParty } from '../core/party.js';
const TAU = Math.PI * 2;

function rgba(hex, a) {
  const s = String(hex || '#ffffff').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const GREY = { core: '#c9c3d6', glow: '#8a85a0', spark: '#ffffff', deep: '#3a3650' };
const CANCEL = { core: '#ff9b8f', glow: '#ff6b5e', spark: '#ffd9d3', deep: '#5e2229' };
const SWORD = { core: '#ffe08a', glow: '#ffb047', spark: '#fff6da', deep: '#86301b' };

export class AimPreview {
  constructor(game, weaving) {
    this.game = game;
    this.weaving = weaving;
    this.t = 0;
  }

  draw(ctx, r) {
    const g = this.game;
    const w = this.weaving;
    if (!w || g.state !== 'playing' || !r?.worldToDevice) return;
    if (g.settings?.aimGuides === false && !w.aims.length && !w.sword) return this.drawReticle(ctx, r);
    this.t = g.time || 0;
    const s = r.scale || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    try {
      if (w.hover && g.settings?.aimGuides !== false) this.drawAim(ctx, r, s, w.hover, 0.55);
      for (let i = 0; i < w.aims.length; i++) this.drawAim(ctx, r, s, w.aims[i], 1);
      if (w.sword) this.drawSword(ctx, r, s, w.sword);
    } finally {
      ctx.restore();
    }
    this.drawReticle(ctx, r);
  }

  drawAim(ctx, r, s, a, alpha) {
    const pal = a.cancel ? CANCEL : a.starved ? GREY : a.palette || GREY;
    const k = alpha * (a.cancel ? 0.7 : a.starved ? 0.6 : 1);
    const pv = a.preview || { type: 'line', range: 120 };
    const o = r.worldToDevice(a.ox, a.oy);
    const p = r.worldToDevice(a.x, a.y);
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    let d = Math.hypot(dx, dy);
    if (d < 0.001) {
      dx = 1;
      dy = 0;
      d = 1;
    }
    const ux = dx / d;
    const uy = dy / d;
    const ang = Math.atan2(uy, ux);
    const range = Math.max(8, Number(pv.range) || 0) * s;
    const type = pv.type || 'line';
    const thin = Math.max(2, Math.round(s * 0.9));

    if (type === 'line' || type === 'beam') {
      const width = Math.max(4, (Number(pv.width) || 6) * s);
      const count = Math.max(1, Math.min(7, Number(pv.count) || 1));
      const spread = Number(pv.spread) || 0.26;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spread;
        this.band(ctx, o.x, o.y, ang + off, range, width, pal, k * (i === (count - 1) >> 1 || count === 1 ? 1 : 0.7), thin);
      }
    } else if (type === 'cone' || type === 'arc') {
      const angle = coneAngle(pv);
      ctx.beginPath();
      if (type === 'arc') {
        const inner = range * 0.45;
        ctx.arc(o.x, o.y, range, ang - angle / 2, ang + angle / 2);
        ctx.arc(o.x, o.y, inner, ang + angle / 2, ang - angle / 2, true);
      } else {
        ctx.moveTo(o.x, o.y);
        ctx.arc(o.x, o.y, range, ang - angle / 2, ang + angle / 2);
      }
      ctx.closePath();
      this.fillStroke(ctx, pal, k, thin);
    } else if (type === 'ring') {
      const rad = Math.max(10, (Number(pv.radius) || Number(pv.range) || 40) * s);
      ctx.beginPath();
      ctx.arc(o.x, o.y, rad, 0, TAU);
      ctx.arc(o.x, o.y, Math.max(4, rad - Math.max(6, 6 * s)), 0, TAU, true);
      this.fillStroke(ctx, pal, k, thin, true);
      this.pulseRing(ctx, o.x, o.y, rad, pal, k);
    } else if (type === 'circle' || type === 'point') {
      const rad = Math.max(6, (Number(pv.radius) || (type === 'point' ? 8 : 20)) * s);
      // The path there: a lob for thrown weaves, dots for the rest.
      this.dots(ctx, o.x, o.y, p.x, p.y, pal, k, s, pv.lob !== false && type === 'circle');
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, TAU);
      this.fillStroke(ctx, pal, k, thin);
      this.cross(ctx, p.x, p.y, Math.min(rad * 0.5, 6 * s), pal, k);
      if (type === 'circle') this.pulseRing(ctx, p.x, p.y, rad, pal, k);
    } else if (type === 'bind') {
      this.drawBind(ctx, r, s, a, o, p, pv, pal, k, thin);
      return;
    } else if (type === 'shield') {
      this.drawShield(ctx, r, s, a, o, pv, pal, k, thin);
      return;
    } else if (type === 'wall') {
      const half = Math.max(8, ((Number(pv.width) || 60) * s) / 2);
      const cx = p.x;
      const cy = p.y;
      const nx = -uy;
      const ny = ux;
      const thick = Math.max(5, 6 * s);
      ctx.beginPath();
      ctx.moveTo(cx + nx * half - ux * thick, cy + ny * half - uy * thick);
      ctx.lineTo(cx - nx * half - ux * thick, cy - ny * half - uy * thick);
      ctx.lineTo(cx - nx * half + ux * thick, cy - ny * half + uy * thick);
      ctx.lineTo(cx + nx * half + ux * thick, cy + ny * half + uy * thick);
      ctx.closePath();
      this.fillStroke(ctx, pal, k, thin);
      this.dots(ctx, o.x, o.y, cx, cy, pal, k * 0.8, s, false);
    } else {
      this.band(ctx, o.x, o.y, ang, range, 6 * s, pal, k, thin);
    }

    if (a.charge > 0) {
      const rad = 13 * s;
      ctx.lineWidth = Math.max(3, 2 * s);
      ctx.strokeStyle = rgba(pal.deep, 0.6 * k);
      ctx.beginPath();
      ctx.arc(o.x, o.y, rad, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(pal.spark, 0.95 * k);
      ctx.beginPath();
      ctx.arc(o.x, o.y, rad, -Math.PI / 2, -Math.PI / 2 + TAU * a.charge);
      ctx.stroke();
    }
    if (a.target && !a.cancel) this.bracket(ctx, r, s, a.target, pal, k);
    if (a.cancel) this.cancelMark(ctx, o.x, o.y - 18 * s, s, k);
  }

  // A bind (DESIGN §22.5): dots to its mark — the foe under the aim, or the one nearest
  // it — and a ring closing on the mark's feet. Aimed at a friend it turns coral: that
  // is an attack.
  drawBind(ctx, r, s, a, o, p, pv, pal, k, thin) {
    const g = this.game;
    let mark = a.target && !a.target.removed && a.target.isAlive?.() !== false ? a.target : null;
    if (!mark) mark = this.nearestActor(a.x, a.y, 52, (e) => this.hostile(e));
    const friend = !!mark && this.friendly(mark);
    const P = friend ? CANCEL : pal;
    const at = mark ? r.worldToDevice(mark.x, mark.y) : r.worldToDevice(a.x, a.y + 7);
    this.dots(ctx, o.x, o.y, at.x, at.y - 7 * s, P, k, s, false);
    const base = Math.max(8, (Number(pv.radius) || 10) * s) + (mark ? Math.min(10, mark.radius ?? 5) * s * 0.4 : 0);
    const f = g.settings?.reduceMotion ? 1 : 1 - ((this.t * 1.1) % 1);
    const rad = base * (1 + 0.7 * f * f);
    for (const [col, w] of [
      [rgba('#0b0915', 0.45 * k), thin + 3],
      [rgba(P.core, 0.95 * k), thin],
    ]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, rad, rad * 0.42, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(P.glow, 0.22 * k);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, base, base * 0.42, 0, 0, TAU);
    ctx.fill();
    // Four ticks pointing in: it closes.
    ctx.lineWidth = thin;
    ctx.strokeStyle = rgba(P.spark, 0.95 * k);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * TAU + Math.PI / 4;
      const cx = Math.cos(an);
      const cy = Math.sin(an) * 0.42;
      ctx.moveTo(at.x + cx * (rad + 6 * s), at.y + cy * (rad + 6 * s));
      ctx.lineTo(at.x + cx * (rad + 1 * s), at.y + cy * (rad + 1 * s));
    }
    ctx.stroke();
    if (mark && !a.cancel) this.bracket(ctx, r, s, mark, P, k);
    if (a.cancel) this.cancelMark(ctx, o.x, o.y - 18 * s, s, k);
  }

  // A ward (DESIGN §22.5): a dome over whoever it will shield — you, or the friend under
  // (or nearest) the aim.
  drawShield(ctx, r, s, a, o, pv, pal, k, thin) {
    const g = this.game;
    const p = g.player;
    let who = a.target && !a.target.removed && this.friendly(a.target) ? a.target : null;
    if (!who && p && Math.hypot(a.x - p.x, a.y + 7 - p.y) > 16) who = this.nearestActor(a.x, a.y, 24, (e) => this.friendly(e));
    who = who || p;
    if (!who) return;
    const feet = r.worldToDevice(who.x, who.y);
    const mid = r.worldToDevice(who.x, who.y - 9);
    if (who !== p) this.dots(ctx, o.x, o.y, mid.x, mid.y, pal, k * 0.85, s, false);
    const rx = Math.max(10, (Number(pv.radius) || 13) * s);
    const ry = rx * 1.08;
    ctx.fillStyle = rgba(pal.glow, 0.16 * k);
    ctx.beginPath();
    ctx.ellipse(mid.x, mid.y, rx, ry, 0, 0, TAU);
    ctx.fill();
    for (const [col, w] of [
      [rgba('#0b0915', 0.4 * k), thin + 2],
      [rgba(pal.core, 0.9 * k), thin],
    ]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, rx, ry, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(1, thin - 1);
    ctx.strokeStyle = rgba(pal.spark, 0.8 * k);
    ctx.beginPath();
    ctx.ellipse(mid.x, mid.y, rx - 3 * s, ry - 3 * s, 0, 3.7, 4.4);
    ctx.stroke();
    ctx.strokeStyle = rgba(pal.glow, 0.6 * k);
    ctx.beginPath();
    ctx.ellipse(feet.x, feet.y, rx, rx * 0.42, 0, 0, TAU);
    ctx.stroke();
    if (!g.settings?.reduceMotion) {
      const f = (this.t * 1.2) % 1;
      ctx.strokeStyle = rgba(pal.spark, 0.45 * (1 - f) * k);
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, rx * (0.4 + 0.6 * f), ry * (0.4 + 0.6 * f), 0, 0, TAU);
      ctx.stroke();
    }
    if (who !== p && !a.cancel) this.bracket(ctx, r, s, who, pal, k);
    if (a.cancel) this.cancelMark(ctx, o.x, o.y - 18 * s, s, k);
  }

  friendly(e) {
    const g = this.game;
    if (!e || e.type !== 'actor' || e.removed || e.dead) return false;
    if (e === g.player || e === g.companion || e.id === 'lyra' || isParty(g, e)) return true;
    try {
      return !!(g.combat?.isLawful?.(e) || g.combat?.isProtected?.(e));
    } catch {
      return false;
    }
  }

  hostile(e) {
    const g = this.game;
    const p = g.player;
    if (!e || e === p || e.type !== 'actor' || e.removed || e.dead) return false;
    try {
      return !!(g.combat?.isHostile?.(p, e) || e.provokedBy === p);
    } catch {
      return false;
    }
  }

  // The living actor nearest a world point within `max` px that passes `ok`.
  nearestActor(x, y, max, ok) {
    const list = this.game.entities?.all?.() || [];
    let best = null;
    let bd = max * max;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== 'actor' || e.removed || (typeof e.isAlive === 'function' && !e.isAlive())) continue;
      const d2 = (e.x - x) ** 2 + (e.y - 7 - y) ** 2;
      if (d2 < bd && ok(e)) {
        bd = d2;
        best = e;
      }
    }
    return best;
  }

  // A soft band with a bright dashed spine and a chevron at its end.
  band(ctx, x, y, ang, len, width, pal, k, thin) {
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const nx = -uy;
    const ny = ux;
    const hw = width / 2;
    const ex = x + ux * len;
    const ey = y + uy * len;
    ctx.beginPath();
    ctx.moveTo(x + nx * hw * 0.4, y + ny * hw * 0.4);
    ctx.lineTo(ex + nx * hw, ey + ny * hw);
    ctx.lineTo(ex - nx * hw, ey - ny * hw);
    ctx.lineTo(x - nx * hw * 0.4, y - ny * hw * 0.4);
    ctx.closePath();
    ctx.fillStyle = rgba(pal.glow, 0.3 * k);
    ctx.fill();
    ctx.lineWidth = Math.max(1, thin - 1);
    ctx.strokeStyle = rgba(pal.glow, 0.55 * k);
    ctx.stroke();
    // Dark under-stroke so the spine reads on snow and on sand.
    ctx.setLineDash([thin * 3, thin * 2.5]);
    ctx.lineDashOffset = -this.t * thin * 14;
    ctx.lineWidth = thin + 3;
    ctx.strokeStyle = rgba('#0b0915', 0.5 * k);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineWidth = thin;
    ctx.strokeStyle = rgba(pal.core, 0.95 * k);
    ctx.stroke();
    ctx.setLineDash([]);
    // Chevron
    const c = Math.max(6, hw + 3);
    ctx.lineWidth = thin + 1;
    ctx.strokeStyle = rgba(pal.spark, 0.95 * k);
    ctx.beginPath();
    ctx.moveTo(ex - ux * c + nx * c * 0.8, ey - uy * c + ny * c * 0.8);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - ux * c - nx * c * 0.8, ey - uy * c - ny * c * 0.8);
    ctx.stroke();
  }

  fillStroke(ctx, pal, k, thin, evenodd = false) {
    ctx.fillStyle = rgba(pal.glow, 0.28 * k);
    if (evenodd) ctx.fill('evenodd');
    else ctx.fill();
    ctx.lineWidth = thin + 2;
    ctx.strokeStyle = rgba('#0b0915', 0.4 * k);
    ctx.stroke();
    ctx.lineWidth = thin;
    ctx.strokeStyle = rgba(pal.core, 0.9 * k);
    ctx.stroke();
  }

  pulseRing(ctx, x, y, rad, pal, k) {
    if (this.game.settings?.reduceMotion) return;
    const f = (this.t * 1.4) % 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(pal.spark, 0.5 * (1 - f) * k);
    ctx.beginPath();
    ctx.arc(x, y, rad * (0.55 + 0.45 * f), 0, TAU);
    ctx.stroke();
  }

  dots(ctx, x0, y0, x1, y1, pal, k, s, lob) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.min(14, Math.round(d / (9 * s))));
    const h = lob ? Math.min(40 * s, d * 0.35) : 0;
    const step = 1 / n;
    const shift = this.game.settings?.reduceMotion ? 0 : (this.t * 1.5) % 1;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, (i + shift) * step);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * h;
      const rr = Math.max(1.5, s * 0.8);
      ctx.fillStyle = rgba('#0b0915', 0.4 * k);
      ctx.fillRect(Math.round(x - rr - 1), Math.round(y - rr - 1), Math.round(rr * 2 + 2), Math.round(rr * 2 + 2));
      ctx.fillStyle = rgba(pal.core, 0.9 * k);
      ctx.fillRect(Math.round(x - rr), Math.round(y - rr), Math.round(rr * 2), Math.round(rr * 2));
    }
  }

  cross(ctx, x, y, r, pal, k) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(pal.spark, 0.9 * k);
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  }

  // Corner brackets around the foe a tap or a mouse hover locked onto.
  bracket(ctx, r, s, e, pal, k) {
    if (e.removed) return;
    const c = r.worldToDevice(e.x, e.y - 9);
    const half = Math.max(9, (e.radius || 6) + 5) * s;
    const len = half * 0.45;
    ctx.lineWidth = Math.max(2, s * 0.7);
    ctx.strokeStyle = rgba(pal.spark, 0.95 * k);
    ctx.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = c.x + sx * half;
      const y = c.y + sy * half;
      ctx.moveTo(x - sx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * len);
    }
    ctx.stroke();
  }

  cancelMark(ctx, x, y, s, k) {
    const r = 6 * s;
    ctx.fillStyle = rgba('#2a0f16', 0.8 * k);
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, TAU);
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.8);
    ctx.strokeStyle = rgba('#ff9b8f', k);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y - r * 0.6);
    ctx.lineTo(x + r * 0.6, y + r * 0.6);
    ctx.moveTo(x + r * 0.6, y - r * 0.6);
    ctx.lineTo(x - r * 0.6, y + r * 0.6);
    ctx.stroke();
  }

  // Dragging the sword button: the arc the next swing will sweep.
  drawSword(ctx, r, s, sw) {
    const p = this.game.player;
    if (!p) return;
    const o = r.worldToDevice(p.x, p.y - 7);
    const ang = Math.atan2(sw.dy, sw.dx);
    const range = 24 * s;
    const angle = 1.9;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.arc(o.x, o.y, range, ang - angle / 2, ang + angle / 2);
    ctx.arc(o.x, o.y, range * 0.4, ang + angle / 2, ang - angle / 2, true);
    ctx.closePath();
    this.fillStroke(ctx, SWORD, 0.9, Math.max(2, Math.round(s * 0.75)));
    ctx.restore();
  }

  // A small four-tick reticle under the mouse (the system cursor hides over the game).
  drawReticle(ctx, r) {
    const g = this.game;
    const inp = g.input;
    const m = inp?.mouse;
    if (!m?.over || g.ui?.isTouch || g.state !== 'playing') return;
    if (g.ui?.isModalOpen?.()) return;
    const dpr = r.dpr || 1;
    const x = Math.round(m.x * dpr);
    const y = Math.round(m.y * dpr);
    const u = Math.max(1, Math.round(dpr));
    const gap = 4 * u;
    const len = 5 * u;
    const pal = this.weaving?.slotInfo?.(this.weaving.selected)?.palette;
    const tint = pal?.core || '#f4ead7';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    for (const [col, w] of [
      ['rgba(11,9,21,0.7)', 4 * u],
      [rgba(tint, 0.92), 2 * u],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x - gap - len, y);
      ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y);
      ctx.lineTo(x + gap + len, y);
      ctx.moveTo(x, y - gap - len);
      ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap);
      ctx.lineTo(x, y + gap + len);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(tint, 0.9);
    ctx.fillRect(x - u, y - u, 2 * u, 2 * u);
    ctx.restore();
  }
}

// A cone's full opening angle (radians) from whatever the descriptor gives.
export function coneAngle(pv) {
  const a = Number(pv?.angle ?? pv?.arc ?? pv?.spread);
  if (Number.isFinite(a) && a > 0) return a > TAU ? (a * Math.PI) / 180 : a;
  const w = Number(pv?.width);
  const r = Number(pv?.range) || 40;
  if (Number.isFinite(w) && w > 0) return w <= 6.3 ? w : 2 * Math.atan(w / 2 / r);
  return 1.1;
}
