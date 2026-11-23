import { factionRelation } from './entity.js';

// STUB (owned by the combat/player agent). Contract in DESIGN.md "Combat".
export class Combat {
  constructor(game) {
    this.game = game;
  }

  update(dt) {}

  isHostile(a, b) {
    return factionRelation(a.faction, b.faction) === 'hostile';
  }

  melee(attacker, opts = {}) {
    if (attacker.attackCd > 0) return false;
    attacker.attackCd = 0.4;
    attacker.setState('attack', 0.25);
    const g = this.game;
    const fx = attacker.facing.x;
    const fy = attacker.facing.y;
    const hits = g.entities.query(attacker.x + fx * 12, attacker.y + fy * 12, 14, (e) => e !== attacker && e.type === 'actor' && e.isAlive());
    for (const t of hits) if (opts.target ? t === opts.target : t.faction !== attacker.faction) this.damage(attacker, t, attacker.atk);
    return true;
  }

  shoot(attacker, tx, ty, kind = 'bolt', opts = {}) {
    return false;
  }

  heal(source, target, amount) {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.game.bus.emit('heal', { source, target, amount: target.hp - before });
    return target.hp - before;
  }

  damage(source, target, amount, opts = {}) {
    if (!target.isAlive() || target.invuln > 0) return 0;
    const dmg = Math.max(1, Math.round(amount - (target.def || 0)));
    target.hp -= dmg;
    target.flash = 1;
    target.invuln = 0.3;
    target.lastAttacker = source;
    target.lastAttackedAt = this.game.clock.t;
    this.game.bus.emit('damage', { source, target, amount: dmg, kind: opts.kind || 'melee' });
    if (target.hp <= 0) this.kill(target, source);
    return dmg;
  }

  kill(target, killer) {
    target.hp = 0;
    target.dead = true;
    target.setState('dead');
    this.game.bus.emit('death', { entity: target, killer });
    setTimeout(() => (target.removed = true), 800);
  }

  revive(target, by) {}
}
