// Finds what an actor can interact with (NPCs, Lyra, doors, chests, trees...) and
// runs the interaction. Entities and world objects opt in by implementing
// canInteract(actor), interactLabel(actor) and interact(actor).

export class Interactions {
  constructor(game) {
    this.game = game;
    this.range = 26; // px from the actor's feet
  }

  candidates(actor) {
    const g = this.game;
    const out = [];
    const fx = actor.facing?.x ?? 0;
    const fy = actor.facing?.y ?? 1;
    const consider = (target, tx, ty, extra = 0) => {
      if (!target || target === actor) return;
      let ok = false;
      try {
        ok = target.canInteract(actor);
      } catch {
        ok = false;
      }
      if (!ok) return;
      const dx = tx - actor.x;
      const dy = ty - actor.y;
      const d = Math.hypot(dx, dy);
      if (d > this.range + extra) return;
      // Prefer things in front of the actor.
      const facingBonus = d > 0 ? (dx * fx + dy * fy) / d : 1;
      out.push({ target, score: d - facingBonus * 10 });
    };
    for (const e of g.entities.query(actor.x, actor.y, this.range + 16)) consider(e, e.x, e.y - 4);
    for (const o of g.objects?.inRadius(actor.x, actor.y, this.range + 16) || []) consider(o, o.x, o.y, o.interactReach ?? 0);
    out.sort((a, b) => a.score - b.score);
    return out.map((c) => c.target);
  }

  best(actor) {
    const target = this.candidates(actor)[0] || null;
    if (!target) return null;
    let label = '';
    try {
      label = target.interactLabel(actor) || 'Interact';
    } catch {
      label = 'Interact';
    }
    return { target, label };
  }

  tryInteract(actor) {
    const b = this.best(actor);
    if (!b) return false;
    actor.faceToward?.(b.target.x, b.target.y);
    try {
      b.target.interact(actor);
    } catch (err) {
      console.error('[interact] failed', err);
      return false;
    }
    this.game.bus.emit('interact', { actor, target: b.target });
    return true;
  }
}
