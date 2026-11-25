import { asksForHome, homeFacts, wayHomeLine } from '../../world/home.js';
import { companionshipOf } from '../brain/her_state.js';

// Where the player's bed is (r13; the author: "I'm not able to find my bed"): Lyra can
// always tell them — the Wayhouse, which way from here, which bed is theirs — and the game
// marks the way on their screen (the Home pointer) whenever they ask, whoever answers:
// her offline mind, Claude, or a villager (src/world/home.js says it the same for all).
// Claude is told the facts in its prompt when the player asks and may call show_home; the
// game checks the bed exists before it marks anything.

let asked = 0; // her two ways of saying it take turns

export const homePlugin = {
  id: 'home',
  name: 'The way home',
  description: "Where the player's bed is, and marking the way to it.",

  actions: {
    show_home: {
      description: "Mark the way to the player's own bed on their screen (an arrow until they reach it). Use when they ask where they sleep or cannot find home.",
      params: {},
      run(args, ctx) {
        const ok = !!ctx.game?.ui?.showHome?.('lyra');
        return ok ? { ok: true, message: 'Marked the way to your bed.' } : { ok: false, message: 'There is no bed of yours to show.' };
      },
    },
  },

  intents: [
    {
      id: 'home.where',
      // A question, not an order: she answers; the game marks the way (onEvent below).
      patterns: [{ exec: (t) => (asksForHome(t) ? [t] : null) }],
      confidence: 0.9,
      actions: () => [],
      answer: (m, ctx) => wayHomeLine(ctx.game, ctx.companion || ctx.game?.player, 'lyra', asked++),
    },
  ],

  // Whoever answers (her offline mind or Claude), asking her marks the way: she heard it
  // (player_message comes only within earshot). Not once she has broken off with the player
  // or cut them out of her life: then her word, or her silence, is the whole answer (§23.3),
  // unless she chooses to mark it herself (Claude's show_home).
  onEvent(type, p, ctx) {
    if (type !== 'player_message' || !asksForHome(p?.text)) return;
    let st = 'together';
    try {
      st = companionshipOf(ctx.game);
    } catch {
      /* no mind yet */
    }
    if (st === 'gone' || st === 'left') return;
    ctx.game?.ui?.showHome?.('lyra');
  },

  promptContext(ctx, query) {
    if (!asksForHome(query)) return '';
    const f = homeFacts(ctx.game, ctx.companion || ctx.game?.player);
    if (!f.ok) return '';
    let st = 'together';
    try {
      st = companionshipOf(ctx.game);
    } catch {
      /* no mind yet */
    }
    const apart = st === 'gone' || st === 'left';
    const marked = apart ? 'The way is not marked on their screen; mark it with show_home only if you choose to help them.' : 'The game has already marked the way on their screen; tell them where it is in your own words.';
    const sleepAt = ctx.game?.companion?.mind?.agenda?.sleepAt;
    const yours = !sleepAt || sleepAt === 'lyra_bed' ? 'The far bed in the Wayhouse is yours (Lyra\'s), and you sleep there.' : `The far bed in the Wayhouse is yours (Lyra's), but you are sleeping ${sleepAt === 'lyra_inn_bed' ? 'at the Ember Kettle' : 'elsewhere in Hearthvale'} for now.`;
    return `They are asking where their bed is. ${f.line} (From you: ${f.dir}, ${f.near}.) ${marked} ${yours}`;
  },
};
