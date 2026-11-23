// Small pixel-art drawing toolkit used by every art module. All coordinates are
// integers in sprite pixels; nothing here anti-aliases.

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

export function hline(ctx, x, y, w, color) {
  rect(ctx, x, y, w, 1, color);
}

export function vline(ctx, x, y, h, color) {
  rect(ctx, x, y, 1, h, color);
}

// Bresenham line.
export function line(ctx, x0, y0, x1, y1, color) {
  x0 |= 0;
  y0 |= 0;
  x1 |= 0;
  y1 |= 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// Filled (or outlined) pixel circle / ellipse.
export function ellipse(ctx, cx, cy, rx, ry, color, fill = true) {
  ctx.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const d = (x * x) / (rx * rx || 1) + (y * y) / (ry * ry || 1);
      if (fill ? d <= 1.0 : d <= 1.0 && d > 0.62) ctx.fillRect((cx + x) | 0, (cy + y) | 0, 1, 1);
    }
  }
}

export function circle(ctx, cx, cy, r, color, fill = true) {
  ellipse(ctx, cx, cy, r, r, color, fill);
}

// Ordered-dither fill between two colors. `level` 0..1 is how much of c2 shows.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export function dither(ctx, x, y, w, h, c1, c2, level = 0.5) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = (BAYER4[(y + j) & 3][(x + i) & 3] + 0.5) / 16;
      px(ctx, x + i, y + j, t < level ? c2 : c1);
    }
  }
}

// Draw char-art rows. `map` maps a character to a color ('.' or ' ' = transparent).
export function fromRows(ctx, rows, map, ox = 0, oy = 0) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = map[row[x]];
      if (c) px(ctx, ox + x, oy + y, c);
    }
  }
}

// Add a 1px outline around every opaque pixel (in place). Returns the canvas.
export function outline(canvas, color, { diagonal = false } = {}) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);
  const a = src.data;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 20;
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque(x, y)) continue;
      let n = opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1);
      if (!n && diagonal) n = opaque(x - 1, y - 1) || opaque(x + 1, y - 1) || opaque(x - 1, y + 1) || opaque(x + 1, y + 1);
      if (n) ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function flipX(canvas) {
  const { canvas: out, ctx } = makeCanvas(canvas.width, canvas.height);
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

// Replace exact colors: map of '#rrggbb' -> '#rrggbb'.
export function recolor(canvas, map) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const entries = Object.entries(map).map(([from, to]) => [hexToRgb(from), hexToRgb(to)]);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (const [f, t] of entries) {
      if (d[i] === f.r && d[i + 1] === f.g && d[i + 2] === f.b) {
        d[i] = t.r;
        d[i + 1] = t.g;
        d[i + 2] = t.b;
        break;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// A silhouette copy filled with one color (hit flashes, shadows).
export function silhouette(canvas, color) {
  const { canvas: out, ctx } = makeCanvas(canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return out;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Pick a color from a dark->light ramp with t in [0, 1].
export function ramp(rampArr, t) {
  const i = Math.max(0, Math.min(rampArr.length - 1, Math.round(t * (rampArr.length - 1))));
  return rampArr[i];
}
