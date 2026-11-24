// Hearthvale's social life on screen (DESIGN.md §19.3, §19.6): the "Listen in" prompt
// when two people talk near the player, the exchange played as bubbles in the world,
// and the morning's "While you slept". The village (`game.village`) is another
// module's: everything here feature-detects it and does nothing without it.
// Claude is only ever reached through the village, and only from here on a player's
// action: pressing Listen in, or going to sleep.

import { h, clear, button } from './dom.js';
import { makePanel } from './modal.js';
import { villageOf, conversationSpeakers, listenLabel, exchangeLines, lineBeat, nightLines, namesTogether, nameOfSpeaker } from './village_view.js';

const POLL_SECONDS = 0.25;
const RELISTEN_SECONDS = 20; // the same conversation is not offered again this soon
const LISTEN_TIMEOUT_MS = 30000;
const NIGHT_TIMEOUT_MS = 45000;
const CARD_WINDOW_MS = 15000; // a morning card only pops up this soon after waking

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.warn('[village ui]', err);
    return fallback;
  }
}

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

export class VillageUI {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.pollT = 0;
    this.conv = null; // the conversation on offer
    this.listening = null; // { conv, speakers } while the village writes the exchange
    this.heard = null; // speech heard while listening (does the village play the lines itself?)
    this.queue = []; // lines the UI plays: [{ speaker, target, text, at }]
    this.queueT = 0;
    this.recent = new Map(); // conversation key -> when it was listened to (game seconds)
    this.after = null; // { speakers, until }: the exchange listened to is still being said
    this.night = null; // { day, state: 'none'|'waiting'|'ready'|'empty', lines, sections }
  }

  get lyraName() {
    return this.game.settings?.companionName || this.game.companion?.name || 'Lyra';
  }

  bind() {
    const bus = this.game.bus;
    bus.on('speech', (p) => {
      if (this.heard && p?.text) this.heard.add(norm(p.text));
    });
    bus.on('player_sleep', () => this.onSleep());
    bus.on('player_wake', (p) => this.onWake(p || {}));
  }

  // ---------- listen in ----------

  convKey(conv) {
    if (!conv) return '';
    // By the two people, not the conversation's id: listening in starts a new
    // conversation between them, which must not be offered again at once.
    const ids = conversationSpeakers(conv, this.game).map((e) => e.id).sort();
    if (ids.length) return ids.join('+');
    return conv.id != null ? `id:${conv.id}` : 'conv';
  }

  recentlyHeard(conv) {
    const t = this.recent.get(this.convKey(conv));
    return t !== undefined && (this.game.time || 0) - t < RELISTEN_SECONDS;
  }

  update(dt) {
    this.runQueue(dt);
    this.pollT -= dt;
    if (this.pollT > 0) return;
    this.pollT = POLL_SECONDS;
    const g = this.game;
    let label = '';
    let busy = false;
    this.conv = null;
    if (g.state === 'playing' && !this.ui.stack.length && g.player && !g.player.downed) {
      const hearing = this.listening || (this.after && (g.time || 0) < this.after.until ? this.after : null);
      if (!hearing) this.after = null;
      if (hearing) {
        // Listening until they have said it all (not only while it is being written).
        label = `Listening · ${namesTogether(hearing.speakers.map((e) => nameOfSpeaker(e, g, this.lyraName)))}`;
        busy = true;
      } else if (!this.queue.length) {
        const v = villageOf(g);
        const conv = typeof v?.canListen === 'function' && typeof v.listenIn === 'function' ? safe(() => v.canListen(), null) : null;
        // Only a talk you can see: both of them on screen (a phone held upright shows
        // little to either side).
        if (conv && typeof conv === 'object' && !this.recentlyHeard(conv) && this.onScreen(conversationSpeakers(conv, g))) {
          this.conv = conv;
          label = listenLabel(conv, g, this.lyraName);
        }
      }
    }
    this.ui.hud?.setListen(label, busy);
  }

  // Are all of these people inside the visible play area?
  onScreen(list) {
    const g = this.game;
    const r = g.renderer;
    const root = this.ui.root;
    if (!list?.length || typeof r?.worldToCss !== 'function' || !root) return true;
    const W = root.clientWidth || 0;
    const H = root.clientHeight || 0;
    for (const e of list) {
      let p = null;
      try {
        p = r.worldToCss(e.x, e.y - 8);
      } catch {
        return true;
      }
      if (!p || p.x < 16 || p.x > W - 16 || p.y < 24 || p.y > H - 24) return false;
    }
    return true;
  }

  // L (or a tap on the prompt): ask the village for the next exchange between them.
  listenIn() {
    const g = this.game;
    const v = villageOf(g);
    const conv = this.conv;
    if (!conv || this.listening || g.state !== 'playing' || typeof v?.listenIn !== 'function') return false;
    const speakers = conversationSpeakers(conv, g);
    this.listening = { conv, speakers };
    this.heard = new Set();
    this.conv = null;
    for (const s of speakers) safe(() => g.bubbles?.icon?.(s, '...'));
    g.audio?.play('ui_click', { volume: 0.7 });
    this.ui.hud?.setListen(`Listening · ${namesTogether(speakers.map((e) => nameOfSpeaker(e, g, this.lyraName)))}`, true);
    let call;
    try {
      call = Promise.resolve(v.listenIn(conv));
    } catch (err) {
      call = Promise.reject(err);
    }
    let timer = 0;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), LISTEN_TIMEOUT_MS);
    });
    Promise.race([call, late]).then(
      (r) => {
        clearTimeout(timer);
        this.afterListen(conv, speakers, r);
      },
      (err) => {
        clearTimeout(timer);
        console.warn('[village ui] listening in failed', err);
        this.afterListen(conv, speakers, null);
      },
    );
    return true;
  }

  afterListen(conv, speakers, result) {
    const g = this.game;
    for (const s of speakers) safe(() => g.bubbles?.clearIcon?.(s, '...'));
    this.recent.set(this.convKey(conv), g.time || 0);
    if (this.recent.size > 40) this.recent.delete(this.recent.keys().next().value);
    const lines = exchangeLines(result, conv, g, this.lyraName);
    const names = namesTogether(speakers.map((e) => nameOfSpeaker(e, g, this.lyraName)));
    // A beat later: a village that plays the exchange itself has spoken its first line.
    setTimeout(() => {
      const heard = this.heard;
      this.heard = null;
      this.listening = null;
      this.pollT = 0;
      if (!lines.length) {
        this.ui.toast(`${names || 'They'} lower their voices. You can't make out the words.`, 'info');
        return;
      }
      const villagePlays = !!heard && lines.some((l) => heard.has(norm(l.text)));
      if (!villagePlays) this.play(lines, speakers);
      // The prompt says "Listening" while the lines are said, and the same two are not
      // offered again until a while after.
      const speed = g.settings?.textSpeed ?? 1;
      const said = lines.reduce((t, l) => t + lineBeat(l.text, speed), 0);
      this.after = { speakers, until: (g.time || 0) + said };
      this.recent.set(this.convKey(conv), (g.time || 0) + said);
      this.ui.chat?.addOverheard?.(`You listened in on ${names || 'a conversation'}`, lines.map((l) => ({ name: l.name, text: l.text })));
    }, 160);
  }

  // The exchange as speech bubbles, one speaker at a time. Bubbles only: the village
  // already knows what was said, and a 'speech' event would make listeners reply.
  play(lines, speakers) {
    const speed = this.game.settings?.textSpeed ?? 1;
    let at = this.queue.length ? this.queue[this.queue.length - 1].at + 1 : 0;
    if (!this.queue.length) this.queueT = 0;
    for (const l of lines) {
      if (!l.speaker) continue;
      const target = speakers.find((s) => s !== l.speaker) || null;
      this.queue.push({ speaker: l.speaker, target, text: l.text, at });
      at += lineBeat(l.text, speed);
    }
  }

  runQueue(dt) {
    if (!this.queue.length) return;
    const g = this.game;
    if (g.state !== 'playing' || g.paused) return;
    this.queueT += dt;
    while (this.queue.length && this.queue[0].at <= this.queueT) {
      const q = this.queue.shift();
      const s = q.speaker;
      if (!s || s.removed) continue;
      if (q.target && !q.target.removed) safe(() => s.faceToward?.(q.target.x, q.target.y));
      safe(() => g.bubbles?.say?.(s, q.text, { kind: 'say' }));
    }
  }

  // Keyboard: L listens in. Returns true when it did.
  handleKey(e) {
    if (e.code !== 'KeyL' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
    const g = this.game;
    if (g.state !== 'playing' || this.ui.stack.length || this.ui.chat?.typing) return false;
    return this.listenIn();
  }

  // ---------- while you slept ----------

  // Sleeping is a player action, so the village may ask Claude for the night's news now;
  // the morning shows it whenever it arrives. Nothing here ever holds up the sleep.
  onSleep() {
    const g = this.game;
    const clock = g.clock;
    const day = clock ? Math.max(1, (Number(clock.hour) < 7 ? clock.day - 1 : clock.day) || 1) : 1;
    this.request(day);
  }

  request(day) {
    const v = villageOf(this.game);
    const n = { day, state: 'none', lines: [], sections: new Set(), woke: 0, wantCard: false, cardShown: false };
    this.night = n;
    if (typeof v?.nightSummary !== 'function') return n;
    n.state = 'waiting';
    let call;
    try {
      call = Promise.resolve(v.nightSummary(day));
    } catch (err) {
      call = Promise.reject(err);
    }
    let timer = 0;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), NIGHT_TIMEOUT_MS);
    });
    Promise.race([call, late]).then(
      (r) => {
        clearTimeout(timer);
        this.nightReady(n, nightLines(r));
      },
      (err) => {
        clearTimeout(timer);
        console.warn('[village ui] night summary failed', err);
        this.nightReady(n, []);
      },
    );
    return n;
  }

  nightReady(n, lines) {
    if (n.state !== 'waiting') return;
    n.lines = lines;
    n.state = lines.length ? 'ready' : 'empty';
    for (const el of n.sections) this.fill(el, n);
    if (n.wantCard && n.state === 'ready') this.showCard(n);
  }

  onWake(p) {
    let n = this.night;
    const day = Math.max(1, (Number(p.day) || this.game.clock?.day || 2) - 1);
    if (!n || n.day !== day) n = this.request(day);
    n.woke = Date.now();
    // Her diary page usually opens now and carries the news; without one, the morning
    // gets a small card of its own.
    setTimeout(() => {
      if (this.night !== n || n.cardShown) return;
      if (this.ui.stack.some((x) => x.id === 'diary' || x.id === 'morning')) return;
      if (n.state === 'ready') this.showCard(n);
      else if (n.state === 'waiting') n.wantCard = true;
    }, 1700);
  }

  // The "While you slept" block for the diary page (or the morning card). Fills in when
  // the village's lines arrive; vanishes if there are none.
  section() {
    const n = this.night;
    if (!n || n.state === 'none' || n.state === 'empty') return null;
    const el = h('section', { class: 'slept', 'aria-live': 'polite' });
    n.sections.add(el);
    this.fill(el, n);
    return el;
  }

  fill(el, n) {
    clear(el);
    if (n.state === 'waiting') {
      el.hidden = false;
      el.append(h('h3', { text: 'While you slept' }), h('div', { class: 'slept-wait' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Hearthvale is waking up…' })));
      return;
    }
    if (n.state !== 'ready' || !n.lines.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const ul = h('ul');
    for (const l of n.lines) ul.append(h('li', { text: l }));
    el.append(h('h3', { text: 'While you slept' }), ul);
  }

  // A diary page closed before the news came in: show it on its own when it does.
  diaryClosed() {
    const n = this.night;
    if (n && n.state === 'waiting' && !n.cardShown) n.wantCard = true;
  }

  showCard(n) {
    if (n.cardShown || !n.lines.length) return;
    const ui = this.ui;
    const g = this.game;
    n.cardShown = true;
    // Long after waking, or with something else open, the news goes to the chat log
    // instead of a popup in the middle of play.
    if (Date.now() - n.woke > CARD_WINDOW_MS || ui.stack.length || g.state !== 'playing') {
      ui.chat?.addOverheard?.('While you slept', n.lines.map((text) => ({ name: '·', text })));
      ui.toast(n.lines[0], 'info', { title: 'While you slept' });
      return;
    }
    const panel = makePanel({ id: 'morning', title: 'A new morning', subtitle: g.clock?.fullString?.() || '', iconName: 'sun', cls: 'panel-small panel-morning' });
    const sec = this.section();
    if (sec) panel.body.append(sec);
    panel.foot.append(button('Into the day', { cls: 'btn-ember', onClick: () => ui.closeModal(panel) }));
    ui.openModal(panel);
  }
}
