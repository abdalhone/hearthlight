import { parseQty, line } from './util.js';

// Helpers for the offline brain's command intents (DESIGN §11). Patterns are
// anchored at the start of a clause and allow polite lead-ins ("hey lyra, could
// you ...") and tails ("... please", "... now!"), so they stay specific enough not
// to fire on ordinary chat.

const LEAD = String.raw`^\s*(?:[a-z']+,\s*)?(?:(?:hey|hi|oi|ok(?:ay)?|alright|all right|right|so|now|then|and|also|please|pls|quick(?:ly)?|lyra|can you|could you|would you|will you|would you mind|i want you to|i need you to|i'd like you to|id like you to|go ahead and|try to|just|you should|you can|you could|time to|let's have you)[,!.]?\s+)*`;
const TAIL = String.raw`(?:\s+(?:please|pls|now|for me|right now|quickly|lyra|ok(?:ay)?|thanks|thank you|will you|would you|alright|again))*[\s.!?]*$`;

export function cmd(body) {
  return new RegExp(LEAD + body + TAIL, 'i');
}

// Quantity words used inside patterns.
export const QTY = String.raw`(?:(?<qty>\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|a few|a couple(?: of)?|several|a dozen|lots of|a lot of|plenty of|a bunch of)\s+)?(?:some\s+|more\s+|a little\s+)?`;

export const act = (name, target = null, value = null, amount = null) => ({ name, args: { target, value, amount } });

export function qtyFrom(m) {
  const q = m?.groups?.qty;
  if (!q) return null;
  return parseQty(q.replace(/\s+of$/, ''));
}

// "a minute" -> 60, "5 seconds" -> 5, "two minutes" -> 120, "a moment" -> 10.
export function parseDuration(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  if (/^an? (?:sec|second|moment)$/.test(t) || /^a few (?:seconds|moments)$/.test(t) || t === 'a tick') return 10;
  if (/^a (?:bit|little while)$/.test(t)) return 30;
  if (/^a while$/.test(t)) return 90;
  if (/^an? (?:minute|min)$/.test(t)) return 60;
  if (/^a couple (?:of )?minutes$/.test(t)) return 120;
  if (/^a few minutes$/.test(t)) return 180;
  const m = t.match(/^(\S+(?: \S+)?)\s+(minutes?|mins?|seconds?|secs?)$/);
  if (m) {
    const n = parseQty(m[1]);
    if (!n) return null;
    return /^min/.test(m[2]) ? n * 60 : n;
  }
  return null;
}

// Lyra's answer to a command. When she refused (her consent gate said no), the
// answer is her refusal and never an acknowledgement; then any other problem;
// else the last thing she said.
export function firstMessage(results) {
  if (!Array.isArray(results) || !results.length) return null;
  const refused = results.find((r) => r && r.refused);
  if (refused) return refused.message || refusalLine(refused.verdict);
  const bad = results.find((r) => r && r.ok === false && r.message);
  if (bad) return bad.message;
  for (let i = results.length - 1; i >= 0; i--) if (results[i]?.message) return results[i].message;
  return null;
}

// A refusal with no words attached: say no, and why when the verdict says.
export function refusalLine(verdict) {
  const why = Array.isArray(verdict?.reasons) ? String(verdict.reasons[0] || '').trim() : '';
  const counter = verdict?.decision === 'counter';
  if (why) return `${counter ? 'Not like that' : 'No'} — ${why.replace(/[.!]+$/, '')}.`;
  return line('refuse.plain', ["No. Not this time.", "I'd rather not.", "No. Ask me something else.", "That's a no from me."]);
}

// Strip pronouns and filler from a captured reference ("that wolf" stays; "it" -> null).
export function cleanRef(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/[.!?,]+$/, '');
  if (!t || /^(it|them|him|her|that|this|those|these|'?em|one|something|anything)$/i.test(t)) return null;
  return t;
}

// What an item comes from, so "bring me wood" can become a job when her pack is empty.
const ITEM_JOB = {
  wood: 'chop_wood',
  herb: 'gather_herbs',
  moonpetal: 'gather_herbs',
  berries: 'forage',
  iron_ore: 'mine_ore',
  stone: 'mine_ore',
  crystal: 'mine_ore',
  raw_fish: 'fish',
  turnip: 'farm',
  wheat: 'farm',
  cooked_fish: 'cook fish',
  stew: 'cook stew',
  bread: 'cook bread',
};

export function jobForItem(itemId) {
  return ITEM_JOB[itemId] || null;
}

// The DELIVER clause of a job order: "and bring them to me", "put them in the chest", ...
export const DELIVER = String.raw`(?:\s+(?:and|then|,)?\s*(?<deliver>(?:bring|give|hand|carry|take)\s+(?:them|it|those|that|the \w+|everything)(?:\s+(?:back|over|here))?(?:\s+to me)?|(?:put|store|stash|leave|drop)\s+(?:them|it|those|everything)\s+(?:in|into|at)\s+(?:the |our |my )?(?:chest|home|house|cottage)|store\s+(?:them|it)|keep\s+(?:them|it|those)(?:\s+(?:yourself|for now|for later))?|hold on to\s+(?:them|it)))?`;

export function deliverFrom(m) {
  const d = m?.groups?.deliver;
  if (!d) return null;
  if (/chest|home|house|cottage|store|stash/.test(d)) return 'chest';
  if (/keep|hold on/.test(d)) return 'keep';
  return 'player';
}
