// Story scenes in play (DESIGN §20): each scene waits for its place, its people and the
// right moment, checks Lyra's state (together with the player, not afraid, not fighting,
// and trusting enough for what she would tell), plays once, is remembered by her mind,
// and is saved as seen. Lyra may decline the hardest one on a given day.

import { MISSION_SCENES } from './scripts_missions.js';

export const SCENES = [
  {
    id: 'meet_ambrels',
    needs: ['hobb', 'wenna'],
    lyra: 'optional',
    check: (c) => c.near('wenna', 46) && c.near('hobb', 90),
    memory: { text: 'The stranger met Mam and Da. Mam read their face with her hands; Da told them about the lamp by their door. They will do.', importance: 6, about: ['player', 'wenna', 'hobb'], emotion: 'joy' },
    unlock: ['hobb', 'wenna', 'the_ambrels', 'p_chandlery'],
  },
  {
    id: 'chapel_candles',
    lyra: 'optional',
    check: (c) => c.inPlace('chapel'),
    memory: { text: 'The chapel flames leaned toward the stranger again, every one of them. Sister Aveline says they did it every night of the long sleep.', importance: 5, about: ['player', 'aveline'], emotion: 'surprise', onlyIfNear: true },
    unlock: ['hearth_faith', 'kept_flame', 'p_chapel', 'aveline'],
  },
  {
    id: 'night_of_lamps',
    lyra: 'required',
    minTrust: 45,
    check: (c) => c.hourIn(17.5, 23.5) && c.inVillage() && c.calm(),
    memory: { text: 'I told the stranger about the night of the lamps: Da on the ice, every lamp on the square in violet, Maren in her nightgown.', importance: 6, about: ['player', 'hobb', 'maren'], emotion: 'joy' },
    unlock: ['night_of_lamps', 'lumencraft', 'lyra_workings', 'maren'],
  },
  {
    id: 'weeping_cut',
    lyra: 'required',
    minTrust: 65,
    minBond: 3,
    mayDecline: true,
    check: (c) => c.inPlace('stonecut_quarry') && c.calm(),
    secret: /weeping cut|bryn/i,
    memory: { text: "I told the stranger about the Weeping Cut. About Davin, and Bryn's leg, and what Maren said after.", importance: 9, about: ['player', 'bryn', 'davin', 'maren'], emotion: 'grief' },
    unlock: ['weeping_cut', 'the_cut', 'dungeons', 'delving', 'bryn', 'davin'],
    decline: ['Not today. Ask me another time.', "Some other day. It's not a story for a quarry in the wind."],
  },
  {
    id: 'maren_aveline',
    needs: ['aveline'],
    lyra: 'required',
    minTrust: 30,
    after: ['chapel_candles'],
    check: (c) => c.near('aveline', 52),
    memory: { text: 'Sister Aveline told the stranger how Maren walked toward the ruins at midsummer: the cloak, the lantern, the rope, the raised hand.', importance: 6, about: ['player', 'aveline', 'maren'], emotion: 'grief' },
    unlock: ['maren_goes_in', 'maren_preparations', 'p_sunken_ruins', 'maren'],
  },
  {
    id: 'maren_gate',
    lyra: 'required',
    minTrust: 30,
    check: (c) => c.nearObject('ruins_gate', 84),
    memory: { text: "I showed the stranger the ruins gate and told them why I won't go over the wall again without the key.", importance: 6, about: ['player', 'maren'], emotion: 'fear' },
    unlock: ['p_sunken_ruins', 'stolen_key', 'ruins_fine', 'varek_band'],
  },
  {
    id: 'maren_journal',
    lyra: 'required',
    check: (c) => !!c.game.flags?.journal_read && c.calm(),
    memory: { text: "Maren's journal: 'If someone comes out, I hope whoever it is is kind.' Someone did come out. I told the stranger they had better be kind.", importance: 8, about: ['player', 'maren'], emotion: 'grief' },
    unlock: ['maren_journal', 'other_end', 'waygates'],
  },
];

// The Weave's scenes (DESIGN §22.3): the first time Lyra sees the stranger weave, and more.
SCENES.push(...MISSION_SCENES);

const CHECK_EVERY = 0.5;

function dist(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
}

// What a scene's check can ask about the world.
export function sceneContext(game) {
  const p = game.player;
  const c = {
    game,
    near(id, r) {
      const e = game.entities?.get?.(id);
      return !!e && !e.removed && !e.dead && dist(e, p) <= r;
    },
    nearObject(id, r) {
      const o = game.objects?.get?.(id);
      return !!o && dist(o, p) <= r;
    },
    inPlace(id) {
      // Inside that place's bounds (so a room or a corner of it counts too).
      const loc = game.locations?.get?.(id);
      const b = loc?.bounds;
      if (!b || !p) return false;
      const tx = p.x / 16;
      const ty = p.y / 16;
      return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
    },
    inVillage() {
      return ['hearthvale', 'town_square', 'lamplight_lane', 'chandlery', 'ember_kettle', 'player_home'].some((id) => c.inPlace(id));
    },
    hourIn(a, b) {
      const h = game.clock?.hour ?? 12;
      return h >= a && h <= b;
    },
    calm() {
      const mind = game.companion?.mind;
      try {
        if (mind?.activity?.().combat) return false;
        if ((mind?.perception?.threats ?? 0) > 0) return false;
      } catch {
        /* a mind that cannot say is calm enough */
      }
      return !(p?.hp < (p?.maxHp || 1) * 0.35);
    },
  };
  return c;
}

// Lyra's side of it: is she with the player, unafraid, not fighting, and does she trust
// them enough for this scene? Returns { ok, near, reason }.
export function lyraState(game, { minTrust = 0, minBond = 0 } = {}) {
  const l = game.companion;
  const p = game.player;
  if (!l || l.removed || l.downed || !p) return { ok: false, near: false, reason: 'absent' };
  const near = dist(l, p) <= 96;
  const mind = l.mind;
  let state = 'together';
  let trust = 50;
  let fear = 0;
  let tone = 'warm';
  let bond = 3;
  try {
    state = mind?.companionship || 'together';
    const s = mind?.autonomy?.stats?.();
    if (s) {
      trust = s.trust;
      fear = s.fear;
    }
    tone = mind?.autonomy?.tone?.() || 'warm';
    bond = mind?.relationships?.bond?.('player')?.level ?? bond;
  } catch {
    /* defaults */
  }
  if (game.flags?.lyra_gone) state = 'gone';
  if (state !== 'together') return { ok: false, near, reason: state };
  if (fear >= 35 || tone === 'afraid') return { ok: false, near, reason: 'afraid' };
  if (trust < minTrust || bond < minBond) return { ok: false, near, reason: 'trust' };
  if (!near) return { ok: false, near, reason: 'far' };
  return { ok: true, near, reason: '' };
}

export class SceneTriggers {
  constructor(director) {
    this.director = director;
    this.game = director.game;
    this.timer = 1.5;
    this.busy = false;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0 || this.busy) return;
    this.timer = CHECK_EVERY;
    const g = this.game;
    if (g.state !== 'playing' || g.paused || !g.player || g.player.downed) return;
    if (!this.director.autoScenes) return;
    if (g.ui?.isModalOpen?.() || g.ui?.chat?.isOpen?.()) return;
    const scene = this.ready();
    if (scene) this.fire(scene);
  }

  // The first scene whose moment has come, or null.
  ready() {
    const g = this.game;
    const d = this.director;
    const ctx = sceneContext(g);
    for (const sc of SCENES) {
      if (d.seen(sc.id)) continue;
      if (sc.needs && sc.needs.some((id) => !g.entities?.get?.(id))) continue;
      if (sc.after && sc.after.some((id) => !d.seen(id))) continue;
      const declined = d.data.declined?.[sc.id];
      if (declined != null && declined === (g.clock?.day ?? 1)) continue;
      let ok = false;
      try {
        ok = !!sc.check(ctx);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      if (sc.lyra === 'required' && !lyraState(g, sc).ok) continue;
      return sc;
    }
    return null;
  }

  async fire(sc) {
    const g = this.game;
    const d = this.director;
    if (sc.mayDecline && this.wouldDecline(sc)) {
      d.data.declined = d.data.declined || {};
      d.data.declined[sc.id] = g.clock?.day ?? 1;
      const line = sc.decline?.[Math.floor(Math.random() * sc.decline.length)] || 'Not today.';
      try {
        g.companion?.mind?.say?.(line, { target: g.player });
      } catch {
        /* she said nothing */
      }
      return;
    }
    this.busy = true;
    try {
      await d.play(sc.id, { scene: sc });
    } finally {
      this.busy = false;
    }
  }

  // She can say no: once on a day when her mood is low, or at random the first time.
  wouldDecline(sc) {
    const g = this.game;
    const mind = g.companion?.mind;
    let low = false;
    try {
      const m = mind?.mood?.();
      const v = typeof m === 'number' ? m : m?.valence ?? m?.value;
      low = Number.isFinite(v) && v < -0.15;
    } catch {
      low = false;
    }
    const firstAsk = !this.director.data.declined?.[sc.id];
    return low || (firstAsk && Math.random() < 0.3);
  }
}
