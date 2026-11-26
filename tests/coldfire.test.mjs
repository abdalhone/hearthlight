import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, events } from './murder_world.mjs';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { Creature } from '../src/entities/monsters.js';
import { Stats } from '../src/core/stats.js';
import { DAY_SECONDS, TILE } from '../src/core/constants.js';
import { MAX, EBB, BOOST, TIERS, Coldfire } from '../src/magic/coldfire.js';
import { ASK_AT, SIGN_WORDS, classify, decideVerdict, evidenceOf } from '../src/society/dark_suspicion.js';
import { LINES } from '../src/magic/unkindle.js';

// Round 14b §13b (soul, part two): the taken flame that boosts your power and ebbs, the signs
// it leaves on you, the faithful who read them and come to ask, known dark magic as dangerous
// and not evil, beasts and bandits as prey. The author: "using dark magic doesn't mean that
// I'm evil. It just means that I'm dangerous. They wouldn't hate me, but they would ask me to
// stop."

const WOODS = { tx: 62, ty: 14 };

function setup({ keep = [], hour = 12 } = {}) {
  const g = makeGame({ hour });
  g.stats = new Stats(g);
  g.stats.manage(g.player);
  const unk = installUnkindle(g);
  unk.learn('test');
  g.toasts.length = 0;
  for (const v of villagers(g)) {
    v.think = () => {};
    if (keep.includes(v.id)) continue;
    put(v, px(141) + Math.random() * 20, px(101));
  }
  if (!keep.includes('lyra')) holdLyra(g, px(150), px(112));
  put(g.player, px(WOODS.tx), px(WOODS.ty));
  g.player.facing = { x: 1, y: 0 };
  g.player.dir = 'right';
  return { g, unk, P: g.player, cf: unk.coldfire, sus: unk.suspicion };
}

function near(g, id, dx = 1, dy = 0) {
  const e = id === 'lyra' ? g.companion : g.entities.get(id);
  put(e, g.player.x + dx * TILE, g.player.y + dy * TILE);
  e.faceToward?.(g.player.x, g.player.y);
  return e;
}

function beast(g, species = 'wolf', dx = 1, dy = 0) {
  return g.entities.add(new Creature(g, species, { x: g.player.x + dx * TILE, y: g.player.y + dy * TILE }));
}

function hold(g, unk, { max = 12, dt = 1 / 20 } = {}) {
  let t = 0;
  while (unk.channel && t < max) {
    unk.update(dt);
    step(g, dt, dt);
    unk.suspicion?.update?.(dt);
    t += dt;
  }
  return t;
}

// Days pass by the clock (as a night's sleep does), the soul's systems stepping after.
function days(g, unk, n, { step: s = 0.5 } = {}) {
  for (let d = 0; d < n; d += s) {
    g.clock.t += s * DAY_SECONDS;
    unk.update(0.05);
    unk.suspicion.tick();
  }
}

test('the bar fills by the soul taken: a grown person a lot, a bandit a fair amount, a beast a little', () => {
  const cf = new Coldfire({ clock: { t: 0, day: 1 } });
  const person = cf.fillFor('person', 14);
  const bandit = cf.fillFor('bandit', 15);
  const wolf = cf.fillFor('beast', 10);
  assert.ok(person > bandit && bandit > wolf && wolf > 0, `${person} > ${bandit} > ${wolf}`);
  assert.ok(cf.fillFor('person', 28) > person, 'a stronger soul gives more');
  assert.equal(cf.fillFor('dummy', 1), 0, 'straw gives nothing');
});

test('a wolf taken: prey, not murder; the bar fills, shows, and your Sword and Weave hit harder; the hold planted you', () => {
  const { g, unk, P, cf } = setup();
  const wolf = beast(g, 'wolf');
  assert.equal(unk.kindOf(wolf), 'beast');
  assert.equal(cf.shown, false, 'no bar before the first soul');
  const atk0 = g.stats.get(P, 'atk');
  const sp0 = g.stats.get(P, 'spellPower');
  const x0 = P.x;
  const y0 = P.y;
  assert.ok(unk.begin(wolf).ok);
  // Push the stick the whole time: the hold plants you (the author: "it should stop me").
  g.input.move = { x: 1, y: 0.4 };
  let moved = 0;
  let t = 0;
  while (unk.channel && t < 10) {
    unk.update(0.05);
    step(g, 0.05, 0.05);
    moved = Math.max(moved, Math.hypot(P.x - x0, P.y - y0));
    t += 0.05;
  }
  g.input.move = { x: 0, y: 0 };
  assert.ok(moved < 1.5, `stood still while pulling (moved ${moved.toFixed(2)} px)`);
  assert.ok(wolf.dead, 'its flame is out');
  assert.equal(wolf.unmarked, true);
  assert.ok(cf.bar > 0 && cf.shown);
  assert.equal(unk.prey.beast, 1);
  assert.equal(unk.tally, 0, 'not a death the Hollow counts');
  assert.equal(Object.keys(g.murder.dead).length, 0, 'no murder record');
  assert.ok(events(g, 'death').some((p) => p.entity === wolf), 'it died as creatures die (missions count it)');
  // Fill it: three more wolves and a bandit's worth.
  cf.take('beast', 10);
  cf.take('beast', 10);
  cf.take('bandit', 15);
  assert.ok(g.stats.get(P, 'atk') > atk0, 'the blade hits harder');
  assert.ok(g.stats.get(P, 'spellPower') > sp0, 'the weaves hit harder');
  cf.bar = MAX;
  cf.touch();
  assert.ok(Math.abs(g.stats.get(P, 'spellPower') - sp0 * (1 + BOOST)) < 0.02, 'a full flame: +30%, never a one-shot');
  assert.ok(unk.verdict(g.entities.get('elda')).dur < 3.6 / 1.2, 'a fuller bar pulls faster');
});

test('a roll breaks the hold, and you roll', () => {
  const { g, unk, P } = setup();
  const wolf = beast(g, 'wolf');
  assert.ok(unk.begin(wolf).ok);
  for (let i = 0; i < 6; i++) {
    unk.update(0.05);
    step(g, 0.05, 0.05);
  }
  g.input.press('dodge');
  unk.update(0.05);
  assert.equal(unk.channel?.phase, 'slip', 'the hold broke');
  assert.equal(P.rolling, true, 'and the roll went');
  assert.ok(!wolf.dead);
  hold(g, unk);
  assert.ok(wolf.controller && wolf.controller.update, 'the wolf has its own mind back');
});

test('the bar ebbs over days like a hunger; nothing is ever taken from your health', () => {
  const { g, unk, P, cf } = setup();
  const hp = P.maxHp;
  cf.take('person', 14);
  const b0 = cf.bar;
  days(g, unk, 1);
  assert.ok(Math.abs(cf.bar - (b0 - EBB)) < 0.6, `ebbed about ${EBB} in a day (${b0} -> ${cf.bar})`);
  days(g, unk, 3);
  assert.equal(cf.bar, 0, 'gone in a few days');
  assert.equal(P.maxHp, hp, 'no health lost');
});

test('the undead and what gravelight wears have nothing to take; a hen is not prey; a child never', () => {
  const { g, unk, cf } = setup({ keep: ['pip'] });
  const sk = beast(g, 'skeleton');
  assert.equal(unk.check(sk)?.line, LINES.undead);
  assert.equal(unk.begin(sk).ok, false);
  const hen = beast(g, 'chicken', 0, 1);
  assert.equal(unk.check(hen)?.reason, 'harmless');
  // Even with a full flame (much stronger than any child), a child is refused.
  cf.bar = MAX;
  const pip = near(g, 'pip', 0, -1);
  assert.equal(unk.check(pip)?.reason, 'child');
  assert.equal(unk.begin(pip).line, 'No. Not a child.');
  assert.equal(unk.suspicion.everyone().includes(pip), false, 'the asking and the signs leave children out');
});

test('the mark: the signs come on over days (faint, clear, strong) and leave over weeks once you stop', () => {
  const { g, unk, cf } = setup();
  cf.take('beast', 10);
  cf.take('beast', 10);
  cf.take('beast', 10);
  cf.take('bandit', 15);
  assert.equal(cf.tier(), 0, 'nothing shows the same day');
  days(g, unk, 1.5);
  assert.equal(cf.tier(), 1, 'faint: cold hands, breath');
  days(g, unk, 1.5);
  assert.equal(cf.tier(), 2, 'clear: the flames lean, the hens shy, frost in your steps');
  for (let i = 0; i < 4; i++) cf.take('person', 14);
  days(g, unk, 7);
  assert.equal(cf.tier(), 3, 'strong: eyes, shadow, the flowers by your bed');
  // Stop: the bar ebbs first; the mark leaves over weeks.
  days(g, unk, 20);
  assert.equal(cf.bar, 0);
  assert.ok(cf.tier() < 3);
  days(g, unk, 40);
  assert.equal(cf.tier(), 0, 'gone, weeks later');
  assert.ok(TIERS[0] > 0);
});

test('known dark magic: Bram sees a wolf taken; shaken, he calls it dark magic, and it is no crime; opinion barely moves; it travels by meeting', () => {
  const { g, unk, sus } = setup({ keep: ['bram'] });
  const bram = near(g, 'bram', -2, 0);
  const op0 = bram.opinionOfPlayer;
  const wolf = beast(g, 'wolf');
  unk.begin(wolf);
  hold(g, unk);
  assert.ok(wolf.dead);
  assert.equal(sus.people.bram?.dark, 'saw');
  assert.ok(g.said.some((s) => s.who === 'bram' && /dark|life|light/i.test(s.text)), 'shaken, in his own words');
  assert.ok(op0 - bram.opinionOfPlayer <= 6, `opinion moved little (${op0} -> ${bram.opinionOfPlayer})`);
  assert.equal(g.player.crime ?? null, null, 'no crime');
  assert.equal(Object.keys(g.murder.cases || {}).length, 0, 'no case');
  const r = g.village.rumors.list.find((x) => x.kind === 'dark_magic');
  assert.ok(r && r.heardBy.includes('bram'), 'his account, by meeting');
  assert.ok(r.severity < 0.6, 'never a grievance');
  // Told by meeting: Elda hears it from him.
  r.heardBy.push('elda');
  sus.tick();
  assert.equal(sus.people.elda?.dark, 'told');
  assert.match(unk.briefLine('elda'), /dark magic/);
  assert.match(unk.briefLine('elda'), /Dangerous, not evil/);
  assert.doesNotMatch(unk.briefLine('elda'), /killer|murder/i);
});

test('a brief carries only what they perceive: signs they saw or felt, never "souls"', () => {
  const { g, unk, sus, cf } = setup({ keep: ['elda'], hour: 23 });
  cf.mark = 2;
  cf.settled = 2;
  const elda = near(g, 'elda', 1, 0);
  elda.state = 'idle';
  elda.activity = 'idle';
  assert.equal(unk.briefLine('elda'), '');
  sus.look();
  const b = unk.briefLine('elda');
  assert.match(b, new RegExp(SIGN_WORDS.breath.brief.split(' ').slice(0, 3).join(' ')));
  assert.doesNotMatch(b, /soul|kill|dark magic/i);
  assert.match(b, /ill/, 'the ordinary wonder if you are ill');
  // Behind a wall she sees nothing of it.
  const st = sus.st('bram');
  assert.equal(Object.keys(st.signs).length, 0);
});

test('the faithful read the signs; worry travels by meeting to the faithful and friends; the ordinary are capped below the asking', () => {
  const { sus } = setup({ keep: ['aveline', 'elda', 'garrick'] });
  const elda = sus.entity('elda');
  for (let i = 0; i < 20; i++) sus.perceive(elda, 'flames', { force: true });
  assert.ok(sus.st('elda').s <= 40, 'Elda finds it odd, not damning');
  const av = sus.entity('aveline');
  sus.perceive(av, 'hands', { force: true });
  sus.perceive(av, 'flames', { force: true });
  const s1 = sus.st('aveline').s;
  assert.ok(s1 > 20, `the keeper of the flames reads it (${s1})`);
  // Elda (Aveline's friend, who tells her everything) and Garrick meet her.
  sus.onMeeting('elda', 'aveline');
  assert.ok(sus.st('aveline').s > s1, 'worry, told');
  assert.ok(sus.st('aveline').told.includes('elda'));
  sus.st('garrick');
  sus.onMeeting('aveline', 'garrick');
  // Garrick is no friend of hers and not of the faithful: it does not reach him.
  assert.equal(sus.st('garrick').s, 0);
});

test('the asking: Aveline, by day and in private, comes to you; the chat opens; the verdict is decided before it is worded', async () => {
  const { g, unk, sus, cf } = setup({ keep: ['aveline'] });
  cf.mark = 1.5;
  cf.settled = 1.5;
  const av = near(g, 'aveline', 6, 0);
  av.think = undefined;
  delete av.think;
  const st = sus.st('aveline');
  st.signs = { hands: 1, flames: 1 };
  st.s = ASK_AT + 5;
  sus.tick();
  assert.equal(sus.asking?.id, 'aveline');
  assert.equal(sus.asking.phase, 'coming');
  assert.ok(av.duty, 'a duty walks her to you');
  // She arrives (stepped), and it is private.
  put(av, g.player.x + 20, g.player.y);
  sus.tick();
  assert.equal(sus.asking.phase, 'open');
  assert.ok(g.said.some((s) => s.who === 'aveline' && /cold that takes|What are you carrying/.test(s.text)), 'she asks in her own words');
  // The brief Claude would get, read at the moment the reply is worded: the verdict is in it.
  let briefAtWording = null;
  const v = g.village;
  const plain = v.playerSays.bind(v);
  v._darkWrapped = false;
  v.playerSays = async (npc, text) => {
    briefAtWording = unk.briefLine('aveline');
    return plain(npc, text);
  };
  sus.wrapTalk();
  const reply = await v.playerSays(av, "No. I've been ill, that's all.");
  assert.match(briefAtWording, /DOUBT|BELIEVE/, briefAtWording);
  assert.equal(sus.asking?.verdict?.verdict, 'doubted', 'cold hands and leaning candles: an illness does not fit the candles');
  assert.ok(reply.lines.join(' ').length > 0, 'her own line, offline');
  assert.match(reply.lines.join(' '), /watching|isn't that/);
  // Heard and remembered first, as every message is.
  const talk = v.talks?.aveline || [];
  assert.ok(talk.some((r) => /ill/.test(r.you)), 'the words reached her');
});

test('a believable lie quiets her; a lie she can disprove makes it worse', () => {
  // Pure: the game's verdict from what she knows.
  const faint = { signs: ['hands', 'breath'], flames: [], toldBy: [], dark: null };
  assert.equal(decideVerdict(faint, 'A fever, I think. I have been ill.').verdict, 'believed');
  const clear = { signs: ['hands', 'flames', 'frost'], flames: [{ id: 'wys' }], toldBy: ['elda'], dark: null };
  assert.ok(evidenceOf(clear) >= 9);
  assert.equal(decideVerdict(clear, 'No. Nothing.').verdict, 'knows');
  assert.equal(decideVerdict({ signs: ['hands', 'flames'], flames: [], toldBy: [] }, 'I have been ill').verdict, 'doubted');
  const saw = { signs: ['hands'], flames: [], toldBy: [], dark: 'told', darkFrom: 'bram' };
  const caught = decideVerdict(saw, 'I never touched any wolf.');
  assert.equal(caught.verdict, 'knows');
  assert.equal(caught.caught, true);
  assert.equal(decideVerdict(faint, 'Yes. I take the life out of wolves.').verdict, 'knows');
  assert.equal(classify('No, I did not take any souls').kind, 'deny');
  // In the game: a believed lie lowers her suspicion and quiets her for days.
  const { sus } = setup({ keep: ['aveline'] });
  const av = sus.entity('aveline');
  const st = sus.st('aveline');
  st.s = 70;
  sus.apply(av, { verdict: 'believed' });
  assert.ok(st.s < 40);
  assert.ok(st.quietUntil > sus.now());
  sus.perceive(av, 'hands', { force: true });
  assert.ok(st.s < 40, 'quiet for a while: a sign weighs less');
  // A lie she can disprove: worse, and she knows.
  const st2 = sus.st('wenna');
  st2.s = 65;
  st2.dark = 'told';
  st2.darkFrom = 'bram';
  const wenna = sus.entity('wenna');
  const op = wenna.opinionOfPlayer;
  sus.apply(wenna, { verdict: 'knows', caught: true });
  assert.ok(st2.s > 65);
  assert.ok(wenna.opinionOfPlayer < op);
  assert.ok(op - wenna.opinionOfPlayer <= 12, 'wary, not hateful');
});

test('the truth about the beasts: she knows, is wary, asks you to stop, offers the rite; nobody turns hateful; no crime', async () => {
  const { g, unk, sus, cf } = setup({ keep: ['aveline'] });
  cf.take('beast', 10);
  cf.mark = 1.5;
  cf.settled = 1.5;
  const av = near(g, 'aveline', 1, 0);
  const op = av.opinionOfPlayer;
  sus.asking = { id: 'aveline', phase: 'open', t0: 0, openT: Math.round(sus.now()) };
  sus.st('aveline').signs = { hands: 1 };
  const reply = await g.village.playerSays(av, 'Yes. I take the life out of wolves. It makes me stronger.');
  const st = sus.st('aveline');
  assert.ok(['confessed', 'caught'].includes(st.dark));
  assert.equal(st.askedStop, sus.day());
  assert.equal(st.riteOffered, true);
  assert.match(reply.lines.join(' '), /Stop|stop/);
  assert.match(reply.lines.join(' '), /chapel flame/);
  assert.ok(op - av.opinionOfPlayer <= 6, 'opinion barely moves');
  assert.equal(g.player.crime ?? null, null);
  assert.match(unk.briefLine('aveline'), /Dangerous, not evil/);
  // The rite, at the chapel flame, your choice: the cold let out.
  const chapel = g.locations.get('chapel');
  put(g.player, chapel.center.x, chapel.center.y);
  put(av, g.player.x + 16, g.player.y);
  assert.ok(sus.atChapel(av));
  const r2 = await g.village.playerSays(av, 'Help me let it out. Please.');
  assert.equal(cf.bar, 0, 'the bar emptied');
  assert.ok(cf.mark < 1.5);
  assert.match(r2.lines.join(' '), /flame|warmer/);
});

test('a seen Unkindling of a PERSON is still murder: the line between dangerous and a killer holds', () => {
  const { g, unk, sus } = setup({ keep: ['bram', 'elda'] });
  const bram = near(g, 'bram', 1, 0);
  const elda = near(g, 'elda', -2, 0);
  elda.state = 'idle';
  // She already knew of the beasts (dangerous, not evil)…
  sus.learnDark(elda, 'saw', { beast: 'wolf' });
  unk.begin(bram);
  hold(g, unk);
  assert.ok(bram.dead);
  const rec = g.murder.dead.bram;
  assert.equal(rec.cause, 'unkindled');
  assert.ok((rec.seen || []).some((s) => s.id === 'elda'), 'she saw it (sight.js)');
  assert.equal(rec.seenSoul, true);
  assert.ok(unk.village.knows('elda'), 'a killer now, to her');
  assert.match(unk.briefLine('elda'), /killer/);
  assert.equal(unk.tally, 1);
});

test('stopping: the bar ebbs, the signs fade, suspicion falls, and the one who asked says you are warmer', () => {
  const { g, unk, sus, cf } = setup({ keep: ['aveline'] });
  cf.take('bandit', 15);
  cf.take('beast', 10);
  cf.take('beast', 10);
  cf.take('beast', 10);
  days(g, unk, 4);
  assert.ok(cf.tier() >= 2);
  const av = sus.entity('aveline');
  const st = sus.st('aveline');
  st.s = 70;
  sus.apply(av, { verdict: 'knows', kind: 'confess' });
  assert.equal(st.askedStop, sus.day());
  days(g, unk, 24, { step: 1 });
  assert.equal(cf.bar, 0);
  assert.equal(cf.tier(), 0, 'the signs are gone');
  assert.ok(st.s < 40, `suspicion fell (${st.s})`);
  near(g, 'aveline', 1, 0);
  av.state = 'idle';
  av.activity = 'idle';
  sus.barkAt = -Infinity;
  sus.remarks();
  assert.ok(g.said.some((s) => s.who === 'aveline' && /warmer|colour/i.test(s.text)), "You're warmer. Thank you.");
  assert.equal(st.warmerSaid, true);
});

test('going on after being asked: worry grows into fear, never a crime', () => {
  const { g, unk, sus, cf } = setup({ keep: ['aveline'] });
  cf.mark = 2;
  cf.settled = 2;
  const av = near(g, 'aveline', 1, 0);
  sus.apply(av, { verdict: 'knows', kind: 'confess' });
  const wolf = beast(g, 'wolf', 0, -1);
  put(av, px(141), px(101)); // she does not see this one
  unk.begin(wolf);
  hold(g, unk);
  assert.ok(wolf.dead);
  near(g, 'aveline', 1, 0);
  sus.perceive(av, 'hands', { force: true });
  assert.ok(sus.st('aveline').fear >= 20);
  assert.equal(g.player.crime ?? null, null);
  assert.match(unk.briefLine('aveline'), /afraid/);
});

test('saves: the bar, the mark, the prey, every person\'s suspicion come back; an asking in progress never does', () => {
  const { g, unk, sus, cf } = setup({ keep: ['aveline'] });
  cf.take('bandit', 15);
  cf.take('beast', 10);
  days(g, unk, 2);
  unk.prey.beast = 3;
  const av = sus.entity('aveline');
  sus.perceive(av, 'flames', { force: true });
  sus.learnDark(av, 'told', { beast: 'wolf', from: 'bram' });
  sus.asking = { id: 'aveline', phase: 'open', t0: 0 };
  const saved = JSON.parse(JSON.stringify(unk.serialize()));
  const g2 = makeGame({ hour: 12 });
  const u2 = installUnkindle(g2);
  u2.deserialize(saved);
  assert.equal(Math.round(u2.coldfire.bar), Math.round(cf.bar));
  assert.equal(u2.coldfire.mark, cf.mark);
  assert.equal(u2.coldfire.settled, Math.round(cf.settled * 100) / 100);
  assert.equal(u2.coldfire.shown, true);
  assert.equal(u2.prey.beast, 3);
  assert.equal(u2.suspicion.people.aveline.dark, 'told');
  assert.equal(u2.suspicion.people.aveline.signs.flames, 1);
  assert.equal(u2.suspicion.asking, null);
  // An older save (the first soul round's): its mark carries over, settled; no bar.
  const g3 = makeGame({ hour: 12 });
  const u3 = installUnkindle(g3);
  u3.deserialize({ v: 1, learned: true, tally: 1, deaths: [], attempts: [], mark: 3 });
  assert.equal(u3.coldfire.mark, 3);
  assert.equal(u3.coldfire.bar, 0);
  assert.equal(u3.signTier(), 2, 'three taken: the clear signs');
});

test('a boss shrugs it off unless you are much stronger; then its own defeat plays out', () => {
  const { g, unk, cf } = setup();
  let defeated = null;
  const boss = { type: 'actor', bossId: 'greyjaw', id: 'boss_greyjaw', x: g.player.x + 16, y: g.player.y, hp: 520, maxHp: 520, atk: 14, def: 2, lockTime: 0, rootTime: 0, knock: { x: 0, y: 0 }, isAlive: () => !defeated, beginDefeat(by) { defeated = by; } };
  assert.equal(unk.verdict(boss).kind, 'resists');
  // Much stronger (a hand far beyond it): taken.
  cf.bar = MAX;
  g.player.level = 60;
  g.player.maxHp = 900;
  g.player.hp = 900;
  const v = unk.verdict(boss);
  assert.notEqual(v.kind, 'resists', JSON.stringify(v));
  assert.ok(unk.begin(boss).ok);
  assert.equal(unk.channel.held, true);
  hold(g, unk, { max: 15 });
  assert.equal(defeated, g.player, 'its own defeat');
  assert.equal(unk.prey.boss, 1);
});

test('with a village that hears first (talk emits player_heard), the verdict is decided after the words reach her and before the wording', async () => {
  const { g, unk, sus } = setup({ keep: ['aveline'] });
  const av = near(g, 'aveline', 1, 0);
  sus.st('aveline').signs = { hands: 1, breath: 1 };
  sus.asking = { id: 'aveline', phase: 'open', t0: 0, openT: Math.round(sus.now()) };
  const order = [];
  const v = g.village;
  v._darkWrapped = false;
  v.playerSays = async (npc, text) => {
    order.push(`heard:${sus.asking?.verdict ? 'decided' : 'open'}`);
    g.bus.emit('player_heard', { npc, text, asleep: false });
    order.push(`worded:${/BELIEVE|DOUBT/.test(unk.briefLine('aveline')) ? 'with verdict' : 'without'}`);
    return { lines: ['(her own words)'], source: 'claude' };
  };
  sus.wrapTalk();
  sus._hearsFirst = true;
  const reply = await v.playerSays(av, 'A fever, I think. I have been ill.');
  assert.deepEqual(order, ['heard:open', 'worded:with verdict']);
  assert.equal(sus.st('aveline').asked?.verdict, 'believed');
  assert.deepEqual(reply.lines, ['(her own words)'], 'Claude worded it: the game only decided');
});
