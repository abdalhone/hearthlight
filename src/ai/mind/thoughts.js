import { PLAYER_ID } from '../../core/constants.js';
import { pick, cap, firstName, playerRef, partOfDay, shorten, firstSentence, placePhrase, joinList } from './text.js';
import { STAGE_THOUGHTS } from './maren.js';
import { bondOf } from './relationships.js';
import { activeGoals } from './goals.js';
import { jobId } from './perception.js';

// Spontaneous thoughts. Every 25-45 s of play she may think something drawn from what
// is really around her: the place, the weather and hour, the people near her, her
// needs, her goals, the Maren arc, a memory, or a habit from her soul. Templates use
// {P} (the player), {place}, {at} ("in the Whisperwood"), {n} (someone nearby).

const PLACE_THOUGHTS = {
  kings_road: ["The King's Road. I keep checking the treeline for grey shapes.", 'Two days ago I nearly died on this road. Funny how a road can look so ordinary in daylight.'],
  hearthvale: ['Woodsmoke and bread. Hearthvale smells like a place people stay.', 'Every chimney in Hearthvale is going. I could get used to this.'],
  town_square: ["The notice board's three layers deep. Somebody here always needs help with something.", "A well, a notice board, and Elda's voice carrying from the Kettle. That's a village square."],
  player_home: ["{P}'s cottage. My boots by the door. When did that start feeling normal?", "The spare bed is lumpy and I wouldn't trade it."],
  ember_kettle: ['The Ember Kettle. Honey cakes are within reach. Stay strong, Lyra.', "Elda's hearth could warm a whole fleet. I want to fall asleep in front of it like a cat."],
  smithy: ['Hot iron and honest work. I love the smell of a forge.', "Bram's hammer keeps better time than any drummer I've met."],
  general_store: ['Every shelf in here has a price, and every price has a story, if you ask Garrick.', "I'm counting my coins in here. Out of respect for Garrick's talents."],
  chapel: ['The chapel candle. Maren saw this same flame.', 'Old books on the chapel shelves. I could lose a week in here, easily.'],
  herbalist: ["Silverleaf, feverfew, marsh mallow. Mira's shop smells like every sickroom I ever sat in. And like the cure.", 'Mira labels her jars in three colors of ink. I respect that enormously.'],
  guardhouse: ['The guardhouse. Everyone in here stands a little straighter.', "Rowan's map of the valley has the bandit camp circled three times."],
  farmhouse: ["Tobias's kitchen. There's a turnip on every surface. I'm not judging.", 'A farmhouse that smells of bread and worry. Tobias, all over.'],
  reed_farm: ["Tobias's turnips, in tidy rows. Boar tracks along the fence.", 'Good soil. My father always said you could smell a good harvest coming.'],
  whisperwood: ["The Whisperwood. The trees lean in like they're listening.", 'Moonpetals grow somewhere in here. They only open at night.', 'Wolf tracks. Old ones. ...Mostly old ones.'],
  stonecut_quarry: ["Stonecut Quarry. Every chisel mark in that rock was somebody's long day.", 'Slimes in a quarry. Of course. Where else would you keep something wet and angry?'],
  bandit_camp: ['The bandit camp. Breathe. Count them. Then count them again.', 'Smoke, stolen goods and too many knives. I hate this place already.'],
  mirror_lake: ["Mirror Lake. Still as the lagoon at home. Don't look at the deep part.", "The water's so calm it holds the whole sky. I'll stay on the dock, thank you."],
  sunken_ruins: ['The Sunken Ruins. Maren walked in here. Maren walked in here.', "Lanternwright stone. It hums if you stand still. I don't like standing still here."],
  south_meadow: ["The South Meadow. Flowers to the knees. I'm going to pick some and pretend it's for practical reasons.", 'Rabbits everywhere. Nobody hurt them, please.'],
};

const KIND_THOUGHTS = {
  forest: ['Trees this old have seen worse than us. Somehow that helps.', 'Every branch out here creaks like it has an opinion.'],
  lake: ['Still water. I keep to the shallow side, always.'],
  ruins: ['Old stone, older magic. Watch where you step.'],
  camp: ['Too many tents, too few honest faces.'],
  field: ['Open sky in every direction. My shoulders finally come down from my ears.'],
  road: ['Roads are just long promises. This one goes somewhere I want to be.'],
  building: ['I always count the doors in a new place. Habit from the road.'],
  village: ['Lamps in windows, smoke from chimneys. Places like this are worth guarding.'],
  square: ['Everyone passes through a square sooner or later. Good place to wait for news.'],
  home: ['A roof, a bed, a fire. Most of what anybody needs.'],
};

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
    this.timer = 18 + Math.random() * 10;
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
    this.timer = 25 + Math.random() * 20;
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
        add('rain:out:0', 'Rain. Back home, the lighthouse gutters sang in weather like this.', 1.5);
        add('rain:out:1', `Soaked to the braid ${ctx.at}. Tides take this rain.`, 1.2);
      }
    } else if (w === 'fog') {
      add('fog:0', 'Fog like this rolls off the lagoon at home. You learn to listen instead of look.', 1.5);
      add('fog:1', fill("Can't see ten paces in this. Keep talking, {P}, so I know where you are.", ctx), 1.2);
    } else if (w === 'cloudy') {
      add('cloud:0', fill("Clouds sitting low over {place}. Rain before long, I'd bet.", ctx), 0.8);
      add('cloud:1', "Grey sky. Maren called this 'reading weather'.", 0.8);
    }
    if (ctx.night && !ctx.indoor && w === 'clear') {
      add('stars:0', "Clear sky. There's the Lantern Bearer rising. Maren said it points to anyone who's lost.", 2);
      add('stars:1', 'Stars like spilled salt. On Kettlewake I knew every one by name. I still do.', 1.6);
    } else if (ctx.night) {
      add('night:0', `Night ${ctx.at}. Everything sounds closer in the dark.`, 1);
      add('night:1', "If I can't sleep tonight I'll count stars from the window.", 0.8);
    } else if (ctx.phase === 'dawn') {
      add('dawn:0', "Dawn. Maren used to say the first hour belongs to whoever's awake to claim it.", 1.5);
      add('dawn:1', fill('Morning light on {place}. Everything looks forgivable at dawn.', ctx), 1.2);
    } else if (ctx.phase === 'dusk') {
      const wolves = this.mind.memory.all().some((m) => m.tags.includes('wolves'));
      if (wolves && !ctx.indoor) add('dusk:0', "Dusk. That's when the wolves found me on the King's Road. I keep checking the shadows.", 1.6);
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
      if (rel.id === 'pip') add('people:pip', "Pip's watching my hands again. One day, kid. One real cantrip, safely.", 1.6);
      if (rel.id === 'aveline' && ctx.stage.index <= 1) add('people:aveline', 'Sister Aveline. She knew Maren. I should ask her. I keep not asking her.', 1.8);
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
      add('player:0', `I still don't know what brought ${P} to Hearthvale. Running from something, or toward it?`, 0.9);
      add('player:1', `${cap(P)} stood beside me against a wolf pack without even knowing my name. Who does that?`, 0.9);
    } else if (lvl === 2) {
      add('player:2', `I'm glad it was ${P} on that road and not anyone else.`, 0.9);
      add('player:3', `${cap(P)} hums when they think nobody's listening. Badly. I like it.`, 0.7);
    } else if (lvl <= 4) {
      add('player:4', `I'd follow ${P} into the Sunken Ruins. I suppose I'm going to.`, 0.9);
      add('player:5', `When did ${P} become the person I look for first in a room?`, 0.9);
    } else {
      add('player:6', 'Home is a person now. Maren would laugh at me.', 1);
    }
    if (rel.respect < 10 || rel.affinity <= -10) add('player:hurt', `I keep thinking about what ${P} did. I don't know what to make of it.`, 1.4);
  }

  goalCands(ctx, add) {
    const stage = ctx.stage;
    const list = STAGE_THOUGHTS[stage.id];
    if (list) list.forEach((t, i) => add(`quest:${stage.id}:${i}`, fill(t, ctx), 1.3));
    for (const g of activeGoals(this.mind.goals).slice(0, 4)) {
      let text = null;
      if (g.id === 'repay_debt') text = fill("I owe {P} a life. I keep a tally in my head, and it's very lopsided.", ctx);
      else if (g.id === 'meet_village') {
        const unmet = this.unmetVillagers();
        text = unmet.length ? `Faces still to learn: ${joinList(unmet.slice(0, 3))}. I'm getting there.` : null;
      } else if (g.id === 'moonpetals') text = ctx.night ? 'Moonpetals are open by now, somewhere in the Whisperwood. One night soon.' : 'Moonpetals in the Whisperwood. One night soon.';
      else if (g.id === 'teach_pip') text = 'A cantrip for Pip. Something small and bright that cannot set anything on fire. ...Something that probably cannot.';
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
    if (id === 'smithy') add('soul:forge', "Forge-smoke and hot iron. Smells like my father's lamp room, somehow.", 1.2);
    if (ctx.inv?.has?.('honey_cake') && ctx.needs.hunger > 0.5) add('soul:cake', "There's a honey cake in my satchel. It's for emergencies. Emotional ones count.", 1.3);
    if (ctx.inv?.has?.('moonpetal')) add('soul:pressed', "I've a moonpetal pressed in my book. It still glows a little when I'm not looking.", 0.8);
    if (ctx.mood.valence > 0.3) add('soul:hum', 'I keep humming the old Kettlewake net-mending song. Mother would be smug.', 0.7);
    if (ctx.mood.valence < -0.2) add('soul:bead', "I'm tapping my bead again. Calm water, Lyra. Calm water.", 1.1);
    if (ctx.indoor && this.mind.perception.firstVisit) add(`soul:doors:${id}`, 'I counted the doors when we came in. Old habit from the road. Two ways out. Good.', 1.2);
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
    if (ctx.sitting) add('sit:fire', 'A fire, a full stomach and quiet company. Kettlewake nights felt like this.', 1.4);
    const since = this.mind.perception.rt() - this.mind.perception.lastEncounterEnd;
    if (since < 40) add('after_fight', "Still shaking a little. Good shaking. Mostly.", 1.6);
  }
}
