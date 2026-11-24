import { PLAYER_ID, DAY_SECONDS } from '../../core/constants.js';
import { resolvePerson, memoryAnswer, lifeAnswer, knowAnswer } from '../mind/voice.js';
import { clamp, cap, pick, shorten, playerRef, firstName } from '../mind/text.js';
import { editMemory, forgetMemory, updateKnowledge, retractKnowledge, applyLifeEdits, consolidateDay } from '../mind/memory_edits.js';

// Memory plugin (mind): remembering what the player asks her to, tending her own memory
// (DESIGN §17.4: edit_memory, forget, update_knowledge, retract_knowledge, each keeping a
// history), the night's consolidation, and recalled memories for Claude's prompt.
// When the player asks her to forget or remember differently, it is a request she weighs
// (the consent gate, §16.4); when she decides herself (Claude, her sleep), it simply runs.

const PERSONAL = /\b(i|i'm|i've|me|my|mine|you|your|yours|you're)\b/i;

function rememberAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const raw = String(args.value || '').trim().replace(/^that\s+/i, '');
  if (!raw) return { ok: false, message: 'Remember what?' };
  const P = playerRef(ctx.game);
  const about = new Set();
  const who = args.target ? resolvePerson(ctx, args.target) : null;
  if (who && !who.self) about.add(who.player ? PLAYER_ID : who.group ? who.group.key : who.id);
  for (const id of mind.resolveQuery(raw).people) if (id !== PLAYER_ID) about.add(id);
  // Pronouns are the player's, so quote them rather than rewrite them.
  const personal = PERSONAL.test(raw);
  if (personal) about.add(PLAYER_ID);
  const body = raw.replace(/[.!?]+$/, '');
  const text = personal ? `${cap(P)} told me: "${cap(body)}."` : `${cap(body)}. (${cap(P)} told me.)`;
  const importance = clamp(Math.round(Number.isFinite(args.amount) ? args.amount : 6), 1, 10);
  const m = mind.remember(text, { importance, about: [...about], tags: ['told'], type: 'fact' });
  for (const id of about) {
    if (id === PLAYER_ID && !personal) continue;
    if (id !== PLAYER_ID || personal) mind.relationships.addNote(id, `${cap(body)}.`, 'player');
  }
  state(ctx.game).last = m;
  const n = [...about].filter((id) => id !== PLAYER_ID).map((id) => mind.relationships.get(id)?.name).filter(Boolean)[0];
  return {
    ok: true,
    message: personal
      ? pick(["I'll remember that.", "Noted. I won't forget.", "Tucked away where I keep the important things."], ctx.game?.rng)
      : pick([`${shorten(cap(body), 90)}. Got it, I'll remember.`, `${n ? `About ${firstName(n)}? ` : ''}Noted. I won't forget.`, "I'll remember that."], ctx.game?.rng),
  };
}

// Did the player ask for this (it went through her consent gate a moment ago)?
function askedByPlayer(ctx, name) {
  const a = ctx?.mind?.autonomy;
  return !!a && !(a._selfAct > 0) && !!a.wasJustEvaluated?.(name);
}

function forgetAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const text = String(args.target || args.value || '').trim();
  if (!text) return { ok: false, message: 'Forget what?' };
  const by = askedByPlayer(ctx, 'forget') ? 'player' : 'self';
  return forgetMemory(mind, text, { why: by === 'player' ? '' : args.value && args.target ? args.value : '', by });
}

// "Remember it differently": which memory, when the player did not say.
function lastAboutPlayer(mind) {
  const now = mind.now?.() ?? 0;
  const list = mind.memory?.all?.() || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (now - m.t > DAY_SECONDS) break;
    if (m.type !== 'reflection' && m.about?.includes(PLAYER_ID)) return m.id;
  }
  return null;
}

function editAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const asked = askedByPlayer(ctx, 'edit_memory');
  const ref = String(args.target || '').trim() || (asked ? lastAboutPlayer(mind) : null) || String(args.value || '').trim();
  if (!ref) return { ok: false, message: 'Remember what differently?' };
  if (!args.value && !Number.isFinite(args.amount)) return { ok: false, message: 'Differently how?' };
  return editMemory(mind, ref, { text: args.value || null, importance: Number.isFinite(args.amount) ? args.amount : null, by: asked ? 'player' : 'self', asked });
}

function updateKnowledgeAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const ref = String(args.target || '').trim();
  if (!ref) return { ok: false, message: 'Correct what?' };
  const by = askedByPlayer(ctx, 'update_knowledge') ? 'player' : 'self';
  const r = updateKnowledge(mind, ref, { text: args.value || null, confidence: Number.isFinite(args.amount) ? args.amount : null, by });
  // Something she did not know yet: the player told her, so she learns it as theirs.
  if (!r.ok && !r.entry && args.value && by === 'player' && /know anything/.test(r.message)) {
    const k = mind.learn?.(ref, String(args.value), { source: 'player' });
    if (k) return { ok: true, message: pick(["I didn't know that. I'll remember it.", 'Noted.'], ctx.game?.rng) };
  }
  return r;
}

function retractKnowledgeAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const ref = String(args.target || '').trim();
  if (!ref) return { ok: false, message: 'Stop believing what?' };
  const by = askedByPlayer(ctx, 'retract_knowledge') ? 'player' : 'self';
  return retractKnowledge(mind, ref, { why: args.value || (by === 'player' ? `${cap(playerRef(ctx.game))} told me it isn't so.` : '') });
}

// Her own tending at sleep, after the store merged and faded its entries.
function hookConsolidation(mind) {
  const mem = mind?.memory;
  if (!mem || mem.onConsolidate?.forMind === mind) return;
  const fn = () => consolidateDay(mind);
  fn.forMind = mind;
  mem.onConsolidate = fn;
}

const STATE = new WeakMap();
function state(game) {
  const key = game || STATE;
  let s = STATE.get(key);
  if (!s) STATE.set(key, (s = { last: null }));
  return s;
}

export const memoryPlugin = {
  id: 'memory',
  name: 'Memory',
  description: 'What Lyra remembers: she keeps what matters, recalls it when it is relevant, and forgets the small stuff when she sleeps.',

  actions: {
    remember: {
      ungated: true, // asks nothing of her (DESIGN §16.4)
      description: 'Store a memory (something the player wants Lyra to remember, or something she decides to keep).',
      params: { target: 'who it is about (optional)', value: 'what to remember', amount: 'importance 1..10 (default 6)' },
      run: rememberAction,
    },
    forget: {
      description: 'Let one of your memories go (her own choice; when the player asks, a request she weighs). Never your past, never Maren, never what protects you.',
      params: { target: 'memory id (optional)', value: 'words that find the memory' },
      run: forgetAction,
    },
    edit_memory: {
      description: 'Rewrite or reframe one of your memories; the old version is kept. Never makes small what protects you.',
      params: { target: 'memory id, or words that find it', value: 'how you remember it now', amount: 'new importance 1..10 (optional)' },
      run: editAction,
    },
    update_knowledge: {
      description: 'Correct or update something you know (a fact, rumor or theory); the old version is kept.',
      params: { target: 'subject or knowledge id', value: 'the corrected text', amount: 'confidence 0..1 (optional)' },
      run: updateKnowledgeAction,
    },
    retract_knowledge: {
      description: 'Stop believing a fact or theory you now think is wrong.',
      params: { target: 'subject or knowledge id', value: 'why, in your words' },
      run: retractKnowledgeAction,
    },
  },

  install(ctx) {
    hookConsolidation(ctx?.mind || ctx?.game?.companion?.mind);
  },

  // Her reframed past lives in the memory store's save; the mind rebuilds her life from
  // the story on load, so the edits are laid back on top once everything is loaded.
  deserialize(data, ctx) {
    const mind = ctx?.mind || ctx?.game?.companion?.mind;
    if (!mind) return;
    hookConsolidation(mind);
    applyLifeEdits(mind);
  },

  serialize() {
    return { v: 1 };
  },

  onEvent(type, p, ctx) {
    if (type === 'game_start' || type === 'player_sleep') {
      hookConsolidation(ctx?.mind);
      if (type === 'game_start' && p?.loaded) applyLifeEdits(ctx?.mind);
      return;
    }
    // When Claude stores a memory, it is her own reflection rather than something told.
    if (type === 'companion_action' && p?.name === 'remember') {
      const s = state(ctx.game);
      if (s.last && (p.source === 'claude' || p.source === 'self')) {
        s.last.tags = s.last.tags.filter((t) => t !== 'told');
        if (/\(.* told me\.\)$/.test(s.last.text)) s.last.text = s.last.text.replace(/\s*\(.* told me\.\)$/, '');
      }
      s.last = null;
    }
  },

  intents: [
    {
      id: 'mem.recall',
      examples: [
        'what do you remember about the lake?',
        'do you remember the wolves?',
        'what happened today?',
        'how did we meet?',
        'tell me about the time we fought the bandits',
        'any memories of Bram?',
        'what do you recall about Elda?',
        'remember when we fought the wolves?',
      ],
      patterns: [
        /\bwhat do you (?:remember|recall) (?:about |of )?(?<q>.+?)\s*\??$/i,
        /\b(?:do|d') ?you (?:remember|recall) (?<q>.+?)\s*\??$/i,
        /\btell me about (?:the time|when) (?<q>.+?)\s*\??$/i,
        /\bwhat happened (?<q>today|yesterday|this morning|tonight|(?:at|in|on|with) .+?)\s*\??$/i,
        /\bany memories (?:of|about) (?<q>.+?)\s*\??$/i,
        /\bhow did (?<q>we|you and i) (?:first )?meet\b/i,
        /^(?:(?:hey|lyra|oh)[, ]+)*remember (?<q>when .+?|the time .+?|that time .+?)\s*\??$/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        let q = String(m.groups?.q || '').trim();
        if (/^(we|you and i)$/i.test(q)) q = "wolves King's Road first meeting";
        q = q.replace(/^(about|of|the time|that time|when)\s+/i, '');
        return memoryAnswer(ctx, q, { lead: /remember|recall/i.test(m[0]) });
      },
    },
    {
      id: 'mem.life',
      examples: [
        'tell me about your childhood',
        'tell me about your brother',
        'where did you grow up?',
        'where are you from?',
        'how did you meet Maren?',
        'do you have any family?',
        'what were your parents like?',
        'how did you get your magic?',
        'tell me about your past',
      ],
      patterns: [
        /\b(?:tell me (?:more )?about|what (?:was|were)) your (?<q>childhood|brother|little brother|parents|mother|father|mum|mom|dad|family|home|past|life before(?: this)?|youth|first lesson|magic)\b/i,
        /\bwhere (?:did you grow up|were you born|(?:are|'re) you from|do you come from)\b/i,
        /\bhow did you (?:first )?(?<q>meet maren|find maren|learn magic|get your magic|discover your magic|become a ranger|start out)\b/i,
        /\bdo you have (?:any )?(?<q>family|siblings|brothers?|sisters?|parents)\b/i,
        /\bwhat (?:was|were) (?:it|things) like (?<q>growing up|on the isles|at home|back home)\b/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        let q = String(m.groups?.q || m[0]).toLowerCase();
        if (/where|born|from|grow|childhood|youth|isles|home/.test(q) || /where/.test(m[0].toLowerCase())) q = `${q} Kettlewake Glasswater Isles born`;
        if (/magic/.test(q)) q = 'magic lamp storm lighthouse';
        if (/meet maren|find maren|first lesson/.test(q)) q = 'Maren first lesson came beacon';
        if (/sibling|brother/.test(q)) q = 'Cal brother';
        if (/parent|mother|father|mum|mom|dad|family/.test(q)) q = `${q} mother father`;
        return lifeAnswer(ctx, q);
      },
    },
    {
      id: 'mem.know',
      examples: ['what do you know about the waygates?', 'what do you know about Bram?', 'have you heard anything about the bandits?', 'do you know anything about the Sunken Ruins?', 'tell me what you know about the Lanternwrights'],
      patterns: [
        /\bwhat (?:do|did) you (?:know|learn|find out) about (?<q>.+?)\s*\??$/i,
        /\b(?:have|did) you (?:hear|heard|learn|learned) (?:anything |something )?(?:about|of) (?<q>.+?)\s*\??$/i,
        /\bdo you know (?:anything|much|something) (?:about|of) (?<q>.+?)\s*\??$/i,
        /\btell me what you know about (?<q>.+?)\s*[.?!]*$/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        return knowAnswer(ctx, String(m.groups?.q || '').trim());
      },
    },
    {
      // Before mem.remember: "remember it differently: …" is an edit, not a new memory.
      id: 'mem.edit',
      examples: ['remember it differently', 'remember that differently: I was trying to help', "don't remember it like that", 'please remember the wolf fight differently: it was my idea'],
      patterns: [
        /^(?:(?:please|lyra|can you|could you|would you|will you)[, ]+)*remember (?:it|that|this|the (?<what>.+?)) (?:differently|another way|a different way|otherwise)(?:\s*[:,.;-]\s*(?<text>.{3,}))?\??$/i,
        /^(?:(?:please|lyra)[, ]+)*(?:don't|do not) remember (?:it|that|this) (?:that way|like that)(?:\s*[:,.;-]\s*(?<text>.{3,}))?$/i,
      ],
      command: true,
      confidence: 0.86,
      actions(m) {
        const what = m.groups?.what ? m.groups.what.trim() : null;
        const text = m.groups?.text ? m.groups.text.trim() : null;
        return [{ name: 'edit_memory', args: { target: what, value: text, amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
    {
      id: 'mem.remember',
      examples: ['remember that Pip loves cats', "don't forget that Bram likes iron ore", 'keep in mind that the bandits come at night', 'remember: I hate spiders'],
      patterns: [
        /^(?:(?:hey|lyra|please|and|also|oh)[, ]+)*(?:remember|don't forget|do not forget|never forget|keep in mind)(?:,)? (?!when\b|the time\b|how\b|what\b|who\b|me\b|us\b|that time\b|where\b)(?:that |this[:,]? |[:,] ?)?(?<text>.{3,})$/i,
        /^(?:(?:hey|lyra|please)[, ]+)*remember[:,] (?<text>.{3,})$/i,
      ],
      command: true,
      confidence: 0.9,
      actions(m) {
        return [{ name: 'remember', args: { target: null, value: m.groups.text.trim(), amount: 6 } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
    {
      id: 'mem.forget',
      examples: ['forget about the slime', 'forget that I said that', 'please forget the turnip incident'],
      patterns: [/^(?:(?:please|lyra|just)[, ]+)*forget (?!it\b|about it\b|it all\b)(?:about |that |the )?(?<text>.{3,})$/i],
      command: true,
      confidence: 0.85,
      actions(m) {
        return [{ name: 'forget', args: { target: null, value: m.groups.text.trim(), amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
  ],

  // A compact recall for the player's message: memories, knowledge, people and past,
  // each line cited by id ([m12], [k4], [life:cal_dies]) so Claude can say which it used.
  // (The brain may also send the larger mind.recallContext(message) on its own.)
  promptContext(ctx, query = '') {
    const mind = ctx.mind;
    if (!mind?.recallContext) return '';
    let out = mind.recallContext(query || '', { budget: 880 }).text;
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },
};
