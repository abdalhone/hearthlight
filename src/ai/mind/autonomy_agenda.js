import { BASE_GOALS, COIN_JOBS, T } from './autonomy_data.js';

// Lyra's own day (DESIGN §16.1). planDay() turns her goals, needs, purse, feelings
// about the player, the weather and the Maren trail into blocks of the day:
//   { from, to, activity, at, why, with, job?, npc?, pay?, amount?, bed?, kind? }
// activity: 'travel' (with the player) | 'work' (a job for coin) | 'eat' | 'visit' |
//           'lead' (follow a Maren lead) | 'study' | 'free' | 'rest' | 'sleep'
// with:     'player' (she travels with them) | 'invite' (her own errand; they may come) | 'alone'
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
        ? { at: 'bandit_camp', with: 'player', why: 'The bandits have the ruins key. Not a walk I take alone.' }
        : { at: 'guardhouse', npc: 'rowan', why: 'Rowan knows the bandits’ habits. I want that key.' };
    case 3:
    case 4:
      return joinable
        ? { at: 'sunken_ruins', with: 'player', why: 'Maren went into the ruins. So will I — with you.' }
        : { at: 'player_home', activity: 'study', why: 'Reading up on Lanternwright ruins before I go in.' };
    case 5:
      return { at: 'player_home', activity: 'study', why: 'Maren’s journal. Every page.' };
    default:
      return { at: 'town_square', why: 'Asking travelers about the north road and the old waygate.' };
  }
}

function block(from, to, activity, at, why, extra = {}) {
  return { from, to, activity, at, why, with: 'alone', ...extra };
}

// v: { day, fromHour, state, apartReason, apartDay, trust, affinity, fear, purse, energy,
//      hunger, weather, questStage, openness, extraversion, neuroticism, sleepAt, lastJobId,
//      friend: {id, name}|null, dangerOf(locId) }
export function buildPlan(v) {
  const day = v.day ?? 1;
  const state = v.state || 'together';
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
  const workBlock = (from, to) =>
    block(from, to, 'work', job.at, `${job.label.charAt(0).toUpperCase() + job.label.slice(1)}: ${job.rate} coins a bundle${needCoin ? ', and my purse is light' : ''}.`, {
      with: invite,
      job: job.job,
      jobId: job.id,
      label: job.label,
      npc: job.npc,
      deliverAt: job.deliverAt,
      amount: job.amount,
      pay: job.rate * job.amount,
    });
  if (day === 1 && joinable) {
    out.push(block(7, 13, 'travel', null, 'Settling in, and meeting the neighbors together.', { with: 'player' }));
  } else {
    if (!joinable || needCoin || (state === 'wary' && r < 0.6) || r < (bond ? 0.2 : 0.45)) out.push(workBlock(7, 10));
    else if (stage === 1) out.push(block(7, 10, 'lead', 'chapel', 'Sister Aveline knew Maren. I need to ask her.', { npc: 'aveline', with: invite }));
    else if ((v.openness ?? 0.85) > 0.6 && r > 0.8) out.push(block(7, 10, 'study', 'player_home', 'Maren would scold me for skipping practice.', { with: 'alone' }));
    else out.push(block(7, 10, 'travel', null, 'A morning on the road with you.', { with: 'player' }));
    // Late morning.
    if (joinable) out.push(block(10, 13, 'travel', null, stage >= 2 ? 'The trail to Maren runs through dangerous places. Better with two.' : 'Whatever you are up to — I am curious.', { with: 'player' }));
    else if (needCoin) {
      const j2 = chooseJob({ ...v, lastJobId: job.id }, 11);
      out.push(
        block(10, 13, 'work', j2.at, `${j2.label.charAt(0).toUpperCase() + j2.label.slice(1)}. Coin doesn’t earn itself.`, {
          job: j2.job,
          jobId: j2.id,
          label: j2.label,
          npc: j2.npc,
          deliverAt: j2.deliverAt,
          amount: j2.amount,
          pay: j2.rate * j2.amount,
        }),
      );
    } else if (v.friend) out.push(block(10, 13, 'visit', v.friend.at || 'town_square', `I like ${v.friend.name}. I want to see them.`, { npc: v.friend.id }));
    else out.push(block(10, 13, 'study', 'town_square', 'Practicing wards where the light is good.'));
  }

  // Afternoon: the Maren trail.
  const lead = leadFor(stage, joinable);
  if (joinable) out.push(block(13, 18, 'travel', lead.with === 'player' ? lead.at : null, lead.with === 'player' ? lead.why : 'Out with you, keeping an ear open for Maren.', { with: 'player' }));
  else out.push(block(13, 18, lead.activity || 'lead', lead.at, lead.why, { npc: lead.npc || null }));

  // Supper at the Ember Kettle.
  const supperWhy = (v.hunger ?? 0.6) < 0.35 ? 'Supper. I’m starving.' : 'Elda’s stew. I’ve earned it.';
  out.push(block(18, 19.5, 'eat', 'ember_kettle', supperWhy, { with: together ? 'invite' : 'alone' }));

  // Evening: her free time.
  const raining = v.weather === 'rain';
  const sleepEarly = (v.energy ?? 0.8) < 0.3;
  const eveEnd = sleepEarly ? 21 : bond && (v.energy ?? 0.8) >= 0.5 ? 23 : 22;
  if (joinable && bond && (v.energy ?? 0.8) >= 0.45 && !raining) out.push(block(19.5, eveEnd, 'travel', null, 'An evening with you. I’d like that.', { with: 'player' }));
  else if (raining) out.push(block(19.5, eveEnd, 'free', 'ember_kettle', 'Rain on the roof and the hearth going. Perfect.', { kind: 'rain', with: together ? 'invite' : 'alone' }));
  else if (joinable && r > 0.5) out.push(block(19.5, eveEnd, 'free', 'whisperwood', 'The moonpetals open at night. Not a walk I take alone.', { kind: 'moonpetals', with: 'invite' }));
  else out.push(block(19.5, eveEnd, 'free', 'south_meadow', 'Clear sky. I’m going to name every star I know.', { kind: 'stars', with: together && bond ? 'invite' : 'alone' }));

  // Sleep, in the cottage while she trusts the player, otherwise a room at the inn.
  const bed = v.sleepAt || sleepSpot(v.trust ?? 30, v.fear ?? 0);
  out.push(
    block(eveEnd, 31, 'sleep', bed === 'lyra_bed' ? 'player_home' : 'ember_kettle', bed === 'lyra_bed' ? 'My own bed, in the cottage.' : 'My room at the Kettle — I sleep better with a bolt on the door.', {
      bed,
      with: 'alone',
    }),
  );

  // Revision mid-day: keep what is still ahead, starting now.
  const from = v.fromHour ?? 7;
  if (from > 7) {
    const kept = out.filter((b) => b.to > from);
    if (kept.length) kept[0].from = Math.max(kept[0].from, Math.round(from * 4) / 4);
    return kept;
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

const ACTIVITY_TEXT = {
  travel: (b) => (b.at ? `with you, out toward ${b.place || b.at}` : 'on the road with you'),
  work: (b) => `${b.label || 'working'}${b.npcName ? ` for ${b.npcName}` : ''}`,
  eat: () => 'supper at the Ember Kettle',
  visit: (b) => `visiting ${b.npcName || 'a friend'}`,
  lead: (b) => `following a lead on Maren at ${b.place || b.at}`,
  study: () => 'practicing my spells',
  free: (b) => (b.kind === 'stars' ? 'stargazing in the meadow' : b.kind === 'moonpetals' ? 'looking for moonpetals' : b.kind === 'rain' ? 'by the fire at the Kettle' : 'some time to myself'),
  rest: () => 'resting',
  sleep: (b) => (b.bed === 'lyra_bed' ? 'bed, in the cottage' : 'bed, at the inn'),
};

// "this morning gather herbs for Mira; this afternoon with you; supper at the Kettle..."
export function describeBlock(b, names = {}) {
  if (!b) return '';
  const fn = ACTIVITY_TEXT[b.activity] || (() => b.activity);
  return fn({ ...b, ...names });
}
