// "You can leave me, but not like this" (round 14b T-5, the author). When Lyra breaks off
// (left) or cuts the player out of her life (gone), she does not vanish: she walks up to the
// player, faces them and says why, in two to four lines from what really happened (her
// ledger, her reason). The chat opens to her for an answer (25 s): the player's words reach
// her and are remembered, and may change her last line, never the decision. Then she gives
// them a letter and goes home. It is in the world, not a frozen cutscene: walking more than
// 8 tiles away ends it (the letter is then left on the Wayhouse table), and it never traps
// the player. Afraid of them, mid-fight, downed or dead, there is no walk-up: only the letter
// on the table. A killed Lyra has no scene and no letter.
//
//   new Parting(autonomy)
//   start(state, { reason, cause })     -> bool (false: the letter is left, no scene)
//   update(dt)                          the scene's steps (autonomy.update calls it)
//   active                              true while the scene runs
//   heard(text)                         the player's words during the answer window
//   serialize() / deserialize(d)        a save mid-scene ends it gracefully on load

import { TILE } from '../../core/constants.js';
import { DEEDS } from './autonomy_data.js';
import { dropItem } from '../../entities/pickups.js';

const NEAR = 2 * TILE; // she stops this close and faces them
const WALKED_OFF = 8 * TILE; // the player this far from her: the scene ends
const APPROACH_MAX = 40; // s: never chases the player for longer
const LINE_GAP = 3.4; // s between her lines
const ANSWER_WINDOW = 25; // s the chat is open to her for an answer
const ONLINE_WAIT = 15000; // ms: Claude's farewell, else her own words

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function you(text) {
  const t = String(text || '').trim().replace(/\.$/, '');
  if (!t) return '';
  return `You ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
}

// Her words, offline: why, from her ledger and her reason; then her decision.
export function partingLines(a, state, { P = 'you', reason = '' } = {}) {
  const ledger = Array.isArray(a?.ledger) ? a.ledger : [];
  const since = (a?.now?.() ?? 0) - 3 * (a?.daySeconds?.() ?? 900);
  const worst = ledger.filter((e) => e && e.severity < 0 && e.t >= since).sort((x, y) => x.severity - y.severity)[0] || null;
  const deed = worst ? worst.text || DEEDS[worst.deed]?.text || '' : '';
  const lines = [];
  lines.push(state === 'gone' ? `${P}. I won't just disappear on you. I'm telling you to your face.` : `${P}. Wait. I owe you this much: to say it to your face.`);
  const why = [deed ? you(deed) : '', reason && !/^you\b/i.test(deed) ? String(reason).trim() : ''].filter(Boolean).join(' ');
  if (why) lines.push(why.length > 160 ? `${why.slice(0, 157)}…` : why);
  lines.push(state === 'gone' ? "I'm going home to Mam and Da. Don't come looking for me." : "I'm not walking with you any more. You'll find me at the Kettle, if you need to know where.");
  return lines.slice(0, 3);
}

// Her last line, after the player's answer: changed by what they said, never the decision.
export function lastLine(state, answer) {
  const t = String(answer || '').toLowerCase();
  if (!t) return state === 'gone' ? "That's all. Look after yourself." : "That's all. Take care of yourself.";
  if (/\b(sorry|forgive|apolog|my fault|i was wrong)\b/.test(t)) return "I heard you. It doesn't change this. Not today.";
  if (/\b(please|don'?t go|stay|wait|need you)\b/.test(t)) return "I know. I'm going anyway.";
  if (/\b(fine|good riddance|go then|whatever|leave)\b/.test(t)) return 'Then there is nothing left to say.';
  return "I heard you. Goodbye.";
}

// The letter she leaves (offline): her own words, kept in game.flags.lyra_letter.
export function letterText(a, state, { P = 'you', reason = '', answer = '' } = {}) {
  const lines = partingLines(a, state, { P, reason });
  const why = lines[1] && !/^(?:I'm|I won't)/.test(lines[1]) ? lines[1] : reason;
  const body = [
    `${P},`,
    '',
    state === 'gone' ? "I said it to you, and I'm writing it down so neither of us can pretend I didn't." : "I'm writing because some things are easier on paper, and because I want you to know I didn't leave without a word.",
    why ? `${why}` : '',
    state === 'gone' ? "I'm home with Mam and Da now. Hearthvale is my home and it will stay my home. Don't come looking for me." : "I'm not walking with you any more. Maybe one day that changes. Not today.",
    answer ? `You said: "${String(answer).slice(0, 120)}". I heard you. I'm keeping that too.` : '',
    '',
    '— Lyra',
  ];
  return body.filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i > 0)).join('\n');
}

export class Parting {
  constructor(a) {
    this.a = a;
    this.st = null;
  }

  get active() {
    return !!this.st;
  }

  game() {
    return this.a?.game || null;
  }

  // She cannot stand and talk: afraid of them, in a fight, down, dead, or the player far off.
  canWalkUp(state, cause) {
    const g = this.game();
    const l = this.a?.lyra?.();
    const p = g?.player;
    if (!g || !l || !p || l.downed || l.dead || l.removed) return false;
    if (safe(() => g.murder?.isDead?.('lyra'), false)) return false;
    if (cause === 'fear_left' || cause === 'downed' || cause === 'lethal' || cause === 'violence') {
      const fear = safe(() => this.a.stats().fear, 0);
      if (fear > 45) return false;
    }
    const b = this.a?.behavior?.();
    if (b?.currentTarget && !b.currentTarget.removed && !b.currentTarget.dead) return false;
    if (p.downed) return false;
    return Math.hypot(l.x - p.x, l.y - p.y) <= 25 * TILE;
  }

  start(state, { reason = '', cause = null } = {}) {
    const g = this.game();
    if (!g || (state !== 'left' && state !== 'gone')) return false;
    // A world with the player's screen in it (the real game), or a test that asks for it.
    if (typeof g.ui?.talkTo !== 'function' && g.settings?.partingScene !== true) return false;
    const P = this.a.playerName?.() || 'you';
    if (safe(() => g.murder?.isDead?.('lyra'), false)) return false;
    if (!this.canWalkUp(state, cause)) {
      this.leaveLetter(state, { reason, onTable: true });
      return false;
    }
    this.st = { phase: 'approach', state, reason, cause, t: 0, lines: partingLines(this.a, state, { P, reason }), i: 0, next: 0, answer: '', windowEnd: null, online: null };
    this.askClaude();
    const b = this.a.behavior?.();
    safe(() => b?.setDirective?.({ type: 'follow', target: 'player', distance: 'close' }, { quiet: true }));
    g.bus?.emit?.('lyra_parting', { phase: 'start', state });
    return true;
  }

  // Claude words her farewell, in her own mind, with a short wait; her own words otherwise.
  askClaude() {
    const g = this.game();
    const st = this.st;
    const provider = safe(() => g?.brain?.providers?.current?.(), null);
    if (!provider || !st) return;
    const P = this.a.playerName?.() || 'the player';
    const ledger = (this.a.ledger || []).filter((e) => e && e.severity < 0).slice(-4).map((e) => `- ${e.text || DEEDS[e.deed]?.text || e.deed}`);
    const task = [
      `You are leaving ${P} now: ${st.state === 'gone' ? 'you are cutting them out of your life, and going home to your parents' : 'you are breaking off and will not walk with them any more'}.`,
      `Your reason: ${st.reason || 'what they did'}.`,
      ledger.length ? `What they did that you weigh:\n${ledger.join('\n')}` : '',
      'You walked up to them to say it to their face. Say two or three short spoken lines: your real reasons, and your decision. You never threaten them; you live for yourself.',
      'Return {"lines": ["...", "..."]}.',
    ]
      .filter(Boolean)
      .join('\n');
    let timer = null;
    const late = new Promise((r) => {
      timer = setTimeout(() => r(null), ONLINE_WAIT);
    });
    st.online = 'asking';
    Promise.race([Promise.resolve().then(() => provider.complete({ rules: safe(() => g.brain.promptRules?.(), '') || '', task, schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'], additionalProperties: false }, tier: 'quick', maxTokens: 400 })), late])
      .then((raw) => {
        clearTimeout(timer);
        const list = Array.isArray(raw?.lines) ? raw.lines.map((l) => String(l || '').replace(/\s+/g, ' ').trim()).filter((l) => l && l.length <= 220 && !/[{}<>]/.test(l)) : [];
        if (this.st === st && st.i === 0 && list.length >= 2) st.lines = list.slice(0, 3);
        if (this.st === st) st.online = list.length >= 2 ? 'claude' : 'local';
      })
      .catch(() => {
        clearTimeout(timer);
        if (this.st === st) st.online = 'local';
      });
  }

  // The player's words while the chat is open to her: heard, remembered (the brain already
  // logged them), and her last line answers them.
  heard(text) {
    if (!this.st || this.st.phase === 'approach') return;
    this.st.answer = String(text || '').slice(0, 200);
  }

  update(dt) {
    const st = this.st;
    if (!st) return;
    const g = this.game();
    const l = this.a.lyra?.();
    const p = g?.player;
    if (!g || !l || !p || l.downed || l.dead || l.removed || safe(() => g.murder?.isDead?.('lyra'), false)) {
      this.end('interrupted');
      return;
    }
    st.t += dt;
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    if (st.phase !== 'approach' && d > WALKED_OFF) {
      this.end('walked_off');
      return;
    }
    if (st.phase === 'approach') {
      if (d <= NEAR) {
        st.phase = 'speak';
        st.next = 0;
        safe(() => this.a.behavior?.()?.setDirective?.({ type: 'stay' }, { quiet: true }));
        safe(() => l.faceToward?.(p.x, p.y));
      } else if (st.t > APPROACH_MAX) {
        this.end('walked_off');
        return;
      }
      return;
    }
    safe(() => l.faceToward?.(p.x, p.y));
    if (st.phase === 'speak') {
      st.next -= dt;
      if (st.next > 0) return;
      const line = st.lines[st.i];
      if (!line) {
        st.phase = 'answer';
        st.windowEnd = st.t + ANSWER_WINDOW;
        return;
      }
      safe(() => this.a.say(line, { force: true, kind: 'farewell' }));
      st.i++;
      st.next = LINE_GAP;
      if (st.i === 1) this.openChat();
      return;
    }
    if (st.phase === 'answer') {
      if (st.answer || st.t >= st.windowEnd) {
        const last = lastLine(st.state, st.answer);
        safe(() => this.a.say(last, { force: true, kind: 'farewell' }));
        this.leaveLetter(st.state, { reason: st.reason, answer: st.answer, onTable: false });
        this.end('done');
      }
    }
  }

  // The chat to her, open for an answer (the field is never locked; the window is hers).
  openChat() {
    const g = this.game();
    const ui = g?.ui;
    if (!ui) return;
    safe(() => (typeof ui.talkTo === 'function' ? ui.talkTo('lyra') : ui.chat?.open?.(false)));
    safe(() => ui.chat?.addMessage?.({ from: 'system', text: `${this.a.lyra?.()?.name || 'Lyra'} is leaving you. Say something, if you want; she is listening.`, kind: 'act' }));
  }

  // The letter: handed over at the end of the scene, else left on the Wayhouse table.
  leaveLetter(state, { reason = '', answer = '', onTable = false } = {}) {
    const g = this.game();
    if (!g || safe(() => g.murder?.isDead?.('lyra'), false)) return null;
    g.flags = g.flags || {};
    const P = this.a.playerName?.() || 'you';
    const text = letterText(this.a, state, { P, reason, answer });
    g.flags.lyra_letter = { text, day: this.a.day?.() ?? 1, state };
    const p = g.player;
    if (!onTable && p?.inventory?.add) {
      safe(() => p.inventory.add('lyra_letter', 1));
      safe(() => g.ui?.toast?.('Lyra gives you a letter. (Open your bag to read it.)', 'lyra', { key: 'lyra-letter', title: 'A letter' }));
      return 'hand';
    }
    // On the Wayhouse table, where the player sleeps.
    const loc = safe(() => g.locations?.get?.('player_home') || g.locations?.get?.('wayhouse'), null);
    const at = loc?.center || (p ? { x: p.x, y: p.y } : null);
    if (at) {
      const left = safe(() => dropItem(g, 'lyra_letter', 1, at.x, at.y, { pop: false, lifetime: Infinity, collectDelay: 0 }), null);
      if (!left) safe(() => p?.inventory?.add?.('lyra_letter', 1));
      g.flags.lyra_letter.onTable = !!left;
    }
    safe(() => g.ui?.toast?.('Lyra left you a letter, on the table at the Wayhouse.', 'lyra', { key: 'lyra-letter', title: 'A letter' }));
    return 'table';
  }

  end(why = 'done') {
    const st = this.st;
    this.st = null;
    if (!st) return;
    if (why === 'walked_off' || why === 'interrupted') this.leaveLetter(st.state, { reason: st.reason, answer: st.answer, onTable: true });
    // Her body goes back to what her state means: home, or keeping her distance.
    safe(() => this.a._direct?.(st.state, null));
    this.game()?.bus?.emit?.('lyra_parting', { phase: 'end', state: st.state, why });
  }

  serialize() {
    return this.st ? { state: this.st.state, reason: this.st.reason, answer: this.st.answer } : null;
  }

  // A save mid-scene: on load the scene is over; the letter is left on the table.
  deserialize(d) {
    this.st = null;
    if (d && (d.state === 'left' || d.state === 'gone')) this.leaveLetter(d.state, { reason: d.reason || '', answer: d.answer || '', onTable: true });
  }
}
