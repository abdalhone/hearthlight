// How long a cast planted the player, from frames sampled once per drawn frame (`t` in ms,
// `plant` = the player's castPlantT at that frame). The game steps at a fixed rate and draws
// once a frame, so on a slow phone one drawn frame can run several steps: the first and last
// planted frames bound the plant from below (`lo`), and the frame before it and the frame after
// it bound it from above (`hi`). The true plant lies in [lo, hi]. Used by followup_check.
export function plantBracket(samples) {
  const rows = Array.isArray(samples) ? samples : [];
  const first = rows.findIndex((s) => s && s.plant > 0);
  if (first < 0) return { lo: 0, hi: 0, frames: 0 };
  let last = first;
  while (last + 1 < rows.length && rows[last + 1]?.plant > 0) last++;
  const lo = rows[last].t - rows[first].t;
  const before = first > 0 ? rows[first - 1].t : rows[first].t;
  const after = last + 1 < rows.length ? rows[last + 1].t : rows[last].t;
  return { lo, hi: after - before, frames: last - first + 1 };
}
