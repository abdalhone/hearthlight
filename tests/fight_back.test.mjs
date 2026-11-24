// Lyra fights back (DESIGN §16.6, r8; the author: "she can fight me until I die —
// something cooler"). In the real headless Hearthvale: come at her again and again with
// her healthy and she stands and fights until the player has fallen (she never finishes
// them, she sends for Mira and the watch); badly hurt and outmatched she runs and calls
// for help instead; accidents never start it. Her memory, diary and the village's talk
// keep it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, stepUntil, placeAt, villagers, events } from './survival_world.mjs';

// Somewhere open, away from the village (so the test decides who is near).
function arena(game) {
  const p = game.player;
  const l = game.companion;
  const spot = game.spawns.player;
  placeAt(game, p, spot.x, spot.y);
  placeAt(game, l, spot.x + 30, spot.y);
  // Everyone else home and out of earshot.
  for (const v of villagers(game)) placeAt(game, v, spot.x + 3000 + Math.random() * 200, spot.y + 3000);
  return { p, l };
}

// The player strikes her on purpose (a sword blow), as the combat rules see it.
function strike(game, amount = 6) {
  const l = game.companion;
  l.invuln = 0;
  return game.combat.damage(game.player, l, amount, { kind: 'melee' });
}

function fallen(game) {
  return !!game.survival.isFallen(game.player);
}

test('come at her again and again while she is healthy: she stands and fights until the player has fallen', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  p.maxHp = 60;
  p.hp = 60;
  strike(game);
  step(game, 2);
  assert.equal(l.mind.autonomy.companionship, 'wary', 'the first blow gets a warning and a step back');
  assert.ok(!l.behavior.fightingBack(), 'one blow is not a fight');
  strike(game);
  step(game, 0.2);
  const choice = l.mind.autonomy.lastFightChoice;
  assert.equal(choice?.choice, 'fight', `healthy, she stands: ${JSON.stringify(choice)}`);
  assert.ok(l.behavior.fightingBack(p), 'she turns and fights');
  assert.ok(game.combat.hasCrime(p), 'and the watch hears of it');
  assert.ok(events(game, 'call_for_help').some((e) => e.victim === 'lyra' && e.severity >= 3), 'she shouts for help');
  // The player stands there; she keeps at it until they fall.
  const t = stepUntil(game, () => fallen(game), 90);
  assert.ok(t >= 0, `the player fell (hp ${p.hp}, lyra ${l.hp}/${l.maxHp})`);
  assert.ok(!p.dead, 'fallen, not dead: she never finishes them');
  const hits = events(game, 'damage').filter((e) => e.source === l && e.target === p && e.amount > 0);
  assert.ok(hits.length >= 3, `her blows landed (${hits.length})`);
  assert.ok(events(game, 'bind').some((e) => e.source === l && e.target === p), 'the Stillring held them');
  step(game, 0.5);
  assert.ok(!l.behavior.fightingBack(), 'the fight is over once they fall');
  assert.ok(l.behavior.holdsBackFrom(p), 'she keeps her distance at first');
  const end = events(game, 'lyra_fight').find((e) => e.phase === 'end');
  assert.equal(end?.reason, 'fallen');
  // She never strikes them again while they lie there.
  const before = events(game, 'damage').filter((e) => e.source === l && e.target === p).length;
  step(game, 6);
  assert.equal(events(game, 'damage').filter((e) => e.source === l && e.target === p).length, before, 'no blow on someone lying down');
  assert.ok(events(game, 'lyra_fight').some((e) => e.phase === 'fetch'), 'she sends for Mira and the watch');
  // What it leaves: she is gone from them, and it is written down.
  const A = l.mind.autonomy;
  assert.equal(A.companionship, 'gone');
  const deed = A.ledger.find((e) => e.deed === 'lethal_attack');
  assert.ok(deed && deed.outcome === 'fallen', 'the deed is on her ledger');
  const mem = (l.mind.memory?.all?.() || l.mind.memory?.items || []).map((m) => m.text || m.content || '').join(' | ');
  assert.match(mem, /fought back until they fell|fought them until they fell/i, 'she remembers it');
  assert.ok((l.mind.diary || []).some((d) => /fought/i.test(d.text)), 'her diary has it');
  const rumors = game.village?.rumors?.list || [];
  assert.ok(rumors.some((r) => r.kind === 'lethal_attack' || r.kind === 'lyra_fought_down'), 'the village talks about it');
});

test('the watch answers: they carry the stranger off, and she leaves them to it', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  strike(game);
  step(game, 2);
  strike(game);
  assert.ok(stepUntil(game, () => fallen(game), 90) >= 0);
  const rec = game.survival.falls.get(p);
  assert.ok(rec.wanted, 'wanted for going at her');
  const t = stepUntil(game, () => !!rec.carrier, 40);
  assert.ok(t >= 0, 'someone came for them');
  assert.ok(rec.carrier.isGuard, `the watch (${rec.carrier.id})`);
  assert.ok(![...rec.responders].includes(l), 'not her');
});

test('if nobody comes, she relents and comes for them herself (she never leaves a living person to die)', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  // Nobody else in the world who could come.
  for (const v of villagers(game)) v.removed = true;
  strike(game);
  step(game, 2);
  strike(game);
  assert.ok(stepUntil(game, () => fallen(game), 90) >= 0);
  const rec = game.survival.falls.get(p);
  assert.ok(rec, 'a fall on record');
  assert.ok(![...rec.responders].includes(l), 'not at first');
  const t = stepUntil(game, () => [...rec.responders].includes(l) || !fallen(game), rec.window + 5);
  assert.ok(t >= 0 && [...rec.responders].includes(l), 'she comes when time runs short');
  assert.ok(events(game, 'lyra_fight').some((e) => e.phase === 'relent'));
});

test('badly hurt and outmatched, she binds them if she can and runs to her people, calling for help', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  p.atk = 40;
  p.maxHp = 200;
  p.hp = 200;
  strike(game, 4);
  step(game, 2);
  l.hp = Math.round(l.maxHp * 0.18);
  strike(game, 2);
  step(game, 0.3);
  const choice = l.mind.autonomy.lastFightChoice;
  assert.equal(choice?.choice, 'flee', `hurt and outmatched, she runs: ${JSON.stringify(choice)}`);
  assert.ok(!l.behavior.fightingBack(), 'no fight');
  assert.equal(l.behavior.directive.type, 'flee', 'she runs');
  assert.ok(events(game, 'call_for_help').some((e) => e.victim === 'lyra'), 'and calls for help');
});

test('accidents never start it: a weave that caught her on its way elsewhere, again and again', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  for (let i = 0; i < 5; i++) {
    l.invuln = 0;
    game.combat.damage(p, l, 4, { kind: 'magic', magic: true, accident: true });
    step(game, 2);
  }
  const A = l.mind.autonomy;
  assert.ok(!l.behavior.fightingBack(), 'no fight');
  assert.ok(!A.lastFightChoice, 'nothing to weigh');
  assert.ok(!A.ledger.some((e) => e.deed === 'hit_lyra'), 'never a deliberate blow');
  assert.ok(A.ledger.some((e) => e.deed === 'hit_lyra_accident'), 'an accident, on the ledger as one');
  assert.ok(['together', 'wary'].includes(A.companionship), A.companionship);
  assert.ok(!game.combat.hasCrime(p), 'no crime');
});

test('a weave aimed at her is a deliberate blow, and two of them start the fight', () => {
  const game = makeGame({ hour: 11 });
  const { p, l } = arena(game);
  l.invuln = 0;
  game.combat.damage(p, l, 5, { kind: 'magic', magic: true, deliberate: true });
  step(game, 2);
  const A = l.mind.autonomy;
  const first = A.ledger.find((e) => e.deed === 'hit_lyra');
  assert.ok(first && first.with === 'weave', 'a deliberate weave on her ledger');
  l.invuln = 0;
  game.combat.damage(p, l, 5, { kind: 'magic', magic: true, deliberate: true });
  step(game, 0.3);
  assert.ok(l.behavior.fightingBack(p));
});
