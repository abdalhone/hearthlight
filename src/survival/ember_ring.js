import { Entity } from '../entities/entity.js';

// The ember-ring (DESIGN §27, round 14: "if I die, I only lose one coin? It should be
// heavier… I lose all my coins, and the place I died in would have this Elden Ring thing…
// I should go there and click E to regain my coins… and if I die before going there, I
// lose it."). When the stranger dies and comes back (the kept flame, or waking at home),
// everything they carried in coin stays where they fell: a ring of embers on the ground,
// glowing at night, with the coins in its heart. Walk back and take it (E, or the hand
// button on a phone). Die again before you reach it and it goes out, coins and all.
//
// One at a time. The state lives in game.survival (saved with it); this is the thing in
// the world: drawn on the ground, lit at night, and offered by the interact prompt.

export const RING_ID = 'ember_ring';

const EMBER = ['#5a1a0c', '#a3341a', '#ee7f2d', '#ffb047', '#ffe08a'];
const COIN = ['#7a5410', '#d9a21e', '#ffd75e', '#fff3b0'];
const SPARKS = 7;

// Points on the ring's ellipse (perspective: twice as wide as tall), once.
const RX = 10;
const RY = 5;
const DOTS = (() => {
  const out = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.round(Math.cos(a) * RX), Math.round(Math.sin(a) * RY), i]);
  }
  return out;
})();

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class EmberRing extends Entity {
  constructor(game, { x, y, coins = 0, day = 1, where = '', place = '' } = {}) {
    super(game, { id: RING_ID, x, y, solid: false, radius: 6 });
    this.type = 'ember_ring';
    this.coins = Math.max(0, Math.floor(coins));
    this.day = day;
    this.where = where;
    this.place = place;
    this.taken = false;
    this.flare = 1.2; // seconds of a brighter flare when it is first laid down
    this._light = { x, y, r: 52, color: '#ff8a3a', intensity: 0.7, flicker: 0.18 };
  }

  get sortY() {
    return this.y - 2;
  }

  update(dt) {
    super.update(dt);
    if (this.flare > 0) this.flare = Math.max(0, this.flare - dt);
  }

  // Not a creature: scans for people and targets pass over it.
  isAlive() {
    return false;
  }

  canInteract(actor) {
    return !this.taken && !!actor && actor === this.game.player && !actor.downed;
  }

  interactLabel() {
    return `Take back your ${this.coins} ${this.coins === 1 ? 'coin' : 'coins'}`;
  }

  interact(actor) {
    return this.game.survival?.takeRing?.(actor) ?? false;
  }

  getLight(time = 0) {
    if (this.taken) return null;
    const L = this._light;
    L.x = this.x;
    L.y = this.y - 4;
    L.intensity = 0.6 + 0.12 * Math.sin(time * 2.1) + 0.5 * this.flare;
    L.r = 48 + 6 * Math.sin(time * 1.3) + 30 * this.flare;
    return L;
  }

  // The ground: a scorched ellipse and the ring of embers breathing round it.
  drawShadow(ctx, ox, oy, time = 0) {
    if (this.taken) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * 0.55;
    ctx.fillStyle = '#1a0c08';
    ctx.beginPath();
    ctx.ellipse(sx, sy, RX + 2, RY + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = prev;
    const breath = 0.5 + 0.5 * Math.sin(time * 2.4);
    for (const [dx, dy, i] of DOTS) {
      const f = hash(i + Math.floor(time * 6 + i * 0.37) * 0.013);
      const k = Math.min(EMBER.length - 1, Math.floor(1 + f * 3 + breath * 1.2 + this.flare));
      ctx.fillStyle = EMBER[k];
      ctx.fillRect(sx + dx, sy + dy, 1, 1);
      if (f > 0.72) {
        ctx.fillStyle = EMBER[Math.min(EMBER.length - 1, k + 1)];
        ctx.fillRect(sx + dx + (dx > 0 ? 1 : -1), sy + dy, 1, 1);
      }
    }
  }

  // Above the ground: the coins in its heart glinting, and sparks rising.
  draw(ctx, ox, oy, time = 0) {
    if (this.taken) return;
    const sx = Math.round(this.x - ox);
    const sy = Math.round(this.y - oy);
    // A small heap of coin (more coins, a bigger heap).
    const heap = this.coins >= 60 ? 3 : this.coins >= 20 ? 2 : 1;
    ctx.fillStyle = COIN[0];
    ctx.fillRect(sx - 2 - heap, sy, 5 + heap * 2, 2);
    ctx.fillStyle = COIN[1];
    ctx.fillRect(sx - 1 - heap, sy - 1, 3 + heap * 2, 2);
    if (heap > 1) ctx.fillRect(sx - 1, sy - 2, 3, 1);
    ctx.fillStyle = COIN[2];
    ctx.fillRect(sx - heap, sy - 1, 1, 1);
    ctx.fillRect(sx + heap, sy, 1, 1);
    if (heap > 2) ctx.fillRect(sx, sy - 3, 2, 1);
    // A glint that walks round the heap.
    const g = Math.floor(time * 1.6) % 4;
    if (Math.sin(time * 9) > 0.2) {
      ctx.fillStyle = COIN[3];
      ctx.fillRect(sx - heap + g, sy - 1 - (g & 1), 1, 1);
    }
    // Sparks: each rises from a point on the ring, drifts and fades.
    const prev = ctx.globalAlpha;
    for (let i = 0; i < SPARKS; i++) {
      const speed = 0.35 + hash(i) * 0.3;
      const ph = (time * speed + hash(i + 9)) % 1;
      const [dx, dy] = DOTS[Math.floor(hash(i + 3) * DOTS.length)];
      const x = sx + dx * 0.8 + Math.round(Math.sin(time * 2 + i) * 1.5);
      const y = sy + dy - Math.round(ph * (14 + 8 * hash(i + 5)));
      ctx.globalAlpha = prev * (1 - ph) * 0.95;
      ctx.fillStyle = ph < 0.3 ? EMBER[4] : ph < 0.65 ? EMBER[3] : EMBER[2];
      ctx.fillRect(Math.round(x), y, 1, 1);
    }
    ctx.globalAlpha = prev;
  }

  serialize() {
    return { x: Math.round(this.x), y: Math.round(this.y), coins: this.coins, day: this.day, where: this.where, place: this.place };
  }
}
