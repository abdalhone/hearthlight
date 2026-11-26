import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, step, px, put, holdLyra, villagers, events } from './murder_world.mjs';
import { installUnkindle } from '../src/core/plugins/soul.js';
import { REACH, KNOW_AT, LINES } from '../src/magic/unkindle.js';
import { FEAR_TALK, FEAR_MOOT, hourPhrase, houseOf } from '../src/murder/unkindled.js';
import { hears, voiceOf, isSilenced, LOUD } from '../src/ai/hearing.js';
import { HOUR } from '../src/murder/data.js';
import { TILE } from '../src/core/constants.js';
import { knownAsKilling, knowsDeed } from './helpers/soul_contract.mjs';

// The Unkindling (round 14b, soul; DESIGN §37). The author: "that way I kill him with no
// sound, with nothing… even if they find him, they will be shocked how is he dead… if they
// see that there's multiple people that die the same way, and someone happened to see me,
// they will figure out".

const WOODS = { tx: 62, ty: 14 }; // deep in Whisperwood: nobody's day takes them there

function setup({ keep = [], hour = 12, learn = true } = {}) {
  const g = makeGame({ hour });
  const unk = installUnkindle(g);
  if (learn) unk.learn('test');
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
  return { g, unk, P: g.player };
}

function near(g, id, dx = 1, dy = 0) {
  const e = id === 'lyra' ? g.companion : g.entities.get(id);
  put(e, g.player.x + dx * TILE, g.player.y + dy * TILE);
  return e;
}

// Hold the spell, stepping the world, until it ends (or `until` says stop).
function hold(g, unk, { max = 12, dt = 1 / 20, until = null } = {}) {
  let t = 0;
  while (unk.channel && t < max) {
    unk.update(dt);
    step(g, dt, dt);
    unk.village?.update?.(dt);
    t += dt;
    if (until && until(unk.channel)) break;
  }
  return t;
}

function lifeText(g) {
  return (g.villageLife?.events || []).map((e) => e.text).join('\n');
}

test('learned only from the pact: pact_sealed carrying the gift teaches it; nothing else does', () => {
  const { g, unk } = setup({ learn: false });
  assert.equal(unk.available(), false);
  g.bus.emit('pact_sealed', { gifts: ['dark'] });
  assert.equal(unk.learned, false, 'a pact without the gift');
  g.bus.emit('pact_sealed', { gifts: ['dark', 'bloodprice', 'unkindle'], pact: 'before' });
  assert.equal(unk.learned, true);
  assert.equal(unk.learnedFrom, 'pact');
  assert.ok(events(g, 'unkindle_learned').length === 1);
});

test('no sound, with nothing: held and silent, nobody hears a thing a tile away behind nothing', () => {
  const { g, unk } = setup({ keep: ['bram', 'elda'] });
  const bram = near(g, 'bram', 1, 0);
  // Elda a tile from him, asleep: no eyes, but ears (a third of a scream's reach, more than a tile).
  const elda = near(g, 'elda', 2, 0);
  elda.state = 'sleep';
  assert.ok(hears(g, elda, bram.x, bram.y, LOUD.scream), 'she would hear a scream from there');
  const r = unk.begin(bram);
  assert.ok(r.ok, JSON.stringify(r));
  const before = g.events.length;
  hold(g, unk, { until: (ch) => ch.k > 0.5 });
  assert.ok(isSilenced(g, bram), 'held silent');
  assert.equal(hears(g, elda, bram.x, bram.y, voiceOf(g, bram, LOUD.scream)), null, 'loudness 0 through the hearing rule');
  // Even a blow on him while held makes no sound.
  g.combat.damage(g.player, bram, 1, { exact: true, crit: false });
  hold(g, unk);
  assert.ok(bram.dead, 'his flame is out');
  const rec = g.murder.dead.bram;
  assert.equal(rec.cause, 'unkindled');
  assert.equal(rec.silent, true);
  assert.equal(rec.unmarked, true);
  assert.equal(rec.by, 'player');
  assert.deepEqual(rec.seen, [], 'nobody saw it');
  const after = g.events.slice(before).map((e) => e.type);
  assert.ok(!after.includes('call_for_help'), 'no call for help');
  assert.ok(!g.said.some((s) => s.who === 'bram'), 'not a word from him');
  assert.equal(elda.state, 'sleep', 'she sleeps on');
  assert.equal(elda.uneasy ?? null, null, 'and heard nothing at all');
  assert.equal(unk.tally, 1);
  // The spell's own sound is the player's alone: no sound event goes into the world.
  assert.ok(!after.includes('noise') && !after.includes('sound'));
  assert.equal(g.player.crime ?? null, null, 'no crime anyone knows of');
});

test('never a child (isMinor): Pip and Tansy are refused, "No. Not a child."; Tansy at sixteen is a grown soul', () => {
  const { g, unk } = setup({ keep: ['pip', 'tansy'] });
  const pip = near(g, 'pip', 1, 0);
  assert.equal(unk.check(pip)?.reason, 'child');
  const r = unk.begin(pip);
  assert.equal(r.ok, false);
  assert.equal(r.line, LINES.child);
  assert.equal(unk.channel, null);
  assert.equal(r.line, 'No. Not a child.');
  // In reach: the spell finds no target, only the refusal.
  const tr = unk.targetInReach();
  assert.equal(tr.target, null);
  assert.equal(tr.refusal?.reason, 'child');
  put(pip, px(141), px(101));
  const tansy = near(g, 'tansy', 1, 0);
  assert.equal(unk.check(tansy)?.reason, 'child', 'fifteen: a child');
  assert.equal(unk.begin(tansy).ok, false);
  assert.ok(!tansy.dead && !pip.dead);
  // Sixteen by the calendar: an adult to every system, this one too.
  g.calendar = { ...(g.calendar || {}), ageOf: (id) => (id === 'tansy' ? 16 : null) };
  assert.equal(unk.check(tansy), null);
});

test('never the player, never through a wall, never out of touch', () => {
  const { g, unk } = setup({ keep: ['bram'] });
  assert.equal(unk.check(g.player)?.reason, 'self');
  const bram = g.entities.get('bram');
  // A wall tile between them, both hugging it: in touch, but not through it.
  const ty = WOODS.ty;
  g.player.x = (WOODS.tx + 1) * TILE - 1;
  g.player.y = px(ty);
  put(bram, (WOODS.tx + 2) * TILE + 1, px(ty));
  const orig = g.map.blocksProjectile.bind(g.map);
  g.map.blocksProjectile = (tx, y) => (tx === WOODS.tx + 1 && y === ty) || orig(tx, y);
  assert.ok(Math.hypot(bram.x - g.player.x, bram.y - g.player.y) <= REACH);
  assert.equal(unk.check(bram)?.reason, 'wall');
  assert.equal(unk.begin(bram).ok, false);
  g.map.blocksProjectile = orig;
  put(bram, g.player.x + REACH + 12, g.player.y);
  assert.equal(unk.check(bram)?.reason, 'far');
});

test('the undead have nothing to take; beasts are not this spell\'s (yet)', () => {
  const { unk } = setup();
  assert.equal(unk.check({ type: 'actor', kind: 'undead', species: 'skeleton', x: 0, y: 0 })?.line, 'Nothing in there to take.');
  assert.equal(unk.check({ type: 'actor', kind: 'animal', species: 'wolf', x: 0, y: 0 })?.reason, 'beast');
});

test('strength: a much stronger soul breaks free, KNOWS, and fights (the huntress)', () => {
  const { g, unk, P } = setup({ keep: ['hess'] });
  const hess = near(g, 'hess', 1, 0);
  P.hp = Math.round(P.maxHp * 0.3); // weak
  const v = unk.verdict(hess);
  assert.equal(v.kind, 'resists', JSON.stringify(v));
  const op0 = hess.opinionOfPlayer;
  assert.ok(unk.begin(hess).ok);
  hold(g, unk);
  assert.ok(!hess.dead, 'she broke free');
  assert.equal(isSilenced(g, hess), false, 'and has her voice back');
  const a = unk.attempts.at(-1);
  assert.equal(a.id, 'hess');
  assert.equal(a.outcome, 'resisted');
  assert.equal(a.knows, true);
  assert.ok(unk.village.knows('hess'), 'she knows what you tried');
  assert.equal(hess.mode, 'fight');
  assert.equal(hess.fightTarget, P);
  assert.ok(hess.opinionOfPlayer <= Math.max(0, op0 - 40), String(hess.opinionOfPlayer));
  const r = g.village.rumors.list.find((x) => x.kind === 'unkindle_attempt' && x.victim === 'hess');
  assert.ok(r && r.heardBy.includes('hess'), 'her account, to be carried by meeting');
  assert.match(unk.briefLine('hess'), /broke free/);
  assert.equal(g.murder.dead.hess, undefined);
  assert.ok(events(g, 'unkindle_resisted').some((p) => p.id === 'hess'), 'the tempter may be amused');
});

test('close in strength: a longer, harder pull than an easy one', () => {
  const { g, unk } = setup({ keep: ['wys', 'elda'] });
  const wys = g.entities.get('wys');
  const elda = g.entities.get('elda');
  const vw = unk.verdict(wys);
  const ve = unk.verdict(elda);
  assert.equal(vw.kind, 'close', JSON.stringify(vw));
  assert.equal(ve.kind, 'easy', JSON.stringify(ve));
  assert.ok(vw.dur > ve.dur);
  // Asleep, the watchman holds on less.
  wys.state = 'sleep';
  assert.ok(unk.strengthOf(wys) < unk.strengthOf(elda) * 2);
  // Bosses and the tempter: never.
  assert.equal(unk.verdict({ type: 'actor', bossId: 'varek', x: 0, y: 0 }).kind, 'resists');
});

test('a broken hold: hit mid-pull, it slips back; past KNOW_AT they felt it and know, before it only a chill', () => {
  {
    const { g, unk } = setup({ keep: ['bram'] });
    const bram = near(g, 'bram', 1, 0);
    unk.begin(bram);
    hold(g, unk, { until: (ch) => ch.k > KNOW_AT + 0.1 });
    g.bus.emit('damage', { source: null, target: g.player, amount: 3 });
    assert.equal(unk.channel.outcome, 'broken');
    hold(g, unk);
    assert.ok(!bram.dead);
    assert.equal(unk.attempts.at(-1).knows, true);
    assert.ok(unk.village.knows('bram'));
    assert.ok(['flee', 'fight'].includes(bram.mode), bram.mode);
  }
  {
    const { g, unk } = setup({ keep: ['bram'] });
    const bram = near(g, 'bram', 1, 0);
    unk.begin(bram);
    unk.update(0.05);
    unk.release('let_go');
    hold(g, unk);
    assert.ok(!bram.dead);
    assert.equal(unk.attempts.at(-1).knows, false);
    assert.equal(unk.village.knows('bram'), false, 'a chill, nothing more');
  }
});

test('the death that "nobody did": found unseen it is a mystery, with no suspect, no case, no alarm; Mira and Aveline', () => {
  const { g, unk } = setup({ keep: ['bram', 'hess', 'mira', 'aveline'] });
  const bram = near(g, 'bram', 1, 0);
  unk.begin(bram);
  hold(g, unk);
  assert.ok(bram.dead);
  const rec = g.murder.dead.bram;
  assert.ok(rec.flame && rec.flame.house === 'the Ironhand flame', JSON.stringify(rec.flame));
  // Hess comes on him.
  g.toasts.length = 0;
  g.murder.found('bram', 'hess', rec.place);
  assert.equal(rec.mystery, true);
  assert.equal(g.murder.cases.bram, undefined, 'no case: nothing points at anyone');
  assert.equal(g.murder.isWanted(), false);
  assert.equal(g.player.crime ?? null, null);
  const toast = g.toasts.map((t) => t.text).join(' | ');
  assert.match(toast, /No mark/);
  assert.doesNotMatch(toast, /blade/i);
  assert.ok(g.said.some((s) => s.who === 'hess' && /mark|cold/i.test(s.text)), 'the finder, shocked');
  assert.match(lifeText(g), /cold as stone/);
  // Grief and a funeral all the same (the body found).
  assert.ok(events(g, 'body_found').some((p) => p.id === 'bram' && p.owned));
  // Mira looks him over within the hour.
  g.clock.t += MIRA_HOURS() * HOUR + 2;
  unk.village.tick();
  assert.match(lifeText(g), /hollow wind took him, but there's been no wind/);
  // Aveline, at the altar: the household's flame guttered at the hour he went.
  const av = g.entities.get('aveline');
  const ch = g.locations.get('chapel');
  put(av, ch.center.x, ch.center.y);
  av.state = 'idle';
  unk.village.tick();
  assert.equal(rec.flame.known, true);
  assert.match(lifeText(g), /Ironhand flame/);
  assert.ok(rec.flame.said, 'and says it, the body found');
  // Not a killing to anyone yet: the tempter and the village's reckoning do not count it.
  assert.equal(knownAsKilling(g.murder, rec), false);
});

function MIRA_HOURS() {
  return 0.3;
}

test('the pattern: two found with no mark and the village talks of the Hollow; three and the Moot is afraid', () => {
  const { g, unk } = setup({ keep: ['garrick', 'corran', 'sabeth', 'elda', 'bram', 'rowan'] });
  const kill = (id) => {
    const e = g.entities.get(id);
    const rec = g.murder.kill(e, { cause: 'unkindled', silent: true, unmarked: true });
    assert.ok(rec, id);
    g.murder.found(id, 'elda', rec.place);
    rec.newsAt = null; // the hour has passed: everyone has the news
    return rec;
  };
  kill('garrick');
  unk.village.tick();
  assert.equal(unk.village.fearLevel(), 1);
  assert.match(unk.briefLine('elda'), /no mark/);
  assert.doesNotMatch(unk.briefLine('elda'), /Hollow/);
  const bram = g.entities.get('bram');
  assert.equal(unk.village.entryFor(bram, { activity: 'socialize', at: 'ember_kettle' }, 22), null, 'one death: life as usual');
  kill('corran');
  unk.village.tick();
  assert.equal(unk.village.fearLevel(), FEAR_TALK);
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'hollow'), 'the Hollow, by meeting');
  assert.match(unk.briefLine('elda'), /Hollow/);
  assert.doesNotMatch(unk.briefLine('elda'), /stranger|souls?/i, 'they know deaths, not who');
  // Doors barred after dark: the grown keep home; the watch walks the night.
  assert.deepEqual(unk.village.entryFor(bram, { activity: 'socialize', at: 'ember_kettle' }, 22), { activity: 'rest', at: 'smithy', vl: 'hollow-home', doing: 'home behind a barred door' });
  assert.equal(unk.village.entryFor(bram, { activity: 'socialize', at: 'ember_kettle' }, 13), null, 'by day, as usual');
  assert.equal(unk.village.entryFor(g.entities.get('rowan'), { activity: 'sleep', at: 'guardhouse' }, 22)?.doing, 'walking the night watch');
  kill('sabeth');
  unk.village.tick();
  assert.equal(unk.village.fearLevel(), FEAR_MOOT);
  assert.match(unk.briefLine('elda'), /Moot is frightened/);
  assert.match(lifeText(g), /Moot met/);
  assert.ok(unk.briefLine('elda').length <= 220);
});

test('seen once: the witness saw the soul pulled out; by meeting, every earlier death is linked, and the cases reopen', () => {
  const { g, unk } = setup({ keep: ['garrick', 'corran', 'wys', 'elda', 'bram', 'rowan'] });
  // Two earlier, unseen, found: mysteries.
  for (const id of ['garrick', 'corran']) {
    const rec = g.murder.kill(g.entities.get(id), { cause: 'unkindled', silent: true, unmarked: true });
    g.murder.found(id, 'rowan', rec.place);
    rec.newsAt = null;
  }
  assert.equal(g.murder.cases.garrick, undefined);
  // The third, in front of Elda (by day, close: the sight rule).
  const wys = near(g, 'wys', 1, 0);
  wys.state = 'sleep';
  const elda = near(g, 'elda', 0, 3);
  elda.state = 'idle';
  assert.ok(unk.begin(wys).ok);
  hold(g, unk);
  const rec3 = g.murder.dead.wys;
  assert.ok(rec3.seen.some((s) => s.id === 'elda'), 'she saw it (sight.js / witness.js)');
  assert.equal(rec3.seenSoul, true);
  assert.ok(g.said.some((s) => s.who === 'elda' && /out of|life|light/i.test(s.text)), 'the soul pulled out, in her words');
  assert.ok(unk.village.knows('elda'));
  const g1 = g.murder.dead.garrick;
  assert.equal(g1.linked, true, 'that is how the others died');
  assert.ok(g1.knownBy.includes('elda'));
  assert.ok(events(g, 'killing_known').some((p) => p.id === 'garrick'));
  assert.ok(events(g, 'killing_known').some((p) => p.id === 'corran'));
  assert.equal(knownAsKilling(g.murder, g1), true);
  assert.equal(knowsDeed(g.murder, g1, 'elda'), true);
  // Bram did not see it and has not met her: he does not know.
  assert.equal(unk.village.knows('bram'), false);
  assert.equal(knowsDeed(g.murder, g1, 'bram'), false);
  assert.doesNotMatch(unk.briefLine('bram'), /stranger tears|bare hand/);
  // Her account reaches him face to face.
  const r = g.village.rumors.get(rec3.soulRumor);
  assert.ok(r, 'her account is news');
  g.village.rumors.hear(r, 'bram', 'elda', g.rng);
  unk.village.tick();
  assert.ok(unk.village.knows('bram'));
  assert.ok(g1.knownBy.includes('bram'));
  assert.match(unk.briefLine('bram'), /bare hand/);
  assert.match(unk.briefLine('bram'), /Garrick/);
  // The case reopens with every count: a found mystery is a murder case now.
  const c = g.murder.cases.garrick;
  assert.ok(c, 'the case reopens');
  assert.ok(c.evidence.some((e) => e.kind === 'linked'));
  assert.ok(c.suspicion >= 0.6, String(c.suspicion));
});

test('Lyra, seeing it, reacts with horror in her own words and keeps it', () => {
  const { g, unk } = setup({ keep: ['bram', 'lyra'] });
  const L = g.companion;
  const bram = near(g, 'bram', 1, 0);
  put(L, g.player.x, g.player.y + 2 * TILE);
  unk.begin(bram);
  hold(g, unk);
  assert.ok(g.murder.dead.bram.seen.some((s) => s.id === 'lyra'));
  const mem = JSON.stringify(L.mind?.memory?.all?.() || L.mind?.memories || []);
  assert.match(mem, /draw something out|not a mark/);
  assert.ok(unk.village.knows('lyra'));
});

test('practice: "Try all magic" lends it for straw only; the dummy gives up nothing and nobody dies', () => {
  const { g, unk } = setup({ keep: ['bram'], learn: false });
  g.magic = { ...(g.magic || {}), trial: { unlocked: {} } };
  assert.equal(unk.available(), true);
  const bram = near(g, 'bram', 1, 0);
  assert.equal(unk.check(bram)?.reason, 'dummy');
  assert.equal(unk.begin(bram).ok, false);
  const dummy = { objType: 'dummy', x: g.player.x + 14, y: g.player.y, removed: false };
  assert.equal(unk.check(dummy), null);
  assert.ok(unk.begin(dummy).ok);
  hold(g, unk);
  assert.equal(unk.tally, 0);
  assert.ok(!bram.dead);
  assert.equal(Object.keys(g.murder.dead).length, 0);
});

test('what they perceive: a brief never says what they cannot know; the cold shows to one beside you', () => {
  const { g, unk } = setup({ keep: ['bram', 'elda'] });
  assert.equal(unk.briefLine('elda'), '');
  assert.equal(unk.briefLine('player'), '');
  unk.mark = 2; // a soul or two taken: the faint signs
  const elda = near(g, 'elda', 1, 0);
  elda.state = 'idle';
  assert.match(unk.briefLine('elda'), /cold/);
  assert.doesNotMatch(unk.briefLine('elda'), /soul|kill/i);
  put(elda, g.player.x + 6 * TILE, g.player.y);
  assert.equal(unk.briefLine('elda'), '', 'not from across the clearing');
});

test('saves: the gift, the tally, the deaths, the attempts and who knows come back; a hold never does', () => {
  const { g, unk } = setup({ keep: ['bram', 'elda', 'hess'] });
  const bram = near(g, 'bram', 1, 0);
  const elda = near(g, 'elda', 0, 3);
  elda.state = 'idle';
  unk.begin(bram);
  hold(g, unk);
  assert.ok(bram.dead);
  unk.mark = 3;
  const hess = near(g, 'hess', 1, 0);
  unk.begin(hess);
  unk.update(0.05);
  const saved = JSON.parse(JSON.stringify({ unk: unk.serialize(), murder: g.murder.serialize() }));
  const g2 = makeGame({ hour: 12 });
  const u2 = installUnkindle(g2);
  g2.murder.deserialize(saved.murder);
  u2.deserialize(saved.unk);
  assert.equal(u2.learned, true);
  assert.equal(u2.tally, 1);
  assert.equal(u2.deaths[0].id, 'bram');
  assert.equal(u2.mark, 3);
  assert.equal(u2.channel, null);
  assert.ok(u2.village.knows('elda'));
  assert.equal(g2.murder.dead.bram.cause, 'unkindled');
  assert.equal(g2.murder.dead.bram.seenSoul, true);
  assert.equal(g2.murder.dead.bram.flame.house, 'the Ironhand flame');
  // The old save: nothing of it, nothing learned.
  const g3 = makeGame({ hour: 12 });
  const u3 = installUnkindle(g3);
  u3.deserialize(undefined);
  assert.equal(u3.learned, false);
  assert.equal(u3.tally, 0);
});

test('the words: hours and households', () => {
  assert.equal(hourPhrase(23.9), 'just before midnight');
  assert.equal(hourPhrase(23.4), 'a little after eleven at night');
  assert.equal(hourPhrase(3.1), 'at three in the small hours');
  assert.equal(houseOf({ name: 'Bram Ironhand' }), 'the Ironhand flame');
  assert.equal(houseOf({ name: 'Sister Aveline' }), "Aveline's flame");
  assert.equal(houseOf({ name: 'Captain Rowan Vale' }), 'the Vale flame');
  assert.equal(houseOf({ name: 'Garrick "Gale" Hale' }), 'the Hale flame');
  assert.equal(houseOf({ name: 'Pip' }), "Pip's flame");
});

test('a boss or the tempter is never held: it shrugs the spell off at once (no stun to chain)', () => {
  const { g, unk } = setup();
  const boss = { type: 'actor', bossId: 'varek', id: 'boss_varek', x: g.player.x + 16, y: g.player.y, hp: 400, maxHp: 400, lockTime: 0, rootTime: 0, knock: { x: 0, y: 0 }, isAlive: () => true };
  const r = unk.begin(boss);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(unk.channel.held, false);
  hold(g, unk, { max: 3 });
  assert.equal(unk.channel, null);
  assert.equal(unk.attempts.at(-1)?.outcome, 'resisted');
  assert.equal(boss.lockTime, 0, 'never frozen');
  assert.equal(isSilenced(g, boss), false);
});

test('a bandit or a beast is not this spell\'s; the words say so', () => {
  const { unk } = setup();
  assert.equal(unk.check({ type: 'actor', kind: 'human', species: 'bandit', x: 0, y: 0 })?.reason, 'bandit');
  assert.equal(unk.check({ type: 'actor', kind: 'animal', species: 'boar', x: 0, y: 0 })?.line, 'It has no flame you can hold.');
});

test('the dark hand sits clear of every piece of the touch cluster, both ways up, mirrored too, at least 44 px', async () => {
  const { clusterLayout } = await import('../src/ui/touch.js');
  const { handSpot } = await import('../src/ui/unkindle_view.js');
  const GEO = {
    landscape: { sword: 78, btn: 56, dodge: 54, use: 52, r1: 96, r2: 162, edge: 14 },
    portrait: { sword: 70, btn: 52, dodge: 50, use: 48, r1: 86, r2: 146, edge: 12 },
  };
  for (const mode of ['landscape', 'portrait']) {
    for (const [mirror, k] of [[false, 1], [true, 1], [false, 0.8], [false, 1.25], [true, 1.25 * 0.94]]) {
      const geo = Object.fromEntries(Object.entries(GEO[mode]).map(([key, v]) => [key, key === 'edge' ? v : Math.round(v * k)]));
      const me = handSpot(geo, mode, mirror);
      assert.ok(me.size >= 44);
      for (let n = 0; n <= 6; n++) {
        const L = clusterLayout(n, geo, mirror);
        const pieces = [
          { x: 0, y: 0, size: geo.sword },
          { ...L.dodge, size: geo.dodge },
          { ...L.use, size: geo.use },
          ...L.slots.map((p) => ({ ...p, size: geo.btn })),
        ];
        for (const p of pieces) {
          const gapX = Math.abs(p.x - me.x) - (p.size + me.size) / 2;
          const gapY = Math.abs(p.y - me.y) - (p.size + me.size) / 2;
          assert.ok(gapX > 0 || gapY > 0, `${mode}${mirror ? ' mirrored' : ''} x${k}, ${n} weaves: clear of the piece at ${Math.round(p.x)},${Math.round(p.y)}`);
        }
      }
    }
  }
});
