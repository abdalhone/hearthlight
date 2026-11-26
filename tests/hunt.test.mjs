// Villagers fight back; a known killer is hunted (round 14b, item 8; DESIGN §35.2). The
// author: "the people should fight me, not just let me kill their whole village". Built on
// the one rule for eyes (sight.js) and ears (hearing.js): a defender fights only someone
// they KNOW did it; a cry they only heard brings them to look; the hunt goes to where the
// killer was last SEEN by someone who reported it, never to where the killer is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, downBy, events } from './murder_world.mjs';
import { isDefender, DEFENDER_COMBAT, defendsAgainst } from '../src/entities/defenders.js';
import { helpRole } from '../src/entities/npc.js';
import { CHASE } from '../src/murder/hunt.js';


function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

// The open middle of the town square (tiles), clear of trees and walls.
function field(g) {
  const c = g.locations.get('town_square').center;
  return { tx: Math.floor(c.x / 16), ty: Math.floor(c.y / 16) };
}

function still(e) {
  e.walker?.stop?.();
  e.mode = 'routine';
}

test('defenders: the strong grown villagers fight back; never a child, an elder, the terrified or the downed', () => {
  const g = makeGame({ hour: 12 });
  quiet(g);
  for (const id of Object.keys(DEFENDER_COMBAT)) assert.ok(isDefender(g, g.entities.get(id)), `${id} defends`);
  for (const id of ['pip', 'tansy', 'petra', 'hobb', 'wenna', 'aveline']) assert.equal(isDefender(g, g.entities.get(id)), false, `${id} does not fight`);
  // Their stats come from the defenders' table (the profiles are never edited).
  assert.ok(g.entities.get('bram').maxHp >= DEFENDER_COMBAT.bram.maxHp);
  // The terrified never.
  const bram = g.entities.get('bram');
  bram.terror = { about: 'x', since: g.clock.t, until: g.clock.t + 999 };
  assert.equal(isDefender(g, bram), false, 'terrified: no');
  bram.terror = null;
  // Never over a theft or an accident.
  assert.equal(defendsAgainst('theft'), false);
  assert.equal(defendsAgainst('assault'), true);
  assert.equal(defendsAgainst('knockout'), true);
});

test('assault Garrick in front of Bram: Bram comes at you; Pip runs; nobody fights without a crime', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['garrick', 'bram', 'pip']);
  const FIELD = field(g);
  const garrick = g.entities.get('garrick');
  const bram = g.entities.get('bram');
  const pip = g.entities.get('pip');
  for (const e of [garrick, bram, pip]) still(e);
  put(g.player, px(FIELD.tx), px(FIELD.ty));
  put(garrick, px(FIELD.tx + 1), px(FIELD.ty));
  put(bram, px(FIELD.tx + 3), px(FIELD.ty + 1));
  put(pip, px(FIELD.tx - 4), px(FIELD.ty + 3));
  // No crime yet: Bram is no foe of the stranger.
  assert.equal(g.combat.isHostile(bram, g.player), false);
  g.player.faceToward(garrick.x, garrick.y);
  g.combat.damage(g.player, garrick, 8, { kind: 'melee' });
  step(g, 0.5);
  assert.equal(bram.mode, 'fight', `Bram defends (mode ${bram.mode})`);
  assert.equal(bram.fightTarget, g.player);
  assert.equal(g.combat.isHostile(bram, g.player), true, 'combat lets him strike the one he saw do it');
  assert.notEqual(pip.mode, 'fight', 'a child never fights');
  // He lands blows.
  const before = g.player.hp;
  step(g, 4);
  assert.ok(g.player.hp < before, `Bram hits back (${before} -> ${g.player.hp})`);
});

test('heard, not seen: a defender behind a wall goes to look, never to fight a who', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['garrick', 'tobias']);
  const garrick = g.entities.get('garrick');
  const tobias = g.entities.get('tobias');
  still(garrick);
  still(tobias);
  const sm = g.locations.get('smithy').center;
  put(g.player, sm.x, sm.y);
  put(garrick, sm.x + 12, sm.y);
  put(tobias, sm.x, sm.y + 120); // outside, the smithy's wall between
  g.player.faceToward(garrick.x, garrick.y);
  g.combat.damage(g.player, garrick, 8, { kind: 'melee' });
  step(g, 0.3);
  assert.notEqual(tobias.mode, 'fight', 'he does not fight someone he did not see');
  assert.equal(g.combat.isHostile(tobias, g.player), false);
  const role = helpRole(tobias, { victim: garrick, attacker: null, sev: 2, d: 120, incident: { shielded: new Set(), fetcher: null }, game: g, heardOnly: true });
  assert.ok(['look', 'tend', 'shout', 'fetch'].includes(role), `heard only: ${role}`);
});

test('per knower: a guard who does not know the stranger is wanted is no foe of theirs', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['rowan']);
  const rowan = g.entities.get('rowan');
  const P = g.player;
  P.crime = { level: 1, kind: 'assault', until: g.clock.t + 600, victimId: 'bram', since: g.clock.t, t: g.clock.t };
  assert.equal(g.combat.hasCrime(P), true, 'the watch has it on record');
  assert.equal(g.combat.isHostile(rowan, P), false, 'Rowan has not heard of it');
  g.village.addRumor('attacked_villager', { victim: 'bram', witnesses: ['rowan'] });
  assert.equal(g.combat.isHostile(rowan, P), true, 'told: now he knows');
});

test('the hunt: the posse goes to where the killer was last seen, by someone who reported it; saved', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'rowan', 'wys', 'hess', 'sabeth', 'elda']);
  const FIELD = field(g);
  const tobias = g.entities.get('tobias');
  const rowan = g.entities.get('rowan');
  const elda = g.entities.get('elda');
  for (const id of ['tobias', 'rowan', 'wys', 'hess', 'sabeth', 'elda']) g.entities.get(id).think = () => {};
  put(g.player, px(FIELD.tx), px(FIELD.ty));
  put(tobias, px(FIELD.tx + 1), px(FIELD.ty));
  put(rowan, px(FIELD.tx + 4), px(FIELD.ty + 2));
  for (const id of ['wys', 'hess', 'sabeth']) put(g.entities.get(id), px(30), px(30));
  put(elda, px(141), px(101));
  assert.ok(downBy(g, tobias));
  const rec = g.murder.kill(tobias, g.player);
  assert.ok(rec && rec.alarm?.raised, 'Rowan saw it: the bell');
  const h = g.murder.hunt;
  assert.ok(h && h.state === 'search', 'the hunt is up');
  assert.deepEqual([h.lastSeen.x, h.lastSeen.y], [rec.x, rec.y], 'last seen at the killing');
  assert.ok(h.posse.includes('rowan') && h.posse.includes('hess'));
  // The player runs far; nobody sees: the hunt still looks where they were last seen.
  put(g.player, px(40), px(20));
  step(g, 1.5);
  assert.deepEqual([h.lastSeen.x, h.lastSeen.y], [rec.x, rec.y], 'unseen: nothing new');
  const entry = g.murder.entryFor(rowan, { activity: 'patrol', at: 'guardhouse' }, 12);
  assert.ok(entry && Math.hypot(entry.spot.x - rec.x, entry.spot.y - rec.y) < 60, 'Rowan goes to the last-seen spot');
  // Elda (she knows: the bell) sees the stranger: a report she carries.
  put(elda, g.player.x + 40, g.player.y);
  g.murder.attach();
  g.villageLife.sight.onSeen('elda', 'player');
  assert.ok(h.reports.elda, 'Elda saw them');
  assert.deepEqual([h.lastSeen.x, h.lastSeen.y], [rec.x, rec.y], 'not yet told');
  // She meets Rowan: now the posse knows.
  put(rowan, elda.x + 20, elda.y);
  step(g, 1.2);
  assert.equal(h.lastSeen.by, 'elda');
  assert.ok(Math.hypot(h.lastSeen.x - g.player.x, h.lastSeen.y - g.player.y) < 4, 'last seen where Elda saw them');
  // The posse fights the hunted with the leash lifted.
  assert.deepEqual(g.murder.chaseOf(rowan, g.player), CHASE);
  assert.equal(g.murder.chaseOf(elda, g.player), null, 'not the posse: no');
  // Saved and loaded.
  const data = JSON.parse(JSON.stringify(g.murder.serialize()));
  const g2 = makeGame({ hour: 12 });
  g2.murder.deserialize(data);
  assert.equal(g2.murder.hunt.state, 'search');
  assert.equal(g2.murder.hunt.lastSeen.by, 'elda');
  assert.deepEqual(g2.murder.hunt.posse, h.posse);
});

test('a hunt goes cold with nothing new, and ends when the stranger is no longer wanted', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'rowan']);
  const FIELD = field(g);
  const tobias = g.entities.get('tobias');
  const rowan = g.entities.get('rowan');
  rowan.think = () => {};
  put(g.player, px(FIELD.tx), px(FIELD.ty));
  put(tobias, px(FIELD.tx + 1), px(FIELD.ty));
  put(rowan, px(FIELD.tx + 4), px(FIELD.ty + 2));
  downBy(g, tobias);
  g.murder.kill(tobias, g.player);
  const h = g.murder.hunt;
  h.heardAt = g.clock.t - 3 * 37.5;
  g.murder.slowTick();
  assert.equal(h.state, 'cold');
  g.player.crime = null;
  g.murder.slowTick();
  assert.equal(h.state, 'over');
});

test('a carer who only heard stops short (at the door) until she sees who; she never walks into it', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['garrick', 'mira']);
  const garrick = g.entities.get('garrick');
  const mira = g.entities.get('mira');
  still(garrick);
  still(mira);
  garrick.think = () => {};
  const sm = g.locations.get('smithy').center;
  put(g.player, sm.x, sm.y);
  put(garrick, sm.x + 12, sm.y);
  put(mira, sm.x + 10, sm.y + 105);
  g.player.faceToward(garrick.x, garrick.y);
  garrick.hp = 12;
  g.combat.damage(g.player, garrick, 9, { kind: 'melee' });
  step(g, 0.3);
  assert.equal(mira.mode, 'help', `she heard it (${mira.mode})`);
  assert.equal(mira.help.attacker, null, 'she does not know who');
  let closest = Infinity;
  for (let i = 0; i < 40; i++) {
    step(g, 0.2);
    if (mira.help?.attacker) break;
    closest = Math.min(closest, Math.hypot(mira.x - garrick.x, mira.y - garrick.y));
  }
  assert.ok(closest > 84, `she kept her distance while she did not know who (${Math.round(closest)} px)`);
});
