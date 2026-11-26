import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put } from './murder_world.mjs';
import { companionView, companionBarMode } from '../src/ui/companion_view.js';

// Round 14b, TOP PRIORITY B (DESIGN §34.3): the HUD's companion slot belongs to whoever walks
// with you, or nobody. Four states: alone, Lyra, Bram, after Lyra cut ties.

function scene() {
  const g = makeGame({ hour: 12 });
  put(g.player, px(97), px(103));
  return g;
}

test('alone: no slot at all', () => {
  const g = scene();
  g.party.release('dismissed');
  assert.equal(companionView(g), null);
  assert.equal(companionBarMode(null), 'hidden');
});

test('with Lyra: her card, her standing, Jobs, "Ask Lyra"', () => {
  const g = scene();
  const v = companionView(g);
  assert.equal(v.id, 'lyra');
  assert.equal(v.name, 'Lyra');
  assert.equal(v.isLyra, true);
  assert.equal(v.portraitKey, 'lyra');
  assert.equal(v.standing.label, 'With you');
  assert.equal(v.barTitle, 'Ask Lyra');
  assert.equal(v.jobs, true);
  assert.equal(companionBarMode(v), 'full');
});

test('with Bram: his name, portrait, hp and his opinion of you; no Lyra anywhere; no Jobs', () => {
  const g = scene();
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 70;
  put(bram, g.player.x + 16, g.player.y);
  g.party.invite(bram);
  const v = companionView(g);
  assert.equal(v.id, 'bram');
  assert.equal(v.name, 'Bram');
  assert.equal(v.portraitKey, 'bram');
  assert.equal(v.hp, bram.hp);
  assert.equal(v.maxHp, bram.maxHp);
  assert.equal(v.standing.label, 'Friendly');
  assert.deepEqual(v.rel, { opinion: 70 });
  assert.equal(v.jobs, false);
  assert.equal(v.barTitle, 'Ask Bram');
  const strings = [v.name, v.status, v.barTitle, v.askLabel, v.cardTitle, v.standing.label, v.portraitKey];
  assert.ok(!strings.some((x) => /Lyra/.test(String(x))), `no "Lyra" in any string: ${strings.join(' | ')}`);
});

test('after Lyra cut ties: the slot is empty (or holds whoever you ask along)', () => {
  const g = scene();
  g.companion.mind.autonomy.setCompanionship('gone', 'test', { cause: 'violence', goneReason: 'other' });
  assert.equal(companionView(g), null);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 80;
  put(bram, g.player.x + 16, g.player.y);
  g.party.invite(bram);
  assert.equal(companionView(g).id, 'bram');
});
