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
import { TEACHES, partText } from '../ai/social/commitments.js';

// What Lyra can teach right now (DESIGN §23.2: a "yes, I'll teach you" is a lesson that
// starts): { mission, state: 'available'|'active'|'locked'|'none', why }.
export function lyraLesson(ms) {
  if (!ms) return { mission: null, state: 'none', why: '' };
  let locked = null;
  for (const m of ms.missions.filter((x) => x.giver === 'lyra' && (x.rewards || []).some((r) => r.magic || r.unlock))) {
    const st = ms.status(m.id);
    if (st === 'available') return { mission: m, state: 'available', why: '' };
    if (st === 'active' || st === 'ready') return { mission: m, state: 'active', why: ms.objectiveText?.(m.id) || '' };
    if (st === 'locked' && !locked) locked = { mission: m, state: 'locked', why: ms.missing(m)[0] || 'later' };
  }
  return locked || { mission: null, state: 'none', why: '' };
}

function othersWhoTeach(g) {
  const out = [];
  for (const [id, list] of Object.entries(TEACHES)) {
    if (out.length >= 3 || g?.murder?.isDead?.(id)) continue;
    const name = g?.entities?.get?.(id)?.name?.replace(/^(Sister|Captain)\s+/, '').split(' ')[0] || id;
    out.push(`${name} (${partText(list[0].parts[0])})`);
  }
  return out;
}

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
    offer_lesson: {
      description: "Offer to teach the player the weave you can teach them now (only when they ask, or you choose to). The game checks you can, and starts the lesson when they say yes; if not possible it says why.",
      params: {},
      run(args, ctx) {
        const ms = ctx.game?.missions;
        const l = lyraLesson(ms);
        if (l.state === 'available') {
          ms.offerFromLyra(l.mission);
          return { ok: true, message: '' };
        }
        if (l.state === 'active') return { ok: true, message: `We've already begun.${l.why ? ` ${l.why}` : ''}` };
        if (l.state === 'locked') return { ok: false, message: `Not yet. ${l.why.charAt(0).toUpperCase()}${l.why.slice(1)}.` };
        return { ok: false, message: "I've taught you what's mine to teach." };
      },
    },
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

  // "Teach me magic": a lesson she can give starts as one (an offer with a yes chip), or
  // she says plainly why not, and who else teaches what (DESIGN §23.2).
  intents: [
    {
      id: 'missions.teach',
      patterns: [/\b(?:teach|show)\s+me\b.*\b(?:magic|spells?|weav\w*|lumencraft|light|how to (?:weave|cast))\b|^(?:can|could|will|would) you teach me\b|^teach me\b/i],
      confidence: 0.86,
      answer(m, ctx) {
        const g = ctx.game;
        const ms = g?.missions;
        if (!ms) return null;
        const l = lyraLesson(ms);
        const trust = g?.companion?.mind?.autonomy?.stats?.().trust ?? 50;
        const st = g?.companion?.mind?.autonomy?.companionship;
        if (st === 'left' || st === 'gone') return 'No. Not you, not now.';
        if (l.state === 'available' && (l.mission.requires?.trust == null || trust >= l.mission.requires.trust)) {
          ms.offerFromLyra(l.mission);
          return 'Yes. I’ll teach you what I can.';
        }
        if (l.state === 'active') return `We've already begun. ${l.why ? `${l.why.charAt(0).toUpperCase()}${l.why.slice(1).replace(/\.?$/, '.')}` : ''}`.trim();
        const others = othersWhoTeach(g);
        const ask = others.length ? ` Ask ${others.slice(0, -1).join(', ')}${others.length > 1 ? ' or ' : ''}${others[others.length - 1]}: they each have something of their own to give you.` : '';
        if (l.state === 'locked') return `Not yet. Lumencraft took me eight years; yours will come ${l.why}.${ask}`;
        return `I've taught you what's mine to teach.${ask}`;
      },
    },
  ],

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
    const l = lyraLesson(ms);
    if (l.state === 'available') lines.push(`If they ask you to teach them: you can — "${l.mission.title}". To start it, use offer_lesson (the game shows them the lesson to accept). Never promise a lesson without it.`);
    else if (l.state === 'locked') lines.push(`If they ask you to teach them: not yet (${l.why}); say so plainly.`);
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
