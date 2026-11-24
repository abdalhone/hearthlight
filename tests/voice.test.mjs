// Voices (DESIGN.md §21): key normalization shared by the collector and the runtime,
// clip lookup and fallback, muting, priority, and the order of Lyra's fallback voices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeLine, lineKey, isFixedLine, speakerIdOf, hash53, clipSegments, sentencesOf } from '../src/audio/voice_key.js';
import { VoicePlayer, readManifest, priorityOf, PRIORITY } from '../src/audio/voice.js';
import { lyraVoiceChain, groupEnabled, groupOf } from '../src/audio/voice_chain.js';
import { planPacks, packVoices } from '../scripts/voice/pack.mjs';
import { EventBus } from '../src/core/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ keys

test('normalization folds typography, case, spacing and stage directions', () => {
  const same = ['Hmph. You again.', 'hmph.  you   again .', '  HMPH. You again.'];
  for (const s of same) assert.equal(normalizeLine(s), 'hmph. you again.');
  assert.equal(normalizeLine('“Well now.” Flame’s lit?'), normalizeLine("Well now. Flame's lit?"));
  assert.equal(normalizeLine('*sighs* Fine — go on…'), 'fine - go on...');
  assert.equal(normalizeLine('♪ La la ♪ 🐝'), 'la la');
  assert.notEqual(normalizeLine('Hello.'), normalizeLine('Hello?'));
});

test('keys are stable, short and speaker-specific', () => {
  const k = lineKey('bram', 'Hmph. You again.');
  assert.match(k, /^bram-[0-9a-z]{6,12}$/);
  assert.equal(k, lineKey('BRAM', 'hmph. you  again.'));
  assert.notEqual(k, lineKey('elda', 'Hmph. You again.'));
  // pinned: a change here orphans every rendered clip, so it must be deliberate
  assert.equal(hash53('bram\nhmph. you again.').toString(36), k.slice(5));
  assert.equal(k, 'bram-2emdk7gxv8j');
  assert.equal(lineKey('', 'x'), null);
  assert.equal(lineKey('lyra', '   '), null);
});

test('templated lines are not fixed', () => {
  assert.equal(isFixedLine('Hi, {you}.'), false);
  assert.equal(isFixedLine('[Stay|Go] close.'), false);
  assert.equal(isFixedLine('{#oath}! That hurt.'), false);
  assert.equal(isFixedLine('Mind the sparks.'), true);
  assert.equal(isFixedLine('...'), false);
});

test('speaker ids: Lyra by identity, villagers by profile, bandits by kind', () => {
  const lyra = { name: 'Starling' };
  const game = { companion: lyra };
  assert.equal(speakerIdOf(lyra, game), 'lyra');
  assert.equal(speakerIdOf({ id: 'bram', profile: { id: 'bram' } }, game), 'bram');
  assert.equal(speakerIdOf({ id: 'e12', species: 'bandit_archer' }, game), 'bandit');
  assert.equal(speakerIdOf({ id: 'e13', species: 'bandit_chief' }, game), 'varek');
  assert.equal(speakerIdOf({ id: 'e14', species: 'wolf' }, game), null);
  assert.equal(speakerIdOf('Narrator', game), 'narrator');
});

test('collect.mjs and the runtime agree on keys', () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'hl-voice-')), 'lines.json');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/voice/collect.mjs'), '--out', out, '--quiet'], { cwd: ROOT });
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(doc.lines.length > 500, `only ${doc.lines.length} lines collected`);
  const speakers = new Set(doc.lines.map((l) => l.speaker));
  assert.ok(speakers.has('lyra') && speakers.has('bram'));
  for (const l of doc.lines) {
    assert.equal(l.key, lineKey(l.speaker, l.text));
    assert.ok(isFixedLine(l.text), l.text);
  }
  // A greeting Bram really says, found under the key the game will compute.
  const bram = doc.lines.find((l) => l.speaker === 'bram' && l.text === 'Mind the sparks.');
  assert.ok(bram);
  assert.equal(bram.key, lineKey('bram', 'mind the sparks.'));
});

test('the committed sample manifest points at real clips', () => {
  const dir = path.join(ROOT, 'assets/voice');
  if (!existsSync(path.join(dir, 'manifest.json'))) return;
  const m = readManifest(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
  assert.ok(m.size > 0);
  for (const [key, v] of m) {
    assert.ok(existsSync(path.join(dir, v.file)), v.file);
    assert.ok(v.dur > 0.2 && v.dur < 30, `${key} ${v.dur}`);
    assert.ok(key.startsWith(`${v.speaker}-`));
  }
});

test('a line made of recorded lines is spoken as those clips in a row', async () => {
  assert.deepEqual(sentencesOf('Fine. Attack mode! Anything... goes?'), ['Fine.', 'Attack mode!', 'Anything...', 'goes?']);
  const have = new Set([lineKey('lyra', 'Fine. I will stay at range.'), lineKey('lyra', 'Attack mode.'), lineKey('lyra', 'Anything that is not a friend is fair game.')]);
  const text = 'Fine. I will stay at range. Attack mode. Anything that is not a friend is fair game.';
  assert.deepEqual(clipSegments('lyra', text, (k) => have.has(k)), [...have]);
  assert.equal(clipSegments('lyra', `${text} And one more.`, (k) => have.has(k)), null);
  assert.equal(clipSegments('lyra', 'Attack mode.', (k) => have.has(k)), null); // one clip is a plain hit
  // the runtime joins them into one voice
  const { vp, ctx } = makePlayer();
  vp.manifest = new Map([...have].map((k) => [k, { speaker: 'lyra', dur: 1, file: `${k}.mp3` }]));
  vp._manifestP = Promise.resolve(vp.manifest);
  vp._fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  ctx.decodeAudioData = async () => ({ sampleRate: 24000, length: 10, getChannelData: () => new Float32Array(10) });
  ctx.createBuffer = (ch, len, rate) => {
    const data = new Float32Array(len);
    return { sampleRate: rate, length: len, duration: len / rate, getChannelData: () => data };
  };
  const p = vp.say({ speaker: 'lyra', text });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctx.started.length, 1);
  assert.equal(ctx.started[0].buffer.length, 30 + 2 * Math.round(24000 * 0.12));
  ctx.started[0].onended();
  assert.equal((await p).ok, true);
});

// ------------------------------------------------------------------ packs

test('packs keep speakers apart and stay near the target size', () => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ key: `lyra-${i}`, speaker: 'lyra', size: 20000 });
  for (let i = 0; i < 5; i++) entries.push({ key: `bram-${i}`, speaker: 'bram', size: 20000 });
  const plan = planPacks(entries, 100000);
  for (const p of plan) {
    assert.ok(p.size <= 100000);
    assert.ok(p.keys.every((k) => k.startsWith(p.speaker)));
  }
  assert.equal(plan.reduce((n, p) => n + p.keys.length, 0), 35);
  assert.deepEqual(plan.filter((p) => p.speaker === 'lyra').map((p) => p.n), [0, 1, 2, 3, 4, 5]);
});

test('a packed clip slices back out byte for byte', async () => {
  const src = mkdtempSync(path.join(tmpdir(), 'hl-vsrc-'));
  const out = path.join(src, 'out');
  const clips = { 'bram-a': Buffer.from('AAAA'), 'bram-b': Buffer.from('BBBBBB'), 'lyra-c': Buffer.from('CC') };
  const manifest = {};
  for (const [k, b] of Object.entries(clips)) {
    writeFileSync(path.join(src, `${k}.mp3`), b);
    manifest[k] = { speaker: k.split('-')[0], dur: 1.5 };
  }
  writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest));
  await packVoices({ src, out, log: null });
  const doc = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const m = readManifest(doc);
  for (const [k, b] of Object.entries(clips)) {
    const e = m.get(k);
    const pack = readFileSync(path.join(out, e.file));
    assert.deepEqual(pack.subarray(e.off, e.off + e.len), b);
    assert.equal(e.dur, 1.5);
  }
  assert.equal(readdirSync(out).length, 3); // two packs + manifest
});

// ------------------------------------------------------------------ runtime

// A fake WebAudio context: enough to decode, start, end and count.
function fakeCtx() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: { connect() {} },
    started: [],
    createGain() {
      return { context: ctx, gain: { value: 1, setTargetAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} };
    },
    createStereoPanner() {
      return { pan: { value: 0 }, connect() {} };
    },
    createBufferSource() {
      const s = {
        buffer: null,
        onended: null,
        connect() {},
        start() {
          ctx.started.push(s);
        },
        stop() {
          s.stopped = true;
        },
      };
      return s;
    },
    decodeAudioData(bytes) {
      return Promise.resolve({ duration: 1, bytes: new Uint8Array(bytes).length });
    },
  };
  return ctx;
}

function makePlayer(settings = {}) {
  const bus = new EventBus();
  const known = lineKey('bram', 'Mind the sparks.');
  const lyraKnown = lineKey('lyra', 'Lead on.');
  const eldaKnown = lineKey('elda', 'Sit, sit.');
  const manifest = { [known]: { speaker: 'bram', dur: 1.2 }, [lyraKnown]: { speaker: 'lyra', dur: 0.8 }, [eldaKnown]: { speaker: 'elda', dur: 0.7 } };
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (url.endsWith('.mp3') && Object.keys(manifest).some((k) => url.endsWith(`${k}.mp3`))) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    return { ok: false };
  };
  const ctx = fakeCtx();
  let t = 0;
  const game = { bus, settings: { ...settings }, state: 'playing', audio: { duck() {} } };
  const vp = new VoicePlayer(game, { fetch: fetchImpl, ctx, now: () => t });
  return { vp, game, ctx, bus, fetched, known, advance: (s) => (t += s) };
}

test('the runtime plays the clip of a known line and finishes when it ends', async () => {
  const { vp, ctx, fetched, known } = makePlayer();
  const p = vp.say({ speaker: 'bram', text: 'Mind  the sparks.' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 1);
  assert.ok(fetched.some((u) => u === `voice/${known}.mp3`));
  assert.ok(vp.busy());
  ctx.started[0].onended();
  assert.deepEqual(await p, { ok: true, reason: 'done' });
  assert.equal(vp.busy(), false);
});

test('an unknown line falls back cleanly: no clip, no fetch, no error', async () => {
  const { vp, ctx, fetched } = makePlayer();
  const r = await vp.say({ speaker: 'bram', text: 'A line nobody recorded.' });
  assert.deepEqual(r, { ok: false, reason: 'no_clip' });
  assert.equal(ctx.started.length, 0);
  assert.ok(fetched.every((u) => !u.endsWith('.mp3')));
  // Lyra's unrecorded lines go to her fallback (the live voice chain).
  const heard = [];
  vp.setFallback('lyra', (text, opts) => {
    heard.push([text, opts.kind]);
    return { ok: true, reason: 'tts' };
  });
  assert.deepEqual(await vp.say({ speaker: 'lyra', text: 'Something Claude wrote just now.', kind: 'reply' }), { ok: true, reason: 'tts' });
  assert.deepEqual(heard, [['Something Claude wrote just now.', 'reply']]);
});

test('no voice plays while muted, per group or altogether', async () => {
  for (const settings of [{ voices: false }, { voiceVillagers: false }, { voiceVol: 0 }]) {
    const { vp, ctx } = makePlayer(settings);
    const r = await vp.say({ speaker: 'bram', text: 'Mind the sparks.' });
    assert.equal(r.reason, 'muted');
    assert.equal(ctx.started.length, 0);
  }
  const { vp, ctx } = makePlayer({ voiceLyra: false });
  let fell = false;
  vp.setFallback('lyra', () => (fell = true));
  assert.equal((await vp.say({ speaker: 'lyra', text: 'Lead on.' })).reason, 'muted');
  assert.equal((await vp.say({ speaker: 'lyra', text: 'Unrecorded.' })).reason, 'muted');
  assert.equal(fell, false);
  assert.equal(ctx.started.length, 0);
  // muted mid-line: the voice stops
  const m = makePlayer();
  const p = m.vp.say({ speaker: 'bram', text: 'Mind the sparks.' });
  await new Promise((r) => setTimeout(r, 10));
  m.game.settings.voices = false;
  m.bus.emit('settings_changed', { key: 'voices', value: false });
  assert.equal((await p).reason, 'stopped');
  assert.ok(m.ctx.started[0].stopped);
});

test('one voice at a time: Lyra outranks villagers, villagers never overlap, duplicates are said once', async () => {
  const { vp, ctx, advance } = makePlayer();
  const bram = vp.say({ speaker: 'bram', text: 'Mind the sparks.' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 1);
  advance(3);
  // another villager's bubble while Bram talks is dropped
  assert.equal((await vp.say({ speaker: 'elda', text: 'Sit, sit.' })).reason, 'busy');
  // Lyra cuts in
  const lyra = vp.say({ speaker: 'lyra', text: 'Lead on.' });
  assert.equal((await bram).reason, 'interrupted');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 2);
  assert.ok(ctx.started[0].stopped);
  // the same line again at once is a duplicate (the bubble and the chat both asked)
  assert.equal((await vp.say({ speaker: 'lyra', text: 'Lead on.' })).reason, 'duplicate');
  // a cutscene outranks her; an outside voice cannot take the floor from a cutscene
  const scene = vp.claim({ speaker: 'narrator', kind: 'cutscene' });
  assert.ok(scene);
  assert.equal((await lyra).reason, 'interrupted');
  assert.equal(vp.claim({ speaker: 'lyra' }), null);
  scene.release();
  assert.equal(vp.busy(), false);
  // a line played directly (a cutscene, an open dialogue) is in the foreground: it cuts
  // in over Lyra and waits for its clip
  advance(5);
  const l2 = vp.say({ speaker: 'lyra', text: 'Lead on.' });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(vp.speaking('lyra'));
  const dlg = vp.play({ speaker: 'elda', text: 'Sit, sit.' });
  assert.equal((await l2).reason, 'interrupted');
  await new Promise((r) => setTimeout(r, 10));
  ctx.started[ctx.started.length - 1].onended();
  assert.equal((await dlg).reason, 'done');
  assert.equal(priorityOf('narrator'), PRIORITY.cutscene);
  assert.equal(priorityOf('lyra_young'), PRIORITY.lyra);
  assert.equal(priorityOf('hobb'), PRIORITY.villager);
});

test('bubbles are voiced only near the player and on screen', async () => {
  const { vp, game, bus, ctx } = makePlayer();
  game.player = { x: 0, y: 0 };
  game.camera = { x: -200, y: -120, vw: 400, vh: 240, inView(x, y, m = 0) { return x >= this.x - m && x <= this.x + this.vw + m && y >= this.y - m && y <= this.y + this.vh + m; } };
  const far = { x: 900, y: 0, profile: { id: 'bram' } };
  bus.emit('speech', { speaker: far, text: 'Mind the sparks.', kind: 'say' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 0);
  const near = { x: 40, y: 10, profile: { id: 'bram' } };
  bus.emit('speech', { speaker: near, text: 'Mind the sparks.', kind: 'thought' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 0);
  bus.emit('speech', { speaker: near, text: 'Mind the sparks.', kind: 'say' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.started.length, 1);
  assert.equal(vp.stats.played, 1);
});

test('a clip that arrives too late for its bubble is dropped', async () => {
  const { vp, ctx, advance } = makePlayer();
  const orig = vp._buffer.bind(vp);
  vp._buffer = (k) => orig(k).then((b) => (advance(5), b));
  const r = await vp.say({ speaker: 'bram', text: 'Mind the sparks.' });
  assert.equal(r.reason, 'late');
  assert.equal(ctx.started.length, 0);
});

// ------------------------------------------------------------------ fallback chain

test("Lyra's fallback chain: clip, then live Kokoro, then claude.ai, then the browser, then silence", () => {
  const all = { voice: true, kokoroLive: true, browserVoice: true };
  assert.deepEqual(lyraVoiceChain({ settings: all, hasClip: true, tts: true, synth: true }), ['clip']);
  assert.deepEqual(lyraVoiceChain({ settings: all, tts: true, synth: true }), ['kokoro', 'tts', 'browser']);
  assert.deepEqual(lyraVoiceChain({ settings: all, kokoro: { failed: true }, tts: true, synth: true }), ['tts', 'browser']);
  assert.deepEqual(lyraVoiceChain({ settings: all, kokoro: { supported: false }, tts: false, synth: true }), ['browser']);
  // the browser's voice only when the player asked for it
  assert.deepEqual(lyraVoiceChain({ settings: { voice: true }, tts: false, synth: true }), []);
  // claude.ai's voice only with the old "read her replies aloud" switch
  assert.deepEqual(lyraVoiceChain({ settings: { voice: false, browserVoice: true }, tts: true, synth: true }), ['browser']);
  // a passing bark never takes a voice that is not hers
  assert.deepEqual(lyraVoiceChain({ settings: all, kind: 'bark', tts: true, synth: true }), ['kokoro']);
  // muted: nothing at all
  assert.deepEqual(lyraVoiceChain({ settings: { ...all, voices: false }, hasClip: true, tts: true }), []);
  assert.deepEqual(lyraVoiceChain({ settings: { ...all, voiceLyra: false }, tts: true }), []);
});

test('the brain voice tries each voice in order and never blocks', async () => {
  const { Voice } = await import('../src/ai/brain/voice.js');
  const bus = new EventBus();
  const calls = [];
  const game = {
    bus,
    settings: { voice: true, kokoroLive: true, browserVoice: true, voices: true },
    runtime: { tts: { speak: async (t) => calls.push(['tts', t]) } },
  };
  const v = new Voice(game);
  // Kokoro cannot run under node: it is skipped as unavailable, claude.ai's voice speaks.
  const r = await v.speakLive('A reply from Claude.', { kind: 'reply' });
  assert.deepEqual(r, { ok: true, reason: 'tts' });
  assert.deepEqual(calls, [['tts', 'A reply from Claude.']]);
  // claude.ai refuses: the switch turns off and nothing else speaks that line
  game.setSetting = (k, val) => (game.settings[k] = val);
  game.runtime.tts.speak = async () => {
    throw Object.assign(new Error('no'), { code: 'not_granted' });
  };
  const r2 = await v.speakLive('Another.', { kind: 'reply' });
  assert.equal(r2.reason, 'not_granted');
  assert.equal(game.settings.voice, false);
  assert.equal(groupOf('lyra_young'), 'lyra');
  assert.equal(groupEnabled({}, 'narrator'), true);
});

// ------------------------------------------------------------------ live Kokoro text pipeline

test("the live voice's phonemes match kokoro-onnx's for her lines", async () => {
  const { phonemize, tokenize, splitSentences, styleFor, VOCAB } = await import('../src/audio/kokoro_text.js');
  const { phonemize: espeak } = await import('phonemizer');
  // Reference phonemes from kokoro-onnx 0.6.1 (scripts/voice/voicelib.py Synth.phonemes).
  const ref = {
    "Wicks and ashes! You walked straight past the lamp again, didn't you?": 'wˈɪks ænd ˈæʃᵻz! juː wˈɔːkt stɹˈeɪt pˈæst ðə lˈæmp ɐɡˈɛn, dˈɪdnt juː?',
    'Hmph. You again.': 'hˈʌmf. juː ɐɡˈɛn.',
    "Mm. Wind's wrong.": 'ˈmmm. wˈɪndz ɹˈɔŋ.',
    'Bandits. Of course it\'s bandits.': 'bˈændɪts. ʌv kˈɔːɹs ɪts bˈændɪts.',
  };
  for (const [text, want] of Object.entries(ref)) assert.equal(await phonemize(text, espeak), want, text);
  const ids = tokenize('hˈʌmf.');
  assert.deepEqual(ids, [...'hˈʌmf.'].map((c) => VOCAB[c]));
  assert.deepEqual(splitSentences("Hi. Wicks and ashes! You walked past the lamp, didn't you?"), ['Hi. Wicks and ashes!', "You walked past the lamp, didn't you?"]);
  assert.deepEqual(splitSentences("Wicks and ashes, you walked right past the lamp again, didn't you?", { firstClause: true }), [
    'Wicks and ashes,',
    "you walked right past the lamp again, didn't you?",
  ]);
  const long = `${'word '.repeat(80)}end.`;
  assert.ok(splitSentences(long).every((s) => s.length <= 220));
  const styles = new Float32Array(510 * 256).map((_, i) => Math.floor(i / 256));
  assert.equal(styleFor(styles, 5)[0], 4);
  assert.equal(styleFor(styles, 9999)[0], 509);
});

test('the live voice is offered only where the build published it', async () => {
  const { LiveKokoro } = await import('../src/audio/kokoro_live.js');
  const lk = new LiveKokoro({ settings: { kokoroLive: true } });
  assert.equal(lk.available(), false);
  assert.equal(lk.supported(), false);
  assert.equal((await lk.speak('Hello there, love.')).reason, 'unavailable');
  const lk2 = new LiveKokoro({ settings: {} }, { base: 'kokoro/' });
  assert.equal(lk2.available(), true);
});
