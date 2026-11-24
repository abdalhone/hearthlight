// Pure helpers for the renderer: word wrap, typewriter timing, bubble placement,
// view sizing and color math. Nothing here touches the DOM, so all of it is
// unit-tested under node (tests/render.test.mjs).

export const ELLIPSIS = '…';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Text

// Greedy word wrap to `maxChars` per line, at most `maxLines` lines. Words longer
// than a line are split with a hyphen so nothing spills out of a bubble. When the
// text does not fit, the last kept line ends with an ellipsis (the chat log keeps
// the full text, the bubble is only a glimpse).
export function wrapText(text, maxChars = 26, maxLines = 4) {
  const width = Math.max(4, maxChars | 0);
  const limit = Math.max(1, maxLines | 0);
  const words = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, width - 1) + '-');
      w = w.slice(width - 1);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= limit) return { lines, truncated: false };

  const kept = lines.slice(0, limit);
  let last = kept[limit - 1];
  while (last.length + 1 > width) {
    const i = last.lastIndexOf(' ');
    last = i > 0 ? last.slice(0, i) : last.slice(0, width - 1);
  }
  last = last.replace(/[\s,.;:!?\-—]+$/, '') + ELLIPSIS;
  kept[limit - 1] = last;
  return { lines: kept, truncated: true };
}

// Extra pause (in character-times) after punctuation that ends a clause, so the
// typewriter reads like speech instead of a ticker.
function pauseAfter(code, next) {
  if (next !== 32 && next !== 10 && next !== -1) return 0;
  if (code === 46 || code === 33 || code === 63 || code === 8230) return 6; // . ! ? …
  if (code === 44 || code === 59 || code === 58 || code === 8212) return 2.5; // , ; : —
  return 0;
}

// How many characters of `text` are visible `elapsed` seconds after it started
// typing at `cps` characters per second. Non-positive or non-finite speed = instant.
export function revealCount(text, elapsed, cps) {
  const n = text.length;
  if (!(cps > 0) || !Number.isFinite(cps)) return n;
  let budget = elapsed * cps;
  for (let i = 0; i < n; i++) {
    budget -= 1;
    if (budget < 0) return i;
    budget -= pauseAfter(text.charCodeAt(i), i + 1 < n ? text.charCodeAt(i + 1) : -1);
  }
  return n;
}

// Seconds until `text` is fully typed at `cps` (matches revealCount).
export function typingDuration(text, cps) {
  if (!(cps > 0) || !Number.isFinite(cps)) return 0;
  const n = text.length;
  let units = 0;
  for (let i = 0; i < n; i++) {
    units += 1;
    if (i + 1 < n) units += pauseAfter(text.charCodeAt(i), text.charCodeAt(i + 1));
  }
  return units / cps;
}

// Characters per second for the typewriter. settings.textSpeed is a multiplier
// (1 = normal); 0 or anything >= 4 means "show at once".
export function typingCps(textSpeed, base = 40) {
  const s = Number(textSpeed);
  if (!Number.isFinite(s) || s <= 0 || s >= 4) return Infinity;
  return base * s;
}

// How long a speech bubble stays up: typing time plus time to read it.
export function bubbleLifetime(text, cps, kind = 'say') {
  const n = String(text).length;
  let hold = clamp(1.7 + n * 0.048, 2.2, 7);
  if (kind === 'bark' || kind === 'shout') hold *= 0.8;
  return typingDuration(String(text), cps) + hold;
}

// ---------------------------------------------------------------------------
// Screen sizing

// Pick the canvas size and the integer upscale. The shorter screen side shows about
// `target / zoom` world pixels; the buffer is one pixel larger than the view so the
// camera can scroll by sub-pixel amounts.
export function viewMetrics(cssW, cssH, devicePixelRatio = 1, zoom = 1, target = 240) {
  const dpr = clamp(Number(devicePixelRatio) || 1, 1, 3);
  const cw = Math.max(1, Math.round((Number(cssW) || 1) * dpr));
  const ch = Math.max(1, Math.round((Number(cssH) || 1) * dpr));
  const z = Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;
  const scale = Math.max(1, Math.round((Math.min(cw, ch) / target) * z));
  const vw = cw / scale;
  const vh = ch / scale;
  return { dpr, cw, ch, scale, vw, vh, bw: Math.ceil(vw) + 1, bh: Math.ceil(vh) + 1 };
}

// Speech text size in device pixels: about 6 world pixels tall, but never smaller
// than 13 CSS px (phones) nor bigger than 20 CSS px (large monitors).
export function uiFontPx(scale, dpr = 1) {
  const css = clamp((6 * scale) / dpr, 13, 20);
  return Math.round(css * dpr);
}

// The "pixel" of the bubble frames, in device pixels, tied to the text size so
// borders stay chunky but proportionate on every screen.
export function pixelUnit(fontPx) {
  return Math.max(1, Math.round(fontPx / 12));
}

// ---------------------------------------------------------------------------
// Bubble placement

// Place a bubble of size w×h above an anchor (the speaker's head at ax, ay), keeping
// it `margin` away from every screen edge. Near the top of the screen it flips below
// the speaker (footY). `tailHalf` + `corner` keep the tail inside the straight part
// of the box edge. Writes into `out` (no allocation in the render loop).
export function layoutBubble(o, out = {}) {
  const { ax, ay, w, h, screenW, screenH } = o;
  const footY = o.footY ?? ay;
  const gap = o.gap ?? 0;
  const margin = o.margin ?? 0;
  const corner = o.corner ?? 0;
  const tailHalf = o.tailHalf ?? 0;
  const x = clamp(ax - w / 2, margin, Math.max(margin, screenW - margin - w));
  let y = ay - gap - h;
  let below = false;
  if (y < margin) {
    below = true;
    y = footY + gap;
  }
  y = clamp(y, margin, Math.max(margin, screenH - margin - h));
  const lo = x + corner + tailHalf;
  const hi = x + w - corner - tailHalf;
  out.x = x;
  out.y = y;
  out.w = w;
  out.h = h;
  out.below = below;
  out.tailX = lo <= hi ? clamp(ax, lo, hi) : x + w / 2;
  return out;
}

function overlaps(a, b, gap) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

function hitsPlaced(rects, i, x, y, w, h, gap) {
  for (let j = 0; j < i; j++) {
    const o = rects[j];
    if (x < o.x + o.w + gap && x + w + gap > o.x && y < o.y + o.h + gap && y + h + gap > o.y) return true;
  }
  return false;
}

// Keep bubbles from covering each other. Rects earlier in the list keep their place.
// Each later one that overlaps takes the cheapest free spot beside, above or below
// the rects it could touch; sideways moves are preferred (cheaper) as long as the box
// still spans its speaker (`ax`, with `tailPad` of straight edge), so its tail stays
// attached. Optional `maxBottom` / `minTop` keep a bubble above (or below) its
// speaker's head. With no free spot it climbs upward. Mutates x/y in place and
// returns how many rects moved.
export function stackRects(rects, count = rects.length, gap = 4, margin = 0, screenH = Infinity, screenW = Infinity) {
  let moved = 0;
  for (let i = 1; i < count; i++) {
    const r = rects[i];
    let collides = false;
    for (let j = 0; j < i; j++) if (overlaps(r, rects[j], gap)) collides = true;
    if (!collides) continue;
    const pad = r.tailPad ?? 0;
    let bestX = r.x;
    let bestY = r.y;
    let bestCost = Infinity;
    const consider = (x, y, sideways) => {
      if (x < margin || y < margin || x + r.w > screenW - margin || y + r.h > screenH - margin) return;
      if (sideways && Number.isFinite(r.ax) && (r.ax < x + pad || r.ax > x + r.w - pad)) return;
      if (Number.isFinite(r.maxBottom) && y + r.h > r.maxBottom + 0.5) return;
      if (Number.isFinite(r.minTop) && y < r.minTop - 0.5) return;
      if (hitsPlaced(rects, i, x, y, r.w, r.h, gap)) return;
      const cost = Math.abs(x - r.x) + Math.abs(y - r.y) * 1.6;
      if (cost < bestCost) {
        bestCost = cost;
        bestX = x;
        bestY = y;
      }
    };
    for (let j = 0; j < i; j++) {
      const o = rects[j];
      consider(o.x + o.w + gap, r.y, true);
      consider(o.x - gap - r.w, r.y, true);
      consider(r.x, o.y - gap - r.h, false);
      consider(r.x, o.y + o.h + gap, false);
    }
    if (bestCost < Infinity) {
      r.x = bestX;
      r.y = bestY;
      moved++;
      continue;
    }
    const startY = r.y;
    for (let pass = 0; pass < 10; pass++) {
      let hit = null;
      for (let j = 0; j < i; j++) {
        if (overlaps(r, rects[j], gap)) {
          hit = rects[j];
          break;
        }
      }
      if (!hit) break;
      const up = hit.y - gap - r.h;
      r.y = up >= margin ? up : hit.y + hit.h + gap;
      if (r.y + r.h > screenH - margin) {
        r.y = Math.max(margin, screenH - margin - r.h);
        break;
      }
    }
    if (r.y !== startY) moved++;
  }
  return moved;
}

// Where to draw an edge marker for something at (tx, ty) that may be off screen:
// the point where the ray from the screen center toward it crosses a rectangle
// inset from the edges. Writes { x, y, angle, onScreen } into `out`.
export function edgePoint(tx, ty, w, h, inset = 0, out = {}) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  out.angle = Math.atan2(dy, dx);
  out.onScreen = tx >= 0 && ty >= 0 && tx <= w && ty <= h;
  const hw = Math.max(1, cx - inset);
  const hh = Math.max(1, cy - inset);
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  out.x = cx + dx * s;
  out.y = cy + dy * s;
  return out;
}

// ---------------------------------------------------------------------------
// Floating numbers

const NUMBER_STYLES = {
  damage: { fill: '#f4ead7', scale: 1 },
  crit: { fill: '#ffe27a', scale: 1.45 },
  heal: { fill: '#58cf8f', scale: 1.05 },
  xp: { fill: '#e4b83d', scale: 0.9 },
  hurt: { fill: '#ff6b5e', scale: 1.1 },
  info: { fill: '#b9ad99', scale: 0.85 },
};

// Style of a floating number. `color` may be a style name ('damage', 'crit',
// 'heal', 'xp', 'hurt', 'info') or a CSS color; crits are always big and yellow.
export function numberStyle(color, text, opts = {}) {
  const t = String(text ?? '');
  let kind = opts.kind && NUMBER_STYLES[opts.kind] ? opts.kind : NUMBER_STYLES[color] ? color : null;
  if (opts.crit) kind = 'crit';
  if (!kind) {
    if (/!\s*$/.test(t)) kind = 'crit';
    else if (/\bxp\b/i.test(t)) kind = 'xp';
    else if (/^\s*\+/.test(t)) kind = 'heal';
    else kind = 'damage';
  }
  const base = NUMBER_STYLES[kind];
  const custom = typeof color === 'string' && !NUMBER_STYLES[color] && /^(#|rgb|hsl)/i.test(color);
  return { kind, fill: custom && kind !== 'crit' ? color : base.fill, scale: base.scale };
}

// ---------------------------------------------------------------------------
// Color

export function hexToRgbArray(hex, out = [0, 0, 0]) {
  let h = String(hex || '').trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = /^[0-9a-f]{6}/i.test(h) ? parseInt(h.slice(0, 6), 16) : NaN;
  if (!Number.isFinite(n)) {
    out[0] = out[1] = out[2] = 255;
    return out;
  }
  out[0] = (n >> 16) & 255;
  out[1] = (n >> 8) & 255;
  out[2] = n & 255;
  return out;
}

export function lerpRgb(a, b, t, out = [0, 0, 0]) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

// Mix a color toward white: used for the hot core of bright lights.
export function lighten(hex, t) {
  const c = hexToRgbArray(hex);
  const r = Math.round(c[0] + (255 - c[0]) * t);
  const g = Math.round(c[1] + (255 - c[1]) * t);
  const b = Math.round(c[2] + (255 - c[2]) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Perceived brightness 0..255 (Rec. 709 weights).
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Ambient light (a multiply color, 255 = untouched) through the day.
// Warm golden morning, neutral noon, orange then pink dusk, deep blue night.
export const AMBIENT_KEYS = [
  [0, [46, 54, 104]],
  [4.6, [46, 54, 104]],
  [5.4, [92, 80, 132]],
  [6.2, [214, 150, 132]],
  [7.0, [255, 204, 152]],
  [8.6, [255, 236, 208]],
  [10.5, [255, 255, 255]],
  [15.6, [255, 255, 255]],
  [17.2, [255, 232, 196]],
  [18.3, [255, 186, 140]],
  [19.2, [218, 138, 152]],
  [20.0, [130, 104, 162]],
  [20.8, [70, 72, 128]],
  [21.6, [46, 54, 104]],
  [24, [46, 54, 104]],
];

const RAIN_TINT = [0.66, 0.73, 0.86];
const CLOUD_TINT = [0.86, 0.88, 0.94];
const FOG_TINT = [0.9, 0.93, 0.97];
const INDOOR_TINT = [0.9, 0.81, 0.69];
const INDOOR_FLOOR = [58, 46, 50];
const MOONLIGHT = [14, 14, 18];
const LIGHTNING = [236, 240, 255];
const _k = [0, 0, 0];

function sampleKeys(hour, out) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < AMBIENT_KEYS.length; i++) {
    const [h1, c1] = AMBIENT_KEYS[i];
    if (h <= h1) {
      const [h0, c0] = AMBIENT_KEYS[i - 1];
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      const s = t * t * (3 - 2 * t);
      return lerpRgb(c0, c1, s, out);
    }
  }
  const last = AMBIENT_KEYS[AMBIENT_KEYS.length - 1][1];
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

function tint(c, mul, t) {
  c[0] *= 1 + (mul[0] - 1) * t;
  c[1] *= 1 + (mul[1] - 1) * t;
  c[2] *= 1 + (mul[2] - 1) * t;
}

// The ambient multiply color for an hour (0..24) and environment:
//   env = { cloud, rain, fog, indoor, moon, sky } each 0..1
//   moon = how much clear moonlight there is; sky = a lightning flash.
// Writes { r, g, b, darkness } into `out`; darkness is 0 (noon) .. ~0.8 (midnight).
export function ambientAt(hour, env = {}, out = {}) {
  const c = sampleKeys(Number(hour) || 0, _k);
  const night = clamp((200 - luminance(c[0], c[1], c[2])) / 145, 0, 1);
  const cloud = clamp(env.cloud || 0, 0, 1);
  const rain = clamp(env.rain || 0, 0, 1);
  const fog = clamp(env.fog || 0, 0, 1);
  const indoor = clamp(env.indoor || 0, 0, 1);
  const moon = clamp(env.moon ?? 1, 0, 1) * (1 - Math.max(cloud, rain, fog * 0.6));
  c[0] += MOONLIGHT[0] * moon * night;
  c[1] += MOONLIGHT[1] * moon * night;
  c[2] += MOONLIGHT[2] * moon * night;
  const outdoorWeather = 1 - indoor * 0.5;
  tint(c, CLOUD_TINT, cloud * outdoorWeather);
  tint(c, RAIN_TINT, rain * outdoorWeather);
  tint(c, FOG_TINT, fog * outdoorWeather);
  if (indoor > 0) {
    const r0 = c[0] * INDOOR_TINT[0];
    const g0 = c[1] * INDOOR_TINT[1];
    const b0 = c[2] * INDOOR_TINT[2];
    c[0] += (Math.max(r0, INDOOR_FLOOR[0]) - c[0]) * indoor;
    c[1] += (Math.max(g0, INDOOR_FLOOR[1]) - c[1]) * indoor;
    c[2] += (Math.max(b0, INDOOR_FLOOR[2]) - c[2]) * indoor;
  }
  const sky = clamp(env.sky || 0, 0, 1) * (1 - indoor * 0.7);
  if (sky > 0) lerpRgb(c, LIGHTNING, sky * 0.85, c);
  out.r = clamp(Math.round(c[0]), 0, 255);
  out.g = clamp(Math.round(c[1]), 0, 255);
  out.b = clamp(Math.round(c[2]), 0, 255);
  out.darkness = clamp(Math.round((1 - luminance(out.r, out.g, out.b) / 255) * 1000) / 1000, 0, 1);
  return out;
}

// Light flicker for campfires and torches: a smooth pseudo-random wobble in -1..1
// that differs per light (phase) but needs no state.
export function flickerWave(time, phase) {
  return (
    Math.sin(time * 11.3 + phase * 7.1) * 0.5 +
    Math.sin(time * 7.1 + phase * 3.3) * 0.3 +
    Math.sin(time * 23.7 + phase * 11.9) * 0.2
  );
}
