// STUB (owned by the characters agent).
// Contract: new Spawner(game, spawnZones); update(dt) keeps zones populated (respecting
// night-only zones and a distance from the player); serialize()/deserialize().
export class Spawner {
  constructor(game, zones = []) {
    this.game = game;
    this.zones = zones;
  }
  update(dt) {}
  serialize() {
    return {};
  }
  deserialize(d) {}
}
