import { PLAYER_ID, DAY_SECONDS } from '../../core/constants.js';
import { defaultSoul, normalizeSoul, seedMemories, SEED_KNOWLEDGE, SEED_GOALS, MAREN_REL, PLAYER_REL_START, playerStartOpinion } from './soul.js';
import { Emotions, emotionName, EMOTIONS } from './emotions.js';
import { Needs, FOOD_PREFERENCE } from './needs.js';
import { Memory } from './memory.js';
import { Relationships, bondOf } from './relationships.js';
import { addGoal as addGoalTo, completeGoal as completeGoalIn, sanitizeGoals, topGoal, activeGoals } from './goals.js';
import { Perception, jobLabel } from './perception.js';
import { ThoughtGenerator } from './thoughts.js';
import { STAGES } from './maren.js';
import { clamp, normName, firstName, firstSentence, playerRef, cap, partOfDay, pick, shorten, placePhrase, lowerFirst } from './text.js';

// Lyra's mind (DESIGN §9): soul, feelings, needs, memories, relationships, goals,
// thoughts, diary, recent conversation and knowledge. Perception subscribes to the bus
// here, so she notices the world whether or not the plugins are installed.

const LIMITS = { thoughts: 80, thoughtsSaved: 40, conversation: 40, diary: 20, diaryText: 1800, knowledge: 100, knowledgeText: 220, saveBytes: 145000 };

const EAT_LINES = {
  honey_cake: ["Mm. Elda's honey cake. Ten out of ten. I'd fight a bear for these.", 'Honey cake. My one weakness. Well. One of several.'],
  bread: ['Bread. Simple, honest, gone.', 'A bit of bread. That will hold me.'],
  cooked_fish: ['Grilled fish, still smoky. Now that is a meal.'],
  stew: ['Stew. I can feel my toes again.'],
  berries: ['A handful of berries. It will hold me.'],
  turnip: ["A raw turnip. Tobias would be proud. I'm less proud."],
};

export class Mind {
  constructor(game, owner) {
    this.game = game;
    this.owner = owner;
    this.soul = defaultSoul();
    this.affect = new Emotions(this.soul.personality);
    this.emotions = this.affect.values;
    this.needsEngine = new Needs();
    this.needs = this.needsEngine.values;
    this.memory = new Memory({ now: () => this.now() });
    this.relationships = new Relationships(game, owner, this);
    this.goals = [];
    this.thoughts = [];
    this.diary = [];
    this.conversation = [];
    this.knowledge = [];
    this.secretsRevealed = [];
    this.perception = new Perception(game, this);
    this.thinker = new ThoughtGenerator(this);

    this._acc = 0;
    this._moodAcc = 0;
    this._secretT = 12;
    this._speech = [];
    this._speechT = 0;
    this._convLen = 0;
    this._emoT = {};
    this._ateFlag = false;
    this._sleepDay = null;
    this._consolidatedFor = null;
    this._act = { moving: false, working: false, combat: false, sitting: false, sleeping: false, nearPlayer: false, danger: 0, hpFrac: 1, threats: 0, night: false, indoor: false, exploring: false };

    this._seed();
    this._off = game?.bus?.on?.('*', (type, payload) => this.perceive(type, payload)) || null;
  }

  get name() {
    return this.soul.name || 'Lyra';
  }

  now() {
    return this.game?.clock?.t ?? 0;
  }

  // ---------------------------------------------------------------- seed

  _seed() {
    const g = this.game;
    const ref = playerRef(g);
    const t0 = this.now();
    const pl = this.relationships.ensure(PLAYER_ID, { name: g?.settings?.playerName || g?.player?.name || 'Traveler', kind: 'human', role: 'traveler', faction: 'player' });
    Object.assign(pl, PLAYER_REL_START);
    pl.firstMet = t0 - 2 * DAY_SECONDS;
    pl.lastSeen = t0;
    pl.interactions = 2;
    pl.history = ["Two days ago: stood beside me against the wolves on the King's Road", 'Yesterday: gave me the spare bed in the cottage'];
    pl.notes = [{ text: "Stood beside me against a wolf pack on the King's Road without knowing my name.", source: 'self', t: t0 - 2 * DAY_SECONDS }];
    this.relationships.setOpinion(PLAYER_ID, playerStartOpinion(ref), 'impression');

    const maren = this.relationships.ensure(MAREN_REL.id, { name: MAREN_REL.name, kind: 'human', role: 'mentor', absent: true });
    for (const k of ['affinity', 'trust', 'respect', 'familiarity', 'fear']) maren[k] = MAREN_REL[k];
    maren.tags = [...MAREN_REL.tags];
    maren.notes = MAREN_REL.notes.map((n) => ({ ...n, t: t0 - 90 * DAY_SECONDS }));
    maren.history = [...MAREN_REL.history];
    maren.firstMet = t0 - 9 * 365 * DAY_SECONDS;
    maren.absent = true;
    this.relationships.setOpinion('maren', MAREN_REL.opinion, 'locked');

    for (const s of seedMemories(ref)) {
      const t = t0 - s.daysAgo * DAY_SECONDS + (s.hour - (g?.clock?.hour ?? 8)) * (DAY_SECONDS / 24);
      this.memory.add({ ...s, t, day: 0, pinned: true }, { dedupe: false });
    }
    for (const k of SEED_KNOWLEDGE) this.knowledge.push({ subject: k.subject, text: k.text, t: t0, source: 'soul' });
    for (const goal of SEED_GOALS) addGoalTo(this.goals, goal.text, goal.priority, goal.source, t0, goal.id);
  }

  // ---------------------------------------------------------------- loop

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this._acc += dt;
    if (this._acc >= 0.2) {
      const step = Math.min(this._acc, 1);
      this._acc = 0;
      this.affect.decay(step);
      this.needsEngine.update(step, this.activity());
      this._moodAcc += step;
      if (this._moodAcc >= 1) {
        this.affect.trackMood(this._moodAcc, this.affect.valence(this.needs));
        this._moodAcc = 0;
      }
    }
    try {
      this.perception.update(dt);
    } catch (err) {
      console.error('[mind] perception update failed', err);
    }
    this._updateSpeech(dt);
    try {
      this.thinker.update(dt);
    } catch (err) {
      console.error('[mind] thought failed', err);
    }
    this._secretT -= dt;
    if (this._secretT <= 0) {
      this._secretT = 8;
      this._checkSecrets();
    }
    if (this.conversation.length !== this._convLen) this._dedupeConversation();
  }

  // What she is doing right now, for needs. Reuses one object (called 5x a second).
  activity() {
    const a = this._act;
    const o = this.owner;
    const g = this.game;
    const b = o?.behavior;
    const st = o?.state;
    const loc = this.perception.placeObj();
    const target = b?.currentTarget;
    a.combat = !!(target && (typeof target.isAlive !== 'function' || target.isAlive())) || !!this.perception.encounter;
    a.working = b?.directive?.type === 'job' || st === 'work';
    a.moving = (o?.moved || 0) > 0.05;
    a.sitting = st === 'sit';
    a.sleeping = st === 'sleep';
    const p = g?.player;
    a.nearPlayer = !!p && !!o && Math.abs(p.x - o.x) < 90 && Math.abs(p.y - o.y) < 90;
    a.danger = loc?.danger || 0;
    a.hpFrac = o?.maxHp ? clamp((o.hp ?? o.maxHp) / o.maxHp, 0, 1) : 1;
    a.threats = this.perception.threats;
    a.night = !!g?.clock?.isNight;
    a.indoor = !!loc?.indoor;
    a.exploring = this.perception.firstVisit && this.perception.rt() - this.perception.placeSince < 60;
    return a;
  }

  // Bus events -> appraisal. Accepts (type, payload) or ({ type, payload }).
  perceive(type, payload) {
    if (type && typeof type === 'object') {
      payload = type.payload;
      type = type.type;
    }
    if (type === 'thought' || type === 'emotion' || type === 'memory_added' || type === 'relationship_changed') return;
    try {
      this.perception.handle(type, payload);
    } catch (err) {
      console.error(`[mind] perceive ${type} failed`, err);
    }
  }

  // ---------------------------------------------------------------- feelings

  feel(name, amount, cause = '') {
    const n = emotionName(name);
    if (!n || !Number.isFinite(amount)) return 0;
    const d = this.affect.feel(n, amount);
    if (Math.abs(amount) >= 0.25) this._emitEmotion(n === 'calm' ? 'joy' : n, cause);
    return d;
  }

  // Apply a named appraisal (see emotions.js) and announce big spikes.
  appraise(kind, intensity = 1, cause = '') {
    const deltas = this.affect.appraise(kind, intensity);
    for (const d of deltas) if (d.amount >= 0.25) this._emitEmotion(d.name, cause || kind);
    return deltas;
  }

  _emitEmotion(name, cause) {
    const t = this.perception.rt();
    if (this._emoT[name] != null && t - this._emoT[name] < 2) return;
    this._emoT[name] = t;
    this.game?.bus?.emit?.('emotion', { owner: this.owner, name, intensity: Math.round(this.emotions[name] * 100) / 100, cause: String(cause || '') });
  }

  mood() {
    return this.affect.mood(this.needs);
  }

  // ---------------------------------------------------------------- thoughts and speech

  addThought(text, source = 'self', { show = false, minGap = 30 } = {}) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!clean) return null;
    const th = { text: clean, t: this.now(), source: String(source || 'self') };
    this.thoughts.push(th);
    if (this.thoughts.length > LIMITS.thoughts) this.thoughts.splice(0, this.thoughts.length - LIMITS.thoughts);
    this.game?.bus?.emit?.('thought', { owner: this.owner, text: clean });
    if (show) this._showThought(clean, minGap);
    return th;
  }

  // Thought bubbles: only with the setting on, never over speech, at most every ~30 s.
  _showThought(text, minGap = 30) {
    const g = this.game;
    if (!g?.settings?.showThoughts || g.state !== 'playing') return false;
    const o = this.owner;
    if (!o || o.downed || o.state === 'sleep') return false;
    const t = this.perception.rt();
    if (t - this.thinker.lastShown < minGap) return false;
    if (t - this.perception.lastSpoke < 5 || this._speech.length) return false;
    const b = g.bubbles;
    try {
      if (typeof b?.isBusy === 'function' && b.isBusy(o)) return false;
      if (typeof b?.has === 'function' && b.has(o)) return false;
      if (!b?.thought) return false;
      b.thought(o, text);
    } catch (err) {
      return false;
    }
    this.thinker.lastShown = t;
    return true;
  }

  // Say something aloud: bubble + `speech` event (+ the chat log for things the player should keep).
  say(text, { target = undefined, kind = 'say', chat = false, duration } = {}) {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    const g = this.game;
    const o = this.owner;
    const to = target === undefined ? g?.player || null : target;
    try {
      g?.bubbles?.say?.(o, clean, { kind, duration: duration ?? lineDuration(clean) });
    } catch (err) {
      console.error('[mind] bubble failed', err);
    }
    this.perception.lastSpoke = this.perception.rt();
    g?.bus?.emit?.('speech', { speaker: o, text: clean, target: to, kind });
    if (chat) {
      try {
        g?.ui?.chat?.addMessage?.({ from: 'lyra', text: clean, name: this.name });
      } catch {
        /* the chat is optional */
      }
    }
  }

  // Several lines in a row, each after the previous has had time to be read.
  sayLines(lines, { gap = 0.5, chat = false, target, onDone } = {}) {
    const P = playerName(this.game);
    for (const l of lines || []) {
      if (typeof l === 'function') this._speech.push({ fn: l, gap: 0 });
      else if (l) this._speech.push({ text: String(l).replace(/\{P\}/g, P), gap, chat, target });
    }
    if (onDone) this._speech.push({ fn: onDone, gap: 0 });
  }

  isSpeaking() {
    return this._speech.length > 0 || this._speechT > 0;
  }

  _updateSpeech(dt) {
    if (this._speechT > 0) this._speechT -= dt;
    while (this._speech.length && this._speechT <= 0) {
      const item = this._speech.shift();
      if (item.fn) {
        try {
          item.fn();
        } catch (err) {
          console.error('[mind] speech callback failed', err);
        }
        continue;
      }
      this.say(item.text, { chat: item.chat, target: item.target });
      this._speechT = lineDuration(item.text) + item.gap;
    }
  }

  addConversation(role, text) {
    const clean = String(text ?? '').trim().slice(0, 400);
    if (!clean) return;
    this.conversation.push({ role: role === 'player' ? 'player' : 'lyra', text: clean, t: this.now() });
    this._dedupeConversation();
  }

  // Others may push to `conversation` directly; drop back-to-back duplicates either way.
  _dedupeConversation() {
    const c = this.conversation;
    for (let i = c.length - 1; i > 0 && i >= c.length - 6; i--) {
      const a = c[i];
      const b = c[i - 1];
      if (a && b && a.role === b.role && a.text === b.text && Math.abs((a.t ?? 0) - (b.t ?? 0)) < 10) c.splice(i, 1);
    }
    if (c.length > LIMITS.conversation) c.splice(0, c.length - LIMITS.conversation);
    this._convLen = c.length;
  }

  // ---------------------------------------------------------------- memory and knowledge

  remember(text, opts = {}) {
    const about = (opts.about || []).map((a) => (a && typeof a === 'object' ? a.id : a)).filter(Boolean);
    const dom = this.affect.dominant();
    const m = this.memory.add({
      text,
      importance: opts.importance ?? 4,
      about,
      tags: opts.tags || [],
      type: opts.type || 'event',
      location: opts.location !== undefined ? opts.location : this.perception.place,
      emotion: opts.emotion !== undefined ? opts.emotion : dom.excess > 0.15 ? dom.name : null,
      gist: opts.gist,
      when: opts.when,
      t: opts.t,
      day: opts.day,
      pinned: opts.pinned,
    });
    if (m && !this.memory.lastAddMerged) this.game?.bus?.emit?.('memory_added', { owner: this.owner, memory: m });
    return m;
  }

  recall(query = '', opts = {}) {
    const { people, places } = this.resolveQuery(query);
    if (opts.about) people.add(opts.about);
    return this.memory.recall(query, { ...opts, people, places });
  }

  // Which people and places a piece of text refers to (names through the
  // relationships store, places through game.locations).
  resolveQuery(query) {
    const people = new Set();
    const places = new Set();
    const n = ` ${normName(query)} `;
    if (n.trim()) {
      for (const r of this.relationships.map.values()) {
        if (r.kind === 'group') continue;
        const names = [normName(r.name), normName(firstName(r.name)), r.id];
        if (names.some((x) => x && x.length >= 3 && n.includes(` ${x} `))) people.add(r.id);
      }
      if (/ (me|us|we|our|my) /.test(n)) people.add(PLAYER_ID);
      for (const p of this._placeIndex()) if (p.words.some((w) => n.includes(` ${w} `))) places.add(p.id);
    }
    return { people, places };
  }

  _placeIndex() {
    const list = this.game?.locations?.all?.() || [];
    if (this._places && this._placesFor === list.length) return this._places;
    const generic = new Set(['the', 'of', 'old', 'your', 'house', 'village']);
    this._places = list.map((l) => {
      const words = new Set();
      for (const s of [l.name, String(l.id).replace(/_/g, ' '), ...(l.aliases || [])]) {
        const nn = normName(s).replace(/^the /, '');
        if (!nn) continue;
        words.add(nn);
        for (const w of nn.split(' ')) if (w.length >= 4 && !generic.has(w)) words.add(w);
      }
      return { id: l.id, words: [...words] };
    });
    this._placesFor = list.length;
    return this._places;
  }

  learn(subject, text, source = 'observed') {
    const subj = String(subject ?? '').trim().slice(0, 60);
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.knowledgeText);
    if (!subj || !clean) return null;
    const key = normName(clean);
    const existing = this.knowledge.find((k) => normName(k.subject) === normName(subj) && normName(k.text) === key);
    if (existing) {
      existing.t = this.now();
      return existing;
    }
    const k = { subject: subj, text: clean, t: this.now(), source: String(source || 'observed') };
    this.knowledge.push(k);
    if (this.knowledge.length > LIMITS.knowledge) {
      const i = this.knowledge.findIndex((x) => x.source !== 'soul');
      this.knowledge.splice(i >= 0 ? i : 0, 1);
    }
    return k;
  }

  knowledgeAbout(subject) {
    const n = normName(subject);
    if (!n) return [];
    return this.knowledge.filter((k) => {
      const s = normName(k.subject);
      return s.includes(n) || n.includes(s);
    });
  }

  // ---------------------------------------------------------------- goals

  addGoal(text, priority = 0.5, source = 'self', id = null) {
    const before = this.goals.length;
    const g = addGoalTo(this.goals, text, priority, source, this.now(), id);
    if (g && this.goals.length > before && source === 'player') {
      this.remember(`${cap(playerRef(this.game))} asked me to take on a goal: ${lowerFirst(g.text)}.`, { importance: 4, about: [PLAYER_ID], tags: ['goal'], type: 'fact' });
    }
    return g;
  }

  completeGoal(idOrText) {
    const g = completeGoalIn(this.goals, idOrText, this.now());
    if (!g) return null;
    this.appraise('achievement', g.source === 'soul' || g.source === 'quest' ? 1.6 : 1.1, `done: ${g.text}`);
    this.remember(`Done: ${lowerFirst(g.text.replace(/[.!]$/, ''))}.`, { importance: g.source === 'soul' || g.source === 'quest' ? 6 : 4, tags: ['goal', 'done'], emotion: 'pride' });
    return g;
  }

  // ---------------------------------------------------------------- needs

  // Eat from her own satchel when hungry (preferring honey cake, bread, grilled fish).
  tryEat({ force = false } = {}) {
    if (!force && this.needs.hunger >= 0.32) return null;
    if (this.activity().combat) return null;
    const inv = this.owner?.inventory;
    if (!inv) return null;
    for (const id of FOOD_PREFERENCE) {
      if (!inv.has(id)) continue;
      this._ateFlag = false;
      let ok = false;
      try {
        ok = !!this.game?.combat?.useItem?.(this.owner, id);
      } catch (err) {
        console.error('[mind] eating failed', err);
        ok = false;
      }
      if (!ok) continue;
      // If combat did not announce it with item_used, count the meal here.
      if (!this._ateFlag) this.needsEngine.eat(id);
      this._ateFlag = false;
      if (this.perception.throttle('eat_line', 45)) this.say(pick(EAT_LINES[id] || EAT_LINES.bread, this.game?.rng));
      return id;
    }
    return null;
  }

  hasFood() {
    const inv = this.owner?.inventory;
    return !!inv && FOOD_PREFERENCE.some((id) => inv.has(id));
  }

  // ---------------------------------------------------------------- sleep and the diary

  beginSleep() {
    const c = this.game?.clock;
    const day = c?.day ?? 1;
    this._sleepDay = (c?.hour ?? 22) < 5 ? Math.max(1, day - 1) : day;
  }

  wake(p = {}) {
    this.needsEngine.sleep();
    this.appraise('rest', 1, 'a night of sleep');
    this.affect.moodBase = clamp(this.affect.moodBase + 0.05, -0.6, 0.7);
    const day = this._sleepDay ?? Math.max(1, (p.day ?? this.game?.clock?.day ?? 2) - 1);
    if (this._sleepDay == null) this._sleepDay = day;
    const diary = typeof p.reflection?.diary === 'string' ? p.reflection.diary : null;
    if (diary) this.addDiary(diary, day);
    else if (!this.diary.some((d) => d.day === day)) this.addDiary(this.composeDiary(day), day);
    this.consolidate();
    this._sleepDay = null;
    this.thinker.nudge(8);
  }

  addDiary(text, day = this.game?.clock?.day ?? 1) {
    const clean = String(text ?? '').trim().slice(0, LIMITS.diaryText);
    if (!clean) return null;
    if (this.diary.some((d) => d.text === clean)) return null;
    const entry = { day, text: clean, t: this.now() };
    this.diary.push(entry);
    if (this.diary.length > LIMITS.diary) this.diary.splice(0, this.diary.length - LIMITS.diary);
    return entry;
  }

  // Her own diary entry when no brain wrote one: the day's most important memories,
  // how she feels, the player, and Maren.
  composeDiary(day) {
    const mems = this.memory.ofDay(day).filter((m) => m.type !== 'reflection').slice(0, 4);
    const mood = this.mood();
    const P = playerRef(this.game);
    const bond = this.relationships.bond(PLAYER_ID);
    const parts = [];
    parts.push(mood.valence > 0.25 ? 'A good day, mostly.' : mood.valence < -0.15 ? 'A heavy day.' : 'A long day, and a strange one.');
    if (mems.length) {
      for (const m of mems) parts.push(firstSentence(m.text, 160));
    } else {
      parts.push(`Quiet. We stayed ${placePhrase(this.place())}, and nothing tried to eat us, which counts as a triumph.`);
    }
    const lvl = bond.level;
    parts.push(
      lvl >= 4
        ? `${cap(P)} was beside me the whole way. I don't know what I did before.`
        : lvl >= 2
          ? `I'm glad of ${P}. I don't say it enough.`
          : `${cap(P)} is still a riddle. A kind one, so far.`,
    );
    const stage = this.questStage();
    parts.push(stage.index >= 6 ? 'Maren went north. So will we.' : stage.index >= 3 ? 'The ruins are waiting. So is she, I hope.' : 'Still no sign of Maren. Tomorrow.');
    parts.push(pick(['Calm water, little lamp. Sleep.', 'The stars are out. I named six before I gave up.', 'Bed. Now. Before I start rereading her letter again.'], this.game?.rng));
    return parts.join(' ');
  }

  consolidate() {
    const key = this._sleepDay ?? this.game?.clock?.day ?? 0;
    if (this._consolidatedFor === key) return { removed: 0, merged: 0 };
    this._consolidatedFor = key;
    const r = this.memory.consolidate();
    if (this.thoughts.length > LIMITS.thoughtsSaved) this.thoughts.splice(0, this.thoughts.length - LIMITS.thoughtsSaved);
    return r;
  }

  // ---------------------------------------------------------------- secrets

  _checkSecrets() {
    const g = this.game;
    const o = this.owner;
    const p = g?.player;
    if (!o || !p || g.state !== 'playing' || o.downed || this.isSpeaking()) return;
    const secrets = this.soul.secrets || [];
    const level = this.relationships.bond(PLAYER_ID).level;
    const i = secrets.findIndex((s, idx) => s && !this.secretsRevealed.includes(idx) && level >= (s.revealAtBond ?? 9));
    if (i < 0) return;
    const calm = !this.activity().combat && this.perception.threats === 0 && Math.hypot(p.x - o.x, p.y - o.y) < 60;
    const quietPlace = g.clock?.isNight || this.perception.isIndoors() || o.state === 'sit' || p.state === 'sit';
    if (!calm || !quietPlace) return;
    if ((g.rng?.next?.() ?? Math.random()) > 0.3) return;
    this.revealSecret(i);
  }

  // Tell the player one of her secrets (the brain may call this when she confides).
  revealSecret(index, { speak = true } = {}) {
    const s = this.soul.secrets?.[index];
    if (!s || this.secretsRevealed.includes(index)) return null;
    this.secretsRevealed.push(index);
    const P = playerRef(this.game);
    if (speak && Array.isArray(s.lines) && s.lines.length) this.sayLines(s.lines, { chat: true, gap: 0.8 });
    this.appraise('grief', 0.5, 'telling a secret');
    this.feel('trust', 0.3, 'trusting them');
    this.relationships.adjust(PLAYER_ID, { trust: 6, affinity: 4, familiarity: 6 }, 'I told them a secret');
    this.remember(`I told ${P} something I never tell anyone: ${s.text}`, { importance: 9, about: [PLAYER_ID], tags: ['secret', 'trust'], emotion: 'trust', gist: `telling ${P} my secret` });
    return s;
  }

  // ---------------------------------------------------------------- soul

  setSoul(soul) {
    this.soul = normalizeSoul(soul);
    this.affect.setPersonality(this.soul.personality);
    return this.soul;
  }

  resetSoul() {
    return this.setSoul(defaultSoul());
  }

  // ---------------------------------------------------------------- state for others

  place() {
    return this.perception.placeObj();
  }

  questStage() {
    const quest = this.game?.plugins?.get?.('quest');
    const s = quest?.stageOf?.(this.game);
    if (s && Number.isFinite(s.index)) return s;
    return { index: 0, id: STAGES[0].id };
  }

  describeState() {
    const m = this.mood();
    const o = this.owner;
    const g = this.game;
    const tops = this.affect
      .top(3)
      .filter((e) => e.value >= 0.35)
      .map((e) => e.name);
    const status = safeCall(() => o?.behavior?.status?.()) || '';
    const loc = this.place();
    const w = g?.clock?.weather?.type || 'clear';
    const weather = { clear: 'clear skies', cloudy: 'clouds', rain: 'rain', fog: 'fog' }[w] || w;
    const goal = topGoal(this.goals);
    const parts = [];
    parts.push(`${this.name} feels ${m.label}${tops.length ? ` (${tops.join(', ')})` : ''}, and is ${this.needsEngine.describe()}.`);
    parts.push(`${status ? `Right now she is ${status}` : 'Right now she is idle'} ${placePhrase(loc)}, ${partOfDay(g)}, ${weather}.`);
    if (o?.maxHp && o.hp < o.maxHp * 0.6) parts.push(`She is hurt (${Math.round(o.hp)}/${o.maxHp} HP).`);
    if (goal) parts.push(`On her mind: ${lowerFirst(goal.text.replace(/[.!]$/, ''))}.`);
    const last = this.thoughts[this.thoughts.length - 1];
    if (last) parts.push(`Latest thought: "${shorten(last.text, 110)}"`);
    return parts.join(' ');
  }

  summary() {
    const m = this.mood();
    const pressing = this.needsEngine.pressing(0.35);
    const goal = topGoal(this.goals);
    const last = this.thoughts[this.thoughts.length - 1];
    const needs = {};
    for (const k of Object.keys(this.needs)) needs[k] = Math.round(this.needs[k] * 100) / 100;
    return {
      name: this.name,
      mood: m,
      emoji: m.emoji,
      emotions: this.affect.top(3).map((e) => ({ name: e.name, value: Math.round(e.value * 100) / 100 })),
      needs,
      pressing,
      pressingText: pressing ? this.needsEngine.phrase(pressing) : null,
      goal: goal ? goal.text : null,
      goals: activeGoals(this.goals)
        .slice(0, 3)
        .map((g) => g.text),
      thought: last ? last.text : null,
      status: safeCall(() => this.owner?.behavior?.status?.()) || '',
      place: this.place()?.name || null,
      bond: this.relationships.bond(PLAYER_ID),
      memories: this.memory.size,
      people: this.relationships.people().length,
    };
  }

  // ---------------------------------------------------------------- save

  serialize() {
    const soulJson = JSON.stringify(this.soul);
    const out = {
      v: 1,
      soul: soulJson === JSON.stringify(defaultSoul()) ? null : this.soul,
      emotions: this.affect.serialize(),
      needs: this.needsEngine.serialize(),
      memory: this.memory.serialize(),
      relationships: this.relationships.serialize(),
      goals: this.goals.map((g) => ({ ...g })),
      thoughts: this.thoughts.slice(-LIMITS.thoughtsSaved).map((t) => ({ text: t.text, t: Math.round(t.t), source: t.source })),
      diary: this.diary.slice(-LIMITS.diary),
      conversation: this.conversation.slice(-LIMITS.conversation).map((c) => ({ role: c.role, text: c.text, t: Math.round(c.t ?? 0) })),
      knowledge: this.knowledge.slice(-LIMITS.knowledge),
      perception: this.perception.serialize(),
      secrets: [...this.secretsRevealed],
    };
    // Stay under the save budget: forget the least important memories first.
    let size = JSON.stringify(out).length;
    let guard = 0;
    while (size > LIMITS.saveBytes && guard++ < 40) {
      if (this.memory.size > 40) {
        this.memory.prune(Math.max(40, this.memory.size - 20));
        out.memory = this.memory.serialize();
      } else if (out.diary.length > 5) out.diary = out.diary.slice(-5);
      else if (out.knowledge.length > 30) out.knowledge = out.knowledge.slice(-30);
      else if (out.conversation.length > 10) out.conversation = out.conversation.slice(-10);
      else break;
      size = JSON.stringify(out).length;
    }
    return out;
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (d.soul) this.setSoul(d.soul);
    if (d.emotions) this.affect.deserialize(d.emotions);
    if (d.needs) this.needsEngine.deserialize(d.needs);
    if (d.memory) this.memory.deserialize(d.memory);
    if (Array.isArray(d.relationships)) {
      this.relationships.deserialize(d.relationships);
      if (!this.relationships.get(PLAYER_ID)) this.relationships.ensure(PLAYER_ID);
    }
    if (Array.isArray(d.goals)) {
      this.goals.length = 0;
      for (const g of sanitizeGoals(d.goals)) this.goals.push(g);
    }
    if (Array.isArray(d.thoughts)) this.thoughts = d.thoughts.filter((t) => t && t.text).map((t) => ({ text: String(t.text), t: Number(t.t) || 0, source: t.source || 'self' }));
    if (Array.isArray(d.diary)) this.diary = d.diary.filter((x) => x && x.text).map((x) => ({ day: Number(x.day) || 1, text: String(x.text).slice(0, LIMITS.diaryText), t: Number(x.t) || 0 }));
    if (Array.isArray(d.conversation)) {
      this.conversation = d.conversation.filter((c) => c && c.text).map((c) => ({ role: c.role === 'player' ? 'player' : 'lyra', text: String(c.text), t: Number(c.t) || 0 }));
      this._convLen = this.conversation.length;
    }
    if (Array.isArray(d.knowledge)) this.knowledge = d.knowledge.filter((k) => k && k.subject && k.text).map((k) => ({ subject: String(k.subject), text: String(k.text), t: Number(k.t) || 0, source: k.source || 'observed' }));
    if (d.perception) this.perception.deserialize(d.perception);
    if (Array.isArray(d.secrets)) this.secretsRevealed = d.secrets.filter((x) => Number.isInteger(x));
  }
}

function playerName(game) {
  return game?.settings?.playerName || game?.player?.name || 'Traveler';
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function lineDuration(text) {
  return clamp(1.8 + String(text).length * 0.055, 2.4, 7.5);
}

export { EMOTIONS, bondOf, jobLabel };
