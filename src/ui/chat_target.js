// Who the chat is talking to (DESIGN.md §23, "talk to them like I talk with this girl"):
// Lyra by default, or anyone within earshot of the player. This module decides who can
// hear the player (distance, and the same roof), how each person stands with the player
// (the mood dot on their chip), which person a tap in the world lands on, and builds the
// "To:" chip row. The logic is pure and runs under node; only ChatTargetBar and the voice
// helpers touch the DOM or the browser, and only when called.

import { h, setText, toggleClass } from './dom.js';
import { portraitUrl } from './art.js';
import { firstName, moodExpression } from './village_view.js';
import { hears } from '../ai/hearing.js';

export const LYRA = 'lyra';
const TILE = 16;
export const EARSHOT = 7.5 * TILE; // px: near enough to talk
export const EARSHOT_LOSE = 10.5 * TILE; // px: a conversation holds until they are this far
const HOSTILE_NEAR = 9 * TILE; // a tap in a fight is a sword stroke, not a hello

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------- who can hear

// A villager the chat can address: someone with a profile and a voice of their own.
export function isVillager(e) {
  return !!e && !!e.profile && e.id !== LYRA && e.id !== 'player' && !e.removed;
}

export function roofOf(game, e) {
  if (!e || !game?.map?.buildingAt) return null;
  return safe(() => game.map.buildingAt(Math.floor(e.x / TILE), Math.floor(e.y / TILE)), null);
}

function awake(e) {
  return !(e.state === 'sleep' || e.activity === 'sleep');
}

function downed(e) {
  return !!e.downed || e.state === 'downed' || e.mode === 'downed' || !!e.unconscious || e.state === 'unconscious';
}

// Dead: no longer in the world, killed, or dead of age (round 14b: anyone may die).
export function isDeadPerson(game, e) {
  if (!e || e.removed || e.dead) return true;
  return !!safe(() => game?.murder?.isDead?.(e.id), false);
}

// Why someone cannot hear the player right now: null when they can. Only the body keeps
// words from someone (DESIGN §33.2, §33.4; the author: "even if somebody really hates me,
// make me able to talk to them"). Hate, fear, terror, grief, a murder, being hunted, cut
// ties and sleep are never a reason: they hear it, and answer as they feel.
//   'dead'      dead, or no longer in the world
//   'downed'    downed or unconscious
//   'cutscene'  a scene is playing
//   'far'       out of earshot
//   'walls'     a wall between (another roof, or the hearing rule says only a muffled voice
//               gets through, src/ai/hearing.js): a kind of out of earshot, never a feeling
export function whyNotHeard(game, e, radius = EARSHOT) {
  const p = game?.player;
  if (!p) return 'far';
  if (isDeadPerson(game, e)) return 'dead';
  if (downed(e)) return 'downed';
  if (game?.state === 'cutscene') return 'cutscene';
  if (e.absent || e.carriedBy) return 'far';
  if (Math.hypot(e.x - p.x, e.y - p.y) > radius) return 'far';
  if (roofOf(game, e) !== roofOf(game, p)) return 'walls';
  // Words carry by the one rule for ears: a wall or a shut door between them leaves only a
  // voice. (Asked of where they stand, not of how they sleep: a sleeper still gets the words,
  // mumbles, and keeps them.)
  if (game?.map) {
    const how = safe(() => hears(game, { x: e.x, y: e.y }, p.x, p.y, radius + 16), 'clear');
    if (how === 'muffled') return 'walls';
    if (!how) return 'far';
  }
  return null;
}

// What the player is told when someone cannot hear them: a body, never a feeling.
export function notHeardText(game, e, why) {
  const n = firstName(e?.name) || 'They';
  switch (why) {
    case 'dead':
      return `${n} is dead.`;
    case 'downed':
      return `${n} is down and can't hear you now.`;
    case 'cutscene':
      return `${n} can't hear you just now.`;
    case 'walls':
      return `${n} can't hear you through the walls.`;
    default:
      return `${n} is too far away to hear you.`;
  }
}

export function canHear(game, e, radius = EARSHOT) {
  return !whyNotHeard(game, e, radius);
}

// Everyone within earshot, nearest first. `keep`: ids already in the row, who stay until
// they pass the wider EARSHOT_LOSE (so a chip does not flicker at the edge).
export function earshotPeople(game, { keep = null, max = 8 } = {}) {
  const p = game?.player;
  const ents = safe(() => game.entities.all(), []) || [];
  if (!p) return [];
  const out = [];
  for (const e of ents) {
    if (!isVillager(e)) continue;
    const r = keep && keep.includes?.(e.id) ? EARSHOT_LOSE : EARSHOT;
    if (!canHear(game, e, r)) continue;
    out.push([Math.hypot(e.x - p.x, e.y - p.y), e]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, max).map((x) => x[1]);
}

// Is the player in a fight (a hostile creature close by)? Then a click is a sword stroke.
export function inFight(game) {
  const p = game?.player;
  if (!p) return false;
  const ents = safe(() => game.entities.all(), []) || [];
  for (const e of ents) {
    if (!e || e.removed || e === p || e.profile || e.id === LYRA || !Number.isFinite(e.x)) continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) > HOSTILE_NEAR || downed(e)) continue;
    const hostile = safe(() => game.combat?.isHostile?.(e, p), null) ?? ['monster', 'bandit', 'undead'].includes(e.faction);
    if (hostile) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------- the world, tapped

// The person (Lyra or a villager) drawn at a world point, or null. Sprites stand on their
// feet at (x, y), about 16 px wide and 26 px tall; a fingertip gets a little more room.
// lag: seconds a finger trails someone on the move (they walk on while it comes down):
// where they were that long ago counts too, a little behind where they are now. Someone
// keeping away from the player is still a tap away (the author: "If I go to her, she goes
// away"; and "even if somebody really hates me, make me able to talk to them").
export function pickActorAt(game, wx, wy, { pad = 3, lag = 0 } = {}) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  const ents = safe(() => game.entities.all(), []) || [];
  let best = null;
  let bestD = Infinity;
  const hit = (x, y) => {
    const dx = wx - x;
    const dy = wy - y;
    if (Math.abs(dx) > 8 + pad || dy < -26 - pad || dy > 3 + pad) return Infinity;
    return Math.hypot(dx, dy + 11);
  };
  for (const e of ents) {
    if (!e || e.removed) continue;
    if (e.id !== LYRA && !isVillager(e)) continue;
    const z = num(e.z, 0);
    let d = hit(e.x, e.y - z);
    const mi = e.moveIntent;
    if (lag > 0 && mi && (Math.abs(mi.x) > 0.01 || Math.abs(mi.y) > 0.01)) {
      const sp = num(e.speed, 0) * num(e.speedMul, 1);
      for (const k of [0.5, 1]) d = Math.min(d, hit(e.x - mi.x * sp * lag * k, e.y - z - mi.y * sp * lag * k) + 3 * k);
    }
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------- how they stand with you

export const TONES = {
  hostile: 'cold to you',
  wary: 'wary of you',
  neutral: 'unsure of you',
  friendly: 'likes you',
  fond: 'fond of you',
};

// A villager's mood word (theirs or Claude's) as the header says it, or '' when it says nothing new.
const MOOD_WORDS = { warm: 'warm', happy: 'cheerful', amused: 'amused', angry: 'angry', wary: 'guarded', worried: 'worried', sad: 'sad', sleepy: 'sleepy', cold: 'cold', curious: 'curious', proud: 'proud', embarrassed: 'flustered', nervous: 'nervous', fond: 'tender' };
export function moodWord(mood) {
  return MOOD_WORDS[String(mood || '').toLowerCase()] || '';
}

export function toneOf(opinion) {
  const o = num(opinion, 30);
  return o < 15 ? 'hostile' : o < 30 ? 'wary' : o < 50 ? 'neutral' : o < 75 ? 'friendly' : 'fond';
}

// What the chip and the header say about someone: { tone, label, asleep, cold, opinion }.
export function standingOf(game, e) {
  if (!e) return { tone: 'neutral', label: TONES.neutral, asleep: false, cold: false, opinion: 30 };
  const st = safe(() => game?.village?.standing?.(e.id), null);
  const opinion = num(st?.opinion ?? e.opinionOfPlayer, 30);
  let tone = toneOf(opinion);
  const cold = !!(st?.cold || (st?.grievance?.fresh && st?.grievance?.grave));
  if (cold && tone !== 'hostile') tone = 'wary';
  return { tone, label: TONES[tone], asleep: !awake(e), cold, opinion };
}

// The portrait expression a villager's chip and header show.
export function faceOf(standing, mood = null) {
  const m = moodExpression(mood);
  if (m) return m;
  if (standing?.asleep) return 'sleepy';
  return { hostile: 'angry', wary: 'worried', neutral: 'neutral', friendly: 'happy', fond: 'happy' }[standing?.tone] || 'neutral';
}

const HE = new Set(['hobb', 'bram', 'pip', 'rowan', 'tobias', 'garrick', 'alder', 'corran', 'wys']);
export function pronoun(id, kind = 'his') {
  const he = HE.has(id);
  if (kind === 'his') return he ? 'his' : 'her';
  if (kind === 'he') return he ? 'he' : 'she';
  return he ? 'him' : 'her';
}

// The line that closes a conversation when someone passes out of earshot.
//   who: 'they' (the villager walked off) | 'you' (the player walked away)
export function partingLine(e, why, who = 'they') {
  const n = firstName(e?.name) || 'They';
  const his = pronoun(e?.id, 'his');
  if (why === 'downed') return `${n} is down and can't hear you now.`;
  if (why === 'dead' || why === 'gone') return `${n} is gone.`;
  if (why === 'cutscene') return `${n} turns to what is happening.`;
  if (who === 'you') return `You walk on, and leave ${n} to ${his} day.`;
  return `${n} has gone on ${his} way.`;
}

// Quick replies for a villager: the everyday openers, and "I'm <name>." while they do not
// know it (only when the player has a name of their own set).
export function villagerChips(game, id, knows = false) {
  const out = ['Hello! How are you?', "What's the news?", 'What do you think of me?', 'Tell me about yourself.'];
  const name = String(game?.settings?.playerName || '').trim();
  if (!knows && name && !/^travell?er$/i.test(name)) out.splice(1, 0, `I'm ${name}.`);
  out.push('Goodbye!');
  return out;
}

// ---------------------------------------------------------------------------- the "To:" row

// The row of people the chat can address. render(list) takes
//   [{ id, name, portrait, tone, label, asleep, away, unread, selected, gone }]
// and reuses each chip's element, so the row never flickers as people come and go.
export class ChatTargetBar {
  constructor({ onPick } = {}) {
    this.onPick = onPick || (() => {});
    this.chips = new Map();
    this.label = h('span', { class: 'chat-to-label', text: 'To' });
    this.list = h('div', { class: 'chat-to-list', role: 'tablist', 'aria-label': 'Who you are talking to' });
    this.hint = h('span', { class: 'chat-to-hint', text: 'Walk up to someone to talk to them' });
    this.el = h('div', { class: 'chat-to' }, this.label, this.list);
    this.list.append(this.hint);
    this.list.addEventListener('scroll', () => this.measure(), { passive: true });
    // A mouse wheel scrolls the row sideways when it runs on in one line.
    this.list.addEventListener(
      'wheel',
      (e) => {
        const l = this.list;
        if (l.scrollWidth <= l.clientWidth + 2 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        l.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  // Whether more people wait past the edge (the row fades there).
  measure() {
    const l = this.list;
    const over = l.scrollWidth > l.clientWidth + 2;
    toggleClass(l, 'overflows', over);
    toggleClass(l, 'at-end', !over || l.scrollLeft + l.clientWidth >= l.scrollWidth - 4);
  }

  chip(id) {
    let c = this.chips.get(id);
    if (c) return c;
    const img = h('img', { class: 'chat-to-img', alt: '', draggable: 'false' });
    const name = h('span', { class: 'chat-to-name' });
    const dot = h('i', { class: 'chat-to-dot', 'aria-hidden': 'true' });
    const badge = h('b', { class: 'chat-to-unread', hidden: true });
    const el = h('button', { type: 'button', class: `chat-to-chip ${id === LYRA ? 'is-lyra' : 'is-npc'}`, role: 'tab', 'data-id': id }, h('span', { class: 'chat-to-face' }, img), name, dot, badge);
    el.addEventListener('click', () => this.onPick(id));
    c = { el, img, name, dot, badge, last: '' };
    this.chips.set(id, c);
    return c;
  }

  render(list) {
    const want = new Set(list.map((x) => x.id));
    for (const [id, c] of this.chips) {
      if (!want.has(id)) {
        c.el.remove();
        this.chips.delete(id);
      }
    }
    let prev = null;
    for (const p of list) {
      const c = this.chip(p.id);
      const key = [p.name, p.portrait, p.tone, p.asleep, p.away, p.unread, p.selected, p.gone, p.label].join('|');
      if (c.last !== key) {
        c.last = key;
        setText(c.name, p.name);
        if (p.portrait && c.img.src !== p.portrait) c.img.src = p.portrait;
        c.el.className = `chat-to-chip ${p.id === LYRA ? 'is-lyra' : 'is-npc'} tone-${p.tone || 'neutral'}${p.selected ? ' selected' : ''}${p.asleep ? ' asleep' : ''}${p.away ? ' away' : ''}${p.gone ? ' gone' : ''}`;
        c.el.setAttribute('aria-selected', p.selected ? 'true' : 'false');
        c.el.title = `${p.name}${p.label ? ` · ${p.label}` : ''}${p.asleep ? ' · asleep' : ''}${p.away ? ' · out of earshot' : ''}`;
        c.el.setAttribute('aria-label', c.el.title);
        c.badge.hidden = !(p.unread > 0);
        setText(c.badge, p.unread > 9 ? '9+' : String(p.unread || ''));
      }
      // Keep the row in order: Lyra, then nearest first.
      const at = prev ? prev.nextSibling : this.list.firstChild;
      if (at !== c.el) this.list.insertBefore(c.el, at);
      prev = c.el;
    }
    // Alone with Lyra: say how to find someone else.
    this.hint.hidden = list.length > 1;
    if (this.hint.parentNode !== this.list || this.list.lastChild !== this.hint) this.list.append(this.hint);
    toggleClass(this.el, 'has-people', list.length > 1);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.measure());
  }

  // Bring the selected chip into view (the row scrolls sideways on a phone). By hand:
  // scrollIntoView could scroll the page itself on iOS.
  reveal(id) {
    const c = this.chips.get(id);
    const l = this.list;
    if (!c || !l.clientWidth) return;
    const x = c.el.offsetLeft;
    const w = c.el.offsetWidth;
    if (x < l.scrollLeft) l.scrollLeft = Math.max(0, x - 8);
    else if (x + w > l.scrollLeft + l.clientWidth) l.scrollLeft = x + w - l.clientWidth + 8;
  }
}

// Chip data for one villager.
export function chipFor(game, e, { selected = false, away = false, unread = 0 } = {}) {
  const st = standingOf(game, e);
  return {
    id: e.id,
    name: firstName(e.name) || e.id,
    portrait: portraitUrl(game, e.spriteKey || e.id, faceOf(st)),
    tone: st.tone,
    label: st.cold ? 'cold to you' : st.label,
    asleep: st.asleep,
    away,
    unread,
    selected,
  };
}
