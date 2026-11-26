// The villain path (round 14b, S-15; DESIGN §36.4; the author: "should I be a villain or a
// hero? Should I kill them or save them?").
//
// game.villain = new Villain(game) (villainPlugin, through src/core/plugins/society.js).
// The tempter, Isembard (src/story/tempter_data.js; LORE §9.11), waits at night outside the
// Sunken Ruins' gate once the stranger has beaten a boss or a killing of theirs is known. He
// offers the strongest magic there is for the deaths of every grown soul in Hearthvale (never
// the children: decision D1), taught BEFORE (on your word: a debt) or AFTER (when it is
// quiet). He is a person you can talk to like anyone (TOP PRIORITY A): the chat reaches him,
// he hears every word, and he answers in his own voice (Claude through his persona, or his
// own lines offline). What the game decides (a pact, a refusal) is decided before it is
// worded (seam 9).
//
//   hasPact()        a pact sealed and not broken
//   state            { met, metDay, offered, pact: 'before'|'after'|null, pactDay, gifts,
//                      kills: [ids], refused, warned: [ids], betrayed, ending, defeated, said }
//   seal(kind)       'before' | 'after' -> emits pact_sealed { gifts, pact }
//   refuse()         no (he will ask again, some night)
//   warn(byId)       the stranger tells the watch: the hero path (a broken pact is Oathbreaker)
//   livingAdults()   the grown people of the eighteen still alive and not fled
//   emptied()        game.occupation.emptied() when blood provides it, else livingAdults() = 0
//
// Contract for soul (DESIGN §37.4): when the pact is sealed, `pact_sealed { gifts: [...,
// 'unkindle'] }`; soul calls game.unkindle.learn(). The Unkindling is taught as part of
// the pact either way: "before" gives everything at once; "after" lends only the quiet hand
// now and pays the rest (`pact_paid { gifts }`) when the village is empty.
//
// Kills: he listens to villager_killed (never villager_died: decision D13) with by
// 'player', and counts a death only once it is KNOWN as a killing (an Unkindling nobody saw
// is a mystery, and counts the night it is seen, linked or proven: reputation.knownAsKilling).
// Children are never counted or required: "the village" is its adults.
//
// The dark path you can leave (round 14b follow-up, plan §13c; DESIGN §38.7). The author: "when
// I want, I can stop and say no ... we don't lock the story into that thing."
//   endPact(how)     the pact ends by your word (chat words or an option), any time, without
//                    warning anyone: you keep what you learned (game.unkindle stays learned);
//                    he turns cold and is your enemy (stands against you on a later night;
//                    the hero ending stays open); a broken word is Oathbreaker (known only to
//                    whoever knows: he alone, unless you tell). Bus 'pact_ended'.
//   offerReturn()    go back later: the price is higher each time (a named adult first, the
//   acceptReturn()   toll; more for each return); refusing the toll ends it again.
//   offerAsk()       his single asks, one at a time: a named adult, a soul brought, a family
//   acceptAsk()      flame put out on the chapel altar. Decided by the game first (pickAsk),
//   refuseAsk()      worded by his persona or his own lines. Refusing one never ends the pact.
//                    Never a child; never Lyra. Done when it is done (villager_killed by the
//                    player; the next soul taken, handed over at the gate; the flame snuffed);
//                    void when the person dies otherwise. Bus 'tempter_ask' {state, ask}.
// What is done stays done: the dead stay dead; their missions, roles and stories close or
// pass on (src/story/stays_done.js, shown in the Missions journal).
//
// Endings (story branches, saves):
//   villain  the pact kept and the village empty: the last flame goes out, the ward lets go,
//            the ruins wake. A scene, the rest of his gifts, and the life CLOSES (an end
//            page like the memorial; the save rests under Past lives).
//   hero     the tempter fought and broken (refused, or the pact betrayed): he comes apart
//            into cold blue light. A scene; the ward holds; the save CONTINUES. Beating him
//            after a pact is still breaking your word: Oathbreaker.

import { NPC } from '../entities/npc.js';
import { TILE, FACTION } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isAdult, isMinor } from '../core/people.js';
import { TEMPTER_ID, TEMPTER_PROFILE, TEMPTER_LINES, TEMPTER_RULES, tempterLocal, ASK_PEOPLE, ASK_KINDS, END_RE, RETURN_RE, YES_RE, NO_RE } from './tempter_data.js';
import { seesActor } from '../ai/sight.js';
import { knownAsKilling, byPlayer } from '../society/reputation.js';
import { ensureCharacter } from '../art/characters_art.js';
import { playScript } from '../murder/scenes.js';
import { Shapes } from '../magic/shapes.js';
import { Essences } from '../magic/essences.js';
import { Twists } from '../magic/twists.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';

// The warning travels as news (heard by meeting, like any rumour).
if (!RUMOR_KINDS.tempter_warning) RUMOR_KINDS.tempter_warning = { text: '{stranger} says something waits by the ruins gate at night, offering magic for lives', you: 'you warned us about the ruins gate', valence: 0.35, severity: 0.6, about: 'village' };
// A family flame put out on the chapel altar (his ask): seen, it is the stranger's deed; found
// at dawn, nobody's (a household's flame dark, and nobody knows who).
if (!RUMOR_KINDS.flame_snuffed) RUMOR_KINDS.flame_snuffed = { text: '{stranger} put out a family flame on the chapel altar', you: 'you put out a family flame', valence: -0.7, severity: 0.7 };
if (!RUMOR_KINDS.flame_found_out) RUMOR_KINDS.flame_found_out = { text: 'someone put out a family flame on the chapel altar in the night', you: 'a family flame was put out in the night', valence: -0.2, severity: 0.5, about: 'village' };

export const PACT_GIFTS = {
  before: ['dark', 'bloodprice', 'unkindle'],
  after: ['unkindle'],
};
// Paid when the village is empty, to a pact made "after" (and what is left, to "before").
export const PAID_GIFTS = ['dark', 'bloodprice', 'all_weaves'];
// Who the stranger may warn (the watch, the Reeve, the chapel, the huntress).
export const WARN_TO = ['rowan', 'wys', 'alder', 'aveline', 'hess', 'elda'];
const CHECK_EVERY = 1; // s
const NIGHT_FROM = 20.5;
const NIGHT_TO = 5;
// His enemy (plan §13c): on a later night, come within STAND_RANGE of him and say nothing for
// STAND_AFTER seconds, and he stands against you (a word to him holds it off: TALK_HOLDS s).
export const STAND_RANGE = 84; // px
export const STAND_AFTER = 3; // s
const TALK_HOLDS = 8; // s
// What a single ask done is paid in: the wages early (an "after" pact), else a part of a weave.
export const ASK_WAGES = ['dark', 'bloodprice'];

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[villain]', err);
    return fallback;
  }
}

function fresh() {
  return {
    met: false, metDay: null, offered: false, pact: null, pactDay: null, pactNight: null, gifts: [], paid: false, kills: [], pending: [], refused: false, refusedDay: null, warned: [], betrayed: false, ending: null, endingDay: null, defeated: false, fighting: false, said: [], verdicts: 0, hinted: false,
    // §13c: the pact ended by your word; his enmity; coming back; his single asks.
    ended: false, endedDay: null, endedNight: null, endedHow: null, oathBroken: false, oathKnownBy: [], hostile: false,
    returns: 0, returnOffer: null, asks: [], askNight: null, soulHeld: null, flamesOut: [],
  };
}

// A night belongs to the day it began (the small hours are still the night before).
function nightOf(day, hour) {
  return hour < 12 ? day - 1 : day;
}

// The tempter in the world: an NPC with his own dialogue, standing still by the gate.
export class Tempter extends NPC {
  constructor(game, villain, x, y) {
    super(game, TEMPTER_PROFILE, { x, y });
    this.villain = villain;
    this.visitor = true;
    this.essential = true; // beaten down, never killed by a blow: he comes apart instead
    this.downable = true;
    // He waits (a duty: the routine never runs). A fight goes first (npc.think).
    this.duty = { step: (npc) => villain.stand(npc) };
  }

  getDialogue(player) {
    return this.villain.dialogue(player);
  }

  chooseOption(id, player) {
    return this.villain.choose(String(id || ''), player);
  }

  withLifeOptions(d) {
    return d;
  }

  // His cold blue lamp (the lighting collects it like any carried light).
  getLight() {
    const L = (this._light ||= { x: 0, y: 0, r: 46, color: '#8fd8ff', intensity: 0.55, flicker: 0.12 });
    L.x = this.x;
    L.y = this.y - 12;
    return L;
  }

  serialize() {
    return null; // he is not saved as a villager: the villain's state brings him back
  }
}

export class Villain {
  constructor(game) {
    this.game = game;
    this.state = fresh();
    this.tempter = null;
    this.checkT = 0;
    this._wrapped = false;
  }

  get murder() {
    return this.game?.murder || null;
  }

  day() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  isNight() {
    const h = this.hour();
    return h >= NIGHT_FROM || h < NIGHT_TO;
  }

  hasPact() {
    const s = this.state;
    return !!s.pact && !s.ended && !s.betrayed && s.ending !== 'hero' && !s.defeated;
  }

  nightKey() {
    return nightOf(this.day(), this.hour());
  }

  // ------------------------------------------------------------------ leaving the pact (§13c)

  // The pact ends by your word: no warning to anyone needed. You keep what you learned; he
  // turns cold (your enemy); the word broken is Oathbreaker to whoever knows (knownBy).
  endPact(how = 'said', knownBy = []) {
    const s = this.state;
    if (!this.hasPact()) return false;
    const again = s.returns > 0;
    s.ended = true;
    s.endedDay = this.day();
    s.endedNight = this.nightKey();
    s.endedHow = how;
    s.hostile = true;
    s.betrayed = true;
    s.returnOffer = null;
    // An ask open when it ends is void (a toll unpaid stays unpaid).
    for (const a of s.asks) if (a.state === 'offered' || a.state === 'accepted') a.state = 'void';
    s.soulHeld = null;
    this.mood();
    this.breakWord(knownBy, how === 'warned' ? 'warned the village of the pact' : 'broke the pact at the ruins gate');
    safe(() => this.game.bus?.emit?.('pact_ended', { how, kept: !!safe(() => this.game.unkindle?.learned, false), again, day: s.endedDay }));
    if (how !== 'warned') safe(() => this.game.ui?.toast?.('The pact is ended. You keep what you learned. He will not forget the broken word.', 'warn', { key: 'pact', title: 'The pact' }));
    this.mark('ended', how === 'warned' ? 'The stranger broke the pact at the ruins gate by warning the village.' : 'The stranger told the pilgrim at the ruins gate that the pact is over.');
    return true;
  }

  // A broken word: Oathbreaker, to those who know it (each knower once).
  breakWord(knownBy = [], note = 'broke the pact') {
    const s = this.state;
    s.oathBroken = true;
    const fresh = (knownBy || []).filter((id) => id && !s.oathKnownBy.includes(id));
    if (!fresh.length && s.oathKnownBy.includes('__self')) return;
    if (!fresh.length) s.oathKnownBy.push('__self'); // known to him alone
    s.oathKnownBy.push(...fresh);
    safe(() => this.game.reputation?.oath?.('tempter', { kept: false, knownBy: fresh, note }));
  }

  // Going back (plan §13c): the price is higher each time: a named adult first (the toll),
  // one more for each return. -> the terms, or null (nobody left he could name).
  offerReturn() {
    const s = this.state;
    if (!s.pact || !s.ended || s.ending || s.defeated) return null;
    const n = s.returns + 1;
    const toll = [];
    const taken = new Set();
    for (let i = 0; i < n; i++) {
      const p = this.pickPerson(taken);
      if (!p) break;
      taken.add(p.id);
      toll.push(p);
    }
    if (!toll.length) return null;
    s.returnOffer = { n, toll: toll.map((p) => ({ id: p.id, why: p.why })), night: this.nightKey(), day: this.day() };
    safe(() => this.game.bus?.emit?.('tempter_return', { state: 'offered', terms: { ...s.returnOffer } }));
    return s.returnOffer;
  }

  acceptReturn() {
    const s = this.state;
    const o = s.returnOffer;
    if (!o || !s.ended) return false;
    s.returnOffer = null;
    s.ended = false;
    s.betrayed = false;
    s.hostile = false;
    s.fighting = false;
    s.returns = o.n;
    s.pactNight = this.nightKey();
    this.mood();
    for (const p of o.toll) this.newAsk('person', p.id, p.why, { toll: true, state: 'accepted' });
    safe(() => this.game.bus?.emit?.('tempter_return', { state: 'accepted', terms: o }));
    this.mark('returned', `The stranger went back to the pilgrim at the ruins gate; the price is ${o.toll.map((p) => this.name(p.id)).join(' and ')} first.`);
    safe(() => this.game.ui?.toast?.(`The pact holds again, at a higher price: ${o.toll.map((p) => this.name(p.id)).join(' and ')} first.`, 'warn', { key: 'pact', title: 'The pact' }));
    return true;
  }

  declineReturn() {
    const s = this.state;
    if (!s.returnOffer) return false;
    s.returnOffer = null;
    safe(() => this.game.bus?.emit?.('tempter_return', { state: 'declined' }));
    return true;
  }

  // ------------------------------------------------------------------ his single asks (§13c)

  // The ask open now (offered or accepted), else null. One at a time.
  currentAsk() {
    for (let i = this.state.asks.length - 1; i >= 0; i--) {
      const a = this.state.asks[i];
      if (a.state === 'offered' || a.state === 'accepted') return a;
    }
    return null;
  }

  // A grown person he may name: alive, here, an adult the blade could take; never a child,
  // never Lyra (she lives for herself), never the one walking with you, nobody asked before.
  pickPerson(skip = new Set()) {
    const g = this.game;
    const m = this.murder;
    const asked = new Set(this.state.asks.map((a) => a.target));
    const holder = safe(() => g.party?.holder?.id, null);
    for (const c of ASK_PEOPLE) {
      if (skip.has(c.id) || asked.has(c.id) || c.id === 'lyra' || c.id === holder) continue;
      if (m?.dead?.[c.id]) continue;
      const e = g?.entities?.get?.(c.id);
      if (!e || e.removed || e.dead || e.absent) continue;
      if (isMinor(g, e) || !isAdult(g, e)) continue;
      if (typeof m?.canKill === 'function' && !safe(() => m.canKill(e), false)) continue;
      return c;
    }
    return null;
  }

  // A household whose flame burns on the chapel altar (its head alive), not put out before.
  pickFlame() {
    const out = new Set(this.state.flamesOut.map((f) => f.house));
    const asked = new Set(this.state.asks.filter((a) => a.kind === 'flame').map((a) => a.target));
    for (const id of ['bram', 'garrick', 'tobias', 'sabeth', 'corran', 'elda', 'mira', 'hess', 'alder']) {
      if (out.has(id) || asked.has(id) || this.murder?.dead?.[id]) continue;
      if (!this.game?.entities?.get?.(id)) continue;
      return id;
    }
    return null;
  }

  houseName(id) {
    const full = safe(() => this.game.entities.get(id)?.profile?.name, '') || '';
    const parts = String(full).replace(/"[^"]*"\s*/g, '').trim().split(/\s+/);
    return parts.length > 1 ? `the ${parts[parts.length - 1]} household` : `${this.name(id)}'s household`;
  }

  // The game picks what he asks for next (never a child), in turn: a person, a soul, a flame.
  pickAsk() {
    const n = this.state.asks.filter((a) => !a.toll).length;
    for (let i = 0; i < ASK_KINDS.length; i++) {
      const kind = ASK_KINDS[(n + i) % ASK_KINDS.length];
      if (kind === 'person') {
        const p = this.pickPerson();
        if (p) return { kind, target: p.id, why: p.why };
      } else if (kind === 'soul') {
        if (safe(() => this.game.unkindle?.learned, false)) return { kind, target: null, why: '' };
      } else if (kind === 'flame') {
        const h = this.pickFlame();
        if (h && this.altar()) return { kind, target: h, why: '' };
      }
    }
    return null;
  }

  newAsk(kind, target, why = '', { toll = false, state = 'offered' } = {}) {
    const s = this.state;
    const a = { id: `ask${s.asks.length + 1}`, kind, target: target || null, why: why || '', state, toll: !!toll, day: this.day(), night: this.nightKey(), doneDay: null };
    s.asks.push(a);
    if (s.asks.length > 30) s.asks.splice(0, s.asks.length - 30);
    safe(() => this.game.bus?.emit?.('tempter_ask', { state, ask: { ...a } }));
    return a;
  }

  // He asks (at most once a night, one at a time, and only with a pact). -> the ask or null.
  offerAsk({ force = false } = {}) {
    const s = this.state;
    if (!this.hasPact() || s.ending || this.currentAsk()) return null;
    if (!force && (s.askNight === this.nightKey() || s.pactNight === this.nightKey())) return null;
    const pick = this.pickAsk();
    if (!pick) return null;
    s.askNight = this.nightKey();
    return this.newAsk(pick.kind, pick.target, pick.why);
  }

  acceptAsk() {
    const a = this.currentAsk();
    if (!a || a.state !== 'offered') return false;
    a.state = 'accepted';
    safe(() => this.game.bus?.emit?.('tempter_ask', { state: 'accepted', ask: { ...a } }));
    this.mark('ask', `The stranger agreed to the pilgrim's ask: ${this.askText(a)}.`);
    return true;
  }

  // No to one ask: the pact holds (a toll refused is the pact refused: it ends again).
  refuseAsk() {
    const a = this.currentAsk();
    if (!a) return false;
    if (a.toll) return this.endPact('said') ? 'ended' : false;
    a.state = 'refused';
    safe(() => this.game.bus?.emit?.('tempter_ask', { state: 'refused', ask: { ...a } }));
    return 'refused';
  }

  askText(a) {
    if (!a) return '';
    if (a.kind === 'person') return `${this.name(a.target)}'s death`;
    if (a.kind === 'soul') return 'a soul brought to him';
    return `the flame of ${this.houseName(a.target)} put out`;
  }

  // His words for an ask (the game's words; Claude says them his way online).
  askLines(a) {
    const L = TEMPTER_LINES;
    if (!a) return [];
    if (a.kind === 'person') return L.askPerson.map((x) => x.replace('{why}', a.why || '').replace('{name}', this.name(a.target))).filter(Boolean);
    if (a.kind === 'soul') return [...L.askSoul];
    return L.askFlame.map((x) => x.replace('{house}', this.houseName(a.target)));
  }

  completeAsk(a, how = '') {
    if (!a || (a.state !== 'accepted' && a.state !== 'offered')) return false;
    const s = this.state;
    a.state = 'done';
    a.doneDay = this.day();
    a.how = how;
    let gift = null;
    if (!a.toll) gift = this.askWage();
    safe(() => this.game.bus?.emit?.('tempter_ask', { state: 'done', ask: { ...a }, gift }));
    this.mark('ask_done', `The stranger did what the pilgrim asked: ${this.askText(a)}.`);
    if (a.toll && !s.asks.some((x) => x.toll && x.state === 'accepted')) safe(() => this.game.ui?.toast?.('The price is paid. The pact holds as it did.', 'warn', { key: 'pact', title: 'The pact' }));
    else if (gift) safe(() => this.game.ui?.toast?.(`He keeps his word: ${gift.label}.`, 'warn', { key: 'tempter_gift', title: 'The pilgrim at the gate' }));
    return true;
  }

  // What an ask done is paid in: the "after" pact's wages early, else a part of a weave.
  askWage() {
    const mg = this.game?.magic;
    const has = (kind, id) => !!safe(() => mg?.isUnlocked?.(kind, id), false);
    for (const w of ASK_WAGES) {
      const kind = w === 'dark' ? 'essences' : 'prices';
      if (!has(kind, w)) {
        this.grant([w]);
        if (!this.state.gifts.includes(w)) this.state.gifts.push(w);
        return { id: w, label: w === 'dark' ? 'shadow, the dark essence' : 'the blood price' };
      }
    }
    for (const [kind, reg, word] of [['twists', Twists, 'twist'], ['shapes', Shapes, 'shape']]) {
      for (const id of safe(() => reg.ids(), []) || []) {
        if (has(kind, id)) continue;
        safe(() => mg?.unlock?.(kind, id, 'pact'));
        return { id, label: `a ${word}: ${safe(() => reg.get(id)?.name, id) || id}` };
      }
    }
    return null;
  }

  // A person he asked for died by another hand, or of age: the ask is void.
  voidAsk(a) {
    if (!a || a.state === 'done') return;
    a.state = 'void';
    safe(() => this.game.bus?.emit?.('tempter_ask', { state: 'void', ask: { ...a } }));
  }

  // The next soul taken with the Unkindling, after a soul ask: carried for him.
  onUnkindled(p) {
    const a = this.currentAsk();
    if (!a || a.kind !== 'soul' || a.state !== 'accepted' || this.state.soulHeld) return;
    const kind = String(p?.kind || 'beast');
    if (kind === 'dummy') return;
    const fill = safe(() => this.game.unkindle?.coldfire?.fillFor?.(kind), 0) || 0;
    this.state.soulHeld = { kind, id: p?.id ?? null, fill, day: this.day() };
  }

  // Handed over at the gate: he takes the soul you carried (the bar gives back what it gave).
  deliverSoul() {
    const s = this.state;
    const a = this.currentAsk();
    if (!a || a.kind !== 'soul' || !s.soulHeld) return false;
    const cf = safe(() => this.game.unkindle?.coldfire, null);
    if (cf && Number.isFinite(cf.bar)) {
      cf.bar = Math.max(0, Math.round((cf.bar - (s.soulHeld.fill || 0)) * 100) / 100);
      safe(() => cf.touch?.());
      safe(() => this.game.bus?.emit?.('coldfire', { bar: cf.bar, add: -(s.soulHeld.fill || 0), kind: 'given', mark: cf.mark }));
    }
    s.soulHeld = null;
    return this.completeAsk(a, 'brought');
  }

  // The chapel altar in Hearthvale (not the black one in the ruins).
  altar() {
    const objs = safe(() => this.game.objects?.all?.(), null) || safe(() => this.game.objects?.list, null) || [];
    for (const o of objs) if (o?.objType === 'altar' && o.variant !== 'dark') return o;
    return null;
  }

  // While a flame ask is agreed, the altar's use is to put that flame out (an instance
  // wrapper: the altar's own code is untouched).
  wrapAltar() {
    const alt = this.altar();
    if (!alt || alt._tempterWrapped) return;
    alt._tempterWrapped = true;
    const self = this;
    const label = alt.interactLabel.bind(alt);
    const use = alt.interact.bind(alt);
    alt.interactLabel = function () {
      const a = self.currentAsk();
      return a?.kind === 'flame' && a.state === 'accepted' ? 'Put out a flame' : label();
    };
    alt.interact = function (actor) {
      const a = self.currentAsk();
      if (a?.kind === 'flame' && a.state === 'accepted' && actor === self.game?.player) return self.snuffFlame(actor);
      return use(actor);
    };
  }

  // The deed: a household's flame goes out. Seen (sight.js), it is yours to the one who saw;
  // unseen, Aveline finds it dark at dawn and nobody knows who.
  snuffFlame(actor = this.game?.player) {
    const s = this.state;
    const a = this.currentAsk();
    if (!a || a.kind !== 'flame') return false;
    const g = this.game;
    const people = safe(() => g.entities.all().filter((e) => e?.profile && !e.visitor && !e.dead && !e.removed && e !== actor), []) || [];
    const seen = people.filter((e) => safe(() => seesActor(g, e, actor), false)).map((e) => e.id);
    s.flamesOut.push({ house: a.target, day: this.day(), night: this.nightKey(), seen, found: false });
    const alt = this.altar();
    safe(() => g.particles?.emit?.('smoke', alt?.x ?? actor.x, (alt?.y ?? actor.y) - 14, { count: 8, speed: 10, life: 1.2 }));
    safe(() => g.ui?.toast?.(`You pinch out the flame of ${this.houseName(a.target)}. A thin thread of smoke, and the altar is one light darker.`, 'warn', { key: 'flame_out', title: 'The chapel altar' }));
    if (seen.length) {
      safe(() => g.village?.addRumor?.('flame_snuffed', { witnesses: seen, source: seen[0] }));
      for (const id of seen) safe(() => g.village?.adjustOpinion?.(id, -8, 'put out a family flame'));
    }
    safe(() => g.bus?.emit?.('flame_snuffed', { house: a.target, seen }));
    this.completeAsk(a, 'snuffed');
    return true;
  }

  // At dawn the keeper finds a dark flame nobody saw put out, and relights it.
  dawnFlames() {
    const s = this.state;
    if (this.hour() < 6 || this.hour() > 11) return;
    for (const f of s.flamesOut) {
      if (f.found || f.seen.length || this.day() <= f.night) continue;
      f.found = true;
      const keeper = this.murder?.dead?.aveline ? 'petra' : 'aveline';
      safe(() => this.game.village?.addRumor?.('flame_found_out', { witnesses: [keeper], source: keeper, about: 'village' }));
      this.mark('flame_found', `${this.name(keeper)} found the flame of ${this.houseName(f.house)} out on the chapel altar this morning, and lit it again. Nobody knows who put it out.`);
    }
  }

  // ------------------------------------------------------------------ the village

  livingAdults() {
    const g = this.game;
    const m = this.murder;
    return VILLAGERS.filter((id) => {
      if (m?.dead?.[id]) return false;
      const e = g?.entities?.get?.(id);
      if (!e || e.removed || e.dead) return false;
      const cause = e.absent?.cause;
      if (cause && /fled|taken|left|gone|killed|died|age/.test(String(cause))) return false;
      if (!isAdult(g, e)) return false;
      // Only those a blow can take count (children never, and no one the game spares).
      return typeof m?.canKill === 'function' ? !!safe(() => m.canKill(e), true) : true;
    });
  }

  emptied() {
    const o = this.game?.occupation;
    if (typeof o?.emptied === 'function') {
      const v = safe(() => o.emptied(), null);
      if (typeof v === 'boolean') return v;
    }
    return this.livingAdults().length === 0;
  }

  // ------------------------------------------------------------------ kills

  onKilled(p) {
    if (!p || p.by !== 'player') return;
    const id = p.id || p.entity?.id;
    if (!id || id === TEMPTER_ID || !VILLAGERS.includes(id)) return;
    const s = this.state;
    if (s.kills.includes(id) || s.pending.includes(id)) return;
    s.pending.push(id);
    this.settleKills();
  }

  // A killing counts once it is known as a killing (the Unkindling unseen does not, yet).
  settleKills() {
    const s = this.state;
    const m = this.murder;
    if (!s.pending.length || !m) return;
    const still = [];
    for (const id of s.pending) {
      const rec = m.dead?.[id];
      if (!rec || !byPlayer(rec)) continue;
      if (knownAsKilling(m, rec)) {
        if (!s.kills.includes(id)) s.kills.push(id);
      } else still.push(id);
    }
    s.pending = still;
  }

  progress() {
    const left = this.livingAdults().length;
    const done = this.state.kills.length;
    return { left, done, total: left + done };
  }

  // ------------------------------------------------------------------ the pact

  seal(kind = 'after') {
    const s = this.state;
    const pact = kind === 'before' ? 'before' : 'after';
    if (s.pact || s.ending || s.defeated) return false;
    s.met = true;
    s.metDay ??= this.day();
    s.offered = true;
    s.pact = pact;
    s.pactDay = this.day();
    s.pactNight = this.nightKey();
    s.refused = false;
    const gifts = [...PACT_GIFTS[pact]];
    s.gifts = gifts;
    this.grant(gifts.filter((x) => x !== 'unkindle'));
    if (pact === 'before') s.paid = true;
    safe(() => this.game.bus?.emit?.('pact_sealed', { gifts: [...gifts], pact, by: TEMPTER_ID, day: s.pactDay }));
    safe(() => this.game.ui?.toast?.(pact === 'before' ? 'The pact is sealed. Cold runs up your arm and stays: shadow, a price in blood, and the quiet hand. You owe him the village.' : 'The pact is sealed. He lends you the quiet hand now; the rest when the village is quiet.', 'warn', { key: 'pact', title: 'The pact' }));
    this.mark('pact', `The stranger made a pact with the pilgrim at the ruins gate (${pact}).`);
    return true;
  }

  // Magic he gives: essences and prices through magic.unlock; 'all_weaves' is everything.
  grant(list) {
    const mg = this.game?.magic;
    if (!mg?.unlock) return;
    for (const g of list) {
      if (g === 'dark') safe(() => mg.unlock('essences', 'dark', 'pact'));
      else if (g === 'bloodprice') safe(() => mg.unlock('prices', 'bloodprice', 'pact'));
      else if (g === 'all_weaves') {
        for (const [kind, reg] of [['shapes', Shapes], ['essences', Essences], ['twists', Twists]]) for (const id of safe(() => reg.ids(), []) || []) safe(() => mg.unlock(kind, id, 'pact'));
      }
    }
  }

  refuse() {
    const s = this.state;
    if (s.pact) return false;
    s.met = true;
    s.offered = true;
    s.refused = true;
    s.refusedDay = this.day();
    this.mark('refused', 'The stranger refused the pilgrim at the ruins gate.');
    return true;
  }

  // The stranger tells someone what waits at the gate: the hero path.
  warn(byId) {
    const s = this.state;
    if (!byId || s.warned.includes(byId) || s.ending) return false;
    s.warned.push(byId);
    if (this.hasPact()) {
      // Warning the village breaks the pact (§13c: the same end, said to someone else).
      this.endPact('warned', [byId]);
      safe(() => this.game.bus?.emit?.('pact_broken', { by: 'player', why: 'warned', to: byId }));
    } else if (s.pact) this.breakWord([byId], 'made a pact at the ruins gate, and broke it'); // they learn it now
    s.hostile = true; // he knows you told
    this.mood();
    safe(() => this.game.village?.addRumor?.('tempter_warning', { witnesses: [byId], source: byId }));
    this.mark('warned', `The stranger warned ${this.name(byId)} about the pilgrim at the ruins gate.`);
    return true;
  }

  name(id) {
    return safe(() => this.game.entities.get(id)?.profile?.name?.split(' ')[0], null) || id;
  }

  mark(kind, text) {
    safe(() => this.game.villageLife?.events?.push?.({ kind: `villain_${kind}`, text, t: this.game.clock?.t ?? 0, day: this.day() }));
    safe(() => this.game.bus?.emit?.('villain', { kind, text }));
  }

  // ------------------------------------------------------------------ the tempter

  // Has the stranger shown him anything yet? A boss beaten, or a killing known.
  noticed() {
    const s = this.state;
    if (s.met) return true;
    const bosses = this.game?.flags?.bosses;
    if (bosses && Object.values(bosses).some((b) => b?.defeated)) return true;
    return Object.values(this.murder?.dead || {}).some((r) => byPlayer(r) && knownAsKilling(this.murder, r));
  }

  wanted() {
    const s = this.state;
    if (s.ending || s.defeated) return false;
    if (s.fighting) return true;
    return this.noticed() && this.isNight();
  }

  gatePoint() {
    const g = this.game;
    const gate = safe(() => g.objects?.get?.('ruins_gate'), null);
    const tx = Number.isFinite(gate?.tx) ? gate.tx : Number.isFinite(gate?.x) ? Math.floor(gate.x / TILE) : null;
    const ty = Number.isFinite(gate?.ty) ? gate.ty : Number.isFinite(gate?.y) ? Math.floor(gate.y / TILE) : null;
    const base = tx != null && ty != null ? { tx, ty: ty - 3 } : (() => {
      const loc = safe(() => g.locations?.get?.('sunken_ruins'), null);
      const b = loc?.bounds;
      return b ? { tx: b.x + 20, ty: b.y - 3 } : { tx: 24, ty: 96 };
    })();
    for (let r = 0; r < 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = base.tx + dx;
          const y = base.ty + dy;
          const blocked = safe(() => g.isBlockedTile?.(x, y, null), false) || safe(() => g.map?.isWater?.(x, y), false);
          if (!blocked) return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
        }
      }
    }
    return { x: base.tx * TILE + TILE / 2, y: base.ty * TILE + TILE / 2 };
  }

  spawn() {
    const g = this.game;
    if (this.tempter && !this.tempter.removed) return this.tempter;
    if (!g?.entities?.add) return null;
    const at = this.gatePoint();
    if (g.atlas && typeof document !== 'undefined') safe(() => ensureCharacter(g.atlas, TEMPTER_PROFILE.spriteKey, TEMPTER_PROFILE.appearance));
    const t = safe(() => new Tempter(g, this, at.x, at.y), null);
    if (!t) return null;
    this.tempter = g.entities.add(t);
    this.mood();
    if (!this.state.hinted) {
      this.state.hinted = true;
      safe(() => g.ui?.toast?.('A cold blue lamp burns outside the ruins gate tonight. Someone is waiting there.', 'info', { key: 'tempter_hint', title: 'The ruins gate' }));
    }
    return this.tempter;
  }

  vanish() {
    const t = this.tempter;
    this.tempter = null;
    if (!t || t.removed) return;
    safe(() => this.game.particles?.emit?.('sparkle', t.x, t.y - 10, { count: 14, color: '#8fd8ff', speed: 20, life: 1 }));
    safe(() => this.game.entities.remove(t));
  }

  // How he stands with you (the chat's header reads it): cold once the word is broken.
  mood() {
    const t = this.tempter;
    if (!t) return;
    t.opinionOfPlayer = this.state.hostile ? 6 : TEMPTER_PROFILE.startOpinion;
  }

  // His duty each frame: stand, face the stranger when near. Returns true (the routine waits).
  stand(npc) {
    const P = this.game?.player;
    npc.moveIntent.x = 0;
    npc.moveIntent.y = 0;
    if (P && Math.hypot(P.x - npc.x, P.y - npc.y) < 120) safe(() => npc.faceToward(P.x, P.y));
    return true;
  }

  update(dt) {
    const g = this.game;
    if (!g || (g.state && g.state !== 'playing')) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = CHECK_EVERY;
    this.wrapTalk();
    this.wrapAltar();
    this.settleKills();
    const s = this.state;
    if (this.wanted()) this.spawn();
    else if (this.tempter && !s.fighting && !safe(() => g.ui?.isModalOpen?.(), false)) this.vanish();
    const t = this.tempter;
    if (t && s.fighting && (t.downed || t.hp <= 0)) this.defeat();
    this.standAgainst(CHECK_EVERY);
    if (s.flamesOut.length) this.dawnFlames();
    if (this.hasPact() && !s.ending && this.emptied()) this.villainEnding();
  }

  // ------------------------------------------------------------------ talking

  // The chat reaches him like anyone (TOP PRIORITY A): his words through his own mind. A
  // wrapper on the village's playerSays for him alone; everyone else goes on as before.
  wrapTalk() {
    const v = this.game?.village;
    if (this._wrapped || !v || typeof v.playerSays !== 'function') return;
    const orig = v.playerSays.bind(v);
    const self = this;
    v.playerSays = function (npc, text, opts) {
      const e = typeof npc === 'string' ? this.entity?.(npc) : npc;
      if (e?.id === TEMPTER_ID) return self.playerSays(e, text, opts);
      return orig(npc, text, opts);
    };
    this._wrapped = true;
  }

  // Heard first, kept, then decided, then worded.
  async playerSays(e, text) {
    const said = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const s = this.state;
    if (!said) return { lines: ['Hm?'], mood: 'amused', source: 'local' };
    s.said.push({ t: Math.round(this.game?.clock?.t ?? 0), day: this.day(), text: said });
    if (s.said.length > 30) s.said.splice(0, s.said.length - 30);
    s.met = true;
    s.metDay ??= this.day();
    safe(() => this.game.village?.heard?.(e, said, {}));
    this._spokeAt = this.game?.time ?? 0;
    // What the game decides before anyone words it: a pact, a refusal, the end of it, coming
    // back, yes or no to one of his asks, a soul handed over, a new ask.
    const decided = this.decide(said);
    const local = this.localLines(said, decided);
    let lines = local;
    const v = this.game?.village;
    const provider = safe(() => v?.provider?.(), null);
    if (provider && typeof v?.askClaude === 'function') {
      const r = await v.askClaude(provider, TEMPTER_RULES, this.task(said, decided), TEMPTER_SCHEMA, 'tempter');
      const say = typeof r?.say === 'string' ? r.say.trim().slice(0, 400) : '';
      if (r?.silent === true) return { lines: [], silent: true, narration: 'Isembard hears you. He only smiles, and says nothing.', mood: 'amused', source: 'claude' };
      if (say) lines = [say];
    }
    return { lines, mood: s.hostile ? 'cold' : 'amused', source: provider ? 'claude' : 'local', decided: decided || null };
  }

  decide(said) {
    const t = said.toLowerCase();
    const s = this.state;
    if (s.ending || s.defeated) return null;
    // The pact ended (§13c): coming back, at a higher price, in two words: back, then yes.
    if (s.pact && s.ended) {
      if (s.returnOffer) {
        if (YES_RE.test(t) && !NO_RE.test(t)) return this.acceptReturn() ? 'returned' : null;
        if (NO_RE.test(t) || END_RE.test(t)) return this.declineReturn() ? 'return_declined' : null;
      }
      if (RETURN_RE.test(t) && !NO_RE.test(t)) return this.offerReturn() ? 'return_terms' : 'return_none';
      if (END_RE.test(t)) return 'no_pact';
      return null;
    }
    if (this.hasPact()) {
      // "I'm done", in the stranger's own words: the pact ends, any time.
      if (END_RE.test(t)) return this.endPact('said') ? 'ended' : null;
      const a = this.currentAsk();
      if (a?.state === 'offered') {
        if (YES_RE.test(t) && !NO_RE.test(t)) return this.acceptAsk() ? 'ask_accepted' : null;
        if (NO_RE.test(t)) {
          const r = this.refuseAsk();
          return r === 'ended' ? 'ended' : r ? 'ask_refused' : null;
        }
      } else if (a?.state === 'accepted' && a.toll && NO_RE.test(t) && /\b(won'?t|will not|not doing|refuse)\b/.test(t)) {
        return this.refuseAsk() === 'ended' ? 'ended' : null;
      }
      if (a?.kind === 'soul' && s.soulHeld) return this.deliverSoul() ? 'ask_done' : null;
      if (!a && this.offerAsk()) return 'ask_offered';
      if (!a && /^\s*(no|nope)\W*$/.test(t)) return 'no_bare';
      return null;
    }
    if (!s.pact) {
      if (/\b(teach me (now|first)|now,? then|before\b.*\b(deal|accept|yes)|i accept.*\bbefore|deal.*\bbefore)\b/.test(t)) return this.seal('before') ? 'before' : null;
      if (/\b(teach me after|after,? then|after\b.*\b(deal|accept|yes)|i accept|deal|i'?ll do it|i will do it)\b/.test(t) && !/\b(no|never|not)\b/.test(t)) return this.seal('after') ? 'after' : null;
      if (/\b(no|never|i refuse|go away|leave me|not doing that)\b/.test(t) && s.offered) return this.refuse() ? 'refused' : null;
      if (!s.offered) s.offered = true;
    }
    return null;
  }

  localLines(said, decided) {
    const s = this.state;
    const L = TEMPTER_LINES;
    const a = this.currentAsk();
    const last = s.asks[s.asks.length - 1];
    if (decided === 'before') return [...L.sealedBefore];
    if (decided === 'after') return [...L.sealedAfter];
    if (decided === 'refused') return [L.refused[s.said.length % L.refused.length]];
    if (decided === 'ended') return s.returns > 0 ? [...L.endedAgain, L.ended[1]] : [...L.ended];
    if (decided === 'no_pact') return [...L.noPact];
    if (decided === 'return_terms') {
      const names = (s.returnOffer?.toll || []).map((p) => this.name(p.id)).join(' and ');
      return (s.returns > 0 ? L.returnTermsMore : L.returnTerms).map((x) => x.replace('{name}', names));
    }
    if (decided === 'return_none') return [...L.returnNone];
    if (decided === 'returned') return L.returned.map((x) => x.replace('{name}', s.asks.filter((q) => q.toll && q.state === 'accepted').map((q) => this.name(q.target)).join(' and ') || 'them'));
    if (decided === 'return_declined') return [...L.returnDeclined];
    if (decided === 'ask_offered') return this.askLines(a);
    if (decided === 'ask_accepted') return [...L.askAccepted];
    if (decided === 'ask_refused') return [L.askRefused[s.asks.length % L.askRefused.length]];
    if (decided === 'ask_done') return [...(L.askDone[last?.kind] || L.askDone.person)];
    if (decided === 'no_bare') return [...L.noBare];
    if (/\b(child|children|kid|kids|pip|tansy|little ones?)\b/.test(String(said).toLowerCase())) return [...L.childAsk];
    if (s.hostile) return [L.cold[s.said.length % L.cold.length]];
    if (a?.state === 'accepted') return L.askWaiting.map((x) => x.replace('{task}', this.askText(a).replace(/^./, (c) => c.toUpperCase())));
    return [tempterLocal(said, s)];
  }

  // His brief for Claude: only what he knows (the pact, the count he keeps, what was said).
  task(said, decided) {
    const s = this.state;
    const P = this.game?.settings?.playerName || 'the stranger';
    const pr = this.progress();
    const a = this.currentAsk();
    const DECIDED = {
      ended: 'The game has decided: they have ended the pact, just now, and they keep what they learned. You are cold now, courteous, and their enemy. Say so your way.',
      no_pact: 'There is no pact between you to end; say so your way.',
      return_terms: `The game has decided: they want the pact back. The price is higher: ${(s.returnOffer?.toll || []).map((p) => this.name(p.id)).join(' and ')} first. Name that price your way and wait for their yes.`,
      return_none: 'They want the pact back, but there is nobody left you could name as the price. Send them home your way.',
      returned: 'The game has decided: they agreed to your higher price; the pact holds again once it is paid. Say so your way.',
      return_declined: 'They would not pay the higher price. You remain enemies. Say so your way.',
      ask_offered: a ? `The game has decided: tonight you ask them for one thing: ${this.askText(a)}${a.why ? ` (${a.why})` : ''}. Ask it your way; never a child.` : '',
      ask_accepted: 'The game has decided: they agreed to your ask. Say so your way.',
      ask_refused: 'The game has decided: they refused that one ask; the pact still holds. Say so your way.',
      ask_done: 'The game has decided: they brought what you asked; you take it and pay them. Say so your way.',
      no_bare: 'They said a bare "no", to nothing in particular. Ask them what they mean, your way.',
    };
    const bits = [
      `You are Isembard. ${P} (the player) speaks to you by the ruins gate at night.`,
      s.pact && s.ended ? `They made a pact with you and broke it (${s.endedHow === 'warned' ? 'they warned the village' : 'they told you it was over'}); you are cold to them now, their enemy${s.returns ? `; they came back ${s.returns} time${s.returns > 1 ? 's' : ''} before` : ''}.` : s.pact ? `The pact is sealed (${s.pact}). ${pr.done} of the village's ${pr.total} grown souls are dead by their hand; ${pr.left} still keep a flame.${a ? ` The one thing you asked of them${a.state === 'accepted' ? ', and they agreed to,' : ''}: ${this.askText(a)}${a.toll ? ' (the price of coming back)' : ''}.` : ''}` : s.refused ? 'They refused your offer; you are patient.' : 'You have offered them your magic for the deaths of every grown soul in Hearthvale, taught before (a debt) or after.',
      decided === 'before' || decided === 'after' ? `The game has decided: the pact is sealed just now (${decided}). Say so your way.` : decided === 'refused' ? 'The game has decided: they refuse, for now. Say so your way.' : DECIDED[decided] || '',
      `Earlier tonight they said: ${s.said.slice(-4, -1).map((x) => `"${x.text}"`).join(' ') || 'nothing yet'}.`,
      `They say now: "${said}"`,
      'Answer as JSON: {"say": string, "silent": boolean|null}.',
    ];
    return bits.filter(Boolean).join('\n');
  }

  brief(said) {
    return this.task(said, null);
  }

  // ------------------------------------------------------------------ his dialogue (E)

  dialogue() {
    const s = this.state;
    const lines = [];
    this._spokeAt = this.game?.time ?? 0;
    const a = this.currentAsk();
    if (s.pact && s.ended) {
      lines.push(...TEMPTER_LINES.cold);
      return { lines, options: this.options() };
    }
    if (this.hasPact() && a?.kind === 'soul' && s.soulHeld) {
      this.deliverSoul();
      lines.push(...TEMPTER_LINES.askDone.soul);
      return { lines, options: this.options() };
    }
    if (this.hasPact() && !a && this.offerAsk()) {
      lines.push(...this.askLines(this.currentAsk()));
      return { lines, options: this.options() };
    }
    if (!s.met) {
      s.met = true;
      s.metDay = this.day();
      s.offered = true;
      lines.push(...TEMPTER_LINES.first, ...TEMPTER_LINES.offer);
      this.mark('met', 'The stranger met the pilgrim at the ruins gate.');
    } else if (s.pact) {
      const pr = this.progress();
      if (a?.state === 'offered') lines.push(...this.askLines(a));
      else if (a?.state === 'accepted') lines.push(TEMPTER_LINES.askWaiting[0].replace('{task}', this.askText(a).replace(/^./, (c) => c.toUpperCase())));
      else lines.push(TEMPTER_LINES.count[this.day() % TEMPTER_LINES.count.length].replace('{left}', pr.left).replace('{done}', pr.done).replace('{total}', pr.total));
    } else if (s.warned.length) lines.push(...TEMPTER_LINES.warned);
    else lines.push(TEMPTER_LINES.idle[this.day() % TEMPTER_LINES.idle.length]);
    return { lines, options: this.options() };
  }

  options() {
    const s = this.state;
    const o = [];
    if (!s.pact && !s.ending) {
      o.push({ id: 'why', label: 'Why me?' }, { id: 'what', label: 'What would you teach?' }, { id: 'price', label: 'What is the price?' });
      o.push({ id: 'before', label: 'Teach me now. (a debt)' }, { id: 'after', label: 'Teach me after.' });
      if (!s.refused) o.push({ id: 'refuse', label: 'No.' });
    }
    if (s.pact && s.ended && !s.ending && !s.defeated) {
      if (s.returnOffer) o.push({ id: 'return_yes', label: 'Yes. Whatever it costs.' }, { id: 'return_no', label: 'No. Not at that price.' });
      else o.push({ id: 'return', label: 'I want the pact back.' });
    }
    if (this.hasPact()) {
      const a = this.currentAsk();
      if (a?.state === 'offered') o.push({ id: 'ask_yes', label: 'Yes. I will do it.' }, { id: 'ask_no', label: 'No. Not that.' });
      o.push({ id: 'count', label: 'How many are left?' });
      o.push({ id: 'end', label: "I'm done. The pact is over." });
    }
    o.push({ id: 'bye', label: 'Leave' });
    return o;
  }

  choose(id) {
    const s = this.state;
    const opts = () => this.options();
    const L = TEMPTER_LINES;
    switch (id) {
      case 'bye':
        return { lines: [L.farewells?.[0] || 'Until the next dark, my friend.'], close: true };
      case 'why':
        return { lines: [...L.why], options: opts() };
      case 'what':
        return { lines: [...L.what], options: opts() };
      case 'price':
        return { lines: [...L.offer], options: opts() };
      case 'before':
        return this.seal('before') ? { lines: [...L.sealedBefore], options: opts() } : { lines: ['It is already done, my friend.'], options: opts() };
      case 'after':
        return this.seal('after') ? { lines: [...L.sealedAfter], options: opts() } : { lines: ['It is already done, my friend.'], options: opts() };
      case 'refuse':
        this.refuse();
        return { lines: [L.refused[0]], options: opts() };
      case 'count': {
        const pr = this.progress();
        return { lines: [L.count[1].replace('{left}', pr.left).replace('{done}', pr.done).replace('{total}', pr.total)], options: opts() };
      }
      // §13c: leave it, come back, his single asks.
      case 'end':
        return this.endPact('said') ? { lines: this.localLines('', 'ended'), options: opts() } : { lines: [...L.noPact], options: opts() };
      case 'return':
        return this.offerReturn() ? { lines: this.localLines('', 'return_terms'), options: opts() } : { lines: [...L.returnNone], options: opts() };
      case 'return_yes':
        return this.acceptReturn() ? { lines: this.localLines('', 'returned'), options: opts() } : { lines: ['Hm.'], options: opts() };
      case 'return_no':
        this.declineReturn();
        return { lines: [...L.returnDeclined], options: opts() };
      case 'ask_yes':
        return this.acceptAsk() ? { lines: [...L.askAccepted], options: opts() } : { lines: ['Hm.'], options: opts() };
      case 'ask_no': {
        const r = this.refuseAsk();
        return { lines: r === 'ended' ? this.localLines('', 'ended') : [L.askRefused[0]], options: opts() };
      }
      case '__back':
      case 'back':
        return { lines: ['Ask.'], options: opts() };
      default:
        return { lines: ['Hm.'], options: opts() };
    }
    void s;
  }

  // Villagers who can be warned: one dialog option (through the murder's dialog hook, which
  // every villager's dialogue already merges), 'murder:villain:warn'.
  dialogOptions(npc) {
    const s = this.state;
    if (!npc?.id || !WARN_TO.includes(npc.id) || !s.met || s.ending || s.warned.includes(npc.id)) return [];
    if (this.game?.murder?.dead?.[npc.id]) return [];
    return [{ id: 'murder:villain:warn', label: 'The man at the ruins gate…' }];
  }

  dialogOption(npc, key) {
    if (key !== 'murder:villain:warn') return null;
    const s = this.state;
    const pact = !!s.pact;
    this.warn(npc.id);
    const who = npc.id;
    const lines = who === 'rowan' || who === 'wys' ? ['A man at the ruins gate, at night, offering you magic for our lives.', pact ? 'And you shook his hand first. ...You came to me anyway. I will remember both.' : 'Then he answers to the watch. Show me where. We go at dark.'] : who === 'aveline' ? ['Cold blue light, and a courteous voice. Oh, child. That is not a man.', 'Do not bargain with it. Do not let it touch you. Tell Rowan.'] : ['At the ruins? At NIGHT? ...Thank you for telling me. Tell Rowan too.'];
    return { lines, options: [] };
  }

  // ------------------------------------------------------------------ the fight (hero path)

  // His enmity (§13c): on a night after the pact was broken, come close and say nothing, and
  // he stands against you. A word to him holds it off (you may have come to go back).
  standAgainst(dt) {
    const s = this.state;
    const t = this.tempter;
    const P = this.game?.player;
    if (!s.hostile || !t || s.fighting || s.ending || s.defeated || !P || P.downed || P.dead) {
      this._standT = 0;
      return false;
    }
    if (s.endedNight != null && this.nightKey() === s.endedNight) return false; // not the night you said it
    // A price named on an earlier night and never answered is no longer on the table.
    if (s.returnOffer && s.returnOffer.night !== this.nightKey()) s.returnOffer = null;
    if (s.returnOffer) return false;
    const near = Math.hypot(P.x - t.x, P.y - t.y) < STAND_RANGE;
    const talking = (this.game?.time ?? 0) - (this._spokeAt ?? -99) < TALK_HOLDS || !!safe(() => this.game.ui?.isModalOpen?.(), false);
    if (!near || talking) {
      this._standT = 0;
      return false;
    }
    this._standT = (this._standT || 0) + dt;
    if (this._standT < STAND_AFTER) return false;
    safe(() => this.game.bubbles?.say?.(t, TEMPTER_LINES.stand[s.returns % TEMPTER_LINES.stand.length]));
    safe(() => this.game.bus?.emit?.('tempter_stands', { night: this.nightKey() }));
    return this.fight();
  }

  // Struck, or met after the stranger warned the village: he fights, as undead light does.
  onHurt(p) {
    const t = this.tempter;
    if (!t || (p?.target !== t && p?.entity !== t)) return;
    if (p.source && p.source !== this.game?.player) return;
    this.fight();
  }

  fight() {
    const t = this.tempter;
    const s = this.state;
    if (!t || s.fighting || s.ending) return false;
    s.fighting = true;
    t.faction = FACTION.UNDEAD;
    t.duty = null;
    safe(() => t.startFight(this.game.player, { anchor: { x: t.x, y: t.y }, leash: 220 }));
    return true;
  }

  defeat() {
    const s = this.state;
    const t = this.tempter;
    if (s.defeated) return;
    s.defeated = true;
    s.fighting = false;
    if (s.pact && !s.betrayed) {
      s.betrayed = true;
      safe(() => this.game.reputation?.oath?.('tempter', { kept: false, knownBy: s.warned, note: 'struck down the one they swore to' }));
    }
    if (t) safe(() => this.game.bubbles?.say?.(t, TEMPTER_LINES.dissolve[0]));
    this.vanish();
    this.heroEnding();
  }

  // ------------------------------------------------------------------ endings

  heroEnding() {
    const g = this.game;
    const s = this.state;
    if (s.ending) return null;
    s.ending = 'hero';
    s.endingDay = this.day();
    safe(() => g.reputation?.heroTitle?.('wardkeeper'));
    safe(() => g.magic?.unlock?.('essences', 'light', 'tempter'));
    const warner = s.warned.find((id) => !g.murder?.dead?.[id]);
    const steps = [
      { narrate: 'The pilgrim comes apart like frost on a window, into cold blue light, and the light goes down into the ground.' },
      { narrate: 'Over in Hearthvale, every family flame on the chapel altar stands up straight at once.' },
    ];
    if (warner) steps.push({ say: warner, text: warner === 'rowan' ? 'Whatever that was, it is gone. And you told us. Hearthvale will remember that.' : 'It is gone. You told us, and it is gone.' });
    steps.push({ narrate: 'The ward holds. The story goes on.' });
    this.mark('hero', 'The thing at the ruins gate is gone. The ward holds.');
    safe(() => g.bus?.emit?.('villain_ending', { ending: 'hero', day: s.endingDay }));
    const done = () => {
      safe(() => g.ui?.toast?.('The ward holds. Hearthvale will remember who kept it.', 'good', { key: 'ending', title: 'The ward holds' }));
      safe(() => g.save && (g.save.pending = g.save.pending || 'ending'));
    };
    return Promise.resolve(playScript(g.murder || { game: g }, 'villain_hero', { title: 'The ward holds', steps })).then(done, done);
  }

  villainEnding() {
    const g = this.game;
    const s = this.state;
    if (s.ending) return null;
    s.ending = 'villain';
    s.endingDay = this.day();
    if (!s.paid) {
      s.paid = true;
      this.grant(PAID_GIFTS);
      safe(() => g.bus?.emit?.('pact_paid', { gifts: [...PAID_GIFTS], pact: s.pact }));
    } else this.grant(['all_weaves']);
    const steps = [
      { narrate: 'On the chapel altar the last family flame gutters, and goes out.' },
      { narrate: 'Under the well the Wellstone lets go of the ward, the way a held breath lets go.' },
      { narrate: 'In the south-west marsh the ruins breathe in. Blue light comes up the lane, door by open door.' },
      { narrate: 'Isembard is waiting for you on the square. "Your wages," he says. "Everything the Song ever knew. It is borrowed, of course. Everything is."' },
    ];
    this.mark('villain', 'The village is empty. The ward is out, and the ruins are awake.');
    safe(() => g.bus?.emit?.('villain_ending', { ending: 'villain', day: s.endingDay }));
    const close = async () => {
      const m = this.memorial();
      let closed = false;
      try {
        if (typeof g.save?.closeLife === 'function') closed = await g.save.closeLife(m);
      } catch (err) {
        console.warn('[villain] could not close the save', err);
      }
      safe(() => g.bus?.emit?.('life_closed', { memorial: m, ending: 'villain', closed }));
      return m;
    };
    return Promise.resolve(playScript(g.murder || { game: g }, 'villain_end', { title: 'The lamps go out', steps })).then(close, close);
  }

  // The end page (the memorial's shape: src/ui/memorial.js).
  memorial() {
    const g = this.game;
    const day = this.day();
    const name = g?.settings?.playerName && g.settings.playerName !== 'Traveler' ? g.settings.playerName : 'the stranger from the mountain';
    const lyra = g?.lyra || g?.companion;
    const lyraAlive = !!lyra && !lyra.dead && !g?.murder?.dead?.[lyra.id];
    const kids = ['pip', 'tansy'].filter((id) => !g?.murder?.dead?.[id]).map((id) => this.name(id));
    return {
      id: `life_${Date.now().toString(36)}_villain`,
      name,
      companion: 'Lyra',
      day,
      when: safe(() => g.clock.fullString(), '') || `Day ${day}`,
      diedAt: Date.now(),
      place: 'Hearthvale',
      where: 'in Hearthvale',
      cause: 'They kept the bargain made at the ruins gate. Hearthvale\'s flames are out, the ward is gone, and the ruins are awake.',
      level: g?.player?.level ?? 1,
      saved: 0,
      lyra: {
        text: lyraAlive
          ? 'I was not there when the last lamp went out. I am glad I was not.\n\nThey say the stranger stood on the square in the blue light and did not look back. I lit every lamp on that square once, the night my father fell. Nobody will light them now.'
          : 'Nobody is left to write this page. The chandlery is dark. The lamps on Lamplight Lane are cold, and nobody will climb the ladder tonight.',
      },
      village: kids.length ? [{ name: 'On the road', text: `${kids.join(' and ')} ${kids.length > 1 ? 'were' : 'was'} taken down the road to Brightwater by the carters. ${kids.length > 1 ? 'They do' : 'They do'} not look back either.` }] : [],
      ending: 'villain',
    };
  }

  // ------------------------------------------------------------------ saving

  // An ask's person died: by your hand it is done (he feels that flame go out); otherwise void.
  onDeath(p, byPlayerKill) {
    const id = p?.id || p?.entity?.id;
    if (!id) return;
    for (const a of this.state.asks) {
      if (a.kind !== 'person' || a.target !== id || (a.state !== 'offered' && a.state !== 'accepted')) continue;
      if (byPlayerKill && a.state === 'accepted') this.completeAsk(a, 'killed');
      else this.voidAsk(a);
    }
  }

  onEvent(type, p) {
    switch (type) {
      case 'villager_killed':
        this.onDeath(p, p?.by === 'player');
        return this.onKilled(p);
      case 'villager_died':
        return this.onDeath(p, false);
      case 'unkindled':
        return this.onUnkindled(p);
      case 'killing_known':
      case 'murder_witnessed':
      case 'body_found':
        return this.settleKills();
      case 'moot_verdict':
        if (p?.guilty) this.state.verdicts++;
        return this.settleKills();
      case 'damage':
        return this.onHurt(p);
      default:
        return undefined;
    }
  }

  serialize() {
    const s = this.state;
    return { v: 1, ...s, kills: [...s.kills], pending: [...s.pending], warned: [...s.warned], gifts: [...s.gifts], said: s.said.slice(-20), fighting: false, asks: s.asks.map((a) => ({ ...a })), oathKnownBy: [...s.oathKnownBy], flamesOut: s.flamesOut.map((f) => ({ ...f, seen: [...(f.seen || [])] })), returnOffer: s.returnOffer ? { ...s.returnOffer, toll: s.returnOffer.toll.map((x) => ({ ...x })) } : null, soulHeld: s.soulHeld ? { ...s.soulHeld } : null };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const s = fresh();
    for (const k of Object.keys(s)) if (d[k] !== undefined) s[k] = d[k];
    for (const k of ['kills', 'pending', 'warned', 'gifts', 'said', 'asks', 'oathKnownBy', 'flamesOut']) if (!Array.isArray(s[k])) s[k] = [];
    s.asks = s.asks.filter((a) => a && typeof a === 'object' && ASK_KINDS.includes(a.kind)).map((a) => ({ ...a }));
    s.flamesOut = s.flamesOut.filter((f) => f && typeof f === 'object').map((f) => ({ ...f, seen: Array.isArray(f.seen) ? [...f.seen] : [] }));
    if (s.returnOffer && !Array.isArray(s.returnOffer.toll)) s.returnOffer = null;
    s.ended = !!s.ended;
    s.hostile = !!s.hostile;
    s.returns = Number.isFinite(s.returns) ? s.returns : 0;
    if (!['before', 'after', null].includes(s.pact)) s.pact = null;
    if (!['villain', 'hero', null].includes(s.ending)) s.ending = null;
    s.fighting = false;
    this.state = s;
    this.vanish();
  }
}

const TEMPTER_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'what Isembard says aloud, 1-3 sentences; "" only when silent' },
    silent: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
  required: ['say', 'silent'],
  additionalProperties: false,
};

export const villainPlugin = {
  id: 'villain',
  name: 'The tempter',
  description: 'The villain path: the pilgrim at the ruins gate, the pact, the endings (DESIGN §36.4).',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.villain instanceof Villain)) g.villain = new Villain(g);
    if (this._pending !== undefined) {
      g.villain.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx.game?.villain?.update?.(dt);
  },
  onEvent(type, p, ctx) {
    safe(() => ctx.game?.villain?.onEvent?.(type, p));
  },
  serialize(ctx) {
    return ctx.game?.villain?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.villain) ctx.game.villain.deserialize(d);
    else this._pending = d;
  },
};

// The murder's dialog hook carries his one option to the watch (an installer, after murder
// exists): the merged options of every villager's dialogue (npc.withLifeOptions).
export function installVillainHooks(game) {
  const m = game?.murder;
  const v = game?.villain;
  if (!m || !v || m._villainHooked) return;
  m._villainHooked = true;
  const opts = typeof m.dialogOptions === 'function' ? m.dialogOptions.bind(m) : () => [];
  const opt = typeof m.dialogOption === 'function' ? m.dialogOption.bind(m) : () => null;
  m.dialogOptions = (npc) => [...(safe(() => game.villain.dialogOptions(npc), []) || []), ...(opts(npc) || [])];
  m.dialogOption = (npc, key) => (String(key).startsWith('murder:villain:') ? game.villain.dialogOption(npc, key) : opt(npc, key));
  v.wrapTalk();
}
