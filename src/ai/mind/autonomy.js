import { PLAYER_ID, COMPANION_ID, DAY_SECONDS, TILE } from '../../core/constants.js';
import { factionRelation } from '../../entities/entity.js';
import { itemDef, itemName } from '../../entities/items.js';
import { normalizeArgs } from '../brain/actions.js';
import { resolveEntity, resolveLocation } from '../resolve.js';
import { DEEDS, DEED_KINDS, DEED_REPEAT_WINDOW, HARMLESS_SPECIES, PET_SPECIES, SAFE_PLACES, STATES, T, COIN_JOBS, PRICES, DEFAULT_GIFT_TASTES } from './autonomy_data.js';
import { LinePicker } from './autonomy_lines.js';
import { analyzeRequest, requestKey } from './autonomy_consent.js';
import { buildPlan, blockAt, blockIndexAt, weighGoals, sleepSpot, questStageIndex, hourLabel, describeBlock, makeBlock } from './autonomy_agenda.js';
import { RE, isApology, parseOffer, parsePromiseText, parseAskText } from './autonomy_words.js';

// Lyra's own will (DESIGN §16). She lives for herself: she keeps her own day, her own
// coin and her own counsel; she watches what the player does (the ledger), decides
// whether she still wants to travel with them (companionship), and weighs every order
// as a request (evaluateRequest). The Mind owns one: `mind.autonomy = new Autonomy(mind, game)`.
//
// Interface (DESIGN §16, the Mind exposes these as delegates):
//   companionship                 'together' | 'wary' | 'apart' | 'left' | 'gone'
//   agenda                        { goals: [{id, text, weight}], today: [{from, to, activity, at, why, ...}], purse, sleepAt }
//   ledger                        [{ t, day, deed, severity, text, victimId }]
//   promises                      [{ id, text, by: 'player'|'lyra', state: 'open'|'kept'|'broken', due, kind, params }]
//   update(dt)                    plans, promise deadlines, periodic reconsider()
//   evaluateRequest(req)          req = { action, args, source, pay?, preview? } -> verdict (DESIGN §16.4)
//   recordDeed(deed, opts)        opts = { severity, text, victim }; adjusts the relationship, remembers, reconsiders
//   reconsider(reason)            re-evaluate the companionship state
//   setCompanionship(state, why)  sets the state, emits companionship_changed, tells behavior what to do
//   planDay()                     rebuild agenda.today
//   serialize() / deserialize(d)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const NEG_INF = -Infinity;
const DEFAULT_PERSONALITY = { openness: 0.85, conscientiousness: 0.55, extraversion: 0.65, agreeableness: 0.7, neuroticism: 0.4 };
const LEAVING_TYPES = new Set(['independent', 'keep_away', 'leave', 'flee', 'wait_outside']);
const START_PURSE = 8; // a ranger's pocket money on the first morning
const LEFT_TILES = 10; // how far she keeps from the player once she has left them
const OBSERVED_DEEDS = new Set(['lied', 'kindness', 'stole']);

// Why her state changed: what she tells the player, and what she remembers.
const CAUSES = {
  start: { reason: 'I chose to travel with you. I owe you for the wolves, and I’m curious about you.' },
  hit: { reason: 'You struck me with your sword, on purpose.', memo: '{P} struck me with their sword, on purpose. I am keeping my distance now.' },
  hit_again: { reason: 'You struck me with your sword. Twice. I don’t stay with someone who does that.', memo: '{P} struck me again. I bound them with light and got clear. I am done traveling with them.' },
  villager: { reason: 'You attacked {target}.', memo: '{P} attacked {target}. I never thought I would have to watch them like that.' },
  villager_again: { reason: 'You attacked {target} after I warned you. I won’t stand beside someone who hurts the people here.', memo: '{P} attacked {target} again, after my warning. I bound them and called the guards. We are finished.' },
  villager_down: { reason: 'You beat {target} until they dropped. I won’t stand beside someone who does that.', memo: '{P} beat {target} until they dropped. I bound them and called the guards. We are finished.' },
  villager_gone: { reason: 'You beat {target} senseless — someone I care about.', memo: '{P} beat {target} senseless. I am leaving, for good.' },
  downed: { reason: 'You knocked me out. There is no coming back from that.', memo: '{P} knocked me out. I am leaving Hearthvale, and them, for good.' },
  violence: { reason: 'I warned you, more than once, and you kept hurting people.', memo: 'I warned {P} again and again, and they kept hurting people. I am leaving, for good.' },
  trust: { reason: 'I don’t trust you the way I did.', memo: 'I don’t trust {P} the way I did. I’m keeping my distance.' },
  fear: { reason: 'You frighten me, these days.', memo: '{P} frightens me now. I’m keeping my distance.' },
  trust_left: { reason: 'I stopped trusting you. Too much happened, one thing after another.', memo: 'I stopped trusting {P}. I’m going my own way.' },
  fear_left: { reason: 'I’m afraid of you. Being near you isn’t safe for me.', memo: 'I am afraid of {P}. I left to keep myself safe.' },
  abandoned: { reason: 'You left me lying there, knocked out.', memo: '{P} left me lying knocked out. I am going my own way.' },
  plans: { reason: 'I have my own day to live. {why}' },
  dismissed: { reason: 'You told me to go and live my own life for a bit. So I am.', memo: '{P} gave me a day to myself.' },
  amends: { reason: 'I believe your apology. I’m just not ready to travel with you again — ask me, when you’re ready.', memo: 'I believe {P}’s apology. I am not running from them any more.' },
  recovered: { reason: 'I chose to travel with you, and I still do.', memo: 'I’ve decided {P} is all right after all. I’m done keeping my distance.' },
  invited: { reason: 'You asked me to come along, and I wanted to.' },
  rejoined: { reason: 'You made amends, and I chose to travel with you again.', memo: 'I chose to travel with {P} again. One more chance.' },
  back: { reason: 'My errands are done; I chose your company again.' },
  chose: { reason: '{why}' },
};

const FAREWELL_DIARY = {
  downed:
    'Day {day}. I’m writing this at the edge of Hearthvale with my head still ringing. {P} struck me down — the same hands that stood beside me against the wolves on the King’s Road. I keep trying to make it mean something else. It doesn’t. Maren always said a lamp is for the lost and fire is for the wicked, and that you learn which is which by watching what people do when they think it costs them nothing. I watched. I’m taking the King’s Road at first light. I’ll find Maren on my own. I’ve done harder things alone. I just didn’t think I’d have to.',
  villager:
    'Day {day}. {P} beat {target} until they couldn’t stand. I bound them with light and shouted for the guards, and my hands are still shaking. I was born in Hearthvale, and it’s mine. {P} isn’t part of it anymore. I’m going home to Mam and Da at the chandlery. Rowan has the key back, and the village knows what happened. Maren, if you’re out there: I’m still coming. Just not with them.',
  violence:
    'Day {day}. I warned {P}. More than once. Every time I hoped the last time was the last time. It wasn’t. I don’t hate them — I think that’s the worst of it. I’m leaving Hearthvale tonight by the King’s Road. Calm water ahead, I hope. There wasn’t much of it here at the end.',
  other:
    'Day {day}. I’m leaving {P} for good. I chose them once, on the King’s Road, and I’m choosing again now. Maren taught me that loyalty is earned slowly and kept forever — and that it can be spent. It’s spent. I’ll find her on my own.',
};

export class Autonomy {
  constructor(mind, game) {
    this.mind = mind || null;
    this.game = game || null;
    this.companionship = 'together';
    this.reason = CAUSES.start.reason;
    this._purse = START_PURSE;
    this.agenda = { goals: weighGoals({}), today: [], purse: 0, sleepAt: 'lyra_inn_bed', day: 0, revision: 0, morningIntent: null };
    // Her coin lives in her pack (like the player's gold); agenda.purse reads and writes it,
    // so whoever charges her (Elda's room) and whoever pays her see the same purse.
    Object.defineProperty(this.agenda, 'purse', {
      enumerable: true,
      configurable: true,
      get: () => this._readPurse(),
      set: (v) => this._writePurse(v),
    });
    this.ledger = [];
    this.promises = [];
    this.lines = new LinePicker();
    this._nextAsk = null;
    this._shadow = { id: PLAYER_ID, trust: T.startTrust, affinity: 25, respect: 25, familiarity: 15, fear: 0, tags: [] };
    this._init();
    this._off = game?.bus?.on?.('*', (type, payload) => this.onEvent(type, payload)) || null;
  }

  _init() {
    this.stateSince = this.now();
    this.stateDay = this.day();
    this.apartReason = null;
    this.apartDay = 0;
    this.warnings = 0;
    this.violence = []; // times of violent deeds
    this.lastViolentT = NEG_INF;
    this.lastDownedT = NEG_INF;
    this.grudge = 0; // trust lost to small slights, which fades
    this.violentDebt = 0; // trust lost to violence, which only amends can soften
    this.apology = null;
    this.brokenApologies = 0;
    this.questStage = 0;
    this.refusals = [];
    this.lastEval = null;
    this.pendingCounter = null;
    this.pendingRequest = null;
    this.pendingOffer = null;
    this.deals = [];
    this.huntOkUntil = NEG_INF;
    this.orderFight = { until: NEG_INF, attackMode: false, flagged: false, flaggedT: NEG_INF };
    this.watchUntil = NEG_INF;
    this.lastAcceptedT = NEG_INF;
    this.downed = null;
    this.hit = { lastT: NEG_INF, recordedT: NEG_INF };
    this.npcHits = new Map();
    this.recentAttackers = new Map();
    this.queued = [];
    this.lastSpokeT = NEG_INF;
    this.lastInitiativeT = NEG_INF;
    this.lastAnnounceT = NEG_INF;
    this.lastRespectT = NEG_INF;
    this.asked = {};
    this.meal = { day: -1, block: -1 };
    this.rentDay = -1;
    this.lastJobId = null;
    this._pendingBind = null;
    this.calibrated = false;
    this._heard = null;
    this._promiseSeq = 0;
    this._blockIdx = -2;
    this._deferIdx = -1;
    this._hourIdx = null;
    this._acc = 0;
    this._initT = 6;
    this._t = 0;
    this._lastStep = null;
    this._keepAwaySince = NEG_INF;
  }

  // ------------------------------------------------------------------ time and people

  now() {
    const t = this.game?.clock?.t;
    return Number.isFinite(t) ? t : this._t;
  }

  day() {
    const d = this.game?.clock?.day;
    return Number.isFinite(d) ? d : 1 + Math.floor(this._t / DAY_SECONDS);
  }

  hour() {
    const h = this.game?.clock?.hour;
    return Number.isFinite(h) ? h : 8;
  }

  sph() {
    return num(this.game?.clock?.secondsPerHour, DAY_SECONDS / 24);
  }

  daySeconds() {
    return this.sph() * 24;
  }

  lyra() {
    return this.mind?.owner || this.game?.companion || this.game?.entities?.get?.(COMPANION_ID) || null;
  }

  player() {
    return this.game?.player || this.game?.entities?.get?.(PLAYER_ID) || null;
  }

  behavior() {
    return this.lyra()?.behavior || this.game?.companion?.behavior || null;
  }

  playerName() {
    const n = this.game?.settings?.playerName || this.game?.player?.name;
    return n && !/^(player|you|someone)$/i.test(n) ? n : 'the traveler';
  }

  isPlayer(e) {
    return !!e && (e === this.player() || e.id === PLAYER_ID);
  }

  isLyra(e) {
    return !!e && (e === this.lyra() || e.id === COMPANION_ID);
  }

  isVillager(e) {
    return !!e && e.type === 'actor' && !this.isPlayer(e) && !this.isLyra(e) && (e.faction === 'villager' || e.faction === 'guard' || !!e.profile);
  }

  isGuard(e) {
    return !!e && e.faction === 'guard';
  }

  isHostile(e) {
    if (!e || this.isVillager(e) || this.isPlayer(e) || this.isLyra(e)) return false;
    if (factionRelation('player', e.faction) === 'hostile') return true;
    try {
      return !!this.mind?.relationships?.isEnemy?.(e);
    } catch {
      return false;
    }
  }

  isFriend(e) {
    try {
      const f = this.mind?.relationships?.isFriend;
      if (typeof f === 'function') return !!f.call(this.mind.relationships, e);
    } catch {
      /* fall through to factions */
    }
    return this.isPlayer(e) || this.isLyra(e) || this.isVillager(e);
  }

  relOf(id) {
    if (id == null) return null;
    try {
      return this.mind?.relationships?.get?.(id) || null;
    } catch {
      return null;
    }
  }

  hasTag(e, tag) {
    const rel = this.relOf(e?.id);
    return !!rel && Array.isArray(rel.tags) && rel.tags.includes(tag);
  }

  displayName(e) {
    if (!e) return '';
    if (typeof e === 'string') return this.npcName(e);
    if (this.isPlayer(e)) return 'you';
    if (e.profile || this.isVillager(e)) {
      const parts = String(e.name || e.id || '').replace(/^(captain|sister|brother|old)\s+/i, '').split(/\s+/);
      return parts[0] || e.id;
    }
    if (e.species) return `the ${String(e.species).replace(/_/g, ' ')}`;
    return e.name || e.id || 'it';
  }

  npcName(id) {
    if (!id) return '';
    const e = this.game?.entities?.get?.(id);
    if (e) return this.displayName(e);
    return String(id).charAt(0).toUpperCase() + String(id).slice(1);
  }

  resolveEntity(ref) {
    if (!ref || !this.game?.entities) return null;
    try {
      return resolveEntity(this.game, ref, this.lyra());
    } catch {
      return null;
    }
  }

  resolveLocation(ref) {
    if (!ref || !this.game?.locations) return null;
    try {
      return resolveLocation(this.game, ref);
    } catch {
      return null;
    }
  }

  locationAt(x, y) {
    try {
      return this.game?.locations?.at?.(x, y) || null;
    } catch {
      return null;
    }
  }

  inLocation(locId, e) {
    if (!e || !locId) return false;
    const loc = this.game?.locations?.get?.(locId);
    if (!loc?.bounds) return false;
    const b = loc.bounds;
    const tx = e.x / TILE;
    const ty = e.y / TILE;
    return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  }

  // Hostile creatures near a point, weighted by their threat and remaining health.
  threatsNear(x, y, r) {
    const out = { score: 0, count: 0 };
    const list = this.game?.entities?.all?.();
    if (!list) return out;
    const r2 = r * r;
    for (const e of list) {
      if (e.removed || e.type !== 'actor' || !e.isAlive?.()) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      if (!this._isHostileCreature(e)) continue;
      const hpf = e.maxHp ? clamp(e.hp / e.maxHp, 0.3, 1) : 1;
      out.score += (Number.isFinite(e.threat) ? e.threat : 1) * hpf;
      out.count += 1;
    }
    return out;
  }

  _isHostileCreature(e) {
    if (!e || this.isPlayer(e) || this.isLyra(e) || this.isVillager(e)) return false;
    const c = this.game?.combat;
    const l = this.lyra();
    if (l && typeof c?.isHostile === 'function') {
      try {
        if (c.isHostile(e, l) || c.isHostile(e, this.player() || l)) return true;
      } catch {
        /* fall back to factions */
      }
    }
    if (factionRelation('player', e.faction) === 'hostile') return true;
    // Wildlife counts only while it is fighting (a charging boar).
    return e.faction === 'wildlife' && (e.state === 'attack' || (e.lastAttackedAt > (this.game?.time ?? 0) - 6 && !!e.lastAttacker));
  }

  _hostileNear(actor, r) {
    if (!actor || !this.game?.entities?.nearest) return false;
    try {
      return !!this.game.entities.nearest(actor.x, actor.y, r, (e) => e.type === 'actor' && e.isAlive?.() && this._isHostileCreature(e));
    } catch {
      return false;
    }
  }

  countItem(id) {
    try {
      return this.lyra()?.inventory?.count?.(id) || 0;
    } catch {
      return 0;
    }
  }

  bestFood() {
    for (const id of ['honey_cake', 'bread', 'cooked_fish', 'stew', 'berries', 'turnip']) if (this.countItem(id) > 0) return id;
    return null;
  }

  playerHpFrac() {
    const p = this.player();
    return p?.maxHp ? clamp(p.hp / p.maxHp, 0, 1) : 1;
  }

  personality() {
    const p = this.mind?.soul?.personality;
    if (!p) return DEFAULT_PERSONALITY;
    return {
      openness: num(p.openness, 0.85),
      conscientiousness: num(p.conscientiousness, 0.55),
      extraversion: num(p.extraversion, 0.65),
      agreeableness: num(p.agreeableness, 0.7),
      neuroticism: num(p.neuroticism, 0.4),
    };
  }

  needs() {
    const n = this.mind?.needs || {};
    return { energy: num(n.energy, 0.8), hunger: num(n.hunger, 0.7), fun: num(n.fun, 0.6), social: num(n.social, 0.6), safety: num(n.safety, 0.9) };
  }

  // 2 loved, 1 liked, 0 polite, -1 disliked (the same reading as the mind's perception).
  giftTaste(itemId) {
    const soul = this.mind?.soul;
    const tastes = soul?.giftTastes;
    if (tastes && Number.isFinite(tastes[itemId])) return tastes[itemId];
    if (tastes && typeof tastes === 'object') return itemDef(itemId)?.type === 'food' ? 1 : 0;
    const name = String(itemDef(itemId)?.name || itemId).toLowerCase();
    const stem = name.replace(/s$/, '');
    const hit = (list) => (Array.isArray(list) ? list.findIndex((s) => String(s).toLowerCase().includes(stem)) : -1);
    const like = hit(soul?.likes);
    if (like >= 0) return like < 3 ? 2 : 1;
    if (hit(soul?.dislikes) >= 0) return -1;
    return DEFAULT_GIFT_TASTES[itemId] ?? 0;
  }

  // ------------------------------------------------------------------ feelings about the player

  playerRel() {
    const r = this.mind?.relationships;
    let rel = null;
    try {
      rel = r?.get?.(PLAYER_ID) || null;
      if (!rel && typeof r?.ensure === 'function') rel = r.ensure(this.player() || PLAYER_ID, { name: this.playerName(), kind: 'human' });
    } catch {
      rel = null;
    }
    return rel && Number.isFinite(rel.trust) ? rel : this._shadow;
  }

  stats() {
    const r = this.playerRel();
    return { trust: num(r.trust, T.startTrust), fear: num(r.fear, 0), affinity: num(r.affinity, 25), respect: num(r.respect, 25) };
  }

  adjustPlayer(changes, reason = '') {
    const r = this.mind?.relationships;
    const rel = this.playerRel();
    if (rel !== this._shadow && typeof r?.adjust === 'function') {
      try {
        r.adjust(PLAYER_ID, changes, reason);
        return;
      } catch (err) {
        console.error('[autonomy] relationship adjust failed', err);
      }
    }
    for (const k of ['trust', 'affinity', 'respect', 'familiarity', 'fear']) {
      const d = Number(changes[k]);
      if (!Number.isFinite(d) || !d) continue;
      this._shadow[k] = Math.round(clamp(this._shadow[k] + d, k === 'affinity' ? -100 : 0, 100) * 10) / 10;
    }
  }

  tone() {
    const s = this.stats();
    const e = this.mind?.emotions || {};
    const st = this.companionship;
    if (st === 'gone' || st === 'left') return s.fear > 45 || num(e.fear, 0) > 0.55 ? 'afraid' : 'cool';
    if (s.fear >= 35 || num(e.fear, 0) > 0.55) return 'afraid';
    if (this.needs().energy < 0.25) return 'tired';
    if (st === 'wary' || s.trust < T.waryTrust || num(e.anger, 0) > 0.45 || this.personality().agreeableness < 0.35) return 'cool';
    return 'warm';
  }

  line(key, vars = {}) {
    return this.lines.pick(key, this.tone(), vars);
  }

  // Everything a decision looks at, in one place.
  snapshot() {
    const s = this.stats();
    const n = this.needs();
    const l = this.lyra();
    const now = this.now();
    let mood = null;
    try {
      mood = this.mind?.mood?.() || null;
    } catch {
      mood = null;
    }
    const clock = this.game?.clock;
    const hour = this.hour();
    return {
      now,
      hour,
      day: this.day(),
      isNight: typeof clock?.isNight === 'boolean' ? clock.isNight : hour >= 20.5 || hour < 5,
      weather: clock?.weather?.type || 'clear',
      state: this.companionship,
      apartReason: this.apartReason,
      trust: s.trust,
      fear: s.fear,
      affinity: s.affinity,
      respect: s.respect,
      energy: n.energy,
      hunger: n.hunger,
      fun: n.fun,
      hpFrac: l?.maxHp ? clamp(l.hp / l.maxHp, 0, 1) : 1,
      hasPotion: this.countItem('potion') > 0,
      food: this.bestFood(),
      purse: this.purse(),
      valence: num(mood?.valence, 0.1),
      anger: num(this.mind?.emotions?.anger, 0),
      questStage: this.questStage,
      block: this.currentBlock(),
      directiveType: this.behavior()?.directive?.type || null,
      sleepAt: this.agenda.sleepAt,
      downedRecently: now - this.lastDownedT < this.daySeconds(),
      recklessRecently: this.ledger.some((e) => e.deed === 'reckless_order' && now - e.t < this.daySeconds()),
    };
  }

  // ------------------------------------------------------------------ events

  onEvent(type, p) {
    const payload = p || {};
    try {
      switch (type) {
        case 'damage':
          return this._onDamage(payload);
        case 'death':
          return this._onDeath(payload);
        case 'downed':
          return this._onDowned(payload);
        case 'revived':
          return this._onRevived(payload);
        case 'crime':
          return this._onCrime(payload);
        case 'item_given':
          return this._onItemGiven(payload);
        case 'job_done':
          return this._onJobDone(payload);
        case 'enter_location':
          return this._onEnter(payload);
        case 'quest':
          return this._onQuest(payload);
        case 'new_day':
          this._updateSleepAt();
          return this.planDay('new_day');
        case 'player_wake':
          return this.planDay('wake');
        case 'time_skip':
          return this._onTimeSkip(payload);
        case 'weather':
          if (payload.type === 'rain') this.planDay('weather');
          return undefined;
        case 'player_message':
          return this.hearPlayer(payload.text);
        case 'apology':
          return this._onApologyEvent(payload);
        case 'room_rented':
          return this._onRoomRented(payload);
        case 'stance_changed':
          if (payload.stance !== 'attack') this.orderFight.attackMode = false;
          return undefined;
        case 'game_start':
          if (!payload.loaded && !this.calibrated) this._calibrate();
          this.calibrated = true;
          if (!this.agenda.today.length) this.planDay('start');
          return undefined;
        default:
          return undefined;
      }
    } catch (err) {
      console.error(`[autonomy] ${type} failed`, err);
      return undefined;
    }
  }

  // A new game: she travels with the player because she owes them her life. That is
  // enough trust to travel together (§16.3), whatever the relationship seed says.
  _calibrate() {
    this.calibrated = true;
    const rel = this.playerRel();
    if (this.ledger.length === 0 && num(rel.trust, T.startTrust) < T.startTrust) this.adjustPlayer({ trust: T.startTrust - rel.trust }, '');
    if (this._readPurse() === 0) this._writePurse(START_PURSE);
  }

  _onDamage({ source, target }) {
    if (target && this.isLyra(target)) {
      if (source && this.isPlayer(source)) return this._playerHitLyra();
      if (source && source !== target && typeof source === 'object') this.recentAttackers.set(source, this.now());
      return this._checkReckless();
    }
    if (source && this.isPlayer(source) && target && this.isVillager(target)) {
      // A blow that knocks them out is recorded by the 'downed' that follows it.
      if (!(target.hp > 0)) return undefined;
      return this._playerHitNpc(target);
    }
    return undefined;
  }

  // §16.2: an accident if a hostile creature is within 48 px of her and it is the first
  // hit in 8 s; otherwise deliberate. Hits within one swing flurry count once.
  _playerHitLyra() {
    const now = this.now();
    const h = this.hit;
    if (now - h.recordedT < 1.2) {
      h.lastT = now;
      return;
    }
    const first = now - h.lastT > 8;
    h.lastT = now;
    h.recordedT = now;
    const accident = first && this._hostileNear(this.lyra(), 48);
    this.recordDeed(accident ? 'hit_lyra_accident' : 'hit_lyra');
  }

  _npcRec(id) {
    let rec = this.npcHits.get(id);
    if (!rec) {
      rec = { lastT: NEG_INF, recordedT: NEG_INF, warned: false, accidentUntil: NEG_INF, downedT: NEG_INF };
      this.npcHits.set(id, rec);
    }
    return rec;
  }

  _playerHitNpc(victim) {
    const now = this.now();
    const rec = this._npcRec(victim.id);
    if (now - rec.lastT < 0.25) return; // the damage and crime events of one blow
    if (now - rec.recordedT < 1.2) {
      rec.lastT = now;
      return;
    }
    const first = now - rec.lastT > 8;
    rec.lastT = now;
    if (first && this._hostileNear(victim, 48)) {
      rec.accidentUntil = now + 3;
      this.say(this.line('deed_hit_accident'), { minGap: 6 });
      return;
    }
    rec.recordedT = now;
    this.recordDeed(this.isGuard(victim) ? 'attacked_guard' : 'attacked_villager', { victim });
  }

  _villagerDowned(victim) {
    if (!victim) return;
    const now = this.now();
    const rec = this._npcRec(victim.id);
    if (now - rec.downedT < 5) return;
    rec.downedT = now;
    rec.recordedT = now;
    this.recordDeed('downed_villager', { victim });
  }

  _onCrime({ actor, victim, kind }) {
    if (!this.isPlayer(actor)) return;
    const k = String(kind || '').toLowerCase();
    if (k === 'knockout') return this._villagerDowned(victim);
    if (/^(theft|steal|stole|stealing)$/.test(k)) {
      this.recordDeed('stole', { victim });
      return;
    }
    if (!victim) return;
    const rec = this._npcRec(victim.id);
    const now = this.now();
    if (now - rec.recordedT < 3 || now < rec.accidentUntil) return;
    this._playerHitNpc(victim);
  }

  _onDowned({ entity, by }) {
    if (this.isLyra(entity)) {
      const now = this.now();
      this.lastDownedT = now;
      if (by && this.isPlayer(by)) {
        this.downed = { t: now, byPlayer: true, abandoned: true, waited: 0 };
        this.recordDeed('downed_lyra');
        return;
      }
      this.downed = { t: now, byPlayer: false, abandoned: false, waited: 0 };
      return;
    }
    if (by && this.isPlayer(by) && this.isVillager(entity)) this._villagerDowned(entity);
  }

  _onRevived({ entity, by }) {
    if (!this.isLyra(entity)) return;
    const d = this.downed;
    this.downed = null;
    if (d?.byPlayer) return this._comeTo(d);
    if (d && by && this.isPlayer(by)) this.recordDeed('revived_lyra');
    this._flushQueued();
    return undefined;
  }

  // She comes to after the player knocked her out (§16.6): she leaves, for good.
  _comeTo(d) {
    this._flushQueued();
    if (this.companionship !== 'gone') this._goGone('downed', 'to_gone_downed', { target: 'them' });
    return d;
  }

  // She notices when the player walks off (> 20 tiles) or waits 45 s without helping.
  _watchDowned(step) {
    const d = this.downed;
    const l = this.lyra();
    if (!d || !l) return;
    if (!l.downed) {
      // She got up on her own.
      this.downed = null;
      if (d.byPlayer) this._comeTo(d);
      else this._flushQueued();
      return;
    }
    if (d.abandoned || d.byPlayer) return;
    const p = this.player();
    if (!p || p.downed) return;
    d.waited += step;
    const far = Math.hypot(p.x - l.x, p.y - l.y) > 20 * TILE;
    if (far || d.waited > 45) {
      d.abandoned = true;
      this.recordDeed('abandoned_downed', { text: far ? 'Walked away while I lay knocked out.' : 'Left me lying knocked out.' });
    }
  }

  _onDeath({ entity, killer }) {
    if (!entity) return;
    const t = this.recentAttackers.get(entity);
    this.recentAttackers.delete(entity);
    if (!killer || !this.isPlayer(killer)) return;
    const species = String(entity.species || '').toLowerCase();
    const what = species ? species.replace(/_/g, ' ') : entity.name || 'thing';
    if (t != null && this.now() - t <= 10) {
      this.recordDeed('protected_lyra', { victim: entity, text: `Cut down the ${what} that was hurting me.` });
      return;
    }
    if (!HARMLESS_SPECIES.has(species)) return;
    if (this.now() < this.huntOkUntil && !PET_SPECIES.has(species) && species !== 'chicken') {
      this.remember(`We took a ${what} for the pot. Quick and clean, and I said thank you to it.`, { importance: 2, tags: ['hunt'] });
      return;
    }
    this.recordDeed('killed_harmless', { victim: entity, severity: PET_SPECIES.has(species) ? -2 : undefined, text: `Killed a ${what} that was no threat to anyone.` });
  }

  _onItemGiven({ from, to, itemId, qty }) {
    const n = Math.max(1, num(qty, 1));
    if (this.isPlayer(from) && this.isLyra(to)) return this._receiveFromPlayer(itemId, n);
    if (this.isPlayer(from) && to && this.isVillager(to)) {
      this.recordDeed('kindness', { victim: to, text: `Gave ${this.displayName(to)} ${itemName(itemId, n).toLowerCase()}.` });
    }
    return undefined;
  }

  _receiveFromPlayer(itemId, qty) {
    if (itemId === 'maren_journal') return;
    if (itemId === 'coin') {
      if (!this._inv()) this._purse += qty;
      let left = qty;
      let paid = false;
      for (const p of this.promises) {
        if (left <= 0) break;
        if (p.state !== 'open' || p.by !== 'player' || p.kind !== 'pay') continue;
        const need = Math.max(0, (p.params.amount || 0) - (p.params.paid || 0));
        const use = Math.min(need, left);
        p.params.paid = (p.params.paid || 0) + use;
        left -= use;
        if (p.params.paid >= p.params.amount) {
          this._resolvePromise(p, 'kept', { quiet: true });
          paid = true;
          this.say(this.line('deed_payment', { coins: p.params.amount }), { force: true });
        }
      }
      if (!paid && left >= 3) {
        this.recordDeed('gift_liked', { text: `Gave me ${left} coins.` });
        this.say(this.line('deed_coin_gift'), { minGap: 3 });
      }
      return;
    }
    for (const p of this.promises) {
      if (p.state !== 'open' || p.by !== 'player' || p.kind !== 'give' || p.params.itemId !== itemId) continue;
      p.params.got = (p.params.got || 0) + qty;
      if (p.params.got >= (p.params.qty || 1)) {
        this._resolvePromise(p, 'kept');
        return;
      }
    }
    const taste = this.giftTaste(itemId);
    const deed = taste >= 2 ? 'gift_loved' : taste === 1 ? 'gift_liked' : taste < 0 ? 'gift_disliked' : null;
    if (deed) this.recordDeed(deed, { text: `Gave me ${itemName(itemId, qty).toLowerCase()}.` });
  }

  _onJobDone({ actor, job, result }) {
    if (!this.isLyra(actor)) return;
    const jobId = typeof job === 'string' ? job : job?.id || job?.job || job?.type || null;
    const deal = this.deals.find((d) => d.kind === 'share' && (!d.job || d.job === jobId));
    if (deal) {
      this.deals.splice(this.deals.indexOf(deal), 1);
      if (result?.deliveredTo === 'player') this._takeShare(result);
    }
    // Her own work for coin while she lives her own day (§16.1): paid on delivery.
    const st = this.companionship;
    if (result?.deliveredTo === 'player' || result?.deliveredTo === 'chest') return;
    const b = this.currentBlock();
    const own = st === 'apart' || st === 'left' || (b?.type === 'work' && b.company !== 'player' && this.behavior()?.directive?.type === 'independent');
    if (!own) return;
    const buyer = result?.buyer || (typeof result?.deliveredTo === 'string' && result.deliveredTo !== 'keep' ? result.deliveredTo : null);
    const spec =
      COIN_JOBS.find((j) => j.job === jobId && (buyer ? j.npc === buyer : b?.jobId ? b.jobId === j.id : true)) ||
      (buyer ? null : COIN_JOBS.find((j) => j.job === jobId));
    if (spec || (buyer && result?.earned > 0)) this._getPaid(spec, result, buyer);
  }

  // "Half the wood is mine": after delivering, she takes her share back.
  _takeShare(result) {
    const p = this.player();
    const l = this.lyra();
    const items = Array.isArray(result?.items) ? result.items : [];
    if (!p?.inventory || !l?.inventory || !items.length) return;
    const taken = [];
    for (const it of items) {
      const half = Math.floor((it.qty || 0) / 2);
      if (half <= 0) continue;
      const n = p.inventory.transfer(l.inventory, it.id, half);
      if (n) {
        taken.push(itemName(it.id, n).toLowerCase());
        this.game?.bus?.emit?.('item_gained', { actor: l, itemId: it.id, qty: n, from: 'trade' });
      }
    }
    if (taken.length) this.say(`${taken.join(' and ')} for me, as agreed. Pleasure doing business.`.replace(/^./, (c) => c.toUpperCase()), { force: true });
  }

  // Paid for her work: what the buyer's shop pays (job_done's `earned`), or her agreed
  // rate. Goods she handed to the buyer are theirs already; goods she kept are sold to them.
  _getPaid(spec, result, buyer = null) {
    const items = Array.isArray(result?.items) ? result.items : [];
    let count = num(result?.count, 0);
    if (!count) count = items.reduce((s, it) => s + (it.qty || 0), 0);
    if (!count) count = spec?.amount || 1;
    const units = clamp(Math.round(count), 1, 10);
    const earned = num(result?.earned, 0);
    const pay = Math.max(earned, spec ? units * spec.rate : 0);
    if (!(pay > 0)) return;
    if (!buyer && spec) {
      const inv = this._inv();
      if (inv) {
        let left = units;
        for (const id of spec.items) {
          if (left <= 0) break;
          left -= inv.remove(id, left);
        }
      }
    }
    this._addCoin(pay);
    const npcId = buyer || spec?.npc;
    if (spec) this.lastJobId = spec.id;
    const npc = this.npcName(npcId);
    const what = spec ? `to ${spec.label}` : 'for what I gathered';
    this.remember(`${npc} paid me ${pay} coins ${what}. Honest work, honest coin.`, { importance: 3, about: npcId ? [npcId] : [], tags: ['work', 'coin'] });
    if (this._playerNear(220)) this.say(this.line('deed_paid_work', { npc, coins: pay }), { minGap: 10 });
  }

  _onEnter({ actor, location }) {
    if (!this.isLyra(actor) && !this.isPlayer(actor)) return;
    this._checkVisitPromises();
    if (this.isLyra(actor) && location?.id === 'ember_kettle') this._atInn();
  }

  _onQuest({ id, stage }) {
    if (id !== 'maren') return;
    const s = questStageIndex(stage);
    if (s !== this.questStage) {
      this.questStage = s;
      this.planDay('quest');
    }
  }

  _onTimeSkip({ hours }) {
    const n = Math.min(24, Math.max(0, Math.round(num(hours, 0))));
    if (n > 0) {
      this._hourIdx = Math.floor(this.now() / this.sph());
      this._hourly(n);
    }
  }

  // ------------------------------------------------------------------ deeds

  // Record something the player did (§16.2). Returns the ledger entry, or null.
  recordDeed(deed, opts = {}) {
    const def = DEEDS[deed];
    if (!def && !Number.isFinite(opts.severity)) return null;
    const now = this.now();
    let severity = Number.isFinite(opts.severity) ? opts.severity : def.severity;
    if (severity > 0) severity *= this._repeatFactor(deed);
    const victim = opts.victim && typeof opts.victim === 'object' ? opts.victim : opts.victim ? this.game?.entities?.get?.(opts.victim) || null : null;
    const victimId = victim?.id ?? (typeof opts.victim === 'string' ? opts.victim : null);
    const vname = victim ? this.displayName(victim) : victimId ? this.npcName(victimId) : '';
    const text = String(opts.text || (def?.text || deed).replace(/one of the villagers|one of the guard/, vname || '$&')).slice(0, 160);
    const before = this.stats();
    const entry = { t: Math.round(now * 10) / 10, day: this.day(), deed, severity: Math.round(severity * 100) / 100, text, victimId };
    this.ledger.push(entry);
    this._trimLedger();

    const kind = def?.kind || (severity < 0 ? 'slight' : 'kindness');
    const grave = !!def?.grave;
    const changes = this._deedChanges(severity, kind, grave, before);
    this.adjustPlayer(changes, text);
    if (severity < 0) {
      if (grave) this.violentDebt += -changes.trust;
      else this.grudge += -changes.trust;
      // A grave deed soon after a believed apology: the apology was worth less than it seemed.
      if (grave && this.apology?.believed && now - this.apology.t < 2 * this.daySeconds()) this.brokenApologies += 1;
    }
    if (def?.violent) {
      this.lastViolentT = now;
      this.violence.push(now);
      if (this.violence.length > 12) this.violence.shift();
    }
    const P = this.playerName();
    if (!(def?.mindMemo && this.mind?.perception)) {
      this.remember(this._deedMemory(deed, entry, vname, P), {
        importance: clamp(Math.round(3 + Math.abs(severity) * 1.4), 1, 10),
        about: victimId && victimId !== PLAYER_ID ? [PLAYER_ID, victimId] : [PLAYER_ID],
        tags: ['deed', deed],
        type: 'event',
      });
    }
    this._feelDeed(deed, severity, kind);
    this.game?.bus?.emit?.('deed', { deed, severity: entry.severity, text, victim: victim || victimId || null });
    if (severity < 0) this._checkAvoidPromises(deed);
    try {
      this._respond(deed, { before, victim, vname, severity });
    } catch (err) {
      console.error('[autonomy] deed response failed', err);
    }
    this.reconsider(deed);
    return entry;
  }

  _trimLedger() {
    while (this.ledger.length > 80) {
      const i = this.ledger.findIndex((e) => Math.abs(e.severity) < 2);
      this.ledger.splice(i >= 0 ? i : 0, 1);
    }
  }

  _repeatFactor(deed) {
    const win = DEED_REPEAT_WINDOW[deed];
    if (!win) return 1;
    const now = this.now();
    let n = 0;
    for (let i = this.ledger.length - 1; i >= 0; i--) {
      const e = this.ledger[i];
      if (now - e.t > win) break;
      if (e.deed === deed) n += 1;
    }
    return 1 / (1 + n);
  }

  // How a deed moves trust, affinity, respect and fear, by her personality and by how
  // much she already trusts the player (high trust cushions small slights, not grave ones).
  _deedChanges(severity, kind, grave, before) {
    const w = DEED_KINDS[kind] || DEED_KINDS.slight;
    const P = this.personality();
    if (severity >= 0) {
      return {
        trust: w.trust * severity,
        affinity: w.affinity * severity,
        respect: w.respect * severity,
        familiarity: 0.5,
        fear: -Math.min(before.fear, w.fear * severity),
      };
    }
    const m = -severity;
    let soften = 1;
    if (!grave) {
      if (before.trust >= 60) soften *= 0.5;
      else if (before.trust >= 45) soften *= 0.75;
      soften *= 1.15 - 0.35 * P.agreeableness;
    }
    const fearMul = 0.6 + P.neuroticism;
    return {
      trust: -w.trust * m * soften,
      affinity: -w.affinity * m * soften,
      respect: -w.respect * m * soften,
      familiarity: 0.5,
      fear: w.fear * m * fearMul * (grave ? 1 : soften),
    };
  }

  _deedMemory(deed, entry, vname, P) {
    const victim = vname || 'someone';
    switch (deed) {
      case 'protected_lyra':
        return `${P} cut down something that was mauling me. ${entry.text}`;
      case 'revived_lyra':
        return `I went down, and ${P} came back for me and got me on my feet.`;
      case 'gift_loved':
        return `${P} ${entry.text.charAt(0).toLowerCase()}${entry.text.slice(1)} I could have cried.`;
      case 'gift_liked':
        return `${P} ${entry.text.charAt(0).toLowerCase()}${entry.text.slice(1)} Thoughtful.`;
      case 'gift_disliked':
        return `${P} ${entry.text.charAt(0).toLowerCase()}${entry.text.slice(1)} Of all things.`;
      case 'kept_promise':
        return `${P} kept their word. ${entry.text}`;
      case 'broke_promise':
        return `${P} broke their word. ${entry.text}`;
      case 'respected_refusal':
        return `I said no to ${P}, and they let it be.`;
      case 'pushed_after_refusal':
        return `I said no, and ${P} kept pushing.`;
      case 'kindness':
        return `${P} was kind to ${victim}. ${entry.text}`;
      case 'reckless_order':
        return `${P} sent me into a fight that nearly killed me.`;
      case 'hit_lyra_accident':
        return `${P} caught me with their sword in the fight. An accident, I think.`;
      case 'hit_lyra':
        return `${P} struck me with their sword. On purpose.`;
      case 'downed_lyra':
        return `${P} knocked me out. The person I traveled with.`;
      case 'abandoned_downed':
        return `I was knocked out and ${P} left me lying there.`;
      case 'killed_harmless':
        return `${P} ${entry.text.charAt(0).toLowerCase()}${entry.text.slice(1)}`;
      case 'attacked_villager':
        return `${P} attacked ${victim}, here in Hearthvale.`;
      case 'downed_villager':
        return `${P} beat ${victim} until they dropped.`;
      case 'attacked_guard':
        return `${P} attacked ${victim} of the guard.`;
      case 'stole':
        return `${P} stole. ${entry.text}`;
      case 'lied':
        return `${P} lied to me. ${entry.text}`;
      default:
        return `${P}: ${entry.text}`;
    }
  }

  _feelDeed(deed, severity, kind) {
    const m = this.mind;
    if (typeof m?.feel !== 'function') return;
    const cause = DEEDS[deed]?.text || deed;
    const a = Math.min(1, Math.abs(severity) / 3);
    const f = (name, amount) => {
      try {
        m.feel(name, amount, cause);
      } catch {
        /* the mind may not know this emotion */
      }
    };
    switch (kind) {
      case 'violence':
        f('fear', 0.25 + 0.3 * a);
        f('anger', 0.2 + 0.2 * a);
        f('trust', -0.3);
        break;
      case 'betrayal':
        f('sadness', 0.4);
        f('anger', 0.25);
        f('fear', 0.15);
        break;
      case 'care':
        f('joy', 0.3);
        f('trust', 0.3);
        f('affection', 0.25);
        break;
      case 'gift':
        if (severity > 0) {
          f('joy', 0.15 + 0.1 * severity);
          f('affection', 0.1 + 0.08 * severity);
        }
        break;
      case 'slight':
        f('anger', 0.1);
        f('sadness', 0.08);
        break;
      case 'honesty':
        if (severity > 0) {
          f('trust', 0.25);
          f('joy', 0.15);
        } else {
          f('sadness', 0.25);
          f('anger', 0.15);
        }
        break;
      case 'respect':
        if (severity > 0) f('trust', 0.1);
        else f('anger', 0.2);
        break;
      case 'kindness':
        f('affection', 0.1);
        f('joy', 0.1);
        break;
      case 'danger':
        f('fear', 0.15 + 0.1 * a);
        f('anger', 0.1);
        break;
      case 'cruelty':
        f('anger', 0.3);
        f('sadness', 0.2);
        break;
      case 'dishonesty':
        f('anger', 0.25);
        f('sadness', 0.15);
        break;
      default:
        break;
    }
  }

  _violenceCount(windowSec) {
    const now = this.now();
    let n = 0;
    for (const t of this.violence) if (now - t <= windowSec) n += 1;
    return n;
  }

  // §16.6: when the player is the danger. Mind decides, behavior acts.
  _respond(deed, info) {
    const st = this.companionship;
    if (st === 'gone') return;
    const now = this.now();
    const vars = { target: info.vname || 'them' };
    const twoDays = 2 * this.daySeconds();
    switch (deed) {
      case 'hit_lyra': {
        const hitsBefore = this.ledger.filter((e) => e.deed === 'hit_lyra' && now - e.t <= twoDays).length - 1;
        if (st === 'left' && this._violenceCount(twoDays) >= 3) return this._goGone('violence', 'to_gone_violence', vars);
        if (hitsBefore >= 1 || info.before.trust < T.waryTrust || st === 'left') {
          if (st !== 'left') this.setCompanionship('left', '', { cause: 'hit_again', lineKey: 'to_left_hit' });
          else this.say(this.line('to_left_hit'), { force: true });
          this._bindAndRun();
          return;
        }
        this.warnings += 1;
        if (st === 'apart') {
          // Living her own day: a warning and some distance, then back to her day.
          this.say(this.line('to_wary_hit'), { force: true });
          this._act('keep_distance', { target: 'player', amount: 5 });
          try {
            this.behavior()?.setDirective?.({ type: 'keep_away', from: 'player', tiles: 5, follow: false, seconds: 30, then: { type: 'independent' } });
          } catch (err) {
            console.error('[autonomy] keep away failed', err);
          }
          return;
        }
        if (!this.setCompanionship('wary', '', { cause: 'hit', lineKey: 'to_wary_hit' })) this.say(this.line('to_wary_hit'), { force: true });
        this._act('keep_distance', { target: 'player', amount: 4 });
        return;
      }
      case 'attacked_villager':
      case 'attacked_guard': {
        const rec = info.victim ? this._npcRec(info.victim.id) : null;
        const warnedBefore = (rec && rec.warned) || now < this.watchUntil;
        if (st === 'left' && this._violenceCount(twoDays) >= 3) return this._goGone('violence', 'to_gone_violence', vars);
        if (!warnedBefore) {
          if (rec) rec.warned = true;
          this.warnings += 1;
          this.watchUntil = now + 60;
          if (!(st === 'together' && this.setCompanionship('wary', '', { cause: 'villager', vars, lineKey: 'deed_villager_warn' }))) {
            this.say(this.line('deed_villager_warn', vars), { force: true, kind: 'shout' });
          }
          this._act('emote', { value: 'angry' });
          return;
        }
        if (st !== 'left') this.setCompanionship('left', '', { cause: 'villager_again', vars, lineKey: 'to_left_villager' });
        this._bindAndGuard(info.victim);
        return;
      }
      case 'downed_villager': {
        const aff = num(this.relOf(info.victim?.id)?.affinity, 0);
        if (aff >= 30 || (st === 'left' && this._violenceCount(twoDays) >= 3)) return this._goGone(aff >= 30 ? 'villager' : 'violence', aff >= 30 ? 'to_gone_villager' : 'to_gone_violence', vars, info.victim);
        if (st !== 'left') this.setCompanionship('left', '', { cause: 'villager_down', vars, lineKey: 'to_left_villager' });
        this._bindAndGuard(info.victim);
        return;
      }
      case 'downed_lyra':
        // She decides when she comes to (_comeTo); unconscious, she decides nothing.
        if (!this.downed?.byPlayer) return this._goGone('downed', 'to_gone_downed', vars);
        return undefined;
      case 'abandoned_downed':
        this._queue(this.line('deed_abandoned'));
        return;
      case 'killed_harmless':
        this.say(this.line(info.severity <= -2 ? 'deed_killed_pet' : 'deed_killed_harmless'), { minGap: 3 });
        return;
      case 'reckless_order':
        this.say(this.line('deed_reckless'), { minGap: 3 });
        return;
      case 'hit_lyra_accident':
        this.say(this.line('deed_hit_accident'), { minGap: 6 });
        return;
      case 'protected_lyra':
        if (info.severity >= 1) this.say(this.line('deed_protected'), { minGap: 10 });
        return;
      case 'lied':
        this.say(this.line('deed_lied'), { minGap: 3 });
        return;
      case 'stole':
        this.say(this.line('deed_stole'), { minGap: 3 });
        return;
      case 'kindness':
        if (info.severity >= 0.5 && this._playerNear(160)) this.say(this.line('deed_kindness'), { minGap: 20 });
        return;
      default:
        return;
    }
  }

  _goGone(reason, lineKey, vars, victim = null) {
    const cause = reason === 'downed' ? 'downed' : reason === 'villager' ? 'villager_gone' : 'violence';
    this.setCompanionship('gone', '', { cause, vars, lineKey, goneReason: reason, target: vars?.target, victim });
    if (reason !== 'downed') this._bindPlayer();
  }

  // Binding Light, then flee or stand her ground, by personality and fear.
  _bindAndRun() {
    const s = this.stats();
    const P = this.personality();
    const l = this.lyra();
    this._bindPlayer();
    const hurt = l?.maxHp ? l.hp / l.maxHp < 0.5 : false;
    if (s.fear >= 40 || P.neuroticism >= 0.55 || hurt || P.agreeableness >= 0.8) {
      this._act('flee', { target: 'player', value: this._safePlace() });
    } else {
      try {
        this.behavior()?.setStance?.('self_defense');
      } catch (err) {
        console.error('[autonomy] stance failed', err);
      }
      this._act('keep_distance', { target: 'player', amount: 6 });
    }
  }

  // Bind the player, step between them and the victim, call the guards.
  _bindAndGuard(victim) {
    this._bindPlayer();
    if (victim?.id) this._act('guard', { target: victim.id });
    this.say(this.line('deed_villager_bind'), { force: true, kind: 'shout', target: this.game?.entities?.get?.('rowan') || null });
  }

  // Binding Light on the player (behavior's `bind`, run as her own act). A blow can knock
  // her out of reach or line of sight for a moment: she tries again for two seconds.
  _bindPlayer() {
    const r = this._act('bind', { target: 'player' });
    if (r && r.ok) {
      this._pendingBind = null;
      return true;
    }
    if (r && this.game?.actions?.has?.('bind')) this._pendingBind = { until: this.now() + 2.5 };
    return false;
  }

  _retryBind() {
    const pb = this._pendingBind;
    if (!pb) return;
    const l = this.lyra();
    if (this.now() > pb.until || !l || l.downed || this.companionship === 'together') {
      this._pendingBind = null;
      return;
    }
    if (this.player()?.rootTime > 0) {
      this._pendingBind = null;
      return;
    }
    if (this._playerNear(140)) this._bindPlayer();
  }

  // The guards, the inn or the chapel: whichever is nearer to her than to the player.
  _safePlace() {
    const l = this.lyra();
    const p = this.player();
    let best = 'guardhouse';
    let bestScore = Infinity;
    for (const id of SAFE_PLACES) {
      const loc = this.game?.locations?.get?.(id);
      if (!loc?.center || !l) continue;
      const dl = Math.hypot(loc.center.x - l.x, loc.center.y - l.y);
      const dp = p ? Math.hypot(loc.center.x - p.x, loc.center.y - p.y) : 0;
      const score = dl - 0.8 * dp;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  // Run one of her own actions (never gated); fall back to the behavior directly.
  _act(name, args = {}) {
    const g = this.game;
    if (g?.actions?.has?.(name)) {
      this._selfAct = (this._selfAct || 0) + 1;
      try {
        return g.actions.run(name, args, 'self');
      } catch (err) {
        console.error(`[autonomy] ${name} failed`, err);
        return null;
      } finally {
        this._selfAct -= 1;
      }
    }
    const b = this.behavior();
    try {
      switch (name) {
        case 'bind': {
          const p = this.player();
          if (p) p.rootTime = Math.max(p.rootTime || 0, 3);
          return { ok: true };
        }
        case 'keep_distance':
          return b?.setDirective?.({ type: 'keep_away', from: 'player', tiles: args.amount || 5 }) || null;
        case 'flee':
          return b?.setDirective?.({ type: 'flee', from: 'player', to: args.value || this._safePlace() }) || null;
        case 'guard':
          return b?.setDirective?.({ type: 'guard', target: args.target }) || null;
        case 'emote':
          return b?.emote?.(args.value) || null;
        case 'stop_job':
          return b?.setDirective?.({ type: 'independent', plan: this.agenda.today, block: this.currentBlock() }) || null;
        case 'use_item':
          return this.game?.combat?.useItem?.(this.lyra(), args.value) ? { ok: true } : null;
        default:
          return null;
      }
    } catch (err) {
      console.error(`[autonomy] fallback ${name} failed`, err);
      return null;
    }
  }

  _checkReckless() {
    const l = this.lyra();
    if (!l?.maxHp) return;
    const of = this.orderFight;
    if (!(of.attackMode || this.now() < of.until)) return;
    if (l.hp / l.maxHp >= 0.3 || of.flagged) return;
    of.flagged = true;
    of.flaggedT = this.now();
    this.recordDeed('reckless_order');
  }

  // ------------------------------------------------------------------ companionship

  setCompanionship(state, why = '', opts = {}) {
    if (!STATES.includes(state)) return false;
    const previous = this.companionship;
    if (previous === 'gone' || previous === state) return false;
    const cause = CAUSES[opts.cause] || null;
    const vars = { target: opts.vars?.target || 'them', why: why || '', ...(opts.vars || {}) };
    const reason = cause ? fillText(cause.reason, vars) : String(why || '').trim() || this.reason;
    this.companionship = state;
    this.reason = reason;
    this.stateSince = this.now();
    this.stateDay = this.day();
    if (state === 'apart') {
      this.apartReason = opts.apartReason || (opts.cause === 'plans' || opts.cause === 'dismissed' || opts.cause === 'amends' ? opts.cause : 'chose');
      this.apartDay = this.day();
    } else if (state !== 'left') this.apartReason = null;
    this._updateSleepAt();
    this.game?.bus?.emit?.('companionship_changed', { state, previous, reason });
    this._direct(state, previous);
    const P = this.playerName();
    if (state === 'gone') this._farewell(opts.goneReason || 'other', { ...vars, P });
    else if (cause?.memo) {
      const importance = state === 'left' ? 8 : state === 'wary' ? 6 : state === 'together' ? 5 : 4;
      this.remember(fillText(cause.memo, { ...vars, P }), { importance, tags: ['companionship', state], about: [PLAYER_ID] });
    }
    try {
      if (state === 'left' || state === 'gone') this.mind?.feel?.('sadness', 0.35, reason);
      else if (state === 'together' && (previous === 'left' || previous === 'wary')) this.mind?.feel?.('trust', 0.25, reason);
    } catch {
      /* optional */
    }
    const line = opts.line ?? (opts.lineKey ? this.line(opts.lineKey, vars) : '');
    if (line && !opts.silent) this.say(line, { force: true, kind: state === 'gone' ? 'farewell' : 'initiative' });
    if (!opts.noReplan) this.planDay('companionship');
    return true;
  }

  // Tell behavior what this state means for her body (DESIGN §16.3, §16.9): together ->
  // follow; wary -> follow far, stance defend; apart -> independent (her own day, read
  // live from agenda.today); left -> keep away from the player, then her own day at a
  // distance; gone -> leave the world along the King's Road.
  _direct(state, previous = null) {
    const b = this.behavior();
    if (!b?.setDirective) return;
    const d = b.directive || {};
    const set = (directive) => {
      const r = b.setDirective(directive);
      if (r && r.ok === false) console.warn(`[autonomy] behavior declined ${directive.type}: ${r.message || ''}`);
      return r;
    };
    try {
      switch (state) {
        case 'together':
          if (previous === 'apart' || previous === 'left' || LEAVING_TYPES.has(d.type) || (d.type === 'follow' && d.distance === 'far')) {
            set({ type: 'follow', target: 'player', distance: 'normal' });
          }
          if (b.stance === 'self_defense') b.setStance?.('defend');
          break;
        case 'wary':
          if (d.type === 'follow' || previous === 'apart' || previous === 'left' || (LEAVING_TYPES.has(d.type) && d.type !== 'keep_away' && d.type !== 'flee')) {
            set({ type: 'follow', target: 'player', distance: 'far' });
          }
          if (b.stance === 'attack') b.setStance?.('defend');
          break;
        case 'apart':
          if (d.type !== 'independent' || d.avoid) set({ type: 'independent', reason: 'apart' });
          if (b.stance === 'attack' || b.stance === 'self_defense') b.setStance?.('defend');
          break;
        case 'left':
          // Running from the player already (flee): behavior sends her on to her own day.
          if (d.type !== 'flee') {
            set({ type: 'keep_away', from: 'player', tiles: LEFT_TILES, follow: false });
            this._keepAwaySince = this.now();
          }
          if (b.stance === 'attack') b.setStance?.('defend');
          break;
        case 'gone':
          set({ type: 'leave', mode: 'gone', reason: String(this.reason || 'gone').slice(0, 80) });
          if (b.stance === 'attack') b.setStance?.('defend');
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[autonomy] could not direct behavior', err);
    }
  }

  _farewell(reason, vars) {
    const g = this.game;
    if (g) {
      g.flags = g.flags || {};
      g.flags.lyra_gone = { day: this.day(), reason: this.reason };
    }
    const P = vars.P || this.playerName();
    this.remember(`I left ${P} for good. ${this.reason}`, { importance: 10, tags: ['farewell', 'companionship', 'gone'], about: [PLAYER_ID], type: 'event' });
    const text = fillText(FAREWELL_DIARY[reason] || FAREWELL_DIARY.other, { day: this.day(), P, target: vars.target || 'someone' });
    const diary = this.mind?.diary;
    if (Array.isArray(diary)) diary.push({ day: this.day(), text, t: this.now() });
    try {
      this.mind?.addThought?.('I’m leaving. For good.', 'self');
    } catch {
      /* optional */
    }
  }

  // Re-evaluate her state against §16.3 (after every deed and every in-game hour).
  reconsider(reason = '') {
    const st = this.companionship;
    if (st === 'gone') return st;
    // Knocked out by the player: nothing is decided until she comes to.
    if (this.downed?.byPlayer && this.lyra()?.downed) return st;
    const s = this.stats();
    if (st === 'left') {
      if (this.amendsStatus().ok) this.setCompanionship('apart', '', { cause: 'amends', apartReason: 'amends', lineKey: 'to_apart_amends' });
      return this.companionship;
    }
    if (s.fear > T.leftFear || s.trust < T.leftTrust) {
      const last = this.ledger[this.ledger.length - 1];
      const abandoned = last?.deed === 'abandoned_downed' && this.now() - last.t < 5;
      const cause = abandoned ? 'abandoned' : s.fear > T.leftFear ? 'fear_left' : 'trust_left';
      this.setCompanionship('left', '', { cause, lineKey: abandoned ? 'to_left_abandoned' : 'to_left_trust' });
      if (s.fear > T.leftFear) this._act('flee', { target: 'player', value: this._safePlace() });
      return this.companionship;
    }
    if (st === 'together' && (s.trust < T.waryTrust || s.fear > T.waryFear)) {
      this.setCompanionship('wary', '', { cause: s.fear > T.waryFear ? 'fear' : 'trust', lineKey: 'to_wary_trust' });
    } else if (st === 'wary' && s.trust >= T.calmTrust && s.fear <= T.calmFear && this.now() - this.lastViolentT > 2 * this.sph() && this.now() - this.stateSince > this.sph()) {
      this.setCompanionship('together', '', { cause: 'recovered', lineKey: 'to_together' });
    }
    return this.companionship;
  }

  // left -> apart after amends: an apology she believes, trust >= 35, fear <= 30, a day.
  amendsStatus() {
    const s = this.stats();
    const out = { ok: false, missing: null, reason: '' };
    if (this.companionship === 'gone') return { ok: false, missing: 'gone', reason: 'she has left for good' };
    const since = this.companionship === 'left' ? this.stateSince : this._leftSince ?? this.stateSince;
    if (!this.apology?.believed || this.apology.t < since) return { ...out, missing: 'apology', reason: 'she has not heard an apology she believes' };
    if (s.trust < T.amendsTrust) return { ...out, missing: 'trust', reason: `she doesn’t trust you enough yet (${Math.round(s.trust)})` };
    if (s.fear > T.amendsFear) return { ...out, missing: 'fear', reason: `she is still afraid of you (${Math.round(s.fear)})` };
    if (this.now() - since < this.daySeconds()) return { ...out, missing: 'time', reason: 'it has been less than a day' };
    return { ok: true, missing: null, reason: 'you made amends' };
  }

  _returnState() {
    const s = this.stats();
    return s.trust < T.waryTrust || s.fear > T.waryFear || this.now() - this.lastViolentT < 2 * this.sph() ? 'wary' : 'together';
  }

  _wantsCompany() {
    const s = this.stats();
    if (s.trust < T.calmTrust || s.fear > T.calmFear) return false;
    return this.apartReason === 'plans' || (this.apartReason === 'dismissed' && this.day() > this.apartDay);
  }

  // She travels with the player again (her decision; the plugin's rejoin action).
  rejoin({ asked = false } = {}) {
    const st = this.companionship;
    if (st === 'gone') return { ok: false, message: this.line('no_gone') };
    if (st === 'together' || st === 'wary') return { ok: true, message: this.line('ans_not_left') };
    if (st === 'left') {
      const am = this.amendsStatus();
      if (!am.ok) return { ok: false, refused: true, message: this.line(am.missing === 'time' ? 'no_rejoin_soon' : 'no_rejoin_left') };
    }
    const fromLeft = st === 'left' || this.apartReason === 'amends';
    this.setCompanionship(this._returnState(), '', { cause: fromLeft ? 'rejoined' : asked ? 'invited' : 'back', silent: true });
    this._yieldBlock();
    return { ok: true, message: this.line(fromLeft ? 'ok_rejoin' : 'ok_invite') };
  }

  // She stops traveling with the player (her decision, or agreed when they let her go).
  leavePlayer(mode = 'apart', why = '', { asked = false } = {}) {
    if (this.companionship === 'gone') return { ok: false, message: this.line('no_gone') };
    let m = STATES.includes(mode) && mode !== 'together' && mode !== 'wary' ? mode : 'apart';
    const now = this.now();
    const s = this.stats();
    const graveRecently = this.ledger.some((e) => DEEDS[e.deed]?.grave && now - e.t < 2 * this.daySeconds());
    const badRecently = this.ledger.some((e) => e.severity < 0 && now - e.t < this.daySeconds());
    // Leaving for good needs a reason that weighs as much as §16.3's gone criteria.
    if (m === 'gone' && !(graveRecently && (s.trust < T.leftTrust || this.companionship === 'left'))) m = 'left';
    if (m === 'left' && !(badRecently || graveRecently || s.trust < 35 || s.fear > 25)) m = 'apart';
    if (asked) m = 'apart';
    if (m === this.companionship) return { ok: true, message: '' };
    const lineKey = asked ? 'ok_dismissed' : m === 'apart' ? 'to_apart_chose' : m === 'left' ? 'to_left_trust' : 'to_gone_violence';
    const cause = asked ? 'dismissed' : why ? 'chose' : m === 'left' ? 'trust_left' : m === 'gone' ? 'violence' : 'chose';
    this.setCompanionship(m, why, { cause, apartReason: asked ? 'dismissed' : 'chose', silent: true, goneReason: 'other' });
    return { ok: true, message: this.line(lineKey) };
  }

  // ------------------------------------------------------------------ requests (§16.4)

  evaluateRequest(req = {}) {
    const source = req.source || 'player';
    const preview = !!(req.preview || req.dryRun) || source !== 'player';
    const action = String(req.action || req.name || '');
    const now = this.now();
    const key = requestKey(action, normalizeArgs(req.args));
    const le = this.lastEval;
    // The same request twice in one moment (a preview, then the gate) is one request.
    if (!preview && le && le.key === key && le.action === action && now - le.t < 1.5 && (le.rt == null || this.game?.time == null || Math.abs(this.game.time - le.rt) < 1.5)) {
      return le.verdict;
    }
    let res;
    try {
      res = analyzeRequest(this, { ...req, action });
    } catch (err) {
      console.error('[autonomy] could not weigh the request', err);
      return null;
    }
    const verdict = {
      decision: res.decision,
      reasons: res.reasons.slice(0, 6),
      message: res.message || '',
      condition: res.condition || undefined,
      counter: res.counter || undefined,
      act: res.act || undefined,
      score: res.score,
      category: res.category,
      risk: res.risk,
      pay: res.pay || 0,
      key: res.key,
    };
    if (preview) return verdict;
    this.lastEval = { key, action, t: now, rt: this.game?.time ?? null, verdict };
    try {
      this._afterVerdict(res, verdict);
    } catch (err) {
      console.error('[autonomy] verdict follow-up failed', err);
    }
    this.game?.bus?.emit?.('request_evaluated', { action, args: res.args, verdict });
    return verdict;
  }

  wasJustEvaluated(action) {
    const le = this.lastEval;
    return !!le && le.action === action && this.now() - le.t < 1.5;
  }

  lastRefusal(key) {
    for (let i = this.refusals.length - 1; i >= 0; i--) if (this.refusals[i].key === key && !this.refusals[i].settled) return this.refusals[i];
    return null;
  }

  pendingOfferAmount() {
    const o = this.pendingOffer;
    return o && this.now() - o.t <= 30 ? o.amount : 0;
  }

  _afterVerdict(res, verdict) {
    const now = this.now();
    const accepted = res.decision === 'accept' || res.decision === 'accept_conditional';
    if (res.pushed) {
      const r = this.lastRefusal(res.key);
      if (r) r.pushed = true;
      this.recordDeed('pushed_after_refusal', { text: `Asked again (${res.action.replace(/_/g, ' ')}) right after I said no.` });
    }
    if (!accepted) {
      if (this.companionship !== 'left' && this.companionship !== 'gone') {
        this.refusals.push({ key: res.key, action: res.action, category: res.category, t: now, pay: res.pay || 0, pushed: false, settled: false, respected: false });
        if (this.refusals.length > 10) this.refusals.shift();
      }
    } else {
      this.lastAcceptedT = now;
      for (const r of this.refusals) if (r.key === res.key) r.settled = true;
      if (res.pay > 0) this.pendingOffer = null;
      this._applyCondition(res);
      if (res.category === 'combat') {
        if (res.action === 'set_combat_mode') this.orderFight.attackMode = true;
        else this.orderFight.until = now + 240;
        this.orderFight.flagged = false;
      }
      // Accepting an invitation while apart means she comes along now.
      if (this.companionship === 'apart' && (res.action === 'follow' || res.action === 'come_here')) {
        this.setCompanionship(this._returnState(), '', { cause: this.apartReason === 'amends' ? 'rejoined' : 'invited', silent: true });
        this._yieldBlock();
      }
    }
    if (res.decision === 'counter' && res.counter) this.pendingCounter = { counter: res.counter, t: now, key: res.key };
    if (res.act) {
      const args = { ...(res.act.args || {}) };
      if (res.act.name === 'warn' && !args.value) args.value = verdict.message;
      this._act(res.act.name, args);
    }
    if (res.watch) this.watchUntil = now + 60;
  }

  _applyCondition(res) {
    const now = this.now();
    switch (res.conditionKind) {
      case 'eat_first':
        this._eatSomething();
        break;
      case 'potion_first':
        this._act('use_item', { value: 'potion' });
        break;
      case 'share':
        this.deals.push({ kind: 'share', job: res.args.value ? String(res.args.value).toLowerCase().replace(/\s+/g, '_') : null, until: now + this.daySeconds() / 2 });
        break;
      case 'pay': {
        if (res.pay > 0 && this._brainOffer() > 0) break; // the brain records the player's offer as their promise
        const amount = res.pay || res.askPrice || 5;
        this.addPromise({ by: 'player', kind: 'pay', params: { amount }, what: `pay me ${amount} coins`, days: 0.25 });
        break;
      }
      case 'loan': {
        const amount = Math.max(1, Math.round(res.args.amount || 1));
        this.addPromise({ by: 'player', kind: 'pay', params: { amount }, what: `pay back the ${amount} coins I lent you`, days: 2 });
        break;
      }
      case 'hunt':
        this.huntOkUntil = now + 600;
        break;
      case 'until_dark':
        this.deals.push({ kind: 'until', until: now + Math.max(0.5, 20.5 - this.hour()) * this.sph() });
        break;
      default:
        if (res.pay > 0 && res.decision === 'accept' && !(this._brainOffer() > 0)) this.addPromise({ by: 'player', kind: 'pay', params: { amount: res.pay }, what: `pay me ${res.pay} coins`, days: 0.25 });
        break;
    }
  }

  // Coins the player is offering with the request being weighed right now (the brain's
  // offer detection), or 0. Already handed over ('here's 10 coins') counts as no debt.
  _brainOffer() {
    const o = this.game?.brain?.currentOffer;
    return o && Number(o.coins) > 0 && !o.paid ? Number(o.coins) : 0;
  }

  _eatSomething() {
    const food = this.bestFood();
    if (!food) return false;
    const r = this._act('use_item', { value: food });
    return !!r?.ok;
  }

  // ------------------------------------------------------------------ her day (§16.1)

  purse() {
    return this._readPurse();
  }

  _inv() {
    const inv = this.lyra()?.inventory;
    return inv && typeof inv.count === 'function' && typeof inv.add === 'function' && typeof inv.remove === 'function' ? inv : null;
  }

  _readPurse() {
    const inv = this._inv();
    if (inv) {
      try {
        return inv.count('coin');
      } catch {
        return this._purse;
      }
    }
    return this._purse;
  }

  _writePurse(v) {
    const n = Math.max(0, Math.round(Number(v) || 0));
    const inv = this._inv();
    if (!inv) {
      this._purse = n;
      return;
    }
    const have = inv.count('coin');
    if (n > have) inv.add('coin', n - have);
    else if (n < have) inv.remove('coin', have - n);
  }

  _addCoin(n, from = 'job') {
    if (!(n > 0)) return;
    this._writePurse(this._readPurse() + n);
    const l = this.lyra();
    if (l && this._inv()) this.game?.bus?.emit?.('item_gained', { actor: l, itemId: 'coin', qty: n, from });
  }

  _spendCoin(n) {
    if (!(n > 0)) return true;
    const have = this._readPurse();
    if (have < n) return false;
    this._writePurse(have - n);
    return true;
  }

  _updateSleepAt() {
    const s = this.stats();
    const st = this.companionship;
    this.agenda.sleepAt = st === 'left' || st === 'gone' ? 'lyra_inn_bed' : sleepSpot(s.trust, s.fear);
  }

  currentBlock() {
    return blockAt(this.agenda.today, this.hour());
  }

  _planView(fromHour) {
    const s = this.stats();
    const n = this.needs();
    const P = this.personality();
    let mood = null;
    try {
      mood = this.mind?.mood?.() || null;
    } catch {
      mood = null;
    }
    const l = this.lyra();
    return {
      day: this.day(),
      fromHour,
      state: this.companionship,
      apartReason: this.apartReason,
      apartDay: this.apartDay,
      trust: s.trust,
      affinity: s.affinity,
      fear: s.fear,
      purse: this.purse(),
      energy: n.energy,
      hunger: n.hunger,
      weather: this.game?.clock?.weather?.type || 'clear',
      questStage: this.questStage,
      openness: P.openness,
      extraversion: P.extraversion,
      neuroticism: P.neuroticism,
      sleepAt: this.agenda.sleepAt,
      lastJobId: this.lastJobId,
      friend: this._bestFriend(),
      valence: num(mood?.valence, 0.1),
      hpFrac: l?.maxHp ? l.hp / l.maxHp : 1,
      dangerOf: (id) => num(this.game?.locations?.get?.(id)?.danger, 0),
    };
  }

  // The villager she likes best, to visit on a free morning.
  _bestFriend() {
    let all = [];
    try {
      all = this.mind?.relationships?.all?.() || [];
    } catch {
      all = [];
    }
    let best = null;
    for (const r of all) {
      if (!r || r.id === PLAYER_ID || r.id === 'maren' || r.absent || r.kind === 'group') continue;
      const e = this.game?.entities?.get?.(r.id);
      if (!e?.profile) continue;
      if (num(r.affinity, 0) >= 25 && (!best || r.affinity > best.affinity)) best = r;
    }
    if (!best) return null;
    const e = this.game.entities.get(best.id);
    return { id: best.id, name: this.displayName(e), at: e?.profile?.work || e?.profile?.home || 'town_square' };
  }

  // Build her plan for today (DESIGN §16.1): each morning, on waking, and when things change.
  planDay(reason = 'morning') {
    const h = this.hour();
    const fresh = reason === 'new_day' || reason === 'wake' || reason === 'start';
    const fromHour = fresh ? (h < 7 || h >= 24 ? 7 : Math.max(7, h)) : Math.max(7, h);
    let today;
    try {
      const v = this._planView(fromHour >= 23.5 ? 23.5 : fromHour);
      today = buildPlan(v);
      const mi = fresh && fromHour < 10 ? this.agenda.morningIntent : null;
      if (mi && today[0] && today[0].from <= 7.5) {
        const first = today[0];
        today[0] = makeBlock(first.from, first.to, 'travel', mi.at || null, mi.why || first.why, { company: 'player' });
      }
      if (fresh) this.agenda.morningIntent = null;
      this.agenda.goals = weighGoals(v);
    } catch (err) {
      console.error('[autonomy] planning failed', err);
      return this.agenda.today;
    }
    this.agenda.today = today;
    this.agenda.day = this.day();
    this.agenda.revision = (this.agenda.revision || 0) + 1;
    this._blockIdx = -2;
    this.game?.bus?.emit?.('plan_changed', { today, reason });
    return today;
  }

  // Change today's plan from now on (the set_plan action).
  setPlan(text, { by = 'self' } = {}) {
    const t = String(text || '').toLowerCase().trim();
    const h = this.hour();
    let m;
    if ((m = t.match(/rejoin (?:you )?at (\d+(?:\.\d+)?)/))) {
      const hour = clamp(parseFloat(m[1]), 0, 24);
      this.addPromise({ by: 'lyra', kind: 'rejoin', params: { hour, day: hour > h ? this.day() : this.day() + 1 }, what: `come back to you at ${hourLabel(hour)}`, days: 1 });
      const at = Math.max(h, hour);
      this._insertBlock(makeBlock(at, Math.min(at + 3, 24), 'travel', null, 'I said I’d come back to you.', { company: 'player' }));
      return { ok: true, message: this.line('ok_plan') };
    }
    if (/in the morning|tomorrow|at (?:first light|dawn|sunrise)/.test(t)) {
      const loc = this.resolveLocation(t.replace(/^(explore|patrol|goto|go to|visit)\s+/, '').replace(/\s+(in the morning|tomorrow).*$/, ''));
      this.agenda.morningIntent = { at: loc?.id || null, why: loc ? `We go to ${loc.name} at first light, together.` : 'Something we agreed to do in the morning.' };
      this.addPromise({ by: 'lyra', kind: 'free', params: {}, what: loc ? `go to ${loc.name} with you in the morning` : t.slice(0, 80), days: 1.2 });
      return { ok: true, message: this.line('ok_plan') };
    }
    const b = this._blockFromText(t, h);
    this._insertBlock(b);
    if (by === 'player') this.lastAcceptedT = this.now();
    // Her own new plan takes her away from the player now, unless it is with them.
    if ((this.companionship === 'together' || this.companionship === 'wary') && b.company !== 'player') this._deferIdx = blockIndexAt(this.agenda.today, h);
    return { ok: true, message: this.line('ok_plan') };
  }

  _blockFromText(t, h) {
    const why = t ? t.charAt(0).toUpperCase() + t.slice(1, 120) : 'A change of plans.';
    const to = Math.min(h + 2, 24);
    const job = COIN_JOBS.find((j) => new RegExp(`\\b(${j.npc}|${j.job.split('_')[0]})`).test(t));
    if (/\b(follow|with you|travel|join you|together|come along)\b/.test(t)) return makeBlock(h, to, 'travel', null, why, { company: 'player' });
    if (job && /\b(work|help|herb|farm|fish|wood|ore|mine|chop|gather)\b/.test(t)) {
      return makeBlock(h, to, 'work', job.at, why, { job: job.job, jobId: job.id, label: job.label, npc: job.npc, deliverTo: job.npc, amount: job.amount, pay: job.rate * job.amount });
    }
    if (/\b(eat|supper|dinner|lunch|breakfast|food|kettle|inn)\b/.test(t)) return makeBlock(h, to, 'eat', 'ember_kettle', why);
    if (/\b(sleep|bed|nap)\b/.test(t)) {
      const home = this.agenda.sleepAt === 'lyra_bed';
      return makeBlock(h, 31, 'sleep', home ? 'player_home' : 'ember_kettle', why, { bed: this.agenda.sleepAt });
    }
    if (/\b(rest|sit|relax)\b/.test(t)) return makeBlock(h, to, 'rest', 'ember_kettle', why);
    if (/\b(study|practi[cs]e|read|book|spell)\b/.test(t)) return makeBlock(h, to, 'study', 'player_home', why);
    if (/\bstar/.test(t)) return makeBlock(h, to, 'stars', 'south_meadow', why);
    if (/\bmoonpetal/.test(t)) return makeBlock(h, to, 'moonpetals', 'whisperwood', why);
    if (/\b(maren|aveline|chapel|lead|clue)\b/.test(t)) return makeBlock(h, to, 'lead', 'chapel', why, { npc: 'aveline' });
    const vm = t.match(/\b(?:visit|see)\s+([a-z]+)/);
    if (vm) {
      const e = this.resolveEntity(vm[1]);
      if (e?.profile) return makeBlock(h, to, 'visit', e.profile.work || e.profile.home || 'town_square', why, { npc: e.id, npcName: this.displayName(e) });
    }
    const loc = this.resolveLocation(t.replace(/^(go to|explore|visit|walk to)\s+/, ''));
    if (loc) return makeBlock(h, to, 'free', loc.id, why, { activity: `spend time at ${loc.name}` });
    return makeBlock(h, to, 'free', null, why);
  }

  // Put a block into today, trimming whatever it overlaps.
  _insertBlock(nb) {
    const out = [];
    for (const b of this.agenda.today) {
      if (b.to <= nb.from || b.from >= nb.to) {
        out.push(b);
        continue;
      }
      if (b.from < nb.from) out.push({ ...b, to: nb.from });
      if (b.to > nb.to) out.push({ ...b, from: nb.to });
    }
    out.push(nb);
    out.sort((a, b) => a.from - b.from);
    this.agenda.today = out;
    this.agenda.revision = (this.agenda.revision || 0) + 1;
    this._blockIdx = blockIndexAt(out, this.hour());
    this.game?.bus?.emit?.('plan_changed', { today: out, reason: 'set_plan' });
  }

  // She accepted the player's company: whatever she had planned for now can wait.
  _yieldBlock() {
    const b = this.currentBlock();
    if (!b || b.company === 'player' || b.type === 'sleep') return;
    const h = this.hour();
    this._insertBlock(makeBlock(h, Math.max(h + 0.25, b.to), 'travel', null, 'You asked; my errands can wait.', { company: 'player' }));
  }

  _followPlan() {
    const today = this.agenda.today;
    if (!today.length) return;
    const idx = blockIndexAt(today, this.hour());
    if (idx !== this._blockIdx) {
      this._blockIdx = idx;
      this._deferIdx = idx;
    }
    if (idx >= 0 && this._deferIdx === idx && this._enterBlock(today[idx])) this._deferIdx = -1;
  }

  // Returns true once the block has been acted on (false: try again shortly).
  _enterBlock(b) {
    const st = this.companionship;
    if (st === 'gone' || st === 'left') return true;
    if (st === 'together' || st === 'wary') {
      if (b.company === 'player') return true;
      if (!this._canLeaveForPlan()) return false;
      this.lastAnnounceT = this.now();
      this.setCompanionship('apart', b.why || '', { cause: 'plans', apartReason: 'plans', lineKey: planLineKey(b), vars: this._planVars(b) });
      return true;
    }
    // apart
    if (b.company === 'player') {
      if (this._wantsCompany()) {
        const morning = b.from <= 7.5;
        this.setCompanionship(this._returnState(), '', { cause: 'back', lineKey: this._playerNear(400) ? (morning ? 'plan_back_morning' : 'plan_back') : null });
        return true;
      }
      // She meant to spend these hours with the player, but not any more: a day of her own.
      if (this._moodReplanRev !== this.agenda.revision) {
        this.planDay('mood');
        this._moodReplanRev = this.agenda.revision;
        return true;
      }
    }
    this._direct('apart', 'apart');
    if (this._playerNear(260) && this.now() - this.lastAnnounceT > 45) {
      this.lastAnnounceT = this.now();
      this.say(this.line(planLineKey(b), this._planVars(b)), { minGap: 8 });
    }
    return true;
  }

  _planVars(b) {
    return {
      job: b.label || b.activity,
      npc: this.npcName(b.npc),
      place: this.game?.locations?.get?.(b.at)?.name || b.at || 'the village',
      time: hourLabel(b.to >= 24 ? b.to - 24 : b.to),
    };
  }

  _canLeaveForPlan() {
    const l = this.lyra();
    if (!l || l.downed) return false;
    const b = this.behavior();
    if (b?.currentTarget) return false;
    const d = b?.directive?.type;
    // A standing order she agreed to (a job, a guard post) is kept until it is done.
    if (d === 'job' || d === 'guard' || d === 'goto' || d === 'explore' || d === 'patrol' || d === 'flee') return false;
    if (this.now() - this.lastAcceptedT < 90) return false;
    if (this._hostileNear(l, 120)) return false;
    if (this.player()?.downed) return false;
    return true;
  }

  // Meals and her room at the Ember Kettle.
  _atInn() {
    const b = this.currentBlock();
    if (!b) return;
    const day = this.day();
    const idx = this.agenda.today.indexOf(b);
    if (b.type === 'eat' && !(this.meal.day === day && this.meal.block === idx)) {
      this.meal = { day, block: idx };
      if (this.needs().hunger > 0.85) return;
      const sad = this._planView(this.hour()).valence < 0;
      let food = 'stew';
      if (sad && this.purse() >= PRICES.honey_cake + 2) food = 'honey_cake';
      const price = food === 'honey_cake' ? PRICES.honey_cake : PRICES.meal;
      const l = this.lyra();
      if (this._spendCoin(price)) {
        l?.inventory?.add?.(food, 1);
        this.game?.bus?.emit?.('item_gained', { actor: l, itemId: food, qty: 1, from: 'trade' });
      } else {
        food = 'bread';
        l?.inventory?.add?.(food, 1);
        this.remember('Elda slid me a heel of bread and wouldn’t take my last coins. I owe her.', { importance: 3, about: ['elda'], tags: ['kindness'] });
      }
      this._act('use_item', { value: food });
    } else if (b.type === 'sleep' && b.bed === 'lyra_inn_bed' && this.rentDay !== day && this.hour() >= 18) {
      // Elda rents her the room herself while she lives apart; traveling with the player,
      // she pays at the counter on her way up.
      const st = this.companionship;
      if (st !== 'together' && st !== 'wary') return;
      if (this.game?.flags?.lyra_inn_room?.day === day) {
        this.rentDay = day;
        return;
      }
      this.rentDay = day;
      if (!this._spendCoin(PRICES.room)) {
        this.remember('Elda let me keep my room on credit tonight. I hate owing people.', { importance: 3, about: ['elda'], tags: ['coin'] });
      }
    }
  }

  // Elda rented her the room (characters: 'room_rented').
  _onRoomRented({ actor, paid, price }) {
    if (actor && !this.isLyra(actor)) return;
    this.rentDay = this.day();
    if (!paid) this.remember('Elda let me keep my room on credit tonight. I hate owing people.', { importance: 3, about: ['elda'], tags: ['coin'] });
    else if (price > 0 && this._readPurse() < 10) this.remember(`Paid Elda ${price} coins for my room. My purse is getting thin.`, { importance: 2, about: ['elda'], tags: ['coin'] });
  }

  // ------------------------------------------------------------------ promises

  addPromise({ by = 'player', kind = 'free', params = {}, what = '', days = 0, text = '' } = {}) {
    const now = this.now();
    // One promise, however many ways it reached her (her ear, the brain, Claude).
    const pkey = JSON.stringify(params || {});
    const label = String(what || text || '').toLowerCase();
    const same = this.promises.find(
      (p) => p.state === 'open' && p.by === (by === 'lyra' ? 'lyra' : 'player') && p.kind === kind && now - p.made < 30 && (kind === 'free' ? p.text.toLowerCase() === label : JSON.stringify(p.params) === pkey),
    );
    if (same) return same;
    const p = {
      id: `p${++this._promiseSeq}_${Math.round(now)}`,
      text: String(what || text || 'keep their word').slice(0, 120),
      by: by === 'lyra' ? 'lyra' : 'player',
      state: 'open',
      due: days > 0 ? Math.round(now + days * this.daySeconds()) : null,
      kind,
      params: { ...params },
      made: Math.round(now),
      day: this.day(),
    };
    this.promises.push(p);
    this._trimPromises();
    this.game?.bus?.emit?.('promise', { text: p.text, by: p.by, state: 'open' });
    const P = this.playerName();
    this.remember(p.by === 'player' ? `${P} promised to ${p.text}.` : `I promised ${P}: I’ll ${p.text}.`, { importance: 4, tags: ['promise'], about: [PLAYER_ID] });
    return p;
  }

  _trimPromises() {
    while (this.promises.length > 30) {
      const i = this.promises.findIndex((p) => p.state !== 'open');
      this.promises.splice(i >= 0 ? i : 0, 1);
    }
  }

  _resolvePromise(p, state, { quiet = false } = {}) {
    if (!p || p.state !== 'open') return;
    p.state = state === 'kept' ? 'kept' : 'broken';
    p.resolvedAt = Math.round(this.now());
    this.game?.bus?.emit?.('promise', { text: p.text, by: p.by, state: p.state });
    if (p.by === 'player') {
      this.recordDeed(p.state === 'kept' ? 'kept_promise' : 'broke_promise', { text: `${p.state === 'kept' ? 'Kept' : 'Broke'} a promise: ${p.text}.` });
      if (!quiet) this.say(this.line(p.state === 'kept' ? 'deed_kept_promise' : 'deed_broke_promise'), { minGap: 2 });
    } else {
      const P = this.playerName();
      this.remember(p.state === 'kept' ? `I kept my word to ${P}: ${p.text}.` : `I didn’t keep my word to ${P}: ${p.text}.`, { importance: 3, tags: ['promise'], about: [PLAYER_ID] });
    }
  }

  // Resolve a promise by its text (Claude: "kept: bring me a honey cake").
  resolvePromiseText(text, state) {
    const q = String(text || '').toLowerCase().trim();
    const open = this.promises.filter((p) => p.state === 'open');
    const p = open.find((x) => x.text.toLowerCase() === q) || open.find((x) => q && (x.text.toLowerCase().includes(q) || q.includes(x.text.toLowerCase()))) || (q ? null : open[open.length - 1]);
    if (!p) return null;
    this._resolvePromise(p, state);
    return p;
  }

  _checkAvoidPromises(deed) {
    for (const p of this.promises) {
      if (p.state === 'open' && p.kind === 'avoid' && Array.isArray(p.params.deeds) && p.params.deeds.includes(deed)) this._resolvePromise(p, 'broken', { quiet: true });
    }
  }

  _checkVisitPromises() {
    const l = this.lyra();
    const pl = this.player();
    for (const p of this.promises) {
      if (p.state !== 'open' || p.kind !== 'visit' || !p.params.at) continue;
      if (this.inLocation(p.params.at, l) && this.inLocation(p.params.at, pl)) this._resolvePromise(p, 'kept');
    }
  }

  _checkPromises() {
    const now = this.now();
    const h = this.hour();
    const day = this.day();
    let i = 0;
    while (i < this.promises.length) {
      const p = this.promises[i];
      i += 1;
      if (p.state !== 'open') continue;
      if (p.kind === 'rejoin' && p.by === 'lyra' && (day > p.params.day || (day === p.params.day && h >= p.params.hour))) {
        const st = this.companionship;
        if (st === 'apart' && this._returnStateOk()) {
          this.setCompanionship(this._returnState(), '', { cause: 'back', lineKey: 'plan_join_kept', vars: { time: hourLabel(p.params.hour) } });
          this._resolvePromise(p, 'kept');
        } else this._resolvePromise(p, st === 'together' || st === 'wary' ? 'kept' : 'broken');
        continue;
      }
      if (p.due != null && now > p.due) {
        this._resolvePromise(p, p.kind === 'avoid' ? 'kept' : 'broken');
        continue;
      }
      // Free-form promises with no deadline quietly lapse after a week.
      if (p.due == null && p.kind === 'free' && now - p.made > 7 * this.daySeconds()) {
        this.promises.splice(i - 1, 1);
        i -= 1;
      }
    }
    this._checkVisitPromises();
  }

  _returnStateOk() {
    const s = this.stats();
    return s.trust >= T.waryTrust && s.fear <= T.amendsFear;
  }

  // ------------------------------------------------------------------ the player's words

  // Every player_message: apologies, promises, offers, and answers to her questions.
  // With the real brain, a "yes" to her counter-offer or to something she asked runs as
  // an action (the brain turns it into the counter or the `promise` action), and promises
  // arrive through the `promise` action; on her own she handles them here.
  hearPlayer(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const heard = { t: this.now(), rt: this.game?.time ?? null, text: t, apology: null, promise: null, offer: null, answered: null };
    this._heard = heard;
    const offer = parseOffer(t);
    if (offer) {
      this.pendingOffer = { amount: offer, t: this.now() };
      heard.offer = offer;
    }
    if (isApology(t)) heard.apology = this.receiveApology(t);
    const viaActions = this._brainRunsFollowUps();
    if (RE.promise.test(t)) {
      if (!viaActions) heard.promise = this.playerPromise(t);
    } else if (!viaActions) {
      if (RE.yes.test(t)) heard.answered = this._answer(true);
      else if (RE.no.test(t)) heard.answered = this._answer(false);
      // Nobody else answers for her: she does.
      const ans = heard.answered;
      if (ans?.kind === 'request') this.say(this.line(ans.yes ? 'req_yes' : 'req_no'), { force: true });
      else if (ans?.kind === 'counter' && ans.yes) this.say(this.line('counter_taken'), { force: true });
    } else if (RE.no.test(t) && this.pendingRequest && this.now() - this.pendingRequest.t < 120) {
      heard.answered = this._answer(false);
    }
    return heard;
  }

  // The brain keeps counters and her asks itself and answers them with actions.
  _brainRunsFollowUps() {
    const g = this.game;
    return typeof g?.brain?.noteRefusal === 'function' && !!g?.actions?.has?.('promise');
  }

  // What she heard in the message being handled right now (for the plugin's intents).
  heardNow() {
    const h = this._heard;
    if (!h) return null;
    if (h.rt != null && this.game?.time != null) return Math.abs(this.game.time - h.rt) < 1 ? h : null;
    return Math.abs(this.now() - h.t) < 0.5 ? h : null;
  }

  // The brain's 'apology' event: the same apology she already heard in player_message,
  // unless it reached her some other way.
  _onApologyEvent({ text } = {}) {
    const h = this._heard;
    if (h?.apology && (h.text === text || this.now() - h.t < 5)) return;
    if (text) this.receiveApology(String(text));
  }

  receiveApology(text) {
    const st = this.companionship;
    if (st === 'gone') return { believed: false, gone: true };
    const now = this.now();
    const span = 3 * this.daySeconds();
    const bad = this.ledger.filter((e) => e.severity < 0 && now - e.t < span);
    if (!bad.length && st !== 'left' && st !== 'wary') return { believed: false, nothing: true };
    const s = this.stats();
    const P = this.personality();
    let belief = 0.45 + P.agreeableness * 0.25 + (s.trust / 100) * 0.3 - (s.fear / 100) * 0.4 - this.brokenApologies * 0.2;
    if (RE.specifics.test(text)) belief += 0.15;
    if (String(text).length > 30) belief += 0.08;
    const worst = bad.reduce((m, e) => Math.min(m, e.severity), 0);
    if (worst <= -5) belief -= 0.15;
    const lastGrave = bad.filter((e) => DEEDS[e.deed]?.grave).reduce((m, e) => Math.max(m, e.t), NEG_INF);
    if (now - lastGrave < 20) belief -= 0.2; // seconds after the blow, it rings hollow
    if (this.apology && now - this.apology.t < 120) belief -= 0.15;
    const believed = belief >= 0.5;
    this.apology = { t: now, day: this.day(), believed, count: (this.apology?.count || 0) + 1 };
    const name = this.playerName();
    if (believed) {
      const soften = this.violentDebt * 0.4;
      this.violentDebt -= soften;
      this.grudge += soften;
      this.adjustPlayer({ trust: 3, fear: -4, affinity: 2 }, 'Apologized, and meant it');
      this.remember(`${name} apologized, and I believe they meant it.`, { importance: 5, tags: ['apology'], about: [PLAYER_ID] });
    } else {
      this.remember(`${name} said sorry. I’m not sure I believe it.`, { importance: 3, tags: ['apology'], about: [PLAYER_ID] });
    }
    this.reconsider('apology');
    return { believed, nothing: false };
  }

  playerPromise(text) {
    const now = this.now();
    if (this.pendingRequest && now - this.pendingRequest.t < 120) return this._answer(true)?.promise || null;
    const spec = parsePromiseText(text, (ref) => this.resolveLocation(ref));
    return this.addPromise({ by: 'player', kind: spec.kind, params: spec.params, what: spec.what, days: spec.days });
  }

  // The `promise` action: { by, text, amount }. A "yes" to what she just asked becomes
  // that ask; coin owed becomes a payment promise; anything else is read from the words
  // (the player's: "bring you a honey cake", or hers: "buy me a honey cake").
  promiseFromAction({ by = 'player', text = '', amount = null } = {}) {
    const who = by === 'lyra' || by === 'self' || by === 'her' ? 'lyra' : 'player';
    const raw = String(text || '').trim();
    const now = this.now();
    const r = this.pendingRequest;
    if (who === 'player' && r && now - r.t < 120) {
      const a = raw.toLowerCase();
      const b = String(r.text || '').toLowerCase();
      if (!raw || a === b || a.includes(b) || b.includes(a) || a.includes(String(r.spec?.what || '').toLowerCase())) {
        this.pendingRequest = null;
        return this.addPromise({ by: 'player', kind: r.spec.kind, params: r.spec.params, what: r.spec.what, days: r.spec.days || 1 });
      }
    }
    const coins = Number(amount);
    if (coins > 0 && (who === 'player' || /\b(pay|coins?|gold)\b/i.test(raw))) {
      return this.addPromise({ by: who, kind: 'pay', params: { amount: Math.round(coins) }, what: who === 'player' ? `pay me ${Math.round(coins)} coins` : `pay you ${Math.round(coins)} coins`, days: 0.25 });
    }
    if (who === 'lyra') {
      const what = raw.replace(/^(?:i(?:'ll| will)\s+)/i, '').replace(/[.!]+$/, '').slice(0, 90) || 'keep my word';
      return this.addPromise({ by: 'lyra', kind: 'free', params: {}, what, days: 1 });
    }
    const resolve = (ref) => this.resolveLocation(ref);
    let spec = parsePromiseText(raw, resolve);
    if (spec.kind === 'free') {
      const asked = parseAskText(raw, resolve);
      if (asked.kind !== 'free') spec = asked;
    }
    return this.addPromise({ by: 'player', kind: spec.kind, params: spec.params, what: spec.what, days: spec.days });
  }

  _answer(yes) {
    const now = this.now();
    if (this.pendingRequest && now - this.pendingRequest.t < 120) {
      const r = this.pendingRequest;
      this.pendingRequest = null;
      if (yes) {
        const p = this.addPromise({ by: 'player', kind: r.spec.kind, params: r.spec.params, what: r.spec.what, days: r.spec.days || 1 });
        return { kind: 'request', yes: true, promise: p };
      }
      this.remember(`I asked ${this.playerName()} to ${r.spec.what}, and they said no.`, { importance: 2, tags: ['request'], about: [PLAYER_ID] });
      return { kind: 'request', yes: false };
    }
    if (this.pendingCounter && now - this.pendingCounter.t < 90) {
      const c = this.pendingCounter;
      this.pendingCounter = null;
      if (yes) {
        this._takeCounter(c.counter);
        return { kind: 'counter', yes: true, counter: c.counter };
      }
      return { kind: 'counter', yes: false };
    }
    return null;
  }

  // The player agreed to what she proposed instead: she does it (her own action).
  _takeCounter(counter) {
    if (!counter?.name) return;
    if (counter.name === 'set_plan') {
      this.setPlan(counter.args?.value, { by: 'self' });
      return;
    }
    this._act(counter.name, counter.args || {});
    if (counter.name === 'set_combat_mode' || counter.name === 'follow') this.lastAcceptedT = this.now();
  }

  // She asks something of the player (initiative or the request action).
  makeRequest(text, { spec = null, say = true } = {}) {
    const sp = spec || parseAskText(text, (ref) => this.resolveLocation(ref));
    this.pendingRequest = { spec: sp, t: this.now(), text: String(text || sp.what) };
    if (say && text) this.say(String(text), { force: true });
    return sp;
  }

  // Her initiative asks go through the `request` action, so every module sees them
  // (the brain turns the player's "yes" into their promise).
  _ask(text, spec) {
    if (this.game?.actions?.has?.('request')) {
      this._nextAsk = { text, spec };
      const r = this._act('request', { value: text });
      this._nextAsk = null;
      if (r?.ok) return;
    }
    this.makeRequest(text, { spec, say: true });
  }

  // ------------------------------------------------------------------ speaking

  say(text, { kind = 'initiative', force = false, chat = true, minGap = 4, target = null } = {}) {
    const msg = String(text || '').trim();
    if (!msg) return false;
    const l = this.lyra();
    const now = this.now();
    if (l && (l.downed || l.state === 'sleep')) {
      this._queue(msg);
      return false;
    }
    if (!force && now - this.lastSpokeT < minGap) return false;
    this.lastSpokeT = now;
    const g = this.game;
    const bubbleKind = kind === 'shout' ? 'shout' : 'say';
    try {
      if (l) g?.bubbles?.say?.(l, msg, { kind: bubbleKind });
    } catch (err) {
      console.error('[autonomy] bubble failed', err);
    }
    if (chat) {
      try {
        g?.ui?.chat?.addMessage?.({ from: 'lyra', text: msg, kind: 'initiative' });
      } catch (err) {
        console.error('[autonomy] chat failed', err);
      }
    }
    g?.bus?.emit?.('speech', { speaker: l, text: msg, target: target || this.player(), kind: bubbleKind });
    return true;
  }

  _queue(text) {
    if (!text || this.queued.includes(text)) return;
    this.queued.push(text);
    if (this.queued.length > 3) this.queued.shift();
  }

  _flushQueued() {
    const l = this.lyra();
    if (!this.queued.length || (l && (l.downed || l.state === 'sleep'))) return;
    const text = this.queued.join(' ');
    this.queued.length = 0;
    this.say(text, { force: true });
  }

  _playerNear(r) {
    const l = this.lyra();
    const p = this.player();
    if (!l || !p) return false;
    return Math.hypot(p.x - l.x, p.y - l.y) <= r;
  }

  remember(text, opts = {}) {
    try {
      return this.mind?.remember?.(text, { type: 'event', ...opts }) || null;
    } catch (err) {
      console.error('[autonomy] remember failed', err);
      return null;
    }
  }

  // ------------------------------------------------------------------ her initiative (§16.8)

  _initiative() {
    const st = this.companionship;
    if (st === 'gone' || st === 'left') return;
    const g = this.game;
    if (g?.state && g.state !== 'playing') return;
    const l = this.lyra();
    if (!l || !this.player() || l.downed || l.state === 'sleep') return;
    const now = this.now();
    if (now - this.lastInitiativeT < 180 || now - this.lastSpokeT < 20) return;
    if (!this._playerNear(160)) return;
    if (this.behavior()?.currentTarget || this._hostileNear(l, 140)) return;
    if (this.pendingRequest && now - this.pendingRequest.t < 90) return;
    const c = this._pickInitiative();
    if (!c) return;
    this.lastInitiativeT = now;
    if (c.key) this.asked[c.key] = this.day();
    const text = this.line(c.lineKey, c.vars || {});
    if (c.spec) this._ask(text, c.spec);
    else this.say(text, { force: true });
  }

  _pickInitiative() {
    const v = this.snapshot();
    const now = v.now;
    const day = v.day;
    const askedToday = (k) => this.asked[k] === day;
    const together = v.state === 'together' || v.state === 'wary';
    // A promise the player is about to break.
    for (const p of this.promises) {
      if (p.state !== 'open' || p.by !== 'player' || p.reminded || p.due == null) continue;
      if (p.due - now < 1.5 * this.sph() && p.due > now) {
        p.reminded = true;
        return { lineKey: 'remind_promise', vars: { what: p.text } };
      }
    }
    if (!together) return null;
    const last = this.ledger[this.ledger.length - 1];
    if (last && last.severity < -0.3 && last.severity > -2.5 && now - last.t < 600 && v.trust >= 15 && !askedToday('forgive_cake')) {
      return { key: 'forgive_cake', lineKey: 'ask_forgive_cake', spec: { kind: 'give', params: { itemId: 'honey_cake', qty: 1 }, what: 'buy me a honey cake', days: 1 } };
    }
    const lastHit = [...this.ledger].reverse().find((e) => e.deed === 'hit_lyra' || e.deed === 'hit_lyra_accident');
    if (v.state === 'wary' && lastHit && now - lastHit.t < this.daySeconds() && v.fear > 10 && !askedToday('sword_away')) {
      return { key: 'sword_away', lineKey: 'ask_sword_away', spec: { kind: 'avoid', params: { deeds: ['hit_lyra', 'hit_lyra_accident', 'downed_lyra'] }, what: 'keep your sword away from me for a day', days: 1 } };
    }
    if (v.hunger < 0.3 && !v.food && !askedToday('food')) {
      const inv = this.player()?.inventory;
      const food = ['honey_cake', 'bread', 'cooked_fish', 'stew', 'berries', 'turnip'].find((id) => inv?.count?.(id) > 0);
      if (food) return { key: 'food', lineKey: 'ask_food', vars: { item: itemDef(food).name.toLowerCase() }, spec: { kind: 'give', params: { itemId: food, qty: 1 }, what: `share your ${itemDef(food).name.toLowerCase()}`, days: 0.1 } };
    }
    if (v.questStage === 1 && v.hour >= 8 && v.hour < 18 && !askedToday('lead')) {
      return { key: 'lead', lineKey: 'ask_lead', spec: { kind: 'visit', params: { at: 'chapel' }, what: 'go with me to the chapel', days: 1 } };
    }
    if (v.isNight && v.energy < 0.35 && !askedToday('walk_home')) {
      const at = v.sleepAt === 'lyra_bed' ? 'player_home' : 'ember_kettle';
      const place = this.game?.locations?.get?.(at)?.name || (at === 'player_home' ? 'the cottage' : 'the Kettle');
      return { key: 'walk_home', lineKey: 'ask_walk_home', vars: { place }, spec: { kind: 'visit', params: { at }, what: `walk me to ${place}`, days: 0.15 } };
    }
    if (v.weather === 'rain' && v.hour >= 9 && v.hour < 21 && v.fun < 0.45 && !askedToday('rain_tea')) {
      return { key: 'rain_tea', lineKey: 'ask_rain_tea', spec: { kind: 'visit', params: { at: 'ember_kettle' }, what: 'sit with me at the Kettle', days: 0.2 } };
    }
    return null;
  }

  // ------------------------------------------------------------------ the loop

  update(dt) {
    if (!(dt > 0)) return;
    const g = this.game;
    // Runs once per simulation step even when both the mind and the plugin call it.
    const stamp = g?.time;
    if (stamp != null) {
      if (stamp === this._lastStep) return;
      this._lastStep = stamp;
    }
    if (!Number.isFinite(g?.clock?.t)) this._t += dt;
    this._acc += dt;
    if (this._acc < 0.5) return;
    const step = this._acc;
    this._acc = 0;
    try {
      this._tick(step);
    } catch (err) {
      console.error('[autonomy] update failed', err);
    }
  }

  _tick(step) {
    const now = this.now();
    if (!this.agenda.today.length || (this.agenda.day !== this.day() && this.hour() >= 7)) this.planDay(this.agenda.today.length ? 'new_day' : 'start');
    const hi = Math.floor(now / this.sph());
    if (this._hourIdx == null) this._hourIdx = hi;
    else if (hi > this._hourIdx) {
      const n = Math.min(24, hi - this._hourIdx);
      this._hourIdx = hi;
      this._hourly(n);
    }
    this._watchDowned(step);
    if (this._pendingBind) this._retryBind();
    if (this.queued.length) this._flushQueued();
    this._followPlan();
    this._checkPromises();
    this._checkRefusals();
    this._checkDeals();
    this._keepAway();
    const l = this.lyra();
    if (l && this.inLocation('ember_kettle', l)) this._atInn();
    for (const [e, t] of this.recentAttackers) if (now - t > 12 || e?.removed) this.recentAttackers.delete(e);
    const of = this.orderFight;
    if (of.flagged && (now - of.flaggedT > 120 || (l?.maxHp && l.hp / l.maxHp > 0.6))) of.flagged = false;
    this._initT -= step;
    if (this._initT <= 0) {
      this._initT = 6;
      this._initiative();
    }
  }

  // Each in-game hour: fear subsides and small grudges fade (faster for a forgiving
  // soul), then she reconsiders.
  _hourly(n = 1) {
    const P = this.personality();
    const now = this.now();
    const s = this.stats();
    if (now - this.lastViolentT > this.sph()) {
      const fd = Math.min(s.fear, n * (0.8 + 1.2 * P.agreeableness) * (1.2 - P.neuroticism));
      const rate = 1 - Math.pow(1 - (0.03 + 0.05 * P.agreeableness), n);
      const td = this.grudge * rate;
      this.grudge -= td;
      if (fd > 0.05 || td > 0.05) this.adjustPlayer({ fear: -fd, trust: td }, '');
    }
    this._updateSleepAt();
    try {
      this.agenda.goals = weighGoals(this._planView(this.hour()));
    } catch {
      /* keep the old weights */
    }
    this.reconsider('hour');
    this._checkNeeds();
  }

  // Starving or spent: her plan for the rest of the day changes (once per change).
  _checkNeeds() {
    const n = this.needs();
    const band = `${n.hunger < 0.25 ? 'h' : ''}${n.energy < 0.2 ? 'e' : ''}`;
    if (band === (this._needsBand ?? '')) return;
    this._needsBand = band;
    if (band && this.hour() >= 7) this.planDay('needs');
  }

  // A deed only she can judge, reached through Claude (the record_deed action): a lie,
  // a kindness, a theft. The rest she sees for herself on the bus.
  recordObservedDeed(deed, text = '') {
    const d = String(deed || '').toLowerCase().trim();
    if (!OBSERVED_DEEDS.has(d)) return null;
    const words = String(text || '').trim().slice(0, 140);
    return this.recordDeed(d, words ? { text: words } : {});
  }

  // A refusal the player did not push for a minute: they respected it.
  _checkRefusals() {
    const now = this.now();
    for (let i = this.refusals.length - 1; i >= 0; i--) {
      const r = this.refusals[i];
      if (now - r.t > 150) {
        this.refusals.splice(i, 1);
        continue;
      }
      if (r.pushed || r.settled || r.respected || now - r.t <= 60) continue;
      r.respected = true;
      const st = this.companionship;
      if (st === 'left' || st === 'gone' || r.category === 'trivial' || r.category === 'move') continue;
      if (now - this.lastRespectT < 120) continue;
      this.lastRespectT = now;
      this.recordDeed('respected_refusal', { text: `Took my no (${r.action.replace(/_/g, ' ')}) for an answer.` });
    }
  }

  _checkDeals() {
    const now = this.now();
    for (let i = this.deals.length - 1; i >= 0; i--) {
      const d = this.deals[i];
      if (now <= d.until) continue;
      this.deals.splice(i, 1);
      if (d.kind === 'until' && this.behavior()?.directive?.type === 'job') {
        this._act('stop_job', {});
        this.say('That’s me done for today. We agreed: until dark.', { force: true });
      }
    }
  }

  // Her body keeps up with her state: once she has left the player she keeps away from
  // them while she lives her own day; apart, she lives her day; gone, she walks away.
  _keepAway() {
    const st = this.companionship;
    const b = this.behavior();
    const l = this.lyra();
    if (!b?.setDirective || !l || l.downed || l.removed) return;
    const d = b.directive || {};
    try {
      if (st === 'gone') {
        if (d.type !== 'leave') b.setDirective({ type: 'leave', mode: 'gone', reason: String(this.reason || 'gone').slice(0, 80) });
        return;
      }
      if (st === 'apart') {
        // Anything but her own day ends with her own day again (a job she was asked to do,
        // a walk somewhere): behavior falls back to following, which is not her choice now.
        if (d.type === 'follow' && d.target === 'player') b.setDirective({ type: 'independent', reason: 'apart' });
        return;
      }
      if (st !== 'left') return;
      if (d.type === 'flee' || d.type === 'leave') return;
      const p = this.player();
      const dist = p ? Math.hypot(p.x - l.x, p.y - l.y) : Infinity;
      if (d.type === 'keep_away') {
        if (dist > (LEFT_TILES + 4) * TILE && this.now() - this._keepAwaySince > 20) b.setDirective({ type: 'independent', avoid: 'player', tiles: LEFT_TILES, reason: 'left' });
        return;
      }
      if (d.type !== 'independent' || d.avoid !== 'player') {
        if (dist < LEFT_TILES * TILE) {
          b.setDirective({ type: 'keep_away', from: 'player', tiles: LEFT_TILES, follow: false });
          this._keepAwaySince = this.now();
        } else b.setDirective({ type: 'independent', avoid: 'player', tiles: LEFT_TILES, reason: 'left' });
      }
    } catch (err) {
      console.error('[autonomy] keeping her distance failed', err);
    }
  }

  // ------------------------------------------------------------------ describing herself

  describePlan() {
    const today = this.agenda.today;
    if (!today.length) return 'I haven’t decided yet. Ask me again in a bit.';
    const h = this.hour();
    const names = (b) => ({ npcName: this.npcName(b.npc), place: this.game?.locations?.get?.(b.at)?.name || b.at });
    const parts = [];
    for (const b of today) {
      if (b.to <= h && !(h < 7 && b.to > 24)) continue;
      const now = (h >= b.from && h < b.to) || (h < 7 && b.to > 24 && h + 24 >= b.from);
      const when = now ? 'Right now' : timeWord(b.from);
      parts.push(`${when}, ${describeBlock(b, names(b))}`);
      if (parts.length >= 4) break;
    }
    return parts.length ? `${parts.join('. ')}.` : 'Bed, soon. Tomorrow is another day.';
  }

  describeWants() {
    const v = this.snapshot();
    const goal = this.agenda.goals.find((g) => g.id !== 'survive') || this.agenda.goals[0];
    const big = {
      find_maren: 'Find Maren. Everything else is waiting for that.',
      earn_keep: 'Earn some coin. My purse is embarrassingly light.',
      protect_loved: 'Keep the people I care about in one piece.',
      belong: 'Find somewhere I belong. Hearthvale might be it.',
      grow_magic: 'Get better at my spells. Maren would want that.',
      small_joys: 'A quiet night, a honey cake, and the stars.',
    }[goal?.id] || 'Live well. That’s all, really.';
    let now = '';
    if (v.hunger < 0.35) now = 'Right now? Supper.';
    else if (v.energy < 0.3) now = 'Right now? Sleep.';
    else if (v.fun < 0.3) now = 'Right now, anything that isn’t work.';
    else if (v.block && v.block.company !== 'player') now = `Today I mean to be ${describeBlock(v.block, { npcName: this.npcName(v.block.npc), place: this.game?.locations?.get?.(v.block.at)?.name })}.`;
    return `${big}${now ? ` ${now}` : ''}`;
  }

  // A compact picture for the UI ("You and her").
  summary() {
    const s = this.stats();
    return {
      companionship: this.companionship,
      reason: this.reason,
      since: this.stateSince,
      trust: Math.round(s.trust),
      fear: Math.round(s.fear),
      affinity: Math.round(s.affinity),
      respect: Math.round(s.respect),
      purse: this.purse(),
      sleepAt: this.agenda.sleepAt,
      now: this.currentBlock(),
      today: this.agenda.today,
      goals: this.agenda.goals.slice(0, 5),
      deeds: this.ledger.slice(-10).reverse(),
      promises: this.promises.filter((p) => p.state === 'open'),
    };
  }

  // Claude's context (DESIGN §16.10), at most `max` characters.
  promptText(max = 900) {
    const s = this.stats();
    const day = this.day();
    const lines = [];
    const since = this.stateDay === day ? 'today' : `since day ${this.stateDay}`;
    lines.push(`Companionship: ${this.companionship} (${since}) — her reason: "${this.reason.slice(0, 140)}"`);
    lines.push(`Toward the player: trust ${Math.round(s.trust)}/100, fear ${Math.round(s.fear)}/100, affinity ${Math.round(s.affinity)}, respect ${Math.round(s.respect)}.`);
    const deeds = this.ledger.slice(-5).reverse();
    if (deeds.length) lines.push(`Seen them do (newest first): ${deeds.map((e) => `${e.text.replace(/\.$/, '')} (${e.severity > 0 ? '+' : ''}${e.severity})`).join('; ')}.`);
    const h = this.hour();
    const plan = this.agenda.today
      .filter((b) => b.to > h || (h < 7 && b.to > 24))
      .slice(0, 5)
      .map((b) => `${fmtHour(b.from)}–${fmtHour(b.to)} ${describeBlock(b, { npcName: this.npcName(b.npc), place: this.game?.locations?.get?.(b.at)?.name || b.at })}${b.company === 'invite' ? ' (player welcome)' : ''}`);
    if (plan.length) lines.push(`Her plan today: ${plan.join('; ')}.`);
    lines.push(`Purse ${this.purse()} coins; sleeps ${this.agenda.sleepAt === 'lyra_bed' ? 'in the cottage' : 'at the Ember Kettle'}.`);
    const open = this.promises.filter((p) => p.state === 'open');
    const theirs = open.filter((p) => p.by === 'player').slice(-3);
    const hers = open.filter((p) => p.by === 'lyra').slice(-2);
    if (theirs.length || hers.length) {
      const bits = [];
      if (theirs.length) bits.push(`theirs: ${theirs.map((p) => p.text).join('; ')}`);
      if (hers.length) bits.push(`hers: ${hers.map((p) => p.text).join('; ')}`);
      lines.push(`Open promises — ${bits.join(' | ')}.`);
    }
    if (this.pendingRequest && this.now() - this.pendingRequest.t < 90) lines.push(`She just asked them to ${this.pendingRequest.spec.what}.`);
    let out = '';
    for (const l of lines) {
      if (out.length + l.length + 1 > max) break;
      out += (out ? '\n' : '') + l;
    }
    return out;
  }

  // ------------------------------------------------------------------ saving

  serialize() {
    const fin = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    return {
      v: 1,
      companionship: this.companionship,
      reason: this.reason,
      stateSince: fin(this.stateSince),
      stateDay: this.stateDay,
      apartReason: this.apartReason,
      apartDay: this.apartDay,
      agenda: { ...this.agenda, today: this.agenda.today.map((b) => ({ ...b })), goals: this.agenda.goals.map((g) => ({ ...g })) },
      ledger: this.ledger.map((e) => ({ ...e })),
      promises: this.promises.map((p) => ({ ...p, params: { ...p.params } })),
      warnings: this.warnings,
      violence: this.violence.slice(),
      lastViolentT: fin(this.lastViolentT),
      lastDownedT: fin(this.lastDownedT),
      grudge: fin(this.grudge),
      violentDebt: fin(this.violentDebt),
      apology: this.apology ? { ...this.apology } : null,
      brokenApologies: this.brokenApologies,
      questStage: this.questStage,
      deals: this.deals.map((d) => ({ ...d })),
      huntOkUntil: fin(this.huntOkUntil),
      asked: { ...this.asked },
      meal: { ...this.meal },
      rentDay: this.rentDay,
      lastJobId: this.lastJobId,
      calibrated: this.calibrated,
      downedByPlayer: !!this.downed?.byPlayer,
      promiseSeq: this._promiseSeq,
      shadow: { ...this._shadow },
    };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const t = (v) => (Number.isFinite(v) ? v : NEG_INF);
    if (STATES.includes(d.companionship)) this.companionship = d.companionship;
    if (typeof d.reason === 'string') this.reason = d.reason;
    this.stateSince = Number.isFinite(d.stateSince) ? d.stateSince : this.now();
    this.stateDay = d.stateDay ?? this.day();
    this.apartReason = d.apartReason ?? null;
    this.apartDay = d.apartDay ?? 0;
    if (d.agenda && typeof d.agenda === 'object') {
      Object.assign(this.agenda, d.agenda);
      this.agenda.today = Array.isArray(d.agenda.today) ? d.agenda.today : [];
      this.agenda.goals = Array.isArray(d.agenda.goals) && d.agenda.goals.length ? d.agenda.goals : weighGoals({});
      this.agenda.purse = num(d.agenda.purse, 0);
    }
    if (Array.isArray(d.ledger)) this.ledger = d.ledger.filter((e) => e && e.deed);
    if (Array.isArray(d.promises)) this.promises = d.promises.filter((p) => p && p.text);
    this.warnings = d.warnings || 0;
    this.violence = Array.isArray(d.violence) ? d.violence.filter(Number.isFinite) : [];
    this.lastViolentT = t(d.lastViolentT);
    this.lastDownedT = t(d.lastDownedT);
    this.grudge = num(d.grudge, 0);
    this.violentDebt = num(d.violentDebt, 0);
    this.apology = d.apology || null;
    this.brokenApologies = d.brokenApologies || 0;
    this.questStage = questStageIndex(d.questStage);
    this.deals = Array.isArray(d.deals) ? d.deals : [];
    this.huntOkUntil = t(d.huntOkUntil);
    this.asked = d.asked && typeof d.asked === 'object' ? { ...d.asked } : {};
    this.meal = d.meal || { day: -1, block: -1 };
    this.rentDay = d.rentDay ?? -1;
    this.lastJobId = d.lastJobId ?? null;
    this.calibrated = d.calibrated !== false;
    // Saved while she lay knocked out by the player: she still decides when she comes to.
    this.downed = d.downedByPlayer ? { t: this.now(), byPlayer: true, abandoned: true, waited: 0 } : null;
    this._promiseSeq = d.promiseSeq || this.promises.length;
    if (d.shadow && typeof d.shadow === 'object') Object.assign(this._shadow, d.shadow);
    this._blockIdx = -2;
    this._hourIdx = null;
    // Her body follows the state she was in.
    const st = this.companionship;
    if (st !== 'together') this._direct(st, null);
    if (st === 'gone' && this.game) {
      this.game.flags = this.game.flags || {};
      if (!this.game.flags.lyra_gone) this.game.flags.lyra_gone = { day: this.stateDay, reason: this.reason };
    }
  }
}

function fillText(text, vars = {}) {
  return String(text || '')
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function planLineKey(b) {
  switch (b.type) {
    case 'work':
      return 'plan_work';
    case 'eat':
      return 'plan_eat';
    case 'sleep':
      return b.bed === 'lyra_bed' ? 'plan_sleep_home' : 'plan_sleep_inn';
    case 'stars':
      return 'plan_free_stars';
    case 'moonpetals':
      return 'plan_free_moonpetals';
    case 'hearth':
      return 'plan_free_rain';
    case 'free':
      return 'plan_free';
    case 'study':
      return 'plan_study';
    case 'lead':
      return 'plan_lead';
    case 'visit':
      return 'plan_visit';
    case 'rest':
      return 'plan_rest';
    default:
      return 'plan_free';
  }
}

function timeWord(from) {
  if (from < 10) return 'This morning';
  if (from < 13) return 'Late morning';
  if (from < 18) return 'This afternoon';
  if (from < 19.6) return 'At supper';
  if (from < 22.5) return 'This evening';
  return 'Then';
}

function fmtHour(h) {
  const x = ((h % 24) + 24) % 24;
  const hh = Math.floor(x);
  const mm = Math.round((x - hh) * 60);
  return mm ? `${hh}:${String(mm).padStart(2, '0')}` : `${hh}`;
}

// The Mind facade (DESIGN §16): mind.autonomy plus its delegates. Only fills what the
// Mind does not already define, so a Mind that wires its own delegates wins.
export function attachAutonomy(mind, game) {
  if (!mind) return null;
  const a = mind.autonomy instanceof Autonomy ? mind.autonomy : mind.autonomy && typeof mind.autonomy.evaluateRequest === 'function' ? mind.autonomy : new Autonomy(mind, game);
  if (!mind.autonomy) mind.autonomy = a;
  const getters = { companionship: () => a.companionship, agenda: () => a.agenda, ledger: () => a.ledger, promises: () => a.promises };
  for (const [k, get] of Object.entries(getters)) {
    if (k in mind) continue;
    try {
      Object.defineProperty(mind, k, { get, configurable: true, enumerable: false });
    } catch {
      /* frozen mind */
    }
  }
  for (const k of ['evaluateRequest', 'setCompanionship', 'reconsider', 'recordDeed', 'planDay']) {
    if (typeof mind[k] !== 'function') mind[k] = (...args) => a[k](...args);
  }
  return a;
}
