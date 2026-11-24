// Hearthvale's working day (DESIGN §28): errands, sightings, problems, and the missing.
// `game.villageLife` (created by core/game.js after the world and the plugins exist).
//
//   update(dt)                      every step; costs a small fraction of a millisecond
//   entryFor(npc, entry, hour)      npc.currentEntry() asks: an errand, a search, a cover shift
//   answerPlayer(npc, u, text)      player_talk asks: "what's wrong?", "have you seen X?"
//   ambientLine(npc)                npc.social() asks: a worried line instead of small talk
//   markGone(id, {cause, seen, at, keepBody})   someone leaves the village's life (DESIGN §29)
//   markAway(id, {place, hours, witnesses})     someone is somewhere unexpected for a while
//   markBack(id)                    they come back
//   onBodyFound(id, finder, place)  a body found turns missing into dead (DESIGN §29 builds on it)
//   view()                          a plain snapshot for the village view
//   serialize() / deserialize(d)
//
// Events on the bus: errand_started, errand_done, errand_failed {npc, errand}, village_problem
// {npc, problem}, search_started {about, leader, searchers}, person_found {id, by, place},
// missing_declared {id, day}, body_found {id, finder, place}, villager_gone {id, cause},
// lie_found {claim}.

import { Sightings } from './sightings.js';
import { ErrandBook, applyEffects, describeErrand, freshStock, seedMorningGoods, inStock, habitAt } from './errands.js';
import { errandTemplate, EXPECTS, COVER, WATCH, placePhrase, placeAt, pronoun } from './errands_data.js';
import { newProblem, restoreProblem, careFor, buildInput, whenPhrase, sincePhrase, clockText, MAX_STEPS } from './problems.js';
import { decideLocal } from './reasoner_local.js';
import { ClaudeReasoner, THINK_BATCH } from './reasoner_claude.js';
import { Cases, Absences } from './missing.js';
import { searchLeader, searchPlaces, chooseSearchers, SEARCH_SECONDS } from './search.js';
import { lifeLine, thoughtLine, fillLine, linesFor } from './voice.js';
import { VILLAGERS, SHORT_NAMES } from '../social/bonds_data.js';
import { thirdName, callName, voiceOf } from '../social/lines.js';
import { profileById } from '../../entities/npc_data.js';
import { TILE } from '../../core/constants.js';

const HOUR = 37.5; // clock seconds per game hour
const TICK = 0.25;
const SWEEP = 0.5;
const GRACE = 0.4 * HOUR; // how long someone waits for a person who should be there
const BEAT = 2.5; // a moment to think between one step and the next
const HOLD = 8; // real seconds a decision may wait for Claude's next slot
const REACH = 46; // px: close enough to talk
const STEP_MAX = 110; // clock seconds before a stuck step gives up
// Shops that are shut when their keeper is out (the Kettle and the chandlery never are).
const SHOPKEEPERS = { general_store: 'garrick', herbalist: 'mira', smithy: 'bram' };
const EVENTS_CAP = 160;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[village life]', err);
    return fallback;
  }
}

const perfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function inLoc(loc, e) {
  if (!loc?.bounds || !e) return false;
  const b = loc.bounds;
  const tx = e.x / TILE;
  const ty = e.y / TILE;
  return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
}

// Place words the player might use when answering "have you seen him?".
const PLACE_WORDS = [
  [/\b(lake|dock|water|shore|net-?shed)\b/, 'mirror_lake'],
  [/\bquarry\b/, 'stonecut_quarry'],
  [/\b(woods?|forest|whisperwood|trees)\b/, 'whisperwood'],
  [/\b(hives?|bees|lindens?)\b/, 'wenna_hives'],
  [/\b(farm|fields?|turnips?|reed farm)\b/, 'reed_farm'],
  [/\bmeadow\b/, 'south_meadow'],
  [/\b(road|saltmere|brightwater|cinderwick|the fork|waystones?)\b/, 'kings_road'],
  [/\b(kettle|inn|tavern|elda'?s)\b/, 'ember_kettle'],
  [/\bchapel\b/, 'chapel'],
  [/\b(smithy|forge|anvil)\b/, 'smithy'],
  [/\b(shop|store|gale'?s goods|garrick'?s)\b/, 'general_store'],
  [/\b(square|well|notice board)\b/, 'town_square'],
  [/\bruins\b/, 'sunken_ruins'],
  [/\b(camp|hills|bandits?)\b/, 'bandit_camp'],
  [/\bguardhouse\b/, 'guardhouse'],
  [/\b(herbalist|mira'?s)\b/, 'herbalist'],
  [/\bchandlery\b/, 'chandlery'],
  [/\b(dye|vats)\b/, 'dye_cottage'],
  [/\b(wayhouse|my cottage|my house|my place)\b/, 'player_home'],
  [/\b(glade|moonpetal)\b/, 'moonpetal_glade'],
];
const RE_UNSURE = /\b(don'?t know|dunno|no idea|not sure|can'?t say|couldn'?t say|maybe)\b/i;
const RE_NO = /\b(no|nope|nah|haven'?t|have not|didn'?t|did not|not seen|never seen|not since)\b/i;
const RE_YES = /\b(yes|yeah|yep|aye|i saw|i'?ve seen|i have seen|saw (?:him|her|them)|i did)\b/i;
const RE_WRONG = /\b(what'?s wrong|what is wrong|what'?s the matter|is (?:something|anything) wrong|(?:you|everything) (?:all right|alright|ok(?:ay)?)\?|you (?:look|seem) (?:worried|upset|troubled|lost|bothered)|what happened|what'?s going on|what'?s happening|trouble\?|problem\?|what'?s up with you)\b/i;
const RE_SEEN = /\b(have you seen|seen|where(?:'s| is| are)|do you know where|any (?:sign|word|news) of|heard from|what happened to)\b/i;
const RE_WHERE_GOING = /\b(where (?:are you|you) (?:going|off to|headed|heading)|what are you (?:doing|up to|after)|where to|what'?s the errand|on an errand)\b/i;

export class VillageLife {
  constructor(game, opts = {}) {
    this.game = game;
    this.sight = new Sightings(game, [...VILLAGERS, 'lyra', 'player']);
    this.sight.onBody = (seer, dead, place) => this.bodySeen(seer, dead, place);
    this.sight.onSeen = (seer, target) => this.onSeen(seer, target);
    this.book = new ErrandBook(this);
    this.cases = new Cases();
    this.absences = new Absences();
    this.problems = [];
    this.steps = new Map();
    this.stock = freshStock();
    this.know = {}; // id -> about -> { t, place, from, kind, with, heading, at }
    this.claims = [];
    this.pending = { lyra: null, npc: {} };
    this.expectDone = new Set();
    this.expectWait = new Map();
    this.thinkQueue = [];
    this.mourning = {}; // id -> { about, until (day), kind: 'worry'|'grief' }
    this.events = [];
    this.claude = new ClaudeReasoner(this, opts.claude || {});
    this.day = null;
    this.tickT = 0;
    this.sweepT = 0.1;
    this.claimT = 0;
    this.tokenSeq = 0;
    this.looking = new Set();
    this.lastThoughtAt = new Map();
    this.iconAt = new Map();
    this.perf = { n: 0, total: 0, max: 0, avg: 0 };
    this._r = opts.rng || null;
    this._offs = [];
    const bus = game?.bus;
    if (bus?.on) {
      this._offs.push(bus.on('player_message', (p) => safe(() => this.onPlayerMessage(p?.text))));
      this._offs.push(bus.on('trade', (p) => safe(() => this.onTrade(p))));
      this._offs.push(bus.on('time_skip', () => safe(() => this.onTimeSkip())));
    }
    this.installPlugin();
  }

  // ------------------------------------------------------------------ basics

  get village() {
    return this.game?.village || null;
  }

  rng() {
    if (this._r) return this._r;
    const g = this.game?.rng;
    if (g && typeof g.next === 'function') return () => g.next();
    return Math.random;
  }

  now() {
    return this.game?.clock?.t ?? 0;
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  dayN() {
    return this.game?.clock?.day ?? 1;
  }

  rt() {
    return this.game?.time ?? 0;
  }

  entity(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    const g = this.game;
    if (id === 'player') return g?.player || null;
    if (id === 'lyra') return g?.companion || safe(() => g?.entities?.get?.('lyra'));
    return safe(() => g?.entities?.get?.(id));
  }

  villagers() {
    const out = [];
    for (const id of VILLAGERS) {
      const e = this.entity(id);
      if (e && !e.removed) out.push(e);
    }
    return out;
  }

  profile(id) {
    return this.entity(id)?.profile || safe(() => profileById(id)) || null;
  }

  name(id) {
    if (id === 'player') return this.playerName();
    if (id === 'lyra') return this.game?.settings?.companionName || 'Lyra';
    return this.village?.name?.(id) || SHORT_NAMES[id] || id;
  }

  playerName() {
    return this.game?.settings?.playerName || 'the stranger';
  }

  // How speaker names someone in the third person ("Mister Bram", "Da", "the stranger").
  nameFor(speaker, id) {
    if (!id) return 'someone';
    if (id === 'player') {
      const e = this.entity(speaker);
      const knows = (e?.familiarity ?? 0) >= 3;
      return knows ? this.playerName() : voiceOf(speaker)?.stranger || 'the stranger';
    }
    if (id === speaker) return 'me';
    return thirdName(speaker, id);
  }

  placeName(id) {
    if (!id) return 'somewhere';
    return safe(() => this.game?.locations?.get?.(id)?.name) || cap(placePhrase(id));
  }

  placeOf(e) {
    if (!e) return null;
    return safe(() => this.game?.locations?.at?.(e.x, e.y)?.id) || null;
  }

  bond(a, b) {
    return safe(() => this.village?.bond?.(a, b)) || null;
  }

  care(a, b) {
    return careFor(this, a, b);
  }

  sameWork(a, b) {
    const pa = this.profile(a);
    const pb = this.profile(b);
    return !!pa?.work && pa.work === pb?.work && pa.work !== 'town_square';
  }

  sameHome(a, b) {
    const pa = this.profile(a);
    const pb = this.profile(b);
    return !!pa?.home && pa.home === pb?.home;
  }

  neighbours(a, b) {
    const L = this.game?.locations;
    const ha = L?.get?.(this.profile(a)?.home);
    const hb = L?.get?.(this.profile(b)?.home);
    if (!ha?.center || !hb?.center) return false;
    return Math.hypot(ha.center.x - hb.center.x, ha.center.y - hb.center.y) < 15 * TILE;
  }

  isHere(e) {
    return !!e && !e.removed && !e.absent && !e.hidden && (typeof e.isAlive === 'function' ? e.isAlive() : !e.dead);
  }

  // Up, about, and free to talk.
  available(e, { evenAsleep = false } = {}) {
    if (!this.isHere(e) || e.downed) return false;
    if (!evenAsleep && (e.state === 'sleep' || e.activity === 'sleep')) return false;
    if (e.mode && e.mode !== 'routine') return false;
    return true;
  }

  // Free to start something new: in their routine, awake, nobody talking to them.
  free(e) {
    if (!this.available(e)) return false;
    if (safe(() => this.village?.isTalking?.(e), false)) return false;
    if ((e.talkingUntil ?? -Infinity) > this.now()) return false;
    if (e.shakenDay === this.dayN()) return false;
    return true;
  }

  visible(e) {
    return !!e && safe(() => (typeof e.visibleToPlayer === 'function' ? e.visibleToPlayer(0) : false), false);
  }

  lyraTalks() {
    const l = this.game?.companion;
    if (!l || !this.isHere(l)) return false;
    const st = safe(() => l.mind?.companionship, 'together');
    return st !== 'gone';
  }

  playerAskable(npc) {
    const p = this.game?.player;
    if (!p || !this.isHere(p) || p.downed) return false;
    if (this.game?.state && this.game.state !== 'playing') return false;
    return dist(p, npc) < 150 && this.visible(npc);
  }

  // On an errand, in a conversation, helping someone up, or with the player: accounted for.
  busyElsewhere(e) {
    if (!e || !this.isHere(e)) return false;
    if (this.steps.has(e.id)) return true;
    if (e.mode && e.mode !== 'routine') return true;
    if (safe(() => this.village?.isTalking?.(e), false)) return true;
    return (e.talkingUntil ?? -Infinity) > this.now();
  }

  // Will they be back here soon (their day brings them here within half an hour)?
  expectedBackSoon(about, place) {
    const e = this.entity(about);
    if (!e || !this.isHere(e) || this.absences.get(about)) return false;
    if (this.busyElsewhere(e)) return true;
    const p = this.profile(about);
    const h = this.hour();
    for (const dh of [0.25, 0.5]) if (habitAt(p, (h + dh) % 24)?.at === place) return true;
    return false;
  }

  presentAt(p, placeId, from = null) {
    if (!p || !this.isHere(p)) return false;
    const loc = safe(() => this.game?.locations?.get?.(placeId));
    if (loc && inLoc(loc, p)) {
      // A big place (the farm, the road): there if the one looking is on it too, or near.
      if (!from || !loc.bounds || loc.bounds.w * loc.bounds.h < 600 || inLoc(loc, from)) return true;
      return dist(from, p) < 200;
    }
    return !!from && dist(from, p) < 120 && this.sight.canSee(from, p);
  }

  event(kind, text, { who = null, about = null, hidden = false } = {}) {
    if (!text) return;
    this.events.push({ t: Math.round(this.now() * 10) / 10, day: this.dayN(), kind, who, about, text, hidden });
    if (this.events.length > EVENTS_CAP) this.events.splice(0, this.events.length - EVENTS_CAP);
  }

  emit(type, payload) {
    safe(() => this.game?.bus?.emit?.(type, payload));
  }

  toast(text, kind = 'info', key = null) {
    safe(() => this.game?.ui?.toast?.(text, kind, key ? { key } : undefined));
  }

  // A line in someone's own voice about `about` (vars filled for places and times).
  line(speaker, key, vars = {}) {
    const v = { P: this.playerName(), knowsPlayer: (this.entity(speaker)?.familiarity ?? 0) >= 3, ...vars };
    if (v.placeId && !v.place) v.place = placePhrase(v.placeId, this.placeName(v.placeId));
    if (v.placeId && !v.at) v.at = placeAt(v.placeId, this.placeName(v.placeId));
    return lifeLine(speaker, key, v, { rng: this.rng() });
  }

  thought(speaker, key, vars = {}) {
    const v = { P: this.playerName(), ...vars };
    if (v.placeId && !v.place) v.place = placePhrase(v.placeId, this.placeName(v.placeId));
    if (v.placeId && !v.at) v.at = placeAt(v.placeId, this.placeName(v.placeId));
    return thoughtLine(key, speaker, v, { rng: this.rng() });
  }

  sayAloud(e, text, target = null) {
    if (!e || !text || !this.isHere(e)) return;
    if (safe(() => this.village?.isTalking?.(e), false)) return;
    if (!this.visible(e)) return; // nobody to hear it: the village view keeps it
    if (e === this.game?.companion) safe(() => e.mind?.say?.(text, { target }));
    else if (typeof e.say === 'function') safe(() => e.say(text, { target }));
    if (this.game) this.game._npcSayAt = this.now();
  }

  // Their thought as a thought bubble, only when the player is right beside them.
  showThought(e, text) {
    const g = this.game;
    if (!e || !text || !g?.settings?.showThoughts) return;
    const p = g.player;
    if (!p || dist(p, e) > 110 || !this.visible(e)) return;
    const t = this.rt();
    if (t - (this.lastThoughtAt.get(e.id) ?? -Infinity) < 6) return;
    this.lastThoughtAt.set(e.id, t);
    safe(() => g.bubbles?.thought?.(e, text, { duration: 4 }));
  }

  // ------------------------------------------------------------------ the day

  ensureDay() {
    const d = this.dayN();
    if (this.day === d) return;
    const prev = this.day;
    this.day = d;
    this.startDay(d, prev);
  }

  startDay(d, prev) {
    const t = this.now();
    // Yesterday's errand troubles end with the day; worry about a person does not.
    for (const p of this.problems) {
      if (p.status === 'open' && p.day < d) this.closeProblem(p, 'given_up', 'the day ended');
    }
    this.problems = this.problems.filter((p) => p.status === 'open' || p.day >= d - 1).slice(-60);
    this.steps.clear();
    this.thinkQueue.length = 0;
    this.expectDone.clear();
    this.expectWait.clear();
    this.stock = freshStock();
    seedMorningGoods(this.game, VILLAGERS);
    if (this.book.day !== d) {
      const fromHour = prev == null ? this.hour() : 0;
      this.book.plan(d, { fromHour, profiles: this.villagers().map((e) => e.profile).filter(Boolean), isAbsent: (id) => !!this.absences.get(id), seed: this.game?.seed ?? 20261123 });
    }
    // Still missing come morning: the village says so, and the watch looks again.
    for (const c of this.cases.active()) {
      if (c.status === 'missing') {
        const days = d - (c.declaredDay ?? c.day);
        this.cases.note(c, t, days >= 1 ? `Day ${d}: still no word of ${this.name(c.about)}.` : `Morning: no word of ${this.name(c.about)}.`, 'missing');
        c.searched = {};
        c.searchDay = null;
      }
    }
    for (const [id, m] of Object.entries(this.mourning)) if (m.until < d) delete this.mourning[id];
    // Someone away comes back by the next day at the latest.
    for (const [id, a] of this.absences.entries()) if (a.mode === 'away' && a.day < d) this.markBack(id);
  }

  onTimeSkip() {
    this.steps.clear();
    this.thinkQueue.length = 0;
    for (const p of this.problems) p.awaiting = false;
    this.ensureDay();
  }

  // ------------------------------------------------------------------ the frame

  update(dt) {
    const g = this.game;
    if (!g || (g.state && g.state !== 'playing')) return;
    const t0 = perfNow();
    this.ensureDay();
    this.sweepT -= dt;
    if (this.sweepT <= 0) {
      this.sweepT = SWEEP;
      this.refreshLooking();
      this.sight.sweep();
    }
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = TICK;
      this.tick();
    }
    const ms = perfNow() - t0;
    const P = this.perf;
    P.n++;
    P.total += ms;
    P.avg = P.total / P.n;
    if (ms > P.max) P.max = ms;
  }

  tick() {
    const t = this.now();
    const hour = this.hour();
    this.returnAway(t);
    const list = this.villagers();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.absent) continue;
      const step = this.steps.get(e.id);
      if (step) {
        // The player is talking to them: their errand waits (and its clock with it).
        if ((e.talkingUntil ?? -Infinity) > t && step.phase !== 'talk') {
          step.t0 += TICK;
          step.readyAt += TICK;
          if (step.until) step.until += TICK;
          continue;
        }
        safe(() => this.progress(e, step, t, hour));
        continue;
      }
      if (!this.free(e)) continue;
      const prob = this.openProblem(e.id);
      if (prob) {
        if (!prob.awaiting && t >= prob.due && !this.thinkQueue.includes(prob)) {
          if (prob.steps >= MAX_STEPS) this.giveUp(prob, e);
          else {
            prob.queuedAt = this.rt();
            this.thinkQueue.push(prob);
          }
        }
        continue;
      }
      const due = this.book.due(e.id, hour);
      if (due) {
        safe(() => this.startErrand(e, due, t));
        continue;
      }
      if ((i + Math.floor(t * 2)) % 4 === 0) safe(() => this.checkExpectations(e, t, hour));
    }
    safe(() => this.runThinking());
    safe(() => this.tickCases(t, hour));
    safe(() => this.tickLyra(t));
    this.claimT -= TICK;
    if (this.claimT <= 0 && this.claims.length) {
      this.claimT = 2;
      safe(() => this.checkClaims());
    }
    safe(() => this.icons());
    safe(() => this.murmur());
  }

  // Now and then, someone near the player says what is on their mind: a worry, a grief,
  // the shop they are minding. One line at a time, never over other talk.
  murmur() {
    const g = this.game;
    const p = g?.player;
    if (!p) return;
    const rt = this.rt();
    if (rt - (this.murmurAt ?? -Infinity) < 14) return;
    if (this.now() - (g._npcSayAt ?? -Infinity) < 6 || safe(() => this.village?.playing, null)) return;
    for (const e of this.villagers()) {
      if (dist(e, p) > 140 || !this.free(e) || !this.visible(e) || this.steps.get(e.id)?.phase === 'talk') continue;
      if (rt - (this.murmured?.get(e.id) ?? -Infinity) < 50) continue;
      const line = this.ambientLine(e);
      if (!line) continue;
      (this.murmured ||= new Map()).set(e.id, rt);
      this.murmurAt = rt;
      this.sayAloud(e, line);
      return;
    }
  }

  // Who the village is looking for right now (cheap filter for each fresh sighting).
  refreshLooking() {
    this.looking.clear();
    for (const p of this.problems) if (p.status === 'open' && p.about) this.looking.add(p.about);
    for (const c of this.cases.active()) this.looking.add(c.about);
  }

  // ------------------------------------------------------------------ steps

  makeStep(e, kind, data = {}) {
    const t = this.now();
    const token = `${kind}${++this.tokenSeq}`;
    const step = { kind, token, t0: t, readyAt: t, phase: 'go', ...data };
    step.entry = this.entryForStep(e, step);
    const spot = step.entry.spot || this.placeCenter(step.entry.at) || e;
    step.readyAt = t + Math.min(30, dist(e, spot) / Math.max(20, e.speed || 40));
    this.steps.set(e.id, step);
    return step;
  }

  placeCenter(id) {
    return safe(() => this.game?.locations?.get?.(id)?.center) || null;
  }

  entryForStep(e, step) {
    const doing = step.doing || '';
    const base = { vl: step.token, doing };
    switch (step.kind) {
      case 'errand':
        return { ...base, activity: step.place === 'stonecut_quarry' || step.wander ? 'wander' : 'errand', at: step.place, spot: step.spot || null, near: step.near || null };
      case 'search':
      case 'away':
        return { ...base, activity: 'wander', at: step.place };
      case 'wait':
        return { ...base, activity: 'errand', at: this.placeOf(e) || step.place, spot: { x: e.x, y: e.y } };
      case 'go':
        return { ...base, activity: 'errand', at: step.place };
      default: {
        // Walking up to someone: stand at their elbow.
        const tgt = this.entity(step.target);
        const spot = tgt ? this.spotBeside(e, tgt) : null;
        step.spotFor = tgt ? { x: tgt.x, y: tgt.y } : null;
        return { ...base, activity: 'errand', at: (tgt && this.placeOf(tgt)) || this.placeOf(e), spot, lookAt: tgt || null };
      }
    }
  }

  spotBeside(e, tgt) {
    const side = e.x < tgt.x ? -1 : 1;
    const f = safe(() => e.freeNear?.(tgt.x + side * 14, tgt.y + 4));
    return f || { x: tgt.x + side * 14, y: tgt.y + 4 };
  }

  endStep(e) {
    this.steps.delete(e.id);
    if (e.r) e.r.key = null;
  }

  arrived(e, step, t) {
    return !!e.r && e.r.key === `vl:${step.token}` && e.r.phase === 'stay' && t >= step.readyAt;
  }

  progress(e, step, t, hour) {
    if (step.kind === 'away') return;
    // Something else took them over (a fight, a call for help, the player): try again later.
    if (e.mode && e.mode !== 'routine') {
      if (t - step.t0 > STEP_MAX) this.abortStep(e, step, 'interrupted');
      return;
    }
    if (step.phase === 'talk') {
      if (t >= step.until || (!safe(() => this.village?.isTalking?.(e), false) && t >= step.minUntil)) {
        step.phase = 'done';
        const then = step.after;
        this.endStep(e);
        if (then) safe(() => then());
      }
      return;
    }
    if (t - step.t0 > STEP_MAX && step.kind !== 'search' && step.kind !== 'wait') {
      this.abortStep(e, step, 'took too long');
      return;
    }
    switch (step.kind) {
      case 'errand':
        return this.progressErrand(e, step, t, hour);
      case 'go':
        if (this.arrived(e, step, t)) this.look(e, step, t);
        return;
      case 'search':
        return this.progressSearch(e, step, t);
      case 'wait':
        return this.progressWait(e, step, t);
      case 'ask':
      case 'alarm':
      case 'meet':
      case 'askPlayer':
        return this.progressApproach(e, step, t);
      default:
    }
  }

  abortStep(e, step, why) {
    this.endStep(e);
    const prob = step.prob ? this.problemById(step.prob) : null;
    if (prob && prob.status === 'open') prob.due = this.now() + BEAT;
    if (step.errand) {
      const inst = this.book.get(step.errand);
      if (inst && inst.state === 'active' && !inst.problem) {
        inst.state = 'planned';
        inst.start = this.hour() + 0.2;
        inst.tries++;
        if (inst.tries > 2) {
          inst.state = 'skipped';
          inst.result = why;
        }
      }
    }
  }

  // ------------------------------------------------------------------ errands

  startErrand(e, inst, t) {
    const tpl = errandTemplate(inst.tpl) || {};
    // Nobody runs an errand to someone they know is missing.
    if (inst.to && this.knowsMissing(e.id, inst.to)) {
      inst.state = 'skipped';
      inst.result = `${this.name(inst.to)} is missing`;
      return;
    }
    inst.state = 'active';
    inst.t0 = t;
    inst.tries++;
    const to = inst.to ? this.entity(inst.to) : null;
    let spot = null;
    if (to && this.presentAt(to, inst.at)) spot = this.spotBeside(e, to);
    const near = !inst.to && inst.tpl === 'bram_hinge' ? ['well'] : null;
    this.makeStep(e, 'errand', { errand: inst.id, place: inst.at, spot, near, doing: inst.label, wander: inst.kind === 'fetch' });
    // Whoever sees them set off knows where they went.
    for (const w of this.watchers(e)) this.sight.note(w, e.id, { t, x: e.x, y: e.y, place: this.placeOf(e), heading: inst.at });
    this.event('errand', `${this.name(e.id)} is ${inst.label}.`, { who: e.id, about: inst.to });
    this.emit('errand_started', { npc: e, errand: inst });
    if (tpl.going?.length && this.visible(e) && this.now() - (this.game?._npcSayAt ?? -Infinity) > 4) {
      const l = fillLine(tpl.going[Math.floor(this.rng()() * tpl.going.length)], e.id, { P: this.playerName() });
      this.sayAloud(e, l);
    }
  }

  progressErrand(e, step, t, hour) {
    const inst = this.book.get(step.errand);
    if (!inst || inst.state !== 'active') return this.endStep(e);
    if (step.phase === 'work') {
      if (t >= step.until) this.completeErrand(e, inst);
      return;
    }
    if (step.phase === 'waitPerson') {
      const to = this.entity(inst.to);
      if (to && this.free(to) && this.presentAt(to, inst.at, e)) return this.errandExchange(e, to, inst, step);
      if (t >= step.until) this.errandProblem(e, inst, step, t);
      return;
    }
    if (!this.arrived(e, step, t)) return;
    if (!inst.to) {
      // A job at a place: the way may be blocked.
      const threat = safe(() => this.game?.entities?.nearest?.(e.x, e.y, 120, (x) => x !== e && x.faction === 'hostile' && (typeof x.isAlive !== 'function' || x.isAlive())));
      if (threat) {
        this.endStep(e);
        return this.newProblemFor(e, { kind: 'blocked', errand: inst.id, purpose: inst.purpose, goods: inst.goods, place: inst.at, care: inst.care });
      }
      step.phase = 'work';
      step.until = t + (inst.kind === 'fetch' ? 14 : 9);
      const tpl = errandTemplate(inst.tpl);
      if (tpl?.solo?.length) this.sayAloud(e, fillLine(tpl.solo[Math.floor(this.rng()() * tpl.solo.length)], e.id, {}));
      return;
    }
    const to = this.entity(inst.to);
    if (to && this.presentAt(to, inst.at, e)) {
      if (this.free(to) && dist(e, to) < 160) return this.errandExchange(e, to, inst, step);
      // There, but busy (with the player, in a talk, asleep): a moment's patience.
      step.phase = 'waitPerson';
      step.until = t + 12;
      return;
    }
    this.errandProblem(e, inst, step, t);
  }

  errandProblem(e, inst, step, t) {
    this.endStep(e);
    const shopkeeper = SHOPKEEPERS[inst.at] === inst.to;
    this.newProblemFor(e, {
      kind: shopkeeper ? 'shut' : 'absent',
      about: inst.to,
      errand: inst.id,
      purpose: inst.purpose,
      goods: inst.goods,
      shop: placePhrase(inst.at, this.placeName(inst.at)),
      place: inst.at,
      care: Math.max(inst.care ?? 0.5, this.care(e.id, inst.to) * 0.9),
    });
  }

  errandExchange(e, to, inst, step) {
    if (!inStock(this.stock, inst)) {
      this.endStep(e);
      return this.newProblemFor(e, { kind: 'item', about: inst.to, errand: inst.id, purpose: inst.purpose, goods: inst.goods, place: inst.at, care: inst.care });
    }
    const tpl = errandTemplate(inst.tpl) || {};
    const talks = tpl.talks?.length ? tpl.talks[Math.floor(this.rng()() * tpl.talks.length)] : null;
    const lines = (talks || [[e.id, `${cap(inst.goods)}, ${this.name(to.id)}.`]]).map(([sp, text]) => [sp, fillLine(text, sp, { P: this.playerName(), listener: sp === e.id ? to.id : e.id })]);
    const summary = describeErrand(this, inst);
    this.talk(e, to, lines, { topic: 'work', summary, step, after: () => this.completeErrand(e, inst) });
  }

  completeErrand(e, inst) {
    const t = this.now();
    this.endStep(e);
    if (inst.state === 'done') return;
    const text = applyEffects(this, inst);
    inst.state = 'done';
    inst.result = text;
    inst.t1 = t;
    this.event('done', text, { who: inst.who, about: inst.to });
    this.emit('errand_done', { npc: e, errand: inst });
    const tpl = errandTemplate(inst.tpl);
    if (tpl?.next?.id) this.book.add(tpl.next.id, inst.who, this.hour() + 0.05, 24);
  }

  // Two people talk it through. On screen the lines play as bubbles; off screen the talk
  // resolves at once (the village logs it either way).
  talk(a, b, lines, { topic = 'news', summary = '', step = null, after = null } = {}) {
    const t = this.now();
    const clean = lines.filter((l) => l && l[1]);
    const v = this.village;
    const onScreen = !!v && (safe(() => v.onScreen?.(a), false) || safe(() => v.onScreen?.(b), false));
    let conv = null;
    if (v?.converse && clean.length && (VILLAGERS.includes(a.id) || a.id === 'lyra') && (VILLAGERS.includes(b.id) || b.id === 'lyra')) {
      conv = safe(() => v.converse(a.id, b.id, { lines: clean.map(([speaker, text]) => ({ speaker, text })), topic, onScreen, source: 'village_life', summary }));
      if (conv && summary) conv.summary = summary;
    } else {
      // No village to play it: each says their line in turn.
      let at = 0;
      for (const [sp, text] of clean) {
        const who = sp === a.id ? a : b;
        if (who && typeof who.say === 'function' && this.visible(who)) {
          if (at === 0) safe(() => who.say(text, { target: who === a ? b : a }));
          else who.pendingSay = { at: t + at, text, kind: 'say', target: who === a ? b : a };
        }
        at += 2.2;
      }
    }
    let beats = 0;
    for (const [, text] of clean) beats += Math.min(7, 2 + text.length / 16);
    let s = step;
    if (!s) {
      const token = `talk${++this.tokenSeq}`;
      s = { kind: 'talk', token, t0: t, readyAt: t, entry: { activity: 'errand', at: this.placeOf(a), vl: token, spot: { x: a.x, y: a.y }, lookAt: b, doing: 'talking' } };
    }
    s.phase = 'talk';
    s.minUntil = t + (onScreen ? beats * 0.8 : 4);
    s.until = t + (onScreen ? beats + 3 : 6);
    s.after = after;
    if (!this.steps.has(a.id)) this.steps.set(a.id, s);
    return conv;
  }

  // ------------------------------------------------------------------ expectations

  checkExpectations(e, t, hour) {
    for (let i = 0; i < EXPECTS.length; i++) {
      const x = EXPECTS[i];
      if (x.who !== e.id || hour < x.window[0] || hour > x.window[1]) continue;
      const key = `${i}`;
      if (this.expectDone.has(key)) continue;
      if (!this.presentAt(e, x.at)) continue; // they are not there themselves (yet)
      const whom = this.entity(x.whom);
      if (whom && this.presentAt(whom, x.at, e)) {
        this.expectDone.add(key);
        this.expectWait.delete(key);
        continue;
      }
      if (whom && this.busyElsewhere(whom)) continue; // on an errand: they'll be back
      if (!this.expectWait.has(key)) this.expectWait.set(key, t);
      if (t - this.expectWait.get(key) < GRACE * (x.late ? 2 : 1)) continue;
      this.expectDone.add(key);
      this.expectWait.delete(key);
      if (this.openProblem(e.id)) continue;
      this.newProblemFor(e, {
        kind: 'absent',
        about: x.whom,
        expect: key,
        purpose: x.what,
        shop: placePhrase(x.at, this.placeName(x.at)),
        place: x.at,
        care: this.care(e.id, x.whom) * (x.mild ? 0.7 : 1),
      });
      return;
    }
  }

  // ------------------------------------------------------------------ problems

  openProblem(id) {
    for (const p of this.problems) if (p.owner === id && p.status === 'open') return p;
    return null;
  }

  problemById(id) {
    return this.problems.find((p) => p.id === id) || null;
  }

  newProblemFor(e, data) {
    const t = this.now();
    const existing = this.openProblem(e.id);
    if (existing) return existing;
    const prob = newProblem({ owner: e.id, t, day: this.dayN(), ...data });
    prob.due = t + BEAT;
    const memo = data.about ? this.dayMemo(e.id, data.about) : null;
    if (memo) {
      for (const id of memo.asked) if (!prob.asked.includes(id)) prob.asked.push(id);
      for (const [pl, at] of Object.entries(memo.checked)) {
        if (!prob.checked.includes(pl)) prob.checked.push(pl);
        prob.checkedAt[pl] = Math.max(prob.checkedAt[pl] ?? 0, at);
      }
      prob.heard.push(...memo.heard.slice(-6));
    }
    this.problems.push(prob);
    if (data.errand) {
      const inst = this.book.get(data.errand);
      if (inst) inst.problem = prob.id;
    }
    this.looking.add(prob.about);
    const what =
      prob.kind === 'item'
        ? `${this.name(prob.about)} had no ${prob.goods} left for ${this.name(e.id)}.`
        : prob.kind === 'blocked'
          ? `${this.name(e.id)} could not get into ${this.placeName(prob.place)}: something dangerous is there.`
          : prob.kind === 'worried'
            ? `${this.name(e.id)} is worried about ${this.name(prob.about)}.`
            : prob.errand
              ? `${this.name(e.id)} went to ${this.placeName(prob.place)} to ${prob.purpose}, but ${this.name(prob.about)} wasn't there.`
              : `${this.name(e.id)} expected ${this.name(prob.about)} at ${this.placeName(prob.place)}, to ${prob.purpose}. ${cap(pronoun(prob.about, 'he'))} never came.`;
    this.event('problem', what, { who: e.id, about: prob.about });
    if (prob.about && (prob.kind === 'absent' || prob.kind === 'shut' || prob.kind === 'worried')) this.notice(prob.about, e.id, prob.place, t);
    this.emit('village_problem', { npc: e, problem: prob });
    const icon = safe(() => this.game?.bubbles?.icon?.(e, '?', { duration: 2.6 }));
    if (icon) this.iconAt.set(e.id, this.rt());
    return prob;
  }

  // What someone already asked, looked at and heard about a person today.
  dayMemo(owner, about) {
    const key = `${this.dayN()}:${owner}:${about}`;
    this._memo ||= new Map();
    if (this._memo.size > 400) this._memo.clear();
    let m = this._memo.get(key);
    if (!m) this._memo.set(key, (m = { asked: [], checked: {}, heard: [] }));
    return m;
  }

  remember(prob) {
    if (!prob?.about) return;
    const m = this.dayMemo(prob.owner, prob.about);
    for (const id of prob.asked) if (!m.asked.includes(id)) m.asked.push(id);
    for (const [pl, at] of Object.entries(prob.checkedAt || {})) m.checked[pl] = Math.max(m.checked[pl] ?? 0, at);
    m.heard = [...m.heard, ...prob.heard].slice(-8);
  }

  closeProblem(prob, status, why = '') {
    if (!prob || prob.status !== 'open') return;
    this.remember(prob);
    prob.status = status;
    prob.resolvedAt = this.now();
    prob.resolution = why;
    prob.awaiting = false;
    const i = this.thinkQueue.indexOf(prob);
    if (i >= 0) this.thinkQueue.splice(i, 1);
    if (prob.errand) {
      const inst = this.book.get(prob.errand);
      if (inst && inst.state === 'active') {
        if (status === 'resolved' && this.hour() < inst.end - 0.1 && inst.tries < 3) {
          // Back to it: the errand can be done now.
          inst.state = 'planned';
          inst.start = this.hour();
          inst.problem = null;
        } else {
          inst.state = status === 'resolved' ? 'skipped' : 'failed';
          inst.result = why || status;
          this.emit('errand_failed', { npc: this.entity(prob.owner), errand: inst });
        }
      }
    }
  }

  giveUp(prob, e) {
    this.closeProblem(prob, 'given_up', 'gave up for today');
    this.event('give_up', `${this.name(prob.owner)} gave up${prob.about ? ` looking for ${this.name(prob.about)}` : ''} for today.`, { who: prob.owner, about: prob.about });
    // Those who love the missing do not stop worrying.
    if (prob.about && prob.care >= 0.6 && !this.mourning[prob.owner]) this.mourning[prob.owner] = { about: prob.about, until: this.dayN() + 2, kind: 'worry' };
  }

  // ------------------------------------------------------------------ thinking

  inputFor(prob) {
    return buildInput(this, prob);
  }

  localDecision(prob, input = null) {
    const I = input || this.inputFor(prob);
    const base = { about: prob.about, purpose: prob.purpose, goods: prob.goods, shop: prob.shop, when: I.ownSeen?.when || whenPhrase(prob.since, this.now()) };
    return decideLocal(I, {
      rng: this.rng(),
      say: (key, vars) => this.line(prob.owner, key, { ...base, ...vars }),
      think: (key, vars) => this.thought(prob.owner, key, { ...base, ...vars }),
    });
  }

  runThinking() {
    const q = this.thinkQueue;
    if (!q.length) return;
    const rt = this.rt();
    const claude = this.claude;
    const useClaude = claude.enabled() && claude.waitFor() <= HOLD;
    if (useClaude && claude.ready()) {
      const batch = q.splice(0, THINK_BATCH).filter((p) => p.status === 'open');
      if (!batch.length) return;
      const inputs = batch.map((p) => this.inputFor(p));
      for (const p of batch) p.awaiting = true;
      claude
        .decide(inputs)
        .then((map) => {
          batch.forEach((p, i) => {
            p.awaiting = false;
            if (p.status !== 'open') return;
            const d = map.get(p.owner) || this.localDecision(p, inputs[i]);
            this.apply(p, d);
          });
        })
        .catch(() => {
          for (const p of batch) {
            p.awaiting = false;
            if (p.status === 'open') this.apply(p, this.localDecision(p));
          }
        });
      return;
    }
    for (let i = q.length - 1; i >= 0; i--) {
      const p = q[i];
      if (useClaude && rt - (p.queuedAt ?? rt) < HOLD) continue;
      q.splice(i, 1);
      if (p.status === 'open') this.apply(p, this.localDecision(p));
    }
  }

  apply(prob, d) {
    if (!prob || prob.status !== 'open' || !d?.action) return;
    const t = this.now();
    const e = this.entity(prob.owner);
    if (!e || !this.isHere(e)) return this.closeProblem(prob, 'given_up', 'not here');
    prob.steps++;
    prob.thought = d.thought || prob.thought;
    prob.said = d.say || '';
    if (d.belief) prob.belief = d.belief;
    const { type } = d.action;
    let target = d.action.target ?? null;
    prob.history.push({ t: Math.round(t), thought: d.thought || '', say: d.say || '', action: type, target, by: d.source || 'local' });
    if (prob.history.length > 16) prob.history.shift();
    if (d.thought) this.event('think', `${this.name(prob.owner)}: “${d.thought}”`, { who: prob.owner, about: prob.about });
    if (d.say) this.sayAloud(e, d.say);
    if (d.thought) this.showThought(e, d.thought);
    if (!this.free(e)) {
      prob.due = t + BEAT;
      return;
    }
    const about = prob.about;
    const aboutName = about ? this.name(about) : '';
    switch (type) {
      case 'go':
        this.makeStep(e, 'go', { place: target, prob: prob.id, doing: `looking for ${aboutName} at ${this.placeName(target)}` });
        break;
      case 'search':
        this.makeStep(e, 'search', { place: target, prob: prob.id, about, doing: `searching ${placePhrase(target)} for ${aboutName}` });
        break;
      case 'ask':
        if (target === 'player') this.makeStep(e, 'askPlayer', { target: 'player', prob: prob.id, about, doing: `asking you about ${aboutName}` });
        else this.makeStep(e, 'ask', { target, prob: prob.id, about, doing: `asking ${this.name(target)} about ${aboutName}` });
        break;
      case 'tell_lyra':
        this.makeStep(e, 'ask', { target: 'lyra', prob: prob.id, about, doing: `asking Lyra about ${aboutName}` });
        break;
      case 'alarm': {
        if (!about) {
          this.giveUp(prob, e);
          break;
        }
        if (WATCH.includes(e.id) && !this.cases.get(about)?.leader) {
          this.startSearch(about, e.id, { by: e.id });
          break;
        }
        const leader = this.cases.get(about)?.leader || searchLeader(this, about);
        if (!leader || leader === e.id) this.startSearch(about, e.id, { by: e.id });
        else this.makeStep(e, 'alarm', { target: leader, prob: prob.id, about, doing: `telling ${this.name(leader)} that ${aboutName} is missing` });
        break;
      }
      case 'wait':
        this.makeStep(e, 'wait', { prob: prob.id, about, place: this.placeOf(e), until: t + (prob.steps <= 1 ? 0.35 : 0.25) * HOUR, doing: about ? `waiting for ${aboutName}` : 'waiting' });
        break;
      default:
        this.giveUp(prob, e);
        if (d.say === '' || !d.say) this.sayAloud(e, this.line(prob.owner, 'giveUp', { about }));
    }
  }

  // ------------------------------------------------------------------ looking, waiting, searching

  // Can e see `about` from where they are (or are they in the same small place)? A proper
  // search of a place (thorough) covers all of it, however big: the lake shore, the farm.
  findsHere(e, aboutId, placeId = null) {
    const x = this.entity(aboutId);
    if (!x || !this.isHere(x)) return false;
    if (this.sight.canSee(e, x)) return true;
    const here = placeId || this.placeOf(e);
    const loc = here && safe(() => this.game?.locations?.get?.(here));
    if (!loc || !inLoc(loc, x)) return false;
    return !!placeId || loc.indoor || (loc.bounds && loc.bounds.w * loc.bounds.h < 200);
  }

  look(e, step, t) {
    const prob = this.problemById(step.prob);
    this.endStep(e);
    if (!prob || prob.status !== 'open') return;
    if (!prob.checked.includes(step.place)) prob.checked.push(step.place);
    (prob.checkedAt ||= {})[step.place] = t;
    if (prob.about && this.findsHere(e, prob.about)) return this.problemFound(prob, e, this.entity(prob.about));
    const c = prob.about ? this.cases.get(prob.about) : null;
    if (c) c.searched[step.place] ||= { by: e.id, t: Math.round(t) };
    this.sayAloud(e, this.line(e.id, 'nothing', { about: prob.about }));
    prob.due = t + BEAT;
  }

  progressWait(e, step, t) {
    const prob = this.problemById(step.prob);
    if (!prob || prob.status !== 'open') return this.endStep(e);
    if (prob.about && this.findsHere(e, prob.about)) {
      this.endStep(e);
      return this.problemFound(prob, e, this.entity(prob.about));
    }
    if (t >= step.until) {
      this.endStep(e);
      prob.due = t + 0.5;
    }
  }

  progressSearch(e, step, t) {
    if (!this.arrived(e, step, t)) return;
    if (!step.searchStart) {
      step.searchStart = t;
      step.callAt = t;
    }
    const about = step.about;
    // Searching a big place takes a while to cover: halfway through, the whole of it.
    const thorough = t - step.searchStart > (step.dur || SEARCH_SECONDS) * 0.5 ? step.place : null;
    if (about && this.findsHere(e, about, thorough)) {
      this.endStep(e);
      const prob = this.problemById(step.prob);
      if (prob && prob.status === 'open') return this.problemFound(prob, e, this.entity(about));
      return this.found(about, e.id);
    }
    if (t - step.callAt > 7) {
      step.callAt = t;
      this.sayAloud(e, this.line(e.id, 'search', { about }));
    }
    if (t - step.searchStart < (step.dur || SEARCH_SECONDS)) return;
    // Searched: nothing.
    this.endStep(e);
    const c = about ? this.cases.get(about) : null;
    if (c) {
      c.searched[step.place] = { by: e.id, t: Math.round(t) };
      if (c.searchers) delete c.searchers[e.id];
      this.cases.note(c, t, `${this.name(e.id)} searched ${placePhrase(step.place, this.placeName(step.place))}: nothing.`, 'search');
    }
    const prob = step.prob ? this.problemById(step.prob) : null;
    if (prob && prob.status === 'open') {
      if (!prob.checked.includes(step.place)) prob.checked.push(step.place);
      prob.due = t + BEAT;
    } else if (c && step.party) this.nextSearch(e, c, t);
  }

  // ------------------------------------------------------------------ asking

  progressApproach(e, step, t) {
    const tgt = this.entity(step.target);
    const prob = step.prob ? this.problemById(step.prob) : null;
    if (step.kind !== 'meet' && prob && prob.status !== 'open') return this.endStep(e);
    if (!tgt || !this.isHere(tgt) || tgt.downed || (tgt === this.game?.companion && tgt.state === 'sleep')) {
      this.endStep(e);
      if (prob) {
        if (!prob.asked.includes(step.target)) prob.asked.push(step.target);
        prob.due = t + BEAT;
      }
      return;
    }
    // They moved off: follow (at most every few seconds).
    if (step.spotFor && dist(step.spotFor, tgt) > 48 && t - (step.reroutedAt ?? step.t0) > 3) {
      step.reroutedAt = t;
      step.token = `${step.kind}${++this.tokenSeq}`;
      step.entry = this.entryForStep(e, step);
      step.readyAt = Math.max(step.readyAt, t + 1);
    }
    const d = dist(e, tgt);
    const close = d < REACH || (this.arrived(e, step, t) && d < 90);
    if (!close) return;
    if (t < step.readyAt) return;
    if (step.kind === 'askPlayer') return this.askThePlayer(e, step, tgt, t);
    // Wait while they finish with someone else.
    if (tgt !== this.game?.companion && !this.free(tgt) && (tgt.state === 'sleep' || safe(() => this.village?.isTalking?.(tgt), false) || (tgt.talkingUntil ?? -Infinity) > t)) {
      step.waitT = (step.waitT ?? t);
      if (t - step.waitT > 12) {
        this.endStep(e);
        if (prob) {
          if (!prob.asked.includes(tgt.id)) prob.asked.push(tgt.id);
          prob.due = t + BEAT;
        }
      }
      return;
    }
    if (step.kind === 'alarm') return this.alarmExchange(e, tgt, step, prob, t);
    if (step.kind === 'meet') return this.meetExchange(e, tgt, step, t);
    return this.askExchange(e, tgt, step, prob, t);
  }

  // What `who` can tell about `about`, from their own eyes first, then what they were told.
  answerFor(who, about, askerId) {
    const t = this.now();
    const s = this.sight.lastSeen(who, about);
    const k = this.know[who]?.[about];
    const vars = { about, listener: askerId };
    let key;
    let info;
    // Out with the search party: the whole village knows the watch is out.
    const xs = this.steps.get(about);
    const xc = xs?.party ? this.cases.get(xs.about) : null;
    if (xc && xs.about !== askerId && (this.seerKnows(xc, who) || (s && t - s.t < HOUR))) {
      vars.doing = `out searching for ${this.nameFor(who, xs.about)}`;
      const line = this.line(who, 'busy', vars);
      return { line, info: { kind: 'busy', doing: vars.doing, place: xs.place, placeName: this.placeName(xs.place) } };
    }
    if (s && t - s.t < 900 * 1.2) {
      vars.when = whenPhrase(s.t, t);
      vars.placeId = s.heading || s.place;
      info = { kind: 'seen', place: s.place, placeName: this.placeName(s.place), t: s.t, when: vars.when, with: s.with || null, heading: s.heading || null, headingName: s.heading ? this.placeName(s.heading) : null };
      if (s.heading) key = 'heading';
      else if (s.with && s.with !== askerId && s.with !== about) {
        key = 'seenWith';
        vars.with = this.nameFor(who, s.with);
        info.withName = vars.with;
      } else key = 'seen';
    } else if (k && t - (k.at ?? 0) < 900 && k.from !== askerId) {
      key = 'heard';
      vars.from = k.from === askerId ? 'you' : this.nameFor(who, k.from);
      vars.when = whenPhrase(k.t, t);
      vars.placeId = k.heading || k.place;
      info = { kind: 'heard', place: k.place, placeName: this.placeName(k.place), t: k.t, when: vars.when, with: k.with || null, heading: k.heading || null, via: k.from };
    } else if (this.care(who, about) >= 0.6 && habitAt(this.profile(about), this.hour())?.at) {
      const h = habitAt(this.profile(about), this.hour()).at;
      key = 'guess';
      vars.placeId = h;
      info = { kind: 'guess', place: h, placeName: this.placeName(h) };
    } else {
      key = s ? 'notSeen' : 'never';
      vars.when = s ? whenPhrase(s.t, t) : 'yesterday';
      info = { kind: 'none', when: vars.when };
    }
    let line = this.line(who, key, vars);
    if (!line) line = this.line(who, 'never', { about, listener: askerId }) || 'No.';
    // Someone who already knows he is being looked for does not ask what is wrong.
    const c = this.cases.get(about);
    if (c && (this.seerKnows(c, who) || this.know[who]?.[`asked:${about}`]) && line) {
      const cut = line.replace(/\s*(?:Is (?:something|anything) wrong|Is something the matter|Why|Why do you ask|What's happened|What's wrong|Is that bad|Is that a clue|Should I have|Is there a matter before the Moot|Is it an incident)\?(?:[^.!?]*\?)*\s*$/i, '').trim();
      if (cut.length > 3) line = cut;
    }
    return { line, info };
  }

  // Lyra answering from what she saw, and from what the player told her.
  lyraKnowledge(about) {
    const own = this.sight.lastSeen('lyra', about);
    const claim = this.claims.filter((c) => c.to === 'lyra' && c.about === about && c.kind === 'seen_at').pop();
    return { own, claim };
  }

  askExchange(e, tgt, step, prob, t) {
    const about = step.about || prob?.about;
    let ans = this.answerFor(tgt.id, about, e.id);
    if (tgt.id === 'lyra') {
      const { own, claim } = this.lyraKnowledge(about);
      if (!own || t - own.t > 900) {
        if (claim) {
          const vars = { about, listener: e.id, from: this.playerName(), when: whenPhrase(claim.t, t), placeId: claim.place };
          ans = { line: this.line('lyra', 'heard', vars), info: { kind: 'heard', place: claim.place, placeName: this.placeName(claim.place), t: claim.t, when: vars.when, via: 'player' } };
        }
      }
      const c = this.cases.get(about);
      if (c) c.lyra.told ??= t;
    }
    const ask = this.line(e.id, 'ask', { about, listener: tgt.id });
    let back = null;
    const said = ans.info.heading || ans.info.place;
    if ((ans.info.kind === 'seen' || ans.info.kind === 'heard' || ans.info.kind === 'guess') && said) {
      const looked = prob && (prob.checked.includes(said) || prob.place === said) && !(ans.info.t > (prob.checkedAt?.[said] ?? Infinity));
      back = this.line(e.id, looked ? 'already' : 'thanksPlace', { about, placeId: said });
    } else back = this.line(e.id, 'thanks', { about });
    const lines = [[e.id, ask], [tgt.id, ans.line]];
    if (back && this.rng()() < 0.8) lines.push([e.id, back]);
    const aboutName = this.name(about);
    const heardWhat = ans.info.kind === 'seen' ? `saw ${aboutName} ${ans.info.when}${ans.info.headingName ? `, heading for ${ans.info.headingName}` : ` at ${ans.info.placeName}`}${ans.info.withName ? `, with ${this.name(ans.info.with)}` : ''}` : ans.info.kind === 'heard' ? `heard ${aboutName} was at ${ans.info.placeName}` : ans.info.kind === 'guess' ? `guessed ${ans.info.placeName}` : `hasn't seen ${aboutName} since ${ans.info.when}`;
    const summary = `${this.name(e.id)} asked ${this.name(tgt.id)} about ${aboutName}: ${this.name(tgt.id)} ${heardWhat}.`;
    this.event('ask', summary, { who: e.id, about });
    if (prob) {
      if (!prob.asked.includes(tgt.id)) prob.asked.push(tgt.id);
      prob.heard.push({ ...ans.info, from: tgt.id, fromName: this.name(tgt.id), withName: ans.info.with ? this.name(ans.info.with) : null });
      if (prob.heard.length > 12) prob.heard.shift();
    }
    // What was said is now known: the asker can pass it on, the asked knows someone's missing.
    if (ans.info.kind === 'seen' || ans.info.kind === 'heard') this.learn(e.id, about, { ...ans.info, from: tgt.id, at: t });
    this.learnAsked(tgt.id, about, e.id, t);
    const c = this.cases.get(about);
    if (c) {
      if (c.status === 'noticed') c.status = 'asking';
      if (ans.info.kind === 'seen') this.cases.report(c, { by: tgt.id, kind: 'seen', place: ans.info.place, t: ans.info.t, with: ans.info.with, heading: ans.info.heading, at: t, public: true });
      this.cases.note(c, t, summary, 'ask');
      this.maybeRumor(c, [e.id, tgt.id]);
    }
    this.talk(e, tgt, lines, {
      topic: 'news',
      summary,
      step,
      after: () => {
        if (prob && prob.status === 'open') prob.due = this.now() + BEAT;
        if (tgt.id !== 'lyra') this.maybeJoin(tgt, about, e.id);
      },
    });
  }

  // The asked may act in turn: those who love the missing person worry, and look too.
  maybeJoin(tgt, about, askerId) {
    if (!about || !this.isHere(tgt) || this.openProblem(tgt.id) || this.steps.has(tgt.id)) return;
    if (this.problems.some((p) => p.owner === tgt.id && p.about === about && p.day === this.dayN() && p.status === 'given_up')) return;
    const c = this.cases.get(about);
    const care = this.care(tgt.id, about);
    // The watch hearing the second worried voice starts searching.
    if (WATCH.includes(tgt.id) && c && (c.noticers.length >= 2 || this.now() - c.openedAt > 1.5 * HOUR) && c.status !== 'search' && c.status !== 'missing') {
      this.cases.note(c, this.now(), `${this.name(askerId)} told ${this.name(tgt.id)}.`, 'alarm');
      return this.startSearch(about, searchLeader(this, about) || tgt.id, { by: tgt.id });
    }
    if (care < 0.6 || (c && (c.status === 'found' || c.status === 'dead'))) return;
    // Worry needs a reason: a good while since anyone has seen them.
    const own = this.sight.lastSeen(tgt.id, about);
    const age = c ? this.now() - c.openedAt : 0;
    if (age < 1.5 * HOUR && own && this.now() - own.t < 4 * HOUR) return;
    const prob = this.newProblemFor(tgt, { kind: 'worried', about, purpose: `find out where ${this.name(about)} is`, place: this.placeOf(tgt), care });
    prob.thought = this.thought(tgt.id, 'worried', { about });
  }

  learn(who, about, info, now = this.now()) {
    if (!who || !about || who === about) return;
    const row = (this.know[who] ||= {});
    const cur = row[about];
    if (!cur || (info.t ?? 0) >= (cur.t ?? 0)) row[about] = { t: info.t ?? now, place: info.place || null, from: info.from || null, kind: info.kind, with: info.with || null, heading: info.heading || null, at: now };
  }

  learnAsked(who, about, askerId, t) {
    const row = (this.know[who] ||= {});
    const k = (row[`asked:${about}`] ||= { by: [], t });
    if (!k.by.includes(askerId)) k.by.push(askerId);
    const c = this.cases.get(about);
    if (c && !c.noticers.includes(who) && this.care(who, about) >= 0.6) c.noticers.push(who);
  }

  knowsMissing(who, about) {
    const c = this.cases.get(about);
    if (!c || (c.status !== 'missing' && c.status !== 'dead')) return false;
    const r = c.rumor ? safe(() => this.village?.rumors?.get?.(c.rumor)) : null;
    return !r || r.heardBy.includes(who);
  }

  // A villager asks the player (they may answer in the dialog; or they may lie).
  askThePlayer(e, step, player, t) {
    const prob = this.problemById(step.prob);
    const about = step.about;
    if (!step.asked) {
      step.asked = t;
      const l = this.line(e.id, 'askPlayer', { about, listener: 'player' });
      safe(() => e.faceToward?.(player.x, player.y));
      if (l) safe(() => e.say(l, { target: player }));
      this.pending.npc[e.id] = { about, t, rt: this.rt(), prob: prob?.id || null };
      this.event('ask', `${this.name(e.id)} asked you whether you'd seen ${this.name(about)}.`, { who: e.id, about });
      if (prob && !prob.asked.includes('player')) prob.asked.push('player');
      return;
    }
    // A little while for an answer, then on with the day.
    const answered = this.pending.npc[e.id]?.answered;
    if (answered || t - step.asked > 12) {
      this.endStep(e);
      if (prob && prob.status === 'open') prob.due = t + BEAT;
    }
  }

  alarmExchange(e, leader, step, prob, t) {
    const about = step.about;
    const c = this.cases.get(about);
    const last = c ? this.cases.lastKnown(c) : null;
    const when = last ? sincePhrase(last.t, t) : prob ? sincePhrase(prob.since, t) : 'this morning';
    const lines = [[e.id, this.line(e.id, 'alarm', { about, listener: leader.id, when })]];
    this.event('alarm', `${this.name(e.id)} told ${this.name(leader.id)} that nobody has seen ${this.name(about)} since ${when}.`, { who: e.id, about });
    this.talk(e, leader, lines, {
      topic: 'news',
      summary: `${this.name(e.id)} told ${this.name(leader.id)} that ${this.name(about)} is missing.`,
      step,
      after: () => {
        this.startSearch(about, leader.id, { by: e.id });
        if (prob && prob.status === 'open') prob.due = this.now() + BEAT;
      },
    });
  }

  // ------------------------------------------------------------------ found

  onSeen(seer, target) {
    if (!this.looking.has(target)) return;
    if (seer === 'player') return;
    // Still on the way there (an unwatched villager is set down at once; the story is not).
    const st = this.steps.get(seer);
    if (st && this.now() < st.readyAt) return;
    const prob = this.openProblem(seer);
    if (prob && prob.about === target) {
      const e = this.entity(seer);
      if (e && !this.steps.get(seer)?.kind?.startsWith('meet')) this.problemFound(prob, e, this.entity(target));
      return;
    }
    const c = this.cases.get(target);
    if (!c || c.status === 'found' || c.status === 'dead' || !this.serious(c)) return;
    if (this.seerKnows(c, seer)) this.found(target, seer);
  }

  seerKnows(c, seer) {
    if (c.noticers.includes(seer) || c.leader === seer || (c.searchers && seer in c.searchers)) return true;
    if (seer === 'lyra') return c.lyra.knew != null;
    const r = c.rumor ? safe(() => this.village?.rumors?.get?.(c.rumor)) : null;
    if (r?.heardBy?.includes(seer)) return true;
    return !!this.know[seer]?.[`asked:${c.about}`];
  }

  // Has the village made a matter of it (more than one person stepping out for an hour)?
  serious(c) {
    if (!c) return false;
    if (c.status === 'search' || c.status === 'missing') return true;
    return !!c.rumor;
  }

  // The one with the problem sees the person they were looking for.
  problemFound(prob, e, x) {
    if (!x || !this.isHere(x)) return;
    const c = this.cases.get(x.id);
    const open = c && c.status !== 'found' && c.status !== 'dead';
    if (open && this.serious(c)) return this.found(x.id, e.id);
    // Not a village matter (or already found): they walk over and get on with it.
    this.closeProblem(prob, 'resolved', `found ${this.name(x.id)}`);
    if (open && !this.problems.some((p) => p.status === 'open' && p.about === x.id)) this.closeCase(c, 'found', e.id, this.placeOf(x));
    this.meet(e, x, prob);
  }

  meet(e, x, prob) {
    if (!this.free(e)) return;
    const inst = prob?.errand ? this.book.get(prob.errand) : null;
    this.makeStep(e, 'meet', { target: x.id, about: x.id, errand: inst?.id || null, doing: `going over to ${this.name(x.id)}` });
  }

  meetExchange(e, x, step, t) {
    const inst = step.errand ? this.book.get(step.errand) : null;
    const xs = this.steps.get(x.id);
    const xInst = xs?.errand ? this.book.get(xs.errand) : null;
    const kase = this.cases.get(x.id);
    const found = this.line(e.id, kase?.foundRumor ? 'found' : 'met', { about: x.id, listener: x.id });
    const reply = xInst ? this.line(x.id, 'foundBusy', { about: e.id, listener: e.id, doing: xInst.label }) : this.line(x.id, 'foundReply', { about: e.id, listener: e.id, placeId: this.placeOf(x) || 'hearthvale' });
    const lines = [[e.id, found], [x.id, reply]];
    if (inst && (inst.state === 'planned' || inst.state === 'active') && inStock(this.stock, inst)) {
      const tpl = errandTemplate(inst.tpl) || {};
      const talks = tpl.talks?.[0];
      if (talks) for (const [sp, text] of talks.slice(0, 2)) lines.push([sp === inst.who ? e.id : x.id, fillLine(text, sp, { P: this.playerName() })]);
      inst.state = 'active';
      this.talk(e, x, lines, { topic: 'news', summary: `${this.name(e.id)} found ${this.name(x.id)} elsewhere. ${describeErrand(this, inst)}`, step, after: () => this.completeErrand(e, inst) });
      return;
    }
    this.talk(e, x, lines, { topic: 'news', summary: `${this.name(e.id)} found ${this.name(x.id)}.`, step });
  }

  // The village finds someone it was looking for.
  found(about, by) {
    const c = this.cases.get(about);
    const x = this.entity(about);
    const e = this.entity(by);
    if (!c || c.status === 'found' || c.status === 'dead' || !x || !this.isHere(x)) return;
    const t = this.now();
    const place = this.placeOf(x);
    const wasMissing = c.status === 'missing' || c.status === 'search';
    const serious = this.serious(c);
    this.closeCase(c, 'found', by, place);
    this.cases.note(c, t, `${this.name(by)} found ${this.name(about)} ${placeAt(place, this.placeName(place))}.`, 'found');
    this.event('found', `${this.name(by)} found ${this.name(about)} ${placeAt(place, this.placeName(place))}.`, { who: by, about });
    // Away no more: home, and the day goes on.
    if (this.absences.isAway(about)) this.markBack(about, { stay: true });
    if (serious) {
      const r = safe(() => this.village?.addRumor?.('found_safe', { victim: about, witnesses: [by], source: by, about: 'village' }));
      if (r) c.foundRumor = r.id;
    }
    for (const p of this.problems) if (p.status === 'open' && p.about === about && (p.owner === by || dist(this.entity(p.owner), x) < 150)) this.closeProblem(p, 'resolved', `${this.name(by)} found ${this.name(about)}`);
    this.standDown(c);
    if (e && this.free(e) && e !== this.game?.player) this.meet(e, x, this.problems.find((p) => p.owner === by && p.about === about) || null);
    if (wasMissing || (serious && c.noticers.length >= 2)) this.toast(`${this.name(about)} has turned up safe.`, 'good', `found:${about}`);
    this.emit('person_found', { id: about, by, place });
  }

  closeCase(c, status, by, place) {
    c.status = status;
    c.foundAt = this.now();
    c.foundBy = by;
    c.foundPlace = place;
    c.closedAt = this.now();
  }

  standDown(c) {
    for (const id of Object.keys(c.searchers || {})) {
      const e = this.entity(id);
      const s = this.steps.get(id);
      if (e && s && (s.kind === 'search' || s.party)) this.endStep(e);
    }
    c.searchers = {};
  }

  // Anyone whose problem was about someone now found, and who has heard so, lets it go.
  settleFound(c) {
    const r = c.foundRumor ? safe(() => this.village?.rumors?.get?.(c.foundRumor)) : null;
    for (const p of this.problems) {
      if (p.status !== 'open' || p.about !== c.about) continue;
      if (r?.heardBy?.includes(p.owner) || this.now() - c.foundAt > HOUR * 2) {
        this.closeProblem(p, 'resolved', `heard ${this.name(c.about)} turned up`);
        const e = this.entity(p.owner);
        if (e && c.foundRumor) this.sayAloud(e, this.line(p.owner, 'relief', { about: c.about }));
      }
    }
    if (this.mourning) for (const [id, m] of Object.entries(this.mourning)) if (m.about === c.about && m.kind === 'worry') delete this.mourning[id];
  }

  // ------------------------------------------------------------------ cases and the watch

  notice(about, by, place, t) {
    const c = this.cases.open(about, { by, t, day: this.dayN(), place });
    // They were there and looked: no need to send a search party to the same door.
    if (place) c.searched[place] ||= { by, t: Math.round(t) };
    if (c.timeline.length === 0) this.cases.note(c, t, `${this.name(by)} noticed ${this.name(about)} wasn't ${placeAt(place, this.placeName(place))}.`, 'notice');
    else if (!c.timeline.some((x) => x.text.startsWith(`${this.name(by)} `))) this.cases.note(c, t, `${this.name(by)} is looking for ${this.name(about)} too.`, 'notice');
    if (c.noticers.length >= 2 && c.status === 'noticed') c.status = 'asking';
    return c;
  }

  // People asking after someone becomes village talk once it is more than a passing absence.
  maybeRumor(c, heardBy) {
    if (c.rumor || this.now() - c.openedAt < 1.2 * HOUR || (c.noticers.length < 2 && this.now() - c.openedAt < 2.5 * HOUR)) return;
    if (this.steps.get(c.about)?.party) return; // out with a search party: half the village has seen them
    const r = safe(() => this.village?.addRumor?.('asking_after', { victim: c.about, witnesses: heardBy, source: heardBy[0], about: 'village' }));
    if (r) c.rumor = r.id;
  }

  startSearch(about, leaderId, { by = null } = {}) {
    const t = this.now();
    const c = this.cases.open(about, { by, t, day: this.dayN(), place: null });
    if (c.status === 'found' || c.status === 'dead') return c;
    const leader = leaderId || searchLeader(this, about);
    const fresh = c.status !== 'search' && c.status !== 'missing';
    if (fresh || !c.leader) {
      if (c.status !== 'missing') c.status = 'search';
      c.alarmAt = t;
      c.alarmBy = by;
      c.leader = leader;
      this.cases.note(c, t, by && by !== leader ? `${this.name(by)} told ${this.name(leader)}. The watch is searching for ${this.name(about)}.` : `${this.name(leader)} started a search for ${this.name(about)}.`, 'search');
      this.event('search', `The watch is searching for ${this.name(about)}.`, { who: leader, about });
      this.toast(`The watch is searching for ${this.name(about)}.`, 'warn', `search:${about}`);
    }
    c.searchDay = this.dayN();
    const searchers = chooseSearchers(this, c, leader);
    const places = searchPlaces(this, c);
    const assigned = [];
    for (const id of searchers) {
      const e = this.entity(id);
      if (!e || !this.available(e)) continue;
      const p = this.openProblem(id);
      if (p && p.about === about) this.closeProblem(p, 'resolved', 'joined the search');
      else if (p) continue;
      const taken = new Set(Object.values(c.searchers || {}));
      const place = places.find((x) => !taken.has(x));
      if (!place) break;
      c.searchers[id] = place;
      const was = this.steps.get(id);
      if (was) this.abortStep(e, was, 'joined the search');
      this.makeStep(e, 'search', { place, about, party: true, doing: `searching ${placePhrase(place)} for ${this.name(about)}` });
      assigned.push([id, place]);
    }
    if (!c.rumor) {
      const r = safe(() => this.village?.addRumor?.('asking_after', { victim: about, witnesses: [leader, by, ...searchers].filter(Boolean), source: leader, about: 'village' }));
      if (r) c.rumor = r.id;
    }
    if (assigned.length) {
      const L = this.entity(leader);
      const start = this.line(leader, 'watchStart', { about });
      const who = assigned
        .filter(([id]) => id !== leader)
        .slice(0, 2)
        .map(([id, place]) => {
          const list = linesFor(leader, 'watchAssign') || ['{a}: {place}.'];
          return fillLine(list[Math.floor(this.rng()() * list.length)], leader, { a: callName(leader, id) || this.name(id), place: placePhrase(place, this.placeName(place)) });
        })
        .filter(Boolean)
        .join(' ');
      if (L) this.sayAloud(L, [start, who].filter(Boolean).join(' '));
      this.cases.note(c, t, `Search parties: ${assigned.map(([id, place]) => `${this.name(id)} to ${placePhrase(place, this.placeName(place))}`).join(', ')}.`, 'search');
    }
    this.emit('search_started', { about, leader, searchers: assigned.map(([id]) => id) });
    return c;
  }

  nextSearch(e, c, t) {
    if (c.status === 'found' || c.status === 'dead') return;
    const h = this.hour();
    if (h >= 22 || h < 6) return; // the watch stands down for the night
    const taken = new Set(Object.values(c.searchers || {}));
    const place = searchPlaces(this, c).find((x) => !taken.has(x));
    if (!place || !this.available(e)) return;
    c.searchers[e.id] = place;
    this.makeStep(e, 'search', { place, about: c.about, party: true, doing: `searching ${placePhrase(place)} for ${this.name(c.about)}` });
  }

  tickCases(t, hour) {
    for (const c of this.cases.all()) {
      if (c.status === 'found') {
        if (!c.settled || t - c.settled > 5) {
          c.settled = t;
          this.settleFound(c);
        }
        continue;
      }
      if (c.status === 'dead') continue;
      // A passing absence nobody is still worried about fades: they were about all along.
      if (!this.serious(c) && !this.problems.some((p) => p.status === 'open' && p.about === c.about) && t - c.openedAt > 0.5 * HOUR) {
        const x = this.entity(c.about);
        const seenSince = this.sight.sightingsOf(c.about, { since: c.openedAt + 1 }).some((s) => s.by !== 'player');
        if (this.isHere(x) && (seenSince || t - c.openedAt > 3 * HOUR)) {
          this.closeCase(c, 'found', null, null);
          continue;
        }
      }
      // Nightfall: the village has been asking all day, and nobody has found them.
      const nightfall = hour >= 20.5 || hour < 5;
      if (nightfall && c.status !== 'missing' && this.serious(c) && t - c.openedAt >= 2.5 * HOUR) this.declareMissing(c, t);
      // The watch searches again in daylight, while there is anywhere left to look.
      if ((c.status === 'missing' || c.status === 'search') && hour >= 7 && hour < 19 && c.searchDay !== this.dayN()) {
        const leader = searchLeader(this, c.about);
        if (leader && this.free(this.entity(leader))) this.startSearch(c.about, leader, { by: null });
      }
    }
  }

  declareMissing(c, t) {
    if (c.status === 'missing') return;
    c.status = 'missing';
    c.declaredAt = t;
    c.declaredDay = this.dayN();
    const name = this.name(c.about);
    this.cases.note(c, t, `Nightfall, and no sign of ${name}. ${cap(pronoun(c.about, 'he'))} is missing.`, 'missing');
    this.event('missing', `${name} is missing. Nobody knows why.`, { about: c.about });
    // Village knowledge: the watch goes door to door.
    const everyone = [...this.villagers().filter((e) => e.id !== c.about && this.isHere(e)).map((e) => e.id), 'lyra'];
    const r = safe(() => this.village?.addRumor?.('missing', { victim: c.about, witnesses: everyone, source: c.leader || 'rowan', about: 'village' }));
    if (r) c.rumor = r.id;
    for (const id of everyone) if (id !== 'lyra' && this.care(id, c.about) >= 0.6) this.mourning[id] = { about: c.about, until: this.dayN() + 4, kind: 'worry' };
    this.toast(`Word goes round Hearthvale: ${name} is missing.`, 'warn', `missing:${c.about}`);
    this.emit('missing_declared', { id: c.about, day: this.dayN() });
  }

  // ------------------------------------------------------------------ Lyra

  tickLyra(t) {
    const lyra = this.game?.companion;
    const mind = lyra?.mind;
    for (const c of this.cases.active()) {
      if (c.status === 'noticed') continue;
      const r = c.rumor ? safe(() => this.village?.rumors?.get?.(c.rumor)) : null;
      const knows = c.lyra.knew != null || c.lyra.told != null || !!r?.heardBy?.includes('lyra');
      if (!knows) continue;
      if (c.lyra.knew == null) this.lyraLearns(c, t);
      if (c.lyra.asked == null && mind && t - c.lyra.knew > 6) this.lyraAsks(c, t);
    }
    // Missing turned to grief, or found: she hears when the village does.
    for (const c of this.cases.all()) {
      if (c.status === 'dead' && c.lyra.knew != null && !c.lyra.grieved) {
        const r = c.deadRumor ? safe(() => this.village?.rumors?.get?.(c.deadRumor)) : null;
        if (r?.heardBy?.includes('lyra')) {
          c.lyra.grieved = t;
          const care = this.lyraCare(c.about);
          safe(() => mind?.remember?.(`${this.name(c.about)} was found dead. ${cap(pronoun(c.about, 'he'))} had been missing since ${whenPhrase(c.openedAt, t)}.`, { importance: 6 + Math.round(care * 3), about: [c.about], tags: ['missing', 'death'], type: 'event', emotion: 'sadness' }));
          safe(() => mind?.feel?.('sadness', 0.25 + care * 0.5, `${this.name(c.about)} is dead`));
        }
      }
    }
    // An accusation she held back until the player was near.
    const held = this.claims.find((c) => c.to === 'lyra' && c.found && !c.found.said);
    if (held && lyra && this.lyraCanSpeak(lyra)) this.lyraAccuses(held);
  }

  lyraCare(about) {
    const r = safe(() => this.game?.companion?.mind?.relationships?.get?.(about));
    const aff = r?.affinity ?? this.bond('lyra', about)?.affinity ?? 20;
    const fam = ['hobb', 'wenna', 'sabeth'].includes(about);
    return fam ? 1 : Math.max(0.2, Math.min(1, (aff + 20) / 100));
  }

  lyraLearns(c, t) {
    c.lyra.knew = t;
    const mind = this.game?.companion?.mind;
    if (!mind) return;
    const name = this.name(c.about);
    const last = this.cases.lastKnown(c);
    const since = last ? sincePhrase(last.t, t) : sincePhrase(c.openedAt, t);
    const care = this.lyraCare(c.about);
    safe(() => mind.learn?.(name, `Nobody has seen ${name} since ${since}; people are looking for ${pronoun(c.about, 'him')}.`, { kind: 'rumor', source: 'told', confidence: 0.6, about: [c.about] }));
    safe(() => mind.remember?.(`Nobody has seen ${name} since ${since}. People are asking after ${pronoun(c.about, 'him')}.`, { importance: 3 + Math.round(care * 4), about: [c.about], tags: ['missing'], type: 'event' }));
    safe(() => mind.feel?.(care >= 0.6 ? 'fear' : 'surprise', 0.15 + care * 0.35, `${name} is missing`));
    this.event('lyra', `Lyra heard that nobody can find ${name}.`, { who: 'lyra', about: c.about });
  }

  lyraCanSpeak(lyra) {
    const g = this.game;
    const p = g?.player;
    if (!lyra || !p || !this.isHere(lyra) || lyra.downed || !this.isHere(p)) return false;
    if (g.state && g.state !== 'playing') return false;
    const st = safe(() => lyra.mind?.companionship, 'together');
    if (st === 'left' || st === 'gone') return false;
    if (dist(lyra, p) > 120) return false;
    if (safe(() => lyra.mind?.isSpeaking?.(), false)) return false;
    if (safe(() => this.village?.isTalking?.(lyra), false)) return false;
    return lyra.state !== 'sleep';
  }

  lyraAsks(c, t) {
    const lyra = this.game?.companion;
    if (!this.lyraCanSpeak(lyra)) return;
    c.lyra.asked = t;
    const last = this.cases.lastKnown(c);
    const when = last ? sincePhrase(last.t, t) : sincePhrase(c.openedAt, t);
    const text = this.line('lyra', c.status === 'missing' ? 'askPlayerMissing' : 'askPlayer', { about: c.about, when, listener: 'player' });
    if (!text) return;
    safe(() => lyra.mind.say(text, { chat: true, target: this.game.player }));
    safe(() => lyra.mind.addConversation?.('lyra', text));
    this.pending.lyra = { about: c.about, t, rt: this.rt(), text };
    this.event('lyra', `Lyra asked you whether you'd seen ${this.name(c.about)}.`, { who: 'lyra', about: c.about });
  }

  // ------------------------------------------------------------------ the player's word

  onPlayerMessage(text) {
    const q = this.pending.lyra;
    if (!q || q.answered || this.rt() - q.rt > 180) return;
    const claim = parseClaim(String(text || ''), q.about, this);
    if (claim.kind === 'unrelated') return;
    q.answered = this.recordClaim({ to: 'lyra', about: q.about, ...claim, text: String(text).slice(0, 140) });
    q.answeredRt = this.rt();
  }

  recordClaim({ to, about, kind, place = null, text = '' }) {
    const t = this.now();
    const claim = { id: `c${this.claims.length + 1}`, by: 'player', to, about, kind, place, text, t, day: this.dayN(), lie: false, found: null };
    claim.lie = this.claimIsLie(claim);
    this.claims.push(claim);
    if (this.claims.length > 40) this.claims.shift();
    const c = this.cases.get(about);
    const who = to === 'lyra' ? 'Lyra' : this.name(to);
    const said = kind === 'not_seen' ? `hadn't seen ${this.name(about)}` : kind === 'seen_at' ? `saw ${this.name(about)} ${placeAt(place, this.placeName(place))}` : kind === 'seen' ? `had seen ${this.name(about)}` : `didn't know where ${this.name(about)} was`;
    this.event('claim', `You told ${who} you ${said}.`, { who: to, about });
    if (c) {
      this.cases.note(c, t, `${this.playerName()} told ${who} they ${said}.`, 'claim');
      if (kind === 'seen_at' && place) this.cases.report(c, { by: 'player', kind: 'player', place, t, at: t, public: true, via: to });
    }
    // Lyra remembers what she was told.
    if (to === 'lyra') safe(() => this.game?.companion?.mind?.remember?.(`I asked ${this.playerName()} if they had seen ${this.name(about)}. They said ${kind === 'not_seen' ? 'no' : kind === 'seen_at' ? `they saw ${pronoun(about, 'him')} ${placeAt(place, this.placeName(place))}` : kind === 'seen' ? 'yes' : "they didn't know"}.`, { importance: 4, about: ['player', about], tags: ['missing', 'asked_player'], type: 'event' }));
    else {
      const e = this.entity(to);
      if (e && kind === 'seen_at' && place) this.learn(to, about, { t, place, from: 'player', kind: 'heard' }, t);
    }
    return claim;
  }

  // Did the player say something they knew to be untrue? (The game knows; nobody else does yet.)
  claimIsLie(claim) {
    const s = this.sight.lastSeen('player', claim.about);
    const seen = !!s && claim.t - s.t < 18 * HOUR;
    if (claim.kind === 'not_seen') return seen;
    if (claim.kind === 'seen') return !seen;
    if (claim.kind === 'seen_at') {
      if (!seen) return true;
      const abs = this.absences.get(claim.about);
      return s.place !== claim.place && abs?.place !== claim.place;
    }
    return seen && s.with === 'player';
  }

  // Evidence the one who was told now has that the player lied.
  evidenceAgainst(claim) {
    const about = claim.about;
    const who = claim.to;
    const window = (t) => Number.isFinite(t) && Math.abs(claim.t - t) < 18 * HOUR && t <= claim.t + 2 * HOUR;
    const own = this.sight.lastSeen(who, about);
    if (own && own.with === 'player' && window(own.t)) return { from: who, place: own.place, t: own.t };
    const ownP = this.sight.lastSeen(who, 'player');
    if (ownP && ownP.with === about && window(ownP.t)) return { from: who, place: ownP.place, t: ownP.t };
    const c = this.cases.get(about);
    const knowsCase = who === 'lyra' ? c?.lyra?.knew != null : !!c && this.seerKnows(c, who);
    if (!c || !knowsCase) return null;
    for (const r of c.reports) if (r.public && r.with === 'player' && window(r.t)) return { from: r.by, place: r.place, t: r.t };
    if (claim.kind === 'seen_at') {
      const there = c.searched?.[claim.place];
      const elsewhere = c.reports.find((r) => r.public && r.kind === 'seen' && r.place && r.place !== claim.place && r.t > claim.t - 2 * HOUR);
      if (there && elsewhere) return { from: elsewhere.by, place: elsewhere.place, t: elsewhere.t, elsewhere: true };
    }
    return null;
  }

  checkClaims() {
    for (const claim of this.claims) {
      if (!claim.lie || claim.found) continue;
      const ev = this.evidenceAgainst(claim);
      if (ev) this.lieFound(claim, ev);
    }
  }

  lieFound(claim, ev) {
    const t = this.now();
    claim.found = { t, by: ev.from, place: ev.place, seenT: ev.t, said: false, elsewhere: !!ev.elsewhere };
    const about = claim.about;
    const who = claim.to;
    const c = this.cases.get(about);
    if (c) this.cases.note(c, t, `${who === 'lyra' ? 'Lyra' : this.name(who)} knows ${this.playerName()} lied about ${this.name(about)}.`, 'lie');
    this.event('lie', `${who === 'lyra' ? 'Lyra' : this.name(who)} found out you lied about ${this.name(about)}.`, { who, about });
    if (who === 'lyra') {
      const mind = this.game?.companion?.mind;
      const from = ev.from === 'lyra' ? 'I' : this.name(ev.from);
      const text = ev.elsewhere
        ? `${this.playerName()} told me they saw ${this.name(about)} ${placeAt(claim.place, this.placeName(claim.place))}. They didn't: ${from} saw ${pronoun(about, 'him')} ${placeAt(ev.place, this.placeName(ev.place))}. ${this.playerName()} lied to me.`
        : `${this.playerName()} told me they hadn't seen ${this.name(about)}. But ${from} saw them together ${placeAt(ev.place, this.placeName(ev.place))}, ${whenPhrase(ev.t, t)}. ${this.playerName()} lied to me.`;
      safe(() => mind?.remember?.(text, { importance: 7, about: ['player', about], tags: ['lie', 'missing'], type: 'event', emotion: 'anger' }));
      safe(() => mind?.recordDeed?.('lied', { text: `Lied to me about ${this.name(about)}.`, victim: about }));
      safe(() => mind?.feel?.('anger', 0.3, `${this.playerName()} lied about ${this.name(about)}`));
      safe(() => mind?.addThought?.(this.line('lyra', 'lieFoundThought', { about }), 'self'));
      if (this.lyraCanSpeak(this.game?.companion)) this.lyraAccuses(claim);
    } else {
      const e = this.entity(who);
      safe(() => e?.adjustOpinion?.(-8, `lied about ${this.name(about)}`));
      safe(() => this.village?.addRumor?.('lied_about', { victim: about, witnesses: [who], source: who }));
    }
    this.emit('lie_found', { claim });
  }

  lyraAccuses(claim) {
    const lyra = this.game?.companion;
    const f = claim.found;
    if (!f || f.said) return;
    f.said = true;
    const from = f.by === 'lyra' ? 'I' : this.nameFor('lyra', f.by);
    const text = f.elsewhere
      ? fillLine(`You told me you saw {who} ${placeAt(claim.place, this.placeName(claim.place))}. ${from} saw {him} ${placeAt(f.place, this.placeName(f.place))}. Why would you say that?`, 'lyra', { about: claim.about })
      : this.line('lyra', 'lieFound', { about: claim.about, from, placeId: f.place, when: whenPhrase(f.seenT, this.now()) });
    if (text) safe(() => lyra.mind.say(text, { chat: true, target: this.game.player }));
  }

  // ------------------------------------------------------------------ talking to the player

  // The player said something to a villager: "what's wrong?", "have you seen X?", "where are
  // you off to?", or an answer to their own question. -> { lines, mood, intent } | null
  answerPlayer(npc, u, text) {
    const t = String(text || '');
    const id = npc?.id;
    if (!id) return null;
    const P = this.playerName();
    // An answer to the question they just asked the player.
    const q = this.pending.npc[id];
    if (q && !q.answered && this.rt() - q.rt < 90) {
      const claim = parseClaim(t, q.about, this);
      if (claim.kind !== 'unrelated') {
        q.answered = this.recordClaim({ to: id, about: q.about, ...claim, text: t.slice(0, 140) });
        const key = claim.kind === 'seen_at' ? 'playerYes' : claim.kind === 'not_seen' ? 'playerNo' : 'playerUnsure';
        const line = this.line(id, key, { about: q.about, placeId: claim.place, listener: 'player' });
        const prob = q.prob ? this.problemById(q.prob) : null;
        if (prob && claim.kind === 'seen_at' && claim.place) prob.heard.push({ kind: 'heard', from: 'player', fromName: P, place: claim.place, placeName: this.placeName(claim.place), t: this.now(), when: 'just now' });
        return { lines: [line || 'Thank you.'], mood: claim.kind === 'not_seen' ? 'worried' : 'neutral', intent: 'life_answer' };
      }
    }
    // "Have you seen Garrick?" — from their own eyes.
    const person = u?.person && VILLAGERS.includes(u.person) ? u.person : null;
    if (person && person !== id && RE_SEEN.test(t)) {
      const ans = this.answerFor(id, person, 'player');
      const lines = [ans.line];
      const c = this.cases.get(person);
      if (c && (c.status === 'search' || c.status === 'missing') && this.seerKnows(c, id)) {
        const extra = this.line(id, c.status === 'missing' ? 'missing' : 'worry', { about: person });
        if (extra) lines.push(extra);
      }
      if (c && ans.info.kind === 'seen') this.cases.report(c, { by: id, kind: 'seen', place: ans.info.place, t: ans.info.t, with: ans.info.with, heading: ans.info.heading, at: this.now(), public: true });
      return { lines, mood: c ? 'worried' : 'neutral', intent: 'life_seen' };
    }
    // "What's wrong?"
    if (RE_WRONG.test(t)) {
      const s = this.situation(id);
      if (s) return { lines: [s], mood: 'worried', intent: 'life_wrong' };
    }
    // "Where are you off to?"
    if (RE_WHERE_GOING.test(t)) {
      const step = this.steps.get(id);
      const inst = step?.errand ? this.book.get(step.errand) : null;
      if (inst) {
        const tpl = errandTemplate(inst.tpl);
        const why = tpl?.why?.length ? fillLine(tpl.why[Math.floor(this.rng()() * tpl.why.length)], id, { P }) : null;
        return { lines: [why || `I'm ${inst.label}.`], mood: 'neutral', intent: 'life_errand' };
      }
      if (step?.doing) return { lines: [`I'm ${step.doing}.`], mood: 'worried', intent: 'life_errand' };
    }
    return null;
  }

  // Dialog buttons for their day (phones have no keyboard to type "what's wrong?").
  dialogOptions(npc) {
    const id = npc?.id;
    if (!id || npc.state === 'sleep') return [];
    const out = [];
    const q = this.pending.npc[id];
    if (q && !q.answered && this.rt() - q.rt < 90) {
      const him = pronoun(q.about, 'him');
      out.push({ id: 'life:answer:no', label: `No, I haven't seen ${him}.` }, { id: 'life:answer:yes', label: `Yes, I saw ${him} earlier.` }, { id: 'life:answer:unsure', label: "I don't know." });
      return out;
    }
    if (this.situation(id)) out.push({ id: 'life:wrong', label: "What's wrong?" });
    const step = this.steps.get(id);
    if (step?.errand && step.kind === 'errand') out.push({ id: 'life:errand', label: 'Where are you off to?' });
    const c = this.cases.active().find((x) => x.about !== id && this.serious(x) && this.seerKnows(x, id));
    if (c) out.push({ id: `life:seen:${c.about}`, label: `Have you seen ${this.name(c.about)}?` });
    return out.slice(0, 2);
  }

  dialogOption(npc, key) {
    const id = npc?.id;
    if (!id) return null;
    if (key.startsWith('life:answer:')) {
      const q = this.pending.npc[id];
      if (!q) return null;
      const text = { no: "No, I haven't seen him.", yes: 'Yes, I saw him earlier.', unsure: "I don't know." }[key.slice(12)] || '';
      return this.answerPlayer(npc, null, text);
    }
    if (key === 'life:wrong') {
      const s = this.situation(id);
      return s ? { lines: [s] } : null;
    }
    if (key === 'life:errand') return this.answerPlayer(npc, null, 'Where are you off to?');
    if (key.startsWith('life:seen:')) {
      const about = key.slice(10);
      if (!VILLAGERS.includes(about)) return null;
      return this.answerPlayer(npc, { person: about }, `Have you seen ${this.name(about)}?`);
    }
    return null;
  }

  // Their real situation, said in their own voice ("what's wrong?").
  situation(id) {
    const prob = this.openProblem(id);
    const now = this.now();
    if (prob) {
      const about = prob.about;
      const last = about ? this.lastKnownTo(id, about) : null;
      const when = last ? sincePhrase(last.t, now) : sincePhrase(prob.since, now);
      const vars = { about, when, shop: prob.shop, goods: prob.goods, purpose: prob.purpose, placeId: prob.place };
      let problem;
      if (prob.kind === 'shut') problem = fillLine(`I came for {goods}, and {shop} is shut. Nobody's seen {who} since {when}.`, id, vars);
      else if (prob.kind === 'item') problem = fillLine(`{who}'s got no {goods} left, and I needed it.`, id, vars);
      else if (prob.kind === 'blocked') problem = fillLine(`There's something {at}. I'm not going in there alone.`, id, { ...vars, at: placeAt(prob.place, this.placeName(prob.place)) });
      else if (prob.kind === 'worried') problem = fillLine(`Nobody's seen {who} since {when}.`, id, vars);
      else if (prob.errand) problem = fillLine(`I came to ${prob.purpose.replace(/^(\w)/, (m) => m)} and {who}'s not here. Nobody's seen {him} since {when}.`, id, vars);
      else problem = fillLine(`{who} should be here by now. {He}'s not. Nobody's seen {him} since {when}.`, id, vars);
      return this.line(id, 'wrong', { about, problem }) || problem;
    }
    const m = this.mourning[id];
    if (m) {
      const c = this.cases.get(m.about);
      if (c?.status === 'dead') return this.line(id, 'grief', { about: m.about });
      if (c?.status === 'missing') return this.line(id, 'missing', { about: m.about });
      return this.line(id, 'worry', { about: m.about });
    }
    for (const c of this.cases.active()) if (c.status !== 'noticed' && c.about !== id && this.seerKnows(c, id)) return this.line(id, c.status === 'missing' ? 'missing' : 'worry', { about: c.about });
    return null;
  }

  lastKnownTo(id, about) {
    const own = this.sight.lastSeen(id, about);
    const k = this.know[id]?.[about];
    if (own && (!k || own.t >= k.t)) return own;
    return k || own || null;
  }

  // A worried line instead of small talk, while someone is missing or lost.
  ambientLine(npc) {
    const id = npc?.id;
    if (!id) return null;
    const r = this.rng()();
    // Minding someone else's work.
    const vl = String(npc.r?.entry?.vl || '');
    if (vl.startsWith('cover-') && r < 0.6) {
      const cov = COVER[vl.slice(6)];
      if (cov?.say?.length) return cov.say[Math.floor(this.rng()() * cov.say.length)];
    }
    const prob = this.openProblem(id);
    if (prob?.about && r < 0.6) return this.line(id, prob.kind === 'worried' ? 'worry' : 'absent', { about: prob.about, shop: prob.shop });
    const m = this.mourning[id];
    if (m && r < 0.5) {
      const c = this.cases.get(m.about);
      const days = c?.declaredDay ? this.dayN() - c.declaredDay : 0;
      if (c?.status === 'dead') return this.line(id, 'grief', { about: m.about });
      if (c?.status === 'missing') return this.line(id, days >= 2 ? 'missingLong' : 'missing', { about: m.about, days: days === 2 ? 'two' : days === 3 ? 'three' : String(days) });
      return this.line(id, 'worry', { about: m.about });
    }
    for (const c of this.cases.active()) {
      if (c.status !== 'missing' || c.about === id || r > 0.25) continue;
      if (this.seerKnows(c, id)) return this.line(id, 'missing', { about: c.about });
    }
    return null;
  }

  // ------------------------------------------------------------------ schedules adapt

  entryFor(npc, base, hour) {
    const id = npc?.id;
    if (!id) return null;
    const step = this.steps.get(id);
    if (step) return step.entry;
    if (base?.activity === 'sleep' || base?.activity === 'lamps') return null;
    // Minding the work of someone who is missing.
    for (const c of this.cases.all()) {
      if (c.status !== 'missing' && c.status !== 'dead') continue;
      const cov = COVER[c.about];
      if (!cov || cov.by !== id || hour < cov.hours[0] || hour >= cov.hours[1]) continue;
      if (base?.activity === 'eat') continue;
      return { activity: 'work', at: cov.at, vl: `cover-${c.about}`, doing: cov.doing };
    }
    // Those who love the missing or the dead keep the chapel's evening prayers.
    const m = this.mourning[id];
    if (m && hour >= 19.25 && hour < 20.25 && (base?.activity === 'socialize' || base?.activity === 'wander')) {
      return { activity: 'pray', at: 'chapel', vl: `pray-${m.about}`, doing: `praying for ${this.name(m.about)}` };
    }
    return null;
  }

  // ------------------------------------------------------------------ the absent

  markGone(id, { cause = 'vanished', seen = false, at = null, keepBody = false } = {}) {
    const e = this.entity(id);
    if (!e || !VILLAGERS.includes(id)) return null;
    const t = this.now();
    const place = (at && typeof at === 'object' && at.place) || (typeof at === 'string' ? at : null) || this.placeOf(e);
    const witnesses = Array.isArray(seen) ? seen.filter((w) => w !== id) : seen ? this.watchers(e) : [];
    const rec = this.absences.set(id, { mode: 'gone', cause, since: t, day: this.dayN(), place, at: { x: Math.round(e.x), y: Math.round(e.y) }, seen: witnesses, keepBody: !!keepBody, heading: at?.heading || null });
    for (const w of witnesses) this.sight.note(w, id, { t, x: e.x, y: e.y, place, heading: at?.heading || null });
    this.leaveRoutine(e);
    if (!keepBody) {
      e.hidden = true;
      e.solid = false;
    }
    e.absent = { cause, since: t };
    this.event('gone', `${this.name(id)} is gone (${cause}).`, { about: id, hidden: true });
    this.emit('villager_gone', { id, cause, seen: witnesses });
    return rec;
  }

  // Somewhere unexpected for a while (the test harness; a villager who wandered off).
  markAway(id, { place = 'stonecut_quarry', hours = 4, reason = 'away', witnesses = null } = {}) {
    const e = this.entity(id);
    if (!e || !VILLAGERS.includes(id)) return null;
    const t = this.now();
    const seen = Array.isArray(witnesses) ? witnesses : this.watchers(e);
    for (const w of seen) this.sight.note(w, id, { t, x: e.x, y: e.y, place: this.placeOf(e), heading: place });
    this.leaveRoutine(e);
    const rec = this.absences.set(id, { mode: 'away', cause: reason, since: t, day: this.dayN(), until: t + hours * HOUR, place, seen });
    this.makeStep(e, 'away', { place, doing: 'somewhere nobody expects' });
    this.event('gone', `${this.name(id)} has gone off to ${this.placeName(place)}.`, { about: id, hidden: true });
    return rec;
  }

  markBack(id, { stay = false } = {}) {
    const e = this.entity(id);
    const rec = this.absences.get(id);
    this.absences.delete(id);
    if (!e) return false;
    const wasGone = rec?.mode === 'gone' || e.absent;
    e.absent = null;
    if (wasGone && e.hidden) {
      e.hidden = false;
      e.solid = true;
      // Home, on their own two feet.
      const home = safe(() => e.locFor?.(e.profile?.home)) || safe(() => this.game?.locations?.get?.(e.profile?.home));
      const spot = home ? safe(() => e.floorSpot?.(home, 3)) || home.center : null;
      if (spot) {
        e.x = spot.x;
        e.y = spot.y;
      }
    }
    const s = this.steps.get(id);
    if (s && s.kind === 'away') this.endStep(e);
    if (e.r) e.r.key = null;
    if (!stay) this.event('back', `${this.name(id)} is back.`, { about: id, hidden: true });
    return true;
  }

  returnAway(t) {
    for (const [id, a] of this.absences.entries()) if (a.mode === 'away' && Number.isFinite(a.until) && t >= a.until) this.markBack(id);
  }

  // Out of every routine: their own errands, problems and steps end where they stand.
  leaveRoutine(e) {
    const id = e.id;
    this.steps.delete(id);
    for (const p of this.problems) if (p.owner === id && p.status === 'open') this.closeProblem(p, 'given_up', 'gone');
    for (const inst of this.book.forWho(id)) if (inst.state === 'planned' || inst.state === 'active') {
      inst.state = 'skipped';
      inst.result = 'not there to do it';
    }
    safe(() => e.walker?.stop?.());
    safe(() => e.wake?.());
    if (safe(() => this.village?.isTalking?.(e), false)) safe(() => this.village.stopPlaying());
    if (e.r) e.r.key = null;
  }

  // Who can see someone right now.
  watchers(e) {
    const out = [];
    for (const id of [...VILLAGERS, 'lyra', 'player']) {
      if (id === e.id) continue;
      const w = this.entity(id);
      if (w && this.isHere(w) && w.state !== 'sleep' && this.sight.canSee(w, e)) out.push(id);
    }
    return out;
  }

  // ------------------------------------------------------------------ bodies (DESIGN §29)

  bodySeen(seer, deadId, place) {
    if (!VILLAGERS.includes(deadId) || seer === 'player') return;
    const c = this.cases.get(deadId);
    if (c?.status === 'dead') return;
    this.onBodyFound(deadId, seer, place);
  }

  onBodyFound(id, finder = null, place = null) {
    const t = this.now();
    const c = this.cases.open(id, { by: finder, t, day: this.dayN(), place });
    if (c.status === 'dead') return c;
    c.status = 'dead';
    c.deadAt = t;
    c.foundBy = finder;
    c.foundPlace = place;
    c.closedAt = t;
    const name = this.name(id);
    this.cases.note(c, t, `${finder ? this.name(finder) : 'Someone'} found ${name}'s body${place ? ` ${placeAt(place, this.placeName(place))}` : ''}.`, 'dead');
    this.event('dead', `${name} was found dead${place ? ` ${placeAt(place, this.placeName(place))}` : ''}.`, { who: finder, about: id });
    const r = safe(() => this.village?.addRumor?.('found_dead', { victim: id, witnesses: finder ? [finder] : [], source: finder || 'village', about: 'village' }));
    if (r) c.deadRumor = r.id;
    for (const p of this.problems) if (p.status === 'open' && p.about === id) this.closeProblem(p, 'given_up', `${name} is dead`);
    this.standDown(c);
    for (const e of this.villagers()) if (e.id !== id && this.care(e.id, id) >= 0.6) this.mourning[e.id] = { about: id, until: this.dayN() + 7, kind: 'grief' };
    this.toast(`${name} has been found dead.`, 'warn', `dead:${id}`);
    this.emit('body_found', { id, finder, place, case: c });
    return c;
  }

  // ------------------------------------------------------------------ the player's trade

  onTrade(p) {
    const id = p?.npc?.id || p?.npc;
    if (!id || !p.itemId || !p.bought) return;
    const s = this.stock[id];
    if (s && p.itemId in s) s[p.itemId] = Math.max(0, s[p.itemId] - (p.qty || 1));
  }

  // ------------------------------------------------------------------ icons

  icons() {
    const rt = this.rt();
    for (const p of this.problems) {
      if (p.status !== 'open') continue;
      const e = this.entity(p.owner);
      if (!e || !this.visible(e)) continue;
      if (rt - (this.iconAt.get(p.owner) ?? -Infinity) < 3.2) continue;
      if (safe(() => this.village?.isTalking?.(e), false)) continue;
      this.iconAt.set(p.owner, rt);
      safe(() => this.game?.bubbles?.icon?.(e, p.awaiting ? '...' : '?', { duration: 2.8 }));
    }
  }

  // ------------------------------------------------------------------ Lyra's mind (plugin)

  installPlugin() {
    const reg = this.game?.plugins;
    if (!reg?.register) return;
    const life = this;
    safe(() =>
      reg.register({
        id: 'village_life',
        name: 'Village life',
        description: "Hearthvale's errands and the missing: Lyra hears who is missing, asks you, and remembers what you said.",
        intents: [
          {
            id: 'village_life.answer',
            confidence: 0.92,
            patterns: [{ source: 'answer', flags: '', exec: (text) => life.answerPattern(text) }],
            answer: () => life.lyraReact(),
          },
          {
            id: 'village_life.seen',
            confidence: 0.9,
            patterns: [{ source: 'seen', flags: '', exec: (text) => life.seenPattern(text) }],
            answer: (m) => life.lyraAnswer(m?.groups?.who),
          },
        ],
        promptContext: () => life.promptContext(),
      }),
    );
  }

  answerPattern(text) {
    const q = this.pending.lyra;
    if (!q?.answered || q.reacted || this.rt() - (q.answeredRt ?? -Infinity) > 1) return null;
    const m = [String(text)];
    m.index = 0;
    m.groups = {};
    return m;
  }

  seenPattern(text) {
    const s = String(text || '');
    if (!RE_SEEN.test(s)) return null;
    for (const id of VILLAGERS) {
      const re = new RegExp(`\\b${this.name(id)}\\b`, 'i');
      if (re.test(s)) {
        const m = [s];
        m.index = 0;
        m.groups = { who: id };
        return m;
      }
    }
    return null;
  }

  lyraReact() {
    const q = this.pending.lyra;
    if (!q?.answered) return null;
    q.reacted = true;
    const claim = q.answered;
    const key = claim.kind === 'seen_at' ? 'playerYes' : claim.kind === 'not_seen' ? 'playerNo' : 'playerUnsure';
    return this.line('lyra', key, { about: claim.about, placeId: claim.place, listener: 'player' });
  }

  lyraAnswer(about) {
    if (!about) return null;
    const t = this.now();
    const own = this.sight.lastSeen('lyra', about);
    const c = this.cases.get(about);
    let line;
    if (own && t - own.t < 900 * 1.5) {
      const vars = { about, when: whenPhrase(own.t, t), placeId: own.place };
      if (own.with && own.with !== 'lyra') {
        vars.with = this.nameFor('lyra', own.with);
        line = this.line('lyra', 'seenWith', vars);
      } else line = this.line('lyra', 'seen', vars);
    } else line = this.line('lyra', c && c.status !== 'found' ? (own ? 'notSeen' : 'never') : 'notSeenCalm', { about, when: own ? whenPhrase(own.t, t) : 'yesterday' });
    if (c && (c.status === 'search' || c.status === 'missing') && c.lyra.knew != null) {
      const extra = this.line('lyra', c.status === 'missing' ? 'missing' : 'worry', { about });
      if (extra) line = `${line} ${extra}`;
    }
    return line;
  }

  // One compact line for Lyra's Claude prompt: who is missing, what she asked, what she found out.
  promptContext() {
    const bits = [];
    const t = this.now();
    for (const c of this.cases.all()) {
      if (c.lyra.knew == null) continue;
      const name = this.name(c.about);
      if (c.status === 'found' && t - (c.foundAt ?? 0) < 900) bits.push(`${name} was missing but has turned up safe.`);
      else if (c.status === 'dead') bits.push(`${name} was found dead.`);
      else if (c.status === 'missing' || c.status === 'search' || c.status === 'asking') {
        const searched = Object.keys(c.searched || {})
          .slice(0, 4)
          .map((p) => placePhrase(p, this.placeName(p)));
        bits.push(`Nobody in Hearthvale has seen ${name} since ${sincePhrase((this.cases.lastKnown(c) || { t: c.openedAt }).t, t)}${c.status === 'missing' ? '; the village says ' + pronoun(c.about, 'he') + ' is missing, and nobody knows why' : c.status === 'search' ? '; the watch is searching' : ''}${searched.length ? ` (searched: ${searched.join(', ')})` : ''}.`);
      }
    }
    const q = this.pending.lyra;
    if (q && !q.reacted && this.rt() - q.rt < 180) bits.push(`You just asked ${this.playerName()} whether they have seen ${this.name(q.about)}; their message may be the answer. Take their word as what they told you.`);
    for (const claim of this.claims) {
      if (claim.to === 'lyra' && claim.found && t - claim.found.t < 900 * 2) bits.push(`You found out ${this.playerName()} lied to you about ${this.name(claim.about)}: ${claim.found.by === 'lyra' ? 'you yourself' : this.name(claim.found.by)} saw ${claim.found.elsewhere ? this.name(claim.about) + ' elsewhere' : 'them together'}.`);
    }
    let s = bits.join(' ');
    if (s.length > 520) s = `${s.slice(0, 517)}…`;
    return s;
  }

  // ------------------------------------------------------------------ the village view

  view() {
    const t = this.now();
    const people = [];
    for (const e of this.villagers()) {
      const id = e.id;
      const prob = this.openProblem(id);
      const step = this.steps.get(id);
      const errands = this.book.forWho(id).map((x) => ({ id: x.id, label: x.label, state: x.state, start: x.start, result: x.result, to: x.to }));
      const away = !!this.absences.get(id);
      let doing = step?.doing || e.r?.entry?.doing || null;
      if (!doing) doing = e.activity ? activityText(e.activity, this.placeName(this.placeOf(e))) : '';
      if (away) doing = '';
      people.push({
        id,
        name: this.name(id),
        doing: away ? null : doing,
        errands,
        problem: prob
          ? { kind: prob.kind, about: prob.about, aboutName: prob.about ? this.name(prob.about) : '', since: clockText(prob.since), thought: prob.thought, said: prob.said, belief: prob.belief, asked: prob.asked.map((x) => this.name(x)), checked: prob.checked.map((x) => this.placeName(x)), history: prob.history.slice(-4), awaiting: !!prob.awaiting, source: prob.history[prob.history.length - 1]?.by || 'local' }
          : null,
        mourning: this.mourning[id] ? { about: this.mourning[id].about, aboutName: this.name(this.mourning[id].about), kind: this.mourning[id].kind } : null,
        unseen: away || !!e.absent,
      });
    }
    const cases = this.cases
      .all()
      .filter((c) => c.rumor || c.alarmAt != null || c.status === 'missing' || c.status === 'dead' || c.foundRumor)
      .filter((c) => !(c.status === 'found' && t - (c.foundAt ?? 0) > 900))
      .map((c) => {
        const last = this.cases.lastKnown(c);
        return {
          about: c.about,
          name: this.name(c.about),
          status: c.status,
          since: clockText(c.openedAt),
          lastSeen: last ? `${whenPhrase(last.t, t)}, ${placeAt(last.place, this.placeName(last.place))}${last.by && last.by !== 'player' ? ` (${this.name(last.by)} saw ${pronoun(c.about, 'him')})` : ''}` : null,
          searching: Object.entries(c.searchers || {}).map(([id, p]) => ({ id, name: this.name(id), place: this.placeName(p) })),
          searched: Object.keys(c.searched || {}).map((p) => this.placeName(p)),
          timeline: storyOf(c.timeline).map((x) => ({ time: clockText(x.t), text: x.text, kind: x.kind })),
        };
      });
    const events = this.events
      .filter((x) => !x.hidden && x.day >= this.dayN() - 1)
      .slice(-40)
      .map((x) => ({ time: clockText(x.t), text: x.text, kind: x.kind, who: x.who }));
    return { day: this.dayN(), time: clockText(t), cases, people, events, claude: this.claude.stats() };
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    return {
      v: 1,
      day: this.day,
      book: this.book.serialize(),
      stock: this.stock,
      problems: this.problems.filter((p) => p.status === 'open' || p.day >= this.dayN() - 1).map((p) => ({ ...p, awaiting: false })),
      cases: this.cases.serialize(),
      absences: this.absences.serialize(),
      know: this.know,
      claims: this.claims,
      sight: this.sight.serialize(),
      mourning: this.mourning,
      expectDone: [...this.expectDone],
      events: this.events.slice(-80),
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.book.deserialize(d.book);
    this.day = Number.isFinite(d.day) ? d.day : this.book.day;
    if (d.stock && typeof d.stock === 'object') this.stock = { ...freshStock(), ...d.stock };
    this.problems = Array.isArray(d.problems) ? d.problems.map(restoreProblem).filter(Boolean) : [];
    for (const p of this.problems) if (p.status === 'open') p.due = this.now() + BEAT;
    this.cases.deserialize(d.cases);
    this.absences.deserialize(d.absences);
    this.know = d.know && typeof d.know === 'object' ? d.know : {};
    this.claims = Array.isArray(d.claims) ? d.claims.filter((c) => c && typeof c.about === 'string') : [];
    this.sight.deserialize(d.sight);
    this.mourning = d.mourning && typeof d.mourning === 'object' ? d.mourning : {};
    this.expectDone = new Set(Array.isArray(d.expectDone) ? d.expectDone : []);
    this.events = Array.isArray(d.events) ? d.events.filter((x) => x && typeof x.text === 'string') : [];
    this.steps.clear();
    this.thinkQueue.length = 0;
    // The absent stay absent.
    for (const [id, a] of this.absences.entries()) {
      const e = this.entity(id);
      if (!e) continue;
      if (a.mode === 'gone') {
        e.absent = { cause: a.cause, since: a.since };
        if (!a.keepBody) {
          e.hidden = true;
          e.solid = false;
        }
      } else this.makeStep(e, 'away', { place: a.place, doing: 'somewhere nobody expects' });
    }
    this.refreshLooking();
  }

  // ------------------------------------------------------------------ test harness

  // Make someone vanish and watch the village react (DESIGN §28 test harness):
  //   vanish('garrick')                      gone for good (the village finds out)
  //   vanish('bram', { mode: 'away', place: 'stonecut_quarry', hours: 5 })
  vanish(id, { mode = 'gone', place = null, hours = 5, witnesses = null, cause = 'vanished' } = {}) {
    if (mode === 'away') return this.markAway(id, { place: place || 'stonecut_quarry', hours, witnesses });
    return this.markGone(id, { cause, seen: witnesses || false, at: place ? { place } : null });
  }

  // Force an errand to start now (the harness makes sure somebody needs the vanished person).
  forceErrand(who, tplId, hour = this.hour()) {
    this.ensureDay();
    const inst = this.book.add(tplId, who, hour, 24);
    return inst;
  }

  caseStory(about) {
    const c = this.cases.get(about);
    return c ? c.timeline.map((x) => `${clockText(x.t)}  ${x.text}`) : [];
  }
}

// The case as a story: every turning point, and the latest of the asking and searching.
const TURNS = new Set(['notice', 'alarm', 'search', 'missing', 'found', 'dead', 'claim', 'lie']);
function storyOf(timeline, max = 18) {
  const turns = timeline.filter((x) => TURNS.has(x.kind) && !/: nothing\.$/.test(x.text));
  const rest = timeline.filter((x) => !turns.includes(x));
  const keep = new Set([...turns.slice(-12), ...rest.slice(-Math.max(4, max - Math.min(12, turns.length)))]);
  return timeline.filter((x) => keep.has(x));
}

function activityText(activity, place) {
  switch (activity) {
    case 'work':
      return `working at ${place}`;
    case 'farm':
      return `working the field`;
    case 'eat':
      return `eating at ${place}`;
    case 'sleep':
      return 'asleep';
    case 'socialize':
      return `passing the time at ${place}`;
    case 'patrol':
      return `on watch around ${place}`;
    case 'pray':
      return `praying at ${place}`;
    case 'rest':
      return `resting at ${place}`;
    case 'lamps':
      return 'lighting the lamps';
    case 'errand':
      return `on an errand at ${place}`;
    default:
      return `about ${place}`;
  }
}

// What the player's answer says: not seen, seen, seen at a place, unsure, or not an answer.
export function parseClaim(text, about, life = null) {
  const s = String(text || '').toLowerCase();
  let place = null;
  for (const [re, id] of PLACE_WORDS) {
    if (re.test(s)) {
      place = id;
      break;
    }
  }
  if (!place && /\b(home|his house|her house|their house|at his|at her)\b/.test(s) && life) place = life.profile(about)?.home || null;
  const unsure = RE_UNSURE.test(s);
  const no = RE_NO.test(s);
  const yes = RE_YES.test(s);
  if (place && !(no && !yes)) return { kind: 'seen_at', place };
  if (no && !yes) return { kind: 'not_seen', place: null };
  if (unsure) return { kind: 'unknown', place: null };
  if (yes) return { kind: 'seen', place: null };
  if (s.split(/\s+/).length <= 4) return { kind: 'unknown', place: null };
  return { kind: 'unrelated', place: null };
}
