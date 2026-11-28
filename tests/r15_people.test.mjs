import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeGame, px, put, step } from './murder_world.mjs';
import { FACE_KINDS, FACE_SIZE, faceGrid, faceSvg, faceUrl, GLYPHS, glyphSvg, stripEmoji, FACE_PALETTE } from '../src/art/faces_art.js';
import { moodFace, MOOD_FACE, STANDING_FACE } from '../src/ui/format.js';
import { Emotions } from '../src/ai/mind/emotions.js';
import { personFace } from '../src/ui/person_face.js';
import { peopleList, companionPicker, youPage } from '../src/ui/people_view.js';
import { villagerChips } from '../src/ui/chat_target.js';
import { companionView } from '../src/ui/companion_view.js';
import { PRICE_GLYPH } from '../src/ui/stats_style.js';

// Round 15 (DESIGN §40): the people builder's items. 2: every mood face is drawn by the game
// (no phone emoji anywhere a player looks) and shows what the person really feels. 12: People
// and asking anyone along never depend on Lyra.

// ---------------------------------------------------------------- item 2: game-drawn faces

test('item 2: every face is a 15 x 14 grid in the palette, with an outline and a fill', () => {
  assert.ok(FACE_KINDS.length >= 28, `${FACE_KINDS.length} faces`);
  for (const k of FACE_KINDS) {
    const g = faceGrid(k);
    assert.equal(g.length, FACE_SIZE.h, k);
    for (const row of g) {
      assert.equal(row.length, FACE_SIZE.w, k);
      for (const ch of row) assert.ok(ch === '.' || FACE_PALETTE[ch], `${k}: ${ch}`);
    }
    const flat = g.join('');
    assert.ok(flat.includes('k'), `${k} has an outline`);
    assert.match(faceSvg(k), /^<svg [^>]*shape-rendering="crispEdges">/, k);
    assert.match(faceUrl(k), /^data:image\/svg\+xml,/, k);
  }
  // No two faces the same picture.
  const seen = new Map();
  for (const k of FACE_KINDS) {
    const key = faceGrid(k).join('/');
    assert.ok(!seen.has(key), `${k} looks like ${seen.get(key)}`);
    seen.set(key, k);
  }
  for (const [name, g] of Object.entries(GLYPHS)) {
    assert.equal(g.length, 7, name);
    for (const row of g) assert.equal(row.length, 7, name);
    assert.ok(glyphSvg(name).startsWith('<svg'), name);
  }
  for (const g of Object.values(PRICE_GLYPH)) assert.ok(GLYPHS[g], `price mark ${g} is drawn`);
});

test('item 2: every mood the minds can name maps to a drawn face; nothing known is neutral, never delighted', () => {
  for (const [label, kind] of Object.entries(MOOD_FACE)) assert.ok(FACE_KINDS.includes(kind), `${label} -> ${kind}`);
  for (const kind of Object.values(STANDING_FACE)) assert.ok(FACE_KINDS.includes(kind), kind);
  // Every mood Emotions can produce: drive it through many states.
  const e = new Emotions({ openness: 0.8, neuroticism: 0.5, agreeableness: 0.7, extraversion: 0.6, conscientiousness: 0.6 });
  const labels = new Set();
  const kinds = ['novelty', 'threat', 'loss', 'cruelty', 'kindness', 'gift_loved', 'praise', 'insult', 'alarm', 'shock', 'horror', 'level_up', 'failure', 'rest', 'betrayal'];
  for (const k of kinds) {
    for (let n = 1; n <= 4; n++) {
      e.appraise(k, n * 0.5);
      const m = e.mood({ energy: 0.8, hunger: 0.8, social: 0.8, fun: 0.8, safety: 0.8 });
      assert.ok(FACE_KINDS.includes(m.face), `${k}: ${m.label} -> ${m.face}`);
      labels.add(m.label);
      e.decay(120);
    }
  }
  e.setTint({ sadness: 0.3 }, { label: 'hurt' });
  assert.equal(e.mood().face, 'hurt');
  assert.ok(labels.size >= 6, [...labels].join(', '));
  assert.equal(moodFace(null), 'neutral');
  assert.equal(moodFace({ label: 'a thing nobody named' }), 'neutral');
});

test('item 2: an old save that kept an emoji on her tint reads its face from the label', () => {
  const e = new Emotions({});
  e.deserialize({ v: { sadness: 0.4 }, m: 0, t: { o: { sadness: 0.3 }, h: 900, l: { label: 'heartsick', emoji: '\u{1F622}' } } });
  assert.deepEqual(e.tintMood, { label: 'heartsick', face: 'heartsick' });
  assert.ok(!JSON.stringify(e.serialize()).match(/\p{Extended_Pictographic}/u), 'nothing pictographic is saved again');
});

// Every source file a player's eyes reach, scanned for any code point a phone draws as its own
// colour emoji. (Comments too: simpler, and nothing there needs one.)
function sourceFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'vendor') sourceFiles(p, out);
    } else if (/\.(js|css|html)$/.test(f)) out.push(p);
  }
  return out;
}

test('item 2: no emoji code point anywhere in the game a player sees (src, index.html)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [...sourceFiles(path.join(root, 'src')), path.join(root, 'index.html')];
  const re = /(?![\u2605\u2669-\u266F\u270E])[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}]/u;
  const hits = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      // The one place that names them is the pattern that strips them (a regex, not a glyph).
      if (re.test(l)) hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test("item 2: a mind's words lose any emoji before a bubble or the chat shows them", () => {
  assert.equal(stripEmoji('Of course! \u{1F60A}'), 'Of course!');
  assert.equal(stripEmoji('\u{2764}\u{FE0F} thank you'), 'thank you');
  assert.equal(stripEmoji('a song ♪ la la'), 'a song ♪ la la', 'a music note is a letter, not an emoji');
  assert.equal(stripEmoji(''), '');
});

// ---------------------------------------------------------------- item 2: the right face

test('item 2: curiosity at a new place is fascinated; then a scream nearby: her face is shock or fear, never fascinated', () => {
  const e = new Emotions({ openness: 0.9, neuroticism: 0.5, agreeableness: 0.7 });
  e.appraise('novelty', 1.2);
  e.appraise('novelty', 1.2);
  const before = e.mood();
  assert.equal(before.face, 'fascinated', `a new place: ${before.label}`);
  // The V12 screenshot: "That didn't sound good." after a killing heard nearby.
  e.appraise('shock', 1);
  const after = e.mood();
  assert.ok(['shocked', 'afraid', 'terrified', 'startled', 'uneasy'].includes(after.face), `after the scream: ${after.label} (${after.face})`);
  assert.ok(!['fascinated', 'delighted', 'happy', 'lively', 'content', 'curious'].includes(after.face));
  // Thirty seconds on, the surprise has gone, the fear has not: still no bright face.
  e.decay(30);
  const later = e.mood();
  assert.ok(!['fascinated', 'delighted', 'happy', 'lively', 'curious'].includes(later.face), `later: ${later.label}`);
});

test('item 2: a finisher held over someone she can see: horror shows, never a delighted default', () => {
  const e = new Emotions({ openness: 0.9, extraversion: 0.8, neuroticism: 0.5, agreeableness: 0.7 });
  e.appraise('gift_loved', 1);
  e.appraise('novelty', 1);
  assert.ok(['delighted', 'happy', 'fascinated', 'affectionate'].includes(e.mood().face), e.mood().label);
  e.appraise('horror', 1);
  const m = e.mood();
  assert.ok(['terrified', 'afraid', 'shocked', 'sad', 'heartsick', 'angry', 'furious'].includes(m.face), `${m.label} (${m.face})`);
});

test('item 2: in calm play a bright feeling still names her mood (no gloom painted over everything)', () => {
  const e = new Emotions({ openness: 0.9, extraversion: 0.8 });
  e.appraise('night_out', 1); // a little fear at nightfall
  e.decay(200);
  e.appraise('gift_loved', 1);
  assert.ok(['delighted', 'happy', 'affectionate'].includes(e.mood().face), e.mood().label);
});

test('item 2: in the game, Lyra hearing a scream behind a corner reads alarmed, and her card face follows', () => {
  const g = makeGame({ hour: 12 });
  const L = g.companion;
  put(g.player, px(97), px(103));
  put(L, px(99), px(103));
  // Something new catches her eye first (the V12 state).
  L.mind.appraise('novelty', 1.2);
  L.mind.appraise('novelty', 1.2);
  assert.equal(personFace(g, L).kind, 'fascinated');
  // A villager down and screaming, out of her sight but in earshot.
  const wys = g.entities.get('wys');
  put(wys, px(99), px(110));
  g.bus.emit('call_for_help', { victim: wys, victimEntity: wys, attacker: g.player, x: wys.x, y: wys.y, severity: 3 });
  const f = personFace(g, L);
  assert.ok(!['fascinated', 'delighted', 'happy', 'curious', 'lively'].includes(f.kind), `${f.label} (${f.kind})`);
});

test('item 2: a villager companion shows terror, grief or a fight on the card, not their opinion of you', () => {
  const g = makeGame({ hour: 12 });
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 80;
  assert.equal(personFace(g, bram).kind, 'happy');
  bram.terror = { until: g.murder.now() + 600, about: 'wys' };
  assert.equal(personFace(g, bram).kind, 'terrified');
  bram.terror = null;
  g.villageLife.mourning.bram = { about: 'wys', until: (g.clock.day ?? 1) + 30, kind: 'grief' };
  assert.equal(personFace(g, bram).kind, 'grieving');
  delete g.villageLife.mourning.bram;
  bram.downed = true;
  assert.equal(personFace(g, bram).kind, 'hurt');
});

// ---------------------------------------------------------------- item 12: People and asking

function leave(g, how) {
  const L = g.companion;
  const a = L.mind.autonomy;
  if (how === 'left') a.setCompanionship('left', '', { cause: 'worth_left', vars: { why: 'You frighten me.' }, lineKey: 'to_left_worth', noParting: true });
  else if (how === 'gone') a.setCompanionship('gone', 'You hurt me.', { cause: 'violence', goneReason: 'violence', lineKey: 'to_gone_violence', noParting: true });
  else if (how === 'dead') {
    L.downed = true;
    g.murder.kill(L, g.player);
  }
}

for (const how of ['left', 'gone', 'dead']) {
  test(`item 12: after Lyra ${how === 'dead' ? 'dies' : how === 'gone' ? 'cuts ties' : 'leaves'}, People lists every grown villager and any of them can be asked along`, () => {
    const g = makeGame({ hour: 12 });
    put(g.player, px(97), px(103));
    leave(g, how);
    assert.equal(companionView(g), null, 'alone: no one in the slot');
    const list = peopleList(g);
    assert.equal(list[0].id, 'you');
    for (const id of ['bram', 'garrick', 'elda', 'mira', 'aveline']) assert.ok(list.some((p) => p.id === id), `${id} is in People`);
    const pick = companionPicker(g, { max: 30 });
    const ids = pick.adults.map((a) => a.id);
    assert.ok(ids.includes('bram'), ids.join(','));
    assert.ok(!ids.includes('pip') && !ids.includes('tansy'), 'never a child');
    if (how === 'dead') assert.equal(pick.lyra, null, 'a dead Lyra is not asked');
    assert.ok(youPage(g).views.length > 10, 'how everyone sees you is still there');
    // Ask Bram (who likes you, at noon): he comes.
    const bram = g.entities.get('bram');
    bram.opinionOfPlayer = 75;
    put(bram, g.player.x + 20, g.player.y);
    const r = g.party.invite(bram, { by: 'player' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(g.party.holder, bram);
    assert.equal(companionView(g).id, 'bram');
    step(g, 1);
    assert.equal(g.party.holder, bram, 'he stays');
  });
}

test('item 12: talk offers "Will you travel with me?" to a grown person, never to a child; the one with you can be sent home', () => {
  const g = makeGame({ hour: 12 });
  leave(g, 'left');
  assert.ok(villagerChips(g, 'bram').includes('Will you travel with me?'));
  assert.ok(!villagerChips(g, 'pip').includes('Will you travel with me?'));
  const bram = g.entities.get('bram');
  bram.opinionOfPlayer = 75;
  g.party.invite(bram, { by: 'player' });
  const chips = villagerChips(g, 'bram');
  assert.ok(chips.includes('You can go home now. Thank you.'), chips.join(' | '));
});
