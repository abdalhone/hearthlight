// Roof art for buildings (filled in below).
export function roofGeometry(b) {
  const T = 16;
  const lift = b.roof?.lift ?? 1;
  const x = b.x * T - 4;
  const w = b.w * T + 8;
  const roofTop = (b.y - lift) * T;
  const eaveY = (b.y + b.h - 2) * T + 3;
  const extra = 18;
  const y = roofTop - extra;
  const h = eaveY - y + 3;
  const surfH = eaveY - roofTop;
  const ridgeY = roofTop + Math.round(surfH * 0.36);
  const chimneys = (b.roof?.chimneys || []).map((tx, k) => ({ x: tx * T + 8, y: roofTop - 9, baseY: roofTop + Math.round(surfH * 0.22), phase: ((tx * 7 + k * 3) % 10) / 10 }));
  return { x, y, w, h, roofTop, eaveY, ridgeY, extra, chimneys, lift };
}
export function paintRoof(b) { return null; }
