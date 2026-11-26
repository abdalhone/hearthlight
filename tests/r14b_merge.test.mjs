import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put } from './murder_world.mjs';
import { partyPlugin } from '../src/core/party.js';
import { Chat } from '../src/ui/chat.js';

// Round 14b merge: the seams between the six workstreams (talk, party, blood, society,
// polish, soul) that only exist once they are together. Each test is behaviour that was
// promised by one workstream's contract and consumed by another's.

const MEADOW = { tx: 97, ty: 103 };

function scene(hour = 12) {
  const g = makeGame({ hour });
  if (!g.party) g.plugins.register(partyPlugin);
  put(g.player, px(MEADOW.tx), px(MEADOW.ty));
  return g;
}

test("talk x party: what Lyra cites in the chat becomes shared (memories_shared reaches People's mind.shared)", () => {
  const g = scene();
  const chat = new Chat({ game: g, isTouch: false });
  const seen = [];
  g.bus.on('memories_shared', (p) => seen.push(p));
  chat.addMessage({ from: 'lyra', text: 'I remember the mill fire.', memories: [{ id: 'm_mill', label: 'the mill fire' }] });
  assert.deepEqual(seen.at(-1), { who: 'lyra', ids: ['m_mill'] });
  assert.ok(g.companion.mind.shared instanceof Set && g.companion.mind.shared.has('m_mill'), 'party keeps it in mind.shared');
  // Chips attached after the line was shown count too.
  const msg = chat.addMessage({ from: 'lyra', text: 'And the bell, that night.' });
  chat.attachMemories(msg, ['m_bell']);
  assert.ok(g.companion.mind.shared.has('m_bell'));
  // A villager's words or the player's own are not Lyra confiding.
  const n = seen.length;
  chat.addMessage({ from: 'player', text: 'tell me', memories: ['m_x'] });
  assert.equal(seen.length, n);
  // Gone, she confides nothing new (party's rule), though the chat still says what she cited.
  g.companion.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
  chat.addMessage({ from: 'lyra', text: 'Leave it.', memories: ['m_secret'] });
  assert.ok(!g.companion.mind.shared.has('m_secret'));
});

test('talk x party: whoever walks with you is not picked for a chat by the well, and taking the role ends one', () => {
  const g = scene();
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 75;
  put(bram, g.player.x + 16, g.player.y);
  const v = g.village;
  assert.ok(v && typeof v.endTalk === 'function', 'village.endTalk exists for party.take');
  // Bram is mid-chat with Tobias when he is asked along.
  v.playing = { conv: { a: 'bram', b: 'tobias', lines: [] }, queue: [], t: 0, end: 10 };
  assert.ok(v.isTalking(bram));
  const r = g.party.invite(bram);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(v.isTalking(bram), false, 'his chat ends: he walks with you now');
  assert.equal(v.walksWithPlayer(bram), true);
  // While he holds the role, nobody pulls him into a chat.
  const tobias = g.entities.get('tobias');
  put(tobias, bram.x + 12, bram.y);
  assert.equal(v.requestChat(tobias, bram), false);
  assert.equal(v.requestChat(bram, tobias), false);
  g.party.release('dismissed');
  assert.equal(v.walksWithPlayer(bram), false);
});
