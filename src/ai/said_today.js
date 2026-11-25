// One memory of everything a character says (DESIGN §23.1; the author: "Connect it and let
// it have like a shot of what it said in this day, even if it was pop up text").
//
// game.saidToday keeps, per character (Lyra and each villager), every line they said
// today, whatever said it: a chat reply, a bubble over their head, a bark, a shout, a
// thought said aloud, a line of hers from her own will, a conversation with a neighbor
// (heard by the player or not), a piece of gossip, a toast that quotes them. It is fed to
// their Claude prompts and to their local replies, so that what pops over their head and
// what they say in chat agree, and nobody says the same thing twice in a day ("have you
// eaten?").
//
//   note(id, text, { kind, to, via })    one line, said by `id` (deduplicated a moment)
//   today(id, { limit, kinds })           [{ t, text, kind, to, via }] oldest first
//   repeats(id, text)                     already said today, or near enough (a shared
//                                         three-word run, or the same question)
//   fresh(id, list)                       the lines of `list` that are not repeats
//   promptLines(id, { limit, max })       "said today" for a prompt, short
//
// Sources: the `speech` event (every speaker), bubbles.say / bubbles.thought (lines shown
// without the event: overheard conversations, a cry of pain), the village's own
// exchanges (village.finishExchange), toasts that quote someone (quote()).

const CAP = 60; // lines kept per character per day
const DEDUPE = 120; // seconds: the same line arriving by two routes (a talk, then its bubbles) is one line
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'it', 'is', 'i', 'you', 'me', 'my', 'your', 'that', 'this', 'so', 'be', 'for', 'with', 'oh', 'well', 'now', 'just', 'love', 'dear', 'child']);

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function words(s) {
  return norm(s)
    .replace(/\?/g, ' ')
    .split(' ')
    .filter(Boolean);
}

// Three-word runs of a line (ignoring runs made only of small words).
function runs(s) {
  const w = words(s);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) {
    if (STOP.has(w[i]) && STOP.has(w[i + 1]) && STOP.has(w[i + 2])) continue;
    out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  }
  return out;
}

// The questions in a line ("have you eaten", "where's that boy got to"), normalized.
function questions(s) {
  const out = [];
  for (const part of String(s || '').split(/(?<=[.!?…])\s+/)) {
    if (!/\?\s*$/.test(part)) continue;
    const q = words(part)
      .filter((x) => !STOP.has(x) || x === 'you')
      .slice(0, 4)
      .join(' ');
    if (q.length >= 6) out.push(q);
  }
  return out;
}

function idOf(e) {
  if (!e) return null;
  if (typeof e === 'string') return e;
  return e.id || null;
}

export class SaidToday {
  constructor(game) {
    this.game = game;
    this.by = new Map(); // id -> { day, lines: [] }
    this._installed = false;
  }

  day() {
    return Number.isFinite(this.game?.clock?.day) ? this.game.clock.day : 1;
  }

  now() {
    return Number.isFinite(this.game?.clock?.t) ? this.game.clock.t : this.game?.time ?? 0;
  }

  // Listen to every way a line reaches the world. Safe to call twice.
  install() {
    if (this._installed) return this;
    this._installed = true;
    const g = this.game;
    g?.bus?.on?.('speech', (p) => {
      if (!p?.speaker || !p.text) return;
      this.note(idOf(p.speaker), p.text, { kind: p.kind || 'say', to: idOf(p.target), via: 'speech' });
    });
    this.wrapBubbles();
    g?.bus?.on?.('game_start', () => this.wrapBubbles());
    return this;
  }

  // Bubbles shown without a speech event are still said.
  wrapBubbles() {
    const b = this.game?.bubbles;
    if (!b || b._saidWrapped) return;
    b._saidWrapped = true;
    const self = this;
    if (typeof b.say === 'function') {
      const say = b.say;
      b.say = function saidSay(e, text, opts) {
        try {
          if (e && text) self.note(idOf(e), text, { kind: opts?.kind || 'say', via: 'bubble' });
        } catch {
          /* never stop a bubble */
        }
        return say.apply(this, arguments);
      };
    }
    if (typeof b.thought === 'function') {
      const thought = b.thought;
      b.thought = function saidThought(e, text, opts) {
        try {
          if (e && text) self.note(idOf(e), text, { kind: 'thought', via: 'bubble' });
        } catch {
          /* never stop a bubble */
        }
        return thought.apply(this, arguments);
      };
    }
  }

  // A toast that quotes someone ("Elda: “…”") is them saying it too.
  quote(id, text, via = 'toast') {
    return this.note(id, text, { kind: 'say', via });
  }

  note(id, text, { kind = 'say', to = null, via = '' } = {}) {
    const who = idOf(id);
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!who || !t || who === 'player') return null;
    const day = this.day();
    let rec = this.by.get(who);
    if (!rec || rec.day !== day) {
      rec = { day, lines: [] };
      this.by.set(who, rec);
    }
    const now = this.now();
    const last = rec.lines[rec.lines.length - 1];
    // The same words by two routes (the speech event and its bubble): one line.
    for (let i = rec.lines.length - 1; i >= 0 && i >= rec.lines.length - 10; i--) {
      const l = rec.lines[i];
      if (l.text === t && now - l.t < DEDUPE) {
        if (to && !l.to) l.to = to;
        return l;
      }
    }
    const line = { t: Math.round(now * 10) / 10, text: t.slice(0, 240), kind, to: to || null, via };
    rec.lines.push(line);
    if (rec.lines.length > CAP) rec.lines.splice(0, rec.lines.length - CAP);
    if (last && last.kind === 'thought' && kind === 'thought' && last.text === line.text) rec.lines.pop();
    return line;
  }

  today(id, { limit = CAP, kinds = null } = {}) {
    const rec = this.by.get(idOf(id));
    if (!rec || rec.day !== this.day()) return [];
    const list = kinds ? rec.lines.filter((l) => kinds.includes(l.kind)) : rec.lines;
    return list.slice(-limit);
  }

  // Has `id` already said this today, or something near enough to be a repeat?
  repeats(id, text) {
    const list = this.today(id);
    if (!list.length || !text) return false;
    const n = norm(text);
    const r = runs(text);
    const q = questions(text);
    for (const l of list) {
      if (norm(l.text) === n) return true;
      if (q.length) {
        const lq = questions(l.text);
        if (q.some((x) => lq.includes(x))) return true;
      }
      if (r.size) {
        for (const run of runs(l.text)) if (r.has(run)) return true;
      }
    }
    return false;
  }

  // The lines of a pool that would not repeat what they already said today.
  fresh(id, list) {
    if (!Array.isArray(list)) return [];
    return list.filter((l) => typeof l === 'string' && !this.repeats(id, l));
  }

  // A reply that says again what they already said today loses those sentences, as long
  // as something is left (Claude, asked not to, sometimes still does: "Have you eaten?").
  dropRepeats(id, text) {
    const t = String(text || '').trim();
    if (!t || !this.today(id).length) return t;
    const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
    if (parts.length < 2) return t;
    const kept = [];
    let dropped = false;
    for (const p of parts) {
      // A question dropped takes its own short answer with it ("Have you eaten? You haven't.").
      const tiny = p.split(/\s+/).length <= 3 && !/\?\s*$/.test(p);
      if (this.repeats(id, p) || (dropped && tiny)) {
        dropped = true;
        continue;
      }
      dropped = false;
      kept.push(p);
    }
    return kept.length ? kept.join(' ') : t;
  }

  // For a prompt: what they said today, newest last, each line short.
  // The questions they asked today are always in it (those are what gets repeated), and
  // then as many of the latest lines as fit.
  promptLines(id, { limit = 10, max = 700 } = {}) {
    const all = this.today(id);
    const how = (l) => (l.kind === 'thought' ? 'thought aloud' : l.kind === 'shout' ? 'shouted' : l.via === 'talk' ? `to ${l.to || 'a neighbor'}` : l.via === 'bubble' || l.kind === 'bark' ? 'over your head' : 'said');
    const row = (l, n = 140) => `- (${how(l)}) "${l.text.length > n ? `${l.text.slice(0, n - 1)}…` : l.text}"`;
    const pick = new Map();
    let len = 0;
    const seenQ = new Set();
    for (let i = all.length - 1; i >= 0 && seenQ.size < 6; i--) {
      const qs = questions(all[i].text);
      if (!qs.length || qs.every((q) => seenQ.has(q))) continue;
      for (const q of qs) seenQ.add(q);
      const r = row(all[i], 100);
      if (len + r.length > max) break;
      pick.set(all[i], r);
      len += r.length + 1;
    }
    const recent = all.slice(-limit);
    for (let i = recent.length - 1; i >= 0; i--) {
      if (pick.has(recent[i])) continue;
      const r = row(recent[i]);
      if (len + r.length > max) break;
      pick.set(recent[i], r);
      len += r.length + 1;
    }
    return [...pick.entries()].sort((a, b) => a[0].t - b[0].t).map((x) => x[1]);
  }

  serialize() {
    const out = {};
    const day = this.day();
    for (const [id, rec] of this.by) if (rec.day === day && rec.lines.length) out[id] = { day: rec.day, lines: rec.lines.slice(-30) };
    return out;
  }

  deserialize(d) {
    this.by.clear();
    if (!d || typeof d !== 'object') return;
    for (const [id, rec] of Object.entries(d)) {
      if (!rec || !Array.isArray(rec.lines)) continue;
      this.by.set(id, { day: Number(rec.day) || 1, lines: rec.lines.filter((l) => l && typeof l.text === 'string').slice(-CAP) });
    }
  }
}

export function saidToday(game) {
  if (!game) return null;
  if (!game.saidToday) game.saidToday = new SaidToday(game).install();
  return game.saidToday;
}
