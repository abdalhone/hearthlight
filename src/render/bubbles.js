import { OUTLINE, UI } from '../art/palette.js';
import { portrait } from '../art/characters_art.js';
import { COMPANION_ID, PLAYER_ID } from '../core/constants.js';
import {
  wrapText,
  revealCount,
  typingCps,
  bubbleLifetime,
  layoutBubble,
  stackRects,
  edgePoint,
  numberStyle,
  uiFontPx,
  pixelUnit,
} from './text_layout.js';

// Speech and thought bubbles, emote icons, floating numbers, NPC name tags and the
// edge marker that points at Lyra when she is off screen. Everything here is drawn
// on the full-resolution canvas (crisp text) but styled like the pixel art.
//
// Contract:
//   say(entity, text, { kind: 'say'|'bark'|'shout'|'whisper', duration })  speech bubble that types out
//   thought(entity, text, { duration })                               cloud-style thought bubble
//   icon(entity, name, { duration })   name: '!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...'
//   number(x, y, text, color, { crit, kind })  floating number at a world position
//   clear(entity) ; update(dt) ; draw(ctx, renderer)

const FAMILY = '"Pixelify Sans", ui-monospace, monospace';
const MAX_CHARS = 26;
const MAX_LINES = 4;
const FADE_IN = 0.16;
const FADE_OUT = 0.32;
const NAME_TAG_RANGE = 44;
const MAX_NUMBERS = 48;

export const ICONS = ['!', '?', 'heart', 'zzz', 'anger', 'note', 'sweat', '...'];
const ICON_ALIASES = {
  love: 'heart',
  '♥': 'heart',
  music: 'note',
  song: 'note',
  sing: 'note',
  angry: 'anger',
  mad: 'anger',
  exclaim: '!',
  alert: '!',
  surprise: '!',
  surprised: '!',
  question: '?',
  confused: '?',
  sleep: 'zzz',
  sleepy: 'zzz',
  z: 'zzz',
  thinking: '...',
  think: '...',
  '…': '...',
  ellipsis: '...',
  nervous: 'sweat',
  embarrassed: 'sweat',
  embarrassment: 'sweat',
  worried: 'sweat',
  fear: 'sweat',
  afraid: 'sweat',
  scared: 'sweat',
  // Emotion names from Lyra's mind, so express(emotion) can show something fitting.
  joy: 'note',
  happy: 'note',
  laugh: 'note',
  cheer: 'note',
  dance: 'note',
  pride: 'note',
  proud: 'note',
  trust: 'heart',
  affection: 'heart',
  hug: 'heart',
  anger: 'anger',
  curiosity: '?',
  curious: '?',
  sadness: '...',
  sad: '...',
  cry: '...',
  tired: 'zzz',
};

// Tail of a speech box, in bubble pixels, pointing down. O = outline, E = edge, F = fill.
// Row 0 overlaps the box's inner edge row, row 1 its outline row.
const TAIL_ROWS = ['EEFFFEE', 'OEFFFEO', '.OEFEO.', '..OEO..', '...O...'];
const TAIL = { O: [], E: [], F: [] };
TAIL_ROWS.forEach((row, ry) => [...row].forEach((ch, cx) => ch !== '.' && TAIL[ch].push(cx, ry)));

// Lyra's bubble keeps its place, then older bubbles; newer ones move out of the way.
const byPriority = (p, q) => (p.entity.id === COMPANION_ID ? -1 : q.entity.id === COMPANION_ID ? 1 : q.t - p.t);

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function speakerStyle(entity, kind) {
  const isLyra = entity?.id === COMPANION_ID;
  const isPlayer = entity?.id === PLAYER_ID;
  if (kind === 'thought') {
    return {
      fill: '#2a2347',
      edge: isLyra ? '#7a64e0' : '#6a6a7c',
      text: isLyra ? '#d8cff5' : '#cfc6b8',
      label: isLyra ? UI.arcane : UI.ember,
    };
  }
  const s = {
    fill: isLyra ? '#221a3d' : '#1c1730',
    edge: isLyra ? UI.arcane : isPlayer ? '#8ccbe6' : UI.bubbleEdge,
    text: UI.text,
    label: isLyra ? UI.arcane : UI.ember,
  };
  if (kind === 'shout' && !isLyra) s.edge = UI.danger;
  if (kind === 'whisper') {
    s.edge = isLyra ? '#7a64e0' : '#7d7787';
    s.text = UI.textDim;
  }
  return s;
}

function headHeight(e) {
  if (Number.isFinite(e.headHeight)) return e.headHeight;
  if (Number.isFinite(e.bubbleHeight)) return e.bubbleHeight;
  if (e.state === 'downed' || e.state === 'sleep' || e.downed) return 12;
  if (e.kind === 'animal' || e.kind === 'monster') return 16;
  return 26;
}

export class Bubbles {
  constructor(game) {
    this.game = game;
    this.items = []; // speech and thought bubbles, at most one per entity
    this.icons = [];
    this.numbers = [];
    for (let i = 0; i < MAX_NUMBERS; i++) this.numbers.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, text: '', fill: '#fff', scale: 1, kind: 'damage' });
    this._vis = [];
    this._rects = [];
    this._edge = { x: 0, y: 0, angle: 0, onScreen: true };
    this._lp = { ax: 0, ay: 0, footY: 0, w: 0, h: 0, gap: 0, margin: 0, corner: 0, tailHalf: 0, screenW: 0, screenH: 0 };
    this._tagWidths = new Map();
    this._fontPx = 0;
    this._portrait = undefined;
    this._time = 0;
    // Bubbles measured before the pixel font arrived would be the wrong width.
    if (typeof document !== 'undefined' && document.fonts?.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => {
        this._fontPx = 0;
        for (const b of this.items) b.widths = null;
        this._tagWidths.clear();
      });
    }
  }

  // ---------------------------------------------------------------- API

  say(entity, text, opts = {}) {
    const str = String(text ?? '').trim();
    if (!entity || !str) return null;
    const kind = ['say', 'bark', 'shout', 'whisper'].includes(opts.kind) ? opts.kind : 'say';
    this._removeFor(entity, true);
    this._removeIcon(entity, '...');
    const { lines } = wrapText(str, MAX_CHARS, MAX_LINES);
    const joined = lines.join('\n');
    const cps = typingCps(this.game?.settings?.textSpeed ?? 1);
    const life = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : bubbleLifetime(joined, cps, kind);
    const b = this._make(entity, kind, str, lines, joined, cps, life);
    this.items.push(b);
    return b;
  }

  // A thought shows only while the entity is not speaking, and only when the player
  // asked to see thoughts.
  thought(entity, text, opts = {}) {
    const str = String(text ?? '').trim();
    if (!entity || !str) return null;
    if (this.game?.settings?.showThoughts === false) return null;
    if (this.isSpeaking(entity)) return null;
    this._removeFor(entity, true);
    const { lines } = wrapText(str, MAX_CHARS, MAX_LINES);
    const joined = lines.join('\n');
    const life = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : Math.min(8, 3.4 + joined.length * 0.045);
    const b = this._make(entity, 'thought', str, lines, joined, Infinity, life);
    this.items.push(b);
    return b;
  }

  icon(entity, name, opts = {}) {
    if (!entity) return null;
    const raw = String(name ?? '').trim().toLowerCase();
    const n = ICONS.includes(raw) ? raw : ICON_ALIASES[raw] || (ICONS.includes(String(name)) ? String(name) : null);
    if (!n) return null;
    this._removeIcon(entity);
    const life = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : n === '...' ? 8 : n === 'zzz' ? 3.2 : 1.7;
    const ic = { entity, name: n, t: 0, life };
    this.icons.push(ic);
    return ic;
  }

  // Floating number at a world position. color: a style name ('damage', 'crit',
  // 'heal', 'xp', 'hurt', 'info') or a CSS color. opts: { crit, kind }.
  number(x, y, text, color, opts = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let slot = null;
    let oldest = null;
    for (const n of this.numbers) {
      if (!n.active) {
        slot = n;
        break;
      }
      if (!oldest || n.t / n.life > oldest.t / oldest.life) oldest = n;
    }
    slot = slot || oldest;
    const style = numberStyle(color, text, opts || {});
    const crit = style.kind === 'crit';
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vx = (Math.random() * 2 - 1) * 14;
    slot.vy = -(58 + Math.random() * 14) * (crit ? 1.15 : 1);
    slot.t = 0;
    slot.life = crit ? 1.15 : style.kind === 'xp' ? 1.3 : 0.95;
    slot.text = String(text ?? '');
    slot.fill = style.fill;
    slot.scale = style.scale;
    slot.kind = style.kind;
  }

  clear(entity) {
    if (!entity) return;
    this._removeFor(entity, true);
    this._removeIcon(entity);
  }

  clearIcon(entity, name) {
    this._removeIcon(entity, name);
  }

  clearAll() {
    this.items.length = 0;
    this.icons.length = 0;
    for (const n of this.numbers) n.active = false;
  }

  // True while the entity has a visible speech bubble (not a thought).
  isSpeaking(entity) {
    for (const b of this.items) if (b.entity === entity && b.kind !== 'thought' && b.t < b.life) return true;
    return false;
  }

  hasBubble(entity) {
    for (const b of this.items) if (b.entity === entity && b.t < b.life) return true;
    return false;
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this._time += dt;
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i];
      b.t += dt;
      if (b.t < b.life && !b.entity.removed) this.items[w++] = b;
    }
    this.items.length = w;
    w = 0;
    for (let i = 0; i < this.icons.length; i++) {
      const ic = this.icons[i];
      ic.t += dt;
      if (ic.t < ic.life && !ic.entity.removed) this.icons[w++] = ic;
    }
    this.icons.length = w;
    const drag = Math.exp(-2 * dt);
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.t += dt;
      if (n.t >= n.life) {
        n.active = false;
        continue;
      }
      n.vy += 150 * dt;
      n.vx *= drag;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
    }
  }

  _make(entity, kind, text, lines, joined, cps, life) {
    return {
      entity,
      kind,
      text,
      lines,
      joined,
      cps,
      life,
      t: 0,
      fontPx: 0,
      widths: null,
      w: 0,
      h: 0,
      tabW: 0,
      tabH: 0,
      cloud: null,
      layout: { x: 0, y: 0, w: 0, h: 0, below: false, tailX: 0 },
      ax: 0,
      ay: 0,
      origY: 0,
      visible: false,
    };
  }

  _removeFor(entity, includeThoughts) {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i];
      if (b.entity === entity && (includeThoughts || b.kind !== 'thought')) continue;
      this.items[w++] = b;
    }
    this.items.length = w;
  }

  _removeIcon(entity, name) {
    let w = 0;
    for (let i = 0; i < this.icons.length; i++) {
      const ic = this.icons[i];
      if (ic.entity === entity && (!name || ic.name === name)) continue;
      this.icons[w++] = ic;
    }
    this.icons.length = w;
  }

  // ---------------------------------------------------------------- draw

  _metrics(r) {
    const fontPx = uiFontPx(r.scale, r.dpr);
    if (fontPx === this._fontPx) return;
    this._fontPx = fontPx;
    this.u = pixelUnit(fontPx);
    const u = this.u;
    this.lineH = Math.round(fontPx * 1.22);
    this.padX = 2 * u + Math.round(fontPx * 0.5);
    this.padY = 2 * u + Math.round(fontPx * 0.3);
    this.labelPx = Math.max(10, Math.round(fontPx * 0.72));
    this.fonts = {
      say: `500 ${fontPx}px ${FAMILY}`,
      bark: `500 ${fontPx}px ${FAMILY}`,
      shout: `700 ${fontPx}px ${FAMILY}`,
      whisper: `400 ${fontPx}px ${FAMILY}`,
      thought: `italic 400 ${fontPx}px ${FAMILY}`,
      label: `600 ${this.labelPx}px ${FAMILY}`,
      number: `700 ${Math.round(fontPx * 1.05)}px ${FAMILY}`,
    };
    this._tagWidths.clear();
  }

  // World position -> device pixel on the main canvas (matches the upscaled buffer).
  _dx(r, wx) {
    return (wx - r.ox) * r.scale - r.subX;
  }

  _dy(r, wy) {
    return (wy - r.oy) * r.scale - r.subY;
  }

  draw(ctx, r) {
    if (!r) return;
    this._metrics(r);
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.textBaseline = 'middle';
    const playing = this.game?.state === 'playing' || this.game?.state === 'sleeping';
    if (playing) this._drawNameTags(ctx, r);
    this._drawNumbers(ctx, r, W, H);
    this._layoutBubbles(ctx, r, W, H);
    for (let i = 0; i < this._vis.length; i++) this._drawBubble(ctx, this._vis[i], r);
    this._drawIcons(ctx, r, W, H);
    if (playing) this._drawCompanionMarker(ctx, r, W, H);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _measure(ctx, b) {
    if (b.fontPx === this._fontPx && b.widths) return;
    const u = this.u;
    b.fontPx = this._fontPx;
    ctx.font = this.fonts[b.kind] || this.fonts.say;
    let maxW = 0;
    b.widths = b.lines.map((line) => {
      const w = ctx.measureText(line).width;
      if (w > maxW) maxW = w;
      return w;
    });
    const e = b.entity;
    const label = e.id !== PLAYER_ID && e.name ? String(e.name) : '';
    b.label = label;
    if (label) {
      ctx.font = this.fonts.label;
      b.tabW = Math.ceil((ctx.measureText(label).width + 6 * u) / u) * u;
      b.tabH = Math.ceil((this.labelPx + 4 * u) / u) * u;
    } else {
      b.tabW = b.tabH = 0;
    }
    const minW = Math.max(b.tabW + 6 * u, 10 * u);
    const thoughtPad = b.kind === 'thought' ? 8 * u : 0;
    b.w = Math.ceil(Math.max(minW, maxW + 2 * this.padX + thoughtPad) / u) * u;
    b.h = Math.ceil((b.lines.length * this.lineH + 2 * this.padY + thoughtPad) / u) * u;
    b.cloud = null;
  }

  _alpha(b) {
    const fin = Math.min(1, b.t / FADE_IN);
    const fout = Math.min(1, (b.life - b.t) / FADE_OUT);
    const a = Math.max(0, Math.min(fin, fout));
    return b.kind === 'whisper' ? a * 0.88 : a;
  }

  _layoutBubbles(ctx, r, W, H) {
    const vis = this._vis;
    vis.length = 0;
    const u = this.u;
    const margin = 4 * u;
    for (const b of this.items) {
      const e = b.entity;
      if (b.t >= b.life || e.removed) continue;
      this._measure(ctx, b);
      const z = e.z || 0;
      const ax = this._dx(r, e.x);
      const ay = this._dy(r, e.y - headHeight(e) - z) - 2 * r.scale;
      const footY = this._dy(r, e.y) + 4 * r.scale;
      const onScreen = ax > -16 && ax < W + 16 && ay > -48 && footY < H + 48;
      // Off-screen villagers are out of earshot; Lyra's words are pinned to the edge.
      if (!onScreen && e.id !== COMPANION_ID) continue;
      const top = b.tabH ? b.tabH - 2 * u : 0;
      const lp = this._lp;
      lp.ax = ax;
      lp.ay = ay;
      lp.footY = footY;
      lp.w = b.w;
      lp.h = b.h + top;
      lp.gap = (b.kind === 'thought' ? 11 : 4) * u;
      lp.margin = margin;
      lp.corner = 3 * u;
      lp.tailHalf = 4 * u;
      lp.screenW = W;
      lp.screenH = H;
      layoutBubble(lp, b.layout);
      b.layout.x = Math.round(b.layout.x / u) * u;
      b.layout.y = Math.round(b.layout.y / u) * u;
      b.origY = b.layout.y;
      b.layout.ax = ax;
      b.layout.tailPad = 7 * u;
      // Stacking may move a bubble away from its speaker, never onto them.
      b.layout.maxBottom = b.layout.below ? Infinity : Math.max(b.layout.y + b.layout.h, ay - lp.gap);
      b.layout.minTop = b.layout.below ? Math.min(b.layout.y, footY + lp.gap) : -Infinity;
      b.ax = ax;
      b.ay = b.layout.below ? footY : ay;
      vis.push(b);
    }
    vis.sort(byPriority);
    const rects = this._rects;
    rects.length = vis.length;
    for (let i = 0; i < vis.length; i++) rects[i] = vis[i].layout;
    stackRects(rects, vis.length, 2 * u, margin, H, W);
    // A bubble that slid sideways keeps its tail over the speaker.
    for (let i = 0; i < vis.length; i++) {
      const L = vis[i].layout;
      const lo = L.x + 7 * u;
      const hi = L.x + L.w - 7 * u;
      L.tailX = lo <= hi ? Math.min(hi, Math.max(lo, L.ax)) : L.x + L.w / 2;
    }
  }

  _drawBubble(ctx, b, r) {
    const a = this._alpha(b);
    if (a <= 0.01) return;
    const u = this.u;
    const L = b.layout;
    const s = speakerStyle(b.entity, b.kind);
    const top = b.tabH ? b.tabH - 2 * u : 0;
    const pop = this.game?.settings?.reduceMotion ? 1 : easeOutCubic(Math.min(1, b.t / 0.18));
    const lift = Math.round(((1 - pop) * 3 * u) / u) * u * (L.below ? -1 : 1);
    const x = L.x;
    const y = L.y + top + lift;
    const w = b.w;
    const h = b.h;
    const displaced = Math.abs(L.y - b.origY) > u;
    ctx.globalAlpha = a;

    if (b.kind === 'thought') this._drawCloud(ctx, b, x, y, s, r);
    else {
      this._box(ctx, x, y, w, h, u, OUTLINE, s.edge, s.fill);
      if (!displaced) this._tail(ctx, x, y, h, L.tailX, L.below, u, s);
      else this._leader(ctx, L.tailX, L.below ? y : y + h, b.ax, b.ay, u, s.edge);
    }

    // Text, typed out for speech; thoughts simply fade in.
    ctx.font = this.fonts[b.kind] || this.fonts.say;
    ctx.fillStyle = s.text;
    ctx.textAlign = 'left';
    const shown = b.kind === 'thought' ? b.joined.length : revealCount(b.joined, b.t, b.cps);
    let start = 0;
    const tx = x + this.padX + (b.kind === 'thought' ? 4 * u : 0);
    const ty = y + this.padY + (b.kind === 'thought' ? 4 * u : 0) + this.lineH / 2 + Math.round(u * 0.5);
    for (let i = 0; i < b.lines.length; i++) {
      const line = b.lines[i];
      const visible = shown - start;
      if (visible <= 0) break;
      ctx.fillText(visible >= line.length ? line : line.slice(0, visible), tx, ty + i * this.lineH);
      start += line.length + 1;
    }

    if (b.tabH) this._tab(ctx, x + 3 * u, y - top, b, s, u);
  }

  // Pixel frame: dark outline with notched corners, a colored inner edge, a fill.
  _box(ctx, x, y, w, h, u, outlineCol, edge, fill) {
    ctx.fillStyle = outlineCol;
    ctx.fillRect(x + u, y, w - 2 * u, h);
    ctx.fillRect(x, y + u, w, h - 2 * u);
    ctx.fillStyle = edge;
    ctx.fillRect(x + 2 * u, y + u, w - 4 * u, h - 2 * u);
    ctx.fillRect(x + u, y + 2 * u, w - 2 * u, h - 4 * u);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, h - 4 * u);
    // A faint lighter band under the top edge gives the panel a little depth.
    ctx.globalAlpha *= 0.35;
    ctx.fillStyle = edge;
    ctx.fillRect(x + 2 * u, y + 2 * u, w - 4 * u, u);
    ctx.globalAlpha /= 0.35;
  }

  _tail(ctx, x, y, h, tailX, below, u, s) {
    const col0 = x + Math.round((tailX - x) / u - 3.5) * u;
    for (let pass = 0; pass < 3; pass++) {
      const list = pass === 0 ? TAIL.O : pass === 1 ? TAIL.E : TAIL.F;
      ctx.fillStyle = pass === 0 ? OUTLINE : pass === 1 ? s.edge : s.fill;
      for (let k = 0; k < list.length; k += 2) {
        const cx = col0 + list[k] * u;
        const ry = list[k + 1];
        const py = below ? y + u - ry * u : y + h - 2 * u + ry * u;
        ctx.fillRect(cx, py, u, u);
      }
    }
  }

  // When a bubble had to move to avoid another, a dotted line still ties it to its speaker.
  _leader(ctx, fromX, fromY, toX, toY, u, color) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len < 3 * u) return;
    const steps = Math.min(40, Math.floor(len / (3 * u)));
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * 0.7;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = Math.round((fromX + dx * t) / u) * u;
      const py = Math.round((fromY + dy * t) / u) * u;
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(px - u, py - u, 3 * u, 3 * u);
      ctx.fillStyle = color;
      ctx.fillRect(px, py, u, u);
    }
    ctx.globalAlpha = prev;
  }

  _tab(ctx, x, y, b, s, u) {
    const w = b.tabW;
    const h = b.tabH;
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(x + u, y, w - 2 * u, h);
    ctx.fillRect(x, y + u, w, h - 2 * u);
    ctx.fillStyle = s.label;
    ctx.fillRect(x + u, y + u, w - 2 * u, h - 2 * u);
    ctx.font = this.fonts.label;
    ctx.fillStyle = '#1a1423';
    ctx.textAlign = 'left';
    ctx.fillText(b.label, x + 3 * u, y + h / 2 + Math.round(u * 0.5));
  }

  // Thought clouds are drawn at bubble-pixel resolution and cached per bubble.
  _drawCloud(ctx, b, x, y, s, r) {
    const u = this.u;
    if (!b.cloud) b.cloud = buildCloud(Math.round(b.w / u), Math.round(b.h / u), s.fill, s.edge);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(b.cloud, x, y, b.cloud.width * u, b.cloud.height * u);
    // Trailing puffs from the cloud down to the thinker's head.
    const L = b.layout;
    const fromX = L.tailX;
    const fromY = L.below ? y : y + b.h;
    const toX = b.ax;
    const toY = b.ay;
    for (let i = 0; i < 3; i++) {
      const t = 0.18 + i * 0.3;
      const px = Math.round((fromX + (toX - fromX) * t) / u) * u;
      const py = Math.round((fromY + (toY - fromY) * t + (L.below ? -u : u)) / u) * u;
      pixelDot(ctx, px, py, 2.2 - i * 0.6, u, OUTLINE, s.edge, s.fill);
    }
  }

  _drawIcons(ctx, r, W, H) {
    const atlas = this.game?.atlas;
    if (!atlas || !this.icons.length) return;
    const reduce = !!this.game?.settings?.reduceMotion;
    ctx.imageSmoothingEnabled = false;
    for (const ic of this.icons) {
      const e = ic.entity;
      const sprite = atlas.get(`fx:icon:${ic.name}`);
      let ax = this._dx(r, e.x);
      let ay = this._dy(r, e.y - headHeight(e) - (e.z || 0)) - 2 * r.scale;
      const bubble = this._bubbleFor(e);
      if (bubble) {
        // Perch on the bubble's top-right corner so both stay readable.
        ax = bubble.layout.x + bubble.w - 2 * this.u;
        ay = bubble.layout.y + 2 * this.u;
      }
      if (ax < -40 || ax > W + 40 || ay < -40 || ay > H + 80) continue;
      const t = ic.t;
      const fade = Math.min(1, (ic.life - t) / 0.25, t / 0.08);
      if (fade <= 0) continue;
      const k = reduce ? 1 : Math.max(0.05, easeOutBack(Math.min(1, t / 0.24)));
      const hop = reduce ? 0 : Math.exp(-t * 5) * Math.abs(Math.sin(t * 12)) * 4 + Math.sin(t * 3) * 0.6;
      ctx.globalAlpha = fade;
      if (sprite) {
        const fps = sprite.fps || 2;
        const frame = sprite.frames[Math.floor(t * fps) % sprite.frames.length];
        const s = r.scale * k;
        const dw = Math.round(sprite.w * s);
        const dh = Math.round(sprite.h * s);
        const dx = Math.round(ax - sprite.ox * s);
        const dy = Math.round(ay - sprite.oy * s - hop * r.scale);
        ctx.drawImage(frame, dx, dy, dw, dh);
      } else {
        ctx.font = this.fonts.shout;
        ctx.textAlign = 'center';
        ctx.lineWidth = 2 * this.u;
        ctx.strokeStyle = OUTLINE;
        ctx.fillStyle = UI.text;
        const label = ic.name === 'heart' ? '♥' : ic.name === 'note' ? '♪' : ic.name;
        ctx.strokeText(label, ax, ay - 8 * r.scale);
        ctx.fillText(label, ax, ay - 8 * r.scale);
      }
    }
    ctx.globalAlpha = 1;
  }

  _bubbleFor(e) {
    for (let i = 0; i < this._vis.length; i++) if (this._vis[i].entity === e) return this._vis[i];
    return null;
  }

  _drawNumbers(ctx, r, W, H) {
    let any = false;
    for (const n of this.numbers) if (n.active) any = true;
    if (!any) return;
    ctx.font = this.fonts.number;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, 2 * this.u);
    ctx.strokeStyle = OUTLINE;
    for (const n of this.numbers) {
      if (!n.active) continue;
      const dx = Math.round(this._dx(r, n.x));
      const dy = Math.round(this._dy(r, n.y));
      if (dx < -60 || dx > W + 60 || dy < -60 || dy > H + 60) continue;
      const pop = n.t < 0.1 ? 1 + (1 - n.t / 0.1) * 0.6 : 1;
      const k = n.scale * pop;
      const fade = n.t > n.life * 0.6 ? 1 - (n.t - n.life * 0.6) / (n.life * 0.4) : 1;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.setTransform(k, 0, 0, k, dx, dy);
      ctx.strokeText(n.text, 0, 0);
      ctx.fillStyle = n.fill;
      ctx.fillText(n.text, 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Names float over villagers the player is standing near.
  _drawNameTags(ctx, r) {
    const g = this.game;
    const p = g.player;
    const list = g.entities?.all?.();
    if (!p || !list) return;
    const u = this.u;
    ctx.font = this.fonts.label;
    ctx.textAlign = 'center';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed || e === p || e.id === COMPANION_ID || !(e.profile || e.role) || !e.name) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > NAME_TAG_RANGE) continue;
      if (this.hasBubble(e)) continue;
      const a = 1 - Math.max(0, Math.min(1, (d - 30) / (NAME_TAG_RANGE - 30)));
      if (a <= 0.02) continue;
      let tw = this._tagWidths.get(e.name);
      if (tw === undefined) {
        tw = ctx.measureText(e.name).width;
        this._tagWidths.set(e.name, tw);
      }
      const cx = Math.round(this._dx(r, e.x));
      const cy = Math.round(this._dy(r, e.y - headHeight(e) - (e.z || 0)) - 5 * r.scale);
      const w = Math.ceil((tw + 6 * u) / u) * u;
      const h = Math.ceil((this.labelPx + 3 * u) / u) * u;
      const x = cx - Math.round(w / 2 / u) * u;
      const y = cy - h;
      ctx.globalAlpha = a * 0.82;
      ctx.fillStyle = '#120e20';
      ctx.fillRect(x + u, y, w - 2 * u, h);
      ctx.fillRect(x, y + u, w, h - 2 * u);
      ctx.globalAlpha = a;
      ctx.fillStyle = e.faction === 'guard' ? '#cfd4dc' : UI.text;
      ctx.fillText(e.name, cx, y + h / 2 + Math.round(u * 0.5));
    }
    ctx.globalAlpha = 1;
  }

  // When Lyra is off screen, a small badge on the edge points toward her.
  _drawCompanionMarker(ctx, r, W, H) {
    const c = this.game?.companion;
    if (!c || c.removed) return;
    const hx = this._dx(r, c.x);
    const hy = this._dy(r, c.y - 12);
    const pad = 6 * r.scale;
    if (hx > -pad && hx < W + pad && hy > -pad - 12 * r.scale && hy < H + pad) return;
    const dpr = r.dpr || 1;
    const u = this.u;
    const S = Math.round((30 * dpr) / u) * u;
    const inset = S / 2 + 8 * u;
    const ep = edgePoint(hx, hy, W, H, inset, this._edge);
    const downed = !!(c.downed || c.state === 'downed');
    const t = this._time;
    const pulse = 0.5 + 0.5 * Math.sin(t * (downed ? 7 : 3));
    const edge = downed ? UI.danger : UI.arcane;
    const bx = Math.round((ep.x - S / 2) / u) * u;
    const by = Math.round((ep.y - S / 2) / u) * u;
    ctx.globalAlpha = 0.88 + 0.12 * pulse;
    this._box(ctx, bx, by, S, S, u, OUTLINE, edge, '#1c1730');
    const pic = this._lyraPortrait();
    if (pic) {
      const inner = S - 4 * u;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(pic, 0, 0, pic.width, pic.height, bx + 2 * u, by + 2 * u, inner, inner);
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.font = this.fonts.shout;
      ctx.textAlign = 'center';
      ctx.fillStyle = edge;
      ctx.fillText((c.name || 'L')[0], bx + S / 2, by + S / 2 + u);
    }
    // Arrow just outside the badge, pointing at her.
    const ca = Math.cos(ep.angle);
    const sa = Math.sin(ep.angle);
    const R = S / 2 + 2 * u + pulse * u;
    const tipX = ep.x + ca * (R + 4 * u);
    const tipY = ep.y + sa * (R + 4 * u);
    const baseX = ep.x + ca * R;
    const baseY = ep.y + sa * R;
    const wx = -sa * 3 * u;
    const wy = ca * 3 * u;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + wx, baseY + wy);
    ctx.lineTo(baseX - wx, baseY - wy);
    ctx.closePath();
    ctx.lineWidth = 2 * u;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = edge;
    ctx.fill();
    // Her name under the badge (above it when the badge sits on the bottom edge).
    const name = c.name || 'Lyra';
    ctx.font = this.fonts.label;
    ctx.textAlign = 'center';
    const ny = ep.y > H / 2 ? by - this.labelPx * 0.7 : by + S + this.labelPx * 0.8;
    ctx.lineWidth = Math.max(2, 2 * u);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(name, bx + S / 2, ny);
    ctx.fillStyle = edge;
    ctx.fillText(name, bx + S / 2, ny);
    ctx.globalAlpha = 1;
  }

  _lyraPortrait() {
    if (this._portrait !== undefined) return this._portrait;
    let pic = null;
    try {
      const p = portrait(this.game.atlas, COMPANION_ID, 'neutral');
      if (p && p.width > 0 && p.height > 0) pic = p;
    } catch {
      pic = null;
    }
    this._portrait = pic;
    return pic;
  }
}

// A round puff of radius `R` bubble pixels centered on (x, y), outlined.
function pixelDot(ctx, x, y, R, u, outlineCol, edge, fill) {
  const rr = Math.ceil(R + 1);
  for (let j = -rr; j <= rr; j++) {
    for (let i = -rr; i <= rr; i++) {
      const d = Math.hypot(i, j);
      if (d > R + 1) continue;
      ctx.fillStyle = d > R ? outlineCol : d > R - 0.8 ? edge : fill;
      ctx.fillRect(x + i * u, y + j * u, u, u);
    }
  }
}

// Inside test for the thought cloud (in bubble pixels), shrunk by `s`: a rounded body
// ringed with big round lobes of alternating size, evenly spaced along each edge.
const LOBE_R = 6;
const LOBE_INSET = 6.5;
const LOBE_STEP = 10;
function inLobe(x, y, cx, cy, r) {
  return r > 0 && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}
function inCloud(x, y, w, h, s = 0) {
  const x0 = LOBE_INSET + s;
  const y0 = LOBE_INSET + s;
  const x1 = w - 1 - LOBE_INSET - s;
  const y1 = h - 1 - LOBE_INSET - s;
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  const top = LOBE_INSET;
  const bottom = h - 1 - LOBE_INSET;
  const left = LOBE_INSET;
  const right = w - 1 - LOBE_INSET;
  const nx = Math.max(2, Math.round((right - left) / LOBE_STEP));
  for (let k = 0; k <= nx; k++) {
    const r = LOBE_R * (k % 2 ? 0.78 : 1) - s;
    const cx = left + ((right - left) * k) / nx;
    if (inLobe(x, y, cx, top, r) || inLobe(x, y, cx, bottom, r)) return true;
  }
  const ny = Math.max(1, Math.round((bottom - top) / LOBE_STEP));
  for (let k = 1; k < ny; k++) {
    const r = LOBE_R * (k % 2 ? 0.78 : 1) - s;
    const cy = top + ((bottom - top) * k) / ny;
    if (inLobe(x, y, left, cy, r) || inLobe(x, y, right, cy, r)) return true;
  }
  return false;
}

function buildCloud(w, h, fill, edge) {
  const c = document.createElement('canvas');
  const W = (c.width = Math.max(4, w));
  const H = (c.height = Math.max(4, h));
  const g = c.getContext('2d');
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inCloud(x, y, W, H, 0)) mask[y * W + x] = 1;
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y)) {
        // A one-pixel colored rim just inside the silhouette, then the dark outline outside it.
        g.fillStyle = at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1) ? fill : edge;
        g.fillRect(x, y, 1, 1);
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        g.fillStyle = OUTLINE;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}
