import { PLAYER_ID } from '../../core/constants.js';

// Is it worth it to her? (DESIGN §19.4, LORE §7 "Boundaries".) Lyra stays, travels and
// helps because it is good for her; she stops someone, runs or leaves only when that is
// better for her than staying, or when staying no longer seems worth it.
//
// weighWorth(a) reads her real state through the Autonomy `a` and returns
//   { stay, cost, net, reasons: [{ key, text, weight }], harm, fearCost, t }
// where reasons are in her own words, to the player ("You lied to me."), positive for
// what being with the player gives her and negative for what it costs her. Deeds weigh
// less as they age: small wrongs she can afford fade within hours, lies and broken
// promises over days, harm slowly, and a knock-out barely at all.
//
// The Autonomy smooths `net` over time (WorthTracker) so one bad moment never decides
// anything: wary, apart or left come only when the net stays low.

// Thresholds on the smoothed net, and how long (in-game hours) it must hold there.
export const WORTH = {
  wary: 1.0, // together -> wary when it stays below
  calm: 2.0, // wary -> together when it stays above
  left: -1.0, // -> left when it stays below and the cost is harm or fear
  gone: -2.5, // -> left whatever the cost is made of: staying is simply not worth it
  back: 2.2, // apart after amends -> she comes back on her own terms
  holdHours: 1, // how long the net must stay past a line before she acts on it
  backHours: 2,
  smoothHours: 0.5, // time constant of the smoothed net
};

// How a deed weighs per unit of severity, and how long it takes to fade (in-game days).
// `group` collects deeds into one reason.
const DEED_WEIGHT = {
  // what being with the player gives her
  protected_lyra: { group: 'care', per: 0.5, days: 3 },
  revived_lyra: { group: 'care', per: 0.5, days: 4 },
  gift_liked: { group: 'good_days', per: 0.35, days: 1 },
  gift_loved: { group: 'good_days', per: 0.35, days: 1.5 },
  respected_refusal: { group: 'good_days', per: 0.3, days: 1 },
  kept_promise: { group: 'kept', per: 0.4, days: 2 },
  kindness: { group: 'kindness', per: 0.4, days: 1.5 },
  // what it costs her
  hit_lyra_accident: { group: 'clipped', per: 0.5, days: 0.08 },
  hit_lyra: { group: 'harm', per: 0.4, days: 4 },
  downed_lyra: { group: 'harm', per: 0.4, days: 20 },
  abandoned_downed: { group: 'abandoned', per: 0.5, days: 5 },
  lied: { group: 'lies', per: 0.6, days: 2 },
  broke_promise: { group: 'broken', per: 0.45, days: 2 },
  pushed_after_refusal: { group: 'pushed', per: 0.45, days: 0.5 },
  attacked_villager: { group: 'villagers', per: 0.4, days: 4 },
  downed_villager: { group: 'villagers', per: 0.4, days: 10 },
  attacked_guard: { group: 'villagers', per: 0.35, days: 3 },
  stole: { group: 'crimes', per: 0.4, days: 2 },
  killed_harmless: { group: 'cruelty', per: 0.4, days: 1 },
  gift_disliked: { group: 'slights', per: 0.2, days: 0.3 },
  reckless_order: { group: 'danger', per: 0.45, days: 1 },
};

// Her words for each reason. Functions get the weighing context.
const WORDS = {
  trust: (c) => (c.trust >= 60 ? 'I trust you.' : c.trust >= 40 ? 'I’m coming to trust you.' : 'You stood beside me against the wolves. That counts.'),
  affection: (c) => (c.affinity >= 50 ? 'I’m fond of you, more than I let on.' : 'I like your company.'),
  maren: (c) => (c.questStage < 6 ? 'You came out of Maren’s “other end”. You’re the best clue to her I have.' : 'Whatever ties you to Maren isn’t finished yet.'),
  care: () => 'You fought for me, and you came back for me.',
  good_days: () => 'We’ve had some good days.',
  kept: () => 'You keep your word.',
  kindness: (c) => (c.lovedKindness ? 'You’re good to people I love.' : 'You’re kind to people here.'),
  wage: () => 'The hearthwatch stipend pays my keep.',
  safety: () => 'Out here, two are safer than one.',
  clipped: () => 'You clipped me in a scramble. It happens.',
  harm: (c) => (c.downed ? 'You knocked me down.' : 'You hurt me, on purpose.'),
  abandoned: () => 'You left me lying there.',
  fear: () => 'You frighten me.',
  distrust: (c) => (c.trust < 15 ? 'I can’t trust you.' : 'I don’t know yet if I can trust you.'),
  lies: () => 'You lied to me.',
  broken: () => 'You broke your word.',
  pushed: () => 'You push after I’ve said no.',
  villagers: (c) => (c.lovedHurt ? 'You hurt someone I love.' : 'You hurt people here.'),
  crimes: () => 'You steal.',
  cruelty: () => 'You killed something that was no threat to anyone.',
  slights: () => 'Small things. I can afford them.',
  danger: () => 'You keep pointing me at things that could kill me.',
  time: () => 'Every hour with you is one away from Mam and Da, and the waystones.',
};

// Reasons that come from harm or fear: the only ones that can make her break off (left)
// before staying is plainly not worth it at all.
const HARM_GROUPS = new Set(['harm', 'abandoned', 'villagers', 'fear']);

const num = (v, d) => (Number.isFinite(v) ? v : d);

export function weighWorth(a) {
  const now = a.now();
  const dayS = a.daySeconds();
  const s = a.stats();
  const st = a.companionship;
  const ctx = { trust: s.trust, affinity: s.affinity, fear: s.fear, questStage: num(a.questStage, 0), lovedKindness: false, lovedHurt: false, downed: false };
  const groups = new Map();
  const addTo = (key, w) => {
    if (!w) return;
    groups.set(key, (groups.get(key) || 0) + w);
  };

  // What she feels toward the player, summed up.
  addTo('trust', Math.min(3.6, Math.max(0, s.trust) * 0.04));
  if (s.affinity > 0) addTo('affection', Math.min(1.6, s.affinity * 0.02));
  else if (s.affinity < 0) addTo('distrust', s.affinity * 0.02);
  if (s.trust < 30) addTo('distrust', -(30 - s.trust) * 0.08);
  if (s.fear >= 5) addTo('fear', -s.fear * 0.05);

  // The Maren thread: the stranger came out of Maren's "other end".
  addTo('maren', ctx.questStage < 6 ? 1.5 : 0.8);
  // The hearthwatch: she holds the Wayhouse key while she is not broken off.
  if (st === 'together' || st === 'wary' || st === 'apart') addTo('wage', 0.5);

  // Deeds, fading with age.
  for (const e of a.ledger) {
    const def = DEED_WEIGHT[e.deed];
    if (!def || !Number.isFinite(e.severity)) continue;
    const age = Math.max(0, now - num(e.t, now)) / dayS;
    const fade = Math.exp(-age / def.days);
    if (fade < 0.02) continue;
    let w = e.severity * def.per * fade;
    if (e.deed === 'downed_lyra') ctx.downed = true;
    if (e.victimId && e.victimId !== PLAYER_ID && (def.group === 'kindness' || def.group === 'villagers')) {
      const aff = num(a.relOf(e.victimId)?.affinity, 0);
      if (aff >= 30) {
        w *= 1.6;
        if (def.group === 'kindness') ctx.lovedKindness = true;
        else ctx.lovedHurt = true;
      }
    }
    addTo(def.group, w);
  }

  // Dangerous asks she had to refuse lately.
  for (const r of a.refusals || []) {
    if (r.category !== 'combat' || !(now - r.t < dayS / 2)) continue;
    addTo('danger', -0.2);
  }

  // Safety together: in danger, two are safer than one, unless the danger is the player.
  if (s.fear < 30) {
    const l = a.lyra();
    let danger = 0;
    try {
      const loc = l ? a.locationAt(l.x, l.y) : null;
      danger = num(loc?.danger, 0) * 0.3;
      if (a.game?.clock?.isNight && !loc?.indoor) danger += 0.2;
      if (l) danger += Math.min(0.6, a.threatsNear(l.x, l.y, 160).score * 0.15);
    } catch {
      danger = 0;
    }
    if (danger > 0.05) addTo('safety', Math.min(1.2, danger));
  }

  // Time taken from her own life: her parents, the waystones, her own day.
  const hours = num(a.worthTrack?.togetherToday, 0) / a.sph();
  if (st === 'together' || st === 'wary') addTo('time', -Math.min(0.8, 0.25 + Math.max(0, hours - 5) * 0.08));

  let stay = 0;
  let cost = 0;
  let harm = 0;
  const reasons = [];
  for (const [key, w] of groups) {
    if (Math.abs(w) < 0.05) continue;
    if (w > 0) stay += w;
    else cost -= w;
    if (w < 0 && HARM_GROUPS.has(key)) harm -= w;
    const words = WORDS[key];
    reasons.push({ key, text: words ? words(ctx) : key, weight: Math.round(w * 100) / 100 });
  }
  reasons.sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight));
  const r2 = (v) => Math.round(v * 100) / 100;
  return { stay: r2(stay), cost: r2(cost), net: r2(stay - cost), reasons, harm: r2(harm), t: now };
}

// The smoothed net and how long it has held past each line (all in game seconds).
export class WorthTracker {
  constructor() {
    this.avg = null;
    this.belowWary = 0;
    this.aboveCalm = 0;
    this.belowLeft = 0;
    this.belowGone = 0;
    this.aboveBack = 0;
    this.togetherToday = 0;
    this.togetherDay = 0;
  }

  // Fold a fresh weighing in, `step` game seconds after the last one.
  feed(net, step, sph) {
    if (!Number.isFinite(net)) return;
    if (this.avg == null) this.avg = net;
    else {
      const k = 1 - Math.exp(-Math.max(0, step) / (WORTH.smoothHours * sph));
      this.avg += (net - this.avg) * k;
    }
    const v = this.avg;
    this.belowWary = v < WORTH.wary ? this.belowWary + step : 0;
    this.aboveCalm = v > WORTH.calm ? this.aboveCalm + step : 0;
    this.belowLeft = v < WORTH.left ? this.belowLeft + step : 0;
    this.belowGone = v < WORTH.gone ? this.belowGone + step : 0;
    this.aboveBack = v > WORTH.back ? this.aboveBack + step : 0;
  }

  // After her state changes, the clocks start again (hysteresis).
  restart() {
    this.belowWary = 0;
    this.aboveCalm = 0;
    this.belowLeft = 0;
    this.belowGone = 0;
    this.aboveBack = 0;
  }

  serialize() {
    const r = (v) => Math.round((Number(v) || 0) * 10) / 10;
    return { avg: this.avg == null ? null : Math.round(this.avg * 100) / 100, bw: r(this.belowWary), ac: r(this.aboveCalm), bl: r(this.belowLeft), bg: r(this.belowGone), ab: r(this.aboveBack), tt: r(this.togetherToday), td: this.togetherDay };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.avg = Number.isFinite(d.avg) ? d.avg : null;
    this.belowWary = num(d.bw, 0);
    this.aboveCalm = num(d.ac, 0);
    this.belowLeft = num(d.bl, 0);
    this.belowGone = num(d.bg, 0);
    this.aboveBack = num(d.ab, 0);
    this.togetherToday = num(d.tt, 0);
    this.togetherDay = num(d.td, 0);
  }
}

// One line for Claude's context: whether staying is worth it to her, and why.
export function worthLine(w, avg = null) {
  if (!w) return '';
  const net = Number.isFinite(avg) ? avg : w.net;
  const verdict = net >= WORTH.calm ? 'clearly worth it' : net >= WORTH.wary ? 'worth it, just' : net >= WORTH.left ? 'barely worth it' : 'not worth it';
  const words = (list) => list.map((r) => `${r.text.replace(/[.!]+$/, '')} (${r.weight > 0 ? '+' : ''}${r.weight})`).join('; ');
  const pro = w.reasons.filter((r) => r.weight > 0).slice(0, 3);
  const con = w.reasons.filter((r) => r.weight < 0).slice(0, 3);
  return `Is staying with the player worth it to her: ${verdict} (net ${net >= 0 ? '+' : ''}${Math.round(net * 10) / 10}; stay ${w.stay}, cost ${w.cost}).${pro.length ? ` For: ${words(pro)}.` : ''}${con.length ? ` Against: ${words(con)}.` : ''}`;
}

// The worst cost reason, as a sentence she can say once, plainly, when she acts on it.
export function topCost(w, { groups = null } = {}) {
  const list = (w?.reasons || []).filter((r) => r.weight < 0 && r.key !== 'time' && r.key !== 'slights' && r.key !== 'clipped' && (!groups || groups.has(r.key)));
  return list[0] || null;
}
