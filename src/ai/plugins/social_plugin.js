import { resolvePerson } from '../mind/voice.js';
import { localConversation, animalTalk, toSecondPerson } from '../mind/conversation.js';
import { lineDuration } from '../mind/mind.js';
import { clamp, firstName, pick, shorten, firstSentence, lowerFirst, cap, placePhrase, normName, isNamedCreature } from '../mind/text.js';

// Social plugin (mind): talk_to. Lyra walks over to someone (a goto directive that ends
// in follow), turns to them and talks: through Claude when it is available and the
// player asked for the talk, otherwise from the villager's profile and the lore they
// know. She learns facts and lore, the relationship moves, she remembers it, the
// `conversation` event goes out, and she goes back to what she was doing.

const REACH = 30; // px: close enough to talk
const WALK_TIMEOUT = 60; // s to get there before giving up
const THINK_TIMEOUT = 12; // s to wait for Claude before talking from her own head

const STATE = new WeakMap();
function state(game) {
  const key = game || STATE;
  let s = STATE.get(key);
  if (!s) STATE.set(key, (s = { pending: null, talk: null, t: 0 }));
  return s;
}

function rt(ctx) {
  return ctx.mind?.perception?.rt?.() ?? ctx.game?.time ?? 0;
}

function dist(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
}

function copyDirective(d) {
  if (!d || typeof d !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(d));
  } catch {
    return { ...d };
  }
}

function setDirective(ctx, d) {
  try {
    return ctx.behavior?.setDirective?.(d) || null;
  } catch (err) {
    console.error('[social] setDirective failed', err);
    return null;
  }
}

function topicKey(topic) {
  const t = normName(topic);
  if (!t) return null;
  if (/\bmaren\b|teacher|mentor/.test(t)) return 'maren';
  return t.split(' ').slice(0, 4).join(' ');
}

function talkTo(args, ctx) {
  const mind = ctx.mind;
  const o = ctx.companion;
  if (!mind || !o) return { ok: false, message: '' };
  if (!args.target) return { ok: false, message: 'Talk to whom?' };
  const who = resolvePerson(ctx, args.target);
  if (!who) return { ok: false, message: `I don't know anyone called "${args.target}".` };
  if (who.player) return { ok: false, message: "I'm right here. Talk to me." };
  if (who.self) return { ok: false, message: 'I talk to myself plenty already, thank you.' };
  if (who.group) return { ok: false, message: `All the ${who.group.name.toLowerCase()} at once? Pick one.` };
  const e = who.entity || ctx.game?.entities?.get?.(who.id) || null;
  if (!e) {
    if (who.id === 'maren' || who.rel?.absent) return { ok: false, message: 'If only I could.' };
    return { ok: false, message: `I don't see ${firstName(who.name)} anywhere near.` };
  }
  if (e.dead || e.removed) return { ok: false, message: `${firstName(e.name)}... no. Not anymore.` };
  if (e.downed) return { ok: false, message: `${firstName(e.name)} is down. Talking can wait.` };
  if (e.type !== 'actor') return { ok: false, message: "That isn't someone I can talk to." };
  const s = state(ctx.game);
  if (s.talk) return { ok: false, message: "Let me finish this conversation first." };
  const topic = args.value ? String(args.value).trim().slice(0, 80) : null;
  const prev = s.pending?.prev ?? copyDirective(ctx.behavior?.directive);
  s.pending = { id: e.id, topic, prev, t0: rt(ctx), source: 'local', directive: null };
  const n = firstName(e.name);
  if (dist(o, e) <= REACH) return { ok: true, message: topic ? `Let me ask ${n}.` : '' };
  const d = { type: 'goto', target: e.id, then: 'follow' };
  const r = setDirective(ctx, d);
  if (r && r.ok === false) {
    s.pending = null;
    return { ok: false, message: r.message || `I can't get to ${n} from here.` };
  }
  s.pending.directive = ctx.behavior?.directive || d;
  const msg = topic
    ? topicKey(topic) === 'maren'
      ? pick([`I'll ask ${n} about Maren.`, `${n} might know something about Maren. I'll ask.`], ctx.game?.rng)
      : pick([`I'll ask ${n} about ${topic}.`, `Good question for ${n}. Back in a bit.`], ctx.game?.rng)
    : pick([`I'll go say hello to ${n}.`, `Off to bother ${n}. Back soon.`, `${n}? Gladly.`], ctx.game?.rng);
  return { ok: true, message: msg };
}

// ---------------------------------------------------------------- the conversation

// Lore the villager knows and she does not, voiced as two lines, plus clues they hold.
function loreLines(ctx, npc, topic, rel) {
  const mind = ctx.mind;
  const out = { lines: [], entries: [] };
  const entries = mind.loreFrom(npc.id, { topic, familiarity: rel?.familiarity ?? 0, limit: topic ? 2 : 1 });
  const n = firstName(npc.name);
  for (const e of entries) {
    if (e.kind === 'person' && (e.npcId === npc.id || e.id === npc.id)) continue; // nobody recites their own reputation
    const first = firstSentence(e.text, 170);
    const aboutSelf = new RegExp(`\\b${n.replace(/[^a-z]/gi, '')}\\b`, 'i').test(first);
    if (aboutSelf) {
      const second = toSecondPerson(first, npc);
      out.lines.push({ speaker: 'npc', text: pick(["Here's a thing most folk don't know.", 'Well. Since you ask.', 'You may as well hear it from me.'], ctx.game?.rng) });
      out.lines.push({ speaker: 'lyra', text: `${cap((second || first).replace(/[.!]+$/, ''))}? I'd never have guessed.` });
    } else {
      out.lines.push({ speaker: 'lyra', text: pick([`What can you tell me about ${lowerFirst(e.title)}?`, `${n}, what do you know about ${lowerFirst(e.title)}?`], ctx.game?.rng) });
      out.lines.push({ speaker: 'npc', text: shorten(e.text, 220) });
    }
    out.entries.push(e);
  }
  return out;
}

function buildLocal(ctx, npc, topic) {
  const mind = ctx.mind;
  if (npc.species && !npc.profile) return { ...animalTalk(mind, npc), lore: [] };
  const conv = localConversation(mind, npc, topic);
  const rel = mind.relationships.get(npc.id);
  const lore = loreLines(ctx, npc, topic, rel);
  if (lore.lines.length) {
    // Before her closing line.
    const at = conv.lines.length && conv.lines[conv.lines.length - 1].speaker === 'lyra' ? conv.lines.length - 1 : conv.lines.length;
    conv.lines.splice(at, 0, ...lore.lines);
  }
  return { ...conv, lore: lore.entries };
}

function startTalk(ctx, npc, pend) {
  const s = state(ctx.game);
  const o = ctx.companion;
  s.pending = null;
  try {
    o.faceToward?.(npc.x, npc.y);
    npc.faceToward?.(o.x, o.y);
  } catch {
    /* facing is cosmetic */
  }
  // Stand still while talking.
  setDirective(ctx, { type: 'stay', x: o.x, y: o.y });
  const talk = { npc, topic: pend.topic, prev: pend.prev, source: pend.source, lines: null, queue: [], played: [], wait: 0, started: rt(ctx), result: null, thinking: false };
  s.talk = talk;
  const brain = ctx.game?.brain;
  const useClaude = pend.source === 'player' && !!npc.profile && typeof brain?.generateConversation === 'function' && safeBool(() => brain.llmAvailable?.());
  if (useClaude) {
    talk.thinking = true;
    try {
      ctx.game?.bubbles?.icon?.(o, '...');
    } catch {
      /* cosmetic */
    }
    Promise.resolve()
      .then(() => brain.generateConversation(npc, pend.topic))
      .then((r) => {
        if (s.talk !== talk || !talk.thinking) return;
        talk.thinking = false;
        const lines = Array.isArray(r?.lines) ? r.lines.filter((l) => l && l.text).slice(0, 10) : [];
        if (!lines.length) return begin(ctx, talk, buildLocal(ctx, npc, pend.topic));
        const learned = Array.isArray(r.learned) ? r.learned.filter(Boolean).map((x) => (typeof x === 'string' ? { text: x, about: null } : x)) : [];
        begin(ctx, talk, { lines: lines.map((l) => ({ speaker: l.speaker === 'lyra' ? 'lyra' : 'npc', text: String(l.text) })), learned, affinity: Number(r.affinity) || 2, topic: pend.topic, lore: [], claude: true });
      })
      .catch((err) => {
        console.error('[social] conversation failed', err);
        if (s.talk === talk && talk.thinking) {
          talk.thinking = false;
          begin(ctx, talk, buildLocal(ctx, npc, pend.topic));
        }
      });
  } else {
    begin(ctx, talk, buildLocal(ctx, npc, pend.topic));
  }
}

function safeBool(fn) {
  try {
    return !!fn();
  } catch {
    return false;
  }
}

function begin(ctx, talk, result) {
  talk.result = result;
  talk.queue = [...(result.lines || [])];
  talk.wait = 0.2;
}

// One line at a time, each after the last has been read.
function playLine(ctx, talk, line) {
  const mind = ctx.mind;
  const npc = talk.npc;
  const g = ctx.game;
  const text = String(line.text || '').trim();
  if (!text) return 0;
  if (line.speaker === 'lyra') {
    mind.say(text, { target: npc, kind: 'say' });
  } else if (typeof npc.say === 'function') {
    try {
      npc.say(text, { kind: 'say' });
    } catch (err) {
      console.error('[social] npc.say failed', err);
    }
  } else {
    try {
      g?.bubbles?.say?.(npc, text, { kind: 'say', duration: lineDuration(text) });
    } catch {
      /* cosmetic */
    }
    g?.bus?.emit?.('speech', { speaker: npc, text, target: ctx.companion, kind: 'say' });
  }
  talk.played.push({ speaker: line.speaker === 'lyra' ? ctx.companion?.id || 'lyra' : npc.id, name: line.speaker === 'lyra' ? mind.name : npc.name, text });
  try {
    if (g?.ui?.chat?.isOpen?.()) g.ui.chat.addMessage({ from: line.speaker === 'lyra' ? 'lyra' : 'npc', text, name: line.speaker === 'lyra' ? mind.name : firstName(npc.name) });
  } catch {
    /* the chat is optional */
  }
  return lineDuration(text) + 0.35;
}

// Everything the conversation changes: what she knows, what she thinks of them, what she
// remembers. Exported for tests.
export function applyConversation(ctx, npc, result, { topic = null } = {}) {
  const mind = ctx.mind;
  if (!mind || !npc) return null;
  const rels = mind.relationships;
  const rel = rels.ensure(npc);
  const now = ctx.game?.clock?.t ?? 0;
  if (rel.firstMet == null) rel.firstMet = now;
  rel.lastSeen = now;
  rel.interactions = (rel.interactions || 0) + 1;
  const n = firstName(npc.name);
  const learned = [];
  if (!result?.animal) {
    for (const item of result?.learned || []) {
      const text = String(item?.text ?? item ?? '').trim();
      if (!text) continue;
      const about = item?.about && item.about !== npc.id ? String(item.about) : npc.id;
      const subject = about === 'maren' ? 'Maren Ashgrove' : rels.get(about)?.name || npc.name;
      mind.learn(subject, text, { kind: 'fact', source: 'told', from: npc.id, about: [about] });
      if (about === 'maren' || rels.get(about)) rels.addNote(about, text, 'told');
      learned.push(text);
    }
    for (const e of result?.lore || []) {
      if (mind.learnLore(e, { source: 'told', from: npc.id })) learned.push(e.text);
    }
    // Their public face, she learns by meeting them; clues, by asking the right questions.
    for (const e of mind.lorebook?.forPerson?.(npc.id) || []) if (e.kind === 'person' && !mind.knowsLore(e)) mind.learnLore(e, { source: 'observed' });
    const tk = topicKey(topic);
    if (tk === 'maren' || /ruin|gate|waygate|key|north|lantern/.test(tk || '') || rel.familiarity >= 30) {
      for (const k of mind.learnClues(npc.id, 'told', npc.id)) learned.push(k.text);
    }
  }
  const aff = clamp(Number(result?.affinity) || 2, -5, 6);
  rels.adjust(npc.id, { affinity: aff, familiarity: result?.animal ? 2 : 4 + Math.min(3, learned.length * 1.5), trust: result?.animal ? 0 : 1 }, topic ? `Talked about ${shorten(topic, 30)}` : 'We talked');
  mind.needsEngine.satisfy('social', result?.animal ? 0.05 : 0.15);
  mind.needsEngine.satisfy('fun', 0.03);
  mind.appraise('social', 1, `talking with ${n}`);
  const place = mind.place?.();
  const tk = topicKey(topic);
  const about = [npc.id];
  if (tk === 'maren') about.push('maren');
  const what = tk === 'maren' ? ' about Maren' : topic ? ` about ${shorten(topic, 40)}` : '';
  let text;
  if (result?.animal) text = `Had a word with ${isNamedCreature(npc) ? npc.name : `a ${npc.species || 'creature'}`} ${placePhrase(place)}. It listened better than most people.`;
  else if (learned.length) text = `Talked with ${npc.name}${what} ${placePhrase(place)}. ${n} told me ${lowerFirst(shorten(learned[0], 170).replace(/[.!]*$/, '.'))}`;
  else text = `Talked with ${npc.name}${what} ${placePhrase(place)}. Nothing new, but it was good to talk.`;
  const mem = mind.remember(text, {
    importance: clamp(2 + (learned.length ? 2 : 0) + (tk === 'maren' ? 3 : 0), 2, 8),
    about,
    tags: ['conversation', npc.id, tk === 'maren' ? 'maren' : null].filter(Boolean),
    type: 'conversation',
    emotion: tk === 'maren' ? 'curiosity' : 'joy',
    gist: `talking with ${n}${tk === 'maren' ? ' about Maren' : ''}`,
  });
  return { learned, memory: mem };
}

function finish(ctx, talk) {
  const s = state(ctx.game);
  s.talk = null;
  const npc = talk.npc;
  try {
    applyConversation(ctx, npc, talk.result, { topic: talk.topic });
  } catch (err) {
    console.error('[social] applying the conversation failed', err);
  }
  ctx.bus?.emit?.('conversation', { a: ctx.companion, b: npc, lines: talk.played, topic: talk.topic || null });
  if (talk.prev) setDirective(ctx, talk.prev);
  else setDirective(ctx, { type: 'follow', target: 'player', distance: 'normal' });
}

function cancel(ctx, why) {
  const s = state(ctx.game);
  const pend = s.pending;
  s.pending = null;
  if (pend?.prev && pend.directive && ctx.behavior?.directive === pend.directive) setDirective(ctx, pend.prev);
  if (why) ctx.mind?.say?.(why);
}

// Orders start the clause ("go talk to Bram", "could you ask Aveline about Maren"), so
// "I'll talk to Bram later" or "I want to talk to you" never send her walking.
const LEAD = "^(?:(?:hey|lyra|please|ok|okay|so|and|then|now|go|go and|could you|can you|would you|will you|why not|maybe|you should|you could|try to|i want you to|i'd like you to)[, ]+)*";
const WHO = "(?!(?:me|us|you|yourself|him|her|them|it|anyone|someone|somebody|everyone|people|my|our|your|a|an)\\b)(?<who>[a-z][\\w'-]*(?: [a-z][\\w'-]*){0,2}?)";
const END = '\\s*[.!?]*$';

export const socialPlugin = {
  id: 'social',
  name: 'Social',
  description: 'Lyra walks over to people and talks with them, learning what they know and remembering it.',

  actions: {
    talk_to: {
      description: 'Walk over to someone and talk with them (optionally about a topic). Lyra learns facts and lore they know, and remembers the conversation.',
      params: { target: 'who: a villager name or id', value: 'topic (optional), e.g. "Maren", "the bandits"' },
      run: talkTo,
    },
  },

  // Is she in the middle of a talk (or on her way to one)?
  busy(ctx) {
    const s = state(ctx?.game);
    return !!(s.pending || s.talk);
  },

  onEvent(type, p, ctx) {
    if (type === 'companion_action' && p?.name === 'talk_to') {
      const s = state(ctx.game);
      if (s.pending && p.ok) s.pending.source = p.source || 'local';
    }
  },

  update(dt, ctx) {
    const s = state(ctx.game);
    if (!s.pending && !s.talk) return;
    const o = ctx.companion;
    const mind = ctx.mind;
    if (!o || !mind) return;
    if (o.downed) {
      s.pending = null;
      s.talk = null;
      return;
    }
    if (s.pending) {
      const pend = s.pending;
      const npc = ctx.game?.entities?.get?.(pend.id);
      if (!npc || npc.dead || npc.removed) return cancel(ctx, null);
      const d = ctx.behavior?.directive;
      // Someone gave her another order on the way: that one wins.
      if (pend.directive && d && d !== pend.directive && !(d.type === 'follow' && (d.target === pend.id || d.target?.id === pend.id))) {
        s.pending = null;
        return;
      }
      if (dist(o, npc) <= REACH) return startTalk(ctx, npc, pend);
      if (rt(ctx) - pend.t0 > WALK_TIMEOUT) return cancel(ctx, `I couldn't reach ${firstName(npc.name)}. Another time.`);
      return;
    }
    const talk = s.talk;
    if (talk.thinking) {
      if (rt(ctx) - talk.started > THINK_TIMEOUT) {
        talk.thinking = false;
        begin(ctx, talk, buildLocal(ctx, talk.npc, talk.topic));
      }
      return;
    }
    talk.wait -= dt;
    if (talk.wait > 0) return;
    if (talk.queue.length) {
      talk.wait = playLine(ctx, talk, talk.queue.shift());
      return;
    }
    finish(ctx, talk);
  },

  intents: [
    {
      id: 'social.talk',
      examples: ['talk to Bram', 'go talk to Elda', 'go chat with Mira', 'speak with Aveline', 'ask Aveline about Maren', 'go ask Garrick about the roads', 'say hi to Pip', 'go say hello to Tobias', 'have a word with Rowan', 'introduce yourself to Mira', 'talk to Bram about his forge'],
      patterns: [
        new RegExp(`${LEAD}(?:talk|speak|chat) (?:to|with) ${WHO}(?: about (?<topic>.+?))?${END}`, 'i'),
        new RegExp(`${LEAD}ask ${WHO} (?:about|regarding) (?<topic>.+?)${END}`, 'i'),
        new RegExp(`${LEAD}say (?:hi|hello|hey|good morning|good evening) to ${WHO}(?: for me)?${END}`, 'i'),
        new RegExp(`${LEAD}have a (?:word|chat|talk) with ${WHO}(?: about (?<topic>.+?))?${END}`, 'i'),
        new RegExp(`${LEAD}introduce yourself to ${WHO}${END}`, 'i'),
      ],
      command: true,
      confidence: 0.85,
      actions(m) {
        const g = m.groups || {};
        return [{ name: 'talk_to', args: { target: String(g.who || '').trim(), value: g.topic ? String(g.topic).trim() : null, amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
  ],

  promptContext(ctx) {
    const s = state(ctx.game);
    const lines = [];
    if (s.talk) lines.push(`She is talking with ${s.talk.npc?.name}${s.talk.topic ? ` about ${s.talk.topic}` : ''} right now.`);
    else if (s.pending) lines.push(`She is on her way to talk with ${ctx.game?.entities?.get?.(s.pending.id)?.name || s.pending.id}.`);
    const mind = ctx.mind;
    const o = ctx.companion;
    if (mind && o) {
      const near = [];
      for (const e of ctx.game?.entities?.all?.() || []) {
        if (!e?.profile || e.removed || e.dead) continue;
        const d = dist(o, e);
        if (d < 200) near.push([d, e]);
      }
      near.sort((a, b) => a[0] - b[0]);
      if (near.length) lines.push(`People she could talk to nearby (talk_to): ${near.slice(0, 4).map(([, e]) => `${e.name} (${e.id})`).join(', ')}.`);
      const unmet = (ctx.game?.entities?.all?.() || []).filter((e) => e?.profile && !mind.perception?.met?.has?.(e.id)).map((e) => firstName(e.name));
      if (unmet.length) lines.push(`Villagers she has not met yet: ${unmet.slice(0, 6).join(', ')}.`);
    }
    let out = lines.join('\n');
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },
};

