// What the player's hands do (round 14b T-3, DESIGN §33.3; decision D6): the GAME decides
// consent and outcome before any mind words the reaction. A text act never kills and deals
// at most 1–3 hp (never downing anyone, a child least of all). Intimate acts need
// canBeIntimate (18 and over): below it the game refuses them ("You don't.") and no mind is
// ever asked. An assault goes through combat.assault (the crime pipeline: known only to
// those who SEE it, murder.screenCrime; the hp taken, never the last of it). What
// others make of it travels by sight (the village's witnessesNear with sight) and then by
// meeting.
//
//   decideActs(game, e, acts, { village }) -> {
//     refused: 'You don't.' | null,        the game refused it outright (nothing else happens)
//     narration: 'You bow. Elda smiles.',  the act row the chat shows
//     brief: 'They do (an act, not words): *bows*. A courtesy; it pleased you.',
//     local: { lines, mood, delta, intent } | null,   their own answer offline
//     outcomes: [{ act, outcome, target }] }

import { canBeIntimate } from '../../core/people.js';
import { RUMOR_KINDS } from './rumors.js';
import { actLine } from './acts.js';
import { addNote } from './player_talk.js';

const REACH = 40; // px: close enough to touch
const NEAR_ENOUGH = 64; // px: close enough to bow at, spit at, wave at
const HARM = { grab: 1, shove: 1, slap: 2, punch: 3, kick: 3 };

// The village's news of what it saw the hands do.
const ACT_RUMORS = {
  unwelcome: { text: '{stranger} put their hands on {v} uninvited', you: 'you put your hands on {v} uninvited', valence: -0.5, severity: 0.45 },
  spat_at: { text: '{stranger} spat at {v}', you: 'you spat at {v}', valence: -0.45, severity: 0.4 },
  slapped_lyra: { text: '{stranger} slapped {lyra}', you: 'you slapped Lyra', valence: -0.75, severity: 0.7, victim: 'lyra' },
};
for (const [k, v] of Object.entries(ACT_RUMORS)) if (!RUMOR_KINDS[k]) RUMOR_KINDS[k] = v;

const LINES = {
  affection_welcome: ['Oh! Well — come here, then.', "Mm. That's nice.", "You're a soft one, aren't you."],
  affection_unwelcome: ['Hands off.', "Don't touch me.", 'What do you think you are doing?'],
  intimate_welcome: ['Oh… oh, my.', 'Well. That was something.'],
  intimate_unwelcome: ["Don't you dare.", 'No. Step back.', 'Absolutely not.'],
  respect: ["Oh — you needn't bow to me.", 'Ha! Get up, get up.', "Well, aren't you polite."],
  offence: ['Do that again and see.', 'Charming.', 'Was that meant for me?'],
  assault: ['Ow! What was that for?!', 'You— you hit me!', 'Get away from me!'],
  threat: ["You're mad. Stay back!", 'Help! Somebody!', "Don't— don't come near me."],
  far: ['What are you doing over there?'],
};

const pick = (list, n = 0) => list[Math.abs(Math.floor(n)) % list.length];
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const HE = new Set(['hobb', 'bram', 'pip', 'rowan', 'tobias', 'garrick', 'alder', 'corran', 'wys']);
const he = (id) => (HE.has(id) ? 'He' : 'She');
const him = (id) => (HE.has(id) ? 'him' : 'her');

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function firstName(e) {
  const n = String(e?.name || e?.id || 'They')
    .replace(/^(Captain|Sister|Reeve)\s+/, '')
    .split(' ')[0];
  return n || 'They';
}

function isLyra(game, e) {
  return !!e && (e === game?.companion || e.id === 'lyra');
}

// Would they welcome it? The game's own weighing (never Claude's).
function welcomes(game, e, kind, village) {
  if (safe(() => game?.murder?.fearOf?.(e), null)) return false;
  if (isLyra(game, e)) {
    const st = safe(() => e.mind?.companionship ?? e.mind?.autonomy?.companionship, 'together');
    if (st !== 'together') return false;
    const rel = safe(() => e.mind?.relationships?.get?.('player'), null) || {};
    const trust = num(rel.trust, 50);
    const aff = num(rel.affinity, 20);
    return kind === 'intimate' ? trust >= 65 && aff >= 60 : trust >= 45 && aff >= 35;
  }
  const st = safe(() => village?.standing?.(e.id), null) || {};
  if (st.cold) return false;
  const op = num(st.opinion ?? e.opinionOfPlayer, 30);
  const fam = num(e.familiarity, 0);
  return kind === 'intimate' ? op >= 85 && fam >= 60 : op >= 75 || (op >= 60 && fam >= 25);
}

function seenBy(village, x, y, exclude = []) {
  return (safe(() => village?.witnessesNear?.(x, y, 150, { sight: true }), []) || []).filter((id) => !exclude.includes(id));
}

export function decideActs(game, e, acts, { village = null } = {}) {
  const out = { refused: null, narration: null, brief: null, local: null, outcomes: [] };
  if (!Array.isArray(acts) || !acts.length) return out;
  const P = game?.player;
  const rows = [];
  const brief = [];
  let local = null;
  const n = Math.floor(num(game?.time, 0) * 7);
  for (const act of acts.slice(0, 3)) {
    // Who it lands on: the one addressed, or someone named and within reach.
    let t = e;
    if (act.target && act.target !== 'addressee' && act.target !== e?.id) {
      const other = act.target === 'lyra' ? game?.companion : safe(() => game?.entities?.get?.(act.target), null);
      if (other && P && Math.hypot(other.x - P.x, other.y - P.y) <= NEAR_ENOUGH) t = other;
    }
    const name = t ? firstName(t) : '';
    const me = actLine(act, name);
    if (!t || act.kind === 'neutral') {
      rows.push(me);
      if (t) brief.push(`They do (an act, not words): *${act.raw}*.`);
      out.outcomes.push({ act, outcome: 'done', target: t?.id || null });
      continue;
    }
    // Intimate acts toward anyone under 18: the game refuses them. Nothing is done, nothing
    // is sent to a mind (D1, canBeIntimate).
    if (act.kind === 'intimate' && !canBeIntimate(game, t)) {
      out.refused = "You don't.";
      out.outcomes.push({ act, outcome: 'refused', target: t.id });
      return out;
    }
    const d = P ? Math.hypot(t.x - P.x, t.y - P.y) : 0;
    const touch = act.kind === 'affection' || act.kind === 'intimate' || act.kind === 'assault' || act.verb === 'poke';
    if ((touch && d > REACH) || d > NEAR_ENOUGH * 1.5) {
      rows.push(`${name} is out of your reach.`);
      brief.push(`They make as if to *${act.raw}*, but they are too far away to reach you.`);
      out.outcomes.push({ act, outcome: 'far', target: t.id });
      local ||= { lines: [pick(LINES.far, n)], mood: 'curious', delta: 0, intent: 'act' };
      continue;
    }
    const lyra = isLyra(game, t);
    const a = lyra ? t.mind?.autonomy : null;
    let outcome = 'done';
    let what = '';
    let after = '';
    switch (act.kind) {
      case 'affection':
      case 'intimate': {
        const yes = welcomes(game, t, act.kind, village);
        outcome = yes ? 'welcome' : 'unwelcome';
        what = yes ? 'It was welcome to you.' : 'It was unwelcome to you: you did not want it.';
        after = yes ? `${name} lets you.` : `${name} pulls away from you.`;
        if (lyra) safe(() => a?.recordDeed?.(yes ? 'affection_welcome' : act.kind === 'intimate' ? 'kissed_unwelcome' : 'touched_unwelcome'));
        else if (yes) safe(() => t.adjustOpinion?.(1.5, 'the player was warm, and it was welcome'));
        else {
          safe(() => t.adjustOpinion?.(act.kind === 'intimate' ? -5 : -3, 'the player put their hands on them uninvited'));
          safe(() => addNote(village, t.id, act.kind === 'intimate' ? 'you tried to kiss me, and I did not want it' : 'you put your hands on me without asking', 3));
          safe(() => village?.addRumor?.('unwelcome', { victim: t.id, witnesses: [t.id, ...seenBy(village, t.x, t.y, [t.id])] }));
        }
        local = { lines: [pick(LINES[`${act.kind}_${outcome}`], n)], mood: yes ? 'warm' : 'angry', delta: 0, intent: 'act' };
        break;
      }
      case 'respect':
        outcome = 'welcome';
        what = 'A courtesy, and it pleased you.';
        after = `${name} smiles despite ${lyra ? 'herself' : him(t.id) + 'self'}.`;
        if (lyra) safe(() => a?.recordDeed?.('bowed'));
        else safe(() => t.adjustOpinion?.(0.8, 'the player bowed to them'));
        local ||= { lines: [pick(LINES.respect, n)], mood: 'amused', delta: 0, intent: 'act' };
        break;
      case 'offence':
        outcome = 'unwelcome';
        what = act.verb === 'spit' ? 'An insult: they spat at you.' : 'Rude, and unwelcome.';
        after = `${name} glares at you.`;
        if (lyra) safe(() => a?.recordDeed?.('touched_unwelcome'));
        else {
          safe(() => t.adjustOpinion?.(-3, 'the player was offensive'));
          if (act.verb === 'spit') safe(() => village?.addRumor?.('spat_at', { victim: t.id, witnesses: [t.id, ...seenBy(village, t.x, t.y, [t.id])] }));
        }
        local = { lines: [pick(LINES.offence, n)], mood: 'angry', delta: 0, intent: 'act' };
        break;
      case 'assault': {
        outcome = 'assault';
        what = 'It hurt: they struck you. It was an assault.';
        after = `${name} reels back.`;
        const want = HARM[act.verb] || 1;
        const hp = num(t.hp, 1);
        const cap = Math.max(0, Math.min(want, hp - 1));
        // Never down anyone: at most hp−1, and with room to spare for whatever multiplies a
        // blow (a price, a status), else the hp is taken by hand.
        if (lyra) {
          if (cap > 0) t.hp = Math.max(1, hp - cap);
          t.flash = 1;
          safe(() => a?.recordDeed?.(act.verb === 'slap' || act.verb === 'punch' || act.verb === 'kick' ? 'slapped_lyra' : 'shoved_lyra'));
          safe(() => village?.addRumor?.('slapped_lyra', { victim: 'lyra', witnesses: seenBy(village, t.x, t.y, ['lyra']) }));
        } else if (game?.combat?.assault) {
          // Every assault by hand goes through combat's one wrapper: the crime (by sight),
          // their own reaction to being hit (the damage event), never their last hp.
          safe(() => game.combat.assault(P, t, 'assault', { amount: cap, knockback: act.verb === 'shove' ? 60 : 20 }));
        } else {
          if (cap > 0) t.hp = Math.max(1, hp - cap);
          t.flash = 1;
        }
        if (!lyra) safe(() => t.adjustOpinion?.(-8, 'the player struck them'));
        local = { lines: [pick(LINES.assault, n)], mood: 'angry', delta: 0, intent: 'act', action: 'glare' };
        break;
      }
      case 'threat':
        outcome = 'threat';
        what = 'A threat on your life: they made as if to kill you. You are frightened.';
        after = `${name} flinches back from you.`;
        if (lyra) safe(() => a?.adjustPlayer?.({ fear: 8, trust: -5 }, 'Made as if to kill me'));
        else {
          safe(() => t.adjustOpinion?.(-6, 'the player threatened their life'));
          safe(() => village?.addRumor?.('threat', { victim: t.id, witnesses: [t.id, ...seenBy(village, t.x, t.y, [t.id])] }));
        }
        local = { lines: [pick(LINES.threat, n)], mood: 'afraid', delta: 0, intent: 'act', action: 'flee' };
        break;
      default:
        break;
    }
    rows.push(after ? `${me} ${after}` : me);
    brief.push(`They do (an act, not words): *${act.raw}*. ${what}`.trim());
    out.outcomes.push({ act, outcome, target: t.id });
  }
  out.narration = rows.join(' ') || null;
  out.brief = brief.join(' ') || null;
  out.local = local;
  return out;
}

// For the chat's own row and the bubble over the player.
export { actLine };
export { he as pronounHe };
