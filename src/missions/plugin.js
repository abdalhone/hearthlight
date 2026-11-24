// The missions plugin: wires game.missions into the bus, the step, the save and Lyra's
// prompt, and mounts the journal, markers and reward reveals in the browser. The game
// registers it (src/core/game.js); everything else reaches missions through game.missions.

import { MissionSystem, setSpawners } from './system.js';
import { LyraWatch } from './lyra.js';
import { WeaveGossip } from './rumors.js';
import { componentLabel } from './components.js';
import { spawnCreature } from '../entities/monsters.js';
import { dropItem } from '../entities/pickups.js';
import * as VIEW from '../ui/missions_view.js';

// Ensure game.missions (and its two watchers) exist.
export function ensureMissions(game) {
  if (!game) return null;
  if (!(game.missions instanceof MissionSystem)) game.missions = new MissionSystem(game);
  const ms = game.missions;
  if (!ms.lyraWatch) ms.lyraWatch = new LyraWatch(game, ms);
  if (!ms.gossip) ms.gossip = new WeaveGossip(game, ms);
  if (!ms.wovenKill) ms.wovenKill = (c) => ms.gossip.wovenKill(c);
  return ms;
}

export const missionsPlugin = {
  id: 'missions',
  name: 'Missions',
  description: "Errands the village gives the stranger, and the weaves they earn. Lyra notices what the stranger weaves.",

  actions: {
    accept_mission: {
      description: 'The player takes on a mission someone offered (value: the mission id).',
      params: { value: 'mission id' },
      hidden: true,
      ungated: true,
      run(args, ctx) {
        const ms = ctx.game?.missions;
        const id = String(args?.value || args?.target || '');
        const m = ms?.get?.(id);
        if (!m) return { ok: false, message: '' };
        if (ms.status(id) !== 'available') return { ok: true, message: ms.status(id) === 'done' ? "We've done that one." : 'We already are.' };
        ms.accept(id);
        return { ok: true, message: (m.accept || ['Good.'])[0] };
      },
    },
  },

  install(ctx) {
    const g = ctx.game;
    const ms = ensureMissions(g);
    if (!ms) return;
    setSpawners({ foe: spawnCreature, drop: dropItem });
    if (this._pending !== undefined) {
      this.applySave(this._pending, g);
      this._pending = undefined;
    }
    // The journal, markers and reveals live in the page (none under node --test).
    if (typeof document !== 'undefined' && g.uiRoot) {
      try {
        VIEW.mountMissionsUi(g);
      } catch (err) {
        console.warn('[missions] the journal could not mount', err);
      }
    }
  },

  onEvent(type, p, ctx) {
    const ms = ctx.game?.missions;
    if (!ms) return;
    ms.onEvent(type, p);
    ms.lyraWatch?.onEvent(type, p);
    ms.gossip?.onEvent(type, p);
    if (typeof document !== 'undefined') VIEW.onMissionEvent(ctx.game, type, p);
  },

  update(dt, ctx) {
    ctx.game?.missions?.update(dt);
  },

  // What Lyra knows of the errands and the stranger's weaving, for Claude.
  promptContext(ctx) {
    const g = ctx.game;
    const ms = g?.missions;
    if (!ms) return '';
    const lines = [];
    const hud = ms.hudLine();
    if (hud) lines.push(`The stranger's current errand: "${hud.title}" — ${hud.text}.`);
    const active = ms.active().filter((m) => m.id !== hud?.id).slice(0, 3);
    if (active.length) lines.push(`Also taken on: ${active.map((m) => `"${m.title}" for ${ms.giverName(m.giver)}`).join('; ')}.`);
    const done = ms.missions.filter((m) => ms.state[m.id]?.status === 'done').slice(-4);
    if (done.length) lines.push(`Done lately: ${done.map((m) => `"${m.title}"`).join(', ')}.`);
    const can = [...new Set(ms.granted.filter((x) => x.id !== 'raw').slice(-6).map((x) => componentLabel(x.kind, x.id, g).toLowerCase()))];
    if (ms.flags.weave_seen) lines.push(`The stranger can weave (light made from the air with glyphs in it, not lumencraft; nobody knows why).${can.length ? ` Lately learned: ${can.join(', ')}.` : ''}`);
    const seen = ms.lyraWatch?.seenEssences || [];
    if (seen.includes('dark')) lines.push('She has seen them weave dark, which feels to her like the ruins\' gravelight; it worries her.');
    let out = lines.join('\n');
    if (out.length > 700) out = `${out.slice(0, 697)}…`;
    return out;
  },

  serialize(ctx) {
    const ms = ctx.game?.missions;
    if (!ms) return null;
    return { m: ms.serialize(), l: ms.lyraWatch?.serialize?.() ?? null, r: ms.gossip?.serialize?.() ?? null };
  },

  deserialize(d, ctx) {
    if (!ctx.game?.missions) {
      this._pending = d;
      return;
    }
    this.applySave(d, ctx.game);
  },

  applySave(d, g) {
    const ms = ensureMissions(g);
    if (!ms || !d) return;
    ms.deserialize(d.m || d);
    ms.lyraWatch?.deserialize?.(d.l);
    ms.gossip?.deserialize?.(d.r);
  },
};
