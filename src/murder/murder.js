// Killing, witnesses, bodies and what the village can know (DESIGN §29). `game.murder`.
//
// The author: "if I killed someone without nobody seeing it, nobody should know… they
// would feel that he's missing." So knowledge is the whole of it: a blow is known to those
// who could see it (witness.js: sight, light, distance, walls, night) and to the one who
// took it, who tells the first person who reaches them and the watch once they are up.
// A finishing blow on a fallen person kills them for good: any adult, Lyra and whoever
// walks with you included (round 14b, DESIGN §35.1); never a child (people.js isMinor).
// Seen: murder — the alarm, the watch, the village turns, Lyra's horror. Unseen: nobody
// knows; their errands fail and §28's missing chain plays out. A body can be carried and
// hidden (the lake gives it back; the deep woods keep it until a search stumbles on it;
// the ruins keep it), and being seen carrying it is a clue. A body found turns missing
// into murder: the watch investigates from real beliefs (investigation.js), may question
// the stranger, who can lie, deflect or confess; the Moot may try them. Grief lasts:
// mourning, a funeral, the work passed on or left undone (grief.js); Lyra weighs it all
// (lyra.js). Saves keep the dead dead.
//
// Hooks other modules call:
//   screenCrime(attacker, victim, kind) -> bool     combat: record the crime now?
//   saw(id, victim)                                  autonomy: did Lyra see that blow?
//   isSecret(victimId)                               social: a blow nobody saw
//   onAttackPress(player) -> bool                    player: a finishing blow instead of a swing
//   bodyCanInteract / bodyLabel / bodyInteract       npc: a body on the ground
//   carrierInteract(player) / promptFor(player)      survival: carrying a body
//   entryFor(npc, entry, hour)                       npc: the funeral, the Moot, mourning, the watch
//   dialogOptions(npc) / dialogOption(npc, key)      npc: "Turn yourself in", "About Bram…"
//   decorateDialogue(npc, d) / toneFor(npc)          npc: grief and fear in their words
//   refusesTrade(npc) / flameBarred()                shops and the chapel turn the stranger away
//   standIn(giverId) / isDead(id)                    missions: a graceful alternative
//   kill(v, killer?, { cause, silent, unmarked })    a killing (round 14b, DESIGN §35.1, §37.2)
//   die(v, { cause })                                a death nobody did: old age (§36.3)
//   onFound(handler) -> off()                        who owns a body's discovery (§37.3)
// Events: villager_killed {id, cause, by, killer, provoked, silent, unmarked, witnesses},
// villager_died {id, cause}, murder_witnessed, body_hidden, body_found, murder_case,
// questioned, arrested, moot_verdict, funeral, moot_met.

import { TILE } from '../core/constants.js';
import { VILLAGERS, PEOPLE } from '../ai/social/bonds_data.js';
import { placeAt, placePhrase, pronoun } from '../ai/village_life/errands_data.js';
import { whenPhrase } from '../ai/village_life/problems.js';
import { witnessesOf, look, lightAt } from './witness.js';
import { canReach } from '../world/walls.js';
import { lyraOf, isMinor } from '../core/people.js';
import { hears, hearsWords, cryLoudness, LOUD, silence, isSilenced } from '../ai/hearing.js';
import { FINISH_HOLD, FINISH_REACH, FINISH_CANCEL, MURDER_WANTED, HOUR, DAY, HIDE, hidingPlace, INVESTIGATORS, levelOf } from './data.js';
import { gatherEvidence, suspicionOf, buildQuestions, judgeAnswer, WEIGHTS } from './investigation.js';
import { murderLine, watchLine } from './lines.js';
import { drawBody, MurderLayer, Grave } from './draw.js';
import * as Grief from './grief.js';
import * as Lyra from './lyra.js';
import * as Hunt from './hunt.js';
import * as Loot from './loot.js';
import { playFinisher, trackDamage } from './finishers.js';
import { openBodyChoice } from '../ui/body_view.js';

const TICK = 0.5;
const SLOW = 1;
const TELL_REACH = 44; // px: someone this close to a fallen victim hears who did it
const NOTICE = { day: 120, night: 46 }; // px a body lying in the open is noticed from
const OVER_BODY = 70; // px: found standing this close to the body
// Who can raise the alarm (DESIGN §29.2): the watch, and Hess who fights beside them.
export const ALARM_TAKERS = ['rowan', 'wys', 'hess'];
const SCREAM_REACH = 96; // px: near enough to make out who and what in a scream
const WATCH_REACH = 64; // px: a witness this close to one of the watch has told them
const TERROR_HOURS = 18; // a killing seen stays this raw: they run, and will not talk
const DREAD_AFTER = 2; // killings seen: after this many, never calm with the stranger again
const PROVOKED = 20; // s: the victim fought or hit the killer this recently (rec.provoked)
const WINDED_AFTER = 6; // s of running from the stranger before Lyra tires (round 14b)
const WINDED = 0.55; // her pace, winded
const WINDED_REST = 10; // s of not running before her pace comes back

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[murder]', err);
    return fallback;
  }
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

export class Murder {
  constructor(game) {
    this.game = game;
    this.dead = {}; // id -> the record of a death
    this.pending = {}; // victimId -> a blow nobody saw: { kind, t, x, y, place }
    this.cases = {}; // victimId -> the watch's investigation
    this.wanted = null; // { about, since, reason }
    this.witnessedBy = {}; // villagerId -> killings they have seen (DESIGN §29.3)
    this.outside = null; // { until, day, about }
    this.funerals = []; // { about, day, hour, state }
    this.moots = []; // { about, day, hour, state, kind }
    this.graves = []; // { about, x, y, day }
    this.lyra = {}; // victimId -> { belief, asked, answered, told }
    this.hold = null; // a finishing blow being held: { target, t, need, paused }
    this.carrying = null; // { id, seenBy: {}, t }
    this.watchUntil = -Infinity; // capture sightings of the player until then (after an unseen death)
    this.session = null; // the watch questioning the player
    this.lastScreen = null;
    this.tickT = 0.2;
    this.slowT = 0.5;
    this.arrestAskedAt = -Infinity;
    this.layer = new MurderLayer(this);
    this.view = null; // the UI (src/ui/murder_view.js), when a browser is up
    this._graveEnts = new Map();
    this.foundHandlers = []; // onFound: who owns the discovery of a body (round 14b, §37.3)
    this.hunt = null; // a known killer hunted from where they were last seen (round 14b, hunt.js)
    const bus = game?.bus;
    if (bus?.on) {
      bus.on('revived', (p) => safe(() => this.onRevived(p)));
      bus.on('new_day', (p) => safe(() => this.onNewDay(p)));
      bus.on('player_tended', (p) => safe(() => this.onTended(p)));
      bus.on('player_message', (p) =>
        safe(() => {
          const reply = Lyra.onPlayerMessage(this, p?.text);
          if (reply) this.lyraReply = { text: reply, rt: this.game?.time ?? 0 };
        }),
      );
      bus.on('npc_topic', (p) => safe(() => Grief.onTopic(this, p)));
      bus.on('delivered', (p) => safe(() => this.onDelivered(p)));
      bus.on('crime_cleared', (p) => safe(() => this.onCrimeCleared(p)));
    }
    this.attach();
    this.installPlugin();
    safe(() => trackDamage(game)); // what the stranger fights with lately (finishers.js)
  }

  // Lyra's side, through the plugin registry: what she knows for Claude's prompt, and her
  // own answer when the stranger replies to "Was it you?".
  installPlugin() {
    const reg = this.game?.plugins;
    if (!reg?.register) return;
    const m = this;
    safe(() =>
      reg.register({
        id: 'murder',
        name: 'A death in Hearthvale',
        description: 'Killing, witnesses and what the village can know (DESIGN §29).',
        intents: [
          {
            id: 'murder.answer',
            confidence: 0.95,
            patterns: [{ source: 'murder', flags: '', exec: (text) => m.answerPattern(text) }],
            answer: () => {
              const r = m.lyraReply;
              m.lyraReply = null;
              return r?.text || null;
            },
          },
        ],
        promptContext: () => m.promptContext(),
      }),
    );
  }

  answerPattern(text) {
    const r = this.lyraReply;
    if (!r || (this.game?.time ?? 0) - r.rt > 1) return null;
    const out = [String(text)];
    out.index = 0;
    out.groups = {};
    return out;
  }

  // ------------------------------------------------------------------ basics

  get life() {
    return this.game?.villageLife || null;
  }

  get village() {
    return this.game?.village || null;
  }

  now() {
    return this.game?.clock?.t ?? 0;
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  day() {
    return this.game?.clock?.day ?? 1;
  }

  rng() {
    const r = this.game?.rng;
    return r && typeof r.next === 'function' ? () => r.next() : Math.random;
  }

  entity(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    if (id === 'player') return this.game?.player || null;
    if (id === 'lyra') return lyraOf(this.game);
    return safe(() => this.game?.entities?.get?.(id), null);
  }

  name(id) {
    if (id === 'player') return this.playerName();
    if (id === 'watch') return 'The watch';
    return this.life?.name?.(id) || this.entity(id)?.name?.split(' ')[0] || id;
  }

  playerName() {
    const n = this.game?.settings?.playerName || this.game?.player?.name;
    return n && n !== 'Traveler' ? n : 'the stranger';
  }

  placeName(id) {
    if (!id) return 'somewhere';
    return safe(() => this.game?.locations?.get?.(id)?.name) || cap(placePhrase(id));
  }

  placeOf(e) {
    if (!e) return null;
    return safe(() => this.game?.locations?.at?.(e.x, e.y)?.id) || null;
  }

  pronoun(id, form) {
    return pronoun(id, form);
  }

  isDead(id) {
    return !!this.dead[id];
  }

  // Dead, and the village knows it (a body was found, or someone saw it happen and the
  // alarm is up: a witness still running for the watch has told nobody yet, §29.2).
  // Round 14b leftover: a body found is known to its finder at once, to the rest of the
  // village only as the news reaches them (by meeting), or with the bell and the chapel
  // within the hour (rec.newsWaits while it has not).
  knownDead(id) {
    const r = this.dead[id];
    return !!r && ((r.foundAt != null && !r.newsWaits) || (r.known === 'witnessed' && (!r.alarm || r.alarm.raised)));
  }

  // Does this one person know the dead is dead (they found or saw it, the news reached
  // them face to face, or everyone knows by now)?
  knowsDead(id, who) {
    const r = this.dead[id];
    if (!r) return false;
    if (this.knownDead(id)) return true;
    if (r.foundBy === who || (r.seen || []).some((s) => s.id === who)) return true;
    const c = safe(() => this.life?.cases?.get?.(id), null);
    const dr = c?.deadRumor ? safe(() => this.village?.rumors?.get?.(c.deadRumor), null) : null;
    return !!dr?.heardBy?.includes?.(who);
  }

  // The news of a body found, by meeting (round 14b leftover): those who have heard it now
  // mourn as they learn; once it reaches the watch the case opens (the finder's clues with
  // it); the funeral and the Moot are planned when the village knows.
  tickFoundNews() {
    for (const rec of Object.values(this.dead)) {
      if (!rec.newsWaits) continue;
      const c = safe(() => this.life?.cases?.get?.(rec.id), null);
      const dr = c?.deadRumor ? safe(() => this.village?.rumors?.get?.(c.deadRumor), null) : null;
      const heard = new Set([rec.foundBy, ...(dr?.heardBy || [])].filter(Boolean));
      safe(() => Grief.mournAs(this, rec, heard));
      if (rec.caseWaits && [...heard].some((id) => INVESTIGATORS.includes(id) || ALARM_TAKERS.includes(id))) {
        rec.caseWaits = false;
        this.openCase(rec.id);
      }
    }
  }

  // Does this villager know who did it: they saw it, the news reached them face to face,
  // or the bell has rung (§29.2)?
  knowsKiller(rec, id) {
    if (!rec || rec.known !== 'witnessed') return false;
    if (!rec.alarm || rec.alarm.raised) return true;
    if ((rec.seen || []).some((s) => s.id === id)) return true;
    const r = rec.rumor ? safe(() => this.village?.rumors?.get?.(rec.rumor), null) : null;
    return !!r && Array.isArray(r.heardBy) && r.heardBy.includes(id);
  }

  isVillager(e) {
    return !!e && VILLAGERS.includes(e.id) && !!e.profile;
  }

  // A person of Hearthvale the finishing blow can fall on (round 14b, DESIGN §35.1): a
  // villager, Lyra herself, or whoever holds the companion role. Never a beast, never the
  // player. Whether they may die is canKill's (never a child).
  isPerson(e) {
    if (!e || this.isPlayer(e)) return false;
    if (this.isVillager(e)) return true;
    if (e === lyraOf(this.game)) return true;
    const h = safe(() => this.game?.party?.holder, null);
    return !!h && h === e && PEOPLE.includes(e.id);
  }

  isLyra(e) {
    return !!e && (e === lyraOf(this.game) || e === 'lyra');
  }

  isPlayer(e) {
    return !!e && (e === this.game?.player || e.id === 'player');
  }

  toast(text, kind = 'warn', key = null) {
    safe(() => this.game?.ui?.toast?.(text, kind, key ? { key } : undefined));
  }

  say(e, text, kind = 'say') {
    if (!e || !text) return;
    safe(() => (typeof e.say === 'function' ? e.say(text, { kind }) : this.game?.bubbles?.say?.(e, text, { kind })));
  }

  event(kind, text, extra = {}) {
    safe(() => this.life?.event?.(kind, text, extra));
  }

  emit(type, payload) {
    safe(() => this.game?.bus?.emit?.(type, payload));
  }

  visible(e, margin = 24) {
    const cam = this.game?.camera;
    if (!e || !cam || !Number.isFinite(cam.vw)) return false;
    return e.x >= cam.x - margin && e.x <= cam.x + cam.vw + margin && e.y >= cam.y - margin && e.y <= cam.y + cam.vh + margin;
  }

  // The village life's sightings tell us who saw a body, and every fresh sighting.
  attach() {
    const life = this.life;
    const sight = life?.sight;
    if (!sight) return;
    sight.onBody = (seer, deadId, place) => safe(() => this.bodySeen(seer, deadId, place));
    const prev = sight.onSeen;
    sight.onSeen = (a, b) => {
      if (prev) prev(a, b);
      if (b === 'player' && this.now() < this.watchUntil) safe(() => this.notePlayerSeen(a));
      // The hunt (round 14b): a sighting by one who knows, told to the posse face to face.
      if (b === 'player' && this.hunt && this.hunt.state !== 'over') safe(() => Hunt.sighting(this, a));
    };
  }

  // ------------------------------------------------------------------ knowing a blow

  // combat.damage asks before recording a crime against a villager: is it known now?
  screenCrime(attacker, victim, kind) {
    if (!this.isPlayer(attacker) || !victim?.profile || victim.dead) return true;
    const g = this.game;
    const exclude = [victim.id];
    const seen = witnessesOf(g, victim.x, victim.y, { exclude });
    // Someone may see the stranger swing and not the one they hit (round a corner).
    for (const w of witnessesOf(g, attacker.x, attacker.y, { exclude })) if (!seen.some((s) => s.id === w.id)) seen.push(w);
    this.lastScreen = { victim: victim.id, ids: new Set(seen.map((s) => s.id)), t: this.now() };
    if (seen.length) {
      // Seen: and whatever this one already knew, the watch soon will too.
      delete this.pending[victim.id];
      return true;
    }
    const prev = this.pending[victim.id];
    const k = prev?.kind === 'knockout' || kind === 'knockout' ? 'knockout' : 'assault';
    this.pending[victim.id] = { kind: k, t: this.now(), x: Math.round(victim.x), y: Math.round(victim.y), place: this.placeOf(victim) };
    return false;
  }

  // Did `id` see the blow that just fell on `victim`?
  saw(id, victim) {
    const s = this.lastScreen;
    if (!s || s.victim !== (victim?.id ?? victim) || this.now() - s.t > 2) return true;
    return s.ids.has(id);
  }

  // The same, but null when no blow on `victim` was screened a moment ago (a crime told
  // later by the one who took it is news, not something anyone saw).
  sawBlow(id, victim) {
    const s = this.lastScreen;
    if (!s || s.victim !== (victim?.id ?? victim) || this.now() - s.t > 2) return null;
    return s.ids.has(id);
  }

  // Is the crime on `victim` being reported this moment one told in words (reveal), not a
  // blow falling? A told crime makes no sound for anyone to hear.
  toldNow(victim) {
    const s = this.lastScreen;
    return !!s && !!s.told && s.victim === (victim?.id ?? victim) && this.now() - s.t <= 2;
  }

  // Does anyone hear this victim's cry? The one rule for ears (src/ai/hearing.js, DESIGN
  // §29.4): the reach by severity, walls and shut doors muffling it, sleep dulling it.
  // -> 'clear' (someone heard it in the open), 'muffled' (only through a wall), or false.
  heardBy(victim, severity = 1) {
    const v = this.entity(victim);
    if (!v) return false;
    const g = this.game;
    // Held silent, or killed silently (round 14b, §37.2): loudness 0, nobody hears a thing.
    if (isSilenced(g, v) || this.dead[v.id]?.silent) return false;
    let best = false;
    for (const e of [...(this.life?.villagers?.() || []), g?.companion]) {
      if (!e || e === v || e.dead || e.absent || !e.isAlive?.() || this.dead[e.id]) continue;
      const how = safe(() => hears(g, e, v.x, v.y, cryLoudness(severity)), null);
      if (how === 'clear') return 'clear';
      if (how) best = how;
    }
    return best;
  }

  isSecret(victimId) {
    return !!this.pending[victimId];
  }

  // The one who took a blow nobody saw tells: the first person who reaches them, the watch
  // once they are up. The crime is known from now on.
  reveal(victimId, to = null) {
    const p = this.pending[victimId];
    if (!p) return false;
    delete this.pending[victimId];
    const v = this.entity(victimId);
    const P = this.game?.player;
    const c = this.game?.combat;
    if (!v || !P || !c) return false;
    safe(() => c._recordCrime?.(P, v, p.kind));
    // Told, not seen (DESIGN §29.4): the crime this tells is the hurt one's words to the one
    // beside them, and to nobody else. Whoever happens to see the stranger right now saw
    // no blow: the screen for this event names only the one told (sawBlow), so nobody else
    // turns on the stranger, flees or fights them for it; the news goes on by meeting.
    const prev = this.lastScreen;
    this.lastScreen = { victim: victimId, ids: new Set(to ? [to] : []), t: this.now(), told: true };
    try {
      safe(() => c._reportCrime?.(P, v, p.kind));
    } finally {
      this.lastScreen = prev;
    }
    const who = to ? this.name(to) : 'the watch';
    this.event('told', `${this.name(victimId)} told ${who} that ${this.playerName()} attacked ${pronoun(victimId, 'him')}.`, { who: victimId, about: 'player' });
    return true;
  }

  onRevived(p) {
    const e = p?.entity;
    if (e && this.pending[e.id]) this.reveal(e.id, p.by && p.by !== e && !this.isPlayer(p.by) ? p.by.id : null);
  }

  onDelivered(p) {
    const e = p?.entity;
    if (e && this.pending[e.id] && p.carrier && !this.isPlayer(p.carrier)) this.reveal(e.id, p.carrier.id);
  }

  // ------------------------------------------------------------------ the finishing blow

  // The downed person within reach in front of the player, or null. A downed lock-on target
  // (round 14b, game.lock) in reach comes first.
  finishTarget(player) {
    const list = safe(() => this.game.entities.query(player.x, player.y, FINISH_REACH + 6), []) || [];
    const locked = safe(() => this.game.lock?.target, null);
    let best = null;
    let bs = Infinity;
    const fx = player.facing?.x ?? 0;
    const fy = player.facing?.y ?? 1;
    for (const e of list) {
      if (e === player || !e.downed || e.dead || e.carriedBy || e.removed || e.absent) continue;
      if (!this.isPerson(e)) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > FINISH_REACH) continue;
      // Never through a wall (DESIGN §31.1): the same rule as every other blow.
      if (!safe(() => canReach(this.game, player, e), true)) continue;
      const score = d - (d > 0 ? ((dx * fx + dy * fy) / d) * 10 : 10) - (e === locked ? 1000 : 0);
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }

  // The attack button over someone lying down: a held, deliberate blow, not a swing.
  // Returns true when the press was taken (no swing).
  onAttackPress(player) {
    if (this.hold) return true;
    if (!player || player.carrying || player.downed || player.dead) return false;
    const v = this.finishTarget(player);
    if (!v) return false;
    // Never a child, by age (src/core/people.js; DESIGN §35.1). Everyone else may die.
    if (isMinor(this.game, v)) {
      this.refuse(player, v);
      return true;
    }
    player.faceToward?.(v.x, v.y);
    this.hold = { target: v, t: 0, need: FINISH_HOLD, paused: false, startedAt: this.now() };
    // The last stand's burning minute asks nothing (the price was read when it was taken).
    const burning = !!safe(() => this.game.prices?.burning?.(), false);
    const warned = this.isLyra(v) ? this.game.flags?.finisherWarnedLyra : this.game.flags?.finisherWarned;
    if (!warned && !burning) {
      this.hold.paused = true;
      this.warn(v);
      return true;
    }
    this.holdBegins(v);
    return true;
  }

  // Never a child. The sword will not go there.
  refuse(player, v) {
    const now = this.game?.time ?? 0;
    if (now - (this._refusedAt ?? -Infinity) < 6) return;
    this._refusedAt = now;
    safe(() => this.game.bubbles?.say?.(player, 'No. Not a child.', { kind: 'whisper' }));
  }

  // The first time: what this is, plainly. Lyra has her own first time (round 14b).
  warn(v) {
    const g = this.game;
    const name = v.name?.split(' ')[0] || 'them';
    const lyra = this.isLyra(v);
    const text = lyra
      ? `${name} is lying helpless. Strike now and she will die, for good: not knocked down, dead. No flame, no rescue and no save brings her back. Hobb and Wenna will bury their daughter. Anyone who sees it will know you for her murderer.`
      : `${name} is lying helpless. Strike now and ${pronoun(v.id, 'he')} will die, for good: no flame, no rescue and no save brings the dead back. Anyone who sees it will know you for a murderer. Anyone who doesn't will only know ${pronoun(v.id, 'he')} is gone.`;
    const ask = g.ui?.confirm ? g.ui.confirm({ title: lyra ? `Kill ${name}?` : 'A killing blow', text, yes: 'I understand', no: 'Lower the sword', danger: true }) : Promise.resolve(true);
    Promise.resolve(ask).then(
      (yes) => {
        g.flags = g.flags || {};
        if (yes) {
          if (lyra) g.flags.finisherWarnedLyra = true;
          g.flags.finisherWarned = true;
          if (g.ui?.toast) this.toast(`Hold the sword down over ${name} to strike.`, 'info', 'finisher');
        }
        this.hold = null;
      },
      () => {
        this.hold = null;
      },
    );
  }

  holdBegins(v) {
    const g = this.game;
    safe(() => g.audio?.heartbeat?.(0.6));
    // Lyra, if she sees it start, cries out (she cannot stop a blow already falling). Not
    // when the one lying there is Lyra, and never a dead Lyra.
    const L = lyraOf(g);
    if (L && L !== v && !L.downed && !L.dead && !this.dead[L.id] && look(g, L, v.x, v.y)) Lyra.sawHold(this, v);
  }

  updateHold(dt) {
    const h = this.hold;
    if (!h || h.paused) return;
    const g = this.game;
    const P = g.player;
    const v = h.target;
    const held = safe(() => !!g.input?.down?.('attack'), false) || h.auto;
    const ok = P && v && v.downed && !v.dead && !v.carriedBy && !P.downed && !P.carrying && dist(P, v) <= FINISH_CANCEL && g.state === 'playing';
    if (!held || !ok) {
      this.hold = null;
      return;
    }
    P.faceToward?.(v.x, v.y);
    if (P.moveIntent) {
      P.moveIntent.x = 0;
      P.moveIntent.y = 0;
    }
    if (P.vel) {
      P.vel.x = 0;
      P.vel.y = 0;
    }
    h.t += dt;
    if (h.t >= h.need) {
      this.hold = null;
      this.strike(P, v);
    }
  }

  // The blow falls: the death is now (witnesses, the record, everything a killing is), and a
  // short finisher by the stranger's build is laid over the next second (round 14b,
  // finishers.js; Settings -> Finishers: full, brief or off, the same outcome).
  strike(P, v) {
    const g = this.game;
    safe(() => P.setState?.('attack', 0.4));
    safe(() => g.audio?.play?.('hit', { x: v.x, y: v.y, volume: 0.9, pitch: 0.55 }));
    safe(() => g.camera?.shake?.(2.5, 0.25));
    g.hitStop = Math.max(g.hitStop || 0, 0.3);
    const rec = this.kill(v, P);
    if (rec) safe(() => playFinisher(g, P, v, rec));
    return rec;
  }

  // ------------------------------------------------------------------ a death

  // Any adult person (a villager, Lyra, whoever walks with you); never a child: by age, the
  // one rule (src/core/people.js isMinor; DESIGN §34.2, §35.1).
  canKill(v) {
    return !!v && this.isPerson(v) && !isMinor(this.game, v) && !v.dead && !this.dead[v.id];
  }

  // Did the victim fight or hit the killer in the last PROVOKED seconds (round 14b, §35.1)?
  // Read when the blow falls: their fight (fightTarget, mode), the killer's last attacker,
  // and combat's record of who hurt whom (what self-defense reads).
  provoked(v, killer) {
    if (!v || !killer) return false;
    const t = this.now();
    if (v.fightTarget === killer && v.mode === 'fight') return true;
    // Answering a cry by squaring up to the one who did it (npc help role 'confront').
    if (v.mode === 'help' && v.help?.role === 'confront' && v.help.attacker === killer) return true;
    const la = killer.lastAttacker;
    const src = la && la.type === 'projectile' ? la.owner : la;
    if (src === v && t - (killer.lastAttackedAt ?? -Infinity) <= PROVOKED) return true;
    const c = this.game?.combat;
    const at = safe(() => c?.aggressions?.get?.(killer)?.get?.(v), null);
    if (Number.isFinite(at)) return t - at <= PROVOKED;
    return !!safe(() => c?.isSelfDefense?.(killer, v), false) && t - (v.lastAttackedAt ?? -Infinity) <= PROVOKED;
  }

  // The fall is over and the body is ours: off a carrier, out of the sickroom and the downed.
  endFall(v) {
    const g = this.game;
    const sv = g?.survival;
    if (v.carriedBy) safe(() => sv?.endCarry?.(v.carriedBy));
    safe(() => sv?.resolveFall?.(v, 'died'));
    safe(() => sv?.patients?.delete?.(v));
    safe(() => g?.combat?.downedAt?.delete?.(v));
    delete this.pending[v.id];
  }

  // The record of a death (shared by kill and die). Round 14b adds by, cause, provoked,
  // silent, unmarked and natural (§35.1); an old save's record has none of them, and reads
  // as cause 'killed', the rest unknown (null) or false.
  record(v, { t, place, seen = [], cause = 'killed', by = null, provoked = null, silent = false, unmarked = false, natural = false } = {}) {
    return {
      id: v.id,
      t,
      day: this.day(),
      x: Math.round(v.x),
      y: Math.round(v.y),
      place,
      seen,
      known: seen.length ? 'witnessed' : null,
      state: 'lying',
      covered: false,
      hidden: null,
      foundAt: null,
      foundBy: null,
      foundPlace: null,
      clues: [],
      after: [],
      answers: [],
      snap: natural ? { victim: [], player: [] } : this.snapshot(v.id, t),
      by,
      cause,
      provoked,
      silent: !!silent,
      unmarked: !!unmarked,
      natural: !!natural,
    };
  }

  // Kill a villager for good. Returns the record, or null.
  // kill(v, killer = the player, opts) or kill(v, opts) (round 14b, DESIGN §35.1, §37.2):
  //   opts.cause     what the record calls it ('killed' by default; 'unkindled', ...)
  //   opts.silent    no cry, no call for help, no scream: the victim is held silent (loudness
  //                  0 through src/ai/hearing.js); eyes still see (witnesses by the sight rule)
  //   opts.unmarked  no blood, smear or wound on the body (the record keeps it; saved)
  //   opts.by        the killer's id when no killer entity is given
  kill(v, killer = this.game?.player, opts = {}) {
    if (killer && typeof killer === 'object' && !Number.isFinite(killer.x) && killer.type !== 'actor') {
      opts = killer;
      killer = opts.killer !== undefined ? opts.killer : this.game?.player;
    }
    opts = opts || {};
    v = this.entity(v);
    if (!this.canKill(v)) return null;
    const g = this.game;
    const t = this.now();
    const silent = !!opts.silent;
    const unmarked = !!opts.unmarked;
    // Silent: the voice goes first, before anything else in this death could make a sound.
    if (silent) silence(g, v, Infinity);
    const place = this.placeOf(v);
    const seen = witnessesOf(g, v.x, v.y, { exclude: [v.id] });
    if (killer) for (const w of witnessesOf(g, killer.x, killer.y, { exclude: [v.id] })) if (!seen.some((s) => s.id === w.id)) seen.push(w);
    const provoked = this.provoked(v, killer);
    this.endFall(v);
    const by = killer ? (this.isPlayer(killer) ? 'player' : killer.id ?? null) : typeof opts.by === 'string' ? opts.by : null;
    const cause = typeof opts.cause === 'string' && opts.cause ? opts.cause : 'killed';
    const rec = this.record(v, { t, place, seen, cause, by, provoked, silent, unmarked });
    this.dead[v.id] = rec;
    // What they carried is on them still (round 14b: their pockets can be searched).
    safe(() => Loot.rollLoot(this, v, rec));
    // Out of the village's life (errands, problems, conversations), the body left where it fell.
    safe(() => this.life?.markGone?.(v.id, { cause, seen: seen.map((s) => s.id), at: { place }, keepBody: true }));
    // Unmarked: whatever blood lay where they stood is gone with the wound that never was.
    if (unmarked) safe(() => g.survival?.trail?.clearNear?.(v.x, v.y, 18));
    this.layBody(v, rec);
    this.emit('villager_killed', { id: v.id, entity: v, killer, by, cause, provoked, silent, unmarked, witnesses: seen.map((s) => s.id), place, x: v.x, y: v.y });
    safe(() => g.particles?.emit?.('dust', v.x, v.y, { count: 6, speed: 14, life: 0.6 }));
    if (seen.length) this.seenMurder(rec);
    else this.watchUntil = t + HOUR;
    safe(() => {
      if (g.save) g.save.pending = g.save.pending || 'auto';
    });
    return rec;
  }

  // A death nobody did (decision D13; round 14b, DESIGN §36.3): old age, and any cause a
  // workstream names. The same record and body as a killing, and none of a killing's
  // consequences: no witnesses, no alarm, no case, no wanted, nothing for the tempter or
  // the village's reckoning of the stranger. The village life takes them out by `cause`.
  // Emits villager_died {id, cause}, never villager_killed. A minor never dies of age.
  die(v, { cause = 'age', silent = true, unmarked = true } = {}) {
    v = this.entity(v);
    if (!v || !this.isVillager(v) || v.dead || this.dead[v.id]) return null;
    if (cause === 'age' && isMinor(this.game, v)) return null;
    const g = this.game;
    const t = this.now();
    if (silent) silence(g, v, Infinity);
    const place = this.placeOf(v);
    this.endFall(v);
    const rec = this.record(v, { t, place, seen: [], cause: String(cause || 'age'), by: null, provoked: null, silent, unmarked, natural: true });
    this.dead[v.id] = rec;
    safe(() => this.life?.markGone?.(v.id, { cause: rec.cause, seen: [], at: { place }, keepBody: true }));
    if (unmarked) safe(() => g.survival?.trail?.clearNear?.(v.x, v.y, 18));
    this.layBody(v, rec);
    this.emit('villager_died', { id: v.id, entity: v, cause: rec.cause, place, x: v.x, y: v.y });
    safe(() => {
      if (g.save) g.save.pending = g.save.pending || 'auto';
    });
    return rec;
  }

  // The body as it lies: still, unmoving, drawn by us.
  layBody(v, rec) {
    v.hp = 0;
    v.downed = false;
    v.dead = true;
    v.solid = false;
    v.mode = 'dead';
    v.help = null;
    v.fleeFrom = null;
    v.fightTarget = null;
    v.pendingSay = null;
    if (v.moveIntent) {
      v.moveIntent.x = 0;
      v.moveIntent.y = 0;
    }
    if (v.knock) {
      v.knock.x = 0;
      v.knock.y = 0;
    }
    safe(() => v.walker?.stop?.());
    safe(() => v.leaveBed?.());
    safe(() => v.leaveSeat?.());
    if (!v.absent) v.absent = { cause: rec.cause || 'killed', since: rec.t };
    v.unmarked = !!rec.unmarked; // no blood, smear or wound drawn on them (round 14b, §37.2)
    v.state = 'dead';
    v.hidden = !!rec.hidden || rec.state === 'buried';
    v.solid = false;
    const m = this;
    v.draw = function drawDead(ctx, ox, oy, time) {
      drawBody(this, m.dead[this.id] || rec, ctx, ox, oy, time);
    };
    if (!this.isVillager(v)) this.stillBody(v);
    safe(() => this.game?.bubbles?.clear?.(v));
  }

  // Lyra (or anyone not a villager) killed: her own update would get her up again (a knock-
  // out) and her own interact would open a chat. The companion's own code knows a killing
  // when it has isKilled() (the party workstream); otherwise the body is held still here,
  // knelt by and lifted like anyone's, and gives no light.
  stillBody(v) {
    if (typeof v.isKilled === 'function' || v._stillBody) return;
    v._stillBody = true;
    const m = this;
    v.update = function deadUpdate() {
      if (!m.dead[this.id]) return;
      this.dead = true;
      this.downed = false;
      this.hp = 0;
      if (this.moveIntent) {
        this.moveIntent.x = 0;
        this.moveIntent.y = 0;
      }
    };
    v.canInteract = function deadCanInteract(actor) {
      return !this.carriedBy && m.bodyCanInteract(this, actor);
    };
    v.interactLabel = function deadLabel() {
      return m.bodyLabel(this);
    };
    v.interact = function deadInteract(actor) {
      m.bodyInteract(this, actor);
    };
    v.getLight = () => null;
  }

  // What everyone knew, at the moment of death, of where the dead and the stranger were.
  snapshot(id, t) {
    const sight = this.life?.sight;
    if (!sight) return { victim: [], player: [] };
    const since = t - 3 * HOUR;
    const victim = safe(() => sight.sightingsOf(id, { since }), []) || [];
    const player = safe(() => sight.sightingsOf('player', { since }), []) || [];
    const clip = (list) => list.slice(0, 20).map((s) => ({ by: s.by, t: Math.round(s.t), place: s.place, with: s.with, heading: s.heading }));
    return { victim: clip(victim), player: clip(player) };
  }

  // After a death nobody saw, people still notice where the stranger goes for a while.
  notePlayerSeen(by) {
    if (by === 'lyra' || by === 'player') return;
    const P = this.game?.player;
    if (!P) return;
    const t = this.now();
    for (const rec of Object.values(this.dead)) {
      if (t - rec.t > HOUR || rec.known || rec.natural) continue;
      const last = rec.after[rec.after.length - 1];
      if (last && last.by === by && t - last.t < HOUR / 4) continue;
      if (rec.after.length >= 24) continue;
      rec.after.push({ by, t: Math.round(t), place: this.placeOf(P), carrying: !!P.carrying });
    }
  }

  // ------------------------------------------------------------------ seen

  // Seen (DESIGN §29.2): those who saw it know, and those near enough to make out the
  // scream. Nobody else knows yet: the news travels as they meet people (the village's
  // gossip, face to face), and the watch knows only when someone who knows reaches them
  // (raiseAlarm). The witnesses are terrified: they run for the watch, screaming (§29.3).
  seenMurder(rec) {
    const g = this.game;
    const v = this.entity(rec.id);
    const clear = rec.seen.filter((s) => s.clarity === 'clear');
    rec.known = 'witnessed';
    rec.alarm = rec.alarm || { raised: false, by: null, t: null };
    let n = 0;
    const knowers = [];
    for (const s of rec.seen) {
      if (s.id === 'lyra') continue;
      const e = this.entity(s.id);
      if (!e) continue;
      knowers.push(s.id);
      if (n < 3) this.say(e, murderLine(s.id, s.clarity === 'clear' ? 'alarm' : 'alarmGlimpse', { about: rec.id, P: this.playerName() }, this.rng()), 'shout');
      n++;
      this.terrify(e, rec);
    }
    // The scream carries a little way: whoever is close enough to make out the words, with
    // no wall between (a wall leaves a noise, not words: src/ai/hearing.js).
    for (const e of this.life?.villagers?.() || []) {
      if (!e || e.id === rec.id || knowers.includes(e.id) || !e.isAlive?.() || e.state === 'sleep') continue;
      if (rec.seen.some((s) => s.id !== 'lyra' && safe(() => hearsWords(g, e, this.entity(s.id), SCREAM_REACH), false))) knowers.push(e.id);
    }
    const r = safe(() => this.village?.addRumor?.('murder', { victim: rec.id, witnesses: knowers, saw: rec.seen.filter((s) => s.id !== 'lyra').map((s) => s.id), source: knowers[0] || 'village' }), null);
    rec.rumor = r?.id || null;
    this.emit('murder_witnessed', { id: rec.id, witnesses: rec.seen, clear: clear.map((s) => s.id) });
    this.event('murder', `${this.playerName()} killed ${this.name(rec.id)} ${placeAt(rec.place, this.placeName(rec.place))}. ${rec.seen.filter((s) => s.id !== 'lyra').map((s) => this.name(s.id)).join(', ') || 'Lyra'} saw it.`, { who: 'player', about: rec.id });
    // Lyra: there, or told by whoever reaches her with it (or the bell).
    if (rec.seen.some((s) => s.id === 'lyra')) {
      rec.lyraTold = true;
      Lyra.witnessed(this, rec);
    }
    // One of the watch saw it: the alarm goes up at once.
    const taker = knowers.find((id) => ALARM_TAKERS.includes(id));
    if (taker) {
      this.raiseAlarm(rec, taker, { saw: true });
      return;
    }
    const names = rec.seen.filter((s) => s.id !== 'lyra').map((s) => this.name(s.id));
    if (names.length) {
      const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      this.toast(`${who} saw you kill ${this.name(rec.id)}, and ${names.length > 1 ? 'they are' : `${this.pronoun(rec.seen.find((s) => s.id !== 'lyra').id, 'he')} is`} running for the watch.`, 'warn', 'murder');
    }
  }

  // Someone who knows has reached the watch (or the watch saw it): wanted, the bell, the
  // body found, the case opened, the village turns, and Lyra hears the bell.
  raiseAlarm(rec, by, { saw = false } = {}) {
    if (!rec || rec.alarm?.raised) return false;
    const g = this.game;
    const P = g.player;
    const v = this.entity(rec.id);
    rec.alarm = { raised: true, by, t: this.now() };
    this.setWanted(rec.id, 'murder');
    this.emit('crime', { actor: P, victim: v, kind: 'murder', witnesses: rec.seen.map((s) => s.id) });
    safe(() => g.audio?.play?.('bell', { volume: 0.7 }));
    if (!saw) this.event('alarm', `${this.name(by)} heard who killed ${this.name(rec.id)}, and raised the alarm.`, { who: by, about: rec.id });
    const finder = rec.seen.find((s) => s.id !== 'lyra')?.id || by;
    if (rec.foundAt == null) this.found(rec.id, finder, rec.place, { witnessed: true });
    else if (rec.newsWaits || rec.caseWaits) {
      // Found quietly before (the news still on its way): the bell tells everyone now.
      rec.newsWaits = false;
      rec.caseWaits = false;
      this.openCase(rec.id);
      Grief.onFound(this, rec);
    } else if (this.cases[rec.id]) {
      // The body was found first (a mystery); now the watch has the witness's word.
      const c = this.cases[rec.id];
      c.askAt = Math.min(c.askAt ?? Infinity, Math.round(this.now() + 0.2 * HOUR));
      this.weigh(rec.id);
    }
    if (!rec.turned) Grief.villageTurns(this, rec);
    if (!rec.lyraTold) rec.lyraHearsAt = this.now() + 20;
    // The hunt is up: the posse goes to where the killer was last seen (round 14b, hunt.js).
    safe(() => Hunt.startHunt(this, rec, by));
    const e = this.entity(by);
    if (e && !saw) this.say(e, watchLine?.(by, 'alarm', { about: rec.id, P: this.playerName() }, this.rng()) || `The stranger killed ${this.name(rec.id)}! Ring the bell!`, 'shout');
    this.toast(saw ? `${this.name(rec.id)} is dead, and the watch saw you do it. The watch is coming.` : `${this.name(by)} knows what you did to ${this.name(rec.id)}. The bell is ringing: the watch is coming.`, 'warn', 'murder');
    return true;
  }

  // A witness to a killing (DESIGN §29.3): terrified. They run for the watch, screaming,
  // and will not talk with the stranger; after DREAD_AFTER killings seen, never calmly again.
  terrify(e, rec) {
    if (!e) return;
    const t = this.now();
    const seen = (this.witnessedBy[e.id] = (this.witnessedBy[e.id] || 0) + 1);
    e.terror = { about: rec.id, since: t, until: t + TERROR_HOURS * HOUR };
    if (seen >= DREAD_AFTER) e.dread = true;
    safe(() => e.adjustOpinion?.(-60, `watched the stranger kill ${this.name(rec.id)}`));
    const P = this.game?.player;
    if (!P) return;
    // To the watch: the nearest of them awake, else the guardhouse; else simply away.
    const to = this.watchFor(e);
    safe(() => e.startFlee?.(P, ALARM_TAKERS.includes(e.id) ? 6 : 90, 'crime', to ? { to } : undefined));
  }

  watchFor(e) {
    let best = null;
    let bd = Infinity;
    for (const id of ALARM_TAKERS) {
      if (id === e.id) continue;
      const w = this.entity(id);
      if (!w || w.dead || !w.isAlive?.() || w.state === 'sleep' || w.downed) continue;
      const d = dist(w, e);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    if (best) return { x: best.x, y: best.y, entity: best };
    const gh = this.game?.locations?.get?.('guardhouse');
    return gh?.center ? { x: gh.center.x, y: gh.center.y } : null;
  }

  // Is this villager in no state to talk with the stranger (a killing seen today), or only
  // in fear (killings seen before)? -> 'terror' | 'dread' | null
  fearOf(npc) {
    const e = typeof npc === 'string' ? this.entity(npc) : npc;
    if (!e) return null;
    if (e.terror && this.now() < e.terror.until) return 'terror';
    if (e.dread || (this.witnessedBy[e.id] || 0) >= DREAD_AFTER) return 'dread';
    return null;
  }

  // The news reaching the watch (and Lyra) face to face, as the village's gossip carries it.
  tickNews() {
    for (const rec of Object.values(this.dead)) {
      // A body found: told to her by someone who knows (the village's 'found_dead' news).
      if (rec.lyraNewsAt != null) {
        const c = safe(() => this.life?.cases?.get?.(rec.id), null);
        const dr = c?.deadRumor ? safe(() => this.village?.rumors?.get?.(c.deadRumor), null) : null;
        if (dr?.heardBy?.includes?.('lyra')) {
          rec.lyraNewsAt = null;
          safe(() => Lyra.learnsDeath(this, rec));
        }
      }
      if (rec.known !== 'witnessed') continue;
      const r = rec.rumor ? safe(() => this.village?.rumors?.get?.(rec.rumor), null) : null;
      if (!r) continue;
      if (!rec.alarm?.raised) {
        const by = ALARM_TAKERS.find((id) => r.heardBy.includes(id) && this.entity(id)?.isAlive?.());
        if (by) this.raiseAlarm(rec, by);
      }
      if (!rec.lyraTold && r.heardBy.includes('lyra')) {
        rec.lyraTold = true;
        rec.lyraHearsAt = null;
        safe(() => Lyra.hearsOfMurder(this, rec));
      }
    }
    // Lyra, who saw the body carried (round 14b): she tells the first of the watch she meets.
    const L = lyraOf(this.game);
    if (L && !L.dead && !L.downed && !this.dead[L.id]) {
      for (const rec of Object.values(this.dead)) {
        if (!rec.lyraSawCarry || rec.alarm?.raised) continue;
        for (const id of ALARM_TAKERS) {
          const w = this.entity(id);
          if (!w || w.dead || w.downed || !w.isAlive?.() || w.state === 'sleep' || dist(L, w) > WATCH_REACH) continue;
          if (!safe(() => hearsWords(this.game, w, L, WATCH_REACH), true)) continue;
          this.raiseAlarm(rec, id);
          break;
        }
      }
    }
    // A witness who has run to the watch tells them at once: she runs in through the door
    // shouting it (the doorway is no wall between them, whatever the roof says).
    for (const e of this.life?.villagers?.() || []) {
      if (!e.terror || this.now() >= e.terror.until || ALARM_TAKERS.includes(e.id)) continue;
      const rec = this.dead[e.terror.about];
      if (!rec || rec.alarm?.raised || !e.isAlive?.() || e.downed) continue;
      for (const id of ALARM_TAKERS) {
        const w = this.entity(id);
        if (!w || w.dead || w.downed || !w.isAlive?.() || w.state === 'sleep' || dist(e, w) > WATCH_REACH) continue;
        const r = rec.rumor ? safe(() => this.village?.rumors?.get?.(rec.rumor), null) : null;
        if (r) safe(() => this.village.rumors.hear(r, id, e.id, this.game?.rng));
        this.raiseAlarm(rec, id);
        break;
      }
    }
    // The terrified keep running for the watch while they carry the news.
    for (const e of this.life?.villagers?.() || []) {
      if (!e.terror || this.now() >= e.terror.until || e.mode === 'flee') continue;
      const rec = this.dead[e.terror.about];
      if (!rec || rec.alarm?.raised) continue;
      const to = this.watchFor(e);
      const P = this.game?.player;
      if (to && P && dist(e, to) > 60) safe(() => e.startFlee?.(P, 60, 'crime', { to, quiet: true }));
    }
  }

  setWanted(about, reason = 'murder', seconds = MURDER_WANTED) {
    const P = this.game?.player;
    if (!P) return;
    const t = this.now();
    const until = t + seconds;
    const prev = P.crime;
    P.crime = { level: 3, kind: reason, until: Math.max(until, prev?.until ?? 0), victimId: about, since: prev?.since ?? t, t };
    this.wanted = { about, since: t, reason };
  }

  isWanted() {
    const c = this.game?.player?.crime;
    return !!c && (c.kind === 'murder' || c.kind === 'outside') && c.until > this.now();
  }

  // ------------------------------------------------------------------ bodies

  // Village life's sweep: someone's eyes fell on a body. A body in the open is noticed
  // only with a clear line to it and enough light, and only by someone looking.
  bodySeen(seer, deadId, place) {
    const rec = this.dead[deadId];
    if (!rec) return safe(() => this.life?.bodySeen?.(seer, deadId, place));
    if (rec.foundAt != null || seer === 'player' || rec.hidden || rec.state === 'carried') return;
    // One who saw it done does not "find" the body: they carry the news to the watch (§29.2).
    if ((rec.seen || []).some((s) => s.id === seer)) return;
    const g = this.game;
    const e = this.entity(seer);
    const v = this.entity(deadId);
    if (!e || !v || v.carriedBy) return;
    const L = lightAt(g, v.x, v.y);
    const reach = NOTICE.night + (NOTICE.day - NOTICE.night) * L;
    if (dist(e, v) > reach) return;
    if (!look(g, e, v.x, v.y, { light: L })) return;
    if (seer === 'lyra') {
      Lyra.foundBody(this, rec);
      // She shouts for the watch: the body is found.
      this.found(deadId, 'lyra', place || this.placeOf(v));
      return;
    }
    this.found(deadId, seer, place || this.placeOf(v));
  }

  // A body found: missing becomes murder.
  found(id, finder = null, place = null, { witnessed = false, lake = false } = {}) {
    const rec = this.dead[id];
    if (!rec || rec.foundAt != null) return null;
    const g = this.game;
    const t = this.now();
    const v = this.entity(id);
    rec.foundAt = t;
    rec.foundBy = finder;
    rec.foundPlace = place || (v ? this.placeOf(v) : rec.place);
    rec.state = 'found';
    rec.hidden = null;
    if (v) {
      v.hidden = false;
      if (v.carriedBy) safe(() => g.survival?.endCarry?.(v.carriedBy));
    }
    // Found standing over the body (the stranger, close by, in clear view of the finder).
    const P = g.player;
    const fe = this.entity(finder);
    if (!witnessed && P && v && fe && dist(P, v) <= OVER_BODY) {
      const lk = look(g, fe, P.x, P.y);
      if (lk) rec.clues.push({ kind: 'over_body', by: finder, t: Math.round(t), place: rec.foundPlace, clarity: lk.clarity });
    }
    safe(() => this.life?.onBodyFound?.(id, finder, rec.foundPlace));
    rec.coverAt = t + (witnessed ? 25 : 10);
    rec.chapelAt = t + 1.5 * HOUR;
    rec.newsAt = t + HOUR;
    // Who knows yet (round 14b leftover): the finder. The watch, the funeral and everyone's
    // mourning wait for the news to reach them (tickFoundNews), or the bell within the hour.
    // Witnessed (the alarm is up), or found by the watch itself: the case opens now.
    // Found by the watch itself: they raise the hue at once, and the village knows.
    const watchKnows = witnessed || ALARM_TAKERS.includes(finder) || INVESTIGATORS.includes(finder);
    rec.newsWaits = !watchKnows;
    rec.caseWaits = !watchKnows;
    // The parts of a discovery a handler may take over (onFound), each runnable on its own.
    const defaults = {
      // The finder's cry over the body (their own voice: heard by the hearing rule).
      cry: () => {
        if (!fe || fe === g.companion || witnessed) return;
        this.say(fe, murderLine(finder, lake ? 'lakeGives' : 'foundBody', { about: id, P: this.playerName() }, this.rng()), 'shout');
        safe(() => {
          fe.walker?.stop?.();
          fe.faceToward?.(v.x, v.y);
          if (fe.r) fe.r.key = null;
        });
      },
      note: () => this.event('found', `${finder ? this.name(finder) : 'Someone'} found ${this.name(id)}'s body ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. A blade did it.`, { who: finder, about: id }),
      openCase: () => {
        if (!rec.caseWaits) this.openCase(id);
      },
      // Lyra learns of it as anyone does (DESIGN §29.4): from the finder's own cry when she is
      // near enough to make out the words, else face to face (the village's news of the body
      // reaching her, tickNews), or with everyone else within the hour. Not through two walls
      // the moment someone next door finds it.
      lyra: () => {
        if (finder === 'lyra' || witnessed) return;
        if (this.lyraHearsFinding(fe || v)) Lyra.learnsDeath(this, rec);
        else rec.lyraNewsAt = rec.newsAt;
      },
      toast: () => {
        if (!witnessed) this.toast(`${this.name(id)} has been found dead ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. Struck down with a blade. The watch is asking questions.`, 'warn', `found:${id}`);
      },
      grief: () => (rec.newsWaits ? Grief.mournAs(this, rec, new Set([finder].filter(Boolean))) : Grief.onFound(this, rec)),
    };
    // Who owns this discovery (round 14b, DESIGN §37.3): handlers in order; the first that
    // returns true for a cause it owns takes over the finder's lines, the note, the case,
    // Lyra's learning and the toast (it may call any of ctx.defaults itself). Grief, the
    // funeral and the village's news of the body (life.onBodyFound) happen either way.
    const ctx = { finder, finderEntity: fe || null, body: v || null, place: rec.foundPlace, witnessed, lake, cause: rec.cause || 'killed', murder: this, defaults };
    let owner = null;
    for (const h of this.foundHandlers) {
      if (safe(() => h(rec, ctx), false) === true) {
        owner = h;
        break;
      }
    }
    if (owner) {
      rec.foundOwned = true;
      this.emit('body_found', { id, finder, place: rec.foundPlace, murder: !rec.natural, cause: rec.cause || 'killed', owned: true });
      defaults.grief();
      return rec;
    }
    if (rec.natural) {
      // A death nobody did (die(), §36.3): no case, no blade. Grief and a funeral, all the same.
      this.event('found', `${finder ? this.name(finder) : 'Someone'} found ${this.name(id)} dead ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. There is no mark on ${this.pronoun(id, 'him')}.`, { who: finder, about: id });
      this.emit('body_found', { id, finder, place: rec.foundPlace, murder: false, cause: rec.cause });
      defaults.grief();
      this.toast(`${this.name(id)} has been found dead ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. No mark on ${this.pronoun(id, 'him')}: ${this.pronoun(id, 'his')} time had come.`, 'info', `found:${id}`);
      return rec;
    }
    defaults.cry();
    defaults.note();
    this.emit('body_found', { id, finder, place: rec.foundPlace, murder: true, cause: rec.cause || 'killed' });
    defaults.openCase();
    defaults.grief();
    defaults.lyra();
    defaults.toast();
    return rec;
  }

  // Register who owns the discovery of a body whose cause they know (round 14b, §37.3):
  // handler(rec, ctx) -> true to take it over. ctx: { finder, finderEntity, body, place,
  // witnessed, lake, cause, murder, defaults: { cry, note, openCase, lyra, toast, grief } }.
  // Returns a function that removes the handler. With no handler, found() is unchanged.
  onFound(handler) {
    if (typeof handler !== 'function') return () => {};
    this.foundHandlers.push(handler);
    return () => {
      const i = this.foundHandlers.indexOf(handler);
      if (i >= 0) this.foundHandlers.splice(i, 1);
    };
  }

  // Does Lyra make out the finder's cry ("That's Garrick!") where she is: in the open, or
  // through an open doorway in line with it (src/ai/hearing.js), not through a wall?
  lyraHearsFinding(from) {
    const L = this.game?.companion;
    if (!L || L.dead || this.dead[L.id] || !from || !Number.isFinite(from.x)) return false;
    return safe(() => hears(this.game, L, from.x, from.y, LOUD.shout), null) === 'clear';
  }

  // Can the player do something with this body?
  bodyCanInteract(v, actor) {
    if (!this.isPlayer(actor) || !v?.dead || v.carriedBy || v.hidden) return false;
    const rec = this.dead[v.id];
    if (!rec) return false;
    return true;
  }

  bodyLabel(v) {
    const rec = this.dead[v.id];
    const n = v.name?.split(' ')[0] || 'them';
    if (!rec) return '';
    if (rec.state === 'laid_out' || rec.covered) return `Kneel by ${n}`;
    if (this.game?.player?.carrying) return '';
    // Round 14b: their pockets too (a two-choice prompt, finger-sized: ui/body_view.js).
    return this.canChoose() ? `Search or lift ${n}` : `Lift ${n}`;
  }

  // A browser is up to show the two choices (tests without one lift, as before).
  canChoose() {
    return typeof this.game?.ui?.openModal === 'function' && this.game?.ui?.inited !== false;
  }

  // Search their pockets (round 14b, loot.js): the chest panel on what they carried.
  search(v, actor = this.game?.player) {
    return Loot.search(this, this.entity(v), actor);
  }

  // choice: 'search' | 'lift' | null (ask, when a browser is up; else lift).
  bodyInteract(v, actor, choice = null) {
    const rec = this.dead[v.id];
    if (!rec) return;
    const g = this.game;
    if (rec.state === 'laid_out' || rec.covered) {
      const lines = [`${this.name(v.id)} lies under a linen cloth${rec.state === 'laid_out' ? ' on a bier before the altar' : ''}.`];
      if (rec.state === 'laid_out') lines.push('Someone has left flowers.');
      safe(() => g.ui?.showSign?.(this.name(v.id), lines.join(' ')));
      return;
    }
    if (actor.carrying) return;
    if (choice === 'search') return this.search(v, actor);
    if (choice !== 'lift' && this.canChoose()) {
      const n = v.name?.split(' ')[0] || this.name(v.id);
      const him = pronoun(v.id, 'him');
      const shown = safe(() =>
        openBodyChoice(g, {
          title: n,
          text: `${n} lies still. ${cap(pronoun(v.id, 'he'))} will not get up again.`,
          choices: [
            { id: 'search', label: this.isLyra(v) ? 'Search her pack' : `Search ${pronoun(v.id, 'his')} pockets`, run: () => this.bodyInteract(v, actor, 'search') },
            { id: 'lift', label: `Lift ${him}`, cls: 'btn-ember', run: () => this.bodyInteract(v, actor, 'lift') },
          ],
        }),
      );
      if (shown) return;
    }
    const sv = g.survival;
    if (!sv?.startCarry) return;
    const c = safe(() => sv.startCarry(actor, v, null));
    if (!c) return;
    rec.state = 'carried';
    this.carrying = { id: v.id, seenBy: {}, t: this.now() };
    this.watchUntil = Math.max(this.watchUntil, this.now() + HOUR);
    safe(() => actor.setState?.('work', 0.45));
  }

  // Interact while carrying a body: hide it, or lay it down.
  carrierInteract(player) {
    const v = player?.carrying;
    if (!v || !this.dead[v.id]) return false;
    const spot = hidingPlace(this.game, player.x, player.y);
    this.putDown(player, spot);
    return true;
  }

  promptFor(player) {
    const v = player?.carrying;
    if (!v || !this.dead[v.id]) return null;
    const n = v.name?.split(' ')[0] || 'them';
    const spot = hidingPlace(this.game, player.x, player.y);
    if (spot && HIDE[spot.kind]) return HIDE[spot.kind].label(n);
    return `Put ${n} down`;
  }

  putDown(player, spot) {
    const g = this.game;
    const v = player.carrying;
    const rec = this.dead[v.id];
    safe(() => g.survival?.endCarry?.(player));
    this.carrying = null;
    if (!rec) return;
    rec.state = 'lying';
    rec.x = Math.round(v.x);
    rec.y = Math.round(v.y);
    if (spot && spot.kind !== 'stream') {
      rec.hidden = { kind: spot.kind, t: Math.round(this.now()), place: spot.place || this.placeOf(player), x: Math.round(spot.x), y: Math.round(spot.y) };
      if (spot.kind === 'lake') {
        const [a, b] = HIDE.lake.returnDays;
        rec.hidden.returnsAt = Math.round(this.now() + (a + this.rng()() * (b - a)) * DAY);
      }
      v.hidden = true;
      v.x = rec.hidden.x;
      v.y = rec.hidden.y;
      safe(() => g.audio?.play?.(spot.kind === 'lake' ? 'splash' : 'step', { x: v.x, y: v.y, volume: 0.6 }));
      if (spot.kind === 'lake') safe(() => g.particles?.emit?.('splash', v.x, v.y, { count: 12, speed: 30, life: 0.6 }));
      this.emit('body_hidden', { id: v.id, kind: spot.kind, place: rec.hidden.place });
    } else if (spot?.kind === 'stream') {
      // The stream is too shallow to hide anyone: they lie in the shallows, found by morning.
      rec.streamAt = this.now();
    }
    safe(() => player.setState?.('work', 0.35));
  }

  // While the player carries a body, whoever sees them sees that.
  scanCarry() {
    const g = this.game;
    const P = g.player;
    const v = P?.carrying;
    if (!v || !this.dead[v.id]) {
      this.carrying = null;
      return;
    }
    const rec = this.dead[v.id];
    const c = this.carrying || (this.carrying = { id: v.id, seenBy: {}, t: this.now() });
    for (const w of witnessesOf(g, P.x, P.y, { exclude: [v.id] })) {
      if (w.id === 'lyra') {
        if (!c.seenBy.lyra) {
          c.seenBy.lyra = w.clarity;
          Lyra.sawCarry(this, rec, w.clarity);
        }
        continue;
      }
      if (c.seenBy[w.id] === 'clear' || (c.seenBy[w.id] && w.clarity !== 'clear')) continue;
      c.seenBy[w.id] = w.clarity;
      const t = Math.round(this.now());
      const place = this.placeOf(P);
      rec.clues.push({ kind: 'carry', by: w.id, t, place, clarity: w.clarity, heading: null });
      if (w.clarity === 'clear') {
        // They know that face, and that body: the cry goes up.
        const e = this.entity(w.id);
        this.say(e, murderLine(w.id, 'seenCarryClear', { about: v.id, P: this.playerName() }, this.rng()), 'shout');
        safe(() => e?.startFlee?.(P, 10, 'crime'));
        // Known now, by them: the rest as for a killing seen (news by meeting, §29.2).
        rec.seen = [...(rec.seen || []).filter((s) => s.id !== w.id), { id: w.id, clarity: 'clear', d: Math.round(dist(e, P)) }];
        if (c.seenBy.lyra) rec.lyraTold = true;
        rec.known = 'witnessed';
        rec.alarm = rec.alarm || { raised: false, by: null, t: null };
        this.terrify(e, rec);
        const r = safe(() => this.village?.addRumor?.('murder', { victim: v.id, witnesses: [w.id], saw: [w.id], source: w.id }), null);
        rec.rumor = rec.rumor || r?.id || null;
        if (ALARM_TAKERS.includes(w.id)) this.raiseAlarm(rec, w.id, { saw: true });
        else this.toast(`${this.name(w.id)} saw you carrying ${this.name(v.id)}'s body, and is running for the watch.`, 'warn', 'murder');
        return;
      }
    }
  }

  // ------------------------------------------------------------------ the case

  openCase(id) {
    const rec = this.dead[id];
    if (!rec) return null;
    let c = this.cases[id];
    if (!c) {
      // Quick when the watch knows who did it; a mystery's pace while the witness is still
      // on their way to tell them (§29.2).
      const known = rec.known === 'witnessed' && (!rec.alarm || rec.alarm.raised);
      c = this.cases[id] = { about: id, opened: Math.round(this.now()), day: this.day(), lead: this.investigator(id), suspicion: 0, level: 'none', evidence: [], state: 'open', questionedAt: null, askAt: Math.round(this.now() + (known ? 0.2 : 1.2) * HOUR), verdict: null, outside: false };
      const loc = safe(() => this.game?.locations?.get?.(rec.foundPlace || rec.place), null);
      c.outside = !!loc && (loc.danger ?? 0) >= 2;
      this.emit('murder_case', { about: id, lead: c.lead });
    }
    this.weigh(id);
    return c;
  }

  investigator(except = null) {
    for (const id of INVESTIGATORS) {
      if (id === except || this.dead[id]) continue;
      const e = this.entity(id);
      if (e && !e.removed) return id;
    }
    return null;
  }

  // Gather again and weigh: the suspicion a case holds right now.
  weigh(id) {
    const c = this.cases[id];
    const rec = this.dead[id];
    if (!c || !rec) return 0;
    c.evidence = gatherEvidence(this, rec).map(({ key, kind, by, w, t, place, text }) => ({ key, kind, by, w, t, place, text }));
    c.suspicion = suspicionOf(c.evidence, { outside: c.outside });
    c.level = levelOf(c.suspicion);
    if (!c.lead || this.dead[c.lead]) c.lead = this.investigator(id);
    return c.suspicion;
  }

  // The village's lies table (village_life claims) about one person.
  claimsAbout(id) {
    const out = [];
    for (const cl of this.life?.claims || []) if (cl?.about === id) out.push(cl);
    return out;
  }

  // Harm the stranger did the dead before, as the village knows it.
  priorHarm(id) {
    const out = [];
    const rs = this.village?.rumors?.list || [];
    const before = (this.dead[id]?.t ?? Infinity) - 30;
    for (const r of rs) {
      if (r.victim !== id || !(r.t < before)) continue;
      if (r.kind === 'downed_villager' || r.kind === 'attacked_villager') out.push({ kind: 'violence', by: r.source || 'village', t: r.t, text: `Everyone knows ${this.playerName()} ${r.kind === 'downed_villager' ? 'beat' : 'struck'} ${this.name(id)} before.` });
      else if (r.kind === 'threat') out.push({ kind: 'threat', by: r.source || id, t: r.t, text: `${this.playerName()} threatened ${this.name(id)}.` });
    }
    return out.slice(0, 2);
  }

  // The watch questions the player (the UI asks; tests answer directly).
  startQuestioning(id, by = null) {
    const c = this.cases[id];
    const rec = this.dead[id];
    if (!c || !rec || this.session) return null;
    this.weigh(id);
    const lead = by || c.lead || this.investigator(id);
    if (!lead) return null;
    const qs = buildQuestions(this, rec, c.evidence);
    this.session = { about: id, by: lead, i: 0, questions: qs, log: [], done: false, outcome: null };
    c.state = 'questioning';
    c.questionedAt = Math.round(this.now());
    const e = this.entity(lead);
    safe(() => {
      e?.walker?.stop?.();
      e?.faceToward?.(this.game.player.x, this.game.player.y);
      if (e) e.talkingUntil = this.now() + 30;
    });
    const s = this.session;
    s.opening = watchLine(lead, 'open', { about: id, P: this.playerName() }, this.rng());
    this.emit('questioned', { about: id, by: lead });
    return s;
  }

  // The current question: { text, options: [{ id, label }] }.
  question() {
    const s = this.session;
    if (!s || s.done) return null;
    const q = s.questions[s.i];
    if (!q) return null;
    const text = watchLine(s.by, q.key, { about: s.about, P: this.playerName(), ...q.vars }, this.rng());
    return { id: q.id, text, options: q.options.map((o) => ({ id: o.id, label: o.label })) };
  }

  // The player answers. -> { reply, done, outcome? }
  answer(optId) {
    const s = this.session;
    if (!s || s.done) return null;
    const c = this.cases[s.about];
    const rec = this.dead[s.about];
    const q = s.questions[s.i];
    const opt = q?.options.find((o) => o.id === optId) || q?.options[0];
    if (!q || !c || !rec) return null;
    const r = judgeAnswer(this, rec, c.evidence, q, opt);
    if (r.add) rec.answers.push({ ...r.add, t: Math.round(this.now()) });
    let reply = watchLine(s.by, r.reply, { about: s.about, P: this.playerName(), from: r.caught ? this.name(r.caught) : 'someone' }, this.rng());
    s.log.push({ q: q.id, a: opt.id, kind: opt.kind, reply });
    // What the stranger said is known now: a lie the watch caught becomes news.
    if (r.reply === 'caught') safe(() => this.village?.addRumor?.('lied_about', { victim: s.about, witnesses: [s.by, r.caught].filter(Boolean), source: s.by }));
    this.weigh(s.about);
    if (opt.kind === 'confess' || r.reply === 'confess') {
      s.done = true;
      s.outcome = 'arrest';
      c.confessed = true;
      Lyra.onConfession(this, rec, 'watch');
    } else {
      s.i++;
      if (s.i >= s.questions.length) {
        s.done = true;
        s.outcome = c.suspicion >= 0.6 ? 'arrest' : 'free';
        reply = `${reply} ${watchLine(s.by, s.outcome === 'arrest' ? 'arrest' : 'free', { about: s.about }, this.rng())}`;
      }
    }
    if (s.done) this.endQuestioning();
    return { reply, done: s.done, outcome: s.outcome, suspicion: c.suspicion, level: c.level };
  }

  endQuestioning() {
    const s = this.session;
    if (!s) return;
    const c = this.cases[s.about];
    if (c) c.state = s.outcome === 'arrest' ? 'arrest' : 'watched';
    this.session = null;
    this.lastSession = s;
    const e = this.entity(s.by);
    if (e) e.talkingUntil = this.now() + 2;
    if (s.outcome === 'arrest') this.arrestOffer(s.by, s.about);
    else if (c) {
      safe(() => this.village?.addRumor?.('questioned', { victim: s.about, witnesses: [s.by], source: s.by }));
      Lyra.afterQuestioning(this, c);
    }
  }

  // "You're coming with me." Go quietly, or run.
  arrestOffer(by, about) {
    const g = this.game;
    this.arrestAskedAt = this.now();
    const name = this.name(by);
    const text = `${name}: "${watchLine(by, 'arrest', { about }, this.rng())}"`;
    const ask = this.view?.arrest ? this.view.arrest({ by, about, text }) : g.ui?.confirm ? g.ui.confirm({ title: 'The watch', text, yes: 'Go quietly', no: 'Run', danger: false }) : Promise.resolve(true);
    return Promise.resolve(ask).then((quiet) => {
      if (quiet) return this.surrender(about, by);
      this.setWanted(about, 'murder');
      this.say(this.entity(by), by === 'rowan' ? 'STOP! Wys! With me!' : 'Stop! STOP!', 'shout');
      // Run: the chase is on from here (round 14b).
      safe(() => {
        const rec = this.dead[about];
        if (rec && (!this.hunt || this.hunt.state === 'over')) Hunt.startHunt(this, rec, by);
        Hunt.lost(this, this.entity(by), g.player);
      });
      this.emit('crime', { actor: g.player, victim: this.entity(about), kind: 'murder', witnesses: [by] });
      return false;
    });
  }

  // The player gives themselves up: the Moot sits.
  surrender(about = this.wanted?.about, by = null) {
    const g = this.game;
    about = about || this.latestKnownDeath();
    if (!about) return false;
    const c = this.cases[about] || this.openCase(about);
    if (c) c.state = 'arrest';
    safe(() => g.combat?.clearCrime?.(g.player, 'arrested'));
    if (g.player?.crime) g.player.crime = null;
    this.emit('arrested', { about, by });
    return Grief.trial(this, about);
  }

  latestKnownDeath() {
    let best = null;
    for (const r of Object.values(this.dead)) if ((r.known || r.foundAt != null) && (!best || r.t > best.t)) best = r;
    return best?.id || null;
  }

  // ------------------------------------------------------------------ the frame

  update(dt) {
    const g = this.game;
    if (!g || (g.state && g.state !== 'playing')) return;
    this.layer.follow(g);
    this.updateHold(dt);
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = TICK;
      safe(() => this.tick());
    }
    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = SLOW;
      safe(() => this.slowTick());
    }
  }

  tick() {
    const g = this.game;
    safe(() => this.tickNews());
    safe(() => this.tickFoundNews());
    if (g.player?.carrying && this.dead[g.player.carrying.id]) this.scanCarry();
    else if (this.carrying) this.carrying = null;
    // A fallen victim tells whoever reaches them.
    for (const id of Object.keys(this.pending)) {
      const v = this.entity(id);
      if (!v || v.dead) {
        delete this.pending[id];
        continue;
      }
      // Held silent (round 14b, §37.2): they can tell nobody while it lasts.
      if (isSilenced(g, v)) continue;
      // One of the watch knows it the moment it happens to them.
      if (!v.downed && ALARM_TAKERS.includes(id)) {
        this.reveal(id, id);
        continue;
      }
      let told = false;
      for (const e of [...(this.life?.villagers?.() || []), g.companion]) {
        if (!e || e === v || !e.isAlive?.() || this.dead[e.id] || e.state === 'sleep' || dist(e, v) > TELL_REACH) continue;
        // Words, face to face: not through a wall (src/ai/hearing.js).
        if (!safe(() => hearsWords(g, e, v, TELL_REACH), true)) continue;
        this.reveal(id, e.id);
        told = true;
        break;
      }
      // Still standing and nobody to tell (round 14b leftover: never at once): they go to
      // the watch on their own feet, and tell whoever they meet on the way.
      if (!told && !v.downed && !this.pending[id]?.walking) {
        const to = this.watchFor(v);
        const P = g.player;
        if (to && P) {
          this.pending[id].walking = true;
          safe(() => v.startFlee?.(P, 90, 'crime', { to, quiet: true }));
        }
      }
    }
    safe(() => this.tireFlight());
  }

  // Lyra running from the stranger tires (round 14b, V-7: "she just runs away … why can't I
  // kill her?"). Her flight runs at 1.45 of her 80 (116 px/s) against the stranger's 76: after
  // WINDED_AFTER seconds she is winded to WINDED of her pace (about 64 px/s) until she has
  // stopped running a while. Villagers already run slower than the stranger (40 x 1.75).
  // Verify-b: not only a flight. Struck, she leaves you or keeps her distance (keep_away, or
  // her own day with the stranger avoided), and steps away from them at up to 1.3 of her pace:
  // running from a stranger close behind her, by any reason, tires her the same way.
  tireFlight() {
    const g = this.game;
    const L = lyraOf(g);
    if (!L || L.dead || this.dead[L.id]) return;
    const d = L.behavior?.directive;
    const P = g.player;
    const fromP = (w) => w === 'player' || (!!P && (w === P.id || w === P));
    const last = L._tfAt;
    L._tfAt = { x: L.x, y: L.y };
    let avoiding = false;
    if (!L.downed && P && last && (d?.type === 'keep_away' ? fromP(d.from) : d?.type === 'independent' && fromP(d.avoid))) {
      const mx = L.x - last.x;
      const my = L.y - last.y;
      const moved = Math.hypot(mx, my);
      const gap = Math.hypot(L.x - P.x, L.y - P.y);
      // Running (not strolling), away from the stranger, who is close behind.
      avoiding = moved / TICK > 40 && gap < 8 * TILE && (mx * (L.x - P.x) + my * (L.y - P.y)) / (moved * Math.max(1, gap)) > 0.3;
    }
    const fleeing = !L.downed && ((d?.type === 'flee' && fromP(d.from)) || avoiding);
    // Her pace is the stat pipeline's (game.stats writes a managed actor's speed every frame,
    // so a pace changed by hand never lasted a frame): winded is a modifier on it.
    const managed = !!safe(() => g.stats?.isManaged?.(L), false);
    if (fleeing) {
      L._fleeT = (L._fleeT || 0) + TICK;
      if (L._fleeT >= WINDED_AFTER && L._windedFrom == null) {
        L._windedFrom = L.speed;
        if (managed) safe(() => g.stats.addModifier(L, { id: 'winded', source: 'winded', label: 'Winded', kind: 'weak', mul: { speed: WINDED }, t: 90 }));
        else L.speed = Math.round(L.speed * WINDED);
        L._restT = 0;
        safe(() => g.bus?.emit?.('winded', { entity: L }));
      }
      return;
    }
    L._fleeT = Math.max(0, (L._fleeT || 0) - TICK);
    if (L._windedFrom != null) {
      L._restT = (L._restT || 0) + TICK;
      if (L._restT >= WINDED_REST) {
        if (managed) safe(() => g.stats.removeModifier(L, 'winded'));
        else L.speed = L._windedFrom;
        L._windedFrom = null;
      }
    }
  }

  slowTick() {
    const t = this.now();
    for (const rec of Object.values(this.dead)) {
      const v = this.entity(rec.id);
      if (!v) continue;
      if (v.draw?.name !== 'drawDead') this.layBody(v, rec);
      // Someone covers them, a little after they are found.
      if (rec.foundAt != null && !rec.covered && t >= (rec.coverAt ?? 0)) {
        rec.covered = true;
        const near = this.nearestAlive(v, 120);
        if (near && this.visible(v, 60)) this.say(near, murderLine(near.id, 'cover', { about: rec.id }, this.rng()));
      }
      // The lake gives back what it takes.
      if (rec.hidden?.kind === 'lake' && rec.foundAt == null && t >= (rec.hidden.returnsAt ?? Infinity)) Grief.lakeGivesBack(this, rec);
      // Washed up on the shore: whoever walks it first in the morning finds it.
      if (rec.washedUp != null && rec.foundAt == null && ((this.hour() >= 6 && this.hour() < 10) || t - rec.washedUp > 0.5 * DAY)) Grief.shoreFinder(this, rec);
      // The stream is no hiding place: found by morning.
      if (rec.streamAt != null && rec.foundAt == null && t - rec.streamAt > 0.4 * DAY) Grief.foundByChance(this, rec, 'stream');
      // The watch lays the body out in the chapel.
      if (rec.state === 'found' && t >= (rec.chapelAt ?? Infinity) && (!this.visible(v, 40) || t - rec.chapelAt > HOUR)) Grief.layOut(this, rec);
      // Everyone knows within the hour of a finding (the bell, the chapel).
      if (rec.newsAt != null && t >= rec.newsAt) {
        rec.newsAt = null;
        const waited = rec.newsWaits;
        rec.newsWaits = false;
        Grief.everyoneKnows(this, rec);
        if (rec.caseWaits) {
          rec.caseWaits = false;
          if (!rec.natural && !rec.foundOwned) this.openCase(rec.id);
        }
        if (waited) Grief.onFound(this, rec);
      }
      // The news of a body found reaches her with everyone's, if no one told her sooner.
      if (rec.lyraNewsAt != null && t >= rec.lyraNewsAt) {
        rec.lyraNewsAt = null;
        Lyra.learnsDeath(this, rec);
      }
      if (rec.lyraHearsAt != null && t >= rec.lyraHearsAt) {
        rec.lyraHearsAt = null;
        Lyra.hearsOfMurder(this, rec);
      }
    }
    Grief.searchesFind(this);
    Grief.tickFunerals(this);
    Grief.tickMoots(this);
    this.tickCases();
    this.tickArrest();
    this.tickCustody();
    Lyra.tick(this);
    Grief.tickOutside(this);
    safe(() => Hunt.tickHunt(this));
  }

  // Is a posse out for the stranger (talk's afraid dialog offers "Give yourself up")?
  isHunted() {
    return Hunt.active(this);
  }

  // The hunt's part in a posse member's day, and their lifted leash (npc.js asks).
  chaseOf(npc, target) {
    return Hunt.chaseOf(this, npc, target);
  }

  lostSight(npc, target) {
    return Hunt.lost(this, npc, target);
  }

  nearestAlive(v, r) {
    let best = null;
    let bd = r;
    for (const e of this.life?.villagers?.() || []) {
      if (!e.isAlive?.() || e === v) continue;
      const d = dist(e, v);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // The watch comes to ask the stranger, once a case has something to ask about.
  tickCases() {
    const g = this.game;
    const P = g.player;
    if (!P || this.session || this.isWanted() || !this.quiet()) return;
    const t = this.now();
    for (const c of Object.values(this.cases)) {
      if (c.state !== 'open') continue;
      if (t < c.askAt) continue;
      this.weigh(c.about);
      if (c.suspicion < 0.15) {
        c.askAt = t + DAY;
        continue;
      }
      const lead = this.entity(c.lead);
      if (!lead || !lead.isAlive?.()) continue;
      c.seeking = true;
      if (dist(lead, P) <= 56 && !P.downed && !P.carrying) {
        c.seeking = false;
        this.beginQuestioningUI(c.about);
        return;
      }
      // Kept away from the watch for half a day: that is noticed too.
      if (t - c.askAt > 0.5 * DAY && !c.avoided) {
        c.avoided = true;
        this.dead[c.about]?.answers.push({ kind: 'avoided', w: WEIGHTS.avoided, t: Math.round(t), text: `${this.playerName()} kept out of the watch's way.` });
      }
    }
  }

  // Nothing else on screen: no scene playing, no panel open, the player on their feet.
  quiet() {
    const g = this.game;
    if (g.state !== 'playing' || g.paused) return false;
    if (safe(() => g.story?.isPlaying?.(), false)) return false;
    if (safe(() => g.ui?.isModalOpen?.(), false)) return false;
    if (safe(() => g.ui?.chat?.isOpen?.(), false)) return false;
    return true;
  }

  beginQuestioningUI(id) {
    const s = this.startQuestioning(id);
    if (!s) return;
    if (this.view?.question) this.view.question(this);
  }

  // A guard who reaches the wanted stranger tells them to come quietly.
  tickArrest() {
    const g = this.game;
    const P = g.player;
    if (!P || !this.isWanted() || P.downed || !this.quiet() || this.now() - this.arrestAskedAt < 50) return;
    if (P.crime?.kind === 'outside') return;
    for (const id of ['rowan', 'wys']) {
      const e = this.entity(id);
      if (!e || !e.isAlive?.() || dist(e, P) > 44) continue;
      if (!look(g, e, P.x, P.y)) continue;
      this.arrestOffer(id, this.wanted?.about || this.latestKnownDeath());
      return;
    }
  }

  onTended(p) {
    if (!p?.arrested) return;
    const about = this.wanted?.reason === 'murder' ? this.wanted.about : null;
    if (about && this.dead[about] && !this.cases[about]?.verdict) this.trialPending = { about, t: Math.round(this.now()) };
  }

  // Beaten down by the watch while wanted (player.js settles a lesser crime "where you
  // fell"): for a killing, the Moot sits once the stranger is on their feet again. Outside,
  // the watch only drives them back to the road.
  onCrimeCleared(p) {
    if (!this.isPlayer(p?.actor) || p.reason !== 'arrested') return;
    const P = this.game?.player;
    if (this.outside && this.now() < this.outside.until) {
      if (P) P.crime = { level: 3, kind: 'outside', until: this.outside.until, victimId: this.outside.about, since: this.now(), t: this.now() };
      this.outsideAgain = true;
      return;
    }
    const about = this.wanted?.reason === 'murder' ? this.wanted.about : null;
    if (about && this.dead[about] && !this.cases[about]?.verdict) this.trialPending = { about, t: Math.round(this.now()) };
  }

  // On their feet, nothing else on screen: what the watch was waiting for happens now.
  tickCustody() {
    const P = this.game?.player;
    if (!P || P.downed || P.state === 'sleep' || safe(() => this.game.survival?.isFallen?.(P), false) || !this.quiet()) return;
    if (this.trialPending) {
      const { about } = this.trialPending;
      this.trialPending = null;
      Grief.trial(this, about);
      return;
    }
    if (this.outsideAgain) {
      this.outsideAgain = false;
      Grief.walkOut(this);
      this.toast('The watch walked you back out to the road. Your days outside are not done.', 'warn', 'outside');
    }
  }

  onNewDay() {
    Grief.onNewDay(this);
  }

  // ------------------------------------------------------------------ npc hooks

  entryFor(npc, entry, hour) {
    return Grief.entryFor(this, npc, entry, hour) || Hunt.entryFor(this, npc, entry, hour) || safe(() => this.game.occupation?.entryFor?.(npc, entry, hour), null);
  }

  dialogOptions(npc) {
    return Grief.dialogOptions(this, npc);
  }

  dialogOption(npc, key) {
    return Grief.dialogOption(this, npc, key);
  }

  decorateDialogue(npc, d) {
    return Grief.decorateDialogue(this, npc, d);
  }

  toneFor(npc) {
    return Grief.toneFor(this, npc);
  }

  refusesTrade(npc) {
    // A burned store sells nothing (round 14b, world/occupation.js).
    if (npc?.id && safe(() => this.game.occupation?.shopClosed?.(npc.id), false)) return true;
    return Grief.refusesTrade(this, npc);
  }

  flameBarred() {
    const b = this.game?.flags?.flameBarredUntil;
    return Number.isFinite(b) && this.day() < b;
  }

  standIn(giver) {
    return Grief.standIn(this, giver);
  }

  epitaph(id) {
    return Grief.epitaph(this, id);
  }

  promptContext() {
    return Lyra.promptContext(this);
  }

  // ------------------------------------------------------------------ graves

  addGrave(g) {
    const game = this.game;
    if (!game?.entities?.add) return;
    let ent = this._graveEnts.get(g.about);
    if (!ent) {
      ent = new Grave(game, { about: g.about, name: game.entities.get?.(g.about)?.name || this.name(g.about), x: g.x, y: g.y, day: g.day });
      this._graveEnts.set(g.about, ent);
      game.entities.add(ent);
    }
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    return {
      v: 1,
      dead: this.dead,
      pending: this.pending,
      cases: this.cases,
      wanted: this.wanted,
      outside: this.outside,
      funerals: this.funerals,
      moots: this.moots,
      graves: this.graves,
      lyra: this.lyra,
      watchUntil: Number.isFinite(this.watchUntil) ? this.watchUntil : null,
      trialPending: this.trialPending || null,
      witnessedBy: this.witnessedBy,
      hunt: Hunt.serializeHunt(this.hunt),
      terror: Object.fromEntries((this.life?.villagers?.() || []).filter((e) => e.terror && this.now() < e.terror.until).map((e) => [e.id, e.terror])),
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    this.dead = obj(d.dead);
    this.pending = obj(d.pending);
    this.cases = obj(d.cases);
    this.wanted = d.wanted || null;
    this.outside = d.outside || null;
    this.funerals = Array.isArray(d.funerals) ? d.funerals : [];
    this.moots = Array.isArray(d.moots) ? d.moots : [];
    this.graves = Array.isArray(d.graves) ? d.graves : [];
    this.lyra = obj(d.lyra);
    this.watchUntil = Number.isFinite(d.watchUntil) ? d.watchUntil : -Infinity;
    this.witnessedBy = obj(d.witnessedBy);
    this.hunt = Hunt.deserializeHunt(d.hunt);
    for (const [id, tr] of Object.entries(obj(d.terror))) {
      const e = this.entity(id);
      if (e && tr && Number.isFinite(tr.until)) e.terror = tr;
    }
    for (const [id, n] of Object.entries(this.witnessedBy)) {
      const e = this.entity(id);
      if (e && n >= DREAD_AFTER) e.dread = true;
    }
    this.trialPending = d.trialPending && typeof d.trialPending.about === 'string' ? d.trialPending : null;
    // The dead stay dead.
    for (const rec of Object.values(this.dead)) {
      for (const k of ['clues', 'after', 'answers', 'seen']) if (!Array.isArray(rec[k])) rec[k] = [];
      if (!rec.snap) rec.snap = { victim: [], player: [] };
      const v = this.entity(rec.id);
      if (!v) continue;
      if (rec.state === 'carried') rec.state = 'lying';
      const at = rec.state === 'laid_out' ? rec.bier : rec.hidden ? rec.hidden : { x: rec.x, y: rec.y };
      if (at && Number.isFinite(at.x)) {
        v.x = at.x;
        v.y = at.y;
      }
      // Old saves: no cause (a killing), no by or provoked (unknown), marked, not silent.
      if (typeof rec.cause !== 'string' || !rec.cause) rec.cause = 'killed';
      if (rec.by === undefined) rec.by = null;
      if (rec.provoked === undefined) rec.provoked = null;
      rec.silent = !!rec.silent;
      rec.unmarked = !!rec.unmarked;
      rec.natural = !!rec.natural;
      v.absent = { cause: rec.cause, since: rec.t };
      if (rec.silent) silence(this.game, v, Infinity);
      this.layBody(v, rec);
      if (rec.state === 'buried') v.hidden = true;
    }
    for (const gr of this.graves) this.addGrave(gr);
    // The shop and the forge stay with whoever took them on.
    safe(() => Grief.applyHeirs(this));
  }
}

export { whenPhrase };
