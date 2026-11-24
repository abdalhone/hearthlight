// Procedural sword-slash crescents for the player's combo, built pixel by pixel so
// they stay crisp at the game's low resolution. Sprites are generated lazily (browser
// only) and cached per combo step, facing bucket, frame and swing direction.

export const SLASH_FRAMES = 5;
const ANGLE_BUCKETS = 16;

// One style per combo step: radius, band thickness, sweep (radians), colors lead -> tail.
export const SLASH_STYLES = [
  { R: 17, th: 5, sweep: 2.0, colors: ['#ffffff', '#e6ecff', '#a9b6d6'] },
  { R: 18, th: 6, sweep: 2.4, colors: ['#ffffff', '#e6ecff', '#a9b6d6'] },
  { R: 21, th: 7, sweep: 3.5, colors: ['#ffffff', '#ffe27a', '#e4b83d'] },
];

const cache = new Map();

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Returns { canvas, cx, cy } where (cx, cy) is the swing center inside the canvas.
export function slashSprite(step, angle, frame, ccw) {
  const s = Math.max(0, Math.min(SLASH_STYLES.length - 1, step | 0));
  const bucket = ((Math.round((angle / (Math.PI * 2)) * ANGLE_BUCKETS) % ANGLE_BUCKETS) + ANGLE_BUCKETS) % ANGLE_BUCKETS;
  const f = Math.max(0, Math.min(SLASH_FRAMES - 1, frame | 0));
  const key = ((s * ANGLE_BUCKETS + bucket) * SLASH_FRAMES + f) * 2 + (ccw ? 1 : 0);
  let entry = cache.get(key);
  if (!entry) {
    entry = buildSlash(SLASH_STYLES[s], (bucket / ANGLE_BUCKETS) * Math.PI * 2, f, ccw);
    cache.set(key, entry);
  }
  return entry;
}

function buildSlash(style, facing, frame, ccw) {
  const { R, th, sweep } = style;
  const size = R * 2 + 3;
  const cx = R + 1.5;
  const cy = R + 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const rgb = style.colors.map(hexToRgb);
  const dirSign = ccw ? -1 : 1;
  const start = facing - (dirSign * sweep) / 2;
  // The blade's leading edge races ahead; the trail thins and then follows it out.
  const p = (frame + 1) / SLASH_FRAMES;
  const lead = sweep * Math.min(1, p * 1.35);
  const tail = Math.max(0, sweep * (p * 1.35 - 0.75));
  const span = Math.max(0.001, lead - tail);
  const TWO_PI = Math.PI * 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > R || r < R - th - 1) continue;
      let u = (Math.atan2(dy, dx) - start) * dirSign;
      u = ((u % TWO_PI) + TWO_PI) % TWO_PI;
      if (u < tail || u > lead) continue;
      const w = (lead - u) / span; // 0 at the leading edge, 1 at the end of the trail
      const inner = R - th * (1 - w * 0.6);
      if (r < inner) continue;
      if (w > 0.7 && ((px + py) & 1)) continue; // sparse, dithered tail
      const outer = r > R - 1.3;
      const ci = w < 0.22 || (outer && w < 0.6) ? 0 : w < 0.6 ? 1 : 2;
      const i = (py * size + px) * 4;
      data[i] = rgb[ci][0];
      data[i + 1] = rgb[ci][1];
      data[i + 2] = rgb[ci][2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, cx: Math.floor(cx), cy: Math.floor(cy) };
}
