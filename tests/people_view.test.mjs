import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put } from './murder_world.mjs';
import { privacyOf, peopleList, lyraPage, lyraContext, youPage, villagerPage, PEOPLE_SECTIONS } from '../src/ui/people_view.js';
import { MIND_TABS } from '../src/ui/mind_panel.js';

// Round 14b, item 12 (DESIGN §34.5): People. Some of Lyra's memories, knowledge and diary
// the player sees, some not; nobody's soul is the player's to edit.

test('privacy: a memory about you shows only when she shared or cited it; others are only counted', () => {
  const shared = new Set(['m1']);
  assert.equal(privacyOf({ kind: 'memory', entry: { id: 'm1', text: 'We walked to the chapel.', about: ['player'] } }, { shared }), 'visible');
  assert.equal(privacyOf({ kind: 'memory', entry: { id: 'm2', text: 'I watched them sleep.', about: ['player'] } }, { shared }), 'private');
  assert.equal(privacyOf({ kind: 'memory', entry: { id: 'm1', text: 'About Bram.', about: ['bram'] } }, { shared }), 'private', 'not about you');
  assert.equal(privacyOf({ kind: 'memory', entry: { id: 'm3', text: 'Cited.', about: ['player'] } }, { cited: new Set(['m3']) }), 'visible');
  assert.equal(privacyOf(null), 'private');
});

test('privacy: secrets need the bond AND the telling; diary pages need reading; theories stay hers', () => {
  const ctx = { told: new Set([0]), bond: 2, read: new Set([3]) };
  assert.equal(privacyOf({ kind: 'secret', index: 0, revealAtBond: 2 }, ctx), 'visible');
  assert.equal(privacyOf({ kind: 'secret', index: 0, revealAtBond: 3 }, ctx), 'private', 'the bond is not deep enough');
  assert.equal(privacyOf({ kind: 'secret', index: 1, revealAtBond: 2 }, ctx), 'private', 'not told');
  assert.equal(privacyOf({ kind: 'diary', day: 3 }, ctx), 'visible');
  assert.equal(privacyOf({ kind: 'diary', day: 4 }, ctx), 'private');
  assert.equal(privacyOf({ kind: 'knowledge', entry: { text: 'x', source: 'player' } }), 'visible');
  assert.equal(privacyOf({ kind: 'knowledge', entry: { text: 'x', source: 'told' } }), 'visible');
  assert.equal(privacyOf({ kind: 'knowledge', entry: { text: 'x', source: 'inferred' } }), 'private', 'her own theory');
  assert.equal(privacyOf({ kind: 'knowledge', entry: { text: 'x', kind: 'rumor', source: 'told' } }), 'private', 'a rumour');
});

test('no Soul and no Data: the sections have none, and the Mind panel lost both tabs', () => {
  for (const s of PEOPLE_SECTIONS) assert.ok(!/soul|data/i.test(s), s);
  const ids = MIND_TABS.map((t) => t.id);
  assert.ok(!ids.includes('soul') && !ids.includes('data'), ids.join(','));
});

test('the list: You first, then Lyra, then whoever walks with you, then those you have met', () => {
  const g = makeGame({ hour: 12 });
  put(g.player, px(97), px(103));
  let list = peopleList(g);
  assert.deepEqual(list.slice(0, 2).map((p) => p.id), ['you', 'lyra']);
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 70;
  put(bram, g.player.x + 16, g.player.y);
  g.party.invite(bram);
  g.entities.get('mira').familiarity = 5;
  list = peopleList(g);
  assert.deepEqual(list.slice(0, 4).map((p) => p.id), ['you', 'lyra', 'bram', 'mira']);
  assert.equal(list.find((p) => p.id === 'bram').holder, true);
  assert.ok(!list.some((p) => p.id === 'garrick'), 'not met, not listed');
  const you = youPage(g);
  assert.ok(you.views.length > 10, 'each villager has a view of you');
  const bp = villagerPage(g, bram);
  assert.equal(bp.standing.label, 'Friendly');
  assert.ok(!/poem/i.test(JSON.stringify(bp)), "never the profile's private description");
});

test("Lyra's page: her memories counted, read pages whole and the rest closed; dead, a memorial", () => {
  const g = makeGame({ hour: 12 });
  const L = g.companion;
  L.mind.diary = [{ day: 1, text: 'Day one. The stranger snores.' }, { day: 2, text: 'Day two.' }];
  g.flags.diary_read = [1];
  const m = L.mind.remember('The stranger gave me a moonpetal.', { about: ['player'], importance: 5 });
  let page = lyraPage(g, lyraContext(g));
  assert.ok(page.shared.kept >= 1, 'kept to herself, counted');
  assert.ok(!page.shared.memories.some((x) => /moonpetal/.test(x.text)));
  assert.deepEqual(page.diary.read.map((p) => p.day), [1]);
  assert.deepEqual(page.diary.closed, [2]);
  // Shared (she told it, or cited it): now it shows.
  L.mind.shared.add(String(m?.id ?? 'x'));
  if (m?.id != null) {
    page = lyraPage(g, lyraContext(g));
    assert.ok(page.shared.memories.some((x) => /moonpetal/.test(x.text)));
  }
  // Left or gone, she shares nothing new (talk's memories_shared is ignored).
  L.mind.autonomy.setCompanionship('gone', 'test', { cause: 'violence', goneReason: 'other' });
  g.bus.emit('memories_shared', { who: 'lyra', ids: ['new-1'] });
  assert.ok(!L.mind.shared.has('new-1'));
  // Dead: a memorial.
  g.flags.lyra_dead = true;
  page = lyraPage(g);
  assert.equal(page.dead, true);
  assert.match(page.memorial.line, /dead/);
  assert.ok(page.memorial.lastPage?.text, 'her last page (her farewell, when she wrote one)');
});
