import { TILE } from '../../core/constants.js';
import { resolveItemId } from '../../entities/items.js';
import { say } from './lines.js';
import { allowedAt } from './safety.js';
import {
  rand,
  chance,
  dist,
  tileOf,
  tileCenter,
  walkable,
  standSpotFor,
  isActorAlive,
  itemsPhrase,
  nameOf,
  safe,
  warnOnce,
} from './util.js';

// Lyra's jobs (DESIGN §10): find the nearest valid thing she can reach, walk there,
// work it with the object work API, repeat until the amount, then deliver.
// Combat pauses a job simply by not calling update(); on resume she walks back.

export const JOBS = {
  chop_wood: {
    id: 'chop_wood',
    label: 'chopping wood',
    noun: 'wood',
    unit: ['wood', 'wood'],
    kind: 'object',
    types: ['tree'],
    items: ['wood'],
    particle: 'wood_chip',
    sound: 'chop',
    soundEvery: 0.55,
    defaultAmount: 5,
  },
  gather_herbs: {
    id: 'gather_herbs',
    label: 'gathering herbs',
    noun: 'herbs',
    unit: ['herb', 'herbs'],
    kind: 'object',
    types: ['herb', 'moonpetal'],
    items: ['herb', 'moonpetal'],
    prefer: { moonpetal: 40 },
    particle: 'leaf',
    sound: null,
    defaultAmount: 4,
  },
  forage: {
    id: 'forage',
    label: 'foraging',
    noun: 'food',
    unit: ['find', 'finds'],
    kind: 'object',
    types: ['berry_bush', 'herb', 'moonpetal'],
    items: ['berries', 'herb', 'moonpetal'],
    prefer: { berry_bush: 24 },
    particle: 'leaf',
    sound: null,
    defaultAmount: 6,
  },
  mine_ore: {
    id: 'mine_ore',
    label: 'mining ore',
    noun: 'ore',
    unit: ['chunk of ore', 'chunks of ore'],
    kind: 'object',
    types: ['ore', 'ore_iron', 'rock', 'crystal'],
    items: ['iron_ore', 'stone', 'crystal'],
    prefer: { ore: 48, ore_iron: 48, crystal: 32 },
    particle: 'stone_chip',
    sound: 'mine',
    soundEvery: 0.7,
    defaultAmount: 4,
  },
  fish: {
    id: 'fish',
    label: 'fishing',
    noun: 'fish',
    unit: ['fish', 'fish'],
    kind: 'fish',
    items: ['raw_fish'],
    defaultAmount: 3,
  },
  farm: {
    id: 'farm',
    label: 'harvesting crops',
    noun: 'crops',
    unit: ['crop', 'crops'],
    kind: 'object',
    types: ['crop'],
    items: ['turnip', 'wheat'],
    particle: 'leaf',
    sound: null,
    defaultAmount: 6,
  },
  cook: {
    id: 'cook',
    label: 'cooking',
    noun: 'food',
    unit: ['dish', 'dishes'],
    kind: 'cook',
    items: ['cooked_fish', 'stew', 'bread'],
    defaultAmount: null,
  },
  collect_loot: {
    id: 'collect_loot',
    label: 'collecting loot',
    noun: 'loot',
    unit: ['thing', 'things'],
    kind: 'loot',
    items: null,
    defaultAmount: null,
  },
};

// Jobs that are really standing orders; the jobs plugin turns them into directives.
export const DIRECTIVE_JOBS = ['patrol', 'guard'];

export const RECIPES = [
  { id: 'cooked_fish', needs: { raw_fish: 1 }, seconds: 4, words: /\b(fish|raw_fish|cooked_fish|grill(?:ed)?)\b/ },
  { id: 'stew', needs: { turnip: 2 }, seconds: 6, words: /\b(stew|turnips?|soup)\b/ },
  { id: 'bread', needs: { wheat: 2 }, seconds: 5, words: /\b(bread|wheat|loaf|loaves|bake)\b/ },
];

const JOB_WORDS = [
  [/\b(chop|wood|logs?|lumber|timber|trees?|firewood)\b/, 'chop_wood'],
  [/\b(herbs?|silverleaf|moonpetals?|flowers?)\b/, 'gather_herbs'],
  [/\b(forag\w*|berr(?:y|ies)|food)\b/, 'forage'],
  [/\b(min(?:e|ing)|ore|iron|stones?|rocks?|crystals?|quarry)\b/, 'mine_ore'],
  [/\b(fish(?:ing)?|catch)\b/, 'fish'],
  [/\b(farm(?:ing)?|crops?|harvest|turnips?|wheat|tobias)\b/, 'farm'],
  [/\b(cook(?:ing)?|stew|bread|bake|grill|meal|dinner|supper)\b/, 'cook'],
  [/\b(loot|drops|collect|spoils|pickups?)\b/, 'collect_loot'],
  [/\b(patrol\w*)\b/, 'patrol'],
  [/\b(guard\w*)\b/, 'guard'],
];

// "chop_wood", "chop wood", "cook stew", "fishing" -> { id, targetRef } or null.
// The cook job may name a dish or ingredient ("cook fish" -> targetRef 'fish').
export function resolveJobId(text) {
  if (!text) return null;
  const raw = String(text).toLowerCase().trim();
  const snake = raw.replace(/[\s-]+/g, '_');
  if (JOBS[snake] || DIRECTIVE_JOBS.includes(snake)) return { id: snake, targetRef: null };
  // Cooking first: "cook the fish" mentions fish but is a cooking job.
  if (/\b(cook|bake|grill|stew|bread)\b/.test(raw)) {
    const rest = raw.replace(/\b(cook(?:ing)?|some|the|a|me|us|up|please)\b/g, ' ').trim();
    return { id: 'cook', targetRef: rest || null };
  }
  for (const [re, id] of JOB_WORDS) if (re.test(raw)) return { id, targetRef: null };
  return null;
}

function canWorkSafe(o, actor) {
  if (!o || o.removed) return false;
  if (typeof o.canWork !== 'function') return false;
  try {
    return !!o.canWork(actor);
  } catch (err) {
    warnOnce('object.canWork failed', err);
    return false;
  }
}

function recipeAvailable(r, inv) {
  for (const [id, n] of Object.entries(r.needs)) if (!inv?.has?.(id, n)) return false;
  return true;
}

export function recipesFor(targetRef) {
  if (!targetRef) return RECIPES;
  const t = String(targetRef).toLowerCase();
  const match = RECIPES.filter((r) => r.words.test(t));
  return match.length ? match : RECIPES;
}

export function cookableCount(inv, targetRef = null) {
  let total = 0;
  for (const r of recipesFor(targetRef)) {
    let n = Infinity;
    for (const [id, k] of Object.entries(r.needs)) n = Math.min(n, Math.floor((inv?.count?.(id) || 0) / k));
    total += n === Infinity ? 0 : n;
  }
  return total;
}

export class JobRunner {
  constructor(behavior) {
    this.b = behavior;
    this.active = false;
    this.job = null;
    this.amount = null;
    this.deliverTo = 'player';
    this.targetRef = null;
    this.count = 0;
    this.gathered = {};
    this.phase = 'idle';
    this.target = null;
    this.stand = null;
    this.candidates = [];
    this.ci = 0;
    this.blacklist = new Map();
    this.fxT = 0;
    this.sndT = 0;
    this.stallT = 0;
    this.blockedT = 0;
    this.workT = 0;
    this.biteT = 0;
    this.recipe = null;
    this.spot = null;
    this.searchX = 0;
    this.searchY = 0;
    this.searchR = 40 * TILE;
    this.partialNote = false;
    this.edgeSaid = false;
    this.quietKeep = false;
    this.lootItem = null;
    this.preferred = null;
    this.own = false; // her own work (her plan, for her purse), not an order
  }

  get game() {
    return this.b.game;
  }

  get actor() {
    return this.b.actor;
  }

  // Validate and begin. Returns { ok, message }; on ok the job is active.
  start(spec) {
    const job = JOBS[spec.job];
    if (!job) return { ok: false, message: say.jobUnknown(spec.job) };
    const a = this.actor;
    this.reset();
    this.job = job;
    this.quietKeep = !!spec.quiet;
    this.own = !!spec.own;
    this.deliverTo = this.deliveryTarget(spec.deliverTo);
    this.targetRef = spec.targetRef ?? null;
    this.count = Math.max(0, spec.count || 0);
    this.gathered = { ...(spec.gathered || {}) };
    this.searchX = a.x;
    this.searchY = a.y;
    this.searchR = job.kind === 'loot' ? (spec.radius ?? 12 * TILE) : 40 * TILE;
    this.applyTargetRef();

    let amount = Number.isFinite(spec.amount) && spec.amount > 0 ? Math.round(spec.amount) : job.defaultAmount;
    if (job.kind === 'cook') {
      const can = cookableCount(a.inventory, this.targetRef);
      if (!can) {
        const what = this.targetRef ? recipesFor(this.targetRef)[0] : null;
        return { ok: false, message: say.noIngredients(what ? ingredientWord(what) : null) };
      }
      amount = amount ? Math.min(amount, can) : Math.min(can, 6);
    }
    this.amount = amount ?? null;
    this.active = true;
    this.beginSearch();
    // Find something reachable now, so the answer to the order is honest.
    const found = spec.resume ? 'searching' : this.searchStep(4);
    if (found === 'none') {
      this.active = false;
      if (job.kind === 'cook') return { ok: false, message: say.noFire() };
      if (job.kind === 'loot') return { ok: false, message: say.nothingToPickUp(this.lootItem) };
      return { ok: false, message: say.noTargets(job) };
    }
    if (!spec.resume) this.emit('job_started', { label: job.label, amount: this.amount, deliverTo: this.deliverTo });
    return { ok: true, message: spec.quiet ? say.pickingUp() : say.jobStart(job, this.amount, this.deliverTo) };
  }

  // 'player' | 'chest' | 'keep', or the id of someone to hand the haul to (a buyer).
  deliveryTarget(v) {
    if (v == null || v === '') return 'player';
    if (['player', 'chest', 'keep'].includes(v)) return v;
    const e = this.game.entities?.get?.(String(v));
    return e && e.type === 'actor' && e !== this.actor ? e.id : 'player';
  }

  reset() {
    this.active = false;
    this.phase = 'idle';
    this.target = null;
    this.stand = null;
    this.candidates = [];
    this.ci = 0;
    this.recipe = null;
    this.spot = null;
    this.fxT = 0;
    this.sndT = 0;
    this.stallT = 0;
    this.blockedT = 0;
    this.workT = 0;
    this.partialNote = false;
    this.edgeSaid = false;
    this.lootItem = null;
  }

  // targetRef may be: an object id (work that one first), a location (search there),
  // a dish/ingredient (cook) or an item (loot filter).
  applyTargetRef() {
    const g = this.game;
    const ref = this.targetRef;
    this.preferred = null;
    this.lootItem = null;
    if (!ref) return;
    if (this.job.kind === 'loot') {
      this.lootItem = resolveItemId(ref);
      return;
    }
    if (this.job.kind === 'cook') return;
    const obj = safe('objects.get', () => g.objects?.get?.(ref));
    if (obj) {
      this.preferred = obj;
      return;
    }
    const loc = safe('locations.find', () => g.locations?.get?.(ref) || g.locations?.find?.(ref));
    if (loc?.center) {
      this.searchX = loc.center.x;
      this.searchY = loc.center.y;
      const b = loc.bounds;
      if (b) this.searchR = Math.max(10 * TILE, (Math.max(b.w, b.h) * TILE) / 1.4);
    }
  }

  stop() {
    this.active = false;
    this.phase = 'idle';
    this.target = null;
    this.b.steering.stop();
  }

  emit(type, extra = {}) {
    const g = this.game;
    g.bus?.emit?.(type, { actor: this.actor, job: this.job?.id ?? null, own: this.own, ...extra });
  }

  // --- searching ---

  beginSearch() {
    this.phase = 'find';
    this.target = null;
    this.stand = null;
    this.candidates = this.collectCandidates();
    this.ci = 0;
  }

  isBlacklisted(o) {
    const until = this.blacklist.get(o);
    return until != null && until > this.b.t;
  }

  collectCandidates() {
    const job = this.job;
    const g = this.game;
    const a = this.actor;
    const out = [];
    if (job.kind === 'object') {
      const filter = (o) => job.types.includes(o.objType) && !this.isBlacklisted(o) && canWorkSafe(o, a) && allowedAt(g, a, o.x, o.y);
      if (this.preferred && filter(this.preferred)) out.push({ obj: this.preferred, score: -1e9 });
      let list = safe('objects.inRadius', () => g.objects?.inRadius?.(this.searchX, this.searchY, this.searchR, filter), []) || [];
      if (!list.length && !this.preferred) list = safe('objects.all', () => (g.objects?.all?.() || []).filter(filter), []) || [];
      const night = !!g.clock?.isNight;
      for (const o of list) {
        if (o === this.preferred) continue;
        let bonus = job.prefer?.[o.objType] || 0;
        if (o.objType === 'moonpetal' && night) bonus += 20;
        out.push({ obj: o, score: dist(a.x, a.y, o.x, o.y) - bonus });
      }
    } else if (job.kind === 'loot') {
      const list = g.entities?.list || g.entities?.all?.() || [];
      for (const e of list) {
        if (e.type !== 'pickup' || e.removed || this.isBlacklisted(e)) continue;
        if (this.lootItem && e.itemId !== this.lootItem) continue;
        if (dist(this.searchX, this.searchY, e.x, e.y) > this.searchR) continue;
        out.push({ obj: e, score: dist(a.x, a.y, e.x, e.y) });
      }
    } else if (job.kind === 'cook') {
      const isFire = (o) => (o.objType === 'campfire' || o.objType === 'hearth') && !this.isBlacklisted(o) && allowedAt(g, a, o.x, o.y);
      const list = safe('objects.inRadius', () => g.objects?.inRadius?.(a.x, a.y, 90 * TILE, isFire), []) || [];
      for (const o of list) out.push({ obj: o, score: dist(a.x, a.y, o.x, o.y) });
    } else if (job.kind === 'fish') {
      for (const s of this.fishingSpots()) if (!this.isBlacklisted(s.obj || spotKey(s))) out.push({ obj: null, spot: s, score: s.score });
    }
    out.sort((p, q) => p.score - q.score);
    return out.slice(0, 12);
  }

  // Dock fishing spots first, then any walkable tile beside water near her.
  fishingSpots() {
    const g = this.game;
    const a = this.actor;
    const map = g.map;
    const spots = [];
    const marker = safe('objects.nearest', () => g.objects?.nearest?.('fishing_spot', a.x, a.y, 90 * TILE));
    if (marker) {
      const tx = marker.tx ?? tileOf(marker.x);
      const ty = marker.ty ?? tileOf(marker.y - 1);
      const w = this.waterNear(tx, ty, 2);
      if (w) spots.push({ x: tileCenter(tx), y: tileCenter(ty), wx: w.x, wy: w.y, dir: w.dir, dock: true, obj: marker, score: dist(a.x, a.y, tileCenter(tx), tileCenter(ty)) - 160 });
    }
    if (map?.isWater) {
      this.scanShore(tileOf(a.x), tileOf(a.y), 22, spots);
      if (spots.length < 2) {
        const lake = safe('locations.get', () => g.locations?.get?.('mirror_lake'));
        if (lake?.center) this.scanShore(tileOf(lake.center.x), tileOf(lake.center.y), 18, spots);
      }
    }
    return spots;
  }

  scanShore(cx, cy, r, out) {
    const g = this.game;
    const a = this.actor;
    const map = g.map;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (map.isWater(tx, ty)) continue;
        const w = this.waterNear(tx, ty, 1);
        if (!w || !walkable(g, tx, ty, a)) continue;
        const x = tileCenter(tx);
        const y = tileCenter(ty);
        out.push({ x, y, wx: w.x, wy: w.y, dir: w.dir, dock: false, obj: null, score: dist(a.x, a.y, x, y) });
      }
    }
  }

  waterNear(tx, ty, r) {
    const map = this.game.map;
    if (!map?.isWater) return null;
    for (let k = 1; k <= r; k++) {
      for (const [dx, dy, dir] of [
        [0, 1, 'down'],
        [1, 0, 'right'],
        [-1, 0, 'left'],
        [0, -1, 'up'],
      ]) {
        if (map.isWater(tx + dx * k, ty + dy * k)) return { x: tileCenter(tx + dx * k), y: tileCenter(ty + dy * k), dir };
      }
    }
    return null;
  }

  // Test up to `tries` candidates for reachability. Returns 'found' | 'searching' | 'none'.
  searchStep(tries) {
    const g = this.game;
    const a = this.actor;
    const pf = g.pathfinder;
    for (let n = 0; n < tries; n++) {
      if (this.ci >= this.candidates.length) return 'none';
      const c = this.candidates[this.ci++];
      let stand;
      if (this.job.kind === 'fish') stand = { x: c.spot.x, y: c.spot.y };
      else if (this.job.kind === 'loot') stand = { x: c.obj.x, y: c.obj.y };
      else if (this.job.kind === 'cook' && dist(a.x, a.y, c.obj.x, c.obj.y) <= 3 * TILE) stand = { x: a.x, y: a.y };
      else stand = standSpotFor(g, c.obj, a.x, a.y, a);
      if (!stand) continue;
      let path = null;
      if (dist(a.x, a.y, stand.x, stand.y) > 6 && pf?.find) {
        path = safe('pathfinder.find', () => pf.find(a.x, a.y, stand.x, stand.y, { actor: a, allowDoors: true, maxNodes: 12000 }));
        if (!path) {
          if (c.obj) this.blacklist.set(c.obj, this.b.t + 30);
          continue;
        }
      }
      this.target = c.obj;
      this.spot = c.spot || null;
      this.stand = stand;
      this.phase = 'walk';
      this.blockedT = 0;
      if (path) this.b.steering.adoptPath(path, stand.x, stand.y);
      return 'found';
    }
    return 'searching';
  }

  // --- the state machine ---

  // Returns 'running' | 'done' | 'failed'.
  update(dt) {
    if (!this.active) return 'done';
    switch (this.phase) {
      case 'find':
        return this.stepFind();
      case 'walk':
        return this.stepWalk(dt);
      case 'work':
        return this.stepWork(dt);
      case 'deliver':
        return this.stepDeliver(dt);
      default:
        return 'running';
    }
  }

  stepFind() {
    this.b.steering.stop();
    const r = this.searchStep(2);
    if (r !== 'none') return 'running';
    // Nothing left in reach.
    if (this.job.kind === 'loot' && this.count > 0) return this.beginDeliver();
    if (this.count > 0) {
      if (this.amount && this.count < this.amount && !this.own) {
        this.partialNote = true;
        this.b.say(say.jobPartial(this.job, this.count, this.amount), { force: true });
      }
      return this.beginDeliver();
    }
    return this.fail(this.job.kind === 'cook' ? say.noFire() : say.noTargets(this.job));
  }

  stepWalk(dt) {
    const a = this.actor;
    const t = this.target;
    if (t && (t.removed || (this.job.kind === 'object' && !canWorkSafe(t, a)))) {
      this.beginSearch();
      return 'running';
    }
    const reach = this.job.kind === 'loot' ? 8 : 4;
    const res = this.b.steering.moveTo(this.stand.x, this.stand.y, dt, { arrive: reach, run: dist(a.x, a.y, this.stand.x, this.stand.y) > 12 * TILE ? 1.25 : 1 });
    const nearObj = t && this.job.kind === 'object' && dist(a.x, a.y, t.x, t.y) < 22;
    if (res === 'arrived' || nearObj) {
      this.b.steering.stop();
      if (this.job.kind === 'loot') return this.collectPickup(t);
      this.phase = 'work';
      this.stallT = 0;
      this.workT = 0;
      this.fxT = 0;
      this.sndT = 0;
      this.biteT = rand(2.5, 4.5);
      return 'running';
    }
    if (res === 'blocked' || res === 'locked' || res === 'stuck') {
      this.blockedT += dt;
      if (this.blockedT > 2.5 || res === 'locked' || res === 'stuck') {
        const key = t || (this.spot ? this.spot.obj || spotKey(this.spot) : null);
        if (key) this.blacklist.set(key, this.b.t + 30);
        this.beginSearch();
      }
    } else this.blockedT = 0;
    return 'running';
  }

  stepWork(dt) {
    const a = this.actor;
    const kind = this.job.kind;
    const reach = kind === 'cook' ? 3 * TILE : 24;
    if (dist(a.x, a.y, this.stand.x, this.stand.y) > 12 && !(this.target && dist(a.x, a.y, this.target.x, this.target.y) < reach)) {
      this.phase = 'walk';
      return 'running';
    }
    this.b.steering.stop();
    if (kind === 'fish') return this.stepFish(dt);
    if (kind === 'cook') return this.stepCook(dt);
    return this.stepWorkObject(dt);
  }

  stepWorkObject(dt) {
    const g = this.game;
    const a = this.actor;
    const o = this.target;
    if (!o || o.removed || !canWorkSafe(o, a)) {
      this.beginSearch();
      return 'running';
    }
    a.faceToward(o.x, o.y - 4);
    a.setState('work');
    let res = null;
    try {
      res = o.work(a, dt);
    } catch (err) {
      warnOnce('object.work failed', err);
      this.blacklist.set(o, this.b.t + 60);
      this.beginSearch();
      return 'running';
    }
    this.fxT -= dt;
    if (this.fxT <= 0 && this.job.particle) {
      this.fxT = 0.32;
      safe('particles.emit', () => g.particles?.emit?.(this.job.particle, o.x + rand(-4, 4), o.y - rand(6, 14), { count: 3 }));
    }
    if (this.job.sound) {
      this.sndT -= dt;
      if (this.sndT <= 0) {
        this.sndT = this.job.soundEvery || 0.6;
        safe('audio.play', () => g.audio?.play?.(this.job.sound, { x: o.x, y: o.y }));
      }
    }
    this.stallT += dt;
    if (res?.done) {
      a.setState('idle');
      this.gain(res.items || [], o);
      if (this.amount && this.count >= this.amount) return this.beginDeliver();
      this.beginSearch();
      return 'running';
    }
    if (this.stallT > (o.workSeconds || 3) * 3 + 6) {
      this.blacklist.set(o, this.b.t + 60);
      this.beginSearch();
    }
    return 'running';
  }

  stepFish(dt) {
    const g = this.game;
    const a = this.actor;
    const s = this.spot;
    a.faceDir?.(s.dir);
    a.setState('work');
    if (!this.edgeSaid && s.dock) {
      this.edgeSaid = true;
      if (chance(0.35)) this.b.say(say.edgeNerves(), { kind: 'whisper' });
    }
    // The dock's fishing spot has the lake's own catch rules (the work API).
    if (s.obj && typeof s.obj.work === 'function' && canWorkSafe(s.obj, a)) return this.stepFishSpot(dt, s);
    this.biteT -= dt;
    if (this.biteT > 0) return 'running';
    this.biteT = rand(3, 5.5);
    safe('particles.emit', () => g.particles?.emit?.('splash', s.wx, s.wy, { count: 6 }));
    safe('audio.play', () => g.audio?.play?.('splash', { x: s.wx, y: s.wy }));
    const phase = g.clock?.phase;
    let p = 0.42;
    if (phase === 'dawn' || phase === 'dusk') p += 0.13;
    if (g.clock?.weather?.type === 'rain') p += 0.08;
    if (!chance(p)) {
      if (chance(0.12)) this.b.say(say.fishMiss(), { kind: 'whisper' });
      return 'running';
    }
    safe('bubbles.icon', () => g.bubbles?.icon?.(a, '!'));
    if (chance(0.3)) this.b.say(say.fishCatch());
    this.gain([{ id: 'raw_fish', qty: 1 }], s.obj || null);
    g.bus?.emit?.('harvest', { actor: a, object: s.obj || null, itemId: 'raw_fish', qty: 1 });
    if (this.amount && this.count >= this.amount) return this.beginDeliver();
    return 'running';
  }

  stepFishSpot(dt, s) {
    const g = this.game;
    const a = this.actor;
    const spot = s.obj;
    let res = null;
    try {
      res = spot.work(a, dt);
    } catch (err) {
      warnOnce('fishing_spot.work failed', err);
      s.obj = null; // fish the old way from here
      return 'running';
    }
    // A line in the water: a little ripple now and then.
    this.fxT -= dt;
    if (this.fxT <= 0) {
      this.fxT = rand(1.1, 1.8);
      safe('particles.emit', () => g.particles?.emit?.('splash', s.wx + rand(-3, 3), s.wy + rand(-2, 2), { count: 2 }));
    }
    if (!res?.done) return 'running';
    const fish = (res.items || []).filter((it) => it?.id && it.qty > 0);
    safe('audio.play', () => g.audio?.play?.('splash', { x: s.wx, y: s.wy }));
    safe('particles.emit', () => g.particles?.emit?.('splash', s.wx, s.wy, { count: 6 }));
    if (!fish.length) {
      if (chance(0.15)) this.b.say(say.fishMiss(), { kind: 'whisper' });
      return 'running';
    }
    safe('bubbles.icon', () => g.bubbles?.icon?.(a, '!'));
    if (chance(0.3)) this.b.say(say.fishCatch());
    this.gain(fish, spot);
    if (this.amount && this.count >= this.amount) return this.beginDeliver();
    return 'running';
  }

  stepCook(dt) {
    const g = this.game;
    const a = this.actor;
    const fire = this.target;
    if (fire) a.faceToward(fire.x, fire.y - 4);
    a.setState('work');
    if (!this.recipe) {
      this.recipe = recipesFor(this.targetRef).find((r) => recipeAvailable(r, a.inventory)) || null;
      this.workT = 0;
      if (!this.recipe) return this.count > 0 ? this.beginDeliver() : this.fail(say.noIngredients());
    }
    this.workT += dt;
    this.fxT -= dt;
    if (this.fxT <= 0 && fire) {
      this.fxT = 0.45;
      safe('particles.emit', () => g.particles?.emit?.('smoke', fire.x + rand(-3, 3), fire.y - 10, { count: 2 }));
      if (chance(0.5)) safe('particles.emit', () => g.particles?.emit?.('ember', fire.x, fire.y - 6, { count: 2 }));
    }
    if (this.workT < this.recipe.seconds) return 'running';
    const r = this.recipe;
    this.recipe = null;
    if (!recipeAvailable(r, a.inventory)) return 'running';
    for (const [id, n] of Object.entries(r.needs)) a.inventory.remove(id, n);
    if (this.count === 0) this.b.say(say.cooked(r.id));
    safe('audio.play', () => g.audio?.play?.('pickup', { x: a.x, y: a.y }));
    this.gain([{ id: r.id, qty: 1 }], fire, true);
    if (this.amount && this.count >= this.amount) return this.beginDeliver();
    return 'running';
  }

  collectPickup(p) {
    const g = this.game;
    const a = this.actor;
    if (!p || p.removed) {
      this.beginSearch();
      return 'running';
    }
    const itemId = p.itemId;
    const qty = p.qty ?? 1;
    let ok = true;
    if (typeof p.collect === 'function') {
      const r = safe('pickup.collect', () => p.collect(a), false);
      ok = r !== false && (r || p.removed || p.collected);
    } else {
      a.inventory.add(itemId, qty);
      p.removed = true;
      g.bus?.emit?.('item_gained', { actor: a, itemId, qty, from: 'pickup' });
    }
    if (!ok) {
      this.blacklist.set(p, this.b.t + 30);
    } else {
      this.gathered[itemId] = (this.gathered[itemId] || 0) + qty;
      this.count += qty;
      this.emit('job_progress', { progress: this.amount ? Math.min(1, this.count / this.amount) : null, count: this.count, amount: this.amount, itemId, qty });
      if (this.amount && this.count >= this.amount) return this.beginDeliver();
    }
    this.beginSearch();
    return 'running';
  }

  // Items arrive in her pack; the ones this job is about count toward the amount.
  gain(items, source, quiet = false) {
    const g = this.game;
    const a = this.actor;
    let counted = 0;
    for (const it of items) {
      const id = it?.id;
      const qty = Math.max(0, Math.round(it?.qty ?? 1));
      if (!id || !qty) continue;
      a.inventory.add(id, qty);
      g.bus?.emit?.('item_gained', { actor: a, itemId: id, qty, from: 'job' });
      this.gathered[id] = (this.gathered[id] || 0) + qty;
      if (!this.job.items || this.job.items.includes(id)) counted += qty;
    }
    if (!counted) return;
    this.count += counted;
    if (!quiet && this.job.kind === 'object') safe('audio.play', () => g.audio?.play?.('pickup', { x: a.x, y: a.y, volume: 0.6 }));
    this.emit('job_progress', { progress: this.amount ? Math.min(1, this.count / this.amount) : null, count: this.count, amount: this.amount, object: source || null });
  }

  // --- delivery ---

  gatheredList() {
    const a = this.actor;
    const out = [];
    for (const [id, qty] of Object.entries(this.gathered)) {
      const have = Math.min(qty, a.inventory?.count?.(id) || 0);
      if (have > 0) out.push({ id, qty: have });
    }
    return out;
  }

  beginDeliver() {
    this.phase = 'deliver';
    this.target = null;
    this.blockedT = 0;
    this.actor.setState('idle');
    if (this.deliverTo === 'keep' || !this.gatheredList().length) return this.finish(null);
    return 'running';
  }

  stepDeliver(dt) {
    const g = this.game;
    const a = this.actor;
    if (this.deliverTo !== 'player' && this.deliverTo !== 'chest' && this.deliverTo !== 'keep') {
      const who = g.entities?.get?.(this.deliverTo);
      if (!who || !isActorAlive(who)) return this.finish(null, true);
      const d = dist(a.x, a.y, who.x, who.y);
      const res = this.b.steering.moveTo(who.x, who.y, dt, { arrive: 22, run: d > 12 * TILE ? 1.2 : 1, ignore: who, maxNodes: 20000 });
      if (res === 'arrived') return this.handOver(who);
      return this.checkDeliverBlocked(res, dt);
    }
    if (this.deliverTo === 'player') {
      const p = g.player;
      if (!p || !isActorAlive(p)) return this.finish(null);
      const d = dist(a.x, a.y, p.x, p.y);
      const res = this.b.steering.moveTo(p.x, p.y, dt, { arrive: 22, run: d > 10 * TILE ? 1.45 : d > 64 ? 1.2 : 1 });
      if (res === 'arrived') return this.handOver(p);
      return this.checkDeliverBlocked(res, dt);
    }
    const chest = safe('objects.get', () => g.objects?.get?.('home_chest')) || safe('objects.nearest', () => g.objects?.nearest?.('chest', a.x, a.y, 200 * TILE));
    if (!chest?.inventory) return this.finish(null);
    if (!this.stand || this.target !== chest) {
      this.target = chest;
      this.stand = standSpotFor(g, chest, a.x, a.y, a) || { x: chest.x, y: chest.y + 8 };
    }
    const res = this.b.steering.moveTo(this.stand.x, this.stand.y, dt, { arrive: 5, run: dist(a.x, a.y, chest.x, chest.y) > 10 * TILE ? 1.3 : 1 });
    if (res === 'arrived' || dist(a.x, a.y, chest.x, chest.y) < 20) return this.stashInChest(chest);
    return this.checkDeliverBlocked(res, dt);
  }

  checkDeliverBlocked(res, dt) {
    if (res === 'blocked' || res === 'locked' || res === 'stuck') {
      this.blockedT += dt;
      if (this.blockedT > 6) {
        if (this.deliverTo === 'player') this.b.say("I couldn't get to you, so I'll hold on to everything for now.", { force: true });
        return this.finish(null, true);
      }
    } else this.blockedT = 0;
    return 'running';
  }

  // Hand the haul to the player, or to someone she works for (a buyer: the
  // autonomy module credits her purse from job_done's `earned`).
  handOver(p) {
    const g = this.game;
    const a = this.actor;
    const isPlayer = p === g.player;
    a.faceToward(p.x, p.y);
    const given = [];
    let earned = 0;
    const buys = !isPlayer ? p.profile?.shop?.buys || null : null;
    for (const { id, qty } of this.gatheredList()) {
      const n = p.inventory ? moveItems(a.inventory, p.inventory, id, qty) : a.inventory.remove(id, qty);
      if (!n) continue;
      given.push({ id, qty: n });
      if (buys && Number.isFinite(buys[id])) earned += buys[id] * n;
      g.bus?.emit?.('item_given', { from: a, to: p, itemId: id, qty: n, sale: !isPlayer });
      if (isPlayer) g.bus?.emit?.('item_gained', { actor: p, itemId: id, qty: n, from: 'gift' });
    }
    if (given.length) {
      safe('audio.play', () => g.audio?.play?.(isPlayer ? 'pickup' : 'coin', { x: p.x, y: p.y }));
      if (isPlayer) {
        safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'heart'));
        this.b.say(say.jobDelivered(given, 'player'), { force: true });
      } else this.b.say(say.jobDeliveredTo(given, nameOf(g, p)));
    }
    const result = { items: given, deliveredTo: isPlayer ? 'player' : p.id };
    if (!isPlayer) {
      result.buyer = p.id;
      result.earned = earned;
    }
    return this.finish(result);
  }

  stashInChest(chest) {
    const g = this.game;
    const a = this.actor;
    a.faceToward(chest.x, chest.y);
    const stored = [];
    for (const { id, qty } of this.gatheredList()) {
      const n = moveItems(a.inventory, chest.inventory, id, qty);
      if (n) stored.push({ id, qty: n });
    }
    if (stored.length) {
      safe('audio.play', () => g.audio?.play?.('pickup', { x: chest.x, y: chest.y }));
      this.b.say(say.jobDelivered(stored, 'chest'), { force: true });
    }
    return this.finish({ items: stored, deliveredTo: 'chest' });
  }

  finish(result, silent = false) {
    const items = result?.items || this.gatheredList();
    const deliveredTo = result?.deliveredTo || 'keep';
    if (!result && !silent && !this.quietKeep && !this.own) {
      if (items.length) this.b.say(say.jobKept(items), { force: true });
      else if (this.job.kind !== 'loot') this.b.say(say.jobDoneNothing(this.job), { force: true });
    }
    this.active = false;
    this.phase = 'idle';
    this.target = null;
    this.emit('job_done', { result: { ...(result || {}), items, count: this.count, deliveredTo } });
    this.b.onJobEnded(true);
    return 'done';
  }

  fail(reason) {
    this.active = false;
    this.phase = 'idle';
    this.target = null;
    this.b.steering.stop();
    if (!this.own) this.b.say(reason, { force: true });
    this.emit('job_failed', { reason });
    this.b.onJobEnded(false);
    return 'failed';
  }

  // --- reporting ---

  status() {
    if (!this.active || !this.job) return '';
    if (this.phase === 'deliver') {
      const phrase = itemsPhrase(this.gatheredList());
      if (this.deliverTo === 'chest') return `taking ${phrase} to the chest`;
      if (this.deliverTo === 'player') return `bringing you ${phrase}`;
      return `taking ${phrase} to ${nameOf(this.game, this.game.entities?.get?.(this.deliverTo))}`;
    }
    if (this.amount) return `${this.job.label} (${this.count}/${this.amount})`;
    return this.count ? `${this.job.label} (${this.count})` : this.job.label;
  }

  serialize() {
    if (!this.active || !this.job) return null;
    return {
      job: this.job.id,
      amount: this.amount,
      deliverTo: this.deliverTo,
      targetRef: this.targetRef,
      count: this.count,
      gathered: { ...this.gathered },
      delivering: this.phase === 'deliver',
      own: this.own,
    };
  }

  // Resume a saved job without re-announcing it.
  restore(d) {
    if (!d || !JOBS[d.job]) return false;
    const r = this.start({ ...d, resume: true });
    if (!r.ok) return false;
    if (d.delivering) this.beginDeliver();
    return this.active;
  }
}

// Shore spots are places, not objects: remembered by their tile.
function spotKey(s) {
  return `${Math.round(s.x)},${Math.round(s.y)}`;
}

function moveItems(from, to, id, qty) {
  if (!from || !to) return 0;
  if (typeof from.transfer === 'function') return from.transfer(to, id, qty);
  const n = from.remove(id, qty);
  if (n) to.add(id, n);
  return n;
}

function ingredientWord(recipe) {
  const id = Object.keys(recipe.needs)[0];
  return { raw_fish: 'fish', turnip: 'turnips', wheat: 'wheat' }[id] || id;
}
