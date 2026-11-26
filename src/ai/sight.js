// One rule for who sees what (DESIGN §29.2; the author: "Villagers are able to see me kill
// behind walls", "Lyra saw it from another house"). Every eye in Hearthvale — Lyra's,
// the villagers' sightings, murder witnesses, the gossip of what someone saw — goes through
// murder/witness.js: awake and on their feet, the same space (both outdoors or the same
// building), within range for the light on what they look at (less at night, more under a
// lamp), and a line of sight (walls and buildings block it; two trees hide what is behind).

import { look, lineOfSight, lightAt, sightRange, RANGE } from '../murder/witness.js';

export { look, lineOfSight, lightAt, sightRange, RANGE };

// Does `seer` see the point (x, y) right now?
export function seesPoint(game, seer, x, y) {
  if (!seer || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  try {
    return !!look(game, seer, x, y);
  } catch {
    return false;
  }
}

// Does `seer` see `target` (an actor, a body, anything with x and y) right now?
export function seesActor(game, seer, target) {
  if (!seer || !target || seer === target) return false;
  return seesPoint(game, seer, target.x, target.y);
}

// The ids (of those given) who see the point now, nearest first.
export function watchersOf(game, x, y, people) {
  const out = [];
  for (const e of people || []) {
    if (!e) continue;
    const v = (() => {
      try {
        return look(game, e, x, y);
      } catch {
        return null;
      }
    })();
    if (v) out.push([v.d, e.id]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.map((x) => x[1]);
}

// Did `seer` see the blow that just fell on `victim` (DESIGN §29.2, §29.4)? The crime's own
// screen when one was made a moment ago (murder.sawBlow: who saw it as it fell), else their
// eyes on the victim right now. A blow behind a wall is heard, not seen: never this.
export function sawTheBlow(game, seer, victim, id = seer?.id) {
  if (!seer || !victim) return false;
  const m = game?.murder;
  if (m && typeof m.sawBlow === 'function') {
    let s = null;
    try {
      s = m.sawBlow(id, victim);
    } catch {
      s = null;
    }
    if (s === true) return true;
    if (s === false) return false;
  }
  return seesActor(game, seer, victim);
}
