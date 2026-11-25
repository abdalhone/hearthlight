// Character and creature art: generated at boot into the atlas, drawn only
// through drawCharacter(). Sprite names are `char:<key>:<anim>:<dir>`; the
// per-key anim table lives in atlas meta `char:<key>`.
//
//   registerCharacterArt(atlas, rng)             build player, Lyra, villagers, foes, creatures
//   ensureCharacter(atlas, key, appearance)      build one humanoid once (idempotent)
//   drawCharacter(ctx, atlas, key, anim, dir, time, x, y, opts)
//        anim: idle walk attack cast hurt down work sit sleep ; dir: down up left right
//        (x, y) = feet in screen pixels ; opts: { flash, alpha, state, frame, fps }
//   portrait(atlas, key, expression = 'neutral') -> 48x48 canvas (cached)

import { makeCanvas } from './pixel.js';
import { paintHumanoid, HUMANOID_ANIMS, CRAWL_ANIM, DIRECTIONS, ANCHOR_X, ANCHOR_Y, FRAME } from './characters_humanoid.js';
import { paintCreature, CREATURE_ANIMS, CREATURE_SPRITES } from './creatures_art.js';
import { paintPortrait, EXPRESSIONS, PORTRAIT_SIZE } from './characters_portrait.js';
import { normalizeAppearance, PRESET_APPEARANCES } from './characters_appearance.js';
import { NPC_PROFILES } from '../entities/npc_data.js';

export { EXPRESSIONS, PORTRAIT_SIZE };
export const CHARACTER_ANIMS = Object.keys(HUMANOID_ANIMS);
export const CHARACTER_DIRS = DIRECTIONS;

// Anims a creature may not have: what to show instead.
const ANIM_FALLBACK = { cast: 'attack', work: 'idle', sit: 'idle', sleep: 'down', bed: 'sleep', run: 'walk', attack: 'idle', crawl: 'down' };

const appearances = new Map(); // key -> normalized appearance (for portraits)
const portraitCache = new Map();

function toCanvas(rgba, w, h) {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Register every anim/dir of one character from a painter(anim, dir, frame) -> Sprite.
function registerFrames(atlas, key, table, painter, kind) {
  const anims = {};
  for (const [anim, spec] of Object.entries(table)) {
    const names = {};
    for (const dir of DIRECTIONS) {
      const name = `char:${key}:${anim}:${dir}`;
      // Lying poses look the same from every side: share the frames.
      const shareFrom = (anim === 'down' || anim === 'sleep' || anim === 'bed') && kind === 'humanoid' && dir !== 'down' ? `char:${key}:${anim}:down` : null;
      if (shareFrom && atlas.has(shareFrom)) {
        atlas.add(name, atlas.get(shareFrom).frames, { ox: ANCHOR_X, oy: ANCHOR_Y, fps: spec.fps });
      } else {
        const frames = [];
        for (let f = 0; f < spec.frames; f++) {
          const sp = painter(anim, dir, f);
          frames.push(toCanvas(sp.render(), sp.w, sp.h));
        }
        atlas.add(name, frames, { ox: ANCHOR_X, oy: ANCHOR_Y, fps: spec.fps });
      }
      names[dir] = name;
    }
    anims[anim] = { names, frames: spec.frames, fps: spec.fps, loop: spec.loop };
  }
  // Resolve fallbacks once so drawing never builds strings.
  for (const anim of [...CHARACTER_ANIMS, 'run', 'crawl']) {
    if (anims[anim]) continue;
    anims[anim] = anims[ANIM_FALLBACK[anim]] || anims.idle;
  }
  atlas.setMeta(`char:${key}`, { key, kind, anims });
}

export function hasCharacter(atlas, key) {
  return !!atlas?.getMeta?.(`char:${key}`);
}

export function ensureCharacter(atlas, key, appearance = {}) {
  if (!atlas || !key) return false;
  if (hasCharacter(atlas, key)) return true;
  try {
    const a = normalizeAppearance({ ...appearance, key });
    appearances.set(key, a);
    registerFrames(atlas, key, HUMANOID_ANIMS, (anim, dir, f) => paintHumanoid(a, anim, dir, f), 'humanoid');
    return true;
  } catch (err) {
    console.error('[characters] could not build', key, err);
    return false;
  }
}

// The crawl (DESIGN §27) is painted only for someone who has fallen: 16 frames per
// character would cost every boot a few hundred milliseconds on a phone for a pose most
// villagers never need. Until then 'crawl' falls back to the lying frame. Idempotent.
export function ensureCrawl(atlas, key) {
  const meta = atlas?.getMeta?.(`char:${key}`);
  if (!meta) return false;
  if (meta.crawlBuilt) return true;
  if (meta.kind !== 'humanoid') return false;
  let a = appearances.get(key);
  if (!a) {
    const preset = PRESET_APPEARANCES[key] || NPC_PROFILES.find((p) => p.id === key)?.appearance;
    if (!preset) return false;
    a = normalizeAppearance({ ...preset, key });
  }
  try {
    const names = {};
    for (const dir of DIRECTIONS) {
      const name = `char:${key}:crawl:${dir}`;
      const frames = [];
      for (let f = 0; f < CRAWL_ANIM.frames; f++) {
        const sp = paintHumanoid(a, 'crawl', dir, f);
        frames.push(toCanvas(sp.render(), sp.w, sp.h));
      }
      atlas.add(name, frames, { ox: ANCHOR_X, oy: ANCHOR_Y, fps: CRAWL_ANIM.fps });
      names[dir] = name;
    }
    meta.anims.crawl = { names, frames: CRAWL_ANIM.frames, fps: CRAWL_ANIM.fps, loop: true };
    meta.crawlBuilt = true;
    return true;
  } catch (err) {
    console.error('[characters] could not build the crawl', key, err);
    return false;
  }
}

export function ensureCreature(atlas, key) {
  if (!atlas || !key) return false;
  if (hasCharacter(atlas, key)) return true;
  const base = CREATURE_SPRITES[key];
  if (!base) return false;
  try {
    registerFrames(atlas, key, CREATURE_ANIMS[base], (anim, dir, f) => paintCreature(key, anim, dir, f), 'creature');
    return true;
  } catch (err) {
    console.error('[characters] could not build creature', key, err);
    return false;
  }
}

export function registerCharacterArt(atlas, rng) {
  void rng; // every look is authored; nothing here is random
  buildFallback(atlas);
  for (const [key, app] of Object.entries(PRESET_APPEARANCES)) ensureCharacter(atlas, key, app);
  for (const p of NPC_PROFILES) ensureCharacter(atlas, p.id, p.appearance || {});
  for (const key of Object.keys(CREATURE_SPRITES)) ensureCreature(atlas, key);
}

// ---------------------------------------------------------------------------
// Drawing

function buildFallback(atlas) {
  if (!atlas || atlas.has('char:__missing')) return;
  // A translucent violet "?" ghost: obviously a placeholder, never invisible.
  const { canvas, ctx } = makeCanvas(FRAME, FRAME);
  ctx.fillStyle = '#1a1423';
  ctx.fillRect(10, 7, 12, 22);
  ctx.fillStyle = '#a995ff';
  ctx.fillRect(11, 8, 10, 20);
  ctx.fillStyle = '#1a1423';
  ctx.fillRect(14, 11, 4, 1);
  ctx.fillRect(17, 12, 1, 3);
  ctx.fillRect(15, 15, 2, 1);
  ctx.fillRect(15, 16, 1, 2);
  ctx.fillRect(15, 20, 1, 2);
  atlas.add('char:__missing', [canvas], { ox: ANCHOR_X, oy: ANCHOR_Y, fps: 1 });
}

function drawMissing(ctx, atlas, x, y, opts) {
  try {
    if (atlas?.has?.('char:__missing')) {
      atlas.draw(ctx, 'char:__missing', 0, x, y, opts);
      return;
    }
    ctx.fillStyle = '#a995ff';
    ctx.fillRect(Math.round(x) - 5, Math.round(y) - 20, 10, 20);
  } catch {
    /* drawing a placeholder must never throw */
  }
}

// opts.frame forces a frame index (creature telegraphs hold a wind-up pose).
export function drawCharacter(ctx, atlas, key, anim, dir, time, x, y, opts = {}) {
  try {
    const meta = atlas?.getMeta?.(`char:${key}`);
    if (!meta) {
      drawMissing(ctx, atlas, x, y, opts);
      return false;
    }
    const spec = meta.anims[anim] || meta.anims.idle;
    const name = spec.names[dir] || spec.names.down;
    let i = opts.frame != null ? opts.frame : Math.floor((time || 0) * (opts.fps || spec.fps));
    if (!(i >= 0)) i = 0;
    i = spec.loop ? i % spec.frames : Math.min(i, spec.frames - 1);
    return atlas.draw(ctx, name, i, x, y, opts);
  } catch {
    drawMissing(ctx, atlas, x, y, opts);
    return false;
  }
}

// Frame count and speed of an anim (for code that times actions to the art).
export function animInfo(atlas, key, anim) {
  const spec = atlas?.getMeta?.(`char:${key}`)?.anims?.[anim];
  return spec ? { frames: spec.frames, fps: spec.fps, loop: spec.loop, duration: spec.frames / spec.fps } : null;
}

// ---------------------------------------------------------------------------
// Portraits

export function portrait(atlas, key, expression = 'neutral') {
  const expr = EXPRESSIONS.includes(expression) ? expression : 'neutral';
  const ck = `${key}|${expr}`;
  const cached = portraitCache.get(ck);
  if (cached) return cached;
  let canvas = null;
  try {
    let a = appearances.get(key);
    if (!a) {
      const preset = PRESET_APPEARANCES[key] || NPC_PROFILES.find((p) => p.id === key)?.appearance;
      if (preset) a = normalizeAppearance({ ...preset, key });
    }
    if (a) {
      const sp = paintPortrait(a, expr);
      canvas = toCanvas(sp.render(), sp.w, sp.h);
    } else {
      canvas = creaturePortrait(atlas, key);
    }
  } catch (err) {
    console.error('[characters] portrait failed', key, err);
  }
  if (!canvas) canvas = blankPortrait();
  portraitCache.set(ck, canvas);
  return canvas;
}

// Creatures (a named cat, a wolf she hates) get their idle frame enlarged.
function creaturePortrait(atlas, key) {
  if (!hasCharacter(atlas, key)) ensureCreature(atlas, key);
  const meta = atlas?.getMeta?.(`char:${key}`);
  const frame = meta ? atlas.frame(meta.anims.idle.names.down, 0) : null;
  if (!frame) return null;
  const { canvas, ctx } = makeCanvas(PORTRAIT_SIZE, PORTRAIT_SIZE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 4, 6, 24, 24, 0, 0, 48, 48);
  return canvas;
}

function blankPortrait() {
  const { canvas, ctx } = makeCanvas(PORTRAIT_SIZE, PORTRAIT_SIZE);
  ctx.fillStyle = '#2c3065';
  ctx.fillRect(8, 30, 32, 18);
  ctx.fillStyle = '#a995ff';
  ctx.fillRect(14, 8, 20, 22);
  return canvas;
}

// Keys that have been built (debugging and browser tests).
export function characterKeys(atlas) {
  const out = [];
  for (const k of atlas?.meta?.keys?.() || []) if (String(k).startsWith('char:')) out.push(String(k).slice(5));
  return out;
}
