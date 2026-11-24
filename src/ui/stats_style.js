import { SHAPE_GLYPHS } from './weave_icons.js';

// Styles for the character sheet, Bram's forge, the Spellbook's prices and the HUD's
// gain/cost timers (DESIGN §25–26). Injected once, the first time any of them shows,
// so the shared stylesheet stays untouched by this module.

const STYLE_ID = 'hl-stats-style';

const CSS = `
.panel-character .panel-body, .panel-forge .panel-body { padding: 12px 14px 16px; }
.chs { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .chs { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); } .chs-wide { grid-column: 1 / -1; } }
.chs-box { background: rgba(10, 9, 25, 0.42); border: 1px solid var(--line-dim); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.chs-box > h3 { font-family: var(--font-display); font-size: 15px; letter-spacing: .02em; color: var(--parch-2); margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
.chs-box > h3 .chs-h-note { margin-left: auto; font-family: var(--font-body); font-size: 13px; color: var(--parch-faint); font-weight: 400; }
.chs-hero { display: flex; align-items: center; gap: 12px; }
.chs-lv { flex: none; width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 35% 30%, #3a3170, #16143a 70%); border: 2px solid var(--ember); box-shadow: 0 0 14px rgba(255, 176, 71, .25) inset, 0 0 8px rgba(255, 176, 71, .2); font-family: var(--font-display); color: var(--ember-hot); line-height: 1; text-align: center; }
.chs-lv b { display: block; font-family: var(--font-body); font-weight: 800; font-size: 24px; }
.chs-lv small { display: block; font-size: 10px; color: var(--parch-dim); letter-spacing: .08em; }
.chs-hero-main { flex: 1; min-width: 0; }
.chs-name { font-family: var(--font-display); font-size: 18px; color: var(--parch); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chs-xp { height: 8px; border-radius: 4px; background: #0b0a1e; border: 1px solid var(--line-dim); overflow: hidden; margin: 6px 0 4px; }
.chs-xp i { display: block; height: 100%; background: linear-gradient(90deg, #b8862a, var(--gold)); }
.chs-xp-text { font-size: 13px; color: var(--parch-dim); }
.chs-points { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 14px; font-weight: 700; color: #1a1206; background: linear-gradient(180deg, var(--ember-hot), var(--ember)); box-shadow: 0 0 10px rgba(255, 176, 71, .45); }
.chs-points[hidden] { display: none; }
.chs-attrs { display: grid; gap: 6px; margin-top: 10px; }
.chs-attr { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto 44px; align-items: center; gap: 10px; padding: 4px 0; }
.chs-attr-bar { align-self: stretch; border-radius: 3px; background: var(--ac, #888); }
.chs-attr-name { font-family: var(--font-display); font-size: 16px; color: var(--parch); }
.chs-attr-line { font-size: 13px; color: var(--parch-faint); line-height: 1.2; }
.chs-attr-n { font-family: var(--font-display); font-size: 20px; color: var(--ac, var(--parch)); min-width: 26px; text-align: right; }
.chs-plus { width: 44px; height: 44px; border-radius: 10px; font-size: 24px; line-height: 1; padding: 0; display: grid; place-items: center; }
.chs-plus:disabled { opacity: .28; }
.chs-respec { font-size: 13px; color: var(--parch-faint); margin: 8px 0 0; }
.chs-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.chs-slot { position: relative; display: grid; grid-template-rows: auto auto auto; justify-items: center; gap: 2px; padding: 8px 4px 7px; min-height: 92px; border-radius: 10px; background: rgba(36, 40, 89, .55); border: 1px solid var(--line-soft); color: var(--parch); cursor: pointer; text-align: center; }
.chs-slot:hover { border-color: var(--line); }
.chs-slot.on { border-color: var(--ember); box-shadow: 0 0 0 1px var(--ember) inset, 0 0 12px rgba(255, 176, 71, .25); }
.chs-slot.empty .chs-slot-img { opacity: .2; filter: grayscale(1); }
.chs-slot-img { width: 36px; height: 36px; image-rendering: pixelated; }
.chs-slot-label { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--parch-faint); }
.chs-slot-name { font-size: 13px; line-height: 1.15; max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.chs-up { position: absolute; top: 4px; right: 6px; font-family: var(--font-display); font-size: 12px; color: var(--ember-hot); }
.chs-pick { margin-top: 10px; display: grid; gap: 6px; }
.chs-pick-head { font-size: 13px; color: var(--parch-dim); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chs-pick-head .btn { margin-left: auto; }
.chs-cand { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; background: rgba(19, 18, 50, .7); border: 1px solid var(--line-dim); }
.chs-cand img { width: 32px; height: 32px; image-rendering: pixelated; }
.chs-cand-name { font-size: 15px; font-weight: 700; }
.chs-deltas { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.chs-delta { font-size: 12px; padding: 1px 6px; border-radius: 6px; background: rgba(88, 207, 143, .14); color: #8ff0b8; white-space: nowrap; }
.chs-delta.worse { background: rgba(255, 107, 94, .14); color: #ff9a8e; }
.chs-empty { font-size: 13px; color: var(--parch-faint); }
.chs-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 6px 10px; }
.chs-stat { display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 6px; background: rgba(19, 18, 50, .55); font-size: 14px; }
.chs-stat span { color: var(--parch-dim); }
.chs-stat b { font-family: var(--font-display); font-weight: 400; color: var(--parch); }
.chs-stat.up b { color: #8ff0b8; }
.chs-stat.down b { color: #ff9a8e; }
.chs-effects { display: flex; flex-wrap: wrap; gap: 6px; }
.chs-eff { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px; font-size: 13px; border: 1px solid rgba(88, 207, 143, .5); background: rgba(88, 207, 143, .1); color: #bff5d6; }
.chs-eff.cost, .chs-eff.weak { border-color: rgba(255, 107, 94, .6); background: rgba(255, 107, 94, .12); color: #ffb3aa; }
.chs-eff .num { color: var(--parch-dim); }
.rar-common { color: #e2d9c6; } .rar-uncommon { color: #7fe39c; } .rar-rare { color: #84b6ff; } .rar-epic { color: #d3a2ff; } .rar-legendary { color: #ffbe5c; }
.rar-bd-common { border-color: rgba(207, 198, 180, .45) !important; } .rar-bd-uncommon { border-color: rgba(111, 208, 140, .7) !important; } .rar-bd-rare { border-color: rgba(111, 168, 255, .75) !important; } .rar-bd-epic { border-color: rgba(197, 140, 255, .8) !important; } .rar-bd-legendary { border-color: rgba(255, 176, 71, .9) !important; }
/* Bram's forge */
.fg-tabs { margin-bottom: 10px; }
.fg-list { display: grid; gap: 8px; }
.fg-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: rgba(19, 18, 50, .7); border: 1px solid var(--line-dim); }
.fg-row img { width: 36px; height: 36px; image-rendering: pixelated; }
.fg-name { font-size: 16px; font-weight: 700; }
.fg-sub { font-size: 13px; color: var(--parch-dim); }
.fg-costs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.fg-cost { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; padding: 1px 6px; border-radius: 6px; background: rgba(36, 40, 89, .8); color: var(--parch); }
.fg-cost img { width: 16px; height: 16px; }
.fg-cost.short { color: #ff9a8e; background: rgba(255, 107, 94, .14); }
.fg-why { font-size: 13px; color: var(--parch-faint); font-style: italic; }
.fg-pips { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: middle; }
.fg-pips i { width: 7px; height: 7px; border-radius: 2px; background: #2a2a55; border: 1px solid var(--line-dim); }
.fg-pips i.on { background: var(--ember); border-color: var(--ember-hot); }
.fg-act .btn { min-height: 44px; }
.fg-bram { font-size: 14px; color: var(--parch-dim); font-style: italic; margin: 0 0 10px; }
/* Spellbook prices */
.sb-sec-prices .sb-tile { --tc: #ff6b5e; }
.sb-sec-prices .sb-tile.on { box-shadow: 0 0 0 2px #ff5a5a inset, 0 0 12px rgba(255, 90, 90, .35); }
.sb-price-glyph { width: 30px; height: 30px; display: grid; place-items: center; font-size: 20px; border-radius: 50%; color: #1a0606; background: radial-gradient(circle at 35% 30%, #fff, var(--pc, #ff5a5a) 60%, #3a0a0a); }
.sb-tile.locked .sb-price-glyph { filter: grayscale(1) brightness(.4); }
.sb-price-line { margin: 6px 0 0; font-size: 14px; line-height: 1.3; }
.sb-price-line .gain { color: #8ff0b8; }
.sb-price-line .cost { color: #ff7d70; font-weight: 700; }
.sb-stat-price .sb-stat-value { color: #ff7d70; font-size: 12px; overflow-wrap: anywhere; }
.hb-price, .wbtn-price { position: absolute; top: 2px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, var(--pc, #ff5a5a) 60%, #3a0a0a); box-shadow: 0 0 6px var(--pc, #ff5a5a); pointer-events: none; }
/* HUD timers */
.buff-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; pointer-events: auto; }
.buff-row:empty { display: none; }
.buff { position: relative; display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px 0 3px; border-radius: 11px; font-size: 11px; line-height: 1; color: var(--parch); background: rgba(10, 9, 25, .78); border: 1px solid rgba(88, 207, 143, .7); cursor: pointer; }
.buff.cost, .buff.weak { border-color: rgba(255, 107, 94, .85); color: #ffc4bc; }
.buff.cost .buff-dot { animation: buff-throb 1.2s ease-in-out infinite; }
.buff-dot { width: 15px; height: 15px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, var(--pc, #58cf8f) 62%, rgba(0,0,0,.6)); flex: none; font-size: 9px; line-height: 15px; text-align: center; color: #1a0606; font-weight: 700; }
.buff .num { min-width: 16px; text-align: right; }
@keyframes buff-throb { 50% { transform: scale(.82); } }
.player-card { position: relative; }
.card-points { position: absolute; top: -7px; left: 14px; z-index: 2; padding: 1px 6px; border-radius: 8px; font-size: 11px; line-height: 14px; font-weight: 700; color: #1a1206; background: var(--ember); box-shadow: 0 0 8px rgba(255, 176, 71, .6); pointer-events: none; }
@media (max-width: 640px), (max-height: 520px) {
  .buff-row { flex-wrap: nowrap; overflow: hidden; gap: 3px; margin-top: 3px; max-width: 100%; }
  .buff { height: 18px; font-size: 10px; padding: 0 4px 0 2px; }
  .buff-dot { width: 13px; height: 13px; line-height: 13px; font-size: 8px; }
  .panel-character .panel-foot, .panel-forge .panel-foot .sb-foot-note { display: none; }
  .chs-attr { padding: 1px 0; }
  .chs-lv { width: 50px; height: 50px; }
}
@media (max-height: 520px) {
  .panel-character .panel-body, .panel-forge .panel-body { padding: 8px 10px 10px; }
  .chs-attrs { gap: 2px; margin-top: 6px; }
}
.card-points[hidden] { display: none; }
.player-card.tappable { cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .buff.cost .buff-dot { animation: none; } }
`;

export function ensureStatsStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

// One glyph per price, drawn as text (they read at 12 px on a hotbar button).
export const PRICE_GLYPH = { bloodprice: '♥', berserk: '✸', glass: '◇', overdraw: '∞', emberblood: '♨', lastlight: '✦', oath: '⚭' };

// Where each price is found, for the Spellbook's locked tiles (never a hidden truth).
export const PRICE_HINTS = {
  bloodprice: 'Greyjaw carries it, deep in Whisperwood at dusk.',
  berserk: 'Varek One-Eye carries it, at the bandit camp above the fork.',
  glass: "The Lake's Hum keeps it, in the middle of Mirror Lake.",
  overdraw: 'The Bone Warden holds it, in the lower hall of the Sunken Ruins.',
  emberblood: 'Bram knows something about blood and forge-heat. Ask at the smithy.',
  lastlight: 'Sister Aveline keeps a light for the last dark. Ask at the chapel.',
  oath: 'Something Lyra would only give someone she trusts.',
};

// A glyph for the self-cast surge shape (the Spellbook's tiles and the hotbar).
SHAPE_GLYPHS.surge = SHAPE_GLYPHS.surge || [
  '....kkk....',
  '...ksssk...',
  '..kscccsk..',
  '...kcgck...',
  '.k.kcgck.k.',
  'kgk.kgk.kgk',
  'kgdk.k.kdgk',
  '.kddkkkddk.',
  '..kdddddk..',
  '...kkkkk...',
];

export function fmtSeconds(sec) {
  const s = Math.max(0, Math.ceil(sec || 0));
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${s}`;
}
