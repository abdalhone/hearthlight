// What Hearthvale comes to know of the Unkindling (round 14b, workstream soul; DESIGN §37;
// LORE §9.12; the author: "even if they find him, they will be shocked how is he dead, because
// nobody somehow died… And if they see that there's multiple people that die the same way, and
// someone happened to see me, they will figure out… That's probably how those other people
// die."). `game.unkindle.village`.
//
// The death that "nobody did":
//   - murder.kill(v, { cause: 'unkindled', silent, unmarked }) records it; nobody HEARS a thing
//     (loudness 0); whoever SAW it is a witness by the sight rule (kill() asks witnessesOf).
//   - Found, unseen (onFound owns cause 'unkindled'): no suspect, no wanted, no case, no alarm.
//     The finder is shocked ("No mark on him… cold as stone"), Mira looks him over ("like the
//     hollow wind took him, but there's been no wind"), there is grief and a funeral, and
//     Aveline knows the hour: the household's flame on the chapel altar guttered when he went.
//   - The pattern: two such deaths found and the village talks of "the Hollow" (a rumour, by
//     meeting), keeps its doors barred after dark (adults home at night) and the watch walks
//     the night; three and the Moot is afraid. Claude prompts carry it through briefLine(id),
//     feature-detected by talk; offline, people say it in their own barks.
//   - Seen once: the witness saw the soul pulled out. Their account ('unkindled_seen') travels
//     only by meeting; everyone who has it links EVERY unkindled death to the stranger
//     ("That's how they died. All of them."): rec.linked, rec.knownBy, `killing_known { id }`
//     (society's reputation and the tempter count it then), and each found one's case reopens
//     with the count. A failed attempt (the victim broke free, or felt it before the hold broke)
//     is known by the victim, who links the same way, fights if they fight, or runs and tells.
//   - Lyra or whoever walks with you, SEEING it, react with horror in their own words.
// Nothing here is a bare distance check for who hears or who knows: eyes are src/ai/sight.js
// (over murder/witness.js), ears src/ai/hearing.js, news the village's rumours (by meeting).

import { VILLAGERS } from '../ai/social/bonds_data.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';
import { pronoun, placeAt } from '../ai/village_life/errands_data.js';
import { watchersOf, seesActor } from '../ai/sight.js';
import { isMinor, lyraOf } from '../core/people.js';
import { HOUR } from './data.js';

export const UNKINDLED = 'unkindled';
export const FEAR_TALK = 2; // found deaths with no mark: the village talks of the Hollow
export const FEAR_MOOT = 3; // ... and the Moot is afraid
export const MIRA_LOOKS = 0.3; // in-game hours after a finding: Mira has looked the body over
const TICK = 1; // s
const BARK_GAP = 40; // s between the village's frightened barks near you
const LINK_NOTE_MAX = 4;
const WATCH = ['rowan', 'wys'];
const BRIEF_MAX = 220;

// The village's news of it, said by meeting like any other (village.addRumor).
export const SOUL_RUMORS = {
  unkindled_seen: { text: '{stranger} pulled the life out of {v} with a bare hand, and {v} fell without a mark on them; that is how the others died', you: 'you pulled the life out of {v} with your bare hand', valence: -1, severity: 1 },
  unkindle_attempt: { text: '{stranger} took hold of {v} and tried to tear the life out of them with a bare hand', you: 'you tried to tear the life out of {v}', valence: -1, severity: 0.95 },
  hollow: { text: 'people are dying with no mark on them, cold as stone, and no wind blowing: the Hollow, some call it', you: 'people are dying with no mark on them', valence: -0.3, severity: 0.85, about: 'village' },
};
for (const [k, v] of Object.entries(SOUL_RUMORS)) if (!RUMOR_KINDS[k]) RUMOR_KINDS[k] = v;

// Their own words. {V} the dead, {P} the stranger as they name them; {he}/{him}/{his}/{himself}.
export const SOUL_LINES = {
  witness: [
    '{P} pulled it OUT of {V}! With a bare hand! I saw it!',
    "{V}'s life— I saw it come out of {him}! Watch! WATCH!",
    'No mark— {P} drew the life right out of {V}! Someone help!',
  ],
  witnessGlimpse: ['Something came out of {V}, pale as smoke, and {he} fell!', 'A light left {V}— I saw it go! Someone was there!'],
  finder: [
    '{V}? {V}! …No mark on {him}. Not a scratch. And {he} is cold as stone.',
    "It's {V}— no blood, no mark, nothing… {he} is cold. Cold right through.",
    'Help! {V} is dead— and there is not a mark on {him}!',
  ],
  mira: "No mark on {him}. Cold as stone… like the hollow wind took {him}, but there's been no wind.",
  aveline: '{House} guttered {when}. That is when {he} went.',
  lyraHorror: [
    'What did you— that was {V}. That light was {V}, and you closed your hand on it.',
    'No. No, no. I saw it leave {him}. You pulled {V} out of {himself}.',
  ],
  companionHorror: ['That was {V}\'s flame. You put it out with your hand. I saw it.', 'Gods. You tore {V} out of {himself}. I saw it go.'],
  attemptKnows: ['Your hand— you were pulling me OUT of myself! Get away from me!', 'I felt it! You were taking me— get AWAY!'],
  attemptFled: ['Keep away from me! Keep your hand away!'],
  chill: ['…Cold. Did someone leave a door open?', 'Brr. Someone walked over my grave.'],
  sawAttempt: ['What was that? Your hand— what were you doing to {V}?'],
  tempter: ['Ha. Not me, little flame. Never me.', 'Oh, well tried. Go and find something smaller.'],
  linked: ["That's how they died. All of them.", 'No mark, cold as stone… it was the stranger. All of them.'],
  fear: [
    'Bar your door tonight. {n} dead and not a mark on them.',
    'Mira says no sickness she knows leaves them cold like that.',
    'No wind, and still they die. The Hollow, they are calling it.',
    "I'm not walking home after dark. Not this week.",
  ],
  fearMoot: ['{n} now. The Moot sat late, and nobody would say it aloud.', 'Keep the lamp lit. Whatever it is, it comes in the quiet.'],
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[unkindled]', err);
    return fallback;
  }
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function fillLine(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// "a little after eleven at night", "just before midnight", "in the small hours, near three".
export function hourPhrase(h) {
  const x = ((Number(h) % 24) + 24) % 24;
  const whole = Math.floor(x);
  const frac = x - whole;
  const names = ['midnight', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'noon', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
  const next = (whole + 1) % 24;
  const part = (n) => (n === 0 || n === 12 ? '' : n < 5 ? ' in the small hours' : n < 12 ? ' in the morning' : n < 18 ? ' in the afternoon' : n < 21 ? ' in the evening' : ' at night');
  if (frac >= 0.75) return `just before ${names[next]}${part(next)}`;
  if (frac <= 0.25) return `at ${names[whole]}${part(whole)}`.replace('at midnight', 'at midnight').replace('at noon', 'at noon');
  return `a little after ${names[whole]}${part(whole)}`;
}

// The household's flame on the altar: "the Ironhand flame" (a family name), else "Pip's flame".
export function houseOf(profile, fallbackName = 'their') {
  const n = String(profile?.name || '').replace(/"[^"]*"/g, ' ').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  const titled = /^(Sister|Captain|Old|Brother|Mother|Father)$/i.test(parts[0] || '');
  if (parts.length >= (titled ? 3 : 2)) return `the ${parts[parts.length - 1]} flame`;
  return `${parts.length ? parts[parts.length - 1] : fallbackName}'s flame`;
}

export class Hollow {
  constructor(game, unk) {
    this.game = game;
    this.unk = unk;
    this.knowers = new Set(); // who knows the stranger is the Unkindler (saw it, or was told)
    this.attemptRumors = []; // rumour ids of failed attempts (their knowers link too)
    this.hollowRumor = null; // the 'hollow' rumour's id, once two deaths are found
    this.mootNoted = false;
    this.tickT = TICK;
    this.barkAt = -Infinity;
    this.offFound = null;
    this.installed = false;
  }

  get murder() {
    return this.game?.murder || null;
  }

  get village() {
    return this.game?.village || null;
  }

  get life() {
    return this.game?.villageLife || null;
  }

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : Number(this.game?.time) || 0;
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  rng() {
    const r = this.game?.rng;
    return typeof r?.next === 'function' ? () => r.next() : Math.random;
  }

  pick(list) {
    if (!Array.isArray(list)) return list;
    return list[Math.floor(this.rng()() * list.length) % list.length];
  }

  entity(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    if (id === 'lyra') return lyraOf(this.game);
    return safe(() => this.game?.entities?.get?.(id), null);
  }

  name(id) {
    return safe(() => this.murder?.name?.(id), null) || this.entity(id)?.name?.split(' ')[0] || id;
  }

  playerName() {
    return safe(() => this.murder?.playerName?.(), null) || 'the stranger';
  }

  vars(id, extra = {}) {
    const P = this.playerName();
    return { V: this.name(id), P: cap(P), p: P, he: pronoun(id, 'he'), him: pronoun(id, 'him'), his: pronoun(id, 'his'), himself: `${pronoun(id, 'him')}self`, ...extra };
  }

  line(key, id, extra = {}) {
    return fillLine(this.pick(SOUL_LINES[key]), this.vars(id, extra));
  }

  say(e, text, kind = 'say') {
    if (!e || !text) return;
    if (e === lyraOf(this.game)) {
      const a = e.mind?.autonomy;
      if (a?.say) safe(() => a.say(text, { force: true, kind }));
      else safe(() => e.mind?.say?.(text, { kind }));
      return;
    }
    safe(() => (typeof e.say === 'function' ? e.say(text, { kind }) : this.game?.bubbles?.say?.(e, text, { kind })));
    // Let it be heard out: the village's small talk and murmurs wait a little (village life
    // keeps quiet for a few seconds after anyone speaks up).
    const g = this.game;
    if (g) g._npcSayAt = this.now();
    if ('ambientAt' in e) e.ambientAt = this.now();
  }

  event(kind, text, extra = {}) {
    safe(() => this.life?.event?.(kind, text, extra));
  }

  toast(text, kind = 'warn', key = null) {
    safe(() => this.game?.ui?.toast?.(text, kind, key ? { key } : undefined));
  }

  emit(type, p) {
    safe(() => this.game?.bus?.emit?.(type, p));
  }

  visible(e, margin = 24) {
    return !!safe(() => this.murder?.visible?.(e, margin), false);
  }

  // Everyone who could see or be told: the eighteen, Lyra, whoever walks with you.
  people() {
    const out = [];
    const seen = new Set();
    const add = (e) => {
      if (!e || seen.has(e)) return;
      seen.add(e);
      out.push(e);
    };
    for (const e of safe(() => this.life?.villagers?.(), []) || []) add(e);
    if (!out.length) for (const id of VILLAGERS) add(this.entity(id));
    add(lyraOf(this.game));
    add(safe(() => this.game?.party?.holder, null));
    return out.filter((e) => e && !e.removed);
  }

  // ------------------------------------------------------------------ the records

  records() {
    const m = this.murder;
    if (!m?.dead) return [];
    return Object.values(m.dead).filter((r) => r && r.cause === UNKINDLED && !r.natural);
  }

  foundRecords() {
    return this.records().filter((r) => r.foundAt != null);
  }

  // How many no-mark deaths the village has found: what its fear is made of.
  fearLevel() {
    return this.foundRecords().length;
  }

  // Does `id` know this one is dead (found, and the news reached them, or they saw it)?
  knowsOfDeath(id, rec) {
    if (!rec) return false;
    if ((rec.seen || []).some((s) => s.id === id)) return true;
    if (rec.foundAt == null) return false;
    if (rec.foundBy === id || rec.newsAt == null) return true;
    const c = safe(() => this.life?.cases?.get?.(rec.id), null);
    const r = c?.deadRumor ? safe(() => this.village?.rumors?.get?.(c.deadRumor), null) : null;
    return !!r?.heardBy?.includes?.(id);
  }

  // Does `id` know the stranger is the one doing it?
  knows(id) {
    return this.knowers.has(id);
  }

  // ------------------------------------------------------------------ a death

  // The soul was taken (unkindle.take, after murder.kill): the household's flame gutters on
  // the altar at this hour; anyone who saw it saw the soul drawn out.
  unkindled(rec, e, ch) {
    if (!rec) return;
    const g = this.game;
    rec.flame = { hour: Math.round((g.clock?.hour ?? 0) * 100) / 100, day: g.clock?.day ?? 1, house: houseOf(e?.profile, this.name(rec.id)), known: false };
    safe(() => this.unk?.fx?.gutterAltar?.());
    const seers = (rec.seen || []).filter((s) => s.id !== rec.id);
    if (!seers.length) return;
    rec.seenSoul = true;
    // What the witnesses saw is the soul pulled out: their own words over the generic alarm.
    let n = 0;
    const lyra = lyraOf(g);
    const holder = safe(() => g.party?.holder, null);
    for (const s of seers) {
      const w = this.entity(s.id);
      if (!w) continue;
      this.knowers.add(s.id);
      if (w === lyra) {
        this.lyraSaw(rec);
        continue;
      }
      if (w === holder) {
        this.say(w, this.horrorLine(w, rec.id), 'shout');
        continue;
      }
      if (n++ < 3) this.say(w, this.line(s.clarity === 'clear' ? 'witness' : 'witnessGlimpse', rec.id), 'shout');
    }
    // Their account, carried by meeting. Those near enough to make out the scream have it too
    // (the murder rumour's knowers), never anyone by distance alone.
    const r0 = rec.rumor ? safe(() => this.village?.rumors?.get?.(rec.rumor), null) : null;
    const witnesses = [...new Set([...seers.map((s) => s.id), ...(r0?.heardBy || [])])].filter((id) => id !== rec.id);
    const r = safe(() => this.village?.addRumor?.('unkindled_seen', { victim: rec.id, witnesses, saw: seers.map((s) => s.id), source: seers.find((s) => s.id !== 'lyra')?.id || seers[0].id }), null);
    rec.soulRumor = r?.id || null;
    this.event('murder', `${seers.map((s) => this.name(s.id)).join(', ')} saw ${this.playerName()} draw the life out of ${this.name(rec.id)} with a bare hand ${placeAt(rec.place, safe(() => this.murder.placeName(rec.place), 'there'))}.`, { who: 'player', about: rec.id });
    this.link();
  }

  horrorLine(w, deadId) {
    // A line of their own, if the party or talk gives one (feature-detected), else ours.
    const own = safe(() => this.game?.party?.horrorLine?.(w, 'unkindle', deadId), null) || safe(() => this.game?.village?.horrorLine?.(w, 'unkindle', deadId), null);
    return own || this.line('companionHorror', deadId);
  }

  // Lyra saw it: horror in her own words, kept in her memory.
  lyraSaw(rec) {
    const L = lyraOf(this.game);
    if (!L) return;
    const V = this.name(rec.id);
    const P = this.playerName();
    const own = safe(() => L.mind?.horrorLine?.('unkindle', rec.id), null);
    this.say(L, own || this.line('lyraHorror', rec.id), 'shout');
    safe(() => L.mind?.remember?.(`I watched ${P} put a hand toward ${V} and draw something out of ${pronoun(rec.id, 'him')}: pale, cold, ${pronoun(rec.id, 'his')} own shape. It fought to stay. Then ${V} fell, and there was not a mark on ${pronoun(rec.id, 'him')}.`, { type: 'event', importance: 10, about: ['player', rec.id], tags: ['murder', 'death', 'unkindled', rec.id], emotion: 'fear' }));
    safe(() => L.mind?.feel?.('fear', 1, `${P} drew the life out of ${V}`));
  }

  // ------------------------------------------------------------------ a failed attempt

  // The hold broke, or a stronger soul broke free. Felt (knows): they know what you tried.
  attempted(e, { outcome = 'broken', knows = false, why = null, kind = 'person' } = {}) {
    const g = this.game;
    const P = g?.player;
    if (!e || !P) return;
    if (kind === 'boss') return;
    if (kind === 'tempter') {
      // He is only amused.
      this.say(e, this.pick(SOUL_LINES.tempter), 'say');
      return;
    }
    if (!knows) {
      // Too little to know: a chill, nothing more.
      if (this.visible(e)) this.say(e, this.pick(SOUL_LINES.chill), 'say');
      return;
    }
    // Who saw the stranger's hand on them: the sight rule, from where each of them stands.
    const ids = new Set();
    for (const id of safe(() => watchersOf(g, e.x, e.y, this.people().filter((x) => x !== e)), []) || []) ids.add(id);
    for (const id of safe(() => watchersOf(g, P.x, P.y, this.people().filter((x) => x !== e)), []) || []) ids.add(id);
    const seers = [...ids].filter((id) => id !== e.id && id !== 'player');
    // An attack on their life, known to them: the crime, as any assault (combat.assault when
    // talk's wrapper is there: a crime by sight, or the victim's own telling later).
    this.assault(P, e);
    this.knowers.add(e.id);
    for (const id of seers) this.knowers.add(id);
    const r = safe(() => this.village?.addRumor?.('unkindle_attempt', { victim: e.id, witnesses: [e.id, ...seers], saw: seers, source: e.id }), null);
    if (r?.id) {
      this.attemptRumors.push(r.id);
      if (this.attemptRumors.length > 20) this.attemptRumors.splice(0, this.attemptRumors.length - 20);
    }
    safe(() => e.adjustOpinion?.(-45, 'tried to tear the life out of them'));
    // Their words, now they have a voice again; then they fight if they fight, else run and
    // tell (the watch first).
    const L = lyraOf(g);
    if (e === L) {
      safe(() => L.mind?.remember?.(`${this.playerName()} took hold of me and pulled at my life with a bare hand. I felt it leaving me. I broke free.`, { type: 'event', importance: 10, about: ['player'], tags: ['unkindled', 'attack'], emotion: 'fear' }));
      safe(() => L.mind?.feel?.('fear', 1, 'the stranger tried to tear the life out of me'));
    }
    // They fight if they fight, else run and tell (the watch first); then their words, once
    // the first cry of it is out (their own voice, after the hold: heard by the hearing rule).
    this.react(e, P);
    const words = this.pick(SOUL_LINES.attemptKnows);
    if (e !== L && 'pendingSay' in e) e.pendingSay = { at: this.now() + 0.7, text: words, kind: 'shout', target: null };
    else this.say(e, words, 'shout');
    for (const id of seers) {
      const w = this.entity(id);
      if (!w || w === e) continue;
      if (w === L || w === safe(() => g.party?.holder, null)) this.say(w, this.line('sawAttempt', e.id), 'shout');
    }
    this.event('crime', `${this.playerName()} took hold of ${this.name(e.id)} and tried to draw the life out of ${pronoun(e.id, 'him')}. ${cap(pronoun(e.id, 'he'))} broke free, and knows.`, { who: 'player', about: e.id });
    this.toast(`${this.name(e.id)} broke free, and knows what you tried.`, 'warn', `unk_attempt:${e.id}`);
    this.link();
  }

  assault(P, e) {
    const c = this.game?.combat;
    if (!c) return;
    if (typeof c.assault === 'function') {
      safe(() => c.assault(P, e, 'assault', { amount: 0 }));
      return;
    }
    // Before talk's wrapper: the same steps by hand.
    e.lastAttacker = P;
    e.lastAttackedAt = this.now();
    safe(() => c._noteAggression?.(e, P));
    let crime = 'assault';
    const m = this.murder;
    if (m?.screenCrime && !safe(() => m.screenCrime(P, e, 'assault'), true)) crime = null;
    if (crime) safe(() => c._recordCrime?.(P, e, crime));
    safe(() => this.game.bus?.emit?.('damage', { source: P, target: e, amount: 0, kind: 'slap', crit: false, byHand: true }));
    if (crime) safe(() => c._reportCrime?.(P, e, crime));
  }

  // A fighter turns on the stranger; anyone else runs, for the watch.
  react(e, P) {
    if (!e || e.dead || e === lyraOf(this.game)) return;
    const fighter = !!(e.isGuard || e.profile?.hunter || e.profile?.combat || safe(() => e.isDefender?.(), false));
    if (fighter && typeof e.startFight === 'function') {
      if (e.mode !== 'fight' || e.fightTarget !== P) safe(() => e.startFight(P));
      return;
    }
    if (typeof e.startFlee === 'function' && e.mode !== 'flee') {
      const to = safe(() => this.murder?.watchFor?.(e), null);
      safe(() => e.startFlee(P, 60, 'crime', to ? { to, quiet: true } : { quiet: true }));
    }
  }

  // ------------------------------------------------------------------ linking

  // Everyone who has the account (saw one, or heard it by meeting) links every unkindled
  // death to the stranger. Once per record: killing_known, and a found one's case reopens.
  link() {
    const v = this.village;
    for (const rec of this.records()) {
      if (rec.soulRumor) {
        const r = safe(() => v?.rumors?.get?.(rec.soulRumor), null);
        for (const id of r?.heardBy || []) this.knowers.add(id);
      }
      for (const s of rec.seenSoul ? rec.seen || [] : []) this.knowers.add(s.id);
    }
    for (const rid of this.attemptRumors) {
      const r = safe(() => v?.rumors?.get?.(rid), null);
      for (const id of r?.heardBy || []) this.knowers.add(id);
    }
    this.knowers.delete('player');
    if (!this.knowers.size) return 0;
    const knowers = [...this.knowers];
    let n = 0;
    const newly = [];
    for (const rec of this.records()) {
      if (rec.by !== 'player') continue;
      // A knower links a death they know of: found, or seen (a body nobody has found yet is
      // only someone missing).
      const kb = new Set(Array.isArray(rec.knownBy) ? rec.knownBy : []);
      for (const id of knowers) if (id !== rec.id && this.knowsOfDeath(id, rec)) kb.add(id);
      rec.knownBy = [...kb];
      if (!rec.linked && kb.size) {
        rec.linked = true;
        rec.knownKilling = true;
        newly.push(rec);
        n++;
      }
    }
    for (const rec of newly) this.reopen(rec, knowers);
    if (newly.length) {
      const L = lyraOf(this.game);
      if (this.knowers.has('lyra') && L) {
        const names = this.records().filter((r) => r.by === 'player').map((r) => this.name(r.id));
        safe(() => L.mind?.remember?.(`Now I know how ${names.join(', ')} died. No mark, cold as stone: it was ${this.playerName()}, with a bare hand.`, { type: 'event', importance: 10, about: ['player', ...this.records().map((r) => r.id)], tags: ['murder', 'unkindled'], emotion: 'fear' }));
        for (const r of newly) {
          const st = (this.murder.lyra[r.id] ||= {});
          if (st.belief !== 'knows') {
            st.belief = 'believes';
            st.how = st.how || 'told';
          }
        }
      }
      for (const rec of newly) this.emit('killing_known', { id: rec.id, cause: UNKINDLED, knownBy: [...rec.knownBy] });
    }
    return n;
  }

  // The case reopens with every count: a found body's case gets the account as evidence.
  reopen(rec, knowers) {
    const m = this.murder;
    if (!m || rec.foundAt == null || rec.known === 'witnessed') return;
    const by = knowers.find((id) => id !== rec.id && id !== 'lyra') || knowers[0];
    if (!Array.isArray(rec.answers)) rec.answers = [];
    if (!rec.answers.some((a) => a.kind === 'linked')) {
      rec.answers.push({ kind: 'linked', by, w: 0.85, t: Math.round(this.now()), text: `${this.name(by)} knows how ${this.name(rec.id)} died: ${this.playerName()} draws the life out of people with a bare hand, and leaves no mark.` });
    }
    const c = safe(() => m.openCase(rec.id), null);
    if (c && c.state !== 'open' && c.state !== 'questioning' && !c.verdict) c.state = 'open';
    if (c) c.askAt = Math.min(c.askAt ?? Infinity, Math.round(this.now() + 0.5 * HOUR));
  }

  // ------------------------------------------------------------------ the discovery

  // murder.onFound: the discovery of a body that died unkindled is ours.
  onFound(rec, ctx) {
    if (!rec || rec.cause !== UNKINDLED || rec.natural) return false;
    const m = ctx.murder || this.murder;
    const id = rec.id;
    const fe = ctx.finderEntity;
    const where = placeAt(ctx.place || rec.foundPlace, safe(() => m.placeName(ctx.place || rec.foundPlace), 'somewhere'));
    const V = this.name(id);
    const finder = ctx.finder ? this.name(ctx.finder) : 'Someone';
    if (ctx.witnessed || rec.known === 'witnessed') {
      const saw = (rec.seen || []).filter((s) => s.id !== 'lyra').map((s) => this.name(s.id));
      this.event('found', `${V} lies ${where} with no mark on ${pronoun(id, 'him')}. ${saw.length ? `${saw.join(' and ')} saw` : 'Someone saw'} ${this.playerName()} draw the life out of ${pronoun(id, 'him')} with a bare hand.`, { who: ctx.finder, about: id });
      ctx.defaults?.openCase?.();
      ctx.defaults?.lyra?.();
      return true;
    }
    rec.mystery = true;
    // The finder, over the body: shocked.
    if (fe && fe !== lyraOf(this.game)) {
      this.say(fe, this.line('finder', id), 'shout');
      safe(() => {
        fe.walker?.stop?.();
        const v = ctx.body;
        if (v) fe.faceToward?.(v.x, v.y);
        if (fe.r) fe.r.key = null;
      });
    }
    this.event('found', `${finder} found ${V} dead ${where}. There is no mark on ${pronoun(id, 'him')}, and no blood; ${pronoun(id, 'he')} is cold as stone.`, { who: ctx.finder, about: id });
    ctx.defaults?.lyra?.();
    this.toast(`${V} has been found dead ${where}. No mark on ${pronoun(id, 'him')}, no blood: cold as stone. Nobody can say what took ${pronoun(id, 'him')}.`, 'warn', `found:${id}`);
    rec.miraAt = Math.round(this.now() + MIRA_LOOKS * HOUR);
    if (ctx.finder === 'mira') this.miraLooks(rec, fe);
    if (rec.flame?.known) this.avelineSays(rec);
    // Already known for what it is (an account that came first): the case is a murder case.
    if (rec.linked) this.reopen(rec, [...this.knowers]);
    return true;
  }

  // The healer looks the body over: no mark, no wound, and cold.
  miraLooks(rec, mira = this.entity('mira')) {
    if (rec.miraSaw) return;
    rec.miraSaw = true;
    const m = this.murder;
    if (!mira || mira.dead || m?.dead?.mira) return;
    const text = fillLine(SOUL_LINES.mira, this.vars(rec.id));
    if (this.visible(mira)) this.say(mira, text, 'say');
    this.event('talk', `Mira looked ${this.name(rec.id)} over: "${text}"`, { who: 'mira', about: rec.id });
  }

  // The keeper of the flames names the hour.
  avelineSays(rec) {
    if (!rec.flame || rec.flame.said) return;
    const av = this.entity('aveline');
    if (!av || av.dead || this.murder?.dead?.aveline) return;
    rec.flame.said = true;
    const text = fillLine(SOUL_LINES.aveline, this.vars(rec.id, { House: cap(rec.flame.house), when: hourPhrase(rec.flame.hour) }));
    if (this.visible(av)) this.say(av, text, 'say');
    this.event('talk', `Sister Aveline: "${text}"`, { who: 'aveline', about: rec.id });
  }

  // ------------------------------------------------------------------ the days

  update(dt) {
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = TICK;
    safe(() => this.tick());
  }

  tick() {
    const g = this.game;
    if (!this.murder) return;
    const t = this.now();
    const av = this.entity('aveline');
    const avAt = av && !av.dead && av.state !== 'sleep' && av.isAlive?.() ? safe(() => g.locations?.at?.(av.x, av.y)?.id, null) : null;
    for (const rec of this.records()) {
      // Aveline at the altar: the guttered flame tells her the hour.
      if (rec.flame && !rec.flame.known && rec.id !== 'aveline' && avAt === 'chapel') {
        rec.flame.known = true;
        this.event('flame', `At the altar, Sister Aveline found ${rec.flame.house} burned low and guttered, ${hourPhrase(rec.flame.hour)}.`, { who: 'aveline', about: rec.id });
        if (rec.foundAt != null) this.avelineSays(rec);
      }
      if (rec.foundAt != null && !rec.miraSaw && rec.mystery && t >= (rec.miraAt ?? Infinity)) this.miraLooks(rec);
    }
    this.link();
    // The pattern: the Hollow.
    const fear = this.fearLevel();
    if (fear >= FEAR_TALK && !this.hollowRumor) {
      const first = this.foundRecords()[0];
      const src = VILLAGERS.find((id) => id === 'corran' && !this.murder.dead[id]) || VILLAGERS.find((id) => !this.murder.dead[id]) || 'village';
      const r = safe(() => this.village?.addRumor?.('hollow', { victim: null, witnesses: [src], source: src, about: 'village' }), null);
      this.hollowRumor = r?.id || 'noted';
      this.event('village', `${fear} found dead with no mark on them, on still nights. The village talks of a sickness, or "the Hollow". Doors are barred after dark, and the watch walks the night.`, { about: first?.id || null });
    }
    if (fear >= FEAR_MOOT && !this.mootNoted) {
      this.mootNoted = true;
      this.event('moot', `The Moot met in the Kettle about the Hollow. ${fear} dead and no mark on any of them. Nobody would say it aloud.`, {});
    }
    this.bark(fear);
  }

  // Offline, the fear is said in people's own barks near you (their voice, the hearing rule).
  bark(fear) {
    if (fear < FEAR_TALK) return;
    const t = this.now();
    if (t - this.barkAt < BARK_GAP) return;
    const g = this.game;
    const P = g?.player;
    if (!P) return;
    for (const e of safe(() => this.life?.villagers?.(), []) || []) {
      if (!e.isAlive?.() || e.state === 'sleep' || isMinor(g, e) || this.knows(e.id)) continue;
      if (Math.hypot(e.x - P.x, e.y - P.y) > 90 || !this.visible(e) || !seesActor(g, e, P)) continue;
      if (!this.foundRecords().some((r) => this.knowsOfDeath(e.id, r))) continue;
      if (this.rng()() > 0.35) continue;
      this.barkAt = t;
      this.say(e, fillLine(this.pick(fear >= FEAR_MOOT ? SOUL_LINES.fearMoot : SOUL_LINES.fear), { n: fear }), 'say');
      return;
    }
    this.barkAt = t - BARK_GAP / 2;
  }

  // ------------------------------------------------------------------ the night

  // Wraps village life's day (npc.currentEntry asks it): with the Hollow feared, the grown keep
  // home behind barred doors after dark, and the watch walks the night.
  entryFor(npc, e, hour) {
    if (!npc || this.fearLevel() < FEAR_TALK) return null;
    const night = hour >= 20.5 || hour < 6;
    if (!night) return null;
    const id = npc.id;
    if (WATCH.includes(id)) {
      const walking = id === 'rowan' ? hour >= 20.5 && hour < 24 : hour >= 0 && hour < 4;
      if (walking) return { activity: 'wander', at: 'town_square', vl: `hollow-watch-${id}`, doing: 'walking the night watch' };
      return null;
    }
    if (e?.activity === 'sleep') return null;
    const home = npc.profile?.home;
    if (!home) return null;
    if (e?.at === home) return null;
    return { activity: 'rest', at: home, vl: 'hollow-home', doing: 'home behind a barred door' };
  }

  // ------------------------------------------------------------------ what they perceive

  // One line for their Claude prompt (<= 220 chars): only what they saw, were told or can
  // feel. Never "they take souls" unless they know it.
  briefLine(id) {
    if (!id || id === 'player') return '';
    const g = this.game;
    const out = [];
    const recs = this.records();
    const mine = recs.filter((r) => r.by === 'player');
    const attempt = (this.unk?.attempts || []).find((a) => a.id === id && a.knows);
    if (this.knows(id)) {
      const sawOne = recs.find((r) => r.seenSoul && (r.seen || []).some((s) => s.id === id));
      // the others they put to it: the deaths they know of (found, or seen), not the one they saw
      const names = mine.filter((r) => r.id !== id && r !== sawOne && this.knowsOfDeath(id, r)).map((r) => this.name(r.id));
      if (attempt) out.push('The stranger took hold of you and pulled at your very life with a bare hand; you broke free. You know what they are.');
      else if (sawOne) out.push(`You SAW the stranger draw ${this.name(sawOne.id)}'s life out with a bare hand: no sound, no mark.`);
      else out.push('You have heard it from one who saw: the stranger tears the life out of people with a bare hand.');
      const list = names.slice(0, 4);
      const and = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
      if (list.length) out.push(`That is how ${and} died${sawOne ? ' too' : ''}. They are a killer.`);
      else out.push('They are a killer.');
    } else {
      const known = recs.filter((r) => this.knowsOfDeath(id, r) && r.id !== id);
      const n = known.length;
      if (n >= FEAR_MOOT) out.push(`${n} dead now with no mark on them, cold as stone, on still nights. The Moot is frightened; doors are barred after dark. Nobody knows what does it.`);
      else if (n === FEAR_TALK) out.push('Two of your neighbours found dead with no mark, cold as stone, and no wind blowing. People whisper of the Hollow; you bar your door at night.');
      else if (n === 1) out.push(`${this.name(known[0].id)} was found dead with no mark on ${pronoun(known[0].id, 'him')}, cold as stone. Nobody can say what took ${pronoun(known[0].id, 'him')}.`);
    }
    // What shows on the stranger (S20-6 as replaced: the price is that it shows): felt only
    // by one beside them who sees them now (close enough to touch).
    const tier = this.unk?.signTier?.() || 0;
    const e = this.entity(id);
    const P = g?.player;
    if (tier >= 1 && e && P && Math.hypot(e.x - P.x, e.y - P.y) <= 24 && seesActor(g, e, P)) out.push(tier >= 2 ? 'Beside the stranger the air goes cold, like a cellar; their hands are cold as well-stone.' : 'Close to the stranger you feel a cold coming off them, like well-stone.');
    let s = out.join(' ');
    if (s.length > BRIEF_MAX) s = `${s.slice(0, BRIEF_MAX - 1).replace(/\s+\S*$/, '')}…`;
    return s;
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    return { v: 1, knowers: [...this.knowers], attemptRumors: [...this.attemptRumors], hollowRumor: this.hollowRumor, mootNoted: this.mootNoted };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.knowers = new Set(Array.isArray(d.knowers) ? d.knowers.filter((x) => typeof x === 'string') : []);
    this.attemptRumors = Array.isArray(d.attemptRumors) ? d.attemptRumors.filter((x) => x != null) : [];
    this.hollowRumor = d.hollowRumor ?? null;
    this.mootNoted = !!d.mootNoted;
  }

  // ------------------------------------------------------------------ wiring

  // After village life and murder exist (the soul slot's installer).
  install() {
    if (this.installed) return;
    const m = this.murder;
    if (m?.onFound) this.offFound = m.onFound((rec, ctx) => this.onFound(rec, ctx));
    const life = this.life;
    if (life && typeof life.entryFor === 'function' && !life._hollowWrapped) {
      const orig = life.entryFor.bind(life);
      const self = this;
      life.entryFor = function hollowEntryFor(npc, base, hour) {
        const o = orig(npc, base, hour);
        const h = safe(() => self.entryFor(npc, o || base, hour), null);
        return h || o;
      };
      life._hollowWrapped = true;
    }
    this.installed = true;
  }
}
