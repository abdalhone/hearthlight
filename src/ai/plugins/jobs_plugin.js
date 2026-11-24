import { cmd, act, firstMessage, qtyFrom, QTY, DELIVER, deliverFrom, cleanRef } from '../behavior/phrases.js';
import { JOBS, resolveJobId, cookableCount } from '../behavior/jobs.js';
import { say } from '../behavior/lines.js';

// Jobs: chop wood, gather herbs, forage, mine, fish, farm, cook, collect loot (and
// patrol/guard as standing orders). She works until the amount is reached, then
// delivers to the player (default), the home chest, or keeps it.

const ABSENT = { ok: false, message: "I'm not here right now." };
const DELIVERY = ['player', 'chest', 'keep'];

function body(ctx) {
  return ctx?.behavior || ctx?.companion?.behavior || null;
}

function deliveryWord(v) {
  const t = String(v || '').toLowerCase();
  if (!t) return null;
  if (DELIVERY.includes(t)) return t;
  if (/chest|home|store|stash|house/.test(t)) return 'chest';
  if (/keep|yourself|hold/.test(t)) return 'keep';
  if (/me|player|you/.test(t)) return 'player';
  return null;
}

const WHERE = String.raw`(?:\s+(?:in|at|from|near|by|around)\s+(?:the\s+)?(?<where>(?!(?:them|it)\b)[a-z][\w' -]{1,30}?))?`;

// Build a job intent: body + optional place + optional delivery clause.
function jobIntent(id, job, bodies, confidence = 0.9) {
  return {
    id: `jobs.${id}`,
    patterns: bodies.map((b) => cmd(b + WHERE + DELIVER)),
    command: true,
    confidence,
    actions(m) {
      let value = job;
      if (job === 'cook') {
        const dish = cleanRef(m.groups?.dish);
        value = dish && !/^(food|something|something to eat|a meal|dinner|supper|lunch|breakfast)$/i.test(dish.replace(/^(the|some|a|an|up)\s+/, '')) ? `cook ${dish.replace(/^(the|some|a|an|up)\s+/, '')}` : 'cook';
      }
      const deliver = deliverFrom(m) || 'player';
      const where = cleanRef(m.groups?.where);
      const out = [act('start_job', deliver, where && job !== 'cook' ? `${value} @ ${where}` : value, qtyFrom(m))];
      return out;
    },
    answer: (m, ctx, results) => firstMessage(results),
  };
}

export const jobsPlugin = {
  id: 'jobs',
  name: 'Jobs',
  description: 'Chop wood, gather herbs, forage, mine, fish, farm, cook, collect loot.',

  actions: {
    start_job: {
      description:
        'Start a job. Jobs: chop_wood, gather_herbs, forage, mine_ore, fish, farm, cook (may name a dish, e.g. "cook stew"), collect_loot, patrol, guard. She works until the amount, then delivers.',
      params: { target: "deliver to: 'player' (default) | 'chest' | 'keep'", value: 'job id (optionally "job @ place")', amount: 'how many items (optional)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        const deliverTo = deliveryWord(args.target);
        if (!args.value) {
          // No job named: change where the current job's haul goes.
          if (b.directive.type === 'job' && b.jobs.active && deliverTo) {
            b.jobs.deliverTo = deliverTo;
            b.directive.deliverTo = deliverTo;
            return { ok: true, message: deliverTo === 'chest' ? "I'll put it all in the chest when I'm done." : deliverTo === 'keep' ? "I'll hang on to everything." : "I'll bring it straight to you." };
          }
          return { ok: false, message: 'What should I work on? I can chop wood, gather herbs, forage, mine, fish, farm, cook or collect loot.' };
        }
        const [jobText, placeText] = String(args.value).split(/\s+@\s+/);
        const r = resolveJobId(jobText);
        if (!r) return { ok: false, message: say.jobUnknown(jobText) };
        let targetRef = r.targetRef;
        if (placeText && r.id !== 'cook') targetRef = placeText;
        return b.setDirective({ type: 'job', job: r.id, amount: args.amount ?? undefined, deliverTo: deliverTo || 'player', targetRef });
      },
    },
    stop_job: {
      description: 'Stop the current job.',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.stopJob() : ABSENT;
      },
    },
  },

  intents: [
    {
      id: 'jobs.stop',
      patterns: [
        cmd(String.raw`(?:stop|quit|cease|end|finish|drop|abandon|cancel|leave)\s+(?:working|work|your work|the job|that job|your job|the task|chopping|mining|fishing|gathering|foraging|cooking|farming|harvesting|collecting|what you'?re doing|that)`),
        cmd(String.raw`(?:that'?s enough(?:\s+(?:wood|herbs|fish|ore|work|for now))?|enough (?:wood|work|of that|fishing|mining|chopping)|you can stop(?: now| working)?|tools down|put (?:that|it|the \w+) down|forget the job)`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('stop_job')],
      answer: (m, ctx, results) => firstMessage(results),
    },
    {
      id: 'jobs.deliver',
      // A follow-up clause like "and bring them to me" after a job order.
      patterns: [
        cmd(String.raw`(?:and\s+)?(?:bring|give|hand)\s+(?:them|it|those|everything)(?:\s+(?:back|over))?\s+to me`),
        cmd(String.raw`(?:and\s+)?(?:put|store|stash)\s+(?:them|it|those|everything)\s+in\s+(?:the\s+)?chest`),
      ],
      command: true,
      confidence: 0.8,
      actions: (m) => [act('start_job', /chest/i.test(m[0]) ? 'chest' : 'player')],
      answer: (m, ctx, results) => firstMessage(results),
    },
    jobIntent('chop', 'chop_wood', [
      String.raw`(?:chop|cut|split|gather|get|collect|harvest|go get)(?:\s+(?:me|us))?(?:\s+down)?\s+` + QTY + String.raw`(?:wood|logs?|lumber|firewood|timber)`,
      String.raw`(?:chop|cut|fell)(?:\s+down)?\s+(?:some\s+|a\s+|the\s+|a few\s+|more\s+)?trees?`,
      String.raw`(?:go\s+)?(?:chop|chopping|woodcutting|lumberjacking)(?:\s+wood)?`,
      String.raw`(?:chop|cut)\s+` + QTY + String.raw`(?:wood|logs?)`,
    ]),
    jobIntent('herbs', 'gather_herbs', [
      String.raw`(?:gather|pick|collect|get|find|forage(?:\s+for)?|harvest|go get)(?:\s+(?:me|us))?\s+` + QTY + String.raw`(?:healing\s+)?(?:herbs?|silverleaf|moonpetals?|medicinal plants|flowers)`,
      String.raw`(?:go\s+)?herb(?:-|\s)?(?:picking|gathering|hunting)`,
    ]),
    jobIntent('forage', 'forage', [
      String.raw`(?:go\s+)?forag(?:e|ing)(?:\s+for\s+(?:food|berries|something|us))?`,
      String.raw`(?:gather|pick|collect|get|find|go get)(?:\s+(?:me|us))?\s+` + QTY + String.raw`(?:wild\s+)?(?:berries|food)`,
    ]),
    jobIntent('mine', 'mine_ore', [
      String.raw`(?:go\s+)?(?:mine|mining)(?:\s+(?:for\s+)?` + QTY + String.raw`(?:ore|iron(?: ore)?|stones?|rocks?|crystals?))?`,
      String.raw`(?:gather|get|collect|dig(?:\s+up|\s+for)?|break|smash|quarry|go get)(?:\s+(?:me|us))?\s+` + QTY + String.raw`(?:ore|iron(?: ore)?|stones?|rocks?|crystals?)`,
    ]),
    jobIntent('fish', 'fish', [
      String.raw`(?:go\s+)?fish(?:ing)?(?:\s+for\s+(?:a while|us|me|dinner|a bit))?`,
      String.raw`(?:catch|get|go get)(?:\s+(?:me|us))?\s+` + QTY + String.raw`fish`,
      String.raw`(?:cast a line|go to the lake and fish)`,
    ]),
    jobIntent('farm', 'farm', [
      String.raw`(?:go\s+)?(?:farm|farming)`,
      String.raw`(?:help|go help)\s+(?:tobias|with the (?:harvest|farm|crops|field))`,
      String.raw`(?:harvest|pick|gather|bring in)\s+(?:the\s+|some\s+)?(?:crops|turnips|wheat|field|harvest)`,
    ]),
    jobIntent('cook', 'cook', [
      String.raw`(?:cook|make|prepare|fix|whip up|grill|bake)(?:\s+(?:us|me))?\s+(?<dish>(?:the |some |a |an |up )?(?:fish|stew|bread|food|dinner|supper|lunch|breakfast|meal|something(?: to eat)?|soup|turnips?|wheat))`,
      String.raw`(?:go\s+)?cook(?:ing)?(?:\s+something)?`,
    ]),
    jobIntent('loot', 'collect_loot', [
      String.raw`(?:collect|gather|grab|get|loot)\s+(?:all\s+)?(?:the\s+)?(?:loot|drops|spoils|items)(?:\s+(?:up|nearby|around))?`,
      String.raw`loot\s+(?:everything|it all|the bodies|them|the area)`,
    ]),
  ],

  promptContext(ctx) {
    const b = body(ctx);
    if (!b) return '';
    const lines = [];
    if (b.directive.type === 'job' && b.jobs.active) {
      const to = b.jobs.deliverTo === 'player' ? 'to the player' : b.jobs.deliverTo === 'chest' ? 'to the home chest' : 'kept by her';
      lines.push(`Current job: ${b.jobs.status()} (delivery: ${to}).`);
    } else lines.push('No job right now.');
    lines.push(`Jobs she can do: ${Object.keys(JOBS).join(', ')}, plus patrol and guard.`);
    const dishes = cookableCount(ctx.companion?.inventory);
    if (dishes) lines.push(`She has ingredients for ${dishes} dish${dishes === 1 ? '' : 'es'}.`);
    return lines.join('\n').slice(0, 880);
  },
};
