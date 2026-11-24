import { PLAYER_ID } from '../../core/constants.js';
import { factionRelation } from '../../entities/entity.js';
import {
  clamp,
  cap,
  pick,
  firstName,
  playerRef,
  isHarmless,
  isVillagerLike,
  isChild,
  isNamedCreature,
  hasLineOfSight,
  countWord,
  joinList,
  firstSentence,
  placePhrase,
  itemPhrase,
} from './text.js';
import { LYRA_PEOPLE, KNOWN_PLACES } from './soul.js';
import { itemName, itemDef } from '../../entities/items.js';

// Perception: turns bus events (and what she can see) into feelings, memories and
// opinions. Owned by the Mind; it subscribes to the bus in the Mind constructor.

const MEET_RADIUS = 56;
const ENCOUNTER_END = 10; // seconds without combat events
const NOTICE_RADIUS = 160;

const TRAIT_AFFINITY = {
  kind: 6, warm: 6, gentle: 5, brave: 6, curious: 5, cheerful: 4, wise: 5, calm: 3, honest: 5, generous: 5,
  funny: 4, playful: 4, loyal: 5, motherly: 5, dutiful: 2, stern: 0, gruff: -1, grumpy: -2, anxious: 1, shy: 2,
  cruel: -20, greedy: -8, sly: -6, dishonest: -12, liar: -12, rude: -6, arrogant: -6, cowardly: -3, lazy: -2, gossip: -1,
};
const TRAIT_RESPECT = { brave: 6, wise: 8, dutiful: 6, stern: 4, skilled: 6, hardworking: 5, clever: 5, gruff: 2, strong: 4 };
const TRAIT_TRUST = { honest: 8, kind: 4, calm: 3, dutiful: 3, gentle: 3, sly: -8, greedy: -5, dishonest: -10 };

const JOB_NAMES = {
  chop_wood: 'chopping wood',
  gather_herbs: 'gathering herbs',
  forage: 'foraging',
  mine_ore: 'mining',
  fish: 'fishing',
  farm: "helping on Tobias's farm",
  cook: 'cooking',
  collect_loot: 'collecting loot',
  patrol: 'patrolling',
  guard: 'standing guard',
};

export function jobId(job) {
  if (!job) return null;
  if (typeof job === 'string') return job;
  return job.id || job.job || job.type || job.name || null;
}

export function jobLabel(job) {
  const id = jobId(job);
  return JOB_NAMES[id] || (id ? String(id).replace(/_/g, ' ') : 'working');
}

function plural(name, n) {
  const s = String(name).replace(/_/g, ' ');
  if (n === 1) return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
  if (/(deer|sheep|fish)$/.test(s)) return `${countWord(n)} ${s}`;
  if (/f$/.test(s)) return `${countWord(n)} ${s.slice(0, -1)}ves`;
  if (/(s|x|ch|sh)$/.test(s)) return `${countWord(n)} ${s}es`;
  return `${countWord(n)} ${s}s`;
}

function foeName(e) {
  if (!e) return 'something';
  if (e.species === 'bandit_chief') return 'bandit chief';
  if (e.species === 'bandit_archer') return 'bandit archer';
  if (e.species) return String(e.species).replace(/_/g, ' ');
  return String(e.name || 'stranger').toLowerCase();
}

const GIFT_LINES = {
  moonpetal: [
    "A moonpetal? For me? ...I'm pressing this in my book. Don't watch me do it.",
    'Moonpetals are my favorite. How did you know? ...Did somebody tell you?',
  ],
  honey_cake: [
    "A honey cake! I take back every unkind thing I've ever thought about you. Nine out of ten. Eleven if it's Elda's.",
    'Honey cake. You absolute treasure. This is the way to my heart, and now you know it.',
  ],
  crystal: ['It hums! Feel that? Maren would have loved this.'],
  lantern: ['A lantern. Light for the lost first. Thank you. Truly.'],
  potion: ["A potion? You're looking after me. I noticed."],
  raw_fish: ["Raw fish. Wonderful. I'll... cherish it. From a distance."],
  slime_gel: ['Is it... still moving? Thank you. I think.'],
  bone: ['A bone. Lovely. Very... bone-like.'],
  wolf_pelt: ["A wolf pelt. I'll be honest, wolves and I have a history."],
  coin: ["Coins? I'm not for hire, you know. ...I'll put them toward honey cakes."],
  food: ["Oh, thank you. I'll save it for when my stomach starts arguing.", 'Food! The way to a mage\'s heart. Lamp-chill is real, you know.'],
  liked: ['Oh, I like this. Thank you.', "That's thoughtful. Thank you."],
  neutral: ["Thank you. I'll find a use for it.", 'For me? Thank you, really.'],
  disliked: ["That's... thank you. It's the thought that counts."],
};

const CRUELTY_LINES = {
  wildlife: ["Hey! It wasn't doing anything to you.", 'Was that necessary?', 'Leave it be. Please.'],
  pet: ['Not the cat. Never the cat.', 'That is Pip\'s cat. What is wrong with you?'],
};

export class Perception {
  constructor(game, mind) {
    this.game = game;
    this.mind = mind;
    this.owner = mind.owner;
    this.clock = 0;
    this.last = new Map(); // throttle key -> real time
    this.met = new Set();
    this.seenPlaces = new Set(KNOWN_PLACES);
    this.place = null;
    this.placeSince = 0;
    this.firstVisit = false;
    this.encounter = null;
    this.lastEncounterEnd = -Infinity;
    this.provokers = new Map(); // entity id -> time it last hurt the player or Lyra
    this.threats = 0;
    this.lastSpoke = -Infinity;
    this.giftsToday = new Map(); // `${day}:${itemId}` -> count
    this.chatToday = { day: 0, gain: 0 };
    this._placeT = 0;
    this._meetT = 0;
    this._slowT = 0;
    this._placeRefresh = 0;
    this.seenAt = new Map(); // person id -> real time she last noticed them (working memory)
    this.lastFearT = -Infinity; // game time the player last frightened her
    this._fearDecayT = null; // game time fear last eased
    this.playerHits = []; // real times the player's attacks landed on her
  }

  rt() {
    return Number.isFinite(this.game?.time) && this.game.time > 0 ? this.game.time : this.clock;
  }

  // True at most once per `seconds` for a key.
  throttle(key, seconds) {
    const t = this.rt();
    const prev = this.last.get(key);
    if (prev != null && t - prev < seconds) return false;
    this.last.set(key, t);
    if (this.last.size > 500) {
      for (const [k, v] of this.last) if (t - v > 600) this.last.delete(k);
    }
    return true;
  }

  get P() {
    return playerRef(this.game);
  }

  isPlayer(e) {
    return !!e && (e === this.game?.player || e.id === PLAYER_ID);
  }

  isSelf(e) {
    return !!e && (e === this.owner || e.id === this.owner?.id);
  }

  placeObj() {
    return this.place ? this.game?.locations?.get?.(this.place) || null : null;
  }

  placeName() {
    return this.placeObj()?.name || 'the wilds';
  }

  // "in the Whisperwood", "at the Ember Kettle".
  where() {
    return placePhrase(this.placeObj());
  }

  // ---------------------------------------------------------------- events

  handle(type, p = {}) {
    if (!p || typeof p !== 'object') p = {};
    switch (type) {
      case 'damage':
        return this.onDamage(p);
      case 'death':
        return this.onDeath(p);
      case 'downed':
        return this.onDowned(p);
      case 'revived':
        return this.onRevived(p);
      case 'heal':
        return this.onHeal(p);
      case 'attack':
        return this.onAttack(p);
      case 'level_up':
        return this.onLevelUp(p);
      case 'item_gained':
        return this.onItemGained(p);
      case 'item_given':
        return this.onItemGiven(p);
      case 'item_used':
        return this.onItemUsed(p);
      case 'door':
        return this.onDoor(p);
      case 'interact':
        return this.onInteract(p);
      case 'harvest':
        return this.onHarvest(p);
      case 'player_message':
        return this.onPlayerMessage(p);
      case 'speech':
        return this.onSpeech(p);
      case 'companion_action':
        return this.onCompanionAction(p);
      case 'npc_meet':
        return this.onNpcMeet(p);
      case 'npc_topic':
        return this.onNpcTopic(p);
      case 'trade':
        return this.onTrade(p);
      case 'time_of_day':
        return this.onTimeOfDay(p);
      case 'weather':
        return this.onWeather(p);
      case 'player_sleep':
        return this.mind.beginSleep(p);
      case 'player_wake':
        return this.mind.wake(p);
      case 'time_skip':
        if ((p.hours || 0) >= 4 && this.game?.state === 'sleeping') this.mind.needsEngine.sleep();
        return;
      case 'job_done':
        return this.onJobDone(p);
      case 'job_failed':
        return this.onJobFailed(p);
      case 'entity_removed':
        if (p.entity?.id) {
          this.mind.relationships.forgetEntity(p.entity.id);
          this.provokers.delete(p.entity.id);
        }
        return;
      case 'settings_changed':
        return this.onSettings(p);
      case 'crime':
        return this.onCrime(p);
      case 'deed':
        return this.onDeed(p);
      case 'companionship_changed':
        return this.onCompanionship(p);
      case 'request_evaluated':
        return this.onRequestEvaluated(p);
      case 'promise':
        return this.onPromise(p);
      case 'plan_changed':
        return this.onPlanChanged(p);
      case 'conversation':
        return this.onConversation(p);
      case 'new_day':
        return this.onNewDay(p);
      case 'room_rented':
        return this.onRoomRented(p);
      case 'quest':
        return this.onQuest(p);
      case 'enter_location':
        // Polling notices her own moves; the event only speeds it up.
        if (this.isSelf(p.actor)) this._placeT = 0;
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- combat

  severity(target, amount) {
    return clamp(((amount || 1) / Math.max(1, target?.maxHp || 30)) * 4, 0.2, 1.5);
  }

  provoked(e) {
    const t = this.provokers.get(e?.id);
    return t != null && this.rt() - t < 30;
  }

  onDamage({ source, target, amount }) {
    if (!target) return;
    const m = this.mind;
    const sev = this.severity(target, amount);
    if (this.isSelf(target)) {
      if (this.encounter) this.encounter.lyraHurt += amount || 0;
      if (this.isPlayer(source)) return this.hitByPlayer();
      if (!source || this.isSelf(source)) return;
      this.touchEncounter(source);
      if (this.throttle('hurt', 1.2)) m.appraise('hurt', sev, `hit by ${foeName(source)}`);
      this.markAttacker(source);
      const frac = (target.hp ?? 1) / Math.max(1, target.maxHp || 1);
      if (frac < 0.3 && this.throttle('low_hp', 25)) m.appraise('threat', 0.8, 'badly hurt');
      return;
    }
    if (this.isPlayer(target)) {
      if (this.isSelf(source)) {
        if (this.throttle('hit_player', 20)) {
          m.feel('embarrassment', 0.35, 'hit my friend');
          m.say(pick(['Sorry! Sorry. That was meant for the other one.', 'Oh no. Are you all right? That was me.'], this.game?.rng));
        }
        return;
      }
      if (!source) return;
      this.touchEncounter(source);
      if (this.throttle('ally_hurt', 1.5)) m.appraise('ally_hurt', sev, `${foeName(source)} hurt ${this.P}`);
      this.markAttacker(source);
      return;
    }
    if (this.isPlayer(source)) {
      if (isVillagerLike(target) && !this.provoked(target)) this.playerHurtVillager(target, 'assault');
      else if (this.isCrueltyTarget(target) && !this.provoked(target)) this.cruelty(target, false);
      else this.touchEncounter(target);
      return;
    }
    if (this.isSelf(source)) {
      this.touchEncounter(target);
      return;
    }
    if (isVillagerLike(target) && source && !isVillagerLike(source)) {
      this.provokers.set(source.id, this.rt());
      m.relationships.setTempTag(source, 'enemy');
      const rel = m.relationships.get(target.id);
      if (this.throttle(`villager_hurt_${target.id}`, 20) && this.near(target, NOTICE_RADIUS * 1.5)) {
        m.appraise('ally_hurt', 0.6, `${target.name} attacked`);
        if (rel) m.addThought(`${firstName(target.name)} is in trouble. Not on my watch.`, 'perception');
      }
    }
  }

  isCrueltyTarget(e) {
    if (!e || this.isSelf(e) || this.isPlayer(e)) return false;
    if (isHarmless(e) || isVillagerLike(e)) return true;
    const rel = this.mind.relationships.get(e.id);
    return !!rel && (rel.tags.includes('pet') || rel.tags.includes('friend'));
  }

  // The attacker becomes an enemy: a record for people and named creatures, a
  // short-lived tag for an anonymous wolf. Villagers get the benefit of the doubt.
  markAttacker(source) {
    if (!source || this.isPlayer(source) || this.isSelf(source)) return;
    const m = this.mind;
    this.provokers.set(source.id, this.rt());
    if (isVillagerLike(source)) {
      if (this.throttle(`villager_hit_${source.id}`, 30)) {
        m.relationships.ensure(source);
        m.relationships.adjust(source.id, { affinity: -6, trust: -6 }, 'Attacked us');
        m.relationships.addNote(source.id, 'Raised a hand against us.', 'observed');
      }
      return;
    }
    if (m.relationships.worthRecording(source)) {
      m.relationships.ensure(source);
      if (!m.relationships.hasTag(source.id, 'enemy')) {
        m.relationships.setTag(source.id, 'enemy', true);
        m.relationships.adjust(source.id, { affinity: -15, trust: -10 }, 'Attacked us');
      }
    } else {
      m.relationships.setTempTag(source, 'enemy');
    }
  }

  // Is a hostile creature close to her? (Telling a stray swing from a deliberate one.)
  hostileNear(r) {
    const o = this.owner;
    const list = this.game?.entities?.all?.();
    if (!o || !list) return false;
    const r2 = r * r;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === o || e.removed || e.type !== 'actor' || e.dead || this.isPlayer(e)) continue;
      if (typeof e.isAlive === 'function' && !e.isAlive()) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      if (dx * dx + dy * dy > r2) continue;
      if (factionRelation('player', e.faction) === 'hostile' || (e.species && !this.mind.relationships.isFriend(e))) return true;
    }
    return false;
  }

  raisedFear() {
    this.lastFearT = this.game?.clock?.t ?? 0;
  }

  // The player's blow landed on her (DESIGN §16.2): an accident when a hostile creature
  // is within 48 px of her and it is the first hit in 8 s; otherwise deliberate. Either
  // way her fear of the player rises. What it means for the two of them (the ledger,
  // warnings, leaving) is her autonomy's call, so nothing is recorded or said here
  // beyond the gasp of an accident.
  hitByPlayer() {
    const m = this.mind;
    const t = this.rt();
    const recent = this.playerHits.filter((x) => t - x < 60);
    const firstIn8 = !recent.some((x) => t - x < 8);
    this.playerHits = [...recent, t].slice(-6);
    if (firstIn8 && this.hostileNear(48)) {
      if (this.throttle('friendly_fire', 4)) {
        m.feel('surprise', 0.3, 'caught by a stray swing');
        m.relationships.adjust(PLAYER_ID, { affinity: -1, fear: 1 }, 'Hit me by accident');
        this.raisedFear();
        if (this.throttle('friendly_fire_say', 30)) m.say(pick(['Ow! Same side, remember?', 'Watch the swing! I bruise.', "Mind your edge! That was my arm."], this.game?.rng));
      }
      return;
    }
    const again = recent.length > 0;
    m.appraise('betrayal', again ? 1.3 : 1, `${this.P} hit me`);
    m.relationships.adjust(PLAYER_ID, { fear: again ? 12 : 8 }, again ? 'Hit me again' : 'Hit me, and meant it');
    this.raisedFear();
    m.notice(`person:${PLAYER_ID}`, { source: 'threat', amount: 0.9, reminisce: false });
    if (this.throttle('hit_on_purpose_thought', 8)) {
      m.addThought(again ? `Again. ${cap(this.P)} hit me again.` : `${cap(this.P)} hit me. That was no accident.`, 'perception', { show: true, minGap: 4 });
    }
  }

  // The player struck a villager or a guard (assault), knocked one out, or worse. Her
  // feelings and her fear of the player are hers to have here; the deed itself goes to
  // the ledger (autonomy), which also decides what she does about it.
  playerHurtVillager(target, kind = 'assault') {
    if (!target) return;
    const m = this.mind;
    const gap = kind === 'assault' ? 10 : 30;
    if (!this.throttle(`${kind}_${target.id}`, gap)) return;
    const n = firstName(target.name || 'someone');
    const child = isChild(target);
    const fear = kind === 'killed' ? 18 : kind === 'knockout' ? 10 : child ? 7 : 5;
    m.appraise('cruelty', kind === 'assault' ? 1 : 1.4, `${this.P} hurt ${n}`);
    m.appraise('betrayal', kind === 'assault' ? 0.5 : 0.9, `${this.P} hurt ${n}`);
    m.relationships.adjust(PLAYER_ID, { fear }, kind === 'assault' ? `Attacked ${n}` : `Knocked ${n} down`);
    this.raisedFear();
    m.notice(`person:${target.id}`, { source: 'threat', amount: 0.8, reminisce: false });
    m.notice(`person:${PLAYER_ID}`, { source: 'threat', amount: 0.9, reminisce: false });
    if (this.throttle(`villager_thought_${target.id}`, 20)) {
      const line =
        kind === 'assault'
          ? child
            ? `${n} is a child. What is ${this.P} doing?`
            : `${cap(this.P)} just struck ${n}. ${n}, who never did anything to anyone.`
          : `${n} is down, and ${this.P} did it. I don't know who I'm walking beside.`;
      m.addThought(line, 'perception', { show: true, minGap: 4 });
    }
  }

  // Cruelty to a harmless creature or a pet: it upsets her and lowers her opinion of the
  // player. A kill also goes to the ledger (autonomy, 'killed_harmless'), so she keeps a
  // memory only of the hurt, not of the kill.
  cruelty(target, killed) {
    const m = this.mind;
    if (isVillagerLike(target)) return this.playerHurtVillager(target, killed ? 'killed' : 'assault');
    if (!this.throttle(`cruel_${target.id}`, killed ? 1 : 25) || !this.throttle(killed ? 'cruel_kill' : 'cruel', killed ? 3 : 6)) return;
    const rel = m.relationships.get(target.id);
    const pet = !!rel?.tags.includes('pet') || target.species === 'cat';
    const what = rel && isNamedCreature(target) ? target.name : `${pet ? 'the' : 'a'} ${foeName(target)}`;
    m.appraise('cruelty', killed ? 1.1 : 0.8, `${this.P} hurt ${what}`);
    const changes = { affinity: killed ? -3 : -3, respect: killed ? -2 : -2, trust: -1, fear: killed ? 2 : 1 };
    if (pet) {
      changes.affinity -= 4;
      changes.trust -= 3;
      changes.fear += 2;
    }
    m.relationships.adjust(PLAYER_ID, changes, killed ? `Killed ${what}` : `Hurt ${what} for no reason`);
    this.raisedFear();
    m.relationships.addNote(PLAYER_ID, killed ? `Killed ${what} that never threatened anyone.` : `Hurt ${what} that wasn't doing anything.`, 'observed');
    if (!killed) {
      m.remember(`${cap(this.P)} hurt ${what} that wasn't doing anything${this.place ? ` ${this.where()}` : ''}. I didn't like it.`, {
        importance: pet ? 6 : 4,
        about: rel ? [PLAYER_ID, target.id] : [PLAYER_ID],
        tags: ['cruelty', target.species || 'creature'],
        emotion: 'anger',
        gist: `the ${foeName(target)} ${this.P} hurt`,
      });
    }
    if (this.throttle('cruel_say', killed ? 6 : 18)) {
      const kind = pet ? 'pet' : 'wildlife';
      const line = killed ? (pet ? 'You killed the cat. ...Get away from me.' : "...You didn't have to do that.") : pick(CRUELTY_LINES[kind], this.game?.rng);
      m.say(line, { kind: 'say' });
    }
  }

  touchEncounter(foe) {
    if (!foe || this.isSelf(foe) || this.isPlayer(foe)) return;
    if (this.mind.relationships.isFriend(foe)) return;
    const t = this.rt();
    let enc = this.encounter;
    if (!enc) {
      enc = this.encounter = {
        start: t,
        last: t,
        foes: new Map(),
        kills: 0,
        place: this.place,
        lyraDowned: false,
        playerDowned: false,
        lyraHurt: 0,
      };
      const threat = Number.isFinite(foe.threat) ? foe.threat : factionRelation('player', foe.faction) === 'hostile' ? 1.5 : 0.5;
      this.mind.appraise('threat', clamp(0.35 + threat * 0.25, 0.3, 1.2), `${foeName(foe)} attacked`);
    }
    enc.last = t;
    if (!enc.foes.has(foe.id)) enc.foes.set(foe.id, { name: foeName(foe), species: foe.species || null, dead: false, chief: foe.species === 'bandit_chief' });
  }

  finishEncounter() {
    const enc = this.encounter;
    this.encounter = null;
    this.lastEncounterEnd = this.rt();
    if (!enc || !enc.foes.size) return;
    const m = this.mind;
    const counts = new Map();
    let chief = false;
    for (const f of enc.foes.values()) {
      counts.set(f.name, (counts.get(f.name) || 0) + 1);
      if (f.chief) chief = true;
    }
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (name === 'bandit chief' ? 'the bandit chief' : plural(name, n)));
    const foesText = joinList(parts);
    const loc = enc.place ? this.game?.locations?.get?.(enc.place) : null;
    const where = loc ? ` ${placePhrase(loc)}` : '';
    const total = enc.foes.size;
    const won = enc.kills > 0 && !enc.lyraDowned && !enc.playerDowned;
    const P = this.P;
    const near = this.near(this.game?.player, 200);
    let text = `Fought ${foesText}${where}${near ? ` with ${P}` : ''}.`;
    if (enc.playerDowned) text += ` ${cap(P)} went down. I've never been so scared.`;
    else if (enc.lyraDowned) text += ' I went down. Everything went grey for a moment.';
    else if (enc.lyraHurt > (this.owner?.maxHp || 50) * 0.5) text += ' I took a beating, but we held.';
    else if (won) text += pick([' We won, and nobody got worse than bruises.', ' We made short work of it.', ' Not a scratch worth mentioning.'], this.game?.rng);
    else text += ' They ran, or we did. Hard to say.';
    const importance = clamp(2 + Math.min(4, total) + (chief ? 2 : 0) + (enc.lyraDowned || enc.playerDowned ? 2 : 0) + ((loc?.danger || 0) >= 2 ? 1 : 0), 2, 9);
    m.remember(text, {
      importance,
      about: near ? [PLAYER_ID] : [],
      tags: ['fight', ...new Set([...enc.foes.values()].map((f) => f.species).filter(Boolean))],
      location: enc.place,
      emotion: won ? 'pride' : 'fear',
      gist: `the fight with ${foesText}${where}`,
    });
    m.appraise(won ? 'victory' : 'relief', clamp(0.5 + total * 0.15, 0.5, 1.2), 'the fight is over');
    if (near) m.relationships.adjust(PLAYER_ID, { trust: 1.5, familiarity: 1, respect: won ? 1 : 0 }, 'Fought side by side');
  }

  onDeath({ entity, killer }) {
    if (!entity) return;
    const m = this.mind;
    const enc = this.encounter;
    if (enc && enc.foes.has(entity.id)) {
      enc.foes.get(entity.id).dead = true;
      if (this.isPlayer(killer) || this.isSelf(killer)) enc.kills++;
      enc.last = this.rt();
    }
    const rel = m.relationships.get(entity.id);
    if (this.isPlayer(killer)) {
      if (this.isCrueltyTarget(entity) && !this.provoked(entity)) this.cruelty(entity, true);
      else if (factionRelation('player', entity.faction) === 'hostile' && this.throttle('kill_respect', 20)) {
        m.relationships.adjust(PLAYER_ID, { respect: 0.6 }, '');
      }
    } else if (this.isSelf(killer)) {
      if (entity.kind === 'human' || entity.faction === 'bandit') {
        if (this.throttle('killed_person', 40)) {
          m.feel('sadness', 0.1, 'took a life');
          m.addThought(pick(["I don't enjoy that part. I never will.", 'Fire for the wicked last. It was last. It still sits heavy.'], this.game?.rng), 'perception');
        }
      } else if (isHarmless(entity)) {
        m.feel('sadness', 0.15, 'killed a harmless creature');
      } else if (this.throttle('kill_pride', 10)) {
        m.feel('pride', 0.08, 'a clean shot');
      }
    }
    if (rel && !rel.tags.includes('enemy') && (rel.npc || rel.tags.includes('pet') || rel.tags.includes('friend')) && !this.isPlayer(killer)) {
      m.appraise('loss', 1, `${rel.name} died`);
      m.remember(`${rel.name} died ${this.where()}. I was too slow. I keep being too slow.`, {
        importance: 9,
        about: [rel.id],
        tags: ['death', 'grief'],
        emotion: 'sadness',
        gist: `losing ${firstName(rel.name)}`,
      });
      m.relationships.addNote(rel.id, `Died ${this.where()}.`, 'observed');
    }
    m.relationships.forgetEntity(entity.id);
    this.provokers.delete(entity.id);
  }

  onDowned({ entity, by }) {
    const m = this.mind;
    if (this.isSelf(entity)) {
      if (this.encounter) this.encounter.lyraDowned = true;
      if (this.isPlayer(by)) {
        // The player knocked her out. The ledger and her leaving are autonomy's; the
        // terror is hers.
        m.appraise('betrayal', 1.6, `${this.P} knocked me down`);
        m.relationships.adjust(PLAYER_ID, { fear: 25 }, 'Knocked me out');
        this.raisedFear();
        m.addThought(`${cap(this.P)}... did this. To me.`, 'perception');
        return;
      }
      m.appraise('loss', 0.5, 'knocked down');
      m.feel('embarrassment', 0.2, 'knocked down');
      m.remember(`I went down ${this.where()}${by ? `, to ${plural(foeName(by), 1)}` : ''}. Everything went grey.`, {
        importance: 7,
        tags: ['downed', by?.species].filter(Boolean),
        emotion: 'fear',
        gist: `going down ${this.where()}`,
      });
    } else if (this.isPlayer(entity)) {
      if (this.encounter) this.encounter.playerDowned = true;
      m.appraise('loss', 0.9, `${this.P} fell`);
      m.remember(`${cap(this.P)} fell ${this.where()}${by ? `, cut down by ${plural(foeName(by), 1)}` : ''}. I couldn't reach them in time. Not again. Never again.`, {
        importance: 8,
        about: [PLAYER_ID],
        tags: ['downed', 'fear', 'loss'],
        emotion: 'fear',
        gist: `watching ${this.P} fall`,
      });
      m.addThought('No. No, no, no. Not again.', 'perception', { show: true });
    } else if (entity && this.isPlayer(by) && isVillagerLike(entity)) {
      this.playerHurtVillager(entity, 'knockout');
    }
  }

  onRevived({ entity, by }) {
    const m = this.mind;
    if (this.isSelf(entity)) {
      if (this.isPlayer(by)) {
        m.appraise('rescue', 1, `${this.P} came back for me`);
        // The ledger adds its own weight for this deed (revived_lyra); this is the gratitude.
        m.relationships.adjust(PLAYER_ID, { trust: 6, affinity: 4, respect: 2, familiarity: 2 }, 'Came back for me');
        m.relationships.addNote(PLAYER_ID, 'Came back for me when I was down.', 'observed');
        m.remember(`${cap(this.P)} came back for me. I was down ${this.where()}, and they came back for me.`, {
          importance: 9,
          about: [PLAYER_ID],
          tags: ['revived', 'trust', 'rescue'],
          emotion: 'trust',
          gist: `the time ${this.P} came back for me`,
        });
        m.say(pick(['You came back for me.', "You came back. ...Of course you did. Thank you."], this.game?.rng), { chat: true });
      } else {
        m.remember(`Got back up on my own ${this.where()}. Slowly.`, { importance: 4, tags: ['downed'], emotion: 'sadness' });
        m.feel('sadness', 0.15, 'got up alone');
      }
    } else if (this.isPlayer(entity) && this.isSelf(by)) {
      m.feel('pride', 0.25, `got ${this.P} back up`);
      m.feel('affection', 0.15, `got ${this.P} back up`);
      m.remember(`I got ${this.P} back on their feet ${this.where()}. My hands didn't stop shaking for an hour.`, {
        importance: 7,
        about: [PLAYER_ID],
        tags: ['revived', 'rescue'],
        emotion: 'pride',
      });
    }
  }

  onHeal({ source, target, amount }) {
    if (!target || !(amount > 0)) return;
    const m = this.mind;
    if (this.isSelf(source) && this.isPlayer(target)) {
      if (this.throttle('healed_player', 30)) {
        m.feel('affection', 0.05, 'mended them');
        m.feel('pride', 0.04, 'mended them');
        const rel = m.relationships.get(PLAYER_ID);
        if (rel) rel.interactions++;
      }
    } else if (this.isPlayer(source) && this.isSelf(target)) {
      if (this.throttle('player_healed_me', 20)) {
        m.appraise('kindness', 0.8, `${this.P} healed me`);
        m.relationships.adjust(PLAYER_ID, { trust: 3, affinity: 2 }, 'Patched me up');
      }
    } else if (source && this.isSelf(target) && !this.isSelf(source) && source.type === 'actor') {
      if (this.throttle(`healed_by_${source.id}`, 30)) {
        m.relationships.ensure(source);
        m.relationships.adjust(source.id, { affinity: 4, trust: 3 }, 'Healed me');
        m.appraise('kindness', 0.6, `${source.name} healed me`);
      }
    }
  }

  onAttack({ attacker, target }) {
    if (!attacker || !target) return;
    if ((this.isSelf(target) || this.isPlayer(target)) && !this.isPlayer(attacker) && !this.isSelf(attacker)) {
      this.touchEncounter(attacker);
    }
  }

  onLevelUp({ entity, level }) {
    const m = this.mind;
    if (this.isSelf(entity)) {
      m.appraise('level_up', 1, 'grew stronger');
      m.remember(`I've grown stronger: level ${level}. Maren would pretend not to be impressed.`, { importance: 5, tags: ['level_up'], emotion: 'pride' });
      m.addThought(`Level ${level}. I can feel it in my fingertips. Steadier sparks.`, 'perception', { show: true });
    } else if (this.isPlayer(entity) && this.throttle('player_level', 30)) {
      m.feel('joy', 0.12, `${this.P} grew stronger`);
      m.relationships.adjust(PLAYER_ID, { respect: 1 }, '');
    }
  }

  // ---------------------------------------------------------------- items

  onItemGained({ actor, itemId, from }) {
    const m = this.mind;
    if (!this.isSelf(actor)) return;
    if (itemId && itemId !== 'coin') m.notice(`item:${itemId}`, { source: 'item', amount: 0.5 });
    if (itemId === 'moonpetal' && this.throttle('moonpetal_gain', 30)) {
      m.feel('joy', 0.18, 'a moonpetal');
      if (this.throttle('moonpetal_memory', 600)) {
        m.remember(`Found a moonpetal${this.place ? ` ${this.where()}` : ''}, glowing like a little moon. I'm keeping it.`, {
          importance: 4,
          tags: ['moonpetal'],
          emotion: 'joy',
          gist: 'finding a moonpetal',
        });
        const g = m.goals.find((x) => x.id === 'moonpetals' && !x.done);
        if (g) m.completeGoal(g.id);
      }
    }
    if (from === 'loot' && this.throttle('loot_fun', 20)) m.needsEngine.satisfy('fun', 0.02);
  }

  onItemGiven({ from, to, itemId, qty }) {
    if (!itemId) return;
    if ((this.isSelf(to) || this.isSelf(from)) && itemId !== 'coin') this.mind.notice(`item:${itemId}`, { source: 'item', amount: 0.5, reminisce: this.isSelf(to) });
    if (this.isSelf(to) && from && !this.isSelf(from)) return this.giftReceived(from, itemId, qty || 1);
    if (this.isPlayer(from) && to && !this.isSelf(to) && (isVillagerLike(to) || to.profile)) {
      if (!this.throttle(`kind_${to.id}`, 300)) return;
      const m = this.mind;
      m.appraise('kindness', 0.6, `${this.P} gave ${to.name} a gift`);
      m.relationships.adjust(PLAYER_ID, { affinity: 2, respect: 1 }, `Was kind to ${firstName(to.name)}`);
      m.relationships.addNote(PLAYER_ID, `Gave ${firstName(to.name)} a gift, unasked.`, 'observed');
      m.remember(`${cap(this.P)} gave ${to.name} ${itemPhrase(itemId, itemName(itemId), qty || 1)}. Small kindnesses add up.`, {
        importance: 3,
        about: [PLAYER_ID, to.id],
        tags: ['kindness', 'gift'],
        emotion: 'affection',
      });
    }
  }

  giftReceived(giver, itemId, qty) {
    const m = this.mind;
    if (itemId === 'maren_journal') return; // the quest plugin handles the journal
    const tastes = m.soul.giftTastes || {};
    const def = itemDef(itemId);
    let taste = tastes[itemId];
    if (taste == null) taste = def?.type === 'food' ? 1 : 0;
    const kind = taste >= 2 ? 'gift_loved' : taste === 1 ? 'gift_liked' : taste === 0 ? 'gift_neutral' : 'gift_disliked';
    const day = this.game?.clock?.day ?? 1;
    const key = `${day}:${itemId}`;
    const n = this.giftsToday.get(key) || 0;
    this.giftsToday.set(key, n + 1);
    if (this.giftsToday.size > 40) for (const k of this.giftsToday.keys()) if (!k.startsWith(`${day}:`)) this.giftsToday.delete(k);
    const fresh = 1 / (1 + n); // the fifth honey cake of the day still delights, a little less
    m.appraise(kind, 0.5 + fresh * 0.5, `a gift: ${itemName(itemId)}`);
    const giverId = this.isPlayer(giver) ? PLAYER_ID : giver.id;
    if (!this.isPlayer(giver)) m.relationships.ensure(giver);
    const base = { gift_loved: { affinity: 7, trust: 2, familiarity: 2 }, gift_liked: { affinity: 4, familiarity: 1 }, gift_neutral: { affinity: 1.5 }, gift_disliked: { affinity: -1 } }[kind];
    const scaled = {};
    for (const [k, v] of Object.entries(base)) scaled[k] = v > 0 ? v * fresh : v;
    m.relationships.adjust(giverId, scaled, `Gave me ${itemPhrase(itemId, itemName(itemId), qty)}`);
    const rel = m.relationships.get(giverId);
    if (rel) rel.interactions++;
    const gname = this.isPlayer(giver) ? cap(this.P) : giver.name;
    const reaction = { gift_loved: 'I could have cried.', gift_liked: 'It made my day.', gift_neutral: 'Thoughtful.', gift_disliked: 'I smiled anyway.' }[kind];
    if (n < 2) {
      m.remember(`${gname} gave me ${itemPhrase(itemId, itemName(itemId), qty)}. ${reaction}`, {
        importance: kind === 'gift_loved' ? 6 : kind === 'gift_liked' ? 4 : 3,
        about: [giverId],
        tags: ['gift', itemId],
        emotion: kind === 'gift_disliked' ? 'embarrassment' : 'joy',
        gist: `the ${itemName(itemId).toLowerCase()} ${this.isPlayer(giver) ? this.P : giver.name} gave me`,
      });
    }
    let pool = GIFT_LINES[itemId];
    if (!pool) pool = def?.type === 'food' && taste >= 0 ? GIFT_LINES.food : taste >= 1 ? GIFT_LINES.liked : taste === 0 ? GIFT_LINES.neutral : GIFT_LINES.disliked;
    if (this.throttle('gift_say', 3)) m.say(pick(pool, this.game?.rng), { chat: this.isPlayer(giver), target: giver });
  }

  onItemUsed({ actor, itemId }) {
    if (!this.isSelf(actor)) return;
    const m = this.mind;
    m.notice(`item:${itemId}`, { source: 'item', amount: 0.4 });
    m._ateFlag = true;
    if (m.needsEngine.eat(itemId) > 0 && itemId === 'honey_cake') m.feel('joy', 0.15, 'honey cake');
    if (itemDef(itemId)?.type === 'potion') m.appraise('relief', 0.5, 'a potion');
  }

  // ---------------------------------------------------------------- world

  onDoor({ door, actor, open }) {
    if (!door || !open) return;
    const m = this.mind;
    if ((door.id === 'ruins_gate' || /ruins/i.test(door.name || '')) && this.throttle('ruins_gate_open', 3600)) {
      m.appraise('hope', 0.8, 'the ruins gate opened');
      m.remember('The ruins gate groaned open, after a hundred and ten years. Cold air came out of the dark like a held breath. Maren is somewhere past this.', {
        importance: 7,
        tags: ['sunken_ruins', 'gate', 'maren'],
        about: ['maren'],
        emotion: 'fear',
        gist: 'the ruins gate opening',
      });
    }
  }

  onInteract({ actor, target }) {
    if (this.isPlayer(actor) && this.isSelf(target)) this.mind.needsEngine.satisfy('social', 0.03);
  }

  onHarvest({ actor, itemId }) {
    if (!this.isSelf(actor)) return;
    const m = this.mind;
    if (itemId === 'raw_fish' || itemId === 'moonpetal' || itemId === 'berries') m.needsEngine.satisfy('fun', 0.025);
    if (this.throttle(`harvest_mem_${itemId}`, 400)) {
      const what = itemName(itemId).toLowerCase();
      m.remember(`Gathered ${what}${this.place ? ` ${this.where()}` : ''}. Honest work; my hands smell of it.`, {
        importance: 2,
        tags: ['work', itemId],
        emotion: 'pride',
      });
    }
  }

  onJobDone({ actor, job, result }) {
    if (!this.isSelf(actor)) return;
    const m = this.mind;
    const id = jobId(job);
    m.appraise('achievement', 1, `finished ${jobLabel(job)}`);
    if (id === 'fish' || id === 'forage' || id === 'gather_herbs') m.needsEngine.satisfy('fun', 0.05);
    if (this.throttle(`job_mem_${id}`, 300)) {
      const items = Array.isArray(result?.items) ? result.items.map((x) => itemPhrase(x.id, itemName(x.id), x.qty)) : [];
      m.remember(`Finished ${jobLabel(job)}${this.place ? ` ${this.where()}` : ''}${items.length ? `: ${joinList(items)}` : ''}.`, {
        importance: 3,
        about: [PLAYER_ID],
        tags: ['work', id].filter(Boolean),
        emotion: 'pride',
        gist: jobLabel(job),
      });
    }
    const rel = m.relationships.get(PLAYER_ID);
    if (rel && this.throttle('job_trust', 120)) m.relationships.adjust(PLAYER_ID, { familiarity: 0.5 }, '');
  }

  onJobFailed({ actor, job, reason }) {
    if (!this.isSelf(actor) || !this.throttle(`job_fail_${jobId(job)}`, 60)) return;
    this.mind.appraise('failure', 0.6, reason ? String(reason) : `couldn't finish ${jobLabel(job)}`);
  }

  // ---------------------------------------------------------------- talk

  onPlayerMessage({ text }) {
    const m = this.mind;
    if (!text) return;
    m.addConversation('player', String(text));
    m.noticeText(String(text));
    m.needsEngine.satisfy('social', 0.07);
    if (this.throttle('chat_social', 10)) m.appraise('social', 0.6, 'talking with you');
    const day = this.game?.clock?.day ?? 1;
    if (this.chatToday.day !== day) this.chatToday = { day, gain: 0 };
    if (this.chatToday.gain < 6) {
      this.chatToday.gain += 0.5;
      const rel = m.relationships.get(PLAYER_ID);
      if (rel) rel.familiarity = Math.min(100, rel.familiarity + 0.5);
    }
  }

  onSpeech({ speaker, text, target, kind }) {
    if (!speaker || !text) return;
    const m = this.mind;
    if (this.isSelf(speaker)) {
      this.lastSpoke = this.rt();
      if ((target == null || this.isPlayer(target)) && kind !== 'bark') m.addConversation('lyra', String(text));
      return;
    }
    if (this.isPlayer(speaker)) return;
    if (!this.near(speaker, NOTICE_RADIUS)) return;
    if (this.throttle(`heard_topics_${speaker.id}`, 6)) m.noticeText(String(text), { source: 'overheard', amount: 0.3 });
    // Said to her face, in a talk she is having: the conversation itself is remembered.
    if (/\bmaren\b/i.test(text) && !this.isSelf(target) && this.throttle('heard_maren', 120)) {
      m.appraise('hope', 0.6, `${speaker.name} spoke of Maren`);
      m.remember(`Heard ${speaker.name || 'someone'} mention Maren: "${firstSentence(text, 120)}"`, {
        importance: 6,
        about: speaker.id ? ['maren', speaker.id] : ['maren'],
        tags: ['maren', 'overheard'],
        emotion: 'curiosity',
      });
    }
    if (this.isSelf(target)) {
      m.needsEngine.satisfy('social', 0.03);
      const rel = m.relationships.get(speaker.id);
      if (rel && this.throttle(`spoke_to_me_${speaker.id}`, 60)) rel.interactions++;
    }
  }

  onCompanionAction({ name, args, source, ok }) {
    if (name !== 'attack' || ok || source === 'self') return;
    const ref = args?.target;
    if (!ref) return;
    const m = this.mind;
    const ent = this.game?.entities?.byName?.(ref) || this.game?.entities?.get?.(ref) || m.relationships.get(ref);
    if (!ent || !m.relationships.isFriend(ent) || this.isPlayer(ent)) return;
    if (this.throttle('asked_attack_friend', 60)) {
      m.feel('anger', 0.12, 'asked to attack a friend');
      m.relationships.adjust(PLAYER_ID, { respect: -1 }, `Asked me to attack ${ent.name || ref}`);
    }
  }

  onNpcMeet({ a, b }) {
    if (this.isSelf(a) && b && !this.met.has(b.id)) this.meet(b, false);
    else if (this.isSelf(b) && a && !this.met.has(a.id)) this.meet(a, false);
  }

  onNpcTopic({ npc, topic }) {
    if (!npc || !/maren/i.test(String(topic || ''))) return;
    if (!this.near(npc, NOTICE_RADIUS) || !this.throttle(`topic_maren_${npc.id}`, 60)) return;
    this.mind.appraise('hope', 0.7, `asking ${npc.name} about Maren`);
    this.mind.addThought(`Every word, ${this.P}. I'm listening to every word.`, 'perception', { show: true });
  }

  // ---------------------------------------------------------------- her own will (§16.9)

  onCrime({ actor, victim, kind }) {
    if (!this.isPlayer(actor) || !victim) return;
    this.playerHurtVillager(victim, kind === 'knockout' ? 'knockout' : 'assault');
  }

  // A deed entered her ledger (autonomy records and remembers it); here it is felt.
  onDeed({ deed, severity, text }) {
    const m = this.mind;
    const sev = Number(severity) || 0;
    const cause = String(text || deed || '');
    if (sev <= -2) m.appraise('betrayal', clamp(-sev / 4, 0.4, 1.6), cause);
    else if (sev < 0) {
      m.feel('anger', 0.08 * -sev, cause);
      m.feel('sadness', 0.05 * -sev, cause);
    } else if (sev >= 2) m.appraise('goodness', clamp(sev / 3, 0.5, 1.2), cause);
    else if (sev > 0) {
      m.feel('trust', 0.08 * sev, cause);
      m.feel('joy', 0.06 * sev, cause);
    }
    if (sev) m.notice(`person:${PLAYER_ID}`, { source: 'deed', amount: clamp(0.4 + Math.abs(sev) * 0.1, 0.4, 1), reminisce: false });
  }

  onCompanionship({ state, previous }) {
    const m = this.mind;
    const P = this.P;
    let line = null;
    if (state === 'wary') {
      m.appraise('threat', 0.5, 'wary of them');
      line = `I'm keeping my distance from ${P} for now. I hate that I have to.`;
    } else if (state === 'left') {
      m.appraise('loss', 0.7, `leaving ${P}`);
      m.feel('anger', 0.3, `leaving ${P}`);
      line = `I'm on my own again. Better alone than beside someone I have to watch.`;
    } else if (state === 'gone') {
      m.appraise('grief', 0.9, `done with ${P}`);
      line = "That's the end of it. I'll grieve the person I thought they were, and keep walking.";
    } else if (state === 'apart') {
      m.feel('joy', 0.05, 'my own day');
      line = 'My own day, my own road. It feels good. A little strange, but good.';
    } else if (state === 'together') {
      m.appraise('relief', previous === 'left' || previous === 'wary' ? 0.7 : 0.4, `back with ${P}`);
      m.feel('trust', 0.12, `back with ${P}`);
      line = previous === 'left' || previous === 'wary' ? `Together again. Don't make me regret it, ${P}.` : `Back on the road with ${P}. I missed this, a little.`;
    }
    m.notice(`person:${PLAYER_ID}`, { source: 'companionship', amount: 0.8, reminisce: false });
    if (line) m.addThought(line, 'perception', { show: true, minGap: 8 });
  }

  // Her gut said no to something the player asked: a flicker of resolve, nothing more.
  onRequestEvaluated({ action, verdict }) {
    const d = verdict?.decision;
    if (!d || !String(d).startsWith('refuse')) return;
    const m = this.mind;
    m.feel('anger', 0.04, `asked to ${action}`);
    m.feel('pride', 0.03, 'held my ground');
    const why = Array.isArray(verdict.reasons) && verdict.reasons[0] ? String(verdict.reasons[0]) : '';
    if (this.throttle('refusal_thought', 20)) m.addThought(`I said no${action ? ` to ${String(action).replace(/_/g, ' ')}` : ''}.${why ? ` ${cap(why.replace(/[.!]*$/, '.'))}` : ''} I meant it.`, 'perception');
  }

  onPromise({ by, state }) {
    const m = this.mind;
    const player = by === 'player' || by === PLAYER_ID;
    if (state === 'kept') {
      if (player) m.appraise('kindness', 0.8, 'a promise kept');
      else m.feel('pride', 0.1, 'kept my word');
    } else if (state === 'broken') {
      if (player) {
        m.feel('sadness', 0.18, 'a broken promise');
        m.feel('anger', 0.12, 'a broken promise');
      } else m.feel('embarrassment', 0.2, 'broke my word');
    } else if (player) m.feel('trust', 0.04, 'a promise');
  }

  onPlanChanged() {
    this.mind.thinker.nudge(8);
  }

  // Her own room at the inn, paid from her own purse (or on Elda's credit, which she
  // will settle: she keeps a tally of debts).
  onRoomRented({ npc, actor, price, paid }) {
    if (!this.isSelf(actor)) return;
    const m = this.mind;
    const day = this.game?.clock?.day ?? 1;
    if (!this.throttle(`room_${day}`, 600)) return;
    m.needsEngine.satisfy('safety', 0.1);
    const host = npc?.name ? firstName(npc.name) : 'Elda';
    const coins = Number(price) || 0;
    if (paid) {
      m.feel('pride', 0.06, 'paid my own way');
      m.remember(`Took my room at the Ember Kettle for the night${coins ? `, ${coins} coins from my own purse` : ''}. A door with a bolt on it. Worth every copper.`, { importance: 2, about: npc?.id ? [npc.id] : [], tags: ['room', 'ember_kettle', 'coin'], location: 'ember_kettle', emotion: 'pride', gist: 'my room at the Kettle' });
    } else {
      m.feel('embarrassment', 0.1, 'a room on credit');
      m.remember(`${host} gave me my room at the Kettle on credit tonight. It goes in the tally at the back of my journal: I pay my debts.`, { importance: 3, about: npc?.id ? [npc.id] : [], tags: ['room', 'ember_kettle', 'debt'], location: 'ember_kettle', emotion: 'embarrassment', gist: `owing ${host} for a room` });
      if (npc?.id) m.relationships.adjust(npc.id, { affinity: 2, trust: 1 }, 'Trusted me with a room on credit');
    }
  }

  // A new morning: yesterday's fear of the dark is gone, and she thinks about the day.
  onNewDay() {
    const m = this.mind;
    m.feel('joy', 0.05, 'a new day');
    m.thinker.nudge(10);
  }

  // A turn in the Maren arc brings Maren, and the places involved, to the front of her mind.
  onQuest({ id, stage }) {
    if (id !== 'maren') return;
    const m = this.mind;
    m.notice('person:maren', { source: 'quest', amount: 0.9, reminisce: false, label: 'Maren' });
    const place = { find_key: 'bandit_camp', enter_ruins: 'sunken_ruins', find_journal: 'sunken_ruins' }[stage];
    if (place) m.notice(`place:${place}`, { source: 'quest', amount: 0.6, reminisce: false });
    if (stage === 'read_journal' || stage === 'waygate') m.notice('item:maren_journal', { source: 'quest', amount: 0.8, reminisce: false });
  }

  onConversation({ a, b, topic }) {
    const other = this.isSelf(a) ? b : this.isSelf(b) ? a : null;
    if (!other?.id || this.isPlayer(other)) return;
    this.mind.notice(`person:${other.id}`, { source: 'conversation', amount: 0.7, reminisce: false });
    if (topic) this.mind.noticeText(String(topic), { source: 'conversation', amount: 0.5 });
  }

  onTrade({ itemId, bought }) {
    if (bought && itemId === 'honey_cake' && this.near(this.game?.player, 120) && this.throttle('trade_cake', 300)) {
      this.mind.feel('curiosity', 0.1, 'a honey cake was bought');
      this.mind.addThought('Is that a honey cake? Who is that honey cake for? ...Asking for a friend. The friend is me.', 'perception', { show: true });
    }
  }

  // ---------------------------------------------------------------- mood of the world

  isIndoors() {
    const loc = this.placeObj();
    if (loc?.indoor) return true;
    const o = this.owner;
    try {
      return !!this.game?.map?.isIndoors?.(o.x, o.y);
    } catch {
      return false;
    }
  }

  onTimeOfDay({ phase }) {
    const m = this.mind;
    const indoor = this.isIndoors();
    if (phase === 'night') {
      if (!indoor) {
        m.appraise('night_out', 0.8, 'nightfall');
        if ((this.game?.clock?.weather?.type || 'clear') === 'clear') m.appraise('starlight', 0.6, 'stars');
      } else m.appraise('cozy', 0.3, 'a roof at night');
      m.thinker.nudge(4);
    } else if (phase === 'dawn') {
      m.feel('joy', 0.06, 'dawn');
      m.thinker.nudge(6);
    } else if (phase === 'dusk' && !indoor) {
      m.feel('fear', 0.04, 'dusk');
    }
  }

  onWeather({ type }) {
    const m = this.mind;
    const indoor = this.isIndoors();
    if (type === 'rain') m.appraise(indoor ? 'cozy' : 'gloom', 0.8, 'rain');
    else if (type === 'fog') {
      m.appraise('gloom', 0.5, 'fog');
      m.feel('curiosity', 0.05, 'fog');
    } else if (type === 'clear') m.feel('joy', 0.05, 'clear skies');
    m.thinker.nudge(5);
  }

  onSettings({ key, value }) {
    const m = this.mind;
    if (key === 'playerName' && value) {
      const rel = m.relationships.get(PLAYER_ID);
      const old = rel?.name;
      if (rel) rel.name = String(value);
      if (old && old !== value) {
        const from = /^(traveler|traveller)$/i.test(old) ? /\bthe traveler\b/gi : new RegExp(`\\b${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        const to = /^(traveler|traveller)$/i.test(value) ? 'the traveler' : String(value);
        for (const mem of m.memory.all()) if (mem.about.includes(PLAYER_ID)) mem.text = mem.text.replace(from, to).replace(/^the traveler/, 'The traveler');
        m.memory.touchAll();
      }
    } else if (key === 'companionName' && value) {
      m.soul.name = String(value);
    }
  }

  // ---------------------------------------------------------------- what she sees

  near(e, r) {
    const o = this.owner;
    if (!e || !o || !Number.isFinite(e.x)) return false;
    const dx = e.x - o.x;
    const dy = e.y - o.y;
    return dx * dx + dy * dy <= r * r;
  }

  update(dt) {
    this.clock += dt;
    const g = this.game;
    const o = this.owner;
    if (!o || !g) return;
    this._placeT -= dt;
    if (this._placeT <= 0) {
      this._placeT = 0.4;
      this.pollPlace();
    }
    this._meetT -= dt;
    if (this._meetT <= 0) {
      this._meetT = 0.25;
      this.pollMeet();
    }
    this._slowT -= dt;
    if (this._slowT <= 0) {
      this._slowT = 2;
      this.pollSlow();
    }
    if (this.encounter && this.rt() - this.encounter.last > ENCOUNTER_END) this.finishEncounter();
  }

  pollPlace() {
    const o = this.owner;
    const loc = this.game?.locations?.at?.(o.x, o.y) || null;
    const id = loc?.id || null;
    if (id === this.place) {
      // Where she is stays on her mind while she is there.
      if (id && this.rt() - this._placeRefresh > 20) {
        this._placeRefresh = this.rt();
        this.mind.workingMemory.activate(`place:${id}`, { label: loc.name, amount: 0.35, source: 'place' });
      }
      return;
    }
    const prev = this.place;
    this.place = id;
    this.placeSince = this.rt();
    this.firstVisit = false;
    if (loc) this.enterPlace(loc, prev);
  }

  enterPlace(loc, prev) {
    const m = this.mind;
    this._placeRefresh = this.rt();
    const first = !this.seenPlaces.has(loc.id);
    // What there is to know about a place, she learns by being there (DESIGN §17.2).
    const learned = m.learnPlace(loc.id);
    if (!first) m.notice(`place:${loc.id}`, { source: 'place', amount: 0.8, label: loc.name });
    else m.workingMemory.activate(`place:${loc.id}`, { label: loc.name, amount: 0.8, source: 'place' });
    if (first && learned.length && learned[0].kind !== 'lore') m.thinker.queue('clue', learned[0], 6);
    if (!this.seenPlaces.has(loc.id)) {
      this.seenPlaces.add(loc.id);
      this.firstVisit = true;
      const danger = loc.danger || 0;
      m.appraise('novelty', loc.kind === 'ruins' ? 1.2 : 1, `first sight of ${loc.name}`);
      if (danger >= 2) m.appraise('danger_place', danger / 2, `${loc.name} feels dangerous`);
      m.needsEngine.satisfy('fun', 0.18);
      const desc = loc.description ? firstSentence(loc.description, 160) : '';
      m.learn(loc.name, desc || `A ${loc.kind || 'place'} near Hearthvale.`, 'observed');
      const reaction = m.thinker.placeLine(loc);
      m.remember(`First time ${placePhrase(loc)}.${desc ? ` ${desc}` : ''}${reaction ? ` ${reaction}` : ''}`, {
        importance: clamp(3 + (danger >= 2 ? 2 : 0) + (loc.kind === 'ruins' ? 2 : 0), 3, 8),
        location: loc.id,
        tags: ['place', loc.kind].filter(Boolean),
        emotion: 'curiosity',
        gist: `first sight of ${loc.name}`,
      });
      m.thinker.queue('place', loc, 1.5);
    } else {
      m.appraise('familiar', 1, loc.name);
      if ((loc.danger || 0) >= 2 && this.throttle(`danger_${loc.id}`, 120)) m.appraise('danger_place', 0.4, `${loc.name} again`);
    }
  }

  // Meet people (and named creatures) the first time they come close and in sight.
  pollMeet() {
    const g = this.game;
    const o = this.owner;
    const list = g?.entities?.all?.();
    if (!list) return;
    const r2 = MEET_RADIUS * MEET_RADIUS;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === o || e.removed || e.type !== 'actor' || this.met.has(e.id) || this.isPlayer(e)) continue;
      if (!(e.profile || e.species === 'cat' || isNamedCreature(e))) continue;
      if (e.dead || (typeof e.isAlive === 'function' && !e.isAlive())) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      if (dx * dx + dy * dy > r2) continue;
      if (!hasLineOfSight(g, o.x, o.y, e.x, e.y)) continue;
      this.meet(e, true);
    }
  }

  pollSlow() {
    const g = this.game;
    const o = this.owner;
    const list = g?.entities?.all?.();
    if (!list) return;
    const rels = this.mind.relationships;
    const t = g.clock?.t ?? 0;
    const now = this.rt();
    let threats = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === o || e.removed || e.type !== 'actor' || e.dead) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > NOTICE_RADIUS * NOTICE_RADIUS) continue;
      const rel = rels.map.get(e.id);
      if (rel && d2 < 120 * 120) rel.lastSeen = t;
      if (d2 < 120 * 120 && e.faction && factionRelation('player', e.faction) === 'hostile' && (typeof e.isAlive !== 'function' || e.isAlive())) threats++;
      // A familiar face brings them, and what she associates with them, to mind.
      if (rel && rel.firstMet != null && !this.isPlayer(e) && d2 < 100 * 100) {
        const seen = this.seenAt.get(e.id);
        if ((seen == null || now - seen > 45) && hasLineOfSight(g, o.x, o.y, e.x, e.y)) {
          this.seenAt.set(e.id, now);
          this.mind.notice(`person:${e.id}`, { source: 'person', amount: 0.55, label: rel.name });
        }
      }
    }
    this.threats = threats;
    this.easeFear();
  }

  // Fear of the player fades slowly once they stop giving her reasons: about a point
  // every two in-game hours of peace (sleep eases it a little more, see Mind.wake).
  easeFear() {
    const c = this.game?.clock;
    if (!c) return;
    const t = c.t;
    const sph = c.secondsPerHour || 37.5;
    if (this._fearDecayT == null || t < this._fearDecayT) this._fearDecayT = t;
    const hours = (t - this._fearDecayT) / sph;
    if (hours < 1) return;
    this._fearDecayT = t;
    if (t - this.lastFearT < 2 * sph) return;
    const rel = this.mind.relationships.get(PLAYER_ID);
    if (rel && rel.fear > 0) rel.fear = Math.max(0, Math.round((rel.fear - 0.5 * hours) * 10) / 10);
  }

  // Seeing someone for the first time this session. The people of Hearthvale she has
  // known all her life (soul.js LYRA_PEOPLE, seeded by the mind): a familiar face, not a
  // first impression. Anyone else gets a first impression from the profile.
  meet(e, emit = true) {
    if (!e?.id || this.met.has(e.id)) return null;
    this.met.add(e.id);
    const known = this.mind.relationships.map.get(e.id);
    if (LYRA_PEOPLE[e.id] && known && known.firstMet != null) return this.greetKnown(e, known, emit);
    const m = this.mind;
    const g = this.game;
    const rels = m.relationships;
    const t = g?.clock?.t ?? 0;
    // Pip's stray may come back under another id (a reloaded world): same cat, same bond.
    if (e.species === 'cat' && !e.profile && !rels.map.has(e.id)) {
      const old = [...rels.map.values()].find((r) => r.species === 'cat' && r.tags.includes('pet') && !g?.entities?.get?.(r.id));
      if (old) {
        rels.map.delete(old.id);
        old.id = e.id;
        rels.map.set(e.id, old);
        old.lastSeen = t;
        rels._emit(old, { met: true }, 'found again');
        return old;
      }
    }
    const rel = rels.ensure(e);
    if (rel.firstMet == null) rel.firstMet = t;
    rel.lastSeen = t;
    const place = this.placeObj();

    if (e.species === 'cat' && !e.profile) {
      // Pip's stray (Biscuit, if it has a name of its own): a pet from the first scratch.
      const named = isNamedCreature(e) ? e.name : null;
      const call = named || 'the stray';
      rel.affinity = Math.max(rel.affinity, 35);
      rel.familiarity = Math.max(rel.familiarity, 10);
      if (!rel.tags.includes('pet')) rel.tags.push('pet');
      rels.setOpinion(rel.id, `${named ? `${named}: ` : ''}Pip's stray. Scruffy, smug and entirely in charge of this village. Ours now, whether it agrees or not.`, 'impression');
      m.remember(`Met ${named ? `${named}, the stray cat` : 'the stray cat'} Pip follows around${place ? ` ${placePhrase(place)}` : ''}. ${named ? 'It' : 'It'} looked at me like I owed it money. I've decided it's ours.`, {
        importance: 4,
        about: [rel.id],
        tags: ['meeting', 'cat', 'pet'],
        emotion: 'affection',
        gist: `meeting ${named || 'the stray cat'}`,
      });
      m.addThought(`Hello, ${named ? named : 'cat'}. You're Pip's, aren't you? Then you're ours, too.`, 'meeting', { show: true });
      m.feel('affection', 0.12, `meeting ${call}`);
    } else {
      const fi = this.impressionFromProfile(e);
      rel.affinity = clamp(fi.affinity, -100, 100);
      rel.trust = clamp(fi.trust, 0, 100);
      rel.respect = clamp(fi.respect, 0, 100);
      rel.familiarity = Math.max(rel.familiarity, 8);
      for (const tag of fi.tags || []) if (!rel.tags.includes(tag)) rel.tags.push(tag);
      rels.setOpinion(rel.id, fi.opinion, 'impression');
      const where = place ? ` ${placePhrase(place)}` : '';
      const mentions = place && fi.memory && fi.memory.toLowerCase().includes(String(place.name).toLowerCase().replace(/^the /, ''));
      // "Met Bram Ironhand, the blacksmith, at the smithy." (an appositive keeps its commas)
      const first = fi.memory ? fi.memory.split('.')[0] : '';
      const placeIn = (t) => (/, [^,]+$/.test(first) ? t.replace(/\./, `,${where}.`) : t.replace(/\./, `${where}.`));
      const memText = fi.memory ? (where && !mentions ? placeIn(fi.memory) : fi.memory) : `Met ${e.name}${where}.`;
      m.remember(memText, {
        importance: fi.hope ? 6 : 5,
        about: [rel.id],
        tags: ['meeting', e.id],
        emotion: 'curiosity',
        gist: `meeting ${firstName(e.name)}`,
      });
      m.addThought(fi.thought, 'meeting', { show: true });
      m.appraise('meeting', 1, `meeting ${e.name}`);
      if (fi.hope) m.appraise('hope', 0.5, `${e.name} may know about Maren`);
      if (fi.goal) m.addGoal(fi.goal.text, fi.goal.priority, 'self', fi.goal.id);
      this.checkVillageGoal();
    }
    rels._emit(rel, { met: true }, 'first meeting');
    if (emit) g?.bus?.emit?.('npc_meet', { a: this.owner, b: e });
    return rel;
  }

  impressionFromProfile(e) {
    const p = e.profile || {};
    const traits = (Array.isArray(p.traits) ? p.traits : []).map((x) => String(x).toLowerCase());
    let affinity = 6;
    let respect = 18;
    let trust = 18;
    for (const tr of traits) {
      affinity += TRAIT_AFFINITY[tr] || 0;
      respect += TRAIT_RESPECT[tr] || 0;
      trust += TRAIT_TRUST[tr] || 0;
    }
    const role = String(p.role || e.role || '').toLowerCase();
    if (isChild(e)) affinity += 8;
    if (/guard|captain|soldier/.test(role)) respect += 8;
    if (/priest|sister|keeper|healer|herbal/.test(role)) trust += 5;
    affinity = clamp(affinity, -30, 35);
    const n = firstName(e.name);
    const traitText = traits.length ? joinList(traits.slice(0, 2)) : null;
    const like = affinity >= 15 ? 'I think I like them already.' : affinity <= -5 ? "I'm not sure about them." : 'We will see.';
    const personality = p.personality ? firstSentence(p.personality, 140) : '';
    return {
      affinity,
      trust: clamp(trust, 0, 60),
      respect: clamp(respect, 0, 60),
      opinion: `${n} seems ${traitText || 'hard to read'}. ${like}`,
      thought: `${n}${role ? `, the ${role}` : ''}. ${traitText ? `${cap(traitText)}, I'd guess.` : 'Interesting.'} ${like}`,
      memory: `Met ${e.name}${role ? `, the ${role}` : ''}. ${personality}`.trim(),
      hope: Array.isArray(p.facts) && p.facts.some((f) => f?.topic === 'maren'),
    };
  }

  // Someone she has known all her life, seen for the first time today: the face brings
  // them to mind, and a passing thought. No new memory: she has a lifetime of them.
  greetKnown(e, rel, emit = true) {
    const m = this.mind;
    const t = this.game?.clock?.t ?? 0;
    m.relationships.ensure(e);
    rel.lastSeen = t;
    const p = LYRA_PEOPLE[e.id];
    m.notice(`person:${e.id}`, { source: 'person', amount: 0.5, label: rel.name, reminisce: false });
    if (p?.thought) m.addThought(p.thought, 'meeting', { show: true });
    m.relationships._emit(rel, { met: true }, 'seen today');
    if (emit) this.game?.bus?.emit?.('npc_meet', { a: this.owner, b: e });
    return rel;
  }

  checkVillageGoal() {
    const m = this.mind;
    const goal = m.goals.find((x) => x.id === 'meet_village' && !x.done);
    if (!goal) return;
    const list = this.game?.entities?.all?.() || [];
    let total = 0;
    let met = 0;
    for (const e of list) {
      if (!e.profile) continue;
      total++;
      if (this.met.has(e.id)) met++;
    }
    if (total >= 3 && met >= total) m.completeGoal(goal.id);
  }

  // Villagers she has seen since play began (she has known them all her life; this
  // counts faces, for the pacing of the Maren arc).
  villagersMet() {
    let n = 0;
    const rels = this.mind.relationships.map;
    for (const id of this.met) {
      const r = rels.get(id);
      if (r && r.npc && r.kind !== 'group' && r.id !== PLAYER_ID) n++;
    }
    return n;
  }

  serialize() {
    const out = { seen: [...this.seenPlaces], met: [...this.met] };
    if (Number.isFinite(this.lastFearT)) out.fearT = Math.round(this.lastFearT);
    return out;
  }

  deserialize(d) {
    if (!d) return;
    if (Number.isFinite(d.fearT)) this.lastFearT = d.fearT;
    if (Array.isArray(d.seen)) this.seenPlaces = new Set([...KNOWN_PLACES, ...d.seen.map(String)]);
    if (Array.isArray(d.met)) this.met = new Set(d.met.map(String));
  }
}
