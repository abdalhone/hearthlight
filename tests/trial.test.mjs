import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put, villagers, events } from './society_world.mjs';
import { parseDefence, checkClaim, checkDefence } from '../src/murder/defence.js';
import { jurorsOf, jurorBrief, localJuror, deliberate, tally, MAX_JURORS } from '../src/murder/jury.js';
import { trial, weighDefence } from '../src/murder/grief.js';
import { HOUR } from '../src/murder/data.js';

// The trial (round 14b, S-11; D12; DESIGN §36.5): a defence in the stranger's own words,
// one Claude call per juror with only their own brief, lies caught only by those who know,
// the verdict emerging from the votes, saved mid-deliberation.

function still(g) {
  for (const v of villagers(g)) v.think = () => {};
}

// Bram killed in the deep woods by the stranger, nobody watching; Elda saw the stranger by
// the woods' edge a little before (a sighting only she has).
function scene({ provoked = false, eldaSaw = true } = {}) {
  const g = makeGame({ hour: 14 });
  still(g);
  for (const v of villagers(g)) put(v, px(140), px(100));
  const bram = g.entities.get('bram');
  put(bram, px(62), px(14));
  put(g.player, px(63), px(14));
  const rec = g.murder.kill(bram);
  rec.provoked = provoked;
  rec.place = 'whisperwood';
  rec.snap.player = eldaSaw ? [{ by: 'elda', t: rec.t - HOUR / 2, place: 'whisperwood' }] : [];
  g.murder.found('bram', 'hess', 'whisperwood');
  const c = g.murder.cases.bram || g.murder.openCase('bram');
  return { g, rec, c };
}

test('the defence is read as claims: self-defence, an alibi with its place, blame, a confession, mercy', () => {
  const k = (t) => parseDefence(t, null, 'bram').map((c) => c.kind);
  assert.ok(k('He attacked me first with his hammer, I had no choice').includes('self_defence'));
  const al = parseDefence('I was at the lake all evening.', null, 'bram');
  assert.equal(al[0].kind, 'alibi');
  assert.equal(al[0].place, 'mirror_lake');
  const bl = parseDefence('It was Hess. Ask her.', null, 'bram');
  assert.ok(bl.some((c) => c.kind === 'blame' && c.who === 'hess'));
  assert.ok(k('I did it. I am sorry.').includes('confess'));
  assert.ok(k('I did it. I am sorry.').includes('mercy'));
  assert.ok(!k('It was not me, I did not do it').includes('confess'));
  assert.ok(k('It was not me').includes('deny'));
  assert.equal(parseDefence('I was somewhere else entirely.', null, 'bram')[0].place, null);
});

test('self-defence is true or false by the record; an unknown place cannot be a lie', () => {
  const a = scene({ provoked: true });
  const sd = checkClaim(a.g.murder, a.rec, { id: 's1', kind: 'self_defence' });
  assert.equal(sd.lie, false);
  assert.equal(sd.supports, true);
  const b = scene({ provoked: false });
  assert.equal(checkClaim(b.g.murder, b.rec, { id: 's1', kind: 'self_defence' }).lie, true);
  b.rec.provoked = null;
  assert.equal(checkClaim(b.g.murder, b.rec, { id: 's1', kind: 'self_defence' }).lie, null, 'an old record: unknown');
  assert.equal(checkClaim(b.g.murder, b.rec, { id: 'a1', kind: 'alibi', place: null }).lie, null, 'unverifiable');
});

test('a false alibi is caught only by the juror who saw the stranger elsewhere; no juror is told another\'s sighting', () => {
  const { g, rec, c } = scene();
  // The watch never heard of Elda's sighting: only her own eyes hold it.
  c.evidence = [];
  const claims = parseDefence('I was at the lake.', g.murder, 'bram');
  const checked = checkDefence(g.murder, rec, claims);
  assert.equal(checked[0].lie, true);
  assert.deepEqual(checked[0].knownBy, ['elda']);
  const jurors = jurorsOf(g.murder, 'bram');
  assert.ok(jurors.includes('elda') && jurors.length <= MAX_JURORS && !jurors.includes('bram'));
  const eb = jurorBrief(g.murder, 'elda', 'bram', checked, 'I was at the lake.');
  assert.match(eb.text, /Claims YOU know are false: alibi1/);
  assert.deepEqual(eb.knows, ['alibi1']);
  for (const id of jurors.filter((x) => x !== 'elda')) {
    const b = jurorBrief(g.murder, id, 'bram', checked, 'I was at the lake.');
    assert.ok(!/Claims YOU know/.test(b.text), `${id} cannot catch it`);
    assert.ok(!/elda/i.test(b.text.replace(/Elda Thornbury/, '')) || id === 'elda', `${id}'s brief holds nothing of Elda's eyes`);
    assert.deepEqual(b.knows, []);
  }
  // A caught claim from a juror who could not know is dropped.
  const local = localJuror(g.murder, 'garrick', 'bram', checked, 'I was at the lake.');
  assert.deepEqual(local.caught, []);
  // Once the watch has said her sighting aloud to the Moot, everyone in the room knows it.
  const room = jurorsOf(g.murder, 'bram');
  const told = checkDefence(g.murder, rec, claims, { room, spokenBy: ['elda'] });
  assert.deepEqual([...told[0].knownBy].sort(), [...room].sort());
});

test('the local jury is deterministic: an eyewitness and a caught lie convict; a fond Moot with weak evidence does not', () => {
  const { g, rec, c } = scene();
  rec.seen = [{ id: 'elda', clarity: 'clear' }];
  rec.known = 'witnessed';
  g.murder.weigh('bram');
  const checked = checkDefence(g.murder, rec, parseDefence('I was at the lake.', g.murder, 'bram'));
  const v1 = localJuror(g.murder, 'elda', 'bram', checked, 'I was at the lake.');
  const v2 = localJuror(g.murder, 'elda', 'bram', checked, 'I was at the lake.');
  assert.deepEqual(v1, v2, 'the same every time');
  assert.equal(v1.vote, 'guilty');
  assert.deepEqual(v1.caught, ['alibi1']);
  // Weak evidence, a fond Moot.
  const w = scene({ eldaSaw: false });
  for (const v of villagers(w.g)) v.opinionOfPlayer = 85;
  w.c.suspicion = 0.2;
  w.g.murder.weigh = () => 0.2;
  w.c.suspicion = 0.2;
  const ch = checkDefence(w.g.murder, w.rec, parseDefence('It was not me. I would never hurt him.', w.g.murder, 'bram'));
  const votes = jurorsOf(w.g.murder, 'bram').map((id) => localJuror(w.g.murder, id, 'bram', ch, 'It was not me.'));
  const t = tally(votes, jurorsOf(w.g.murder, 'bram')[0]);
  assert.ok(t.outcome === 'not_proven' || t.outcome === 'mercy', JSON.stringify(t));
  void c;
});

function fakeProvider({ hang = [], says = () => ({ vote: 'not_proven', belief: 0.3, reason: 'I did not see it.', caught: [] }) } = {}) {
  const calls = [];
  return {
    calls,
    complete({ task }) {
      const who = /You are ([A-Z][a-z]+)/.exec(task)?.[1]?.toLowerCase();
      calls.push(who);
      if (hang.includes(who)) return new Promise(() => {});
      return Promise.resolve(says(who, task));
    },
  };
}

test('one call per living juror (at most 7), in parallel; a juror who runs out of time weighs it alone; a stolen catch is dropped', async () => {
  const { g } = scene();
  const jurors = jurorsOf(g.murder, 'bram');
  const prov = fakeProvider({ hang: ['alder'], says: (who) => ({ vote: 'guilty', belief: 0.9, reason: `${who} thinks so.`, caught: ['alibi1'] }) });
  const checked = checkDefence(g.murder, g.murder.dead.bram, parseDefence('I was at the lake.', g.murder, 'bram'));
  const seen = [];
  const votes = await deliberate(g.murder, 'bram', { defence: 'I was at the lake.', checked, provider: prov, budgetMs: 80, onVote: (v) => seen.push(v.id) });
  assert.equal(prov.calls.length, jurors.length, 'one call each');
  assert.ok(prov.calls.length <= 7);
  assert.equal(new Set(prov.calls).size, prov.calls.length, 'nobody twice');
  const alder = votes.find((v) => v.id === 'alder');
  assert.equal(alder.source, 'local', 'the one who ran out of time weighed it alone');
  assert.equal(votes.filter((v) => v.source === 'claude').length, jurors.length - 1);
  for (const v of votes) if (v.source === 'claude' && v.id !== 'elda') assert.deepEqual(v.caught, [], `${v.id} could not have caught it`);
  assert.deepEqual(votes.find((v) => v.id === 'elda').caught, ['alibi1']);
  assert.equal(seen.length, jurors.length, 'every face filled in');
});

test('the verdict emerges: the majority, the chair on a tie, mercy lightens it; a caught lie is news; the votes reach Lyra and the save', async () => {
  const { g, rec } = scene();
  rec.seen = [{ id: 'elda', clarity: 'clear' }];
  const prov = fakeProvider({ says: (who) => (who === 'elda' ? { vote: 'guilty', belief: 0.95, reason: 'I saw you there.', caught: ['alibi1'] } : { vote: 'mercy', belief: 0.7, reason: 'Bram had a temper.', caught: [] }) });
  await trial(g.murder, 'bram', { defence: 'I was at the lake.', provider: prov });
  const c = g.murder.cases.bram;
  assert.equal(c.verdict, 'guilty');
  assert.equal(c.trial.sentence, 'mercy', 'more mercy than guilty: the lighter sentence');
  assert.equal(c.trial.votes.length, jurorsOf(g.murder, 'bram').length);
  assert.ok(c.trial.claims[0].caught && c.trial.claims[0].caughtBy.includes('elda'));
  assert.ok(rec.answers.some((a) => a.kind === 'lie_caught'));
  assert.ok(g.village.rumors.list.some((r) => r.kind === 'lied_about' && r.heardBy.includes('elda')));
  const ev = events(g, 'moot_verdict').at(-1);
  assert.equal(ev.mercy, true);
  assert.ok(ev.votes.length >= 3);
  assert.ok(g.murder.outside?.mercy, 'one day outside');
  assert.equal(tally([{ id: 'a', vote: 'guilty' }, { id: 'b', vote: 'not_proven' }], 'a').found, true, 'the chair breaks the tie');
  assert.equal(tally([{ id: 'a', vote: 'guilty' }, { id: 'b', vote: 'not_proven' }], 'b').found, false);
});

test('saved while the Moot weighs it: a reload re-runs it without the defence asked again and without Claude asked again', async () => {
  const { g } = scene();
  const prov = fakeProvider({ hang: ['alder', 'elda', 'bram', 'rowan', 'mira', 'tobias', 'aveline'].slice(0, 3) });
  const p = weighDefence(g.murder, 'bram', 'I was at the lake.', { provider: prov });
  await new Promise((r) => setTimeout(r, 20));
  const c = g.murder.cases.bram;
  assert.equal(c.trial.state, 'deliberating');
  assert.ok(g.murder.trialPending?.deliberating);
  const inBefore = c.trial.votes.length;
  assert.ok(inBefore >= 1, 'some answers are in');
  const saved = JSON.parse(JSON.stringify(g.murder.serialize()));
  void p;
  // A new page: the same world, the save applied.
  const g2 = makeGame({ hour: 14 });
  still(g2);
  g2.murder.deserialize(saved);
  const prov2 = fakeProvider();
  g2.village.provider = () => prov2;
  assert.equal(g2.murder.cases.bram.trial.state, 'deliberating');
  await trial(g2.murder, 'bram');
  assert.equal(prov2.calls.length, 0, 'Claude is not asked again');
  const c2 = g2.murder.cases.bram;
  assert.ok(c2.verdict, 'a verdict');
  assert.equal(c2.trial.defence, 'I was at the lake.', 'the same words');
  assert.ok(c2.trial.votes.filter((v) => v.source === 'claude').length === inBefore, 'the votes already in are kept');
  assert.equal(g2.murder.trialPending, null);
});

// Verify-b (round 14b): what an eyewitness at the Moot says aloud is said to the room, for
// the defence as well as against it. Bram struck first and Elda saw it; the watch read her
// account to the Moot. Before this, only Elda "knew" the self-defence was true, so the rest
// voted as if nobody had told them, and Rowan's brief said "you saw" of a sighting not his.
test('a true self-defence an eyewitness bears out before the Moot is heard by the room; nobody is told they saw what they did not', () => {
  const { g, rec, c } = scene({ provoked: true, eldaSaw: false });
  rec.seen = [{ id: 'elda', clarity: 'clear' }];
  rec.known = 'witnessed';
  c.evidence = [{ kind: 'witness', w: 0.9, by: 'elda', text: 'Elda saw the stranger kill Bram.' }];
  c.suspicion = 0.85;
  const room = jurorsOf(g.murder, 'bram');
  assert.ok(room.includes('elda') && room.includes('rowan'));
  const words = 'He struck me first with his hammer. I had no choice.';
  const checked = checkDefence(g.murder, rec, parseDefence(words, g.murder, 'bram'), { room, spokenBy: ['elda'] });
  const sd = checked.find((x) => x.kind === 'self_defence');
  assert.equal(sd.supports, true);
  assert.equal(sd.public, true, 'Elda said it aloud to the room');
  assert.deepEqual([...sd.knownBy].sort(), [...room].sort());
  // Rowan did not see it: his brief names who did; Elda's says she saw it.
  const rb = jurorBrief(g.murder, 'rowan', 'bram', checked, words).text;
  assert.match(rb, /bears out/);
  assert.match(rb, /Elda/);
  assert.ok(!/What you saw bears out/.test(rb), rb);
  assert.match(jurorBrief(g.murder, 'elda', 'bram', checked, words).text, /What you saw bears out: self defence/);
  // Rowan believes it was done, and that it was a fight: mercy, in words that are true of him.
  const rv = localJuror(g.murder, 'rowan', 'bram', checked, words);
  assert.equal(rv.vote, 'mercy', JSON.stringify(rv));
  assert.ok(!/^I saw/.test(rv.reason), rv.reason);
  // A lie the watch said aloud: the room knows it, but only Elda is told "you saw them".
  rec.snap.player = [{ by: 'elda', t: rec.t - HOUR / 2, place: 'whisperwood' }];
  const lie = checkDefence(g.murder, rec, [{ id: 'alibi1', kind: 'alibi', place: 'mirror_lake' }], { room, spokenBy: ['elda'] })[0];
  assert.equal(lie.lie, true);
  assert.equal(lie.public, true);
  assert.ok(!/you saw them/.test(jurorBrief(g.murder, 'rowan', 'bram', [lie], 'I was at the lake.').text));
  assert.match(jurorBrief(g.murder, 'elda', 'bram', [lie], 'I was at the lake.').text, /you saw them/);
});
