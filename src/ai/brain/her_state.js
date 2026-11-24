// What the brain needs to know about Lyra's own will (DESIGN §16), read defensively from
// the mind's autonomy delegates. The mind may still be partial, so every accessor falls
// back to "together, fair trust, no fear" rather than throwing.

export const COMPANIONSHIP_STATES = ['together', 'wary', 'apart', 'left', 'gone'];

const DEFAULT_REL = { trust: 50, affinity: 20, fear: 0, respect: 30, familiarity: 20 };

function mindOf(game) {
  return game?.companion?.mind || null;
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// 'together' | 'wary' | 'apart' | 'left' | 'gone'
export function companionshipOf(game) {
  if (game?.flags?.lyra_gone) return 'gone';
  const mind = mindOf(game);
  let c = safe(() => mind?.companionship ?? mind?.autonomy?.companionship);
  if (c && typeof c === 'object') c = c.state;
  return COMPANIONSHIP_STATES.includes(c) ? c : 'together';
}

// Her relationship numbers toward the player, with neutral defaults.
export function playerRel(game) {
  const rel = safe(() => mindOf(game)?.relationships?.get?.('player'));
  const out = { known: !!rel };
  for (const k of Object.keys(DEFAULT_REL)) out[k] = Number.isFinite(rel?.[k]) ? rel[k] : DEFAULT_REL[k];
  return out;
}

function listOf(v) {
  return Array.isArray(v) ? v : [];
}

export function ledgerOf(game, n = 5) {
  const mind = mindOf(game);
  const list = listOf(safe(() => mind?.ledger ?? mind?.autonomy?.ledger, []));
  return list.slice(-n);
}

export function agendaOf(game) {
  const mind = mindOf(game);
  const a = safe(() => mind?.agenda ?? mind?.autonomy?.agenda);
  return a && typeof a === 'object' ? a : { goals: [], today: [], purse: 0 };
}

export function openPromises(game, n = 4) {
  const mind = mindOf(game);
  const list = listOf(safe(() => mind?.promises ?? mind?.autonomy?.promises, []));
  return list.filter((p) => p && (p.state == null || p.state === 'open')).slice(-n);
}

// The plan entry for the current hour, if any.
export function currentPlan(game) {
  const today = listOf(agendaOf(game).today);
  const h = game?.clock?.hour ?? 12;
  return today.find((p) => p && Number.isFinite(p.from) && Number.isFinite(p.to) && h >= p.from && h < p.to) || null;
}

// Preview the consent gate's verdict without running anything (DESIGN §16.4).
export function previewVerdict(game, action, args = {}, offer = null) {
  const mind = mindOf(game);
  const fn = mind?.evaluateRequest || mind?.autonomy?.evaluateRequest;
  if (typeof fn !== 'function') return null;
  const owner = mind?.evaluateRequest ? mind : mind.autonomy;
  const a = { target: args?.target ?? null, value: args?.value ?? null, amount: args?.amount ?? null };
  if (offer) a.offer = offer;
  try {
    const v = fn.call(owner, { action, args: a, source: 'player', preview: true });
    return v && typeof v === 'object' && v.decision ? v : null;
  } catch (err) {
    console.error('[brain] evaluateRequest failed', err);
    return null;
  }
}

export const ACCEPTED = new Set(['accept', 'accept_conditional']);

export function isRefusal(result) {
  if (!result) return false;
  if (result.refused) return true;
  const d = result.verdict?.decision;
  return !!d && !ACCEPTED.has(d);
}

// Reasons as one clause list: ["it's dark", "I'm tired"] -> "it's dark, and I'm tired".
export function reasonText(reasons, max = 3) {
  const list = listOf(reasons)
    .map((r) => String(r ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, ''))
    .filter(Boolean)
    .slice(0, max);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// "refuse, because it is dark and you hit me" -- the line Claude reads as her gut feeling.
export function gutLine(verdict) {
  if (!verdict?.decision) return '';
  const why = reasonText(verdict.reasons, 4);
  const extra = [];
  if (verdict.condition) extra.push(`condition: ${String(verdict.condition).slice(0, 120)}`);
  if (verdict.counter?.name) extra.push(`counter-offer: ${verdict.counter.name}${verdict.counter.args?.value ? ` ${verdict.counter.args.value}` : ''}`);
  return `your gut says: ${verdict.decision.replace(/_/g, ' ')}, because ${why || 'nothing about it stands out'}${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

// Is the player close enough to talk to her (in tiles)?
export function distanceTiles(game) {
  const a = game?.companion;
  const b = game?.player;
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y) / 16;
}
