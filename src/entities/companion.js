import { Actor } from './entity.js';
import { FACTION, COMPANION_ID, TILE } from '../core/constants.js';
import { Mind } from '../ai/mind/mind.js';
import { Behavior } from '../ai/behavior/behavior.js';
import { say } from '../ai/behavior/lines.js';
import { RAMPS } from '../art/palette.js';

// Lyra: arcane ranger, traveling with the player by her own choice. Her Behavior is
// her controller and her Mind holds who she is. She never dies: at 0 HP she is
// downed until the player helps her up (interact) or, after a minute, she gets up
// alone. She never leaves the world: Hearthvale is her home, and even when she cuts
// the player out of her life she lives on in the village (DESIGN §19.7).

const ARCANE_GLOW = RAMPS.arcane[4];
export const AUTO_REVIVE_SECONDS = 60;
export const SELF_REVIVE_HP = 0.15;
export const PLAYER_REVIVE_HP = 0.4;
// How much each price weighs on her (DESIGN §25: "berserk frightens her").
const PRICE_WEIGHT = {
  berserk: { importance: 8, emotion: 'fear', feel: 0.6, rel: { fear: 8, trust: -3 } },
  bloodprice: { importance: 5, emotion: 'fear', feel: 0.25, rel: { fear: 2 } },
  emberblood: { importance: 5, emotion: 'fear', feel: 0.3, rel: { fear: 2 } },
  glass: { importance: 4, emotion: 'fear', feel: 0.15, rel: null },
  overdraw: { importance: 4, emotion: 'fear', feel: 0.1, rel: null },
  lastlight: { importance: 5, emotion: 'sadness', feel: 0.2, rel: null },
  oath: { importance: 7, emotion: 'surprise', feel: 0.4, rel: { affinity: 3, fear: 1 } },
  default: { importance: 4, emotion: 'fear', feel: 0.15, rel: null },
};

export class Companion extends Actor {
  constructor(game, o = {}) {
    super(game, {
      id: COMPANION_ID,
      name: game.settings?.companionName || 'Lyra',
      kind: 'human',
      faction: FACTION.PLAYER,
      maxHp: 50,
      atk: 7,
      def: 1,
      speed: 80,
      spriteKey: 'lyra',
      perceptionRadius: 180,
      ...o,
    });
    this.role = 'companion';
    this.leftWorld = false; // never true now (DESIGN §19.7); kept for old saves
    this.fade = 1; // 1 = solid
    this.downedFor = 0;
    this.wasDowned = false;
    this.mindErrAt = -99;
    // One light object reused every frame (the renderer collects lights per frame).
    this.glow = { x: 0, y: 0, r: 34, color: ARCANE_GLOW, intensity: 0 };
    this.mind = null;
    try {
      this.mind = new Mind(game, this);
    } catch (err) {
      console.error('[companion] mind failed to start', err);
    }
    this.behavior = new Behavior(game, this);
    this.controller = this.behavior;
    game.bus?.on?.('settings_changed', (p) => {
      if (p?.key === 'companionName' && p.value) this.name = String(p.value).slice(0, 24);
    });
    // Prices (DESIGN §25): she sees what the stranger pays, says so, remembers it, and
    // weighs it. Berserk frightens her.
    game.bus?.on?.('price_paid', (p) => {
      if (p?.first && p.caster === game.player) this.noticePrice(p.price);
    });
    // However she gets back up (the player's hand, combat's minute, her own), she says so.
    game.bus?.on?.('revived', (p) => {
      if (p?.entity !== this || this.leftWorld) return;
      const byPlayer = !!p.by && p.by === game.player;
      this.behavior.say(say.revived(byPlayer), { force: true });
      if (byPlayer) this.faceToward(p.by.x, p.by.y);
    });
  }

  noticePrice(id) {
    const g = this.game;
    const P = g.player;
    const d = g.magic?.registry?.prices?.get?.(id);
    if (!d || !P || this.downed || this.leftWorld) return;
    const near = Math.hypot(P.x - this.x, P.y - this.y) < 220;
    const weight = PRICE_WEIGHT[id] || PRICE_WEIGHT.default;
    const mind = this.mind;
    try {
      if (near) this.behavior.say(d.lyra, { force: true });
      mind?.remember?.(near ? `I watched the stranger weave ${d.name.toLowerCase()} into a spell and pay for it: ${d.costText}.` : `I heard the stranger has been paying for their weaves with ${d.name.toLowerCase()}.`, {
        importance: weight.importance,
        about: ['player'],
        tags: ['price', id, 'weave'],
        emotion: weight.emotion,
        type: 'event',
      });
      if (near) mind?.feel?.(weight.emotion, weight.feel, `the stranger's ${d.name.toLowerCase()}`);
      if (weight.rel) mind?.autonomy?.adjustPlayer?.(weight.rel, `price:${id}`);
    } catch (err) {
      console.warn('[companion] price notice failed', err);
    }
  }

  // Nothing removes Lyra but her own leaving: a stray removal is ignored and a kill
  // becomes a knockout.
  get removed() {
    return !!this._removed;
  }

  set removed(v) {
    this._removed = !!v && !!this.leftWorld;
  }

  // Hearthvale is her home (DESIGN §19.7): nothing walks her off the map. A caller that
  // still asks gets her home instead.
  leaveWorld() {
    this.comeHome();
  }

  // Back home: with her parents at the chandlery, or her room at the Ember Kettle.
  comeHome() {
    this.leftWorld = false;
    this.fade = 1;
    this._removed = false;
    const locs = this.game.locations;
    const home = locs?.get?.('chandlery') || locs?.get?.('ember_kettle') || null;
    const c = home?.center;
    if (!c) return;
    const blocked = (x, y) => !!this.game.isBlockedTile?.(Math.floor(x / TILE), Math.floor(y / TILE), this);
    let x = c.x;
    let y = c.y;
    for (let r = 1; r <= 4 && blocked(x, y); r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        if (!blocked(c.x + dx * TILE, c.y + dy * TILE)) {
          x = c.x + dx * TILE;
          y = c.y + dy * TILE;
          break;
        }
      }
    }
    this.x = x;
    this.y = y;
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
  }

  update(dt) {
    if (this.leftWorld) return;
    if (this.dead) this.knockOut();
    // Frozen or stunned by a weave (DESIGN §22.1): her behavior holds until it wears off.
    const ctl = this.controller;
    if (this.statusFlags?.disabled) this.controller = null;
    try {
      super.update(dt);
    } finally {
      this.controller = ctl;
    }
    if (this.downed) this.updateDowned(dt);
    else if (this.wasDowned) {
      this.wasDowned = false;
      this.downedFor = 0;
      this.behavior.onRevived();
    }
    if (this.mind) {
      try {
        this.mind.update(dt);
      } catch (err) {
        if (this.age - this.mindErrAt > 5) {
          this.mindErrAt = this.age;
          console.error('[companion] mind update failed', err);
        }
      }
    }
  }

  knockOut() {
    this.dead = false;
    this.hp = 0;
    if (!this.downed) {
      this.downed = true;
      this.game.bus?.emit?.('downed', { entity: this, by: this.lastAttacker || null });
    }
  }

  updateDowned(dt) {
    if (!this.wasDowned) {
      this.wasDowned = true;
      this.downedFor = 0;
      this.behavior.onDowned();
      const p = this.game.player;
      if (p && Math.hypot(p.x - this.x, p.y - this.y) < 320) this.behavior.say(say.downed(!!p && (this.lastAttacker === p || !!this.mind?.autonomy?.downed?.byPlayer)), { force: true, kind: 'whisper' });
    }
    if (this.state !== 'downed') this.setState('downed');
    this.moveIntent.x = 0;
    this.moveIntent.y = 0;
    this.downedFor += dt;
    // With game.survival (§27) she lies with her own window until someone revives or
    // carries her; otherwise she gets up alone after a minute.
    if (this.downedFor >= AUTO_REVIVE_SECONDS && !this.game.survival?.owns?.(this)) this.reviveBy(this, SELF_REVIVE_HP);
  }

  // Revive through combat (its effects and event); fall back to doing it here.
  reviveBy(by, fraction) {
    const c = this.game.combat;
    if (c && typeof c.revive === 'function') {
      try {
        c.revive(this, by, fraction);
      } catch (err) {
        console.error('[companion] combat.revive failed', err);
      }
    }
    if (this.downed) {
      this.downed = false;
      this.dead = false;
      this.hp = Math.max(1, Math.round(this.maxHp * fraction));
      this.invuln = 1.5;
      this.setState('idle');
      this.game.bus?.emit?.('revived', { entity: this, by });
    }
    this.wasDowned = false;
    this.downedFor = 0;
    this.behavior.onRevived(by);
  }

  canInteract(actor) {
    return !!actor && actor === this.game.player && !this.leftWorld && !this.carriedBy;
  }

  interactLabel(actor) {
    if (this.downed) return this.game.survival?.downedLabel?.(this, actor) || `Help ${this.name} up`;
    return `Talk to ${this.name}`;
  }

  interact(actor) {
    if (this.downed) {
      // A potion, or her weight on your shoulders (§27); the old free hand up without it.
      if (this.game.survival) {
        this.game.survival.interactDowned?.(this, actor);
        return;
      }
      this.reviveBy(actor, PLAYER_REVIVE_HP);
      return;
    }
    if (actor) this.faceToward(actor.x, actor.y);
    this.game.ui?.chat?.open?.();
  }

  draw(ctx, ox, oy, time) {
    if (this.leftWorld) return;
    if (this.fade >= 1) {
      super.draw(ctx, ox, oy, time);
      return;
    }
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * Math.max(0, this.fade);
    super.draw(ctx, ox, oy, time);
    ctx.globalAlpha = a;
  }

  // A soft violet glow that grows with the dark; dim while she is down.
  getLight(time) {
    const dark = 1 - (this.game.clock?.daylight ?? 1);
    if (dark < 0.12 || this.dead || this.leftWorld) return null;
    const g = this.glow;
    const pulse = 0.92 + 0.08 * Math.sin(time * 2.3);
    g.x = this.x;
    g.y = this.y - (this.downed ? 4 : 10);
    g.r = (this.downed ? 20 : 34) + 3 * Math.sin(time * 1.7);
    g.intensity = dark * (this.downed ? 0.22 : 0.5) * pulse * Math.max(0, Math.min(1, this.fade));
    return g;
  }

  serialize() {
    let mind = null;
    try {
      mind = this.mind?.serialize?.() ?? null;
    } catch (err) {
      console.error('[companion] mind serialize failed', err);
    }
    return { ...super.serialize(), mind, behavior: this.behavior.serialize(), downedFor: this.downed ? Math.round(this.downedFor) : 0, leftWorld: this.leftWorld || undefined };
  }

  deserialize(d) {
    if (!d) return;
    super.deserialize(d);
    if (d.mind && this.mind) {
      try {
        this.mind.deserialize(d.mind);
      } catch (err) {
        console.error('[companion] mind deserialize failed', err);
      }
    }
    if (d.behavior) this.behavior.deserialize(d.behavior);
    if (d.leftWorld) {
      // A save from before she could not leave (DESIGN §19.7): she is home again.
      this.comeHome();
    }
    if (this.downed) {
      this.hp = 0;
      this.setState('downed');
      this.wasDowned = true;
      this.downedFor = Math.min(AUTO_REVIVE_SECONDS - 5, d.downedFor || 0);
    }
  }
}
