import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put, step, downBy, events } from './murder_world.mjs';
import { partyPlugin, holderOf } from '../src/core/party.js';
import { Chat } from '../src/ui/chat.js';
import { companionView } from '../src/ui/companion_view.js';
import { peopleList, lyraPage } from '../src/ui/people_view.js';
import { afraidOptions } from '../src/entities/npc_dialogue.js';
import { WorldMap } from '../src/ui/world_map.js';
import { FINISH_HOLD } from '../src/murder/data.js';

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

test('blood x party: Lyra killed while she walks with you: the slot is empty, People is a memorial; a killed villager companion too', async () => {
  const g = scene();
  const L = g.companion;
  assert.equal(g.party.holderId, 'lyra');
  put(L, g.player.x + 14, g.player.y);
  g.player.faceToward(L.x, L.y);
  L.hp = 1;
  g.combat.damage(g.player, L, 99, { exact: true, crit: false });
  assert.ok(L.downed);
  g.flags.finisherWarnedLyra = true;
  g.input.down = (a) => a === 'attack';
  assert.equal(g.murder.onAttackPress(g.player), true);
  step(g, FINISH_HOLD + 0.4, 1 / 20);
  assert.ok(g.murder.isDead('lyra'), 'the blow fell');
  assert.equal(holderOf(g), null, 'the role is released when she dies');
  assert.equal(companionView(g), null, 'the HUD slot is empty: no card, no quote');
  const row = peopleList(g).find((x) => x.id === 'lyra');
  assert.ok(row && row.dead && row.sub === 'In memory', 'People keeps her, in memory');
  assert.equal(lyraPage(g).dead ?? true, true);
  // A villager who walks with you dies the same way; the slot empties.
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 80;
  put(bram, g.player.x + 16, g.player.y);
  assert.ok(g.party.invite(bram).ok);
  assert.equal(holderOf(g), bram);
  assert.ok(downBy(g, bram));
  assert.ok(g.murder.kill(bram, g.player));
  assert.equal(holderOf(g), null);
  assert.ok(events(g, 'companion_changed').some((c) => c.from === 'bram' && c.to == null), 'released (struck by you, downed or dead)');
  // Never a child: Pip cannot walk with you and cannot be killed.
  const pip = g.entities.get('pip');
  put(pip, g.player.x + 16, g.player.y);
  assert.equal(g.party.invite(pip).ok, false);
  assert.equal(g.murder.canKill(pip), false);
});

test("blood x talk: a posse out for you puts \"Give yourself up\" in an afraid person's dialog (murder.isHunted)", () => {
  const g = scene();
  assert.equal(typeof g.murder.isHunted, 'function');
  const elda = g.entities.get('elda');
  assert.ok(!afraidOptions(elda, g.player).some((o) => o.id === 'murder:surrender'), 'not hunted: no surrender');
  g.murder.hunt = { state: 'searching', posse: ['rowan'], lastSeen: { x: 0, y: 0, t: 0 }, reports: {} };
  assert.equal(g.murder.isHunted(), true);
  assert.ok(afraidOptions(elda, g.player).some((o) => o.id === 'murder:surrender'), 'hunted: you can give yourself up to anyone');
  g.murder.hunt.state = 'over';
  assert.equal(g.murder.isHunted(), false);
});

test('blood x party: the map names a fallen village "Hearthvale (yours)" (occupation.placeName)', () => {
  const g = scene();
  const map = new WorldMap({ game: g });
  g.travel = { marks: () => [{ kind: 'place', id: 'hearthvale', x: 10, y: 10, label: 'Hearthvale' }], seenTile: () => true, known: () => false, heard: {}, reached: {} };
  assert.equal(map.marks().find((m) => m.id === 'hearthvale').label, 'Hearthvale');
  g.occupation = { placeName: (id, name) => (id === 'hearthvale' ? `${name} (yours)` : name) };
  assert.equal(map.marks().find((m) => m.id === 'hearthvale').label, 'Hearthvale (yours)');
});
