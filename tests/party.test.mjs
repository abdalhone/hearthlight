import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, clearScene, events } from './murder_world.mjs';
import { wolf } from './survival_world.mjs';
import { holderOf, isParty, lyraDead, partyPlugin } from '../src/core/party.js';
import { weighJoin, CompanionDuty, fightAbility } from '../src/entities/npc_companion.js';
import { DAY_SECONDS } from '../src/core/constants.js';

// Round 14b, workstream party (DESIGN §34): one companion role held by any adult, one at a
// time; a villager walks with you through their duty; the game decides who comes before any
// mind words it; children never; Lyra's own comings and goings keep the role in step.

// The open south meadow: no walls between anyone (sight and walking need no doors).
const MEADOW = { tx: 97, ty: 103 };

function scene(hour = 12) {
  const g = makeGame({ hour });
  g.plugins.register(partyPlugin);
  put(g.player, px(MEADOW.tx), px(MEADOW.ty));
  return g;
}

function bramBeside(g, opinion = 70) {
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = opinion;
  put(bram, g.player.x + 16, g.player.y);
  return bram;
}

const changes = (g) => events(g, 'companion_changed');

test('one at a time: Bram takes the role from Lyra, who goes her own way; release leaves the slot empty', () => {
  const g = scene();
  assert.equal(g.party.holderId, 'lyra');
  const bram = bramBeside(g);
  const r = g.party.invite(bram);
  assert.ok(r.ok && r.decision === 'accept', JSON.stringify(r));
  assert.equal(g.party.holderId, 'bram');
  assert.ok(bram.duty instanceof CompanionDuty, 'he walks with you on a duty');
  assert.equal(g.companion.mind.companionship, 'apart', 'Lyra lives her own day now');
  assert.ok(changes(g).some((c) => c.from === 'lyra' && c.why === 'replaced'));
  assert.ok(g.lyra === g.companion && holderOf(g) === bram, 'game.lyra stays Lyra; the holder is Bram');
  assert.equal(g.lyra.id, 'lyra');
  assert.equal(isParty(g, bram), true);
  assert.equal(isParty(g, g.companion), false);
  g.party.release('dismissed');
  assert.equal(g.party.holderId, null);
  assert.ok(bram.duty == null, 'the duty ends with the role');
  assert.equal(holderOf(g), null);
});

test("Lyra's own plans while Bram walks with you: she does not take the role back; asked from People, she does", () => {
  const g = scene();
  const bram = bramBeside(g);
  g.party.invite(bram);
  const a = g.companion.mind.autonomy;
  assert.equal(a.setCompanionship('together', '', { cause: 'back' }), false, 'her return is turned aside');
  assert.equal(g.companion.mind.companionship, 'apart');
  assert.equal(g.party.holderId, 'bram', 'one at a time');
  assert.equal(g.party.canTake(g.companion), false);
  // Asked back explicitly (People: "Ask her to travel with you again"): her will decides
  // (here she is willing; on another day she may say "after I'm done here").
  g.companion.mind.evaluateRequest = () => ({ decision: 'accept', message: '' });
  const r = g.party.invite(g.companion);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(g.party.holderId, 'lyra');
  assert.ok(bram.duty == null, 'Bram goes home');
  assert.ok(changes(g).some((c) => c.from === 'bram' && c.why === 'replaced'));
});

test('save and load keep the holder and their duty; an old save derives Lyra', () => {
  const g = scene();
  const bram = bramBeside(g);
  g.party.invite(bram);
  g.party.ask('stay');
  const saved = JSON.parse(JSON.stringify(g.party.serialize()));
  assert.equal(saved.holderId, 'bram');
  assert.equal(saved.duty.directive, 'stay');
  const h = scene();
  h.party.deserialize(saved);
  assert.equal(h.party.holderId, 'bram');
  assert.equal(h.entities.get('bram').duty?.directive, 'stay', 'his duty picks up where it was');
  const o = scene();
  o.party.deserialize(undefined);
  assert.equal(o.party.holderId, 'lyra');
});

test("the holder's death releases the role; children are never killable and never hold it", () => {
  const g = scene();
  const bram = bramBeside(g);
  g.party.invite(bram);
  // Killed (by anyone; the blood workstream's event), or a death nobody did.
  g.bus.emit('villager_killed', { id: 'bram', entity: bram, cause: 'killed' });
  assert.equal(g.party.holderId, null);
  assert.equal(changes(g).at(-1).why, 'died');
  assert.ok(bram.duty == null);
  // Struck down by you: he walked off the moment you hit him (he saw it, it was him).
  const k = scene();
  const b2 = bramBeside(k);
  k.party.invite(b2);
  b2.hp = 1;
  k.combat.damage(k.player, b2, 999, { exact: true, crit: false });
  assert.equal(k.party.holderId, null, 'struck by you, he will not walk with you');
  // Pip: never killable, never a companion.
  const pip = g.entities.get('pip');
  put(pip, g.player.x + 16, g.player.y);
  assert.ok(!g.murder.canKill?.(pip), 'a child cannot be killed');
  assert.ok(g.murder.kill(pip, g.player) == null, 'the killing never happens');
  assert.ok(!g.murder.isDead('pip'));
  assert.equal(g.party.take(pip), false);
  assert.equal(g.party.invite(pip).ok, false);
  assert.notEqual(g.party.holderId, 'pip');
});

test('party.ask: Bram answers in the same shape the HUD shows, naming nobody but himself; Lyra weighs it; alone, nothing', () => {
  const g = scene();
  const bram = bramBeside(g);
  g.party.invite(bram);
  const r = g.party.ask('follow');
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.refused, 'boolean');
  assert.ok(r.verdict && typeof r.verdict.decision === 'string' && typeof r.verdict.message === 'string');
  assert.ok(!/Lyra/.test(JSON.stringify(r)), 'his words are his own');
  // Lyra: through her own evaluateRequest (a wary Lyra may refuse).
  const l = scene();
  let asked = null;
  l.companion.mind.evaluateRequest = (req) => {
    asked = req;
    return { decision: 'refuse', message: 'Not now.' };
  };
  const lr = l.party.ask('stay');
  assert.equal(asked?.action, 'stay');
  assert.equal(lr.refused, true);
  assert.equal(lr.message, 'Not now.');
  // Alone: nobody to ask, and nothing shown.
  const a = scene();
  a.party.release('dismissed');
  const n = a.toasts.length;
  assert.deepEqual(Object.keys(a.party.ask('follow')).sort(), ['alone', 'message', 'ok', 'refused', 'verdict'].sort());
  assert.equal(a.party.ask('follow').ok, false);
  assert.equal(a.toasts.length, n, 'no toast');
});

test('weighJoin: Bram comes at opinion 70 at noon; not with a grievance, not at night, not while you are wanted and he knows', () => {
  const g = scene(12);
  const bram = bramBeside(g, 70);
  assert.equal(weighJoin(g, bram).decision, 'accept');
  assert.ok(weighJoin(g, bram).line.length > 0, 'he says it his way');
  bram.wrongedDay = g.clock.day;
  assert.deepEqual([weighJoin(g, bram).decision, weighJoin(g, bram).why], ['refuse', 'grievance']);
  bram.wrongedDay = -1;
  const night = scene(23);
  const b2 = bramBeside(night, 90);
  assert.deepEqual([weighJoin(night, b2).decision, weighJoin(night, b2).why], ['refuse', 'night']);
  const w = scene(12);
  const b3 = bramBeside(w, 90);
  w.player.crime = { kind: 'murder', until: w.combat.now() + 999, t: w.combat.now() };
  assert.deepEqual([weighJoin(w, b3).decision, weighJoin(w, b3).why], ['refuse', 'wanted']);
  // Low opinion: no.
  const low = scene(12);
  assert.equal(weighJoin(low, bramBeside(low, 20)).decision, 'refuse');
});

test('children never: Pip and Tansy (15) are refused by the game itself; Tilly (17) and Wys can hold the role', () => {
  const g = scene(12);
  for (const id of ['pip', 'tansy']) {
    const e = g.entities.get(id);
    e.opinionOfPlayer = 100;
    const v = weighJoin(g, e);
    assert.equal(v.decision, 'refuse', id);
    assert.equal(v.why, 'child', id);
    assert.equal(v.narration, true, `${id}: the game says it, not the child`);
    assert.match(v.line, /child/);
    assert.equal(g.party.canHold(e), false, id);
  }
  assert.equal(g.party.canHold('tilly'), true);
  assert.equal(g.party.canHold('wys'), true);
  // Tansy at 16 is an adult to every system.
  g.calendar = { ageOf: (id) => (id === 'tansy' ? 16 : null) };
  assert.equal(g.party.canHold('tansy'), true);
  delete g.calendar;
});

test('Bram follows you, fights a wolf beside you, and goes home at bedtime; the village knows where he is', () => {
  const g = scene(12);
  clearScene(g, ['bram']);
  const bram = bramBeside(g);
  g.party.invite(bram);
  // He keeps up: the player stands 6 tiles off; he walks over.
  put(g.player, px(MEADOW.tx), px(MEADOW.ty - 6));
  step(g, 6);
  const d = Math.hypot(bram.x - g.player.x, bram.y - g.player.y);
  assert.ok(d < 60, `he follows (${Math.round(d)} px)`);
  // The village knows: away with the stranger, not missing.
  const away = g.villageLife.absences.get('bram');
  assert.equal(away?.mode, 'away');
  assert.equal(away?.cause, 'companion');
  assert.ok(!g.villageLife.cases.get?.('bram'), 'no missing case');
  // A wolf comes at you: he fights it.
  const w = wolf(g, g.player.x + 40, g.player.y);
  w.provokedBy = g.player;
  w.provokedMode = 'fight';
  w.provokedAt = g.combat.now();
  step(g, 2);
  assert.equal(bram.mode, 'fight');
  assert.ok(bram.fightTarget === w, 'beside you, against what threatens you'); // (identity check, no object diff)
  w.removed = true;
  step(g, 2);
  // Bedtime: he says goodnight and goes home.
  g.clock.t += (10.5 * DAY_SECONDS) / 24;
  step(g, 4);
  assert.equal(g.party.holderId, null, 'the slot is empty');
  assert.ok(bram.duty == null);
  assert.equal(changes(g).at(-1).why, 'night');
  assert.ok(g.said.some((s) => s.who === 'bram'), 'he said something as he went');
});

test("a mind's act 'join' is weighed by the game, never taken on trust; leave releases", () => {
  const g = scene(12);
  const bram = bramBeside(g, 10);
  const r = g.party.onVillagerAct(bram, 'join', { say: 'Aye, I will come.' });
  assert.equal(r.ok, false, 'the game said no, whatever the words');
  assert.equal(g.party.holderId, 'lyra');
  bram.opinionOfPlayer = 80;
  assert.equal(g.party.onVillagerAct(bram, 'join').ok, true);
  assert.equal(g.party.holderId, 'bram');
  g.party.onVillagerAct(bram, 'wait');
  assert.equal(bram.duty?.directive, 'stay');
  g.party.onVillagerAct(bram, 'leave');
  assert.equal(g.party.holderId, null);
});

test('a villager companion is in the party and stays lawful: hitting him is assault', () => {
  const g = scene(12);
  const bram = bramBeside(g);
  g.party.invite(bram);
  assert.equal(g.combat.isParty(bram), true);
  assert.equal(g.combat.isLyra(bram), false);
  assert.equal(g.combat.isLawful(bram), true, 'still a person of Hearthvale');
  assert.equal(g.combat.isLyra(g.companion), true);
  assert.equal(g.combat.isLawful(g.companion), false);
  assert.equal(g.combat.isParty(g.player), true);
  bram.hp = bram.maxHp;
  g.combat.damage(g.player, bram, 3, { exact: true, crit: false });
  // Hit on purpose: he will not walk with you after it (whoever else saw it; he did).
  assert.equal(g.party.holderId, null);
  assert.equal(changes(g).at(-1).why, 'gone');
  // A weave's splash on him is an accident, not a blow.
  const h = scene(12);
  const b2 = bramBeside(h);
  h.party.invite(b2);
  h.combat.damage(h.player, b2, 2, { exact: true, crit: false, accident: true });
  assert.equal(h.party.holderId, 'bram');
});

test('a companion who sees you strike someone walks off; the role is free', () => {
  const g = scene(12);
  const bram = bramBeside(g);
  g.party.invite(bram);
  const tob = g.entities.get('tobias');
  put(tob, g.player.x - 16, g.player.y);
  g.bus.emit('crime', { actor: g.player, victim: tob, kind: 'assault', witnesses: ['bram'] });
  assert.equal(g.party.holderId, null);
  assert.ok(['fear', 'gone'].includes(changes(g).at(-1).why));
});

test('fight ability: the watch is trained, Bram is able, the old keep out of it', () => {
  const g = scene(12);
  assert.equal(fightAbility(g, g.entities.get('rowan')), 2);
  assert.equal(fightAbility(g, g.entities.get('bram')), 1);
  assert.equal(fightAbility(g, g.entities.get('petra')), 0);
});

test('a dead Lyra: nothing of hers runs, the role is released, her page is a memorial', async () => {
  const { lyraPage } = await import('../src/ui/people_view.js');
  const g = scene(12);
  const L = g.companion;
  let thought = 0;
  const upd = L.mind.update.bind(L.mind);
  L.mind.update = (dt) => {
    thought++;
    return upd(dt);
  };
  // As the blood workstream's killing would record it.
  g.murder.dead.lyra = { id: 'lyra', cause: 'killed', t: g.clock.t, day: g.clock.day };
  g.bus.emit('villager_killed', { id: 'lyra', entity: L, cause: 'killed' });
  assert.equal(lyraDead(g), true);
  assert.equal(g.party.holderId, null, 'the role is released');
  assert.equal(g.flags.lyra_dead, true);
  L.hp = 0;
  L.dead = true;
  step(g, 3);
  assert.equal(thought, 0, 'her mind does not run');
  assert.equal(L.downed, false, 'not knocked out');
  assert.equal(L.dead, true, 'and never gets up');
  assert.equal(g.party.canHold(L), false);
  assert.equal(g.party.invite(L).ok, false);
  const page = lyraPage(g);
  assert.equal(page.dead, true);
  assert.match(page.memorial.line, /is dead/);
});
