// Price play-test (round 14b polish; DESIGN §25): every price chosen in the Spellbook, played
// by the real runtime (magic.js, prices.js, the stat pipeline, combat) in the Weave's test
// arena, the way a player at level 1 fights: a bolt at a foe whenever it is ready and there
// is mana for it, and one sword blow a second when berserk makes the sword worth it, while
// the foes hit back a steady 2 damage every 1.5 s (a long fight you can just survive). Printed per price, next to a fight with
// no price at all:
//   - damage dealt in the first 15 s, 30 s and 60 s (and how much more than no price);
//   - casts made, mana at the end, seconds with an empty well;
//   - health lost, the lowest health, whether (and when) you fell;
//   - the price's own after-effects (max health, the drought, the heart).
// Overdraw is also played the way a player would try to dodge its drought (casting it again
// as the drought starts). Pure numbers; no browser.
//
//   node scripts/price_sim.mjs            the table
//   node scripts/price_sim.mjs --json     the numbers as JSON
import { makeGame, step as magicStep, resetArena } from '../tests/magic_helpers.mjs';
import { installProgression } from '../src/progression/index.js';

const JSON_OUT = process.argv.includes('--json');
const HIT = 2; // the foes' blow
const HIT_EVERY = 1.5; // seconds

function arena() {
  const g = makeGame({ foes: 3, foeHp: 1e7 });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  g.magic.unlockAll();
  const P = g.player;
  P.falls = [];
  P.fall = (o) => {
    P.falls.push({ t: g.time, ...o });
    P.hp = 0;
    P.downed = true;
    return true;
  };
  g.ui = { toast() {}, confirm: null };
  resetArena(g);
  g.prices.deserialize(null);
  P.hp = P.maxHp;
  return g;
}

function play(price, { seconds = 60, recastOverdraw = false, sword = false, takeHits = true } = {}) {
  const g = arena();
  const P = g.player;
  const m = g.magic;
  const foe = g.foes[0];
  const home = { x: foe.x, y: foe.y };
  let dealt = 0;
  const marks = {};
  g.bus.on('damage', (p) => {
    if (p?.source === P && g.foes.includes(p.target) && p.amount > 0) dealt += p.amount;
  });
  const start = { maxHp: P.maxHp, mana: m.mana.max };
  // The weave that pays the price is cast first; then plain bolts (the Spellbook's other slot).
  const priced = { shape: 'bolt', essences: ['fire'], twists: [], prices: price ? [price] : [] };
  const plain = { shape: 'bolt', essences: ['fire'], twists: [] };
  let casts = 0;
  let dry = 0;
  let lowest = P.hp;
  let nextHit = HIT_EVERY;
  let nextSwing = 0;
  let paidOnce = false;
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * dt;
    if (!P.downed && !P.dead) {
      // Pay the price once at the start (and again whenever its gain has run out, for the
      // ones that refresh), the way a player keeps a priced weave going.
      const wantPriced = price && (!paidOnce || (price !== 'berserk' && price !== 'lastlight' && price !== 'overdraw' && price !== 'emberblood' && !g.prices.active(P, price, 'gain')));
      const w = wantPriced ? priced : plain;
      const r = m.cast(P, w, { x: foe.x, y: foe.y - 8, target: foe });
      if (r?.ok) {
        casts++;
        if (w === priced) paidOnce = true;
      }
      if (recastOverdraw && price === 'overdraw' && g.prices.state.overdraw && g.prices.state.overdraw.gain <= 0 && !marks.recast) {
        marks.recast = t;
        m.resetCooldowns?.();
        m.cast(P, priced, { x: foe.x, y: foe.y - 8, target: foe });
      }
      if (sword && t >= nextSwing) {
        nextSwing = t + 1;
        const atk = g.stats.get(P, 'atk');
        g.combat.damage(P, foe, Math.max(1, atk), { kind: 'melee' });
      }
    }
    if (m.mana.cur < 8) dry += dt;
    if (takeHits && t >= nextHit) {
      nextHit += HIT_EVERY;
      if (!P.downed && !P.dead) {
        P.invuln = 0;
        g.combat.damage(foe, P, HIT, { kind: 'melee', knockback: 0 });
      }
    }
    // The foe stands its ground (a knock does not carry it out of the bolts' way).
    foe.x = home.x;
    foe.y = home.y;
    foe.knock.x = foe.knock.y = 0;
    magicStep(g, dt);
    g.stats.update(dt);
    g.prices.update(dt);
    lowest = Math.min(lowest, P.hp);
    if ((P.downed || P.dead) && marks.down == null) marks.down = t;
    if (Math.abs(t - 15) < dt / 2) marks.d15 = Math.round(dealt);
    if (Math.abs(t - 30) < dt / 2) marks.d30 = Math.round(dealt);
  }
  return {
    price: price || '(none)',
    d15: marks.d15,
    d30: marks.d30,
    d60: Math.round(dealt),
    casts,
    manaEnd: Math.round(m.mana.cur),
    dry: Math.round(dry),
    hpStart: start.maxHp,
    hpEnd: Math.round(P.hp),
    maxHpEnd: P.maxHp,
    lowest: Math.round(lowest),
    fell: P.falls.length ? `fell at ${P.falls[0].t.toFixed(0)} s (${P.falls[0].cause})` : marks.down != null ? `down at ${marks.down.toFixed(0)} s` : '',
    regenEnd: g.stats.get(P, 'manaRegen'),
    drought: g.prices.state.overdraw ? Math.round(g.prices.state.overdraw.cost) : 0,
    recast: marks.recast != null ? `recast at ${marks.recast.toFixed(1)} s` : '',
  };
}

const rows = [];
const base = play(null);
rows.push(base);
for (const id of ['bloodprice', 'glass', 'overdraw', 'emberblood', 'lastlight', 'oath']) rows.push(play(id));
rows.push({ ...play('overdraw', { recastOverdraw: true }), price: 'overdraw, recast' });
// Berserk is a sword price (strength x2): the sword swings once a second here.
const swordBase = play(null, { seconds: 150, sword: true });
rows.push({ ...swordBase, price: '(none), sword' });
rows.push({ ...play('berserk', { seconds: 150, sword: true }), price: 'berserk, sword' });

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const pct = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
  console.log('price               dmg15  dmg30  dmg60 (vs none)   casts mana dry  hp end/max low  notes');
  for (const r of rows) {
    const ref = r.price.includes('sword') ? swordBase : base;
    console.log(
      `${r.price.padEnd(18)} ${String(r.d15).padStart(6)} ${String(r.d30).padStart(6)} ${String(r.d60).padStart(6)} ${pct(r.d60, ref.d60).padStart(6)}   ${String(r.casts).padStart(5)} ${String(r.manaEnd).padStart(4)} ${String(r.dry).padStart(3)}  ${String(r.hpEnd).padStart(3)}/${String(r.maxHpEnd).padEnd(3)} ${String(r.lowest).padStart(3)}  ${[r.fell, r.recast, r.drought ? `drought ${r.drought} s left` : '', r.regenEnd === 0 ? 'no regen' : ''].filter(Boolean).join('; ')}`,
    );
  }
}
