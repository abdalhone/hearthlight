import { rampOf } from './pixel_fx_catalog.js';
import { bodySize } from './pixel_fx_bodies.js';

// Where the game plays its pixelfx effects (DESIGN §30): one small function per moment, so
// call sites stay one line and fall back to their old look when nothing was played (no
// host, over the cap, or skipped under reduced motion). Each returns the handle or null.

const px = (game) => game?.pixelFx || null;

// A blow lands (a blade, a fist, a weave): the hit spark at the target's chest, thrown along
// the blow; a critical hit gets the starburst. pal: a Weave palette to recolor it.
export function playHit(game, target, { dx = 0, dy = 0, crit = false, pal = null, heavy = false } = {}) {
  const P = px(game);
  if (!P || !target) return null;
  const { h } = bodySize(game, target);
  const height = Math.max(6, Math.round(h * 0.5)) + Math.round(target.z || 0);
  const big = Math.min(1.6, Math.max(1, h / 22));
  const angle = dx || dy ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
  const o = { x: target.x, y: target.y, angle, height, seed: (Math.random() * 1e6) | 0 };
  if (pal) o.palette = rampOf(pal);
  if (crit) return P.play('crit', { ...o, size: 0.5 * big });
  return P.play('hit', { ...o, size: (heavy ? 0.7 : 0.6) * big });
}
