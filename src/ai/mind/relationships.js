import { PLAYER_ID, COMPANION_ID, DAY_SECONDS } from '../../core/constants.js';
import { factionRelation } from '../../entities/entity.js';
import { clamp, normName, firstName, playerName, nowT, dayOf, shorten, isNamedCreature } from './text.js';

// Everyone Lyra knows and what she makes of them. Also the attack-mode filter:
// isFriend(e) decides who she will never target.
//
// rel = { id, name, kind, role, faction, species, npc, affinity -100..100, trust, respect,
//         familiarity, fear (0..100), tags [], notes [{text, source, t}], opinion, opinionBy,
//         firstMet, lastSeen, interactions, history [] }
// Group relationships ("the bandits", "wolves") use ids 'faction:<faction>' and
// 'species:<species>' and apply their tags to every member.

export const BOND_LABELS = ['Stranger', 'Acquaintance', 'Companion', 'Friend', 'Close friend', 'Kindred spirit'];
const BOND_THRESHOLDS = [0, 12, 28, 45, 62, 80];

export const KNOWN_TAGS = ['friend', 'enemy', 'family', 'rival', 'crush', 'mentor', 'pet', 'protect', 'ally'];
const LIMITS = { notes: 10, history: 14, noteText: 200, opinion: 420 };
const STATS = ['affinity', 'trust', 'respect', 'familiarity', 'fear'];

export function bondScore(rel) {
  if (!rel) return 0;
  // Fear eats a bond faster than familiarity builds one.
  let s = 0.4 * Math.max(0, rel.affinity) + 0.25 * rel.trust + 0.15 * rel.respect + 0.2 * rel.familiarity - 0.3 * rel.fear;
  if (rel.affinity < 0) s += rel.affinity * 0.3;
  return clamp(s, 0, 100);
}

export function bondOf(rel) {
  const score = bondScore(rel);
  let level = 0;
  for (let i = BOND_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= BOND_THRESHOLDS[i]) {
      level = i;
      break;
    }
  }
  return { level, label: BOND_LABELS[level], score: Math.round(score * 10) / 10 };
}

export function normalizeTag(tag) {
  let t = String(tag || '')
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, '');
  if (/^(friends?|ally|allies|buddy|buddies|pals?|mates?)$/.test(t)) t = 'friend';
  else if (/^(enem(y|ies)|foes?|hostiles?|targets?)$/.test(t)) t = 'enemy';
  else if (/^(pets?|companion animal|adopted)$/.test(t)) t = 'pet';
  else if (/^rivals?$/.test(t)) t = 'rival';
  else if (/^(crush|sweetheart|beloved)$/.test(t)) t = 'crush';
  else if (/^(family|kin|sister|brother)$/.test(t)) t = 'family';
  else if (/^(mentor|teacher)$/.test(t)) t = 'mentor';
  return t.replace(/[^a-z_-]/g, '').slice(0, 20);
}

export function makeRel(id, o = {}) {
  return {
    id: String(id),
    name: o.name || String(id),
    kind: o.kind || 'human',
    role: o.role || null,
    faction: o.faction || null,
    species: o.species || null,
    npc: !!o.npc,
    affinity: 0,
    trust: 10,
    respect: 15,
    familiarity: 0,
    fear: 0,
    tags: [],
    notes: [],
    opinion: '',
    opinionBy: 'self',
    opinionT: 0,
    opinionAff: 0,
    opinionLevel: 0,
    firstMet: null,
    lastSeen: null,
    interactions: 0,
    history: [],
    absent: !!o.absent,
  };
}

export class Relationships {
  constructor(game, owner, mind = null) {
    this.game = game;
    this.owner = owner;
    this.mind = mind;
    this.map = new Map();
    this.temp = new Map(); // entity id -> Set of tags, for unnamed creatures (not saved)
  }

  get size() {
    return this.map.size;
  }

  // By id, full name, first name or "the bandits"-style group name.
  get(idOrName) {
    if (!idOrName) return null;
    if (typeof idOrName === 'object') return this.map.get(idOrName.id) || null;
    const raw = String(idOrName);
    if (this.map.has(raw)) return this.map.get(raw);
    const n = normName(raw).replace(/^(the|a|an|my|our)\s+/, '');
    if (!n) return null;
    if (this.map.has(n)) return this.map.get(n);
    if (/^(me|player|you)$/.test(n)) return this.map.get(PLAYER_ID) || null;
    let partial = null;
    for (const r of this.map.values()) {
      const rn = normName(r.name);
      if (rn === n || normName(firstName(r.name)) === n) return r;
      if (!partial && n.length >= 3 && (rn.split(' ').includes(n) || rn.startsWith(n + ' '))) partial = r;
    }
    return partial;
  }

  // Create (or refresh) the relationship for an entity or id.
  ensure(entityOrId, o = {}) {
    let e = null;
    let id;
    if (entityOrId && typeof entityOrId === 'object') {
      e = entityOrId;
      id = e.id;
    } else {
      id = String(entityOrId);
      e = this.game?.entities?.get?.(id) || null;
    }
    if (!id) return null;
    let rel = this.map.get(id);
    const name = o.name || (id === PLAYER_ID ? playerName(this.game) : e?.name) || id;
    if (!rel) {
      rel = makeRel(id, {
        name,
        kind: o.kind || e?.kind || 'human',
        role: o.role || e?.role || e?.profile?.role || (e?.species ? String(e.species).replace(/_/g, ' ') : null),
        faction: o.faction || e?.faction || null,
        species: e?.species || null,
        npc: !!e?.profile,
        absent: o.absent,
      });
      this.map.set(id, rel);
    } else {
      if (o.name || (e?.name && !rel.absent)) rel.name = name;
      if (!rel.role && (e?.role || e?.profile?.role)) rel.role = e.role || e.profile.role;
      if (!rel.faction && e?.faction) rel.faction = e.faction;
      if (e?.profile) rel.npc = true;
    }
    return rel;
  }

  all() {
    return [...this.map.values()].sort((a, b) => bondScore(b) - bondScore(a));
  }

  // People (not groups), best bond first.
  people() {
    return this.all().filter((r) => r.kind !== 'group');
  }

  bond(idOrName) {
    const rel = this.get(idOrName);
    return rel ? bondOf(rel) : { level: 0, label: BOND_LABELS[0], score: 0 };
  }

  // Change the numbers. Returns the relationship (or null for an unknown id).
  adjust(idOrName, changes = {}, reason = '') {
    const rel = this.get(idOrName) || (typeof idOrName === 'string' && this.game?.entities?.get?.(idOrName) ? this.ensure(idOrName) : null);
    if (!rel) return null;
    const applied = {};
    const before = bondOf(rel).level;
    for (const k of STATS) {
      const d = Number(changes[k]);
      if (!Number.isFinite(d) || d === 0) continue;
      const lo = k === 'affinity' ? -100 : 0;
      const old = rel[k];
      rel[k] = Math.round(clamp(old + d, lo, 100) * 10) / 10;
      const real = Math.round((rel[k] - old) * 10) / 10;
      if (real) applied[k] = real;
    }
    if (!Object.keys(applied).length) return rel;
    const total = Object.values(applied).reduce((s, v) => s + Math.abs(v), 0);
    if (reason && total >= 3) this._history(rel, reason);
    const after = bondOf(rel).level;
    if (after !== before) this._history(rel, after > before ? `Became ${BOND_LABELS[after].toLowerCase()}s` : `Drifted to ${BOND_LABELS[after].toLowerCase()}s`);
    this.refreshOpinion(rel);
    this._emit(rel, applied, reason);
    return rel;
  }

  addNote(idOrName, text, source = 'self') {
    const rel = this.get(idOrName) || (typeof idOrName === 'string' ? this.ensure(idOrName) : null);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.noteText);
    if (!rel || !clean) return null;
    const src = ['observed', 'told', 'player', 'self'].includes(source) ? source : 'self';
    const key = normName(clean);
    const existing = rel.notes.find((n) => normName(n.text) === key);
    if (existing) {
      existing.t = nowT(this.game);
      if (src === 'player') existing.source = src;
      return existing;
    }
    const note = { text: clean, source: src, t: nowT(this.game) };
    rel.notes.push(note);
    if (rel.notes.length > LIMITS.notes) {
      // Notes the player gave her are dropped last.
      const i = rel.notes.findIndex((n) => n.source !== 'player');
      rel.notes.splice(i >= 0 ? i : 0, 1);
    }
    this.refreshOpinion(rel);
    this._emit(rel, { note: clean }, `note (${src})`);
    return note;
  }

  hasTag(idOrName, tag) {
    const rel = this.get(idOrName);
    return !!rel && rel.tags.includes(tag);
  }

  setTag(idOrName, tag, on = true) {
    const rel = this.get(idOrName) || (typeof idOrName === 'string' ? this.ensure(idOrName) : null);
    const t = normalizeTag(tag);
    if (!rel || !t) return null;
    const tg = t === 'ally' ? 'friend' : t;
    const has = rel.tags.includes(tg);
    if (on && !has) {
      if (tg === 'friend' || tg === 'pet') rel.tags = rel.tags.filter((x) => x !== 'enemy');
      if (tg === 'enemy') rel.tags = rel.tags.filter((x) => x !== 'friend' && x !== 'pet');
      rel.tags.push(tg);
      this._history(rel, `Marked ${tg}`);
    } else if (!on && has) {
      rel.tags = rel.tags.filter((x) => x !== tg);
      this._history(rel, `No longer ${tg}`);
    } else {
      return rel;
    }
    this.refreshOpinion(rel, true);
    this._emit(rel, { tag: `${on ? '+' : '-'}${tg}` }, `tag ${tg}`);
    return rel;
  }

  setOpinion(idOrName, text, by = 'brain') {
    const rel = this.get(idOrName);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.opinion);
    if (!rel || !clean) return null;
    rel.opinion = clean;
    rel.opinionBy = by;
    rel.opinionT = nowT(this.game);
    rel.opinionAff = rel.affinity;
    rel.opinionLevel = bondOf(rel).level;
    this._emit(rel, { opinion: clean }, 'opinion');
    return rel;
  }

  // Unnamed creatures (a particular slime) carry short-lived tags instead of a record.
  setTempTag(entity, tag, on = true) {
    if (!entity?.id) return;
    let s = this.temp.get(entity.id);
    if (on) {
      if (!s) this.temp.set(entity.id, (s = new Set()));
      s.add(tag);
      if (tag === 'enemy') s.delete('friend');
    } else if (s) {
      s.delete(tag);
      if (!s.size) this.temp.delete(entity.id);
    }
  }

  forgetEntity(id) {
    this.temp.delete(id);
  }

  // Keep a record only for people and creatures with names of their own.
  worthRecording(e) {
    if (!e) return false;
    if (e.id === PLAYER_ID || e.profile || e.npc) return true;
    if (this.map.has(e.id)) return true;
    return isNamedCreature(e);
  }

  _ownTags(e) {
    const rel = this.map.get(e.id);
    const temp = this.temp.get(e.id);
    if (!rel && !temp) return null;
    if (!temp) return rel.tags;
    if (!rel) return [...temp];
    return [...rel.tags, ...temp];
  }

  _groupTags(e) {
    let out = null;
    if (e.species) {
      const g = this.map.get(`species:${e.species}`);
      if (g && g.tags.length) out = g.tags;
    }
    if (e.faction) {
      const g = this.map.get(`faction:${e.faction}`);
      if (g && g.tags.length) out = out ? [...out, ...g.tags] : g.tags;
    }
    return out;
  }

  _entity(e) {
    if (!e) return null;
    if (typeof e === 'object') return e;
    return this.game?.entities?.get?.(e) || this.map.get(e) || { id: String(e) };
  }

  _isPlayerOrSelf(e) {
    return e === this.game?.player || e === this.owner || e.id === PLAYER_ID || e.id === COMPANION_ID || e.id === this.owner?.id;
  }

  // The attack-mode filter (DESIGN §9): the player and Lyra; anyone tagged friend or pet;
  // anyone with affinity >= 30; villagers and guards unless tagged enemy. Never anyone
  // tagged enemy. An individual's own tags outrank tags given to its whole kind.
  isFriend(entity) {
    const e = this._entity(entity);
    if (!e) return false;
    if (this._isPlayerOrSelf(e)) return true;
    const own = this._ownTags(e);
    if (own) {
      if (own.includes('enemy')) return false;
      if (own.includes('friend') || own.includes('pet')) return true;
    }
    const group = this._groupTags(e);
    if (group) {
      if (group.includes('enemy')) return false;
      if (group.includes('friend') || group.includes('pet')) return true;
    }
    const rel = this.map.get(e.id);
    if (rel && rel.affinity >= 30) return true;
    const faction = e.faction ?? rel?.faction;
    return faction === 'villager' || faction === 'guard' || faction === 'player';
  }

  // Tagged enemy, affinity <= -40, or a hostile faction. Never true for anyone isFriend
  // accepts, so the two filters cannot disagree.
  isEnemy(entity) {
    const e = this._entity(entity);
    if (!e) return false;
    if (this._isPlayerOrSelf(e)) return false;
    if (this.isFriend(e)) return false;
    const own = this._ownTags(e);
    if (own && own.includes('enemy')) return true;
    const group = this._groupTags(e);
    if (group && group.includes('enemy')) return true;
    const rel = this.map.get(e.id);
    if (rel && rel.affinity <= -40) return true;
    const faction = e.faction ?? rel?.faction;
    return !!faction && factionRelation('player', faction) === 'hostile';
  }

  // Her own words about someone, from the numbers, tags and notes. Rewritten when the
  // bond level changes or affinity has moved a lot, unless the brain or the player
  // wrote it within the last day.
  refreshOpinion(rel, force = false) {
    if (!rel || rel.kind === 'group' || rel.opinionBy === 'locked') return;
    const level = bondOf(rel).level;
    const recentExternal = (rel.opinionBy === 'brain' || rel.opinionBy === 'player') && nowT(this.game) - rel.opinionT < DAY_SECONDS;
    if (recentExternal && !force) return;
    if (!force && rel.opinion && level === rel.opinionLevel && Math.abs(rel.affinity - rel.opinionAff) < 12) return;
    rel.opinion = this.composeOpinion(rel);
    rel.opinionBy = 'self';
    rel.opinionT = nowT(this.game);
    rel.opinionAff = rel.affinity;
    rel.opinionLevel = level;
  }

  composeOpinion(rel) {
    if (rel.id === PLAYER_ID) return composePlayerOpinion(rel);
    const n = firstName(rel.name);
    const a = rel.affinity;
    const parts = [];
    if (rel.tags.includes('pet')) parts.push(`${n} is ours now, and I'd fight anything that looked at ${n} wrong.`);
    else if (a <= -40) parts.push(`I can't stand ${n}, and I don't say that about many people.`);
    else if (a <= -10) parts.push(`${n} and I don't get on.`);
    else if (a < 15) parts.push(rel.familiarity < 20 ? `I don't know ${n} well enough to say much yet.` : `${n}'s all right, I suppose. We haven't found our footing.`);
    else if (a < 45) parts.push(`I like ${n}.`);
    else if (a < 75) parts.push(`I'm fond of ${n}, more than I expected to be.`);
    else parts.push(`${n} is dear to me.`);
    if (rel.tags.includes('enemy')) parts.push("An enemy now, and I don't use that word lightly.");
    else if (rel.tags.includes('friend') && a < 45) parts.push('A friend, whatever else.');
    if (rel.trust >= 65) parts.push(`I'd trust ${n} with my life.`);
    else if (rel.trust < 15 && rel.familiarity >= 20) parts.push("I wouldn't turn my back on them yet.");
    if (rel.respect >= 60) parts.push(`And I respect ${n}, truly.`);
    if (rel.fear >= 40) parts.push(`Truth be told, ${n} frightens me a little.`);
    const note = [...rel.notes].reverse().find((x) => x.source !== 'self' && !/^(i|my|i'm|i've)\b/i.test(x.text));
    if (note) parts.push(`Last I heard, ${lowerStart(note.text.replace(/[.!]+$/, ''))}.`);
    return shorten(parts.join(' '), LIMITS.opinion);
  }

  _history(rel, text) {
    const day = dayOf(nowT(this.game));
    rel.history.push(`Day ${day}: ${shorten(text, 90)}`);
    if (rel.history.length > LIMITS.history) rel.history.splice(0, rel.history.length - LIMITS.history);
  }

  _emit(rel, changes, reason) {
    this.game?.bus?.emit?.('relationship_changed', { owner: this.owner, personId: rel.id, changes, reason: reason || '' });
  }

  serialize() {
    const out = [];
    for (const r of this.map.values()) {
      const o = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        affinity: r.affinity,
        trust: r.trust,
        respect: r.respect,
        familiarity: r.familiarity,
        fear: r.fear,
      };
      if (r.role) o.role = r.role;
      if (r.faction) o.faction = r.faction;
      if (r.species) o.species = r.species;
      if (r.npc) o.npc = true;
      if (r.absent) o.absent = true;
      if (r.call) o.call = r.call;
      if (r.calledBy) o.calledBy = r.calledBy;
      if (r.tags.length) o.tags = r.tags;
      if (r.notes.length) o.notes = r.notes.map((n) => ({ text: n.text, source: n.source, t: Math.round(n.t) }));
      if (r.opinion) {
        o.opinion = r.opinion;
        o.opinionBy = r.opinionBy;
        o.opinionT = Math.round(r.opinionT);
        o.opinionAff = r.opinionAff;
        o.opinionLevel = r.opinionLevel;
      }
      if (r.firstMet != null) o.firstMet = Math.round(r.firstMet);
      if (r.lastSeen != null) o.lastSeen = Math.round(r.lastSeen);
      if (r.interactions) o.interactions = r.interactions;
      if (r.history.length) o.history = r.history;
      out.push(o);
    }
    return out;
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    this.map.clear();
    for (const d of list) {
      if (!d || !d.id) continue;
      const r = makeRel(d.id, d);
      for (const k of STATS) if (Number.isFinite(d[k])) r[k] = clamp(d[k], k === 'affinity' ? -100 : 0, 100);
      r.tags = Array.isArray(d.tags) ? d.tags.map(normalizeTag).filter(Boolean).slice(0, 12) : [];
      r.notes = Array.isArray(d.notes)
        ? d.notes
            .filter((n) => n && n.text)
            .slice(-LIMITS.notes)
            .map((n) => ({ text: String(n.text).slice(0, LIMITS.noteText), source: n.source || 'self', t: Number(n.t) || 0 }))
        : [];
      r.opinion = d.opinion ? String(d.opinion).slice(0, LIMITS.opinion) : '';
      r.opinionBy = d.opinionBy || 'self';
      r.opinionT = Number(d.opinionT) || 0;
      r.opinionAff = Number.isFinite(d.opinionAff) ? d.opinionAff : r.affinity;
      r.opinionLevel = Number.isFinite(d.opinionLevel) ? d.opinionLevel : bondOf(r).level;
      r.firstMet = Number.isFinite(d.firstMet) ? d.firstMet : null;
      r.lastSeen = Number.isFinite(d.lastSeen) ? d.lastSeen : null;
      r.interactions = Number(d.interactions) || 0;
      r.history = Array.isArray(d.history) ? d.history.map(String).slice(-LIMITS.history) : [];
      if (d.call) r.call = String(d.call).slice(0, 40);
      if (d.calledBy) r.calledBy = String(d.calledBy).slice(0, 60);
      this.map.set(r.id, r);
    }
  }
}

function lowerStart(s) {
  if (!s) return s;
  // Names stay capitalized; ordinary words do not.
  return /^[A-Z][a-z]+\b/.test(s) && !/^(The|A|An|She|He|They|It|There|This|That|When|If)\b/.test(s) ? s : s[0].toLowerCase() + s.slice(1);
}

function composePlayerOpinion(rel) {
  const a = rel.affinity;
  const parts = [];
  if (a <= -40) parts.push("Honestly? I don't like who you've been lately.");
  else if (a <= -10) parts.push("We've had our rough patches, you and I.");
  else if (a < 15) parts.push("You stood with me against the wolves. I noticed. I haven't decided yet what else you are to me.");
  else if (a < 30) parts.push("You stood with me against the wolves, and I'm starting to like you, too.");
  else if (a < 50) parts.push('I like you. More than I planned to when I took the hearthwatch.');
  else if (a < 75) parts.push("You're my friend. The real kind, the kind you'd walk into a ruin for.");
  else parts.push("You're home, I think. Wherever you are.");
  if (rel.trust >= 65) parts.push('I trust you with my life. I already have.');
  else if (rel.trust < 25) parts.push("I'm still learning to trust you.");
  if (rel.respect >= 60) parts.push('You fight well and you choose well, and the second part is rarer.');
  else if (rel.respect < 10) parts.push("And some of what you've done sits badly with me.");
  if (rel.fear >= 40) parts.push('Sometimes you scare me.');
  if (rel.familiarity < 40) parts.push("Neither of us knows where you come from. I'd like to.");
  return shorten(parts.join(' '), LIMITS.opinion);
}
