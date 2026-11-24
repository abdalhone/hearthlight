// The people who appear in the story panels and scenes, drawn with the game's own sprites
// and portraits so the Lyra of a cutscene is the Lyra you walk beside. Characters that a
// branch does not have yet (Hobb, Wenna, Hess before the villagers land; Maren and the
// eleven-year-old Lyra, who never walk the map) get a look of their own here, built with
// the same humanoid generator. Nothing runs at import time.

import { ensureCharacter, hasCharacter, portrait as charPortrait } from '../art/characters_art.js';
import { NPC_PROFILES } from '../entities/npc_data.js';
import { hex } from './paint.js';

// Looks for people the story needs when no profile provides them (LORE §6, §7, §8).
export const STORY_LOOKS = {
  maren: {
    skin: 'light', hair: 'grey', hairStyle: 'bun', outfit: 'robe', top: 'slate', bottom: 'slate',
    cloak: 'charcoal', cloakLining: 'slate', accent: 'silver', shoes: 'dark_leather', held: 'book', bookColor: 'charcoal',
    build: 'normal', eyes: '#3a3a44', wrinkles: true,
  },
  lyra_young: {
    skin: 'fair', hair: 'midnight', hairStyle: 'long', outfit: 'dress', top: 'wine', bottom: 'wine', accent: 'cream',
    shoes: 'dark_leather', held: 'none', build: 'child', eyes: '#7a64e0', eyeStyle: 'big', blush: true,
  },
  hobb: {
    skin: 'light', hair: 'white', hairStyle: 'short', accessories: ['glasses'], outfit: 'trousers', top: 'slate',
    bottom: 'charcoal', accent: 'cream', shoes: 'dark_leather', held: 'staff', build: 'slim', eyes: '#5a6a7a', wrinkles: true,
  },
  wenna: {
    skin: 'fair', hair: 'silver', hairStyle: 'bun', accessories: ['hat'], hatColor: 'straw', outfit: 'dress',
    top: 'straw', bottom: 'straw', accent: 'cream', shoes: 'leather', held: 'none', build: 'slim', eyes: '#a8c4d8', wrinkles: true,
  },
  hess: {
    skin: 'brown', hair: 'grey', hairStyle: 'short', outfit: 'tunic', top: 'rust', bottom: 'charcoal', accent: 'moss',
    shoes: 'dark_leather', held: 'bow', quiver: true, build: 'slim', eyes: '#2e2a22', scar: true,
  },
};

let stampAtlas = null;
const seams = new Set();

export function setStampAtlas(atlas) {
  stampAtlas = atlas || null;
}

// Make sure a character key can be drawn; returns the key to draw with.
export function castKey(key, atlas = stampAtlas) {
  if (!atlas || !key) return key;
  if (hasCharacter(atlas, key)) return key;
  const profile = NPC_PROFILES.find((p) => p.id === key);
  if (profile) {
    ensureCharacter(atlas, key, profile.appearance || {});
    return key;
  }
  const look = STORY_LOOKS[key];
  if (look) {
    if (key !== 'maren' && key !== 'lyra_young' && !seams.has(key)) {
      seams.add(key);
      console.info(`[story] seam: no '${key}' profile in this build yet; the story draws its own look`);
    }
    ensureCharacter(atlas, key, look);
    return key;
  }
  return 'villager';
}

export function castPortrait(key, expression = 'neutral', atlas = stampAtlas) {
  if (!key || key === 'narrator') return null;
  try {
    castKey(key, atlas);
    return charPortrait(atlas, key, expression);
  } catch {
    return null;
  }
}

const frameCache = new Map();

function framePixels(atlas, key, anim, dir, frame) {
  const meta = atlas?.getMeta?.(`char:${key}`);
  if (!meta) return null;
  const spec = meta.anims[anim] || meta.anims.idle;
  const name = spec.names[dir] || spec.names.down;
  const i = Math.max(0, Math.min(spec.frames - 1, frame | 0));
  const ck = `${name}#${i}`;
  if (frameCache.has(ck)) return frameCache.get(ck);
  const entry = atlas.get(name);
  const canvas = entry?.frames?.[i];
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = { w: canvas.width, h: canvas.height, data: img.data, ox: entry.ox ?? 16, oy: entry.oy ?? 28 };
  frameCache.set(ck, out);
  return out;
}

// The stranger as they were found: the blue of the game's tunic becomes the fine grey weave
// nobody in the valley could name (LORE §8).
export function greyWeave(r, g, b) {
  if (b > r + 18 && b > g + 6) {
    const l = (r * 0.3 + g * 0.5 + b * 0.2) * 1.25;
    return [l * 0.95, l * 0.98, l * 1.06];
  }
  return [r, g, b];
}

// Paint a character's sprite into a panel buffer with its feet at (x, y).
// opts: { frame, mul: [r,g,b] multiplier (night), rim: {color, side: 1|-1, k}, flip, alpha, rot90 }
export function stamp(b, key, anim, dir, x, y, opts = {}) {
  const atlas = stampAtlas;
  if (!atlas) return false;
  const k = castKey(key, atlas);
  const f = framePixels(atlas, k, anim, dir, opts.frame || 0);
  if (!f) return false;
  const mul = opts.mul || [1, 1, 1];
  const rim = opts.rim ? { c: hex(opts.rim.color || '#ffb047'), side: opts.rim.side || 1, k: opts.rim.k ?? 0.5 } : null;
  const a = opts.alpha ?? 1;
  for (let yy = 0; yy < f.h; yy++) {
    for (let xx = 0; xx < f.w; xx++) {
      const sx = opts.flip ? f.w - 1 - xx : xx;
      const i = (yy * f.w + sx) * 4;
      const al = f.data[i + 3];
      if (!al) continue;
      let r = f.data[i];
      let g = f.data[i + 1];
      let bl = f.data[i + 2];
      if (opts.recolor) [r, g, bl] = opts.recolor(r, g, bl);
      r *= mul[0];
      g *= mul[1];
      bl *= mul[2];
      if (rim) {
        // Light the edge that faces the light source.
        const nx = sx + rim.side;
        const edge = nx < 0 || nx >= f.w || f.data[(yy * f.w + nx) * 4 + 3] === 0;
        if (edge) {
          r += rim.c[0] * rim.k;
          g += rim.c[1] * rim.k;
          bl += rim.c[2] * rim.k;
        }
      }
      let px = x - f.ox + xx;
      let py = y - f.oy + yy;
      if (opts.rot90) {
        // Lying down: rotate the sprite a quarter turn around the feet point.
        const dx = xx - f.ox;
        const dy = yy - f.oy;
        px = x - dy * opts.rot90;
        py = y + dx * opts.rot90;
      }
      b.px(px, py, [r, g, bl], (al / 255) * a);
    }
  }
  return true;
}
