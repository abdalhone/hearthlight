import { PLAYER_ID } from '../../core/constants.js';
import { parseRequestText } from '../mind/autonomy_words.js';

// Her own will (DESIGN §16). This plugin installs her consent gate on the action
// registry, so every order the player gives is a request she weighs
// (mind.evaluateRequest), and gives her (and Claude) the actions of §16.9 that belong to
// her will: leave_player, rejoin, set_plan, request, promise. Its intents let the offline
// brain answer what the player asks about the two of them; promptContext tells Claude
// where she stands. Her initiative (§16.8) and her promises run in the Autonomy itself
// (mind.autonomy), which the mind updates every step.

const STATES_SHE_TALKS_IN = new Set(['together', 'wary', 'apart']);

let installedGame = null;

function gameOf(ctx) {
  return ctx?.game || installedGame;
}

function autonomyOf(ctx) {
  const g = gameOf(ctx);
  const mind = ctx?.mind || g?.companion?.mind || null;
  const a = mind?.autonomy;
  return a && typeof a.evaluateRequest === 'function' ? a : null;
}

function stateOf(ctx) {
  const g = gameOf(ctx);
  if (g?.flags?.lyra_gone) return 'gone';
  return autonomyOf(ctx)?.companionship || 'together';
}

// A pattern that only matches while she is in one of `states`. Outside them the words
// fall through to the brain's own handlers (which also cover her leaving and being gone).
function inStates(states, re) {
  return {
    source: re.source,
    flags: re.flags,
    exec(text) {
      if (!states.has(stateOf(null))) return null;
      re.lastIndex = 0;
      return re.exec(text);
    },
  };
}

function line(a, key, vars = {}) {
  try {
    return a?.line?.(key, vars) || '';
  } catch {
    return '';
  }
}

function firstMessage(results) {
  for (const r of results || []) {
    const m = String(r?.message || '').trim();
    if (m) return m;
  }
  return '';
}

function refused(results) {
  return (results || []).some((r) => r && (r.refused || (r.verdict && r.verdict.decision !== 'accept' && r.verdict.decision !== 'accept_conditional')));
}

// Was this run the player's request (it went through the consent gate a moment ago)?
function askedByPlayer(a, name) {
  return !!a && !(a._selfAct > 0) && a.wasJustEvaluated?.(name);
}

export const autonomyPlugin = {
  id: 'autonomy',
  name: 'Her own will',
  description: 'She weighs every order as a request, keeps her own day and coin, and decides whether to travel with you.',

  install(ctx) {
    const g = gameOf(ctx);
    installedGame = g;
    if (!g?.actions?.setConsentGate) return;
    // Every action the player asks for passes here first (DESIGN §16.4).
    g.actions.setConsentGate((name, args, source) => {
      const mind = g.companion?.mind;
      if (!mind || typeof mind.evaluateRequest !== 'function') return null;
      const req = { action: name, args: { ...(args || {}) }, source };
      const offer = g.brain?.currentOffer;
      if (offer && (Number(offer.coins) > 0 || offer.share)) req.args.offer = { coins: Number(offer.coins) || null, share: !!offer.share, paid: !!offer.paid };
      const verdict = mind.evaluateRequest(req);
      return verdict && typeof verdict === 'object' && verdict.decision ? verdict : null;
    });
  },

  // The mind updates her will every step; this keeps it running if the mind is busy
  // elsewhere (the Autonomy runs once per step whoever calls it).
  update(dt, ctx) {
    autonomyOf(ctx)?.update?.(dt);
  },

  actions: {
    leave_player: {
      description: 'She stops traveling with the player, her own decision: apart (her own day, friendly), left (she broke off after being hurt), gone (for good — only after something grave).',
      params: { value: "'apart' | 'left' | 'gone'", target: 'why, in her words (optional)' },
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        const asked = askedByPlayer(a, 'leave_player');
        return a.leavePlayer(String(args.value || 'apart').toLowerCase(), args.target || '', { asked });
      },
    },
    rejoin: {
      description: 'Travel with the player again — only when she wants to (after amends, or when her own errands are done).',
      params: {},
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        return a.rejoin({ asked: askedByPlayer(a, 'rejoin') });
      },
    },
    set_plan: {
      description: "Change her own plan for today from now on, e.g. 'gather herbs for Mira', 'supper at the Kettle', 'visit Bram', 'rejoin at 14', 'explore sunken_ruins in the morning'.",
      params: { value: 'the activity or plan, in words' },
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        if (!args.value) return { ok: false, message: line(a, 'ans_plans', { what: a.describePlan() }) };
        return a.setPlan(args.value, { by: askedByPlayer(a, 'set_plan') ? 'player' : 'self' });
      },
    },
    request: {
      description: 'She asks something of the player (e.g. "buy me a honey cake"); if they agree it becomes their promise.',
      params: { value: 'what she asks, in her words' },
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        const text = String(args.value || '').trim();
        if (!text) return { ok: false, message: '' };
        const mine = a._nextAsk && a._nextAsk.text === text ? a._nextAsk.spec : null;
        // Her own initiative says it aloud; Claude's reply already carries the words.
        a.makeRequest(text, { spec: mine, say: a._selfAct > 0 });
        return { ok: true, message: '' };
      },
    },
    promise: {
      description: "Record a promise: the player's (target 'player', e.g. 'bring you a honey cake', 'never raise a sword to you again', amount = coins owed) or hers (target 'lyra').",
      params: { target: "who promises: 'player' (default) or 'lyra'", value: 'the promise, in words', amount: 'coins, when it is a payment' },
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        const by = String(args.target || 'player').toLowerCase();
        const p = a.promiseFromAction({ by: by === PLAYER_ID ? 'player' : by, text: args.value || '', amount: args.amount });
        return p ? { ok: true, message: '', promise: { text: p.text, by: p.by, due: p.due } } : { ok: false, message: '' };
      },
    },
    record_deed: {
      description: "Something the player did that changes how you see them and that only you can judge: 'lied' (they lied to you), 'kindness' (to someone who needed it), 'stole'. Hits, gifts, rescues and promises you see for yourself; never record those.",
      params: { value: "'lied' | 'kindness' | 'stole'", target: 'what happened, in your words' },
      ungated: true,
      run(args, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return { ok: false, message: '' };
        const e = a.recordObservedDeed(args.value, args.target);
        return e ? { ok: true, message: '' } : { ok: false, message: '' };
      },
    },
  },

  // Offline answers about the two of them (DESIGN §11 intent shape). The brain tries
  // these first; while she has left the player, her questions fall through to the
  // brain's own handlers for that state.
  intents: [
    {
      id: 'autonomy.trust',
      patterns: [inStates(STATES_SHE_TALKS_IN, /^(?:do|did) you (?:still |really |even )?trust me\b|^can you (?:still )?trust me\b|^how much do you trust me\b/i)],
      confidence: 0.88,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        const s = a.stats();
        const st = a.companionship;
        const key = s.trust >= 60 && st === 'together' ? 'ans_trust_high' : s.trust >= 30 && st !== 'wary' ? 'ans_trust_mid' : 'ans_trust_low';
        return line(a, key);
      },
    },
    {
      id: 'autonomy.okay',
      patterns: [inStates(STATES_SHE_TALKS_IN, /^are we (?:still )?(?:ok|okay|good|alright|all right|fine)\b|^(?:is|are) (?:everything|things) (?:ok|okay|alright|all right|good) between us\b/i)],
      confidence: 0.86,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        const s = a.stats();
        const recentBad = a.ledger.some((e) => e.severity <= -1 && a.now() - e.t < a.daySeconds());
        const key = a.companionship === 'wary' || s.trust < 25 || s.fear > 35 ? 'ans_okay_bad' : recentBad || s.fear > 15 ? 'ans_okay_strained' : 'ans_okay_good';
        return line(a, key);
      },
    },
    {
      id: 'autonomy.fear',
      patterns: [inStates(STATES_SHE_TALKS_IN, /^(?:are you|you) (?:still )?(?:afraid|scared|frightened|terrified) of me\b|^do (?:you fear me|i (?:scare|frighten) you)\b|^am i scaring you\b/i)],
      confidence: 0.88,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        const f = a.stats().fear;
        return line(a, f >= 40 ? 'ans_afraid_very' : f >= 12 ? 'ans_afraid_some' : 'ans_afraid_no');
      },
    },
    {
      id: 'autonomy.why_left',
      patterns: [
        inStates(
          STATES_SHE_TALKS_IN,
          /^why (?:did you (?:leave|go|walk away)|are you (?:leaving|avoiding me|keeping your distance|so distant|so cold|not with me)|do you keep (?:your distance|away from me|watching me)|won'?t you (?:travel|come) with me)\b|^why are you (?:living|doing) your own (?:life|thing)\b/i,
        ),
      ],
      confidence: 0.87,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        const st = a.companionship;
        const reason = String(a.reason || '').trim();
        if (st === 'together') return line(a, 'ans_not_left');
        if (st === 'apart') return line(a, 'ans_apart_why', { reason });
        return line(a, 'ans_why_left', { reason, reasonLower: reason.charAt(0).toLowerCase() + reason.slice(1) });
      },
    },
    {
      id: 'autonomy.apology',
      patterns: [
        inStates(
          STATES_SHE_TALKS_IN,
          /^(?:i(?:'m| am) (?:so |really |truly |very |deeply |terribly )*sorry\b.*|sorry\b.*|(?:please )?forgive me\b.*|can you (?:ever )?forgive me\b.*|will you forgive me\b.*|i apologi[sz]e\b.*|my apologies\b.*|i was wrong\b.*)$/i,
        ),
      ],
      confidence: 0.87,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        let heard = a.heardNow?.()?.apology || null;
        if (!heard) heard = a.receiveApology(m?.[0] || 'sorry');
        if (heard.nothing) return line(a, 'ans_apology_nothing');
        return line(a, heard.believed ? 'ans_apology_believed' : 'ans_apology_doubted');
      },
    },
    {
      // "come back" asks her to rejoin while she lives apart (or has left); while she is
      // with the player it means "come here".
      id: 'autonomy.come_back',
      patterns: [/^(?:please,? )?(?:come back(?: to me| with me| home)?|come with me again|travel with me again|will you come back(?: to me)?|won'?t you come back|come back with me|rejoin me|be with me again|walk with me again)(?:,? please)?$/i],
      command: true,
      confidence: 0.9,
      actions(m, ctx) {
        const st = stateOf(ctx);
        if (st === 'together' || st === 'wary') return [{ name: 'come_here', args: { target: null, value: null, amount: null } }];
        return [{ name: 'rejoin', args: { target: null, value: 'asked', amount: null } }];
      },
      answer(m, ctx, results) {
        if (refused(results)) return null;
        return firstMessage(results) || null;
      },
    },
    {
      id: 'autonomy.plans',
      patterns: [
        /^what (?:are|is|were) your plans?(?: for)?(?: (?:today|tonight|the day|this morning|this afternoon|this evening|later))?\b/i,
        /^what are you (?:doing|up to|planning) (?:today|tonight|this morning|this afternoon|this evening|later)\b/i,
        /^(?:do you have|got) (?:any )?plans(?: (?:today|for today|tonight))?\b/i,
        /^what(?:'s| is) on your (?:agenda|schedule)\b/i,
        /^what will you do (?:today|tonight|later)\b/i,
      ],
      confidence: 0.87,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        return line(a, 'ans_plans', { what: a.describePlan() });
      },
    },
    {
      id: 'autonomy.wants',
      patterns: [/^what (?:do you (?:want|wanna|feel like)|would you like)(?: to do)?(?: (?:today|now|tonight|next|most|in life|for yourself))?\b/i, /^what do you want\b/i],
      confidence: 0.86,
      answer(m, ctx) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        return line(a, 'ans_want', { what: a.describeWants() });
      },
    },
    {
      // "I'll pay you 10 coins to chop wood": the request, with the coin on it. (The
      // brain also lifts offers out of a message; this catches the ones it leaves in.)
      id: 'autonomy.offer',
      patterns: [/^(?:i(?:'ll| will| can| could)|let me|how about i)\s+(?:pay|give)\s+you\s+(?<n>\d{1,4})\s*(?:coins?|gold(?: coins)?|silver)?(?:\s+(?:to|if you(?:'ll| will)?|for)\s+(?<rest>.+))?$/i],
      command: true,
      confidence: 0.86,
      actions(m, ctx) {
        const n = parseInt(m.groups?.n, 10);
        const st = stateOf(ctx);
        const acts = parseRequestText(m.groups?.rest || '', st === 'together' || st === 'wary');
        // The coin rides on actions whose amount means nothing; for a job (amount = how
        // many) she already heard the offer in the player's words (mind.autonomy.hearPlayer).
        for (const act of acts) if (act.name !== 'start_job' && act.name !== 'wait' && act.args.amount == null) act.args.amount = n;
        return acts;
      },
      answer(m, ctx, results) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        if (!results?.length) return line(a, 'ans_offer', { coins: parseInt(m.groups?.n, 10) || 0 });
        if (refused(results)) return null;
        return firstMessage(results) || null;
      },
    },
    {
      id: 'autonomy.promise',
      patterns: [/^(?:i (?:promise|swear)(?: (?:to )?you)?|you have my word|i give you my word|on my honou?r)(?:,? that)?[,:]?(?:\s+(?<text>.{3,}))?$/i],
      command: true,
      confidence: 0.9,
      actions(m, ctx) {
        const a = autonomyOf(ctx);
        const text = String(m.groups?.text || '').trim();
        // A bare "I promise" only means something as a yes to what she just asked.
        if (!text && !(a?.pendingRequest && a.now() - a.pendingRequest.t < 120)) return [];
        return [{ name: 'promise', args: { target: 'player', value: text || a.pendingRequest.text, amount: null } }];
      },
      answer(m, ctx, results) {
        const a = autonomyOf(ctx);
        if (!a) return null;
        if (!results?.length) return line(a, 'ans_promise_ask');
        if (refused(results)) return null;
        const broken = a.promises.filter((p) => p.by === 'player' && p.state === 'broken' && a.now() - (p.resolvedAt || 0) < 3 * a.daySeconds()).length;
        return line(a, broken >= 1 || a.stats().trust < 20 ? 'ans_promise_doubt' : 'ans_promise_noted');
      },
    },
    {
      id: 'autonomy.dismiss',
      patterns: [
        /^(?:you (?:can|may) go(?: now)?|you(?:'re| are) free to go|go (?:and )?(?:do|live) your own (?:thing|life|day)|do your own thing(?: today| for a while)?|take (?:the|a) day (?:off|for yourself)|go enjoy your day|have a day to yourself|you don'?t have to (?:come|stay) with me(?: today)?)$/i,
      ],
      command: true,
      confidence: 0.88,
      actions() {
        return [{ name: 'leave_player', args: { target: null, value: 'apart', amount: null } }];
      },
      answer(m, ctx, results) {
        if (refused(results)) return null;
        return firstMessage(results) || null;
      },
    },
  ],

  // Where she stands with the player, for Claude (DESIGN §16.10), under 900 characters.
  promptContext(ctx) {
    const a = autonomyOf(ctx);
    if (!a) return '';
    try {
      return a.promptText(900);
    } catch (err) {
      console.error('[autonomy] prompt context failed', err);
      return '';
    }
  },
};
