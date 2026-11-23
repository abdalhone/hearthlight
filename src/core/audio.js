// STUB (owned by the UI agent). Procedural WebAudio sound effects and music.
// Contract: unlock() (call from a user gesture), play(name, { x, y, volume, pitch }),
// setMusic('title'|'day'|'night'|'combat'|'none'), applyVolumes().
// Sound names: swing, hit, hurt, bolt, bolt_hit, heal, door_open, door_close, pickup, coin,
// chop, mine, splash, step, levelup, ui_click, ui_open, ui_close, talk_blip, death, bow,
// dodge, eat, quest, downed, revive, sleep, error, magic.
export class Audio {
  constructor(game) {
    this.game = game;
  }
  unlock() {}
  play(name, opts = {}) {}
  setMusic(track) {}
  applyVolumes() {}
  update(dt) {}
}
