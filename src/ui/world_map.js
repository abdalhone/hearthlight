import { h, button } from './dom.js';
import { makePanel } from './modal.js';
import { TILE } from '../core/constants.js';
import { tileDef, T } from '../world/tiles.js';
import { CELL } from '../world/travel.js';
import { bossMarks } from '../world/boss_trails.js';
import { homeBed, HOME_ID } from '../world/home.js';
import { holderOf } from '../core/party.js';

// The map (DESIGN §32.3): the whole world as you have walked it. A small painted chart of
// the ground (one pixel a tile), the parts you have not seen under a dark wash, the roads,
// the places you have reached with their names, the lit waystones, you and whoever walks with you, your
// home, the mission you are on, the bosses you have heard of (§32.4), and anything else
// that wants a mark (the ember-ring where your coins lie, death branch). Drag to look
// round, pinch or wheel or +/− to zoom, "Me" to come back. M is the mind on a keyboard,
// so the map is N; on a phone it is in the menu.

const ZOOMS = [0, 1, 2, 3, 5]; // 0 = fit the whole world
const BG = '#15132a';

// Ground colors a little quieter than the tiles' own, so marks stand out.
function chartColor(id) {
  if (id === T.DIRT || id === T.GRAVEL || id === T.BRIDGE || id === T.COBBLE) return '#c9a46e';
  if (id === T.THICKET) return '#15241b';
  if (id === T.ROCK) return '#57566a';
  if (id === T.WALL || id === T.FLOOR || id === T.RUG || id === T.STONE_FLOOR) return '#b0705a';
  return tileDef(id).color;
}

// The ratio of a canvas's size on screen to its CSS size (the zoom of the layer it is in).
export function canvasZoom(c) {
  const w = c?.clientWidth || 0;
  if (!(w > 0) || typeof c.getBoundingClientRect !== 'function') return 1;
  const k = c.getBoundingClientRect().width / w;
  return Number.isFinite(k) && k > 0.2 && k < 5 ? k : 1;
}

export class WorldMap {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.zi = 2;
    this.cx = null; // view center, tiles
    this.cy = null;
    this._chart = null;
    this._chartFor = null;
    this._pointers = new Map();
    this.caption = '';
  }

  isOpen() {
    return !!this.panel && !!this.ui.stack?.includes(this.panel);
  }

  toggle() {
    if (this.isOpen()) this.ui.closeModal(this.panel);
    else this.open();
  }

  open() {
    const g = this.game;
    if (!g.map || !g.player) return;
    if (this.isOpen()) return;
    const top = this.ui.top?.();
    if (top && top.id !== 'pause') this.ui.closeModal(top, true);
    const panel = makePanel({ id: 'map', title: 'Map', subtitle: '', iconName: 'flag', cls: 'panel-wide panel-map' });
    panel.pauses = true;
    this.panel = panel;
    this.canvas = h('canvas', { class: 'map-canvas', 'aria-label': 'Map of the world' });
    this.cap = h('div', { class: 'map-caption', text: '' });
    panel.body.append(this.canvas, this.cap);
    const zoomOut = button('−', { cls: 'btn-ghost map-zoom', title: 'Zoom out', onClick: () => this.zoomBy(-1) });
    const zoomIn = button('+', { cls: 'btn-ghost map-zoom', title: 'Zoom in', onClick: () => this.zoomBy(1) });
    const me = button('Me', { cls: 'btn-ghost', title: 'Back to where you are', onClick: () => this.center() });
    // The tools sit over the chart's corner, so on a phone held sideways the chart keeps
    // the whole height (✕ in the header closes it).
    panel.body.append(h('div', { class: 'map-tools' }, zoomIn, zoomOut, me));
    panel.onClose = () => {
      this.panel = null;
      cancelAnimationFrame(this._raf);
    };
    this._wire();
    this.center();
    // The first frame, once the chart has a size: centred on you, zoomed out just enough to
    // show the ember-ring or the mission's objective too (round 14b leftover).
    this._frame = true;
    this.ui.openModal(panel);
    const loop = () => {
      if (!this.isOpen()) return;
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  center() {
    const p = this.game.player;
    this.cx = p.x / TILE;
    this.cy = p.y / TILE;
  }

  // Centred on you, with what matters in view: your coins' ember-ring first, else the
  // mission's objective. At each zoom (from the one chosen, outwards; never past the whole-map
  // fit) the view first leans toward it as far as keeps you on the chart; only if that is not
  // enough does it zoom out a step (round 14b leftover: "the map opens on the vale").
  frame(W, H) {
    const g = this.game;
    const p = g.player;
    if (!p || !W || !H) return;
    this.center();
    const marks = this.marks();
    const goal = marks.find((m) => m.kind === 'ember') || marks.find((m) => m.kind === 'objective');
    if (!goal) return;
    const pad = 28;
    const px = p.x / TILE;
    const py = p.y / TILE;
    const gx = goal.x / TILE;
    const gy = goal.y / TILE;
    const tryAt = () => {
      const s = this.scale(W, H);
      const hx = Math.max(0, W / s / 2 - pad / s);
      const hy = Math.max(0, H / s / 2 - pad / s);
      // A center that keeps both you and it inside the padded view, if there is one.
      if (Math.abs(gx - px) > 2 * hx || Math.abs(gy - py) > 2 * hy) return false;
      const cx = Math.max(gx - hx, Math.min(gx + hx, px));
      const cy = Math.max(gy - hy, Math.min(gy + hy, py));
      this.cx = Math.max(px - hx, Math.min(px + hx, cx));
      this.cy = Math.max(py - hy, Math.min(py + hy, cy));
      return true;
    };
    // Zoom out only while the chart still has room to drag (a whole-world fit has none).
    const m = g.map;
    const fit = Math.min(W / m.w, H / m.h);
    while (!tryAt()) {
      const z = ZOOMS[this.zi - 1];
      if (this.zi <= 0 || z === 0 || Math.max(fit, z) <= fit * 1.02) {
        // Not both at once: lean as far toward it as keeps you on the chart.
        const s = this.scale(W, H);
        const hx = Math.max(0, W / s / 2 - pad / s);
        const hy = Math.max(0, H / s / 2 - pad / s);
        this.cx = Math.max(px - hx, Math.min(px + hx, gx));
        this.cy = Math.max(py - hy, Math.min(py + hy, gy));
        return;
      }
      this.zi--;
    }
  }

  zoomBy(d) {
    this.zi = Math.max(0, Math.min(ZOOMS.length - 1, this.zi + d));
  }

  // Pixels per tile on screen (css px).
  scale(W, H) {
    const m = this.game.map;
    const fit = Math.min(W / m.w, H / m.h);
    const z = ZOOMS[this.zi];
    return z === 0 ? fit : Math.max(fit, z);
  }

  _wire() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (this._pointers.size === 2) this._pinch = this._spread();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      // Screen pixels to the chart's own: the panel is drawn at Interface size (r13 zoom).
      const s = this.scale(c.clientWidth, c.clientHeight) * this.zoomOf();
      if (this._pointers.size === 1) {
        this.cx -= (e.clientX - p.x) / s;
        this.cy -= (e.clientY - p.y) / s;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (this._pointers.size === 2 && this._pinch) {
        const now = this._spread();
        if (now > this._pinch * 1.35) {
          this.zoomBy(1);
          this._pinch = now;
        } else if (now < this._pinch / 1.35) {
          this.zoomBy(-1);
          this._pinch = now;
        }
      }
    });
    const up = (e) => {
      const p = this._pointers.get(e.pointerId);
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      // A tap (no drag) names what is under the finger.
      if (p && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 8) this._tap(e);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this._pointers.delete(e.pointerId));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  _spread() {
    const ps = [...this._pointers.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }

  // How much larger the chart is drawn on screen than its own CSS pixels: the Interface
  // size zoom (ui_scale.js, `zoom` on the panel layer with a mouse), 1 on a phone.
  zoomOf() {
    return canvasZoom(this.canvas);
  }

  _tap(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.zoomOf();
    const x = (e.clientX - r.left) / k;
    const y = (e.clientY - r.top) / k;
    let best = null;
    let bd = 26;
    for (const m of this._drawn || []) {
      const d = Math.hypot(m.sx - x, m.sy - y);
      if (d < bd && m.label) (bd = d), (best = m);
    }
    this.caption = best ? best.label : '';
    this.cap.textContent = this.caption;
  }

  // The chart: one pixel per tile, built once per world.
  chart() {
    const m = this.game.map;
    if (this._chart && this._chartFor === m) return this._chart;
    const c = document.createElement('canvas');
    c.width = m.w;
    c.height = m.h;
    const g = c.getContext('2d');
    const img = g.createImageData(m.w, m.h);
    const cache = new Map();
    const rgbOf = (id) => {
      let v = cache.get(id);
      if (!v) {
        const hex = chartColor(id).replace('#', '');
        v = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        cache.set(id, v);
      }
      return v;
    };
    for (let i = 0; i < m.ground.length; i++) {
      const [r, gg, b] = rgbOf(m.ground[i]);
      // A whisper of texture so wide fields do not read as flat paint.
      const k = 0.92 + (((i * 2654435761) >>> 24) / 255) * 0.12;
      img.data[i * 4] = Math.min(255, r * k);
      img.data[i * 4 + 1] = Math.min(255, gg * k);
      img.data[i * 4 + 2] = Math.min(255, b * k);
      img.data[i * 4 + 3] = 255;
    }
    // Trees as darker specks, so woods read as woods.
    for (const o of this.game.objects?.list || []) {
      if (o.objType !== 'tree' || o.removed) continue;
      const i = m.idx(o.tx, o.ty);
      if (i < 0 || i >= m.ground.length) continue;
      img.data[i * 4] *= 0.55;
      img.data[i * 4 + 1] *= 0.62;
      img.data[i * 4 + 2] *= 0.55;
    }
    g.putImageData(img, 0, 0);
    this._chart = c;
    this._chartFor = m;
    return c;
  }

  // The dark wash over what you have not seen, at fog-cell resolution (smoothed).
  fogCanvas() {
    const t = this.game.travel;
    if (!t) return null;
    const c = this._fogC || (this._fogC = document.createElement('canvas'));
    if (c.width !== t.cw || c.height !== t.ch) {
      c.width = t.cw;
      c.height = t.ch;
    }
    const g = c.getContext('2d');
    const img = g.createImageData(t.cw, t.ch);
    for (let i = 0; i < t.fog.length; i++) {
      img.data[i * 4] = 21;
      img.data[i * 4 + 1] = 19;
      img.data[i * 4 + 2] = 42;
      img.data[i * 4 + 3] = t.fog[i] ? 0 : 236;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  marks() {
    const g = this.game;
    const out = [];
    const t = g.travel;
    for (const m of t?.marks?.() || []) {
      if ((m.kind === 'place' || m.kind === 'waystone') && !(t.seenTile?.(Math.floor(m.x / TILE), Math.floor(m.y / TILE)) ?? true)) continue;
      out.push(m);
    }
    // Home is where the Home pointer leads (world/home.js): your bed in the Wayhouse.
    const bed = homeBed(g);
    const home = g.locations?.get?.(HOME_ID);
    if (bed) out.push({ kind: 'home', x: bed.x, y: bed.y, label: 'Your bed (the Wayhouse)' });
    else if (home) out.push({ kind: 'home', x: home.center.x, y: home.center.y, label: 'Your cottage' });
    for (const b of bossMarks(g)) out.push(b);
    // The mission you are on: its objective, when it has a place.
    try {
      for (const mk of g.missions?.markers?.() || []) if (mk.kind === 'objective' && Number.isFinite(mk.x)) out.push({ kind: 'objective', x: mk.x, y: mk.y, label: 'Your mission' });
    } catch {
      /* missions are optional */
    }
    // The ember-ring where your coins lie, and anything else on the ground worth a mark.
    for (const e of g.entities?.list || []) {
      if (e.removed) continue;
      if (e.type === 'ember_ring' && !e.taken) out.push({ kind: 'ember', x: e.x, y: e.y, label: `Your coins${e.coins ? ` (${e.coins})` : ''}` });
      else if (typeof e.mapMark === 'function') {
        const mm = e.mapMark();
        if (mm) out.push({ x: e.x, y: e.y, ...mm });
      }
    }
    // Whoever walks with you (round 14b: the holder of the role, Lyra only while she is the
    // one); nobody beside you, no dot.
    const c = holderOf(g);
    if (c && !c.removed && !c.dead && !c.hidden) out.push({ kind: 'companion', lyra: c.id === 'lyra', x: c.x, y: c.y, label: c.id === 'lyra' ? g.settings?.companionName || c.name || 'Lyra' : String(c.name || c.id).split(' ')[0] });
    out.push({ kind: 'you', x: g.player.x, y: g.player.y, label: 'You' });
    return out;
  }

  draw() {
    const c = this.canvas;
    const g = this.game;
    const m = g.map;
    if (!c || !m) return;
    const W = c.clientWidth || 300;
    const H = c.clientHeight || 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    if (this._frame && c.clientWidth > 0) {
      this._frame = false;
      this.frame(W, H);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const s = this.scale(W, H);
    // Keep the view over the world.
    const halfW = W / s / 2;
    const halfH = H / s / 2;
    const clampC = (v, lo, hi, half) => (hi - lo < half * 2 ? (lo + hi) / 2 : Math.max(lo + half, Math.min(hi - half, v)));
    this.cx = clampC(this.cx, m.x0, m.x0 + m.w, halfW);
    this.cy = clampC(this.cy, m.y0, m.y0 + m.h, halfH);
    const ox = W / 2 - (this.cx - m.x0) * s;
    const oy = H / 2 - (this.cy - m.y0) * s;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.chart(), ox, oy, m.w * s, m.h * s);
    const fog = this.fogCanvas();
    const t = g.travel;
    if (fog && t) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fog, ox + (t.x0 * CELL - m.x0) * s, oy + (t.y0 * CELL - m.y0) * s, t.cw * CELL * s, t.ch * CELL * s);
      ctx.imageSmoothingEnabled = false;
    }
    const toS = (wx, wy) => [ox + (wx / TILE - m.x0) * s, oy + (wy / TILE - m.y0) * s];
    const drawn = [];
    const now = performance.now() / 1000;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const mk of this.marks()) {
      const [sx, sy] = toS(mk.x, mk.y);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawn.push({ ...mk, sx, sy });
      drawMark(ctx, mk, sx, sy, now, s);
    }
    // Names of the places you have reached (and the vale's own), when there is room.
    if (s >= 1.5) {
      ctx.font = '600 11px system-ui, sans-serif';
      for (const mk of drawn) {
        if (mk.kind !== 'place' || !mk.label) continue;
        const reached = !g.travel || g.travel.reached[mk.id] || !g.locations?.get?.(mk.id)?.wilds;
        if (!reached) continue;
        outlineText(ctx, mk.label, mk.sx, mk.sy - 6);
      }
    }
    this._drawn = drawn;
    const loc = g.locations?.at?.(g.player.x, g.player.y);
    this.panel?.setTitle('Map', loc?.name || '');
  }
}

function outlineText(ctx, text, x, y) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(12,10,26,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#f3e7c9';
  ctx.fillText(text, x, y);
}

function drawMark(ctx, mk, x, y, t, s) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  switch (mk.kind) {
    case 'you':
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath();
      ctx.arc(x, y, 5 + pulse * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8743b';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'companion':
    case 'lyra':
      ctx.fillStyle = mk.kind === 'companion' && !mk.lyra ? '#ffb46b' : '#b48cff';
      ctx.strokeStyle = '#1a1030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'home':
      ctx.fillStyle = '#ffd36b';
      ctx.strokeStyle = '#1a1030';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 4);
      ctx.lineTo(x - 5, y - 1);
      ctx.lineTo(x, y - 6);
      ctx.lineTo(x + 5, y - 1);
      ctx.lineTo(x + 5, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'waystone':
      ctx.fillStyle = `rgba(255,190,110,${0.35 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffcf7a';
      ctx.fillRect(x - 1.5, y - 5, 3, 8);
      break;
    case 'boss':
      ctx.fillStyle = mk.slain ? '#7d7787' : '#e0443b';
      ctx.strokeStyle = '#1a1030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff2e0';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(mk.slain ? '✓' : '!', x, y + 0.5);
      ctx.textBaseline = 'bottom';
      if (mk.label && s >= 1) {
        ctx.font = '600 11px system-ui, sans-serif';
        outlineText(ctx, mk.label, x, y - 10);
      }
      break;
    case 'objective':
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'ember':
      ctx.strokeStyle = `rgba(255,140,60,${0.6 + pulse * 0.4})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Named like a boss: the one thing on the chart you must walk back to.
      if (mk.label && s >= 1) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textBaseline = 'bottom';
        outlineText(ctx, mk.label, x, y - 7);
      }
      break;
    case 'place':
      ctx.fillStyle = '#f3e7c9';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      break;
    default:
      ctx.fillStyle = mk.color || '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
  }
}
