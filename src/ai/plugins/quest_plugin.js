import { PLAYER_ID } from '../../core/constants.js';
import { QUEST_ID, QUEST_NAME, STAGES, STAGE_LINES, READ_LINES, REREAD_LINES, MAREN_JOURNAL, journalText, marenAnswer, stageIndex } from '../mind/maren.js';
import { pick, shorten, playerRef, cap } from '../mind/text.js';

// Quest plugin (mind): the Maren arc (DESIGN §9). Seven stages, each announced with
// `quest {id: 'maren', stage, index, title, text}`; `objective(ctx)` gives the current
// objective for the HUD. Stages only move forward, and a later stage's trigger skips
// the ones before it (finding the key before asking Aveline still counts).
//
//   0 settle -> 1 ask_aveline   (met 3 villagers, or day 2 begins; Lyra asks for help)
//   1 -> 2 find_key             (the player or Lyra asks Aveline about Maren)
//   2 -> 3 enter_ruins          (the ruins key is gained by either of them)
//   3 -> 4 find_journal         (either of them enters the Sunken Ruins)
//   4 -> 5 read_journal         (Maren's journal is gained)
//   5 -> 6 waygate              (read_journal, or the player gives her the journal)

const STATE = new WeakMap();

function state(game) {
  const key = game || STATE;
  let s = STATE.get(key);
  if (!s) STATE.set(key, (s = { stage: 0, history: [], read: false, pending: null, reading: false, t: 0 }));
  return s;
}

function isSelf(ctx, e) {
  return !!e && (e === ctx.companion || e.id === ctx.companion?.id || e === 'lyra');
}

function isPlayer(ctx, e) {
  return !!e && (e === ctx.player || e.id === PLAYER_ID || e === PLAYER_ID);
}

function locId(loc) {
  if (!loc) return null;
  return typeof loc === 'string' ? loc : loc.id || null;
}

// Speak a stage's lines when she can: the player close, no fight, nothing else being said.
function queueLines(ctx, lines, extra = {}) {
  if (!lines?.length) return;
  state(ctx.game).pending = { lines: [...lines], since: ctx.mind?.perception?.rt?.() ?? 0, ...extra };
}

function stageInfo(i) {
  const st = STAGES[stageIndex(i)];
  return { index: stageIndex(i), id: st.id, title: st.title, text: st.text };
}

// Move the quest to stage `to` (never backwards). Returns true when it moved.
function advance(ctx, to, how = '') {
  const s = state(ctx.game);
  const target = stageIndex(to);
  if (target <= s.stage) return false;
  const from = s.stage;
  s.stage = target;
  s.history.push({ stage: STAGES[target].id, t: Math.round(ctx.game?.clock?.t ?? 0) });
  if (s.history.length > 12) s.history.shift();
  try {
    onStage(ctx, target, from, how);
  } catch (err) {
    console.error('[quest] stage effects failed', err);
  }
  const info = stageInfo(target);
  ctx.bus?.emit?.('quest', { id: QUEST_ID, stage: info.id, index: info.index, title: info.title, text: info.text });
  return true;
}

// What each stage means to her: memories, goals, feelings, lines.
function onStage(ctx, stage, from, how) {
  const m = ctx.mind;
  if (!m) return;
  const P = playerRef(ctx.game);
  const id = STAGES[stage].id;
  if (id === 'ask_aveline') {
    m.appraise('hope', 0.5, 'deciding to ask about Maren');
    queueLines(ctx, STAGE_LINES.ask_aveline, {
      after: () => m.remember(`I asked ${P} to come with me to ask Sister Aveline about Maren. I didn't want to hear it alone.`, { importance: 6, about: [PLAYER_ID, 'maren', 'aveline'], tags: ['maren', 'quest'], emotion: 'trust', gist: 'asking for help with Maren' }),
    });
  } else if (id === 'find_key') {
    m.appraise('hope', 0.8, 'news of Maren');
    m.appraise('grief', 0.3, 'she walked into the ruins');
    // Whatever the story says about the stolen key reaches her with the news.
    for (const e of m.lorebook?.withTag?.('ruins_key') || []) if (!m.knowsLore(e)) m.learnLore(e, { source: 'told', from: 'aveline' });
    m.learn('Maren Ashgrove', 'Maren walked toward the Sunken Ruins and never came back. The ruins gate has been locked since spring.', { kind: 'fact', source: 'told', from: 'aveline', about: ['maren'] });
    m.remember('Maren walked into the Sunken Ruins three months ago and never came back. The gate is locked, and the bandits in the north-east hills have the key.', { importance: 8, about: ['maren', 'aveline'], tags: ['maren', 'sunken_ruins', 'ruins_key', 'bandits', 'quest'], emotion: 'fear', gist: 'learning where Maren went' });
    m.addGoal('Take the ruins key from the bandits', 0.85, 'quest', 'quest_key');
    queueLines(ctx, how === 'player_asked' ? STAGE_LINES.find_key_told : STAGE_LINES.find_key);
  } else if (id === 'enter_ruins') {
    m.appraise('hope', 1, 'the key');
    m.completeGoal('quest_key');
    m.addGoal('Search the Sunken Ruins for Maren', 0.9, 'quest', 'quest_ruins');
    m.remember('We have the key to the Sunken Ruins: rusted, stamped with the ruins crest. Whatever happened to Maren is on the other side of that gate.', { importance: 7, about: ['maren', PLAYER_ID], tags: ['ruins_key', 'sunken_ruins', 'maren', 'quest'], emotion: 'joy', gist: 'getting the ruins key' });
    queueLines(ctx, STAGE_LINES.enter_ruins);
  } else if (id === 'find_journal') {
    m.appraise('threat', 0.5, 'the ruins');
    m.appraise('hope', 0.6, 'her wards');
    queueLines(ctx, STAGE_LINES.find_journal);
  } else if (id === 'read_journal') {
    if (ctx.game?.flags) ctx.game.flags.journal_found = true;
    m.appraise('hope', 1.2, "Maren's journal");
    m.completeGoal('quest_ruins');
    m.remember("We found Maren's journal deep in the Sunken Ruins, water-stained, her handwriting on the cover. My hands wouldn't stop shaking.", { importance: 9, about: ['maren', PLAYER_ID], tags: ['maren_journal', 'maren', 'sunken_ruins', 'quest'], emotion: 'surprise', gist: "finding Maren's journal" });
    m.relationships.adjust(PLAYER_ID, { trust: 3, affinity: 3 }, "Helped me find Maren's journal");
    queueLines(ctx, STAGE_LINES.read_journal);
  } else if (id === 'waygate') {
    m.completeGoal('find_maren');
    m.addGoal('Follow Maren north through the old waygate', 0.97, 'quest', 'follow_maren');
    m.appraise('hope', 1.2, 'she was alive');
    m.appraise('grief', 0.4, 'she went alone');
    m.relationships.adjust(PLAYER_ID, { trust: 5, affinity: 5, familiarity: 3 }, 'Stood by me while I read her journal');
    m.relationships.addNote('maren', 'Went north through the old waygate to sing something old back to sleep. Alive when she wrote it.', 'observed');
    m.remember(`I read Maren's journal. She went north through the old waygate to sing something old back to sleep before it wakes, and she was alive when she wrote it. "You were always the best thing I ever made." ${cap(P)} stood beside me the whole time.`, {
      importance: 10,
      about: ['maren', PLAYER_ID],
      tags: ['maren_journal', 'maren', 'waygate', 'quest'],
      emotion: 'affection',
      gist: "reading Maren's journal",
    });
    if (ctx.game?.flags) ctx.game.flags.journal_read = true;
  }
}

// Reading the journal: hers, or handed over by the player.
function readJournal(args, ctx) {
  const m = ctx.mind;
  const o = ctx.companion;
  if (!m || !o) return { ok: false, message: '' };
  const s = state(ctx.game);
  const mine = o.inventory?.has?.('maren_journal');
  const theirs = ctx.player?.inventory?.has?.('maren_journal');
  if (!mine && !theirs) {
    if (s.read) return { ok: true, message: pick(REREAD_LINES, ctx.game?.rng) };
    return { ok: false, message: s.stage >= 4 ? "We haven't found it yet. It's here somewhere. Deeper." : "Maren's journal? I'd give anything for it. We don't have it." };
  }
  if (!mine && theirs && !s.reading) {
    // The player hands it over; item_given would start reading too, so mark it first.
    s.reading = true;
    try {
      ctx.player.inventory.transfer(o.inventory, 'maren_journal', 1);
      ctx.bus?.emit?.('item_given', { from: ctx.player, to: o, itemId: 'maren_journal', qty: 1 });
    } finally {
      s.reading = false;
    }
  }
  return doRead(ctx);
}

function doRead(ctx) {
  const m = ctx.mind;
  const s = state(ctx.game);
  if (s.read) return { ok: true, message: pick(REREAD_LINES, ctx.game?.rng) };
  s.read = true;
  s.pending = null;
  // What the journal teaches her: its pages, the lore it touches, the clues it holds.
  m.learn("Maren's journal", "Maren read in the ruins' carvings that the stones of this verse are failing. She found the waygate at the foot of the stair alive, its verse running north to the Crown Ring and past it into the Pale, and she meant to go through.", { kind: 'fact', source: 'observed', about: ['maren'] });
  m.learn("Maren's journal", "The journal's last page: a wrist with a ring drawn around it, labelled 'where the Song lets go', and: \"If someone comes out, I hope whoever it is is kind.\" Maren went north through the old waygate.", { kind: 'fact', source: 'observed', about: ['maren', 'player'] });
  m.learnItem('maren_journal');
  m.feel('sadness', 0.3, "reading Maren's journal");
  m.sayLines(READ_LINES, { chat: true, gap: 0.9 });
  advance(ctx, 6, 'read');
  return { ok: true, message: 'Give me a moment with it.' };
}

export const questPlugin = {
  id: 'quest',
  name: 'The Candle and the Gate',
  description: "Lyra's search for her teacher Maren: what to do next, and Maren's journal.",
  questId: QUEST_ID,
  questName: QUEST_NAME,
  stages: STAGES,
  journal: MAREN_JOURNAL,
  journalText,

  actions: {
    read_journal: {
      description: "Read Maren's journal, if Lyra or the player carries it (the player hands it over). Advances the Maren quest.",
      params: {},
      ungated: true,
      run: readJournal,
    },
  },

  // { index, id, title, text } of the current stage.
  stageOf(game) {
    return stageInfo(state(game).stage);
  },

  objective(ctx) {
    return stageInfo(state(ctx?.game).stage).text;
  },

  isRead(game) {
    return state(game).read;
  },

  // For other modules and tests: move the arc forward to a stage (id or index).
  advance(ctx, stage, how = 'external') {
    return advance(ctx, stage, how);
  },

  install(ctx) {
    const s = state(ctx.game);
    if (!s.history.length) s.history.push({ stage: STAGES[0].id, t: Math.round(ctx.game?.clock?.t ?? 0) });
  },

  onEvent(type, p, ctx) {
    if (!p) return;
    const s = state(ctx.game);
    switch (type) {
      case 'npc_meet': {
        if (s.stage === 0 && (ctx.mind?.perception?.villagersMet?.() ?? 0) >= 3) advance(ctx, 1, 'met');
        break;
      }
      case 'new_day':
        if (s.stage === 0 && (p.day ?? 1) >= 2) advance(ctx, 1, 'day');
        break;
      case 'npc_topic':
        if (p.npc?.id === 'aveline' && /maren/i.test(String(p.topic || '')) && s.stage <= 1) advance(ctx, 2, 'player_asked');
        break;
      case 'conversation': {
        const other = isSelf(ctx, p.a) ? p.b : isSelf(ctx, p.b) ? p.a : null;
        if (other?.id !== 'aveline' || s.stage > 1) break;
        const aboutMaren = /maren/i.test(String(p.topic || '')) || (p.lines || []).some((l) => /maren/i.test(String(l?.text || '')));
        if (aboutMaren) advance(ctx, 2, 'lyra_asked');
        break;
      }
      case 'item_gained':
        if (!isSelf(ctx, p.actor) && !isPlayer(ctx, p.actor)) break;
        if (p.itemId === 'ruins_key') advance(ctx, 3, 'key');
        else if (p.itemId === 'maren_journal') advance(ctx, 5, 'journal');
        break;
      case 'enter_location':
        if ((isSelf(ctx, p.actor) || isPlayer(ctx, p.actor)) && locId(p.location) === 'sunken_ruins') advance(ctx, 4, 'entered');
        break;
      case 'item_given':
        if (p.itemId === 'maren_journal' && isSelf(ctx, p.to)) {
          if (s.stage < 5) advance(ctx, 5, 'journal');
          if (!s.reading && !s.read) doRead(ctx);
        }
        break;
      case 'companion_action':
        // "Read the journal" can reach her as 'interact' (the world plugin's intents come
        // first); when one of them carries Maren's journal, that means reading it.
        if (p.name === 'interact' && !s.read && /journal|diary|notebook|maren/i.test(String(p.args?.target || '')) && (ctx.companion?.inventory?.has?.('maren_journal') || ctx.player?.inventory?.has?.('maren_journal'))) {
          readJournal({}, ctx);
        }
        break;
      default:
        break;
    }
  },

  // Stage lines wait for a good moment: the player near, no fight, nothing else said.
  update(dt, ctx) {
    const s = state(ctx.game);
    if (!s.pending) return;
    s.t += dt;
    if (s.t < 0.5) return;
    s.t = 0;
    const m = ctx.mind;
    const o = ctx.companion;
    const p = ctx.player;
    if (!m || !o || !p || ctx.game?.state !== 'playing' || o.downed) return;
    if (m.perception?.encounter || m.isSpeaking()) return;
    if (Math.hypot(p.x - o.x, p.y - o.y) > 140) return;
    const { lines, after } = s.pending;
    s.pending = null;
    m.sayLines(lines, { chat: true, gap: 0.7, onDone: after });
  },

  intents: [
    {
      id: 'quest.read',
      examples: ['read the journal', "read Maren's journal", 'here, read this journal', 'you should read the journal', 'can you read the journal?', 'take a look at the journal'],
      patterns: [
        /^(?:(?:please|lyra|ok|okay|go on|you should|can you|could you|will you|why don't you|did you)[, ]+)*(?:read|open|look (?:at|through)|take a look at) (?:the |this |that |her |maren'?s? )*(?:journal|diary|notebook)\b/i,
        /^(?:(?:here|lyra|ok|okay)[,!. ]+)*(?:here(?:'s| is)|take|have) (?:the |her |this |maren'?s? )?(?:journal|diary)\b/i,
      ],
      command: true,
      confidence: 0.9,
      actions() {
        return [{ name: 'read_journal', args: { target: null, value: null, amount: null } }];
      },
      answer(m, ctx, results) {
        const r = results?.[0];
        if (!r) return null;
        return r.message || null;
      },
    },
    {
      id: 'quest.maren',
      examples: ['who is Maren?', 'tell me about Maren', 'what happened to Maren?', 'where is Maren?', 'any news of Maren?', 'who was your teacher?', 'do you think Maren is alive?'],
      patterns: [
        /\b(?:who(?:'s| is| was)|tell me (?:about|more about)) (?:maren|your (?:teacher|mentor)|maren ashgrove)\b/i,
        /\bwhat (?:happened|became) (?:to|of) (?:maren|your (?:teacher|mentor))\b/i,
        /\bwhere(?:'s| is| did) (?:maren|your (?:teacher|mentor))\b/i,
        /\b(?:any )?(?:news|sign|word|trace) (?:of|about|from) (?:maren|your (?:teacher|mentor))\b/i,
        /\b(?:is|think) maren(?:'s| is)? (?:still )?(?:alive|dead|ok|okay|safe)\b/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        const st = state(ctx.game).stage;
        if (/alive|dead|ok|okay|safe/i.test(m[0])) {
          return st >= 6 ? 'She was alive when she wrote those last pages. I hold onto that with both hands.' : "I tell myself she is. Every morning. Some mornings it's harder.";
        }
        return marenAnswer(st, { what: /happened|became|where|news|sign|word|trace/i.test(m[0]) });
      },
    },
    {
      id: 'quest.next',
      examples: ["what's our next step?", 'what should we do next?', 'where do we go now?', "what's our objective?", 'what is the quest?', 'what now?'],
      patterns: [
        /\bwhat(?:'s| is) (?:our|the) (?:next step|objective|quest|goal now|lead)\b/i,
        /\bwhat (?:should|do|shall) we do (?:next|now)\b/i,
        /\bwhere (?:do|should|shall) we (?:go|head) (?:next|now)\b/i,
        /^(?:so,? )?what now\s*\??$/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        const info = stageInfo(state(ctx.game).stage);
        const lines = {
          settle: "Settle in, learn some names. Then I'll want to ask about Maren. If you're willing.",
          ask_aveline: 'Sister Aveline, at the chapel. She knew Maren. Come with me?',
          find_key: "The bandits north-east have the ruins key. I won't pretend that's easy. I won't pretend I'll stop, either.",
          enter_ruins: 'The Sunken Ruins, south-west. We have the key. Whenever you are ready.',
          find_journal: 'Deeper into the ruins. If Maren left anything, it will be where the stone hums loudest.',
          read_journal: "Her journal. Let me read it. Please.",
          waygate: "North. Through the old waygate. I don't know what's on the other side, only who.",
        };
        return lines[info.id] || info.text;
      },
    },
    {
      id: 'quest.journal',
      examples: ['what did the journal say?', 'what did Maren write?', "what's in the journal?"],
      patterns: [/\bwhat (?:did|does) (?:the journal|her journal|maren(?:'s journal)?) (?:say|write|tell)\b/i, /\bwhat(?:'s| is) in (?:the|her|maren'?s?) journal\b/i, /\bwhat did maren write\b/i],
      confidence: 0.85,
      answer(m, ctx) {
        const s = state(ctx.game);
        if (!s.read) return s.stage >= 5 ? "I haven't read it yet. Let me, would you?" : "We haven't found anything of hers yet. Not one page.";
        return 'The stones of this verse are failing, she says. The waygate under the ruins is alive, and its verse runs north, to the Crown Ring and past it into the Pale. She meant to go through. The last page is a wrist with a ring around it, and one line: "If someone comes out, I hope whoever it is is kind."';
      },
    },
  ],

  promptContext(ctx) {
    const s = state(ctx.game);
    const info = stageInfo(s.stage);
    const lines = [`${QUEST_NAME} (finding Maren), stage ${info.index}/6 "${info.title}": ${info.text}`];
    const m = ctx.mind;
    if (m) {
      const facts = m
        .knowledgeAbout('Maren')
        .concat(m.knowledgeStore?.all?.().filter((k) => k.about.includes('maren') && k.source !== 'lore') || [])
        .filter((k, i, a) => a.indexOf(k) === i)
        .slice(-4)
        .map((k) => `- ${shorten(k.text, 150)}`);
      if (facts.length) lines.push('What she has learned about Maren:', ...facts);
    }
    lines.push(s.read ? 'She has read the journal: Maren went north through the old waygate.' : s.stage >= 5 ? "She has not read Maren's journal yet (read_journal)." : '');
    let out = lines.filter(Boolean).join('\n');
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },

  serialize(ctx) {
    const s = state(ctx.game);
    return { stage: s.stage, read: s.read, history: s.history.slice(-12) };
  },

  deserialize(d, ctx) {
    if (!d) return;
    const s = state(ctx.game);
    s.stage = stageIndex(Number(d.stage) || 0);
    s.read = !!d.read;
    s.history = Array.isArray(d.history) ? d.history.filter((h) => h && h.stage).slice(-12) : [];
    s.pending = null;
  },
};
