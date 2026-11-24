import { drawCharacter } from '../art/characters_art.js';

// Carrying someone (DESIGN §27): any carrier and any carried pair. The carried actor goes
// limp over the carrier's shoulders: it stops being solid, follows the carrier every step,
// and is drawn lying across their shoulders (the renderer skips the actor itself and draws
// this pair instead). The carrier walks slowly and cannot fight.

const SHOULDER_LIFT = 12; // px above the carrier's feet that the body lies across
const ARM = '#2a2233';

export class CarryDrawable {
  constructor(carry, game) {
    this.carry = carry;
    this.game = game;
    this.type = 'fx';
  }

  get sortY() {
    return this.carry.carrier.y + 0.3;
  }

  // The body over the shoulders: the lying frame (head to the left) lifted to shoulder
  // height, turned so the head hangs behind the carrier, rocking with their stride.
  draw(ctx, ox, oy, time) {
    const { carrier, carried } = this.carry;
    if (!carrier || !carried) return;
    const atlas = this.game.atlas;
    const walking = carrier.state === 'walk' || (carrier.moved ?? 0) > 0.05;
    const bob = walking ? Math.round(Math.sin((carrier.animTime || time) * 9) * 0.8) : 0;
    const dir = carrier.dir || 'down';
    let dx = 0;
    let flip = false;
    if (dir === 'left') {
      dx = 3;
      flip = true;
    } else if (dir === 'right') {
      dx = -3;
    } else if (dir === 'up') {
      flip = true;
    }
    const sx = Math.round(carrier.x - ox) + dx;
    const sy = Math.round(carrier.y - oy - (carrier.z || 0)) - SHOULDER_LIFT + bob;
    drawCharacter(ctx, atlas, carried.spriteKey, 'down', 'down', 0, sx, sy, { flip });
    // The carrier's arm across the back of the knees: a short dark band holding them on.
    if (dir !== 'up') {
      const ax = Math.round(carrier.x - ox) + (flip ? -4 : 2);
      const ay = sy - 6;
      ctx.fillStyle = ARM;
      ctx.fillRect(ax, ay, 3, 2);
    }
  }
}

export function startCarry(sv, carrier, carried, job = null) {
  if (!carrier || !carried || carrier === carried) return null;
  if (carrier.carrying || carried.carriedBy || sv.carries.has(carrier)) return null;
  const c = { carrier, carried, job, t: 0, wasSolid: carried.solid !== false, drawable: null };
  c.drawable = new CarryDrawable(c, sv.game);
  sv.carries.set(carrier, c);
  carrier.carrying = carried;
  carried.carriedBy = carrier;
  carried.solid = false;
  if (carried.knock) {
    carried.knock.x = 0;
    carried.knock.y = 0;
  }
  const rec = sv.falls.get(carried);
  if (rec) {
    rec.carrier = carrier;
    rec.carrierName = carrier.name || null;
    rec.stanchers.clear();
  }
  syncCarry(c);
  try {
    sv.game.audio?.play?.('dodge', { x: carrier.x, y: carrier.y, volume: 0.5, pitch: 0.7 });
  } catch {
    /* cosmetic */
  }
  sv.game.bus?.emit?.('carried', { carrier, entity: carried });
  return c;
}

// Put them down: on a cot (`at` given) or on the ground in front of the carrier.
export function endCarry(sv, carrier, { at = null } = {}) {
  const c = sv.carries.get(carrier);
  if (!c) return null;
  sv.carries.delete(carrier);
  const carried = c.carried;
  if (carrier.carrying === carried) carrier.carrying = null;
  if (carried.carriedBy === carrier) carried.carriedBy = null;
  carried.solid = c.wasSolid;
  carried.z = 0;
  if (at) {
    carried.x = at.x;
    carried.y = at.y;
  } else {
    const fx = carrier.facing?.x ?? 0;
    const fy = carrier.facing?.y ?? 1;
    const spot = sv.freeSpotNear(carrier.x + fx * 10, carrier.y + fy * 8, carried) || { x: carrier.x, y: carrier.y + 4 };
    carried.x = spot.x;
    carried.y = spot.y;
  }
  if (!isPlayerCarrier(sv, carrier)) carrier.speedMul = 1;
  const rec = sv.falls.get(carried);
  if (rec) rec.carrier = null;
  sv.game.bus?.emit?.('set_down', { carrier, entity: carried, onCot: !!at });
  return c;
}

function isPlayerCarrier(sv, a) {
  return a === sv.game.player;
}

export function syncCarry(c) {
  const { carrier, carried } = c;
  carried.x = carrier.x;
  carried.y = carrier.y;
  carried.dir = carrier.dir;
  if (carried.knock) {
    carried.knock.x = 0;
    carried.knock.y = 0;
  }
  if (carried.vel) {
    carried.vel.x = 0;
    carried.vel.y = 0;
  }
  if (carried.moveIntent) {
    carried.moveIntent.x = 0;
    carried.moveIntent.y = 0;
  }
}

export function syncCarries(sv, dt) {
  for (const [carrier, c] of sv.carries) {
    c.t += dt;
    const gone = carrier.removed || carrier.dead || carrier.downed || c.carried.removed;
    if (gone) {
      endCarry(sv, carrier);
      continue;
    }
    syncCarry(c);
  }
}
