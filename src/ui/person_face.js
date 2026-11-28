// Whose face shows what (round 15, item 2; the author's V12 screenshots: Lyra's card
// star-struck while she said "That didn't sound good." after a killing nearby, and while
// the player held a finisher over Bram). One answer for every person, used by every place a
// face shows a mood (the HUD's companion card, People, the chat's header): the face reads
// their real state, never a delighted default. Pure: no DOM.
//
//   personFace(game, e)   -> { kind, label } | null (the dead show no face)
//                            Lyra (anyone with a mind): her mood (emotions.js mood().face,
//                            which the violence she saw or heard now moves: §40.2)
//                            a villager: down (hurt), terror or dread of you, running,
//                            fighting, grief or worry, uneasy after a cry, cold with you,
//                            else their standing with you (fond … hostile)
//   portraitExpr(kind)    -> the portrait expression that goes with a face kind

import { moodFace, standingFace } from './format.js';
import { opinionLevel } from './village_view.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function isDead(game, e) {
  if (!e) return true;
  if (safe(() => game?.murder?.isDead?.(e.id), false)) return true;
  if (e.id === 'lyra' && game?.flags?.lyra_dead) return true;
  return !!(e.dead && !e.downed);
}

export function personFace(game, e) {
  if (!e || isDead(game, e)) return null;
  if (e.downed) return { kind: 'hurt', label: 'hurt, down' };
  const mind = e.mind;
  if (mind && typeof mind.mood === 'function') {
    const m = safe(() => mind.mood(), null);
    if (m) return { kind: moodFace(m), label: m.label || 'quiet' };
    return { kind: 'neutral', label: 'quiet' };
  }
  const fear = safe(() => game?.murder?.fearOf?.(e), null);
  if (fear === 'terror') return { kind: 'terrified', label: 'terrified of you' };
  if (e.mode === 'flee') return { kind: 'afraid', label: 'afraid' };
  if (fear === 'dread') return { kind: 'afraid', label: 'afraid of you' };
  if (e.mode === 'fight' || safe(() => e.duty?.status?.(), '') === 'fighting') return { kind: 'angry', label: 'fighting' };
  const mourning = safe(() => game?.villageLife?.mourning?.[e.id], null);
  const day = safe(() => game?.clock?.day, 0) ?? 0;
  if (mourning && !(mourning.until < day)) return mourning.kind === 'grief' ? { kind: 'grieving', label: 'grieving' } : { kind: 'uneasy', label: 'worried' };
  if (e.uneasy && e.uneasy.day === day) return { kind: 'uneasy', label: 'uneasy' };
  const st = safe(() => game?.village?.standing?.(e.id), null);
  const cut = !!safe(() => game?.village?.cutTies?.[e.id], null);
  if (cut || st?.cold) return { kind: 'cold', label: cut ? 'done with you' : 'cold with you' };
  const op = Number.isFinite(e.opinionOfPlayer) ? e.opinionOfPlayer : 30;
  const lvl = opinionLevel(op) || { key: 'neutral', label: 'Neutral' };
  return { kind: standingFace(lvl.key), label: String(lvl.label || 'neutral').toLowerCase() };
}

const EXPR = {
  delighted: 'happy',
  happy: 'happy',
  lively: 'happy',
  content: 'happy',
  affectionate: 'love',
  proud: 'happy',
  relieved: 'neutral',
  calm: 'neutral',
  neutral: 'neutral',
  guarded: 'neutral',
  blank: 'neutral',
  curious: 'neutral',
  fascinated: 'happy',
  restless: 'neutral',
  flustered: 'worried',
  startled: 'worried',
  shocked: 'worried',
  afraid: 'worried',
  terrified: 'worried',
  uneasy: 'worried',
  on_edge: 'worried',
  distressed: 'worried',
  sad: 'sad',
  heartsick: 'sad',
  grieving: 'sad',
  hurt: 'sad',
  miserable: 'sad',
  angry: 'angry',
  furious: 'angry',
  cold: 'angry',
  exhausted: 'sleepy',
  starving: 'worried',
};

export function portraitExpr(kind) {
  return EXPR[kind] || 'neutral';
}
