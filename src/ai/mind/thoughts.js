import { PLAYER_ID } from '../../core/constants.js';
import { pick, cap, firstName, playerRef, partOfDay, shorten, firstSentence, placePhrase, joinList } from './text.js';
import { STAGE_THOUGHTS } from './maren.js';
import { bondOf } from './relationships.js';
import { activeGoals } from './goals.js';
import { jobId } from './perception.js';
import { describeBlock } from './autonomy_agenda.js';

// Spontaneous thoughts. Every 25-45 s of play she may think something drawn from what
// is really around her: the place, the weather and hour, the people near her, her
// needs, her goals, the Maren arc, a memory, or a habit from her soul. Templates use
// {P} (the player), {place}, {at} ("in the Whisperwood"), {n} (someone nearby).

const PLACE_THOUGHTS = {
  kings_road: ["The King's Road. I keep checking the treeline for grey shapes.", 'Two days ago the wolves came out of the trees right about here. Funny how a road looks so ordinary in daylight.'],
  hearthvale: ['Woodsmoke and bread. Hearthvale smells like every year of my life.', "Every chimney in Hearthvale is going. I'd know this valley blindfolded. Mam practically does."],
  town_square: ['The notice board is three layers deep, and Pip has posted about Biscuit again.', "The well, the notice board, Elda's voice from the Kettle. And under all of it, the Wellstone humming."],
  player_home: ["The Wayhouse. Jory Fallow's books are still on the shelf.", 'My trunk at the foot of the spare bed, locked. Some things stay mine.'],
  ember_kettle: ['The Ember Kettle. Honey cakes are within reach. Stay strong, Lyra.', "Elda's hearth has been lit for three hundred years. I want to fall asleep in front of it like a cat."],
  smithy: ['Hot iron and honest work. I love the smell of a forge.', "Bram's hammer, and Tilly's a little off the beat. You could set the hours by them."],
  general_store: ['Every shelf in here has a price, and every price has a story, if you ask Garrick.', "I'm counting my coins in here. Out of respect for Garrick's talents."],
  chapel: ['Thirty-eight flames on the altar. I count them every time. Everyone does.', 'The road-candle in the window. Sixty years and it has never once gone out.'],
  herbalist: ["Silverleaf, feverfew, mint. Mira's shop smells like every sickroom I ever sat in. And like the cure.", 'Mira labels her jars in three colors of ink. I respect that enormously.'],
  guardhouse: ['The guardhouse. Everyone in here stands a little straighter.', "Rowan's map of the valley has the bandit camp circled three times."],
  farmhouse: ["Tobias's kitchen. There's a turnip on every surface. I'm not judging.", 'A farmhouse that smells of bread and worry. Tobias, all over.'],
  reed_farm: ["Tobias's turnips, in tidy rows. Boar tracks along the fence.", 'Good soil. Da always says you can smell a good harvest coming.'],
  whisperwood: ["The Whisperwood. The trees lean in like they're listening.", "Mam's hives are along the near edge. I can hear them from here.", 'Wolf tracks. Old ones. ...Mostly old ones.'],
  stonecut_quarry: ["Stonecut Quarry. The Cut is under that north face, behind Bram's stakes. I don't look at it.", 'Slimes in the quarry pools. Only the quarry pools. That bothers me more than it should.'],
  bandit_camp: ['The bandit camp. Breathe. Count them. Then count them again.', 'Smoke, stolen goods and too many knives. I hate this place already.'],
  mirror_lake: ["Mirror Lake. So still it holds the whole sky. Don't look at the deep part.", "I'll stay on the dock, thank you. Near the dock. Somewhere near the dock."],
  sunken_ruins: ['The Sunken Ruins. Maren went over this wall. Maren went over this wall.', "Lanternwright stone. It hums if you stand still. I don't like standing still here."],
  south_meadow: ["The South Meadow. Flowers to the knees. I'm going to pick some and pretend it's for practical reasons.", 'Rabbits everywhere. Nobody hurt them, please.'],
  chandlery: ["The chandlery. Wax, wicks and Mam's songs. The old home.", "Da's dipping-vat. When I was small I thought candles grew on the racks."],
  lamplight_lane: ['Lamplight Lane. I could walk it with my eyes shut. Da very nearly does.', 'The far lamps along the lane. Somebody has to see to them.'],
  ashby_house: ["Ashby House. I can feel the Reeve's ledger from the doorstep.", "Petra's voice through the Ashby window. Somebody's being told how they were born."],
  dye_cottage: ["The dye-vats. The stream runs violet and teal below Beth's yard.", "Beth's cottage. Hess's bow by the door, Beth's needle in everything else."],
  weavers_row: ["Weavers' Row. Nan Pike's loom, and three Pike girls arguing over it.", 'The clack of the loom. Half the village is wearing something from that room.'],
  net_shed: ["Corran's net-shed. Smells of fish and lake and pipe smoke.", 'Nets drying on the rail. Corran humming somewhere close.'],
  wenna_hives: ["Mam's hives. The bees know me. Most of them approve.", 'Lindenflower and bees. She sings to them. They like it better than they like me.'],
};

const KIND_THOUGHTS = {
  forest: ['Trees this old have seen worse than us. Somehow that helps.', 'Every branch out here creaks like it has an opinion.'],
  lake: ['Still water. I keep to the shallow side, always.'],
  ruins: ['Old stone, older magic. Watch where you step.'],
  camp: ['Too many tents, too few honest faces.'],
  field: ['Open sky in every direction. My shoulders finally come down from my ears.'],
  road: ['Roads are just long promises. This one goes somewhere I want to be.'],
  building: ['I count the ways out of every room I walk into. A habit from the Cut.'],
  village: ['Lamps in windows, smoke from chimneys. Places like this are worth guarding.'],
  square: ['Everyone passes through a square sooner or later. Good place to wait for news.'],
  home: ['A roof, a bed, a fire. Most of what anybody needs.'],
};

function rand(mind) {
  const r = mind?.game?.rng;
  return r && typeof r.next === 'function' ? r.next() : Math.random();
}

function fill(text, ctx, extra = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => {
    if (extra[k] != null) return extra[k];
    if (k === 'P') return ctx.P;
    if (k === 'place') return ctx.loc?.name || 'here';
    if (k === 'at') return ctx.at;
    if (k === 'time') return ctx.part;
    return m;
  });
}

export class ThoughtGenerator {
  constructor(mind) {
    this.mind = mind;
    this.timer = 18 + rand(mind) * 10;
    this.recentKeys = [];
    this.recentTexts = [];
    this.pending = [];
    this.lastShown = -Infinity;
  }

  // Bring the next thought closer (something just changed worth thinking about).
  nudge(seconds) {
    this.timer = Math.min(this.timer, seconds);
  }

  // A specific thought soon (first sight of a place, ...).
  queue(kind, data, delay = 1.5) {
    if (this.pending.length < 4) this.pending.push({ kind, data, delay });
  }

  placeLine(loc) {
    const list = PLACE_THOUGHTS[loc?.id] || KIND_THOUGHTS[loc?.kind];
    return list ? fill(list[0], this.context()) : '';
  }

  update(dt) {
    if (this.pending.length) {
      const p = this.pending[0];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.pending.shift();
        const text = this.fromQueued(p);
        if (text) this.emit({ key: `q:${p.kind}:${p.data?.id || ''}`, text }, 'place', 12);
      }
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 25 + rand(this.mind) * 20;
    const o = this.mind.owner;
    if (!o || o.downed || o.state === 'sleep' || this.mind.game?.state !== 'playing') return;
    const t = this.generate();
    if (t) this.emit(t, 'idle', 30);
  }

  emit(t, source, minGap) {
    this.recentKeys.push(t.key);
    if (this.recentKeys.length > 16) this.recentKeys.shift();
    this.recentTexts.push(t.text);
    if (this.recentTexts.length > 24) this.recentTexts.shift();
    this.mind.addThought(t.text, source, { show: true, minGap });
  }

  fromQueued(p) {
    if (p.kind === 'clue' && p.data?.text) {
      // A piece of one of her open questions, found just now.
      return `${shorten(p.data.text, 120).replace(/[.!]?$/, '.')} Another piece. I don't like where it points.`;
    }
    if (p.kind === 'place' && p.data) {
      const ctx = this.context();
      const list = PLACE_THOUGHTS[p.data.id] || KIND_THOUGHTS[p.data.kind];
      if (!list) return null;
      return fill(list[list.length > 1 ? 1 : 0], ctx);
    }
    return null;
  }

  // Everything the templates may use, gathered once per thought.
  context() {
    const m = this.mind;
    const g = m.game;
    const o = m.owner;
    const loc = m.place();
    const clock = g?.clock;
    const ctx = {
      game: g,
      mind: m,
      owner: o,
      P: playerRef(g),
      loc,
      at: placePhrase(loc),
      part: partOfDay(g),
      hour: clock?.hour ?? 12,
      night: !!clock?.isNight,
      phase: clock?.phase || 'day',
      weather: clock?.weather?.type || 'clear',
      indoor: m.perception.isIndoors(),
      needs: m.needs,
      pressing: m.needsEngine.pressing(0.3),
      mood: m.mood(),
      playerRel: m.relationships.get(PLAYER_ID),
      nearby: [],
      creatures: [],
      job: o?.behavior?.directive?.type === 'job' ? jobId(o.behavior.directive.job) : null,
      sitting: o?.state === 'sit',
      stage: m.questStage(),
      inv: o?.inventory,
    };
    const list = g?.entities?.all?.() || [];
    for (const e of list) {
      if (e === o || e.removed || e.type !== 'actor' || e.dead || e.id === PLAYER_ID) continue;
      const d = Math.hypot(e.x - o.x, e.y - o.y);
      if (d > 110) continue;
      const rel = m.relationships.map.get(e.id);
      if (rel && rel.kind !== 'group' && rel.firstMet != null) ctx.nearby.push({ e, rel, d });
      else if (e.species) ctx.creatures.push({ e, d });
    }
    ctx.nearby.sort((a, b) => a.d - b.d);
    return ctx;
  }

  generate() {
    const ctx = this.context();
    const cands = [];
    const add = (key, text, w = 1) => {
      if (!text || this.recentKeys.includes(key) || this.recentTexts.includes(text)) return;
      cands.push({ key, text, w });
    };
    this.placeCands(ctx, add);
    this.skyCands(ctx, add);
    this.needCands(ctx, add);
    this.peopleCands(ctx, add);
    this.playerCands(ctx, add);
    this.goalCands(ctx, add);
    this.memoryCands(ctx, add);
    this.lifeCands(ctx, add);
    this.selfCands(ctx, add);
    this.soulCands(ctx, add);
    this.activityCands(ctx, add);
    if (!cands.length) return null;
    let total = 0;
    for (const c of cands) total += c.w;
    let r = (this.mind.game?.rng?.next?.() ?? Math.random()) * total;
    for (const c of cands) if ((r -= c.w) <= 0) return c;
    return cands[cands.length - 1];
  }

  placeCands(ctx, add) {
    const loc = ctx.loc;
    if (!loc) return;
    const list = PLACE_THOUGHTS[loc.id] || KIND_THOUGHTS[loc.kind] || [];
    const fresh = this.mind.perception.rt() - this.mind.perception.placeSince < 120;
    list.forEach((t, i) => add(`place:${loc.id}:${i}`, fill(t, ctx), fresh ? 1.6 : 0.8));
  }

  skyCands(ctx, add) {
    const w = ctx.weather;
    if (w === 'rain') {
      if (ctx.indoor) {
        add('rain:in:0', "Rain on the roof. Best sound in the world. Don't tell anyone I said that.", 2);
        add('rain:in:1', 'Listen to that rain. I could sleep for a week.', 1.2);
      } else {
        add('rain:out:0', 'Rain. Bryn and I used to race paper boats down the gutters on Lamplight Lane in weather like this.', 1.5);
        add('rain:out:1', `Soaked to the braid ${ctx.at}. Wicks and ashes, this rain.`, 1.2);
      }
    } else if (w === 'fog') {
      add('fog:0', 'Grey in the morning, count your neighbors by noon. It is only fog, Lyra. Only fog.', 1.5);
      add('fog:1', fill("Can't see ten paces in this. Keep talking, {P}, so I know where you are.", ctx), 1.2);
    } else if (w === 'cloudy') {
      add('cloud:0', fill("Clouds sitting low over {place}. Rain before long, I'd bet.", ctx), 0.8);
      add('cloud:1', "Grey sky. Maren called this 'reading weather'.", 0.8);
    }
    if (ctx.night && !ctx.indoor && w === 'clear') {
      add('stars:0', "Clear sky. There's the Lantern Bearer rising. Maren said it points to anyone who's lost.", 2);
      add('stars:1', 'Stars like spilled salt. On the lamp-round with Da I learned every one by name.', 1.6);
    } else if (ctx.night) {
      add('night:0', `Night ${ctx.at}. Everything sounds closer in the dark.`, 1);
      add('night:1', "If I can't sleep tonight I'll count stars from the window.", 0.8);
    } else if (ctx.phase === 'dawn') {
      add('dawn:0', "Dawn. Maren used to say the first hour belongs to whoever's awake to claim it.", 1.5);
      add('dawn:1', fill('Morning light on {place}. Everything looks forgivable at dawn.', ctx), 1.2);
    } else if (ctx.phase === 'dusk') {
      const wolves = this.mind.memory.all().some((m) => m.tags.includes('wolves'));
      if (wolves && !ctx.indoor) add('dusk:0', "Dusk. That's when the wolves came on the King's Road. I keep checking the shadows.", 1.6);
      add('dusk:lamps', "Dusk. The bell, then Da's ladder on the first lamp-post. Somebody should see to the far ones.", 1.2);
      add('dusk:1', "The light's going gold. My favorite and least favorite hour.", 1);
    } else if (ctx.hour >= 11.5 && ctx.hour < 13.5 && w === 'clear' && !ctx.indoor) {
      add('noon:0', fill('Sun high over {place}. Somebody, somewhere, is eating lunch without me.', ctx), 0.8);
    }
  }

  needCands(ctx, add) {
    const p = ctx.pressing;
    if (!p) return;
    const w = 2.6;
    if (p === 'hunger') {
      add('need:hunger:0', fill('My stomach has been growling since {place}. A honey cake would fix everything. Several honey cakes.', ctx), w);
      add('need:hunger:1', "I'd trade my dagger for one of Elda's honey cakes. Not really. ...Mostly not really.", w);
      if (ctx.loc?.id === 'reed_farm') add('need:hunger:2', "Hungry. Is that a turnip? No. No, Lyra. Those are Tobias's.", w);
    } else if (p === 'energy') {
      add('need:energy:0', 'My feet are made of lead. One more hill and I am sleeping in it.', w);
      add('need:energy:1', ctx.night ? 'It is late. Even my sparks feel sleepy.' : "I'm yawning more than I'm talking. That's a first.", w);
    } else if (p === 'social') {
      const near = ctx.playerRel && this.mind.perception.near(ctx.game?.player, 90);
      add('need:social:0', near ? fill("{P}'s gone quiet. Thinking, or brooding?", ctx) : fill("It's been quiet a long while. {P}, say something. Anything.", ctx), w);
      add('need:social:1', "I talk to cats when nobody's around. Don't make me talk to a cat.", w * 0.8);
    } else if (p === 'fun') {
      const unseen = this.unseenPlace();
      add('need:fun:0', unseen ? `Same paths, same trees. I'm itching for somewhere new. ${unseen}, maybe?` : 'Same paths, same trees. I am itching for something new.', w);
      add('need:fun:1', "If nothing interesting happens soon I'm going to start rating clouds out of ten.", w * 0.8);
    } else if (p === 'safety') {
      add('need:safety:0', fill("I don't like this. Keep close, {P}.", ctx), w);
      add('need:safety:1', 'Every shadow here has teeth. Breathe, Lyra.', w);
    }
  }

  unseenPlace() {
    const all = this.mind.game?.locations?.all?.() || [];
    const seen = this.mind.perception.seenPlaces;
    const options = all.filter((l) => !seen.has(l.id) && !l.indoor && (l.danger || 0) < 3);
    return options.length ? pick(options, this.mind.game?.rng).name : null;
  }

  peopleCands(ctx, add) {
    for (const { e, rel } of ctx.nearby.slice(0, 3)) {
      const n = firstName(rel.name);
      const note = [...rel.notes].reverse().find((x) => x.source !== 'self' && !/^(i|my)\b/i.test(x.text));
      if (note) add(`people:note:${rel.id}`, `There's ${n}. ${shorten(note.text, 90).replace(/\.?$/, '.')} Who'd have guessed?`, 1.4);
      if (rel.tags.includes('pet')) add(`people:pet:${rel.id}`, `Hello, ${rel.name === 'Cat' ? 'cat' : n}. No, I'm not talking to you. ...Fine. Hello.`, 1.4);
      else if (rel.affinity >= 45) add(`people:fond:${rel.id}`, pick([`${n}! The day just got better.`, `Good to see ${n} about.`], this.mind.game?.rng), 1.2);
      else if (rel.affinity <= -10) add(`people:cold:${rel.id}`, `${n}. I'll keep my distance.`, 1.2);
      else if (rel.familiarity < 20) add(`people:new:${rel.id}`, `${n}. I still don't know much about ${n}. Yet.`, 1);
      if (rel.id === 'pip') add('people:pip', "Sprout's watching my hands again. When you're eleven, Pip. Not a day before.", 1.6);
      if (rel.id === 'aveline' && ctx.stage.index <= 1) add('people:aveline', "Sister Aveline. She knows something about Maren she hasn't said. I keep not asking.", 1.8);
      if (rel.id === 'hobb') add('people:hobb', 'Da. Spectacles on his head, looking for his spectacles.', 1.3);
      if (rel.id === 'wenna') add('people:wenna', "Mam's listening for me before she can see me. She always is.", 1.3);
      if (rel.tags.includes('enemy')) add(`people:enemy:${rel.id}`, `${n}. My hand's already near my dagger.`, 1.2);
    }
    const ids = new Set(ctx.nearby.map((x) => x.rel.id));
    if (ids.has('mira') && ids.has('rowan')) add('people:mira_rowan', 'Mira is pretending very hard not to look at Rowan. It is adorable.', 2);
    if (ids.has('elda') && ids.has('pip')) add('people:elda_pip', "Elda keeps one eye on Pip at all times. That's what love looks like when it's tired.", 1.4);
    const cat = ctx.creatures.find((c) => c.e.species === 'cat');
    if (cat) add('creature:cat', 'Hello, cat. No, I am not talking to you. ...Fine. Hello, cat.', 1.3);
    const harmless = ctx.creatures.find((c) => c.e.species === 'rabbit' || c.e.species === 'deer');
    if (harmless && !ctx.night) add(`creature:${harmless.e.species}`, `A ${harmless.e.species}, right there. Stay very still and maybe it will too.`, 0.8);
  }

  playerCands(ctx, add) {
    const rel = ctx.playerRel;
    if (!rel) return;
    const lvl = bondOf(rel).level;
    const P = ctx.P;
    if (lvl <= 1) {
      add('player:0', `Nobody lies warm in the snow. I still don't know what put ${P} in that ring.`, 0.9);
      add('player:1', `${cap(P)} stood beside me against the wolves instead of running. I noticed.`, 0.9);
    } else if (lvl === 2) {
      add('player:2', `I climbed that mountain for Maren and came down with ${P}. Some days I don't mind.`, 0.9);
      add('player:3', `${cap(P)} hums when they think nobody's listening. Badly. I like it.`, 0.7);
    } else if (lvl <= 4) {
      add('player:4', `Once we have that key, I'd go into the ruins with ${P}. That's not nothing.`, 0.9);
      add('player:5', `When did ${P} become the person I look for first in a room?`, 0.9);
    } else {
      add('player:6', 'Home is a person now. Maren would laugh at me.', 1);
    }
    if (rel.respect < 10 || rel.affinity <= -10) add('player:hurt', `I keep thinking about what ${P} did. I don't know what to make of it.`, 1.4);
    if (rel.fear >= 30) {
      add('player:fear:0', `I flinch when ${P} draws steel now. I never used to.`, 1.8);
      add('player:fear:1', `I keep a few steps between me and ${P}. Just in case. I hate that "just in case" is a thing now.`, 1.4);
    } else if (rel.fear >= 12) add('player:fear:2', `I'm watching ${P}'s hands more than I'd like to.`, 1.1);
  }

  // Her own life, apart from anyone (DESIGN §16): her plan, her purse, her choice.
  selfCands(ctx, add) {
    const m = this.mind;
    const P = ctx.P;
    const comp = m.companionship;
    if (comp === 'wary') add('self:wary', `I'm still here. Watching. ${cap(P)} has to earn the rest back.`, 1.8);
    else if (comp === 'apart') add('self:apart', "A day to myself. I'd forgotten how loud my own thoughts are.", 1.6);
    else if (comp === 'left') {
      add('self:left:0', `I don't need ${P}. I'll keep saying it until it's true.`, 1.8);
      add('self:left:1', 'Better alone than beside someone I have to watch.', 1.4);
    } else {
      add('self:choice:0', "I'm here because I chose to be. Funny how much that matters to me.", 0.5);
      add('self:choice:1', "Two swords are safer than one on these roads. That's part of why I stay. Only part.", 0.5);
    }
    const purse = Number(m.agenda?.purse);
    if (Number.isFinite(purse)) {
      if (purse < 5) add('self:purse:low', 'My purse is nearly empty. Honest work, and soon. Mira pays fair for silverleaf.', 1.1);
      else if (purse >= 20) add('self:purse:full', `${purse} coins of my own. A room at the Kettle if I need one, and a honey cake if I want one.`, 0.8);
    }
    const plan = m.currentPlan?.();
    if (plan?.activity) {
      const place = plan.at ? ctx.game?.locations?.get?.(plan.at)?.name || String(plan.at).replace(/_/g, ' ') : null;
      let what = '';
      try {
        what = describeBlock(plan, { place, npcName: plan.npc ? firstName(m.relationships.get(plan.npc)?.name || plan.npc) : null });
      } catch {
        what = '';
      }
      what = String(what || String(plan.activity).replace(/_/g, ' ')).replace(/[.!]+$/, '');
      const why = plan.why ? ` ${cap(String(plan.why).replace(/[.!]*$/, '.'))}` : '';
      const mine = plan.with !== 'player';
      add(`self:plan:${plan.activity}:${plan.from}`, mine ? `${cap(what)}: that's my plan for now.${why} My day, my choice.` : `${cap(what)}, for now.${why} Suits me.`, 1.2);
    }
  }

  // Her past, when something brings it up: what is on her mind first, else a chapter
  // that shares a person or place with where she is.
  lifeCands(ctx, add) {
    const m = this.mind;
    const tails = {
      sadness: "Some days it's right there under my ribs.",
      affection: "I'd give a lot for one more evening like that.",
      pride: 'I still stand a little taller for it.',
      fear: 'I can still feel how cold my hands were.',
      joy: 'Good days, those.',
      trust: 'Strange, how one evening can turn a whole road.',
      curiosity: 'I still wonder about it.',
    };
    let entry = null;
    const warm = m.workingMemory.list(6).find((it) => it.store === 'life' && it.activation > 0.25);
    if (warm) entry = (m.life || []).find((e) => e.id === warm.id) || null;
    if (!entry && ctx.loc && m.index) {
      const hit = m.index.byEntity(`place:${ctx.loc.id}`, { stores: ['life'], limit: 1 })[0];
      if (hit) entry = hit.ref;
    }
    if (!entry && ctx.night && (m.game?.rng?.next?.() ?? Math.random()) < 0.35) entry = pick((m.life || []).filter((e) => e.importance >= 7), m.game?.rng) || null;
    if (!entry) return;
    const first = firstSentence(entry.text, 110);
    const text = /^(I|My)\b/.test(first) && first.length < 90 ? first : `${entry.title.replace(/[.!]+$/, '')}. ${tails[entry.feeling] || 'Funny what comes back to you.'}`;
    add(`life:${entry.id}`, text, warm ? 1.6 : 0.9);
  }

  goalCands(ctx, add) {
    const stage = ctx.stage;
    const list = STAGE_THOUGHTS[stage.id];
    if (list) list.forEach((t, i) => add(`quest:${stage.id}:${i}`, fill(t, ctx), 1.3));
    for (const g of activeGoals(this.mind.goals).slice(0, 4)) {
      let text = null;
      if (g.id === 'the_stranger') text = fill("{P} said 'little lamp' in their sleep. I keep coming back to that.", ctx);
      else if (g.id === 'waystones') text = 'The dead waystone toward Saltmere. Three words of script got me one night of light. I need the rest.';
      else if (g.id === 'the_stone') text = 'The Sheaf Moot, and the stone question with it. Not yet. Not because they need me to.';
      else if (g.id === 'moonpetals') text = ctx.night ? 'Moonpetals are open by now, somewhere in the Whisperwood. One night soon.' : 'Moonpetals in the Whisperwood. One night soon.';
      else if (g.id === 'teach_pip') text = 'Two years until Pip is eleven. I am counting too. Do not tell him.';
      else if (g.id === 'follow_maren') text = "North, through the waygate. Maren's waiting. I can feel it.";
      else if (g.id !== 'find_maren' && g.source !== 'quest') text = `${g.text.replace(/[.!]$/, '')}. I haven't forgotten.`;
      if (text) add(`goal:${g.id}`, text, 0.9 + g.priority * 0.4);
    }
  }

  unmetVillagers() {
    const list = this.mind.game?.entities?.all?.() || [];
    const out = [];
    for (const e of list) if (e.profile && !this.mind.perception.met.has(e.id)) out.push(firstName(e.name));
    return out;
  }

  memoryCands(ctx, add) {
    const m = this.mind;
    let mem = null;
    const person = ctx.nearby[0]?.rel;
    if (person) mem = m.memory.recall('', { about: person.id, limit: 1, touch: false })[0];
    if (!mem && ctx.loc) mem = m.recall(ctx.loc.name, { limit: 1, touch: false })[0];
    if (!mem) {
      const important = m.memory.all().filter((x) => x.importance >= 6);
      mem = pick(important, m.game?.rng);
    }
    if (!mem) return;
    const gist = mem.gist || shorten(firstSentence(mem.text), 70).replace(/[.!]$/, '').toLowerCase();
    const P = ctx.P;
    const text = pick(
      [`Still thinking about ${gist}.`, `${cap(gist)}. That one stays with me.`, mem.about.includes(PLAYER_ID) ? `${cap(gist)}. I wonder if ${P} thinks about it too.` : `Funny how ${gist} keeps coming back to me.`],
      m.game?.rng,
    );
    add(`memory:${mem.id}`, text, 1);
  }

  soulCands(ctx, add) {
    const id = ctx.loc?.id;
    const kind = ctx.loc?.kind;
    if (ctx.night && (id === 'whisperwood' || id === 'south_meadow' || kind === 'forest')) add('soul:moonpetal', "Moonpetals open at this hour. If I see one glowing, we're stopping. Non-negotiable.", 2);
    if (id === 'mirror_lake' || kind === 'lake') add('soul:deepwater', "Don't look at the deep part. Don't look at the deep part.", 1.6);
    if (id === 'chapel') add('soul:books', "There's a book on that shelf older than Hearthvale. My fingers are itching.", 1.4);
    if (id === 'smithy') add('soul:forge', "Forge-smoke and hot iron. Smells like Da's dipping-room, somehow.", 1.2);
    if (ctx.inv?.has?.('honey_cake') && ctx.needs.hunger > 0.5) add('soul:cake', "There's a honey cake in my satchel. It's for emergencies. Emotional ones count.", 1.3);
    if (ctx.inv?.has?.('moonpetal')) add('soul:pressed', "I've a moonpetal pressed in my book. It still glows a little when I'm not looking.", 0.8);
    if (ctx.mood.valence > 0.3) add('soul:hum', "I keep humming Mam's bee-song. She'd be smug.", 0.7);
    if (ctx.mood.valence < -0.2) add('soul:pin', "I'm tapping my pin again. Keep your own wick, Lyra.", 1.1);
    if (ctx.indoor && this.mind.perception.firstVisit) add(`soul:doors:${id}`, 'I counted the ways out when we came in. Old habit from the Cut. Two. Good.', 1.2);
    if (id === 'town_square' && ctx.phase === 'dusk') add('soul:hum_hitch', "The Wellstone's hum. There it is again, that hitch at dusk. Since midsummer.", 1.2);
  }

  activityCands(ctx, add) {
    const job = ctx.job;
    const lines = {
      chop_wood: "Chop, stack, repeat. Maren called this 'meditation with splinters'.",
      fish: "Fishing is mostly waiting. I'm terrible at waiting.",
      mine_ore: 'Every swing of this pick, I hear Bram laughing at my form.',
      gather_herbs: 'Silverleaf for Mira, moonpetals for me. Fair trade.',
      forage: "Berries for me, herbs for the pack. One for the pack, two for me.",
      farm: "Tobias says turnips grow better if you talk to them. I've told them about Maren.",
      cook: "If this burns, I'm blaming the fire.",
    };
    if (job && lines[job]) add(`job:${job}`, lines[job], 2);
    if (ctx.sitting) {
      const o = ctx.owner;
      let fire = null;
      try {
        fire = o ? ctx.game?.objects?.nearest?.((x) => /campfire|hearth/.test(String(x.objType || '')), o.x, o.y, 72) : null;
      } catch {
        fire = null;
      }
      if (fire && ctx.needs.hunger > 0.45) add('sit:fire', 'A fire, a full stomach and quiet company. Longwatch at the chandlery felt like this.', 1.4);
      else if (fire) add('sit:fire_hungry', 'Warm hands, empty stomach. One out of two.', 1.2);
      else add('sit:rest', 'Off my feet for a moment. My boots and I are no longer on speaking terms.', 1);
    }
    const since = this.mind.perception.rt() - this.mind.perception.lastEncounterEnd;
    if (since < 40) add('after_fight', "Still shaking a little. Good shaking. Mostly.", 1.6);
  }
}
