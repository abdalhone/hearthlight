// How a person looks at their age (round 14b, S-18c; the author: "make people age as well").
// Pure: ageLook(appearance, age, baseAge) gives the appearance at `age` for someone drawn
// as they were at `baseAge` (their canon look), changing only what the years since have
// crossed:
//   hair     greying from 50, grey from 65, silver from 80 (never darker than it was)
//   wrinkles from 50
//   posture  stooped from 75, bent from 85
//   build    child -> teen at 13 -> grown at 16 (people.js's stages), eyes no longer a child's
// lookKey(appearance, age, baseAge) names the look ('' when it is the canon one), so each
// stage is painted once, lazily, under `${id}~${key}` (the gear looks' pattern,
// src/gear/looks.js), and the entity's spriteKey points at it. Portraits follow spriteKey
// (src/ui/art.js personArtKey). applyAgeLooks(game) does it for everyone, on load and on
// birthdays; it also gives a grown child a grown body (health and pace).

import { mixHex } from './characters_paint.js';
import { HAIR } from './palette.js';
import { HAIR_EXTRA } from './characters_appearance.js';
import { ensureCharacter } from './characters_art.js';

const HAIR_LEVELS = [0, 50, 65, 80]; // natural, greying, grey, silver
const PALE = new Set(['white', 'silver', 'grey']);

function hairLevel(age) {
  let l = 0;
  for (let i = 0; i < HAIR_LEVELS.length; i++) if (age >= HAIR_LEVELS[i]) l = i;
  return l;
}

function postureLevel(age) {
  return age >= 85 ? 2 : age >= 75 ? 1 : 0;
}
const POSTURE = ['upright', 'stooped', 'bent'];

function buildFor(build, age) {
  if (build === 'child' && age >= 16) return 'slim';
  if (build === 'child' && age >= 13) return 'teen';
  if (build === 'teen' && age >= 16) return 'slim';
  return build;
}

function rampOf(v) {
  if (Array.isArray(v)) return v;
  return HAIR[v] || HAIR_EXTRA[v] || null;
}

// The changes the years have made: { hair, wrinkles, posture, build } (only those that moved).
export function ageChanges(appearance = {}, age, baseAge) {
  const out = {};
  if (!Number.isFinite(age) || !Number.isFinite(baseAge) || age <= baseAge) return out;
  const hl = hairLevel(age);
  const pale = PALE.has(appearance.hair);
  if (hl > hairLevel(baseAge) && !pale && appearance.hairStyle !== 'bald') out.hair = hl;
  if (age >= 50 && !appearance.wrinkles) out.wrinkles = true;
  const pl = postureLevel(age);
  const cur = Math.max(0, POSTURE.indexOf(appearance.posture || 'upright'));
  if (pl > cur && pl > postureLevel(baseAge)) out.posture = POSTURE[pl];
  const b = buildFor(appearance.build || 'normal', age);
  if (b !== (appearance.build || 'normal')) out.build = b;
  return out;
}

export function lookKey(appearance, age, baseAge) {
  const c = ageChanges(appearance, age, baseAge);
  const bits = [];
  if (c.hair) bits.push(`h${c.hair}`);
  if (c.wrinkles) bits.push('w');
  if (c.posture) bits.push(c.posture[0]);
  if (c.build) bits.push(c.build);
  return bits.join('');
}

export function ageLook(appearance = {}, age, baseAge) {
  const c = ageChanges(appearance, age, baseAge);
  const a = { ...appearance };
  if (c.hair) {
    const base = rampOf(appearance.hair) || HAIR.brown;
    if (c.hair === 1) a.hair = base.map((hex, i) => mixHex(hex, HAIR.silver[i], 0.45));
    else if (c.hair === 2) a.hair = 'grey';
    else a.hair = 'silver';
    if (Array.isArray(a.beardColor) || a.beardColor || (appearance.accessories || []).includes('beard') || (appearance.accessories || []).includes('mustache')) a.beardColor = a.hair;
  }
  if (c.wrinkles) a.wrinkles = true;
  if (c.posture) a.posture = c.posture;
  if (c.build) {
    a.build = c.build;
    if (appearance.eyeStyle === 'big' && c.build !== 'child') a.eyeStyle = 'small';
  }
  return a;
}

// A grown body: the NPC constructor's child numbers (26 hp, quick feet) grow with the child.
const BODY = { child: { maxHp: 26, speed: 46 }, teen: { maxHp: 32, speed: 44 }, grown: { maxHp: 36, speed: 40 } };

function bodyFor(stage) {
  return stage === 'child' ? BODY.child : stage === 'teen' ? BODY.teen : BODY.grown;
}

// For everyone in the world with a profile and a canon age: their look today, and a grown
// child's body. Returns the ids whose look changed.
export function applyAgeLooks(game, { baseAgeOf, ageOf, stageOf } = {}) {
  const changed = [];
  const atlas = game?.atlas;
  const canPaint = !!atlas && typeof document !== 'undefined';
  for (const e of game?.entities?.all?.() || []) {
    const p = e?.profile;
    if (!p || !p.appearance || e.dead || p.visitor) continue;
    const base = baseAgeOf?.(p.id);
    const age = ageOf?.(p.id);
    if (!Number.isFinite(base) || !Number.isFinite(age)) continue;
    const key = lookKey(p.appearance, age, base);
    const want = key ? `${p.id}~${key}` : p.spriteKey || p.id;
    if (e.spriteKey !== want) {
      if (!key || !canPaint || ensureCharacter(atlas, want, ageLook(p.appearance, age, base))) {
        e.spriteKey = want;
        if (e.r) e.r.key = null;
        changed.push(p.id);
      }
    }
    // A child who has grown: a grown body (unless the profile says otherwise).
    if (p.appearance.build === 'child' && !p.combat?.maxHp) {
      const b = bodyFor(stageOf?.(p.id));
      if (e.maxHp !== b.maxHp) {
        const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
        e.maxHp = b.maxHp;
        e.hp = Math.max(1, Math.round(b.maxHp * ratio));
      }
      if (!Number.isFinite(p.speed)) {
        if (e.baseSpeed !== undefined) e.baseSpeed = b.speed;
        e.speed = b.speed;
      }
    }
  }
  return changed;
}
