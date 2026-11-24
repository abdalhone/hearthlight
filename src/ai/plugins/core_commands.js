import { cmd, act, firstMessage, cleanRef, parseDuration } from '../behavior/phrases.js';
import { goalPhrase, dist } from '../behavior/util.js';
import { say } from '../behavior/lines.js';
import { isFriend, isThreat } from '../behavior/combat_ai.js';

// Core orders: where Lyra goes and how she fights. Every action returns
// { ok, message } with the message in her voice (an acknowledgement, or why not).

const ABSENT = { ok: false, message: "I'm not here right now." };

function body(ctx) {
  return ctx?.behavior || ctx?.companion?.behavior || null;
}

function distanceWord(v) {
  const t = String(v || '').toLowerCase();
  if (/close|near|tight|side|elbow/.test(t)) return 'close';
  if (/far|back|distance|loose|room|space/.test(t)) return 'far';
  return 'normal';
}

const answer = (m, ctx, results) => firstMessage(results);

export const coreCommandsPlugin = {
  id: 'core_commands',
  name: 'Core commands',
  description: 'Follow, stay, wait, travel, combat modes, attack, retreat, guard, patrol, explore, free will, emotes.',

  actions: {
    follow: {
      description: 'Follow someone (default: the player) as a standing order.',
      params: { target: 'who to follow (default the player)', value: "distance: 'close' | 'normal' | 'far'" },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.setDirective({ type: 'follow', target: args.target || 'player', distance: distanceWord(args.value) });
      },
    },
    stay: {
      description: 'Hold position here, or go to a place and hold there.',
      params: { target: 'optional place to go and hold at' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        if (args.target && !/^(here|this spot|right here)$/i.test(args.target.trim())) {
          const r = b.setDirective({ type: 'goto', target: args.target, then: 'stay' });
          if (r.ok) r.message = say.stayAt(goalPhrase(ctx.game, b.goal));
          return r;
        }
        return b.setDirective({ type: 'stay' });
      },
    },
    wait: {
      description: 'Pause here for a while, then resume the previous order.',
      params: { amount: 'seconds to wait (default 30)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.setDirective({ type: 'wait', seconds: args.amount ?? 30 });
      },
    },
    come_here: {
      description: 'Walk to the player now, then follow.',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.comeHere() : ABSENT;
      },
    },
    goto: {
      description: 'Travel to a place, person or object.',
      params: { target: 'place/person/object (e.g. "the inn", "Bram", "campfire")', value: "then: 'stay' (default) | 'follow' | 'return'" },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        if (!args.target) return { ok: false, message: 'Go where? Name a place and I will find it.' };
        const then = ['stay', 'follow', 'return'].includes(args.value) ? args.value : 'stay';
        return b.setDirective({ type: 'goto', target: args.target, then });
      },
    },
    set_combat_mode: {
      description: 'Combat stance: attack (engage everything that is not a friend), defend (protect the player and herself), passive (never attack, still heal).',
      params: { value: "'attack' | 'defend' | 'passive'" },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.setStance(args.value || args.target || 'defend');
      },
    },
    attack: {
      description: 'Attack a specific target now. Refuses friends (the player, villagers, anyone she counts as a friend).',
      params: { target: 'who to attack (name, id, or kind like "wolf"; default: the nearest threat)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.focus(cleanRef(args.target));
      },
    },
    retreat: {
      description: 'Disengage from any fight and regroup with the player.',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.retreat() : ABSENT;
      },
    },
    guard: {
      description: 'Guard a place or a person (default: right here).',
      params: { target: 'place or person to guard (default here)', amount: 'radius in pixels (default 96)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        const t = args.target && !/^(here|this spot|this place|this area|the area|right here)$/i.test(args.target.trim()) ? args.target : null;
        return b.setDirective({ type: 'guard', target: t, radius: args.amount ?? undefined });
      },
    },
    patrol: {
      description: 'Walk a patrol loop around a location (default: where she is).',
      params: { target: 'location to patrol (default the current one)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        const loc = args.target && !/^(here|around here|this area|the area)$/i.test(args.target.trim()) ? args.target : null;
        return b.setDirective({ type: 'patrol', location: loc });
      },
    },
    explore: {
      description: 'Explore a location, then come back and report.',
      params: { target: 'location to explore' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.setDirective({ type: 'explore', location: args.target || null });
      },
    },
    free_will: {
      description: 'Let her do as she likes near the player: wander, gather, rest, sleep at night.',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.setDirective({ type: 'free' }) : ABSENT;
      },
    },
    emote: {
      description: 'Play an emote: wave, laugh, bow, dance, hug, think, sit, cheer, shrug, cry, angry.',
      params: { value: 'emote name' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.emote(args.value || args.target);
      },
    },
    sit: {
      description: 'Sit down (by the nearest fire or bench if one is close).',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.sit() : ABSENT;
      },
    },
  },

  // Order matters: specific phrasings first (stances before "attack <x>", waits
  // with a duration before plain "stay").
  intents: [
    {
      id: 'core.stance_attack',
      patterns: [
        cmd(String.raw`(?:(?:go|switch|change|get|turn|set|put)\s+(?:yourself\s+)?(?:in)?to\s+|enter\s+|use\s+|activate\s+|enable\s+)?(?:attack|aggressive|offensive|aggro|hunting|kill|combat|battle)\s+(?:mode|stance)(?:\s+on)?`),
        cmd(String.raw`(?:go|get|be|turn|stay|play)\s+(?:aggressive|offensive|on the offensive|all out|wild|hunting|hostile)`),
        cmd(String.raw`(?:kill|attack|fight|hit|take (?:out|down)|shoot|destroy|clear out|wipe out|slay|hunt)\s+(?:every|any|all)(?:thing|one|body|\s+of them|\s+enemies|\s+monsters|\s+hostiles|\s+creatures)?(?:\s+(?:that|who|which)(?:'s|'re|\s+is|\s+are)?\s+(?:not|isn't|aren't|isnt|arent)(?:\s+(?:a|our|my))?\s+(?:friends?|friendly|allies|ally))?(?:\s+(?:in sight|you see|that moves|nearby|around(?: here)?|hostile|out there))?`),
        cmd(String.raw`(?:weapons free|no mercy|show no mercy|fire at will|open fire|light (?:them|em|'em) up|go ham|let loose|gloves off)`),
      ],
      command: true,
      confidence: 0.92,
      actions: () => [act('set_combat_mode', null, 'attack')],
      answer,
    },
    {
      id: 'core.stance_defend',
      patterns: [
        cmd(String.raw`(?:(?:go|switch|change|get|turn|set|put)\s+(?:yourself\s+)?(?:in)?to\s+|enter\s+|use\s+)?(?:defend|defensive|defense|defence|guard|protect(?:ive)?|normal)\s+(?:mode|stance)`),
        cmd(String.raw`(?:go|get|be|stay|play)\s+(?:defensive|on the defensive|careful)`),
        cmd(String.raw`(?:defend|protect|cover|shield)\s+(?:me|us)(?:\s+(?:from|against)\s+[\w' -]+)?`),
        cmd(String.raw`(?:watch|guard|cover|have|got)\s+my\s+back`),
        cmd(String.raw`keep (?:me|us) safe`),
        cmd(String.raw`only fight (?:back|if (?:they|something|anything|we're|i'm|we are|i am)\s+(?:attack|attacks|attacked|attacking)(?: us| me)?)`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('set_combat_mode', null, 'defend')],
      answer,
    },
    {
      id: 'core.stance_passive',
      patterns: [
        cmd(String.raw`(?:(?:go|switch|change|get|turn|set|put)\s+(?:yourself\s+)?(?:in)?to\s+|enter\s+|use\s+)?(?:passive|peaceful|pacifist|peace|calm|non-?violent)\s+(?:mode|stance)`),
        cmd(String.raw`(?:go|be|get|stay|turn|play)\s+(?:passive|peaceful|calm|pacifist|nice)`),
        cmd(String.raw`(?:stop|quit|cease|no more)\s+(?:fighting|attacking|shooting|combat|the fighting|killing)`),
        cmd(String.raw`(?:don'?t|do not|never)\s+(?:fight|attack|shoot|hurt|kill)(?:\s+(?:anything|anyone|anybody|them|it|unless i say so))?`),
        cmd(String.raw`(?:hold|cease)\s+(?:your\s+)?fire`),
        cmd(String.raw`(?:stand down|weapons down|lower your (?:staff|weapon|weapons)|leave (?:them|it) alone|no fighting|stay out of (?:it|the fight|fights|trouble))`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('set_combat_mode', null, 'passive')],
      answer,
    },
    {
      id: 'core.retreat',
      patterns: [cmd(String.raw`(?:retreat|fall back|pull back|back off|disengage|regroup|run(?: away)?|flee|get out of there|run for it|withdraw|abort|get back here now|leave it)`)],
      command: true,
      confidence: 0.92,
      actions: () => [act('retreat')],
      answer,
    },
    {
      id: 'core.attack',
      patterns: [
        cmd(
          String.raw`(?:attack|kill|shoot|fight|hit|blast|zap|take (?:out|down)|go after|deal with|focus(?: on| fire on)?|target|get rid of|finish off|smite|slay|engage|help me (?:fight|kill|with))\s+(?!(?:mode|stance|every|any|all)\w*\b|the (?:road|hay|sack)\b)(?<who>[a-z][\w' -]{0,30}?)`,
        ),
        cmd(String.raw`(?:get|sic|bite|after) (?<who>him|her|it|them|'?em)`),
      ],
      command: true,
      confidence: 0.88,
      actions: (m) => [act('attack', cleanRef(m.groups?.who))],
      answer,
    },
    {
      id: 'core.wait',
      patterns: [
        cmd(
          String.raw`(?:wait|stay|hang on|hold on|hang tight|hold up|hang back)(?:\s+(?:here|there|right here|a bit|around))?\s+(?:for\s+)?(?<dur>an? (?:minute|min|moment|sec|second|bit|while|little while)|(?:\d+|[a-z]+)\s+(?:minutes?|mins?|seconds?|secs?)|a couple (?:of )?minutes|a few (?:minutes|seconds|moments))`,
        ),
        cmd(String.raw`(?:wait|hang on|hold on|hang tight|hold up|one moment|one sec(?:ond)?|just a (?:sec(?:ond)?|moment|minute)|give me (?:a|one) (?<dur>sec(?:ond)?|moment|minute))`),
      ],
      command: true,
      confidence: 0.86,
      actions: (m) => {
        let d = m.groups?.dur || null;
        if (d && !/^(an?|\d|[a-z]+\s)/.test(d)) d = `a ${d}`;
        return [act('wait', null, null, parseDuration(d) ?? 30)];
      },
      answer,
    },
    {
      id: 'core.stay_at',
      patterns: [cmd(String.raw`(?:stay|wait|remain|hold)\s+(?:at|in|by|near|inside|outside)\s+(?!here\b|there\b)(?<place>[a-z][\w' -]{1,40}?)(?:\s+for me)?`)],
      command: true,
      confidence: 0.86,
      actions: (m) => [act('stay', cleanRef(m.groups?.place))],
      answer,
    },
    {
      id: 'core.follow_close',
      patterns: [
        cmd(String.raw`(?:stay|stick|keep|walk|remain)\s+(?:close|closer|near(?:by)?|beside me|by my side|at my side|next to me)(?:\s+to me)?`),
        cmd(String.raw`(?:don'?t|do not) (?:leave|stray from|wander from) my side`),
        cmd(String.raw`follow (?:me )?(?:closely|close)(?: behind)?`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('follow', 'player', 'close')],
      answer,
    },
    {
      id: 'core.follow_far',
      patterns: [
        cmd(String.raw`(?:keep|give me)\s+(?:your\s+|some\s+|a little\s+|a bit of\s+)?(?:distance|space|room)`),
        cmd(String.raw`(?:hang|stay|keep|lag)\s+back(?:\s+a\s+(?:bit|little))?`),
        cmd(String.raw`follow (?:me )?(?:from (?:a )?(?:distance|afar|behind)|at a distance)`),
      ],
      command: true,
      confidence: 0.88,
      actions: () => [act('follow', 'player', 'far')],
      answer,
    },
    {
      id: 'core.stay',
      patterns: [
        cmd(String.raw`(?:stay|wait|remain|stand|stop)\s+(?:here|there|put|right here|right there|where you are|still|in place|back here)`),
        cmd(String.raw`stay`),
        cmd(String.raw`hold (?:this|the|that|your)\s+(?:spot|position|ground|place|line)`),
        cmd(String.raw`hold (?:here|position|still)`),
        cmd(String.raw`(?:don'?t|do not) (?:move|follow me)(?:\s+from (?:here|there))?`),
        cmd(String.raw`wait (?:for me|up)(?:\s+(?:here|there))?`),
        cmd(String.raw`(?:camp|post up|set up camp)\s+(?:here|there)`),
        cmd(String.raw`(?:keep|guard) (?:my|this) (?:spot|seat) (?:warm|for me)`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('stay')],
      answer,
    },
    {
      id: 'core.come_here',
      patterns: [
        cmd(String.raw`(?:come|get|run|hurry|walk)\s+(?:over\s+)?(?:here|to me|back here|back to me|over)`),
        cmd(String.raw`(?:come|get)\s+back`),
        cmd(String.raw`(?:over here|to me|regroup with me|catch up|come find me|find me)`),
        cmd(String.raw`come here(?:,? (?:girl|you))?`),
      ],
      command: true,
      confidence: 0.9,
      actions: () => [act('come_here')],
      answer,
    },
    {
      id: 'core.follow',
      patterns: [
        cmd(String.raw`(?:follow|come with|come along with|walk with|tag along with|stick with|keep up with)\s+(?:me|us)`),
        cmd(String.raw`follow(?:\s+along)?`),
        cmd(String.raw`(?:let'?s|lets)\s+(?:go|move|roll|head out|get going|move out|get moving)`),
        cmd(String.raw`(?:come along|come on|on me|with me|keep up|follow my lead|after me|this way|move out|we'?re leaving)`),
        cmd(String.raw`(?:resume|go back to|start|keep)\s+following(?:\s+me)?`),
      ],
      command: true,
      confidence: 0.92,
      actions: () => [act('follow', 'player', 'normal')],
      answer,
    },
    {
      id: 'core.follow_other',
      patterns: [cmd(String.raw`follow\s+(?!me\b|us\b|along\b|my\b)(?<who>[a-z][\w' -]{1,30}?)`)],
      command: true,
      confidence: 0.85,
      actions: (m) => [act('follow', cleanRef(m.groups?.who) || 'player', 'normal')],
      answer,
    },
    {
      id: 'core.goto',
      patterns: [
        cmd(
          String.raw`(?:go|head|walk|run|travel|get|make your way|hurry|move)\s+(?:over\s+|back\s+|on\s+|down\s+|up\s+)?(?:to|into|in to|toward|towards)\s+(?!(?:sleep|bed|work|following|guard|patrol|explore)\b)(?<place>[a-z][\w' -]{1,40}?)`,
        ),
        cmd(String.raw`(?:meet|wait for) me (?:at|in|by|outside|inside) (?<place>[a-z][\w' -]{1,40}?)`),
        cmd(String.raw`(?:go|head|run)\s+(?:back\s+)?(?<place>home)`),
      ],
      command: true,
      confidence: 0.86,
      actions: (m) => [act('goto', cleanRef(m.groups?.place), 'stay')],
      answer,
    },
    {
      id: 'core.guard',
      patterns: [
        cmd(String.raw`(?:guard|protect|defend|watch over|keep watch (?:over|on|at)|stand guard (?:over|at|by|on)|keep an eye on)\s+(?!me\b|us\b|my back\b)(?<what>[a-z][\w' -]{1,40}?)`),
        cmd(String.raw`(?:stand guard|keep watch|keep a lookout|keep lookout|be on (?:the )?lookout|guard (?:here|this spot|this place|this area|the area))(?:\s+here)?`),
        cmd(String.raw`guard (?<what>me|us)`),
      ],
      command: true,
      confidence: 0.86,
      actions: (m) => {
        const w = m.groups?.what;
        const target = /^(me|us)$/i.test(w || '') ? 'player' : cleanRef(w);
        return [act('guard', target)];
      },
      answer,
    },
    {
      id: 'core.patrol',
      patterns: [
        cmd(
          String.raw`(?:patrol|do (?:a |the )?(?:rounds|patrol)|walk the (?:rounds|perimeter|walls)|make (?:the |your )?rounds)(?:\s+(?:around|through|in|of|at|across))?(?:\s+(?!here\b)(?<where>[a-z][\w' -]{1,40}?))?(?:\s+here)?`,
        ),
      ],
      command: true,
      confidence: 0.88,
      actions: (m) => [act('patrol', cleanRef(m.groups?.where))],
      answer,
    },
    {
      id: 'core.explore',
      patterns: [
        cmd(String.raw`(?:explore|scout(?: out)?|survey|have a look around|look around)\s+(?:around\s+|in\s+|through\s+)?(?!here\b)(?<where>[a-z][\w' -]{1,40}?)`),
        cmd(String.raw`(?:go\s+)?(?:exploring|scouting|explore|scout ahead|scout around|look around)(?:\s+here)?`),
      ],
      command: true,
      confidence: 0.86,
      actions: (m) => [act('explore', cleanRef(m.groups?.where))],
      answer,
    },
    {
      id: 'core.free',
      patterns: [
        cmd(String.raw`(?:do|go do) (?:whatever|what(?:ever)?) you (?:want|like|wish|please|feel like)(?: to(?: do)?)?`),
        cmd(String.raw`do (?:your (?:own )?thing|as you (?:please|wish|like))`),
        cmd(String.raw`(?:you'?re|you are) (?:free|off duty|on your own|dismissed)(?: to go)?`),
        cmd(String.raw`(?:free (?:will|time|roam(?:ing)?)|at ease|take (?:a|some) (?:break|time off|time for yourself)|go (?:have fun|play|relax)|have fun|relax|suit yourself|be free|off you go|dismissed|you'?re off the clock)`),
        cmd(String.raw`you can do (?:whatever|what) you (?:want|like)`),
      ],
      command: true,
      confidence: 0.88,
      actions: () => [act('free_will')],
      answer,
    },
    {
      id: 'core.emote',
      patterns: [
        cmd(String.raw`(?:give me a |do a |do the |can i get a |show me a |let me see a )?(?<emote>wave|dance|laugh|bow|cheer|shrug|cry|jig|curtsy|curtsey|giggle|celebrate)(?:\s+(?:at me|for me|with me|to me|hello|a little|for us|again))?`),
        cmd(String.raw`(?:give me|i need|how about|can i have|can i get) a (?<emote>hug)`),
        cmd(String.raw`(?<emote>hug|embrace) me`),
        cmd(String.raw`(?:think about it|have a think)`),
        cmd(String.raw`(?:be|get|look|act) (?<emote>angry|mad)`),
        cmd(String.raw`(?:say hi|say hello|wave hello)`),
      ],
      command: true,
      confidence: 0.85,
      actions: (m) => {
        let e = m.groups?.emote;
        if (!e) e = /think/i.test(m[0]) ? 'think' : 'wave';
        return [act('emote', null, e.toLowerCase())];
      },
      answer,
    },
    {
      id: 'core.sit',
      patterns: [cmd(String.raw`(?:sit(?:\s+down)?|take a seat|have a seat|take a load off|rest your (?:legs|feet)|sit by the fire|sit (?:with|next to|beside) me|park it)`)],
      command: true,
      confidence: 0.88,
      actions: () => [act('sit')],
      answer,
    },
  ],

  // Player-issued orders from the HUD bar and hotkeys get a spoken acknowledgement.
  onEvent(type, payload, ctx) {
    if (type !== 'companion_action' || payload?.source !== 'player' || !payload.message) return;
    const b = body(ctx);
    b?.say?.(payload.message, { force: true });
  },

  promptContext(ctx) {
    const b = body(ctx);
    if (!b) return '';
    const g = ctx.game;
    const a = b.actor;
    const d = b.directive;
    const lines = [];
    let order = b.status();
    if (d.type === 'follow') order += ` (${d.distance || 'normal'} distance)`;
    if (d.type === 'guard' && d.radius) order += ` (radius ${d.radius}px)`;
    lines.push(`Standing order: ${order}. Combat mode: ${b.stance}.`);
    const t = b.currentTarget;
    if (t) lines.push(`Fighting: ${t.name || t.species} (id ${t.id})${b.focusTarget === t ? ', focused on your order' : ''}.`);
    const threats = [];
    for (const e of g.entities?.list || []) {
      if (threats.length >= 4) break;
      if (e === a || e.type !== 'actor' || !e.isAlive?.()) continue;
      const dd = dist(a.x, a.y, e.x, e.y);
      if (dd > 200 || isFriend(g, a, e)) continue;
      threats.push(`${e.name || e.species} (id ${e.id}${isThreat(g, a, e) ? ', hostile' : ''}, ${Math.round(dd)}px)`);
    }
    if (threats.length) lines.push(`Not friends nearby: ${threats.join(', ')}.`);
    lines.push('Orders persist until changed. "attack" refuses friends; attack mode engages every non-friend.');
    return lines.join('\n').slice(0, 880);
  },
};
