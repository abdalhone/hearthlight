// The day's unease, kept (round 14b leftover from the V11 hearing fix; DESIGN §36.5): a
// villager who heard a crime and saw nothing is uneasy for the day (`npc.uneasy = { day,
// place, t }`, set by npc.js). It was lost on a reload; now it is saved for the day it
// belongs to, and talk's prompt and the jurors' briefs read it ("you heard a scream from the
// Kettle this afternoon": a sound and a place, never a person). A day old, it is dropped.

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export const uneasePlugin = {
  id: 'unease',
  name: 'Unease',
  description: 'Who heard something today and saw nothing, kept for the day (DESIGN §29.4).',
  serialize(ctx) {
    const g = ctx.game;
    const day = Math.floor(g?.clock?.day ?? 1);
    const out = {};
    for (const e of safe(() => g.entities.all(), []) || []) {
      const u = e?.uneasy;
      if (e?.profile && u && (u.day == null || u.day === day)) out[e.id] = { day: u.day ?? day, place: u.place ?? null, t: Number.isFinite(u.t) ? Math.round(u.t) : null };
    }
    return out;
  },
  deserialize(d, ctx) {
    const g = ctx.game;
    if (!d || typeof d !== 'object') return;
    const day = Math.floor(g?.clock?.day ?? 1);
    for (const [id, u] of Object.entries(d)) {
      if (!u || u.day !== day) continue;
      const e = safe(() => g.entities.get(id), null);
      if (e && !e.uneasy) e.uneasy = { day: u.day, place: u.place ?? null, t: u.t ?? null };
    }
  },
};
