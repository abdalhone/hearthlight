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
import { spawnCreature } from '../src/entities/monsters.js';

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

// ---------------------------------------------------------------- society x the others

import { makeGame as makeSocietyGame, step as stepS, holdLyra } from './society_world.mjs';
import { Occupation } from '../src/world/occupation.js';
import { chooseOption, mainOptions } from '../src/entities/npc_dialogue.js';
import { stance } from '../src/world/trade.js';

function societyScene() {
  const g = makeSocietyGame({ hour: 12 });
  if (!g.occupation) g.occupation = new Occupation(g);
  if (!g.party) g.plugins.register(partyPlugin);
  put(g.player, px(MEADOW.tx), px(MEADOW.ty));
  return g;
}

test('blood x society: a burned store sells nothing, said in their words, through the one shop rule (trade.stance)', () => {
  const g = societyScene();
  const garrick = g.entities.get('garrick');
  garrick.opinionOfPlayer = 60;
  put(garrick, g.player.x + 16, g.player.y);
  assert.equal(stance(g, garrick).refuse, false);
  const open = chooseOption(garrick, 'shop', g.player);
  assert.equal(open.open, 'shop', 'open for trade before the fire');
  g.occupation.burns.general_store = { day: 1, t: 0, by: 'player' };
  assert.equal(g.occupation.shopClosed('garrick'), true);
  const st = stance(g, garrick);
  assert.ok(st.refuse && st.why === 'burned', JSON.stringify(st));
  const r = chooseOption(garrick, 'shop', g.player);
  assert.notEqual(r.open, 'shop', 'no shop opens');
  assert.match(r.lines[0], /nothing|went up/i, 'their line, not a vanished button');
  assert.equal(g.village.standing('garrick').refusesTrade, true, 'standing() reads the same rule');
});

test("society x talk: a frightened merchant keeps Trade on the list (afraidOptions), and it is refused in their words", () => {
  const g = societyScene();
  const elda = g.entities.get('elda');
  put(elda, g.player.x + 16, g.player.y);
  const opts = afraidOptions(elda, g.player);
  assert.ok(opts.some((o) => o.id === 'shop'), JSON.stringify(opts));
  assert.ok(opts.some((o) => o.id === 'talk') && opts.at(-1).id === 'bye');
  // Not for someone with no shop.
  assert.ok(!afraidOptions(g.entities.get('pip'), g.player).some((o) => o.id === 'shop'));
});

test("blood x society: a child knows the stranger for a killer by society's per-knower rule (occupation.knowsKiller)", () => {
  const g = societyScene();
  const pip = g.entities.get('pip');
  assert.equal(g.occupation.knowsKiller(pip), false);
  // A killing Pip was told of (rec.knownBy, reputation's knowsDeed), never seen by him.
  g.murder.dead.wys = { id: 'wys', by: 'player', cause: 'killed', knownBy: ['pip'], seen: [], day: 1 };
  assert.equal(g.reputation.counts({ knownTo: 'pip' }).killedKnown, 1);
  assert.equal(g.occupation.knowsKiller(pip), true);
  assert.equal(g.occupation.knowsKiller(g.entities.get('tansy')), false, 'Tansy was not told');
  delete g.murder.dead.wys;
});

// ---------------------------------------------------------------- soul x society x blood

import { installUnkindle } from '../src/core/plugins/soul.js';

test('soul x society: the pact teaches the Unkindling; never a child; an unseen one counts for the tempter only once it is known', () => {
  const g = societyScene();
  const unk = installUnkindle(g, { fx: false, view: false });
  assert.equal(unk.learned, false);
  g.villain.seal('after');
  assert.equal(unk.learned, true, "society's pact_sealed reaches soul's learn()");
  // Everyone far off and still (Lyra too: she would see it); the player in the open meadow.
  holdLyra(g, px(150), px(112));
  for (const v of g.entities.all()) if (v.profile && v.id !== 'bram' && v.id !== 'pip') {
    put(v, px(141) + Math.random() * 20, px(101));
    v.think = () => {};
  }
  const pip = g.entities.get('pip');
  put(pip, g.player.x + 14, g.player.y);
  assert.equal(unk.check(pip)?.reason, 'child', 'never a child');
  put(pip, px(141), px(101));
  const bram = g.entities.get('bram');
  bram.think = () => {};
  put(bram, g.player.x + 14, g.player.y);
  g.player.facing = { x: 1, y: 0 };
  assert.equal(unk.check(bram), null);
  unk.begin(bram);
  for (let t = 0; unk.channel && t < 12; t += 1 / 20) {
    unk.update(1 / 20);
    stepS(g, 1 / 20, 1 / 20);
  }
  assert.ok(bram.dead && g.murder.dead.bram, 'his flame is out');
  const rec = g.murder.dead.bram;
  assert.equal(rec.cause, 'unkindled');
  assert.deepEqual(g.villain.state.kills, [], 'unseen: no kill for the tempter yet');
  assert.equal(g.reputation.counts().killedKnown, 0, 'nor for the village');
  // Linked (soul's contract): it counts now.
  rec.linked = true;
  rec.knownBy = ['hess'];
  g.bus.emit('killing_known', { id: 'bram', cause: 'unkindled', knownBy: ['hess'] });
  assert.deepEqual(g.villain.state.kills, ['bram']);
  assert.equal(g.reputation.counts({ knownTo: 'hess' }).killedKnown, 1);
});

// Round 14b final merge (verifier A + verifier B).

// Item 9 x verifier B's item 11. B ended her parting scene when she is struck or "fighting
// back now", read as any fight at all (behavior.currentTarget). In the meadow a slime or a
// wolf is often near: she turned on it, the scene ended before it began, and the letter was
// left on the table with no word said (r14b_story item 9 failed on all three screens). Only a
// fight with you ends it; a beast she fends off while she walks up to you does not.
test('her parting scene is not ended by a beast she fights; it is ended by fighting you', () => {
  const g = makeGame({ hour: 11, settings: { partingScene: true } });
  const L = g.companion;
  const P = g.player;
  const sq = g.locations.get('town_square').center;
  put(P, sq.x, sq.y);
  put(L, sq.x + 3 * 16, sq.y);
  let opened = 0;
  g.ui.chat = { field: { blur() {} }, addMessage() {}, open() {} };
  g.ui.talkTo = (id) => {
    if (id === 'lyra') opened++;
    return true;
  };
  const a = L.mind.autonomy;
  a.setCompanionship('left', 'You keep doing things I cannot stand beside.', { cause: 'trust' });
  assert.equal(a.parting.active, true, 'she walks up to say it');
  // A wolf by her, and she is fighting it.
  const w = spawnCreature(g, 'wolf', L.x + 20, L.y);
  const b = L.behavior;
  // (Held on it for the test: the autonomy looks every half second.)
  const fight = (who, seconds) => {
    for (let t = 0; t < seconds; t += 0.05) {
      b.target = who;
      step(g, 0.05, 0.05);
    }
  };
  b.target = w;
  assert.equal(b.currentTarget, w, 'she has turned on the wolf');
  fight(w, 1.5);
  assert.equal(a.parting.active, true, 'a beast she fends off does not end the scene');
  assert.ok(!g.flags.lyra_letter, 'no letter yet: she has not said it');
  // Fighting you: over.
  fight(P, 1.5);
  assert.equal(a.parting.active, false, 'fighting you, the scene ends');
  assert.ok(g.flags.lyra_letter, 'the letter is left on the table');
});
