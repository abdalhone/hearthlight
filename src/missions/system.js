// The mission system (DESIGN §22.3): game.missions. Missions are data (data.js); this
// keeps their state, listens to the bus through its plugin (plugin.js), moves objectives,
// spawns what an objective needs, grants rewards through game.magic, and answers the HUD,
// the journal, the markers and the villagers' "Need a hand?".
//
//   offer(id) / accept(id) / decline(id) / abandon(id) / turnIn(id) / track(id)
//   status(id)            'locked' | 'available' | 'active' | 'ready' | 'done'
//   available()           missions whose requirements are met and that nobody has taken
//   hudLine()             { id, title, text, progress } for the tracked mission, or null
//   hintFor(kind, id)     where a locked weave component comes from (the Spellbook asks)
//   npcOptions(npc) / npcChoose(npc, key)   the villager dialogue's mission options
//   markers()             [{ kind: 'offer'|'turnin'|'objective', x, y, entity?, id }]
//   journal()             { active, available, upcoming, board, completed, story }
//
// Bus events out: mission_offered, mission_accepted, mission_progress, mission_step,
// mission_ready, mission_completed, mission_abandoned, mission_reward {id, reward}.

import { MISSIONS, GIVERS, missionById } from './data.js';
import { componentLabel, componentWords, bossFor, BOSS_NAMES, BOSS_PLACES, isComponent } from './components.js';
import { whenOk, whenLabel, inPlace, nearPoint, pointPx, weaveOf, weaveMatches, weaveEarned, aimOf, nonRaw, speciesMatches, isBossTarget, progressText, objectiveGoal } from './tracker.js';
import { TILE } from '../core/constants.js';
import { lyraOf } from '../core/people.js';

const POLL = 0.25;
const NUDGE_AFTER = 75; // seconds of play without a weave before a hint
const TALK_REACH = 60; // px from Lyra for a talk-with-her objective
const LYRA_OFFER_GAP = 120; // seconds between Lyra's own offers

const ACTIVE = new Set(['active', 'ready']);

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isPlayer(game, e) {
  return !!e && (e === game.player || e.id === 'player' || e === 'player');
}

function isLyra(game, e) {
  return !!e && (e === game.companion || e.id === 'lyra' || e === 'lyra');
}

export class MissionSystem {
  constructor(game, { missions = MISSIONS } = {}) {
    this.game = game;
    this.missions = missions;
    this.byId = new Map(missions.map((m) => [m.id, m]));
    this.reset();
    this.pollT = 0;
  }

  reset() {
    this.state = {}; // id -> { status, step, n, t0, stepT, spawned, lyra, accepted, done }
    this.tracked = null;
    this.flags = {}; // weave_seen, nudged, ...
    this.granted = []; // [{kind, id, mission}]
    this.playT = 0;
    this.lastLyraOffer = -Infinity;
    this.lyraOffered = {}; // id -> day she last offered it
    this.pending = []; // what Lyra will say when she can
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  // ------------------------------------------------------------------ the world

  now() {
    return this.game.clock?.t ?? this.playT;
  }

  // The stranger's level (progression), for scaling what missions put in the way.
  level() {
    const g = this.game;
    const lv = safe(() => g.progression?.level?.(), null) ?? g.player?.level ?? 1;
    return Math.max(1, Math.floor(Number(lv) || 1));
  }

  day() {
    return this.game.clock?.day ?? 1;
  }

  emit(type, payload) {
    try {
      this.game.bus?.emit?.(type, payload);
    } catch (err) {
      console.error(`[missions] ${type} listener failed`, err);
    }
  }

  toast(text, kind = 'quest', opts) {
    safe(() => this.game.ui?.toast?.(text, kind, opts));
  }

  giverName(giver) {
    if (!giver) return '';
    if (giver === 'lyra') return this.game.settings?.companionName || this.game.companion?.name || 'Lyra';
    const e = this.game.entities?.get?.(giver);
    if (e?.name && giver !== 'board') {
      const n = String(e.name).replace(/"[^"]*"\s*/g, '').trim().split(/\s+/);
      if ((n[0] === 'Captain' || n[0] === 'Sister') && n[1]) return `${n[0]} ${n[1]}`;
      return n[0];
    }
    return GIVERS[giver]?.name || giver;
  }

  giverWhere(giver) {
    return GIVERS[giver]?.where || '';
  }

  turnInTo(m) {
    const to = m.turnIn === undefined ? m.giver : m.turnIn;
    return to ? this.standIn(to) : to;
  }

  // Who gives a mission now: its giver, or (DESIGN §29) whoever stands in for a giver who
  // has died, or the notice board.
  standIn(id) {
    const s = safe(() => this.game.murder?.standIn?.(id), null);
    return s || id;
  }

  giverOf(m) {
    return this.standIn(m.giver);
  }

  // A stand-in passes on a dead giver's work in their own words first.
  standInLines(m, npc) {
    const dead = m.giver;
    if (this.giverOf(m) === dead) return [];
    const name = this.giverName(dead).split(' ').pop();
    return [`${name} meant to ask someone this. ${npc?.id === 'board' ? '' : "I'll see it done for them."}`.trim()];
  }

  // ------------------------------------------------------------------ what the player has

  // What the player really has: while "Try all magic" runs, the real sets, not the trial's.
  unlocked(kind, id) {
    const u = this.game.magic?.realUnlocked || this.game.magic?.unlocked;
    const set = u?.[`${kind}s`] || u?.[kind];
    if (set && typeof set.has === 'function' && set.has(id)) return true;
    return this.granted.some((g) => g.kind === kind && g.id === id);
  }

  essenceCount() {
    const u = (this.game.magic?.realUnlocked || this.game.magic?.unlocked)?.essences;
    const own = new Set(this.granted.filter((g) => g.kind === 'essence').map((g) => g.id));
    if (u && typeof u.forEach === 'function') u.forEach((e) => own.add(e));
    own.delete('raw');
    return own.size;
  }

  doneCount() {
    let n = 0;
    for (const s of Object.values(this.state)) if (s.status === 'done') n++;
    return n;
  }

  lyraTrust() {
    const s = safe(() => this.game.companion?.mind?.autonomy?.stats?.(), null);
    return Number.isFinite(s?.trust) ? s.trust : 50;
  }

  lyraWith() {
    const cs = safe(() => this.game.companion?.mind?.companionship, 'together') || 'together';
    return this.game.flags?.lyra_gone ? 'gone' : cs;
  }

  questStage() {
    const q = safe(() => this.game.plugins?.get?.('quest')?.stageOf?.(this.game), null);
    return Number.isFinite(q?.index) ? q.index : 0;
  }

  // Unmet requirements, in words (for hints); [] when the mission can be offered.
  missing(m) {
    const r = m.requires || {};
    const out = [];
    // Lyra's own, after her death: never (round 14b, DESIGN §35.1).
    if (m.giver === 'lyra' && safe(() => this.game.murder?.isDead?.('lyra'), false)) out.push(`${this.giverName('lyra')} is dead`);
    for (const id of r.missions || []) if (this.status(id) !== 'done') out.push(`after "${this.get(id)?.title || id}"`);
    if (r.done && this.doneCount() < r.done) out.push(`once you have done ${r.done} errands`);
    if (r.day && this.day() < r.day) out.push(`from day ${r.day}`);
    if (r.level && (this.game.player?.level ?? 1) < r.level) out.push(`at level ${r.level}`);
    if (r.essences && this.essenceCount() < r.essences) out.push(`with ${r.essences} essences to weave`);
    if (r.trust && this.lyraTrust() < r.trust) out.push(`when ${this.giverName('lyra')} trusts you more`);
    if (r.quest && this.questStage() < r.quest) out.push('further along Maren\'s thread');
    for (const f of r.flags || []) if (!this.flags[f] && !this.game.flags?.[f]) out.push(f === 'weave_seen' ? 'once you weave' : `after ${f}`);
    if (r.opinion) {
      const e = this.game.entities?.get?.(m.giver);
      if ((e?.opinionOfPlayer ?? 50) < r.opinion) out.push(`when ${this.giverName(m.giver)} thinks better of you`);
    }
    return out;
  }

  status(id) {
    const s = this.state[id];
    if (s) return s.status;
    const m = this.get(id);
    if (!m) return 'locked';
    return this.missing(m).length ? 'locked' : 'available';
  }

  available() {
    return this.missions.filter((m) => !this.state[m.id] && !this.missing(m).length);
  }

  active() {
    return this.missions.filter((m) => ACTIVE.has(this.state[m.id]?.status));
  }

  // ------------------------------------------------------------------ taking them on

  accept(id, { silent = false, askLyra = true } = {}) {
    const m = this.get(id);
    if (!m || this.state[id]) return false;
    const s = { status: 'active', step: 0, n: 0, t0: this.now(), stepT: 0, spawned: false, accepted: this.day(), lyra: null };
    this.state[id] = s;
    if (!this.tracked || !ACTIVE.has(this.state[this.tracked]?.status)) this.tracked = id;
    this.emit('mission_accepted', { id, mission: m });
    if (!silent) this.toast(this.objective(id)?.label || m.summary, 'quest', { title: `New mission: ${m.title}` });
    safe(() => this.game.audio?.play?.('quest', { volume: 0.6 }));
    if (askLyra && m.danger) this.askLyra(m);
    else if (m.lyra?.accept && !silent) this.lyraLine(m.lyra.accept);
    this.enterStep(id);
    this.save();
    return true;
  }

  decline(id) {
    const m = this.get(id);
    if (!m) return false;
    this.emit('mission_declined', { id, mission: m });
    return true;
  }

  abandon(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !s || s.status === 'done') return false;
    delete this.state[id];
    if (this.tracked === id) this.tracked = this.active()[0]?.id || null;
    this.emit('mission_abandoned', { id, mission: m });
    this.toast(`${m.title}: set aside. ${this.giverName(m.giver)} will still have it for you.`, 'info');
    this.save();
    return true;
  }

  track(id) {
    if (id === null || id === 'story') {
      this.tracked = id === 'story' ? 'story' : null;
      return true;
    }
    if (!ACTIVE.has(this.state[id]?.status)) return false;
    this.tracked = id;
    return true;
  }

  objective(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m) return null;
    const i = s ? Math.min(s.step, m.objectives.length - 1) : 0;
    return m.objectives[i] || null;
  }

  // The current objective in words, with when and how far.
  objectiveText(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !s) return '';
    if (s.status === 'ready') {
      const to = this.turnInTo(m);
      return to ? `Return to ${this.giverName(to)}` : 'Done';
    }
    const o = this.objective(id);
    if (!o) return '';
    let t = o.label || o.type;
    const w = o.when && !whenOk(o.when, this.game.clock) ? whenLabel(o.when) : '';
    if (w && !t.toLowerCase().includes(w.split(' ').pop())) t += ` (${w})`;
    const prog = progressText(o, this.progressOf(id));
    return prog ? `${t} · ${prog}` : t;
  }

  progressOf(id) {
    const s = this.state[id];
    const o = this.objective(id);
    if (!s || !o) return 0;
    if (o.type === 'bring') return this.held(o.item);
    return s.n;
  }

  held(item) {
    return safe(() => this.game.player?.inventory?.count?.(item), 0) || 0;
  }

  // ------------------------------------------------------------------ steps

  enterStep(id) {
    const s = this.state[id];
    if (!s) return;
    s.n = 0;
    s.stepT = 0;
    s.spawned = false;
    s.spawnIds = [];
    s.lit = [];
    s.doused = null;
    this.checkInstant(id);
  }

  // Objectives that may already be true the moment they start (an item already held).
  checkInstant(id) {
    const o = this.objective(id);
    const s = this.state[id];
    if (!o || s?.status !== 'active') return;
    if (o.type === 'bring' && this.held(o.item) >= (o.count ?? 1)) this.completeStep(id);
  }

  bump(id, amount = 1) {
    const s = this.state[id];
    const o = this.objective(id);
    if (!s || s.status !== 'active' || !o) return;
    const goal = objectiveGoal(o);
    const before = s.n;
    s.n = Math.min(goal, s.n + amount);
    if (Math.floor(s.n) !== Math.floor(before) || s.n >= goal) this.emit('mission_progress', { id, step: s.step, n: s.n, goal });
    if (s.n >= goal) this.completeStep(id);
  }

  completeStep(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !s || s.status !== 'active') return;
    s.step += 1;
    if (s.step >= m.objectives.length) {
      s.step = m.objectives.length - 1;
      s.n = objectiveGoal(m.objectives[s.step]);
      if (this.turnInTo(m)) {
        s.status = 'ready';
        this.emit('mission_ready', { id, mission: m });
        this.toast(`Return to ${this.giverName(this.turnInTo(m))}.`, 'quest', { title: `${m.title}: done` });
        safe(() => this.game.audio?.play?.('quest', { volume: 0.5 }));
      } else {
        this.complete(id);
      }
      this.save();
      return;
    }
    this.emit('mission_step', { id, step: s.step, mission: m });
    const next = m.objectives[s.step];
    this.toast(next.label, 'quest', { title: m.title });
    this.enterStep(id);
  }

  // Bring objectives still held? (items can be eaten or sold between steps)
  bringsHeld(m) {
    return m.objectives.filter((o) => o.type === 'bring').every((o) => this.held(o.item) >= (o.count ?? 1));
  }

  turnIn(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m || s?.status !== 'ready') return false;
    if (!this.bringsHeld(m)) {
      // They gave it away or ate it: back to the first bring that is short.
      const i = m.objectives.findIndex((o) => o.type === 'bring' && this.held(o.item) < (o.count ?? 1));
      s.status = 'active';
      s.step = Math.max(0, i);
      this.enterStep(id);
      return false;
    }
    // Handed over as part of the errand (not a gift: no gift gossip, no gift reaction).
    for (const o of m.objectives) {
      if (o.type !== 'bring') continue;
      safe(() => this.game.player.inventory.remove(o.item, o.count ?? 1));
      this.emit('mission_items', { id, itemId: o.item, qty: o.count ?? 1, to: this.turnInTo(m) });
    }
    this.complete(id);
    return true;
  }

  complete(id) {
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !s || s.status === 'done') return;
    s.status = 'done';
    s.done = this.day();
    if (this.tracked === id) this.tracked = this.active()[0]?.id || null;
    for (const r of m.rewards || []) this.grant(r, m);
    this.emit('mission_completed', { id, mission: m });
    if (m.lyra?.done) this.lyraLine(m.lyra.done, { delay: 2.5 });
    if (m.tip) {
      const touch = safe(() => this.game.ui?.isTouch, false);
      const t = typeof m.tip === 'string' ? m.tip : touch ? m.tip.touch : m.tip.desk;
      if (t) setTimeout(() => this.toast(t, 'info', { title: 'Tip' }), 1800);
    }
    this.save();
  }

  // ------------------------------------------------------------------ rewards

  grant(r, m) {
    const g = this.game;
    const p = g.player;
    const source = `mission:${m.id}`;
    let already = false;
    if (r.magic) {
      const { kind, id } = r.magic;
      already = this.unlocked(kind, id);
      this.granted.push({ kind, id, mission: m.id });
      unlockComponent(g, kind, id, source);
    } else if (r.slot) {
      const mg = g.magic;
      const fn = { weave: 'unlockSlot', essence: 'unlockEssenceSlot', twist: 'unlockTwistSlot' }[r.slot];
      if (typeof mg?.[fn] === 'function') safe(() => mg[fn]());
      else pendingFlag(g).push({ slot: r.slot, source });
    } else if (r.maxMana) {
      if (typeof g.magic?.addMaxMana === 'function') safe(() => g.magic.addMaxMana(r.maxMana));
      else pendingFlag(g).push({ maxMana: r.maxMana, source });
    } else if (r.coins && p?.inventory) {
      safe(() => p.inventory.add('coin', r.coins));
      this.emit('item_gained', { actor: p, itemId: 'coin', qty: r.coins, from: 'quest' });
    } else if (r.items && p?.inventory) {
      for (const [item, qty] of r.items) {
        safe(() => p.inventory.add(item, qty));
        this.emit('item_gained', { actor: p, itemId: item, qty, from: 'quest' });
      }
    } else if (r.xp && p) {
      if (typeof g.combat?.giveXp === 'function') safe(() => g.combat.giveXp(p, r.xp));
      else p.xp = (p.xp || 0) + r.xp;
    }
    this.emit('mission_reward', { id: m.id, reward: r, mission: m, already });
  }

  // Unlocks waiting for the runtime (a save from before magic, or magic not merged yet).
  flushPending() {
    const g = this.game;
    const list = g.flags?.pendingUnlocks;
    const mg = g.magic;
    if (!Array.isArray(list) || !list.length || !mg || typeof mg.unlock !== 'function') return;
    const keep = [];
    for (const u of list) {
      try {
        if (u.kind && u.id) mg.unlock(u.kind, u.id, u.source || 'pending');
        else if (u.slot) {
          const fn = { weave: 'unlockSlot', essence: 'unlockEssenceSlot', twist: 'unlockTwistSlot' }[u.slot];
          if (typeof mg[fn] === 'function') mg[fn]();
          else keep.push(u);
        } else if (u.maxMana) {
          if (typeof mg.addMaxMana === 'function') mg.addMaxMana(u.maxMana);
          else keep.push(u);
        }
      } catch {
        keep.push(u);
      }
    }
    g.flags.pendingUnlocks = keep;
  }

  // ------------------------------------------------------------------ events

  onEvent(type, p) {
    if (!p) return;
    const g = this.game;
    switch (type) {
      case 'spell_cast':
        if (isPlayer(g, p.caster)) this.onWeave(p);
        break;
      case 'death':
        this.onDeath(p);
        break;
      case 'boss_defeated':
        this.forCurrent('defeat', (id, o) => {
          if (o.target === `boss:${p.id}`) this.bump(id, 1);
        });
        break;
      case 'item_gained':
        if (!isPlayer(g, p.actor)) break;
        this.forCurrent('collect', (id, o) => {
          if (p.itemId !== o.item) return;
          if (o.at && !inPlace(g, o.at, g.player?.x, g.player?.y)) return;
          if (!whenOk(o.when, g.clock)) return;
          this.bump(id, p.qty || 1);
        });
        this.forCurrent('bring', (id) => this.checkInstant(id));
        break;
      case 'magic_unlocked':
        // A boss shard (or anything else) can open a mission's requirements.
        break;
      default:
        break;
    }
  }

  forCurrent(type, fn) {
    for (const [id, s] of Object.entries(this.state)) {
      if (s.status !== 'active') continue;
      const o = this.objective(id);
      if (o?.type === type) fn(id, o, s);
    }
  }

  onWeave(p) {
    const g = this.game;
    const pl = g.player;
    if (!this.flags.weave_seen) {
      this.flags.weave_seen = true;
      this.flags.firstWeaveAt = this.playT;
      this.emit('first_weave', { caster: pl });
    }
    const w = weaveOf(p);
    const aim = aimOf(p, pl);
    // A weave of parts only lent by "Try all magic" does not count for an objective.
    if (!weaveEarned(g, w)) return;
    this.forCurrent('weave', (id, o, s) => {
      if (!weaveMatches(o, w)) return;
      if (!whenOk(o.when, g.clock)) return;
      if (o.at && !inPlace(g, o.at, pl?.x, pl?.y) && !(aim && inPlace(g, o.at, aim.x, aim.y))) return;
      if (o.point && !nearPoint(o.point, pl?.x, pl?.y) && !(aim && nearPoint(o.point, aim.x, aim.y))) return;
      if (o.kindle) {
        const lamp = this.kindleLamp(o, s, pl, aim);
        if (!lamp) return;
      }
      this.bump(id, 1);
    });
  }

  // The far lamps on a lane go out for the round; a weave of light near one relights it.
  lampsFor(o) {
    const all = safe(() => this.game.objects?.all?.(), []) || [];
    return all.filter((ob) => ob?.objType === 'lamp' && !ob.alwaysLit && (ob.area === o.kindle || inPlace(this.game, o.kindle, ob.x, ob.y)));
  }

  // The wind has the far lamps out when the round starts: there is something to relight.
  douseLamps(o, s) {
    const lamps = this.lampsFor(o);
    const far = lamps.filter((l) => l.far);
    const out = (far.length >= (o.count ?? 1) ? far : lamps).slice(0, Math.max(o.count ?? 1, far.length));
    s.doused = out.map((l) => l.id);
    for (const l of out) safe(() => l.douse?.(null));
  }

  kindleLamp(o, s, pl, aim) {
    const lamps = this.lampsFor(o);
    if (!lamps.length) return { fallback: true };
    let best = null;
    let bd = Infinity;
    for (const l of lamps) {
      if (s.lit?.includes(l.id)) continue;
      if (s.doused?.length && !s.doused.includes(l.id) && lamps.filter((x) => s.doused.includes(x.id) && !s.lit?.includes(x.id)).length) continue;
      const d = Math.min(pl ? Math.hypot(l.x - pl.x, l.y - pl.y) : Infinity, aim ? Math.hypot(l.x - aim.x, l.y - aim.y) * 0.8 : Infinity);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (!best || bd > 84) return null;
    (s.lit = s.lit || []).push(best.id);
    safe(() => {
      best.state.lit = false;
      best.light?.(pl);
    });
    safe(() => this.game.particles?.emit?.('magic', best.x, best.y - 24, { count: 10 }));
    return best;
  }

  onDeath(p) {
    const g = this.game;
    const e = p.entity;
    if (!e) return;
    const k = p.killer;
    const ours = isPlayer(g, k) || isLyra(g, k) || isPlayer(g, k?.owner) || isPlayer(g, k?.caster) || isPlayer(g, e.lastAttacker);
    this.forCurrent('defeat', (id, o, s) => {
      if (isBossTarget(o.target)) return;
      if (!speciesMatches(o.target, e)) return;
      const spawned = s.spawnIds?.includes(e.uid ?? e.id) || e.missionId === id;
      if (!ours && !spawned) return;
      if (!spawned) {
        if (o.at && !inPlace(g, o.at, e.x, e.y)) return;
        if (!whenOk(o.when, g.clock)) return;
      }
      this.bump(id, 1);
    });
    // A protected one fell: the watch starts over.
    this.forCurrent('protect', (id, o, s) => {
      if (!o.target) return;
      if (e.id === o.target || speciesMatches(o.target, e)) {
        s.n = 0;
        this.toast(`${this.get(id).title}: start again.`, 'warn');
      }
    });
  }

  // ------------------------------------------------------------------ per step

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    this.playT += dt;
    this.pollT += dt;
    if (this.pollT < POLL) return;
    const step = Math.min(1, this.pollT);
    this.pollT = 0;
    this.flushPending();
    const pl = g.player;
    if (!pl) return;
    // Lyra's own missions close with her (round 14b, DESIGN §35.1): nobody else gives her
    // lessons, her waystone or her oath.
    if (safe(() => this.game.murder?.knownDead?.('lyra'), false)) {
      for (const [id, s] of Object.entries(this.state)) {
        const m = this.get(id);
        if (!m || m.giver !== 'lyra' || s.status === 'done' || s.status === 'closed') continue;
        s.status = 'closed';
        if (this.tracked === id) this.tracked = this.active()[0]?.id || null;
        this.toast(`${m.title}: ${this.giverName('lyra')} is dead. It ends here.`, 'info');
        this.emit('mission_closed', { id, mission: m, why: 'giver_dead' });
      }
    }
    for (const [id, s] of Object.entries(this.state)) {
      if (s.status !== 'active') continue;
      s.stepT += step;
      const o = this.objective(id);
      if (!o) continue;
      // A word for someone who has died (DESIGN §29): it can never be given; the step passes
      // (Lyra too, round 14b).
      if (o.type === 'talk' && o.target && safe(() => this.game.murder?.knownDead?.(o.target), false)) {
        this.toast(`${this.get(id).title}: ${this.giverName(o.target)} is dead. That word will never be given.`, 'info');
        this.bump(id, objectiveGoal(o));
        continue;
      }
      this.maybeSpawn(id, o, s);
      if (o.limit && s.stepT > o.limit) {
        this.toast(`${this.get(id).title}: too slow. Run it again.`, 'warn');
        s.step = Math.max(0, s.step - 1);
        this.enterStep(id);
        continue;
      }
      if (o.type === 'reach') this.pollReach(id, o, s, step);
      else if (o.type === 'protect') this.pollProtect(id, o, s, step);
      else if (o.type === 'talk' && o.target === 'lyra') this.pollLyraTalk(id, o);
      else if (o.type === 'bring') this.checkInstant(id);
    }
    // Ready missions whose items went missing go back to fetching.
    for (const [id, s] of Object.entries(this.state)) {
      if (s.status === 'ready' && !this.bringsHeld(this.get(id))) {
        const m = this.get(id);
        s.status = 'active';
        s.step = Math.max(0, m.objectives.findIndex((o) => o.type === 'bring' && this.held(o.item) < (o.count ?? 1)));
        this.enterStep(id);
      }
    }
    this.lyraTurn(step);
  }

  pollReach(id, o, s, step) {
    const g = this.game;
    const pl = g.player;
    if (!whenOk(o.when, g.clock)) return;
    let there = false;
    if (o.at) there = inPlace(g, o.at, pl.x, pl.y);
    else if (o.point) there = nearPoint(o.point, pl.x, pl.y);
    else if (o.entity) {
      const e = this.findEntity(o.entity);
      there = !!e && Math.hypot(e.x - pl.x, e.y - pl.y) <= (o.radius ?? 32);
    }
    if (!there) return;
    if (o.stay) this.bump(id, step);
    else this.bump(id, 1);
  }

  pollProtect(id, o, s, step) {
    const g = this.game;
    const pl = g.player;
    if (!whenOk(o.when, g.clock)) return;
    if (o.at && !inPlace(g, o.at, pl.x, pl.y)) return;
    if (pl.downed) {
      s.n = 0;
      return;
    }
    this.bump(id, step);
  }

  pollLyraTalk(id, o) {
    const g = this.game;
    const l = g.companion;
    const pl = g.player;
    if (!l || l.removed || l.downed || !pl) return;
    const cs = this.lyraWith();
    if (cs === 'left' || cs === 'gone') {
      // She will not teach someone she has cut off; the lesson they find alone, if it has one.
      if (o.alone) {
        this.toast(o.alone, 'info');
        this.bump(id, 1);
      }
      return;
    }
    if (Math.hypot(l.x - pl.x, l.y - pl.y) > TALK_REACH) return;
    const mind = l.mind;
    if (safe(() => mind?.isSpeaking?.(), false)) return;
    if (safe(() => (mind?.perception?.threats ?? 0) > 0, false)) return;
    // Some lessons are hers to give only while she trusts you (DESIGN §22.5): wary of
    // you, or less sure of you than she was, she says so once and waits.
    if (o.trust && (cs === 'wary' || this.lyraTrust() < o.trust)) {
      const s = this.state[id];
      if (s && !s.notNow) {
        s.notNow = true;
        if (o.notNow) this.lyraLines([o.notNow]);
      }
      return;
    }
    this.lyraLines(o.lines || []);
    this.bump(id, 1);
  }

  findEntity(ref) {
    const ents = this.game.entities;
    const direct = ents?.get?.(ref);
    if (direct && !direct.removed) return direct;
    const all = safe(() => ents?.all?.(), []) || [];
    const pl = this.game.player;
    let best = null;
    let bd = Infinity;
    for (const e of all) {
      if (e?.species !== ref || e.removed || e.dead) continue;
      const d = pl ? Math.hypot(e.x - pl.x, e.y - pl.y) : 0;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // An objective that needs foes or stones out there puts them there, once, when its
  // moment comes and the player is where it happens.
  maybeSpawn(id, o, s) {
    if (o.kindle && !s.doused && whenOk(o.when, this.game.clock)) this.douseLamps(o, s);
    const sp = o.spawn;
    if (!sp || s.spawned) return;
    const g = this.game;
    const pl = g.player;
    if (!whenOk(o.when, g.clock)) return;
    const at = sp.at || o.at;
    if (at && !inPlace(g, at, pl.x, pl.y)) return;
    s.spawned = true;
    s.spawnIds = [];
    // Harder as you grow (DESIGN §22.3, round 14: "I go through missions easily"): one
    // more foe every three levels, each tougher, and a pack of three or more has a leader.
    const lv = this.level();
    const extra = sp.species && !sp.fixed ? Math.min(3, Math.floor((lv - 1) / 3)) : 0;
    const n = (sp.count || 1) + extra;
    for (let i = 0; i < n; i++) {
      const spot = this.spawnSpot(at, sp.item ? 50 : 130, sp.item ? 150 : 200, i, n);
      if (!spot) continue;
      if (sp.item) {
        const drop = safe(() => dropPickup(g, sp.item, spot.x, spot.y), null);
        if (drop) drop.missionId = id;
      } else if (sp.species) {
        const c = safe(() => spawnFoe(g, sp.species, spot.x, spot.y), null);
        if (c) {
          c.missionId = id;
          toughen(c, lv, i === 0 && n >= 3);
          s.spawnIds.push(c.uid ?? c.id);
        }
      }
    }
  }

  spawnSpot(at, min, max, i, n) {
    const g = this.game;
    const pl = g.player;
    const rng = g.rng;
    const rand = () => (rng?.next ? rng.next() : Math.random());
    for (let tries = 0; tries < 24; tries++) {
      const a = ((i + rand() * 0.8) / Math.max(1, n)) * Math.PI * 2 + tries * 0.7;
      const r = min + rand() * (max - min);
      const x = pl.x + Math.cos(a) * r;
      const y = pl.y + Math.sin(a) * r;
      if (at && !inPlace(g, at, x, y) && tries < 18) continue;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      const blocked = safe(() => g.isBlockedTile?.(tx, ty, null), false) || safe(() => g.map?.isWater?.(tx, ty), false);
      if (blocked) continue;
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    return null;
  }

  // ------------------------------------------------------------------ Lyra

  lyraLine(text, { delay = 0 } = {}) {
    if (!text) return;
    this.pending.push({ lines: [text], wait: delay, near: true });
  }

  lyraLines(lines) {
    const mind = this.game.companion?.mind;
    if (typeof mind?.sayLines === 'function') {
      safe(() => mind.sayLines(lines, { chat: true, gap: 0.9 }));
      return;
    }
    for (const l of lines) safe(() => this.game.ui?.lyraSays?.(l));
  }

  // What Lyra has to say, said when she is near and free: comments, and her own offers.
  lyraTurn(step) {
    const g = this.game;
    const l = g.companion;
    const pl = g.player;
    // Nor while the player lies fallen: no lessons or offers over the fall.
    if (!l || !pl || l.downed || l.removed || pl.downed) return;
    const cs = this.lyraWith();
    if (cs === 'left' || cs === 'gone') {
      this.pending.length = 0;
      // The first lesson still happens; she just isn't the one giving it.
      const first = this.get('first_spark');
      if (first && this.status('first_spark') === 'available' && this.playT - (this.flags.firstWeaveAt ?? this.playT) > 6) this.accept('first_spark', { askLyra: false });
      return;
    }
    const near = Math.hypot(l.x - pl.x, l.y - pl.y) < 150;
    const mind = l.mind;
    const busy = safe(() => mind?.isSpeaking?.(), false) || safe(() => (mind?.perception?.threats ?? 0) > 0, false);
    if (this.pending.length) {
      const it = this.pending[0];
      it.wait -= step;
      if (it.wait <= 0 && near && !busy) {
        this.pending.shift();
        this.lyraLines(it.lines);
        if (it.then) safe(it.then);
        return;
      }
      if (it.wait < -60) this.pending.shift(); // the moment has passed
      return;
    }
    if (!busy && near) this.lyraOffers();
    this.nudge();
  }

  // Lyra's own missions: offered in her words, accepted with one tap in the chat.
  lyraOffers() {
    const day = this.day();
    if (this.playT - this.lastLyraOffer < LYRA_OFFER_GAP) return;
    for (const m of this.available()) {
      if (m.giver !== 'lyra') continue;
      if (m.id === 'first_spark') {
        // The first weave plays a story scene; this waits a moment for it.
        if (this.playT - (this.flags.firstWeaveAt ?? this.playT) < 6) continue;
        if (safe(() => this.game.story?.isPlaying?.(), false)) continue;
        this.lastLyraOffer = this.playT;
        this.offerFromLyra(m, { auto: true });
        return;
      }
      if (this.lyraOffered[m.id] === day) continue;
      this.lyraOffered[m.id] = day;
      this.lastLyraOffer = this.playT;
      this.offerFromLyra(m);
      return;
    }
  }

  offerFromLyra(m, { auto = false } = {}) {
    const g = this.game;
    const lines = m.offer || [];
    const name = this.giverName('lyra');
    if (auto) {
      // When the story scene already showed her asking, she doesn't ask twice.
      const told = safe(() => g.story?.seen?.('first_weave'), false);
      if (!told) this.lyraLines(lines);
      this.accept(m.id, { askLyra: false });
      return;
    }
    const mind = g.companion?.mind;
    if (typeof mind?.sayLines === 'function') safe(() => mind.sayLines(lines.slice(0, -1), { chat: true, gap: 0.9 }));
    const last = lines[lines.length - 1] || m.summary;
    const chat = g.ui?.chat;
    if (typeof chat?.addMessage === 'function') {
      safe(() => chat.addMessage({ from: 'lyra', text: last, offer: { label: `Yes: ${m.title}`, name: 'accept_mission', args: { value: m.id } } }));
      safe(() => g.bubbles?.say?.(g.companion, last, { kind: 'say' }));
    } else this.lyraLines([last]);
    this.toast(`${name} asks: ${m.title}. Answer in the chat, or in the Missions journal.`, 'lyra', { title: name });
    this.emit('mission_offered', { id: m.id, mission: m, by: 'lyra' });
  }

  // No weave yet after a while: a quiet hint that the hands can do something.
  nudge() {
    if (this.flags.weave_seen || this.flags.nudged || this.playT < NUDGE_AFTER) return;
    if (!this.game.magic) return;
    this.flags.nudged = true;
    const touch = safe(() => this.game.ui?.isTouch, false);
    this.toast(touch ? 'Your hands are tingling. Tap a weave button to weave.' : 'Your hands are tingling. Press 1 to weave toward the mouse.', 'info', { title: 'Weaving' });
  }

  // Dangerous missions: she weighs coming along through her own request API.
  askLyra(m) {
    const g = this.game;
    const l = g.companion;
    const mind = l?.mind;
    const s = this.state[m.id];
    if (!l || !mind || !s) return;
    const cs = this.lyraWith();
    if (cs === 'left' || cs === 'gone') {
      s.lyra = 'apart';
      return;
    }
    const near = g.player && Math.hypot(l.x - g.player.x, l.y - g.player.y) < 220;
    if (!near) {
      s.lyra = 'unasked';
      return;
    }
    let verdict = null;
    if (typeof mind.evaluateRequest === 'function') verdict = safe(() => mind.evaluateRequest({ action: 'explore', args: { target: m.danger, value: null, amount: null }, source: 'player' }), null);
    const ok = !verdict || verdict.decision === 'accept' || verdict.decision === 'accept_conditional';
    s.lyra = !verdict ? 'coming' : verdict.decision === 'accept_conditional' ? 'conditions' : ok ? 'coming' : 'declined';
    s.lyraWhy = verdict?.message || verdict?.condition?.text || (typeof verdict?.condition === 'string' ? verdict.condition : '') || '';
    // Her terms are hers to say; a plain yes may come in the mission's words.
    const line = s.lyra === 'conditions' ? verdict?.message || m.lyra?.accept || "I'll come. On my terms." : ok ? m.lyra?.accept || verdict?.message || "I'll come." : verdict?.message || "Not this one. I'll be here when you get back.";
    this.pending.unshift({ lines: [line], wait: 0.8, near: true });
    if (ok) {
      // Coming along means walking with the player, which is itself a request she weighs.
      safe(() => g.actions?.run?.('follow', { target: null, value: null, amount: null }, 'player'));
    }
    safe(() =>
      mind.remember?.(ok ? `I said I would go with ${playerName(g)} to ${placeName(g, m.danger)} for "${m.title}".` : `${playerName(g)} asked me along to ${placeName(g, m.danger)} for "${m.title}". I said no.`, {
        importance: 4,
        about: ['player', m.giver],
        tags: ['mission', m.id],
        emotion: ok ? 'trust' : 'fear',
      }),
    );
  }

  // ------------------------------------------------------------------ dialogue

  // Options a villager adds to their dialogue for missions: offer, turn in, a talk step.
  npcOptions(npc) {
    const id = npc?.id || npc?.profile?.id;
    if (!id) return [];
    const out = [];
    for (const m of this.active()) {
      const s = this.state[m.id];
      if (s.status === 'ready' && this.turnInTo(m) === id) out.push({ id: `mission:turnin:${m.id}`, label: `${m.title}: it's done` });
      const o = this.objective(m.id);
      if (s.status === 'active' && o?.type === 'talk' && o.target === id) out.push({ id: `mission:talk:${m.id}`, label: `About ${m.title}…` });
    }
    const offer = this.available().find((m) => this.giverOf(m) === id);
    if (offer) out.push({ id: `mission:offer:${offer.id}`, label: 'Need a hand?' });
    if (!out.length) {
      const mine = this.active().find((m) => this.giverOf(m) === id && this.state[m.id].status === 'active');
      if (mine) out.push({ id: `mission:progress:${mine.id}`, label: `About ${mine.title}…` });
    }
    return out;
  }

  // -> { lines, options?: [{id, label}] } (options null: the villager's own menu)
  npcChoose(npc, key) {
    const [, action, mid] = String(key || '').split(':');
    const m = this.get(mid);
    if (!m) return { lines: ['…'], options: null };
    if (action === 'offer') {
      if (this.state[mid]) return { lines: m.progress?.slice(0, 1) || ['…'], options: null };
      this.emit('mission_offered', { id: mid, mission: m, by: npc?.id });
      return {
        lines: [...this.standInLines(m, npc), ...(m.offer || [m.summary])],
        options: [
          { id: `mission:accept:${mid}`, label: "I'll do it" },
          { id: `mission:decline:${mid}`, label: 'Not now' },
        ],
      };
    }
    if (action === 'accept') {
      this.accept(mid);
      return { lines: [...(m.accept || ['Good.'])], options: null };
    }
    if (action === 'decline') {
      this.decline(mid);
      return { lines: [...(m.decline || ['Another time, then.'])], options: null };
    }
    if (action === 'progress') return { lines: [...(m.progress || ['Well?'])].slice(0, 1), options: null };
    if (action === 'talk') {
      const o = this.objective(mid);
      if (o?.type !== 'talk') return { lines: ['…'], options: null };
      this.bump(mid, 1);
      return { lines: [...(o.lines || ['…'])], options: null };
    }
    if (action === 'turnin') {
      const ok = this.turnIn(mid);
      if (!ok) return { lines: [...(m.progress || ['Not yet, I think.'])].slice(0, 1), options: null };
      return { lines: [...(m.turnin || ['Thank you.'])], options: null };
    }
    return { lines: ['…'], options: null };
  }

  // ------------------------------------------------------------------ HUD, markers, hints

  hudLine() {
    const id = this.tracked;
    if (!id || id === 'story') return null;
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !ACTIVE.has(s?.status)) return null;
    return { id, title: m.title, text: this.objectiveText(id), progress: this.progressOf(id), ready: s.status === 'ready' };
  }

  // Where the tracked objective is, as a world point (with the entity when it moves).
  targetOf(id) {
    const g = this.game;
    const m = this.get(id);
    const s = this.state[id];
    if (!m || !s) return null;
    const ent = (ref) => {
      const e = ref === 'lyra' ? lyraOf(g) : this.findEntity(ref);
      return e && !e.removed ? { x: e.x, y: e.y, entity: e } : null;
    };
    const place = (loc) => {
      const l = g.locations?.get?.(loc);
      return l?.center ? { x: l.center.x, y: l.center.y } : null;
    };
    if (s.status === 'ready') {
      const to = this.turnInTo(m);
      return to ? ent(to) : null;
    }
    const o = this.objective(id);
    if (!o) return null;
    if (o.type === 'talk') return ent(o.target);
    if (o.type === 'bring') {
      if (this.held(o.item) >= (o.count ?? 1)) return ent(this.turnInTo(m) || m.giver);
      return o.where ? place(o.where) : null;
    }
    if (o.type === 'reach' && o.entity) return ent(o.entity);
    if (o.point) return pointPx(o.point);
    if (o.type === 'defeat' && s.spawnIds?.length) {
      const all = safe(() => g.entities?.all?.(), []) || [];
      const alive = all.filter((e) => s.spawnIds.includes(e.uid ?? e.id) && !e.dead && !e.removed);
      if (alive.length) {
        const pl = g.player;
        alive.sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y));
        return { x: alive[0].x, y: alive[0].y, entity: alive[0] };
      }
    }
    if (o.type === 'defeat' && isBossTarget(o.target)) {
      const bid = o.target.slice(5);
      const pos = safe(() => g.bosses?.positionOf?.(bid), null);
      if (pos && Number.isFinite(pos.x)) return pos;
    }
    if (o.type === 'collect' && s.spawned) {
      const all = safe(() => g.entities?.all?.(), []) || [];
      const drop = all.find((e) => e.missionId === id && !e.removed);
      if (drop) return { x: drop.x, y: drop.y, entity: drop };
    }
    const loc = o.at || o.where;
    return loc ? place(loc) : null;
  }

  // Givers with something to offer, people to turn in to, and the tracked objective.
  markers() {
    const g = this.game;
    const out = [];
    const seen = new Set();
    for (const m of this.active()) {
      if (this.state[m.id].status !== 'ready') continue;
      const to = this.turnInTo(m);
      const e = to && to !== 'lyra' ? g.entities?.get?.(to) : null;
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        out.push({ kind: 'turnin', id: m.id, entity: e, x: e.x, y: e.y });
      }
    }
    let board = false;
    for (const m of this.available()) {
      const giver = this.giverOf(m);
      if (giver === 'board') {
        board = true;
        continue;
      }
      if (giver === 'lyra') continue;
      const e = g.entities?.get?.(giver);
      if (e && !e.removed && !seen.has(e.id)) {
        seen.add(e.id);
        out.push({ kind: 'offer', id: m.id, entity: e, x: e.x, y: e.y });
      }
    }
    if (board) {
      const b = g.objects?.get?.('notice_board');
      if (b) out.push({ kind: 'offer', id: 'board', object: b, x: b.x, y: b.y, board: true });
    }
    const t = this.tracked && this.tracked !== 'story' ? this.targetOf(this.tracked) : null;
    if (t && !(t.entity && seen.has(t.entity.id))) out.push({ kind: 'objective', id: this.tracked, x: t.x, y: t.y, entity: t.entity || null });
    return out;
  }

  // For the Spellbook's locked silhouettes: where this piece of the Weave comes from.
  hintFor(kind, id) {
    if (!isComponent(kind, id)) return '';
    const boss = bossFor(kind, id);
    if (boss) return `${capFirst(BOSS_NAMES[boss])} carries it, in ${BOSS_PLACES[boss]}.`;
    const m = this.missions.find((x) => (x.rewards || []).some((r) => r.magic?.kind === kind && r.magic?.id === id));
    if (!m) return kind === 'shape' && id === 'bolt' ? 'You woke with it.' : '';
    const giver = this.giverOf(m);
    const who = this.giverName(giver);
    const st = this.status(m.id);
    if (st === 'done') return `From ${who}: "${m.title}".`;
    if (st === 'active' || st === 'ready') return `${m.title}: ${this.objectiveText(m.id)}.`;
    if (st === 'available') return giver === 'board' ? `On the notice board: "${m.title}".` : `${who} ${this.giverWhere(giver)} has work for you: "${m.title}".`;
    const why = this.missing(m)[0];
    return giver === 'board' ? `A notice will go up on the board${why ? `, ${why}` : ''}.` : `${who} ${this.giverWhere(giver)} may have work for you${why ? `, ${why}` : ' later'}.`;
  }

  // Rewards in words: [{ kind: 'magic'|'slot'|'coins'|..., text }]
  rewardWords(m) {
    const out = [];
    for (const r of m.rewards || []) {
      if (r.magic) {
        const w = componentWords(r.magic.kind, r.magic.id);
        out.push({ kind: 'magic', magic: r.magic, text: `${componentLabel(r.magic.kind, r.magic.id, this.game)} (${r.magic.kind})`, line: w.line });
      } else if (r.slot) out.push({ kind: 'slot', text: r.slot === 'weave' ? 'A new weave slot' : r.slot === 'essence' ? 'Room for a third essence' : 'Room for another twist' });
      else if (r.maxMana) out.push({ kind: 'mana', text: `+${r.maxMana} mana` });
      else if (r.coins) out.push({ kind: 'coins', text: `${r.coins} coins` });
      else if (r.xp) out.push({ kind: 'xp', text: `${r.xp} xp` });
      else if (r.items) for (const [item, qty] of r.items) out.push({ kind: 'item', item, text: `${qty} × ${String(item).replace(/_/g, ' ')}` });
    }
    return out;
  }

  // Everything the journal shows.
  journal() {
    const card = (m) => {
      const s = this.state[m.id];
      return {
        id: m.id,
        title: m.title,
        summary: m.summary,
        giver: this.giverOf(m),
        giverName: this.giverName(this.giverOf(m)),
        status: this.status(m.id),
        tracked: this.tracked === m.id,
        lyra: s?.lyra || null,
        lyraWhy: s?.lyraWhy || '',
        objectives: m.objectives.map((o, i) => ({
          label: o.label,
          done: s ? s.status === 'done' || s.status === 'ready' || i < s.step : false,
          current: s ? s.status === 'active' && i === s.step : false,
          progress: s && s.status === 'active' && i === s.step ? progressText(o, this.progressOf(m.id)) : '',
          when: o.when ? whenLabel(o.when) : '',
        })),
        text: s ? this.objectiveText(m.id) : '',
        rewards: this.rewardWords(m),
        board: m.board || '',
        hint: m.hint || '',
        canAccept: !s && (m.giver === 'lyra' || this.giverOf(m) === 'board') && !this.missing(m).length,
        turnTo: this.turnInTo(m) ? this.giverName(this.turnInTo(m)) : '',
      };
    };
    const active = this.active().map(card);
    active.sort((a, b) => (b.tracked ? 1 : 0) - (a.tracked ? 1 : 0));
    const avail = this.available();
    const upcoming = this.missions
      .filter((m) => !this.state[m.id] && this.missing(m).length)
      .filter((m) => (m.requires?.missions || []).every((r) => this.status(r) === 'done' || this.status(r) === 'active' || this.status(r) === 'ready'))
      .slice(0, 4)
      .map((m) => ({ ...card(m), why: this.missing(m)[0] || '' }));
    return {
      active,
      available: avail.filter((m) => this.giverOf(m) !== 'board').map(card),
      board: avail.filter((m) => this.giverOf(m) === 'board').map(card),
      upcoming,
      completed: this.missions.filter((m) => this.state[m.id]?.status === 'done').map(card),
      story: this.storyCard(),
      counts: { done: this.doneCount(), total: this.missions.length },
    };
  }

  storyCard() {
    const qp = safe(() => this.game.plugins?.get?.('quest'), null);
    if (!qp) return null;
    const info = safe(() => qp.stageOf(this.game), null);
    if (!info) return null;
    return { id: 'story', title: qp.questName || "Maren's thread", text: info.text, stage: info.index, tracked: this.tracked === 'story' || !this.tracked };
  }

  // ------------------------------------------------------------------ saving

  save() {
    try {
      if (this.game.save) this.game.save.pending = this.game.save.pending || 'auto';
    } catch {
      /* saving is optional */
    }
  }

  serialize() {
    const state = {};
    for (const [id, s] of Object.entries(this.state)) {
      state[id] = { status: s.status, step: s.step, n: Math.round(s.n * 100) / 100, t0: Math.round(s.t0 || 0), accepted: s.accepted, done: s.done ?? null, lyra: s.lyra || null, lit: s.lit?.slice(0, 12) || [] };
    }
    return { v: 1, state, tracked: this.tracked, flags: { ...this.flags }, granted: this.granted.slice(), lyraOffered: { ...this.lyraOffered }, playT: Math.round(this.playT) };
  }

  deserialize(d) {
    this.reset();
    if (!d || typeof d !== 'object') return;
    for (const [id, s] of Object.entries(d.state || {})) {
      const m = this.get(id);
      if (!m || !s || !['active', 'ready', 'done'].includes(s.status)) continue;
      this.state[id] = {
        status: s.status,
        step: Math.max(0, Math.min(m.objectives.length - 1, Number(s.step) || 0)),
        n: Number(s.n) || 0,
        t0: Number(s.t0) || 0,
        stepT: 0,
        accepted: s.accepted ?? 1,
        done: s.done ?? null,
        // Spawned foes are not saved with the world: an unfinished fight sets up again.
        spawned: false,
        spawnIds: [],
        lyra: s.lyra || null,
        lit: Array.isArray(s.lit) ? s.lit.slice(0, 12) : [],
      };
    }
    this.tracked = d.tracked && (d.tracked === 'story' || ACTIVE.has(this.state[d.tracked]?.status)) ? d.tracked : this.active()[0]?.id || null;
    this.flags = d.flags && typeof d.flags === 'object' ? { ...d.flags } : {};
    this.granted = Array.isArray(d.granted) ? d.granted.filter((g) => g && isComponent(g.kind, g.id)) : [];
    this.lyraOffered = d.lyraOffered && typeof d.lyraOffered === 'object' ? { ...d.lyraOffered } : {};
    this.playT = Number(d.playT) || 0;
  }
}

// ------------------------------------------------------------------ helpers

function capFirst(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function playerName(g) {
  return g.settings?.playerName || 'the stranger';
}

function placeName(g, id) {
  return g.locations?.get?.(id)?.name || String(id || 'there').replace(/_/g, ' ');
}

function pendingFlag(g) {
  if (!g.flags) g.flags = {};
  if (!Array.isArray(g.flags.pendingUnlocks)) g.flags.pendingUnlocks = [];
  return g.flags.pendingUnlocks;
}

// Every unlock goes through game.magic.unlock (it emits magic_unlocked). Before the runtime
// exists, the unlock waits in game.flags.pendingUnlocks, the same place boss shards use.
export function unlockComponent(g, kind, id, source) {
  const mg = g.magic;
  if (mg && typeof mg.unlock === 'function') {
    try {
      mg.unlock(kind, id, source);
      const u = mg.unlocked;
      const set = u?.[`${kind}s`];
      // A runtime that keys its kinds in the plural gets them that way too.
      if (set && typeof set.has === 'function' && !set.has(id)) mg.unlock(`${kind}s`, id, source);
      return true;
    } catch (err) {
      console.warn('[missions] unlock failed', kind, id, err);
    }
  }
  pendingFlag(g).push({ kind, id, source });
  return false;
}

// Lazy imports keep the system loadable in tests without the creature/pickup modules'
// art and AI: the game passes them in through these hooks (plugin.js sets them).
let SPAWN_FOE = null;
let DROP = null;
export function setSpawners({ foe, drop } = {}) {
  if (foe) SPAWN_FOE = foe;
  if (drop) DROP = drop;
}
// A mission's foes grow with the stranger: more health and bite per level, and the
// first of a pack of three or more leads it (tougher, quicker, and named for it).
export function toughen(c, level, leader = false) {
  if (!c) return c;
  const lv = Math.max(1, level || 1);
  const hp = Math.min(2.2, 1 + 0.12 * (lv - 1)) * (leader ? 1.6 : 1);
  const atk = Math.min(1.6, 1 + 0.06 * (lv - 1)) * (leader ? 1.2 : 1);
  if (Number.isFinite(c.maxHp)) {
    c.maxHp = Math.round(c.maxHp * hp);
    c.hp = c.maxHp;
  }
  if (Number.isFinite(c.atk)) c.atk = Math.max(1, Math.round(c.atk * atk));
  if (leader) {
    c.leader = true;
    if (Number.isFinite(c.speed)) c.speed *= 1.08;
    if (c.name && !/^Scarred /.test(c.name)) c.name = `Scarred ${String(c.name).toLowerCase()}`;
  }
  return c;
}

function spawnFoe(g, species, x, y) {
  return SPAWN_FOE ? SPAWN_FOE(g, species, x, y, { missionSpawn: true }) : null;
}
function dropPickup(g, item, x, y) {
  return DROP ? DROP(g, item, 1, x, y, { missionGlow: true }) : null;
}

export { missionById };
