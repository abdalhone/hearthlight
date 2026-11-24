import { BASE_GOALS, COIN_JOBS, T } from './autonomy_data.js';

// Lyra's own day (DESIGN §16.1). planDay() turns her goals, needs, purse, feelings
// about the player, the weather and the Maren trail into blocks of the day. One block:
//   { from, to, type, activity, at, why, company, with?, job?, jobId?, npc?, deliverTo?,
//     label?, pay?, amount?, bed? }
// type      what it is to her: 'travel' (with the player) | 'work' (a job for coin) | 'eat' |
//           'visit' | 'lead' (a Maren lead) | 'study' | 'stars' | 'moonpetals' | 'hearth' |
//           'rest' | 'sleep'
// activity  the same in words ("gather herbs for Mira"): what the UI, the prompt and
//           behavior's own_life read (own_life classifies the words; `job` wins for work)
// company   'player' (she travels with them) | 'invite' (her own errand; they may come) | 'alone'
// with      the person the block is with, as own_life reads it: 'player', or a villager id
// deliverTo the villager who buys the work (own_life hands the haul to them)
// Hours run 0..24; the sleep block ends at 31 (7 AM the next day).

export const QUEST_STAGES = ['settle', 'ask_aveline', 'find_key', 'enter_ruins', 'find_journal', 'read_journal', 'waygate'];

export function questStageIndex(stage) {
  if (Number.isFinite(stage)) return Math.max(0, Math.min(6, Math.floor(stage)));
  const i = QUEST_STAGES.indexOf(String(stage || ''));
  return i >= 0 ? i : 0;
}

// Deterministic 0..1 per day and salt, so a day's plan is stable when it is revised.
export function dayRand(day, salt = 0) {
  let h = (Math.imul((day | 0) + 0x9e37, 0x85ebca6b) ^ Math.imul((salt | 0) + 0x632b, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function sleepSpot(trust, fear) {
  return trust >= T.homeTrust && fear <= T.homeFear ? 'lyra_bed' : 'lyra_inn_bed';
}

// Goal weights drift with her situation; sorted strongest first.
export function weighGoals(v) {
  const out = BASE_GOALS.map((g) => ({ ...g }));
  const by = Object.fromEntries(out.map((g) => [g.id, g]));
  const purse = v.purse ?? 0;
  by.earn_keep.weight += purse < 10 ? 0.35 : purse < 25 ? 0.15 : purse > 60 ? -0.2 : 0;
  if ((v.hpFrac ?? 1) < 0.4 || (v.fear ?? 0) > 40) by.survive.weight += 0.1;
  if ((v.questStage ?? 0) >= 2) by.find_maren.weight += 0.05;
  if ((v.questStage ?? 0) >= 6) by.find_maren.text = 'Follow Maren north, through the old waygate';
  if (v.state === 'left' || v.state === 'apart') by.belong.weight += 0.1;
  if ((v.valence ?? 0) < 0) by.small_joys.weight += 0.15;
  if ((v.openness ?? 0.85) > 0.7) by.grow_magic.weight += 0.05;
  if ((v.energy ?? 0.8) < 0.25 || (v.hunger ?? 0.7) < 0.25) by.survive.weight += 0.05;
  for (const g of out) g.weight = Math.round(Math.max(0.05, Math.min(1.2, g.weight)) * 100) / 100;
  return out.sort((a, b) => b.weight - a.weight);
}

// The coin job for a morning: liked, safe by day, and not the same as yesterday.
export function chooseJob(v, salt = 0) {
  const dangerOf = v.dangerOf || (() => 0);
  let best = null;
  let bestScore = -Infinity;
  for (const j of COIN_JOBS) {
    let s = j.pref * (1 - 0.18 * dangerOf(j.at));
    if (j.id === v.lastJobId) s *= 0.55;
    if (j.job === 'fish' && (v.neuroticism ?? 0.4) > 0.55) s *= 0.6; // deep water
    if (v.weather === 'rain' && j.job !== 'farm' && j.job !== 'gather_herbs') s *= 0.85;
    s *= 0.75 + 0.5 * dayRand(v.day ?? 1, salt + j.id.length * 31 + j.rate);
    if (s > bestScore) {
      bestScore = s;
      best = j;
    }
  }
  return best;
}

function leadFor(stage, joinable) {
  switch (stage) {
    case 0:
      return { at: 'town_square', why: 'New faces. Somebody here may have seen Maren.' };
    case 1:
      return { at: 'chapel', npc: 'aveline', why: 'Sister Aveline knew Maren. I need to ask her.' };
    case 2:
      return joinable
        ? { at: 'bandit_camp', company: 'player', why: 'The bandits have the ruins key. Not a walk I take alone.' }
        : { at: 'guardhouse', npc: 'rowan', why: 'Rowan knows the bandits’ habits. I want that key.' };
    case 3:
    case 4:
      return joinable
        ? { at: 'sunken_ruins', company: 'player', why: 'Maren went into the ruins. So will I — with you.' }
        : { at: 'player_home', type: 'study', why: 'Reading up on Lanternwright ruins before I go in.' };
    case 5:
      return { at: 'player_home', type: 'study', why: 'Maren’s journal. Every page.' };
    default:
      return { at: 'town_square', why: 'Asking travelers about the north road and the old waygate.' };
  }
}

const ACTIVITY_WORDS = {
  travel: () => 'travel with you',
  eat: () => 'supper at the Kettle',
  visit: (x) => `visit ${x.npcName || 'a friend'}`,
  lead: () => 'follow a lead about Maren',
  study: () => 'practice my spells',
  stars: () => 'stargaze',
  moonpetals: () => 'gather moonpetals',
  hearth: () => 'rest by the fire',
  rest: () => 'rest',
  sleep: () => 'sleep',
  free: () => 'wander',
};

// A block, with its `activity` words and own_life's `with` filled in from its type.
export function makeBlock(from, to, type, at, why, extra = {}) {
  const b = { from, to, type, activity: '', at: at || null, why, company: 'alone', ...extra };
  if (!b.activity) b.activity = type === 'work' ? b.label || 'work' : (ACTIVITY_WORDS[type] || ACTIVITY_WORDS.free)(b);
  if (type === 'travel') b.with = 'player';
  else if ((type === 'visit' || type === 'lead') && b.npc) b.with = b.npc;
  else delete b.with;
  delete b.npcName;
  return b;
}

function workBlock(from, to, job, why, extra = {}) {
  return makeBlock(from, to, 'work', job.at, why, {
    job: job.job,
    jobId: job.id,
    label: job.label,
    npc: job.npc,
    deliverTo: job.npc,
    amount: job.amount,
    pay: job.rate * job.amount,
    ...extra,
  });
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// v: { day, fromHour, state, apartReason, apartDay, trust, affinity, fear, purse, energy,
//      hunger, weather, questStage, openness, extraversion, neuroticism, sleepAt, lastJobId,
//      friend: {id, name, at}|null, dangerOf(locId) }
export function buildPlan(v) {
  const day = v.day ?? 1;
  const state = v.state || 'together';
  if (state === 'gone') return revise(gonePlan(v), v);
  const together = state === 'together' || state === 'wary';
  const trusting = (v.trust ?? 30) >= T.calmTrust && (v.fear ?? 0) <= T.calmFear;
  // Whose company she chooses in the "travel" hours.
  const joinable =
    together ||
    (state === 'apart' && trusting && (v.apartReason === 'plans' || (v.apartReason === 'dismissed' && day > (v.apartDay ?? day))));
  const bond = (v.trust ?? 30) >= 55 && (v.affinity ?? 0) >= 35 && (v.fear ?? 0) <= 15;
  const needCoin = (v.purse ?? 0) < 15;
  const stage = v.questStage ?? 0;
  const invite = together && (v.trust ?? 30) >= 40 ? 'invite' : 'alone';
  const r = dayRand(day, 7);
  const out = [];

  // Morning: honest work for coin, a Maren lead, practice, or the road with the player.
  const job = chooseJob(v, 3);
  if (day === 1 && joinable) {
    out.push(makeBlock(7, 13, 'travel', null, 'Settling in, and meeting the neighbors together.', { company: 'player' }));
  } else {
    if (!joinable || needCoin || (state === 'wary' && r < 0.6) || r < (bond ? 0.2 : 0.45)) {
      out.push(workBlock(7, 10, job, `${cap(job.label)}: ${job.rate} coins a bundle${needCoin ? ', and my purse is light' : ''}.`, { company: invite }));
    } else if (stage === 1) out.push(makeBlock(7, 10, 'lead', 'chapel', 'Sister Aveline knew Maren. I need to ask her.', { npc: 'aveline', company: invite }));
    else if ((v.openness ?? 0.85) > 0.6 && r > 0.8) out.push(makeBlock(7, 10, 'study', 'player_home', 'Maren would scold me for skipping practice.'));
    else out.push(makeBlock(7, 10, 'travel', null, 'A morning on the road with you.', { company: 'player' }));
    // Late morning.
    if (joinable) out.push(makeBlock(10, 13, 'travel', null, stage >= 2 ? 'The trail to Maren runs through dangerous places. Better with two.' : 'Whatever you are up to — I am curious.', { company: 'player' }));
    else if (needCoin) {
      const j2 = chooseJob({ ...v, lastJobId: job.id }, 11);
      out.push(workBlock(10, 13, j2, `${cap(j2.label)}. Coin doesn’t earn itself.`));
    } else if (v.friend) out.push(makeBlock(10, 13, 'visit', v.friend.at || 'town_square', `I like ${v.friend.name}. I want to see them.`, { npc: v.friend.id, npcName: v.friend.name }));
    else out.push(makeBlock(10, 13, 'study', 'town_square', 'Practicing wards where the light is good.'));
  }

  // Afternoon: the Maren trail.
  const lead = leadFor(stage, joinable);
  if (joinable) {
    const withPlayer = lead.company === 'player';
    out.push(makeBlock(13, 18, 'travel', withPlayer ? lead.at : null, withPlayer ? lead.why : 'Out with you, keeping an ear open for Maren.', { company: 'player' }));
  } else out.push(makeBlock(13, 18, lead.type || 'lead', lead.at, lead.why, lead.npc ? { npc: lead.npc } : {}));

  // Supper at the Ember Kettle.
  const supperWhy = (v.hunger ?? 0.6) < 0.35 ? 'Supper. I’m starving.' : 'Elda’s stew. I’ve earned it.';
  out.push(makeBlock(18, 19.5, 'eat', 'ember_kettle', supperWhy, { company: together ? 'invite' : 'alone' }));

  // Evening: her free time.
  const raining = v.weather === 'rain';
  const sleepEarly = (v.energy ?? 0.8) < 0.3;
  const eveEnd = sleepEarly ? 21 : bond && (v.energy ?? 0.8) >= 0.5 ? 23 : 22;
  if (joinable && bond && (v.energy ?? 0.8) >= 0.45 && !raining) out.push(makeBlock(19.5, eveEnd, 'travel', null, 'An evening with you. I’d like that.', { company: 'player' }));
  else if (raining) out.push(makeBlock(19.5, eveEnd, 'hearth', 'ember_kettle', 'Rain on the roof and the hearth going. Perfect.', { company: together ? 'invite' : 'alone' }));
  else if (joinable && r > 0.5) out.push(makeBlock(19.5, eveEnd, 'moonpetals', 'whisperwood', 'The moonpetals open at night. Not a walk I take alone.', { company: 'invite' }));
  // Evenings of her own go to her people: Mam and Da most of all (social, DESIGN §19.3).
  else if (v.friend && (!joinable || r < 0.35)) {
    const parents = v.friend.id === 'hobb' || v.friend.id === 'wenna';
    out.push(makeBlock(19.5, eveEnd, 'visit', v.friend.at || 'town_square', parents ? 'Mam and Da will want to hear about my day. I’ll tell them half.' : `An evening with ${v.friend.name}.`, { npc: v.friend.id, npcName: v.friend.name }));
  }
  else out.push(makeBlock(19.5, eveEnd, 'stars', 'south_meadow', 'Clear sky. I’m going to name every star I know.', { company: together && bond ? 'invite' : 'alone' }));

  // Sleep, in the cottage while she trusts the player, otherwise a room at the inn.
  const bed = v.sleepAt || sleepSpot(v.trust ?? 30, v.fear ?? 0);
  out.push(
    makeBlock(eveEnd, 31, 'sleep', bed === 'lyra_bed' ? 'player_home' : 'ember_kettle', bed === 'lyra_bed' ? 'My own bed, in the cottage.' : 'My room at the Kettle — I sleep better with a bolt on the door.', {
      bed,
    }),
  );

  return revise(out, v);
}

// Revision mid-day: keep what is still ahead, starting now.
function revise(out, v) {
  const from = v.fromHour ?? 7;
  if (from > 7) {
    const kept = out.filter((b) => b.to > from);
    if (kept.length) kept[0].from = Math.max(kept[0].from, Math.round(from * 4) / 4);
    return tendToHerself(kept, v);
  }
  return out;
}

// Gone (DESIGN §19.7): she has cut the player out of her life, and lives her own at home:
// her mother's table, her father's candle vats, the bench on Lamplight Lane at dusk. She
// still earns her keep. v.home = { at, bed, sleepAt } from the Autonomy (the chandlery,
// or her room at the Kettle when there is no chandlery). `doing` is what the HUD shows.
function gonePlan(v) {
  const home = v.home?.at || 'ember_kettle';
  const parents = home === 'chandlery';
  const out = [];
  out.push(makeBlock(7, 8, 'eat', home, parents ? 'Breakfast at Mam’s table.' : 'Porridge, early, before anyone’s about.', { activity: parents ? 'breakfast with Mam and Da' : 'breakfast at the Kettle', doing: parents ? 'having breakfast with her parents' : 'having breakfast' }));
  if ((v.purse ?? 0) < 25) {
    const job = chooseJob(v, 5);
    out.push(workBlock(8, 12, job, `${cap(job.label)}. Coin doesn’t earn itself.`));
  } else out.push(makeBlock(8, 12, 'study', home, 'Maren’s notes. I can read them anywhere.', { activity: 'study Maren’s notes', doing: 'reading Maren’s notes' }));
  out.push(makeBlock(12, 13, 'eat', home, parents ? 'Lunch with Mam and Da.' : 'Something to eat.', { activity: parents ? 'lunch with Mam and Da' : 'lunch', doing: parents ? 'having lunch with her parents' : 'having lunch' }));
  out.push(
    makeBlock(13, 18, 'hearth', home, parents ? 'Da’s candles won’t dip themselves, and he won’t admit his eyes are going.' : 'A quiet afternoon. I need one.', {
      activity: parents ? 'help Da at the candle vats' : 'rest by the fire',
      doing: parents ? 'helping her father dip candles' : 'resting by the fire',
    }),
  );
  out.push(makeBlock(18, 19.5, 'eat', home, parents ? 'Supper at home. Mam asks no questions, which is how I know she knows.' : 'Supper by the hearth.', { activity: 'supper', doing: parents ? 'having supper at home' : 'having supper' }));
  out.push(
    makeBlock(19.5, 21.5, 'rest', home, parents ? 'The bench outside with Mam and Da, while the lamps come on.' : 'An hour by the fire.', {
      activity: parents ? 'sit on the bench with Mam and Da' : 'rest by the fire',
      doing: parents ? 'sitting with her parents' : 'resting by the fire',
    }),
  );
  const bed = v.home?.bed || 'lyra_inn_bed';
  out.push(makeBlock(21.5, 31, 'sleep', v.home?.sleepAt || 'ember_kettle', bed === 'lyra_inn_bed' ? 'My room at the Kettle. Bolt on the door.' : 'My old bed, under my parents’ roof.', { bed }));
  return out;
}

// Critical needs come first (§16.5): a meal now when she is starving, an hour's rest
// when she is spent, before whatever the day had planned.
function tendToHerself(plan, v) {
  const now = plan[0];
  if (!now || now.type === 'sleep') return plan;
  const h = now.from;
  let need = null;
  if ((v.hunger ?? 0.7) < 0.25 && now.type !== 'eat') need = makeBlock(h, h + 1, 'eat', 'ember_kettle', 'I need to eat something. Now.', { activity: 'a meal at the Kettle' });
  else if ((v.energy ?? 0.8) < 0.2 && now.type !== 'rest' && now.type !== 'hearth') need = makeBlock(h, h + 1, 'rest', 'ember_kettle', 'I’m spent. An hour by the fire, or I’ll fall over.');
  if (!need) return plan;
  const out = [need];
  for (const b of plan) {
    if (b.to <= need.to) continue;
    out.push(b.from < need.to ? { ...b, from: need.to } : b);
  }
  return out;
}

// The block for an hour (handles the overnight sleep block, which runs to 31).
export function blockAt(today, hour) {
  if (!Array.isArray(today)) return null;
  for (const b of today) if (hour >= b.from && hour < b.to) return b;
  if (hour < 7) for (const b of today) if (b.to > 24 && hour + 24 >= b.from && hour + 24 < b.to) return b;
  return null;
}

export function blockIndexAt(today, hour) {
  const b = blockAt(today, hour);
  return b ? today.indexOf(b) : -1;
}

export function hourLabel(h) {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const m = Math.round((h - Math.floor(h)) * 60);
  const ampm = hh < 12 ? 'in the morning' : hh < 18 ? 'in the afternoon' : 'in the evening';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  if (hh === 12 && m === 0) return 'noon';
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm}`;
}

const DESCRIBE = {
  travel: (b) => (b.at ? `with you, out toward ${b.place || b.at}` : 'on the road with you'),
  work: (b) => `${b.label || 'working'}`,
  eat: () => 'supper at the Ember Kettle',
  visit: (b) => `visiting ${b.npcName || 'a friend'}`,
  lead: (b) => `following a lead on Maren at ${b.place || b.at}`,
  study: () => 'practicing my spells',
  stars: () => 'stargazing in the meadow',
  moonpetals: () => 'looking for moonpetals in the Whisperwood',
  hearth: () => 'by the fire at the Kettle',
  rest: () => 'resting',
  sleep: (b) => (b.bed === 'lyra_bed' ? 'bed, in the cottage' : b.bed && b.bed !== 'lyra_inn_bed' ? 'bed, at home' : 'bed, at the inn'),
  free: () => 'some time to myself',
};

// "gather herbs for Mira", "supper at the Ember Kettle", "bed, at the inn"...
export function describeBlock(b, names = {}) {
  if (!b) return '';
  const fn = DESCRIBE[b.type] || (() => String(b.activity || 'my own business'));
  return fn({ ...b, ...names });
}
