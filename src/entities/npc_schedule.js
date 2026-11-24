// Pure schedule helpers for villagers (no DOM, no game state): which entry of a
// profile's day plan applies at an hour, whether a plan covers the whole day,
// and how weather bends it (nobody socializes in the square in the rain).

export const ACTIVITIES = ['work', 'wander', 'eat', 'sleep', 'socialize', 'patrol', 'pray', 'farm'];

// The schedule entry active at `hour` (0..24). Entries are [from, to) and may
// wrap past midnight (from > to).
export function entryAt(schedule, hour) {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  const h = ((hour % 24) + 24) % 24;
  for (const e of schedule) {
    if (e.from <= e.to ? h >= e.from && h < e.to : h >= e.from || h < e.to) return e;
  }
  return schedule[schedule.length - 1];
}

// Covered hours as a sorted list of [from, to) spans, wrap-around split in two.
function spans(schedule) {
  const out = [];
  for (const e of schedule) {
    if (e.from <= e.to) out.push([e.from, e.to]);
    else {
      out.push([e.from, 24]);
      out.push([0, e.to]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Problems with a schedule: gaps, overlaps, unknown activities. [] = valid.
export function scheduleProblems(schedule, knownLocations = null) {
  const problems = [];
  if (!Array.isArray(schedule) || !schedule.length) return ['empty schedule'];
  for (const e of schedule) {
    if (!ACTIVITIES.includes(e.activity)) problems.push(`unknown activity ${e.activity}`);
    if (!(e.from >= 0 && e.from <= 24 && e.to >= 0 && e.to <= 24)) problems.push(`bad hours ${e.from}-${e.to}`);
    if (e.from === e.to) problems.push(`empty span at ${e.from}`);
    if (knownLocations && !knownLocations.includes(e.at)) problems.push(`unknown location ${e.at}`);
  }
  const sp = spans(schedule);
  let t = 0;
  for (const [a, b] of sp) {
    if (a > t + 1e-9) problems.push(`gap ${t}-${a}`);
    if (a < t - 1e-9) problems.push(`overlap at ${a}`);
    t = Math.max(t, b);
  }
  if (t < 24 - 1e-9) problems.push(`gap ${t}-24`);
  return problems;
}

// Bend the plan for the weather: outdoor socializing moves to the inn in the
// rain, and after dark in the rain everyone heads home.
//   ctx = { raining, night, isIndoor(locId) -> bool, home }
export function adjustForWeather(entry, ctx) {
  if (!entry || !ctx?.raining) return entry;
  const indoor = ctx.isIndoor ? ctx.isIndoor(entry.at) : false;
  if (indoor || entry.activity === 'sleep') return entry;
  if (ctx.night) return { ...entry, activity: entry.activity === 'patrol' ? 'patrol' : 'socialize', at: entry.activity === 'patrol' ? entry.at : ctx.home, rain: true };
  if (entry.activity === 'socialize' || entry.activity === 'wander') return { ...entry, activity: 'socialize', at: 'ember_kettle', rain: true };
  return entry;
}

// The next entry after the current one (for "on my way to..." talk).
export function nextEntry(schedule, hour) {
  const cur = entryAt(schedule, hour);
  if (!cur) return null;
  const i = schedule.indexOf(cur);
  return schedule[(i + 1) % schedule.length];
}
