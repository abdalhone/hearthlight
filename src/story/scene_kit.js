// Shared painting pieces for the story panels: skies, stars, mountain ridges, snow fields,
// pines, houses, lamp posts, standing stones and small figures. Every piece paints into a
// Buf (src/story/paint.js) in low-resolution pixels, lit from a direction the panel chooses.

import { Buf, rampAt, rampSmooth, fbm, noise, clamp, lerp, mix, hex, bayer, smooth } from './paint.js';

export const NIGHT = ['#05040e', '#0a0a1f', '#10122d', '#171b3d', '#20284f', '#2b3763'];
export const OUTLINE = '#0b0915';

// A vertical sky ramp, dithered between bands. ramp runs from the top of the sky down.
export function sky(b, L, ramp, { y0 = 0, y1 = L.H, power = 1, grain = 0, smoothBands = false } = {}) {
  b.fill((x, y) => {
    const t = clamp((y - y0) / (y1 - y0)) ** power;
    return smoothBands ? rampSmooth(ramp, t, x, y, grain || 5) : hex(rampAt(ramp, t, x, y));
  }, 0, y0, L.W, y1);
}

// Pin-prick stars, a few brighter with a cross, thinning toward the horizon.
export function stars(b, L, R, { count = 90, y1 = L.H * 0.6, colors = ['#cfd6ff', '#fff4dc', '#aebcff'] } = {}) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(R() * L.W);
    const y = Math.floor(R() ** 1.6 * y1);
    const c = colors[Math.floor(R() * colors.length)];
    const k = R();
    b.px(x, y, c, 0.35 + k * 0.5);
    if (k > 0.93) {
      b.px(x - 1, y, c, 0.35);
      b.px(x + 1, y, c, 0.35);
      b.px(x, y - 1, c, 0.35);
      b.px(x, y + 1, c, 0.35);
    }
  }
}

// Heights of a ridge line across the buffer.
export function ridgeLine(L, seed, { base, amp, freq = 0.012, oct = 5, peaks = null }) {
  const out = new Float32Array(L.W);
  for (let x = 0; x < L.W; x++) {
    let h = (fbm(x * freq, 0.5, seed, oct) - 0.5) * 2 * amp;
    if (peaks) {
      for (const p of peaks) {
        const d = Math.abs(x - p.x) / p.w;
        if (d < 1) h += p.h * (1 - d * d) * (p.sharp ? 1 - d * 0.4 : 1);
      }
    }
    out[x] = base - h;
  }
  return out;
}

// Fill below a ridge line. shade(x, y, depthBelowRidge, ridgeY) -> [r,g,b]
export function fillBelow(b, line, shade, yMax = b.h) {
  for (let x = 0; x < b.w; x++) {
    const top = Math.round(line[x]);
    for (let y = Math.max(0, top); y < yMax; y++) {
      const c = shade(x, y, y - line[x], line[x]);
      if (c) b.px(x, y, c, c.length > 3 ? c[3] : 1);
    }
  }
}

// A mountain range: broad lit and shadowed faces (from the slope of a smoothed ridge),
// crags from a 2D noise gradient, and snow gullies near the tops. light: +1 lit from the
// right, -1 from the left.
export function mountains(b, L, seed, { base, amp, freq = 0.01, peaks, rock, snow, snowLine = 0.45, light = 1, lightColor = null, haze = null, hazeK = 0, hazeDepth = 60 }) {
  const line = ridgeLine(L, seed, { base, amp, freq, peaks });
  // A low-passed copy of the ridge: its slope decides which way a whole face looks.
  const soft = new Float32Array(L.W);
  const k = Math.max(2, Math.round(6 * L.u));
  for (let x = 0; x < L.W; x++) {
    let sum = 0;
    let n = 0;
    for (let j = -k; j <= k; j++) {
      const xx = Math.max(0, Math.min(L.W - 1, x + j));
      sum += line[xx];
      n++;
    }
    soft[x] = sum / n;
  }
  let top = Infinity;
  for (let x = 0; x < L.W; x++) top = Math.min(top, line[x]);
  const span = Math.max(8, base + amp - top);
  fillBelow(b, line, (x, y, d) => {
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(L.W - 1, x + 1);
    const slope = (soft[x1] - soft[x0]) / 2;
    const face = clamp(-slope * light * 1.6, -0.45, 0.45) * Math.max(0, 1 - d / (span * 1.2));
    const cn = (fbm((x + 1) * 0.05, y * 0.09, seed + 3, 3) - fbm((x - 1) * 0.05, y * 0.09, seed + 3, 3)) * 7 * light;
    const v = clamp(0.48 + face + cn * 0.5 - (d / span) * 0.12);
    const hgt = clamp(1 - (y - top) / span);
    const gully = fbm(x * 0.045 + y * 0.03 * light, y * 0.08, seed + 9, 3);
    const isSnow = hgt > 1 - snowLine && gully + hgt * 0.55 - d * 0.004 > 0.88;
    let c = hex(rampAt(isSnow ? snow : rock, isSnow ? clamp(v + 0.15) : v, x, y));
    if (lightColor && v > 0.62) c = mix(c, lightColor, (v - 0.62) * 0.7);
    if (haze) c = mix(c, haze, clamp(hazeK + (d / hazeDepth) * 0.35));
    return c;
  });
  return line;
}

// A snow field below a gently rolling line: broad soft shading toward the light, drifts
// with bright crests, and only a little dither where bands meet.
export function snowField(b, L, seed, { base, amp = 6, freq = 0.01, ramp, lightX = L.W * 0.7, lightK = 0.35, y1 = L.H, rough = 0.28 }) {
  const line = ridgeLine(L, seed, { base, amp, freq, oct: 3 });
  fillBelow(b, line, (x, y, d) => {
    const big = fbm(x * 0.008, y * 0.02, seed + 5, 3);
    const drift = fbm(x * 0.018, y * 0.07, seed + 7, 3);
    const toward = 1 - Math.abs(x - lightX) / L.W;
    // Drift crests catch the light; the lee side of each drift is in shadow.
    const crest = drift - fbm(x * 0.018, (y + 2) * 0.07, seed + 7, 3);
    let t = 0.42 + (big - 0.5) * rough * 2 + toward * lightK + crest * 1.6 - Math.min(0.15, d * 0.0015) + (d < 2 ? 0.2 : 0);
    t = clamp(t);
    return hex(rampAt(ramp, t, x, y));
  }, y1);
  return line;
}

// A conifer: stacked tiers with ragged hems, dark with a lit flank; snow rests along the
// lit upper edge of each tier (never in stripes across it).
export function pine(b, x, y, h, { dark = '#0d1a24', mid = '#16303a', lit = '#22474d', snow = null, lightSide = 1, trunk = '#1b120e' } = {}) {
  const w = Math.max(2.5, h * 0.36);
  b.rect(x - 0.5, y - h * 0.16, 1.5, h * 0.16, trunk);
  const tiers = Math.max(3, Math.round(h / 6));
  const span = h * 0.86;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const ty = y - h * 0.12 - k * span;
    const tw = w * (1 - k * 0.82) + 0.5;
    const th = (span / tiers) * 1.7;
    const apex = [x, ty - th];
    b.poly([apex, [x + tw, ty], [x - tw, ty]], dark);
    b.poly([apex, [x + tw * lightSide, ty], [x + tw * 0.15 * lightSide, ty]], mid);
    // a ragged hem: every other pixel along the bottom hangs one lower
    for (let xx = Math.round(x - tw); xx < x + tw; xx += 2) b.px(xx, Math.round(ty), dark);
    b.line(apex[0], apex[1], x + tw * lightSide, ty, lit);
    if (snow) {
      // a cap along the lit edge, thickest near the tip
      const n = Math.max(2, Math.round(tw));
      for (let j = 0; j < n; j++) {
        const f = j / n;
        const sx = apex[0] + (tw * lightSide) * f;
        const sy = apex[1] + th * f;
        if (f < 0.7) b.px(sx, sy, snow);
        if (f < 0.35) b.px(sx - lightSide, sy, snow, 0.85);
      }
      b.px(apex[0], apex[1], snow);
    }
  }
}

// A row of pines along a line (a treeline), back to front.
export function treeline(b, L, R, line, { density = 0.35, hMin = 8, hMax = 18, colors, snow = null, lightSide = 1, every = 1 }) {
  for (let x = 0; x < L.W; x += every) {
    if (R() > density) continue;
    const h = lerp(hMin, hMax, R());
    pine(b, x + R() * 2, line[Math.max(0, Math.min(L.W - 1, Math.round(x)))] + 1, h, { ...colors, snow, lightSide });
  }
}

// A cottage seen from the front-side: wall, gable roof, lit windows, door.
// opts: { wall:[dark,mid,light], roof:[dark,mid,light], windows: n, lit: 0..1, door, chimney, snow }
export function house(b, x, baseY, w, h, roofH, opts = {}) {
  const wall = opts.wall || ['#2a2233', '#3d3346', '#52465a'];
  const roof = opts.roof || ['#1a1424', '#2c2236', '#3e3048'];
  const win = opts.window || ['#ffcf7a', '#ffb047', '#b8642a'];
  x = Math.round(x);
  baseY = Math.round(baseY);
  // Wall, darker at the foot, lit edge on the light side.
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      // horizontal boards or courses every few pixels, smooth light across the wall
      const course = (yy % 4 === 0 ? -0.06 : 0) + (noise(Math.floor(xx / 6), Math.floor(yy / 4), 7) - 0.5) * 0.08;
      const t = 0.7 - (yy / h) * 0.4 + ((opts.lightSide || -1) > 0 ? xx / w : 1 - xx / w) * 0.18 + course;
      b.px(x + xx, baseY - h + yy, rampSmooth(wall, clamp(t), x + xx, yy, 3));
    }
  }
  // Roof: a gable whose overhang throws a line of shadow on the wall.
  const rx0 = x - 2;
  const rx1 = x + w + 2;
  const top = baseY - h - roofH;
  b.poly([[rx0, baseY - h + 1], [x + w / 2, top], [rx1, baseY - h + 1]], roof[1]);
  b.poly([[x + w / 2, top], [rx1, baseY - h + 1], [x + w / 2 + 1, baseY - h + 1]], roof[0]);
  b.line(rx0, baseY - h + 1, x + w / 2, top, roof[2]);
  b.rect(x, baseY - h + 1, w, 1, '#0d0a14', 0.6);
  if (opts.snow) {
    b.line(rx0, baseY - h, x + w / 2, top - 1, opts.snow);
    b.line(x + w / 2, top - 1, rx1, baseY - h, opts.snow, 0.8);
  }
  if (opts.chimney) {
    const cx = Math.round(x + w * 0.72);
    b.rect(cx, top + roofH * 0.25, 3, roofH * 0.55, roof[0]);
    b.rect(cx, top + roofH * 0.25, 1, roofH * 0.55, roof[2]);
  }
  // Windows.
  const n = opts.windows ?? 2;
  const lit = opts.lit ?? 1;
  const ww = Math.max(2, Math.round(w * 0.14));
  const wh = Math.max(2, Math.round(h * 0.28));
  const wins = [];
  for (let i = 0; i < n; i++) {
    const wx = Math.round(x + ((i + 1) * w) / (n + 1) - ww / 2);
    const wy = Math.round(baseY - h * 0.68);
    if (opts.door && i === Math.floor(n / 2) && n % 2 === 1) continue;
    b.rect(wx - 1, wy - 1, ww + 2, wh + 2, '#140f18');
    const on = lit >= 1 || (opts.R ? opts.R() < lit : i % 2 === 0);
    for (let yy = 0; yy < wh; yy++) for (let xx = 0; xx < ww; xx++) b.px(wx + xx, wy + yy, on ? rampAt(win, 0.15 + (yy / wh) * 0.7, wx + xx, wy + yy) : '#1c1a2c');
    if (on) {
      b.rect(wx + Math.floor(ww / 2), wy, 1, wh, '#6b3a1c', 0.7);
      wins.push([wx + ww / 2, wy + wh / 2]);
    }
  }
  if (opts.door) {
    const dw = Math.max(3, Math.round(w * 0.16));
    const dh = Math.max(4, Math.round(h * 0.55));
    const dx = Math.round(x + w / 2 - dw / 2);
    b.rect(dx - 1, baseY - dh - 1, dw + 2, dh + 1, '#140f18');
    b.rect(dx, baseY - dh, dw, dh, opts.doorLit ? '#e8a050' : '#2a1a14');
    if (opts.doorLit) wins.push([dx + dw / 2, baseY - dh / 2]);
  }
  return { top, windows: wins };
}

// A village lamp post. Returns the lamp head position.
export function lampPost(b, x, baseY, h, { lit = true, iron = '#1a1822', ironLit = '#4a3a2a', flame = '#ffe08a', glass = '#ffb047' } = {}) {
  x = Math.round(x);
  baseY = Math.round(baseY);
  b.rect(x - 1, baseY - 1, 3, 1, iron);
  b.rect(x, baseY - h, 1, h, iron);
  b.rect(x + 1, baseY - h + 2, 1, h - 3, ironLit, 0.5);
  // lamp head
  const hy = baseY - h - 3;
  b.rect(x - 1, hy - 1, 3, 1, iron);
  b.rect(x - 1, hy, 3, 3, lit ? glass : '#20202c');
  if (lit) b.px(x, hy + 1, flame);
  b.rect(x - 1, hy + 3, 3, 1, iron);
  return { x: x + 0.5, y: hy + 1.5 };
}

// A broken standing stone: a tapering slab with a jagged top, lit on one side, painted
// in its own small buffer so the shading only touches the stone.
export function standingStone(b, x, baseY, w, h, { rock = ['#1e2233', '#3a4258', '#5d6880', '#8a96ad'], lightSide = 1, lightColor = null, snowCap = '#eef3ff', broken = 0.5, seed = 1, script = null, lean = 0 } = {}) {
  const pad = Math.ceil(h * 0.6) + 4;
  const bw = Math.ceil(w + pad * 2);
  const bh = Math.ceil(h + pad);
  const ox = Math.round(x - bw / 2);
  const oy = Math.round(baseY - h - pad + 1);
  const t = new Buf(bw, bh);
  const lx = bw / 2;
  const ly = bh - 1;
  const top = ly - h;
  const pts = [[lx - w / 2, ly + 1]];
  pts.push([lx - w / 2 + w * 0.06 + lean * h * 0.1, top + h * 0.14]);
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const fx = i / steps;
    const jag = (noise(i * 1.7, seed, seed) - 0.5) * h * broken * 0.55;
    pts.push([lx - w * 0.42 + fx * w * 0.84 + lean * h * 0.18, top + Math.max(-1, jag) + (fx > 0.55 ? (fx - 0.55) * h * broken * 0.6 : 0)]);
  }
  pts.push([lx + w / 2 - w * 0.06 + lean * h * 0.1, top + h * 0.16]);
  pts.push([lx + w / 2, ly + 1]);
  t.poly(pts, rock[1]);
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      if (!t.alphaAt(xx, yy)) continue;
      // How far across the slab (0 shadow side .. 1 lit side), with a bevel at both edges.
      let l = xx - 1;
      while (l >= 0 && t.alphaAt(l, yy)) l--;
      let r = xx + 1;
      while (r < bw && t.alphaAt(r, yy)) r++;
      const across = (xx - l) / Math.max(1, r - l);
      const side = lightSide > 0 ? across : 1 - across;
      const edgeLit = lightSide > 0 ? r - xx <= 1 : xx - l <= 1;
      const edgeDark = lightSide > 0 ? xx - l <= 1 : r - xx <= 1;
      const n = fbm((xx + ox) * 0.22, (yy + oy) * 0.16, seed + 11, 3);
      let v = clamp(0.18 + side * 0.55 + (n - 0.5) * 0.5 - ((yy - top) / h) * 0.12);
      if (edgeLit) v = Math.min(1, v + 0.3);
      if (edgeDark) v *= 0.55;
      // the top edge catches light
      if (!t.alphaAt(xx, yy - 1)) v = Math.min(1, v + 0.2);
      const c = hex(rampAt(rock, v, xx + ox, yy + oy));
      t.px(xx, yy, c);
      if (lightColor && v > 0.55) t.add(xx, yy, lightColor, (v - 0.55) * 0.45);
    }
  }
  // Snow caught on the top edge and in cracks.
  if (snowCap) {
    for (let xx = 0; xx < bw; xx++) {
      let yy = 0;
      while (yy < bh && !t.alphaAt(xx, yy)) yy++;
      if (yy >= bh) continue;
      const slopeOk = t.alphaAt(xx - 1, yy) || t.alphaAt(xx + 1, yy);
      if (!slopeOk) continue;
      t.px(xx, yy, snowCap);
      if (noise(xx * 0.7, 3, seed) > 0.45) t.px(xx, yy + 1, snowCap, 0.9);
    }
  }
  if (script) {
    for (let i = 0; i < 4; i++) {
      const sy = Math.round(top + h * 0.3 + i * 3);
      const sx = Math.round(lx - 1 + (i % 2));
      if (t.alphaAt(sx, sy)) {
        t.px(sx, sy, script, 0.75);
        t.px(sx + 1, sy, script, 0.4);
      }
    }
  }
  t.outline(OUTLINE);
  b.draw(t, ox, oy);
  return { top: oy + top, left: ox + lx - w / 2, right: ox + lx + w / 2 };
}

// Fog: a soft noisy band, transparent elsewhere. Paint into its own layer.
export function fogBand(b, L, seed, { y, h, color = '#8a93b8', alpha = 0.35, freq = 0.02, tile = true }) {
  const col = hex(color);
  for (let yy = Math.floor(y - h); yy < y + h; yy++) {
    const fy = 1 - Math.abs(yy - y) / h;
    if (fy <= 0) continue;
    for (let x = 0; x < L.W; x++) {
      // Tileable across the buffer width so a scrolling fog layer wraps without a seam.
      let n = fbm(x * freq, yy * freq * 2.2, seed, 4);
      if (tile) {
        const n2 = fbm((x - L.W) * freq, yy * freq * 2.2, seed, 4);
        n = lerp(n, n2, x / L.W);
      }
      const a = clamp(smooth(0.35, 0.75, n) * fy * fy * alpha * 1.6);
      const q = Math.floor(a * 6 + bayer(x, yy)) / 6;
      if (q > 0) b.px(x, yy, col, q);
    }
  }
}

// A tiny far figure (2-3 px wide): for people seen from very far away.
export function tinyFigure(b, x, y, { body = '#1a1826', head = '#d7b38c', cloak = null, h = 6, lean = 0, staff = null } = {}) {
  x = Math.round(x);
  y = Math.round(y);
  b.rect(x - 1, y - h + 2, 3, h - 2, cloak || body);
  b.px(x + lean, y - h + 1, head);
  b.px(x - 1, y, body);
  b.px(x + 1, y, body);
  if (staff) {
    b.line(x + 2, y - h - 1, x + 2, y, '#5a4030');
    b.px(x + 2, y - h - 2, staff);
  }
}
