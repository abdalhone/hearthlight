// The story director: owns the cutscene player and the scene triggers, plays the prologue
// on a new game, keeps what the player has seen and learned (saved in game.flags.story),
// and tells Lyra's mind what happened. game.story is this object.
//
//   story.playPrologue({ world })   world: true on New Game (ends in play in the Wayhouse)
//   story.play(id, opts)            any script in SCRIPTS; resolves { skipped }
//   story.seen(id) / story.isPlaying() / story.unlock(ids) / story.unlocked()
//   story.autoScenes                false under automation (navigator.webdriver) so scripted
//                                   tests are never interrupted; set true to test scenes

import { CutscenePlayer } from './cutscene.js';
import { SCRIPTS } from './scripts.js';
import { SCENES, SceneTriggers, lyraState } from './triggers.js';
import { PROLOGUE_UNLOCKS, unlocksForEvent } from './codex_data.js';

const DEFAULT_DATA = () => ({ seen: {}, codex: {}, declined: {} });

export class StoryDirector {
  constructor(game) {
    this.game = game;
    this.player = new CutscenePlayer(game);
    this.triggers = new SceneTriggers(this);
    this._auto = null;
    this.prevState = null;
    const bus = game.bus;
    bus?.on?.('game_start', ({ loaded }) => {
      if (!loaded) return;
      // An older save knows the basics already: the prologue is how the game begins.
      if (!this.seen('prologue')) this.unlock(PROLOGUE_UNLOCKS);
    });
    // Meeting people and visiting places opens pages of the Book of Halcyre.
    bus?.on?.('*', (type, p) => {
      if (this.game.state !== 'playing' && this.game.state !== 'cutscene') return;
      let ids = null;
      try {
        ids = unlocksForEvent(type, p, this.game);
      } catch {
        ids = null;
      }
      if (ids && ids.length) this.unlock(ids);
    });
  }

  get autoScenes() {
    if (this._auto != null) return this._auto;
    try {
      return !(typeof navigator !== 'undefined' && navigator.webdriver);
    } catch {
      return true;
    }
  }

  set autoScenes(v) {
    this._auto = v == null ? null : !!v;
  }

  // Saved with the game (flags are serialized as they are).
  get data() {
    const g = this.game;
    if (!g.flags) g.flags = {};
    let d = g.flags.story;
    if (!d || typeof d !== 'object') d = g.flags.story = DEFAULT_DATA();
    if (!d.seen) d.seen = {};
    if (!d.codex) d.codex = {};
    if (!d.declined) d.declined = {};
    return d;
  }

  seen(id) {
    return !!this.data.seen[id];
  }

  markSeen(id) {
    this.data.seen[id] = { day: this.game.clock?.day ?? 1 };
  }

  unlock(ids) {
    const d = this.data.codex;
    const fresh = [];
    for (const id of [].concat(ids || [])) {
      if (!id || d[id]) continue;
      d[id] = this.game.clock?.day ?? 1;
      fresh.push(id);
    }
    if (fresh.length) this.game.bus?.emit?.('codex_unlocked', { ids: fresh });
    return fresh;
  }

  isUnlocked(id) {
    return !!this.data.codex[id];
  }

  unlocked() {
    return Object.keys(this.data.codex);
  }

  isPlaying() {
    return this.player.isPlaying();
  }

  // ------------------------------------------------------------------ playing

  // Conditions a step may carry (`when`).
  when(cond) {
    const g = this.game;
    if (cond === 'lyra_near') return lyraState(g).near && !g.flags?.lyra_gone && (g.companion?.mind?.companionship || 'together') !== 'left';
    const m = /^npc_near:(.+)$/.exec(cond);
    if (m) {
      const e = g.entities?.get?.(m[1]);
      return !!e && !!g.player && Math.hypot(e.x - g.player.x, e.y - g.player.y) <= 120;
    }
    return true;
  }

  async play(id, opts = {}) {
    const script = SCRIPTS[id];
    if (!script || this.isPlaying()) return { skipped: true };
    const g = this.game;
    const inPlay = g.state === 'playing' && !!g.map;
    const sc = opts.scene || SCENES.find((s) => s.id === id) || null;
    if (inPlay) {
      this.prevState = 'playing';
      g.state = 'cutscene';
      try {
        g.ui?.chat?.close?.();
        g.ui?.closeAll?.();
      } catch {
        /* the UI may not be up yet */
      }
    }
    // Mark it seen before it plays: a reload mid-scene must not loop it.
    if (opts.record !== false && id !== 'prologue') this.markSeen(id);
    const result = await this.player.play(script, {
      world: inPlay && opts.world !== false,
      when: (c) => this.when(c),
      calls: opts.calls || {},
      onWorldBegin: opts.onWorldBegin,
      onEnd: async (r) => {
        await opts.onEnd?.(r);
        if (inPlay) {
          g.state = 'playing';
          g.camera?.follow?.(g.player);
          g.camera?.snap?.();
        }
      },
    });
    if (opts.record !== false && sc) this.afterScene(sc, result);
    return result;
  }

  // What a scene leaves behind: Lyra's memory of it, and the pages it opens.
  afterScene(sc, result) {
    const g = this.game;
    if (sc.unlock) this.unlock(sc.unlock);
    const mind = g.companion?.mind;
    if (!mind || !sc.memory) return;
    if (sc.memory.onlyIfNear && !lyraState(g).near) return;
    try {
      // A secret she has now told is told: the mind should not tell it again later.
      if (sc.secret && Array.isArray(mind.soul?.secrets) && typeof mind.revealSecret === 'function') {
        const i = mind.soul.secrets.findIndex((s) => s && sc.secret.test(String(s.text || '')));
        if (i >= 0 && !mind.secretsRevealed?.includes(i)) {
          mind.revealSecret(i, { speak: false });
          return;
        }
      }
      mind.remember(sc.memory.text, { importance: sc.memory.importance ?? 5, about: sc.memory.about || ['player'], tags: ['story', sc.id], emotion: sc.memory.emotion, type: 'event' });
    } catch (err) {
      console.warn('[story] could not record the scene in her memory', err);
    }
    void result;
  }

  // The prologue. On New Game it ends in play: the Wayhouse, morning, Lyra by the bed.
  // From the title screen or the menu it plays as a story and leaves the world untouched.
  async playPrologue({ world = false } = {}) {
    const g = this.game;
    const calls = {
      wake: () => this.setWakeScene(),
    };
    const r = await this.play('prologue', { world, calls, record: false });
    this.markSeen('prologue');
    this.unlock(PROLOGUE_UNLOCKS);
    if (world && g.map) {
      // Whatever happened (watched or skipped), the game begins where the story ends.
      this.setWakeScene();
      g.camera?.follow?.(g.player);
      g.camera?.snap?.();
      try {
        g.save.pending = 'auto';
      } catch {
        /* saving is optional */
      }
    }
    return r;
  }

  // The player just up beside their bed in the Wayhouse, Lyra a step away, at morning.
  setWakeScene() {
    const g = this.game;
    const p = g.player;
    const l = g.companion;
    const bed = g.objects?.get?.('home_bed');
    if (!p || !bed) return;
    const spot = bed.sleepSpot || { x: bed.x + 16, y: bed.y };
    const free = (x, y) => {
      try {
        return !g.isBlockedTile(Math.floor(x / 16), Math.floor(y / 16), p);
      } catch {
        return true;
      }
    };
    let px = spot.x;
    let py = spot.y + 4;
    if (!free(px, py)) {
      for (const [dx, dy] of [[0, 16], [16, 0], [16, 16], [-16, 16], [0, 32]]) {
        if (free(spot.x + dx, spot.y + dy)) {
          px = spot.x + dx;
          py = spot.y + dy;
          break;
        }
      }
    }
    p.x = px;
    p.y = py;
    p.faceDir?.('down');
    p.setState?.('idle');
    if (l) {
      // A couple of steps away, out of reach of a careless sword arm.
      let lx = px + 34;
      let ly = py + 10;
      for (const [dx, dy] of [[34, 10], [32, 22], [20, 30], [40, 0]]) {
        if (free(px + dx, py + dy)) {
          lx = px + dx;
          ly = py + dy;
          break;
        }
      }
      l.x = lx;
      l.y = ly;
      l.faceToward?.(p.x, p.y);
      l.setState?.('idle');
    }
    if ((g.clock?.hour ?? 8) > 10 || (g.clock?.hour ?? 8) < 6) g.clock?.skipTo?.(8);
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    this.player.update(dt);
    if (!this.isPlaying()) this.triggers.update(dt);
  }

  render() {
    this.player.render();
  }

  coversScreen() {
    return this.player.coversScreen();
  }
}
