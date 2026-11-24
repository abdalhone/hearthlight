import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';
import { Stats, STATS, STAT_IDS, makeModifier, describeContribution, formatStat } from '../src/core/stats.js';
import { Actor } from '../src/entities/entity.js';
import { ITEMS } from '../src/entities/items.js';
import { NPC_PROFILES } from '../src/entities/npc_data.js';
import { ATTRS, ATTR_IDS, POINTS_PER_LEVEL, LEVEL_GROWTH, respecCost } from '../src/progression/attributes.js';
import { installProgression, saveProgression, loadProgression } from '../src/progression/index.js';
import { GEAR, RARITY, SLOTS, SHOP_STOCK, BOSS_GEAR, BUFF_ITEMS, gearStats, upgradeCost } from '../src/gear/gear_data.js';
import { makeGame, step as magicStep, resetArena } from './magic_helpers.mjs';
import { xpToNext } from '../src/entities/combat.js';

// DESIGN §26: one stat pipeline. base + level + points + gear + timed modifiers, read by
// combat, magic, movement, survival and the HUD; levels give 3 points; gear with rarity,
// equip, compare, upgrade at Bram's forge; shops by giver; everything saved.

function bare() {
  const game = { bus: new EventBus(), clock: { t: 0 }, player: null, companion: null };
  game.stats = new Stats(game);
  return game;
}

function arena(opts = {}) {
  const g = makeGame({ foes: 2, ...opts });
  installProgression(g);
  g.bus.emit('game_start', { loaded: false });
  g.player.inventory.add('coin', 500);
  return g;
}

function step(g, seconds = 1 / 60) {
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) {
    magicStep(g);
    g.stats.update(1 / 60);
    g.prices.update(1 / 60);
  }
}

test('the pipeline composes base + level + points + gear + modifiers in one fixed order', () => {
  const g = bare();
  const a = new Actor(g, { id: 'hero', maxHp: 60, atk: 6, def: 0, speed: 76 });
  g.stats.manage(a, { maxHp: 60, atk: 6, def: 0, speed: 76 });
  g.stats.addSource('level', 'Level', () => ({ add: { maxHp: 10, atk: 1 } }), 10);
  g.stats.addSource('points', 'Points', () => ({ add: { maxHp: 12 }, pct: { speed: 0.03 } }), 20);
  g.stats.addSource('gear', 'Gear', () => ({ add: { def: 2, atk: 3 }, pct: { maxHp: 0.1 } }), 30);
  g.stats.addModifier(a, { id: 'potion', add: { def: 1 }, t: 30 });
  g.stats.addModifier(a, { id: 'price', mul: { maxHp: 0.6 }, pct: { dmgDealt: 0.2 }, t: 15 });
  // (60 + 10 + 12) × (1 + 0.1) × 0.6 = 54.12 -> 54
  assert.equal(g.stats.get(a, 'maxHp'), 54);
  assert.equal(g.stats.get(a, 'atk'), 10);
  assert.equal(g.stats.get(a, 'def'), 3);
  assert.equal(g.stats.get(a, 'dmgDealt'), 1.2);
  assert.ok(Math.abs(g.stats.get(a, 'speed') - 76 * 1.03) < 1e-9);
  // The same modifiers added in another order give the same numbers.
  const b = new Actor(g, { id: 'twin', maxHp: 60, atk: 6, def: 0, speed: 76 });
  g.stats.manage(b, { maxHp: 60, atk: 6, def: 0, speed: 76 });
  g.stats.addModifier(b, { id: 'price', mul: { maxHp: 0.6 }, pct: { dmgDealt: 0.2 }, t: 15 });
  g.stats.addModifier(b, { id: 'potion', add: { def: 1 }, t: 30 });
  assert.deepEqual(g.stats.all(b), g.stats.all(a));
  // The managed actor's fields follow; health never refills by itself.
  a.hp = 60;
  g.stats.refresh(a);
  assert.equal(a.maxHp, 54);
  assert.equal(a.hp, 54, 'a smaller maximum clamps the wound');
  g.stats.removeModifier(a, 'price');
  assert.equal(a.maxHp, 90);
  assert.equal(a.hp, 54, 'a bigger maximum leaves it as it is');
  // Where a number comes from.
  const why = g.stats.breakdown(a, 'maxHp').map((x) => x.source);
  assert.deepEqual(why, ['base', 'level', 'points', 'gear']);
  // Timed modifiers run out.
  g.stats.update(31);
  assert.equal(g.stats.get(a, 'def'), 2);
  // Clamps keep every stat inside its range, and every stat has words.
  g.stats.addModifier(a, { id: 'silly', add: { dodge: 5, crit: 9 } });
  assert.equal(g.stats.get(a, 'dodge'), STATS.dodge.max);
  assert.equal(g.stats.get(a, 'crit'), STATS.crit.max);
  for (const id of STAT_IDS) assert.ok(STATS[id].label && typeof formatStat(id, 1) === 'string', id);
  assert.deepEqual(describeContribution({ add: { def: 2 }, pct: { speed: 0.12 }, mul: { maxHp: 0.6 } }), ['+2 Armor', '+12% Speed', 'Health −40%']);
  assert.equal(makeModifier({ source: 'x' }).kind, 'buff');
});

test('levels give three points; points shape stats; the chapel respecs for coin', () => {
  const g = arena();
  const P = g.player;
  const S = g.stats;
  const pr = g.progression;
  const base = S.all(P);
  assert.equal(pr.unspent(), 0);
  g.combat.giveXp(P, xpToNext(1) + xpToNext(2));
  assert.equal(P.level, 3);
  assert.equal(pr.unspent(), 2 * POINTS_PER_LEVEL);
  assert.equal(P.maxHp, base.maxHp + 2 * LEVEL_GROWTH.player.add.maxHp, 'a level grows health');
  assert.equal(P.hp, P.maxHp, 'and heals');
  for (const id of ATTR_IDS) assert.ok(ATTRS[id].name && ATTRS[id].line && ATTRS[id].per, id);
  const before = S.all(P);
  assert.ok(pr.spend('vitality').ok);
  assert.ok(pr.spend('might', 2).ok);
  assert.ok(pr.spend('grace').ok);
  assert.ok(pr.spend('resolve').ok);
  assert.ok(pr.spend('focus').ok);
  assert.equal(pr.unspent(), 0);
  assert.equal(pr.spend('weave').ok, false, 'no points left');
  const after = S.all(P);
  assert.equal(after.maxHp, before.maxHp + ATTRS.vitality.per.add.maxHp);
  assert.ok(Math.abs(after.atk - before.atk - 2 * ATTRS.might.per.add.atk) < 1e-6);
  assert.ok(after.dodge > before.dodge && after.crit > before.crit && after.speed > before.speed, 'grace');
  assert.ok(after.resist > before.resist && after.bleedout > before.bleedout && after.carrySpeed > before.carrySpeed, 'resolve');
  assert.ok(after.maxMana > before.maxMana && after.cooldown < before.cooldown, 'focus');
  assert.equal(g.magic.mana.max, Math.round(after.maxMana), 'mana follows the pipeline');
  // Respec: points back, coin gone.
  const coin = P.inventory.count('coin');
  const r = pr.respec();
  assert.ok(r.ok);
  assert.equal(r.cost, respecCost(3));
  assert.equal(P.inventory.count('coin'), coin - r.cost);
  assert.equal(pr.unspent(), 2 * POINTS_PER_LEVEL);
  assert.deepEqual(S.all(P), before);
});

test('gear: rarity, equip from the bag, compare, unequip, upgrade at the forge, forge new', () => {
  for (const [id, gdef] of Object.entries(GEAR)) {
    assert.ok(RARITY[gdef.rarity], `${id} rarity`);
    assert.ok(ITEMS[id], `${id} is an item`);
    assert.ok(gdef.name && gdef.desc && gdef.from && gdef.tint, `${id} words and tint`);
    const st = gearStats(id, 0);
    assert.ok(Object.keys(st.add).length + Object.keys(st.pct).length > 0, `${id} has stats`);
    for (const k of [...Object.keys(st.add), ...Object.keys(st.pct)]) assert.ok(STATS[k], `${id}: ${k} is a stat`);
  }
  for (const id of Object.keys(BUFF_ITEMS)) assert.ok(ITEMS[id]?.buff, `${id} buff item`);
  const g = arena();
  const P = g.player;
  const S = g.stats;
  const G = g.gear;
  P.inventory.add('iron_sword');
  P.inventory.add('steel_sword');
  P.inventory.add('iron_mail');
  P.inventory.add('hearth_charm');
  P.inventory.add('lucky_knucklebone');
  const atk0 = S.get(P, 'atk');
  // Compare says what wearing it would do, and changes nothing.
  const cmp = G.compare('iron_sword');
  assert.deepEqual(cmp.map((c) => c.stat), ['atk']);
  assert.equal(cmp[0].delta, 3);
  assert.equal(S.get(P, 'atk'), atk0);
  assert.ok(G.equip('iron_sword').ok);
  assert.equal(S.get(P, 'atk'), atk0 + 3);
  assert.equal(P.inventory.count('iron_sword'), 0, 'worn, not carried');
  assert.equal(g.combat.attackPower(P), atk0 + 3, 'combat reads the synced attack');
  // A better sword goes in its place; the old one back into the bag.
  const swap = G.equip('steel_sword');
  assert.equal(swap.swapped, 'iron_sword');
  assert.equal(P.inventory.count('iron_sword'), 1);
  assert.ok(G.equip('iron_mail').ok);
  assert.ok(S.get(P, 'def') >= 2 && S.get(P, 'maxHp') > 80);
  // Two charms fill the two charm slots.
  assert.equal(G.equip('hearth_charm').slot, 'charm1');
  assert.equal(G.equip('lucky_knucklebone').slot, 'charm2');
  assert.ok(S.get(P, 'hpRegen') > 0 && S.get(P, 'crit') > 0.1);
  assert.ok(G.unequip('charm2').ok);
  assert.equal(P.inventory.count('lucky_knucklebone'), 1);
  // Upgrades at Bram's forge cost ore, crystals and coin.
  const cost = G.upgradeCost('steel_sword');
  assert.deepEqual(cost, upgradeCost('steel_sword', 0));
  assert.equal(G.upgrade('steel_sword').ok, false, 'no ore yet');
  P.inventory.add('iron_ore', 30);
  P.inventory.add('crystal', 10);
  P.inventory.add('coin', 1000);
  const coin = P.inventory.count('coin');
  const atk1 = S.get(P, 'atk');
  const up = G.upgrade('steel_sword');
  assert.ok(up.ok, up.reason);
  assert.equal(G.level('steel_sword'), 1);
  assert.ok(S.get(P, 'atk') > atk1);
  assert.equal(P.inventory.count('coin'), coin - cost.coin);
  while (G.upgrade('steel_sword').ok);
  assert.equal(G.level('steel_sword'), G.maxLevel('steel_sword'));
  assert.equal(G.upgradeCost('steel_sword'), null, 'as good as it gets');
  assert.equal(G.upgradeCost('hearth_charm'), null, 'Bram works weapons and armor');
  // Forging: some recipes wait for level and trust.
  const recipes = G.recipes();
  assert.ok(recipes.some((r) => r.id === 'steel_sword' && r.open));
  assert.ok(recipes.some((r) => r.id === 'forgesung_blade' && !r.open && r.why));
  const f = G.forge('iron_sword');
  assert.ok(f.ok, f.reason);
  assert.equal(P.inventory.count('iron_sword'), 2);
});

test('shops stock gear by giver; bosses drop special pieces', () => {
  for (const [who, list] of Object.entries(SHOP_STOCK)) {
    const p = NPC_PROFILES.find((x) => x.id === who);
    assert.ok(p, who);
    for (const s of list) {
      assert.ok(ITEMS[s.id], `${who} sells ${s.id}`);
      assert.ok(p.shop.sells.some((x) => x.id === s.id), `${who}'s shop has ${s.id} (installProgression stocks it)`);
    }
  }
  assert.ok(SHOP_STOCK.sabeth.every((s) => GEAR[s.id].slot === 'cloak'), 'Sabeth sews cloaks');
  assert.ok(SHOP_STOCK.garrick.some((s) => GEAR[s.id]?.slot === 'charm'), 'Garrick sells charms');
  assert.ok(SHOP_STOCK.mira.some((s) => ITEMS[s.id].buff) && SHOP_STOCK.elda.every((s) => ITEMS[s.id].buff), 'Mira and Elda sell buffs');
  const g = arena();
  const P = g.player;
  g.bus.emit('boss_defeated', { id: 'varek', boss: { x: P.x, y: P.y } });
  const drops = g.entities.all().filter((e) => e.itemId && BOSS_GEAR.varek.includes(e.itemId));
  assert.equal(drops.length, BOSS_GEAR.varek.length, 'the cleaver lies where Varek fell');
  g.bus.emit('boss_defeated', { id: 'varek', boss: { x: P.x, y: P.y } });
  assert.equal(g.entities.all().filter((e) => e.itemId && BOSS_GEAR.varek.includes(e.itemId)).length, BOSS_GEAR.varek.length, 'once');
});

test('combat, magic, movement and survival read the pipeline', () => {
  const g = arena();
  const P = g.player;
  const S = g.stats;
  const wolf = g.foes[0];
  // Armor bites flat, but never below the floor share of a hit.
  S.addModifier(P, { id: 'wall', add: { def: 50 } });
  const hp = P.hp;
  g.combat.damage(wolf, P, 20, { exact: true });
  assert.equal(hp - P.hp, Math.round(20 * S.armorFloor));
  S.removeModifier(P, 'wall');
  // Damage taken (glass) and dealt (bloodprice) multiply.
  P.invuln = 0;
  S.addModifier(P, { id: 'glass', mul: { dmgTaken: 1.5 } });
  const hp2 = P.hp;
  g.combat.damage(wolf, P, 10, { exact: true });
  assert.equal(hp2 - P.hp, 15);
  S.removeModifier(P, 'glass');
  S.addModifier(P, { id: 'blood', pct: { dmgDealt: 0.2 } });
  wolf.invuln = 0;
  const w0 = wolf.hp;
  g.combat.damage(P, wolf, 10, { exact: true });
  assert.equal(w0 - wolf.hp, 12);
  S.removeModifier(P, 'blood');
  // Dodge: a clean miss.
  S.addModifier(P, { id: 'cat', add: { dodge: 0.4 } });
  g.combat.random = () => 0.1;
  P.invuln = 0;
  const hp3 = P.hp;
  assert.equal(g.combat.damage(wolf, P, 10), 0);
  assert.equal(P.hp, hp3);
  S.removeModifier(P, 'cat');
  // Crit chance and damage from the attacker's stats.
  S.addModifier(P, { id: 'keen', add: { crit: 0.5, critMul: 1 } });
  g.combat.random = () => 0.3;
  wolf.invuln = 0;
  const w1 = wolf.hp;
  g.combat.damage(P, wolf, 10, { exact: true });
  assert.equal(w1 - wolf.hp, 25, '10 × 2.5');
  S.removeModifier(P, 'keen');
  g.combat.random = () => 0.5;
  // Magic: weave power, mana cost and cooldown.
  g.magic.unlockAll();
  const plan = g.magic.compile({ shape: 'bolt', essences: ['raw'], twists: [] });
  assert.equal(g.magic.costOf(P, plan), plan.cost);
  S.addModifier(P, { id: 'free', mul: { manaCost: 0 } });
  assert.equal(g.magic.costOf(P, plan), 0);
  S.removeModifier(P, 'free');
  S.addModifier(P, { id: 'quick', pct: { castSpeed: 1 } });
  assert.ok(Math.abs(g.magic.cooldownOf(P, plan) - plan.cooldown / 2) < 1e-6);
  S.removeModifier(P, 'quick');
  S.addModifier(P, { id: 'power', add: { spellPower: 0.5 } });
  assert.equal(g.magic.powerOf(P), 1.5);
  S.removeModifier(P, 'power');
  // Movement reads the synced speed field.
  const sp = P.speed;
  S.addModifier(P, { id: 'boots', pct: { speed: 0.1 } });
  step(g);
  assert.ok(Math.abs(P.speed - sp * 1.1) < 1e-6);
  // Status resistance shortens statuses.
  resetArena(g);
  const ice = g.magic.applyStatus(wolf, 'chilled', { potency: 1 });
  const plain = ice?.t;
  g.magic.status.clear(wolf);
  S.addModifier(wolf, { id: 'stubborn', add: { resist: 0.5 } });
  const ice2 = g.magic.applyStatus(wolf, 'chilled', { potency: 1 });
  assert.ok(plain > 0 && Math.abs(ice2.t - plain * 0.5) < 1e-6, 'resisted for half as long');
  // Survival: the pipeline's bleed-out window and carrying pace.
  S.addModifier(P, { id: 'resolve', add: { bleedout: 20 }, pct: { carrySpeed: 0.2 } });
  assert.equal(S.get(P, 'bleedout'), 95);
  assert.equal(S.get(P, 'carrySpeed'), 1.2);
});

test('survival weakness is folded into the pipeline once, never twice', () => {
  const g = arena();
  const P = g.player;
  const S = g.stats;
  let conditions = [{ source: 'survival:bruised', label: 'Bruised', until: 300, seconds: 300, mul: { atk: 0.8, speed: 0.9 } }];
  g.survival = {
    now: () => 0,
    modifiers: (a) => (a === P ? conditions : []),
    mul: () => 1,
  };
  S.touch();
  const atk = S.get(P, 'atk');
  conditions = [];
  S.touch();
  assert.ok(Math.abs(S.get(P, 'atk') * 0.8 - atk) < 1e-6);
  conditions = [{ source: 'survival:bruised', label: 'Bruised', until: 120, seconds: 300, mul: { atk: 0.8, speed: 0.9 } }];
  S.touch();
  const weak = S.modifiers(P).find((m) => m.kind === 'weak');
  assert.equal(weak.t, 120);
  assert.equal(S.foldsSurvival, true, 'survival.mul defers to the pipeline');
});

test('buff food and potions are timed modifiers; a buff potion drinks at full health', () => {
  const g = arena();
  const P = g.player;
  P.inventory.add('ironbark_tonic');
  P.inventory.add('emberroot_soup');
  P.hp = P.maxHp;
  const def0 = g.stats.get(P, 'def');
  assert.ok(g.combat.useItem(P, 'ironbark_tonic'));
  assert.equal(g.stats.get(P, 'def'), def0 + 2);
  assert.ok(g.combat.useItem(P, 'emberroot_soup'));
  assert.ok(g.stats.get(P, 'resist') > 0);
  const t = g.stats.getModifier(P, 'buff:ironbark_tonic').t;
  assert.equal(t, BUFF_ITEMS.ironbark_tonic.buff.seconds);
  g.stats.update(t + 1);
  assert.equal(g.stats.get(P, 'def'), def0);
});

test('save and load keep points, gear, upgrades, buffs and active prices', () => {
  const g = arena();
  const P = g.player;
  g.combat.giveXp(P, xpToNext(1) + xpToNext(2) + xpToNext(3));
  g.progression.spend('vitality', 4);
  g.progression.spend('weave', 2);
  P.inventory.add('steel_sword');
  P.inventory.add('murrel_cloak');
  P.inventory.add('iron_ore', 20);
  P.inventory.add('crystal', 5);
  g.gear.equip('steel_sword');
  g.gear.equip('murrel_cloak');
  g.gear.upgrade('steel_sword');
  P.inventory.add('swiftfoot_draught');
  g.combat.useItem(P, 'swiftfoot_draught');
  g.magic.unlock('price', 'glass', 'test');
  g.magic.cast(P, { shape: 'bolt', essences: ['raw'], twists: [], prices: ['glass'] }, { x: P.x + 50, y: P.y });
  step(g, 2);
  const want = g.stats.all(P);
  const data = JSON.parse(JSON.stringify({ player: { level: P.level, xp: P.xp, inv: P.inventory.serialize() }, magic: g.magic.serialize(), progression: saveProgression(g) }));

  const h = arena();
  const Q = h.player;
  Q.level = data.player.level;
  Q.xp = data.player.xp;
  Q.inventory.deserialize(data.player.inv);
  loadProgression(h, data.progression);
  h.magic.deserialize(data.magic);
  assert.deepEqual(h.progression.points, g.progression.points);
  assert.deepEqual(h.gear.equipped, g.gear.equipped);
  assert.equal(h.gear.level('steel_sword'), 1);
  assert.ok(h.stats.getModifier(Q, 'buff:swiftfoot_draught'));
  assert.ok(h.stats.getModifier(Q, 'price:glass:gain') && h.stats.getModifier(Q, 'price:glass:cost'), 'glass carries on');
  assert.ok(h.magic.unlocked.prices.has('glass'));
  const got = h.stats.all(Q);
  for (const k of STAT_IDS) assert.ok(Math.abs(got[k] - want[k]) < 1e-6, `${k}: ${got[k]} vs ${want[k]}`);
  // A save from before gear wears the sword it carried.
  const old = arena();
  old.player.inventory.add('iron_sword');
  loadProgression(old, null);
  assert.equal(old.gear.equipped.weapon, 'iron_sword');
});

test('Lyra grows with her levels through the pipeline; slots and rarities are a closed set', () => {
  const g = arena();
  const L = g.companion;
  const hp0 = L.maxHp;
  g.combat.giveXp(L, xpToNext(1));
  assert.equal(L.level, 2);
  assert.equal(L.maxHp, hp0 + LEVEL_GROWTH.lyra.add.maxHp);
  assert.deepEqual(SLOTS, ['weapon', 'armor', 'cloak', 'boots', 'charm1', 'charm2']);
  assert.deepEqual(Object.keys(RARITY), ['common', 'uncommon', 'rare', 'epic', 'legendary']);
});
