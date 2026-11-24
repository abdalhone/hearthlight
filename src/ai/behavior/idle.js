import { TILE } from '../../core/constants.js';
import { say } from './lines.js';
import { rand, chance, dist, tileOf, tileCenter, walkable, standSpotFor, isActorAlive, safe, warnOnce } from './util.js';
import { fireSeat } from './tasks.js';

// The small life Lyra lives between orders: looking around, glancing at you,
// humming, warming up by a fire at night, picking a flower, petting the cat; in
// free mode also wandering near you, gathering things and resting.
//
// Modes: 'follow' (you stand idle; stays within a few tiles of you),
//        'stay'   (holding a spot; nothing that moves her),
//        'free'   (her own will; roams within ~8 tiles of you).

const DIRS = ['down', 'left', 'right', 'up'];
const GATHER_TYPES = ['herb', 'berry_bush', 'moonpetal'];

export class IdleLife {
  constructor(behavior) {
    this.b = behavior;
    this.act = null;
    this.cooldown = rand(1, 2.5);
    this.catAt = -999;
    this.flowerAt = -999;
    this.humAt = -999;
  }

  get active() {
    return !!this.act;
  }

  reset() {
    const a = this.b.actor;
    if (this.act) {
      if (a.state === 'sit' || a.state === 'work') a.setState('idle');
      this.act = null;
      this.cooldown = rand(0.8, 2);
    }
  }

  status() {
    return this.act?.label || '';
  }

  // Returns true while doing something.
  update(dt, mode) {
    if (this.act) {
      let r;
      try {
        r = this.step(this.act, dt, mode);
      } catch (err) {
        warnOnce('idle activity failed', err);
        r = 'done';
      }
      if (r === 'done') this.reset();
      return true;
    }
    this.cooldown -= dt;
    if (this.cooldown > 0) return false;
    this.act = this.choose(mode);
    this.cooldown = mode === 'free' ? rand(0.6, 2) : rand(2, 4.5);
    return !!this.act;
  }

  // --- choosing ---

  choose(mode) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const p = g.player;
    const clock = g.clock;
    const night = !!clock?.isNight || clock?.phase === 'dusk';
    const anchor = mode === 'stay' ? a : p || a;
    const reach = mode === 'free' ? 9 * TILE : 5 * TILE;
    const opts = [];
    opts.push(['look', 3]);
    if (p && p !== a && dist(a.x, a.y, p.x, p.y) < 10 * TILE) opts.push(['glance', 2]);
    if (b.t - this.humAt > 25) opts.push(['hum', 1.2]);
    if (mode !== 'stay') {
      const chilly = night || g.clock?.weather?.type === 'rain';
      const fire = chilly ? this.nearestFire(anchor, reach) : null;
      if (fire) opts.push([{ kind: 'fire', fire }, 5]);
      const cat = b.t - this.catAt > 40 ? this.nearestCat(anchor, mode === 'free' ? 10 * TILE : 6 * TILE) : null;
      if (cat) opts.push([{ kind: 'cat', cat }, 3]);
      if (b.t - this.flowerAt > 50 && !g.map?.isIndoors?.(a.x, a.y)) opts.push(['flower', 1]);
    }
    if (mode === 'free') {
      opts.push(['wander', 3]);
      opts.push(['rest', 1.2]);
      const gather = this.nearestGatherable(a, 6 * TILE);
      if (gather) opts.push([{ kind: 'gather', obj: gather }, 1.4]);
      const loot = this.nearestPickup(a, 6 * TILE);
      if (loot) opts.push([{ kind: 'loot', pickup: loot }, 4]);
    } else if (mode === 'follow' && b.playerIdleT > 18) opts.push(['rest', 0.8]);
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total;
    let pickd = opts[0][0];
    for (const o of opts) {
      if ((r -= o[1]) <= 0) {
        pickd = o[0];
        break;
      }
    }
    const spec = typeof pickd === 'string' ? { kind: pickd } : pickd;
    return this.begin(spec, mode);
  }

  begin(spec, mode) {
    const b = this.b;
    const a = b.actor;
    const act = { ...spec, t: 0, phase: 'go', mode, label: '' };
    switch (spec.kind) {
      case 'look':
        act.dur = rand(1.6, 3.2);
        act.turnAt = act.dur * rand(0.4, 0.6);
        a.faceDir?.(DIRS[Math.floor(Math.random() * 4)]);
        break;
      case 'glance':
        act.dur = rand(1.2, 2.2);
        break;
      case 'hum':
        act.dur = 3.2;
        act.label = 'humming to herself';
        this.humAt = b.t;
        break;
      case 'fire':
        act.dur = rand(12, 20);
        act.label = 'warming up by the fire';
        act.spot = fireSeat(b.game, spec.fire, a);
        if (!act.spot) return null;
        break;
      case 'cat':
        act.dur = 2.2;
        act.label = 'petting the cat';
        this.catAt = b.t;
        break;
      case 'flower':
        act.dur = 1.4;
        act.label = 'picking a flower';
        this.flowerAt = b.t;
        break;
      case 'rest':
        act.dur = rand(6, 11);
        act.label = 'resting';
        break;
      case 'wander': {
        const spot = this.wanderSpot();
        if (!spot) return null;
        act.spot = spot;
        act.label = 'wandering nearby';
        act.dur = 12;
        break;
      }
      case 'gather':
        act.label = spec.obj.objType === 'berry_bush' ? 'picking berries' : 'gathering herbs';
        act.stand = standSpotFor(b.game, spec.obj, a.x, a.y, a);
        if (!act.stand) return null;
        act.dur = 14;
        break;
      case 'loot':
        act.label = 'picking something up';
        act.dur = 10;
        break;
      default:
        return null;
    }
    return act;
  }

  // --- doing ---

  step(act, dt, mode) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const p = g.player;
    act.t += dt;
    if (act.t > (act.dur || 5) + 8) return 'done'; // a walk that never arrives
    switch (act.kind) {
      case 'look':
        b.steering.stop();
        if (act.turnAt && act.t > act.turnAt) {
          act.turnAt = 0;
          a.faceDir?.(DIRS[Math.floor(Math.random() * 4)]);
        }
        return act.t >= act.dur ? 'done' : 'running';
      case 'glance':
        b.steering.stop();
        if (p) a.faceToward(p.x, p.y);
        return act.t >= act.dur ? 'done' : 'running';
      case 'hum':
        b.steering.stop();
        if (act.phase === 'go') {
          act.phase = 'on';
          safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'note'));
        }
        act.fxT = (act.fxT || 0) - dt;
        if (act.fxT <= 0) {
          act.fxT = 0.8;
          safe('particles.emit', () => g.particles?.emit?.('note', a.x + rand(-4, 4), a.y - 24, { count: 1 }));
        }
        return act.t >= act.dur ? 'done' : 'running';
      case 'fire':
        return this.stepFire(act, dt);
      case 'cat':
        return this.stepCat(act, dt);
      case 'flower':
        b.steering.stop();
        if (act.phase === 'go') {
          act.phase = 'on';
          a.setState('work');
        }
        if (act.t >= act.dur) {
          a.setState('idle');
          safe('particles.emit', () => g.particles?.emit?.('sparkle', a.x, a.y - 12, { count: 4 }));
          safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'heart'));
          if (chance(0.3)) b.say(say.flower(), { kind: 'whisper' });
          safe('mind.feel', () => a.mind?.feel?.('joy', 0.05, 'picked a wildflower'));
          return 'done';
        }
        return 'running';
      case 'rest':
        b.steering.stop();
        if (a.state !== 'sit') a.setState('sit');
        return act.t >= act.dur ? 'done' : 'running';
      case 'wander': {
        const r = b.steering.moveTo(act.spot.x, act.spot.y, dt, { arrive: 5, speed: 0.6 });
        if (r === 'moving') return 'running';
        if (r === 'arrived') a.faceDir?.(DIRS[Math.floor(Math.random() * 4)]);
        return 'done';
      }
      case 'gather':
        return this.stepGather(act, dt);
      case 'loot':
        return this.stepLoot(act, dt);
      default:
        return 'done';
    }
  }

  stepFire(act, dt) {
    const b = this.b;
    const a = b.actor;
    if (act.phase === 'go') {
      const r = b.steering.moveTo(act.spot.x, act.spot.y, dt, { arrive: 4, speed: 0.8 });
      if (r === 'moving') return 'running';
      if (r !== 'arrived') return 'done';
      act.phase = 'on';
      act.t = 0;
    }
    b.steering.stop();
    a.faceToward(act.fire.x, act.fire.y);
    if (a.state !== 'sit') a.setState('sit');
    return act.t >= act.dur ? 'done' : 'running';
  }

  stepCat(act, dt) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const cat = act.cat;
    if (!isActorAlive(cat)) return 'done';
    if (act.phase === 'go') {
      const r = b.steering.moveTo(cat.x, cat.y, dt, { arrive: 14, speed: 0.85, ignore: cat });
      if (r === 'moving') return act.t > 9 ? 'done' : 'running';
      if (r !== 'arrived') return 'done';
      act.phase = 'on';
      act.t = 0;
      a.setState('work');
      safe('bubbles.icon', () => g.bubbles?.icon?.(a, 'heart'));
      safe('particles.emit', () => g.particles?.emit?.('heart', cat.x, cat.y - 12, { count: 2 }));
      safe('mind.feel', () => a.mind?.feel?.('joy', 0.12, 'petting the cat'));
      if (chance(0.35)) b.say(say.catPet(), { kind: 'whisper' });
    }
    b.steering.stop();
    a.faceToward(cat.x, cat.y);
    if (dist(a.x, a.y, cat.x, cat.y) > 30) return 'done';
    if (act.t >= act.dur) {
      a.setState('idle');
      return 'done';
    }
    return 'running';
  }

  stepGather(act, dt) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const o = act.obj;
    if (!o || o.removed || !safe('object.canWork', () => o.canWork(a), false)) return 'done';
    if (act.phase === 'go') {
      const r = b.steering.moveTo(act.stand.x, act.stand.y, dt, { arrive: 4, speed: 0.8 });
      if (r === 'moving') return 'running';
      if (r !== 'arrived') return 'done';
      act.phase = 'on';
    }
    b.steering.stop();
    a.faceToward(o.x, o.y - 4);
    a.setState('work');
    const res = safe('object.work', () => o.work(a, dt), { done: true, items: [] });
    act.fxT = (act.fxT || 0) - dt;
    if (act.fxT <= 0) {
      act.fxT = 0.4;
      safe('particles.emit', () => g.particles?.emit?.('leaf', o.x, o.y - 8, { count: 2 }));
    }
    if (res?.done) {
      a.setState('idle');
      for (const it of res.items || []) {
        if (!it?.id || !(it.qty > 0)) continue;
        a.inventory.add(it.id, it.qty);
        g.bus?.emit?.('item_gained', { actor: a, itemId: it.id, qty: it.qty, from: 'job' });
      }
      safe('audio.play', () => g.audio?.play?.('pickup', { x: a.x, y: a.y, volume: 0.5 }));
      return 'done';
    }
    return 'running';
  }

  stepLoot(act, dt) {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const p = act.pickup;
    if (!p || p.removed) return 'done';
    const r = b.steering.moveTo(p.x, p.y, dt, { arrive: 7, speed: 0.9 });
    if (r === 'moving') return 'running';
    if (r !== 'arrived') return 'done';
    if (typeof p.collect === 'function') safe('pickup.collect', () => p.collect(a));
    else {
      a.inventory.add(p.itemId, p.qty ?? 1);
      p.removed = true;
      g.bus?.emit?.('item_gained', { actor: a, itemId: p.itemId, qty: p.qty ?? 1, from: 'pickup' });
    }
    return 'done';
  }

  // Pet the cat right now (an order, not a whim).
  petNow(cat) {
    this.reset();
    this.act = this.begin({ kind: 'cat', cat }, 'follow');
  }

  // --- finding things ---

  nearestFire(anchor, r) {
    const g = this.b.game;
    return safe('objects.nearest', () => g.objects?.nearest?.((o) => o.objType === 'campfire' || o.objType === 'hearth', anchor.x, anchor.y, r));
  }

  nearestCat(anchor, r) {
    const g = this.b.game;
    const a = this.b.actor;
    return g.entities?.nearest?.(anchor.x, anchor.y, r, (e) => e !== a && e.species === 'cat' && isActorAlive(e)) || null;
  }

  nearestGatherable(anchor, r) {
    const g = this.b.game;
    const a = this.b.actor;
    return safe('objects.nearest', () =>
      g.objects?.nearest?.((o) => GATHER_TYPES.includes(o.objType) && typeof o.canWork === 'function' && o.canWork(a), anchor.x, anchor.y, r),
    );
  }

  nearestPickup(anchor, r) {
    const g = this.b.game;
    return g.entities?.nearest?.(anchor.x, anchor.y, r, (e) => e.type === 'pickup' && !e.removed) || null;
  }

  // A walkable point within ~8 tiles of the player, a few tiles from where she is.
  wanderSpot() {
    const b = this.b;
    const g = b.game;
    const a = b.actor;
    const p = g.player || a;
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = rand(2, 8) * TILE;
      const x = p.x + Math.cos(ang) * r;
      const y = p.y + Math.sin(ang) * r;
      const tx = tileOf(x);
      const ty = tileOf(y);
      if (!walkable(g, tx, ty, a)) continue;
      if (dist(a.x, a.y, x, y) < 2 * TILE) continue;
      return { x: tileCenter(tx), y: tileCenter(ty) };
    }
    return null;
  }
}
