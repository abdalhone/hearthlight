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
// The strength of the soul against your own (strengthOf / powerOf / verdict; round 15: who
// they are against a slow curve of your own, and the odds chanceOf(ratio) shown before you
// start and rolled when you begin):
//   chance >= 85%  easy: 2.5-3.5 s, it strains and fails;
//   less           close: a longer, harder pull (3.5-5 s), harder jerks that cost you ground,
//                  more time for something to break it, and if the roll goes against you it
//                  tears itself back past KNOW_AT and breaks free, and knows;
//   r >= 1.6       much stronger: it snaps back and they break free, and they KNOW (village
//                  side: src/murder/unkindled.js attempted()). Bosses and the tempter always.
// Being hit, the target pulled away (or out of reach, or behind a wall), or letting go breaks
// it; past KNOW_AT of the pull the target felt it and knows what you tried.
//
// Never a child (isMinor: "No. Not a child."), never through a wall (canReach), never the
// player, never the undead ("Nothing in there to take."). Never available otherwise; Settings
// → Practice → "Try all magic" (magic.trial) lets it work on training dummies only.
//
// Prey that is not murder (§13b S20-11): hostile beasts and bandits have smaller souls; taking
// them is no crime (a villager who SEES it sees dark magic: src/society/dark_suspicion.js).
// Harmless things (a hen, the cat, a deer) are refused; bosses and the tempter always shrug it
// off at once, whatever the build (Version 12 for him, round 15 for them).
// Every soul taken feeds the taken flame (src/magic/coldfire.js:
// the bar that boosts your power and ebbs, the mark that shows).
//
// The hold plants you (the author: "I can move while I'm doing spells; it should stop me"):
// from the first pull to the last of it drawn into your hand you stand (lockTime), turned to
// the one you hold; letting go (or a roll's key) is the way out.
//
//   learned, learnedFrom, learn(from)      the gift (saved)
//   available()                            learned, or a magic trial (dummies only)
//   tally                                  unkindled deaths, all of them (the truth; saved)
//   deaths / attempts                      what was done (saved)
//   coldfire                               the taken flame: bar, mark, boost (coldfire.js)
//   mark / signTier()                      the hidden mark and its sign tier (from coldfire)
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
import { Coldfire } from './coldfire.js';

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
const BOSS_FLOOR = 90; // a boss's soul is at least this strong (old things under the ground)
const TEMPTER_STRENGTH = 600; // in practice, never
// The odds (round 15; the author: the Unkindling "a real contest of strength, not a formality").
// The chance a hold that nothing breaks ends with the soul taken, by the ratio r of their
// strength to yours: 1 / (1 + (r / EVEN)^STEEP): even odds at EVEN, sure far below it, little
// chance near MUCH_STRONGER (and none past it). The roll is made when the hold begins; a soul
// that will break free does so somewhere past KNOW_AT of the pull, so it always knows.
export const EVEN = 0.85;
export const STEEP = 4;
export const SURE = 0.85; // a chance at least this is an 'easy' pull
export function chanceOf(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0) return 0;
  if (r >= MUCH_STRONGER) return 0;
  return 1 / (1 + Math.pow(r / EVEN, STEEP));
}
// The odds in a word (and the chance): what the hint shows before you start.
export function oddsWords(chance) {
  const c = Number(chance) || 0;
  if (c <= 0) return 'too strong';
  if (c >= 0.9) return 'sure';
  if (c >= 0.7) return 'likely';
  if (c >= 0.4) return 'even';
  if (c >= 0.15) return 'unlikely';
  return 'barely';
}
// Nothing in there to take: the walking dead, and what gravelight wears (LORE §2: bats).
const UNDEAD = new Set(['skeleton', 'ghoul', 'wraith', 'revenant', 'bones', 'bat']);
const BANDITS = new Set(['bandit', 'bandit_archer', 'bandit_chief']);
const WILL_TRAITS = ['brave', 'stern', 'stubborn', 'fierce', 'proud', 'watchful', 'dutiful', 'patient in the wood', 'quietly strong', 'fearless', 'scornful', 'brave when it counts', 'wise', 'calm'];
// Faith holds a flame in: the chapel's keeper most of all, the old songs' keeper a little.
const FAITH = [
  [/chapel/i, 20],
  [/songkeeper/i, 4],
];

export const LINES = {
  child: 'No. Not a child.',
  self: 'Not yourself.',
  wall: 'Not through a wall.',
  undead: 'Nothing in there to take.',
  beast: 'It has no flame you can hold.',
  harmless: 'Not a harmless thing. Nothing about it would come to you.',
  bandit: 'Not one from beyond the ward. Not yet.',
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

// A held creature's mind while the hold lasts: still.
const HELD = Object.freeze({
  update(c) {
    if (c.moveIntent) {
      c.moveIntent.x = 0;
      c.moveIntent.y = 0;
    }
  },
});
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
    this.coldfire = new Coldfire(game);
    this.prey = { beast: 0, bandit: 0, boss: 0 }; // souls taken that were not people
    this.lastTakenDay = null;
    this.channel = null;
    this.cooldownUntil = -Infinity;
    this.fx = null; // src/render/unkindle_fx.js (a browser)
    this.view = null; // src/ui/unkindle_view.js (a browser)
    this.village = null; // src/murder/unkindled.js: what the village comes to know
    this.suspicion = null; // src/society/dark_suspicion.js: the faithful who read the signs
    this.signs = null; // src/render/soul_signs.js (a browser)
    this._offs = [];
    const bus = game?.bus;
    if (bus?.on) {
      this._offs.push(bus.on('damage', (p) => safe(() => this.onDamage(p))));
      this._offs.push(bus.on('pact_sealed', (p) => safe(() => this.onPact(p))));
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
  // visitor with a profile), 'tempter', 'boss', 'undead', 'bandit', 'beast' (a hostile one),
  // 'harmless' (a hen, the cat, a deer: refused), 'dummy', 'self', or null.
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
    // A bandit or a beast: a smaller soul, prey that is not murder (§13b S20-11).
    if (BANDITS.has(e.species) || e.faction === 'bandit' || e.kind === 'human') return 'bandit';
    // Harmless (a hen, the cat, a deer, a rabbit): no threat to anyone. A boar, wildlife that
    // charges, is a beast.
    const threat = e.spec?.threat ?? (e.faction === 'wildlife' ? 0 : 1);
    if (e.pet || e.species === 'cat' || threat === 0) return 'harmless';
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
    if (kind === 'harmless') return { reason: 'harmless', line: LINES.harmless };
    if (!kind) return { reason: 'beast', line: LINES.beast };
    // Never a child, by age (src/core/people.js, DESIGN §34.2).
    if (kind === 'person' && isMinor(g, e)) return { reason: 'child', line: LINES.child };
    if (e.dead || e.removed || e.absent || e.hidden || (kind !== 'person' && !(e.isAlive?.() ?? e.hp > 0))) return { reason: 'dead', line: LINES.dead };
    if (e.carriedBy) return { reason: 'carried', line: LINES.carried };
    if (!P) return { reason: 'none', line: LINES.none };
    // A big body (a boss) is touched at its edge.
    const reach = REACH + (kind === 'boss' ? Math.max(0, Number(e.radius) || 0) : 0);
    if (dist(P, e) > reach) return { reason: 'far', line: LINES.far };
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
      // A hen underfoot is never the one the dark hand reaches for, nor named as refused.
      if (kind === 'harmless') continue;
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

  // The player's own: build, level, the weave in them, their will, how whole they are now, and
  // the taken flame burning in them (coldfire: a fuller bar takes stronger souls).
  // Round 15: a contest of will, not of the sword arm. The years you have lived (your level)
  // count most; the weave in you, your resolve and your body add on a slow curve (the log of
  // each), so piling points on a stat buys less and less (999 of everything is about four
  // times a level-1 stranger's hold, not a thousand); the taken flame burning in you (coldfire)
  // and how whole you are scale it.
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
    let p = 14 + 1.4 * (lv - 1) + 6 * Math.log(Math.max(1, sp)) + 12 * clamp(res, 0, 1) + 3 * Math.log(Math.max(1, maxHp / 60)) + 2 * Math.log(Math.max(1, atk / 6));
    const frac = clamp((Number(P.hp) || maxHp) / maxHp);
    p *= 0.55 + 0.45 * frac;
    if (P === this.game?.player) p *= this.coldfire?.powerMul?.() ?? 1;
    return Math.max(1, p);
  }

  // The soul's: its body and will, its work (the watch, the huntress), how whole they are,
  // and whether they are awake to hold on. A boss is an old thing under the ground: at least
  // BOSS_FLOOR; the tempter is beyond any of it.
  strengthOf(e) {
    if (!e) return 0;
    const kind = this.kindOf(e);
    if (kind === 'dummy') return 1;
    if (kind === 'tempter') return TEMPTER_STRENGTH;
    const g = this.game;
    const c = e.profile?.combat || {};
    const maxHp = Math.max(1, Number(e.maxHp) || c.maxHp || 36);
    const atk = Number(e.atk ?? c.atk ?? 3) || 3;
    const def = Number(e.def ?? c.def ?? 0) || 0;
    // Round 15: who they are. The body a little (a smith's arms, a guard's mail); their will
    // much more: the watch and the hunt, a will in their traits, faith, the levels a weaver has
    // grown. A creature (a wolf, a bandit) is mostly its body.
    let s = 0.8 * (maxHp / 36) + 0.25 * atk + 0.5 * def;
    if (kind === 'boss') return Math.max(BOSS_FLOOR, (6 * (maxHp / 36) + atk + 2 * def) * 1.4);
    if (kind !== 'person') return Math.max(1, (1.5 * s + 2) * (0.5 + 0.5 * clamp((Number(e.hp) || maxHp) / maxHp)));
    const role = e.profile?.role || '';
    if (e.isGuard || e.faction === 'guard' || /guard|watch/i.test(role)) s += 14;
    if (/captain/i.test(role)) s += 12; // who holds the watch together
    if (e.profile?.hunter || /hunt/i.test(role)) s += 24;
    const traits = e.profile?.traits || [];
    s += Math.min(9, 3 * traits.filter((t) => WILL_TRAITS.includes(t)).length);
    for (const [re, add] of FAITH) if (re.test(e.profile?.role || '')) s += add;
    if (Number.isFinite(e.level) && e !== lyraOf(g)) s += 1.5 * Math.max(0, e.level - 1);
    // Lyra: a weaver, and as strong as she has grown (DESIGN §16).
    if (e === lyraOf(g)) s += 18 + 3 * Math.max(0, (Number(e.level) || 1) - 1);
    const frac = clamp((Number(e.hp) || maxHp) / maxHp);
    s *= 0.5 + 0.5 * frac;
    if (e.state === 'sleep') s *= 0.6;
    if (e.downed) s *= 0.45;
    return Math.max(1, s);
  }

  // -> { ratio, kind: 'easy' | 'close' | 'resists', dur (s, of a pull that succeeds),
  //      peak (how far a stronger soul comes before it snaps back), struggle (s) }
  verdict(e, P = this.game?.player) {
    const v = this._verdict(e, P);
    // The odds, the same the hold then plays out (round 15): never held, none.
    v.chance = v.kind === 'resists' ? 0 : v.kind === 'easy' && this.kindOf(e) === 'dummy' ? 1 : chanceOf(v.ratio);
    v.words = oddsWords(v.chance);
    return v;
  }

  // What the hint shows before you start (round 15): { chance (0..1), percent, words, kind }.
  odds(e, P = this.game?.player) {
    if (!e) return null;
    const v = this.verdict(e, P);
    return { chance: v.chance, percent: Math.round(v.chance * 100), words: v.words, kind: v.kind, ratio: v.ratio };
  }

  _verdict(e, P) {
    const kind = this.kindOf(e);
    if (kind === 'dummy') return { ratio: 0.3, kind: 'easy', dur: 2.6, peak: 1, struggle: 0 };
    const ratio = this.strengthOf(e) / this.powerOf(P);
    // A fuller bar pulls faster (coldfire).
    const fast = P === this.game?.player ? (this.coldfire?.channelMul?.() ?? 1) : 1;
    let killable = true;
    if (kind === 'person') {
      const m = this.game?.murder;
      killable = !m || typeof m.canKill !== 'function' || !!safe(() => m.canKill(e), false);
    }
    // Something old under the ground (a boss) and the tempter are never taken and never held:
    // they shrug it off at once (no hold to chain into a stun). The tempter since Version 12 (a
    // Free 999 build reached 1/1.6 of his 600, and the take only knocked him down at the gate);
    // a boss since round 15 (it was "taken by a hand much stronger"; at Free 999 Varek read
    // 'close': the author asked for a real contest).
    if (kind === 'tempter' || kind === 'boss') return { ratio, kind: 'resists', dur: 4, peak: 0.25, struggle: 0.7 };
    if (ratio >= MUCH_STRONGER || !killable) {
      const over = clamp((ratio - MUCH_STRONGER) / 1.5);
      return { ratio, kind: 'resists', dur: 4, peak: 0.55 - 0.25 * over, struggle: 2.2 - 0.8 * over };
    }
    // Sure enough is an easy pull; anything less is close: longer and harder the nearer the
    // soul's strength is to yours (and it may yet break free: the roll in begin()).
    if (chanceOf(ratio) >= SURE) return { ratio, kind: 'easy', dur: (2.5 + clamp(ratio / EVEN) * 1) * fast, peak: 1, struggle: 0 };
    return { ratio, kind: 'close', dur: (3.5 + clamp((ratio - 0.55) / (MUCH_STRONGER - 0.55)) * 1.5) * fast, peak: 1, struggle: 0 };
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
      // Held still and silent while it lasts: a person, a bandit, a beast, and a boss only when
      // it does not shrug it off (v.kind 'resists' for a boss: never held, no stun to chain).
      held: kind === 'person' || kind === 'bandit' || kind === 'beast' || ((kind === 'boss' || kind === 'tempter') && v.kind !== 'resists'),
      strength: this.strengthOf(e),
      // The roll (round 15): with the odds the hint showed, the soul holds on; if it will, it
      // breaks free somewhere past KNOW_AT of the pull (so it knows what you tried).
      fails: v.kind !== 'resists' && kind !== 'dummy' && this.rand() >= v.chance,
      breakAt: KNOW_AT + 0.1 + this.rand() * 0.7,
    };
    if (this.channel.held) this.hold(e, 0);
    this.pose(P, e);
    safe(() => this.fx?.start?.(this.channel));
    safe(() => this.view?.onBegin?.(this.channel));
    this.emit('unkindle_begin', { id: e.id ?? null, kind });
    return { ok: true, reason: null, line: '' };
  }

  // Held: still, silent (loudness 0 for every ear: src/ai/hearing.js), unable to strike. A
  // creature's own mind (its controller) is set aside while it is held, and given back after.
  hold(e, dt) {
    if (!e || e.dead) return;
    silence(this.game, e, 0.6);
    if (e.controller && e.controller !== HELD && !e.profile) {
      e._unkController = e.controller;
      e.controller = HELD;
    }
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

  // You stand while you pull (the author: "I can move while I'm doing spells; it should stop
  // me"): planted (lockTime: no step, no drift), turned to the one you hold, the hand raised.
  pose(P, e) {
    if (!P || !e) return;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    safe(() => P.castPose?.(a, 0.3));
    P.lockTime = Math.max(P.lockTime || 0, 0.15);
    if (P.vel) {
      P.vel.x = 0;
      P.vel.y = 0;
    }
  }

  // A held creature gets its own mind back (its controller), whatever ended the hold.
  freeCreature(e) {
    if (!e || !e._unkController) return;
    if (e.controller === HELD) e.controller = e._unkController;
    delete e._unkController;
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
    this.freeCreature(e);
    if (e && !e.dead && ch.kind !== 'person') {
      // A beast or a bandit only shakes it off (and comes on, if it was coming on).
      unsilence(e);
      this.attempts.push({ id: e.id || ch.kind, t: Math.round(this.now()), day: this.day(), outcome: 'broken', knows: false, why, kind: ch.kind });
      if (this.attempts.length > 40) this.attempts.splice(0, this.attempts.length - 40);
      this.emit('unkindle_attempt', { id: e.id ?? null, knows: false, outcome: 'broken', kind: ch.kind });
      return;
    }
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
    safe(() => this.coldfire.update(dt));
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
      // A roll is the way out of a hold (as out of any channel): it breaks, and you roll.
      if (safe(() => g.input?.pressed?.('dodge'), false)) {
        this.breakHold('roll');
        P.lockTime = 0;
        const mv = safe(() => g.input.moveVector(), null);
        safe(() => P.tryDodge?.(mv?.x || 0, mv?.y || 0));
        return;
      }
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
      // Still standing while the last of it goes into your hand.
      if (P && !P.downed && !P.dead) {
        P.lockTime = Math.max(P.lockTime || 0, 0.1);
        if (P.vel) {
          P.vel.x = 0;
          P.vel.y = 0;
        }
      }
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
    // The roll went against you: it tears itself back and breaks free, and knows.
    if (ch.fails && ch.k >= ch.breakAt) {
      this.resisted(ch);
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

  // The soul tore free and the body has sagged: the death (silent, unmarked), now. A person
  // through murder.kill (cause 'unkindled'); a beast or a bandit as any creature dies (no blood,
  // no cry, no clash of steel: prey, not murder); a boss's defeat plays out as its own.
  take(ch) {
    const g = this.game;
    const e = ch.target;
    ch.outcome = 'taken';
    if (ch.kind === 'dummy') return;
    if (ch.kind !== 'person') return this.takePrey(ch);
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
    this.lastTakenDay = this.day();
    ch.fill = safe(() => this.coldfire.take('person', ch.strength), 0);
    safe(() => this.village?.unkindled?.(rec, e, ch));
    safe(() => this.suspicion?.onTaken?.(ch, rec));
    this.emit('unkindled', { id: e.id, seen: ch.seen, kind: 'person' });
  }

  // A beast, a bandit, a boss: prey that is not murder (§13b S20-11).
  takePrey(ch) {
    const g = this.game;
    const e = ch.target;
    const P = g.player;
    this.freeCreature(e);
    if (!e || e.dead || e.removed) {
      ch.outcome = 'broken';
      return;
    }
    if (ch.kind === 'boss' || ch.kind === 'tempter') {
      if (typeof e.beginDefeat === 'function') safe(() => e.beginDefeat(P));
      else if (!safe(() => g.combat?.kill?.(e, P), false)) {
        ch.outcome = 'broken';
        return;
      }
    } else {
      const c = g.combat;
      if (!c || typeof c.kill !== 'function') {
        ch.outcome = 'broken';
        return;
      }
      // Dies as creatures die (the death event, what it carried, what it was worth), but with
      // nothing of a blow about it: no clash, no spray, no flash.
      const snd = c._sound;
      const prt = c._particles;
      c._sound = () => {};
      c._particles = () => {};
      try {
        safe(() => c.kill(e, P));
      } finally {
        c._sound = snd;
        c._particles = prt;
      }
      if (!e.dead) {
        ch.outcome = 'broken';
        return;
      }
      e.flash = 0;
      e.unmarked = true;
    }
    unsilence(e);
    const k = ch.kind === 'tempter' ? 'boss' : ch.kind;
    if (this.prey[k] != null) this.prey[k]++;
    ch.fill = safe(() => this.coldfire.take(ch.kind, ch.strength), 0);
    // Whoever SAW it saw dark magic: not a crime (src/society/dark_suspicion.js, by sight.js).
    safe(() => this.suspicion?.onTaken?.(ch, null));
    this.emit('unkindled', { id: e.id ?? null, seen: [], kind: ch.kind, species: e.species || null });
  }

  // A much stronger soul: it snaps back, and they break free. They KNOW what you tried.
  resisted(ch) {
    const e = ch.target;
    this.setPhase(ch, 'snap');
    ch.outcome = 'resisted';
    ch.shown = 0;
    safe(() => this.view?.onSnap?.(ch));
    if (!e || ch.kind === 'dummy') return;
    this.freeCreature(e);
    unsilence(e);
    // Thrown back a step by it (a person; something old under the ground does not stagger).
    const P = this.game?.player;
    if (P && e.knock && ch.kind === 'person') {
      const dx = e.x - P.x;
      const dy = e.y - P.y;
      const l = Math.hypot(dx, dy) || 1;
      e.knock.x += (dx / l) * 70;
      e.knock.y += (dy / l) * 70;
    }
    this.attempts.push({ id: e.id, t: Math.round(this.now()), day: this.day(), outcome: 'resisted', knows: true });
    if (this.attempts.length > 40) this.attempts.splice(0, this.attempts.length - 40);
    if (ch.kind === 'person' || ch.kind === 'tempter' || ch.kind === 'boss') safe(() => this.village?.attempted?.(e, { outcome: 'resisted', knows: true, k: ch.k, kind: ch.kind }));
    this.emit('unkindle_resisted', { id: e.id, kind: ch.kind });
    this.emit('unkindle_attempt', { id: e.id, knows: true, outcome: 'resisted' });
  }

  finish(ch) {
    if (this.channel !== ch) return;
    ch.phase = 'done';
    const e = ch.target;
    this.freeCreature(e);
    if (e && !e.dead && ch.outcome !== 'resisted' && ch.outcome !== 'broken') unsilence(e);
    this.channel = null;
    this.cooldownUntil = this.now() + COOLDOWN;
    safe(() => this.fx?.end?.(ch));
    safe(() => this.view?.onEnd?.(ch));
    this.emit('unkindle_end', { id: e?.id ?? null, outcome: ch.outcome });
  }

  // ------------------------------------------------------------------ what shows

  // S20-6 (as replaced in §13b): no health is lost; what you take shows. The mark is
  // coldfire's (hidden: how much you have taken over time, fading slowly once you stop).
  get mark() {
    return this.coldfire?.mark ?? 0;
  }

  // Set by hand (tests, a debug hand): the signs show at once.
  set mark(v) {
    const n = Math.max(0, Number(v) || 0);
    if (!this.coldfire) return;
    this.coldfire.mark = n;
    this.coldfire.settled = n;
  }

  // 0 none, 1 faint (cold hands, breath that fogs), 2 clear, 3 strong.
  signTier() {
    return this.coldfire?.tier?.() ?? 0;
  }

  // One line for this person's Claude prompt: only what they could perceive or have been
  // told (the village side words it: src/murder/unkindled.js). '' when nothing.
  briefLine(id) {
    // What the faithful's asking needs said comes first (the verdict, decided before it is
    // worded); then what they know of the deaths; then the signs they perceive.
    const parts = [];
    const ask = safe(() => this.suspicion?.askingBrief?.(id), '') || '';
    if (ask) return ask.length > 220 ? `${ask.slice(0, 219)}…` : ask;
    const v = safe(() => this.village?.briefLine?.(id), '') || '';
    if (v) parts.push(v);
    const sg = safe(() => this.suspicion?.briefLine?.(id), '') || '';
    if (sg && (v + sg).length <= 218) parts.push(sg);
    else if (sg && !v) parts.push(sg);
    let out = parts.join(' ');
    if (out.length > 220) out = `${out.slice(0, 219).replace(/\s+\S*$/, '')}…`;
    return out;
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
      prey: { ...this.prey },
      coldfire: safe(() => this.coldfire?.serialize?.(), null),
      village: safe(() => this.village?.serialize?.(), null),
      suspicion: safe(() => this.suspicion?.serialize?.(), null),
    };
  }

  deserialize(d) {
    // A hold in progress never survives a load: whoever was held is free.
    if (this.channel) {
      const e = this.channel.target;
      this.freeCreature(e);
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
    // The taken flame (an older save has only the mark: it carries over, settled).
    safe(() => this.coldfire?.deserialize?.(d.coldfire, d.mark));
    this.lastTakenDay = Number.isFinite(d.lastTakenDay) ? d.lastTakenDay : null;
    const pr = d.prey && typeof d.prey === 'object' ? d.prey : {};
    for (const k of Object.keys(this.prey)) this.prey[k] = Math.max(0, Math.floor(Number(pr[k]) || 0));
    safe(() => this.village?.deserialize?.(d.village));
    safe(() => this.suspicion?.deserialize?.(d.suspicion));
  }

  isHeld(e) {
    const ch = this.channel;
    return !!ch && ch.target === e && (ch.phase === 'pull' || ch.phase === 'tear' || ch.phase === 'sag') && isSilenced(this.game, e);
  }
}
