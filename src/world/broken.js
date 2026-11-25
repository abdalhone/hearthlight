// How a struck or broken prop looks and comes back (DESIGN §31.3). Pure helpers the world
// objects call from their own draw and update (objects.js), so the objects module needs no
// combat, pickups or effects; the blows themselves are breakables.js.

const TAU = Math.PI * 2;

// What a prop is made of: the debris it leaves and the chips it sheds when struck.
export const MATERIAL = {
  tree: 'wood',
  fence: 'wood',
  barrel: 'wood',
  crate: 'wood',
  cart: 'wood',
  sign: 'wood',
  woodpile: 'wood',
  rock: 'stone',
  pot: 'clay',
  sack: 'cloth',
  hay: 'straw',
  bush: 'leaf',
  berry_bush: 'leaf',
  dummy: 'straw',
};

export function materialOf(o) {
  return MATERIAL[o?.objType] || 'wood';
}

// Struck a moment ago: the prop jolts a pixel side to side for a quarter of a second.
export const SHAKE_SECONDS = 0.25;
export function shakeX(o, time) {
  const t0 = o?._hitAt;
  if (t0 == null) return 0;
  const k = time - t0;
  if (k < 0 || k > SHAKE_SECONDS) return 0;
  return (Math.floor(k * 40) & 1 ? 1 : -1) * (o._hitDir || 1);
}

// The dummy rocks on its post when struck, away from the blow.
export function swayOf(o, time) {
  const t0 = o?._hitAt;
  if (t0 == null) return 0;
  const k = time - t0;
  if (k < 0 || k > 0.7) return 0;
  return Math.round(Math.sin(k * 18) * Math.exp(-k * 5) * 2.5) * (o._hitDir || 1);
}

// A tree falling (Tree.fell): seconds from the blow to the crash.
export const FALL_SECONDS = 0.75;

// Broken props come back in time (someone sweeps up and mends it; the bush grows back).
// Call every step from the object's update. Returns true the moment it is whole again.
export function mendTick(o) {
  const s = o.state;
  if (!s?.broken || !(s.mendAt > 0)) return false;
  const g = o.game;
  const now = g?.clock?.t ?? 0;
  if (now < s.mendAt) return false;
  // Never mend on top of someone standing in the rubble.
  if (o.solid) {
    const cx = o.x;
    const cy = o.y - 8;
    const near = g?.entities?.nearest?.(cx, cy, 12, (e) => e.type === 'actor' && !e.dead);
    if (near) {
      s.mendAt = now + 10;
      return false;
    }
  }
  s.broken = false;
  s.mendAt = 0;
  o._dmg = 0;
  o.markDirty?.();
  o._changed?.(true);
  if (o.objType === 'fence') refreshFences(g?.objects, o);
  try {
    g?.bus?.emit?.('object_mended', { object: o });
  } catch {
    /* listeners are optional */
  }
  return true;
}

// Small deterministic noise per object, so its debris always lies the same way.
function rnd(o, i) {
  let h = Math.imul(((o.tx | 0) * 73856093) ^ ((o.ty | 0) * 19349663) ^ (i * 83492791), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
}

const DEBRIS = {
  wood: { dark: '#3b2414', mid: '#7a4e2c', light: '#b47c4a' },
  stone: { dark: '#2f2d3a', mid: '#6d6a7c', light: '#a7a4b4' },
  clay: { dark: '#4a2616', mid: '#a0542e', light: '#d48a5a' },
  cloth: { dark: '#4a3b28', mid: '#a68c60', light: '#d8c494' },
  straw: { dark: '#6a5220', mid: '#c8a24a', light: '#ecd48a' },
  leaf: { dark: '#1f3a1e', mid: '#3f7a35', light: '#7cb860' },
};

// What a broken prop leaves on the ground: splintered planks and staves, shards, stones,
// a slump of cloth, a scatter of straw or torn leaves and twigs, in the prop's own colors.
export function drawDebris(ctx, o, ox, oy) {
  const mat = materialOf(o);
  const C = DEBRIS[mat] || DEBRIS.wood;
  const f = o.footprint;
  const w = f ? f.w * 16 : 16;
  const cx = Math.round(o.x - ox);
  const by = Math.round(o.y - oy);
  const n = Math.max(4, Math.round(w / 3));
  // A soft dark patch first, so the debris reads as lying on the ground.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - Math.round(w * 0.42), by - 5, Math.round(w * 0.84), 4);
  ctx.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const x = cx + Math.round((rnd(o, i) - 0.5) * (w - 4));
    const y = by - 2 - Math.round(rnd(o, i + 17) * 6);
    const r = rnd(o, i + 31);
    if (mat === 'wood') {
      // A plank or stave lying at an angle: a 4-6 px bar, outlined.
      const len = 3 + Math.round(r * 4);
      const vert = rnd(o, i + 43) < 0.35;
      ctx.fillStyle = C.dark;
      if (vert) ctx.fillRect(x - 1, y - len, 3, len + 1);
      else ctx.fillRect(x - 1, y - 1, len + 2, 3);
      ctx.fillStyle = r < 0.5 ? C.mid : C.light;
      if (vert) ctx.fillRect(x, y - len + 1, 1, len - 1);
      else ctx.fillRect(x, y, len, 1);
    } else if (mat === 'stone' || mat === 'clay') {
      const s = 1 + Math.round(r * 2);
      ctx.fillStyle = C.dark;
      ctx.fillRect(x - 1, y - s, s + 2, s + 1);
      ctx.fillStyle = r < 0.5 ? C.mid : C.light;
      ctx.fillRect(x, y - s + 1, s, s - 1 || 1);
    } else if (mat === 'cloth') {
      ctx.fillStyle = C.dark;
      ctx.fillRect(x - 2, y - 2, 5, 3);
      ctx.fillStyle = C.mid;
      ctx.fillRect(x - 1, y - 2, 3, 2);
    } else {
      // straw and leaves: short strokes and bits
      ctx.fillStyle = r < 0.3 ? C.dark : r < 0.7 ? C.mid : C.light;
      ctx.fillRect(x, y, 2, 1);
      if (r > 0.5) ctx.fillRect(x + 1, y - 1, 1, 1);
      if (mat === 'leaf' && r < 0.25) {
        ctx.fillStyle = '#4a3020';
        ctx.fillRect(x - 2, y + 1, 3, 1); // a twig
      }
    }
  }
}

// A tree going over: the whole tree (trunk and canopy) turns about its foot toward `dir`
// (-1 left, 1 right), quickening as it goes, and is gone in a dust cloud when it lands.
export function drawFallingTree(ctx, atlas, tree, sx, sy, k) {
  if (!atlas || k >= 1) return;
  const ease = k * k * (3 - 2 * k) * (0.6 + 0.4 * k);
  const ang = (tree._fall?.dir || 1) * ease * (TAU / 4) * 0.98;
  const base = `prop:tree_${tree.kind}`;
  ctx.save();
  ctx.translate(sx, sy - 2);
  ctx.rotate(ang);
  ctx.globalAlpha = k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1;
  if (atlas.get?.(`${base}:trunk`)) {
    atlas.draw(ctx, `${base}:trunk`, tree.v, 0, 2);
    atlas.draw(ctx, `${base}:canopy`, tree.v, 0, 2);
  } else atlas.draw(ctx, base, tree.v, 0, 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- fences

// A fence post joins its neighbours (worldgen's finishFences mask): recompute the posts round
// a broken or mended one so no rail points at a gap.
export function refreshFences(objs, o) {
  if (!objs?.objectsAt) return;
  const fenceAt = (tx, ty) => {
    const l = objs.objectsAt(tx, ty);
    if (!l) return null;
    for (let i = 0; i < l.length; i++) if (l[i].objType === 'fence') return l[i];
    return null;
  };
  const whole = (tx, ty) => {
    const f = fenceAt(tx, ty);
    return !!f && !f.state?.broken && !f.removed;
  };
  for (const [dx, dy] of [
    [0, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    const f = fenceAt(o.tx + dx, o.ty + dy);
    if (!f) continue;
    const m = (whole(f.tx, f.ty - 1) ? 1 : 0) | (whole(f.tx + 1, f.ty) ? 2 : 0) | (whole(f.tx, f.ty + 1) ? 4 : 0) | (whole(f.tx - 1, f.ty) ? 8 : 0);
    f.variant = String(m);
    f.sprite = `prop:fence:${m}`;
  }
}

// After a load (or a mend), every fence next to a broken one gets the right rails.
export function refreshAllFences(objs) {
  const list = objs?.all?.() || [];
  for (const o of list) if (o.objType === 'fence' && o.state?.broken) refreshFences(objs, o);
}
