// Hearing is a sense (DESIGN §29.4; the author, of a screenshot where Wenna, out in the street
// beyond the Ember Kettle's east wall, cries "Who's there? Stop it, whoever you are!" at a
// killing inside: "How does it sees the death from the wall?"). One rule for ears
// (src/ai/hearing.js): walls muffle, an open door lets it out, sleep dulls it. A cry tells
// what and where, never who: who did it is known by eyes or by words face to face, and a
// crime spreads only by people meeting. Each story here is played in the real headless
// Hearthvale (the player, Lyra, the eighteen, combat, the village's news, game.murder).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, downBy, villagers } from './murder_world.mjs';
import { hears, cryLoudness, LOUD, MUFFLE } from '../src/ai/hearing.js';
import { look } from '../src/murder/witness.js';
import { wallBetween } from '../src/world/walls.js';
import { HEAR_LINES } from '../src/entities/npc_lines.js';
import { profileById } from '../src/entities/npc_data.js';
import { WILL_LINES } from '../src/ai/brain/lines_will.js';

const FAR = { x: px(141), y: px(101) };

// Everyone not named goes far off and stays put: the test decides who is near.
function only(g, keep = []) {
  for (const v of villagers(g)) {
    if (keep.includes(v.id)) continue;
    put(v, FAR.x + Math.random() * 30, FAR.y + Math.random() * 30);
    v.think = () => {};
  }
  if (!keep.includes('lyra')) holdLyra(g, FAR.x, FAR.y + 80);
}

// The nearest tile to (tx, ty) a person can stand on.
function standAt(g, e, tx, ty) {
  for (let r = 0; r < 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (g.isBlockedTile(tx + dx, ty + dy, e)) continue;
        put(e, px(tx + dx), px(ty + dy));
        return e;
      }
  put(e, px(tx), px(ty));
  return e;
}

const sayings = (g, id) => g.said.filter((s) => s.who === id).map((s) => s.text);
const fighting = (e, p) => e.mode === 'fight' && e.fightTarget === p;

// ------------------------------------------------------------------ the rule itself

test('hears(): open air by loudness; a wall muffles it to under a third; an open door lets it out; sleep dulls it', () => {
  const g = makeGame({ hour: 12 });
  only(g, ['mira']);
  const mira = g.entities.get('mira');
  const sq = g.locations.get('town_square').center;
  put(mira, sq.x, sq.y);
  assert.equal(hears(g, mira, sq.x + 250, sq.y, LOUD.shout), 'clear', 'in the open, within reach');
  assert.equal(hears(g, mira, sq.x + 320, sq.y, LOUD.shout), null, 'beyond it');
  assert.equal(cryLoudness(3), 600);
  // Inside the shut Kettle, a scream; Mira out in the square below its front wall.
  const k = g.locations.get('ember_kettle').bounds;
  const door = g.objects.doorAt(70, 53);
  assert.ok(door && !door.isOpen, 'the Kettle door is shut');
  const inside = { x: px(70), y: px(50) };
  standAt(g, mira, 70, 57);
  assert.ok(wallBetween(g, mira.x, mira.y - 6, inside.x, inside.y - 6), 'the shut door between');
  assert.equal(hears(g, mira, inside.x, inside.y, LOUD.scream), 'muffled', 'just outside: a muffled scream');
  standAt(g, mira, 70, 66);
  assert.ok(Math.hypot(mira.x - inside.x, mira.y - inside.y) > LOUD.scream * MUFFLE);
  assert.equal(hears(g, mira, inside.x, inside.y, LOUD.scream), null, 'down the square: nothing (open air would carry it 600 px)');
  // Open the door: in line with it, it is open air.
  door.state.open = true;
  door.autoClose = false;
  standAt(g, mira, 70, 57);
  assert.equal(hears(g, mira, inside.x, inside.y, LOUD.scream), 'clear', 'through the open door');
  // Round the corner from the open door: it carries further than through the wall.
  standAt(g, mira, 78, 62);
  const d = Math.hypot(mira.x - inside.x, mira.y - inside.y);
  assert.ok(d > LOUD.scream * MUFFLE, `${Math.round(d)} px: past what a wall lets through`);
  assert.equal(hears(g, mira, inside.x, inside.y, LOUD.scream), 'muffled', 'out of the open door and round');
  door.state.open = false;
  assert.equal(hears(g, mira, inside.x, inside.y, LOUD.scream), null, 'the door shut: nothing');
  // Asleep, in the open: a third of the reach (the loudest scream, 0.6).
  put(mira, sq.x, sq.y);
  mira.state = 'sleep';
  assert.equal(hears(g, mira, sq.x + 250, sq.y, LOUD.shout), null);
  assert.equal(hears(g, mira, sq.x + 80, sq.y, LOUD.shout), 'clear');
  assert.equal(hears(g, mira, sq.x + 330, sq.y, LOUD.scream), 'clear');
  void k;
});

// ------------------------------------------------------------------ the author's scene

test("the author's scene: a killing inside the Ember Kettle; Wenna and Lyra out on the street hear, and know nobody", () => {
  const g = makeGame({ hour: 15 });
  only(g, ['tobias', 'elda', 'wenna', 'lyra']);
  const P = g.player;
  const tobias = g.entities.get('tobias');
  const elda = g.entities.get('elda');
  const wenna = g.entities.get('wenna');
  const L = g.companion;
  tobias.think = () => {};
  standAt(g, tobias, 73, 48);
  standAt(g, P, 72, 48);
  standAt(g, elda, 75, 47); // inside, by the east wall: she sees it
  standAt(g, wenna, 78, 47); // outside the east wall, on the street
  holdLyra(g, px(79), px(50));
  assert.equal(g.locations.at(wenna.x, wenna.y)?.id, 'hearthvale', 'Wenna is out in the street');
  assert.equal(g.locations.at(elda.x, elda.y)?.id, 'ember_kettle');
  assert.ok(wallBetween(g, wenna.x, wenna.y - 6, tobias.x, tobias.y - 6), "the Kettle's wall between them");
  assert.equal(look(g, wenna, tobias.x, tobias.y), null);
  assert.equal(look(g, L, tobias.x, tobias.y), null);
  const o0 = { wenna: wenna.opinionOfPlayer };
  P.faceToward(tobias.x, tobias.y);
  downBy(g, tobias);
  const rec = g.murder.kill(tobias, P);
  assert.ok(rec.seen.some((s) => s.id === 'elda'), 'Elda, inside, saw it');
  assert.ok(!rec.seen.some((s) => s.id === 'wenna' || s.id === 'lyra'), 'nobody outside saw it');
  // Elda stays inside for this (she would run out for the watch and tell whoever she meets).
  elda.think = () => {};
  step(g, 3);
  // Wenna heard something through the wall; she does not know who.
  assert.equal(g.murder.knowsKiller(rec, 'wenna'), false, 'Wenna does not know who');
  const r = g.village.rumors.get(rec.rumor);
  assert.ok(!r.heardBy.includes('wenna'), "Elda's scream through the wall is a noise, not words");
  assert.ok(!r.heardBy.includes('lyra'));
  assert.notEqual(wenna.fleeFrom, P, 'Wenna does not run from the player');
  assert.ok(!fighting(wenna, P));
  assert.ok(!wenna.help?.attacker, 'her help (if any) knows no culprit');
  assert.equal(wenna.knowsWanted(P), false, 'she does not know the stranger is wanted');
  assert.equal(wenna.opinionOfPlayer, o0.wenna, 'and thinks no worse of the stranger');
  const crime = profileById('wenna').crime || [];
  const own = [...HEAR_LINES.wenna.clear, ...HEAR_LINES.wenna.muffled, ...HEAR_LINES.any.muffled, ...HEAR_LINES.any.mutedNowhere];
  for (const l of sayings(g, 'wenna')) {
    assert.ok(!crime.includes(l), `no wanted line at the player: "${l}"`);
    assert.ok(!/stranger|murder|killer/i.test(l) || own.some((o) => o.split('{')[0] && l.startsWith(o.split('{')[0])), `a hearing line, not a name: "${l}"`);
  }
  // Lyra out in the street did not see the blows: no cry at the stranger, no thought of it.
  const warn = WILL_LINES.crime_warning.map((l) => (typeof l === 'string' ? l : l.t));
  const lyraSaid = sayings(g, 'lyra');
  assert.ok(!lyraSaid.some((l) => warn.includes(l)), `Lyra does not cry out at a blow she never saw: ${JSON.stringify(lyraSaid)}`);
  const thoughts = (L.mind.thoughts?.list?.() || L.mind.thoughts || []).map?.((t) => t.text || t) || [];
  assert.ok(!thoughts.some((t) => /Tobias is down/.test(String(t))), 'nor thinks she saw it');
  // Lyra was not told: no belief, no memory, no grief for him from the street.
  assert.ok(!['knows', 'believes'].includes(g.murder.lyra.tobias?.belief), `Lyra: ${g.murder.lyra.tobias?.belief}`);
  assert.ok(!rec.lyraTold);
  const mem = (L.mind.memory?.all?.() || []).filter((m) => /Tobias/.test(m.text) && /kill/i.test(m.text));
  assert.equal(mem.length, 0, 'nothing in her memory about it');
  // Nobody fights the player for it: they would have to see it, or be told.
  for (const v of villagers(g)) assert.ok(!fighting(v, P), `${v.id} is not fighting the player`);
});

// ------------------------------------------------------------------ through an open door; in the open

test('the same through an open door: heard clearly from the street, and seen on coming to the doorway', () => {
  const g = makeGame({ hour: 15 });
  only(g, ['tobias', 'mira', 'garrick']);
  const P = g.player;
  const tobias = g.entities.get('tobias');
  const mira = g.entities.get('mira');
  const garrick = g.entities.get('garrick');
  tobias.think = () => {};
  const door = g.objects.doorAt(70, 53);
  door.state.open = true;
  door.autoClose = false;
  standAt(g, tobias, 70, 50);
  standAt(g, P, 69, 50);
  standAt(g, mira, 70, 58); // in line with the open door, out in the square
  standAt(g, garrick, 63, 57); // the same distance, the wall between
  assert.equal(look(g, mira, tobias.x, tobias.y), null, 'from the square she cannot see in');
  P.faceToward(tobias.x, tobias.y);
  downBy(g, tobias);
  // Mira heard it clearly; she does not know who yet.
  assert.equal(mira.mode, 'help');
  assert.equal(mira.help.how, 'clear');
  assert.equal(mira.help.attacker, null, 'a cry names nobody');
  assert.ok(!sayings(g, 'mira').some((l) => (profileById('mira').crime || []).includes(l)), 'no wanted line yet');
  // Garrick, the wall between, heard at most a muffled noise.
  assert.notEqual(garrick.help?.how, 'clear');
  // She goes in to help, and in the doorway she sees who stands over him.
  let knew = false;
  for (let i = 0; i < 80 && !knew; i++) {
    step(g, 0.25);
    knew = mira.help?.attacker === P || mira.fleeFrom === P || g.village.rumors.list.some((r) => r.victim === 'tobias' && r.heardBy.includes('mira'));
  }
  assert.ok(knew, `on reaching the doorway she knows (mode ${mira.mode}, ${mira.help?.role}, at ${Math.round(mira.x)},${Math.round(mira.y)})`);
  assert.ok(g.locations.at(mira.x, mira.y)?.id === 'ember_kettle' || mira.distTo(tobias) < 100, 'she came to look');
});

test('in the open square: heard clearly and seen as before; behind the Kettle wall at the same distance, only heard', () => {
  const g = makeGame({ hour: 15 });
  only(g, ['tobias', 'bram', 'hobb']);
  const P = g.player;
  const tobias = g.entities.get('tobias');
  const bram = g.entities.get('bram');
  const hobb = g.entities.get('hobb');
  tobias.think = () => {};
  standAt(g, tobias, 70, 57);
  standAt(g, P, 69, 57);
  standAt(g, bram, 75, 58); // out in the square, in plain sight
  standAt(g, hobb, 70, 50); // inside the shut Kettle, the same distance
  assert.ok(look(g, bram, tobias.x, tobias.y), 'Bram sees it');
  assert.equal(look(g, hobb, tobias.x, tobias.y), null, 'Hobb does not');
  const o0 = { bram: bram.opinionOfPlayer, hobb: hobb.opinionOfPlayer };
  P.faceToward(tobias.x, tobias.y);
  downBy(g, tobias);
  // Bram saw it: he knows who, as before.
  assert.ok(bram.help?.attacker === P || bram.fleeFrom === P || fighting(bram, P), `Bram knows (${bram.mode}/${bram.help?.role})`);
  assert.ok(bram.opinionOfPlayer < o0.bram, 'and thinks less of the stranger');
  assert.equal(bram.knowsWanted(P), true);
  // Hobb, a wall between: a muffled cry from the square, nobody's name in it.
  assert.ok(!hobb.help?.attacker && hobb.fleeFrom !== P, 'Hobb does not know who');
  assert.equal(hobb.opinionOfPlayer, o0.hobb);
  assert.equal(hobb.knowsWanted(P), false);
});

// ------------------------------------------------------------------ the watch behind a wall

test('a guard 300 px away behind the smithy wall does not attack the player (nor Hess, 250 px off)', () => {
  const g = makeGame({ hour: 14 });
  only(g, ['bram', 'tilly', 'rowan', 'hess']);
  const P = g.player;
  const bram = g.entities.get('bram');
  const tilly = g.entities.get('tilly');
  const rowan = g.entities.get('rowan');
  const hess = g.entities.get('hess');
  bram.think = () => {};
  standAt(g, bram, 103, 54);
  standAt(g, P, 102, 54);
  standAt(g, tilly, 104, 55); // she sees it: the crime is on record
  // North of the smithy, out in the open, its wall between.
  const spot = (dist) => {
    for (let a = -1.2; a <= 1.2; a += 0.1) {
      const x = bram.x + Math.sin(a) * dist;
      const y = bram.y - Math.cos(a) * dist;
      const tx = Math.floor(x / 16);
      const ty = Math.floor(y / 16);
      if (g.isBlockedTile(tx, ty, null) || g.map.buildingAt(tx, ty)) continue;
      if (!wallBetween(g, x, y - 6, bram.x, bram.y - 6)) continue;
      return { x: tx * 16 + 8, y: ty * 16 + 8 };
    }
    return null;
  };
  const rs = spot(300);
  const hs = spot(250);
  assert.ok(rs && hs, 'spots behind the smithy');
  put(rowan, rs.x, rs.y);
  put(hess, hs.x + 20, hs.y);
  assert.ok(Math.abs(Math.hypot(rowan.x - bram.x, rowan.y - bram.y) - 300) < 20);
  P.faceToward(bram.x, bram.y);
  downBy(g, bram);
  assert.ok(P.crime, 'Tilly saw it: the stranger is wanted');
  step(g, 3);
  assert.ok(!fighting(rowan, P), `Rowan does not come at the player (${rowan.mode})`);
  assert.ok(!fighting(hess, P), `nor Hess (${hess.mode})`);
  assert.equal(rowan.knowsWanted(P), false, 'Rowan has heard nothing he could name');
});

// ------------------------------------------------------------------ crimes spread by meeting

function squareAssault(g) {
  only(g, ['tobias', 'bram', 'mira']);
  const P = g.player;
  const tobias = g.entities.get('tobias');
  const bram = g.entities.get('bram');
  const mira = g.entities.get('mira');
  tobias.think = () => {};
  bram.think = () => {};
  standAt(g, tobias, 76, 60);
  standAt(g, P, 75, 60);
  standAt(g, bram, 79, 61);
  // Mira across the village, in the open: no ear reaches her.
  put(mira, px(20), px(20));
  mira.think = () => {};
  const o0 = { mira: mira.opinionOfPlayer, bram: bram.opinionOfPlayer };
  P.faceToward(tobias.x, tobias.y);
  tobias.invuln = 0;
  g.combat.damage(P, tobias, 5, { exact: true, crit: false });
  return { P, tobias, bram, mira, o0 };
}

test('a villager across the village is not colder the same day: nobody told her', () => {
  const g = makeGame({ hour: 12 });
  const { P, bram, mira, o0 } = squareAssault(g);
  const day = g.clock.day;
  assert.ok(P.crime, 'Bram saw it: on record');
  assert.equal(bram.coldDay, day, 'the one who saw it is cold to the stranger');
  assert.ok(bram.opinionOfPlayer < o0.bram);
  step(g, 2);
  assert.notEqual(mira.coldDay, day, 'Mira, across the village, is not colder');
  assert.equal(mira.opinionOfPlayer, o0.mira, 'nor thinks less of the stranger');
  assert.equal(mira.knowsWanted(P), false);
});

test('a witness who saw it still tells others face to face: then they are colder', () => {
  const g = makeGame({ hour: 12 });
  const { P, bram, mira, o0 } = squareAssault(g);
  const day = g.clock.day;
  const r = g.village.rumors.list.find((x) => x.kind === 'attacked_villager' && x.victim === 'tobias');
  assert.ok(r && r.heardBy.includes('bram') && !r.heardBy.includes('mira'), 'Bram carries it; Mira has not heard');
  assert.notEqual(mira.coldDay, day);
  // Bram walks over to Mira (both out in the square).
  const sq = g.locations.get('town_square').center;
  put(mira, sq.x + 40, sq.y + 20);
  put(bram, sq.x + 70, sq.y + 20);
  for (let i = 0; i < 60 && !r.heardBy.includes('mira'); i++) step(g, 0.5);
  assert.ok(r.heardBy.includes('mira'), 'he told her, face to face');
  assert.ok(mira.coldDay === day || mira.wrongedDay === day, 'now she is colder to the stranger');
  assert.ok(mira.opinionOfPlayer < o0.mira, 'and thinks less of them');
  assert.equal(mira.knowsWanted(P), !!P.crime && P.crime.until > g.clock.t, 'and knows they are wanted, while they are');
});
