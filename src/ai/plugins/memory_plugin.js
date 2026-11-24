import { PLAYER_ID } from '../../core/constants.js';
import { resolvePerson, memoryAnswer } from '../mind/voice.js';
import { clamp, cap, pick, shorten, playerRef, firstName } from '../mind/text.js';

// Memory plugin (mind): remembering what the player asks her to, forgetting (unless it
// matters too much), and recalled memories for Claude's prompt.

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

function forgetAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const text = String(args.value || args.target || '').trim();
  if (!text) return { ok: false, message: 'Forget what?' };
  if (/\bmaren\b/i.test(text)) return { ok: false, message: 'Forget Maren? Never. Not one word of her.' };
  const { people, places } = mind.resolveQuery(text);
  const m = mind.memory.bestMatch(text, { people, places, minRelevance: 0.3 });
  if (!m) return { ok: false, message: "I don't remember anything like that to forget." };
  if (m.pinned || m.importance >= 8) return { ok: false, message: 'No. Some things I keep, even when they hurt.' };
  mind.memory.remove(m.id);
  return { ok: true, message: pick(["Gone. ...Mostly. I'm not that kind of wizard.", "Forgotten. Or I'll pretend it is, which is nearly the same.", 'Consider it forgotten.'], ctx.game?.rng) };
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
      description: 'Store a memory (something the player wants Lyra to remember, or something she decides to keep).',
      params: { target: 'who it is about (optional)', value: 'what to remember', amount: 'importance 1..10 (default 6)' },
      run: rememberAction,
    },
    forget: {
      description: 'Drop a memory matching the text. Lyra refuses to forget important things.',
      params: { value: 'text to match' },
      run: forgetAction,
    },
  },

  onEvent(type, p, ctx) {
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

  // Memories relevant to the player's message, then the most important recent ones.
  promptContext(ctx, query = '') {
    const mind = ctx.mind;
    if (!mind) return '';
    const picked = mind.recall(query, { limit: 5, touch: false });
    const ids = new Set(picked.map((m) => m.id));
    const recent = mind.memory
      .all()
      .slice(-12)
      .filter((m) => !ids.has(m.id) && m.importance >= 4)
      .sort((a, b) => b.importance - a.importance || b.t - a.t)
      .slice(0, 3);
    const fmt = (m) => `- ${m.day > 0 ? `day ${m.day}` : m.when || 'before'}, importance ${m.importance}: ${shorten(m.text, 150)}`;
    const lines = [];
    if (picked.length) lines.push('Recalled:', ...picked.map(fmt));
    if (recent.length) lines.push('Recent:', ...recent.map(fmt));
    let out = lines.join('\n');
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },
};
