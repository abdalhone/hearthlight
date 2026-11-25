import { Stats } from '../core/stats.js';
import { Progression } from './progression.js';
import { Gear, stockShops } from '../gear/gear.js';
import { PriceRuntime } from '../magic/prices.js';
import { NPC_PROFILES } from '../entities/npc_data.js';
import { dropGlyphShard, grantGlyph } from '../bosses/shard.js';
import { applyGearLook } from '../gear/looks.js';

// Prices the bosses carry (DESIGN §25: "earned like other components"): a glyph-shard
// of each lies where the boss fell, beside its own.
export const BOSS_PRICES = Object.freeze({ varek: 'berserk', greyjaw: 'bloodprice', lakes_hum: 'glass', bone_warden: 'overdraw' });

// One call wires DESIGN §25–26 into a game: the stat pipeline (game.stats), levels and
// points (game.progression), equipment and the forge (game.gear) and the prices'
// runtime (game.prices); stocks the shops; lets the pipeline fold in survival's
// weaknesses (§27) and the oath's tie to Lyra; manages the player's and Lyra's numbers
// from the moment they join the world. game.js calls it once, steps
// game.stats/game.prices, and saves through saveProgression/loadProgression.

export function installProgression(game) {
  if (game.stats && game.progression) return game.progression;
  const S = (game.stats = game.stats || new Stats(game));
  game.progression = new Progression(game);
  game.gear = new Gear(game);
  game.prices = new PriceRuntime(game);
  S.addProvider('survival', (a) => survivalModifiers(game, a));
  S.addProvider('prices', (a) => game.prices?.provide?.(a) || null);
  S.foldsSurvival = true; // survival.mul defers to the pipeline: weakness is folded once
  stockShops(NPC_PROFILES);
  const bus = game.bus;
  try {
    bus?.on?.('entity_added', (p) => {
      const e = p?.entity;
      if (!e || e.type !== 'actor') return;
      if (e === game.player || e.id === 'player' || e === game.companion || e.id === 'lyra') manageAtLevelOne(S, e);
    });
    bus?.on?.('game_start', () => {
      const P = game.player;
      if (P && !S.isManaged(P)) manageAtLevelOne(S, P);
      if (game.companion && !S.isManaged(game.companion)) manageAtLevelOne(S, game.companion);
      S.refresh(P);
      S.refresh(game.companion);
      try {
        game.magic?._recomputeMax?.(0, false);
      } catch {
        /* magic is optional */
      }
    });
    // Mission rewards this module understands: { price: id }, { unlock: { kind, id } },
    // { points: n } (the mission system emits every reward it grants).
    bus?.on?.('mission_reward', (p) => grantExtra(game, p?.reward, p?.mission));
    bus?.on?.('boss_defeated', (p) => dropBossPrice(game, p));
    // What is worn shows on the sprite (painted once per combination, off the hot path).
    const look = () => {
      try {
        applyGearLook(game);
      } catch (err) {
        console.warn('[gear] look failed', err);
      }
    };
    bus?.on?.('gear_changed', look);
    bus?.on?.('game_start', look);
    bus?.on?.('glyph_shard', (p) => {
      if (p?.kind === 'price' && p.boss && game.flags) game.flags[`price_shard_${p.boss}`] = 'taken';
    });
    // A shard left on the ground when the game was saved is not lost: it comes to you.
    bus?.on?.('game_start', (p) => {
      if (!p?.loaded || !game.flags) return;
      for (const [boss, id] of Object.entries(BOSS_PRICES)) {
        if (game.flags[`price_shard_${boss}`] !== 'dropped') continue;
        game.flags[`price_shard_${boss}`] = 'taken';
        grantGlyph(game, 'price', id, `boss:${boss}`);
      }
    });
    bus?.on?.('magic_unlocked', (p) => {
      if (p?.kind !== 'price' || p.source === 'dev' || p.source === 'trial') return;
      // A boss's glyph-shard shows its own reveal card (gain, price, where to weave it):
      // a toast beside it would say it twice and cover it on a phone.
      if (String(p.source || '').startsWith('boss:')) return;
      const d = game.magic?.registry?.prices?.get?.(p.id);
      if (!d) return;
      try {
        const book = game.ui?.isTouch ? 'Menu → Spellbook' : 'the Spellbook (B)';
        game.ui?.toast?.(`A price: ${d.name}. ${cap(d.gainText)} — and ${d.costText}. Attach it to a weave in ${book}.`, 'warn', { key: `price:${p.id}`, title: 'Power with a cost' });
      } catch {
        /* the UI is optional */
      }
    });
  } catch {
    /* the bus is optional in tests */
  }
  return game.progression;
}

// An actor's own numbers as built are its level-1 base (levels and points come on top).
function manageAtLevelOne(S, e) {
  if (S.isManaged(e)) return;
  const lv = Math.max(1, e.level || 1);
  const base = { maxHp: e.maxHp, atk: Number.isFinite(e.baseAtk) ? e.baseAtk : e.atk, def: e.def, speed: e.speed };
  if (lv > 1) {
    // Joined already grown (a test, a late install): take the old level growth back out.
    base.maxHp = Math.max(1, base.maxHp - (lv - 1) * 8);
    if (!Number.isFinite(e.baseAtk)) base.atk = Math.max(1, base.atk - (lv - 1));
  }
  S.manage(e, base);
}

// Survival's weaknesses (bruised, mending, flame-thin) as live pipeline modifiers.
export function survivalModifiers(game, a) {
  const sv = game.survival;
  if (!sv || typeof sv.modifiers !== 'function') return null;
  const list = sv.modifiers(a);
  if (!Array.isArray(list) || !list.length) return null;
  const now = typeof sv.now === 'function' ? sv.now() : game.clock?.t ?? 0;
  return list.map((m) => ({
    id: m.source,
    source: m.source,
    label: m.label,
    kind: 'weak',
    mul: m.mul,
    t: Number.isFinite(m.until) ? Math.max(0, m.until - now) : null,
    total: Number.isFinite(m.seconds) ? m.seconds : null,
    color: '#c9b8a0',
    icon: 'weak',
  }));
}

function cap(t) {
  const s = String(t || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dropBossPrice(game, p) {
  const boss = p?.id;
  const id = BOSS_PRICES[boss];
  if (!id || !game.flags || game.flags[`price_shard_${boss}`]) return;
  // (While "Try all magic" runs every price is open: the real set says if it is earned.)
  const known = game.magic?.realUnlocked || game.magic?.unlocked;
  if (known?.prices?.has?.(id)) return;
  const b = p.boss;
  const x = Number.isFinite(b?.x) ? b.x : game.player?.x ?? 0;
  const y = Number.isFinite(b?.y) ? b.y : game.player?.y ?? 0;
  game.flags[`price_shard_${boss}`] = 'dropped';
  try {
    if (game.entities?.add) dropGlyphShard(game, 'price', id, x, y + 18, { source: `boss:${boss}`, boss, rise: true, vx: 0, vy: 18 });
    else grantGlyph(game, 'price', id, `boss:${boss}`);
  } catch {
    game.flags[`price_shard_${boss}`] = 'taken';
    game.magic?.unlock?.('price', id, `boss:${boss}`);
  }
}

function grantExtra(game, r, mission) {
  if (!r || typeof r !== 'object') return;
  const source = mission?.id ? `mission:${mission.id}` : 'mission';
  if (typeof r.price === 'string') game.magic?.unlock?.('price', r.price, source);
  if (r.unlock?.kind && r.unlock?.id) game.magic?.unlock?.(r.unlock.kind, r.unlock.id, source);
  if (Number.isFinite(r.points) && r.points > 0 && game.progression) {
    game.progression.bonus += Math.floor(r.points);
    game.progression.changed();
  }
}

export function saveProgression(game) {
  const P = game.player;
  return {
    v: 1,
    progression: game.progression?.serialize?.() ?? null,
    gear: game.gear?.serialize?.() ?? null,
    prices: game.prices?.serialize?.() ?? null,
    mods: P && game.stats ? game.stats.serializeMods(P) : [],
  };
}

export function loadProgression(game, d) {
  const data = d && typeof d === 'object' ? d : {};
  game.gear?.deserialize?.(data.gear || null);
  game.progression?.deserialize?.(data.progression || null);
  game.prices?.deserialize?.(data.prices || null);
  if (game.player && game.stats) game.stats.deserializeMods(game.player, data.mods || []);
  game.stats?.refresh(game.player);
  game.stats?.refresh(game.companion);
}
