import { ITEMS, itemName, resolveItemId } from '../../entities/items.js';
import { MISSIONS } from '../../missions/data.js';
import { TILE } from '../../core/constants.js';
import { inVale } from '../../world/wilds_layout.js';

const nameFirst = (n) => String(n || '').replace(/^(captain|sister|brother|old|reeve)\s+/i, '').split(/\s+/)[0] || '';

// Promises become real actions (DESIGN §23.2; the author: "I told this woman to go and
// talk to Lyra for me, and she said okay, but she didn't actually go", "The AI said he
// would give me something but didn't", "They agreed, but they didn't give me anything").
//
// When the player asks a villager for something they can do — go and talk to Lyra for
// them, give them something, teach them a weave — the game understands the ask (detect),
// checks it is possible and whether they are willing (decide), and the villager's answer
// carries what they decided. A yes is a commitment the game carries out:
//
//   tell   they walk to Lyra (village_life's 'keep' step), the two talk, and Lyra really
//          hears the message (her memory, her will: Autonomy.hearMessage)
//   give   the item changes hands, now (they hand it over across the counter)
//   teach  a part they actually know (their errands in missions/data.js teach it): the
//          lesson starts (the mission is taken on), and the part unlocks when it is done
//
// A no says plainly why. Claude, when it voices them, is told the ask and what is possible,
// and answers with { commit: { kind, agree } }; the game never acts on a yes it has not
// checked. A promise not kept by its day is broken, and both sides remember it.
//
// game.village.commitments:
//   detect(npc, text)                  -> ask | null   { kind, item?, qty?, message?, to? }
//   decide(npc, ask)                   -> { can, will, why, line, lines?, plan }
//   brief(npc, ask, dec)               -> words for Claude's brief
//   settle(npc, ask, dec, reply)       -> { lines, made }  (after the local or Claude reply)
//   offersIn(npc, lines)               items offered in what they said ("take a honey cake"): handed over
//   fulfil(id, npc, target)            -> { lines, summary, after } for the exchange with Lyra
//   update(dt)                         start walks, break what is overdue
//   open(id) / all()                   commitments
//   serialize() / deserialize(d)
//
// c = { id, by, kind, to, message, item, qty, mission, state: 'open'|'doing'|'kept'|'broken',
//       made, day, due, said }

const DAY = 900;
const GIVE_CAP = 2; // gifts a villager hands over in a day
const SKIP_GAP = 30; // s of clock between two checks (about 1 s apart) that can only be a skip
// What each villager has to give from their own trade (and how well they must think of the
// player to give it). Never their coin, never what they live by selling dear.
export const GIVES = {
  elda: { honey_cake: 30, bread: 20, stew: 45 },
  hobb: { candle: 25 },
  wenna: { honey: 45 },
  pip: { berries: 15 },
  mira: { herb: 25, potion: 65 },
  tobias: { turnip: 20, wheat: 25 },
  aveline: { candle: 25, bread: 35 },
  hess: { venison: 45, wolf_pelt: 60 },
  sabeth: { wool_cloak: 85 },
  petra: { bread: 35 },
  tilly: { iron_ore: 40 },
  tansy: { egg: 20 },
  corran: { raw_fish: 25, smoked_eel: 50 },
  rowan: { potion: 70 },
};

// Who teaches which parts: their errands that end in a weave (missions/data.js), in order.
export const TEACHES = (() => {
  const out = {};
  for (const m of MISSIONS) {
    if (!m.giver || m.giver === 'board' || m.giver === 'lyra') continue;
    const parts = (m.rewards || []).map((r) => r.magic || r.unlock).filter(Boolean);
    if (!parts.length) continue;
    (out[m.giver] ||= []).push({ mission: m.id, parts });
  }
  return out;
})();

// The parts in the village's words (LORE §11): Aveline's light, Bram's iron, Mira's green.
const ESSENCE_WORDS = { light: 'the light', iron: 'forgesung iron', nature: 'the green', song: 'the song', frost: 'the lake’s frost', storm: 'storm-glimmer', earth: 'quarry stone' };
export function partText(p) {
  if (!p) return 'a weave';
  if (p.kind === 'essence') return ESSENCE_WORDS[p.id] || `the ${p.id}`;
  if (p.kind === 'shape') return `the ${p.id} shape`;
  return `the ${p.id} twist`;
}

const TELL_RE = [
  /\b(?:go|run|pop|nip|walk|head)\s+(?:over\s+)?(?:to|and\s+(?:talk|speak)\s+to|and\s+see|and\s+find|and\s+tell|see|find)\s+(?<who>lyra|her|him|them)\b(?<rest>.*)$/i,
  /\b(?:talk|speak|have a word)\s+(?:to|with)\s+(?<who>lyra|her)\s+for\s+me\b(?<rest>.*)$/i,
  /\b(?:tell|ask)\s+(?<who>lyra|her)\s+(?:that\s+|to\s+)?(?<rest>.+)$/i,
  /\b(?:take|bring|carry)\s+(?:a\s+)?(?:message|word)\s+to\s+(?<who>lyra|her)\b(?<rest>.*)$/i,
  /\b(?:will|would|could|can)\s+you\s+(?:please\s+)?(?:go\s+)?(?:talk|speak)\s+to\s+(?<who>lyra)\b(?<rest>.*)$/i,
];
const GIVE_RE = [
  /\b(?:give|hand|pass|toss)\s+me\s+(?:a\s+|an\s+|some\s+|one\s+|your\s+|that\s+|the\s+)?(?<item>[a-z' -]{3,30}?)(?:\s+(?:please|for the road|then|now|too))?[.!?]*$/i,
  /\b(?:can|could|may)\s+i\s+(?:have|get|take)\s+(?:a\s+|an\s+|some\s+|one\s+|your\s+)?(?<item>[a-z' -]{3,30}?)(?:\s+(?:please|for the road|then|now|too))?[.!?]*$/i,
  /\b(?:spare|got)\s+(?:me\s+)?(?:a\s+|an\s+|some\s+|any\s+)(?<item>[a-z' -]{3,30}?)(?:\s+(?:please|for me))?[.!?]*$/i,
  /\bi(?:'d| would)\s+(?:like|love)\s+(?:a\s+|an\s+|some\s+)(?<item>[a-z' -]{3,30}?)(?:\s+please)?[.!?]*$/i,
];
// "Teach me" is an ask for a lesson on its own; "show me" only with the weave in it ("show me
// where my bed is" asks the way home, src/world/home.js, not for a lesson).
const TEACH_RE = /\bteach\s+me\b|\bshow\s+me\b.*\b(?:magic|spells?|weav\w*|essence|light|iron|frost|song|green|stone|storm|how to (?:weave|cast|use))\b|\b(?:teach|learn)\b.*\b(?:magic|spells?|weav\w*|essences?)\b/i;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const safe = (fn, fb = null) => {
  try {
    const v = fn();
    return v === undefined ? fb : v;
  } catch {
    return fb;
  }
};

// Their own short yes / no (in their voice, LORE §6), then the plain words of what they will do.
const YES = {
  elda: ['Course I will, love.', 'For you? Gladly, love.'],
  hobb: ['Well now, I can do that.'],
  wenna: ['Hm. I will.'],
  bram: ['Hmph. Fine.', 'Aye.'],
  pip: ['Okay! Yes!'],
  rowan: ['Very well.'],
  mira: ['All right.', 'Yes — all right.'],
  tobias: ['Oh — yes, of course.'],
  aveline: ['I will, child.'],
  garrick: ['For you, my friend? Done.'],
  hess: ['Mm. Fine.'],
  sabeth: ['Of course.'],
  alder: ['Very well.'],
  petra: ['Hah. Fine.'],
  tilly: ['Yeah, all right.'],
  tansy: ['Fine.'],
  corran: ['Hm-hmm. I will.'],
  wys: ['Yes! Right away, citizen.'],
};
const NO = {
  elda: ['No, love.'],
  hobb: ['Ah. No, I can’t.'],
  bram: ['No.'],
  pip: ['Nope.'],
  rowan: ['No.'],
  aveline: ['No, child.'],
  garrick: ['Ah — no, my friend.'],
  wys: ['Er — no, citizen.'],
};
const pickOf = (list, rng) => (list?.length ? list[Math.floor((typeof rng?.next === 'function' ? rng.next() : typeof rng === 'function' ? rng() : Math.random()) * list.length) % list.length] : null);
function yesWord(id, rng) {
  return pickOf(YES[id], rng) || 'All right.';
}
function noWord(id, rng) {
  return pickOf(NO[id], rng) || 'No.';
}
const aThing = (item) => {
  const n = itemName(item, 1).toLowerCase();
  return /^(?:[aeiou])/.test(n) ? `an ${n}` : `a ${n}`;
};

export class Commitments {
  constructor(village) {
    this.v = village;
    this.list = [];
    this.seq = 0;
    this.gifts = {}; // id -> { day, n, items: [] }
    this.selfNotes = {}; // id -> [{ text, day }]
    this._acc = 0;
  }

  get game() {
    return this.v?.game || null;
  }

  now() {
    return this.v?.now?.() ?? this.game?.clock?.t ?? 0;
  }

  day() {
    return this.v?.day?.() ?? this.game?.clock?.day ?? 1;
  }

  playerName() {
    const n = this.game?.settings?.playerName;
    return n && !/^(player|you|someone|travell?er)$/i.test(n) ? n : 'the stranger';
  }

  name(id) {
    return this.v?.name?.(id) || id;
  }

  open(id = null) {
    return this.list.filter((c) => (c.state === 'open' || c.state === 'doing') && (!id || c.by === id));
  }

  all() {
    return this.list.slice();
  }

  // ------------------------------------------------------------------ understanding the ask

  detect(npc, text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || !npc?.id) return null;
    // "Tell Lyra…", "go to her for me": the one they mean is Lyra unless someone else is named.
    for (const re of TELL_RE) {
      const m = t.match(re);
      if (!m) continue;
      const who = String(m.groups?.who || '').toLowerCase();
      if (who !== 'lyra' && !this.lyraInTalk(npc, t)) continue;
      const rest = String(m.groups?.rest || '')
        .replace(/^\s*(?:for me|please|now|today|then)\b[,.!]*/i, '')
        .replace(/^\s*(?:and\s+)?(?:tell|say to|let)\s+(?:her|lyra)\s+(?:know\s+)?/i, '')
        .replace(/^\s*(?:that|to)\s+/i, '')
        .replace(/\s+(?:for me|please)\s*[.!?]*$/i, '')
        .trim();
      const message = rest && rest.length > 2 && !/^(?:for me|please|now)[.!?]*$/i.test(rest) ? rest.replace(/[.!?]+$/, '').slice(0, 140) : '';
      return { kind: 'tell', to: 'lyra', message };
    }
    if (TEACH_RE.test(t)) return { kind: 'teach' };
    for (const re of GIVE_RE) {
      const m = t.match(re);
      if (!m) continue;
      const item = resolveItemId(String(m.groups?.item || '').replace(/\b(please|for the road)\b/gi, '').trim());
      if (item && ITEMS[item] && item !== 'coin') return { kind: 'give', item, qty: 1 };
    }
    return null;
  }

  // Was Lyra the one being talked about ("go to her")?
  lyraInTalk(npc, text) {
    if (/\blyra\b/i.test(text)) return true;
    const recent = safe(() => this.v.talks?.[npc.id]?.slice(-3), []) || [];
    return recent.some((x) => /\blyra\b/i.test(`${x.you || ''} ${(x.they || []).join(' ')}`));
  }

  // ------------------------------------------------------------------ can they, will they

  decide(npc, ask) {
    const id = npc.id;
    const st = safe(() => this.v.standing(id), {}) || {};
    const op = Number.isFinite(st.opinion) ? st.opinion : 40;
    const rng = this.game?.rng;
    const P = this.playerName();
    const cold = !!(st.cold || (st.grievance?.fresh && st.grievance?.grave));
    const out = { kind: ask.kind, can: true, will: true, why: '', line: '', plan: null };
    if (npc.dead || npc.downed || npc.state === 'sleep') return { ...out, can: false, will: false, why: 'they cannot right now' };
    // They watched the stranger kill (round 14b T-A1): they do nothing for them, and the
    // refusal is theirs to word, in fear.
    const fear = safe(() => this.game?.murder?.fearOf?.(npc), null);
    if (fear) return { ...out, will: false, fear, why: fear === 'terror' ? 'terror: you watched them kill, and you will do nothing they ask' : 'dread: you have seen them kill, and you will do nothing for them', line: '' };
    if (cold) {
      out.will = false;
      out.why = 'you hurt someone they love; they will do nothing for you';
      out.line = `${noWord(id, rng)} Not for you. Not after what you did.`;
      return out;
    }
    if (ask.kind === 'tell') {
      const L = this.game?.companion;
      if (!L || L.removed) return { ...out, can: false, will: false, why: 'Lyra is not in Hearthvale', line: `${noWord(id, rng)} Lyra's nowhere to be found, love.` };
      if (op < 25) return { ...out, will: false, why: 'they do not think well enough of you to run your errands', line: `${noWord(id, rng)} Run your own messages.` };
      const already = this.open(id).find((c) => c.kind === 'tell');
      if (already) return { ...out, will: true, why: 'they already promised to', line: `${yesWord(id, rng)} I said I would, and I will. I'll find Lyra when I'm free.`, plan: { kind: 'tell', message: ask.message || already.message, same: already.id } };
      // Out past the vale (round 14's roads): nobody walks to Brindlecombe with a message.
      out.line = this.lyraAway()
        ? `${yesWord(id, rng)} She's out past the vale just now. I'll tell her${ask.message ? ` what you said` : ' you want a word'} when she's back.`
        : `${yesWord(id, rng)} I'll find Lyra and tell her${ask.message ? ` what you said` : ' you want a word'}. When I'm free, mind.`;
      out.plan = { kind: 'tell', message: ask.message || '' };
      return out;
    }
    if (ask.kind === 'give') {
      const gives = GIVES[id] || {};
      const need = gives[ask.item];
      const thing = itemName(ask.item, 1).toLowerCase();
      if (need == null) return { ...out, can: false, will: false, why: `they have no ${thing} to give`, line: `${noWord(id, rng)} I've no ${thing} to give you.${Object.keys(GIVES[id] || {}).length ? '' : ''}` };
      const g = (this.gifts[id] && this.gifts[id].day === this.day()) ? this.gifts[id] : null;
      if (g && (g.n >= GIVE_CAP || g.items.includes(ask.item))) return { ...out, will: false, why: 'they already gave you something today', line: `${noWord(id, rng)} I gave you one already today. Tomorrow, maybe.` };
      if (op < need) return { ...out, will: false, why: `they do not think well enough of you (${Math.round(op)}/${need})`, line: `${noWord(id, rng)} That's for friends, and we're not there yet.` };
      const p = this.game?.player;
      if (!p || Math.hypot(p.x - npc.x, p.y - npc.y) > 9 * 16) return { ...out, can: false, why: 'you are too far away to hand it over', line: `Come closer and I'll give you one.` };
      out.line = `${yesWord(id, rng)} Here — ${ask.item === 'honey_cake' ? 'a honey cake, warm from the tin' : aThing(ask.item)}.`;
      out.plan = { kind: 'give', item: ask.item, qty: 1 };
      return out;
    }
    if (ask.kind === 'teach') return this.decideTeach(npc, out, op);
    return { ...out, can: false, will: false };
  }

  decideTeach(npc, out, op) {
    const id = npc.id;
    const rng = this.game?.rng;
    const mine = TEACHES[id] || [];
    const ms = this.game?.missions;
    if (!mine.length || !ms) {
      const who = Object.keys(TEACHES).filter((k) => k !== id && !safe(() => this.game?.murder?.isDead?.(k), false)).slice(0, 3);
      const names = who.map((k) => nameFirst(this.name(k)) || k);
      return { ...out, can: false, will: false, why: 'they know no weaving to teach', line: `${noWord(id, rng)} I've no weaving in me to teach.${names.length ? ` Ask ${names.slice(0, -1).join(', ')}${names.length > 1 ? ' or ' : ''}${names[names.length - 1]}.` : ''}` };
    }
    if (op < 30) return { ...out, will: false, why: 'they do not trust you with it yet', line: `${noWord(id, rng)} I don't know you well enough to teach you anything.` };
    let locked = null;
    for (const t of mine) {
      const status = ms.status(t.mission);
      const m = ms.get(t.mission);
      if (!m) continue;
      if (status === 'available') {
        out.line = `${yesWord(id, rng)} I'll teach you ${partText(t.parts[0])}. ${lessonWords(m)}`;
        out.plan = { kind: 'teach', mission: t.mission, part: t.parts[0] };
        return out;
      }
      if (status === 'active' || status === 'ready') {
        const obj = ms.objectiveText?.(t.mission) || ms.objective?.(t.mission)?.label || m.hint || '';
        return { ...out, will: true, can: true, why: 'the lesson has already begun', line: `${yesWord(id, rng)} We've already begun.${obj ? ` ${obj.charAt(0).toUpperCase()}${obj.slice(1).replace(/\.?$/, '.')}` : ''}`, plan: null };
      }
      if (status === 'locked' && !locked) locked = { t, m, missing: ms.missing(m) };
    }
    if (locked) {
      const when = locked.missing[0] || 'later';
      return { ...out, can: false, why: `not yet: ${when}`, line: `Not yet. Come back ${when.replace(/"([^"]+)"/g, '“$1”')}, and ask me then.` };
    }
    return { ...out, can: false, why: 'they have taught you all they know', line: `I've taught you all I have. The rest isn't mine to give.` };
  }

  // For Claude's brief: the ask, and what the game will allow.
  brief(npc, ask, dec) {
    if (!ask) return '';
    const what = ask.kind === 'tell' ? `go and talk to Lyra for them${ask.message ? ` (their message: "${ask.message}")` : ''}` : ask.kind === 'give' ? `give them ${itemName(ask.item, 1).toLowerCase()}` : 'teach them some weaving';
    if (!dec.can || !dec.will) return `They are asking you to ${what}. You will not or cannot: ${dec.why}. Say so plainly, in your own words, and set "commit" to {"kind": "${ask.kind}", "agree": false}.`;
    const how = ask.kind === 'tell' ? `if you agree, you will walk over to Lyra yourself when you are free and tell her; the game makes you do it${this.lyraAway() ? ". She is out past the vale just now (the wilds), so you will tell her when she is back, not go after her" : ''}` : ask.kind === 'give' ? 'if you agree, you hand it over right now' : `if you agree, the lesson starts now (${dec.plan?.mission ? 'your errand that teaches it' : 'a lesson'}); it is yours to give`;
    return `They are asking you to ${what}. You can: ${how}. Decide as yourself. If you agree, say so plainly and set "commit" to {"kind": "${ask.kind}", "agree": true}; if not, say why and set "agree": false. Never promise what you will not do.`;
  }

  // The answer given (local or Claude): a yes the game has checked becomes a commitment.
  // reply = { text, commit: {kind, agree}|null, source }  ->  { lines, made }
  settle(npc, ask, dec, reply = {}) {
    if (!ask) return { lines: null, made: null };
    const fromClaude = reply.source === 'claude';
    let agree;
    if (fromClaude) {
      const c = reply.commit;
      if (c && c.kind === ask.kind) agree = !!c.agree;
      else agree = looksLikeYes(reply.text) && !looksLikeNo(reply.text);
    } else agree = dec.can && dec.will;
    // Claude said yes to what cannot be done: the villager says plainly why not.
    if (agree && (!dec.can || !dec.will)) return { lines: [dec.line || `${noWord(npc.id, this.game?.rng)} I can't.`], made: null, overruled: true };
    if (!agree) return { lines: fromClaude ? null : [dec.line].filter(Boolean), made: null };
    const made = dec.plan ? this.make(npc, dec.plan) : null;
    return { lines: fromClaude ? null : [dec.line].filter(Boolean), made };
  }

  make(npc, plan) {
    const id = npc.id;
    const t = this.now();
    if (plan.same) {
      const c = this.list.find((x) => x.id === plan.same);
      if (c && plan.message && !c.message) c.message = plan.message;
      return c || null;
    }
    if (plan.kind === 'give') return this.giveNow(npc, plan.item, plan.qty || 1, { promised: true });
    if (plan.kind === 'teach') {
      const ms = this.game?.missions;
      const ok = !!safe(() => ms?.accept?.(plan.mission), false);
      const c = this.add({ by: id, kind: 'teach', to: 'player', mission: plan.mission, part: plan.part || null, state: ok ? 'doing' : 'broken', made: t, day: this.day(), due: t + 3 * DAY });
      if (ok) this.remember(npc, `I agreed to teach the stranger ${partText(plan.part)}, and we have begun.`);
      return c;
    }
    // tell: they will walk to Lyra when they are free.
    const c = this.add({ by: id, kind: 'tell', to: 'lyra', message: plan.message || '', state: 'open', made: t, day: this.day(), due: t + 1.5 * DAY });
    this.remember(npc, `I promised to go and talk to Lyra for the stranger.`);
    this.game?.bus?.emit?.('commitment', { by: id, kind: 'tell', state: 'open', text: c.text });
    return c;
  }

  add(c) {
    const full = { id: `c${++this.seq}`, text: describe(c, this), ...c };
    this.list.push(full);
    if (this.list.length > 40) this.list.splice(0, this.list.findIndex((x) => x.state !== 'open' && x.state !== 'doing') + 1 || 1);
    return full;
  }

  // ------------------------------------------------------------------ giving

  giveNow(npc, item, qty = 1, { promised = false } = {}) {
    const g = this.game;
    const p = g?.player;
    if (!p?.inventory?.add || !ITEMS[item]) return null;
    const id = npc.id;
    const day = this.day();
    const rec = this.gifts[id] && this.gifts[id].day === day ? this.gifts[id] : (this.gifts[id] = { day, n: 0, items: [] });
    if (rec.n >= GIVE_CAP || rec.items.includes(item)) return null;
    rec.n += 1;
    rec.items.push(item);
    p.inventory.add(item, qty);
    g.bus?.emit?.('item_gained', { actor: p, itemId: item, qty, from: 'gift', by: npc });
    g.bus?.emit?.('item_given', { from: npc, to: p, itemId: item, qty });
    this.remember(npc, `I gave the stranger ${itemName(item, qty).toLowerCase()}.`);
    const c = this.add({ by: id, kind: 'give', to: 'player', item, qty, state: 'kept', made: this.now(), day, due: null, kept: this.now() });
    if (promised) g.bus?.emit?.('commitment', { by: id, kind: 'give', state: 'kept', text: c.text });
    return c;
  }

  // "Take a honey cake for the road": an offer in what they just said is handed over too.
  offersIn(npc, lines) {
    const gives = GIVES[npc?.id];
    if (!gives || !Array.isArray(lines)) return [];
    const st = safe(() => this.v.standing(npc.id), {}) || {};
    const op = Number.isFinite(st.opinion) ? st.opinion : 40;
    const out = [];
    const text = lines.join(' ').toLowerCase().replace(/[’]/g, "'");
    for (const [item, need] of Object.entries(gives)) {
      const name = itemName(item, 1).toLowerCase();
      const re = new RegExp(`\\b(?:take|have|here'?s|here is|there's|try|eat)\\s+(?:a |an |some |this |one |another )?(?:\\w+\\s)?${name.replace(/\s+/g, '\\s+')}\\b`);
      if (!re.test(text) || op < Math.min(need, 35)) continue;
      const c = this.giveNow(npc, item, 1);
      if (c) out.push(c);
    }
    return out;
  }

  // ------------------------------------------------------------------ keeping them

  update(dt) {
    this._acc += dt;
    if (this._acc < 1) return;
    this._acc = 0;
    const t = this.now();
    // The clock jumped (the player slept till morning, at any hour since r13): nobody could
    // keep a promise in hours that were skipped, so an open one's day moves with the clock.
    const last = this._lastT;
    this._lastT = t;
    if (last != null && t - last > SKIP_GAP) {
      const skipped = t - last;
      for (const c of this.list) if ((c.state === 'open' || c.state === 'doing') && c.due != null) c.due += skipped;
    }
    for (const c of this.list) {
      if (c.state === 'kept' || c.state === 'broken') continue;
      if (c.kind === 'teach') {
        const s = safe(() => this.game?.missions?.status?.(c.mission), null);
        if (s === 'done') this.keep(c);
        else if (!s || s === 'available' || s === 'locked') this.breakIt(c, 'the lesson was set aside');
        continue;
      }
      if (c.kind !== 'tell') continue;
      // Lyra out past the vale (round 14: the King's Road, the Crown path): the message
      // waits for her to come home; nobody follows her into the wilds with it.
      const away = c.to === 'lyra' && this.lyraAway();
      if (c.due != null && t > c.due) {
        this.breakIt(c, away ? 'Lyra was away, out past the vale' : 'never found the time');
        continue;
      }
      if (away) {
        if (c.state === 'doing') this.stopWalk(c);
        continue;
      }
      if (c.state === 'open') this.tryStart(c);
      else if (c.state === 'doing' && !safe(() => this.game?.villageLife?.steps?.get?.(c.by), null) && t - (c.startedAt ?? t) > 5) {
        // The walk ended without the talk (they were interrupted): try again later.
        c.state = 'open';
        c.retryAt = t + 60;
      }
    }
  }

  // Is Lyra in the world but outside the vale's tiles (the wilds, round 14)?
  lyraAway() {
    const L = this.game?.companion;
    if (!L || L.removed || !Number.isFinite(L.x) || !Number.isFinite(L.y)) return false;
    return !inVale(Math.floor(L.x / TILE), Math.floor(L.y / TILE));
  }

  // A walk to Lyra given up while she is away: they go back to their day, the promise open.
  stopWalk(c) {
    const life = this.game?.villageLife;
    const e = this.game?.entities?.get?.(c.by);
    const step = safe(() => life?.steps?.get?.(c.by), null);
    if (e && step && step.kind === 'keep' && step.commit === c.id) safe(() => life.endStep(e));
    c.state = 'open';
    c.retryAt = this.now() + 30;
  }

  tryStart(c) {
    const g = this.game;
    const life = g?.villageLife;
    const e = g?.entities?.get?.(c.by);
    const L = g?.companion;
    if (!life?.keepPromise || !e || !L || L.removed) return;
    const t = this.now();
    if (c.retryAt && t < c.retryAt) return;
    if (e.dead || e.downed || e.state === 'sleep' || e.activity === 'sleep' || e.mode === 'flee') return;
    // Not while the player is still talking with them, or they with someone else.
    if ((e.talkingUntil ?? -Infinity) > (g.clock?.t ?? 0) || safe(() => this.v.isTalking?.(e), false)) return;
    if (L.state === 'sleep' || L.downed) return;
    if (safe(() => life.steps.get(e.id), null)) return;
    if (!safe(() => life.free?.(e), true)) return;
    const step = life.keepPromise(e, c);
    if (step) {
      c.state = 'doing';
      c.startedAt = t;
    }
  }

  // At Lyra's side: what they say, what she answers, and what it does to her.
  fulfil(cid, npc, target) {
    const c = this.list.find((x) => x.id === cid);
    if (!c || !npc || !target) return null;
    const P = this.playerName();
    const mind = target.mind;
    const msg = c.message ? `"${c.message}"` : '';
    const opener = msg ? `Lyra, love. ${P} asked me to find you and tell you: ${msg}.` : `Lyra. ${P} asked me to come and find you. They want a word with you.`;
    const said = opener.replace(/^Lyra, love\./, npc.id === 'elda' ? 'Lyra, love.' : 'Lyra.');
    let answer = null;
    try {
      answer = mind?.autonomy?.hearMessage?.({ from: npc.id, fromName: nameFirst(this.name(npc.id)), text: c.message || '', playerName: P }) || null;
    } catch (err) {
      console.error('[commitments] Lyra hearing the message failed', err);
    }
    const lines = [[npc.id, said]];
    if (answer?.line) lines.push(['lyra', answer.line]);
    return {
      lines,
      summary: `${this.name(npc.id)} told Lyra that ${P} ${c.message ? `said: ${c.message}` : 'wants a word with her'}.`,
      after: () => this.keep(c),
    };
  }

  keep(c) {
    if (c.state === 'kept') return;
    c.state = 'kept';
    c.kept = this.now();
    const e = this.game?.entities?.get?.(c.by);
    if (e) this.remember(e, c.kind === 'tell' ? 'I found Lyra and told her what the stranger asked, like I said I would.' : `I kept my word to the stranger: ${c.text}.`);
    this.game?.bus?.emit?.('commitment', { by: c.by, kind: c.kind, state: 'kept', text: c.text });
    const nm = nameFirst(this.name(c.by));
    // Said as done, not as a plan: "Elda talked to Lyra for you", not "Elda will go…".
    if (c.kind !== 'give') safe(() => this.game?.ui?.toast?.(doneText(c, this), 'good', { title: `${nm} kept their word`, key: `commit:${c.id}` }));
  }

  breakIt(c, why = '') {
    if (c.state === 'kept' || c.state === 'broken') return;
    c.state = 'broken';
    c.broken = this.now();
    c.why = why;
    const e = this.game?.entities?.get?.(c.by);
    // Both sides remember: they owe the player an apology, and the player is told.
    if (e) this.remember(e, `I promised the stranger I would ${c.text.replace(/^\S+ will /, '')}, and I didn't.`);
    const nm = nameFirst(this.name(c.by));
    this.game?.bus?.emit?.('commitment', { by: c.by, kind: c.kind, state: 'broken', text: c.text });
    safe(() => this.game?.ui?.toast?.(c.text, 'warn', { title: `${nm} didn't keep their word`, key: `commit:${c.id}` }));
  }

  // The first thing they say next time, if they owe the player an apology for it.
  owed(id) {
    return this.list.find((c) => c.by === id && c.state === 'broken' && !c.owned) || null;
  }

  // What they did or failed to do, in their own memory (their Claude brief reads it).
  remember(npc, text) {
    const id = npc?.id;
    if (!id) return;
    const list = (this.selfNotes[id] ||= []);
    list.push({ text: String(text).slice(0, 140), day: this.day() });
    if (list.length > 6) list.shift();
  }

  // For their brief: their promises to the player, kept, broken and open.
  promptFor(id) {
    const out = [];
    for (const c of this.list.filter((x) => x.by === id).slice(-4)) out.push(`${c.state === 'open' || c.state === 'doing' ? 'You promised' : c.state === 'kept' ? 'You kept your word' : 'You broke your word'}: ${c.text.replace(/^\S+ (will |gave )/, (m, w) => (w === 'gave ' ? 'gave ' : ''))}${c.state === 'broken' && c.why ? ` (${c.why})` : ''}.`);
    for (const n of (this.selfNotes[id] || []).slice(-2)) out.push(n.text);
    return out;
  }

  serialize() {
    return {
      seq: this.seq,
      list: this.list.slice(-30).map((c) => ({ ...c })),
      gifts: this.gifts,
      self: this.selfNotes,
    };
  }

  deserialize(d) {
    this._lastT = null; // a loaded clock is no skip
    if (!d || typeof d !== 'object') return;
    this.seq = Number(d.seq) || 0;
    this.list = Array.isArray(d.list) ? d.list.filter((c) => c && c.id && c.kind).map((c) => ({ ...c, state: c.state === 'doing' && c.kind === 'tell' ? 'open' : c.state })) : [];
    this.gifts = d.gifts && typeof d.gifts === 'object' ? d.gifts : {};
    this.selfNotes = d.self && typeof d.self === 'object' ? d.self : {};
  }
}

function describe(c, cm) {
  const n = nameFirst(cm.name(c.by)) || c.by;
  if (c.kind === 'tell') return `${n} will go and talk to Lyra for you${c.message ? `: "${c.message}"` : ''}`;
  if (c.kind === 'give') return `${n} gave you ${(c.qty || 1) > 1 ? itemName(c.item, c.qty).toLowerCase() : aThing(c.item)}`;
  if (c.kind === 'teach') return `${n} will teach you ${partText(c.part)}`;
  return `${n} promised`;
}

// What the lesson asks, in the teacher's words: the errand's offer, without a greeting
// that would follow the yes ("Hmph. Fine. I'll teach you… Hmph. You again. Good.").
function lessonWords(m) {
  const lines = (Array.isArray(m?.offer) && m.offer.length ? m.offer : [m?.summary || '']).map((x) => String(x || '').trim()).filter(Boolean);
  const body = lines.length > 1 && lines[0].length <= 30 ? lines.slice(1) : lines;
  return body.slice(0, 2).join(' ');
}

// A kept commitment, in the past tense.
function doneText(c, cm) {
  const n = nameFirst(cm.name(c.by)) || c.by;
  if (c.kind === 'tell') return `${n} found Lyra and talked to her for you${c.message ? `: "${c.message}"` : ''}`;
  if (c.kind === 'teach') return `${n} taught you ${partText(c.part)}`;
  return c.text;
}

export function looksLikeYes(text) {
  return /\b(?:i'?ll|i will|i shall|all right|alright|very well|of course|gladly|yes|aye|right you are|consider it done|leave it (?:to|with) me|i can do that|here(?:'s| is| you are))\b/i.test(String(text || ''));
}

export function looksLikeNo(text) {
  return /\b(?:no\b|not (?:for you|now|today|after)|i won'?t|i can'?t|i cannot|i'?ve no|ask someone else|run your own)\b/i.test(String(text || ''));
}

export { clamp };
