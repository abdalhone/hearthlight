// Killing, witnesses, bodies and what the village can know (DESIGN §29). `game.murder`.
//
// The author: "if I killed someone without nobody seeing it, nobody should know… they
// would feel that he's missing." So knowledge is the whole of it: a blow is known to those
// who could see it (witness.js: sight, light, distance, walls, night) and to the one who
// took it, who tells the first person who reaches them and the watch once they are up.
// A finishing blow on a fallen villager kills them for good (never Lyra, never a child).
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
// Events: villager_killed, murder_witnessed, body_hidden, body_found, murder_case,
// questioned, arrested, moot_verdict, funeral, moot_met.

import { TILE } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { placeAt, placePhrase, pronoun } from '../ai/village_life/errands_data.js';
import { whenPhrase } from '../ai/village_life/problems.js';
import { witnessesOf, look, lightAt } from './witness.js';
import { UNKILLABLE, FINISH_HOLD, FINISH_REACH, FINISH_CANCEL, MURDER_WANTED, HOUR, DAY, HIDE, hidingPlace, INVESTIGATORS, levelOf } from './data.js';
import { gatherEvidence, suspicionOf, buildQuestions, judgeAnswer, WEIGHTS } from './investigation.js';
import { murderLine, watchLine } from './lines.js';
import { drawBody, MurderLayer, Grave } from './draw.js';
import * as Grief from './grief.js';
import * as Lyra from './lyra.js';

const TICK = 0.5;
const SLOW = 1;
const TELL_REACH = 44; // px: someone this close to a fallen victim hears who did it
const NOTICE = { day: 120, night: 46 }; // px a body lying in the open is noticed from
const OVER_BODY = 70; // px: found standing this close to the body

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
    }
    this.attach();
    this.installPlugin();
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
    if (id === 'lyra') return this.game?.companion || null;
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

  // Dead, and the village knows it (a body was found, or someone saw it happen).
  knownDead(id) {
    const r = this.dead[id];
    return !!r && (r.foundAt != null || r.known === 'witnessed');
  }

  isVillager(e) {
    return !!e && VILLAGERS.includes(e.id) && !!e.profile;
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
    safe(() => c._reportCrime?.(P, v, p.kind));
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

  // The downed villager within reach in front of the player, or null.
  finishTarget(player) {
    const list = safe(() => this.game.entities.query(player.x, player.y, FINISH_REACH + 6), []) || [];
    let best = null;
    let bs = Infinity;
    const fx = player.facing?.x ?? 0;
    const fy = player.facing?.y ?? 1;
    for (const e of list) {
      if (e === player || !e.downed || e.dead || e.carriedBy || e.removed || e.absent) continue;
      if (!(this.isVillager(e) || e === this.game.companion)) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > FINISH_REACH) continue;
      const score = d - (d > 0 ? ((dx * fx + dy * fy) / d) * 10 : 10);
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
    if (UNKILLABLE.has(v.id) || v === this.game.companion) {
      this.refuse(player, v);
      return true;
    }
    player.faceToward?.(v.x, v.y);
    this.hold = { target: v, t: 0, need: FINISH_HOLD, paused: false, startedAt: this.now() };
    if (!this.game.flags?.finisherWarned) {
      this.hold.paused = true;
      this.warn(v);
      return true;
    }
    this.holdBegins(v);
    return true;
  }

  // Never Lyra; never a child. The sword will not go there.
  refuse(player, v) {
    const now = this.game?.time ?? 0;
    if (now - (this._refusedAt ?? -Infinity) < 6) return;
    this._refusedAt = now;
    const text = v === this.game.companion ? 'No. Not her. Never her.' : 'No. Not a child.';
    safe(() => this.game.bubbles?.say?.(player, text, { kind: 'whisper' }));
  }

  // The first time: what this is, plainly.
  warn(v) {
    const g = this.game;
    const name = v.name?.split(' ')[0] || 'them';
    const text = `${name} is lying helpless. Strike now and ${pronoun(v.id, 'he')} will die, for good: no flame, no rescue and no save brings the dead back. Anyone who sees it will know you for a murderer. Anyone who doesn't will only know ${pronoun(v.id, 'he')} is gone.`;
    const ask = g.ui?.confirm ? g.ui.confirm({ title: 'A killing blow', text, yes: 'I understand', no: 'Lower the sword', danger: true }) : Promise.resolve(true);
    Promise.resolve(ask).then(
      (yes) => {
        g.flags = g.flags || {};
        if (yes) {
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
    safe(() => g.audio?.play?.('heartbeat', { volume: 0.5 }));
    // Lyra, if she sees it start, cries out (she cannot stop a blow already falling).
    const L = g.companion;
    if (L && !L.downed && look(g, L, v.x, v.y)) Lyra.sawHold(this, v);
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

  strike(P, v) {
    const g = this.game;
    safe(() => P.setState?.('attack', 0.4));
    safe(() => g.audio?.play?.('hit', { x: v.x, y: v.y, volume: 0.9, pitch: 0.55 }));
    safe(() => g.camera?.shake?.(2.5, 0.25));
    g.hitStop = Math.max(g.hitStop || 0, 0.3);
    return this.kill(v, P);
  }

  // ------------------------------------------------------------------ a death

  canKill(v) {
    return !!v && this.isVillager(v) && !UNKILLABLE.has(v.id) && !v.dead && !this.dead[v.id];
  }

  // Kill a villager for good. Returns the record, or null.
  kill(v, killer = this.game?.player) {
    v = this.entity(v);
    if (!this.canKill(v)) return null;
    const g = this.game;
    const t = this.now();
    const place = this.placeOf(v);
    const seen = witnessesOf(g, v.x, v.y, { exclude: [v.id] });
    if (killer) for (const w of witnessesOf(g, killer.x, killer.y, { exclude: [v.id] })) if (!seen.some((s) => s.id === w.id)) seen.push(w);
    const sv = g.survival;
    if (v.carriedBy) safe(() => sv?.endCarry?.(v.carriedBy));
    safe(() => sv?.resolveFall?.(v, 'died'));
    safe(() => sv?.patients?.delete?.(v));
    safe(() => g.combat?.downedAt?.delete?.(v));
    delete this.pending[v.id];
    const rec = {
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
      snap: this.snapshot(v.id, t),
    };
    this.dead[v.id] = rec;
    // Out of the village's life (errands, problems, conversations), the body left where it fell.
    safe(() => this.life?.markGone?.(v.id, { cause: 'killed', seen: seen.map((s) => s.id), at: { place }, keepBody: true }));
    this.layBody(v, rec);
    this.emit('villager_killed', { id: v.id, entity: v, killer, witnesses: seen.map((s) => s.id), place, x: v.x, y: v.y });
    safe(() => g.particles?.emit?.('dust', v.x, v.y, { count: 6, speed: 14, life: 0.6 }));
    if (seen.length) this.seenMurder(rec);
    else this.watchUntil = t + HOUR;
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
    if (!v.absent) v.absent = { cause: 'killed', since: rec.t };
    v.state = 'dead';
    v.hidden = !!rec.hidden || rec.state === 'buried';
    v.solid = false;
    const m = this;
    v.draw = function drawDead(ctx, ox, oy, time) {
      drawBody(this, m.dead[this.id] || rec, ctx, ox, oy, time);
    };
    safe(() => this.game?.bubbles?.clear?.(v));
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
      if (t - rec.t > HOUR || rec.known) continue;
      const last = rec.after[rec.after.length - 1];
      if (last && last.by === by && t - last.t < HOUR / 4) continue;
      if (rec.after.length >= 24) continue;
      rec.after.push({ by, t: Math.round(t), place: this.placeOf(P), carrying: !!P.carrying });
    }
  }

  // ------------------------------------------------------------------ seen

  seenMurder(rec) {
    const g = this.game;
    const v = this.entity(rec.id);
    const P = g.player;
    const clear = rec.seen.filter((s) => s.clarity === 'clear');
    rec.known = 'witnessed';
    this.setWanted(rec.id, 'murder');
    // The cries: the nearest few who saw it.
    let n = 0;
    for (const s of rec.seen) {
      if (s.id === 'lyra') continue;
      const e = this.entity(s.id);
      if (!e) continue;
      if (n < 3) this.say(e, murderLine(s.id, s.clarity === 'clear' ? 'alarm' : 'alarmGlimpse', { about: rec.id, P: this.playerName() }, this.rng()), 'shout');
      n++;
      safe(() => e.startFlee?.(P, 12, 'crime'));
    }
    this.emit('crime', { actor: P, victim: v, kind: 'murder', witnesses: rec.seen.map((s) => s.id) });
    this.emit('murder_witnessed', { id: rec.id, witnesses: rec.seen, clear: clear.map((s) => s.id) });
    safe(() => g.audio?.play?.('bell', { volume: 0.7 }));
    this.event('murder', `${this.playerName()} killed ${this.name(rec.id)} ${placeAt(rec.place, this.placeName(rec.place))}. ${rec.seen.filter((s) => s.id !== 'lyra').map((s) => this.name(s.id)).join(', ') || 'Lyra'} saw it.`, { who: 'player', about: rec.id });
    // Those who saw found the body.
    const finder = rec.seen.find((s) => s.id !== 'lyra')?.id || rec.seen[0]?.id || null;
    this.found(rec.id, finder, rec.place, { witnessed: true });
    // The village turns.
    Grief.villageTurns(this, rec);
    // Lyra: there, or soon told.
    if (rec.seen.some((s) => s.id === 'lyra')) Lyra.witnessed(this, rec);
    else rec.lyraHearsAt = this.now() + 20;
    this.toast(`${this.name(rec.id)} is dead, and ${rec.seen.length > 1 ? 'people' : this.name(rec.seen[0].id)} saw you do it. The watch is coming.`, 'warn', 'murder');
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
    if (fe && fe !== g.companion && !witnessed) {
      this.say(fe, murderLine(finder, lake ? 'lakeGives' : 'foundBody', { about: id, P: this.playerName() }, this.rng()), 'shout');
      safe(() => {
        fe.walker?.stop?.();
        fe.faceToward?.(v.x, v.y);
        if (fe.r) fe.r.key = null;
      });
    }
    rec.coverAt = t + (witnessed ? 25 : 10);
    rec.chapelAt = t + 1.5 * HOUR;
    rec.newsAt = t + HOUR;
    this.event('found', `${finder ? this.name(finder) : 'Someone'} found ${this.name(id)}'s body ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. A blade did it.`, { who: finder, about: id });
    this.emit('body_found', { id, finder, place: rec.foundPlace, murder: true });
    this.openCase(id);
    Grief.onFound(this, rec);
    if (finder !== 'lyra') Lyra.learnsDeath(this, rec);
    if (!witnessed) this.toast(`${this.name(id)} has been found dead ${placeAt(rec.foundPlace, this.placeName(rec.foundPlace))}. Struck down with a blade. The watch is asking questions.`, 'warn', `found:${id}`);
    return rec;
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
    return `Lift ${n}`;
  }

  bodyInteract(v, actor) {
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
        rec.known = 'witnessed';
        this.setWanted(v.id, 'murder');
        this.emit('crime', { actor: P, victim: v, kind: 'murder', witnesses: [w.id] });
        this.found(v.id, w.id, place, { witnessed: true });
        Grief.villageTurns(this, rec);
        if (!rec.lyraHearsAt && !c.seenBy.lyra) rec.lyraHearsAt = this.now() + 20;
        this.toast(`${this.name(w.id)} saw you carrying ${this.name(v.id)}'s body. The watch is coming.`, 'warn', 'murder');
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
      c = this.cases[id] = { about: id, opened: Math.round(this.now()), day: this.day(), lead: this.investigator(id), suspicion: 0, level: 'none', evidence: [], state: 'open', questionedAt: null, askAt: Math.round(this.now() + (rec.known === 'witnessed' ? 0.2 : 1.2) * HOUR), verdict: null, outside: false };
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
    for (const r of rs) {
      if (r.victim !== id) continue;
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
    if (g.player?.carrying && this.dead[g.player.carrying.id]) this.scanCarry();
    else if (this.carrying) this.carrying = null;
    // A fallen victim tells whoever reaches them.
    for (const id of Object.keys(this.pending)) {
      const v = this.entity(id);
      if (!v || v.dead) {
        delete this.pending[id];
        continue;
      }
      if (!v.downed) {
        this.reveal(id, null);
        continue;
      }
      for (const e of [...(this.life?.villagers?.() || []), g.companion]) {
        if (!e || e === v || !e.isAlive?.() || e.state === 'sleep' || dist(e, v) > TELL_REACH) continue;
        this.reveal(id, e.id);
        break;
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
      // The stream is no hiding place: found by morning.
      if (rec.streamAt != null && rec.foundAt == null && t - rec.streamAt > 0.4 * DAY) Grief.foundByChance(this, rec, 'stream');
      // The watch lays the body out in the chapel.
      if (rec.state === 'found' && t >= (rec.chapelAt ?? Infinity) && (!this.visible(v, 40) || t - rec.chapelAt > HOUR)) Grief.layOut(this, rec);
      // Everyone knows within the hour of a finding.
      if (rec.newsAt != null && t >= rec.newsAt) {
        rec.newsAt = null;
        Grief.everyoneKnows(this, rec);
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
    Lyra.tick(this);
    Grief.tickOutside(this);
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
    if (!P || this.session || this.isWanted() || g.ui?.isModalOpen?.()) return;
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

  beginQuestioningUI(id) {
    const s = this.startQuestioning(id);
    if (!s) return;
    if (this.view?.question) this.view.question(this);
  }

  // A guard who reaches the wanted stranger tells them to come quietly.
  tickArrest() {
    const g = this.game;
    const P = g.player;
    if (!P || !this.isWanted() || P.downed || g.ui?.isModalOpen?.() || this.now() - this.arrestAskedAt < 50) return;
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
    const about = this.wanted?.about;
    if (!about || !this.dead[about]) return;
    // Carried in by the watch: the Moot sits once they are on their feet.
    this.trialAfterTending = { about, at: this.now() + 2 };
    setTimeoutSafe(() => {
      if (this.trialAfterTending) {
        const a = this.trialAfterTending.about;
        this.trialAfterTending = null;
        Grief.trial(this, a);
      }
    }, 3500);
  }

  onNewDay() {
    Grief.onNewDay(this);
  }

  // ------------------------------------------------------------------ npc hooks

  entryFor(npc, entry, hour) {
    return Grief.entryFor(this, npc, entry, hour);
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
      v.absent = { cause: 'killed', since: rec.t };
      this.layBody(v, rec);
      if (rec.state === 'buried') v.hidden = true;
    }
    for (const gr of this.graves) this.addGrave(gr);
  }
}

function setTimeoutSafe(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
  else fn();
}

export { whenPhrase };
