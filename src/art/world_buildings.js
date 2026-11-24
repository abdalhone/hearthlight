import { PixelBuf, rgb, mixc, shade, bayer, ih } from './world_pixbuf.js';
import { lut } from './world_textures.js';
import { T } from '../world/tiles.js';

// Buildings: the front-faced walls painted into the ground chunks, the inside faces
// you see when a roof fades, and the roofs themselves (drawn over everything by
// map.drawRoofs). Light comes from the upper left; surfaces are shaded with soft
// gradients rather than flat fills (DESIGN §18).
//
// A building occupies b.x..b.x+w-1 × b.y..b.y+h-1 tiles. Its last two rows are the
// facade (32 px of wall facing the viewer); the roof covers everything above, down
// to 3 px into the facade.

const TS = 16;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pick = (L, t) => L[Math.round(clamp01(t) * (L.length - 1))];

// ---------------------------------------------------------------------------
// Roof geometry (shared with the map for culling, fading and chimney smoke).

export function roofGeometry(b) {
  const lift = b.roof?.lift ?? 1;
  const x = b.x * TS - 4;
  const w = b.w * TS + 8;
  const roofTop = (b.y - lift) * TS;
  const eaveY = (b.y + b.h - 2) * TS + 3;
  const extra = b.roof?.belfry ? 36 : 18;
  const y = roofTop - extra;
  const h = eaveY - y + 4;
  const surfH = eaveY - roofTop;
  const ridgeY = roofTop + Math.round(surfH * 0.34);
  const chimneys = (b.roof?.chimneys || []).map((tx, k) => ({
    x: tx * TS + 8,
    y: roofTop - 9,
    baseY: ridgeY + 6,
    phase: ((tx * 7 + k * 3) % 10) / 10,
  }));
  return { x, y, w, h, roofTop, eaveY, ridgeY, extra, chimneys, lift };
}

// ---------------------------------------------------------------------------
// Palettes

const WOOD = lut(['#24140f', '#3a2218', '#55331f', '#714629', '#8c5a35', '#a87444', '#c08c58']);
const PLASTER = lut(['#6e5a55', '#8f7a70', '#ad978a', '#c7b19f', '#dcc8b2', '#ecdcc6', '#f6ecdb']);
const STONE = lut(['#25232e', '#363443', '#4b4958', '#625f70', '#7b788a', '#9693a4', '#b4b2c0']);
const STONE_WARM = lut(['#2c2526', '#3f3536', '#574a48', '#70605b', '#8a7870', '#a59287', '#c0ae9f']);
const LOGS = lut(['#24150e', '#3b2416', '#56351f', '#714829', '#8a5c34', '#a37443', '#ba8b55']);
const ENDGRAIN = lut(['#5a3d26', '#7d5a38', '#a07a4c', '#c09a64', '#d6b47e']);
const DOORWAY = lut(['#0e0b12', '#17121b', '#211921', '#2c2126', '#3a2b2a']);

const ROOF_STYLES = {
  red: lut(['#2c1018', '#471a22', '#66262a', '#88352f', '#a8493a', '#c4614a', '#dd8360']),
  blue: lut(['#141a2c', '#1f2a46', '#2c3d63', '#3b5282', '#4f6a9e', '#6888b8', '#8aa6cc']),
  moss: lut(['#1a2219', '#273324', '#364730', '#485c3a', '#5c7146', '#768a55', '#93a56a']),
  slate: lut(['#191c27', '#252a38', '#333a4b', '#444d61', '#586379', '#6f7b91', '#8b96aa']),
  thatch: lut(['#3a2812', '#56401c', '#765a27', '#977632', '#b69340', '#d1b05a', '#e8cd82']),
};

// ---------------------------------------------------------------------------
// Facades (the two bottom rows of every building)

// Vertical posts of a timber frame, as facade x offsets (px).
function timberPosts(b) {
  const W = b.w * TS;
  const d = (b.doorTiles?.[0]?.tx ?? b.x + (b.w >> 1)) - b.x;
  const dc = d * TS + 8;
  const posts = [0, W - 3, d * TS, d * TS + 13];
  for (const off of [56, 104, 152]) {
    for (const s of [-1, 1]) {
      const p = dc + s * off - 1;
      if (p > 6 && p < W - 9) posts.push(p);
    }
  }
  return posts;
}

function facadeTimber(b, fx, fy, wx, wy, posts) {
  const W = b.w * TS;
  // Stone plinth.
  if (fy >= 27) {
    const row = fy < 30 ? 0 : 1;
    const bx = Math.floor((fx + row * 5) / 10);
    const tone = 0.42 + (ih(bx, row, b.x) - 0.5) * 0.2;
    const ex = (fx + row * 5) % 10;
    let t = tone;
    if (fy === 27) t += 0.18;
    if (fy === 29 || ex === 9) t = 0.12;
    else if (ex === 0) t += 0.08;
    return pick(STONE_WARM, t + (bayer(wx, wy) - 0.5) * 0.04);
  }
  // Posts.
  for (let k = 0; k < posts.length; k++) {
    const p = posts[k];
    if (fx >= p && fx < p + 3) {
      const t = fx === p ? 0.62 : fx === p + 2 ? 0.3 : 0.48;
      return pick(WOOD, t + (ih(wx, wy >> 2, 5) - 0.5) * 0.08 - (fy < 4 ? 0.12 : 0));
    }
  }
  // Sill and mid rail.
  if (fy >= 24 && fy <= 26) return pick(WOOD, (fy === 24 ? 0.6 : fy === 26 ? 0.28 : 0.45) + (ih(wx >> 2, fy, 6) - 0.5) * 0.06);
  if (fy >= 11 && fy <= 12) return pick(WOOD, fy === 11 ? 0.58 : 0.36);
  if (fy <= 1) return pick(WOOD, 0.3);
  // Diagonal braces in the lower panels next to the corner posts.
  const lp = fx - 3;
  const rp = W - 4 - fx;
  const by = fy - 13;
  if (by >= 0 && by < 11) {
    if (lp >= 0 && Math.abs(lp - by) <= 1) return pick(WOOD, lp - by === -1 ? 0.6 : 0.42);
    if (rp >= 0 && Math.abs(rp - by) <= 1) return pick(WOOD, rp - by === -1 ? 0.6 : 0.42);
  }
  // Plaster: soft gradient, darker under the eave and near the beams, faint stains.
  let t = 0.68 - Math.max(0, 6 - fy) * 0.035 + (fy === 13 || fy === 2 ? -0.08 : 0) + (fy === 23 ? -0.06 : 0);
  t += (ih(wx >> 1, wy >> 1, 7) - 0.5) * 0.05 + (ih(wx >> 3, wy >> 3, 8) - 0.5) * 0.05;
  if (fy > 18 && ih(wx >> 2, 0, 9) > 0.8) t -= (fy - 18) * 0.012;
  return pick(PLASTER, t + (bayer(wx, wy) - 0.5) * 0.03);
}

function facadeStone(b, fx, fy, wx, wy) {
  const W = b.w * TS;
  const course = Math.floor(fy / 8);
  const ry = fy % 8;
  // Quoins: big alternating corner stones.
  const quoin = (fx < 7 && course % 2 === 0) || (fx < 11 && course % 2 === 1) || (fx > W - 8 && course % 2 === 0) || (fx > W - 12 && course % 2 === 1);
  const off = course % 2 ? 7 : 0;
  const bw = 14;
  const bx = Math.floor((fx + off) / bw);
  const ex = (fx + off) % bw;
  const L = b.material === 'stone' ? STONE : STONE_WARM;
  let t = 0.5 + (ih(bx, course, b.x * 3 + b.y) - 0.5) * 0.26 + (quoin ? 0.12 : 0);
  if (ry === 7 || (!quoin && ex === bw - 1)) return pick(L, 0.14);
  if (ry === 0) t += 0.16;
  else if (ry === 6) t -= 0.12;
  if (!quoin && ex === 0) t += 0.08;
  t += (ih(wx, wy, 11) - 0.5) * 0.07 - Math.max(0, 5 - fy) * 0.04;
  // Damp and moss toward the ground.
  if (fy > 26 && ih(wx >> 1, 0, 12) > 0.6) return mixc(pick(L, t), rgb('#3d5a31'), 0.45);
  return pick(L, t + (bayer(wx, wy) - 0.5) * 0.04);
}

const LOG_PROFILE = [0.7, 0.62, 0.52, 0.42, 0.3, 0.16];

function facadeLog(b, fx, fy, wx, wy) {
  const W = b.w * TS;
  if (fy >= 30) return pick(STONE_WARM, (fy === 30 ? 0.5 : 0.3) + (ih(wx >> 2, 0, 13) - 0.5) * 0.15);
  const row = Math.floor(fy / 6);
  const ry = fy % 6;
  // Log ends stick out at the corners: round end-grain.
  for (const cx of [2.5, W - 3.5]) {
    const dx = fx - cx;
    const dy = ry - 2.5;
    if (dx * dx + dy * dy <= 8) {
      const d = Math.hypot(dx, dy);
      const ring = Math.floor(d * 1.2) % 2;
      return pick(ENDGRAIN, 0.75 - d * 0.12 - ring * 0.12 - (dx + dy) * 0.04);
    }
  }
  const t = LOG_PROFILE[ry] + (ih(wx >> 3, row, 14) - 0.5) * 0.1 + (ih(wx, wy, 15) - 0.5) * 0.06 + (ih(wx >> 1, row, 16) > 0.93 ? -0.15 : 0);
  return pick(LOGS, t);
}

// The dark doorway with its frame; the door object (a sprite) covers the opening when shut.
function doorway(b, fx, fy, dx0, wx, wy, base) {
  const ox = fx - dx0;
  if (fy < 4) return null;
  const stone = b.material === 'stone';
  const frame = stone ? STONE : WOOD;
  // Lintel.
  if (fy >= 4 && fy <= 6 && ox >= 0 && ox <= 15) return pick(frame, (fy === 4 ? 0.72 : fy === 6 ? 0.25 : 0.5) + (stone ? 0.1 : 0));
  if (fy > 6 && (ox === 0 || ox === 1 || ox === 14 || ox === 15)) return pick(frame, ox === 0 ? 0.62 : ox === 15 ? 0.22 : ox === 1 ? 0.45 : 0.35);
  if (fy > 6 && ox >= 2 && ox <= 13) {
    if (fy >= 30) return pick(STONE_WARM, fy === 30 ? 0.62 : 0.45); // threshold step
    const t = (fy - 7) / 23;
    return pick(DOORWAY, 0.15 + t * 0.6 + (ox === 2 ? -0.1 : 0) + (bayer(wx, wy) - 0.5) * 0.05);
  }
  return base;
}

// Paint one facade tile (16×16) into `out` at (lx, ly).
export function paintFacadeTile(out, lx, ly, b, tx, ty) {
  const W = out.w;
  const d = out.data;
  const fy0 = (ty - (b.y + b.h - 2)) * TS;
  const fx0 = (tx - b.x) * TS;
  const dt = b.doorTiles?.[0];
  const dx0 = dt ? (dt.tx - b.x) * TS : -999;
  const posts = b._posts || (b._posts = timberPosts(b));
  for (let py = 0; py < TS; py++) {
    const fy = fy0 + py;
    const wy = ty * TS + py;
    for (let px = 0; px < TS; px++) {
      const fx = fx0 + px;
      const wx = tx * TS + px;
      let c;
      if (b.material === 'stone') c = facadeStone(b, fx, fy, wx, wy);
      else if (b.material === 'log') c = facadeLog(b, fx, fy, wx, wy);
      else c = facadeTimber(b, fx, fy, wx, wy, posts);
      if (fx >= dx0 && fx < dx0 + 16) {
        const dc = doorway(b, fx, fy, dx0, wx, wy, c);
        if (dc) c = dc;
      }
      // The corners of the building turn away from the light.
      if (fx === 0) c = shade(c, 1.08);
      else if (fx === b.w * TS - 1) c = shade(c, 0.72);
      d[(ly + py) * W + lx + px] = c;
    }
  }
}

// ---------------------------------------------------------------------------
// Inside faces and wall tops (seen when the roof fades)

const CAP = {
  timber: lut(['#2a1a14', '#3d281d', '#523627', '#694633']),
  stone: lut(['#22202a', '#302e3a', '#403e4c', '#52505f']),
  log: lut(['#24150e', '#36211a', '#4a2e20', '#5e3d2a']),
};

function interiorFace(material, ix, iy, wx, wy) {
  // iy: 0..11 below the cap.
  if (material === 'stone') {
    const course = Math.floor(iy / 6);
    const off = course % 2 ? 6 : 0;
    const ex = (wx + off) % 12;
    let t = 0.46 + (ih(Math.floor((wx + off) / 12), course, wy >> 4) - 0.5) * 0.2;
    if (iy % 6 === 5 || ex === 11) return pick(STONE, 0.14);
    if (iy % 6 === 0) t += 0.14;
    return pick(STONE, t - (iy > 9 ? 0.1 : 0));
  }
  if (material === 'log') {
    const ry = iy % 6;
    return pick(LOGS, LOG_PROFILE[ry] - 0.04 + (ih(wx >> 3, Math.floor(iy / 6) + (wy >> 4), 17) - 0.5) * 0.1);
  }
  // Plaster above a wooden wainscot.
  if (iy >= 6) {
    if (iy === 6) return pick(WOOD, 0.62);
    if (iy === 11) return pick(WOOD, 0.22);
    const panel = (wx % 8) === 0;
    return pick(WOOD, (panel ? 0.3 : 0.47) + (ih(wx, wy, 18) - 0.5) * 0.05);
  }
  return pick(PLASTER, 0.6 - (5 - iy) * 0.02 + (ih(wx >> 1, wy >> 1, 19) - 0.5) * 0.04);
}

// A building's wall tile that is not facade: either an inside face (floor to the
// south) or a wall top.
export function paintBuildingWallTile(out, lx, ly, map, b, tx, ty) {
  const W = out.w;
  const d = out.data;
  const mat = b.material === 'stone' || b.material === 'log' ? b.material : 'timber';
  const capL = CAP[mat];
  const south = map.tileAt(tx, ty + 1);
  const faceBelow = south !== T.WALL;
  const wallN = map.tileAt(tx, ty - 1) === T.WALL;
  const wallW = map.tileAt(tx - 1, ty) === T.WALL;
  const wallE = map.tileAt(tx + 1, ty) === T.WALL;
  for (let py = 0; py < TS; py++) {
    const wy = ty * TS + py;
    for (let px = 0; px < TS; px++) {
      const wx = tx * TS + px;
      let c;
      if (faceBelow && py >= 4) c = interiorFace(mat, px, py - 4, wx, wy);
      else {
        let t = 0.55 + (ih(wx >> 1, wy >> 1, 21) - 0.5) * 0.12;
        if (!wallN && py === 0) t += 0.3;
        if (!wallW && px === 0) t += 0.2;
        if (!wallE && px === TS - 1) t -= 0.3;
        if (faceBelow && py === 3) t += 0.35; // the lit top edge of the inside wall
        c = pick(capL, t);
      }
      d[(ly + py) * W + lx + px] = c;
    }
  }
}

// ---------------------------------------------------------------------------
// Roofs

function shingle(style, rx, ry, rowH, wx, b) {
  // rx: x inside the roof, ry: y measured down the slope from the ridge (px).
  const row = Math.floor(ry / rowH);
  const yr = ry - row * rowH;
  const sw = style === 'slate' ? 6 : 8;
  const off = row % 2 ? sw >> 1 : 0;
  const col = Math.floor((rx + off) / sw);
  const xr = (rx + off) % sw;
  let t = 0.5 + (ih(col, row, b.x * 7 + b.y) - 0.5) * 0.18;
  if (yr === 0) t -= 0.28; // shadow of the row above
  else if (yr === rowH - 1) t += 0.16; // the rounded lower lip catches light
  if (xr === 0) t -= 0.14;
  else if (xr === 1) t += 0.05;
  if (style === 'red' && xr > sw / 2 - 1 && xr < sw / 2 + 1 && yr > 0) t += 0.05; // clay tiles are curved
  return t;
}

function thatch(rx, ry, wx) {
  const strand = ih(rx, Math.floor(ry / 3), 31);
  let t = 0.5 + (strand - 0.5) * 0.35 + Math.sin((rx + Math.floor(ry / 5) * 3) * 0.9) * 0.05;
  if (ry % 7 === 0) t -= 0.18;
  return t;
}

// Returns a PixelBuf the size of roofGeometry(b), transparent where there is no roof.
export function paintRoofBuf(b) {
  const g = roofGeometry(b);
  const buf = new PixelBuf(g.w, g.h);
  const style = ROOF_STYLES[b.roof?.style] ? b.roof.style : 'red';
  const L = ROOF_STYLES[style];
  const top = g.roofTop - g.y;
  const ridge = g.ridgeY - g.y;
  const eave = g.eaveY - g.y;
  const isThatch = style === 'thatch';
  const shadowC = rgb('#140e18', 255);
  for (let y = top; y < eave + 4; y++) {
    for (let x = 0; x < g.w; x++) {
      const wx = g.x + x;
      if (y >= eave) {
        // Soft shadow the eave casts onto the facade.
        if (x >= 4 && x < g.w - 4) buf.data[y * g.w + x] = (shadowC & 0x00ffffff) | ((y === eave ? 150 : y === eave + 1 ? 100 : y === eave + 2 ? 60 : 30) << 24);
        continue;
      }
      // Thatch has a rounded, overhanging silhouette.
      if (isThatch) {
        const edge = Math.min(x, g.w - 1 - x);
        if (y - top < 4 - edge && edge < 4) continue;
        if (eave - y < 3 - edge && edge < 3) continue;
      }
      let t;
      if (y < ridge - 1) {
        // Back slope: foreshortened, facing the sky.
        const ry = ridge - 1 - y;
        t = isThatch ? thatch(x, ry * 2, wx) + 0.16 : shingle(style, x, ry * 2, 4, wx, b) * 0.6 + 0.4;
        t += 0.06 - ry * 0.004;
      } else if (y <= ridge + 1) {
        // Ridge cap.
        t = y === ridge - 1 ? 0.86 : y === ridge ? 0.66 : 0.32;
        if (isThatch && (x % 10 === 0 || x % 10 === 1)) t -= 0.22; // bound bundles
      } else {
        const ry = y - ridge - 2;
        t = isThatch ? thatch(x, ry, wx) : shingle(style, x, ry, 4, wx, b);
        t -= ry * 0.006; // the slope darkens a touch toward the eave
      }
      // Moss patches on old roofs.
      let c = pick(L, t + (bayer(wx, y) - 0.5) * 0.04);
      if (style === 'moss' && ih(x >> 2, y >> 2, b.x + 41) > 0.72) c = mixc(c, rgb('#5f7f3a'), 0.4);
      // Barge boards at the gable ends, eave trim at the bottom.
      if (!isThatch) {
        if (x < 2 || x >= g.w - 2) c = pick(WOOD, x === 0 ? 0.55 : x === g.w - 1 ? 0.15 : 0.32);
        if (y >= eave - 2) c = pick(WOOD, y === eave - 2 ? 0.6 : 0.25);
      } else {
        if (eave - y <= 2) c = pick(L, eave - y === 2 ? 0.55 : 0.28);
        if (x <= 1 || x >= g.w - 2) c = shade(c, x <= 1 ? 1.05 : 0.7);
      }
      buf.data[y * g.w + x] = c;
    }
  }
  // Outline the silhouette so roofs read against grass and each other.
  for (let x = 0; x < g.w; x++) {
    for (let y = top; y < eave; y++) {
      const i = y * g.w + x;
      if (!(buf.data[i] >>> 24)) continue;
      if (y === top || !(buf.data[i - g.w] >>> 24)) {
        buf.data[i] = shade(buf.data[i], 0.6);
        break;
      }
    }
  }
  for (const c of g.chimneys) paintChimney(buf, c.x - g.x, top, ridge, b);
  if (b.roof?.belfry) paintBelfry(buf, g.w >> 1, top, ridge);
  return buf;
}

function paintChimney(buf, cx, top, ridge, b) {
  const L = b.material === 'stone' ? STONE : STONE_WARM;
  const x0 = cx - 4;
  const y0 = top - 9;
  const y1 = ridge + 6;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x0 + 8; x++) {
      const course = Math.floor((y - y0) / 3);
      const off = course % 2 ? 2 : 0;
      let t = 0.5 + (ih(Math.floor((x + off) / 4), course, cx) - 0.5) * 0.2;
      if ((y - y0) % 3 === 2 || (x + off) % 4 === 3) t = 0.2;
      if (x === x0) t += 0.15;
      if (x === x0 + 7) t -= 0.25;
      if (y > y1 - 2) t -= 0.15;
      buf.set(x, y, pick(L, t));
    }
  }
  // Cap and sooty opening.
  for (let x = x0 - 1; x < x0 + 9; x++) {
    buf.set(x, y0 - 2, pick(STONE, x === x0 - 1 ? 0.6 : 0.5));
    buf.set(x, y0 - 1, pick(STONE, 0.3));
  }
  for (let x = x0 + 1; x < x0 + 7; x++) buf.set(x, y0 - 3, rgb('#17121b'));
  buf.set(x0 - 1, y0 - 3, pick(STONE, 0.4));
  buf.set(x0 + 8, y0 - 3, pick(STONE, 0.25));
  // Contact shadow on the roof to the right.
  for (let y = y0 + 2; y <= y1; y++) buf.set(x0 + 8, y, shade(buf.get(x0 + 8, y), 0.72));
}

function paintBelfry(buf, cx, top, ridge) {
  const W = STONE;
  const x0 = cx - 7;
  const y1 = ridge;
  const y0 = top - 14;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x0 + 14; x++) {
      let t = 0.58 + (ih(x >> 2, (y - y0) >> 2, 51) - 0.5) * 0.12;
      if (x === x0) t += 0.12;
      if (x >= x0 + 12) t -= 0.22;
      const ax = x - cx + 0.5;
      const ay = y - (y0 + 5);
      // Arched opening with the bell inside.
      if (Math.abs(ax) < 3.5 && ay > -2 && ay < 8 && !(ay < 0 && ax * ax + ay * ay * 2 > 12)) {
        t = 0.08;
        if (ay > 1 && ay < 6 && Math.abs(ax) < 2.5 - (ay < 3 ? 1 : 0)) {
          buf.set(x, y, rgb(ax < 0 ? '#ffe27a' : ay > 4 ? '#7d5a1c' : '#c79a35'));
          continue;
        }
      }
      buf.set(x, y, pick(W, t));
    }
  }
  // Pointed blue cap.
  const L = ROOF_STYLES.blue;
  for (let k = 0; k < 13; k++) {
    const y = y0 - 1 - k;
    const half = Math.max(0, 8 - Math.floor(k * 0.65));
    for (let x = cx - half; x <= cx + half - 1; x++) buf.set(x, y, pick(L, x < cx ? 0.62 - k * 0.01 : 0.34));
  }
  buf.set(cx, y0 - 14, rgb('#e4b83d'));
  buf.set(cx, y0 - 15, rgb('#ffe27a'));
}

// The map caches this per building ({ canvas }).
export function paintRoof(b) {
  return { canvas: paintRoofBuf(b).toCanvas() };
}
