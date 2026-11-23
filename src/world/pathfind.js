// STUB (owned by the world agent).
// Contract: new Pathfinder(game); find(sx, sy, gx, gy, opts) -> array of {x, y} pixel
// waypoints (tile centers, ending at the goal) or null when unreachable.
// opts: { maxNodes = 6000, allowDoors = true (closed, unlocked doors are passable), actor }
// Closed doors on the path are left for the walker to open (see behavior/steering.js).

export class Pathfinder {
  constructor(game) {
    this.game = game;
  }

  find(sx, sy, gx, gy, opts = {}) {
    return [{ x: gx, y: gy }];
  }
}
