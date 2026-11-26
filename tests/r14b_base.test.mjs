import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { makeGame, step, px, put } from './murder_world.mjs';
import TALK from '../src/core/plugins/talk.js';
import PARTY from '../src/core/plugins/party.js';
import BLOOD from '../src/core/plugins/blood.js';
import SOCIETY from '../src/core/plugins/society.js';
import SOUL from '../src/core/plugins/soul.js';
import POLISH from '../src/core/plugins/polish.js';

// Round 14b, Step 0 (the base): the hooks and slots every workstream codes against.
// DESIGN §33 (slots, sheets), §34.1 (NPC duty hooks).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('F10: one plugin slot per workstream, each an array, registered in one loop in game.js', () => {
  for (const slot of [TALK, PARTY, BLOOD, SOCIETY, SOUL, POLISH]) assert.ok(Array.isArray(slot));
  const src = read('src/core/game.js');
  for (const k of ['talk', 'party', 'blood', 'society', 'soul', 'polish']) assert.match(src, new RegExp(`from './plugins/${k}\\.js'`));
  assert.match(src, /for \(const p of \[\.\.\.TALK, \.\.\.PARTY, \.\.\.BLOOD, \.\.\.SOCIETY, \.\.\.SOUL, \.\.\.POLISH\]\)/);
  // Only the base's own lines register plugins in game.js: the built-ins, missions, travel,
  // the calendar, provenance and the slot loop.
  const regs = src.split('\n').filter((l) => /plugins\.register\(/.test(l));
  assert.equal(regs.length, 6, regs.join('\n'));
  // Installer functions run once the world is built.
  assert.match(src, /for \(const install of this\.slotInstallers/);
});

test('F2: game.lyra is a getter for Lyra herself; the places that mean her by id read it', () => {
  const src = read('src/core/game.js');
  assert.match(src, /get lyra\(\) \{\s*return this\.entities\?\.get\?\.\(COMPANION_ID\) \|\| this\.companion \|\| null;/);
  for (const f of ['src/murder/murder.js', 'src/murder/witness.js', 'src/world/containers.js', 'src/story/cutscene.js', 'src/missions/system.js', 'src/entities/npc.js', 'src/entities/npc_dialogue.js']) {
    assert.match(read(f), /lyraOf\(/, `${f} reads Lyra through lyraOf`);
  }
  assert.doesNotMatch(read('src/murder/murder.js'), /if \(id === 'lyra'\) return this\.game\?\.companion/);
});

test('F5: a duty runs before the routine; a fight keeps its anchor and leash, then returns to the duty', () => {
  const g = makeGame({ hour: 12 });
  const bram = g.entities.get('bram');
  const steps = [];
  // A duty that takes every beat: the routine never runs.
  bram.duty = {
    step(npc, dt, tick) {
      steps.push(tick);
      return true;
    },
  };
  let routine = 0;
  const orig = bram.routine.bind(bram);
  bram.routine = (...a) => {
    routine++;
    return orig(...a);
  };
  step(g, 1, 1 / 20);
  assert.ok(steps.length > 5, 'the duty stepped');
  assert.equal(routine, 0, 'and the routine waited');
  // A duty that returns undefined lets the routine run.
  bram.duty = { step: () => undefined };
  step(g, 0.5, 1 / 20);
  assert.ok(routine > 0);
  // The fight's leash from an anchor that moves (the player), not the post.
  bram.duty = { step: () => true };
  const wolf = { id: 'w', type: 'actor', x: bram.x + 30, y: bram.y, isAlive: () => true, dead: false, removed: false, radius: 4 };
  bram.startFight(wolf, { anchor: g.player, leash: 200 });
  assert.equal(bram.mode, 'fight');
  assert.ok(bram.fightAnchor === g.player);
  assert.equal(bram.fightLeash, 200);
  bram.endFight(wolf);
  assert.equal(bram.mode, 'duty', 'back to the duty');
  assert.equal(bram.fightAnchor, null);
  assert.equal(bram.fightLeash, null);
  // Without a duty: back to the routine, as before.
  bram.duty = null;
  bram.startFight(wolf);
  assert.equal(bram.fightAnchor, null, 'no anchor: the post, as for a guard');
  bram.endFight(wolf);
  assert.equal(bram.mode, 'routine');
});

test('F5: the leash is measured from the anchor when there is one', () => {
  const g = makeGame({ hour: 12 });
  const rowan = g.entities.get('rowan');
  const P = g.player;
  // Wanted: the watch fights the stranger (a target the leash, not hostility, will end).
  P.crime = { level: 3, kind: 'murder', until: 1e9, since: 0, t: 0 };
  const fightFrom = (opts) => {
    put(rowan, px(70), px(60));
    put(P, px(72), px(60));
    rowan.post = null;
    rowan.startFight(P, opts);
    assert.equal(rowan.mode, 'fight');
    put(rowan, px(80), px(60)); // 160 px from where he started
    put(P, px(82), px(60));
    rowan.thinkT = 0;
    rowan.think(0.05);
  };
  fightFrom(undefined);
  assert.equal(rowan.mode, 'fight', 'no anchor: the post and GUARD_LEASH (300 px) hold him');
  rowan.endFight(P);
  fightFrom({ anchor: { x: px(70), y: px(60) }, leash: 40 });
  assert.notEqual(rowan.mode, 'fight', 'anchored with a 40 px leash: 160 px away, the fight ends');
});

test('held silent: silence() lasts its seconds on the game clock (or for good), and voiceOf is 0 meanwhile', async () => {
  const { silence, unsilence, isSilenced, voiceOf, hears, LOUD } = await import('../src/ai/hearing.js');
  const g = { clock: { t: 100 } };
  const e = { id: 'bram', x: 0, y: 0 };
  assert.equal(isSilenced(g, e), false);
  assert.equal(voiceOf(g, e, LOUD.scream), LOUD.scream);
  silence(g, e, 3);
  assert.equal(isSilenced(g, e), true);
  assert.equal(voiceOf(g, e, LOUD.scream), 0);
  // Loudness 0 is heard by nobody, a tile away, with nothing between.
  const ear = { id: 'elda', x: 16, y: 0, isAlive: () => true };
  assert.equal(hears(g, ear, e.x, e.y, voiceOf(g, e, LOUD.scream)), null);
  g.clock.t = 104;
  assert.equal(isSilenced(g, e), false, 'the hold ends');
  silence(g, e, 1);
  silence(g, e); // for good
  g.clock.t = 1e9;
  assert.equal(isSilenced(g, e), true, 'a silent killing is silent for good');
  // A shorter hold never shortens a longer one.
  const f = { id: 'f' };
  silence(g, f, 10);
  silence(g, f, 1);
  assert.equal(f.silentUntil, 1e9 + 10);
  unsilence(f);
  assert.equal(isSilenced(g, f), false);
});
