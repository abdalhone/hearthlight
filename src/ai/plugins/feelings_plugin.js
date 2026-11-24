import { emotionName } from '../mind/emotions.js';
import { activeGoals, findGoal } from '../mind/goals.js';
import { FOOD_PREFERENCE } from '../mind/needs.js';
import { feelingsAnswer, hungerAnswer, tiredAnswer, fearAnswer, wantAnswer, thinkingAnswer } from '../mind/voice.js';
import { clamp, pick, shorten, playerRef } from '../mind/text.js';
import { itemName } from '../../entities/items.js';

// Feelings plugin (mind): her goals, showing an emotion, eating when she is hungry,
// and her mood, needs and goals for Claude's prompt.

const ICONS = { joy: 'note', affection: 'heart', trust: 'heart', anger: 'anger', fear: 'sweat', embarrassment: 'sweat', surprise: '!', curiosity: '?', sadness: '...', pride: 'note', calm: '...' };
const EMOTES = { joy: 'laugh', sadness: 'cry', anger: 'angry', curiosity: 'think', pride: 'cheer', affection: 'hug' };

// Goals she will not take on, whoever asks.
const FORBIDDEN_GOAL = /\b(kill|hurt|harm|attack|rob|steal from|burn|poison|betray)\b.*\b(pip|child|children|kids?|villagers?|bram|elda|rowan|mira|tobias|aveline|garrick|innocents?|cat|maren)\b/i;

function setGoal(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const text = String(args.value || args.target || '').trim();
  if (!text) return { ok: false, message: 'A goal needs words. What should I aim for?' };
  if (FORBIDDEN_GOAL.test(text)) return { ok: false, message: "No. I won't make that a goal. I won't do it at all." };
  const before = mind.goals.length;
  const g = mind.addGoal(text, clamp(Number.isFinite(args.amount) ? args.amount : 0.6, 0, 1), 'player');
  if (!g) return { ok: false, message: "I couldn't make sense of that." };
  if (mind.goals.length === before) return { ok: true, message: `I'm already on it: ${g.text.toLowerCase()}.` };
  return { ok: true, message: pick([`All right. New goal: ${g.text.toLowerCase()}.`, "That's a good one. I'll keep it in mind.", 'Done. Well, not done. Started.'], ctx.game?.rng) };
}

function completeGoalAction(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: "I can't think straight right now." };
  const ref = String(args.value || args.target || '').trim();
  if (!ref) return { ok: false, message: 'Which goal?' };
  const g = findGoal(mind.goals, ref);
  if (!g) return { ok: false, message: "I don't have a goal like that." };
  if (g.id === 'find_maren' && mind.questStage().index < 6) return { ok: false, message: "Not yet. Not until I know what happened to her." };
  mind.completeGoal(g.id);
  return { ok: true, message: pick(['Done. That one felt good.', 'Crossed off. I love crossing things off.', `Finished: ${g.text.toLowerCase()}. On to the next.`], ctx.game?.rng) };
}

function express(args, ctx) {
  const mind = ctx.mind;
  if (!mind) return { ok: false, message: '' };
  const name = emotionName(args.value || args.target);
  if (!name) return { ok: false, message: `I don't know how to feel "${args.value}".` };
  const amount = clamp(Number.isFinite(args.amount) ? args.amount : 0.5, 0, 1);
  mind.feel(name, name === 'calm' ? amount : amount * 0.6, 'expressed');
  const o = ctx.companion;
  try {
    if (ICONS[name]) ctx.game?.bubbles?.icon?.(o, ICONS[name]);
    if (amount >= 0.6 && EMOTES[name] && name !== 'affection' && !ctx.behavior?.currentTarget) ctx.behavior?.emote?.(EMOTES[name]);
  } catch (err) {
    console.error('[feelings] express failed', err);
  }
  return { ok: true, message: '' };
}

const STATE = new WeakMap();
function state(game) {
  const key = game || STATE;
  let s = STATE.get(key);
  if (!s) STATE.set(key, (s = { t: 0, complainT: 0, lastComplain: -Infinity }));
  return s;
}

export const feelingsPlugin = {
  id: 'feelings',
  name: 'Feelings and needs',
  description: 'Her mood, needs and goals. She eats from her satchel when hungry and shows what she feels.',

  actions: {
    set_goal: {
      ungated: true, // asks nothing of her (DESIGN §16.4)
      description: 'Give Lyra a personal goal. She refuses goals that would hurt innocents.',
      params: { value: 'goal text', amount: 'priority 0..1 (default 0.6)' },
      run: setGoal,
    },
    complete_goal: {
      ungated: true, // asks nothing of her (DESIGN §16.4)
      description: 'Mark one of her goals as done.',
      params: { value: 'goal text or id' },
      run: completeGoalAction,
    },
    express: {
      ungated: true, // asks nothing of her (DESIGN §16.4)
      description: 'Feel and show an emotion (icon over her head, sometimes an emote).',
      params: { value: 'joy|sadness|fear|anger|trust|surprise|affection|curiosity|pride|embarrassment|calm', amount: 'intensity 0..1' },
      run: express,
    },
  },

  // The mind eats from her satchel by itself (Mind.update); when the satchel is empty and
  // she is starving, she says so (checked every 2 s).
  update(dt, ctx) {
    const mind = ctx.mind;
    if (!mind || ctx.game?.state !== 'playing') return;
    const s = state(ctx.game);
    s.t += dt;
    if (s.t < 2) return;
    s.t = 0;
    const o = ctx.companion;
    if (!o || o.downed) return;
    if (mind.needs.hunger < 0.2) {
      if (!mind.hasFood?.()) {
        const now = mind.perception.rt();
        const p = ctx.player;
        const near = p && Math.hypot(p.x - o.x, p.y - o.y) < 100;
        if (near && now - s.lastComplain > 180 && !mind.isSpeaking()) {
          s.lastComplain = now;
          mind.say(pick(["I'm starving and my satchel's empty. Could we find food? Bread, fish... a honey cake, if the gods are kind.", "My stomach is making noises a wolf would respect. Food soon?"], ctx.game?.rng));
        }
      }
    }
  },

  intents: [
    {
      id: 'feel.hungry',
      examples: ['are you hungry?', 'do you want something to eat?', 'have you eaten?', 'need food?'],
      patterns: [
        /\bare (?:you|u) (?:hungry|starving|peckish)\b/i,
        /\b(?:do you )?(?:want|need) (?:something |anything )?(?:to eat|food|a snack|a bite)\b/i,
        /\bhave you eaten\b/i,
        /\bwhen did you (?:last )?eat\b/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        return hungerAnswer(ctx);
      },
    },
    {
      id: 'feel.eat',
      examples: ['eat something', 'have a snack', 'go eat'],
      patterns: [/^(?:(?:please|lyra|go on|you should)[, ]+)*(?:go )?(?:eat|have) (?:something|a snack|some food|a bite|your food)\b/i, /^(?:(?:please|lyra)[, ]+)*go eat\b/i],
      command: true,
      confidence: 0.85,
      actions(m, ctx) {
        const inv = ctx.companion?.inventory;
        const food = inv ? FOOD_PREFERENCE.find((id) => inv.has(id)) : null;
        if (!food) return [];
        if (ctx.actions?.has?.('use_item')) return [{ name: 'use_item', args: { target: null, value: food, amount: null } }];
        ctx.mind?.tryEat({ force: true });
        return [];
      },
      answer(m, ctx, results) {
        const inv = ctx.companion?.inventory;
        if (!results?.length) {
          if (!inv || !FOOD_PREFERENCE.some((id) => inv.has(id))) return "I'm out of food. A honey cake would fix that. Hint, hint.";
          return 'Thank you. That helps.';
        }
        const r = results[0];
        return r.ok ? r.message || 'Thank you. That helps.' : r.message || "I couldn't, sorry.";
      },
    },
    {
      id: 'feel.tired',
      examples: ['are you tired?', 'do you need rest?', 'are you sleepy?'],
      patterns: [/\bare (?:you|u) (?:tired|sleepy|exhausted|worn out)\b/i, /\bdo you need (?:a |some )?(?:rest|break|sleep|nap)\b/i],
      confidence: 0.85,
      answer(m, ctx) {
        return tiredAnswer(ctx);
      },
    },
    {
      id: 'feel.fear',
      examples: ['are you scared?', 'what are you afraid of?', 'what scares you?'],
      patterns: [/\bare (?:you|u) (?:scared|afraid|frightened|nervous|worried)\b/i, /\bwhat (?:are you (?:afraid|scared|frightened) of|scares you|frightens you)\b/i],
      confidence: 0.85,
      answer(m, ctx) {
        return fearAnswer(ctx);
      },
    },
    {
      id: 'feel.how',
      examples: ['how are you feeling?', 'how are you?', 'how do you feel?', 'are you ok?', "what's wrong?", 'you seem sad', "how's your mood?"],
      patterns: [
        /\bhow (?:are|r) (?:you|u)(?: (?:feeling|doing|holding up|today|now|after that))?\s*\??$/i,
        /\bhow do you feel\s*\??$/i,
        /\bhow(?:'s| is) your (?:mood|day|heart|head)\b/i,
        /\bare (?:you|u) (?:ok|okay|alright|all right|well|fine|hurt|sad|upset|angry|happy|good)\b/i,
        /\bwhat(?:'s| is) (?:wrong|the matter)\b/i,
        /\bwhat(?:'s| is) your mood\b/i,
        /\byou (?:seem|look|sound) (?:sad|upset|down|happy|tired|angry|worried|scared|quiet|off|cheerful)\b/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        return feelingsAnswer(ctx);
      },
    },
    {
      id: 'feel.want',
      examples: ['what do you want?', 'what are your goals?', "what's on your mind?", 'what are you thinking about?', 'what do you dream of?', 'what do you want to do?'],
      patterns: [
        /\bwhat do you (?:want|wish for|dream (?:of|about)|hope for|long for)(?! to eat)(?: to do| most| in life)?\s*\??$/i,
        /\bwhat(?:'s| is| are) your (?:goals?|dreams?|plans?|wish(?:es)?|ambitions?)\b/i,
        /\bwhat(?:'s| is) on your mind\b/i,
        /\bwhat are you thinking(?: about)?\s*\??$/i,
      ],
      confidence: 0.85,
      answer(m, ctx) {
        if (/thinking|on your mind/i.test(m[0])) return thinkingAnswer(ctx);
        return wantAnswer(ctx);
      },
    },
    {
      id: 'feel.set_goal',
      examples: ['your new goal is to learn fishing', 'new goal: find a moonpetal for Mira', 'make it your goal to visit every place'],
      patterns: [
        /\b(?:your (?:new )?goal is(?: to)?|new goal:?|add (?:a )?goal:?|set (?:a |your )?goal:?|make it (?:a |your )goal to|i want you to make it a goal to)\s+(?<text>.{3,})$/i,
      ],
      command: true,
      confidence: 0.85,
      actions(m) {
        return [{ name: 'set_goal', args: { target: null, value: m.groups.text.trim().replace(/[.!]+$/, ''), amount: 0.6 } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
    {
      id: 'feel.complete_goal',
      examples: ['mark the moonpetals goal as done', 'goal complete: learn fishing', "you've finished your goal to learn fishing"],
      patterns: [
        /\bmark (?:the |your )?(?<text>.+?) goal (?:as )?(?:done|complete|completed|finished)\b/i,
        /\bgoal (?:done|complete|completed|achieved):?\s+(?<text>.{3,})$/i,
        /\byou(?:'ve| have) (?:done|finished|completed|achieved) (?:your goal (?:to |of )?)(?<text>.{3,})$/i,
      ],
      command: true,
      confidence: 0.85,
      actions(m) {
        return [{ name: 'complete_goal', args: { target: null, value: m.groups.text.trim(), amount: null } }];
      },
      answer(m, ctx, results) {
        return results?.[0]?.message || null;
      },
    },
    {
      id: 'feel.soothe',
      examples: ['cheer up', 'calm down', "don't worry", 'relax, Lyra'],
      patterns: [/^(?:(?:hey|lyra|please)[, ]+)*(?:cheer up|calm down|don't (?:worry|be sad|be afraid)|relax|it's (?:ok|okay|alright|all right))\b/i],
      confidence: 0.8,
      actions(m) {
        return [{ name: 'express', args: { target: null, value: /cheer/i.test(m[0]) ? 'joy' : 'calm', amount: 0.4 } }];
      },
      answer(m, ctx) {
        const mood = ctx.mind?.mood();
        if (!mood) return null;
        if (mood.valence < -0.1) return pick(["...Thank you. I needed that more than I'd say.", "I'm trying. You help. You know that?"], ctx.game?.rng);
        return pick(["I'm fine, I promise. But it's sweet that you checked.", 'Calm water. I mean it.'], ctx.game?.rng);
      },
    },
  ],

  promptContext(ctx) {
    const mind = ctx.mind;
    if (!mind) return '';
    const m = mind.mood();
    const emo = mind.affect
      .top(4)
      .map((e) => `${e.name} ${e.value.toFixed(2)}`)
      .join(', ');
    const needs = Object.entries(mind.needs)
      .map(([k, v]) => `${k} ${v.toFixed(2)} (${mind.needsEngine.phrase(k)})`)
      .join(', ');
    const goals = activeGoals(mind.goals)
      .slice(0, 4)
      .map((g) => `- ${g.text} (priority ${g.priority.toFixed(1)}, ${g.source})`)
      .join('\n');
    const inv = ctx.companion?.inventory;
    const food = inv ? FOOD_PREFERENCE.filter((id) => inv.has(id)).map((id) => itemName(id, inv.count(id))) : [];
    const lines = [
      `Mood: ${m.label} ${m.emoji} (valence ${m.valence}, arousal ${m.arousal}). Strongest feelings: ${emo}.`,
      `Needs (1 = satisfied): ${needs}.`,
      food.length ? `Food in her satchel: ${food.join(', ')}.` : 'No food in her satchel.',
      goals ? `Goals:\n${goals}` : '',
    ];
    const last = mind.thoughts[mind.thoughts.length - 1];
    if (last) lines.push(`Latest thought: "${shorten(last.text, 120)}"`);
    let out = lines.filter(Boolean).join('\n');
    if (out.length > 880) out = `${out.slice(0, 877)}…`;
    return out;
  },
};

export { playerRef };
