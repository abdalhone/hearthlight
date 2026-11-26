// The Unkindling (round 14b, workstream soul; DESIGN §37; LORE §9.12; the author: "I want a
// cool scary animation where the soul's literally ripped out of his body and it tries to
// resist but it can't, and I pull it outside of his body. Except if he was much stronger
// than me, no, then he can actually resist it. And that way I kill him with no sound, with
// nothing."). `game.unkindle`.
//
// A dark gift of the tempter's pact (society emits `pact_sealed { gifts: [..., 'unkindle'] }`;
// we call learn()). Walk up to a grown person, close enough to touch, and hold the spell: their
// flame is drawn out of them toward your raised hand. While it lasts they are HELD and SILENT
// (src/ai/hearing.js silence(): loudness 0 for every ear, a tile away behind nothing). It
// strains back in jerks; it cannot hold. It tears free, gutters like a snuffed candle and is
// drawn into your hand; the body sags with no wound and no blood: murder.kill(v, { cause:
// 'unkindled', silent: true, unmarked: true }). Whoever SAW it is a witness by the sight rule
// (kill() asks witnessesOf); nobody HEARS anything.
//
// The strength of the soul against your own (strengthOf / powerOf / verdict):
//   ratio < 1      easy: 2.5-3.5 s, it strains and fails;
//   1 <= r < 1.6   close: a longer, harder pull (3.5-5 s), harder jerks that cost you ground,
//                  more time for something to break it;
//   r >= 1.6       much stronger: it snaps back and they break free, and they KNOW (village
//                  side: src/murder/unkindled.js attempted()). Bosses and the tempter always.
// Being hit, the target pulled away (or out of reach, or behind a wall), or letting go breaks
// it; past KNOW_AT of the pull the target felt it and knows what you tried.
//
// Never a child (isMinor: "No. Not a child."), never through a wall (canReach), never the
// player, never the undead ("Nothing in there to take."). Never available otherwise; Settings
// → Practice → "Try all magic" (magic.trial) lets it work on training dummies only.
//
//   learned, learnedFrom, learn(from)      the gift (saved)
//   available()                            learned, or a magic trial (dummies only)
//   tally                                  unkindled deaths, all of them (the truth; saved)
//   deaths / attempts                      what was done (saved)
//   mark                                   the cold you carry (S20-6 as replaced in §13b: no
//                                          health lost; the price is that it shows), fading
//   targetInReach() -> { target, refusal } who the spell would take now (the lock first)
//   check(e) -> null | { reason, line }    why not
//   strengthOf(e) / powerOf(P) / verdict(e)
//   begin(target?) -> { ok, reason, line } start holding the spell
//   release(why)                           let go (or a break)
//   channel                                the hold in progress, or null (read by the fx/view)
//   briefLine(id)                          one line of what that person PERCEIVES, for their
//                                          Claude prompt (talk reads it, feature-detected)
//   update(dt)                             every world step (the plugin calls it)
//
// Bus out: unkindle_learned, unkindle_begin { id }, unkindle_end { id, outcome }, unkindled
// { id, seen }, unkindle_resisted { id } (the tempter's amusement, society may listen),
// unkindle_attempt { id, knows }, killing_known { id } (an unkindled death linked: society's
// reputation and the tempter count it then).

import { isMinor, lyraOf } from '../core/people.js';
import { canReach } from '../world/walls.js';
import { silence, unsilence, isSilenced } from '../ai/hearing.js';

export const REACH = 26; // px: close enough to touch (about 1.6 tiles)
export const HOLD_SLIP = 10; // px the held one may be moved (a shove, a pull) before the hold breaks
export const KEEP = 14; // px past REACH the player may drift while holding
export const KNOW_AT = 0.15; // share of the pull after which a broken hold is felt, and known
export const CLOSE = 1; // strength ratio from which the pull is long and hard
export const MUCH_STRONGER = 1.6; // ... and from which they break free
export const TEAR = 0.22; // s: it tears free
export const SAG = 0.55; // s: the body sags (the kill falls at its end)
export const DRAWN = 0.45; // s: the last of it drawn into the hand
export const SNAP = 0.4; // s: a soul that snaps back into a stronger body
export const SLIP = 0.32; // s: a broken hold: it slides back in
export const COOLDOWN = 2.5; // s between holds
const BOSS_STRENGTH = 400;
const TEMPTER_STRENGTH = 600;
const UNDEAD = new Set(['skeleton', 'ghoul', 'wraith', 'revenant', 'bones']);
const WILL_TRAITS = ['brave', 'stern', 'stubborn', 'fierce', 'proud', 'watchful', 'dutiful', 'patient in the wood'];
const MARK_FADE_AFTER = 3; // days without taking before the cold starts to leave you
const MARK_FADE = 0.2; // a day, after that

export const LINES = {
  child: 'No. Not a child.',
  self: 'Not yourself.',
  wall: 'Not through a wall.',
  undead: 'Nothing in there to take.',
  beast: 'It has no flame you can hold.',
  dead: 'There is nothing left in them.',
  far: 'Closer. Close enough to touch.',
  none: 'Nobody close enough to touch.',
  dummy: 'Only straw. In practice, that is all it may touch.',
  busy: 'Not now.',
  carried: 'Not while they are carried.',
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[unkindle]', err);
    return fallback;
  }
}

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

export class Unkindle {
  constructor(game) {
    this.game = game;
    this.learned = false;
    this.learnedFrom = null;
    this.learnedDay = null;
    this.tally = 0;
    this.deaths = []; // { id, t, day, hour, seen }
    this.attempts = []; // { id, t, day, outcome, knows, seenBy }
    this.mark = 0;
    this.lastTakenDay = null;
    this.channel = null;
    this.cooldownUntil = -Infinity;
    this.fx = null; // src/render/unkindle_fx.js (a browser)
    this.view = null; // src/ui/unkindle_view.js (a browser)
    this.village = null; // src/murder/unkindled.js: what the village comes to know
    this._offs = [];
    const bus = game?.bus;
    if (bus?.on) {
      this._offs.push(bus.on('damage', (p) => safe(() => this.onDamage(p))));
      this._offs.push(bus.on('pact_sealed', (p) => safe(() => this.onPact(p))));
      this._offs.push(bus.on('new_day', () => safe(() => this.onNewDay())));
    }
  }

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : Number(this.game?.time) || 0;
  }

  day() {
    return this.game?.clock?.day ?? 1;
  }

  rand() {
    const r = this.game?.rng;
    return typeof r?.next === 'function' ? r.next() : Math.random();
  }

  emit(type, p) {
    safe(() => this.game?.bus?.emit?.(type, p));
  }

  toast(text, kind = 'info', key = 'unkindle') {
    if (!text) return;
    safe(() => this.game?.ui?.toast?.(text, kind, { key }));
  }

  // ------------------------------------------------------------------ the gift

  // The pact's gifts carry it (society, DESIGN §37.4). Taught "before" or "after", either way
  // it comes with the pact.
  onPact(p) {
    const gifts = Array.isArray(p?.gifts) ? p.gifts : null;
    if (gifts && !gifts.includes('unkindle')) return;
    this.learn('pact');
  }

  learn(from = 'pact') {
    if (this.learned) return false;
    this.learned = true;
    this.learnedFrom = from;
    this.learnedDay = this.day();
    this.emit('unkindle_learned', { from });
    const desk = !safe(() => this.game?.ui?.isTouch, false);
    this.toast(
      `You know the Unkindling now. Close enough to touch a grown soul, ${desk ? 'hold F' : 'hold the dark hand'}: it puts their flame out from the inside. No sound. No mark.`,
      'info',
      'unkindle_learned',
    );
    return true;
  }

  // A magic trial (Settings → Practice → "Try all magic") lends it, for straw only.
  get trial() {
    return !!this.game?.magic?.trial;
  }

  available() {
    return this.learned || this.trial;
  }

  // ------------------------------------------------------------------ targets

  // What kind of thing this is to the spell: 'person' (a villager, Lyra, the companion, a
  // visitor with a profile), 'tempter', 'boss', 'undead', 'beast', 'dummy', or null.
  kindOf(e) {
    if (!e) return null;
    if (e.objType === 'dummy') return 'dummy';
    if (e.type !== 'actor') return null;
    const g = this.game;
    if (e === g?.player || e.id === 'player') return 'self';
    if (e.bossId) return 'boss';
    if (safe(() => g?.villain?.tempter, null) === e || e.id === 'tempter' || e.profile?.tempter) return 'tempter';
    if (e === lyraOf(g)) return 'person';
    if (e.profile && (e.kind === 'human' || !e.kind)) return 'person';
    if (e.kind === 'undead' || UNDEAD.has(e.species)) return 'undead';
    if (e.species === 'bandit' || e.kind === 'human') return 'beast'; // a smaller soul: not this round (§13b S20-11)
    return 'beast';
  }

  // Why the spell will not take this one: null when it may be tried.
  check(e) {
    const g = this.game;
    const P = g?.player;
    if (!e) return { reason: 'none', line: LINES.none };
    const kind = this.kindOf(e);
    if (kind === 'self') return { reason: 'self', line: LINES.self };
    if (kind === 'dummy') {
      if (!this.available()) return { reason: 'unknown', line: '' };
      return P && dist(P, e) <= REACH + 6 && safe(() => canReach(g, P, e), true) ? null : { reason: 'far', line: LINES.far };
    }
    if (!this.learned) return { reason: this.trial ? 'dummy' : 'unknown', line: this.trial ? LINES.dummy : '' };
    if (kind === 'undead') return { reason: 'undead', line: LINES.undead };
    if (kind === 'beast' || !kind) return { reason: 'beast', line: LINES.beast };
    // Never a child, by age (src/core/people.js, DESIGN §34.2).
    if (kind === 'person' && isMinor(g, e)) return { reason: 'child', line: LINES.child };
    if (e.dead || e.removed || e.absent || e.hidden) return { reason: 'dead', line: LINES.dead };
    if (e.carriedBy) return { reason: 'carried', line: LINES.carried };
    if (!P) return { reason: 'none', line: LINES.none };
    if (dist(P, e) > REACH) return { reason: 'far', line: LINES.far };
    // Never through a wall: the one rule every blow keeps (DESIGN §31.1).
    if (!safe(() => canReach(g, P, e), false)) return { reason: 'wall', line: LINES.wall };
    return null;
  }

  // Whoever the spell would take now: the lock (blood's game.lock) first, else the nearest in
  // front within touch. -> { target, refusal } (refusal: the nearest one refused, and why).
  targetInReach() {
    const g = this.game;
    const P = g?.player;
    if (!P || !this.available()) return { target: null, refusal: null };
    const lock = safe(() => g.lock?.target, null);
    if (lock && dist(P, lock) <= REACH + 2) {
      const r = this.check(lock);
      if (!r) return { target: lock, refusal: null };
      if (r.reason !== 'far') return { target: null, refusal: { target: lock, ...r } };
    }
    const fx = P.facing?.x ?? 0;
    const fy = P.facing?.y ?? 1;
    let best = null;
    let bs = Infinity;
    let refused = null;
    let rs = Infinity;
    const list = safe(() => g.entities.query(P.x, P.y, REACH + 4), []) || [];
    const cands = this.trial || this.learned ? [...list] : [];
    // Straw, in practice (and for whoever knows the spell: harmless).
    for (const o of safe(() => g.objects?.inRadius?.(P.x, P.y, REACH + 4, (x) => x.objType === 'dummy' && !x.removed), []) || []) cands.push(o);
    for (const e of cands) {
      if (!e || e === P || e.removed) continue;
      const kind = this.kindOf(e);
      if (!kind || kind === 'self') continue;
      if (e.type === 'actor' && (e.dead || e.absent) && kind !== 'person') continue;
      if (kind === 'person' && (e.dead || e.absent || e.hidden)) continue; // bodies are not targets
      const dx = e.x - P.x;
      const dy = e.y - P.y;
      const d = Math.hypot(dx, dy);
      if (d > REACH + 4) continue;
      const score = d - (d > 0 ? ((dx * fx + dy * fy) / d) * 8 : 8);
      const r = this.check(e);
      if (r) {
        if (r.reason === 'unknown' || r.reason === 'far') continue;
        if (score < rs) {
          rs = score;
          refused = { target: e, ...r };
        }
        continue;
      }
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return { target: best, refusal: best ? null : refused };
  }

  // ------------------------------------------------------------------ strength

  // The player's own: build, level, the weave in them, their will, and how whole they are now.
  powerOf(P = this.game?.player) {
    if (!P) return 1;
    const S = this.game?.stats;
    const stat = (id, fb) => {
      const v = safe(() => S?.get?.(P, id), null);
      return Number.isFinite(v) ? v : fb;
    };
    const maxHp = Math.max(1, Number(P.maxHp) || 60);
    const atk = stat('atk', Number(P.atk) || 6);
    const sp = stat('spellPower', 1);
    const res = stat('resist', 0);
    const lv = Math.max(1, Number(P.level) || 1);
    let p = (maxHp / 60) * 8 + atk + 25 * Math.max(0, sp - 1) + 15 * Math.max(0, res) + 2 * (lv - 1);
    const frac = clamp((Number(P.hp) || maxHp) / maxHp);
    p *= 0.55 + 0.45 * frac;
    return Math.max(1, p);
  }

  // The soul's: its body and will, its work (the watch, the huntress), how whole they are,
  // and whether they are awake to hold on. Bosses and the tempter are beyond any of it.
  strengthOf(e) {
    if (!e) return 0;
    const kind = this.kindOf(e);
    if (kind === 'dummy') return 1;
    if (kind === 'boss') return BOSS_STRENGTH;
    if (kind === 'tempter') return TEMPTER_STRENGTH;
    const g = this.game;
    const c = e.profile?.combat || {};
    const maxHp = Math.max(1, Number(e.maxHp) || c.maxHp || 36);
    const atk = Number(e.atk ?? c.atk ?? 3) || 3;
    const def = Number(e.def ?? c.def ?? 0) || 0;
    let s = (maxHp / 36) * 6 + atk + 2 * def;
    if (e.isGuard || e.faction === 'guard') s += 3;
    if (e.profile?.hunter) s += 3;
    const traits = e.profile?.traits || [];
    s += Math.min(3, 1.5 * traits.filter((t) => WILL_TRAITS.includes(t)).length);
    // Lyra: a weaver, and as strong as she has grown (DESIGN §16).
    if (e === lyraOf(g)) s += 6 + 2 * Math.max(0, (Number(e.level) || 1) - 1);
    const frac = clamp((Number(e.hp) || maxHp) / maxHp);
    s *= 0.5 + 0.5 * frac;
    if (e.state === 'sleep') s *= 0.6;
    if (e.downed) s *= 0.45;
    return Math.max(1, s);
  }

  // -> { ratio, kind: 'easy' | 'close' | 'resists', dur (s, of a pull that succeeds),
  //      peak (how far a stronger soul comes before it snaps back), struggle (s) }
  verdict(e, P = this.game?.player) {
    const kind = this.kindOf(e);
    if (kind === 'dummy') return { ratio: 0.3, kind: 'easy', dur: 2.6, peak: 1, struggle: 0 };
    const ratio = this.strengthOf(e) / this.powerOf(P);
    let killable = true;
    if (kind === 'person') {
      const m = this.game?.murder;
      killable = !m || typeof m.canKill !== 'function' || !!safe(() => m.canKill(e), false);
    }
    if (ratio >= MUCH_STRONGER || kind === 'boss' || kind === 'tempter' || !killable) {
      const over = clamp((ratio - MUCH_STRONGER) / 1.5);
      return { ratio, kind: 'resists', dur: 4, peak: 0.55 - 0.25 * over, struggle: 2.2 - 0.8 * over };
    }
    if (ratio >= CLOSE) return { ratio, kind: 'close', dur: 3.5 + ((ratio - CLOSE) / (MUCH_STRONGER - CLOSE)) * 1.5, peak: 1, struggle: 0 };
    return { ratio, kind: 'easy', dur: 2.5 + clamp(ratio) * 1, peak: 1, struggle: 0 };
  }

  // ------------------------------------------------------------------ the hold

  busy() {
    const g = this.game;
    const P = g?.player;
    if (!P || g.state !== 'playing') return true;
    if (P.downed || P.dead || P.carrying || P.carriedBy || P.rolling) return true;
    if (safe(() => g.ui?.isModalOpen?.(), false)) return true;
    return false;
  }

  // Start holding the spell on `target` (or whoever is in reach). -> { ok, reason, line }
  begin(target = null) {
    const g = this.game;
    const P = g?.player;
    if (this.channel) return { ok: false, reason: 'busy', line: '' };
    if (!this.available()) return { ok: false, reason: 'unknown', line: '' };
    if (this.busy()) return { ok: false, reason: 'busy', line: LINES.busy };
    if (this.now() < this.cooldownUntil) return { ok: false, reason: 'cooldown', line: '' };
    let e = target;
    if (!e) {
      const r = this.targetInReach();
      if (!r.target) return { ok: false, reason: r.refusal?.reason || 'none', line: r.refusal?.line || LINES.none };
      e = r.target;
    }
    const why = this.check(e);
    if (why) return { ok: false, ...why };
    const v = this.verdict(e, P);
    const kind = this.kindOf(e);
    this.channel = {
      target: e,
      kind,
      v,
      t: 0,
      k: 0, // how far the soul is drawn: 0 in the body, 1 torn free
      shown: 0, // what the eye sees (k, minus the jerk's spring back)
      phase: 'pull', // pull | tear | sag | drawn | snap | slip | done
      phaseT: 0,
      jerk: 0, // 0..1, a snap back toward the body, easing out
      nextJerk: 0.35 + this.rand() * 0.35,
      holdAt: { x: e.x, y: e.y },
      outcome: null,
      fx: { x: e.x, y: e.y, hx: P.x, hy: P.y - 16, px: P.x, py: P.y }, // shared with the fx
      seen: null,
      held: kind !== 'dummy',
    };
    if (kind !== 'dummy') this.hold(e, 0);
    this.pose(P, e);
    safe(() => this.fx?.start?.(this.channel));
    safe(() => this.view?.onBegin?.(this.channel));
    this.emit('unkindle_begin', { id: e.id ?? null, kind });
    return { ok: true, reason: null, line: '' };
  }

  // Held: still, silent (loudness 0 for every ear: src/ai/hearing.js), unable to strike.
  hold(e, dt) {
    if (!e || e.dead) return;
    silence(this.game, e, 0.6);
    e.lockTime = Math.max(e.lockTime || 0, 0.2);
    e.rootTime = Math.max(e.rootTime || 0, 0.2);
    if (e.moveIntent) {
      e.moveIntent.x = 0;
      e.moveIntent.y = 0;
    }
    e.windup = 0;
    if (Number.isFinite(e.attackReadyAt)) e.attackReadyAt = Math.max(e.attackReadyAt, this.now() + 0.4);
    e.attackCd = Math.max(e.attackCd || 0, 0.3);
    safe(() => e.walker?.stop?.());
    if (e.r) e.r.walking = false;
    const P = this.game?.player;
    if (P && dt >= 0) safe(() => e.faceToward?.(P.x, P.y));
  }

  pose(P, e) {
    if (!P || !e) return;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    safe(() => P.castPose?.(a, 0.3));
    P.lockTime = Math.max(P.lockTime || 0, 0.15);
  }

  // Let go (the key or the button released), or a break. Before the tear, it slides back.
  release(why = 'let_go') {
    const ch = this.channel;
    if (!ch || ch.phase !== 'pull') return false;
    this.breakHold(why);
    return true;
  }

  onDamage(p) {
    const ch = this.channel;
    const P = this.game?.player;
    if (!ch || !P || ch.phase !== 'pull') return;
    if (p?.target !== P || !((p.amount ?? 1) > 0)) return;
    this.breakHold('hit');
  }

  // The hold broke before the soul tore free. Past KNOW_AT they felt it, and know.
  breakHold(why) {
    const ch = this.channel;
    if (!ch) return;
    ch.phase = 'slip';
    ch.phaseT = 0;
    ch.outcome = 'broken';
    ch.why = why;
    const e = ch.target;
    if (ch.kind === 'dummy') return;
    if (e && !e.dead) {
      unsilence(e);
      const knows = ch.k >= KNOW_AT;
      this.attempts.push({ id: e.id, t: Math.round(this.now()), day: this.day(), outcome: 'broken', knows, why });
      if (this.attempts.length > 40) this.attempts.splice(0, this.attempts.length - 40);
      safe(() => this.village?.attempted?.(e, { outcome: 'broken', knows, why, k: ch.k }));
      this.emit('unkindle_attempt', { id: e.id, knows, outcome: 'broken' });
    }
  }

  // ------------------------------------------------------------------ the frame

  update(dt) {
    const g = this.game;
    if (!g || !(dt > 0)) return;
    this.view?.update?.(dt);
    const ch = this.channel;
    if (!ch) return;
    const P = g.player;
    const e = ch.target;
    ch.t += dt;
    ch.phaseT += dt;
    ch.jerk = Math.max(0, ch.jerk - dt / 0.28);
    if (ch.phase === 'pull') {
      // Anything that ends the hold: the stranger down, the target gone or moved, a wall.
      const gone = !e || e.removed || (e.type === 'actor' && (e.dead || e.absent || e.carriedBy));
      if (!P || P.downed || P.dead || g.state !== 'playing') return this.breakHold('down');
      if (gone) return this.breakHold('gone');
      if (Math.hypot(e.x - ch.holdAt.x, e.y - ch.holdAt.y) > HOLD_SLIP) return this.breakHold('pulled');
      if (dist(P, e) > REACH + KEEP) return this.breakHold('far');
      if (ch.kind !== 'dummy' && !safe(() => canReach(g, P, e), true)) return this.breakHold('wall');
      if (safe(() => g.ui?.isModalOpen?.(), false)) return this.breakHold('let_go');
      if (ch.held) this.hold(e, dt);
      this.pose(P, e);
      this.pull(ch, dt);
    } else if (ch.phase === 'tear') {
      if (ch.held) this.hold(e, dt);
      this.pose(P, e);
      if (ch.phaseT >= TEAR) this.setPhase(ch, 'sag');
    } else if (ch.phase === 'sag') {
      if (ch.held) this.hold(e, dt);
      this.pose(P, e);
      if (ch.phaseT >= SAG) {
        this.take(ch);
        this.setPhase(ch, 'drawn');
      }
    } else if (ch.phase === 'drawn') {
      if (ch.phaseT >= DRAWN) this.finish(ch);
    } else if (ch.phase === 'snap') {
      if (ch.phaseT >= SNAP) this.finish(ch);
    } else if (ch.phase === 'slip') {
      if (ch.phaseT >= SLIP) this.finish(ch);
    }
    this.syncFx(ch);
  }

  setPhase(ch, phase) {
    ch.phase = phase;
    ch.phaseT = 0;
    safe(() => this.view?.onPhase?.(ch));
  }

  // The pull: steady toward the hand; the soul strains back in jerks (harder, and costing
  // more ground, the closer its strength to yours). A stronger soul comes only so far.
  pull(ch, dt) {
    const v = ch.v;
    const r = clamp(v.ratio, 0, 2.2);
    const rate = 1 / Math.max(0.5, v.kind === 'resists' ? 3.4 : v.dur);
    ch.k = Math.min(1, ch.k + dt * rate);
    ch.nextJerk -= dt;
    if (ch.nextJerk <= 0) {
      const hard = v.kind === 'easy' ? 0.35 + 0.35 * r : v.kind === 'close' ? 0.75 + 0.25 * r : 1.1;
      ch.jerk = Math.min(1, 0.55 + 0.45 * hard);
      ch.jerkAmp = 0.1 + 0.14 * hard;
      // Close in strength, every jerk wins back a little of what you took.
      if (v.kind !== 'easy') ch.k = Math.max(0, ch.k - (v.kind === 'close' ? 0.035 : 0.05) * hard);
      const gap = v.kind === 'easy' ? 0.7 : v.kind === 'close' ? 0.48 : 0.36;
      ch.nextJerk = gap * (0.7 + 0.6 * this.rand());
      safe(() => this.view?.onJerk?.(ch));
    }
    ch.shown = clamp(ch.k - (ch.jerk || 0) * (ch.jerkAmp || 0.08));
    if (v.kind === 'resists') {
      if (ch.k >= v.peak || ch.t >= v.struggle) this.resisted(ch);
      return;
    }
    if (ch.k >= 1) {
      ch.shown = 1;
      this.setPhase(ch, 'tear');
      safe(() => this.view?.onTear?.(ch));
    }
  }

  syncFx(ch) {
    const P = this.game?.player;
    const e = ch.target;
    const f = ch.fx;
    if (e) {
      f.x = e.x;
      f.y = e.y;
    }
    if (P) {
      f.px = P.x;
      f.py = P.y;
      const fx = P.facing?.x ?? 0;
      f.hx = P.x + fx * 5;
      f.hy = P.y - 16; // the raised hand
    }
  }

  // The soul tore free and the body has sagged: the death (silent, unmarked), now.
  take(ch) {
    const g = this.game;
    const e = ch.target;
    ch.outcome = 'taken';
    if (ch.kind === 'dummy') return;
    let rec = null;
    const m = g.murder;
    if (m && typeof m.kill === 'function') rec = safe(() => m.kill(e, g.player, { cause: 'unkindled', silent: true, unmarked: true }), null);
    if (!rec) {
      // Nothing would let them die (an old rule, a game without the murder system): the soul
      // goes back. Never a death with no record.
      unsilence(e);
      ch.outcome = 'broken';
      return;
    }
    ch.seen = (rec.seen || []).map((s) => s.id);
    this.tally++;
    this.deaths.push({ id: e.id, t: Math.round(rec.t ?? this.now()), day: rec.day ?? this.day(), hour: Math.round((g.clock?.hour ?? 0) * 100) / 100, seen: ch.seen.length > 0 });
    if (this.deaths.length > 60) this.deaths.splice(0, this.deaths.length - 60);
    this.mark = Math.min(12, this.mark + 1);
    this.lastTakenDay = this.day();
    safe(() => this.village?.unkindled?.(rec, e, ch));
    this.emit('unkindled', { id: e.id, seen: ch.seen });
  }

  // A much stronger soul: it snaps back, and they break free. They KNOW what you tried.
  resisted(ch) {
    const e = ch.target;
    this.setPhase(ch, 'snap');
    ch.outcome = 'resisted';
    ch.shown = 0;
    safe(() => this.view?.onSnap?.(ch));
    if (!e || ch.kind === 'dummy') return;
    unsilence(e);
    // Thrown back a step by it.
    const P = this.game?.player;
    if (P && e.knock) {
      const dx = e.x - P.x;
      const dy = e.y - P.y;
      const l = Math.hypot(dx, dy) || 1;
      e.knock.x += (dx / l) * 70;
      e.knock.y += (dy / l) * 70;
    }
    this.attempts.push({ id: e.id, t: Math.round(this.now()), day: this.day(), outcome: 'resisted', knows: true });
    if (this.attempts.length > 40) this.attempts.splice(0, this.attempts.length - 40);
    safe(() => this.village?.attempted?.(e, { outcome: 'resisted', knows: true, k: ch.k, kind: ch.kind }));
    this.emit('unkindle_resisted', { id: e.id, kind: ch.kind });
    this.emit('unkindle_attempt', { id: e.id, knows: true, outcome: 'resisted' });
  }

  finish(ch) {
    if (this.channel !== ch) return;
    ch.phase = 'done';
    const e = ch.target;
    if (e && !e.dead && ch.outcome !== 'resisted' && ch.outcome !== 'broken') unsilence(e);
    this.channel = null;
    this.cooldownUntil = this.now() + COOLDOWN;
    safe(() => this.fx?.end?.(ch));
    safe(() => this.view?.onEnd?.(ch));
    this.emit('unkindle_end', { id: e?.id ?? null, outcome: ch.outcome });
  }

  // ------------------------------------------------------------------ what shows

  // S20-6 (as replaced in §13b): no health is lost; what you take shows. The mark is a hidden
  // measure of what you have taken; it fades slowly once you stop.
  onNewDay() {
    if (!(this.mark > 0)) return;
    const d = this.day();
    if (this.lastTakenDay != null && d - this.lastTakenDay < MARK_FADE_AFTER) return;
    this.mark = Math.max(0, Math.round((this.mark - MARK_FADE) * 100) / 100);
  }

  // 0 none, 1 faint (cold hands, breath that fogs), 2 clear, 3 strong.
  signTier() {
    const m = this.mark;
    return m >= 6 ? 3 : m >= 3 ? 2 : m >= 1 ? 1 : 0;
  }

  // One line for this person's Claude prompt: only what they could perceive or have been
  // told (the village side words it: src/murder/unkindled.js). '' when nothing.
  briefLine(id) {
    return safe(() => this.village?.briefLine?.(id), '') || '';
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    return {
      v: 1,
      learned: this.learned,
      learnedFrom: this.learnedFrom,
      learnedDay: this.learnedDay,
      tally: this.tally,
      deaths: this.deaths.slice(-60),
      attempts: this.attempts.slice(-40),
      mark: this.mark,
      lastTakenDay: this.lastTakenDay,
      village: safe(() => this.village?.serialize?.(), null),
    };
  }

  deserialize(d) {
    // A hold in progress never survives a load: whoever was held is free.
    if (this.channel) {
      const e = this.channel.target;
      if (e && !e.dead) unsilence(e);
      safe(() => this.fx?.end?.(this.channel));
      this.channel = null;
    }
    if (!d || typeof d !== 'object') return;
    this.learned = !!d.learned;
    this.learnedFrom = typeof d.learnedFrom === 'string' ? d.learnedFrom : null;
    this.learnedDay = Number.isFinite(d.learnedDay) ? d.learnedDay : null;
    this.tally = Math.max(0, Number(d.tally) || 0);
    this.deaths = Array.isArray(d.deaths) ? d.deaths.filter((x) => x && typeof x.id === 'string') : [];
    this.attempts = Array.isArray(d.attempts) ? d.attempts.filter((x) => x && typeof x.id === 'string') : [];
    this.mark = Math.max(0, Number(d.mark) || 0);
    this.lastTakenDay = Number.isFinite(d.lastTakenDay) ? d.lastTakenDay : null;
    safe(() => this.village?.deserialize?.(d.village));
  }

  isHeld(e) {
    const ch = this.channel;
    return !!ch && ch.target === e && (ch.phase === 'pull' || ch.phase === 'tear' || ch.phase === 'sag') && isSilenced(this.game, e);
  }
}
