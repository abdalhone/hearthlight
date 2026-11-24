// game.village: Hearthvale's social life (DESIGN §19.3, §19.7). The eighteen talk to each
// other and to Lyra, like and dislike each other, pass news one listener at a time, and
// remember the player: what they did, what they said, and whether they made amends.
//
// Claude is reached only from playerSays, listenIn and nightSummary (each a player's
// action), and from update() only in villageAi 'always' with the player's own API key.

import { Bonds } from './bonds.js';
import { Rumors, RUMOR_KINDS } from './rumors.js';
import { VILLAGERS, PEOPLE, SHORT_NAMES, FAMILY_TAGS } from './bonds_data.js';
import { VOICES, SCENES } from './voices.js';
import { buildExchange, chooseTopic, summarize, mainTag, WEEK_TOPICS, scenesFor } from './talk.js';
import { voiceOf, say, rnd, shortName, thirdName, fill, varsFor, topicPool, names } from './lines.js';
import { localReply } from './player_talk.js';
import { TO_YOU } from './voices_player.js';
import { speakable } from './hidden.js';
import { VILLAGER_RULES, SAY_SCHEMA, LINES_SCHEMA, NIGHT_SCHEMA, buildSayTask, buildListenTask, buildNightTask, coerceSay, coerceLines, coerceNight, cleanLine } from './village_prompt.js';

const DAY = 900; // clock seconds in a game day
const HOUR = DAY / 24;
const NEAR = 56; // px: close enough to talk
const SEEN = 170; // px from the player: the talk plays as bubbles
const SAY_GAP = 6; // the villagers' shared gap between ambient lines near the player (npc.js)
const LOG_CAP = 80;
const TALK_CAP = 6;
const AMBIENT_CLAUDE_GAP = 45; // real seconds
const CLAUDE_TIMEOUT_MS = 25000;
const SIGHT = 150;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    console.error('[village]', err);
    return fallback;
  }
}

function alive(e) {
  return !!e && !e.removed && !e.dead && !e.downed && (typeof e.isAlive === 'function' ? e.isAlive() : (e.hp ?? 1) > 0);
}

// Seconds a line stays its speaker's turn (matches the UI's lineBeat).
export function lineBeat(text, speed = 1) {
  const n = String(text || '').length;
  const s = Math.max(0.25, Number(speed) || 1);
  return clamp(1.3 + n / (16 * s) + 0.5, 2, 7.5);
}

export class Village {
  constructor(game) {
    this.game = game;
    this.bonds = new Bonds({ onChange: (a, b, bond, changes, reason) => this.emit('bond_changed', { a, b, bond, changes, reason }) });
    this.rumors = new Rumors();
    this.log = [];
    this.talks = {}; // npcId -> [{ t, day, you, they }]
    this.mentioned = {}; // npcId -> [rumor ids raised with the player]
    this.bars = {}; // placeId -> { until, by, reason, since }
    this.grievances = {}; // npcId -> { kind, victim, t, day, weight, grave }
    this.amendsDay = {}; // npcId -> { day, n }
    this.famDay = {}; // npcId -> { day, n } familiarity gained talking to the player today
    this.playing = null; // the conversation playing as bubbles near the player
    this.lastNear = null; // the last one that played near the player
    this.seq = 0;
    this.pairAt = new Map();
    this.personAt = new Map();
    this.nextAt = 0;
    this.lyraAt = -Infinity;
    this.spreadAt = 0;
    this.tickT = 0;
    this.recent = new Set();
    this.recentQ = [];
    this.recentScenes = new Set();
    this.sceneDay = {}; // scene index -> the day it last played: a scene keeps for a few days
    this.ambientAt = -Infinity; // game.time of the last Claude-written ambient exchange
    this.claudeBusy = false;
    this.barSaidAt = -Infinity;
    this.calls = { say: 0, listen: 0, night: 0, ambient: 0 };
  }

  // ------------------------------------------------------------------ basics

  emit(type, payload) {
    try {
      this.game?.bus?.emit?.(type, payload);
    } catch (err) {
      console.error(`[village] ${type} listener failed`, err);
    }
  }

  now() {
    return this.game?.clock?.t ?? 0;
  }

  day() {
    return this.game?.clock?.day ?? 1;
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  rng() {
    return this.game?.rng;
  }

  weatherKey() {
    const w = this.game?.clock?.weather?.type;
    if (w === 'rain') return 'rain';
    if (w === 'fog') return 'fog';
    return this.game?.clock?.isNight ? 'night' : 'clear';
  }

  entity(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    if (id === 'lyra') return this.game?.companion || safe(() => this.game?.entities?.get?.('lyra'));
    if (id === 'player') return this.game?.player || null;
    return safe(() => this.game?.entities?.get?.(id));
  }

  villagers() {
    const out = [];
    for (const id of VILLAGERS) {
      const e = this.entity(id);
      if (e && !e.removed) out.push(e);
    }
    return out;
  }

  name(id) {
    if (id === 'player') return this.game?.settings?.playerName || 'the stranger';
    if (id === 'lyra') return this.game?.settings?.companionName || 'Lyra';
    return SHORT_NAMES[id] || this.entity(id)?.name || id;
  }

  get mind() {
    return this.game?.companion?.mind || null;
  }

  // ------------------------------------------------------------------ bonds

  // How a stands toward b. Lyra's side comes from her mind when she has one.
  bond(a, b) {
    if (!a || !b || a === b) return null;
    if (b === 'player') {
      const e = this.entity(a);
      if (a === 'lyra') {
        const r = safe(() => this.mind?.relationships?.get?.('player'));
        return r ? { affinity: r.affinity ?? 0, trust: r.trust ?? 50, familiarity: r.familiarity ?? 0, tags: [...(r.tags || [])], note: '' } : null;
      }
      if (!e) return null;
      const o = e.opinionOfPlayer ?? 30;
      return { affinity: round1((o - 50) * 2), trust: o, familiarity: e.familiarity ?? 0, tags: [], note: '' };
    }
    const base = this.bonds.get(a, b);
    if (a === 'lyra') {
      const r = safe(() => this.mind?.relationships?.get?.(b));
      if (r && Number.isFinite(r.affinity)) {
        const tags = [...new Set([...(base?.tags || []), ...(r.tags || [])])];
        return { affinity: r.affinity, trust: r.trust ?? base?.trust ?? 50, familiarity: r.familiarity ?? base?.familiarity ?? 0, tags, note: base?.note || '' };
      }
    }
    return base;
  }

  adjustBond(a, b, changes, reason = '') {
    if (!a || !b || a === b) return {};
    if (a === 'lyra') {
      const rels = this.mind?.relationships;
      if (rels?.get?.(b)) return safe(() => rels.adjust(b, changes, reason), {}) || {};
    }
    return this.bonds.adjust(a, b, changes, reason);
  }

  loves(a, b, min = 60) {
    if (!a || !b) return false;
    const bd = this.bond(a, b);
    return !!bd && (bd.affinity >= min || bd.tags.some((t) => FAMILY_TAGS.has(t)));
  }

  isFamily(a, b) {
    return this.bonds.isFamily(a, b);
  }

  // ------------------------------------------------------------------ talking

  talkCtx(extra = {}) {
    const g = this.game;
    const clock = g?.clock;
    return {
      rng: this.rng(),
      hour: this.hour(),
      weather: clock?.weather?.type || 'clear',
      isNight: !!clock?.isNight,
      stance: (id) => this.stance(id),
      bond: (a, b) => this.bond(a, b),
      tellable: (a, b) => this.rumors.tellable(a, b, this.now()).filter((r) => this.canTell(a, b, r)),
      renderRumor: (r, sp) => this.rumors.render(r, sp, { stranger: voiceOf(sp)?.stranger || 'the stranger' }),
      howAreYou: (id) => this.howAreYou(id),
      sameWork: (a, b) => {
        const pa = this.entity(a)?.profile;
        const pb = this.entity(b)?.profile;
        return !!pa && !!pb && !!pa.work && pa.work === pb.work;
      },
      recent: this.recent,
      recentScenes: this.scenesPlayed(),
      avoidTopics: this.avoidFor(extra.a, extra.b),
      strangerNews: this.rumors.list.some((r) => r.about === 'player' && this.now() - r.t < DAY) ? 1 : 0,
      ...extra,
    };
  }

  // Scenes played in the last three days (and the last few, whatever the day).
  scenesPlayed() {
    const day = this.day();
    const out = new Set(this.recentScenes);
    for (const [i, d] of Object.entries(this.sceneDay)) if (day - d < 3 && SCENES[i]) out.add(SCENES[i]);
    return out;
  }

  // Nobody brings Lyra's own business to her as gossip, and the Maren thread stays the
  // player's to start with Aveline.
  avoidFor(a, b) {
    const s = new Set();
    if (a === 'lyra' || b === 'lyra') {
      const other = a === 'lyra' ? b : a;
      const stage = safe(() => this.mind?.questStage?.()?.index, 0) ?? 0;
      if (other === 'aveline' && stage <= 1) s.add('maren');
    }
    return s;
  }

  canTell(teller, listener, r) {
    if (!r) return false;
    if (listener === 'lyra' && r.about === 'lyra') return false;
    return true;
  }

  howAreYou(id) {
    const p = this.entity(id)?.profile;
    if (Array.isArray(p?.howAreYou) && p.howAreYou.length) return p.howAreYou;
    return voiceOf(id)?.howAreYou || null;
  }

  // How someone sees the player, as the voice banks file it.
  stance(id) {
    if (id === 'lyra') {
      const a = this.bond('lyra', 'player')?.affinity;
      if (!Number.isFinite(a)) return 'mid';
      return a >= 40 ? 'good' : a < 0 ? 'bad' : 'mid';
    }
    const o = this.entity(id)?.opinionOfPlayer;
    if (!Number.isFinite(o)) return 'mid';
    if (this.rumors.freshAgainstPlayer(id, this.now())) return 'bad';
    return o >= 60 ? 'good' : o < 28 ? 'bad' : 'mid';
  }

  remember(line) {
    if (!line) return;
    this.recent.add(line);
    this.recentQ.push(line);
    if (this.recentQ.length > 90) this.recent.delete(this.recentQ.shift());
  }

  // Two people talk. opts: { topic, onScreen (play as bubbles), passing, maxLines,
  // lines (already written, e.g. by Claude), source }. Returns the logged conversation.
  converse(aId, bId, opts = {}) {
    const a = typeof aId === 'object' ? aId?.id : aId;
    const b = typeof bId === 'object' ? bId?.id : bId;
    if (!a || !b || a === b || !VOICES[a] || !VOICES[b]) return null;
    if (a === 'lyra' || b === 'lyra') return this.lyraConverse(a === 'lyra' ? b : a, { ...opts, lyraFirst: a === 'lyra' });
    const ctx = this.talkCtx({ a, b });
    let ex;
    if (Array.isArray(opts.lines) && opts.lines.length) ex = { topic: opts.topic || 'own', lines: opts.lines, effects: null };
    else ex = buildExchange(ctx, a, b, { topic: opts.topic, passing: opts.passing, continuing: opts.continuing, noBye: opts.noBye, maxLines: opts.maxLines, playerName: this.game?.settings?.playerName || '' });
    return this.finishExchange(a, b, ex, opts);
  }

  finishExchange(a, b, ex, opts = {}) {
    if (!ex || !ex.lines?.length) return null;
    const lines = ex.lines.filter((l) => l && l.text && speakable(l.text));
    if (!lines.length) return null;
    for (const l of lines) this.remember(l.text);
    if (ex.scene) {
      const si = SCENES.indexOf(ex.scene);
      if (si >= 0) this.sceneDay[si] = this.day();
      this.recentScenes.add(ex.scene);
      if (this.recentScenes.size > 12) this.recentScenes.delete(this.recentScenes.values().next().value);
    }
    // The news passes on, and may grow in the telling.
    let rumorText = null;
    let rumor = ex.rumor || null;
    if (rumor) {
      const teller = ex.teller === b ? b : a;
      const listener = teller === a ? b : a;
      this.rumors.hear(rumor, listener, teller, this.rng());
      this.onHeard(listener, rumor, teller);
      rumorText = this.rumorForPlayer(rumor);
    }
    // Lines written elsewhere (Claude) still pass on what they carry.
    const effects = ex.effects || { ab: { affinity: 0.8, familiarity: 1, trust: 0.2 }, ba: { affinity: 0.8, familiarity: 1, trust: 0.2 } };
    const reason = `talked (${ex.topic || 'small'})`;
    // Lyra's own side is moved by her mind (applyConversation) when it keeps the talk.
    if (!(opts.mindKeeps && a === 'lyra')) this.adjustBond(a, b, effects.ab, reason);
    if (!(opts.mindKeeps && b === 'lyra')) this.adjustBond(b, a, effects.ba, reason);
    const t = this.now();
    this.pairAt.set(pairKey(a, b), t);
    this.personAt.set(a, t);
    this.personAt.set(b, t);
    const conv = {
      id: ++this.seq,
      t: Math.round(t),
      day: this.day(),
      a,
      b,
      topic: ex.topic || 'small',
      // The teller first: news told back the other way round is still "B told A".
      summary: opts.summary || (rumor && ex.teller === b ? summarize(b, a, ex.topic, { names: (x) => this.name(x), rumorText }) : summarize(a, b, ex.topic, { names: (x) => this.name(x), rumorText })),
      lines: lines.map((l) => ({ speaker: l.speaker, text: l.text })),
      effects: { [`${a}>${b}`]: effects.ab, [`${b}>${a}`]: effects.ba, rumor: rumor?.id || undefined },
      source: opts.source || 'local',
    };
    this.addLog(conv);
    this.emit('village_talk', { a, b, topic: conv.topic, summary: conv.summary });
    if (opts.onScreen) this.play(conv);
    return conv;
  }

  addLog(conv) {
    this.log.push(conv);
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
  }

  rumorForPlayer(rumor, speaker = null) {
    const you = this.rumors.renderYou(rumor, speaker || 'narrator');
    if (you) return you;
    return this.rumors.render(rumor, speaker || 'narrator', { stranger: 'you' });
  }

  // ------------------------------------------------------------------ Lyra's side

  lyraFree({ passing = false } = {}) {
    const g = this.game;
    const lyra = g?.companion;
    if (!alive(lyra)) return false;
    const mind = lyra.mind;
    if (!mind) return false;
    if (safe(() => mind.isSpeaking?.(), false)) return false;
    if (safe(() => g.plugins?.get?.('social')?.busy?.(g.plugins.ctx), false)) return false;
    if (g.brain?.busy === true || g.brain?._chatRun) return false;
    if (g.ui?.chat?.isOpen?.()) return false;
    // A hostile creature about: no time for chat.
    const threat = safe(() => g.entities?.nearest?.(lyra.x, lyra.y, 150, (e) => e.species && alive(e) && (e.faction === 'monster' || e.faction === 'bandit' || e.faction === 'undead' || e.target === lyra)));
    if (threat) return false;
    if (passing) return true;
    // A proper talk needs her to have stopped somewhere, not be on her way.
    if (Math.hypot(lyra.moveIntent?.x || 0, lyra.moveIntent?.y || 0) > 0.05) return false;
    const st = safe(() => mind.companionship, 'together') || 'together';
    if (st !== 'together' && st !== 'wary') return true;
    const p = g.player;
    if (!p || dist(p, lyra) > 150) return true;
    const block = safe(() => mind.autonomy?.currentBlock?.());
    const type = block?.type;
    return ['visit', 'eat', 'hearth', 'rest', 'lead'].includes(type);
  }

  // Lyra and a villager talk; her side comes from her mind and is remembered by it.
  lyraConverse(otherId, opts = {}) {
    const g = this.game;
    const lyra = g?.companion;
    const npc = this.entity(otherId);
    const mind = lyra?.mind;
    if (!npc || !VOICES[otherId]) return null;
    const ctx = this.talkCtx({ a: 'lyra', b: otherId });
    const mood = safe(() => mind?.mood?.()?.valence, 0) ?? 0;
    const maxLines = opts.maxLines || (mood < -0.25 ? 4 : 6);
    let ex = null;
    let learned = [];
    if (Array.isArray(opts.lines) && opts.lines.length) ex = { topic: opts.topic || 'own', lines: opts.lines };
    else if (!opts.passing && !opts.continuing && mind && rnd(this.rng()) < 0.4) {
      const r = this.lyraLearns(npc, mind, mood);
      if (r) {
        ex = r.ex;
        learned = r.learned;
      }
    }
    if (!ex) {
      const first = opts.lyraFirst === false ? otherId : opts.lyraFirst === true || rnd(this.rng()) < 0.55 ? 'lyra' : otherId;
      const second = first === 'lyra' ? otherId : 'lyra';
      ex = buildExchange(ctx, first, second, { topic: opts.topic, passing: opts.passing, continuing: opts.continuing, noBye: opts.noBye, maxLines, playerName: g?.settings?.playerName || '' });
      if (ex.topic === 'maren' && ctx.avoidTopics.has('maren')) ex = buildExchange(ctx, first, second, { topic: 'howare', maxLines, playerName: '' });
    }
    if (!opts.lines && !opts.passing && !ex.scene && !learned.length) this.onHerMind(ex, otherId, mind);
    if (ctx.avoidTopics.has('maren')) ex.lines = ex.lines.filter((l) => !/\bmaren\b/i.test(l.text));
    const social = safe(() => g?.plugins?.get?.('social'));
    const keeps = !!(mind && social?.applyConversation && !opts.passing);
    const first = ex.lines[0]?.speaker === otherId ? otherId : 'lyra';
    const conv = this.finishExchange(first, first === 'lyra' ? otherId : 'lyra', ex, { ...opts, mindKeeps: keeps });
    if (!conv) return null;
    this.lyraAt = this.now();
    // Her mind keeps it like any other conversation.
    if (keeps) {
      const lines = conv.lines.map((l) => ({ speaker: l.speaker === 'lyra' ? 'lyra' : 'npc', text: l.text }));
      safe(() => social.applyConversation(g.plugins.ctx, npc, { lines, learned, affinity: mood < -0.25 ? 1 : 2, topic: conv.topic === 'small' ? null : topicLabel(conv.topic) }, { topic: conv.topic === 'small' || conv.topic === 'howare' ? null : topicLabel(conv.topic) }));
    }
    if (!opts.passing) {
      const played = conv.lines.map((l) => ({ speaker: l.speaker, name: this.name(l.speaker), text: l.text }));
      this.emit('conversation', { a: lyra, b: npc, lines: played, topic: conv.topic === 'small' || conv.topic === 'howare' ? null : topicLabel(conv.topic), village: true });
    }
    return conv;
  }

  // What is on her mind (a recent thought) she tells the people she is close to.
  onHerMind(ex, otherId, mind) {
    if (!mind || (this.bond('lyra', otherId)?.affinity ?? 0) < 50 || rnd(this.rng()) > 0.4) return;
    const now = this.now();
    const th = [...(mind.thoughts || [])].reverse().find((x) => x && now - (x.t ?? -Infinity) < HOUR * 3 && x.text && x.text.length <= 120 && !/\byou(r)?\b/i.test(x.text) && speakable(x.text) && !/^\W/.test(x.text));
    if (!th) return;
    const rng = this.rng();
    const nv = voiceOf(otherId);
    // They listen: warmly if they love her, otherwise a word of their own.
    const close = (this.bond(otherId, 'lyra')?.affinity ?? 0) >= 60;
    const reply = (close && say(nv?.warm, otherId, 'lyra', { rng })) || say(nv?.short, otherId, 'lyra', { rng }) || say(nv?.yes, otherId, 'lyra', { rng });
    if (!reply) return;
    const said = `${pickAt(ON_MY_MIND, rng)} ${th.text.charAt(0).toUpperCase()}${th.text.slice(1)}`.replace(/([^.!?])$/, '$1.');
    if (!speakable(said)) return;
    let at = ex.lines.findIndex((l, i) => i >= 1 && ex.lines[i - 1].speaker === otherId && l.speaker === 'lyra');
    if (at < 0) at = ex.lines.length && ex.lines[ex.lines.length - 1].speaker === otherId ? ex.lines.length : -1;
    if (at < 0) return;
    ex.lines.splice(at, 0, { speaker: 'lyra', text: said }, { speaker: otherId, text: reply });
    // Keep it a chat: at most six lines, and never one speaker twice running.
    ex.lines = ex.lines.filter((l, i, a) => i === 0 || a[i - 1].speaker !== l.speaker).slice(0, 6);
    ex.topic = ex.topic === 'small' ? 'own' : ex.topic;
  }

  // Something the villager would tell her at her familiarity, asked and answered.
  lyraLearns(npc, mind, mood) {
    // Her own family she has known all her life: nothing to learn there as news.
    if (this.isFamily('lyra', npc.id)) return null;
    const rel = safe(() => mind.relationships.ensure(npc));
    if (!rel) return null;
    const facts = (npc.profile?.facts || []).filter((f) => {
      if (!f || !f.text || f.topic === 'secret') return false;
      // She grew up here: what everyone knows, and the villagers' own work and families,
      // she knew long before the stranger came. News, Maren, the bandits and the ruins
      // are what a neighbour can still tell her.
      if (!LEARNABLE.has(f.topic) || (Number(f.minFamiliarity) || 0) < 10) return false;
      if (names(f.say || f.text, 'lyra')) return false;
      if (Array.isArray(f.hiddenFrom) && f.hiddenFrom.includes('lyra')) return false;
      if (Array.isArray(f.knownBy) && !f.knownBy.includes('lyra') && f.hiddenFrom) return false;
      if ((Number(f.minFamiliarity) || 0) > (rel.familiarity ?? 0)) return false;
      if (rel.notes?.some?.((n) => n.text === f.text)) return false;
      return speakable(f.text) && speakable(f.say || '');
    });
    if (!facts.length) return null;
    const f = facts[Math.floor(rnd(this.rng()) * facts.length)];
    const id = npc.id;
    const rng = this.rng();
    const lv = voiceOf('lyra');
    const nv = voiceOf(id);
    const lines = [];
    const push = (speaker, text) => text && lines.push({ speaker, text });
    push('lyra', say(lv.helloTo?.[id] || lv.hello, 'lyra', id, { rng, direct: !!lv.helloTo?.[id] }));
    push(id, say(nv.helloTo?.lyra || nv.short, id, 'lyra', { rng, direct: true }));
    const n = say(['{n}'], 'lyra', id, {}) || shortName(id);
    push('lyra', fill(LYRA_ASKS[f.topic] ? pickAt(LYRA_ASKS[f.topic], rng) : pickAt(LYRA_ASKS.default, rng), { n }));
    const told = spokenFact(f, npc);
    push(id, told);
    push('lyra', pickAt(mood < -0.25 ? LYRA_HEARS.low : LYRA_HEARS[f.topic] || LYRA_HEARS.default, rng));
    if (lines.length < 4 || !told) return null;
    return { ex: { topic: f.topic && f.topic !== 'secret' ? f.topic : 'own', lines, effects: null }, learned: [{ text: f.text, about: id }] };
  }

  // ------------------------------------------------------------------ playing as bubbles

  play(conv) {
    const g = this.game;
    if (!conv?.lines?.length) return;
    if (this.playing) this.stopPlaying();
    const speed = g?.settings?.textSpeed ?? 1;
    let at = 0;
    const queue = [];
    for (const l of conv.lines) {
      queue.push({ speaker: l.speaker, text: l.text, at });
      at += lineBeat(l.text, speed);
    }
    this.playing = { conv, queue, t: 0, end: at };
    this.lastNear = { conv, t: this.game?.time ?? 0 };
    this.stepPlaying(0);
  }

  stopPlaying() {
    if (!this.playing) return;
    this.lastNear = { conv: this.playing.conv, t: this.game?.time ?? 0 };
    this.playing = null;
  }

  isTalking(e) {
    const id = typeof e === 'object' ? e?.id : e;
    const c = this.playing?.conv;
    return !!c && (c.a === id || c.b === id);
  }

  partnerOf(e) {
    const id = typeof e === 'object' ? e?.id : e;
    const c = this.playing?.conv;
    if (!c) return null;
    return c.a === id ? this.entity(c.b) : c.b === id ? this.entity(c.a) : null;
  }

  stepPlaying(dt) {
    const p = this.playing;
    if (!p) return;
    const g = this.game;
    p.t += dt;
    const a = this.entity(p.conv.a);
    const b = this.entity(p.conv.b);
    // Someone was knocked down, ran, or walked off: the talk ends there.
    // (Lyra keeps living her evening while she talks: she may drift a little further.)
    const reach = p.conv.a === 'lyra' || p.conv.b === 'lyra' ? 150 : 120;
    if (!alive(a) || !alive(b) || dist(a, b) > reach || a.mode === 'flee' || b.mode === 'flee' || a.mode === 'fight' || b.mode === 'fight') {
      this.stopPlaying();
      return;
    }
    while (p.queue.length && p.queue[0].at <= p.t) {
      const q = p.queue.shift();
      const sp = q.speaker === p.conv.a ? a : b;
      const to = sp === a ? b : a;
      this.speak(sp, to, q.text);
    }
    if (!p.queue.length && p.t >= p.end - 0.5) this.stopPlaying();
  }

  speak(sp, to, text) {
    const g = this.game;
    safe(() => sp.faceToward?.(to.x, to.y));
    if (sp === g?.companion) {
      safe(() => sp.mind?.say?.(text, { target: to, kind: 'say' }));
    } else if (typeof sp.say === 'function') {
      safe(() => sp.say(text, { target: to, kind: 'say', village: true }));
    }
    if (g) g._npcSayAt = this.now();
  }

  // ------------------------------------------------------------------ the rhythm

  update(dt) {
    const g = this.game;
    if (!g || g.state !== 'playing') return;
    this.stepPlaying(dt);
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.5;
    const t = this.now();
    safe(() => this.spreadFast(t));
    if (t >= this.nextAt) {
      this.nextAt = t + this.interval();
      safe(() => this.startSomething(t));
    }
    safe(() => this.maybeLyra(t));
    safe(() => this.expireBars(t));
  }

  // Clock seconds to the next conversation somewhere in the village: a few an hour, more
  // in the evening at the Kettle, few at night.
  interval() {
    const h = this.hour();
    const r = rnd(this.rng());
    if (h >= 18 && h < 22.5) return 5 + r * 5;
    if (h >= 22.5 || h < 6) return 22 + r * 18;
    return 9 + r * 8;
  }

  awake(e) {
    return alive(e) && e.state !== 'sleep' && e.activity !== 'sleep' && (e.mode === undefined || e.mode === 'routine');
  }

  busyWithPlayer(e) {
    const t = this.now();
    return (e.talkingUntil ?? -Infinity) > t;
  }

  // On their way somewhere (a talk is a nod in passing), as against milling about a room
  // or a stall (they stop for a proper talk: npc.social holds them still while it plays).
  stationary(e) {
    return !e.r || e.r.phase !== 'travel';
  }

  onScreen(e) {
    const p = this.game?.player;
    if (!p) return false;
    if (typeof e.visibleToPlayer === 'function' && safe(() => e.visibleToPlayer(0), false)) return dist(e, p) < SEEN + 60;
    return dist(e, p) < SEEN;
  }

  // Is a conversation waiting for a quiet moment near the player?
  wantsSlot() {
    return this.now() - (this.wantSlotAt ?? -Infinity) < 8 && !this.playing;
  }

  quietNearPlayer() {
    const g = this.game;
    return this.now() - (g?._npcSayAt ?? -Infinity) >= SAY_GAP && !this.playing;
  }

  // Pick two people near each other and let them talk.
  startSomething(t) {
    const all = this.villagers().filter((e) => this.awake(e) && !this.busyWithPlayer(e) && !this.isTalking(e));
    if (all.length < 2) return null;
    const cands = [];
    const evening = this.hour() >= 18 && this.hour() < 22.5;
    const where = new Map();
    for (const e of all) where.set(e, safe(() => this.game?.locations?.at?.(e.x, e.y)?.id, null));
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (t - (this.personAt.get(a.id) ?? -Infinity) < 12) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (t - (this.personAt.get(b.id) ?? -Infinity) < 12) continue;
        const d = dist(a, b);
        // Close enough to talk: side by side, or under the same roof.
        const sameRoom = where.get(a) && where.get(a) === where.get(b) && d < 130;
        const social = (a.activity === 'socialize' || a.activity === 'eat') && (b.activity === 'socialize' || b.activity === 'eat');
        if (d > NEAR && !sameRoom && !(social && d < 110)) continue;
        const since = t - (this.pairAt.get(pairKey(a.id, b.id)) ?? -Infinity);
        if (since < HOUR * 1.5) continue;
        const fam = this.bond(a.id, b.id)?.familiarity ?? 30;
        let w = 0.5 + fam / 100;
        if (social || sameRoom) w += evening ? 1.2 : 0.6;
        if (this.isFamily(a.id, b.id)) w += 0.6;
        if (this.rumors.tellable(a.id, b.id, t).length || this.rumors.tellable(b.id, a.id, t).length) w += 0.8;
        cands.push([a, b, w]);
      }
    }
    if (!cands.length) {
      this.nextAt = Math.min(this.nextAt, t + 3);
      return null;
    }
    // Weighted order; a pair the player can see waits for a quiet moment, and someone
    // else in the village talks instead.
    const order = [];
    const pool = cands.slice();
    while (pool.length) {
      let sum = 0;
      for (const c of pool) sum += c[2];
      let r = rnd(this.rng()) * sum;
      let k = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i][2];
        if (r <= 0) {
          k = i;
          break;
        }
      }
      order.push(pool.splice(k, 1)[0]);
    }
    for (let [a, b] of order) {
      if (rnd(this.rng()) < 0.5) [a, b] = [b, a];
      const c = this.talkPair(a, b);
      if (c) return c;
    }
    this.nextAt = Math.min(this.nextAt, t + 2);
    return null;
  }

  // Start a talk between two people standing together; on screen it plays as bubbles.
  talkPair(a, b, { topic = null } = {}) {
    const seen = this.onScreen(a) || this.onScreen(b);
    if (seen) {
      if (!this.quietNearPlayer()) {
        // Ask the villagers' lone lines to leave the next quiet moment to a conversation.
        this.wantSlotAt = this.now();
        return null;
      }
      this.wantSlotAt = -Infinity;
      const passing = !this.stationary(a) || !this.stationary(b);
      if (!passing && this.ambientClaudeOk()) return this.ambientClaude(a, b);
      return this.converse(a.id, b.id, { onScreen: true, passing, topic });
    }
    return this.converse(a.id, b.id, { onScreen: false, topic });
  }

  // A villager's own social() asks the village to start a chat with someone beside them.
  requestChat(a, b) {
    if (!a || !b || a === b) return false;
    const t = this.now();
    if (t - (this.pairAt.get(pairKey(a.id, b.id)) ?? -Infinity) < HOUR * 1.5) return false;
    if (t - (this.personAt.get(a.id) ?? -Infinity) < 20 || t - (this.personAt.get(b.id) ?? -Infinity) < 20) return false;
    if (b === this.game?.companion) {
      if (t - (this.pairAt.get(pairKey(a.id, 'lyra')) ?? -Infinity) < HOUR * 2) return false;
      const full = this.lyraFree();
      if (!full && !this.lyraFree({ passing: true })) return false;
      return !!this.lyraTalk(a, { passing: !full });
    }
    if (!this.awake(b) || this.busyWithPlayer(b)) return false;
    return !!this.talkPair(a, b);
  }

  // Lyra, free and beside someone she knows, talks with them. Her parents most of all.
  maybeLyra(t) {
    const g = this.game;
    const lyra = g?.companion;
    if (!lyra || t - this.lyraAt < HOUR * 0.8) return;
    if (!this.lyraFree()) return;
    let best = null;
    let bestW = 0;
    for (const e of this.villagers()) {
      if (!this.awake(e) || this.busyWithPlayer(e) || this.isTalking(e)) continue;
      const d = dist(e, lyra);
      if (d > 64) continue;
      if (t - (this.pairAt.get(pairKey('lyra', e.id)) ?? -Infinity) < HOUR * 2) continue;
      const bd = this.bond('lyra', e.id);
      let w = 0.3 + Math.max(0, bd?.affinity ?? 0) / 60;
      if (bd?.tags?.includes('parent')) w += 2;
      if (w > bestW) {
        best = e;
        bestW = w;
      }
    }
    if (best) this.lyraTalk(best);
  }

  lyraTalk(npc, { passing = false, topic = null } = {}) {
    const lyra = this.game?.companion;
    const seen = this.onScreen(lyra) || this.onScreen(npc);
    if (seen && !this.quietNearPlayer()) return null;
    return this.lyraConverse(npc.id, { onScreen: seen, passing, topic });
  }

  // Grave news runs through the village fast: one more telling every few seconds, kin first.
  spreadFast(t) {
    if (t - this.spreadAt < 3) return;
    this.spreadAt = t;
    const grave = this.rumors.list.filter((r) => r.severity >= 0.6 && t - r.t < DAY);
    if (!grave.length) return;
    const people = this.villagers().filter((e) => alive(e));
    for (const r of grave) {
      const tellers = people.filter((e) => r.heardBy.includes(e.id) && this.awake(e));
      if (r.heardBy.includes('lyra') && this.lyraFree({ passing: true })) tellers.push(this.game.companion);
      const hearers = people.filter((e) => !r.heardBy.includes(e.id) && r.victim !== e.id && this.awake(e));
      if (!tellers.length || !hearers.length) continue;
      // The teller who loves the hearer most passes it on.
      let best = null;
      let bw = -Infinity;
      for (const a of tellers) {
        for (const b of hearers) {
          const w = (this.bond(a.id, b.id)?.affinity ?? 0) + (this.isFamily(a.id, b.id) ? 60 : 0) - dist(a, b) / 40 + rnd(this.rng()) * 20;
          if (w > bw) {
            bw = w;
            best = [a, b];
          }
        }
      }
      if (!best) continue;
      const [a, b] = best;
      if (this.onScreen(a) && this.onScreen(b) && dist(a, b) < 80 && this.quietNearPlayer()) this.converse(a.id, b.id, { topic: 'rumor', onScreen: true });
      else if (a.id === 'lyra') this.lyraConverse(b.id, { topic: 'rumor', onScreen: false, lyraFirst: true });
      else this.converse(a.id, b.id, { topic: 'rumor', onScreen: false });
      return; // one telling per beat
    }
  }

  // ------------------------------------------------------------------ gossip

  // A notable event becomes news. witnesses hear it first; their opinion moves at once.
  // saw: the eyewitnesses among them (default: all of them but the one it happened to).
  addRumor(kind, { victim = null, beast = null, witnesses = [], saw = null, source = 'village', about = 'player' } = {}) {
    const def = RUMOR_KINDS[kind];
    if (!def) return null;
    const heardBy = [...new Set(witnesses.filter(Boolean))];
    if (victim && !heardBy.includes(victim)) heardBy.push(victim);
    const same = this.rumors.list.find((r) => r.kind === kind && r.victim === (victim || def.victim || null) && r.day === this.day());
    const before = new Set(same?.heardBy || []);
    const eyes = (saw || heardBy).filter((id) => id && id !== (victim || def.victim));
    const r = this.rumors.add({ kind, victim, beast, heardBy, saw: eyes, source, about: def.about || about, t: this.now(), day: this.day() });
    if (!r) return null;
    // The same news from another quarter (the crime and Lyra's deed of one blow): only
    // those who had not heard it yet are moved by it.
    for (const id of heardBy) if (id !== source && !before.has(id)) this.onHeard(id, r, null, { witness: true });
    if (!same) this.emit('rumor', { rumor: r });
    return r;
  }

  witnessesNear(x, y, r = SIGHT) {
    const out = [];
    for (const e of this.villagers()) if (alive(e) && Math.hypot(e.x - x, e.y - y) <= r && e.state !== 'sleep') out.push(e.id);
    return out;
  }

  // Someone heard a piece of news. Opinions of the player move, most among those who love
  // the one it happened to; Lyra keeps it as hearsay.
  onHeard(id, rumor, tellerId, { witness = false } = {}) {
    if (!id || !rumor) return;
    if (id === 'lyra') return this.lyraHears(rumor, tellerId, witness);
    const e = this.entity(id);
    if (!e) return;
    const aboutPlayer = rumor.about === 'player' || rumor.kind === 'lyra_gone' || rumor.kind === 'lyra_left' || rumor.kind === 'lyra_back';
    if (!aboutPlayer || typeof e.adjustOpinion !== 'function') return;
    const delta = this.opinionShift(id, rumor, witness);
    if (delta) e.adjustOpinion(delta, `heard: ${rumor.kind}`);
    if (rumor.valence < 0 && rumor.severity >= 0.6 && this.now() - rumor.t < DAY * 1.5) {
      const loves = rumor.victim ? this.loves(id, rumor.victim, 55) : false;
      const day = this.day();
      if (loves) e.wrongedDay = day;
      else if ((e.coldDay ?? -1) !== day) e.coldDay = day;
      const g = this.grievances[id];
      const weight = Math.abs(delta);
      if (!g || g.weight < weight) this.grievances[id] = { kind: rumor.kind, victim: rumor.victim || null, t: Math.round(rumor.t), day: rumor.day, weight: round1(weight), grave: loves && rumor.severity >= 0.7 };
      // The watch, or Elda in her own inn, keep the player out of the Kettle for a while.
      if ((id === 'rowan' || id === 'wys' || id === 'elda') && rumor.severity >= 0.7 && (rumor.victim === 'lyra' || rumor.kind === 'downed_villager')) {
        this.bar('ember_kettle', { days: rumor.severity >= 0.95 ? 2 : 1, by: id === 'elda' ? 'elda' : 'rowan', reason: rumor.kind });
      }
    }
  }

  opinionShift(id, rumor, witness) {
    let base = rumor.severity >= 0.8 ? 10 : rumor.severity >= 0.5 ? 6 : 3;
    // Villagers already flinched at a crime against one of their own (npc.onCrime).
    if (rumor.kind === 'attacked_villager' || rumor.kind === 'downed_villager') base *= 0.5;
    if (rumor.valence > 0) base *= 0.6;
    let mult = 1;
    if (rumor.victim && rumor.victim !== id) {
      const aff = this.bond(id, rumor.victim)?.affinity ?? 0;
      mult += clamp(aff / 50, 0, 1.6);
      if (this.isFamily(id, rumor.victim)) mult += 0.8;
    } else if (rumor.victim === id) mult += 1;
    if (witness) mult *= 1.3;
    return clamp(round1(rumor.valence * base * mult), -25, 6);
  }

  // News reaches Lyra as hearsay: weaker than what she saw herself.
  lyraHears(rumor, tellerId, witness) {
    const mind = this.mind;
    if (!mind || witness || rumor.source === 'lyra') return;
    const who = tellerId ? this.name(tellerId) : 'Someone';
    const P = this.game?.settings?.playerName || 'the stranger';
    const clause = this.rumors.render(rumor, 'narrator', { stranger: P, version: this.rumors.versionOf(rumor, 'lyra') });
    if (!clause) return;
    const text = `${who} says ${clause}.`;
    safe(() => mind.learn?.(rumor.about === 'player' ? P : rumor.victim ? this.name(rumor.victim) : 'Hearthvale', text, { kind: 'rumor', source: 'told', from: tellerId || null, confidence: 0.4, about: [rumor.about === 'player' ? 'player' : rumor.victim || 'village'].filter(Boolean) }));
    if (rumor.about === 'player' && rumor.valence) {
      const rels = mind.relationships;
      if (rels?.get?.('player')) safe(() => rels.adjust('player', { affinity: round1(rumor.valence * 1.5), trust: round1(rumor.valence * 1.2) }, `Heard from ${who} that ${clause}`));
    }
  }

  bar(placeId, { days = 1, by = 'rowan', reason = '' } = {}) {
    const t = this.now();
    const until = t + days * DAY;
    const cur = this.bars[placeId];
    if (cur && cur.until >= until) return cur;
    this.bars[placeId] = { until: Math.round(until), by, reason, since: Math.round(cur?.since ?? t) };
    return this.bars[placeId];
  }

  expireBars(t) {
    for (const [k, b] of Object.entries(this.bars)) {
      if (b.until <= t) delete this.bars[k];
      else if (k === 'ember_kettle') {
        // Lifted early once Elda and the Captain have come round.
        const elda = this.entity('elda')?.opinionOfPlayer ?? 50;
        const rowan = this.entity('rowan')?.opinionOfPlayer ?? 50;
        if (elda >= 32 && rowan >= 32 && t - b.since > DAY * 0.5) delete this.bars[k];
      }
    }
  }

  // Is the player kept out of a place right now? -> { until, by, reason, daysLeft } | null
  barred(placeId) {
    const b = this.bars[placeId];
    if (!b) return null;
    const t = this.now();
    if (b.until <= t) {
      delete this.bars[placeId];
      return null;
    }
    return { ...b, daysLeft: round1((b.until - t) / DAY) };
  }

  // How a villager stands with the player right now (DESIGN §19.7).
  standing(npcId) {
    const e = this.entity(npcId);
    const opinion = Number.isFinite(e?.opinionOfPlayer) ? e.opinionOfPlayer : 30;
    const t = this.now();
    const g = this.grievances[npcId] || null;
    const fresh = !!g && t - g.t < DAY * 2;
    const grievance = g ? { ...g, fresh } : null;
    const day = this.day();
    const label = opinion < 15 ? 'Hostile' : opinion < 30 ? 'Wary' : opinion < 50 ? 'Neutral' : opinion < 75 ? 'Friendly' : 'Fond';
    const shop = !!e?.profile?.shop;
    const refusesTrade = shop && (opinion < 15 || (!!grievance && fresh && grievance.weight >= 8) || e?.wrongedDay === day);
    const cold = opinion < 15 || (!!grievance && fresh && grievance.weight >= 6) || e?.wrongedDay === day;
    const barredFrom = Object.keys(this.bars).filter((k) => this.barred(k));
    return { opinion, label, grievance, refusesTrade, cold, barredFrom };
  }

  // Gifts, help and apologies mend things, slowly: a little each day, more for the hurt.
  amend(npcId, kind = 'apology') {
    const e = this.entity(npcId);
    if (!e || typeof e.adjustOpinion !== 'function') return 0;
    const day = this.day();
    const a = this.amendsDay[npcId];
    const n = a && a.day === day ? a.n : 0;
    if (n >= 2) return 0;
    this.amendsDay[npcId] = { day, n: n + 1 };
    const g = this.grievances[npcId];
    const amount = { apology: 2.5, gift: 3, help: 4 }[kind] ?? 2;
    const scale = g ? 1 : 0.4;
    const d = e.adjustOpinion(round1(amount * scale), `amends: ${kind}`);
    if (g) {
      g.weight = round1(g.weight - amount);
      if (g.weight <= 0) delete this.grievances[npcId];
    }
    if (g && (kind === 'apology' || kind === 'help') && n === 0) this.addRumor('apology', { victim: npcId, witnesses: [npcId] });
    // The bar shortens a little with each amend to the Kettle or the watch.
    const bar = this.bars.ember_kettle;
    if (bar && ['elda', 'rowan', 'wys', 'hobb', 'wenna'].includes(npcId)) bar.until = Math.round(bar.until - DAY * 0.25);
    return d;
  }

  // ------------------------------------------------------------------ events

  onEvent(type, p) {
    if (!p && type !== 'new_day') return;
    const g = this.game;
    const isPlayer = (x) => !!x && (x === g?.player || x.id === 'player' || x === 'player');
    switch (type) {
      case 'deed': {
        const kind = p.deed;
        if (!RUMOR_KINDS[kind]) return;
        const victimId = typeof p.victim === 'object' ? p.victim?.id : p.victim;
        const where = g?.player || g?.companion;
        const witnesses = where ? this.witnessesNear(where.x, where.y) : [];
        // Her own ledger knows it; she saw it only if she was there.
        const lyra = g?.companion;
        const saw = lyra && where && dist(lyra, where) < SIGHT ? [...witnesses, 'lyra'] : [...witnesses];
        witnesses.push('lyra');
        const victim = RUMOR_KINDS[kind].victim || victimId || null;
        this.addRumor(kind, { victim, witnesses, saw, source: 'lyra' });
        return;
      }
      case 'crime': {
        if (!isPlayer(p.actor) || !p.victim?.id) return;
        const kind = p.kind === 'knockout' ? 'downed_villager' : 'attacked_villager';
        const witnesses = this.witnessesNear(p.victim.x, p.victim.y);
        const lyra = g?.companion;
        if (lyra && dist(lyra, p.victim) < SIGHT) witnesses.push('lyra');
        this.addRumor(kind, { victim: p.victim.id, witnesses });
        return;
      }
      case 'call_for_help': {
        if (!isPlayer(p.attacker)) return;
        const victimId = p.victim?.id || null;
        if (!victimId) return;
        // Knocked down (or a severity at the top of a 0..1 scale) is the worse news.
        const sev = Number(p.severity);
        const down = !!p.victim?.downed || p.severity === 'downed' || p.severity === 'critical' || (Number.isFinite(sev) && sev <= 1 && sev >= 0.95);
        const kind = victimId === 'lyra' ? (down ? 'downed_lyra' : 'hit_lyra') : down ? 'downed_villager' : 'attacked_villager';
        const x = p.x ?? p.victim?.x ?? 0;
        const y = p.y ?? p.victim?.y ?? 0;
        this.addRumor(kind, { victim: victimId, witnesses: [...this.witnessesNear(x, y, 240), victimId] });
        return;
      }
      case 'death': {
        if (!isPlayer(p.killer) || !p.entity?.species) return;
        const beast = p.entity;
        const t = this.now();
        for (const e of this.villagers()) {
          if (!alive(e) && !e.downed) continue;
          const hunted = e.lastAttacker === beast && t - (e.lastAttackedAt ?? -Infinity) < 20;
          const fled = e.fleeFrom === beast || (e.mode === 'flee' && dist(e, beast) < 110);
          if (hunted || fled) {
            this.addRumor('rescued', { victim: e.id, beast: String(beast.species).replace(/_/g, ' '), witnesses: [e.id, ...this.witnessesNear(e.x, e.y)] });
            this.amend(e.id, 'help');
            return;
          }
        }
        return;
      }
      case 'revived': {
        const e = p.entity;
        if (!e || !isPlayer(p.by) || !VILLAGERS.includes(e.id)) return;
        this.addRumor('helped_up', { victim: e.id, witnesses: [e.id, ...this.witnessesNear(e.x, e.y)] });
        this.amend(e.id, 'help');
        return;
      }
      case 'item_given': {
        if (!isPlayer(p.from) || !p.to?.id || !VILLAGERS.includes(p.to.id)) return;
        const id = p.to.id;
        if (this.grievances[id] || (this.entity(id)?.opinionOfPlayer ?? 50) < 30) this.amend(id, 'gift');
        if (p.itemId !== 'coin') this.addRumor('gift', { victim: id, witnesses: [id] });
        return;
      }
      case 'companionship_changed': {
        const lyra = g?.companion;
        const near = lyra ? this.witnessesNear(lyra.x, lyra.y, 200) : [];
        const was = p.previous;
        // 'apart' is her own plans for the day, nobody's news; leaving is.
        if (p.state === 'gone') this.addRumor('lyra_gone', { witnesses: ['lyra', ...near], source: 'lyra', about: 'lyra' });
        else if (p.state === 'left' && was !== 'gone') this.addRumor('lyra_left', { witnesses: ['lyra', ...near], source: 'lyra', about: 'lyra' });
        else if ((p.state === 'together' || p.state === 'wary') && (was === 'left' || was === 'gone')) this.addRumor('lyra_back', { witnesses: ['lyra', ...near], source: 'lyra', about: 'lyra' });
        return;
      }
      case 'room_rented':
        if (p.actor === g?.companion && ['left', 'gone'].includes(this.mind?.companionship)) this.addRumor('lyra_kettle', { witnesses: ['lyra', 'elda'], source: 'elda', about: 'lyra' });
        return;
      case 'quest': {
        if (p.stage === 2 || p.stage === 'asked') this.addRumor('maren_asking', { witnesses: ['aveline'] });
        else if (p.stage === 3 || p.stage === 'key') this.addRumor('ruins_key', { witnesses: [] });
        return;
      }
      case 'enter_location':
        if (isPlayer(p.actor)) this.atDoor(p.location);
        return;
      case 'new_day':
        return this.morning();
      default:
    }
  }

  // The player walks into a place they are barred from: someone there says so.
  atDoor(location) {
    const id = location?.id || location;
    const loc = typeof location === 'object' ? location : null;
    const bar = this.barred(id) || (loc?.parent ? this.barred(loc.parent) : null);
    if (!bar) return;
    const g = this.game;
    const rt = g?.time ?? 0;
    if (rt - this.barSaidAt < 25) return;
    this.barSaidAt = rt;
    const p = g?.player;
    const who = ['elda', bar.by, 'wys', 'rowan'].map((x) => this.entity(x)).find((e) => e && this.awake(e) && dist(e, p) < 220);
    const line = who ? say(TO_YOU[who.id]?.barred || TO_YOU.elda.barred, who.id, 'player', { rng: this.rng() }) : null;
    if (who && line) {
      safe(() => who.faceToward?.(p.x, p.y));
      safe(() => who.say(line, { target: p, kind: 'say' }));
    }
    const days = bar.daysLeft >= 1.5 ? 'a couple of days' : 'a day or so';
    safe(() => g?.ui?.toast?.(`You're not welcome at the Kettle for ${days}. Amends might shorten it.`, 'warn', { key: 'village_bar' }));
  }

  // Each morning households pass on what they heard: the news reaches kin overnight. And
  // those still raw about a grave wrong stay so: they will not trade or chat while it is
  // fresh (the villagers' own wronged/cold day marks, which dialogue and shops honour).
  morning() {
    const day = this.day();
    for (const [id, g] of Object.entries(this.grievances)) {
      const e = this.entity(id);
      if (!e || this.now() - g.t > DAY * 2) continue;
      if (g.grave && g.weight >= 8) e.wrongedDay = day;
      else if (g.weight >= 6) e.coldDay = day;
    }
    for (const r of this.rumors.list) {
      if (this.now() - r.t > DAY * 3) continue;
      for (const id of [...r.heardBy]) {
        if (!VILLAGERS.includes(id)) continue;
        for (const kin of VILLAGERS) {
          if (kin === id || r.heardBy.includes(kin) || r.victim === kin) continue;
          if (!this.isFamily(id, kin)) continue;
          this.rumors.hear(r, kin, id, this.rng());
          this.onHeard(kin, r, id);
        }
      }
    }
  }

  // ------------------------------------------------------------------ the absent (DESIGN §28/§29)

  // Someone leaves the village's life: out of every routine; their errands fail and the
  // village notices, asks, searches and, by nightfall, says they are missing.
  // opts: { cause, seen: bool | [witness ids], at: { place, heading } | placeId, keepBody }
  markGone(id, opts = {}) {
    return this.game?.villageLife?.markGone?.(id, opts) ?? null;
  }

  markBack(id) {
    return this.game?.villageLife?.markBack?.(id) ?? false;
  }

  // ------------------------------------------------------------------ the player talking

  recentPlayerLines(npcId) {
    const s = new Set();
    for (const x of this.talks[npcId] || []) for (const l of x.they || []) s.add(l);
    return s;
  }

  // The freshest news about the player this villager carries and has not raised yet.
  playerNews(npcId) {
    const said = new Set(this.mentioned[npcId] || []);
    let best = null;
    for (const r of this.rumors.list) {
      if (!r.heardBy.includes(npcId) || said.has(r.id) || r.about !== 'player' || !r.you) continue;
      if (r.victim === npcId && r.valence > 0 && r.kind !== 'gift') continue; // they thank you instead
      if (this.now() - r.t > DAY * 3) continue;
      if (!best || r.severity > best.severity || (r.severity === best.severity && r.t > best.t)) best = r;
    }
    return best;
  }

  // A fact this villager would tell the player about a topic, at their familiarity.
  factFor(npc, topic) {
    const fam = (npc.familiarity ?? 0) + 10;
    const flags = this.game?.flags || {};
    for (const f of npc.profile?.facts || []) {
      if (!f || !f.text) continue;
      if (f.topic !== topic && !(topic && new RegExp(`\\b${topic.replace(/_/g, ' ')}`, 'i').test(f.text))) continue;
      if ((Number(f.minFamiliarity) || 0) > fam) continue;
      if (f.topic === 'secret' && !(f.revealFlag && flags[f.revealFlag])) continue;
      if (Array.isArray(f.hiddenFrom) && f.hiddenFrom.includes('player') && !(f.revealFlag && flags[f.revealFlag])) continue;
      if (npc.told?.has?.(f.id)) continue;
      const line = typeof f.say === 'string' && f.say ? f.say : null;
      if (!line || !speakable(line)) continue;
      return { id: f.id, line };
    }
    return null;
  }

  emitTopic(npc, topic) {
    this.emit('npc_topic', { npc, topic, player: this.game?.player || null });
  }

  // The player says anything to a villager. -> Promise<{ lines, mood?, options? }>
  async playerSays(npc, text) {
    const e = typeof npc === 'string' ? this.entity(npc) : npc;
    const said = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    if (!e || !e.profile) return { lines: ['...'], mood: null };
    if (!said) return { lines: [say(voiceOf(e.id)?.short, e.id, 'player', { rng: this.rng() }) || 'Hm?'], mood: null };
    const local = safe(() => localReply(this, e, said), null) || { lines: ['Hm.'], mood: null, delta: 0, intent: 'unknown', told: [], mentioned: [] };
    let reply = { lines: local.lines, mood: local.mood, delta: local.delta, told: local.told || [], mentioned: local.mentioned || [], source: 'local' };
    const provider = this.provider();
    const asleep = e.state === 'sleep' || e.activity === 'sleep';
    if (provider && !asleep) {
      const r = await this.askClaude(provider, VILLAGER_RULES, buildSayTask(this.sayBrief(e, said, local)), SAY_SCHEMA, 'say');
      const c = coerceSay(r);
      if (c) {
        // Threats and insults weigh what they weigh, whoever words the answer.
        // (An apology mends through amend(), slowly, whatever Claude makes of it.)
        const delta = local.intent === 'threat' || local.intent === 'insult' ? Math.min(local.delta, c.opinionDelta) : local.intent === 'apology' ? 0 : c.opinionDelta;
        reply = { lines: [c.say], mood: c.mood || local.mood, delta, told: c.learned.filter((id) => (e.profile.facts || []).some((f) => f.id === id)), mentioned: c.rumorTold && this.rumors.get(c.rumorTold) ? [c.rumorTold] : [], source: 'claude', rumor: c.rumor };
      }
    }
    this.afterPlayerSays(e, said, local, reply);
    return { lines: reply.lines, mood: reply.mood || null };
  }

  afterPlayerSays(e, said, local, reply) {
    const g = this.game;
    const id = e.id;
    if (reply.delta) e.adjustOpinion?.(round1(reply.delta), `the player said: ${said.slice(0, 40)}`);
    if (local.intent === 'apology') this.amend(id, 'apology');
    if (local.intent === 'threat') this.addRumor('threat', { victim: id, witnesses: [id, ...this.witnessesNear(e.x, e.y, 90)] });
    // Something said that they will repeat (Claude's judgement, only when it moved them).
    if (reply.rumor && Math.abs(reply.delta || 0) >= 3) {
      const r = this.rumors.add({ kind: 'said', text: reply.rumor, valence: Math.sign(reply.delta) * 0.3, severity: 0.3, source: id, heardBy: [id], t: this.now(), day: this.day() });
      if (r) this.emit('rumor', { rumor: r });
    }
    for (const fid of reply.told || []) e.told?.add?.(fid);
    if (reply.mentioned?.length) {
      const m = (this.mentioned[id] ||= []);
      for (const r of reply.mentioned) if (!m.includes(r)) m.push(r);
      if (m.length > 20) m.splice(0, m.length - 20);
    }
    // They get to know the player a little with each exchange (a few points a day).
    const day = this.day();
    const f = this.famDay[id];
    const n = f && f.day === day ? f.n : 0;
    if (n < 8 && Number.isFinite(e.familiarity)) {
      e.familiarity = clamp(e.familiarity + 1.5, 0, 100);
      this.famDay[id] = { day, n: n + 1.5 };
    }
    const list = (this.talks[id] ||= []);
    list.push({ t: Math.round(this.now()), day, you: said.slice(0, 160), they: reply.lines.map((l) => String(l).slice(0, 200)).slice(0, 3) });
    if (list.length > TALK_CAP) list.splice(0, list.length - TALK_CAP);
    if (e.talkingUntil !== undefined) e.talkingUntil = Math.max(e.talkingUntil ?? 0, this.now() + 8);
    this.overheard(e, said, local, reply);
  }

  // Lyra hears it if she is near: kindness to her people warms her, cruelty does not.
  overheard(e, said, local, reply) {
    const g = this.game;
    const lyra = g?.companion;
    const mind = lyra?.mind;
    if (!mind || !alive(lyra) || dist(lyra, g?.player) > 110) return;
    safe(() => mind.noticeText?.(said, { source: 'overheard', amount: 0.3 }));
    const loves = this.loves('lyra', e.id, 50);
    const n = this.name(e.id);
    const P = g?.settings?.playerName || 'the stranger';
    const rels = mind.relationships;
    const adj = (ch, why) => rels?.get?.('player') && safe(() => rels.adjust('player', ch, why));
    switch (local.intent) {
      case 'threat':
        adj({ affinity: -4, trust: -5 }, `Threatened ${n}`);
        safe(() => mind.remember?.(`${P} threatened ${n}. I heard it.`, { importance: 6, about: ['player', e.id], tags: ['overheard', 'threat'], type: 'event', emotion: 'anger' }));
        safe(() => mind.feel?.('anger', loves ? 0.5 : 0.3, `${P} threatened ${n}`));
        break;
      case 'insult':
        adj({ affinity: loves ? -2 : -1 }, `Was rude to ${n}`);
        if (loves) safe(() => mind.feel?.('anger', 0.2, `${P} was rude to ${n}`));
        break;
      case 'apology':
        adj({ trust: 1 }, `Apologised to ${n}`);
        safe(() => mind.remember?.(`${P} said sorry to ${n}. I heard it.`, { importance: 4, about: ['player', e.id], tags: ['overheard', 'apology'], type: 'event' }));
        break;
      case 'compliment':
      case 'thanks':
      case 'howare':
        if (loves) adj({ affinity: 0.5 }, `Was kind to ${n}`);
        break;
      default:
    }
  }

  sayBrief(e, said, local) {
    const g = this.game;
    const id = e.id;
    const st = this.standing(id);
    const facts = [];
    const fam = (e.familiarity ?? 0) + 10;
    for (const f of e.profile?.facts || []) {
      if (!f?.text || f.topic === 'secret') continue;
      if ((Number(f.minFamiliarity) || 0) > fam) continue;
      if (Array.isArray(f.hiddenFrom) && f.hiddenFrom.includes('player')) continue;
      const text = f.say || f.text;
      if (!speakable(text)) continue;
      facts.push({ id: f.id, text });
      if (facts.length >= 6) break;
    }
    const rumors = this.rumors
      .carriedBy(id)
      .filter((r) => this.now() - r.t < DAY * 4)
      .slice(-4)
      .map((r) => ({ id: r.id, text: r.about === 'player' ? `(about the player) ${this.rumorForPlayer(r, id) || ''}` : this.rumors.render(r, id, { stranger: 'the stranger' }) || '' }))
      .filter((r) => r.text && speakable(r.text));
    let standing = '';
    if (st.grievance?.fresh) standing = `You have heard the player ${st.grievance.kind.replace(/_/g, ' ')}${st.grievance.victim ? ` (${this.name(st.grievance.victim)})` : ''}. ${st.grievance.grave ? 'You love the one they hurt; you are cold and angry with them, and amends move you only a little.' : 'You are wary of them.'}`;
    if (this.barred('ember_kettle') && ['elda', 'rowan', 'wys'].includes(id)) standing += ' The player is barred from the Ember Kettle for now.';
    // Their real day (DESIGN §28): an errand gone wrong, someone missing.
    const life = safe(() => g?.villageLife?.situation?.(id), null);
    if (life) standing += ` Right now, in your own words: "${life}" (This is what is wrong today; say so if asked, and do not invent more.)`;
    const lyra = g?.companion;
    const lyraState = safe(() => lyra?.mind?.companionship, null);
    const loc = safe(() => g?.locations?.at?.(e.x, e.y));
    const voice = voiceOf(id);
    const week = WEEK_TOPICS.map((k) => topicPool(id, k)?.[0]).filter((l) => l && !/\{/.test(l)).slice(0, 2);
    return {
      id,
      profile: e.profile,
      opinion: st.opinion,
      opinionLabel: st.label.toLowerCase(),
      familiarity: e.familiarity ?? 0,
      playerName: g?.settings?.playerName || '',
      stranger: voice?.stranger,
      facts,
      rumors,
      history: (this.talks[id] || []).slice(-4).map((x) => ({ you: x.you, they: (x.they || []).join(' ') })),
      place: loc?.name || '',
      time: g?.clock?.timeString?.() || '',
      weather: g?.clock?.weather?.type || '',
      week,
      lyra: lyraState ? `travelling with the player: ${lyraState === 'together' ? 'yes' : 'no'} (${lyraState}).` : '',
      standing,
      text: said,
      local: local.lines?.[0] || '',
    };
  }

  // ------------------------------------------------------------------ listening in

  // The conversation playing near the player, if any.
  canListen() {
    const g = this.game;
    const p = g?.player;
    if (!p) return null;
    const c = this.playing?.conv || (this.lastNear && (g.time ?? 0) - this.lastNear.t < 12 ? this.lastNear.conv : null);
    if (!c) return null;
    const a = this.entity(c.a);
    const b = this.entity(c.b);
    if (!alive(a) || !alive(b) || dist(a, b) > 130) return null;
    if (dist(a, p) > SEEN && dist(b, p) > SEEN) return null;
    return { id: c.id, a: c.a, b: c.b, topic: c.topic, summary: c.summary };
  }

  // The player listens in: the next exchange between those two, 4–8 lines.
  async listenIn(conv) {
    const c = conv && typeof conv === 'object' ? conv : this.canListen();
    if (!c) return [];
    const aId = typeof c.a === 'object' ? c.a.id : c.a;
    const bId = typeof c.b === 'object' ? c.b.id : c.b;
    if (!VOICES[aId] || !VOICES[bId]) return [];
    this.stopPlaying();
    let lines = null;
    let source = 'local';
    const provider = this.provider();
    if (provider) {
      const brief = this.listenBrief(aId, bId, c);
      const r = await this.askClaude(provider, VILLAGER_RULES, buildListenTask(brief), LINES_SCHEMA, 'listen');
      lines = coerceLines(r, [aId, bId], { min: 3, max: 8 });
      if (lines) source = 'claude';
    }
    let conv2;
    if (lines) conv2 = aId === 'lyra' || bId === 'lyra' ? this.lyraConverse(aId === 'lyra' ? bId : aId, { lines, topic: c.topic, lyraFirst: lines[0].speaker === 'lyra', onScreen: false, source }) : this.converse(aId, bId, { lines, topic: c.topic, onScreen: false, source });
    else conv2 = this.localListen(aId, bId);
    if (!conv2) return [];
    this.play(conv2);
    return conv2.lines.map((l) => ({ speaker: l.speaker, name: this.name(l.speaker), text: l.text }));
  }

  // Two exchanges back to back, so the player hears a real stretch of talk.
  localListen(aId, bId) {
    if (aId === 'lyra' || bId === 'lyra') {
      const other = aId === 'lyra' ? bId : aId;
      const first = this.lyraConverse(other, { onScreen: false, maxLines: 4, continuing: true, noBye: true });
      const second = this.lyraConverse(other, { onScreen: false, maxLines: 4, lyraFirst: false, continuing: true });
      return mergeConvs(first, second, this);
    }
    const ctx = this.talkCtx({ a: aId, b: bId });
    const t1 = chooseTopic(ctx, bId, aId);
    const first = this.converse(bId, aId, { topic: t1, onScreen: false, maxLines: 4, continuing: true, noBye: true });
    this.pairAt.delete(pairKey(aId, bId));
    const second = this.converse(aId, bId, { onScreen: false, maxLines: 4, continuing: true });
    return mergeConvs(first, second, this);
  }

  listenBrief(aId, bId, c) {
    const g = this.game;
    const bd = this.bond(aId, bId);
    const back = this.bond(bId, aId);
    const tag = mainTag(bd);
    const news = [...this.rumors.tellable(aId, bId, this.now()), ...this.rumors.tellable(bId, aId, this.now())]
      .slice(0, 2)
      .map((r) => this.rumors.render(r, aId, { stranger: 'the stranger' }))
      .filter(Boolean)
      .map((s) => `${s}.`);
    const a = this.entity(aId);
    const loc = safe(() => g?.locations?.at?.(a.x, a.y));
    const just = (this.log.find((x) => x.id === c.id)?.lines || []).slice(-3).map((l) => ({ speaker: l.speaker, text: l.text }));
    return {
      a: { id: aId, profile: this.entity(aId)?.profile || { name: this.name(aId) } },
      b: { id: bId, profile: this.entity(bId)?.profile || { name: this.name(bId) } },
      bond: `${this.name(aId)} on ${this.name(bId)}: ${tag ? `${tag}, ` : ''}${bd?.note || ''} (affinity ${Math.round(bd?.affinity ?? 0)}). ${this.name(bId)} on ${this.name(aId)}: ${mainTag(back) || ''} ${back?.note || ''}`.trim(),
      place: loc?.name || '',
      time: g?.clock?.timeString?.() || '',
      weather: g?.clock?.weather?.type || '',
      news,
      topic: topicLabel(c.topic),
      playerName: g?.settings?.playerName || '',
      lines: just,
      min: 4,
      max: 8,
    };
  }

  // ------------------------------------------------------------------ always-on mode

  ambientClaudeOk() {
    const g = this.game;
    if (g?.settings?.villageAi !== 'always' || this.claudeBusy) return false;
    if ((g.time ?? 0) - this.ambientAt < AMBIENT_CLAUDE_GAP) return false;
    const p = this.provider();
    return !!p && p.id === 'api';
  }

  ambientClaude(a, b) {
    const g = this.game;
    const provider = this.provider();
    if (!provider || provider.id !== 'api') return null;
    this.ambientAt = g.time ?? 0;
    const conv = { id: -1, a: a.id, b: b.id, topic: null };
    this.pairAt.set(pairKey(a.id, b.id), this.now());
    this.askClaude(provider, VILLAGER_RULES, buildListenTask(this.listenBrief(a.id, b.id, conv)), LINES_SCHEMA, 'ambient')
      .then((r) => {
        const lines = coerceLines(r, [a.id, b.id], { min: 2, max: 6 });
        if (!lines || !this.awake(a) || !this.awake(b) || dist(a, b) > 120 || this.playing) return;
        const c = this.converse(a.id, b.id, { lines, onScreen: this.onScreen(a) || this.onScreen(b), source: 'claude' });
        return c;
      })
      .catch((err) => console.warn('[village] ambient talk failed', err));
    return conv;
  }

  // ------------------------------------------------------------------ while you slept

  async nightSummary(day = this.day()) {
    const local = this.localNight(day);
    const provider = this.provider();
    if (!provider || local.length < 2) return local;
    const r = await this.askClaude(provider, VILLAGER_RULES, buildNightTask({ day, lines: local }), NIGHT_SCHEMA, 'night');
    return coerceNight(r) || local;
  }

  localNight(day) {
    const out = [];
    const rng = this.rng();
    const today = this.log.filter((c) => c.day === day || (c.day === day + 1 && c.t % DAY < 7 * HOUR));
    // What spread: news about the player first.
    const spread = this.rumors.list.filter((r) => r.day === day || (r.day === day - 1 && r.heardBy.length > 2)).sort((a, b) => b.severity - a.severity);
    for (const r of spread.slice(0, 2)) {
      const clause = this.rumorForPlayer(r);
      if (!clause) continue;
      const n = r.heardBy.filter((x) => x !== 'player' && x !== r.victim).length;
      const how = n >= 12 ? 'by nightfall the whole village had heard' : n >= 5 ? `by nightfall ${n} people had heard it` : n >= 2 ? `${n} people had heard it by supper` : 'not many have heard it yet';
      out.push(cap(`word went round that ${clause}; ${how}.`));
    }
    // Lyra's day among her people.
    const lyraTalks = today.filter((c) => c.a === 'lyra' || c.b === 'lyra');
    if (lyraTalks.length) {
      const with_ = [...new Set(lyraTalks.map((c) => (c.a === 'lyra' ? c.b : c.a)))];
      const parents = with_.filter((x) => x === 'hobb' || x === 'wenna');
      const L = this.name('lyra');
      if (parents.length === 2) out.push(`${L} spent part of the day with her parents, Hobb and Wenna, at the chandlery.`);
      else if (with_.length) out.push(`${L} stopped to talk with ${listNames(with_.slice(0, 3).map((x) => this.name(x)))}.`);
    }
    // Fallings out and warm moments.
    const notable = today.filter((c) => c.a !== 'lyra' && c.b !== 'lyra' && c.topic !== 'small' && c.topic !== 'rumor');
    const scenes = notable.filter((c) => scenesFor(c.a, c.b).length);
    const pairs = new Set();
    for (const c of [...scenes, ...notable]) {
      const k = pairKey(c.a, c.b);
      if (pairs.has(k) || out.includes(c.summary)) continue;
      pairs.add(k);
      out.push(c.summary);
      if (out.length >= 5 || pairs.size >= 3) break;
    }
    const bar = this.barred('ember_kettle');
    if (bar) out.push(`${bar.by === 'elda' ? 'Elda' : 'The watch'} won't have you at the Ember Kettle for ${bar.daysLeft >= 1.5 ? 'a couple of days' : 'a day or so'}.`);
    // A quiet day still has its talk.
    const fillers = NIGHT_FILLERS.filter((l) => !out.includes(l));
    while (out.length < 3 && fillers.length) out.push(fillers.splice(Math.floor(rnd(rng) * fillers.length), 1)[0]);
    return out.slice(0, 6).filter((l) => speakable(l));
  }

  // ------------------------------------------------------------------ Claude

  provider() {
    return safe(() => this.game?.brain?.providers?.current?.(), null) || null;
  }

  async askClaude(provider, rules, task, schema, kind) {
    if (!provider) return null;
    this.calls[kind] = (this.calls[kind] || 0) + 1;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => {
        ctrl?.abort?.();
        resolve(null);
      }, CLAUDE_TIMEOUT_MS);
    });
    if (kind === 'ambient') this.claudeBusy = true;
    try {
      const call = Promise.resolve().then(() => provider.complete({ rules, task, schema, tier: 'quick', signal: ctrl?.signal, maxTokens: 900 }));
      return await Promise.race([call, late]);
    } catch (err) {
      if (err?.code !== 'cancelled') console.warn(`[village] Claude (${kind}) failed`, err?.code || err);
      return null;
    } finally {
      clearTimeout(timer);
      if (kind === 'ambient') this.claudeBusy = false;
    }
  }

  // ------------------------------------------------------------------ Lyra's prompt

  promptContext() {
    const bits = [];
    const P = this.game?.settings?.playerName || 'the stranger';
    const known = this.rumors.list.filter((r) => r.heardBy.includes('lyra') && this.now() - r.t < DAY * 3 && r.source !== 'lyra').slice(-3);
    if (known.length) bits.push(`Village news she has heard (hearsay): ${known.map((r) => this.rumors.render(r, 'narrator', { stranger: P })).filter(Boolean).join('; ')}.`);
    const talked = this.log.filter((c) => (c.a === 'lyra' || c.b === 'lyra') && c.day === this.day()).map((c) => this.name(c.a === 'lyra' ? c.b : c.a));
    if (talked.length) bits.push(`Today she talked with ${listNames([...new Set(talked)].slice(0, 4))}.`);
    const ops = this.villagers().map((e) => e.opinionOfPlayer).filter(Number.isFinite);
    if (ops.length) {
      const avg = ops.reduce((s, x) => s + x, 0) / ops.length;
      const parents = ['hobb', 'wenna'].map((x) => this.entity(x)?.opinionOfPlayer).filter(Number.isFinite);
      const pAvg = parents.length ? parents.reduce((s, x) => s + x, 0) / parents.length : null;
      bits.push(`The village thinks of ${P}: ${feel(avg)}${pAvg != null ? `; her parents: ${feel(pAvg)}` : ''}.`);
    }
    if (this.barred('ember_kettle')) bits.push(`${P} is barred from the Ember Kettle for now.`);
    let s = bits.join(' ');
    if (s.length > 480) s = `${s.slice(0, 477)}…`;
    return s;
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    const cut = this.log.length - 20;
    return {
      v: 1,
      bonds: this.bonds.serialize(),
      rumors: this.rumors.serialize(),
      log: this.log.map((c, i) => {
        const o = { id: c.id, t: c.t, day: c.day, a: c.a, b: c.b, topic: c.topic, summary: c.summary };
        if (i >= cut && c.lines) o.lines = c.lines;
        if (c.effects?.rumor) o.rumor = c.effects.rumor;
        return o;
      }),
      talks: this.talks,
      mentioned: this.mentioned,
      bars: this.bars,
      grievances: this.grievances,
      amends: this.amendsDay,
      scenes: this.sceneDay,
      seq: this.seq,
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.bonds.deserialize(d.bonds);
    this.rumors.deserialize(d.rumors);
    this.log = Array.isArray(d.log)
      ? d.log
          .filter((c) => c && typeof c.a === 'string' && typeof c.b === 'string')
          .slice(-LOG_CAP)
          .map((c) => ({ id: c.id, t: Number(c.t) || 0, day: Number(c.day) || 1, a: c.a, b: c.b, topic: String(c.topic || 'small'), summary: String(c.summary || ''), lines: Array.isArray(c.lines) ? c.lines.filter((l) => l && typeof l.text === 'string') : undefined, effects: c.rumor ? { rumor: c.rumor } : {} }))
      : [];
    this.talks = objOf(d.talks);
    this.mentioned = objOf(d.mentioned);
    this.bars = objOf(d.bars);
    this.grievances = objOf(d.grievances);
    this.amendsDay = objOf(d.amends);
    this.sceneDay = objOf(d.scenes);
    this.seq = Number.isFinite(d.seq) ? d.seq : this.log.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
    for (const c of this.log) this.pairAt.set(pairKey(c.a, c.b), c.t);
  }
}

// ---------------------------------------------------------------------- helpers

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function objOf(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : {};
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function feel(o) {
  return o < 15 ? 'hostile' : o < 30 ? 'wary' : o < 50 ? 'neutral' : o < 75 ? 'friendly' : 'fond';
}

export function topicLabel(topic) {
  const L = { small: 'small talk', howare: 'how they are', far_lamps: 'the far lamps', well_cap: 'the well-cap', own: 'this and that', stranger: 'the stranger', stone: 'the stone question', rumor: 'village news' };
  return L[topic] || String(topic || '').replace(/_/g, ' ');
}

function mergeConvs(first, second, v) {
  if (!first) return second;
  if (!second) return first;
  const lines = [];
  for (const l of [...first.lines, ...second.lines]) {
    const last = lines[lines.length - 1];
    if (last && last.speaker === l.speaker) {
      if (last.text.length + l.text.length < 170) last.text = `${last.text} ${l.text}`;
      continue;
    }
    lines.push({ ...l });
  }
  lines.splice(8);
  // Present the stretch as one conversation, keeping both in the log.
  return { ...second, lines, summary: second.summary };
}

function pickAt(list, rng) {
  return list[Math.floor(rnd(rng) * list.length)];
}

// A fact as the villager says it: their own words when the profile has them.
function spokenFact(f, npc) {
  const s = typeof f.say === 'string' && f.say ? f.say : null;
  if (s && speakable(s)) return s;
  const t = String(f.text || '');
  // Facts are written about the person ("Bram lost his wife Hanna..."): only use those
  // that read naturally when spoken as they are.
  if (/^(i|i'm|my|we|our)\b/i.test(t) && speakable(t)) return t;
  return null;
}

const LEARNABLE = new Set(['maren', 'bandits', 'ruins', 'village']);

const ON_MY_MIND = ['Can I tell you what\u2019s on my mind?', 'I keep thinking about something.', 'Something\u2019s been going round my head all day.'];

const LYRA_ASKS = {
  family: ['How are your people, {n}?', "{n}, you never talk about family. Go on. I'm nosy."],
  work: ["What's keeping you busy, {n}?", "How's the work, {n}? Truly."],
  village: ["What's the news, {n}? Don't spare me.", "Tell me something I don't know about this village, {n}."],
  maren: ['{n}, did Maren ever say anything to you? Anything at all?'],
  default: ["Tell me something I don't know, {n}.", "{n}. What's on your mind? You've a look."],
};

const LYRA_HEARS = {
  family: ['Thank you for telling me.', "I didn't know that. I'm glad I do."],
  work: ['Huh. Eleven out of ten for that.', "That's good work. I mean it."],
  village: ["Wicks and ashes. I'll keep my ears open.", 'Huh. This valley keeps surprising me.'],
  default: ["Huh. I'll remember that.", 'Well. I never.', "That's worth knowing."],
  low: ['Mm. Thank you.', "I'll remember."],
};

const NIGHT_FILLERS = [
  'Hobb lit every lamp on the round, slowly, and nobody mentioned the far ones on the lane.',
  'Corran and Hobb played stones at the Kettle; both claim the game.',
  'Petra took two more bets on Hess and Sabeth joining flames. Nobody has asked Hess.',
  'Tobias fretted about the last sheaf and the rain, and apologised to the wheat.',
  'Pip put up another notice about Biscuit, who is not lost.',
  'Elda kept the kettle on late, and the common room was loud with talk of the Sheaf Moot dance.',
  'Bram worked the well-cap hinge, and grumbled about children sitting on it.',
];
