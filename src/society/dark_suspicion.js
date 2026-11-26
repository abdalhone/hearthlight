// The faithful who read the signs (round 14b §13b, S20-9 and S20-10; workstream soul; DESIGN
// §37.11; LORE §2 "the cold that takes"). `game.unkindle.suspicion`.
//
// The author: "if I do it for a long time, maybe some religious people would understand that
// this is a sign of death. But not a death where I'm dying, but a death where I take. And
// maybe they will suspect I use black magic… maybe they will ask me. I can say what I want…
// using dark magic doesn't mean that I'm evil. It just means that I'm dangerous. They wouldn't
// hate me, but they would ask me to stop."
//
// Per person (saved), only from what they THEMSELVES perceive (src/ai/sight.js for eyes; touch
// for hands; news only by meeting, the village_talk event, never by distance alone):
//   signs     the signs of the taken flame each has seen (coldfire's tier says which can show:
//             faint 'hands' 'breath'; clear 'flames' 'beasts' 'frost'; strong 'eyes' 'shadow')
//   s         suspicion 0..100: grows with the sign, the time near you, and what they are told
//             (×faith: Aveline, keeper of the family flames, most; those who pray at the chapel
//             or keep the old superstitions; ordinary folk find it odd, never damning: their s is
//             capped below the asking and they ask if you are ill). Aveline also joins the signs
//             to the household flames she found guttered at the hours of the deaths (rec.flame).
//             It travels by meeting as worry, only to the faithful and the teller's friends.
//   dark      they KNOW you use dark magic: 'saw' (a beast or bandit unkindled before their eyes,
//             by sight.js), 'told' (the 'dark_magic' rumour, by meeting), 'confessed', 'caught'
//             (a lie disproved), 'undeniable' (strong signs, seen by the faithful). Dangerous,
//             not evil: opinion moves a little (DARK_OPINION), they are wary, they ask you to stop;
//             Aveline offers the rite at the chapel flame (your choice). Never a crime: no case,
//             no wanted, no hunt. A PERSON unkindled and seen or linked is murder, and that is
//             src/murder/unkindled.js, with all that follows.
//
// The asking (S20-9): at ASK_AT, Aveline first (else another of the faithful), by day and in
// private (nobody else's eyes on you, sight.js), walks up to you (a duty step, DESIGN §34.1)
// and asks in her own words; the chat opens to her with the field open (talk's ui.talkTo, else
// the chat's own selectTarget). Your answer is yours: deny, lie, explain, confess. The game
// decides her verdict FIRST (decideVerdict: from what she knows and whether your story fits it):
// 'believed' | 'doubted' | 'knows'. Then one Claude call words it (the ordinary reply, whose
// brief carries briefLine(id) = askingBrief: only her knowledge and the verdict); offline, her
// own lines. A believable lie quiets her for a while; a lie she can disprove makes it worse.
//
// If you stop: the bar ebbs and the mark fades (coldfire), the signs go, suspicion falls, and
// those who asked you to stop notice ("You're warmer. Thank you."). If you go on after being
// asked, their worry grows into fear: never a crime without a killing.

import { VILLAGERS } from '../ai/social/bonds_data.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';
import { pronoun } from '../ai/village_life/errands_data.js';
import { watchersOf, seesActor } from '../ai/sight.js';
import { isMinor, lyraOf } from '../core/people.js';
import { addNote } from '../ai/social/player_talk.js';
import { DAY_SECONDS, TILE } from '../core/constants.js';

const HOUR = DAY_SECONDS / 24;
export const ASK_AT = 60; // suspicion at which the faithful come to ask
export const ORDINARY_CAP = 40; // the ordinary never go past this on signs alone
export const SIGN_PTS = Object.freeze({ breath: 4, hands: 8, flames: 9, beasts: 7, frost: 8, eyes: 12, shadow: 10 });
export const SIGN_TIER = Object.freeze({ breath: 1, hands: 1, flames: 2, beasts: 2, frost: 2, eyes: 3, shadow: 3 });
export const FLAME_JOIN = 15; // Aveline joins a guttered flame to the signs she has seen
export const DARK_OPINION = -4; // what known dark magic costs (a little; never hate)
export const LIE_CAUGHT_OPINION = -6;
export const QUIET_DAYS = 4; // a believable lie quiets her this long
export const ASK_GAP_DAYS = 3; // between askings
const TICK = 1; // s
const SEE_R = 7 * TILE; // the signs read at this distance at most (and only by eyes)
const CLOSE_R = 3 * TILE; // breath, eyes: close
const TOUCH_R = 40; // px: close enough to touch (talk's acts use the same)
const PRIVATE_R = 7 * TILE; // the asking: nobody else's eyes on you within this
const BARK_GAP = 50; // s between the village's remarks on the signs
const FAITH = Object.freeze({ aveline: 1.6 });
const FAITH_PRAY = 1; // prays at the chapel (their day says so)
const FAITH_SUPERSTITIOUS = 0.7;
const FAITH_ORDINARY = 0.15;
const LYRA_FAITH = 0.5; // a weaver: she feels something wrong in the weave of you

// The village's news of seen dark magic: carried by meeting like any other, and light: it is
// not a crime (valence and severity small: no grievance, no bar, no wanted).
export const DARK_RUMORS = {
  dark_magic: { text: '{stranger} drew the life out of a {beast} with a bare hand: dark magic, cold as the grave', you: 'you drew the life out of a {beast} with your bare hand', valence: -0.15, severity: 0.3 },
};
for (const [k, v] of Object.entries(DARK_RUMORS)) if (!RUMOR_KINDS[k]) RUMOR_KINDS[k] = v;

// What each sign is, as the one who saw it would put it to you, and in their own brief.
export const SIGN_WORDS = {
  hands: { you: 'your hands are cold as well-stone', brief: 'their hands are cold as well-stone' },
  breath: { you: 'your breath fogs on a warm night', brief: 'their breath fogs even on a warm night' },
  flames: { you: 'the candles lean away from you when you come in', brief: 'candles and lamps lean away from them when they pass' },
  beasts: { you: 'the hens run from you', brief: 'the hens and the cat shy from them' },
  frost: { you: 'there was frost in your footprints, and nowhere else', brief: 'frost formed in their footprints at night' },
  eyes: { you: "there's a cold light in your eyes after dark", brief: 'a pale cold glint in their eyes after dark' },
  shadow: { you: 'your shadow is slow to follow you', brief: 'their shadow is slow to follow them' },
};

export const DARK_LINES = {
  ill: ["You're cold as a well stone. Are you ill?", 'Brr— your hands! Get by a fire, you.', 'Your breath is smoking, and it a warm night. Are you well?'],
  odd: ['Huh. That candle went all sideways when you came by.', "The hens don't like you much, do they?", 'Frost? In this weather? Odd.'],
  touched: ['Gods, your hands— they\'re like ice!', "You're cold as a well stone. Are you ill?"],
  tended: ["Your skin's cold as well-stone… that's no fever I know.", 'You came back cold. Colder than you should be.'],
  sawPrey: ['What— what did you just do? You pulled the life out of it with your hand!', 'That was dark work. I saw it. Its light went into your hand.', "Gods. That wasn't killing. That was something else."],
  wary: ['Keep your hands where I can see them.', "I'll keep my distance, if it's all the same to you.", 'Whatever it is you do… stop. Please.'],
  fear: ["You didn't stop. I can feel it on you from here.", "It's worse. You said— you didn't stop."],
  warmer: ["You're warmer. Thank you.", "There's colour in you again. Thank you for stopping."],
  another: ['Another time, then.', "It'll keep. Another day."],
};

// Her own words, offline: the opening (built from what she saw) and each verdict.
const OPEN = {
  aveline: { greet: 'Walk with me a moment, child. Just us.', ask: "The old teaching has a name for it: the cold that takes. Not a death that comes for you; a death that takes. So I'll ask you plainly, and you may answer as you like. What are you carrying?" },
  other: { greet: "A word, while it's just us.", ask: "My gran had a word for that, and it wasn't a kind one. What is it? Tell me true." },
};
const VERDICT = {
  aveline: {
    believed: 'A fever of the blood… perhaps. Go to Mira, and eat something warm. Forgive an old woman her fears.',
    doubted: "No. I've kept those flames thirty years; I know what leans them, and it isn't that. I'll not press you today. But I am watching, and I am praying for you.",
    knows: "Thank you for telling me true. It's the cold that takes, then. It doesn't make you wicked; it makes you dangerous, and it won't stay with wolves. Stop. And if you want it out of you, come to the chapel flame and I'll help you let it go. Your choice.",
    caught: "Don't. {who} saw you draw the life out of a {beast} with your bare hand. I'd rather a hard truth. Stop, while you still can; the chapel flame can take it out of you, if you'll let it.",
    killer: "{V}. You put out {V}'s flame. Gods forgive you; I can't keep this.",
  },
  other: {
    believed: 'Ill, is it. Well. See Mira, then.',
    doubted: "That's not it, and we both know it. I'll be watching you.",
    knows: "So it's true. I won't call you wicked. But stop it, please, before it takes more than beasts.",
    caught: "Don't lie to me. {who} saw it. Stop it, whatever it is.",
    killer: "{V}… it was you. Gods. Get away from me.",
  },
};
const RITE = {
  here: 'Kneel with me. Give it to the flame… there. Feel it go? Breathe. You are warmer already.',
  there: "At the chapel, by the family flames. Come when you're ready; I'll be there.",
};

const RX = {
  kill: /\b(killed|murdered|unkindled|put out|took|i did it|it was me)\b/i,
  dark: /\b(dark magic|black magic|the unkindling|unkindl\w*|cold that takes|souls?|soul's|tempter|pact|the man at the gate|gravelight|take (?:their|its|the) (?:life|lives|flame)|took (?:their|its|the) (?:life|lives|flame|soul)|drain(?:ed|ing)?|wolves|wolf|beasts?|bandits?|boars?)\b/i,
  yes: /^\s*(?:yes|yeah|aye|it'?s true|true|i did|i have|i do)\s*[.!,]*\s*(?:it'?s true|i did|i have|i do)?\s*[.!]*\s*$|^\s*(?:yes|yeah|aye|it'?s true)\b/i,
  excuse: /\b(ill|sick|fever|a chill|caught a cold|cold blood(?:ed)?|poor blood|the lake|swim(?:ming)?|the long sleep|slept|the ruins|tired|winter|weather|always been cold|cold hands|circulation|nerves)\b/i,
  deny: /\b(no|nothing|not|never|didn'?t|don'?t|haven'?t|wasn'?t|none of your|mind your own|leave me|i'?m fine|nothing'?s wrong)\b/i,
  neg: /\b(no|not|never|didn'?t|don'?t|haven'?t|wasn'?t|nothing|any|nor)\b[^.!?]{0,24}$/i,
  touch: /\*[^*\n]{0,60}\b(hugs?|hugging|embrace[sd]?|embracing|holds?|holding|hand|hands|kiss(?:es)?|kissing|touch(?:es)?|touching|clasps?|squeezes?|pats?|shakes?|cuddles?|strokes?|leans? on)\b[^*\n]{0,60}\*/i,
  rite: /\b(rite|let it out|let it go|take it out|take it from me|help me|i'?ll come|do it|yes,? please|please help)\b/i,
};

// The verdict, decided before anything is worded (pure; tests call it). k: what she knows;
// answer: what the player said. -> { verdict: 'believed'|'doubted'|'knows', kind, caught, killer }
export function classify(text, dead = []) {
  const t = String(text || '');
  const hitNeg = (rx) => {
    const m = rx.exec(t);
    if (!m) return null;
    return { neg: RX.neg.test(t.slice(0, m.index)), m };
  };
  for (const d of dead) {
    if (!d?.name) continue;
    const re = new RegExp(`\\b${d.name.replace(/[^\w]/g, '')}\\b`, 'i');
    if (re.test(t) && RX.kill.test(t) && !RX.neg.test(t.slice(0, t.search(RX.kill)))) return { kind: 'confess_kill', victim: d.id };
  }
  const dark = hitNeg(RX.dark);
  if (dark && !dark.neg) return { kind: 'confess' };
  if (RX.excuse.test(t) && !RX.yes.test(t)) return { kind: 'excuse' };
  if (RX.yes.test(t) && !RX.deny.test(t.replace(RX.yes, ''))) return { kind: 'confess' };
  if (RX.deny.test(t) || dark?.neg) return { kind: 'deny' };
  return { kind: 'evade' };
}

export function decideVerdict(k, answer) {
  const a = typeof answer === 'string' ? classify(answer, k?.dead || []) : answer || { kind: 'evade' };
  if (a.kind === 'confess_kill') return { verdict: 'knows', kind: a.kind, caught: false, killer: a.victim };
  if (a.kind === 'confess') return { verdict: 'knows', kind: a.kind, caught: false, killer: null };
  // A denial, an excuse, an evasion: does it fit what she knows?
  if (k?.dark && k.dark !== 'confessed') return { verdict: 'knows', kind: a.kind, caught: true, killer: null };
  const ev = evidenceOf(k);
  if (ev >= 9) return { verdict: 'knows', kind: a.kind, caught: true, killer: null, undeniable: true };
  if (ev >= 6) return { verdict: 'doubted', kind: a.kind, caught: false, killer: null };
  // Only the faint signs (cold hands, breath): an illness fits them; a flat no fits little.
  const strongest = Math.max(0, ...(k?.signs || []).map((s) => SIGN_TIER[s] || 0));
  if (a.kind === 'excuse' && strongest <= 1 && !(k?.flames?.length > 0)) return { verdict: 'believed', kind: a.kind, caught: false, killer: null };
  if (ev <= 2) return { verdict: 'believed', kind: a.kind, caught: false, killer: null };
  return { verdict: 'doubted', kind: a.kind, caught: false, killer: null };
}

// How much what she knows weighs: a faint sign 1, a clear 2, a strong 3; each flame that
// guttered at a death 3 (at most two counted); being told by others 1.
export function evidenceOf(k) {
  if (!k) return 0;
  let e = 0;
  for (const s of new Set(k.signs || [])) e += SIGN_TIER[s] || 0;
  e += 3 * Math.min(2, k.flames?.length || 0);
  if (k.toldBy?.length) e += 1;
  return e;
}

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[dark suspicion]', err);
    return fallback;
  }
}

const clamp = (v, a = 0, b = 100) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

export class DarkSuspicion {
  constructor(game, unk) {
    this.game = game;
    this.unk = unk;
    this.people = {}; // id -> state
    this.asking = null; // { id, phase: 'coming'|'open'|'answered', t0, at, verdict }
    this.darkRumors = []; // rumour ids of seen dark magic (their heardBy learn it, by meeting)
    this.touchNow = null; // { id } while a touch's reply is worded
    this.tickT = TICK;
    this.barkAt = -Infinity;
    this._t = null;
    this.installed = false;
    this._offs = [];
    this._duty = null;
  }

  get coldfire() {
    return this.unk?.coldfire || null;
  }

  get village() {
    return this.game?.village || null;
  }

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : Number(this.game?.time) || 0;
  }

  day() {
    return this.game?.clock?.day ?? 1;
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  rng() {
    const r = this.game?.rng;
    return typeof r?.next === 'function' ? r.next() : Math.random();
  }

  pick(list) {
    return Array.isArray(list) ? list[Math.floor(this.rng() * list.length) % list.length] : list;
  }

  tier() {
    return this.coldfire?.tier?.() ?? 0;
  }

  entity(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    if (id === 'lyra') return lyraOf(this.game);
    return safe(() => this.game?.entities?.get?.(id), null);
  }

  name(id) {
    return safe(() => this.game?.murder?.name?.(id), null) || this.entity(id)?.name?.split(' ')[0] || id;
  }

  st(id) {
    if (!id) return null;
    let s = this.people[id];
    if (!s) {
      s = { s: 0, signs: {}, seenAt: {}, told: [], dark: null, darkFrom: null, darkBeast: null, asked: null, askedStop: null, tierAtStop: null, riteOffered: false, wentOn: false, fear: 0, warmerSaid: false, flames: [], barkDay: -1 };
      this.people[id] = s;
    }
    return s;
  }

  // Everyone who could perceive you: the grown villagers, Lyra, whoever walks with you.
  everyone() {
    const g = this.game;
    const out = [];
    const seen = new Set();
    const add = (e) => {
      if (!e || seen.has(e) || e.removed) return;
      seen.add(e);
      out.push(e);
    };
    for (const e of safe(() => g?.villageLife?.villagers?.(), []) || []) add(e);
    if (!out.length) for (const id of VILLAGERS) add(this.entity(id));
    add(lyraOf(g));
    add(safe(() => g?.party?.holder, null));
    return out.filter((e) => !isMinor(g, e));
  }

  awake(e) {
    return !!e && !e.dead && !e.downed && !e.absent && e.state !== 'sleep' && e.activity !== 'sleep' && (e.isAlive?.() ?? true);
  }

  // How the signs read to them: Aveline (the keeper of the family flames) most; those who pray
  // at the chapel, or keep the old superstitions; the ordinary least.
  faithOf(e) {
    const id = e?.id;
    if (!id) return FAITH_ORDINARY;
    if (FAITH[id]) return FAITH[id];
    if (e === lyraOf(this.game)) return LYRA_FAITH;
    const p = e.profile || {};
    const days = [p.schedule, p.routine, p.day, ...(Array.isArray(p.schedules) ? p.schedules : [])].filter(Array.isArray).flat();
    if (days.some((x) => x?.activity === 'pray')) return FAITH_PRAY;
    if ((p.traits || []).includes('superstitious')) return FAITH_SUPERSTITIOUS;
    return FAITH_ORDINARY;
  }

  isFaithful(e) {
    return this.faithOf(e) >= FAITH_SUPERSTITIOUS && e !== lyraOf(this.game);
  }

  // ------------------------------------------------------------------ perceiving

  // `e` perceived a sign of the taken flame (at most once an in-game hour for each sign).
  perceive(e, sign, { force = false } = {}) {
    if (!e?.id || !SIGN_PTS[sign]) return 0;
    const st = this.st(e.id);
    const t = this.now();
    if (!force && t - (st.seenAt[sign] ?? -Infinity) < HOUR) return 0;
    st.seenAt[sign] = Math.round(t);
    st.signs[sign] = (st.signs[sign] || 0) + 1;
    const faith = this.faithOf(e);
    const add = SIGN_PTS[sign] * faith;
    const cap = faith >= FAITH_SUPERSTITIOUS ? 100 : ORDINARY_CAP;
    // A believable lie quiets her for a while: the signs weigh less until then.
    const quiet = st.quietUntil != null && t < st.quietUntil ? 0.35 : 1;
    st.s = Math.min(cap, Math.max(st.s, clamp(st.s + add * quiet)));
    // The strong signs, seen by the faithful, are undeniable.
    if ((SIGN_TIER[sign] || 0) >= 3 && faith >= FAITH_PRAY && !st.dark && st.signs[sign] >= 2) this.learnDark(e, 'undeniable');
    // Gone on after being asked to stop: worry grows into fear (never a crime).
    if (st.askedStop != null && st.wentOn) {
      st.fear = clamp(st.fear + 20);
      st.wentOn = false;
      if (this.awake(e) && dist(e, this.game?.player) < SEE_R) this.say(e, this.pick(DARK_LINES.fear));
      this.feelLyra(e, 'fear', 0.6, 'they did not stop');
    }
    if (e === lyraOf(this.game)) this.lyraNotices(sign);
    return add;
  }

  lyraNotices(sign) {
    const L = lyraOf(this.game);
    const st = this.st('lyra');
    if (!L || st.signs[sign] > 1) return;
    safe(() => L.mind?.remember?.(`Something is wrong with the stranger: ${SIGN_WORDS[sign].brief}. It is not any weave I know.`, { type: 'observation', importance: 5, about: ['player'], tags: ['coldfire', 'signs'], emotion: 'unease' }));
  }

  // What each person can perceive this beat, by sight (sight.js), at the distance the sign shows.
  look() {
    const g = this.game;
    const P = g?.player;
    const tier = this.tier();
    if (!P || P.dead || tier < 1) return;
    const night = this.isNight();
    const signs = this.unk?.signs;
    const t = this.now();
    const lean = tier >= 2 && safe(() => signs?.leaningNear?.(), false);
    const shy = tier >= 2 && t - (signs?.shyAt ?? -Infinity) < 3;
    const frost = tier >= 2 && night && t - (signs?.frostAt ?? -Infinity) < 20;
    const moving = Math.hypot(P.vel?.x || 0, P.vel?.y || 0) > 12;
    for (const e of this.everyone()) {
      if (!this.awake(e)) continue;
      const d = dist(e, P);
      if (d > SEE_R || !seesActor(g, e, P)) continue;
      if (night && d <= CLOSE_R) this.perceive(e, 'breath');
      if (lean && d <= SEE_R * 0.8) this.perceive(e, 'flames');
      if (shy) this.perceive(e, 'beasts');
      if (frost && d <= 5 * TILE) this.perceive(e, 'frost');
      if (tier >= 3 && night && d <= CLOSE_R) this.perceive(e, 'eyes');
      if (tier >= 3 && !night && moving && d <= 4 * TILE) this.perceive(e, 'shadow');
    }
  }

  isNight() {
    const c = this.game?.clock;
    if (typeof c?.isNight === 'boolean') return c.isNight;
    const h = this.hour();
    return h >= 20 || h < 6;
  }

  // Touched through an act (*hugs Elda*) or tending you (Mira): your hands are ice.
  touched(e, how = 'act') {
    if (!e || this.tier() < 1 || !this.awake(e)) return false;
    const P = this.game?.player;
    if (how === 'act' && dist(e, P) > TOUCH_R) return false;
    this.perceive(e, 'hands', { force: true });
    return true;
  }

  // ------------------------------------------------------------------ dark magic, known

  // A soul taken (unkindle.take). Prey: whoever SAW it saw dark magic (sight.js, from where the
  // prey fell and from you). A person: those who asked you to stop learn you went on.
  onTaken(ch, rec) {
    const g = this.game;
    const P = g?.player;
    for (const id of Object.keys(this.people)) {
      const st = this.people[id];
      if (st.askedStop != null) st.wentOn = true;
    }
    if (rec || !ch || ch.kind === 'person' || ch.kind === 'dummy') return;
    const e = ch.target;
    const people = this.everyone();
    const ids = new Set();
    for (const id of safe(() => watchersOf(g, e.x, e.y, people), []) || []) ids.add(id);
    for (const id of safe(() => watchersOf(g, P.x, P.y, people), []) || []) ids.add(id);
    const seers = [...ids].filter((id) => id && id !== 'player');
    const beast = ch.kind === 'bandit' ? 'bandit' : String(e.species || e.name || 'beast').toLowerCase().replace(/_/g, ' ');
    let n = 0;
    for (const id of seers) {
      const w = this.entity(id);
      if (!w) continue;
      this.learnDark(w, 'saw', { beast });
      if (n++ < 2) this.say(w, this.pick(DARK_LINES.sawPrey), 'shout');
    }
    if (!seers.length) return;
    const r = safe(() => this.village?.addRumor?.('dark_magic', { victim: null, beast, witnesses: seers, saw: seers, source: seers.find((x) => x !== 'lyra') || seers[0] }), null);
    if (r?.id) {
      this.darkRumors.push(r.id);
      if (this.darkRumors.length > 20) this.darkRumors.splice(0, this.darkRumors.length - 20);
    }
    safe(() => g.villageLife?.event?.('dark', `${seers.map((id) => this.name(id)).join(' and ')} saw ${this.playerName()} draw the life out of a ${beast} with a bare hand. Dark magic, they call it; no crime.`, { who: seers[0], about: 'player' }));
  }

  playerName() {
    return safe(() => this.game?.murder?.playerName?.(), null) || 'the stranger';
  }

  // They know you use dark magic now. Dangerous, not evil: a little opinion, wariness; they
  // will ask you to stop. Lyra keeps it in her own memory and feels it in her own way.
  learnDark(e, how, { beast = null, from = null } = {}) {
    const st = this.st(e?.id);
    if (!st) return;
    const first = !st.dark;
    if (first || how === 'saw' || how === 'confessed') {
      st.dark = st.dark === 'saw' && how !== 'confessed' ? 'saw' : how;
      if (beast) st.darkBeast = beast;
      if (from) st.darkFrom = from;
    }
    if (!first) return;
    st.darkDay = this.day();
    st.s = clamp(Math.max(st.s, 50));
    if (e === lyraOf(this.game)) {
      const L = e;
      const what = how === 'saw' ? `I watched the stranger draw the life out of a ${beast || 'beast'} with a bare hand. Its light went into their hand.` : how === 'confessed' ? 'The stranger told me what they do: they draw the life out of things with a bare hand.' : 'The stranger uses something dark: a cold that takes the life out of things.';
      safe(() => L.mind?.remember?.(what, { type: 'event', importance: 8, about: ['player'], tags: ['coldfire', 'dark_magic'], emotion: 'fear' }));
      this.feelLyra(L, 'fear', 0.5, 'the stranger uses dark magic');
      safe(() => L.mind?.relationships?.adjust?.('player', { trust: -3 }, 'dark magic'));
      return;
    }
    safe(() => e.adjustOpinion?.(DARK_OPINION, 'dark magic'));
  }

  feelLyra(e, emotion, amount, why) {
    const L = lyraOf(this.game);
    if (!L || e !== L) return;
    safe(() => L.mind?.feel?.(emotion, amount, why));
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
    const t = this.now();
    const days = this._t == null || t < this._t ? 0 : (t - this._t) / DAY_SECONDS;
    this._t = t;
    this.look();
    this.joinFlames();
    this.readRumors();
    this.fade(days);
    this.remarks();
    this.stepAsking();
    if (!this.asking) this.maybeAsk();
    void g;
  }

  // Aveline joins the household flames she found guttered at the hours of the deaths to the
  // signs she has seen on you (only what she knows: rec.flame.known).
  joinFlames() {
    const av = this.entity('aveline');
    if (!av || av.dead) return;
    const st = this.people.aveline;
    if (!st || !Object.keys(st.signs).length) return;
    for (const rec of safe(() => this.unk?.village?.records?.(), []) || []) {
      if (rec.by !== 'player' || !rec.flame?.known || st.flames.some((f) => f.id === rec.id)) continue;
      st.flames.push({ id: rec.id, house: rec.flame.house, hour: rec.flame.hour, name: this.name(rec.id) });
      st.s = clamp(st.s + FLAME_JOIN);
    }
  }

  // The seen dark magic, carried by meeting: whoever has heard it knows (told).
  readRumors() {
    const v = this.village;
    for (const rid of this.darkRumors) {
      const r = safe(() => v?.rumors?.get?.(rid), null);
      for (const id of r?.heardBy || []) {
        const st = this.people[id];
        if (st?.dark) continue;
        const e = this.entity(id);
        if (!e || isMinor(this.game, e)) continue;
        this.learnDark(e, 'told', { beast: r.beast || null, from: (r.saw || [])[0] || r.source || null });
      }
    }
  }

  // Suspicion falls with time, faster once the signs are gone; the fear of those who asked
  // you to stop falls when you have.
  fade(days) {
    if (!(days > 0)) return;
    const tier = this.tier();
    const rest = this.coldfire?.restDays?.() ?? Infinity;
    for (const st of Object.values(this.people)) {
      st.s = clamp(st.s - (tier === 0 ? 12 : 3) * days);
      if (rest > 7) st.fear = clamp(st.fear - 6 * days);
    }
  }

  // Their own words near you (offline; their own voice, so the hearing rule carries them): the
  // ordinary ask if you are ill; those who know are wary; those who asked notice you warmer.
  remarks() {
    const g = this.game;
    const P = g?.player;
    if (!P || this.asking) return;
    const t = this.now();
    if (t - this.barkAt < BARK_GAP) return;
    const tier = this.tier();
    const rest = this.coldfire?.restDays?.() ?? Infinity;
    const day = this.day();
    for (const e of this.everyone()) {
      if (e === lyraOf(g) || !this.awake(e) || e.mode === 'fight' || e.mode === 'flee') continue;
      const st = this.people[e.id];
      if (!st || st.barkDay === day) continue;
      if (dist(e, P) > 3 * TILE || !seesActor(g, e, P)) continue;
      let line = null;
      if (st.askedStop != null && !st.warmerSaid && rest >= 7 && tier < (st.tierAtStop ?? 1)) {
        line = this.pick(DARK_LINES.warmer);
        st.warmerSaid = true;
        st.s = clamp(st.s - 20);
        st.fear = 0;
      } else if (st.dark && tier >= 1) line = this.pick(DARK_LINES.wary);
      else if (!this.isFaithful(e) && tier >= 1 && (st.signs.hands || st.signs.breath)) line = DARK_LINES.ill[0];
      else if (!this.isFaithful(e) && tier >= 2 && (st.signs.flames || st.signs.beasts || st.signs.frost)) line = this.pick(DARK_LINES.odd);
      if (!line) continue;
      st.barkDay = day;
      this.barkAt = t;
      this.say(e, line);
      return;
    }
    this.barkAt = t - BARK_GAP / 2;
  }

  say(e, text, kind = 'say') {
    if (!e || !text) return;
    const P = this.game?.player;
    if (e === lyraOf(this.game)) {
      const a = e.mind?.autonomy;
      if (a?.say) safe(() => a.say(text, { force: true, kind }));
      else safe(() => e.mind?.say?.(text, { kind }));
      return;
    }
    safe(() => (typeof e.say === 'function' ? e.say(text, { kind, target: P || null }) : this.game?.bubbles?.say?.(e, text, { kind })));
  }

  // ------------------------------------------------------------------ the asking

  // Who would come: Aveline first; else another of the faithful past the mark.
  asker() {
    const t = this.now();
    const ready = (e) => {
      if (!e || e.dead || !this.awake(e) || e.mode === 'fight' || e.mode === 'flee') return false;
      const st = this.people[e.id];
      if (!st || st.s < ASK_AT) return false;
      // Once she knows and has asked you to stop, she does not ask again: she watches.
      if (st.asked?.verdict === 'knows' || st.askedStop != null) return false;
      if (st.quietUntil != null && t < st.quietUntil) return false;
      if (st.asked && this.day() - st.asked.day < ASK_GAP_DAYS) return false;
      if (safe(() => this.unk?.village?.knows?.(e.id), false)) return false; // they know a killing: that is the murder path
      if (safe(() => this.game?.murder?.fearOf?.(e), null)) return false;
      return true;
    };
    const av = this.entity('aveline');
    if (ready(av)) return av;
    for (const e of this.everyone()) if (e !== av && e !== lyraOf(this.game) && this.isFaithful(e) && ready(e)) return e;
    return null;
  }

  maybeAsk() {
    const g = this.game;
    const P = g?.player;
    if (!P || g.state !== 'playing' || P.downed || P.dead) return;
    const h = this.hour();
    if (h < 8 || h >= 19) return; // by day
    if (this.unk?.channel) return;
    const e = this.asker();
    if (!e) return;
    if (dist(e, P) > 40 * TILE) return; // she is not across the world
    this.asking = { id: e.id, phase: 'coming', t0: Math.round(this.now()), at: null, verdict: null };
    this.setDuty(e);
    safe(() => g.bus?.emit?.('dark_asking', { id: e.id, phase: 'coming' }));
  }

  setDuty(e) {
    if (!e) return;
    if (e.duty && e.duty !== this._duty) return; // a companion's duty: she is beside you already
    const self = this;
    this._duty = {
      kind: 'dark_asking',
      step(npc, dt, tick) {
        return safe(() => self.dutyStep(npc, dt, tick), undefined);
      },
    };
    e.duty = this._duty;
  }

  clearDuty(e) {
    if (e && e.duty === this._duty) e.duty = null;
    if (e && e.mode === 'duty') e.mode = 'routine';
  }

  // Walking up to you, then standing with you while you answer.
  dutyStep(npc, dt, tick) {
    const a = this.asking;
    const P = this.game?.player;
    if (!a || a.id !== npc.id || !P) {
      this.clearDuty(npc);
      return undefined;
    }
    const d = dist(npc, P);
    if (a.phase === 'coming') {
      if (d > 26) {
        if (tick || !npc.r?.walking) safe(() => (npc.walkTo ? npc.walkTo({ x: P.x, y: P.y }, 1.1) : npc.walker?.goTo?.(P.x, P.y)));
        return true;
      }
      safe(() => npc.walker?.stop?.());
      if (npc.r) npc.r.walking = false;
      safe(() => npc.faceToward?.(P.x, P.y));
      return true;
    }
    safe(() => npc.walker?.stop?.());
    if (npc.r) npc.r.walking = false;
    safe(() => npc.faceToward?.(P.x, P.y));
    return true;
  }

  // Nobody else's eyes on you (sight.js): the asking is private. Whoever walks with you may stay.
  isPrivate(e) {
    const g = this.game;
    const P = g?.player;
    const others = this.everyone().filter((x) => x !== e && x !== lyraOf(g) && x !== safe(() => g.party?.holder, null) && this.awake(x) && dist(x, P) <= PRIVATE_R);
    return !(safe(() => watchersOf(g, P.x, P.y, others), []) || []).length;
  }

  stepAsking() {
    const a = this.asking;
    if (!a) return;
    const g = this.game;
    const P = g?.player;
    const e = this.entity(a.id);
    const t = this.now();
    const give = (why) => {
      if (e && this.awake(e) && why !== 'gone') this.say(e, this.pick(DARK_LINES.another));
      const st = this.st(a.id);
      st.asked = { day: this.day(), verdict: null, why };
      this.asking = null;
      this.clearDuty(e);
      safe(() => g.bus?.emit?.('dark_asking', { id: a.id, phase: 'gave_up', why }));
    };
    if (!e || !this.awake(e) || e.mode === 'fight' || e.mode === 'flee' || !P || P.downed || P.dead) return give('gone');
    if (a.phase === 'coming') {
      if (t - a.t0 > 150) return give('far');
      if (dist(e, P) <= 30) {
        a.at ??= t;
        if (this.isPrivate(e) && !this.unk?.channel) return this.openAsking(e);
        if (t - a.at > 45) return give('not_private');
      } else a.at = null;
      return;
    }
    if (a.phase === 'open') {
      if (dist(e, P) > 7 * TILE || t - a.openT > 120) return give('walked_off');
      return;
    }
    if ((a.phase === 'answered' || a.phase === 'done') && t - (a.answeredT ?? t) > 5) {
      this.asking = null;
      this.clearDuty(e);
    }
  }

  // What she knows, all of it her own: the signs she saw, the flames, what others told her,
  // and the dark magic seen.
  knowledge(id) {
    const st = this.st(id);
    const dead = (safe(() => this.unk?.village?.records?.(), []) || []).filter((r) => r.by === 'player').map((r) => ({ id: r.id, name: this.name(r.id) }));
    return { signs: Object.keys(st.signs), flames: st.flames.slice(), toldBy: st.told.slice(), dark: st.dark, darkFrom: st.darkFrom, darkBeast: st.darkBeast, dead };
  }

  openingLine(e) {
    const st = this.st(e.id);
    const o = e.id === 'aveline' ? OPEN.aveline : OPEN.other;
    const order = ['flames', 'frost', 'beasts', 'eyes', 'shadow', 'hands', 'breath'];
    const seen = order.filter((s) => st.signs[s]).slice(0, 2).map((s) => SIGN_WORDS[s].you);
    const parts = [o.greet];
    if (seen.length) parts.push(`I've seen it: ${seen.join(', and ')}.`);
    if (e.id === 'aveline' && st.flames.length) {
      const f = st.flames[st.flames.length - 1];
      const House = f.house.charAt(0).toUpperCase() + f.house.slice(1);
      parts.push(st.flames.length > 1 ? 'And the family flames guttered on the altar, each at the hour one of them died.' : `And ${House} guttered on the altar the hour ${f.name} died.`);
    }
    if (st.dark === 'saw' || st.dark === 'told') parts.push(st.dark === 'saw' ? `And I saw what you did to that ${st.darkBeast || 'beast'}.` : `And ${this.name(st.darkFrom) || 'someone'} told me what you did to a ${st.darkBeast || 'beast'}.`);
    parts.push(o.ask);
    return parts.join(' ');
  }

  openAsking(e) {
    const g = this.game;
    const a = this.asking;
    a.phase = 'open';
    a.openT = Math.round(this.now());
    const line = this.openingLine(e);
    a.line = line;
    const ui = g.ui;
    let opened = false;
    if (typeof ui?.talkTo === 'function') opened = !!safe(() => ui.talkTo(e.id), false);
    if (!opened && ui?.chat?.selectTarget) {
      opened = !!safe(() => ui.chat.selectTarget(e.id, { from: 'asking' }), false);
      if (opened) safe(() => ui.chat.open?.(!ui.isTouch));
    }
    if (ui?.chat?.pushVillager) safe(() => ui.chat.pushVillager(e.id, { from: 'npc', text: line }));
    this.say(e, line);
    safe(() => e.walker?.stop?.());
    if ('talkingUntil' in e) e.talkingUntil = Math.max(e.talkingUntil ?? 0, this.now() + 30);
    if (this.village) safe(() => addNote(this.village, e.id, 'I asked the stranger, privately, about the cold on them', 1));
    safe(() => g.bus?.emit?.('dark_asking', { id: e.id, phase: 'open', line }));
  }

  // The player's words reached her (the village's playerSays: heard and remembered first, as
  // always). While her asking is open, the verdict is decided here, before any wording.
  decide(e, text) {
    const a = this.asking;
    if (!a || a.id !== e?.id || a.phase !== 'open') return null;
    const k = this.knowledge(e.id);
    const v = decideVerdict(k, text);
    a.verdict = v;
    a.phase = 'answered';
    a.answeredT = Math.round(this.now());
    a.answer = String(text || '').slice(0, 160);
    return v;
  }

  // The verdict's consequences, once the reply is out.
  apply(e, v) {
    const g = this.game;
    const st = this.st(e.id);
    st.asked = { day: this.day(), verdict: v.verdict, kind: v.kind, caught: !!v.caught };
    const t = this.now();
    if (v.verdict === 'believed') {
      st.s = clamp(st.s - 45);
      st.quietUntil = Math.round(t + QUIET_DAYS * DAY_SECONDS);
    } else if (v.verdict === 'doubted') {
      st.s = clamp(st.s + 10);
      st.quietUntil = Math.round(t + 2 * DAY_SECONDS);
      safe(() => e.adjustOpinion?.(-2, 'would not tell her true'));
    } else if (v.verdict === 'knows') {
      if (v.killer) {
        // A killing confessed: murder, with all that follows (the village side links it).
        const hv = this.unk?.village;
        if (hv) {
          hv.knowers.add(e.id);
          safe(() => hv.link());
        }
        this.learnDark(e, 'confessed');
      } else {
        this.learnDark(e, v.caught ? 'caught' : 'confessed');
        if (v.caught) {
          safe(() => e.adjustOpinion?.(LIE_CAUGHT_OPINION, 'lied to her face'));
          st.s = clamp(st.s + 20);
        }
        st.askedStop = this.day();
        st.tierAtStop = Math.max(1, this.tier());
        st.wentOn = false;
        st.riteOffered = e.id === 'aveline';
      }
    }
    safe(() => g.bus?.emit?.('dark_verdict', { id: e.id, verdict: v.verdict, caught: !!v.caught, killer: v.killer || null }));
  }

  verdictLines(e, v) {
    const set = e.id === 'aveline' ? VERDICT.aveline : VERDICT.other;
    const st = this.st(e.id);
    let tpl = set[v.verdict];
    if (v.verdict === 'knows' && v.killer) tpl = set.killer;
    else if (v.verdict === 'knows' && v.caught) tpl = set.caught;
    return [fill(tpl, { who: this.name(st.darkFrom) || 'Someone', beast: st.darkBeast || 'beast', V: this.name(v.killer) })];
  }

  // ------------------------------------------------------------------ the rite

  // Aveline's rite at the chapel flame: the cold let out (your choice).
  atChapel(e) {
    const g = this.game;
    const P = g?.player;
    const here = (x) => safe(() => g.locations?.at?.(x.x, x.y)?.id, null) === 'chapel';
    return !!P && here(P) && (!e || here(e) || dist(e, P) <= 5 * TILE);
  }

  rite(e) {
    const g = this.game;
    const had = safe(() => this.coldfire?.rite?.(), 0) || 0;
    const st = this.st(e?.id || 'aveline');
    st.riteOffered = false;
    st.s = clamp(st.s - 40);
    st.fear = 0;
    for (const x of Object.values(this.people)) x.s = clamp(x.s - 15);
    safe(() => g.villageLife?.event?.('rite', `${this.playerName()} knelt at the family flames with Sister Aveline, and let the cold out into the light.`, { who: 'aveline', about: 'player' }));
    safe(() => g.ui?.toast?.('You knelt with Sister Aveline at the family flames. The cold went out of you, into the light.', 'info', { key: 'dark_rite' }));
    safe(() => g.unkindle?.signs?.onRite?.());
    safe(() => g.bus?.emit?.('dark_rite', { had }));
    return had;
  }

  // ------------------------------------------------------------------ the talk, wrapped

  // Before the original playerSays (which hears and remembers first): a touch in an act, the
  // asking's verdict, the rite asked for. -> what afterWords needs.
  beforeWords(e, text) {
    if (!e?.id) return null;
    const pre = {};
    const t = String(text || '');
    if (RX.touch.test(t) && this.touched(e, 'act')) {
      pre.touch = true;
      this.touchNow = { id: e.id };
    }
    const v = this.decide(e, t);
    if (v) pre.verdict = v;
    const st = this.people[e.id];
    if (!v && e.id === 'aveline' && st?.riteOffered && RX.rite.test(t)) {
      pre.rite = this.atChapel(e) ? 'here' : 'there';
      this.riteNow = { id: e.id, where: pre.rite };
    }
    return Object.keys(pre).length ? pre : null;
  }

  afterWords(e, text, reply, pre) {
    this.touchNow = null;
    this.riteNow = null;
    if (!pre || !reply || typeof reply !== 'object') return reply;
    const offline = reply.source !== 'claude';
    if (pre.verdict) {
      this.apply(e, pre.verdict);
      // Worded: she lingers a moment by you (the duty), then goes back to her day.
      if (this.asking?.id === e.id) this.asking.phase = 'done';
      if (offline || !reply.lines?.length) {
        reply.lines = this.verdictLines(e, pre.verdict);
        reply.silent = false;
      }
    }
    if (pre.rite) {
      if (pre.rite === 'here') this.rite(e);
      if (offline || !reply.lines?.length) {
        reply.lines = [RITE[pre.rite]];
        reply.silent = false;
      }
    }
    if (pre.touch && !pre.verdict && offline && !reply.silent) {
      const line = this.isFaithful(e) ? DARK_LINES.touched[0] : this.pick(DARK_LINES.touched);
      reply.lines = [line, ...(reply.lines || [])].slice(0, 3);
    }
    return reply;
  }

  // Wrap the village's playerSays on the instance (no file edited): every message is heard and
  // remembered by the original first; the verdict is decided before it is worded.
  wrapTalk() {
    const v = this.village;
    if (!v || v._darkWrapped || typeof v.playerSays !== 'function') return false;
    const orig = v.playerSays.bind(v);
    const self = this;
    v.playerSays = async function darkPlayerSays(npc, text, ...rest) {
      const e = typeof npc === 'string' ? safe(() => v.entity(npc), null) : npc;
      const pre = safe(() => self.beforeWords(e, text), null);
      let reply;
      try {
        reply = await orig(npc, text, ...rest);
      } catch (err) {
        self.touchNow = null;
        throw err;
      }
      return safe(() => self.afterWords(e, text, reply, pre), reply) || reply;
    };
    v._darkWrapped = true;
    return true;
  }

  // ------------------------------------------------------------------ what they perceive

  // During her asking (and the reply to your answer): only her knowledge and the verdict.
  askingBrief(id) {
    const a = this.asking;
    const rn = this.riteNow;
    if (rn && rn.id === id) return rn.where === 'here' ? 'They have asked you for the rite: you do it now, kneeling with them at the family flames, letting the cold out of them into the light. Speak them through it, briefly and kindly.' : 'They have asked you for the rite to let the cold out of them. It is done at the chapel, by the family flames: tell them to come there.';
    if (!a || a.id !== id || (a.phase !== 'open' && a.phase !== 'answered')) return '';
    const k = this.knowledge(id);
    const seen = k.signs.slice(0, 2).map((s) => SIGN_WORDS[s].brief);
    const fl = k.flames.length ? `; ${k.flames[k.flames.length - 1].name}'s household flame guttered the hour they died` : '';
    const base = `You asked them in private about the cold that takes: you saw ${seen.join(', ') || 'the signs'}${fl}.`;
    const v = a.verdict;
    if (!v) return `${base} Hear their answer.`;
    const st = this.st(id);
    if (v.verdict === 'believed') return `${base} Their answer you BELIEVE, for now: let it go gently; tell them to see Mira.`;
    if (v.verdict === 'doubted') return `${base} Their answer you DOUBT: it does not fit what you saw. Say so kindly; you will watch them.`;
    if (v.killer) return `${base} They confessed they killed ${this.name(v.killer)}. You are horrified; you cannot keep it.`;
    if (v.caught) return `${base} They LIED: ${this.name(st.darkFrom) || 'someone'} saw them take a ${st.darkBeast || 'beast'}'s life by hand. Say you know. Ask them to stop.`.slice(0, 220);
    return `${base} It is true: dark magic. Not evil, but dangerous. Ask them to stop${id === 'aveline' ? '; offer the rite at the chapel flame, their choice' : ''}.`;
  }

  // One line of what this person perceives of the signs, or knows of your dark magic.
  briefLine(id) {
    if (!id || id === 'player') return '';
    const st = this.people[id];
    const out = [];
    if (this.touchNow?.id === id) out.push('They just touched you: their hands are ice-cold, cold as well-stone. Say so.');
    if (st?.dark) {
      const how = st.dark === 'saw' ? `you SAW them draw the life out of a ${st.darkBeast || 'beast'} with a bare hand` : st.dark === 'told' ? `${this.name(st.darkFrom) || 'someone'} told you they drew the life out of a ${st.darkBeast || 'beast'} by hand` : st.dark === 'undeniable' ? 'the signs on them are too plain to deny' : 'they told you themselves';
      out.push(`You know they use dark magic: ${how}. Dangerous, not evil: you are wary, and want them to stop.`);
      if (st.fear >= 20) out.push('They went on after being asked to stop; you are afraid of what it does to them.');
      else if (st.warmerSaid) out.push('They stopped; they are warmer now, and you are glad.');
    } else if (st && Object.keys(st.signs).length && this.tier() >= 1) {
      const seen = Object.keys(st.signs).slice(-2).map((s) => SIGN_WORDS[s].brief);
      const e = this.entity(id);
      const read = id === 'aveline' ? 'You keep the family flames; the old teaching speaks of a cold that takes.' : this.isFaithful(e) ? 'It troubles you, like an old tale of a cold that takes.' : 'Odd; you wonder if they are ill.';
      out.push(`You have noticed ${seen.join(' and ')}. ${read}`);
    }
    let s = out.join(' ');
    if (s.length > 200) s = `${s.slice(0, 199).replace(/\s+\S*$/, '')}…`;
    return s;
  }

  // ------------------------------------------------------------------ wiring and saving

  install() {
    if (this.installed) return;
    const bus = this.game?.bus;
    if (bus?.on) {
      // Worry travels by meeting: only to the faithful and the teller's friends.
      this._offs.push(bus.on('village_talk', (p) => safe(() => this.onMeeting(p?.a, p?.b))));
      // Whoever tends you (helps you up, Mira at her cots) feels the cold of you.
      this._offs.push(
        bus.on('revived', (p) =>
          safe(() => {
            const P = this.game?.player;
            if (!p || p.entity !== P || !p.by || p.by === P) return;
            if (this.touched(p.by, 'tend')) this.say(p.by, p.by.id === 'mira' ? DARK_LINES.tended[0] : this.pick(DARK_LINES.tended));
          }),
        ),
      );
    }
    this.wrapTalk();
    this.installed = true;
  }

  onMeeting(a, b) {
    if (!a || !b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const sx = this.people[x];
      if (!sx || sx.s < 25 || y === 'player') continue;
      const ey = this.entity(y);
      if (!ey || isMinor(this.game, ey)) continue;
      const friend = safe(() => (this.village?.bond?.(x, y)?.tags || []).some((t) => ['friend', 'mentor', 'apprentice', 'family', 'spouse', 'sibling'].includes(t)), false);
      if (!this.isFaithful(ey) && !friend) continue;
      const sy = this.st(y);
      const add = Math.round(sx.s * 0.3 * (this.isFaithful(ey) ? 1 : 0.5));
      sy.s = Math.min(this.isFaithful(ey) ? 100 : ORDINARY_CAP, Math.max(sy.s, clamp(sy.s + add)));
      if (!sy.told.includes(x)) sy.told.push(x);
    }
  }

  serialize() {
    const people = {};
    for (const [id, st] of Object.entries(this.people)) {
      people[id] = { ...st, signs: { ...st.signs }, seenAt: { ...st.seenAt }, told: st.told.slice(0, 8), flames: st.flames.slice(-6) };
    }
    return { v: 1, people, darkRumors: this.darkRumors.slice(-20) };
  }

  deserialize(d) {
    this.asking = null;
    this.touchNow = null;
    this._t = null;
    if (!d || typeof d !== 'object') {
      this.people = {};
      this.darkRumors = [];
      return;
    }
    this.people = {};
    for (const [id, raw] of Object.entries(d.people || {})) {
      if (!raw || typeof raw !== 'object') continue;
      const st = this.st(id);
      Object.assign(st, raw);
      st.s = clamp(Number(raw.s) || 0);
      st.fear = clamp(Number(raw.fear) || 0);
      st.signs = raw.signs && typeof raw.signs === 'object' ? { ...raw.signs } : {};
      st.seenAt = raw.seenAt && typeof raw.seenAt === 'object' ? { ...raw.seenAt } : {};
      st.told = Array.isArray(raw.told) ? raw.told.filter((x) => typeof x === 'string') : [];
      st.flames = Array.isArray(raw.flames) ? raw.flames.filter((f) => f && typeof f.id === 'string') : [];
    }
    this.darkRumors = Array.isArray(d.darkRumors) ? d.darkRumors.filter((x) => x != null) : [];
  }
}
