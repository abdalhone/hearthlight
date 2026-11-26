// game.bosses: the five bosses' lives (DESIGN §22.3). It places each boss in its arena
// when the world is built, starts a fight when the player walks into the arena (after the
// boss's short intro scene, the first time), runs the health bar, the music and Lyra's
// choice to fight or hold back, and ends it: a win drops the glyph-shards and is saved
// in game.flags.bosses; a loss (the player knocked out, or walking away) resets the boss
// to full strength at home, ready for another try.
//
// Events: boss_started {id, boss}, boss_phase {id, phase}, boss_defeated {id, boss},
//         boss_reset {id, reason}, glyph_shard {kind, id, source, boss} (from the shard)
//
//   bosses.status(id)    'hidden' | 'waiting' | 'fighting' | 'defeated'
//   bosses.get(id)       the boss actor (or null)
//   bosses.active        { id, boss, t, lyra } while a fight is on
//   bosses.startFight(id, { intro })  (tests and debugging)

import { TILE } from '../core/constants.js';
import { BOSSES, BOSS_IDS, rewardSource } from './defs.js';
import { Boss, isBoss } from './boss.js';
import { BRAINS } from './brains.js';
import { dropGlyphShard } from './shard.js';
import { BossSfx } from './sting.js';
import { clearHazards } from './hazards.js';
import { SCRIPTS } from '../story/scripts.js';
import { registerBossScripts, BOSS_INTRO, LYRA_BOSS_LINES } from '../story/scripts_bosses.js';
import { alive } from '../entities/creature_util.js';
import { holderOf, lyraDead } from '../core/party.js';
import { fightAbility } from '../entities/npc_companion.js';

const CHECK_EVERY = 0.2;
const LEAVE_MARGIN = 96; // px past the arena's edge before walking away counts
const LEAVE_SECONDS = 6;

const px = (t) => t * TILE + TILE / 2;

// Night for Greyjaw: from dusk to dawn.
function isNightish(game) {
  const c = game.clock;
  if (!c) return true;
  if (c.isNight) return true;
  const h = Number(c.hour);
  return Number.isFinite(h) && (h >= 18 || h < 5.5);
}

export class BossManager {
  constructor(game) {
    this.game = game;
    this.list = new Map(); // id -> Boss
    this.arenas = {};
    this.active = null;
    this.starting = null; // an intro is playing for this id
    this.sfx = new BossSfx(game);
    this.checkT = 0;
    this.dayHint = -1;
    this.ui = null; // the boss bar (src/ui/boss_bar.js) mounts itself here
    this.hooked = false;
    this.timers = []; // [{ t, fn }] on game time: they wait out scenes and pauses
    try {
      registerBossScripts(SCRIPTS);
    } catch (err) {
      console.error('[bosses] could not register the intros', err);
    }
    const bus = game.bus;
    bus?.on?.('game_start', (p) => {
      if (p?.loaded) this.afterLoad();
    });
    bus?.on?.('downed', (p) => {
      if (p?.entity && p.entity === game.player && this.active) this.lose('player_down');
    });
    bus?.on?.('glyph_shard', (p) => this.onShardTaken(p));
  }

  // Saved with the game: { [id]: { defeated, day, shards: { 'essence:fire': 'dropped'|'taken' } } }
  get data() {
    const g = this.game;
    if (!g.flags) g.flags = {};
    if (!g.flags.bosses || typeof g.flags.bosses !== 'object') g.flags.bosses = {};
    return g.flags.bosses;
  }

  record(id) {
    const d = this.data;
    if (!d[id] || typeof d[id] !== 'object') d[id] = { defeated: false, shards: {} };
    if (!d[id].shards) d[id].shards = {};
    return d[id];
  }

  isDefeated(id) {
    return !!this.data[id]?.defeated;
  }

  get(id) {
    return this.list.get(id) || null;
  }

  status(id) {
    if (this.isDefeated(id)) return 'defeated';
    if (this.active?.id === id) return 'fighting';
    const b = this.list.get(id);
    if (!b || b.removed || b.mode === 'hidden') return 'hidden';
    return 'waiting';
  }

  // ------------------------------------------------------------ world

  // Arenas in world pixels: from worldgen when it gives them, else each boss's fallback.
  arenaFor(id) {
    const def = BOSSES[id];
    const w = this.game.spawns?.bosses?.[id];
    if (w && w.center && Number.isFinite(w.center.x)) {
      return { x: w.center.x, y: w.center.y, r: w.r || def.arena.r * TILE, home: w.home || w.center, spots: w.spots || null, exit: w.exit || null };
    }
    const a = def.arena;
    return { x: px(a.center[0]), y: px(a.center[1]), r: a.r * TILE, home: { x: px(a.home[0]), y: px(a.home[1]) }, spots: null, exit: null };
  }

  installDamageHook() {
    const combat = this.game.combat;
    if (!combat || typeof combat.damage !== 'function' || combat._bossHook) return;
    // Bosses get a word before a blow lands: shields turn it aside, a body under water
    // is out of reach, a staggered knight takes more. One wrapper, for every source.
    const orig = combat.damage;
    combat.damage = function bossAwareDamage(source, target, amount, opts = {}) {
      if (target && isBoss(target)) {
        let a = amount;
        try {
          a = target.hitMul(source && source.type === 'projectile' ? source.owner || source : source, amount, opts);
        } catch (err) {
          console.error('[bosses] hit hook failed', err);
          a = amount;
        }
        if (!(a > 0)) return 0;
        amount = a;
      }
      return orig.call(this, source, target, amount, opts);
    };
    combat._bossHook = true;
    this.hooked = true;
  }

  // After the world is built: every boss to its place (Varek takes the chief's).
  onWorldBuilt() {
    const g = this.game;
    this.installDamageHook();
    for (const id of BOSS_IDS) {
      try {
        this.spawn(id);
      } catch (err) {
        console.error('[bosses] could not place', id, err);
      }
    }
    void g;
  }

  spawn(id) {
    const g = this.game;
    const def = BOSSES[id];
    if (!def || !g.entities) return null;
    const old = this.list.get(id);
    if (old && !old.removed) return old;
    const arena = this.arenaFor(id);
    this.arenas[id] = arena;
    let home = { ...arena.home };
    if (id === 'varek') {
      // The chief the world placed at the camp becomes the boss, where he stood.
      for (const e of g.entities.all?.() || []) {
        if (e.species === 'bandit_chief' && !isBoss(e) && !e.removed) {
          home = { x: e.x, y: e.y };
          e.removed = true;
          g.entities.remove?.(e);
        }
      }
    }
    const mode = def.night && !isNightish(g) ? 'hidden' : 'idle';
    const b = new Boss(g, { ...def, base: 'bandit_chief' }, BRAINS[id], { x: home.x, y: home.y, home, arena, mode });
    g.entities.add(b);
    this.list.set(id, b);
    return b;
  }

  // A loaded game: beaten bosses stay beaten; shards nobody picked up are still there.
  afterLoad() {
    const g = this.game;
    for (const id of BOSS_IDS) {
      const rec = this.data[id];
      if (!rec?.defeated) continue;
      const b = this.list.get(id);
      if (b && !b.removed) {
        b.mode = 'gone';
        g.entities?.remove?.(b);
      }
      this.list.delete(id);
      const arena = this.arenas[id] || this.arenaFor(id);
      const left = Object.entries(rec.shards || {}).filter(([, v]) => v !== 'taken');
      left.forEach(([key], i) => {
        const [kind, gid] = key.split(':');
        dropGlyphShard(g, kind, gid, arena.x + (i - (left.length - 1) / 2) * 18, arena.y, { source: rewardSource(id), boss: id, collectDelay: 0.3 });
      });
    }
  }

  // ------------------------------------------------------------ per step

  // Run fn after `seconds` of play.
  later(seconds, fn) {
    this.timers.push({ t: Math.max(0, seconds), fn });
  }

  runTimers(dt) {
    const list = this.timers;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      it.t -= dt;
      if (it.t > 0) continue;
      list.splice(i, 1);
      try {
        it.fn();
      } catch (err) {
        console.error('[bosses] timer failed', err);
      }
    }
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    if (this.timers.length) this.runTimers(dt);
    this.checkT -= dt;
    if (this.active) this.updateFight(dt);
    if (this.checkT > 0) return;
    this.checkT = CHECK_EVERY;
    this.updatePresence();
    if (!this.active && !this.starting) this.checkArenas();
  }

  // Greyjaw keeps the dark: out from dusk, gone by morning (never while you watch).
  updatePresence() {
    const g = this.game;
    const b = this.list.get('greyjaw');
    if (!b || b.removed || this.active?.id === 'greyjaw' || this.isDefeated('greyjaw')) return;
    const night = isNightish(g);
    const p = g.player;
    const watched = p && Math.hypot(p.x - b.home.x, p.y - b.home.y) < 260;
    if (night && b.mode === 'hidden') {
      // Out of the trees: at his den, or (if you are already standing in it) from the
      // side of the clearing farthest from you.
      let x = b.home.x;
      let y = b.home.y;
      if (watched && p) {
        const a = this.arenas.greyjaw;
        const ang = Math.atan2(a.y - p.y, a.x - p.x);
        x = a.x + Math.cos(ang) * a.r * 0.8;
        y = a.y + Math.sin(ang) * a.r * 0.6;
        if (g.isBlockedTile?.(Math.floor(x / TILE), Math.floor(y / TILE), b)) {
          x = b.home.x;
          y = b.home.y;
        }
      }
      b.mode = 'idle';
      b.x = x;
      b.y = y;
      b.setVeiled(false);
    } else if (!night && b.mode === 'idle' && !watched) {
      b.mode = 'hidden';
      b.setVeiled(true);
    }
  }

  checkArenas() {
    const g = this.game;
    const p = g.player;
    if (!p || p.removed || !alive(p)) return;
    for (const [id, b] of this.list) {
      if (!b || b.removed || b.mode !== 'idle' || this.isDefeated(id)) continue;
      const a = this.arenas[id];
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d <= a.r) {
        this.trigger(id);
        return;
      }
    }
    // Greyjaw's den by day: tracks, and Lyra knows what they mean.
    const gj = this.list.get('greyjaw');
    const a = this.arenas.greyjaw;
    if (gj && a && gj.mode === 'hidden' && !this.isDefeated('greyjaw') && Math.hypot(p.x - a.x, p.y - a.y) < a.r) {
      const day = g.clock?.day ?? 1;
      if (this.dayHint !== day) {
        this.dayHint = day;
        this.lyraSay(LYRA_BOSS_LINES.daytrack);
      }
    }
  }

  // Someone struck a boss that was only waiting: the fight starts now.
  provoked(b, source) {
    if (this.active || this.starting || !b || b.mode !== 'idle') return;
    const g = this.game;
    const src = source?.type === 'projectile' ? source.owner : source;
    if (src !== g.player && src !== g.companion) return;
    this.trigger(b.bossId);
  }

  async trigger(id) {
    if (this.active || this.starting) return;
    const g = this.game;
    const b = this.list.get(id);
    if (!b || b.removed) return;
    const script = BOSS_INTRO[id];
    const story = g.story;
    const canPlay = story && typeof story.play === 'function' && story.autoScenes && script && SCRIPTS[script] && !story.seen?.(script) && !story.isPlaying?.();
    if (canPlay) {
      this.starting = id;
      try {
        await story.play(script, { scene: { id: script } });
      } catch (err) {
        console.error('[bosses] intro failed', err);
      }
      this.starting = null;
      if (g.state !== 'playing' || b.removed || b.mode !== 'idle') return;
    }
    this.begin(id, { introPlayed: !!canPlay });
  }

  // Start the fight now (no intro). Returns the boss.
  startFight(id) {
    if (this.active?.id === id) return this.active.boss;
    if (this.active) this.lose('switched');
    const b = this.list.get(id) || this.spawn(id);
    if (!b) return null;
    if (b.mode === 'hidden') {
      b.mode = 'idle';
      b.setVeiled(false);
    }
    this.begin(id, { introPlayed: false });
    return b;
  }

  begin(id, { introPlayed = false } = {}) {
    const g = this.game;
    const b = this.list.get(id);
    if (!b || b.removed) return;
    b.mode = 'fight';
    b.t = 0;
    b.setVeiled(false);
    b.faction = b.baseFaction;
    this.active = { id, boss: b, t: 0, outT: 0, lyra: 'absent', told: false };
    try {
      b.brain?.start?.(b);
    } catch (err) {
      console.error('[bosses] start failed', err);
    }
    this.active.lyra = this.companionJoins(b);
    g.bus?.emit?.('boss_started', { id, boss: b, name: b.info.name });
    this.sfx.sting('intro', id);
    try {
      g.audio?.setMusic?.('combat');
    } catch {
      /* music is optional */
    }
    this.ui?.show?.(b);
    void introPlayed;
  }

  updateFight(dt) {
    const g = this.game;
    const A = this.active;
    const b = A.boss;
    A.t += dt;
    if (!b || b.removed || b.mode === 'gone') {
      if (b?.mode !== 'gone') this.lose('vanished');
      return;
    }
    this.ui?.update?.(b, dt);
    this.frameCamera(b, dt);
    if (b.mode === 'defeat') return;
    // Walking away ends it; the boss goes home and mends.
    const p = g.player;
    const a = b.arena;
    if (p && Math.hypot(p.x - a.x, p.y - a.y) > a.r + LEAVE_MARGIN) {
      A.outT += dt;
      if (A.outT > LEAVE_SECONDS) this.lose('left');
    } else A.outT = 0;
  }

  // Keep the boss in the picture: the camera leans from the player toward it (never so
  // far the player leaves the screen), and lets go when the fight ends.
  frameCamera(b, dt) {
    const g = this.game;
    const cam = g.camera;
    const p = g.player;
    if (!cam || !p || typeof cam.follow !== 'function') return;
    const F = this.frame || (this.frame = { x: p.x, y: p.y, dx: 0, dy: 0 });
    const near = !b.veiled && b.mode !== 'gone' && Math.hypot(b.x - p.x, b.y - p.y) < 300;
    const mx = Math.max(0, (cam.vw || 400) / 2 - 60);
    const my = Math.max(0, (cam.vh || 240) / 2 - 50);
    const tx = near ? Math.max(-mx, Math.min(mx, (b.x - p.x) * 0.42)) : 0;
    const ty = near ? Math.max(-my, Math.min(my, (b.y - 14 - p.y) * 0.42)) : 0;
    const k = Math.min(1, dt * 2.5);
    F.dx += (tx - F.dx) * k;
    F.dy += (ty - F.dy) * k;
    F.x = p.x + F.dx;
    F.y = p.y + F.dy;
    if (cam.target === p) cam.follow(F);
  }

  releaseCamera() {
    const g = this.game;
    const F = this.frame;
    if (F && g.camera?.target === F) g.camera.follow(g.player);
    if (F) F.dx = F.dy = 0;
  }

  onPhase(b, phase) {
    if (this.active?.boss !== b) return;
    this.game.bus?.emit?.('boss_phase', { id: b.bossId, phase, boss: b });
    this.sfx.sting('phase', b.bossId);
    this.ui?.phase?.(b, phase);
  }

  onShield(b, on) {
    if (this.active?.boss !== b) return;
    this.ui?.shield?.(b, on);
  }

  // The boss is beaten (its defeat is about to play out).
  onDefeatBegin(b) {
    const g = this.game;
    const id = b.bossId;
    const rec = this.record(id);
    rec.defeated = true;
    rec.day = g.clock?.day ?? 1;
    for (const [kind, gid] of b.info.rewards || []) if (!rec.shards[`${kind}:${gid}`]) rec.shards[`${kind}:${gid}`] = 'owed';
    if (b.info.yields) g.flags.varek_beaten = rec.day;
    g.bus?.emit?.('boss_defeated', { id, boss: b, name: b.info.name, yielded: !!b.info.yields });
    this.sfx.sting('defeat', id);
    this.ui?.defeat?.(b);
    try {
      g.audio?.setMusic?.(null);
    } catch {
      /* music is optional */
    }
    const lyraNear = g.companion && !g.companion.downed && Math.hypot(g.companion.x - b.x, g.companion.y - b.y) < 220;
    if (lyraNear) this.later(1.4, () => this.lyraSay(LYRA_BOSS_LINES.win[id]));
    try {
      const mind = g.companion?.mind;
      const fought = this.active?.lyra === 'joined';
      mind?.remember?.(fought ? `We beat ${b.info.name} together.` : `The stranger beat ${b.info.name}. I watched.`, {
        importance: 7,
        about: ['player'],
        tags: ['boss', id],
        emotion: fought ? 'joy' : 'surprise',
        type: 'event',
      });
    } catch {
      /* her memory is optional */
    }
  }

  // Its defeat has played out: the shards (if the brain did not already free them).
  onDefeated(b) {
    const g = this.game;
    if (!b.mem.shardsDropped) {
      let spot = { x: b.x, y: b.y };
      try {
        spot = b.brain?.shardSpot?.(b) || spot;
      } catch {
        /* where it fell */
      }
      this.dropShards(b, spot.x, spot.y);
    }
    if (this.active?.boss === b) this.finish();
    this.list.delete(b.bossId);
    void g;
  }

  dropShards(b, x, y) {
    if (b.mem.shardsDropped) return;
    b.mem.shardsDropped = true;
    const g = this.game;
    const rec = this.record(b.bossId);
    const rewards = b.info.rewards || [];
    rewards.forEach(([kind, gid], i) => {
      const a = (i - (rewards.length - 1) / 2) * 1.2 - Math.PI / 2;
      dropGlyphShard(g, kind, gid, x, y, { source: rewardSource(b.bossId), boss: b.bossId, rise: true, vx: Math.cos(a) * 30, vy: Math.sin(a) * -12 + 14 });
      rec.shards[`${kind}:${gid}`] = 'dropped';
    });
  }

  onShardTaken(p) {
    if (!p?.boss) return;
    const rec = this.data[p.boss];
    if (rec?.shards) rec.shards[`${p.kind}:${p.id}`] = 'taken';
    const line = LYRA_BOSS_LINES.glyph[p.id];
    if (line) this.later(2.6, () => this.lyraSay(line));
    this.sfx.sting('reveal', p.boss);
  }

  finish() {
    const g = this.game;
    const A = this.active;
    this.active = null;
    this.releaseCamera();
    if (A?.lyra === 'declined' || A?.lyra === 'joined') this.releaseLyra(A);
    this.later(2.6, () => {
      if (!this.active) this.ui?.hide?.();
    });
    void g;
  }

  // The fight is lost or abandoned: the boss goes home whole, ready for the next try.
  lose(reason = 'lost') {
    const g = this.game;
    const A = this.active;
    if (!A) return;
    this.active = null;
    this.releaseCamera();
    const b = A.boss;
    try {
      b?.reset?.();
      if (b?.info?.night && !isNightish(g)) {
        b.mode = 'hidden';
        b.setVeiled(true);
      }
    } catch (err) {
      console.error('[bosses] reset failed', err);
    }
    clearHazards(g, b);
    g.bus?.emit?.('boss_reset', { id: A.id, reason, boss: b });
    this.ui?.hide?.();
    try {
      g.audio?.setMusic?.(null);
    } catch {
      /* music is optional */
    }
    this.releaseLyra(A);
  }

  // ------------------------------------------------------------ Lyra

  // Whoever walks with you (round 14b, DESIGN §34.4): Lyra by her own verdict (lyraJoins);
  // a villager by their nerve, health and whether they can fight at all. -> 'joined' |
  // 'declined' | 'absent'
  companionJoins(b) {
    const g = this.game;
    const h = holderOf(g);
    if (!h) return 'absent';
    if (h.id === 'lyra') return this.lyraJoins(b);
    if (h.removed || h.downed || !alive(h)) return 'absent';
    const a = b.arena;
    if (Math.hypot(h.x - a.x, h.y - a.y) > a.r + 170) return 'absent';
    const able = fightAbility(g, h) >= 1 && h.hp >= h.maxHp * 0.5;
    const name = String(h.name || '').split(' ')[0];
    try {
      if (able) h.duty?.request?.(fightAbility(g, h) >= 2 ? 'attack' : 'defend');
      else h.duty?.request?.('stay');
      g.ui?.personSays?.(h, able ? `${b.info?.name ? `${b.info.name}. ` : ''}I'm with you. Don't let it get behind us.` : `I can't fight that. I'll keep back here.`);
    } catch {
      /* they decide anyway */
    }
    if (!able) g.bus?.emit?.('boss_companion_declined', { id: b.bossId, who: h.id, name });
    return able ? 'joined' : 'declined';
  }

  // Did she come, and does she want this fight? Her own judgment (DESIGN §16.4): we ask
  // her mind as she would ask herself, then her dread of this particular thing.
  lyraJoins(b) {
    const g = this.game;
    const l = g.companion;
    if (!l || l.removed || l.downed || !alive(l) || lyraDead(g)) return 'absent';
    const a = b.arena;
    if (Math.hypot(l.x - a.x, l.y - a.y) > a.r + 170) return 'absent';
    if (g.flags?.lyra_gone) return 'absent';
    const mind = l.mind;
    const state = mind?.companionship || 'together';
    if (state !== 'together' && state !== 'wary') return 'absent';
    let ok = true;
    let v = null;
    try {
      v = mind?.evaluateRequest?.({ action: 'guard', args: { target: 'player' }, source: 'self', preview: true }) || null;
    } catch {
      v = null;
    }
    if (v && v.decision && v.decision !== 'accept' && v.decision !== 'accept_conditional') ok = false;
    const dread = b.info.lyraDread || 0;
    if (ok && dread > 0 && v && Number.isFinite(v.risk) && v.risk > 0.72 - dread) ok = false;
    if (ok && l.hp < l.maxHp * 0.3) ok = false;
    const id = b.bossId;
    if (ok) {
      try {
        g.actions?.run?.('attack', { target: b.id }, 'self');
      } catch {
        /* her own fighting finds it anyway */
      }
      this.lyraSay(LYRA_BOSS_LINES.join[id], 0.6);
      return 'joined';
    }
    try {
      g.actions?.run?.('stay', {}, 'self');
    } catch {
      /* she holds back on her own */
    }
    this.lyraSay(LYRA_BOSS_LINES.decline[id], 0.4);
    g.bus?.emit?.('boss_lyra_declined', { id, verdict: v });
    return 'declined';
  }

  releaseLyra(A) {
    if (!A || A.lyra !== 'declined') return;
    const g = this.game;
    const h = holderOf(g);
    if (h && h.id !== 'lyra') {
      h.duty?.request?.('follow');
      return;
    }
    try {
      g.actions?.run?.('follow', { target: 'player' }, 'self');
    } catch {
      /* she finds her own way back */
    }
  }

  lyraSay(text, delay = 0) {
    if (!text) return;
    const g = this.game;
    const say = () => {
      const l = g.companion;
      if (!l || l.removed || l.downed) return;
      try {
        if (l.mind?.say) l.mind.say(text, { target: g.player });
        else g.bubbles?.say?.(l, text, { kind: 'say' });
      } catch {
        /* she said nothing */
      }
    };
    if (delay > 0) this.later(delay, say);
    else say();
  }

  // ------------------------------------------------------------ saving

  serialize() {
    return { ...this.data };
  }
}
