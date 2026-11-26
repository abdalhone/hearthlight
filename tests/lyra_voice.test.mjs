import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 14b, talk's leftovers for Lyra's own voice in the world: she says where she is only
// when you are there with her and can hear her; she keeps quiet while you lie downed unless
// she can see you or is the one coming for you; and a sound she hears and did not see makes
// her turn and say so ("What was that?"), by the one rule for ears.

import { makeGame, step, put, clearScene } from './murder_world.mjs';

const quiet = () => {
  const w = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = w;
  };
};

function lyraSaid(g) {
  return g.said.filter((s) => s.who === 'lyra').map((s) => s.text);
}

test('a place line only when the player is there with her, in earshot; never from far away', () => {
  const back = quiet();
  const g = makeGame({ hour: 11 });
  const L = g.companion;
  const barks = g.brain.barks;
  const sq = g.locations.get('town_square').center;
  const chapel = g.locations.get('chapel');
  // She walks into the chapel; the player is out in the square, far off.
  put(g.player, sq.x, sq.y);
  put(L, chapel.center.x, chapel.center.y);
  barks.pending.length = 0;
  barks.onEnter({ actor: L, location: chapel });
  assert.equal(barks.pending.length, 0, 'not said: the player is not there with her');
  // With her, side by side, in the same place: said.
  put(g.player, L.x + 14, L.y);
  barks.visited.delete('chapel');
  barks.onEnter({ actor: L, location: chapel });
  assert.ok(barks.pending.some((c) => /^place_|^place/.test(c.situation)), 'with you: she says where you both are');
  // Queued, then the player walks off before it is said: it goes unsaid.
  put(g.player, sq.x, sq.y);
  barks.lastBarkAt = -1e9;
  const before = lyraSaid(g).length;
  barks.update(0.1);
  assert.equal(lyraSaid(g).length, before, 'not said to someone no longer there');
  back();
});

test('the player down and bleeding: no chatter unless she sees them or is coming for them', () => {
  const back = quiet();
  const g = makeGame({ hour: 11 });
  clearScene(g, []);
  const L = g.companion;
  const barks = g.brain.barks;
  const b = g.locations.get('ember_kettle').bounds;
  // She is inside the Kettle, the player down out in the lane: she cannot see them.
  put(L, (b.x + 2) * 16, (b.y + b.h / 2) * 16);
  put(g.player, (b.x - 6) * 16, (b.y + b.h / 2) * 16);
  g.player.downed = true;
  const c = { situation: 'idle_lore', priority: 1, urgent: false };
  barks.lastBarkAt = -1e9;
  barks.lastLyraSpeechAt = -1e9;
  g.brain.lastReplyAt = -1e9;
  assert.equal(barks.canSpeak(c, barks.now()), false, 'quiet while they bleed out unseen');
  // In sight of them: she may speak.
  put(L, g.player.x + 30, g.player.y);
  assert.equal(barks.canSpeak(c, barks.now()), true, 'she sees them');
  // Coming for them (a rescue job), even unseen: she may speak.
  put(L, (b.x + 2) * 16, (b.y + b.h / 2) * 16);
  g.survival.jobs.set(L, { role: 'carry' });
  assert.equal(barks.canSpeak(c, barks.now()), true, 'on her way to them');
  g.survival.jobs.delete(L);
  back();
});

test('a sound she hears and did not see: she turns toward it and says so (clear, or muffled through a wall); a held-silent cry is no sound', async () => {
  const back = quiet();
  const g = makeGame({ hour: 11 });
  clearScene(g, ['elda']);
  const L = g.companion;
  const barks = g.brain.barks;
  const b = g.locations.get('ember_kettle').bounds;
  const elda = g.entities.get('elda');
  // Elda cries out inside the Kettle; Lyra stands outside its wall: muffled.
  put(elda, (b.x + 2) * 16, (b.y + b.h / 2) * 16);
  put(L, (b.x - 1.5) * 16, (b.y + b.h / 2) * 16);
  put(g.player, L.x - 20, L.y);
  barks.pending.length = 0;
  barks.cooldowns.clear();
  g.bus.emit('call_for_help', { victim: elda, victimEntity: elda, attacker: null, x: elda.x, y: elda.y, severity: 3 });
  const p = barks.pending.find((c) => c.situation === 'heard_muffled' || c.situation === 'heard_sound');
  assert.ok(p, `she heard it: ${barks.pending.map((c) => c.situation)}`);
  assert.equal(p.situation, 'heard_muffled', 'through a wall: only a sound');
  assert.ok(L.facing.x > 0, 'she turned toward it');
  const line = g.brain.speech.line(p.situation, {}, {});
  assert.ok(line && !/elda/i.test(line), `what and where, never who: ${line}`);
  // In the open and in plain sight: her eyes already tell her; no "what was that?".
  barks.pending.length = 0;
  barks.cooldowns.clear();
  put(elda, L.x - 60, L.y);
  const { seesPoint } = await import('../src/ai/sight.js');
  g.bus.emit('call_for_help', { victim: elda, victimEntity: elda, attacker: null, x: elda.x, y: elda.y, severity: 3 });
  const heardNow = barks.pending.some((c) => /^heard_/.test(c.situation));
  assert.equal(heardNow, !seesPoint(g, L, elda.x, elda.y), 'only a sound she did not see');
  // Held silent: no sound at all.
  barks.pending.length = 0;
  barks.cooldowns.clear();
  const { silence } = await import('../src/ai/hearing.js');
  silence(g, elda, 60);
  put(elda, (b.x + 2) * 16, (b.y + b.h / 2) * 16);
  g.bus.emit('call_for_help', { victim: elda, victimEntity: elda, attacker: null, x: elda.x, y: elda.y, severity: 3 });
  assert.equal(barks.pending.filter((c) => /^heard_/.test(c.situation)).length, 0, 'a silenced cry is heard by nobody');
  back();
});

test('Lyra held silent makes no cry at all (no call_for_help, no toast)', async () => {
  const g = makeGame({ hour: 11 });
  const { silence } = await import('../src/ai/hearing.js');
  const cries = [];
  g.bus.on('call_for_help', (p) => cries.push(p));
  silence(g, g.companion, 30);
  const r = g.companion.mind.autonomy.callForHelp(g.player, { reason: 'attacked', severity: 3 });
  assert.equal(r, null);
  assert.equal(cries.length, 0);
});

void step;
