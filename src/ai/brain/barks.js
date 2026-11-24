// Barks: the short things Lyra says out loud in the world without being asked.
//
// Bus events become candidates ({situation, vars, priority}); update() shows at most
// one every ~20 s, the most important first, never while a chat reply is pending or
// right after one, and never over another line of hers. Urgent moments (being knocked
// out, revived, finding the ruins key) cut the queue. Barks are bubbles only: they are
// not added to the chat and not voiced.

import { speechContext, bare } from './speech_gen.js';
import { factionRelation } from '../../entities/entity.js';
import { ITEMS } from '../../entities/items.js';
import { soulOf } from './soul_fallback.js';
import { jobLabel, firstName } from './local_brain.js';

export const BARK_GAP = 20; // seconds between ordinary barks
const URGENT_GAP = 2.5;
const AFTER_REPLY = 6; // quiet seconds after a chat reply
const MAX_PENDING = 8;

const ENEMY_SITUATION = {
  wolf: 'combat_wolf', bandit: 'combat_bandit', bandit_archer: 'combat_bandit', bandit_chief: 'combat_chief',
  skeleton: 'combat_undead', slime: 'combat_slime', bat: 'combat_bat', boar: 'combat_boar',
};
const KILL_SITUATION = { wolf: 'kill_wolf', bandit: 'kill_bandit', bandit_archer: 'kill_bandit', bandit_chief: 'kill_chief', skeleton: 'kill_undead', slime: 'kill_slime' };
const ENEMY_WORDS = { wolf: 'Wolves', bandit: 'Bandits', bandit_archer: 'Archers', bandit_chief: 'The bandit chief', skeleton: 'Skeletons', slime: 'A slime', bat: 'Bats', boar: 'A boar', deer: 'A deer', rabbit: 'A rabbit' };
const PLACE_SITUATION = {
  whisperwood: 'place_forest', sunken_ruins: 'place_ruins', mirror_lake: 'place_lake', bandit_camp: 'place_camp',
  stonecut_quarry: 'place_quarry', south_meadow: 'place_meadow', hearthvale: 'place_village', town_square: 'place_village',
  player_home: 'place_home', ember_kettle: 'place_inn', chapel: 'place_chapel',
};
const RARE_ITEMS = new Set(['crystal', 'potion', 'honey_cake', 'iron_sword', 'lantern', 'moonpetal', 'wolf_pelt']);

function itemPhrase(id, qty = 1) {
  const name = ITEMS[id]?.name || String(id || 'something').replace(/_/g, ' ');
  const low = /^Maren/.test(name) ? name : name.toLowerCase();
  if (qty > 1) return `${qty} ${/s$|fish$|wheat$|wood$|stone$|ore$|stew$|bread$/.test(low) ? low : `${low}s`}`;
  return /^Maren/.test(name) ? name : `${/^[aeiou]/.test(low) ? 'an' : 'a'} ${low}`;
}

function firstSentence(text) {
  const m = String(text || '').match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : String(text || '')).trim();
}

export class Barker {
  constructor(game, brain) {
    this.game = game;
    this.brain = brain;
    this.pending = [];
    this.lastBarkAt = -1e9;
    this.lastLyraSpeechAt = -1e9;
    this.cooldowns = new Map();
    this.visited = new Set();
    this.placeSeen = new Map();
    this.greeted = new Map();
    this.mused = [];
    this.combatUntil = -1;
    this.combatStartAt = -1;
    this.idleTimer = 75;
    this.scanTimer = 2;
    this.playerStill = 0;
    this._px = null;
    this._py = null;
    this.lastWeather = null;
    this.installed = false;
  }

  now() {
    return this.game?.time ?? 0;
  }

  get lyra() {
    return this.game?.companion || null;
  }

  isLyra(e) {
    return !!e && (e === this.game.companion || e.id === 'lyra');
  }

  isPlayer(e) {
    return !!e && (e === this.game.player || e.id === 'player');
  }

  isHostile(e) {
    if (!e || e.type !== 'actor') return false;
    if (factionRelation('player', e.faction) === 'hostile') return true;
    try {
      return !!this.lyra?.mind?.relationships?.isEnemy?.(e);
    } catch {
      return false;
    }
  }

  install() {
    if (this.installed || !this.game?.bus) return;
    this.installed = true;
    const on = (type, fn) =>
      this.game.bus.on(type, (p) => {
        try {
          fn(p || {});
        } catch (err) {
          console.error(`[brain] bark handler for ${type} failed`, err);
        }
      });
    on('attack', (p) => this.onAttack(p));
    on('damage', (p) => this.onDamage(p));
    on('death', (p) => this.onDeath(p));
    on('downed', (p) => {
      if (this.isLyra(p.entity)) this.queue('downed', {}, { priority: 6, urgent: true, kind: 'say', cooldown: 5 });
      else if (this.isPlayer(p.entity)) this.queue('player_downed', {}, { priority: 6, urgent: true, kind: 'shout', cooldown: 5 });
    });
    on('revived', (p) => {
      if (this.isLyra(p.entity)) this.queue('revived', {}, { priority: 6, urgent: true, cooldown: 5, ttl: 5 });
    });
    on('heal', (p) => {
      if (this.isLyra(p.source) && this.isPlayer(p.target)) this.queue('healed_player', {}, { priority: 1.5, cooldown: 45 });
      else if (this.isPlayer(p.source) && this.isLyra(p.target)) this.queue('thanks_heal', {}, { priority: 3, cooldown: 30 });
    });
    on('level_up', (p) => {
      if (this.isLyra(p.entity)) this.queue('level_up', { level: p.level }, { priority: 4, cooldown: 10 });
      else if (this.isPlayer(p.entity)) this.queue('player_level_up', { level: p.level }, { priority: 4, cooldown: 10 });
    });
    on('enter_location', (p) => this.onEnter(p));
    on('time_of_day', (p) => {
      if (p.phase === 'night') this.queue('night_falls', {}, { priority: 1.2, cooldown: 300 });
      else if (p.phase === 'dusk') this.queue('dusk', {}, { priority: 0.8, cooldown: 300, chance: 0.7 });
      else if (p.phase === 'dawn') this.queue('dawn', {}, { priority: 0.8, cooldown: 300, chance: 0.7 });
    });
    on('weather', (p) => {
      const prev = this.lastWeather;
      this.lastWeather = p.type;
      if (p.type === 'rain') this.queue('rain_starts', {}, { priority: 1.2, cooldown: 240 });
      else if (p.type === 'fog') this.queue('fog_rolls', {}, { priority: 1, cooldown: 240 });
      else if ((prev === 'rain' || prev === 'fog') && (p.type === 'clear' || p.type === 'cloudy')) this.queue('skies_clear', {}, { priority: 0.8, cooldown: 240, chance: 0.7 });
    });
    on('npc_meet', (p) => {
      const other = this.isLyra(p.a) ? p.b : this.isLyra(p.b) ? p.a : null;
      if (other && !this.isPlayer(other) && other.name) {
        this.greeted.set(other.id, this.now());
        this.queue('npc_meet', { name: firstName(other.name) }, { priority: 1.6, cooldown: 20 });
      }
    });
    on('item_gained', (p) => this.onItem(p));
    on('item_given', (p) => this.onGift(p));
    on('job_done', (p) => {
      if (p.actor && !this.isLyra(p.actor)) return;
      const job = typeof p.job === 'string' ? p.job : p.job?.job || p.job?.id || p.job?.type;
      this.queue('job_done', { job: jobLabel(job), result: this.resultText(p.result) }, { priority: 2.5, cooldown: 15, ttl: 6 });
    });
    on('job_failed', (p) => {
      if (p.actor && !this.isLyra(p.actor)) return;
      const reason = String(p.reason || 'I could not find anything I could reach.').trim();
      this.queue('job_failed', { reason }, { priority: 3, cooldown: 15, ttl: 6 });
    });
    on('quest', (p) => {
      if (p.id && p.id !== 'maren') return;
      if (p.stage === 'find_journal' || p.stage === 'read_journal' || p.stage === 'settle') return;
      if (p.text) this.queue('quest_update', { objective: String(p.text).trim() }, { priority: 1.4, cooldown: 30, ttl: 8, delay: 2 });
    });
    on('trade', () => this.queue('trade', {}, { priority: 0.5, cooldown: 120, chance: 0.4 }));
    on('conversation', (p) => {
      const other = this.isLyra(p.a) ? p.b : this.isLyra(p.b) ? p.a : null;
      if (other?.name && !this.isPlayer(other)) this.queue('conversation_done', { name: firstName(other.name) }, { priority: 0.5, cooldown: 90, chance: 0.35, delay: 3 });
    });
    on('player_wake', () => this.queue('morning_wake', {}, { priority: 3, cooldown: 60, delay: 2.5, ttl: 10 }));
    on('companion_action', (p) => {
      if (p.source === 'player') this.ack(p);
    });
    on('speech', (p) => {
      if (this.isLyra(p.speaker)) this.lastLyraSpeechAt = this.now();
    });
  }

  resultText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    const items = Array.isArray(result) ? result : result.items;
    if (Array.isArray(items) && items.length) {
      const parts = items.filter((x) => x && x.id).map((x) => itemPhrase(x.id, x.qty || 1));
      if (parts.length) return `Got ${parts.slice(0, 3).join(', ')}.`;
    }
    if (typeof result.message === 'string') return result.message;
    return '';
  }

  // ------------------------------------------------------------ combat

  engage(enemy) {
    const now = this.now();
    const was = this.combatUntil > now;
    this.combatUntil = now + 8;
    if (was) return;
    this.combatStartAt = now;
    const sp = enemy?.species || enemy?.spriteKey || '';
    const situation = ENEMY_SITUATION[sp] || 'combat_start';
    const word = ENEMY_WORDS[sp] || enemy?.name || 'Hostiles';
    this.queue(situation, { enemy: word }, { priority: 3, ttl: 3, cooldown: 25, kind: 'shout' });
  }

  onAttack(p) {
    const { attacker, target } = p;
    if (this.isHostile(attacker) && (this.isPlayer(target) || this.isLyra(target))) this.engage(attacker);
    else if (this.isLyra(attacker) && target && this.isHostile(target)) this.engage(target);
  }

  onDamage(p) {
    const { source, target, amount } = p;
    if (this.isHostile(source) && (this.isPlayer(target) || this.isLyra(target))) this.engage(source);
    if (!target || !target.maxHp) return;
    const ratio = target.hp / target.maxHp;
    if (this.isLyra(target) && ratio > 0 && ratio < 0.3) this.queue('low_hp', {}, { priority: 4, cooldown: 35, kind: 'shout' });
    else if (this.isPlayer(target)) {
      if (ratio > 0 && ratio < 0.3) this.queue('player_low_hp', {}, { priority: 4, cooldown: 35, kind: 'shout' });
      else if ((amount || 0) >= target.maxHp * 0.18) this.queue('player_hurt', {}, { priority: 2, cooldown: 30, kind: 'shout' });
    }
  }

  onDeath(p) {
    const { entity, killer } = p;
    if (!entity || this.isPlayer(entity) || this.isLyra(entity)) return;
    const sp = entity.species || '';
    if (this.isLyra(killer)) {
      if (sp === 'bandit_chief') this.queue('kill_chief', {}, { priority: 5, urgent: true, cooldown: 5 });
      else this.queue(KILL_SITUATION[sp] && Math.random() < 0.6 ? KILL_SITUATION[sp] : 'kill', {}, { priority: 2, cooldown: 10, ttl: 2.5 });
    } else if (this.isPlayer(killer) && this.isHostile(entity)) {
      if (sp === 'bandit_chief') this.queue('kill_chief', {}, { priority: 5, urgent: true, cooldown: 5 });
      else this.queue('player_kill', {}, { priority: 1, cooldown: 40, chance: 0.45, ttl: 2.5 });
    }
  }

  // ------------------------------------------------------------- places

  onEnter(p) {
    if (!this.isLyra(p.actor)) return;
    const loc = p.location;
    if (!loc?.id) return;
    const now = this.now();
    const first = !this.visited.has(loc.id);
    this.visited.add(loc.id);
    const last = this.placeSeen.get(loc.id) ?? -1e9;
    this.placeSeen.set(loc.id, now);
    const specific = PLACE_SITUATION[loc.id] || (loc.indoor ? 'place_indoors' : null);
    if (first) {
      const desc = firstSentence(loc.description);
      if (desc) this.queue('place_new', { place: loc.name, desc }, { priority: 2.5, ttl: 6, cooldown: 0, fallback: specific });
      else if (specific) this.queue(specific, { place: loc.name }, { priority: 2.2, ttl: 6, cooldown: 0 });
      return;
    }
    if (now - last < 360 || loc.id === 'kings_road') return;
    this.queue(specific && Math.random() < 0.7 ? specific : 'place_return', { place: loc.name }, { priority: 0.9, ttl: 5, cooldown: 120, chance: 0.4 });
  }

  // --------------------------------------------------------------- items

  onItem(p) {
    const { actor, itemId, qty = 1, from } = p;
    if (!this.isLyra(actor) && !this.isPlayer(actor)) return;
    if (itemId === 'ruins_key') return this.queue('key_found', {}, { priority: 5, urgent: true, cooldown: 30, ttl: 6 });
    if (itemId === 'maren_journal') return this.queue('journal_found', {}, { priority: 6, urgent: true, cooldown: 30, ttl: 6 });
    if (itemId === 'coin') return;
    if (!['loot', 'chest', 'pickup', 'quest'].includes(from)) return;
    if (RARE_ITEMS.has(itemId)) this.queue('loot_rare', { item: itemPhrase(itemId, qty) }, { priority: 1.8, cooldown: 40 });
    else this.queue('loot', { item: itemPhrase(itemId, qty) }, { priority: 0.6, cooldown: 60, chance: from === 'pickup' ? 0.25 : 0.5 });
  }

  onGift(p) {
    if (!this.isLyra(p.to) || !this.isPlayer(p.from)) return;
    const id = p.itemId;
    if (id === 'maren_journal') return;
    const def = ITEMS[id];
    const name = def?.name || String(id).replace(/_/g, ' ');
    const soul = soulOf(this.game);
    const key = name.toLowerCase().replace(/s$/, '');
    const matches = (list) => (list || []).some((x) => {
      const l = String(x).toLowerCase();
      return l.includes(key) || key.includes(l.replace(/s$/, ''));
    });
    let situation = 'gift_generic';
    if (matches(soul.likes)) situation = 'gift_loved';
    else if (matches(soul.dislikes) || id === 'bone' || id === 'slime_gel') situation = 'gift_disliked';
    else if (def && ['food', 'gift', 'potion'].includes(def.type)) situation = 'gift_liked';
    this.queue(situation, { item: name.toLowerCase() === name ? name : name.replace(/^./, (c) => c.toLowerCase()) }, { priority: 4, urgent: true, cooldown: 3, ttl: 4 });
  }

  // ---------------------------------------------------------------- acks

  // A player command from the HUD or hotkeys: answer at once, it is a reply.
  ack(entry) {
    // The HUD may both run an action and ask for an ack: answer once.
    const now = this.now();
    if (this._lastAck && this._lastAck.name === entry.name && now - this._lastAck.t < 0.5) return;
    this._lastAck = { name: entry.name, t: now };
    let text = null;
    try {
      text = this.brain.local.ackAction({ name: entry.name, args: entry.args || {} }, { ok: entry.ok, message: entry.message });
    } catch {
      text = null;
    }
    if (!text) return;
    this.pending = this.pending.filter((c) => c.priority >= 5);
    this.show({ text, situation: `ack:${entry.name}`, kind: 'say' });
  }

  // ------------------------------------------------------------- queueing

  queue(situation, vars = {}, { priority = 1, ttl = 4, cooldown = 60, urgent = false, chance = 1, kind = 'say', delay = 0, fallback = null } = {}) {
    if (chance < 1 && Math.random() > chance) return;
    const now = this.now();
    if (cooldown > 0 && now - (this.cooldowns.get(situation) ?? -1e9) < cooldown) return;
    const c = { situation, vars, priority, urgent, kind, fallback, at: now + delay, until: now + delay + ttl };
    const i = this.pending.findIndex((x) => x.situation === situation);
    if (i >= 0) {
      if (this.pending[i].priority <= priority) this.pending[i] = c;
      return;
    }
    this.pending.push(c);
    if (this.pending.length > MAX_PENDING) {
      this.pending.sort((a, b) => b.priority - a.priority);
      this.pending.length = MAX_PENDING;
    }
  }

  canSpeak(c, now) {
    const lyra = this.lyra;
    if (!lyra) return false;
    const brain = this.brain;
    if (c.urgent) return now - this.lastBarkAt >= URGENT_GAP;
    if (lyra.downed || lyra.state === 'sleep' || lyra.dead) return false;
    if (brain.busy) return false;
    if (now - (brain.lastReplyAt ?? -1e9) < AFTER_REPLY) return false;
    if (now - this.lastLyraSpeechAt < 4) return false;
    return now - this.lastBarkAt >= BARK_GAP;
  }

  update(dt) {
    const g = this.game;
    if (!g || g.state !== 'playing' || g.paused || !this.lyra) return;
    const now = this.now();

    // Combat ended?
    if (this.combatStartAt >= 0 && now > this.combatUntil) {
      this.combatStartAt = -1;
      const l = this.lyra;
      const p = g.player;
      const close = (l && l.maxHp && l.hp / l.maxHp < 0.3) || (p && p.maxHp && p.hp / p.maxHp < 0.3);
      this.queue(close ? 'combat_close_call' : 'combat_end', {}, { priority: 2, cooldown: 45, chance: close ? 1 : 0.7, ttl: 5 });
    }

    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 2;
      this.scan();
    }

    const calm = this.combatUntil < now && !this.brain.busy;
    if (calm) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 75 + Math.random() * 70;
        this.queueIdle();
      }
    }

    if (!this.pending.length) return;
    let best = null;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if (now > c.until) {
        this.pending.splice(i, 1);
        continue;
      }
      if (now < c.at) continue;
      if (!best || c.priority > best.priority) best = c;
    }
    if (!best || !this.canSpeak(best, now)) return;
    this.pending.splice(this.pending.indexOf(best), 1);
    this.show(best);
  }

  show(c) {
    const g = this.game;
    const lyra = this.lyra;
    if (!lyra) return false;
    let text = c.text || null;
    const ctx = speechContext(g);
    if (!text) text = this.brain.speech.line(c.situation, c.vars, ctx);
    if (!text && c.fallback) text = this.brain.speech.line(c.fallback, c.vars, ctx);
    if (!text) return false;
    const now = this.now();
    this.lastBarkAt = now;
    this.cooldowns.set(c.situation, now);
    try {
      g.bubbles?.say?.(lyra, text, { kind: c.kind === 'shout' ? 'shout' : 'say' });
    } catch (err) {
      console.error('[brain] bubble failed', err);
    }
    g.bus?.emit('speech', { speaker: lyra, text, target: null, kind: 'bark' });
    return true;
  }

  // Every 2 s: friendly faces nearby, and whether the player has stopped moving.
  scan() {
    const g = this.game;
    const lyra = this.lyra;
    const p = g.player;
    if (p) {
      if (this._px != null && Math.hypot(p.x - this._px, p.y - this._py) < 2) this.playerStill += 2;
      else this.playerStill = 0;
      this._px = p.x;
      this._py = p.y;
    }
    if (!lyra || !g.entities?.query) return;
    const now = this.now();
    const rels = lyra.mind?.relationships;
    let near = [];
    try {
      near = g.entities.query(lyra.x, lyra.y, 72, (e) => e.type === 'actor' && e !== lyra && e !== p && !!e.profile && !e.dead);
    } catch {
      near = [];
    }
    for (const e of near) {
      if (now - (this.greeted.get(e.id) ?? -1e9) < 420) continue;
      let known = null;
      try {
        known = rels?.get?.(e.id) || null;
      } catch {
        known = null;
      }
      this.greeted.set(e.id, now);
      if (!known) continue; // first meetings come through npc_meet
      this.queue(e.id === 'pip' ? 'see_child' : 'see_friend', { name: firstName(e.name) }, { priority: 0.7, cooldown: 25, ttl: 3, chance: 0.6 });
      break;
    }
  }

  queueIdle() {
    const g = this.game;
    const lyra = this.lyra;
    const mind = lyra?.mind;
    const needs = mind?.needs || {};
    const clock = g.clock;
    const loc = lyra && g.locations?.at ? g.locations.at(lyra.x, lyra.y) : null;
    const outdoors = !loc?.indoor;
    const options = [];
    const add = (situation, vars, w) => options.push({ situation, vars, w });
    if (Number.isFinite(needs.hunger) && needs.hunger < 0.25) add('hungry', {}, 3);
    if (Number.isFinite(needs.energy) && needs.energy < 0.2) add('tired', {}, 3);
    if (Number.isFinite(needs.social) && needs.social < 0.2) add('lonely', {}, 2);
    if (Number.isFinite(needs.fun) && needs.fun < 0.25) add('idle_bored', {}, 2);
    const h = clock?.hour ?? 12;
    const weather = clock?.weather?.type;
    if (clock?.isNight && outdoors && weather === 'clear') add('idle_night_sky', {}, 2);
    if (weather === 'rain' && outdoors) add('idle_rain', {}, 1.5);
    if ((h >= 23 || h < 4) && outdoors) add('late_night', {}, 2);
    if (this.playerStill >= 40) add('player_idle', {}, 2);
    const mem = this.pickMemory(loc);
    if (mem) add('idle_memory', { memory: mem.text, _id: mem.id }, 3);
    const goal = (mind?.goals || []).filter((x) => x && !x.done && x.text).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (goal) add('idle_goal', { goal: `${bare(goal.text)}.` }, 2);
    if (loc?.name) add('idle_place', { place: loc.name }, 1);
    if (!options.length) return;
    let total = 0;
    for (const o of options) total += o.w;
    let r = Math.random() * total;
    let pick = options[options.length - 1];
    for (const o of options) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    if (pick.vars._id) {
      this.mused.push(pick.vars._id);
      if (this.mused.length > 24) this.mused.shift();
    }
    this.queue(pick.situation, pick.vars, { priority: 0.5, cooldown: 150, ttl: 6 });
  }

  // A real memory worth musing about, not one she mentioned recently.
  pickMemory(loc) {
    const mind = this.lyra?.mind;
    if (!mind?.recall) return null;
    let list = [];
    try {
      list = mind.recall(loc?.name || 'today', { limit: 8 }) || [];
    } catch {
      return null;
    }
    const fresh = list.filter((m) => m?.text && (m.importance ?? 0) >= 5 && !this.mused.includes(m.id ?? m.text) && m.text.length < 200);
    if (!fresh.length) return null;
    const m = fresh[Math.floor(Math.random() * Math.min(3, fresh.length))];
    return { id: m.id ?? m.text, text: /[.!?]$/.test(m.text.trim()) ? m.text.trim() : `${m.text.trim()}.` };
  }

  serialize() {
    return { visited: [...this.visited].slice(0, 40), mused: this.mused.slice(-12) };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.visited)) for (const id of d.visited) if (typeof id === 'string') this.visited.add(id);
    if (Array.isArray(d.mused)) this.mused = d.mused.filter((x) => typeof x === 'string' || typeof x === 'number').slice(-12);
  }
}
