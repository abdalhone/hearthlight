import { defineRegistry } from './registry.js';
import { Shapes } from './shapes.js';
import { STATUS_POTENCY } from './balance.js';
import { holderOf } from '../core/party.js';

// PRICES: power with a cost (DESIGN §25) — the Weave's fourth family. A price rides on
// any weave exactly like a twist (registry entries, compiled into the plan, hooks
// allowed), and every cast of that weave pays it: a GAIN and a COST, both timed
// modifiers on the shared stat pipeline (src/core/stats.js). The runtime (`game.prices`)
// owns what a modifier cannot: berserk's end (the heart gives out: player.fall({ window:
// 30, cause: 'berserk' })), lastlight's once-per-sleep save, emberblood's burn, oath's
// tie to Lyra, and the last stand (armed after a confirm; when you would die you rise for
// a minute, burning, and then you die for good: game.survival.burnOut).
//
// Entry format (get() fills the rest):
// {
//   id, name, adj ('Blood-bought': name fragment), color, glyph,
//   gain: { label, seconds, add, pct, mul },        null = no timed gain
//   cost: { label, seconds, add, pct, mul },        seconds null = until it is lifted
//   gainText, costText (the red line), sentence (the Spellbook's words), lyra (her notice),
//   refresh: true (a new cast restarts the timers) | false (it runs its course),
//   onCast(rt, caster, plan), onPlan(plan), and any of the twist hooks.
// }
// Surge (a self-cast shape registered here) lets essences choose what a weave empowers.

export const PRICE_SLOTS = 1; // prices a weave may carry

// Played and balanced in round 14b (scripts/price_sim.mjs: each price in a long fight at
// level 1, next to no price at all). The author's own numbers stay as said (bloodprice's
// +20% for 15 s against −40% health for 2 min; berserk's strength ×2 and the heart; the
// last stand's minute). Changed: overdraw's drought is 20 s, not 30 (at 30 it cost more
// than twice what it gave in any fight past twenty seconds), and casting it again no
// longer lifts it; emberblood's weaves also cost 30% less mana (the blood pays part), since
// a faster cast gives nothing to a caster whose well, not cooldown, is the limit, and the
// burn alone made it a pure loss.

// Each percentage in a price's words says what it is a share of (DESIGN §26, §39: Version 12):
// a number the sheet shows as a % (weave power, crit) is "+50% of your weave power", a share
// of yours, never fifty more points of it; a speed is a share of your normal pace
// (tests/v12_verify_read.test.mjs holds every price to it).
export const PRICES = {
  bloodprice: {
    name: 'Bloodprice',
    adj: 'Blood-bought',
    color: '#ff5a5a',
    gain: { label: '+20% damage', seconds: 15, pct: { dmgDealt: 0.2 } },
    cost: { label: 'Max health −40%', seconds: 120, mul: { maxHp: 0.6 } },
    gainText: '+20% damage for 15 s',
    costText: 'max health −40% for 2 min',
    sentence: 'Paid in blood: it hits harder for a while, and your body is smaller for longer.',
    lyra: 'You paid for that with your own blood. I saw it go out of you.',
    refresh: true,
  },
  berserk: {
    name: 'Berserk',
    adj: 'Berserk',
    color: '#ff3b2f',
    gain: { label: 'Berserk: strength ×2, +40% speed', seconds: 120, mul: { atk: 2 }, pct: { speed: 0.4, swing: 0.5, castSpeed: 0.4 }, add: { poise: 1 } },
    cost: { label: 'Your heart gives out when it ends', seconds: null },
    gainText: 'strength ×2, +40% speed (of your normal pace), faster swings and casts, no stagger for 2 min',
    costText: 'when it ends your heart gives out: you fall, with 30 s to be saved',
    sentence: 'The last measure. Two minutes of everything, and then nothing.',
    lyra: "Stop. Stop! That isn't strength, that's your heart burning down.",
    refresh: false,
  },
  glass: {
    name: 'Glass',
    adj: 'Glass',
    color: '#bfe6ff',
    gain: { label: '+50% of your weave power', seconds: 30, pct: { spellPower: 0.5 } },
    cost: { label: 'Take +50% damage', seconds: 30, mul: { dmgTaken: 1.5 } },
    gainText: '+50% of your weave power for 30 s',
    costText: 'you take +50% damage for 30 s',
    sentence: 'You turn to glass: everything you weave cuts deeper, and everything cuts you.',
    lyra: 'You look like you would break if I touched you. Be careful.',
    refresh: true,
  },
  overdraw: {
    name: 'Overdraw',
    adj: 'Overdrawn',
    color: '#9a7dff',
    gain: { label: 'Weaves cost no mana', seconds: 10, mul: { manaCost: 0 } },
    cost: { label: 'No mana regeneration', seconds: 20, mul: { manaRegen: 0 } },
    gainText: 'weaves cost no mana for 10 s',
    costText: 'then no mana comes back for 20 s (casting it again does not lift the drought)',
    sentence: 'Borrowed weave: free for ten breaths, then the well runs dry.',
    lyra: "You're spending light you don't have. It'll want paying back.",
    refresh: false,
  },
  emberblood: {
    name: 'Emberblood',
    adj: 'Emberblood',
    color: '#ff8a3a',
    gain: { label: 'Emberblood: cast 30% faster, weaves cost 30% less', seconds: null, pct: { castSpeed: 0.3 }, mul: { manaCost: 0.7 } },
    cost: { label: 'Lose 2% of max health a second', seconds: null },
    gainText: 'cast 30% faster and weaves cost 30% less mana while it burns',
    costText: 'lose 2% of your max health every second until you douse it',
    sentence: 'Your blood runs hot as a forge: weaves leave your hands faster, your blood paying part of each, while it burns you.',
    lyra: "Your hands are smoking. Put it out. Please put it out.",
    toggle: true,
    refresh: true,
  },
  lastlight: {
    name: 'Lastlight',
    adj: 'Lastlight',
    color: '#ffe08a',
    gain: { label: 'Lastlight held', seconds: null },
    cost: { label: 'Max health −50% until you sleep', seconds: null, mul: { maxHp: 0.5 } },
    gainText: 'the next time you would fall, you rise whole instead (once per sleep)',
    costText: 'when it saves you, max health −50% until you next sleep',
    sentence: 'A light kept back for the last dark. It holds a wound shut once; it cannot restart a heart.',
    lyra: "Whatever you just held back, I hope you never need it.",
    refresh: false,
  },
  // The last stand (round 14: "if I die, maybe I come back for 1 minute and kill anybody,
  // but it will not let me live anymore"). Held like lastlight until it is needed; the
  // Bone Warden carries it. Order when you fall: lastlight first (it holds the wound shut),
  // then the last stand (you may rise at once, or it rises you when the window closes).
  laststand: {
    name: 'Last Stand',
    adj: 'Doomed',
    color: '#ff5a1f',
    gain: { label: 'Last Stand held', seconds: null },
    cost: { label: 'You die for good when it ends', seconds: null },
    gainText: 'when you would die, you rise for one minute, burning: strength ×2.5, weaves twice as strong, faster, unafraid, nothing can put you down',
    costText: 'when the minute ends you die for good: no kept flame, no rescue, no waking at home. Your story ends',
    sentence: 'You become your own pyre: one minute of everything you are, and then nothing ever again.',
    lyra: "No. Not that. Whatever you just took into you, put it back. I won't watch you burn.",
    refresh: false,
    confirm: true,
  },
  oath: {
    name: 'Oath',
    adj: 'Oathbound',
    color: '#c9a6ff',
    gain: { label: 'Oath: +30% of your sword, weaves, armor, crit, +10% speed near your companion', seconds: 45 },
    cost: { label: 'When your companion is hurt, so are you', seconds: 45 },
    gainText: '+30% of your strength, weave power, armor and crit chance, +10% speed (of your normal pace) and casting, while your companion is near (45 s)',
    costText: 'whatever hurts your companion hurts you too',
    sentence: 'Sworn to whoever walks with you: stronger at their side, and their wounds are yours.',
    lyra: "I felt that. Like a thread pulled tight between us. ...Don't make me regret it.",
    refresh: true,
  },
};

const MOD_KEYS = ['add', 'pct', 'mul'];

function fillPart(p) {
  if (!p) return null;
  const out = { label: p.label || '', seconds: Number.isFinite(p.seconds) ? p.seconds : null };
  for (const k of MOD_KEYS) if (p[k]) out[k] = { ...p[k] };
  return out;
}

function fillPrice(raw, id) {
  const name = raw.name || id.charAt(0).toUpperCase() + id.slice(1);
  return {
    ...raw,
    name,
    adj: raw.adj || name,
    color: raw.color || '#ff5a5a',
    gain: fillPart(raw.gain),
    cost: fillPart(raw.cost),
    gainText: raw.gainText || raw.gain?.label || '',
    costText: raw.costText || raw.cost?.label || '',
    sentence: raw.sentence || '',
    refresh: raw.refresh !== false,
    toggle: !!raw.toggle,
  };
}

export const Prices = defineRegistry('price', PRICES, fillPrice);
export const getPrice = (id) => Prices.get(id);
export const priceIds = () => Prices.ids();

// The words a plan carries for its prices (Spellbook, tooltips).
export function priceLines(plan) {
  const out = [];
  for (const d of plan?.priceDefs || []) out.push({ id: d.id, name: d.name, gain: d.gainText, cost: d.costText, color: d.color });
  return out;
}

// ------------------------------------------------------------------ surge

// What each essence empowers when a surge is woven at oneself (12 s at one essence;
// blends share it out like statuses do).
export const SURGE_BUFFS = {
  raw: { label: 'weave power', pct: { spellPower: 0.12 } },
  fire: { label: 'damage', pct: { dmgDealt: 0.12 } },
  water: { label: 'healing', add: { hpRegen: 1.0 } },
  frost: { label: 'armor', add: { def: 2, resist: 0.1 } },
  storm: { label: 'quickness', pct: { castSpeed: 0.15, speed: 0.08 } },
  earth: { label: 'stoneskin', add: { def: 3 } },
  wind: { label: 'swiftness', pct: { speed: 0.18 }, add: { dodge: 0.05 } },
  nature: { label: 'mending', add: { hpRegen: 0.8, resist: 0.05 } },
  poison: { label: 'cruelty', add: { crit: 0.08 } },
  light: { label: 'clarity', add: { crit: 0.05, critMul: 0.25 } },
  dark: { label: 'hunger', add: { atk: 2 }, pct: { spellPower: 0.08 } },
  iron: { label: 'iron', add: { def: 2, atk: 1 } },
  song: { label: 'harmony', pct: { cooldown: -0.12 }, add: { resist: 0.08 } },
};
export const SURGE_SECONDS = 12;

// The modifier a surge plan gives its caster.
export function surgeModifier(plan, chargeK = 0) {
  const ess = plan?.essences?.length ? plan.essences : ['raw'];
  const pot = STATUS_POTENCY[ess.length] ?? 0.5;
  const k = ess.length === 1 ? 1 : pot;
  const mod = { add: {}, pct: {}, mul: {} };
  const words = [];
  for (const e of ess) {
    const b = SURGE_BUFFS[e] || SURGE_BUFFS.raw;
    words.push(b.label);
    for (const part of ['add', 'pct']) for (const [s, v] of Object.entries(b[part] || {})) mod[part][s] = Math.round(((mod[part][s] || 0) + v * k) * 1000) / 1000;
  }
  const life = Math.max(0.6, Math.min(2.5, plan?.lifeMul || 1));
  const seconds = Math.round(SURGE_SECONDS * life * (1 + 0.6 * Math.max(0, Math.min(1, chargeK))) * 10) / 10;
  return { id: 'surge', source: 'surge', label: `Surge: ${[...new Set(words)].join(', ')}`, kind: 'buff', add: mod.add, pct: mod.pct, t: seconds, total: seconds, color: plan?.palette?.glow || '#c9a6ff', icon: 'surge' };
}

if (!Shapes.has('surge')) {
  Shapes.register({
    id: 'surge',
    name: 'Surge',
    noun: 'Surge',
    kind: 'area',
    harmless: true,
    self: true,
    base: { dmg: 0, cost: 12, cooldown: 9, speed: 0, range: 0, radius: 26, count: 1, life: 0.5 },
    hits: 0,
    aim: (p) => ({ type: 'ring', range: 0, radius: p.radius }),
    describe: (n, noun) => `Pours ${noun} into you, empowering you for a while`,
    emit(ctx) {
      const p = ctx.plan;
      for (let i = 0; i < ctx.count; i++) {
        ctx.spawn('area', { mode: 'ring', x: ctx.ox, y: ctx.oy, angle: ctx.angle, r0: p.radius * 1.4, r1: 3, life: p.life, delay: i * 0.1, follow: true, dmg: 0 });
      }
      const rt = ctx.rt;
      const g = rt?.game;
      try {
        g?.prices?.surge?.(ctx.caster, p, ctx.chargeK || 0);
      } catch (err) {
        rt?.warn?.('surge', err);
      }
    },
  });
}

// ------------------------------------------------------------------ the runtime

const OATH_NEAR = 112; // px: "while Lyra is near"
const EMBER_DRAIN = 0.02; // of max health per second
const FALL_WINDOW = 30;
export const LAST_STAND_SECONDS = 60;
// What the last minute gives (a modifier on the stat pipeline while it burns).
export const LAST_STAND_GAIN = Object.freeze({ mul: { atk: 2.5, dmgTaken: 0.4 }, pct: { spellPower: 1, speed: 0.35, swing: 0.5, castSpeed: 0.5 }, add: { poise: 1 } });

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export class PriceRuntime {
  constructor(game) {
    this.game = game;
    this.state = this.fresh();
    this.noticed = new Set(); // prices Lyra has already reacted to this session
    this._emberAcc = 0;
    this._oathPull = 0;
    const bus = game.bus;
    try {
      bus?.on?.('spell_cast', (p) => this.onCast(p));
      bus?.on?.('damage', (p) => this.onDamage(p));
      bus?.on?.('player_wake', () => this.onSleep());
      bus?.on?.('downed', (p) => {
        if (p?.entity === game.player) this.onPlayerDown();
      });
    } catch {
      /* the bus is optional in tests */
    }
  }

  fresh() {
    // laststand: null | 'armed' | { t } (burning: seconds left to live)
    return { berserk: null, overdraw: null, ember: false, lastlight: null, oath: null, laststand: null };
  }

  get stats() {
    return this.game.stats || null;
  }

  player() {
    return this.game.player || null;
  }

  isPlayer(a) {
    return !!a && (a === this.game.player || a.id === 'player');
  }

  unlocked(id) {
    return !!this.game.magic?.unlocked?.prices?.has?.(id);
  }

  // ---------------------------------------------------------------- paying

  onCast(p) {
    const caster = p?.caster;
    const plan = p?.plan;
    if (!this.isPlayer(caster) || !plan?.priceDefs?.length) return;
    this.pay(caster, plan);
  }

  pay(caster, plan) {
    for (const d of plan.priceDefs || []) {
      if (!d) continue;
      let first = false;
      try {
        first = this.apply(caster, d, plan);
      } catch (err) {
        console.warn(`[prices] ${d.id} failed`, err);
      }
      try {
        d.onCast?.(this, caster, plan);
      } catch (err) {
        console.warn(`[prices] ${d.id} onCast failed`, err);
      }
      this.game.bus?.emit?.('price_paid', { price: d.id, caster, plan, first: !!first });
    }
  }

  modId(id, part) {
    return `price:${id}:${part}`;
  }

  addPart(actor, d, part, extra = {}) {
    const p = d[part];
    if (!p || !this.stats) return null;
    return this.stats.addModifier(actor, {
      id: this.modId(d.id, part),
      source: `price:${d.id}`,
      label: p.label,
      kind: part,
      add: p.add,
      pct: p.pct,
      mul: p.mul,
      t: Number.isFinite(extra.t) ? extra.t : p.seconds,
      total: Number.isFinite(extra.t) ? extra.t : p.seconds,
      color: d.color,
      icon: d.id,
      price: d.id,
      tap: extra.tap || null,
    });
  }

  active(actor, id, part = 'gain') {
    return !!this.stats?.getModifier(actor, this.modId(id, part));
  }

  // Returns true when this cast started the price (rather than refreshing it).
  apply(actor, d, plan) {
    const S = this.state;
    const g = this.game;
    switch (d.id) {
      case 'berserk': {
        if (S.berserk) return false; // it runs its course; casting again changes nothing
        S.berserk = { t: d.gain.seconds };
        this.addPart(actor, d, 'gain');
        this.addPart(actor, d, 'cost', { t: d.gain.seconds });
        this.toast(`Berserk. ${cap(d.gainText)}. When it ends, your heart gives out.`, 'warn');
        safe(() => g.audio?.play?.('levelup', { pitch: 0.5, volume: 0.9 }));
        safe(() => g.camera?.shake?.(5, 0.4));
        return true;
      }
      case 'overdraw': {
        if (S.overdraw?.gain > 0) return false;
        // The drought is paid in full: casting it again while the well is dry borrows
        // nothing (round 14b: a recast at the drought's start used to skip it for good).
        if (S.overdraw?.cost > 0) {
          if (!S.overdraw.told) this.toast('The well is dry. Overdraw borrows nothing until it fills again.', 'info');
          S.overdraw.told = true;
          return false;
        }
        S.overdraw = { gain: d.gain.seconds, cost: 0 };
        this.addPart(actor, d, 'gain');
        return true;
      }
      case 'emberblood': {
        const was = S.ember;
        S.ember = true;
        this.addPart(actor, d, 'gain', { tap: 'douse' });
        this.addPart(actor, d, 'cost', { tap: 'douse' });
        if (!was) this.toast('Emberblood burns in you. Tap its flame to douse it.', 'warn');
        return !was;
      }
      case 'lastlight': {
        if (S.lastlight === 'armed') return false;
        if (S.lastlight === 'used') {
          this.toast('Lastlight is spent until you sleep.', 'info');
          return false;
        }
        S.lastlight = 'armed';
        this.addPart(actor, d, 'gain');
        return true;
      }
      case 'laststand': {
        if (S.laststand) {
          if (typeof S.laststand === 'object') return false; // already burning
          return false; // held already
        }
        // Never borrowed: "Try all magic" lends every price but this one.
        const real = this.game.magic?.realUnlocked;
        if (real && !real.prices?.has?.('laststand')) {
          this.toast('The Last Stand cannot be borrowed. It has to be earned.', 'info');
          return false;
        }
        // Asked every time it is taken up: its price is the whole story.
        this.offerLastStand(actor, d, plan);
        return false;
      }
      case 'oath': {
        const was = !!S.oath;
        S.oath = { t: d.gain.seconds };
        this.addPart(actor, d, 'cost');
        return !was;
      }
      default: {
        const was = this.active(actor, d.id, 'gain') || this.active(actor, d.id, 'cost');
        if (!d.refresh && this.active(actor, d.id, 'gain')) return false;
        this.addPart(actor, d, 'gain');
        this.addPart(actor, d, 'cost');
        if (!was && d.costText) this.toast(`${d.name}: ${d.gainText}. Price: ${d.costText}.`, 'warn');
        return !was;
      }
    }
  }

  // A surge woven at oneself (the shape's emit calls this).
  surge(caster, plan, chargeK = 0) {
    if (!caster || !this.stats) return null;
    const mod = surgeModifier(plan, chargeK);
    this.stats.addModifier(caster, mod);
    if (this.isPlayer(caster)) this.game.bus?.emit?.('surge', { caster, plan, mod });
    return mod;
  }

  // ---------------------------------------------------------------- the special ones

  // Called by combat.down before the player falls: lastlight holds the wound shut once.
  preventFall(target) {
    if (!this.isPlayer(target)) return false;
    // Burning in the last stand there is nothing left to put down (§25): hold at 1.
    if (this.burning()) {
      target._fallOpts = null;
      target.downed = false;
      target.hp = Math.max(1, target.hp || 0);
      return true;
    }
    if (this.state.lastlight !== 'armed') return false;
    if (target._fallOpts?.cause === 'berserk') return false; // it cannot restart a heart
    const d = Prices.get('lastlight');
    this.state.lastlight = 'used';
    this.stats?.removeModifier(target, this.modId('lastlight', 'gain'));
    this.addPart(target, d, 'cost');
    this.stats?.refresh(target);
    target._fallOpts = null;
    target.downed = false;
    target.hp = target.maxHp;
    target.invuln = Math.max(target.invuln || 0, 1.5);
    const g = this.game;
    safe(() => g.particles?.emit?.('levelup', target.x, target.y - 10, { count: 26, color: '#ffe08a', speed: 50, life: 1 }));
    safe(() => g.lighting?.flash?.({ x: target.x, y: target.y - 10, r: 110, color: '#ffe08a', intensity: 1, duration: 0.9 }));
    safe(() => g.audio?.play?.('revive', { x: target.x, y: target.y, pitch: 1.3 }));
    this.toast('Lastlight! You rise whole. Your body will pay for it until you sleep.', 'warn');
    g.bus?.emit?.('price_triggered', { price: 'lastlight', actor: target });
    return true;
  }

  douse(id = 'emberblood') {
    if (id === 'laststand') return this.quenchLastStand();
    const P = this.player();
    if (id !== 'emberblood' || !this.state.ember || !P) return false;
    this.state.ember = false;
    this.stats?.removeModifier(P, 'price:emberblood');
    this._emberAcc = 0;
    this.toast('You douse the emberblood.', 'info');
    this.game.bus?.emit?.('price_ended', { price: 'emberblood', actor: P, why: 'doused' });
    return true;
  }

  // ---------------------------------------------------------------- the last stand

  burning() {
    const L = this.state.laststand;
    return !!L && typeof L === 'object' && L.t > 0;
  }

  lastStandArmed() {
    return this.state.laststand === 'armed';
  }

  // Taking it up: the confirm says the price in full (the game's own dialog, never the
  // browser's); only a yes arms it. Without a UI (tests) it arms at once.
  offerLastStand(actor, d = Prices.get('laststand'), plan = null) {
    const g = this.game;
    if (this._asking || this.state.laststand) return false;
    const confirm = g.ui?.confirm;
    if (typeof confirm !== 'function') return this.armLastStand(actor, plan);
    this._asking = true;
    const text =
      'When you would die, you rise instead: one minute burning, far stronger, unafraid, able to strike anyone, and nothing can put you down. ' +
      'When the minute ends, you die for good. No kept flame brings you back, nobody can carry you to Mira, and waking at home does not save you: your story ends here and this save closes. ' +
      'Until it is needed you can put it out with its skull mark on the HUD.';
    let p = null;
    try {
      p = confirm.call(g.ui, { title: 'Take up the Last Stand?', text, yes: 'Take it up', no: 'Not this', danger: true });
    } catch {
      p = null;
    }
    Promise.resolve(p).then(
      (yes) => {
        this._asking = false;
        if (yes) this.armLastStand(actor, plan);
        else this.toast('You let the Last Stand go. Your weave still left your hands.', 'info');
      },
      () => {
        this._asking = false;
      },
    );
    return true;
  }

  armLastStand(actor = this.player(), plan = null) {
    if (!actor || this.state.laststand) return false;
    const d = Prices.get('laststand');
    this.state.laststand = 'armed';
    this.addPart(actor, d, 'gain', { tap: 'douse' });
    this.stats?.refresh?.(actor);
    this.toast('The Last Stand is in you. When you would die, you will rise for one minute, and then die for good. Tap its mark on the HUD to put it out.', 'warn');
    this.game.bus?.emit?.('price_paid', { price: 'laststand', caster: actor, plan, first: true });
    return true;
  }

  // Put it out while it is only held (once it burns, nothing puts it out).
  quenchLastStand() {
    const P = this.player();
    if (this.state.laststand !== 'armed') return false;
    this.state.laststand = null;
    if (P) this.stats?.removeModifier(P, 'price:laststand');
    this.toast('You put out the Last Stand. When you fall, you fall like anyone.', 'info');
    this.game.bus?.emit?.('price_ended', { price: 'laststand', actor: P, why: 'quenched' });
    return true;
  }

  // Rise (survival calls this when the window closes, or when the player chooses it while
  // down): whole, burning, for a minute. Returns true when they rose.
  riseLastStand(P = this.player(), how = 'death') {
    if (!P || this.state.laststand !== 'armed') return false;
    const g = this.game;
    const d = Prices.get('laststand');
    this.state.laststand = { t: LAST_STAND_SECONDS, how };
    this.stats?.removeModifier(P, 'price:laststand');
    this.stats?.addModifier(P, { id: this.modId('laststand', 'gain'), source: 'price:laststand', label: 'Last Stand: burning', kind: 'gain', ...LAST_STAND_GAIN, t: LAST_STAND_SECONDS, total: LAST_STAND_SECONDS, color: d.color, icon: 'laststand', price: 'laststand' });
    this.addPart(P, d, 'cost', { t: LAST_STAND_SECONDS });
    this.stats?.refresh?.(P);
    P.downed = false;
    P.dead = false;
    P.hp = P.maxHp;
    P.invuln = Math.max(P.invuln || 0, 1.5);
    P.lockTime = 0;
    P.setState?.('idle');
    safe(() => g.combat?.downedAt?.delete?.(P));
    safe(() => g.particles?.emit?.('spark', P.x, P.y - 8, { count: 30, speed: 90, life: 0.9 }));
    safe(() => g.particles?.emit?.('ember', P.x, P.y - 6, { count: 16 }));
    safe(() => g.lighting?.flash?.({ x: P.x, y: P.y - 10, r: 140, color: '#ff7a2a', intensity: 1, duration: 1.1 }));
    safe(() => g.camera?.shake?.(6, 0.5));
    safe(() => g.audio?.play?.('levelup', { x: P.x, y: P.y, pitch: 0.42, volume: 1 }));
    this.toast('Last Stand. You rise burning. One minute, and then you die for good.', 'warn');
    g.bus?.emit?.('price_triggered', { price: 'laststand', actor: P, how });
    return true;
  }

  // Seconds of the last minute left (null when not burning).
  lastStandLeft() {
    return this.burning() ? this.state.laststand.t : null;
  }

  onDamage(p) {
    const g = this.game;
    const P = g.player;
    // (Round 14b: the oath binds you to whoever walks with you, Lyra or anyone.)
    if (!this.state.oath || !P || !p?.target || p.target !== holderOf(g) || p.kind === 'oath') return;
    if (!(p.amount > 0) || !P.isAlive?.()) return;
    // Her wounds are yours.
    safe(() => g.combat?.damage?.(null, P, p.amount, { kind: 'oath', exact: true, crit: false, penetration: 99, noHitStop: true, knockback: 0, invuln: 0 }));
  }

  oathActive() {
    const g = this.game;
    const P = g.player;
    const L = holderOf(g);
    if (!this.state.oath || !P || !L || L.removed || L.downed || L.dead) return false;
    return Math.hypot(P.x - L.x, P.y - L.y) <= OATH_NEAR;
  }

  // Live modifier for the pipeline: the oath's gain holds only while she is near.
  provide(actor) {
    if (!this.isPlayer(actor) || !this.oathActive()) return null;
    const d = Prices.get('oath');
    const t = this.state.oath.t;
    return [{ id: 'price:oath:gain', source: 'price:oath', label: d.gain.label, kind: 'gain', pct: { atk: 0.3, spellPower: 0.3, def: 0.3, speed: 0.1, crit: 0.3, castSpeed: 0.1 }, t, total: d.gain.seconds, color: d.color, icon: 'oath', price: 'oath' }];
  }

  onPlayerDown() {
    // Falling puts out the ember.
    if (this.state.ember) {
      this.state.ember = false;
      const P = this.player();
      if (P) this.stats?.removeModifier(P, 'price:emberblood');
    }
  }

  // Sleep gives back what lastlight took (the bed heals; the halved body is whole again).
  onSleep() {
    const P = this.player();
    if (this.state.lastlight === 'used') this.state.lastlight = null;
    if (!P) return;
    const had = this.stats?.removeModifier(P, this.modId('lastlight', 'cost'));
    if (had && !P.downed && !P.dead) P.hp = P.maxHp;
  }

  update(dt) {
    if (!(dt > 0)) return;
    const S = this.state;
    const P = this.player();
    if (!P) return;
    if (this.burning()) {
      const L = S.laststand;
      L.t -= dt;
      // Burning: embers stream off them, and the light of it goes where they go.
      this._burnFx = (this._burnFx || 0) - dt;
      if (this._burnFx <= 0) {
        this._burnFx = 0.12;
        const g = this.game;
        safe(() => g.particles?.emit?.('ember', P.x + (Math.random() - 0.5) * 8, P.y - 6, { count: 2 }));
        if (L.t < 10) safe(() => g.particles?.emit?.('smoke', P.x, P.y - 10, { count: 1 }));
      }
      if (L.t <= 0) this.endLastStand(P);
    }
    if (S.berserk) {
      S.berserk.t -= dt;
      if (S.berserk.t <= 0) this.endBerserk(P);
    }
    if (S.overdraw) {
      if (S.overdraw.gain > 0) {
        S.overdraw.gain -= dt;
        if (S.overdraw.gain <= 0) {
          S.overdraw.gain = 0;
          const d = Prices.get('overdraw');
          this.stats?.removeModifier(P, this.modId('overdraw', 'gain'));
          this.addPart(P, d, 'cost');
          S.overdraw.cost = d.cost.seconds;
        }
      } else if (S.overdraw.cost > 0) {
        S.overdraw.cost -= dt;
        if (S.overdraw.cost <= 0) S.overdraw = null;
      } else S.overdraw = null;
    }
    if (S.oath) {
      S.oath.t -= dt;
      if (S.oath.t <= 0) {
        S.oath = null;
        this.stats?.removeModifier(P, 'price:oath');
      }
    }
    if (S.ember && P.isAlive?.()) {
      this._emberAcc += P.maxHp * EMBER_DRAIN * dt;
      const whole = Math.floor(this._emberAcc);
      if (whole > 0) {
        this._emberAcc -= whole;
        if (P.hp - whole <= 1) {
          P.hp = 1;
          this.state.ember = false;
          this.stats?.removeModifier(P, 'price:emberblood');
          this.toast('The emberblood gutters out. There is nothing left in you to burn.', 'warn');
          this.game.bus?.emit?.('price_ended', { price: 'emberblood', actor: P, why: 'spent' });
        } else {
          P.hp -= whole;
          P.flash = Math.max(P.flash || 0, 0.25);
        }
      }
    }
  }

  // Every price still running stops at once, its modifiers with it, except the ids in
  // `keep` (a Set): the end of "Try all magic" ends what was only borrowed. -> ids ended.
  endRunning(keep = null, why = 'ended') {
    const P = this.player();
    const S = this.state;
    const ended = [];
    const stop = (id) => {
      if (keep?.has?.(id)) return false;
      if (P) this.stats?.removeModifier(P, `price:${id}`);
      ended.push(id);
      this.game.bus?.emit?.('price_ended', { price: id, actor: P, why });
      return true;
    };
    if (S.berserk && stop('berserk')) S.berserk = null;
    if (S.overdraw && stop('overdraw')) S.overdraw = null;
    if (S.ember && stop('emberblood')) {
      S.ember = false;
      this._emberAcc = 0;
    }
    if (S.lastlight && stop('lastlight')) S.lastlight = null;
    if (S.oath && stop('oath')) S.oath = null;
    if (S.laststand === 'armed' && stop('laststand')) S.laststand = null;
    // The plain ones (bloodprice, glass…) are only their modifiers.
    const special = new Set(['berserk', 'overdraw', 'emberblood', 'lastlight', 'oath', 'laststand']);
    if (P) for (const id of Prices.ids()) if (!special.has(id) && (this.active(P, id, 'gain') || this.active(P, id, 'cost'))) stop(id);
    if (P && ended.length) this.stats?.refresh?.(P);
    return ended;
  }

  // The minute is up: they die for good (survival closes the story).
  endLastStand(P = this.player()) {
    const L = this.state.laststand;
    if (!L || typeof L !== 'object' || L.spent) return false;
    this.state.laststand = { t: 0, spent: true };
    if (P) this.stats?.removeModifier(P, 'price:laststand');
    // Nothing else they paid for outlives them.
    if (this.state.berserk) {
      this.state.berserk = null;
      if (P) this.stats?.removeModifier(P, 'price:berserk');
    }
    this.game.bus?.emit?.('price_ended', { price: 'laststand', actor: P, why: 'burned out' });
    const sv = this.game.survival;
    if (sv?.burnOut) return sv.burnOut(P);
    if (P) {
      P.hp = 0;
      P.downed = true;
      P.dead = true;
    }
    return true;
  }

  // Two minutes are up: the heart gives out.
  endBerserk(P) {
    this.state.berserk = null;
    this.stats?.removeModifier(P, 'price:berserk');
    this.game.bus?.emit?.('price_ended', { price: 'berserk', actor: P, why: 'heart' });
    if (P.downed || P.dead || this.burning()) return false; // (the last stand burns on without it)
    this.toast('Your heart gives out.', 'warn');
    if (typeof P.fall === 'function') return P.fall({ window: FALL_WINDOW, cause: 'berserk' });
    return false;
  }

  // What the HUD shows: [{ id, price, label, kind, left, total, color, tap }].
  timers(actor = this.player()) {
    if (!actor || !this.stats) return [];
    const out = [];
    for (const m of this.stats.modifiers(actor)) {
      if (!m || !(m.price || m.kind === 'buff' || m.kind === 'weak')) continue;
      out.push({ id: m.id, price: m.price || null, label: m.label, kind: m.kind, left: m.t, total: m.total, color: m.color, icon: m.icon || m.price || m.source, tap: m.tap || null });
    }
    if (this.state.berserk) {
      const b = out.find((x) => x.id === 'price:berserk:cost');
      if (b) b.left = this.state.berserk.t;
    }
    if (this.burning()) {
      for (const c of out) if (c.price === 'laststand') c.left = this.state.laststand.t;
    }
    return out;
  }

  toast(text, kind = 'info') {
    safe(() => this.game.ui?.toast?.(text, kind));
  }

  serialize() {
    const S = this.state;
    return {
      berserk: S.berserk ? Math.round(S.berserk.t * 10) / 10 : null,
      overdraw: S.overdraw ? { gain: Math.round(S.overdraw.gain * 10) / 10, cost: Math.round(S.overdraw.cost * 10) / 10 } : null,
      ember: !!S.ember,
      lastlight: S.lastlight === 'armed' || S.lastlight === 'used' ? S.lastlight : null,
      oath: S.oath ? Math.round(S.oath.t * 10) / 10 : null,
      laststand: S.laststand === 'armed' ? 'armed' : this.burning() ? Math.round(S.laststand.t * 10) / 10 : null,
    };
  }

  deserialize(d) {
    const S = this.fresh();
    if (d && typeof d === 'object') {
      if (Number.isFinite(d.berserk) && d.berserk > 0) S.berserk = { t: d.berserk };
      if (d.overdraw && typeof d.overdraw === 'object') S.overdraw = { gain: Math.max(0, Number(d.overdraw.gain) || 0), cost: Math.max(0, Number(d.overdraw.cost) || 0) };
      S.ember = !!d.ember;
      if (d.lastlight === 'armed' || d.lastlight === 'used') S.lastlight = d.lastlight;
      if (Number.isFinite(d.oath) && d.oath > 0) S.oath = { t: d.oath };
      // Held, or burning: closing the page does not escape the end of the minute.
      if (d.laststand === 'armed') S.laststand = 'armed';
      else if (Number.isFinite(d.laststand) && d.laststand > 0) S.laststand = { t: d.laststand, how: 'loaded' };
    }
    this.state = S;
  }
}

function cap(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
