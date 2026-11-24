import { PLAYER_ID } from '../../core/constants.js';
import { normalizeTag, bondOf } from '../mind/relationships.js';
import { resolvePerson, opinionAnswer, playerAnswer, friendsAnswer, relLine, firstPerson, closedAbout } from '../mind/voice.js';
import { clamp, firstName, cap, pick, shorten, isChild, playerRef } from '../mind/text.js';

// Relationships plugin (mind): who Lyra counts as friend or enemy, notes she keeps
// about people, and what she thinks of them. The store itself is mind.relationships.

const TAG_WORDS = 'friends?|enem(?:y|ies)|allies|ally|foes?|pets?|family|rivals?|crush';
const WHO = "[\\w' -]+?";

// Someone who has given her cause: an attack, a theft, a lie in their history or notes.
function hasGrievance(rel) {
  if (!rel) return false;
  if (rel.affinity <= -20) return true;
  const text = [...(rel.history || []), ...(rel.notes || []).map((n) => n.text)].join(' ');
  return /attack|raised a hand|hurt|stole|robbed|lied|betray|killed/i.test(text);
}

function article(tag) {
  return /^[aeiou]/.test(tag) ? 'an' : 'a';
}

function setRelationship(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const who = resolvePerson(ctx, args.target);
  if (!who) return { ok: false, message: args.target ? `I don't know who "${args.target}" is.` : 'Who do you mean?' };
  let raw = args.value ? String(args.value).trim().toLowerCase() : '';
  let remove = false;
  if (/^[-!]|^(not|no longer|un)\b/.test(raw)) {
    remove = true;
    raw = raw.replace(/^[-!]\s*|^(not|no longer|un)\s*/, '');
  }
  const tag = raw ? normalizeTag(raw) : null;
  const delta = Number.isFinite(args.amount) ? clamp(args.amount, -20, 20) : null;
  if (!tag && delta == null) return { ok: false, message: 'Tell me how you want me to see them. Friend? Enemy? Something else?' };
  const rels = mind.relationships;
  const P = playerRef(ctx.game);

  if (who.self) return { ok: false, message: "I'm on my own side, thanks." };
  if (who.player) {
    if (tag === 'enemy' && !remove) return { ok: false, message: 'You? Never. Not even if you ask nicely.' };
    if (delta) rels.adjust(PLAYER_ID, { affinity: delta }, 'You asked');
    if (tag && tag !== 'enemy') rels.setTag(PLAYER_ID, tag, !remove);
    return { ok: true, message: tag === 'friend' && !remove ? "We're well past needing a label for that, I hope." : 'Noted. Strange thing to ask, but noted.' };
  }

  if (who.group) {
    const gk = who.group.key;
    if (tag === 'enemy' && !remove && (who.group.faction === 'villager' || who.group.faction === 'guard')) {
      return { ok: false, message: "I'm not turning on the whole village. Not for anyone. Not for you." };
    }
    if (tag === 'enemy' && !remove && who.group.species === 'cat') return { ok: false, message: 'Cats? Pip would never forgive me. Neither would I.' };
    const rel = rels.ensure(gk, { name: who.group.name, kind: 'group', faction: who.group.faction || null });
    rel.kind = 'group';
    if (tag) rels.setTag(gk, tag, !remove);
    if (delta) rels.adjust(gk, { affinity: delta }, `${P} asked`);
    const label = tag === 'enemy' ? 'enemies' : tag === 'friend' ? 'friends' : tag || 'different now';
    rels.addNote(gk, `${cap(P)} told me ${who.group.name.toLowerCase()} are ${remove ? 'not ' : ''}${label}.`, 'player');
    const hostile = ['bandit', 'monster', 'undead'].includes(who.group.faction) || who.group.species === 'wolf' || who.group.species === 'slime';
    if (tag === 'enemy' && !remove) return { ok: true, message: pick([`${who.group.name} are enemies, then. I'll treat them that way.`, `Understood. ${who.group.name} get no mercy from me.`], ctx.game?.rng) };
    if (tag === 'friend' && !remove && hostile) return { ok: true, message: `Fine. I won't start anything with ${who.group.name.toLowerCase()}. I'm not turning my back on them, either.` };
    if (tag === 'friend' && !remove) return { ok: true, message: `${who.group.name} are friends. Nobody touches them while I'm around.` };
    return { ok: true, message: remove ? `All right. ${who.group.name} get a clean slate.` : `Noted. ${who.group.name}: ${tag}.` };
  }

  const ent = who.entity;
  const rel = who.rel || (ent ? rels.ensure(ent) : null);
  if (!rel) return { ok: false, message: `I don't know enough about ${who.name} to have feelings either way.` };
  const n = firstName(rel.name);
  if (tag === 'enemy' && !remove) {
    if (rel.id === 'maren') return { ok: false, message: 'Maren? Never. Not in a thousand years.' };
    if (isChild(ent, rel)) return { ok: false, message: `${n}? ${n} is a child. No. Don't ask me again.` };
    if (rel.tags.includes('pet') || ent?.species === 'cat') return { ok: false, message: `${n === 'Cat' ? 'The cat' : n}? Absolutely not.` };
    const villager = rel.npc || ['villager', 'guard'].includes(ent?.faction) || ['villager', 'guard'].includes(rel.faction);
    if (villager && !hasGrievance(rel)) {
      return { ok: false, message: `${n} has done nothing to deserve that. If that changes, I'll be the first to know.` };
    }
  }
  if (tag) rels.setTag(rel.id, tag, !remove);
  if (tag === 'enemy' && !remove) rels.adjust(rel.id, { affinity: -10, trust: -10 }, `${P} named them an enemy`);
  if (tag === 'friend' && !remove) rels.adjust(rel.id, { affinity: 5, trust: 3 }, `${P} vouched for them`);
  if (delta) rels.adjust(rel.id, { affinity: delta }, `${P} asked`);
  if (tag) rels.addNote(rel.id, `${cap(P)} told me ${n} is ${remove ? 'no longer ' : ''}${article(tag)} ${tag}.`, 'player');
  let msg;
  if (remove) msg = tag === 'enemy' ? `${n} gets a clean slate, then.` : `Noted. ${n} is no longer ${article(tag)} ${tag}.`;
  else if (tag) {
    msg =
      {
        friend: `${n} is a friend. Nobody touches ${n} while I'm around.`,
        enemy: `${n}'s an enemy, then. I'll keep my eyes on them.`,
        pet: `${n} is ours now. I'm going to spoil them rotten.`,
        rival: `A rival? ${n}? Oh, this will be fun.`,
        crush: "I'm sure I don't know what you mean. ...Keep your voice down.",
        family: `Family. That's a big word. ...I'll hold ${n} to it.`,
      }[tag] || `${n}: ${tag}. Noted.`;
  } else msg = `Noted. I'll think of ${n} ${delta > 0 ? 'more kindly' : 'less kindly'}.`;
  return { ok: true, message: msg };
}

function noteAbout(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const text = String(args.value || '').trim();
  if (!text) return { ok: false, message: 'What should I note?' };
  const who = resolvePerson(ctx, args.target);
  if (!who || who.self) return { ok: false, message: args.target ? `Who is "${args.target}"?` : 'About whom?' };
  const id = who.player ? PLAYER_ID : who.group ? who.group.key : who.id;
  if (who.group) mind.relationships.ensure(id, { name: who.group.name, kind: 'group' }).kind = 'group';
  else if (who.entity) mind.relationships.ensure(who.entity);
  const note = mind.relationships.addNote(id, text, 'player');
  if (!note) return { ok: false, message: "I couldn't make sense of that." };
  state(ctx.game).lastNote = note;
  mind.remember(`About ${who.player ? playerRef(ctx.game) : who.name}: ${text.replace(/[.!]?$/, '.')}`, { importance: 4, about: [id], tags: ['note'], type: 'fact' });
  return { ok: true, message: pick([`Noted. ${shorten(text, 80).replace(/[.!]?$/, '.')}`, "I'll remember that about them.", 'Written on the inside of my skull. Noted.'], ctx.game?.rng) };
}

const STATE = new WeakMap();
function state(game) {
  const key = game || STATE;
  let s = STATE.get(key);
  if (!s) STATE.set(key, (s = { lastNote: null }));
  return s;
}

export const relationshipsPlugin = {
  id: 'relationships',
  name: 'Relationships',
  description: 'Who Lyra counts as friend or enemy, what she thinks of people, and the notes she keeps on them.',

  actions: {
    set_relationship: {
      description:
        'Change how Lyra regards someone. Friends are never attacked in attack mode; enemies are. She refuses to make enemies of children, pets or villagers who have done nothing wrong.',
      params: {
        target: "who: a name, 'me', or a kind of creature ('the bandits', 'wolves', 'deer')",
        value: "tag: friend, enemy, rival, crush, family or pet; prefix '-' to remove ('-enemy')",
        amount: 'affinity change, -20..20 (optional)',
      },
      run: setRelationship,
    },
    note_about: {
      ungated: true, // asks nothing of her (DESIGN §16.4)
      description: 'Add a note about a person to what Lyra knows of them.',
      params: { target: 'who', value: 'the note text' },
      run: noteAbout,
    },
  },

  onEvent(type, p, ctx) {
    // Notes Claude writes are Lyra's own thoughts, not something the player told her.
    if (type === 'companion_action' && p?.name === 'note_about') {
      const s = state(ctx.game);
      if (s.lastNote && (p.source === 'claude' || p.source === 'self')) s.lastNote.source = 'self';
      s.lastNote = null;
    }
  },

  intents: [
    {
      id: 'rel.player',
      examples: ['do you like me?', 'do you trust me?', 'are we friends?', 'what am I to you?', 'how do you feel about me?', 'what do you think of me?', 'do you love me?'],
      patterns: [
        /\bdo you (?<verb>like|trust|love|care about|care for) me\b/i,
        /\bare (?:we|you and i|you and me) (?<verb>friends|close)\b/i,
        /\bwhat am i to you\b/i,
        /\bhow do you feel about (?:me|us)\b/i,
        /\bwhat do you (?:think|make) (?:of|about) (?:me|us)\b/i,
      ],
      confidence: 0.9,
      answer(m, ctx) {
        const v = (m.groups?.verb || '').toLowerCase();
        // "What do you think of me?" / "how do you feel about me?" / "what am I to you?" ask for
        // her opinion, not a yes or no.
        const verb = v.startsWith('trust') ? 'trust' : v.startsWith('love') ? 'love' : v === 'friends' || v === 'close' ? 'friends' : v ? 'like' : 'think';
        return playerAnswer(ctx, verb);
      },
    },
    {
      id: 'rel.mark',
      examples: ['Bram is my friend', 'mark the bandits as enemies', 'the cat is our pet', 'treat Garrick as a friend', 'wolves are our enemies', 'Rowan is not an enemy', 'Garrick is no longer my friend'],
      patterns: [
        new RegExp(`\\bmark (?<who>${WHO}) as (?:an? |my |our )?(?<tag>${TAG_WORDS})\\b`, 'i'),
        new RegExp(`\\b(?:treat|consider|count) (?<who>${WHO}) as (?:an? |my |our )?(?<tag>${TAG_WORDS})\\b`, 'i'),
        new RegExp(
          `^(?:and |also |so |well,? )?(?!you\\b|i\\b|we\\b|lyra\\b|it\\b|that\\b|this\\b|there\\b|he\\b|she\\b|they\\b|what\\b|who\\b)(?<who>${WHO}) (?:is|are|'s|'re) (?<neg>not |no longer |never )?(?:my |our |a |an |your )?(?:good |best |dear |new |sworn |true )?(?<tag>${TAG_WORDS})\\b`,
          'i',
        ),
        new RegExp(`^(?!you\\b|i\\b|we\\b|lyra\\b|it\\b|that\\b|this\\b|they\\b)(?<who>${WHO}) (?:isn't|aren't) (?:my |our |a |an )?(?<negtag>${TAG_WORDS})\\b`, 'i'),
      ],
      command: true,
      confidence: 0.9,
      actions(m) {
        const g = m.groups || {};
        const remove = !!(g.neg || g.negtag);
        const tag = normalizeTag(g.tag || g.negtag);
        return [{ name: 'set_relationship', args: { target: String(g.who).trim(), value: `${remove ? '-' : ''}${tag}`, amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
    {
      id: 'rel.opinion',
      examples: ['what do you think of Mira?', 'what do you make of Bram?', 'how do you feel about Garrick?', "what's your opinion of Rowan?", 'do you like Tobias?', 'thoughts on Elda?'],
      patterns: [
        new RegExp(`\\bwhat do you (?:think|make) (?:of|about) (?<who>${WHO})\\s*\\??$`, 'i'),
        new RegExp(`\\bhow do you feel about (?<who>${WHO})\\s*\\??$`, 'i'),
        new RegExp(`\\bwhat(?:'s| is) your (?:opinion|take|impression|read) (?:of|on|about) (?<who>${WHO})\\s*\\??$`, 'i'),
        new RegExp(`\\bdo you (?:like|trust|love|hate|dislike) (?!me\\b|us\\b|it\\b|that\\b|this\\b|the weather\\b|being\\b|to\\b)(?<who>${WHO})\\s*\\??$`, 'i'),
        new RegExp(`^(?:your )?thoughts on (?<who>${WHO})\\s*\\??$`, 'i'),
      ],
      confidence: 0.85,
      answer(m, ctx) {
        return opinionAnswer(ctx, String(m.groups?.who || '').trim());
      },
    },
    {
      id: 'rel.circle',
      examples: ['who are your friends?', 'who do you trust?', 'who are our enemies?', "who don't you like?", "who's your best friend?"],
      patterns: [
        /\bwho (?:are|is) (?:your|our) (?<kind>friends?|enem(?:y|ies)|favou?rites?)\b/i,
        /\bwho do you (?<kind>like|trust|dislike|hate|not like)\b/i,
        /\bwho (?:don't|do not) you (?<kind>like|trust)\b/i,
        /\bwho(?:'s| is) your (?:best|closest) friend\b/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        const k = (m.groups?.kind || 'friends').toLowerCase();
        const negated = /don't|do not/i.test(m[0]);
        if (/enem/.test(k)) return friendsAnswer(ctx, 'enemies');
        if (negated || /dislike|hate|not like/.test(k)) return friendsAnswer(ctx, 'dislike');
        if (k === 'trust') return friendsAnswer(ctx, 'trust');
        return friendsAnswer(ctx, 'friends');
      },
    },
    {
      id: 'rel.about',
      examples: ['who is Aveline?', 'tell me about Bram', "who's Garrick?"],
      patterns: [
        new RegExp(`^(?:so |and |hey,? )?(?:who(?:'s| is| was)|tell me about) (?!maren\\b|your\\b|yourself\\b|you\\b|me\\b|the\\b|this\\b|that\\b|it\\b|cal\\b|my\\b|a\\b|an\\b|there\\b|here\\b|going\\b|coming\\b)(?<who>${WHO})\\s*\\??$`, 'i'),
      ],
      confidence: 0.8,
      answer(m, ctx) {
        const ref = String(m.groups?.who || '').trim();
        const who = resolvePerson(ctx, ref);
        if (!who) {
          // Someone she only knows of (family, people in stories she has heard).
          const d = ctx.mind?.dossier?.(ref);
          if (!d || d.met) return null;
          const closed = closedAbout(ctx.mind, d.id);
          if (closed) return closed;
          return shorten(`${firstName(d.name)}${d.role ? `, ${String(d.role).replace(/^lyra's /i, 'my ')}` : ''}. ${firstPerson(d.lore || '', ctx.mind.name)}`, 420);
        }
        if (who.group) return null;
        if (who.player) return playerAnswer(ctx, 'think');
        if (who.self) return null;
        const rel = who.rel;
        const n = firstName(who.name);
        const role = who.entity?.profile?.role || who.entity?.role || rel?.role;
        // "Captain of the watch", "scribe in Saltmere": lower the first letter, keep the names.
        const roleText = role ? String(role).replace(/^the /i, '').replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) : '';
        if (!rel || rel.firstMet == null) {
          // Someone she has never met but knows of (Varek One-Eye): what the valley says.
          const d = ctx.mind?.dossier?.(who.id || ref);
          if (d?.lore) return shorten(`${n}? I know only what the valley says. ${firstPerson(d.lore, ctx.mind.name)}`, 420);
          if (!who.entity) return null;
          return `${n}? ${roleText ? `The ${roleText}, I'm told. ` : ''}We haven't met properly yet.`;
        }
        const facts = rel.notes
          .filter((x) => x.source !== 'self')
          .slice(-2)
          .map((x) => x.text.replace(/[.!]?$/, '.'));
        return shorten(`${n}${roleText ? `, the ${roleText}` : ''}. ${rel.opinion || ''}${facts.length ? ` ${facts.join(' ')}` : ''}`, 420);
      },
    },
    {
      id: 'rel.note',
      examples: ['make a note about Bram: he likes iron ore', 'note about Mira: she is sweet on Rowan'],
      patterns: [new RegExp(`\\b(?:make |add |take )?(?:a )?note (?:about|on) (?<who>${WHO})\\s*[:,-]\\s*(?<text>.{3,})$`, 'i')],
      command: true,
      confidence: 0.9,
      actions(m) {
        return [{ name: 'note_about', args: { target: m.groups.who.trim(), value: m.groups.text.trim(), amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
  ],

  // Who is nearby or mentioned and what she makes of them.
  promptContext(ctx, query = '') {
    const mind = ctx.mind;
    if (!mind) return '';
    const g = ctx.game;
    const o = ctx.companion;
    const rels = mind.relationships;
    const lines = [];
    const pr = rels.get(PLAYER_ID);
    if (pr) lines.push(`Player (${pr.name}): ${bondOf(pr).label}; affinity ${Math.round(pr.affinity)}, trust ${Math.round(pr.trust)}, respect ${Math.round(pr.respect)}, familiarity ${Math.round(pr.familiarity)}.`);
    const seen = new Set([PLAYER_ID]);
    const { people } = mind.resolveQuery(query);
    for (const id of people) {
      const r = rels.get(id);
      if (r && !seen.has(id)) {
        seen.add(id);
        lines.push(`Mentioned: ${relLine(r)}`);
      }
    }
    const near = [];
    for (const e of g?.entities?.all?.() || []) {
      if (!o || e === o || e.type !== 'actor' || e.removed || e.dead || seen.has(e.id)) continue;
      const d = Math.hypot(e.x - o.x, e.y - o.y);
      if (d > 170) continue;
      const r = rels.map.get(e.id);
      if (r) near.push([d, r]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, r] of near.slice(0, 3)) {
      seen.add(r.id);
      lines.push(`Nearby: ${relLine(r)}`);
    }
    const groups = rels.all().filter((r) => r.kind === 'group' && r.tags.length);
    if (groups.length) lines.push(`Kinds: ${groups.map((r) => `${r.name} = ${r.tags.join('/')}`).join('; ')}.`);
    const close = rels
      .people()
      .filter((r) => !seen.has(r.id) && r.firstMet != null && bondOf(r).level >= 3)
      .slice(0, 3);
    if (close.length) lines.push(`Close to: ${close.map((r) => `${firstName(r.name)} (${bondOf(r).label})`).join(', ')}.`);
    let out = lines.join('\n');
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },
};
