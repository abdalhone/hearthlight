// STUB (owned by the characters agent).
// Contract:
//   registerCharacterArt(atlas, rng)                 -> builds every predefined character/creature
//   ensureCharacter(atlas, key, appearance)          -> builds (once) a humanoid from an appearance object
//   drawCharacter(ctx, atlas, key, anim, dir, time, x, y, opts)
//        anim: idle|walk|attack|cast|hurt|down|work|sit|sleep ; dir: down|up|left|right
//        (x, y) = feet position in screen pixels; opts: { flash, alpha, state }
//   portrait(atlas, key) -> canvas (about 32x32 head-and-shoulders, for the HUD and dialogs)

const COLORS = {
  player: '#41609e',
  lyra: '#6a4196',
  villager: '#7a523a',
};

export function registerCharacterArt(atlas, rng) {}

export function ensureCharacter(atlas, key, appearance) {
  if (appearance?.color) COLORS[key] = appearance.color;
}

export function drawCharacter(ctx, atlas, key, anim, dir, time, x, y, opts = {}) {
  const prev = ctx.globalAlpha;
  if (opts.alpha != null) ctx.globalAlpha = prev * opts.alpha;
  const down = anim === 'down';
  ctx.fillStyle = opts.flash > 0.3 ? '#ffffff' : COLORS[key] || '#888888';
  if (down) ctx.fillRect(x - 7, y - 5, 14, 5);
  else ctx.fillRect(x - 5, y - 18, 10, 18);
  ctx.fillStyle = '#e2ad84';
  if (!down) ctx.fillRect(x - 3, y - 16, 6, 5);
  ctx.globalAlpha = prev;
}

export function portrait(atlas, key) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = COLORS[key] || '#888';
  g.fillRect(4, 14, 24, 18);
  g.fillStyle = '#e2ad84';
  g.fillRect(9, 4, 14, 12);
  return c;
}
