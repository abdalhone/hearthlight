import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, downBy, events, villagers } from './murder_world.mjs';
import { VILLAGERS } from '../src/ai/social/bonds_data.js';
import { look, witnessesOf, lineOfSight, lightAt } from '../src/murder/witness.js';
import { FINISH_HOLD, UNKILLABLE, HOUR, DAY, hidingPlace, STAND_INS } from '../src/murder/data.js';
import { trial } from '../src/murder/grief.js';
import { suspicionOf, WEIGHTS } from '../src/murder/investigation.js';
import { MISSIONS } from '../src/missions/data.js';
import { MissionSystem } from '../src/missions/system.js';
import { TILE } from '../src/core/constants.js';
import { hears, voiceOf, silence, isSilenced, LOUD } from '../src/ai/hearing.js';
import { drawBody } from '../src/murder/draw.js';

// Killing, witnesses, bodies and what the village can know (DESIGN §29). The author: "if I
// killed someone without nobody seeing it, nobody should know… they would feel that he's
// missing."

const WOODS = { tx: 62, ty: 14 }; // deep in Whisperwood: nobody's day takes them there

// Everyone but `keep` sent far off and held there; Lyra too unless kept.
function quiet(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
}

function hold(e) {
  e.think = () => {};
  e.walker?.stop?.();
}

// A dry tile on Mirror Lake's far shore, water to its west.
function lakeShore(g) {
  const b = g.locations.get('mirror_lake').bounds;
  for (let ty = b.y + 20; ty < b.y + b.h; ty++) {
    for (let tx = b.x + 25; tx < b.x + b.w; tx++) {
      if (!g.map.isWater(tx, ty) && !g.isBlockedTile(tx, ty, null) && g.map.isWater(tx - 1, ty)) return { x: px(tx), y: px(ty) };
    }
  }
  throw new Error('no shore');
}

// The news of a body found reaching Lyra face to face (DESIGN §29.2, §29.4): someone who
// knows tells her (the village's 'found_dead' rumor), as it would by meeting her.
function tellLyra(g, deadId, by) {
  const c = g.villageLife.cases.get(deadId);
  const r = c?.deadRumor ? g.village.rumors.get(c.deadRumor) : null;
  assert.ok(r, 'the village has the news of the body');
  g.village.rumors.hear(r, 'lyra', by, g.rng);
  g.murder.tickNews();
}

function stepTo(g, hour, dt = 1 / 8) {
  for (let i = 0; i < 4000 && !(g.clock.hour >= hour && g.clock.hour < hour + 0.5); i++) step(g, 5, dt);
}

test('the finishing blow is held, warned about once, and never falls on Lyra or a child', async () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'pip']);
  const bram = g.entities.get('bram');
  const pip = g.entities.get('pip');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  g.player.faceToward(bram.x, bram.y);
  assert.equal(downBy(g, bram), true);
  // The first time: a warning, and no blow until it is understood.
  g.flags.finisherWarned = false;
  let asked = null;
  g.ui.confirm = (o) => {
    asked = o;
    return Promise.resolve(true);
  };
  assert.equal(g.murder.onAttackPress(g.player), true, 'the press is taken, not swung');
  assert.ok(asked && /die, for good/.test(asked.text) && asked.danger, 'a clear warning');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(g.flags.finisherWarned, true);
  assert.equal(g.murder.hold, null, 'the warning ends that press');
  // Held: the blow falls after FINISH_HOLD seconds; let go early and it does not.
  let held = true;
  g.input.down = (a) => a === 'attack' && held;
  assert.equal(g.murder.onAttackPress(g.player), true);
  step(g, FINISH_HOLD * 0.5, 1 / 20);
  held = false;
  step(g, 0.2, 1 / 20);
  assert.equal(g.murder.hold, null);
  assert.ok(!bram.dead, 'let go: no blow');
  held = true;
  g.murder.onAttackPress(g.player);
  step(g, FINISH_HOLD + 0.3, 1 / 20);
  assert.ok(bram.dead, 'held long enough: dead');
  assert.ok(g.murder.isDead('bram'));
  // Never a child, never Lyra.
  put(pip, g.player.x + 10, g.player.y);
  pip.hp = 1;
  g.combat.damage(g.player, pip, 99, { exact: true, crit: false });
  assert.ok(pip.downed);
  g.player.faceToward(pip.x, pip.y);
  g.murder.onAttackPress(g.player);
  step(g, FINISH_HOLD + 0.5, 1 / 20);
  assert.ok(!pip.dead && pip.downed, 'Pip lies there, alive');
  assert.equal(g.murder.kill(pip, g.player), null);
  assert.equal(g.murder.kill(g.entities.get('tansy'), g.player), null);
  assert.equal(g.murder.kill(g.companion, g.player), null);
  for (const id of ['pip', 'tansy', 'lyra']) assert.ok(UNKILLABLE.has(id));
});

test('witnesses are exactly those who could see: distance, walls, night and its lamps, trees', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['elda']);
  const elda = g.entities.get('elda');
  hold(elda);
  const sq = g.locations.get('town_square').center;
  // Distance by day.
  put(elda, sq.x + 130, sq.y);
  assert.ok(look(g, elda, sq.x, sq.y), 'by day, 130 px off, she sees');
  put(elda, sq.x + 190, sq.y);
  assert.equal(look(g, elda, sq.x, sq.y), null, 'too far');
  // Walls: inside the smithy, nobody outside sees.
  const smithy = g.locations.get('smithy');
  const inside = smithy.center;
  put(elda, inside.x, inside.y + 200);
  assert.equal(look(g, elda, inside.x, inside.y), null, 'a wall in the way');
  put(elda, inside.x + 30, inside.y);
  assert.ok(look(g, elda, inside.x, inside.y), 'the same room is seen whole');
  // Night: the dark hides what daylight would show; a lit lamp shows it again.
  g.clock.skipTo(23.5);
  const lamp = g.objects.all().find((o) => o.objType === 'lamp' && o.kind === 'post' && !g.map.buildingAt(o.tx, o.ty));
  const x = lamp.x;
  const y = lamp.y + 8;
  lamp.state.lit = false;
  put(elda, x + 95, y);
  assert.ok(lightAt(g, x, y) < 0.3);
  assert.equal(look(g, elda, x, y), null, 'at night, 95 px off in the dark: nothing');
  lamp.state.lit = true;
  assert.ok(lightAt(g, x, y) > 0.5, 'the lamp lights the spot');
  assert.ok(look(g, elda, x, y), 'under a lamp, she sees');
  lamp.state.lit = false;
  put(elda, x + 30, y);
  assert.ok(look(g, elda, x, y), 'close by, even in the dark');
  // Trees: deep in the wood, a stand of trunks hides what is behind them.
  g.clock.skipTo(12);
  let blocked = null;
  for (let ty = 4; ty < 22 && !blocked; ty++) {
    for (let tx = 40; tx < 110 && !blocked; tx++) {
      const trees = [0, 1, 2].filter((k) => (g.objects.objectsAt(tx + k, ty) || []).some((o) => o.objType === 'tree'));
      if (trees.length >= 2 && !g.isBlockedTile(tx - 2, ty, null) && !g.isBlockedTile(tx + 4, ty, null)) blocked = { a: { x: px(tx - 2), y: px(ty) }, b: { x: px(tx + 4), y: px(ty) } };
    }
  }
  assert.ok(blocked, 'a stand of trees in the wood');
  assert.equal(lineOfSight(g, blocked.a.x, blocked.a.y, blocked.b.x, blocked.b.y), false, 'two trunks block the view');
  // And a killing in front of exactly one of two people.
  put(elda, sq.x + 40, sq.y);
  const garrick = g.entities.get('garrick');
  hold(garrick);
  put(garrick, inside.x, inside.y);
  const w = witnessesOf(g, sq.x, sq.y).map((x) => x.id);
  assert.ok(w.includes('elda') && !w.includes('garrick'));
});

test('unseen: nobody knows. The dead are missed, asked after, searched for and declared missing', () => {
  const g = makeGame({ hour: 9 });
  holdLyra(g, px(150), px(112));
  const bram = g.entities.get('bram');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  assert.deepEqual(witnessesOf(g, bram.x, bram.y, { exclude: ['bram'] }), []);
  downBy(g, bram);
  assert.equal(g.player.crime ?? null, null, 'a knockout nobody saw is no crime yet');
  assert.ok(g.murder.isSecret('bram'), 'only Bram knows');
  const rec = g.murder.kill(bram, g.player);
  assert.ok(rec && bram.dead);
  assert.deepEqual(rec.seen, []);
  assert.equal(rec.known, null);
  assert.ok(!g.murder.isSecret('bram'), 'what he knew died with him');
  // Into the lake.
  g.murder.bodyInteract(bram, g.player);
  assert.equal(g.player.carrying, bram);
  const shore = lakeShore(g);
  put(g.player, shore.x, shore.y);
  assert.equal(hidingPlace(g, g.player.x, g.player.y)?.kind, 'lake');
  assert.match(g.murder.promptFor(g.player), /Sink Bram in the lake/);
  g.murder.carrierInteract(g.player);
  assert.equal(rec.hidden?.kind, 'lake');
  assert.ok(bram.hidden && !g.player.carrying);
  put(g.player, px(96), px(79));
  stepTo(g, 22.5);
  const c = g.villageLife.cases.get('bram');
  assert.ok(c, 'the village noticed');
  assert.equal(c.status, 'missing', 'by nightfall, missing');
  assert.ok(c.timeline.some((x) => /search/i.test(x.kind)), 'they searched');
  // And nobody knows why.
  assert.equal(g.player.crime ?? null, null);
  assert.equal(events(g, 'crime').filter((e) => e.victim?.id === 'bram').length, 0);
  assert.ok(!g.village.rumors.list.some((r) => r.kind === 'murder' || r.kind === 'attacked_villager' || r.kind === 'downed_villager'));
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'missing'));
  assert.equal(g.murder.cases.bram, undefined, 'no body, no murder');
  assert.equal(g.murder.lyra.bram, undefined, 'Lyra has nothing to weigh');
  assert.ok(VILLAGERS.every((id) => g.murder.toneFor(g.entities.get(id)) == null));
});

test('seen: murder — the cry, the watch, the village turns, shops refuse, and Lyra cuts the stranger off', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'elda', 'rowan', 'garrick', 'lyra']);
  const sq = g.locations.get('town_square').center;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  const rowan = g.entities.get('rowan');
  for (const e of [bram, elda, rowan]) hold(e);
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 60, sq.y + 10);
  put(rowan, sq.x - 330, sq.y);
  holdLyra(g, sq.x - 26, sq.y - 22);
  const before = elda.opinionOfPlayer;
  downBy(g, bram);
  assert.equal(g.player.crime?.kind, 'knockout', 'Elda saw the knockout');
  const rec = g.murder.kill(bram, g.player);
  const seen = rec.seen.map((s) => s.id);
  assert.ok(seen.includes('elda') && seen.includes('lyra'));
  assert.equal(rec.known, 'witnessed');
  // Nobody else knows yet (DESIGN §29.2): Elda is terrified and runs for the watch; the
  // watch knows only when she reaches them and tells them.
  assert.notEqual(g.player.crime?.kind, 'murder', 'the watch does not know yet');
  assert.ok(elda.terror && g.murder.fearOf(elda) === 'terror', 'Elda is terrified');
  put(rowan, elda.x + 24, elda.y);
  for (let i = 0; i < 120 && g.player.crime?.kind !== 'murder'; i++) step(g, 0.25, 1 / 10);
  assert.equal(g.player.crime.kind, 'murder', 'she reached the Captain: wanted now');
  assert.equal(rec.alarm.by, 'rowan');
  assert.ok(g.combat.isHostile(rowan, g.player), 'the watch hunts the stranger');
  assert.ok(events(g, 'crime').some((e) => e.kind === 'murder' && e.victim === bram));
  assert.ok(g.said.some((s) => s.who === 'elda'), 'Elda cried out');
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'murder' && r.victim === 'bram' && r.heardBy.includes('elda')));
  assert.ok(elda.opinionOfPlayer < before && elda.opinionOfPlayer <= 18);
  assert.equal(g.murder.toneFor(elda), 'afraid');
  assert.equal(g.murder.refusesTrade(g.entities.get('garrick')), true, 'no shop sells to a known killer');
  // Lyra, at her gravest (§19.7): gone, and she will not forget.
  assert.equal(g.companion.mind.companionship, 'gone');
  assert.ok(g.companion.mind.autonomy.ledger.some((e) => e.deed === 'murdered_villager' && e.victimId === 'bram'));
  assert.ok(g.game?.flags?.lyra_gone || g.flags.lyra_gone);
  // The body: found at once, covered soon, the watch certain.
  assert.ok(rec.foundAt != null);
  step(g, 30, 1 / 10);
  assert.ok(rec.covered);
  assert.equal(g.murder.cases.bram.level, 'certain');
  assert.ok(g.murder.funerals.some((f) => f.about === 'bram'));
  // Before the Moot: guilty, and outside.
  trial(g.murder, 'bram', { plea: 'deny' });
  assert.equal(g.murder.cases.bram.verdict, 'guilty', 'an eyewitness is enough');
  assert.equal(g.player.crime.kind, 'outside');
  assert.ok(g.murder.flameBarred());
  assert.equal(g.flags.keptFlame ?? null, null);
});

test('a blow nobody saw is told by the one who took it: to the first who reaches them, and the watch', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['tobias', 'mira']);
  const tobias = g.entities.get('tobias');
  const mira = g.entities.get('mira');
  hold(tobias);
  hold(mira);
  put(tobias, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, tobias);
  assert.ok(g.murder.isSecret('tobias'));
  assert.equal(g.player.crime ?? null, null);
  assert.equal(g.companion.mind.autonomy.ledger.filter((e) => e.deed === 'downed_villager').length, 0, 'Lyra did not see it');
  put(mira, tobias.x + 20, tobias.y);
  step(g, 1, 1 / 10);
  assert.ok(!g.murder.isSecret('tobias'), 'he told Mira');
  assert.equal(g.player.crime?.kind, 'knockout');
});

test('carried: seen clearly with the body is murder; a glimpse of a heavy load is a clue for later', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'hess']);
  const bram = g.entities.get('bram');
  const hess = g.entities.get('hess');
  hold(bram);
  hold(hess);
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  g.murder.bodyInteract(bram, g.player);
  // A glimpse: Hess far off at dusk.
  g.clock.skipTo(20.2);
  const sq = g.locations.get('town_square').center;
  put(g.player, sq.x, sq.y);
  put(hess, sq.x + 50, sq.y - 20);
  const lk = look(g, hess, g.player.x, g.player.y);
  assert.ok(lk && lk.clarity === 'glimpse', `a glimpse (${lk?.clarity})`);
  g.murder.scanCarry();
  assert.ok(rec.clues.some((c) => c.kind === 'carry' && c.by === 'hess' && c.clarity === 'glimpse'));
  assert.equal(rec.known, null, 'a heavy load, nothing more');
  // Clearly, by day: the cry goes up.
  g.clock.skipTo(13);
  put(hess, sq.x + 24, sq.y);
  g.murder.scanCarry();
  assert.equal(rec.known, 'witnessed');
  assert.equal(g.player.crime?.kind, 'murder');
  assert.ok(rec.foundAt != null);
});

test('found later: the watch investigates from real sightings; the stranger can lie, and a sighting catches it', () => {
  const g = makeGame({ hour: 10 });
  holdLyra(g, px(150), px(112));
  const bram = g.entities.get('bram');
  const t = g.clock.t;
  // What people saw before: Hess saw Bram with the stranger by the wood; Tilly saw the
  // stranger heading in.
  g.villageLife.sight.note('hess', 'bram', { t: t - 20, x: px(80), y: px(34), place: 'whisperwood', with: 'player' });
  g.villageLife.sight.note('tilly', 'player', { t: t - 12, x: px(70), y: px(30), place: 'whisperwood', heading: 'whisperwood' });
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.equal(rec.known, null);
  put(g.player, px(96), px(79));
  // Asked by Elda, the stranger says they have not seen him.
  g.villageLife.recordClaim({ to: 'elda', about: 'bram', kind: 'not_seen' });
  // Deep in the wood nobody heard him cry out (DESIGN §29.4: Elda, 550 px off behind the
  // Kettle's walls, no longer comes running). The search reaches the wood; the body is
  // found: missing becomes murder.
  for (let i = 0; i < 6000 && rec.foundAt == null; i++) step(g, 5, 1 / 8);
  assert.ok(rec.foundAt != null, 'the search found him');
  const c = g.murder.cases.bram;
  assert.ok(c && c.lead === 'rowan');
  const kinds = c.evidence.map((e) => e.kind);
  assert.ok(kinds.includes('with_victim'), 'last seen with the stranger');
  assert.ok(kinds.includes('near_place'), 'the stranger near the place, near the time');
  assert.ok(kinds.includes('lie_caught'), 'what they told Elda does not fit');
  // Out in the wood it could have been the bandits: a belief, not a certainty.
  assert.ok(c.suspicion >= 0.5, `real suspicion (${c.suspicion})`);
  assert.ok(['some', 'strong'].includes(c.level));
  assert.equal(c.suspicion, suspicionOf(c.evidence, { outside: c.outside }));
  const before = c.suspicion;
  // The watch asks. A lie a sighting contradicts is caught.
  // (Rowan may already have walked up to the stranger to ask.)
  const s = g.murder.session || g.murder.startQuestioning('bram');
  assert.ok(s && s.by === 'rowan');
  const q = g.murder.question();
  assert.match(q.text, /When did you last see Bram/);
  const r = g.murder.answer('lie');
  assert.match(r.reply, /Hess|Tilly/);
  assert.ok(rec.answers.some((a) => a.kind === 'lie_caught'));
  assert.ok(r.suspicion > before + 0.05, 'a caught lie weighs heavily');
  assert.ok(r.suspicion >= 0.6);
  // Lyra weighs it with what she knows, once someone tells her.
  assert.ok(!g.murder.lyra.bram, 'far off, nobody has told her yet');
  tellLyra(g, 'bram', 'hess');
  assert.ok(g.murder.lyra.bram, 'she knows he is dead');
});

test('a lie nobody can contradict holds; deflecting costs a little; confessing is the end of it', () => {
  const g = makeGame({ hour: 10 });
  holdLyra(g, px(150), px(112));
  const garrick = g.entities.get('garrick');
  put(garrick, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, garrick);
  const rec = g.murder.kill(garrick, g.player);
  put(g.player, px(96), px(79));
  g.murder.found('garrick', 'hess', 'whisperwood');
  const c = g.murder.cases.garrick;
  // Nothing places the stranger there: a lie holds.
  g.villageLife.sight.note('hess', 'player', { t: g.clock.t, x: px(96), y: px(79), place: 'player_home' });
  g.murder.weigh('garrick');
  const before = c.suspicion;
  g.murder.startQuestioning('garrick');
  const r1 = g.murder.answer('lie');
  assert.ok(!rec.answers.some((a) => a.kind === 'lie_caught'), 'nobody saw otherwise');
  assert.ok(r1.suspicion <= before + 0.01);
  // A second session: deflect, then confess.
  g.murder.session = null;
  c.state = 'open';
  g.murder.startQuestioning('garrick');
  g.murder.answer('deflect');
  assert.ok(rec.answers.some((a) => a.kind === 'deflect'));
  g.murder.session = null;
  c.state = 'open';
  g.murder.startQuestioning('garrick');
  const r3 = g.murder.answer('confess');
  assert.equal(r3.done, true);
  assert.equal(r3.outcome, 'arrest');
  assert.ok(c.suspicion >= 0.99);
  assert.ok(WEIGHTS.confession === 1);
});

test('grief lasts: mourning, a funeral at the chapel, a grave, the Moot, and the work passed on', () => {
  const g = makeGame({ hour: 8 });
  holdLyra(g, px(150), px(112));
  const bram = g.entities.get('bram');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, bram);
  g.murder.kill(bram, g.player);
  put(g.player, px(96), px(79));
  g.murder.found('bram', 'hess', 'whisperwood');
  const rec = g.murder.dead.bram;
  // Those who loved him mourn, for weeks.
  const m = g.villageLife.mourning;
  assert.ok(m.tilly && m.tilly.about === 'bram' && m.tilly.until >= g.clock.day + 10, 'Tilly mourns her master');
  // The funeral today at five; the Moot tonight.
  const f = g.murder.funerals.find((x) => x.about === 'bram');
  assert.ok(f && f.day === g.clock.day && f.hour === 17);
  assert.equal(f.officiant, 'aveline');
  // Their days change: at the funeral hour the mourners go to the chapel.
  g.clock.skipTo(16.7);
  const tilly = g.entities.get('tilly');
  const e = g.murder.entryFor(tilly, { activity: 'work', at: 'smithy' }, g.clock.hour);
  assert.equal(e?.at, 'chapel');
  step(g, 37.5 * 0.6, 1 / 8);
  assert.equal(f.state, 'held');
  assert.equal(rec.state, 'buried');
  assert.equal(g.murder.graves.length, 1);
  const grave = g.entities.get('grave_bram');
  assert.ok(grave && !g.isBlockedTile(Math.floor(grave.x / TILE), Math.floor(grave.y / TILE), null));
  stepTo(g, 20);
  assert.ok(g.murder.moots.some((x) => x.about === 'bram' && x.state === 'held'));
  assert.ok(g.villageLife.events.some((x) => /Moot met/.test(x.text) && /Tilly will keep the forge/.test(x.text)));
  // Bram's forge and shop pass to Tilly.
  assert.ok(tilly.profile.shop && tilly.profile._inherited === 'bram');
  // A grieving villager's first words are about him.
  const d = g.murder.decorateDialogue(tilly, { lines: ['Hello.'], options: [] });
  assert.notEqual(d.lines[0], 'Hello.');
});

test('the dead stay dead across a save', () => {
  const g = makeGame({ hour: 9 });
  holdLyra(g, px(150), px(112));
  const wenna = g.entities.get('wenna');
  put(wenna, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, wenna);
  g.murder.kill(wenna, g.player);
  const mira = g.entities.get('mira');
  put(mira, px(WOODS.tx), px(WOODS.ty + 30));
  const data = { murder: JSON.parse(JSON.stringify(g.murder.serialize())), life: JSON.parse(JSON.stringify(g.villageLife.serialize())), npcs: Object.fromEntries(villagers(g).map((v) => [v.id, v.serialize()])) };
  const h = makeGame({ hour: 9 });
  for (const [id, nd] of Object.entries(data.npcs)) h.entities.get(id)?.deserialize?.(nd);
  h.villageLife.deserialize(data.life);
  h.murder.deserialize(data.murder);
  const w2 = h.entities.get('wenna');
  assert.ok(w2.dead && w2.absent && !w2.isAlive());
  assert.ok(h.murder.isDead('wenna'));
  assert.equal(Math.round(w2.x), Math.round(data.murder.dead.wenna.x));
  step(h, 37.5 * 2, 1 / 8);
  assert.ok(w2.dead, 'still dead after hours of play');
  assert.equal(w2.state, 'dead');
  assert.ok(!h.villageLife.villagers().filter((e) => e.isAlive()).some((e) => e.id === 'wenna'));
});

test('the world keeps working with any one of the eighteen dead (children can never be)', () => {
  for (const id of VILLAGERS) {
    const g = makeGame({ hour: 7 });
    holdLyra(g, px(150), px(112));
    g.missions = new MissionSystem(g);
    const v = g.entities.get(id);
    put(v, px(WOODS.tx + 1), px(WOODS.ty));
    put(g.player, px(WOODS.tx), px(WOODS.ty));
    const rec = g.murder.kill(v, g.player);
    if (UNKILLABLE.has(id)) {
      assert.equal(rec, null, `${id} cannot be killed`);
      assert.ok(!v.dead);
      continue;
    }
    assert.ok(rec, `${id} killed`);
    put(g.player, px(96), px(79));
    const finder = id === 'hess' ? 'tansy' : 'hess';
    g.murder.found(id, finder, 'whisperwood');
    // A day of village life with them gone.
    step(g, 37.5 * 10, 1 / 6);
    assert.ok(v.dead && !v.isAlive(), `${id} stays dead`);
    // Nobody runs an errand to them now, or plans one for them.
    const planned = g.villageLife.book.list.filter((x) => x.who === id && x.state === 'active');
    assert.equal(planned.length, 0, `${id} runs no errands`);
    // Their missions: a stand-in, or the notice board; never a dead giver.
    for (const m of MISSIONS.filter((x) => x.giver === id)) {
      const giver = g.missions.giverOf(m);
      assert.notEqual(giver, id, `${m.id} has another giver`);
      assert.ok(giver === 'board' || (STAND_INS[id] || []).includes(giver), `${m.id}: ${giver}`);
    }
    const j = g.missions.journal();
    assert.ok(Array.isArray(j.available));
    for (const c of [...j.available, ...j.board]) assert.notEqual(c.giver, id);
    // The watch, the funeral and the Moot always find someone.
    assert.ok(g.murder.cases[id]?.lead && g.murder.cases[id].lead !== id);
    const f = g.murder.funerals.find((x) => x.about === id);
    assert.ok(f && f.officiant && f.officiant !== id);
    // Everyone left can still be talked to.
    for (const n of villagers(g)) {
      if (n.dead) continue;
      const d = n.getDialogue(g.player);
      assert.ok(d.lines.length && d.options.length, `${n.id} talks with ${id} dead`);
    }
  }
});

test('Sister Aveline gone: Petra (or Mira, or Elda) tells Maren’s story instead', () => {
  const g = makeGame({ hour: 9 });
  holdLyra(g, px(150), px(112));
  const quest = g.plugins.get('quest');
  quest.advance(g.plugins.ctx, 1, 'test');
  const av = g.entities.get('aveline');
  put(av, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  g.murder.kill(av, g.player);
  g.murder.found('aveline', 'hess', 'whisperwood');
  assert.equal(quest.stageOf(g).index, 1);
  g.bus.emit('npc_topic', { npc: g.entities.get('petra'), topic: 'maren', player: g.player });
  assert.equal(quest.stageOf(g).index, 2, 'the thread goes on');
  // And Lyra's parents: if one is killed, she goes home to the other.
  const h = makeGame({ hour: 9 });
  const hobb = h.entities.get('hobb');
  holdLyra(h, px(150), px(112));
  put(hobb, px(WOODS.tx + 1), px(WOODS.ty));
  put(h.player, px(WOODS.tx), px(WOODS.ty));
  h.murder.kill(hobb, h.player);
  h.murder.found('hobb', 'hess', 'whisperwood');
  tellLyra(h, 'hobb', 'hess');
  assert.ok(['apart', 'wary', 'left', 'gone'].includes(h.companion.mind.companionship));
  step(h, 37.5 * 3, 1 / 6);
  assert.ok(h.murder.lyra.hobb?.grieved, 'she grieves her father');
  void DAY;
  void HOUR;
});

test('the lake gives back what it takes: days later, on the shore, found in the morning — missing becomes murder', () => {
  const g = makeGame({ hour: 9 });
  holdLyra(g, px(150), px(112));
  const corran = g.entities.get('corran');
  const bram = g.entities.get('bram');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  g.murder.bodyInteract(bram, g.player);
  const shore = lakeShore(g);
  put(g.player, shore.x, shore.y);
  g.murder.carrierInteract(g.player);
  assert.ok(rec.hidden.returnsAt >= g.clock.t + 2 * DAY - 1 && rec.hidden.returnsAt <= g.clock.t + 4 * DAY + 1, 'two to four days');
  put(g.player, px(96), px(79));
  // Days pass (the clock jumps; the lake keeps its own time).
  g.clock.t = rec.hidden.returnsAt + 1;
  g.clock.skipTo(5.5);
  step(g, 2, 1 / 10);
  assert.ok(rec.washedUp != null && !bram.hidden, 'washed up on the shore');
  assert.equal(rec.foundAt, null, 'nobody walks the shore before dawn');
  g.clock.skipTo(6.5);
  step(g, 2, 1 / 10);
  assert.ok(rec.foundAt != null, 'found in the morning');
  assert.equal(rec.foundBy, 'corran', 'Corran walks his shore');
  assert.ok(g.murder.cases.bram, 'and the watch opens a case');
  assert.ok(g.villageLife.cases.get('bram')?.status === 'dead');
  void corran;
});

test('wanted for murder and beaten down by the watch: the Moot sits once the stranger is up', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'elda']);
  const sq = g.locations.get('town_square').center;
  const bram = g.entities.get('bram');
  const elda = g.entities.get('elda');
  hold(bram);
  hold(elda);
  put(bram, sq.x, sq.y);
  put(g.player, sq.x - 14, sq.y);
  put(elda, sq.x + 50, sq.y - 10);
  downBy(g, bram);
  g.murder.kill(bram, g.player);
  // Elda tells the watch (Wys, at her elbow).
  put(g.entities.get('wys'), elda.x + 20, elda.y);
  for (let i = 0; i < 120 && g.player.crime?.kind !== 'murder'; i++) step(g, 0.25, 1 / 10);
  assert.equal(g.player.crime.kind, 'murder');
  // The watch clears it where the stranger falls (player.js) — for a killing, that is custody.
  g.combat.clearCrime(g.player, 'arrested');
  assert.ok(g.murder.trialPending?.about === 'bram');
  step(g, 1.5, 1 / 10);
  assert.equal(g.murder.trialPending, null);
  assert.equal(g.murder.cases.bram.verdict, 'guilty', 'Elda saw it');
  assert.ok(g.murder.outside && g.player.crime?.kind === 'outside');
});

test('Lyra asks, once, when she is unsure; a denial she chooses to believe, a confession she takes to the watch', () => {
  for (const answer of ['No. I never touched him.', 'Yes. I did it.']) {
    const g = makeGame({ hour: 10 });
    holdLyra(g, px(150), px(112));
    const bram = g.entities.get('bram');
    put(bram, px(WOODS.tx + 1), px(WOODS.ty));
    put(g.player, px(WOODS.tx), px(WOODS.ty));
    downBy(g, bram);
    const rec = g.murder.kill(bram, g.player);
    put(g.player, px(96), px(79));
    g.murder.found('bram', 'hess', 'whisperwood');
    tellLyra(g, 'bram', 'hess');
    const st = g.murder.lyra.bram;
    st.belief = 'fears';
    st.weighAt = Infinity;
    holdLyra(g, g.player.x + 30, g.player.y);
    step(g, 1, 1 / 10);
    assert.ok(st.asked, 'she asked');
    assert.ok(g.murder.lyraAsking);
    g.bus.emit('player_message', { text: answer });
    assert.ok(g.murder.lyraReply?.text, 'she answers in her own words');
    if (answer.startsWith('No')) {
      assert.equal(st.answered, 'denied');
      assert.equal(st.belief, 'doubts');
    } else {
      assert.equal(st.answered, 'confessed');
      assert.equal(g.companion.mind.companionship, 'gone');
      assert.ok(rec.answers.some((a) => a.kind === 'lyra_told'), 'she told the watch');
      assert.ok(g.murder.cases.bram.suspicion >= 0.85);
    }
  }
});

// ------------------------------------------------------------------ round 14b, the base (F6)
// DESIGN §35.1 (records), §36.3 (die), §37.2 (silent, unmarked), §37.3 (onFound).

test('round 14b: a killing records who, why and whether they fought first; villager_killed says so; old saves read as unknown', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'garrick']);
  const bram = g.entities.get('bram');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  downBy(g, bram);
  const rec = g.murder.kill(bram, g.player);
  assert.equal(rec.by, 'player');
  assert.equal(rec.cause, 'killed');
  assert.equal(rec.provoked, false, 'Bram never raised a hand to the stranger');
  assert.equal(rec.silent, false);
  assert.equal(rec.unmarked, false);
  assert.equal(bram.absent.cause, 'killed');
  const ev = events(g, 'villager_killed').find((e) => e.id === 'bram');
  assert.ok(ev && ev.cause === 'killed' && ev.by === 'player' && ev.provoked === false);
  assert.equal(events(g, 'villager_died').length, 0, 'a killing is never a death nobody did');
  // One who struck the stranger in the last 20 s was provoked.
  const garrick = g.entities.get('garrick');
  put(garrick, px(WOODS.tx), px(WOODS.ty + 1));
  g.combat._noteAggression(g.player, garrick); // combat's own record of who hurt whom
  downBy(g, garrick);
  assert.equal(g.murder.provoked(garrick, g.player), true);
  g.clock.t += 25;
  assert.equal(g.murder.provoked(garrick, g.player), false, 'longer ago than 20 s is not provoked');
  g.clock.t -= 25;
  g.player.lastAttacker = garrick;
  g.player.lastAttackedAt = g.clock.t;
  const r2 = g.murder.kill(garrick, g.player);
  assert.equal(r2.provoked, true, 'Garrick hit the stranger first');
  // Squaring up to the stranger, answering a cry (the help role 'confront'), is provoking too.
  const elda = g.entities.get('elda');
  assert.equal(g.murder.provoked(elda, g.player), false);
  elda.mode = 'help';
  elda.help = { role: 'confront', attacker: g.player };
  assert.equal(g.murder.provoked(elda, g.player), true);
  elda.help = null;
  elda.mode = 'routine';
  // An old save's record (no cause, no by, no provoked) reads as a killing, the rest unknown.
  const data = JSON.parse(JSON.stringify(g.murder.serialize()));
  for (const r of Object.values(data.dead)) {
    delete r.cause;
    delete r.by;
    delete r.provoked;
    delete r.silent;
    delete r.unmarked;
  }
  const h = makeGame({ hour: 12 });
  h.murder.deserialize(data);
  const old = h.murder.dead.bram;
  assert.equal(old.cause, 'killed');
  assert.equal(old.by, null);
  assert.equal(old.provoked, null);
  assert.equal(old.silent, false);
  assert.equal(old.unmarked, false);
  assert.equal(h.entities.get('bram').absent.cause, 'killed');
});

test('round 14b: die() is a death nobody did: no alarm, no case, no wanted, villager_died only; a minor never dies of age', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['petra', 'hess', 'pip']);
  const petra = g.entities.get('petra');
  const hess = g.entities.get('hess');
  hold(hess);
  put(petra, px(WOODS.tx + 1), px(WOODS.ty));
  put(hess, px(WOODS.tx + 3), px(WOODS.ty)); // in plain view of it: she still sees nothing done
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  const rec = g.murder.die(petra, { cause: 'age' });
  assert.ok(rec && petra.dead);
  assert.equal(rec.cause, 'age');
  assert.equal(rec.natural, true);
  assert.equal(rec.by, null);
  assert.deepEqual(rec.seen, [], 'no witnesses to a death nobody did');
  assert.equal(rec.known, null);
  assert.equal(rec.unmarked, true, 'old age leaves no wound');
  assert.equal(petra.absent.cause, 'age');
  assert.deepEqual(events(g, 'villager_killed'), [], 'never villager_killed');
  const died = events(g, 'villager_died');
  assert.equal(died.length, 1);
  assert.equal(died[0].id, 'petra');
  assert.equal(died[0].cause, 'age');
  assert.equal(g.player.crime ?? null, null, 'no wanted');
  assert.equal(g.murder.wanted, null);
  assert.equal(events(g, 'crime').length, 0, 'no alarm');
  assert.equal(events(g, 'murder_witnessed').length, 0);
  assert.equal(g.murder.cases.petra, undefined, 'no case');
  assert.ok(!g.village.rumors.list.some((r) => r.kind === 'murder'));
  // Found: grief and a funeral, but no case and no blade.
  g.murder.found('petra', 'hess', 'whisperwood');
  assert.equal(g.murder.cases.petra, undefined, 'found: still no case');
  assert.ok(g.murder.funerals.some((f) => f.about === 'petra'), 'a funeral all the same');
  const bf = events(g, 'body_found').find((e) => e.id === 'petra' && 'murder' in e);
  assert.equal(bf.murder, false);
  assert.ok(!g.toasts.some((t) => /blade/i.test(t.text)), 'no blade in the news');
  // A child never dies of age; die() takes no other killing.
  const pip = g.entities.get('pip');
  assert.equal(g.murder.die(pip, { cause: 'age' }), null);
  assert.ok(!pip.dead);
  // kill() is unchanged by any of this: still a killing, still a case when found.
  assert.equal(g.murder.die(petra, { cause: 'age' }), null, 'the dead do not die twice');
});

test('round 14b: children are unkillable through isMinor (age, not a list): a grown teen can die, a child by age cannot', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'tilly', 'pip']);
  const bram = g.entities.get('bram');
  const tilly = g.entities.get('tilly');
  const pip = g.entities.get('pip');
  for (const [e, dx] of [[bram, 1], [tilly, 2], [pip, 3]]) put(e, px(WOODS.tx + dx), px(WOODS.ty));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  // Pip (9) and Tansy (15) are minors by age.
  assert.equal(g.murder.canKill(pip), false);
  assert.equal(g.murder.canKill(g.entities.get('tansy')), false);
  // The rule is the age: Bram made twelve by the calendar is a child to it.
  g.calendar = { ageOf: (id) => (id === 'bram' ? 12 : null) };
  assert.equal(g.murder.canKill(bram), false, 'a child by age is never killable');
  downBy(g, bram);
  assert.equal(g.murder.kill(bram, g.player), null);
  assert.equal(g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true }), null, 'nor by a silent spell');
  g.murder.onAttackPress(g.player);
  assert.equal(g.murder.hold, null, 'no finishing blow is held over a child');
  assert.ok(g.said.some((s) => s.who === 'player' && /Not a child/.test(s.text)));
  delete g.calendar;
  // Tilly (17) is an adult.
  assert.equal(g.murder.canKill(tilly), true);
});

test('round 14b: silent — no cry, no call for help, no scream: a tile away, behind nothing, nobody hears', () => {
  // A sleeper a tile away hears a blow and a cry (hearing.js: asleep, a third of the reach)
  // and cannot see it (asleep): the ear alone decides.
  const setup = () => {
    const g = makeGame({ hour: 12 });
    quiet(g, ['bram', 'elda']);
    const bram = g.entities.get('bram');
    const elda = g.entities.get('elda');
    hold(bram);
    hold(elda);
    put(bram, px(WOODS.tx + 1), px(WOODS.ty));
    put(elda, px(WOODS.tx + 2), px(WOODS.ty));
    elda.state = 'sleep';
    put(g.player, px(WOODS.tx), px(WOODS.ty));
    return { g, bram, elda };
  };
  // Not silent: the blow's cry carries to her.
  {
    const { g, bram, elda } = setup();
    g.combat.damage(g.player, bram, 1, { exact: true, crit: false });
    assert.ok(events(g, 'call_for_help').some((p) => p.victim === bram), 'he cries out');
    assert.ok(g.murder.heardBy(bram, 2), 'and she hears it');
    assert.ok(hears(g, elda, bram.x, bram.y, voiceOf(g, bram, LOUD.scream)));
  }
  // Held silent (the Unkindling's hold): nothing at all.
  {
    const { g, bram, elda } = setup();
    silence(g, bram, 5);
    assert.ok(isSilenced(g, bram));
    g.combat.damage(g.player, bram, 1, { exact: true, crit: false });
    assert.equal(events(g, 'call_for_help').length, 0, 'no call for help');
    assert.equal(g.murder.heardBy(bram, 3), false);
    assert.equal(hears(g, elda, bram.x, bram.y, voiceOf(g, bram, LOUD.scream)), null, 'loudness 0 through the hearing rule');
    assert.equal(elda.uneasy ?? null, null, 'she sleeps on');
    assert.ok(!g.said.some((s) => s.who === 'bram'), 'not a word from him');
    // The silent killing itself.
    const rec = g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true });
    assert.ok(rec && bram.dead);
    assert.equal(rec.cause, 'unkindled');
    assert.equal(rec.by, 'player');
    assert.equal(rec.silent, true);
    assert.equal(bram.absent.cause, 'unkindled');
    assert.equal(events(g, 'call_for_help').length, 0);
    assert.equal(g.murder.heardBy(bram, 3), false);
    const ev = events(g, 'villager_killed').find((e) => e.id === 'bram');
    assert.ok(ev.silent && ev.unmarked && ev.cause === 'unkindled');
    assert.equal(elda.uneasy ?? null, null);
    assert.equal(elda.state, 'sleep');
    // Seconds pass: the hold on a living person ends (silence(…, 5)); the dead stay silent.
    step(g, 6, 1 / 10);
    assert.ok(isSilenced(g, bram), 'a body killed silently stays silent');
  }
  // Eyes are not ears: one awake who SEES a silent killing is a witness (the sight rule).
  {
    const { g, bram } = setup();
    const hess = g.entities.get('hess');
    hold(hess);
    put(hess, px(WOODS.tx + 1), px(WOODS.ty + 3));
    const rec = g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true });
    assert.ok(rec.seen.some((s) => s.id === 'hess'), 'she saw it');
    assert.equal(rec.known, 'witnessed');
  }
});

test('round 14b: unmarked — no blood under the body; the record keeps it across a save', () => {
  const g = makeGame({ hour: 12 });
  quiet(g, ['bram', 'mira']);
  const bram = g.entities.get('bram');
  const mira = g.entities.get('mira');
  put(bram, px(WOODS.tx + 1), px(WOODS.ty));
  put(mira, px(WOODS.tx + 1), px(WOODS.ty + 4));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  // Blood where someone stood (a fall's pool): an unmarked death leaves the ground clean.
  g.survival.trail.pool(bram.x, bram.y - 3, 1);
  assert.equal(g.survival.trail.marks.length, 1);
  const rec = g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true });
  assert.equal(rec.unmarked, true);
  assert.equal(bram.unmarked, true, 'layBody reads it');
  assert.equal(g.survival.trail.marks.length, 0, 'no blood where he lies');
  // The renderer draws no stain under an unmarked body, and one under a marked one.
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 400, height: 240 }, globalAlpha: 1 }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) {
      t[k] = v;
      if (k === 'fillStyle') calls.push(['fillStyle', v]);
      return true;
    },
  });
  const stains = () => calls.filter((c) => c[0] === 'fillStyle' && /^#(3d0910|5c0f17)$/.test(c[1])).length;
  drawBody(bram, rec, ctx, 0, 0, 0);
  assert.equal(stains(), 0, 'unmarked: no blood drawn');
  drawBody(bram, { ...rec, unmarked: false }, ctx, 0, 0, 0);
  assert.ok(stains() > 0, 'a marked killing leaves blood');
  // Saved and restored.
  const data = JSON.parse(JSON.stringify(g.murder.serialize()));
  const h = makeGame({ hour: 12 });
  h.murder.deserialize(data);
  assert.equal(h.murder.dead.bram.unmarked, true);
  assert.equal(h.murder.dead.bram.silent, true);
  assert.equal(h.entities.get('bram').unmarked, true);
  assert.ok(isSilenced(h, h.entities.get('bram')));
});

test('round 14b: onFound — a handler owns the discovery of a cause it knows; with none, found() is unchanged', () => {
  const run = (withHandler) => {
    const g = makeGame({ hour: 12 });
    quiet(g, ['bram', 'hess']);
    const bram = g.entities.get('bram');
    put(bram, px(WOODS.tx + 1), px(WOODS.ty));
    put(g.player, px(WOODS.tx), px(WOODS.ty));
    const seenBy = [];
    let off = null;
    if (withHandler) {
      // A handler for some other cause first: it declines (returns nothing).
      g.murder.onFound((rec) => {
        seenBy.push(['other', rec.id]);
        return rec.cause === 'something_else';
      });
      off = g.murder.onFound((rec, ctx) => {
        seenBy.push(['soul', rec.id, ctx.finder, ctx.cause]);
        if (rec.cause !== 'unkindled') return false;
        g.ui.toast('No mark on him. Cold as stone.', 'warn');
        return true;
      });
    }
    g.murder.kill(bram, { cause: 'unkindled', silent: true, unmarked: true });
    put(g.player, px(96), px(79));
    g.murder.found('bram', 'hess', 'whisperwood');
    return { g, seenBy, off };
  };
  // No handler: the old discovery, the case and all.
  {
    const { g } = run(false);
    assert.ok(g.murder.cases.bram, 'a case');
    assert.ok(g.toasts.some((t) => /Struck down with a blade/.test(t.text)));
    assert.ok(g.murder.funerals.some((f) => f.about === 'bram'));
  }
  // With one: handlers in order; the owner takes the lines and the case; grief stays.
  {
    const { g, seenBy, off } = run(true);
    assert.deepEqual(seenBy.map((s) => s[0]), ['other', 'soul']);
    assert.deepEqual(seenBy[1].slice(1), ['bram', 'hess', 'unkindled']);
    assert.equal(g.murder.cases.bram, undefined, 'the owner took the case');
    assert.ok(!g.toasts.some((t) => /blade/i.test(t.text)), 'no blade');
    assert.ok(g.toasts.some((t) => /Cold as stone/.test(t.text)), "the owner's lines");
    assert.ok(g.murder.funerals.some((f) => f.about === 'bram'), 'grief and a funeral all the same');
    assert.equal(g.murder.dead.bram.foundAt != null, true);
    const bf = events(g, 'body_found').find((e) => e.id === 'bram' && e.owned);
    assert.ok(bf && bf.cause === 'unkindled');
    // Removing the handler restores the old discovery.
    off();
    assert.equal(g.murder.foundHandlers.length, 1);
  }
  // A handler that declines (or throws) leaves the default.
  {
    const g = makeGame({ hour: 12 });
    quiet(g, ['bram']);
    const bram = g.entities.get('bram');
    put(bram, px(WOODS.tx + 1), px(WOODS.ty));
    put(g.player, px(WOODS.tx), px(WOODS.ty));
    g.murder.onFound(() => {
      throw new Error('a broken handler');
    });
    downBy(g, bram);
    g.murder.kill(bram, g.player);
    g.murder.found('bram', 'hess', 'whisperwood');
    assert.ok(g.murder.cases.bram, 'still a case');
  }
});
