// The Spellbook's preview, played by the real Weave (r13; the author: "when I [add]
// twists on spells, it does not change the preview"). Before, the preview was a small
// imitation of a few twists; now a sandbox — a tiny walled arena with its own entity
// manager, combat and Magic runtime (src/magic/magic.js) and the game's own fx layer
// (fx.js) — casts the plan the Spellbook compiled, at a straw dummy, every couple of
// seconds, so every twist does exactly what it does in the world: multishot fans, split
// bursts, bounce rebounds off the arena's wall, chain arcs to the second dummy, orbit
// circles the caster, spiral weaves, echo recasts, volley fires a burst, big and swift
// change the body, linger leaves its patch, burst explodes, homing curves in, pierce
// passes through, leech threads life back, charge gathers before it flies.
// It never touches the real world: its own bus, clock and entities; the real game's atlas
// only for sprites. Silent. If the sandbox cannot be built, the Spellbook falls back to
// the old imitation (spellbook_preview.js), which this extends for the scene's drawing.

import { WeavePreview, W, H, GROUND, CASTER_X } from './spellbook_preview.js';
import { EventBus } from '../core/events.js';
import { EntityManager } from '../entities/manager.js';
import { Actor } from '../entities/entity.js';
import { Combat } from '../entities/combat.js';
import { Magic } from '../magic/magic.js';
import { TILE } from '../core/constants.js';

const OX = 2 * TILE; // the scene's (0, 0) in the arena's world px
const OY = 2 * TILE;
const AW = 16; // arena tiles: the visible scene plus a wall just beyond each side
const AH = 9;
const CYCLE = 2.6; // seconds between casts
const LONG = new Set(['summon', 'rain', 'rune', 'wall', 'ward', 'bind']);
const HP = 1e6;
const DRAIN_RUN = 0.7; // seconds a leech's motes take to run home

function solid(tx, ty) {
  return tx < 1 || ty < 1 || tx > AW - 2 || ty > AH - 2;
}

// Unknown parts of the world answer nothing (the runtime asks a real game for more than
// an arena has: doors, props to break, water…).
function lenient(base) {
  return new Proxy(base, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && !k.startsWith('_') ? () => null : undefined) });
}

export function makeSandbox(realGame) {
  const nums = [];
  const g = {
    sandbox: true,
    bus: new EventBus(),
    clock: { t: 0, daylight: 1, isNight: false, hour: 12, phase: 'day', weather: { type: 'clear' } },
    time: 0,
    state: 'playing',
    paused: false,
    hitStop: 0,
    settings: { reduceMotion: !!realGame?.settings?.reduceMotion },
    flags: {},
    atlas: realGame?.atlas || null,
    map: lenient({ w: AW, h: AH, blocksProjectile: solid, isSolidTile: solid, isWater: () => false, tileAt: () => 1, isIndoor: () => false }),
    objects: lenient({ list: [], doorAt: () => null, isBlockingTile: () => false, inRadius: () => [], nearest: () => null, get: () => null }),
    isBlockedTile: (tx, ty) => solid(tx, ty),
    particles: lenient({ emit() {} }),
    camera: { x: OX - 8, y: OY - 8, vw: W + 16, vh: H + 16, shake() {}, follow() {}, snap() {} },
    lighting: { flash() {}, ambient: { darkness: 0 } },
    bubbles: { number: (x, y, text, color) => nums.push({ x: x - OX, y: y - OY, text: String(text), color }), say() {}, icon() {}, thought() {} },
    audio: { play() {}, ctx: null },
    ui: { toast() {}, isModalOpen: () => false },
    renderer: { frame: 0, scale: 1, subX: 0, subY: 0, canvas: null },
    nums,
  };
  g.entities = new EntityManager(g);
  g.combat = new Combat(g);
  g.combat.random = () => 0.5;
  g.player = g.entities.add(new Actor(g, { id: 'player', name: 'You', faction: 'player', x: OX + CASTER_X + 4, y: OY + GROUND, maxHp: HP, spriteKey: 'player' }));
  g.dummies = [0, 1].map((i) => {
    const d = new Actor(g, { id: `dummy${i}`, name: 'Training dummy', faction: 'monster', kind: 'monster', x: OX + 150, y: OY + GROUND - i * 14, maxHp: HP, radius: 6 });
    d.species = 'dummy';
    d.speed = 0;
    return g.entities.add(d);
  });
  g.magic = new Magic(g);
  g.entities.add(g.magic.layer);
  g.magic.mana.cur = g.magic.mana.max = 9999;
  return g;
}

export class SandboxPreview extends WeavePreview {
  constructor(canvas, game) {
    super(canvas, game);
    this.sg = makeSandbox(game);
    this.world = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.wctx = this.world?.getContext?.('2d') || null;
    this.sg.renderer.canvas = this.world;
    this.release = -1;
    // Leech (round 14b): life drawn out of the dummy runs home to the caster as a stream of
    // green motes along an arc, and the caster glows as it lands, so a leeching weave never
    // looks like a plain one (the real fx thread is a hair's width at the preview's size).
    this.drains = [];
    this.glow = 0;
    this.sg.bus.on('damage', (p) => {
      const i = this.sg.dummies.indexOf(p?.target);
      if (i >= 0) {
        this.dummies[i].hit = 1;
        this.dummies[i].wob = (this.dummies[i].wob || 0) + 1;
        if (p.amount > 0 && this.leeching()) this.drain(i);
      }
    });
  }

  leeching() {
    const tw = this.plan?.twists || this.weave?.twists || [];
    return Array.isArray(tw) && tw.includes('leech');
  }

  // One draw of life from dummy i (a beam's ticks and a burst's many hits share one stream).
  drain(i) {
    const last = this.drains[this.drains.length - 1];
    if (last && last.t < 0.22) return;
    if (this.drains.length >= 5) this.drains.shift();
    this.drains.push({ i, t: 0, landed: false });
  }

  set(weave, plan, palette) {
    super.set(weave, plan, palette);
    this.clearArena();
  }

  // Everything the last weave left: bodies, holds, marks, statuses, familiars.
  clearArena() {
    const g = this.sg;
    const m = g.magic;
    try {
      for (const b of m.bodies) if (b.active) m.end(b, 'dismiss');
      m.update(1 / 60);
    } catch {
      /* a body that will not end is cleared below */
    }
    m.bodies.length = 0;
    m.pending.length = 0;
    m.holds.clear();
    m.movers.length = 0;
    m.decals.length = 0;
    for (const e of [...g.entities.all()]) if (e.type === 'actor' && e !== g.player && !g.dummies.includes(e)) g.entities.remove(e);
    g.entities.list = g.entities.list.filter((e) => !e.removed);
    g.nums.length = 0;
    this.release = -1;
    if (this.drains) this.drains.length = 0;
    this.glow = 0;
    this.reset();
  }

  // The caster and the dummies back on their marks, whole.
  reset() {
    const g = this.sg;
    const P = g.player;
    P.x = OX + CASTER_X + 4;
    P.y = OY + GROUND;
    P.faceDir?.('right');
    g.dummies.forEach((d, i) => {
      d.x = OX + this.dummies[i].x;
      d.y = OY + this.dummies[i].y;
      d.removed = false;
      d.dead = false;
      d.downed = false;
      d.hp = d.maxHp;
      if (d.knock) d.knock.x = d.knock.y = 0;
      try {
        g.magic.status.clear(d);
      } catch {
        /* no statuses */
      }
      if (!g.entities.byId.has(d.id)) g.entities.add(d);
    });
    // Short of full, so a leech's life coming back shows (its green numbers).
    P.hp = Math.round(P.maxHp * 0.6);
  }

  aim(spot = false) {
    const d = this.sg.dummies[0];
    return { x: d.x, y: d.y - (spot ? 2 : 9), target: spot ? null : d };
  }

  cycleLen() {
    return LONG.has(this.weave?.shape) ? CYCLE + 0.8 : CYCLE;
  }

  // Cast the plan the way a press and release would.
  castNow() {
    const g = this.sg;
    const m = g.magic;
    const plan = this.plan;
    if (!plan) return;
    this.reset();
    this.casterPose = this.t;
    const spot = ['throw', 'rune', 'rain', 'wall', 'summon'].includes(this.weave?.shape);
    const aim = this.weave?.shape === 'ward' ? { x: g.player.x + 8, y: g.player.y - 8, target: null } : this.aim(spot);
    if (plan.input === 'hold' || plan.input === 'charge') {
      const r = m.castStart(g.player, plan, aim, { free: true, charge: true });
      if (r?.ok === false) return;
      this.holdAim = aim;
      this.release = this.t + (plan.input === 'hold' ? 1.2 : 0.75);
    } else m.cast(g.player, plan, aim, { free: true });
    // A ward is shown by something to stop: the dummy throws two stones at it.
    if (this.weave?.shape === 'ward') {
      for (const at of [0.5, 1.2]) this.queue.push({ at: this.t + at, stone: true });
    }
  }

  update(dt) {
    this.t += dt;
    for (let i = this.drains.length - 1; i >= 0; i--) {
      const d = this.drains[i];
      d.t += dt;
      if (!d.landed && d.t >= DRAIN_RUN) {
        d.landed = true;
        this.glow = 1;
      }
      if (d.t > DRAIN_RUN + 0.45) this.drains.splice(i, 1);
    }
    this.glow = Math.max(0, this.glow - dt * 1.6);
    for (const d of this.dummies) {
      d.hit = Math.max(0, d.hit - dt * 4);
      d.wob *= Math.pow(0.02, dt);
    }
    const g = this.sg;
    const m = g.magic;
    if (this.weave?.shape && this.plan) {
      this.castT += dt;
      if (this.castT >= this.cycleLen()) {
        this.castT = 0;
        this.castNow();
      }
      const hold = m.holdOf?.(g.player) || null;
      this.charge = hold && hold.mode === 'charge' ? Math.max(0.0001, Math.min(1, hold.k || 0)) : 0;
      if (hold) m.castHold(g.player, this.holdAim || this.aim());
      if (this.release >= 0 && this.t >= this.release) {
        this.release = -1;
        m.castRelease(g.player, this.holdAim || this.aim());
      }
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        if (this.t < q.at) continue;
        this.queue.splice(i, 1);
        if (q.stone) m.cast(g.dummies[0], { shape: 'bolt', essences: ['earth'], twists: [] }, { x: g.player.x, y: g.player.y - 8, target: g.player }, { free: true });
      }
    }
    // Homing shows by following: the dummy steps aside once the weave is loosed, and a
    // homing body turns after it (a plain one flies on where it was aimed).
    if (this.weave?.twists?.includes('homing')) {
      const k = Math.max(0, Math.min(1, (this.t - (this.casterPose ?? -9) - 0.1) / 0.35));
      g.dummies[0].y = OY + this.dummies[0].y - 22 * Math.sin((k * Math.PI) / 2);
    }
    g.time += dt;
    g.clock.t += dt;
    g.entities.update(dt);
    g.combat.update(dt);
    m.update(dt);
    // Nobody leaves the arena for good: a dummy knocked flat is back up.
    for (const d of g.dummies) {
      if (d.hp < d.maxHp * 0.5) d.hp = d.maxHp;
      if (d.removed && !g.entities.byId.has(d.id)) g.entities.add(d);
      d.removed = false;
    }
    // The dummies' shake follows where the real ones were pushed.
    g.dummies.forEach((d, i) => {
      this.dummies[i].dx = d.x - OX - this.dummies[i].x;
      this.dummies[i].dy = d.y - OY - this.dummies[i].y;
    });
    this.casterX = g.player.x - OX - 4;
    this.casterY = g.player.y - OY;
    // Numbers the arena said, into the scene's list.
    while (g.nums.length) {
      const n = g.nums.shift();
      if (this.nums.length > 24) this.nums.shift();
      this.nums.push({ x: n.x, y: n.y, text: n.text, heal: /^\+/.test(n.text) || n.color === '#7dffb0', age: 0 });
    }
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.age += dt;
      n.y -= dt * 16;
      if (n.age > 0.9) this.nums.splice(i, 1);
    }
  }

  draw() {
    const c = this.canvas;
    const ctx = this.ctx;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = Math.max(1, Math.round((c.clientWidth || W * 2) * dpr));
    const ch = Math.max(1, Math.round((c.clientHeight || H * 2) * dpr));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    const fit = Math.min(cw / W, ch / H);
    const s = fit >= 2 ? Math.floor(fit) : Math.max(1, Math.floor(fit * 2) / 2);
    // The world buffer covers the whole canvas in scene px, the scene centred in it.
    const vw = Math.ceil(cw / s);
    const vh = Math.ceil(ch / s);
    const ex = Math.floor((vw - W) / 2);
    const ey = Math.floor((vh - H) / 2);
    const wc = this.world;
    const w = this.wctx;
    if (!wc || !w) return super.draw();
    if (wc.width !== vw) wc.width = vw;
    if (wc.height !== vh) wc.height = vh;
    this.span = ex + 2;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.imageSmoothingEnabled = false;
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    w.fillStyle = '#0e0d26';
    w.fillRect(0, 0, vw, vh);
    w.setTransform(1, 0, 0, 1, ex, ey);
    this.drawGround(w);
    const g = this.sg;
    const m = g.magic;
    const ox = OX - ex;
    const oy = OY - ey;
    g.renderer.frame++;
    g.camera.x = ox;
    g.camera.y = oy;
    g.camera.vw = vw;
    g.camera.vh = vh;
    const t = this.t;
    const pal = this.palette || { core: '#cdbcff', glow: '#8a6cff', spark: '#fff', deep: '#3d2a8a' };
    w.setTransform(1, 0, 0, 1, 0, 0);
    try {
      m.drawGround(w, ox, oy, t);
    } catch (err) {
      this.warnOnce('ground', err);
    }
    w.setTransform(1, 0, 0, 1, ex, ey);
    // Familiars (a summon) and anyone else in the arena, then the dummies and the caster.
    for (const e of g.entities.all()) {
      if (e.type !== 'actor' || e === g.player || g.dummies.includes(e) || e.removed) continue;
      try {
        w.setTransform(1, 0, 0, 1, 0, 0);
        e.draw?.(w, ox, oy, t);
      } catch {
        /* a familiar without a look */
      }
      w.setTransform(1, 0, 0, 1, ex, ey);
    }
    for (let i = this.dummies.length - 1; i >= 0; i--) {
      const d = this.dummies[i];
      const at = { ...d, x: d.x + (d.dx || 0), y: d.y + (d.dy || 0) };
      this.drawDummy(w, at);
    }
    this.drawCaster(w, pal);
    w.setTransform(1, 0, 0, 1, 0, 0);
    try {
      m.drawBodies(w, ox, oy, t);
      g.magicFx?.drawGlow?.(w, g.renderer);
    } catch (err) {
      this.warnOnce('bodies', err);
    }
    // Up to the screen, crisp.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e0d26';
    ctx.fillRect(0, 0, cw, ch);
    const dx = Math.round((cw - vw * s) / 2);
    const dy = Math.round((ch - vh * s) / 2);
    ctx.drawImage(wc, 0, 0, vw, vh, dx, dy, vw * s, vh * s);
    // Life coming home (leech), crisp, at full resolution.
    if (this.drains.length || this.glow > 0) this.drawDrains(ctx, (x) => dx + (x + ex) * s, (y) => dy + (y + ey) * s, s);
    // Numbers at full resolution.
    const fs = Math.max(10, Math.round(s * 4.2));
    ctx.font = `600 ${fs}px "Pixelify Sans", ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of this.nums) {
      const a = 1 - Math.max(0, (n.age - 0.55) / 0.35);
      const x = dx + (n.x + ex) * s;
      const y = dy + (n.y + ey) * s;
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(2, s);
      ctx.strokeStyle = '#0b0915';
      ctx.strokeText(n.text, x, y);
      ctx.fillStyle = n.heal ? '#7dffb0' : pal.spark === '#ffffff' ? pal.core : pal.spark;
      ctx.fillText(n.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // The leech's stream: from the struck dummy up and over to the caster's chest, eight
  // motes (pixel squares with a halo) running home one after another, a red wisp torn off
  // the dummy as it starts, and a green glow round the caster as it lands. sx/sy map scene
  // px to the canvas; s is the scene's scale.
  drawDrains(ctx, sx, sy, s) {
    const toX = this.casterX + 8;
    const toY = (this.casterY ?? GROUND) - 11;
    const sq = (x, y, r, color, a) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      const w = Math.max(1, Math.round(r * 2));
      ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
    };
    for (const d of this.drains) {
      const D = this.dummies[d.i] || this.dummies[0];
      const fx = D.x + (D.dx || 0);
      const fy = D.y + (D.dy || 0) - 10;
      const mx = (fx + toX) / 2;
      const my = Math.min(fy, toY) - 14 - Math.abs(toX - fx) * 0.1;
      const at = (q) => {
        const u = 1 - q;
        return [sx(u * u * fx + 2 * u * q * mx + q * q * toX), sy(u * u * fy + 2 * u * q * my + q * q * toY)];
      };
      const fade = d.t > DRAIN_RUN ? Math.max(0, 1 - (d.t - DRAIN_RUN) / 0.45) : 1;
      // The thread itself: a faint dotted arc while life runs along it.
      for (let k = 1; k < 18; k++) {
        const [x, y] = at(k / 18);
        sq(x, y, s * 0.5, '#5fe08a', 0.28 * fade);
      }
      // A red wisp torn from the dummy.
      if (d.t < 0.3) {
        const k = d.t / 0.3;
        for (let j = 0; j < 4; j++) sq(sx(fx + (j - 1.5) * 3), sy(fy - 2 - k * 8 - j), s * 0.9, '#ff6a5c', (1 - k) * 0.9);
      }
      // The motes, one after another.
      for (let j = 0; j < 8; j++) {
        const q = (d.t - j * 0.05) / DRAIN_RUN;
        if (q <= 0 || q >= 1) continue;
        const e = q * q * (3 - 2 * q);
        const [x, y] = at(e);
        sq(x, y, s * 2.1, '#5fe08a', 0.4 * fade);
        sq(x, y, s * 1.1, '#c8ffd8', fade);
      }
    }
    if (this.glow > 0) {
      const x = sx(toX);
      const y = sy(toY);
      const r = s * (10 + 6 * (1 - this.glow));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(160,255,190,0.55)');
      gr.addColorStop(0.5, 'rgba(95,224,138,0.3)');
      gr.addColorStop(1, 'rgba(95,224,138,0)');
      ctx.globalAlpha = this.glow;
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // A few sparks rising off the caster.
      for (let j = 0; j < 3; j++) sq(x + (j - 1) * s * 5, y - s * (4 + (1 - this.glow) * 10 + j * 2), s * 0.8, '#c8ffd8', this.glow);
    }
    ctx.globalAlpha = 1;
  }

  warnOnce(what, err) {
    this._warned ||= new Set();
    if (this._warned.has(what)) return;
    this._warned.add(what);
    console.warn(`[spellbook] sandbox ${what}`, err);
  }
}

// The preview the Spellbook should use: the sandbox, or the old imitation if the real
// runtime cannot be set up here.
export function makePreview(canvas, game) {
  try {
    return new SandboxPreview(canvas, game);
  } catch (err) {
    console.warn('[spellbook] sandbox preview unavailable; using the simple one', err);
    return new WeavePreview(canvas, game);
  }
}
