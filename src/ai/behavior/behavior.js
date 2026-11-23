// STUB (owned by the behavior agent). The full interface is in DESIGN.md ("Behavior").
export class Behavior {
  constructor(game, actor) {
    this.game = game;
    this.actor = actor;
    this.directive = { type: 'follow', target: 'player' };
    this.stance = 'defend';
  }
  setDirective(d) {
    this.directive = d;
    return { ok: true, message: '' };
  }
  setStance(mode) {
    this.stance = mode;
    return { ok: true, message: '' };
  }
  update(a, dt) {
    const p = this.game.player;
    if (!p || this.directive.type !== 'follow') {
      a.moveIntent = { x: 0, y: 0 };
      return;
    }
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const d = Math.hypot(dx, dy);
    a.moveIntent = d > 28 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
  }
  status() {
    return this.directive.type === 'follow' ? 'following you' : 'waiting';
  }
  serialize() {
    return { directive: this.directive, stance: this.stance };
  }
  deserialize(d) {
    if (d?.directive) this.directive = d.directive;
    if (d?.stance) this.stance = d.stance;
  }
}
