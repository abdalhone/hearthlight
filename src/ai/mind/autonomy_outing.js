import { TILE, PLAYER_ID } from '../../core/constants.js';
import { makeBlock } from './autonomy_agenda.js';

// Her proposals, followed through (DESIGN §16.11; the author: "she goes there, and the
// second she reaches it, she comes back following me"). "Come with me to the chapel?
// Sister Aveline knew Maren." is a plan of hers, not an order to the player's feet: once
// they agree it becomes an outing, and she sees it through:
//
//   go     she leads the way there (and waits for them if they fall behind)
//   find   she finds the person it is about, or waits for them a while
//   talk   the talk it was about (the social plugin's talk_to: lines, what she learns,
//          the `conversation` event the Maren arc listens for)
//   after  what she heard settles; then she carries on with her own life (her open
//          agenda decides: a while alone with it, her people, the player's company)
//   done
//
// Nothing in here snaps her back to following: she comes back to the player only if she
// wants to (her plan's next hours with them, or her own choice after the talk), or if
// they ask and she agrees (the consent gate weighs it; an outing in hand weighs against).
//
//   outing = { id, kind: 'talk', at, npc, topic, why, what, withPlayer, phase, since,
//              t, waited, tries, result, promiseId, source, said: {} }

const LAG_TILES = 13; // the player this far behind: she stops and waits for them
const CAUGHT_UP_TILES = 7; // ...until they are this close again
const LOST_SECONDS = 70; // they never came: she goes on alone
const WAIT_HOURS = 1.5; // waiting for the person before she gives up for today
const TALK_STALL = 6; // seconds with no talk running before she tries again
const AFTER_MIN = 3; // seconds before she decides what next, once the talk is over
const AFTER_MAX = 30; // ...or once the arc's own lines have been said, whichever is first
const MAX_TRIES = 3;

const safe = (fn, fallback = null) => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

// Can this person be talked to right now (awake, on their feet, in the world)?
export function available(e) {
  if (!e || e.removed || e.dead || e.absent || e.hidden || e.downed || e.carriedBy) return false;
  if (e.state === 'sleep' || e.activity === 'sleep') return false;
  if (typeof e.isAlive === 'function' && !safe(() => e.isAlive(), true)) return false;
  return true;
}

export class Outings {
  constructor(autonomy) {
    this.a = autonomy;
    this.current = null;
    this.seq = 0;
    this.dir = null; // the directive the outing last gave her body
    this.lagSince = null;
    this.lostT = 0;
  }

  get game() {
    return this.a.game;
  }

  active() {
    const o = this.current;
    return !!o && o.phase !== 'done';
  }

  // Start one. spec: { at, npc, topic, why, what, withPlayer, promiseId, source }
  start(spec = {}) {
    const a = this.a;
    const at = spec.at || null;
    if (!at && !spec.npc) return null;
    const loc = at ? safe(() => this.game?.locations?.get?.(at)) : null;
    if (at && !loc) return null;
    // The same outing twice (her ear and the brain both heard the yes): one outing.
    const cur = this.current;
    if (cur && cur.phase !== 'done' && cur.at === at && cur.npc === (spec.npc || null)) return cur;
    const o = {
      id: `o${++this.seq}`,
      kind: spec.npc ? 'talk' : 'visit',
      at,
      npc: spec.npc || null,
      topic: spec.topic || null,
      why: String(spec.why || '').slice(0, 140),
      what: String(spec.what || '').slice(0, 100),
      withPlayer: spec.withPlayer !== false,
      phase: 'go',
      since: a.now(),
      t: 0,
      waited: 0,
      tries: 0,
      result: null,
      promiseId: spec.promiseId || null,
      source: spec.source || 'self',
      said: {},
    };
    this.current = o;
    this.dir = null;
    this.lagSince = null;
    this.lostT = 0;
    // Her plan says so too (the HUD, the prompt, and the consent gate read the plan).
    const h = a.hour();
    a._insertBlock(makeBlock(h, Math.min(h + 2, 24), o.npc ? 'lead' : 'visit', at, o.why || 'Something I want to do, with you along.', { npc: o.npc, company: 'player', outing: o.id }));
    // The arc's own "will you come with me?" is answered: it goes unsaid.
    if (o.npc === 'aveline') safe(() => this.game?.plugins?.get?.('quest')?.settlePending?.(this.game, 'ask_aveline'));
    this._go(true);
    a.game?.bus?.emit?.('outing', { phase: 'go', outing: { ...o } });
    return o;
  }

  // The player asked her for something else, and she agreed: the outing waits for
  // another day (unfinished business), and her plan forgets it.
  drop(why = 'asked') {
    const o = this.current;
    if (!o || o.phase === 'done') return;
    const before = o.phase;
    this._finish(o, why === 'asked' ? 'dropped' : why);
    if (before !== 'after') this.a.noteUnfinished?.(this._unfinishedItem(o));
  }

  // tick from the autonomy (every half second or so)
  tick(step) {
    const o = this.current;
    if (!o || o.phase === 'done') return;
    const a = this.a;
    const l = a.lyra();
    const b = a.behavior();
    if (!l || !b) return;
    const st = a.companionship;
    // Broken off with the player, or cut them out: whatever she meant to do with them is off.
    if (st === 'left' || st === 'gone') {
      this._finish(o, 'off');
      a.noteUnfinished?.(this._unfinishedItem(o));
      return;
    }
    if (l.downed || l.state === 'sleep') return;
    o.t += step;
    switch (o.phase) {
      case 'go':
        return this._tickGo(o, step);
      case 'find':
        return this._tickFind(o, step);
      case 'talk':
        return this._tickTalk(o, step);
      case 'after':
        return this._tickAfter(o, step);
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------------ go

  _go(first = false) {
    const o = this.current;
    const b = this.a.behavior();
    if (!o || !b?.setDirective) return;
    const r = safe(() => b.setDirective({ type: 'goto', target: o.at || o.npc, then: 'stay' }, { quiet: true }));
    if (r && r.ok === false) {
      // Somewhere she will not or cannot go: she says so, and it waits for another day.
      if (r.message) this.a.say(r.message, { force: true });
      this._finish(o, 'unreachable');
      this.a.noteUnfinished?.(this._unfinishedItem(o));
      return;
    }
    this.dir = b.directive;
    if (first) this._say('outing_go', { force: true });
  }

  _stayHere() {
    const b = this.a.behavior();
    const l = this.a.lyra();
    if (!b?.setDirective || !l) return;
    safe(() => b.setDirective({ type: 'stay', x: l.x, y: l.y }, { quiet: true }));
    this.dir = b.directive;
  }

  _ours() {
    const b = this.a.behavior();
    return !!b && b.directive === this.dir;
  }

  _arrived(o) {
    const a = this.a;
    const l = a.lyra();
    if (o.at) return a.inLocation(o.at, l);
    const e = o.npc ? safe(() => this.game?.entities?.get?.(o.npc)) : null;
    return !!e && dist(l, e) < 3 * TILE;
  }

  _tickGo(o, step) {
    const a = this.a;
    const l = a.lyra();
    const p = a.player();
    if (this._arrived(o)) {
      o.phase = 'find';
      o.t = 0;
      this._stayHere();
      return;
    }
    // Someone else moved her (a fight, running from danger): she picks the way up again.
    const b = a.behavior();
    const dt = b?.directive?.type;
    if (!this._ours() && !['flee', 'keep_away', 'leave', 'wait_outside'].includes(dt) && !b?.currentTarget) this._go();
    if (!o.withPlayer || !p) return;
    // She leads; a guide waits for the one she is guiding.
    const dp = dist(l, p);
    const loc = o.at ? safe(() => this.game?.locations?.get?.(o.at)) : null;
    const goal = loc?.center || null;
    const ahead = goal ? dist(l, goal) < dist(p, goal) : true;
    if (this.lagSince == null) {
      if (dp > LAG_TILES * TILE && ahead) {
        this.lagSince = a.now();
        this._stayHere();
        this._say('outing_wait_player', { force: true });
      }
    } else if (dp < CAUGHT_UP_TILES * TILE) {
      this.lagSince = null;
      this.lostT = 0;
      this._go();
    } else {
      this.lostT += step;
      if (this.lostT > LOST_SECONDS) {
        // They never came: she goes on alone. It is her errand; it was always hers.
        this.lagSince = null;
        o.withPlayer = false;
        this._say('outing_alone', { force: true, chat: false });
        a.remember?.(`I asked ${a.playerName()} to come with me${o.at ? ` to ${this._placeName(o)}` : ''}, and they didn't. I went on my own.`, { importance: 3, tags: ['outing'], about: [PLAYER_ID] });
        this._go();
      }
    }
  }

  // ------------------------------------------------------------------ find

  _tickFind(o, step) {
    const a = this.a;
    if (!o.npc) {
      // A place, not a person: being there together was the point.
      this._toAfter(o, 'there');
      return;
    }
    const e = safe(() => this.game?.entities?.get?.(o.npc));
    if (!e || e.dead || e.removed) {
      this._say('outing_no_npc', { force: true, vars: { npc: a.npcName(o.npc) } });
      this._toAfter(o, 'missed');
      return;
    }
    if (available(e)) {
      this._talk(o, e);
      return;
    }
    o.waited += step;
    if (!o.said.waiting) {
      o.said.waiting = true;
      this._say('outing_wait_npc', { force: true, vars: { npc: a.npcName(o.npc) } });
    }
    if (o.waited > WAIT_HOURS * a.sph()) {
      this._say('outing_give_up', { force: true, vars: { npc: a.npcName(o.npc) } });
      a.noteUnfinished?.(this._unfinishedItem(o));
      this._toAfter(o, 'missed');
    }
  }

  _talk(o, e) {
    const a = this.a;
    const g = this.game;
    o.tries += 1;
    o.phase = 'talk';
    o.t = 0;
    // Claude writes the talk when it is to hand and this was agreed in a chat with it.
    const claude = o.source === 'claude' && safe(() => g?.brain?.llmAvailable?.(), false);
    let r = null;
    if (g?.actions?.has?.('talk_to')) {
      a._selfAct = (a._selfAct || 0) + 1;
      try {
        r = g.actions.run('talk_to', { target: o.npc, value: o.topic || null }, claude ? 'claude' : 'self');
      } catch (err) {
        console.error('[outing] talk_to failed', err);
      } finally {
        a._selfAct -= 1;
      }
    }
    if (!r || r.ok === false) {
      if (o.tries >= MAX_TRIES) {
        a.noteUnfinished?.(this._unfinishedItem(o));
        this._toAfter(o, 'missed');
      } else o.phase = 'find';
      return;
    }
    if (r.message) a.say(r.message, { force: true, target: e });
  }

  // ------------------------------------------------------------------ talk

  talking() {
    const s = safe(() => this.game?.plugins?.get?.('social')?.talkState?.(this.game));
    return !!(s && (s.talk || s.pending));
  }

  _tickTalk(o) {
    if (this.talking()) {
      o.t = 0;
      return;
    }
    if (o.t > TALK_STALL) {
      // The talk never happened (they walked off, someone interrupted): try again.
      if (o.tries >= MAX_TRIES) {
        this.a.noteUnfinished?.(this._unfinishedItem(o));
        this._toAfter(o, 'missed');
      } else {
        o.phase = 'find';
        o.t = 0;
      }
    }
  }

  // The `conversation` event: the talk she came for happened.
  onConversation(p) {
    const o = this.current;
    if (!o || o.phase === 'done' || !o.npc) return;
    const other = p?.a?.id === o.npc ? p.a : p?.b?.id === o.npc ? p.b : null;
    if (!other) return;
    const lyraIn = p.a === this.a.lyra() || p.b === this.a.lyra() || p.a?.id === 'lyra' || p.b?.id === 'lyra';
    if (!lyraIn) return;
    // A chat about something else (the weather, the ruins) is not the talk she came for.
    if (o.topic) {
      const re = new RegExp(`\\b${String(o.topic).replace(/[^a-z ]/gi, '').trim().split(/\s+/)[0] || 'x'}`, 'i');
      const about = re.test(String(p.topic || '')) || (p.lines || []).some((l) => re.test(String(l?.text || '')));
      if (!about) return;
    }
    this._toAfter(o, 'talked');
  }

  // ------------------------------------------------------------------ after

  _toAfter(o, result) {
    o.result = result;
    o.phase = 'after';
    o.t = 0;
    const b = this.a.behavior();
    // The talk handed her back to whatever she was doing; she stays put while it sinks in.
    if (b?.directive?.type === 'follow' && b.directive.target !== 'player') this._stayHere();
    else if (b?.directive?.type === 'goto') this._stayHere();
    this.game?.bus?.emit?.('outing', { phase: 'after', outing: { ...o } });
  }

  _tickAfter(o) {
    if (o.t < AFTER_MIN) return;
    const pending = safe(() => this.game?.plugins?.get?.('quest')?.pendingLines?.(this.game), false);
    if (pending && o.t < AFTER_MAX) return;
    if (this.a.mind?.isSpeaking?.() && o.t < AFTER_MAX) return;
    this._finish(o, o.result || 'done');
  }

  _finish(o, result) {
    const a = this.a;
    o.result = o.result || result;
    o.phase = 'done';
    o.ended = a.now();
    // Her plan drops whatever is left of the outing's hours.
    const h = a.hour();
    const today = a.agenda.today;
    const i = today.findIndex((b) => b.outing === o.id);
    if (i >= 0) {
      const blk = today[i];
      if (blk.from >= h) today.splice(i, 1);
      else blk.to = Math.max(blk.from + 0.05, h);
      a.agenda.revision = (a.agenda.revision || 0) + 1;
      a._blockIdx = -2;
    }
    this.dir = null;
    a.game?.bus?.emit?.('outing', { phase: 'done', outing: { ...o } });
    if (result === 'dropped' || result === 'off' || result === 'unreachable' || result === 'changed') return;
    // The player came along: their word is kept.
    const p = a.player();
    const l = a.lyra();
    const promise = o.promiseId ? a.promises.find((x) => x.id === o.promiseId) : null;
    if (promise && promise.state === 'open') {
      const there = p && l && (dist(p, l) < 12 * TILE || (o.at && a.inLocation(o.at, p)));
      if (there && o.withPlayer) a._resolvePromise(promise, 'kept', { quiet: true });
    }
    a._afterOuting?.(o);
  }

  _unfinishedItem(o) {
    return { kind: 'unfinished', text: o.npc ? `talk to ${this.a.npcName(o.npc)}${o.topic ? ` about ${o.topic}` : ''}` : `go to ${this._placeName(o)}`, at: o.at, npc: o.npc, topic: o.topic, why: o.why, since: this.a.day() };
  }

  _placeName(o) {
    return safe(() => this.game?.locations?.get?.(o.at)?.name, null) || o.at || 'there';
  }

  _say(key, { force = false, minGap = 4, chat = true, vars = {} } = {}) {
    const a = this.a;
    const o = this.current;
    const text = a.line(key, { place: o ? this._placeName(o) : '', npc: o?.npc ? a.npcName(o.npc) : '', P: a.playerName(), ...vars });
    if (text) a.say(text, { force, minGap, chat });
    return text;
  }

  // For the prompt and the HUD: what she is doing about it, in words.
  describe() {
    const o = this.current;
    if (!o || o.phase === 'done') return '';
    const a = this.a;
    const who = o.npc ? a.npcName(o.npc) : '';
    const place = this._placeName(o);
    switch (o.phase) {
      case 'go':
        return this.lagSince != null ? `waiting for ${a.playerName()} to catch up, on the way to ${place}` : `leading ${o.withPlayer ? a.playerName() : 'the way'} to ${place}${who ? ` to talk to ${who}` : ''}`;
      case 'find':
        return who ? `at ${place}, looking for ${who}` : `at ${place}`;
      case 'talk':
        return `talking with ${who}${o.topic ? ` about ${o.topic}` : ''}`;
      case 'after':
        return `letting what ${who || 'she heard'} said sink in`;
      default:
        return '';
    }
  }

  serialize() {
    const o = this.current;
    return { seq: this.seq, current: o && o.phase !== 'done' ? { ...o, said: { ...o.said } } : null };
  }

  deserialize(d) {
    this.seq = Number(d?.seq) || 0;
    const o = d?.current;
    if (o && typeof o === 'object' && o.phase && o.phase !== 'done') {
      // A talk in the middle of a save starts over from finding the person.
      this.current = { ...o, phase: o.phase === 'talk' ? 'find' : o.phase, t: 0, said: o.said || {} };
      this.dir = null;
    } else this.current = null;
  }
}
