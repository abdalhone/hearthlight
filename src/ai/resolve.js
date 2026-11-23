import { COMPANION_ID, PLAYER_ID } from '../core/constants.js';
import { factionRelation } from '../entities/entity.js';

// Turn loose references from language ("me", "Bram", "the inn", "that wolf",
// "nearest enemy") into game things. Used by every action and both brains.

const SELF_WORDS = new Set(['me', 'myself', 'player', 'us', 'here to me', 'you know who']);
const LYRA_WORDS = new Set(['you', 'yourself', 'lyra', 'companion', 'her']);

export function normalizeRef(ref) {
  return String(ref ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_' -]/g, ' ')
    .replace(/\b(the|a|an|that|this|those|these|to|at|over|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve to an entity. Accepts an entity, an id, a name, pronouns, or a kind
// ("wolf", "bandit", "slime"). `from` (an entity) picks the nearest match.
export function resolveEntity(game, ref, from = null) {
  if (!ref) return null;
  if (typeof ref === 'object' && ref.id) return ref;
  const raw = String(ref).trim();
  const n = normalizeRef(raw);
  if (!n) return null;
  if (SELF_WORDS.has(n)) return game.player || game.entities.get(PLAYER_ID);
  if (LYRA_WORDS.has(n) || n === String(game.settings?.companionName || '').toLowerCase()) return game.companion || game.entities.get(COMPANION_ID);
  const origin = from || game.companion || game.player;
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;

  const direct = game.entities.get(raw) || game.entities.get(n);
  if (direct && !direct.removed) return direct;

  if (/^(nearest |closest )?(enemy|enemies|hostile|foe|monster|threat)s?$/.test(n)) {
    return game.entities.nearest(ox, oy, 260, (e) => e.type === 'actor' && e.isAlive() && factionRelation('player', e.faction) === 'hostile');
  }

  const named = game.entities.byName(n);
  if (named) return named;

  // Kind words: "wolf", "wolves", "bandits", "skeleton", "slime", "deer".
  const singular = n.replace(/(ves)$/, 'f').replace(/(es|s)$/, '');
  const kindMatch = (e) =>
    e.type === 'actor' &&
    e.isAlive() &&
    [e.species, e.kind, e.faction, e.spriteKey, e.role].some((v) => v && (String(v).toLowerCase() === n || String(v).toLowerCase() === singular));
  return game.entities.nearest(ox, oy, 400, kindMatch);
}

// Resolve to a named location (see world/locations.js).
export function resolveLocation(game, ref) {
  if (!ref || !game.locations) return null;
  if (typeof ref === 'object' && ref.id && ref.bounds) return ref;
  return game.locations.find(String(ref));
}

// Resolve any target: entity, location, or world object ("door", "chest", "campfire").
// Returns { kind: 'entity'|'location'|'object'|'point', entity?, location?, object?, x, y } or null.
export function resolveTarget(game, ref, from = null) {
  if (!ref) return null;
  if (typeof ref === 'object') {
    if (ref.type === 'actor' || ref.type === 'entity' || ref.type === 'pickup') return { kind: 'entity', entity: ref, x: ref.x, y: ref.y };
    if (ref.bounds) return { kind: 'location', location: ref, x: ref.center.x, y: ref.center.y };
    if (ref.objType) return { kind: 'object', object: ref, x: ref.x, y: ref.y };
    if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) return { kind: 'point', x: ref.x, y: ref.y };
  }
  const n = normalizeRef(ref);
  const m = n.match(/^(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)$/);
  if (m) return { kind: 'point', x: parseFloat(m[1]), y: parseFloat(m[2]) };
  const e = resolveEntity(game, ref, from);
  if (e) return { kind: 'entity', entity: e, x: e.x, y: e.y };
  const loc = resolveLocation(game, ref);
  if (loc) return { kind: 'location', location: loc, x: loc.center.x, y: loc.center.y };
  const origin = from || game.companion || game.player;
  const obj = game.objects?.findByWord?.(n, origin?.x ?? 0, origin?.y ?? 0);
  if (obj) return { kind: 'object', object: obj, x: obj.x, y: obj.y };
  return null;
}
