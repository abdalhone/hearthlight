// Finishers that adapt to your build (round 14b, item 10; DESIGN §35.4; the author: "make a
// cutscene of me killing the person … If I am more of a sword build … the kill will be with
// sword. If my stats are more into magic … I will shoot his head with magic. Or if they are
// close to each other, I would use them both … if we add arrows and or other classes into
// the game, the kill animation would change based on them").
//
// A data registry: each finisher is { id, label, score(build) -> number, duration (s),
// draw(ctx, sx, sy, k, scene) for the scene over the body, mark(ctx, sx, sy) for the body
// afterwards }. registerFinisher(def) adds one (a future bow, a class), and the highest
// score for the build wins. buildOf(game) is explainable: it blends
//   - the attribute points (might vs weave and focus; works in the free-points mode),
//   - the equipped weapon (a blade),
//   - the recent damage by kind (the player's blade vs their weaves, the last two minutes),
//   - the slotted weaves.
// Hybrid when the two are close.
//
// The kill itself happens at the strike (murder.strike -> kill), so witnesses and every rule
// of a death are unchanged; the scene is laid over the next second or so: a pose lock, a beat
// of slowed time, the blow, a stylised mark on the body (rec.finisher: saved, drawn under
// the shroud too). Settings -> Game -> Finishers: 'full' (default) | 'brief' | 'off'
// (the same outcome, no scene); reduce motion plays 'brief'. A tap skips the scene.

const REG = new Map();
const RECENT = 120; // s of recent damage that counts toward the build
export const FINISHER_MODES = Object.freeze(['full', 'brief', 'off']);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function registerFinisher(def) {
  if (!def?.id || typeof def.score !== 'function') throw new Error('a finisher needs an id and a score');
  REG.set(def.id, { duration: 1.2, label: def.id, ...def });
  return REG.get(def.id);
}

export function unregisterFinisher(id) {
  return REG.delete(id);
}

export function finishers() {
  return [...REG.values()];
}

export function finisherById(id) {
  return REG.get(id) || null;
}

// What the recent fighting was: the player's own blows, by kind (installed once per game).
export function trackDamage(game) {
  if (!game?.bus?.on || game._finisherTrack) return;
  const log = (game._finisherTrack = { melee: [], magic: [] });
  const now = () => game.clock?.t ?? game.time ?? 0;
  const push = (k) => {
    const list = log[k];
    list.push(now());
    if (list.length > 60) list.shift();
  };
  game.bus.on('damage', (p) => {
    const src = p?.source;
    const P = game.player;
    if (!P || !src) return;
    if (src === P && (p.kind === 'melee' || p.kind === 'heavy' || !p.kind)) push('melee');
    else if ((src.type === 'projectile' && src.owner === P) || src.caster === P) push('magic');
  });
  game.bus.on('spell_hit', (p) => {
    if (p?.caster && p.caster === game.player) push('magic');
  });
}

function recentOf(game, kind) {
  const log = game?._finisherTrack?.[kind];
  if (!log) return 0;
  const t = game.clock?.t ?? game.time ?? 0;
  return log.filter((x) => t - x <= RECENT).length;
}

// The build the finisher reads: { melee, magic, ranged (0..1 each), kind, why: [..] }.
export function buildOf(game) {
  const pts = safe(() => game.progression?.points, null) || {};
  const might = Number(pts.might) || 0;
  const weave = (Number(pts.weave) || 0) + (Number(pts.focus) || 0) * 0.6;
  const why = [];
  let melee = 1;
  let magic = 1;
  if (might || weave) {
    melee += might * 1.2;
    magic += weave * 1.2;
    why.push(`points: might ${might}, weave and focus ${Math.round(weave * 10) / 10}`);
  }
  const weapon = safe(() => game.gear?.equipped?.weapon, null);
  if (weapon) {
    melee += 1;
    why.push(`a blade in hand (${weapon})`);
  }
  const m1 = recentOf(game, 'melee');
  const m2 = recentOf(game, 'magic');
  if (m1 || m2) {
    melee += Math.min(4, m1 * 0.5);
    magic += Math.min(4, m2 * 0.5);
    why.push(`lately: ${m1} blade blows, ${m2} weave hits`);
  }
  const slots = (safe(() => game.magic?.slots, null) || []).filter(Boolean).length;
  if (slots > 1) {
    magic += Math.min(2, (slots - 1) * 0.5);
    why.push(`${slots} weaves slotted`);
  }
  const sum = melee + magic;
  const b = { melee: clamp01(melee / sum), magic: clamp01(magic / sum), ranged: 0, why };
  // Close to even: both.
  b.kind = Math.abs(b.melee - b.magic) < 0.16 ? 'hybrid' : b.melee > b.magic ? 'sword' : 'magic';
  return b;
}

// The finisher that fits the build best (a registered one may outbid the three).
export function chooseFinisher(game, build = buildOf(game)) {
  let best = null;
  let bs = -Infinity;
  for (const f of REG.values()) {
    const s = safe(() => f.score(build, game), -Infinity);
    if (s > bs) {
      bs = s;
      best = f;
    }
  }
  return best;
}

// 'full' | 'brief' | 'off' (reduce motion makes a full one brief).
export function finisherMode(game) {
  const s = game?.settings || {};
  const m = FINISHER_MODES.includes(s.finishers) ? s.finishers : 'full';
  if (m === 'full' && s.reduceMotion) return 'brief';
  return m;
}

// ---------------------------------------------------------------- the three

const STEEL = ['#f4f1ff', '#c9c4de', '#8f88ad'];
const BLOOD = ['#5c0f17', '#7a1420', '#3d0910'];

function slash(ctx, sx, sy, k, dir = 1) {
  // A bright arc crossing the body's neck, then fading.
  const a = 0.25 + 0.75 * clamp01(k * 2.2);
  const fade = k < 0.5 ? 1 : clamp01(1 - (k - 0.5) * 2);
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = STEEL[i];
    ctx.lineWidth = 3 - i;
    ctx.beginPath();
    const r = 16 - i;
    ctx.arc(sx, sy - 4, r, Math.PI * (dir > 0 ? 1.1 : -0.1), Math.PI * (dir > 0 ? 1.1 + 0.9 * a : -0.1 - 0.9 * a) * 1, dir < 0);
    ctx.stroke();
  }
  ctx.restore();
}

function bolt(ctx, x0, y0, x1, y1, k, pal) {
  const fade = k < 0.6 ? 1 : clamp01(1 - (k - 0.6) * 2.5);
  const reach = clamp01(k * 3);
  const ex = x0 + (x1 - x0) * reach;
  const ey = y0 + (y1 - y0) * reach;
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.lineCap = 'round';
  const cols = pal && pal.length ? pal : ['#ffffff', '#c9b6ff', '#7a5cff'];
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = cols[Math.min(cols.length - 1, i)];
    ctx.lineWidth = 4 - i * 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const mx = (x0 + ex) / 2 + Math.sin(k * 40 + i) * 2;
    const my = (y0 + ey) / 2 + Math.cos(k * 37 + i) * 2;
    ctx.lineTo(mx, my);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  if (reach >= 1) {
    ctx.fillStyle = cols[0];
    ctx.beginPath();
    ctx.arc(x1, y1, 3 + 4 * (1 - fade), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The body afterwards: stylised, never gory. A blade's clean line and a few dark drops; a
// weave's scorch; both.
function markSword(ctx, sx, sy) {
  ctx.fillStyle = BLOOD[0];
  ctx.fillRect(sx - 9, sy - 4, 5, 1);
  ctx.fillRect(sx - 11, sy - 3, 3, 1);
  ctx.fillStyle = BLOOD[1];
  ctx.fillRect(sx - 13, sy - 1, 2, 1);
  ctx.fillRect(sx - 15, sy + 1, 1, 1);
}

function markMagic(ctx, sx, sy) {
  ctx.save();
  ctx.globalAlpha *= 0.8;
  ctx.fillStyle = '#1b1424';
  ctx.beginPath();
  ctx.ellipse(sx - 9, sy - 2, 5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a2f5e';
  ctx.fillRect(sx - 12, sy - 3, 2, 1);
  ctx.fillRect(sx - 7, sy - 1, 2, 1);
  ctx.restore();
}

registerFinisher({
  id: 'sword',
  label: 'The blade',
  duration: 1.25,
  score: (b) => b.melee - b.magic * 0.6 + (b.kind === 'sword' ? 1 : 0),
  draw(ctx, sx, sy, k, scene) {
    slash(ctx, sx, sy, k, scene.dir);
  },
  mark: markSword,
});

registerFinisher({
  id: 'magic',
  label: 'The weave',
  duration: 1.25,
  score: (b) => b.magic - b.melee * 0.6 + (b.kind === 'magic' ? 1 : 0),
  draw(ctx, sx, sy, k, scene) {
    bolt(ctx, scene.hx, scene.hy, sx - 8 * scene.dir, sy - 4, k, scene.pal);
  },
  mark: markMagic,
});

registerFinisher({
  id: 'hybrid',
  label: 'Blade and weave',
  duration: 1.5,
  score: (b) => 1.2 - Math.abs(b.melee - b.magic) * 3 + (b.kind === 'hybrid' ? 1 : 0),
  draw(ctx, sx, sy, k, scene) {
    if (k < 0.55) slash(ctx, sx, sy, k / 0.55, scene.dir);
    else bolt(ctx, scene.hx, scene.hy, sx - 8 * scene.dir, sy - 4, (k - 0.55) / 0.45, scene.pal);
  },
  mark(ctx, sx, sy) {
    markSword(ctx, sx, sy);
    markMagic(ctx, sx, sy);
  },
});

// The mark on a body that a finisher left (draw.js asks).
export function drawFinisherMark(ctx, sx, sy, id) {
  const f = REG.get(id);
  if (f?.mark) safe(() => f.mark(ctx, sx, sy));
}

// ---------------------------------------------------------------- the scene

// Round 15 (DESIGN §40.3; the author: "if I finish someone, there is still no cutscene of me
// killing them"). The kill still happens at the strike (murder.strike -> kill: witnesses, the
// record, the hunt exactly as before); over it now plays a short killing scene, in real seconds
// whatever the world's slowed beat:
//   raise  (0 .. RAISE)   the camera closes in, letterbox bars slide in, time slows; your own
//                         character lifts the blade overhead (its 'attack' frame 0) or raises
//                         the weaving hands (its 'cast' frames), the victim's hand comes up;
//   drive  (.. DRIVE)     the blow goes home: the swing's frames, a hit-stop, the low hit, the
//                         slash or the bolt (the build's finisher, as round 14b chose it);
//   fall   (.. FALL)      the victim's hand drops, the body jolts once and is still; a faint
//                         warmth rises off them and fades UPWARD (toward the Hearth, never into
//                         you: DESIGN §40.4); the world's pace comes back;
//   out    (.. dur)       the bars and the camera go back; you stand exactly where you were.
// A tap, a click or any key skips it (finisher_view.js; input's interact/cancel/pause here
// too); a wall clock guards it, so a slow phone never holds you in it. Reduce motion (or
// Settings → Finishers: brief) plays a short still version: no zoom, no slowed time, no shake.
export const SCENE = Object.freeze({ RAISE: 0.8, DRIVE: 1.05, FALL: 1.9, FULL: 2.6, BRIEF: 0.9 });

// Who lies there: 'lyra', 'person' (any villager or whoever walks with you), 'bandit', 'beast'.
// Only persons can be finished today (murder.finishTarget); the scene reads the others too.
export function victimKind(game, v) {
  if (!v) return 'person';
  if (v === game?.companion || v.id === 'lyra') return 'lyra';
  if (v.profile || v.type === 'npc') return 'person';
  const sp = String(v.species || '');
  if (/bandit|varek/.test(sp) || v.faction === 'bandit') return 'bandit';
  if (sp) return 'beast';
  return 'person';
}

const SKIN = ['#f1c9a5', '#d9a57e', '#a8714f'];
const WARM = ['#fff2c0', '#ffd27a', '#ffb047'];

// The victim's last moment: a hand lifted from the ground, trembling, that drops when the
// blow lands; then one jolt. Beasts and bandits: no hand, only the jolt.
function lastMoment(ctx, sx, sy, t, scene) {
  const kind = scene.kind;
  const D = scene.T;
  if (kind === 'person' || kind === 'lyra') {
    const up = t < D.DRIVE ? clamp01(t / (D.RAISE * 0.8)) : clamp01(1 - (t - D.DRIVE) / 0.18);
    if (up > 0.02) {
      const tremble = scene.brief ? 0 : Math.round(Math.sin(t * 38) * (t < D.DRIVE ? 1 : 0));
      const hx = sx + 5 * -scene.dir + tremble;
      const hy = sy - 3;
      const h = Math.round(1 + 6 * up);
      ctx.fillStyle = SKIN[2];
      ctx.fillRect(hx, hy - h, 2, h);
      ctx.fillStyle = SKIN[0];
      ctx.fillRect(hx, hy - h - 2, 2, 2);
      ctx.fillStyle = SKIN[1];
      ctx.fillRect(hx + (scene.dir > 0 ? -1 : 2), hy - h - 1, 1, 2);
    }
  }
  // One jolt as the blow lands: a puff of dust under the body.
  const j = t - D.DRIVE;
  if (j > 0 && j < 0.35) {
    const a = 1 - j / 0.35;
    ctx.save();
    ctx.globalAlpha *= a * 0.8;
    ctx.fillStyle = '#c9bda8';
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(sx - 8 + i * 4 + Math.sin(i * 2.1) * 2), Math.round(sy + 1 - j * 10 * (i % 2 ? 1 : 0.6)), 1, 1);
    ctx.restore();
  }
  // A faint warmth rises off a person and fades upward (never toward you).
  if ((kind === 'person' || kind === 'lyra') && t > D.DRIVE + 0.15 && t < D.FULL) {
    const r = (t - D.DRIVE - 0.15) / (D.FULL - D.DRIVE - 0.15);
    ctx.save();
    ctx.globalAlpha *= 0.85 * (1 - r);
    const col = kind === 'lyra' ? ['#ffffff', '#c9b6ff', '#7a5cff'] : WARM;
    for (let i = 0; i < 4; i++) {
      const rise = r * (26 + i * 5);
      const x = Math.round(sx - 2 + Math.sin(r * 6 + i * 1.7) * 2 + (i - 1.5) * 2);
      const y = Math.round(sy - 8 - rise);
      ctx.fillStyle = col[i % 3];
      ctx.fillRect(x, y, 1, i === 0 ? 2 : 1);
    }
    ctx.restore();
  }
}

// The weaver's pose for this moment: { anim, frame } of the player's own sprite.
export function poseAt(f, t, T) {
  const magic = f?.id === 'magic';
  const both = f?.id === 'hybrid';
  if (t < T.RAISE) {
    if (magic) return { anim: 'cast', frame: t < T.RAISE * 0.35 ? 0 : t < T.RAISE * 0.7 ? 1 : 2 };
    return { anim: 'attack', frame: 0 };
  }
  if (t < T.DRIVE) {
    if (magic) return { anim: 'cast', frame: 2 };
    const k = (t - T.RAISE) / (T.DRIVE - T.RAISE);
    return { anim: 'attack', frame: k < 0.34 ? 1 : k < 0.67 ? 2 : 3 };
  }
  if (t < T.FALL) {
    if (both && t > T.DRIVE + 0.3) return { anim: 'cast', frame: 2 };
    return magic ? { anim: 'cast', frame: 2 } : { anim: 'attack', frame: 3 };
  }
  return null;
}

// A short killing scene laid over the strike (see above). Returns the scene (or null when off).
export function playFinisher(game, P, v, rec) {
  trackDamage(game);
  const f = chooseFinisher(game);
  if (rec && f) rec.finisher = f.id;
  const mode = finisherMode(game);
  if (mode === 'off' || !f || !game?.entities?.add) return null;
  const brief = mode === 'brief';
  const dir = P && v && P.x <= v.x ? 1 : -1;
  const pal = safe(() => {
    const w = game.magic?.slots?.find?.(Boolean);
    return w?.plan?.palette || null;
  }, null);
  // The phases, in real seconds (brief: the same beats, squeezed).
  const k = brief ? SCENE.BRIEF / SCENE.FULL : 1;
  const T = { RAISE: SCENE.RAISE * k, DRIVE: SCENE.DRIVE * k, FALL: SCENE.FALL * k, FULL: SCENE.FULL * k };
  const wall = () => (typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000);
  const scene = {
    type: 'fx',
    id: `finisher_${v?.id || 'x'}`,
    finisher: f,
    kind: victimKind(game, v),
    t: 0,
    dur: T.FULL,
    T,
    x: v?.x ?? 0,
    y: v?.y ?? 0,
    px: P?.x ?? 0,
    py: P?.y ?? 0,
    hx: (P?.x ?? 0) + 4 * dir,
    hy: (P?.y ?? 0) - 12,
    dir,
    pal,
    brief,
    mode,
    victim: v || null,
    struck: false,
    wall0: wall(),
    removed: false,
    solid: false,
    radius: 0,
    dead: false,
    get sortY() {
      return this.y + 1e6;
    },
    isAlive: () => false,
    canInteract: () => false,
    update(dt) {
      // Real seconds, whatever the world's slowed beat (game.timeScale).
      this.t += dt / Math.max(0.2, game.timeScale || 1);
      // The wall clock guards it: a stalled or throttled frame never holds you here.
      const over = wall() - this.wall0 > this.dur + 1.5;
      // A tap or a key skips it (the page's own keys and taps: finisher_view.js).
      const skip = safe(() => game.input?.pressed?.('interact') || game.input?.pressed?.('cancel') || game.input?.pressed?.('pause'), false);
      if (this.t >= this.dur || skip || over) {
        this.end(skip ? 'skipped' : over ? 'guard' : 'done');
        return;
      }
      // You stand where you are while it plays (no step, no drift).
      if (P && !P.removed) {
        if (P.moveIntent) {
          P.moveIntent.x = 0;
          P.moveIntent.y = 0;
        }
        if (P.vel) {
          P.vel.x = 0;
          P.vel.y = 0;
        }
        P.x = this.px;
        P.y = this.py;
        P.faceToward?.(this.x, this.y);
        const pose = poseAt(f, this.t, T);
        P._finisherPose = pose ? { id: f.id, ...pose, until: (game.time ?? 0) + 0.2 } : null;
      }
      // The blow goes home.
      if (!this.struck && this.t >= T.RAISE) {
        this.struck = true;
        if (!brief) {
          game.hitStop = Math.max(game.hitStop || 0, 0.12);
          safe(() => game.camera?.shake?.(f.id === 'magic' ? 2 : 3, 0.3));
        }
        safe(() => game.audio?.play?.(f.id === 'magic' ? 'spell' : 'hit', { x: this.x, y: this.y, volume: 0.95, pitch: f.id === 'magic' ? 0.7 : 0.5 }));
        if (f.id !== 'sword') safe(() => game.lighting?.flash?.({ x: this.x, y: this.y - 6, r: 60, color: '#b9a6ff', intensity: 0.8, duration: 0.4 }));
        safe(() => game.particles?.emit?.(f.id === 'sword' ? 'hit' : 'magic', this.x - 6 * dir, this.y - 6, { count: brief ? 6 : 12, speed: 40, life: 0.5 }));
      }
      // Time slows for the blow and the fall, then comes back (never under reduce motion).
      if (!brief) {
        const want = this.t < T.FALL ? 0.35 : 1;
        game.timeScale = this.t < T.FALL ? want : Math.min(1, (game.timeScale || 1) + dt * 4);
      }
      if (!this.fell && this.t >= T.DRIVE + 0.2) {
        this.fell = true;
        safe(() => game.audio?.play?.('death', { x: this.x, y: this.y, volume: 0.6, pitch: 0.8 }));
      }
      safe(() => game.finisherView?.frame?.(this));
    },
    end(why = 'done') {
      if (this.removed) return;
      this.removed = true;
      this.ended = why;
      if (game._finisherScene === this) game._finisherScene = null;
      if (game.timeScale && game.timeScale < 1) game.timeScale = 1;
      if (P) {
        P._finisherPose = null;
        if (Number.isFinite(this.px)) {
          P.x = this.px;
          P.y = this.py;
        }
      }
      safe(() => game.finisherView?.close?.(this));
      game.bus?.emit?.('finisher_scene_end', { id: f.id, victim: v?.id, why });
    },
    skip() {
      this.end('skipped');
    },
    draw(ctx, ox, oy) {
      const t = this.t;
      const sx = Math.round(this.x - ox);
      const sy = Math.round(this.y - oy);
      safe(() => lastMoment(ctx, sx, sy, t, this));
      // A glint on the raised blade, at the top of the lift.
      if (f.id !== 'magic' && t > T.RAISE * 0.55 && t < T.RAISE) {
        // (the raised blade's tip: back over the shoulder, above the head)
        const gx = Math.round(this.px - ox - 9 * this.dir);
        const gy = Math.round(this.py - oy - 25);
        const a = Math.sin(((t - T.RAISE * 0.55) / (T.RAISE * 0.45)) * Math.PI);
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(gx - 2, gy, 5, 1);
        ctx.fillRect(gx, gy - 2, 1, 5);
        ctx.restore();
      }
      // The build's blow (the round 14b finisher: slash, bolt, or both), from the drive.
      if (t >= T.RAISE) {
        const kk = clamp01((t - T.RAISE) / Math.max(0.3, T.FALL - T.RAISE));
        const s = { ...this, hx: this.hx - ox, hy: this.hy - oy };
        safe(() => f.draw(ctx, sx, sy, kk, s));
      }
    },
  };
  if (game._finisherScene) game._finisherScene.end('replaced');
  game._finisherScene = scene;
  if (P) P._finisherPose = { id: f.id, ...poseAt(f, 0, T), until: (game.time ?? 0) + 0.2 };
  if (!brief) game.timeScale = 0.35;
  game.entities.add(scene);
  game.bus?.emit?.('finisher', { id: f.id, victim: v?.id, mode, kind: scene.kind, dur: scene.dur });
  safe(() => game.finisherView?.open?.(scene));
  return scene;
}
