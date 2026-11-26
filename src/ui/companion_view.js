// The HUD's companion slot as data (round 14b, DESIGN §34.3; the author: "do not put Lyra and
// HUD like it's a main thing of the game"). Pure: no DOM, unit-tested under node.
//
//   companionView(game) -> null when you walk alone, else
//     { id, name, portraitKey, expr, hp, maxHp, downed, status, stance, isLyra, cs,
//       standing: { label, tone, key }, rel: { trust, fear } | { opinion } | null,
//       barTitle, jobs, askLabel, cardTitle }
//
// It reads the ROLE (game.party.holder, src/core/party.js holderOf), never game.companion:
// Lyra shows here only while she walks with you. A villager's standing comes from their
// opinion of you (village_view.js opinionLevel), Lyra's from her companionship, trust and fear.

import { holderOf, isLyra as isLyraOf, lyraCompanionship } from '../core/party.js';
import { companionshipLabel, companionshipTone, playerRelation } from './lyra_view.js';
import { opinionLevel } from './village_view.js';
import { lyraStatusLine, moodToExpression } from './format.js';

const OPINION_TONE = { fond: 'good', friendly: 'good', neutral: 'calm', wary: 'warn', hostile: 'bad' };
const DUTY_STATUS = { following: 'following you', waiting: 'waiting where you asked', fighting: 'fighting beside you', down: 'down' };

// The tab on the Ask bar says what asking means right now (Lyra keeps her own words).
const LYRA_BAR = {
  together: (n) => `Ask ${n}`,
  wary: (n) => `Ask ${n} · she is wary`,
};

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function firstName(e) {
  return String(e?.name || e?.id || '').split(' ')[0] || 'them';
}

// The name a person goes by on the HUD (Lyra's can be renamed in Settings).
export function displayName(game, e) {
  if (!e) return '';
  if (isLyraOf(game, e)) return game?.settings?.companionName || e.name || 'Lyra';
  return firstName(e);
}

export function companionView(game) {
  const h = holderOf(game);
  if (!h || h.removed) return null;
  const lyra = isLyraOf(game, h);
  const name = displayName(game, h);
  const hp = num(h.hp);
  const maxHp = Math.max(1, num(h.maxHp, 1));
  const downed = !!h.downed;
  if (lyra) {
    const cs = lyraCompanionship(game);
    const beh = h.behavior;
    const stance = beh?.stance || 'defend';
    const status = lyraStatusLine(safe(() => beh?.status?.(), '') || '', stance, downed, true);
    const mind = h.mind;
    const mood = safe(() => mind?.mood?.(), null);
    const expr = downed ? 'sad' : moodToExpression(mood, mind?.emotions, mind?.needs);
    const rel = playerRelation(mind);
    return {
      id: h.id,
      name,
      portraitKey: h.spriteKey || h.id,
      expr,
      mood,
      hp,
      maxHp,
      downed,
      status,
      stance,
      isLyra: true,
      cs,
      standing: { label: companionshipLabel(cs), tone: companionshipTone(cs), key: cs },
      rel: rel ? { trust: num(rel.trust), fear: num(rel.fear) } : null,
      barTitle: (LYRA_BAR[cs] || LYRA_BAR.together)(name),
      jobs: !!beh?.jobs,
      askLabel: `Ask ${name}`,
      cardTitle: `${name}: open People (Tab)`,
    };
  }
  const duty = h.duty;
  const stance = duty?.stance || 'defend';
  const st = downed ? 'down' : safe(() => duty?.status?.(), 'following') || 'following';
  const opinion = num(h.opinionOfPlayer, 30);
  const lvl = opinionLevel(opinion) || { label: 'Neutral', key: 'neutral' };
  const expr = downed ? 'sad' : opinion >= 75 ? 'happy' : opinion < 30 ? 'worried' : 'neutral';
  return {
    id: h.id,
    name,
    portraitKey: h.spriteKey || h.id,
    expr,
    mood: null,
    hp,
    maxHp,
    downed,
    status: DUTY_STATUS[st] || st,
    stance,
    isLyra: false,
    cs: 'together',
    standing: { label: lvl.label, tone: OPINION_TONE[lvl.key] || 'calm', key: lvl.key },
    rel: { opinion },
    barTitle: `Ask ${name}`,
    jobs: false,
    askLabel: `Ask ${name}`,
    cardTitle: `${name}: open People (Tab)`,
  };
}

// 'full' with someone beside you, 'hidden' when you walk alone (P-B4: the Ask bar belongs to
// whoever holds the role; asking Lyra back lives on her People page).
export function companionBarMode(view) {
  return view ? 'full' : 'hidden';
}
