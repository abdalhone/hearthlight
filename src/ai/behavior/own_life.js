import { TILE, PLAYER_ID } from '../../core/constants.js';
import { resolveEntity } from '../resolve.js';
import { say } from './lines.js';
import { JOBS } from './jobs.js';
import { fireSeat } from './tasks.js';
import {
  asLocation,
  inBounds,
  isTooRisky,
  entranceSpot,
  chooseSafePlace,
  escapedFrom,
  edgeExit,
  atMapEdge,
  openSpotAway,
  companionshipOf,
  need,
} from './safety.js';
import { rand, chance, dist, tileOf, tileCenter, walkable, nearestWalkable, isActorAlive, onScreen, nameOf, placePhrase, safe } from './util.js';

// The directives of a person living her own life (DESIGN §16.9): her own day from
// her plan (`independent`), running to safety (`flee`), leaving (`leave`), keeping
// away from someone (`keep_away`) and waiting at a doorway instead of going in
// (`wait_outside`). These come from her own will (the autonomy module, her plan,
// self-preservation) as often as from the player, so none of them asks consent.

export const OWN_DIRECTIVES = ['independent', 'flee', 'leave', 'keep_away', 'wait_outside'];
export const LEAVE_MODES = ['apart', 'left', 'gone'];
const LEFT_AVOID_TILES = 8;
const NIGHT_ENTRY = Object.freeze({ from: 22, to: 6, activity: 'sleep', at: null });
const LEFT_LIFE = Object.freeze({ type: 'independent', avoid: 'player', tiles: LEFT_AVOID_TILES });
const APART_LIFE = Object.freeze({ type: 'independent' });
const HOURS_TO_SECONDS = 900 / 24; // real seconds per in-game hour

// Her day when her mind has not planned one: work for coin in the morning, Maren's
// trail after noon, friends in the evening, supper at the Kettle, bed.
export const DEFAULT_DAY = [
  { from: 6, to: 8, activity: 'breakfast', at: 'ember_kettle', why: "Elda's porridge is the best start to a day." },
  { from: 8, to: 12, activity: 'gather herbs for Mira', at: 'whisperwood', why: 'Mira pays fairly for silverleaf.' },
  { from: 12, to: 13, activity: 'lunch', at: 'ember_kettle', why: 'Even rangers eat.' },
  { from: 13, to: 16, activity: 'follow a lead about Maren', at: 'chapel', why: 'Aveline saw her last.' },
  { from: 16, to: 18.5, activity: 'visit friends', at: 'town_square', why: 'Hearthvale is starting to feel like home.' },
  { from: 18.5, to: 20.5, activity: 'supper', at: 'ember_kettle', why: 'Supper by the hearth.' },
  { from: 20.5, to: 22, activity: 'rest by the fire', at: 'ember_kettle', why: 'A quiet hour before bed.' },
  { from: 22, to: 6, activity: 'sleep', at: null, why: 'Bed.' },
];

// Activity text -> what her body does. First match wins.
const ACTIVITY_RULES = [
  [/\b(sleep|bed|turn in|night'?s rest)\b/, 'sleep'],
  [/\b(eat|meal|supper|dinner|lunch|breakfast|food|honey cakes?|tea)\b/, 'eat'],
  [/\b(herbs?|moonpetals?|silverleaf)\b/, 'job:gather_herbs'],
  [/\b(forag\w*|berr(?:y|ies))\b/, 'job:forage'],
  [/\b(chop\w*|wood|lumber|firewood)\b/, 'job:chop_wood'],
  [/\b(min(?:e|ing)|ore|quarry)\b/, 'job:mine_ore'],
  [/\b(fish\w*)\b/, 'job:fish'],
  [/\b(harvest\w*|crops?|farm\w*)\b/, 'job:farm'],
  [/\b(cook\w*)\b/, 'job:cook'],
  [/\b(lead|maren|clues?|investigat\w*|search\w*|trail)\b/, 'lead'],
  [/\b(stud\w*|read\w*|books?|research|practi[cs]e|train\w*|pray\w*)\b/, 'study'],
  [/\b(visit\w*|friends?|sociali[sz]e|chat\w*|talk\w*|see)\b/, 'visit'],
  [/\b(stars?|stargaz\w*)\b/, 'stargaze'],
  [/\b(rest\w*|relax\w*|nap|unwind|sit)\b/, 'rest'],
  [/\b(with (?:the )?(?:player|you|traveler)|travel\w*|adventur\w*|companion)\b/, 'with_player'],
  [/\b(shop\w*|market|buy|sell|trade|errands?)\b/, 'errand'],
  [/\bwork\b/, 'work'],
];

// Where each kind of activity happens when the plan does not say.
const DEFAULT_PLACE = {
  eat: 'ember_kettle',
  rest: 'ember_kettle',
  study: 'chapel',
  lead: 'chapel',
  visit: 'town_square',
  stargaze: 'south_meadow',
  errand: 'general_store',
  wander: 'town_square',
  gather_herbs: 'whisperwood',
  forage: 'whisperwood',
  chop_wood: 'whisperwood',
  mine_ore: 'stonecut_quarry',
  fish: 'mirror_lake',
  farm: 'reed_farm',
  cook: 'ember_kettle',
};

// "work" at a place means that place's trade.
const WORK_AT = { whisperwood: 'gather_herbs', stonecut_quarry: 'mine_ore', mirror_lake: 'fish', reed_farm: 'farm', herbalist: 'gather_herbs', smithy: 'mine_ore', ember_kettle: 'cook' };

const NPC_IDS = ['bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick'];
const NPC_WORD = /\b(bram|elda|pip|rowan|mira|tobias|aveline|garrick|gale)\b/;

const MODE_LABEL = {
  sleep: 'going to bed',
  eat: 'having a meal',
  rest: 'resting',
  study: 'studying',
  lead: "following Maren's trail",
  visit: 'visiting friends',
  stargaze: 'watching the stars',
  errand: 'running errands',
  wander: 'wandering',
  with_player: 'traveling with you',
};

// Classify a plan entry: { mode, job, person, buyer, at }.
export function classifyActivity(entry) {
  const text = String(entry?.activity || '').toLowerCase();
  let mode = 'wander';
  let job = entry?.job && JOBS[entry.job] ? entry.job : null;
  if (job) mode = 'job';
  else {
    for (const [re, m] of ACTIVITY_RULES) {
      if (!re.test(text)) continue;
      if (m.startsWith('job:')) {
        mode = 'job';
        job = m.slice(4);
      } else mode = m;
      break;
    }
  }
  const at = entry?.at || null;
  if (mode === 'work') {
    const j = WORK_AT[at] || null;
    if (j) {
      mode = 'job';
      job = j;
    } else mode = 'errand';
  }
  let person = entry?.with || entry?.who || null;
  const m = text.match(NPC_WORD);
  if (!person && m) person = m[1] === 'gale' ? 'garrick' : m[1];
  if (!person && at && NPC_IDS.includes(at)) person = at;
  // "herbs for Mira": a buyer to deliver the work to.
  let buyer = entry?.deliverTo || entry?.for || null;
  if (!buyer && mode === 'job') {
    const f = text.match(/\bfor\s+(bram|elda|pip|rowan|mira|tobias|aveline|garrick)\b/);
    if (f) buyer = f[1];
  }
  return { mode, job, person, buyer, at };
}

// An hour of the day from a plan: 13, 13.5, "13", "1:30 pm", "13:30".
export function hourOf(v) {
  if (Number.isFinite(v)) return ((v % 24) + 24) % 24;
  if (typeof v !== 'string') return NaN;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return NaN;
  let h = parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 60 : 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h >= 12) h -= 12;
  return h % 24;
}

// The plan entry active at `hour` (handles entries that wrap past midnight).
export function activeEntry(plan, hour) {
  if (!Array.isArray(plan)) return null;
  for (let i = 0; i < plan.length; i++) {
    const e = plan[i];
    if (!e) continue;
    const from = hourOf(e.from);
    const to = hourOf(e.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    if (from < to ? hour >= from && hour < to : hour >= from || hour < to) return e;
  }
  return null;
}

// Hours left in an entry from `hour`.
function hoursLeft(e, hour) {
  if (!e) return 0;
  let h = hourOf(e.to) - hour;
  if (!Number.isFinite(h)) return 0;
  if (h < 0) h += 24;
  return h;
}

function entryKey(e) {
  return e ? `${e.from}-${e.to}-${e.activity}-${e.at || ''}` : '';
}

export class OwnLife {
  constructor(behavior) {
    this.b = behavior;
    this.st = null; // per-directive state
    this.day = null; // independent: the current entry and what she is doing in it
    this.announcedAt = -99;
    this.scratch = { x: 0, y: 0 };
  }

  get game() {
    return this.b.game;
  }

  get actor() {
    return this.b.actor;
  }

  // Stop what the previous own directive set going (a job of her own, a seat).
  clear() {
    const b = this.b;
    if (this.day?.jobOn && b.jobs.active && b.directive?.type !== 'job') {
      const snap = b.jobs.serialize();
      b.jobs.stop();
      b.game.bus?.emit?.('job_failed', { actor: b.actor, job: snap?.job ?? null, reason: 'Her plans changed.', stopped: true, own: true });
    }
    this.st = null;
    this.day = null;
  }

  // --- set-up: validate a directive. Returns { ok, message, next, state } ---

  setup(d, prev) {
    switch (d.type) {
      case 'independent':
        return this.setupIndependent(d);
      case 'flee':
        return this.setupFlee(d, prev);
      case 'leave':
        return this.setupLeave(d);
      case 'keep_away':
        return this.setupKeepAway(d, prev);
      case 'wait_outside':
        return this.setupWaitOutside(d, prev);
      default:
        return { ok: false, message: "I'm not sure what you'd like me to do." };
    }
  }

  begin(state) {
    this.st = state || {};
    this.day = null;
  }

  setupIndependent(d) {
    let plan = null;
    if (Array.isArray(d.plan)) plan = d.plan.filter((e) => e && Number.isFinite(hourOf(e.from)) && Number.isFinite(hourOf(e.to))).map((e) => ({ from: e.from, to: e.to, activity: String(e.activity || 'wander'), at: e.at ?? null, why: e.why ?? null, with: e.with ?? null, job: e.job ?? null, deliverTo: e.deliverTo ?? null }));
    else if (typeof d.plan === 'string' && d.plan.trim() && !/^(today|agenda|her own|own|default|plan|day|her day|my day)$/i.test(d.plan.trim())) {
      // One activity named in words: do it for the next three hours, then her usual day.
      const h = this.game.clock?.hour ?? 12;
      plan = [{ from: Math.floor(h * 2) / 2, to: (Math.floor(h * 2) / 2 + 3) % 24, activity: d.plan.trim().slice(0, 80), at: d.at ?? null, why: null }];
    }
    const next = { type: 'independent' };
    if (plan && plan.length) next.plan = plan;
    if (d.avoid) next.avoid = d.avoid === true ? 'player' : String(d.avoid);
    if (Number.isFinite(d.tiles)) next.tiles = d.tiles;
    if (d.reason) next.reason = String(d.reason).slice(0, 60);
    return { ok: true, message: say.ownDay(), next, state: {} };
  }

  setupFlee(d, prev) {
    const g = this.game;
    const a = this.actor;
    let from = this.resolveWho(d.from);
    if (!from) from = this.b.likelyThreat();
    if (from === a) from = null;
    const dest = chooseSafePlace(g, a, from, d.to || null);
    if (!dest && !from) return { ok: false, message: say.fleeNowhere() };
    const next = { type: 'flee', from: from ? (from === g.player ? 'player' : from.id) : null, to: dest?.location?.id || (d.to ? String(d.to) : null) };
    if (d.then) next.then = plain(d.then);
    else if (prev && !['flee', 'wait'].includes(prev.type) && !(from === g.player && prev.type === 'follow')) next.then = plain(prev);
    return { ok: true, message: say.flee(from ? nameOf(g, from) : null, dest ? placeLabel(g, dest) : null), next, state: { from, dest, t: 0, blockedT: 0, repickT: 0, said: false } };
  }

  setupLeave(d) {
    const mode = LEAVE_MODES.includes(d.mode) ? d.mode : 'left';
    const next = { type: 'leave', mode };
    if (d.reason) next.reason = String(d.reason).slice(0, 80);
    return { ok: true, message: say.leave(mode), next, state: { mode, exit: null, t: 0, blockedT: 0, farT: 0, fade: 0, said: false } };
  }

  setupKeepAway(d, prev) {
    const g = this.game;
    const from = this.resolveWho(d.from ?? 'player');
    if (!from) return { ok: false, message: say.noSuchTarget(String(d.from ?? 'them')) };
    if (from === this.actor) return { ok: false, message: "Keep away from myself? I've tried. I follow me everywhere." };
    const tiles = Math.max(2, Math.min(20, Number.isFinite(d.tiles) ? d.tiles : 4));
    const isPlayer = from === g.player;
    const follow = typeof d.follow === 'boolean' ? d.follow : isPlayer && ['together', 'wary'].includes(companionshipOf(g));
    const next = { type: 'keep_away', from: isPlayer ? 'player' : from.id, tiles, follow };
    if (Number.isFinite(d.seconds) && d.seconds > 0) {
      next.seconds = Math.min(600, d.seconds);
      next.then = plain(d.then || (prev?.type === 'keep_away' ? prev.then : prev) || { type: 'follow', target: 'player', distance: 'normal' });
    }
    return { ok: true, message: say.keepAway(nameOf(g, from), tiles), next, state: { from, spot: null, repickT: 0, t: 0, left: next.seconds || 0 } };
  }

  setupWaitOutside(d, prev) {
    const g = this.game;
    const a = this.actor;
    let loc = asLocation(g, d.location ?? d.target);
    if (!loc) {
      // No place named: the one the player is in, else the one she is about to enter.
      const p = g.player;
      loc = p ? safe('locations.at', () => g.locations?.at?.(p.x, p.y), null) : null;
      if (loc && (loc.kind === 'village' || loc.kind === 'road' || loc.id === 'wilds')) loc = null;
    }
    if (!loc) return { ok: false, message: d.location ? say.unknownPlace(String(d.location)) : "Wait outside where? Name the place." };
    const from = inBounds(loc, a.x, a.y) && g.player ? g.player : a;
    const spot = entranceSpot(g, a, loc, from.x, from.y) || nearestWalkable(g, a.x, a.y, 3, a);
    if (!spot) return { ok: false, message: say.unreachable(placePhrase(loc)) };
    const next = { type: 'wait_outside', location: loc.id };
    let then = d.then ? plain(d.then) : null;
    if (!then && prev && (prev.type === 'follow' || prev.type === 'goto' || prev.type === 'explore' || prev.type === 'job')) then = prev.type === 'follow' ? plain(prev) : { type: 'follow', target: 'player', distance: 'normal' };
    if (then) next.then = then;
    return { ok: true, message: say.waitOutside(placePhrase(loc), !!d.risky), next, state: { loc, spot, outT: 0, t: 0 } };
  }

  resolveWho(ref) {
    const g = this.game;
    if (ref == null || ref === '') return null;
    if (typeof ref === 'object') return ref.type === 'actor' ? ref : null;
    if (ref === 'player' || ref === PLAYER_ID) return g.player || null;
    const e = g.entities?.get?.(String(ref)) || resolveEntity(g, String(ref), this.actor);
    return e && e.type === 'actor' ? e : null;
  }

  // --- running ---

  run(dt) {
    const d = this.b.directive;
    if (!this.st) this.st = {};
    switch (d.type) {
      case 'independent':
        return this.runIndependent(dt, d);
      case 'flee':
        return this.runFlee(dt, d);
      case 'leave':
        return this.runLeave(dt, d);
      case 'keep_away':
        return this.runKeepAway(dt, d);
      case 'wait_outside':
        return this.runWaitOutside(dt, d);
      default:
        return false;
    }
  }

  // Combat by stance does not run while she is running away or walking out of the world.
  exclusive() {
    const d = this.b.directive;
    return d.type === 'flee' || (d.type === 'leave' && d.mode === 'gone');
  }

  // --- independent: her own day ---

  plan(d) {
    if (Array.isArray(d.plan) && d.plan.length) {
      const h = this.game.clock?.hour ?? 12;
      if (activeEntry(d.plan, h)) return d.plan;
    }
    const today = this.actor.mind?.agenda?.today;
    if (Array.isArray(today) && today.length) return today;
    return DEFAULT_DAY;
  }

  runIndependent(dt, d) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const hour = g.clock?.hour ?? 12;
    // Someone she has left behind: keep well away from them.
    const avoid = d.avoid ? this.resolveWho(d.avoid) : null;
    if (avoid && this.avoidStep(dt, avoid, (d.tiles || LEFT_AVOID_TILES) * TILE)) return true;
    let entry = activeEntry(this.plan(d), hour);
    if (!entry && (hour >= 22 || hour < 6)) entry = NIGHT_ENTRY;
    // Plans are rebuilt now and then; an entry that reads the same is the same entry.
    if (!this.day || this.day.entry !== entry) {
      const key = entryKey(entry);
      if (!this.day || this.day.key !== key) this.startEntry(entry, key, d);
      else this.day.entry = entry;
    }
    const day = this.day;
    day.t += dt;
    if (!entry) return this.ownIdle(dt, null);
    if (day.skipped) return this.ownIdle(dt, day.spot);
    switch (day.mode) {
      case 'sleep':
        return this.doSleep(dt, day);
      case 'job':
        return this.doOwnJob(dt, day, hour);
      case 'visit':
        return this.doVisit(dt, day);
      case 'with_player':
        if (companionshipOf(g) === 'left' || companionshipOf(g) === 'gone' || avoid === g.player) return this.ownIdle(dt, day.spot);
        return b.doFollow(dt, 'normal');
      default:
        return this.doAtPlace(dt, day, hour);
    }
  }

  startEntry(entry, key, d) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    if (this.day?.jobOn && b.jobs.active) b.jobs.stop();
    if (b.task && (b.task.kind === 'sit' || b.task.own)) b.cancelTask();
    b.idle.reset();
    const c = classifyActivity(entry);
    let place = asLocation(g, c.at || (c.mode === 'job' ? DEFAULT_PLACE[c.job] : DEFAULT_PLACE[c.mode]));
    if (c.mode === 'sleep') place = null;
    const day = { key, entry, mode: c.mode, job: c.job, buyer: c.buyer, person: null, place, spot: null, phase: 'travel', t: 0, blockedT: 0, jobRuns: 0, jobOn: false, skipped: false, sitDone: false, ate: false, actT: 0, label: '' };
    if (c.person) day.person = this.resolveWho(c.person);
    if (place) {
      day.spot = this.pickSpotIn(place) || (place.center ? { x: place.center.x, y: place.center.y } : null);
      // Not on her own, not there: she lives somewhere else today.
      if (isTooRisky(g, a, place) && !inBounds(place, a.x, a.y)) {
        day.skipped = true;
        day.spot = null;
        b.say(say.tooRiskyToday(placePhrase(place)));
      }
    }
    day.label = this.labelFor(day);
    this.day = day;
    // Tell the player what she is off to do, when they are around to hear it.
    const p = g.player;
    const s = companionshipOf(g);
    if (!day.skipped && entry && p && s !== 'left' && s !== 'gone' && !d.avoid && dist(a.x, a.y, p.x, p.y) < 10 * TILE && b.t - this.announcedAt > 45) {
      if (b.say(say.planNext(day.label, place ? placePhrase(place) : null, s === 'together' || s === 'wary'))) this.announcedAt = b.t;
    }
  }

  labelFor(day) {
    const where = day.place ? placePhrase(day.place) : null;
    if (day.mode === 'job') {
      const j = JOBS[day.job];
      const base = j ? j.label : 'working';
      if (day.buyer) return `${base} for ${cap1(day.buyer)}`;
      return where ? `${base} ${where.at}` : base;
    }
    if (day.mode === 'visit' && day.person) return `visiting ${nameOf(this.game, day.person)}`;
    if (day.mode === 'eat' && where) return `having a meal ${where.at}`;
    if (day.mode === 'study' && where) return `studying ${where.at}`;
    if (day.mode === 'sleep') return 'going to bed';
    const base = MODE_LABEL[day.mode] || 'living her own day';
    return where && day.mode !== 'with_player' ? `${base} ${where.at}` : base;
  }

  // A walkable spot inside a place, near its center (not always the same tile).
  pickSpotIn(loc) {
    const g = this.game;
    const a = this.actor;
    const c = loc.center;
    if (!c) return null;
    for (let i = 0; i < 6; i++) {
      const x = c.x + rand(-2.5, 2.5) * TILE;
      const y = c.y + rand(-2, 2) * TILE;
      if (!inBounds(loc, x, y)) continue;
      if (walkable(g, tileOf(x), tileOf(y), a)) return { x: tileCenter(tileOf(x)), y: tileCenter(tileOf(y)) };
    }
    return nearestWalkable(g, c.x, c.y, 3, a);
  }

  // Walk to the day's spot. Returns 'moving' | 'there' | 'stuck'.
  travel(dt, day) {
    const a = this.actor;
    const spot = day.spot;
    if (!spot) return 'there';
    if (day.phase !== 'travel') return 'there';
    const inside = day.place ? inBounds(day.place, a.x, a.y) : false;
    const d = dist(a.x, a.y, spot.x, spot.y);
    if ((inside && d < 3 * TILE) || d < 10) {
      day.phase = 'do';
      this.b.steering.stop();
      return 'there';
    }
    const r = this.b.steering.moveTo(spot.x, spot.y, dt, { arrive: 8, run: d > 30 * TILE ? 1.15 : 1, maxNodes: 20000 });
    if (r === 'arrived') {
      day.phase = 'do';
      return 'there';
    }
    if (r === 'moving') {
      day.blockedT = 0;
      return 'moving';
    }
    day.blockedT += dt;
    if (day.blockedT > 6) {
      // Somewhere she cannot get to today: make do where she is.
      day.phase = 'do';
      day.spot = { x: a.x, y: a.y };
      return 'stuck';
    }
    return 'moving';
  }

  doAtPlace(dt, day, hour) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    if (this.travel(dt, day) === 'moving') return true;
    const remaining = hoursLeft(day.entry, hour) * HOURS_TO_SECONDS;
    if (day.mode === 'eat' && !day.ate) {
      day.ate = true;
      if (need(g, 'hunger') < 0.8) b.eatOwnFood();
    }
    if ((day.mode === 'eat' || day.mode === 'rest' || day.mode === 'study' || day.mode === 'stargaze') && !day.sitDone && remaining > 8) {
      day.sitDone = true;
      const fire = day.mode === 'eat' || day.mode === 'rest' ? this.fireIn(day.place) : null;
      b.startSit(fire, Math.min(remaining, day.mode === 'study' ? 50 : 90));
      if (b.task) {
        b.task.own = true;
        if (day.mode === 'stargaze') b.task.lookUp = true;
      }
      return true;
    }
    if (day.mode === 'study' || day.mode === 'lead') {
      day.actT -= dt;
      if (day.actT <= 0) {
        day.actT = rand(9, 16);
        if (day.mode === 'lead') {
          // Pace the place, look at things, think.
          const s = day.place ? this.pickSpotIn(day.place) : null;
          if (s) {
            day.spot = s;
            day.phase = 'travel';
            return true;
          }
        }
        if (chance(0.5)) b.emote('think');
        return true;
      }
    }
    if (day.mode === 'study' && day.sitDone && remaining > 20 && day.actT > 6) day.sitDone = false;
    return this.ownIdle(dt, day.spot);
  }

  fireIn(loc) {
    const g = this.game;
    const a = this.actor;
    if (!loc) return null;
    const c = loc.center || a;
    const fire = safe('objects.nearest', () => g.objects?.nearest?.((o) => o.objType === 'hearth' || o.objType === 'campfire', c.x, c.y, 10 * TILE), null);
    if (!fire) return null;
    if (loc.bounds && !inBounds(loc, fire.x, fire.y - 1, 1)) return null;
    return fireSeat(g, fire, a) ? fire : null;
  }

  doSleep(dt, day) {
    const b = this.b;
    if (b.task?.kind === 'sleep') return true;
    if (!b.isBedtime(true)) {
      // Too early for bed: rest near it instead.
      day.mode = 'rest';
      day.place = asLocation(this.game, this.bedLocationId());
      day.spot = day.place ? this.pickSpotIn(day.place) : null;
      day.label = this.labelFor(day);
      return true;
    }
    const bed = b.lyraBed();
    if (!bed || b.t - b.bedFailedAt < 60) return this.ownIdle(dt, null);
    b.startSleep(bed);
    if (b.task) b.task.own = true;
    return true;
  }

  bedLocationId() {
    const at = this.actor.mind?.agenda?.sleepAt;
    return at === 'lyra_inn_bed' ? 'ember_kettle' : 'player_home';
  }

  doOwnJob(dt, day, hour) {
    const b = this.b;
    const g = this.game;
    const jobs = b.jobs;
    if (day.jobOn) {
      if (jobs.active) {
        jobs.update(dt);
        return true;
      }
      day.jobOn = false;
      day.jobRuns++;
    }
    const remaining = hoursLeft(day.entry, hour) * HOURS_TO_SECONDS;
    if (day.jobRuns >= 3 || remaining < 15 || day.jobFailed) return this.ownIdle(dt, day.spot);
    const buyer = day.buyer ? this.resolveWho(day.buyer) : null;
    const amount = { fish: 3, cook: null }[day.job] ?? 4;
    const r = jobs.start({ job: day.job, amount, deliverTo: buyer ? buyer.id : 'keep', targetRef: day.place?.id ?? null, quiet: true, own: true });
    if (!r.ok) {
      day.jobFailed = true;
      return this.ownIdle(dt, day.spot);
    }
    day.jobOn = true;
    return true;
  }

  doVisit(dt, day) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const who = day.person && isActorAlive(day.person) ? day.person : null;
    if (!who) return this.doAtPlace(dt, day, g.clock?.hour ?? 12);
    const d = dist(a.x, a.y, who.x, who.y);
    if (d > 26) {
      const r = b.steering.moveTo(who.x, who.y, dt, { arrive: 22, run: d > 20 * TILE ? 1.15 : 1, ignore: who, maxNodes: 20000 });
      if (r === 'moving') return true;
      if (r !== 'arrived') {
        day.blockedT += dt;
        if (day.blockedT > 6) day.person = null;
      }
      return true;
    }
    b.steering.stop();
    a.faceToward(who.x, who.y);
    day.actT -= dt;
    if (day.actT <= 0) {
      day.actT = rand(7, 13);
      if (!day.greeted) {
        day.greeted = true;
        b.emote('wave');
        b.say(say.greet(nameOf(g, who)));
      } else if (chance(0.4)) {
        b.emote(chance(0.5) ? 'laugh' : 'think');
        safe('mind.feel', () => a.mind?.feel?.('joy', 0.04, `time with ${who.name || 'a friend'}`));
      }
    }
    return true;
  }

  // Idle life anchored on a spot of her own (not on the player).
  ownIdle(dt, spot) {
    const b = this.b;
    const a = this.actor;
    const anchor = spot || this.st?.home || (this.st ? (this.st.home = { x: a.x, y: a.y }) : { x: a.x, y: a.y });
    b.idleAnchor = anchor;
    if (dist(a.x, a.y, anchor.x, anchor.y) > 9 * TILE && !b.idle.active) {
      const r = b.steering.moveTo(anchor.x, anchor.y, dt, { arrive: 2 * TILE, maxNodes: 20000 });
      if (r === 'moving') return true;
    }
    b.idle.update(dt, 'own');
    return true;
  }

  // Step away from someone she is avoiding. True while she is moving away.
  avoidStep(dt, who, minD) {
    const b = this.b;
    const a = this.actor;
    if (!isActorAlive(who) || b.task?.kind === 'sleep') return false;
    const d = dist(a.x, a.y, who.x, who.y);
    const st = this.st;
    if (d >= minD && !st.avoiding) return false;
    if (d >= minD + TILE) {
      st.avoiding = null;
      return false;
    }
    st.repickT = (st.repickT || 0) - dt;
    if (!st.avoiding || st.repickT <= 0) {
      st.repickT = 0.8;
      st.avoiding = openSpotAway(this.game, a, who.x, who.y, minD + 2 * TILE);
      if (!st.avoiding) return false;
      if (b.task?.kind === 'sit' || b.task?.own) b.cancelTask();
      b.idle.reset();
      if (this.day) this.day.phase = 'travel';
    }
    const r = b.steering.moveTo(st.avoiding.x, st.avoiding.y, dt, { arrive: 6, run: d < minD * 0.5 ? 1.3 : 1.05 });
    if (r !== 'moving') st.avoiding = null;
    return true;
  }

  // --- flee: run to safety ---

  runFlee(dt, d) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const st = this.st;
    st.t = (st.t || 0) + dt;
    const from = st.from && !st.from.removed ? st.from : null;
    if (!st.dest) st.dest = chooseSafePlace(g, a, from, d.to);
    const dest = st.dest;
    if (dest?.entity) {
      dest.x = dest.entity.x;
      dest.y = dest.entity.y;
    }
    const reached = dest && (dest.location ? inBounds(dest.location, a.x, a.y) && dist(a.x, a.y, dest.x, dest.y) < 6 * TILE : dist(a.x, a.y, dest.x, dest.y) < 3 * TILE);
    const escaped = from ? escapedFrom(g, a, from) : false;
    if (reached || (escaped && st.t > 2) || (!from && !dest) || st.t > 120) return this.finishFlee(d, reached ? dest : null, from);
    // Cornered: the dagger, then keep running.
    if (from && isActorAlive(from) && dist(a.x, a.y, from.x, from.y) < 16 && from !== g.player) {
      if (b.combatAI.daggerCd <= 0) {
        a.faceToward(from.x, from.y);
        const ok = safe('combat.melee', () => g.combat?.melee?.(a, { target: from }), false);
        b.combatAI.daggerCd = ok ? 0.55 : 0.25;
      }
    }
    // When the way to safety leads past the threat, break away from it first.
    if (from && dest && dist(a.x, a.y, from.x, from.y) < 48) {
      const tx = from.x - a.x;
      const ty = from.y - a.y;
      const ux = dest.x - a.x;
      const uy = dest.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      const ul = Math.hypot(ux, uy) || 1;
      if ((tx * ux + ty * uy) / (tl * ul) > 0.4) {
        const spot = openSpotAway(g, a, from.x, from.y, 72);
        if (spot) {
          b.steering.moveTo(spot.x, spot.y, dt, { arrive: 6, run: 1.45 });
          return true;
        }
      }
    }
    if (!dest) {
      const spot = openSpotAway(g, a, from.x, from.y, 10 * TILE);
      if (spot) b.steering.moveTo(spot.x, spot.y, dt, { arrive: 6, run: 1.45 });
      else b.steering.stop();
      return true;
    }
    const r = b.steering.moveTo(dest.x, dest.y, dt, { arrive: 10, run: 1.45, maxNodes: 20000 });
    if (r === 'moving') st.blockedT = 0;
    else {
      st.blockedT = (st.blockedT || 0) + dt;
      if (st.blockedT > 2.5) {
        // That way is shut: pick somewhere else, away from the threat.
        st.blockedT = 0;
        st.dest = from ? { x: a.x, y: a.y, label: 'away', entity: null, location: null, ...openSpotAway(g, a, from.x, from.y, 12 * TILE) } : null;
      }
    }
    return true;
  }

  finishFlee(d, dest, from) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const loc = dest?.location || safe('locations.at', () => g.locations?.at?.(a.x, a.y), null);
    g.bus?.emit?.('lyra_fled', { actor: a, from: from || null, location: loc?.id || null, safe: true });
    const fromPlayer = from && from === g.player;
    b.say(say.fleeSafe(fromPlayer, loc ? placePhrase(loc) : null), { force: true });
    const s = companionshipOf(g);
    let next = d.then;
    if (!next || (fromPlayer && next.type === 'follow')) next = fromPlayer ? (s === 'together' || s === 'wary' ? { type: 'keep_away', from: 'player', tiles: 6 } : { type: 'independent' }) : { type: 'follow', target: 'player', distance: 'normal' };
    if (!fromPlayer && (s === 'apart' || s === 'left')) next = { type: 'independent', ...(s === 'left' ? { avoid: 'player' } : {}) };
    if (s === 'gone') next = { type: 'leave', mode: 'gone' };
    const r = b.setDirective(next, { quiet: true });
    if (!r.ok) b.setDirective({ type: 'stay', x: a.x, y: a.y }, { quiet: true });
    return true;
  }

  // --- leave ---

  runLeave(dt, d) {
    if (d.mode !== 'gone') {
      // Apart or left: she lives her own day; when she left you, she keeps her distance.
      return this.runIndependent(dt, d.mode === 'left' ? LEFT_LIFE : APART_LIFE);
    }
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const st = this.st;
    st.t = (st.t || 0) + dt;
    if (b.task) b.cancelTask();
    if (st.fade > 0) {
      b.steering.setIntent(st.dirX || 1, st.dirY || 0, 0.5, 1);
      st.fade += dt;
      a.fade = Math.max(0, 1 - st.fade / 1.2);
      if (st.fade >= 1.2) this.vanish(d);
      return true;
    }
    if (!st.exit) st.exit = edgeExit(g, a) || { x: a.x, y: a.y, none: true };
    const ex = st.exit;
    const p = g.player;
    const seen = onScreen(g, a.x, a.y, 16);
    // Out of sight and far from the player for a while: she is simply gone.
    if (!seen && (!p || dist(a.x, a.y, p.x, p.y) > 28 * TILE)) st.farT += dt;
    else st.farT = 0;
    if (st.farT > 4) return this.vanish(d);
    if (ex.none || dist(a.x, a.y, ex.x, ex.y) < 10 || atMapEdge(g, a, 0)) {
      const ux = ex.none ? a.x - (p?.x ?? a.x - 1) : ex.x - (g.map?.w ? (g.map.w * TILE) / 2 : a.x - 1);
      const uy = ex.none ? a.y - (p?.y ?? a.y) : 0;
      const l = Math.hypot(ux, uy) || 1;
      st.dirX = ux / l;
      st.dirY = uy / l;
      st.fade = 0.0001;
      return true;
    }
    const r = b.steering.moveTo(ex.x, ex.y, dt, { arrive: 6, maxNodes: 30000 });
    if (r === 'moving') st.blockedT = 0;
    else {
      st.blockedT = (st.blockedT || 0) + dt;
      // No path: walk straight for it; the world is not keeping her.
      if (st.blockedT > 3) b.steering.setIntent(ex.x - a.x, ex.y - a.y, 1, 1);
      if (st.blockedT > 20 && !seen) return this.vanish(d);
    }
    return true;
  }

  vanish(d) {
    const a = this.actor;
    this.b.steering.stop();
    if (typeof a.leaveWorld === 'function') a.leaveWorld(d.reason || 'gone');
    else {
      a.removed = true;
      this.game.bus?.emit?.('lyra_left_world', { actor: a, reason: d.reason || 'gone', day: this.game.clock?.day ?? null });
    }
    return true;
  }

  // --- keep_away ---

  runKeepAway(dt, d) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const st = this.st;
    let from = st.from;
    if (!from || from.removed) from = st.from = this.resolveWho(d.from);
    if (d.seconds) {
      st.left = (st.left ?? d.seconds) - dt;
      if (st.left <= 0) {
        b.setDirective(d.then || { type: 'follow', target: 'player', distance: 'normal' }, { quiet: true });
        return true;
      }
    }
    if (!from || !isActorAlive(from)) {
      st.spot = null;
      return this.ownIdle(dt, null);
    }
    const minD = (d.tiles || 4) * TILE;
    const dd = dist(a.x, a.y, from.x, from.y);
    // Too close: step back to open ground (never into a corner), still watching them.
    if (dd < minD || (st.spot && st.moving)) {
      st.repickT -= dt;
      if (!st.spot || st.repickT <= 0 || dist(st.spot.x, st.spot.y, from.x, from.y) < minD) {
        st.repickT = 0.7;
        st.spot = openSpotAway(g, a, from.x, from.y, minD + TILE * 1.5);
      }
      if (st.spot) {
        if (b.task) b.cancelTask();
        b.idle.reset();
        const r = b.steering.moveTo(st.spot.x, st.spot.y, dt, { arrive: 6, run: dd < minD * 0.5 ? 1.35 : 1.05 });
        st.moving = r === 'moving';
        if (!st.moving) a.faceToward(from.x, from.y);
        return true;
      }
    }
    st.moving = false;
    // Wary but still together: trail them at that distance.
    if (d.follow && dd > minD + 6 * TILE) {
      const ux = (a.x - from.x) / dd;
      const uy = (a.y - from.y) / dd;
      const tx = from.x + ux * (minD + 2 * TILE);
      const ty = from.y + uy * (minD + 2 * TILE);
      const s = walkable(g, tileOf(tx), tileOf(ty), a) ? { x: tx, y: ty } : nearestWalkable(g, tx, ty, 3, a) || from;
      b.steering.moveTo(s.x, s.y, dt, { arrive: 2 * TILE, run: dd > 20 * TILE ? 1.35 : 1, maxNodes: 12000 });
      return true;
    }
    b.steering.stop();
    st.faceT = (st.faceT || 0) - dt;
    if (st.faceT <= 0) {
      st.faceT = rand(1.5, 3);
      a.faceToward(from.x, from.y);
    }
    return true;
  }

  // --- wait_outside ---

  runWaitOutside(dt, d) {
    const b = this.b;
    const g = this.game;
    const a = this.actor;
    const st = this.st;
    if (!st.loc) st.loc = asLocation(g, d.location);
    const loc = st.loc;
    if (!loc) {
      b.setDirective(d.then || { type: 'follow', target: 'player', distance: 'normal' }, { quiet: true });
      return true;
    }
    if (!st.spot) st.spot = entranceSpot(g, a, loc, a.x, a.y) || { x: a.x, y: a.y };
    st.t = (st.t || 0) + dt;
    // The player went in and came back out to her (or came to fetch her from her
    // post): back to what she was doing.
    const p = g.player;
    const s = st.spot;
    if (d.then && p && isActorAlive(p)) {
      const pin = inBounds(loc, p.x, p.y);
      if (pin) st.playerWasIn = true;
      st.outT = pin ? 0 : (st.outT || 0) + dt;
      if (dist(a.x, a.y, s.x, s.y) <= 12) st.waitedT = (st.waitedT || 0) + dt;
      const near = dist(a.x, a.y, p.x, p.y);
      if (st.outT > 1 && ((st.playerWasIn && near < 10 * TILE) || (st.waitedT > 4 && near < 4 * TILE))) {
        b.setDirective(d.then, { quiet: true });
        b.say(say.waitOutsideOver());
        return true;
      }
    }
    if (dist(a.x, a.y, s.x, s.y) > 8) {
      const r = b.steering.moveTo(s.x, s.y, dt, { arrive: 5 });
      if (r === 'moving') return true;
    }
    b.steering.stop();
    if (!b.idle.active && st.t % 5 < dt) a.faceToward(loc.center?.x ?? a.x, loc.center?.y ?? a.y);
    b.idle.update(dt, 'stay');
    return true;
  }

  // --- reporting ---

  status() {
    const d = this.b.directive;
    const g = this.game;
    switch (d.type) {
      case 'independent':
        return this.day?.skipped ? 'keeping to the village today' : this.day?.label || 'living her own day';
      case 'flee': {
        const from = this.st?.from;
        const dest = this.st?.dest;
        if (dest && dest.label !== 'away') return `running ${placeLabel(g, dest, true)}`;
        return from ? `running from ${nameOf(g, from)}` : 'running for safety';
      }
      case 'leave':
        if (d.mode === 'gone') return 'leaving Hearthvale';
        if (d.mode === 'left') return 'keeping to herself';
        return this.day?.label || 'living her own life';
      case 'keep_away':
        return `keeping her distance from ${nameOf(g, this.st?.from || this.resolveWho(d.from))}`;
      case 'wait_outside':
        return `waiting outside ${placePhrase(this.st?.loc || asLocation(g, d.location)).name}`;
      default:
        return '';
    }
  }
}

function plain(d) {
  if (!d || typeof d !== 'object') return null;
  return JSON.parse(JSON.stringify(d));
}

function cap1(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function placeLabel(game, dest, to = false) {
  if (!dest) return 'somewhere safe';
  if (dest.location) return to ? placePhrase(dest.location).to : placePhrase(dest.location).name;
  if (dest.entity) return to ? `to ${nameOf(game, dest.entity)}` : nameOf(game, dest.entity);
  if (dest.label === 'guards') return to ? 'to the guards' : 'the guards';
  return to ? 'for safety' : 'somewhere safe';
}
